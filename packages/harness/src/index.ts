// =============================================================================
// packages/harness
// =============================================================================
// THE PUBLIC ENTRY POINT, and the only thing outside this package may import.
//
// `DEP-M21-01`: "a Monte Carlo harness: A TRIAL LOOP AND AN AGGREGATOR over
// `packages/rithmic/src/simulator`'s day model, producing the `RE-S-nn` and
// `HO-nn` outputs against a candidate configuration". That is the whole scope
// and this file is the whole surface.
//
// -----------------------------------------------------------------------------
// WHAT IS NOT EXPORTED, AND WHY THE LIST IS SHORT ON PURPOSE
// -----------------------------------------------------------------------------
// The engine's own entry point makes the argument: "every additional export is A
// WAY FOR A CALLER TO REIMPLEMENT A RULE slightly differently". The same shape
// applies one layer out. What a caller needs is `runHarness`, `runSweep`, the
// types to build an input with, and enough of `ratio.ts` to read an exact value
// without reaching for a float. Everything else is reachable through those.
//
// `advanceDay`, `evaluatePayout` and `simulate` ARE NOT RE-EXPORTED. A consumer
// wanting the engine imports the engine, which keeps `@merit/rules-engine` the
// one name a rule is reached by; a harness that re-exported it would become a
// second import path for the rulebook and eventually a place someone patched it.
// =============================================================================

export { runHarness, runSweep, RunError } from './run.ts';
export type {
  SweepArm,
  SweepArmResult,
  SweepResult,
  SweepSampleFloor,
  SweptValueUnit,
} from './run.ts';

export { runTrial, checkBehaviour, TrialError } from './trial.ts';

export { aggregate, funnelCounts, checkCommercial, AggregateError } from './aggregate.ts';

export {
  checkBands,
  checkLifetimeBound,
  lifetimeBoundCents,
  AssertionInputError,
} from './assertions.ts';

export { OUTPUT_CATALOGUE, outputDefinition } from './outputs.ts';
export type { OutputDefinition } from './outputs.ts';

export {
  HARNESS_VERSION,
  calibrationDigest,
  checkCalibrationSource,
  provenanceFor,
  ProvenanceError,
} from './provenance.ts';
export type { BandUnit, CalibrationBand, CalibrationSource, Provenance } from './provenance.ts';

// The exact-rational surface. A caller that renders a result needs `format` and
// `toBasisPoints`; a caller that compares two needs `compare`. Neither should
// have to reach for a float to do it, which is the whole reason `Ratio` is a
// pair rather than a number.
export {
  ZERO,
  add,
  compare,
  equals,
  floorDiv,
  format,
  fromInteger,
  maximum,
  multiply,
  ratio,
  subtract,
  toBasisPoints,
  RatioError,
} from './ratio.ts';
export type { Ratio } from './ratio.ts';

// The seam, exported because the demo and any later consumer should cross it
// through this package rather than writing a third copy of it.
export {
  asTradingDay,
  sequenceOf,
  toCalendarSlice,
  toDailyMark,
  tradingDaysAfter,
  BridgeError,
} from './bridge.ts';

export type {
  Aggregate,
  BandResult,
  CommercialInputs,
  FunnelCounts,
  HarnessRun,
  HarnessRunInput,
  LifetimeBoundResult,
  OutputKey,
  OutputRecord,
  OutputUnit,
  ProposedRegistryId,
  RegistryId,
  RequestPolicy,
  SettledPayout,
  Trial,
  TrialBehaviour,
  TrialInput,
  TrialOutcome,
} from './types.ts';
