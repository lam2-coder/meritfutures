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
// POLARITY IS NOW PER FIXTURE AND THE REPORT IS PER RULE GROUP (ADR-048). The
// superseded design read one global probe, so the block had one polarity to
// state. It now has one per fixture, derived from the rules each fixture cites
// against the set the engine declares, and the group breakdown is what makes
// the flip legible as it advances: ADR-048 asks for exactly this, "so the
// coverage block shows the flip advancing group by group".
//
// THREE THINGS THIS BLOCK IS FOR, unchanged from when it was written:
//
//   1. THE ASSERTION'S DIRECTION IS NOT WHAT THE STAGE NAME SUGGESTS. Under
//      inversion a fixture that MATCHES is the finding.
//   2. A CORRUPTED EXPECTED END STATE STILL PASSES WHERE POLARITY IS INVERTED.
//      Any expectation at all produces diffs against a fold that computes
//      nothing, so the stage is blind there to whether the expected end states
//      are the ones the corpus states. `corruptedExpectationStillPasses` PROVES
//      that by corrupting real loaded fixtures and re-running the stage's own
//      assertion. It is a measurement, and ADR-048's point about it is that it
//      "becomes false for those fixtures on its own" when a group flips.
//   3. THE END-TO-END ASSERTION MAY NOT BE RUNNING for some fixtures, and a
//      skip count in a summary line does not distinguish that from a stage with
//      nothing to skip.
//
// WHAT COVERS THE HOLE, NAMED SO THE READER CAN GO AND CHECK IT. The proof that
// the diff FAILS on a wrong expectation lives in ../test/compare.test.ts, made
// against hand-built states rather than against whatever the engine does today,
// which is why it is trustworthy while the fold is a stub. `mismatchProof`
// carries that path and the stage asserts the file exists, so the citation
// cannot rot into a reference to a file somebody deleted.
// =============================================================================

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { IMPLEMENTED_RULES } from '@merit/rules-engine';

import {
  loadFixtureDirectory,
  m01RuleGroups,
  registryIds,
  REPO_ROOT,
  type GoldenFixture,
} from './loader.js';
import {
  checkDeclarationAgainstFold,
  derivePolarity,
  type DeclarationCheck,
  type Derivation,
  type Polarity,
} from './polarity.js';
import { describeDiff } from './compare.js';
import { engineIsIdentityStub, runFixture } from './run.js';

/**
 * The engine's declaration, read once and passed down.
 *
 * THE WIRING LIVES HERE AND NOT IN polarity.ts, so the derivation stays a pure
 * function of a citation and a set. ADR-048 makes this export "part of its
 * public contract", and this is the one place in the loader that reads it.
 */
export const DECLARED_RULES: ReadonlySet<string> = new Set(IMPLEMENTED_RULES);

/** Where the assertion that a wrong expectation FAILS actually lives. */
const MISMATCH_PROOF = 'packages/golden-loader/test/compare.test.ts';

/** One fixture, its derived polarity, and whether the stage's rule holds over it. */
export interface FixturePolarity {
  readonly id: string;
  readonly derivation: Derivation;
  /** `true` when the stage's own outcome rule is satisfied for this fixture. */
  readonly holds: boolean;
  /**
   * WHY IT DID NOT HOLD, WHICH THE DERIVATION DOES NOT SAY.
   *
   * `derivation.because` answers "why is this fixture asserted in this
   * direction" and the report printed it beside every failure, so a reader was
   * told the engine declares every rule the fixture cites and nothing about the
   * field that disagreed. While the fold was the identity that was the whole
   * truth available; folding for real makes it a summary that names the wrong
   * thing. Empty when the fixture holds.
   */
  readonly failure: readonly string[];
  /** The day a refusal stopped the fold, or `null`. A refusal is not a field diff. */
  readonly refusedOn: string | null;
}

/** One M01 rule group, and how far the flip has advanced through it. */
export interface GroupPolarity {
  readonly group: string;
  readonly fixtures: number;
  readonly direct: number;
  readonly inverted: number;
}

