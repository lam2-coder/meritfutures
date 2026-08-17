// =============================================================================
// packages/rules-engine/test/fixtures-in-code.ts
// =============================================================================
// THE PLAN AND THE CALENDAR THE UNIT SUITE FOLDS AGAINST, transcribed from the
// plan documents and from nowhere else (TR-01).
//
// WHY THEY ARE IN CODE AND NOT READ FROM `fixtures/`. This package compiles with
// `types: []`, so `node:fs` does not exist inside it: not in `src/`, where that
// is the point, and not in `test/` either, where it is a consequence. The golden
// fixtures are read by `packages/golden-loader`, which is a different package
// for exactly that reason. A unit test needs its inputs in the file.
//
// EVERY NUMBER BELOW TRACES TO A DOCUMENT, and the citation is beside it. A
// number here that cannot be traced is the defect this comment exists to make
// visible, because a unit suite that invents a parameter is a unit suite
// asserting the engine agrees with itself.
// =============================================================================

import { buildCalendarSlice } from '../src/calendar.js';
import { initialState } from '../src/day/advance.js';
import type {
  BasisPoints,
  CalendarSlice,
  Cents,
  DailyMark,
  PlanVersionId,
  ResolvedPlan,
  RuleState,
  TradingDay,
} from '../src/types.js';

export const day = (iso: string): TradingDay => iso as TradingDay;

/**
 * The one cast that makes a basis point a `BasisPoints`.
 *
 * EXPORTED SO THERE IS ONE OF THEM. The brand exists to make "cents handed to
 * something expecting basis points" a compile error, and a suite that casts
 * inline wherever it needs a threshold has as many holes as it has call sites.
 */
export const bp = (n: number): BasisPoints => n as BasisPoints;

/**
 * CORE-50K, from M01 Appendix A.1's 50K column.
 *
 *   size                       5,000,000c   Appendix A, sizes line
 *   eval drawdown, trailing      250,000c   500bp
 *   eval profit target           300,000c   600bp
 *   eval minimum trading days           1
 *   eval consistency             disabled
 *   funded drawdown, trailing    250,000c   500bp
 *   floor lock at profit         260,000c   = drawdown + 10,000 by CV-12
 *   locked floor               5,010,000c   size + 10,000, X = $100 (ADR-014)
 *   win days required                   5
 *   win day floor                 15,000c   30bp
 *   buffer                       100,000c   200bp
 *   funded consistency             3000bp
 *   funded minimum trading days         0   ADR-015, gate disabled
 *   cadence gap, trading days           5
 *   payout cap                   150,000c   300bp
 *   split to trader                9000bp
 *   ladder                              5   ADR-024
 *   minimum payout                10,000c   CV-15, never scaled by size
 *   daily loss limit                 none
 *
 * `plan_version_id` is the one `fixtures/plans/CORE-50K.json` carries, so a
 * reader comparing the two files is comparing the same plan.
 */
export const CORE_50K: ResolvedPlan = {
  planVersionId: '0199c7a1-0000-7000-8000-000000000001' as PlanVersionId,
  sizeCents: 5_000_000n,
  eval: {
    drawdown: {
      type: 'trailing_eod',
      drawdownCents: 250_000n,
      lock: { enabled: true, atProfitCents: 260_000n, floorAtCents: 5_010_000n },
    },
    dailyLossLimit: { type: 'none' },
    winDayFloorCents: 15_000n,
    profitTargetCents: 300_000n,
    minTradingDays: 1,
    consistency: { enabled: false },
    maxDays: null,
  },
  funded: {
    drawdown: {
      type: 'trailing_eod',
      drawdownCents: 250_000n,
      lock: { enabled: true, atProfitCents: 260_000n, floorAtCents: 5_010_000n },
    },
    dailyLossLimit: { type: 'none' },
    winDayFloorCents: 15_000n,
    minTradingDays: 0,
    winDaysRequiredCount: 5,
    consistency: { enabled: true, maxDayShareBp: bp(3000) },
    bufferCents: 100_000n,
    cadenceGapTradingDays: 5,
    payoutCapSchedule: [{ fromOrdinal: 1, capCents: 150_000n }],
    minPayoutCents: 10_000n,
    splitBp: bp(9000),
    maxPayouts: 5,
  },
};

