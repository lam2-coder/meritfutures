// =============================================================================
// apps/api/src/routes/admin-wallet.ts
// =============================================================================
// API_CONTRACT SECTION 8's THREE WALLET ROWS, WRITTEN BY ADR-158 AND SERVED BY
// NOTHING UNTIL THIS FILE:
//
//   GET  /admin/wallet/reconciliation
//   POST /admin/wallet/:identityId/correct
//   POST /admin/wallet/:identityId/spend-limit
//
// MONEY PATH BY CONTENT. `correct` adjusts a trader's wallet, `spend-limit` sets
// what they may spend, and `reconciliation` is the read an operator opens when
// the two disagree. The `E2` line-by-line read is owed on every line here.
//
// -----------------------------------------------------------------------------
// ONE OF THE THREE IS COMPLETE AND TWO STOP AT A REFUSAL. READ THIS BEFORE
// READING THE HANDLERS
// -----------------------------------------------------------------------------
// ALL THREE ARE REGISTERED, on `wallet.ts`'s recorded reason for registering a
// route whose persistence is not installed: "The routes are REGISTERED because
// the contract rows exist; a missing route answers 404 and reads as a contract
// Merit never wrote." What differs is how far each handler gets before it meets
// something this fence cannot supply.
//
//   `spend-limit`   COMPLETE. `wallet_spend_limits` exists, is registered, is
//                   `owned`, and every field the contract names has a column.
//
//   `correct`       COMPLETE THROUGH validation, dual control, the row lock, the
//                   precondition re-read and the `admin_actions` row. THE WRITE
//                   ITSELF IS REFUSED, on THREE independent disagreements
//                   between API_CONTRACT's body and
//                   `0038_account_adjustments.sql`. There were four; ADR-173
//                   ruled the first and the ruling is applied here. The three
//                   that remain are enumerated below and none of them is
//                   repairable from a route file.
//
//   `reconciliation` COMPLETE THROUGH the guard, the projection and the
//                   response's own arithmetic assertions. THE READ IS REFUSED,
//                   because its shape is a JOIN and an AGGREGATE and ADR-157
//                   clause 6 refuses both. That entry predicted this endpoint
//                   would be the one to meet the refusal and said what to do
//                   about it: report, do not widen.
//
// A REFUSED PORT ANSWERS 503 AND NEVER A PLAUSIBLE VALUE. `payouts.ts`,
// `checkout.ts`, `wallet.ts` and `admin-payouts.ts` each say the same sentence
// about their own unwired default and it is worth most here: the value this one
// would have to invent is how much money a trader has.
//
// -----------------------------------------------------------------------------
// WHY `correct` CANNOT BE WRITTEN, AT THE CONSTRAINT RATHER THAN IN PROSE
// -----------------------------------------------------------------------------
// `0038_account_adjustments.sql` IS THE BUILT DOOR FOR AN ADMIN WALLET
// CORRECTION AND NO ADR IN THIS RANGE CITES IT. Its own header calls itself
// "the first admin route in this corpus that moves money to a NAMED PERSON",
// and its `assert_adjustment_wallet_entry_matches` trigger is what makes a
// `wallet_entries` row with `provenance = 'correction'` legal:
//
//   SELECT count(*) ... FROM wallet_entries w
//    WHERE w.reference_id          = NEW.id
//      AND w.ledger_transaction_id = NEW.ledger_transaction_id
//      AND w.identity_id           = NEW.identity_id
//      AND w.direction             = NEW.direction
//      AND w.amount_cents          = NEW.amount_cents
//      AND w.provenance            = 'correction';
//   IF entries <> 1 THEN RAISE EXCEPTION 'ADJ-C3: ...'
//
// Quoted rather than paraphrased, and read at the source before this module was
// planned. Four things followed, and every one of them was a disagreement with
// API_CONTRACT's `WalletCorrectionRequest` rather than a gap in it. THE FIRST IS
// NOW RULED AND THREE STAND:
//
//   1. RULED BY ADR-173, AND THE RULING IS APPLIED IN THIS FILE.
//      `reference_id` IS THE ADJUSTMENT'S ID AND NOTHING ELSE. The contract used
//      to say `corrects_entry_id` "Becomes `reference_id`"; ADJ-C3 requires
//      `reference_id` to be `account_adjustments.id`, and the type settles it a
//      second time: `wallet_entries.reference_id` is `uuid NOT NULL` (`0011`),
//      `wallet_entries.id` is `bigint GENERATED ALWAYS AS IDENTITY` (`0011`),
//      and ADR-158 clause 3 makes `entry_id` a DECIMAL STRING on the wire for
//      exactly that reason. A decimal string is not a uuid, so the instruction
//      was not merely wrong about which id belongs in the column: IT WAS NOT
//      EXPRESSIBLE, and PostgreSQL refuses it with `invalid input syntax for
//      type uuid` before any constraint gets a turn.
//
//      THERE IS NO COLUMN ANYWHERE THAT HOLDS WHICH ENTRY A CORRECTION
//      CORRECTS, AND ADR-173 CLAUSE 3 RULED THAT NONE IS OWED. The durable
//      record is the `admin_actions` row's `before.corrected_entry`, which
//      carries the whole entry as it stood before the correction, plus an
//      `evidence_refs` entry of kind `wallet_entry`. That row is append-only
//      under the same `0026` revoke as the wallet itself, and it holds strictly
//      more than a column would. The cost is named rather than hidden: the row
//      is written by this handler and not by a trigger, so nothing in the
//      database refuses a correction composed without one (ADR-173 section 6
//      item 1).
//
//      TWO THINGS IN THIS FILE ARE THAT RULING. `corrects_entry_id` is OPTIONAL,
//      because a `goodwill` adjustment corrects no entry and still lands as
//      `provenance = 'correction'`; and the `conflict` check is conditioned on
//      the field being present rather than deleted (ADR-173 clauses 4 and 5).
//
//   2. A CORRECTING DEBIT IS UNWRITABLE UNLESS IT EXACTLY REVERSES A PRIOR
//      ADJUSTMENT CREDIT. `account_adjustments_debit_is_a_reversal` is
//      `(direction = 'debit') = (reverses_adjustment_id IS NOT NULL)`, and
//      `assert_adjustment_reversal_is_sound` requires the same identity, the same
//      destination and the same cents, refusing a partial reversal by name. The
//      contract's body carries `direction: "credit" | "debit"` and no
//      `reverses_adjustment_id`, so the debit half of this endpoint addresses a
//      row the database will not accept.
//
//   3. DUAL CONTROL IS A ROW AND A THRESHOLD, NOT A NAME.
//      `account_adjustments_dual_control_above_threshold` is `amount_cents <
//      dual_control_threshold_cents OR dual_control_approval_id IS NOT NULL`,
//      `dual_control_threshold_cents` is `bigint NOT NULL CHECK (> 0)`, and
//      `dual_control_approval_id` references `dual_control_approvals`. The
//      contract's body carries `second_approver: string`.
//
//      **THE THRESHOLD NOW HAS A SOURCE AND STILL HAS NO WIRE FIELD, AND ADR-228
//      RULED BOTH HALVES.** This paragraph read "the threshold has no wire field
//      and no configured source in this tree", and the second half stopped being
//      true when the founder answered on 2026-08-29: the value is
//      `DUAL_CONTROL_THRESHOLD_CENTS`, `500000` integer cents, declared below
//      with the question it answers. It is NOT a number this repository
//      invented, which is the refusal ADR-139 clause 3 and ADR-158 clause 6 make
//      and which stands unchanged; it is the founder's, transcribed.
//
//      The first half is now a RULING rather than an observation: the endpoint
//      has no wire field for the threshold and must never gain one, because a
//      caller who names it can name one no adjustment reaches. `0068` is that
//      refusal in DDL (`account_adjustments_dual_control_threshold_ceiling`,
//      `<= 500000`), because a comment is not a control.
//
//      WHAT IS STILL MISSING IS THE APPROVAL ROW, NOT THE NUMBER. There is no
//      wire field for `dual_control_approval_id` and no path here that creates a
//      `dual_control_approvals` row, so this item remains unrepaired: what
//      changed is that the missing piece is now one thing rather than two.
//
//   4. `reason_code` IS `NOT NULL` OVER A CLOSED THREE-MEMBER VOCABULARY
//      (`goodwill`, `reconciliation_error`, `promotional_credit`) and the
//      contract's body carries free-text `cause` and `reason` and no code. A
//      correction written under a code the operator did not choose is a
//      categorisation Merit made up about its own error.
//
// ITEM 1 IS REPAIRED HERE AND ITEMS 2, 3 AND 4 ARE NOT, AND THE REPAIR FOR THEM
// IS NOT AVAILABLE TO THIS FENCE. Item 1 turned out to need no migration at all,
// which is ADR-173's ruling and the reason it could be applied from a route file.
// Items 2, 3 and 4 need contract rows this slice may not write (API_CONTRACT is
// `approved`, so a change to it is an ADR and this slice has no number).
//
// THIS PARAGRAPH USED TO ADD "and item 3 needs something no document in this
// tree supplies: the VALUE of `dual_control_threshold_cents`", AND THAT HALF IS
// DISCHARGED. ADR-228 landed the founder's answer as
// `DUAL_CONTROL_THRESHOLD_CENTS` below and `0068`'s ceiling in DDL. Item 3 is
// still unrepaired and the reason is now a DIFFERENT one, which is worth more
// than the sentence it replaces: what is missing is the `dual_control_approvals`
// row, not the number. **The honest thing is built and the loss is named**,
// which is the disposition ADR-158 used on its own findings and
// `admin-payouts.ts` used on the hold the biconditional erases.
//
// SO `writeCorrection` IS STILL A PORT AND THIS MODULE STILL COMPOSES NO
// POSTING. It hands the wiring slice exactly the fields API_CONTRACT gives it,
// plus the one binding ADR-173 settled, and nothing more; that is the shape that
// makes the gap visible. A slice that can satisfy `account_adjustments` from
// this draft does not exist, and the rulings it is waiting on are items 2, 3
// and 4 above. **Repairing one lie in a contract row does not make a handler
// writable and this file does not pretend otherwise.**
//
// AND THERE IS NO `ledger: LedgerTx` ON THE TRANSACTION HANDLE, WHICH IS THE
// DIFFERENCE FROM `admin-payouts.ts`. That file holds one because `M05` section
// 2.1 specifies `LT-01`'s legs and `payouts.ts` builds them, so the posting is
// an IMPORT rather than an invention. There is no `LT-nn` for a wallet
// correction anywhere in the corpus: `M20` section 5 names LT-01, LT-06, LT-07
// and LT-08 and no other. `0038` does name the legs -- the identity's
// destination class against `fees_revenue`, exactly two entries -- and naming
// them HERE would be a second transcription of a fact the migration already
// states, which is ADR-092 section 5's two-statements-of-one-fact hazard
// arriving on the money path. NOTHING HERE NAMES A LEDGER ACCOUNT, WRITES A
// TRANSFER, OR CONTAINS LEDGER ARITHMETIC.
//
// -----------------------------------------------------------------------------
// WHY `reconciliation` CANNOT BE READ, AT THE RULING RATHER THAN IN PROSE
// -----------------------------------------------------------------------------
// ADR-157 clause 6: "THE AGGREGATE IS REFUSED, AND THE REFUSAL IS ON EVIDENCE
// RATHER THAN ON SCOPE", and section 7 item 1: "THE AGGREGATE AND THE JOIN ARE
// BOTH STILL UNAVAILABLE ... A slice that needs either writes an entry."
//
// `WalletReconciliationResponse` needs both, and needs them over a population
// that is not one identity:
//
//   `ledger_position_cents`      a JOIN. `ledger_transactions` carries no
//                                identity column and reaches one only through
//                                `ledger_entries` and `ledger_accounts`, which
//                                `scope.ts` states in `walletEntries`' own rule.
//   `float.total_cents`          an AGGREGATE over EVERY identity's wallet.
//   `identities_checked`         a COUNT over the same population.
//   `recomputed_balance_cents`   a per-identity aggregate, and the one figure
//                                here that `wallet.ts` shows is reachable by
//                                folding rows in the handler -- for ONE identity.
//
// THE PER-IDENTITY FOLD DOES NOT GENERALISE AND THAT IS THE WHOLE POINT.
// `wallet.ts` reads one identity's whole statement through `tx.rows` and folds
// it, which ADR-157 section 5 sanctions: "a detector can pull its window through
// `rowsWhere` and do the join in the runner", with its cost named. Pulling EVERY
// identity's whole `wallet_entries` history across the process boundary once per
// operator page load is that cost with no window on it at all, and it still
// leaves `ledger_position_cents` unreachable, because the join is refused
// separately and for a different reason.
//
// ADR-157 SECTION 5 ALSO STATES THE ARGUMENT THE NEXT ENTRY HAS TO MAKE, and it
// is written down here so the next author starts from it rather than at the
// file: "a joined read has two tables and the tenancy narrowing has to hold on
// BOTH of them, or the accessor is a BOLA hole with an extra table in it."
// **THIS IS A FINDING AND A STOP. NO `SqlExecutorReason` MEMBER IS ADDED, NO
// `SystemReason` MEMBER IS ADDED, `pg` IS NOT IMPORTED, AND NOTHING IS CAST PAST
// A KEY TYPE.**
//
// WHAT IS BUILT ANYWAY IS THE PART A LATER ADAPTER WOULD OTHERWISE GET WRONG:
// `assertReconciliation` re-derives both divergences from their own operands and
// refuses a response whose `divergent` array carries a row that does not diverge.
// The contract says `divergent` holds "only the rows where either divergence is
// non-zero", and an adapter that returned every identity would turn an alarm
// into a dump with nothing reporting it.
//
// -----------------------------------------------------------------------------
// THE ORDER INSIDE EVERY TRANSACTION, WHICH IS THE CONTROL
// -----------------------------------------------------------------------------
//   1. `lockAt('identities', { id })`     ADR-157's ROW lock, FOR UPDATE
//   2. re-read the PRECONDITION under the lock, else `conflict`
//   3. INSERT the `admin_actions` row      <-- refused if there is no reason
//   4. the append
//
// STEP 1 IS `INV-M20-01`'s PER-IDENTITY LOCK AT THE AUTHORITY THIS MODULE HOLDS.
// That invariant says "advisory lock" and ADR-157 clause 4 rules that the lock is
// a ROW lock instead, "because an advisory lock has no way to be sent that is not
// `sqlExecutor`". `lockScope()` is the scoped handle's version and takes no
// argument; an operator console has no scope, so the same lock at this authority
// is `lockAt` on the `identities` row, which is the registry's only `root` and
// whose rule names `id`. AN ADVISORY LOCK IS REFUSED BY NAME in ADR-157 clause 4
// and in P5 rule 10, and none is reachable from this port.
//
// STEP 2 IS A RE-READ AND NOT THE READ THAT DECIDED TO CALL. Two operators
// setting one identity's limit at one `effective_from` is the case it exists for:
// the second blocks at step 1, then reads a row that now exists, and gets
// `conflict` rather than a primary-key error at step 4. The database refuses it
// too -- `PRIMARY KEY (identity_id, effective_from)` -- and both refusals are
// kept, because a control that depends on the application remembering to check
// is a control with a way around it, and one that depends only on the database
// answers `23505` where the contract wants `conflict`.
//
// STEP 3 IS BEFORE STEP 4 ON `admin-writes.ts`'s RULE AND `0017:82`'s: `reason
// text NOT NULL` is the control, and it is only a PRECONDITION of the mutation if
// the mutation cannot happen without it. Nothing here supplies a reason and
// nothing here substitutes a neighbouring field for one.
//
// -----------------------------------------------------------------------------
// `INV-M5-23`'s SHAPE: AN AUTHORIZATION REFUSAL IS NEVER A GATE RESULT
// -----------------------------------------------------------------------------
// The 401 and the 403 are decided BEFORE `operator()` opens a transaction, so a
// caller who may not correct a wallet writes NO `admin_actions` row, takes NO
// lock and appends nothing. M05's `INV-M5-23` states it for the impersonation
// refusal on the trader's own endpoint -- "the two refusals are the same status
// code and different records, and the record is the part that survives into an
// evidence pack" -- and the same distinction is what a `readonly` operator's 403
// must leave behind here, which is nothing. It is a property of the ORDER in
// `adminWalletHandler` rather than of this paragraph, and the suite asserts it by
// requiring the recorder to be EMPTY rather than by reading a status code.
//
// AND THE BUSINESS REFUSALS ARE INSIDE THE TRANSACTION, WHICH IS THE OTHER HALF
// OF THE SAME DISTINCTION RATHER THAN AN INCONSISTENCY. A malformed body, a
// `corrects_entry_id` that names nobody, an unsatisfied dual control and a
// shortfall are all decided after the lock, exactly as every body validation in
// `admin-payouts.ts` is, and each throws out of `operator()` so the transaction
// rolls back. They therefore leave a lock that was taken and released and NOTHING
// ELSE, which is a different record from the authorization refusals' nothing at
// all. `INV-M5-23` is about the authorization pair and the suite asserts the
// empty recorder on those alone: asserting it on a `precondition_failed` would be
// asserting a different property under that invariant's name.
//
// -----------------------------------------------------------------------------
// WHAT THIS MODULE DOES NOT WRITE, EACH REPORTED RATHER THAN INVENTED
// -----------------------------------------------------------------------------
// `set_by` IS THE SESSION'S AND IS NEVER READ OFF THE WIRE. API_CONTRACT's
// `SpendLimitResponse` says so in the field's own comment -- "the admin actor,
// from the session. NEVER from the body" -- and a body carrying `set_by` is
// IGNORED rather than refused, because refusing it would make the field's
// presence meaningful and the contract's rule is that it means nothing. The
// suite sends one and asserts the written value is the principal's.
//
// `insufficient_funds` IS NOT IN API_CONTRACT SECTION 2's CANONICAL CODE TABLE,
// AND THAT TABLE CALLS ITSELF CLOSED. It is named in the error list of this
// section's `correct` row and of section 6.2's `POST /wallet/withdrawals`, and
// defined nowhere. **The status is therefore undetermined by the contract and
// this module assumes 422**, on the only evidence available: every other
// business-rule refusal in that table is 422 (`payout_not_eligible`,
// `payouts_frozen`, `kyc_required`, `geo_restricted`, `account_cap_reached`,
// `identity_restricted`), and 409 is reserved there for a STATE conflict, which
// a shortfall is not. The assumption is stated in the pull request as a finding
// and `INSUFFICIENT_FUNDS_STATUS` is one constant so that a ruling moves it in
// one place.
//
// NO EVENT IS EMITTED. Nothing in `apps/api/src` writes an event, and inventing a
// sink in a route would be this file deciding where the event catalogue lives.
// `EVENTS.md` does carry `wallet.credited` with a payload that matches a
// correction field for field, which makes the absence a wiring gap rather than a
// design one; `payouts.ts` and `admin-payouts.ts` report the same gap for the
// same reason.
//
// NO IDEMPOTENCY KEY IS READ OFF THE WIRE. API_CONTRACT section 1's required list
// names `POST /checkout`, `POST /accounts/:id/payout`, `POST /accounts/:id/reset`
// and, since ADR-158 clause 4, `POST /wallet/withdrawals`. None of these three
// rows is on it. The concurrency control that matters here is the ROW LOCK plus
// the precondition re-read.
//
// -----------------------------------------------------------------------------
// THE SURFACE IS THE PATH'S DECISION AND THIS FILE MAKES NO CHECK ABOUT IT
// -----------------------------------------------------------------------------
// `/admin` is one of `surface.ts`'s `OPERATOR_PREFIXES`, so `compose` never
// registers this module on the public deployment and the public 404 is the
// router's, produced by there being nothing there (ADR-083 section 4). All three
// paths appear in `CompositionReport.withheld` on `public` and in `registered` on
// `operator`, and `withheld`'s own comment is the reason that matters: "THE
// PUBLIC DEPLOYMENT'S 404 IS THIS LIST BEING NON-EMPTY AND NOTHING ELSE."
//
// THE ROUTE REGISTRY NEEDED NO EDIT. `discoverRouteModules` reads `src/routes/`
// and imports every `.ts` file in sorted order, so this file registers itself.
//
// ADMIN_ORIGIN IS A PLACEHOLDER AND IS NOT WRITTEN DOWN ANYWHERE. ADR-012: the
// admin console's real apex domain never enters the corpus, the repository, or
// any public artifact. There is no hostname in this file, no origin check against
// a literal, and no comment naming one.
//
// MONEY IS INTEGER CENTS. Every `*_cents` column these three rows touch is
// `bigint`, so the arithmetic here is `bigint` and the single conversion to the
// wire is `wallet.ts`'s `centsToJson`, which REFUSES rather than rounds. It is
// IMPORTED rather than re-declared because this module reads the same table
// `wallet.ts` reads, and `toWalletEntryRow` with it: a second transcription of
// `0011`'s row is the hazard named above, one table over. There is no float in
// this file or in its suite.
// =============================================================================

