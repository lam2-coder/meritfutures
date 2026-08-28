// =============================================================================
// apps/worker/src/detectors/graph.ts
// =============================================================================
// THE GRAPH DETECTORS: `D-02`, `D-03`, `D-12`, `D-13` AND `D-14`. `P7` SECTION
// 8's `P7-g`, WRITTEN AGAINST `P7-e`'s RUNNER AND ITS PORTS AND CHANGING
// NEITHER.
//
// **ONE OF THE FIVE RUNS TONIGHT AND FOUR DO NOT, AND EVERY REASON IS A
// MEASUREMENT RATHER THAN A SHRUG.** The count is reported here, at the top,
// because `P7` section 11 rule 15 asks for the count honestly and because a
// reader who takes this file for five working detectors will be wrong about
// what Merit currently detects:
//
//   `D-02`  RUNS, capped at severity 3      one parameter unstated, named below
//   `D-03`  DECLINES                        three parameters unstated
//   `D-12`  IS NOT A `Detector` AT ALL      the port has no shape for it
//   `D-13`  DECLINES                        two of its three tolerances unstated
//   `D-14`  DECLINES                        its threshold unstated AND its input
//                                           table does not exist
//
// Every decline is `DetectorDeclined`, which `runner.ts` records as a `failed`
// run rather than a quiet `ok`, so `detector_runs_unhealthy_idx` and
// `CRON_INVENTORY`'s dead-man switch both see it on the morning of the day it
// happens. **That is the designed path and not a workaround**: `ports.ts` states
// it in `DetectorDeclined`'s own doc comment, and the alternative -- a detector
// inventing a threshold, or matching nothing under one -- is `FM-M7-01`,
// *"detection appears healthy and is absent."*
//
// **THE THREE DECLINES ARE ONE FOUNDER ANSWER AWAY FROM RUNNING AND NOT ONE
// SESSION AWAY.** `OQ-M7-02` is the open question, `P7-d`'s seed is where the
// answer lands, and every threshold below is read from
// `detector_definitions.parameters` (`INV-M7-04`). No number in this file is a
// literal that a detector compares against.
//
// -----------------------------------------------------------------------------
// 1. WHAT `ADR-157` SECTION 5 REFUSED, AND WHAT THE REFUSAL ACTUALLY COST HERE
// -----------------------------------------------------------------------------
// `P7` section 8 says this slice depends on that entry *"more than any other,
// because a variance ratio over a discovered group is the aggregate section 3.1
// names"*, and its table rules on two of these five by name:
//
//   `D-03`  "compares the variance of a summed series against a sum of
//            variances across a discovered group"  ->  **No**, twice: a
//            discovered group is a JOIN and a variance of a series is not a
//            scalar aggregate
//   `D-14`  "sums positions across a clique"       ->  **No.** A clique is a
//            JOIN; the sum over it is the easy half
//
// **THE MEASUREMENT THIS SLICE OWES, TAKEN RATHER THAN ARGUED.** What the entry
// granted is that *"a detector can pull its window through `rowsWhere` and do
// the join in the runner"*, at the named cost that *"THE ROWS CROSSING THE
// BOUNDARY ARE THE WINDOW'S RATHER THAN THE MATCH'S."* Three separate costs
// showed up and only the first is the one the entry names:
//
//   (a) **THE WINDOW'S ROWS.** `D-03` computes over `group_size x window_days`
//       marks and must read `accounts_with_marks x window_days`. The overhead
//       is the whole marked population divided by the group, and it does not
//       shrink as the group gets smaller -- it grows. `detectors-graph.test.ts`
//       section 8 executes this and prints the ratio; at 60 marked accounts and
//       a 3-account group over 20 days it reads 1,200 rows to decide about 60,
//       which is 20 rows read per row that mattered.
//
//   (b) **A FILTER CARRIES ONE NARROWING PER COLUMN, SO A `BETWEEN` IS HALF A
//       READ.** `RowFilter` is `Partial<Record<AddressableColumn, unknown>>`, so
//       `tradingDay` holds `atLeast(start)` OR `atMost(end)` and never both. The
//       lower bound crosses the boundary and **the upper bound is applied in
//       memory**, which is not a widening `ADR-157` withheld -- it is the shape
//       of the filter object, and no clause of that entry mentions it.
//
//   (c) **A READ MUST NAME A COLUMN, SO "THE WHOLE TABLE" IS SPELLED AS A
//       NARROWING THAT IS TRUE.** `NamesAColumn` resolves an empty filter to
//       `never`, so `rowsWhere('accounts', {})` does not compile. Every stream
//       below names a column and every one of those narrowings is a statement
//       this file can defend (`openedOn <= tradingDay`; `suppressed = false`;
//       `firstSeenAt <= now`) rather than a filter chosen to satisfy the type.
//
// **AND THE FINDING THAT MATTERS MOST, WHICH IS THAT THE JOIN WAS NOT THE
// BLOCKER.** The dispatch's honest possibility was that some of these five
// cannot be built through the accessor as it stands. **Measured: all five can
// be read through it.** `identity_links`, `identity_signals`, `accounts`,
// `daily_marks` and `fills` are five separate `rowsWhere` calls and the joins
// are ordinary code below. What stops four of the five is `OQ-M7-02` -- numbers
// the founder has not chosen -- and, for `D-14`, a table that does not exist.
// **So this slice does NOT ask for the JOIN entry `ADR-157` section 5 left
// owed.** The question that entry wrote down for it (*"a joined read has two
// tables and the tenancy narrowing has to hold on BOTH of them, or the accessor
// is a BOLA hole with an extra table in it"*) is unanswered and stays that way,
// because reaching for it here would spend a ruling on a cost that is real,
// measured, and not currently blocking anything.
//
// -----------------------------------------------------------------------------
// 2. `D-12` IS NOT A `Detector`, AND THAT IS A PROPERTY OF THE PORT
// -----------------------------------------------------------------------------
// `M07:122`: *"Output is a watched-cluster set, NOT a flag: it seeds `D-13` and
// `D-14` rather than accusing anyone."* Against that, `runner.ts` computes
// `status = found < expected ? 'degraded' : 'ok'` and `mintBattery` refuses a
// detector that seeds no canaries. **So a `Detector` must return a finding or a
// group, or it is degraded every night forever**, and both of those become rows:
// a `DetectorFinding` becomes a `risk_flags` row and a `DetectorGroup` becomes a
// `correlation_groups` row.
//
// **A WATCHED CLUSTER IS NEITHER, AND `correlation_groups` CANNOT HOLD ONE
// EITHER.** `0008_risk.sql:213` declares `statistic numeric NOT NULL` and
// `threshold numeric NOT NULL`; a watched cluster has no statistic and no
// threshold, and a row written there is a group FINDING that `P7-i`'s queue and
// `P7-j`'s evidence packs read. Writing one would convert *"watched"* into
// *"found"*, which is the exact sentence `M07` wrote `D-12`'s row to forbid.
//
// So `D-12` ships as {@link discoverClusters}, a function `D-03`, `D-13` and
// `D-14` call, and it is registered with the runner by nothing. **The gap is
// reported and not worked around**: a detector whose output is neither a flag
// nor a group has no home in `ports.ts`, and giving it one is a diff on a file
// this slice does not hold.
//
// **THE SECOND HALF OF `D-12`'s ROW IS ALSO UNSERVED AND IS SEPARATE.** Its
// registry row reads `runs_at: "funding"` and `window_trading_days: 0`, and
// `CRON_INVENTORY` rows the detector service as a NIGHTLY job. Nothing in this
// tree emits or consumes an event at funding time, so `D-12`'s clusters are
// discovered on the night's schedule rather than at the moment `M07` says the
// first cycle needs them. `AS-M7-01`'s margin is computed against day-0
// discovery.
//
// -----------------------------------------------------------------------------
// 3. `D-02` RUNS AND IS CAPPED AT SEVERITY 3, AND THE CAP IS THE MONEY DECISION
// -----------------------------------------------------------------------------
// `M07` section 3.3: severity is contextual, and *"moving a detector from 3 to 4
// changes who gets held"* -- 4 and 5 is the band `G-HOLD-REQUIRED` reads to hold
// a payout for 48 hours under `ADR-040`. `M07:151` gives `D-02` the row
// *"severity 4: D-02 below the floor with both accounts funded."*
//
// **THIS FILE WRITES 3 AND NEVER 4, FOR TWO INDEPENDENT REASONS, EITHER OF WHICH
// WOULD BE ENOUGH.**
//
//   1. **HALF THE STATISTIC IS UNEVALUABLE.** `M07:109` reads *"Rolling 20
//      trading day Pearson correlation of daily realized P&L below the
//      configured floor ..., WITH COMPARABLE SIZE"*, and
//      `comparable_size_tolerance_bp` is `unstated` in the registry. *"Below the
//      floor"* in the severity-4 row means this detector's statistic, and half a
//      statistic does not reach that row's condition.
//   2. **NOBODY HAS STATED THE SLA CLOCK.** `risk_flags_high_severity_has_sla`
//      requires `sla_due_at` at 4 and 5. `SD-M7-02` asks for *"a stated
//      time-to-first-touch"* and **no document in the corpus states one**; the
//      only duration near it is `ADR-040`'s 48-hour HOLD, which `M07:170` uses
//      as a BOUND on the clock rather than as its definition. A detector cannot
//      compute a clock nobody has set, and inventing one here would put a number
//      into a money path through a `Date`.
//
// **WHAT `D-02` DOES INSTEAD OF THRESHOLDING SIZE IS REPORT IT.** Every flag it
// raises carries `size_cents_ratio_bp` and `abs_pnl_ratio_bp` in its evidence,
// unthresholded, with `comparable_size_evaluated: false` beside them. The
// numbers reach the reviewer; the decision stays with whoever states the
// tolerance. `INV-M7-03` wants the numbers behind the accusation and this is
// what that looks like when one of the numbers has no threshold yet.
//
// -----------------------------------------------------------------------------
// 4. NO FLOAT ANYWHERE, INCLUDING IN A CORRELATION
// -----------------------------------------------------------------------------
// `P7` section 11 rule 17 and the constitution's Appendix. Money is `bigint`
// cents and a Pearson correlation is a ratio, so both are expressed exactly:
//
//   * A correlation is compared as `(10000 * |Sxy|)^2 >= floor^2 * Sxx * Syy`,
//     which is an inequality between two `bigint`s with no division and no
//     square root in the DECISION at all.
//   * The bp figure that reaches the evidence is a separate, TRUNCATED
//     quantity, computed with an integer square root and rounded TOWARD ZERO,
//     so a reported `-9999` may be a true `-9999.7`. The decision is never taken
//     from the rounded value, which is why the rounding direction is safe to
//     state rather than dangerous to have.
//   * A variance ratio needs no root at all: the `D^2` in a population variance
//     cancels between the numerator and the denominator, so the ratio is
//     `(D*SUM(S^2) - SUM(S)^2) / SUM_i(D*SUM(x_i^2) - SUM(x_i)^2)` over the
//     integers.
//
// **A `bigint` CANNOT BE `JSON.stringify`d AND `evidence` IS `jsonb`.**
// {@link asJsonNumber} converts one to a `number` when it is exactly
// representable and to a DECIMAL STRING when it is not, which is `ADR-157`
// section 5 finding 8's lesson applied in the other direction: the naive
// `Number()` on a large integer is lossy, and a lossy number inside an evidence
// object is an accusation with a wrong figure in it.
//
// -----------------------------------------------------------------------------
// 5. NO DETECTOR HERE WRITES A `risk_flags.status`, AND IT IS NOT BECAUSE THIS
//    FILE IS CAREFUL
// -----------------------------------------------------------------------------
// `ADR-155`, `INV-M7-02`, `P7` section 11 rule 11. `DetectorFinding` has no
// `status` field and `DetectorTx` has no addressed write, so `enforced` is a
// word with nowhere to go. This file adds no second control and needs none.
//
// **NOTHING HERE ADDS A `SqlExecutorReason` MEMBER, ADDS A `SystemReason`
// MEMBER, IMPORTS `pg`, IMPORTS `@merit/db`, OR CASTS PAST A KEY TYPE.**
// `ADR-165` rules one door at `src/db.ts` and this file is not it; every shape
// it needs arrives through `ports.ts`, structurally.
// =============================================================================

