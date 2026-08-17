// =============================================================================
// packages/rules-engine/test/published-plans-in-code.ts
// =============================================================================
// APPENDIX A's THREE PLANS IN THE SHAPE THEY ARE STORED IN, which is the shape
// `resolvePlan` and `validatePlan` take.
//
// `fixtures-in-code.ts` IS THE SAME PLANS AFTER RESOLUTION, and the pairing is
// the point. That file holds `CORE_50K` and `MERIT_RAPID_50K` as `ResolvedPlan`
// values, transcribed from Appendix A by a session that had not written
// `resolvePlan`; this file holds the `plan_versions.rules` jsonb and the
// `plan_version_sizes` row the same numbers arrive in. `plan-resolve.test.ts`
// asserts that resolving one produces the other, which makes two independent
// transcriptions of Appendix A check each other rather than a function checking
// its own output.
//
// EVERY NUMBER CARRIES ITS APPENDIX A ROW, on the rule `fixtures-in-code.ts`
// states: "A number here that cannot be traced is the defect this comment
// exists to make visible."
// =============================================================================

import type {
  Cents,
  PlanRulesJson,
  PlanVersionId,
  PlanVersionSizeRow,
  PublishedEvalPhase,
  PublishedFundedPhase,
} from '../src/types.js';

// -----------------------------------------------------------------------------
// Appendix A.1: Core EOD at 50K
// -----------------------------------------------------------------------------

export const c = (n: number): Cents => BigInt(n);

export const CORE_EVAL: PublishedEvalPhase = {
  enabled: true,
  profit_target_bp: 600, //                       A.1 eval profit target
  drawdown: {
    type: 'trailing_eod', //                      A.1 eval drawdown, trailing EOD
    amount_bp: 500,
    lock: { enabled: false, at_profit_cents: null, floor_at_cents: null },
  },
  daily_loss_limit: { type: 'none', amount_bp: null }, // A.1 daily loss limit: none
  min_trading_days: 1, //                         A.1 eval minimum trading days
  consistency: { enabled: false, max_day_share_bp: null, mode: 'pass_time_dilutable' },
  max_days: null, //                              R-32, null in all v1 plans
};

export const CORE_FUNDED: PublishedFundedPhase = {
  drawdown: {
    type: 'trailing_eod', //                      A.1 funded drawdown, trailing EOD
    amount_bp: 500,
    lock: { enabled: true, at_profit_cents: null, floor_at_cents: null }, // A.1 floor lock enabled
  },
  daily_loss_limit: { type: 'none', amount_bp: null },
  min_trading_days: 0, //                         A.1, ADR-015, gate disabled
  win_days: { required_count: 5, floor_bp: 30, reset_on_payout: true }, // A.1 win days required
  consistency: { enabled: true, max_day_share_bp: 3000, mode: 'payout_gated' }, // A.1 funded consistency
  buffer_bp: 200, //                              A.1 buffer
  cadence_gap_trading_days: 5, //                 A.1 cadence gap, trading days
  min_settlement_lag_trading_days: 0, //          ADR-019, the wallet's instant internal leg
  payout_cap_schedule: [{ from_ordinal: 1, cap_bp: 300 }], // A.1 payout cap, ordinal 1 and up
  min_payout_cents: c(10_000), //                 A preamble, GLOSSARY, CV-15
  split_bp: 9000, //                              A.1 split to trader
  max_payouts: 5, //                              A.1 ladder, ADR-024
  post_payout_floor_rule: { mode: 'none' }, //    A preamble, ADR-014, CV-18
};

