// =============================================================================
// packages/harness/src/bridge.ts
// =============================================================================
// THE SEAM BETWEEN THE DAY MODEL AND THE ENGINE. Two conversions and two
// calendar lookups, and the interesting thing about all four is how little they
// do.
//
//   `SimDay`       -> `DailyMark`      one field is renamed, the rest are copied
//   `SimSession[]` -> `CalendarSlice`  days and a coverage interval
//
// NOTHING HERE DECIDES ANYTHING, AND THAT IS THE RULE RATHER THAN AN
// OBSERVATION. SIMULATION_HARNESS section 4: the harness "may not contain a
// single line that decides a gate, a breach, an eligibility, or a payout
// amount", restated as `INV-M21-09`. A conversion that computed `tradedDay` or
// `winDay` would have decided two of them, which is why `DailyMark` carries
// neither: `R-08` is `fill_count > 0` and `R-09` is a comparison against the
// account's pinned win-day floor, and `rules-engine/src/types.ts` says an engine
// that read them "would be an engine whose breach and win-day arithmetic
// depended on the ingester agreeing with it".
//
// -----------------------------------------------------------------------------
// THIS IS THE SECOND COPY OF THIS SEAM IN THE TREE AND THE FIRST ONE IS NAMED
// -----------------------------------------------------------------------------
// `scripts/demo/bridge.ts` does the same two conversions for the demo, and it
// lives there because `scripts/demo` is DELIBERATELY NOT A WORKSPACE PACKAGE
// (its tsconfig says so, and `vitest.config.ts` adds it as a source root rather
// than a project) and therefore imports both packages by relative path. It
// cannot import this file without becoming one.
//
// The duplication is recorded rather than hidden, and it points one way: when
// the demo is next opened, it should import `@merit/harness` and delete its own
// copy, not the reverse. A harness that imported a script would have made a
// script part of the build.
//
// -----------------------------------------------------------------------------
// IN THE REAL PIPELINE THIS SEAM IS NOT A FUNCTION CALL
// -----------------------------------------------------------------------------
// The simulator renders an EOD report file, `ingestEOD` reads it, the normalizer
// writes `daily_marks`, and the batch folds from there (`INV-M2-11`: simulator
// output and vendor output go through the same parser). The harness skips the
// file, so the two things it therefore proves nothing about are the CSV
// rendering and the normalizer. That is the honest boundary of what a green run
// tells you.
// =============================================================================

import type { CalendarSlice, DailyMark, TradingDay } from '@merit/rules-engine';
import { buildCalendarSlice, lookupCalendarDay, nextTradingDayAfter } from '@merit/rules-engine';
import type { SimDay, SimSession } from '@merit/rithmic';

/** Thrown when the seam cannot be crossed. Never papered over. */
export class BridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BridgeError';
  }
}

/**
 * The engine's `TradingDay` is branded and the simulator's is a bare string.
 *
 * THE BRAND IS THE WHOLE VALUE OF THIS FUNCTION AND IT IS NOT DECORATION. It
 * makes "a day handed where a plan version id was wanted" a compile error, and a
 * harness that cast at every call site would have a hole at each one instead of
 * this single one, in the file whose subject is the boundary.
 */
export const asTradingDay = (day: string): TradingDay => day as TradingDay;

/**
 * `SimDay` to `DailyMark`, field by field.
 *
 * `fillCount` IS THE SIMULATOR'S FILL COUNT AND NOT A TRADE COUNT. `R-08` is
 * `fill_count > 0` and one round trip is two fills, so a day with one trade has
 * `fillCount: 2`. The trade count would answer `R-08` identically and be a
 * different number, which is worth stating because a later rule reading the
 * count would inherit the error silently.
 *
 * `sourceHash` IS NOT A DIGEST AND IS LABELLED SO. In the pipeline it is the
 * ingested artifact's hash, which is how a superseded mark is told from a
 * backdated one at replay (M01 Appendix B.3). The harness ingests no artifact,
 * so it carries a stable identifier of the day it came from rather than a hash
 * of nothing: a value that looked like a digest and was not would be worse than
 * one that plainly is not.
 */
