// =============================================================================
// apps/api/test/account-reads.test.ts
// =============================================================================
// EVERY RESPONSE ASSERTION GOES THROUGH FASTIFY'S REAL ROUTER by way of
// `inject`, over the modules discovered FROM DISK, so a route that is declared
// and never registered fails here rather than in production. That is not a
// stylistic choice in this file: a grep over route files has been wrong twice
// in this repository and both times it was about these four endpoints.
//
// -----------------------------------------------------------------------------
// THE BOLA CASE IS WRITTEN IN TWO HALVES AND EACH ONE SAYS WHICH IT IS
// -----------------------------------------------------------------------------
// `accounts.test.ts` states the split and this file follows it rather than
// inventing a second one:
//
//   HALF 1, STRUCTURAL, AND THIS PACKAGE'S. Identity A naming identity B's
//   account reaches the SCOPED door opened with A, `rowAt('accounts', { id })`,
//   and nothing else. No firm door, no `sqlExecutor`. Given that, tenancy is
//   ANDed by `scopePredicate`, which `packages/db/test/keyed-accessor.test.ts`
//   asserts against seeded mutations. This half would still fail if the route
//   reached for a wider door, and no store can fake it.
//
//   HALF 2, BEHAVIOURAL, AND IT AGREES WITH ITS OWN FAKE. Over a store that
//   MODELS the AND, the answer is 404 `not_found`: not 403, and not B's data.
//   It is here because the STATUS CODE is a decision this package makes.
//
// THE NEGATIVE CONTROL IS NOT OPTIONAL: a store that returned nothing for every
// address would pass both halves and every refusal case below. Identity A
// naming its OWN account gets its own marks.
//
// -----------------------------------------------------------------------------
// THE ACCOUNT RESOLUTION IS ASSERTED AS A SEPARATE FACT FROM THE PAGE
// -----------------------------------------------------------------------------
// `/marks` would still be tenancy-safe if it read `dailyMarks` directly, because
// the accessor ANDs the predicate either way. It would NOT be contract-correct:
// a stranger's account id would answer 200 with an empty page where section 1
// requires 404. So the account read is asserted by name, in the order it runs.
// =============================================================================

import { atMost, isFilterTerm } from '@merit/db';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import type { ApiDb } from '../src/db.ts';
import { BASE_PATH, buildServer, discoverRouteModules } from '../src/index.ts';
import accountReadsModule, {
  ACCOUNT_READS_REQUIRED_FACTORS,
  AccountReadsBackendUnwired,
  AccountReadsRowError,
  CERTIFICATE_PATH,
  ELIGIBILITY_PATH,
  LIMIT_MAX,
  MARKS_PATH,
  TIMELINE_PATH,
  databaseAccountReads,
  pageOf,
  projectMarks,
  resetAccountReadsBackend,
  useAccountReadsBackend,
  type MarkListItem,
  type MarksSnapshot,
} from '../src/routes/account-reads.ts';
import {
  resetAuthBackend,
  SESSION_COOKIE,
  UNWIRED_AUTH_BACKEND,
  useAuthBackend,
  type AuthSession,
} from '../src/routes/auth.ts';
import { NO_PRE_IDENTITY_DOORS } from './db-recorder.ts';

// -----------------------------------------------------------------------------
// Two identities. Every id is a uuid because `db.ts` refuses anything else
// before the accessor ever sees it.
// -----------------------------------------------------------------------------

const IDENTITY_A = '11111111-1111-4111-8111-111111111111';
const IDENTITY_B = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACCOUNT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const TOKEN_A = 'token-a';
const TOKEN_B = 'token-b';

function session(identityId: string, id: string): AuthSession {
  return {
    id,
    identityId,
    userId: `${identityId}-user`,
    authFactor: 'email_otp',
    elevatedAt: null,
    elevatedByFactor: null,
  };
}

const SESSION_A = session(IDENTITY_A, 'session-a');
const SESSION_B = session(IDENTITY_B, 'session-b');

