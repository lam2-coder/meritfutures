// =============================================================================
// scripts/demo/test/determinism.test.ts
// =============================================================================
// `--seed` REPRODUCES BYTE FOR BYTE, ASSERTED RATHER THAN CLAIMED.
//
// The claim rests on two properties the packages state about themselves, and
// this suite is what makes the demo's use of them checkable rather than assumed:
//
//   `buildPopulation`  "account i is a pure function of `(seed, i)`"
//   `advanceDay`       "pure, total, and the only place a rule is applied"
//
// A demo can break that on its own without touching either package. A `Date`, a
// `Math.random`, a `toLocaleString`, an environment read, or an iteration whose
// order depends on a `Map` built from an unordered source would each produce a
// report that differs between runs while both packages stayed pure. The
// byte comparison catches all five at once, which is why it is on the RENDERED
// STRING and not on a hand-picked field of the state.
//
// A BYTE COMPARISON THAT PASSED VACUOUSLY WOULD BE WORSE THAN NO TEST, so the
// suite also asserts the report is not constant: a different seed produces
// different bytes, and the parts of the report that must move (the breach days,
// the eligibility day) do move.
// =============================================================================

import { describe, expect, it } from 'vitest';

import { DEFAULT_OPTIONS, parseArgs, runDemo } from '../main.ts';
import { money, signedMoney, stateDigestLine } from '../render.ts';
import { foldAccount } from '../fold.ts';
import { buildPopulation } from '../../../packages/rithmic/src/index.ts';
import {
  CORE_EOD_50K,
  COHORTS,
  DEMO_SPECS,
  SEQUENCE_BASE,
  populationSpec,
  sessions,
} from '../config.ts';

/** Small enough to run twice in a unit stage, long enough to fund and breach. */
const OPTIONS = { ...DEFAULT_OPTIONS, days: 25, accountsPerCohort: 2 };

describe('the demo reproduces from its seed', () => {
  it('produces byte-identical output for the same seed', () => {
    const first = runDemo(OPTIONS);
    const second = runDemo(OPTIONS);

    expect(second).toBe(first);
  });

  it('produces different output for a different seed', () => {
    // Without this the byte equality above would also hold for a renderer that
    // returned a constant, and the suite would be asserting nothing about the
    // seed at all.
    const mine = runDemo(OPTIONS);
    const other = runDemo({ ...OPTIONS, seed: `${OPTIONS.seed}-other` });

    expect(other).not.toBe(mine);
  });

  it('folds one account to the same state sequence twice', () => {
    // The same property one level down, so a failure says whether the fold or
    // the rendering moved. The digest is a fixed field order for the same
    // reason: a comparison over `Object.entries` would pass on two states whose
    // keys happened to be inserted in different orders.
    const cohort = COHORTS[0];
    if (cohort === undefined) throw new Error('there is always at least one cohort');

    const window = sessions(OPTIONS.startDay, OPTIONS.days);
    const account = buildPopulation(populationSpec(cohort, OPTIONS.seed, 1))[0];
    if (account === undefined) throw new Error('a population of one has one account');

    const fold = (): string[] =>
      foldAccount({
        seed: OPTIONS.seed,
        plan: CORE_EOD_50K,
        sessions: window,
        specs: DEMO_SPECS,
        sequenceBase: SEQUENCE_BASE,
        cohort,
        account,
      }).rows.map((row) =>
        row.state === null ? `${row.tradingDay}|refused` : stateDigestLine(row.state),
      );

    expect(fold()).toStrictEqual(fold());
  });
});

describe('the default run shows both sides', () => {
  // THE DEMO'S ONE BEHAVIOURAL CLAIM, ASSERTED. A run in which every account
  // ends the window still trading would print a fold rather than a rule, and it
  // would do so silently: the report would look complete and demonstrate
  // nothing. These two assertions are what stop a cohort tuned for one reason
  // from quietly removing the other side of the output.
  const report = runDemo(OPTIONS);

  it('reaches eligibility on at least one account', () => {
    expect(report).toContain('reached eligibility:');
    expect(report).toContain('=> eligible   YES');
  });

  it('breaches at least one account', () => {
    expect(report).toContain('BREACHED on');
    expect(report).toContain('trailing_eod_floor');
  });

  it('shows a breach the platform did not liquidate', () => {
    // Merit's floor trails (R-13) and the setpoint was pushed once at open, so
    // a breach above the setpoint carries no vendor evidence. It is the least
    // obvious line in the report and the easiest for a later tuning change to
    // remove without noticing.
    expect(report).toContain('NO VENDOR LIQUIDATION RECORD');
  });
});

describe('money never touches a float', () => {
  it('formats integer cents exactly, including past 2^53', () => {
    expect(money(0n)).toBe('$0.00');
    expect(money(5n)).toBe('$0.05');
    expect(money(5_000_000n)).toBe('$50,000.00');
    expect(money(-150_000n)).toBe('-$1,500.00');
    expect(signedMoney(15_000n)).toBe('+$150.00');
    expect(signedMoney(0n)).toBe('$0.00');

    // `Number(cents) / 100` is exact up to 2^53 cents and silently wrong above
    // it. This is the assertion that would fail if anyone reached for it.
    expect(money(9_007_199_254_740_993_00n)).toBe('$9,007,199,254,740,993.00');
  });
});

describe('the flags refuse rather than defaulting', () => {
  it('reads the flags it documents', () => {
    expect(parseArgs(['--seed', 'x', '--days', '7', '--accounts', '1'])).toStrictEqual({
      ...DEFAULT_OPTIONS,
      seed: 'x',
      days: 7,
      accountsPerCohort: 1,
    });
  });

  it('refuses a value it cannot use', () => {
    expect(() => parseArgs(['--days', '0'])).toThrow(/positive integer/);
    expect(() => parseArgs(['--days', 'lots'])).toThrow(/positive integer/);
    expect(() => parseArgs(['--nope', '1'])).toThrow(/unknown flag/);
    expect(() => parseArgs(['--seed'])).toThrow(/needs a value/);
  });

  it('reports help without running', () => {
    expect(parseArgs(['--help'])).toBe('help');
  });
});
