// =============================================================================
// packages/harness/src/assertions.ts
// =============================================================================
// THE ONLY FILE IN THIS PACKAGE THAT READS A PLAN PARAMETER, AND THE BOUNDARY IS
// THE POINT.
//
// `INV-M21-09` forbids the harness a line that DECIDES a gate, a breach, an
// eligibility or a payout amount. It does not forbid it a line that CHECKS one,
// and `RE-S-06` is exactly such a line: "lifetime extraction per account never
// exceeds `max_payouts * cap`. HARD ASSERTION, NOT A BAND." An assertion that
// could not read the bound would be an assertion of nothing.
//
// The two are told apart by what happens to the answer. A decision changes what
// the run does next; a check changes only what the run reports. Nothing in this
// file feeds back into `trial.ts`, and `no-second-rulebook.test.ts` is what keeps
// the plan-parameter reads confined here, so the boundary is enforced rather
// than described.
//
// -----------------------------------------------------------------------------
// AND A BAND THAT CANNOT BE EVALUATED IS NOT A BAND THAT PASSED
// -----------------------------------------------------------------------------
// `checkBands` reports `not_measured` as a THIRD VERDICT rather than folding it
// into either of the other two. The calibration source of record carries eleven
// bands and this package computes five of them, so six come back unevaluated on
// every run, and a green report over five of eleven that said "pass" would be
// the most expensive kind of wrong. `repo-invariants.mjs` states the same rule
// for its own checks: a check that cannot run is not a check that passed.
// =============================================================================

import type { Cents, ResolvedPlan } from '@merit/rules-engine';
import { floorDiv } from './ratio.js';
import type { CalibrationBand, CalibrationSource } from './provenance.js';
import type { BandResult, LifetimeBoundResult, OutputRecord, Trial } from './types.js';

/** Thrown when a check cannot be evaluated as stated. It never guesses a verdict. */
export class AssertionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionInputError';
  }
}

/**
 * `INV-17`, TRANSCRIBED RATHER THAN IMPROVED: `ladder_count * max cap in the
 * schedule`.
 *
 * M01's invariant table states it in exactly those words and `RE-P-17` is the
 * property that asserts it inside the engine, so this is one statement of one
 * bound rather than a second one. At 50K on Core EOD it is `5 * 150,000c =
 * 750,000c` gross, which is SIMULATION_HARNESS section 5's own figure.
 *
 * A TIGHTER BOUND EXISTS AND IS DELIBERATELY NOT USED. On a stepped cap
 * schedule, the sum of the caps for ordinals 1 to `max_payouts` is smaller than
 * `max_payouts` times the largest of them, and it is the exact bound. `INV-17`
 * states the looser one, every v1 plan has a single-rung schedule where the two
 * coincide, and a harness that asserted a bound the corpus does not state would
 * fail a run for violating an invariant nobody wrote down. Reported here,
 * changed nowhere: tightening `INV-17` is an ADR against a frozen document.
 */
export function lifetimeBoundCents(plan: ResolvedPlan): Cents {
  let maxCapCents: Cents | null = null;
  for (const step of plan.funded.payoutCapSchedule) {
    if (maxCapCents === null || step.capCents > maxCapCents) maxCapCents = step.capCents;
  }
  if (maxCapCents === null) {
    throw new AssertionInputError(
      'the plan carries no payout cap schedule, so INV-17 has no bound to state. CV-09 requires ' +
        'a non-empty schedule starting at ordinal 1, so a plan without one never passed publish',
    );
  }
  return BigInt(plan.funded.maxPayouts) * maxCapCents;
}

/**
 * `RE-S-06`. The hard assertion, over the whole population.
 *
 * THE OBSERVED MAXIMUM AND THE BOUND ARE BOTH REPORTED, because "the maximum
 * happened to sit under the bound" and "the bound holds" are different claims
 * and only the second one is an assertion. A run whose maximum sits at exactly
 * the bound is the interesting case and `GS-055` is the path that reaches it:
 * the minimum-variance route to a full cap extraction.
 */