/**
 * MERIT RAPID at 50K, from M01 Appendix A.2's 50K column.
 *
 * IT IS HERE FOR ONE REASON AND THE REASON IS A GATE NO OTHER V1 PLAN HAS.
 * Core EOD and Direct both carry `Eval consistency: disabled`; Merit Rapid
 * carries 3000bp. R-28, R-29 and R-30 are the eval consistency rules, so a
 * suite holding only CORE-50K could exercise them nowhere except through a
 * config it invented, and an invented config is a number with no source.
 *
 *   size                       5,000,000c   Appendix A, sizes line
 *   eval drawdown, trailing      250,000c   500bp
 *   eval profit target           300,000c   600bp
 *   eval minimum trading days           2   constitution 0.4
 *   eval consistency               3000bp   constitution 0.4
 *   funded drawdown, trailing    250,000c   500bp
 *   floor lock at profit         260,000c   = drawdown + 10,000 by CV-12
 *   locked floor               5,010,000c   size + 10,000, X = $100 (ADR-014)
 *   win days required                   3   ADR-018, and it sets the cadence
 *   win day floor                 15,000c   30bp
 *   buffer                       100,000c   200bp
 *   funded consistency             4000bp
 *   funded minimum trading days         0   ADR-015, gate disabled
 *   cadence gap, trading days           1   dominated by the win-day gate
 *   payout cap                   100,000c   200bp
 *   split to trader                9000bp
 *   ladder                              5   ADR-024
 *   minimum payout                10,000c   CV-15, never scaled by size
 *   daily loss limit                 none
 */
export const MERIT_RAPID_50K: ResolvedPlan = {
  planVersionId: '0199c7a1-0000-7000-8000-000000000002' as PlanVersionId,
  sizeCents: 5_000_000n,
  eval: {
    drawdown: {
      type: 'trailing_eod',
      drawdownCents: 250_000n,
      lock: { enabled: true, atProfitCents: 260_000n, floorAtCents: 5_010_000n },
    },
    dailyLossLimit: { type: 'none' },
    winDayFloorCents: 15_000n,
    profitTargetCents: 300_000n,
    minTradingDays: 2,
    consistency: { enabled: true, maxDayShareBp: bp(3000) },
    maxDays: null,
  },
  funded: {
    drawdown: {
      type: 'trailing_eod',
      drawdownCents: 250_000n,
      lock: { enabled: true, atProfitCents: 260_000n, floorAtCents: 5_010_000n },
    },
    dailyLossLimit: { type: 'none' },
    winDayFloorCents: 15_000n,
    minTradingDays: 0,
    winDaysRequiredCount: 3,
    consistency: { enabled: true, maxDayShareBp: bp(4000) },
    bufferCents: 100_000n,
    cadenceGapTradingDays: 1,
    payoutCapSchedule: [{ fromOrdinal: 1, capCents: 100_000n }],
    minPayoutCents: 10_000n,
    splitBp: bp(9000),
    maxPayouts: 5,
  },
};

/**
 * R-27's boundary, on both sides, without inventing a plan.
 *
 * CV-04 is `phase_eval.min_trading_days >= 1`, so both values this is called
 * with are configs `validatePlan` accepts. Moving the THRESHOLD rather than the
 * counter is what keeps the two sides of `>=` comparable: the same prior state
 * and the same mark produce a pass at N and no pass at N+1, so the only thing
 * that changed is the number the operator is applied to.
 */
export function withEvalMinTradingDays(plan: ResolvedPlan, minTradingDays: number): ResolvedPlan {
  if (plan.eval === null) throw new Error('the plan has no evaluation phase');
  return { ...plan, eval: { ...plan.eval, minTradingDays } };
}

/** R-32's configuration, which no published plan carries: `max_days` is null on all three. */
export function withEvalMaxDays(plan: ResolvedPlan, maxDays: number): ResolvedPlan {
  if (plan.eval === null) throw new Error('the plan has no evaluation phase');
  return { ...plan, eval: { ...plan.eval, maxDays } };
}

/**
 * A variant, and the two departures from CORE-50K are the only two.
 *
 * NO V1 PLAN CONFIGURES A STATIC DRAWDOWN OR A DAILY LOSS LIMIT (Appendix A:
 * every plan is `trailing_eod` and every daily loss limit is `none`), and R-16,
 * R-22 and R-23 are rules all the same. A config the lineup does not use is
 * still a config `validatePlan` will accept, which is precisely why the
 * operators have to be right before a plan enables one: nothing exercises them
 * in production until then, and by then this code will not be re-read.
 */
export function withStaticDrawdown(plan: ResolvedPlan): ResolvedPlan {
  return {
    ...plan,
    funded: {
      ...plan.funded,
      drawdown: { type: 'static', drawdownCents: 250_000n, lock: { enabled: false } },
    },
  };
}

