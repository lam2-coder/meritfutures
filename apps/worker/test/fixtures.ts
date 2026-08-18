// =============================================================================
// apps/worker/test/fixtures.ts
// =============================================================================
// The batch's shared fixtures. NOT a `.test.ts`, so vitest's `unit` project
// does not collect it (`vitest.config.ts`'s include is `test/**/*.test.ts`).
//
// EXTRACTED SO APPENDIX A.1 IS TRANSCRIBED ONCE. `nightly-batch.test.ts` and
// `replay.test.ts` both need Core EOD at 50K, and two hand-copies of a plan
// table are two things that drift apart. TR-01's point is that a fixture comes
// from the plan document; it follows that it should come from it once.
// =============================================================================

import {
  buildCalendarSlice,
  type BasisPoints,
  type CalendarDay,
  type CalendarSlice,
  type DailyMark,
  type ExternalGates,
  type PlanVersionId,
  type ResolvedPlan,
  type TradingDay,
} from '@merit/rules-engine';

import type { AccountDay } from '../src/batch/ports.js';

export const td = (s: string): TradingDay => s as TradingDay;
/** INV-03. Ratios are integer basis points, and the brand is what says so. */
export const bp = (n: number): BasisPoints => n as BasisPoints;

export const ACCOUNT_A = '0f8fad5b-d9cb-469f-a165-70867728950e';
export const ACCOUNT_B = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
export const ENGINE_VERSION = 'engine-test';

// -----------------------------------------------------------------------------
// Core EOD at 50K, transcribed from M01 Appendix A.1's 50K column
// -----------------------------------------------------------------------------
// Every number here has a row in that table. `resolvePlan` is P2-1 and does not
// exist, so the resolved shape is built by hand; when it lands, this becomes a
// call rather than a literal.

export const PLAN: ResolvedPlan = {
  planVersionId: 'core-eod-v1' as PlanVersionId,
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

export const WINDOW: readonly CalendarDay[] = [
  { tradingDay: td('2026-08-10'), isHalfDay: false, halted: false, sequence: 9001 },
  { tradingDay: td('2026-08-11'), isHalfDay: false, halted: false, sequence: 9002 },
  { tradingDay: td('2026-08-12'), isHalfDay: false, halted: false, sequence: 9003 },
  { tradingDay: td('2026-08-13'), isHalfDay: false, halted: false, sequence: 9004 },
  { tradingDay: td('2026-08-14'), isHalfDay: false, halted: false, sequence: 9005 },
];

export const CALENDAR: CalendarSlice = buildCalendarSlice({
  days: WINDOW,
  coverage: { from: td('2026-08-10'), to: td('2026-08-14') },
});

/** Nothing in context blocks the account. Varied where a test is about context. */
export const CLEAR: ExternalGates = {
  accountStatus: 'active',
  kycState: 'verified',
  payoutsFrozen: false,
  reconBlocked: false,
  hasPayoutInFlight: false,
};

/**
 * The account's first day: `prior` is null, so the fold opens the account
 * itself. INV-18 then reads against `initialState`'s balance, which is why the
 * opening is `size_cents` exactly and the adjustment is zero.
 */
export const DAY_ONE: DailyMark = {
  tradingDay: td('2026-08-10'),
  openingBalanceCents: 5_000_000n,
  closingBalanceCents: 5_030_000n,
  highBalanceCents: 5_035_000n,
  lowBalanceCents: 4_990_000n,
  realizedPnlCents: 30_000n,
  adjustmentCents: 0n,
  fillCount: 3,
  sourceHash: 'day-one',
};

export const accountDay = (accountId: string, overrides: Partial<AccountDay> = {}): AccountDay => ({
  accountId,
  plan: PLAN,
  prior: null,
  mark: DAY_ONE,
  settlements: [],
  external: CLEAR,
  // R-32's anchor (ADR-051). No plan in this file sets `phase_eval.max_days`,
  // so the rule never reads it; it is required so it cannot go missing where it
  // WOULD be read.
  openedOn: DAY_ONE.tradingDay,
  ...overrides,
});
