// =============================================================================
// apps/worker/src/batch/statistics.ts
// =============================================================================
// M12'S MACHINE: the nightly statistics run. It reads authoritative
// closed-session facts, computes each registered definition, and writes ONE
// IMMUTABLE `published_statistics` ROW PER WINDOW PER MEASURE PER GRAIN CELL.
//
// M12 section 1.1: "three surfaces and one machine ... a nightly statistics run
// that reads the same authoritative tables the engine reads, computes each
// registered definition, writes an immutable `published_statistics` row, AND
// NEVER OVERWRITES ONE."
//
// -----------------------------------------------------------------------------
// `input_digest`, WHICH IS THE HARD PART AND IS ADR-122
// -----------------------------------------------------------------------------
// THE DIGEST IS TAKEN OVER THE COMPUTATION'S OWN ARGUMENT, NOT OVER A
// DESCRIPTION OF THE QUERY. That is the whole ruling and everything else here
// follows from it.
//
// A digest built from a hand-written list of "what we read" can omit a field
// the arithmetic uses, and then two genuinely different computations carry one
// digest and the reproduction claim is false in the direction nobody checks.
// `inputDigest` below walks the FACT OBJECTS THEMSELVES with `Object.keys`, in
// sorted order, and THROWS on a value it cannot frame. So a field the adapter
// sets is in the digest whether or not anybody remembered it, and a field of a
// type this framing does not cover is a loud error rather than a silently
// unhashed input.
//
// WHAT IT COVERS: a domain-separated header carrying a FORMAT VERSION; the
// statistic and its definition version; the definition row's own content,
// INCLUDING BOTH PROSE SPECS AND THE EXCLUSIONS, so a definition edited in
// place at an unchanged version changes every digest it produces (INV-M12-07);
// the window's three days; the grain key; and every input fact for that cell,
// sorted by its own serialization so the port's read order cannot move it.
//
// WHAT IT DELIBERATELY EXCLUDES, and each exclusion is a decision:
//
//   THE VALUE, THE NUMERATOR, THE DENOMINATOR AND THE SAMPLE SIZE. They are the
//   OUTPUT. A digest that covered its own answer could not distinguish
//   "different inputs" from "different arithmetic", and the second is the
//   failure worth catching. TWO RUNS WHOSE DIGESTS MATCH AND WHOSE VALUES
//   DIFFER IS AN ENGINE REGRESSION, and it is loud only because the value is
//   outside.
//
//   `measure`. ST-04's mean and median are computed from ONE input set. Two
//   rows carrying one digest is the pair's reproducibility stated, not a
//   collision.
//
//   `computed_at`, `id` and `created_at`, which are the clock and the
//   identities the database assigns. A digest that moved every night would
//   claim every window was a different window.
//
//   THE PORT'S READ ORDER, defeated by the sort. A reproduction claim that
//   depends on which rows Postgres returned first is not a reproduction claim.
//
// WHAT IT CANNOT COVER, NAMED RATHER THAN WIDENED: THE BUILD THAT COMPUTED IT.
// `published_statistics` has no `engine_version` column and no run column
// (`0021`), and no migration is in this session's fence, so the digest cannot
// carry the code's identity into the row. Folding a worker version into the
// digest BYTES was considered and refused: it would make the digest change on
// every deploy, conflating a code change with an input change and destroying
// the one property the exclusion of the value buys.
//
// SO WHAT A READER MAY CONCLUDE FROM TWO MATCHING DIGESTS is that both runs
// read the SAME DEFINITION OVER THE SAME WINDOW AND THE SAME INPUT FACTS. Not
// that they produced the same number. Not that they ran the same code. Both
// limits belong on the method page rather than in a reader's assumption.
//
// -----------------------------------------------------------------------------
// IMMUTABILITY IS THE DATABASE'S AND THIS FILE DOES NOT RESTATE IT
// -----------------------------------------------------------------------------
// `INV-M12-03` is enforced in three places and none of them is here:
//
//   `0026` REVOKES `UPDATE, DELETE` ON `published_statistics` FROM `merit_app`
//   AND FROM `PUBLIC`, so a second connection string does not route around it.
//
//   `published_statistics_window_uq` (`0021`) refuses the SECOND row for one
//   `(stat_code, definition_version, window, grain_key, measure)` where
//   `restatement_of IS NULL`.
//
//   ADR-112 clause 5 removed `update` and `delete` from every transaction
//   handle in this workspace, so the accessor has no verb for the act.
//
// THEREFORE THIS MACHINE DOES NOT READ THE PUBLISHED SERIES TO SEE WHETHER A
// WINDOW WAS ALREADY PUBLISHED, AND DOES NOT SKIP IT. It computes and it
// writes; the unique index decides. An application pre-check would be a second
// control that can drift from the first, and ADR-042's finding that a comment
// is not a control applies exactly as well to a check that duplicates one.
//
// -----------------------------------------------------------------------------
// NO FLOATS, AND THE ROUNDING IS THE PUBLISHER'S
// -----------------------------------------------------------------------------
// ADR-031 retired this surface's no-floats exemption because for `ST-03` and
// `ST-04` the published column holds MONEY ON A PUBLIC SURFACE, and it made
// the consequence explicit: "THE PUBLISHER MUST NOW ROUND TO THE UNIT AT
// COMPUTATION TIME, which is where the choice belongs: a rounding decision made
// by a column type is a decision nobody made." `roundedQuotient`,
// `basisPoints`, `orderedMiddle` and `nearestRank` below are those decisions,
// each stated where it is taken. Every one is integer arithmetic on `bigint`.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE IS NOT, STATED SO A GREEN SUITE DOES NOT IMPLY IT
// -----------------------------------------------------------------------------
//   THE ADAPTER IS NOT WRITTEN. `StatisticsPorts` has no implementation over
//   `systemDb('nightly-batch')`, exactly as `BatchPorts` has none, and this
//   file opens no connection.
//
//   THE EVENTS ARE NOT EMITTED. `stats.published`, `stats.run_halted` and
//   `stats.suppressed` (M12 section 5) are the adapter's, and the halt reaches
//   it through `raiseStatisticsHalt` rather than through a throw.
//
//   THE RESTATEMENT MACHINE IS NOT HERE. M12 section 3.3 is triggered by
//   `ingest.correction_received` rather than by the schedule. Every row this
//   file writes has `restatement_of IS NULL`, which is also the scope of
//   `published_statistics_window_uq` and of `STAT-C1`.
//
//   THE LIFETIME FORM IS REFUSED RATHER THAN GUESSED. See `WINDOW_SPECS`.

