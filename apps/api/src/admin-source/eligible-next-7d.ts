// =============================================================================
// apps/api/src/admin-source/eligible-next-7d.ts
// =============================================================================
// **THE FOLD `liability.ts` NAMES AND DOES NOT PERFORM.** `LiabilityBook` is
// `LiabilityResponse` minus exactly `eligible_next_7d` (`liability.ts`), and
// this module is the reader of the leaf that subtraction removes.
//
// -----------------------------------------------------------------------------
// WHAT MOVED, AND THE SENTENCE THAT IS NOW FALSE IS QUOTED BEFORE IT IS REPLACED
// -----------------------------------------------------------------------------
// `test/wiring.test.ts`'s `setAdminReadSource` entry said `readLiability` is
// "UNBUILT rather than blocked: its book reader, its seven-day horizon and its
// payout-velocity evaluator all exist and nothing folds them into one body, and
// the figure holding that fold is `eligible_next_7d`, whose last term is a
// `writeRuleState` implementation under `apps/worker/**` or `packages/**`".
//
// **THE LAST CLAUSE IS FALSE AND IT IS FALSE BY MEASUREMENT RATHER THAN BY
// ARGUMENT.** `writeRuleStateVia` is that implementation
// (`apps/worker/src/batch/state-writer.ts`); `postgresBatchPorts` composes it on
// `ADR-250`'s codec (`apps/worker/src/batch/adapter.ts`); `runNightlyBatch`
// calls it (`apps/worker/src/batch/nightly.ts`); and `ADR-264` section 2 ran the
// batch against PostgreSQL and watched `rule_states` go from zero rows to one.
// `B5` term 1 of `liability.ts` is spent, and so are terms 2 (`ADR-206`) and 3
// (`ADR-208`). **ALL THREE OF THAT BLOCKER'S TERMS ARE NOW SPENT.**
//
// **AND THE GROUP IS STILL NOT ON THE WIRE, WHICH IS THE FINDING RATHER THAN A
// DISAPPOINTMENT.** A blocker whose stated terms are all spent and whose figure
// is still absent is a blocker that was stated one layer too high. `ADR-269`
// records what is underneath it; this header records the half that is code.
//
// -----------------------------------------------------------------------------
// FIVE INPUTS, AND THE ONE THAT REFUSES IS NOT THE ONE ANY ENTRY NAMED
// -----------------------------------------------------------------------------
// `PayoutProjectionInput` takes `state`, `plan`, `gates`, `calendar` and
// `horizon`, per account.
//
//   `calendar`   {@link readCalendarSlice}          BUILT, session 392
//   `horizon`    {@link readTradingHorizon}         BUILT, session 377
//   `state`      `ruleStateOn` (`../rule-state-reader.ts`)  BUILT, `ADR-264`
//   `gates`      `resolveExternalGates` over five raw columns and two chains,
//                read below                          BUILT HERE
//   `plan`       `resolvePlan(rules, size)`          **INJECTED AND REFUSING**
//
// **`plan` IS THE ONE TERM THIS FENCE MAY NOT TAKE, AND THE REASON IS `FM-16`
// RATHER THAN AN ABSENT ROW.** `plan_versions.rules` is a `jsonb` and a decoder
// written in this file would be a SECOND statement of the predicate that fixes
// every cents value and every gate threshold a payout is decided against, with
// nothing comparing the two. `ADR-239` slice A ruled where the shared home is,
// `packages/rules-engine` beside `gates-codec.ts`, and `ADR-264` set this file's
// precedent for meeting that finding: **REGISTER it, do not take it.**
//
// **THE SENTENCE THAT SIZED THAT REGISTRATION IS FALSE AND IS QUOTED RATHER THAN
// DELETED (`ADR-283`).** It read that the decoding "exists exactly once in this
// repository, as `toPublishedRules` in `apps/worker/src/batch/adapter.ts`" and
// that "`apps/api` cannot import `apps/worker`". **THE MOVE `ADR-239` SLICE A
// RULED HAS LANDED**: `decodePlanRules` is exported from the engine's index, this
// deployable has declared `@merit/rules-engine` since session 252, and
// `payout-backend.ts` already decodes the blob and resolves a plan on the payout
// transaction (`ADR-308`). The count was wrong the other way as well: the tree
// states the predicate THREE times, by the engine, by `toPublishedRules` and by
// `decodeRules` in `apps/site`, and `rule-state-producibility.test.ts` link 7
// holds that census at exactly three.
//
// **WHAT DOES NOT FOLLOW IS THAT THIS FILE MAY TAKE THE TERM.** The engine's
// decoder is the first half of `resolvePinnedPlan` and not the whole of it: the
// port also owes the account's `plan_version_sizes` row, and composing the pair
// here is a slice with a fence of its own rather than a liability read. So the
// decoder stays a PORT, in {@link EligibleFoldIo}, and its unwired default throws
// {@link EligibleFoldUnwired} by name. That is
// `RuleStateWriterIo.encodeEngineGates`'s own shape, chosen for its own reason:
// a term that cannot be taken inside a fence is visible as an injected function
// and invisible as a paragraph. **WHAT MOVED IS THE PRICE AND NOT THE REFUSAL**:
// this term waited on a money-path refactor nobody had taken and now waits on a
// composition somebody writes, and a reader who meets the retired sentence would
// size it as the first.
//
// -----------------------------------------------------------------------------
// AN EMPTY `rule_states` IS A REFUSAL AND IS NEVER A ZERO LIABILITY
// -----------------------------------------------------------------------------
// `rule_states` holds no row for an account-day until a nightly fold has closed
// that day, and `ADR-264` section 2 measured a database where it held none at
// all. **A FOLD OVER AN EMPTY TABLE SUMS TO ZERO, AND ZERO IS A NUMBER AN
// OPERATOR ACTS ON.** `eligible_next_7d.total_cents` is the figure the payout
// wallet is funded against (`EC-074`, `P-M6-02`, `ADR-011`'s top-up trigger), so
// a zero read off an unrun batch says the firm owes nothing on the morning it
// owes the most. {@link readEligibleNext7d} answers `refused` with
// `no_folded_state` instead, and the refusal is a distinct arm rather than an
// empty figure: `rule-state-reader.ts` states the rule this obeys, "an absent
// row is a refusal and it is never a default verdict", one surface over.
//
// **A PARTIAL FOLD IS NOT A REFUSAL AND IT IS NOT SILENT EITHER.** An account
// funded today has no `daily_marks` row, so the nightly batch does not consider
// it and no `rule_states` row exists for it; a deployment where every funded
// account is covered is the exception rather than the rule. Refusing the whole
// figure for one uncovered account would leave the operator with nothing on
// every ordinary day, which is `apps/admin/src/figure.ts`'s bar failed from the
// other side. So the figure is produced over the COVERED population and the
// shortfall is a MEASURED term of it ({@link EligibleFigureTerm}), which is the
// half `EC-074` is actually about: understating the liability starves
// operations, and a number that says which population it is over is not
// understating anything.
//
// -----------------------------------------------------------------------------
// EVERY NUMBER ON THIS FIGURE IS PROJECTED, AND THE FIGURE SAYS SO ITSELF
// -----------------------------------------------------------------------------
// **THIS IS THE PROPERTY THE MODULE EXISTS TO CARRY AND IT IS NOT A COMMENT.**
// `eligible_next_7d` is a forecast over a seven-day horizon under `ADR-204`'s
// five assumptions, so `total_cents`, `account_count` and every `by_day` cell is
// a PROJECTION and not one of them is a measurement. A liability number that
// reads as measured when it is projected is worse than no number on a surface an
// operator uses to decide whether the firm can pay.
//
// **AND THE WIRE TYPE CANNOT SAY THAT.** `EligibleNext7d` (`routes/admin-reads.ts`)
// declares `total_cents`, `account_count` and `by_day[]` and NOTHING ELSE: it
// carries no measured term at all, so there is no field on it a basis could be
// attached to and no pair of fields a reader could tell apart. That is not an
// omission this module may repair. `RI-18` binds that shape across
// `API_CONTRACT.md`, `routes/admin-reads.ts` and `apps/admin/src/api/types.ts`
// atomically, all three outside this fence, and widening a fence to finish is
// the thing that is never done.
//
// So the basis rides on THIS module's value, which is the figure at this fence,
// and it rides as data rather than as prose: {@link EligibleNext7dFigure.terms}
// carries every term with its basis and its source, {@link toWireEligibleNext7d}
// is the narrowing that DROPS them, and that function's own contract is that a
// caller which renders its output without the terms is rendering a projection as
// a measurement. `ADR-269` section 6 rows the contract amendment that would let
// the wire carry them.
//
// -----------------------------------------------------------------------------
// NOTHING HERE RECOMPUTES A GATE, AND NOTHING HERE IS COMPOSED
// -----------------------------------------------------------------------------
// `admin-source/account.ts` states this directory's rule: "Nothing in this
// module derives an eligibility, recomputes a gate or summarises one".
// `projectPayout` is the evaluator and `resolveExternalGates` is the resolver;
// this file reads rows, hands them over and folds what comes back.
//
// **AND `readLiability` IS STILL NOT COMPOSED.** `IMPLEMENTED_ADMIN_READS` does
// not name it, `adminReadSourceParts` does not supply it, and
// `composeAdminReadSource` still fills the gap with
// `AdminSourceNotComposed('readLiability')`. The port stays where it is: the
// other six reads are behind `setAdminSessionSource`, and this one is behind the
// `plan` term above. Composing a read whose plan resolver throws by name would
// put a live-looking figure in front of an arm that cannot answer, which is
// `usePayoutBackend`'s rule.
// =============================================================================

