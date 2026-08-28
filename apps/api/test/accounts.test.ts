// =============================================================================
// apps/api/test/accounts.test.ts
// =============================================================================
// EVERY RESPONSE ASSERTION GOES THROUGH FASTIFY'S REAL ROUTER by way of
// `inject`, over the modules discovered from disk, so a route that is declared
// and never registered fails here rather than in production.
//
// -----------------------------------------------------------------------------
// THE BOLA CASE IS WRITTEN IN TWO HALVES AND EACH ONE SAYS WHICH IT IS
// -----------------------------------------------------------------------------
// `db-recorder.ts` already wrote down the honest limit of a fixture in this
// package: it proves "WHICH DOOR was opened, WHOSE IDENTITY was handed to it,
// WHICH TABLE was named, WHAT ADDRESS was written" and proves NOTHING about
// whether the composed predicate reaches one row or many, because "a case here
// that claimed it would be agreeing with its own fake".
//
// So:
//
//   HALF 1, STRUCTURAL, AND THIS PACKAGE'S. Identity A naming identity B's
//   account reaches the SCOPED door opened with A, `rowAt('accounts', { id })`,
//   and nothing else. No firm door, no `sqlExecutor`, no second address. Given
//   that, tenancy is ANDed by `scopePredicate`, which
//   `packages/db/test/keyed-accessor.test.ts` asserts against eight seeded
//   mutations. This half would still fail if the route reached for a wider
//   door, and no store can fake it.
//
//   HALF 2, BEHAVIOURAL, AND IT AGREES WITH ITS OWN FAKE. Over a store that
//   MODELS the AND, the answer is 404 `not_found`: not 403, and not B's data.
//   It is here because the STATUS CODE is a decision this package makes and the
//   contract states twice, and a store cannot fake a 403 into a 404.
//
// THE NEGATIVE CONTROL IS NOT OPTIONAL, on `DELTA_MANIFEST` section 13's
// lesson: an adapter that returned `undefined` for every address would pass
// both halves above and every other refusal case in this file. Identity A
// naming its OWN account returns the account.
// =============================================================================

import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import type { ApiDb } from '../src/db.ts';
import { BASE_PATH, buildServer, discoverRouteModules, RouteRegistryError } from '../src/index.ts';
import accountsModule, {
  ACCOUNT_PATH,
  ACCOUNTS_PATH,
  ACCOUNTS_REQUIRED_FACTORS,
  AccountsBackendUnwired,
  currentKycState,
  databaseAccountsBackend,
  floorDistanceCents,
  kycRequired,
  latestByAccount,
  resetAccountsBackend,
  useAccountsBackend,
  type AccountProgress,
  type AccountsSnapshot,
  type RuleStateRow,
} from '../src/routes/accounts.ts';
import {
  resetAuthBackend,
  SESSION_COOKIE,
  UNWIRED_AUTH_BACKEND,
  useAuthBackend,
  type AuthSession,
} from '../src/routes/auth.ts';
import { RESET_PATH } from '../src/routes/checkout.ts';
import { defineRoutes } from '../src/registry.ts';
import { NO_PRE_IDENTITY_DOORS } from './db-recorder.ts';

// -----------------------------------------------------------------------------
// Two identities, and every id below is a uuid because `db.ts` refuses anything
// else before the accessor ever sees it.
// -----------------------------------------------------------------------------

const IDENTITY_A = '11111111-1111-4111-8111-111111111111';
const IDENTITY_B = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACCOUNT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PLAN_VERSION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PLAN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

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
  ruleStates: Row[];
  kycVerifications: Row[];
  planVersions: Row[];
  plans: Row[];
}

/** `plans` and `planVersions` are `class: 'firm'`; nothing else here is. */
const FIRM_KEYS = new Set(['plans', 'planVersions']);

/**
 * The tenancy predicate `scopePredicate` composes, modelled.
 *
 * THIS FUNCTION IS THE FAKE. Every assertion that depends on it is labelled
 * behavioural above, and the structural half never reads it.
 */
