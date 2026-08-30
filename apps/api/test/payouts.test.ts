// =============================================================================
// apps/api/test/payouts.test.ts
// =============================================================================
// CI-02, the `unit` project. THE ROUTE THAT PAYS A TRADER.
//
// -----------------------------------------------------------------------------
// A GUARD THAT REFUSES EVERYTHING PASSES EVERY REFUSAL TEST
// -----------------------------------------------------------------------------
// `DELTA_MANIFEST` section 13 records that lesson and it cost a session once. So
// EVERY refusal below is paired with the one case that ADMITS, from the same
// fixture, and the PAIR is what is asserted:
//
//   a `restricted` identity is refused ... and an `active` one is APPROVED and
//   the `payout_requests` row COMMITS, out of the same store, in the same shape.
//
// The negative control on the whole file is `the honest path`: if the route
// refused everything, or approved nothing, that block goes red first.
//
// -----------------------------------------------------------------------------
// THIS ROUTE NO LONGER POSTS, AND THE `LT-01` ASSERTIONS WERE RETARGETED RATHER
// THAN DELETED. ADR-176
// -----------------------------------------------------------------------------
// ADR-172 clause 2 moved the posting off the request path and ADR-176 applied
// it here, so `PayoutTx` carries no `LedgerTx` and the fixture has nothing to
// record. EVERY ASSERTION THAT WAS MADE ABOUT THE POSTING STILL RUNS: the
// header, the four entries, the two debits summing to `approved_cents`, the
// signs, the zero sum and the `bigint` check all moved into `LT-01 is built and
// never computed`, where they are made over `postTransaction(recorder,
// chart, lt01(...))` directly. Deleting them would have been the weakening;
// they are facts about `lt01` and about `packages/ledger`, and neither moved.
//
// WHAT REPLACES THEM ON THE ROUTE IS THE PROPERTY THAT NOW MATTERS: the
// approval commits the CALLER'S OWN IDEMPOTENCY KEY to the row, because that
// column is the only thing a later door can rebuild the ledger key from.
//
// -----------------------------------------------------------------------------
// `ADR-140`'s WITNESS IS `closed` AND IT HAS ITS OWN CASE
// -----------------------------------------------------------------------------
// `= 'active'` and `<> 'restricted'` differ on exactly one value of
// `identity_status`, so a suite that only drove `restricted` would pass against
// either predicate and would prove nothing about the ruling. The `closed` case
// is the one that discriminates.
//
// -----------------------------------------------------------------------------
// MONEY IS `bigint` CENTS IN EVERY SEED AND EVERY EXPECTATION
// -----------------------------------------------------------------------------
// The wire carries JSON integers per API_CONTRACT section 1, and the only place
// a `number` appears is at that boundary. THERE IS NO FLOAT IN THIS FILE.
//
// EVERY EXPECTED AMOUNT IS DERIVED BY HAND FROM THE PLAN AND CITED, never read
// back out of the engine: a suite that expects whatever `evaluatePayout`
// returned is a suite asserting the engine agrees with itself.
// =============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { stripComments } from '../../../packages/tooling/checks/strip-comments.mjs';

import type {
  BasisPoints,
  Cents,
  EngineGateResults,
  ExternalGates,
  PlanVersionId,
  ResolvedPlan,
  RuleState,
  TradingDay,
} from '@merit/rules-engine';
import { postTransaction, readChart } from '@merit/ledger';
import type { LedgerTx, WriteValues } from '@merit/ledger';

import { BASE_PATH, buildServer, discoverRouteModules } from '../src/index.ts';
import {
  storedKey,
  type IdempotencyRecord,
  type IdempotencyScope,
  type IdempotencyStore,
} from '../src/idempotency.ts';
import {
  SESSION_COOKIE,
  UNWIRED_AUTH_BACKEND,
  resetAuthBackend,
  useAuthBackend,
  type AuthBackend,
  type AuthSession,
} from '../src/routes/auth.ts';
import {
  ESTIMATED_SETTLEMENT,
  HOLD_WINDOW_MS,
  IDENTITY_RESTRICTED,
  PAYOUT_ENDPOINT,
  PAYOUT_NOT_ELIGIBLE,
  PAYOUT_REQUIRED_FACTORS,
  centsFromJson,
  centsToJson,
  gateIdentityStatus,
  lt01,
  minimumAmountHolds,
  resetPayoutBackend,
  usePayoutBackend,
  validatePayoutRequest,
  type HoldFlag,
  type IdentityStatus,
  type PayoutBackend,
  type PayoutListItem,
  type PayoutRequestInsert,
  type PayoutSubject,
  type PayoutTx,
} from '../src/routes/payouts.ts';

// -----------------------------------------------------------------------------
// The plan. CORE-50K, transcribed from M01 Appendix A.1's 50K column.
// -----------------------------------------------------------------------------
// EVERY NUMBER TRACES TO A DOCUMENT and the ones this file's arithmetic depends
// on are named beside them. A number here that cannot be traced is the defect
// this comment exists to make visible.

const day = (iso: string): TradingDay => iso as TradingDay;
const bp = (n: number): BasisPoints => n as BasisPoints;

/** M01 Appendix A.1, the 50K column. Read against `fixtures-in-code.ts`'s copy. */
const CORE_50K: ResolvedPlan = {
  planVersionId: '0199c7a1-0000-7000-8000-000000000001' as PlanVersionId,
  sizeCents: 5_000_000n,
  eval: {
    drawdown: {
      type: 'trailing_eod',
      drawdownCents: 250_000n,
      lock: { enabled: true, atProfitCents: 260_000n, floorAtCents: 5_010_000n },
    },
    dailyLossLimit: { type: 'none' },
    winDayFloorCents: 15_000n,
    profitTargetCents: 300_000n,
    minTradingDays: 1,
    consistency: { enabled: false },
    maxDays: null,
  },
  funded: {
    drawdown: {
      type: 'trailing_eod',
      drawdownCents: 250_000n,
      lock: { enabled: true, atProfitCents: 260_000n, floorAtCents: 5_010_000n },
    },
    dailyLossLimit: { type: 'none' },
    winDayFloorCents: 15_000n,
    minTradingDays: 0,
    winDaysRequiredCount: 5,
    consistency: { enabled: true, maxDayShareBp: bp(3000) },
    bufferCents: 100_000n,
    cadenceGapTradingDays: 5,
    payoutCapSchedule: [{ fromOrdinal: 1, capCents: 150_000n }],
    // CV-15. 10,000c, fixed, never scaled by size.
    minPayoutCents: 10_000n,
    splitBp: bp(9000),
    maxPayouts: 5,
  },
};

