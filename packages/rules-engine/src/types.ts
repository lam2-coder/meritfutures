// =============================================================================
// packages/rules-engine/src/types.ts
// =============================================================================
// The engine's public contract, and nothing else. OVERVIEW section 3:
//
//   (planConfigVersion, accountState, dayMarks[]) -> newState + events
//
// THE FIELD SETS BELOW ARE THE SCAFFOLD'S, NOT M01's. Every field named here is
// a column that exists in packages/db/migrations; the rest of each record is
// M01's to add when the engine is built. What the scaffold fixes is the SHAPE,
// because the shape is what stops being fixable once code depends on it.

// -----------------------------------------------------------------------------
// Scalars, branded so a number cannot be passed where a different number is meant
// -----------------------------------------------------------------------------
// "Money is integer cents; thresholds in basis points / integer cents. No
// floats in financial paths." A brand costs one cast at the boundary and buys a
// compile error every time cents are handed to something expecting basis
// points, which is a mistake that reads correctly in a diff.

/**
 * A quantity of money. Integer cents, always. Never a float, never a string.
 *
 * IT IS `bigint` AND IT WAS A BRANDED `number` UNTIL THE FOLD LANDED. M01
 * section 2.1 declares `type Cents = bigint` and INV-02 is "all money is
 * `bigint` integer cents AT EVERY BOUNDARY", enforced by "types plus a lint
 * rule banning `number` in money-suffixed fields". The scaffold's branded
 * number satisfied the second half of that sentence and not the first, which
 * was correct while nothing computed with it and is not correct now: `advanceDay`
 * adds, subtracts and compares these values on the breach path.
 *
 * THE BRAND IS NOT LOST, IT MOVED INTO THE TYPE ITSELF. What branding bought
 * was a compile error when cents were handed to something expecting basis
 * points; `Cents` is `bigint` and `BasisPoints` is `number`, so that error is
 * now structural rather than nominal, and it costs no cast at the arithmetic
 * sites where a brand would have cost one per expression.
 */
export type Cents = bigint;

/** One hundredth of one percent. The unit every ruled threshold is stated in. */
export type BasisPoints = number & { readonly __brand: 'BasisPoints' };

/**
 * A trading day, as it appears in `daily_marks.trading_day`.
 *
 * THE ENGINE NEVER DERIVES ONE. The trading day follows the exchange session
 * calendar and is maintained as data; deriving it from a clock inside this
 * package is the impurity `merit/engine-purity` exists to reject. It arrives on
 * a `DayMark` and is read from there.
 */
export type TradingDay = string & { readonly __brand: 'TradingDay' };

/** `accounts.id`. */
export type AccountId = string & { readonly __brand: 'AccountId' };

/** `plan_versions.id`. The version pinned to the account, which never changes. */
export type PlanVersionId = string & { readonly __brand: 'PlanVersionId' };

// -----------------------------------------------------------------------------
// TIER 1: FORBIDDEN BY SIGNATURE
// -----------------------------------------------------------------------------
// P1 section 2.3's first tier, and the only one of the three that is
// structural. The rule it implements is absolute and already written:
// "There is no plan parameter anywhere in application code: these are rows in
// `plan_versions.rules` and `plan_version_sizes`" (DATA_MODEL section 12), with
// M01 requiring every downstream surface to read from the account's pinned plan
// version at request time.
//
// The mechanism is that the engine's public type REQUIRES the full pinned
// config. No parameter field is optional, no default exists, and no
// `DEFAULT_CAP_BP` is declarable, because a caller who has not read the
// account's pinned plan version cannot construct this value at all. A missing
// field is a type error rather than a fallback.
//
// `PlanConfigVersionIsClosed` below is that claim made mechanical: it stops
// compiling the moment any field here becomes optional. Adding `cap_bp?: number`
// would otherwise look like a convenience and would silently reintroduce the
// defaulting this tier exists to prevent.

/**
 * The pinned plan configuration an evaluation runs against.
 *
 * M01 defines the parameter set. What is fixed here is that it is a CLOSED
 * record of required fields, carried by identity so an evaluation can always
 * name the version it was performed against.
 */
export interface PlanConfigVersion {
  readonly planVersionId: PlanVersionId;
}

/** `true` when `T` has no optional property, and `false` when it has one. */
type NoOptionalProperties<T> = T extends Required<T> ? true : false;

/**
 * `false` here is a compile error, which is the whole mechanism.
 *
 * It is written `false` rather than `never` on purpose: `never` satisfies every
 * constraint, so an assertion phrased against `never` passes in exactly the
 * case it exists to catch.
 */
type Assert<T extends true> = T;

/**
 * TIER 1, ASSERTED AT COMPILE TIME. If this line stops type-checking, a
 * parameter field was made optional and the defaulting DATA_MODEL section 12
 * forbids has become expressible.
 */
export type PlanConfigVersionIsClosed = Assert<NoOptionalProperties<PlanConfigVersion>>;

// -----------------------------------------------------------------------------
// The inputs
// -----------------------------------------------------------------------------

/**
 * One trading day's measurements for one account, as `daily_marks` records
 * them. Every field here is a column in `0014_marks.sql`.
 */
export interface DayMark {
  readonly tradingDay: TradingDay;
  readonly openingBalanceCents: Cents;
  readonly closingBalanceCents: Cents;
  readonly highBalanceCents: Cents;
  /** The breach comparison input: the day's low against the floor open at its start. */
  readonly lowBalanceCents: Cents;
  /** Signed. A movement, so it may be negative. */
  readonly realizedPnlCents: Cents;
  readonly fillCount: number;
  readonly tradedDay: boolean;
}

/**
 * The account as the engine sees it. Fields are columns on `accounts`.
 *
 * `planVersionId` never changes for the life of the account: it is the
 * retroactive-change protection, enforced by trigger in `0027` rather than by
 * convention, and it is carried here so an evaluation cannot be run against a
 * version the account is not pinned to.
 */
export interface AccountState {
  readonly accountId: AccountId;
  readonly planVersionId: PlanVersionId;
  readonly sizeCents: Cents;
}

// -----------------------------------------------------------------------------
// The outputs
// -----------------------------------------------------------------------------

/**
 * The two fields every emitted event carries, and the base the concrete events
 * extend.
 *
 * The engine performs no I/O, so it does not persist an event; it returns one
 * and the caller writes it.
 *
 * THIS IS THE BASE, NOT THE PUBLIC TYPE OF `events`. That is `EngineEvent`
 * below, which is the discriminated union of the concrete events. This
 * interface's own doc comment used to say `type` was "a string here rather than
 * a union for exactly as long as that set is unwritten"; the set is written, so
 * the union exists.
 */
export interface EngineEventBase {
  readonly type: string;
  readonly tradingDay: TradingDay;
}

/** The whole of what an evaluation reads. Nothing else is in scope. */
export interface EngineInput {
  readonly planConfigVersion: PlanConfigVersion;
  readonly accountState: AccountState;
  readonly dayMarks: readonly DayMark[];
}

/** The whole of what an evaluation produces. */
export interface EngineResult {
  readonly newState: AccountState;
  readonly events: readonly EngineEvent[];
}

