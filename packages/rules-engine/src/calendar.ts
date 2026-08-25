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
//   here    the constructor, the lookup DO-1 needs, `nextTradingDayAfter`, and
//           R-37's gap count by `sequence` subtraction
//   not     R-02's counter advance, which is not a calendar query at all
//
// THE GAP COUNT MOVED ACROSS THAT LINE WHEN GROUP F ARRIVED, and this header
// used to say it belonged with the missing calendar data. That was one claim too
// wide, and `nextTradingDayAfter` had already been moved on the narrower
// reading: what TR-01 forbids is writing down WHICH DAYS THE EXCHANGE TRADES
// from recollection, and neither function does that. `tradingDaysBetween`
// subtracts two `sequence` values the caller's own slice supplied. M01 section
// 2.1 defines `sequence` as "a DENSE index into the calendar", so the
// difference is the count of exchange trading days in the interval whether or
// not the slice holds every day between them, which is the entire reason the
// field exists ("gap counting is subtraction, never date math"). A subtraction
// is correct or incorrect against the slice's own numbering, which
// `buildCalendarSlice` already establishes.
//
// WHAT IS STILL BLOCKED ON THE DATA IS THE FIXTURE, NOT THE FUNCTION. P2
// section 2 puts groups A, F and H after the calendar lands because their
// GOLDEN FILES need "a full slice, real data"; the unit suite folds against the
// five-session window in `test/fixtures-in-code.ts`, whose sequences start at
// 4021 precisely so a test cannot confuse a window offset for a calendar index.
// =============================================================================

import type { CalendarDay, CalendarSlice, TradingDay } from './types.ts';

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

/** A gap count, or the reason the slice could not supply one. */
export type GapCount =
  | { readonly found: true; readonly tradingDays: number }
  | { readonly found: false; readonly reason: 'not_a_session' | 'outside_coverage' };

/**
 * R-37's count: trading days `d` with `afterDay < d <= throughDay`.
 *
 * `count = sequence(throughDay) - sequence(afterDay)`, WHICH IS THE WHOLE
 * MECHANISM. M01 R-02: "gap counting is `calendar.sequence` subtraction, never
 * date arithmetic", and R-37: "computed by `calendar.sequence` subtraction".
 * AS-06 is why: five trading days is 7 calendar days in June and 9 to 10 across
 * the year-end cluster, so any implementation that reached for a date difference
 * would publish a rule its own traders cannot evaluate.
 *
 * THE SLICE NEED NOT HOLD THE DAYS BETWEEN THEM. `sequence` is a dense index
 * into the exchange's calendar rather than a position in this window, so the
 * difference is the true count even across a window that skipped days. That is
 * the property `buildCalendarSlice` protects by refusing a non-monotone sequence
 * and the one `test/fixtures-in-code.ts` protects by starting its window at 4021.
 *
 * BOTH ENDPOINTS MUST BE IN THE SLICE, AND A MISS IS A TYPED REFUSAL. P2
 * section 1 rules exactly this case, because "replay will ask for the sequence
 * of an anchor older than the slice": returning null "silently weakens R-37, a
 * money gate", and throwing would make "the fold's behavior depend on how much
 * calendar the caller loaded, which is a caller decision leaking into engine
 * output". So the miss travels to `DayOutput.assertions`, no state is written
 * for the day, and the caller is told to load more calendar.
 *
 * The count is NEGATIVE when `throughDay` precedes `afterDay`, and that is
 * arithmetic rather than an error: the caller compares it against a
 * non-negative configured gap (CV-08), so a backwards interval fails the gate
 * instead of passing it by accident.
 */
export function tradingDaysBetween(
  slice: CalendarSlice,
  afterDay: TradingDay,
  throughDay: TradingDay,
): GapCount {
  const from = lookupCalendarDay(slice, afterDay);
  if (!from.found) return from;

  const to = lookupCalendarDay(slice, throughDay);
  if (!to.found) return to;

  return { found: true, tradingDays: to.day.sequence - from.day.sequence };
}

/**
 * The trading day carrying a given `sequence`, or `null`.
 *
 * IT RETURNS A NULL WHERE EVERYTHING ELSE IN THIS FILE RETURNS A TYPED MISS, and
 * the difference is which side of ADR-049's ruling the caller sits on. That
 * ruling governs a lookup a GATE DECISION depends on. This function serves
 * `next_eligible_trading_day`, which API_CONTRACT already types `string | null`
 * and which is REPORTED rather than compared: AS-06 requires the trader to be
 * shown a resolved date instead of doing trading-day arithmetic, and a slice
 * that stops short of that date makes the date unknown without making the gate
 * unknown. Reporting null there is honest; letting a gate pass on a null is what
 * P2 section 1 rejected.
 *
 * A LINEAR SCAN AND NOT INDEX ARITHMETIC. `slice.index` maps a DAY to a
 * position, and a position is not a sequence: a window that skipped days would
 * make `days[position + n]` the wrong day, silently, exactly on the holiday
 * clusters AS-06 is about.
 */
export function tradingDayAtSequence(slice: CalendarSlice, sequence: number): CalendarDay | null {
  for (const day of slice.days) {
    if (day.sequence === sequence) return day;
  }
  return null;
}