import { createHash } from 'node:crypto';

import type { CalendarSlice, TradingDay } from '@merit/rules-engine';

import type {
  EligibleRequestFact,
  EvaluationOutcomeFact,
  FundedLifeFact,
  PublishedStatisticRow,
  SettledPayoutFact,
  StatCode,
  StatisticDefinitionRow,
  StatisticGrain,
  StatisticMeasure,
  StatisticUnit,
  StatisticWindow,
  StatisticsHalt,
  StatisticsHaltReason,
  StatisticsPorts,
  WithdrawalSettlementFact,
} from './ports.ts';

// -----------------------------------------------------------------------------
// The vocabulary, at run time
// -----------------------------------------------------------------------------

/** `statistic_measure` (`0001:145`), in the enum's own declaration order. */
export const STATISTIC_MEASURES = [
  'rate',
  'total',
  'mean',
  'median',
  'p50',
  'p95',
  'count',
] as const satisfies readonly StatisticMeasure[];

/** The seven ruled statistics. */
export const STAT_CODES = [
  'ST-01',
  'ST-02',
  'ST-03',
  'ST-04',
  'ST-05',
  'ST-06',
  'ST-07',
] as const satisfies readonly StatCode[];

/**
 * The window forms this machine can READ, which is not the same as the forms
 * `statistic_definitions.window_spec` can HOLD: that column is `text` with no
 * `CHECK` (`0021`), so the closed set lives here and an unreadable value halts.
 *
 * THE LIFETIME FORM IS ABSENT AND ITS ABSENCE IS A FINDING RATHER THAN A GAP IN
 * THE WORK. M12-statistic-definitions' three binding requirements open with
 * "each statistic carries BOTH a trailing-window and a lifetime form", and that
 * commitment has no shape in the table as landed:
 * `statistic_definitions_live_uq` is `UNIQUE (stat_code) WHERE superseded_by IS
 * NULL`, so a statistic has exactly ONE live definition row carrying exactly
 * ONE `window_spec`, and it cannot carry a trailing form and a lifetime form at
 * the same time. Separately, a lifetime window's START is an anchor in the DATA
 * -- "since first settled payout", "since the wallet shipped" -- that no column
 * carries and no port returns, so a machine that resolved it would be choosing
 * where Merit's published history begins.
 *
 * Reported rather than invented. A definition declaring a lifetime form halts
 * the run with `window_spec_not_ruled`, which is loud, and the row's own words
 * are in the halt detail.
 */
export const WINDOW_SPECS = ['trailing_30_trading_days', 'trailing_90_trading_days'] as const;

export type StatisticWindowSpec = (typeof WINDOW_SPECS)[number];

/** How many trading days each readable spec trails, inclusive of the as-of day. */
const WINDOW_LENGTHS: Readonly<Record<StatisticWindowSpec, number>> = {
  trailing_30_trading_days: 30,
  trailing_90_trading_days: 90,
};

const GRAINS = ['lineup', 'plan'] as const satisfies readonly StatisticGrain[];

function isStatCode(value: string): value is StatCode {
  return (STAT_CODES as readonly string[]).includes(value);
}

function isWindowSpec(value: string): value is StatisticWindowSpec {
  return (WINDOW_SPECS as readonly string[]).includes(value);
}

function isGrain(value: string): value is StatisticGrain {
  return (GRAINS as readonly string[]).includes(value);
}

// -----------------------------------------------------------------------------
// The canonical serialization
// -----------------------------------------------------------------------------
// `hash.ts`'s FRAMING, and `payload.ts`'s PRECEDENT FOR NOT IMPORTING IT.
//
// `<utf8 byte length>:<utf8 bytes>` is the corpus's framing convention and this
// is its third instance. It is re-stated here rather than shared, which is the
// choice `provisioning/payload.ts` made against the same alternative and for
// the same reason: EACH DIGEST FIXES ITS OWN STORED COLUMN FOREVER. Sharing one
// serializer across `rule_states.state_hash`, `provisioning_queue.payload_hash`
// and `published_statistics.input_digest` would mean a change made for any one
// of them silently invalidates the other two, and there is no migration that
// repairs a `bytea` whose meaning moved.
//
// M01 section 3.7's "there is no second code path" is about THE FOLD and does
// not reach here: nothing below computes a statistic, and a serializer for one
// column is not a second expression of a serializer for another.

/** A value this framing can carry. `number` is excluded for ADR-031's reason. */
type DigestValue = string | bigint | boolean | null;

/** Thrown when a value cannot be framed. An unframeable input is loud, never hashed. */
export class InputDigestError extends Error {
  override readonly name = 'InputDigestError';
}

/** `<utf8 byte length>:<utf8 bytes>`. `hash.ts`'s framing, unchanged. */
function frame(value: string): string {
  return `${String(Buffer.byteLength(value, 'utf8'))}:${value}`;
}

/**
 * The type tag, one character, from a closed set.
 *
 * THE TAG IS WHAT KEEPS `'100'` AND `100n` DIFFERENT INPUTS. Without it a
 * `planCode` of `'100'` and a `traderCents` of `100n` frame identically, and
 * two different windows could carry one digest.
 */
function tagged(value: unknown, where: string): string {
  switch (typeof value) {
    case 'string':
      return `s${value}`;
    case 'bigint':
      return `i${value.toString(10)}`;
    case 'boolean':
      return `b${value ? '1' : '0'}`;
    default:
      if (value === null) return 'n';
      throw new InputDigestError(
        `${where} is ${value === undefined ? 'undefined' : typeof value}, which this digest ` +
          'cannot frame. A field the digest cannot frame is an INPUT THE REPRODUCTION CLAIM ' +
          'DOES NOT COVER, so it is a throw rather than a skip: money is bigint integer cents ' +
          'on this surface (ADR-031) and a number would admit a value that had already lost ' +
          'digits by the time this file saw it.',
      );
  }
}

/**
 * One fact, framed field by field, TOTAL OVER THE OBJECT'S OWN KEYS.
 *
 * THIS IS THE RULING EXECUTED. It walks `Object.keys` rather than a
 * hand-written field list, so a field the adapter sets is in the digest whether
 * or not anybody remembered to add it here, and the omission that would make
 * the reproduction claim false is UNEXPRESSIBLE rather than test-caught.
 *
 * KEYS ARE SORTED BY UTF-16 CODE UNIT, which is what `Array.prototype.sort`
 * does with no comparator and is stable across engines because the ordering is
 * defined on the string values rather than on a locale. An object's own
 * enumeration order is insertion order, and two adapters building one fact in
 * different field orders must not produce two digests.
 *
 * THE KEY IS FRAMED AS WELL AS THE VALUE, because a map whose key set is not
 * fixed would otherwise let `{ab: 'c'}` and `{a: 'bc'}` collide.
 */
