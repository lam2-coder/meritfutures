// =============================================================================
// packages/harness/test/trial.test.ts
// =============================================================================
// THE LIFECYCLE, END TO END, THROUGH THE REAL ENGINE.
//
// The cases here are chosen against one question: which of these would still
// pass if the trial loop had quietly become a second implementation of a rule?
// So the ordinals, the ladder, the cadence and the cycle arithmetic are each
// checked against something the ENGINE decided rather than against a number this
// package also computed.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { buildPopulation } from '@merit/rithmic';
import { runHarness, sequenceOf, toCalendarSlice, asTradingDay, TrialError } from '../src/index.js';
import type { HarnessRunInput } from '../src/index.js';
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

const CALENDAR = toCalendarSlice(CANONICAL_SESSIONS, {
  sequenceBase: CANONICAL_SEQUENCE_BASE,
});

describe('the canonical run', () => {
  const run = runHarness(RUN);

  it('reaches the paths the fixture exists to reach', () => {
    // A FIXTURE THAT NEVER FUNDS AN ACCOUNT TESTS THE FIRST HALF OF THE LOOP.
    // These four assertions are what make every case below non-vacuous, and
    // they are stated as presence rather than as counts so an unrelated change
    // to the population does not fail them for the wrong reason.
    expect(run.aggregate.counts.reachedFunded).toBeGreaterThan(0);
    expect(run.aggregate.counts.payers).toBeGreaterThan(0);
    expect(run.aggregate.counts.settledPayouts).toBeGreaterThan(0);
    expect(run.aggregate.counts.graduated).toBeGreaterThan(0);
  });

  it('refuses no day', () => {
    // A REFUSAL HERE WOULD BE THE INTERESTING KIND. `INV-18` compares the mark's
    // opening against the PRE-settlement balance plus the adjustment, so a loop
    // that applied the withdrawal to the vendor book on the wrong day, or with
    // the wrong sign, would refuse every settlement day with `opening_mismatch`
    // and no account could ever hold a state row on the day it was paid.
    const refused = run.trials.filter((trial) => trial.outcome === 'refused');
    expect(
      refused.map((trial) => `${trial.platformAccountRef}: ${trial.refusal?.detail ?? ''}`),
    ).toEqual([]);
  });

  it('numbers the payouts 1..n with no gap', () => {
    // `R-45`: the ordinal is `payoutsSettledCount + 1`, and the counter is
    // advanced by `applySettlement` and by nothing else. A gap would mean a
    // settlement the loop recorded and the engine did not apply, or the reverse.
    for (const trial of run.trials) {
      expect(trial.payouts.map((payout) => payout.ordinal)).toEqual(
        trial.payouts.map((_payout, index) => index + 1),
      );
    }
  });

  it('never exceeds the ladder, and graduates exactly on it', () => {
    // `R-49`, `>=`, evaluated immediately after the settlement.
    for (const trial of run.trials) {
      expect(trial.payouts.length).toBeLessThanOrEqual(SIM_PLAN.funded.maxPayouts);
      if (trial.outcome === 'graduated') {
        expect(trial.payouts.length).toBe(SIM_PLAN.funded.maxPayouts);
        expect(trial.graduatedOn).not.toBeNull();
      }
    }
  });

  it('settles exactly the configured number of trading days after the basis day', () => {
    // Counted by SEQUENCE SUBTRACTION over the slice, never by date difference
    // (`AS-06`). A lag applied in calendar days would pass on four days out of
    // five and fail across a weekend, which is the shape of bug this counts out.
    for (const trial of run.trials) {
      for (const payout of trial.payouts) {
        const gap =
          sequenceOf(CALENDAR, asTradingDay(payout.effectiveTradingDay)) -
          sequenceOf(CALENDAR, asTradingDay(payout.basisTradingDay));
        expect(gap).toBe(CANONICAL_BEHAVIOUR.settlementLagTradingDays);
      }
    }
  });

  it('never reports a cycle shorter than the win days the engine required', () => {
    // THE CYCLE ARITHMETIC CHECKED AGAINST A RULE THE ENGINE ENFORCED, which is
    // the point of stating it this way round. `R-34` needs
    // `winDaysRequiredCount` win days, a win day is a trading day, and win days
    // are counted strictly after the anchor, so a cycle cannot be shorter than
    // the requirement. If `cycleTradingDays` were computed off the wrong anchor
    // this is what would catch it, and `RE-S-05`'s ceiling is the figure that
    // would silently inflate.
    for (const trial of run.trials) {
      for (const payout of trial.payouts) {
        expect(payout.cycleTradingDays).toBeGreaterThanOrEqual(
          SIM_PLAN.funded.winDaysRequiredCount,
        );
      }
    }
  });

  it('leaves at most one approved request unsettled per account', () => {
    // `R-38` decides it and the loop only supplies the fact. More than one would
    // mean the loop asked again while an external leg was outstanding, which is
    // `AS-01`'s stacking window.
    for (const trial of run.trials) {
      expect(trial.approvedRequestsNeverSettled).toBeLessThanOrEqual(1);
    }
  });

  it('exercises the unprotected account, which must not be pushed a floor', () => {
    // `V-M2-08` and `AS-M2-03`. The assertion is on the POPULATION rather than
    // on an outcome: if the fixture ever stops drawing an unprotected account,
    // the branch in the trial loop that leaves the setpoint null is untested and
    // this says so instead of passing quietly.
    const population = buildPopulation(CANONICAL_POPULATION_SPEC);
    expect(population.some((account) => account.riskMaxLossCents === null)).toBe(true);
  });
});

