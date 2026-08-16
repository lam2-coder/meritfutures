// =============================================================================
// packages/rules-engine/src/day/advance.ts
// =============================================================================
// THE FOLD. M01 section 1.1 gives the engine one job:
//
//   (pinned plan config, prior rule state, one trading day of marks,
//    settlement facts) -> (new rule state, emitted events)
//
// "Ordering is the single most load-bearing thing in this document ... A day is
// evaluated exactly once, in exactly this order, and NO STEP MAY BE REORDERED
// FOR PERFORMANCE" (section 3.1). The steps below are numbered as M01 numbers
// them and appear in that order and no other.
//
// -----------------------------------------------------------------------------
// WHAT THIS SESSION IMPLEMENTS, STATED HERE RATHER THAN DISCOVERED IN A DIFF
// -----------------------------------------------------------------------------
// P2 section 7 sequences the engine sessions and this file is `P2-3`: "advanceDay
// DO-1 to DO-7 for groups B, C, D". So:
//
//   DO-1  implemented, including ADR-049's calendar lookup
//   DO-2  REFUSES. `applySettlement` is group H (R-46..R-50) and is not written
//   DO-3  implemented: INV-18, INV-19, INV-20
//   DO-4  implemented: R-21, R-22, R-23
//   DO-5  implemented: R-24, R-25
//   DO-6  implemented: R-08, R-09, R-04, and the consistency accumulators
//   DO-7  implemented: R-13, R-15, R-16, R-14's tripwire
//   DO-8  implemented for the EVAL half: R-26..R-31, in `day/progression.ts`.
//         R-32 REFUSES, because elapsed trading days is not derivable from
//         `RuleState`. The FUNDED half is R-49's ladder, which fires only after
//         a settlement, so DO-2's refusal already covers every day that could
//         reach it
//   DO-9  the day closes and `day.closed` is emitted. THE ENGINE GATES ARE NOT
//         EVALUATED: R-33..R-41 are group F, and `RuleState` carries no
//         `engineEligible`, `engineGates` or `withdrawableCents` until they land
//
// A REFUSAL IS NOT A SILENT PASS. Each one returns a typed `AssertionFailure`
// naming the group that is missing, which means no state is written for the day
// and the caller raises reconciliation. The alternative -- folding the day and
// returning a state whose settlement or progression was skipped -- is a wrong
// number returned confidently, on a money path, and it is the failure mode
// FM-05 and AS-14 both exist to refuse.
// =============================================================================

import { lookupCalendarDay } from '../calendar.js';
import type {
  AssertionFailure,
  BreachDetectedEvent,
  CalendarDay,
  Cents,
  DailyMark,
  DayClosedEvent,
  DayInput,
  DayOutput,
  EngineEvent,
  FloorLockedEvent,
  PhaseDayRules,
  ResolvedPlan,
  RuleState,
  SoftDailyLossLimitEvent,
  TradingDay,
} from '../types.js';
import { withdrawableCents } from '../payout/gates.js';
import { checkBreach } from './breach.js';
import { advanceConsistency, isTradedDay, isWinDay } from './counters.js';
import { advanceFloor, initialFloorCents } from './floor.js';
import { advanceEvalProgression } from './progression.js';

/**
 * The state an account has the instant it opens, before any mark exists.
 *
 * GS-008 is exactly this scenario and pins one field, the floor, "because the
 * corpus states one". The others are not invented here either:
 *
 *   phase       `eval` when the plan has an evaluation phase and `funded` when
 *               it does not, which is Direct (Appendix A.3, "Eval phase:
 *               disabled")
 *   balance     `size_cents`. An account opens at its size
 *   hwb         `size_cents`, which is the only value that makes R-13's `max`
 *               reproduce R-12 on the first day: `size - drawdown` either way
 *   floorOpen   the same floor. The first day's breach check compares against
 *               it (R-18), and there is no earlier day to carry one from
 *
 * Every counter is zero and every anchor is null, which is what "phase scoped"
 * and "anchor scoped" mean at the point where neither has happened yet.
 */
export function initialState(
  plan: ResolvedPlan,
  openedOn: TradingDay,
  engineVersion: string,
): RuleState {
  const phase = plan.eval === null ? 'funded' : 'eval';
  const rules: PhaseDayRules = plan.eval ?? plan.funded;
  const floorCents = initialFloorCents(plan.sizeCents, rules.drawdown.drawdownCents);

  const opened: RuleState = {
    tradingDay: openedOn,
    phase,
    balanceCents: plan.sizeCents,
    floorOpenCents: floorCents,
    floorCents,
    floorLocked: false,
    highWaterBalanceCents: plan.sizeCents,
    // R-35 is applied below rather than written as the `0n` it provably is. An
    // account opens at `size_cents` and CV-07 makes the buffer non-negative, so
    // the formula yields zero on both phases; a literal here would be a second
    // derivation of R-35 that a later change to the buffer rule would not reach.
    withdrawableCents: 0n,
    tradedDaysCount: 0,
    winDaysCount: 0,
    consistencyBestDayCents: 0n,
    consistencyPeriodProfitCents: 0n,
    consistencyPeriodStartDay: null,
    payoutsSettledCount: 0,
    payoutAnchorDay: null,
    cadenceAnchorDay: null,
    lifetimeSettledCents: 0n,
    breached: false,
    breachKind: null,
    engineVersion,
  };

  return { ...opened, withdrawableCents: withdrawableCents(opened, plan) };
}

