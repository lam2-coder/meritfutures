// =============================================================================
// scripts/demo/test/replay-determinism.property.test.ts
// =============================================================================
// PT-06, IN THE HALF THAT IS EXPRESSIBLE TODAY, AND THE MEASUREMENT THAT SAYS
// WHICH HALF THAT IS.
//
// STRATEGY section 3.1: "Replay determinism. Any permutation of arrival order,
// any process timezone, any locale, yields byte-identical stored state ... Runs
// with `TZ` and `LC_ALL` randomized per case, which is how a
// `toLocaleDateString` gets caught."
//
// P2 section 5 scheduled the harness here and the assertion later, in one line:
// PT-06 is "harness yes, assertion no". THAT LINE IS NOW HALF WRONG IN THE
// GOOD DIRECTION, and this file exists to say which half by measuring rather
// than by claiming. 45 of 50 rules are implemented, so a fold that exercises
// them is available, and a timezone-invariance claim over it is REAL.
//
// -----------------------------------------------------------------------------
// WHY THE CORPUS IS THE DEMO POPULATION
// -----------------------------------------------------------------------------
// `runDemo` is the only multi-account fold through the real `advanceDay` and
// `evaluatePayout` that exists in this repository today. `fold.ts` runs it over
// a seeded population, `render.ts` renders it to a string, and the sibling
// `determinism.test.ts` already asserts the string is byte-identical for the
// same seed. That makes it exactly the right subject for PT-06: the seed half
// is already pinned, so ANY difference this file observes comes from the
// environment and nothing else.
//
// The golden fixture corpus is deliberately NOT used here. It folds through
// `evaluate`, which is still the scaffold's identity stub, so a
// timezone-invariance property over it would pass for the reason PT-06 exists
// to rule out. `packages/golden-loader/test/determinism.test.ts` carries that
// corpus under RE-D-01 and RE-D-02, where the vacuity is derived from
// `engineIsIdentityStub()` and prints itself on every run.
//
// -----------------------------------------------------------------------------
// THE VACUITY IS DERIVED, NEVER NARRATED
// -----------------------------------------------------------------------------
// Every "this half does not work yet" statement below is READ OFF THE TREE at
// run time: the arrival-order half from whether the engine exports a replay
// function, the locale half from whether this runtime re-resolves its locale.
// The day either changes, the output changes with it and the assertions switch
// themselves on. Nothing here has to be remembered, which is the whole of
// ADR-034's complaint and ADR-038's answer.
// =============================================================================

import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import * as engine from '../../../packages/rules-engine/src/index.js';
import {
  describeEnvironmentScope,
  environmentPairArbitrary,
  localeIsProcessScoped,
  timezoneIsProcessScoped,
  withEnvironment,
  type ProcessEnvironment,
} from '../../../packages/golden-loader/test/harness/environment.js';
import { DEFAULT_OPTIONS, runDemo } from '../main.js';

/**
 * Small enough to fold many times inside a property, long enough that accounts
 * reach the funded phase and settle. The sibling determinism suite uses the
 * same shape for the same reason.
 */
const OPTIONS = { ...DEFAULT_OPTIONS, days: 20, accountsPerCohort: 1 };

/**
 * `true` when the engine can replay an arrival-order permutation at all.
 *
 * DERIVED FROM THE PUBLIC SURFACE rather than from a comment. M01 section 1.3
 * lists `replay.ts` as the fold over a whole account life and P2 section 7 puts
 * it in P2-8; when it lands and is exported, this flips and the permutation
 * property below stops being skipped.
 */
const replayExists = Object.keys(engine).includes('replay');

describe('PT-06: what this run can and cannot prove', () => {
  test('the scope is measured and printed, not asserted from a comment', () => {
    const scope = describeEnvironmentScope();
    const permutation = replayExists
      ? 'arrival-order permutation is LIVE'
      : 'arrival-order permutation is UNEXPRESSIBLE (the engine exports no replay; P2-8)';

    // Into the run's own log, on every run, for ADR-038's reason: a claim that
    // lives only in a pull request body is read by nobody on run 200.
    console.log(`\n  ${scope}\n  PT-06: ${permutation}\n`);

    expect(scope).toContain('PT-06 harness');
  });
});