import type { CanaryMint, CanaryRow, CanarySubject } from './canary.ts';
import type {
  Detector,
  DetectorDefinition,
  DetectorFinding,
  DetectorGroup,
  DetectorOutcome,
  DetectorRow,
  DetectorScanInput,
  DetectorScanRequest,
  DetectorStream,
} from './ports.ts';
import { DetectorDeclined } from './ports.ts';

// -----------------------------------------------------------------------------
// The five, by the identifiers `detector_definitions.detector` carries
// -----------------------------------------------------------------------------

/** `M07:109`. Inverse P&L pair. The one that runs. */
export const D02 = 'D-02';
/** `M07:110`. Group inverse exposure. */
export const D03 = 'D-03';
/** `M07:122`. Day-0 graph-prior pairing. NOT a {@link Detector}; see header 2. */
export const D12 = 'D-12';
/** `M07:123`. Young-account fast path. */
export const D13 = 'D-13';
/** `M07:124`. Clique position-sum. */
export const D14 = 'D-14';

/**
 * The four this module registers with the runner.
 *
 * `D-12` IS ABSENT AND ITS ABSENCE IS SECTION 2 OF THE HEADER, not an omission.
 */
export const GRAPH_DETECTOR_IDS = [D02, D03, D13, D14] as const;

/**
 * `risk_flags.flag_type` for every finding in this module.
 *
 * **THE LISTED VOCABULARY HAS NO GROUP MEMBER AND THAT IS REPORTED RATHER THAN
 * REPAIRED.** `0008_risk.sql:119` lists ten types in a comment -- `inverse_pair`,
 * `copy_cluster`, `news_window`, `martingale`, `velocity`, `entity_cap`,
 * `payment_velocity`, `name_mismatch`, `reset_velocity`, `affiliate_self_deal`
 * -- and the column is `text NOT NULL` with no CHECK, so a new value is
 * insertable without a migration. `D-02` and `D-13` ARE inverse pairs and the
 * word fits them exactly. `D-03` and `D-14` are group findings and it does not,
 * and minting `group_inverse_exposure` here would put a vocabulary into the
 * flags queue that `P7-i`'s per-type evidence schema does not know about.
 * **Both of those detectors decline today, so no such row exists to be
 * mislabelled**, and the naming is a decision for the slice that holds the
 * queue.
 */
export const GRAPH_FLAG_TYPE = 'inverse_pair';

/**
 * `D-02`'s severity ceiling while `comparable_size_tolerance_bp` is unstated and
 * while `SD-M7-02`'s clock has no stated duration. Header section 3.
 */
export const CAPPED_SEVERITY = 3;

/**
 * The first trading day every canary in this module sits on.
 *
 * **IT IS DELIBERATELY BEFORE MERIT EXISTS AND THAT IS THE WHOLE REASON FOR
 * IT.** A detector's window has an upper bound at the run's trading day and
 * `Detector.canaries` is handed a {@link CanaryMint} and NOT the request, so a
 * canary cannot be minted relative to the day it is being run for. A battery
 * dated after the trading day of a replayed run would go unfound by a perfectly
 * healthy detector, which is a page at 02:00 for nothing and is how a canary
 * battery gets switched off. `canary.ts` states the licence: *"a canary's days
 * only need to be distinct and ordered."*
 */
export const CANARY_EPOCH = '2020-01-06';

// -----------------------------------------------------------------------------
// The registry, which is the only place a threshold comes from (`INV-M7-04`)
// -----------------------------------------------------------------------------

/**
 * One `detector_definitions.parameters` entry, as `P7-d`'s seed writes it.
 *
 * `{state, value, unit, cite, quote}` rather than a bare number, and `state` is
 * one of `stated`, `unstated`, `not_applicable` or `contextual`.
 */
interface SeededParameter {
  readonly state?: unknown;
  readonly value?: unknown;
  readonly cases?: unknown;
}

function parameterOf(definition: DetectorDefinition, name: string): SeededParameter | undefined {
  const raw = definition.parameters[name];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  return raw as SeededParameter;
}

/**
 * A severity, from a `stated` value or from the first case of a `contextual`
 * one, or {@link DetectorDeclined}.
 *
 * **A `contextual` PARAMETER'S CASE CARRIES ITS CONDITION AS PROSE AND THIS
 * FUNCTION CANNOT READ IT.** `D-03`'s single case is *"D-03 with a funded member
 * eligible this week"*, and *"eligible this week"* is `M01`'s eligibility, which
 * has no producer this deployable can read. So a caller taking a case value is
 * taking it UNCONDITIONALLY, which over-scores, and every caller below either
 * caps below the money band or declines before it gets here.
 */
function severityFrom(detector: string, definition: DetectorDefinition): number {
  const parameter = parameterOf(definition, 'severity');
  if (parameter?.state === 'stated' && typeof parameter.value === 'number') {
    return parameter.value;
  }
  if (parameter?.state === 'contextual' && Array.isArray(parameter.cases)) {
    const first = parameter.cases[0] as { value?: unknown } | undefined;
    if (typeof first?.value === 'number') {
      return first.value;
    }
  }
  throw new DetectorDeclined(
    detector,
    'its detector_definitions row states no severity and offers no case to take one from. ' +
      'Severity is a money decision every time it is written (M07 section 3.3): 4 and 5 is the ' +
      'band G-HOLD-REQUIRED reads to hold a payout for 48 hours under ADR-040, so a detector ' +
      'guessing one decides who gets held.',
  );
}

/**
 * Refuse a severity in the money band while `SD-M7-02`'s clock has no duration.
 *
 * `risk_flags_high_severity_has_sla` reads `severity < 4 OR sla_due_at IS NOT
 * NULL`, and `SD-M7-02` asks for *"a stated time-to-first-touch"* that no
 * document in the corpus supplies. A detector reaching this has a severity it
 * cannot pair with a clock, and inventing the clock is inventing a number in a
 * money path.
 */
function refuseUnclockedSeverity(detector: string, severity: number): void {
  if (severity >= 4) {
    throw new DetectorDeclined(
      detector,
      `it would score this finding at severity ${String(severity)}, which is the band ` +
        'risk_flags_high_severity_has_sla requires an sla_due_at at, and SD-M7-02 asks for "a ' +
        'stated time-to-first-touch" that no document in the corpus states. ADR-040\'s 48 hours ' +
        'is a BOUND on the clock (M07:170) and not its definition, so there is no duration to ' +
        'compute from and a flag at this band cannot be written.',
    );
  }
}

// -----------------------------------------------------------------------------
// Integer statistics. No float, no `Number` on anything that could be large
// -----------------------------------------------------------------------------

/** `floor(sqrt(value))` for a non-negative `bigint`, by Newton's method. */
export function integerSquareRoot(value: bigint): bigint {
  if (value < 0n) {
    throw new RangeError('integerSquareRoot is undefined for a negative value');
  }
  if (value < 2n) {
    return value;
  }
  let guess = value;
  let next = (guess + 1n) / 2n;
  while (next < guess) {
    guess = next;
    next = (guess + value / guess) / 2n;
  }
  return guess;
}

/**
 * A `bigint` as something `JSON.stringify` will accept without losing a digit.
 *
 * A `number` when it is exactly representable, a DECIMAL STRING when it is not.
 * `evidence` is `jsonb`, `JSON.stringify` throws on a `bigint`, and the naive
 * `Number()` on one is lossy above 2^53 (`ADR-157` section 5 finding 8), so a
 * flag written the naive way carries a wrong figure inside an accusation.
 */
export function asJsonNumber(value: bigint): number | string {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(-Number.MAX_SAFE_INTEGER)
    ? Number(value)
    : value.toString();
}

/**
 * The three second-moment sums a Pearson correlation is built from, scaled by
 * `n` so that no division happens at all.
 *
 * `Sxy = n*SUM(xy) - SUM(x)*SUM(y)`, `Sxx = n*SUM(x^2) - SUM(x)^2`,
 * `Syy = n*SUM(y^2) - SUM(y)^2`. `r = Sxy / sqrt(Sxx * Syy)`, and every one of
 * the three is an exact integer.
 */
export interface PearsonParts {
  readonly sxy: bigint;
  readonly sxx: bigint;
  readonly syy: bigint;
  readonly n: number;
}

/** {@link PearsonParts} over two series of equal length. */
export function pearsonParts(a: readonly bigint[], b: readonly bigint[]): PearsonParts {
  if (a.length !== b.length) {
    throw new RangeError('a Pearson correlation needs two series of the same length');
  }
  const n = BigInt(a.length);
  let sx = 0n;
  let sy = 0n;
  let sxx = 0n;
  let syy = 0n;
  let sxy = 0n;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0n;
    const y = b[i] ?? 0n;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  return { sxy: n * sxy - sx * sy, sxx: n * sxx - sx * sx, syy: n * syy - sy * sy, n: a.length };
}

/**
 * `true` when the correlation is at or below `floorBp`, decided WITHOUT a
 * division and WITHOUT a square root.
 *
 * `r <= f` for a negative `f` is `10000*Sxy <= f*sqrt(Sxx*Syy)`. Both sides are
 * negative, so with `S = -Sxy > 0` and `F = -f > 0` it is `10000*S >=
 * F*sqrt(Sxx*Syy)`, and squaring two positives preserves it:
 * `(10000*S)^2 >= F^2 * Sxx * Syy`.
 *
 * **A CONSTANT SERIES HAS ZERO VARIANCE AND NO CORRELATION AT ALL**, so
 * `Sxx = 0` or `Syy = 0` is `false` rather than a division by zero dressed up as
 * a detection. `canary.ts` varies its magnitudes by day for this reason.
 */
