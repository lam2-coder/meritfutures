// =============================================================================
// packages/rules-engine/test/engine-eligible-conjunction.property.test.ts
// =============================================================================
// RE-P-15, WHICH SIX DOCUMENTS NAMED AND NO FILE CONTAINED. M01 section 8.2
// states it in one line:
//
//   RE-P-15  `engineEligible` equals the conjunction of `engineGates`, for
//            every generated state
//
// Its invariant is INV-15, "`engine_eligible == AND(every engine gate)` WITH NO
// SHORTCUT PATH". ADR-057 decided section 3.6's breach block on this property
// and recorded that it was "named as the check and deliberately not written",
// so until this file landed the invariant that ruling turned on was enforced by
// nothing.
//
// -----------------------------------------------------------------------------
// THE SIX TERMS COME FROM M01, NOT FROM `types.ts`
// -----------------------------------------------------------------------------
// This is the whole safety of the file and it is worth being explicit about.
// INV-15 quantifies over "every engine gate" and, until ADR-060, NO DOCUMENT
// ENUMERATED THEM: the only closed list in the repository was the engine's own
// `EngineGateResults`. A property that read its term list off that interface
// would be grading the engine against itself, which is TR-01 defeated rather
// than satisfied.
//
// So the enumeration is M01's, derived in one step under INV-15 in section 1.5
// and reproduced here as the derivation rather than as the answer. Group F is
// R-33 to R-41; three of its nine rows are definitionally not terms:
//
//   R-38  one payout in flight  its input is declared on `ExternalGates`,
//                               context, never replayed (INV-23, SD-06)
//   R-40  context gates         it IS the context-gate rule
//   R-41  the conjunction       it is the conjunction, not a term in it
//
// Six rows remain and they are `ENGINE_GATES` below. The FIELD NAMES are the
// engine's spelling, because a test has to index the record it reads; the
// MEMBERSHIP and the COUNT are M01's, and `the record carries exactly the six`
// is asserted separately so a seventh gate appearing in `EngineGateResults`
// fails this suite until M01's enumeration grows to admit it.
//
// -----------------------------------------------------------------------------
// ONE TERM CANNOT BE KILLED BY ANY STATE, AND THE FILE SAYS SO RATHER THAN
// PRETENDING OTHERWISE
// -----------------------------------------------------------------------------
// A dropped term in `allGatesPass` is caught only by a state where THAT gate is
// the sole failing one. Five of the six have such a state. `buffer` (R-35) does
// not, and the reason is arithmetic rather than a gap in the generators:
// `gates.ts` line 185 reads `pass: state.withdrawableCents > 0n` while R-39
// requires `min(withdrawable, cap) >= min_payout_cents`, which CV-15 fixes at
// 10,000c. So `buffer.pass === false` implies `minimumAmount.pass === false` in
// EVERY state, and the term is present, honest and incapable of binding, which
// `gates.ts` line 178 already calls out as PW-01 domination.
//
// THE COMPENSATING CONTROL IS TO ASSERT THE DOMINATION ITSELF, below, so the
// reason the mutant is unkillable is a checked fact rather than a claim in a
// comment. Section 4's `buffer` row therefore asserts that R-35 and R-39 fail
// TOGETHER, which is the true statement, instead of a sole-failure that no
// state can produce.
//
// -----------------------------------------------------------------------------
// WHAT IS FOLDED, AND WHY MORE THAN ONE SHAPE
// -----------------------------------------------------------------------------
// A single fold shape reaches `engineEligible: false` on nearly every row and
// `true` on none, which would make the property green having compared one
// verdict. Four shapes are folded for four different reasons, and section 3
// asserts what each is here to reach:
//
//   eval start            `initialState` opens in eval, where R-35's
//                         withdrawable is zero outside the funded phase
//   funded start          the ordinary funded fold
//   funded, win days      banked win days let profit alone decide, which is the
//     banked               only way a generated fold reaches `true` at all
//   funded, banked, on    R-33 is configured 0 on all three v1 plans, so the
//     `min_trading_days`   ONLY way a generated state fails it outside a breach
//     raised               is a plan variant `validatePlan` accepts
//
// Breach rows are deliberately included. ADR-057 turned on RE-P-15 holding over
// them: `gatesAfterBreach` states every `pass` false beside `engineEligible:
// false`, and a carried gate record would show a passing conjunction on the
// worst row in an account's life.
// =============================================================================