import type { FastifyReply, FastifyRequest } from 'fastify';

import { defineRoutes } from '../registry.ts';
import type { HttpMethod, RouteDefinition, RouteHandler } from '../registry.ts';
import { PROBLEM_MEDIA_TYPE, PROBLEM_TYPE_PREFIX } from '../server.ts';
import type { Problem } from '../server.ts';
import { ACCOUNT_ACTION_ROLES, ADMIN_ROLES } from './admin-writes.ts';
import type { AdminInitiative, AdminPrincipal, AdminRole } from './admin-writes.ts';
import { WALLET_DIRECTIONS, balanceOf, centsToJson, toWalletEntryRow } from './wallet.ts';
import type { WalletDirection, WalletEntryRow } from './wallet.ts';

// -----------------------------------------------------------------------------
// The three contract paths
// -----------------------------------------------------------------------------

/** API_CONTRACT section 8. `INV-M20-10`'s assertion and `INV-M20-08`'s float position. */
export const WALLET_RECONCILIATION_PATH = '/admin/wallet/reconciliation';

/** API_CONTRACT section 8. `SD-M20-01`, a compensating entry and never an update. */
export const WALLET_CORRECT_PATH = '/admin/wallet/:identityId/correct';

/** API_CONTRACT section 8. `SD-M20-02`, `INV-M20-07`, SECURITY `C-23`. */
export const WALLET_SPEND_LIMIT_PATH = '/admin/wallet/:identityId/spend-limit';

