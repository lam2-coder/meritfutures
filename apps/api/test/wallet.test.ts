// =============================================================================
// apps/api/test/wallet.test.ts
// =============================================================================
// EVERY RESPONSE ASSERTION GOES THROUGH FASTIFY'S REAL ROUTER by way of
// `inject`, over the modules discovered from disk, so a route that is declared
// and never registered fails here rather than in production. The registration
// figures below are read off `CompositionReport` rather than off a grep, which
// this repository has had wrong twice.
//
// -----------------------------------------------------------------------------
// WHAT THIS SUITE PROVES AND WHAT IT CANNOT, STATED BEFORE THE FIRST CASE
// -----------------------------------------------------------------------------
// `db-recorder.ts` wrote down the honest limit of a fixture in this package: it
// proves WHICH DOOR was opened, WHOSE IDENTITY was handed to it and WHICH TABLE
// was named, and proves NOTHING about whether the composed predicate reaches one
// row or many, because "a case here that claimed it would be agreeing with its
// own fake". That half is `packages/db/test/keyed-accessor.test.ts`'s.
//
// So the tenancy case here is STRUCTURAL: the wallet reads open the SCOPED door
// with the identity the SESSION resolved to, name `walletEntries`, and reach for
// no firm door and no `sqlExecutor`. Given that, `scopePredicate` is ANDed by
// the accessor, and this case would still fail if the route reached wider.
//
// -----------------------------------------------------------------------------
// THE TWO CASES WORTH THE MOST ARE THE TWO ORDERINGS, AND BOTH ARE SEEDED SO
// THAT THE WRONG IMPLEMENTATION IS GREEN WITHOUT THEM
// -----------------------------------------------------------------------------
//   1. THE BALANCE IS `max(id)` AND NOT `max(occurred_at)`. Every fixture in
//      which entries are appended in business order passes under both readings.
//      `backdated()` builds the one world where they disagree, and the reading
//      the route must not take renders a stale balance.
//   2. THE TIE-BREAK IS A `bigint` COMPARISON AND NOT A LEXICAL ONE. Ids 9 and
//      10 at one instant order 10, 9 numerically and 9, 10 as strings, and every
//      statement with fewer than ten entries passes under both.
// =============================================================================

import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import type { ApiDb } from '../src/db.ts';
import { BASE_PATH, buildServer, discoverRouteModules } from '../src/index.ts';
import { defineRoutes } from '../src/registry.ts';
import {
  resetAuthBackend,
  SESSION_COOKIE,
  UNWIRED_AUTH_BACKEND,
  useAuthBackend,
  type AuthSession,
} from '../src/routes/auth.ts';
import walletModule, {
  balanceOf,
  centsToJson,
  databaseWalletBackend,
  decodeCursor,
  encodeCursor,
  ENTRIES_DEFAULT_LIMIT,
  ENTRIES_MAX_LIMIT,
  holdsToday,
  isAfter,
  newestFirst,
  projectEntry,
  renderEntries,
  renderWallet,
  resetWalletBackend,
  toWalletEntryRow,
  useWalletBackend,
  WALLET_ENTRIES_PATH,
  WALLET_PATH,
  WALLET_REQUIRED_FACTORS,
  WalletBackendUnwired,
  WalletMoneyError,
  WalletRowError,
  type WalletEntry,
} from '../src/routes/wallet.ts';
import { NO_PRE_IDENTITY_DOORS } from './db-recorder.ts';

// -----------------------------------------------------------------------------
// Two identities. Every id is a uuid because `db.ts` refuses anything else
// before the accessor ever sees it.
// -----------------------------------------------------------------------------

const IDENTITY_A = '11111111-1111-4111-8111-111111111111';
const IDENTITY_B = '22222222-2222-4222-8222-222222222222';
const LEDGER_TX = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PAYOUT_REF = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const TOKEN_A = 'token-a';

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

// -----------------------------------------------------------------------------
// Rows, as the accessor hands them over: camelCase, `bigint` money, `Date`
// instants. Money is `bigint` cents in every seed and there is no float here
// -----------------------------------------------------------------------------

