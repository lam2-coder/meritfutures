// =============================================================================
// packages/rules-engine/src/day/progression.ts
// =============================================================================
// DO-8, THE EVAL HALF. M01 section 3.1: "Eval: test the pass condition and
// either pass (APPLYING THE FUNDED RESET IN THE SAME STEP) or defer."
//
//   R-26  `closing_balance_cents - size_cents >= profit_target_cents`   `>=`
//   R-27  `tradedDaysCount >= min_trading_days`                         `>=`
//   R-28  consistency is tested ONLY on days where R-26 and R-27 already hold,
//         and failing DEFERS the pass. It never fails an account
//   R-29  the cross multiplication, in `consistency.ts`
//   R-30  the denominator rule, in `consistency.ts`
//   R-31  the funded reset, applied in the same step as the pass
//
// R-32 REFUSES, AND THE COUNT IS THE POINT. See the block above the refusal.
//
// DO-8's FUNDED HALF IS NOT HERE AND IS NOT MISSING. Section 3.1: "Funded: test
// the ladder, which can also fire here if a settlement graduated the account."
// R-49 fires only after a settlement, `applySettlement` is group H, and DO-2
// already refuses any day a settlement is effective on. So there is no funded
// day this file could have anything to say about, and a funded branch here
// would be a branch no input reaches.
//
// -----------------------------------------------------------------------------
// THE PASS TEST IS STATELESS AND IS RE-EVALUATED FROM SCRATCH EVERY DAY
// -----------------------------------------------------------------------------
// M01 section 3.2: `eval_target_pending` "is a real state and not a formality",
// and yet "the account can move back to `eval_open` implicitly if a losing day
// drops it under the target, and can return again; THIS IS NOT A STATE CHANGE
// WORTH DRAWING because the pass test is stateless and re-evaluated from scratch
// each day (R-26)."
//
// So nothing here records that a pass was deferred. A deferral emits an event
// and changes no field. A future session tempted to add `passDeferred: boolean`
// to `RuleState` should read that paragraph first: the flag would be a second,
// staler answer to a question the arithmetic already answers on every day.
// =============================================================================

import { nextTradingDayAfter } from '../calendar.js';
import type {
  AssertionFailure,
  CalendarSlice,
  DailyMark,
  EvalPhaseRules,
  PassDeferredConsistencyEvent,
  PhasePassedEvent,
  ResolvedPlan,
  RuleState,
} from '../types.js';
import { consistencyOk } from './consistency.js';
import { initialFloorCents } from './floor.js';

/**
 * What DO-8 did with an eval-phase day. Four outcomes and they are genuinely
 * four: nothing happened, the pass deferred, the pass fired, or the day refused.
 */
export type ProgressionOutcome =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'deferred'; readonly event: PassDeferredConsistencyEvent }
  | { readonly kind: 'passed'; readonly state: RuleState; readonly event: PhasePassedEvent }
  | { readonly kind: 'refused'; readonly assertion: AssertionFailure };

export interface ProgressionInput {
  /** The state as DO-7 left it: counters advanced, floor trailed, lock evaluated. */
  readonly state: RuleState;
  readonly plan: ResolvedPlan;
  readonly evalRules: EvalPhaseRules;
  readonly mark: DailyMark;
  readonly calendar: CalendarSlice;
}