export function canonicalFact(fact: object): string {
  const record = fact as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  let out = '';
  for (const key of keys) {
    out += frame(key) + frame(tagged(record[key], `fact field ${JSON.stringify(key)}`));
  }
  return out;
}

// -----------------------------------------------------------------------------
// The digest
// -----------------------------------------------------------------------------

/** The domain separator, carrying the format version. */
export const INPUT_DIGEST_HEADER = 'merit.published_statistics.input_digest.v1';

/** Everything one cell's figures are computed from. */
export interface DigestSubject {
  readonly definition: StatisticDefinitionRow;
  readonly window: StatisticWindow;
  readonly grainKey: string | null;
  /** The exact objects the arithmetic reads. */
  readonly facts: readonly object[];
}

/**
 * `SD-M12-02`. Thirty-two bytes, over the canonical serialization of the cell's
 * inputs.
 *
 * `Buffer` rather than `Uint8Array` because the column is `bytea` and the value
 * goes straight into a bind parameter, which is `state-hash.ts:60`'s reasoning
 * for the same decision one file over.
 */
export function inputDigest(subject: DigestSubject): Buffer {
  const { definition: d, window: w } = subject;

  const field = (key: string, value: DigestValue): string =>
    frame(key) + frame(tagged(value, `digest field ${JSON.stringify(key)}`));

  let out = frame(INPUT_DIGEST_HEADER);

  // The statistic and the version it was published under.
  out += field('stat_code', d.statCode);
  out += field('definition_version', BigInt(d.version));

  // THE DEFINITION'S OWN CONTENT. The prose specs are in the digest even though
  // nothing executes them, because they are what the method page publishes and
  // what a reader checks the number against. INV-M12-07: a definition edited in
  // place at an unchanged version moves every digest it produces.
  out += field('min_sample', BigInt(d.minSample));
  out += field('grain', d.grain);
  out += field('window_spec', d.windowSpec);
  out += field('numerator_spec', d.numeratorSpec);
  out += field('denominator_spec', d.denominatorSpec);
  out += field('effective_from', d.effectiveFrom);

  // `measures` IS A SET AND IS SORTED. `0021`'s `measures_are_distinct` makes
  // it one, and `STAT-C1` compares it as one, so a definition that declared the
  // same set in a different order is the same definition.
  const measures = [...d.measures].sort();
  out += field('measures_count', BigInt(measures.length));
  for (const measure of measures) out += frame(measure);

  // `exclusions` IS A LIST AND IS NOT SORTED. It is `text[]` on the row, its
  // order is what the row holds, and the method page renders it in that order.
  out += field('exclusions_count', BigInt(d.exclusions.length));
  for (const exclusion of d.exclusions) out += frame(exclusion);

  // The window and the cell.
  out += field('window_start_day', w.startDay);
  out += field('window_end_day', w.endDay);
  out += field('as_of_trading_day', w.asOfTradingDay);
  out += field('grain_key', subject.grainKey);

  // THE FACTS, SORTED BY THEIR OWN SERIALIZATION. A total order that needs no
  // per-type identity function and is a function of the content alone, which is
  // exactly the property "the read order cannot move the digest" asks for.
  const framed = subject.facts.map(canonicalFact).sort();
  out += field('facts_count', BigInt(framed.length));
  for (const one of framed) out += frame(one);

  return createHash('sha256').update(out, 'utf8').digest();
}

// -----------------------------------------------------------------------------
// The arithmetic, with the rounding decisions ADR-031 leaves to it
// -----------------------------------------------------------------------------

/**
 * ROUND TO NEAREST, TIES UPWARD, over non-negative operands.
 *
 * `(2n * numerator + denominator) / (2n * denominator)` is integer division
 * standing in for `round(numerator / denominator)`, and it never leaves the
 * integers, so there is no float on this path at any point.
 *
 * TRUNCATION WAS REFUSED. It understates every rate and every mean
 * systematically, and an unflattering bias is still a bias: M12's precommitment
 * is about the DEFINITION and it does not license bending the arithmetic in
 * either direction.
 *
 * @throws {InputDigestError} on a non-positive denominator. The caller checks
 *   first; this is the guard that makes the check load-bearing rather than
 *   customary.
 */
export function roundedQuotient(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new InputDigestError(
      `roundedQuotient was called with denominator ${denominator.toString(10)}. A ratio with ` +
        'no denominator is a halt (FM-M12-02), never a zero and never a suppression.',
    );
  }
  if (numerator < 0n) {
    throw new InputDigestError(
      `roundedQuotient was called with numerator ${numerator.toString(10)}. Every figure on ` +
        'this surface is non-negative and the tie direction is stated for that case only.',
    );
  }
  return (2n * numerator + denominator) / (2n * denominator);
}

/**
 * A rate in INTEGER BASIS POINTS, which is the unit the constitution already
 * uses for every ratio and the unit ADR-031 fixed for `ST-01`, `ST-02` and
 * `ST-07`.
 *
 * 1470 is unambiguously 14.70 percent and never $14.70, because `value_unit`
 * travels with it and `published_statistics_value_has_unit` makes it mandatory.
 */
export function basisPoints(numerator: bigint, denominator: bigint): bigint {
  return roundedQuotient(numerator * 10000n, denominator);
}

/**
 * `ST-04`'s "the ORDERED MIDDLE", which is a MEDIAN and is deliberately not a
 * `p50`.
 *
 * The two are DIFFERENT MEMBERS of `statistic_measure` (`0001:145`) and they
 * are computed differently here. On an even count this averages the two middle
 * observations, under the same rounding as every other quotient;
 * `nearestRank` below never averages and never invents a value nobody was paid.
 *
 * `values` MUST BE SORTED ASCENDING by the caller.
 */
export function orderedMiddle(values: readonly bigint[]): bigint {
  const n = values.length;
  if (n === 0) {
    throw new InputDigestError(
      'orderedMiddle over an empty set. A suppressed cell is never computed.',
    );
  }
  if (n % 2 === 1) return at(values, (n - 1) / 2);
  return roundedQuotient(at(values, n / 2 - 1) + at(values, n / 2), 2n);
}

