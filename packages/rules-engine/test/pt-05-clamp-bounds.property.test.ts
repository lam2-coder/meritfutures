// =============================================================================
// packages/rules-engine/test/pt-05-clamp-bounds.property.test.ts
// =============================================================================
// PT-05, from STRATEGY section 5.1's table:
//
//   `approved_cents <= cap_cents_for_ordinal` AND
//   `approved_cents <= withdrawable_cents`, and the result is
//   `>= min_payout_cents` OR THE REQUEST IS NOT ELIGIBLE.
//
// STRATEGY calls it "ADR-009's clamp order, asserted as an INEQUALITY rather
// than as a SEQUENCE OF STEPS", and that distinction is the whole design. A
// test that re-walks `min(min(request, cap), withdrawable)` in the same order
// the implementation walks it is the implementation talking to itself, which is
// C10's self-grading trap. Every assertion below is an inequality between values
// that arrive from different places.
//
// -----------------------------------------------------------------------------
// THE ENTRY POINT IS `evaluatePayout`, AND `clampPayout` STAYS UNEXPORTED
// -----------------------------------------------------------------------------
// M01 disagrees with itself about `clampPayout`: section 3.6's reference
// algorithm writes `export function clampPayout` and section 1.3's "nothing else
// is exported" does not list it among the six. SECTION 1.3 WINS, reasoned at
// `src/index.ts` and again at the head of `clamp.ts`, so the clamp is reachable
// only through `evaluatePayout` -- the function M01 section 4 names for BOTH
// payout endpoints, which is what makes "the identical function with the
// identical inputs" true rather than aspirational.
//
// Exporting the clamp to make this file easier would be weakening a boundary in
// order to pass it. Section 9 forbids it and nothing here does it.
//
// -----------------------------------------------------------------------------
// WHY EVERY STATE IS FOLDED AND NONE IS HAND-BUILT
// -----------------------------------------------------------------------------
// `evaluatePayout` READS `state.engineGates` rather than recomputing it, because
// R-06 requires every evaluation to be against the last closed day. So a
// hand-assembled `RuleState` carrying `engineEligible: true` beside a tiny
// withdrawable would falsify clause 3 immediately -- and it would be a GENERATOR
// ARTIFACT rather than an engine defect, which is the worst outcome available to
// a property suite. Every state asserted on below came out of `advanceDay`.
// =============================================================================

import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import { advanceDay, buildCalendarSlice, evaluatePayout } from '../src/index.js';
import type {
  AccountStatus,
  CalendarSlice,
  Cents,
  DailyMark,
  KycState,
  PayoutContext,
  ResolvedPlan,
  RuleState,
  TradingDay,
} from '../src/index.js';
import {
  ACCOUNT_OPENED_ON,
  ENGINE_VERSION,
  MERIT_RAPID_50K,
  CORE_50K,
  day,
  fundedPrior,
  mark,
} from './fixtures-in-code.js';
import { daySequenceArbitrary } from './generators/day-sequence.js';
import type { DaySequence, DailyMark as GeneratedMark } from './generators/day-input.js';
import type { MaterializedPlan } from './generators/plan-config.js';

// -----------------------------------------------------------------------------
// R-42, RE-DERIVED FROM PLAN DATA RATHER THAN FROM `capForOrdinal`
// -----------------------------------------------------------------------------
// Clause 1 on its own is self-grading on the cap: `approved <= capCents` holds
// trivially if the clamp reports its own wrong cap. So the cap the evaluation
// REPORTS is separately checked against the cap the PLAN states, read straight
// off `payoutCapSchedule` by R-42's own words -- "the `cap_cents` of the LAST
// schedule entry whose `from_ordinal <= ordinal`". That splits one assertion
// into two questions that can fail independently: does the clamp respect its
// cap, and is that cap the right cap.
function capFromPlanSchedule(plan: ResolvedPlan, ordinal: number): Cents {
  let cap: Cents | null = null;
  for (const step of plan.funded.payoutCapSchedule) {
    if (step.fromOrdinal <= ordinal) cap = step.capCents;
  }
  if (cap === null) throw new Error(`no cap schedule step covers ordinal ${String(ordinal)}`);
  return cap;
}

// -----------------------------------------------------------------------------
// PT-05 ITSELF: three clauses, and one of them proves less than it looks like
// -----------------------------------------------------------------------------

interface Outcome {
  readonly eligible: boolean;
  readonly approvedCents: Cents;
}

/**
 * Assert PT-05 against one evaluation. Returns what it saw, so the caller can
 * prove both sides of the disjunction were reached.
 */