// =============================================================================
// M01 SECTION 2: THE FOLD'S TYPES
// =============================================================================
// Everything above this line is the scaffold's `evaluate` surface, which the
// golden loader imports and which exists so CI-03 can assert its inversion
// against an engine that computes nothing. Everything below is M01's, and the
// two meet on `Cents`, `TradingDay` and `EngineEvent` and nowhere else.
//
// WHAT IS DELIBERATELY ABSENT FROM `RuleState` BELOW, because a field the
// engine cannot fill is worse than a field it does not declare:
//
//   stateHash                    SD-08, and `hash.ts`, which replay needs and
//                                the day fold does not
//
// It lands with the rules that compute it, and widening a record nothing
// outside this package reads yet is a diff rather than a migration.
//
// `withdrawableCents`, `engineGates` AND `engineEligible` WERE ON THAT LIST AND
// HAVE LANDED. R-35 arrived first and alone, ahead of the rest of group F,
// because M01 section 3.6's `clampPayout` reads it off the state and P2 section
// 2 sequences group G before group F. The two eligibility fields waited for
// EVERY term of R-41's conjunction, because INV-15 is "`engine_eligible ==
// AND(every engine gate)` with no shortcut path" and a conjunction over a subset
// is not a weaker answer, it is a wrong one that reads as an answer.
//
// THE CONTEXT GATES ARE STILL ABSENT AND ALWAYS WILL BE. SD-06 splits
// `gate_results` into `engine_gates` and `context_gates` precisely so freeze,
// recon, KYC and in-flight never enter the replayed state: "they were true on
// the day and may not be true now. Mixing them into the replayed state
// guarantees nightly false divergences" (INV-23). They are combined at read time
// by `evaluatePayout` and they are never a field here.

// -----------------------------------------------------------------------------
// The calendar, as a VALUE (ADR-049)
// -----------------------------------------------------------------------------

/** One row of the trading calendar. M01 section 2.1. */
export interface CalendarDay {
  readonly tradingDay: TradingDay;
  /** R-03: a half day is a full trading day for every counter. */
  readonly isHalfDay: boolean;
  /** R-04: on a halted session, day counters advance and win days do not. */
  readonly halted: boolean;
  /** Dense index into the calendar. Gap counting is subtraction, never date math (R-02). */
  readonly sequence: number;
}

/**
 * The window of calendar the caller loaded, and the interval it is entitled to
 * answer for.
 *
 * ADR-049: a value, not an interface. "An interface carrying `get()` and
 * `nextAfter()` is a CAPABILITY: a caller could satisfy it with a live query,
 * with a memoiser, or with something that consults the clock, and every
 * [purity] mechanism would stay green while the engine's output became a
 * function of what the caller happened to do. A value has no behavior to
 * smuggle."
 *
 * `coverage` is load bearing and is not derivable from `days`: a day INSIDE
 * coverage that is not in `days` is positively not a trading day, and a day
 * OUTSIDE coverage is UNKNOWN. Those two answers differ and only one of them is
 * safe to act on (ADR-042 F-4, `0032`, and the fixture calendar's own L-08).
 */
export interface CalendarSlice {
  /** Ascending by `tradingDay`, and by `sequence` with it. Built by `buildCalendarSlice`. */
  readonly days: readonly CalendarDay[];
  /** `tradingDay` to its position in `days`. Plain data, so it carries no behavior. */
  readonly index: Readonly<Record<string, number>>;
  readonly coverage: { readonly from: TradingDay; readonly to: TradingDay };
}

/**
 * `true` when no property of `T` is function-valued.
 *
 * The probe is a call signature rather than `Function`: `(...args: never[]) =>
 * unknown` is the widest callable there is, because a parameter list of `never`
 * is assignable to every parameter list and `unknown` accepts every return.
 */
type NoFunctionValuedProperties<T> = {
  [K in keyof T]-?: T[K] extends (...args: never[]) => unknown ? false : true;
}[keyof T] extends true
  ? true
  : false;

/**
 * ADR-049's FOURTH MECHANISM, and it belongs here because the other three
 * cannot cover it.
 *
 * `merit/engine-purity` bans every non-relative import and every clock
 * spelling, `RI-01` asserts the manifest declares no workspace dependency, and
 * the package's `types: []` deletes the ambient globals. NONE OF THE THREE SEES
 * AN INTERFACE WHOSE IMPLEMENTATION READS A DATABASE, because that impurity
 * arrives as an argument.
 *
 * If this line stops type-checking, `CalendarSlice` grew a callable property
 * and the calendar stopped being data.
 */
export type CalendarSliceIsData = Assert<NoFunctionValuedProperties<CalendarSlice>>;

// -----------------------------------------------------------------------------
// The plan, resolved
// -----------------------------------------------------------------------------
// What `resolvePlan(rules, size)` produces and what `advanceDay` reads. THAT
// FUNCTION IS NOT IN THIS SESSION (P2 section 7 gives it its own, P2-1); the
// type is here because the fold cannot be typed without it, and it mirrors
// `test/generators/plan-config.ts`'s `MaterializedPlan` field for field so that
// the resolution is a mechanical transcription when it lands.
//
// NO FIELD IS OPTIONAL AND NO VALUE IS NULLABLE WHERE A UNION SAYS IT BETTER.
// M01's own sketch writes `floorLockAtProfitCents!` and `dailyLossLimitCents!`,
// which is a non-null assertion standing in for a rule CV-16 and CV-11 state
// exactly: the value is present precisely when the feature is enabled. A
// discriminated union says that in the type system, so the engine never asserts
// non-null on a money field.

/** CV-01's vocabulary. `intraday_trailing` is rejected at publish and never reaches here. */
export type DrawdownType = 'trailing_eod' | 'static';

/** R-15. Disabled carries no values, which is CV-11 and CV-12 made structural. */
export type FloorLockRules =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      /** CV-12's left-hand side: profit at which the lock engages. */
      readonly atProfitCents: Cents;
      /** The floor the lock pins, permanently (R-15). */
      readonly floorAtCents: Cents;
    };

export interface DrawdownRules {
  readonly type: DrawdownType;
  /** Materialized from `amount_bp` at publish. CV-02. */
  readonly drawdownCents: Cents;
  readonly lock: FloorLockRules;
}

/** CV-16. The limit is present exactly when the type is not `none`. */
export type DailyLossLimitRules =
  { readonly type: 'none' } | { readonly type: 'soft' | 'hard'; readonly limitCents: Cents };

/** CV-06. Disabled carries no share, which is why R-29 can never read a null. */
export type ConsistencyRules =
  { readonly enabled: false } | { readonly enabled: true; readonly maxDayShareBp: BasisPoints };

/** CV-09. `from_ordinal` strictly increasing, first entry at ordinal 1. */
export interface CapScheduleStep {
  readonly fromOrdinal: number;
  readonly capCents: Cents;
}

/**
 * What the day fold reads whichever phase the account is in.
 *
 * M01 section 3.6 picks one of these per day (`const rules = s.phase === 'eval'
 * ? plan.eval : plan.funded`) and then reads `drawdown`, `dailyLossLimit` and
 * `winDayFloorCents` off it.
 *
 * `winDayFloorCents` IS CARRIED ON BOTH PHASES AND `MaterializedPlan` CARRIES IT
 * ON ONE. `plan_versions.rules.win_days` is a plan-level block and Appendix A
 * lists one "win day floor" per plan rather than one per phase, so resolution
 * copies the single published value onto both phases. The alternative, reading
 * `plan.funded.winDays` from inside an eval-phase day, would put a funded
 * parameter on the eval path where no rule says it belongs.
 */
export interface PhaseDayRules {
  readonly drawdown: DrawdownRules;
  readonly dailyLossLimit: DailyLossLimitRules;
  /** R-09's right-hand side, materialized from `floor_bp`. CV-05. */
  readonly winDayFloorCents: Cents;
}

export interface EvalPhaseRules extends PhaseDayRules {
  /** CV-03. R-26's right-hand side. */
  readonly profitTargetCents: Cents;
  /** CV-04. R-27. */
  readonly minTradingDays: number;
  /** R-28, pass-time and dilutable. */
  readonly consistency: ConsistencyRules;
  /** R-32. `null` on all three v1 plans, so expiry is unreachable. */
  readonly maxDays: number | null;
}

