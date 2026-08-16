// =============================================================================
// packages/rules-engine/src/calendar.ts
// =============================================================================
// ADR-049, CLOSING `OQ-P2-01`. "`CalendarSlice` is a VALUE, not an interface. A
// frozen ordered array of `CalendarDay` plus a precomputed index and a declared
// coverage interval, BUILT BY A PURE EXPORTED CONSTRUCTOR, with the calendar
// queries as free functions in `calendar.ts` over that value."
//
// WHY A VALUE AND NOT AN INTERFACE, IN ONE SENTENCE, BECAUSE A LATER SESSION
// WILL BE TEMPTED TO "SIMPLIFY" THIS INTO A `CalendarPort`: an interface
// carrying `get()` is a capability, a caller could satisfy it with a live query
// or with something that reads the clock, and all three of the package's purity
// mechanisms would stay green while the fold's output became a function of what
// the caller happened to do. `CalendarSliceIsData` in `types.ts` is the fourth
// mechanism and it is what makes that a compile error.
//
// WHAT IS HERE AND WHAT IS NOT
//
//   here    the constructor, the lookup DO-1 needs, and `nextTradingDayAfter`
//   not     sequence-gap counting (R-37, R-02)
//
// THE GAP COUNT BELONGS TO GROUPS A AND F, which P2 section 2 puts AFTER the
// real calendar data lands ("There is not one calendar row in the repository").
// Writing it now would mean writing it against no data, which is the
// transcription-from-recollection TR-01 forbids.
//
// `nextTradingDayAfter` MOVED ACROSS THAT LINE WHEN GROUP E ARRIVED, and the
// distinction is worth stating because this header previously grouped it with
// the gap count. R-02 and R-37 count trading days ACROSS A RANGE, so they need
// a calendar that spans the range and there is no such data. This function
// takes ONE STEP along the slice the caller already supplied, which R-31 needs
// today ("`consistencyPeriodStartDay` = the day after the pass day") and R-47
// will need identically. A step is correct or incorrect against the slice's own
// ordering, which `buildCalendarSlice` already establishes, so nothing here is
// written from recollection about which days the CME trades.
// =============================================================================

import type { CalendarDay, CalendarSlice, TradingDay } from './types.js';

/** The input to the constructor: what a caller loaded, and what it may answer for. */
export interface CalendarSource {
  readonly days: readonly CalendarDay[];
  readonly coverage: { readonly from: TradingDay; readonly to: TradingDay };
}

/**
 * Thrown by the constructor, and by nothing on the fold's path.
 *
 * A MALFORMED SLICE IS A CALLER DEFECT, NOT A DAY THE ENGINE REFUSES. The
 * distinction is ADR-049's: a LOOKUP that misses is answered with a typed
 * refusal because the caller's window must not change the fold's output, but a
 * slice whose days are out of order is not a window choice at all, it is data
 * the caller assembled wrongly, and it is discovered once at construction
 * rather than once per day.
 */
export class CalendarSliceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarSliceError';
  }
}

/**
 * Build the slice. Pure, total on its checks, and the only way one is made.
 *
 * The checks are the ones a rule depends on rather than every check imaginable:
 * days strictly ascending (every day comparison in the engine is lexicographic
 * on a zero-padded ISO day, which is chronological order with no arithmetic),
 * `sequence` strictly ascending with them (R-02's gap counting is subtraction,
 * so a non-monotone sequence would make a gap negative), and coverage
 * containing every day supplied (a day the slice holds and declares it cannot
 * answer for is a contradiction, not a window).
 */