import {
  PROJECTION_ASSUMPTIONS,
  PROJECTION_CAVEAT,
  projectPayout,
  resolveExternalGates,
} from '@merit/rules-engine';
import type {
  Cents,
  ExternalGates,
  KycChainRow,
  ProjectionAssumption,
  ResolvedPlan,
  RuleState,
  TradingDay,
} from '@merit/rules-engine';

import { RuleStateAbsent, ruleStateOn } from '../rule-state-reader.ts';
import { AdminReadError } from '../routes/admin-reads.ts';
import type { AdminRowFilter } from './flags.ts';
import { readCalendarSlice, readTradingHorizon } from './liability.ts';
import type { LiabilityCalendarSlice, TradingCalendarTx, TradingHorizon } from './liability.ts';
import type { EligibleNext7d } from '../routes/admin-reads.ts';

// -----------------------------------------------------------------------------
// The accessor
// -----------------------------------------------------------------------------

/**
 * The tables the per-account half of the fold reads.
 *
 * `tradingCalendar` and `tradingCalendarLoads` are NOT here: the horizon and the
 * slice are read through {@link TradingCalendarTx}, which `liability.ts` already
 * declares, and a second key list naming the same two tables would be a second
 * answer to which tables the calendar lives in.
 *
 * `plans` and `planVersions` are NOT here either, and that is the `plan` term
 * rather than an oversight: this module never reads the pinned version, because
 * {@link EligibleFoldIo.resolvePinnedPlan} is what holds that read and the
 * decoder it needs is not this fence's to write.
 */
