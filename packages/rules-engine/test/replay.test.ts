// =============================================================================
// packages/rules-engine/test/replay.test.ts
// =============================================================================
// ADR-078. M01 section 3.7's fold, and the four places its pseudocode had to be
// reconciled against the types that exist today. Each reconciliation gets an
// assertion here, because a reconciliation nobody executed is a claim.
// =============================================================================

import { expect, test } from 'vitest';

import { advanceDay } from '../src/day/advance.js';
import { ReplayAssertionError, replay } from '../src/replay.js';
import type { DailyMark } from '../src/types.js';
import {
  ACCOUNT_OPENED_ON,
  CME_WINDOW,
  CORE_50K,
  ENGINE_VERSION,
  day,
  mark,
} from './fixtures-in-code.js';

/**
 * A contiguous life over the calendar window: every opening balance is the prior
 * closing, which is INV-18 and is what `replay` refuses to fold without.
 */
function chain(pnl: readonly bigint[]): DailyMark[] {
  const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];
  const out: DailyMark[] = [];
  let opening = CORE_50K.sizeCents;
  for (let i = 0; i < pnl.length; i += 1) {
    const iso = days[i];
    const realized = pnl[i];
    if (iso === undefined || realized === undefined) break;
    const m = mark({
      tradingDay: day(iso),
      openingBalanceCents: opening,
      realizedPnlCents: realized,
    });
    out.push(m);
    opening = m.closingBalanceCents;
  }
  return out;
}

const FLAT = chain([10_000n, 10_000n, 10_000n, 10_000n, 10_000n]);

const fold = (marks: readonly DailyMark[]) =>
  replay(CORE_50K, marks, [], CME_WINDOW, ENGINE_VERSION, ACCOUNT_OPENED_ON);

test('3.7  one state per day folded, in trading-day order', () => {
  const states = fold(FLAT);

  expect(states).toHaveLength(FLAT.length);
  expect(states.map((s) => s.tradingDay)).toEqual([
    '2026-11-02',
    '2026-11-03',
    '2026-11-04',
    '2026-11-05',
    '2026-11-06',
  ]);
});

test('3.7  the sort is a TOTAL ORDER, so arrival order cannot change the fold', () => {
  // The unit-level half of PT-06. The property over a real account life lives in
  // `scripts/demo/test/replay-determinism.property.test.ts`; this is the case
  // that fails fastest when the comparator regresses.
  const reversed = [...FLAT].reverse();
  expect(reversed[0]).not.toBe(FLAT[0]);

  expect(fold(reversed)).toEqual(fold(FLAT));
});

test('3.7  a refused day throws ReplayAssertionError naming the day and the findings', () => {
  // The chain is broken on the third day: its opening balance is not the prior
  // closing, which is INV-18's `opening_mismatch`. `advanceDay` REFUSES it
  // through the assertion channel; `replay` escalates, because no state is
  // written for a refused day and a RuleState[] that silently skipped one is
  // indistinguishable from a complete history.
  const broken = [...FLAT];
  const third = broken[2];
  if (third === undefined) throw new Error('fixture too short');
  broken[2] = { ...third, openingBalanceCents: third.openingBalanceCents + 999_999n };

  expect(() => fold(broken)).toThrow(ReplayAssertionError);

  try {
    fold(broken);
    throw new Error('replay accepted a broken chain');
  } catch (e) {
    if (!(e instanceof ReplayAssertionError)) throw e;
    expect(e.tradingDay).toBe('2026-11-04');
    expect(e.assertions.length).toBeGreaterThan(0);
    // NOT an EngineInvariantError: `errors.ts` reserves that class for the
    // engine's own arithmetic failing, and a refused day is bad input.
    expect(e.name).toBe('ReplayAssertionError');
  }
});

test('reconciliation 1  `openedOn` is passed through and nothing is defaulted', () => {
  // 3.7's signature has no `openedOn`; ADR-051 made it required on `DayInput`
  // after M01 was written. This asserts `replay` hands the caller's value
  // straight to `advanceDay` rather than inventing one from the first mark.
  const first = FLAT[0];
  if (first === undefined) throw new Error('fixture too short');

  const viaReplay = fold([first]);
  const viaDay = advanceDay({
    engineVersion: ENGINE_VERSION,
    plan: CORE_50K,
    prior: null,
    mark: first,
    calendar: CME_WINDOW,
    settlements: [],
    openedOn: ACCOUNT_OPENED_ON,
  });

  expect(viaReplay).toEqual([viaDay.state]);
});

test('reconciliation 2  the whole CalendarSlice is passed, because it has no `get`', () => {
  // `CalendarSliceIsData` in types.ts asserts at compile time that no property of
  // a slice is function-valued, so 3.7's `calendar.get(mark.tradingDay)` is
  // impossible rather than merely awkward. The observable consequence is that a
  // multi-day fold works at all: R-37 counts a cadence gap by sequence
  // subtraction from an anchor outside any single day.
  expect(Object.values(CME_WINDOW).every((v) => typeof v !== 'function')).toBe(true);
  expect(fold(FLAT)).toHaveLength(5);
});
