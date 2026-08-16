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
 * Something the evaluation decided, emitted rather than written.
 *
 * The engine performs no I/O, so it does not persist an event; it returns one
 * and the caller writes it. M01 defines the event set, and `type` is a string
 * here rather than a union for exactly as long as that set is unwritten.
 */
export interface EngineEvent {
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
//   engineEligible, engineGates  R-33..R-41, group F, DO-9
//   stateHash                    SD-08, and `hash.ts`, which replay needs and
//                                the day fold does not
//
// Each lands with the rules that compute it, and widening a record nothing
// outside this package reads yet is a diff rather than a migration.
//
// `withdrawableCents` WAS ON THAT LIST AND HAS LANDED, ahead of the rest of
// group F and for a stated reason: M01 section 3.6's `clampPayout` reads it off
// the state, and P2 section 2 sequences group G (payout arithmetic, no calendar
// needed) BEFORE group F (which needs the full slice and real data). The field
// travels with the rule that computes it, R-35 in `payout/gates.ts`, and the two
// eligibility fields stay absent until the conjunction R-41 asserts has all of
// its terms.

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
}

// -----------------------------------------------------------------------------
// The day's outputs
// -----------------------------------------------------------------------------

export type Phase = 'eval' | 'funded' | 'closed' | 'graduated';

export type BreachKind = 'trailing_eod_floor' | 'static_floor' | 'hard_daily_loss_limit';

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
  readonly breached: boolean;
  readonly breachKind: BreachKind | null;
  readonly engineVersion: string;
}

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
  /** DO-2. `applySettlement` is group H and is not written. */
  | 'settlement_unimplemented'
  /** DO-8, R-32. `phase_eval.max_days` is set and eval expiry is not computable. */
  | 'eval_expiry_unimplemented'
  /** DO-8. The state claims the eval phase on a plan that has no eval phase. */
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
export interface DayClosedEvent extends EngineEvent {
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
}

/** DO-5. */
export interface BreachDetectedEvent extends EngineEvent {
  readonly type: 'breach.detected';
  readonly breachKind: BreachKind;
  readonly lowBalanceCents: Cents;
  /** The floor at the open, which is the one the decision compared against (R-18). */
  readonly floorCents: Cents;
  /** How far under. Zero on a daily-loss-limit breach, where the floor was not the cause. */
  readonly shortfallCents: Cents;
}

/** R-15. The lock is permanent and changes the trader's risk profile for good. */
export interface FloorLockedEvent extends EngineEvent {
  readonly type: 'rule.floor_locked';
  readonly atProfitCents: Cents;
  readonly lockedFloorCents: Cents;
}

/** R-23. A fact, never a breach. Enforcement, if any, is the platform's. */
export interface SoftDailyLossLimitEvent extends EngineEvent {
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
export interface PhasePassedEvent extends EngineEvent {
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
export interface PassDeferredConsistencyEvent extends EngineEvent {
  readonly type: 'phase.pass_deferred_consistency';
  readonly bestDayShareBp: number;
  readonly maxDayShareBp: number;
  /** Additional period profit that would dilute the best day under the limit. */
  readonly shortfallCents: Cents;
}