export const ELIGIBLE_FOLD_TABLES = [
  'accounts',
  'identities',
  'kycVerifications',
  'payoutRequests',
  'ruleStates',
] as const;

/** One of {@link ELIGIBLE_FOLD_TABLES}. */
export type EligibleFoldTable = (typeof ELIGIBLE_FOLD_TABLES)[number];

/**
 * `ADR-112`'s keyed accessor, READ HALF ONLY, over this module's five tables.
 *
 * `flags.ts`'s handle shape and `flags.ts`'s reason: `insert`, `updateAt`,
 * `deleteAt` and `sqlExecutor` are ABSENT rather than unused, `SystemTx`
 * satisfies this structurally, and a handle narrowed to it cannot write. A
 * liability READ that could move an account's `payouts_frozen` is the mirror of
 * `INV-M7-02`'s concern and here it is a type rather than a convention.
 *
 * `rowAt` IS ABSENT, on `LiabilityTx`'s own reason one table over. The one
 * address this module would take is `identities` by `id`, and `rowsWhere` is the
 * same predicate; what it loses is the accessor's promise of at most one row,
 * which {@link identityOf} asserts itself and says which identity was ambiguous.
 * A method the module can use correctly in one place and incorrectly in four is
 * a method the next reader uses incorrectly.
 */
export interface EligibleFoldTx {
  rows(key: EligibleFoldTable): Promise<unknown[]>;
  rowsWhere(key: EligibleFoldTable, where: AdminRowFilter): Promise<unknown[]>;
}

// -----------------------------------------------------------------------------
// The one injected term
// -----------------------------------------------------------------------------

/**
 * The term this fence may not take, injected so it is a function rather than a
 * paragraph.
 *
 * `RuleStateWriterIo`'s shape and its reason (`apps/worker/src/batch/state-writer.ts`):
 * the port makes the absence typed, and the unwired default refuses BY NAME so a
 * caller that forgot to supply one gets the term's name rather than a stack.
 *
 * **THE REASON THIS DOCBLOCK GAVE FOR THAT SHAPE IS SUPERSEDED AND IS KEPT SO
 * THE CHANGE IS VISIBLE.** It read that "the value is produced by code that lives
 * in another deployable". Since `ADR-283` and `ADR-308` this deployable produces
 * one too, in `payout-backend.ts`, on the payout transaction. The port survives
 * that for a smaller reason: it is not this file's fence to compose one here.
 */
export interface EligibleFoldIo {
  /**
   * `resolvePlan(rules, size)` over the account's PINNED version at its OWN
   * size, which is `INV-16` honoured by the shape: the version and the size are
   * the account's columns and this function chooses neither.
   *
   * **IT IS NOT `resolvePlan` ITSELF.** The engine's resolver takes a decoded
   * `PlanRulesJson` and a decoded `PlanVersionSizeRow`, so the port is drawn
   * around the read and the decode together and a supplier satisfies it with
   * `apps/worker`'s `resolvePinnedPlan` unchanged.
   *
   * **THE CLAUSE NAMING WHAT WAS MISSING IS FALSE AND IS QUOTED RATHER THAN
   * DELETED (`ADR-283`).** It read that "what is missing in `apps/api` is the
   * DECODING". `decodePlanRules` is exported from `@merit/rules-engine`, this
   * deployable declares that package, and `payout-backend.ts` calls it. What is
   * missing is a COMPOSITION of the decode with the size read on a transaction
   * this fold holds, which is a slice and not a move.
   */
  resolvePinnedPlan(planVersionId: string, sizeCents: Cents): Promise<ResolvedPlan>;
}

/** {@link EligibleFoldIo} was called before anything supplied it. */
export class EligibleFoldUnwired extends Error {
  /** The member of {@link EligibleFoldIo} that has no implementation. */
  readonly member: string;

  // ASSIGNED RATHER THAN DECLARED IN THE PARAMETER LIST, on
  // `RuleStateWriterUnwired`'s own reason: `ADR-083` runs every deployable under
  // `node --experimental-strip-types`, where a TypeScript parameter property is
  // `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` at load time while `tsc --noEmit`
  // accepts it, so the failure is invisible to `CI-01`.
  constructor(member: string) {
    super(
      `\`EligibleFoldIo.${member}\` has no implementation in this deployment. ` +
        'A decoder of `plan_versions.rules` written on the read side would be a second ' +
        'statement of the blob that fixes every cents value a payout is decided against, with ' +
        'nothing comparing the two. ADR-239 slice A rules the shared home is ' +
        '`packages/rules-engine` and ADR-283 landed it there as `decodePlanRules`. ' +
        'THIS MESSAGE USED TO READ that the blob "decodes into `PlanRulesJson` in exactly one ' +
        'place in this repository, `toPublishedRules` in `apps/worker/src/batch/adapter.ts`, ' +
        'and `apps/api` cannot import it", and to end "until that move lands". Both clauses ' +
        'are false since ADR-283 and the wording is superseded here rather than deleted, ' +
        'because a reader who meets the retired sentence sizes a money-path refactor that has ' +
        'already happened. What is ' +
        'unsupplied is this port, which owes a decoded plan AND the account`s ' +
        '`plan_version_sizes` row together, so a deployment supplies it or the figure is not ' +
        'produced',
    );
    this.name = 'EligibleFoldUnwired';
    this.member = member;
  }
}