export function correlationAtOrBelow(parts: PearsonParts, floorBp: number): boolean {
  if (floorBp >= 0) {
    throw new RangeError('a correlation floor for an inverse-pair detector is negative');
  }
  if (parts.sxx <= 0n || parts.syy <= 0n || parts.sxy >= 0n) {
    return false;
  }
  const magnitude = -parts.sxy;
  const floor = BigInt(-floorBp);
  return 10000n * magnitude * (10000n * magnitude) >= floor * floor * parts.sxx * parts.syy;
}

/**
 * The correlation in basis points, TRUNCATED TOWARD ZERO, for the evidence only.
 *
 * `undefined` when either series is constant. **Never used to decide anything**:
 * {@link correlationAtOrBelow} takes the decision exactly, and this number is
 * what a reviewer reads. Truncating toward zero means a reported `-9999` may be
 * a true `-9999.7`, which is stated here so that nobody re-derives the firing
 * condition from the rounded figure.
 */
export function correlationBp(parts: PearsonParts): number | undefined {
  if (parts.sxx <= 0n || parts.syy <= 0n) {
    return undefined;
  }
  const magnitude = parts.sxy < 0n ? -parts.sxy : parts.sxy;
  const scaled = 10000n * magnitude;
  const bp = integerSquareRoot((scaled * scaled) / (parts.sxx * parts.syy));
  return parts.sxy < 0n ? -Number(bp) : Number(bp);
}

/**
 * `AS-M7-02`'s variance ratio, as two integers.
 *
 * *"For a candidate group, compare the variance of the summed daily P&L against
 * the sum of the members' variances. A genuinely independent group has a summed
 * variance near the sum of the parts; a hedged group has summed variance far
 * BELOW it, and that ratio is invariant to how the ring rotates its legs"*
 * (`M07:310`).
 *
 * A population variance is `(D*SUM(x^2) - SUM(x)^2) / D^2`, and the `D^2`
 * cancels between the numerator and the denominator, so **the ratio is exact
 * over the integers with no root and no division in the comparison.**
 */
export interface VarianceRatioParts {
  readonly numerator: bigint;
  readonly denominator: bigint;
  readonly days: number;
  readonly members: number;
}

/** {@link VarianceRatioParts} over one series per member, all the same length. */
export function varianceRatioParts(series: readonly (readonly bigint[])[]): VarianceRatioParts {
  const days = series[0]?.length ?? 0;
  for (const one of series) {
    if (one.length !== days) {
      throw new RangeError('a variance ratio needs one series per member over the same days');
    }
  }
  const d = BigInt(days);
  const summed: bigint[] = [];
  for (let day = 0; day < days; day += 1) {
    let total = 0n;
    for (const one of series) {
      total += one[day] ?? 0n;
    }
    summed.push(total);
  }
  const scaled = (one: readonly bigint[]): bigint => {
    let sum = 0n;
    let sumOfSquares = 0n;
    for (const value of one) {
      sum += value;
      sumOfSquares += value * value;
    }
    return d * sumOfSquares - sum * sum;
  };
  let denominator = 0n;
  for (const one of series) {
    denominator += scaled(one);
  }
  return { numerator: scaled(summed), denominator, days, members: series.length };
}

/**
 * `true` when the summed variance is at or below `maxRatioBp` of the sum of the
 * member variances.
 *
 * A group whose members are ALL constant has `denominator = 0` and is `false`
 * rather than a division by zero: a group that did not trade is flat for a
 * reason that has nothing to do with hedging, and it is the near-miss the suite
 * pins.
 */
export function varianceRatioAtOrBelow(parts: VarianceRatioParts, maxRatioBp: number): boolean {
  if (maxRatioBp < 0) {
    throw new RangeError('a variance ratio is non-negative, so its ceiling is too');
  }
  if (parts.denominator <= 0n) {
    return false;
  }
  return 10000n * parts.numerator <= BigInt(maxRatioBp) * parts.denominator;
}

/** The variance ratio in basis points, truncated. For the evidence only. */
export function varianceRatioBp(parts: VarianceRatioParts): number | undefined {
  if (parts.denominator <= 0n) {
    return undefined;
  }
  return Number((10000n * parts.numerator) / parts.denominator);
}

/**
 * A basis-point figure as the exact decimal string a `numeric` column round
 * trips.
 *
 * `correlation_groups.statistic` and `.threshold` are `numeric` and `ports.ts`
 * refuses a `number` for them, because `pg` hands a `numeric` back as a string
 * and the naive `Number()` on one is lossy. `-9500` becomes `"-0.9500"`.
 */
export function bpAsDecimalString(bp: number): string {
  const negative = bp < 0;
  const magnitude = Math.abs(bp);
  const whole = Math.trunc(magnitude / 10000);
  const fraction = String(magnitude % 10000).padStart(4, '0');
  return `${negative ? '-' : ''}${String(whole)}.${fraction}`;
}

// -----------------------------------------------------------------------------
// Reading a row, where a row may have come from the database or from the mint
// -----------------------------------------------------------------------------
//
// A DETECTOR IS BLIND TO WHICH, WHICH IS THE PROPERTY THE WHOLE CANARY DESIGN
// TURNS ON (`ports.ts`, `DetectorScanInput.rows`). So every accessor below reads
// a value by its Drizzle property name and accepts the representations both
// sides produce: a `date` column arrives as `YYYY-MM-DD` from either, a `bigint`
// column arrives as a `bigint` from either, and a `bytea` column arrives as a
// `Uint8Array` from the database and as a string from a fixture.