export interface FundedPhaseRules extends PhaseDayRules {
  /** CV-19. Zero disables the gate and it reports `skipped: true` (R-33). */
  readonly minTradingDays: number;
  /** CV-05. R-34. */
  readonly winDaysRequiredCount: number;
  /** R-36, payout-gated. */
  readonly consistency: ConsistencyRules;
  /** CV-07, CV-11. R-35. Permanent, and never withdrawable. */
  readonly bufferCents: Cents;
  /** CV-08. R-37. */
  readonly cadenceGapTradingDays: number;
  /** CV-09, CV-10, CV-17. R-42. */
  readonly payoutCapSchedule: readonly CapScheduleStep[];
  /** CV-15. Fixed at 10,000c and never scaled by size. R-39. */
  readonly minPayoutCents: Cents;
  /** CV-13. R-44. */
  readonly splitBp: BasisPoints;
  /** CV-14 under ADR-030's canonical name. R-49. */
  readonly maxPayouts: number;
}

/**
 * One published plan at one size, as the engine reads it.
 *
 * `eval` is `null` exactly when the plan has no evaluation phase, which is
 * Direct (Appendix A.3, "Eval phase: disabled"). M01's sketch writes
 * `plan.eval!` throughout; the null is the same fact without the assertion.
 */
export interface ResolvedPlan {
  readonly planVersionId: PlanVersionId;
  readonly sizeCents: Cents;
  readonly eval: EvalPhaseRules | null;
  readonly funded: FundedPhaseRules;
}

// -----------------------------------------------------------------------------
// The plan, as PUBLISHED: what `resolvePlan` and `validatePlan` read
// -----------------------------------------------------------------------------
// M01 section 1.3 gives both functions two arguments rather than one merged
// object:
//
//   resolvePlan(rules: PlanRulesJson, size: PlanVersionSizeRow): ResolvedPlan
//   validatePlan(rules: PlanRulesJson, sizes: PlanVersionSizeRow[]): ValidationResult
//
// and section 2.4 says why the split is the contract rather than a calling
// convention: "The engine reads two things and never anything else:
// `plan_versions.rules` for STRUCTURE and `plan_version_sizes` for EVERY CENTS
// VALUE. No percentage is ever applied to a money value at runtime."
//
// SO THE KEYS BELOW ARE snake_case AND STAY THAT WAY. Every other type in this
// file is the engine's own camelCase, because the engine owns the shape. These
// two are the stored `jsonb` and the stored row, transcribed key for key from
// DATA_MODEL section 11 and `0004_catalog.sql`. Renaming them at this boundary
// would make every `CV-nn` path in `validate.ts` uncitable against the document
// that states it, which is the one property a publish validator has to keep.
//
// `validatePlan` TAKES AN ARRAY OF SIZE ROWS AND THAT IS NOT A CONVENIENCE. A
// publish publishes one `plan_versions` row with one `rules` jsonb and N
// `plan_version_sizes` rows (v1: four sizes). CV-11 and CV-12 are inequalities
// ACROSS the two, so a validator handed one size at a time could pass every
// size individually while the version as a whole was unpublishable.

/**
 * `plan_versions.rules.*.drawdown.type`, which is WIDER by one member than
 * `DrawdownType`.
 *
 * THE THIRD MEMBER IS R-17 AND IT IS WHY THIS TYPE EXISTS SEPARATELY. R-17:
 * "Intraday trailing is config-supported and unimplemented", rejected at publish
 * by CV-01. A published plan may therefore CARRY `intraday_trailing`; a resolved
 * plan may not, and `DrawdownType` has two members so that it cannot.
 *
 * `validatePlan` is the narrowing, and CV-01 is the only thing standing between
 * the two unions. Typing the published value as the closed union instead would
 * make CV-01 unreachable and its test vacuous, which is the shape M01 section
 * 8.4 and this repository's mutant discipline both exist to refuse.
 */
export type PublishedDrawdownType = 'trailing_eod' | 'static' | 'intraday_trailing';

/** `plan_versions.rules.*.drawdown`. Ratio in bp; the cents live on the size row. */
export interface PublishedDrawdown {
  /** CV-01. */
  readonly type: PublishedDrawdownType;
  /** Materialized to `plan_version_sizes.drawdown_cents` at publish. CV-02. */
  readonly amount_bp: number;
  readonly lock: PublishedFloorLock;
}

/**
 * `plan_versions.rules.*.drawdown.lock`.
 *
 * BOTH CENTS FIELDS ARE `null` ON ALL THREE V1 PLANS and that is not an
 * omission: DATA_MODEL section 11's example carries `"lock": { "enabled": true,
 * "at_profit_cents": null, "floor_at_cents": null }` on `phase_funded`, and the
 * values live on `plan_version_sizes.floor_lock_at_profit_cents` and
 * `floor_lock_floor_at_cents` because they scale with size. The fields are
 * carried here because the jsonb carries them, and CV-11 and CV-12 read the
 * SIZE ROW.
 */
export interface PublishedFloorLock {
  readonly enabled: boolean;
  readonly at_profit_cents: Cents | null;
  readonly floor_at_cents: Cents | null;
}

/** CV-16's vocabulary. The amount is a ratio here and cents on the size row. */
export interface PublishedDailyLossLimit {
  readonly type: string;
  readonly amount_bp: number | null;
}

/** CV-06. `mode` is explicit "so nobody has to remember which phase behaves how". */
export interface PublishedConsistency {
  readonly enabled: boolean;
  readonly max_day_share_bp: number | null;
  readonly mode: 'pass_time_dilutable' | 'payout_gated';
}

/** CV-09's structural half. An array from day one, per DATA_MODEL section 11. */
export interface PublishedCapScheduleStep {
  readonly from_ordinal: number;
  readonly cap_bp: number;
}

/** `plan_versions.rules.phase_eval`. */
export interface PublishedEvalPhase {
  readonly enabled: boolean;
  /** CV-03's precondition is `enabled`; the cents are on the size row. */
  readonly profit_target_bp: number;
  readonly drawdown: PublishedDrawdown;
  readonly daily_loss_limit: PublishedDailyLossLimit;
  /** CV-04. */
  readonly min_trading_days: number;
  /** R-28, pass-time and dilutable. */
  readonly consistency: PublishedConsistency;
  /** R-32. `null` means unlimited, which is every v1 plan. */
  readonly max_days: number | null;
}

/** `plan_versions.rules.phase_funded.win_days`. CV-05. */
export interface PublishedWinDays {
  readonly required_count: number;
  /** Materialized to `plan_version_sizes.win_day_floor_cents`. */
  readonly floor_bp: number;
  readonly reset_on_payout: boolean;
}

/** `plan_versions.rules.phase_funded`. */
export interface PublishedFundedPhase {
  readonly drawdown: PublishedDrawdown;
  readonly daily_loss_limit: PublishedDailyLossLimit;
  /** CV-19. Zero DISABLES the gate; it does not set it low. */
  readonly min_trading_days: number;
  readonly win_days: PublishedWinDays;
  readonly consistency: PublishedConsistency;
  /** Materialized to `plan_version_sizes.buffer_cents`. CV-07. */
  readonly buffer_bp: number;
  /** CV-08. */
  readonly cadence_gap_trading_days: number;
  /**
   * PW-02a and PW-02b's settlement term, at ADR-019's v1 value of `0`.
   *
   * DATA_MODEL SECTION 11's EXAMPLE DOES NOT CARRY THIS KEY AND M01 SECTION 2.4
   * REQUIRES IT TO EXIST, which is a disagreement between two approved documents
   * rather than a shape decision this file is making. M01: "It remains A
   * PUBLISHED CONFIGURATION CONSTANT RATHER THAN A LITERAL IN ENGINE CODE, for
   * the same reason it always was: a future change to the settlement model
   * re-runs this comparison instead of quietly invalidating it."
   *
   * So writing `0` inside `publishDiff` would violate the sentence that made the
   * field config in the first place, and the field is declared here on M01's
   * authority. The gap is reported rather than folded: a frozen document moves
   * by ADR and not by a commit that needed a key.
   */
  readonly min_settlement_lag_trading_days: number;
  /** CV-09, CV-10, CV-17. Materialized to `payout_cap_schedule_cents`. */
  readonly payout_cap_schedule: readonly PublishedCapScheduleStep[];
  /**
   * CV-15, and THE ONE CENTS VALUE THAT LIVES IN `rules` RATHER THAN ON THE SIZE
   * ROW. Appendix A's preamble: "`min_payout_cents` never does" scale by size,
   * so there is nothing per size to materialize.
   */
  readonly min_payout_cents: Cents;
  /** CV-13. */
  readonly split_bp: number;
  /** CV-14, under ADR-030's canonical name. */
  readonly max_payouts: number;
  /** CV-18. Retired but retained, per ADR-014. */
  readonly post_payout_floor_rule: { readonly mode: string };
}

