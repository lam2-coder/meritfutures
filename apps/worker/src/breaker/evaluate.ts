// =============================================================================
// apps/worker/src/breaker/evaluate.ts
// =============================================================================
// `SD-M6-02`'s DAILY PRODUCER. `plan_breaker_state` has been in the schema since
// `0016` and nothing has ever written a row into it (`apps/admin/src/page.ts`:
// "`plan_breaker_state` has landed in 0016 and nothing writes it"). This is that
// writer, and `GS-113` is what it is measured against.
//
// -----------------------------------------------------------------------------
// THE ONE INVARIANT TO READ BEFORE ANY OTHER LINE
// -----------------------------------------------------------------------------
// `INV-M5-12`: **THE CIRCUIT BREAKER PAUSES SALES AND CAN NEVER PAUSE PAYOUTS.**
// `M05` section 5 states the consequence in the direction that matters: "By
// design it pauses sales, never payouts, and that asymmetry is correct and must
// not be weakened." A trader who has earned money is paid while Merit has
// stopped selling. That is not a graceful degradation, it is the design.
//
// It is enforced in FOUR places here rather than asserted in one:
//
//   1. `ports.ts`'s {@link BreakerWriteTable} has exactly one member, so no
//      payout, wallet, halt or restriction table is reachable through the port.
//   2. {@link BreakerDecision} carries a `salesPaused` boolean and NOTHING else
//      that is an effect. There is no `payoutsPaused`, no `hold`, no `freeze`
//      and no field a caller could read as one.
//   3. {@link salesPaused} is the ONLY producer of that boolean and it is
//      `state === 'paused'` and nothing else, so `insufficient_data` and
//      `manually_overridden` cannot become a pause by accident.
//   4. `test/breaker.test.ts` sweeps THIS FILE'S OWN SOURCE for payout-shaped
//      identifiers and refuses one, which is the assertion that catches a defect
//      a type checker cannot see: a correctly-typed call into a payout path.
//
// -----------------------------------------------------------------------------
// `insufficient_data` IS THE STATE BELOW THE MINIMUM AND SALES ARE NOT PAUSED
// -----------------------------------------------------------------------------
// `AS-M6-02` is not an attacker, it is small-sample statistics: one trader on a
// brand new plan buys a $99 evaluation, passes, and extracts 150,000c, and the
// ratio is roughly 13,500bp against a 6000bp threshold. **The firm's newest
// product is auto-paused during its launch week on a sample of one.** M06's own
// reading of why that is worse than it looks is the reason this file exists:
// "the first time the breaker fires it will be wrong, the founder will override
// it, and from then on the breaker is a thing that gets overridden."
//
// So {@link decideState} tests the FLOOR BEFORE THE RATIO, always, and the ratio
// is not even consulted below it. `0016`'s
// `plan_breaker_state_respects_min_sample` catches the same defect at the
// database; this is the same refusal above it, where the reason can be read.
//
// -----------------------------------------------------------------------------
// THE CUSUM IS FOLDED AND IS NEVER STORED, AND TODAY IT IS ABSENT
// -----------------------------------------------------------------------------
// `ADR-167` ruled reading 3 of three: "`S_t` is computed at read time, by
// folding the pass-rate series in `evaluated_on` order with the floor at zero,
// and no column, table or row anywhere holds it." {@link foldCusum} is that
// fold. Its clause 3 forecloses the path this file could most easily grow: **the
// CUSUM never writes `plan_breaker_state.state`**, so an advisory statistic can
// never pause sales either, which is `INV-M5-12`'s asymmetry read one rail in.
//
// Its clause 5 is why {@link cusumOf} returns `null` today: `mu_0` and `sigma`
// are `DEP-M6-05`'s, `DEP-M6-05` is M06 Wave 4, and `FM-M6-07` reads that an
// uncalibrated CUSUM is "either constant alarms or none, which is the same as no
// chart". `apps/admin/src/page.ts` already lists `P-M6-06` as PENDING naming
// that blocker rather than drawing an empty chart, and this file gives the same
// answer rather than a manufactured number.
//
// -----------------------------------------------------------------------------
// NO FLOAT REACHES ANY OF IT, AND THE ONE DIVISION IS NAMED
// -----------------------------------------------------------------------------
// Money is `bigint` from the port to the row: {@link foldWindow} sums
// `amount_paid_cents` and `approved_cents` as `bigint` and never as `number`, so
// a value past `Number.MAX_SAFE_INTEGER` cannot be silently rounded on the way
// in. `ratio_bp` is `(numerator * 10000n) / denominator` in `bigint`, which is
// EXACT integer division and not a rounded quotient of two floats.
//
// `ADR-167` section 4 removes the recurrence's own rounding by configuring the
// slack as `k_bp` so `sigma` is halved once at calibration rather than every day
// by the evaluator: "a recurrence is exactly the shape where a per-step rounding
// stops being negligible". {@link foldCusum} therefore does integer addition,
// subtraction and comparison ONLY.
//
// **THE ONE REMAINING DIVISION IS {@link passRateBp}'s AND IT IS DECLARED RATHER
// THAN HIDDEN.** A pass rate is genuinely a quotient of two counts, so unlike
// `0.5 * sigma` it cannot be configured away. It truncates, it truncates
// DOWNWARD, and because `S_t` is a running sum the bias accumulates: at most 1bp
// per day, always in the direction of a SMALLER statistic, which is the
// direction of NOT alarming. That is the safe direction for an advisory panel
// and it is stated here so the next reader does not have to re-derive it.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE DOES NOT DO
// -----------------------------------------------------------------------------
//   - It chooses NO number. `OQ-M6-02` is the founder's and `LOSS_RATIO_POLICY`
//     ships both minimum terms `unstated`, so a real run DECLINES today.
//   - It writes no migration and needs none (`ADR-167` clause 6, `0051` unspent).
//   - It touches `otp_send_budget` not at all. `CRON_INVENTORY`'s numbered
//     finding names TWO daily recomputations with no scheduled row and this
//     slice is one of them; `M16`'s is not this fence's and is reported.
// =============================================================================