/**
 * The refusing default, so an unsupplied port is a named throw rather than a
 * plausible plan.
 *
 * **A DEFAULT `ResolvedPlan` WOULD BE THE WORST VALUE IN THIS FILE.** Every
 * cents threshold and every gate parameter a projection clears is on it, so a
 * plausible one produces a confident figure over parameters nobody published.
 */
export const UNWIRED_ELIGIBLE_FOLD_IO: EligibleFoldIo = {
  resolvePinnedPlan: () => {
    throw new EligibleFoldUnwired('resolvePinnedPlan');
  },
};

// -----------------------------------------------------------------------------
// The figure, and the basis it carries
// -----------------------------------------------------------------------------

/**
 * Whether a term of the figure is a stored fact or a forecast.
 *
 * **THE TWO ARE NOT DEGREES OF THE SAME THING.** A `measured` term is a value
 * some row in this database holds, so a reader may reconcile it against that
 * row. A `projected` term is what `ADR-204`'s five assumptions imply about a day
 * that has not happened, so nothing will ever reconcile against it and its only
 * honest use is a bound. Rendering the second as the first is what this type
 * exists to make impossible to do by accident.
 */
export type FigureBasis = 'measured' | 'projected';

/** One term of {@link EligibleNext7dFigure}, with where it came from. */
export interface EligibleFigureTerm {
  /**
   * The term's path on this value, or the name of the per-account input it
   * stands for. Dotted, and `[]` marks an array element.
   */
  readonly term: string;
  readonly basis: FigureBasis;
  /** The row, column or function the value came out of. */
  readonly source: string;
  /**
   * The `ADR-204` assumptions that make a `projected` term a projection, and
   * empty on every `measured` one.
   *
   * IT IS THE IDS AND NOT THE PROSE. `PROJECTION_ASSUMPTIONS` carries the
   * sentences and their costs and rides on the figure whole, so repeating them
   * here would be a second copy of five paragraphs with nothing comparing them.
   */
  readonly assumptions: readonly ProjectionAssumption['id'][];
}

/** One horizon day of the figure. Cents are `bigint` and never a `number`. */
export interface EligibleFigureDay {
  readonly trading_day: string;
  readonly cents: Cents;
  readonly accounts: number;
}

/** The population the figure was folded over, all three counts MEASURED. */
export interface EligiblePopulation {
  /** `accounts` rows at phase `funded`. */
  readonly funded: number;
  /** Of those, the ones carrying a `rule_states` row on the anchor day. */
  readonly covered: number;
  /**
   * `funded - covered`, named rather than left to subtraction.
   *
   * NON-ZERO IS THE ORDINARY CASE and the header says why. It is on the figure
   * because `total_cents` is a sum over `covered` and a reader who cannot see
   * this number cannot tell a complete figure from a short one.
   */
  readonly uncovered: number;
}

/** `readEligibleNext7d`'s figure, folded. */
export interface EligibleNext7dFigure {
  readonly kind: 'folded';
  /**
   * `R-06`'s last closed day, which every figure here is computed against.
   * MEASURED.
   */
  readonly as_of_trading_day: string;
  /** The population, MEASURED in all three counts. */
  readonly population: EligiblePopulation;
  /** PROJECTED. Integer cents, and `bigint` so no fold rounds. */
  readonly total_cents: Cents;
  /** PROJECTED. Accounts with a first eligibility inside the horizon. */
  readonly account_count: number;
  /** PROJECTED, over MEASURED days. Ascending, at most one entry per horizon day. */
  readonly by_day: readonly EligibleFigureDay[];
  /** Every term above with its basis. Never empty. */
  readonly terms: readonly EligibleFigureTerm[];
  /** `ADR-204` section 5, riding on the answer because ruling 7 requires it. */
  readonly assumptions: readonly ProjectionAssumption[];
  /** `ADR-204`'s honest summary of what the figure is a bound on. */
  readonly caveat: string;
}

/**
 * WHY there is no figure. Closed, and each member is a different operational day.
 *
 * `no_folded_state`   the nightly batch has not run against this database
 * `calendar_uncovered` `trading_calendar_loads` covers no interval holding the
 *                     anchor, so there is no last closed day to be `as_of`
 * `horizon_exhausted` coverage runs out before seven sessions, so a horizon
 *                     would be short and a short one reads as a quiet week
 * `projection_refused` `projectPayout` refused an account, which is a defect in
 *                     this assembly rather than a day the estate has no opinion
 *                     about
 */
export type EligibleFoldRefusalCause =
  'no_folded_state' | 'calendar_uncovered' | 'horizon_exhausted' | 'projection_refused';

/** {@link EligibleFoldRefusalCause} as data, for the suite. */
export const ELIGIBLE_FOLD_REFUSAL_CAUSES = [
  'no_folded_state',
  'calendar_uncovered',
  'horizon_exhausted',
  'projection_refused',
] as const satisfies readonly EligibleFoldRefusalCause[];

/** The figure declined, with the cause and what would clear it. */
export interface EligibleFoldRefused {
  readonly kind: 'refused';
  readonly cause: EligibleFoldRefusalCause;
  /** The deliverable or run that has to move, and `null` where nothing is nameable. */
  readonly awaiting: string | null;
  /** What an operator should do with the absence. Never blank. */
  readonly detail: string;
}

/** What {@link readEligibleNext7d} answers. */
export type EligibleNext7dOutcome = EligibleNext7dFigure | EligibleFoldRefused;

/** What the fold cost, in rows. `LiabilityReadCost`'s idiom. */
export interface EligibleFoldCost {
  readonly accountsScanned: number;
  readonly ruleStateRowsScanned: number;
  readonly identityRowsScanned: number;
  readonly kycRowsScanned: number;
  readonly payoutRequestRowsScanned: number;
  readonly calendarRowsScanned: number;
}