/** R-22 and R-23's configuration, which no published plan carries. */
export function withDailyLossLimit(
  plan: ResolvedPlan,
  type: 'soft' | 'hard',
  limitCents: Cents,
): ResolvedPlan {
  return { ...plan, funded: { ...plan.funded, dailyLossLimit: { type, limitCents } } };
}

/**
 * R-33's boundary, on both sides, without inventing a plan.
 *
 * All three v1 plans configure funded `min_trading_days: 0`, which DISABLES the
 * gate (CV-19, ADR-015), so the published lineup can show the `skipped` half and
 * neither side of the `>=`. CV-19 admits any value `>= 0`, so both values this
 * is called with are configs `validatePlan` accepts.
 *
 * SAME SHAPE AS `withEvalMinTradingDays`: moving the THRESHOLD rather than the
 * counter is what keeps the two sides of `>=` comparable, because the same prior
 * and the same mark then pass at N and fail at N+1.
 */
export function withFundedMinTradingDays(plan: ResolvedPlan, minTradingDays: number): ResolvedPlan {
  return { ...plan, funded: { ...plan.funded, minTradingDays } };
}

/**
 * A LADDERED cap schedule, which no v1 plan carries and CV-09 fully specifies.
 *
 * Appendix A gives all three plans a single rung ("Payout cap, ordinal 1 and
 * up"), so R-42's "the LAST schedule entry whose `from_ordinal <= ordinal`" has
 * no published input that can distinguish it from "the only entry". CV-09 is
 * where the multi-rung shape is specified: "non-empty, starts at `from_ordinal:
 * 1`, ordinals strictly increase, every `cap_cents > 0`".
 *
 * SAME JUSTIFICATION AS `withStaticDrawdown` AND `withDailyLossLimit`: a config
 * the lineup does not use is still a config `validatePlan` will accept, "which
 * is precisely why the operators have to be right before a plan enables one".
 * The caller supplies the rungs, so no cap value is invented in this file and
 * each test states where the numbers it uses come from.
 */
export function withCapSchedule(
  plan: ResolvedPlan,
  payoutCapSchedule: readonly { readonly fromOrdinal: number; readonly capCents: Cents }[],
): ResolvedPlan {
  return { ...plan, funded: { ...plan.funded, payoutCapSchedule } };
}

/** The lock off, so a trailing floor can be watched trailing past where it would lock. */
export function withoutFloorLock(plan: ResolvedPlan): ResolvedPlan {
  return {
    ...plan,
    funded: {
      ...plan.funded,
      drawdown: { ...plan.funded.drawdown, lock: { enabled: false } },
    },
  };
}

/**
 * The fixture calendar's five sessions, in code.
 *
 * `fixtures/calendars/cme-2026.json` is `status: partial` and holds exactly
 * these five days with exactly this coverage, and it says why: "FIVE SESSIONS,
 * NOT A YEAR ... there is not one calendar row anywhere in this repository yet."
 *
 * `sequence` IS NOT THE POSITION IN THIS WINDOW. It is "a dense index into the
 * calendar" (M01 section 2.1), so it starts somewhere in the middle of the
 * exchange's own numbering; the base below is arbitrary and the spacing is not.
 * A slice whose sequence started at zero would let a test pass that had confused
 * a window offset for a calendar index, which is the confusion R-37's gap
 * subtraction cannot survive.
 */
export const CME_WINDOW: CalendarSlice = buildCalendarSlice({
  days: [
    { tradingDay: day('2026-11-02'), isHalfDay: false, halted: false, sequence: 4021 },
    { tradingDay: day('2026-11-03'), isHalfDay: false, halted: false, sequence: 4022 },
    { tradingDay: day('2026-11-04'), isHalfDay: false, halted: false, sequence: 4023 },
    { tradingDay: day('2026-11-05'), isHalfDay: false, halted: false, sequence: 4024 },
    { tradingDay: day('2026-11-06'), isHalfDay: false, halted: false, sequence: 4025 },
  ],
  coverage: { from: day('2026-11-02'), to: day('2026-11-06') },
});

/** The same window with one day's flags changed, for R-03 and R-04. */
export function windowWith(
  tradingDay: TradingDay,
  flags: { readonly isHalfDay?: boolean; readonly halted?: boolean },
): CalendarSlice {
  return buildCalendarSlice({
    days: CME_WINDOW.days.map((d) =>
      d.tradingDay === tradingDay
        ? {
            ...d,
            isHalfDay: flags.isHalfDay ?? d.isHalfDay,
            halted: flags.halted ?? d.halted,
          }
        : d,
    ),
    coverage: CME_WINDOW.coverage,
  });
}