import {
  BREAKER_STATE_CHANGED,
  BreakerDeclined,
  LOSS_RATIO_POLICY,
  SALES_PAUSED_STATE,
} from './ports.ts';
import type {
  BreakerEvent,
  BreakerIo,
  BreakerRow,
  BreakerState,
  BreakerTx,
  LossRatioPolicy,
  PolicyNumber,
} from './ports.ts';

// -----------------------------------------------------------------------------
// Row reading, and it refuses rather than coercing
// -----------------------------------------------------------------------------

/** Raised when a row crossing the port is not the shape the column declares. */
export class BreakerRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BreakerRowError';
  }
}

function record(value: unknown, where: string): BreakerRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new BreakerRowError(`${where}: expected a row and received ${JSON.stringify(value)}`);
  return value as BreakerRow;
}

/**
 * A `uuid` or `text` column.
 *
 * A refusal rather than `String(value)`: a `uuid` arriving as an object would
 * become `[object Object]` and be written into a plan id, which is a row that
 * describes a plan that does not exist.
 */
function readText(row: BreakerRow, key: string, where: string): string {
  const value = row[key];
  if (typeof value !== 'string')
    throw new BreakerRowError(`${where}.${key}: expected text and received ${typeof value}`);
  return value;
}

/**
 * A `bigint` money column, as `bigint` and never as `number`.
 *
 * **THIS IS WHERE THE NO-FLOATS RULE HAS TEETH.** `schema.ts` declares every
 * `*_cents` column `bigint(..., { mode: 'bigint' })`, so a `number` arriving
 * here is a driver or a fake that widened the type, and accepting it would put
 * the whole fold on floating point without a single float literal in the diff.
 * A `number` is refused BY NAME rather than converted.
 */
function readCents(row: BreakerRow, key: string, where: string): bigint {
  const value = row[key];
  if (typeof value === 'bigint') return value;
  throw new BreakerRowError(
    `${where}.${key}: expected a bigint and received ${typeof value}. Money is integer cents and ` +
      'this column is declared `bigint` in schema.ts, so a `number` here is a widened type rather ' +
      'than a value, and converting it is how a float reaches a financial path with no float in ' +
      'the diff',
  );
}

/** A `timestamptz` column that may be null. */
function readInstant(row: BreakerRow, key: string, where: string): Date | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  throw new BreakerRowError(
    `${where}.${key}: expected a Date or null and received ${typeof value}`,
  );
}

/** A `date` column, as the `YYYY-MM-DD` the trading-day rule requires. */
const TRADING_DAY = /^\d{4}-\d{2}-\d{2}$/;

