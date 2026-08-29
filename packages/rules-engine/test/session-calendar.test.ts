// =============================================================================
// packages/rules-engine/test/session-calendar.test.ts
// =============================================================================
// `tradingDayAt`, and the property under test is NOT that it returns a day. It
// is that it returns a day ONLY where a row says so, and says UNKNOWN where the
// estate loaded nothing.
//
// THE FIXTURE IS NOT A CLAIM ABOUT WHICH DAYS ANY EXCHANGE TRADES, and the name
// is chosen so it cannot be mistaken for one. `TR-01` forbids writing an
// exchange's calendar from recollection, and a file full of session instants is
// the easiest place in this repository to do that by accident. What is asserted
// below is a property of the LOOKUP over whatever rows the caller supplied.
//
// THE SHAPE OF THE WINDOW IS TRANSCRIBED FROM `ADR-146` SECTION 3 RATHER THAN
// RECALLED, and it is the only reason these particular instants appear. That
// entry's worked example is `2026-03-03T23:30:00Z`, which is 17:30 CT, "inside
// the session that opened at 17:00 CT on `2026-03-03`, and that session's
// trading day is the next date". The window below is built so the same
// divergence exists, because a suite whose instants all agree with their own
// UTC dates CANNOT TELL "reads the day off the row" from "derives the day from
// the instant", which is the substitution `ADR-146` clause 1 forbids and the
// one `ADR-145` finding 10 refused to paper over.
// =============================================================================

import { expect, test } from 'vitest';

import { buildSessionCalendar, CalendarSliceError, tradingDayAt } from '../src/calendar.ts';
import type { SessionDay } from '../src/calendar.ts';
import type { TradingDay } from '../src/types.ts';

const day = (value: string): TradingDay => value as TradingDay;

/** `Date.parse` is the CALLER's, which is `liability.ts`'s `instantMs` idiom. */
const at = (iso: string): number => {
  const ms = Date.parse(iso);
  if (!Number.isSafeInteger(ms)) throw new Error(`fixture instant ${iso} did not parse`);
  return ms;
};

/**
 * Four days, one of them a holiday, inside one declared load.
 *
 * The two session days are consecutive and the third is separated from them by
 * the holiday, so the window reaches all three of the answers without any day
 * needing to be computed from any other.
 */
const SESSIONS: readonly SessionDay[] = [
  {
    tradingDay: day('2026-03-03'),
    isHoliday: false,
    openAtMs: at('2026-03-02T23:00:00Z'),
    closeAtMs: at('2026-03-03T22:00:00Z'),
  },
  {
    tradingDay: day('2026-03-04'),
    isHoliday: false,
    openAtMs: at('2026-03-03T23:00:00Z'),
    closeAtMs: at('2026-03-04T22:00:00Z'),
  },
  // A holiday is a NULL session and never an absent row
  // (`trading_calendar_holiday_has_no_session`). It carries no instants and so
  // places nothing, which is what makes the day after it reachable as a
  // `not_a_session` rather than as a hole.
  { tradingDay: day('2026-03-05'), isHoliday: true, openAtMs: null, closeAtMs: null },
  {
    tradingDay: day('2026-03-06'),
    isHoliday: false,
    openAtMs: at('2026-03-05T23:00:00Z'),
    closeAtMs: at('2026-03-06T22:00:00Z'),
  },
];

const LOADED_WINDOW = buildSessionCalendar({
  sessions: SESSIONS,
  coverage: [{ from: day('2026-03-03'), to: day('2026-03-06') }],
});

test('the premise: the evening instant and its own UTC date genuinely disagree', () => {
  // ASSERTED BEFORE ANYTHING ELSE, on `ADR-146` section 3's discipline: "the
  // divergence itself is asserted before either, so the premise the whole test
  // rests on cannot silently stop being true". Without this line every
  // assertion below could pass against an implementation that took the UTC
  // date, and nothing would say so.
  const evening = '2026-03-03T23:30:00Z';
  expect(evening.slice(0, 10)).toBe('2026-03-03');

  const resolved = tradingDayAt(LOADED_WINDOW, at(evening));
  expect(resolved.found).toBe(true);
  if (!resolved.found) return;
  expect(resolved.tradingDay).toBe(day('2026-03-04'));
  expect(resolved.tradingDay).not.toBe(evening.slice(0, 10));
});