/**
 * A funded account partway through its life, which is the state most of group C
 * and group D are stated against.
 *
 * `tradedDaysCount` is 1 rather than 0, and that is not decoration: INV-20 is
 * asserted at DO-3 exactly when a funded account has traded no day and settled
 * no payout, so a state with zero traded days is the FUNDED-START state and any
 * mark opening at something other than `size_cents` refuses. A floor test that
 * wanted a balance above size and got a `funded_start_not_size` refusal instead
 * would be a test failing for a reason that has nothing to do with the floor.
 */
export function fundedPrior(plan: ResolvedPlan, overrides: Partial<RuleState> = {}): RuleState {
  const floorCents = plan.sizeCents - plan.funded.drawdown.drawdownCents;
  return {
    ...initialState(plan, day('2026-11-02'), ENGINE_VERSION),
    phase: 'funded',
    floorOpenCents: floorCents,
    floorCents,
    highWaterBalanceCents: plan.sizeCents,
    tradedDaysCount: 1,
    ...overrides,
  };
}

/**
 * An eval account partway through its evaluation, which is what group E is
 * stated against.
 *
 * THE FIVE NUMBERS ARE NOT INDEPENDENT and stating them as overrides one at a
 * time is how a fixture drifts into a state the fold could never have produced.
 * The caller gives the balance and the consistency accumulators; the floor and
 * the high-water balance FOLLOW from R-12 and R-13 on an unlocked trailing plan,
 * so a prior built here is a prior `advanceDay` could have returned.
 *
 * `tradedDaysCount` defaults to 1 for the same reason `fundedPrior`'s does: an
 * account with zero traded days is a start state, and a test whose subject is
 * R-26 should not be answering an INV-20 question.
 */
export function evalPrior(
  plan: ResolvedPlan,
  fields: {
    readonly tradingDay?: TradingDay;
    readonly balanceCents?: Cents;
    readonly tradedDaysCount?: number;
    readonly consistencyBestDayCents?: Cents;
    readonly consistencyPeriodProfitCents?: Cents;
  } = {},
): RuleState {
  if (plan.eval === null) throw new Error('the plan has no evaluation phase');
  const balanceCents = fields.balanceCents ?? plan.sizeCents;

  // R-13 on an unlocked trailing plan: `hwb` is the running closing high, which
  // for a monotone climb is the current balance, and the floor is `hwb - dd`.
  const highWaterBalanceCents =
    balanceCents > plan.sizeCents ? balanceCents : (plan.sizeCents as Cents);
  const floorCents = highWaterBalanceCents - plan.eval.drawdown.drawdownCents;

  return {
    ...initialState(plan, fields.tradingDay ?? day('2026-11-02'), ENGINE_VERSION),
    balanceCents,
    floorOpenCents: floorCents,
    floorCents,
    highWaterBalanceCents,
    tradedDaysCount: fields.tradedDaysCount ?? 1,
    consistencyBestDayCents: fields.consistencyBestDayCents ?? 0n,
    consistencyPeriodProfitCents: fields.consistencyPeriodProfitCents ?? 0n,
  };
}

/** Every state in this suite carries it, so a diff on it is never a surprise. */
export const ENGINE_VERSION = 'test-engine';

/**
 * A mark whose identities hold, so a test that is not about DO-3 never trips it.
 *
 * INV-18 is `opening == prior.balance + adjustment` and INV-19 is `closing ==
 * opening + realized_pnl` (EC-157, `0036`). Both are satisfied by construction
 * here: the caller states the opening balance and the realized P&L, and the
 * closing balance is not a free parameter.
 */
export function mark(fields: {
  readonly tradingDay: TradingDay;
  readonly openingBalanceCents: Cents;
  readonly realizedPnlCents: Cents;
  readonly highBalanceCents?: Cents;
  readonly lowBalanceCents?: Cents;
  readonly adjustmentCents?: Cents;
  readonly fillCount?: number;
}): DailyMark {
  const closing = fields.openingBalanceCents + fields.realizedPnlCents;
  const high =
    fields.highBalanceCents ??
    (closing > fields.openingBalanceCents ? closing : fields.openingBalanceCents);
  const low =
    fields.lowBalanceCents ??
    (closing < fields.openingBalanceCents ? closing : fields.openingBalanceCents);

  return {
    tradingDay: fields.tradingDay,
    openingBalanceCents: fields.openingBalanceCents,
    closingBalanceCents: closing,
    highBalanceCents: high,
    lowBalanceCents: low,
    realizedPnlCents: fields.realizedPnlCents,
    adjustmentCents: fields.adjustmentCents ?? 0n,
    fillCount: fields.fillCount ?? 1,
    sourceHash: 'unit',
  };
}