function textOf(row: DetectorRow, property: string): string | undefined {
  const value = row[property];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function centsOf(row: DetectorRow, property: string): bigint | undefined {
  const value = row[property];
  if (typeof value === 'bigint') {
    return value;
  }
  return undefined;
}

function countOf(row: DetectorRow, property: string): number | undefined {
  const value = row[property];
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function instantOf(row: DetectorRow, property: string): Date | undefined {
  const value = row[property];
  return value instanceof Date ? value : undefined;
}

/**
 * A `bytea` column as a comparison key.
 *
 * `identity_signals.value_hash` is the column two identities share when they
 * share a signal, and it arrives as bytes from the database. Two identities
 * share a signal when the BYTES are equal, so the key is the hex of them and
 * never the object, which would compare by reference and find nothing.
 */
function hashKeyOf(row: DetectorRow, property: string): string | undefined {
  const value = row[property];
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Uint8Array) {
    let hex = '';
    for (const byte of value) {
      hex += byte.toString(16).padStart(2, '0');
    }
    return hex;
  }
  return undefined;
}

// -----------------------------------------------------------------------------
// The window, and the calendar this tree does not have
// -----------------------------------------------------------------------------

/**
 * Calendar days read per trading day of window.
 *
 * **THIS IS A DERIVATION AND NOT A CALENDAR, AND THE DIFFERENCE IS A FINDING
 * RATHER THAN A DETAIL.** `D-02`'s window is *"20 TRADING days"* and `D-13`'s is
 * *"a 5 TRADING day window"*. Translating either into the `date` bound a
 * `rowsWhere` filter carries needs the exchange session calendar, which
 * `CLAUDE.md` keeps as data and which **no table, no package and no module in
 * this tree supplies** -- `canary.ts` says so about its own helper in the same
 * words: *"THIS IS NOT A TRADING CALENDAR AND MUST NEVER BE MISTAKEN FOR ONE."*
 *
 * So the READ is bounded generously and the WINDOW is taken from the days that
 * actually came back: a pair's window is the most recent N trading days on which
 * BOTH sides have a mark, which is what *"rolling N trading day"* means and
 * needs no calendar at all. The factor exists only to keep the read bounded, and
 * **2 is the safe direction**: a factor too LARGE reads rows the window discards,
 * and a factor too SMALL silently shortens the window and turns a detection into
 * a false negative. Twenty trading days span 40 calendar days unless the
 * exchange is shut for more than half of them.
 *
 * **THE DAY A `TradingCalendar` LANDS, THIS CONSTANT BECOMES A LOOKUP** and the
 * read stops being generous.
 */
export const CALENDAR_DAYS_PER_TRADING_DAY = 2;

/** `YYYY-MM-DD` plus `days`, on the proleptic Gregorian calendar. Not a calendar. */
export function addCalendarDays(from: string, days: number): string {
  const at = new Date(`${from}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** The `date` lower bound a window of `tradingDays` reads from. */
export function readFrom(tradingDay: string, tradingDays: number): string {
  return addCalendarDays(tradingDay, -(tradingDays * CALENDAR_DAYS_PER_TRADING_DAY));
}

// -----------------------------------------------------------------------------
// The stream names, which are the detector's labels and not the tables
// -----------------------------------------------------------------------------

const MARKS = 'marks';
const ACCOUNTS = 'accounts';
const LINKS = 'links';
const SIGNALS = 'signals';
const FILLS = 'fills';

/** What `accounts` contributes to every join in this file. */
interface AccountFacts {
  readonly accountId: string;
  readonly identityId: string;
  readonly sizeCents: bigint | undefined;
  readonly openedOn: string | undefined;
}

function accountBook(rows: readonly DetectorRow[]): ReadonlyMap<string, AccountFacts> {
  const book = new Map<string, AccountFacts>();
  for (const row of rows) {
    const accountId = textOf(row, 'id');
    const identityId = textOf(row, 'identityId');
    if (accountId === undefined || identityId === undefined) {
      continue;
    }
    book.set(accountId, {
      accountId,
      identityId,
      sizeCents: centsOf(row, 'sizeCents'),
      openedOn: textOf(row, 'openedOn'),
    });
  }
  return book;
}

/** Realized P&L by trading day, per account, at or before `tradingDay`. */
function marksByAccount(
  rows: readonly DetectorRow[],
  tradingDay: string,
): ReadonlyMap<string, ReadonlyMap<string, bigint>> {
  const byAccount = new Map<string, Map<string, bigint>>();
  for (const row of rows) {
    const accountId = textOf(row, 'accountId');
    const day = textOf(row, 'tradingDay');
    const pnl = centsOf(row, 'realizedPnlCents');
    // THE UPPER BOUND, APPLIED HERE BECAUSE A FILTER CANNOT CARRY IT. Header
    // section 1 (b): one narrowing per column, and `tradingDay` spent its
    // narrowing on the lower bound.
    if (accountId === undefined || day === undefined || pnl === undefined || day > tradingDay) {
      continue;
    }
    const days = byAccount.get(accountId) ?? new Map<string, bigint>();
    days.set(day, pnl);
    byAccount.set(accountId, days);
  }
  return byAccount;
}

/**
 * The most recent `window` trading days both accounts have a mark on.
 *
 * `undefined` when there are fewer than `window` of them, which is **the whole
 * of `GS-118`'s negative assertion**: a six-account ring on the 5 trading day
 * path has five days of marks, `D-02`'s window is 20, and no pair on that ring
 * has 20 common days, so `D-02` does not fire and the reason is the window
 * rather than a threshold, a parameter or an accident.
 */
function commonDays(
  a: ReadonlyMap<string, bigint>,
  b: ReadonlyMap<string, bigint>,
  window: number,
): readonly string[] | undefined {
  const shared: string[] = [];
  for (const day of a.keys()) {
    if (b.has(day)) {
      shared.push(day);
    }
  }
  if (shared.length < window) {
    return undefined;
  }
  shared.sort();
  return shared.slice(shared.length - window);
}

function seriesOver(
  days: readonly string[],
  marks: ReadonlyMap<string, bigint>,
): readonly bigint[] {
  return days.map((day) => marks.get(day) ?? 0n);
}

/** `10000 * min / max`, or `undefined` when either side is absent or zero. */
function ratioBp(left: bigint | undefined, right: bigint | undefined): number | undefined {
  if (left === undefined || right === undefined || left <= 0n || right <= 0n) {
    return undefined;
  }
  const low = left < right ? left : right;
  const high = left < right ? right : left;
  return Number((10000n * low) / high);
}

function absoluteTotal(days: readonly string[], marks: ReadonlyMap<string, bigint>): bigint {
  let total = 0n;
  for (const day of days) {
    const value = marks.get(day) ?? 0n;
    total += value < 0n ? -value : value;
  }
  return total;
}

// -----------------------------------------------------------------------------
// `D-12`: the watched-cluster set, which is a FUNCTION and not a `Detector`
// -----------------------------------------------------------------------------

/**
 * One watched cluster: the identities, the accounts under them, and why.
 *
 * `M07:122`. **IT ACCUSES NOBODY** and nothing writes it anywhere; it is the
 * candidate set `D-03`, `D-13` and `D-14` narrow to.
 */
export interface WatchedCluster {
  /** The identities in one connected component of the prior graph. */
  readonly identityIds: readonly string[];
  /** Every account those identities hold, as `accounts` reported them. */
  readonly accountIds: readonly string[];
  /** `identity_link` and `signal:<kind>`, sorted. What joined the component. */
  readonly via: readonly string[];
}

/** What {@link discoverClusters} reads. */
export interface ClusterInput {
  readonly links: readonly DetectorRow[];
  readonly signals: readonly DetectorRow[];
  readonly accounts: readonly DetectorRow[];
}

/**
 * `D-12`, as the function `M07`'s row actually describes.
 *
 * *"Candidate pairs and groups formed from graph priors at funding time, with
 * zero trading data. Output is a watched-cluster set, not a flag: it seeds
 * `D-13` and `D-14` rather than accusing anyone"* (`M07:122`), and `M07:110`
 * gives the same construction from the other end: *"Group discovery from
 * `identity_links` plus a candidate search over accounts sharing ANY signal."*
 *
 * **`prior_weights` IS `unstated` AND THIS FUNCTION NEEDS NONE, WHICH IS WHY
 * `D-12` IS THE ONE OF THE FIVE THAT IS NOT BLOCKED ON A NUMBER.** A weight
 * would RANK or NARROW the candidate set; *"sharing any signal"* is the
 * unnarrowed set and is the maximal one. Taking the maximal set is safe here for
 * a reason that would not hold for a detector: this output accuses nobody, so
 * over-inclusion costs computation rather than a flag against a person.
 *
 * **A SUPPRESSED LINK IS NOT AN EDGE AND A DISPUTED ONE IS.** `suppressed` is an
 * operator's decision that the link is not real. `disputed_at` is the TRADER's
 * assertion, and `AS-M7-04` requires a disputed link to *"render on the graph
 * before an admin acts"*, so dropping it here would make a dispute
 * self-executing.
 *
 * **A COMPONENT OF ONE IDENTITY IS NOT A CLUSTER.** One person holding several
 * accounts is `D-07`'s entity cap, not a ring.
 */
export function discoverClusters(input: ClusterInput): readonly WatchedCluster[] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = parent.get(id) ?? id;
    while (root !== (parent.get(root) ?? root)) {
      root = parent.get(root) ?? root;
    }
    parent.set(id, root);
    return root;
  };
  const union = (left: string, right: string): void => {
    const a = find(left);
    const b = find(right);
    parent.set(a, b);
    parent.set(b, b);
  };

  // THE EDGES ARE COLLECTED BEFORE THEY ARE MERGED, so `via` is assigned to the
  // component a member ENDS in rather than to the one it was in when the edge
  // was read. Two edges merging three identities in either order produce the
  // same cluster and the same reasons.
  const edges: { readonly a: string; readonly b: string; readonly why: string }[] = [];

  for (const row of input.links) {
    const a = textOf(row, 'identityA');
    const b = textOf(row, 'identityB');
    if (a === undefined || b === undefined || a === b) {
      continue;
    }
    edges.push({ a, b, why: 'identity_link' });
  }

  const bySignal = new Map<string, { readonly kind: string; readonly holders: Set<string> }>();
  for (const row of input.signals) {
    const identityId = textOf(row, 'identityId');
    const kind = textOf(row, 'kind');
    const hash = hashKeyOf(row, 'valueHash');
    if (identityId === undefined || kind === undefined || hash === undefined) {
      continue;
    }
    const key = `${kind}\u0000${hash}`;
    const seen = bySignal.get(key) ?? { kind, holders: new Set<string>() };
    seen.holders.add(identityId);
    bySignal.set(key, seen);
  }
  for (const { kind, holders } of bySignal.values()) {
    const members = [...holders];
    const first = members[0];
    if (first === undefined) {
      continue;
    }
    for (const other of members.slice(1)) {
      edges.push({ a: first, b: other, why: `signal:${kind}` });
    }
  }

  for (const edge of edges) {
    union(edge.a, edge.b);
  }

  const accountsOf = new Map<string, string[]>();
  for (const facts of accountBook(input.accounts).values()) {
    const held = accountsOf.get(facts.identityId) ?? [];
    held.push(facts.accountId);
    accountsOf.set(facts.identityId, held);
  }

  const components = new Map<string, Set<string>>();
  for (const id of [...parent.keys()]) {
    const root = find(id);
    const members = components.get(root) ?? new Set<string>();
    members.add(id);
    components.set(root, members);
  }
  const reasons = new Map<string, Set<string>>();
  for (const edge of edges) {
    const root = find(edge.a);
    const carried = reasons.get(root) ?? new Set<string>();
    carried.add(edge.why);
    reasons.set(root, carried);
  }

  const clusters: WatchedCluster[] = [];
  for (const [root, members] of components) {
    if (members.size < 2) {
      continue;
    }
    const identityIds = [...members].sort();
    const accountIds: string[] = [];
    for (const identityId of identityIds) {
      accountIds.push(...(accountsOf.get(identityId) ?? []));
    }
    accountIds.sort();
    clusters.push({ identityIds, accountIds, via: [...(reasons.get(root) ?? [])].sort() });
  }
  clusters.sort((left, right) =>
    (left.identityIds[0] ?? '').localeCompare(right.identityIds[0] ?? ''),
  );
  return clusters;
}

// -----------------------------------------------------------------------------
// Declining, and declining ONCE with everything that is missing
// -----------------------------------------------------------------------------

/**
 * Every named integer parameter, or one {@link DetectorDeclined} naming ALL the
 * ones that are missing.
 *
 * **IT COLLECTS RATHER THAN THROWING ON THE FIRST**, because the person reading
 * a `failed` run at 08:00 needs the whole list: a decline naming one unstated
 * threshold invites a founder to state one number and see the same run fail
 * again tomorrow. `D-13` is missing two and `D-03` is missing three.
 */
function requiredIntegers(
  detector: string,
  definition: DetectorDefinition,
  names: readonly string[],
): Readonly<Record<string, number>> {
  const values: Record<string, number> = {};
  const problems: string[] = [];
  for (const name of names) {
    const parameter = parameterOf(definition, name);
    if (parameter === undefined) {
      problems.push(`"${name}" is absent from its detector_definitions row`);
      continue;
    }
    if (parameter.state !== 'stated') {
      problems.push(`"${name}" is ${JSON.stringify(parameter.state)}`);
      continue;
    }
    if (typeof parameter.value !== 'number' || !Number.isInteger(parameter.value)) {
      problems.push(
        `"${name}" is stated as ${JSON.stringify(parameter.value)}, which is not an integer`,
      );
      continue;
    }
    values[name] = parameter.value;
  }
  if (problems.length > 0) {
    throw new DetectorDeclined(
      detector,
      `${problems.join('; ')}. OQ-M7-02 is the founder's question on every one of these and ` +
        "P7-d's seed writes no number it cannot cite, so this run declines rather than inventing " +
        'a threshold or matching nothing under one, which is FM-M7-01: "detection appears healthy ' +
        'and is absent." Nothing was read: a detector that cannot run does not pay for a window.',
    );
  }
  return values;
}

/**
 * A `stated` text parameter whose value must be `expected`, or
 * {@link DetectorDeclined}.
 *
 * **A REGISTRY THAT DISAGREED WITH THE CODE WOULD OTHERWISE BE OVERRULED IN
 * SILENCE.** `D-13`'s `conditions_combined` is `"conjunction"`, and a detector
 * that read it and merely stopped firing when it said something else would
 * report `ok` with nothing found, which is `FM-M7-01`. A detector that ignored
 * it entirely would make the registry row decorative.
 */
function requireStatedText(
  detector: string,
  definition: DetectorDefinition,
  name: string,
  expected: string,
): void {
  const parameter = parameterOf(definition, name);
  if (parameter?.state !== 'stated' || parameter.value !== expected) {
    throw new DetectorDeclined(
      detector,
      `"${name}" is ${JSON.stringify(parameter?.state)} carrying ` +
        `${JSON.stringify(parameter?.value)} in its current detector_definitions row, and this ` +
        `detector is written for ${JSON.stringify(expected)}. M07:123 states it as "All three, ` +
        'not any of three", so a row saying otherwise is a change to what the detector MEANS and ' +
        'is refused here rather than silently ignored or silently obeyed.',
    );
  }
}

function integerAt(values: Readonly<Record<string, number>>, name: string): number {
  return values[name] ?? 0;
}

