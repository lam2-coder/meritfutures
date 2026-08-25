// =============================================================================
// packages/rules-engine/test/calendar.test.ts
// =============================================================================
// ADR-049's constructor and its lookup. The ruling's load-bearing half is what a
// MISS does, and there are two kinds of miss.
// =============================================================================

import { expect, test } from 'vitest';

import { buildCalendarSlice, CalendarSliceError, lookupCalendarDay } from '../src/calendar.ts';
import { CME_WINDOW, day } from './fixtures-in-code.ts';

test('the slice is data: a hit carries the row, and `sequence` is the calendar’s own index', () => {
  const hit = lookupCalendarDay(CME_WINDOW, day('2026-11-04'));
  expect(hit.found).toBe(true);
  if (!hit.found) return;
  expect(hit.day.tradingDay).toBe(day('2026-11-04'));
  // Not 2: "a dense index into the calendar", not a position in this window.
  expect(hit.day.sequence).toBe(4023);
});

test('a day inside coverage that is not a session is POSITIVELY not a trading day', () => {
  const withoutWednesday = buildCalendarSlice({
    days: CME_WINDOW.days.filter((d) => d.tradingDay !== day('2026-11-04')),
    coverage: CME_WINDOW.coverage,
  });

  const miss = lookupCalendarDay(withoutWednesday, day('2026-11-04'));
  expect(miss.found).toBe(false);
  if (miss.found) return;
  expect(miss.reason).toBe('not_a_session');
});

test('a day outside coverage is UNKNOWN, which is a different answer', () => {
  // ADR-042 F-4 and `0032` make an uncovered day a positive unknown in the
  // database; ADR-049 carries the same distinction into the engine "because
  // those two answers differ and only one of them is safe to act on".
  const before = lookupCalendarDay(CME_WINDOW, day('2026-10-30'));
  const after = lookupCalendarDay(CME_WINDOW, day('2026-11-09'));

  expect(before.found).toBe(false);
  expect(after.found).toBe(false);
  if (before.found || after.found) return;
  expect(before.reason).toBe('outside_coverage');
  expect(after.reason).toBe('outside_coverage');
});

test('the constructor refuses a slice a rule could not be computed over', () => {
  const monday = CME_WINDOW.days[0];
  const tuesday = CME_WINDOW.days[1];
  if (monday === undefined || tuesday === undefined) throw new Error('fixture window is empty');

  // Out of order. Every day comparison in the engine is lexicographic on a
  // zero-padded ISO day, so an unordered slice silently answers wrongly.
  expect(() =>
    buildCalendarSlice({ days: [tuesday, monday], coverage: CME_WINDOW.coverage }),
  ).toThrow(CalendarSliceError);

  // A non-monotone sequence, which would make R-37's gap subtraction negative.
  expect(() =>
    buildCalendarSlice({
      days: [monday, { ...tuesday, sequence: monday.sequence }],
      coverage: CME_WINDOW.coverage,
    }),
  ).toThrow(CalendarSliceError);

  // A day the slice holds and declares it cannot answer for.
  expect(() =>
    buildCalendarSlice({
      days: [monday, tuesday],
      coverage: { from: day('2026-11-03'), to: day('2026-11-06') },
    }),
  ).toThrow(CalendarSliceError);

  // A CONSTRUCTION FAILURE THROWS AND A LOOKUP FAILURE DOES NOT, which is
  // ADR-049's distinction: the caller's WINDOW must not change the fold's
  // output, but a slice assembled wrongly is a caller defect and is found once
  // rather than once per day.
  expect(() => lookupCalendarDay(CME_WINDOW, day('2030-01-01'))).not.toThrow();
});
