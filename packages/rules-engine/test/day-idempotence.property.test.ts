// =============================================================================
// packages/rules-engine/test/day-idempotence.property.test.ts
// =============================================================================
// PT-07, and M01 section 8 registers the same property as RE-P-13. The two rows
// are one property under two registries and may not disagree:
//
//   STRATEGY PT-07  Idempotence of day application. Applying the same closed
//                   day twice is a no-op on state
//   M01 RE-P-13     `advanceDay` applied twice with the same mark yields the
//                   same state as applying it once
//
// The invariant is INV-14, whose enforcement column pairs it with GS-047 --
// "Batch crashes at account 2,341 of 5,000 ... resumable, idempotent, no
// double-applied day". STRATEGY's note says what rests on it: this is "what
// makes the resumable batch safe".
//
// -----------------------------------------------------------------------------
// IT IS IMPLEMENTED AS A REFUSAL, NOT AS A SILENT NO-OP, AND BOTH HALVES ARE
// ASSERTED
// -----------------------------------------------------------------------------
// `advance.ts` line 198 reads
// `if (input.prior !== null && mark.tradingDay <= input.prior.tradingDay)` and
// its own comment cites INV-14 and R-06 by name. It returns `refuse(prior, ...)`,
// which carries the prior state back unchanged.
//
// SO "THE STATE DID NOT CHANGE" IS THE WEAKER HALF. An engine that silently
// re-ran the day and happened to land on the same numbers would satisfy it, and
// so would one that returned `prior` without noticing anything was wrong. The
// second half -- that a refusal came back, naming the day -- is what
// distinguishes "the engine declined" from "the engine did it again and got
// lucky".
//
// THE REFUSAL KIND IS `not_forward` AND THERE IS NO NARROWER ONE. That kind
// covers the repeated day AND an out-of-order feed; `advance.ts` line 200 says
// so in as many words, and the `detail` string is what separates them. So the
// kind is pinned by name and the detail is pinned as well, because on a repeat
// the two days in that sentence are the SAME day, which is a shape an
// out-of-order feed cannot produce.
//
// -----------------------------------------------------------------------------
// FOLDED ON BOTH PHASES, BECAUSE THE GUARD SITS AHEAD OF THE PHASE BRANCHES
// -----------------------------------------------------------------------------
// DO-1 runs before DO-2 through DO-9, so the same-day guard is reached
// identically by an eval account and a funded one. A property that only ever
// saw one phase would not have shown that, and the funded fold is also the one
// that carries settlements-shaped adjustments and the payout gates.
// =============================================================================

import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import { advanceDay } from '../src/index.js';
import type { DayOutput, ResolvedPlan, RuleState } from '../src/index.js';
import {
  ACCOUNT_OPENED_ON,
  CORE_50K,
  ENGINE_VERSION,
  MERIT_RAPID_50K,
  day,
  fundedPrior,
} from './fixtures-in-code.js';
import { daySequenceArbitrary } from './generators/day-sequence.js';
import type { DaySequence } from './generators/day-input.js';
import { foldSequence, materializedFrom, sliceOf } from './property-harness.js';
import type { FoldStep } from './property-harness.js';

const RUNS = 250;
const REACHABILITY = 800;

/** See `withdrawable-floor.property.test.ts`: one day before the generator's earliest session. */
const BEFORE_EVERY_DRAWN_SESSION = day('2026-01-01');

const LINEUP: readonly ResolvedPlan[] = [CORE_50K, MERIT_RAPID_50K];

/** `eval` starts the account from nothing; `funded` starts it past the pass. */
type Start = 'eval' | 'funded';

interface Case {
  readonly plan: ResolvedPlan;
  readonly seq: DaySequence;
  readonly start: Start;
}

const caseArbitrary = (): fc.Arbitrary<Case> =>
  fc
    .tuple(fc.constantFrom(...LINEUP), fc.constantFrom<Start[]>('eval', 'funded'))
    .chain(([plan, start]) =>
      daySequenceArbitrary({ plan: materializedFrom(plan) }).map((seq) => ({ plan, seq, start })),
    );

const priorFor = (plan: ResolvedPlan, start: Start): RuleState | null =>
  start === 'eval' ? null : fundedPrior(plan, { tradingDay: BEFORE_EVERY_DRAWN_SESSION });

/**
 * A stable rendering of a state, with `bigint` tagged.
 *
 * Keys are SORTED so a comparison can never turn on insertion order, and the
 * `n` suffix means `5n` and the string `"5"` can never compare equal. M01
 * section 1.4 bans key-order-dependent output inside the engine; this is the
 * same discipline applied to the thing that reads it.
 */
