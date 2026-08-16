// =============================================================================
// packages/rules-engine/src/rules.ts
// =============================================================================
// ADR-048's ENGINE HALF: "The engine exports the set of rule identifiers it
// implements ... that export is part of its public contract."
//
// WHAT THIS FILE DOES NOT DO, AND THE RESTRAINT IS DELIBERATE. It does not flip
// CI-03's polarity. ADR-048 carries a STATED PREREQUISITE -- P2 section 2's
// resolvable-citation `L-nn` loader rule "lands before or with the polarity
// change, never after it" -- because a fixture citing nothing makes "every rule
// this fixture cites is implemented" VACUOUSLY TRUE and flips it to `direct`
// against an engine that implements nothing. That rule is not written, so the
// loader still derives polarity from `engineIsIdentityStub()` and every fixture
// is still asserted to fail. This export is the half that can land early, and
// it is worth landing early because it is the honest count in a form a machine
// can read.
//
// THE SET IS NOT SELF-CERTIFYING. ADR-048: "The declared set is cross-checked
// against the PASSING `RE-U-nn` set, and a declared rule with no passing unit
// test fails the stage." `test/implemented-rules.test.ts` is this repository's
// end of that cross-check today: every id below has a named unit test asserting
// its operator at the boundary on both sides, and the test asserts the two lists
// agree. When the loader gains the stage-level version, it reads this export.
//
// A RULE IS DECLARED WHEN THE ENGINE COMPUTES IT, NOT WHEN A FUNCTION MENTIONS
// IT. ADR-048 rejected "inferring the implemented set by reflection over
// exported function names" by name, "because it infers a rule is implemented
// from a symbol existing".
// =============================================================================

/**
 * Every rule identifier M01 section 3.5 defines. Fifty of them, so a declared
 * id that is not a rule is a type error rather than a typo that silently widens
 * the set.
 */
export type RuleId =
  // Group A: time and calendar
  | 'R-01'
  | 'R-02'
  | 'R-03'
  | 'R-04'
  | 'R-05'
  | 'R-06'
  // Group B: marks
  | 'R-07'
  | 'R-08'
  | 'R-09'
  | 'R-10'
  | 'R-11'
  // Group C: floor and drawdown
  | 'R-12'
  | 'R-13'
  | 'R-14'
  | 'R-15'
  | 'R-16'
  | 'R-17'
  | 'R-18'
  | 'R-19'
  | 'R-20'
  // Group D: breach
  | 'R-21'
  | 'R-22'
  | 'R-23'
  | 'R-24'
  | 'R-25'
  // Group E: evaluation phase
  | 'R-26'
  | 'R-27'
  | 'R-28'
  | 'R-29'
  | 'R-30'
  | 'R-31'
  | 'R-32'
  // Group F: funded gates
  | 'R-33'
  | 'R-34'
  | 'R-35'
  | 'R-36'
  | 'R-37'
  | 'R-38'
  | 'R-39'
  | 'R-40'
  | 'R-41'
  // Group G: payout arithmetic
  | 'R-42'
  | 'R-43'
  | 'R-44'
  | 'R-45'
  // Group H: settlement, post-payout, ladder
  | 'R-46'
  | 'R-47'
  | 'R-48'
  | 'R-49'
  | 'R-50';

/**
 * The rules `advanceDay` computes today. TWENTY-TWO OF FIFTY.
 *
 * Each entry names where it is applied, because the point of the list is that a
 * reader can check it rather than trust it.
 *
 *   R-03  isHalfDay reaches no comparison, asserted rather than assumed
 *   R-04  day/counters.ts, the `!halted` half of the win-day expression
 *   R-07  day/advance.ts markIdentityFailures, INV-18
 *   R-08  day/counters.ts isTradedDay
 *   R-09  day/counters.ts isWinDay
 *   R-12  day/floor.ts initialFloorCents, and initialState
 *   R-13  day/floor.ts advanceFloor, the trailing block
 *   R-14  day/floor.ts advanceFloor, the INV-06 tripwire
 *   R-15  day/floor.ts advanceFloor, the lock block
 *   R-16  day/floor.ts advanceFloor, static: the floor never moves
 *   R-18  day/advance.ts, floorOpenCents captured before DO-7 trails
 *   R-21  day/breach.ts checkBreach, strict `<`
 *   R-22  day/breach.ts checkBreach, strict `>`
 *   R-23  day/breach.ts checkBreach, and the fact `advanceDay` emits
 *   R-24  day/advance.ts, the terminal return and DO-1's account_closed refusal
 *   R-25  day/advance.ts, DO-4 returning before DO-8 can run
 *   R-26  day/progression.ts, the profit target at DO-8
 *   R-27  day/progression.ts, the eval minimum-trading-days gate
 *   R-28  day/progression.ts, the deferral: tested only once R-26 and R-27 hold
 *   R-29  day/consistency.ts, the cross multiplication
 *   R-30  day/consistency.ts, the denominator rule, before any arithmetic
 *   R-31  day/progression.ts, the funded reset, in the same step as the pass
 *
 * NOT DECLARED AND WORTH NAMING, because their absence is the count being
 * honest rather than the list being short.
 *
 *   R-32  REFUSES rather than being absent, and it is the one worth reading.
 *         "Elapsed trading days `>` the limit expires the account", and elapsed
 *         trading days is NOT DERIVABLE from `RuleState`: M01 section 2.2's
 *         record carries no account-open day, and `tradedDaysCount` counts days
 *         with fills, which R-08 makes a different quantity. Adding the field
 *         is a column on `rule_states`, so it is a schema delta and an ADR
 *         rather than a diff. `max_days` is null on all three v1 plans; a plan
 *         that set it makes the day refuse, because folding it would trade an
 *         account past its own expiry with a green state row
 *   R-02  needs `sequence` subtraction over a real calendar (group A, blocked
 *         on the calendar data)
 *   R-10, R-11, R-17, R-19, R-20
 *         discharged outside the day fold: ingest, publish validation,
 *         settlement, the platform setpoint
 *   R-33 to R-50
 *         groups F, G and H
 */
export const IMPLEMENTED_RULES: readonly RuleId[] = [
  'R-03',
  'R-04',
  'R-07',
  'R-08',
  'R-09',
  'R-12',
  'R-13',
  'R-14',
  'R-15',
  'R-16',
  'R-18',
  'R-21',
  'R-22',
  'R-23',
  'R-24',
  'R-25',
  'R-26',
  'R-27',
  'R-28',
  'R-29',
  'R-30',
  'R-31',
];
