// =============================================================================
// packages/rules-engine/test/generator-bridge.ts
// =============================================================================
// THE THREE ADAPTERS BETWEEN THE GENERATORS' SHAPES AND THE ENGINE'S, AND
// NOTHING ELSE. Every `PT-nn` property needs all three and none of them is a
// rule: `materializedFrom` projects a published plan back to the shape a
// generator reads, `toEngineMark` and `sliceOf` carry generated data forward
// into the engine's types.
//
// This file is not a `.test.ts`, so it matches no project in `vitest.config.ts`
// and is only ever imported.
//
// -----------------------------------------------------------------------------
// IT EXISTS BECAUSE THESE THREE WERE WRITTEN FOUR TIMES IN ONE WAVE
// -----------------------------------------------------------------------------
// WAVE-01 landed five property suites across three sessions that ran
// concurrently in this directory, each fenced out of the others' files. All
// three needed the same adapters and none could reach another's copy, so each
// wrote its own. The four origins, named in full because a collapse that does
// not record what it absorbed is a collapse the next reader has to redo:
//
//   `floor-monotonicity.property.test.ts`   PT-01, session 48, private copies
//                                           at lines 143, 252 and 264
//   `property-harness.ts`                   PT-04 and PT-07, session 62
//   `settlement-fold.ts`                    PT-02 and PT-08, session 63
//   `pt-05-clamp-bounds.property.test.ts`   PT-05, session 64, private copies
//                                           at lines 181, 160 and 172
//
// THE FOURTH IS THE ONE THE LANDMINE DID NOT NAME. STATE.md's session-63 entry
// records the count as four and enumerates three, because session 64's copy
// landed after session 63's header was written. Session 64's own file carried
// the note and nobody propagated it back. Recorded here so the enumeration and
// the count agree from now on.
//
// -----------------------------------------------------------------------------
// THE TWELVE DEFINITIONS WERE BEHAVIOURALLY IDENTICAL AND ONE DIFFERENCE HAD TO
// BE RULED ON
// -----------------------------------------------------------------------------
// Diffed with comments stripped, the four copies of each helper differed only in
// the `export` keyword, in the wording of `materializedFrom`'s throw, and in one
// substantive place: `settlement-fold.ts` wrote `BigInt(x) as Cents` on
// `toEngineMark`'s six money fields where the other three wrote `BigInt(x)`.
//
// THE UNCAST FORM IS THE STRICTER ONE AND IT IS WHAT SURVIVED. `src/types.ts`
// line 38 declares `export type Cents = bigint`, a plain alias and not a brand,
// and this arrow's return annotation is `DailyMark`, whose six money fields are
// already `Cents` (`src/types.ts` lines 723 to 735). So the uncast form makes
// the compiler CHECK that `bigint` satisfies the field type, while `as Cents`
// ASSERTS it and would go on compiling if the alias ever became a brand and the
// generator's `number` fields stopped converting cleanly. A cast is weaker than
// a check, so the check is what a shared module carries.
//
// -----------------------------------------------------------------------------
// THE PROJECTION GOES RESOLVED -> MATERIALIZED AND NEVER THE REVERSE
// -----------------------------------------------------------------------------
// Inherited verbatim from `PT-01`, whose own comment gives the reason: the other
// direction is `resolvePlan`, "it is P2-1's, and a second copy of it in test
// code would be a rule derived twice". The output of this projection feeds a
// GENERATOR and never a rule, which is the safe direction.
//
// -----------------------------------------------------------------------------
// WHAT IT MAY NOT GROW INTO
// -----------------------------------------------------------------------------
// The three helpers are here because four sessions independently wrote the same
// code, which is Appendix F2's rule of three met by evidence rather than by
// forecast. That is the ONLY admission criterion this file has. The folds are
// deliberately not here: `property-harness.ts`'s `foldSequence`,
// `settlement-fold.ts`'s `foldSettlements` and `PT-01`'s private `fold` carry
// genuinely different shapes, and merging them would be the speculative
// abstraction both harness headers refuse.
// =============================================================================

import { buildCalendarSlice } from '../src/index.js';
import type { CalendarSlice, DailyMark, ResolvedPlan, TradingDay } from '../src/index.js';
import type { DaySequence, DailyMark as GeneratedMark } from './generators/day-input.js';
import type { MaterializedPlan } from './generators/plan-config.js';

/**
 * A published plan projected back to the shape the generator reads.
 *
 * `chainMarks` reads exactly two fields off it -- `size_cents` for INV-20's
 * first-day opening balance, and `phase_funded.win_days.win_day_floor_cents`
 * for R-09's `win_day` column -- but the whole record is projected so a caller
 * cannot accidentally hand the generator a plan that disagrees with the one the
 * fold uses.
 */
export function materializedFrom(plan: ResolvedPlan): MaterializedPlan {
  const evalRules = plan.eval;
  if (evalRules === null) {
    // Direct is the plan with no evaluation phase (M01 Appendix A.3) and no
    // property in the suite folds it. Inventing an eval block to project it
    // would hand the generator a plan the corpus does not publish, and would
    // hide the omission rather than report it.
    throw new Error('generator-bridge: this projection needs a plan with an evaluation phase');
  }

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
            // R-28: eval consistency is tested at pass time and is dilutable.
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
        // R-47: the counter goes to zero on every settlement, unconditionally.
        // `ResolvedPlan` carries no switch for it because the rule has none.
        reset_on_payout: true,
      },
      consistency: plan.funded.consistency.enabled
        ? {
            enabled: true,
            max_day_share_bp: Number(plan.funded.consistency.maxDayShareBp),
            // R-36: funded consistency is a payout gate.
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
      // CV-18, retired but retained: `none` is the single valid v1 value
      // (ADR-014).
      post_payout_floor_rule: { mode: 'none' },
    },
  };
}

/** A generated mark in the engine's units. The generator draws `number`; INV-02 is `bigint`. */
export const toEngineMark = (m: GeneratedMark): DailyMark => ({
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

/** ADR-049's slice over the generated calendar. */
export const sliceOf = (seq: DaySequence): CalendarSlice =>
  buildCalendarSlice({
    days: seq.calendar.days.map((d) => ({ ...d, tradingDay: d.tradingDay as TradingDay })),
    coverage: {
      from: seq.calendar.coverage.from as TradingDay,
      to: seq.calendar.coverage.to as TradingDay,
    },
  });