function ownedBy(world: World, key: string, row: Row, identityId: string): boolean {
  if (key === 'accounts' || key === 'kycVerifications') return row['identityId'] === identityId;
  if (key === 'ruleStates') {
    const account = world.accounts.find((candidate) => candidate['id'] === row['accountId']);
    return account !== undefined && account['identityId'] === identityId;
  }
  throw new Error(`the store has no tenancy rule for \`${key}\`, so the read is not scoped`);
}

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([column, value]) => row[column] === value);
}

function storeDb(world: World): { db: ApiDb; calls: Call[] } {
  const calls: Call[] = [];

  const visible = (door: 'scoped' | 'firm', key: string, identityId?: string): Row[] => {
    const all = (world as unknown as Record<string, Row[]>)[key] ?? [];
    if (door === 'firm') {
      if (!FIRM_KEYS.has(key))
        throw new Error(`\`${key}\` is not a FirmTableKey; the firm door cannot name it`);
      return all;
    }
    if (FIRM_KEYS.has(key))
      throw new Error(`\`${key}\` is firm; the scoped door has no predicate for it`);
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
        throw new Error('no accounts read may reach for raw SQL');
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
// The world. Money is `bigint` cents in every seed, including the fixtures.
// -----------------------------------------------------------------------------

function accountRow(id: string, identityId: string, over: Row = {}): Row {
  return {
    id,
    identityId,
    userId: `${identityId}-user`,
    purchaseId: `${id}-purchase`,
    planVersionId: PLAN_VERSION,
    sizeCents: 5_000_000n,
    phase: 'funded',
    status: 'active',
    platform: 'rithmic',
    platformAccountRef: 'RITH-1',
    feed: 'rithmic',
    frontEndPermissions: ['ninjatrader'],
    openedOn: '2026-06-01',
    fundedOn: '2026-07-01',
    closedOn: null,
    closeReason: null,
    payoutsFrozen: false,
    reconBlocked: false,
    ...over,
  };
}

function ruleStateRow(accountId: string, tradingDay: string, over: Row = {}): Row {
  return {
    id: 1n,
    accountId,
    tradingDay,
    phase: 'funded',
    floorCents: 4_900_000n,
    floorOpenCents: 4_800_000n,
    balanceCents: 5_123_400n,
    withdrawableCents: 223_400n,
    ...over,
  };
}

function world(): World {
  return {
    accounts: [accountRow(ACCOUNT_A, IDENTITY_A), accountRow(ACCOUNT_B, IDENTITY_B)],
    ruleStates: [
      ruleStateRow(ACCOUNT_A, '2026-08-25', { id: 10n }),
      ruleStateRow(ACCOUNT_A, '2026-08-26', { id: 11n, balanceCents: 5_200_000n }),
      ruleStateRow(ACCOUNT_B, '2026-08-26', { id: 12n, balanceCents: 9_999_999n }),
    ],
    kycVerifications: [
      {
        id: 'kyc-a',
        identityId: IDENTITY_A,
        state: 'verified',
        supersedes: null,
      },
    ],
    planVersions: [
      { id: PLAN_VERSION, planId: PLAN, version: 3, publicSlug: 'core-eod-v3', rules: {} },
    ],
    plans: [{ id: PLAN, code: 'core_eod', name: 'Core EOD', isActive: true }],
  };
}

const NO_PROGRESS: AccountProgress = {
  profit_target_cents: null,
  profit_cents: null,
  buffer_cents: 100_000,
  buffer_progress_cents: 23_400,
  win_days: { have: 3, need: 5, floor_cents: 10_000 },
  traded_days: { have: 12, need: 10 },
  consistency: { best_day_share_bp: 3_400, max_bp: 4_000, skipped: false },
  cadence: { days_since_last_payout: null, need: 14, next_eligible_trading_day: null },
  ladder: { payouts_settled: 0, payouts_to_graduate: 5 },
};

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
  resetAccountsBackend();
});

// -----------------------------------------------------------------------------
// What this module declares, and what it deliberately does not
// -----------------------------------------------------------------------------

