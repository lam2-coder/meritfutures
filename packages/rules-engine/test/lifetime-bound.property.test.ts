// =============================================================================
// packages/rules-engine/test/lifetime-bound.property.test.ts
// =============================================================================
// PT-08, STRATEGY section 3.1, in the row's own words:
//
//   The lifetime bound. No sequence of settlements on one account exceeds
//   `max_payouts * max(payout_cap_schedule)`
//
// It is M01's INV-17, "lifetime settled extraction per account <= ladder_count *
// max cap in the schedule", and the row names what it rests on: since ADR-025
// the schedule has ONE STEP, so the bound is `max_payouts * cap`, and GS-243
// asserts the same number regardless of loyalty state.
//
// This is the liability bound the plan lineup rests on. M01 section 8: "a
// per-day rate that terminates is a different object from one that does not, and
// the lifetime figure is the one that belongs in a liability conversation"
// (AS-03). ADR-024 shortened the ladder from 8 to 5, which TIGHTENS this bound
// rather than loosening it.
//
// -----------------------------------------------------------------------------
// THE ORDINARY STREAM CANNOT TEST THIS AND THE OVER-LADDER STREAM IS THE POINT
// -----------------------------------------------------------------------------
// `settlement-sequence.ts` states the arithmetic itself: "Every settlement is
// clamped to its ordinal's cap by R-42 and the count is bounded by R-49, so
// while those two hold the lifetime bound holds ARITHMETICALLY. It is their
// conjunction over a life, not an independent constraint."
//
// So a generator that respects the ladder BY CONSTRUCTION satisfies INV-17
// before the engine is called at all, and a property folding only such streams
// is `expect(true).toBe(true)` with citations. What INV-17 is actually a bound
// against is a caller that keeps settling, and what enforces it is R-49: the
// ladder graduates the account and DO-2 returns, so no day after it folds.
//
// THIS FILE THEREFORE FOLDS A STREAM THE ORACLE REJECTS, DELIBERATELY. With
// `omit: {'INV-17/lifetime-bound'}` the generator emits `max_payouts + 1`
// settlements with every approval sitting AT ITS CAP, which
// `validate-settlement-sequence.ts` scores as a joint `R-49` and `INV-17`
// violation and which is exactly the adversarial stream the bound exists for.
// The assertion is not that the stream is legal. It is that the ENGINE'S OWN
// accumulated total still stops at the bound, because the ladder stops it.
//
// Both streams are folded, and the division is the whole design:
//
//   ORDINARY     catches an accumulation defect. R-50 adding twice, or a reset
//                of the counter, shows up here with no help from the ladder
//   OVER-LADDER  catches a LADDER defect. R-49's `>=` weakened to `>` lets one
//                more settlement land and the total goes one cap over the bound.
//                Nothing in the ordinary stream can see it
//
// -----------------------------------------------------------------------------
// THE BOUND IS REACHED, WHICH IS WHAT MAKES `<=` WORTH ASSERTING
// -----------------------------------------------------------------------------
// A `<=` that never approaches its limit is satisfied by any implementation that
// undercounts. The support block below counts the folds whose lifetime lands ON
// the bound to the cent, and requires that count to be positive. If the
// generator ever stops driving an account to graduation, this property goes red
// rather than passing quietly on a weaker population.
// =============================================================================

import fc from 'fast-check';
import { beforeAll, describe, expect, test } from 'vitest';

import { applySettlement, type Cents, type ResolvedPlan } from '../src/index.ts';
import { CORE_50K, MERIT_RAPID_50K } from './fixtures-in-code.ts';
import { materializedFrom } from './generator-bridge.ts';
import { foldSettlements, settlementFoldArbitrary } from './settlement-fold.ts';
import type { SsRuleId } from './generators/validate-settlement-sequence.ts';

const RUNS = 300;
// Larger than PT-02's, and for a reason that was measured rather than guessed:
// the case this property is about is a fold that survives `max_payouts`
// cap-sized withdrawals without breaching, which is the rarest thing either
// session needs.
const REACHABILITY = 3_000;

const LINEUP: ReadonlyArray<readonly [string, ResolvedPlan]> = [
  ['CORE-50K', CORE_50K],
  ['MERIT-RAPID-50K', MERIT_RAPID_50K],
];

const CASES = LINEUP.map(([name, plan]) => [name, plan] as const);

