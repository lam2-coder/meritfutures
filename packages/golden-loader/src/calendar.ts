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

// -----------------------------------------------------------------------------
// THIS MODULE IMPORTS THE ENGINE FOR TYPES ONLY, AND THAT IS LOAD BEARING
// -----------------------------------------------------------------------------
// `packages/golden-loader/check.mjs` imports `./src/loader.ts` directly and
// never the barrel, because the falsification harness copies the tree WITHOUT
// `node_modules` and runs the checker in the copy: a module needing a workspace
// resolution cannot run there at all. `loader.ts` imports this file, so this
// file inherits that constraint.
//
// SO THE ROWS ARE ASSEMBLED HERE AND THE SLICE IS CONSTRUCTED IN `run.ts`, which
// already imports the engine as a value and is already outside what `check.mjs`
// reaches. ADR-049's `buildCalendarSlice` is still the only thing that makes a
// slice; what moved is which module calls it.
//
// THE FIRST VERSION OF THIS FILE CALLED IT HERE AND PASSED EVERY LOCAL RUN.
// `copyTree` skips `.git` and `node_modules` at the ROOT ONLY, so pnpm's nested
// `packages/golden-loader/node_modules` was copied along with everything else
// and the bare specifier resolved through it. On a CI runner that had not
// installed, it did not. A harness invariant that holds by accident of the local
// tree is one that fails on the machine that matters, and the comment in
// `check.mjs` had stated it correctly all along.
import type { CalendarDay, TradingDay } from '@merit/rules-engine';

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
 * What `buildCalendarSlice` is called with: rows and a coverage interval.
 *
 * IT IS `CalendarSource` IN EVERYTHING BUT NAME, and it is restated rather than
 * imported because `CalendarSource` is declared beside the constructor and this
 * module may not reach the engine for a value. The compile assertion below is
 * what keeps the restatement honest.
 */
export interface CalendarRows {
  readonly days: readonly CalendarDay[];
  readonly coverage: { readonly from: TradingDay; readonly to: TradingDay };
}

/**
 * The record, as the rows ADR-049's constructor takes.
 *
 * COVERAGE IS THE RECORD'S OWN, NOT THE SPAN OF THE SESSIONS. The record
 * declares an interval and `loadCalendar` already enforces that every session
 * falls inside it (L-08); widening or narrowing it here would change which
 * misses are `outside_coverage` and which are `not_a_session`, and ADR-049 makes
 * those two different answers: one says the calendar cannot speak for the day,
 * the other says the day is not a session.
 *
 * THE ROWS ARE NOT VALIDATED HERE and `buildCalendarSlice` is where they are.
 * Days strictly ascending, `sequence` strictly ascending with them, and coverage
 * containing every day are the constructor's checks, and duplicating them would
 * be a second expression of ADR-049's own contract. `loadCalendar` refuses a day
 * outside coverage and a day out of order before this is ever reached, so the
 * constructor cannot throw for a reason the fixture rule did not already name.
 */
export function calendarRowsFromRecord(record: CalendarRecord): CalendarRows {
  if (record.sessions.length === 0) {
    throw new CalendarRecordError('a calendar with no session can grade no fixture');
  }

  return {
    days: record.sessions.map((session, index) => ({
      tradingDay: session.trading_day as TradingDay,
      isHalfDay: isHalfDay(session.kind, session.trading_day),
      halted: false,
      sequence: SYNTHESIZED_SEQUENCE_BASE + index,
    })),
    coverage: {
      from: record.coverage.from as TradingDay,
      to: record.coverage.to as TradingDay,
    },
  };
}