/**
 * The status this module answers `insufficient_funds` with.
 *
 * ONE CONSTANT BECAUSE THE CONTRACT DOES NOT CARRY THE FACT. Section 2's code
 * table calls itself closed and does not list this code; section 8's `correct`
 * row and section 6.2's `POST /wallet/withdrawals` row both name it. 422 is
 * assumed on the evidence in this file's header, and a ruling moves it here.
 */
export const INSUFFICIENT_FUNDS_STATUS = 422;

/** The only `wallet_entries.provenance` value this endpoint may write. */
export const CORRECTION_PROVENANCE = 'correction';

/**
 * The dual-control threshold, `500000` INTEGER CENTS. ADR-228.
 *
 * THE ANSWER IS RECORDED WITH ITS QUESTION, because a threshold whose reasoning
 * is lost is a threshold the next session moves. Put to the founder on
 * 2026-08-29:
 *
 *   > "above what payout amount should a second human have to approve it"
 *
 * and the `$5,000` option they chose was described to them as catching the
 * unusual payouts
 *
 *   > "without adding friction to normal trader withdrawals, which typically
 *   >  run $500-$3,000"
 *
 * ANSWER: `$5,000`, which is `500000` integer cents. A `bigint`, compared
 * against a `bigint`, so no float touches it.
 *
 * **THE REASONING OFFERED WITH THE QUESTION IS NOT THE REASONING THIS NUMBER
 * CARRIES, AND THIS COMMENT SAYS SO RATHER THAN LETTING THE NEXT READER ASSUME
 * IT DOES.** `account_adjustments` is the ADMIN adjustment table. No trader
 * withdrawal writes a row of it and none can, so the friction this threshold
 * does not add to normal trader withdrawals is friction it could not have added
 * at ANY value, `1` cent included. What the number actually sets is ADR-067
 * section 5's quantity: *"the size of the loss one compromised owner session can
 * cause without a second key"*. `OQ-F6-01` recommended `10000` cents and argued
 * the number should *"be set low and read as that number"*. **This is 50x that
 * recommendation and it is the founder's answer**; the disagreement is ADR-228
 * section 4's, surfaced for the `E2` read rather than settled by a session.
 *
 * IT IS A CONSTANT AND NOT A CONFIGURATION READ, on `MINIMUM_WITHDRAWAL_CENTS`'s
 * precedent one route over (`wallet-withdrawals.ts`), for two measured reasons
 * rather than for convenience: no configuration table exists among the 115
 * tables this estate declares, and no config reader exists in this deployable.
 * `0038:279` makes the COLUMN the threshold *"IN FORCE when the row was
 * written"*, which is a RECORD of this value and not a second source of it.
 *
 * **IT IS NEVER A WIRE FIELD.** {@link WalletCorrectionBody} carries no
 * threshold and must never gain one: a caller who names the threshold is a
 * caller who can name one no adjustment reaches, which satisfies
 * `account_adjustments_dual_control_above_threshold` with no approval row at
 * all. The refusal is `0068`'s `account_adjustments_dual_control_threshold_ceiling`
 * (`<= 500000`) and not this sentence, because a comment is not a control.
 */
export const DUAL_CONTROL_THRESHOLD_CENTS = 500_000n;

// -----------------------------------------------------------------------------
// The wire shapes, transcribed from API_CONTRACT section 8
// -----------------------------------------------------------------------------

/**
 * `WalletCorrectionRequest`.
 *
 * EVERY MEMBER IS REQUIRED EXCEPT `corrects_entry_id`, which ADR-173 clause 4
 * made optional. See that field.
 */
export interface WalletCorrectionBody {
  readonly direction: WalletDirection;
  /** Integer cents, > 0. The MAGNITUDE; `direction` carries the sign (`0011:55`). */
  readonly amount_cents: number;
  /** The business event, human readable. `wallet_entries.cause` is `NOT NULL`. */
  readonly cause: string;
  /**
   * The entry being compensated, WHEN THERE IS ONE. OPTIONAL, per ADR-173.
   *
   * A DECIMAL STRING, because `entry_id` is one: `wallet_entries.id` is `bigint
   * GENERATED ALWAYS AS IDENTITY` and ADR-158 clause 3 refuses a JSON `number`
   * for it.
   *
   * IT DOES NOT BECOME `reference_id`. ADJ-C3 binds `wallet_entries.reference_id`
   * to the ADJUSTMENT's id and nothing else, and the type settles it a second
   * time: a `bigint` rendered as digits is not a `uuid`. See this file's header,
   * item 1.
   *
   * OPTIONAL BECAUSE TWO OF THE THREE REASONS THE DATABASE ADMITS CORRECT NO
   * ENTRY. `0038`'s `reason_code` vocabulary is `goodwill`,
   * `reconciliation_error` and `promotional_credit`; only the middle one is
   * about an entry, and a `goodwill` credit repairs nothing and still lands as
   * `provenance = 'correction'` because `0011`'s closed list offers no other
   * value for an adjustment. A REQUIRED field would make a case `0038` built
   * its nullable `account_id` for unreachable through the only endpoint that
   * reaches it. ADR-173 clause 4, ruled against a running database.
   */
  readonly corrects_entry_id?: string;
  readonly reason: string;
  /** Dual control. See this file's header, item 3. */
  readonly second_approver: string;
}

/** `WalletCorrectionResponse`. */
export interface WalletCorrectionResponse {
  /** Decimal string, as on `GET /wallet/entries`. */
  readonly entry_id: string;
  readonly provenance: typeof CORRECTION_PROVENANCE;
  readonly direction: WalletDirection;
  readonly amount_cents: number;
  readonly balance_after_cents: number;
  readonly ledger_transaction_id: string;
  readonly occurred_at: string;
}

/** `SpendLimitRequest`. */
export interface SpendLimitBody {
  readonly daily_cents: number;
  readonly rolling_7d_cents: number;
  /** `NOT NULL` with NO DEFAULT in the row: the caller states it. */
  readonly effective_from: string;
  readonly reason: string;
}

/** `SpendLimitResponse`. */
export interface SpendLimitResponse {
  readonly identity_id: string;
  readonly daily_cents: number;
  readonly rolling_7d_cents: number;
  readonly effective_from: string;
  /** The admin actor, from the session. NEVER from the body. */
  readonly set_by: string;
  readonly created_at: string;
}

/** One row of `WalletReconciliationResponse.divergent`. */
export interface WalletReconciliationRow {
  readonly identity_id: string;
  readonly entries_position_cents: number;
  readonly ledger_position_cents: number;
  /** `entries_position_cents` minus `ledger_position_cents`. `0` on a healthy identity. */
  readonly divergence_cents: number;
  readonly stored_balance_cents: number;
  readonly recomputed_balance_cents: number;
  /** `stored_balance_cents` minus `recomputed_balance_cents`. `0` on an untampered statement. */
  readonly balance_divergence_cents: number;
}

/** `WalletReconciliationResponse`. */
export interface WalletReconciliationResponse {
  readonly as_of: string;
  readonly identities_checked: number;
  /**
   * FLOAT ENTERS THE DENOMINATOR AS EXPOSURE AND NEVER THE NUMERATOR AS RESERVE.
   *
   * `P-M6-07` is the resolution and `AS-M20-08` is the misreading it settles:
   * "the ratio flatters itself with the same money on both sides". It is its own
   * object here so that no client can add it into a reserve figure without
   * writing the addition down.
   */
  readonly float: { readonly total_cents: number; readonly identities_with_balance: number };
  /** ONLY the rows where either divergence is non-zero. Asserted, not assumed. */
  readonly divergent: readonly WalletReconciliationRow[];
}

// -----------------------------------------------------------------------------
// The port onto the database
// -----------------------------------------------------------------------------

/**
 * The tables these three rows name, and no others.
 *
 * A NARROW UNION RATHER THAN `string`, on `admin-payouts.ts`'s reason: a typo is
 * a compile error at the call site here, and `test/admin-wallet.test.ts` asserts
 * that every member is a real `TableKey` of `packages/db`. That assertion is the
 * half this file cannot make itself, because `@merit/db` is reachable from
 * `src/db.ts` and from the suite and this module holds no import of it.
 *
 * `accountAdjustments` IS ABSENT DELIBERATELY. It is the table a correction has
 * to write (this file's header) and this module cannot compose the row, so
 * naming its key here would declare a reach this fence does not have and would
 * read, to a later author, as a write that exists.
 *
 * `ledgerTransactions`, `ledgerEntries` and `ledgerAccounts` are absent for the
 * stronger version of the same reason: the correction's posting does not go
 * through this handle and there is no `LT-nn` for it to go through at all.
 */
export const ADMIN_WALLET_TABLES = [
  'identities',
  'walletEntries',
  'walletSpendLimits',
  'adminActions',
] as const;

/** One of {@link ADMIN_WALLET_TABLES}. */
export type AdminWalletTable = (typeof ADMIN_WALLET_TABLES)[number];

/** An address, a filter or a set of values, by Drizzle property name. ADR-112's shape. */
export type AdminWalletValues = Readonly<Record<string, unknown>>;

/**
 * One open transaction, as these three rows need to see it.
 *
 * `update` AND `delete` ARE ABSENT BECAUSE THEY ARE ABSENT FROM EVERY TRANSACTION
 * HANDLE IN THIS WORKSPACE (ADR-112). `updateAt` and `deleteAt` are absent too,
 * and here that is not inheritance but a property of the two writes: BOTH ARE
 * APPENDS. `wallet_entries` is append-only by GRANT (`0026` executes `REVOKE
 * UPDATE, DELETE ON ... wallet_entries ... FROM merit_app, PUBLIC`), and a spend
 * limit supersedes by a new effective-dated row rather than by an update. A
 * handle carrying a verb neither endpoint may use is a verb a later edit reaches
 * for.
 *
 * THERE IS NO `ledger` MEMBER. See this file's header: `admin-payouts.ts` holds
 * one because `LT-01`'s legs are specified and importable, and no `LT-nn` exists
 * for a wallet correction.
 */