test('a morning instant agrees with its UTC date, and that is why one row is not enough', () => {
  // `ADR-146` section 3's counter-example, and it is here for the reason that
  // entry gives: a suite holding only the evening row could not tell "renders
  // the stored day" from "renders the day AFTER the instant".
  const morning = '2026-03-04T13:30:00Z';
  expect(morning.slice(0, 10)).toBe('2026-03-04');

  const resolved = tradingDayAt(LOADED_WINDOW, at(morning));
  expect(resolved.found).toBe(true);
  if (!resolved.found) return;
  expect(resolved.tradingDay).toBe(day('2026-03-04'));
});

test('both ends of a session are inside it, which non-overlap is what makes decidable', () => {
  const open = tradingDayAt(LOADED_WINDOW, at('2026-03-03T23:00:00Z'));
  const close = tradingDayAt(LOADED_WINDOW, at('2026-03-04T22:00:00Z'));

  expect(open.found).toBe(true);
  expect(close.found).toBe(true);
  if (!open.found || !close.found) return;
  expect(open.tradingDay).toBe(day('2026-03-04'));
  expect(close.tradingDay).toBe(day('2026-03-04'));
});

test('an instant inside coverage and inside no session is POSITIVELY not a trading day', () => {
  // 22:30Z is after `2026-03-04` closed at 22:00Z and before `2026-03-06`
  // opened at 23:00Z on the 5th, with a holiday between. This is the answer a
  // UTC-date implementation cannot produce at all: it would return `2026-03-04`
  // and no caller would ever learn the moment was in no session.
  const between = tradingDayAt(LOADED_WINDOW, at('2026-03-04T22:30:00Z'));
  expect(between.found).toBe(false);
  if (between.found) return;
  expect(between.reason).toBe('not_a_session');

  // Squarely inside the holiday's own UTC date, for the same answer.
  const holiday = tradingDayAt(LOADED_WINDOW, at('2026-03-05T15:00:00Z'));
  expect(holiday.found).toBe(false);
  if (holiday.found) return;
  expect(holiday.reason).toBe('not_a_session');
});

test('an instant the estate loaded nothing around is UNKNOWN, which is a different answer', () => {
  // ADR-042 F-4. Collapsing this into `not_a_session` is the failure that entry
  // exists for: "an exhausted calendar is indistinguishable from an unbroken
  // holiday ... and NOTHING RAISES".
  const before = tradingDayAt(LOADED_WINDOW, at('2026-03-02T22:00:00Z'));
  const after = tradingDayAt(LOADED_WINDOW, at('2026-03-06T22:00:01Z'));

  expect(before.found).toBe(false);
  expect(after.found).toBe(false);
  if (before.found || after.found) return;
  expect(before.reason).toBe('outside_coverage');
  expect(after.reason).toBe('outside_coverage');
});

test('a calendar with rows and no load answers for NONE of them', () => {
  // `liability.ts`'s F-4 branch, and it falls out of the coverage filter rather
  // than being written as a case: "an estate that has days and no record of
  // having loaded them is entitled to answer for none of them".
  const unloaded = buildSessionCalendar({ sessions: SESSIONS, coverage: [] });

  const inside = tradingDayAt(unloaded, at('2026-03-04T13:30:00Z'));
  expect(inside.found).toBe(false);
  if (inside.found) return;
  expect(inside.reason).toBe('outside_coverage');
});

