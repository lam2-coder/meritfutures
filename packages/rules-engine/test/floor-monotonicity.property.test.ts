// =============================================================================
// packages/rules-engine/test/floor-monotonicity.property.test.ts
// =============================================================================
// RE-P-01, M01 section 8. STRATEGY section 3.1 registers the same property as
// PT-01, and ADR-050 amends both to one sentence:
//
//   floor(d+1) >= floor(d) for every generated day sequence and both drawdown
//   types, EXCEPT across the R-31 funded reset, where the floor equals
//   `size_cents - funded drawdown_cents` EXACTLY.
//
// THE EXCEPTION IS PINNED, NOT EXCUSED, and that distinction is the whole
// reason this file is worth its length. A property that merely SKIPPED the pass
// day would accept any floor at all there, which is precisely the unstated
// exception INV-06's "no exception, no phase qualifier" clause exists to
// forbid. So the pass day is the one step where the assertion gets STRICTER
// rather than weaker: `>=` becomes `===`, against the number R-12 states, R-31
// restates and GS-019 pins (4,750,000c on CORE-50K).
//
// -----------------------------------------------------------------------------
// THE GENERATOR IS TOLD NOTHING ABOUT PHASES, AND THAT IS THE DESIGN
// -----------------------------------------------------------------------------
// `daySequenceArbitrary` draws marks, gaps, half days, halted sessions and
// adjustments. It does not know what an eval pass is, cannot aim at one, and is
// not asked to. The exception is recognised from the ENGINE'S OWN OUTPUT: the
// step that emits `phase.passed` is the step the exception applies to.
//
// A generator that knew about phases would be deciding where the exception
// lands, which makes the property a restatement of the generator rather than a
// check on the engine. Reading the event stream keeps the two independent: if
// the engine ever moved the reset to a different day, or applied it without
// emitting the event, this property goes red rather than following it.
//
// -----------------------------------------------------------------------------
// THE FOLD ENDS THE DAY AFTER A PASS, AND THAT IS DO-3 WORKING
// -----------------------------------------------------------------------------
// The generator chains balances forward: `opening(d) = closing(d-1) +
// adjustment(d)`. R-31 resets the balance to `size_cents`, so the mark AFTER a
// pass opens where the eval phase left off and the engine's INV-18 check at DO-3
// refuses it. That refusal is correct, it is not this property's subject, and it
// is why `fold` stops at the first day carrying assertions and records why.
//
// The consequence is stated rather than discovered: a generated sequence
// contributes AT MOST ONE pass, and the pass day itself, which is the day the
// exception is about, is folded in full. `sawFoldEndedAfterPass` measures it.
//
// -----------------------------------------------------------------------------
// SETTLEMENTS ARE GENERATED, WHICH RE-P-01 REQUIRES AND A SEPARATE GENERATOR
// WAS NOT NEEDED FOR
// -----------------------------------------------------------------------------
// RE-P-01 is "including sequences containing settlements", and P2 section 5's
// arbitrary settlement generator does not exist: a coherent settlement stream
// means generating payout eligibility, which means the engine.
//
// It is not needed here. INV-18 compares `mark.opening` against the PRE-settlement
// balance plus `adjustment_cents` (advance.ts DO-3, and it is the third place
// M01's sketch disagrees with a binding statement), and SD-01 puts the settled
// withdrawal in exactly that column. So a mark the generator already draws with
// a NEGATIVE adjustment is the day-level shape of a settlement, and pairing it
// with a `SettlementFact` whose `approvedCents` is that adjustment negated
// produces a settlement day whose arithmetic closes. No eligibility is invented,
// because RE-P-01 asks what the FLOOR does across a settlement and R-19 answers
// that it does nothing.
// =============================================================================

import fc from 'fast-check';
import { beforeAll, describe, expect, test } from 'vitest';

import { advanceDay } from '../src/index.ts';
import type { Cents, ResolvedPlan, RuleState, SettlementFact, TradingDay } from '../src/index.ts';
import {
  ACCOUNT_OPENED_ON,
  CORE_50K,
  ENGINE_VERSION,
  MERIT_RAPID_50K,
  withStaticDrawdown,
} from './fixtures-in-code.ts';
import { daySequenceArbitrary } from './generators/day-sequence.ts';
import type { DaySequence, DailyMark as GeneratedMark } from './generators/day-input.ts';
import { materializedFrom, sliceOf, toEngineMark } from './generator-bridge.ts';