/**
 * The withdrawable this fixture stands on. R-35: `max(0, balance - size - buffer)`.
 *
 * 5,300,000c balance - 5,000,000c size - 100,000c buffer = 200,000c, which is
 * ABOVE the ordinal-1 cap of 150,000c on purpose: the default request then
 * clamps on the CAP and `clamp_reason` is attributable, which is what makes the
 * honest path assert something rather than tie.
 */
const WITHDRAWABLE: Cents = 200_000n;
/** R-42, ordinal 1 on CORE-50K's schedule. */
const CAP: Cents = 150_000n;

/** R-44: `trader = ceil(approved * 9000 / 10000)`, `firm = approved - trader`. */
const DEFAULT_APPROVED: Cents = 150_000n;
const DEFAULT_TRADER: Cents = 135_000n;
const DEFAULT_FIRM: Cents = 15_000n;

/** A supplied amount BELOW both limits, so `clamp_reason` is `requested`. */
const SUPPLIED: Cents = 100_000n;
const SUPPLIED_TRADER: Cents = 90_000n;
const SUPPLIED_FIRM: Cents = 10_000n;

const BASIS_DAY = day('2026-11-20');

/** Every engine gate passing, as DO-9 would have stored them on an eligible day. */
function passingEngineGates(): EngineGateResults {
  return {
    tradedDays: { pass: true, skipped: true, have: 3, need: 0 },
    winDays: { pass: true, have: 5, need: 5, floorCents: 15_000n },
    buffer: { pass: true, haveCents: 300_000n, needCents: 100_000n },
    consistency: {
      pass: true,
      skipped: false,
      bestDayShareBp: 1200,
      maxDayShareBp: 3000,
      profitNeededToDiluteCents: 0n,
    },
    cadenceGap: {
      pass: true,
      skipped: true,
      tradingDaysSinceLastPayout: null,
      need: 5,
      nextEligibleTradingDay: null,
    },
    minimumAmount: {
      pass: true,
      withdrawableCents: WITHDRAWABLE,
      capCents: CAP,
      minPayoutCents: 10_000n,
    },
  };
}

/**
 * A stored `rule_states` row for a funded account that qualifies.
 *
 * THE ENGINE GATES ARE STORED AND ARE NOT RECOMPUTED HERE, which is the engine's
 * own rule: "`state.engineGates` was computed at DO-9 against the last closed
 * day ... Recomputing here would give this function a second, subtly different
 * answer to a question DO-9 already answered." So the fixture supplies the row
 * the batch would have written.
 */
function eligibleState(over: Partial<RuleState> = {}): RuleState {
  return {
    tradingDay: BASIS_DAY,
    phase: 'funded',
    balanceCents: 5_300_000n,
    floorOpenCents: 5_050_000n,
    floorCents: 5_050_000n,
    floorLocked: true,
    highWaterBalanceCents: 5_300_000n,
    withdrawableCents: WITHDRAWABLE,
    tradedDaysCount: 3,
    winDaysCount: 5,
    consistencyBestDayCents: 36_000n,
    consistencyPeriodProfitCents: 300_000n,
    consistencyPeriodStartDay: day('2026-11-09'),
    payoutsSettledCount: 0,
    payoutAnchorDay: null,
    cadenceAnchorDay: null,
    lifetimeSettledCents: 0n,
    engineGates: passingEngineGates(),
    engineEligible: true,
    breached: false,
    breachKind: null,
    engineVersion: 'test-engine',
    ...over,
  };
}

/** R-40's four context gates, all clear. Resolved by the CALLER, never replayed. */
function clearGates(over: Partial<ExternalGates> = {}): ExternalGates {
  return {
    accountStatus: 'active',
    kycState: 'verified',
    payoutsFrozen: false,
    reconBlocked: false,
    hasPayoutInFlight: false,
    ...over,
  };
}

// -----------------------------------------------------------------------------
// The fixture
// -----------------------------------------------------------------------------

const IDENTITY = '0199c7a1-1111-7000-8000-000000000001';
const OTHER_IDENTITY = '0199c7a1-1111-7000-8000-000000000002';
const ACCOUNT = '0199c7a1-2222-7000-8000-000000000001';
/** An account of OTHER_IDENTITY. This handle can never see it. */
const FOREIGN_ACCOUNT = '0199c7a1-2222-7000-8000-000000000002';
const TOKEN = 'session-token-252';

const SESSION: AuthSession = {
  id: '0199c7a1-3333-7000-8000-000000000001',
  identityId: IDENTITY,
  userId: '0199c7a1-4444-7000-8000-000000000001',
  authFactor: 'passkey',
  elevatedAt: null,
  elevatedByFactor: null,
};

/** `ledger_accounts`, as `0009` declares them, for the two parties `LT-01` touches. */
const CHART_ROWS: readonly WriteValues[] = [
  { id: 'acct-withdrawable', code: 'trader_withdrawable', scope: 'identity', identityId: IDENTITY },
  { id: 'acct-wallet', code: 'trader_wallet', scope: 'identity', identityId: IDENTITY },
  { id: 'acct-fees', code: 'fees_revenue', scope: 'firm', identityId: null },
];

interface Fixture {
  identityStatus: IdentityStatus;
  subjects: Map<string, PayoutSubject>;
  holdFlag: HoldFlag | null;
  gates: ExternalGates;
  state: RuleState;
  /** COMMITTED rows only. A rolled-back transaction leaves nothing here. */
  requests: PayoutRequestInsert[];
  list: PayoutListItem[];
  keys: Map<string, IdempotencyRecord & { readonly owner: string }>;
}