/**
 * `plan_versions.rules`, transcribed from DATA_MODEL section 11.
 *
 * `limits` and `kyc` are in the stored jsonb and are NOT here. M01 section 1.2
 * puts entitlement and KYC outside this module, and a type that carried them
 * would invite a rule to read them. What `validatePlan` may not see, it may not
 * validate, and neither key has a `CV-nn`.
 */
export interface PlanRulesJson {
  readonly schema_version: 1;
  readonly phase_eval: PublishedEvalPhase;
  readonly phase_funded: PublishedFundedPhase;
}

/** One row of `plan_version_sizes.payout_cap_schedule_cents`. */
export interface SizeCapScheduleStep {
  readonly from_ordinal: number;
  readonly cap_cents: Cents;
}

/**
 * One row of `plan_version_sizes`, transcribed column for column from
 * `0004_catalog.sql`.
 *
 * MONEY IS `Cents` HERE AND `number` IN `test/generators/plan-config.ts`, and
 * the difference is deliberate on both sides. INV-02 is "all money is `bigint`
 * integer cents AT EVERY BOUNDARY", and a publish validator is a boundary. The
 * generator emits `number` for the same reason `day-input.ts` emits `tradedDay`
 * and `winDay`: it models rows a database can hold, not values the engine reads.
 *
 * `price_cents` AND `reset_price_cents` ARE COLUMNS AND ARE NOT HERE. No `CV-nn`
 * mentions either, no rule reads a price, and M01 section 1.2 puts commerce
 * outside this module. A validator that could see the price could grow a rule
 * about it.
 */
export interface PlanVersionSizeRow {
  /**
   * `plan_version_sizes.plan_version_id`, and it is here because
   * `ResolvedPlan.planVersionId` has to come from somewhere. INV-16: "An
   * account's `plan_version_id` is an input and is NEVER CHOSEN BY THE ENGINE."
   * Reading it off the size row is that invariant in the signature: `resolvePlan`
   * carries the identity forward and has no way to invent one.
   */
  readonly plan_version_id: PlanVersionId;
  readonly size_cents: Cents;
  /** CV-02, materialized. ONE COLUMN, and `rules` declares a drawdown PER PHASE. */
  readonly drawdown_cents: Cents;
  /** CV-03, materialized. `null` on Direct: no evaluation, so no target. */
  readonly profit_target_cents: Cents | null;
  /** CV-07, CV-11. */
  readonly buffer_cents: Cents;
  /** CV-05, materialized from `floor_bp`. */
  readonly win_day_floor_cents: Cents;
  /** CV-09, CV-10, CV-17. */
  readonly payout_cap_schedule_cents: readonly SizeCapScheduleStep[];
  /** CV-16, materialized. ONE COLUMN, and `rules` declares a limit PER PHASE. */
  readonly daily_loss_limit_cents: Cents | null;
  /** SD-10, materialized from `rules.phase_funded.drawdown.lock.enabled`. */
  readonly floor_lock_enabled: boolean;
  /** CV-12. Present exactly when `floor_lock_enabled` (SD-10's CHECK). */
  readonly floor_lock_at_profit_cents: Cents | null;
  /** CV-11, CV-12. Present exactly when `floor_lock_enabled`. */
  readonly floor_lock_floor_at_cents: Cents | null;
}

// -----------------------------------------------------------------------------
// What `validatePlan` returns
// -----------------------------------------------------------------------------
// THREE CHANNELS, BECAUSE M01 STATES THREE DIFFERENT KINDS OF FINDING and
// collapsing them would destroy the distinction section 2.4 spends a paragraph
// defending: "a diff whose every line says warning trains its reader to skim."

/** The nineteen publish validations of M01 section 2.4. Every one BLOCKS. */
export type CvId =
  | 'CV-01'
  | 'CV-02'
  | 'CV-03'
  | 'CV-04'
  | 'CV-05'
  | 'CV-06'
  | 'CV-07'
  | 'CV-08'
  | 'CV-09'
  | 'CV-10'
  | 'CV-11'
  | 'CV-12'
  | 'CV-13'
  | 'CV-14'
  | 'CV-15'
  | 'CV-16'
  | 'CV-17'
  | 'CV-18'
  | 'CV-19';

/** M01 section 2.4's publish-diff messages. None blocks. */
export type PwId = 'PW-01' | 'PW-02a' | 'PW-02b' | 'PW-03' | 'PW-04';

/**
 * A materialization disagreement: `plan_version_sizes` does not say what
 * `plan_versions.rules` says.
 *
 * THESE CARRY NO `CV-nn` AND M01's TABLE DOES NOT ENUMERATE THEM, which is
 * exactly why they are reported on their own channel rather than filed under a
 * neighbouring rule. `0004_catalog.sql` is the primary source that puts the
 * check at publish: "The publish path writes both, and CV-publish validation
 * asserts the materialized flag matches the parent's jsonb." That sentence is
 * about SD-10's `floor_lock_enabled` and the same shape recurs twice more.
 *
 * They BLOCK, and the reason is FM-07: "Plan config published with impossible
 * values ... Accounts permanently ineligible while looking healthy, or a gate
 * that does nothing." A size row that disagrees with its rules is a plan whose
 * published text and executed arithmetic are different plans.
 */
export type MaterializationId = 'MZ-lock-flag' | 'MZ-per-phase' | 'MZ-cap-ordinals';

export interface CvViolation {
  readonly id: CvId;
  /** Where it was found, so the publish error names the field and not the rule alone. */
  readonly path: string;
  readonly detail: string;
  /** `size_cents` of the row it was found on, or `null` for a rules-only finding. */
  readonly sizeCents: Cents | null;
}

export interface MaterializationFinding {
  readonly id: MaterializationId;
  readonly path: string;
  readonly detail: string;
  readonly sizeCents: Cents | null;
}

/** M01 section 2.4: `info` is worth seeing, `warning` is a gate that cannot bind. */
export type PublishDiffSeverity = 'info' | 'warning';

export interface PublishDiff {
  readonly id: PwId;
  readonly severity: PublishDiffSeverity;
  readonly message: string;
  readonly sizeCents: Cents | null;
}

/**
 * What `POST /admin/plans/versions/:id/publish` reads.
 *
 * `ok` IS DERIVED AND IS NOT A FOURTH FACT. It is `errors.length === 0 &&
 * materialization.length === 0`, carried so a caller cannot publish by checking
 * the wrong list. M01: "A config that reaches an account is a config that
 * already passed all of these."
 */
export interface ValidationResult {
  readonly ok: boolean;
  readonly errors: readonly CvViolation[];
  readonly materialization: readonly MaterializationFinding[];
  readonly diffs: readonly PublishDiff[];
}

// -----------------------------------------------------------------------------
// The day's inputs
// -----------------------------------------------------------------------------

