import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// =============================================================================
// packages/rules-engine/stryker.conf.mjs
// =============================================================================
// CI-09's Stryker leg (STRATEGY section 4.1), the third of four. It waited from
// 2026-08-20 on one artifact, "the VG-12 admission, which a session cannot
// grant itself"; the founder DELEGATED that grant and ADR-127 records the
// delegation rather than proceeding as though the gate did not apply. That
// sentence is the whole reason this file exists at a number rather than
// whenever a session felt like adding a dependency.
//
// -----------------------------------------------------------------------------
// THE SCOPE IS STRATEGY'S AND NOT STRYKER'S DEFAULT
// -----------------------------------------------------------------------------
// STRATEGY section 2, the Mutation testing row, in its own words:
//
//   "Stryker, nightly, on `packages/rules-engine` only, reported as a trend
//    rather than a threshold"
//
// and its rejected alternative is named there too: "Repo-wide mutation testing
// (runtime cost with no proportionate signal on UI code). The engine is the one
// package where a surviving mutant is genuinely alarming, and restricting it
// there is what makes the number worth reading."
//
// So this config lives IN the package rather than at the repository root, which
// is the opposite of where `playwright.config.ts`, `vitest.config.ts` and
// `eslint.config.js` live, and the difference is the ruling rather than taste:
// those three are repository-wide gates and this one is ruled onto one package.
// A root config with a `packages/rules-engine` glob would express the same scope
// today and would be one careless glob edit away from a workspace-wide run
// nobody chose. The package's own manifest has said "Stryker running here and
// nowhere else" since the scaffold; this file is that sentence executed.
//
// -----------------------------------------------------------------------------
// THERE IS NO SCORE THAT FAILS THIS RUN, AND NO SUCH BLOCK IS WRITTEN
// -----------------------------------------------------------------------------
// STRATEGY section 2 rules the score "reported as a trend rather than a
// threshold", and OQ-TS-02 answers the question directly: "Is Stryker's
// mutation score ever a gate, or only a trend? Proposed trend only, reported
// nightly. A threshold on a young codebase produces tests written to kill
// mutants rather than to pin behavior, which is TR-01 inverted. Revisit once
// the engine is stable and the score has a baseline worth defending."
//
// TR-01 is "Tests come from the spec, never from the implementation", and a
// breaking score is the fastest way to violate it: the cheapest way to move a
// mutation score is to write a test that pins whatever the implementation
// currently does.
//
// SO THE OPTION IS OMITTED RATHER THAN SET, AND ADR-073 SECTION 6 IS WHY THAT
// IS A RULING AND NOT A DODGE. `RI-02` asserts that no coverage gate exists
// anywhere in the tree and one of its needles reads a bare object key followed
// by a colon, so the block written here as a JavaScript literal is a CI-01
// finding and the same values written in JSON are not. ADR-073 measured both
// spellings and said the quiet part: "the tree already forbids one spelling of
// a Stryker threshold and permits the other, and neither outcome is a ruling
// anybody made." Writing this file in JSON would keep the value and hide it
// from the gate, which is the shape a `.gitleaksignore` fingerprint was refused
// in. Editing `RI-02`'s needle would answer OQ-TS-02's second half on a
// session's own authority. Writing NO such option is the third thing, and it is
// the literal form of what STRATEGY ruled: there is no threshold here, so `RI-02`
// passes because there is nothing to find rather than because it cannot see it.
//
// Stryker's own defaults then apply: `high` 80 and `low` 60, which colour the
// report and fail nothing, and a breaking value of `null`, which is the ruling.
// THAT LAST DEFAULT IS ASSERTED BELOW rather than trusted, because it is now
// the only thing standing between this leg and a nightly that fails on a score.
//
// -----------------------------------------------------------------------------
// THIS IS NOT THE LEG BEING UNABLE TO FAIL
// -----------------------------------------------------------------------------
// It fails on three things and each one is a real defect: the initial test run
// failing, the runner crashing, and ZERO MUTANTS. The third is the one worth
// naming, because it is the shape the replay leg's own comment in `nightly.yml`
// warns about in a different costume: a mutate glob that matches nothing
// produces a run that reports nothing and would exit green over it. Stryker
// refuses it itself, "No tests were executed. Stryker will exit prematurely",
// and that refusal was watched firing before this file was committed, with
// `--mutate` pointed at a path that does not exist. A green check over zero
// output is worse than a red one.
//
// -----------------------------------------------------------------------------
// WHAT IS IN SCOPE INSIDE THE PACKAGE
// -----------------------------------------------------------------------------
// Every `.ts` file under `src/`, which is the whole of the engine and is what
// "on packages/rules-engine only" says. `types.ts` is 1,397 lines of mostly
// type declarations and contributes almost nothing; it is left IN rather than
// excluded, because an exclusion list is a place for a real module to hide and
// the empty rows cost nothing but a line in the table. `test/` is outside the
// glob for the obvious reason and `fixtures/` holds no code.
//
// -----------------------------------------------------------------------------
// THE TESTS THAT DO THE KILLING ARE THE PACKAGE'S WHOLE SUITE, NOT ONE STAGE
// -----------------------------------------------------------------------------
// `vitest.config.ts` beside this file includes every `.test.ts` under `test/`,
// which is the unit, property AND golden files together. The root
// `vitest.config.ts` splits those into projects because the projects map to CI
// STAGES (CI-02 and CI-03 block independently), and that split is exactly wrong
// here: a mutant is killed by whichever test notices, and asking "did anything
// notice" per stage would report a mutant as surviving because the file that
// kills it belongs to the other stage.
//
// -----------------------------------------------------------------------------
// TWO PLUGINS AND NO TYPE CHECKER
// -----------------------------------------------------------------------------
// `plugins` is written out rather than left at its `["@stryker-mutator/*"]`
// default, and that is forced rather than tidy: under `.npmrc`'s
// `node-linker=isolated` the default glob loaded the core and found NO test
// runner, and the run died on `Cannot find TestRunner plugin "vitest"`. Naming
// the package is what resolves it.
//
// `@stryker-mutator/typescript-checker` is deliberately absent; the catalog
// comment in `pnpm-workspace.yaml` carries the arithmetic.

