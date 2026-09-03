// =============================================================================
// apps/api/src/routes/payouts.ts
// =============================================================================
// API_CONTRACT SECTION 6's `POST /accounts/:accountId/payout` AND `GET /payouts`.
// THIS IS THE ROUTE THAT PAYS A TRADER.
//
// -----------------------------------------------------------------------------
// THE GATE CONTRADICTION THIS SESSION WAS DISPATCHED TO RULE IS ALREADY CLOSED,
// AND THE RESIDUE IS WHAT `ADR-140` RULES
// -----------------------------------------------------------------------------
// The brief reads: after ADR-062 the payout gate is `identities.status =
// 'active'` while M20's `INV-M20-06` blocks on `= 'restricted'`, so a `closed`
// identity cannot request a payout and can still spend its wallet. IT WAS TRUE
// AND IT IS NOT TRUE NOW. ADR-075 amended `INV-M20-06` and
// `G-WITHDRAWAL-CLEARED` to `= 'active'` on 2026-08-21 and closed `OQ-062-01`
// by name; `M20:62` carries that predicate today. Both readings were checked at
// file and line before anything here was written, which is what the dispatch
// asked for and is the only reason the staleness was visible at all.
//
// WHAT IS STILL OPEN IS THE HALF NO DOCUMENT OWNS: `G-ELIGIBLE` NAMES A TERM
// THAT NOTHING IN THIS TREE CAN EVALUATE OR REPORT.
//
//   `ExternalGates` is `accountStatus`, `kycState`, `payoutsFrozen`,
//   `reconBlocked`, `hasPayoutInFlight`. THERE IS NO IDENTITY STATUS IN IT, so
//   `evaluatePayout` cannot compute this gate.
//
//   `EligibilityResponse.gates` has ten cells and none of them is the identity
//   status either, so a refusal shaped as `payout_not_eligible` would carry a
//   breakdown in which EVERY GATE PASSES.
//
// The engine already met this exact shape one term over and answered it:
// `PayoutEvaluation.noPayoutInFlight` is reported beside the breakdown because
// "API_CONTRACT's `gates` has no slot". The identity status has no evaluator to
// report beside, so `ADR-140` places it OUTSIDE the evaluation entirely:
//
//   THE IDENTITY-STATUS TERM OF `G-ELIGIBLE` IS A NAMED REFUSAL, EVALUATED
//   BEFORE THE ACCOUNT IS READ, ANSWERED `identity_restricted` 422, AND NEVER
//   EXPRESSED AS A GATE RESULT. IT REFUSES `closed` AS WELL AS `restricted`,
//   BECAUSE THE RULED PREDICATE IS `= 'active'` AND NOT AN ENUMERATION OF WHAT
//   IS REFUSED.
//
// `INV-M5-23` is the same placement decided for a different refusal: the
// impersonation refusal sits "before section 1.1's first step ... Nothing about
// the account is read, because reading it is the act being refused", on the
// ground that routing a non-eligibility refusal down the eligibility path
// "would put a false eligibility story on a real account". A restricted human
// is not a trader who did not qualify.
//
// -----------------------------------------------------------------------------
// MONEY IS `bigint` CENTS INSIDE THIS FILE AND A JSON INTEGER ON THE WIRE
// -----------------------------------------------------------------------------
// API_CONTRACT section 1: "`*_cents` are JSON integers. `*_bp` are JSON
// integers. NO FLOATS, no formatted strings." `Cents` is `bigint` in
// `@merit/rules-engine` and every money column of `payout_requests` is
// `bigint`, so the arithmetic here is `bigint` and the two conversions are
// `centsFromJson` and `centsToJson`, which REFUSE rather than round. There is
// no float in this file, in its suite, or in any fixture either one holds.
//
// -----------------------------------------------------------------------------
// THIS ROUTE RECORDS THE APPROVAL AND DOES NOT POST IT. ADR-176 APPLIES ADR-172
// CLAUSE 2 HERE, WHICH IS WHERE ADR-172 REPORTED IT AND FENCED IT
// -----------------------------------------------------------------------------
// `PayoutTx` USED TO CARRY A `LedgerTx` AND NO LONGER DOES, and the reason is a
// type fact rather than a preference. `postTransaction` takes a `LedgerTx`,
// whose `insert` names the two members of `LedgerWriteKey`
// (`packages/ledger/src/tx.ts:64`). Both are scope class `derived`:
// `ledgerTransactions` (`packages/db/src/scope.ts:903`) and `ledgerEntries`
// (`packages/db/src/scope.ts:894`); `ScopedTx.insert` takes
// `OwnedTableKey` (`scoped-db.ts:3547`) and `insertUnder` takes
// `ParentedTableKey`, which is `Extract<DerivedTableKey, 'sessions'>`
// (`scoped-db.ts:2138`), a closed list of ONE. So the ONLY handle that
// satisfies `LedgerTx` is `SystemTx.insert<K extends TableKey>`
// (`scoped-db.ts:3713`), which is generic over EVERY TABLE IN THE ESTATE. THAT
// LAST NUMBER READ `3138` AND POINTED AT A REFUSAL STRING INSIDE `tradingDay`,
// which is ADR-212's hazard on this file too: a citation broken by lines
// inserted above it. ADR-281 moved this neighbourhood by thirteen lines and
// repointed it at the declaration it names rather than shifting a wrong number.
//
// A DOOR IN `apps/api/src/db.ts` RETURNING SUCH A HANDLE WOULD BE `systemDb`
// UNDER ANOTHER NAME, and ADR-172 clause 2 refuses it: admitting it to a
// request handler hands the trader surface authority over every row Merit
// holds. `SystemReason` gains no member (ADR-165) and the word was never the
// obstacle, because the word would still hand over that signature.
//
// SO THE PORT WAS THE DEFECT AND THE MISSING DOOR WAS NOT. The request path
// RECORDS the approval; the posting is performed at a system authority, which
// is the arrangement already in force at all three of the other places the same
// posting is reachable: the worker, which posts through `ExpiryLedgerPort`
// (`apps/worker/src/sweeps/ports.ts:229`) on a handle opened at
// `systemDb(WORKER_REASON)`, and `WORKER_REASON` is `'nightly-batch'`
// (`apps/worker/src/db.ts:112,124`); the operator console, whose release arm
// posts at `AdminPayoutTx.ledger` (`admin-payouts.ts:369`); and
// `POST /wallet/withdrawals`, which declined to post on its own request path
// deliberately and in writing (`wallet-withdrawals.ts:9-12`).
//
// `INV-M5-06` SURVIVES THE MOVE BY CONSTRUCTION, WHICH IS WHY THE MOVE IS SAFE.
// `ledger_transactions.idempotency_key` is `text NOT NULL UNIQUE` and every
// door that posts `LT-01` builds `` `${PAYOUT_ENDPOINT} ${key}` `` from the
// REQUEST ROW'S OWN STORED KEY: `admin-payouts.ts:928` and
// `apps/worker/src/sweeps/expiry.ts:313` are both `releaseLedgerKey`, and both
// call sites pass `held.idempotencyKey` off the locked row
// (`admin-payouts.ts:1215`, `expiry.ts:674`). The key is therefore a property
// of the APPROVAL and not of the DOOR, so removing one of the doors that mint
// the identical string cannot produce a second posting, and the DATABASE
// refuses a duplicate rather than application memory that forgets on restart.
//
// WHAT IS OWED, STATED HERE RATHER THAN LEFT TO BE NOTICED. Nothing in this
// tree yet posts `LT-01` for a request that was approved with NO hold: the two
// remaining doors both fire on a HELD request being released. ADR-172 section 5
// names that driver and checked at `0010_payouts.sql` that it needs no
// migration; ADR-176 does not build it and does not pretend it exists. THE GAP
// IS UNREACHABLE IN EVERY DEPLOYMENT, and that is a control rather than a
// hope: `usePayoutBackend` is unwired, `apps/api/test/wiring.test.ts` asserts
// `start.ts` does not call it, and this route answers 503 before it reaches a
// transaction at all.
//
// THIS FILE STILL HOLDS NO LEDGER ARITHMETIC AND STILL BUILDS `LT-01`. `lt01`
// below names three accounts and one amount each and computes nothing, and it
// stays here because `admin-payouts.ts:203` IMPORTS it: a second transcription
// of `debit trader_withdrawable / credit trader_wallet / credit fees_revenue`
// is ADR-092 section 5's two-statements-of-one-fact hazard on the money path.
//
// -----------------------------------------------------------------------------
// `C-27` DOES NOT REACH THIS ROUTE, AND THE ANSWER IS THE CONTRACT'S RATHER
// THAN THIS FILE'S
// -----------------------------------------------------------------------------
// SECURITY:45 `C-27` names three sensitive actions: payout destination change,
// contact change, external withdrawal. A payout REQUEST is none of them.
// API_CONTRACT section 12 rows a destination change and an external withdrawal
// at `passkey or dual_channel` and rows THIS endpoint at "Auth: session, owner";
// M05 section 3.6 records that no destination route exists anywhere in the
// contract; and the external withdrawal is `POST /wallet/withdrawals`, SD-M5-06's
// separate object, which is not this file. THE MONEY DOES NOT LEAVE MERIT HERE:
// `LT-01` moves the trader's claim into the trader's own wallet position, and
// cash derecognizes at `LT-02` and `LT-07`, behind `C-27`.
//
// -----------------------------------------------------------------------------
// TWO REFUSALS THE CORPUS REQUIRES AND THIS SURFACE CANNOT WRITE
// -----------------------------------------------------------------------------
// `INV-M5-23`'s impersonation refusal cannot be implemented: `AuthSession` has
// six fields and none of them is a session type, so there is nothing to refuse
// on. M05 section 3.6 writes the corollary out in full for exactly this case,
// that a refusal nothing asserts disappears silently. It is reported here.
//
// `payout.requested`, `payout.approved` and `payout.held` are not emitted.
// Nothing in `apps/api/src` writes an event, and inventing a sink in a route
// would be this file deciding where the event catalogue lives.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { firmAccount, identityAccount, posting, transfer, type Posting } from '@merit/ledger';
import { evaluatePayout } from '@merit/rules-engine';
import type {
  Cents,
  ClampReason,
  ExternalGates,
  PayoutEvaluation,
  ResolvedPlan,
  RuleState,
} from '@merit/rules-engine';
import type { JsonValue } from '@merit/psp';
import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  beginIdempotent,
  completeIdempotent,
  identityScope,
  problemForOutcome,
  type IdempotencyOutcome,
  type IdempotencyStore,
} from '../idempotency.ts';
import { defineRoutes } from '../registry.ts';
import { RuleStateAbsent } from '../rule-state-reader.ts';
import { PROBLEM_MEDIA_TYPE, PROBLEM_TYPE_PREFIX, problem, type Problem } from '../server.ts';
import {
  requiredFactorTable,
  toRoutes,
  withSessionContext,
  type AuthSession,
  type EndpointSpec,
  type FieldError,
} from './auth.ts';