/**
 * Exactly the live row from `daily_marks` (M01 section 2.1).
 *
 * `tradedDay` and `winDay` are NOT here and `0014_marks.sql` stores both. They
 * are stored because the batch writes what it observed; the engine DERIVES them
 * (R-08 is `fill_count > 0`, R-09 is `realized_pnl_cents >= win_day_floor_cents`
 * at the account's pinned plan), and an engine that read them would be an engine
 * whose breach and win-day arithmetic depended on the ingester agreeing with it.
 * `test/generators/day-input.ts` emits them because a generator emits rows the
 * database can hold; the fold reads the columns the rules are stated against.
 */
export interface DailyMark {
  readonly tradingDay: TradingDay;
  readonly openingBalanceCents: Cents;
  readonly closingBalanceCents: Cents;
  readonly highBalanceCents: Cents;
  readonly lowBalanceCents: Cents;
  /** Signed, from fills only. */
  readonly realizedPnlCents: Cents;
  /** SD-01. Signed non-trading movement, applied BETWEEN sessions (R-10). */
  readonly adjustmentCents: Cents;
  readonly fillCount: number;
  readonly sourceHash: string;
}

/** M01 section 2.1. Consumed at DO-2 by `applySettlement`, which is group H. */
export interface SettlementFact {
  readonly payoutRequestId: string;
  /** `payoutsSettledCount + 1` at request time (R-45). */
  readonly ordinal: number;
  readonly approvedCents: Cents;
  /** What the decision was computed against (R-46, R-47). */
  readonly basisTradingDay: TradingDay;
  /** First trading day whose opening balance reflects the withdrawal (SD-03). */
  readonly effectiveTradingDay: TradingDay;
}

/**
 * One trading day for one account, and everything the fold is allowed to read.
 *
 * `calendar` is a `CalendarSlice` rather than M01's single `CalendarDay`, which
 * is the widening ADR-049 authorises: R-37 counts a cadence gap by sequence
 * subtraction from an anchor that may be months old, and R-47 needs the trading
 * day AFTER a basis day, and neither is computable from one row.
 */
export interface DayInput {
  readonly engineVersion: string;
  readonly plan: ResolvedPlan;
  /** `null` only on the account's first trading day. */
  readonly prior: RuleState | null;
  readonly mark: DailyMark;
  readonly calendar: CalendarSlice;
  /** Those whose `effectiveTradingDay` equals `mark.tradingDay`. */
  readonly settlements: readonly SettlementFact[];
  /**
   * `accounts.opened_on`, R-32's anchor. THE M01 SECTION 2.1 AMENDMENT, and the
   * whole of what ADR-051 added to this interface.
   *
   * IT IS THE FIRST TRADEABLE DAY, NOT THE PURCHASE DAY, and the distinction is
   * the ruling rather than a detail. An account sits `provisioning_pending` from
   * `purchase.paid`, so a clock anchored at the purchase would charge the trader
   * for Merit's own provisioning latency. ADR-051: `opened_on` "is set when the
   * account reaches `active`, not when the purchase is paid".
   *
   * REQUIRED, NEVER OPTIONAL. An optional anchor makes R-32 silently not fire on
   * the day a caller forgets it, which is a rule that reads as enforced and
   * expires nobody: the exact shape `accounts.expires_on` was rejected for.
   */
  readonly openedOn: TradingDay;
}

// -----------------------------------------------------------------------------
// The day's outputs
// -----------------------------------------------------------------------------

export type Phase = 'eval' | 'funded' | 'closed' | 'graduated';

export type BreachKind = 'trailing_eod_floor' | 'static_floor' | 'hard_daily_loss_limit';

// -----------------------------------------------------------------------------
// The engine gates (R-33 to R-39), gate by gate
// -----------------------------------------------------------------------------
// M01 section 4: "The gate-breakdown response is A PRODUCT FEATURE, NOT DEBUG
// OUTPUT. Competitors show a progress bar; Merit shows the whole rule, including
// the exact amount of additional profit that would fix a consistency shortfall."
// So every gate below carries the two numbers that made its verdict and not just
// the verdict, and the field names are API_CONTRACT's
// `GET /accounts/:id/eligibility` shape in this package's camel case.
//
// `skipped` IS NOT `!pass` AND IT IS NOT `!enabled`. CV-19 fixed the vocabulary:
// a gate that was NOT EVALUATED reports `pass: true, skipped: true` and "must be
// visibly disabled in the eligibility breakdown ... so no trader or support
// agent ever sees a gate that reads as satisfied when it was never evaluated".

/** R-33. `tradedDaysCount >= min_trading_days`, and 0 DISABLES the gate (CV-19). */
export interface TradedDaysGate {
  readonly pass: boolean;
  /** CV-19, ADR-015: `true` on all three v1 plans, where the minimum is 0. */
  readonly skipped: boolean;
  readonly have: number;
  readonly need: number;
}

/** R-34. `winDaysCount >= required_count`, counted strictly after `payoutAnchorDay`. */
export interface WinDaysGate {
  readonly pass: boolean;
  readonly have: number;
  readonly need: number;
  /** R-09's threshold, carried so the breakdown says what counts as a win day. */
  readonly floorCents: Cents;
}

/** R-35 in its gate form: has the balance cleared the permanent buffer. */
export interface BufferGate {
  readonly pass: boolean;
  /** `balance - size`: the profit standing above the account size. */
  readonly haveCents: Cents;
  /** `buffer_cents`, which is permanent and never withdrawable. */
  readonly needCents: Cents;
}

/** R-36 over the R-47 period, using R-29's arithmetic and R-30's denominator rule. */
export interface ConsistencyGate {
  readonly pass: boolean;
  /** R-30. The period profit was not positive, so nothing was evaluated. */
  readonly skipped: boolean;
  readonly bestDayShareBp: number | null;
  readonly maxDayShareBp: number | null;
  /** AS-13, OQ-9: displayed AT ALL TIMES, not only when the gate fails. */
  readonly profitNeededToDiluteCents: Cents;
}

/** R-37. Trading days strictly after `cadenceAnchorDay`, by `sequence` subtraction. */
export interface CadenceGapGate {
  readonly pass: boolean;
  /** `true` when there is no anchor: the first payout has no gap to clear. */
  readonly skipped: boolean;
  /** `null` when skipped. Never a date difference (AS-06). */
  readonly tradingDaysSinceLastPayout: number | null;
  readonly need: number;
  /**
   * AS-06's resolved date, so the trader never does trading-day arithmetic.
   *
   * `null` when the gate is not waiting on anything, and `null` when the day
   * falls outside the slice the caller loaded. A REPORTED date, never compared.
   */
  readonly nextEligibleTradingDay: TradingDay | null;
}

/** R-39. `min(withdrawable, cap) >= min_payout_cents`, `>=` (GS-042). */
export interface MinimumAmountGate {
  readonly pass: boolean;
  readonly withdrawableCents: Cents;
  /** R-42's rung for the ordinal this state would request at. */
  readonly capCents: Cents;
  /** CV-15. 10,000c, fixed, and never scaled by size. */
  readonly minPayoutCents: Cents;
}

// -----------------------------------------------------------------------------
// The context gates (R-38, R-40), which are NEVER part of the replayed state
// -----------------------------------------------------------------------------
// INV-23: "Context gates (frozen, recon, KYC, in flight) NEVER ENTER THE
// REPLAYED STATE OR ITS HASH", and SD-06 splits `gate_results` in two for the
// same reason: "they were true on the day and may not be true now. Mixing them
// into the replayed state guarantees NIGHTLY FALSE DIVERGENCES."
//
// So nothing below appears on `RuleState`. It is computed at read time by
// `evaluatePayout` from an `ExternalGates` the caller supplies, and it is
// combined with the engine gates only in the returned evaluation.
//
// R-38's membership is RULED and no longer asserted here on this file's own
// authority. ADR-060 rules Reading A: `engineEligible` is the closed six
// R-33, R-34, R-35, R-36, R-37 and R-39, enumerated under INV-15 in M01
// section 1.5, and R-38 binds through `contextEligible`. M01's Group F is
// topical and contains both kinds, which is why the range "R-33 to R-41"
// never was the enumeration.

