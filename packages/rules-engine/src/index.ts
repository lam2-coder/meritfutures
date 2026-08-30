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
  buildSessionCalendar,
  CalendarSliceError,
  lookupCalendarDay,
  nextTradingDayAfter,
  tradingDayAt,
} from './calendar.ts';
export type { CalendarLookup, CalendarSource } from './calendar.ts';

// `buildSessionCalendar` AND `tradingDayAt` ARE EXPORTED BECAUSE THIS FILE IS
// THE PACKAGE'S ONLY DOOR. `package.json` declares `"exports": { ".":
// "./src/index.ts" }` and no subpath, so a function added to `calendar.ts` and
// not named here is a function no workspace caller can reach: dead code with a
// docblock. The pair answers ONE question, "which exchange trading day contains
// this instant", and it is the question `ADR-145` finding 10 recorded as having
// no answer anywhere in this workspace.
//
// NO RULE FOLDS OVER A `SessionCalendar` AND THAT IS THE POINT OF THE SEPARATE
// VALUE. `CalendarSlice` stays the fold's calendar and carries no instants, so
// nothing that counts in trading days can reach a session bound.
export type {
  CoverageInterval,
  CoveredSpan,
  SessionCalendar,
  SessionCalendarSource,
  SessionDay,
  TradingDayAt,
} from './calendar.ts';

export { EngineInvariantError } from './errors.ts';

export { IMPLEMENTED_RULES } from './rules.ts';
export type { RuleId } from './rules.ts';

export { resolvePlan } from './plan/resolve.ts';
export { validatePlan } from './plan/validate.ts';

// `plan/rules-codec.ts` IS ADR-283, AND IT IS ADR-078's TEST APPLIED A SIXTH
// TIME ON ADR-250's OWN GROUND. Section 1.3's rationale is the only thing that
// decides an export here: "every additional export is a way for a caller to
// reimplement a rule slightly differently". WITHHOLDING DEFEATS IT, and the
// proof is not hypothetical: `toPublishedRules` (`apps/worker`) and
// `decodeRules` (`apps/site`) ALREADY exist, read the same stored document under
// the same key spelling, return this package's own `PlanRulesJson`, and are
// compared by nothing. That is `FM-16` over the blob that fixes every cents
// value a payout is decided against, and a withheld decoder is not a decoder
// nobody writes: it is the two that are already written plus the third
// `apps/api` would need.
//
// `PlanRulesCodecError` rides with it on `EngineGatesCodecError`'s reasoning
// unchanged: a refusal a caller must be able to catch is a refusal a caller must
// be able to name. THE ENCODE DIRECTION IS NOT EXPORTED AND DOES NOT EXIST,
// which is where this differs from `gates-codec.ts`: nothing in this repository
// WRITES `plan_versions.rules` from a `PlanRulesJson`, the publish path is
// `validatePlan` over a document somebody authored, and an encoder nobody calls
// would be a second statement of the shape with no caller to keep it honest.
export { decodePlanRules, PlanRulesCodecError } from './plan/rules-codec.ts';

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
// `encodeEngineGates` AND `decodeEngineGates` ARE THE NINTH AND TENTH NAMES, AND
// ADR-078's TEST GIVES THE SAME ANSWER IT GAVE `replay` AND `hash.ts`. Section
// 1.3's rationale is the only thing that decides an export here: "every
// additional export is a way for a caller to reimplement a rule slightly
// differently".
//
// WITHHOLDING DEFEATS IT, AND BOTH CALLERS ARE ALREADY NAMED. `ADR-239` slice A
// ruled this codec's home to be this package because TWO deployables need the
// one predicate: `apps/worker` ENCODES into `rule_states.engine_gates` through
// `RuleStateWriterIo`, and `apps/api` DECODES back out of it because
// `PayoutSubject.state` is a `RuleState`. Neither can import the other, and this
// package declares no workspace dependency at all, so a withheld codec is not a
// codec nobody writes: it is TWO codecs, one per deployable, which is `FM-16` by
// name and is the two-statements-of-one-predicate defect `ADR-206` exists to
// close rather than to relocate.
//
// `StoredEngineGates` AND ITS SIX GROUP TYPES RIDE WITH THEM, on the reasoning
// `StateHashError` and `EngineEvent` are exported under: they compute nothing
// and have no second implementation to drift from. What they buy is that a
// reader of the column has the stored shape in the type system rather than in a
// comment. `EngineGatesCodecError` is the same case: a refusal a caller must be
// able to name is a refusal a caller must be able to catch.
//
// `resolveExternalGates` IS THE ELEVENTH NAME AND ADR-078's TEST GIVES THE SAME
// ANSWER AGAIN, FOR THE SAME REASON AND ON THE SAME TWO CALLERS. Section 1.3's
// rationale is "every additional export is a way for a caller to reimplement a
// rule slightly differently", and this function REIMPLEMENTS NO RULE: `R-40` and
// `R-41` are `evaluatePayout`'s and nothing here decides whether a gate passes.
// What it owns is the NARROWING between four columns and the two unions
// `types.ts` declares, and `ExternalGates` is required by BOTH deployables --
// `apps/worker` builds `AccountDay.external` for the nightly fold and `apps/api`
// builds `PayoutSubject.gates` for the payout route. Withholding it does not
// produce one narrowing: it produces two, one per deployable, which is `FM-16`
// and is what the codec above is here to avoid.
//
// AND THE COST OF WITHHOLDING IS ALREADY VISIBLE ONE LEG DOWN RATHER THAN
// PREDICTED. `currentKycState` is written out TWICE under `apps/api/src/routes/`
// because a route module importing another route module is an edge that
// directory has decided it will not have, so the head-of-chain reading already
// exists in two copies with nothing comparing them.
//
// `PAYOUT_IN_FLIGHT_STATUSES` RIDES WITH IT AND IS THE POINT RATHER THAN A
// CONVENIENCE. `ADR-254` section 8 finding 4 recorded that this status set is
// written out in five places and that "nothing pins the resolver that does not
// exist yet", with the cheapest control being that it import a constant rather
// than a literal. The constant is only a control if a caller can name it.
// `ExternalGatesRefusal` is `EngineGatesCodecError`'s case unchanged: a refusal a
// caller must be able to catch is a refusal a caller must be able to name.
export { advanceDay, initialState } from './day/advance.ts';
export { applySettlement } from './payout/settle.ts';
export { evaluatePayout } from './payout/evaluate.ts';
export { decodeEngineGates, encodeEngineGates, EngineGatesCodecError } from './gates-codec.ts';
export {
  ExternalGatesRefusal,
  PAYOUT_IN_FLIGHT_STATUSES,
  resolveExternalGates,
} from './external-gates.ts';
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
export type {
  StoredBufferGate,
  StoredCadenceGapGate,
  StoredConsistencyGate,
  StoredEngineGates,
  StoredMinimumAmountGate,
  StoredTradedDaysGate,
  StoredWinDaysGate,
} from './gates-codec.ts';
export type { ExternalGateFacts, KycChainRow } from './external-gates.ts';
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