import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import { evaluateEngineGates } from '../src/payout/gates.ts';
import type {
  Cents,
  EngineGateResults,
  ResolvedPlan,
  RuleState,
  TradingDay,
} from '../src/index.ts';
import {
  ACCOUNT_OPENED_ON,
  CME_WINDOW,
  CORE_50K,
  ENGINE_VERSION,
  MERIT_RAPID_50K,
  day,
  fundedPrior,
  withFundedMinTradingDays,
} from './fixtures-in-code.ts';
import { daySequenceArbitrary } from './generators/day-sequence.ts';
import { materializedFrom } from './generator-bridge.ts';
import { foldSequence } from './property-harness.ts';

const RUNS = 200;
const REACHABILITY = 1500;

/**
 * THE REACHABILITY SAMPLE IS SEEDED AND THE PROPERTIES ABOVE ARE NOT.
 *
 * Section 3 asserts COUNTS -- that a verdict is reached, that a term is isolated
 * as a sole failure -- and the rarest of them lands about four times in five
 * hundred draws. An unseeded sample makes that a coin flip, so the suite would
 * go red on a tree nobody touched, which is the one failure mode that teaches a
 * reader to re-run instead of to read. The seed is arbitrary and fixed; the
 * PROPERTIES still draw fresh cases on every run, because they assert a law
 * rather than a census.
 */
const REACHABILITY_SEED = 20_260_819;

/** One day before the generator's earliest session, so the fold's prior is behind it. */
const BEFORE_EVERY_DRAWN_SESSION = day('2026-01-01');

// -----------------------------------------------------------------------------
// The enumeration, derived above and used everywhere below
// -----------------------------------------------------------------------------
/** M01 INV-15's closed six, in rule order. The rule id is carried so a failure names it. */
const ENGINE_GATES = [
  { rule: 'R-33', gate: 'minimum trading days', key: 'tradedDays' },
  { rule: 'R-34', gate: 'win days', key: 'winDays' },
  { rule: 'R-35', gate: 'buffer and withdrawable', key: 'buffer' },
  { rule: 'R-36', gate: 'funded consistency', key: 'consistency' },
  { rule: 'R-37', gate: 'cadence gap', key: 'cadenceGap' },
  { rule: 'R-39', gate: 'minimum payout', key: 'minimumAmount' },
] as const satisfies readonly {
  readonly rule: string;
  readonly gate: string;
  readonly key: keyof EngineGateResults;
}[];

type GateKey = (typeof ENGINE_GATES)[number]['key'];

const GATE_KEYS: readonly GateKey[] = ENGINE_GATES.map((g) => g.key);

/**
 * The conjunction, computed from the six M01 names.
 *
 * WRITTEN AS `every` OVER A NAMED, ORDERED ARRAY rather than as a reduction over
 * `Object.values(gates)`. A reduction would read whatever the record happens to
 * hold, so a seventh gate would join this side of the equality silently and the
 * property would agree with the engine by construction. The array is INV-15's
 * list; `the record carries exactly these six` is the separate assertion that
 * closes the gap between the two.
 */
const conjunctionOf = (gates: EngineGateResults): boolean =>
  GATE_KEYS.every((key) => gates[key].pass);

const failingIn = (gates: EngineGateResults): readonly GateKey[] =>
  GATE_KEYS.filter((key) => !gates[key].pass);

// -----------------------------------------------------------------------------
// The four fold shapes
// -----------------------------------------------------------------------------
type Shape = 'eval' | 'funded' | 'banked' | 'banked-min-days';

const SHAPES: readonly Shape[] = ['eval', 'funded', 'banked', 'banked-min-days'];

/**
 * The plan each shape folds, and the prior it folds from.
 *
 * `banked` PRESETS `winDaysCount` AND NOTHING ELSE THAT DECIDES A GATE. R-34's
 * counter is not constrained by the marks, so setting it high hands the profit
 * gates the decision and is what makes `engineEligible: true` reachable at all;
 * every other gate still answers from the folded state. `banked-min-days` adds
 * the ONE config change R-33 needs to be able to fail, which `validatePlan`
 * accepts and no v1 plan uses (ADR-015 sets it to 0 everywhere).
 */
const planFor = (plan: ResolvedPlan, shape: Shape): ResolvedPlan =>
  shape === 'banked-min-days' ? withFundedMinTradingDays(plan, 5) : plan;

const priorFor = (plan: ResolvedPlan, shape: Shape): RuleState | null => {
  if (shape === 'eval') return null;
  if (shape === 'funded') return fundedPrior(plan, { tradingDay: BEFORE_EVERY_DRAWN_SESSION });
  return fundedPrior(plan, {
    tradingDay: BEFORE_EVERY_DRAWN_SESSION,
    winDaysCount: 40,
    tradedDaysCount: 3,
  });
};

