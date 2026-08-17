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
 * The rules the engine computes today. FORTY-FIVE OF FIFTY.
 *
 * Each entry names where it is applied, because the point of the list is that a
 * reader can check it rather than trust it.
 *
 *   R-02  day/advance.ts DO-1, the calendar lookup, and calendar.ts
 *         `tradingDaysBetween`. M01 section 3.1's DO-1 row cites R-02 for
 *         "`mark.tradingDay` is a calendar trading day" and the gap half is
 *         `sequence` subtraction, which this file's own header already had to
 *         separate from the blocked FIXTURES once
 *   R-06  day/advance.ts DO-1, `mark.tradingDay > prior.tradingDay`, the same
 *         row's last clause. The structural half is that `DailyMark` describes
 *         a closed day and can describe no other kind
 *   R-03  isHalfDay reaches no comparison, asserted rather than assumed
 *   R-04  day/counters.ts, the `!halted` half of the win-day expression
 *   R-07  day/advance.ts markIdentityFailures, INV-18
 *   R-08  day/counters.ts isTradedDay
 *   R-09  day/counters.ts isWinDay
 *   R-10  day/advance.ts markIdentityFailures, and it is discharged by WHERE the
 *         adjustment appears rather than by a comparison: INV-18 puts it on the
 *         opening side and INV-19 has no term for it, so a movement placed
 *         inside the session refuses the day. M01 section 3.1's DO-3 row cites
 *         R-07 and R-10 together for exactly that pair
 *   R-12  day/floor.ts initialFloorCents, and initialState
 *   R-13  day/floor.ts advanceFloor, the trailing block
 *   R-14  day/floor.ts advanceFloor, the INV-06 tripwire
 *   R-15  day/floor.ts advanceFloor, the lock block
 *   R-16  day/floor.ts advanceFloor, static: the floor never moves
 *   R-17  plan/validate.ts CV-01, and plan/resolve.ts, which REFUSES rather than
 *         narrowing. R-17's own row is "rejected at publish by CV-01", and
 *         CV-01 lives in `validatePlan`, which is inside this package by M01
 *         section 1.3's layout. The type-level half did not go away and is now
 *         the second of two: `PublishedDrawdownType` has three members so CV-01
 *         has something to reject, `DrawdownType` has two so a resolved plan
 *         cannot hold the third, and the rule is the narrowing between them
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
 *   R-32  day/progression.ts, eval expiry. DECLARED SINCE ADR-051, which ruled
 *         the anchor (`accounts.opened_on`, the first TRADEABLE day) and the
 *         column that binds (`phase_eval.max_days`; `accounts.expires_on` is
 *         derived and is never an input). It counts by `sequence` subtraction
 *         from `DayInput.openedOn`, the M01 section 2.1 amendment. THE
 *         FENCEPOST WAS THIS SESSION'S AND IS PINNED BY `RE-U-032` RATHER THAN
 *         BY PROSE: the opening day is elapsed day 1, so `max_days` is the
 *         number of trading days the account may trade
 *   R-33  payout/gates.ts, the funded minimum-days gate, skipped at zero
 *   R-34  payout/gates.ts, the win-day gate over the anchored counter
 *   R-35  payout/gates.ts withdrawableCents, and DO-9, which is where the two
 *         terms it reads are final
 *   R-36  payout/gates.ts, funded consistency, sharing R-29's function
 *   R-37  payout/gates.ts and calendar.ts, the cadence gap by sequence
 *         subtraction. An anchor the slice cannot answer for REFUSES the day
 *   R-39  payout/gates.ts, min(withdrawable, cap) against the minimum payout
 *   R-41  payout/gates.ts allGatesPass, the conjunction, listed not reduced
 *   R-42  payout/clamp.ts capForOrdinal, the last rung at or below the ordinal
 *   R-43  payout/clamp.ts clampPayout, the three-way min and the four reasons
 *   R-44  payout/clamp.ts clampPayout, the ceiling to the trader
 *   R-45  payout/clamp.ts ordinalForNextPayout, derived from settlements
 *   R-19  payout/settle.ts, and it is discharged by an ABSENCE: the floor, the
 *         high-water balance and the lock are the three fields settlement does
 *         not write. RE-U-019 asserts the absence, because an absence is the one
 *         kind of rule a reader cannot check by finding the line
 *   R-46  payout/settle.ts, both anchors, and they are different dates
 *   R-47  payout/settle.ts, the win-day and consistency reset at the basis day
 *   R-48  payout/settle.ts. R-19 from the settlement's side
 *   R-49  payout/settle.ts, the ladder, evaluated immediately after
 *   R-50  payout/settle.ts, lifetime accounting, which INV-17 bounds
 *   R-38  payout/evaluate.ts, the external leg's one-in-flight control. It
 *         binds through `contextEligible` and is reported on its own field,
 *         because API_CONTRACT's `gates` object has no in-flight entry
 *   R-40  payout/evaluate.ts, the four context gates, read at request time and
 *         never stored (INV-23)
 *
 * NOT DECLARED AND WORTH NAMING, because their absence is the count being
 * honest rather than the list being short.
 *
 *   R-01, R-05
 *         discharged by `trading_calendar` and the ingest path, and NEITHER IS
 *         WAITING ON THE CALENDAR TRANSCRIPTION, which is where this list filed
 *         them until group A was written. `CalendarDay` is `{tradingDay,
 *         isHalfDay, halted, sequence}` and R-05's session bounds are two
 *         columns it does not carry; R-01 is a containment lookup over a fill's
 *         execution timestamp and `DailyMark` carries `fillCount` and no
 *         instant. Transcribing the CME year adds rows, not columns, so it
 *         unblocks their GOLDEN files and not the rules
 *   R-11, R-20
 *         discharged outside the engine entirely: the caller's live-mark
 *         predicate and the platform setpoint. R-19 LEFT THIS LIST when group H
 *         landed, because settlement is where it is discharged and settlement is
 *         now code; R-10 LEFT IT when group B was completed, because DO-3's pair
 *         of identities is a check that fires rather than a rule the engine
 *         merely mentions; and R-17 LEFT IT when `validatePlan` was written,
 *         because "publish validation" was never outside this package. M01
 *         section 1.3 puts `plan/validate.ts` in `packages/rules-engine`, so the
 *         line that filed R-17 beside R-11 and R-20 was reading "publish" as
 *         "somebody else". IT IS THE THIRD TIME THIS EXACT STEP HAS BEEN TAKEN:
 *         R-02, R-06 and R-10 were filed the same way in session 48, and the
 *         generalisation was correct about its neighbours and never checked
 *         against the rule in hand
 */
export const IMPLEMENTED_RULES: readonly RuleId[] = [
  'R-02',
  'R-03',
  'R-04',
  'R-06',
  'R-07',
  'R-08',
  'R-09',
  'R-10',
  'R-12',
  'R-13',
  'R-14',
  'R-15',
  'R-16',
  'R-17',
  'R-18',
  'R-19',
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
  'R-32',
  'R-33',
  'R-34',
  'R-35',
  'R-36',
  'R-37',
  'R-38',
  'R-39',
  'R-40',
  'R-41',
  'R-42',
  'R-43',
  'R-44',
  'R-45',
  'R-46',
  'R-47',
  'R-48',
  'R-49',
  'R-50',
];
