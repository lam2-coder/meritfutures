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
// a rule slightly differently". Four of the six are here: `initialState`,
// `advanceDay`, `applySettlement` and `evaluatePayout`. `resolvePlan` and
// `validatePlan` are P2-1.
//
// `clampPayout` IS DELIBERATELY NOT HERE AND M01 DISAGREES WITH ITSELF ABOUT IT.
// Section 3.6's reference algorithm writes `export function clampPayout`, and
// section 1.3's "nothing else is exported" does not list it among the six.
// Section 1.3 wins, so the clamp is reachable only through `evaluatePayout`,
// which is what M01 section 4 names for both endpoints and what makes "the
// identical function with the identical inputs" true rather than aspirational.
//
// `applySettlement` TAKES A FOURTH ARGUMENT M01's SIGNATURE DOES NOT SHOW, and
// ADR-049 is what authorises it: R-47 needs the trading day AFTER the basis day,
// P2 section 1 names this function while closing OQ-P2-01, and "neither rule can
// be computed from one row".
//
// `buildCalendarSlice` is a seventh name and is not a seventh rule: ADR-049
// requires the slice to be "built by a pure exported constructor", and a
// constructor a caller cannot reach is a value a caller cannot make.

export type {
  AccountActiveGate,
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
  ResolvedPlan,
  RuleState,
  SettlementFact,
  SoftDailyLossLimitEvent,
  TradedDaysGate,
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

export { advanceDay, initialState } from './day/advance.js';
export { applySettlement } from './payout/settle.js';
export { evaluatePayout } from './payout/evaluate.js';
export type { PayoutContext } from './payout/evaluate.js';
export type { SettlementOutput } from './payout/settle.js';

import type { EngineInput, EngineResult } from './types.js';

/**
 * Evaluate one account's rule state against its pinned plan version.
 *
 * NOT IMPLEMENTED. This is the identity evaluation: it returns the state it was
 * given and emits nothing. M01 is where the rules arrive, under TR-02, which
 * means the golden fixtures exist and fail before the function does.
 *
 * It is written as the identity rather than as a throw so that the scaffold's
 * placeholder test asserts something true about the contract. When M01 lands,
 * that test fails and is replaced by fixtures derived from the plan documents.
 *
 * The signature is the deliverable of this session, not the body:
 * `(planConfigVersion, accountState, dayMarks[]) -> newState + events`, with
 * zero I/O, no clock, and the full pinned config required by the type rather
 * than defaulted.
 */
export function evaluate(input: EngineInput): EngineResult {
  return { newState: input.accountState, events: [] };
}
