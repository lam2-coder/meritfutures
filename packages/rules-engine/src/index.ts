// =============================================================================
// packages/rules-engine
// =============================================================================
// THE PUBLIC ENTRY POINT, and the only thing anything outside this package may
// import. STRATEGY section 2 makes that structural for one caller in
// particular: the golden fixture loader "reads a directory and imports the
// engine's public entry point only", which is what keeps TR-01 enforceable.
// A loader that can reach inside the package can compute an expected value from
// the implementation, and a fixture derived from the implementation proves only
// that the code agrees with itself.

export type {
  AccountId,
  AccountState,
  BasisPoints,
  Cents,
  DayMark,
  EngineEvent,
  EngineEventBase,
  EngineEventType,
  EngineInput,
  EngineResult,
  PlanConfigVersion,
  PlanVersionId,
  TradingDay,
} from './types.ts';

// -----------------------------------------------------------------------------
// M01's surface, as far as it is built
// -----------------------------------------------------------------------------
// M01 section 1.3 names six exported functions and says "nothing else is
// exported, because every additional export is a way for a caller to reimplement
// a rule slightly differently". ALL SIX ARE NOW HERE: `resolvePlan`,
// `validatePlan`, `initialState`, `advanceDay`, `applySettlement` and
// `evaluatePayout`.
//
// `clampPayout` IS DELIBERATELY NOT HERE AND M01 DISAGREES WITH ITSELF ABOUT IT.
// Section 3.6's reference algorithm writes `export function clampPayout`, and
// section 1.3's "nothing else is exported" does not list it among the six.
// Section 1.3 wins, so the clamp is reachable only through `evaluatePayout`,
// which is what M01 section 4 names for both endpoints and what makes "the
// identical function with the identical inputs" true rather than aspirational.
//
// `replay` IS THE OPPOSITE RULING ON THE IDENTICAL CONTRADICTION, and ADR-078 is
// why. Section 1.3's layout lists `replay.ts` exactly as it lists
// `payout/clamp.ts`, section 3.7 writes `export function replay`, and 1.3's
// prose does not list it among the six. THE BALANCE IS THE SAME AS THE CLAMP'S,
// so the site count cannot decide it: a file in a layout is not a vote for
// export, or `day/breach.ts` and `hash.ts` would be votes too.
//
// 1.3's RATIONALE decides it, and it points the other way here. "Every
// additional export is a way for a caller to reimplement a rule slightly
// differently" is SERVED by withholding the clamp, because `evaluatePayout`
// still reaches it and no capability is lost. It is DEFEATED by withholding
// `replay`, because no exported function reaches the whole-life fold, so every
// caller that needs one writes it: `apps/worker/src/batch/replay.ts` already
// did, with its own loop and its own break, which is precisely the second code
// path M01 3.7 says does not exist.
//
// `applySettlement` TAKES A FOURTH ARGUMENT M01's SIGNATURE DOES NOT SHOW, and
// ADR-049 is what authorises it: R-47 needs the trading day AFTER the basis day,
// P2 section 1 names this function while closing OQ-P2-01, and "neither rule can
// be computed from one row".
//
// `buildCalendarSlice` is a seventh name and is not a seventh rule: ADR-049
// requires the slice to be "built by a pure exported constructor", and a
// constructor a caller cannot reach is a value a caller cannot make.
//
// THE LIMIT IS ABOUT FUNCTIONS, AND `EngineEvent` IS A TYPE UNION. Section 1.3's
// reason is that "every additional export is A WAY FOR A CALLER TO REIMPLEMENT A
// RULE slightly differently"; a union of the record shapes `advanceDay` already
// returns computes nothing and has no second implementation to drift from. Every
// one of its eight members was already exported individually, so withholding the
// union bought no safety and cost every consumer an unchecked cast per event
// type on a money-path payload. See the note above the alias in `types.ts`.

export type {
  AccountActiveGate,
  AccountExpiredEvent,
  AccountGraduatedEvent,
  AccountStatus,
  AssertionFailure,
  AssertionKind,
  BreachDetectedEvent,
  BreachKind,
  BufferGate,
  CadenceGapGate,
  CalendarDay,
  CalendarSlice,
  CapScheduleStep,
  ConsistencyRules,
  DailyLossLimitRules,
  DailyMark,
  DayClosedEvent,
  DayInput,
  DayOutput,
  ClampReason,
  ConsistencyGate,
  ContextGateResults,
  CvId,
  CvViolation,
  DrawdownRules,
  DrawdownType,
  EngineGateResults,
  EvalPhaseRules,
  ExternalGates,
  FloorLockedEvent,
  FloorLockRules,
  FullGateResults,
  FundedPhaseRules,
  GateInputState,
  KycState,
  KycVerifiedGate,
  MinimumAmountGate,
  NotFrozenGate,
  PassDeferredConsistencyEvent,
  PayoutEvaluation,
  Phase,
  PhaseDayRules,
  ReconClearGate,
  PhasePassedEvent,
  MaterializationFinding,
  MaterializationId,
  PlanRulesJson,
  PlanVersionSizeRow,
  PublishDiff,
  PublishDiffSeverity,
  PublishedCapScheduleStep,
  PublishedConsistency,
  PublishedDailyLossLimit,
  PublishedDrawdown,
  PublishedDrawdownType,
  PublishedEvalPhase,
  PublishedFloorLock,
  PublishedFundedPhase,
  PublishedWinDays,
  PwId,
  ResolvedPlan,
  RuleState,
  SettlementFact,
  SizeCapScheduleStep,
  SoftDailyLossLimitEvent,
  TradedDaysGate,
  ValidationResult,
  WinDaysGate,
  WinDaysResetEvent,
} from './types.ts';

