// =============================================================================
// apps/api/test/admin-source-events.test.ts
// =============================================================================
// `admin-source/events.ts`, WHICH IS THE ADAPTER TWO SESSIONS MEASURED AS
// UNWRITABLE.
//
// Session 349 seeded a `Tx` naming `'events'` and watched `tsc` refuse it with
// `TS2322` against `TABLE_KEYS`; session 353 reproduced the same refusal from
// the account drill-down's side. ADR-191 registered the table under a sixth
// scope class and the refusal is gone. **The first case below is that fact
// asserted rather than remembered**: it imports `TABLE_KEYS` out of `@merit/db`
// and looks for the name.
//
// THE TWO CASES THAT DECIDE THE FEED ARE THE DISJUNCTION AND THE ORDER. The
// disjunction is ADR-191 clause 2 arriving at the read layer: an identity-scoped
// feed built on `identity_id = $1` alone COMPILES, returns rows, and omits every
// event this person reached through an account. The order is API_CONTRACT
// section 8's, `recorded_at` descending with `id` as the total-order tie-break,
// and `id` is a `bigint` written as text, so a lexical comparison sorts row 10
// above row 9.
//
// WHAT THIS SUITE DELIBERATELY DOES NOT TEST IS THE WITHHOLDING. `INV-M6-10`
// lives on the RESPONSE (ADR-184 ruling 3) and `test/admin-feed.test.ts` holds
// it. One case here asserts the boundary from this side: the port hands back
// UNWITHHELD rows, which is what `admin-reads.ts` promises in its own words, and
// a module that gated them would make the control run twice in two places that
// can disagree.
// =============================================================================

import { describe, expect, it } from 'vitest';

import { TABLE_KEYS } from '@merit/db';
import type { SystemTx, TableKey } from '@merit/db';

import { withholdForScope } from '../src/routes/admin-feed.ts';
import { AdminReadError } from '../src/routes/admin-reads.ts';
import { EVENT_READ_TABLES, readEventFeed } from '../src/admin-source/events.ts';
import {
  IMPLEMENTED_ADMIN_READS,
  composeImplementedAdminReads,
} from '../src/admin-source/index.ts';
import type { AdminEventQuery, AdminEventRow, FeedScope } from '../src/routes/admin-feed.ts';
import type { EventsTx } from '../src/admin-source/events.ts';
import type { AdminSourceTx } from '../src/admin-source/index.ts';

// -----------------------------------------------------------------------------
// The fake
// -----------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Tables = Record<string, readonly Row[]>;

/**
 * The accessor, with the read half only and nothing else on the object.
 *
 * `admin-source-flags.test.ts`'s `Recorder`, narrowed to the two methods
 * `EventsTx` declares. If this module ever reached for `rowAt`, `insert`,
 * `updateAt`, `deleteAt` or `sqlExecutor`, every case in this file would fail
 * with a `TypeError` rather than pass quietly.
 *
 * `rowsWhere` is an ANDed conjunction of EQUALITIES and is deliberately not
 * smarter than ADR-112's real filter, so this suite cannot agree with a fake
 * about a predicate the database would refuse.
 */
class Recorder {
  readonly calls: string[] = [];

  constructor(private readonly tables: Tables) {}

  rows(key: string): Promise<unknown[]> {
    this.calls.push(`rows ${key}`);
    return Promise.resolve([...(this.tables[key] ?? [])]);
  }

  rowsWhere(key: string, where: Row): Promise<unknown[]> {
    const terms = Object.keys(where).sort();
    if (terms.length === 0)
      throw new Error(`rowsWhere ${key} was handed an empty filter, which does not compile`);
    this.calls.push(`rowsWhere ${key} ${terms.join('+')}`);
    return Promise.resolve(
      (this.tables[key] ?? []).filter((row) => terms.every((term) => row[term] === where[term])),
    );
  }
}