type Row = Record<string, unknown>;

function entryRow(over: Row = {}): Row {
  return {
    id: 1n,
    identityId: IDENTITY_A,
    direction: 'credit',
    amountCents: 50_000n,
    provenance: 'payout',
    cause: 'payout settled',
    referenceId: PAYOUT_REF,
    ledgerTransactionId: LEDGER_TX,
    balanceAfterCents: 50_000n,
    occurredAt: new Date('2026-08-01T00:00:00.000Z'),
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    ...over,
  };
}

/** A statement in business order: the last appended is also the latest. */
function ordinary(): Row[] {
  return [
    entryRow({ id: 1n, balanceAfterCents: 50_000n, occurredAt: new Date('2026-08-01T00:00:00Z') }),
    entryRow({
      id: 2n,
      direction: 'debit',
      amountCents: 20_000n,
      cause: 'reset purchase',
      balanceAfterCents: 30_000n,
      occurredAt: new Date('2026-08-02T00:00:00Z'),
    }),
    entryRow({
      id: 3n,
      amountCents: 5_000n,
      provenance: 'correction',
      cause: 'operator correction',
      balanceAfterCents: 35_000n,
      occurredAt: new Date('2026-08-03T00:00:00Z'),
    }),
  ];
}

/**
 * THE WORLD WHERE THE TWO READINGS DISAGREE.
 *
 * Entry 2 was appended last and carries the running balance; entry 1's
 * `occurred_at` is LATER, which a correction or a backfill makes ordinary. The
 * balance is 30,000 and `max(occurred_at)` would say 90,000.
 */
function backdated(): Row[] {
  return [
    entryRow({ id: 1n, balanceAfterCents: 90_000n, occurredAt: new Date('2026-08-09T00:00:00Z') }),
    entryRow({
      id: 2n,
      provenance: 'correction',
      cause: 'correcting an entry booked to the wrong month',
      balanceAfterCents: 30_000n,
      occurredAt: new Date('2026-08-04T00:00:00Z'),
    }),
  ];
}

// -----------------------------------------------------------------------------
// A store that models tenancy, and a recorder of what was asked of it
// -----------------------------------------------------------------------------

interface Call {
  readonly door: 'scoped' | 'firm';
  readonly identityId?: string;
  readonly verb: string;
  readonly key: string;
}

