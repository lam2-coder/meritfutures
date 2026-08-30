// =============================================================================
// apps/api/src/payout-backend.ts
// =============================================================================
// THE FIRST LINE OF PAYOUT PERSISTENCE THIS TREE HAS EVER HAD, AND IT IS TWO
// MEMBERS OF SEVEN ON PURPOSE.
//
// `wiring.test.ts`'s `usePayoutBackend` entry has carried one clause longer than
// any other: "NOTHING IN THIS TREE IMPLEMENTS `PayoutTx`". ADR-287 enumerated
// what implementing it would cost and found nine sessions, of which this file is
// slice 3. ADR-291 is this file's ruling.
//
// -----------------------------------------------------------------------------
// WHAT ANSWERS, AND WHAT REFUSES
// -----------------------------------------------------------------------------
// `PayoutBackend` and `PayoutTx` carry SEVEN members between them. TWO answer
// here and FIVE reject with `PayoutBackendUnwired`:
//
//   transact          ANSWERS. The scoped door, opened once per request.
//   identityStatus    ANSWERS. `identities.status`, decoded to one of three.
//   subject           REFUSES. ADR-287 slices 4 and 5.
//   holdFlag          REFUSES. ADR-287 slice 8, whose supplier is COUNSEL.
//   insertPayoutRequest REFUSES. ADR-287 slice 6, blocked on the slice 1 ruling.
//   listPayouts       REFUSES. ADR-287 slice 7, blocked on the slice 2 ruling.
//   idempotency       REFUSES, AND IT IS THE ONE THAT COULD ANSWER TODAY.
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
 * The postgres `PayoutBackend`. Two members answer and five refuse.
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
     * NO LOCK IS TAKEN AND THAT IS REPORTED RATHER THAN DECIDED.
     * `databaseWithdrawalBackend` calls `tx.lockScope()` first, because its
     * handler reads a balance and then writes against it. Nothing this
     * transaction currently does reads-then-writes, `PayoutTx` declares no
     * `lockScope` member to call, and a lock installed here would be a
     * serialization policy for slices 4 to 7 chosen by the slice that could not
     * yet see their reads. ADR-291 registers it as slice 6's question.
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

          // ADR-287 slice 6, blocked on slice 1's ruling.
          // `insertPayoutRequest` must return `{ eligibilitySnapshotId }` and
          // NOTHING IN THIS REPOSITORY SUPPLIES ONE: the column is
          // `eligibility_snapshot jsonb NOT NULL` and there is no id. Writing
          // the row and minting an identifier for the receipt would be this
          // adapter making the ruling ADR-287 finding F2 says is owed.
          insertPayoutRequest: () =>
            Promise.reject(new PayoutBackendUnwired('insertPayoutRequest')),
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
