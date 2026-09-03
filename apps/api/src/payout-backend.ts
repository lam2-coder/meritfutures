// =============================================================================
// apps/api/src/payout-backend.ts
// =============================================================================
// THE FIRST LINE OF PAYOUT PERSISTENCE THIS TREE HAS EVER HAD, AND IT IS FOUR
// MEMBERS OF EIGHT ON PURPOSE.
//
// `wiring.test.ts`'s `usePayoutBackend` entry has carried one clause longer than
// any other: "NOTHING IN THIS TREE IMPLEMENTS `PayoutTx`". ADR-287 enumerated
// what implementing it would cost and found nine sessions, of which this file is
// slice 3. ADR-291 is this file's ruling, ADR-295 added slice 6, ADR-301 added
// the lock ADR-293 ruled and ADR-295's fence could not reach, and ADR-306 built
// three of `subject()`'s four legs.
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
//   subject             REFUSES, AND IT IS THE ONE THAT IS THREE QUARTERS
//                       BUILT. ADR-287 slice 4, ruled by ADR-306: the `null`
//                       arm, `gates` and `plan` up to the size decode all
//                       answer, and the member still cannot, because `state`
//                       and the size row's decoding are slice 5's. THE REFUSAL
//                       NAMES BOTH.
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
// -----------------------------------------------------------------------------
// A MEMBER THAT REFUSES BY NAME, AND WHY THE NAME IS WORTH THE LINES
// -----------------------------------------------------------------------------
// `subject()` refused wholesale for three revisions, on one line, under a comment
// naming ADR-287 slices 4 AND 5 together. That is a blanket rejection and it
// COSTS A SESSION: a reader cannot tell a member nobody has started from a member
// whose last leg is missing, and row 306 was dispatched only after re-deriving at
// source that slice 4 had never been built while both records said slice 5 was
// next. What the member throws now names `subject.state` and `subject.plan.size`,
// which is the remainder as ADR-287 section 7 sizes it.
//
// IT NAMES BOTH RATHER THAN THE FIRST ONE IT REACHES, on `resolveExternalGates`'s
// shape: every leg is evaluated before any of them refuses, so the report is the
// whole set. A member that stopped at the first unbuilt leg would tell the next
// session the remainder is one item when it is two.
//
// NO SYNTHESISED DEFAULT ON EITHER PATH. A status outside `identity_status`'s
// three members raises; it never falls back to `restricted` (which would deny a
// trader on a value nobody wrote) and never to `active` (which would open the
// money door on one). ADR-041 refused a fourth member and ADR-140's predicate is
// `= 'active'` precisely so a fourth arriving later fails CLOSED.
// =============================================================================

import type { ScopedTx } from '@merit/db';
import { decodePlanRules, resolveExternalGates } from '@merit/rules-engine';
import type { ExternalGates, ResolvedPlan, RuleState } from '@merit/rules-engine';

import type { ApiDb } from './db.ts';
import type { IdempotencyStore } from './idempotency.ts';
import { PayoutBackendUnwired } from './routes/payouts.ts';
import type { IdentityStatus, PayoutBackend, PayoutSubject, PayoutTx } from './routes/payouts.ts';

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

/** One nullable text column, kept nullable. `kyc_verifications.supersedes`. */
function textOrNull(row: Record<string, unknown>, column: string, table: string): string | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string')
    throw new PayoutRowError(
      `\`${table}.${column}\` read back as a ${typeof value} and the column is a nullable text`,
    );
  return value;
}

/**
 * One `boolean NOT NULL` column, or a refusal naming what was read.
 *
 * IT DOES NOT COERCE, AND ON THIS DOOR THAT IS THE WHOLE POINT. Every flag this
 * reads is an `R-41` VETO: a truthy string read as `true` is a veto firing on
 * the wrong account, and a falsy one is a veto that never fires at all.
 * `eligible-next-7d.ts`'s `flag` states the same rule one read over.
 */
function flag(row: Record<string, unknown>, column: string, table: string): boolean {
  const value = row[column];
  if (typeof value !== 'boolean')
    throw new PayoutRowError(
      `\`${table}.${column}\` read back as ${JSON.stringify(value)} and the column is a ` +
        '`boolean NOT NULL`. It is an R-41 veto, and a coerced one is a veto that fires on the ' +
        'wrong account or never fires at all',
    );
  return value;
}

