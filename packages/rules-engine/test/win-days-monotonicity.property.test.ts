// =============================================================================
// packages/rules-engine/test/win-days-monotonicity.property.test.ts
// =============================================================================
// PT-02, STRATEGY section 3.1, in the row's own words:
//
//   Win days never decrease EXCEPT at a payout reset, and at a reset they go to
//   exactly zero.
//
// with the note that decides how this file is built: "THE EXCEPTION IS THE WHOLE
// PROPERTY. A generator that never settles proves nothing about R-47." So the
// generator settles, the settlements are measured settling, and the reset is
// asserted at the value R-47 states rather than merely excused.
//
// -----------------------------------------------------------------------------
// THE FINDING: PT-02's ROW NAMES ONE EXCEPTION AND THE ENGINE HAS TWO
// -----------------------------------------------------------------------------
// `src/day/progression.ts` zeroes `winDaysCount` inside `passedState` at the
// R-31 funded reset. So a `phase.passed` day decreases the count too, on any
// plan with an evaluation phase, and PT-02's sentence does not mention it.
//
// THIS IS ADR-050's SHAPE ONE PROPERTY OVER. RE-P-01 met the same thing on the
// floor: the row said "never decreases", R-31 decreased it, and the answer was
// to state the exception and make the assertion at that step STRICTER rather
// than to skip the step. ADR-050 is the ruling that did it. PT-02 has no such
// ruling yet, so this file does three things and no more:
//
//   1. the guard names BOTH exceptions, so the property is true of the engine
//      that exists rather than of the sentence
//   2. the R-31 step is pinned to EXACTLY zero, in `describe` two below, so the
//      second exception is asserted and not excused
//   3. the gap is REPORTED, here, in the session log and in the pull request.
//      It is not fixed here: PT-02's row lives in a FROZEN document and a frozen
//      document moves by ADR, never by commit
//
// THE GUARD IS WHY THIS MATTERS RATHER THAN BEING A FOOTNOTE. The default fold
// starts FUNDED, where R-31 cannot fire, so a guard naming only the payout reset
// would be correct today by accident of the fixture. The next session to fold
// from `prior: null` would get a red suite and a counterexample that describes
// nothing wrong, and the cheapest way out of that is to delete the finding. The
// two-exception list IS the finding, and it is written into the guard so that
// nobody has to rediscover it under time pressure.
//
// -----------------------------------------------------------------------------
// WHAT "EXACTLY ZERO" IS ASSERTED AGAINST, AND WHY IT IS TWO ASSERTIONS
// -----------------------------------------------------------------------------
// R-47's reset happens at DO-2, INSIDE `applySettlement`, and DO-6 then advances
// the day's own counters from the post-settlement state. So the count on the
// stored row after a settlement day is NOT zero: it is zero plus today's win
// day, which is R-47's fairness clause in code ("progress earned during the
// transfer window is KEPT, because it happened after the snapshot the payout was
// based on").
//
// Asserting only the stored row would therefore accept a reset that zeroed
// nothing on a day the trader also won. Asserting only the function would accept
// a DO-6 that confiscated the day's own win. So both are asserted:
//
//   at the function  `applySettlement` is re-run on the state DO-2 was handed,
//                    and its output count must be EXACTLY 0
//   at the day       the stored count must be EXACTLY `winDayToday ? 1 : 0`,
//                    with `winDayToday` re-derived from R-09 and R-04 rather
//                    than read back off the engine
//
// A mutant that zeroes too little fails the first; one that zeroes too much
// fails the second.
//
// TWO ORDERING LAWS TAKE A DAY OUT BEFORE DO-6, AND THE SECOND ASSERTION HAS TO
// NAME THEM. This was found by writing the equality without them and watching it
// go red on a real sequence rather than by reasoning about it. R-25 is "breach
// beats everything on the same day" and DO-5's row reads "nothing after this
// runs", so a settlement day that also breached stores the count DO-2 left and
// never counts the day's own win. R-49's graduation returns at DO-2 for the same
// reason in M01's own words, "no trading day follows". On both the stored count
// is EXACTLY zero, which is a stricter assertion than the general one rather
// than an escape from it, and `reachedCounters` is what tells them apart.
//
// -----------------------------------------------------------------------------
// A SECOND FINDING, FOUND THE SAME WAY: THE MARK'S COLUMN AND R-09 ARE NOT THE
// SAME PREDICATE
// -----------------------------------------------------------------------------
// The day-level equality was first written against the generated mark's
// `winDay` COLUMN and went red. The column carries `0014`'s
// `daily_marks_win_day_implies_traded` as well as R-09, so `day-sequence.ts`
// writes it as `tradedDay && clearsFloor`. R-09 as M01 section 3.5 states it,
// and as `src/day/counters.ts` implements it, is `realized_pnl_cents >=
// win_day_floor_cents` with R-04's halted clause AND NO TRADED-DAY CLAUSE.
//
// So on a day with ZERO FILLS whose realized pnl clears the floor, the stored
// column says `false` and the engine counts a win day. The engine follows M01
// and is not wrong here; what is unasserted anywhere is that the two agree, and
// they do not. This property derives from M01's expression, which is the primary
// source, and MEASURES the disagreement in the support block below so the
// finding is a live number rather than a sentence. It is reported and not fixed:
// closing it is a rule question for a session that holds the fence on `0014` or
// on `counters.ts`.
// =============================================================================