describe('the module declares section 6 two reads and nothing else', () => {
  test('both endpoints declare `session`, and neither declares elevation', () => {
    // Section 6: "Auth: session". Reading your own dashboard is not one of
    // section 12's `C-27:` actions, so a second factor here would put a passkey
    // in front of the page a compromised account's owner loads to SEE that
    // something is wrong.
    expect(ACCOUNTS_REQUIRED_FACTORS).toEqual({
      [`GET ${ACCOUNTS_PATH}`]: 'session',
      [`GET ${ACCOUNT_PATH}`]: 'session',
    });
  });

  test('it declares neither `POST /accounts/:accountId` nor the reset', () => {
    // `POST /accounts/:accountId` is not in API_CONTRACT at all, and the reset
    // belongs to `routes/checkout.ts`. ADR-139 section 1.
    const declared = accountsModule.routes.map((route) => `${route.method} ${route.path}`);
    expect(declared).toEqual([`GET ${ACCOUNTS_PATH}`, `GET ${ACCOUNT_PATH}`]);
    expect(declared).not.toContain(`POST ${ACCOUNT_PATH}`);
    expect(declared).not.toContain(`POST ${RESET_PATH}`);
  });

  test('declaring the reset here a second time is a STARTUP FAILURE, not a conflict', () => {
    // The executable form of ADR-139 finding 2. `compose` refuses a duplicate
    // `METHOD /path` across the module set, so an `accounts.ts` that had
    // transcribed the reset would take the deployable down on boot rather than
    // shadow checkout's handler.
    const wouldHaveBeen = defineRoutes({
      name: 'accounts-with-reset',
      routes: [{ method: 'POST', path: RESET_PATH, handler: () => undefined }],
    });
    expect(() => buildServer({ surface: 'public', modules: [...onDisk, wouldHaveBeen] })).toThrow(
      RouteRegistryError,
    );
    expect(() => buildServer({ surface: 'public', modules: [...onDisk, wouldHaveBeen] })).toThrow(
      /checkout/,
    );
  });
});

describe('an unauthenticated caller gets 401 on both, never 403 and never 404', () => {
  test('the list', async () => {
    const res = await call({ path: ACCOUNTS_PATH });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ code: string }>().code).toBe('unauthenticated');
  });

  test('the detail', async () => {
    // Section 12: "Unauthenticated request to any `/accounts/*` -> 401". The
    // 404 is for a caller who HAS a session and names somebody else's row.
    const res = await call({ path: `/accounts/${ACCOUNT_B}` });
    expect(res.statusCode).toBe(401);
  });
});

// -----------------------------------------------------------------------------
// THE BOLA CASE
// -----------------------------------------------------------------------------

describe('BOLA: identity A naming identity B account', () => {
  test('HALF 1, STRUCTURAL: the scoped door with A, `rowAt(accounts,{id:B})`, nothing else', async () => {
    const { db, calls } = storeDb(live);
    useAccountsBackend(databaseAccountsBackend(db));

    await call({ path: `/accounts/${ACCOUNT_B}`, token: TOKEN_A });

    // The whole record of what this package asked the accessor for. One call,
    // one door, one key, one address.
    expect(calls).toEqual([
      {
        door: 'scoped',
        identityId: IDENTITY_A,
        verb: 'rowAt',
        key: 'accounts',
        address: { id: ACCOUNT_B },
      },
    ]);
    // Never the firm door for a row that carries an owner, and never raw SQL.
    expect(calls.some((entry) => entry.door === 'firm')).toBe(false);
    // The address was not widened past the primary key, so `scopePredicate`'s
    // AND is the only thing bounding the read.
    expect(Object.keys(calls[0]?.address as object)).toEqual(['id']);
  });

  test('HALF 2, BEHAVIOURAL, and it agrees with its own fake: 404, not 403, not B data', async () => {
    const { db } = storeDb(live);
    useAccountsBackend(databaseAccountsBackend(db));

    const res = await call({ path: `/accounts/${ACCOUNT_B}`, token: TOKEN_A });

    expect(res.statusCode).toBe(404);
    expect(res.statusCode).not.toBe(403);
    const body = res.json<{ code: string; detail?: string }>();
    expect(body.code).toBe('not_found');
    // B's balance is 9,999,999 cents in the world above and appears nowhere.
    expect(res.body).not.toContain('9999999');
    expect(res.body).not.toContain(IDENTITY_B);
  });

  test('THE NEGATIVE CONTROL: A naming its OWN account is served', async () => {
    // Without this, an adapter that returned `undefined` for every address
    // would pass both halves above.
    const { db } = storeDb(live);
    useAccountsBackend({
      ...databaseAccountsBackend(db),
      readProgress: () => Promise.resolve(NO_PROGRESS),
    });

    const res = await call({ path: `/accounts/${ACCOUNT_A}`, token: TOKEN_A });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ account_id: string }>().account_id).toBe(ACCOUNT_A);
  });

  test('the SAME id served for its owner is refused for the stranger, on one world', async () => {
    // The pair, on one store and one seed, which is what makes it an
    // authorization statement rather than two unrelated responses.
    const { db } = storeDb(live);
    useAccountsBackend({
      ...databaseAccountsBackend(db),
      readProgress: () => Promise.resolve(NO_PROGRESS),
    });

    const mine = await call({ path: `/accounts/${ACCOUNT_B}`, token: TOKEN_B });
    const theirs = await call({ path: `/accounts/${ACCOUNT_B}`, token: TOKEN_A });

    expect(mine.statusCode).toBe(200);
    expect(theirs.statusCode).toBe(404);
  });
});

