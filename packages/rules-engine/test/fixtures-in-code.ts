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

const bp = (n: number): BasisPoints => n as BasisPoints;

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