function readTradingDay(row: BreakerRow, key: string, where: string): string {
  const value = readText(row, key, where);
  if (!TRADING_DAY.test(value))
    throw new BreakerRowError(
      `${where}.${key} is ${JSON.stringify(value)}, and a trading day is a YYYY-MM-DD exchange ` +
        'session day, never a UTC timestamp',
    );
  return value;
}

// -----------------------------------------------------------------------------
// The policy, resolved or declined
// -----------------------------------------------------------------------------

/** Every number the evaluation runs under, after the `unstated` ones are refused. */
export interface ResolvedPolicy {
  readonly metric: string;
  readonly windowDays: number;
  readonly thresholdBp: number;
  readonly minSample: number;
  /** `OQ-M6-02`'s second term. `null` when it is unstated, and then it is not applied. */
  readonly minSettledPayouts: number | null;
}

function stated(number: PolicyNumber, name: string): number {
  if (number.state === 'unstated')
    throw new BreakerDeclined(
      `${name} is unstated. ${number.cite} says: "${number.quote}" A breaker that runs without a ` +
        'floor is AS-M6-02 produced deliberately, and the two ways to run anyway are both worse ' +
        'than declining: a floor of zero is refused by `min_sample > 0` at the database, and a ' +
        "floor of one pauses the firm's newest plan during its launch week on a sample of one",
    );
  return number.value;
}

/**
 * Resolve the policy, or decline.
 *
 * **`minSettledPayouts` IS ALLOWED TO BE UNSTATED AND `minSample` IS NOT, AND
 * THE ASYMMETRY IS `ADR-167` SECTION 5.** `min_sample` is a `NOT NULL` column
 * and `plan_breaker_state_respects_min_sample` is a comparison against it, so
 * the row cannot be written without it. The second term has no column at all: it
 * "lives in the evaluator or it does not exist", so an unstated second term is
 * a term not applied, and that is visible in {@link BreakerDecision.floors}
 * rather than silent.
 */
export function resolvePolicy(policy: LossRatioPolicy = LOSS_RATIO_POLICY): ResolvedPolicy {
  return {
    metric: policy.metric,
    windowDays: stated(policy.windowDays, 'windowDays'),
    thresholdBp: stated(policy.thresholdBp, 'thresholdBp'),
    minSample: stated(policy.minSample, 'minSample (OQ-M6-02)'),
    minSettledPayouts: policy.minSettledPayouts.value,
  };
}

// -----------------------------------------------------------------------------
// The fold, in integer cents
// -----------------------------------------------------------------------------

/** One plan's window, folded. Every money term is `bigint`. */
export interface WindowFold {
  /** Settled payouts in the window, in cents. `P-M6-05`'s numerator. */
  readonly numeratorCents: bigint;
  /** Fees in the window, in cents. `P-M6-05`'s denominator. */
  readonly denominatorCents: bigint;
  /**
   * The DENOMINATOR's count, and `ADR-167` section 5 rules that it is this one.
   *
   * A row whose `sample_size` held the settled-payout count would satisfy every
   * `CHECK` in `0016` and describe the wrong population, and no gate in this
   * repository can see which count an integer is.
   */
  readonly sampleSize: number;
  /**
   * The NUMERATOR's count, which has no column and is `OQ-M6-02`'s second term.
   *
   * It never reaches a row. It reaches {@link decideState} and nothing else.
   */
  readonly settledPayoutCount: number;
}

/** Fold one plan's purchase and payout rows into the window's four terms. */
export function foldWindow(purchases: readonly unknown[], payouts: readonly unknown[]): WindowFold {
  let denominatorCents = 0n;
  for (const [index, value] of purchases.entries())
    denominatorCents += readCents(
      record(value, `purchases[${String(index)}]`),
      'amountPaidCents',
      `purchases[${String(index)}]`,
    );

  let numeratorCents = 0n;
  for (const [index, value] of payouts.entries())
    numeratorCents += readCents(
      record(value, `payoutRequests[${String(index)}]`),
      'approvedCents',
      `payoutRequests[${String(index)}]`,
    );

  return {
    numeratorCents,
    denominatorCents,
    sampleSize: purchases.length,
    settledPayoutCount: payouts.length,
  };
}