// -----------------------------------------------------------------------------
// A store that models tenancy, and a recorder of what was asked of it
// -----------------------------------------------------------------------------

interface Call {
  readonly door: 'scoped' | 'firm';
  readonly identityId?: string;
  readonly verb: 'rows' | 'rowsWhere' | 'rowAt';
  readonly key: string;
  readonly address?: unknown;
}

type Row = Record<string, unknown>;

interface World {
  accounts: Row[];
  dailyMarks: Row[];
  ruleStates: Row[];
}

/**
 * The tenancy predicate `scopePredicate` composes, modelled.
 *
 * THIS FUNCTION IS THE FAKE. Every assertion that depends on it is labelled
 * behavioural in the header, and the structural half never reads it.
 */
function ownedBy(world: World, key: string, row: Row, identityId: string): boolean {
  if (key === 'accounts') return row['identityId'] === identityId;
  if (key === 'dailyMarks' || key === 'ruleStates') {
    const account = world.accounts.find((candidate) => candidate['id'] === row['accountId']);
    return account !== undefined && account['identityId'] === identityId;
  }
  throw new Error(`the store has no tenancy rule for \`${key}\`, so the read is not scoped`);
}

/** Equality, plus ADR-157's `at-most`. The store models what the accessor renders. */
function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([column, value]) => {
    if (!isFilterTerm(value)) return row[column] === value;
    if (value.term === 'at-most') return (row[column] as string) <= (value.value as string);
    throw new Error(`the store models no \`${value.term}\` term`);
  });
}

function storeDb(world: World): { db: ApiDb; calls: Call[] } {
  const calls: Call[] = [];

  const visible = (door: 'scoped' | 'firm', key: string, identityId?: string): Row[] => {
    if (door === 'firm') throw new Error('no account read may open the firm door');
    const all = (world as unknown as Record<string, Row[]>)[key] ?? [];
    return all.filter((row) => ownedBy(world, key, row, identityId ?? ''));
  };

  const handle = (door: 'scoped' | 'firm', identityId?: string): unknown => {
    const note = (call: Call): void => {
      calls.push(identityId === undefined ? call : { ...call, identityId });
    };
    return {
      __brand: door === 'scoped' ? 'ScopedTx' : 'FirmTx',
      identityId,
      sqlExecutor: () => {
        throw new Error('no account read may reach for raw SQL');
      },
      rows: (key: string) => {
        note({ door, verb: 'rows', key });
        return Promise.resolve(visible(door, key, identityId));
      },
      rowsWhere: (key: string, where: Record<string, unknown>) => {
        note({ door, verb: 'rowsWhere', key, address: where });
        return Promise.resolve(visible(door, key, identityId).filter((row) => matches(row, where)));
      },
      rowAt: (key: string, at: Record<string, unknown>) => {
        note({ door, verb: 'rowAt', key, address: at });
        return Promise.resolve(visible(door, key, identityId).find((row) => matches(row, at)));
      },
    };
  };

  const db: ApiDb = {
    scoped: <T>(identityId: string, fn: (tx: never) => Promise<T>): Promise<T> =>
      fn(handle('scoped', identityId) as never),
    firm: <T>(fn: (tx: never) => Promise<T>): Promise<T> => fn(handle('firm') as never),
    ...NO_PRE_IDENTITY_DOORS,
  };
  return { db, calls };
}

// -----------------------------------------------------------------------------
// The world. Money is `bigint` cents in every seed, including the fixtures
// -----------------------------------------------------------------------------

function accountRow(id: string, identityId: string): Row {
  return { id, identityId, planVersionId: 'plan-version', phase: 'funded', status: 'active' };
}

function markRow(accountId: string, tradingDay: string, over: Row = {}): Row {
  return {
    id: 1n,
    accountId,
    tradingDay,
    openingBalanceCents: 5_000_000n,
    closingBalanceCents: 5_012_300n,
    highBalanceCents: 5_020_000n,
    lowBalanceCents: 4_990_000n,
    realizedPnlCents: 12_300n,
    tradedDay: true,
    winDay: true,
    supersededBy: null,
    ...over,
  };
}

