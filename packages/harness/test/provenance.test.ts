// =============================================================================
// packages/harness/test/provenance.test.ts
// =============================================================================
// THE DIGEST'S ONE JOB IS TO NOTICE AN EDIT, so the cases here are edits.
//
// `AS-M21-01` is a published configuration whose simulation ran against stale
// calibration, and its structural answer is to bind the calibration identity
// into the result. An identity alone cannot do that: `SD-M21-01` carries the id,
// the digest and the observation date as three columns because an identity can
// be REUSED while the thing it names is edited, and the harness's own
// calibration of record is known-stale in four places right now
// (SIMULATION_HARNESS section 9.4).
// =============================================================================

import { describe, expect, it } from 'vitest';
import {
  calibrationDigest,
  checkCalibrationSource,
  HARNESS_VERSION,
  provenanceFor,
  ProvenanceError,
} from '../src/index.js';
import type { CalibrationSource } from '../src/index.js';
import { CANONICAL_CALIBRATION, CANONICAL_ENGINE_VERSION, CANONICAL_SEED } from './canonical.js';

const withBands = (edit: (source: CalibrationSource) => CalibrationSource): CalibrationSource =>
  edit(CANONICAL_CALIBRATION);

describe('the calibration digest', () => {
  it('is stable across calls', () => {
    expect(calibrationDigest(CANONICAL_CALIBRATION)).toBe(calibrationDigest(CANONICAL_CALIBRATION));
  });

  it('moves when a band edge moves', () => {
    // The edit `AS-M21-01` is about: the identity stayed the same and the thing
    // it names did not.
    const edited = withBands((source) => ({
      ...source,
      bands: source.bands.map((band) =>
        band.id === 'RE-S-03' ? { ...band, maximum: 40_000n } : band,
      ),
    }));
    expect(edited.id).toBe(CANONICAL_CALIBRATION.id);
    expect(calibrationDigest(edited)).not.toBe(calibrationDigest(CANONICAL_CALIBRATION));
  });

  it('moves when the bands are reordered', () => {
    // A REORDERING IS AN EDIT FOR THIS PURPOSE. The alternative, a digest that
    // ignored order, would need a canonical sort, and a sort over caller data is
    // one more thing that can disagree with the source it came from.
    const reversed = withBands((source) => ({ ...source, bands: [...source.bands].reverse() }));
    expect(calibrationDigest(reversed)).not.toBe(calibrationDigest(CANONICAL_CALIBRATION));
  });

  it('moves when the observation date moves', () => {
    const redated = withBands((source) => ({ ...source, observedAt: '2026-08-21' }));
    expect(calibrationDigest(redated)).not.toBe(calibrationDigest(CANONICAL_CALIBRATION));
  });
});

describe('a calibration source', () => {
  it('needs an identity', () => {
    expect(() => checkCalibrationSource({ ...CANONICAL_CALIBRATION, id: '  ' })).toThrow(
      ProvenanceError,
    );
  });

  it('needs an observation date in yyyy-mm-dd', () => {
    expect(() =>
      checkCalibrationSource({ ...CANONICAL_CALIBRATION, observedAt: 'August 2026' }),
    ).toThrow(ProvenanceError);
  });

  it('refuses two bands on one identifier', () => {
    const first = CANONICAL_CALIBRATION.bands[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(() =>
      checkCalibrationSource({
        ...CANONICAL_CALIBRATION,
        bands: [...CANONICAL_CALIBRATION.bands, first],
      }),
    ).toThrow(ProvenanceError);
  });

  it('refuses a band with no source', () => {
    // SIMULATION_HARNESS section 5 makes a band a founder decision. A band with
    // no source is a preference wearing an identifier.
    expect(() =>
      checkCalibrationSource({
        ...CANONICAL_CALIBRATION,
        bands: CANONICAL_CALIBRATION.bands.map((band) => ({ ...band, source: '' })),
      }),
    ).toThrow(ProvenanceError);
  });

  it('refuses a band that ends before it starts', () => {
    expect(() =>
      checkCalibrationSource({
        ...CANONICAL_CALIBRATION,
        bands: CANONICAL_CALIBRATION.bands.map((band) =>
          band.id === 'RE-S-03' ? { ...band, minimum: 30_000n, maximum: 10_000n } : band,
        ),
      }),
    ).toThrow(ProvenanceError);
  });
});

describe('provenance', () => {
  it('carries the harness version, the engine version, the seed and the sample', () => {
    const provenance = provenanceFor({
      engineVersion: CANONICAL_ENGINE_VERSION,
      seed: CANONICAL_SEED,
      calibration: CANONICAL_CALIBRATION,
      runSampleSize: 12,
    });
    expect(provenance.harnessVersion).toBe(HARNESS_VERSION);
    expect(provenance.engineVersion).toBe(CANONICAL_ENGINE_VERSION);
    expect(provenance.seed).toBe(CANONICAL_SEED);
    expect(provenance.runSampleSize).toBe(12);
  });

  it('refuses a run with no seed and a run with no engine version', () => {
    // Both are what makes a run re-runnable (`SD-M21-01`, section 7.2), and a
    // projection nobody can re-run is a number nobody can defend.
    expect(() =>
      provenanceFor({
        engineVersion: CANONICAL_ENGINE_VERSION,
        seed: '',
        calibration: CANONICAL_CALIBRATION,
        runSampleSize: 1,
      }),
    ).toThrow(ProvenanceError);
    expect(() =>
      provenanceFor({
        engineVersion: '',
        seed: CANONICAL_SEED,
        calibration: CANONICAL_CALIBRATION,
        runSampleSize: 1,
      }),
    ).toThrow(ProvenanceError);
  });
});