function eventsTx(tables: Tables): { tx: EventsTx; recorder: Recorder } {
  const recorder = new Recorder(tables);
  return { tx: recorder as unknown as EventsTx, recorder };
}

// -----------------------------------------------------------------------------
// The fixtures
// -----------------------------------------------------------------------------

const IDENTITY_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const IDENTITY_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const ACCOUNT_A1 = 'a1a1a1a1-0000-4000-8000-000000000001';
const ACCOUNT_A2 = 'a2a2a2a2-0000-4000-8000-000000000002';
const ACCOUNT_B1 = 'b1b1b1b1-0000-4000-8000-000000000001';

interface EventSpec {
  readonly id: string;
  readonly eventName?: string;
  readonly recordedAt?: string;
  readonly occurredAt?: string;
  readonly identityId?: string | null;
  readonly accountId?: string | null;
  readonly subjectKind?: string;
  readonly subjectId?: string;
  readonly actorId?: string | null;
  readonly payload?: Row;
}

function event(spec: EventSpec): Row {
  const recordedAt = spec.recordedAt ?? '2026-08-28T12:00:00.000Z';
  return {
    id: BigInt(spec.id),
    eventName: spec.eventName ?? 'account.funded',
    occurredAt: new Date(spec.occurredAt ?? recordedAt),
    recordedAt: new Date(recordedAt),
    identityId: spec.identityId ?? null,
    accountId: spec.accountId ?? null,
    subjectKind: spec.subjectKind ?? 'account',
    subjectId: spec.subjectId ?? ACCOUNT_A1,
    payload: spec.payload ?? { plan_code: 'starter' },
    actorKind: 'system',
    actorId: spec.actorId ?? null,
    correlationId: null,
  };
}

/** `IDENTITY_A` holds two accounts, `IDENTITY_B` holds one. */
const ACCOUNTS: readonly Row[] = [
  { id: ACCOUNT_A1, identityId: IDENTITY_A },
  { id: ACCOUNT_A2, identityId: IDENTITY_A },
  { id: ACCOUNT_B1, identityId: IDENTITY_B },
];

function tablesOf(specs: readonly EventSpec[]): Tables {
  return { accounts: ACCOUNTS, events: specs.map(event) };
}

const OPERATIONAL: FeedScope = { kind: 'operational' };
const SCOPE_A: FeedScope = { kind: 'identity', identity_id: IDENTITY_A };

function query(scope: FeedScope, over: Partial<AdminEventQuery> = {}): AdminEventQuery {
  return { scope, limit: 100, cursor: null, ...over };
}

function ids(rows: readonly AdminEventRow[]): readonly string[] {
  return rows.map((row) => row.id);
}

// =============================================================================
// 0. THE SHAPE, AND THE BLOCKER THAT IS GONE
// =============================================================================

describe('the table this adapter could not name', () => {
  it('is a key packages/db registers, which is the refusal sessions 349 and 353 measured', () => {
    // DERIVED FROM THE REGISTRY AND NOT FROM A DOCUMENT. Session 349 read the
    // same array and found 106 names without this one; ADR-191 registered it
    // under the sixth scope class and this is that entry landing.
    expect(TABLE_KEYS).toContain('events');
  });

  it('names accounts too, because the identity leg is a disjunction and not a join', () => {
    const keys: readonly TableKey[] = [...EVENT_READ_TABLES];
    for (const key of keys) expect(TABLE_KEYS).toContain(key);
    expect([...EVENT_READ_TABLES].sort()).toStrictEqual(['accounts', 'events']);
  });

  it('is reached through a handle SystemTx satisfies, which is the TS2322 that stopped 349', () => {
    // COMPILE-TIME, AND THE ASSIGNMENT IS THE ASSERTION. This line is what
    // failed `tsc` before ADR-191: `AdminSourceTx` now intersects `EventsTx`,
    // whose keys include `'events'`.
    const handle: AdminSourceTx = null as unknown as SystemTx;
    expect(handle).toBeNull();
  });

  it('is read through a fake carrying no write method at all', async () => {
    const recorder = new Recorder(tablesOf([{ id: '1' }]));
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(recorder)).sort()).toStrictEqual([
      'constructor',
      'rows',
      'rowsWhere',
    ]);
    const result = await readEventFeed(recorder as unknown as EventsTx, query(OPERATIONAL));
    expect(result.page.data).toHaveLength(1);
  });
});