/**
 * The loss ratio in integer basis points, or `null` when there is no ratio.
 *
 * `(numerator * 10000n) / denominator` in `bigint` is EXACT integer division and
 * truncates toward zero; both operands are non-negative cents, so it is a floor.
 * **It rounds DOWN and that is the direction that does not manufacture a pause**:
 * the only ratios it moves across `>= threshold_bp` are ones within one basis
 * point below the threshold, and reporting a ratio higher than the cents support
 * on the operator's own dashboard is the worse of the two errors.
 *
 * **A ZERO DENOMINATOR IS `null` AND IS NOT ZERO.** A ratio over no fees is
 * undefined, not favourable, and returning `0` would read on the dashboard as
 * the healthiest plan Merit sells. {@link decideState} turns a `null` into
 * `insufficient_data`.
 */
export function lossRatioBp(fold: WindowFold): number | null {
  if (fold.denominatorCents <= 0n) return null;
  const bp = (fold.numeratorCents * 10_000n) / fold.denominatorCents;
  if (bp > BigInt(Number.MAX_SAFE_INTEGER))
    throw new BreakerRowError(
      `a loss ratio of ${bp.toString()}bp is past Number.MAX_SAFE_INTEGER, so the ` +
        '`ratio_bp integer` column cannot hold it and neither can JSON. This is a corrupt window ' +
        'rather than a large one',
    );
  return Number(bp);
}

// -----------------------------------------------------------------------------
// The state, and the floor is tested before the ratio
// -----------------------------------------------------------------------------

/** Which floor an evaluation was below, or `null` when it was below neither. */
export type BreakerFloor = 'sample_size' | 'settled_payouts' | 'no_denominator' | null;

/** What {@link decideState} was handed. */
export interface StateInput {
  readonly fold: WindowFold;
  readonly ratioBp: number | null;
  readonly policy: ResolvedPolicy;
}

/** The state, and which floor decided it. */
export interface StateOutcome {
  readonly state: BreakerState;
  readonly floor: BreakerFloor;
}

/**
 * The ladder, and its ORDER is the control.
 *
 * **THE FLOOR IS TESTED BEFORE THE RATIO, ALWAYS.** `AS-M6-02`'s counter is that
 * below the minimum the breaker "states that it has no opinion rather than
 * manufacturing one", and a ladder that tested the ratio first would compute an
 * opinion and then discard it, which is one edit away from reporting it.
 *
 * `manually_overridden` IS NOT PRODUCED HERE. An override is an operator's act
 * and this function knows only the arithmetic; {@link applyOverride} is where a
 * live override displaces this answer, and it runs after.
 */
export function decideState(input: StateInput): StateOutcome {
  const { fold, ratioBp, policy } = input;

  if (fold.sampleSize < policy.minSample)
    return { state: 'insufficient_data', floor: 'sample_size' };

  if (policy.minSettledPayouts !== null && fold.settledPayoutCount < policy.minSettledPayouts)
    return { state: 'insufficient_data', floor: 'settled_payouts' };

  // A window with a sample above the floor and no fees at all: possible, because
  // a fully discounted purchase is a purchase with `amount_paid_cents` of zero.
  // There is no ratio to compare, so there is no opinion to have.
  if (ratioBp === null) return { state: 'insufficient_data', floor: 'no_denominator' };

  return { state: ratioBp >= policy.thresholdBp ? 'paused' : 'armed', floor: null };
}

/**
 * Whether a plan's NEW SALES are paused. The only producer of that boolean.
 *
 * `API_CONTRACT`'s `per_plan.sales_paused` is exactly this comparison.
 * **`insufficient_data` IS NOT A PAUSE** and neither is `manually_overridden`,
 * and both absences are `GS-113` and `AS-M6-02` respectively.
 *
 * **IT SAYS NOTHING ABOUT PAYOUTS AND THERE IS NO FUNCTION HERE THAT DOES**
 * (`INV-M5-12`).
 */
export function salesPaused(state: BreakerState): boolean {
  return state === SALES_PAUSED_STATE;
}

// -----------------------------------------------------------------------------
// The override, which lapses by being recomputed
// -----------------------------------------------------------------------------

/** The three columns `plan_breaker_state_override_is_complete` requires together. */
export interface BreakerOverride {
  readonly reason: string;
  readonly expiresAt: Date;
  readonly changedBy: string;
}