function assertPt05(state: RuleState, plan: ResolvedPlan, ctx: PayoutContext): Outcome {
  const evaluation = evaluatePayout(state, plan, ctx);
  const approved = evaluation.clamp.approvedCents;

  // CLAUSE 1  `approved_cents <= cap_cents_for_ordinal`
  expect(approved <= evaluation.capCents).toBe(true);

  // CLAUSE 1b  and that cap is the one the PLAN states for this ordinal.
  expect(evaluation.capCents).toBe(capFromPlanSchedule(plan, evaluation.ordinal));

  // CLAUSE 2  `approved_cents <= withdrawable_cents`, with the withdrawable read
  // off the INPUT STATE rather than off the evaluation, so the clamp cannot
  // satisfy this against a number it invented for itself.
  expect(approved <= state.withdrawableCents).toBe(true);

  // CLAUSE 3, AND IT PROVES LESS THAN ITS WORDING SUGGESTS. Stated honestly
  // because ADR-038 exists precisely because CI-03 claimed more than it proved,
  // and a property that overstates its reach is that defect in a new place.
  //
  // Read literally over `approvedCents`, "the result is >= min_payout_cents or
  // the request is not eligible" is a TAUTOLOGY here: `clamp.meetsMinimum` is
  // defined as `approvedCents >= plan.funded.minPayoutCents`, so a disjunction
  // phrased over it could never fail. GS-042 states the case that makes this
  // concrete and it is the corpus's own words: "a supplied `1` clamps to 1 and
  // FAILS THE MINIMUM GATE rather than paying 1 cent". A one-cent request on a
  // fully eligible account is correct behaviour, refused at request time.
  //
  // So the clause is asserted over `maxPayoutCents`, which M01 section 2.2
  // defines as "min(withdrawable, cap), 0 WHEN NOT ELIGIBLE".
  //
  // WHAT THAT ACTUALLY DETECTS IS DUPLICATION DRIFT, NOT AN INDEPENDENT CHECK.
  // `payable` is computed at two sites by the same formula over the same inputs:
  // `gates.ts` builds `capForOrdinal(funded, ordinalForNextPayout(state))` then
  // `withdrawable < cap ? withdrawable : cap` to feed `minimumAmount.pass`, and
  // `evaluate.ts` builds `clamp.capCents` (the same call) then the identical
  // ternary to feed `maxPayoutCents`. They are the SAME ARITHMETIC written
  // twice, so this clause cannot fail unless the two copies drift apart. That is
  // worth pinning -- two expressions of one concept agreeing until they don't is
  // the class OQ-P1-04 ruled -- but it is a drift detector and this comment
  // exists so no later reader mistakes it for a proof that R-39's gate and the
  // clamp were derived independently. They were not.
  if (evaluation.eligible) {
    expect(evaluation.maxPayoutCents >= evaluation.minPayoutCents).toBe(true);
  }

  return { eligible: evaluation.eligible, approvedCents: approved };
}

// -----------------------------------------------------------------------------
// The fold, in `floor-monotonicity.property.test.ts`'s shape
// -----------------------------------------------------------------------------
// THESE THREE HELPERS ARE COPIED RATHER THAN SHARED, AND THE FENCE IS WHY. This
// session may create new files under `test/` and may not edit existing ones,
// because sessions 62 and 63 are folding concurrently in this directory. Lifting
// `materializedFrom`, `toEngineMark` and `sliceOf` into a shared module would
// mean editing `floor-monotonicity.property.test.ts` to import it. Recorded so
// the duplication reads as a fence cost rather than as an oversight.

const toEngineMark = (m: GeneratedMark): DailyMark => ({
  tradingDay: m.tradingDay as TradingDay,
  openingBalanceCents: BigInt(m.openingBalanceCents),
  closingBalanceCents: BigInt(m.closingBalanceCents),
  highBalanceCents: BigInt(m.highBalanceCents),
  lowBalanceCents: BigInt(m.lowBalanceCents),
  realizedPnlCents: BigInt(m.realizedPnlCents),
  adjustmentCents: BigInt(m.adjustmentCents),
  fillCount: m.fillCount,
  sourceHash: m.sourceHash,
});

const sliceOf = (seq: DaySequence): CalendarSlice =>
  buildCalendarSlice({
    days: seq.calendar.days.map((d) => ({ ...d, tradingDay: d.tradingDay as TradingDay })),
    coverage: {
      from: seq.calendar.coverage.from as TradingDay,
      to: seq.calendar.coverage.to as TradingDay,
    },
  });

