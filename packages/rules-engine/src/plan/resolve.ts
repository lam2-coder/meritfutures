// =============================================================================
// packages/rules-engine/src/plan/resolve.ts
// =============================================================================
// `plan_versions.rules` PLUS ONE `plan_version_sizes` ROW, TO THE VALUE THE FOLD
// READS. M01 section 1.3:
//
//   export function resolvePlan(rules: PlanRulesJson, size: PlanVersionSizeRow): ResolvedPlan;
//
// THIS FUNCTION APPLIES NO PERCENTAGE AND THAT IS ITS WHOLE DISCIPLINE. M01
// section 2.4: "The engine reads two things and never anything else ...
// **No percentage is ever applied to a money value at runtime.** That single
// rule is what makes the marketing page and the engine agree to the cent,
// because both read the same materialized number."
//
// So every `_bp` field on `PlanRulesJson` is read for STRUCTURE or ignored, and
// every cents value is copied from the size row. `amount_bp`, `profit_target_bp`,
// `floor_bp`, `buffer_bp` and `cap_bp` are never multiplied by anything here. If
// a future edit makes this file compute `size_cents * amount_bp / 10000`, it has
// reintroduced the one-cent drift `plan_version_sizes` exists to prevent, and
// `RE-U-017`'s sibling in `plan-resolve.test.ts` is what notices.
//
// -----------------------------------------------------------------------------
// IT REFUSES RATHER THAN NARROWING, AND THAT REFUSAL IS R-17
// -----------------------------------------------------------------------------
// `PublishedDrawdownType` has three members and `DrawdownType` has two. The
// third is `intraday_trailing`, which R-17 calls "config-supported and
// unimplemented" and CV-01 rejects at publish.
//
// A resolver that quietly mapped the third onto `trailing_eod` would be exactly
// what R-17 forbids: "Publishing it must fail loudly, never compute something
// plausible (GS-078)." So it THROWS, and it throws in `errors.ts`'s second
// class, the one `capForOrdinal` opened: "a config `validatePlan` must have
// rejected at publish, arriving anyway". There is no assertion channel out of a
// function that returns a plan, and there is no plausible drawdown to fall back
// on, because picking one would hand an account a floor rule nobody published.
// =============================================================================

import { EngineInvariantError } from '../errors.ts';
import type {
  BasisPoints,
  CapScheduleStep,
  Cents,
  ConsistencyRules,
  DailyLossLimitRules,
  DrawdownRules,
  DrawdownType,
  EvalPhaseRules,
  FloorLockRules,
  FundedPhaseRules,
  PlanRulesJson,
  PlanVersionSizeRow,
  PublishedConsistency,
  PublishedDailyLossLimit,
  PublishedDrawdown,
  ResolvedPlan,
} from '../types.ts';

/**
 * CV-01's narrowing, and the only place the three-member union becomes the
 * two-member one.
 */
function resolveDrawdownType(published: PublishedDrawdown['type'], phase: string): DrawdownType {
  if (published === 'trailing_eod' || published === 'static') return published;
  throw new EngineInvariantError(
    'CV-01',
    `${phase}.drawdown.type is "${published}", which R-17 leaves unimplemented in v1 and CV-01 rejects at publish`,
  );
}