/**
 * The NEAREST-RANK percentile, WITH NO INTERPOLATION. `ST-05` and `ST-06`.
 *
 * The observation at `ceil(percentile * N / 100)`, 1-indexed. Nearest rank is
 * chosen over any interpolating method because an interpolated percentile is a
 * duration NOBODY EVER WAITED, and this surface publishes elapsed times a
 * trader can compare against their own. It also needs no division into a
 * fraction, so the whole computation stays on the integers.
 *
 * `values` MUST BE SORTED ASCENDING by the caller.
 */
export function nearestRank(values: readonly bigint[], percentile: number): bigint {
  const n = values.length;
  if (n === 0) {
    throw new InputDigestError(
      'nearestRank over an empty set. A suppressed cell is never computed.',
    );
  }
  const rank = Number((BigInt(percentile) * BigInt(n) + 99n) / 100n);
  const clamped = Math.min(Math.max(rank, 1), n);
  return at(values, clamped - 1);
}

/** Indexed read that cannot return `undefined`, so `noUncheckedIndexedAccess` holds. */
function at(values: readonly bigint[], index: number): bigint {
  const value = values[index];
  if (value === undefined) {
    throw new InputDigestError(
      `index ${String(index)} is outside a set of ${String(values.length)}.`,
    );
  }
  return value;
}

function sum(values: readonly bigint[]): bigint {
  let total = 0n;
  for (const value of values) total += value;
  return total;
}