/** {@link readEligibleNext7d}'s answer. */
export interface EligibleNext7dResult {
  readonly figure: EligibleNext7dOutcome;
  readonly cost: EligibleFoldCost;
}

/**
 * Every term of {@link EligibleNext7dFigure} with its basis, as data.
 *
 * **IT IS A CONSTANT BECAUSE THE BASIS IS A PROPERTY OF THE TERM AND NOT OF THE
 * CALL.** `total_cents` is a projection on every database this code will ever
 * run against, and a basis computed per call would be a basis a fixture could
 * make say `measured`.
 *
 * **AND IT IS BIDIRECTIONAL OR IT IS DECORATION.** A list naming terms that no
 * longer exist is stale, and a figure carrying a leaf this list does not name is
 * a number with no stated basis, which is the whole failure. The suite walks the
 * figure's own leaves against these entries in both directions, which is
 * `RI-19`'s form applied to a value rather than to a comment.
 *
 * The five per-account inputs are here too, and they are not leaves of the
 * figure. They are what the projection was computed FROM, and an operator asking
 * whether a number is real is asking about those as much as about the sum:
 * `state` is a stored fold, `gates` are five columns read at the anchor, and the
 * forward application of those gates across seven days is the projection.
 */
export const ELIGIBLE_FIGURE_TERMS: readonly EligibleFigureTerm[] = [
  {
    term: 'as_of_trading_day',
    basis: 'measured',
    source:
      '`rule_states.trading_day` on the covered rows, which is the calendar anchor and R-06`s ' +
      'last closed day',
    assumptions: [],
  },
  {
    term: 'population.funded',
    basis: 'measured',
    source: '`accounts` rows at `phase = funded`',
    assumptions: [],
  },
  {
    term: 'population.covered',
    basis: 'measured',
    source: 'those of them carrying a `rule_states` row on `as_of_trading_day`',
    assumptions: [],
  },
  {
    term: 'population.uncovered',
    basis: 'measured',
    source: '`population.funded` less `population.covered`',
    assumptions: [],
  },
  {
    term: 'total_cents',
    basis: 'projected',
    source:
      '`sum(PayoutProjection.centsAtFirstEligibility)` over the covered population, which is ' +
      '`min(withdrawable_cents, cap_for_next_ordinal)` at the last closed day taken off the ' +
      'evaluation rather than recomputed (ADR-204 ruling 4)',
    assumptions: ['A1', 'A2', 'A3', 'A4', 'A5'],
  },
  {
    term: 'account_count',
    basis: 'projected',
    source:
      'covered accounts whose `PayoutProjection.firstEligibleTradingDay` is inside the horizon, ' +
      'which is ADR-204 ruling 2`s `E` and `C` and admits nothing else',
    assumptions: ['A1', 'A3', 'A4'],
  },
  {
    term: 'by_day[].trading_day',
    basis: 'measured',
    source:
      '`trading_calendar` rows strictly after the anchor, holidays removed, bounded by ' +
      '`trading_calendar_loads`',
    assumptions: [],
  },
  {
    term: 'by_day[].cents',
    basis: 'projected',
    source: '`total_cents` placed on the day ADR-204 ruling 3 gives each account, and no later one',
    assumptions: ['A1', 'A2', 'A3', 'A4', 'A5'],
  },
  {
    term: 'by_day[].accounts',
    basis: 'projected',
    source: '`account_count` placed on the same day, at most once per account',
    assumptions: ['A1', 'A3', 'A4'],
  },
  {
    term: 'input.state',
    basis: 'measured',
    source:
      'one `rule_states` row per account on `as_of_trading_day`, written by a nightly fold and ' +
      'read back by `ruleStateOn`. Its own `tradingDay` is never moved forward (R-06)',
    assumptions: [],
  },
  {
    term: 'input.plan',
    basis: 'measured',
    source:
      'the account`s pinned `plan_versions` row at its own `size_cents`, resolved by ' +
      '`EligibleFoldIo.resolvePinnedPlan`',
    assumptions: ['A5'],
  },
  {
    term: 'input.gates',
    basis: 'measured',
    source:
      '`accounts.status`, `accounts.payouts_frozen`, `accounts.recon_blocked`, ' +
      '`identities.payouts_frozen`, the whole `kyc_verifications` chain and every ' +
      '`payout_requests.status`, all read AT THE ANCHOR',
    assumptions: [],
  },
  {
    term: 'input.gates_forward',
    basis: 'projected',
    source:
      'the same one `ExternalGates` applied to every horizon day. A breach, a freeze, a KYC ' +
      'expiry or a recon block inside the horizon is invisible to this figure',
    assumptions: ['A3'],
  },
  {
    term: 'input.calendar',
    basis: 'measured',
    source:
      'the covered interval holding the anchor, as a `CalendarSlice` whose `sequence` is ' +
      'position over the ordered holiday-filtered rows',
    assumptions: [],
  },
] as const;

// -----------------------------------------------------------------------------
// Row readers. Every one throws where a `??` would have been
// -----------------------------------------------------------------------------

function asRow(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new AdminReadError(
      `the accessor returned a ${typeof value} where ${at} was expected. A liability figure ` +
        'built out of that would put a number nothing in the estate produced in front of an ' +
        'operator during the incident it exists for',
    );
  return value as Record<string, unknown>;
}