// =============================================================================
// 1. ADR-191 CLAUSE 2. THE CASE THIS ADAPTER EXISTS FOR
// =============================================================================

describe('an identity-scoped feed is the DISJUNCTION and neither half may be lost', () => {
  const TABLES = tablesOf([
    // Reached the `owned` way: the row carries the identity and no account.
    { id: '1', eventName: 'phone.verified', identityId: IDENTITY_A, accountId: null },
    // Reached the `derived` way: no identity column, an account this person holds.
    { id: '2', eventName: 'account.funded', identityId: null, accountId: ACCOUNT_A1 },
    // Reached both ways, which ADR-191 section 4 counted at six of 29.
    { id: '3', eventName: 'payout.settled', identityId: IDENTITY_A, accountId: ACCOUNT_A2 },
    // Somebody else's, by both legs.
    { id: '4', eventName: 'account.funded', identityId: IDENTITY_B, accountId: ACCOUNT_B1 },
    // Nobody's. ADR-191 clause 3: returned to nobody.
    { id: '5', eventName: 'mid.health_changed', identityId: null, accountId: null },
  ]);

  it('returns the row reached only through the account leg', async () => {
    const { tx } = eventsTx(TABLES);
    const result = await readEventFeed(tx, query(SCOPE_A));
    // AN EQUALITY-ONLY ADAPTER PASSES EVERY OTHER CASE IN THIS FILE AND FAILS
    // THIS ONE. ADR-191 section 4 measured the loss at ten of twenty-nine `TL`
    // event kinds, so the omission is a third of the catalogue rather than a
    // corner.
    expect([...ids(result.page.data)].sort()).toStrictEqual(['1', '2', '3']);
  });

  it('returns the row reached only through the identity leg', async () => {
    const { tx } = eventsTx(TABLES);
    const result = await readEventFeed(tx, query(SCOPE_A));
    // The mirror. A `derived`-only rule drops this one, which ADR-191 measured
    // at nine of twenty-nine.
    expect(ids(result.page.data)).toContain('1');
  });

  it('returns a row reachable by both legs exactly once, and counts the overlap', async () => {
    const { tx } = eventsTx(TABLES);
    const result = await readEventFeed(tx, query(SCOPE_A));
    expect(ids(result.page.data).filter((id) => id === '3')).toHaveLength(1);
    expect(result.cost.duplicatesAcrossLegs).toBe(1);
  });

  it('returns nobody else, by either leg', async () => {
    const { tx } = eventsTx(TABLES);
    const result = await readEventFeed(tx, query(SCOPE_A));
    expect(ids(result.page.data)).not.toContain('4');
    // ADR-191 clause 3. A row reaching neither leg belongs to no identity and
    // is returned to nobody, and it needs no third predicate: the equality
    // drops it and the account set drops it again.
    expect(ids(result.page.data)).not.toContain('5');
  });

  it('spells the disjunction as two reads and never as a predicate the accessor lacks', async () => {
    const { tx, recorder } = eventsTx(TABLES);
    await readEventFeed(tx, query(SCOPE_A));
    expect(recorder.calls).toStrictEqual([
      'rowsWhere events identityId',
      'rowsWhere accounts identityId',
      'rowsWhere events accountId',
      'rowsWhere events accountId',
    ]);
  });

  it('prices the second leg separately, so the cost of ADR-191 is visible', async () => {
    const { tx } = eventsTx(TABLES);
    const result = await readEventFeed(tx, query(SCOPE_A));
    expect(result.cost.identityLegRows).toBe(2);
    expect(result.cost.accountsOfIdentity).toBe(2);
    expect(result.cost.accountLegRows).toBe(2);
    expect(result.cost.scanned).toBe(4);
  });
});

