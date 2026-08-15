import { appendFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import {
  AWAITING_ENGINE_INPUT,
  describeDiff,
  engineIsIdentityStub,
  loadFixtureDirectory,
  mismatchProofExists,
  registryIds,
  renderStageCoverage,
  runFixture,
  stageCoverage,
  type GoldenFixture,
} from '../src/index.js';

// =============================================================================
// CI-03. THE GOLDEN STAGE.
// =============================================================================
//   pnpm exec vitest run --project golden
//
// STRATEGY section 4.1 makes this a stage that runs on every push and blocks
// independently of CI-02, which is why the projects in vitest.config.ts map to
// stages rather than to packages.
//
// THERE IS NO PER-FIXTURE TEST CODE HERE and there must never be any. STRATEGY
// section 3.2: that is what stops a fixture from quietly acquiring a bespoke
// assertion that weakens it. Everything below is written once and applied to
// whatever the directory holds.

const { fixtures, failures } = loadFixtureDirectory();
const stubbed = engineIsIdentityStub();

// -----------------------------------------------------------------------------
// THE STAGE STATES WHAT IT CURRENTLY PROVES, IN ITS OWN OUTPUT
// -----------------------------------------------------------------------------
// A green check that means something narrower than its name is this
// repository's most repeated defect, and CI-03 is currently a sharp instance of
// it: the polarity is inverted while the engine is a stub, a corrupted expected
// end state still passes, and the end-to-end assertion is skipped rather than
// run. All three were true and all three were stated only in a pull request
// body, which is written once by whoever landed the stage and read by nobody
// afterwards.
//
// SO THE STAGE SAYS IT ITSELF, ON EVERY RUN, IN THE JOB LOG AND IN THE ACTIONS
// SUMMARY. `stageCoverage()` measures the claims rather than repeating them:
// the corrupted-expectation claim is proved by corrupting real loaded fixtures
// and re-running the stage's own assertion over them, so the block cannot
// describe a stage other than the one that just ran, and it changes on its own
// when M01 lands.
const coverage = stageCoverage();
const report = renderStageCoverage(coverage);

console.log(`\n${report}\n`);

// `$GITHUB_STEP_SUMMARY` is where a reader who never opens a log still sees it.
// Absent locally, which is why this is guarded rather than assumed.
const summary = process.env['GITHUB_STEP_SUMMARY'];
if (summary !== undefined && summary !== '') appendFileSync(summary, `${report}\n`);

describe('what this stage proves, which is narrower than its name', () => {
  test('the coverage statement is derived from this run, not written down', () => {
    // If any of these could drift, the block above would be prose with a
    // console.log in front of it, which is the thing it exists to replace.
    expect(coverage.polarity).toBe(stubbed ? 'inverted' : 'direct');
    expect(coverage.fixtures).toBe(fixtures.length);
    expect(coverage.loadFailures).toBe(failures.length);
    expect(coverage.endToEndRunning).toBe(!stubbed);
    expect(coverage.registryScenarios).toBe(registryIds().size);
  });

  test('the file it cites for the mismatch proof exists', () => {
    // The one claim in the block that is a reference rather than a measurement.
    // A citation to a deleted file is how a coverage statement rots into a
    // second thing nobody re-derives.
    expect(mismatchProofExists(coverage)).toBe(true);
  });

  test.runIf(stubbed)('a corrupted expected end state passes this stage, and it says so', () => {
    // THE ASSERTION IS THAT THE STAGE IS CURRENTLY BLIND, which is a strange
    // thing to assert until you consider the alternative: the blindness is real
    // either way, and the choice is between a suite that knows it and a suite
    // that does not. When M01 lands `stubbed` goes false, this test stops
    // running, and the block above prints the caught direction instead.
    expect(coverage.corruptedExpectationStillPasses).toBe(true);
  });
});

describe('the fixture directory', () => {
  test('every fixture loads', () => {
    expect(failures.map((f) => f.error.message)).toEqual([]);
  });

  test('there is at least one fixture, so a green stage means something', () => {
    // An empty directory satisfies every assertion in this file. The count is
    // not stated: `toBeGreaterThan(0)` is the property, and the number of
    // fixtures is derivable from the tree.
    expect(fixtures.length).toBeGreaterThan(0);
  });

  test('every fixture states a pin', () => {
    // STRATEGY section 3.2, loader rule 1. L-06 refuses one at load, so this
    // asserts the same thing from the other side: if the rule were ever
    // loosened, the loaded set would show it here rather than in a diff review.
    expect(fixtures.filter((f) => f.expected.pins.trim() === '')).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// The outcome assertions, whose polarity is READ OFF THE ENGINE
// -----------------------------------------------------------------------------
// TR-02 puts the fixture before the function on a money path: "the fixture
// exists, and FAILS, before the function does." packages/rules-engine currently
// ships the identity evaluation, so this stage asserts the failure rather than
// suffering it, and it does so without a per-fixture escape hatch. There is no
// `pending: true` a future session can reach for at 11pm, because the direction
// is not written in a fixture at all.
//
// WHEN M01 LANDS THIS FLIPS ON ITS OWN. No fixture is edited and no flag is
// removed; `engineIsIdentityStub()` stops holding and the same three fixtures
// become live assertions.

const named = (f: GoldenFixture): string => `${f.id} ${f.name}`;

describe.runIf(stubbed)('while the engine is the scaffold stub (TR-02)', () => {
  test('the stub is what is being asserted against, and that is derived rather than declared', () => {
    expect(stubbed).toBe(true);
  });

  test.each(fixtures.map((f) => [named(f), f] as [string, GoldenFixture]))(
    '%s does not yet match, because there is no engine to match',
    (_label, fixture) => {
      const { diffs } = runFixture(fixture);
      // A FIXTURE THAT MATCHES THE STUB IS THE FAILURE HERE. The stub returns
      // the state it was given and emits nothing, so a fixture it satisfies is
      // a fixture pinning nothing at all.
      expect(diffs.length).toBeGreaterThan(0);
    },
  );
});

describe.runIf(!stubbed)('against the real engine', () => {
  test.each(fixtures.map((f) => [named(f), f] as [string, GoldenFixture]))(
    '%s matches its expected end state',
    (_label, fixture) => {
      const { diffs } = runFixture(fixture);
      expect(diffs.map(describeDiff)).toEqual([]);
    },
  );
});

// -----------------------------------------------------------------------------
// What this stage does NOT cover, stated rather than implied
// -----------------------------------------------------------------------------
// The corpus runner's rule, applied here: a check that cannot verify the whole
// of what its row claims says so, and never returns green for something it did
// not look at.

// STATE HASHES ARE NOT COMPARED, and that is a decision rather than an
// omission. STRATEGY section 3.2 has the loader diff field by field "before
// comparing state hashes". A hash of the ENGINE's output can only be obtained
// by running the engine, which is the direction TR-01 forbids: a pin derived
// from the implementation proves only that the code agrees with itself. A hash
// of the FIXTURE's stated end state needs the full state shape, which is M01's.
// So the field-by-field diff is what runs, the expectation sibling has no
// `state_hash` key for a fixture to claim one through (L-04 refuses unknown
// keys), and the hash is an open item in the pull request rather than a line of
// dead code here.

describe('coverage this stage does not have', () => {
  test('it checks fixture to registry, and the reverse direction belongs to CI-06', () => {
    // STRATEGY section 3.2's loader rule 2 has two halves. This one holds: a
    // fixture whose id is not in the registry fails to load, which L-03 does
    // and which this asserts over the real set. The other half, a registry row
    // with no fixture, is the INVENTORY check and it is CI-06's; it cannot be
    // switched on until there is an engine to write expected end states
    // against, since today it would fail on every scenario the registry
    // defines. It arrives with P2.
    const registry = registryIds();
    expect(fixtures.filter((f) => !registry.has(f.id))).toEqual([]);
  });

  test('four fixture fields still reach no engine input, and they are named', () => {
    // GOLDEN_SCENARIOS section 2's format states them and the scaffold's engine
    // types declare none of them. The loader refuses any fixture field that is
    // neither mapped nor on this list, so nothing is dropped in silence; M01
    // empties it.
    expect([...AWAITING_ENGINE_INPUT]).toEqual([
      'account.phase',
      'account.opened_on',
      'days[].adjustment_cents',
      'settlements',
    ]);
  });
});