function storeDb(rows: Row[]): { db: ApiDb; calls: Call[] } {
  const calls: Call[] = [];
  const handle = (door: 'scoped' | 'firm', identityId?: string): unknown => {
    // `accounts.test.ts`'s shape: the key is ABSENT on the firm door rather than
    // present and undefined, which `exactOptionalPropertyTypes` makes a distinction.
    const note = (of: Call): void => {
      calls.push(identityId === undefined ? of : { ...of, identityId });
    };
    return {
      __brand: door === 'scoped' ? 'ScopedTx' : 'FirmTx',
      identityId,
      sqlExecutor: () => {
        throw new Error('no wallet read may reach for raw SQL');
      },
      rows: (key: string) => {
        note({ door, verb: 'rows', key });
        if (door === 'firm')
          throw new Error('`walletEntries` is owned; the firm door has no predicate for it');
        // The tenancy predicate the accessor composes, modelled.
        return Promise.resolve(rows.filter((row) => row['identityId'] === identityId));
      },
      rowsWhere: (key: string) => {
        note({ door, verb: 'rowsWhere', key });
        return Promise.resolve([]);
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

const PINNED = new Date('2026-08-27T12:00:00.000Z');

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

/** Install a backend over a seeded statement. Returns the recorder's calls. */
function wire(rows: Row[]): Call[] {
  const { db, calls } = storeDb(rows);
  useWalletBackend(databaseWalletBackend(db, () => PINNED));
  return calls;
}

beforeEach(() => {
  useAuthBackend({
    ...UNWIRED_AUTH_BACKEND,
    sessionByToken: (token) => Promise.resolve(token === TOKEN_A ? SESSION_A : null),
  });
});

afterEach(() => {
  resetAuthBackend();
  resetWalletBackend();
});

// -----------------------------------------------------------------------------
// What this module declares, and where it is served
// -----------------------------------------------------------------------------

describe('the module declares section 6.2 and nothing else', () => {
  test('two routes, both GET, both a single session factor', () => {
    expect(walletModule.name).toBe('wallet');
    expect(walletModule.routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      `GET ${WALLET_PATH}`,
      `GET ${WALLET_ENTRIES_PATH}`,
    ]);
    // Section 6.2: "Auth: session, owner." A single factor, and elevation is
    // `POST /wallet/withdrawals`'s under C-27 rather than this read's.
    expect(WALLET_REQUIRED_FACTORS).toEqual({
      'GET /wallet': 'session',
      'GET /wallet/entries': 'session',
    });
  });

  test('the public surface registers both and the operator surface withholds both', () => {
    const publicReport = buildServer({ surface: 'public', modules: onDisk }).report;
    const operatorReport = buildServer({ surface: 'operator', modules: onDisk }).report;
    for (const endpoint of ['GET /wallet', 'GET /wallet/entries']) {
      expect(publicReport.registered).toContain(endpoint);
      expect(publicReport.withheld).not.toContain(endpoint);
      expect(operatorReport.registered).not.toContain(endpoint);
      expect(operatorReport.withheld).toContain(endpoint);
    }
  });

  test('a second module declaring `GET /wallet` is refused by `compose`', () => {
    // The collision many concurrent route slices make likely, caught at startup
    // rather than merged.
    const wouldHaveBeen = defineRoutes({
      name: 'wallet-duplicate',
      routes: [{ method: 'GET', path: WALLET_PATH, handler: () => ({}) }],
    });
    expect(() => buildServer({ surface: 'public', modules: [...onDisk, wouldHaveBeen] })).toThrow(
      /both declare `GET \/wallet`/,
    );
  });
});

describe('the reads are fail closed before they are anything else', () => {
  test('no session is 401 on both, and never 403', async () => {
    for (const path of [WALLET_PATH, WALLET_ENTRIES_PATH]) {
      const res = await call({ path });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ code: 'unauthenticated' });
    }
  });

  test('an unwired backend is 503 and never a rendered balance', async () => {
    for (const path of [WALLET_PATH, WALLET_ENTRIES_PATH]) {
      const res = await call({ path, token: TOKEN_A });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ code: 'service_unavailable' });
    }
  });

  test('the 503 names the reason, so an incident log says which half is missing', () => {
    expect(new WalletBackendUnwired('readEntries').message).toMatch(
      /WalletBackend.readEntries is not wired/,
    );
    expect(new WalletBackendUnwired('readEntries').message).toMatch(/answers 503/);
  });
});

// -----------------------------------------------------------------------------
// GET /wallet
// -----------------------------------------------------------------------------