// -----------------------------------------------------------------------------
// The canary rows this module adds beside `AS-M7-05`'s named shapes
// -----------------------------------------------------------------------------
//
// `AS-M7-05`'s four shapes span `fills`, `daily_marks`, `payout_transfers` and
// the identity graph, and `canary.ts` says a detector needing a fifth builds one
// from `CanaryMint.subject` AND STATES WHY. Every detector in this file joins its
// window to `accounts` for an `identity_id` -- flags attach to humans -- and
// three of them join to `identity_links` or `identity_signals` for the cluster
// they operate on. **A canary that carried only marks or only fills would be
// unjoinable and therefore unfindable by a correct detector**, which is a page
// at 02:00 for nothing.
//
// So the shapes below EXTEND `hedgedPair` rather than replacing it, and the rows
// they add are the join rows and nothing else.

/** An `accounts` row for a synthetic account. */
function canaryAccount(accountId: string, identityId: string, sizeCents: bigint): CanaryRow {
  return {
    id: accountId,
    identityId,
    sizeCents,
    openedOn: CANARY_EPOCH,
    status: 'active',
    phase: 'funded',
  };
}

/** An `identity_signals` row putting two identities in one component. */
function canarySignal(rowId: string, identityId: string, hash: string): CanaryRow {
  return { id: rowId, identityId, kind: 'device', valueHash: hash, observationCount: 1 };
}

/** A `daily_marks` row. */
function canaryMark(rowId: string, accountId: string, tradingDay: string, pnl: bigint): CanaryRow {
  return {
    id: rowId,
    accountId,
    tradingDay,
    realizedPnlCents: pnl,
    tradedDay: true,
    winDay: pnl > 0n,
  };
}

/** A `fills` row. */
function canaryFill(
  rowId: string,
  accountId: string,
  tradingDay: string,
  at: Date,
  side: string,
  quantity: number,
): CanaryRow {
  return { id: rowId, accountId, symbol: 'ESH6', side, quantity, executedAt: at, tradingDay };
}

/** `CANARY_EPOCH` at 14:30Z, plus `day` days and `seconds` seconds. */
function canaryInstant(day: number, seconds: number): Date {
  const midday = new Date(`${addCalendarDays(CANARY_EPOCH, day)}T14:30:00.000Z`);
  return new Date(midday.getTime() + seconds * 1000);
}

// -----------------------------------------------------------------------------
// `D-02`: inverse P&L pair. THE ONE THAT RUNS
// -----------------------------------------------------------------------------

/**
 * The trading days `D-02`'s canary pair runs for.
 *
 * **IT CANNOT BE READ FROM THE REGISTRY AND THAT IS A PROPERTY OF THE PORT.**
 * `Detector.canaries(mint)` is handed a {@link CanaryMint} and NOT a
 * {@link DetectorScanRequest}, so a battery cannot be sized to the parameters it
 * has to satisfy. A canary shorter than `window_trading_days` goes unfound by a
 * perfectly healthy detector and pages for nothing, so this is **twice the
 * seeded window of 20**, and a window stated beyond 40 needs this constant to
 * move with it. Reported rather than worked around: reading the request during
 * `streams()` and stashing it would make the battery depend on the runner
 * calling one method before the other, which `ports.ts` does not promise.
 */
export const D02_CANARY_TRADING_DAYS = 40;

/** `D-02`'s canary account size, in integer cents. A 50K account. */
const CANARY_ACCOUNT_SIZE_CENTS = 5000000n;

/**
 * `D-02`, inverse P&L pair (`M07:109`).
 *
 * **IT IS A SECOND-CYCLE DETECTOR AND THE LABEL IS IN THE CODE RATHER THAN IN A
 * COMMENT ABOUT THE CODE.** `M07:291`: *"D-02 keeps its long window and is
 * explicitly labelled a SECOND-CYCLE detector: it catches persistence, not
 * entry."* Its registry row carries `second_cycle_detector: true` and this
 * detector reads that flag rather than asserting the label about itself, so the
 * day the registry says otherwise the code says otherwise too.
 *
 * **`GS-118` IS THE ASSERTION THAT MAKES THE LABEL REAL AND IT IS A NEGATIVE
 * ONE**: a six-account ring on the 5 trading day path is flagged by `D-01` and
 * `D-03` before the first settlement lands, and `D-02` *"is asserted NOT to have
 * fired, because its 20 day window has no data yet."* That is a property of
 * {@link commonDays} returning `undefined` below 20 common days, and it is the
 * one thing in this file a reader would omit.
 */
export function inversePairDetector(): Detector {
  return {
    id: D02,
    streams: (request: DetectorScanRequest): readonly DetectorStream[] => {
      const values = requiredIntegers(D02, request.definition, [
        'window_trading_days',
        'correlation_floor_bp',
      ]);
      const window = integerAt(values, 'window_trading_days');
      return [
        {
          name: MARKS,
          table: 'dailyMarks',
          where: {
            // The lower bound crosses; the upper bound is applied in memory,
            // because a filter carries one narrowing per column.
            tradingDay: request.terms.atLeast(readFrom(request.tradingDay, window)),
            // A SUPERSEDED MARK IS NOT THE DAY'S P&L. `daily_marks.superseded_by`
            // points at the row that replaced it, and correlating a replaced
            // series against a live one is a statistic about a correction.
            supersededBy: request.terms.isNull(),
          },
        },
        {
          name: ACCOUNTS,
          table: 'accounts',
          // AN ACCOUNT OPENED AFTER THIS TRADING DAY HAS NO MARK IN THE WINDOW.
          // The narrowing is true rather than chosen to satisfy `NamesAColumn`,
          // and it is the whole `accounts` table in every practical case, which
          // is the join cost `ADR-157` section 5 named.
          where: { openedOn: request.terms.atMost(request.tradingDay) },
        },
      ];
    },
    canaries: (mint: CanaryMint): readonly CanarySubject[] => {
      const id = mint.subject(D02, 0);
      const pair = mint.hedgedPair(D02, 0, {
        stream: MARKS,
        days: D02_CANARY_TRADING_DAYS,
        from: CANARY_EPOCH,
      });
      const longIdentity = id.actor('i-long');
      const shortIdentity = id.actor('i-short');
      return [
        {
          ...pair,
          actors: [...pair.actors, longIdentity, shortIdentity],
          rows: {
            ...pair.rows,
            [ACCOUNTS]: [
              canaryAccount(id.actor('a-long'), longIdentity, CANARY_ACCOUNT_SIZE_CENTS),
              canaryAccount(id.actor('a-short'), shortIdentity, CANARY_ACCOUNT_SIZE_CENTS),
            ],
          },
        },
      ];
    },
    scan: ({ request, rows }: DetectorScanInput): DetectorOutcome => {
      const values = requiredIntegers(D02, request.definition, [
        'window_trading_days',
        'correlation_floor_bp',
      ]);
      const window = integerAt(values, 'window_trading_days');
      const floorBp = integerAt(values, 'correlation_floor_bp');
      const secondCycle = parameterOf(request.definition, 'second_cycle_detector')?.value === true;
      const sizeTolerance = parameterOf(request.definition, 'comparable_size_tolerance_bp');

      const book = accountBook(rows[ACCOUNTS] ?? []);
      const marks = marksByAccount(rows[MARKS] ?? [], request.tradingDay);
      const eligible = [...marks.entries()]
        .filter(([, days]) => days.size >= window)
        .map(([accountId]) => accountId)
        .sort();

      const findings: DetectorFinding[] = [];
      let pairsCompared = 0;
      for (let left = 0; left < eligible.length; left += 1) {
        for (let right = left + 1; right < eligible.length; right += 1) {
          const aId = eligible[left] ?? '';
          const bId = eligible[right] ?? '';
          const aMarks = marks.get(aId);
          const bMarks = marks.get(bId);
          if (aMarks === undefined || bMarks === undefined) {
            continue;
          }
          const days = commonDays(aMarks, bMarks, window);
          if (days === undefined) {
            continue;
          }
          pairsCompared += 1;
          const parts = pearsonParts(seriesOver(days, aMarks), seriesOver(days, bMarks));
          if (!correlationAtOrBelow(parts, floorBp)) {
            continue;
          }
          const scored = new Set<string>();
          for (const [self, other] of [
            [aId, bId],
            [bId, aId],
          ] as const) {
            const selfFacts = book.get(self);
            const otherFacts = book.get(other);
            // NO `accounts` ROW MEANS NO IDENTITY, AND A FLAG ATTACHES TO A
            // HUMAN. An account whose row did not come back cannot be attributed
            // to anybody, and inventing an identity_id would either break a
            // foreign key or accuse the wrong person.
            if (selfFacts === undefined || scored.has(selfFacts.identityId)) {
              continue;
            }
            scored.add(selfFacts.identityId);
            const selfMarks = self === aId ? aMarks : bMarks;
            const otherMarks = self === aId ? bMarks : aMarks;
            findings.push({
              subjects: [aId, bId],
              identityId: selfFacts.identityId,
              accountId: self,
              flagType: GRAPH_FLAG_TYPE,
              // SEVERITY 3 AND NEVER 4. Header section 3: half the statistic is
              // unevaluable and SD-M7-02's clock has no stated duration, and
              // either one alone would forbid the money band.
              severity: CAPPED_SEVERITY,
              evidence: {
                detector: D02,
                second_cycle_detector: secondCycle,
                window_trading_days: window,
                trading_days_compared: days.length,
                first_trading_day: days[0] ?? null,
                last_trading_day: days[days.length - 1] ?? null,
                correlation_bp: correlationBp(parts) ?? null,
                correlation_floor_bp: floorBp,
                counterparty_account_id: other,
                counterparty_identity_id: otherFacts?.identityId ?? null,
                // REPORTED AND NOT THRESHOLDED. Header section 3.
                comparable_size_evaluated: false,
                comparable_size_tolerance_state: String(sizeTolerance?.state ?? 'absent'),
                size_cents_ratio_bp: ratioBp(selfFacts.sizeCents, otherFacts?.sizeCents) ?? null,
                abs_pnl_ratio_bp:
                  ratioBp(absoluteTotal(days, selfMarks), absoluteTotal(days, otherMarks)) ?? null,
                severity_capped_at: CAPPED_SEVERITY,
                severity_cap_reason:
                  'M07:151 scores this detector 4 for "below the floor with both accounts funded". ' +
                  "The floor here is the correlation half of M07:109's statistic only, because " +
                  'comparable_size_tolerance_bp is unstated, and severity 4 additionally requires ' +
                  'an sla_due_at whose duration SD-M7-02 asks for and no document states.',
                pairs_compared: pairsCompared,
                accounts_in_window: eligible.length,
              },
            });
          }
        }
      }
      return { findings };
    },
  };
}

// -----------------------------------------------------------------------------
// `D-03`: group inverse exposure. DECLINES ON THREE UNSTATED PARAMETERS
// -----------------------------------------------------------------------------

/** The trading days `D-03`'s canary clique runs for. See {@link D02_CANARY_TRADING_DAYS}. */
export const D03_CANARY_TRADING_DAYS = 40;