function ruleStateRow(accountId: string, tradingDay: string, over: Row = {}): Row {
  return {
    id: 1n,
    accountId,
    tradingDay,
    floorCents: 4_900_000n,
    floorOpenCents: 4_800_000n,
    withdrawableCents: 112_300n,
    ...over,
  };
}

const DAYS = ['2026-08-24', '2026-08-25', '2026-08-26'] as const;

function world(): World {
  return {
    accounts: [accountRow(ACCOUNT_A, IDENTITY_A), accountRow(ACCOUNT_B, IDENTITY_B)],
    dailyMarks: [
      ...DAYS.map((day, i) => markRow(ACCOUNT_A, day, { id: BigInt(i + 1) })),
      markRow(ACCOUNT_B, '2026-08-26', { id: 90n, closingBalanceCents: 9_999_999n }),
    ],
    ruleStates: [
      ...DAYS.map((day, i) => ruleStateRow(ACCOUNT_A, day, { id: BigInt(i + 1) })),
      ruleStateRow(ACCOUNT_B, '2026-08-26', { id: 90n }),
    ],
  };
}

// -----------------------------------------------------------------------------
// The harness
// -----------------------------------------------------------------------------

const onDisk = await discoverRouteModules();

async function call(options: {
  path: string;
  token?: string | undefined;
}): Promise<LightMyRequestResponse> {
  const { app } = buildServer({ surface: 'public', modules: onDisk });
  const inject: InjectOptions = { method: 'GET', url: `${BASE_PATH}${options.path}` };
  if (options.token !== undefined)
    inject.headers = { cookie: `${SESSION_COOKIE}=${options.token}` };
  const res = await app.inject(inject);
  await app.close();
  return res;
}

function marksUrl(accountId: string, query = ''): string {
  return `/accounts/${accountId}/marks${query}`;
}

let live: World;

beforeEach(() => {
  live = world();
  useAuthBackend({
    ...UNWIRED_AUTH_BACKEND,
    sessionByToken: (token) =>
      Promise.resolve(token === TOKEN_A ? SESSION_A : token === TOKEN_B ? SESSION_B : null),
  });
});

afterEach(() => {
  resetAuthBackend();
  resetAccountReadsBackend();
});

// -----------------------------------------------------------------------------
// What this module declares, and that the ROUTER holds it
// -----------------------------------------------------------------------------

describe('the four contract rows are declared and REGISTERED', () => {
  test('the module declares exactly section 6 four sub-resource reads', () => {
    const declared = accountReadsModule.routes.map((route) => `${route.method} ${route.path}`);
    expect(declared).toEqual([
      `GET ${MARKS_PATH}`,
      `GET ${TIMELINE_PATH}`,
      `GET ${ELIGIBILITY_PATH}`,
      `GET ${CERTIFICATE_PATH}`,
    ]);
  });

  test('the composed PUBLIC surface registers all four, read from the report', () => {
    // MEASURED FROM THE APPLICATION AND NEVER FROM A GREP. `report.registered`
    // is what the router actually holds after `compose` classified every path
    // and filtered by surface, so this fails if the module is declared and not
    // discovered, or discovered and withheld.
    const { report } = buildServer({ surface: 'public', modules: onDisk });
    expect(report.registered).toContain(`GET ${MARKS_PATH}`);
    expect(report.registered).toContain(`GET ${TIMELINE_PATH}`);
    expect(report.registered).toContain(`GET ${ELIGIBILITY_PATH}`);
    expect(report.registered).toContain(`GET ${CERTIFICATE_PATH}`);
  });

  test('the OPERATOR surface registers none of them, by having nothing there', () => {
    // ADR-083 section 4: a process serves one surface and the other answers 404
    // by absence rather than by a check. None of these paths is under an
    // operator prefix, so all four are withheld from `api-admin`.
    const { report } = buildServer({ surface: 'operator', modules: onDisk });
    for (const path of [MARKS_PATH, TIMELINE_PATH, ELIGIBILITY_PATH, CERTIFICATE_PATH])
      expect(report.registered).not.toContain(`GET ${path}`);
  });

  test('all four declare `session`, and none declares elevation', () => {
    // Section 6 states "Auth: session, owner" on `/eligibility`; "owner" is the
    // accessor's predicate and not a second factor. None of the four is one of
    // section 12's `C-27:` actions.
    expect(ACCOUNT_READS_REQUIRED_FACTORS).toEqual({
      [`GET ${MARKS_PATH}`]: 'session',
      [`GET ${TIMELINE_PATH}`]: 'session',
      [`GET ${ELIGIBILITY_PATH}`]: 'session',
      [`GET ${CERTIFICATE_PATH}`]: 'session',
    });
  });
});

