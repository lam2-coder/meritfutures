// =============================================================================
// scripts/demo/bridge.ts
// =============================================================================
// THE SEAM. Two conversions, and the interesting thing about both is how little
// they do.
//
//   `SimDay`      -> `DailyMark`     one field is renamed, the rest are copied
//   `SimSession[]` -> `CalendarSlice` days and a coverage interval
//
// NOTHING HERE DECIDES ANYTHING. SIMULATION_HARNESS section 4: the harness "may
// not contain a single line that decides a gate, a breach, an eligibility, or a
// payout amount". A conversion that computed `tradedDay` or `winDay` would have
// done exactly that, which is why `DailyMark` carries neither: the engine
// derives both (R-08, R-09) and `types.ts` says an engine that read them "would
// be an engine whose breach and win-day arithmetic depended on the ingester
// agreeing with it".
//
// IN THE REAL PIPELINE THIS SEAM IS NOT A FUNCTION CALL. The simulator renders
// an EOD report file, `ingestEOD` reads it, the normalizer writes `daily_marks`,
// and the batch folds from there (INV-M2-11: simulator output and vendor output
// go through the same parser). The demo skips the file, and the two places it
// therefore proves nothing about are the CSV rendering and the normalizer. That
// is the honest boundary of what watching this output tells you.
// =============================================================================

import type {
  CalendarSlice,
  DailyMark,
  TradingDay,
} from '../../packages/rules-engine/src/index.ts';
import { buildCalendarSlice } from '../../packages/rules-engine/src/index.ts';
import type { SimDay, SimSession } from '../../packages/rithmic/src/index.ts';

/**
 * The engine's `TradingDay` is branded and the simulator's is a bare string.
 *
 * THE BRAND IS THE WHOLE VALUE OF THIS FUNCTION AND IT IS NOT DECORATION. It
 * makes "a day handed where a plan version id was wanted" a compile error, and a
 * demo that cast at each of the nine call sites would have nine holes instead of
 * this one. The cast is here, once, in the file whose subject is the boundary.
 */
export const asTradingDay = (day: string): TradingDay => day as TradingDay;

/**
 * `SimDay` to `DailyMark`, field by field.
 *
 * `fillCount` IS THE SIMULATOR'S FILL COUNT AND NOT A TRADE COUNT. R-08 is
 * `fill_count > 0` and one round trip is two fills, so a day with one trade has
 * `fillCount: 2`. Passing the trade count would still make every traded day
 * traded, which is why this is worth stating: the two agree on the only question
 * R-08 asks and disagree on the number, and a later rule that reads the count
 * would inherit the error silently.
 *
 * `sourceHash` IS NOT A DIGEST HERE AND IS LABELLED SO. In the pipeline it is
 * the ingested artifact's hash, which is how a superseded mark is told from a
 * backdated one at replay (Appendix B.3). The demo ingests no artifact, so it
 * carries a stable identifier of the day it came from instead of a hash of
 * nothing: a value that looked like a digest and was not would be worse than one
 * that plainly is not.
 */
export function toDailyMark(day: SimDay): DailyMark {
  return {
    tradingDay: asTradingDay(day.tradingDay),
    openingBalanceCents: day.openingBalanceCents,
    closingBalanceCents: day.closingBalanceCents,
    highBalanceCents: day.highBalanceCents,
    lowBalanceCents: day.lowBalanceCents,
    realizedPnlCents: day.realizedPnlCents,
    adjustmentCents: day.adjustmentCents,
    fillCount: day.fills.length,
    sourceHash: `demo-not-a-digest:${day.account.platformAccountRef}:${day.tradingDay}`,
  };
}

/**
 * The sessions, as a `CalendarSlice`.
 *
 * ADR-049 MAKES THE SLICE A VALUE RATHER THAN AN INTERFACE, and building one
 * here is what that ruling is for: "a caller could satisfy [an interface] with a
 * live query, a memoiser, or something that consults the clock". This caller
 * hands over an array and has nothing to smuggle.
 *
 * COVERAGE IS EXACTLY THE RUN'S WINDOW, WHICH IS THE HONEST DECLARATION AND ALSO
 * THE ONE THAT BITES. A slice that claimed to cover more than it holds would
 * turn "outside coverage" misses into "not a session" misses, and those are
 * different answers: one says the calendar cannot speak for the day, the other
 * says the day is not a session. The demo's window is short, so R-31's
 * `nextTradingDayAfter` on a pass that lands on the LAST session of a run has
 * nothing to answer with and the fold refuses the day. That refusal is correct
 * and the demo prints it rather than widening the window to hide it.
 *
 * `isHalfDay` and `halted` are both false on every day, because the demo has no
 * source for either. R-04 (no win day on a halted session) is therefore present
 * in the engine and unexercised here, and the table has no column for it rather
 * than a column that is always the same.
 */
export function toCalendarSlice(
  sessions: readonly SimSession[],
  sequenceBase: number,
): CalendarSlice {
  if (sessions.length === 0) throw new RangeError('a calendar slice needs at least one session');

  const days = sessions.map((session, i) => ({
    tradingDay: asTradingDay(session.tradingDay),
    isHalfDay: false,
    halted: false,
    // Dense and strictly ascending, which is what `buildCalendarSlice` checks
    // and what R-37's subtraction needs. The run's sessions are consecutive
    // weekdays, so a dense index over them is the right shape; a calendar with
    // holidays in it would supply its own sequence and this line would be the
    // thing that changed.
    sequence: sequenceBase + i,
  }));

  const first = days[0];
  const last = days[days.length - 1];
  if (first === undefined || last === undefined) {
    throw new RangeError('a calendar slice needs at least one session');
  }

  return buildCalendarSlice({
    days,
    coverage: { from: first.tradingDay, to: last.tradingDay },
  });
}
