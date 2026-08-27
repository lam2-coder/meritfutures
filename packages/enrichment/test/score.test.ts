// =============================================================================
// packages/enrichment/test/score.test.ts
// =============================================================================
// THE SCORER, ASSERTED IN THE DIRECTION IT CAN BE WRONG IN.
//
// The failure mode this suite exists for is not "the arithmetic is off by one".
// It is the one M07 section 3.2 names: a reading the vendor did not answer,
// counted as a clean one or as a dirty one, turns a supplier outage into a
// population of unusually safe buyers or into a fraud wave. So the unknown
// cases carry more assertions here than the arithmetic does.

import { describe, expect, test } from 'vitest';

import type { EnrichmentAssessment, EnrichmentFacet, FacetFinding } from '../src/port.ts';
import { SCORE_SCALE_BP, scoreAssessment } from '../src/score.ts';

function finding(overrides: Partial<FacetFinding> = {}): FacetFinding {
  return {
    facet: 'ip' as EnrichmentFacet,
    reference: 'ref',
    reputationBp: null,
    footprintPresent: null,
    ageDays: null,
    datacenter: null,
    ...overrides,
  };
}

const assessment = (...findings: FacetFinding[]): EnrichmentAssessment => ({ findings });

describe('an unknown reading is excluded and is not a zero', () => {
  test('a finding the vendor answered nothing about produces NO score at all', () => {
    expect(scoreAssessment(assessment(finding()))).toEqual({
      kind: 'unscored',
      readings: { scored: 0, unknown: 3, refused: 0 },
    });
  });

  test('an empty assessment is `unscored` rather than a clean buyer', () => {
    expect(scoreAssessment(assessment())).toEqual({
      kind: 'unscored',
      readings: { scored: 0, unknown: 0, refused: 0 },
    });
  });

  test('an unknown reading moves the score by NOTHING, in either direction', () => {
    const answered = finding({ reputationBp: 4000, footprintPresent: true, datacenter: false });
    const alone = scoreAssessment(assessment(answered));
    const beside = scoreAssessment(assessment(answered, finding()));

    expect(alone).toMatchObject({ kind: 'scored' });
    expect(beside).toMatchObject({ kind: 'scored' });
    if (alone.kind !== 'scored' || beside.kind !== 'scored') throw new Error('unreachable');
    expect(beside.riskBp).toBe(alone.riskBp);
    expect(beside.readings.unknown).toBe(3);
  });

  test('`footprintPresent: false` is a MAXIMAL reading and `null` is not', () => {
    const looked = scoreAssessment(assessment(finding({ footprintPresent: false })));
    const didNot = scoreAssessment(assessment(finding({ footprintPresent: null })));

    expect(looked).toEqual({
      kind: 'scored',
      riskBp: SCORE_SCALE_BP,
      readings: { scored: 1, unknown: 2, refused: 0 },
    });
    expect(didNot.kind).toBe('unscored');
  });
});

describe('the arithmetic', () => {
  test('reputation is INVERTED once, here, so nothing downstream holds a direction', () => {
    const reputable = scoreAssessment(assessment(finding({ reputationBp: SCORE_SCALE_BP })));
    const disreputable = scoreAssessment(assessment(finding({ reputationBp: 0 })));

    expect(reputable).toMatchObject({ riskBp: 0 });
    expect(disreputable).toMatchObject({ riskBp: SCORE_SCALE_BP });
  });

  test('the readings are averaged over the ones that produced a number', () => {
    // Two readings: an inverted reputation of 6000 and a datacenter origin at
    // 10000. (6000 + 10000) / 2 = 8000.
    const scored = scoreAssessment(assessment(finding({ reputationBp: 4000, datacenter: true })));
    expect(scored).toEqual({
      kind: 'scored',
      riskBp: 8000,
      readings: { scored: 2, unknown: 1, refused: 0 },
    });
  });

  test('every score is an INTEGER in the declared range, over a spread of inputs', () => {
    for (let reputation = 0; reputation <= SCORE_SCALE_BP; reputation += 7) {
      const scored = scoreAssessment(
        assessment(
          finding({ reputationBp: reputation, footprintPresent: true }),
          finding({ facet: 'bin', reputationBp: SCORE_SCALE_BP - reputation }),
        ),
      );
      if (scored.kind !== 'scored') throw new Error('every case here has a reading');
      expect(Number.isInteger(scored.riskBp)).toBe(true);
      expect(scored.riskBp).toBeGreaterThanOrEqual(0);
      expect(scored.riskBp).toBeLessThanOrEqual(SCORE_SCALE_BP);
    }
  });

  test('the mean is TRUNCATED, which is the one division with no half in it', () => {
    // Three readings summing to 10001, which is 3333.66... before truncation.
    const scored = scoreAssessment(
      assessment(
        finding({ reputationBp: SCORE_SCALE_BP - 1, footprintPresent: true, datacenter: true }),
      ),
    );
    expect(scored).toMatchObject({ riskBp: 3333 });
  });
});

describe('a reading outside the scale is discarded and counted, never clamped', () => {
  test('a reputation above the scale is refused rather than pinned to the top', () => {
    const scored = scoreAssessment(
      assessment(finding({ reputationBp: 40000, footprintPresent: true })),
    );
    expect(scored).toEqual({
      kind: 'scored',
      riskBp: 0,
      readings: { scored: 1, unknown: 1, refused: 1 },
    });
  });

  test('a negative reputation and a fractional one are both refused', () => {
    for (const reputation of [-1, 5000.5]) {
      const scored = scoreAssessment(assessment(finding({ reputationBp: reputation })));
      expect(scored).toEqual({
        kind: 'unscored',
        readings: { scored: 0, unknown: 2, refused: 1 },
      });
    }
  });
});

describe('the scorer decides nothing and holds no state', () => {
  test('it is deterministic across repeated calls on one assessment', () => {
    const subject = assessment(
      finding({ reputationBp: 1234, footprintPresent: false, datacenter: true }),
      finding({ facet: 'email_footprint', reputationBp: 9999 }),
    );
    const first = scoreAssessment(subject);
    for (let i = 0; i < 5; i += 1) expect(scoreAssessment(subject)).toEqual(first);
  });

  test('the maximal score is a NUMBER and nothing more, with no verdict beside it', () => {
    const scored = scoreAssessment(
      assessment(finding({ reputationBp: 0, footprintPresent: false, datacenter: true })),
    );
    expect(Object.keys(scored).sort()).toEqual(['kind', 'readings', 'riskBp']);
  });
});
