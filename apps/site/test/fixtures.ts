// =============================================================================
// apps/site/test/fixtures.ts
// =============================================================================
// CONFIG THE SUITES RENDER FROM, AND NEVER AN EXPECTED STRING.
//
// M9 section 8.3 is the rule every suite in this package obeys: "Every value
// rendered on a public page is asserted equal to the same value fetched from
// the API in the same test run. Not a snapshot of an expected number: a
// comparison against the source. A snapshot test of a price page proves the
// page has not changed, which is precisely the wrong property for a page whose
// job is to change with its configuration."
//
// SO THE NUMBERS BELOW ARE INPUTS AND NOT ANSWERS. Every assertion in this
// package derives its expectation from this fixture through the same helper the
// page uses, so changing a value here changes both sides and the test still
// proves something. An assertion written against a literal `'$25,000.00'` would
// go green on a page that had stopped reading config at all, which is the one
// property these suites exist to refuse.
//
// The shapes are `@merit/rules-engine`'s, which are its own transcription of
// `0004_catalog.sql`. Building them here rather than importing the engine's
// generators is forced: `packages/rules-engine` publishes `.` and nothing else,
// so `test/generators/plan-config.ts` is not reachable from this package.
// =============================================================================

import type { Cents, PlanRulesJson, PlanVersionId, PlanVersionSizeRow } from '@merit/rules-engine';

import type {
  BuiltAt,
  MarketedSizeLabel,
  SitePlanVersionView,
  SiteSizeView,
} from '../src/catalog/types.js';
import { marketedSizeLabel } from '../src/catalog/types.js';

const VERSION_ID = '00000000-0000-4000-8000-000000000001' as PlanVersionId;

/** A `plan_version_sizes` row. Every field overridable, none of them an answer. */
export function sizeRow(overrides: Partial<PlanVersionSizeRow> = {}): PlanVersionSizeRow {
  return {
    plan_version_id: VERSION_ID,
    size_cents: 2_500_000n as Cents,
    drawdown_cents: 100_000n as Cents,
    profit_target_cents: 150_000n as Cents,
    buffer_cents: 20_000n as Cents,
    win_day_floor_cents: 15_000n as Cents,
    payout_cap_schedule_cents: [{ from_ordinal: 1, cap_cents: 150_000n as Cents }],
    daily_loss_limit_cents: null,
    floor_lock_enabled: false,
    floor_lock_at_profit_cents: null,
    floor_lock_floor_at_cents: null,
    ...overrides,
  };
}

/** One purchasable size as a public surface sees it. */
export function sizeView(overrides: Partial<SiteSizeView> = {}): SiteSizeView {
  return {
    row: sizeRow(),
    price_cents: 16_500n as Cents,
    reset_price_cents: 10_000n as Cents,
    marketed_size_label: null,
    ...overrides,
  };
}

/** A label, through the constructor that carries SD-M9-04's CHECK. */
export function label(raw: string): MarketedSizeLabel {
  return marketedSizeLabel(raw);
}

/**
 * `plan_versions.rules`.
 *
 * `win_days.required_count` and `cadence_gap_trading_days` are the two fields
 * INV-M9-08 turns on, and they are set here at ADR-018's ruled shape: a plan
 * whose cadence is bound by its win-day gate and whose 1 day gap is dominated.
 * The cadence suites vary them; nothing reads them from anywhere else.
 */
export function rules(overrides: DeepPartialRules = {}): PlanRulesJson {
  const base: PlanRulesJson = {
    schema_version: 1,
    phase_eval: {
      enabled: true,
      profit_target_bp: 600,
      drawdown: {
        type: 'trailing_eod',
        amount_bp: 400,
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
        amount_bp: 400,
        lock: { enabled: false, at_profit_cents: null, floor_at_cents: null },
      },
      daily_loss_limit: { type: 'none', amount_bp: null },
      min_trading_days: 0,
      win_days: { required_count: 3, floor_bp: 60, reset_on_payout: true },
      consistency: { enabled: true, max_day_share_bp: 4000, mode: 'payout_gated' },
      buffer_bp: 80,
      cadence_gap_trading_days: 1,
      min_settlement_lag_trading_days: 0,
      payout_cap_schedule: [{ from_ordinal: 1, cap_bp: 600 }],
      min_payout_cents: 50_000n as Cents,
      split_bp: 9000,
      max_payouts: 5,
      post_payout_floor_rule: { mode: 'retained' },
    },
  };

  return {
    ...base,
    phase_eval: { ...base.phase_eval, ...overrides.phase_eval },
    phase_funded: { ...base.phase_funded, ...overrides.phase_funded },
  };
}

/** What {@link rules} accepts. One level deep, which is all any suite needs. */
export interface DeepPartialRules {
  readonly phase_eval?: Partial<PlanRulesJson['phase_eval']>;
  readonly phase_funded?: Partial<PlanRulesJson['phase_funded']>;
}

/** One `plan_versions` row and its sizes, as a public surface sees it. */
export function versionView(overrides: Partial<SitePlanVersionView> = {}): SitePlanVersionView {
  return {
    plan_id: '00000000-0000-4000-8000-0000000000a1',
    plan_code: 'merit_rapid',
    plan_name: 'Merit Rapid',
    version: 1,
    public_slug: 'merit-rapid-v1',
    public_visible: true,
    published_at: '2026-08-14T00:00:00.000Z',
    superseded_by: null,
    rules: rules(),
    copy_blocks: {},
    sizes: [sizeView()],
    ...overrides,
  };
}

/** The build stamp INV-M9-03 puts on every page. Supplied, never read. */
export const BUILT_AT = '2026-08-21T00:00:00.000Z' as BuiltAt;
