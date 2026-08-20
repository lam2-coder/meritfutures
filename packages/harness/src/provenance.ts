// =============================================================================
// packages/harness/src/provenance.ts
// =============================================================================
// THE CALIBRATION IDENTITY, AND WHY IT IS A REQUIRED FIELD RATHER THAN A FOOTER.
//
// The session brief states it as a rule: EVERY RESULT CARRIES ITS CALIBRATION
// IDENTITY AND SAMPLE SIZE, because "a projection without provenance is a number
// nobody can defend later". M21 states the same thing three ways and each one
// binds a different layer:
//
//   INV-M21-04   "A simulation result without a calibration identity and a
//                 sample size CANNOT BE RENDERED. Absent provenance is an error
//                 state, never a blank field"
//   AS-M21-01    a published config whose simulation ran against stale
//                 calibration. The structural answer is to BIND the calibration
//                 identity into the result and carry it onto the publish record
//   GS-313       a simulation runs and the calibration source and sample size
//                 APPEAR ON THE RESULT
//
// So `Provenance` is a required property of every output record in
// `outputs.ts`, not an optional one, and there is no constructor in this package
// that produces a result without one. FM-M21-02 is the failure that makes that
// worth the type: "provenance is a required field of the response shape, not a
// nullable one", and a nullable field is a field a renderer eventually skips.
//
// -----------------------------------------------------------------------------
// THE DIGEST, AND WHAT IT IS FOR
// -----------------------------------------------------------------------------
// `SD-M21-01` carries `calibration_id`, `calibration_digest` AND
// `calibration_observed_at` as three columns rather than one, for the reason the
// row already gives about the draft's own digests: an identity can be reused
// while the thing it names is edited. A run that recorded only
// `mc_lifecycle.py@2026-08-14` cannot tell you whether the bands it was checked
// against are the bands that file carries today.
//
// THE DIGEST IS OVER A CANONICAL SERIALIZATION WRITTEN OUT FIELD BY FIELD, in a
// FIXED DECLARED ORDER, which is `SD-08`'s idiom in the engine and is here for
// the same reason: the determinism contract bans "iteration over an object's
// keys where the result affects output", and `JSON.stringify` over a record
// literal is exactly that iteration wearing a library call as a disguise.
//
// -----------------------------------------------------------------------------
// THERE IS NO CLOCK IN THIS PACKAGE AND `observedAt` IS NOT COMPARED TO ONE
// -----------------------------------------------------------------------------
// `AS-M21-01` is about STALE calibration, so the temptation is to compute the
// age here and flag it. The harness does not, and the reason is the same one
// that keeps the draws keyed: a projection whose value depends on when it was
// rendered cannot be reproduced, and reproducibility is what makes a run
// traceable to the decision it justified. The harness carries the observation
// date; M21's surface, which does have a clock and a reader, compares it.
// =============================================================================

import { createHash } from 'node:crypto';

/**
 * The harness's own version, bumped BY HAND when the trial loop's model changes.
 *
 * IT IS A CONSTANT AND NOT THE PACKAGE VERSION. `SD-M21-01` stores
 * `harness_version` beside `engine_version` and `seed` so a stored run can be
 * re-run exactly (SIMULATION_HARNESS section 7.2: "a harness whose failures are
 * not reproducible is a harness whose failures get attributed to noise"). The
 * manifest version is `0.0.0` on every package in this workspace and would
 * therefore record nothing; a value that never changes is worse than no value,
 * because it reads as a version that was checked.
 *
 * WHAT COUNTS AS A CHANGE: anything that moves a number a given seed produces.
 * The trial loop's day order, the settlement timing, the population behaviour it
 * applies, the definition of a cycle. Not a comment, not a rename, not a new
 * output computed from the same trials.
 */
export const HARNESS_VERSION = 'merit-harness-0001';

/** The units a band can be stated in. Integers throughout; no float ever holds one. */
export type BandUnit =
  /** A rate, `1000` = 10 percent. `RE-S-01`, `RE-S-02`. */
  | 'basis_points'
  /** Integer cents. `RE-S-04`, `RE-S-06`. */
  | 'cents'
  /** A count per 10,000, so `21_300` is 2.13 payouts per payer. `RE-S-03`. */
  | 'count_per_10000'
  /** Integer cents per trading day. `RE-S-05`. */
  | 'cents_per_trading_day';