function text(row: Record<string, unknown>, column: string, at: string): string {
  const value = row[column];
  if (typeof value !== 'string' || value === '')
    throw new AdminReadError(
      `${at} carries no \`${column}\`, and the column is \`NOT NULL\` in the schema. That is ` +
        'the transcription disagreeing with the database rather than a row to fold',
    );
  return value;
}

function textOrNull(row: Record<string, unknown>, column: string, at: string): string | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string')
    throw new AdminReadError(
      `${at} carries \`${column}\` as a ${typeof value}, not a nullable text`,
    );
  return value;
}

function flag(row: Record<string, unknown>, column: string, at: string): boolean {
  const value = row[column];
  if (typeof value !== 'boolean')
    throw new AdminReadError(
      `${at} carries \`${column}\` as ${JSON.stringify(value)}, and the column is a ` +
        '`boolean NOT NULL`. Every one of these is an R-41 VETO, and a truthy string read as ' +
        '`true` is a veto that fires on the wrong account while a falsy one never fires at all',
    );
  return value;
}

/**
 * A `bigint` money column, kept a `bigint`.
 *
 * **IT DOES NOT RETURN A `number` AND THAT IS THE DIFFERENCE FROM `liability.ts`'s
 * `cents`.** That one narrows to the contract's JSON integer at the wire, which
 * is correct there and wrong here: this value is summed across a whole funded
 * population before anything renders it, and a fold that narrows first is a fold
 * that rounds first. {@link toWireEligibleNext7d} is where the narrowing happens
 * and it is the only place.
 */
function centsOf(row: Record<string, unknown>, column: string, at: string): Cents {
  const value = row[column];
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw new AdminReadError(
    `${at} carries \`${column}\` as ${JSON.stringify(value)}, and the column is a ` +
      '`bigint NOT NULL`. Money is integer cents on every path in this estate and a float that ' +
      'reached this one is wrong in its low digits and right in every digit an operator reads',
  );
}

// -----------------------------------------------------------------------------
// The per-account reads
// -----------------------------------------------------------------------------

/**
 * The owning identity, whose `payouts_frozen` is a VETO.
 *
 * **ITS ABSENCE IS A THROW AND NEVER A `false`.** `accounts.identity_id` is
 * `uuid NOT NULL REFERENCES identities(id)`, so an account whose owner cannot be
 * read is a foreign key that did not hold; reading the flag as `false` because
 * the row was not there is the exact shape `R-41` makes expensive.
 * `apps/worker/src/batch/adapter.ts` states the same rule at its own read.
 */
async function identityOf(
  tx: EligibleFoldTx,
  identityId: string,
): Promise<Record<string, unknown>> {
  const rows = await tx.rowsWhere('identities', { id: identityId });
  if (rows.length === 0)
    throw new AdminReadError(
      `identities holds no row at ${identityId}, and a foreign key in this schema says it must. ` +
        'The fold refuses rather than continuing without the identity half of `payouts_frozen`',
    );
  if (rows.length > 1)
    throw new AdminReadError(
      `identities returned ${String(rows.length)} rows at ${identityId}, which the primary key ` +
        'forbids. Choosing one would fold a liability against whichever row the accessor ' +
        'returned first',
    );
  return asRow(rows[0], `identities[${identityId}]`);
}

/**
 * `ExternalGates` for one account, out of five raw columns and two whole chains.
 *
 * **EVERY VALUE HANDED OVER IS THE RAW COLUMN**, on `adapter.ts`'s stated
 * reason: narrowing `accounts.status` here would be a second place the
 * seven-versus-six question is answered, and `external-gates.ts` exists to hold
 * it in one.
 *
 * **THE KYC READ IS THE WHOLE CHAIN AND NOT THE HEAD.** `SD-M19-01` makes a
 * re-verification a NEW ROW pointing at the one it supersedes, so the head is a
 * property of the SET and cannot be addressed.
 *
 * **THE PAYOUT READ IS EVERY ROW AND THE STATUS FILTER IS THE ENGINE'S.** A
 * filter here would be another copy of `payout_requests_no_in_flight_uq`'s
 * predicate with nothing comparing it.
 *
 * @throws ExternalGatesRefusal from the engine, UNCAUGHT ON PURPOSE. An account
 * whose vetoes cannot be derived is not an account to drop from the sum: a
 * dropped account understates the firm's liability silently, and `EC-074`'s
 * words for that are that it starves operations. The whole figure refuses and
 * the error names the legs and the account.
 */
async function gatesOf(
  tx: EligibleFoldTx,
  account: Record<string, unknown>,
  accountId: string,
  cost: { identityRowsScanned: number; kycRowsScanned: number; payoutRequestRowsScanned: number },
): Promise<ExternalGates> {
  const identityId = text(account, 'identityId', `accounts[${accountId}]`);
  const identity = await identityOf(tx, identityId);
  cost.identityRowsScanned += 1;

  const kycRows = await tx.rowsWhere('kycVerifications', { identityId });
  cost.kycRowsScanned += kycRows.length;
  const kycChain: KycChainRow[] = kycRows.map((value, index) => {
    const at = `kyc_verifications[${String(index)}]`;
    const row = asRow(value, at);
    return {
      id: text(row, 'id', at),
      state: text(row, 'state', at),
      supersedes: textOrNull(row, 'supersedes', at),
    };
  });

  const payoutRows = await tx.rowsWhere('payoutRequests', { accountId });
  cost.payoutRequestRowsScanned += payoutRows.length;
  const payoutRequestStatuses = payoutRows.map((value, index) =>
    text(
      asRow(value, `payout_requests[${String(index)}]`),
      'status',
      `payout_requests[${String(index)}]`,
    ),
  );

  return resolveExternalGates({
    accountId,
    accountStatus: text(account, 'status', `accounts[${accountId}]`),
    identityPayoutsFrozen: flag(identity, 'payoutsFrozen', `identities[${identityId}]`),
    accountPayoutsFrozen: flag(account, 'payoutsFrozen', `accounts[${accountId}]`),
    reconBlocked: flag(account, 'reconBlocked', `accounts[${accountId}]`),
    kycChain,
    payoutRequestStatuses,
  });
}