import fc from 'fast-check';
import { beforeAll, describe, expect, test } from 'vitest';

import { applySettlement, type ResolvedPlan } from '../src/index.ts';
import { CORE_50K, MERIT_RAPID_50K } from './fixtures-in-code.ts';
import { materializedFrom } from './generator-bridge.ts';
import { foldSettlements, settlementFoldArbitrary } from './settlement-fold.ts';

// Enough runs that a settlement, a reset over a POSITIVE count and an eval pass
// are each visited many times over. `REACHABILITY` below is what turns that from
// an assumption into a measurement, and it is sized larger for PT-01's reason:
// the rarest case here is a conjunction, and a check that passes on a lucky seed
// is how a real check gets reclassified as flaky and deleted.
const RUNS = 300;
const REACHABILITY = 1_500;

/**
 * THE REACHABILITY SAMPLE IS SEEDED AND THE PROPERTIES ABOVE ARE NOT.
 *
 * The block below asserts COUNTS -- that a case is REACHED -- and its rarest is
 * a conjunction: a settlement day that ALSO graduated (`resetsThatGraduated`)
 * needs `R-49` to fire on the same day a reset lands. An unseeded sample makes
 * that a coin flip, and it came up zero on CI for PR #145, a docs-only change,
 * which is the one failure mode that teaches a reader to re-run instead of to
 * read. This file's own line 108 anticipated it: "the rarest case here is a
 * conjunction, and a check that passes on a lucky seed".
 *
 * The seed is arbitrary and fixed. The PROPERTIES still draw fresh cases on
 * every run, because they assert a law rather than a census. This is the idiom
 * `engine-eligible-conjunction.property.test.ts` established at its own
 * `REACHABILITY_SEED`.
 */
const REACHABILITY_SEED = 20_260_820;

// -----------------------------------------------------------------------------
// The lineup
// -----------------------------------------------------------------------------
// Both plans come from `fixtures-in-code.ts`, which transcribes M01 Appendix A
// and cites every number beside itself. NO PARAMETER IS INVENTED, and in
// particular no variant was built to make a fold survive longer: a property
// driven to reach a case by widening a drawdown is a property reporting on a
// plan nobody sells.
const LINEUP: ReadonlyArray<readonly [string, ResolvedPlan]> = [
  ['CORE-50K', CORE_50K],
  ['MERIT-RAPID-50K', MERIT_RAPID_50K],
];