// Enough runs that a pass, a settlement and a graduation are each visited many
// times over. `REACHABILITY` below is what turns that from an assumption into a
// measurement, and it is sized larger for the same reason `day-sequence.property
// .test.ts` sizes its own larger: the rarest event this file tracks is a
// conjunction, and a check that passes on a lucky seed is how a real check gets
// reclassified as flaky and deleted.
const RUNS = 300;
const REACHABILITY = 1_500;

// -----------------------------------------------------------------------------
// The lineup this property folds against
// -----------------------------------------------------------------------------
// Every plan below comes from `fixtures-in-code.ts`, which transcribes M01
// Appendix A and cites every number beside itself. No parameter is invented
// here.
//
// BOTH DRAWDOWN TYPES, WHICH RE-P-01 NAMES. `trailing_eod` is what all three v1
// plans carry; `static` (R-16) is carried by none of them, and
// `withStaticDrawdown` exists in the fixture file for exactly that reason with
// the justification written out: "a config the lineup does not use is still a
// config `validatePlan` will accept, which is precisely why the operators have
// to be right before a plan enables one".
//
// It moves the FUNDED phase only, so the third entry folds an account whose eval
// phase trails and whose funded phase does not, which is the case that exercises
// both floor machines inside one life and across the transition this property is
// about.

const LINEUP: ReadonlyArray<readonly [string, ResolvedPlan]> = [
  ['CORE-50K', CORE_50K],
  ['MERIT-RAPID-50K', MERIT_RAPID_50K],
  ['CORE-50K, funded static drawdown', withStaticDrawdown(CORE_50K)],
];

/** R-12 and R-31's number, from the plan and never from a literal. GS-019 pins it at 4,750,000c. */
const fundedResetFloorCents = (plan: ResolvedPlan): Cents =>
  plan.sizeCents - plan.funded.drawdown.drawdownCents;

// -----------------------------------------------------------------------------
// Feeding the generator, and the two fields that are load bearing
// -----------------------------------------------------------------------------
// `daySequenceArbitrary` takes a `MaterializedPlan`, which is the shape a
// published plan has at publish time, and the fold takes a `ResolvedPlan`.
// `materializedFrom` is the projection between them and it now lives in
// `generator-bridge.ts`, whose header carries the reason it runs RESOLVED ->
// MATERIALIZED and never the reverse.
//
// `chainMarks` reads exactly two fields off the plan: `size_cents` for INV-20's
// first-day opening balance, and `phase_funded.win_days.win_day_floor_cents` for
// R-09's `win_day` column. `the projection carries the fold's own plan` below is
// the executable check that those two agree, so a drift fails by name rather
// than as an unexplained refusal in the middle of a fold.

// -----------------------------------------------------------------------------
// The fold
// -----------------------------------------------------------------------------

/** One folded day, reduced to what RE-P-01 reads. */
interface Step {
  readonly tradingDay: TradingDay;
  /** The floor the day started from: `prior.floorCents`, or the open floor on day one. */
  readonly floorBeforeCents: Cents;
  readonly floorAfterCents: Cents;
  /** ADR-050's exception applies to exactly the steps where this is true. */
  readonly passed: boolean;
  readonly settled: boolean;
  readonly lockedAfter: boolean;
  readonly phaseAfter: RuleState['phase'];
}

interface Fold {
  readonly steps: readonly Step[];
  /** The day the fold stopped on, or null if every mark folded. */
  readonly endedOn: { readonly tradingDay: TradingDay; readonly kind: string } | null;
  readonly endedAfterPass: boolean;
}

/**
 * A settlement for a day the generator already drew a negative adjustment on.
 *
 * `approvedCents` is that adjustment negated, so `prior.balance + adjustment` is
 * the post-settlement balance and INV-18 closes (advance.ts DO-3). The basis day
 * is the PREVIOUS session, because R-47 starts the new consistency period on the
 * trading day strictly after it and ADR-049 makes a lookup past the slice's
 * coverage a typed refusal rather than a wrong answer.
 */