/** The most recent `window` trading days every member has a mark on. */
function commonDaysAcross(
  members: readonly ReadonlyMap<string, bigint>[],
  window: number,
): readonly string[] | undefined {
  const first = members[0];
  if (first === undefined) {
    return undefined;
  }
  const shared: string[] = [];
  for (const day of first.keys()) {
    if (members.every((one) => one.has(day))) {
      shared.push(day);
    }
  }
  if (shared.length < window) {
    return undefined;
  }
  shared.sort();
  return shared.slice(shared.length - window);
}

/**
 * `D-03`, group inverse exposure (`M07:110`), and `AS-M7-02`'s counter.
 *
 * *"For a candidate group, compare the variance of the summed daily P&L against
 * the sum of the members' variances ... that ratio is invariant to how the ring
 * rotates its legs"* (`M07:310`).
 *
 * **IT DECLINES, AND THE THREE MISSING NUMBERS ARE NOT THE ONLY THING IN ITS
 * WAY.** `max_variance_ratio_bp`, `max_candidate_group_size` and
 * `window_trading_days` are all `unstated` in the registry. **AND EVEN WITH ALL
 * THREE STATED IT STILL COULD NOT WRITE ITS FLAG**: `M07:150` scores it 5,
 * `risk_flags_high_severity_has_sla` requires a clock at that band, and
 * `SD-M7-02`'s time-to-first-touch has no stated duration anywhere in the
 * corpus. That fourth blocker is invisible from the seed and is why
 * {@link refuseUnclockedSeverity} is called in `streams()` rather than
 * discovered at the write.
 *
 * **THE JOIN IS AFFORDABLE AND IT IS THE ONE THING `ADR-157` SECTION 5 EXPECTED
 * TO BLOCK THIS DETECTOR.** Group discovery reads `identity_links` and
 * `identity_signals` whole and joins them in the runner; the variance ratio
 * reads the window's marks and joins them by account. Both are ordinary code.
 * What it costs is header section 1 (a): the marks of the whole marked
 * population cross the boundary so that the marks of one group can be computed
 * over.
 */
export function groupInverseExposureDetector(): Detector {
  return {
    id: D03,
    streams: (request: DetectorScanRequest): readonly DetectorStream[] => {
      const values = requiredIntegers(D03, request.definition, [
        'window_trading_days',
        'max_variance_ratio_bp',
        'max_candidate_group_size',
      ]);
      refuseUnclockedSeverity(D03, severityFrom(D03, request.definition));
      const window = integerAt(values, 'window_trading_days');
      return [
        {
          name: MARKS,
          table: 'dailyMarks',
          where: {
            tradingDay: request.terms.atLeast(readFrom(request.tradingDay, window)),
            supersededBy: request.terms.isNull(),
          },
        },
        {
          name: ACCOUNTS,
          table: 'accounts',
          where: { openedOn: request.terms.atMost(request.tradingDay) },
        },
        {
          name: LINKS,
          table: 'identityLinks',
          // A SUPPRESSED LINK IS AN OPERATOR SAYING THE EDGE IS NOT REAL. A
          // DISPUTED one is the trader saying so and stays an edge (AS-M7-04).
          where: { suppressed: false, createdAt: request.terms.atMost(request.now) },
        },
        {
          name: SIGNALS,
          table: 'identitySignals',
          // A signal first seen after this run's instant did not inform it, so a
          // replay of this trading day reads the same rows this run did.
          where: { firstSeenAt: request.terms.atMost(request.now) },
        },
      ];
    },
    canaries: (mint: CanaryMint): readonly CanarySubject[] => {
      const id = mint.subject(D03, 0);
      const identities = [id.actor('i-0'), id.actor('i-1'), id.actor('i-2')];
      const accounts = [id.actor('a-0'), id.actor('a-1'), id.actor('a-2')];
      const hash = id.actor('h-device');
      const marks: CanaryRow[] = [];
      let row = 0;
      for (let day = 0; day < D03_CANARY_TRADING_DAYS; day += 1) {
        // THREE LEGS THAT SUM TO ZERO EVERY DAY, WHICH IS AS-M7-02's ROTATION.
        // Every leg varies day by day, so every member has variance and the
        // denominator is non-zero; the summed series is flat, so the numerator
        // is zero and the ratio is zero. Integer cents throughout.
        const magnitude = BigInt(250000 * (day + 1));
        const tradingDay = addCalendarDays(CANARY_EPOCH, day);
        marks.push(canaryMark(id.row(row), accounts[0] ?? '', tradingDay, 2n * magnitude));
        row += 1;
        marks.push(canaryMark(id.row(row), accounts[1] ?? '', tradingDay, -magnitude));
        row += 1;
        marks.push(canaryMark(id.row(row), accounts[2] ?? '', tradingDay, -magnitude));
        row += 1;
      }
      return [
        {
          id: id.id,
          detector: D03,
          nonce: mint.nonce,
          shape: 'hedged-pair',
          actors: [...accounts, ...identities],
          rows: {
            [MARKS]: marks,
            [ACCOUNTS]: accounts.map((accountId, at) =>
              canaryAccount(accountId, identities[at] ?? '', CANARY_ACCOUNT_SIZE_CENTS),
            ),
            [SIGNALS]: identities.map((identityId, at) =>
              canarySignal(id.row(1000 + at), identityId, hash),
            ),
            [LINKS]: [],
          },
        },
      ];
    },
    scan: ({ request, rows }: DetectorScanInput): DetectorOutcome => {
      const values = requiredIntegers(D03, request.definition, [
        'window_trading_days',
        'max_variance_ratio_bp',
        'max_candidate_group_size',
      ]);
      const severity = severityFrom(D03, request.definition);
      refuseUnclockedSeverity(D03, severity);
      const window = integerAt(values, 'window_trading_days');
      const maxRatioBp = integerAt(values, 'max_variance_ratio_bp');
      const maxGroup = integerAt(values, 'max_candidate_group_size');

      const book = accountBook(rows[ACCOUNTS] ?? []);
      const marks = marksByAccount(rows[MARKS] ?? [], request.tradingDay);
      const clusters = discoverClusters({
        links: rows[LINKS] ?? [],
        signals: rows[SIGNALS] ?? [],
        accounts: rows[ACCOUNTS] ?? [],
      });

      const findings: DetectorFinding[] = [];
      const groups: DetectorGroup[] = [];
      for (const cluster of clusters) {
        const members = cluster.accountIds.filter((accountId) => marks.has(accountId));
        // `correlation_groups_is_a_group` STARTS THE TABLE AT THREE, and
        // `max_candidate_group_size` is M07:310's "bounded search size so the
        // cost stays linear".
        if (members.length < 3 || members.length > maxGroup) {
          continue;
        }
        const series = members.map(
          (accountId) => marks.get(accountId) ?? new Map<string, bigint>(),
        );
        const days = commonDaysAcross(series, window);
        if (days === undefined) {
          continue;
        }
        const parts = varianceRatioParts(series.map((one) => seriesOver(days, one)));
        if (!varianceRatioAtOrBelow(parts, maxRatioBp)) {
          continue;
        }
        const ratio = varianceRatioBp(parts);
        // THE IDENTITIES THAT OWN A MEMBER ACCOUNT, AND NOT THE CLUSTER'S.
        // A cluster may hold an identity whose accounts have no marks in the
        // window, and a flag against that person would be an accusation about a
        // group they contributed no row to.
        const identityIds = [
          ...new Set(members.map((accountId) => book.get(accountId)?.identityId ?? '')),
        ]
          .filter((identityId) => identityId.length > 0)
          .sort();
        const evidence = {
          detector: D03,
          method: 'summed-variance-ratio',
          member_account_ids: [...members],
          member_identity_ids: identityIds,
          discovered_via: [...cluster.via],
          window_trading_days: window,
          trading_days_compared: days.length,
          first_trading_day: days[0] ?? null,
          last_trading_day: days[days.length - 1] ?? null,
          variance_ratio_bp: ratio ?? null,
          max_variance_ratio_bp: maxRatioBp,
          summed_variance_scaled: asJsonNumber(parts.numerator),
          member_variance_sum_scaled: asJsonNumber(parts.denominator),
          candidate_groups_considered: clusters.length,
        };
        groups.push({
          subjects: [...members],
          memberAccountIds: [...members],
          method: 'summed-variance-ratio',
          statistic: bpAsDecimalString(ratio ?? 0),
          threshold: bpAsDecimalString(maxRatioBp),
          evidence,
        });
        for (const identityId of identityIds) {
          findings.push({
            subjects: [...members],
            identityId,
            flagType: GRAPH_FLAG_TYPE,
            severity,
            evidence,
          });
        }
      }
      return { findings, groups };
    },
  };
}

// -----------------------------------------------------------------------------
// `D-13`: the young-account fast path. THREE CONDITIONS, AND THEY ARE ANDED
// -----------------------------------------------------------------------------

/**
 * The trading days `D-13`'s canary pair runs for.
 *
 * **IT IS COUPLED TO `window_trading_days` IN BOTH DIRECTIONS AT ONCE, WHICH IS
 * THE SHARPEST FORM OF THE PORT FINDING IN THIS FILE.** A `D-13` canary must
 * carry EXACTLY the window: fewer marks and the window is unfilled, more marks
 * and the account is not young. `Detector.canaries(mint)` cannot read the
 * registry, so this is the seeded 5 (`M07:123`), and a run under any other
 * window would report `degraded` on a detector that is working perfectly. **No
 * such page happens today because `D-13` declines**, and the day its tolerances
 * are stated this constant has to move with the window or the battery lies.
 */
export const D13_CANARY_TRADING_DAYS = 5;

/** Contracts traded per account per trading day, over the merged fills. */
function contractsByAccountDay(
  rows: readonly DetectorRow[],
): ReadonlyMap<string, ReadonlyMap<string, number>> {
  const byAccount = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const accountId = textOf(row, 'accountId');
    const day = textOf(row, 'tradingDay');
    const quantity = countOf(row, 'quantity');
    if (accountId === undefined || day === undefined || quantity === undefined) {
      continue;
    }
    const days = byAccount.get(accountId) ?? new Map<string, number>();
    days.set(day, (days.get(day) ?? 0) + Math.abs(quantity));
    byAccount.set(accountId, days);
  }
  return byAccount;
}

/**
 * Execution instants per account per trading day, over the merged fills.
 *
 * INDEXED ONCE PER RUN RATHER THAN ONCE PER PAIR. A pair's window is a handful
 * of days out of the read, and re-walking every fill inside the pair loop would
 * make a detector that is already quadratic in accounts quadratic in fills too.
 */
