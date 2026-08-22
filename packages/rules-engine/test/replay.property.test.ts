// =============================================================================
// packages/rules-engine/test/replay.property.test.ts
// =============================================================================
// ADR-078. Two properties of M01 section 3.7's fold that a worked example cannot
// state: the fold does not depend on arrival order, and it stops at a terminal
// phase rather than folding past one.
// =============================================================================

import fc from 'fast-check';
import { expect, test } from 'vitest';

import { advanceDay } from '../src/day/advance.js';
import { replay } from '../src/replay.js';
import type { DailyMark } from '../src/types.js';
import {
  ACCOUNT_OPENED_ON,
  CME_WINDOW,
  CORE_50K,
  ENGINE_VERSION,
  day,
  mark,
} from './fixtures-in-code.js';

const DAYS = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'] as const;

/** A contiguous life: every opening balance is the prior closing (INV-18). */
function chain(pnl: readonly bigint[]): DailyMark[] {
  const out: DailyMark[] = [];
  let opening = CORE_50K.sizeCents;
  for (let i = 0; i < pnl.length && i < DAYS.length; i += 1) {
    const iso = DAYS[i];
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

const fold = (marks: readonly DailyMark[]) =>
  replay(CORE_50K, marks, [], CME_WINDOW, ENGINE_VERSION, ACCOUNT_OPENED_ON);

/** Money is `bigint`; `JSON.stringify` refuses one, and `Number` would lose it. */
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? `${x.toString()}n` : x));

test('PT-06 unit  any permutation of arrival order yields byte-identical states', () => {
  fc.assert(
    fc.property(
      // Gains and losses small enough that the life stays non-terminal, so the
      // property is about ORDER rather than about where the break landed.
      fc.array(fc.bigInt({ min: -20_000n, max: 20_000n }), { minLength: 3, maxLength: 5 }),
      (pnl) => {
        const marks = chain(pnl);
        fc.pre(marks.length >= 3);

        const baseline = canonical(fold(marks));

        return fc.assert(
          fc.property(
            fc.shuffledSubarray(marks, { minLength: marks.length, maxLength: marks.length }),
            (arrived: readonly DailyMark[]) => {
              expect(canonical(fold(arrived))).toBe(baseline);
            },
          ),
          { numRuns: 10 },
        );
      },
    ),
    { numRuns: 25 },
  );
});

test('3.7  the fold BREAKS at a terminal phase and never folds past one', () => {
  // A loss large enough to breach on the second day. What is asserted is not the
  // breach, which is group D's subject, but that `replay` STOPS: the break at
  // `closed` or `graduated` is 3.7's and it is not an optimisation, because
  // `advanceDay` refuses every day after a terminal phase and continuing would
  // turn a finished life into a replay that throws.
  const breaching = chain([-4_900_000n, 10_000n, 10_000n, 10_000n, 10_000n]);
  const states = fold(breaching);

  const terminal = states.at(-1);
  expect(terminal).toBeDefined();
  expect(['closed', 'graduated']).toContain(terminal?.phase);

  // The break is what keeps this SHORTER than the input, and the alternative is
  // not a longer array: it is a ReplayAssertionError from the first day folded
  // past the terminal one.
  expect(states.length).toBeLessThan(breaching.length);
  expect(states.filter((s) => s.phase === 'closed' || s.phase === 'graduated')).toHaveLength(1);
});

test('3.7  folding past a terminal phase is what the break PREVENTS', () => {
  // THE COUNTERFACTUAL FOR THE BREAK, and the first attempt at it was wrong in a
  // way worth recording: appending the marks again does NOT reach past the
  // terminal day, because the sort puts the duplicates back in day order and the
  // break fires before them. That is the break working, not the counterfactual.
  //
  // What shows the break earning its place is folding the day AFTER the terminal
  // one against the terminal state, which is exactly what `replay` would do next
  // if it did not break. `advanceDay` refuses it, so a break-less replay would
  // throw ReplayAssertionError on a life that ended correctly.
  const breaching = chain([-4_900_000n, 10_000n, 10_000n]);
  const states = fold(breaching);
  const terminal = states.at(-1);
  const nextMark = breaching[states.length];
  expect(terminal).toBeDefined();
  expect(nextMark).toBeDefined();
  if (terminal === undefined || nextMark === undefined) return;

  const past = advanceDay({
    engineVersion: ENGINE_VERSION,
    plan: CORE_50K,
    prior: terminal,
    mark: nextMark,
    calendar: CME_WINDOW,
    settlements: [],
    openedOn: ACCOUNT_OPENED_ON,
  });

  expect(past.assertions.length).toBeGreaterThan(0);
  expect(past.state).toEqual(terminal);
});