test('a session past the coverage edge is not taken, and does not become the answer', () => {
  // Coverage stops on the 4th. The 6th is still a row and it is still a real
  // session; it may not answer, and the instant inside it is UNKNOWN rather
  // than resolved to the nearest day that WAS loaded.
  const narrow = buildSessionCalendar({
    sessions: SESSIONS,
    coverage: [{ from: day('2026-03-03'), to: day('2026-03-04') }],
  });

  const past = tradingDayAt(narrow, at('2026-03-06T13:30:00Z'));
  expect(past.found).toBe(false);
  if (past.found) return;
  expect(past.reason).toBe('outside_coverage');
});

test('two disjoint loads leave the gap between them UNKNOWN rather than interpolated', () => {
  // `0032` declares no supersession column, so a load is a positive statement
  // that ITS range was loaded and never a statement about the range beside it.
  const split = buildSessionCalendar({
    sessions: SESSIONS,
    coverage: [
      { from: day('2026-03-03'), to: day('2026-03-03') },
      { from: day('2026-03-06'), to: day('2026-03-06') },
    ],
  });

  const resolved = tradingDayAt(split, at('2026-03-06T13:30:00Z'));
  expect(resolved.found).toBe(true);
  if (!resolved.found) return;
  expect(resolved.tradingDay).toBe(day('2026-03-06'));

  // `2026-03-04` is a real session in `SESSIONS` and neither load covers it.
  const gap = tradingDayAt(split, at('2026-03-04T13:30:00Z'));
  expect(gap.found).toBe(false);
  if (gap.found) return;
  expect(gap.reason).toBe('outside_coverage');
});

test('the constructor refuses the data a containment lookup could not answer over', () => {
  const base = SESSIONS[0];
  if (base === undefined) throw new Error('fixture window is empty');

  // Out of order. Every day comparison here is lexicographic on a zero-padded
  // ISO day, so an unordered source silently answers wrongly.
  expect(() =>
    buildSessionCalendar({
      sessions: [...SESSIONS].reverse(),
      coverage: [{ from: day('2026-03-03'), to: day('2026-03-06') }],
    }),
  ).toThrow(CalendarSliceError);

  // OVERLAP IS THE LOAD-BEARING REFUSAL. Containment is an answer only while at
  // most one session holds an instant; two overlapping rows make one moment two
  // trading days and a scan returns whichever it reached first.
  expect(() =>
    buildSessionCalendar({
      sessions: [
        base,
        {
          tradingDay: day('2026-03-04'),
          isHoliday: false,
          // Opens an hour BEFORE `2026-03-03` closed.
          openAtMs: at('2026-03-03T21:00:00Z'),
          closeAtMs: at('2026-03-04T22:00:00Z'),
        },
      ],
      coverage: [{ from: day('2026-03-03'), to: day('2026-03-06') }],
    }),
  ).toThrow(CalendarSliceError);

  // `0032`'s `trading_calendar_session_ordered`, re-asserted because such a
  // session contains no instant at all.
  expect(() =>
    buildSessionCalendar({
      sessions: [
        {
          tradingDay: day('2026-03-03'),
          isHoliday: false,
          openAtMs: at('2026-03-03T22:00:00Z'),
          closeAtMs: at('2026-03-02T23:00:00Z'),
        },
      ],
      coverage: [{ from: day('2026-03-03'), to: day('2026-03-06') }],
    }),
  ).toThrow(CalendarSliceError);

  // A backwards coverage interval covers no day at all and would silently make
  // every instant UNKNOWN, which is a wrong answer wearing the right one's hat.
  expect(() =>
    buildSessionCalendar({
      sessions: [],
      coverage: [{ from: day('2026-03-06'), to: day('2026-03-03') }],
    }),
  ).toThrow(CalendarSliceError);
});

test('a fractional instant is refused rather than rounded to a day', () => {
  // No floats on a path that decides which trading day a row is stamped with.
  expect(() => tradingDayAt(LOADED_WINDOW, at('2026-03-04T13:30:00Z') + 0.5)).toThrow(
    CalendarSliceError,
  );
});