describe('an unauthenticated caller gets 401 on all four, never 403 and never 404', () => {
  test.each([
    ['marks', marksUrl(ACCOUNT_A)],
    ['timeline', `/accounts/${ACCOUNT_A}/timeline`],
    ['eligibility', `/accounts/${ACCOUNT_A}/eligibility`],
    ['certificate', `/accounts/${ACCOUNT_A}/certificate?kind=pass`],
  ])('%s', async (_name, path) => {
    const res = await call({ path });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toMatchObject({
      type: expect.stringContaining('unauthenticated'),
    });
  });
});

// -----------------------------------------------------------------------------
// BOLA. Both halves, and the negative control
// -----------------------------------------------------------------------------

describe('tenancy holds on every read, and the account is resolved FIRST', () => {
  test('STRUCTURAL: A naming B account opens only the scoped door with A identity', async () => {
    const { db, calls } = storeDb(live);
    useAccountReadsBackend(databaseAccountReads(db));
    await call({ path: marksUrl(ACCOUNT_B), token: TOKEN_A });

    expect(calls.every((c) => c.door === 'scoped')).toBe(true);
    expect(calls.every((c) => c.identityId === IDENTITY_A)).toBe(true);
    // AND THE READ STOPS AT THE ACCOUNT. The marks read never runs, so a
    // stranger id costs one addressed read and reaches no mark table at all.
    expect(calls).toEqual([
      {
        door: 'scoped',
        identityId: IDENTITY_A,
        verb: 'rowAt',
        key: 'accounts',
        address: { id: ACCOUNT_B },
      },
    ]);
  });

  test('BEHAVIOURAL: it is 404 `not_found`, not 403 and not B data', async () => {
    const { db } = storeDb(live);
    useAccountReadsBackend(databaseAccountReads(db));
    const res = await call({ path: marksUrl(ACCOUNT_B), token: TOKEN_A });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toMatchObject({ type: expect.stringContaining('not_found') });
    expect(res.body).not.toContain('9999999');
  });

  test('NEGATIVE CONTROL: A naming its OWN account is served', async () => {
    const { db } = storeDb(live);
    useAccountReadsBackend(databaseAccountReads(db));
    const res = await call({ path: marksUrl(ACCOUNT_A), token: TOKEN_A });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data).toHaveLength(3);
  });

  test('B reading its OWN account gets B rows and never A rows', async () => {
    const { db } = storeDb(live);
    useAccountReadsBackend(databaseAccountReads(db));
    const res = await call({ path: marksUrl(ACCOUNT_B), token: TOKEN_B });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: MarkListItem[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.closing_balance_cents).toBe(9_999_999);
  });

  test('the account resolution runs BEFORE the mark read, in that order', async () => {
    const { db, calls } = storeDb(live);
    useAccountReadsBackend(databaseAccountReads(db));
    await call({ path: marksUrl(ACCOUNT_A), token: TOKEN_A });
    expect(calls.map((c) => `${c.verb} ${c.key}`)).toEqual([
      'rowAt accounts',
      'rowsWhere dailyMarks',
      'rowsWhere ruleStates',
    ]);
  });
});

