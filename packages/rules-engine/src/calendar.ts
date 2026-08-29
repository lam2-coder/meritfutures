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

// =============================================================================
// AN INSTANT IS NOT A TRADING DAY, AND THIS IS WHERE THE TWO MEET
// =============================================================================
// EVERYTHING ABOVE THIS LINE TAKES A DAY OR A SEQUENCE AND NOTHING ABOVE IT
// TAKES AN INSTANT. That is a property of `CalendarSlice` rather than an
// omission: a `CalendarDay` carries `tradingDay`, `isHalfDay`, `halted` and
// `sequence`, and NO SESSION BOUNDS AT ALL, so no function over a slice could
// answer "which trading day is this moment in" however it was written.
//
// `0004_catalog.sql` stores the bounds one layer down and says what they are
// for: "THE TRADING DAY IS DATA, NEVER ARITHMETIC. Session boundaries are
// stored as UTC instants derived from CT session definitions, so DST is a row
// rather than a calculation (B4 #1). No engine rule ever derives a trading day
// from a timestamp's UTC date."
//
// THE ANSWER IS A CONTAINMENT LOOKUP AND NEVER A DATE CONVERSION, which is
// `R-01`'s own shape and `ADR-146`'s worked example read forwards:
// `2026-03-03T23:30:00Z` is 17:30 CT, inside the session that opened at 17:00
// CT on `2026-03-03`, and THAT SESSION'S TRADING DAY IS `2026-03-04`. The
// instant's UTC date is `2026-03-03`. An implementation that took the UTC date
// would be right all afternoon and wrong every evening, which `ADR-146` names
// as the worst available failure shape because it reads as correct on every day
// somebody happens to check.
//
// SO NO DAY IS COMPUTED HERE EITHER. An instant is compared only with an
// instant, and the trading day is READ off the row that comparison selected.
// That is `apps/worker/src/batch/adapter.ts`'s idiom stated as a rule, and
// `apps/api/src/admin-source/liability.ts` performs the same comparison over the
// same two tables for the liability anchor.
//
// -----------------------------------------------------------------------------
// WHY THIS IS A SECOND VALUE AND NOT A WIDER `CalendarDay`
// -----------------------------------------------------------------------------
// Adding `sessionOpenAt` and `sessionCloseAt` to `CalendarDay` was the available
// shortcut and it is refused. `0032` header item 4 refused the symbol dimension
// on the ground that it "changes the engine's calendar contract, and makes the
// calendar's grain differ from the grain every counter is defined at"; instants
// on `CalendarDay` do the same thing from the other side. Every rule that folds
// over a slice counts in DAYS, `sequence` subtraction is the whole mechanism
// (R-02, R-37), and a fold that could reach a session bound is a fold that could
// start comparing instants inside a day counter.
//
// So the two values stay apart and the caller assembles whichever it needs.
// {@link SessionCalendar} answers ONE question, and no rule in this engine folds
// over it.
//
// -----------------------------------------------------------------------------
// BOTH TABLES, BECAUSE ONE OF THEM CANNOT SAY "I DO NOT KNOW"
// -----------------------------------------------------------------------------
// `ADR-042` F-4 and the `trading_calendar` scope rule are quoted here because
// this is the file that has to honour them: "coverage is `trading_calendar_
// loads`', and a day outside it is UNKNOWN rather than a holiday", while "a
// holiday is a NULL session and never an absent row"
// (`trading_calendar_holiday_has_no_session`).
//
// A FUNCTION THAT RETURNED A DAY FOR EVERY INSTANT WOULD THEREFORE BE WRONG.
// F-4's whole subject is that an exhausted calendar is otherwise
// indistinguishable from an unbroken holiday: "every counter quietly stops
// advancing, no rule fires, nothing breaches, nothing becomes eligible, and
// NOTHING RAISES". Returning the nearest loaded day instead is the same failure
// with a plausible value attached to it.
// =============================================================================

/**
 * One row of `trading_calendar`, with `0032`'s CHECK expressed as a TYPE.
 *
 * `trading_calendar_holiday_has_no_session` is `CHECK (is_holiday =
 * (session_open_at IS NULL))`, an equality between two booleans and therefore a
 * constraint in both directions at once. It is a discriminated union here rather
 * than three independent fields so that A HOLIDAY CARRYING A SESSION CANNOT BE
 * SPELLED, which is `F-1`'s defect refused at the type level: `R-01` is a
 * containment lookup, so a fabricated holiday interval is an interval a fill can
 * fall inside, and it is an interval THIS function would place an instant in.
 *
 * THE TYPE BINDS THE ASSEMBLER AND NOT THE DATABASE, and the difference matters
 * because the rows arrive as `unknown` at every real call site. The re-assertion
 * against a row belongs where the row is read, which is what
 * `liability.ts`'s `horizonRow` does with this same CHECK in both directions.
 */