/** The previous plan-day, as this evaluation needs to see it. */
export interface PreviousEvaluation {
  readonly evaluatedOn: string;
  readonly state: BreakerState;
  readonly override: BreakerOverride | null;
}

/**
 * Carry a LIVE override forward and drop an EXPIRED one.
 *
 * **THIS IS `CRON_INVENTORY`'s EXEMPTION FOR `plan_breaker_state.override_expires_at`
 * MADE REAL**, and until this file existed the exemption rested on a job that did
 * not: "A later evaluation does not carry an expired override forward, so the
 * override lapses by being recomputed rather than by being released." The
 * exemption is correct only if the recomputation runs, which is the numbered
 * finding at the bottom of that page and is why this slice adds its row.
 *
 * **AN EXPIRED OVERRIDE FALLS BACK TO THE COMPUTED STATE AND NOT TO `armed`.**
 * Falling back to `armed` would be an override expiring into a state that says
 * the breaker is watching and has no complaint, which is the one answer nobody
 * checked.
 *
 * The comparison is STRICT: an override whose `expires_at` is exactly now has
 * expired. `M06` section 9 pages on an override standing past its expiry, and an
 * inclusive bound would keep one alive for the length of one evaluation on the
 * exact instant the page is about.
 */
export function applyOverride(
  computed: StateOutcome,
  previous: PreviousEvaluation | null,
  now: Date,
): {
  readonly state: BreakerState;
  readonly floor: BreakerFloor;
  readonly override: BreakerOverride | null;
} {
  const held = previous?.override ?? null;
  if (previous === null || previous.state !== 'manually_overridden' || held === null)
    return { ...computed, override: null };
  if (held.expiresAt.getTime() <= now.getTime()) return { ...computed, override: null };
  return { state: 'manually_overridden', floor: computed.floor, override: held };
}

// -----------------------------------------------------------------------------
// One plan's decision
// -----------------------------------------------------------------------------

/**
 * Everything one plan-day's evaluation decided.
 *
 * **THE EFFECT SURFACE IS `salesPaused` AND NOTHING ELSE** (`INV-M5-12`, and it
 * is item 2 of this file's header). There is no field on this interface a caller
 * can read as an instruction about a payout, a wallet, a hold or a freeze,
 * because a breaker that could express one is a breaker one call site away from
 * performing one.
 */
export interface BreakerDecision {
  readonly planId: string;
  readonly planCode: string;
  readonly evaluatedOn: string;
  readonly metric: string;
  readonly fold: WindowFold;
  readonly ratioBp: number | null;
  readonly thresholdBp: number;
  readonly minSample: number;
  readonly state: BreakerState;
  readonly floor: BreakerFloor;
  readonly override: BreakerOverride | null;
  readonly previousState: BreakerState | null;
  /** The ONLY effect. `state === 'paused'`, and never anything about a payout. */
  readonly salesPaused: boolean;
  /** Which floors were applied, so an unapplied second term is visible. */
  readonly floors: {
    readonly minSample: number;
    readonly minSettledPayouts: number | null;
  };
}

/**
 * The row `plan_breaker_state` gains, by Drizzle property name.
 *
 * **`sampleSize` AND `minSample` ARE WRITTEN TOGETHER, ALWAYS.** That is the
 * `P7-k` row's first clause and `INV-M6-07`'s content: a ratio without its
 * sample size is the number that gets the breaker overridden.
 *
 * `ratio_bp` IS `0` WHEN THERE IS NO RATIO AND THE STATE BESIDE IT SAYS SO. The
 * column is `NOT NULL` and no migration number is allocated to this slice, so
 * the honest options are a zero beside `insufficient_data` or no row at all, and
 * no row would lose the evaluation's own record that it ran and found nothing.
 * {@link BreakerDecision.ratioBp} keeps the `null`, so the absence survives
 * everywhere except the column that cannot hold it.
 */
export function toBreakerStateRow(decision: BreakerDecision): Record<string, unknown> {
  return {
    planId: decision.planId,
    evaluatedOn: decision.evaluatedOn,
    metric: decision.metric,
    numeratorCents: decision.fold.numeratorCents,
    denominatorCents: decision.fold.denominatorCents,
    sampleSize: decision.fold.sampleSize,
    ratioBp: decision.ratioBp ?? 0,
    thresholdBp: decision.thresholdBp,
    minSample: decision.minSample,
    state: decision.state,
    overrideReason: decision.override?.reason ?? null,
    overrideExpiresAt: decision.override?.expiresAt ?? null,
    changedBy: decision.override?.changedBy ?? null,
  };
}

