// =============================================================================
// apps/api/src/payout-backend.ts
// =============================================================================
// THE FIRST LINE OF PAYOUT PERSISTENCE THIS TREE HAS EVER HAD, AND IT IS FOUR
// MEMBERS OF EIGHT ON PURPOSE.
//
// `wiring.test.ts`'s `usePayoutBackend` entry has carried one clause longer than
// any other: "NOTHING IN THIS TREE IMPLEMENTS `PayoutTx`". ADR-287 enumerated
// what implementing it would cost and found nine sessions, of which this file is
// slice 3. ADR-291 is this file's ruling, ADR-295 added slice 6, and ADR-301
// added the lock ADR-293 ruled and ADR-295's fence could not reach.
//
// -----------------------------------------------------------------------------
// WHAT ANSWERS, AND WHAT REFUSES
// -----------------------------------------------------------------------------
// `PayoutBackend` and `PayoutTx` carry EIGHT members between them. FOUR answer
// here and FOUR reject with `PayoutBackendUnwired`:
//
//   transact            ANSWERS. The scoped door, opened once per request.
//   lockScope           ANSWERS. `ScopedTx.lockScope`, delegated in one line.
//                       ADR-293 section 3.5, built by ADR-301. THE LOCK IS NOT
//                       TAKEN IN `transact` and the decision function calls it.
//   identityStatus      ANSWERS. `identities.status`, decoded to one of three.
//   insertPayoutRequest ANSWERS ON THE APPROVAL BRANCH ONLY. ADR-287 slice 6,
//                       ruled by ADR-295. ITS HOLD BRANCH REFUSES, and that is
//                       slice 8, whose supplier is COUNSEL and not a session.
//   subject             REFUSES. ADR-287 slices 4 and 5.
//   holdFlag            REFUSES. ADR-287 slice 8, whose supplier is COUNSEL.
//   listPayouts         REFUSES. ADR-287 slice 7, blocked on the slice 2 ruling.
//   idempotency         REFUSES, AND IT IS THE ONE THAT COULD ANSWER TODAY.
//
// THE LAST LINE IS THE ONE WORTH READING TWICE, BECAUSE IT IS A CHOICE RATHER
// THAN AN ABSENCE. `databaseIdempotencyStore` (`src/idempotency-store.ts:144`)
// exists, has its own suite, and would satisfy this field on this tree today.
// It is NOT installed here, on `wiring.test.ts`'s own closing ruling: installing
// `listPayouts` and `idempotency` "beside a `transact` whose `subject` rejects
// would put a live-looking route in front of the arm that approves payouts".
// A partial backend refuses AS A WHOLE or it is a fixture serving real traffic.
//
// -----------------------------------------------------------------------------
// THIS FILE IS NOT INSTALLED AND THE COUNT DOES NOT MOVE
// -----------------------------------------------------------------------------
// `start.ts` DOES NOT CALL `usePayoutBackend`, and that is ADR-287 slice 9's act
// behind a founder `E2` read, not this one's. The wired count stays at TEN of
// TWENTY-FOUR declared with FOURTEEN blocked. A module that exists and is not
// reached changes no deployment, which is exactly what building the port ahead
// of the ruling that installs it is supposed to cost.
//
// -----------------------------------------------------------------------------
// TWO REFUSAL VOCABULARIES, AND THE DIFFERENCE IS THE STATUS CODE
// -----------------------------------------------------------------------------
// `PayoutBackendUnwired` is caught by `unwiredOrThrow` (`routes/payouts.ts`) and
// becomes 503, which is the contract's "dependency down, safe to retry". An
// unbuilt member is exactly that.
//
// `PayoutRowError` is DELIBERATELY NOT A `PayoutBackendUnwired` and is therefore
// NOT caught, so it stays a 500. This is `RuleStateUnreadable`'s ruling applied
// one door over: a row whose columns disagree with the schema that wrote them is
// an internal error, and a retryable status would tell a trader to retry what no
// retry can fix.
//
// NO SYNTHESISED DEFAULT ON EITHER PATH. A status outside `identity_status`'s
// three members raises; it never falls back to `restricted` (which would deny a
// trader on a value nobody wrote) and never to `active` (which would open the
// money door on one). ADR-041 refused a fourth member and ADR-140's predicate is
// `= 'active'` precisely so a fourth arriving later fails CLOSED.
// =============================================================================

