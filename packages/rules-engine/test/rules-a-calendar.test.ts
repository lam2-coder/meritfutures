// =============================================================================
// GROUP A: TIME AND CALENDAR. RE-U-001 to RE-U-006, and the group is complete.
// =============================================================================
// THIS FILE USED TO SAY FOUR OF GROUP A'S SIX RULES WERE BLOCKED ON THE CALENDAR
// TRANSCRIPTION. TWO OF THE FOUR WERE NEVER BLOCKED ON IT AND THE OTHER TWO ARE
// NOT BLOCKED ON IT EITHER, THEY ARE SOMEBODY ELSE'S RULES. Both halves of that
// sentence are corrections to a claim this suite inherited, and the primary
// source that settles both is M01 section 3.1's ordering table rather than
// anything about the calendar data:
//
//   DO-1 | Reject unless: the account is open, `mark.tradingDay` is a calendar
//        | trading day, no live state exists for that day already (idempotence,
//        | INV-14), and `mark.tradingDay > prior.tradingDay`      | R-02, R-06
//
// So M01 ITSELF MAPS R-02 AND R-06 ONTO A CHECK DO-1 ALREADY PERFORMS, and
// `advance.ts` has carried both since group B landed, citing them by name. What
// the calendar transcription blocks is GS-001, GS-002 and GS-030 to GS-032,
// which are GOLDEN files that fold a real day sequence. A unit test is not a
// golden file, which is the distinction `calendar.ts`'s header already had to
// make once for `tradingDaysBetween` and which was not carried across to here.
//
// R-01 AND R-05 ARE NOT WAITING FOR THE DATA, THEY ARE WAITING FOR NOTHING. Both
// are stated against `trading_calendar.session_open_at` and `session_close_at`,
// and `CalendarDay` carries neither: it is `{tradingDay, isHalfDay, halted,
// sequence}` and a transcribed CME year does not add a column to it. R-01 is a
// containment lookup over a fill's execution timestamp and `DailyMark` holds no
// fill and no instant, only `fillCount`. So no amount of calendar data makes
// either one an engine rule; they are discharged by `0032`'s constraints and by
// the ingest path, and RE-U-001 and RE-U-005 assert that ABSENCE, in RE-U-019's
// idiom: "an absence is the one kind of rule a reader cannot check by finding
// the line".
// =============================================================================

import { expect, test } from 'vitest';

import { tradingDaysBetween } from '../src/calendar.js';
import { advanceDay } from '../src/day/advance.js';
import type { CalendarDay, DailyMark, DayOutput, RuleState } from '../src/types.js';
import {
  ACCOUNT_OPENED_ON,
  CME_WINDOW,
  CORE_50K,
  ENGINE_VERSION,
  GAPPED_SLICE,
  day,
  fundedPrior,
  mark,
  windowWith,
} from './fixtures-in-code.js';
import { reU } from './rule-coverage.js';

const WIN_DAY = {
  tradingDay: day('2026-11-03'),
  openingBalanceCents: 5_000_000n,
  // 20,000c, comfortably over CORE-50K's 15,000c win-day floor, so the win day
  // turns on the calendar flag and not on the boundary R-09 already owns.
  realizedPnlCents: 20_000n,
  fillCount: 2,
} as const;

function foldOn(calendar: typeof CME_WINDOW, prior: RuleState = fundedPrior(CORE_50K)): DayOutput {
  return advanceDay({
    engineVersion: ENGINE_VERSION,
    plan: CORE_50K,
    prior,
    mark: mark(WIN_DAY),
    calendar,
    settlements: [],
    openedOn: ACCOUNT_OPENED_ON,
  });
}