/**
 * R-15's parameters, as a discriminated union.
 *
 * THE FLAG READ IS THE SIZE ROW's, NOT THE JSONB's, for the reason SD-10 gives:
 * `floor_lock_enabled` was materialized here so a CHECK constraint could see it,
 * and the cents that go with it are on the same row. Reading the enabling flag
 * from one place and its two values from another is how the two copies drift
 * apart without anybody noticing; `validatePlan`'s `MZ-lock-flag` is what holds
 * them together before either reaches this function.
 *
 * SO BOTH RESOLVED PHASES CARRY THE SAME LOCK, AND THE EVAL PHASE LOCKING IS
 * RULED RATHER THAN INFERRED. There is one `floor_lock_enabled` column and
 * `0004_catalog.sql` names its source as `phase_funded.drawdown.lock.enabled`,
 * so the eval phase's own `lock` block in the jsonb is never read. That the eval
 * floor nonetheless locks is ADR-050's arithmetic: "the lock triggers at
 * 260,000c of profit and the eval target is 300,000c, so EVERY v1 eval pass is
 * also a lock day", and GS-019's eval floor of 5,150,000c on the pass day is
 * computed from exactly that. DATA_MODEL section 11's example carries
 * `phase_eval ... lock.enabled: false`, which is a field nothing materializes
 * and nothing reads; the disagreement is reported rather than folded.
 */
function resolveLock(size: PlanVersionSizeRow): FloorLockRules {
  if (!size.floor_lock_enabled) return { enabled: false };

  const atProfitCents = size.floor_lock_at_profit_cents;
  const floorAtCents = size.floor_lock_floor_at_cents;
  if (atProfitCents === null || floorAtCents === null) {
    // SD-10's CHECK makes this unreachable from a stored row, and the union
    // makes it unrepresentable downstream. What is left is a row that never went
    // through the constraint, and R-15's lock is permanent: resolving it with a
    // missing value would give the account a floor that locks at a number nobody
    // published, for the life of the account.
    throw new EngineInvariantError(
      'SD-10',
      'floor_lock_enabled is true with a null floor_lock_at_profit_cents or floor_lock_floor_at_cents',
    );
  }
  return { enabled: true, atProfitCents, floorAtCents };
}

function resolveDrawdown(
  published: PublishedDrawdown,
  size: PlanVersionSizeRow,
  phase: string,
): DrawdownRules {
  return {
    type: resolveDrawdownType(published.type, phase),
    // ONE COLUMN, BOTH PHASES. `plan_version_sizes` materializes a single
    // `drawdown_cents` while `rules` declares a drawdown per phase, and all
    // three v1 plans set the two equal. `validatePlan`'s `MZ-per-phase` refuses
    // the publish when they differ, which is what makes this copy safe rather
    // than a silent choice between two numbers.
    drawdownCents: size.drawdown_cents,
    lock: resolveLock(size),
  };
}

function resolveConsistency(published: PublishedConsistency): ConsistencyRules {
  if (!published.enabled) return { enabled: false };
  if (published.max_day_share_bp === null) {
    throw new EngineInvariantError(
      'CV-06',
      'consistency is enabled with a null max_day_share_bp, which CV-06 rejects at publish',
    );
  }
  return { enabled: true, maxDayShareBp: published.max_day_share_bp as BasisPoints };
}

function resolveDailyLossLimit(
  published: PublishedDailyLossLimit,
  size: PlanVersionSizeRow,
  phase: string,
): DailyLossLimitRules {
  if (published.type === 'none') return { type: 'none' };
  if (published.type !== 'soft' && published.type !== 'hard') {
    throw new EngineInvariantError(
      'CV-16',
      `${phase}.daily_loss_limit.type is "${published.type}", which is outside CV-16's vocabulary`,
    );
  }
  if (size.daily_loss_limit_cents === null) {
    throw new EngineInvariantError(
      'CV-16',
      `${phase}.daily_loss_limit.type is "${published.type}" with a null daily_loss_limit_cents`,
    );
  }
  return { type: published.type, limitCents: size.daily_loss_limit_cents };
}

/**
 * R-42's schedule, in ordinal order.
 *
 * SORTED HERE RATHER THAN TRUSTED. `capForOrdinal` resolves "the `cap_cents` of
 * the last schedule entry whose `from_ordinal <= ordinal`", which is only the
 * right rung if the array is ordered. CV-09 requires strictly increasing
 * ordinals, so on a validated plan this sort is a no-op; it exists because
 * `payout_cap_schedule_cents` is jsonb and jsonb array order survives a round
 * trip only as well as whoever wrote it. M01 section 1.4 bans
 * `Array.prototype.sort` WITHOUT A TOTAL COMPARATOR, and `from_ordinal` is total
 * on a CV-09-valid schedule.
 */
