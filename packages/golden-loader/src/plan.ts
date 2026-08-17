// =============================================================================
// packages/golden-loader/src/plan.ts
// =============================================================================
// A PLAN RECORD BECOMES A `ResolvedPlan`, AND THIS FILE IS A STAND-IN THAT SAYS
// SO IN ITS FIRST LINE.
//
// `advanceDay` takes a `ResolvedPlan`. `resolvePlan` and `validatePlan` are
// M01 section 1.3's fifth and sixth exports and they are P2-1: they do not
// exist, so `packages/rules-engine` publishes no way to turn a config record
// into the value its own fold requires. Something has to, or CI-03 folds
// nothing.
//
// **WHEN `resolvePlan` LANDS THIS FILE IS DELETED RATHER THAN KEPT.** A second
// resolver that survives beside the real one is FM-16's shape exactly ("a gate
// is evaluated in the API layer instead of the engine ... two implementations
// of one rule, which drift"), and a loader holding the older of the two would
// grade the engine against a config the engine would have resolved differently.
// `../test/loader.test.ts` asserts the deletion condition rather than trusting
// a comment: the moment `resolvePlan` is exported, that test fails.
//
// -----------------------------------------------------------------------------
// WHAT IS READ AND WHAT IS DERIVED, WHICH IS THE WHOLE OF WHAT THIS FILE OWES
// -----------------------------------------------------------------------------
// EVERY MONEY VALUE IS READ, NOT COMPUTED. The plan records carry a `size` block
// of materialized cents beside the `rules` block of basis points, and this file
// reads the cents. Appendix A states "the bp figure is the source and the cents
// columns are derived", so a resolver multiplying bp by size would be
// re-deriving a published number and could disagree with the record in the same
// directory the fixtures are graded from.
//
// **ONE VALUE IS DERIVED AND IT IS AN ADDITION.** `floorAtCents` is
// `size_cents + locked_floor_offset_cents`, because ADR-014 states the locked
// floor as `size + X` and the record carries `X`. It is stated here, in one
// place, and it is the single line a reviewer has to check against ADR-014.
//
// THE REST IS SHAPE. A `null` daily loss limit becomes `{ type: 'none' }`, the
// string `"disabled"` becomes `{ enabled: false }`, and a single `cap_cents`
// becomes the one-rung schedule Appendix A calls "ordinal 1 and up". None of
// those decides anything; each is one spelling of the record's own statement in
// the type the engine declares.
//
// A MISSING FIELD REFUSES. There is no default anywhere below, which is
// DATA_MODEL section 12's rule arriving through the harness: a loader that
// defaulted a parameter would hand the engine a value no fixture author chose
// and grade the engine against it.
// =============================================================================

import type {
  BasisPoints,
  Cents,
  ConsistencyRules,
  DailyLossLimitRules,
  DrawdownRules,
  DrawdownType,
  FloorLockRules,
  PlanVersionId,
  ResolvedPlan,
} from '@merit/rules-engine';

/** Thrown with the `L-nn` that refused the record, like every other loader rule. */
export interface PlanResolutionError {
  readonly rule: string;
  readonly detail: string;
}

export class PlanRecordError extends Error implements PlanResolutionError {
  readonly rule: string;
  readonly detail: string;

