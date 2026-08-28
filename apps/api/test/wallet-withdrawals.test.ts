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
  CREATED_STATUSES,
  DESTINATION_COOLING_WINDOW_MS,
  IDENTITY_RESTRICTED,
  INSUFFICIENT_FUNDS,
  KYC_REQUIRED,
  MINIMUM_WITHDRAWAL_CENTS,
  OPEN_WITHDRAWAL_STATUSES,
  PAYOUTS_FROZEN,
  UNWIRED_WITHDRAWAL_BACKEND,
  WALLET_PROVENANCES,
  WITHDRAWALS_ENDPOINT,
  WITHDRAWALS_PATH,
  WITHDRAWAL_REQUIRED_FACTORS,
  balanceOf,
  centsFromJson,
  centsToJson,
  composeWithdrawal,
  coolingDecision,
  databaseWithdrawalBackend,
  decideWithdrawal,
  currentKycState,
  gateIdentityStatus,
  provenanceReview,
  resetWithdrawalBackend,
  toWalletEntryRow,
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
  type WithdrawalInsert,
  type WithdrawalTx,
} from '../src/routes/wallet-withdrawals.ts';

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
        return Promise.resolve(
          fixture.withdrawals.map((row) => ({ status: String(row['status']) })),
        );
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
        return Promise.resolve({ id: `withdrawal-${String(stagedWritten.length)}` });
      },
    };
    const value = await fn(tx);
    fixture.written = stagedWritten;
    fixture.registered = stagedRegistered;
    fixture.destinations = stagedDestinations;
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
  it('requires elevation and carries the C-27 action', () => {
    expect(WITHDRAWAL_REQUIRED_FACTORS).toStrictEqual({
      'POST /wallet/withdrawals': 'passkey or dual_channel',
    });
  });

  it('is registered on the PUBLIC surface and withheld from the operator one', () => {
    const publicSide = buildServer({ surface: 'public', modules: onDisk }).report;
    const operator = buildServer({ surface: 'operator', modules: onDisk }).report;
    expect(publicSide.registered).toContain(WITHDRAWALS_ENDPOINT);
    expect(publicSide.withheld).not.toContain(WITHDRAWALS_ENDPOINT);
    expect(operator.withheld).toContain(WITHDRAWALS_ENDPOINT);
    expect(operator.registered).not.toContain(WITHDRAWALS_ENDPOINT);
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