function instantsByAccountDay(
  rows: readonly DetectorRow[],
): ReadonlyMap<string, ReadonlyMap<string, number[]>> {
  const byAccount = new Map<string, Map<string, number[]>>();
  for (const row of rows) {
    const accountId = textOf(row, 'accountId');
    const day = textOf(row, 'tradingDay');
    const at = instantOf(row, 'executedAt');
    if (accountId === undefined || day === undefined || at === undefined) {
      continue;
    }
    const days = byAccount.get(accountId) ?? new Map<string, number[]>();
    const instants = days.get(day) ?? [];
    instants.push(at.getTime());
    days.set(day, instants);
    byAccount.set(accountId, days);
  }
  return byAccount;
}

/** One account's execution instants over `days`, sorted. */
function instantsOver(
  index: ReadonlyMap<string, ReadonlyMap<string, number[]>>,
  accountId: string,
  days: readonly string[],
): readonly number[] {
  const found: number[] = [];
  const byDay = index.get(accountId);
  for (const day of days) {
    found.push(...(byDay?.get(day) ?? []));
  }
  found.sort((left, right) => left - right);
  return found;
}

/**
 * `10000 * SUM(|qa - qb|) / SUM(max(qa, qb))` over the window's days.
 *
 * Zero when the two accounts trade identical size every day. `undefined` when
 * neither traded at all, which is not mirroring.
 */
function sizeDeviationBp(
  a: ReadonlyMap<string, number> | undefined,
  b: ReadonlyMap<string, number> | undefined,
  days: readonly string[],
): number | undefined {
  let difference = 0;
  let scale = 0;
  for (const day of days) {
    const left = a?.get(day) ?? 0;
    const right = b?.get(day) ?? 0;
    difference += Math.abs(left - right);
    scale += Math.max(left, right);
  }
  return scale === 0 ? undefined : Math.trunc((10000 * difference) / scale);
}

/**
 * The WORST nearest-counterparty gap, in whole seconds, in both directions.
 *
 * **EVERY fill needs a counterpart, not just some of them**, which is what
 * *"timing mirroring"* has to mean if it is to be a condition rather than a
 * coincidence: a maximum answers "no fill on either side is unaccompanied" and
 * an average would let one mirrored burst carry a day of unrelated trading.
 * `undefined` when either side has no fills in the window.
 */
function timingDeviationSeconds(
  a: readonly number[] | undefined,
  b: readonly number[] | undefined,
): number | undefined {
  if (a === undefined || b === undefined || a.length === 0 || b.length === 0) {
    return undefined;
  }
  let worst = 0;
  for (const [from, to] of [
    [a, b],
    [b, a],
  ] as const) {
    for (const at of from) {
      let nearest = Number.POSITIVE_INFINITY;
      for (const other of to) {
        nearest = Math.min(nearest, Math.abs(at - other));
      }
      worst = Math.max(worst, nearest);
    }
  }
  return Math.ceil(worst / 1000);
}

/**
 * `D-13`, the young-account fast path (`M07:123`).
 *
 * **ITS THREE CONDITIONS ARE A CONJUNCTION AND NOT A DISJUNCTION**, and `M07`
 * says so in the row itself: *"Correlation below -0.95, AND size mirroring, AND
 * timing mirroring. All three, not any of three."* Its registry row carries
 * `conditions_combined: "conjunction"` and this detector READS that value rather
 * than asserting it, so a registry that said otherwise would not be silently
 * overruled by the code.
 *
 * **THE ROW'S OWN CELL EXPLAINS WHY THE CONJUNCTION IS LOAD BEARING**: it is
 * *"deliberately PRECISE rather than SENSITIVE ... on five days of data a -0.8
 * threshold is noise, and requiring near-perfect inverse correlation together
 * with mirrored size and timing is what makes a short window usable at all."*
 * A disjunction here would fire on any five-day pair that happened to move
 * opposite ways, which on a five-day sample is most of them.
 *
 * **IT DECLINES.** `size_mirroring_tolerance_bp` and
 * `timing_mirroring_tolerance_seconds` are both `unstated`, and `severity` is
 * `unstated` too -- three numbers, one founder answer.
 *
 * **"YOUNG" IS DERIVED FROM THE WINDOW RATHER THAN FROM A FOURTH THRESHOLD.**
 * `M07` names no account age. An account is young here when its whole observed
 * life fits the window, which needs no number that is not already stated, and
 * `M07:300` is why the two are the same length: *"D-13's 5 day window is now the
 * same length as Core EOD's ENTIRE CYCLE."*
 */
export function youngAccountFastPathDetector(): Detector {
  return {
    id: D13,
    streams: (request: DetectorScanRequest): readonly DetectorStream[] => {
      const values = requiredIntegers(D13, request.definition, [
        'window_trading_days',
        'correlation_floor_bp',
        'size_mirroring_tolerance_bp',
        'timing_mirroring_tolerance_seconds',
      ]);
      requireStatedText(D13, request.definition, 'conditions_combined', 'conjunction');
      refuseUnclockedSeverity(D13, severityFrom(D13, request.definition));
      const window = integerAt(values, 'window_trading_days');
      const from = readFrom(request.tradingDay, window);
      return [
        {
          name: MARKS,
          table: 'dailyMarks',
          where: {
            tradingDay: request.terms.atLeast(from),
            supersededBy: request.terms.isNull(),
          },
        },
        {
          name: FILLS,
          table: 'fills',
          // A CORRECTED FILL WAS SUPERSEDED BY ANOTHER ROW. Counting both would
          // double the size on one side of a pair and break the mirroring test
          // in the direction that MISSES a ring.
          where: { tradingDay: request.terms.atLeast(from), isCorrected: false },
        },
        {
          name: ACCOUNTS,
          table: 'accounts',
          where: { openedOn: request.terms.atMost(request.tradingDay) },
        },
        {
          name: LINKS,
          table: 'identityLinks',
          where: { suppressed: false, createdAt: request.terms.atMost(request.now) },
        },
        {
          name: SIGNALS,
          table: 'identitySignals',
          where: { firstSeenAt: request.terms.atMost(request.now) },
        },
      ];
    },
    canaries: (mint: CanaryMint): readonly CanarySubject[] => {
      const id = mint.subject(D13, 0);
      const identities = [id.actor('i-long'), id.actor('i-short')];
      const accounts = [id.actor('a-long'), id.actor('a-short')];
      const hash = id.actor('h-device');
      const marks: CanaryRow[] = [];
      const fills: CanaryRow[] = [];
      let row = 0;
      for (let day = 0; day < D13_CANARY_TRADING_DAYS; day += 1) {
        const magnitude = BigInt(250000 * (day + 1));
        const tradingDay = addCalendarDays(CANARY_EPOCH, day);
        marks.push(canaryMark(id.row(row), accounts[0] ?? '', tradingDay, magnitude));
        row += 1;
        marks.push(canaryMark(id.row(row), accounts[1] ?? '', tradingDay, -magnitude));
        row += 1;
        // MIRRORED SIZE AND MIRRORED TIMING: the same contract count, one second
        // apart, on the opposite side.
        fills.push(
          canaryFill(id.row(row), accounts[0] ?? '', tradingDay, canaryInstant(day, 0), 'buy', 2),
        );
        row += 1;
        fills.push(
          canaryFill(id.row(row), accounts[1] ?? '', tradingDay, canaryInstant(day, 1), 'sell', 2),
        );
        row += 1;
      }
      return [
        {
          id: id.id,
          detector: D13,
          nonce: mint.nonce,
          shape: 'hedged-pair',
          actors: [...accounts, ...identities],
          rows: {
            [MARKS]: marks,
            [FILLS]: fills,
            [ACCOUNTS]: accounts.map((accountId, at) =>
              canaryAccount(accountId, identities[at] ?? '', CANARY_ACCOUNT_SIZE_CENTS),
            ),
            [SIGNALS]: identities.map((identityId, at) =>
              canarySignal(id.row(1000 + at), identityId, hash),
            ),
            [LINKS]: [],
          },
        },
      ];
    },
    scan: ({ request, rows }: DetectorScanInput): DetectorOutcome => {
      const values = requiredIntegers(D13, request.definition, [
        'window_trading_days',
        'correlation_floor_bp',
        'size_mirroring_tolerance_bp',
        'timing_mirroring_tolerance_seconds',
      ]);
      requireStatedText(D13, request.definition, 'conditions_combined', 'conjunction');
      const severity = severityFrom(D13, request.definition);
      refuseUnclockedSeverity(D13, severity);
      const window = integerAt(values, 'window_trading_days');
      const floorBp = integerAt(values, 'correlation_floor_bp');
      const sizeToleranceBp = integerAt(values, 'size_mirroring_tolerance_bp');
      const timingToleranceSeconds = integerAt(values, 'timing_mirroring_tolerance_seconds');
      const book = accountBook(rows[ACCOUNTS] ?? []);
      const marks = marksByAccount(rows[MARKS] ?? [], request.tradingDay);
      const contracts = contractsByAccountDay(rows[FILLS] ?? []);
      const instants = instantsByAccountDay(rows[FILLS] ?? []);
      const clusters = discoverClusters({
        links: rows[LINKS] ?? [],
        signals: rows[SIGNALS] ?? [],
        accounts: rows[ACCOUNTS] ?? [],
      });

      const findings: DetectorFinding[] = [];
      for (const cluster of clusters) {
        // M07:298: "D-13 and D-14 both operate on D-12's clusters." A pair
        // outside every cluster is D-02's, on a twenty day window.
        const members = cluster.accountIds
          .filter((accountId) => (marks.get(accountId)?.size ?? 0) >= window)
          // YOUNG: the whole observed life fits the window.
          .filter((accountId) => (marks.get(accountId)?.size ?? 0) <= window)
          .sort();
        for (let left = 0; left < members.length; left += 1) {
          for (let right = left + 1; right < members.length; right += 1) {
            const aId = members[left] ?? '';
            const bId = members[right] ?? '';
            const aMarks = marks.get(aId);
            const bMarks = marks.get(bId);
            if (aMarks === undefined || bMarks === undefined) {
              continue;
            }
            const days = commonDays(aMarks, bMarks, window);
            if (days === undefined) {
              continue;
            }
            const parts = pearsonParts(seriesOver(days, aMarks), seriesOver(days, bMarks));
            // THE CONJUNCTION. Each condition is computed before any of them is
            // tested, so the evidence names all three whichever one failed, and
            // so that a reader cannot mistake a short circuit for a disjunction.
            const inverse = correlationAtOrBelow(parts, floorBp);
            const sizeBp = sizeDeviationBp(contracts.get(aId), contracts.get(bId), days);
            const timingSeconds = timingDeviationSeconds(
              instantsOver(instants, aId, days),
              instantsOver(instants, bId, days),
            );
            const mirroredSize = sizeBp !== undefined && sizeBp <= sizeToleranceBp;
            const mirroredTiming =
              timingSeconds !== undefined && timingSeconds <= timingToleranceSeconds;
            if (!inverse || !mirroredSize || !mirroredTiming) {
              continue;
            }
            const scored = new Set<string>();
            for (const self of [aId, bId]) {
              const facts = book.get(self);
              if (facts === undefined || scored.has(facts.identityId)) {
                continue;
              }
              scored.add(facts.identityId);
              findings.push({
                subjects: [aId, bId],
                identityId: facts.identityId,
                accountId: self,
                flagType: GRAPH_FLAG_TYPE,
                severity,
                evidence: {
                  detector: D13,
                  conditions_combined: 'conjunction',
                  window_trading_days: window,
                  trading_days_compared: days.length,
                  correlation_bp: correlationBp(parts) ?? null,
                  correlation_floor_bp: floorBp,
                  size_deviation_bp: sizeBp ?? null,
                  size_mirroring_tolerance_bp: sizeToleranceBp,
                  timing_deviation_seconds: timingSeconds ?? null,
                  timing_mirroring_tolerance_seconds: timingToleranceSeconds,
                  counterparty_account_id: self === aId ? bId : aId,
                  discovered_via: [...cluster.via],
                },
              });
            }
          }
        }
      }
      return { findings };
    },
  };
}