function settlementFor(
  mark: GeneratedMark,
  sessions: readonly string[],
  ordinal: number,
): SettlementFact | null {
  if (mark.adjustmentCents >= 0) return null;
  const at = sessions.indexOf(mark.tradingDay);
  if (at < 1) return null;
  return {
    payoutRequestId: `generated-${String(ordinal)}`,
    ordinal,
    approvedCents: BigInt(-mark.adjustmentCents),
    basisTradingDay: sessions[at - 1] as TradingDay,
    effectiveTradingDay: mark.tradingDay as TradingDay,
  };
}

function fold(plan: ResolvedPlan, seq: DaySequence, withSettlements: boolean): Fold {
  const calendar = sliceOf(seq);
  const sessions = seq.calendar.days.map((d) => d.tradingDay);
  const steps: Step[] = [];

  let prior: RuleState | null = null;
  let ordinal = 1;
  let sawPass = false;

  for (const generated of seq.marks) {
    const mark = toEngineMark(generated);
    const settlement = withSettlements ? settlementFor(generated, sessions, ordinal) : null;

    const out = advanceDay({
      engineVersion: ENGINE_VERSION,
      plan,
      prior,
      mark,
      calendar,
      settlements: settlement === null ? [] : [settlement],
      openedOn: ACCOUNT_OPENED_ON,
    });

    if (out.assertions.length > 0) {
      // NO STATE IS WRITTEN FOR THE DAY, so there is no floor to compare and the
      // account's history stops here. Folding on past a refusal would compare a
      // floor against a prior the engine explicitly declined to advance.
      return {
        steps,
        endedOn: {
          tradingDay: mark.tradingDay,
          kind: out.assertions.map((a) => a.kind).join(', '),
        },
        endedAfterPass: sawPass,
      };
    }

    if (settlement !== null) ordinal += 1;

    // R-18 and SD-04: `floorOpenCents` is the floor this day's breach check
    // compared against, which is the floor the day STARTED from. Reading it off
    // the output rather than off `prior` is what lets the first day, where
    // `prior` is null and the engine builds the open state itself, be compared
    // at all.
    const passed = out.events.some((e) => e.type === 'phase.passed');
    if (passed) sawPass = true;

    steps.push({
      tradingDay: out.state.tradingDay,
      floorBeforeCents: out.state.floorOpenCents,
      floorAfterCents: out.state.floorCents,
      passed,
      settled: settlement !== null,
      lockedAfter: out.state.floorLocked,
      phaseAfter: out.state.phase,
    });

    prior = out.state;
    if (out.state.phase === 'closed' || out.state.phase === 'graduated') {
      // R-24 and R-49. Terminal: no further state is ever written, so the fold
      // is over rather than merely uninteresting.
      return { steps, endedOn: null, endedAfterPass: sawPass };
    }
  }

  return { steps, endedOn: null, endedAfterPass: sawPass };
}

const sequences = (plan: ResolvedPlan): fc.Arbitrary<DaySequence> =>
  daySequenceArbitrary({ plan: materializedFrom(plan) });

// -----------------------------------------------------------------------------
// RE-P-01
// -----------------------------------------------------------------------------

