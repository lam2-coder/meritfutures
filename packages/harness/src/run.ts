// =============================================================================
// packages/harness/src/run.ts
// =============================================================================
// A RUN, AND A SWEEP OF RUNS. The whole of what a caller invokes.
//
// -----------------------------------------------------------------------------
// A SWEEP IS N RUNS AND ITS ARMS ARE INDIVIDUALLY TRACEABLE
// -----------------------------------------------------------------------------
// M21 section 3.4: "each swept value is a `simulation_runs` row sharing a
// `sweep_id`, carrying `swept_parameter` and `swept_value`. ONE PROVENANCE
// MECHANISM, NOT TWO." So `runSweep` is a loop over `runHarness` and adds
// nothing to what an arm records; what it adds is the two cross-arm facts no
// single arm can see.
//
//   the smallest sample any output reached, across every arm
//                       `AS-M21-02`: "a sensitivity sweep run at a sample size
//                       too small to separate the arms, read as a signal".
//                       Reported so the reader is looking at it rather than
//                       reconstructing it
//   the outputs that came back IDENTICAL in every arm
//                       SIMULATION_HARNESS section 9.3, and it is the warning
//                       most likely to be dropped for looking like a null result
//
// -----------------------------------------------------------------------------
// THE FLAT LINE, WHICH IS THE ONE THE CORPUS ASKS TO BE SAID OUT LOUD
// -----------------------------------------------------------------------------
// Section 9.3 found that THE LADDER DOES NOT BIND THE AVERAGE ACCOUNT: mean
// payouts per payer are 1.54, 2.13 and 1.30, so "ladder 8 and 6 against ladder 5
// and 4 return identical figures to every decimal place on Core EOD and Direct".
// M21 section 3.4 carries the consequence forward as a surface obligation: "a
// sweep over `max_payouts` will therefore show a flat line, and A FLAT LINE HERE
// MEANS 'NO EFFECT ON THE MEAN', NOT 'NO EFFECT'. The ladder's entire value is
// tail protection. The surface must say so at the point where a reader would
// otherwise conclude the ladder is free in both directions."
//
// A surface cannot say it if the run does not tell it, so the run tells it: when
// an output is identical across every arm, the sweep result carries the sentence
// with the finding rather than leaving a reader to supply it.
//
// -----------------------------------------------------------------------------
// WHAT A SWEEP DOES NOT DO HERE, DELIBERATELY
// -----------------------------------------------------------------------------
// IT DOES NOT BUILD THE ARMS. Each arm arrives as a complete `HarnessRunInput`
// the caller assembled, because building one would mean this package holding a
// plan parameter and varying it, and `INV-M21-10` puts every plan parameter in
// `plan_version_sizes` rather than in code. The console varies the parameter
// because the console is where the draft lives; the harness runs what it is
// handed and records what was varied.
// =============================================================================

import { buildPopulation } from '@merit/rithmic';
import { toCalendarSlice } from './bridge.ts';
import { checkCalibrationSource, provenanceFor } from './provenance.ts';
import { aggregate, checkCommercial } from './aggregate.ts';
import { checkBands } from './assertions.ts';
import { checkBehaviour, runTrial } from './trial.ts';
import { equals } from './ratio.ts';
import type { HarnessRun, HarnessRunInput, OutputKey, Trial } from './types.ts';

/** Thrown when a run cannot be assembled as specified. */
export class RunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunError';
  }
}

/**
 * One run: build the population, fold every account, aggregate, check the bands.
 *
 * EVERY INPUT IS VALIDATED BEFORE THE FIRST TRIAL RATHER THAN DURING IT. A
 * 10,000-trial run that fails on the last account because the discount was
 * stated in percent has spent the run to find out, and the failure arrives at
 * the point furthest from the mistake.
 */
export function runHarness(input: HarnessRunInput): HarnessRun {
  checkCalibrationSource(input.calibration);
  checkBehaviour(input.behaviour);
  checkCommercial(input.commercial);
  if (input.sessions.length === 0) throw new RunError('a run needs at least one session');

  const accountsPerUser = input.accountsPerUser ?? 1;
  const population = buildPopulation(input.population, accountsPerUser);

  // ONE SLICE, SHARED BY EVERY TRIAL. `R-37` counts a cadence gap by sequence
  // subtraction, and two accounts folded against slices with different bases
  // would be counting on two different rulers.
  const calendar = toCalendarSlice(input.sessions, {
    sequenceBase: input.sequenceBase,
    ...(input.halfDays === undefined ? {} : { halfDays: input.halfDays }),
    ...(input.haltedDays === undefined ? {} : { haltedDays: input.haltedDays }),
  });

  const trials: Trial[] = population.map((account) =>
    runTrial({
      seed: input.seed,
      engineVersion: input.engineVersion,
      plan: input.plan,
      account,
      sessions: input.sessions,
      specs: input.specs,
      calendar,
      behaviour: input.behaviour,
      context: input.context,
    }),
  );

  const provenance = provenanceFor({
    engineVersion: input.engineVersion,
    seed: input.seed,
    calibration: input.calibration,
    runSampleSize: trials.length,
  });

  const computed = aggregate({
    trials,
    plan: input.plan,
    commercial: input.commercial,
    provenance,
  });

  return {
    provenance,
    trials,
    aggregate: computed,
    bands: checkBands(input.calibration, computed.outputs),
  };
}

