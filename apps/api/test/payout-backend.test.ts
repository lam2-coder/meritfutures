// =============================================================================
// apps/api/test/payout-backend.test.ts
// =============================================================================
// THE FIRST `PayoutTx` IN THIS TREE, ASSERTED AS THE FOUR-OF-EIGHT SHAPE IT IS.
//
// ADR-291 (ADR-287 slice 3), then ADR-295's approval branch and ADR-301's lock.
// What this file watches is not only that the live members answer, but that the
// FOUR THAT DO NOT REFUSE VISIBLY: a member that quietly returned a plausible
// value would be a fixture approving payouts, and every one of the four is
// unbuilt for a reason ADR-287 names at a primary source.
//
// IT DRIVES THE ADAPTER AGAINST `db-recorder.ts` AND NOT AGAINST A DATABASE, on
// that file's own stated boundary: what a recorder proves is WHICH DOOR was
// opened, WHOSE identity was handed to it and WHICH TABLE was named. That the
// composed predicate reaches one row is `packages/db`'s property and is asserted
// there.
// =============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ExternalGatesRefusal, PlanRulesCodecError } from '@merit/rules-engine';
import { describe, expect, it } from 'vitest';

import { recordingDb, NO_PRE_IDENTITY_DOORS } from './db-recorder.ts';
import type { ApiDb } from '../src/db.ts';
import { PayoutRowError, postgresPayoutBackend } from '../src/payout-backend.ts';
import { identityScope } from '../src/idempotency.ts';
import { PayoutBackendUnwired } from '../src/routes/payouts.ts';
import type { AuthSession } from '../src/routes/auth.ts';
import type { PayoutRequestInsert } from '../src/routes/payouts.ts';

const IDENTITY = '0199c7a1-1111-7000-8000-000000000501';

/**
 * The session the transaction binds on.
 *
 * ELEVATION IS IRRELEVANT TO THIS FILE AND IS SET ANYWAY, because `AuthSession`
 * declares the pair and `sessions_elevation_is_complete` makes a half-set row
 * unwritable. A fixture that violated the constraint would be asserting against
 * a row PostgreSQL would have refused.
 */
const SESSION: AuthSession = {
  id: '0199c7a1-3333-7000-8000-000000000501',
  identityId: IDENTITY,
  userId: '0199c7a1-4444-7000-8000-000000000501',
  authFactor: 'passkey',
  elevatedAt: '2026-08-30T11:55:00.000Z',
  elevatedByFactor: 'passkey',
};

/** One `identities` row, in `packages/db`'s property spelling. */
function identityRow(status: string): Record<string, unknown> {
  return { id: IDENTITY, status };
}

function backendOver(rows: unknown[]): ReturnType<typeof recordingDb> {
  return recordingDb({ rows, ...NO_PRE_IDENTITY_DOORS });
}

// -----------------------------------------------------------------------------
// `transact`. THE ONE TRANSACTION EVERY LATER SLICE READS ON
// -----------------------------------------------------------------------------

describe('transact opens the scoped door and binds the identity once', () => {
  it('opens the SCOPED door with the SESSION s identity and no other door', async () => {
    const recorder = backendOver([identityRow('active')]);
    await postgresPayoutBackend(recorder.db).transact(SESSION, (tx) => tx.identityStatus());

    // WHOSE IDENTITY, which is the property that fails in the direction ADR-008
    // was accepted for. It is the session's and never a value off a request.
    expect(recorder.calls.map((c) => c.door)).toStrictEqual(['scoped']);
    expect(recorder.calls.map((c) => c.identityId)).toStrictEqual([IDENTITY]);
  });

  it('hands `fn` its result back and opens the door exactly once', async () => {
    const recorder = backendOver([identityRow('restricted')]);
    const answer = await postgresPayoutBackend(recorder.db).transact(SESSION, async (tx) => ({
      seen: await tx.identityStatus(),
    }));
    expect(answer).toStrictEqual({ seen: 'restricted' });
    expect(recorder.calls).toHaveLength(1);
  });

  it('propagates a throw from `fn` rather than swallowing it', async () => {
    // IT COMMITS ONLY IF `fn` RETURNS. The rollback half is `packages/db`'s and
    // is asserted there; what this adapter must not do is convert a throw into a
    // value, which would commit a transaction whose caller failed.
    const recorder = backendOver([identityRow('active')]);
    const boom = new Error('the handler failed');
    await expect(
      postgresPayoutBackend(recorder.db).transact(SESSION, () => Promise.reject(boom)),
    ).rejects.toBe(boom);
  });

  it('takes NO lock, which ADR-293 section 3.4 DECIDED rather than left unanswered', async () => {
    // ADR-291 registered the lock as slice 6's question; ADR-293 section 3.5
    // answered it and ADR-301 built the answer, and the answer is that the
    // payout path locks THROUGH A PORT MEMBER THE DECISION FUNCTION CALLS. No
    // adapter in this tree locks inside `transact`: `databaseWithdrawalBackend`
    // and `checkout.ts` both EXPOSE the member and their decision function
    // calls it. A lock here would put the ordering that makes the gate a
    // control outside the one function a reader checks orderings in.
    //
    // SO THIS CASE IS NOW A REFUSAL AND NOT A GAP. A session that moved
    // `lockScope()` into `transact` to save a line at the call site goes red
    // here, which is the property worth holding.
    const recorder = backendOver([identityRow('active')]);
    await postgresPayoutBackend(recorder.db).transact(SESSION, (tx) => tx.identityStatus());
    expect(recorder.calls.map((c) => c.verb)).toStrictEqual(['rows']);
  });
});

// -----------------------------------------------------------------------------
// `lockScope()`. ONE LINE, AND THE LINE IS A DELEGATION
// -----------------------------------------------------------------------------

