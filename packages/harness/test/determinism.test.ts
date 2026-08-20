// =============================================================================
// packages/harness/test/determinism.test.ts
// =============================================================================
// KEYED DETERMINISM IS THE REQUIREMENT AND NOT A CONVENIENCE, so it is asserted
// rather than assumed. The session brief states why: "a projection that cannot
// be reproduced cannot be traced to the decision it justified", which is
// `AS-M21-01`'s whole subject, and `SD-M21-01` stores the seed for exactly that
// reason.
//
// The first case is the load-bearing one. The trial loop drives the day model
// ONE SESSION AT A TIME so it can apply a settlement the engine had not yet
// approved when the window opened, and that is only legitimate if a day drawn
// alone is the same day drawn inside a continuous run. `rng.ts` says it is
// ("account A's day is independent of every other account, of the population's
// size, and of iteration order"). This asserts it at the seam that depends on
// it, because a property stated in one package and relied on in another is a
// property nothing checks.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { simulate } from '@merit/rithmic';
import type { SimAccount, SimDay } from '@merit/rithmic';
import { buildPopulation } from '@merit/rithmic';
import { runHarness } from '../src/index.js';
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

/** `JSON.stringify` cannot serialize a `bigint`, and every money field is one. */
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, entry: unknown) =>
    typeof entry === 'bigint' ? `${entry.toString()}n` : entry,
  );

describe('the day model driven one session at a time', () => {
  it('produces the same days as one continuous run, with no adjustments', () => {
    const population = buildPopulation(CANONICAL_POPULATION_SPEC);
    const account = population[0];
    expect(account).toBeDefined();
    if (account === undefined) return;

    const continuous = simulate({
      seed: CANONICAL_SEED,
      population: [account],
      sessions: CANONICAL_SESSIONS,
      specs: CANONICAL_SPECS,
      adjustments: [],
    });

    // The trial loop's inner call, reproduced here: one session per `simulate`,
    // with the balance carried by the caller.
    const dayByDay: SimDay[] = [];
    let carried = account.startingBalanceCents;
    for (const session of CANONICAL_SESSIONS) {
      const dayAccount: SimAccount = { ...account, startingBalanceCents: carried };
      const one = simulate({
        seed: CANONICAL_SEED,
        population: [dayAccount],
        sessions: [session],
        specs: CANONICAL_SPECS,
        adjustments: [],
      });
      const day = one.days[0]?.[0];
      expect(day).toBeDefined();
      if (day === undefined) return;
      dayByDay.push(day);
      carried = day.closingBalanceCents;
    }

    const continuousDays = continuous.days.map((forSession) => forSession[0]);
    expect(dayByDay.length).toBe(continuousDays.length);

    // THE ECHOED ACCOUNT RECORD IS EXCLUDED AND THE EXCLUSION IS THE FINDING.
    // `SimDay.account` is the account object the caller handed in, and the trial
    // loop hands in one whose `startingBalanceCents` is the balance carried into
    // THAT session rather than the account's opening size. So the field
    // legitimately differs from day two onward while every number the day model
    // computed is identical, which is what this case is about. A comparison that
    // included it would fail for a reason that is not a divergence.
    const withoutAccount = (day: SimDay | undefined): unknown => {
      if (day === undefined) return undefined;
      const { account: _account, ...rest } = day;
      return rest;
    };
    expect(stable(dayByDay.map(withoutAccount))).toBe(stable(continuousDays.map(withoutAccount)));
  });
});

describe('a run', () => {
  it('reproduces itself exactly from the same seed', () => {
    expect(stable(runHarness(RUN).trials)).toBe(stable(runHarness(RUN).trials));
  });

  it('reproduces its aggregate exactly, provenance included', () => {
    const first = runHarness(RUN);
    const second = runHarness(RUN);
    expect(stable(first.aggregate)).toBe(stable(second.aggregate));
    expect(first.provenance.calibrationDigest).toBe(second.provenance.calibrationDigest);
  });

  it('gives the first twelve accounts the same lives in a population of twenty', () => {
    // THE PROPERTY THE KEYING BUYS, at the harness's own layer. `rng.ts`: "a
    // simulator whose output shifts when the population grows cannot be the
    // thing goldens are derived against". Neither can a projection.
    const wider = runHarness({
      ...RUN,
      population: { ...CANONICAL_POPULATION_SPEC, accountCount: 20 },
    });
    const narrow = runHarness(RUN);
    expect(wider.trials.length).toBe(20);
    expect(stable(wider.trials.slice(0, 12))).toBe(stable(narrow.trials));
  });

  it('carries no float anywhere in its outputs', () => {
    // CLAUDE.md's rule, asserted structurally rather than trusted: every money
    // value and every aggregate is `bigint`, and a `number` on a value would be
    // the float this package refuses.
    const run = runHarness(RUN);
    for (const output of run.aggregate.outputs) {
      if (output.value === null) continue;
      expect(typeof output.value.numerator).toBe('bigint');
      expect(typeof output.value.denominator).toBe('bigint');
    }
    expect(typeof run.aggregate.lifetimeBound.boundCents).toBe('bigint');
    for (const trial of run.trials) {
      expect(typeof trial.lifetimeSettledCents).toBe('bigint');
      expect(typeof trial.lifetimeTraderCents).toBe('bigint');
      for (const payout of trial.payouts) {
        expect(typeof payout.approvedCents).toBe('bigint');
        expect(typeof payout.traderCents).toBe('bigint');
        expect(typeof payout.firmCents).toBe('bigint');
      }
    }
  });
});