export {
  buildCalendarSlice,
  CalendarSliceError,
  lookupCalendarDay,
  nextTradingDayAfter,
} from './calendar.ts';
export type { CalendarLookup, CalendarSource } from './calendar.ts';

export { EngineInvariantError } from './errors.ts';

export { IMPLEMENTED_RULES } from './rules.ts';
export type { RuleId } from './rules.ts';

export { resolvePlan } from './plan/resolve.ts';
export { validatePlan } from './plan/validate.ts';

// `hash.ts` IS ADR-081, AND IT IS ADR-078's TEST APPLIED A SECOND TIME. Section
// 1.3's layout lists `hash.ts` exactly as it lists `payout/clamp.ts` and
// `replay.ts`, so the site count decides nothing here either; what decides it is
// whether withholding SERVES or DEFEATS "every additional export is a way for a
// caller to reimplement a rule slightly differently". `apps/worker/src/batch/
// state-hash.ts` was the second implementation, in the open, exactly as
// `apps/worker`'s own fold was for `replay`.
//
// SIX NAMES, GAINING EXACTLY TWO FUNCTIONS, and they are TWO CASES rather than
// six instances of one:
//
//   `stateHash`, `canonicalStateSerialization`, `HASHED_COLUMNS` and
//   `ENGINE_GATE_LEAVES` are DEFEATED BY WITHHOLDING IN PRODUCTION. Nothing
//   else computes the digest, `apps/worker/src/batch/replay.ts` walks the
//   column table at `:167` and the leaf table at `:173` to name which field
//   diverged, and withholding either table makes the batch hand-maintain a
//   second copy of C-07's order. `StateHashError` rides with them: it computes
//   nothing and has no second implementation to drift from, which is the
//   reasoning below for `EngineEvent` and ADR-078's for `ReplayAssertionError`.
//
//   `EXCLUDED_COLUMNS` HAS NO PRODUCTION CONSUMER AND IS EXPORTED ANYWAY, for a
//   different reason that is stated rather than blended into the first. It is
//   reachable from `apps/worker` only through this entry point, and what needs
//   to reach it is `apps/worker/test/state-hash.test.ts`, the DIFFERENTIAL
//   ORACLE: an independent transcription of the whole serialization hashed with
//   an independent SHA-256, which is the only external check the hand-rolled
//   digest has. A test is a legitimate reason to export a table PRECISELY WHEN
//   it is that, and not when it is a coverage exercise. This is not a licence
//   to export a frozen table nothing reads.

// `projectPayout` IS AN EIGHTH NAME AND IT IS ADR-078's TEST APPLIED A THIRD
// TIME, WITH THE SAME ANSWER `replay` GOT. Section 1.3's rationale is the only
// thing that decides an export here: "every additional export is a way for a
// caller to reimplement a rule slightly differently".
//
// WITHHOLDING DEFEATS IT, and the caller is already named. `GET /admin/eligible-
// forecast` is `M01` section 4's endpoint and `eligible_next_7d` is the field
// `apps/api/src/admin-source/liability.ts` owes; the projection ADR-204 rules is
// a conjunction over SIX ENGINE GATES, five carried and one recounted from a
// cadence anchor. A projection this package withheld would be written in the
// admin-source directory instead, which is `FM-16` by name -- "a gate is
// evaluated in the API layer instead of the engine", whose blast radius is "two
// implementations of one rule, which drift" -- and which that directory's own
// `account.ts` already forbids in terms: "Nothing in this module derives an
// eligibility, recomputes a gate or summarises one".
//
// IT REACHES NO RULE `evaluatePayout` DOES NOT ALREADY REACH. The clamp stayed
// unexported because `evaluatePayout` reaches it, so no capability was lost. The
// reverse holds here: nothing exported reaches a FORWARD basis day for R-37, so
// every caller that needs one writes it, which is the same position
// `apps/worker/src/batch/replay.ts` was in with its own fold.
//
// `PROJECTION_ASSUMPTIONS` AND `PROJECTION_CAVEAT` ARE TABLES AND NOT A SEVENTH
// RULE, on the reasoning `HASHED_COLUMNS` and `ENGINE_GATE_LEAVES` are exported
// under. ADR-204 ruling 6 says a producer MAY NOT CHOOSE the five assumptions
// and ruling 7 says both halves of the figure are stated wherever it is shown;
// a caller that had to retype them to render them is a caller that can retype
// them wrongly, which is the drift the rationale is about.
//
// `projectEngineGates` IS NOT HERE, and that is the clamp's ruling rather than
// an oversight: `projectPayout` reaches it, so no capability is lost by
// withholding it, and it is the half a caller could most easily use to build a
// second conjunction.
export { advanceDay, initialState } from './day/advance.ts';
export { applySettlement } from './payout/settle.ts';
export { evaluatePayout } from './payout/evaluate.ts';
export { PROJECTION_ASSUMPTIONS, PROJECTION_CAVEAT, projectPayout } from './payout/project.ts';
export { replay, ReplayAssertionError } from './replay.ts';
export {
  canonicalStateSerialization,
  ENGINE_GATE_LEAVES,
  EXCLUDED_COLUMNS,
  HASHED_COLUMNS,
  StateHashError,
  stateHash,
} from './hash.ts';
export type { PayoutContext } from './payout/evaluate.ts';
export type {
  PayoutProjection,
  PayoutProjectionInput,
  PayoutProjectionOutcome,
  ProjectedDay,
  ProjectedPopulation,
  ProjectionAssumption,
} from './payout/project.ts';
export type { SettlementOutput } from './payout/settle.ts';
export type {
  ExcludedColumn,
  GateLeaf,
  HashedColumn,
  HashedState,
  StateHashSubject,
} from './hash.ts';