describe('an account-scoped feed is ONE leg, and that is not an inconsistency', () => {
  it('reads the account column and does not widen to the owner', async () => {
    const { tx, recorder } = eventsTx(
      tablesOf([
        { id: '1', identityId: IDENTITY_A, accountId: null },
        { id: '2', identityId: null, accountId: ACCOUNT_A1 },
        { id: '3', identityId: null, accountId: ACCOUNT_A2 },
      ]),
    );
    const result = await readEventFeed(tx, query({ kind: 'account', account_id: ACCOUNT_A1 }));
    expect(ids(result.page.data)).toStrictEqual(['2']);
    // ONE READ AND NO ACCOUNT SET. An account-scoped question is about the
    // account, and answering it with the owner's identity-level rows would
    // answer the identity scope's question on a page licensed for one account.
    expect(recorder.calls).toStrictEqual(['rowsWhere events accountId']);
  });
});

describe('an operational feed reads the whole table and says what that cost', () => {
  it('uses rows and never an empty filter', async () => {
    const { tx, recorder } = eventsTx(
      tablesOf([
        { id: '1', identityId: IDENTITY_A },
        { id: '2', identityId: IDENTITY_B },
        { id: '3', identityId: null, accountId: null },
      ]),
    );
    const result = await readEventFeed(tx, query(OPERATIONAL));
    expect(recorder.calls).toStrictEqual(['rows events']);
    expect([...ids(result.page.data)].sort()).toStrictEqual(['1', '2', '3']);
    // THE NUMBER THE COST OBJECT EXISTS FOR. `events` is append-only with
    // retention forever, so this grows in the operating age of the firm and the
    // range term that would bound it needs an import this directory does not
    // make.
    expect(result.cost.scanned).toBe(3);
  });
});

// =============================================================================
// 2. THE ORDER, WHICH IS API_CONTRACT SECTION 8's AND NOT THIS MODULE'S
// =============================================================================

describe('ordered by recorded_at descending, ties broken on id', () => {
  it('puts a late correction at the top of today rather than back in its own day', async () => {
    const { tx } = eventsTx(
      tablesOf([
        { id: '1', occurredAt: '2026-08-25T09:00:00.000Z', recordedAt: '2026-08-25T09:00:00.000Z' },
        // Learned last, happened first. The contract's own example: "a late
        // vendor webhook about Tuesday's fact belongs at the top of Thursday's
        // feed rather than buried in Tuesday".
        { id: '2', occurredAt: '2026-08-25T08:00:00.000Z', recordedAt: '2026-08-28T09:00:00.000Z' },
        { id: '3', occurredAt: '2026-08-26T09:00:00.000Z', recordedAt: '2026-08-26T09:00:00.000Z' },
      ]),
    );
    const result = await readEventFeed(tx, query(OPERATIONAL));
    expect(ids(result.page.data)).toStrictEqual(['2', '3', '1']);
  });

  it('breaks a tie on id as a NUMBER, because "10" sorts before "9" as text', async () => {
    const at = '2026-08-28T09:00:00.000Z';
    const { tx } = eventsTx(
      tablesOf([
        { id: '9', recordedAt: at },
        { id: '10', recordedAt: at },
        { id: '2', recordedAt: at },
      ]),
    );
    const result = await readEventFeed(tx, query(OPERATIONAL));
    // DESCENDING ON BOTH KEYS. The tie-break exists to make the cursor total,
    // and an ascending one inside a descending page walks backwards through the
    // rows it was added to separate.
    expect(ids(result.page.data)).toStrictEqual(['10', '9', '2']);
  });
});

// =============================================================================
// 3. THE CURSOR
// =============================================================================