import type { ApiDb } from './db.ts';
import type { IdempotencyStore } from './idempotency.ts';
import { PayoutBackendUnwired } from './routes/payouts.ts';
import type { IdentityStatus, PayoutBackend, PayoutTx } from './routes/payouts.ts';

/**
 * A row this backend read that the schema says cannot exist.
 *
 * NOT A `PayoutBackendUnwired`, so `unwiredOrThrow` rethrows it and the route
 * answers 500. See the header: an unbuilt member is retryable and a malformed
 * row is not.
 */
export class PayoutRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayoutRowError';
  }
}

/**
 * `identity_status`, `0001_extensions_and_enums.sql:27`, re-derived at the
 * migration rather than carried from ADR-287.
 *
 * THE ENUM HAS EXACTLY THREE MEMBERS AND NO MIGRATION ALTERS IT: a recursive
 * read of `packages/db/migrations` for `ALTER TYPE identity_status` returns
 * nothing, and `identities.status` is `identity_status NOT NULL DEFAULT
 * 'active'` (`0002_identity.sql:42`). So this list and `IdentityStatus`
 * (`routes/payouts.ts`) transcribe one column, and a value outside it is a
 * database this code does not recognise rather than a case to handle.
 */
const IDENTITY_STATUSES: readonly IdentityStatus[] = ['active', 'restricted', 'closed'];

/** The accessor hands back `unknown`. This is the narrowing, not a cast. */
function asRow(value: unknown, table: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new PayoutRowError(`a scoped read of \`${table}\` returned something that is not a row`);
  return value as Record<string, unknown>;
}

/** One `NOT NULL` text column, or a refusal naming what was read. */
function text(row: Record<string, unknown>, column: string, table: string): string {
  const value = row[column];
  if (typeof value !== 'string')
    throw new PayoutRowError(
      `\`${table}.${column}\` did not read back as text. It is \`NOT NULL\` in the schema that ` +
        'wrote it, so an absent value is a row this code does not recognise and never a value ' +
        'to substitute for',
    );
  return value;
}

/** One member of a closed enum, or a refusal naming what was read. */
function member<T extends string>(
  row: Record<string, unknown>,
  column: string,
  table: string,
  allowed: readonly T[],
): T {
  const value = row[column];
  if (typeof value !== 'string')
    throw new PayoutRowError(`\`${table}.${column}\` did not read back as text`);
  if (!(allowed as readonly string[]).includes(value))
    throw new PayoutRowError(
      `\`${table}.${column}\` is \`${value}\`, which is outside the enum's own members ` +
        `(${allowed.join(' | ')}). A value outside them is a REFUSAL and never a default: ` +
        'ADR-041 refused a fourth so that a fourth arriving later fails closed on this door',
    );
  return value as T;
}

/**
 * The store this backend does NOT install.
 *
 * `UNWIRED_PAYOUT_BACKEND`'s own store, restated here rather than imported
 * because `routes/payouts.ts` keeps it module-private. The three method names
 * are spelled into the error the way that file spells them, so a 503 names the
 * member a reader can go and look at.
 */
const UNWIRED_STORE: IdempotencyStore = {
  find: () => Promise.reject(new PayoutBackendUnwired('idempotency.find')),
  begin: () => Promise.reject(new PayoutBackendUnwired('idempotency.begin')),
  complete: () => Promise.reject(new PayoutBackendUnwired('idempotency.complete')),
};

/**
 * The postgres `PayoutBackend`. Three members answer and four refuse.
 *
 * THE `db` IS A PARAMETER AND NOT `LIVE_DB` REACHED FOR, on
 * `databaseAuthBackend`'s and `databaseWithdrawalBackend`'s shape: the door is
 * handed in, so the suite drives this adapter against a recorder and slice 9
 * hands it the live one in the one file that composes the deployable.
 */