/**
 * `breaker.state_changed`, or `null` when the state did not change.
 *
 * `M06:265` field for field, and `sample_size` and `min_sample` are both
 * REQUIRED: "an alert that omits it invites exactly the override that destroys
 * the control."
 */
export function stateChangedEvent(decision: BreakerDecision): BreakerEvent | null {
  if (decision.previousState === decision.state) return null;
  return {
    name: BREAKER_STATE_CHANGED,
    payload: {
      plan_id: decision.planId,
      metric: decision.metric,
      from_state: decision.previousState,
      to_state: decision.state,
      ratio_bp: decision.ratioBp ?? 0,
      threshold_bp: decision.thresholdBp,
      sample_size: decision.fold.sampleSize,
      min_sample: decision.minSample,
    },
  };
}

// -----------------------------------------------------------------------------
// The CUSUM, folded and never stored
// -----------------------------------------------------------------------------

/**
 * The recurrence's three parameters, in integer basis points.
 *
 * `ADR-167` section 4: every operand of
 * `S_t = max(0, S_(t-1) + (x_t - mu_0 - 0.5*sigma))` is a RATE, so the statistic
 * IS commensurable with a basis point and is NOT commensurable with `ratio_bp`,
 * which is a LOSS ratio carried in the same unit.
 *
 * **`kBp` IS THE SLACK ITSELF AND IS NOT `sigma`.** Clause 4 forecloses the
 * halving on the evaluation path: "Halving an odd basis-point value truncates;
 * the truncation is signed the same way every single day; and it accumulates,
 * because this is a running sum." `sigma` is halved once by whoever calibrates.
 */
export interface CusumParameters {
  readonly mu0Bp: number;
  readonly kBp: number;
  readonly alarmBp: number;
}

/**
 * The calibration, and it does not exist.
 *
 * `DEP-M6-05` supplies `mu_0` and `sigma` from the simulation harness and is
 * M06 Wave 4. `FM-M6-07`: an uncalibrated CUSUM is "either constant alarms or
 * none, which is the same as no chart".
 */
export const UNCALIBRATED_CUSUM = {
  mu0Bp: null,
  kBp: null,
  alarmBp: null,
  blockedOn: 'DEP-M6-05',
  cite: 'M06:556 (DEP-M6-05), M06 FM-M6-07, ADR-167 clause 5',
  quote:
    'The simulation harness supplies CUSUM mu_0 and sigma, and CVaR99 at rho = 0.30 as the RCR ' +
    'denominator. Wave 4.',
} as const;

/**
 * One day of the series the recurrence runs over.
 *
 * `ADR-167` finding 8 supplies it from landed columns: `accounts` carries
 * `plan_version_id`, `opened_on`, `funded_on`, `closed_on`, `close_reason` and
 * `phase`, and `account_status_history` carries every transition. **THE SERIES
 * IS AN INPUT HERE AND THE QUERY IS NOT THIS SLICE'S**, because section 4's last
 * paragraph leaves the rows-versus-aggregate question exactly where `ADR-157`
 * left it: `scoped-db.ts` is `P5-a`'s file and the aggregate was refused.
 */
export interface PassRateDay {
  readonly tradingDay: string;
  readonly passes: number;
  readonly resolutions: number;
}

/**
 * A pass rate in integer basis points. THE ONE DIVISION ON THIS PATH.
 *
 * See this file's header. It truncates downward, at most 1bp per day, and the
 * bias is signed toward a SMALLER `S_t` and therefore toward NOT alarming.
 * Unlike `0.5 * sigma` it cannot be configured away, because a pass rate is
 * genuinely a quotient of two counts.
 *
 * A day with no resolutions has no rate, and `0` would be a perfect failure
 * rate rather than an absence, so it is refused.
 */
export function passRateBp(day: PassRateDay): number | null {
  if (!Number.isSafeInteger(day.passes) || !Number.isSafeInteger(day.resolutions))
    throw new BreakerRowError(
      `a pass-rate day carries ${String(day.passes)}/${String(day.resolutions)}, and both terms ` +
        'are counts of rows, so a non-integer is a widened type rather than a value',
    );
  if (day.resolutions <= 0) return null;
  return Math.floor((day.passes * 10_000) / day.resolutions);
}