const stableCanonical = (state: RuleState): string => {
  const entries = Object.entries(state as unknown as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return JSON.stringify(entries, (_key, value: unknown) =>
    typeof value === 'bigint' ? `${value.toString()}n` : value,
  );
};

/** Apply the identical mark a second time to the state the first application produced. */
function applyAgain(plan: ResolvedPlan, seq: DaySequence, step: FoldStep): DayOutput {
  return advanceDay({
    engineVersion: ENGINE_VERSION,
    plan,
    prior: step.state,
    mark: step.mark,
    calendar: sliceOf(seq),
    settlements: [],
    openedOn: ACCOUNT_OPENED_ON,
  });
}

describe('PT-07 / RE-P-13: applying the same day twice is a no-op on state', () => {
  test('the state after the second application is byte-identical to the first', () => {
    fc.assert(
      fc.property(caseArbitrary(), ({ plan, seq, start }: Case) => {
        for (const step of foldSequence(plan, seq, {
          prior: priorFor(plan, start),
          engineVersion: ENGINE_VERSION,
          openedOn: ACCOUNT_OPENED_ON,
        }).steps) {
          const again = applyAgain(plan, seq, step);
          expect(
            stableCanonical(again.state),
            `re-applying ${step.tradingDay} moved the state. INV-14: applying the same ` +
              'trading day twice is a no-op, and GS-047 is the resumable batch that rests on it',
          ).toBe(stableCanonical(step.state));
        }
      }),
      { numRuns: RUNS },
    );
  });

  test('and the second application REFUSES, rather than silently returning the prior', () => {
    fc.assert(
      fc.property(caseArbitrary(), ({ plan, seq, start }: Case) => {
        for (const step of foldSequence(plan, seq, {
          prior: priorFor(plan, start),
          engineVersion: ENGINE_VERSION,
          openedOn: ACCOUNT_OPENED_ON,
        }).steps) {
          const again = applyAgain(plan, seq, step);

          // WHICH REFUSAL IS PINNED BY THE STATE, NOT LOOSENED TO "either of
          // two". `advance.ts` line 188 returns `account_closed` for a closed or
          // graduated account and it sits AHEAD of the same-day guard at line
          // 198, so a day that CLOSED the account is refused on re-application
          // for being terminal before it is ever refused for being a repeat.
          // Found by this test, which first asserted `not_forward` everywhere
          // and got `account_closed` on a breach row.
          //
          // Both refuse and both carry `prior` back, which is why the no-op
          // property above holds either way and cannot tell them apart.
          const terminal = step.state.phase === 'closed' || step.state.phase === 'graduated';

          expect(
            again.assertions.map((a) => a.kind),
            `re-applying ${step.tradingDay} returned no refusal, so the state being unchanged ` +
              'says only that the engine re-ran the day and landed on the same numbers',
          ).toEqual([terminal ? 'account_closed' : 'not_forward']);

          // The detail is what separates a REPEAT from an out-of-order feed,
          // which share the `not_forward` kind. On a repeat both days in that
          // sentence are the same day, which no out-of-order feed can produce.
          if (!terminal) {
            expect(again.assertions[0]?.detail).toBe(
              `${step.tradingDay} is not after the prior state's ${step.tradingDay}`,
            );
          }
        }
      }),
      { numRuns: RUNS },
    );
  });
});

// -----------------------------------------------------------------------------
// The double-apply happens on states the engine actually advanced
// -----------------------------------------------------------------------------
// If every FIRST application had been refused, `foldSequence` would return no
// steps, both properties above would iterate an empty list, and the suite would
// be green having compared nothing. The count is asserted rather than assumed.
describe('the support reaches the case PT-07 is about', () => {
  const cases = fc.sample(caseArbitrary(), REACHABILITY);
  const steps = cases.flatMap(({ plan, seq, start }) =>
    foldSequence(plan, seq, {
      prior: priorFor(plan, start),
      engineVersion: ENGINE_VERSION,
      openedOn: ACCOUNT_OPENED_ON,
    }).steps.map((step) => ({ step, start })),
  );

  test('first applications succeed, so there is a state to re-apply against', () => {
    expect(
      steps.length,
      'every first application was refused, so both properties above iterated an empty ' +
        'list and the suite is green having compared nothing',
    ).toBeGreaterThan(0);
  });

  test('and both phases are folded, because the guard sits ahead of the phase branches', () => {
    expect(steps.some(({ start }) => start === 'eval')).toBe(true);
    expect(steps.some(({ start }) => start === 'funded')).toBe(true);
  });

  test('sequences of more than one day are reached, so the guard is tested past day one', () => {
    // A one-day fold tests the repeat against a prior the engine built itself.
    // A longer one tests it against a prior the engine ADVANCED, which is the
    // shape the nightly batch resumes into.
    const multi = cases.filter(
      ({ plan, seq, start }) =>
        foldSequence(plan, seq, {
          prior: priorFor(plan, start),
          engineVersion: ENGINE_VERSION,
          openedOn: ACCOUNT_OPENED_ON,
        }).steps.length > 1,
    );
    expect(multi.length).toBeGreaterThan(0);
  });
});