/**
 * ONE LEG OF `PayoutSubject`, ANSWERED OR REFUSED BY NAME.
 *
 * **THE SHAPE IS `resolveExternalGates`'s `Leg<T>` AND IT IS THE SAME SHAPE FOR
 * THE SAME REASON** (`packages/rules-engine/src/external-gates.ts`): every leg is
 * evaluated before any of them refuses, so what a caller meeting an unbuilt
 * `subject()` gets is the WHOLE SET of members that could not answer rather than
 * whichever one this file happened to reach first. ADR-287 slice 4 builds three
 * of the four legs and slice 5 builds the rest, so today the set has two members
 * in it and a session that read a single refusal would size the remainder wrong.
 *
 * **THE REFUSAL CARRIES A MEMBER NAME AND NOT A VALUE, WHICH IS THE `NOTHING IS
 * STUBBED` RULE MADE STRUCTURAL.** There is no arm of this type that holds a
 * partial `RuleState` or a half-resolved `ResolvedPlan`, so a later session
 * cannot fill one in without changing the type.
 */
type SubjectLeg<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly member: string };

/**
 * `PayoutSubject.state`. ADR-287 SLICE 5, REFUSED BY NAME AND NOT FOLDED HERE.
 *
 * **THE REFUSAL IS RULED RATHER THAN PREFERRED, AND THE RULING IS THE PORT'S
 * OWN.** `PayoutSubject.state`'s docblock (`routes/payouts.ts`) requires a
 * backend implementing `subject()` to CALL `ruleStateOn` (`../rule-state-reader
 * .ts`) and NOT to fold a state in the request path, on `INV-M5-02` and ADR-239:
 * the API reads the state the WORKER wrote, and a request-path fold is the
 * divergence ADR-026 `C-07`'s `state_hash` exists to make detectable, computed
 * on the one path no replay audit reads. The day it is read on is
 * `ScopedTx.lastClosedTradingDay()` on ADR-268 and never a calendar folded here.
 *
 * **SO WHY IS IT NOT BUILT, WHEN BOTH DOORS EXIST?** Because `ruleStateOn`
 * raises `RuleStateAbsent` for a day the nightly fold has not closed, and the
 * ORDER in which that refusal may escape is ADR-285 ruling 4: the ownership
 * answer is FIRST, so `RuleStateAbsent` may only leave this member for an
 * account the handle can already see. That ordering plus the reader's own
 * arguments is ADR-287 slice 5, which is a row of its own and not this one's.
 *
 * **IT IS A CONSTANT AND NOT A FUNCTION BECAUSE IT READS NOTHING.** A function
 * here would suggest there is a read to place in an order, and there is not:
 * what slice 5 adds is the read, and it will be a function on that day.
 */
const STATE_LEG: SubjectLeg<RuleState> = { ok: false, member: 'subject.state' };

/**
 * `PayoutSubject.plan`, UP TO BUT NOT INCLUDING THE SIZE DECODE (ADR-287 slice 4).
 *
 * **WHAT THIS DOES IS THE HALF ADR-283 LANDED**: the pinned version is read off
 * `accounts.plan_version_id` and its `rules` blob is decoded by the ENGINE's
 * `decodePlanRules`. `PayoutSubject.plan`'s own docblock forbids a fourth
 * transcription of that blob in this deployable (`FM-16` on the money path,
 * ADR-269's refusal one port over), so the decoder is imported and never
 * restated.
 *
 * **WHAT IT DOES NOT DO IS THE SIZE ROW, AND THE CUT IS AT THE DECODE.**
 * `resolvePlan` takes a decoded `PlanVersionSizeRow` as its second argument and
 * nothing in this repository decodes one: ADR-287 section 3.3 measured that at
 * source and ADR-283 section 5 declined to take it, because the two readers that
 * exist read two DIFFERENT sources under two different key spellings and merging
 * them is a ruling rather than a transcription. **NO CAST STANDS IN FOR IT.** A
 * `PlanVersionSizeRow` asserted onto an untyped row is a payout basis nobody
 * checked, and it is worse than a refusal because it looks like a decode.
 *
 * **AND THE SIZE ROW IS NOT READ EITHER, WHICH IS A DECISION AND NOT AN
 * OVERSIGHT.** `catalogRowAt` answers a row OR `undefined`, and what an absent
 * `plan_version_sizes` row MEANS on this door -- an account pinned to a size its
 * own plan version does not publish -- is a refusal rule nobody has written.
 * Writing it here would settle half of slice 5's question in an adapter, which is
 * this port's whole history. The rules decode is different in kind and that is
 * why it runs: its decoder EXISTS, is ruled, and refusing a malformed blob is a
 * control this member can actually apply today.
 *
 * **THE DECODED VALUE IS DISCARDED AND THE DECODE IS STILL THE POINT.** Nothing
 * consumes `PlanRulesJson` until `resolvePlan` can be called, so what this line
 * buys is the REFUSAL: a `plan_versions.rules` blob this build cannot read
 * refuses here, on the account's own transaction, rather than on the day slice 5
 * installs a fold over it for the first time.
 */
