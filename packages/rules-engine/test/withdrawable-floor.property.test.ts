// =============================================================================
// packages/rules-engine/test/withdrawable-floor.property.test.ts
// =============================================================================
// PT-04, and M01 section 8 registers the same property as RE-P-05. The two rows
// are one property under two registries and may not disagree:
//
//   STRATEGY PT-04  `withdrawable_cents >= 0` always, at every point in every
//                   generated life
//   M01 RE-P-05     `withdrawableCents >= 0` for every generated sequence,
//                   INCLUDING SEQUENCES THAT END BELOW `size`
//
// The invariant is INV-05, whose enforcement column reads "Formula floors at
// zero (R-35), check constraint, property RE-P-05". R-35 is
// `withdrawable = max(0, balance_cents - size_cents - buffer_cents)`.
//
// -----------------------------------------------------------------------------
// THE VACUITY RISK IS THE PHASE, AND IT IS WHY THIS FOLD STARTS FUNDED
// -----------------------------------------------------------------------------
// `withdrawableCents` opens with `if (state.phase !== 'funded') return 0n`
// (`src/payout/gates.ts` line 79). A fold that never reaches the funded phase
// therefore asserts `0 >= 0` on every step of every sequence, forever, and
// would pass against an implementation with no floor at all.
//
// AND CROSSING THE PASS DOES NOT FIX IT. A generated sequence reaches funded at
// most ONCE: R-31 resets the balance to `size_cents`, the next generated mark
// opens where the eval phase left off, and DO-3's INV-18 check refuses it. So an
// eval-phase fold contributes exactly one funded step, on which the balance is
// `size_cents` by construction.
//
// So the fold starts from `fundedPrior` (`fixtures-in-code.ts` line 371), and
// every generated day is a funded day.
//
// -----------------------------------------------------------------------------
// THE ONE OVERRIDE, AND WHY THE DATE IS WHAT IT IS
// -----------------------------------------------------------------------------
// `fundedPrior` dates its prior `2026-11-02`. `daySequenceArbitrary` draws its
// first session from `addCalendarDays('2026-01-02', n)` over `n` in [0, 1400],
// so most drawn sequences START BEFORE that date, and DO-1 refuses a mark that
// is not strictly after the prior (`advance.ts` line 198). Left alone, most
// folds would end on their first mark.
//
// The prior is therefore dated `2026-01-01`: one day before the generator's
// earliest possible session, so it is strictly less than every mark the
// generator can draw. THAT DAY IS NEVER RESOLVED AGAINST THE CALENDAR --
// `advance.ts` line 198 uses it for one string comparison, and every other field
// `fundedPrior` builds from `initialState` that could reach the calendar
// (`consistencyPeriodStartDay`, `payoutAnchorDay`, `cadenceAnchorDay`) is
// `null`.
// =============================================================================

import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import type { Cents, ResolvedPlan } from '../src/index.js';
import {
  ACCOUNT_OPENED_ON,
  CORE_50K,
  ENGINE_VERSION,
  MERIT_RAPID_50K,
  day,
  fundedPrior,
  withStaticDrawdown,
} from './fixtures-in-code.js';
import { daySequenceArbitrary } from './generators/day-sequence.js';
import type { DaySequence } from './generators/day-input.js';
import { materializedFrom } from './generator-bridge.js';
import { foldSequence } from './property-harness.js';
import type { FoldStep } from './property-harness.js';

const RUNS = 300;

/** Sized larger than `RUNS` for the same reason PT-01 sizes its own larger: a
 *  measurement that a case is REACHED must not itself depend on a lucky seed. */
const REACHABILITY = 1_200;

/**
 * The prior day, one before the generator's earliest possible session.
 *
 * See the header. It is compared and never resolved.
 */
const BEFORE_EVERY_DRAWN_SESSION = day('2026-01-01');

/**
 * Both v1 plans that carry an evaluation phase, and a static-drawdown variant.
 *
 * R-35 reads `balance`, `size_cents` and `buffer_cents` and nothing about the
 * drawdown type, so the variant is not there to vary the formula: it is there so
 * a sequence can travel further before breaching, since a static floor does not
 * trail up behind a winning run.
 */
const LINEUP: readonly ResolvedPlan[] = [CORE_50K, MERIT_RAPID_50K, withStaticDrawdown(CORE_50K)];

interface Case {
  readonly plan: ResolvedPlan;
  readonly seq: DaySequence;
}

const caseArbitrary = (): fc.Arbitrary<Case> =>
  fc
    .constantFrom(...LINEUP)
    .chain((plan) =>
      daySequenceArbitrary({ plan: materializedFrom(plan) }).map((seq) => ({ plan, seq })),
    );

const foldFunded = (plan: ResolvedPlan, seq: DaySequence): readonly FoldStep[] =>
  foldSequence(plan, seq, {
    prior: fundedPrior(plan, { tradingDay: BEFORE_EVERY_DRAWN_SESSION }),
    engineVersion: ENGINE_VERSION,
    openedOn: ACCOUNT_OPENED_ON,
  }).steps;

/** R-35, re-derived from its own wording rather than called from the engine. */
const r35 = (balanceCents: Cents, plan: ResolvedPlan): Cents => {
  const surplus = balanceCents - plan.sizeCents - plan.funded.bufferCents;
  return surplus > 0n ? surplus : 0n;
};

