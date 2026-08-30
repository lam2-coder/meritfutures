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

import type { AccountDay } from '../src/batch/ports.ts';

export const td = (s: string): TradingDay => s as TradingDay;
/** INV-03. Ratios are integer basis points, and the brand is what says so. */
export const bp = (n: number): BasisPoints => n as BasisPoints;

export const ACCOUNT_A = '0f8fad5b-d9cb-469f-a165-70867728950e';
export const ACCOUNT_B = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
/** The identity both accounts hang off. `accounts.identity_id` is `uuid NOT NULL`. */
export const IDENTITY_A = 'b1f6f0de-3e2a-4a4d-9f38-2c5f8d6a1c40';
/** One `kyc_verifications` row's id, so a chain can be built from two of them. */
export const KYC_INITIAL = 'c2a7f19b-5d34-4c8e-8b21-9e0d7a4f3b52';
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

// =============================================================================
// THE SAME PLAN AND THE SAME DAY, AS THE ROWS THAT HOLD THEM
// =============================================================================
// EXTRACTED FOR THIS FILE'S OWN REASON, ONE LAYER DOWN. `PLAN` above is
// Appendix A.1 transcribed as a VALUE; everything below is the same contract as
// the ROWS `plan_versions` and `plan_version_sizes` hold, taken from `DATA_MODEL`
// section 11's example and the materialization `0004_catalog.sql` describes.
// `account-day.test.ts` reads them through the adapter and asserts the result
// equals `PLAN`, and `entrypoint-harness.ts` runs the real batch over them; two
// hand-copies of a stored plan are two things that drift apart, and the drift
// would be invisible because each copy would still resolve to something.

/** THE `jsonb` ROUND TRIP. `ADR-206` section 5 measured this leg as the lossy one. */
export const storedJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;

export const PLAN_VERSION_ID = 'core-eod-v1';

/** `plan_versions.rules` for Core EOD, as `DATA_MODEL` section 11 writes it. */
export const CORE_EOD_RULES = {
  schema_version: 1,
  phase_eval: {
    enabled: true,
    profit_target_bp: 600,
    drawdown: {
      type: 'trailing_eod',
      amount_bp: 500,
      lock: { enabled: false, at_profit_cents: null, floor_at_cents: null },
    },
    daily_loss_limit: { type: 'none', amount_bp: null },
    min_trading_days: 1,
    consistency: { enabled: false, max_day_share_bp: null, mode: 'pass_time_dilutable' },
    max_days: null,
  },
  phase_funded: {
    drawdown: {
      type: 'trailing_eod',
      amount_bp: 500,
      lock: { enabled: true, at_profit_cents: null, floor_at_cents: null },
    },
    daily_loss_limit: { type: 'none', amount_bp: null },
    min_trading_days: 0,
    win_days: { required_count: 5, floor_bp: 30, reset_on_payout: true },
    consistency: { enabled: true, max_day_share_bp: 3000, mode: 'payout_gated' },
    buffer_bp: 200,
    cadence_gap_trading_days: 5,
    // M01 section 2.4 REQUIRES this key and DATA_MODEL section 11's example does
    // not carry it, which `types.ts` records at the field. It is here at
    // ADR-019's v1 value because a row the adapter can read has to carry it, and
    // the disagreement is reported rather than folded.
    min_settlement_lag_trading_days: 0,
    payout_cap_schedule: [{ from_ordinal: 1, cap_bp: 300 }],
    min_payout_cents: 10000,
    split_bp: 9000,
    max_payouts: 5,
    post_payout_floor_rule: { mode: 'none' },
  },
};

/** One row, in the property names `packages/db/src/schema.ts` declares. */
export type StoredRow = Record<string, unknown>;

export const planVersionRow = (rules: unknown = CORE_EOD_RULES): StoredRow => ({
  id: PLAN_VERSION_ID,
  rules: storedJson(rules),
});

/**
 * The 50K size row, materialized as `0004_catalog.sql` describes.
 *
 * `floor_lock_floor_at_cents` is `size_cents + 10000` and
 * `floor_lock_at_profit_cents` is `drawdown_cents + 10000`, which is
 * `DATA_MODEL` section 11's M1-gate amendment stated for all three plans.
 */