// -----------------------------------------------------------------------------
// `/marks`. The one endpoint served end to end
// -----------------------------------------------------------------------------

describe('`/marks` renders section 6 MarkListItem', () => {
  test('every field, and every money value is a JSON integer of cents', async () => {
    const { db } = storeDb(live);
    useAccountReadsBackend(databaseAccountReads(db));
    const res = await call({ path: marksUrl(ACCOUNT_A), token: TOKEN_A });
    const body = JSON.parse(res.body) as { data: MarkListItem[]; next_cursor: string | null };

    expect(body.data[0]).toEqual({
      trading_day: '2026-08-26',
      opening_balance_cents: 5_000_000,
      closing_balance_cents: 5_012_300,
      high_balance_cents: 5_020_000,
      low_balance_cents: 4_990_000,
      realized_pnl_cents: 12_300,
      traded_day: true,
      win_day: true,
      floor_cents: 4_900_000,
      withdrawable_cents: 112_300,
      corrected: false,
    });
    // Section 1 money rule, asserted over the whole page rather than field by
    // field: a float anywhere in a financial path is the defect, not a typo.
    for (const item of body.data)
      for (const [key, value] of Object.entries(item))
        if (key.endsWith('_cents')) expect(Number.isInteger(value)).toBe(true);
  });

  test('the series is `trading_day` DESCENDING', async () => {
    const { db } = storeDb(live);
    useAccountReadsBackend(databaseAccountReads(db));
    const res = await call({ path: marksUrl(ACCOUNT_A), token: TOKEN_A });
    const body = JSON.parse(res.body) as { data: MarkListItem[] };
    expect(body.data.map((item) => item.trading_day)).toEqual([
      '2026-08-26',
      '2026-08-25',
      '2026-08-24',
    ]);
  });

  test('`floor_cents` is the SURVIVING floor and never `floor_open_cents`', async () => {
    // SD-04 put two floors on the row on purpose and `accounts.ts` names the
    // trap. The seed makes them differ so a transcription that reached for the
    // wrong column cannot pass.
    const { db } = storeDb(live);
    useAccountReadsBackend(databaseAccountReads(db));
    const res = await call({ path: marksUrl(ACCOUNT_A), token: TOKEN_A });
    const body = JSON.parse(res.body) as { data: MarkListItem[] };
    expect(body.data[0]?.floor_cents).toBe(4_900_000);
    expect(res.body).not.toContain('4800000');
  });
});