  constructor(detail: string) {
    super(detail);
    this.name = 'PlanRecordError';
    this.rule = 'L-07';
    this.detail = detail;
  }
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PlanRecordError(`${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * An integer from the record, or a refusal.
 *
 * `Number.isSafeInteger` rather than `Number.isInteger`, and the loader's own
 * money boundary states why: `BigInt` widens a CHECKED integer and cannot lose
 * a cent, and a value outside the range JSON round-trips faithfully is not a
 * number of cents this file can pass on truthfully.
 */
function integer(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new PlanRecordError(`${what} must be a safe integer, found ${JSON.stringify(value)}`);
  }
  return value;
}

function cents(value: unknown, what: string): Cents {
  return BigInt(integer(value, what));
}

function count(value: unknown, what: string): number {
  const parsed = integer(value, what);
  if (parsed < 0)
    throw new PlanRecordError(`${what} must not be negative, found ${String(parsed)}`);
  return parsed;
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PlanRecordError(`${what} must be a non-empty string`);
  }
  return value;
}

/** `trailing_eod` or `static`, and nothing else, because `DrawdownType` has two members. */
function drawdownType(value: unknown): DrawdownType {
  const spelled = text(value, 'rules.drawdown.type');
  if (spelled !== 'trailing_eod' && spelled !== 'static') {
    throw new PlanRecordError(
      `rules.drawdown.type ${JSON.stringify(spelled)} is not a drawdown type`,
    );
  }
  return spelled;
}

/**
 * The floor lock, and the one derived value in this file.
 *
 * ADR-014: the locked floor is `size + X` with X = $100, and the record carries
 * `locked_floor_offset_cents`. CV-12 pins the trigger (`drawdown + 10,000`) and
 * the record carries THAT as an absolute, so the trigger is read and the floor
 * is added. The asymmetry is the record's, not this file's.
 */
function floorLock(value: unknown, sizeCents: Cents): FloorLockRules {
  const lock = record(value, 'rules.floor_lock');
  const enabled = lock['enabled'];
  if (typeof enabled !== 'boolean') {
    throw new PlanRecordError('rules.floor_lock.enabled must be true or false');
  }
  if (!enabled) return { enabled: false };

  return {
    enabled: true,
    atProfitCents: cents(lock['at_profit_cents'], 'rules.floor_lock.at_profit_cents'),
    // THE ONE ADDITION. Checked against ADR-014 and against nothing else.
    floorAtCents:
      sizeCents +
      cents(lock['locked_floor_offset_cents'], 'rules.floor_lock.locked_floor_offset_cents'),
  };
}

/** `null` is the record's spelling of "none", which is a shape rather than a decision. */
function dailyLossLimit(value: unknown): DailyLossLimitRules {
  if (value === null || value === undefined) return { type: 'none' };

  const limit = record(value, 'rules.daily_loss_limit');
  const type = text(limit['type'], 'rules.daily_loss_limit.type');
  if (type !== 'soft' && type !== 'hard') {
    throw new PlanRecordError(
      `rules.daily_loss_limit.type ${JSON.stringify(type)} is not soft or hard`,
    );
  }
  return { type, limitCents: cents(limit['limit_cents'], 'rules.daily_loss_limit.limit_cents') };
}

/** `"disabled"` or a basis-point figure. Appendix A writes both spellings. */
function consistency(value: unknown, what: string): ConsistencyRules {
  if (value === 'disabled') return { enabled: false };
  return { enabled: true, maxDayShareBp: integer(value, what) as BasisPoints };
}

/**
 * Resolve one plan record into the value `advanceDay` takes.
 *
 * `eval` IS `null` EXACTLY WHEN THE RECORD CARRIES NO `rules.eval`, which is
 * Direct (Appendix A.3, "Eval phase: disabled") and is what `initialState`
 * reads to decide the opening phase. An absent block is the record saying the
 * plan has no evaluation, and it is not defaulted into an empty one.
 *
 * `maxDays` IS `null` AND IS THE ONE FIELD NO RECORD STATES. Appendix A lists
 * no eval expiry for any v1 plan and R-32 calls `max_days` "null on all three v1
 * plans, so unreachable". A record that begins stating one will need a key here
 * and `advanceDay` will refuse the day until R-32 is implemented, which is the
 * honest pair: the engine says it cannot compute the rule, rather than this file
 * quietly deciding the plan has no expiry.
 */
export function resolvePlanRecord(raw: Readonly<Record<string, unknown>>): ResolvedPlan {
  const rules = record(raw['rules'], 'rules');
  const size = record(raw['size'], 'size');

  const sizeCents = cents(size['size_cents'], 'size.size_cents');
  const type = drawdownType(record(rules['drawdown'], 'rules.drawdown')['type']);
  const lock = floorLock(rules['floor_lock'], sizeCents);
  const limit = dailyLossLimit(rules['daily_loss_limit']);
  const winDays = record(rules['win_days'], 'rules.win_days');
  const winDayFloorCents = cents(size['win_day_floor_cents'], 'size.win_day_floor_cents');
  const payout = record(rules['payout'], 'rules.payout');
  const funded = record(rules['funded'], 'rules.funded');

  // TWO INDEPENDENT STATEMENTS OF ONE NUMBER, CHECKED WHERE THEY MEET. The
  // records carry `min_payout_cents` in both blocks because CV-15 says it never
  // scales by size; that makes them a pair to reconcile rather than a duplicate
  // to pick from. Reading one and ignoring the other is how a record drifts
  // against itself with every fixture still green.
  const minPayoutCents = cents(size['min_payout_cents'], 'size.min_payout_cents');
  const statedAgain = cents(payout['min_payout_cents'], 'rules.payout.min_payout_cents');
  if (minPayoutCents !== statedAgain) {
    throw new PlanRecordError(
      `size.min_payout_cents is ${minPayoutCents} and rules.payout.min_payout_cents is ` +
        `${statedAgain}; CV-15 makes them one number and the record states it twice`,
    );
  }

  const evalBlock = rules['eval'];
  const evalDrawdown: DrawdownRules = {
    type,
    drawdownCents: cents(size['eval_drawdown_cents'], 'size.eval_drawdown_cents'),
    lock,
  };
  const fundedDrawdown: DrawdownRules = {
    type,
    drawdownCents: cents(size['funded_drawdown_cents'], 'size.funded_drawdown_cents'),
    lock,
  };

  return {
    planVersionId: text(raw['plan_version_id'], 'plan_version_id') as PlanVersionId,
    sizeCents,
    eval:
      evalBlock === undefined
        ? null
        : ((): ResolvedPlan['eval'] => {
            const block = record(evalBlock, 'rules.eval');
            return {
              drawdown: evalDrawdown,
              dailyLossLimit: limit,
              winDayFloorCents,
              profitTargetCents: cents(
                size['eval_profit_target_cents'],
                'size.eval_profit_target_cents',
              ),
              minTradingDays: count(block['min_trading_days'], 'rules.eval.min_trading_days'),
              consistency: consistency(block['consistency'], 'rules.eval.consistency'),
              maxDays: null,
            };
          })(),
    funded: {
      drawdown: fundedDrawdown,
      dailyLossLimit: limit,
      winDayFloorCents,
      minTradingDays: count(funded['min_trading_days'], 'rules.funded.min_trading_days'),
      winDaysRequiredCount: count(winDays['required_count'], 'rules.win_days.required_count'),
      consistency: consistency(funded['consistency_bp'], 'rules.funded.consistency_bp'),
      bufferCents: cents(size['buffer_cents'], 'size.buffer_cents'),
      cadenceGapTradingDays: count(
        rules['cadence_gap_trading_days'],
        'rules.cadence_gap_trading_days',
      ),
      // ONE RUNG, WHICH IS WHAT THE RECORD STATES. Appendix A's row is "payout
      // cap, ordinal 1 and up", and CV-09 fully specifies the multi-rung shape
      // for a plan that carries one. No v1 plan does, so a record stating a
      // single cap resolves to a single rung and a record that begins stating a
      // schedule will need a key here rather than a reinterpretation of this one.
      payoutCapSchedule: [
        { fromOrdinal: 1, capCents: cents(size['payout_cap_cents'], 'size.payout_cap_cents') },
      ],
      minPayoutCents,
      splitBp: integer(payout['split_bp'], 'rules.payout.split_bp') as BasisPoints,
      maxPayouts: count(payout['max_payouts'], 'rules.payout.max_payouts'),
    },
  };
}