export function checkLifetimeBound(
  plan: ResolvedPlan,
  trials: readonly Trial[],
): LifetimeBoundResult {
  const boundCents = lifetimeBoundCents(plan);
  let observedMaximumCents = 0n;
  let observedMaximumTraderCents = 0n;
  let sampleSize = 0;
  for (const trial of trials) {
    if (!trial.reachedFunded) continue;
    sampleSize += 1;
    if (trial.lifetimeSettledCents > observedMaximumCents) {
      observedMaximumCents = trial.lifetimeSettledCents;
    }
    if (trial.lifetimeTraderCents > observedMaximumTraderCents) {
      observedMaximumTraderCents = trial.lifetimeTraderCents;
    }
  }
  const holds = observedMaximumCents <= boundCents;
  return {
    boundCents,
    observedMaximumCents,
    observedMaximumTraderCents,
    holds,
    sampleSize,
    detail: holds
      ? `the largest lifetime extraction over ${String(sampleSize)} funded account(s) is ` +
        `${observedMaximumCents.toString()}c gross against INV-17's bound of ` +
        `${boundCents.toString()}c`
      : `INV-17 IS VIOLATED: an account extracted ${observedMaximumCents.toString()}c against a ` +
        `bound of ${boundCents.toString()}c. The ladder is what turns a per-day extraction rate ` +
        'into a bounded one, and this is the assertion that keeps it',
  };
}

/**
 * The realized figure in the band's own unit, as an integer.
 *
 * A UNIT MISMATCH REFUSES RATHER THAN CONVERTING. A band stated in cents
 * compared against a rate is a comparison whose result means nothing, and
 * silently coercing one into the other is how a green report gets produced from
 * two unrelated numbers.
 */
function realizedInBandUnit(band: CalibrationBand, output: OutputRecord): bigint | null {
  if (output.value === null) return null;
  if (band.unit !== output.unit) {
    throw new AssertionInputError(
      `band ${band.id} is stated in ${band.unit} and output ${output.key} is in ${output.unit}. ` +
        'A comparison across units is not a verdict',
    );
  }
  const scale = band.unit === 'basis_points' || band.unit === 'count_per_10000' ? 10_000n : 1n;
  return floorDiv(output.value.numerator * scale, output.value.denominator);
}

/**
 * `HO-01`. Every band with its realized value, its sample size, and a verdict.
 *
 * SIMULATION_HARNESS section 7.1 names the funnel report as the nightly build's
 * consumer and section 5 states what a failure means: "the two available
 * responses are 'the engine regressed' and 'the founder moved a plan parameter
 * and the band moves with it, recorded in DECISIONS'. WIDENING A BAND TO MAKE A
 * NIGHTLY BUILD GREEN is TR-03". Nothing in this package can widen one: the
 * bands arrive as caller data and this function only reads them.
 */
export function checkBands(
  calibration: CalibrationSource,
  outputs: readonly OutputRecord[],
): readonly BandResult[] {
  return calibration.bands.map((band): BandResult => {
    const output = outputs.find((candidate) => candidate.registryId === band.id);
    if (output === undefined) {
      return {
        bandId: band.id,
        label: band.label,
        outputKey: null,
        realized: null,
        minimum: band.minimum,
        maximum: band.maximum,
        central: band.central,
        sampleSize: 0,
        verdict: 'not_measured',
        detail:
          `no output in this run carries ${band.id}. The band is UNEVALUATED, which is not a ` +
          "pass: this package computes M21 requirement (b)'s outputs and leaves the portfolio " +
          'risk engine (RE-S-07 to RE-S-09), the detector band and the cycle-profile band to ' +
          'the work that owns them',
      };
    }
    const realized = realizedInBandUnit(band, output);
    if (realized === null) {
      return {
        bandId: band.id,
        label: band.label,
        outputKey: output.key,
        realized: null,
        minimum: band.minimum,
        maximum: band.maximum,
        central: band.central,
        sampleSize: output.sampleSize,
        verdict: 'not_measured',
        detail:
          `${output.key} had no sample in this run, so there is nothing to compare. An absent ` +
          'value is not a zero (HO-07) and an unevaluated band is not a pass',
      };
    }
    const belowMinimum = band.minimum !== null && realized < band.minimum;
    const aboveMaximum = band.maximum !== null && realized > band.maximum;
    const pass = !belowMinimum && !aboveMaximum;
    return {
      bandId: band.id,
      label: band.label,
      outputKey: output.key,
      realized,
      minimum: band.minimum,
      maximum: band.maximum,
      central: band.central,
      sampleSize: output.sampleSize,
      verdict: pass ? 'pass' : 'fail',
      detail:
        `${output.key} realized ${realized.toString()} ${band.unit} over ` +
        `${String(output.sampleSize)} sample(s) against ` +
        `[${band.minimum === null ? 'unbounded' : band.minimum.toString()}, ` +
        `${band.maximum === null ? 'unbounded' : band.maximum.toString()}]`,
    };
  });
}