describe('lockScope delegates to the scoped handle and adds nothing', () => {
  it('reaches `ScopedTx.lockScope` through the SCOPED door, on the session identity', async () => {
    const recorder = backendOver([]);
    await postgresPayoutBackend(recorder.db).transact(SESSION, (tx) => tx.lockScope());

    expect(recorder.calls).toStrictEqual([
      { door: 'scoped', identityId: IDENTITY, verb: 'lockScope', key: '' },
    ]);
  });

  it('reads NOTHING and names NO table, which is the whole of its safety', async () => {
    // ADR-293 section 3.3: the accessor's verb takes no argument, so it locks
    // the identity the handle is already bound to and there is no address on
    // this path a caller could point at somebody else. A delegation that named
    // a key or took an account id would be a different member.
    const recorder = backendOver([identityRow('active')]);
    await postgresPayoutBackend(recorder.db).transact(SESSION, (tx) => tx.lockScope());

    expect(recorder.calls.map((c) => c.verb)).toStrictEqual(['lockScope']);
    expect(recorder.calls.every((c) => c.address === undefined && c.values === undefined)).toBe(
      true,
    );
  });

  it('DISCARDS the row the accessor locked, so no route holds it', async () => {
    // `ScopedTx.lockScope` is a locking select and answers the `identities` row
    // it locked; the port declares `Promise<void>`. THE RECORDER ANSWERS A ROW
    // HERE FOR THAT REASON: against a recorder that answered `undefined` this
    // case would pass over nothing, and what it is for is the delegation that
    // forwards instead of awaiting. A route holding an `identities` row it did
    // not ask for is a read nothing on this path declared.
    const recorder = recordingDb({ locks: identityRow('active'), ...NO_PRE_IDENTITY_DOORS });
    const answered = await postgresPayoutBackend(recorder.db).transact(SESSION, (tx) =>
      tx.lockScope(),
    );
    expect(answered).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// `identityStatus()`. THE ONE MEMBER THAT ANSWERS
// -----------------------------------------------------------------------------

describe('identityStatus reads `identities` through the scoped door', () => {
  it('names the `identities` table and addresses nothing', async () => {
    // `identities` is scope class `root` ON `id`, so the handle supplies the
    // whole predicate. A caller naming the tenancy column would be REFUSED by
    // `refusePinnedColumn`, so the read is `rows` and never an address.
    const recorder = backendOver([identityRow('active')]);
    await postgresPayoutBackend(recorder.db).transact(SESSION, (tx) => tx.identityStatus());
    expect(recorder.calls).toStrictEqual([
      { door: 'scoped', identityId: IDENTITY, verb: 'rows', key: 'identities' },
    ]);
  });

  it.each(['active', 'restricted', 'closed'])('decodes `%s`, the enum s own member', async (s) => {
    // `identity_status` is `('active','restricted','closed')`
    // (`0001_extensions_and_enums.sql:27`) and NO MIGRATION ALTERS IT. All three
    // are asserted rather than one, because a decoder that admitted only the
    // value its author had in mind is the failure `ADR-041` closed.
    const recorder = backendOver([identityRow(s)]);
    await expect(
      postgresPayoutBackend(recorder.db).transact(SESSION, (tx) => tx.identityStatus()),
    ).resolves.toBe(s);
  });

  it('is NOT memoised: two calls are two reads', async () => {
    // ADR-287 section 2. A cached identity row would satisfy the type and break
    // `ADR-140`'s ordering, which is `INV-M5-23`'s placement argument: the
    // refusal is a fact about the human, evaluated before anything about the
    // account is read.
    const recorder = backendOver([identityRow('active')]);
    await postgresPayoutBackend(recorder.db).transact(SESSION, async (tx) => {
      await tx.identityStatus();
      await tx.identityStatus();
    });
    expect(recorder.calls).toHaveLength(2);
  });
});

// -----------------------------------------------------------------------------
// THE REFUSALS THAT ARE NOT 503s. A MALFORMED ROW IS A 500
// -----------------------------------------------------------------------------

describe('a row the schema says cannot exist raises rather than defaulting', () => {
  /** Drive one `identityStatus` over a seeded `identities` reply. */
  function read(rows: unknown[]): Promise<string> {
    return postgresPayoutBackend(backendOver(rows).db).transact(SESSION, (tx) =>
      tx.identityStatus(),
    );
  }

  it('refuses a FOURTH status, and never falls back to one of the three', async () => {
    // **THE CASE THIS MODULE EXISTS TO GET RIGHT.** A default of `restricted`
    // would deny a trader on a value nobody wrote and a default of `active`
    // would open the money door on one. `ADR-140`'s predicate is `= 'active'`
    // precisely so a fourth arriving later fails CLOSED, and closed here means
    // raising rather than choosing.
    await expect(read([identityRow('suspended')])).rejects.toBeInstanceOf(PayoutRowError);
    await expect(read([identityRow('suspended')])).rejects.toThrow(/outside the enum's own/);
  });

  it('refuses a status that is not text at all', async () => {
    await expect(read([{ id: IDENTITY, status: 4 }])).rejects.toBeInstanceOf(PayoutRowError);
  });

  it('refuses a scoped `identities` read that does not return exactly one row', async () => {
    // Zero rows is Merit's records disagreeing with the session it JUST
    // authenticated, and two is the `root` rule not being what `scope.ts` says.
    // Neither is the trader's fault and neither is a status.
    await expect(read([])).rejects.toThrow(/returned 0 rows/);
    await expect(read([identityRow('active'), identityRow('closed')])).rejects.toThrow(
      /returned 2 rows/,
    );
  });

  it('refuses something that is not a row', async () => {
    await expect(read([null])).rejects.toThrow(/is not a row/);
    await expect(read([['active']])).rejects.toThrow(/is not a row/);
  });

  it('raises a `PayoutRowError` and NOT a `PayoutBackendUnwired`, so the route answers 500', async () => {
    // **THE TWO VOCABULARIES ARE NOT INTERCHANGEABLE AND THIS IS THE CASE THAT
    // HOLDS THEM APART.** `unwiredOrThrow` catches `PayoutBackendUnwired` and
    // answers 503, "a dependency that is down and safe to retry". A row whose
    // columns disagree with the schema that wrote them is neither down nor
    // retryable, so it must NOT be that class: this is `RuleStateUnreadable`'s
    // ruling applied one door over.
    await expect(read([identityRow('suspended')])).rejects.not.toBeInstanceOf(PayoutBackendUnwired);
  });
});

// -----------------------------------------------------------------------------
// `insertPayoutRequest()`. THE APPROVAL BRANCH, AND ONLY THE APPROVAL BRANCH
// -----------------------------------------------------------------------------
// ADR-287 slice 6, ruled by ADR-295. WHAT THIS BLOCK WATCHES IS THE THREE TRAPS
// ADR-287 finding F3 recorded, because every one of them fails SILENTLY: two
// fields of the insert shape have no column and their values are already stored
// elsewhere, one `NOT NULL` column is absent from the shape and is derived, and
// the tenancy column is the handle's to stamp and the caller's to leave alone.
// A body that got any of the three wrong would still compile.

const ACCOUNT = '0199c7a1-5555-7000-8000-000000000501';
const PLAN_VERSION = '0199c7a1-6666-7000-8000-000000000501';
const REQUEST = '0199c7a1-7777-7000-8000-000000000501';

/**
 * One approval-branch row.
 *
 * EVERY MONEY FIELD IS A `bigint` LITERAL AND NOT A NUMBER, which is the
 * corpus rule applied to a fixture rather than only to source: `Cents` is
 * `bigint` and the four columns are `bigint NOT NULL`, so a fixture written in
 * `number` would be asserting against a row this code never receives.
 */
function approvalRow(over: Partial<PayoutRequestInsert> = {}): PayoutRequestInsert {
  return {
    id: REQUEST,
    accountId: ACCOUNT,
    idempotencyKey: 'client-token-1',
    status: 'approved',
    basisTradingDay: '2026-08-28',
    ordinal: 1,
    requestedCents: 100_000n,
    approvedCents: 90_000n,
    traderCents: 81_000n,
    firmCents: 9_000n,
    splitBp: 9000,
    clampReason: 'withdrawable',
    eligibilitySnapshot: { clamp: { reason: 'withdrawable', split_bp: 9000 } },
    hold: null,
    ...over,
  };
}

/** The `accounts` row the derivation reads, in `packages/db`'s property spelling. */
function accountRow(planVersionId: unknown = PLAN_VERSION): Record<string, unknown> {
  return { id: ACCOUNT, planVersionId };
}

describe('insertPayoutRequest writes the approval row and derives what the shape omits', () => {
  /** Drive one insert over a seeded `accounts` reply. */
  function write(
    rowAt: unknown,
    row: PayoutRequestInsert = approvalRow(),
  ): { readonly run: Promise<void>; readonly recorder: ReturnType<typeof recordingDb> } {
    const recorder = recordingDb({ rowAt, ...NO_PRE_IDENTITY_DOORS });
    return {
      recorder,
      run: postgresPayoutBackend(recorder.db).transact(SESSION, (tx) =>
        tx.insertPayoutRequest(row),
      ),
    };
  }

  it('reads `accounts` on THE SAME TRANSACTION and inserts through the scoped door', async () => {
    const { run, recorder } = write(accountRow());
    await run;

    // ONE DOOR, ONE IDENTITY, TWO VERBS IN ORDER. The derivation cannot be a
    // second connection: `plan_version_id` is copied FOR PROVABILITY and a copy
    // taken on another snapshot is a provenance nobody can reproduce.
    expect(recorder.calls.map((c) => c.door)).toStrictEqual(['scoped', 'scoped']);
    expect(recorder.calls.map((c) => c.identityId)).toStrictEqual([IDENTITY, IDENTITY]);
    expect(recorder.calls.map((c) => `${c.verb} ${c.key}`)).toStrictEqual([
      'rowAt accounts',
      'insert payoutRequests',
    ]);
    expect(recorder.calls[0]?.address).toStrictEqual({ id: ACCOUNT });
  });

  it('writes ELEVEN of the shape s FOURTEEN fields plus the DERIVED `plan_version_id`', async () => {
    const { run, recorder } = write(accountRow());
    await run;

    // THE WHOLE ASSERTION IS `toStrictEqual` AND NOT A FIELD-BY-FIELD WALK, so
    // a twelfth key arriving is a failure rather than something nobody checked.
    expect(recorder.calls[1]?.values).toStrictEqual({
      id: REQUEST,
      accountId: ACCOUNT,
      planVersionId: PLAN_VERSION,
      requestedCents: 100_000n,
      approvedCents: 90_000n,
      traderCents: 81_000n,
      firmCents: 9_000n,
      basisTradingDay: '2026-08-28',
      eligibilitySnapshot: { clamp: { reason: 'withdrawable', split_bp: 9000 } },
      status: 'approved',
      idempotencyKey: 'client-token-1',
      payoutOrdinal: 1,
    });
  });

  it('names NEITHER `splitBp` NOR `clampReason`, and drops NEITHER VALUE', async () => {
    // ADR-287 F3'S LANDMINE, AS A PROPERTY. Neither has a column and both are
    // already inside the snapshot, so the correct action is to write neither
    // AND to drop neither, which is ONE action rather than two. A body that
    // added a column would state one money fact twice; a body that stripped the
    // snapshot would lose the only copy.
    const { run, recorder } = write(accountRow());
    await run;

    const values = recorder.calls[1]?.values as Record<string, unknown>;
    for (const absent of ['splitBp', 'split_bp', 'clampReason', 'clamp_reason'])
      expect(Object.keys(values)).not.toContain(absent);
    expect(values['eligibilitySnapshot']).toStrictEqual({
      clamp: { reason: 'withdrawable', split_bp: 9000 },
    });
  });

  it('names NO tenancy column, because the handle stamps it', async () => {
    // `payout_requests` is scope class `owned` on `identity_id`, and
    // `packages/db` REFUSES an insert that names it. Asserted here so a later
    // body cannot "fix" a `NOT NULL` column by supplying a value the door is
    // built to reject.
    const { run, recorder } = write(accountRow());
    await run;

    const values = recorder.calls[1]?.values as Record<string, unknown>;
    for (const absent of ['identityId', 'identity_id'])
      expect(Object.keys(values)).not.toContain(absent);
  });

  it('every money value reaching the insert is a `bigint` and never a number', async () => {
    const { run, recorder } = write(accountRow());
    await run;

    const values = recorder.calls[1]?.values as Record<string, unknown>;
    for (const field of ['requestedCents', 'approvedCents', 'traderCents', 'firmCents'])
      expect(typeof values[field]).toBe('bigint');
  });

  it('REFUSES rather than defaulting when the `accounts` read comes back empty', async () => {
    // A scoped read of a foreign or absent account is `undefined`, and
    // `plan_version_id` is `NOT NULL`. THE REFUSAL IS A `PayoutRowError` AND SO
    // A 500, never a `PayoutBackendUnwired`: nothing is down and a retry fixes
    // nothing.
    const { run, recorder } = write(undefined);
    await expect(run).rejects.toBeInstanceOf(PayoutRowError);
    await expect(run).rejects.not.toBeInstanceOf(PayoutBackendUnwired);

    // AND NO ROW WAS WRITTEN. The refusal is BEFORE the insert and not after.
    expect(recorder.calls.map((c) => c.verb)).toStrictEqual(['rowAt']);
  });

  it('REFUSES when `accounts.plan_version_id` does not read back as text', async () => {
    const { run, recorder } = write(accountRow(null));
    await expect(run).rejects.toBeInstanceOf(PayoutRowError);
    expect(recorder.calls.map((c) => c.verb)).toStrictEqual(['rowAt']);
  });

  it('REFUSES a row carrying a HOLD, by name, and opens no door at all', async () => {
    // ADR-287 SLICE 8, WHICH CANNOT BE SCHEDULED. `HoldFlag.tosClause` has no
    // value space in this repository and `DEP-M7-05` owes the clauses to
    // counsel. A hold citing a clause Merit has not published is worse than an
    // unwired route, so this arm refuses rather than writing five columns whose
    // contents nobody has drafted.
    const { run, recorder } = write(
      accountRow(),
      approvalRow({
        status: 'held_pending_review',
        hold: {
          heldAt: '2026-08-30T12:00:00.000Z',
          holdExpiresAt: '2026-09-01T12:00:00.000Z',
          holdFlagId: '0199c7a1-8888-7000-8000-000000000501',
          holdTosClause: 'a clause id no session may invent',
          holdReason: 'a reason no session may invent',
        },
      }),
    );

    const refusal = await run.then(
      () => null,
      (err: unknown) => err,
    );
    expect(refusal).toBeInstanceOf(PayoutBackendUnwired);
    expect((refusal as Error).message).toContain(
      'PayoutBackend.insertPayoutRequest.hold is not wired',
    );
    expect(recorder.calls).toStrictEqual([]);
  });

  it('REFUSES a half-shaped row from either side, on the CHECK constraint s own shape', async () => {
    // `payout_requests_hold_is_complete` admits `hold` present WITH
    // `held_pending_review`, or neither. THE PREDICATE HERE IS TWO SIDED FOR
    // THE SAME REASON: a row that is half of either would otherwise reach a
    // CHECK constraint and come back as a 500 on a request nobody could
    // diagnose.
    const heldWithoutHold = write(accountRow(), approvalRow({ status: 'held_pending_review' }));
    await expect(heldWithoutHold.run).rejects.toBeInstanceOf(PayoutBackendUnwired);
    expect(heldWithoutHold.recorder.calls).toStrictEqual([]);
  });
});

// -----------------------------------------------------------------------------
// `subject()`. THREE LEGS OF FOUR, AND A FIXTURE THAT ANSWERS PER TABLE
// -----------------------------------------------------------------------------
// ADR-306 (ADR-287 slice 4). What this section watches is the shape of a member
// that READS FOUR TABLES AND STILL CANNOT ANSWER: the `null` arm, the three legs
// that resolve, and the refusal that names the two that do not.
//
// -----------------------------------------------------------------------------
// WHY A SECOND FIXTURE, STATED RATHER THAN SLIPPED IN
// -----------------------------------------------------------------------------
// `db-recorder.ts` CANNOT DRIVE THIS MEMBER, in two ways that are its design
// rather than an oversight, and both were measured at that file before this one
// was written:
//
//   1. `Replies` CARRIES ONE `rows` ARRAY FOR EVERY TABLE. `subject()` reads
//      `identities` and `kycVerifications` through `rows`, so one seed would have
//      to be a valid answer to both, and a case seeding a kyc chain would be
//      seeding the identity row with it.
//   2. THERE IS NO CATALOGUE VERB AT ALL. The recorder's handle offers `rows`,
//      `rowsWhere`, `rowAt`, the four writes and `lockScope`; `catalogRowAt` is
//      absent, so `subject()`'s `plan_versions` read is a `TypeError` there.
//
// THE SHARED RECORDER IS NOT EXTENDED, AND THAT IS A FENCE DECISION AND NOT A
// TASTE ONE. `db-recorder.ts` is the fixture of five suites and row 306's fence
// is `payout-backend.ts` AND ITS SUITE. Consolidating the two -- per-table
// replies and a catalogue verb on the shared recorder, this fixture deleted -- is
// worth doing and is owed to a row whose fence reaches that file. ADR-306
// section 7 records it as a debt rather than leaving it for a reader to notice.
//
// WHAT THIS FIXTURE PROVES IS `db-recorder.ts`'s OWN LIST UNCHANGED: WHICH DOOR
// was opened, WHOSE identity was handed to it, WHICH TABLE was named, and IN
// WHAT ORDER. That a composed predicate reaches one row is `packages/db`'s and is
// asserted there, and this file does not simulate it.

const KYC = '0199c7a1-9999-7000-8000-000000000501';
const KYC_TWO = '0199c7a1-aaaa-7000-8000-000000000501';

/**
 * `plan_versions.rules` AS THE COLUMN HOLDS IT, which is a JSON document.
 *
 * IT IS NOT A `PlanRulesJson` AND IS DELIBERATELY NOT TYPED AS ONE. The column
 * is `jsonb NOT NULL` and `catalogRowAt` hands its value back as `unknown`, so a
 * fixture typed as the decoded shape would be handing the decoder its own answer:
 * `min_payout_cents` is a `Cents` (a `bigint`) AFTER `decodePlanRules` and a JSON
 * number BEFORE it, and `jsonb` cannot hold a `bigint` at all.
 *
 * EVERY LEAF IS THE ONE `admin-write-plan-validation.test.ts` USES, rendered as
 * the stored document rather than as the decoded one, so a case that moves one
 * key is moving it against a plan the codec accepts whole.
 */
const STORED_RULES: Record<string, unknown> = {
  schema_version: 1,
  phase_eval: {
    enabled: true,
    profit_target_bp: 800,
    drawdown: {
      type: 'trailing_eod',
      amount_bp: 500,
      lock: { enabled: false, at_profit_cents: null, floor_at_cents: null },
    },
    daily_loss_limit: { type: 'none', amount_bp: null },
    min_trading_days: 1,
    consistency: { enabled: false, max_day_share_bp: null, mode: 'pass_time_dilutable' },
    max_days: null,
  },
  phase_funded: {
    drawdown: {
      type: 'trailing_eod',
      amount_bp: 500,
      lock: { enabled: false, at_profit_cents: null, floor_at_cents: null },
    },
    daily_loss_limit: { type: 'none', amount_bp: null },
    min_trading_days: 0,
    win_days: { required_count: 1, floor_bp: 10, reset_on_payout: true },
    consistency: { enabled: false, max_day_share_bp: null, mode: 'payout_gated' },
    buffer_bp: 100,
    cadence_gap_trading_days: 0,
    min_settlement_lag_trading_days: 0,
    payout_cap_schedule: [{ from_ordinal: 1, cap_bp: 100 }],
    min_payout_cents: 10000,
    split_bp: 8000,
    max_payouts: 3,
    post_payout_floor_rule: { mode: 'none' },
  },
};

/** What each of the four tables `subject()` reads answers with. */
interface SubjectSeed {
  /** `rowAt('accounts', { id })`. `undefined` is the `null` arm. */
  readonly account?: unknown;
  readonly identities?: readonly unknown[];
  readonly kycVerifications?: readonly unknown[];
  readonly payoutRequests?: readonly unknown[];
  /** `catalogRowAt('planVersions', { id })`. `undefined` is an empty catalogue. */
  readonly planVersion?: unknown;
}

/** One read, as this fixture records it. The catalogue verb is the fifth. */
interface SeededRead {
  readonly verb: 'rows' | 'rowsWhere' | 'rowAt' | 'catalogRowAt';
  readonly key: string;
  readonly address?: unknown;
}

interface SeededDb {
  readonly db: ApiDb;
  readonly reads: SeededRead[];
  /** Every identity the SCOPED door was opened with, in order. */
  readonly identityIds: string[];
}

/**
 * One scoped door over four seeded tables, recording what was named.
 *
 * A TABLE THIS FIXTURE DOES NOT SEED THROWS RATHER THAN ANSWERING EMPTY. An
 * unseeded read answering `[]` would let a leg quietly acquire a table its own
 * case is asserting it does not touch, which is the direction `NO_PRE_IDENTITY_
 * DOORS` rejects one door up and is the same argument one verb down.
 */
function seededDb(seed: SubjectSeed): SeededDb {
  const reads: SeededRead[] = [];
  const identityIds: string[] = [];

  const list = (key: string): unknown[] => {
    if (key === 'identities') return [...(seed.identities ?? [])];
    if (key === 'kycVerifications') return [...(seed.kycVerifications ?? [])];
    if (key === 'payoutRequests') return [...(seed.payoutRequests ?? [])];
    throw new Error(`this fixture seeds no \`${key}\` rows, so nothing here may read it`);
  };

  const handle = {
    __brand: 'ScopedTx',
    sqlExecutor: () => {
      throw new Error('the fixture offers no sqlExecutor: no adapter here may reach for one');
    },
    lockScope: () => Promise.resolve(undefined),
    rows: (key: string) => {
      reads.push({ verb: 'rows', key });
      return Promise.resolve(list(key));
    },
    rowsWhere: (key: string, address: unknown) => {
      reads.push({ verb: 'rowsWhere', key, address });
      return Promise.resolve(list(key));
    },
    rowAt: (key: string, address: unknown) => {
      reads.push({ verb: 'rowAt', key, address });
      if (key !== 'accounts')
        throw new Error(`this fixture addresses no \`${key}\` row through \`rowAt\``);
      return Promise.resolve(seed.account);
    },
    catalogRowAt: (key: string, address: unknown) => {
      reads.push({ verb: 'catalogRowAt', key, address });
      if (key !== 'planVersions') throw new Error(`this fixture catalogues no \`${key}\` row`);
      return Promise.resolve(seed.planVersion);
    },
  };

  const db: ApiDb = {
    scoped: <T>(identityId: string, fn: (tx: never) => Promise<T>): Promise<T> => {
      identityIds.push(identityId);
      return fn(handle as never);
    },
    firm: () => Promise.reject(new Error('this fixture opens no firm door')),
    ...NO_PRE_IDENTITY_DOORS,
  };

  return { db, reads, identityIds };
}

/** The `accounts` row `subject()` reads, in `packages/db`'s property spelling. */
function subjectAccountRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ACCOUNT,
    identityId: IDENTITY,
    planVersionId: PLAN_VERSION,
    sizeCents: 5_000_000n,
    status: 'active',
    payoutsFrozen: false,
    reconBlocked: false,
    ...over,
  };
}

/** A seed on which all three built legs resolve and only the unbuilt two refuse. */
function wholeSeed(over: SubjectSeed = {}): SubjectSeed {
  return {
    account: subjectAccountRow(),
    identities: [{ id: IDENTITY, status: 'active', payoutsFrozen: false }],
    kycVerifications: [{ id: KYC, state: 'verified', supersedes: null }],
    payoutRequests: [],
    planVersion: { id: PLAN_VERSION, rules: STORED_RULES },
    ...over,
  };
}

/** `subject(ACCOUNT)` on one seed, and whatever it answered or threw. */
async function subjectOn(seed: SubjectSeed): Promise<{ answer: unknown; seeded: SeededDb }> {
  const seeded = seededDb(seed);
  const answer = await postgresPayoutBackend(seeded.db)
    .transact(SESSION, (tx) => tx.subject(ACCOUNT))
    .then(
      (value: unknown) => value,
      (err: unknown) => err,
    );
  return { answer, seeded };
}

describe('subject() answers `null` for an account this handle cannot see', () => {
  it('returns `null` on an empty `accounts` read and NEVER a throw', async () => {
    // `accounts` is scope class `owned` on `identity_id`, so a scoped read cannot
    // tell a FOREIGN account from an ABSENT one and section 1's 404 is the answer
    // to both. That is the call site's own stated reason at `payouts.ts`.
    const { answer } = await subjectOn({ account: undefined });
    expect(answer).toBeNull();
  });

  it('reads NOTHING ELSE, which is ADR-285 ruling 4 made a property', async () => {
    // THE OWNERSHIP ANSWER IS FIRST. An implementation that read `rule_states`
    // or the gate columns before resolving the account would hand a prober a
    // different status for another identity's account than for one that does not
    // exist, and section 1 requires this API not to confirm the existence of
    // other people's resources.
    const { seeded } = await subjectOn({ account: undefined });
    expect(seeded.reads).toStrictEqual([
      { verb: 'rowAt', key: 'accounts', address: { id: ACCOUNT } },
    ]);
    expect(seeded.identityIds).toStrictEqual([IDENTITY]);
  });
});

describe('subject() refuses BY NAME and the name is the remainder of ADR-287', () => {
  it('names `subject.state` AND `subject.plan.size`, never the member wholesale', async () => {
    // THE LINE THIS REPLACED REFUSED `subject` ON ONE LINE, and a blanket
    // rejection cost a session: neither ALLOCATION nor STATE could tell a member
    // nobody had started from a member three quarters built, and both recorded
    // slice 5 as next while slice 4 had never been built. What the refusal names
    // now is exactly ADR-287 section 7's slice 5.
    const { answer } = await subjectOn(wholeSeed());
    expect(answer).toBeInstanceOf(PayoutBackendUnwired);
    const message = (answer as Error).message;
    expect(message).toContain('PayoutBackend.subject.state and subject.plan.size is not wired');
  });

  it('is a `PayoutBackendUnwired`, so the route answers 503 and not 500', async () => {
    // `unwiredOrThrow` catches this class and rethrows every other, and the
    // header's ruling is that an UNBUILT member is the contract's "dependency
    // down, safe to retry". A payout the deployment cannot compute a basis for is
    // exactly that, and it is not the 500 a malformed row earns.
    const { answer } = await subjectOn(wholeSeed());
    expect(answer).toBeInstanceOf(PayoutBackendUnwired);
    expect(answer).not.toBeInstanceOf(PayoutRowError);
  });

  it('REACHED THAT REFUSAL THROUGH ALL THREE BUILT LEGS, in the ruled order', async () => {
    // THIS CASE IS THE STOP CONDITION AND THE READ ORDER IS THE PROOF. The
    // catalogue read is the LAST of the five and is reachable only if
    // `resolveExternalGates` RETURNED a record rather than refusing, and the
    // refusal above is reachable only if `decodePlanRules` returned too. So a
    // leg that quietly stopped resolving would move this list rather than leave
    // it green.
    const { seeded } = await subjectOn(wholeSeed());
    expect(seeded.reads).toStrictEqual([
      { verb: 'rowAt', key: 'accounts', address: { id: ACCOUNT } },
      { verb: 'rows', key: 'identities' },
      { verb: 'rows', key: 'kycVerifications' },
      { verb: 'rowsWhere', key: 'payoutRequests', address: { accountId: ACCOUNT } },
      { verb: 'catalogRowAt', key: 'planVersions', address: { id: PLAN_VERSION } },
    ]);
  });

  it('READS NO `rule_states` ROW AND NO CALENDAR, which is INV-M5-02 and ADR-268', async () => {
    // `PayoutSubject.state` requires a backend to CALL `ruleStateOn` and NOT to
    // fold a state in the request path: the API reads what the WORKER wrote, and
    // a request-path fold is the divergence ADR-026 C-07's `state_hash` exists to
    // detect, computed on the one path no replay audit reads. The day is
    // `ScopedTx.lastClosedTradingDay()` on ADR-268 and never a calendar folded
    // here. A session that built `state` by folding either would go red HERE and
    // not only on review.
    const { seeded } = await subjectOn(wholeSeed());
    const keys = seeded.reads.map((read) => read.key);
    expect(keys).not.toContain('ruleStates');
    expect(keys).not.toContain('tradingCalendar');
    expect(keys).not.toContain('accountDays');
  });

  it('READS NO `plan_version_sizes` ROW, which is the cut ADR-306 chose', async () => {
    // The size row's READ and its DECODE are one act: `catalogRowAt` answers a
    // row or `undefined`, and what an absent one MEANS -- an account pinned to a
    // size its own plan version does not publish -- is a refusal rule nobody has
    // written. Reading it here would settle half of slice 5's question in an
    // adapter, which is this port's whole history.
    const { seeded } = await subjectOn(wholeSeed());
    expect(seeded.reads.map((read) => read.key)).not.toContain('planVersionSizes');
  });
});

describe('subject() resolves `gates` through the engine and writes no record out', () => {
  it('hands the WHOLE kyc chain over rather than choosing a head here', async () => {
    // SD-M19-01 makes a re-verification a NEW ROW pointing at the one it
    // supersedes, so the head is a property of the SET. Two rows superseded by
    // nothing is a chain whose head cannot be named, and `external-gates.ts`
    // REFUSES it on this door on purpose: `kyc_required` here is
    // indistinguishable from "we could not tell", and this is the door where
    // being reported verified means being paid. A route that picked one would be
    // green here and wrong in production.
    const { answer } = await subjectOn(
      wholeSeed({
        kycVerifications: [
          { id: KYC, state: 'verified', supersedes: null },
          { id: KYC_TWO, state: 'rejected', supersedes: null },
        ],
      }),
    );
    expect(answer).toBeInstanceOf(ExternalGatesRefusal);
    expect((answer as ExternalGatesRefusal).legs).toStrictEqual(['kycState']);
    expect((answer as ExternalGatesRefusal).accountId).toBe(ACCOUNT);
  });

  it('hands EVERY payout status over unfiltered, so the in-flight rule stays the engine s', async () => {
    // A filter here would be another copy of `payout_requests_no_in_flight_uq`'s
    // predicate with nothing comparing the two. The engine REFUSES a status
    // outside its five because the vocabulary has already moved twice on this
    // table, and an unknown outstanding state read as not-in-flight is R-38
    // stopping nobody.
    const { answer } = await subjectOn(
      wholeSeed({ payoutRequests: [{ status: 'settled' }, { status: 'transferring' }] }),
    );
    expect(answer).toBeInstanceOf(ExternalGatesRefusal);
    expect((answer as ExternalGatesRefusal).legs).toStrictEqual(['hasPayoutInFlight']);
  });

  it('hands `accounts.status` over RAW, so seven-versus-six is answered in one place', async () => {
    // `provisioning_pending` is the member `account_status` declares and
    // `AccountStatus` does not. Narrowing it here would be a SECOND place that
    // question is answered, which is the defect `external-gates.ts` exists to
    // hold in one, and the union is not widened to make the map total.
    const { answer } = await subjectOn(
      wholeSeed({ account: subjectAccountRow({ status: 'provisioning_pending' }) }),
    );
    expect(answer).toBeInstanceOf(ExternalGatesRefusal);
    expect((answer as ExternalGatesRefusal).legs).toStrictEqual(['accountStatus']);
  });

  it('lets the engine s refusal ESCAPE, so the route answers 500 and not 503', async () => {
    // AN `ExternalGatesRefusal` IS NOT A `PayoutBackendUnwired` AND IS NOT
    // CAUGHT. A column outside its own enum is Merit's records disagreeing with
    // Merit's schema, which no retry fixes, so 503 would tell a trader to retry
    // what retrying cannot mend. This is `PayoutRowError`'s ruling applied to the
    // engine's refusal.
    const { answer } = await subjectOn(
      wholeSeed({ account: subjectAccountRow({ status: 'provisioning_pending' }) }),
    );
    expect(answer).not.toBeInstanceOf(PayoutBackendUnwired);
  });

  it('refuses a non-boolean veto column rather than coercing it', async () => {
    // Every flag this reads is an R-41 VETO. A truthy string read as `true` is a
    // veto firing on the wrong account and a falsy one never fires at all, so the
    // read refuses and the refusal is a `PayoutRowError`: 500, because the column
    // is `boolean NOT NULL` and a row carrying anything else is the schema
    // disagreeing with itself.
    const { answer } = await subjectOn(
      wholeSeed({ identities: [{ id: IDENTITY, status: 'active', payoutsFrozen: 'false' }] }),
    );
    expect(answer).toBeInstanceOf(PayoutRowError);
    expect((answer as Error).message).toContain('identities.payoutsFrozen');
  });

  it('reads the identity row AGAIN rather than carrying one from identityStatus()', async () => {
    // ADR-140's ordering is `INV-M5-23`'s placement argument and `identityStatus`
    // forbids memoisation for it: a value cached across two members would make
    // the order an accident of which one ran first. So one transaction that calls
    // both reads `identities` TWICE, and that is the cheap half of the trade.
    const seeded = seededDb(wholeSeed());
    await postgresPayoutBackend(seeded.db)
      .transact(SESSION, async (tx) => {
        await tx.identityStatus();
        return tx.subject(ACCOUNT);
      })
      .catch(() => null);
    expect(seeded.reads.filter((read) => read.key === 'identities')).toHaveLength(2);
  });

  it('refuses an `identities` read that is not exactly one row', async () => {
    // `identities` is scope class `root` on `id`, so the predicate is
    // `identities.id = $1` and the answer is the caller's own row and exactly
    // one. Zero rows is Merit's records disagreeing with the session it just
    // authenticated.
    const { answer } = await subjectOn(wholeSeed({ identities: [] }));
    expect(answer).toBeInstanceOf(PayoutRowError);
    expect((answer as Error).message).toContain('returned 0 rows');
  });
});

describe('subject() builds `plan` up to the size decode and no further', () => {
  it('addresses the catalogue at the account s OWN pinned version', async () => {
    // `accounts.plan_version_id` NEVER CHANGES for the life of the account
    // (`0007_accounts.sql`, with `0027_triggers_invariants.sql`'s trigger raising
    // on an attempt to move it), so the version a payout is decided against is
    // the account's own and never the plan's latest.
    const { seeded } = await subjectOn(wholeSeed());
    expect(seeded.reads.at(-1)).toStrictEqual({
      verb: 'catalogRowAt',
      key: 'planVersions',
      address: { id: PLAN_VERSION },
    });
  });

  it('DECODES the rules blob, so a document this build cannot read refuses HERE', async () => {
    // THE DECODED VALUE IS DISCARDED AND THE DECODE IS STILL THE POINT: nothing
    // consumes `PlanRulesJson` until `resolvePlan` can be called, so what the
    // line buys is the refusal. A `plan_versions.rules` this build cannot read
    // stops on the account's own transaction rather than on the day slice 5
    // installs a fold over it for the first time. A session that deleted the
    // call as dead would go red here.
    const { answer } = await subjectOn(
      wholeSeed({ planVersion: { id: PLAN_VERSION, rules: { schema_version: 2 } } }),
    );
    expect(answer).toBeInstanceOf(PlanRulesCodecError);
    expect(answer).not.toBeInstanceOf(PayoutBackendUnwired);
  });

  it('NEVER decodes the blob a second time: the decoder is the engine s', async () => {
    // `PayoutSubject.plan`'s docblock refuses a fourth transcription of the blob
    // that fixes every cents value a payout is decided against: FM-16 on the
    // money path, and ADR-269 refused exactly that for `readLiability` one port
    // over. `decodePlanRules` is IMPORTED, and the two copies ADR-283 exists to
    // retire are in `apps/worker` and `apps/site` and are not importable here.
    const source = readFileSync(
      join(import.meta.dirname, '..', 'src', 'payout-backend.ts'),
      'utf8',
    );
    expect(source).toContain(
      "import { decodePlanRules, resolveExternalGates } from '@merit/rules-engine';",
    );
    expect(source).not.toContain('schema_version');
    expect(source).not.toContain('profit_target_bp');
  });

  it('refuses an empty catalogue read rather than substituting a version', async () => {
    // `plan_version_id` is `uuid NOT NULL REFERENCES plan_versions`, so an empty
    // read is the catalogue disagreeing with the account. A payout decided
    // against a version nobody pinned is the shape NO SYNTHESISED DEFAULT names.
    const { answer } = await subjectOn(wholeSeed({ planVersion: undefined }));
    expect(answer).toBeInstanceOf(PayoutRowError);
    expect((answer as Error).message).toContain(PLAN_VERSION);
  });

  it('refuses an `accounts.plan_version_id` that did not read back as text', async () => {
    const { answer } = await subjectOn(
      wholeSeed({ account: subjectAccountRow({ planVersionId: null }) }),
    );
    expect(answer).toBeInstanceOf(PayoutRowError);
    expect((answer as Error).message).toContain('accounts.planVersionId');
  });
});

// -----------------------------------------------------------------------------
// THE FOUR THAT REFUSE. THE WHOLE SHAPE OF THIS SLICE
// -----------------------------------------------------------------------------

describe('the four unbuilt members refuse VISIBLY and by name', () => {
  /**
   * The `PayoutTx` members that refuse BEFORE READING ANYTHING.
   *
   * `subject` LEFT THIS LIST WHEN ADR-306 BUILT THREE OF ITS FOUR LEGS, and the
   * shape of the list is why it had to: what is asserted below is that the member
   * refuses with NO read at all, and `subject` now reads four tables before
   * naming the two legs it cannot answer. Its cases are the section above and
   * they assert the same property one layer in: the refusal is visible, it names
   * members rather than the port, and nothing is stubbed to reach it.
   */
  const TX_MEMBERS = ['holdFlag'] as const;

  it.each(TX_MEMBERS)('`%s` rejects with `PayoutBackendUnwired` naming itself', async (name) => {
    const recorder = backendOver([identityRow('active')]);
    const refusal = await postgresPayoutBackend(recorder.db)
      .transact(SESSION, (tx) =>
        // The call is made through the interface rather than shaped per member:
        // what is asserted is that NOTHING is read before the refusal.
        (tx[name] as (arg: never) => Promise<unknown>)('account' as never),
      )
      .then(
        () => null,
        (err: unknown) => err,
      );

    expect(refusal).toBeInstanceOf(PayoutBackendUnwired);
    expect((refusal as Error).message).toContain(`PayoutBackend.${name} is not wired`);
    // AND IT REFUSED BEFORE READING ANYTHING. A member that opened the row and
    // then declined would be a partial implementation wearing a refusal.
    expect(recorder.calls).toStrictEqual([]);
  });

  it('`listPayouts` rejects with `PayoutBackendUnwired` and opens no door', async () => {
    const recorder = backendOver([]);
    await expect(postgresPayoutBackend(recorder.db).listPayouts(SESSION)).rejects.toBeInstanceOf(
      PayoutBackendUnwired,
    );
    expect(recorder.calls).toStrictEqual([]);
  });

  it('`idempotency` is the UNWIRED store, in all three of its methods', async () => {
    // **THE MEMBER THAT COULD ANSWER TODAY AND DELIBERATELY DOES NOT.**
    // `databaseIdempotencyStore` exists at `src/idempotency-store.ts:144` and
    // has its own suite. Installing it here is refused on `wiring.test.ts`'s own
    // closing ruling: `listPayouts` and `idempotency` beside a `transact` whose
    // `subject` rejects would put a live-looking route in front of the arm that
    // approves payouts. This case is what makes that a property rather than a
    // sentence, so a later session cannot install it without deleting a test.
    const recorder = backendOver([]);
    const store = postgresPayoutBackend(recorder.db).idempotency;
    const scope = identityScope(IDENTITY);

    await expect(store.find(scope, 'k')).rejects.toBeInstanceOf(PayoutBackendUnwired);
    await expect(
      store.begin(scope, {
        key: 'k',
        endpoint: 'POST /accounts/:accountId/payouts',
        requestHash: new Uint8Array(32),
        responseStatus: null,
        responseBody: null,
      }),
    ).rejects.toBeInstanceOf(PayoutBackendUnwired);
    await expect(store.complete(scope, 'k', 200, null)).rejects.toBeInstanceOf(
      PayoutBackendUnwired,
    );

    expect(recorder.calls).toStrictEqual([]);
  });
});