// -----------------------------------------------------------------------------
// The harness proved to be the cause, in both directions
// -----------------------------------------------------------------------------
// A randomizer watched producing a difference has shown that a difference
// occurred. It has NOT shown that the randomizer caused it: a function that
// simply returned a different value each call would pass that assertion
// forever. So the same function is run twice with the harness OFF and asserted
// IDENTICAL. The pair is the proof; either half alone is decoration.
describe('the harness itself is falsifiable', () => {
  // 20:00 UTC, AND THE HOUR IS THE POINT RATHER THAN A DETAIL. The first
  // version of this probe used 03:00, which under `Pacific/Kiritimati` (+14) is
  // 17:00 THE SAME DAY, so the rendered DATE did not move and this test failed
  // while the harness was working perfectly. At 20:00 the same instant is
  // 10:00 the NEXT day there.
  //
  // That is precisely the defect PT-06 hunts, found in PT-06's own probe: a
  // trading day derived from a timestamp is correct for most of the day in most
  // zones, and wrong for the hours that cross the boundary. A test written at
  // 03:00 would have reported "no timezone sensitivity here" about a codebase
  // riddled with it.
  const INSTANT = Date.UTC(2026, 0, 2, 20, 0, 0);

  /** Timezone-sensitive by construction. The defect class PT-06 hunts. */
  const impure = (): string => new Date(INSTANT).toDateString();

  test('a timezone-sensitive function DIFFERS under the harness', () => {
    expect(timezoneIsProcessScoped()).toBe(true);

    const a = withEnvironment({ tz: 'UTC', locale: 'C' }, impure);
    const b = withEnvironment({ tz: 'Pacific/Kiritimati', locale: 'C' }, impure);

    expect(
      a,
      'the harness set two timezones fourteen hours apart and the rendered day did not move',
    ).not.toBe(b);
  });

  test('the SAME function is identical with the harness off', () => {
    // The other half. Without this, the test above is satisfied by any function
    // that is merely unstable, and the harness would be credited with a
    // difference it did not cause.
    const a = impure();
    const b = impure();
    expect(a, 'the probe is unstable on its own, so it cannot witness the harness').toBe(b);
  });

  test('the harness restores what it found, including absence', () => {
    const before = process.env['TZ'];
    withEnvironment({ tz: 'Asia/Kathmandu', locale: 'tr_TR.UTF-8' }, () => undefined);
    expect(process.env['TZ']).toBe(before);

    // And on the throwing path, which is the one that matters: a property that
    // failed inside a foreign timezone must not leave every later case in it.
    expect(() =>
      withEnvironment({ tz: 'Asia/Kathmandu', locale: 'C' }, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(process.env['TZ']).toBe(before);
  });

  test('the locale half is INERT in-process, and that is measured', () => {
    // Not an assertion that it should be inert. It is a record of what this
    // runtime does, in the file that would otherwise be quietly testing
    // nothing: Node resolves the ICU default locale once at startup. If a
    // future runtime changes that, this test fails and the locale assertions
    // below become live in the same commit.
    expect(localeIsProcessScoped()).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// PT-06, the timezone half, over a fold that exercises 45 rules
// -----------------------------------------------------------------------------
describe('PT-06: the fold is invariant under the process environment', () => {
  test('the corpus is not vacuous', () => {
    // A property comparing two empty strings passes forever. This is the guard
    // that the subject of the property is a real fold with real output in it.
    const report = runDemo(OPTIONS);
    expect(report.length).toBeGreaterThan(500);
    expect(report).toContain('Core EOD');
  });

  test('byte-identical output under any two process environments', () => {
    fc.assert(
      fc.property(
        environmentPairArbitrary(),
        ([a, b]: readonly [ProcessEnvironment, ProcessEnvironment]) => {
          const first = withEnvironment(a, () => runDemo(OPTIONS));
          const second = withEnvironment(b, () => runDemo(OPTIONS));

          expect(
            second,
            `the fold differed between TZ=${a.tz} LC_ALL=${a.locale} and ` +
              `TZ=${b.tz} LC_ALL=${b.locale}. Something in the fold read the ` +
              `environment, which is what B4 #1 and INV-01 forbid`,
          ).toBe(first);
        },
      ),
      { numRuns: 25 },
    );
  });

  test('and the timezone genuinely moved while it was being folded', () => {
    // THE ANTI-VACUITY PAIRING FOR THE PROPERTY ABOVE. If `withEnvironment` had
    // silently stopped working, the invariance property would pass because
    // nothing changed rather than because nothing depended on what changed. So
    // the same wrapper, over the same call sites, is watched moving a probe
    // that DOES read the clock.
    const seen = new Set<string>();
    fc.assert(
      fc.property(environmentPairArbitrary(), ([a, b]) => {
        seen.add(withEnvironment(a, () => new Date(Date.UTC(2026, 0, 2, 3)).toDateString()));
        seen.add(withEnvironment(b, () => new Date(Date.UTC(2026, 0, 2, 3)).toDateString()));
      }),
      { numRuns: 25 },
    );
    expect(
      seen.size,
      'the environment pairing never actually changed the timezone',
    ).toBeGreaterThan(1);
  });
});

describe.skipIf(!replayExists)('PT-06: arrival-order permutation', () => {
  // SKIPPED BY DERIVATION, NOT BY A COMMENT. `replayExists` reads the engine's
  // public surface, so the day `replay` is exported this block runs. It appears
  // in the log as a named skip until then, which is CI-03's idiom (ADR-038):
  // a stage that is green because it had nothing to run is not the same object
  // as one that is green because it passed.
  test('any permutation of arrival order yields byte-identical stored state', () => {
    throw new Error(
      'the engine now exports `replay`, so PT-06s permutation half is expressible ' +
        'and must be written. See P2 section 7, session P2-8.',
    );
  });
});
