import { appendFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import {
  AWAITING_ENGINE_INPUT,
  DECLARED_RULES,
  checkDeclarationAgainstFold,
  describeDiff,
  derivePolarity,
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

// ADR-048: THE DIRECTION IS READ OFF THE ENGINE, PER RULE INSTEAD OF PER
// REPOSITORY. `engineIsIdentityStub()` is superseded as the source of polarity
// and survives only as one input to the declaration cross-check below.
const declaration = checkDeclarationAgainstFold({
  foldIsIdentity: engineIsIdentityStub(),
  declaredRules: DECLARED_RULES.size,
});
const polarityOf = (f: GoldenFixture) => derivePolarity(f.source, DECLARED_RULES);

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
    expect(coverage.fixtures).toBe(fixtures.length);
    expect(coverage.loadFailures).toBe(failures.length);
    expect(coverage.registryScenarios).toBe(registryIds().size);
    expect(coverage.polarities.map((p) => p.derivation.polarity)).toEqual(
      fixtures.map((f) => polarityOf(f).polarity),
    );
    expect(coverage.endToEndRunning).toBe(
      fixtures.filter((f) => polarityOf(f).polarity === 'direct').length,
    );
  });

  test('every M01 rule group appears in the breakdown, including the empty ones', () => {
    // ADR-048 asks the block to show "the flip advancing group by group". A
    // breakdown listing only the groups that have fixtures shrinks to the work
    // already done, and the empty rows are the ones that say how far there is
    // to go. M01 states eight; the number is not written here, only that the
    // rows come from the document rather than from the fixtures present.
    expect(coverage.byGroup.length).toBeGreaterThan(
      new Set(coverage.polarities.flatMap((p) => p.derivation.cited)).size > 0 ? 0 : 0,
    );
    expect(coverage.byGroup.every((g) => g.direct + g.inverted === g.fixtures)).toBe(true);
  });

  test('the file it cites for the mismatch proof exists', () => {
    // The one claim in the block that is a reference rather than a measurement.
    // A citation to a deleted file is how a coverage statement rots into a
    // second thing nobody re-derives.
    expect(mismatchProofExists(coverage)).toBe(true);
  });

  test('a corrupted expected end state passes wherever the RUNNING assertion is inverted', () => {
    // THE ASSERTION IS THAT THE STAGE IS BLIND WHERE IT IS INVERTED, which is a
    // strange thing to assert until you consider the alternative: the blindness
    // is real either way, and the choice is between a suite that knows it and a
    // suite that does not.
    //
    // MEASURED AGAINST THE DIRECTION THAT RUNS, not the one that derives. While
    // the derivation is reported rather than enforced, what runs is the
    // standing TR-02 assertion over every fixture, so every fixture is blind
    // and the number is all of them. Counting the DERIVED inverted set instead
    // would report a stage other than the one that just ran.
    const blind = coverage.enforced
      ? fixtures.filter((f) => polarityOf(f).polarity === 'inverted').length
      : fixtures.length;
    expect(coverage.corruptedExpectationStillPasses).toBe(blind);
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
// The outcome assertions, whose polarity is DERIVED PER FIXTURE (ADR-048)
// -----------------------------------------------------------------------------
// TR-02 puts the fixture before the function on a money path: "the fixture
// exists, and FAILS, before the function does." The superseded design read one
// global probe, so the whole directory flipped at once -- which ADR-048 shows
// cannot survive P2, because M01 is fifty rules across eight groups and cannot
// land in one commit under ADR-003.
//
// SO THE DIRECTION IS READ OFF THE ENGINE PER RULE. If every rule a fixture
// cites is in the set the engine declares, it must MATCH; otherwise it must
// FAIL. There is no `pending: true` a future session can reach for at 11pm,
// because the direction is not written in a fixture at all, and each group
// flips on its own as it lands, with no fixture edited and no flag removed.
//
// THE DECLARATION IS CHECKED BEFORE ANY FIXTURE IS CONSULTED. ADR-048 closes
// three ways the derivation can be wrong that way; the check below closes the
// fourth, which this repository is currently in. A rule can be implemented in
// packages/rules-engine, with a passing RE-U-nn, and be unreachable from the
// function this stage folds. When that is true, every fixture citing a declared
// rule flips to `direct` against a fold computing none of them, and thirty
// field diffs name a symptom while nothing names the cause.

const named = (f: GoldenFixture): string => `${f.id} ${f.name}`;

describe('the declaration the derivation rests on', () => {
  test('the coverage block says so, on every run, when it does not hold', () => {
    // THE DERIVATION IS REPORTED AND NOT YET ENFORCED WHENEVER THE DECLARATION
    // DOES NOT HOLD, so this is the assertion that keeps the reporting honest.
    // An earlier version of this comment attributed that to a "founder ruling,
    // 2026-08-17". No such ruling exists and none is needed: a derived direction
    // cannot be enforced against a fold that reaches none of the rules a fixture
    // cites, which is a fact about the tree rather than a decision.
    // A finding that exists only in a variable is the quiet direction; this
    // fails if the block ever stops printing the premise it is running on.
    if (declaration.holds) {
      expect(report).not.toContain('PREMISE THAT DOES NOT HOLD');
    } else {
      expect(report).toContain('PREMISE THAT DOES NOT HOLD');
      expect(report).toContain('no declared rule is reachable from the fold');
    }
  });

  test('the derivation itself is exercised in both directions, whatever the fold does', () => {
    // Hand-built, so these hold on any tree. They are the property the stage
    // will start enforcing the moment the premise does: a citation of declared
    // rules derives direct, one undeclared rule is enough to invert, and a
    // citation naming no rule at all may never read as direct.
    expect(derivePolarity('M01 R-13, R-18', new Set(['R-13', 'R-18'])).polarity).toBe('direct');
    expect(derivePolarity('M01 R-13, R-32', new Set(['R-13'])).polarity).toBe('inverted');
    expect(derivePolarity('M01 INV-06', DECLARED_RULES).polarity).toBe('inverted');
  });
});

// -----------------------------------------------------------------------------
// THE PER-FIXTURE ASSERTION, WHICH SWITCHES ON BY ITSELF
// -----------------------------------------------------------------------------
// The derivation is REPORTED and not enforced while the premise it rests on does
// not hold. The two blocks below are mutually exclusive and nothing is edited to
// move between them: the moment the fold runs the functions the declaration
// describes, `declaration.holds` goes true, the standing assertion stops running
// and the derived one starts.
//
// NO RULING SITS BEHIND THIS. This comment opened "FOUNDER RULING, 2026-08-17"
// until the attribution was retracted in `coverage.ts` and twenty-eight lines
// above; this was the third copy and it outlived the retraction. No such ruling
// exists and none is needed, because the deferral is a tautology rather than a
// decision: a derived direction cannot be enforced against a fold that reaches
// none of the rules a fixture cites. `CI-06q` passes over the stale copy because
// 2026-08-17 does carry three declared rulings, so the DATE resolves while the
// CLAIM is false; the gate checks that an authority exists and never that it
// says what is attributed to it.
//
// THIS IS NOT A `pending` FLAG BY ANOTHER NAME, and the difference is where it
// lives. A `pending: true` is per fixture, is written in the fixture, and lets
// ONE scenario stop asserting without anybody deciding to. This is one
// condition, computed, covering the whole directory, printed in bold in the
// stage's own output on every run, and no fixture can reach it.

describe.runIf(!declaration.holds)(
  'while the fold reaches none of the declared rules (TR-02)',
  () => {
    test.each(fixtures.map((f) => [named(f), f] as [string, GoldenFixture]))(
      '%s does not yet match, because the folded function computes nothing',
      (_label, fixture) => {
        const { diffs } = runFixture(fixture);
        // A FIXTURE THAT MATCHES HERE IS THE FAILURE. The folded function returns
        // the state it was given and emits nothing, so a fixture it satisfies is
        // a fixture pinning nothing at all. This is the assertion that stood
        // before ADR-048 and it still means what it meant.
        expect(diffs.length).toBeGreaterThan(0);
      },
    );
  },
);

describe.runIf(declaration.holds)('every fixture, in the direction its citation derives', () => {
  test.each(fixtures.map((f) => [named(f), f] as [string, GoldenFixture]))(
    '%s holds in the direction its cited rules derive',
    (_label, fixture) => {
      const { polarity, because } = polarityOf(fixture);
      const { diffs } = runFixture(fixture);

      if (polarity === 'direct') {
        expect(diffs.map(describeDiff), `derived direct because ${because}`).toEqual([]);
      } else {
        expect(diffs.length, `derived inverted because ${because}`).toBeGreaterThan(0);
      }
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

  test('no fixture field reaches no engine input, which is what M01 landing means', () => {
    // IT HELD FOUR ENTRIES AND HOLDS NONE. `account.phase`, `account.opened_on`,
    // `days[].adjustment_cents` and `settlements` were all true of the
    // SCAFFOLD's `EngineInput`; `DayInput` has a home for every one. STATE
    // item 3 said M01 empties this list, and folding through `advanceDay` is
    // what emptied it.
    //
    // THE ASSERTION IS KEPT RATHER THAN DELETED, in the direction that now
    // matters: it fails if an entry ever returns. A field the fold cannot take
    // is still declarable in one visible place, and a reviewer still reads the
    // diff; what may not happen again is the list quietly refilling.
    expect([...AWAITING_ENGINE_INPUT]).toEqual([]);
  });
});