// -----------------------------------------------------------------------------
// The fold
// -----------------------------------------------------------------------------

const refuse = (
  cause: EligibleFoldRefusalCause,
  awaiting: string | null,
  detail: string,
): EligibleFoldRefused => ({ kind: 'refused', cause, awaiting, detail });

/**
 * `eligible_next_7d`, folded over the covered funded population, or the reason
 * there is no such figure.
 *
 * **THE ORDER OF THE REFUSALS IS THE ORDER OF THE DEPENDENCIES AND IT MATTERS.**
 * The calendar is asked first because `as_of_trading_day` is the day every other
 * read is taken at, so a fold that read `rule_states` first would report "the
 * batch has not run" on an estate whose calendar simply is not loaded. Those are
 * two different mornings and only one of them is an engineering problem.
 *
 * **NOTHING HERE IS COMPOSED INTO `AdminReadSource` AND THAT IS DELIBERATE.**
 * See the header: `EligibleFoldIo.resolvePinnedPlan` has no implementation in
 * this deployment, and a composed read whose plan resolver throws by name is a
 * live-looking figure in front of an arm that cannot answer.
 */
export async function readEligibleNext7d(
  tx: EligibleFoldTx,
  calendarTx: TradingCalendarTx,
  io: EligibleFoldIo,
  asOf: string,
): Promise<EligibleNext7dResult> {
  const horizonResult = await readTradingHorizon(calendarTx, asOf);
  const sliceResult = await readCalendarSlice(calendarTx, asOf);
  const calendarRowsScanned =
    horizonResult.cost.calendarRowsScanned + sliceResult.cost.calendarRowsScanned;

  const empty = (figure: EligibleNext7dOutcome): EligibleNext7dResult => ({
    figure,
    cost: {
      accountsScanned: 0,
      ruleStateRowsScanned: 0,
      identityRowsScanned: 0,
      kycRowsScanned: 0,
      payoutRequestRowsScanned: 0,
      calendarRowsScanned,
    },
  });

  const horizon: TradingHorizon = horizonResult.horizon;
  if (horizon.kind === 'uncovered')
    return empty(
      refuse(
        'calendar_uncovered',
        null,
        `${horizon.detail}. There is no last closed day to compute a forecast against, so the ` +
          'absence is a calendar load rather than an unrun batch',
      ),
    );
  if (horizon.kind === 'exhausted')
    return empty(
      refuse(
        'horizon_exhausted',
        null,
        `${horizon.detail}. A seven-day figure folded over ${String(horizon.days.length)} ` +
          'sessions reads as a quiet week rather than as a calendar that runs out, which is ' +
          'ADR-042 F-4`s failure with a number attached to it. Load the calendar past ' +
          `${horizon.covered_through_day}`,
      ),
    );

  const slice: LiabilityCalendarSlice = sliceResult.slice;
  if (slice.kind === 'uncovered')
    return empty(
      refuse(
        'calendar_uncovered',
        null,
        `${slice.detail}. The horizon resolved and the slice did not, which is the two calendar ` +
          'walks disagreeing about the same anchor rather than a state of the estate',
      ),
    );

  const anchorDay = horizon.anchor_day;
  const horizonDays: readonly TradingDay[] = horizon.days.map(
    (day) => day.trading_day as TradingDay,
  );

  const accountRows = await tx.rowsWhere('accounts', { phase: 'funded' });
  const cost = {
    accountsScanned: accountRows.length,
    ruleStateRowsScanned: 0,
    identityRowsScanned: 0,
    kycRowsScanned: 0,
    payoutRequestRowsScanned: 0,
    calendarRowsScanned,
  };

  // ONE ACCUMULATOR PER HORIZON DAY, KEYED BY THE DAY THE CALENDAR GAVE. Every
  // day of `by_day` is a row this walk read, in the order it read them, so a
  // projection landing on a day the calendar does not hold has nowhere to go and
  // `projectPayout` has already refused it.
  const byDay = new Map<string, { cents: Cents; accounts: number }>(
    horizon.days.map((day) => [day.trading_day, { cents: 0n, accounts: 0 }]),
  );

  let covered = 0;
  let totalCents: Cents = 0n;
  let accountCount = 0;

  for (const value of accountRows) {
    const account = asRow(value, 'accounts');
    const accountId = text(account, 'id', 'accounts');

    const stateRows = await tx.rowsWhere('ruleStates', { accountId });
    cost.ruleStateRowsScanned += stateRows.length;

    let state: RuleState;
    try {
      state = ruleStateOn(stateRows, accountId, anchorDay);
    } catch (error) {
      // AN ABSENT ROW IS THIS ACCOUNT LEAVING THE COVERED POPULATION AND IT IS
      // NEVER A ZEROED STATE. `RuleStateUnreadable` is a DIFFERENT day -- two
      // rows for one account-day, or a malformed one -- and it is rethrown,
      // because a malformed row silently skipped is a liability quietly missing
      // an account whose row exists.
      if (error instanceof RuleStateAbsent) continue;
      throw error;
    }
    covered += 1;

    const plan = await io.resolvePinnedPlan(
      text(account, 'planVersionId', `accounts[${accountId}]`),
      centsOf(account, 'sizeCents', `accounts[${accountId}]`),
    );
    const gates = await gatesOf(tx, account, accountId, cost);

    const outcome = projectPayout({
      state,
      plan,
      gates,
      calendar: slice.slice,
      horizon: horizonDays,
    });

    if (outcome.kind === 'refused')
      return {
        figure: refuse(
          'projection_refused',
          null,
          `\`projectPayout\` refused account ${accountId} with \`${outcome.assertion.kind}\` on ` +
            `${outcome.assertion.tradingDay}: ${outcome.assertion.detail}. ADR-204 ruling 9 ` +
            'makes that a horizon this assembly built wrongly rather than a day the estate has ' +
            'no opinion about, so the figure refuses instead of dropping the account',
        ),
        cost,
      };

    const { firstEligibleTradingDay, centsAtFirstEligibility } = outcome.projection;
    if (firstEligibleTradingDay === null) continue;

    // RULING 3: AT MOST ONE DAY PER ACCOUNT. An account that appears on every
    // day it clears puts `sum(by_day[].cents)` at up to seven times
    // `total_cents`, and a series repeating the standing population every day is
    // a flat line with the arriving wave hidden inside it.
    const bucket = byDay.get(firstEligibleTradingDay);
    if (bucket === undefined)
      throw new AdminReadError(
        `\`projectPayout\` placed account ${accountId} on ${firstEligibleTradingDay}, which is ` +
          'not one of the horizon days it was handed. The engine validates the horizon before ' +
          'it touches a gate, so this is the two of them disagreeing rather than a data problem',
      );

    bucket.cents += centsAtFirstEligibility;
    bucket.accounts += 1;
    totalCents += centsAtFirstEligibility;
    accountCount += 1;
  }

  // THE SECOND TRAP, AND THE TWO ZEROES ARE NOT THE SAME ZERO. No funded
  // account at all is a MEASURED zero: `accounts` was read and it held none, and
  // `population.funded` says so on the figure. Funded accounts with no folded
  // state is an UNRUN BATCH, and summing it produces the same `0` while meaning
  // that the estate does not know. Only the second refuses.
  if (accountRows.length > 0 && covered === 0)
    return {
      figure: refuse(
        'no_folded_state',
        'a nightly `runNightlyBatch` run against this database',
        `${String(accountRows.length)} funded accounts carry no \`rule_states\` row on ` +
          `${anchorDay}. Folding that population sums to zero cents, and zero is a number an ` +
          'operator funds the payout wallet against (EC-074, P-M6-02, ADR-011`s top-up ' +
          'trigger), so an unrun batch would report that the firm owes nothing on the morning ' +
          'it may owe the most. The table is empty of this day rather than the liability being ' +
          'zero',
      ),
      cost,
    };

  return {
    figure: {
      kind: 'folded',
      as_of_trading_day: anchorDay,
      population: {
        funded: accountRows.length,
        covered,
        uncovered: accountRows.length - covered,
      },
      total_cents: totalCents,
      account_count: accountCount,
      by_day: horizon.days.map((day) => {
        const bucket = byDay.get(day.trading_day) ?? { cents: 0n, accounts: 0 };
        return { trading_day: day.trading_day, cents: bucket.cents, accounts: bucket.accounts };
      }),
      terms: ELIGIBLE_FIGURE_TERMS,
      assumptions: PROJECTION_ASSUMPTIONS,
      caveat: PROJECTION_CAVEAT,
    },
    cost,
  };
}

