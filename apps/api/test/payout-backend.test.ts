// =============================================================================
// apps/api/test/payout-backend.test.ts
// =============================================================================
// THE FIRST `PayoutTx` IN THIS TREE, ASSERTED AS THE TWO-OF-SEVEN SHAPE IT IS.
//
// ADR-291 (ADR-287 slice 3). What this file watches is not only that the two
// live members answer, but that the FIVE THAT DO NOT REFUSE VISIBLY: a member
// that quietly returned a plausible value would be a fixture approving payouts,
// and every one of the five is unbuilt for a reason ADR-287 names at a primary
// source.
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

  it('takes NO lock, so a later slice adding one is a visible decision', async () => {
    // ADR-291 registers the lock as slice 6's question rather than answering it.
    // `databaseWithdrawalBackend` locks first because its handler reads a
    // balance and then writes against it; nothing on this transaction does yet.
    const recorder = backendOver([identityRow('active')]);
    await postgresPayoutBackend(recorder.db).transact(SESSION, (tx) => tx.identityStatus());
    expect(recorder.calls.map((c) => c.verb)).toStrictEqual(['rows']);
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
// THE FIVE THAT REFUSE. THE WHOLE SHAPE OF THIS SLICE
// -----------------------------------------------------------------------------

describe('the five unbuilt members refuse VISIBLY and by name', () => {
  /** Every `PayoutTx` member ADR-287 leaves to a later slice. */
  const TX_MEMBERS = ['subject', 'holdFlag', 'insertPayoutRequest'] as const;

  it.each(TX_MEMBERS)('`%s` rejects with `PayoutBackendUnwired` naming itself', async (name) => {
    const recorder = backendOver([identityRow('active')]);
    const refusal = await postgresPayoutBackend(recorder.db)
      .transact(SESSION, (tx) =>
        // The three take different arguments and the refusal predates every one
        // of them, so the call is made through the interface rather than shaped
        // per member: what is asserted is that NOTHING is read before it.
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
