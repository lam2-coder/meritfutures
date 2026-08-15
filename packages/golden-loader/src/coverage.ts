// =============================================================================
// packages/golden-loader/src/coverage.ts
// =============================================================================
// WHAT CI-03 CURRENTLY PROVES, COMPUTED RATHER THAN CLAIMED.
//
// A green check that means something narrower than its name is this
// repository's most repeated defect. It is the same shape as the count drift
// ADR-034 ended: a sentence that was true when somebody wrote it, in a place
// nothing re-derives. STRATEGY section 4.4 already answers it for the corpus
// runner, where "each gate declares what it does NOT cover, in a `covers` line
// the `list` command prints". THIS FILE IS THAT LINE FOR CI-03, and it is
// stronger than a `covers` string in one specific way: the load-bearing claims
// below are RUN, not written.
//
// THE STAGE IT DESCRIBES IS CURRENTLY INVERTED, and that is the fact a reader
// of a green check needs and does not get from the check's name.
// packages/rules-engine ships the scaffold's identity evaluation, so TR-02 puts
// every fixture in the window where it MUST FAIL, and ../test/
// fixtures.golden.test.ts asserts that failure instead of suffering it. Three
// consequences follow that "CI-03 golden files: pass" does not convey:
//
//   1. THE ASSERTION IS `diffs.length > 0`. A fixture that MATCHES is the
//      finding, which is the opposite of what the stage's name means.
//   2. A CORRUPTED EXPECTED END STATE THEREFORE STILL PASSES. Under the
//      inverted polarity any expectation at all produces diffs, so the stage is
//      blind to whether the expected end states are the ones the corpus states.
//      `corruptedExpectationStillPasses` below PROVES that by corrupting a real
//      loaded fixture and re-running the stage's own assertion over it. It is a
//      measurement of the stage, not a sentence about it, and it flips to
//      `false` on its own the day M01 lands.
//   3. THE END-TO-END ASSERTION IS NOT RUNNING. It sits behind
//      `describe.runIf(!stubbed)` and reports as "3 skipped" in a summary line
//      nobody reads as a coverage statement.
//
// WHAT COVERS THE HOLE, NAMED SO THE READER CAN GO AND CHECK IT. The proof that
// the diff FAILS on a wrong expectation lives in ../test/compare.test.ts, made
// against hand-built states rather than against whatever the engine does today,
// which is why it is trustworthy while the engine is a stub. `mismatchProof`
// carries that path and the stage asserts the file exists, so the citation
// cannot rot into a reference to a file somebody deleted.
// =============================================================================

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { loadFixtureDirectory, registryIds, REPO_ROOT, type GoldenFixture } from './loader.js';
import { engineIsIdentityStub, runFixture } from './run.js';

/** Where the assertion that a wrong expectation FAILS actually lives. */
const MISMATCH_PROOF = 'packages/golden-loader/test/compare.test.ts';

export interface StageCoverage {
  /**
   * `inverted` while the engine is the scaffold stub: a fixture that MATCHES is
   * the finding. `direct` once M01 lands and the stage means what its name says.
   */
  readonly polarity: 'inverted' | 'direct';
  /** Fixtures that loaded out of `packages/rules-engine/fixtures`. */
  readonly fixtures: number;
  /** Fixture files that did not load at all. */
  readonly loadFailures: number;
  /** Scenarios GOLDEN_SCENARIOS.md defines, which is what the stage is a fraction of. */
  readonly registryScenarios: number;
  /** `false` while the `describe.runIf(!stubbed)` block is skipped entirely. */
  readonly endToEndRunning: boolean;
  /**
   * MEASURED, NOT ASSERTED. Every loaded fixture is re-run with its expected end
   * state deliberately corrupted, and this is `true` when the stage's own
   * assertion still holds over all of them.
   */
  readonly corruptedExpectationStillPasses: boolean;
  /** The file carrying the assertion that a wrong expectation fails. */
  readonly mismatchProof: string;
}

/**
 * Corrupt every value an expectation pins, so no corrupted field can be right.
 *
 * The point is not to be clever about the corruption: it is that ANY change to
 * a pinned value must be visible to a stage whose name is "golden files". A
 * stage that cannot tell this fixture from the real one is a stage that is not
 * checking expectations at all, whatever its check says.
 */
function corrupt(fixture: GoldenFixture): GoldenFixture {
  const wrecked: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(fixture.expected.end_state)) {
    if (typeof value === 'number') wrecked[field] = value + 1;
    else if (typeof value === 'boolean') wrecked[field] = !value;
    else wrecked[field] = `${String(value)}-corrupted`;
  }
  return {
    ...fixture,
    expected: {
      ...fixture.expected,
      end_state: wrecked,
      events: [...fixture.expected.events, 'never.emitted'],
    },
  };
}