export interface StageCoverage {
  /** Per fixture, because ADR-048 made polarity a per-fixture property. */
  readonly polarities: readonly FixturePolarity[];
  /** ADR-048: "coverage.ts reports polarity per rule group." */
  readonly byGroup: readonly GroupPolarity[];
  /**
   * The declaration checked against the FOLD, before any fixture is consulted.
   *
   * When this does not hold, every number below it describes a derivation
   * running on a premise that is false, and the report says so first.
   */
  readonly declaration: DeclarationCheck;
  /**
   * `false` while the derivation is REPORTED rather than enforced, which is
   * exactly while `declaration` does not hold.
   *
   * NO RULING SITS BEHIND THIS AND EARLIER COMMENTS SAID ONE DID. Two lines in
   * this file attributed the deferral to a "founder ruling, 2026-08-17"; no such
   * ruling exists, in `docs/` or anywhere else, and ADR-048 does not mention
   * enforcement being deferred. NOTHING WAS WRONG WITH THE BEHAVIOUR: it needs no
   * ruling, because it is a tautology rather than a decision. A derived direction
   * cannot be enforced against a fold that reaches none of the rules a fixture
   * cites. The citation was the defect, and a merge-blocking stage citing an
   * authority that does not exist is worse than one citing none.
   *
   * IT IS DERIVED, NOT SET. There is no switch a session can flip: the stage
   * starts enforcing the derived direction the moment the folded function runs
   * the rules the declaration describes.
   */
  readonly enforced: boolean;
  /** Fixtures that loaded out of `packages/rules-engine/fixtures`. */
  readonly fixtures: number;
  /** Fixture files that did not load at all. */
  readonly loadFailures: number;
  /** Scenarios GOLDEN_SCENARIOS.md defines, which is what the stage is a fraction of. */
  readonly registryScenarios: number;
  /** Fixtures whose polarity derives `direct`. A live end-to-end assertion runs on them only while `enforced`. */
  readonly endToEndRunning: number;
  /**
   * MEASURED, NOT ASSERTED, AND AGAINST THE ASSERTION THAT ACTUALLY RUNS.
   *
   * Each fixture is re-run with every pinned value changed and its event list
   * extended, and this counts those the RUNNING assertion still held over. That
   * is the derived direction while `enforced`, and "must fail" for every
   * fixture while it is not, because that is what the stage is asserting then.
   * Measuring against a direction nobody is enforcing would report a stage
   * other than the one that just ran. ADR-048: it "becomes false for those
   * fixtures on its own" as groups flip, with nobody remembering to update it.
   */
  readonly corruptedExpectationStillPasses: number;
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
 * ../test/fixtures.golden.test.ts applies exactly this, per fixture, with the
 * polarity derived by the same call.
 */
export function stageAssertionHolds(fixture: GoldenFixture, polarity: Polarity): boolean {
  const { diffs } = runFixture(fixture);
  return polarity === 'direct' ? diffs.length === 0 : diffs.length > 0;
}

/** Roll the per-fixture derivations up into M01's eight rule groups. */
function groupPolarities(polarities: readonly FixturePolarity[]): GroupPolarity[] {
  const groupOf = m01RuleGroups();

  // Every group M01 states, INCLUDING THE ONES NO FIXTURE CITES YET, and in
  // M01's own order. A report listing only the groups with fixtures would
  // silently shrink to the work already done, which is the direction a coverage
  // statement must never drift in: the empty rows are the ones that say how far
  // there is to go.
  const rows = new Map<string, { fixtures: number; direct: number; inverted: number }>();
  for (const group of groupOf.values()) {
    if (!rows.has(group)) rows.set(group, { fixtures: 0, direct: 0, inverted: 0 });
  }

  for (const { derivation } of polarities) {
    // A fixture citing rules from three groups counts once in each, because the
    // question the row answers is "has this group flipped", and a fixture is
    // evidence about every group it touches.
    const touched = new Set(
      derivation.cited.map((id) => groupOf.get(id)).filter((g): g is string => g !== undefined),
    );
    for (const group of touched) {
      const row = rows.get(group);
      if (row === undefined) continue;
      row.fixtures++;
      if (derivation.polarity === 'direct') row.direct++;
      else row.inverted++;
    }
  }

  return [...rows].map(([group, row]) => ({ group, ...row }));
}

/** Measure what CI-03 proves right now, against the real fixture directory. */
export function stageCoverage(): StageCoverage {
  const { fixtures, failures } = loadFixtureDirectory();

  const declaration = checkDeclarationAgainstFold({
    foldIsIdentity: engineIsIdentityStub(),
    declaredRules: DECLARED_RULES.size,
  });

  const polarities: FixturePolarity[] = fixtures.map((fixture) => {
    const derivation = derivePolarity(fixture.source, DECLARED_RULES);
    const outcome = runFixture(fixture);
    const holds =
      derivation.polarity === 'direct' ? outcome.diffs.length === 0 : outcome.diffs.length > 0;

    return {
      id: fixture.id,
      derivation,
      holds,
      // A REFUSAL IS REPORTED AS A REFUSAL RATHER THAN AS EIGHT FIELD DIFFS. A
      // day the fold declined to write leaves every later field at the value it
      // had before, so the diff list reads as eight independent wrong numbers
      // when there is one cause and it is upstream of all of them.
      refusedOn: outcome.refusedOn,
      failure: holds
        ? []
        : [
            ...outcome.assertions.map((a) => `${a.tradingDay} ${a.kind}: ${a.detail}`),
            ...outcome.diffs.map(describeDiff),
          ],
    };
  });

  // THE DIRECTION THE STAGE IS ACTUALLY ASSERTING. While the declaration does
  // not reach the fold, the derived direction is reported and the standing
  // TR-02 assertion runs instead, so every fixture is effectively inverted.
  const running = (i: number): Polarity =>
    declaration.holds ? (polarities[i]?.derivation.polarity ?? 'inverted') : 'inverted';

  return {
    polarities,
    enforced: declaration.holds,
    byGroup: groupPolarities(polarities),
    declaration,
    fixtures: fixtures.length,
    loadFailures: failures.length,
    registryScenarios: registryIds().size,
    endToEndRunning: polarities.filter((p) => p.derivation.polarity === 'direct').length,
    // COUNTED OVER THE INVERTED FIXTURES ONLY, because that is the set the
    // claim is about: an inverted fixture passes whatever its expectation says,
    // so the stage is blind to those expectations. A direct fixture is not
    // blind, and folding it into the same number would make the number mean
    // nothing as soon as the two kinds coexist, which they now do.
    corruptedExpectationStillPasses: fixtures.filter((f, i) =>
      stageAssertionHolds(corrupt(f), running(i)),
    ).length,
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
    polarities,
    byGroup,
    declaration,
    enforced,
    fixtures,
    loadFailures,
    registryScenarios,
    endToEndRunning,
    corruptedExpectationStillPasses,
    mismatchProof,
  } = coverage;

  const inverted = fixtures - endToEndRunning;
  const lines = ['### CI-03 golden files: what this green check proves', ''];

  // THE DECLARATION CHECK COMES FIRST BECAUSE IT INVALIDATES THE REST. Every
  // number below is derived from the engine's declared rule set, so a
  // declaration the fold does not honour makes them describe a premise rather
  // than a stage.
  if (!declaration.holds) {
    lines.push(
      '**THE DERIVATION IS RUNNING ON A PREMISE THAT DOES NOT HOLD, and every number below ' +
        'inherits it.**',
      '',
      ...declaration.findings.map((f) => `- ${f}`),
      '',
    );
  }

  lines.push(
    `**Polarity is per fixture (ADR-048): ${endToEndRunning} derive direct, ${inverted} derive ` +
      'inverted.** A direct fixture must MATCH. An inverted one must FAIL, and a match is the ' +
      'finding, because a fixture satisfied by an engine that has not implemented its rules is ' +
      'a fixture pinning nothing. No fixture states its own direction and none can: the ' +
      'direction is read off the rules it cites against the set the engine declares.',
    '',
    enforced
      ? '**The derived direction is ENFORCED.** Each fixture is asserted in the direction its ' +
          'citation derives.'
      : '**The derived direction is REPORTED AND NOT ENFORCED**, ' +
          'because the fold reaches none of the rules these fixtures cite. ' +
          'because the premise above does not hold. What runs instead is the standing TR-02 ' +
          'assertion: every fixture must FAIL against a fold that computes nothing, and a fixture ' +
          'that matches is the finding. **Nothing is edited to move between the two.** The derived ' +
          'assertion starts, and this one stops, the moment the folded function runs the rules the ' +
          'declaration describes.',
    '',
    '| Rule group | Fixtures citing it | direct | inverted |',
    '|---|---|---|---|',
    ...byGroup.map((g) => `| ${g.group} | ${g.fixtures} | ${g.direct} | ${g.inverted} |`),
    '',
    `**Proved:** ${fixtures} fixture(s) load and parse within the YAML subset, with ` +
      `${loadFailures} load failure(s); every loaded id is one of the ` +
      `${registryScenarios} scenarios GOLDEN_SCENARIOS.md defines; every fixture states a pin ` +
      "and a citation that resolves in M01 (L-13); the engine's public entry point is " +
      'reachable and folds each day stream.',
    '',
    '**NOT proved, and this is the half the check name hides:**',
    '',
  );

  if (corruptedExpectationStillPasses > 0) {
    lines.push(
      `- **A corrupted expected end state still passes for ${corruptedExpectationStillPasses} ` +
        `of ${fixtures} fixture(s).** Measured against the assertion that ACTUALLY RUNS, not ` +
        'assumed: each was re-run with every pinned value changed and its event list extended, ' +
        'and the assertion still held. **For those fixtures this stage is blind to whether the ' +
        'expected end states are the ones the corpus states.** It stops being blind for a group ' +
        'the moment that group is both flipped and enforced, with nothing edited.',
    );
  } else {
    lines.push(
      '- A corrupted expected end state is caught on every fixture: the corruption probe was ' +
        're-run over each of them and the stage assertion failed on it, which is what the ' +
        'stage name means.',
    );
  }

  lines.push(
    !enforced
      ? `- **The end-to-end assertion is live for 0 of ${fixtures} fixture(s).** ` +
          `${endToEndRunning} derive direct and would be live if the derivation were enforced; ` +
          'none is, while the premise above does not hold.'
      : endToEndRunning === fixtures
        ? '- The end-to-end assertion is RUNNING for every fixture.'
        : `- **The end-to-end assertion is live for ${endToEndRunning} of ${fixtures} ` +
          'fixture(s).** The rest are inverted and assert only that they do not match, which a ' +
          'summary line does not distinguish from a passing golden file.',
    `- **The proof that a wrong expectation FAILS is not here.** It is \`${mismatchProof}\`, ` +
      'made against hand-built states rather than against whatever the engine does today, ' +
      'which is why it is trustworthy while the fold is a stub.',
    `- **Coverage of the registry is ${fixtures} of ${registryScenarios}.** The rest arrive ` +
      'with P2, because an expected end state written against a stub would be derived from ' +
      "nothing. The inventory check for a registry row with no fixture is CI-06's and is " +
      'not switched on.',
    '',
  );

  const notHolding = polarities.filter((p) => !p.holds);
  if (notHolding.length > 0) {
    lines.push(
      enforced
        ? `**${notHolding.length} of ${fixtures} fixture(s) FAIL, and this stage is red until ` +
            'each is resolved.** A fixture is never edited to make it pass: a fixture edited to ' +
            'match an engine proves only that the code agrees with itself (TR-01).'
        : `**${notHolding.length} of ${fixtures} fixture(s) would FAIL if the derived direction ` +
            'were enforced today**, which is what the ruling above defers:',
      '',
    );
    for (const p of notHolding) {
      lines.push(`- **${p.id}** derives ${p.derivation.polarity}, because ${p.derivation.because}`);
      // THE REASON IT FAILED, NOT ONLY THE REASON IT WAS ASSERTED. Both are
      // needed and only the second used to be printed, which told a reader the
      // fixture's citation resolves and nothing about the number that moved.
      for (const line of p.failure) lines.push(`  - ${line}`);
    }
    lines.push('');
  }

  lines.push(
    'Every number and every claim above is re-derived on each run. As each rule group lands, ' +
      'the fixtures citing it flip on their own, with no fixture edited and no flag removed.',
  );

  return lines.join('\n');
}