describe('the cursor', () => {
  const AT = '2026-08-28T09:00:00.000Z';
  const TABLES = tablesOf([1, 2, 3, 4, 5].map((n) => ({ id: String(n), recordedAt: AT })));

  it('pages without repeating a row and without dropping one', async () => {
    const { tx } = eventsTx(TABLES);
    const first = await readEventFeed(tx, query(OPERATIONAL, { limit: 2 }));
    expect(ids(first.page.data)).toStrictEqual(['5', '4']);
    expect(first.page.next_cursor).not.toBeNull();

    const second = await readEventFeed(
      tx,
      query(OPERATIONAL, { limit: 2, cursor: first.page.next_cursor }),
    );
    expect(ids(second.page.data)).toStrictEqual(['3', '2']);

    const third = await readEventFeed(
      tx,
      query(OPERATIONAL, { limit: 2, cursor: second.page.next_cursor }),
    );
    expect(ids(third.page.data)).toStrictEqual(['1']);
    expect(third.page.next_cursor).toBeNull();
  });

  it('reports null on a FULL page that exhausted the query', async () => {
    const { tx } = eventsTx(TABLES);
    const page = await readEventFeed(tx, query(OPERATIONAL, { limit: 5 }));
    expect(page.page.data).toHaveLength(5);
    // ADR-184 ruling 4: `next_cursor === null` is the difference between an
    // exhausted query and a truncated page, and it is the only honest one this
    // envelope carries because there is no `total`.
    expect(page.page.next_cursor).toBeNull();
  });

  it('carries no total, because ADR-157 refuses the scalar aggregate', async () => {
    const { tx } = eventsTx(TABLES);
    const page = await readEventFeed(tx, query(OPERATIONAL, { limit: 2 }));
    expect(Object.keys(page.page).sort()).toStrictEqual(['data', 'next_cursor']);
  });

  it('refuses a cursor from a different ordering', async () => {
    const { tx } = eventsTx(TABLES);
    const three = Buffer.from(`${AT} 1 extra`, 'utf8').toString('base64url');
    await expect(readEventFeed(tx, query(OPERATIONAL, { cursor: three }))).rejects.toThrow(
      AdminReadError,
    );
  });

  it('refuses a cursor whose instant is not one', async () => {
    const { tx } = eventsTx(TABLES);
    const bad = Buffer.from('yesterday 1', 'utf8').toString('base64url');
    await expect(readEventFeed(tx, query(OPERATIONAL, { cursor: bad }))).rejects.toThrow(
      /not an instant/,
    );
  });

  it('refuses a cursor whose id is not an events.id', async () => {
    const { tx } = eventsTx(TABLES);
    const bad = Buffer.from(`${AT} newest`, 'utf8').toString('base64url');
    await expect(readEventFeed(tx, query(OPERATIONAL, { cursor: bad }))).rejects.toThrow(
      /only thing making this ordering total/,
    );
  });
});

// =============================================================================
// 4. THE ROWS, READ DEFENSIVELY
// =============================================================================

describe('a row this feed must not render', () => {
  async function refuse(row: Row): Promise<void> {
    const { tx } = eventsTx({ accounts: ACCOUNTS, events: [row] });
    await expect(readEventFeed(tx, query(OPERATIONAL))).rejects.toThrow(AdminReadError);
  }

  it('refuses an id that is not the bigint 0017 declares', async () => {
    await refuse({ ...event({ id: '1' }), id: 'newest' });
  });

  it('refuses a missing event_name, which the column declares NOT NULL', async () => {
    await refuse({ ...event({ id: '1' }), eventName: null });
  });

  it('refuses a payload that is not an object, because the withholding walks its keys', async () => {
    await refuse({ ...event({ id: '1' }), payload: 'account funded' });
  });

  it('refuses an instant that is not one, on both columns', async () => {
    await refuse({ ...event({ id: '1' }), recordedAt: 'thursday' });
    await refuse({ ...event({ id: '1' }), occurredAt: null });
  });

  it('keeps both instants apart rather than defaulting one to the other', async () => {
    const { tx } = eventsTx(
      tablesOf([
        { id: '1', occurredAt: '2026-08-25T08:00:00.000Z', recordedAt: '2026-08-28T09:00:00.000Z' },
      ]),
    );
    const [row] = (await readEventFeed(tx, query(OPERATIONAL))).page.data;
    expect(row?.occurred_at).toBe('2026-08-25T08:00:00.000Z');
    expect(row?.recorded_at).toBe('2026-08-28T09:00:00.000Z');
  });
});