export function buildCalendarSlice(source: CalendarSource): CalendarSlice {
  const { coverage } = source;
  if (coverage.to < coverage.from) {
    throw new CalendarSliceError(`coverage ${coverage.from}..${coverage.to} ends before it starts`);
  }

  const index: Record<string, number> = {};
  let previousDay = '';
  let previousSequence: number | null = null;

  for (let i = 0; i < source.days.length; i += 1) {
    const day = source.days[i];
    if (day === undefined) continue;

    if (day.tradingDay <= previousDay) {
      throw new CalendarSliceError(`day ${day.tradingDay} is not after ${previousDay}`);
    }
    if (previousSequence !== null && day.sequence <= previousSequence) {
      throw new CalendarSliceError(
        `sequence ${String(day.sequence)} on ${day.tradingDay} is not after ${String(previousSequence)}`,
      );
    }
    if (day.tradingDay < coverage.from || day.tradingDay > coverage.to) {
      throw new CalendarSliceError(
        `day ${day.tradingDay} is outside the declared coverage ${coverage.from}..${coverage.to}`,
      );
    }

    index[day.tradingDay] = i;
    previousDay = day.tradingDay;
    previousSequence = day.sequence;
  }

  return { days: [...source.days], index, coverage };
}

/**
 * What a lookup can answer, and the three answers are genuinely different.
 *
 * `outside_coverage` IS NOT `not_a_session`, and collapsing them is the defect
 * ADR-042 F-4 and `0032` exist to prevent one layer down: a day inside coverage
 * that the calendar does not hold is POSITIVELY not a trading day, and a day
 * outside coverage is UNKNOWN. Only one of those is safe to act on.
 */
export type CalendarLookup =
  | { readonly found: true; readonly day: CalendarDay }
  | { readonly found: false; readonly reason: 'not_a_session' | 'outside_coverage' };

/** The calendar query DO-1 makes: is this mark's day a session, and which one. */
export function lookupCalendarDay(slice: CalendarSlice, tradingDay: TradingDay): CalendarLookup {
  if (tradingDay < slice.coverage.from || tradingDay > slice.coverage.to) {
    return { found: false, reason: 'outside_coverage' };
  }

  // A property read, never a key iteration: `noPropertyAccessFromIndexSignature`
  // is why this is bracketed, and the determinism contract's "iteration over an
  // object's keys where the result affects output" is why it is a read at all.
  const position = slice.index[tradingDay];
  if (position === undefined) return { found: false, reason: 'not_a_session' };

  const day = slice.days[position];
  if (day === undefined) return { found: false, reason: 'not_a_session' };
  return { found: true, day };
}

/**
 * The trading day STRICTLY AFTER `tradingDay`, which is AS-12's whole subject.
 *
 * R-31 sets `consistencyPeriodStartDay` to "the day after the pass day" and
 * R-47 sets it to "the next trading day after `payoutAnchorDay`". AS-12 is what
 * happens when the anchor is included instead of excluded: "the very day that
 * funded a payout counts against the next cycle ... it looks like the
 * consistency rule working rather than a bug."
 *
 * RUNNING OFF THE END OF THE SLICE IS `outside_coverage` AND NOT A NULL, and
 * that is ADR-049's ruling applied where it bites rather than a defensive
 * choice. The alternatives were both rejected there: returning null "silently
 * weakens a money gate", and throwing makes "the fold's behavior depend on how
 * much calendar the caller loaded, which is a caller decision leaking into
 * engine output". A typed miss travels to `DayOutput.assertions`, no state is
 * written for the day, and the caller is told to load more calendar.
 *
 * THE LAST DAY IN `days` IS A MISS EVEN WHEN COVERAGE EXTENDS PAST IT. Coverage
 * says the slice can answer "is this day a session", not "is there another
 * session after this one": a slice covering a week and holding Monday alone
 * knows Tuesday is not a session and knows nothing about the week after. Both
 * are UNKNOWN in the only sense that matters here.
 */
export function nextTradingDayAfter(slice: CalendarSlice, tradingDay: TradingDay): CalendarLookup {
  const here = lookupCalendarDay(slice, tradingDay);
  if (!here.found) return here;

  const position = slice.index[tradingDay];
  if (position === undefined) return { found: false, reason: 'not_a_session' };

  const next = slice.days[position + 1];
  if (next === undefined) return { found: false, reason: 'outside_coverage' };
  return { found: true, day: next };
}
