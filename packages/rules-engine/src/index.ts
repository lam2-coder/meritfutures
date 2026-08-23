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
} from './types.js';

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
} from './types.js';

export {
  buildCalendarSlice,
  CalendarSliceError,
  lookupCalendarDay,
  nextTradingDayAfter,
} from './calendar.js';
export type { CalendarLookup, CalendarSource } from './calendar.js';

export { EngineInvariantError } from './errors.js';

export { IMPLEMENTED_RULES } from './rules.js';
export type { RuleId } from './rules.js';

export { resolvePlan } from './plan/resolve.js';
export { validatePlan } from './plan/validate.js';

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

export { advanceDay, initialState } from './day/advance.js';
export { applySettlement } from './payout/settle.js';
export { evaluatePayout } from './payout/evaluate.js';
export { replay, ReplayAssertionError } from './replay.js';
export {
  canonicalStateSerialization,
  ENGINE_GATE_LEAVES,
  EXCLUDED_COLUMNS,
  HASHED_COLUMNS,
  StateHashError,
  stateHash,
} from './hash.js';
export type { PayoutContext } from './payout/evaluate.js';
export type { SettlementOutput } from './payout/settle.js';
export type {
  ExcludedColumn,
  GateLeaf,
  HashedColumn,
  HashedState,
  StateHashSubject,
} from './hash.js';