// -----------------------------------------------------------------------------
// The two paths, as API_CONTRACT writes them
// -----------------------------------------------------------------------------

/**
 * API_CONTRACT section 6.
 *
 * THE PARAMETER IS SPELLED `:accountId` BECAUSE THE CONTRACT AND THE TREE BOTH
 * SPELL IT THAT WAY. `checkout.ts`'s `RESET_PATH` is `/accounts/:accountId/reset`
 * and it is on `main`. `find-my-way` refuses two routes whose parameter at one
 * position carries two names, so a concurrent slice landing `/accounts/:account`
 * makes the composed server throw at startup: that collision already exists
 * between that slice and `checkout.ts` and is not created here.
 */
export const PAYOUT_PATH = '/accounts/:accountId/payout';

/** API_CONTRACT section 6. The trader's own payout history. */
export const PAYOUTS_PATH = '/payouts';

/**
 * The idempotency endpoint prefix, `idempotency_keys.endpoint`.
 *
 * IT IS THE CONTRACT PATH AND NOT THE RESOLVED ONE, so two accounts of one
 * identity cannot collide on one client token by accident and cannot be told
 * apart by this layer either. `storedKey` puts the identity nowhere, which
 * `idempotency.ts` records as the DDL's choice; the SCOPE is what keeps one
 * identity's response from reaching another.
 */
export const PAYOUT_ENDPOINT = `POST ${PAYOUT_PATH}`;

// -----------------------------------------------------------------------------
// The wire shapes, transcribed from API_CONTRACT section 6
// -----------------------------------------------------------------------------

/** Section 6. `amount_cents` is OPTIONAL and is a CEILING, never an instruction (ADR-009). */
export interface PayoutRequestBody {
  readonly amount_cents?: number;
}

/** Section 6's `hold` block. Present only on `held_pending_review`. */
export interface PayoutHold {
  readonly held_at: string;
  /** `hold_expires_at`, 48 hours. ADR-040. */
  readonly resolves_by: string;
  readonly tos_clause: string;
}

/** Section 6's `PayoutResponse`. There is still no denial value. */
export interface PayoutResponse {
  readonly payout_request_id: string;
  readonly status: 'approved' | 'held_pending_review';
  readonly requested_cents: number;
  readonly amount_supplied: boolean;
  readonly approved_cents: number;
  readonly clamp_reason: ClampReason;
  readonly trader_cents: number;
  readonly firm_cents: number;
  readonly split_bp: number;
  readonly basis_trading_day: string;
  readonly payout_ordinal: number;
  readonly estimated_settlement: {
    readonly min_business_days: number;
    readonly max_business_days: number;
  };
  readonly hold: PayoutHold | null;
}

/**
 * Section 6's `PayoutListItem`.
 *
 * `approved_at` IS NULLABLE AND THAT IS THE HOLD'S WHOLE SHAPE IN ONE FIELD.
 * The hold is entered BEFORE approval, so a held request has no approval time
 * and a client that types it non-null renders an epoch date on the one state
 * that most needs to render correctly.
 */
export interface PayoutListItem {
  readonly payout_request_id: string;
  readonly account_id: string;
  readonly approved_cents: number;
  readonly trader_cents: number;
  readonly status: 'approved' | 'held_pending_review' | 'settled' | 'failed' | 'frozen';
  readonly approved_at: string | null;
  readonly settled_at: string | null;
  readonly hold: PayoutHold | null;
  readonly timeline: ReadonlyArray<{ readonly state: string; readonly at: string }>;
  readonly failure_note: string | null;
}

/** The gate breakdown API_CONTRACT section 6 puts in a `payout_not_eligible` body. */
export interface GateBreakdown {
  readonly account_active: { readonly pass: boolean };
  readonly kyc_verified: { readonly pass: boolean; readonly state: string };
  readonly not_frozen: { readonly pass: boolean; readonly reason: string | null };
  readonly recon_clear: { readonly pass: boolean };
  readonly traded_days: { readonly pass: boolean; readonly have: number; readonly need: number };
  readonly win_days: {
    readonly pass: boolean;
    readonly have: number;
    readonly need: number;
    readonly floor_cents: number;
  };
  readonly buffer: {
    readonly pass: boolean;
    readonly have_cents: number;
    readonly need_cents: number;
  };
  readonly consistency: {
    readonly pass: boolean;
    readonly skipped: boolean;
    readonly best_day_share_bp: number | null;
    readonly max_bp: number | null;
    readonly profit_needed_to_dilute_cents: number | null;
  };
  readonly cadence_gap: {
    readonly pass: boolean;
    readonly days_since_last_payout: number | null;
    readonly need: number;
    readonly next_eligible_trading_day: string | null;
  };
  readonly minimum_amount: {
    readonly pass: boolean;
    readonly withdrawable_cents: number;
    readonly min_payout_cents: number;
  };
}

// -----------------------------------------------------------------------------
// The domain rows this route reads and writes
// -----------------------------------------------------------------------------

/**
 * `identity_status`, the enum's three members.
 *
 * `0001_extensions_and_enums.sql:27`:
 * `CREATE TYPE identity_status AS ENUM ('active', 'restricted', 'closed')`.
 * ADR-041 refused a fourth. `ADR-140`'s predicate is `= 'active'` precisely so
 * that a fourth arriving later fails CLOSED on this door rather than open.
 */
export type IdentityStatus = 'active' | 'restricted' | 'closed';

/**
 * Everything one account contributes to one evaluation.
 *
 * `state` and `plan` ARE THE ENGINE'S OWN TYPES AND ARE NOT RESTATED HERE. A
 * second transcription of `RuleState` in a route is the two-statements-of-one-
 * fact hazard on the money path, and `evaluatePayout` is the function
 * `INV-M5-02` requires both payout endpoints call.
 */