/** A refusal: the state the fold arrived with, no events, and the finding. */
function refuse(state: RuleState, assertion: AssertionFailure): DayOutput {
  return { state, events: [], assertions: [assertion] };
}

/** One day for one account. Pure, total, and the only place a rule is applied. */
export function advanceDay(input: DayInput): DayOutput {
  const { plan, mark, settlements, engineVersion } = input;
  const events: EngineEvent[] = [];

  // ---------------------------------------------------------------------------
  // DO-1  preconditions
  // ---------------------------------------------------------------------------
  const prior = input.prior ?? initialState(plan, mark.tradingDay, engineVersion);

  if (prior.phase === 'closed' || prior.phase === 'graduated') {
    // R-24, INV-12. Breach is terminal: no state advances after it, and neither
    // does a graduated account, because R-49 closes it.
    return refuse(prior, {
      kind: 'account_closed',
      tradingDay: mark.tradingDay,
      detail: `the account is ${prior.phase} and no further state is ever written for it`,
    });
  }

  if (input.prior !== null && mark.tradingDay <= input.prior.tradingDay) {
    // INV-14 and R-06. Applying the same day twice is a no-op on state, and a
    // day that is not strictly forward is either that or an out-of-order feed.
    return refuse(prior, {
      kind: 'not_forward',
      tradingDay: mark.tradingDay,
      detail: `${mark.tradingDay} is not after the prior state's ${input.prior.tradingDay}`,
    });
  }

  // R-02 and FM-13, through ADR-049's slice. The two misses are different
  // answers and only one of them is a statement about the day.
  const lookup = lookupCalendarDay(input.calendar, mark.tradingDay);
  if (!lookup.found) {
    return refuse(
      prior,
      lookup.reason === 'outside_coverage'
        ? {
            kind: 'calendar_coverage_miss',
            tradingDay: mark.tradingDay,
            detail:
              `${mark.tradingDay} is outside the slice's coverage ` +
              `${input.calendar.coverage.from}..${input.calendar.coverage.to}, so whether it is a ` +
              `trading day is UNKNOWN rather than false`,
          }
        : {
            kind: 'day_not_a_session',
            tradingDay: mark.tradingDay,
            detail: `${mark.tradingDay} is inside coverage and is not a session in the calendar`,
          },
    );
  }
  const calendarDay: CalendarDay = lookup.day;

  // ---------------------------------------------------------------------------
  // DO-2  settlements effective today, in ordinal order
  // ---------------------------------------------------------------------------
  // GROUP H IS NOT WRITTEN. A settlement reduces the balance, advances both
  // anchors, increments the settled count, resets win days and the consistency
  // period, and may graduate the account (R-46..R-50). Folding the day WITHOUT
  // applying it would produce a state that then fails INV-18 tomorrow, or worse,
  // one that pays a second time against a balance the first payout already left.
  if (settlements.length > 0) {
    return refuse(prior, {
      kind: 'settlement_unimplemented',
      tradingDay: mark.tradingDay,
      detail:
        `${String(settlements.length)} settlement(s) are effective today and applySettlement ` +
        `(R-46 to R-50, group H) is not implemented`,
    });
  }

  // ---------------------------------------------------------------------------
  // DO-3  mark identities
  // ---------------------------------------------------------------------------
  const assertions = markIdentityFailures(prior, mark, plan);
  if (assertions.length > 0) return { state: prior, events: [], assertions };

  const rules: PhaseDayRules = prior.phase === 'eval' ? (plan.eval ?? plan.funded) : plan.funded;

  // R-18. Captured HERE, before anything trails, and written to the state so the
  // evidence pack can show which floor the decision compared against (SD-04).
  const floorOpenCents = prior.floorCents;

  // ---------------------------------------------------------------------------
  // DO-4 and DO-5  breach
  // ---------------------------------------------------------------------------
  const breach = checkBreach({
    mark,
    floorOpenCents,
    drawdown: rules.drawdown,
    dailyLossLimit: rules.dailyLossLimit,
  });

  if (breach.softLimitExceeded) events.push(softDllEvent(mark, rules));

  if (breach.breached && breach.kind !== null) {
    // R-24 and R-25. Terminal and immediate: nothing after this runs, and breach
    // beats every pass, target and eligibility condition the same day might also
    // satisfy. The balance still moves to the close, because it did.
    const closedState: RuleState = {
      ...prior,
      tradingDay: mark.tradingDay,
      phase: 'closed',
      balanceCents: mark.closingBalanceCents,
      floorOpenCents,
      breached: true,
      breachKind: breach.kind,
      engineVersion,
    };
    // R-35 on a closed account is `0n`, and it is recomputed rather than carried
    // from `prior`: a breached account that was withdrawable-positive yesterday
    // must not present a positive withdrawable on the row that closed it.
    const state: RuleState = {
      ...closedState,
      withdrawableCents: withdrawableCents(closedState, plan),
    };
    const detected: BreachDetectedEvent = {
      type: 'breach.detected',
      tradingDay: mark.tradingDay,
      breachKind: breach.kind,
      lowBalanceCents: mark.lowBalanceCents,
      floorCents: floorOpenCents,
      shortfallCents: breach.shortfallCents,
    };
    events.push(detected);
    return { state, events, assertions: [] };
  }

  // ---------------------------------------------------------------------------
  // DO-6  counters
  // ---------------------------------------------------------------------------
  const tradedDaysCount = prior.tradedDaysCount + (isTradedDay(mark) ? 1 : 0);
  const winDaysCount =
    prior.winDaysCount + (isWinDay(mark, calendarDay, rules.winDayFloorCents) ? 1 : 0);
  const consistency = advanceConsistency(
    {
      bestDayCents: prior.consistencyBestDayCents,
      periodProfitCents: prior.consistencyPeriodProfitCents,
    },
    mark,
    prior.consistencyPeriodStartDay,
  );

  // ---------------------------------------------------------------------------
  // DO-7  trail, then lock
  // ---------------------------------------------------------------------------
  const floor = advanceFloor({
    priorFloorCents: prior.floorCents,
    priorHighWaterBalanceCents: prior.highWaterBalanceCents,
    priorFloorLocked: prior.floorLocked,
    closingBalanceCents: mark.closingBalanceCents,
    sizeCents: plan.sizeCents,
    drawdown: rules.drawdown,
  });

  if (floor.lockEngagedAtProfitCents !== null) {
    const locked: FloorLockedEvent = {
      type: 'rule.floor_locked',
      tradingDay: mark.tradingDay,
      atProfitCents: floor.lockEngagedAtProfitCents,
      lockedFloorCents: floor.floorCents,
    };
    events.push(locked);
  }

  let state: RuleState = {
    ...prior,
    tradingDay: mark.tradingDay,
    balanceCents: mark.closingBalanceCents,
    floorOpenCents,
    floorCents: floor.floorCents,
    floorLocked: floor.floorLocked,
    highWaterBalanceCents: floor.highWaterBalanceCents,
    tradedDaysCount,
    winDaysCount,
    consistencyBestDayCents: consistency.bestDayCents,
    consistencyPeriodProfitCents: consistency.periodProfitCents,
    engineVersion,
  };

  // ---------------------------------------------------------------------------
  // DO-8  progression
  // ---------------------------------------------------------------------------
  // THE EVAL HALF IS `day/progression.ts` AND THE FUNDED HALF IS NOT REACHABLE.
  // Section 3.1's funded clause is "test the ladder, which can also fire here if
  // a settlement graduated the account"; R-49 fires only after a settlement, and
  // DO-2 above refuses every day a settlement is effective on. So a funded day
  // passes through DO-8 with nothing to do, and that is a statement about R-49's
  // trigger rather than a step being skipped.
  //
  // R-25 IS WHY THIS RUNS AFTER DO-4 AND NOT BEFORE IT. "Breach beats everything
  // on the same day. Ordering law DO-4 before DO-8. No `phase.passed`, no
  // eligibility, no graduation" (GS-063, GS-064, EC-004). The breach path above
  // returns, so an account that broke its floor on the day it met its target
  // never reaches this line.
  if (state.phase === 'eval') {
    if (plan.eval === null) {
      // A state claiming the eval phase on a plan that has none. The caller
      // assembled a `prior` that cannot exist: `initialState` puts an account in
      // `funded` exactly when `plan.eval` is null (Direct, Appendix A.3). This
      // refuses rather than falling back to `plan.funded`, because folding an
      // eval day against funded rules would compute a real number against the
      // wrong parameters, which is worse than refusing to compute.
      return refuse(state, {
        kind: 'eval_phase_without_eval_rules',
        tradingDay: mark.tradingDay,
        detail: "the prior state's phase is `eval` and the plan has no evaluation phase",
      });
    }

    const progression = advanceEvalProgression({
      state,
      plan,
      evalRules: plan.eval,
      mark,
      calendar: input.calendar,
    });

    switch (progression.kind) {
      case 'refused':
        return refuse(state, progression.assertion);
      case 'deferred':
        // R-28. The account stays in `eval` and no field moves; the day still
        // closes, because a deferral is not a refusal and not a breach.
        events.push(progression.event);
        break;
      case 'passed':
        state = progression.state;
        events.push(progression.event);
        break;
      case 'unchanged':
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // DO-9  the day closes
  // ---------------------------------------------------------------------------
  // The engine gates are group F and are not evaluated here. `day.closed`
  // carries what the implemented rules computed; `gate_results` joins it when
  // R-33 to R-41 land, which is the same commit that gives `RuleState` its
  // `engineEligible`.
  //
  // R-35 IS EVALUATED HERE AND NOT AT DO-7, which is where M01 section 3.6 puts
  // it too. DO-8 can change both terms the formula reads: an eval pass moves the
  // phase to `funded` and the balance to `size_cents` in the same step (R-31),
  // so a withdrawable computed before the progression would be the eval day's
  // number attached to a funded row, and on the pass day it would be a positive
  // amount against a balance the reset had just taken back to size.
  state = { ...state, withdrawableCents: withdrawableCents(state, plan) };
  const closed: DayClosedEvent = {
    type: 'day.closed',
    tradingDay: mark.tradingDay,
    closingBalanceCents: mark.closingBalanceCents,
    adjustmentCents: mark.adjustmentCents,
    floorOpenCents: state.floorOpenCents,
    floorCents: state.floorCents,
    tradedDaysCount: state.tradedDaysCount,
    winDaysCount: state.winDaysCount,
    consistencyPeriodStartDay: state.consistencyPeriodStartDay,
  };
  events.push(closed);

  return { state, events, assertions: [] };
}

/**
 * DO-3. INV-18, INV-19 and INV-20, in that order.
 *
 * EC-157 CLOSED THE QUESTION OF WHAT THESE IDENTITIES ARE and `0036` made the
 * database agree with them: INV-18 is `opening == prior.balance + adjustment`
 * and INV-19 is `closing == opening + realized_pnl`. The adjustment is on the
 * OPENING side because a non-trading movement lands at the open of its effective
 * day and never inside a session (R-10, SD-01), which is the whole of AS-10's
 * counter: a settled payout must not read as a catastrophic trading loss and
 * breach the account that earned it.
 *
 * A failure here does not throw. "This is the one place the engine refuses to
 * compute rather than computing something plausible" (FM-05).
 */
function markIdentityFailures(
  prior: RuleState,
  mark: DailyMark,
  plan: ResolvedPlan,
): AssertionFailure[] {
  const failures: AssertionFailure[] = [];

  const expectedOpening = prior.balanceCents + mark.adjustmentCents;
  if (mark.openingBalanceCents !== expectedOpening) {
    failures.push({
      kind: 'opening_mismatch',
      tradingDay: mark.tradingDay,
      expected: expectedOpening,
      got: mark.openingBalanceCents,
      detail: 'INV-18: opening balance is not the prior balance plus the adjustment',
    });
  }

  const expectedClosing = mark.openingBalanceCents + mark.realizedPnlCents;
  if (mark.closingBalanceCents !== expectedClosing) {
    failures.push({
      kind: 'closing_mismatch',
      tradingDay: mark.tradingDay,
      expected: expectedClosing,
      got: mark.closingBalanceCents,
      detail: 'INV-19: closing balance is not the opening balance plus realized P&L',
    });
  }

  // INV-20, on the transition boundary only: a funded account that has traded no
  // day and settled no payout is one that has just been funded, and it must open
  // at exactly `size_cents`. AS-14 is what happens when it does not.
  const atFundedStart =
    prior.phase === 'funded' && prior.tradedDaysCount === 0 && prior.payoutsSettledCount === 0;
  if (atFundedStart && mark.openingBalanceCents !== plan.sizeCents) {
    failures.push({
      kind: 'funded_start_not_size',
      tradingDay: mark.tradingDay,
      expected: plan.sizeCents,
      got: mark.openingBalanceCents,
      detail: 'INV-20: the first funded mark does not open at the account size',
    });
  }

  return failures;
}

/** R-23's fact. Defined so enabling a soft limit is a config change, not a code change. */
function softDllEvent(mark: DailyMark, rules: PhaseDayRules): SoftDailyLossLimitEvent {
  const limitCents: Cents =
    rules.dailyLossLimit.type === 'none' ? 0n : rules.dailyLossLimit.limitCents;
  return {
    type: 'rule.soft_dll_exceeded',
    tradingDay: mark.tradingDay,
    realizedPnlCents: mark.realizedPnlCents,
    limitCents,
  };
}