export type SessionDay =
  | {
      readonly tradingDay: TradingDay;
      readonly isHoliday: false;
      /** `session_open_at` as whole epoch milliseconds. */
      readonly openAtMs: number;
      /** `session_close_at` as whole epoch milliseconds. */
      readonly closeAtMs: number;
    }
  | {
      readonly tradingDay: TradingDay;
      readonly isHoliday: true;
      readonly openAtMs: null;
      readonly closeAtMs: null;
    };

/**
 * One `trading_calendar_loads` row's `[coverage_start_day, coverage_end_day]`.
 *
 * A LOAD IS A POSITIVE STATEMENT THAT THIS RANGE WAS LOADED AND NEVER A
 * STATEMENT THAT ANOTHER RANGE WAS NOT. `0032` puts one row per load and
 * declares no supersession column, so the gap between two disjoint loads is
 * UNKNOWN rather than an interpolation anything here is entitled to make.
 */
export interface CoverageInterval {
  readonly from: TradingDay;
  readonly to: TradingDay;
}

/** What {@link buildSessionCalendar} is handed: both tables, and neither alone. */
export interface SessionCalendarSource {
  /** `trading_calendar`, holidays included. Ascending by `tradingDay`. */
  readonly sessions: readonly SessionDay[];
  /** `trading_calendar_loads`. EMPTY IS A FACT: the estate answers for no day. */
  readonly coverage: readonly CoverageInterval[];
}

/**
 * One covered interval and the sessions inside it, with its instant span.
 *
 * THE SPAN IS DERIVED FROM SESSIONS AND NEVER FROM THE DAYS, and that is the
 * step that keeps this file honest. Coverage is stated in DAYS and the question
 * is asked about an INSTANT, so deciding "is this instant inside coverage" by
 * comparing it against `coverage_start_day` would require a date for the
 * instant, which is the one derivation `ADR-146` clause 1 forbids. The session
 * bounds are already instants, so the interval's reach in instants is the
 * earliest open and the latest close among the sessions it holds, and every
 * comparison stays instant against instant.
 *
 * `openMs` AND `closeMs` ARE NULL WHEN THE INTERVAL HOLDS NO SESSION. A load
 * covering a week of holidays declares days and contributes no instants, so
 * nothing can be placed inside it and it answers for nothing.
 */
export interface CoveredSpan {
  readonly from: TradingDay;
  readonly to: TradingDay;
  readonly sessions: readonly {
    readonly tradingDay: TradingDay;
    readonly openAtMs: number;
    readonly closeAtMs: number;
  }[];
  readonly openMs: number | null;
  readonly closeMs: number | null;
}

/**
 * The value {@link tradingDayAt} reads. Built once, frozen, and carries no behavior.
 *
 * `CalendarSliceIsData`'s reason applies unchanged one value over: an interface
 * carrying `get()` is a capability, a caller could satisfy it with a live query
 * or with something that reads the clock, and every purity mechanism would stay
 * green while the answer became a function of what the caller happened to do.
 */
export interface SessionCalendar {
  /** Covered intervals, overlaps merged, ascending. Never adjacent-merged. */
  readonly spans: readonly CoveredSpan[];
}

/**
 * Build the session calendar. Pure, and the only way one is made.
 *
 * THE CHECKS ARE THE ONES THE LOOKUP DEPENDS ON rather than every check
 * imaginable, which is {@link buildCalendarSlice}'s own line:
 *
 *   days strictly ascending      every day comparison here is lexicographic on a
 *                                zero-padded ISO day, chronological with no
 *                                arithmetic
 *   whole millisecond bounds     a fractional instant is a float on a path that
 *                                decides which day a row is stamped with
 *   `close > open`               `0032`'s `trading_calendar_session_ordered`,
 *                                re-asserted because a session that closes
 *                                before it opens contains nothing and would make
 *                                every instant in it UNKNOWN
 *   sessions do not OVERLAP      the load-bearing one. Containment is only an
 *                                ANSWER if at most one session contains an
 *                                instant. `P1-SE` states the property this
 *                                relies on: "The next session opens at 17:00 CT
 *                                regardless, so no overlap is created and no
 *                                fill is orphaned". Two overlapping rows would
 *                                make one moment two trading days, and a lookup
 *                                would silently return whichever it scanned first
 *
 * COVERAGE FILTERS RATHER THAN REFUSES, which is the one place this constructor
 * deliberately differs from {@link buildCalendarSlice}. The reason is at the
 * filter itself.
 *
 * A MALFORMED SOURCE IS A CALLER DEFECT AND NOT A DAY THE ENGINE REFUSES, which
 * is `ADR-049`'s distinction and why this throws where the lookup returns a
 * typed miss. It reuses {@link CalendarSliceError} for that reason: the two
 * constructors fail for the same class of reason and a second error type would
 * make one ruling look like two.
 */