interface Case {
  readonly plan: ResolvedPlan;
  readonly shape: Shape;
  readonly seq: import('./generators/day-input.ts').DaySequence;
}

const caseArbitrary = (): fc.Arbitrary<Case> =>
  fc
    .tuple(fc.constantFrom(CORE_50K, MERIT_RAPID_50K), fc.constantFrom(...SHAPES))
    .map(([published, shape]) => ({ plan: planFor(published, shape), shape }))
    .chain(({ plan, shape }) =>
      daySequenceArbitrary({ plan: materializedFrom(plan) }).map((seq) => ({ plan, shape, seq })),
    );

const statesOf = ({ plan, shape, seq }: Case): readonly RuleState[] =>
  foldSequence(plan, seq, {
    prior: priorFor(plan, shape),
    engineVersion: ENGINE_VERSION,
    openedOn: ACCOUNT_OPENED_ON,
  }).steps.map((step) => step.state);

// =============================================================================
// 1. RE-P-15
// =============================================================================
describe('RE-P-15 / INV-15: engineEligible is the conjunction of the six engine gates', () => {
  test('the two agree on every generated state', () => {
    fc.assert(
      fc.property(caseArbitrary(), (kase: Case) => {
        for (const state of statesOf(kase)) {
          expect(
            state.engineEligible,
            `RE-P-15: on ${kase.shape} ${state.tradingDay} the engine's verdict is ` +
              `${String(state.engineEligible)} while the conjunction of R-33, R-34, R-35, R-36, ` +
              `R-37 and R-39 is ${String(conjunctionOf(state.engineGates))}. Failing: ` +
              `${failingIn(state.engineGates).join(', ') || 'none'}. INV-15 admits no shortcut path`,
          ).toBe(conjunctionOf(state.engineGates));
        }
      }),
      { numRuns: RUNS },
    );
  });

  test('including on breach rows, which is what ADR-057 turned on', () => {
    fc.assert(
      fc.property(caseArbitrary(), (kase: Case) => {
        for (const state of statesOf(kase).filter((s) => s.breached)) {
          // R-24 and R-25: DO-5 returns before DO-9, so section 3.6 STATES the
          // gate record rather than evaluating it. Every pass is false, so the
          // conjunction is false, so the equality holds on the row where a
          // carried record would have broken it.
          expect(failingIn(state.engineGates)).toEqual(GATE_KEYS);
          expect(state.engineEligible).toBe(false);
          expect(conjunctionOf(state.engineGates)).toBe(false);
        }
      }),
      { numRuns: RUNS },
    );
  });
});

// =============================================================================
// 2. The record carries exactly the six M01 enumerates
// =============================================================================
// WITHOUT THIS, SECTION 1 IS HALF A PROPERTY. `conjunctionOf` reads six named
// keys, so a seventh gate added to `EngineGateResults` and conjoined by the
// engine would leave section 1 green while `engineEligible` depended on a term
// INV-15's enumeration does not contain. Asserted at RUNTIME rather than as a
// `satisfies` on the type, because a compile error names a type mismatch and
// this needs to name the invariant.
describe('the gate record is closed at the six INV-15 enumerates', () => {
  test('every generated state carries exactly those keys and no others', () => {
    fc.assert(
      fc.property(caseArbitrary(), (kase: Case) => {
        for (const state of statesOf(kase)) {
          expect(
            Object.keys(state.engineGates).slice().sort(),
            "the engine gate record no longer matches M01 INV-15's enumeration. If a gate was " +
              "added, INV-15 and section 1.5's derivation move first and this list follows; a " +
              'gate in the record but outside the conjunction is the shortcut path INV-15 forbids',
          ).toEqual(GATE_KEYS.slice().sort());
        }
      }),
      { numRuns: RUNS },
    );
  });
});

