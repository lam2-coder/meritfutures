// =============================================================================
// packages/rules-engine/src/day/counters.ts
// =============================================================================
// DO-6, and the three rules it applies. M01 section 3.1:
//
//   `tradedDaysCount += mark.fillCount > 0 ? 1 : 0`
//   `winDaysCount += win_day && !halted ? 1 : 0`
//   consistency accumulators updated if the day is inside the current period
//
// EVERY OPERATOR HERE IS THE CONTRACT AND NOT A CHOICE. M01 section 3.5: the
// operator column "is what the engine executes, what `copy_blocks` publishes,
// and what the fixture asserts. All three or none." So each function below
// carries the operator in its doc comment in the same spelling the rule table
// uses, and `test/rules-b-marks.test.ts` asserts it at the boundary on both
// sides.
// =============================================================================

import type { CalendarDay, Cents, DailyMark } from '../types.ts';

/**
 * R-08. A traded day is `fill_count > 0`, STRICT.
 *
 * One fill is a traded day. AS-07 is the attack on exactly this ("a rented
 * fleet can keep twenty accounts' counters advancing"), and the ruled answer
 * was to disable the funded minimum-days gate rather than to redefine a traded
 * day: "inventing a minimum size or minimum hold time invites a public argument
 * Merit would lose and would break legitimate small-size traders."
 */
export function isTradedDay(mark: DailyMark): boolean {
  return mark.fillCount > 0;
}

/**
 * R-09 with R-04. `realized_pnl_cents >= win_day_floor_cents`, and NOT on a
 * halted session.
 *
 * The `>=` is load bearing and published: a day EXACTLY at the floor counts
 * (GS-006, GS-007). R-04 is the second half of the same expression rather than
 * a separate check, because M01 writes it as one: "`winDaysCount += (win_day &&
 * !halted) ? 1 : 0`". On a halted session the day counters still advance (R-02,
 * R-03) and only the win day does not.
 */
export function isWinDay(
  mark: DailyMark,
  calendarDay: CalendarDay,
  winDayFloorCents: Cents,
): boolean {
  return mark.realizedPnlCents >= winDayFloorCents && !calendarDay.halted;
}

/** The consistency accumulators, which DO-6 advances and group E's R-29 reads. */
export interface ConsistencyAccumulators {
  readonly bestDayCents: Cents;
  readonly periodProfitCents: Cents;
}

/**
 * DO-6's third clause. The period is trading days STRICTLY AFTER the anchor
 * (R-47, AS-12), which is what `consistencyPeriodStartDay` already records: it
 * is set to the next trading day after the anchor, so the comparison here is
 * `>=` against a start day that has already excluded the anchor.
 *
 * A `null` start day means no period has been anchored yet, and every day is
 * inside it. THIS FUNCTION DOES NO CONSISTENCY ARITHMETIC: R-29's cross
 * multiplication and R-30's denominator rule are group E and read these two
 * numbers when they land.
 */
export function advanceConsistency(
  prior: ConsistencyAccumulators,
  mark: DailyMark,
  periodStartDay: string | null,
): ConsistencyAccumulators {
  const inPeriod = periodStartDay === null || mark.tradingDay >= periodStartDay;
  if (!inPeriod) return prior;

  return {
    bestDayCents:
      mark.realizedPnlCents > prior.bestDayCents ? mark.realizedPnlCents : prior.bestDayCents,
    periodProfitCents: prior.periodProfitCents + mark.realizedPnlCents,
  };
}