/**
 * The stream that emits `max_payouts + 1` settlements, every approval at its
 * ordinal's cap.
 *
 * `settlement-sequence.ts` documents both halves: "INV-17 must break both, so
 * every approval sits at its cap", and its `drawDays` filter requires a
 * single-step schedule for the inversion to mean what it says, which ADR-025
 * leaves v1's lineup with anyway.
 */
const OVER_LADDER: ReadonlySet<SsRuleId> = new Set<SsRuleId>(['INV-17/lifetime-bound']);

const STREAMS = [
  ['ordinary', undefined],
  ['over-ladder', OVER_LADDER],
] as const;

/** Every (plan, stream) pair, which is what each assertion below runs over. */
const MATRIX = CASES.flatMap(([name, plan]) =>
  STREAMS.map(([stream, omit]) => [`${name}, ${stream}`, plan, omit] as const),
);

const show = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? `${x}n` : x));

/**
 * INV-17's bound, computed FROM THE PLAN and never from a literal.
 *
 * `max(payout_cap_schedule)` is written as a fold over the schedule rather than
 * as `schedule[0]` even though ADR-025 leaves one step, because the bound INV-17
 * states is over the maximum and a schedule that regained a second step would
 * otherwise be bounded by whichever step happened to be first.
 */
const boundCents = (plan: ResolvedPlan): Cents => {
  const maxCap = plan.funded.payoutCapSchedule.reduce(
    (m, step) => (step.capCents > m ? step.capCents : m),
    0n as Cents,
  );
  return (BigInt(plan.funded.maxPayouts) * maxCap) as Cents;
};

// -----------------------------------------------------------------------------
// PT-08
// -----------------------------------------------------------------------------

describe('PT-08: no sequence of settlements exceeds max_payouts * max cap (INV-17)', () => {
  test('the bound is the plan lineup number M01 section 8 states', () => {
    // AS-03's figures, quoted so a plan edit that moved either one is a named
    // failure rather than a property quietly bounding a different account.
    // Core EOD: 5 payouts at 150,000c. Merit Rapid: 5 at 100,000c.
    expect(boundCents(CORE_50K), 'CORE-50K: 5 * 150,000c').toBe(750_000n);
    expect(boundCents(MERIT_RAPID_50K), 'MERIT-RAPID-50K: 5 * 100,000c').toBe(500_000n);
  });

  test("the projection carries the fold's own plan", () => {
    for (const [name, plan] of CASES) {
      const materialized = materializedFrom(plan);
      expect(BigInt(materialized.size_cents), `${name}: size_cents`).toBe(plan.sizeCents);
      expect(materialized.phase_funded.max_payouts, `${name}: max_payouts`).toBe(
        plan.funded.maxPayouts,
      );
    }
  });

  test.each(MATRIX)(
    'PT-08, %s: the lifetime never exceeds the bound, at any point in any life',
    (name: string, plan: ResolvedPlan, omit: ReadonlySet<SsRuleId> | undefined) => {
      const bound = boundCents(plan);

      fc.assert(
        fc.property(settlementFoldArbitrary(plan, { omit }), (seq) => {
          for (const step of foldSettlements(plan, seq).steps) {
            expect(
              step.lifetimeSettledCents <= bound,
              `${name}: lifetime settled reached ${String(step.lifetimeSettledCents)} on ` +
                `${step.tradingDay} against INV-17's bound of ${String(bound)} ` +
                `(${String(plan.funded.maxPayouts)} * the schedule's largest cap): ` +
                show(step),
            ).toBe(true);
          }
        }),
        { numRuns: RUNS },
      );
    },
  );

  test.each(MATRIX)(
    'PT-08, %s: R-49 holds the count at the ladder, which is half the conjunction',
    (name: string, plan: ResolvedPlan, omit: ReadonlySet<SsRuleId> | undefined) => {
      // The bound is `R-42`'s per-ordinal cap conjoined with `R-49`'s count over
      // a life. Asserting only the product would let a defect in one be masked
      // by slack in the other: an account that settled six times at half the cap
      // sits under the bound and has still broken the ladder.
      fc.assert(
        fc.property(settlementFoldArbitrary(plan, { omit }), (seq) => {
          for (const step of foldSettlements(plan, seq).steps) {
            expect(
              step.payoutsSettledCount <= plan.funded.maxPayouts,
              `${name}: ${String(step.payoutsSettledCount)} settled payouts on ` +
                `${step.tradingDay} against R-49's ladder of ` +
                `${String(plan.funded.maxPayouts)}: ${show(step)}`,
            ).toBe(true);
          }
        }),
        { numRuns: RUNS },
      );
    },
  );

  test.each(MATRIX)(
    'PT-08, %s: R-50 moves the lifetime by EXACTLY the approved amount',
    (name: string, plan: ResolvedPlan, omit: ReadonlySet<SsRuleId> | undefined) => {
      // R-50 is `lifetimeSettledCents += approvedCents`, asserted at the function
      // rather than only in aggregate. A double-count inside `applySettlement`
      // is invisible to the `<=` above on any life that stayed short of the
      // bound, and the aggregate is where it would be found last.
      fc.assert(
        fc.property(settlementFoldArbitrary(plan, { omit }), (seq) => {
          const fold = foldSettlements(plan, seq);
          for (const step of fold.steps) {
            if (step.applied.length === 0) continue;
            let state = step.stateBefore;
            for (const fact of step.applied) {
              const before = state.lifetimeSettledCents;
              const out = applySettlement(state, plan, fact, fold.calendar);
              expect(
                out.assertions,
                `${name}: DO-2 applied ${fact.payoutRequestId} and a direct re-run refused ` +
                  `it: ${show(out.assertions)}`,
              ).toHaveLength(0);
              expect(
                out.state.lifetimeSettledCents,
                `${name}: R-50 moves the lifetime by exactly the approved amount, and ` +
                  `${fact.payoutRequestId} moved it from ${String(before)} to ` +
                  `${String(out.state.lifetimeSettledCents)} on an approval of ` +
                  `${String(fact.approvedCents)}`,
              ).toBe(before + fact.approvedCents);
              expect(
                out.state.payoutsSettledCount,
                `${name}: R-50's count moves by exactly one per settlement`,
              ).toBe(state.payoutsSettledCount + 1);
              state = out.state;
            }
          }
        }),
        { numRuns: RUNS },
      );
    },
  );
});