async function planLeg(
  handle: ScopedTx,
  account: Record<string, unknown>,
): Promise<SubjectLeg<ResolvedPlan>> {
  const planVersionId = text(account, 'planVersionId', 'accounts');
  const version = await handle.catalogRowAt('planVersions', { id: planVersionId });
  if (version === undefined)
    throw new PayoutRowError(
      `\`accounts.plan_version_id\` names \`${planVersionId}\` and \`plan_versions\` carries no ` +
        'such row on this transaction. The column is `uuid NOT NULL REFERENCES plan_versions` ' +
        '(`0007_accounts.sql`), so an empty read is the catalogue disagreeing with the account ' +
        'rather than a version to substitute for',
    );
  decodePlanRules(version.rules, `plan_versions[${planVersionId}].rules`);
  return { ok: false, member: 'subject.plan.size' };
}

/**
 * `PayoutSubject.gates`. ADR-287 SLICE 4, AND IT ANSWERS.
 *
 * **THE RESOLVER IS THE ENGINE'S AND THE READINGS ARE NOT REPEATED HERE.**
 * `PayoutSubject.gates`'s docblock requires a backend to call
 * `resolveExternalGates` and not to write the record out, and `external-gates.ts`
 * says why in its own words: every member handed over is the RAW column, because
 * a narrowing here would be a second place the seven-versus-six
 * `accounts.status` question is answered. `eligible-next-7d.ts`'s `gatesOf` is
 * the same call one door over and this body is deliberately its shape.
 *
 * **THE KYC READ IS THE WHOLE CHAIN AND NOT THE HEAD.** `SD-M19-01` makes a
 * re-verification a NEW ROW pointing at the one it supersedes, so the head is a
 * property of the SET and cannot be addressed. **THE PAYOUT READ IS EVERY ROW
 * AND THE STATUS FILTER IS THE ENGINE'S**: a filter here would be another copy
 * of `payout_requests_no_in_flight_uq`'s predicate with nothing comparing it.
 *
 * **NEITHER READ NAMES A TENANCY COLUMN AND NEITHER NEEDS TO.**
 * `kycVerifications` and `payoutRequests` are both scope class `owned` on
 * `identity_id` (`packages/db/src/scope.ts`), so the handle's own predicate is
 * the identity conjunct; `rowsWhere('payoutRequests', { accountId })` narrows to
 * the SUBJECT ACCOUNT and nothing else. `identities` is `root` on `id`, so
 * `rows('identities')` is the caller's own row, which is `identityStatus`'s
 * argument unchanged.
 *
 * **THE IDENTITY ROW IS READ AGAIN RATHER THAN CARRIED FROM `identityStatus()`.**
 * That member's docblock forbids memoisation for ADR-140's ordering reason, and
 * a value cached across two members would make the order an accident of which
 * one ran first. Two reads of one row inside one transaction is the cheap half
 * of that trade.
 *
 * @throws ExternalGatesRefusal from the engine, UNCAUGHT ON PURPOSE. It is not a
 * `PayoutBackendUnwired`, so `unwiredOrThrow` rethrows it and the route answers
 * 500 rather than 503: a column outside its own enum is Merit's records
 * disagreeing with Merit's schema, which no retry fixes. `R-41` conjoins all
 * five gates as vetoes, so a defaulted leg is either a veto that never fires or
 * one that denies an eligible trader while reading as a working gate.
 */