/**
 * One calibration band, SUPPLIED BY THE CALLER.
 *
 * NO BAND IS WRITTEN IN THIS PACKAGE. SIMULATION_HARNESS section 5: "A band is a
 * founder decision, not a tuning parameter", and the two available responses to
 * a failing band are "the engine regressed" and "the founder moved a plan
 * parameter and the band moves with it, recorded in DECISIONS". A band living as
 * a constant in `src/` is a band a session can widen in a commit, which is
 * `TR-03` and is the exact failure this harness exists to catch.
 *
 * `minimum` and `maximum` are INCLUSIVE and either may be `null` for a one-sided
 * band. `RE-S-06` is a one-sided hard assertion rather than a band and is
 * expressed that way: a maximum, no minimum, and `assertions.ts` treats it as
 * fatal rather than as a report.
 */
export interface CalibrationBand {
  /** `RE-S-nn`, exactly as SIMULATION_HARNESS section 5 spells it. */
  readonly id: string;
  readonly label: string;
  readonly unit: BandUnit;
  /** Inclusive. `null` for a band with no lower edge. */
  readonly minimum: bigint | null;
  /** Inclusive. `null` for a band with no upper edge. */
  readonly maximum: bigint | null;
  /**
   * The central estimate, or `null` where the source states none.
   *
   * SIMULATION_HARNESS section 2.1 makes this a REQUIRED DISTINCTION rather than
   * a convenience: the bands "are central estimates. No cushion is implied and
   * none may be described", and the reserve floor is a separately named output
   * precisely so the two cannot be confused downstream. A field called `value`
   * holding either would be that confusion in a schema.
   */
  readonly central: bigint | null;
  /** Where the band comes from, in words. A band with no source is a preference. */
  readonly source: string;
}

/**
 * The calibration of record a run was checked against.
 *
 * `id` NAMES THE ARTIFACT AND `observedAt` NAMES WHEN ITS FIGURES WERE READ OFF
 * IT. Both are the caller's. The corpus's own calibration of record is
 * `research/calibration/mc_lifecycle.py` as re-run at the FREEZE gate
 * (SIMULATION_HARNESS section 9), and section 9.4 records that the committed
 * engine is STALE IN FOUR PLACES, which is precisely the condition
 * `AS-M21-01` describes and why the date travels with the identity.
 */
export interface CalibrationSource {
  readonly id: string;
  /** `yyyy-mm-dd`. The day the figures were observed, never the day of the run. */
  readonly observedAt: string;
  /** What it is and where it came from. Read by a human, never parsed. */
  readonly note: string;
  readonly bands: readonly CalibrationBand[];
}

/** Thrown when provenance cannot be formed. A run never proceeds without it. */
export class ProvenanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProvenanceError';
  }
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The canonical serialization the digest is taken over.
 *
 * FIELD BY FIELD, IN THE ORDER DECLARED HERE, and `bands` in the order the
 * caller supplied. The order is part of the digest: two sources listing the same
 * bands in a different order ARE different sources for this purpose, because a
 * reordering is an edit and the digest's whole job is to notice an edit.
 */
function canonical(source: CalibrationSource): string {
  const parts: string[] = [
    `id=${source.id}`,
    `observedAt=${source.observedAt}`,
    `note=${source.note}`,
    `bandCount=${String(source.bands.length)}`,
  ];
  for (const band of source.bands) {
    parts.push(
      [
        `band.id=${band.id}`,
        `band.label=${band.label}`,
        `band.unit=${band.unit}`,
        `band.minimum=${band.minimum === null ? 'null' : band.minimum.toString()}`,
        `band.maximum=${band.maximum === null ? 'null' : band.maximum.toString()}`,
        `band.central=${band.central === null ? 'null' : band.central.toString()}`,
        `band.source=${band.source}`,
      ].join(''),
    );
  }
  return parts.join('');
}