function ascending(values: readonly bigint[]): readonly bigint[] {
  return [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * An elapsed duration in WHOLE SECONDS, which is ADR-031's unit for `ST-05` and
 * `ST-06`.
 *
 * A NEGATIVE ELAPSED IS REFUSED RATHER THAN CLAMPED, which is what the `null`
 * carries. A credit stamped before its own request is a wrong number, and
 * clamping it to zero would publish "instant" from data saying something
 * impossible happened.
 */
function elapsedSeconds(from: bigint, to: bigint): bigint | null {
  const elapsed = to - from;
  return elapsed < 0n ? null : elapsed;
}

// -----------------------------------------------------------------------------
// What a computation produces
// -----------------------------------------------------------------------------

export interface StatisticFigure {
  readonly measure: StatisticMeasure;
  readonly value: bigint;
  readonly valueUnit: StatisticUnit;
  /** `published_statistics_value_or_suppression` requires it on every published row. */
  readonly numerator: bigint;
  readonly numeratorUnit: StatisticUnit;
  /**
   * PRESENT EXACTLY WHEN THE MEASURE IS A RATIO.
   *
   * `0021`'s own rule and not a relaxation of it: "the denominator is NOT
   * required ... ST-03 has NO DENOMINATOR by ruling, because it is a total and
   * the surface says so RATHER THAN IMPLYING A RATE." An order statistic
   * implies a rate exactly as hard as a total does -- a reader who divides a
   * median by a count gets a number that means nothing -- so `median`, `p50`
   * and `p95` carry none either, and `sample_size` carries the count they were
   * selected from.
   */
  readonly denominator: bigint | null;
}

export type FigureResult =
  | { readonly kind: 'figures'; readonly figures: readonly StatisticFigure[] }
  | { readonly kind: 'refused'; readonly reason: StatisticsHaltReason; readonly detail: string };

/** One published cell: one grain key, its facts, and its arithmetic. */
export interface StatisticCell {
  readonly grainKey: string | null;
  /** THE EXACT VALUES THE ARITHMETIC READS. The digest is taken over these. */
  readonly facts: readonly object[];
  /** The observation count behind the cell. `sample_size`, and the suppression test. */
  readonly sampleSize: number;
  /**
   * DEFERRED, AND THE DEFERRAL IS LOAD BEARING.
   *
   * A suppressed cell is NEVER computed, so a mean over zero payouts is
   * unreachable rather than guarded. `INV-M12-05` suppresses below `min_sample`
   * and every ratio statistic carries a floor of at least 50 by ruling, so the
   * only way to reach a zero denominator is a definition row declaring a floor
   * that permits an undefined figure -- which is a definition error and halts.
   */
  readonly compute: () => FigureResult;
}

/** Everything read for one window, before it is partitioned into cells. */
export interface StatisticInputs {
  readonly evaluationOutcomes: readonly EvaluationOutcomeFact[];
  readonly fundedLives: readonly FundedLifeFact[];
  readonly settledPayouts: readonly SettledPayoutFact[];
  readonly withdrawalSettlements: readonly WithdrawalSettlementFact[];
  readonly eligibleRequests: readonly EligibleRequestFact[];
}

export interface StatisticComputation {
  readonly statCode: StatCode;
  /** ADR-032. Checked against the definition row's declared set; a disagreement halts. */
  readonly measures: readonly StatisticMeasure[];
  readonly valueUnit: StatisticUnit;
  /**
   * The cells this statistic publishes over the window, or `null` when the
   * grain cannot be computed from this statistic's facts.
   */
  readonly cells: (
    inputs: StatisticInputs,
    grain: StatisticGrain,
  ) => readonly StatisticCell[] | null;
}

// -----------------------------------------------------------------------------
// Partitioning
// -----------------------------------------------------------------------------

/**
 * The `plan` grain's cells, keyed by `plans.code`.
 *
 * THE PLAN UNIVERSE COMES FROM THE FACTS AND NOT FROM THE CATALOGUE, which is a
 * stated limit rather than a preference: a plan with no activity in the window
 * produces NO CELL, where a suppressed cell carrying `sample_size: 0` would
 * have been strictly more informative to a reader. Reading the catalogue would
 * need a port this session's fence does not hold, and inventing one would put a
 * plan list in the statistics machine.
 *
 * The keys are SORTED, so the row order a run produces is a function of the
 * data rather than of the read.
 */
function planCells<F>(
  facts: readonly F[],
  planCodeOf: (fact: F) => string,
  build: (grainKey: string | null, facts: readonly F[]) => StatisticCell,
): readonly StatisticCell[] {
  const byPlan = new Map<string, F[]>();
  for (const fact of facts) {
    const code = planCodeOf(fact);
    const bucket = byPlan.get(code);
    if (bucket === undefined) byPlan.set(code, [fact]);
    else bucket.push(fact);
  }
  return [...byPlan.keys()].sort().map((code) => build(code, byPlan.get(code) ?? []));
}

function partition<F>(
  facts: readonly F[],
  grain: StatisticGrain,
  planCodeOf: ((fact: F) => string) | null,
  build: (grainKey: string | null, facts: readonly F[]) => StatisticCell,
): readonly StatisticCell[] | null {
  if (grain === 'lineup') return [build(null, facts)];
  if (planCodeOf === null) return null;
  return planCells(facts, planCodeOf, build);
}

/** A rate cell: the numerator is a COUNT and the denominator is the cohort. */
function rateCell<F extends object>(
  grainKey: string | null,
  facts: readonly F[],
  passes: (fact: F) => boolean,
): StatisticCell {
  return {
    grainKey,
    facts,
    sampleSize: facts.length,
    compute: (): FigureResult => {
      const denominator = BigInt(facts.length);
      if (denominator === 0n) {
        return {
          kind: 'refused',
          reason: 'undefined_ratio',
          detail:
            'a rate over an empty cohort. The cell was not suppressed, so its definition ' +
            'declares a min_sample that permits an undefined figure.',
        };
      }
      const numerator = BigInt(facts.filter(passes).length);
      return {
        kind: 'figures',
        figures: [
          {
            measure: 'rate',
            value: basisPoints(numerator, denominator),
            valueUnit: 'bp',
            numerator,
            numeratorUnit: 'count',
            denominator,
          },
        ],
      };
    },
  };
}

/** A duration cell: `p50` and `p95` by nearest rank, in whole seconds. */
function durationCell<F extends object>(
  grainKey: string | null,
  facts: readonly F[],
  elapsedOf: (fact: F) => bigint | null,
): StatisticCell {
  return {
    grainKey,
    facts,
    sampleSize: facts.length,
    compute: (): FigureResult => {
      const elapsed: bigint[] = [];
      for (const fact of facts) {
        const one = elapsedOf(fact);
        if (one === null) {
          return {
            kind: 'refused',
            reason: 'impossible_duration',
            detail:
              'an elapsed time is negative: a settlement is stamped before its own request. ' +
              'A duration published on a public surface is refused rather than clamped.',
          };
        }
        elapsed.push(one);
      }
      if (elapsed.length === 0) {
        return {
          kind: 'refused',
          reason: 'undefined_ratio',
          detail:
            'a percentile over an empty set. The cell was not suppressed, so its definition ' +
            'declares a min_sample that permits an undefined figure.',
        };
      }
      const sorted = ascending(elapsed);
      const figure = (measure: 'p50' | 'p95', percentile: number): StatisticFigure => {
        const value = nearestRank(sorted, percentile);
        return {
          measure,
          value,
          valueUnit: 'duration_seconds',
          // The SELECTED OBSERVATION is the numerator, and there is no
          // denominator: see `StatisticFigure.denominator`.
          numerator: value,
          numeratorUnit: 'duration_seconds',
          denominator: null,
        };
      };
      return { kind: 'figures', figures: [figure('p50', 50), figure('p95', 95)] };
    },
  };
}

// -----------------------------------------------------------------------------
// The seven computations
// -----------------------------------------------------------------------------
// EACH ONE TRANSCRIBES A SIGNED DEFINITION AND INVENTS NOTHING.
// M12-statistic-definitions' FREEZE gate ruling is "the table is approved in
// full, including S-16", so the arithmetic below is settled and the work here
// is faithfulness rather than choice.

const ST_01: StatisticComputation = {
  statCode: 'ST-01',
  measures: ['rate'],
  valueUnit: 'bp',
  // Numerator: evaluation accounts that reached `passed` in the window.
  // Denominator: evaluation accounts whose outcome OCCURRED in the window.
  //
  // `G-1` NEEDS NO CODE: never-traded accounts have outcomes like any other and
  // are in the denominator because nothing removes them. `G-2` NEEDS NO CODE:
  // an account still in evaluation has no outcome and so produces no fact.
  // `G-3` NEEDS NO CODE: `accounts.purchase_id` is `NOT NULL UNIQUE`, so a
  // reset is a second row and counting accounts is counting attempts.
  //
  // Three of the six global choices are properties of the schema rather than
  // branches in this function, which is why they cannot drift.
  cells: (inputs, grain) =>
    partition(
      inputs.evaluationOutcomes,
      grain,
      (fact) => fact.planCode,
      (key, facts) => rateCell(key, facts, (fact) => fact.outcome === 'passed'),
    ),
};

const ST_02: StatisticComputation = {
  statCode: 'ST-02',
  measures: ['rate'],
  valueUnit: 'bp',
  // Numerator: funded accounts that reached a FIRST SETTLED PAYOUT in the
  // window. Denominator: every fact, which is both parts of the ruled
  // denominator -- the ended lives and the still-funded-past-first-cycle set
  // the adapter supplies (see `FundedLifeFact`).
  cells: (inputs, grain) =>
    partition(
      inputs.fundedLives,
      grain,
      (fact) => fact.planCode,
      (key, facts) => rateCell(key, facts, (fact) => fact.ending === 'first_payout'),
    ),
};

const ST_03: StatisticComputation = {
  statCode: 'ST-03',
  measures: ['total'],
  valueUnit: 'cents',
  // Numerator: the sum of `trader_cents` across settled payouts. NO
  // DENOMINATOR, by ruling, "because it is a total and the surface says so
  // rather than implying a rate"; the count behind it is `sample_size`.
  //
  // TERMINAL SETTLEMENTS ARE INCLUDED AND `ST-04` EXCLUDES THEM. That is
  // deliberate rather than inconsistent: a total should include every dollar
  // paid, and an average of payouts should average payouts. Both surfaces state
  // which treatment they use, which is why the difference is visible rather
  // than confusing.
  cells: (inputs, grain) =>
    partition(
      inputs.settledPayouts,
      grain,
      (fact) => fact.planCode,
      (key, facts) => ({
        grainKey: key,
        facts,
        sampleSize: facts.length,
        compute: (): FigureResult => {
          const total = sum(facts.map((fact) => fact.traderCents));
          return {
            kind: 'figures',
            figures: [
              {
                measure: 'total',
                value: total,
                valueUnit: 'cents',
                numerator: total,
                numeratorUnit: 'cents',
                denominator: null,
              },
            ],
          };
        },
      }),
    ),
};

const ST_04: StatisticComputation = {
  statCode: 'ST-04',
  measures: ['mean', 'median'],
  valueUnit: 'cents',
  // "BOTH FIGURES TOGETHER", and neither is published alone. `STAT-C1` enforces
  // that at commit; this function is why there is something for it to enforce.
  //
  // Terminal settlements are EXCLUDED, per the definition: they are close-outs
  // of a remaining balance rather than payouts under the cap, and blending them
  // distorts both figures.
  cells: (inputs, grain) => {
    const payouts = inputs.settledPayouts.filter((fact) => !fact.terminalSettlement);
    return partition(
      payouts,
      grain,
      (fact) => fact.planCode,
      (key, facts) => ({
        grainKey: key,
        facts,
        sampleSize: facts.length,
        compute: (): FigureResult => {
          const count = BigInt(facts.length);
          if (count === 0n) {
            return {
              kind: 'refused',
              reason: 'undefined_ratio',
              detail:
                'a mean over zero payouts. The cell was not suppressed, so its definition ' +
                'declares a min_sample that permits an undefined figure.',
            };
          }
          const cents = facts.map((fact) => fact.traderCents);
          const total = sum(cents);
          const middle = orderedMiddle(ascending(cents));
          return {
            kind: 'figures',
            figures: [
              {
                measure: 'mean',
                value: roundedQuotient(total, count),
                valueUnit: 'cents',
                numerator: total,
                numeratorUnit: 'cents',
                denominator: count,
              },
              {
                measure: 'median',
                value: middle,
                valueUnit: 'cents',
                numerator: middle,
                numeratorUnit: 'cents',
                denominator: null,
              },
            ],
          };
        },
      }),
    );
  },
};

const ST_05: StatisticComputation = {
  statCode: 'ST-05',
  measures: ['p50', 'p95'],
  valueUnit: 'duration_seconds',
  // Elapsed from `payout_requests.created_at` to the wallet-credit posting.
  //
  // FROZEN REQUESTS ARE EXCLUDED, and the definition says they are "published
  // separately with count and median duration RATHER THAN DROPPED". THE
  // SEPARATE PUBLICATION IS NOT BUILT: it needs its own `stat_code` and its own
  // `statistic_definitions` row, and neither exists. So this machine excludes
  // them and publishes no freeze decomposition, which is a stated gap rather
  // than a silent drop.
  //
  // Under ADR-019 approval, the ledger posting and the wallet credit commit in
  // ONE transaction, so this figure is structurally near zero. `AS-M12-05`'s
  // warning applies to it as much as to `ST-07`: a number that is structurally
  // near zero is exactly the kind of claim a reader disbelieves, and the
  // believable version of "instant" is the one published beside `ST-06`.
  cells: (inputs, grain) => {
    const payouts = inputs.settledPayouts.filter((fact) => !fact.frozen);
    return partition(
      payouts,
      grain,
      (fact) => fact.planCode,
      (key, facts) =>
        durationCell(key, facts, (fact) =>
          elapsedSeconds(fact.requestedAtEpochSeconds, fact.creditedAtEpochSeconds),
        ),
    );
  },
};

const ST_06: StatisticComputation = {
  statCode: 'ST-06',
  measures: ['p50', 'p95'],
  valueUnit: 'duration_seconds',
  // Elapsed from a wallet-to-rail withdrawal request to the settlement
  // confirmation. Held withdrawals are excluded, with the same stated gap as
  // `ST-05`'s frozen set.
  //
  // THE `plan` GRAIN IS UNAVAILABLE AND THAT IS A PROPERTY OF THE SUBJECT. A
  // withdrawal belongs to an IDENTITY and not to an account, so it carries no
  // plan, and `ST-06`'s ruled grain is "lineup" for exactly that reason. A
  // definition declaring `plan` here halts with `grain_not_ruled` rather than
  // being served a partition invented from somewhere else.
  cells: (inputs, grain) => {
    const withdrawals = inputs.withdrawalSettlements.filter((fact) => !fact.held);
    return partition(withdrawals, grain, null, (key, facts) =>
      durationCell(key, facts, (fact) =>
        elapsedSeconds(fact.requestedAtEpochSeconds, fact.settledAtEpochSeconds),
      ),
    );
  },
};

const ST_07: StatisticComputation = {
  statCode: 'ST-07',
  measures: ['rate'],
  valueUnit: 'bp',
  // Numerator: payout requests meeting the published gates that were approved.
  // Denominator: payout requests meeting the published gates.
  //
  // THIS PUBLISHES 100 PERCENT STRUCTURALLY AND THE ARITHMETIC DOES NOT KNOW
  // THAT. `payout_status` has no `denied` member (`0001:91`) because `M05`'s
  // `INV-M5-01` has no denial path. The constant is NOT hard-coded here, and
  // the reason is `AS-M12-05`: a machine that published the constant directly
  // would stop being able to report the day the constant stopped holding, which
  // is the one day the figure would matter.
  cells: (inputs, grain) =>
    partition(
      inputs.eligibleRequests,
      grain,
      (fact) => fact.planCode,
      (key, facts) => rateCell(key, facts, (fact) => fact.approved),
    ),
};

/** The registry. One computation per ruled statistic, and no others. */
export const COMPUTATIONS: Readonly<Record<StatCode, StatisticComputation>> = {
  'ST-01': ST_01,
  'ST-02': ST_02,
  'ST-03': ST_03,
  'ST-04': ST_04,
  'ST-05': ST_05,
  'ST-06': ST_06,
  'ST-07': ST_07,
};

// -----------------------------------------------------------------------------
// The window
// -----------------------------------------------------------------------------

/**
 * The trailing window, resolved AGAINST THE TRADING CALENDAR and never against
 * dates.
 *
 * "Trailing 90 trading days" is 90 entries of the exchange session calendar
 * ending on the as-of day INCLUSIVE, which is why this walks
 * `CalendarSlice.days` by index rather than subtracting 90 from a date.
 * Subtracting dates would put a holiday-heavy window and a holiday-free one on
 * two different cohorts while both claimed the same length, and the corpus's
 * own rule is that gap counting is subtraction on `sequence`, never date math.
 *
 * A SLICE THAT DOES NOT REACH BACK FAR ENOUGH REFUSES RATHER THAN SHORTENING.
 * A window silently truncated to the calendar that happened to be loaded is a
 * published figure whose stated window is not the window it describes.
 */
export function resolveWindow(
  spec: StatisticWindowSpec,
  asOfTradingDay: TradingDay,
  calendar: CalendarSlice,
): StatisticWindow | { readonly miss: string } {
  const endIndex = calendar.index[asOfTradingDay];
  if (endIndex === undefined) {
    return {
      miss:
        `the as-of trading day ${asOfTradingDay} is not in the calendar slice, whose coverage ` +
        `is ${calendar.coverage.from} to ${calendar.coverage.to}.`,
    };
  }
  const length = WINDOW_LENGTHS[spec];
  const startIndex = endIndex - (length - 1);
  if (startIndex < 0) {
    return {
      miss:
        `${spec} needs ${String(length)} trading days ending at ${asOfTradingDay} and the ` +
        `slice holds ${String(endIndex + 1)} up to it. A window is never shortened to fit ` +
        'the calendar that happened to be loaded.',
    };
  }
  const startDay = calendar.days[startIndex]?.tradingDay;
  if (startDay === undefined) {
    return { miss: `the calendar slice has no day at index ${String(startIndex)}.` };
  }
  return { startDay, endDay: asOfTradingDay, asOfTradingDay };
}

// -----------------------------------------------------------------------------
// The run
// -----------------------------------------------------------------------------

/**
 * M12 section 3.1's transition out of `waiting`, as a value the caller supplies.
 *
 * "`waiting --> computing`: `day.closed` for every active account, AND THE
 * REPLAY SELF-AUDIT IS GREEN."
 *
 * IT IS A VALUE RATHER THAN A `ReplayAuditReport` DELIBERATELY. This file
 * imports nothing from `replay.ts`: the gate is two facts, the caller is the
 * one holding both reports, and a machine that reached into the audit's own
 * types would couple M12's publication to the shape of M01's audit for no gain.
 *
 * THE DEPENDENCY IS THE STRONGEST QUALITY GATE AVAILABLE and M12 says so:
 * "Merit will not publish a statistic computed over a day whose self-audit
 * diverged, because the statistic would be computed from STATE THE ENGINE
 * ITSELF DOES NOT CURRENTLY VOUCH FOR."
 */
export interface PublicationGate {
  /** Every active account has a closed day for `asOfTradingDay`. */
  readonly dayClosed: boolean;
  /** The replay self-audit ran over this day and found no divergence. */
  readonly selfAuditGreen: boolean;
}

export interface StatisticsRunConfig {
  /** The closed trading day being published as of. */
  readonly asOfTradingDay: TradingDay;
  /** The calendar the windows are measured on. Read once, by the caller. */
  readonly calendar: CalendarSlice;
  readonly gate: PublicationGate;
}

export interface StatisticsRunReport {
  readonly asOfTradingDay: TradingDay;
  /** `halted` means NOTHING was written. There is no partial outcome. */
  readonly status: 'published' | 'halted';
  readonly halt: StatisticsHalt | null;
  /** Every row the run wrote, in the order it wrote them. Empty on a halt. */
  readonly rows: readonly PublishedStatisticRow[];
  /** The statistics that produced at least one row, sorted. */
  readonly statCodes: readonly string[];
  /** Rows carrying a `suppressed_reason`. A suppressed row EXISTS (INV-M12-05). */
  readonly suppressed: number;
}

/**
 * `INV-M12-05`'s reason token.
 *
 * A STABLE TOKEN AND NOT A SENTENCE. The sample size is its own column and the
 * floor is on the definition row, so a reason that restated either would be a
 * second copy of a number the row already carries. The surface renders "not yet
 * meaningful" from this token WITH THE SAMPLE SIZE SHOWN, which is what
 * distinguishes a stated limitation from a concealment.
 */
export const SUPPRESSED_BELOW_MIN_SAMPLE = 'below_min_sample';

/**
 * Publish one trading day.
 *
 * ALL OR NOTHING. `FM-M12-02`: "a halt publishes NOTHING and pages. It never
 * publishes a partial set, BECAUSE A PARTIAL SET IS A SELECTED SET, and
 * selection is the failure this module exists to prevent." Every row is built
 * before any row is written, and the first refusal ends the run with an empty
 * write.
 *
 * There is no approval step between computation and publication, and its
 * absence is the control (`INV-M12-08`). Nothing in this function can withhold
 * a figure for being unflattering: the only path to `suppressedReason` is the
 * sample floor, which is a number fixed on the definition row before the data
 * existed.
 */
export async function runStatisticsRun(
  ports: StatisticsPorts,
  config: StatisticsRunConfig,
): Promise<StatisticsRunReport> {
  const { asOfTradingDay } = config;

  const halted = async (
    reason: StatisticsHaltReason,
    stage: StatisticsHalt['stage'],
    statCode: string | null,
    detail: string,
  ): Promise<StatisticsRunReport> => {
    const halt: StatisticsHalt = { asOfTradingDay, reason, stage, statCode, detail };
    await ports.write.raiseStatisticsHalt(halt);
    return { asOfTradingDay, status: 'halted', halt, rows: [], statCodes: [], suppressed: 0 };
  };

  // ---------------------------------------------------------------------------
  // `waiting`
  // ---------------------------------------------------------------------------
  if (!config.gate.dayClosed || !config.gate.selfAuditGreen) {
    return halted(
      'inputs_not_vouched',
      'waiting',
      null,
      `dayClosed=${String(config.gate.dayClosed)}, selfAuditGreen=${String(
        config.gate.selfAuditGreen,
      )}. INV-M12-01 binds publication to closed-session authoritative data, and M12 section ` +
        '3.1 adds the self-audit: a statistic computed over a day the engine does not vouch ' +
        'for is a public number derived from state Merit will not use for money.',
    );
  }

  // ---------------------------------------------------------------------------
  // `computing`
  // ---------------------------------------------------------------------------
  const definitions = [...(await ports.read.effectiveDefinitions(asOfTradingDay))].sort((a, b) =>
    a.statCode < b.statCode ? -1 : a.statCode > b.statCode ? 1 : 0,
  );

  if (definitions.length === 0) {
    return halted(
      'no_effective_definitions',
      'computing',
      null,
      'effectiveDefinitions returned no rows. A run that publishes nothing over nothing is ' +
        'indistinguishable from a run whose read is broken, and only one of the two is a ' +
        'reason to sleep (ADR-119 measured the same failure on the replay audit).',
    );
  }

  // The window depends on the definition's own `window_spec`, so the reads are
  // memoized per window rather than per definition: two statistics on one
  // trailing window read the facts once.
  const inputsByWindow = new Map<string, StatisticInputs>();
  const readInputs = async (window: StatisticWindow): Promise<StatisticInputs> => {
    const key = `${window.startDay} ${window.endDay} ${window.asOfTradingDay}`;
    const cached = inputsByWindow.get(key);
    if (cached !== undefined) return cached;
    const inputs: StatisticInputs = {
      evaluationOutcomes: await ports.read.evaluationOutcomes(window),
      fundedLives: await ports.read.fundedLives(window),
      settledPayouts: await ports.read.settledPayouts(window),
      withdrawalSettlements: await ports.read.withdrawalSettlements(window),
      eligibleRequests: await ports.read.eligibleRequests(window),
    };
    inputsByWindow.set(key, inputs);
    return inputs;
  };

  const rows: PublishedStatisticRow[] = [];
  const statCodes: string[] = [];
  let suppressed = 0;

  for (const definition of definitions) {
    const { statCode } = definition;

    if (!isStatCode(statCode)) {
      return halted(
        'unknown_stat_code',
        'computing',
        statCode,
        `no computation is registered for ${statCode}. A published figure whose arithmetic ` +
          'nobody wrote is unverifiable by the reader, which is the condition M12 exists to ' +
          'remove.',
      );
    }
    const computation = COMPUTATIONS[statCode];

    // ADR-032 IN TYPESCRIPT, AND `STAT-C1` IS THE SAME RULE IN DDL. The
    // declared set and the computed set must be the same set, or a run would
    // emit a subset and be refused at commit by a trigger whose message names
    // the database rather than the disagreement.
    const declared = [...definition.measures].sort();
    const computed = [...computation.measures].sort();
    if (declared.length !== computed.length || declared.some((m, i) => m !== computed[i])) {
      return halted(
        'measures_disagree',
        'computing',
        statCode,
        `the definition declares measures [${declared.join(', ')}] and this build computes ` +
          `[${computed.join(', ')}]. STAT-C1 would refuse the run at commit; it is refused ` +
          'here so the message names the disagreement.',
      );
    }

    if (!isGrain(definition.grain)) {
      return halted(
        'grain_not_ruled',
        'computing',
        statCode,
        `statistic_definitions.grain is ${JSON.stringify(definition.grain)} and this machine ` +
          `reads ${GRAINS.join(' and ')}. G-4's per-identity figure is the one this session ` +
          'does not rule: publishing it alongside a per-account figure needs either a second ' +
          'stat_code or a grain_key convention, and neither is ruled.',
      );
    }

    if (!isWindowSpec(definition.windowSpec)) {
      return halted(
        'window_spec_not_ruled',
        'computing',
        statCode,
        `statistic_definitions.window_spec is ${JSON.stringify(definition.windowSpec)} and ` +
          `this machine reads ${WINDOW_SPECS.join(' and ')}. A lifetime window's start is an ` +
          'anchor in the data that no column carries, and statistic_definitions_live_uq gives ' +
          'a statistic one live row carrying one window_spec, so a trailing form and a ' +
          'lifetime form cannot both be live. See WINDOW_SPECS.',
      );
    }

    const window = resolveWindow(definition.windowSpec, asOfTradingDay, config.calendar);
    if ('miss' in window) {
      return halted('calendar_coverage_miss', 'computing', statCode, window.miss);
    }

    const inputs = await readInputs(window);
    const cells = computation.cells(inputs, definition.grain);
    if (cells === null) {
      return halted(
        'grain_not_ruled',
        'computing',
        statCode,
        `the definition declares the ${definition.grain} grain and ${statCode}'s facts cannot ` +
          'be partitioned by it. A withdrawal belongs to an identity and carries no plan.',
      );
    }

    let produced = false;

    for (const cell of cells) {
      const digest = inputDigest({
        definition,
        window,
        grainKey: cell.grainKey,
        facts: cell.facts,
      });

      const common = {
        statCode: definition.statCode,
        definitionVersion: definition.version,
        windowStartDay: window.startDay,
        windowEndDay: window.endDay,
        asOfTradingDay: window.asOfTradingDay,
        sampleSize: cell.sampleSize,
        grainKey: cell.grainKey,
        inputDigest: digest,
      };

      // -----------------------------------------------------------------------
      // `validating`
      // -----------------------------------------------------------------------
      // A SUPPRESSED CELL STILL EMITS EVERY DECLARED MEASURE. `STAT-C1` reads
      // `measure` on every inserted row regardless of suppression, so a run
      // that emitted one suppressed row for a pair would be refused at commit
      // exactly as a published half-pair would. It is also the right surface:
      // a suppression that hid one figure of a pair would be a selection.
      if (cell.sampleSize < definition.minSample) {
        for (const measure of computation.measures) {
          rows.push({
            ...common,
            measure,
            value: null,
            valueUnit: null,
            numerator: null,
            numeratorUnit: null,
            denominator: null,
            suppressedReason: SUPPRESSED_BELOW_MIN_SAMPLE,
          });
          suppressed += 1;
        }
        produced = true;
        continue;
      }

      const result = cell.compute();
      if (result.kind === 'refused') {
        return halted(result.reason, 'validating', statCode, result.detail);
      }

      // The computation is total over its own declared measures, and this is
      // where that is checked rather than assumed.
      const emitted = [...result.figures.map((f) => f.measure)].sort();
      if (emitted.length !== computed.length || emitted.some((m, i) => m !== computed[i])) {
        return halted(
          'measures_disagree',
          'validating',
          statCode,
          `the computation emitted [${emitted.join(', ')}] and declares ` +
            `[${computed.join(', ')}].`,
        );
      }

      for (const figure of result.figures) {
        rows.push({
          ...common,
          measure: figure.measure,
          value: figure.value,
          valueUnit: figure.valueUnit,
          numerator: figure.numerator,
          numeratorUnit: figure.numeratorUnit,
          denominator: figure.denominator,
          suppressedReason: null,
        });
      }
      produced = true;
    }

    if (produced) statCodes.push(statCode);
  }

  // ---------------------------------------------------------------------------
  // `publishing`
  // ---------------------------------------------------------------------------
  // ONE CALL, ONE TRANSACTION, EVERY ROW. `STAT-C1` is deferred and only
  // decidable once the run's transaction has written all of them.
  //
  // A SECOND RUN OVER A PUBLISHED WINDOW REACHES THIS LINE AND IS REFUSED BY
  // `published_statistics_window_uq`. Nothing above it looked, and that is the
  // design: the database is the control and a check in front of it would be a
  // second one that can drift.
  await ports.write.publishRun(rows);

  return {
    asOfTradingDay,
    status: 'published',
    halt: null,
    rows,
    statCodes: [...statCodes].sort(),
    suppressed,
  };
}