export interface PayoutSubject {
  readonly accountId: string;
  /**
   * THE STORED `rule_states` ROW FOR THE LAST CLOSED TRADING DAY, REBUILT.
   *
   * **A BACKEND IMPLEMENTING `subject()` CALLS `ruleStateOn`
   * (`../rule-state-reader.ts`) AND DOES NOT FOLD ONE HERE.** `INV-M5-02` is
   * that both payout endpoints call `evaluatePayout` with the same inputs
   * because "a second evaluator would be a second rule", and `ADR-239` rules
   * that the API READS the state the WORKER wrote: a request-path fold is the
   * divergence `ADR-026` C-07's `state_hash` exists to make detectable,
   * computed on the one path no replay audit reads. `ruleStates` is registered
   * `derived` via `accounts` (`packages/db/src/scope.ts`), so the rows are one
   * hop out on this same transaction.
   *
   * **AN ABSENT ROW IS A REFUSAL AND IT IS NEVER A DEFAULT STATE.** The reader
   * raises `RuleStateAbsent` when the nightly fold has not closed the day for
   * the account, and there is no arm that returns a state it did not read. A
   * zeroed or carried-forward state here is a confident payout verdict computed
   * off inputs nobody folded, which is worse on this door than any refusal.
   *
   * **AND THE DAY IS `ScopedTx.lastClosedTradingDay()`, WHICH IS A NAMED DOOR
   * RATHER THAN A CATALOGUE KEY OR A SECOND TRANSACTION.** `R-06` permits only
   * the LAST CLOSED trading day, and `ADR-264` section 5 found that day
   * unreadable here: `tradingCalendar` is scope class `firm` and
   * `CATALOG_TABLE_KEYS` is a closed list of five that does not carry it. It
   * named two remedies and took neither; `ADR-268` refuses both and builds a
   * door. **A BACKEND IMPLEMENTING `subject()` CALLS THAT METHOD AND DOES NOT
   * FOLD A CALENDAR HERE.** The fold is stated twice in this repository
   * already, in two ways that disagree about coverage, and a third statement of
   * it in a route would be the first on the money path.
   *
   * **THE DOOR REFUSES AN EXHAUSTED CALENDAR AND THAT IS NOT A DEFECT.** An
   * uncovered day is UNKNOWN rather than a holiday (`ADR-042` F-4), so the
   * latest closed row of a calendar nobody has loaded forward is the last day
   * Merit knows about and not the last closed one. The refusal reaches this
   * route as a throw inside the payout transaction, which rolls back.
   *
   * **AND IT DOES NOT WIRE THIS PORT.** Nothing in this tree implements
   * `PayoutTx` at all, and no deployment has run the nightly fold. `ADR-268`
   * section 8.
   *
   * **AND THE ABSENT ROW NOW HAS A REFUSAL PATH OUT OF THIS ROUTE, WHICH IS
   * `ADR-285` AND WHICH `ADR-281` RULING 3 FOUND MISSING.** `unwiredOrThrow` at
   * the foot of this file rethrows anything that is not a
   * `PayoutBackendUnwired`, so a backend installed before that row answered an
   * unfolded day with a **500**; `stateNotFolded` is the arm, it answers **503
   * `service_unavailable`** with a generic `detail`, and the whole argument for
   * that status is on that function. **THE REFUSAL IS STILL NEVER A STATE**: no
   * arm of this route returns a `RuleState` it did not read.
   *
   * **AND A BACKEND MUST RESOLVE THE ACCOUNT BEFORE IT READS THE STATE.** This
   * is `ADR-285` ruling 4 and it is a constraint the arm creates rather than one
   * it inherits. `subject()` returning `null` is section 1's 404 for a resource
   * the caller does not own, and 404 and 503 are DISTINGUISHABLE: an
   * implementation that read `rule_states` first would hand a prober a 503 for
   * every account of another identity, because a scoped read of a foreign
   * account's rows is empty and an empty list is `RuleStateAbsent`. Section 1
   * requires that this API not confirm the existence of other people's
   * resources, so the ownership answer is FIRST and `RuleStateAbsent` may only
   * escape for an account this handle can already see.
   *
   * **AND IT DOES NOT WIRE THIS PORT.** `ADR-256` ruling 12 permits wiring when
   * the last gap is a thing the DEPLOYMENT sets; two gaps remain that are not,
   * and `wiring.test.ts`'s entry names both.
   */
  readonly state: RuleState;
  /**
   * THE PINNED PLAN VERSION AT THE ACCOUNT'S OWN SIZE, RESOLVED.
   *
   * **THIS FIELD HAD NO DOCBLOCK FOR SEVENTEEN REVISIONS OF `usePayoutBackend`'s
   * REASON AND THE REASON SAID IT WAITED ON NOTHING. IT DID NOT (`ADR-281`), AND
   * WHAT IT WAITED ON IS NOW HALF LANDED (`ADR-283`).** `ADR-233` catalogued
   * `planVersions` and `planVersionSizes`, so a `ScopedTx` can READ both rows on
   * this transaction, and it gave the READ and not the DECODE.
   *
   * **THE BLOB HALF IS DISCHARGED AND THE DECODER IS THE ENGINE'S.**
   * `decodePlanRules` (`packages/rules-engine/src/plan/rules-codec.ts`) turns
   * `plan_versions.rules` into the `PlanRulesJson` `resolvePlan` declares, this
   * deployable has declared `@merit/rules-engine` since session 252, and
   * `ADR-239` slice A is the home it landed in, beside `gates-codec.ts`.
   *
   * **A BACKEND IMPLEMENTING `subject()` MAY STILL NOT WRITE ONE HERE.** A
   * fourth statement of the blob that fixes every cents value a payout is
   * decided against is `FM-16` on the money path, and `ADR-269` refused exactly
   * that for `readLiability` one port over, on the same value. The two copies
   * `ADR-283` exists to retire are `toPublishedRules`
   * (`apps/worker/src/batch/adapter.ts`) and `decodeRules`
   * (`apps/site/src/catalog/adapter.ts`), and neither is importable from here.
   *
   * **AND `resolvePlan` TAKES TWO ARGUMENTS.** The second is a
   * `PlanVersionSizeRow`, `ScopedTx.catalogRowAt` returns `Promise<unknown>`,
   * and `plan_version_sizes.payout_cap_schedule_cents` is itself `jsonb` holding
   * cents. So what this field waits on is the SIZE ROW's decoding, which
   * `ADR-283` section 5 measured and did not take: the two readers that exist
   * read two DIFFERENT sources under two different key spellings, so it is not
   * one predicate stated twice and merging them is a ruling rather than a
   * transcription. **NO CAST STANDS IN FOR IT.** A `PlanVersionSizeRow` asserted
   * onto an untyped row is a payout basis nobody checked, and it is worse than a
   * refusal because it looks like a decode.
   */
  readonly plan: ResolvedPlan;
  /**
   * `R-40` AND `R-38`'s FIVE CONTEXT FACTS, AND THEY ARE CONSTRUCTIBLE NOW.
   *
   * **THIS FIELD WAS THE THIRD OF THREE AND NO REASON ON THIS PORT NAMED IT FOR
   * ELEVEN REVISIONS.** `ADR-248` ruled it NOT constructible in this deployable,
   * because `hasPayoutInFlight` was a predicate `M01` stated at two grains and a
   * route picking a side would be settling an open corpus question in a file
   * nobody reads twice. `ADR-254` ruled the grain ACCOUNT and amended `M01`.
   * `ADR-260` wrote the resolver.
   *
   * **A BACKEND IMPLEMENTING `subject()` CALLS `resolveExternalGates`
   * (`@merit/rules-engine`) AND DOES NOT WRITE THIS RECORD OUT.** It takes the
   * RAW column values -- `accounts.status`, both `payouts_frozen` flags,
   * `accounts.recon_blocked`, the whole `kyc_verifications` chain of the owning
   * identity, and the `status` of every `payout_requests` row of the subject
   * account -- and either returns the record or throws an `ExternalGatesRefusal`
   * naming the leg. `apps/worker` builds `AccountDay.external` through the same
   * function, which is the point: a literal here would be a second answer to the
   * seven-versus-six `accounts.status` question with nothing comparing the two.
   *
   * **EVERY TABLE IT NEEDS IS ON THE PAYOUT TRANSACTION.** `identities` is
   * `root`, and `accounts`, `kycVerifications` and `payoutRequests` are `owned`
   * on `identity_id` (`packages/db/src/scope.ts`), so no second door and no
   * second transaction is implied by this field.
   *
   * **AND `usePayoutBackend` IS STILL NOT WIRED, AND THIS PARAGRAPH USED TO SAY
   * WHY IN A WAY `ADR-264` MADE INCOMPLETE.** It read that `state` means reading
   * a `rule_states` row and that no scheduled run had written one; the reader
   * exists now (`../rule-state-reader.ts`) and the fold was measured writing a
   * row on a seeded database. **THE CALENDAR READ THAT SENTENCE ALSO NAMED IS
   * DISCHARGED (`ADR-268`, re-derived at source by `ADR-281`):**
   * `ScopedTx.lastClosedTradingDay()` is declared and implemented on this
   * transaction. What stands on `state` is a DEPLOYMENT that has run the job
   * and a refusal path for the row it has not written; what stands on `plan` is
   * the decoding the field above names. Neither is this field's.
   */
  readonly gates: ExternalGates;
}

/**
 * `G-HOLD-REQUIRED`'s flag, resolved by the caller.
 *
 * THE PREDICATE IS THE GUARD'S AND IS RESOLVED BEHIND THIS PORT: "an unresolved
 * `risk_flags` row of severity 4 or above, in status `open` or `investigating`,
 * against the account or the identity at request time" (STATE_MACHINES:414,
 * ruled by ADR-062 section 3). The route does not re-derive a severity band; a
 * second high-severity threshold defined in a route is this repository's most
 * repeated defect.
 */
export interface HoldFlag {
  readonly flagId: string;
  readonly tosClause: string;
  readonly reason: string;
}

/** The `payout_requests` row this handler writes. Every money field is `bigint`. */
export interface PayoutRequestInsert {
  readonly id: string;
  readonly accountId: string;
  /**
   * `payout_requests.idempotency_key`, THE CALLER'S OWN TOKEN, UNPREFIXED.
   *
   * ADDED BY ADR-176 AND LOAD BEARING FOR `INV-M5-06` RATHER THAN DECORATIVE.
   * While this route posted `LT-01` itself, the key reached the posting from
   * the handler's own memory and this shape never needed it; the column was
   * `text NOT NULL` the whole time (`0010_payouts.sql:82`) and NOTHING HERE
   * COULD WRITE IT. With the posting moved to a system authority (ADR-172
   * clause 2), the driver has no other place to read it from: it rebuilds
   * `` `${PAYOUT_ENDPOINT} ${idempotency_key}` `` off the stored row, exactly as
   * `admin-payouts.ts:817,1215` and `apps/worker/src/sweeps/expiry.ts:674`
   * already do off the same column. AN APPROVAL COMMITTED WITHOUT THIS VALUE IS
   * AN APPROVAL NO DOOR CAN EVER POST.
   *
   * IT IS STORED WITHOUT THE `PAYOUT_ENDPOINT` PREFIX because the column is the
   * client's token: `payout_requests_account_idempotency_uq` is
   * `(account_id, idempotency_key)` (`0010_payouts.sql:177-178`), which is
   * "the same key on the same account is the same request", and the prefix
   * belongs to the LEDGER key that every door composes from it.
   */
  readonly idempotencyKey: string;
  readonly status: 'approved' | 'held_pending_review';
  readonly basisTradingDay: string;
  readonly ordinal: number;
  readonly requestedCents: Cents;
  readonly approvedCents: Cents;
  readonly traderCents: Cents;
  readonly firmCents: Cents;
  readonly splitBp: number;
  readonly clampReason: ClampReason;
  /** `INV-22`. The serialized evaluation, append-only once written. */
  readonly eligibilitySnapshot: JsonValue;
  /** `SD-M5-08`: all five hold columns together or none. `null` on an approval. */
  readonly hold: {
    readonly heldAt: string;
    readonly holdExpiresAt: string;
    readonly holdFlagId: string;
    readonly holdTosClause: string;
    readonly holdReason: string;
  } | null;
}