/** Validate a calibration source. A malformed one is refused, never repaired. */
export function checkCalibrationSource(source: CalibrationSource): void {
  if (source.id.trim() === '') {
    throw new ProvenanceError(
      'a calibration source needs an id. INV-M21-04: absent provenance is an error state',
    );
  }
  if (!ISO_DAY.test(source.observedAt)) {
    throw new ProvenanceError(
      `calibration observedAt ${JSON.stringify(source.observedAt)} is not yyyy-mm-dd`,
    );
  }
  const seen = new Set<string>();
  for (const band of source.bands) {
    if (seen.has(band.id)) {
      throw new ProvenanceError(
        `calibration source ${source.id} carries band ${band.id} twice. Two bands on one ` +
          'identifier is two answers to one assertion',
      );
    }
    seen.add(band.id);
    if (band.minimum !== null && band.maximum !== null && band.maximum < band.minimum) {
      throw new ProvenanceError(`band ${band.id} ends before it starts`);
    }
    if (band.source.trim() === '') {
      throw new ProvenanceError(
        `band ${band.id} carries no source. A band with no source is a preference, and ` +
          'SIMULATION_HARNESS section 5 makes a band a founder decision',
      );
    }
  }
}

/**
 * `sha256` over the canonical form, hex.
 *
 * A DIGEST AND NOT A HASH OF NOTHING. `scripts/demo/bridge.ts` makes the
 * opposite call for `DailyMark.sourceHash` and says why: the demo ingests no
 * artifact, so it carries a labelled identifier rather than "a value that looked
 * like a digest and was not". Here there IS an artifact, the caller's
 * calibration record, and the digest is over exactly the bytes that record
 * contributes to every band comparison in a run.
 */
export function calibrationDigest(source: CalibrationSource): string {
  checkCalibrationSource(source);
  return createHash('sha256').update(canonical(source), 'utf8').digest('hex');
}

/**
 * What every output record carries.
 *
 * `runSampleSize` IS THE RUN'S TRIAL COUNT AND IS NOT THE OUTPUT'S SAMPLE SIZE.
 * The two differ on every output with a narrower denominator: `RE-S-03` is over
 * PAYERS, `RE-S-02` is over FUNDED accounts, and a run of 10,000 trials can
 * produce a payouts-per-payer figure computed over eleven of them. `AS-M21-02`
 * is exactly that failure read as a signal, so both numbers are carried and the
 * narrow one sits on the output beside its value.
 */
export interface Provenance {
  readonly harnessVersion: string;
  readonly engineVersion: string;
  /** The run's seed. What makes the run re-runnable (SD-M21-01, section 7.2). */
  readonly seed: string;
  readonly calibrationId: string;
  readonly calibrationDigest: string;
  readonly calibrationObservedAt: string;
  readonly runSampleSize: number;
}

/** Stamp the provenance for a run. The only constructor there is. */
export function provenanceFor(input: {
  readonly engineVersion: string;
  readonly seed: string;
  readonly calibration: CalibrationSource;
  readonly runSampleSize: number;
}): Provenance {
  if (input.engineVersion.trim() === '') {
    throw new ProvenanceError(
      'a run needs the engine version it folded under. Replay scopes divergence detection to ' +
        'rows computed under the running version (M01 Appendix B.4)',
    );
  }
  if (input.seed.trim() === '') {
    throw new ProvenanceError(
      'a run needs a seed. SIMULATION_HARNESS section 7.2: a harness whose failures are not ' +
        'reproducible is a harness whose failures get attributed to noise',
    );
  }
  if (!Number.isSafeInteger(input.runSampleSize) || input.runSampleSize < 0) {
    throw new ProvenanceError(`${String(input.runSampleSize)} is not a sample size`);
  }
  return {
    harnessVersion: HARNESS_VERSION,
    engineVersion: input.engineVersion,
    seed: input.seed,
    calibrationId: input.calibration.id,
    calibrationDigest: calibrationDigest(input.calibration),
    calibrationObservedAt: input.calibration.observedAt,
    runSampleSize: input.runSampleSize,
  };
}