/** What a fold of the series produced. */
export interface CusumFold {
  readonly statisticBp: number;
  readonly alarm: boolean;
  readonly days: number;
}

/**
 * `S_t = max(0, S_(t-1) + (x_t - mu_0 - k))`, in integer basis points.
 *
 * INTEGER ADDITION, SUBTRACTION AND COMPARISON ONLY. No division, no float, and
 * nothing that rounds, which is `ADR-167` clause 4.
 *
 * `integer` suffices and the bound is a multiplication rather than an
 * assumption: the per-day increment is at most `x_t`, which is at most `10000`,
 * so `S_t` after `n` days is at most `10000n` and `int4` is not reached until
 * `n = 214748` days, which is 588 years.
 *
 * **THE SERIES IS FOLDED IN `evaluated_on` ORDER AND THE ORDER IS THE CALLER'S
 * PROMISE.** A recurrence over a reordered series is a different statistic, so
 * this function asserts the order rather than sorting: sorting silently would
 * make a caller that read the days out of order correct by accident.
 *
 * **IT RETURNS A STATISTIC AND NEVER A STATE** (`ADR-167` clause 3). There is no
 * path from `alarm` to `'paused'` anywhere in this file, and `alarm` is not an
 * argument to {@link decideState}.
 */
export function foldCusum(series: readonly PassRateDay[], params: CusumParameters): CusumFold {
  for (const value of [params.mu0Bp, params.kBp, params.alarmBp])
    if (!Number.isSafeInteger(value))
      throw new BreakerRowError(
        `a CUSUM parameter is ${String(value)}, and ADR-167 clause 4 makes every one of them an ` +
          'integer in basis points so that no float and no division enters the recurrence',
      );

  let statisticBp = 0;
  let previousDay = '';
  let days = 0;
  for (const day of series) {
    if (day.tradingDay <= previousDay)
      throw new BreakerRowError(
        `the pass-rate series reaches ${day.tradingDay} after ${previousDay}. S_t is a recurrence ` +
          'over a series in evaluated_on order, so an unordered series is a different statistic ' +
          'and is refused rather than sorted',
      );
    previousDay = day.tradingDay;
    const xt = passRateBp(day);
    if (xt === null) continue;
    days += 1;
    const next = statisticBp + (xt - params.mu0Bp - params.kBp);
    statisticBp = next > 0 ? next : 0;
  }
  return { statisticBp, alarm: statisticBp >= params.alarmBp, days };
}

/**
 * The CUSUM as this deployment can honestly report it, which is ABSENT.
 *
 * `ADR-167` clause 5: "`P7-k` renders `per_plan[].cusum` as ABSENT until
 * `DEP-M6-05` lands, on `apps/admin`'s own existing disposition of `P-M6-06`,
 * and does not manufacture one."
 *
 * It takes the series so that the call site is the real one and the absence is
 * the PARAMETERS rather than the data, which is the distinction a later reader
 * needs: when the harness lands, this function returns a fold and nothing else
 * about the call site changes.
 */
export function cusumOf(
  series: readonly PassRateDay[],
  params: CusumParameters | null,
): CusumFold | null {
  if (params === null) return null;
  return foldCusum(series, params);
}

// -----------------------------------------------------------------------------
// The evaluation
// -----------------------------------------------------------------------------

/** What one run of the evaluation produced. */
export interface BreakerEvaluationReport {
  readonly evaluatedOn: string;
  readonly metric: string;
  readonly decisions: readonly BreakerDecision[];
  readonly rowsWritten: number;
  readonly eventsEmitted: number;
  readonly plansPaused: number;
  readonly plansInsufficientData: number;
}

function windowStart(now: Date, windowDays: number): Date {
  return new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
}