// -----------------------------------------------------------------------------
// GS-243, and why it is asserted structurally
// -----------------------------------------------------------------------------

describe('GS-243: the bound is the same number whatever the loyalty state', () => {
  // ADR-025 rejected progressive cap release for v1 and replaced it with
  // CROSS-ACCOUNT LOYALTY, and INV-M14-11 states the outcome directly: no
  // loyalty mechanic moves a per-account bound. GS-243's own row: cross-account
  // loyalty "changes the price of the next purchase and the order of a
  // discretionary queue, and CHANGES NO NUMBER THE ENGINE READS."
  //
  // THE INVARIANCE IS STRUCTURAL, WHICH IS STRONGER THAN A FIXTURE AND IS ALSO
  // WHY IT CANNOT BE WRITTEN AS ONE HERE. A fixture computes the bound for a
  // first-time buyer and for a tenth-ladder identity and requires them equal to
  // the cent; that needs two identities, and an identity is M14's object, not
  // the engine's. Inside this package there is no loyalty input to vary, and the
  // absence IS the assertion: what is checked is that no such input has
  // appeared, on the plan the bound is computed from and on the state the fold
  // carries.
  //
  // A KEY SWEEP RATHER THAN A COMMENT, because the failure mode is a future
  // field, and a comment does not fire when one lands.
  const LOYALTY = /loyal|tier|cohort|discount|perk|streak|ladder_count|identity/i;

  const keysDeep = (value: unknown, prefix = ''): string[] => {
    if (value === null || typeof value !== 'object') return [];
    if (Array.isArray(value))
      return value.flatMap((v, i) => keysDeep(v, `${prefix}[${String(i)}]`));
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [
      `${prefix}${k}`,
      ...keysDeep(v, `${prefix}${k}.`),
    ]);
  };

  test.each(CASES)(
    'GS-243, %s: the plan the bound is computed from carries no loyalty dimension',
    (name: string, plan: ResolvedPlan) => {
      const offending = keysDeep(plan).filter((k) => LOYALTY.test(k));
      expect(
        offending,
        `${name}: ResolvedPlan gained ${show(offending)}. ADR-025 and INV-M14-11 say no ` +
          `loyalty mechanic moves a per-account bound, and a field the engine can read is a ` +
          `field a bound can depend on. GS-243 needs a real two-identity fixture from here on`,
      ).toEqual([]);
    },
  );

  test.each(CASES)(
    'GS-243, %s: the state the fold carries has no loyalty dimension either',
    (name: string, plan: ResolvedPlan) => {
      // The bound is a function of the plan; this is the other half, that the
      // per-account state carries nothing an identity's history could write into.
      const seq = fc.sample(settlementFoldArbitrary(plan), 1)[0]!;
      const steps = foldSettlements(plan, seq).steps;
      const last = steps[steps.length - 1];
      const state = last === undefined ? null : last.stateBefore;
      expect(state, `${name}: the fold produced no state to sweep`).not.toBeNull();
      const offending = keysDeep(state).filter((k) => LOYALTY.test(k));
      expect(offending, `${name}: RuleState gained ${show(offending)}`).toEqual([]);
    },
  );
});

