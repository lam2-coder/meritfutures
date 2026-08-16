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
//   here    the constructor, and the lookup DO-1 needs
//   not     `nextTradingDayAfter` (R-47) and sequence-gap counting (R-37, R-02)
//
// The second pair belongs to groups A and H, which P2 section 2 puts AFTER the
// real calendar data lands ("There is not one calendar row in the repository").
// Writing them now would mean writing them against no data, which is the
// transcription-from-recollection TR-01 forbids.
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