// -----------------------------------------------------------------------------
// R-01  a fill belongs to the session containing it, and the engine sees no fill
// -----------------------------------------------------------------------------
test(reU('R-01'), () => {
  // "Session containment lookup. NEVER A UTC DATE CAST." The engine cannot
  // perform either one, and this test is the assertion that it cannot rather
  // than the assertion that it does not.
  //
  // THE BOUNDARY R-01 IS ABOUT IS 17:00 CT, where one session closes and the
  // next opens on the PRIOR calendar date, so a fill at 17:00:01 CT on a Monday
  // belongs to Tuesday's trading day and a UTC date cast puts it on Monday. That
  // boundary is unreachable from here, and the reason it is unreachable is the
  // assertion: no value the fold reads carries an instant for a cast to be
  // applied to.
  // THE ASSERTION IS COMPILE-TIME FIRST AND RUNTIME SECOND, and the order
  // matters. `Object.keys` sees what the FIXTURE constructed, so a field added
  // to `DailyMark` and left unset by `mark()` would slip straight past it; the
  // record below is over `keyof DailyMark`, so adding one is a missing-property
  // error and removing one is an excess-property error. That is
  // `PlanConfigVersionIsClosed`'s idiom, one directory over, and it is what makes
  // this rule's mutant a real gate rather than a fixture edit.
  const DAILY_MARK_FIELDS: Record<keyof DailyMark, true> = {
    tradingDay: true,
    openingBalanceCents: true,
    closingBalanceCents: true,
    highBalanceCents: true,
    lowBalanceCents: true,
    realizedPnlCents: true,
    adjustmentCents: true,
    fillCount: true,
    sourceHash: true,
  };
  const sample = mark(WIN_DAY);
  expect(Object.keys(sample).sort()).toEqual(Object.keys(DAILY_MARK_FIELDS).sort());

  // NONE OF THE NINE IS AN INSTANT, which is the sentence the record above makes
  // checkable. Eight are the day's arithmetic and the ninth is a source hash.
  expect(Object.keys(DAILY_MARK_FIELDS)).toHaveLength(9);

  // THE MARK CARRIES A COUNT OF FILLS AND NOT ONE FILL. R-08 is `fill_count > 0`
  // and that is the whole of what the engine knows about them, so the assignment
  // of a fill to a day happened before the fold and cannot be revisited by it.
  expect(typeof sample.fillCount).toBe('number');

  // AND THE DAY IT IS ASSIGNED TO IS AN OPAQUE KEY, NOT A DATE. `TradingDay` is a
  // branded string and every comparison in the engine is lexicographic on it, so
  // there is no `Date` for a timezone to be applied to. `mark.tradingDay` is
  // matched against the calendar's own key and never parsed.
  expect(typeof sample.tradingDay).toBe('string');
  const found = CME_WINDOW.index[sample.tradingDay];
  expect(found).toBe(1);

  // The other side of R-01's boundary, as far as this package can state it: the
  // day a mark names is a lookup into the calendar and NOT a derivation from it.
  // A day the calendar does not hold is refused rather than rounded to one it
  // does, which is RE-U-002's subject and is the reason a wrong containment
  // decision upstream cannot be silently absorbed here.
  expect(CME_WINDOW.index['2026-11-07']).toBeUndefined();
});

