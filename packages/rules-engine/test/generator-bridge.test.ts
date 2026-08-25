// =============================================================================
// packages/rules-engine/test/generator-bridge.test.ts
// =============================================================================
// THE COLLAPSE'S TEST COUNTS ARE THE WEAK CHECK AND THIS FILE IS THE STRONG ONE.
//
// Session 74 merged four copies of `materializedFrom`, `toEngineMark` and
// `sliceOf` into `generator-bridge.ts`. The obvious proof that it changed
// nothing is that `pnpm vitest run` reports the same numbers before and after,
// and that proof is worth less than it looks.
//
// A `fast-check` property reports as ONE test no matter how many cases it ran.
// If this collapse had quietly degraded an adapter -- a projection that emitted
// one degenerate plan for every input, a `sliceOf` that returned a single day
// whatever the sequence -- every property downstream would still have folded
// SOMETHING, still have passed, and still have counted one. `60 files, 908
// passed` survives exactly the failure the collapse is at risk of.
//
// So the adapters are asserted to still VARY. Each of the three is sampled and
// checked to produce more than one distinct output, and `sliceOf` is checked to
// span more than one day, because a bridge that has stopped generating makes six
// properties vacuous at once and reports green while it does.
//
// This is PR #90's reachability idiom applied to a refactor rather than to a
// sweep: a run that cannot show its own inputs were non-degenerate has not shown
// anything. It asserts NO RULE, and it is deliberately not a `.property.test.ts`
// for that reason: nothing here is an `RE-P-nn` and nothing here belongs to
// CI-02's property stage.
// =============================================================================

import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import type { ResolvedPlan } from '../src/index.ts';
import { CORE_50K, MERIT_RAPID_50K, withStaticDrawdown } from './fixtures-in-code.ts';
import { materializedFrom, sliceOf, toEngineMark } from './generator-bridge.ts';
import { daySequenceArbitrary } from './generators/day-sequence.ts';

/** `JSON.stringify` throws on `bigint`, and `toEngineMark`'s output is six of them. */
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? `${x}n` : x));

/** Fixed seed: this file is a non-vacuity check and a flaky one would be worthless. */
const SAMPLE = { numRuns: 40, seed: 74 } as const;

const LINEUP: ReadonlyArray<readonly [string, ResolvedPlan]> = [
  ['CORE-50K', CORE_50K],
  ['MERIT-RAPID-50K', MERIT_RAPID_50K],
  ['CORE-50K, funded static drawdown', withStaticDrawdown(CORE_50K)],
];

const sequences = fc.sample(daySequenceArbitrary({ plan: materializedFrom(CORE_50K) }), SAMPLE);

describe('generator-bridge: the collapsed adapters still generate', () => {
  test('`materializedFrom` distinguishes every plan in the lineup', () => {
    const projected = new Set(LINEUP.map(([, plan]) => stable(materializedFrom(plan))));
    // Three plans in, three distinct records out. A projection that had collapsed
    // to a constant would pass every downstream fold and pin no plan.
    expect(projected.size).toBe(LINEUP.length);
  });

  test('`materializedFrom` carries the two fields `chainMarks` actually reads', () => {
    for (const [name, plan] of LINEUP) {
      const m = materializedFrom(plan);
      // INV-20's first-day opening balance and R-09's `win_day` column. These two
      // are the whole reason the projection exists; a drift in either is a fold
      // that refuses in the middle for no stated reason.
      expect(`${name}: ${String(m.size_cents)}`).toBe(`${name}: ${String(plan.sizeCents)}`);
      expect(m.phase_funded.win_days.win_day_floor_cents).toBe(
        Number(plan.funded.winDayFloorCents),
      );
    }
  });

  test('`materializedFrom` refuses a plan with no evaluation phase rather than inventing one', () => {
    // M01 Appendix A.3's Direct. No property folds it, and a projection that
    // silently synthesised an eval block would hide that rather than report it.
    expect(() => materializedFrom({ ...CORE_50K, eval: null })).toThrow(/evaluation phase/);
  });

  test('`toEngineMark` produces more than one distinct mark across a sample', () => {
    const marks = sequences.flatMap((seq) => seq.marks.map((m) => stable(toEngineMark(m))));
    expect(marks.length).toBeGreaterThan(1);
    expect(new Set(marks).size).toBeGreaterThan(1);
  });

  test('`toEngineMark` returns `bigint` on all six money fields, and not all zero', () => {
    const converted = sequences.flatMap((seq) => seq.marks.map(toEngineMark));
    expect(converted.length).toBeGreaterThan(0);
    for (const m of converted) {
      for (const field of [
        m.openingBalanceCents,
        m.closingBalanceCents,
        m.highBalanceCents,
        m.lowBalanceCents,
        m.realizedPnlCents,
        m.adjustmentCents,
      ]) {
        expect(typeof field).toBe('bigint');
      }
    }
    // INV-02 is `bigint`, and a converter that answered `0n` to everything would
    // satisfy the type check above while destroying every balance in the fold.
    expect(new Set(converted.map((m) => `${m.closingBalanceCents}`)).size).toBeGreaterThan(1);
  });

  test('`sliceOf` spans more than one day and produces more than one distinct slice', () => {
    const slices = sequences.map(sliceOf);
    expect(slices.length).toBeGreaterThan(1);
    // ADR-049 makes a lookup past coverage a typed refusal, so a slice that had
    // shrunk to one day would refuse every fold past day one rather than answer
    // wrongly. Every property would then stop early and still report green.
    expect(slices.some((s) => s.days.length > 1)).toBe(true);
    expect(new Set(slices.map((s) => stable(s.days))).size).toBeGreaterThan(1);
  });

  test('`sliceOf` indexes every day it carries', () => {
    for (const slice of sequences.map(sliceOf)) {
      expect(Object.keys(slice.index)).toHaveLength(slice.days.length);
      for (const d of slice.days) {
        // `index` is a plain `Record<string, number>`, so a lookup is
        // `number | undefined` under `noUncheckedIndexedAccess`. The absence is
        // asserted rather than coalesced away: a slice carrying a day its index
        // does not know about is the defect this test is about.
        const at = slice.index[d.tradingDay];
        expect(at).toBeTypeOf('number');
        expect(slice.days[at ?? -1]?.tradingDay).toBe(d.tradingDay);
      }
    }
  });
});