/**
 * The unit a swept value is stated in.
 *
 * `SD-M21-01` CARRIES ONE COLUMN, `swept_value_bp`, AND `HO-08` SWEEPS A COUNT.
 * The sensitivity sweep of record is "over `PP-01`, `PP-07` and `max_payouts`",
 * and `max_payouts` is a ladder length: 5 is five rungs and not 5 basis points.
 * A single `_bp` column cannot carry both without a convention nobody has
 * written down, so the harness records the unit beside the value and REPORTS the
 * gap rather than inventing the convention. Whether `0045` grows a unit column
 * is the migration's question and not this package's.
 */
export type SweptValueUnit = 'basis_points' | 'cents' | 'count';

/** One arm of a sweep: what was varied, and the complete run at that value. */
export interface SweepArm {
  readonly sweptParameter: string;
  readonly sweptValue: number;
  readonly sweptValueUnit: SweptValueUnit;
  readonly input: HarnessRunInput;
}

export interface SweepArmResult {
  readonly sweptParameter: string;
  readonly sweptValue: number;
  readonly sweptValueUnit: SweptValueUnit;
  readonly run: HarnessRun;
}

/** The smallest sample one output reached anywhere in the sweep. `AS-M21-02`. */
export interface SweepSampleFloor {
  readonly key: OutputKey;
  readonly minimumSampleSize: number;
}

export interface SweepResult {
  readonly sweepId: string;
  readonly sweptParameter: string;
  readonly arms: readonly SweepArmResult[];
  readonly sampleFloors: readonly SweepSampleFloor[];
  /** Outputs that returned the SAME value in every arm. Section 9.3's flat line. */
  readonly identicalAcrossArms: readonly OutputKey[];
  /** What the two facts above mean, in words, for a surface to render. */
  readonly notes: readonly string[];
}

/**
 * Run every arm and report what no single arm can see.
 *
 * THE ARMS RUN IN THE ORDER GIVEN AND ARE NOT SORTED. A sweep is read as a
 * series and the caller's order is the series; sorting by value would silently
 * reverse a descending sweep and change what the chart says.
 */
export function runSweep(sweepId: string, arms: readonly SweepArm[]): SweepResult {
  if (sweepId.trim() === '') {
    throw new RunError(
      'a sweep needs an id. M21 section 3.4 makes the arms rows sharing a sweep_id, which is ' +
        'the one provenance mechanism rather than a second one',
    );
  }
  if (arms.length < 2) {
    throw new RunError(
      `a sweep needs at least two arms and was given ${String(arms.length)}. One arm is a run`,
    );
  }
  const parameters = new Set(arms.map((arm) => arm.sweptParameter));
  if (parameters.size !== 1) {
    throw new RunError(
      `a sweep varies one parameter and these arms vary ${String(parameters.size)}: ` +
        `${[...parameters].join(', ')}. Two parameters moving at once is a comparison whose ` +
        'arms cannot be attributed',
    );
  }
  const sweptParameter = arms[0]?.sweptParameter ?? '';

  const results: SweepArmResult[] = arms.map((arm) => ({
    sweptParameter: arm.sweptParameter,
    sweptValue: arm.sweptValue,
    sweptValueUnit: arm.sweptValueUnit,
    run: runHarness(arm.input),
  }));

  const first = results[0];
  if (first === undefined) throw new RunError('a sweep needs at least one arm');

  const sampleFloors: SweepSampleFloor[] = first.run.aggregate.outputs.map((output) => {
    let minimumSampleSize = output.sampleSize;
    for (const result of results) {
      const same = result.run.aggregate.outputs.find((candidate) => candidate.key === output.key);
      if (same !== undefined && same.sampleSize < minimumSampleSize) {
        minimumSampleSize = same.sampleSize;
      }
    }
    return { key: output.key, minimumSampleSize };
  });

  const identicalAcrossArms: OutputKey[] = [];
  for (const output of first.run.aggregate.outputs) {
    const reference = output.value;
    if (reference === null) continue;
    const identical = results.every((result) => {
      const same = result.run.aggregate.outputs.find((candidate) => candidate.key === output.key);
      return same?.value != null && equals(same.value, reference);
    });
    if (identical) identicalAcrossArms.push(output.key);
  }

  const notes: string[] = [];
  if (identicalAcrossArms.length > 0) {
    notes.push(
      `These outputs returned an identical value in every arm: ${identicalAcrossArms.join(', ')}. ` +
        'A FLAT LINE MEANS NO EFFECT ON THE MEAN AND NOT NO EFFECT. SIMULATION_HARNESS section ' +
        '9.3 found that the ladder does not bind the average account, so a sweep over ' +
        'max_payouts shows exactly this and the ladder is still doing its whole job, which is ' +
        'tail protection. A review that reads a flat line as "free in both directions" is the ' +
        'failure that paragraph exists to prevent.',
    );
  }
  const floor = sampleFloors.reduce(
    (smallest, candidate) =>
      candidate.minimumSampleSize < smallest.minimumSampleSize ? candidate : smallest,
    sampleFloors[0] ?? { key: 'payouts_per_payer' as OutputKey, minimumSampleSize: 0 },
  );
  notes.push(
    `The smallest sample any output reached in any arm is ${String(floor.minimumSampleSize)}, on ` +
      `${floor.key}. AS-M21-02 is a sweep run at a sample size too small to separate the arms, ` +
      'read as a signal. Whether this one separates them is a judgement the sample size is the ' +
      'input to.',
  );

  return { sweepId, sweptParameter, arms: results, sampleFloors, identicalAcrossArms, notes };
}