describe('a plan with no evaluation phase', () => {
  const run = runHarness({ ...RUN, plan: SIM_PLAN_NO_EVAL });

  it('funds every account on the first session', () => {
    // Appendix A.3's shape, which is Direct. `initialState` opens the account
    // funded when the plan carries no eval phase, so there is nothing to pass.
    for (const trial of run.trials) {
      expect(trial.startedInEval).toBe(false);
      expect(trial.reachedFunded).toBe(true);
      expect(trial.passedEvalOn).toBeNull();
      expect(trial.firstFundedTradingDay).toBe(CANONICAL_SESSIONS[0]?.tradingDay);
    }
  });
});

describe('the request policy', () => {
  it('reduces to immediate at a patience of one', () => {
    // THE PROPERTY THAT MAKES THE TWO POLICIES COMPARABLE. M01 section 8.3 wants
    // the estimate reported under both so the bias is measured, and a comparison
    // is only a measurement of the bias if the policies agree where they should.
    const immediate = runHarness(RUN);
    const patient = runHarness({
      ...RUN,
      behaviour: {
        ...CANONICAL_BEHAVIOUR,
        requestPolicy: { kind: 'peak_picking', patienceTradingDays: 1 },
      },
    });
    const shape = (payouts: readonly { readonly approvedCents: bigint }[]): string =>
      payouts.map((payout) => payout.approvedCents.toString()).join(',');
    expect(patient.trials.map((trial) => shape(trial.payouts))).toEqual(
      immediate.trials.map((trial) => shape(trial.payouts)),
    );
  });

  it('waits, and the wait is on the record', () => {
    // `AS-08`'s premium is only measurable if the wait is reported beside the
    // amount. A run under a patient policy that recorded `1` on every payout
    // would produce two liability figures and nothing that says why they differ.
    const patient = runHarness({
      ...RUN,
      behaviour: {
        ...CANONICAL_BEHAVIOUR,
        requestPolicy: { kind: 'peak_picking', patienceTradingDays: 4 },
      },
    });
    const waits = patient.trials.flatMap((trial) =>
      trial.payouts.map((payout) => payout.eligibleDaysWaited),
    );
    expect(waits.length).toBeGreaterThan(0);
    expect(Math.max(...waits)).toBeGreaterThan(1);
  });

  it('asks on every eligible day under a 100 percent random policy', () => {
    // `chanceBp: 10_000` is the same behaviour as `immediate` by construction,
    // and the two agreeing is what says the random arm is wired to the same
    // decision point rather than to a different one.
    const random = runHarness({
      ...RUN,
      behaviour: { ...CANONICAL_BEHAVIOUR, requestPolicy: { kind: 'random', chanceBp: 10_000 } },
    });
    const immediate = runHarness(RUN);
    expect(random.aggregate.counts.settledPayouts).toBe(immediate.aggregate.counts.settledPayouts);
  });

  it('never asks under a zero-chance policy', () => {
    const never = runHarness({
      ...RUN,
      behaviour: { ...CANONICAL_BEHAVIOUR, requestPolicy: { kind: 'random', chanceBp: 0 } },
    });
    expect(never.aggregate.counts.settledPayouts).toBe(0);
    expect(never.aggregate.counts.payers).toBe(0);
  });
});

describe('the behavioural knobs', () => {
  it('refuse a settlement lag of zero', () => {
    expect(() =>
      runHarness({ ...RUN, behaviour: { ...CANONICAL_BEHAVIOUR, settlementLagTradingDays: 0 } }),
    ).toThrow(TrialError);
  });

  it('refuse a patience of zero', () => {
    expect(() =>
      runHarness({
        ...RUN,
        behaviour: {
          ...CANONICAL_BEHAVIOUR,
          requestPolicy: { kind: 'peak_picking', patienceTradingDays: 0 },
        },
      }),
    ).toThrow(TrialError);
  });

  it('refuse a share outside 0..10000', () => {
    expect(() =>
      runHarness({ ...RUN, behaviour: { ...CANONICAL_BEHAVIOUR, riskUpShareBp: 10_001 } }),
    ).toThrow(TrialError);
  });
});