function materializedFrom(plan: ResolvedPlan): MaterializedPlan {
  const evalRules = plan.eval;
  if (evalRules === null) throw new Error('this property folds plans with an evaluation phase');

  const drawdown = (
    rules: ResolvedPlan['funded']['drawdown'],
  ): MaterializedPlan['phase_funded']['drawdown'] => ({
    type: rules.type,
    drawdown_cents: Number(rules.drawdownCents),
    lock: rules.lock.enabled
      ? {
          enabled: true,
          at_profit_cents: Number(rules.lock.atProfitCents),
          floor_at_cents: Number(rules.lock.floorAtCents),
        }
      : { enabled: false, at_profit_cents: null, floor_at_cents: null },
  });

  const limit = (
    rules: ResolvedPlan['funded']['dailyLossLimit'],
  ): MaterializedPlan['phase_funded']['daily_loss_limit'] =>
    rules.type === 'none'
      ? { type: 'none', amount_cents: null }
      : { type: rules.type, amount_cents: Number(rules.limitCents) };

  return {
    schema_version: 1,
    size_cents: Number(plan.sizeCents),
    phase_eval: {
      enabled: true,
      profit_target_cents: Number(evalRules.profitTargetCents),
      drawdown: drawdown(evalRules.drawdown),
      daily_loss_limit: limit(evalRules.dailyLossLimit),
      min_trading_days: evalRules.minTradingDays,
      consistency: evalRules.consistency.enabled
        ? {
            enabled: true,
            max_day_share_bp: Number(evalRules.consistency.maxDayShareBp),
            mode: 'pass_time_dilutable',
          }
        : { enabled: false, max_day_share_bp: null, mode: 'pass_time_dilutable' },
      max_days: evalRules.maxDays,
    },
    phase_funded: {
      drawdown: drawdown(plan.funded.drawdown),
      daily_loss_limit: limit(plan.funded.dailyLossLimit),
      min_trading_days: plan.funded.minTradingDays,
      win_days: {
        required_count: plan.funded.winDaysRequiredCount,
        win_day_floor_cents: Number(plan.funded.winDayFloorCents),
        reset_on_payout: true,
      },
      consistency: plan.funded.consistency.enabled
        ? {
            enabled: true,
            max_day_share_bp: Number(plan.funded.consistency.maxDayShareBp),
            mode: 'payout_gated',
          }
        : { enabled: false, max_day_share_bp: null, mode: 'payout_gated' },
      buffer_cents: Number(plan.funded.bufferCents),
      cadence_gap_trading_days: plan.funded.cadenceGapTradingDays,
      payout_cap_schedule: plan.funded.payoutCapSchedule.map((step) => ({
        from_ordinal: step.fromOrdinal,
        cap_cents: Number(step.capCents),
      })),
      min_payout_cents: Number(plan.funded.minPayoutCents),
      split_bp: Number(plan.funded.splitBp),
      max_payouts: plan.funded.maxPayouts,
      post_payout_floor_rule: { mode: 'none' },
    },
  };
}

/** Every state the engine wrote while folding a sequence. */
function foldStates(plan: ResolvedPlan, seq: DaySequence): readonly RuleState[] {
  const calendar = sliceOf(seq);
  const states: RuleState[] = [];
  let prior: RuleState | null = null;

  for (const generated of seq.marks) {
    const out = advanceDay({
      engineVersion: ENGINE_VERSION,
      plan,
      prior,
      mark: toEngineMark(generated),
      calendar,
      settlements: [],
      openedOn: ACCOUNT_OPENED_ON,
    });
    // A refused day writes no state, so there is nothing to evaluate and the
    // account's history stops here (DO-1 through DO-3).
    if (out.assertions.length > 0) return states;
    states.push(out.state);
    prior = out.state;
    if (out.state.phase === 'closed' || out.state.phase === 'graduated') return states;
  }
  return states;
}

// -----------------------------------------------------------------------------
// THE DIRECTED PATH, WHICH IS WHAT REACHES `eligible: true`
// -----------------------------------------------------------------------------
// A free random sequence almost never clears win days, the buffer, consistency
// and the minimum all at once, so a suite built only on `daySequenceArbitrary`
// would assert clause 3's antecedent-false branch forever and report green. This
// builds the other side: a funded account making steady profitable win days.
//
// EVERY THRESHOLD IS READ OFF THE PLAN rather than hardcoded, so the run reaches
// eligibility for reasons the plan states rather than for numbers this file
// happens to know. On MERIT-RAPID-50K that is 3 win days over a 15,000c floor,
// a 100,000c buffer and a 10,000c minimum, with consistency at 4000bp -- which
// four roughly equal days clear at 2500bp.
//
// The days are folded through `advanceDay` exactly as the free path is, so the
// states carry engine-computed gates and nothing here is hand-assembled.
// `CME_WINDOW` IS FIVE DAYS AND THAT IS NOT ENOUGH, WHICH THE SEEDED MUTANT IS
// WHAT PROVED. `fundedPrior` opens on its first day, leaving four foldable days,
// so the directed run topped out at 4 x 50,000c of profit: a withdrawable of
// exactly 100,000c against MERIT-RAPID's 100,000c cap. `approved <= cap` then
// holds by EQUALITY on every case, and a clamp with its cap term deleted passes
// the property unharmed. The window is widened here until the withdrawable can
// exceed the cap STRICTLY, because a bound that is only ever met at equality is
// a bound no test can see removed.
const LONG_WINDOW: CalendarSlice = buildCalendarSlice({
  days: Array.from({ length: 24 }, (_, i) => ({
    tradingDay: day(`2026-11-${String(i + 2).padStart(2, '0')}`),
    isHalfDay: false,
    halted: false,
    sequence: 4021 + i,
  })),
  coverage: { from: day('2026-11-02'), to: day('2026-11-25') },
});