let fixture: Fixture;

function freshFixture(): Fixture {
  const state = eligibleState();
  const gates = clearGates();
  return {
    identityStatus: 'active',
    subjects: new Map([[ACCOUNT, { accountId: ACCOUNT, state, plan: CORE_50K, gates }]]),
    holdFlag: null,
    gates,
    state,
    requests: [],
    list: [],
    keys: new Map(),
  };
}

/** The subject map is rebuilt whenever a case moves the state or the gates. */
function reseedSubject(): void {
  fixture.subjects = new Map([
    [ACCOUNT, { accountId: ACCOUNT, state: fixture.state, plan: CORE_50K, gates: fixture.gates }],
  ]);
}

/**
 * A `LedgerTx` over the staging arrays.
 *
 * IT IS A RECORDER AND NOT A LEDGER, and what it can prove is bounded by that:
 * which accounts a posting named, in which direction, for how much. It proves
 * NOTHING about the zero-sum trigger or `LEDGER-C1` at COMMIT, which are the
 * database's and are asserted in `packages/ledger`'s own suite. A suite that
 * claimed otherwise would be asserting a fact about a database it never opens.
 */
function ledgerOver(writes: Array<{ key: string; values: WriteValues }>): LedgerTx {
  return {
    rows: (key) => Promise.resolve(key === 'ledgerAccounts' ? [...CHART_ROWS] : []),
    insert: (key, values) => {
      writes.push({ key, values });
      return Promise.resolve([{ id: `${key}-${String(writes.length)}` }]);
    },
  };
}

/**
 * The transaction, with a STAGING copy that is merged only if the handler
 * returns.
 *
 * THIS IS THE FIXTURE'S LOAD-BEARING PART. A fake that wrote straight through
 * would pass every happy-path assertion and would silently make "a refused
 * payout writes no `payout_requests` row" unfalsifiable.
 */
const backend: PayoutBackend = {
  transact: async <T>(_session: AuthSession, fn: (tx: PayoutTx) => Promise<T>): Promise<T> => {
    const stagedRequests = [...fixture.requests];
    // THE HANDLE HAS FOUR MEMBERS AND NOT FIVE, AND THAT IS ADR-176 ASSERTED BY
    // THE TYPE. A fixture that still supplied a `ledger` would not compile, so
    // "this route posts nothing" is a compile-time property here rather than a
    // count this file has to remember to check.
    const tx: PayoutTx = {
      identityStatus: () => Promise.resolve(fixture.identityStatus),
      subject: (accountId) => Promise.resolve(fixture.subjects.get(accountId) ?? null),
      holdFlag: () => Promise.resolve(fixture.holdFlag),
      insertPayoutRequest: (row) => {
        stagedRequests.push(row);
        return Promise.resolve({ eligibilitySnapshotId: `snap-${row.id}` });
      },
    };
    const value = await fn(tx);
    fixture.requests = stagedRequests;
    return value;
  },
  listPayouts: () => Promise.resolve(fixture.list),
  idempotency: {
    find: (scope: IdempotencyScope, key: string) => {
      const held = fixture.keys.get(key);
      if (held === undefined) return Promise.resolve(null);
      // THE SCOPE IS THE WHOLE CONTROL. `idempotency_keys.key` is the PRIMARY
      // KEY and carries no identity, so one caller's token can hold a row
      // another caller cannot see. A scoped find returns nothing there, which
      // is a denial rather than a disclosure.
      const owner = scope.kind === 'identity' ? scope.identityId : '';
      return Promise.resolve(held.owner === owner ? held : null);
    },
    begin: (scope: IdempotencyScope, record: IdempotencyRecord) => {
      if (fixture.keys.has(record.key)) return Promise.resolve('exists' as const);
      const owner = scope.kind === 'identity' ? scope.identityId : '';
      fixture.keys.set(record.key, { ...record, owner });
      return Promise.resolve('inserted' as const);
    },
    complete: (_scope: IdempotencyScope, key: string, status: number, body) => {
      const held = fixture.keys.get(key);
      if (held !== undefined)
        fixture.keys.set(key, { ...held, responseStatus: status, responseBody: body });
      return Promise.resolve();
    },
  } satisfies IdempotencyStore,
};

const AUTH_FIXTURE: AuthBackend = {
  ...UNWIRED_AUTH_BACKEND,
  sessionByToken: (token: string) => Promise.resolve(token === TOKEN ? SESSION : null),
};

const onDisk = await discoverRouteModules();

let keyCounter = 0;
function nextKey(): string {
  keyCounter += 1;
  return `idem-252-${String(keyCounter)}`;
}

async function call(options: {
  method: 'GET' | 'POST';
  path: string;
  token?: string | undefined;
  payload?: object | undefined;
  idempotencyKey?: string | null | undefined;
}): Promise<LightMyRequestResponse> {
  const { app } = buildServer({ surface: 'public', modules: onDisk });
  const inject: InjectOptions = { method: options.method, url: `${BASE_PATH}${options.path}` };
  const headers: Record<string, string> = {};
  if (options.token !== undefined) headers['cookie'] = `${SESSION_COOKIE}=${options.token}`;
  if (options.method === 'POST' && options.idempotencyKey !== null)
    headers['idempotency-key'] = options.idempotencyKey ?? nextKey();
  inject.headers = headers;
  if (options.payload !== undefined) inject.payload = options.payload;
  const res = await app.inject(inject);
  await app.close();
  return res;
}

/**
 * The client's token on the honest path, named so the ROW can be asserted
 * against it. `nextKey()` is fine everywhere the key is only a token; it is not
 * fine where the assertion is that this exact value survived into the column.
 */
const DEFAULT_KEY = 'idem-honest-path';

function requestPayout(
  over: {
    account?: string;
    payload?: object | undefined;
    idempotencyKey?: string | null | undefined;
  } = {},
): Promise<LightMyRequestResponse> {
  return call({
    method: 'POST',
    path: `/accounts/${over.account ?? ACCOUNT}/payout`,
    token: TOKEN,
    payload: over.payload,
    idempotencyKey: over.idempotencyKey,
  });
}