const CASES = LINEUP.map(([name, plan]) => [name, plan] as const);

const show = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? `${x}n` : x));

// -----------------------------------------------------------------------------
// PT-02
// -----------------------------------------------------------------------------

describe('PT-02: win days never decrease except at a payout reset (R-47)', () => {
  test("the projection carries the fold's own plan, so the marks and the engine agree", () => {
    // `chainMarks` reads `size_cents` for INV-20 and `win_day_floor_cents` for
    // R-09's `win_day` column, and THIS PROPERTY READS THAT COLUMN. A drift in
    // the second would make `winDayToday` describe a different plan from the one
    // the engine counted against, and every reset-day equality below would fail
    // for a reason that has nothing to do with R-47.
    for (const [name, plan] of CASES) {
      const materialized = materializedFrom(plan);
      expect(BigInt(materialized.size_cents), `${name}: size_cents`).toBe(plan.sizeCents);
      expect(
        BigInt(materialized.phase_funded.win_days.win_day_floor_cents),
        `${name}: win_day_floor_cents`,
      ).toBe(plan.funded.winDayFloorCents);
    }
  });

  test.each(CASES)(
    'PT-02, %s: the count never falls on a step that is neither reset nor R-31 pass',
    (name: string, plan: ResolvedPlan) => {
      fc.assert(
        fc.property(settlementFoldArbitrary(plan), (seq) => {
          for (const step of foldSettlements(plan, seq).steps) {
            // BOTH EXCEPTIONS ARE NAMED HERE AND THAT IS THE FINDING, not a
            // widened guard. `step.passed` cannot fire on this fold, which
            // starts funded; it is named anyway so that the day someone folds
            // this from `prior: null` the guard is already true, rather than
            // going red on the engine's own documented arithmetic and inviting
            // the finding to be deleted to get green.
            if (step.reset || step.passed) continue;
            expect(
              step.winDaysAfter >= step.winDaysBefore,
              `${name}: the win-day count fell from ${String(step.winDaysBefore)} to ` +
                `${String(step.winDaysAfter)} on ${step.tradingDay}, which emitted neither ` +
                `payout.win_days_reset nor phase.passed, so neither R-47 nor R-31 covers it: ` +
                show(step),
            ).toBe(true);
          }
        }),
        { numRuns: RUNS },
      );
    },
  );

  test.each(CASES)(
    'PT-02, %s: at the reset applySettlement puts the count at EXACTLY zero',
    (name: string, plan: ResolvedPlan) => {
      fc.assert(
        fc.property(settlementFoldArbitrary(plan), (seq) => {
          const fold = foldSettlements(plan, seq);
          for (const step of fold.steps) {
            if (!step.reset) continue;

            // R-47 lives at DO-2, so it is asserted at DO-2. `applySettlement`
            // is re-run on the state the fold handed it, in the same ordinal
            // order the engine sorted, with the fourth argument ADR-049
            // authorises: R-47 starts the new consistency period on the trading
            // day AFTER the basis day and that is not computable from one row.
            let state = step.stateBefore;
            for (const fact of step.applied) {
              const out = applySettlement(state, plan, fact, fold.calendar);
              expect(
                out.assertions,
                `${name}: DO-2 applied ${fact.payoutRequestId} on ${step.tradingDay} and a ` +
                  `direct re-run refused it: ${show(out.assertions)}`,
              ).toHaveLength(0);
              expect(
                out.state.winDaysCount,
                `${name}: R-47 says the counter goes to zero, and settling ` +
                  `${fact.payoutRequestId} on ${step.tradingDay} left it at ` +
                  `${String(out.state.winDaysCount)}: ${show(step)}`,
              ).toBe(0);
              state = out.state;
            }
          }
        }),
        { numRuns: RUNS },
      );
    },
  );

  test.each(CASES)(
    "PT-02, %s: the stored row after a reset is EXACTLY the day's own win day",
    (name: string, plan: ResolvedPlan) => {
      fc.assert(
        fc.property(settlementFoldArbitrary(plan), (seq) => {
          for (const step of foldSettlements(plan, seq).steps) {
            if (!step.reset) continue;
            // R-47's fairness clause, which is the half that gets lost: DO-2
            // resets and DO-6 then counts TODAY, so the stored row is zero plus
            // today's win day and never the prior count. `winDayToday` is R-09
            // with R-04 re-derived from the mark and the calendar.
            // R-25 and R-49 above: on a day that breached or graduated, DO-6
            // never ran, so the stored count is the zero DO-2 left and the
            // day's own win day is not on the row. Still an exact number, and a
            // smaller one.
            const expected = step.reachedCounters && step.winDayToday ? 1 : 0;
            expect(
              step.winDaysAfter,
              `${name}: ${step.tradingDay} settled and closed at ` +
                `${String(step.winDaysAfter)} win days, and R-47 with DO-6 says ` +
                `${String(expected)}: the reset is exactly zero, and the day's own win day is ` +
                `KEPT when the day reached DO-6 (reachedCounters=` +
                `${String(step.reachedCounters)}) because it happened after the snapshot the ` +
                `payout was based on: ` +
                show(step),
            ).toBe(expected);
          }
        }),
        { numRuns: RUNS },
      );
    },
  );

  test.each(CASES)(
    'PT-02, %s: the emitted event cannot disagree with the state it describes',
    (name: string, plan: ResolvedPlan) => {
      // `payout.win_days_reset` carries `previousCount` and `resetTo`, and both
      // are read by the portal and the evidence pack. An event whose `resetTo`
      // said zero while the state carried something else would be a transparency
      // surface describing a row that does not exist.
      fc.assert(
        fc.property(settlementFoldArbitrary(plan), (seq) => {
          const fold = foldSettlements(plan, seq);
          for (const step of fold.steps) {
            if (!step.reset) continue;
            let state = step.stateBefore;
            for (const fact of step.applied) {
              const out = applySettlement(state, plan, fact, fold.calendar);
              const events = out.events.filter((e) => e.type === 'payout.win_days_reset');
              expect(
                events,
                `${name}: one settlement emits exactly one reset event: ${show(out.events)}`,
              ).toHaveLength(1);
              const event = events[0]!;
              if (event.type !== 'payout.win_days_reset') throw new Error('unreachable');
              expect(
                event.previousCount,
                `${name}: the event on ${step.tradingDay} reports a previous count of ` +
                  `${String(event.previousCount)} against a state carrying ` +
                  `${String(state.winDaysCount)}`,
              ).toBe(state.winDaysCount);
              expect(
                event.resetTo,
                `${name}: the event on ${step.tradingDay} reports resetTo ` +
                  `${String(event.resetTo)} and R-47 says zero`,
              ).toBe(0);
              expect(
                event.resetTo,
                `${name}: the event and the state it describes disagree on ${step.tradingDay}`,
              ).toBe(out.state.winDaysCount);
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
// The second exception, asserted rather than excused
// -----------------------------------------------------------------------------

describe('R-31 is a SECOND win-days reset and PT-02s row does not name it', () => {
  test.each(CASES)(
    'R-31, %s: the funded reset puts the count at EXACTLY zero, not merely lower',
    (name: string, plan: ResolvedPlan) => {
      // The fold starts from `prior: null`, so `initialState` opens the account
      // in `eval` and an eval pass is reachable. ADR-050's discipline applied to
      // the counter instead of the floor: an exception that merely EXCUSED a
      // decrease here would let any decrease through on a pass day, which is the
      // unstated exception INV-06 exists to forbid.
      //
      // ZERO AND NOT `winDayToday ? 1 : 0`, WHICH IS THE OPPOSITE OF THE RESET
      // DAY ABOVE, and the ordering is why: DO-6 counts the day and DO-8 then
      // runs the progression, so R-31's reset lands AFTER the day's own win day
      // and wipes it. R-47's reset lands BEFORE it, at DO-2, and keeps it. The
      // two rules zero the same field at opposite ends of the same day.
      fc.assert(
        fc.property(settlementFoldArbitrary(plan), (seq) => {
          for (const step of foldSettlements(plan, seq, { evalStart: true }).steps) {
            if (!step.passed) continue;
            expect(
              step.winDaysAfter,
              `${name}: the R-31 reset left ${String(step.winDaysAfter)} win days on ` +
                `${step.tradingDay}, and progression.ts sets the counter to zero inside ` +
                `passedState: ${show(step)}`,
            ).toBe(0);
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
// EVERY ASSERTION ABOVE IS GUARDED BY `if (step.reset)`, `if (!step.reset)` OR
// `if (step.passed)`, so a fold that never settled satisfies all of them
// vacuously. PT-02's row says so in as many words. That has to be measured or
// the property is `expect(true).toBe(true)` with citations.
//
// EVERY COUNTER BELOW IS ASSERTED `> 0` AND NEVER AGAINST A BAND. The figures
// one sampling run produces are one run of a randomized generator; a band copied
// out of it is a hand-maintained count in a file whose whole purpose is to end
// hand-maintained counts, and it goes red on an unlucky seed for no defect. What
// is asserted is that the case is REACHED. What was observed is reported in the
// pull request body, where a number that ages is a note rather than a gate.

describe('the support reaches the cases PT-02 is about', () => {
  interface Seen {
    steps: number;
    resets: number;
    resetsOverAPositiveCount: number;
    resetsOnADayThatAlsoWon: number;
    resetsThatAlsoBreached: number;
    resetsThatGraduated: number;
    untradedDaysTheRuleCountedAndTheColumnDidNot: number;
    winDaysRose: number;
    winDaysHeld: number;
    passes: number;
    passesOverAPositiveCount: number;
    terminal: number;
  }

  const seen: Seen = {
    steps: 0,
    resets: 0,
    resetsOverAPositiveCount: 0,
    resetsOnADayThatAlsoWon: 0,
    resetsThatAlsoBreached: 0,
    resetsThatGraduated: 0,
    untradedDaysTheRuleCountedAndTheColumnDidNot: 0,
    winDaysRose: 0,
    winDaysHeld: 0,
    passes: 0,
    passesOverAPositiveCount: 0,
    terminal: 0,
  };

  // ONE SAMPLING PASS OVER THE WHOLE LINEUP FEEDS EVERY ASSERTION BELOW.
  // Re-drawing per assertion would measure a different population each time.
  //
  // IT RUNS IN `beforeAll` AND NOT AT MODULE LEVEL, which is the defect PT-01's
  // file shipped with for one falsification run: this pass FOLDS, R-14's DO-7
  // tripwire can throw `EngineInvariantError` inside it, and at module level
  // that throw lands during COLLECTION, so vitest reports "0 test" for the file
  // and every named assertion above never runs.
  beforeAll(() => {
    for (const [, plan] of CASES) {
      for (const evalStart of [false, true]) {
        fc.assert(
          fc.property(settlementFoldArbitrary(plan), (seq) => {
            for (const step of foldSettlements(plan, seq, { evalStart }).steps) {
              seen.steps++;
              if (step.reset) {
                seen.resets++;
                if (step.winDaysBefore > 0) seen.resetsOverAPositiveCount++;
                if (step.winDayToday && step.reachedCounters) seen.resetsOnADayThatAlsoWon++;
                if (step.breached) seen.resetsThatAlsoBreached++;
                if (step.graduated) seen.resetsThatGraduated++;
              } else if (step.passed) {
                seen.passes++;
                if (step.winDaysBefore > 0 || step.winDayToday) seen.passesOverAPositiveCount++;
              } else if (step.winDaysAfter > step.winDaysBefore) seen.winDaysRose++;
              else seen.winDaysHeld++;

              if (step.winDayToday && !step.winDayColumn) {
                seen.untradedDaysTheRuleCountedAndTheColumnDidNot++;
              }
              if (step.phaseAfter === 'closed' || step.phaseAfter === 'graduated') seen.terminal++;
            }
          }),
          { numRuns: REACHABILITY, seed: REACHABILITY_SEED },
        );
      }
    }
  });

  test('the fold settles, which PT-02s row says a generator must do', () => {
    expect(seen.steps).toBeGreaterThan(0);
    expect(seen.resets).toBeGreaterThan(0);
  });

  test('the exception is not decorative: a reset is watched over a POSITIVE count', () => {
    // A reset of a counter that was already zero decreases nothing, so a run in
    // which every reset landed on a zero count would satisfy the exception
    // without ever exercising it. This is the counter that says R-47 removed
    // something a trader had earned.
    expect(seen.resetsOverAPositiveCount).toBeGreaterThan(0);
  });

  test("R-47's fairness clause is reached: a settlement day that ALSO won", () => {
    // The day-level equality is `winDayToday ? 1 : 0`, and its interesting half
    // is the `1`. If no settlement ever landed on a day the trader also won, the
    // equality would only ever be asserted at zero and a DO-6 that confiscated
    // the day's own win would pass.
    expect(seen.resetsOnADayThatAlsoWon).toBeGreaterThan(0);
  });

  test('both DO-6 bypasses are reached, so the exact-zero branch is exercised', () => {
    // R-25's breach and R-49's graduation, on a day that also settled. Without
    // these the `reachedCounters` branch of the equality above would never be
    // taken and a mutant living inside it would survive.
    expect(seen.resetsThatAlsoBreached).toBeGreaterThan(0);
    expect(seen.resetsThatGraduated).toBeGreaterThan(0);
  });

  test('the count is watched RISING, so the monotone half has something to bind on', () => {
    // A fold in which the counter never moved would satisfy `>=` forever. R-09
    // is what makes it move, and a generator that stopped drawing days at or
    // above the win-day floor would make the monotone half vacuous without
    // failing.
    expect(seen.winDaysRose).toBeGreaterThan(0);
    expect(seen.winDaysHeld).toBeGreaterThan(0);
  });

  test('the R-31 pass is reached, and over a count it actually removes', () => {
    // The second exception. If it were unreachable, the `describe` above would
    // be ruling on a case that does not occur and the finding in this file's
    // header would be a claim rather than a measurement.
    expect(seen.passes).toBeGreaterThan(0);
    expect(seen.passesOverAPositiveCount).toBeGreaterThan(0);
  });

  test("R-09 and the mark's win_day COLUMN are watched disagreeing", () => {
    // The second finding in this file's header, measured rather than asserted in
    // prose. `winDayToday` is M01 R-09's expression; `winDayColumn` is what
    // `0014`'s `daily_marks_win_day_implies_traded` leaves on the row. A day
    // with zero fills whose pnl clears the floor separates them.
    //
    // THIS GOING RED IS INFORMATIVE IN BOTH DIRECTIONS. If R-09 ever gains a
    // traded-day clause, or the generator stops drawing pnl on an untraded day,
    // the disagreement disappears and the next reader is sent to this comment
    // rather than left to rediscover it.
    expect(seen.untradedDaysTheRuleCountedAndTheColumnDidNot).toBeGreaterThan(0);
  });

  test('a terminal state is reached, so the fold is watched stopping for a ruled reason', () => {
    // R-24's breach and R-49's graduation. Neither is PT-02's subject; both are
    // ways the fold ends, and a fold that never reached one would mean the
    // generator drives no account to either edge.
    expect(seen.terminal).toBeGreaterThan(0);
  });
});