export function buildSessionCalendar(source: SessionCalendarSource): SessionCalendar {
  // Overlaps merged, ADJACENT INTERVALS LEFT ALONE. `2026-01-01..2026-06-30` and
  // `2026-07-01..2026-12-31` are two loads with no day between them, and merging
  // them on a date successor would be the date arithmetic R-02 forbids. They
  // stay two spans, and the consequence is stated at {@link tradingDayAt}.
  const sorted = [...source.coverage].sort((a, b) =>
    a.from < b.from ? -1 : a.from > b.from ? 1 : 0,
  );
  const merged: { from: TradingDay; to: TradingDay }[] = [];
  for (const interval of sorted) {
    if (interval.to < interval.from) {
      throw new CalendarSliceError(
        `coverage ${interval.from}..${interval.to} ends before it starts. A backwards coverage ` +
          'interval covers no day at all and would silently make every instant UNKNOWN',
      );
    }
    const last = merged[merged.length - 1];
    if (last !== undefined && interval.from <= last.to) {
      if (interval.to > last.to) last.to = interval.to;
      continue;
    }
    merged.push({ from: interval.from, to: interval.to });
  }

  let previousDay = '';
  let previousCloseMs: number | null = null;
  const placed: {
    readonly tradingDay: TradingDay;
    readonly openAtMs: number;
    readonly closeAtMs: number;
  }[][] = merged.map(() => []);

  for (const session of source.sessions) {
    if (session.tradingDay <= previousDay) {
      throw new CalendarSliceError(`day ${session.tradingDay} is not after ${previousDay}`);
    }
    previousDay = session.tradingDay;

    // A SESSION ROW PAST THE COVERAGE EDGE IS NOT TAKEN, AND IT IS DROPPED
    // RATHER THAN REFUSED. This is where this constructor parts company with
    // {@link buildCalendarSlice}, which throws on the same shape, and the two
    // are right for different reasons: there the caller declares its own
    // coverage, so a day outside it is the caller contradicting itself, while
    // here coverage is a SECOND TABLE's fact and a calendar loaded further than
    // its loads is an ordinary estate state. `liability.ts` rules exactly this
    // pair: "coverage is the authority on what may be answered, so the walk
    // stops at `coveredThroughDay` whatever rows happen to sit past it".
    //
    // IT IS ALSO WHAT MAKES `F-4`'s OWN BRANCH FALL OUT RATHER THAN BE WRITTEN.
    // An estate with a full `trading_calendar` and no `trading_calendar_loads`
    // row places NO session, so every instant answers `outside_coverage`: "an
    // estate that has days and no record of having loaded them is entitled to
    // answer for none of them".
    const spanIndex = merged.findIndex(
      (interval) => session.tradingDay >= interval.from && session.tradingDay <= interval.to,
    );

    // A HOLIDAY CONTRIBUTES NO INTERVAL AND IS NOT MISSING FROM THE PICTURE. It
    // is a positive fact (`0032` F-1) and it is a day inside coverage that no
    // instant can be placed in, which is exactly `not_a_session`.
    if (session.isHoliday) continue;

    const { openAtMs, closeAtMs } = session;
    if (!Number.isSafeInteger(openAtMs) || !Number.isSafeInteger(closeAtMs)) {
      throw new CalendarSliceError(
        `the session on ${session.tradingDay} carries bounds that are not whole milliseconds. A ` +
          'fractional instant is a float on the path that decides which trading day a row is ' +
          'stamped with',
      );
    }
    if (!(closeAtMs > openAtMs)) {
      throw new CalendarSliceError(
        `the session on ${session.tradingDay} closes at or before it opens, which 0032's ` +
          '`trading_calendar_session_ordered` forbids. Such a session contains no instant at all',
      );
    }
    if (previousCloseMs !== null && openAtMs < previousCloseMs) {
      throw new CalendarSliceError(
        `the session on ${session.tradingDay} opens before the previous session closed. ` +
          'Containment is an answer only while at most one session holds an instant, and two ' +
          'overlapping rows would make one moment two trading days',
      );
    }
    previousCloseMs = closeAtMs;

    // EVERY ROW IS VALIDATED AND ONLY THE COVERED ONES ARE PLACED. Ordering and
    // overlap are properties of the DATA rather than of the window, so a
    // malformed row past the coverage edge is still a malformed row and is
    // still worth refusing; what coverage decides is which rows may ANSWER.
    if (spanIndex === -1) continue;
    placed[spanIndex]?.push({ tradingDay: session.tradingDay, openAtMs, closeAtMs });
  }

  const spans: CoveredSpan[] = merged.map((interval, i) => {
    const sessions = placed[i] ?? [];
    const first = sessions[0];
    const last = sessions[sessions.length - 1];
    return {
      from: interval.from,
      to: interval.to,
      sessions,
      openMs: first === undefined ? null : first.openAtMs,
      closeMs: last === undefined ? null : last.closeAtMs,
    };
  });

  return { spans };
}