beforeEach(() => {
  fixture = freshFixture();
  useAuthBackend(AUTH_FIXTURE);
  usePayoutBackend(backend);
});

afterEach(() => {
  resetAuthBackend();
  resetPayoutBackend();
});

// -----------------------------------------------------------------------------
// THE ADMISSION. Everything below it is a refusal measured against this.
// -----------------------------------------------------------------------------

describe('the honest path: an eligible trader is approved and the request commits', () => {
  it('approves at the cap, splits 9000bp, and stores the key a later door must post under', async () => {
    const res = await requestPayout({ idempotencyKey: DEFAULT_KEY });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('approved');
    expect(body.hold).toBeNull();
    expect(body.amount_supplied).toBe(false);

    // R-43 with no amount supplied: `effective = min(withdrawable, cap)`, and
    // the cap binds STRICTLY below the withdrawable, so the reason is `cap`.
    expect(body.requested_cents).toBe(centsToJson(DEFAULT_APPROVED));
    expect(body.approved_cents).toBe(centsToJson(DEFAULT_APPROVED));
    expect(body.clamp_reason).toBe('cap');

    // R-44 and INV-M5-03. The legs sum EXACTLY.
    expect(body.trader_cents).toBe(centsToJson(DEFAULT_TRADER));
    expect(body.firm_cents).toBe(centsToJson(DEFAULT_FIRM));
    expect(body.split_bp).toBe(9000);
    expect(BigInt(body.trader_cents) + BigInt(body.firm_cents)).toBe(DEFAULT_APPROVED);

    expect(body.basis_trading_day).toBe(BASIS_DAY);
    expect(body.payout_ordinal).toBe(1);
    expect(body.estimated_settlement).toEqual(ESTIMATED_SETTLEMENT);
    expect(body.eligibility_snapshot_id).toBe(`snap-${String(body.payout_request_id)}`);

    // The row committed.
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.requests[0]?.status).toBe('approved');
    expect(fixture.requests[0]?.approvedCents).toBe(DEFAULT_APPROVED);
    expect(fixture.requests[0]?.hold).toBeNull();

    // `INV-M5-06` SURVIVES THE MOVE ONLY IF THE KEY IS ON THE ROW, and this is
    // where that is checked. ADR-176 moved the `LT-01` posting to a system
    // authority, and the driver has nowhere but `payout_requests.idempotency_key`
    // to rebuild the ledger key from. It is stored UNPREFIXED, because the
    // column is the client's token and `payout_requests_account_idempotency_uq`
    // is `(account_id, idempotency_key)`; the `PAYOUT_ENDPOINT` prefix belongs
    // to the ledger key the doors compose.
    expect(fixture.requests[0]?.idempotencyKey).toBe(DEFAULT_KEY);
    expect(fixture.requests[0]?.idempotencyKey).not.toContain(PAYOUT_ENDPOINT);
  });

  it('honours a supplied amount as a CEILING and clamps for the reason `requested`', async () => {
    const res = await requestPayout({ payload: { amount_cents: centsToJson(SUPPLIED) } });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.amount_supplied).toBe(true);
    expect(body.approved_cents).toBe(centsToJson(SUPPLIED));
    expect(body.clamp_reason).toBe('requested');
    expect(body.trader_cents).toBe(centsToJson(SUPPLIED_TRADER));
    expect(body.firm_cents).toBe(centsToJson(SUPPLIED_FIRM));
  });

  it('refuses a supplied amount ABOVE the maximum by clamping it down, never up', async () => {
    const res = await requestPayout({ payload: { amount_cents: 9_999_999 } });

    expect(res.statusCode).toBe(200);
    // "The client's `amount_cents` can only ever REDUCE the payout, never
    // increase it" (API_CONTRACT section 6).
    expect(res.json().approved_cents).toBe(centsToJson(DEFAULT_APPROVED));
    expect(res.json().clamp_reason).toBe('cap');
  });
});

// -----------------------------------------------------------------------------
// `ADR-140`. The identity-status door, and its witness.
// -----------------------------------------------------------------------------

describe('ADR-140: the identity-status term of G-ELIGIBLE is a named refusal', () => {
  for (const status of ['restricted', 'closed'] as const) {
    it(`refuses a \`${status}\` identity with identity_restricted and writes nothing`, async () => {
      fixture.identityStatus = status;
      const res = await requestPayout();

      expect(res.statusCode).toBe(422);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.json().code).toBe(IDENTITY_RESTRICTED);
      expect(res.json().detail).toContain(status);

      // IT IS NEVER EXPRESSED AS A GATE RESULT. No breakdown, no snapshot, no row.
      expect(res.json().gates).toBeUndefined();
      expect(fixture.requests).toHaveLength(0);
    });
  }

  it('evaluates the door BEFORE the account is read, so an absent account still answers 422', async () => {
    // The placement is the ruling. INV-M5-23's argument one refusal over:
    // "Nothing about the account is read, because reading it is the act being
    // refused." A `404` here would mean the account was resolved first.
    fixture.identityStatus = 'restricted';
    const res = await requestPayout({ account: FOREIGN_ACCOUNT });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe(IDENTITY_RESTRICTED);
  });

  it('admits `active` and only `active`', () => {
    expect(gateIdentityStatus('active')).toBeNull();
    expect(gateIdentityStatus('restricted')).not.toBeNull();
    expect(gateIdentityStatus('closed')).not.toBeNull();
  });
});

// -----------------------------------------------------------------------------
// Ownership: 404 on the write, zero rows on the read
// -----------------------------------------------------------------------------