// -----------------------------------------------------------------------------
// `D-14`: clique position-sum. POSITIONS, NOT REALIZED P&L, AND THE TABLE FOR
// THEM DOES NOT EXIST
// -----------------------------------------------------------------------------

/**
 * A net position per account per symbol, DERIVED from fills.
 *
 * **THIS IS A DERIVATION AND `D-14`'s DECLARED INPUT IS A TABLE.** `M07:124`
 * gives the input as *"live and END-OF-DAY POSITIONS across a `D-12` clique"*,
 * and `ports.ts` already found what this session confirms: there is no
 * `positions` key in `packages/db/src/scope.ts` and no `CREATE TABLE` in
 * `packages/db/migrations` whose name contains `position`. `DETECTOR_READ_TABLES`
 * deliberately holds no speculative member for it, and adding one would settle
 * by being written the question of whether a position is a stored row or a
 * derived one.
 *
 * Net position is `SUM(+quantity for a buy, -quantity for a sell)` per symbol,
 * which is the arithmetic anyone would write and is exactly why it is NOT a
 * substitute: a fills-derived figure is end-of-day only, cannot see a position
 * carried in from a previous session, and can never be the *"live"* half of the
 * input `M07` names. **`D-14` declines on its threshold in any case**, so this
 * function has no production caller today and is here so that the shape of the
 * finding is legible rather than described.
 */
export function netPositionsBySymbol(
  rows: readonly DetectorRow[],
): ReadonlyMap<string, ReadonlyMap<string, number>> {
  const byAccount = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const accountId = textOf(row, 'accountId');
    const symbol = textOf(row, 'symbol');
    const side = textOf(row, 'side');
    const quantity = countOf(row, 'quantity');
    if (accountId === undefined || symbol === undefined || side === undefined) {
      continue;
    }
    if (quantity === undefined || (side !== 'buy' && side !== 'sell')) {
      continue;
    }
    const symbols = byAccount.get(accountId) ?? new Map<string, number>();
    symbols.set(symbol, (symbols.get(symbol) ?? 0) + (side === 'buy' ? quantity : -quantity));
    byAccount.set(accountId, symbols);
  }
  return byAccount;
}

/**
 * `D-14`, clique position-sum (`M07:124`).
 *
 * **IT WORKS ON POSITIONS RATHER THAN ON REALIZED P&L, AND THAT IS THE WHOLE
 * POINT OF IT.** `M07:124`: it *"complements `D-03` by working on POSITIONS
 * rather than realized P&L, and is invariant to which pair carries the hedge,
 * which is exactly what `AS-M7-02` defeats in a pairwise detector"*, and it
 * detects *"inside the day rather than after it closes"*, so it needs no history
 * at all. Its registry row carries `basis: "positions"` and this detector reads
 * that value rather than asserting it.
 *
 * **AN IDLE CLIQUE SUMS TO ZERO AND MUST NOT FIRE**, which is the near-miss a
 * reader would omit and the one that decides whether this detector is usable.
 * Three accounts that traded nothing all day have a summed position of exactly
 * zero, which is *"at or near zero"* by any threshold, and flagging them would
 * fire on every dormant cluster in the estate every single night. So a clique
 * must carry a non-zero GROSS position before its NET one means anything.
 *
 * **IT DECLINES, ON TWO THINGS AND NOT ONE.** `max_abs_summed_position` is
 * `unstated` -- `M07` writes *"at or near zero"* and never says how near -- and
 * `severity` is `unstated`. Its input table not existing is a third and is
 * reported in {@link netPositionsBySymbol} rather than papered over with a
 * derivation nobody ruled on.
 */
export function cliquePositionSumDetector(): Detector {
  return {
    id: D14,
    streams: (request: DetectorScanRequest): readonly DetectorStream[] => {
      requiredIntegers(D14, request.definition, ['max_abs_summed_position']);
      requireStatedText(D14, request.definition, 'basis', 'positions');
      refuseUnclockedSeverity(D14, severityFrom(D14, request.definition));
      return [
        {
          name: FILLS,
          table: 'fills',
          // AN EQUALITY AND NOT A TERM. D-14 is an intraday detector over one
          // trading day, so the whole narrowing fits in the shape ADR-112
          // always had, and no in-memory bound is needed on top of it.
          where: { tradingDay: request.tradingDay, isCorrected: false },
        },
        {
          name: ACCOUNTS,
          table: 'accounts',
          where: { openedOn: request.terms.atMost(request.tradingDay) },
        },
        {
          name: LINKS,
          table: 'identityLinks',
          where: { suppressed: false, createdAt: request.terms.atMost(request.now) },
        },
        {
          name: SIGNALS,
          table: 'identitySignals',
          where: { firstSeenAt: request.terms.atMost(request.now) },
        },
      ];
    },
    canaries: (mint: CanaryMint): readonly CanarySubject[] => {
      const id = mint.subject(D14, 0);
      const identities = [id.actor('i-0'), id.actor('i-1'), id.actor('i-2')];
      const accounts = [id.actor('a-0'), id.actor('a-1'), id.actor('a-2')];
      const hash = id.actor('h-device');
      // +4, -3, -1. A NON-ZERO GROSS POSITION SUMMING TO EXACTLY ZERO, which is
      // the third-leg rotation with the leg carried by nobody in particular.
      const legs: readonly (readonly [string, number])[] = [
        ['buy', 4],
        ['sell', 3],
        ['sell', 1],
      ];
      const fills: CanaryRow[] = legs.map(([side, quantity], at) =>
        canaryFill(
          id.row(at),
          accounts[at] ?? '',
          CANARY_EPOCH,
          canaryInstant(0, at),
          side,
          quantity,
        ),
      );
      return [
        {
          id: id.id,
          detector: D14,
          nonce: mint.nonce,
          shape: 'same-second-fill-cluster',
          actors: [...accounts, ...identities],
          rows: {
            [FILLS]: fills,
            [ACCOUNTS]: accounts.map((accountId, at) =>
              canaryAccount(accountId, identities[at] ?? '', CANARY_ACCOUNT_SIZE_CENTS),
            ),
            [SIGNALS]: identities.map((identityId, at) =>
              canarySignal(id.row(1000 + at), identityId, hash),
            ),
            [LINKS]: [],
          },
        },
      ];
    },
    scan: ({ request, rows }: DetectorScanInput): DetectorOutcome => {
      const values = requiredIntegers(D14, request.definition, ['max_abs_summed_position']);
      requireStatedText(D14, request.definition, 'basis', 'positions');
      const severity = severityFrom(D14, request.definition);
      refuseUnclockedSeverity(D14, severity);
      const maxAbsolute = integerAt(values, 'max_abs_summed_position');

      const book = accountBook(rows[ACCOUNTS] ?? []);
      const positions = netPositionsBySymbol(rows[FILLS] ?? []);
      const clusters = discoverClusters({
        links: rows[LINKS] ?? [],
        signals: rows[SIGNALS] ?? [],
        accounts: rows[ACCOUNTS] ?? [],
      });

      const findings: DetectorFinding[] = [];
      for (const cluster of clusters) {
        const members = cluster.accountIds.filter((accountId) => positions.has(accountId));
        if (members.length < 3) {
          continue;
        }
        const summed = new Map<string, number>();
        const gross = new Map<string, number>();
        for (const accountId of members) {
          for (const [symbol, quantity] of positions.get(accountId) ?? []) {
            summed.set(symbol, (summed.get(symbol) ?? 0) + quantity);
            gross.set(symbol, (gross.get(symbol) ?? 0) + Math.abs(quantity));
          }
        }
        const hedged = [...summed.entries()].filter(
          ([symbol, net]) => Math.abs(net) <= maxAbsolute && (gross.get(symbol) ?? 0) > 0,
        );
        if (hedged.length === 0) {
          continue;
        }
        const identityIds = [
          ...new Set(members.map((accountId) => book.get(accountId)?.identityId ?? '')),
        ]
          .filter((identityId) => identityId.length > 0)
          .sort();
        for (const identityId of identityIds) {
          findings.push({
            subjects: [...members],
            identityId,
            flagType: GRAPH_FLAG_TYPE,
            severity,
            evidence: {
              detector: D14,
              basis: 'positions',
              positions_derived_from: 'fills',
              trading_day: request.tradingDay,
              member_account_ids: [...members],
              member_identity_ids: identityIds,
              discovered_via: [...cluster.via],
              max_abs_summed_position: maxAbsolute,
              hedged_symbols: hedged.map(([symbol, net]) => ({
                symbol,
                net_position: net,
                gross_position: gross.get(symbol) ?? 0,
              })),
            },
          });
        }
      }
      return { findings };
    },
  };
}

// -----------------------------------------------------------------------------
// The registration
// -----------------------------------------------------------------------------

/**
 * The graph detectors, in the order a run should execute them.
 *
 * **`D-12` IS NOT HERE.** Header section 2: its output is neither a
 * `DetectorFinding` nor a `DetectorGroup`, and `runner.ts` marks a detector that
 * returns neither `degraded` on every run. It ships as {@link discoverClusters}
 * and the three detectors below call it.
 *
 * `D-02` FIRST because it is the only one that produces an answer today, and the
 * other three because a `failed` run every night is the honest statement that
 * Merit is not detecting these things, visible to the morning read through
 * `detector_runs_unhealthy_idx`. **Leaving them unregistered would make the same
 * absence invisible**, which is `FM-M7-01` reached by omission instead of by a
 * bug.
 */
export function graphDetectors(): readonly Detector[] {
  return [
    inversePairDetector(),
    groupInverseExposureDetector(),
    youngAccountFastPathDetector(),
    cliquePositionSumDetector(),
  ];
}