/**
 * The figure narrowed to `LiabilityResponse.eligible_next_7d`.
 *
 * **THIS FUNCTION LOSES THE THING THE FIGURE EXISTS TO CARRY AND SAYS SO AT ITS
 * OWN DECLARATION.** `EligibleNext7d` has three members and every one of them is
 * a projection; it declares no measured term, so there is no field on it that
 * the population counts, the basis table, the five assumptions or the caveat can
 * ride on. A caller that renders this return value alone is rendering a forecast
 * as a measurement, which is exactly what a liability panel must not do.
 *
 * It exists all the same, and unused code is not the reason: the subtraction
 * `LiabilityBook` performs is `LiabilityResponse` minus this one field, so the
 * shape of the eventual widening is a fact worth holding in a type rather than
 * in a paragraph, and the day the contract gains the terms this is the one place
 * that changes.
 *
 * **CENTS NARROW HERE AND NOWHERE ELSE**, on `liability.ts`'s `cents` rule:
 * API_CONTRACT section 1 types every `_cents` member a JSON integer,
 * `assertContractScalars` refuses the response otherwise, and a value past 2^53
 * silently rounded is wrong in its low digits and right in every digit an
 * operator reads. The fold is `bigint` all the way to this call.
 */
export function toWireEligibleNext7d(figure: EligibleNext7dFigure): EligibleNext7d {
  const wireCents = (value: Cents, at: string): number => {
    const asNumber = Number(value);
    if (!Number.isSafeInteger(asNumber))
      throw new AdminReadError(
        `${at} is ${value.toString()} cents, which is not a safe integer. The fold carries ` +
          '`bigint` precisely so this is a refusal at the wire rather than a rounding inside ' +
          'the sum',
      );
    return asNumber;
  };

  return {
    total_cents: wireCents(figure.total_cents, 'eligible_next_7d.total_cents'),
    account_count: figure.account_count,
    by_day: figure.by_day.map((day) => ({
      trading_day: day.trading_day,
      cents: wireCents(day.cents, `eligible_next_7d.by_day[${day.trading_day}].cents`),
      accounts: day.accounts,
    })),
  };
}