// -----------------------------------------------------------------------------
// `GET /accounts`, served end to end
// -----------------------------------------------------------------------------

describe('GET /accounts', () => {
  test('returns only the caller own accounts, with the money off ONE rule_states row', async () => {
    const { db, calls } = storeDb(live);
    useAccountsBackend(databaseAccountsBackend(db));

    const res = await call({ path: ACCOUNTS_PATH, token: TOKEN_A });

    expect(res.statusCode).toBe(200);
    const items = res.json<
      Array<{
        account_id: string;
        balance_cents: number;
        floor_cents: number;
        floor_distance_cents: number;
        withdrawable_cents: number;
        as_of_trading_day: string;
        size_cents: number;
        plan: { plan_id: string; code: string; name: string; version: number };
        phase: string;
        status: string;
        blocked: { payouts_frozen: boolean; recon_blocked: boolean; kyc_required: boolean };
      }>
    >();

    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item?.account_id).toBe(ACCOUNT_A);
    // The LATEST day, 2026-08-26, and its balance rather than the 25th's.
    expect(item?.as_of_trading_day).toBe('2026-08-26');
    expect(item?.balance_cents).toBe(5_200_000);
    expect(item?.floor_cents).toBe(4_900_000);
    // "balance - floor, the number traders actually watch."
    expect(item?.floor_distance_cents).toBe(300_000);
    expect(item?.withdrawable_cents).toBe(223_400);
    expect(item?.size_cents).toBe(5_000_000);
    expect(item?.plan).toEqual({
      plan_id: PLAN,
      code: 'core_eod',
      name: 'Core EOD',
      version: 3,
    });
    expect(item?.blocked).toEqual({
      payouts_frozen: false,
      recon_blocked: false,
      kyc_required: false,
    });

    // The catalogue is read through the FIRM door and the trader rows through
    // the SCOPED one, which is what `scope.ts` classes them as.
    expect(calls.filter((entry) => entry.door === 'scoped').map((entry) => entry.key)).toEqual([
      'accounts',
      'ruleStates',
      'kycVerifications',
    ]);
    expect(calls.filter((entry) => entry.door === 'firm').map((entry) => entry.key)).toEqual([
      'planVersions',
      'plans',
    ]);
    // Every scoped call carried the caller identity and no other.
    expect(new Set(calls.filter((c) => c.door === 'scoped').map((c) => c.identityId))).toEqual(
      new Set([IDENTITY_A]),
    );
  });

  test('EVERY money field is a JSON integer, which is section 1 rule', async () => {
    const { db } = storeDb(live);
    useAccountsBackend(databaseAccountsBackend(db));
    const res = await call({ path: ACCOUNTS_PATH, token: TOKEN_A });
    const raw = JSON.parse(res.body) as Array<Record<string, unknown>>;
    for (const [field, value] of Object.entries(raw[0] ?? {})) {
      if (!field.endsWith('_cents')) continue;
      expect(Number.isInteger(value)).toBe(true);
      expect(String(value)).not.toContain('.');
    }
  });

  test('the response is an ALLOWLIST: a column added to the row does not appear', async () => {
    // Section 1 API3 control. `accounts.graduation_eligible` is a real column
    // and is a review-pool flag 0007 forbids showing a trader at all.
    live.accounts[0] = accountRow(ACCOUNT_A, IDENTITY_A, {
      graduationEligible: true,
      terminalSettlementId: 'settlement-1',
      userId: 'a-login-nobody-asked-for',
    });
    const { db } = storeDb(live);
    useAccountsBackend(databaseAccountsBackend(db));

    const res = await call({ path: ACCOUNTS_PATH, token: TOKEN_A });

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('graduation');
    expect(res.body).not.toContain('settlement');
    expect(res.body).not.toContain('a-login-nobody-asked-for');
    expect(Object.keys(res.json<Record<string, unknown>[]>()[0] ?? {}).sort()).toEqual([
      'account_id',
      'as_of_trading_day',
      'balance_cents',
      'blocked',
      'floor_cents',
      'floor_distance_cents',
      'phase',
      'plan',
      'size_cents',
      'status',
      'withdrawable_cents',
    ]);
  });

  test('an account with no mark is OMITTED rather than rendered at zero', async () => {
    // A zero balance beside a zero floor is a readable, false statement about
    // money: it reads as an account sitting exactly on its breach line.
    live.ruleStates = live.ruleStates.filter((row) => row['accountId'] !== ACCOUNT_A);
    const { db } = storeDb(live);
    useAccountsBackend(databaseAccountsBackend(db));

    const res = await call({ path: ACCOUNTS_PATH, token: TOKEN_A });

    expect(res.statusCode).toBe(200);
    expect(res.json<unknown[]>()).toEqual([]);
    expect(res.body).not.toContain('"balance_cents":0');
  });

  test('`kyc_required` is true for anything but `verified`, and for no row at all', async () => {
    live.kycVerifications = [];
    const { db } = storeDb(live);
    useAccountsBackend(databaseAccountsBackend(db));
    const res = await call({ path: ACCOUNTS_PATH, token: TOKEN_A });
    expect(res.json<Array<{ blocked: { kyc_required: boolean } }>>()[0]?.blocked.kyc_required).toBe(
      true,
    );
  });

  test('the list is NOT taken down by `readProgress` refusal', async () => {
    // The asymmetry the two port methods exist for: `GET /accounts` needs no
    // plan parameter and no calendar, so it serves while the detail refuses.
    const { db } = storeDb(live);
    useAccountsBackend(databaseAccountsBackend(db));
    const list = await call({ path: ACCOUNTS_PATH, token: TOKEN_A });
    const detail = await call({ path: `/accounts/${ACCOUNT_A}`, token: TOKEN_A });
    expect(list.statusCode).toBe(200);
    expect(detail.statusCode).toBe(503);
  });
});

