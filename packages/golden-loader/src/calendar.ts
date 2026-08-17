// =============================================================================
// packages/golden-loader/src/calendar.ts
// =============================================================================
// A CALENDAR RECORD BECOMES A `CalendarSlice`, AND THE ONE FIELD IT CANNOT READ
// IS THE ONE R-02 IS ABOUT.
//
// ADR-049 makes the slice a VALUE built by a pure exported constructor, and
// `buildCalendarSlice` is that constructor, so this file assembles rows and
// hands them over rather than implementing a slice of its own. The constructor
// then enforces what a rule depends on: days strictly ascending, `sequence`
// strictly ascending with them, and coverage containing every day supplied.
//
// -----------------------------------------------------------------------------
// `sequence` IS SYNTHESIZED FROM POSITION AND THAT IS A REPORTED LIMITATION
// -----------------------------------------------------------------------------
// `CalendarDay.sequence` is "a dense index into the calendar" and R-02's second
// half is that gap counting is `sequence` SUBTRACTION, never date arithmetic.
// **`fixtures/calendars/cme-2026.json` states no sequence for any session**, so
// the only ordering this file has is the position of a row in the `sessions`
// array.
//
// FOR A CONTIGUOUS FIXTURE CALENDAR THE TWO AGREE AND THE FIXTURES ARE STILL
// GRADED HONESTLY: `cme-2026.json` holds five consecutive sessions with a
// coverage interval that is exactly those five, so a dense index over the array
// IS the dense index into the calendar. **What it cannot do is discriminate**,
// which is precisely what `fixtures-in-code.ts` built `GAPPED_SLICE` to do: on a
// calendar with a hole in it, position and calendar index diverge, and a fixture
// graded through this file would be measuring a window offset. The base below is
// not zero for the same reason that file gives, so a reader cannot mistake one
// for the other by eye.
//
// **The repair is a `sequence` on the record**, not a cleverer derivation here,
// and it belongs with the calendar transcription (P2 section 6) that the fixture
// calendar's own `status: partial` is waiting for.
//
// -----------------------------------------------------------------------------
// `kind` IS READ, WHICH CLOSES A DROPPED INPUT RATHER THAN ADDING ONE
// -----------------------------------------------------------------------------
// Every session in the record states `"kind": "full"` and nothing read it. That
// is the worst shape available on this path in the loader's own words: "the
// fixture states a condition, the engine never sees it, and the scenario passes
// while pinning something else". `CalendarDay.isHalfDay` is where a half day
// goes, R-03 is the rule that reads it, and a `kind` this file does not
// recognise is refused rather than flattened into `full`.
//
// `halted` HAS NO SOURCE AND IS `false` ON EVERY DAY. R-04 ("no win day on a
// halted session") is therefore present in the engine and unexercised by any
// fixture graded through this file. The record has no key for it; inventing one
// here would be this file deciding a session was halted.
// =============================================================================

import { buildCalendarSlice } from '@merit/rules-engine';
import type { CalendarDay, CalendarSlice, TradingDay } from '@merit/rules-engine';

/**
 * The base the synthesized `sequence` counts from.
 *
 * NOT ZERO, AND THE REASON IS `fixtures-in-code.ts`'s: `sequence` "is not the
 * position in this window ... it starts somewhere in the middle of the
 * exchange's own numbering", and a slice numbered from zero would let a reader
 * confuse a window offset for a calendar index. That confusion is exactly what
 * this file cannot rule out, so the number is chosen to make it visible instead
 * of plausible.
 */
export const SYNTHESIZED_SEQUENCE_BASE = 4021;

/** What the record states, before it becomes a slice. */
export interface CalendarRecord {
  readonly coverage: { readonly from: string; readonly to: string };
  readonly sessions: readonly { readonly trading_day: string; readonly kind?: string }[];
}

/** Thrown with `L-08`, the calendar rule, like every other refusal in this package. */
export class CalendarRecordError extends Error {
  readonly rule = 'L-08';

  constructor(message: string) {
    super(message);
    this.name = 'CalendarRecordError';
  }
}

/**
 * `kind` to the flag `CalendarDay` declares.
 *
 * TWO SPELLINGS AND NO THIRD. `full` and `half` are what a session is in this
 * format; anything else is a condition this file cannot pass on, and refusing
 * is the only answer that does not silently drop it.
 */
function isHalfDay(kind: string | undefined, tradingDay: string): boolean {
  if (kind === undefined || kind === 'full') return false;
  if (kind === 'half') return true;
  throw new CalendarRecordError(
    `session ${tradingDay} states kind ${JSON.stringify(kind)}, which is neither full nor half, ` +
      'and a kind this loader cannot map is a stated condition the engine would never see',
  );
}

/**
 * Build the slice the fold is handed.
 *
 * COVERAGE IS THE RECORD'S OWN, NOT THE SPAN OF THE SESSIONS. The record
 * declares an interval and `loadCalendar` already enforces that every session
 * falls inside it (L-08); widening or narrowing it here would change which
 * misses are `outside_coverage` and which are `not_a_session`, and ADR-049 makes
 * those two different answers: one says the calendar cannot speak for the day,
 * the other says the day is not a session.
 */
export function buildSliceFromRecord(record: CalendarRecord): CalendarSlice {
  if (record.sessions.length === 0) {
    throw new CalendarRecordError('a calendar with no session can grade no fixture');
  }

  const days: CalendarDay[] = record.sessions.map((session, index) => ({
    tradingDay: session.trading_day as TradingDay,
    isHalfDay: isHalfDay(session.kind, session.trading_day),
    halted: false,
    sequence: SYNTHESIZED_SEQUENCE_BASE + index,
  }));

  return buildCalendarSlice({
    days,
    coverage: {
      from: record.coverage.from as TradingDay,
      to: record.coverage.to as TradingDay,
    },
  });
}