function resolveCapSchedule(size: PlanVersionSizeRow): readonly CapScheduleStep[] {
  return [...size.payout_cap_schedule_cents]
    .sort((a, b) => a.from_ordinal - b.from_ordinal)
    .map((step) => ({ fromOrdinal: step.from_ordinal, capCents: step.cap_cents }));
}

/**
 * One published plan version at one size, as the fold reads it.
 *
 * `eval` is `null` exactly when `phase_eval.enabled` is false, which is Direct
 * (Appendix A.3). M01's sketch writes `plan.eval!` throughout; the null is the
 * same fact without the assertion, and `advanceDay` already reads it that way.
 */
export function resolvePlan(rules: PlanRulesJson, size: PlanVersionSizeRow): ResolvedPlan {
  const ev = rules.phase_eval;
  const fu = rules.phase_funded;

  // R-09's threshold is a PLAN-LEVEL block in `plan_versions.rules` and Appendix
  // A lists one win-day floor per plan rather than one per phase, so the single
  // published value is copied onto both phases. `types.ts` states the
  // alternative and why it is worse: reading `plan.funded.winDays` from inside
  // an eval-phase day puts a funded parameter on the eval path.
  const winDayFloorCents: Cents = size.win_day_floor_cents;

  const evalRules: EvalPhaseRules | null = ev.enabled
    ? {
        drawdown: resolveDrawdown(ev.drawdown, size, 'phase_eval'),
        dailyLossLimit: resolveDailyLossLimit(ev.daily_loss_limit, size, 'phase_eval'),
        winDayFloorCents,
        profitTargetCents: resolveProfitTarget(size),
        minTradingDays: ev.min_trading_days,
        consistency: resolveConsistency(ev.consistency),
        maxDays: ev.max_days,
      }
    : null;

  const fundedRules: FundedPhaseRules = {
    drawdown: resolveDrawdown(fu.drawdown, size, 'phase_funded'),
    dailyLossLimit: resolveDailyLossLimit(fu.daily_loss_limit, size, 'phase_funded'),
    winDayFloorCents,
    minTradingDays: fu.min_trading_days,
    winDaysRequiredCount: fu.win_days.required_count,
    consistency: resolveConsistency(fu.consistency),
    bufferCents: size.buffer_cents,
    cadenceGapTradingDays: fu.cadence_gap_trading_days,
    payoutCapSchedule: resolveCapSchedule(size),
    minPayoutCents: fu.min_payout_cents,
    splitBp: fu.split_bp as BasisPoints,
    maxPayouts: fu.max_payouts,
  };

  return {
    // INV-16. Carried, never chosen.
    planVersionId: size.plan_version_id,
    sizeCents: size.size_cents,
    eval: evalRules,
    funded: fundedRules,
  };
}

/**
 * CV-03's value, read only when the eval phase is enabled.
 *
 * `plan_version_sizes.profit_target_cents` is nullable and `0004_catalog.sql`
 * says exactly why: "Null on Direct: there is no evaluation, so there is no
 * profit target. A ZERO HERE WOULD BE A TARGET OF ZERO, which is a different and
 * reachable thing." So the null cannot be defaulted to `0n`: R-26 is
 * `closing - size >= profitTargetCents`, and a zero target passes on the
 * account's first day, which is the exact failure CV-03 exists to block.
 */
function resolveProfitTarget(size: PlanVersionSizeRow): Cents {
  if (size.profit_target_cents === null) {
    throw new EngineInvariantError(
      'CV-03',
      'the evaluation phase is enabled with a null profit_target_cents, which CV-03 rejects at publish',
    );
  }
  return size.profit_target_cents;
}