describe('RE-P-01: the floor never decreases, except at the R-31 funded reset (INV-06, ADR-050)', () => {
  test("the projection carries the fold's own plan, so the marks and the engine agree", () => {
    // The two fields `chainMarks` reads. A drift in either makes every fold end
    // on an INV-20 or an R-09 disagreement, which reads as "the engine is
    // wrong" when the truth is "the generator was handed a different plan".
    for (const [name, plan] of LINEUP) {
      const materialized = materializedFrom(plan);
      expect(BigInt(materialized.size_cents), `${name}: size_cents`).toBe(plan.sizeCents);
      expect(
        BigInt(materialized.phase_funded.win_days.win_day_floor_cents),
        `${name}: win_day_floor_cents`,
      ).toBe(plan.funded.winDayFloorCents);
    }
  });

  test.each(LINEUP.map(([name, plan]) => [name, plan] as const))(
    'RE-P-01, %s: floor(d+1) >= floor(d) on every step that is not an R-31 pass',
    (name: string, plan: ResolvedPlan) => {
      fc.assert(
        fc.property(sequences(plan), fc.boolean(), (seq, withSettlements) => {
          for (const step of fold(plan, seq, withSettlements).steps) {
            if (step.passed) continue;
            expect(
              step.floorAfterCents >= step.floorBeforeCents,
              `${name}: the floor fell from ${String(step.floorBeforeCents)} to ` +
                `${String(step.floorAfterCents)} on ${step.tradingDay}, which emitted no ` +
                `phase.passed, so ADR-050's only exception does not cover it: ` +
                JSON.stringify(step, (_k, v: unknown) => (typeof v === 'bigint' ? `${v}n` : v)),
            ).toBe(true);
          }
        }),
        { numRuns: RUNS },
      );
    },
  );

  test.each(LINEUP.map(([name, plan]) => [name, plan] as const))(
    'RE-P-01, %s: at the R-31 pass the floor is size_cents - funded drawdown EXACTLY',
    (name: string, plan: ResolvedPlan) => {
      const expected = fundedResetFloorCents(plan);

      fc.assert(
        fc.property(sequences(plan), fc.boolean(), (seq, withSettlements) => {
          for (const step of fold(plan, seq, withSettlements).steps) {
            if (!step.passed) continue;
            // R-12, R-31, GS-019. The exception is STATED, so the value it
            // permits is stated too: a pass day that landed anywhere else would
            // be an exception wider than the one ADR-050 rules, which is the
            // unstated exception INV-06 forbids.
            expect(
              step.floorAfterCents,
              `${name}: the R-31 reset put the floor at ${String(step.floorAfterCents)} on ` +
                `${step.tradingDay}, and R-12, R-31 and GS-019 all say ${String(expected)}`,
            ).toBe(expected);
            expect(step.phaseAfter, `${name}: phase.passed without a funded phase`).toBe('funded');
          }
        }),
        { numRuns: RUNS },
      );
    },
  );
});

// -----------------------------------------------------------------------------
// The support, measured rather than assumed
// -----------------------------------------------------------------------------
// EVERY ASSERTION ABOVE IS GUARDED BY `if (step.passed)` OR `if (!step.passed)`,
// so a fold that never passed satisfies both directions vacuously. The pass is
// the rarest thing this file needs, it is the entire subject of ADR-050, and it
// is reached by a generator that does not know it exists. That has to be
// measured or the property is `expect(true).toBe(true)` with citations.