export const CORE_50K_SIZE: PlanVersionSizeRow = {
  // `fixtures/plans/CORE-50K.json`, whose own note says it is transcribed from
  // Appendix A.1 and from nowhere else.
  plan_version_id: '0199c7a1-0000-7000-8000-000000000001' as PlanVersionId,
  size_cents: c(5_000_000), //                    A preamble: 50K is 5,000,000c
  drawdown_cents: c(250_000), //                  A.1, 500bp of 5,000,000
  profit_target_cents: c(300_000), //             A.1, 600bp
  buffer_cents: c(100_000), //                    A.1, 200bp
  win_day_floor_cents: c(15_000), //              A.1, 30bp
  payout_cap_schedule_cents: [{ from_ordinal: 1, cap_cents: c(150_000) }], // A.1, 300bp
  daily_loss_limit_cents: null, //                A.1 daily loss limit: none
  floor_lock_enabled: true,
  floor_lock_at_profit_cents: c(260_000), //      A.1, = drawdown + 10,000 by CV-12
  floor_lock_floor_at_cents: c(5_010_000), //     A.1 locked floor, size + 10,000
};

export function coreRules(
  over: {
    evalPhase?: Partial<PublishedEvalPhase>;
    funded?: Partial<PublishedFundedPhase>;
  } = {},
): PlanRulesJson {
  return {
    schema_version: 1,
    phase_eval: { ...CORE_EVAL, ...over.evalPhase },
    phase_funded: { ...CORE_FUNDED, ...over.funded },
  };
}

export const coreSize = (over: Partial<PlanVersionSizeRow> = {}): PlanVersionSizeRow => ({
  ...CORE_50K_SIZE,
  ...over,
});

// -----------------------------------------------------------------------------
// Appendix A.2: Merit Rapid at 50K, and A.3: Direct at 50K
// -----------------------------------------------------------------------------
// TWO MORE PLANS BECAUSE A.4 CHECKS THREE, and because each carries a case the
// Core row cannot: Merit Rapid is the only plan with an ENABLED EVAL
// CONSISTENCY (CV-06 on the eval phase) and the only PW-02b; Direct is the only
// plan with a DISABLED EVAL PHASE (CV-03's precondition false) and a drawdown
// that is not 500bp.

export const RAPID_RULES: PlanRulesJson = {
  schema_version: 1,
  phase_eval: {
    ...CORE_EVAL,
    min_trading_days: 2, //                       A.2 eval minimum trading days
    consistency: { enabled: true, max_day_share_bp: 3000, mode: 'pass_time_dilutable' }, // A.2
  },
  phase_funded: {
    ...CORE_FUNDED,
    win_days: { required_count: 3, floor_bp: 30, reset_on_payout: true }, // A.2, ADR-018 w=3
    consistency: { enabled: true, max_day_share_bp: 4000, mode: 'payout_gated' }, // A.2
    cadence_gap_trading_days: 1, //               A.2, dominated by the win-day gate
    payout_cap_schedule: [{ from_ordinal: 1, cap_bp: 200 }], // A.2 payout cap
  },
};

export const RAPID_50K_SIZE: PlanVersionSizeRow = {
  ...CORE_50K_SIZE,
  payout_cap_schedule_cents: [{ from_ordinal: 1, cap_cents: c(100_000) }], // A.2, 200bp
};

export const DIRECT_RULES: PlanRulesJson = {
  schema_version: 1,
  phase_eval: {
    ...CORE_EVAL,
    enabled: false, //                            A.3 eval phase: disabled
    drawdown: { ...CORE_EVAL.drawdown, amount_bp: 400 }, // matched to funded, see MZ-per-phase
  },
  phase_funded: {
    ...CORE_FUNDED,
    drawdown: {
      type: 'trailing_eod',
      amount_bp: 400, //                          A.3 funded drawdown
      lock: { enabled: true, at_profit_cents: null, floor_at_cents: null },
    },
    consistency: { enabled: true, max_day_share_bp: 2500, mode: 'payout_gated' }, // A.3
    buffer_bp: 300, //                            A.3 buffer
    max_payouts: 4, //                            A.3 ladder, set to 4 at the FREEZE gate
  },
};

export const DIRECT_50K_SIZE: PlanVersionSizeRow = {
  ...CORE_50K_SIZE,
  drawdown_cents: c(200_000), //                  A.3, 400bp
  profit_target_cents: null, //                   A.3: no evaluation, so no target
  buffer_cents: c(150_000), //                    A.3, 300bp
  floor_lock_at_profit_cents: c(210_000), //      A.3, = 200,000 + 10,000 by CV-12
};