export interface AdminWalletTx {
  /**
   * ONE row, LOCKED until this transaction ends. ADR-157.
   *
   * `rowAt` plus `FOR UPDATE` on the same predicate. It is the whole concurrency
   * control for both writes: see this file's header.
   */
  lockAt(key: AdminWalletTable, at: AdminWalletValues): Promise<unknown>;
  /** ONE row, or `undefined`. The address must name a unique key. */
  rowAt(key: AdminWalletTable, at: AdminWalletValues): Promise<unknown>;
  /** MANY rows, narrowed by equality. Bounded per identity at every call site here. */
  rowsWhere(key: AdminWalletTable, where: AdminWalletValues): Promise<unknown[]>;
  insert(key: AdminWalletTable, values: AdminWalletValues): Promise<unknown[]>;
}

/**
 * Everything the correction needs written, as API_CONTRACT gives it.
 *
 * THIS IS THE FINDING MADE CONCRETE RATHER THAN A TASK LIST. Every field here
 * comes off the contract's body or off the locked read; `account_adjustments`
 * additionally requires `reason_code`, `dual_control_threshold_cents` and, for
 * a debit, `reverses_adjustment_id`.
 *
 * THIS READ "NONE OF THOSE THREE HAS A SOURCE IN THIS DRAFT OR ANYWHERE ELSE IN
 * THIS TREE" AND IT IS NOW TWO OF THE THREE. `dual_control_threshold_cents` has
 * a source: {@link DUAL_CONTROL_THRESHOLD_CENTS}, the founder's answer of
 * 2026-08-29, bounded above in DDL by `0068`. **It is deliberately NOT A FIELD
 * ON THIS DRAFT and never becomes one** (ADR-228 ruling 2): a threshold the
 * caller supplies is a threshold the caller can raise beyond any adjustment's
 * reach, which satisfies `account_adjustments_dual_control_above_threshold`
 * with no approval row at all. The writer reads the constant. A wiring slice
 * still cannot satisfy the schema from this draft, on `reason_code` and
 * `reverses_adjustment_id`, and that is the point of declaring it.
 *
 * `destination` USED TO BE A FOURTH AND IS NOT ONE. It is `'trader_wallet'`
 * for every row this endpoint can write:
 * `account_adjustments_reason_picks_destination` is a biconditional, so the
 * promotional class is reachable only under `promotional_credit`, and that
 * reason never touches a wallet. The endpoint's destination is therefore
 * derived rather than chosen, and naming it here would declare a choice the
 * schema does not offer.
 *
 * AND `correctsEntryId` IS NOT ONE EITHER, WHICH IS ADR-173'S WHOLE POINT. It
 * is `undefined` when the operator named no entry, and no column consumes it in
 * either case: see {@link AdminWalletBackend.writeCorrection}.
 */
export interface WalletCorrectionDraft {
  readonly identityId: string;
  readonly direction: WalletDirection;
  readonly amountCents: bigint;
  readonly cause: string;
  /**
   * `wallet_entries.id` of the entry being compensated, read under the lock, or
   * `undefined` when the operator named none.
   *
   * IT IS NOT AN ADDRESS THE APPEND WRITES ANYWHERE. `reference_id` is the
   * adjustment's own id (ADJ-C3) and no other column in the schema holds a
   * corrected entry, so this field reaches the port as the operator's CLAIM,
   * already validated against this identity's own statement, and the durable
   * record of it is the `admin_actions` row written above the append.
   */
  readonly correctsEntryId: bigint | undefined;
  /** Absent when the caller omitted it, so `admin_actions.reason` makes the refusal. */
  readonly reason: string | undefined;
  readonly secondApprover: string;
  /** The operator, from the session. */
  readonly actor: string;
  /** The balance the lock froze, which is what `balance_after_cents` is computed from. */
  readonly balanceBeforeCents: bigint;
}

/** What a written correction is, read back off the rows the port wrote. */
export interface WalletCorrectionRecord {
  readonly entryId: bigint;
  readonly ledgerTransactionId: string;
  readonly balanceAfterCents: bigint;
  /** RFC 3339 UTC. */
  readonly occurredAt: string;
}

/** Everything this module cannot do for itself. */
export interface AdminWalletBackend {
  /**
   * Run one unit of work at `systemDb('operator-console')`.
   *
   * It takes the whole unit rather than handing back a handle, which is `ApiDb`'s
   * shape and for `ApiDb`'s reason: a transaction cannot outlive the function
   * that opened it and no caller has a `commit` to forget. `ApiDb` itself
   * declares `scoped` and `firm` and no operator door, and `src/db.ts` is outside
   * this fence, so this port is declared here exactly as `admin-payouts.ts`
   * declares its own.
   */
  operator<T>(fn: (tx: AdminWalletTx) => Promise<T>): Promise<T>;
  /**
   * The operator behind this request, or `null` when there is none.
   *
   * NOT IMPLEMENTED HERE. Hardware-key SSO under `C-08` and the IP allowlist are
   * edge concerns; what this module needs is the resolved pair, and its type is
   * `admin-writes.ts`'s so that three admin modules cannot answer "who is the
   * operator" three ways.
   */
  principal(request: FastifyRequest): Promise<AdminPrincipal | null>;
  /** The clock. Injected so the suite can pin an instant. */
  now(): Date;
  /**
   * Write the correction: the adjustment, its posting and its wallet entry.
   *
   * REFUSED BY EVERY DEPLOYMENT TODAY, on the three constraints that still stand
   * in this file's header. It takes the open transaction so that when it can be
   * written it commits with the `admin_actions` row that explains it (ADR-006).
   *
   * ONE THING ABOUT THAT WRITE IS NOW SETTLED AND IS STATED HERE SO THE WIRING
   * SLICE INHERITS THE RULING RATHER THAN THE CONTRACT'S ERROR:
   * `wallet_entries.reference_id` IS `account_adjustments.id` AND NOTHING ELSE.
   * It is never the corrected entry's id, never the ledger transaction's and
   * never the identity's. ADJ-C3 counts the rows matching the adjustment's own
   * id and raises by name at `COMMIT` when the count is not one, and ADR-173
   * watched it raise. `test/admin-wallet.test.ts` asserts the binding at both
   * migrations so that an adapter written six weeks from now cannot quietly
   * choose a different referent.
   */
  writeCorrection(tx: AdminWalletTx, draft: WalletCorrectionDraft): Promise<WalletCorrectionRecord>;
  /**
   * The reconciliation read.
   *
   * REFUSED BY EVERY DEPLOYMENT TODAY, on ADR-157 clause 6 and section 7 item 1.
   * It takes no transaction because it is a read with no side effect and section
   * 8 gives it to `readonly` as well.
   */
  reconcile(asOf: Date): Promise<WalletReconciliationResponse>;
}

/** Raised by a backend that is not installed. Answered as 503, never 500. */
export class AdminWalletUnwired extends Error {
  constructor(what: string) {
    super(
      `AdminWalletBackend.${what} cannot be served by this deployment: no backend is installed. ` +
        '`useAdminWalletBackend` was never called, so this process holds the unwired default ' +
        'and refuses rather than returning a plausible value.',
    );
    this.name = 'AdminWalletUnwired';
  }
}

/**
 * The default, which serves nothing.
 *
 * A BACKEND THAT RETURNED PLAUSIBLE VALUES WOULD BE A FIXTURE TELLING AN OPERATOR
 * HOW MUCH MONEY A TRADER HAS, and on `reconcile` it would be a fixture reporting
 * that the ledger and the wallet agree. `wallet.ts` and `admin-payouts.ts` both
 * state the sentence about their own defaults and it is worth more here than in
 * either.
 */
export const UNWIRED_ADMIN_WALLET_BACKEND: AdminWalletBackend = {
  operator: () => Promise.reject(new AdminWalletUnwired('operator')),
  principal: () => Promise.reject(new AdminWalletUnwired('principal')),
  now: () => {
    throw new AdminWalletUnwired('now');
  },
  writeCorrection: () => Promise.reject(new AdminWalletUnwired('writeCorrection')),
  reconcile: () => Promise.reject(new AdminWalletUnwired('reconcile')),
};

let backend: AdminWalletBackend = UNWIRED_ADMIN_WALLET_BACKEND;

/** Install the backend. The wiring slice calls this; so does the suite. */
export function useAdminWalletBackend(next: AdminWalletBackend): void {
  backend = next;
}

/** Restore the unwired default. The suite calls this between cases. */
export function resetAdminWalletBackend(): void {
  backend = UNWIRED_ADMIN_WALLET_BACKEND;
}

/** The installed backend. */
export function currentAdminWalletBackend(): AdminWalletBackend {
  return backend;
}

// -----------------------------------------------------------------------------
// Problem documents. Section 2's codes, this module's own senders.
// -----------------------------------------------------------------------------

/** One field's complaint. `admin-writes.ts`'s shape. */
export interface FieldError {
  readonly path: string;
  readonly message: string;
}

/** Section 2's shape widened by `detail` and `errors[]` only. */
interface ProblemDocument extends Problem {
  readonly detail?: string;
  readonly errors?: readonly FieldError[];
}

function sendProblem(reply: FastifyReply, body: ProblemDocument): FastifyReply {
  return reply.code(body.status).type(PROBLEM_MEDIA_TYPE).send(body);
}

/**
 * A section 2 code, built here rather than in `server.ts`.
 *
 * `server.ts`'s `TITLE` table is closed over the codes the TRANSPORT can produce.
 * `service_unavailable` and `insufficient_funds` are handler codes and are built
 * here, which is `checkout.ts`'s arrangement and its reason: this module does not
 * reach across a fence to borrow a sender.
 */
function handlerProblem(
  code: string,
  title: string,
  status: number,
  instance: string,
): ProblemDocument {
  return { type: `${PROBLEM_TYPE_PREFIX}${code}`, title, status, code, instance };
}

/** What a {@link Refusal} carries. */
interface RefusalDocument {
  readonly code: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly errors?: readonly FieldError[];
}

/**
 * A refusal decided inside a transaction and thrown out of it, so the write rolls
 * back.
 *
 * THE FIELD IS ASSIGNED IN THE BODY AND IS NOT A CONSTRUCTOR PARAMETER PROPERTY.
 * `apps/api` runs under `node --experimental-strip-types`, which ERASES types
 * rather than compiling them, and a parameter property is the one TypeScript
 * construct that needs code emitted for it. It type-checks, Vitest transpiles it,
 * the suite goes green, and the process does not start -- because
 * `discoverRouteModules` imports every file in `routes/`, so one unsupported
 * construct here takes the whole deployable down. `admin-writes.ts` found that by
 * running under the real runtime and the note is carried rather than rediscovered.
 */
class Refusal extends Error {
  readonly document: RefusalDocument;

  constructor(document: RefusalDocument) {
    super(`${document.code}: ${document.detail ?? document.title}`);
    this.name = 'Refusal';
    this.document = document;
  }
}

function refuse(
  code: string,
  title: string,
  status: number,
  detail?: string,
  errors?: readonly FieldError[],
): Refusal {
  return new Refusal({
    code,
    title,
    status,
    ...(detail === undefined ? {} : { detail }),
    ...(errors === undefined ? {} : { errors }),
  });
}

