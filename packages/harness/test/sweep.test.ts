// =============================================================================
// packages/harness/test/sweep.test.ts
// =============================================================================
// THE TWO CROSS-ARM FACTS, AND THE TWO WAYS A SWEEP IS MALFORMED.
//
// The flat-line case is the one worth reading. SIMULATION_HARNESS section 9.3
// found that the ladder does not bind the average account, so a sweep over
// `max_payouts` returns identical figures in every arm, and M21 section 3.4
// makes it a SURFACE OBLIGATION to say that a flat line means "no effect on the
// mean" and not "no effect". A surface cannot say it if the run does not tell
// it, so this asserts that the run tells it.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { runSweep, RunError } from '../src/index.js';
import type { HarnessRunInput, SweepArm } from '../src/index.js';
import {
  CANONICAL_BEHAVIOUR,
  CANONICAL_CALIBRATION,
  CANONICAL_COMMERCIAL,
  CANONICAL_CONTEXT,
  CANONICAL_ENGINE_VERSION,
  CANONICAL_POPULATION_SPEC,
  CANONICAL_SEED,
  CANONICAL_SEQUENCE_BASE,
  CANONICAL_SESSIONS,
  CANONICAL_SPECS,
  SIM_PLAN,
} from './canonical.js';

const RUN: HarnessRunInput = {
  seed: CANONICAL_SEED,
  engineVersion: CANONICAL_ENGINE_VERSION,
  plan: SIM_PLAN,
  population: CANONICAL_POPULATION_SPEC,
  sessions: CANONICAL_SESSIONS,
  specs: CANONICAL_SPECS,
  sequenceBase: CANONICAL_SEQUENCE_BASE,
  behaviour: CANONICAL_BEHAVIOUR,
  commercial: CANONICAL_COMMERCIAL,
  context: CANONICAL_CONTEXT,
  calibration: CANONICAL_CALIBRATION,
};

/**
 * A sweep over the per-funded variable cost.
 *
 * IT MOVES THE COMMERCIAL OUTPUTS AND NOTHING ELSE, which is what makes it the
 * right fixture for the flat-line case: the funnel is identical in every arm
 * because the cost stack cannot reach the engine, and that is a true flat line
 * rather than a contrived one.
 */
const COST_ARMS: readonly SweepArm[] = [0n, 3_000n, 6_000n].map((cost) => ({
  sweptParameter: 'variableCostPerFundedAccountCents',
  sweptValue: Number(cost),
  sweptValueUnit: 'cents' as const,
  input: {
    ...RUN,
    commercial: { ...CANONICAL_COMMERCIAL, variableCostPerFundedAccountCents: cost },
  },
}));

describe('a sweep', () => {
  const sweep = runSweep('sweep-fixture-001', COST_ARMS);

  it('runs every arm and keeps them in the order given', () => {
    // NOT SORTED. A sweep is read as a series and the caller's order is the
    // series; sorting by value would silently reverse a descending sweep.
    expect(sweep.arms.map((arm) => arm.sweptValue)).toEqual([0, 3_000, 6_000]);
    expect(sweep.sweptParameter).toBe('variableCostPerFundedAccountCents');
    expect(sweep.sweepId).toBe('sweep-fixture-001');
  });

  it('gives every arm its own complete provenance', () => {
    // M21 section 3.4: the arms are runs sharing a `sweep_id`. One provenance
    // mechanism, not two, so an arm is individually traceable.
    for (const arm of sweep.arms) {
      expect(arm.run.provenance.calibrationDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(arm.run.aggregate.outputs.every((output) => output.provenance.seed !== '')).toBe(true);
    }
  });

  it('names the outputs that came back identical, and says what a flat line means', () => {
    // The funnel cannot move: the cost stack is not an input to any rule.
    expect(sweep.identicalAcrossArms).toContain('evaluation_pass_rate');
    expect(sweep.identicalAcrossArms).toContain('payouts_per_payer');
    expect(sweep.identicalAcrossArms).toContain('liability_per_funded_account');
    // And the outputs the sweep DOES move are not in the list.
    expect(sweep.identicalAcrossArms).not.toContain('contribution_per_buyer');
    expect(sweep.identicalAcrossArms).not.toContain('margin_at_price');
    // Section 9.3's warning is carried with the finding rather than left for a
    // reader to supply.
    expect(sweep.notes.join(' ')).toContain('NO EFFECT ON THE MEAN AND NOT NO EFFECT');
  });

  it('reports the smallest sample any output reached in any arm', () => {
    // `AS-M21-02`'s early warning. It cannot be prevented by arithmetic; it can
    // be put in front of the reader.
    const perPayer = sweep.sampleFloors.find((floor) => floor.key === 'payouts_per_payer');
    expect(perPayer).toBeDefined();
    expect(perPayer?.minimumSampleSize).toBe(sweep.arms[0]?.run.aggregate.counts.payers);
    expect(sweep.notes.join(' ')).toContain('AS-M21-02');
  });
});

describe('a malformed sweep', () => {
  it('refuses one arm, because one arm is a run', () => {
    expect(() => runSweep('sweep-fixture-002', COST_ARMS.slice(0, 1))).toThrow(RunError);
  });

  it('refuses arms that vary two parameters at once', () => {
    // A comparison whose arms cannot be attributed is not a comparison.
    const first = COST_ARMS[0];
    const second = COST_ARMS[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;
    expect(() =>
      runSweep('sweep-fixture-003', [first, { ...second, sweptParameter: 'somethingElse' }]),
    ).toThrow(RunError);
  });

  it('refuses a sweep with no id', () => {
    expect(() => runSweep('   ', COST_ARMS)).toThrow(RunError);
  });
});