describe('GET /wallet renders a balance a trader acts on', () => {
  test('an identity with no entry is 0 and NOT a 404', async () => {
    wire([]);
    const res = await call({ path: WALLET_PATH, token: TOKEN_A });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      balance_cents: 0,
      withdrawable_cents: 0,
      held_cents: 0,
      holds: [],
      as_of: PINNED.toISOString(),
    });
  });

  test('the balance is the stored running balance of the last row APPENDED', async () => {
    wire(ordinary());
    const res = await call({ path: WALLET_PATH, token: TOKEN_A });
    expect(res.json()).toMatchObject({ balance_cents: 35_000 });
  });

  test('THE BALANCE IS `max(id)` AND NOT `max(occurred_at)`', async () => {
    // The seeded disagreement. Reading the latest `occurred_at` renders 90,000,
    // which is the balance before the correction that superseded it.
    wire(backdated());
    const res = await call({ path: WALLET_PATH, token: TOKEN_A });
    expect(res.json()).toMatchObject({ balance_cents: 30_000 });
    expect(balanceOf(backdated().map(toWalletEntryRow))).toBe(30_000n);
  });

  test('`balance_cents` equals `withdrawable_cents + held_cents`', async () => {
    wire(ordinary());
    const body = res_json(await call({ path: WALLET_PATH, token: TOKEN_A }));
    expect(body['withdrawable_cents']).toBe(
      (body['balance_cents'] as number) - (body['held_cents'] as number),
    );
  });

  test('P-3 renders NO hold, because its input is absent and not because it was evaluated', async () => {
    // ADR-158 finding 14: no landed column carries a purchase's chargeback
    // window end. Every row seeded here is a `payout` credit, which is exactly
    // the class P-3 holds, and the response still carries none. THIS CASE IS THE
    // FINDING MADE VISIBLE rather than a behaviour being locked in: it changes
    // the day `DEP-M20-03` lands, and `holdsToday` is the one place it changes.
    wire(ordinary());
    const res = await call({ path: WALLET_PATH, token: TOKEN_A });
    expect(res.json()).toMatchObject({ held_cents: 0, holds: [] });
    expect(holdsToday(ordinary().map(toWalletEntryRow))).toEqual([]);
  });

  test('the response is an allowlist: a column the schema gains does not leak', async () => {
    wire([entryRow({ jurisdictionHint: 'US-DE', internalNote: 'never ship this' })]);
    const res = await call({ path: WALLET_PATH, token: TOKEN_A });
    expect(Object.keys(res.json() as object).sort()).toEqual([
      'as_of',
      'balance_cents',
      'held_cents',
      'holds',
      'withdrawable_cents',
    ]);
  });

  test('STRUCTURAL: the scoped door, the session identity, `walletEntries`, nothing wider', async () => {
    const calls = wire(ordinary());
    await call({ path: WALLET_PATH, token: TOKEN_A });
    expect(calls).toEqual([
      { door: 'scoped', identityId: IDENTITY_A, verb: 'rows', key: 'walletEntries' },
    ]);
  });

  test('NEGATIVE CONTROL: another identity`s rows are not this identity`s balance', async () => {
    // A store that returned every row regardless of the identity would pass the
    // cases above; it does not pass this one.
    wire([entryRow({ id: 7n, identityId: IDENTITY_B, balanceAfterCents: 999_999n })]);
    const res = await call({ path: WALLET_PATH, token: TOKEN_A });
    expect(res.json()).toMatchObject({ balance_cents: 0 });
  });
});

// -----------------------------------------------------------------------------
// GET /wallet/entries
// -----------------------------------------------------------------------------

function res_json(res: LightMyRequestResponse): Record<string, unknown> {
  return res.json() as Record<string, unknown>;
}

function entriesOf(res: LightMyRequestResponse): WalletEntry[] {
  return res_json(res)['data'] as WalletEntry[];
}