describe('`corrected`, and the day that has no floor', () => {
  test('a superseded mark marks its DAY and does not appear as its own item', () => {
    // The ruling `projectMarks` states and the pull request reports: one item
    // per day, the CURRENT row, and `corrected` says the day was corrected.
    const snapshot: MarksSnapshot = {
      marks: [
        {
          tradingDay: '2026-08-26',
          openingBalanceCents: 1n,
          closingBalanceCents: 2n,
          highBalanceCents: 3n,
          lowBalanceCents: 0n,
          realizedPnlCents: 1n,
          tradedDay: true,
          winDay: true,
          superseded: true,
        },
        {
          tradingDay: '2026-08-26',
          openingBalanceCents: 1n,
          closingBalanceCents: 99n,
          highBalanceCents: 100n,
          lowBalanceCents: 0n,
          realizedPnlCents: 98n,
          tradedDay: true,
          winDay: true,
          superseded: false,
        },
      ],
      ruleStates: [{ tradingDay: '2026-08-26', floorCents: 5n, withdrawableCents: 6n }],
    };
    const items = projectMarks(snapshot);
    expect(items).toHaveLength(1);
    expect(items[0]?.corrected).toBe(true);
    // The CURRENT balance, never the superseded one Merit no longer asserts.
    expect(items[0]?.closing_balance_cents).toBe(99);
  });

  test('a day with a mark and NO `rule_states` row is OMITTED, never zeroed', () => {
    // `accounts.ts`'s ruling on the same two columns: a zero floor beside a zero
    // withdrawable is a readable, false statement about somebody's money, and a
    // floor of zero on an equity chart is a breach line drawn where none is.
    const snapshot: MarksSnapshot = {
      marks: [
        {
          tradingDay: '2026-08-26',
          openingBalanceCents: 1n,
          closingBalanceCents: 2n,
          highBalanceCents: 3n,
          lowBalanceCents: 0n,
          realizedPnlCents: 1n,
          tradedDay: true,
          winDay: false,
          superseded: false,
        },
      ],
      ruleStates: [],
    };
    expect(projectMarks(snapshot)).toEqual([]);
  });

  test('two CURRENT marks for one day is a refusal, never a guess', () => {
    const one = {
      openingBalanceCents: 1n,
      closingBalanceCents: 2n,
      highBalanceCents: 3n,
      lowBalanceCents: 0n,
      realizedPnlCents: 1n,
      tradedDay: true,
      winDay: true,
      superseded: false,
    };
    const snapshot: MarksSnapshot = {
      marks: [
        { tradingDay: '2026-08-26', ...one },
        { tradingDay: '2026-08-26', ...one },
      ],
      ruleStates: [{ tradingDay: '2026-08-26', floorCents: 5n, withdrawableCents: 6n }],
    };
    expect(() => projectMarks(snapshot)).toThrow(AccountReadsRowError);
    expect(() => projectMarks(snapshot)).toThrow(/nothing supersedes/);
  });
});

// -----------------------------------------------------------------------------
// Pagination. Section 1 rule, and ADR-157 range term on the read path
// -----------------------------------------------------------------------------

describe('cursor pagination, `{ data, next_cursor }`', () => {
  const items = (...days: string[]): readonly MarkListItem[] =>
    days.map((trading_day) => ({
      trading_day,
      opening_balance_cents: 0,
      closing_balance_cents: 0,
      high_balance_cents: 0,
      low_balance_cents: 0,
      realized_pnl_cents: 0,
      traded_day: false,
      win_day: false,
      floor_cents: 0,
      withdrawable_cents: 0,
      corrected: false,
    }));

  test('`next_cursor` is the first day NOT on this page', () => {
    expect(pageOf(items('c', 'b', 'a'), 2)).toEqual({
      data: [
        expect.objectContaining({ trading_day: 'c' }),
        expect.objectContaining({ trading_day: 'b' }),
      ],
      next_cursor: 'a',
    });
  });

  test('`next_cursor` is `null` on the last page and never an empty string', () => {
    expect(pageOf(items('c', 'b'), 25).next_cursor).toBeNull();
  });

  test('the cursor is INCLUSIVE and the next page starts where the last stopped', async () => {
    const { db } = storeDb(live);
    useAccountReadsBackend(databaseAccountReads(db));
    const first = await call({ path: marksUrl(ACCOUNT_A, '?limit=2'), token: TOKEN_A });
    const firstBody = JSON.parse(first.body) as {
      data: MarkListItem[];
      next_cursor: string | null;
    };
    expect(firstBody.data.map((i) => i.trading_day)).toEqual(['2026-08-26', '2026-08-25']);
    expect(firstBody.next_cursor).toBe('2026-08-24');

    const second = await call({
      path: marksUrl(ACCOUNT_A, `?limit=2&cursor=${String(firstBody.next_cursor)}`),
      token: TOKEN_A,
    });
    const secondBody = JSON.parse(second.body) as {
      data: MarkListItem[];
      next_cursor: string | null;
    };
    expect(secondBody.data.map((i) => i.trading_day)).toEqual(['2026-08-24']);
    expect(secondBody.next_cursor).toBeNull();
  });

  test('the cursor reaches the accessor as ADR-157 `at-most` term on BOTH tables', async () => {
    // The range term is on the READ PATH only and this is where it is used. Both
    // halves carry the same bound, so the join cannot see a floor for a day
    // whose mark the bound cut.
    const { db, calls } = storeDb(live);
    useAccountReadsBackend(databaseAccountReads(db));
    await call({ path: marksUrl(ACCOUNT_A, '?cursor=2026-08-25'), token: TOKEN_A });
    const filters = calls
      .filter((c) => c.verb === 'rowsWhere')
      .map((c) => c.address as Record<string, unknown>);
    expect(filters).toHaveLength(2);
    for (const filter of filters) {
      expect(filter['accountId']).toBe(ACCOUNT_A);
      expect(isFilterTerm(filter['tradingDay'])).toBe(true);
      expect(filter['tradingDay']).toEqual(atMost('2026-08-25'));
    }
  });

  test('no cursor reads with NO range term at all, rather than a sentinel bound', async () => {
    const { db, calls } = storeDb(live);
    useAccountReadsBackend(databaseAccountReads(db));
    await call({ path: marksUrl(ACCOUNT_A), token: TOKEN_A });
    for (const c of calls.filter((call) => call.verb === 'rowsWhere'))
      expect(c.address).toEqual({ accountId: ACCOUNT_A });
  });
});