// -----------------------------------------------------------------------------
// The ports
// -----------------------------------------------------------------------------

/**
 * One open transaction, as the payout path needs to see it.
 *
 * EVERY METHOD RUNS ON ONE TRANSACTION AND THAT IS ADR-006's CONSEQUENCE RELIED
 * ON RATHER THAN RESTATED: the `payout_requests` row and `LT-01` commit
 * together, so an approval that could not post leaves no approved request and a
 * posting that succeeded has a request behind it.
 *
 * THE READS ARE ALREADY SCOPED BY THE HANDLE AND THIS INTERFACE CARRIES NO
 * IDENTITY PARAMETER. `PayoutBackend.transact` is handed the session, so an
 * implementation binds the identity once and `subject()` returning `null` is
 * the 404 that API_CONTRACT section 1 requires for a resource the caller does
 * not own.
 */
export interface PayoutTx {
  /**
   * `INV-M20-01`'s per-identity lock, held until this transaction ends.
   *
   * IT IS THE FIRST THING `decidePayout` DOES AND THE ORDER IS THE CONTROL.
   * `ADR-293` section 3.5: `G-NO-IN-FLIGHT` is READ through {@link subject},
   * DECIDED in memory and the row is WRITTEN against that decision, and the
   * clamp on `approved_cents` is the second read-then-write and the money one.
   * A gate evaluated before the lock is evaluated against a state another
   * transaction can still change. `payout_requests_no_in_flight_uq`
   * (`0031_payout_hold_and_identity_restriction.sql`) is a BACKSTOP and not the
   * control: unlocked, the loser of a race reaches the insert and takes a
   * unique violation, which is not a {@link PayoutBackendUnwired}, is not
   * caught by `unwiredOrThrow`, and is therefore a 500 where API_CONTRACT
   * section 6 names a 409.
   *
   * IT TAKES NO ARGUMENT, AND THAT IS THE WHOLE OF ITS SAFETY. It locks the
   * identity this handle is already bound to, so there is no address here to
   * point at somebody else. An implementation is `ScopedTx.lockScope` and
   * nothing else; an advisory lock through `sqlExecutor` is refused by name in
   * `ADR-157` and is not reachable from this file. `WithdrawalTx.lockScope`
   * (`wallet-withdrawals.ts`) and `CheckoutTx.lockScope` (`checkout.ts`) are
   * the two independent precedents and both are worded this way.
   *
   * IT IS NOT A LINE INSIDE `PayoutBackend.transact` AND `ADR-293` SECTION 3.4
   * IS WHY. No adapter in this tree locks inside `transact`: both existing ones
   * expose the member and their DECISION FUNCTION calls it. A lock hidden in
   * `transact` would put the ordering that makes the gate a control outside the
   * one function a reader checks orderings in, which is the ordered function
   * API_CONTRACT section 6's sentence is transcribed into.
   */
  lockScope(): Promise<void>;

  /**
   * `identities.status` for the caller. `ADR-140`'s door.
   *
   * IT TAKES NO ACCOUNT AND THAT IS THE RULING IN THE SIGNATURE. The refusal is
   * a fact about the human and is evaluated before anything about the account
   * is read, so a method that took an account id could not be called in the
   * right order.
   */
  identityStatus(): Promise<IdentityStatus>;

  /**
   * The account, or `null` for one this handle cannot see. Section 1's 404.
   *
   * **THE OWNERSHIP ANSWER COMES BEFORE THE STATE READ AND THAT IS `ADR-285`
   * RULING 4.** `RuleStateAbsent` now leaves this route as a 503, so an
   * implementation that read `rule_states` ahead of the account would answer a
   * prober 503 for every account of another identity rather than 404. The
   * `state` docblock above carries the whole argument.
   */
  subject(accountId: string): Promise<PayoutSubject | null>;

  /** `G-HOLD-REQUIRED`, resolved. `null` when no flag stands. */
  holdFlag(accountId: string): Promise<HoldFlag | null>;

  /**
   * Write the request.
   *
   * IT RETURNS NOTHING AND ADR-289 IS WHY. This member used to promise
   * `{ eligibilitySnapshotId }` and nothing in this repository could supply
   * one: the stored proof is `eligibility_snapshot jsonb NOT NULL`
   * (`0010_payouts.sql:74`) and that migration refuses a separate identity for
   * it in its own words, because a join here "would add a way for THE PROOF AND
   * THE DECISION to disagree". The proof is addressed by `payout_request_id`,
   * which the response already carries. A return value nothing can produce is
   * an invitation to an adapter to invent one, on the money path.
   *
   * THE LAST WRITE ON THIS PATH, AND THAT IS ADR-176 IN THE INTERFACE. What
   * this transaction commits is the APPROVAL; the `LT-01` posting is performed
   * at a system authority, so there is no ledger handle on this port and no
   * member of this interface that a scoped door cannot serve.
   */
  insertPayoutRequest(row: PayoutRequestInsert): Promise<void>;
}

/** What opens a transaction, plus the store the idempotency layer needs. */
export interface PayoutBackend {
  /** Run `fn` on one transaction. IT COMMITS ONLY IF `fn` RETURNS. */
  transact<T>(session: AuthSession, fn: (tx: PayoutTx) => Promise<T>): Promise<T>;

  /** `GET /payouts`, scoped to the caller. Read only, outside any write path. */
  listPayouts(session: AuthSession): Promise<readonly PayoutListItem[]>;

  /**
   * `idempotency_keys`, which is read and stamped OUTSIDE the payout
   * transaction.
   *
   * DELIBERATELY NOT A METHOD ON `PayoutTx`. The key is claimed before the
   * handler runs and stamped after it commits: a claim that rolled back with a
   * failed request would be re-claimable, which is the retry becoming a second
   * payout that `INV-M5-06` exists to prevent.
   */
  readonly idempotency: IdempotencyStore;
}

/** Thrown by the unwired backend. Answered as 503 rather than 500. */
export class PayoutBackendUnwired extends Error {
  constructor(method: string) {
    super(
      `PayoutBackend.${method} is not wired. The payout routes are declared and their ` +
        'persistence is not installed, so this deployment answers 503 rather than approving a ' +
        'payout it cannot record or post',
    );
    this.name = 'PayoutBackendUnwired';
  }
}

const UNWIRED_STORE: IdempotencyStore = {
  find: () => Promise.reject(new PayoutBackendUnwired('idempotency.find')),
  begin: () => Promise.reject(new PayoutBackendUnwired('idempotency.begin')),
  complete: () => Promise.reject(new PayoutBackendUnwired('idempotency.complete')),
};

/**
 * A backend that refuses every call.
 *
 * ON `routes/auth.ts`'s AND `routes/checkout.ts`'s PRECEDENT AND FOR THEIR
 * REASON: a backend that returned plausible values would be a fixture serving
 * real traffic, and on THIS route it would be a fixture approving payouts. The
 * routes are REGISTERED because the contract rows exist; a missing route would
 * answer 404 and look like a contract Merit never wrote.
 */
export const UNWIRED_PAYOUT_BACKEND: PayoutBackend = {
  transact: () => Promise.reject(new PayoutBackendUnwired('transact')),
  listPayouts: () => Promise.reject(new PayoutBackendUnwired('listPayouts')),
  idempotency: UNWIRED_STORE,
};

let backend: PayoutBackend = UNWIRED_PAYOUT_BACKEND;

/** Install the backend. The wiring slice calls this; so does the suite. */
export function usePayoutBackend(next: PayoutBackend): void {
  backend = next;
}

/** Restore the fail-closed default. */
export function resetPayoutBackend(): void {
  backend = UNWIRED_PAYOUT_BACKEND;
}

/** The installed backend. */
export function currentPayoutBackend(): PayoutBackend {
  return backend;
}

// -----------------------------------------------------------------------------
// Money at the boundary. Two functions, and both refuse rather than round.
// -----------------------------------------------------------------------------

/** Raised when a value on the money path is not integer cents. */
export class PayoutMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayoutMoneyError';
  }
}

/**
 * A JSON integer to `bigint` cents, or `null`.
 *
 * IT REFUSES A NON-INTEGER RATHER THAN TRUNCATING ONE. `99.5` is not a number
 * of cents, and it is exactly the value the constitution bans; `BigInt(99.5)`
 * throws a `RangeError` that would surface as a 500 where `validation_failed`
 * is correct, so the check is explicit and its refusal is a 400.
 */
