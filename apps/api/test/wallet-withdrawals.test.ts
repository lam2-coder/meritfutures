// =============================================================================
// apps/api/test/wallet-withdrawals.test.ts
// =============================================================================
// CI-02, the `unit` project. THE ROUTE WHERE CASH LEAVES MERIT.
//
// -----------------------------------------------------------------------------
// A GUARD THAT REFUSES EVERYTHING PASSES EVERY REFUSAL TEST
// -----------------------------------------------------------------------------
// `DELTA_MANIFEST` section 13 records that lesson and it cost a session once. So
// every refusal below is paired with the case that ADMITS, out of the same
// fixture, and the PAIR is what is asserted. `the honest path` is the negative
// control on the whole file: if the route refused everything, that block goes
// red first, and every seeded defect below was watched turning something red
// while `the honest path` stayed green or turned red for its own reason.
//
// -----------------------------------------------------------------------------
// `ADR-075`'s WITNESS IS `closed` AND IT HAS ITS OWN CASE
// -----------------------------------------------------------------------------
// `= 'active'` and `<> 'restricted'` differ on exactly ONE value of
// `identity_status`, so a suite that only drove `restricted` would pass against
// either predicate and would prove nothing about the ruling this gate rests on.
// The `closed` case is the one that discriminates, and it is here for the same
// reason `payouts.test.ts` has it on the other extraction door.
//
// -----------------------------------------------------------------------------
// MONEY IS `bigint` CENTS IN EVERY SEED AND EVERY EXPECTATION
// -----------------------------------------------------------------------------
// The wire carries JSON integers per API_CONTRACT section 1, and the only place
// a `number` appears is at that boundary. THERE IS NO FLOAT IN THIS FILE, and
// two cases assert that a float is REFUSED rather than rounded.
//
// -----------------------------------------------------------------------------
// WHAT THIS SUITE CANNOT PROVE, STATED RATHER THAN IMPLIED
// -----------------------------------------------------------------------------
// The fake transaction is a RECORDER. It proves which door was opened, in which
// order, with which values -- and NOTHING about whether `lockScope()` actually
// serialises two concurrent requests, which is `packages/db`'s property and is
// asserted in `packages/db/test/keyed-accessor.test.ts` (ADR-157 section 9 rows
// 15 to 17). What is asserted here is that the lock is TAKEN, and taken FIRST,
// because that is the half a route file can get wrong.
// =============================================================================

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BASE_PATH, buildServer, discoverRouteModules } from '../src/index.ts';
import {
  identityScope,
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
  APPROVABLE_STATUSES,
  CANCELLABLE_STATUSES,
  CANCELLATION_HOLDS,
  CREATED_STATUSES,
  DESTINATION_COOLING_WINDOW_MS,
  IDENTITY_RESTRICTED,
  INSUFFICIENT_FUNDS,
  KYC_REQUIRED,
  MINIMUM_WITHDRAWAL_CENTS,
  OPEN_WITHDRAWAL_STATUSES,
  PAYOUTS_FROZEN,
  TERMINAL_EDGE_FINDINGS,
  TERMINAL_WITHDRAWAL_STATUSES,
  UNWIRED_WITHDRAWAL_BACKEND,
  WALLET_PROVENANCES,
  WITHDRAWALS_ENDPOINT,
  WITHDRAWALS_PATH,
  WITHDRAWAL_CANCEL_PATH,
  WITHDRAWAL_ENDPOINTS,
  WITHDRAWAL_REQUIRED_FACTORS,
  balanceOf,
  centsFromJson,
  centsToJson,
  composeWithdrawal,
  coolingDecision,
  databaseWithdrawalBackend,
  decideWithdrawal,
  currentKycState,
  decideApproval,
  decideCancellation,
  driveApprovals,
  driveCancellation,
  dualControlRequired,
  gateIdentityStatus,
  provenanceReview,
  resetWithdrawalBackend,
  toApprovalCandidate,
  toWalletEntryRow,
  withdrawalReleasesIdentity,
  unspentLots,
  useWithdrawalBackend,
  validateWithdrawalRequest,
  withdrawableCents,
  type CompositionEntry,
  type DestinationInsert,
  type DestinationRow,
  type IdentityRow,
  type IdentityStatus,
  type KycState,
  type WalletEntryRow,
  type WithdrawalBackend,
  type ApprovalHand,
  type WithdrawalCancellationResponse,
  type CancellationOutcome,
  type WithdrawalApprovalCandidate,
  type WithdrawalApprovalValues,
  type WithdrawalCancellationValues,
  type WithdrawalInsert,
  type WithdrawalTx,
} from '../src/routes/wallet-withdrawals.ts';
import { DUAL_CONTROL_THRESHOLD_CENTS } from '../src/routes/admin-wallet.ts';
import { NO_PRE_IDENTITY_DOORS } from './db-recorder.ts';

// -----------------------------------------------------------------------------
// The fixture
// -----------------------------------------------------------------------------

const IDENTITY = '0199c7a1-1111-7000-8000-000000000101';
const OTHER_IDENTITY = '0199c7a1-1111-7000-8000-000000000102';
const TOKEN = 'session-token-303';
const DESTINATION = 'rise_dest_aaaa1111';

/** `at`, the instant every case is decided at. Pinned so no case reads a clock. */
const NOW = new Date('2026-08-27T12:00:00.000Z');

/** 48 wall-clock hours after {@link NOW}, which is what a fresh window ends at. */
const WINDOW_END = new Date(NOW.getTime() + DESTINATION_COOLING_WINDOW_MS);

/**
 * The session, ELEVATED.
 *
 * `POST /wallet/withdrawals` declares `passkey or dual_channel` and
 * `C-27: external withdrawal`, so an unelevated session never reaches a handler
 * body at all -- which is a case of its own below, and it is the one that
 * proves this module adds no SECOND refusal.
 */
const SESSION: AuthSession = {
  id: '0199c7a1-3333-7000-8000-000000000101',
  identityId: IDENTITY,
  userId: '0199c7a1-4444-7000-8000-000000000101',
  authFactor: 'passkey',
  elevatedAt: '2026-08-27T11:55:00.000Z',
  elevatedByFactor: 'passkey',
};

/** The same human, with the elevation removed and nothing else changed. */
const UNELEVATED: AuthSession = { ...SESSION, elevatedAt: null, elevatedByFactor: null };

/** One `wallet_entries` row, in the accessor's own property spelling. */
function entry(over: {
  id: bigint;
  direction?: 'credit' | 'debit';
  amountCents: bigint;
  provenance?: (typeof WALLET_PROVENANCES)[number];
  balanceAfterCents: bigint;
  occurredAt: string;
}): Record<string, unknown> {
  return {
    id: over.id,
    direction: over.direction ?? 'credit',
    amountCents: over.amountCents,
    provenance: over.provenance ?? 'payout',
    balanceAfterCents: over.balanceAfterCents,
    occurredAt: new Date(over.occurredAt),
  };
}

/**
 * The default statement: 300,000c of `payout` then 90,000c of
 * `refund_wallet_funded`, balance 390,000c.
 *
 * TWO CLASSES ON PURPOSE, because a one-class wallet composes the same way
 * whether the code walks FIFO or sums the column, and M20 section 3.4's whole
 * point is that "$500 of settled payout and $99 of refund_wallet_funded is not
 * the same object as one holding $599 of payout".
 */
function defaultEntries(): Record<string, unknown>[] {
  return [
    entry({
      id: 1n,
      amountCents: 300_000n,
      provenance: 'payout',
      balanceAfterCents: 300_000n,
      occurredAt: '2026-08-01T00:00:00.000Z',
    }),
    entry({
      id: 2n,
      amountCents: 90_000n,
      provenance: 'refund_wallet_funded',
      balanceAfterCents: 390_000n,
      occurredAt: '2026-08-10T00:00:00.000Z',
    }),
  ];
}

interface Fixture {
  identity: IdentityRow;
  kyc: Record<string, unknown>[];
  withdrawals: Record<string, unknown>[];
  entries: Record<string, unknown>[];
  destinations: Map<string, DestinationRow>;
  /** Everything the handler wrote, in order, and the lock among them. */
  calls: string[];
  written: WithdrawalInsert[];
  registered: DestinationInsert[];
  /** Every `approveWithdrawal` this fixture committed. ADR-232. */
  approved: { id: string; values: WithdrawalApprovalValues }[];
  /** Every `cancelWithdrawal` this fixture committed. ADR-234. */
  cancelled: { id: string; values: WithdrawalCancellationValues }[];
  keys: Map<string, IdempotencyRecord & { owner: string }>;
}

let fixture: Fixture;

function verifiedKyc(state: KycState = 'verified'): Record<string, unknown>[] {
  return [{ id: 'kyc-1', state, supersedes: null }];
}

function reset(): void {
  fixture = {
    identity: { status: 'active', payoutsFrozen: false },
    kyc: verifiedKyc(),
    withdrawals: [],
    entries: defaultEntries(),
    destinations: new Map(),
    calls: [],
    written: [],
    registered: [],
    approved: [],
    cancelled: [],
    keys: new Map(),
  };
}

reset();

/**
 * The backend, with a STAGING copy that is merged only if the handler returns.
 *
 * THIS IS THE FIXTURE'S LOAD-BEARING PART, and it is `payouts.test.ts`'s shape
 * for its reason: a fake that wrote straight through would pass every
 * happy-path assertion and would silently make "a refused withdrawal registers
 * no destination" unfalsifiable. On THIS route that is not a theoretical
 * concern -- `first_seen_at` is immutable under `PAYOUT-DEST-C1`, so a
 * destination row written by a request that then refused is a security record
 * that can never be corrected.
 */