const notFound = (): Refusal => refuse('not_found', 'Not found', 404, 'No identity with that id.');

const invalid = (errors: readonly FieldError[]): Refusal =>
  refuse('validation_failed', 'Validation failed', 400, undefined, errors);

// -----------------------------------------------------------------------------
// Turning the database's refusal into the contract's shape
// -----------------------------------------------------------------------------

/** The fields `pg` puts on a `DatabaseError`, read off an `unknown`. */
interface PgFailure {
  readonly code: string;
  readonly table?: string;
  readonly column?: string;
  readonly constraint?: string;
  readonly message: string;
}

/**
 * THE CAUSE CHAIN IS WALKED AND THAT IS NOT DEFENSIVE PROGRAMMING.
 *
 * Drizzle wraps every failed statement in a `DrizzleQueryError` whose own `code`
 * is `undefined` and whose `cause` is the `pg` error carrying the SQLSTATE. A
 * reader that looked only at the thrown object would find no SQLSTATE, fall
 * through to the rethrow, and answer 500 for every refusal this module exists to
 * report. `admin-writes.ts` found that against a real database; the finding is
 * carried here rather than rediscovered, and the chain is walked rather than the
 * first `cause` taken because nothing promises the wrapping stays one deep.
 */
function pgFailure(err: unknown): PgFailure | null {
  let seen: unknown = err;
  for (let depth = 0; depth < 8 && typeof seen === 'object' && seen !== null; depth += 1) {
    const row = seen as Record<string, unknown>;
    if (typeof row['code'] === 'string')
      return {
        code: row['code'],
        ...(typeof row['table'] === 'string' ? { table: row['table'] } : {}),
        ...(typeof row['column'] === 'string' ? { column: row['column'] } : {}),
        ...(typeof row['constraint'] === 'string' ? { constraint: row['constraint'] } : {}),
        message: typeof row['message'] === 'string' ? row['message'] : String(seen),
      };
    seen = row['cause'];
  }
  return null;
}

/**
 * The one CHECK whose refusal is not `validation_failed` but a contract code of
 * its own.
 *
 * `wallet_entries.balance_after_cents` is `CHECK (balance_after_cents >= 0)`, and
 * API_CONTRACT's `correct` paragraph says what a violation of it MEANS: "an
 * operator correcting an old over-credit that has since been spent gets
 * `insufficient_funds`, and the remedy is a debt rather than a negative wallet."
 * The handler refuses that case before the write, from the balance the lock
 * froze; this is the second line, for the case where a concurrent writer got
 * there anyway.
 */
const BALANCE_FLOOR_CONSTRAINT = 'wallet_entries_balance_after_cents_check';

/**
 * A Postgres integrity failure, answered in the contract's shape.
 *
 * THIS IS REPORTING A REFUSAL AND IT IS NOT MAKING ONE. The statement ran, the
 * database refused it, the transaction rolled back, and this turns `23502 on
 * admin_actions.reason` into `validation_failed` with the column named.
 * Pre-empting that refusal with a validator is the one thing `0017:82` rules out,
 * so the mapping runs AFTER the write rather than instead of it.
 *
 * `23505` ON `wallet_spend_limits` IS THE CONTRACT'S `conflict` and arrives here
 * when two operators pass the re-read at step 2 and collide at step 4. The
 * primary key is `(identity_id, effective_from)`.
 *
 * The constraint name is disclosed on purpose: it is a schema fact rather than
 * another user's data, the audience is an operator on the admin origin, and an
 * operator who cannot see WHICH constraint refused cannot fix the request.
 */
function fromDatabase(failure: PgFailure, instance: string): ProblemDocument {
  const where =
    failure.table === undefined
      ? 'the database'
      : `\`${failure.table}${failure.column === undefined ? '' : `.${failure.column}`}\``;

  if (failure.constraint === BALANCE_FLOOR_CONSTRAINT)
    return {
      ...handlerProblem(
        'insufficient_funds',
        'Insufficient funds',
        INSUFFICIENT_FUNDS_STATUS,
        instance,
      ),
      detail:
        'This correction would take the running balance below zero, and the database refused ' +
        'it. The remedy is a debt rather than a negative wallet.',
    };

  switch (failure.code) {
    case '23502':
      return {
        ...handlerProblem('validation_failed', 'Validation failed', 400, instance),
        detail: `${where} is NOT NULL and the write supplied no value. The refusal is the database's.`,
        errors: [
          { path: failure.column ?? '', message: 'is required by the schema and was not supplied' },
        ],
      };
    case '23503':
    case '23514':
      return {
        ...handlerProblem('validation_failed', 'Validation failed', 400, instance),
        detail: `${where} refused this write: ${failure.constraint ?? failure.code}.`,
        errors: [{ path: '', message: failure.constraint ?? failure.message }],
      };
    case '23505':
      return {
        ...handlerProblem('conflict', 'Conflict', 409, instance),
        detail: `${where} already holds a row with that key: ${failure.constraint ?? failure.code}.`,
      };
    default:
      return {
        ...handlerProblem('conflict', 'Conflict', 409, instance),
        detail: failure.message,
      };
  }
}

/** The SQLSTATE classes above, plus the class triggers raise. */
const HANDLED_SQLSTATE = new Set(['23502', '23503', '23505', '23514', 'P0001']);

// -----------------------------------------------------------------------------
// Reading a request body
// -----------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The shape of a UUID, which is what `identities.id` is. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A decimal string with no leading zero, which is what `entry_id` is on the wire. */
const DECIMAL = /^(0|[1-9][0-9]*)$/;

/**
 * A required non-empty string off the body.
 *
 * ABSENCE IS CARRIED FOR `reason` AND EMPTINESS IS NOT. `admin_actions.reason` is
 * `NOT NULL`, which refuses an omitted reason and ADMITS an empty one, and
 * API_CONTRACT section 8 requires a non-empty reason on every mutating admin
 * endpoint. So the database is left to make the refusal it can make and this
 * makes only the one it cannot -- which is `admin-writes.ts`'s split, applied to
 * a narrower body.
 */
function textField(
  row: Record<string, unknown>,
  key: string,
  errors: FieldError[],
  required: boolean,
): string | undefined {
  const value = row[key];
  if (value === undefined || value === null) {
    if (required) errors.push({ path: key, message: 'is required' });
    return undefined;
  }
  if (typeof value !== 'string') {
    errors.push({ path: key, message: 'must be a string' });
    return undefined;
  }
  if (value.trim() === '') {
    errors.push({
      path: key,
      message:
        'must not be empty. API_CONTRACT section 8 requires a non-empty value and a NOT NULL ' +
        'column admits an empty string',
    });
    return undefined;
  }
  return value;
}

/**
 * An integer-cents field off the body.
 *
 * IT REFUSES A NON-INTEGER RATHER THAN ROUNDING ONE, which is API_CONTRACT
 * section 1: "`*_cents` are JSON integers ... No floats, no formatted strings".
 * `Number.isSafeInteger` is the check because the column is `bigint` and a value
 * past 2^53 has already lost digits by the time this sees it (ADR-122).
 */
function centsField(
  row: Record<string, unknown>,
  key: string,
  errors: FieldError[],
  minimum: bigint,
): bigint | undefined {
  const value = row[key];
  if (value === undefined || value === null) {
    errors.push({ path: key, message: 'is required' });
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    errors.push({
      path: key,
      message: 'must be an integer number of cents. API_CONTRACT section 1 admits no float here',
    });
    return undefined;
  }
  const cents = BigInt(value);
  if (cents < minimum) {
    errors.push({ path: key, message: `must be at least ${minimum.toString()} cents` });
    return undefined;
  }
  return cents;
}

/**
 * An instant off the body, as a `Date`.
 *
 * `wallet_spend_limits.effective_from` is `timestamptz NOT NULL` with NO DEFAULT,
 * which the contract states in the field's own comment: "the caller states it".
 * A bound goes through the column's own mapper and is never assembled by hand
 * (ADR-157 section 3), so this hands a `Date` to the accessor rather than a
 * string.
 */
function instantField(
  row: Record<string, unknown>,
  key: string,
  errors: FieldError[],
): Date | undefined {
  const value = row[key];
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push({ path: key, message: 'is required and must be an RFC 3339 timestamp' });
    return undefined;
  }
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) {
    errors.push({ path: key, message: 'is not a timestamp this server can parse' });
    return undefined;
  }
  return at;
}

/** `:identityId` off the path, or `null` for anything that cannot name a row. */
function identityIdOf(request: FastifyRequest): string | null {
  const params = asRecord(request.params);
  if (params === null) return null;
  const value = params['identityId'];
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

// -----------------------------------------------------------------------------
// Money on the wire, swept by NAME rather than by a list of fields
// -----------------------------------------------------------------------------

/** Raised when a response this module is about to send is not integer cents. */
export class AdminWalletMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminWalletMoneyError';
  }
}

/**
 * Walk a response and refuse any member whose NAME ends `_cents` and whose value
 * is not a safe integer.
 *
 * IT READS THE NAME RATHER THAN A LIST OF FIELDS, which is `admin-reads.ts`'s
 * arrangement and what makes it hold for a field nobody has added yet. Every
 * `_cents` field on these three responses comes off a `bigint` through
 * `centsToJson`, which refuses on its own; this is the sweep that catches the
 * `_cents` field a later edit builds some other way.
 */
export function assertWalletScalars(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertWalletScalars(item, `${path}[${index}]`);
    });
    return;
  }
  const row = asRecord(value);
  if (row === null) return;
  for (const [key, member] of Object.entries(row)) {
    const at = path === '' ? key : `${path}.${key}`;
    if (key.endsWith('_cents')) {
      if (typeof member !== 'number' || !Number.isSafeInteger(member))
        throw new AdminWalletMoneyError(
          `${at} is \`${String(member)}\` and API_CONTRACT section 1 says *_cents are JSON ` +
            'integers. No floats, no formatted strings',
        );
      continue;
    }
    assertWalletScalars(member, at);
  }
}

/**
 * The reconciliation response's own arithmetic, re-derived from its operands.
 *
 * THIS IS THE HALF OF THE ENDPOINT THIS FENCE CAN BUILD, and it is the half an
 * adapter written six weeks from now would otherwise get wrong. Three properties,
 * each stated by the contract and none of them checkable by a type:
 *
 *   1. `divergence_cents` IS `entries_position_cents` MINUS `ledger_position_cents`,
 *      and `balance_divergence_cents` is `stored` minus `recomputed`. The contract
 *      names both subtractions in the field comments, and a response carrying a
 *      figure that is not the difference of the two beside it is a response an
 *      operator would reconcile against.
 *   2. EVERY ROW IN `divergent` DIVERGES. "only the rows where either divergence
 *      is non-zero". An adapter returning every identity turns an alarm into a
 *      dump, which is `DEP-M4-09`'s rule one surface over: the dangerous failure
 *      is not the empty panel, it is the confident one.
 *   3. `identities_checked` IS AT LEAST THE NUMBER OF DIVERGENT ROWS. It is the
 *      denominator that makes an empty `divergent` mean *checked and clean*
 *      rather than *nothing ran*, and a denominator below its own numerator says
 *      the two were computed over different populations.
 *
 * THE FLOAT FIGURE IS NOT COMPARED WITH ANYTHING HERE, deliberately. It is
 * exposure and never reserve (`P-M6-07`), so there is no identity relating it to
 * the divergences and inventing one would be `AS-M20-08` written as an assertion.
 */