/** M01 section 2.1's `accounts.status` vocabulary. */
export type AccountStatus =
  'active' | 'breached' | 'expired' | 'closed_admin' | 'closed_chargeback' | 'graduated';

/** M01 section 2.1's KYC vocabulary. D-M19-1 supplies it at read time. */
export type KycState = 'kyc_required' | 'pending' | 'verified' | 'rejected' | 'expired';

/**
 * Context, never replayed (INV-23). Every field is resolved by the CALLER.
 *
 * M01 section 2.1 verbatim, and two fields carry a note that is part of the
 * contract rather than commentary: `payoutsFrozen` is "account level OR identity
 * level, RESOLVED BY THE CALLER", and `hasPayoutInFlight` is an outstanding
 * external-leg withdrawal for this identity.
 */
export interface ExternalGates {
  readonly accountStatus: AccountStatus;
  readonly kycState: KycState;
  /** Account level OR identity level, already resolved. */
  readonly payoutsFrozen: boolean;
  readonly reconBlocked: boolean;
  /** R-38. An outstanding external-leg withdrawal exists for this identity. */
  readonly hasPayoutInFlight: boolean;
}

/** R-40. Account `active` AND phase `funded`. */
export interface AccountActiveGate {
  readonly pass: boolean;
  readonly status: AccountStatus;
  /** The engine half of R-40's first clause, reported so a failure is legible. */
  readonly phase: Phase;
}

/** R-40. D-M19-1: "KYC state is supplied as a context gate at read time." */
export interface KycVerifiedGate {
  readonly pass: boolean;
  readonly state: KycState;
}

/** R-40. The engine cannot say WHICH level froze the payout, and says so. */
export interface NotFrozenGate {
  readonly pass: boolean;
  readonly reason: string | null;
}

/** R-40. FM-04's `recon_blocked` excludes an account from eligibility. */
export interface ReconClearGate {
  readonly pass: boolean;
}

/**
 * R-40's four gates, in API_CONTRACT's `GET /accounts/:id/eligibility` order.
 *
 * R-38 IS NOT ONE OF THEM AND THAT IS API_CONTRACT's SHAPE RATHER THAN AN
 * OMISSION. See `PayoutEvaluation.noPayoutInFlight`.
 */
export interface ContextGateResults {
  readonly accountActive: AccountActiveGate;
  readonly kycVerified: KycVerifiedGate;
  readonly notFrozen: NotFrozenGate;
  readonly reconClear: ReconClearGate;
}

/**
 * SD-06's `engine_gates`. Every gate R-41 conjoins, and nothing that is context.
 *
 * THE ORDER OF THE FIELDS IS THE ORDER `engineEligible` READS THEM, which
 * matters because SD-08's canonical serialization hashes fields in a fixed
 * declared order and the determinism contract bans "iteration over an object's
 * keys where the result affects output".
 */
export interface EngineGateResults {
  readonly tradedDays: TradedDaysGate;
  readonly winDays: WinDaysGate;
  readonly buffer: BufferGate;
  readonly consistency: ConsistencyGate;
  readonly cadenceGap: CadenceGapGate;
  readonly minimumAmount: MinimumAmountGate;
}

/**
 * One row of `rule_states`: the whole fold accumulator, minus the three field
 * groups named at the top of this section.
 */
export interface RuleState {
  readonly tradingDay: TradingDay;
  readonly phase: Phase;
  readonly balanceCents: Cents;
  /** SD-04. The floor THIS day's breach check compared against (R-18). */
  readonly floorOpenCents: Cents;
  /** The floor carried into the next day. */
  readonly floorCents: Cents;
  readonly floorLocked: boolean;
  readonly highWaterBalanceCents: Cents;
  /**
   * R-35. `max(0, balance - size - buffer)`, and `0n` outside the funded phase.
   *
   * INV-05 is that this is NEVER negative, and the formula is where that is
   * enforced rather than a check downstream of it.
   */
  readonly withdrawableCents: Cents;
  /** Phase scoped (R-33). */
  readonly tradedDaysCount: number;
  /** Anchor scoped (R-34, R-47). */
  readonly winDaysCount: number;
  readonly consistencyBestDayCents: Cents;
  readonly consistencyPeriodProfitCents: Cents;
  /** SD-07. `null` before any period has been anchored. */
  readonly consistencyPeriodStartDay: TradingDay | null;
  readonly payoutsSettledCount: number;
  /** SD-02. Basis day of the last settled payout (R-46). */
  readonly payoutAnchorDay: TradingDay | null;
  /** SD-02. Wallet-credit day of the last settled payout (R-46, ADR-019). */
  readonly cadenceAnchorDay: TradingDay | null;
  readonly lifetimeSettledCents: Cents;
  /** SD-06. Engine gates only: context is combined at read time (INV-23). */
  readonly engineGates: EngineGateResults;
  /** R-41, INV-15. The conjunction of every gate above, with no shortcut path. */
  readonly engineEligible: boolean;
  readonly breached: boolean;
  readonly breachKind: BreachKind | null;
  readonly engineVersion: string;
}

/**
 * The engine gates plus the context gates, in API_CONTRACT's
 * `GET /accounts/:id/eligibility` shape (M01 section 2.2).
 *
 * R-38 IS ABSENT AND THAT IS THE PUBLISHED SHAPE. API_CONTRACT's `gates` object
 * carries no in-flight entry; the condition surfaces as `POST`'s `conflict`
 * error and as the SD-09 partial unique index. `PayoutEvaluation` reports R-38's
 * verdict on its own field so the rule still binds without widening a contract
 * other modules render.
 */
export interface FullGateResults extends ContextGateResults, EngineGateResults {}

/** R-43's four values, and `none` is an EXACT TIE rather than an absence. */
export type ClampReason = 'none' | 'cap' | 'withdrawable' | 'requested';

/**
 * What `evaluatePayout` returns to both payout endpoints (M01 section 2.2).
 *
 * NOTHING HERE IS EVER STORED IN `rule_states`. INV-23 keeps the context half
 * out of the replayed state, and SD-06 is the column split that enforces it. A
 * settled payout's `eligibility_snapshot` is a serialization of this value, and
 * INV-22 makes that snapshot append-only: "the snapshot is what was true when
 * the money moved, and an upgrade cannot retroactively make a payment wrong."
 */
export interface PayoutEvaluation {
  /** R-06. The last closed day, and never anything more recent. */
  readonly asOfTradingDay: TradingDay;
  readonly engineEligible: boolean;
  readonly contextEligible: boolean;
  /** R-41. `engineEligible && contextEligible`, with no shortcut path. */
  readonly eligible: boolean;
  readonly gates: FullGateResults;
  /** R-38. Reported separately because API_CONTRACT's `gates` has no slot. */
  readonly noPayoutInFlight: { readonly pass: boolean };
  /** `min(withdrawable, cap)`, and `0n` when not eligible. */
  readonly maxPayoutCents: Cents;
  readonly capCents: Cents;
  /** R-45. `payoutsSettledCount + 1`. */
  readonly ordinal: number;
  /** CV-15. Carried so a caller never re-reads config to render the floor. */
  readonly minPayoutCents: Cents;
  /** R-43 and R-44. The amount and its split, computed whatever the verdict. */
  readonly clamp: {
    readonly effectiveRequestCents: Cents;
    readonly approvedCents: Cents;
    readonly reason: ClampReason;
    readonly traderCents: Cents;
    readonly firmCents: Cents;
    readonly splitBp: BasisPoints;
  };
}