// -----------------------------------------------------------------------------
// The support, measured rather than assumed
// -----------------------------------------------------------------------------
// EVERY COUNTER IS ASSERTED `> 0` AND NEVER AGAINST A BAND. The figures a
// sampling run produces are one run of a randomized generator; a band copied out
// of one is a hand-maintained count in a file whose purpose is to end
// hand-maintained counts, and it goes red on an unlucky seed for no defect. What
// is asserted is that the case is REACHED; what was observed is reported in the
// pull request body.

describe('the support reaches the cases PT-08 is about', () => {
  interface Seen {
    steps: number;
    settlementsApplied: number;
    graduations: number;
    foldsThatReachedTheBoundExactly: number;
    overLadderStreamsLongerThanTheLadder: number;
    stepsWithAPositiveLifetime: number;
  }

  const seen: Seen = {
    steps: 0,
    settlementsApplied: 0,
    graduations: 0,
    foldsThatReachedTheBoundExactly: 0,
    overLadderStreamsLongerThanTheLadder: 0,
    stepsWithAPositiveLifetime: 0,
  };

  // ONE SAMPLING PASS FEEDS EVERY ASSERTION BELOW, in `beforeAll` rather than at
  // module level: this pass FOLDS, R-14's DO-7 tripwire can throw inside it, and
  // at module level that throw lands during COLLECTION and vitest reports "0
  // test" for the whole file.
  beforeAll(() => {
    for (const [, plan] of CASES) {
      const bound = boundCents(plan);
      for (const [, omit] of STREAMS) {
        fc.assert(
          fc.property(settlementFoldArbitrary(plan, { omit }), (seq) => {
            if (omit !== undefined && seq.settlements.length > plan.funded.maxPayouts) {
              seen.overLadderStreamsLongerThanTheLadder++;
            }
            for (const step of foldSettlements(plan, seq).steps) {
              seen.steps++;
              seen.settlementsApplied += step.applied.length;
              if (step.graduated) seen.graduations++;
              if (step.lifetimeSettledCents > 0n) seen.stepsWithAPositiveLifetime++;
              if (step.lifetimeSettledCents === bound) seen.foldsThatReachedTheBoundExactly++;
            }
          }),
          { numRuns: REACHABILITY },
        );
      }
    }
  });

  test('the fold settles at all, so the bound is bounding something', () => {
    expect(seen.steps).toBeGreaterThan(0);
    expect(seen.settlementsApplied).toBeGreaterThan(0);
    expect(seen.stepsWithAPositiveLifetime).toBeGreaterThan(0);
  });

  test('the over-ladder stream really is over the ladder', () => {
    // The whole design rests on this input carrying MORE settlements than R-49
    // allows. If the generator's inversion ever stopped inverting, the property
    // would keep passing on a population that cannot test the ladder, which is
    // the vacuous pass this file exists to avoid.
    expect(seen.overLadderStreamsLongerThanTheLadder).toBeGreaterThan(0);
  });

  test('R-49 graduation is reached, which is what enforces the bound', () => {
    expect(seen.graduations).toBeGreaterThan(0);
  });

  test('the bound is reached EXACTLY, so `<=` is asserted at its limit', () => {
    // A `<=` that never approaches its limit is satisfied by any implementation
    // that undercounts. This is the counter that says an account was driven all
    // the way to `max_payouts` settlements at their caps and stopped there.
    expect(seen.foldsThatReachedTheBoundExactly).toBeGreaterThan(0);
  });
});