export function centsFromJson(value: unknown): Cents | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return BigInt(value);
}

/**
 * `bigint` cents back to a JSON integer.
 *
 * IT THROWS PAST `Number.MAX_SAFE_INTEGER` RATHER THAN SERIALISING A WRONG
 * NUMBER. The columns are `bigint`, so a value that cannot be a JSON integer is
 * expressible in the schema; at 2^53 cents that is ninety trillion dollars and
 * will not happen, which is a reason to assert it cheaply rather than skip it.
 */
export function centsToJson(value: Cents): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new PayoutMoneyError(
      `${value.toString()} cents cannot be a JSON integer; API_CONTRACT section 1 says ` +
        '*_cents are JSON integers',
    );
  }
  return Number(value);
}

// -----------------------------------------------------------------------------
// Problem documents. Section 2's codes a handler computes.
// -----------------------------------------------------------------------------

interface ProblemDocument extends Problem {
  readonly detail?: string;
  readonly errors?: readonly FieldError[];
  /** Section 6: `payout_not_eligible` carries the FULL breakdown. */
  readonly gates?: GateBreakdown;
}

function sendProblem(reply: FastifyReply, body: ProblemDocument): FastifyReply {
  return reply.code(body.status).type(PROBLEM_MEDIA_TYPE).send(body);
}

/**
 * A code section 2 defines that `server.ts`'s closed `TITLE` table does not
 * carry, because that table holds the codes the TRANSPORT can produce.
 */
function handlerProblem(
  code: string,
  title: string,
  status: number,
  instance: string,
): ProblemDocument {
  return { type: `${PROBLEM_TYPE_PREFIX}${code}`, title, status, code, instance };
}

/** Section 2: "The identity is restricted." `ADR-140`'s answer. */
export const IDENTITY_RESTRICTED = 'identity_restricted';
/** Section 2: gates not satisfied; the body carries the full breakdown. */
export const PAYOUT_NOT_ELIGIBLE = 'payout_not_eligible';

/** A refusal decided inside the transaction, carried out of it. */
export interface Refusal {
  readonly send: (reply: FastifyReply, requestId: string) => FastifyReply;
}

function refuse(code: string, title: string, status: number, detail?: string): Refusal {
  return {
    send: (reply, requestId) =>
      sendProblem(reply, {
        ...handlerProblem(code, title, status, requestId),
        ...(detail === undefined ? {} : { detail }),
      }),
  };
}

/** Thrown so a refusal decided mid-transaction rolls the transaction back. */
class RefusalThrown extends Error {
  readonly refusal: Refusal;
  constructor(refusal: Refusal) {
    super('payout refused');
    this.name = 'RefusalThrown';
    this.refusal = refusal;
  }
}

// -----------------------------------------------------------------------------
// `ADR-140`. The identity-status door.
// -----------------------------------------------------------------------------

/**
 * `G-ELIGIBLE`'s identity-status term, as a refusal rather than a gate.
 *
 * THE PREDICATE IS `=== 'active'` AND NOT A LIST OF WHAT IS REFUSED. Those two
 * are equivalent over today's three-member enum and they STOP being equivalent
 * the moment a fourth value lands, and at that moment the enumerate-the-
 * refusals form fails OPEN on an outbound door. ADR-062 section 1's third
 * alternative was rejected on exactly this and `ADR-140` inherits the reasoning
 * rather than re-deciding it.
 *
 * THE CODE IS `identity_restricted` FOR BOTH REFUSED VALUES, and the
 * imprecision is recorded rather than smoothed: a `closed` identity is not
 * restricted, and the code's name says it is. API_CONTRACT section 2's code
 * table is CLOSED, so a sixth spelling would be a ruling this session did not
 * take; the `detail` carries the fact the code cannot. `ADR-140` carries the
 * open question.
 *
 * `forbidden` WAS THE RUNNER-UP AND IS REJECTED. `checkout.ts`'s `gateIdentity`
 * answers 403 for the same predicate, which makes it the incumbent shape and
 * makes it worth naming why this route does not follow it: on THIS surface a
 * 403 is what an unelevated session gets, and it arrives carrying
 * `required_factor` so the client can offer the ceremony. A client that met a
 * 403 here would offer a passkey prompt to a human whose problem no factor
 * solves. API_CONTRACT section 2 also says in terms that checkout and payouts
 * "all refuse with this one code rather than with five near-synonyms", so
 * `checkout.ts` is the file that diverges from the contract, not this one. That
 * is reported and is not repaired here: `checkout.ts` is outside this fence.
 */
export function gateIdentityStatus(status: IdentityStatus): Refusal | null {
  if (status === 'active') return null;
  return refuse(
    IDENTITY_RESTRICTED,
    'Identity restricted',
    422,
    `This identity is ${status} and cannot request a payout.`,
  );
}

// -----------------------------------------------------------------------------
// The gate breakdown, projected field by field
// -----------------------------------------------------------------------------

/**
 * `PayoutEvaluation.gates` in API_CONTRACT section 6's shape.
 *
 * IT IS AN ALLOWLIST AND THE COPY IS THE POINT. Section 1: "Responses list
 * fields explicitly (allowlist), never `SELECT *` serialized." A spread of the
 * engine's gate objects would ship `capCents` on `minimum_amount`, which the
 * contract does not declare, the day the engine adds a field.
 *
 * `minimumAmountPass` IS PASSED IN RATHER THAN READ OFF THE EVALUATION, and
 * that is the one place this projection is not a transcription. See
 * `minimumAmountHolds`.
 */
export function projectGates(
  evaluation: PayoutEvaluation,
  minimumAmountPass: boolean,
): GateBreakdown {
  const g = evaluation.gates;
  return {
    account_active: { pass: g.accountActive.pass },
    kyc_verified: { pass: g.kycVerified.pass, state: g.kycVerified.state },
    not_frozen: { pass: g.notFrozen.pass, reason: g.notFrozen.reason },
    recon_clear: { pass: g.reconClear.pass },
    traded_days: { pass: g.tradedDays.pass, have: g.tradedDays.have, need: g.tradedDays.need },
    win_days: {
      pass: g.winDays.pass,
      have: g.winDays.have,
      need: g.winDays.need,
      floor_cents: centsToJson(g.winDays.floorCents),
    },
    buffer: {
      pass: g.buffer.pass,
      have_cents: centsToJson(g.buffer.haveCents),
      need_cents: centsToJson(g.buffer.needCents),
    },
    consistency: {
      pass: g.consistency.pass,
      skipped: g.consistency.skipped,
      best_day_share_bp: g.consistency.bestDayShareBp,
      max_bp: g.consistency.maxDayShareBp,
      profit_needed_to_dilute_cents: centsToJson(g.consistency.profitNeededToDiluteCents),
    },
    cadence_gap: {
      pass: g.cadenceGap.pass,
      days_since_last_payout: g.cadenceGap.tradingDaysSinceLastPayout,
      need: g.cadenceGap.need,
      next_eligible_trading_day: g.cadenceGap.nextEligibleTradingDay,
    },
    minimum_amount: {
      pass: minimumAmountPass,
      withdrawable_cents: centsToJson(g.minimumAmount.withdrawableCents),
      min_payout_cents: centsToJson(g.minimumAmount.minPayoutCents),
    },
  };
}

/**
 * `G-CLAMP`'s SECOND clause, which is the route's and not the engine's.
 *
 * `MinimumAmountGate` is an ENGINE gate. It is computed at day advance over
 * `min(withdrawable, cap) >= min_payout_cents` and it has never seen the
 * caller's `amount_cents`, because the caller had not asked yet. `G-CLAMP` is
 * "`approved_cents = min(effective_request, withdrawable, cap)` AND
 * `approved_cents >= min_payout_cents`", and API_CONTRACT section 6 states the
 * consequence: "a supplied amount that clamps below the minimum returns
 * `payout_not_eligible` with `minimum_amount` failing, never a partial payment
 * and never a denial."
 *
 * SO THE CONJUNCTION IS TAKEN HERE AND THE CELL REPORTS IT. The engine's own
 * verdict is kept as the left operand rather than replaced: a request that
 * fails the gate on withdrawable alone must still say so when the caller
 * supplied nothing.
 */
export function minimumAmountHolds(evaluation: PayoutEvaluation): boolean {
  return (
    evaluation.gates.minimumAmount.pass &&
    evaluation.clamp.approvedCents >= evaluation.minPayoutCents
  );
}

// -----------------------------------------------------------------------------
// `LT-01`, built and never computed
// -----------------------------------------------------------------------------