// =============================================================================
// 3. Non-vacuity: what the generated folds actually reach
// =============================================================================
// EVERY ASSERTION ABOVE IS SATISFIED BY A FOLD THAT PRODUCED NO STATES, and by
// one that produced only `false`. The counts below are measured once over a
// fixed sample and asserted, so a generator change that quietly stops reaching a
// verdict fails here rather than hollowing out section 1 in silence.
describe('the generated folds reach the states RE-P-15 is about', () => {
  const cases = fc.sample(caseArbitrary(), { numRuns: REACHABILITY, seed: REACHABILITY_SEED });
  const states = cases.flatMap((kase) => statesOf(kase).map((state) => ({ ...kase, state })));

  test('states are produced at all', () => {
    expect(states.length).toBeGreaterThan(0);
  });

  test('BOTH verdicts are reached, so the equality is exercised in both directions', () => {
    expect(
      states.filter(({ state }) => state.engineEligible).length,
      'no generated state was engine-eligible, so section 1 only ever compared `false` to ' +
        '`false` and a conjunction that always returned false would pass it',
    ).toBeGreaterThan(0);
    expect(states.filter(({ state }) => !state.engineEligible).length).toBeGreaterThan(0);
  });

  test('every one of the six is observed both passing and failing', () => {
    for (const { rule, gate, key } of ENGINE_GATES) {
      expect(
        states.some(({ state }) => state.engineGates[key].pass),
        `${rule} (${gate}) never passed in any generated state`,
      ).toBe(true);
      expect(
        states.some(({ state }) => !state.engineGates[key].pass),
        `${rule} (${gate}) never failed in any generated state`,
      ).toBe(true);
    }
  });

  // WHICH TERMS A DROPPED-TERM MUTANT DIES ON, MEASURED RATHER THAN ASSUMED.
  // Only a state where one gate is the SOLE failure distinguishes a conjunction
  // missing that term from one that has it. Three of the six are reached this
  // way by the folds; the other three are reached by section 4.
  test('three terms are witnessed as the sole failing gate by the folds alone', () => {
    const sole = new Set(
      states
        .filter(({ state }) => !state.breached && failingIn(state.engineGates).length === 1)
        .map(({ state }) => failingIn(state.engineGates)[0]!),
    );
    expect(
      [...sole].sort(),
      'the fold shapes no longer isolate the terms section 4 assumes',
    ).toEqual(['consistency', 'tradedDays', 'winDays'].sort());
  });
});

// =============================================================================
// 4. Every term is load bearing
// =============================================================================
// SECTION 1 IS TRUE OF A CONJUNCTION MISSING A TERM unless a state exists where
// that term alone fails. This section builds those states directly, one gate at
// a time, and calls `evaluateEngineGates` on them: it is the floor under
// `allGatesPass`, and dropping any of the five killable terms turns it red.
//
// The base state is a funded state that clears all six, and each case moves ONE
// input. The magnitudes are drawn rather than written, so the assertion is about
// the gate rather than about one number.
const baseState = (overrides: Partial<RuleState> = {}): RuleState =>
  fundedPrior(CORE_50K, {
    tradingDay: day('2026-11-06'),
    balanceCents: 5_300_000n,
    highWaterBalanceCents: 5_300_000n,
    // R-35 written out, not imported: max(0, balance - size - buffer)
    // = max(0, 5,300,000 - 5,000,000 - 100,000) = 200,000c.
    withdrawableCents: 200_000n,
    winDaysCount: 5,
    tradedDaysCount: 3,
    // R-29 over R-47's period: 60,000 / 300,000 = 2000bp, inside CORE-50K's 3000.
    consistencyBestDayCents: 60_000n,
    consistencyPeriodProfitCents: 300_000n,
    consistencyPeriodStartDay: day('2026-11-02'),
    ...overrides,
  });

const verdictOf = (
  plan: ResolvedPlan,
  state: RuleState,
): { readonly engineEligible: boolean; readonly gates: EngineGateResults } => {
  const outcome = evaluateEngineGates({ state, plan, calendar: CME_WINDOW });
  if (outcome.kind !== 'evaluated') {
    throw new Error(`the isolation base refused: ${outcome.assertion.detail}`);
  }
  return { engineEligible: outcome.engineEligible, gates: outcome.gates };
};

/** One case: break exactly one gate, and say which. */
interface Break {
  readonly rule: string;
  readonly key: GateKey;
  readonly plan: ResolvedPlan;
  readonly state: RuleState;
  /** The gates expected to fail. One key, except where R-39 dominates R-35. */
  readonly expect: readonly GateKey[];
}