describe('`?limit=` and `?cursor=` are validated, and a bad one is 400 not 500', () => {
  test.each([
    ['zero', '?limit=0'],
    ['above the maximum', `?limit=${String(LIMIT_MAX + 1)}`],
    ['not a number', '?limit=lots'],
    ['not an integer', '?limit=2.5'],
  ])('limit %s is `validation_failed`', async (_name, query) => {
    const { db } = storeDb(live);
    useAccountReadsBackend(databaseAccountReads(db));
    const res = await call({ path: marksUrl(ACCOUNT_A, query), token: TOKEN_A });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { type: string; errors: { path: string }[] };
    expect(body.type).toContain('validation_failed');
    expect(body.errors.map((e) => e.path)).toEqual(['limit']);
  });

  test('a cursor this endpoint never issued is `validation_failed`, not a 500', async () => {
    // Unvalidated it would reach `atMost` and become a `date` comparison against
    // arbitrary text, which is a database error answered 500 where the contract
    // wants 400.
    const { db } = storeDb(live);
    useAccountReadsBackend(databaseAccountReads(db));
    const res = await call({ path: marksUrl(ACCOUNT_A, '?cursor=yesterday'), token: TOKEN_A });
    expect(res.statusCode).toBe(400);
    expect((JSON.parse(res.body) as { errors: { path: string }[] }).errors[0]?.path).toBe('cursor');
  });

  test('a bad `?limit=` on a STRANGER account is still 400 and reads nothing', async () => {
    // The parameter is wrong on its face, so the answer must not depend on a
    // fact the caller is not entitled to. Nothing is read either way.
    const { db, calls } = storeDb(live);
    useAccountReadsBackend(databaseAccountReads(db));
    const res = await call({ path: marksUrl(ACCOUNT_B, '?limit=0'), token: TOKEN_A });
    expect(res.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// `?kind=`, and the three that refuse
// -----------------------------------------------------------------------------

describe('`/certificate` validates `?kind=` before anything is read', () => {
  test.each([
    ['absent', ''],
    ['a third value', '?kind=trophy'],
    ['empty', '?kind='],
  ])('kind %s is `validation_failed`', async (_name, query) => {
    const { db } = storeDb(live);
    useAccountReadsBackend(databaseAccountReads(db));
    const res = await call({ path: `/accounts/${ACCOUNT_A}/certificate${query}`, token: TOKEN_A });
    expect(res.statusCode).toBe(400);
    expect((JSON.parse(res.body) as { errors: { path: string }[] }).errors[0]?.path).toBe('kind');
  });
});

describe('three of the four refuse by NAME and answer 503, never 500 and never a fixture', () => {
  test.each([
    ['timeline', `/accounts/${ACCOUNT_A}/timeline`],
    ['eligibility', `/accounts/${ACCOUNT_A}/eligibility`],
    ['certificate', `/accounts/${ACCOUNT_A}/certificate?kind=payout`],
  ])('%s is 503 `service_unavailable`', async (_name, path) => {
    const { db } = storeDb(live);
    useAccountReadsBackend(databaseAccountReads(db));
    const res = await call({ path, token: TOKEN_A });
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body)).toMatchObject({
      type: expect.stringContaining('service_unavailable'),
    });
  });

  test('the reason names the blocker and NEVER reaches the response', async () => {
    // Section 2: the problem document "never leaks internals". The reason names
    // tables, columns and ADRs and is for the operator log alone.
    const { db } = storeDb(live);
    useAccountReadsBackend(databaseAccountReads(db));
    const res = await call({ path: `/accounts/${ACCOUNT_A}/timeline`, token: TOKEN_A });
    expect(res.body).not.toContain('scope.ts');
    expect(res.body).not.toContain('events');

    await expect(
      databaseAccountReads(db).readTimeline(SESSION_A, ACCOUNT_A, { limit: 25, cursor: null }),
    ).rejects.toThrow(AccountReadsBackendUnwired);
  });

  test.each([
    ['timeline', 'readTimeline', /not a registered table/],
    ['eligibility', 'readEligibility', /lifetimeSettledCents/],
    ['certificate', 'readCertificate', /image_url/],
  ])('the %s blocker is measured, not a shrug', async (_name, method, pattern) => {
    const { db } = storeDb(live);
    const backend = databaseAccountReads(db) as unknown as Record<string, () => Promise<unknown>>;
    await expect(backend[method]?.()).rejects.toThrow(pattern);
  });
});

// -----------------------------------------------------------------------------
// The fail-closed default
// -----------------------------------------------------------------------------

describe('a process that never ran `start.ts` answers 503 on all four', () => {
  test.each([
    ['marks', marksUrl(ACCOUNT_A)],
    ['timeline', `/accounts/${ACCOUNT_A}/timeline`],
    ['eligibility', `/accounts/${ACCOUNT_A}/eligibility`],
    ['certificate', `/accounts/${ACCOUNT_A}/certificate?kind=pass`],
  ])('%s', async (_name, path) => {
    // `resetAccountReadsBackend` in `afterEach` restores the default; nothing is
    // installed here, so this is the shape of a deployable whose wiring is
    // missing. It says so rather than pretending.
    const res = await call({ path, token: TOKEN_A });
    expect(res.statusCode).toBe(503);
  });
});

// -----------------------------------------------------------------------------
// The adapter refuses a row it cannot read as money
// -----------------------------------------------------------------------------

describe('the row readers refuse rather than round', () => {
  test('a `number` in a money column is refused, because precision was already lost', async () => {
    const broken = world();
    broken.dailyMarks = [markRow(ACCOUNT_A, '2026-08-26', { closingBalanceCents: 5012300 })];
    const { db } = storeDb(broken);
    await expect(
      databaseAccountReads(db).readMarks(SESSION_A, ACCOUNT_A, { limit: 25, cursor: null }),
    ).rejects.toThrow(AccountReadsRowError);
  });

  test('a `bigint` handed back as a decimal STRING is accepted, because `pg` does that', async () => {
    const stringy = world();
    stringy.dailyMarks = [markRow(ACCOUNT_A, '2026-08-26', { closingBalanceCents: '5012300' })];
    stringy.ruleStates = [ruleStateRow(ACCOUNT_A, '2026-08-26')];
    const { db } = storeDb(stringy);
    const snapshot = await databaseAccountReads(db).readMarks(SESSION_A, ACCOUNT_A, {
      limit: 25,
      cursor: null,
    });
    expect(snapshot?.marks[0]?.closingBalanceCents).toBe(5_012_300n);
  });
});