// =============================================================================
// 5. THE BOUNDARY WITH `INV-M6-10`
// =============================================================================

describe('the port hands back UNWITHHELD rows and the withholding is the next step', () => {
  const TABLES = tablesOf([
    {
      id: '1',
      identityId: IDENTITY_A,
      accountId: ACCOUNT_A1,
      payload: { matched_identity_id: IDENTITY_B },
    },
  ]);

  it('returns the third-party uuid the scope will withhold, which admin-reads.ts promises', async () => {
    const { tx } = eventsTx(TABLES);
    const [row] = (await readEventFeed(tx, query(SCOPE_A))).page.data;
    // "The event feed's page, BEFORE `INV-M6-10` is applied to it". A module
    // gating here would make the control run in two places that can disagree,
    // and the one over the serialized body is the one that cannot be out-argued
    // by a field added later.
    expect(row?.payload['matched_identity_id']).toBe(IDENTITY_B);
  });

  it('composes with withholdForScope, which is where the invariant lives', async () => {
    const { tx } = eventsTx(TABLES);
    const page = await readEventFeed(tx, query(SCOPE_A));
    const { items, withheldValues } = withholdForScope(page.page.data, SCOPE_A);
    expect(items[0]?.identity_id).toBe(IDENTITY_A);
    expect(items[0]?.payload['matched_identity_id']).toBe('withheld');
    expect(withheldValues).toContain(IDENTITY_B);
  });

  it('leaves an account-leg row legible only through the page scope, which is stated', async () => {
    const { tx } = eventsTx(
      tablesOf([{ id: '1', identityId: null, accountId: ACCOUNT_A1, subjectKind: 'account' }]),
    );
    const page = await readEventFeed(tx, query(SCOPE_A));
    const { items } = withholdForScope(page.page.data, SCOPE_A);
    // THE RESIDUAL THE MODULE HEADER NAMES. `licensedBy` licenses the identity
    // uuid and not the account's, so this person's own account-level row
    // renders with no identity and a withheld account. It is on the page, which
    // is the half that matters, and the page echoes its scope.
    expect(items[0]?.identity_id).toBeNull();
    expect(items[0]?.account_id).toBe('withheld');
    expect(items[0]?.event_name).toBe('account.funded');
  });
});

// =============================================================================
// 6. THE COMPOSITION
// =============================================================================

describe('the composition gains one arm and nothing else', () => {
  it('names listEvents in IMPLEMENTED_ADMIN_READS, sorted', () => {
    expect([...IMPLEMENTED_ADMIN_READS]).toStrictEqual([...IMPLEMENTED_ADMIN_READS].sort());
    expect(IMPLEMENTED_ADMIN_READS).toContain('listEvents');
  });

  it('serves a page through one unit of work per call', async () => {
    const recorder = new Recorder(tablesOf([{ id: '1', identityId: IDENTITY_A }]));
    let units = 0;
    const source = composeImplementedAdminReads({
      operator: async (fn) => {
        units += 1;
        return await fn(recorder as unknown as AdminSourceTx);
      },
    });
    const page = await source.listEvents(query(SCOPE_A));
    expect(ids(page.data)).toStrictEqual(['1']);
    expect(units).toBe(1);
    // THE COST IS DROPPED HERE AND THAT IS DELIBERATE: the port's signature is
    // the contract's and has nowhere to carry it.
    expect(Object.keys(page).sort()).toStrictEqual(['data', 'next_cursor']);
  });
});