export function toDailyMark(day: SimDay, runSeed: string): DailyMark {
  return {
    tradingDay: asTradingDay(day.tradingDay),
    openingBalanceCents: day.openingBalanceCents,
    closingBalanceCents: day.closingBalanceCents,
    highBalanceCents: day.highBalanceCents,
    lowBalanceCents: day.lowBalanceCents,
    realizedPnlCents: day.realizedPnlCents,
    adjustmentCents: day.adjustmentCents,
    fillCount: day.fills.length,
    sourceHash: `harness-not-a-digest:${runSeed}:${day.account.platformAccountRef}:${day.tradingDay}`,
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
 * THE ONE THAT BITES. A slice claiming to cover more than it holds turns
 * "outside coverage" misses into "not a session" misses, and those are different
 * answers: one says the calendar cannot speak for the day, the other says the
 * day is not a session. So a pass on the LAST session of a window refuses,
 * because `R-31` needs the trading day after it, and a settlement whose
 * effective day falls past the window is reported unsettled rather than
 * invented. Both are visible in the trial record instead of being widened away.
 *
 * `isHalfDay` AND `halted` COME FROM THE CALLER'S SESSIONS AND ARE NOT INVENTED.
 * `DEP-M21-08` is that the trading calendar is the real one when the harness
 * runs: "a synthetic calendar of 252 identical days silently removes the most
 * calendar-sensitive rules from the run, and the projection would be confidently
 * wrong about exactly the gates a founder is sweeping". There is not one
 * calendar row in this repository yet (P2 section 6), so the flags arrive as
 * caller data with the sessions and this function invents neither.
 */
export function toCalendarSlice(
  sessions: readonly SimSession[],
  options: {
    readonly sequenceBase: number;
    /** Days the caller declares half days, by `tradingDay`. `R-03`. */
    readonly halfDays?: ReadonlySet<string>;
    /** Days the caller declares halted, by `tradingDay`. `R-04`. */
    readonly haltedDays?: ReadonlySet<string>;
  },
): CalendarSlice {
  if (sessions.length === 0) throw new BridgeError('a calendar slice needs at least one session');
  if (!Number.isSafeInteger(options.sequenceBase)) {
    throw new BridgeError(`sequenceBase ${String(options.sequenceBase)} is not an integer`);
  }

  const halfDays = options.halfDays ?? new Set<string>();
  const haltedDays = options.haltedDays ?? new Set<string>();

  const days = sessions.map((session, i) => ({
    tradingDay: asTradingDay(session.tradingDay),
    isHalfDay: halfDays.has(session.tradingDay),
    halted: haltedDays.has(session.tradingDay),
    // Dense and strictly ascending, which is what `buildCalendarSlice` checks
    // and what `R-37`'s subtraction needs. A calendar with holidays in it
    // supplies its own sequence, and this line is what would change.
    sequence: options.sequenceBase + i,
  }));

  const first = days[0];
  const last = days[days.length - 1];
  if (first === undefined || last === undefined) {
    throw new BridgeError('a calendar slice needs at least one session');
  }

  return buildCalendarSlice({
    days,
    coverage: { from: first.tradingDay, to: last.tradingDay },
  });
}

/**
 * The day's dense sequence, for counting a cycle by SUBTRACTION.
 *
 * `AS-06` and `R-37`: a gap between two trading days is never a date difference.
 * Every caller here passes a day the fold has already accepted, so a miss is the
 * harness disagreeing with the slice it built rather than a bad day of data, and
 * it throws instead of returning a number nobody can interpret.
 */
export function sequenceOf(calendar: CalendarSlice, tradingDay: TradingDay): number {
  const lookup = lookupCalendarDay(calendar, tradingDay);
  if (!lookup.found) {
    throw new BridgeError(
      `${tradingDay} has no sequence in the slice covering ${calendar.coverage.from}..` +
        `${calendar.coverage.to} (${lookup.reason}). Every caller passes a day the fold accepted`,
    );
  }
  return lookup.day.sequence;
}

/**
 * `count` trading days after `tradingDay`, or `null` past the slice's coverage.
 *
 * ONE STEP AT A TIME THROUGH `nextTradingDayAfter`, WHICH IS THE ENGINE'S OWN
 * FUNCTION. The engine exports `tradingDayAtSequence` internally and does not
 * publish it, so arithmetic on the sequence would mean this file deciding what
 * the sequence means. Walking is slower and is the same answer the engine gives
 * `R-37`, which is the property worth having.
 *
 * `null` IS A WINDOW ANSWER AND NOT A CALENDAR ANSWER. A settlement whose
 * effective day falls past the loaded window is reported unsettled by
 * `trial.ts`; inventing a day would put a payout on a session the run never saw.
 */
export function tradingDaysAfter(
  calendar: CalendarSlice,
  tradingDay: TradingDay,
  count: number,
): TradingDay | null {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new BridgeError(`${String(count)} is not a positive count of trading days`);
  }
  let day = tradingDay;
  for (let i = 0; i < count; i += 1) {
    const next = nextTradingDayAfter(calendar, day);
    if (!next.found) return null;
    day = next.day.tradingDay;
  }
  return day;
}