describe('GET /wallet/entries is the itemized statement', () => {
  test('ordering is `occurred_at` descending', async () => {
    wire(ordinary());
    const data = entriesOf(await call({ path: WALLET_ENTRIES_PATH, token: TOKEN_A }));
    expect(data.map((e) => e.entry_id)).toEqual(['3', '2', '1']);
  });

  test('THE TIE-BREAK IS A `bigint` COMPARISON AND NOT A LEXICAL ONE', async () => {
    // Two entries at one instant, ids 9 and 10. Descending numerically that is
    // 10 then 9; comparing the decimal STRINGS gives 9 then 10, and every
    // statement shorter than ten entries passes under both readings.
    const shared = new Date('2026-08-05T00:00:00Z');
    wire([
      entryRow({ id: 9n, occurredAt: shared, balanceAfterCents: 10_000n }),
      entryRow({ id: 10n, occurredAt: shared, balanceAfterCents: 20_000n }),
    ]);
    const data = entriesOf(await call({ path: WALLET_ENTRIES_PATH, token: TOKEN_A }));
    expect(data.map((e) => e.entry_id)).toEqual(['10', '9']);
  });

  test('a credit carries `provenance` and a debit carries NO SUCH KEY', async () => {
    wire(ordinary());
    const data = entriesOf(await call({ path: WALLET_ENTRIES_PATH, token: TOKEN_A }));
    const debit = data.find((e) => e.direction === 'debit');
    const credit = data.find((e) => e.direction === 'credit');
    expect(credit).toMatchObject({ provenance: 'correction' });
    // ADR-158 clause 2: the row CARRIES a provenance, `NOT NULL` on every row,
    // and its three members are the credit list. The debit's is discarded rather
    // than rendered, so `'provenance' in debit` is false and not merely null.
    expect(debit).toBeDefined();
    expect('provenance' in (debit as object)).toBe(false);
  });

  test('`entry_id` is a decimal STRING and keeps its digits past `Number.MAX_SAFE_INTEGER`', async () => {
    const huge = 9_007_199_254_740_993n; // 2^53 + 1: not representable as a double
    wire([entryRow({ id: huge })]);
    const data = entriesOf(await call({ path: WALLET_ENTRIES_PATH, token: TOKEN_A }));
    expect(data[0]?.entry_id).toBe('9007199254740993');
    expect(typeof data[0]?.entry_id).toBe('string');
  });

  test('every field section 6.2 declares, and no other', async () => {
    wire([entryRow({ internalNote: 'never ship this' })]);
    const data = entriesOf(await call({ path: WALLET_ENTRIES_PATH, token: TOKEN_A }));
    expect(Object.keys(data[0] as object).sort()).toEqual([
      'amount_cents',
      'balance_after_cents',
      'cause',
      'direction',
      'entry_id',
      'ledger_transaction_id',
      'occurred_at',
      'provenance',
      'reference_id',
    ]);
  });

  test('the cursor walks every entry exactly once, in order, and ends with a null', async () => {
    const rows = [1n, 2n, 3n, 4n, 5n].map((id) =>
      entryRow({
        id,
        balanceAfterCents: BigInt(id) * 1_000n,
        occurredAt: new Date(`2026-08-0${String(id)}T00:00:00Z`),
      }),
    );
    wire(rows);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const suffix: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
      const body = res_json(
        await call({ path: `${WALLET_ENTRIES_PATH}?limit=2${suffix}`, token: TOKEN_A }),
      );
      seen.push(...(body['data'] as WalletEntry[]).map((e) => e.entry_id));
      cursor = body['next_cursor'] as string | null;
      if (cursor === null) break;
    }
    expect(cursor).toBeNull();
    expect(seen).toEqual(['5', '4', '3', '2', '1']);
  });

  test('THE CURSOR WALKS ACROSS ROWS SHARING ONE INSTANT WITHOUT LOSING ONE', async () => {
    // The page boundary falls INSIDE one `occurred_at`, which is the only
    // condition under which `isAfter` reads the id half at all. Ids 9, 10 and 11
    // straddle a power of ten, so a lexical comparison drops entry 9 from the
    // second page and the walk ends one movement short with nothing saying so.
    const shared = new Date('2026-08-05T00:00:00Z');
    wire([9n, 10n, 11n].map((id) => entryRow({ id, occurredAt: shared })));
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const suffix: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
      const body = res_json(
        await call({ path: `${WALLET_ENTRIES_PATH}?limit=2${suffix}`, token: TOKEN_A }),
      );
      seen.push(...(body['data'] as WalletEntry[]).map((e) => e.entry_id));
      cursor = body['next_cursor'] as string | null;
      if (cursor === null) break;
    }
    expect(seen).toEqual(['11', '10', '9']);
    expect(cursor).toBeNull();
  });

  test('the last full page carries a null cursor rather than one more empty page', async () => {
    wire(ordinary());
    const body = res_json(await call({ path: `${WALLET_ENTRIES_PATH}?limit=3`, token: TOKEN_A }));
    expect((body['data'] as unknown[]).length).toBe(3);
    expect(body['next_cursor']).toBeNull();
  });

  test('`limit` above 100 is `validation_failed` and not a clamp', async () => {
    wire(ordinary());
    const res = await call({ path: `${WALLET_ENTRIES_PATH}?limit=101`, token: TOKEN_A });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: 'validation_failed',
      errors: [{ path: 'limit' }],
    });
  });

  test('a cursor this endpoint did not issue is a 400 and NOT a silently empty page', async () => {
    // An empty page for an unreadable cursor is a statement that ends early, and
    // a client cannot tell that from having seen every movement of its money.
    wire(ordinary());
    const res = await call({ path: `${WALLET_ENTRIES_PATH}?cursor=not-a-cursor`, token: TOKEN_A });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'validation_failed', errors: [{ path: 'cursor' }] });
  });

  test('the default page is section 1`s 25', () => {
    expect(ENTRIES_DEFAULT_LIMIT).toBe(25);
    expect(ENTRIES_MAX_LIMIT).toBe(100);
    const rows = Array.from({ length: 30 }, (_, i) =>
      toWalletEntryRow(entryRow({ id: BigInt(i + 1) })),
    );
    const page = renderEntries(rows, { limit: ENTRIES_DEFAULT_LIMIT, cursor: null });
    expect(page.data.length).toBe(25);
    expect(page.next_cursor).not.toBeNull();
  });
});

