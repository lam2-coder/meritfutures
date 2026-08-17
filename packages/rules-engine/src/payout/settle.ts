// =============================================================================
// packages/rules-engine/src/payout/settle.ts
// =============================================================================
// GROUP H. R-46 to R-50, and M01 section 3.6 states the reason this is one
// function rather than two: it is "called by M5 at settlement AND by replay at
// DO-2, SO BOTH PRODUCE IDENTICAL STATE". Two implementations of a settlement
// would diverge on the first correction, and the divergence would surface as a
// nightly replay page whose real cause is that the live path and the audit path
// were never the same code.
//
//   R-46  both anchors advance, and they are DIFFERENT DATES
//   R-47  win days and the consistency period reset, anchored to the BASIS day
//   R-48  the floor, the high-water balance and the lock are UNTOUCHED. R-19
//   R-49  the ladder, `>=`, evaluated immediately after the settlement
//   R-50  lifetime accounting, which INV-17 bounds
//
// -----------------------------------------------------------------------------
// TWO ANCHORS, AND CONFLATING THEM IS A 40 PERCENT LIABILITY CHANGE
// -----------------------------------------------------------------------------
// SD-02 replaced `last_payout_trading_day` with two columns "because the two
// anchors are genuinely different dates and conflating them is a silent
// liability change of 40 percent (EC-039)".
//
//   payoutAnchorDay   the BASIS day. Win days and the consistency period count
//                     from it (R-47), so it decides when the next cycle starts
//   cadenceAnchorDay  the WALLET-CREDIT day. The cadence gap counts from it
//                     (R-37)
//
// [ADR-019](../../../docs/decisions/ADR-019.md) made the wallet's internal leg
// instant, so on the v1 lineup the two dates COINCIDE. The structure is kept
// anyway, and M01 R-37 says why: "the two-anchor structure is unchanged and the
// two anchors now coincide." A future settlement model moves one and not the
// other, and a single column would make that a schema change instead of a value.
//
// -----------------------------------------------------------------------------
// THE SIGNATURE TAKES A CALENDAR SLICE AND M01's SKETCH DOES NOT
// -----------------------------------------------------------------------------
// R-47 sets `consistencyPeriodStartDay = nextTradingDayAfter(basisTradingDay)`
// and section 3.6 calls that function with no calendar at all. That is exactly
// the gap [ADR-049](../../../docs/decisions/ADR-049.md) closes, and P2 section 1
// names THIS function while closing it: "`applySettlement` computes
// `consistencyPeriodStartDay: nextTradingDayAfter(fact.basisTradingDay)` ... and
// `DayInput.calendar` is a single `CalendarDay` ... NEITHER RULE CAN BE COMPUTED
// FROM ONE ROW." So the slice is a parameter, and a lookup that lands outside it
// is a typed refusal rather than a null or a throw.
// =============================================================================

import { nextTradingDayAfter } from '../calendar.js';
import type {
  AccountGraduatedEvent,
  AssertionFailure,
  CalendarSlice,
  EngineEvent,
  GateInputState,
  ResolvedPlan,
  RuleState,
  SettlementFact,
  WinDaysResetEvent,
} from '../types.js';
import { evaluateEngineGates, withdrawableCents } from './gates.js';

/**
 * What one settlement produced.
 *
 * `assertions` IS NOT ON M01's `SettlementOutput` AND IT IS THE SAME CHANNEL
 * `DayOutput` CARRIES. ADR-049 extends the refusal channel to "a calendar lookup
 * that lands outside coverage", and R-47 makes exactly such a lookup. A
 * non-empty `assertions` means THE SETTLEMENT WAS NOT APPLIED and the state is
 * the one this function was handed.
 */
export interface SettlementOutput {
  readonly state: RuleState;
  readonly events: readonly EngineEvent[];
  readonly assertions: readonly AssertionFailure[];
}

/**
 * R-46 to R-50. One settled payout, applied to one account's state.
 *
 * IDEMPOTENCE IS THE CALLER'S, NOT THIS FUNCTION'S. FM-10 requires
 * `applySettlement` to be "idempotent on `payout_request_id`", and the engine
 * has no memory of which requests it has seen: `RuleState` carries
 * `payoutsSettledCount` and not a set of ids. The batch's per-account advisory
 * lock and the caller's own dedupe are what discharge FM-10; what this function
 * guarantees is that a given (state, fact) pair always produces the same output,
 * which is the half a pure fold can hold.
 */