export function assertReconciliation(response: WalletReconciliationResponse): void {
  assertWalletScalars(response, '');

  if (!Number.isSafeInteger(response.identities_checked) || response.identities_checked < 0)
    throw new AdminWalletMoneyError(
      `identities_checked is \`${String(response.identities_checked)}\` and it is a count`,
    );
  if (
    !Number.isSafeInteger(response.float.identities_with_balance) ||
    response.float.identities_with_balance < 0
  )
    throw new AdminWalletMoneyError(
      `float.identities_with_balance is \`${String(response.float.identities_with_balance)}\` ` +
        'and it is a count',
    );

  response.divergent.forEach((row, index) => {
    const at = `divergent[${index}]`;
    const position = row.entries_position_cents - row.ledger_position_cents;
    if (row.divergence_cents !== position)
      throw new AdminWalletMoneyError(
        `${at}.divergence_cents is ${row.divergence_cents} and entries minus ledger is ` +
          `${position}. The contract defines the field as that subtraction`,
      );
    const balance = row.stored_balance_cents - row.recomputed_balance_cents;
    if (row.balance_divergence_cents !== balance)
      throw new AdminWalletMoneyError(
        `${at}.balance_divergence_cents is ${row.balance_divergence_cents} and stored minus ` +
          `recomputed is ${balance}. The contract defines the field as that subtraction`,
      );
    if (row.divergence_cents === 0 && row.balance_divergence_cents === 0)
      throw new AdminWalletMoneyError(
        `${at} diverges by nothing and \`divergent\` carries "only the rows where either ` +
          'divergence is non-zero". A healthy identity in this array is a dump wearing an ' +
          "alarm's name",
      );
  });

  if (response.identities_checked < response.divergent.length)
    throw new AdminWalletMoneyError(
      `identities_checked is ${response.identities_checked} and ${response.divergent.length} ` +
        'row(s) diverged. The denominator is below its own numerator, so the two were computed ' +
        'over different populations',
    );
}

// -----------------------------------------------------------------------------
// The rows, read off the accessor
// -----------------------------------------------------------------------------

/** Raised when the row the accessor returned is not one this module can read. */
export class AdminWalletRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminWalletRowError';
  }
}

function field(row: unknown, table: string, property: string): unknown {
  const record = asRecord(row);
  if (record === null)
    throw new AdminWalletRowError(
      `${table} returned ${typeof row} where a row was expected. The accessor's contract is one ` +
        'row or `undefined`, so this is a handle that is not the one this port declares.',
    );
  return record[property];
}

function centsOf(row: unknown, table: string, property: string): bigint {
  const value = field(row, table, property);
  if (typeof value !== 'bigint')
    throw new AdminWalletRowError(
      `${table}.${property} came back as ${typeof value} and this module reads it as a ` +
        '`bigint`. The column is `bigint` and the schema pins `mode: bigint`, so anything else ' +
        'has been through a lossy conversion this handler will not repeat.',
    );
  return value;
}

/**
 * A `timestamptz` column, as an ISO string.
 *
 * BOTH SHAPES ARE ACCEPTED because the driver's answer is the driver's: `pg`
 * parses `timestamptz` to a `Date` and a handle that hands back the raw string is
 * still handing back the same instant. Anything else is refused rather than
 * stringified, on `centsOf`'s reason one column class over.
 */
function instantOf(row: unknown, table: string, property: string): string {
  const value = field(row, table, property);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'string') {
    const at = new Date(value);
    if (!Number.isNaN(at.getTime())) return at.toISOString();
  }
  throw new AdminWalletRowError(
    `${table}.${property} came back as ${typeof value} and this module reads it as an instant. ` +
      'The column is `timestamptz`.',
  );
}

/** One `wallet_spend_limits` row, narrowed. */
export interface SpendLimitRow {
  readonly dailyCents: bigint;
  readonly rolling7dCents: bigint;
  readonly effectiveFrom: string;
  readonly setBy: string;
}

/** Read a `wallet_spend_limits` row off the accessor. */
export function toSpendLimitRow(value: unknown): SpendLimitRow {
  const table = 'wallet_spend_limits';
  const setBy = field(value, table, 'setBy');
  if (typeof setBy !== 'string')
    throw new AdminWalletRowError(`${table}.set_by came back as ${typeof setBy}. It is NOT NULL.`);
  return {
    dailyCents: centsOf(value, table, 'dailyCents'),
    rolling7dCents: centsOf(value, table, 'rolling7dCents'),
    effectiveFrom: instantOf(value, table, 'effectiveFrom'),
    setBy,
  };
}

/**
 * The limit in force at an instant, which is the greatest `effective_from` that
 * has arrived by then.
 *
 * FOLDED HERE RATHER THAN ORDERED IN SQL, because the accessor has no `ORDER BY`
 * and no `LIMIT` (ADR-157 section 7 and ADR-112 section 7 item 3), and the fold
 * is affordable for the same reason `wallet.ts`'s `balanceOf` is: the population
 * is one identity's own history and `wallet_spend_limits_current_idx` is
 * `(identity_id, effective_from DESC)`.
 *
 * `null` MEANS NO LIMIT WAS IN FORCE AND NOT "NO LIMIT APPLIES", and the two are
 * the same thing here on the contract's own reading: "the absence of a row for an
 * identity is what unlimited looks like".
 */
export function limitInForce(rows: readonly SpendLimitRow[], at: string): SpendLimitRow | null {
  let best: SpendLimitRow | null = null;
  for (const row of rows) {
    if (row.effectiveFrom > at) continue;
    if (best === null || row.effectiveFrom > best.effectiveFrom) best = row;
  }
  return best;
}

// -----------------------------------------------------------------------------
// The endpoint declaration, and the guard that makes it load bearing
// -----------------------------------------------------------------------------

/** What a handler is given once the role check has passed. */
export interface AdminWalletContext {
  readonly request: FastifyRequest;
  readonly principal: AdminPrincipal;
  readonly body: Record<string, unknown>;
  readonly backend: AdminWalletBackend;
  readonly ip: string | null;
  /** `null` on `reconciliation`, which names no identity. */
  readonly identityId: string | null;
  /** `null` on `reconciliation`, which opens no transaction. */
  readonly tx: AdminWalletTx | null;
  /** Writes the `admin_actions` row. Every mutating handler calls it BEFORE it appends. */
  readonly audit: (row: AuditRow) => Promise<void>;
}

/** What one endpoint hands the audit writer. */
interface AuditRow {
  readonly action: string;
  readonly initiative: AdminInitiative;
  readonly reason: string | undefined;
  readonly before: unknown;
  readonly after: unknown;
  readonly evidenceRefs: readonly unknown[];
}

/**
 * Insert the `admin_actions` row.
 *
 * CALLED BEFORE THE APPEND, ALWAYS. `admin_actions` is append-only (`0026`
 * revokes UPDATE and DELETE from `merit_app` and from PUBLIC) and its retention is
 * forever, so this row is the record and the append is what the record explains.
 *
 * `reason` IS OMITTED WHEN ABSENT RATHER THAN DEFAULTED, and omitting it is what
 * makes the `NOT NULL` the control. A spread of `undefined` would have been the
 * same statement to Postgres, but a conditional spread says the intent out loud in
 * a diff a reviewer reads.
 *
 * `subject_kind` IS `identity` ON BOTH ROWS. The column is polymorphic and
 * unconstrained -- `0017`'s own comment lists "a session, a phone-change request,
 * a payout request, a plan version" -- and `subject_id uuid NOT NULL` is the id
 * this endpoint was addressed with. Both of these acts are about a PERSON and not
 * about an account: `wallet_spend_limits` and `wallet_entries` are both `owned` on
 * `identity_id` and neither carries an `account_id` to name instead.
 *
 * `initiative` IS THE ROUTE'S AND IS NEVER READ OFF THE WIRE, which is `0043`'s
 * own instruction and its column comment closes the vocabulary at three. Neither
 * of these bodies carries the field in API_CONTRACT. `on_behalf_of_identity_id`
 * is written by neither, because `admin_actions_on_behalf_matches_initiative`
 * admits it only under `trader_request` and neither of these acts is the trader's:
 * a spend limit is a control Merit places ON a person and a correction is Merit
 * repairing its own record.
 */
async function writeAuditRow(
  tx: AdminWalletTx,
  principal: AdminPrincipal,
  subjectId: string,
  row: AuditRow,
  ip: string | null,
): Promise<void> {
  await tx.insert('adminActions', {
    actor: principal.actor,
    action: row.action,
    subjectKind: 'identity',
    subjectId,
    ...(row.reason === undefined ? {} : { reason: row.reason }),
    initiative: row.initiative,
    before: row.before,
    after: row.after,
    evidenceRefs: row.evidenceRefs,
    ...(ip === null ? {} : { ip }),
  });
}

/** One endpoint: its contract path, the roles it admits, and its body. */
export interface AdminWalletEndpointSpec {
  readonly method: HttpMethod;
  readonly path: string;
  /** `INV-M6-09`, as data. Never a check written inside a handler. */
  readonly roles: readonly AdminRole[];
  /**
   * Whether this endpoint opens a transaction and names an identity.
   *
   * `reconciliation` is the only `false`, and the field exists rather than a
   * branch on the path because a path comparison inside the guard would make the
   * transaction's presence a string match.
   */
  readonly addressed: boolean;
  readonly handle: (ctx: AdminWalletContext) => Promise<unknown>;
}

/**
 * Build the framework handler for one declared endpoint.
 *
 * ALL THREE ROUTES GO THROUGH HERE, so the role check runs before any handler
 * body, the transaction is opened in one place, the identity row is LOCKED in one
 * place, and the database's refusal becomes a problem document in one place.
 *
 * THE ROLE CHECK IS DATA AND NEVER A LINE INSIDE A HANDLER. `FM-M6-09` is "RBAC
 * gap lets `ops` change config", a merge blocker, and its control column is a
 * negative-authz matrix across every role and every mutating endpoint. A matrix
 * can only read a declaration.
 *
 * THE 401 AND THE 403 HAPPEN BEFORE `operator()` IS CALLED, which is this file's
 * `INV-M5-23` paragraph made structural: a refused caller opens no transaction, so
 * there is no `admin_actions` row, no lock and no append to roll back. 401
 * precedes 403 on section 2's own distinction, because answering 403 to an
 * anonymous caller would tell them the endpoint exists and that a role is the only
 * thing missing.
 *
 * THE LOCK IS TAKEN HERE AND NOT IN A HANDLER, so neither write can be reordered
 * ahead of it by an edit to a handler body, and a `:identityId` that names no
 * identity is `not_found` before anything is read.
 */