export function postgresPayoutBackend(db: ApiDb): PayoutBackend {
  return {
    /**
     * ONE TRANSACTION, AND IT IS THE ONE EVERY LATER SLICE READS ON.
     *
     * THE IDENTITY IS BOUND ONCE, FROM THE SESSION, AND `PayoutTx` CARRIES NO
     * IDENTITY PARAMETER BECAUSE OF IT. That is the port's own docblock relied
     * on rather than restated: a member taking an account id could be handed one
     * the caller does not own, and a scoped read of a foreign account's rows is
     * EMPTY, which is how `subject()` returning `null` becomes section 1's 404.
     *
     * IT COMMITS ONLY IF `fn` RETURNS, and that is `packages/db`'s property
     * rather than one restated here: `db.scoped` is `transaction(scopedDb(id))`,
     * which issues `BEGIN`, `ROLLBACK`s on a throw without replacing the error
     * that caused it, and `COMMIT`s on the one path where `fn` returned
     * (`packages/db/src/scoped-db.ts`). This file adds no second commit rule.
     *
     * NO SECOND UUID PREDICATE. `db.scoped` refuses a non-uuid before the
     * accessor with `DbDoorError`, and a check here would be a second statement
     * of one fact on the money path.
     *
     * NO LOCK IS TAKEN HERE, AND THAT IS NOW A DECISION RATHER THAN A REPORT.
     * ADR-293 section 3.5 ruled that the payout path DOES take the per-identity
     * lock, and that it takes it the way both existing precedents do: as a port
     * member the DECISION FUNCTION calls, never as a line inside `transact`.
     * `decideWithdrawal` takes `await tx.lockScope()` as its first statement
     * (`routes/wallet-withdrawals.ts`) and `checkout.ts`'s handler does the
     * same; a lock hidden in `transact` would put the ordering that makes the
     * gate a control outside the one function a reader checks orderings in.
     *
     * THE SENTENCE THAT STOOD HERE WAS FALSE AND IS CORRECTED RATHER THAN
     * DELETED. It read that `databaseWithdrawalBackend` calls `tx.lockScope()`
     * first. Read at source, that adapter EXPOSES the member and
     * `decideWithdrawal` calls it. ADR-291, row 293 and this file all repeated
     * the imprecise version, which is exactly the class of error
     * `MERIT_BUILD_MASTER_PROMPT`'s "caution learned the hard way" names.
     *
     * AND THE RULED MEMBER IS BUILT NOW, WHICH IS WHERE THIS PARAGRAPH USED TO
     * SAY IT WAS OWED. ADR-301 landed `PayoutTx.lockScope()`, the delegation
     * below it, and the call as `decidePayout`'s first statement, so the
     * read-then-write this file's `insertPayoutRequest` creates is serialised
     * by the lock rather than backstopped by
     * `payout_requests_no_in_flight_uq` alone. ADR-293 section 3.3 measured
     * that index as a BACKSTOP and not the control, in two directions: it
     * turns a contract-specified 409 into a 500, and it is keyed PER ACCOUNT
     * where the exposure question the schema denormalises `identity_id` for is
     * PER IDENTITY. Both directions are the lock's now.
     *
     * THE HANDLE DOES NOT ESCAPE, AND IT IS HELD BY SHAPE RATHER THAN BY A
     * FLAG. `transact` takes the unit of work instead of handing a `PayoutTx`
     * back, which is `ApiDb`'s own property ("a transaction cannot outlive the
     * function that opened it") extended one layer out. A runtime validity flag
     * would be a second mechanism for a thing the signature already carries.
     */
    transact: (session, fn) =>
      db.scoped(session.identityId, (handle) => {
        /**
         * THE ANNOTATION IS LOAD-BEARING AND IS NOT DECORATION.
         *
         * `rule-state-producibility.test.ts` tracks whether anything in this
         * tree implements `PayoutTx` by looking for `: PayoutTx` under a
         * deployable's `src/`, and an implementation the census cannot see is
         * worse than none: `wiring.test.ts`'s clause FIVE would keep reading as
         * live to every grep while being false. Contextual typing alone would
         * check this object just as well and would leave that census blind.
         */
        const tx: PayoutTx = {
          /**
           * `INV-M20-01`'s per-identity lock, and the WHOLE BODY IS THE
           * DELEGATION.
           *
           * IT IS `ScopedTx.lockScope` AND NOTHING ELSE, exactly as
           * `databaseWithdrawalBackend` (`routes/wallet-withdrawals.ts`) writes
           * the same member: the handle is already bound to one identity, the
           * accessor's verb takes no argument, and there is therefore no
           * address anywhere on this path a caller could point at somebody
           * else. An advisory lock through `sqlExecutor` says the same thing
           * without the tenancy conjunct and is refused by name in ADR-157.
           *
           * NOTHING IS DECIDED HERE AND THAT IS THE POINT. `decidePayout` calls
           * this as its first statement and the ORDER is the control; this
           * object only makes the member callable.
           */
          lockScope: async (): Promise<void> => {
            await handle.lockScope();
          },

          /**
           * `identities.status` for the caller. ADR-140's door.
           *
           * READ PER CALL AND NEVER MEMOISED. ADR-287 section 2: an
           * implementation that read the identity row lazily inside
           * `subject()` and cached it would satisfy the type and break
           * ADR-140's ordering, which is `INV-M5-23`'s placement argument.
           * `decidePayout` calls this FIRST, before anything about the account
           * is read, and a cache would make the order an accident of which
           * member ran first.
           *
           * EXACTLY ONE ROW OR IT RAISES. `identities` is scope class `root`
           * on `id` (`packages/db/src/scope.ts`), so this predicate is
           * `identities.id = $1` and the answer is the caller's own row. Zero
           * rows is Merit's records disagreeing with the session it just
           * authenticated, which is not the trader's fault and is not a
           * refusal to hand them.
           */
          identityStatus: async (): Promise<IdentityStatus> => {
            const rows = await handle.rows('identities');
            const row = rows[0];
            if (rows.length !== 1 || row === undefined)
              throw new PayoutRowError(
                `a scoped read of \`identities\` returned ${String(rows.length)} rows. The ` +
                  "rule is `root` on `id`, so it returns the caller's own row and exactly one",
              );
            return member(asRow(row, 'identities'), 'status', 'identities', IDENTITY_STATUSES);
          },

          // ADR-287 slices 4 and 5. `state` needs ADR-285's absent-row arm and
          // `plan` needs the size-row decoder ADR-286 rules. NOT STUBBED: a
          // synthesised `RuleState` is a payout basis nobody computed.
          subject: () => Promise.reject(new PayoutBackendUnwired('subject')),

          // ADR-287 slice 8, WHICH CANNOT BE SCHEDULED. `HoldFlag.tosClause`
          // has no value space in this repository and `DEP-M7-05` owes the
          // clauses to counsel; `risk_flags` carries neither `tos_clause` nor
          // `reason` among its seventeen columns. A hold citing a clause Merit
          // has not published is worse than an unwired route.
          holdFlag: () => Promise.reject(new PayoutBackendUnwired('holdFlag')),

          /**
           * ADR-287 slice 6, THE APPROVAL BRANCH AND NOT THE HOLD BRANCH.
           *
           * IT RETURNS NOTHING, AND THE COMMENT THAT USED TO STAND HERE SAID
           * THE OPPOSITE. It read that this member "must return
           * `{ eligibilitySnapshotId }`" and that nothing in this repository
           * supplies one. The second half was true and is why ADR-289 deleted
           * the field from the frozen contract and ruled the member
           * `Promise<void>`; the first half outlived that ruling by two
           * sessions. Corrected where it was made, on ADR-293 section 4D.
           *
           * THE HOLD BRANCH REFUSES AND IS NOT STUBBED. A row carrying a hold
           * is ADR-287 slice 8, WHICH CANNOT BE SCHEDULED: `HoldFlag.tosClause`
           * has no value space in this repository and `DEP-M7-05` owes the
           * clauses to counsel. No clause id is invented here, no enum of
           * clause names is written and no default string is chosen. THE
           * REFUSAL IS `PayoutBackendUnwired` AND SO IT IS A 503, which is the
           * honest answer for an unbuilt member. THE PREDICATE IS TWO SIDED ON
           * PURPOSE, matching `payout_requests_hold_is_complete`
           * (`0031_payout_hold_and_identity_restriction.sql:61-72`): the
           * database admits `hold` present WITH `held_pending_review` or
           * neither, so a row that is half of either is refused here rather
           * than sent to a CHECK constraint to become a 500.
           *
           * `plan_version_id` IS DERIVED AND THAT IS ADR-287 FINDING F3'S OTHER
           * DIRECTION. The column is `uuid NOT NULL REFERENCES plan_versions`
           * (`0010_payouts.sql:68`) and `PayoutRequestInsert` does not carry
           * it, so it is read off `accounts` ON THIS TRANSACTION. THE COPY
           * CANNOT GO STALE, and that is a property the database enforces
           * rather than one this comment hopes for: `0007_accounts.sql:12`
           * states "plan_version_id NEVER CHANGES, for the life of the
           * account" as a numbered property of the table, and
           * `0027_triggers_invariants.sql:272` is the trigger that raises on an
           * attempt to move it. AN ABSENT ACCOUNT ROW IS A REFUSAL AND NEVER A
           * DEFAULT: `accounts` is scope class `owned` on `identity_id`, so a
           * read that returns nothing is either a foreign account or a missing
           * one, and both are conditions under which no payout row may be
           * written.
           *
           * `splitBp` AND `clampReason` ARE NAMED NOWHERE, AND THAT IS ADR-287
           * FINDING F3'S LANDMINE ANSWERED. Neither has a column:
           * `grep -rn split_bp packages/db/migrations` and the same for
           * `clamp_reason` each return ZERO lines. BOTH VALUES ARE ALREADY
           * STORED, inside `eligibilitySnapshot`, which this body passes
           * through untouched into `eligibility_snapshot jsonb NOT NULL`.
           * Writing them anywhere else would state one money fact twice on the
           * money path, and the second statement is the one that can disagree.
           *
           * `identity_id` IS NAMED NOWHERE EITHER, AND THAT IS THE DOOR
           * WORKING. `payout_requests` is scope class `owned` on `identity_id`,
           * and a scoped write STAMPS its tenancy column from the handle:
           * naming it in an insert's values is REFUSED by `packages/db`. Its
           * absence from `PayoutRequestInsert` is not a field somebody forgot.
           *
           * EVERY MONEY FIELD IS PASSED THROUGH AS THE `bigint` IT ARRIVES AS.
           * `Cents` is `bigint` (`@merit/rules-engine`), the four columns are
           * `bigint NOT NULL` in `0010_payouts.sql`, and there is no `Number()`
           * anywhere on this path: a float on the money path is the defect the
           * whole corpus is written against.
           */
          insertPayoutRequest: async (row): Promise<void> => {
            if (row.hold !== null || row.status !== 'approved')
              throw new PayoutBackendUnwired('insertPayoutRequest.hold');

            const account = await handle.rowAt('accounts', { id: row.accountId });
            if (account === undefined)
              throw new PayoutRowError(
                'the `accounts` row this payout is written against reads back empty on this ' +
                  'transaction. The handle is scoped, so that is a foreign account or an absent ' +
                  'one, and `payout_requests.plan_version_id` is `NOT NULL`: there is no value ' +
                  'to write and none to invent',
              );

            await handle.insert('payoutRequests', {
              id: row.id,
              accountId: row.accountId,
              planVersionId: text(asRow(account, 'accounts'), 'planVersionId', 'accounts'),
              requestedCents: row.requestedCents,
              approvedCents: row.approvedCents,
              traderCents: row.traderCents,
              firmCents: row.firmCents,
              basisTradingDay: row.basisTradingDay,
              eligibilitySnapshot: row.eligibilitySnapshot,
              status: row.status,
              idempotencyKey: row.idempotencyKey,
              payoutOrdinal: row.ordinal,
            });
          },
        };
        return fn(tx);
      }),

    // ADR-287 slice 7, blocked on slice 2's ruling. `PayoutListItem` declares
    // ten fields; `failure_note` has no column and API_CONTRACT says so in its
    // own words, and `timeline` has no source this handle reads. A projection
    // invented here would be a trader-visible payout history nobody specified.
    listPayouts: () => Promise.reject(new PayoutBackendUnwired('listPayouts')),

    // THE MEMBER THAT COULD ANSWER AND DOES NOT. See the header.
    idempotency: UNWIRED_STORE,
  };
}