// -----------------------------------------------------------------------------
// `GET /accounts/:accountId`, and the block it refuses
// -----------------------------------------------------------------------------

describe('GET /accounts/:accountId', () => {
  test('the detail carries section 6 extra fields and the rules path', async () => {
    const { db } = storeDb(live);
    useAccountsBackend({
      ...databaseAccountsBackend(db),
      readProgress: () => Promise.resolve(NO_PROGRESS),
    });

    const res = await call({ path: `/accounts/${ACCOUNT_A}`, token: TOKEN_A });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      platform: string;
      platform_account_ref: string | null;
      front_end_permissions: string[];
      opened_on: string;
      funded_on: string | null;
      closed_on: string | null;
      close_reason: string | null;
      rules_url: string;
      progress: AccountProgress;
      balance_cents: number;
    }>();
    expect(body.platform).toBe('rithmic');
    expect(body.platform_account_ref).toBe('RITH-1');
    expect(body.front_end_permissions).toEqual(['ninjatrader']);
    expect(body.opened_on).toBe('2026-06-01');
    expect(body.funded_on).toBe('2026-07-01');
    expect(body.closed_on).toBeNull();
    expect(body.close_reason).toBeNull();
    // PG-M9-03: a child of the version own address, so a superseded version
    // rules page inherits its parent permanence.
    expect(body.rules_url).toBe('/plans/core-eod-v3/rules');
    expect(body.progress).toEqual(NO_PROGRESS);
    // Every list field is still here: `AccountDetail extends AccountListItem`.
    expect(body.balance_cents).toBe(5_200_000);
  });

  test('the database adapter REFUSES `progress` by name, and 503 says so without saying why', async () => {
    const { db } = storeDb(live);
    useAccountsBackend(databaseAccountsBackend(db));

    const res = await call({ path: `/accounts/${ACCOUNT_A}`, token: TOKEN_A });

    expect(res.statusCode).toBe(503);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('service_unavailable');
    // Section 2: a problem document "never leaks internals". The reason names
    // tables, a package and two ADRs, and none of it reaches the wire.
    expect(res.body).not.toContain('rules-engine');
    expect(res.body).not.toContain('trading_calendar');
    expect(res.body).not.toContain('ADR-139');
  });

  test('the refusal carries BOTH blockers, for the operator who reads a log', async () => {
    const { db } = storeDb(live);
    const refusal = await databaseAccountsBackend(db)
      .readProgress(SESSION_A, {
        accountId: ACCOUNT_A,
        planVersionId: PLAN_VERSION,
        sizeCents: 1n,
        phase: 'funded',
        status: 'active',
        platform: 'rithmic',
        platformAccountRef: null,
        frontEndPermissions: [],
        openedOn: '2026-06-01',
        fundedOn: null,
        closedOn: null,
        closeReason: null,
        payoutsFrozen: false,
        reconBlocked: false,
      })
      .catch((err: unknown) => err);

    expect(refusal).toBeInstanceOf(AccountsBackendUnwired);
    const reason = (refusal as AccountsBackendUnwired).reason;
    expect(reason).toContain('rules-engine');
    expect(reason).toContain('trading_calendar');
  });

  test('the account is resolved BEFORE progress, so a stranger id is 404 and not 503', async () => {
    // Reversed, every id would answer 503 and a real id answering 503 while a
    // stranger id answered 404 would be the existence oracle section 1 forbids.
    const { db } = storeDb(live);
    useAccountsBackend(databaseAccountsBackend(db));

    const stranger = await call({ path: `/accounts/${ACCOUNT_B}`, token: TOKEN_A });
    const nobody = await call({
      path: '/accounts/99999999-9999-4999-8999-999999999999',
      token: TOKEN_A,
    });
    const mine = await call({ path: `/accounts/${ACCOUNT_A}`, token: TOKEN_A });

    expect(stranger.statusCode).toBe(404);
    expect(nobody.statusCode).toBe(404);
    // The one that exists and IS the caller reaches the refusal, which is the
    // only difference between them and it is not an existence signal about
    // anybody else.
    expect(mine.statusCode).toBe(503);
  });

  test('an account with no mark is 404 rather than a detail with zeroed money', async () => {
    live.ruleStates = [];
    const { db } = storeDb(live);
    useAccountsBackend({
      ...databaseAccountsBackend(db),
      readProgress: () => Promise.resolve(NO_PROGRESS),
    });
    const res = await call({ path: `/accounts/${ACCOUNT_A}`, token: TOKEN_A });
    expect(res.statusCode).toBe(404);
  });
});