export function adminWalletHandler(spec: AdminWalletEndpointSpec): RouteHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const active = currentAdminWalletBackend();
    try {
      // A DEPLOYMENT THAT CANNOT AUTHENTICATE ANYONE HAS AUTHENTICATED NOBODY,
      // AND THE ANSWER TO THAT IS 401 RATHER THAN 503. ADR-192 clause 2. The
      // unwired default rejects `principal`, and answering that rejection with
      // the 503 tells an unauthenticated caller that this endpoint exists AND
      // that its backend is the only thing missing, which is the disclosure this
      // handler's own 401-before-403 paragraph refuses one branch later. Whether
      // this process holds a backend is a fact about the deployment, and a
      // caller who has not authenticated may not have it. The discrimination is
      // in the log, where `AdminWalletUnwired`'s message names the port member.
      let principal: AdminPrincipal | null;
      try {
        principal = await active.principal(request);
      } catch (err) {
        if (!(err instanceof AdminWalletUnwired)) throw err;
        request.log.error({ err }, 'admin wallet backend is not wired: principal');
        return sendProblem(
          reply,
          handlerProblem('unauthenticated', 'Unauthenticated', 401, request.id),
        );
      }
      if (principal === null)
        return sendProblem(
          reply,
          handlerProblem('unauthenticated', 'Unauthenticated', 401, request.id),
        );
      if (!spec.roles.includes(principal.role))
        return sendProblem(reply, {
          ...handlerProblem('forbidden', 'Forbidden', 403, request.id),
          detail: `The \`${principal.role}\` role may not perform this action.`,
        });

      const body = asRecord(request.body) ?? {};
      const ip = request.ip === '' ? null : request.ip;

      if (!spec.addressed)
        return await spec.handle({
          request,
          principal,
          body,
          backend: active,
          ip,
          identityId: null,
          tx: null,
          audit: () =>
            Promise.reject(
              new AdminWalletRowError(
                'a read endpoint asked to write an `admin_actions` row. Section 8 requires the ' +
                  'row of every MUTATING endpoint, and an audited read would record an act ' +
                  'nobody performed.',
              ),
            ),
        });

      const identityId = identityIdOf(request);
      if (identityId === null) throw notFound();

      return await active.operator(async (tx) => {
        // ADR-157's ROW LOCK, and it is the first statement of the transaction.
        // Two operators acting on one wallet is the case it exists for: the
        // second blocks here, then re-reads a precondition that has moved.
        // `identities` is the registry's only `root` and its rule names `id`, so
        // this is `INV-M20-01`'s per-identity lock at the authority this module
        // holds. No advisory lock is taken and none is reachable from this port.
        const found = await tx.lockAt('identities', { id: identityId });
        if (found === undefined || found === null) throw notFound();

        return await spec.handle({
          request,
          principal,
          body,
          backend: active,
          ip,
          identityId,
          tx,
          audit: (row) => writeAuditRow(tx, principal, identityId, row, ip),
        });
      });
    } catch (err) {
      if (err instanceof Refusal)
        return sendProblem(reply, {
          ...handlerProblem(err.document.code, err.document.title, err.document.status, request.id),
          ...(err.document.detail === undefined ? {} : { detail: err.document.detail }),
          ...(err.document.errors === undefined ? {} : { errors: err.document.errors }),
        });
      if (err instanceof AdminWalletUnwired) {
        request.log.error({ err }, 'admin wallet backend is not wired');
        return sendProblem(
          reply,
          handlerProblem('service_unavailable', 'Service unavailable', 503, request.id),
        );
      }
      const failure = pgFailure(err);
      if (failure !== null && HANDLED_SQLSTATE.has(failure.code))
        return sendProblem(reply, fromDatabase(failure, request.id));
      throw err;
    }
  };
}

/** The route definitions one set of specs contributes. */
export function toAdminWalletRoutes(
  specs: readonly AdminWalletEndpointSpec[],
): readonly RouteDefinition[] {
  return specs.map((spec) => ({
    method: spec.method,
    path: spec.path,
    handler: adminWalletHandler(spec),
  }));
}

/**
 * The role declaration as data, keyed `METHOD /path`.
 *
 * Derived from the same array the routes are, so the table and the registration
 * cannot disagree. This is what `FM-M6-09`'s matrix reads.
 */
export function adminWalletRoleTable(
  specs: readonly AdminWalletEndpointSpec[],
): Readonly<Record<string, readonly AdminRole[]>> {
  const table: Record<string, readonly AdminRole[]> = {};
  for (const spec of specs) table[`${spec.method} ${spec.path}`] = spec.roles;
  return table;
}

// -----------------------------------------------------------------------------
// API_CONTRACT section 8, the three wallet rows, in the document's order
// -----------------------------------------------------------------------------