/** DO-8 on an eval-phase day. */
export function advanceEvalProgression(input: ProgressionInput): ProgressionOutcome {
  const { state, plan, evalRules, mark, calendar } = input;

  // ---------------------------------------------------------------------------
  // R-32  EVAL EXPIRY, AND THIS REFUSES RATHER THAN COMPUTING
  // ---------------------------------------------------------------------------
  // R-32 is "elapsed trading days `>` `phase_eval.max_days` expires the
  // account", and ELAPSED TRADING DAYS IS NOT DERIVABLE FROM `RuleState`. The
  // record M01 section 2.2 specifies carries no account-open day and no
  // eval-start day: `tradingDay` is the day just folded, `tradedDaysCount`
  // counts days WITH FILLS and is a different quantity by R-08, and no anchor
  // points at the open. Counting elapsed trading days needs the open day and a
  // calendar spanning it, which is R-02's `sequence` subtraction.
  //
  // GIVING `RuleState` THAT FIELD IS A COLUMN ON `rule_states`, WHICH IS A
  // SCHEMA DELTA AND NOT A DIFF. M01's SD-01 to SD-10 do not contain it and the
  // corpus is frozen, so proposing one is an ADR and the founder's, not this
  // session's. It is reported in the session log rather than decided here.
  //
  // WHY REFUSE RATHER THAN IGNORE. `max_days` is `null` on all three v1 plans
  // (R-32: "so unreachable"), so nothing in the lineup reaches this line. But a
  // plan that DID set it would otherwise fold every day and expire nothing,
  // which is an account trading past its own expiry with a green state row: a
  // wrong number returned confidently on a money path, which is the exact shape
  // FM-05 and AS-14 refuse. A refusal writes no state and raises reconciliation.
  if (evalRules.maxDays !== null) {
    return {
      kind: 'refused',
      assertion: {
        kind: 'eval_expiry_unimplemented',
        tradingDay: mark.tradingDay,
        detail:
          `phase_eval.max_days is ${String(evalRules.maxDays)} and R-32's elapsed-trading-day ` +
          `count is not derivable from RuleState, which carries no account-open day`,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // R-26 and R-27  the pass condition
  // ---------------------------------------------------------------------------
  // GS-017 pins the tie (`300,000 >= 300,000` passes) and GS-018 pins the other
  // side (`299,999 >= 300,000` is false). The profit is measured against
  // `size_cents` and not against the opening balance, so a day that gives back
  // profit is tested on where it ENDED.
  const profitCents = mark.closingBalanceCents - plan.sizeCents;
  const targetMet = profitCents >= evalRules.profitTargetCents;

  // R-27 reads the count DO-6 already advanced, so the pass day counts itself.
  const daysMet = state.tradedDaysCount >= evalRules.minTradingDays;

  if (!targetMet || !daysMet) return { kind: 'unchanged' };

  // ---------------------------------------------------------------------------
  // R-28  consistency, and ONLY now
  // ---------------------------------------------------------------------------
  // "Tested only on days where R-26 and R-27 already hold." That ordering is the
  // rule and not an optimisation: a consistency verdict computed on a day that
  // has not met the target would defer nothing and would still emit an event
  // telling the trader their consistency is the problem, on a day where the
  // target is.
  const verdict = consistencyOk(
    state.consistencyBestDayCents,
    state.consistencyPeriodProfitCents,
    evalRules.consistency,
  );

  if (!verdict.ok) {
    // R-28 AGAIN, BECAUSE IT IS THE HALF THAT GETS LOST: this is a DEFERRAL.
    // "It never fails an account. It delays the pass, the trader keeps trading,
    // and every day the engine re-tests." No field of `state` moves.
    //
    // Both shares are non-null here by construction: a verdict that is not `ok`
    // came from an enabled gate that R-30 did not skip, which is the only branch
    // that computes them.
    const event: PassDeferredConsistencyEvent = {
      type: 'phase.pass_deferred_consistency',
      tradingDay: mark.tradingDay,
      bestDayShareBp: verdict.bestDayShareBp ?? 0,
      maxDayShareBp: verdict.maxDayShareBp ?? 0,
      shortfallCents: verdict.profitNeededToDiluteCents,
    };
    return { kind: 'deferred', event };
  }

  // ---------------------------------------------------------------------------
  // R-31  the funded reset, in the same step as the pass
  // ---------------------------------------------------------------------------
  // AS-12's off-by-one is decided here and nowhere else: the new consistency
  // period starts at the trading day STRICTLY AFTER the pass day, so "the same
  // rule applies at funded start, where the eval pass day is excluded". A slice
  // that ends on the pass day cannot answer, and ADR-049 rules that a typed
  // refusal, not a null and not a throw.
  const nextDay = nextTradingDayAfter(calendar, mark.tradingDay);
  if (!nextDay.found) {
    return {
      kind: 'refused',
      assertion: {
        kind: 'calendar_coverage_miss',
        tradingDay: mark.tradingDay,
        detail:
          `the eval passed on ${mark.tradingDay} and R-31's consistency period starts on the ` +
          `next trading day, which is outside the slice's coverage ` +
          `${calendar.coverage.from}..${calendar.coverage.to}`,
      },
    };
  }

  // R-12's second half: "at account open, AND AGAIN AT THE FUNDED RESET WITH THE
  // FUNDED DRAWDOWN". GS-019 pins the pair on CORE-50K: balance to 5,000,000 and
  // floor to 4,750,000 = 5,000,000 - 250,000.
  const resetFloorCents = initialFloorCents(plan.sizeCents, plan.funded.drawdown.drawdownCents);

  // -----------------------------------------------------------------------------
  // TWO FIELDS R-31's SENTENCE DOES NOT NAME, AND BOTH HAD TO BE ANSWERED
  // -----------------------------------------------------------------------------
  // `floorLocked` GOES TO FALSE. R-31 lists balance, hwb, floor and the counters
  // and stops. The floor machine answers the rest: section 3.4 starts the machine
  // at `[*] --> trailing: R-12, floor = size - drawdown`, and R-12's own text
  // names the funded reset as one of its two entry points. A funded account that
  // arrived carrying `floorLocked` from the eval phase would have `hwb` frozen at
  // `size_cents` and R-13 guarded off for the rest of its life, so its floor
  // could never trail and the lock could never re-engage at the funded
  // `floor_lock_at_profit_cents`. That is not a reading of R-31, it is the funded
  // floor deleted.
  //
  // AND THE LOCK REACHES THE EVAL PHASE ON EVERY V1 PLAN, so this is a live path
  // rather than a hypothetical: Core EOD locks at 260,000c of profit and its eval
  // target is 300,000c, so an account that passes has ALREADY locked at DO-7 on
  // the pass day itself.
  //
  // `floorOpenCents` IS LEFT ALONE. SD-04 defines it as "the floor THIS day's
  // breach check compared against", the check happened at DO-4 against the eval
  // floor, and that is the number the evidence pack must be able to show. It
  // records what was, not what is.
  //
  // -----------------------------------------------------------------------------
  // THE FLOOR MOVES DOWN HERE, WHICH IS WHAT INV-06 SAYS NEVER HAPPENS
  // -----------------------------------------------------------------------------
  // Reported rather than resolved, because resolving it is an ADR. INV-06 is
  // "the floor never decreases. NO EXCEPTION, no phase qualifier, no settlement
  // carve-out", and RE-P-01 asserts `floor(d+1) >= floor(d)` for every generated
  // sequence. On a Core EOD pass day the eval floor is the locked 5,010,000c and
  // the funded floor is 4,750,000c, so it falls by 260,000c.
  //
  // THE SPECIFIC RULES ARE UNAMBIGUOUS AND THIS FILE FOLLOWS THEM: R-12 states
  // the funded-reset floor, R-31 states it again, and GS-019 pins the number.
  // The balance falls to `size_cents` in the same step, so nothing about the
  // trader's loss room narrows; ADR-014's concern was a floor falling UNDER A
  // BALANCE THAT DID NOT.
  //
  // What is genuinely unsettled is INV-06's SCOPE: whether it is per account or
  // per phase, and D-M2-1 ("by resetting the account OR PROVISIONING A NEW ONE")
  // is the reason the question is real rather than pedantic. That scope decides
  // whether RE-P-01's generator may cross an eval pass, so the property session
  // needs it ruled. Session 44 handled M01's R-22 disagreement the same way:
  // follow the rule table, report the defect, and leave the ADR to the founder.
  //
  // DO-7's INV-06 TRIPWIRE IS NOT WEAKENED AND MUST NOT BE. It compares within
  // one day's trail-then-lock and never sees this step, which is correct: the
  // tripwire exists to catch a future edit to `advanceFloor`, and widening it to
  // span the reset would make it fire on the corpus's own arithmetic.
  const passedState: RuleState = {
    ...state,
    phase: 'funded',
    balanceCents: plan.sizeCents,
    highWaterBalanceCents: plan.sizeCents,
    floorCents: resetFloorCents,
    floorLocked: false,
    tradedDaysCount: 0,
    winDaysCount: 0,
    consistencyBestDayCents: 0n,
    consistencyPeriodProfitCents: 0n,
    consistencyPeriodStartDay: nextDay.day.tradingDay,
  };

  const event: PhasePassedEvent = {
    type: 'phase.passed',
    tradingDay: mark.tradingDay,
    fromPhase: 'eval',
    toPhase: 'funded',
    closingBalanceCents: mark.closingBalanceCents,
    targetCents: evalRules.profitTargetCents,
    resetBalanceCents: passedState.balanceCents,
    resetFloorCents: passedState.floorCents,
    consistencyPeriodStartDay: nextDay.day.tradingDay,
    consistency: {
      bestDayShareBp: verdict.bestDayShareBp,
      maxDayShareBp: verdict.maxDayShareBp,
      satisfied: verdict.ok,
      skipped: verdict.skipped,
    },
  };

  return { kind: 'passed', state: passedState, event };
}