// -----------------------------------------------------------------------------
// R-02  counters advance only on trading days, and gaps are sequence subtraction
// -----------------------------------------------------------------------------
test(reU('R-02'), () => {
  // FIRST HALF, BOTH SIDES: a day inside coverage that is a session folds, and a
  // day inside coverage that is NOT a session refuses and advances nothing.
  // `GAPPED_SLICE` covers `2026-11-02..2026-11-06` and holds three of those five
  // days, so both sides are reachable against one slice and the only thing that
  // differs between them is whether the day is a session.
  const prior = fundedPrior(CORE_50K, { tradingDay: day('2026-11-02') });

  const onASession = advanceDay({
    engineVersion: ENGINE_VERSION,
    plan: CORE_50K,
    prior,
    mark: mark({ ...WIN_DAY, tradingDay: day('2026-11-04') }),
    calendar: GAPPED_SLICE,
    settlements: [],
    openedOn: ACCOUNT_OPENED_ON,
  });
  expect(onASession.assertions).toEqual([]);
  expect(onASession.state.tradedDaysCount).toBe(2);

  const onANonSession = advanceDay({
    engineVersion: ENGINE_VERSION,
    plan: CORE_50K,
    prior,
    mark: mark({ ...WIN_DAY, tradingDay: day('2026-11-03') }),
    calendar: GAPPED_SLICE,
    settlements: [],
    openedOn: ACCOUNT_OPENED_ON,
  });
  expect(onANonSession.assertions.map((a) => a.kind)).toEqual(['day_not_a_session']);
  // NO COUNTER MOVED, which is the half of "counters advance only on trading
  // days" that a refusal kind alone does not state. The carried state is the one
  // the fold arrived with.
  expect(onANonSession.state).toEqual(prior);
  expect(onANonSession.events).toEqual([]);

  // SECOND HALF: "gap counting is `calendar.sequence` subtraction, NEVER DATE
  // ARITHMETIC", and this is the pair that tells the two apart. The same two
  // endpoints, four calendar days apart in both slices, answer differently
  // because the slices number them differently. An engine reaching for a date
  // difference returns 4 on both lines.
  expect(tradingDaysBetween(CME_WINDOW, day('2026-11-02'), day('2026-11-06'))).toEqual({
    found: true,
    tradingDays: 4,
  });
  expect(tradingDaysBetween(GAPPED_SLICE, day('2026-11-02'), day('2026-11-06'))).toEqual({
    found: true,
    tradingDays: 2,
  });

  // THIRD HALF, AND IT IS THE ONE THE RULE STATES SECOND: counters advance
  // "WHETHER OR NOT THE TRADER TRADED". A zero-fill day is a trading day that
  // elapsed, so the gap between two endpoints is a property of the calendar and
  // not of the account, and R-08's traded-day counter is a different quantity
  // that does NOT advance on it. Both are asserted on one fold so neither can be
  // satisfied by the other.
  const idle = advanceDay({
    engineVersion: ENGINE_VERSION,
    plan: CORE_50K,
    prior,
    mark: mark({
      tradingDay: day('2026-11-04'),
      openingBalanceCents: 5_000_000n,
      realizedPnlCents: 0n,
      fillCount: 0,
    }),
    calendar: GAPPED_SLICE,
    settlements: [],
    openedOn: ACCOUNT_OPENED_ON,
  });
  expect(idle.assertions).toEqual([]);
  // The day closed and the state row exists: the trading day elapsed.
  expect(idle.state.tradingDay).toBe('2026-11-04');
  expect(idle.events.map((e) => e.type)).toContain('day.closed');
  // And R-08's counter did not move, because no fill did.
  expect(idle.state.tradedDaysCount).toBe(prior.tradedDaysCount);
  // The gap the calendar counts is unchanged by any of that: it is the same 1
  // whether the trader traded on `2026-11-04` or not.
  expect(tradingDaysBetween(GAPPED_SLICE, day('2026-11-02'), day('2026-11-04'))).toEqual({
    found: true,
    tradingDays: 1,
  });
});

// -----------------------------------------------------------------------------
// R-03  a half day is a full trading day for every counter
// -----------------------------------------------------------------------------
test(reU('R-03'), () => {
  // "No effect on any comparison." So the assertion is an EQUALITY between two
  // folds rather than a value: the same mark on a half day and on a full day
  // must produce the same state in every field, which is stronger than checking
  // the two counters someone thought to check.
  const full = foldOn(CME_WINDOW);
  const half = foldOn(windowWith(day('2026-11-03'), { isHalfDay: true }));

  expect(half.state).toEqual(full.state);
  expect(half.state.tradedDaysCount).toBe(2);
  expect(half.state.winDaysCount).toBe(1);
});

// -----------------------------------------------------------------------------
// R-04  on a halted session the day counters advance and win days do not
// -----------------------------------------------------------------------------
test(reU('R-04'), () => {
  const open = foldOn(CME_WINDOW);
  const halted = foldOn(windowWith(day('2026-11-03'), { halted: true }));

  // THE TRADED-DAY COUNTER ADVANCES EITHER WAY. R-02: counters advance whether
  // or not the trader traded, and a halt is not a non-day.
  expect(open.state.tradedDaysCount).toBe(2);
  expect(halted.state.tradedDaysCount).toBe(2);

  // THE WIN DAY DOES NOT. `winDaysCount += (win_day && !halted) ? 1 : 0`, on a
  // mark whose P&L clears the floor by 5,000c, so only the halt suppresses it.
  expect(open.state.winDaysCount).toBe(1);
  expect(halted.state.winDaysCount).toBe(0);

  // And nothing else moves: the floor still trails the close on a halted day.
  expect(halted.state.floorCents).toBe(open.state.floorCents);
});