export function applySettlement(
  state: RuleState,
  plan: ResolvedPlan,
  fact: SettlementFact,
  calendar: CalendarSlice,
): SettlementOutput {
  // ---------------------------------------------------------------------------
  // R-47's period start, resolved FIRST, because a miss must write nothing
  // ---------------------------------------------------------------------------
  // AS-12 is the whole subject: "If the basis day is included in the new
  // consistency period, THE VERY DAY THAT FUNDED A PAYOUT COUNTS AGAINST THE
  // NEXT CYCLE. On a plan where the payout day is usually the best day, this
  // blocks the following cycle by exactly one large day, and IT LOOKS LIKE THE
  // CONSISTENCY RULE WORKING rather than a bug." R-47 answers it by defining the
  // period as trading days STRICTLY AFTER the anchor, and SD-07 stores the
  // resulting day so the boundary is visible in the portal and the evidence pack
  // "rather than living in someone's head".
  const periodStart = nextTradingDayAfter(calendar, fact.basisTradingDay);
  if (!periodStart.found) {
    return {
      state,
      events: [],
      assertions: [
        {
          kind: 'calendar_coverage_miss',
          tradingDay: fact.basisTradingDay,
          detail:
            `R-47 starts the new consistency period on the trading day after the basis day ` +
            `${fact.basisTradingDay}, which the slice covering ${calendar.coverage.from}..` +
            `${calendar.coverage.to} cannot supply, so the settlement is NOT applied`,
        },
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // The balance, and the three fields settlement does NOT move
  // ---------------------------------------------------------------------------
  // R-19 and R-48, [ADR-014](../../../docs/decisions/ADR-014.md): "A settled
  // payout reduces `balanceCents` and CHANGES NOTHING ELSE ABOUT THE FLOOR:
  // `floorCents`, `highWaterBalanceCents`, and `floorLocked` all carry through
  // untouched."
  //
  // THE ABSENCE IS THE RULE, WHICH IS WHY IT IS WRITTEN DOWN HERE. Section 3.4's
  // floor expression contains no settlement term, "which is the entire content
  // of the OQ-5 ruling", and INV-21 (a settled payout can never breach the
  // account that earned it) is then guaranteed by CV-11 and CV-17 AT PUBLISH
  // TIME rather than by a compensating recompute here. M01 R-48 calls that "the
  // stronger arrangement because it fails at publish time instead of at
  // settlement time".
  //
  // The consequence a trader must be told, in M01 R-19's own words: "The
  // trader's loss room after an extraction is therefore the buffer, or the
  // buffer minus the lock offset once locked, AND THAT IS WHAT THE RULES PAGE
  // MUST SAY."
  const settled: GateInputState = {
    ...state,
    balanceCents: state.balanceCents - fact.approvedCents,

    // R-46. Two dates, and on the v1 lineup they are the same date.
    payoutAnchorDay: fact.basisTradingDay,
    cadenceAnchorDay: fact.effectiveTradingDay,

    // R-47. The counter goes to zero and the period restarts after the anchor.
    winDaysCount: 0,
    consistencyBestDayCents: 0n,
    consistencyPeriodProfitCents: 0n,
    consistencyPeriodStartDay: periodStart.day.tradingDay,

    payoutsSettledCount: state.payoutsSettledCount + 1,

    // R-50. INV-17 bounds it at `ladder * max cap in the schedule`, which is the
    // liability bound the whole plan lineup rests on (AS-03, RE-P-17).
    lifetimeSettledCents: state.lifetimeSettledCents + fact.approvedCents,
  };

  // R-47's fairness point, stated because it is the half that gets lost. M01:
  // "Progress earned during the transfer window is KEPT, because it happened
  // after the snapshot the payout was based on." The zero above is safe for
  // exactly that reason and no other: settlements are applied at DO-2 before the
  // day's counters advance at DO-6, so the only win days the fold has counted
  // when this runs are ones at or before the basis day. RE-P-18 asserts that the
  // two formulations agree.
  const winDaysReset: WinDaysResetEvent = {
    type: 'payout.win_days_reset',
    tradingDay: fact.effectiveTradingDay,
    previousCount: state.winDaysCount,
    resetTo: 0,
    anchorTradingDay: fact.basisTradingDay,
    consistencyPeriodStartDay: periodStart.day.tradingDay,
  };
  const events: EngineEvent[] = [winDaysReset];

  // ---------------------------------------------------------------------------
  // R-49  the ladder, `>=`, evaluated immediately after the settlement
  // ---------------------------------------------------------------------------
  // `payoutsSettledCount >= max_payouts`. Core EOD and Merit Rapid graduate at
  // 5 and Direct at 4 ([ADR-024](../../../docs/decisions/ADR-024.md), Appendix
  // A), and the ladder is what turns a per-day extraction rate into a bounded
  // one: "a per-day rate that terminates is a different object from one that
  // does not, and the lifetime figure is the one that belongs in a liability
  // conversation" (AS-03).
  //
  // NO LIVE INVITATION IS EMITTED. ADR-024 makes graduation eligibility "a
  // review-pool flag, and invitation is a discretionary operator action taken
  // from that pool, OUTSIDE THE ENGINE". M01 section 5.2's event table still
  // lists `account.live_invitation_issued` beside `account.graduated` on R-49's
  // row, which is a stale row rather than a second reading: R-49's own text
  // rules it out by name. Reported, not edited.
  const graduated = settled.payoutsSettledCount >= plan.funded.maxPayouts;
  if (graduated) {
    const event: AccountGraduatedEvent = {
      type: 'account.graduated',
      tradingDay: fact.effectiveTradingDay,
      payoutsSettledCount: settled.payoutsSettledCount,
      maxPayouts: plan.funded.maxPayouts,
      lifetimeSettledCents: settled.lifetimeSettledCents,
    };
    events.push(event);
  }

  // A graduated account is closed, so R-35 returns `0n` and every gate is false
  // by the same arithmetic that makes a `closed` account ineligible. Nothing
  // special-cases it: the phase moves and the formulas follow.
  const withPhase: GateInputState = {
    ...settled,
    phase: graduated ? 'graduated' : settled.phase,
  };
  const withWithdrawable: GateInputState = {
    ...withPhase,
    withdrawableCents: withdrawableCents(withPhase, plan),
  };

  // The gates are re-evaluated because a settlement moved four of their inputs:
  // the balance, the win-day count, the consistency accumulators and the cadence
  // anchor. M5 calls this function directly at settlement time and stores what
  // it returns, so a state carrying yesterday's gates would put a passing
  // eligibility on the row that just paid.
  const evaluated = evaluateEngineGates({ state: withWithdrawable, plan, calendar });
  if (evaluated.kind === 'refused') {
    return { state, events: [], assertions: [evaluated.assertion] };
  }

  return {
    state: {
      ...withWithdrawable,
      engineGates: evaluated.gates,
      engineEligible: evaluated.engineEligible,
    },
    events,
    assertions: [],
  };
}
