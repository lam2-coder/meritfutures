// =============================================================================
// GROUP A: TIME AND CALENDAR. RE-U-003 and RE-U-004, and no others.
// =============================================================================
// FOUR OF GROUP A'S SIX RULES ARE NOT HERE and the reason is one sentence from
// P2 section 6: "There is not one calendar row in the repository, and the
// transcription is blocked on the founder." R-01 and R-05 are session
// containment over stored UTC instants, R-02's gap counting is `sequence`
// subtraction across a range, and R-06 is a property of the caller. All four
// need the real calendar, and writing them against a five-session hand-built
// window would be transcription from recollection.
//
// The two that are here need only the flags on the day itself, which the fixture
// calendar already carries.
// =============================================================================

import { expect, test } from 'vitest';

import { advanceDay } from '../src/day/advance.js';
import type { DayOutput, RuleState } from '../src/types.js';
import {
  CME_WINDOW,
  CORE_50K,
  ENGINE_VERSION,
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
  });
}

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