function directedStates(plan: ResolvedPlan, pnls: readonly number[]): readonly RuleState[] {
  const states: RuleState[] = [];
  let prior: RuleState = fundedPrior(plan);
  let balance = prior.balanceCents;
  let at = 0;

  for (const pnl of pnls) {
    const tradingDay = LONG_WINDOW.days[at + 1]?.tradingDay;
    if (tradingDay === undefined) break;
    at += 1;
    const opening = balance;
    balance = opening + BigInt(pnl);

    const out = advanceDay({
      engineVersion: ENGINE_VERSION,
      plan,
      prior,
      mark: mark({
        tradingDay,
        openingBalanceCents: opening,
        realizedPnlCents: BigInt(pnl),
        fillCount: 2,
      }),
      calendar: LONG_WINDOW,
      settlements: [],
      openedOn: ACCOUNT_OPENED_ON,
    });
    if (out.assertions.length > 0) return states;
    states.push(out.state);
    prior = out.state;
    if (out.state.phase !== 'funded') return states;
  }
  return states;
}

// -----------------------------------------------------------------------------
// Context: the external gates and the requested amount
// -----------------------------------------------------------------------------
// `requestedCents: null` is ADR-009's "pay the maximum I am eligible for". A
// supplied amount is a CEILING, never an instruction, so the generator draws
// amounts far above and far below the cap as well as `null`.

const ctxArbitrary = (): fc.Arbitrary<PayoutContext> =>
  fc.record({
    gates: fc.record({
      accountStatus: fc.constantFrom<AccountStatus>(
        'active',
        'active',
        'active',
        'breached',
        'graduated',
      ),
      kycState: fc.constantFrom<KycState>(
        'verified',
        'verified',
        'verified',
        'pending',
        'rejected',
      ),
      payoutsFrozen: fc.oneof(fc.constant(false), fc.constant(false), fc.constant(true)),
      reconBlocked: fc.oneof(fc.constant(false), fc.constant(false), fc.constant(true)),
      hasPayoutInFlight: fc.oneof(fc.constant(false), fc.constant(false), fc.constant(true)),
    }),
    requestedCents: fc.oneof(
      fc.constant<Cents | null>(null),
      fc.integer({ min: 0, max: 400_000 }).map((n) => BigInt(n) as Cents),
    ),
  });

// -----------------------------------------------------------------------------

describe('PT-05  the clamp is bounded by the cap and the withdrawable', () => {
  // BOTH SIDES OF THE DISJUNCTION ARE COUNTED AND THE COUNTS ARE ASSERTED. A
  // property whose antecedent is never true reports green while testing nothing,
  // which is the failure this counter exists to make impossible.
  let sawEligible = 0;
  let sawIneligible = 0;

  const record = (o: Outcome): void => {
    if (o.eligible) sawEligible += 1;
    else sawIneligible += 1;
  };

  test('holds over freely generated day sequences', () => {
    for (const plan of [CORE_50K, MERIT_RAPID_50K]) {
      fc.assert(
        fc.property(
          daySequenceArbitrary({ plan: materializedFrom(plan) }),
          ctxArbitrary(),
          (seq, ctx) => {
            for (const state of foldStates(plan, seq)) record(assertPt05(state, plan, ctx));
          },
        ),
        { numRuns: 120 },
      );
    }
  });

  test('holds over a directed profitable run that REACHES eligibility', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 30_000, max: 50_000 }), { minLength: 4, maxLength: 20 }),
        ctxArbitrary(),
        (pnls, ctx) => {
          for (const state of directedStates(MERIT_RAPID_50K, pnls)) {
            record(assertPt05(state, MERIT_RAPID_50K, ctx));
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  test('both sides of the disjunction were reached', () => {
    // If either of these is zero the two properties above proved half of PT-05
    // and reported green, which is exactly what this assertion refuses to allow.
    expect(sawIneligible).toBeGreaterThan(0);
    expect(sawEligible).toBeGreaterThan(0);
  });
});
