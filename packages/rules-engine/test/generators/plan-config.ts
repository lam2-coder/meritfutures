// =============================================================================
// packages/rules-engine/test/generators/plan-config.ts
// =============================================================================
// THE SHAPE A PUBLISHED PLAN HAS AFTER MATERIALIZATION, and nothing else.
//
// `plan_versions.rules` stores ratios in basis points; `plan_version_sizes`
// stores the cents those ratios materialize to at publish. CV-01 to CV-19 are
// stated across BOTH: CV-01 reads `drawdown.type` (structure), CV-02 reads
// `drawdown_cents` (materialized), and CV-11 reads `buffer_cents`,
// `floor_lock_floor_at_cents` and `size_cents` in one inequality. So the object
// the validator sees is the materialized one, which is also what `validatePlan`
// sees at `POST /admin/plans/versions/:id/publish`.
//
// M01: "The engine reads two things and never anything else: `plan_versions.rules`
// for structure and `plan_version_sizes` for every cents value. No percentage is
// ever applied to a money value at runtime."
//
// NO DEFAULT IS DECLARED IN THIS FILE and no field is optional. That is
// `types.ts`'s TIER 1 rule applied one layer out: a caller who has not read the
// account's pinned plan version must not be able to construct one of these.
// -----------------------------------------------------------------------------
// ON `max_payouts` VERSUS CV-14's `ladder.payouts_to_graduate`
// -----------------------------------------------------------------------------
// The CV table in M01 spells CV-14 as `ladder.payouts_to_graduate >= 1`.
// ADR-030 RULED THE CANONICAL NAME IS `max_payouts`, DATA_MODEL section 11
// carries it, and the note there says "the zod schema and the CV publish
// validations key off this name". This file follows the ADR, and the drift in
// CV-14's own text is recorded in the session log rather than silently absorbed.
// =============================================================================

/** `plan_versions.rules.*.drawdown.type`. CV-01's vocabulary plus the value it rejects. */
export type DrawdownType = 'trailing_eod' | 'static' | 'intraday_trailing';

/** CV-16's vocabulary. */
export type DailyLossLimitType = 'none' | 'soft' | 'hard';

export interface FloorLock {
  readonly enabled: boolean;
  /** CV-12's left-hand side. Null exactly when the lock is disabled. */
  readonly at_profit_cents: number | null;
  /** CV-11's and CV-12's `floor_lock_floor_at_cents`. Null exactly when disabled. */
  readonly floor_at_cents: number | null;
}

export interface Drawdown {
  readonly type: DrawdownType;
  /** Materialized from `amount_bp` at publish. CV-02. */
  readonly drawdown_cents: number;
  readonly lock: FloorLock;
}

export interface DailyLossLimit {
  readonly type: DailyLossLimitType;
  /** CV-16: present when the type is not `none`. */
  readonly amount_cents: number | null;
}

export interface Consistency {
  readonly enabled: boolean;
  /** CV-06, when enabled. */
  readonly max_day_share_bp: number | null;
  readonly mode: 'pass_time_dilutable' | 'payout_gated';
}

export interface CapScheduleStep {
  readonly from_ordinal: number;
  /** Materialized from `cap_bp`. CV-09, CV-10, CV-17. */
  readonly cap_cents: number;
}

export interface PhaseEval {
  readonly enabled: boolean;
  /** CV-03, when the phase is enabled. */
  readonly profit_target_cents: number;
  readonly drawdown: Drawdown;
  readonly daily_loss_limit: DailyLossLimit;
  /** CV-04. */
  readonly min_trading_days: number;
  readonly consistency: Consistency;
  readonly max_days: number | null;
}

export interface WinDays {
  /** CV-05, first half. */
  readonly required_count: number;
  /** CV-05, second half. Materialized from `floor_bp`. */
  readonly win_day_floor_cents: number;
  readonly reset_on_payout: boolean;
}

export interface PhaseFunded {
  readonly drawdown: Drawdown;
  readonly daily_loss_limit: DailyLossLimit;
  /** CV-19. Zero means the gate is disabled, and must report `skipped: true`. */
  readonly min_trading_days: number;
  readonly win_days: WinDays;
  readonly consistency: Consistency;
  /** CV-07, CV-11. */
  readonly buffer_cents: number;
  /** CV-08. */
  readonly cadence_gap_trading_days: number;
  /** CV-09, CV-10, CV-17. An array from day one, per DATA_MODEL section 11. */
  readonly payout_cap_schedule: readonly CapScheduleStep[];
  /** CV-15. Fixed at 10,000 and never scaled by size. */
  readonly min_payout_cents: number;
  /** CV-13. */
  readonly split_bp: number;
  /** CV-14, under ADR-030's canonical name. */
  readonly max_payouts: number;
  /** CV-18. Retired but retained, per ADR-014. */
  readonly post_payout_floor_rule: { readonly mode: string };
}

/**
 * One published plan at one size, as `validatePlan` sees it at publish time.
 *
 * `size_cents` is `plan_version_sizes.size_cents` and is carried at the top
 * because CV-11 and CV-12 are inequalities across the rules and the size row.
 */
export interface MaterializedPlan {
  readonly schema_version: 1;
  readonly size_cents: number;
  readonly phase_eval: PhaseEval;
  readonly phase_funded: PhaseFunded;
}