describe('the support reaches the cases RE-P-01 is about', () => {
  interface Seen {
    steps: number;
    passes: number;
    passesThatLoweredTheFloor: number;
    floorRose: number;
    floorHeld: number;
    settlementsApplied: number;
    settledStepsWithAnUnchangedFloor: number;
    lockedFloors: number;
    foldEndedAfterAPass: number;
    terminal: number;
  }

  const seen: Seen = {
    steps: 0,
    passes: 0,
    passesThatLoweredTheFloor: 0,
    floorRose: 0,
    floorHeld: 0,
    settlementsApplied: 0,
    settledStepsWithAnUnchangedFloor: 0,
    lockedFloors: 0,
    foldEndedAfterAPass: 0,
    terminal: 0,
  };

  // ONE SAMPLING PASS OVER THE WHOLE LINEUP FEEDS EVERY ASSERTION BELOW.
  // Re-drawing per assertion would measure a different population each time.
  //
  // IT RUNS IN `beforeAll` AND NOT AT MODULE LEVEL, WHICH IS A DEFECT THIS FILE
  // SHIPPED WITH FOR ONE FALSIFICATION RUN. `day-sequence.property.test.ts`
  // samples at module level and is right to: its generator calls no engine code
  // and nothing it does can throw. This pass FOLDS, so R-14's DO-7 tripwire can
  // throw `EngineInvariantError` inside it, and at module level that throw lands
  // during COLLECTION: vitest reports "0 test" for the file and every test named
  // RE-P-01 never runs. `CI-02/engine-RE-P-01-monotone` caught exactly that and
  // was scored FAILED OFF-TARGET, which is the harness doing its job on this
  // file rather than on the engine.
  beforeAll(() => {
    for (const [, plan] of LINEUP) {
      fc.assert(
        fc.property(sequences(plan), fc.boolean(), (seq, withSettlements) => {
          const result = fold(plan, seq, withSettlements);
          if (result.endedAfterPass) seen.foldEndedAfterAPass++;

          for (const step of result.steps) {
            seen.steps++;
            if (step.passed) {
              seen.passes++;
              if (step.floorAfterCents < step.floorBeforeCents) seen.passesThatLoweredTheFloor++;
            } else if (step.floorAfterCents > step.floorBeforeCents) seen.floorRose++;
            else seen.floorHeld++;

            if (step.settled) {
              seen.settlementsApplied++;
              // R-19 and ADR-014: a settled payout reduces the balance and changes
              // nothing else about the floor. A settlement day that also passed or
              // trailed is not a counterexample to that, so only the steps where
              // the floor is unchanged are counted, and the count only has to be
              // non-zero for the case to be reached.
              if (step.floorAfterCents === step.floorBeforeCents) {
                seen.settledStepsWithAnUnchangedFloor++;
              }
            }
            if (step.phaseAfter === 'closed' || step.phaseAfter === 'graduated') seen.terminal++;
            if (step.lockedAfter) seen.lockedFloors++;
          }
        }),
        { numRuns: REACHABILITY },
      );
    }
  });

  test('the fold reaches the R-31 pass, which every assertion above is guarded on', () => {
    expect(seen.steps).toBeGreaterThan(0);
    expect(seen.passes).toBeGreaterThan(0);
  });

  test('the exception is not decorative: a pass is watched LOWERING the floor', () => {
    // If no generated pass ever lowered the floor, ADR-050 would be ruling on a
    // case that does not occur and the `if (step.passed) continue` above would
    // be excusing nothing. On the v1 lineup the pass day is also a lock day, so
    // the eval floor is 5,010,000c and the funded reset is 4,750,000c: a fall of
    // 260,000c on the account's best day.
    expect(seen.passesThatLoweredTheFloor).toBeGreaterThan(0);
  });

  test('the floor is watched RISING, so the monotone half has something to bind on', () => {
    // A fold in which the floor never moved would satisfy `>=` forever. R-13's
    // trail is what makes it move, and a generator that stopped drawing new
    // closing highs would make the monotone half vacuous without failing.
    expect(seen.floorRose).toBeGreaterThan(0);
    expect(seen.floorHeld).toBeGreaterThan(0);
  });

  test('the floor lock is reached, so the step that used to lower it is exercised', () => {
    // The R-15 defect session 45 found lowered the floor at the lock, on every
    // eval pass in the lineup. This property would catch that today, and it can
    // only do so if the lock is reached.
    //
    // THE MEASURE IS `floorLocked` AND NOT A FLOOR VALUE, which is the first
    // version of this assertion and it failed on every seed. `floor_lock_floor_
    // at_cents` is 5,010,000c on the lineup and the floor at the lock is
    // section 3.4's `max(trailed, locked)`, so on any day that JUMPS past the
    // 260,000c trigger the floor is the trailed value and the literal never
    // appears. Counting the literal measured "the lock engaged exactly on its
    // trigger", which is the one case CV-12 makes uninteresting.
    expect(seen.lockedFloors).toBeGreaterThan(0);
  });

  test('settlements are applied, which is RE-P-01\'s "including settlements" clause', () => {
    expect(seen.settlementsApplied).toBeGreaterThan(0);
    expect(seen.settledStepsWithAnUnchangedFloor).toBeGreaterThan(0);
  });

  test('a terminal state is reached, so the fold is watched stopping for a ruled reason', () => {
    // R-24's breach and R-49's graduation. Neither is RE-P-01's subject; both
    // are ways the fold ends, and a fold that never reached one would mean the
    // generator drives no account to either edge.
    expect(seen.terminal).toBeGreaterThan(0);
  });

  test('the fold is watched ending after a pass, which is the DO-3 refusal in the header', () => {
    // Stated in the header as a consequence of the generator chaining balances
    // through a reset it knows nothing about. Asserted here so that a future
    // change making the post-pass day foldable is a red test rather than a
    // silent widening of what this property covers.
    expect(seen.foldEndedAfterAPass).toBeGreaterThan(0);
  });
});
