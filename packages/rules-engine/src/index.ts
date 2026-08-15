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