// -----------------------------------------------------------------------------
// R-05  session bounds are stored UTC instants, and the engine holds neither
// -----------------------------------------------------------------------------
test(reU('R-05'), () => {
  // "DST is data. NO ARITHMETIC ANYWHERE CONVERTS A TIMEZONE." The two columns
  // that carry the instants are `trading_calendar.session_open_at` and
  // `session_close_at`, whose own data-model row says they are "UTC instants
  // derived from CT session definitions, so DST is a row rather than a
  // calculation". `CalendarDay` is the engine's view of that table and it holds
  // NEITHER COLUMN, which is what makes the conversion unwritable here rather
  // than merely unwritten.
  // COMPILE-TIME FIRST, for RE-U-001's reason: a `session_open_at` added to
  // `CalendarDay` is the exact change that would make R-05 an engine rule, and a
  // runtime key check over a fixture would not see it arrive.
  const CALENDAR_DAY_FIELDS: Record<keyof CalendarDay, true> = {
    tradingDay: true,
    isHalfDay: true,
    halted: true,
    sequence: true,
  };
  const sample = CME_WINDOW.days[0];
  expect(sample).toBeDefined();
  expect(Object.keys(sample ?? {}).sort()).toEqual(Object.keys(CALENDAR_DAY_FIELDS).sort());
  expect(Object.keys(CALENDAR_DAY_FIELDS)).toHaveLength(4);

  // THE BOUNDARY R-05 IS ABOUT IS THE DST TRANSITION, where the CT wall clock
  // holds still and the UTC instant moves by an hour. Both sides of it are
  // stated in the same place and neither is reachable from a `CalendarDay`: what
  // the engine has instead is `sequence`, a dense integer that is unaffected by
  // any of it. A slice spanning a transition and a slice spanning none are the
  // same object to every rule in this package.
  expect(typeof sample?.sequence).toBe('number');
  for (const d of CME_WINDOW.days) expect(Number.isInteger(d.sequence)).toBe(true);

  // AND THE PACKAGE HAS NO CLOCK TO CONVERT AGAINST EITHER, which is the reason
  // this is an absence rather than a gap. `merit/engine-purity` bans every clock
  // spelling and the package compiles with `types: []`, so `Date` is not a name
  // `src/` can resolve; the calendar arrives as data through `DayInput` and
  // `CalendarSliceIsData` is what stops it arriving as a capability instead.
  expect(Object.values(CME_WINDOW.coverage).every((v) => typeof v === 'string')).toBe(true);
});

// -----------------------------------------------------------------------------
// R-06  every evaluation is against the last closed day and nothing more recent
// -----------------------------------------------------------------------------
test(reU('R-06'), () => {
  // THE OPERATOR IS DO-1's `mark.tradingDay > prior.tradingDay` AND THIS IS ITS
  // BOUNDARY ON BOTH SIDES. Strictly after folds; exactly equal refuses, which is
  // INV-14's idempotence; before refuses, which is an out-of-order feed. The
  // three share one prior so the only thing that varies is the mark's day.
  const prior = fundedPrior(CORE_50K, { tradingDay: day('2026-11-03') });
  const fold = (tradingDay: string): DayOutput =>
    advanceDay({
      engineVersion: ENGINE_VERSION,
      plan: CORE_50K,
      prior,
      mark: mark({ ...WIN_DAY, tradingDay: day(tradingDay) }),
      calendar: CME_WINDOW,
      settlements: [],
      openedOn: ACCOUNT_OPENED_ON,
    });

  const forward = fold('2026-11-04');
  expect(forward.assertions).toEqual([]);
  expect(forward.state.tradingDay).toBe('2026-11-04');

  // EXACTLY AT THE BOUNDARY, WHICH IS THE SIDE A `>=` WOULD LET THROUGH. Re-
  // applying the day the state already carries is the replay case, and folding it
  // would double every counter it advanced.
  const same = fold('2026-11-03');
  expect(same.assertions.map((a) => a.kind)).toEqual(['not_forward']);
  expect(same.state).toEqual(prior);

  const backwards = fold('2026-11-02');
  expect(backwards.assertions.map((a) => a.kind)).toEqual(['not_forward']);
  expect(backwards.state).toEqual(prior);

  // "THE ENGINE ONLY EVER SEES CLOSED DAYS", and the structural half of that is
  // that there is no other kind of day for it to see. `DailyMark` is a closed
  // day's record: it carries a closing balance, a high and a low, all of which
  // are only final at the close, and it carries nothing that could describe a day
  // in progress. An intraday evaluation is not forbidden here, it is
  // unrepresentable, which is ADR-002's EOD semantics made structural.
  const sample = mark(WIN_DAY);
  expect(sample.closingBalanceCents).toBe(sample.openingBalanceCents + sample.realizedPnlCents);
  expect(Object.keys(sample)).toContain('closingBalanceCents');
});