export const sizeRow = (overrides: StoredRow = {}): StoredRow => ({
  planVersionId: PLAN_VERSION_ID,
  sizeCents: 5_000_000n,
  drawdownCents: 250_000n,
  profitTargetCents: 300_000n,
  bufferCents: 100_000n,
  winDayFloorCents: 15_000n,
  payoutCapScheduleCents: storedJson([{ from_ordinal: 1, cap_cents: 150_000 }]),
  dailyLossLimitCents: null,
  floorLockEnabled: true,
  floorLockAtProfitCents: 260_000n,
  floorLockFloorAtCents: 5_010_000n,
  ...overrides,
});

/** `0004:220`'s grid: four sizes on one version, and only one is any account's. */
export const sizeGrid = (): readonly StoredRow[] => [
  sizeRow({ sizeCents: 2_500_000n, drawdownCents: 125_000n, profitTargetCents: 150_000n }),
  sizeRow(),
  sizeRow({ sizeCents: 10_000_000n, drawdownCents: 500_000n, profitTargetCents: 600_000n }),
  sizeRow({ sizeCents: 15_000_000n, drawdownCents: 750_000n, profitTargetCents: 900_000n }),
];

// THE FOUR CONTEXT COLUMNS ARE HERE BECAUSE `ADR-260` READS THEM AND NOT AS
// PADDING. `identity_id`, `status`, `payouts_frozen` and `recon_blocked` are all
// `NOT NULL` in `0007`, so a fixture without them is a row the schema cannot
// hold; the defaults are the CLEAR account, matching `CLEAR` above, and every
// case that is about a veto overrides one of them.
export const accountRow = (overrides: StoredRow = {}): StoredRow => ({
  id: ACCOUNT_A,
  identityId: IDENTITY_A,
  planVersionId: PLAN_VERSION_ID,
  sizeCents: 5_000_000n,
  status: 'active',
  openedOn: DAY_ONE.tradingDay,
  payoutsFrozen: false,
  reconBlocked: false,
  ...overrides,
});

/** One `identities` row. `payouts_frozen` is the OWNER's half of the freeze. */
export const identityRow = (overrides: StoredRow = {}): StoredRow => ({
  id: IDENTITY_A,
  status: 'active',
  payoutsFrozen: false,
  ...overrides,
});

/**
 * One `kyc_verifications` row.
 *
 * `supersedes` DEFAULTS TO `null`, which `0003`'s CHECK makes the shape of an
 * INITIAL verification, so one call is a one-row chain whose head is itself.
 */
export const kycRow = (overrides: StoredRow = {}): StoredRow => ({
  id: KYC_INITIAL,
  identityId: IDENTITY_A,
  state: 'verified',
  supersedes: null,
  ...overrides,
});

/** `daily_marks.source_hash` is `bytea`, so the fixture holds BYTES. */
export const SOURCE_BYTES = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);

export const markRow = (overrides: StoredRow = {}): StoredRow => ({
  accountId: ACCOUNT_A,
  tradingDay: DAY_ONE.tradingDay,
  openingBalanceCents: DAY_ONE.openingBalanceCents,
  closingBalanceCents: DAY_ONE.closingBalanceCents,
  highBalanceCents: DAY_ONE.highBalanceCents,
  lowBalanceCents: DAY_ONE.lowBalanceCents,
  realizedPnlCents: DAY_ONE.realizedPnlCents,
  adjustmentCents: DAY_ONE.adjustmentCents,
  fillCount: DAY_ONE.fillCount,
  // STORED AND NOT READ. The engine DERIVES both (R-08, R-09), and a reader that
  // took them would be an engine trusting the ingester's arithmetic.
  tradedDay: true,
  winDay: true,
  sourceHash: SOURCE_BYTES,
  supersededBy: null,
  ...overrides,
});

/** What `markRow()` should resolve to: `DAY_ONE` with the hex of `SOURCE_BYTES`. */
export const LIVE_MARK: DailyMark = { ...DAY_ONE, sourceHash: 'deadbeef' };