/**
 * M05 section 2.1's `LT-01`, `payout_approval`.
 *
 *   debit  `trader_withdrawable` (identity)  `approved_cents`
 *   credit `trader_wallet`       (identity)  `trader_cents`
 *   credit `fees_revenue`        (firm)      `firm_cents`
 *
 * THE TABLE'S THREE ENTRIES ARE WRITTEN AS TWO TRANSFERS AND THEREFORE FOUR
 * ENTRIES, AND THAT IS A PROPERTY OF `ADR-104` RULING 1 RATHER THAN A CHOICE
 * MADE HERE. "An entry is never constructed. A `Transfer` is, and every
 * transfer yields exactly two entries." A one-debit two-credit posting is
 * therefore UNREPRESENTABLE in this library, by the same construction that
 * makes the imbalance unrepresentable. The two debits are both against
 * `trader_withdrawable` and in the SAME direction, which `posting()` admits in
 * terms -- "`LEDGER-C1` refuses OPPOSITE signs and says nothing about two
 * debits ... which is what a fee and a principal against one treasury account
 * are" -- and they sum to `approved_cents` exactly, because `trader_cents +
 * firm_cents = approved_cents` is `INV-M5-03`.
 *
 * SO THE INVARIANT THE SHAPE DEPENDS ON IS ASSERTED HERE RATHER THAN ASSUMED.
 * `INV-M5-03` is enforced by a CHECK constraint on `payout_requests` and by the
 * engine's R-44, and neither of those runs between the engine returning a split
 * and this function turning it into two legs. If the two halves did not sum,
 * the total debit against the withdrawable position would silently stop being
 * `approved_cents` while every posting still balanced. That is the class of
 * error `LEDGER-C1` exists for, one level up, and it is checkable, so it is
 * checked.
 *
 * THE DEBIT IS `trader_withdrawable` AND NOT `firm_treasury`, and M05 says why
 * in terms: `firm_treasury` "books a cash movement at approval, which
 * contradicts the ruled recognition timing that payout liability books at
 * approval and cash derecognizes at settlement". That error has been made in
 * this repository once already.
 *
 * `firm_cents` IS RECOGNIZED AT APPROVAL and not held in suspense until
 * settlement, deliberately: "the firm's share is earned when the payout is
 * approved, and holding it in suspense until settlement would make the revenue
 * line depend on a payment rail's latency" (M05 section 2.1, ruled at the batch
 * 1 gate).
 */
export function lt01(args: {
  readonly identityId: string;
  readonly payoutRequestId: string;
  readonly idempotencyKey: string;
  readonly approvedCents: Cents;
  readonly traderCents: Cents;
  readonly firmCents: Cents;
}): Posting {
  if (args.traderCents + args.firmCents !== args.approvedCents) {
    throw new PayoutMoneyError(
      `INV-M5-03: trader_cents + firm_cents must equal approved_cents exactly, and ` +
        `${args.traderCents.toString()}c + ${args.firmCents.toString()}c is not ` +
        `${args.approvedCents.toString()}c. LT-01 debits the withdrawable position once per ` +
        'leg, so a split that does not sum would post a total debit that is not the amount ' +
        'approved, and every leg would still balance.',
    );
  }
  return posting(
    {
      kind: 'payout_approval',
      referenceKind: 'payout_request',
      referenceId: args.payoutRequestId,
      idempotencyKey: args.idempotencyKey,
    },
    [
      transfer(
        identityAccount('trader_withdrawable', args.identityId),
        identityAccount('trader_wallet', args.identityId),
        args.traderCents,
        'LT-01 payout approval: the trader half',
      ),
      transfer(
        identityAccount('trader_withdrawable', args.identityId),
        firmAccount('fees_revenue'),
        args.firmCents,
        'LT-01 payout approval: the firm share, recognized at approval',
      ),
    ],
  );
}

// -----------------------------------------------------------------------------
// Validation. Total over the one shape section 6 declares, and hand written.
// -----------------------------------------------------------------------------

type Validated<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly FieldError[] };