async function externalGatesFor(
  handle: ScopedTx,
  accountId: string,
  account: Record<string, unknown>,
): Promise<ExternalGates> {
  const identities = await handle.rows('identities');
  const identity = identities[0];
  if (identities.length !== 1 || identity === undefined)
    throw new PayoutRowError(
      `a scoped read of \`identities\` returned ${String(identities.length)} rows. The rule is ` +
        "`root` on `id`, so it returns the caller's own row and exactly one",
    );

  const kycChain = (await handle.rows('kycVerifications')).map((value, index) => {
    const at = `kyc_verifications[${String(index)}]`;
    const row = asRow(value, at);
    return {
      id: text(row, 'id', at),
      state: text(row, 'state', at),
      supersedes: textOrNull(row, 'supersedes', at),
    };
  });

  const payoutRequestStatuses = (await handle.rowsWhere('payoutRequests', { accountId })).map(
    (value, index) => {
      const at = `payout_requests[${String(index)}]`;
      return text(asRow(value, at), 'status', at);
    },
  );

  return resolveExternalGates({
    accountId,
    accountStatus: text(account, 'status', 'accounts'),
    identityPayoutsFrozen: flag(asRow(identity, 'identities'), 'payoutsFrozen', 'identities'),
    accountPayoutsFrozen: flag(account, 'payoutsFrozen', 'accounts'),
    reconBlocked: flag(account, 'reconBlocked', 'accounts'),
    kycChain,
    payoutRequestStatuses,
  });
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

          /**
           * THREE LEGS OF FOUR (ADR-287 slice 4), AND THE OTHER TWO REFUSE BY
           * NAME.
           *
           * THE MEMBER STILL CANNOT ANSWER AND THE LINE IT REPLACES SAID SO IN
           * ONE WORD. What changed is WHICH word: `subject` refused wholesale,
           * so a reader could not tell a member nobody had started from a member
           * three quarters built, and a session dispatched to finish it would
           * have been asked to complete legs that did not exist. The refusal now
           * names `subject.state` and `subject.plan.size`, which are exactly
           * ADR-287 slice 5's two items.
           *
           * NOTHING IS STUBBED AND THE COMMENT THAT STOOD HERE SAID WHY: a
           * synthesised `RuleState` is a payout basis nobody computed. That rule
           * is now structural rather than stated. `SubjectLeg<T>` has no arm
           * carrying a partial value, so the unbuilt legs cannot be filled in
           * without changing the type, and the `return` below reads every leg's
           * `value` or none of them.
           *
           * -------------------------------------------------------------------
           * THE ORDER IS THE CONTROL AND IT IS ADR-285 RULING 4
           * -------------------------------------------------------------------
           * THE OWNERSHIP ANSWER IS FIRST. `accounts` is scope class `owned` on
           * `identity_id`, so a scoped read cannot tell a foreign account from an
           * absent one and `null` is section 1's 404 for both. An implementation
           * that read anything else first would hand a prober a different status
           * for another identity's account than for one that does not exist,
           * which section 1 requires this API not to do. Every read below happens
           * only for an account this handle can already see.
           *
           * AND EVERY BUILT LEG RUNS BEFORE EITHER REFUSAL, which is
           * `resolveExternalGates`'s own shape one level up: a 503 thrown before
           * the gates resolved would MASK an `ExternalGatesRefusal` or a
           * `PlanRulesCodecError` on this account, and slice 5 would then be
           * installing two readers that had never run against a real row.
           *
           * -------------------------------------------------------------------
           * THE `null` ARM IS THE READ ANSWERING EMPTY AND IS NEVER A CATCH
           * -------------------------------------------------------------------
           * `rowAt` answers `undefined` when the scoped predicate matches
           * nothing, and that is the only thing this arm reads. A `null` returned
           * because a LATER read threw would be a 404 for an account that exists,
           * which on this door is telling a trader their funded account is gone.
           */
          subject: async (accountId): Promise<PayoutSubject | null> => {
            const found = await handle.rowAt('accounts', { id: accountId });
            if (found === undefined) return null;
            const account = asRow(found, 'accounts');

            const gates = await externalGatesFor(handle, accountId, account);
            const plan = await planLeg(handle, account);
            const state = STATE_LEG;

            if (!state.ok || !plan.ok) {
              const unbuilt = [
                ...(state.ok ? [] : [state.member]),
                ...(plan.ok ? [] : [plan.member]),
              ];
              throw new PayoutBackendUnwired(unbuilt.join(' and '));
            }

            return { accountId, state: state.value, plan: plan.value, gates };
          },

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