describe('an identity naming another identity resource', () => {
  it('gets 404 for an account it does not own, and the owner gets 200 for the same shape', async () => {
    const foreign = await requestPayout({ account: FOREIGN_ACCOUNT });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().code).toBe('not_found');
    expect(fixture.requests).toHaveLength(0);

    // The paired admission, from the same store: the route is not simply
    // refusing every account id it is handed.
    const owned = await requestPayout();
    expect(owned.statusCode).toBe(200);
  });

  it('gets ZERO rows from GET /payouts, and the owner gets their own', async () => {
    // The list is what the SCOPED handle returned. `OTHER_IDENTITY`'s rows are
    // not withheld by this route, they are unreachable through this handle,
    // which is what makes it a tenancy property rather than a filter.
    fixture.list = [];
    const empty = await call({ method: 'GET', path: '/payouts', token: TOKEN });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual([]);

    fixture.list = [
      {
        payout_request_id: 'pr-1',
        account_id: ACCOUNT,
        approved_cents: centsToJson(DEFAULT_APPROVED),
        trader_cents: centsToJson(DEFAULT_TRADER),
        status: 'settled',
        approved_at: '2026-11-20T12:00:00.000Z',
        settled_at: '2026-11-22T12:00:00.000Z',
        hold: null,
        timeline: [{ state: 'approved', at: '2026-11-20T12:00:00.000Z' }],
        failure_note: null,
      },
    ];
    const owned = await call({ method: 'GET', path: '/payouts', token: TOKEN });
    expect(owned.statusCode).toBe(200);
    expect(owned.json()).toHaveLength(1);
    expect(owned.json()[0].account_id).toBe(ACCOUNT);
    expect(owned.json()[0].payout_request_id).toBe('pr-1');
  });

  it('refuses both routes to an anonymous caller with 401 and never 403', async () => {
    expect((await call({ method: 'GET', path: '/payouts' })).statusCode).toBe(401);
    const posted = await call({
      method: 'POST',
      path: `/accounts/${ACCOUNT}/payout`,
      payload: {},
    });
    expect(posted.statusCode).toBe(401);
  });
});

// -----------------------------------------------------------------------------
// The gate breakdown, and G-CLAMP's second clause
// -----------------------------------------------------------------------------

describe('payout_not_eligible carries the FULL breakdown', () => {
  it('refuses an ineligible account and names the gate that failed', async () => {
    const gates = passingEngineGates();
    fixture.state = eligibleState({
      engineEligible: false,
      engineGates: { ...gates, winDays: { pass: false, have: 2, need: 5, floorCents: 15_000n } },
    });
    reseedSubject();

    const res = await requestPayout();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe(PAYOUT_NOT_ELIGIBLE);
    expect(res.json().gates.win_days).toEqual({
      pass: false,
      have: 2,
      need: 5,
      floor_cents: 15_000,
    });
    // The paired half: the OTHER gates still report their true verdicts, so the
    // breakdown is a breakdown rather than a blanket refusal.
    expect(res.json().gates.account_active.pass).toBe(true);
    expect(res.json().gates.kyc_verified).toEqual({ pass: true, state: 'verified' });
    expect(res.json().gates.minimum_amount.pass).toBe(true);
    expect(fixture.requests).toHaveLength(0);
  });

  it('reports a CONTEXT gate failure through the same breakdown', async () => {
    fixture.gates = clearGates({ payoutsFrozen: true });
    reseedSubject();

    const res = await requestPayout();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe(PAYOUT_NOT_ELIGIBLE);
    expect(res.json().gates.not_frozen).toEqual({ pass: false, reason: 'payouts_frozen' });
  });

  it('fails `minimum_amount` when a SUPPLIED amount clamps below the floor', async () => {
    // G-CLAMP's second clause, which the ENGINE gate cannot see: it is computed
    // at day advance over `min(withdrawable, cap)` and has never seen the
    // caller's amount. API_CONTRACT section 6: "never a partial payment and
    // never a denial."
    const res = await requestPayout({ payload: { amount_cents: 5_000 } });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe(PAYOUT_NOT_ELIGIBLE);
    expect(res.json().gates.minimum_amount).toEqual({
      pass: false,
      withdrawable_cents: centsToJson(WITHDRAWABLE),
      min_payout_cents: 10_000,
    });
    expect(fixture.requests).toHaveLength(0);

    // The paired admission: one cent above the floor and the same route pays.
    const paid = await requestPayout({ payload: { amount_cents: 10_000 } });
    expect(paid.statusCode).toBe(200);
    expect(paid.json().approved_cents).toBe(10_000);
  });
});

// -----------------------------------------------------------------------------
// G-NO-IN-FLIGHT
// -----------------------------------------------------------------------------

describe('one payout in flight per account', () => {
  it('answers 409 conflict, which is not a gate result, and pays when nothing is in flight', async () => {
    fixture.gates = clearGates({ hasPayoutInFlight: true });
    reseedSubject();

    const blocked = await requestPayout();
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('conflict');
    // R-38 is reported on its own field and has NO cell in `gates`, so a
    // breakdown here would be this route inventing one.
    expect(blocked.json().gates).toBeUndefined();
    expect(fixture.requests).toHaveLength(0);

    fixture.gates = clearGates();
    reseedSubject();
    expect((await requestPayout()).statusCode).toBe(200);
  });
});

// -----------------------------------------------------------------------------
// G-HOLD-REQUIRED. A hold is a 200 and it posts NOTHING.
// -----------------------------------------------------------------------------