const breakArbitrary = (): fc.Arbitrary<Break> =>
  fc.oneof(
    // R-33. `tradedDaysCount >= min_trading_days`, on the one config that lets
    // it bind. The THRESHOLD moves and the counter stays, so both sides of `>=`
    // stay comparable (`withFundedMinTradingDays`'s own argument).
    fc.integer({ min: 4, max: 40 }).map((need) => ({
      rule: 'R-33',
      key: 'tradedDays' as const,
      plan: withFundedMinTradingDays(CORE_50K, need),
      state: baseState(),
      expect: ['tradedDays' as const],
    })),
    // R-34. `winDaysCount >= required_count`, CORE-50K requires 5.
    fc.integer({ min: 0, max: 4 }).map((have) => ({
      rule: 'R-34',
      key: 'winDays' as const,
      plan: CORE_50K,
      state: baseState({ winDaysCount: have }),
      expect: ['winDays' as const],
    })),
    // R-35, AND R-39 WITH IT. `buffer.pass` is `withdrawable > 0` and R-39 needs
    // `min(withdrawable, cap) >= 10,000c`, so no state fails R-35 alone. The
    // domination is asserted here instead of a sole failure that cannot exist.
    fc.constant({
      rule: 'R-35',
      key: 'buffer' as const,
      plan: CORE_50K,
      state: baseState({ balanceCents: 5_000_000n, withdrawableCents: 0n }),
      expect: ['buffer' as const, 'minimumAmount' as const],
    }),
    // R-36. R-29's share against CORE-50K's 3000bp, over a 300,000c period.
    fc.bigInt({ min: 90_001n, max: 300_000n }).map((best: Cents) => ({
      rule: 'R-36',
      key: 'consistency' as const,
      plan: CORE_50K,
      state: baseState({ consistencyBestDayCents: best }),
      expect: ['consistency' as const],
    })),
    // R-37. Every anchor inside `CME_WINDOW` is fewer than CORE-50K's 5 trading
    // days from 2026-11-06 by sequence subtraction, so any of them fails.
    fc
      .constantFrom<TradingDay[]>(
        day('2026-11-02'),
        day('2026-11-03'),
        day('2026-11-04'),
        day('2026-11-05'),
      )
      .map((anchor) => ({
        rule: 'R-37',
        key: 'cadenceGap' as const,
        plan: CORE_50K,
        state: baseState({ cadenceAnchorDay: anchor }),
        expect: ['cadenceGap' as const],
      })),
    // R-39. `min(withdrawable, cap) >= 10,000c`, exactly 10,000 is eligible
    // (GS-042), so the failing band stops one cent short.
    fc.bigInt({ min: 1n, max: 9_999n }).map((withdrawable: Cents) => ({
      rule: 'R-39',
      key: 'minimumAmount' as const,
      plan: CORE_50K,
      // The balance stays high so R-35 still passes and the failure is R-39's
      // alone. `withdrawableCents` is a STORED field, which is what makes the
      // two separable here and not in any state the fold writes.
      state: baseState({ withdrawableCents: withdrawable }),
      expect: ['minimumAmount' as const],
    })),
  );

describe('every one of the six terms can decide engineEligible on its own', () => {
  test('the base state clears all six, so each case below moves exactly one thing', () => {
    const { engineEligible, gates } = verdictOf(CORE_50K, baseState());
    expect(failingIn(gates)).toEqual([]);
    expect(engineEligible).toBe(true);
  });

  test('breaking one gate makes engineEligible false, and only that gate fails', () => {
    fc.assert(
      fc.property(breakArbitrary(), (broken: Break) => {
        const { engineEligible, gates } = verdictOf(broken.plan, broken.state);
        expect(
          failingIn(gates),
          `${broken.rule} was broken and the failing set is not what R-33 to R-39 predict`,
        ).toEqual(broken.expect);
        expect(
          engineEligible,
          `${broken.rule} (${broken.key}) failed and \`engineEligible\` is still true, so that ` +
            'term is not in the conjunction. INV-15: `engine_eligible == AND(EVERY engine gate)`',
        ).toBe(false);
      }),
      { numRuns: RUNS },
    );
  });

  // THE ONE MUTANT NO PROPERTY CAN KILL, ASSERTED AS THE DOMINATION IT IS.
  // `gates.ts` line 185 makes R-35 `withdrawable > 0` and R-39 needs at least
  // CV-15's 10,000c, so dropping `gates.buffer.pass` from the conjunction
  // changes no verdict on any state whatsoever. That is a fact about the two
  // rules rather than a hole in this suite, and it is checked here so it stops
  // being a comment.
  test('R-35 is dominated by R-39, which is why its term is not independently killable', () => {
    fc.assert(
      fc.property(caseArbitrary(), (kase: Case) => {
        for (const state of statesOf(kase)) {
          if (!state.engineGates.buffer.pass) {
            expect(
              state.engineGates.minimumAmount.pass,
              `${state.tradingDay}: R-35 failed while R-39 passed, which R-35's ` +
                "`withdrawable > 0` and R-39's `min(withdrawable, cap) >= 10,000c` make " +
                'impossible. The domination this suite records is no longer true',
            ).toBe(false);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });
});