/**
 * A `RuleState` with the two fields group F computes removed.
 *
 * NOTHING THAT COMPUTES A GATE MAY READ ONE. INV-15 is "`engine_eligible ==
 * AND(every engine gate)` with NO SHORTCUT PATH", and the cheapest shortcut
 * there is would be an evaluator that carried a prior row's answer forward on
 * some branch. Taking the fields out of the parameter type makes that a compile
 * error rather than a review note, which is the same idiom
 * `PlanConfigVersionIsClosed` and `CalendarSliceIsData` use one file over.
 *
 * It is also what lets `initialState` build a state in one pass: the gates are
 * computed from the record that does not yet carry them, so there is no
 * placeholder gate set for a later edit to leave behind.
 */
export type GateInputState = Omit<RuleState, 'engineGates' | 'engineEligible'>;

/**
 * Why the engine refused to compute a day.
 *
 * THE ENGINE REFUSES RATHER THAN GUESSING, and it refuses without throwing.
 * M01 FM-05: "This is the one place the engine refuses to compute rather than
 * computing something plausible." ADR-049 extends the same channel to a
 * calendar lookup that lands outside coverage, "identical to DO-3's INV-18
 * handling: no state is written for the day, reconciliation is raised, and
 * nothing throws".
 *
 * WHEN AN `AssertionFailure` IS RETURNED, NO STATE IS WRITTEN FOR THE DAY. The
 * `state` on the output is the state the fold arrived with, carried so the
 * caller can report which day refused and against what.
 */
export type AssertionKind =
  /** INV-18. `opening == prior.balance + adjustment` (R-07, EC-047). */
  | 'opening_mismatch'
  /** INV-19. `closing == opening + realized_pnl`. */
  | 'closing_mismatch'
  /** INV-20. The first funded mark opens at exactly `size_cents` (AS-14). */
  | 'funded_start_not_size'
  /** DO-1. The account is `closed` or `graduated`; breach is terminal (R-24). */
  | 'account_closed'
  /** DO-1. The mark is not strictly after the prior state's day (INV-14). */
  | 'not_forward'
  /** DO-1, FM-13. The day is inside coverage and is not a session. */
  | 'day_not_a_session'
  /** ADR-049. The day is outside the slice's coverage, so the answer is UNKNOWN. */
  | 'calendar_coverage_miss'
  /**
   * DO-8. The state claims the eval phase on a plan that has no eval phase.
   *
   * `eval_expiry_unimplemented` STOOD HERE AND IS RETIRED BY ADR-051, which is a
   * deletion rather than a rename. It meant "`max_days` is set and R-32 is not
   * computable", and R-32 is computable now. The case that replaced it is an
   * anchor the slice cannot answer for, which is `calendar_coverage_miss`
   * already: the same refusal R-37 raises, for the same reason, rather than a
   * second kind meaning the same thing. A retired kind kept "just in case" is a
   * branch every consumer writes and nothing ever takes.
   */
  | 'eval_phase_without_eval_rules';

export interface AssertionFailure {
  readonly kind: AssertionKind;
  readonly tradingDay: TradingDay;
  /** Present on the arithmetic identities, which are the ones with two numbers. */
  readonly expected?: Cents;
  readonly got?: Cents;
  /** Prose naming the finding, so a page says what refused rather than that something did. */
  readonly detail: string;
}

export interface DayOutput {
  readonly state: RuleState;
  /** Facts, in emission order (M01 section 5). */
  readonly events: readonly EngineEvent[];
  /** Non-empty means NO STATE IS WRITTEN for this day and reconciliation is raised. */
  readonly assertions: readonly AssertionFailure[];
}

// -----------------------------------------------------------------------------
// The events the day fold emits
// -----------------------------------------------------------------------------
// M01 section 5.2, and every payload below is that table's. NO EVENT CARRIES AN
// ACCOUNT ID: `DayInput` does not contain one, because the fold is per account
// by construction and the caller that supplied the marks is the one that knows
// whose they are.

/** DO-9, once per account per trading day. */
export interface DayClosedEvent extends EngineEventBase {
  readonly type: 'day.closed';
  readonly closingBalanceCents: Cents;
  /** SD-01, carried because a settled payout is not a trading loss (AS-10). */
  readonly adjustmentCents: Cents;
  /** SD-04, so the evidence pack can show WHICH floor the day was judged against. */
  readonly floorOpenCents: Cents;
  readonly floorCents: Cents;
  readonly tradedDaysCount: number;
  readonly winDaysCount: number;
  /** SD-07. */
  readonly consistencyPeriodStartDay: TradingDay | null;
  /** R-35, so a consumer never recomputes a payable amount (FM-16). */
  readonly withdrawableCents: Cents;
  /**
   * M01 section 5.2: `day.closed` "carries the full mark payload PLUS
   * `gate_results`".
   *
   * ENGINE GATES ONLY, which is SD-06 rather than an omission: the context gates
   * "were true on the day and may not be true now", so an event carrying them
   * would hand every consumer a freeze state with no expiry. `engine.gate_
   * failure_distribution` (section 9.1), which M01 calls "the most useful product
   * metric in the system", is read off exactly this payload.
   */
  readonly engineGates: EngineGateResults;
  readonly engineEligible: boolean;
}

/** DO-5. */
export interface BreachDetectedEvent extends EngineEventBase {
  readonly type: 'breach.detected';
  readonly breachKind: BreachKind;
  readonly lowBalanceCents: Cents;
  /** The floor at the open, which is the one the decision compared against (R-18). */
  readonly floorCents: Cents;
  /** How far under. Zero on a daily-loss-limit breach, where the floor was not the cause. */
  readonly shortfallCents: Cents;
}

/** R-15. The lock is permanent and changes the trader's risk profile for good. */
export interface FloorLockedEvent extends EngineEventBase {
  readonly type: 'rule.floor_locked';
  readonly atProfitCents: Cents;
  readonly lockedFloorCents: Cents;
}

/** R-23. A fact, never a breach. Enforcement, if any, is the platform's. */
export interface SoftDailyLossLimitEvent extends EngineEventBase {
  readonly type: 'rule.soft_dll_exceeded';
  readonly realizedPnlCents: Cents;
  readonly limitCents: Cents;
}

/**
 * DO-8, R-31. The eval passed and the funded reset is applied in the same step.
 *
 * EVENTS.md's payload is `{ account_id, from_phase, to_phase, trading_day,
 * closing_balance_cents, target_cents, consistency: { best_day_share_bp,
 * max_bp, satisfied } }`, and this carries all of it but `account_id`, for the
 * reason stated at the top of this section.
 *
 * M01 section 5.2: "Includes the funded reset values, so the trader's own
 * timeline shows the balance returning to size AND WHY." So the reset's three
 * numbers travel with it rather than being re-derived by a consumer from the
 * plan, which is the client-recomputes-a-rule failure FM-16 names.
 *
 * `closingBalanceCents` IS THE EVAL DAY'S CLOSE AND `resetBalanceCents` IS
 * `size_cents`. They are different numbers on purpose: R-31 is "the single
 * largest trader-facing fact in this document", and an event that carried only
 * one of them could not say what was lost.
 */
export interface PhasePassedEvent extends EngineEventBase {
  readonly type: 'phase.passed';
  readonly fromPhase: 'eval';
  readonly toPhase: 'funded';
  /** The eval day's own close, before the reset. */
  readonly closingBalanceCents: Cents;
  /** R-26's right-hand side, so the payload states the target it cleared. */
  readonly targetCents: Cents;
  /** R-31's funded reset values. */
  readonly resetBalanceCents: Cents;
  readonly resetFloorCents: Cents;
  readonly consistencyPeriodStartDay: TradingDay;
  /** R-28's verdict at pass time. `null` shares mean disabled or skipped (R-30). */
  readonly consistency: {
    readonly bestDayShareBp: number | null;
    readonly maxDayShareBp: number | null;
    readonly satisfied: boolean;
    readonly skipped: boolean;
  };
}