// -----------------------------------------------------------------------------
// THE DEFAULT THIS LEG RESTS ON, ASSERTED RATHER THAN ASSUMED
// -----------------------------------------------------------------------------
// Omitting the option above buys `RI-02`'s silence honestly and costs one
// thing: the property that no score fails this run is now a fact about the
// INSTALLED TOOL rather than a line in this repository. A future major that
// changed that default would turn a trend into a nightly failure and nothing
// here would notice. So it is read out of the shipped JSON schema of the
// version actually installed, and a mismatch stops the run before it starts.
// ADR-127 section 4. `./package.json` is one of the two subpaths
// `@stryker-mutator/core` exports, which is what makes the package root
// resolvable without reaching through `node_modules` by hand.
const require = createRequire(import.meta.url);
const schemaPath = join(
  dirname(require.resolve('@stryker-mutator/core/package.json')),
  'schema',
  'stryker-schema.json',
);
const scoreOptions = JSON.parse(readFileSync(schemaPath, 'utf8')).definitions
  ?.mutationScoreThresholds?.properties;
if (!scoreOptions) {
  throw new Error(
    `${schemaPath}: no mutationScoreThresholds definition. This config omits the ` +
      "breaking-score option deliberately and relies on the tool's default being null " +
      '(ADR-127 section 4); a schema this assertion cannot read is a default it cannot ' +
      'check, and an unchecked default is the thing the assertion exists to refuse.',
  );
}
if (scoreOptions.break?.default !== null) {
  throw new Error(
    "@stryker-mutator/core's default breaking mutation score is no longer null (it is " +
      `${JSON.stringify(scoreOptions.break?.default)}). CI-09's Stryker leg is ruled a TREND ` +
      'and not a gate (STRATEGY section 2, OQ-TS-02), and this config expressed that by ' +
      'writing no such option at all rather than by writing one RI-02 cannot see. That ' +
      'ruling now needs a decision rather than a default: ADR-127 section 4 and finding 2.',
  );
}

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'pnpm',
  testRunner: 'vitest',
  plugins: ['@stryker-mutator/vitest-runner'],

  mutate: ['src/**/*.ts'],

  // Per-test coverage is what makes the wall clock survivable: a mutant is run
  // only against the tests that actually executed the mutated line. Without it
  // every mutant runs the package's whole suite.
  coverageAnalysis: 'perTest',

  vitest: { configFile: 'vitest.config.ts' },

  // A GENEROUS TIMEOUT IS THE HONEST DIRECTION. Stryker scores a timed-out
  // mutant as KILLED, so a tight timeout INFLATES the number by counting slow
  // tests as detections. The `fast-check` property suites are the slow ones and
  // 5,000ms (the default) is inside their range.
  timeoutMS: 15000,
  timeoutFactor: 2,

  // THE SANDBOX STAYS AT STRYKER'S DEFAULT, AND THE TWO PLACES IT WOULD HAVE
  // BEEN SAFER WERE BOTH TRIED AND BOTH BROKE THE RUN.
  //
  // Stryker copies the package into `.stryker-tmp/sandbox-*` and mutates the
  // COPY, which is what keeps a mutation run from being the tree-mutating
  // operation `falsify:ci` has to be. The cost is that `gates.mjs`'s `walk`
  // skips `node_modules` and `.git` AND NOTHING ELSE, so a sandbox beside the
  // source is READ BY EVERY CI-06 GATE even though `.gitignore` names it:
  // measured on this branch with a run in flight, CI-06a reported 427 findings
  // and CI-06/retired-constraints 35, every one of them a copy of a file
  // already in the tree.
  //
  // MEASURED, NOT ASSUMED, IN BOTH DIRECTIONS:
  //
  //   node_modules/.stryker-tmp   The one directory name every walker here
  //                               skips. IT BREAKS THE RUN. Vitest excludes
  //                               `**/node_modules/**` by default, so with the
  //                               sandbox under that path every test file is
  //                               excluded and the dry run reports "No tests
  //                               were found".
  //   an absolute path in os.tmpdir()
  //                               Out of the tree entirely. ALSO BREAKS: the
  //                               sandbox cannot resolve the package's own
  //                               dependencies from there and the initial test
  //                               run dies.
  //
  // So the default stands and the landmine is NAMED rather than hidden.
  // `cleanTempDir` removes the sandbox after a run that finishes, which was
  // verified; A RUN THAT CRASHES LEAVES IT, which was also verified, and until
  // somebody deletes it `pnpm run verify` on that laptop is red over files that
  // are about to be deleted. THE FIX IS A GATE EDIT AND IS NOT THIS SESSION'S:
  // `walk` reading `.gitignore`, or a skip list. ADR-127 finding 3 records it
  // and the edge-case entry TR-04 requires is owed.
  cleanTempDir: true,

  reporters: ['clear-text', 'json', 'html', 'progress'],

  // The report goes where every other CI-09 job's report goes, so
  // `nightly.yml`'s `hashFiles` guard and its `upload-artifact` step need no
  // special case for this leg.
  htmlReporter: { fileName: 'test-results/stryker/mutation.html' },
  jsonReporter: { fileName: 'test-results/stryker/mutation.json' },

  // The score table and the surviving mutants are the trend. The per-test
  // listing is several hundred lines of names on every run and is in the HTML
  // report for anyone who wants it.
  clearTextReporter: { reportTests: false, logTests: false, maxTestsToLog: 0, allowEmojis: false },
};