/**
 * The stage's own outcome rule, in one place so the report cannot describe a
 * different stage than the one that runs.
 *
 * ../test/fixtures.golden.test.ts asserts `diffs.length > 0` under the stub and
 * `diffs` empty against the real engine. Both branches are here, and the report
 * derives its polarity from the same probe the test does.
 */
function stageAssertionHolds(fixture: GoldenFixture, stubbed: boolean): boolean {
  const { diffs } = runFixture(fixture);
  return stubbed ? diffs.length > 0 : diffs.length === 0;
}

/** Measure what CI-03 proves right now, against the real fixture directory. */
export function stageCoverage(): StageCoverage {
  const { fixtures, failures } = loadFixtureDirectory();
  const stubbed = engineIsIdentityStub();

  return {
    polarity: stubbed ? 'inverted' : 'direct',
    fixtures: fixtures.length,
    loadFailures: failures.length,
    registryScenarios: registryIds().size,
    endToEndRunning: !stubbed,
    // `every` rather than `some`: the claim is that the stage is blind to a
    // corrupted expectation, and one fixture the corruption did reach would
    // make the claim false.
    corruptedExpectationStillPasses:
      fixtures.length > 0 && fixtures.every((f) => stageAssertionHolds(corrupt(f), stubbed)),
    mismatchProof: MISMATCH_PROOF,
  };
}

/** `true` when the file the report cites still exists. */
export function mismatchProofExists(coverage: StageCoverage): boolean {
  return existsSync(join(REPO_ROOT, coverage.mismatchProof));
}

/**
 * Render the coverage statement for the stage's own output.
 *
 * It is Markdown because it is written to the job log AND to
 * `$GITHUB_STEP_SUMMARY`, where a reader who never opens the log still sees it.
 * "Not only in a PR body" is the requirement: a PR body is written once by
 * whoever landed the stage, and this is regenerated by every run.
 */
export function renderStageCoverage(coverage: StageCoverage): string {
  const {
    polarity,
    fixtures,
    loadFailures,
    registryScenarios,
    endToEndRunning,
    corruptedExpectationStillPasses,
    mismatchProof,
  } = coverage;

  const lines = [
    '### CI-03 golden files: what this green check proves',
    '',
    `Polarity **${polarity}**. ` +
      (polarity === 'inverted'
        ? 'packages/rules-engine is the scaffold identity stub, so TR-02 puts every ' +
          'fixture in the window where it must FAIL and the stage asserts that failure. ' +
          '**A fixture that matches is the finding, which is the opposite of what this ' +
          "stage's name means.**"
        : 'M01 has landed, the probe no longer holds, and every fixture is a live ' +
          'assertion that the engine reproduces the expected end state.'),
    '',
    `**Proved:** ${fixtures} fixture(s) load and parse within the YAML subset, with ` +
      `${loadFailures} load failure(s); every loaded id is one of the ` +
      `${registryScenarios} scenarios GOLDEN_SCENARIOS.md defines; every fixture states a pin; ` +
      `the engine's public entry point is reachable and folds each day stream.`,
    '',
    '**NOT proved, and this is the half the check name hides:**',
    '',
  ];

  if (corruptedExpectationStillPasses) {
    lines.push(
      '- **A corrupted expected end state still passes this stage.** Measured, not assumed: ' +
        'every loaded fixture was re-run with each pinned value changed and each event list ' +
        'extended, and the stage assertion still held on all of them. **So this stage is ' +
        'currently blind to whether the expected end states are the ones the corpus states.**',
    );
  } else {
    lines.push(
      '- A corrupted expected end state is caught: the corruption probe was re-run over ' +
        'every loaded fixture and the stage assertion failed on it, which is what the ' +
        'stage name means.',
    );
  }

  lines.push(
    endToEndRunning
      ? '- The end-to-end assertion is RUNNING.'
      : '- **The end-to-end assertion is not running at all.** It sits behind ' +
          '`describe.runIf(!stubbed)` and reports as skipped, which a summary line does ' +
          'not distinguish from a stage with nothing to skip.',
    `- **The proof that a wrong expectation FAILS is not here.** It is \`${mismatchProof}\`, ` +
      'made against hand-built states rather than against whatever the engine does today, ' +
      'which is why it is trustworthy while the engine is a stub.',
    `- **Coverage of the registry is ${fixtures} of ${registryScenarios}.** The rest arrive ` +
      'with P2, because an expected end state written against a stub would be derived from ' +
      "nothing. The inventory check for a registry row with no fixture is CI-06's and is " +
      'not switched on.',
    '',
    'Every number and every claim above is re-derived on each run. When M01 lands, the probe ' +
      'stops holding and this block changes with it, with no fixture edited and no flag removed.',
  );

  return lines.join('\n');
}