// -----------------------------------------------------------------------------
// The folds, named directly
// -----------------------------------------------------------------------------

describe('the folds', () => {
  const row = (accountId: string, tradingDay: string, balanceCents: bigint): RuleStateRow => ({
    accountId,
    tradingDay,
    balanceCents,
    floorCents: 0n,
    withdrawableCents: 0n,
  });

  test('the latest day wins, and a BACKFILLED row with a higher id does not', () => {
    // `rule_states.id` is GENERATED ALWAYS AS IDENTITY and ascends with INSERT
    // order, so a recomputed earlier day is inserted last. Comparing ids would
    // show the trader a stale balance and call it today.
    // BOTH ORDERINGS, because the accessor declares none. A fold that kept the
    // first row it saw passes one of these and is wrong on the other, and the
    // backfill is precisely the case that arrives in the losing order.
    const backfillLast = latestByAccount([
      row(ACCOUNT_A, '2026-08-26', 200n),
      row(ACCOUNT_A, '2026-08-20', 100n),
    ]);
    const backfillFirst = latestByAccount([
      row(ACCOUNT_A, '2026-08-20', 100n),
      row(ACCOUNT_A, '2026-08-26', 200n),
    ]);
    for (const latest of [backfillLast, backfillFirst]) {
      expect(latest.get(ACCOUNT_A)?.tradingDay).toBe('2026-08-26');
      expect(latest.get(ACCOUNT_A)?.balanceCents).toBe(200n);
    }
  });

  test('accounts do not bleed into each other', () => {
    const latest = latestByAccount([
      row(ACCOUNT_A, '2026-08-20', 100n),
      row(ACCOUNT_B, '2026-08-26', 900n),
    ]);
    expect(latest.get(ACCOUNT_A)?.balanceCents).toBe(100n);
    expect(latest.get(ACCOUNT_B)?.balanceCents).toBe(900n);
  });

  test('the floor distance is signed `bigint` arithmetic, and it goes negative', () => {
    expect(floorDistanceCents(5_200_000n, 4_900_000n)).toBe(300_000n);
    // Between a breach and the status write, an account IS below its floor.
    expect(floorDistanceCents(4_800_000n, 4_900_000n)).toBe(-100_000n);
  });

  test('`kycRequired` blocks on every member but `verified`', () => {
    expect(kycRequired('verified')).toBe(false);
    for (const state of ['kyc_required', 'pending', 'rejected', 'expired'] as const)
      expect(kycRequired(state)).toBe(true);
  });

  test('the live verification is the one nothing supersedes, not the last row read', () => {
    // SD-M19-01: a re-verification is a NEW row. The chain head is a property
    // of the rows and never of an ordering the table does not declare.
    expect(
      currentKycState([
        { id: 'new', identityId: IDENTITY_A, state: 'verified', supersedes: 'old' },
        { id: 'old', identityId: IDENTITY_A, state: 'expired', supersedes: null },
      ]),
    ).toBe('verified');
    // Reversed in the array, which is what an unordered read returns.
    expect(
      currentKycState([
        { id: 'old', identityId: IDENTITY_A, state: 'expired', supersedes: null },
        { id: 'new', identityId: IDENTITY_A, state: 'verified', supersedes: 'old' },
      ]),
    ).toBe('verified');
  });

  test('no row, and an unresolvable chain, both fail CLOSED', () => {
    expect(currentKycState([])).toBe('kyc_required');
    // Two heads: reporting either as the answer would be asserting somebody is
    // verified on the strength of an ordering nothing declares.
    expect(
      currentKycState([
        { id: 'one', identityId: IDENTITY_A, state: 'verified', supersedes: null },
        { id: 'two', identityId: IDENTITY_A, state: 'verified', supersedes: null },
      ]),
    ).toBe('kyc_required');
  });
});

// -----------------------------------------------------------------------------
// The fail-closed default
// -----------------------------------------------------------------------------

describe('a process that never ran its wiring', () => {
  test('answers 503 on both routes and names no backend in the body', async () => {
    resetAccountsBackend();
    const list = await call({ path: ACCOUNTS_PATH, token: TOKEN_A });
    const detail = await call({ path: `/accounts/${ACCOUNT_A}`, token: TOKEN_A });
    expect(list.statusCode).toBe(503);
    expect(detail.statusCode).toBe(503);
    expect(list.json<{ code: string }>().code).toBe('service_unavailable');
    expect(list.body).not.toContain('start.ts');
  });

  test('the snapshot type is what the port returns, and the route reads no other shape', () => {
    // A compile-time statement written as a value so it is executed rather than
    // asserted about: the handler reads exactly these four members.
    const snapshot: AccountsSnapshot = {
      accounts: [],
      ruleStates: [],
      plans: [],
      kycState: 'kyc_required',
    };
    expect(Object.keys(snapshot).sort()).toEqual(['accounts', 'kycState', 'plans', 'ruleStates']);
  });
});