export const ADMIN_WALLET_ENDPOINTS: readonly AdminWalletEndpointSpec[] = [
  {
    method: 'POST',
    path: WALLET_CORRECT_PATH,
    // "Auth: `admin_sso`, role `owner`." OWNER ALONE, and it is the only row in
    // this module that narrows: this endpoint moves a trader's money, and
    // `ACCOUNT_ACTION_ROLES` would admit `ops`, which the contract does not.
    roles: ['owner'],
    addressed: true,
    handle: async (ctx) => {
      const errors: FieldError[] = [];
      const direction = textField(ctx.body, 'direction', errors, true);
      if (direction !== undefined && !(WALLET_DIRECTIONS as readonly string[]).includes(direction))
        errors.push({
          path: 'direction',
          message: `must be one of ${WALLET_DIRECTIONS.join(', ')}`,
        });
      // `CHECK (amount_cents > 0)`. The magnitude; direction carries the sign.
      const amountCents = centsField(ctx.body, 'amount_cents', errors, 1n);
      const cause = textField(ctx.body, 'cause', errors, true);
      // OPTIONAL, AND ITS ABSENCE IS NOT AN ERROR. ADR-173 clause 4: a
      // `goodwill` adjustment corrects no entry at all, the database accepts one
      // and it lands as `provenance = 'correction'` because `0011`'s closed list
      // offers no other value, so a REQUIRED field here would make a case `0038`
      // built for unreachable through the only endpoint that reaches it. The
      // shape is `false` and NOT a defaulted value: absence and emptiness are
      // different answers, and `textField` keeps them different.
      const correctsEntryId = textField(ctx.body, 'corrects_entry_id', errors, false);
      // PRESENT AND MALFORMED IS STILL AN ERROR. Optional widens what the
      // endpoint accepts and weakens nothing about what it accepts.
      if (correctsEntryId !== undefined && !DECIMAL.test(correctsEntryId))
        errors.push({
          path: 'corrects_entry_id',
          message:
            'must be a decimal string. `entry_id` is a `bigint` identity rendered as digits ' +
            '(ADR-158 clause 3) and a client must not parse it',
        });
      // ABSENCE IS CARRIED AND EMPTINESS IS NOT: see `textField`.
      const reason = textField(ctx.body, 'reason', errors, false);
      const secondApprover = textField(ctx.body, 'second_approver', errors, true);
      if (
        errors.length > 0 ||
        direction === undefined ||
        amountCents === undefined ||
        cause === undefined ||
        secondApprover === undefined
      )
        throw invalid(errors);

      // DUAL CONTROL, AND WHAT IS CHECKABLE HERE IS ONE THING OF THE THREE THE
      // CONTROL MEANS. `admin_actions.actor` is `text NOT NULL` carrying no
      // foreign key, because "the operator directory is the SSO provider's and
      // not this database's" (`admin-writes.ts`), so this module can verify that
      // the second approver is A DIFFERENT NAME and cannot verify that they
      // exist, that they hold `owner`, or that they consented. `0038`'s
      // `dual_control_approval_id` is the column that would carry the third, and
      // this endpoint has no wire field for it (this file's header, item 3).
      // WHAT IS REFUSED IS THE ONE THING A SINGLE OPERATOR CAN DO ALONE.
      if (secondApprover.trim() === ctx.principal.actor.trim())
        throw refuse(
          'precondition_failed',
          'Precondition failed',
          412,
          'Dual control is not satisfied: `second_approver` names the operator making the ' +
            'request. Two keys means two people.',
        );

      const tx = ctx.tx;
      const identityId = ctx.identityId;
      if (tx === null || identityId === null)
        throw new AdminWalletRowError('an addressed endpoint ran without a transaction');

      // THE PRECONDITION, RE-READ UNDER THE LOCK. The statement is bounded to
      // this identity and it is the same read `wallet.ts` makes for the trader's
      // own balance, through the same row reader, so the corrected entry's
      // membership and the current balance come from ONE read of ONE population.
      const rows: WalletEntryRow[] = (await tx.rowsWhere('walletEntries', { identityId })).map(
        toWalletEntryRow,
      );

      // THE `conflict` CHECK, CONDITIONED ON THE FIELD BEING PRESENT AND NOT
      // WEAKENED BY THE CONDITION. ADR-173 clause 5: an operator who names an
      // entry gets it validated against this identity's own statement, and an
      // operator who names none has nothing to validate. "`conflict`
      // (`corrects_entry_id` is present and does not belong to this identity)".
      // The read is already narrowed to this identity, so an entry belonging to
      // somebody else and an entry that does not exist are indistinguishable
      // here, and that is the fail-closed direction: the alternative is a second
      // unnarrowed read whose only purpose is to tell an operator that another
      // identity holds the row they asked about.
      const target = correctsEntryId === undefined ? undefined : BigInt(correctsEntryId);
      const corrected = target === undefined ? undefined : rows.find((row) => row.id === target);
      if (correctsEntryId !== undefined && corrected === undefined)
        throw refuse(
          'conflict',
          'Conflict',
          409,
          `Entry ${correctsEntryId} is not an entry of this identity's wallet.`,
        );

      // THE BALANCE THE LOCK FROZE. `balanceOf` is the row with the greatest
      // `id` and NOT the greatest `occurred_at`, which `wallet.ts`'s header calls
      // "the one thing in this file most likely to be 'fixed' into a defect": the
      // stored running balance is computed at APPEND time, and a correction may
      // legitimately carry a past `occurred_at`.
      const balanceBeforeCents = balanceOf(rows);

      // "A correcting DEBIT that would take the running balance below zero is
      // refused by the database ... the correction lands at the END of the
      // statement and is computed against the CURRENT balance rather than the
      // balance at the time of the entry it corrects." The refusal is made here
      // from the balance the lock froze, so the caller gets `insufficient_funds`
      // rather than a `23514`; `fromDatabase` maps the constraint as well, for
      // the case a writer this transaction cannot see got there first.
      if (direction === 'debit' && amountCents > balanceBeforeCents)
        throw refuse(
          'insufficient_funds',
          'Insufficient funds',
          INSUFFICIENT_FUNDS_STATUS,
          `This correction debits ${amountCents.toString()} cents against a balance of ` +
            `${balanceBeforeCents.toString()}. \`wallet_entries.balance_after_cents\` is ` +
            'CHECK (>= 0), so the remedy is a debt rather than a negative wallet.',
        );

      // THE AUDIT ROW FIRST, CARRYING THE STATE THE APPEND IS COMPUTED AGAINST.
      // Under the DATABASE's own column names, so a reader of this JSON can find
      // them in `0011` without a mapping table. `balance_after_cents` is the
      // before-state that matters: the append is computed from it, and after the
      // append the table cannot say what it was without re-folding the statement.
      //
      // AND `corrected_entry` IS THE DURABLE RECORD OF WHICH ENTRY WAS
      // CORRECTED, WHICH IS WHY IT CARRIES THE WHOLE ENTRY AND NOT AN ID. No
      // column anywhere in the schema records it and ADR-173 clause 3 ruled that
      // none is owed: this row holds the corrected entry's direction, amount,
      // provenance, cause, running balance and timestamp AS THEY STOOD BEFORE
      // the correction, and `0026` revokes UPDATE and DELETE on `admin_actions`
      // from `merit_app` and from PUBLIC exactly as it does on `wallet_entries`,
      // so the record is as durable as the entry it describes. ADR-158 clause
      // 7's instrument, and the cost of preferring it to a column is named in
      // ADR-173 section 6 item 1: this row is written by a handler and not by a
      // trigger, so nothing in the database refuses a correction that omits it.
      //
      // OMITTED, NOT NULLED, WHEN THE OPERATOR NAMED NO ENTRY. A `goodwill`
      // credit corrects nothing, and a `corrected_entry` of `null` would be this
      // handler asserting that an entry was looked for and not found. The same
      // is true of the `wallet_entry` evidence ref below.
      await ctx.audit({
        action: 'wallet_entry.correct',
        // NOT `enforcement`: Merit is repairing its own record and is not acting
        // against the trader. NOT `trader_request`: nobody asked, and that value
        // additionally REQUIRES `on_behalf_of_identity_id` by
        // `admin_actions_on_behalf_matches_initiative`. `0043`'s vocabulary is
        // closed at three, so `operational` is what remains.
        initiative: 'operational',
        reason,
        before: {
          balance_after_cents: centsToJson(balanceBeforeCents),
          ...(corrected === undefined
            ? {}
            : {
                corrected_entry: {
                  id: corrected.id.toString(),
                  direction: corrected.direction,
                  amount_cents: centsToJson(corrected.amountCents),
                  provenance: corrected.provenance,
                  cause: corrected.cause,
                  balance_after_cents: centsToJson(corrected.balanceAfterCents),
                  occurred_at: corrected.occurredAt,
                },
              }),
        },
        after: {
          direction,
          amount_cents: centsToJson(amountCents),
          provenance: CORRECTION_PROVENANCE,
          cause,
        },
        evidenceRefs: [
          { kind: 'second_approver', ref: secondApprover },
          ...(correctsEntryId === undefined
            ? []
            : [{ kind: 'wallet_entry', ref: correctsEntryId }]),
        ],
      });

      // THE APPEND, WHICH THIS MODULE STILL CANNOT COMPOSE. See this file's
      // header for the three constraints that make it unwritable from this body,
      // and the port for what a wiring slice would still be missing. The one
      // thing about the append that IS settled is stated at the port:
      // `wallet_entries.reference_id` is the adjustment's id and nothing else.
      //
      // `correctsEntryId` REACHES THE PORT AND IS WRITTEN TO NO COLUMN. It is
      // `undefined` when the operator named no entry, and the record of it in
      // either case is the `admin_actions` row above.
      const written = await ctx.backend.writeCorrection(tx, {
        identityId,
        direction: direction as WalletDirection,
        amountCents,
        cause,
        correctsEntryId: target,
        reason,
        secondApprover,
        actor: ctx.principal.actor,
        balanceBeforeCents,
      });

      const response: WalletCorrectionResponse = {
        entry_id: written.entryId.toString(),
        provenance: CORRECTION_PROVENANCE,
        direction: direction as WalletDirection,
        amount_cents: centsToJson(amountCents),
        balance_after_cents: centsToJson(written.balanceAfterCents),
        ledger_transaction_id: written.ledgerTransactionId,
        occurred_at: written.occurredAt,
      };
      assertWalletScalars(response, '');
      return response;
    },
  },
  {
    method: 'POST',
    path: WALLET_SPEND_LIMIT_PATH,
    // "Auth: `admin_sso`, roles `owner` and `ops`" and "`forbidden` (`readonly`
    // role)". `ACCOUNT_ACTION_ROLES` is that pair, imported rather than retyped so
    // three admin modules cannot disagree about who may act on a person.
    roles: ACCOUNT_ACTION_ROLES,
    addressed: true,
    handle: async (ctx) => {
      const errors: FieldError[] = [];
      // `CHECK (daily_cents >= 0)`, and `0` IS A WRITABLE VALUE MEANING NO WALLET
      // SPEND AT ALL. There is no value meaning unlimited: "the absence of a row
      // is what unlimited looks like", so this module has no delete path and the
      // contract says an endpoint that removes a limit "does not exist".
      const dailyCents = centsField(ctx.body, 'daily_cents', errors, 0n);
      const rolling7dCents = centsField(ctx.body, 'rolling_7d_cents', errors, 0n);
      const effectiveFrom = instantField(ctx.body, 'effective_from', errors);
      const reason = textField(ctx.body, 'reason', errors, false);
      // `wallet_spend_limits_weekly_exceeds_daily` IS A CHECK AND NOT A NICETY:
      // "a rolling weekly limit below the daily limit is a daily limit with a
      // confusing name". It is refused here as well so the caller gets the
      // contract's `validation_failed` with the path named rather than a `23514`.
      if (dailyCents !== undefined && rolling7dCents !== undefined && rolling7dCents < dailyCents)
        errors.push({
          path: 'rolling_7d_cents',
          message:
            'must be at least `daily_cents`. `wallet_spend_limits_weekly_exceeds_daily` refuses ' +
            'a rolling weekly limit below the daily one',
        });
      if (
        errors.length > 0 ||
        dailyCents === undefined ||
        rolling7dCents === undefined ||
        effectiveFrom === undefined
      )
        throw invalid(errors);

      const tx = ctx.tx;
      const identityId = ctx.identityId;
      if (tx === null || identityId === null)
        throw new AdminWalletRowError('an addressed endpoint ran without a transaction');

      const effectiveFromAt = effectiveFrom.toISOString();

      // THE PRECONDITION, RE-READ UNDER THE LOCK. "`conflict` (a row already
      // exists for this identity at this `effective_from`)". The primary key
      // refuses it too and `fromDatabase` maps that `23505`; both are kept,
      // because the database's refusal arrives as the wrong code for a contract
      // that names `conflict`, and an application check alone is one an edit can
      // reorder away.
      const existing: SpendLimitRow[] = (
        await tx.rowsWhere('walletSpendLimits', { identityId })
      ).map(toSpendLimitRow);
      if (existing.some((row) => row.effectiveFrom === effectiveFromAt))
        throw refuse(
          'conflict',
          'Conflict',
          409,
          `A spend limit is already recorded for this identity at ${effectiveFromAt}. The grain ` +
            'is `(identity_id, effective_from)` and a limit is an APPEND, so two writes at one ' +
            'instant collide.',
        );

      // THE ROW THIS APPEND SUPERSEDES, read before the append and recorded in
      // `admin_actions.before`. It is the limit that was in force AT THE NEW
      // `effective_from` rather than the newest row overall, because a limit
      // back-dated ahead of a later one supersedes nothing.
      const superseded = limitInForce(existing, effectiveFromAt);

      await ctx.audit({
        action: 'wallet_spend_limit.set',
        initiative: 'operational',
        reason,
        before:
          superseded === null
            ? { wallet_spend_limits: null }
            : {
                daily_cents: centsToJson(superseded.dailyCents),
                rolling_7d_cents: centsToJson(superseded.rolling7dCents),
                effective_from: superseded.effectiveFrom,
                set_by: superseded.setBy,
              },
        after: {
          daily_cents: centsToJson(dailyCents),
          rolling_7d_cents: centsToJson(rolling7dCents),
          effective_from: effectiveFromAt,
          set_by: ctx.principal.actor,
        },
        evidenceRefs: [],
      });

      // THE APPEND. `set_by` IS THE PRINCIPAL'S AND THE BODY IS NOT CONSULTED:
      // API_CONTRACT's own field comment is "the admin actor, from the session.
      // NEVER from the body". A body carrying `set_by` is ignored rather than
      // refused, because refusing it would make the field's presence meaningful.
      const [inserted] = await tx.insert('walletSpendLimits', {
        identityId,
        dailyCents,
        rolling7dCents,
        reason,
        setBy: ctx.principal.actor,
        effectiveFrom,
      });

      const response: SpendLimitResponse = {
        identity_id: identityId,
        daily_cents: centsToJson(dailyCents),
        rolling_7d_cents: centsToJson(rolling7dCents),
        effective_from: effectiveFromAt,
        set_by: ctx.principal.actor,
        // `created_at` is `timestamptz NOT NULL DEFAULT now()`, so it is the
        // DATABASE's value and is read back off the inserted row rather than
        // stamped from `backend.now()`. Two clocks for one column is how a
        // response and a row come to disagree about when something happened.
        created_at: instantOf(inserted, 'wallet_spend_limits', 'createdAt'),
      };
      assertWalletScalars(response, '');
      return response;
    },
  },
  {
    method: 'GET',
    path: WALLET_RECONCILIATION_PATH,
    // "Auth: `admin_sso`, all roles including `readonly`. Read-only, no side
    // effect." ALL THREE, and the check is still not vacuous: a caller with no
    // operator session is 401 and a principal carrying a role string outside the
    // closed set is 403 rather than defaulted to `readonly`.
    roles: ADMIN_ROLES,
    addressed: false,
    handle: async (ctx) => {
      const response = await ctx.backend.reconcile(ctx.backend.now());
      // THE RESPONSE IS CHECKED AGAINST ITS OWN CONTRACT BEFORE IT IS SENT. See
      // `assertReconciliation`: this is the half of the endpoint this fence can
      // build, and the adapter it is waiting on is the one it will catch.
      assertReconciliation(response);
      return response;
    },
  },
];

// -----------------------------------------------------------------------------
// The module
// -----------------------------------------------------------------------------

/** `FM-M6-09`'s matrix reads this. Derived, never written twice. */
export const ADMIN_WALLET_ROLES = adminWalletRoleTable(ADMIN_WALLET_ENDPOINTS);

export default defineRoutes({
  name: 'admin-wallet',
  routes: toAdminWalletRoutes(ADMIN_WALLET_ENDPOINTS),
});