describe('the hold path (ADR-040, INV-M5-21)', () => {
  /** The client's token on the hold path, named for the same reason `DEFAULT_KEY` is. */
  const HELD_KEY = 'idem-hold-path';

  const FLAG: HoldFlag = {
    flagId: '0199c7a1-5555-7000-8000-000000000001',
    tosClause: 'ToS 7.3',
    reason: 'An unresolved review stands against this account.',
  };

  it('holds with a 200, populates every money field, and POSTS NOTHING', async () => {
    fixture.holdFlag = FLAG;
    const res = await requestPayout({ idempotencyKey: HELD_KEY });

    // "A hold is a 200 carrying `held_pending_review`, not an error." Returning
    // a 422 would put a state with a clock into the vocabulary of a refusal.
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('held_pending_review');

    // EVERY MONEY FIELD IS POPULATED, because the decision is computed and
    // frozen at request time and release re-evaluates nothing (INV-M5-02).
    expect(body.approved_cents).toBe(centsToJson(DEFAULT_APPROVED));
    expect(body.trader_cents).toBe(centsToJson(DEFAULT_TRADER));
    expect(body.firm_cents).toBe(centsToJson(DEFAULT_FIRM));
    expect(body.payout_ordinal).toBe(1);

    expect(body.hold.tos_clause).toBe('ToS 7.3');
    const held = Date.parse(String(body.hold.held_at));
    const resolves = Date.parse(String(body.hold.resolves_by));
    // 48 WALL-CLOCK hours. Merit computes nothing in business days (ADR-042).
    expect(resolves - held).toBe(HOLD_WINDOW_MS);

    // `INV-M5-21` AT REQUEST TIME IS NOW A PROPERTY OF THE STATUS COLUMN,
    // BECAUSE NOTHING POSTS HERE AT ALL (ADR-176). The ledger stays the
    // discriminator between `held_pending_review` and `frozen`, and the
    // discrimination is made by the system-authority driver ADR-172 section 5
    // names, which must select on `status = 'approved'`. THIS SUITE CANNOT
    // ASSERT THAT DRIVER, because it does not exist yet, and saying so here is
    // the honest version of the assertion that used to stand on this line.
    // What IS asserted is the input that driver reads.
    expect(fixture.requests[0]?.status).toBe('held_pending_review');
    expect(fixture.requests[0]?.idempotencyKey).toBe(HELD_KEY);

    // SD-M5-08: all five hold columns together or none.
    const row = fixture.requests[0];
    expect(row?.status).toBe('held_pending_review');
    expect(row?.hold?.holdFlagId).toBe(FLAG.flagId);
    expect(row?.hold?.holdTosClause).toBe('ToS 7.3');
    expect(row?.hold?.holdReason).toBe(FLAG.reason);
  });

  it('and without the flag the identical request approves, with no hold columns', async () => {
    // THE PAIR IS STILL A PAIR. What discriminates the two rows is `status` and
    // the five hold columns, which is what a request-time transaction decides
    // now that no posting happens on either branch.
    fixture.holdFlag = null;
    const res = await requestPayout();
    expect(res.json().status).toBe('approved');
    expect(res.json().hold).toBeNull();
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.requests[0]?.status).toBe('approved');
    expect(fixture.requests[0]?.hold).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// Idempotency, which section 1 makes REQUIRED here
// -----------------------------------------------------------------------------

describe('Idempotency-Key', () => {
  it('is required, and its absence is a validation_failed rather than a silent run', async () => {
    const res = await requestPayout({ idempotencyKey: null });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('validation_failed');
    expect(res.json().errors[0].path).toBe('Idempotency-Key');
    expect(fixture.requests).toHaveLength(0);
  });

  it('replays the original response VERBATIM rather than re-evaluating', async () => {
    const key = 'idem-replay';
    const first = await requestPayout({ idempotencyKey: key });
    expect(first.statusCode).toBe(200);

    // The state moves underneath the retry. A route that re-evaluated would
    // answer with the NEW number, which is "how a trader's retry becomes a
    // different payout" (M05 section 4).
    fixture.state = eligibleState({ withdrawableCents: 20_000n });
    reseedSubject();

    const replay = await requestPayout({ idempotencyKey: key });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    // AND IT RAN ONCE. One row, carrying the key ONCE, which is what makes the
    // later posting unrepeatable: `ledger_transactions.idempotency_key` is
    // `text NOT NULL UNIQUE` and every door composes it from this column.
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.requests[0]?.idempotencyKey).toBe(key);
  });

  it('answers 409 idempotency_key_reuse when the same key carries a different body', async () => {
    const key = 'idem-reuse';
    expect((await requestPayout({ idempotencyKey: key, payload: {} })).statusCode).toBe(200);

    const reused = await requestPayout({
      idempotencyKey: key,
      payload: { amount_cents: centsToJson(SUPPLIED) },
    });
    expect(reused.statusCode).toBe(409);
    expect(reused.json().code).toBe('idempotency_key_reuse');
    expect(fixture.requests).toHaveLength(1);
  });

  it('answers 409 conflict when the key is held by a row this scope cannot see', async () => {
    // `idempotency_keys.key` is the PRIMARY KEY and carries no identity, so one
    // caller's token can block another's. This layer cannot tell a foreign
    // holder from a row it is racing, so it REFUSES rather than guessing, and
    // the refusal is a denial rather than a disclosure: nothing about
    // OTHER_IDENTITY's request reaches this caller.
    const clientKey = 'idem-foreign';
    fixture.keys.set(storedKey(PAYOUT_ENDPOINT, clientKey), {
      key: storedKey(PAYOUT_ENDPOINT, clientKey),
      endpoint: PAYOUT_ENDPOINT,
      requestHash: new Uint8Array(32),
      responseStatus: 200,
      responseBody: { payout_request_id: 'not-yours' },
      owner: OTHER_IDENTITY,
    });

    const res = await requestPayout({ idempotencyKey: clientKey });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('conflict');
    expect(JSON.stringify(res.json())).not.toContain('not-yours');
    expect(fixture.requests).toHaveLength(0);
  });

  it('does not stamp a key on a refusal, so a fixed cause can be retried', async () => {
    const key = 'idem-refused';
    fixture.identityStatus = 'restricted';
    expect((await requestPayout({ idempotencyKey: key })).statusCode).toBe(422);

    fixture.identityStatus = 'active';
    const retried = await requestPayout({ idempotencyKey: key });
    // The key is claimed and carries no response, so the retry meets the
    // in-flight arm rather than replaying a refusal. Either answer is defensible
    // and THIS one is asserted so a change to it is visible.
    expect(retried.statusCode).toBe(409);
    expect(retried.json().code).toBe('conflict');
  });
});

// -----------------------------------------------------------------------------
// Validation, and the absence of any float
// -----------------------------------------------------------------------------

describe('the body, which has one optional member', () => {
  it('accepts an absent body, which is ADR-009 default path', () => {
    expect(validatePayoutRequest(undefined)).toEqual({ ok: true, value: {} });
    expect(validatePayoutRequest({})).toEqual({ ok: true, value: {} });
  });

  it('REFUSES a float rather than truncating it', async () => {
    expect(centsFromJson(99.5)).toBeNull();
    const validated = validatePayoutRequest({ amount_cents: 99.5 });
    expect(validated.ok).toBe(false);

    const res = await requestPayout({ payload: { amount_cents: 99.5 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('validation_failed');
    expect(res.json().errors[0].path).toBe('amount_cents');
    expect(fixture.requests).toHaveLength(0);
  });

  it('refuses zero and a negative amount', async () => {
    expect(validatePayoutRequest({ amount_cents: 0 }).ok).toBe(false);
    expect(validatePayoutRequest({ amount_cents: -1 }).ok).toBe(false);
    expect((await requestPayout({ payload: { amount_cents: 0 } })).statusCode).toBe(400);
  });

  it('drops every key section 6 does not declare, so a tampered field reaches nothing', () => {
    const validated = validatePayoutRequest({
      amount_cents: centsToJson(SUPPLIED),
      approved_cents: 999_999,
      trader_cents: 999_999,
      split_bp: 10_000,
    });
    expect(validated).toEqual({ ok: true, value: { amount_cents: centsToJson(SUPPLIED) } });
  });
});

// -----------------------------------------------------------------------------
// The pure halves, asserted directly
// -----------------------------------------------------------------------------

describe('LT-01 is built and never computed', () => {
  const ARGS = {
    identityId: IDENTITY,
    payoutRequestId: 'pr-x',
    idempotencyKey: 'k-x',
    approvedCents: DEFAULT_APPROVED,
    traderCents: DEFAULT_TRADER,
    firmCents: DEFAULT_FIRM,
  };

  it('names three accounts across two transfers and carries the caller key', () => {
    const post = lt01(ARGS);
    expect(post.header.kind).toBe('payout_approval');
    expect(post.header.idempotencyKey).toBe('k-x');
    expect(post.transfers).toHaveLength(2);
    expect(post.transfers[0]?.debit).toEqual({
      scope: 'identity',
      code: 'trader_withdrawable',
      identityId: IDENTITY,
    });
    expect(post.transfers[0]?.credit).toEqual({
      scope: 'identity',
      code: 'trader_wallet',
      identityId: IDENTITY,
    });
    expect(post.transfers[1]?.credit).toEqual({ scope: 'firm', code: 'fees_revenue' });
  });

  it('REFUSES a split that does not sum to approved_cents (INV-M5-03)', () => {
    // The guard exists for the failure the shape depends on: two debits against
    // the withdrawable position must total `approved_cents`, and every posting
    // would still balance if they did not.
    expect(() => lt01({ ...ARGS, firmCents: 15_001n })).toThrow(/INV-M5-03/);
  });

  it('REFUSES a zero or negative leg before the database is asked', () => {
    expect(() => lt01({ ...ARGS, traderCents: 0n, firmCents: DEFAULT_APPROVED })).toThrow();
  });

  // ---------------------------------------------------------------------------
  // THE POSTING'S SHAPE, ASSERTED WHERE THE POSTING NOW HAPPENS: OVER A HANDLE,
  // AND NOT OVER THIS ROUTE
  // ---------------------------------------------------------------------------
  // These six assertions ran against `POST /accounts/:accountId/payout` until
  // ADR-176 moved the posting to a system authority. THEY ARE THE SAME
  // ASSERTIONS: nothing about `lt01` or about `postTransaction` changed, and
  // deleting them because the route stopped calling them would have thrown away
  // the only place in this deployable that reads the four entries back.
  //
  // WHAT THIS PROVES AND WHAT IT DOES NOT, kept from the fixture it came from:
  // a recorder proves which accounts a posting named, in which direction, for
  // how much. It proves NOTHING about the zero-sum trigger or `LEDGER-C1` at
  // COMMIT, which are the database's and are asserted in `packages/ledger`'s
  // own suite.
  it('composes into ONE header and FOUR entries, whichever door holds the handle', async () => {
    const writes: Array<{ key: string; values: WriteValues }> = [];
    const handle = ledgerOver(writes);
    await postTransaction(handle, await readChart(handle), lt01(ARGS));

    // Every `Transfer` yields exactly two entries (ADR-104 ruling 1), so a
    // one-debit two-credit posting is unrepresentable in that library.
    const header = writes.filter((w) => w.key === 'ledgerTransactions');
    const entries = writes.filter((w) => w.key === 'ledgerEntries');
    expect(header).toHaveLength(1);
    expect(header[0]?.values['kind']).toBe('payout_approval');
    expect(header[0]?.values['referenceKind']).toBe('payout_request');
    expect(header[0]?.values['referenceId']).toBe('pr-x');
    expect(entries).toHaveLength(4);

    // The DEBIT total against the withdrawable position is `approved_cents`,
    // and it is `trader_withdrawable` rather than `firm_treasury`: M05 rules
    // that booking cash at approval contradicts the recognition timing.
    const debited = entries.filter((e) => e.values['ledgerAccountId'] === 'acct-withdrawable');
    expect(debited).toHaveLength(2);
    expect(debited.reduce((sum, e) => sum + (e.values['amountCents'] as bigint), 0n)).toBe(
      DEFAULT_APPROVED,
    );

    // The sign is read off `packages/ledger/src/posting.ts`: `+` on the debit
    // and `-` on the credit. Session 288 wrote it inverted once on a draft.
    const wallet = entries.find((e) => e.values['ledgerAccountId'] === 'acct-wallet');
    const fees = entries.find((e) => e.values['ledgerAccountId'] === 'acct-fees');
    expect(wallet?.values['amountCents']).toBe(-DEFAULT_TRADER);
    expect(fees?.values['amountCents']).toBe(-DEFAULT_FIRM);

    // The whole posting sums to zero, which is what makes it a posting.
    expect(entries.reduce((sum, e) => sum + (e.values['amountCents'] as bigint), 0n)).toBe(0n);

    // NO FLOAT REACHED THE LEDGER. Every amount is a `bigint`.
    for (const entry of entries) expect(typeof entry.values['amountCents']).toBe('bigint');
  });
});

describe('minimumAmountHolds conjoins the engine verdict with G-CLAMP tail', () => {
  const base = {
    gates: { minimumAmount: { pass: true } },
    clamp: { approvedCents: 150_000n },
    minPayoutCents: 10_000n,
  };
  it('is false when either half is false, and true only when both hold', () => {
    expect(minimumAmountHolds(base as never)).toBe(true);
    expect(minimumAmountHolds({ ...base, clamp: { approvedCents: 9_999n } } as never)).toBe(false);
    expect(
      minimumAmountHolds({ ...base, gates: { minimumAmount: { pass: false } } } as never),
    ).toBe(false);
  });
});

describe('money at the boundary refuses rather than rounds', () => {
  it('refuses a non-integer and a value past MAX_SAFE_INTEGER', () => {
    expect(centsFromJson('100')).toBeNull();
    expect(centsFromJson(1.000_1)).toBeNull();
    expect(centsFromJson(100)).toBe(100n);
    expect(() => centsToJson(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(/JSON integer/);
  });
});

// -----------------------------------------------------------------------------
// The declaration CI-06k reads, and the surface
// -----------------------------------------------------------------------------

describe('the required-factor declaration', () => {
  it('declares `session` on both rows and no C-27 action', () => {
    expect(PAYOUT_REQUIRED_FACTORS).toEqual({
      'GET /payouts': 'session',
      'POST /accounts/:accountId/payout': 'session',
    });
  });

  it('registers both routes on the public surface and withholds neither', () => {
    const { report } = buildServer({ surface: 'public', modules: onDisk });
    expect(report.modules).toContain('payouts');
    expect(report.registered).toContain('GET /payouts');
    expect(report.registered).toContain('POST /accounts/:accountId/payout');
    expect(report.withheld).not.toContain('GET /payouts');
  });
});

// -----------------------------------------------------------------------------
// The fail-closed default
// -----------------------------------------------------------------------------

describe('an unwired deployment answers 503 and never approves', () => {
  it('refuses both routes with service_unavailable', async () => {
    resetPayoutBackend();
    const listed = await call({ method: 'GET', path: '/payouts', token: TOKEN });
    expect(listed.statusCode).toBe(503);
    expect(listed.json().code).toBe('service_unavailable');

    const posted = await requestPayout();
    expect(posted.statusCode).toBe(503);
    expect(posted.json().code).toBe('service_unavailable');
    expect(fixture.requests).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// THE RULING, PINNED AGAINST THE SOURCE RATHER THAN AGAINST A COMMENT
// -----------------------------------------------------------------------------
// ADR-176 is a REMOVAL, and a removal is the one kind of change a behavioural
// suite cannot hold: every case above passes just as well against a file that
// posts again tomorrow, because the fixture would simply record a write nobody
// reads. `db.test.ts` met the same problem in this deployable and answered it
// the same way -- read the source as text -- and its reason applies here word
// for word: there is no way to ask the module graph "which handle did this
// module NOT take".
//
// THE PAIRED HALF IS ASSERTED TOO, AND IT IS WHAT KEEPS THIS FROM BEING A
// ONE-WAY RATCHET. `lt01` must STAY exported here and `admin-payouts.ts` must
// keep importing it, because the alternative to one statement of
// `debit trader_withdrawable / credit trader_wallet / credit fees_revenue` is
// two of them, which is ADR-092 section 5's hazard on the money path. A session
// that "finished" ADR-176 by moving `lt01` out and letting each door write its
// own goes red on the second case.

describe('ADR-176: the request path holds no ledger handle', () => {
  const SOURCE = readFileSync(
    join(import.meta.dirname, '..', 'src', 'routes', 'payouts.ts'),
    'utf8',
  );
  const ADMIN = readFileSync(
    join(import.meta.dirname, '..', 'src', 'routes', 'admin-payouts.ts'),
    'utf8',
  );

  /** The file with every line and block comment removed. Prose may name what code may not. */
  // Stripped by the shared home (ADR-279) rather than by a comment regex: a
  // block-comment OPENER written inside a LINE comment opened a phantom block that
  // ran to the next real closer and took every line between them with it.
  const CODE = stripComments(SOURCE);

  it('imports no WRITE-side symbol from @merit/ledger, so nothing here can post', () => {
    // `posting`, `transfer`, `identityAccount`, `firmAccount` and `Posting` BUILD
    // a value and reach no database. `postTransaction`, `readChart` and
    // `LedgerTx` are the three that need a handle, and a handle is what ADR-172
    // clause 2 refuses this surface.
    expect(CODE).not.toMatch(/\bpostTransaction\b/);
    expect(CODE).not.toMatch(/\breadChart\b/);
    expect(CODE).not.toMatch(/\bLedgerTx\b/);
  });

  it('declares no `ledger` member on `PayoutTx`, which is the field ADR-172 called the defect', () => {
    const port = /export interface PayoutTx \{([\s\S]*?)\n\}/.exec(CODE)?.[1] ?? '';
    expect(port.length).toBeGreaterThan(0);
    expect(port).not.toMatch(/\bledger\b/);
    // And the members that DO remain are the four a scoped handle could serve.
    expect(port).toMatch(/identityStatus\(/);
    expect(port).toMatch(/subject\(/);
    expect(port).toMatch(/holdFlag\(/);
    expect(port).toMatch(/insertPayoutRequest\(/);
  });

  it('still states `LT-01` exactly once, and `admin-payouts.ts` still reads it from here', () => {
    expect(CODE).toMatch(/export function lt01\(/);
    expect(ADMIN).toContain("import { PAYOUT_ENDPOINT, lt01 } from './payouts.ts';");
  });

  it('carries the caller key into the row, because no later door can post without it', () => {
    // The type would already refuse an insert shape without it; this asserts the
    // HANDLER writes it, which the type cannot.
    expect(CODE).toMatch(/readonly idempotencyKey: string;/);
    expect(CODE).toMatch(/^\s*idempotencyKey,$/m);
  });
});