const backend: WithdrawalBackend = {
  now: () => NOW,
  transact: async <T>(_session: AuthSession, fn: (tx: WithdrawalTx) => Promise<T>): Promise<T> => {
    const stagedWritten = [...fixture.written];
    const stagedRegistered = [...fixture.registered];
    const stagedDestinations = new Map(fixture.destinations);
    const stagedWithdrawals = fixture.withdrawals.map((row) => ({ ...row }));
    const tx: WithdrawalTx = {
      lockScope: () => {
        fixture.calls.push('lockScope');
        return Promise.resolve();
      },
      identity: () => {
        fixture.calls.push('identity');
        return Promise.resolve(fixture.identity);
      },
      kycVerifications: () => {
        fixture.calls.push('kyc');
        return Promise.resolve(fixture.kyc);
      },
      withdrawals: () => {
        fixture.calls.push('withdrawals');
        return Promise.resolve(stagedWithdrawals.map((row) => ({ status: String(row['status']) })));
      },
      approvalCandidates: () => {
        fixture.calls.push('approvalCandidates');
        return Promise.resolve(stagedWithdrawals.map(toApprovalCandidate));
      },
      approveWithdrawal: (id, values) => {
        fixture.calls.push(`approveWithdrawal:${id}`);
        const row = stagedWithdrawals.find((held) => held['id'] === id);
        if (row === undefined) throw new Error(`no staged withdrawal ${id}`);
        Object.assign(row, {
          status: values.status,
          approvedAt: values.approvedAt,
          approvedBy: values.approvedBy,
          dualControlApprovalId: values.dualControlApprovalId,
          dualControlThresholdCents: values.dualControlThresholdCents,
          updatedAt: values.updatedAt,
        });
        fixture.approved.push({ id, values });
        return Promise.resolve();
      },
      cancelWithdrawal: (id, values) => {
        fixture.calls.push(`cancelWithdrawal:${id}`);
        const row = stagedWithdrawals.find((held) => held['id'] === id);
        if (row === undefined) throw new Error(`no staged withdrawal ${id}`);
        Object.assign(row, {
          status: values.status,
          cancelledAt: values.cancelledAt,
          updatedAt: values.updatedAt,
        });
        fixture.cancelled.push({ id, values });
        return Promise.resolve();
      },
      entries: () => {
        fixture.calls.push('entries');
        return Promise.resolve(fixture.entries.map(toWalletEntryRow));
      },
      destination: (ref) => {
        fixture.calls.push(`destination:${ref}`);
        return Promise.resolve(stagedDestinations.get(ref));
      },
      registerDestination: (row) => {
        fixture.calls.push('registerDestination');
        stagedRegistered.push(row);
        stagedDestinations.set(row.destinationRef, {
          firstSeenAt: row.firstSeenAt,
          coolingUntil: row.coolingUntil,
        });
        return Promise.resolve();
      },
      insertWithdrawal: (row) => {
        fixture.calls.push('insertWithdrawal');
        stagedWritten.push(row);
        const id = `withdrawal-${String(stagedWritten.length)}`;
        // THE INSERTED ROW JOINS THE ROWS THIS TRANSACTION CAN READ, AND IT DID
        // NOT UNTIL ADR-234. A fake whose INSERT is invisible to its own SELECT
        // makes every SEQUENCE unfalsifiable: "requested, then cancelled, then
        // accepted again" could only ever be tested by PLANTING the middle
        // state, which is what ADR-232's no-lockout test had to do and is
        // exactly the thing the dispatch for this session called insufficient.
        // The staging copy is what keeps it honest -- a refused request rolls
        // this row back with everything else.
        stagedWithdrawals.push({
          id,
          status: row.status,
          amountCents: row.amountCents,
          destinationRef: row.destinationRef,
          sourceProvenanceSummary: row.sourceProvenanceSummary,
          earliestCreditAt: row.earliestCreditAt,
          frozenAt: null,
        });
        return Promise.resolve({ id });
      },
    };
    const value = await fn(tx);
    fixture.written = stagedWritten;
    fixture.registered = stagedRegistered;
    fixture.destinations = stagedDestinations;
    fixture.withdrawals = stagedWithdrawals;
    return value;
  },
  idempotency: {
    find: (scope: IdempotencyScope, key: string) => {
      const held = fixture.keys.get(key);
      if (held === undefined) return Promise.resolve(null);
      // THE SCOPE IS THE WHOLE CONTROL. `idempotency_keys.key` is the PRIMARY
      // KEY and carries no identity, so one caller's token can hold a row
      // another caller cannot see.
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

let sessionFor: AuthSession | null = SESSION;

const AUTH_FIXTURE: AuthBackend = {
  ...UNWIRED_AUTH_BACKEND,
  sessionByToken: (token: string) => Promise.resolve(token === TOKEN ? sessionFor : null),
};

const onDisk = await discoverRouteModules();

let keyCounter = 0;
function nextKey(): string {
  keyCounter += 1;
  return `idem-303-${String(keyCounter)}`;
}

async function call(options: {
  token?: string | undefined;
  payload?: unknown;
  idempotencyKey?: string | null | undefined;
}): Promise<LightMyRequestResponse> {
  const { app } = buildServer({ surface: 'public', modules: onDisk });
  const inject: InjectOptions = { method: 'POST', url: `${BASE_PATH}${WITHDRAWALS_PATH}` };
  const headers: Record<string, string> = {};
  if (options.token !== undefined) headers['cookie'] = `${SESSION_COOKIE}=${options.token}`;
  if (options.idempotencyKey !== null)
    headers['idempotency-key'] = options.idempotencyKey ?? nextKey();
  inject.headers = headers;
  if (options.payload !== undefined) inject.payload = options.payload as object;
  const res = await app.inject(inject);
  await app.close();
  return res;
}

/** The default request: 150,000c to {@link DESTINATION}. Above the minimum. */
function withdraw(
  over: { amount?: unknown; destination?: unknown; key?: string | null } = {},
): Promise<LightMyRequestResponse> {
  return call({
    token: TOKEN,
    payload: {
      amount_cents: over.amount === undefined ? 150_000 : over.amount,
      destination_ref: over.destination === undefined ? DESTINATION : over.destination,
    },
    idempotencyKey: over.key,
  });
}

/**
 * `POST /wallet/withdrawals/:withdrawalId/cancel`, over the transport. ADR-263.
 *
 * IT SENDS NO `Idempotency-Key` AND NO BODY, because the row states neither.
 * The one option is the cookie, so the elevation case drives the same helper
 * every other case does rather than a second one written to fail.
 */
async function cancelOverHttp(
  id: string,
  options: { token?: string | undefined } = {},
): Promise<LightMyRequestResponse> {
  const { app } = buildServer({ surface: 'public', modules: onDisk });
  const headers: Record<string, string> = {};
  const token = 'token' in options ? options.token : TOKEN;
  if (token !== undefined) headers['cookie'] = `${SESSION_COOKIE}=${token}`;
  const res = await app.inject({
    method: 'POST',
    url: `${BASE_PATH}${WITHDRAWAL_CANCEL_PATH.replace(':withdrawalId', id)}`,
    headers,
  });
  await app.close();
  return res;
}

beforeEach(() => {
  reset();
  sessionFor = SESSION;
  useAuthBackend(AUTH_FIXTURE);
  useWithdrawalBackend(backend);
});

afterEach(() => {
  resetAuthBackend();
  resetWithdrawalBackend();
});

// -----------------------------------------------------------------------------
// The declaration
// -----------------------------------------------------------------------------

describe('the endpoint is declared as API_CONTRACT section 6.2 and section 12 write it', () => {
  it('requires elevation on BOTH rows, and the cancel row carries no C-27 action', () => {
    // ADR-263 NARROWS THIS ASSERTION RATHER THAN WIDENING IT: the map is
    // compared WHOLE, so the cancel row could not have been added without this
    // line moving, which is what makes the second row a decision somebody took
    // rather than a route that appeared.
    expect(WITHDRAWAL_REQUIRED_FACTORS).toStrictEqual({
      'POST /wallet/withdrawals': 'passkey or dual_channel',
      'POST /wallet/withdrawals/:withdrawalId/cancel': 'passkey or dual_channel',
    });

    // AND THE TAG IS THE HALF THE FACTOR DOES NOT SAY. C-27's action list is
    // closed at three and a cancellation is money STAYING, so the cancel row
    // declares the factor and NOT the action. A `c27` here would record that
    // this door performs the act C-27 guards.
    const cancelSpec = WITHDRAWAL_ENDPOINTS.find((spec) => spec.path === WITHDRAWAL_CANCEL_PATH);
    expect(cancelSpec?.c27).toBeUndefined();
    expect(WITHDRAWAL_ENDPOINTS.find((spec) => spec.path === WITHDRAWALS_PATH)?.c27).toBe(
      'external withdrawal',
    );
  });

  it('is registered on the PUBLIC surface and withheld from the operator one', () => {
    const publicSide = buildServer({ surface: 'public', modules: onDisk }).report;
    const operator = buildServer({ surface: 'operator', modules: onDisk }).report;
    for (const endpoint of [WITHDRAWALS_ENDPOINT, `POST ${WITHDRAWAL_CANCEL_PATH}`]) {
      expect(publicSide.registered, endpoint).toContain(endpoint);
      expect(publicSide.withheld, endpoint).not.toContain(endpoint);
      expect(operator.withheld, endpoint).toContain(endpoint);
      expect(operator.registered, endpoint).not.toContain(endpoint);
    }
  });

  it('names the endpoint the idempotency layer stores against', () => {
    expect(WITHDRAWALS_ENDPOINT).toBe('POST /wallet/withdrawals');
    expect(storedKey(WITHDRAWALS_ENDPOINT, 'k')).toContain(WITHDRAWALS_ENDPOINT);
  });

  it('states the minimum as 10,000 INTEGER cents, and it is a bigint', () => {
    expect(MINIMUM_WITHDRAWAL_CENTS).toBe(10_000n);
    expect(typeof MINIMUM_WITHDRAWAL_CENTS).toBe('bigint');
  });

  it('reads the in-flight statuses off `wallet_withdrawals_open_idx`', () => {
    expect([...OPEN_WITHDRAWAL_STATUSES]).toStrictEqual([
      'requested',
      'cooling',
      'approved',
      'transferring',
    ]);
  });

  it('types the creation at two states and not at seven', () => {
    expect([...CREATED_STATUSES]).toStrictEqual(['requested', 'cooling']);
  });
});

// -----------------------------------------------------------------------------
// THE HONEST PATH. The negative control on this whole file
// -----------------------------------------------------------------------------

describe('the honest path', () => {
  it('creates a withdrawal, composes it FIFO, and returns section 6.2s shape', async () => {
    // A destination Merit has seen before, whose window elapsed yesterday.
    fixture.destinations.set(DESTINATION, {
      firstSeenAt: new Date('2026-08-20T00:00:00.000Z'),
      coolingUntil: new Date('2026-08-22T00:00:00.000Z'),
    });

    const res = await withdraw();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({
      withdrawal_id: 'withdrawal-1',
      status: 'requested',
      amount_cents: 150_000,
      destination_ref: DESTINATION,
      requested_at: NOW.toISOString(),
      cooling_until: null,
      // 150,000c out of a 300,000c `payout` lot that is the OLDEST money here,
      // so the newer 90,000c refund credit is untouched. FIFO, by hand.
      composition: [{ provenance: 'payout', cents: 150_000 }],
      earliest_credit_at: '2026-08-01T00:00:00.000Z',
      provenance_review: false,
      halt: null,
    });
  });

  it('writes exactly one row, with the composition and the trader s own key', async () => {
    fixture.destinations.set(DESTINATION, {
      firstSeenAt: new Date('2026-08-20T00:00:00.000Z'),
      coolingUntil: new Date('2026-08-22T00:00:00.000Z'),
    });
    await withdraw({ key: 'trader-key-1' });

    expect(fixture.written).toHaveLength(1);
    const row = fixture.written[0] as WithdrawalInsert;
    expect(row.amountCents).toBe(150_000n);
    expect(typeof row.amountCents).toBe('bigint');
    expect(row.status).toBe('requested');
    expect(row.idempotencyKey).toBe('trader-key-1');
    expect(row.requestedAt).toStrictEqual(NOW);
    expect(row.sourceProvenanceSummary).toStrictEqual([{ provenance: 'payout', cents: 150_000 }]);
    expect(row.earliestCreditAt).toStrictEqual(new Date('2026-08-01T00:00:00.000Z'));
  });

  it('takes the per-identity lock FIRST, before any gate reads anything', async () => {
    fixture.destinations.set(DESTINATION, {
      firstSeenAt: new Date('2026-08-20T00:00:00.000Z'),
      coolingUntil: new Date('2026-08-22T00:00:00.000Z'),
    });
    await withdraw();
    // ADR-157 clause 4. A gate evaluated before the lock is a gate evaluated
    // against a state another transaction can still change.
    expect(fixture.calls[0]).toBe('lockScope');
    expect(fixture.calls).toStrictEqual([
      'lockScope',
      'identity',
      'kyc',
      'withdrawals',
      'entries',
      `destination:${DESTINATION}`,
      'insertWithdrawal',
    ]);
  });

  it('POSTS NO LEDGER TRANSACTION, which is this slice s reported finding', async () => {
    fixture.destinations.set(DESTINATION, {
      firstSeenAt: new Date('2026-08-20T00:00:00.000Z'),
      coolingUntil: new Date('2026-08-22T00:00:00.000Z'),
    });
    await withdraw();
    // THE PORT HAS NO LEDGER HANDLE AT ALL, which is the structural half of the
    // claim: `LT-06` is `wallet_withdrawal_approval` and this route creates at
    // `requested` or `cooling`. `payouts.ts`'s `PayoutTx` carries a `ledger`
    // member and `WithdrawalTx` deliberately does not, so a future edit that
    // wanted to post here would have to widen the port, in a diff a reviewer
    // reads. See the module header for the disagreement this records.
    expect(Object.keys(fixture.calls.join(' '))).not.toContain('ledger');
    expect(fixture.calls.some((c) => c.includes('ledger'))).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// `C-27`, and the second refusal this module deliberately does not add
// -----------------------------------------------------------------------------

describe('C-27 refuses a non-elevated session and this module adds no second refusal', () => {
  it('answers 403 with the required factor, before the handler body runs', async () => {
    sessionFor = UNELEVATED;
    const res = await withdraw();
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
    // THE HANDLER NEVER RAN. This is the assertion that proves the refusal is
    // `auth.ts`'s and not a copy of it here: no lock was taken and no row was
    // read, because `authorize` refused before `handle` was called.
    expect(fixture.calls).toStrictEqual([]);
    expect(fixture.written).toStrictEqual([]);
  });

  it('admits the SAME human once elevated, out of the same fixture', async () => {
    sessionFor = SESSION;
    const res = await withdraw();
    expect(res.statusCode).toBe(200);
    expect(fixture.written).toHaveLength(1);
  });

  it('answers 401 and never 403 to a caller with no session at all', async () => {
    const res = await call({ payload: { amount_cents: 150_000, destination_ref: DESTINATION } });
    expect(res.statusCode).toBe(401);
    expect(fixture.calls).toStrictEqual([]);
  });
});

// -----------------------------------------------------------------------------
// Validation, and the minimum
// -----------------------------------------------------------------------------

describe('the body, and the 10,000c minimum', () => {
  it('refuses an amount below the minimum as `validation_failed`', async () => {
    const res = await withdraw({ amount: 9_999 });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('validation_failed');
    expect(res.json().errors).toStrictEqual([
      { path: 'amount_cents', message: 'must be at least 10000 cents' },
    ]);
    expect(fixture.calls).toStrictEqual([]);
  });

  it('ADMITS exactly the minimum, which is the boundary the refusal is measured from', async () => {
    fixture.destinations.set(DESTINATION, {
      firstSeenAt: new Date('2026-08-20T00:00:00.000Z'),
      coolingUntil: new Date('2026-08-22T00:00:00.000Z'),
    });
    const res = await withdraw({ amount: 10_000 });
    expect(res.statusCode).toBe(200);
    expect(res.json().amount_cents).toBe(10_000);
  });

  it('REFUSES a float rather than rounding it', async () => {
    const res = await withdraw({ amount: 10_000.5 });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toStrictEqual([
      { path: 'amount_cents', message: 'must be an integer number of cents' },
    ]);
  });

  it('refuses a float even when it is above the minimum and would round up', async () => {
    // `Math.round(150000.4)` is 150000, which is a legal amount. The point is
    // that this door never asks that question: a non-integer is not cents.
    expect(centsFromJson(150_000.4)).toBeNull();
    expect(centsFromJson(150_000)).toBe(150_000n);
  });

  it('refuses zero, a negative, a string amount and a missing destination', () => {
    expect(validateWithdrawalRequest({ amount_cents: 0, destination_ref: 'd' }).ok).toBe(false);
    expect(validateWithdrawalRequest({ amount_cents: -10_000, destination_ref: 'd' }).ok).toBe(
      false,
    );
    expect(validateWithdrawalRequest({ amount_cents: '10000', destination_ref: 'd' }).ok).toBe(
      false,
    );
    expect(validateWithdrawalRequest({ amount_cents: 10_000 }).ok).toBe(false);
    expect(validateWithdrawalRequest({ amount_cents: 10_000, destination_ref: '' }).ok).toBe(false);
    expect(validateWithdrawalRequest(null).ok).toBe(false);
  });

  it('collects BOTH field errors rather than returning the first', () => {
    const result = validateWithdrawalRequest({ amount_cents: 5, destination_ref: '' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.errors.map((e) => e.path)).toStrictEqual(['amount_cents', 'destination_ref']);
  });

  it('refuses a request with no `Idempotency-Key`, which the schema makes unwritable', async () => {
    const res = await withdraw({ key: null });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].path).toBe('Idempotency-Key');
    expect(fixture.calls).toStrictEqual([]);
  });

  it('refuses a JSON integer larger than `Number.MAX_SAFE_INTEGER` can carry', () => {
    expect(centsFromJson(Number.MAX_SAFE_INTEGER + 2)).toBeNull();
    expect(() => centsToJson(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(/JSON integer/);
  });
});

// -----------------------------------------------------------------------------
// `G-WITHDRAWAL-CLEARED`'s identity term, ADR-075
// -----------------------------------------------------------------------------

describe('identities.status = active, and `closed` is the witness', () => {
  it('refuses a `restricted` identity', async () => {
    fixture.identity = { status: 'restricted', payoutsFrozen: false };
    const res = await withdraw();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe(IDENTITY_RESTRICTED);
    expect(fixture.written).toStrictEqual([]);
  });

  it('REFUSES A `closed` IDENTITY, which `<> restricted` would have admitted', async () => {
    fixture.identity = { status: 'closed', payoutsFrozen: false };
    const res = await withdraw();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe(IDENTITY_RESTRICTED);
    expect(res.json().detail).toContain('closed');
    expect(fixture.written).toStrictEqual([]);
  });

  it('admits an `active` identity out of the same fixture', async () => {
    fixture.identity = { status: 'active', payoutsFrozen: false };
    const res = await withdraw();
    expect(res.statusCode).toBe(200);
  });

  it('is `= active` at the function, over every member of the enum', () => {
    const statuses: readonly IdentityStatus[] = ['active', 'restricted', 'closed'];
    expect(statuses.filter((s) => gateIdentityStatus(s) === null)).toStrictEqual(['active']);
  });

  it('refuses a frozen identity under its OWN code, not the restriction one', async () => {
    fixture.identity = { status: 'active', payoutsFrozen: true };
    const res = await withdraw();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe(PAYOUTS_FROZEN);
    expect(fixture.written).toStrictEqual([]);
  });
});

// -----------------------------------------------------------------------------
// `G-WITHDRAWAL-CLEARED`'s KYC term
// -----------------------------------------------------------------------------

describe('KYC verified', () => {
  it('refuses every state that is not `verified`', async () => {
    for (const state of ['kyc_required', 'pending', 'rejected', 'expired'] as const) {
      reset();
      fixture.kyc = verifiedKyc(state);
      const res = await withdraw();
      expect(res.statusCode, state).toBe(422);
      expect(res.json().code, state).toBe(KYC_REQUIRED);
    }
  });

  it('admits `verified` out of the same fixture', async () => {
    fixture.kyc = verifiedKyc('verified');
    expect((await withdraw()).statusCode).toBe(200);
  });

  it('refuses an identity with NO verification row at all', async () => {
    fixture.kyc = [];
    const res = await withdraw();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe(KYC_REQUIRED);
  });

  it('reads the head of a supersession chain and FAILS CLOSED on an unnameable one', () => {
    expect(
      currentKycState([
        { id: 'a', state: 'expired', supersedes: null },
        { id: 'b', state: 'verified', supersedes: 'a' },
      ]),
    ).toBe('verified');
    // Two live heads is an ordering this table does not declare.
    expect(
      currentKycState([
        { id: 'a', state: 'verified', supersedes: null },
        { id: 'b', state: 'verified', supersedes: null },
      ]),
    ).toBe('kyc_required');
  });
});

// -----------------------------------------------------------------------------
// `G-NO-IN-FLIGHT`, one at a time
// -----------------------------------------------------------------------------

describe('one withdrawal in flight', () => {
  it('refuses a second while one is open, on every open status', async () => {
    for (const status of OPEN_WITHDRAWAL_STATUSES) {
      reset();
      fixture.withdrawals = [{ status }];
      const res = await withdraw();
      expect(res.statusCode, status).toBe(409);
      expect(res.json().code, status).toBe('conflict');
      expect(fixture.written, status).toStrictEqual([]);
    }
  });

  it('ADMITS one when every prior withdrawal has reached a terminal state', async () => {
    for (const status of ['settled', 'failed', 'cancelled'] as const) {
      reset();
      fixture.withdrawals = [{ status }];
      const res = await withdraw();
      expect(res.statusCode, status).toBe(200);
      expect(fixture.written, status).toHaveLength(1);
    }
  });

  it('refuses when ONE of several rows is open', async () => {
    fixture.withdrawals = [{ status: 'settled' }, { status: 'transferring' }, { status: 'failed' }];
    expect((await withdraw()).statusCode).toBe(409);
  });
});

// -----------------------------------------------------------------------------
// The funds check
// -----------------------------------------------------------------------------

describe('insufficient_funds, measured against withdrawable_cents', () => {
  it('refuses a request one cent above the balance', async () => {
    const res = await withdraw({ amount: 390_001 });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe(INSUFFICIENT_FUNDS);
    expect(fixture.written).toStrictEqual([]);
  });

  it('ADMITS a request for exactly the balance, composed out of BOTH classes', async () => {
    fixture.destinations.set(DESTINATION, {
      firstSeenAt: new Date('2026-08-20T00:00:00.000Z'),
      coolingUntil: new Date('2026-08-22T00:00:00.000Z'),
    });
    const res = await withdraw({ amount: 390_000 });
    expect(res.statusCode).toBe(200);
    expect(res.json().composition).toStrictEqual([
      { provenance: 'payout', cents: 300_000 },
      { provenance: 'refund_wallet_funded', cents: 90_000 },
    ]);
  });

  it('refuses an identity with an empty wallet', async () => {
    fixture.entries = [];
    const res = await withdraw();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe(INSUFFICIENT_FUNDS);
  });

  it('reads the balance off the LAST ROW APPENDED and not the latest instant', () => {
    // A backdated correction, appended last. `wallet.ts` states the rule and
    // this is the case that discriminates between `id` and `occurred_at`.
    const rows = [
      entry({
        id: 1n,
        amountCents: 100_000n,
        balanceAfterCents: 100_000n,
        occurredAt: '2026-08-10T00:00:00.000Z',
      }),
      entry({
        id: 2n,
        amountCents: 40_000n,
        provenance: 'correction',
        balanceAfterCents: 140_000n,
        occurredAt: '2026-08-01T00:00:00.000Z',
      }),
    ].map(toWalletEntryRow);
    expect(balanceOf(rows)).toBe(140_000n);
    expect(withdrawableCents(rows)).toBe(140_000n);
  });
});

// -----------------------------------------------------------------------------
// The FIFO composition
// -----------------------------------------------------------------------------

describe('the FIFO composition, which is what makes source_provenance_summary mean anything', () => {
  function rows(): readonly WalletEntryRow[] {
    return defaultEntries().map(toWalletEntryRow);
  }

  it('takes the OLDEST money first', () => {
    const composed = composeWithdrawal(rows(), 100_000n);
    expect(composed?.entries).toStrictEqual([{ provenance: 'payout', cents: 100_000 }]);
    expect(composed?.earliestCreditAt).toStrictEqual(new Date('2026-08-01T00:00:00.000Z'));
  });

  it('spans two lots when one does not cover the amount, in FIFO order', () => {
    const composed = composeWithdrawal(rows(), 350_000n);
    expect(composed?.entries).toStrictEqual([
      { provenance: 'payout', cents: 300_000 },
      { provenance: 'refund_wallet_funded', cents: 50_000 },
    ]);
  });

  it('LETS DEBITS CONSUME THE OLDEST CREDITS, which is the half that makes it right', () => {
    // 300,000c payout, then a 300,000c purchase debit, then 90,000c refund.
    // The payout is SPENT, so a 90,000c withdrawal is entirely refund money.
    const spent = [
      entry({
        id: 1n,
        amountCents: 300_000n,
        provenance: 'payout',
        balanceAfterCents: 300_000n,
        occurredAt: '2026-08-01T00:00:00.000Z',
      }),
      entry({
        id: 2n,
        direction: 'debit',
        amountCents: 300_000n,
        provenance: 'payout',
        balanceAfterCents: 0n,
        occurredAt: '2026-08-05T00:00:00.000Z',
      }),
      entry({
        id: 3n,
        amountCents: 90_000n,
        provenance: 'refund_wallet_funded',
        balanceAfterCents: 90_000n,
        occurredAt: '2026-08-10T00:00:00.000Z',
      }),
    ].map(toWalletEntryRow);
    const composed = composeWithdrawal(spent, 90_000n);
    expect(composed?.entries).toStrictEqual([
      { provenance: 'refund_wallet_funded', cents: 90_000 },
    ]);
    expect(composed?.earliestCreditAt).toStrictEqual(new Date('2026-08-10T00:00:00.000Z'));
  });

  it('aggregates one entry per provenance in first-consumed order', () => {
    const interleaved = [
      entry({
        id: 1n,
        amountCents: 10_000n,
        provenance: 'payout',
        balanceAfterCents: 10_000n,
        occurredAt: '2026-08-01T00:00:00.000Z',
      }),
      entry({
        id: 2n,
        amountCents: 10_000n,
        provenance: 'correction',
        balanceAfterCents: 20_000n,
        occurredAt: '2026-08-02T00:00:00.000Z',
      }),
      entry({
        id: 3n,
        amountCents: 10_000n,
        provenance: 'payout',
        balanceAfterCents: 30_000n,
        occurredAt: '2026-08-03T00:00:00.000Z',
      }),
    ].map(toWalletEntryRow);
    expect(composeWithdrawal(interleaved, 30_000n)?.entries).toStrictEqual([
      { provenance: 'payout', cents: 20_000 },
      { provenance: 'correction', cents: 10_000 },
    ]);
  });

  it('breaks the tie on `id` when two entries share an instant', () => {
    const tied = [
      entry({
        id: 2n,
        amountCents: 10_000n,
        provenance: 'correction',
        balanceAfterCents: 20_000n,
        occurredAt: '2026-08-01T00:00:00.000Z',
      }),
      entry({
        id: 1n,
        amountCents: 10_000n,
        provenance: 'payout',
        balanceAfterCents: 10_000n,
        occurredAt: '2026-08-01T00:00:00.000Z',
      }),
    ].map(toWalletEntryRow);
    // `id` 1 is older, so `payout` composes first even though the array is not
    // in that order and the instants are equal.
    expect(composeWithdrawal(tied, 15_000n)?.entries[0]).toStrictEqual({
      provenance: 'payout',
      cents: 10_000,
    });
  });

  it('returns null rather than an empty array when the lots do not cover it', () => {
    expect(composeWithdrawal(rows(), 400_000n)).toBeNull();
    // `'[]'::jsonb <> '{}'::jsonb` is TRUE, so an empty array would satisfy
    // `wallet_withdrawals_approved_has_provenance` while carrying nothing.
    // This module never writes one.
    expect(composeWithdrawal(rows(), 0n)).toBeNull();
  });

  it('THROWS when the recomputed balance disagrees with the stored one', () => {
    const tampered = [
      entry({
        id: 1n,
        amountCents: 100_000n,
        balanceAfterCents: 999_999n,
        occurredAt: '2026-08-01T00:00:00.000Z',
      }),
    ].map(toWalletEntryRow);
    expect(() => unspentLots(tampered)).toThrow(/does not equal the stored running balance/);
  });

  it('THROWS on a debit that consumes more than the credits before it', () => {
    const impossible = [
      entry({
        id: 1n,
        direction: 'debit',
        amountCents: 10_000n,
        balanceAfterCents: 0n,
        occurredAt: '2026-08-01T00:00:00.000Z',
      }),
    ].map(toWalletEntryRow);
    expect(() => unspentLots(impossible)).toThrow(/consumes more than the credits before it/);
  });

  it('refuses a row whose amount is not positive, which the column CHECKs', () => {
    expect(() =>
      toWalletEntryRow({
        id: 1n,
        direction: 'credit',
        amountCents: 0n,
        provenance: 'payout',
        balanceAfterCents: 0n,
        occurredAt: new Date(),
      }),
    ).toThrow(/amount_cents/);
  });

  it('refuses a money column that arrives as a `number`', () => {
    expect(() =>
      toWalletEntryRow({
        id: 1n,
        direction: 'credit',
        amountCents: 100,
        provenance: 'payout',
        balanceAfterCents: 100n,
        occurredAt: new Date(),
      }),
    ).toThrow(/is not a bigint/);
  });
});

// -----------------------------------------------------------------------------
// `G-DESTINATION-COOLING`, against `0051`'s registry
// -----------------------------------------------------------------------------

describe('G-DESTINATION-COOLING, and the absent row that is not `not cooling`', () => {
  it('REGISTERS AN UNKNOWN DESTINATION AND COOLS IT, which is ADR-169 s obligation', async () => {
    const res = await withdraw();
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('cooling');
    expect(res.json().cooling_until).toBe(WINDOW_END.toISOString());
    expect(fixture.registered).toStrictEqual([
      { destinationRef: DESTINATION, firstSeenAt: NOW, coolingUntil: WINDOW_END },
    ]);
    expect((fixture.written[0] as WithdrawalInsert).status).toBe('cooling');
  });

  it('holds a destination whose window is still running', async () => {
    const until = new Date('2026-08-28T00:00:00.000Z');
    fixture.destinations.set(DESTINATION, {
      firstSeenAt: new Date('2026-08-26T00:00:00.000Z'),
      coolingUntil: until,
    });
    const res = await withdraw();
    expect(res.json().status).toBe('cooling');
    expect(res.json().cooling_until).toBe(until.toISOString());
    // NOTHING IS WRITTEN TO THE REGISTRY. `PAYOUT-DEST-C1` permits equality and
    // refuses a backward move, and a re-registration inside a longer window is
    // a no-op -- so this route does not make one.
    expect(fixture.registered).toStrictEqual([]);
  });

  it('CLEARS a destination whose window has elapsed, and does NOT re-arm it', async () => {
    fixture.destinations.set(DESTINATION, {
      firstSeenAt: new Date('2026-08-20T00:00:00.000Z'),
      coolingUntil: new Date('2026-08-22T00:00:00.000Z'),
    });
    const res = await withdraw();
    expect(res.json().status).toBe('requested');
    expect(res.json().cooling_until).toBeNull();
    expect(fixture.registered).toStrictEqual([]);
  });

  it('is strict at the boundary: cooling while `now < cooling_until`', () => {
    const row: DestinationRow = { firstSeenAt: NOW, coolingUntil: NOW };
    expect(coolingDecision(row, NOW).kind).toBe('cleared');
    expect(coolingDecision({ ...row, coolingUntil: new Date(NOW.getTime() + 1) }, NOW).kind).toBe(
      'cooling',
    );
    expect(coolingDecision(undefined, NOW).kind).toBe('register');
  });

  it('arms a fresh window 48 wall-clock hours out', () => {
    const decision = coolingDecision(undefined, NOW);
    expect(decision.kind).toBe('register');
    if (decision.kind === 'cleared') throw new Error('unreachable');
    expect(decision.until.getTime() - NOW.getTime()).toBe(48 * 60 * 60 * 1000);
  });

  it('DOES NOT REGISTER A DESTINATION FOR A REQUEST THAT THEN REFUSES', async () => {
    // The refusal is thrown out of the transaction and the staging copy is
    // discarded. `first_seen_at` is immutable under `PAYOUT-DEST-C1`, so a row
    // written by a doomed request is a security record nothing can correct.
    fixture.entries = [];
    const res = await withdraw();
    expect(res.statusCode).toBe(422);
    expect(fixture.registered).toStrictEqual([]);
    expect(fixture.destinations.has(DESTINATION)).toBe(false);
    expect(fixture.written).toStrictEqual([]);
  });

  it('treats a different destination string as a different destination', async () => {
    fixture.destinations.set(DESTINATION, {
      firstSeenAt: new Date('2026-08-20T00:00:00.000Z'),
      coolingUntil: new Date('2026-08-22T00:00:00.000Z'),
    });
    // Byte-exact `text` and no case folding, `0051`'s own foreclosure.
    const res = await withdraw({ destination: DESTINATION.toUpperCase() });
    expect(res.json().status).toBe('cooling');
    expect(fixture.registered).toHaveLength(1);
  });
});

// -----------------------------------------------------------------------------
// Idempotency
// -----------------------------------------------------------------------------

describe('the idempotency key, which the schema makes required', () => {
  it('returns the original response VERBATIM on a replay of the same body', async () => {
    fixture.destinations.set(DESTINATION, {
      firstSeenAt: new Date('2026-08-20T00:00:00.000Z'),
      coolingUntil: new Date('2026-08-22T00:00:00.000Z'),
    });
    const first = await withdraw({ key: 'replay-1' });
    const second = await withdraw({ key: 'replay-1' });
    expect(second.statusCode).toBe(first.statusCode);
    expect(second.json()).toStrictEqual(first.json());
    // ONE ROW, and this is the assertion the whole layer exists for: a replay
    // that re-ran the handler would be a second withdrawal.
    expect(fixture.written).toHaveLength(1);
  });

  it('answers `idempotency_key_reuse` to the same key with a different body', async () => {
    fixture.destinations.set(DESTINATION, {
      firstSeenAt: new Date('2026-08-20T00:00:00.000Z'),
      coolingUntil: new Date('2026-08-22T00:00:00.000Z'),
    });
    await withdraw({ key: 'reuse-1' });
    const second = await withdraw({ key: 'reuse-1', amount: 200_000 });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('idempotency_key_reuse');
    expect(fixture.written).toHaveLength(1);
  });

  it('does NOT stamp the key on a refusal, so a fixed cause can be retried', async () => {
    fixture.identity = { status: 'restricted', payoutsFrozen: false };
    const refused = await withdraw({ key: 'retry-1' });
    expect(refused.statusCode).toBe(422);

    fixture.identity = { status: 'active', payoutsFrozen: false };
    fixture.destinations.set(DESTINATION, {
      firstSeenAt: new Date('2026-08-20T00:00:00.000Z'),
      coolingUntil: new Date('2026-08-22T00:00:00.000Z'),
    });
    const retried = await withdraw({ key: 'retry-1' });
    // The key row exists and carries no response, so this is `in_flight` and a
    // 409 rather than a replay of the refusal. THE REFUSAL IS NOT WHAT COMES
    // BACK, which is the property this case is about.
    expect(retried.json().code).not.toBe(IDENTITY_RESTRICTED);
  });

  it('does not let one identity s key be read by another', async () => {
    fixture.destinations.set(DESTINATION, {
      firstSeenAt: new Date('2026-08-20T00:00:00.000Z'),
      coolingUntil: new Date('2026-08-22T00:00:00.000Z'),
    });
    await withdraw({ key: 'scoped-1' });
    sessionFor = { ...SESSION, identityId: OTHER_IDENTITY };
    const other = await withdraw({ key: 'scoped-1' });
    // `key_held_elsewhere` is a 409 conflict and NOT the first caller's body.
    expect(other.statusCode).toBe(409);
    expect(other.json().code).toBe('conflict');
  });
});

// -----------------------------------------------------------------------------
// The unwired default
// -----------------------------------------------------------------------------

describe('an unwired deployment answers 503 and never a fixture', () => {
  it('refuses every method rather than returning a plausible withdrawal', async () => {
    resetWithdrawalBackend();
    expect(UNWIRED_WITHDRAWAL_BACKEND.now()).toBeInstanceOf(Date);
    const res = await withdraw();
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('service_unavailable');
  });
});

// -----------------------------------------------------------------------------
// P-1, reported rather than implemented
// -----------------------------------------------------------------------------

describe('provenance_review is false because its input does not exist', () => {
  it('is false on every composition, including one made of payout credits', () => {
    const composition: readonly CompositionEntry[] = [
      { provenance: 'payout', cents: 150_000 },
      { provenance: 'refund_wallet_funded', cents: 90_000 },
      { provenance: 'correction', cents: 10_000 },
    ];
    expect(provenanceReview(composition)).toBe(false);
    expect(provenanceReview([])).toBe(false);
  });

  it('is on the response, so the day the input lands the field is already there', async () => {
    fixture.destinations.set(DESTINATION, {
      firstSeenAt: new Date('2026-08-20T00:00:00.000Z'),
      coolingUntil: new Date('2026-08-22T00:00:00.000Z'),
    });
    expect((await withdraw()).json()).toHaveProperty('provenance_review', false);
  });
});

// -----------------------------------------------------------------------------
// The adapter, against a recorder
// -----------------------------------------------------------------------------
// THE SHARED `db-recorder.ts` IS NOT USED HERE AND THE REASON IS A FENCE. That
// file offers `rows`, `rowsWhere`, `rowAt`, `updateAt`, `deleteAt` and `insert`
// and carries NEITHER `lockScope` NOR `lockAt`, because it predates ADR-157;
// an adapter that takes the lock would meet `undefined` there. Extending it is
// one method in a file this slice does not hold, so the recorder below is
// local, it is the same idiom, and the gap is reported rather than reached for.
//
// WHAT IT PROVES AND WHAT IT CANNOT. It proves which door was opened, whose
// identity was handed to it, which key and which address were named, and which
// values were written. It proves NOTHING about whether the composed predicate
// reaches one row or many, or whether the lock serialises anything, which are
// `packages/db`'s and are asserted there. A suite that claimed otherwise would
// be agreeing with its own fake.

interface RecordedCall {
  readonly verb: string;
  readonly key?: string;
  readonly address?: unknown;
  readonly values?: unknown;
}

function recordingDb(replies: {
  rows?: Record<string, unknown[]>;
  rowAt?: unknown;
  insert?: unknown[];
}): { db: ApiDbLike; calls: RecordedCall[]; openedFor: string[] } {
  const calls: RecordedCall[] = [];
  const openedFor: string[] = [];
  const handle = {
    lockScope: () => {
      calls.push({ verb: 'lockScope' });
      return Promise.resolve({});
    },
    sqlExecutor: () => {
      throw new Error('the recorder offers no sqlExecutor: no adapter here may reach for one');
    },
    rows: (key: string) => {
      calls.push({ verb: 'rows', key });
      return Promise.resolve(replies.rows?.[key] ?? []);
    },
    rowAt: (key: string, address: unknown) => {
      calls.push({ verb: 'rowAt', key, address });
      return Promise.resolve(replies.rowAt);
    },
    insert: (key: string, values: unknown) => {
      calls.push({ verb: 'insert', key, values });
      return Promise.resolve(replies.insert ?? [{ id: 'withdrawal-db-1' }]);
    },
  };
  const db = {
    scoped: <T>(identityId: string, fn: (tx: never) => Promise<T>): Promise<T> => {
      openedFor.push(identityId);
      return fn(handle as never);
    },
    firm: <T>(fn: (tx: never) => Promise<T>): Promise<T> => fn(handle as never),
    ...NO_PRE_IDENTITY_DOORS,
  };
  return { db: db as ApiDbLike, calls, openedFor };
}

/** `ApiDb`'s shape, named locally so this file imports no `@merit/db` type. */
type ApiDbLike = Parameters<typeof databaseWithdrawalBackend>[0];

describe('databaseWithdrawalBackend reads and writes through the accessor', () => {
  // THE ADAPTER IS DRIVEN DIRECTLY AND NOT THROUGH THE ROUTE, because
  // `databaseWithdrawalBackend` supplies the UNWIRED idempotency store on
  // purpose -- `idempotency.ts`'s header records that no `IdempotencyStore`
  // implementation exists in this tree at all, so a request through the route
  // answers 503 before a transaction opens. That is asserted as its own case
  // below rather than worked around.
  function seeded(rowAt: unknown): ReturnType<typeof recordingDb> {
    return recordingDb({
      rows: {
        identities: [{ status: 'active', payoutsFrozen: false }],
        kycVerifications: [{ id: 'k', state: 'verified', supersedes: null }],
        walletWithdrawals: [],
        walletEntries: defaultEntries(),
      },
      rowAt,
    });
  }

  const elapsed = {
    firstSeenAt: new Date('2026-08-20T00:00:00.000Z'),
    coolingUntil: new Date('2026-08-22T00:00:00.000Z'),
  };

  function run(recorder: ReturnType<typeof recordingDb>, key = 'db-key-1'): Promise<unknown> {
    return databaseWithdrawalBackend(recorder.db, () => NOW).transact(SESSION, (tx) =>
      decideWithdrawal({
        tx,
        amountCents: 150_000n,
        destinationRef: DESTINATION,
        idempotencyKey: key,
        at: NOW,
      }),
    );
  }

  it('opens the SCOPED door with the session s identity and takes the lock FIRST', async () => {
    const recorder = seeded(elapsed);
    await run(recorder);
    expect(recorder.openedFor).toStrictEqual([IDENTITY]);
    expect(recorder.calls.map((c) => `${c.verb} ${c.key ?? ''}`.trim())).toStrictEqual([
      'lockScope',
      'rows identities',
      'rows kycVerifications',
      'rows walletWithdrawals',
      'rows walletEntries',
      'rowAt payoutDestinations',
      'insert walletWithdrawals',
    ]);
  });

  it('NAMES ONLY `destinationRef` IN THE DESTINATION ADDRESS, never the identity', async () => {
    const recorder = seeded(undefined);
    await run(recorder);

    const lookup = recorder.calls.find((c) => c.verb === 'rowAt');
    // `0051`'s primary key is `(identity_id, destination_ref)` and
    // `identity_id` is the tenancy column, which `refusePinnedColumn` REFUSES
    // from a caller and `refuseUnaddressed` counts toward the unique key
    // anyway. A caller naming it would throw, which is ADR-112's second draft.
    expect(lookup?.address).toStrictEqual({ destinationRef: DESTINATION });

    const registered = recorder.calls.find(
      (c) => c.verb === 'insert' && c.key === 'payoutDestinations',
    );
    expect(registered?.values).toStrictEqual({
      destinationRef: DESTINATION,
      firstSeenAt: NOW,
      coolingUntil: WINDOW_END,
    });
    expect(Object.keys(registered?.values as object)).not.toContain('identityId');
  });

  it('writes the withdrawal with no identity column, no ledger call and no raw SQL', async () => {
    const recorder = seeded(elapsed);
    await run(recorder);

    const write = recorder.calls.find((c) => c.verb === 'insert' && c.key === 'walletWithdrawals');
    expect(write?.values).toStrictEqual({
      amountCents: 150_000n,
      destinationRef: DESTINATION,
      status: 'requested',
      idempotencyKey: 'db-key-1',
      requestedAt: NOW,
      sourceProvenanceSummary: [{ provenance: 'payout', cents: 150_000 }],
      earliestCreditAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    expect(Object.keys(write?.values as object)).not.toContain('identityId');
    // NO LEDGER WRITE ANYWHERE, which is the mechanical half of the module
    // header's claim, and NO `sqlExecutor`: the recorder throws if an adapter
    // reaches for one, which is P5 rule 10's reach-around.
    expect(recorder.calls.filter((c) => (c.key ?? '').startsWith('ledger'))).toStrictEqual([]);
    expect(recorder.calls.some((c) => c.verb === 'sqlExecutor')).toBe(false);
  });

  it('refuses a scoped `identities` read that does not return exactly one row', async () => {
    const recorder = recordingDb({ rows: { identities: [] } });
    // A THROW rather than a refusal: the registry's only `root` rule returns
    // the caller's own row, so zero rows is Merit's records disagreeing with
    // the session it just authenticated, and that is not the trader's fault.
    await expect(run(recorder)).rejects.toThrow(/returned 0 rows/);
  });

  it('installs the REAL idempotency store, over the scoped door', async () => {
    // THIS CASE REPLACES ONE THAT ASSERTED A 503, AND THE REPLACEMENT IS A
    // CORRECTION. The adapter supplied the unwired store on the strength of
    // `idempotency.ts`'s header, which says no `IdempotencyStore` implementation
    // exists in this tree and is STALE: `databaseIdempotencyStore` is at
    // `src/idempotency-store.ts:144` and has its own suite. The port is
    // therefore wireable, `start.ts` installs it, and `wiring.test.ts` counts it
    // among the wired rather than among the blocked.
    const recorder = recordingDb({});
    const store = databaseWithdrawalBackend(recorder.db, () => NOW).idempotency;
    expect(await store.find(identityScope(IDENTITY), 'k')).toBeNull();
    expect(recorder.openedFor).toStrictEqual([IDENTITY]);
    expect(recorder.calls).toStrictEqual([
      { verb: 'rowAt', key: 'idempotencyKeys', address: { key: 'k' } },
    ]);
  });
});

// -----------------------------------------------------------------------------
// THE APPROVAL EDGE, AND THE LOCKOUT IT DOES NOT END. ADR-232
// -----------------------------------------------------------------------------

/** A `wallet_withdrawals` row as the accessor returns it, camel cased. */
function openRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'withdrawal-1',
    status: 'requested',
    amountCents: 150_000n,
    destinationRef: DESTINATION,
    sourceProvenanceSummary: [{ provenance: 'payout', cents: 150_000 }],
    earliestCreditAt: new Date('2026-08-01T00:00:00.000Z'),
    frozenAt: null,
    ...over,
  };
}

/** A destination whose 48 hour window elapsed before {@link NOW}. */
function settledDestination(): void {
  fixture.destinations.set(DESTINATION, {
    firstSeenAt: new Date('2026-08-20T00:00:00.000Z'),
    coolingUntil: new Date('2026-08-22T00:00:00.000Z'),
  });
}

function drive(hand: ApprovalHand | null = null, at: Date = NOW): Promise<unknown> {
  return backend.transact(SESSION, (tx) => driveApprovals({ tx, hand, at }));
}

/** One `wallet_withdrawals` row as {@link decideCancellation} reads it. ADR-234. */
function candidateRow(over: Record<string, unknown> = {}): WithdrawalApprovalCandidate {
  return toApprovalCandidate(openRow(over));
}

function cancel(id: string, at: Date = NOW): Promise<CancellationOutcome> {
  return backend.transact(SESSION, (tx) => driveCancellation({ tx, id, at }));
}

describe('the approval edge does not release the identity, and that is asserted rather than argued', () => {
  it('partitions `wallet_withdrawal_status` into the open four and the terminal three', () => {
    // `0001:95-98` declares seven members. The two lists are complements, so a
    // future eighth value that joins neither is a case this assertion sees.
    expect([...OPEN_WITHDRAWAL_STATUSES, ...TERMINAL_WITHDRAWAL_STATUSES].sort()).toStrictEqual([
      'approved',
      'cancelled',
      'cooling',
      'failed',
      'requested',
      'settled',
      'transferring',
    ]);
  });

  it('reports `approved` as OPEN, which is the premise the blocked port reasoned past', () => {
    // THE WHOLE FINDING IN ONE LINE. `wiring.test.ts`'s entry for
    // `useWithdrawalBackend` reads the missing approval edge as the thing
    // between a wired backend and a permanent per-trader lockout. Approval
    // moves the row from one open status to another.
    expect(withdrawalReleasesIdentity('approved')).toBe(false);
    expect(withdrawalReleasesIdentity('transferring')).toBe(false);
    for (const status of TERMINAL_WITHDRAWAL_STATUSES)
      expect(withdrawalReleasesIdentity(status)).toBe(true);
  });

  it('STILL refuses a second withdrawal after the first is approved', async () => {
    // The test the dispatch asked for, run against what the enum actually says.
    // It was written expecting a 200 and it is a 409, and the 409 is correct.
    settledDestination();
    fixture.withdrawals = [openRow()];

    const outcomes = await drive();
    expect(outcomes).toStrictEqual([
      {
        id: 'withdrawal-1',
        decision: expect.objectContaining({ kind: 'approve', guard: 'G-WITHDRAWAL-CLEARED' }),
      },
    ]);
    expect(fixture.withdrawals[0]?.['status']).toBe('approved');

    const res = await withdraw();
    expect(res.statusCode).toBe(409);
  });

  it('accepts a second withdrawal once the first reaches a TERMINAL status', async () => {
    // THE NO-LOCKOUT PROPERTY, ASSERTED DIRECTLY AND OVER ALL THREE EXITS.
    // These are the edges that release an identity, and nothing in this tree
    // drives any of them either.
    for (const status of TERMINAL_WITHDRAWAL_STATUSES) {
      reset();
      settledDestination();
      fixture.withdrawals = [openRow({ status })];

      const res = await withdraw();
      expect(res.statusCode, `a ${status} withdrawal should not block the next one`).toBe(200);
    }
  });
});

describe('the transition, decided', () => {
  const identity: IdentityRow = { status: 'active', payoutsFrozen: false };
  const cleared: DestinationRow = {
    firstSeenAt: new Date('2026-08-20T00:00:00.000Z'),
    coolingUntil: new Date('2026-08-22T00:00:00.000Z'),
  };

  function decide(over: {
    candidate?: Record<string, unknown>;
    identity?: IdentityRow;
    kyc?: KycState;
    destination?: DestinationRow | undefined;
    hand?: ApprovalHand | null;
  }): ReturnType<typeof decideApproval> {
    return decideApproval({
      candidate: toApprovalCandidate(openRow(over.candidate ?? {})),
      identity: over.identity ?? identity,
      kyc: over.kyc ?? 'verified',
      destination: 'destination' in over ? over.destination : cleared,
      hand: over.hand ?? null,
      at: NOW,
    });
  }

  it('takes `requested --> approved` under G-WITHDRAWAL-CLEARED', () => {
    expect(decide({})).toStrictEqual({
      kind: 'approve',
      guard: 'G-WITHDRAWAL-CLEARED',
      values: {
        status: 'approved',
        approvedAt: NOW,
        approvedBy: null,
        dualControlApprovalId: null,
        dualControlThresholdCents: null,
        updatedAt: NOW,
      },
    });
  });

  it('takes `cooling --> approved` under G-COOLING-ELAPSED, and holds while the window runs', () => {
    const candidate = { status: 'cooling' };
    expect(decide({ candidate })).toStrictEqual(
      expect.objectContaining({ kind: 'approve', guard: 'G-COOLING-ELAPSED' }),
    );
    expect(
      decide({
        candidate,
        destination: { firstSeenAt: NOW, coolingUntil: new Date(NOW.getTime() + 1) },
      }),
    ).toStrictEqual({ kind: 'hold', hold: 'destination_cooling' });
  });

  it('carries every term of G-WITHDRAWAL-CLEARED onto the `cooling` arm as well', () => {
    // THE GUARD TABLE GIVES G-COOLING-ELAPSED ONE TERM AND THIS FILE APPLIES
    // FOUR. A guard that gets weaker the longer you wait is a queue an
    // attacker joins.
    const candidate = { status: 'cooling' };
    expect(decide({ candidate, kyc: 'expired' })).toStrictEqual({
      kind: 'hold',
      hold: 'kyc_not_verified',
    });
    expect(
      decide({ candidate, identity: { status: 'restricted', payoutsFrozen: false } }),
    ).toStrictEqual({ kind: 'hold', hold: 'identity_not_active' });
  });

  it('holds on every guard term, one case each', () => {
    expect(decide({ candidate: { status: 'approved' } })).toStrictEqual({
      kind: 'hold',
      hold: 'not_approvable',
    });
    expect(decide({ candidate: { status: 'settled' } })).toStrictEqual({
      kind: 'hold',
      hold: 'not_approvable',
    });
    expect(decide({ identity: { status: 'closed', payoutsFrozen: false } })).toStrictEqual({
      kind: 'hold',
      hold: 'identity_not_active',
    });
    expect(decide({ identity: { status: 'active', payoutsFrozen: true } })).toStrictEqual({
      kind: 'hold',
      hold: 'payouts_frozen',
    });
    expect(decide({ kyc: 'pending' })).toStrictEqual({ kind: 'hold', hold: 'kyc_not_verified' });
    expect(decide({ candidate: { frozenAt: NOW } })).toStrictEqual({
      kind: 'hold',
      hold: 'halted',
    });
    expect(decide({ candidate: { sourceProvenanceSummary: [] } })).toStrictEqual({
      kind: 'hold',
      hold: 'provenance_missing',
    });
    expect(decide({ candidate: { earliestCreditAt: null } })).toStrictEqual({
      kind: 'hold',
      hold: 'provenance_missing',
    });
    expect(decide({ destination: undefined })).toStrictEqual({
      kind: 'hold',
      hold: 'destination_cooling',
    });
  });

  it('holds `halted` while a live freeze runs, which no approved document rules', () => {
    // FAIL CLOSED AND REPORTED AS OWED. `0031` refuses `settled` under a live
    // freeze and says nothing about `approved`, and approval is where `LT-06`
    // moves the balance into the firm's obligation (M06 INV-M6-15).
    expect(decide({ candidate: { frozenAt: new Date('2026-08-26T00:00:00.000Z') } })).toStrictEqual(
      {
        kind: 'hold',
        hold: 'halted',
      },
    );
  });
});

describe('the dual control that belongs on the approval edge', () => {
  const alice: ApprovalHand = { approvedBy: 'ops:alice', dualControlApprovalId: null };
  const seconded: ApprovalHand = { approvedBy: 'ops:alice', dualControlApprovalId: 'dca-1' };

  it('never asks a MACHINE approval for a second person, at any amount', () => {
    // ADR-232 section 4. Both guards on this edge name no human, so there is
    // no first approver for a second to check, and a trader locked out of
    // their own money by a control meant to stop operator fraud is a worse
    // product than the fraud.
    expect(dualControlRequired(100_000_000n, null)).toBe(false);
    expect(dualControlRequired(DUAL_CONTROL_THRESHOLD_CENTS, null)).toBe(false);
  });

  it('asks a NAMED OPERATOR for one at and above 500000 integer cents', () => {
    expect(DUAL_CONTROL_THRESHOLD_CENTS).toBe(500_000n);
    expect(dualControlRequired(DUAL_CONTROL_THRESHOLD_CENTS - 1n, alice)).toBe(false);
    // `>=`, and `0070` carries the identical comparison. A route that
    // disagreed with its own CHECK would fail at COMMIT rather than refuse.
    expect(dualControlRequired(DUAL_CONTROL_THRESHOLD_CENTS, alice)).toBe(true);
    expect(dualControlRequired(DUAL_CONTROL_THRESHOLD_CENTS + 1n, alice)).toBe(true);
  });

  it('holds an operator approval at the threshold until a second person has signed', async () => {
    settledDestination();
    fixture.withdrawals = [openRow({ amountCents: DUAL_CONTROL_THRESHOLD_CENTS })];

    expect(await drive(alice)).toStrictEqual([
      { id: 'withdrawal-1', decision: { kind: 'hold', hold: 'dual_control_required' } },
    ]);
    expect(fixture.approved).toStrictEqual([]);
    expect(fixture.withdrawals[0]?.['status']).toBe('requested');
  });

  it('writes the approver, the citation and the threshold when one has', async () => {
    settledDestination();
    fixture.withdrawals = [openRow({ amountCents: DUAL_CONTROL_THRESHOLD_CENTS })];

    await drive(seconded);

    expect(fixture.approved).toStrictEqual([
      {
        id: 'withdrawal-1',
        values: {
          status: 'approved',
          approvedAt: NOW,
          approvedBy: 'ops:alice',
          dualControlApprovalId: 'dca-1',
          // RECORDED AND NOT SOURCED. `0070`'s ceiling refuses anything above
          // this, so a writer may tighten the control and may not loosen it.
          dualControlThresholdCents: DUAL_CONTROL_THRESHOLD_CENTS,
          updatedAt: NOW,
        },
      },
    ]);
  });

  it('records NEITHER an approver NOR a threshold on the machine arm', async () => {
    // `wallet_withdrawals_operator_approval_records_threshold` and
    // `wallet_withdrawals_unapproved_records_no_approval` (`0070`) read
    // together: the machine arm writes neither column.
    settledDestination();
    fixture.withdrawals = [openRow({ amountCents: 100_000_000n })];

    await drive();

    const values = fixture.approved[0]?.values as WithdrawalApprovalValues;
    expect(values.approvedBy).toBeNull();
    expect(values.dualControlThresholdCents).toBeNull();
    expect(values.dualControlApprovalId).toBeNull();
  });

  it('lets a sub-threshold operator approval through with no second person', async () => {
    settledDestination();
    fixture.withdrawals = [openRow({ amountCents: DUAL_CONTROL_THRESHOLD_CENTS - 1n })];

    await drive(alice);

    expect(fixture.approved[0]?.values.approvedBy).toBe('ops:alice');
    expect(fixture.approved[0]?.values.dualControlApprovalId).toBeNull();
  });
});

describe('the transition over one transaction', () => {
  it('takes the per-identity lock BEFORE it reads anything', async () => {
    // This file's header: `wallet_withdrawals_open_idx` is not unique, so two
    // doors advancing one identity would both read `requested` and both write.
    settledDestination();
    fixture.withdrawals = [openRow()];

    await drive();

    expect(fixture.calls[0]).toBe('lockScope');
    expect(fixture.calls).toContain('approveWithdrawal:withdrawal-1');
  });

  it('skips a row that is not at an approvable status without reading its destination', async () => {
    settledDestination();
    fixture.withdrawals = [openRow({ status: 'transferring' })];

    expect(await drive()).toStrictEqual([]);
    expect(fixture.calls).not.toContain(`destination:${DESTINATION}`);
  });

  it('decides each open row on its own destination', async () => {
    settledDestination();
    fixture.destinations.set('rise_dest_bbbb2222', {
      firstSeenAt: NOW,
      coolingUntil: new Date(NOW.getTime() + DESTINATION_COOLING_WINDOW_MS),
    });
    fixture.withdrawals = [
      openRow(),
      openRow({ id: 'withdrawal-2', status: 'cooling', destinationRef: 'rise_dest_bbbb2222' }),
    ];

    expect(await drive()).toStrictEqual([
      { id: 'withdrawal-1', decision: expect.objectContaining({ kind: 'approve' }) },
      { id: 'withdrawal-2', decision: { kind: 'hold', hold: 'destination_cooling' } },
    ]);
  });
});

// -----------------------------------------------------------------------------
// The TERMINAL edge. ADR-234
// -----------------------------------------------------------------------------

/** The repository root, for the findings that are claims about this tree. */
const REPO = join(import.meta.dirname, '..', '..', '..');

/** Every `.ts` and `.json` path under a directory, recursively. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...sourceFiles(path));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.json')) out.push(path);
  }
  return out;
}

describe('the terminal edge, and the two thirds of it that are not built', () => {
  it('names one finding per terminal status and every source resolves to a real file', () => {
    // A REASON POINTING AT A FILE THAT IS NOT THERE IS THE FIRST WAY THIS KIND
    // OF ENTRY ROTS, and `wiring.test.ts` has recorded four reasons in this
    // neighbourhood that did not survive being checked.
    expect(TERMINAL_EDGE_FINDINGS.map((finding) => finding.id)).toStrictEqual(['A', 'B', 'C']);
    for (const finding of TERMINAL_EDGE_FINDINGS) {
      expect(finding.claim.length, `${finding.id} has too short a claim`).toBeGreaterThan(120);
      expect(finding.ruled.length, `${finding.id} has no disposition`).toBeGreaterThan(80);
      for (const source of finding.sources)
        expect(existsSync(join(REPO, source)), `${finding.id} cites a missing ${source}`).toBe(
          true,
        );
    }
  });

  it('RUNS finding A rather than trusting it: `@merit/rail` has no importer at all', () => {
    // THE DECISION PROCEDURE, EXECUTED. `settled` is unreachable because
    // `transferring` is, and `transferring` is reachable only by enqueueing on
    // a rail. The day a consumer lands, this goes red and finding A is due a
    // re-read -- which is the trap it exists to set, in `RI-20`'s idiom.
    // THE NEEDLE IS ASSEMBLED FROM FRAGMENTS AND THAT IS NOT A FLOURISH. This
    // test was written twice and failed twice on ITSELF: a claim about a tree,
    // written into that tree, is a hit on itself. The first spelling searched
    // for the bare package name and found the finding above and this file; the
    // second searched for the import clause and found this file's own comment
    // explaining the first. Assembling the string means the scan needs NO
    // exclusion list at all and stays total over `apps/**` and `packages/**`
    // outside the package itself -- which is the property that makes the day a
    // real consumer lands the day this goes red.
    const needle = ["from '@merit", "/rail'"].join('');
    const scanned = [join(REPO, 'apps'), join(REPO, 'packages')].flatMap(sourceFiles);
    const rail = join(REPO, 'packages', 'rail') + '/';
    const importers = scanned.filter(
      (path) => !path.startsWith(rail) && readFileSync(path, 'utf8').includes(needle),
    );

    expect(importers.map((path) => path.slice(REPO.length + 1))).toStrictEqual([]);
  });

  it('RUNS the other half of finding A: nothing writes `transferring`', () => {
    // The scope is named because the claim is only as good as it: `apps/**` and
    // `packages/**`, every `.ts` and `.json`, EXCLUDING test files, which is
    // where a fixture may legitimately plant the value.
    const scanned = [join(REPO, 'apps'), join(REPO, 'packages')]
      .flatMap(sourceFiles)
      .filter((path) => !path.includes('/test/') && !path.endsWith('.test.ts'));
    const sites = scanned.filter((path) => readFileSync(path, 'utf8').includes("'transferring'"));

    // THREE SITES AND ALL THREE ARE VOCABULARY. `wallet-withdrawals.ts` twice
    // (`OPEN_WITHDRAWAL_STATUSES` and the docblock that quotes the index
    // predicate) and `schema.ts` once (the enum). None is a write, and a
    // fourth file appearing here is the enqueue this finding says does not
    // exist.
    expect(sites.map((path) => path.slice(REPO.length + 1)).sort()).toStrictEqual([
      'apps/api/src/routes/wallet-withdrawals.ts',
      'packages/db/src/schema.ts',
    ]);
  });

  it('RUNS finding A last clause: the only `RailAdapter` implementation is a fake', () => {
    const sandbox = readFileSync(
      join(REPO, 'packages', 'rail', 'src', 'fakes', 'sandbox.ts'),
      'utf8',
    );
    expect(sandbox).toContain('export class SandboxRail implements RailAdapter');

    // TEST FILES ARE OUT OF SCOPE AND THE EXCLUSION IS PART OF THE CLAIM: a
    // stub inside a suite is not an adapter a deployment can send through, and
    // this file itself quotes the line above, which is the self-hit the
    // importer case found first.
    const implementations = sourceFiles(join(REPO, 'packages'))
      .concat(sourceFiles(join(REPO, 'apps')))
      .filter((path) => !path.endsWith('.test.ts'))
      .filter((path) => /implements\s+RailAdapter/.test(readFileSync(path, 'utf8')));

    expect(implementations.map((path) => path.slice(REPO.length + 1))).toStrictEqual([
      'packages/rail/src/fakes/sandbox.ts',
    ]);
  });

  it('RUNS finding C: `0057` rests its cancelled arm on the arrow set `0072` enforces', () => {
    // The two files have to agree, and this is the assertion that makes the
    // agreement checkable rather than a thing two headers both assert.
    const wdc1 = readFileSync(
      join(REPO, 'packages', 'db', 'migrations', '0057_terminal_withdrawal_obligation.sql'),
      'utf8',
    );
    // The sentence is quoted from `COMMENT ON FUNCTION`, which is the half of
    // that file a `pg_catalog` read can see, rather than from the header
    // comment, which only a reader of the file can.
    expect(wdc1).toContain('reachable only from requested and cooling, both before approval');

    const wdc2 = readFileSync(
      join(REPO, 'packages', 'db', 'migrations', '0072_terminal_withdrawal_transitions.sql'),
      'utf8',
    );
    expect(wdc2).toContain(
      "NEW.status = 'cancelled' AND OLD.status NOT IN ('requested', 'cooling')",
    );
    expect(wdc2).toContain('ADD COLUMN cancelled_at timestamptz NULL');
  });
});

describe('`G-TRADER-CANCELS`, decided', () => {
  it('takes the two arrow tails section 3.2 draws and no others', () => {
    expect(CANCELLABLE_STATUSES).toStrictEqual(['requested', 'cooling']);
    // AND THEY ARE BOTH OPEN AND BOTH PRE-APPROVAL, which is the whole reason
    // this exit needs no posting. A member here that released the identity
    // already, or that sat past approval, would be a different edge.
    for (const status of CANCELLABLE_STATUSES) {
      expect(withdrawalReleasesIdentity(status)).toBe(false);
      expect(APPROVABLE_STATUSES as readonly string[]).toContain(status);
    }
  });

  it('cancels from `requested` and from `cooling`, writing the clock `0072` requires', () => {
    for (const status of CANCELLABLE_STATUSES) {
      const decision = decideCancellation({ candidate: candidateRow({ status }), at: NOW });
      expect(decision, status).toStrictEqual({
        kind: 'cancel',
        guard: 'G-TRADER-CANCELS',
        values: { status: 'cancelled', cancelledAt: NOW, updatedAt: NOW },
      });
    }
  });

  it('holds every status that is not one of the two tails', () => {
    // TOTAL OVER THE ENUM rather than over the cases somebody remembered, which
    // is `decideApproval`'s discipline. The three terminal ones matter most,
    // AND THIS COMMENT READ THAT `0072` WOULD CATCH A RE-CANCEL ANYWAY: "a
    // driver that re-cancelled a cancelled row would be refused at the
    // statement rather than here". IT IS FALSE AND ADR-263 SECTION 3 MEASURED
    // IT. `0072`'s trigger fires `WHEN (OLD.status IS DISTINCT FROM
    // NEW.status ...)`, so `cancelled` written over `cancelled` never reaches
    // it; EXECUTED against PostgreSQL 16.13 with every migration applied, that
    // UPDATE lands and MOVES `cancelled_at`. This hold is the only thing
    // refusing it, on the door as in the driver.
    for (const status of [...OPEN_WITHDRAWAL_STATUSES, ...TERMINAL_WITHDRAWAL_STATUSES]) {
      if ((CANCELLABLE_STATUSES as readonly string[]).includes(status)) continue;
      expect(
        decideCancellation({ candidate: candidateRow({ status }), at: NOW }),
        status,
      ).toStrictEqual({ kind: 'hold', hold: 'not_cancellable' });
    }
  });

  it('holds a HALTED row, which is a ruling and not a constraint', () => {
    // ADR-234. EXECUTED against PostgreSQL 16.13 with every migration applied:
    // the DATABASE permits an UPDATE carrying a halted `requested` row to
    // `cancelled`, because the halt is orthogonal to the rail status and no
    // constraint reads it on this arrow. The hold is this module's, on ADR-232
    // section 5's direction: cancelling destroys the subject of the
    // investigation and lets the trader open a fresh withdrawal the same
    // second.
    const decision = decideCancellation({
      candidate: candidateRow({ status: 'requested', frozenAt: NOW }),
      at: NOW,
    });
    expect(decision).toStrictEqual({ kind: 'hold', hold: 'halted' });
  });

  it('declares exactly the two holds it can return', () => {
    expect(CANCELLATION_HOLDS).toStrictEqual(['not_cancellable', 'halted']);
  });
});

describe('the cancellation over one transaction', () => {
  it('takes the per-identity lock BEFORE it reads anything', async () => {
    // The lock matters MORE here than on the approval edge: this transition is
    // the one that makes `gateNoInFlight` start passing, so a cancellation
    // racing a creation would release the identity while the creation was
    // deciding against a set that still held the open row.
    fixture.withdrawals = [openRow()];

    await cancel('withdrawal-1');

    expect(fixture.calls[0]).toBe('lockScope');
    expect(fixture.calls).toContain('cancelWithdrawal:withdrawal-1');
  });

  it('writes the status and the clock and nothing else', async () => {
    fixture.withdrawals = [openRow()];

    const outcome = await cancel('withdrawal-1');

    expect(outcome.decision).toStrictEqual({
      kind: 'cancel',
      guard: 'G-TRADER-CANCELS',
      values: { status: 'cancelled', cancelledAt: NOW, updatedAt: NOW },
    });
    expect(fixture.cancelled).toStrictEqual([
      { id: 'withdrawal-1', values: { status: 'cancelled', cancelledAt: NOW, updatedAt: NOW } },
    ]);
    expect(fixture.withdrawals[0]?.['status']).toBe('cancelled');
  });

  it('holds a row it cannot find, and does not distinguish absent from somebody else`s', async () => {
    // The accessor scopes every read to the caller's identity before this file
    // sees a row, so an id that resolves to nothing is EITHER a row of another
    // trader's OR a row that does not exist. A driver that threw on one and
    // held on the other would answer whether an arbitrary withdrawal id belongs
    // to somebody else.
    fixture.withdrawals = [openRow()];

    expect(await cancel('withdrawal-nobody-has')).toStrictEqual({
      id: 'withdrawal-nobody-has',
      decision: { kind: 'hold', hold: 'not_cancellable' },
    });
    expect(fixture.cancelled).toStrictEqual([]);
  });

  it('writes nothing when it holds', async () => {
    fixture.withdrawals = [openRow({ status: 'approved' })];

    expect((await cancel('withdrawal-1')).decision).toStrictEqual({
      kind: 'hold',
      hold: 'not_cancellable',
    });
    expect(fixture.cancelled).toStrictEqual([]);
    expect(fixture.withdrawals[0]?.['status']).toBe('approved');
  });

  it('cancels the row it was handed and leaves the identity`s others alone', async () => {
    fixture.withdrawals = [openRow(), openRow({ id: 'withdrawal-2', status: 'cooling' })];

    await cancel('withdrawal-2');

    expect(fixture.withdrawals[0]?.['status']).toBe('requested');
    expect(fixture.withdrawals[1]?.['status']).toBe('cancelled');
  });
});

// -----------------------------------------------------------------------------
// THE DELIVERABLE. ADR-234
// -----------------------------------------------------------------------------

describe('THE NO-LOCKOUT PROPERTY, closed end to end and not planted', () => {
  it('request, refuse the second, CANCEL, and the identity is accepted again', async () => {
    // THE SEQUENCE THE ROW ASKED FOR, WITH THE MIDDLE OF IT DRIVEN. ADR-232
    // could only assert this by PLANTING a terminal status on a fixture row,
    // because nothing in the tree reached one. Every state below is reached by
    // the thing that reaches it: the route creates, the route refuses, and
    // `driveCancellation` releases.
    settledDestination();

    const first = await withdraw();
    expect(first.statusCode, 'the first withdrawal').toBe(200);
    const id = first.json().withdrawal_id as string;

    // THE LOCKOUT, MEASURED. This is the 409 the blocked port's reason is about.
    expect((await withdraw()).statusCode, 'the second, while the first is open').toBe(409);

    const outcome = await cancel(id);
    expect(outcome.decision).toStrictEqual({
      kind: 'cancel',
      guard: 'G-TRADER-CANCELS',
      values: { status: 'cancelled', cancelledAt: NOW, updatedAt: NOW },
    });
    expect(withdrawalReleasesIdentity(String(fixture.withdrawals[0]?.['status']))).toBe(true);

    // AND THE LOCKOUT IS OVER.
    expect((await withdraw()).statusCode, 'the third, after the cancellation').toBe(200);
    expect(fixture.written).toHaveLength(2);
  });

  it('and it is the CANCELLATION that opens it, not merely the passage of a request', async () => {
    // THE FALSIFIER. Same sequence with the cancellation removed: if the third
    // request were accepted here too, the test above would be proving nothing
    // about this edge.
    settledDestination();

    expect((await withdraw()).statusCode).toBe(200);
    expect((await withdraw()).statusCode).toBe(409);
    expect((await withdraw()).statusCode).toBe(409);
    expect(fixture.written).toHaveLength(1);
  });

  it('APPROVING the first does NOT open it, which is ADR-232 finding held in place', async () => {
    // The half of the lockout this session does not close, asserted so that the
    // day a door drives `driveApprovals` nobody reads the test above as
    // covering it.
    settledDestination();

    const first = await withdraw();
    expect(first.statusCode).toBe(200);

    const approvals = await backend.transact(SESSION, (tx) =>
      driveApprovals({ tx, hand: null, at: NOW }),
    );
    expect(approvals).toStrictEqual([
      {
        id: first.json().withdrawal_id,
        decision: expect.objectContaining({ kind: 'approve', guard: 'G-WITHDRAWAL-CLEARED' }),
      },
    ]);
    expect(fixture.withdrawals[0]?.['status']).toBe('approved');

    expect((await withdraw()).statusCode, 'approved is still an OPEN status').toBe(409);

    // AND THE CANCEL EDGE DOES NOT RESCUE IT EITHER, because `G-TRADER-CANCELS`
    // is drawn before approval and `0072` refuses the arrow at the database.
    // This is the row that stays locked out until the rail exists.
    expect((await cancel(String(first.json().withdrawal_id))).decision).toStrictEqual({
      kind: 'hold',
      hold: 'not_cancellable',
    });
    expect((await withdraw()).statusCode).toBe(409);
  });
});

// -----------------------------------------------------------------------------
// THE DOOR. ADR-263
// -----------------------------------------------------------------------------

describe('THE DOOR THE EDGE DID NOT HAVE, driven over HTTP', () => {
  it('THE DELIVERABLE: request, refuse the second, CANCEL OVER HTTP, and the third is accepted', async () => {
    // THE PROPERTY THIS SESSION EXISTS FOR, AND EVERY STEP OF IT IS DRIVEN BY
    // THE THING THAT DRIVES IT. ADR-234 closed this sequence against
    // `driveCancellation` called from the suite; a trader cannot call a
    // function. What is asserted here is that a CLIENT can close a withdrawal,
    // which is the difference between an edge and a door.
    settledDestination();

    const first = await withdraw();
    expect(first.statusCode, 'the first withdrawal').toBe(200);
    const id = first.json().withdrawal_id as string;

    expect((await withdraw()).statusCode, 'the second, while the first is open').toBe(409);

    const closed = await cancelOverHttp(id);
    expect(closed.statusCode, 'the cancellation').toBe(200);
    expect(closed.json()).toStrictEqual({
      withdrawal_id: id,
      status: 'cancelled',
      cancelled_at: NOW.toISOString(),
    } satisfies WithdrawalCancellationResponse);

    // THE ROW MOVED, AND IT MOVED THROUGH THE ACCESSOR METHOD THAT WRITES IT.
    expect(fixture.cancelled).toStrictEqual([
      { id, values: { status: 'cancelled', cancelledAt: NOW, updatedAt: NOW } },
    ]);
    expect(withdrawalReleasesIdentity(String(fixture.withdrawals[0]?.['status']))).toBe(true);

    expect((await withdraw()).statusCode, 'the third, after the cancellation').toBe(200);
    expect(fixture.written).toHaveLength(2);
  });

  it('and the third is refused when the cancellation is the only step removed', async () => {
    // THE FALSIFIER FOR THE CASE ABOVE, at the door rather than at the driver.
    settledDestination();

    expect((await withdraw()).statusCode).toBe(200);
    expect((await withdraw()).statusCode).toBe(409);
    expect((await withdraw()).statusCode).toBe(409);
    expect(fixture.cancelled).toStrictEqual([]);
  });

  it('answers ONE byte-identical document for an unknown id and for a row past `approved`', async () => {
    // THE INDISTINGUISHABILITY, ASSERTED AS AN EQUALITY RATHER THAN DESCRIBED.
    // `driveCancellation` holds `not_cancellable` for a row that does not
    // exist, a row of another identity's and the caller's own row at a status
    // `G-TRADER-CANCELS` is not drawn from, and section 13's ruling 1 is that
    // existence is not confirmed to a stranger. A detail naming the row's
    // status would tell the first two apart from the third.
    fixture.withdrawals = [openRow({ status: 'approved' })];

    const past = await cancelOverHttp('withdrawal-1');
    const unknown = await cancelOverHttp('withdrawal-nobody-has');

    expect(past.statusCode).toBe(409);
    expect(unknown.statusCode).toBe(409);
    expect(past.json()).toStrictEqual({ ...unknown.json(), instance: past.json().instance });
    expect(past.json().code).toBe('conflict');
    expect(String(past.json().detail)).toContain('G-TRADER-CANCELS');
    expect(String(past.json().detail)).not.toContain('approved');
    expect(fixture.cancelled).toStrictEqual([]);
  });

  it('answers a DIFFERENT detail for a halted row, which the trader may already see', async () => {
    // The halt is rendered to the trader on a subsequent read (section 6.2), so
    // naming it discloses nothing this surface withholds, and a trader told
    // only "this cannot be cancelled" would retry a refusal that is waiting on
    // an investigation.
    fixture.withdrawals = [openRow({ frozenAt: NOW })];

    const halted = await cancelOverHttp('withdrawal-1');
    expect(halted.statusCode).toBe(409);
    expect(halted.json().code).toBe('conflict');
    expect(String(halted.json().detail)).toContain('investigation');

    fixture.withdrawals = [openRow({ status: 'approved' })];
    const other = await cancelOverHttp('withdrawal-1');
    expect(halted.json().detail).not.toBe(other.json().detail);
    expect(fixture.cancelled).toStrictEqual([]);
  });

  it('THE RETRY WRITES NOTHING, AND THAT IS WHAT KEEPS THE CLOCK STILL', async () => {
    // THIS IS THE ASSERTION THAT STANDS IN FOR A CONSTRAINT THE DATABASE DOES
    // NOT HAVE, AND IT WAS MEASURED RATHER THAN ASSUMED. `0072`'s trigger fires
    // `WHEN (OLD.status IS DISTINCT FROM NEW.status ...)`, so an UPDATE writing
    // `cancelled` over `cancelled` never reaches it and both CHECKs are
    // satisfied by the row it produces. EXECUTED against PostgreSQL 16.13 with
    // all 68 migrations applied forward-only from empty: a second cancellation of an already-cancelled
    // row LANDS and MOVES `cancelled_at`, and an UPDATE of the clock alone
    // backdated it to 2020 (ADR-263 section 3). The status is immutable at the
    // database; the terminal CLOCK is not. So the `not_cancellable` hold is the
    // whole control on this path and there is no second one underneath it.
    settledDestination();
    const id = (await withdraw()).json().withdrawal_id as string;

    expect((await cancelOverHttp(id)).statusCode).toBe(200);
    const retry = await cancelOverHttp(id);

    expect(retry.statusCode, 'the retry').toBe(409);
    expect(fixture.cancelled, 'ONE write, and the clock did not move').toStrictEqual([
      { id, values: { status: 'cancelled', cancelledAt: NOW, updatedAt: NOW } },
    ]);
  });

  it('refuses a non-elevated session before the handler body runs', async () => {
    // C-27's machinery is `authorize`'s and this module adds no second refusal,
    // which is the creation row's rule applied to the row beside it. The
    // evidence that the handler never ran is that the transaction never opened.
    fixture.withdrawals = [openRow()];
    sessionFor = UNELEVATED;

    const res = await cancelOverHttp('withdrawal-1');

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
    expect(fixture.calls).toStrictEqual([]);
    expect(fixture.cancelled).toStrictEqual([]);
  });

  it('answers 401 with no session at all, and never 403', async () => {
    fixture.withdrawals = [openRow()];

    const res = await cancelOverHttp('withdrawal-1', { token: undefined });

    expect(res.statusCode).toBe(401);
    expect(fixture.calls).toStrictEqual([]);
  });

  it('answers 503 on an unwired deployment rather than a fixture cancellation', async () => {
    // The same rule the creation door takes: a backend that answered plausibly
    // would be a fixture telling a trader their request is closed when no row
    // moved. `unwiredOrThrow` is what makes it a 503 and not a 500.
    useWithdrawalBackend(UNWIRED_WITHDRAWAL_BACKEND);

    const res = await cancelOverHttp('withdrawal-1');

    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('service_unavailable');
  });

  it('cancels the row it was addressed at and leaves the identity`s others alone', async () => {
    fixture.withdrawals = [openRow(), openRow({ id: 'withdrawal-2', status: 'cooling' })];

    expect((await cancelOverHttp('withdrawal-2')).statusCode).toBe(200);

    expect(fixture.withdrawals[0]?.['status']).toBe('requested');
    expect(fixture.withdrawals[1]?.['status']).toBe('cancelled');
  });

  it('takes the per-identity lock before it reads, through the door as through the driver', async () => {
    fixture.withdrawals = [openRow()];

    await cancelOverHttp('withdrawal-1');

    expect(fixture.calls[0]).toBe('lockScope');
  });

  it('cancels from `cooling` as well, which is the second tail section 3.2 draws', async () => {
    fixture.withdrawals = [openRow({ status: 'cooling' })];

    expect((await cancelOverHttp('withdrawal-1')).statusCode).toBe(200);
    expect(fixture.withdrawals[0]?.['status']).toBe('cancelled');
  });

  it('is the ONLY door that reaches a terminal status, and the other two are still shut', async () => {
    // ADR-263 BUILDS ONE EDGE'S DOOR AND NAMES THE OTHER TWO. `settled` and
    // `failed` are drawn only out of `transferring`, which is reached by
    // enqueueing on a rail that has no adapter and no importer, so no route in
    // this deployable can put a withdrawal into either. Asserted over the
    // registered surface rather than argued, so the day a settlement door lands
    // this line is what says the finding is due a re-read.
    const registered = buildServer({ surface: 'public', modules: onDisk }).report.registered;
    const withdrawalDoors = registered.filter((endpoint) =>
      endpoint.includes(`${WITHDRAWALS_PATH}/`),
    );

    expect(withdrawalDoors).toStrictEqual([`POST ${WITHDRAWAL_CANCEL_PATH}`]);
  });
});