function latestPrevious(rows: readonly unknown[], evaluatedOn: string): PreviousEvaluation | null {
  let best: PreviousEvaluation | null = null;
  for (const [index, value] of rows.entries()) {
    const where = `planBreakerState[${String(index)}]`;
    const row = record(value, where);
    const day = readTradingDay(row, 'evaluatedOn', where);
    if (day >= evaluatedOn) continue;
    if (best !== null && day <= best.evaluatedOn) continue;
    const state = readText(row, 'state', where);
    if (!isBreakerState(state))
      throw new BreakerRowError(
        `${where}.state is ${JSON.stringify(state)}, which 0016's CHECK does not admit`,
      );
    const reason = row['overrideReason'];
    const expiresAt = readInstant(row, 'overrideExpiresAt', where);
    const changedBy = row['changedBy'];
    best = {
      evaluatedOn: day,
      state,
      override:
        typeof reason === 'string' && expiresAt !== null && typeof changedBy === 'string'
          ? { reason, expiresAt, changedBy }
          : null,
    };
  }
  return best;
}

function isBreakerState(value: string): value is BreakerState {
  return (
    value === 'armed' ||
    value === 'paused' ||
    value === 'insufficient_data' ||
    value === 'manually_overridden'
  );
}

/**
 * Evaluate every active plan for one day, write a row each, and alert on change.
 *
 * ONE TRANSACTION FOR THE WHOLE RUN, which is `ADR-006`'s criterion: the alert
 * commits with the row that changed state or neither does.
 *
 * **IT WRITES `plan_breaker_state` AND EMITS `breaker.state_changed`, AND THAT
 * IS THE COMPLETE LIST OF ITS EFFECTS** (`INV-M5-12`).
 */
export async function evaluateBreaker(
  io: BreakerIo,
  policy: LossRatioPolicy = LOSS_RATIO_POLICY,
): Promise<BreakerEvaluationReport> {
  const resolved = resolvePolicy(policy);
  const now = io.now();
  const evaluatedOn = io.tradingDayOf(now);
  const from = windowStart(now, resolved.windowDays);

  return io.transact(async (tx: BreakerTx) => {
    const decisions: BreakerDecision[] = [];
    let eventsEmitted = 0;

    for (const [index, value] of (await tx.rowsWhere('plans', { isActive: true })).entries()) {
      const where = `plans[${String(index)}]`;
      const plan = record(value, where);
      const planId = readText(plan, 'id', where);
      const planCode = readText(plan, 'code', where);

      // Section 2a of `ports.ts`: neither `purchases` nor `payout_requests`
      // carries a `plan_id`, so the bridge is `plan_versions` and the join is
      // here rather than in the accessor.
      const versions = await tx.rowsWhere('planVersions', { planId });
      const purchases: unknown[] = [];
      const payouts: unknown[] = [];
      for (const [vIndex, vValue] of versions.entries()) {
        const vWhere = `planVersions[${String(vIndex)}]`;
        const planVersionId = readText(record(vValue, vWhere), 'id', vWhere);
        purchases.push(
          ...(await tx.rowsWhere('purchases', {
            planVersionId,
            status: 'paid',
            paidAt: io.terms.atLeast(from),
          })),
        );
        payouts.push(
          ...(await tx.rowsWhere('payoutRequests', {
            planVersionId,
            status: 'settled',
            settledAt: io.terms.atLeast(from),
          })),
        );
      }

      const fold = foldWindow(purchases, payouts);
      const ratioBp = lossRatioBp(fold);
      const computed = decideState({ fold, ratioBp, policy: resolved });
      const previous = latestPrevious(
        await tx.rowsWhere('planBreakerState', { planId }),
        evaluatedOn,
      );
      const settled = applyOverride(computed, previous, now);

      const decision: BreakerDecision = {
        planId,
        planCode,
        evaluatedOn,
        metric: resolved.metric,
        fold,
        ratioBp,
        thresholdBp: resolved.thresholdBp,
        minSample: resolved.minSample,
        state: settled.state,
        floor: settled.floor,
        override: settled.override,
        previousState: previous?.state ?? null,
        salesPaused: salesPaused(settled.state),
        floors: {
          minSample: resolved.minSample,
          minSettledPayouts: resolved.minSettledPayouts,
        },
      };
      decisions.push(decision);

      await tx.insert('planBreakerState', toBreakerStateRow(decision));
      const event = stateChangedEvent(decision);
      if (event !== null) {
        await io.events.emit(tx, event);
        eventsEmitted += 1;
      }
    }

    return {
      evaluatedOn,
      metric: resolved.metric,
      decisions,
      rowsWritten: decisions.length,
      eventsEmitted,
      plansPaused: decisions.filter((d) => d.salesPaused).length,
      plansInsufficientData: decisions.filter((d) => d.state === 'insufficient_data').length,
    };
  });
}
