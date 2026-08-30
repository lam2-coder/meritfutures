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

import { describe, expect, it } from 'vitest';

import { recordingDb, NO_PRE_IDENTITY_DOORS } from './db-recorder.ts';
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
// THE FOUR THAT REFUSE. THE WHOLE SHAPE OF THIS SLICE
// -----------------------------------------------------------------------------

describe('the four unbuilt members refuse VISIBLY and by name', () => {
  /** Every `PayoutTx` member ADR-287 leaves to a later slice. */
  const TX_MEMBERS = ['subject', 'holdFlag'] as const;

  it.each(TX_MEMBERS)('`%s` rejects with `PayoutBackendUnwired` naming itself', async (name) => {
    const recorder = backendOver([identityRow('active')]);
    const refusal = await postgresPayoutBackend(recorder.db)
      .transact(SESSION, (tx) =>
        // The two take different arguments and the refusal predates both, so
        // the call is made through the interface rather than shaped per member:
        // what is asserted is that NOTHING is read before it.
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