/**
 * R-47. The win-day counter reset at settlement, anchored to the BASIS day.
 *
 * M01 section 5.2: the payload "carries `previous_count`, `reset_to`, and now
 * also `anchor_trading_day`, because 'reset to zero' WITHOUT THE ANCHOR IS NOT
 * ENOUGH TO EXPLAIN THE NEXT CYCLE".
 */
export interface WinDaysResetEvent extends EngineEventBase {
  readonly type: 'payout.win_days_reset';
  readonly previousCount: number;
  readonly resetTo: number;
  /** The settled payout's basis day, which is what the next cycle counts from. */
  readonly anchorTradingDay: TradingDay;
  /** SD-07. The trading day STRICTLY after the anchor (AS-12). */
  readonly consistencyPeriodStartDay: TradingDay;
}

/**
 * R-49. The ladder is finished and the account closes.
 *
 * NO LIVE INVITATION TRAVELS WITH IT ([ADR-024](../../../docs/decisions/ADR-024.md)).
 * R-49: "the `graduation_eligible` flag set. NO LIVE INVITATION IS EMITTED:
 * eligibility is a review-pool flag, and invitation is a discretionary operator
 * action taken from that pool, OUTSIDE THE ENGINE."
 */
export interface AccountGraduatedEvent extends EngineEventBase {
  readonly type: 'account.graduated';
  readonly payoutsSettledCount: number;
  /** CV-14 under ADR-030's canonical name. The rung count that was reached. */
  readonly maxPayouts: number;
  /** R-50. INV-17 bounds it at `ladder * max cap in the schedule`. */
  readonly lifetimeSettledCents: Cents;
}

/**
 * R-32, DO-8. The evaluation ran out of trading days and the account closes.
 *
 * THE NAME AND PAYLOAD ARE `EVENTS.md`'s, NOT INVENTED HERE. The approved
 * catalogue carries `account.expired` with `{ account_id, trading_day,
 * expiry_rule }`. The account id is dropped for the reason stated above the
 * event section: `DayInput` carries none, because the fold is per account by
 * construction and the caller that supplied the marks is the one that knows
 * whose they are.
 *
 * IT IS ABSENT FROM M01 SECTION 5.2's TABLE, WHICH IS A GAP IN THAT TABLE AND
 * NOT A LICENCE TO INVENT ONE. Section 5.2 says "all exist in the approved
 * EVENTS.md catalogue except the two marked NEW", so the catalogue is the wider
 * set and M01's table simply never listed R-32's event while R-32 refused. The
 * catalogue entry is used verbatim rather than a ninth name being coined.
 */
export interface AccountExpiredEvent extends EngineEventBase {
  readonly type: 'account.expired';
  /**
   * `expiry_rule` from the catalogue. The rule that expired the account, so a
   * consumer reading the timeline is told WHICH limit ran out rather than being
   * left to infer it from the plan config as it stood at read time.
   */
  readonly expiryRule: 'R-32';
  /** Elapsed trading days as R-32 counted them, inclusive of the opening day. */
  readonly elapsedTradingDays: number;
  /** `phase_eval.max_days`, the limit that was exceeded. ADR-051: it binds. */
  readonly maxDays: number;
}

/**
 * DO-8, R-28. The target and the day count are met and consistency is not, so
 * the pass DEFERS.
 *
 * "An eval consistency violation NEVER FAILS AN ACCOUNT. It delays the pass, the
 * trader keeps trading, and every day the engine re-tests." The account stays in
 * `eval` and no state field moves, which is why this event is the only thing the
 * day emits about the progression.
 *
 * `shortfallCents` IS `profit_needed_to_dilute_cents` UNDER EVENTS.md's NAME.
 * The catalogue is a contract other modules read (M10 throttles this event to
 * once per account per week, and the copy rule is "explain the dilution mechanic
 * honestly"), so the field is spelled as the catalogue spells it and the
 * engine-side name is recorded here rather than in a translation layer.
 */
export interface PassDeferredConsistencyEvent extends EngineEventBase {
  readonly type: 'phase.pass_deferred_consistency';
  readonly bestDayShareBp: number;
  readonly maxDayShareBp: number;
  /** Additional period profit that would dilute the best day under the limit. */
  readonly shortfallCents: Cents;
}

// -----------------------------------------------------------------------------
// THE EVENT UNION, WHICH IS WHAT `DayOutput.events` ACTUALLY CONTAINS
// -----------------------------------------------------------------------------
// `DayOutput.events` and `SettlementOutput.events` are typed `readonly
// EngineEvent[]`, and until this alias existed `EngineEvent` was the BASE
// (`{ type: string; tradingDay }`). Every concrete event extended it and none of
// them was reachable from the array's type, so a consumer that wanted to read
// `closingBalanceCents` off a `day.closed` had to CAST, once per event type,
// with nothing checking that the cast matched the `type` string it was guarded
// by. `scripts/demo/render.ts` recorded that in its own words and walked
// `Object.entries` to avoid it.
//
// M01 SECTION 1.3's EXPORT LIMIT DOES NOT REACH THIS, and the distinction is the
// reason the limit exists. "The public surface is SIX FUNCTIONS. Nothing else is
// exported, because every additional export is A WAY FOR A CALLER TO REIMPLEMENT
// A RULE slightly differently." A union of the record shapes the engine already
// returns is not a rule a caller can reimplement: it computes nothing, decides
// nothing, and has no second implementation to drift from. What it removes is a
// cast, and an unchecked cast on a money-path payload is the thing the limit is
// protecting against, not an instance of it. The engine already exports all
// eight members individually; withholding only their union buys no safety and
// costs every consumer a cast.
//
// THERE ARE NINE MEMBERS. M01 section 5.2's table lists eleven names and three
// of them have no producer in the day fold: `payout.floor_recomputed` is
// "RETIRED AT THE M1 GATE" with no producer after ADR-014,
// `account.live_invitation_issued` is not emitted at all because ADR-024 makes
// invitation "a discretionary operator action ... OUTSIDE THE ENGINE", and
// `replay.divergence_detected` belongs to Appendix B's replay harness rather
// than to `advanceDay` or `applySettlement`. The nine below are exactly the nine
// `type` literals constructed in `day/advance.ts`, `day/progression.ts` and
// `payout/settle.ts`.
//
// THE NINTH IS `account.expired` AND IT CAME FROM THE CATALOGUE RATHER THAN
// FROM M01's TABLE, which is worth stating because the arithmetic above stops
// working otherwise. Section 5.2's eleven names do not include it, and R-32 is
// the rule that emits it. That is a gap in section 5.2 rather than a new event:
// section 5.2 declares "all exist in the approved EVENTS.md catalogue except the
// two marked NEW", so the catalogue is the wider set, and `account.expired` has
// sat in it with a stated payload the whole time R-32 refused. It is used as
// found. Eight of the nine appear in section 5.2's table; the ninth appears in
// the catalogue section 5.2 defers to.
//
// `EXHAUSTIVE_EVENT_TYPES` IS NOT DECLARED HERE ON PURPOSE. A second list of the
// same eight names is a second thing to forget to update, and the union already
// fails a `switch` with a `never` default when a member is added. The engine's
// own guard is `rules-engine-events.test.ts`, which asserts that every `type`
// literal the union admits is one the sources actually construct.

/**
 * Everything the day fold and settlement can emit, discriminated on `type`.
 *
 * The members are listed in M01 section 5.2's order rather than alphabetically,
 * so the union reads as the event catalogue it is.
 */
export type EngineEvent =
  | DayClosedEvent
  | BreachDetectedEvent
  | PhasePassedEvent
  | PassDeferredConsistencyEvent
  | AccountGraduatedEvent
  | AccountExpiredEvent
  | WinDaysResetEvent
  | FloorLockedEvent
  | SoftDailyLossLimitEvent;

/** Every `type` literal `EngineEvent` admits. Derived, never listed by hand. */
export type EngineEventType = EngineEvent['type'];