describe('PT-04 / RE-P-05: withdrawable never goes negative', () => {
  test('withdrawableCents >= 0 at every point in every generated life', () => {
    fc.assert(
      fc.property(caseArbitrary(), ({ plan, seq }: Case) => {
        for (const { state } of foldFunded(plan, seq)) {
          expect(
            state.withdrawableCents >= 0n,
            `withdrawableCents ${state.withdrawableCents} is negative on ${state.tradingDay}, ` +
              `balance ${state.balanceCents} against size ${plan.sizeCents} and buffer ` +
              `${plan.funded.bufferCents}. INV-05: R-35's formula floors at zero`,
          ).toBe(true);
        }
      }),
      { numRuns: RUNS },
    );
  });

  test('and it equals R-35 exactly, EXCEPT on the row that closes the account', () => {
    // `>= 0` ON ITS OWN IS SATISFIED FOREVER BY A VALUE STUCK AT `0n`, so the
    // sign is asserted with the formula rather than instead of it.
    //
    // THE EQUALITY IS RE-DERIVED FROM R-35's WORDING and is deliberately not a
    // call into `withdrawableCents`. So what it detects is DRIFT BETWEEN THE
    // DOCUMENT AND THE CODE, not the agreement of a formula with itself: if the
    // engine's arithmetic ever moves away from
    // `max(0, balance - size - buffer)`, this fails, and if `r35` above is ever
    // edited to match a changed engine, the edit is the finding.
    //
    // -------------------------------------------------------------------------
    // THE BREACH ROW IS AN EXCEPTION, AND THIS PROPERTY FOUND IT RATHER THAN
    // ASSUMING IT
    // -------------------------------------------------------------------------
    // The first run of this test failed with `R-35 over balance 4958745:
    // expected 1n to be 0n`. That is not a defect, it is ADR-054 (accepted
    // 2026-08-17) working: R-35 DOES NOT RUN on the row that closes an account.
    // DO-5 returns before DO-9, and `withdrawableCents` CARRIES through the
    // breach block's spread, so a breach row reports the value the account held
    // when it was last evaluated -- 1n from a prior close at 5,100,001c -- while
    // its balance has since fallen to 4,958,745c.
    //
    // THE EXCEPTION IS PINNED RATHER THAN EXCUSED, which is PT-01's rule for
    // ADR-050's exception one property over. A test that merely SKIPPED breach
    // rows would accept ANY value there, including a negative one, which is
    // exactly the case this property exists to forbid. So the breach row gets a
    // STRICTER assertion instead: it must equal the prior day's withdrawable
    // EXACTLY, which is what "carries" means.
    fc.assert(
      fc.property(caseArbitrary(), ({ plan, seq }: Case) => {
        for (const step of foldFunded(plan, seq)) {
          const { state, priorState } = step;

          if (state.breached) {
            expect(
              state.withdrawableCents,
              `${state.tradingDay} closed the account, so ADR-054 carries withdrawable rather ` +
                "than recomputing it. It must equal the prior day's value exactly",
            ).toBe(priorState === null ? state.withdrawableCents : priorState.withdrawableCents);
            continue;
          }

          expect(
            state.withdrawableCents,
            `R-35 over balance ${state.balanceCents} on ${state.tradingDay}`,
          ).toBe(r35(state.balanceCents, plan));
        }
      }),
      { numRuns: RUNS },
    );
  });
});

// -----------------------------------------------------------------------------
// The generator reaches the case the property is about, measured
// -----------------------------------------------------------------------------
// STRATEGY's note on this row is load bearing and is the reason this block
// exists: "The generator is allowed to drive balance below `size + buffer`,
// which is the case a naive implementation returns a negative for."
//
// A GENERATOR THAT NEVER REACHED THAT CASE WOULD PASS BOTH TESTS ABOVE AGAINST
// AN ENGINE WITH NO FLOOR AT ALL, because every surplus it ever saw would be
// positive and `max(0, x)` and `x` agree there. So the case is counted rather
// than assumed, and the count is asserted.
describe('the support reaches the case PT-04 is about', () => {
  const states = fc
    .sample(caseArbitrary(), REACHABILITY)
    .flatMap(({ plan, seq }) => foldFunded(plan, seq).map(({ state }) => ({ state, plan })));

  test('the fold produces funded days, which is what the phase guard needs', () => {
    // NOT `every`. A funded account that breaches closes, and DO-5 writes
    // `phase: 'closed'` on that row, so a fold ending in a breach carries one
    // non-funded step at its end. The first version of this asserted `every`
    // and was wrong for exactly that reason. What matters is that funded days
    // DOMINATE, because those are the only ones on which the phase guard in
    // `gates.ts` line 79 lets R-35 run at all.
    expect(states.length).toBeGreaterThan(0);
    const funded = states.filter(({ state }) => state.phase === 'funded');
    expect(
      funded.length,
      'no generated day was folded in the funded phase, so `withdrawableCents` returned 0n ' +
        'from its phase guard on every step and both properties above are vacuous',
    ).toBeGreaterThan(0);
    expect(funded.length * 2).toBeGreaterThan(states.length);
  });

  test('balance is driven BELOW size + buffer, which is the naive-negative case', () => {
    const below = states.filter(
      ({ state, plan }) => state.balanceCents < plan.sizeCents + plan.funded.bufferCents,
    );
    expect(
      below.length,
      'no generated day put the balance below size + buffer, so a missing floor at zero ' +
        'would never have been reachable and both properties above are vacuous',
    ).toBeGreaterThan(0);
  });

  test('and ABOVE it, so the formula is exercised on both sides of the floor', () => {
    const above = states.filter(
      ({ state, plan }) => state.balanceCents > plan.sizeCents + plan.funded.bufferCents,
    );
    expect(
      above.length,
      'every generated day sat at or below size + buffer, so withdrawable was always 0 and ' +
        'the equality test could not tell R-35 from a constant',
    ).toBeGreaterThan(0);
  });
});
