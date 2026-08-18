// =============================================================================
// packages/rules-engine/test/property-harness.ts
// =============================================================================
// THE FOUR PIECES `PT-04` AND `PT-07` BOTH NEED, AND NOTHING ELSE.
//
// This file is not a `.test.ts`, so it registers with no Vitest project in
// `vitest.config.ts` and is only ever imported.
//
// -----------------------------------------------------------------------------
// WHY IT EXISTS RATHER THAN AN IMPORT FROM THE PT-01 FILE
// -----------------------------------------------------------------------------
// `floor-monotonicity.property.test.ts` already carries all four as PRIVATE
// copies: `materializedFrom` (line 143), `toEngineMark` (252), `sliceOf` (264)
// and `fold` (299). None can be reached from here. That file is a TEST file, so
// importing it would re-register its whole suite inside whichever file imported
// it, and extracting a helper from it is an edit to a file session 62's fence
// forbids.
//
// So the duplication is deliberate and it is OWNED rather than mentioned: the
// pull request that lands this names a follow-up session whose objective is
// PT-01 importing from here, and lists the four by name and line. A note about
// duplication with no owner is how a note becomes nobody's.
//
// -----------------------------------------------------------------------------
// IT IS BUILT FOR TWO CALLERS AND MUST NOT BE GENERALISED FOR MORE
// -----------------------------------------------------------------------------
// Sessions 63 and 64 need the same shapes for `PT-02`, `PT-05` and `PT-08`, and
// they are keeping their helpers private inside their own files. Widening this
// one for callers whose requirements cannot be read yet is speculative
// abstraction: Appendix F2's rule of three, and two of the three could not
// review the result. `foldSequence` therefore carries no settlement stream,
// because neither `PT-04` nor `PT-07` is stated over one.
//
// -----------------------------------------------------------------------------
// THE PROJECTION GOES RESOLVED -> MATERIALIZED AND NEVER THE REVERSE
// -----------------------------------------------------------------------------
// Inherited verbatim from `PT-01`, whose own comment gives the reason: the other
// direction is `resolvePlan`, "it is P2-1's, and a second copy of it in test
// code would be a rule derived twice". The output of this projection feeds a
// GENERATOR and never a rule, which is the safe direction.
// =============================================================================

import { advanceDay, buildCalendarSlice } from '../src/index.js';
import type {
  CalendarSlice,
  DailyMark,
  DayOutput,
  ResolvedPlan,
  RuleState,
  TradingDay,
} from '../src/index.js';
import type { DaySequence, DailyMark as GeneratedMark } from './generators/day-input.js';
import type { MaterializedPlan } from './generators/plan-config.js';

/**
 * A published plan projected back to the shape the generator reads.
 *
 * `chainMarks` reads exactly two fields off it — `size_cents` for INV-20's
 * first-day opening balance, and `phase_funded.win_days.win_day_floor_cents`
 * for R-09's `win_day` column — but the whole record is projected so a caller
 * cannot accidentally hand the generator a plan that disagrees with the one the
 * fold uses.
 */
export function materializedFrom(plan: ResolvedPlan): MaterializedPlan {
  const evalRules = plan.eval;
  if (evalRules === null) {
    // Direct is the plan with no evaluation phase (Appendix A.3) and it is not
    // in either property's lineup. Inventing an eval block to project it would
    // hand the generator a plan the corpus does not publish.
    throw new Error('property-harness: this projection needs a plan with an evaluation phase');
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
      // CV-18, retired but retained: `none` is the single valid v1 value.
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

/** One folded day, carrying what both properties read. */
export interface FoldStep {
  readonly tradingDay: TradingDay;
  /** The state the day started from. `null` only on a fold that began with no prior. */
  readonly priorState: RuleState | null;
  readonly mark: DailyMark;
  readonly state: RuleState;
}

export interface FoldResult {
  readonly steps: readonly FoldStep[];
  /** The day the fold stopped on, or `null` if every mark folded. */
  readonly endedOn: { readonly tradingDay: TradingDay; readonly kind: string } | null;
}

export interface FoldOptions {
  /**
   * The state to fold from. `null` lets `advanceDay` build the open state, which
   * starts in the eval phase on any plan carrying one (`advance.ts` line 99).
   */
  readonly prior: RuleState | null;
  readonly engineVersion: string;
  readonly openedOn: TradingDay;
}

/**
 * Fold a generated sequence, stopping at the first day the engine refuses.
 *
 * FOLDING PAST A REFUSAL WOULD BE READING A STATE THE ENGINE DECLINED TO WRITE.
 * `PT-01` stops for the same reason and records it: no state is written for a
 * refused day, so the account's history ends there and anything compared past it
 * is compared against a `prior` that never advanced.
 */
export function foldSequence(
  plan: ResolvedPlan,
  seq: DaySequence,
  options: FoldOptions,
): FoldResult {
  const calendar = sliceOf(seq);
  const steps: FoldStep[] = [];
  let prior: RuleState | null = options.prior;

  for (const generated of seq.marks) {
    const mark = toEngineMark(generated);
    const out: DayOutput = advanceDay({
      engineVersion: options.engineVersion,
      plan,
      prior,
      mark,
      calendar,
      settlements: [],
      openedOn: options.openedOn,
    });

    if (out.assertions.length > 0) {
      return {
        steps,
        endedOn: {
          tradingDay: mark.tradingDay,
          kind: out.assertions.map((a) => a.kind).join(', '),
        },
      };
    }

    steps.push({ tradingDay: mark.tradingDay, priorState: prior, mark, state: out.state });
    prior = out.state;
  }

  return { steps, endedOn: null };
}