// -----------------------------------------------------------------------------
// The pieces, named directly
// -----------------------------------------------------------------------------

describe('the cursor is opaque and total', () => {
  test('it round trips', () => {
    const cursor = { occurred_at: '2026-08-03T00:00:00.000Z', entry_id: '42' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  test('a malformed half is refused rather than half read', () => {
    expect(decodeCursor('!!!not base64!!!')).toBeNull();
    expect(
      decodeCursor(Buffer.from('2026-08-03T00:00:00.000Z|', 'utf8').toString('base64url')),
    ).toBeNull();
    expect(decodeCursor(Buffer.from('|42', 'utf8').toString('base64url'))).toBeNull();
    // A non-numeric id would reach `BigInt()` in the tie-break and throw.
    expect(
      decodeCursor(Buffer.from('2026-08-03T00:00:00.000Z|abc', 'utf8').toString('base64url')),
    ).toBeNull();
    // An instant that does not parse is a position no row can sit after.
    expect(decodeCursor(Buffer.from('not-a-date|42', 'utf8').toString('base64url'))).toBeNull();
  });

  test('`isAfter` is strict on both halves, and the id half crosses a power of ten', () => {
    const at = '2026-08-03T00:00:00.000Z';
    const row = toWalletEntryRow(entryRow({ id: 5n, occurredAt: new Date(at) }));
    expect(isAfter(row, { occurred_at: at, entry_id: '5' })).toBe(false);
    expect(isAfter(row, { occurred_at: at, entry_id: '6' })).toBe(true);
    expect(isAfter(row, { occurred_at: '2026-08-02T00:00:00.000Z', entry_id: '1' })).toBe(false);
    // `BigInt()` THROWS ON A NON-NUMERIC ID AND `decodeCursor` IS THE GUARD, so
    // the refusal is asserted where it lives rather than assumed here.
    expect(() => isAfter(row, { occurred_at: at, entry_id: 'not-an-id' })).toThrow(SyntaxError);
    // 9 IS AFTER 10 UNDER THIS ORDER AND BEFORE IT AS A STRING. Without this
    // pair the id half of `isAfter` is satisfied by a lexical comparison.
    const nine = toWalletEntryRow(entryRow({ id: 9n, occurredAt: new Date(at) }));
    expect(isAfter(nine, { occurred_at: at, entry_id: '10' })).toBe(true);
    const eleven = toWalletEntryRow(entryRow({ id: 11n, occurredAt: new Date(at) }));
    expect(isAfter(eleven, { occurred_at: at, entry_id: '10' })).toBe(false);
  });

  test('`newestFirst` is a total order over one instant', () => {
    const at = new Date('2026-08-03T00:00:00Z');
    const a = toWalletEntryRow(entryRow({ id: 2n, occurredAt: at }));
    const b = toWalletEntryRow(entryRow({ id: 11n, occurredAt: at }));
    expect(newestFirst(a, b)).toBeGreaterThan(0);
    expect(newestFirst(b, a)).toBeLessThan(0);
    expect(newestFirst(a, a)).toBe(0);
  });
});

describe('a row that contradicts its own table is a throw and never a rendered figure', () => {
  test('`amount_cents` must be positive: direction carries the sign', () => {
    expect(() => toWalletEntryRow(entryRow({ amountCents: 0n }))).toThrow(WalletRowError);
    expect(() => toWalletEntryRow(entryRow({ amountCents: -1n }))).toThrow(/amount_cents > 0/);
  });

  test('`balance_after_cents` may not be negative', () => {
    expect(() => toWalletEntryRow(entryRow({ balanceAfterCents: -1n }))).toThrow(
      /balance_after_cents >= 0/,
    );
  });

  test('the two closed lists are closed', () => {
    expect(() => toWalletEntryRow(entryRow({ direction: 'reversal' }))).toThrow(/credit \| debit/);
    // `promotional_credit` is the value this list must never gain.
    expect(() => toWalletEntryRow(entryRow({ provenance: 'promotional_credit' }))).toThrow(
      /payout \| refund_wallet_funded \| correction/,
    );
    expect(() => toWalletEntryRow(entryRow({ provenance: 'deposit' }))).toThrow(WalletRowError);
  });

  test('a money column arriving as a `number` is refused rather than coerced', () => {
    expect(() => toWalletEntryRow(entryRow({ amountCents: 50_000 }))).toThrow(/is not a bigint/);
    expect(() => toWalletEntryRow(entryRow({ id: 1 }))).toThrow(/is not a bigint/);
  });

  test('a non-row and a missing instant are both refused', () => {
    expect(() => toWalletEntryRow(null)).toThrow(/not a row/);
    expect(() => toWalletEntryRow(entryRow({ occurredAt: '2026-08-01' }))).toThrow(/not a Date/);
    expect(() => toWalletEntryRow(entryRow({ cause: null }))).toThrow(/not a string/);
  });
});

describe('money crosses the wire as an integer or not at all', () => {
  test('`centsToJson` refuses past `Number.MAX_SAFE_INTEGER` rather than losing digits', () => {
    expect(centsToJson(35_000n)).toBe(35_000);
    expect(() => centsToJson(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(WalletMoneyError);
  });

  test('a balance too large for a JSON integer throws rather than rendering wrong', () => {
    const rows = [toWalletEntryRow(entryRow({ balanceAfterCents: 9_007_199_254_740_993n }))];
    expect(() => renderWallet(rows, PINNED)).toThrow(WalletMoneyError);
  });

  test('the empty statement renders the identity `0 = 0 + 0` rather than an absence', () => {
    // THE `held > balance` GUARD IN `renderWallet` IS NOT EXERCISED BY ANY CASE
    // IN THIS FILE AND THE NAME DOES NOT CLAIM IT IS. `holdsToday` returns an
    // empty array on every input this tree can build, so the only honest way to
    // reach that throw would be to stub a function the module does not inject.
    // It is written for the day the chargeback window lands and it is unwatched
    // until then, which the pull request records rather than this name implying
    // otherwise.
    const wallet = renderWallet([], PINNED);
    expect(wallet).toEqual({
      balance_cents: 0,
      withdrawable_cents: 0,
      held_cents: 0,
      holds: [],
      as_of: PINNED.toISOString(),
    });
  });

  test('`projectEntry` keeps the magnitude a magnitude', () => {
    const debit = projectEntry(toWalletEntryRow(entryRow({ direction: 'debit' })));
    expect(debit.amount_cents).toBe(50_000);
    expect(debit.direction).toBe('debit');
  });
});