function asRecord(body: unknown): Record<string, unknown> | null {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

/**
 * Section 6's body, which has ONE optional member.
 *
 * AN ABSENT BODY IS VALID AND IS THE COMMON PATH. ADR-009: omitting the field
 * means "pay the maximum I am eligible for", which is the number the
 * eligibility endpoint already displayed. A body carrying anything else is
 * dropped rather than refused, for `checkout.ts`'s reason: what is not in the
 * declared shape reaches nothing that could read it.
 *
 * `validation_failed` IS THE ANSWER FOR A NON-INTEGER, ZERO OR NEGATIVE AMOUNT,
 * which is API_CONTRACT section 6's own error list.
 */
export function validatePayoutRequest(body: unknown): Validated<PayoutRequestBody> {
  if (body === undefined || body === null || body === '') return { ok: true, value: {} };
  const row = asRecord(body);
  if (row === null) return { ok: false, errors: [{ path: '', message: 'body must be an object' }] };

  if (
    !Object.prototype.hasOwnProperty.call(row, 'amount_cents') ||
    row['amount_cents'] === undefined
  )
    return { ok: true, value: {} };

  const cents = centsFromJson(row['amount_cents']);
  if (cents === null)
    return {
      ok: false,
      errors: [{ path: 'amount_cents', message: 'must be an integer number of cents' }],
    };
  if (cents <= 0n)
    return { ok: false, errors: [{ path: 'amount_cents', message: 'must be greater than zero' }] };
  return { ok: true, value: { amount_cents: Number(cents) } };
}

/**
 * `Idempotency-Key`, which section 1 makes REQUIRED on this endpoint.
 *
 * ITS ABSENCE IS A `validation_failed` AND NOT A SILENT NON-IDEMPOTENT RUN. A
 * required header a server treats as optional is a retry that becomes a second
 * payout, which is `INV-M5-06`.
 */
export function idempotencyKeyOf(request: FastifyRequest): string | null {
  const raw = request.headers['idempotency-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

// -----------------------------------------------------------------------------
// The approval, assembled
// -----------------------------------------------------------------------------

/** SD-M5-01 and ADR-040's clock. 48 WALL-CLOCK hours; Merit computes nothing in business days. */
export const HOLD_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Section 6's `estimated_settlement`.
 *
 * A CONSTANT, AND IT IS THE RAIL'S PROPERTY RATHER THAN THIS ACCOUNT'S. It is
 * declared here because the contract declares the field and nothing in this
 * tree publishes the rail's SLA; a route that derived it from an account would
 * be inventing a number the trader would read as a promise.
 */
export const ESTIMATED_SETTLEMENT = { min_business_days: 1, max_business_days: 3 } as const;

function holdBlockOf(row: PayoutRequestInsert): PayoutHold | null {
  return row.hold === null
    ? null
    : {
        held_at: row.hold.heldAt,
        resolves_by: row.hold.holdExpiresAt,
        tos_clause: row.hold.holdTosClause,
      };
}

/**
 * The evaluation, serialized for `payout_requests.eligibility_snapshot`.
 *
 * `INV-22`: "the snapshot is what was true when the money moved, and an upgrade
 * cannot retroactively make a payment wrong." Every `bigint` becomes a JSON
 * integer through `centsToJson`, which refuses rather than rounds, so a
 * snapshot can never hold a float.
 */
export function snapshotOf(evaluation: PayoutEvaluation, minimumAmountPass: boolean): JsonValue {
  return {
    as_of_trading_day: evaluation.asOfTradingDay,
    engine_eligible: evaluation.engineEligible,
    context_eligible: evaluation.contextEligible,
    eligible: evaluation.eligible,
    no_payout_in_flight: evaluation.noPayoutInFlight.pass,
    max_payout_cents: centsToJson(evaluation.maxPayoutCents),
    cap_cents: centsToJson(evaluation.capCents),
    min_payout_cents: centsToJson(evaluation.minPayoutCents),
    ordinal: evaluation.ordinal,
    clamp: {
      effective_request_cents: centsToJson(evaluation.clamp.effectiveRequestCents),
      approved_cents: centsToJson(evaluation.clamp.approvedCents),
      reason: evaluation.clamp.reason,
      trader_cents: centsToJson(evaluation.clamp.traderCents),
      firm_cents: centsToJson(evaluation.clamp.firmCents),
      split_bp: evaluation.clamp.splitBp,
    },
    gates: projectGates(evaluation, minimumAmountPass) as unknown as JsonValue,
  } as unknown as JsonValue;
}

/**
 * The whole ordered server behavior, inside one transaction.
 *
 * THE LOCK IS FIRST AND EVERY GATE BELOW IS DECIDED UNDER IT. `ADR-293` section
 * 3.5, on `decideWithdrawal`'s placement and `checkout.ts`'s: a gate evaluated
 * before the lock is evaluated against a state another transaction can still
 * change, and `G-NO-IN-FLIGHT` below is read, decided and written against in
 * that order. THIS DOES NOT DISTURB `ADR-140`, which orders the identity-status
 * refusal ahead of everything read ABOUT THE ACCOUNT: `lockScope()` reads
 * nothing about the account and takes no address, and putting it first
 * additionally puts `identityStatus()`'s own read under the lock, which is
 * strictly the safer of the two orders.
 *
 * THE ORDER IS API_CONTRACT SECTION 6's SENTENCE WITH `ADR-140`'s DOOR AHEAD OF
 * IT. "Server behavior, in order: re-evaluate eligibility against the last
 * closed day, resolve the effective request, clamp server-side, persist the
 * immutable snapshot, post the ledger transaction, approve, enqueue the
 * transfer." The identity-status refusal precedes all of it and reads nothing
 * about the account, per `ADR-140` and on `INV-M5-23`'s placement argument.
 *
 * ONE STEP OF THAT SENTENCE IS NO LONGER PERFORMED HERE AND ADR-176 SAYS SO
 * RATHER THAN LEAVING THE SENTENCE TO BE READ AGAINST A FUNCTION THAT STOPPED
 * MATCHING IT. "Post the ledger transaction" happens at a system authority
 * (ADR-172 clause 2 and clause 3), for the reason this file's header sets out:
 * the only handle satisfying `LedgerTx` is generic over the whole estate. The
 * contract's WIRE SHAPE is untouched -- `PayoutResponse` carried no ledger
 * transaction id and `estimated_settlement` was already a business-day range,
 * so no field of section 6's response changes and no client can observe the
 * difference. Whether section 6's PROSE is amended is a founder question and
 * ADR-176 asks it rather than editing a frozen document.
 *
 * THIS FUNCTION NO LONGER TAKES THE SESSION, WHICH IS `PayoutTx`'s OWN RULE
 * APPLIED. That interface "carries no identity parameter" because the handle is
 * already bound to one; the identity was read here only to name `LT-01`'s
 * trader leg, and with the posting gone there is nothing on this path that an
 * identity supplied out of band could address.
 */
async function decidePayout(args: {
  readonly tx: PayoutTx;
  readonly accountId: string;
  readonly requestedCents: Cents | null;
  readonly idempotencyKey: string;
  readonly at: Date;
}): Promise<PayoutResponse | Refusal> {
  const { tx, accountId, requestedCents, idempotencyKey, at } = args;

  await tx.lockScope();

  // `ADR-140`. NOTHING ABOUT THE ACCOUNT HAS BEEN READ AT THIS LINE.
  const identityGate = gateIdentityStatus(await tx.identityStatus());
  if (identityGate !== null) return identityGate;

  // Section 1's 404: a path parameter naming a resource the caller does not own
  // returns 404 and never 403, so this API does not confirm the existence of
  // other people's resources. The handle is scoped, so this function cannot
  // tell a foreign account from an absent one, which is the point.
  const subject = await tx.subject(accountId);
  if (subject === null) return refuse('not_found', 'Not found', 404);

  // `INV-M5-02`: the number shown by `GET /eligibility` and the number sent by
  // `POST /payout` come from the SAME FUNCTION with the same inputs. A second
  // evaluator here would be a second rule.
  const evaluation = evaluatePayout(subject.state, subject.plan, {
    gates: subject.gates,
    requestedCents,
  });

  // `G-NO-IN-FLIGHT`, reported beside the breakdown because the contract's
  // `gates` has no slot for it, and answered `409 conflict` because section 6
  // names it there: "a payout is already in flight for this account, AND A HELD
  // REQUEST IS IN FLIGHT". It is a liability control and not a convenience.
  if (!evaluation.noPayoutInFlight.pass)
    return refuse('conflict', 'Conflict', 409, 'A payout is already in flight for this account.');

  const minimumAmountPass = minimumAmountHolds(evaluation);
  if (!evaluation.eligible || !minimumAmountPass) {
    const gates = projectGates(evaluation, minimumAmountPass);
    return {
      send: (reply, requestId) =>
        sendProblem(reply, {
          ...handlerProblem(PAYOUT_NOT_ELIGIBLE, 'Payout not eligible', 422, requestId),
          gates,
        }),
    };
  }

  const clamp = evaluation.clamp;
  const payoutRequestId = randomUUID();
  const flag = await tx.holdFlag(accountId);

  const row: PayoutRequestInsert = {
    id: payoutRequestId,
    accountId: subject.accountId,
    idempotencyKey,
    status: flag === null ? 'approved' : 'held_pending_review',
    basisTradingDay: evaluation.asOfTradingDay,
    ordinal: evaluation.ordinal,
    requestedCents: clamp.effectiveRequestCents,
    approvedCents: clamp.approvedCents,
    traderCents: clamp.traderCents,
    firmCents: clamp.firmCents,
    splitBp: clamp.splitBp,
    clampReason: clamp.reason,
    eligibilitySnapshot: snapshotOf(evaluation, minimumAmountPass),
    // SD-M5-08: all five hold columns together or none, which
    // `payout_requests_hold_is_complete` makes unwritable otherwise. A hold
    // with a flag and no clock is the indefinite hold the whole fold exists to
    // prevent, and a hold with a clock and no flag is one nobody can justify.
    hold:
      flag === null
        ? null
        : {
            heldAt: at.toISOString(),
            holdExpiresAt: new Date(at.getTime() + HOLD_WINDOW_MS).toISOString(),
            holdFlagId: flag.flagId,
            holdTosClause: flag.tosClause,
            holdReason: flag.reason,
          },
  };

  await tx.insertPayoutRequest(row);

  // THE POSTING USED TO BE HERE, GUARDED BY `flag === null`, AND ADR-176 MOVED
  // IT OFF THIS PATH RATHER THAN DELETING IT. `PayoutTx` no longer carries a
  // `LedgerTx`, because the only handle that satisfies one is generic over
  // every table in the estate and a request handler must not hold it. This
  // file's header carries the whole argument and ADR-172 clause 2 is the
  // ruling.
  //
  // `INV-M5-21` IS NOT WEAKENED AND ITS ENFORCEMENT MOVES WITH THE POSTING. A
  // HELD REQUEST MUST POST NOTHING: no ledger transaction, no wallet credit,
  // no anchor advance, no win-day reset, because the ledger is the
  // discriminator between `held_pending_review` and `frozen` and is what makes
  // release mean "approve and pay" rather than "let settlement proceed". At
  // request time NOTHING posts now, so the invariant holds here trivially and
  // BINDS ON THE DRIVER: the system-authority job ADR-172 section 5 names must
  // select on `status = 'approved'`, and a driver that posted for a
  // `held_pending_review` row would be the violation. That is stated where it
  // can be checked rather than assumed, and no such driver exists yet.
  //
  // THE KEY IS NOW WRITTEN TO THE ROW, AND THAT IS THE HALF OF THIS RULING THAT
  // IS A REPAIR RATHER THAN A REMOVAL. `PayoutRequestInsert` GAINED
  // `idempotencyKey` here: while the posting stood above, the key reached it
  // out of this function's memory and no field of the insert shape carried it,
  // so an approval committed with nothing a later door could read. Every door
  // that posts `LT-01` rebuilds `` `${PAYOUT_ENDPOINT} ${key}` `` from
  // `payout_requests.idempotency_key`, `text NOT NULL`
  // (`0010_payouts.sql:82`), against `ledger_transactions.idempotency_key`,
  // `text NOT NULL UNIQUE`. THE DATABASE IS WHAT REFUSES A SECOND POSTING, and
  // it can only do that because the key survives in a column.
  //
  // Every money field below is still populated, because the decision is
  // computed and FROZEN at request time and only the posting is deferred:
  // release re-evaluates nothing (`INV-M5-02`), so the number shown is the
  // number sent.

  return {
    payout_request_id: payoutRequestId,
    status: row.status,
    requested_cents: centsToJson(clamp.effectiveRequestCents),
    amount_supplied: requestedCents !== null,
    approved_cents: centsToJson(clamp.approvedCents),
    clamp_reason: clamp.reason,
    trader_cents: centsToJson(clamp.traderCents),
    firm_cents: centsToJson(clamp.firmCents),
    split_bp: clamp.splitBp,
    basis_trading_day: evaluation.asOfTradingDay,
    payout_ordinal: evaluation.ordinal,
    estimated_settlement: ESTIMATED_SETTLEMENT,
    hold: holdBlockOf(row),
  };
}

// -----------------------------------------------------------------------------
// The endpoints
// -----------------------------------------------------------------------------

/**
 * API_CONTRACT section 6, in the document's order.
 *
 * BOTH ROWS DECLARE `session` AND NEITHER DECLARES A `c27` ACTION. See this
 * file's header: a payout REQUEST is not a destination change and is not the
 * external withdrawal, and section 12 rows this endpoint "Auth: session, owner".
 * The `owner` half is the 404 above and not a factor.
 */
export const PAYOUT_ENDPOINTS: readonly EndpointSpec[] = [
  {
    method: 'GET',
    path: PAYOUTS_PATH,
    required: 'session',
    handle: withSessionContext(async ({ request, reply, session }) => {
      try {
        return await currentPayoutBackend().listPayouts(session);
      } catch (err) {
        return unwiredOrThrow(err, request, reply);
      }
    }),
  },
  {
    method: 'POST',
    path: PAYOUT_PATH,
    required: 'session',
    handle: withSessionContext(async ({ request, reply, session }) => {
      const key = idempotencyKeyOf(request);
      if (key === null) {
        return sendProblem(reply, {
          ...problem('validation_failed', 400, request.id),
          errors: [
            {
              path: 'Idempotency-Key',
              message: 'this header is required on POST /accounts/:accountId/payout',
            },
          ],
        });
      }

      const validated = validatePayoutRequest(request.body);
      if (!validated.ok) {
        return sendProblem(reply, {
          ...problem('validation_failed', 400, request.id),
          errors: validated.errors,
        });
      }

      const accountId = (request.params as { accountId?: string }).accountId ?? '';
      const requested = validated.value.amount_cents;
      const requestedCents = requested === undefined ? null : BigInt(requested);
      const at = new Date();
      const active = currentPayoutBackend();
      const scope = identityScope(session.identityId);

      let outcome: IdempotencyOutcome;
      try {
        // OVER THE RAW BYTES AND NEVER OVER A PARSED BODY RE-SERIALISED. Two
        // JSON documents that parse equal can serialise differently, so a hash
        // taken after a parse makes "an identical body" a property of this
        // process's serialiser rather than of what the client sent.
        outcome = await beginIdempotent(
          active.idempotency,
          scope,
          PAYOUT_ENDPOINT,
          key,
          rawBodyOf(request),
        );
      } catch (err) {
        return unwiredOrThrow(err, request, reply);
      }

      // Section 1: "Replaying a key with an identical body returns the original
      // response VERBATIM." M05 section 4 states the reason this route cannot
      // simply re-run: "re-evaluating a retry is how a trader's retry becomes a
      // different payout."
      if (outcome.kind === 'replay') {
        return reply.code(outcome.status).send(outcome.body);
      }
      const refusalDoc = problemForOutcome(outcome, request.id);
      if (refusalDoc !== null) return sendProblem(reply, refusalDoc);
      if (outcome.kind !== 'fresh') {
        /* c8 ignore next 2 */
        throw new Error('unreachable: every non-fresh outcome is a replay or a problem');
      }

      let response: PayoutResponse;
      try {
        response = await active.transact(session, async (tx) => {
          const decided = await decidePayout({
            tx,
            accountId,
            requestedCents,
            idempotencyKey: key,
            at,
          });
          // A REFUSAL DECIDED INSIDE THE TRANSACTION IS THROWN OUT OF IT rather
          // than returned, so the transaction rolls back whatever it had
          // already written. Nothing here writes before a refusal today, and
          // relying on that ordering rather than on the rollback would make the
          // property depend on the order of the next edit.
          if ('send' in decided) throw new RefusalThrown(decided);
          return decided;
        });
      } catch (err) {
        if (err instanceof RefusalThrown) {
          // THE KEY IS NOT STAMPED ON A REFUSAL AND THAT IS DELIBERATE. Section
          // 1's replay rule is about a request that produced a response the
          // client lost; a refused request left no payout, and stamping it
          // would make a trader who fixed the cause and retried with the same
          // key read their own old refusal back.
          return err.refusal.send(reply, request.id);
        }
        // `ADR-285`. THE ONLY PLACE THIS CAN ARRIVE, AND IT IS NOT FOLDED INTO
        // `unwiredOrThrow`: the idempotency store cannot raise it, so a shared
        // helper would claim a path that does not exist. `RuleStateUnreadable`
        // is DELIBERATELY not caught here and stays a 500, because a row whose
        // columns disagree with the schema that wrote them is an internal error
        // and telling a trader to retry it would be telling them to retry
        // something no retry can fix.
        if (err instanceof RuleStateAbsent) return stateNotFolded(err, request, reply);
        return unwiredOrThrow(err, request, reply);
      }

      try {
        await completeIdempotent(
          active.idempotency,
          scope,
          outcome,
          200,
          response as unknown as JsonValue,
        );
      } catch (err) {
        return unwiredOrThrow(err, request, reply);
      }
      return response;
    }),
  },
];

/**
 * The raw request body, for the idempotency hash.
 *
 * Fastify parses JSON before a handler runs, so the bytes are recovered from
 * `request.rawBody` when a deployment installs a capture hook and from a
 * canonical re-serialisation otherwise. THE LIMITATION IS STATED RATHER THAN
 * HIDDEN: without the hook, two bodies that parse equal and serialise
 * differently hash the same, which makes the `idempotency_key_reuse` check
 * slightly WEAKER than section 1 specifies and never stronger. An empty body is
 * the empty byte string, which is the common path on this endpoint.
 */
function rawBodyOf(request: FastifyRequest): Uint8Array {
  const raw = (request as { rawBody?: unknown }).rawBody;
  if (raw instanceof Uint8Array) return raw;
  if (typeof raw === 'string') return new TextEncoder().encode(raw);
  if (request.body === undefined || request.body === null) return new Uint8Array(0);
  return new TextEncoder().encode(JSON.stringify(request.body));
}

/**
 * THE DAY THE NIGHTLY FOLD HAS NOT CLOSED, ANSWERED HONESTLY. `ADR-285`.
 *
 * **THIS IS THE ARM `ADR-281` RULING 3 FOUND MISSING AND `ADR-283` RANKED
 * CHEAPEST OF THE THREE THINGS THIS PORT STILL WAITS ON.** `ruleStateOn`
 * (`../rule-state-reader.ts`) raises `RuleStateAbsent` when no `rule_states`
 * row exists for the account on the last closed trading day, and
 * `unwiredOrThrow` below rethrows everything that is not a
 * `PayoutBackendUnwired`, so before this function a wired backend meeting an
 * unfolded day answered **500** on the door where money leaves the firm. A 500
 * is an internal error from a live-looking route; the fold not having run is
 * neither internal nor an error, and `../rule-state-reader.ts` says so in
 * terms: an absence and a malformed row "are different operational days and the
 * first one is not an error in the estate at all".
 *
 * **IT IS A REFUSAL AND IT IS NOT A DEFAULT STATE.** Nothing here builds a
 * `RuleState`, carries one forward or zeroes one. `RuleStateAbsent` is a class
 * and not an arm; a fabricated state is a payout basis nobody computed, and it
 * is worse than a refusal because it looks like an answer.
 *
 * **THE CODE IS `service_unavailable` BECAUSE API_CONTRACT SECTION 2'S TABLE IS
 * CLOSED**, on `gateIdentityStatus`'s own reasoning above and on
 * `sendTurnstileRefusal`'s (`auth.ts`): a code this repository invents is a
 * contract amendment and not a route. Section 2 defines 503 as *"Dependency
 * down (PSP, Rise), safe to retry"* and the nightly fold is a dependency of
 * this answer, ruled EXTERNAL by `ADR-241` and scheduled outside this
 * repository. Retrying is exactly what the caller should do, which is the half
 * of that row that decides it. **THE OTHER FOUR CANDIDATES ARE REFUSED AND FOR
 * DIFFERENT REASONS.** `payout_not_eligible` would carry `gates` in which every
 * gate passes, which is the false-eligibility-story shape `ADR-140` refused for
 * the identity term one door up. `conflict` and `precondition_failed` both say
 * the client acted, and the client did nothing. `internal_error` is what this
 * arm exists to stop.
 *
 * **NO `Retry-After`.** RFC 9110 permits one on a 503 and this deployment has
 * no honest value to put in it: `ADR-241` ruled the schedule EXTERNAL and
 * registered it in `CRON_INVENTORY`, so a number here would be this repository
 * asserting an operator fact it does not hold.
 *
 * **THE `detail` NAMES THE HEADER BECAUSE "RETRY" ALONE WOULD BE FALSE, AND
 * THAT WAS MEASURED RATHER THAN REASONED.** A refusal is never stamped
 * (`RefusalThrown` below), so the key this request claimed keeps a null
 * response and `classify` (`../idempotency.ts`) calls such a row `in_flight`,
 * which `problemForOutcome` answers **409 `conflict`**. A trader who took the
 * word "retry" literally and resent the same key would meet a conflict rather
 * than the verdict the fold has since produced. That is TRUE OF EVERY REFUSAL
 * THIS ROUTE MAKES and is not created here; it matters here because this is the
 * only refusal that is MERIT'S rather than the caller's, so it is the only one
 * whose remedy is to come back unchanged. `ADR-285` section 6 reports it and
 * does not repair it: `../idempotency.ts` is outside that row's fence and the
 * rule reaches every endpoint that claims a key.
 *
 * **THE `detail` IS GENERIC AND THE DISCRIMINATOR AN OPERATOR NEEDS TRAVELS IN
 * THE LOG.** Section 2: `detail` *"never leaks internals or other users'
 * data"*, and `AuthBackendUnwired` (`auth.ts`) already rules this exact split
 * for the two absences that share this status -- "different facts to an
 * operator, so the reason travels with the error" and "the reason never reaches
 * the response". The account and the day are logged; the body says only what
 * the caller may do about it. It is logged at WARN rather than at ERROR for the
 * reader's own reason: an unfolded day is not a fault in the estate.
 *
 * **AND IT DOES NOT WIRE THIS PORT.** `ADR-256` ruling 12 permits wiring when
 * the last gap is a thing the DEPLOYMENT sets, and two gaps remain that are
 * not: the size row's decoding, and the fact that nothing in this tree
 * implements `PayoutTx` at all. `wiring.test.ts`'s entry names both.
 */
function stateNotFolded(
  err: RuleStateAbsent,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  request.log.warn(
    { err, accountId: err.accountId, tradingDay: err.tradingDay },
    'no rule_states row for the last closed trading day; the nightly fold has not closed it',
  );
  return sendProblem(reply, {
    ...handlerProblem('service_unavailable', 'Service unavailable', 503, request.id),
    detail:
      'Eligibility for the last closed trading day has not been computed for this account yet. ' +
      'Nothing about this request is wrong and no payout decision has been reached. Retry later ' +
      'with a new Idempotency-Key.',
  });
}

/** An unwired backend is a 503 and never a 500. Anything else is the transport's. */
function unwiredOrThrow(err: unknown, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  if (!(err instanceof PayoutBackendUnwired)) throw err;
  request.log.error({ err }, 'payout backend is not wired');
  return sendProblem(
    reply,
    handlerProblem('service_unavailable', 'Service unavailable', 503, request.id),
  );
}

/** The declaration as data, on `auth.ts`'s shape. Section 12's factor column. */
export const PAYOUT_REQUIRED_FACTORS = requiredFactorTable(PAYOUT_ENDPOINTS);

export default defineRoutes({
  name: 'payouts',
  routes: toRoutes(PAYOUT_ENDPOINTS),
});