/**
 * What an instant lookup can answer, and the three answers are genuinely different.
 *
 * {@link CalendarLookup}'s shape and its reason, one vocabulary over.
 * `outside_coverage` IS NOT `not_a_session`: an instant inside a loaded span
 * that no session contains is POSITIVELY not in a trading day, and an instant
 * the estate has loaded nothing around is UNKNOWN. Only one of those is safe to
 * act on, and collapsing them is `ADR-042` F-4's silent failure.
 *
 * IT IS A SEPARATE TYPE FROM `CalendarLookup` BECAUSE THE HIT CARRIES LESS. A
 * `CalendarDay` carries `sequence`, which `trading_calendar` does not store and
 * which an adapter derives by counting; returning one here would mean this
 * function either invented a dense index or refused to answer without one.
 */
export type TradingDayAt =
  | { readonly found: true; readonly tradingDay: TradingDay }
  | { readonly found: false; readonly reason: 'not_a_session' | 'outside_coverage' };

/**
 * The exchange trading day containing `atMs`, or the reason there is none.
 *
 * THE INSTANT IS WHOLE EPOCH MILLISECONDS AND NEVER A `Date`, and that is a
 * purity constraint rather than a style: `merit/engine-purity` bans the `Date`
 * constructor and `no-restricted-globals` bans the bare global, both on
 * `P1` section 2.1's reading that "the clock is the same defect class as an
 * import". A number is data the caller supplies, and `Date.parse` at the call
 * site is `liability.ts`'s `instantMs` idiom.
 *
 * THE INTERVAL IS CLOSED AT BOTH ENDS, which is decidable only because the
 * constructor refused overlap: an instant exactly at a close belongs to the
 * session that closed and there is no second session to also claim it.
 *
 * TWO ADJACENT LOADS ANSWER `outside_coverage` IN THE GAP BETWEEN THEM, and
 * that is stated rather than hidden. Loads covering `..06-30` and `07-01..` make
 * no statement joining them, so the overnight gap between June's last close and
 * July's first open falls in neither span and is UNKNOWN. THIS ERRS TOWARDS THE
 * ANSWER THAT REFUSES: it never returns a day it cannot read off a row, and the
 * remedy is a load that overlaps by a day, which is a fact that row would state.
 */
export function tradingDayAt(calendar: SessionCalendar, atMs: number): TradingDayAt {
  if (!Number.isSafeInteger(atMs)) {
    throw new CalendarSliceError(
      `the instant ${JSON.stringify(atMs)} is not whole milliseconds. A trading day resolved ` +
        'from a fractional instant is a float deciding which day a row is stamped with',
    );
  }

  for (const span of calendar.spans) {
    // A span holding no session reaches no instant, so it is skipped rather
    // than treated as covering everything between its two days.
    if (span.openMs === null || span.closeMs === null) continue;
    if (atMs < span.openMs || atMs > span.closeMs) continue;

    for (const session of span.sessions) {
      if (atMs >= session.openAtMs && atMs <= session.closeAtMs) {
        return { found: true, tradingDay: session.tradingDay };
      }
    }

    // Inside a loaded span and inside no session: a weekend, a holiday, or the
    // gap between one close and the next open. A POSITIVE FACT.
    return { found: false, reason: 'not_a_session' };
  }

  return { found: false, reason: 'outside_coverage' };
}
