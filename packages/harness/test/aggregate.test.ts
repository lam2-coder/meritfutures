// =============================================================================
// packages/harness/test/aggregate.test.ts
// =============================================================================
// THE OUTPUTS, THEIR DENOMINATORS, AND THE TWO THINGS THAT MUST NEVER BE ZERO.
//
// The arithmetic cases below are computed by hand in the comments rather than
// re-derived in the test body. A test that recomputes the implementation's
// formula asserts that the code agrees with itself, which is `TR-01`'s
// complaint about a fixture derived from the implementation.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { aggregate, AggregateError, checkBands, provenanceFor, runHarness } from '../src/index.js';
import type { CalibrationSource, HarnessRunInput, OutputRecord } from '../src/index.js';
import { toBasisPoints } from '../src/ratio.js';
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
  SIM_PLAN_NO_EVAL,
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

const find = (outputs: readonly OutputRecord[], key: string): OutputRecord => {
  const found = outputs.find((output) => output.key === key);
  if (found === undefined) throw new Error(`no output ${key}`);
  return found;
};

describe('the aggregate', () => {
  const run = runHarness(RUN);
  const outputs = run.aggregate.outputs;

  it('carries the whole catalogue, in the order M21 lists it', () => {
    expect(outputs.map((output) => output.key)).toEqual([
      'evaluation_pass_rate',
      'funded_to_payout_rate',
      'payouts_per_payer',
      'liability_per_funded_account',
      'contribution_per_buyer',
      'margin_at_price',
      'per_day_extraction_ceiling',
      'lifetime_extraction_maximum',
    ]);
  });

  it('puts provenance on every output and never beside it', () => {
    // `INV-M21-04` and `GS-313`. The check is on EVERY record because a renderer
    // reads one at a time, and provenance carried on the run rather than on the
    // result is provenance one click away, which is `FM-M21-02`.
    for (const output of outputs) {
      expect(output.provenance.calibrationId).toBe(CANONICAL_CALIBRATION.id);
      expect(output.provenance.calibrationObservedAt).toBe(CANONICAL_CALIBRATION.observedAt);
      expect(output.provenance.calibrationDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(output.provenance.seed).toBe(CANONICAL_SEED);
      expect(output.provenance.runSampleSize).toBe(run.trials.length);
    }
  });

  it('divides each rate by its own population, not by the run', () => {
    // The three denominators shrink in this order, and a run that used the trial
    // count for all three would report the same funnel with three wrong numbers.
    const counts = run.aggregate.counts;
    expect(find(outputs, 'evaluation_pass_rate').sampleSize).toBe(counts.startedInEval);
    expect(find(outputs, 'funded_to_payout_rate').sampleSize).toBe(counts.reachedFunded);
    expect(find(outputs, 'payouts_per_payer').sampleSize).toBe(counts.payers);
    expect(counts.payers).toBeLessThanOrEqual(counts.reachedFunded);
    expect(counts.reachedFunded).toBeLessThanOrEqual(counts.trials);
  });

  it('reports payouts per payer as the exact pair it was computed from', () => {
    const output = find(outputs, 'payouts_per_payer');
    expect(output.value).not.toBeNull();
    if (output.value === null) return;
    // The exact pair, not a rounding: settled payouts over payers.
    expect(output.value.numerator * BigInt(run.aggregate.counts.payers)).toBe(
      BigInt(run.aggregate.counts.settledPayouts) * output.value.denominator,
    );
  });

  it('keeps RE-S-05 under the ceiling the configuration implies', () => {
    // SIMULATION_HARNESS section 6: "a divergence here is a HARNESS BUG rather
    // than an open question". The implied ceiling is the trader's share of a
    // full cap over the shortest cycle the gates permit, and on the fixture plan
    // that is 20,000c at 9000bp over 2 win days: 18,000c over 2 days, 9,000c a
    // day. A rate above it would mean the cycle was counted short or the split
    // was applied twice.
    const output = find(outputs, 'per_day_extraction_ceiling');
    expect(output.value).not.toBeNull();
    if (output.value === null) return;
    const ceilingCentsPerDay = 9_000n;
    expect(output.value.numerator).toBeLessThanOrEqual(
      ceilingCentsPerDay * output.value.denominator,
    );
  });

  it('states RE-S-06 as a bound that holds rather than as a maximum that fits', () => {
    // `INV-17`: `ladder * max cap` is `3 * 20,000c = 60,000c` on the fixture
    // plan. Both figures are reported because "the maximum happened to sit under
    // the bound" and "the bound holds" are different claims.
    const bound = run.aggregate.lifetimeBound;
    expect(bound.boundCents).toBe(60_000n);
    expect(bound.holds).toBe(true);
    expect(bound.observedMaximumCents).toBeLessThanOrEqual(bound.boundCents);
    expect(bound.observedMaximumTraderCents).toBeLessThan(bound.observedMaximumCents);
  });

  it('computes the contribution from the terms the caller entered', () => {
    // BY HAND, from `CANONICAL_COMMERCIAL` and the run's own counts:
    //   net price      20,000c at 2000bp off      = 16,000c
    //   liability/acct total trader legs / trials
    //   variable/acct  3,000c * funded / trials
    //   contribution   net - liability - variable, times 3 purchases per buyer
    const counts = run.aggregate.counts;
    const totalTraderCents = run.trials.reduce(
      (total, trial) => total + trial.lifetimeTraderCents,
      0n,
    );
    const trials = BigInt(counts.trials);
    const netPrice = 16_000n;
    const expectedNumerator =
      (netPrice * trials - totalTraderCents - 3_000n * BigInt(counts.reachedFunded)) * 3n;

    const output = find(outputs, 'contribution_per_buyer');
    expect(output.value).not.toBeNull();
    if (output.value === null) return;
    // Cross-multiplied so the comparison does not depend on the reduction.
    expect(output.value.numerator * trials).toBe(expectedNumerator * output.value.denominator);
  });

  it('reports a negative margin as a real answer', () => {
    // Section 9.2 puts Core EOD at +0.25 percent and the workbook had it at
    // negative 0.88 percent, so a negative margin is a figure the corpus already
    // carries rather than an error state. The fixture population is drawn to win
    // and therefore prints a deeply negative one.
    const output = find(outputs, 'margin_at_price');
    expect(output.value).not.toBeNull();
    if (output.value === null) return;
    expect(toBasisPoints(output.value)).toBeLessThan(0n);
  });
});

describe('an output with no sample', () => {
  it('is absent rather than 100 percent when the plan has no evaluation phase', () => {
    // The rule that is hardest to hold, because 100 percent looks like the
    // helpful answer. Direct funds on purchase, so there is no evaluation to
    // pass, and `HO-07`: a number reads as a measurement.
    const run = runHarness({ ...RUN, plan: SIM_PLAN_NO_EVAL });
    const output = find(run.aggregate.outputs, 'evaluation_pass_rate');
    expect(output.value).toBeNull();
    expect(output.sampleSize).toBe(0);
  });

  it('is absent rather than zero when nobody was paid', () => {
    const run = runHarness({
      ...RUN,
      behaviour: { ...CANONICAL_BEHAVIOUR, requestPolicy: { kind: 'random', chanceBp: 0 } },
    });
    const perPayer = find(run.aggregate.outputs, 'payouts_per_payer');
    expect(perPayer.value).toBeNull();
    expect(perPayer.sampleSize).toBe(0);
    const ceiling = find(run.aggregate.outputs, 'per_day_extraction_ceiling');
    expect(ceiling.value).toBeNull();
    expect(ceiling.sampleSize).toBe(0);
  });
});

describe('the commercial terms', () => {
  const invalid = (commercial: Partial<HarnessRunInput['commercial']>): (() => void) => {
    return () => {
      aggregate({
        trials: [],
        plan: SIM_PLAN,
        commercial: { ...CANONICAL_COMMERCIAL, ...commercial },
        provenance: provenanceFor({
          engineVersion: CANONICAL_ENGINE_VERSION,
          seed: CANONICAL_SEED,
          calibration: CANONICAL_CALIBRATION,
          runSampleSize: 0,
        }),
      });
    };
  };

  it('refuse a discount stated as a percent', () => {
    // The mistake this catches is `discountBp: 20` meaning 20 percent, which is
    // in range and silently wrong. What it can catch is the other direction.
    expect(invalid({ discountBp: 10_001 })).toThrow(AggregateError);
  });

  it('refuse a negative price and a negative cost', () => {
    expect(invalid({ pricePerPurchaseCents: -1n })).toThrow(AggregateError);
    expect(invalid({ variableCostPerFundedAccountCents: -1n })).toThrow(AggregateError);
  });

  it('refuse a buyer who buys nothing', () => {
    expect(invalid({ purchasesPerBuyer: { numerator: 0n, denominator: 1n } })).toThrow(
      AggregateError,
    );
  });
});

describe('the band report', () => {
  const run = runHarness(RUN);

  it('reports a band with no output as not measured, which is not a pass', () => {
    // The calibration of record carries eleven bands and this package computes
    // five. A report that called the other six green would be the most expensive
    // kind of wrong.
    const portfolio = run.bands.find((band) => band.bandId === 'RE-S-07');
    expect(portfolio?.verdict).toBe('not_measured');
    expect(portfolio?.realized).toBeNull();
    expect(portfolio?.outputKey).toBeNull();
  });

  it('evaluates the bands it can, with the sample size on the result', () => {
    const passRate = run.bands.find((band) => band.bandId === 'RE-S-01');
    expect(passRate?.verdict).toBe('pass');
    expect(passRate?.sampleSize).toBe(run.aggregate.counts.startedInEval);
  });

  it('fails a band the run is outside, rather than widening it', () => {
    // `TR-03`. Nothing in this package can widen a band: they arrive as caller
    // data. This is the shape of the failure the nightly build pages on.
    const narrowed: CalibrationSource = {
      ...CANONICAL_CALIBRATION,
      bands: CANONICAL_CALIBRATION.bands.map((band) =>
        band.id === 'RE-S-01' ? { ...band, minimum: 9_999n, maximum: 10_000n } : band,
      ),
    };
    const bands = checkBands(narrowed, run.aggregate.outputs);
    expect(bands.find((band) => band.bandId === 'RE-S-01')?.verdict).toBe('fail');
  });

  it('refuses a band whose unit disagrees with its output', () => {
    const mismatched: CalibrationSource = {
      ...CANONICAL_CALIBRATION,
      bands: CANONICAL_CALIBRATION.bands.map((band) =>
        band.id === 'RE-S-01' ? { ...band, unit: 'cents' as const } : band,
      ),
    };
    expect(() => checkBands(mismatched, run.aggregate.outputs)).toThrow();
  });
});
