#!/usr/bin/env node
// =============================================================================
// packages/golden-loader/check.mjs
// =============================================================================
// CI-03's TWO ENGINE-INDEPENDENT HALVES, AS A COMMAND.
//
//   node packages/golden-loader/check.mjs [fixtureDir]
//
//   1. Every fixture in the directory loads, or the `L-nn` that refused it says
//      so by name.
//   2. The end-state comparison agrees and disagrees where it must, ACROSS THE
//      TYPE BOUNDARY, against hand-built states.
//   3. ADR-048's polarity derivation reads a citation and a declared rule set
//      the way the ruling states, including the vacuity case it calls "the
//      dangerous one".
//
// IT EXISTS SO BOTH CAN BE SEEDED AND WATCHED FROM OUTSIDE VITEST, which is
// what scripts/corpus/falsify.mjs needs. That harness copies the tree, seeds
// one violation into the copy, and runs the checker IN THE COPY, so the thing
// under test is the seeded code rather than this branch's. The copy
// deliberately omits `node_modules`, so a checker that needs a workspace
// resolution cannot run there at all.
//
// SO THIS FILE IMPORTS `./src/loader.ts`, `./src/compare.ts` AND
// `./src/polarity.ts` DIRECTLY AND NEVER `./src/index.ts`, and the restraint is
// load bearing rather than stylistic. The barrel re-exports `run.ts` and
// `coverage.ts`, which import the engine as a VALUE and are the only places
// this package needs the workspace at all. Reaching either would make this
// script unrunnable in exactly the tree the falsification harness builds.
// Everything below needs only relative modules, which Node resolves and strips
// on its own. `polarity.ts` takes the declared rule set as a PARAMETER for the
// same reason, so the derivation can be checked without the engine.
//
// ../test/loader.test.ts and ../test/compare.test.ts assert the same two things
// from inside vitest, and neither is redundant: those files assert the rule id
// a refusal carries and the exact text of a rendered diff, and this one asserts
// the properties that survive being run against a mutated copy of themselves.
//
// THE OUTPUT FORMAT IS SEVEN LEADING SPACES PER FINDING, matching what
// scripts/corpus/gates.mjs prints and what falsify.mjs parses. A harness that
// scores "it exited non-zero" as success is the defect that whole file exists
// to refuse, so every finding here says what was expected and what happened.
// =============================================================================

import { register } from 'node:module';

// Node 22 strips types on its own; the one step it does not do is TypeScript's
// `./compare.js` convention resolving to `compare.ts`. scripts/demo/ts-resolve.mjs
// is twenty lines that do exactly that and nothing else, and it is REUSED rather
// than copied on ADR-034's argument: two expressions of one concept is the defect,
// and a second copy of a resolve hook is a second thing to fix when Node's
// behaviour moves. VG-12 is the other half: neither `tsx` nor `ts-node` gets
// added so that a check script can import a `.ts` file.
register(new URL('../../scripts/demo/ts-resolve.mjs', import.meta.url));

const { FIXTURE_DIR, loadFixtureDirectory } = await import(
  new URL('./src/loader.ts', import.meta.url).href
);
const { diffEndState } = await import(new URL('./src/compare.ts', import.meta.url).href);
const { derivePolarity } = await import(new URL('./src/polarity.ts', import.meta.url).href);

const findings = [];
const report = (message) => findings.push(message);

// -----------------------------------------------------------------------------
// 1. The directory loads
// -----------------------------------------------------------------------------

const dir = process.argv[2] ?? FIXTURE_DIR;
const { fixtures, failures } = loadFixtureDirectory({ fixtureDir: dir });

for (const failure of failures) report(failure.error.message);

// A DIRECTORY THAT HELD NOTHING IS A FINDING, NOT A CLEAN RUN. It is the vacuity
// class ADR-048 names, one level up from the one L-13 closes: every assertion
// above is satisfied by an empty directory, and "0 fixtures, 0 failures" reads
// as green in every summary line that will ever quote it.
if (fixtures.length === 0 && failures.length === 0) {
  report(`no fixture loaded from ${dir}, so nothing was checked`);
}

// -----------------------------------------------------------------------------
// 2. The comparison, across the type boundary money actually crosses
// -----------------------------------------------------------------------------
// INV-02 makes every money field the engine returns a `bigint`; JSON has no
// literal for one, so every money field a fixture pins is a `number`. This is
// therefore not an edge case, it is every money assertion the stage will ever
// make, and while the polarity is inverted a defect here is INVISIBLE: a
// fixture that must fail fails, for a reason nobody planted.
//
// HAND-BUILT ON BOTH SIDES, so these hold whatever the engine does today. That
// is the same argument ../test/compare.test.ts makes for living where it does.

/** @type {(what: string, actual: object, expected: object, wanted: number) => void} */
function expectDiffs(what, actual, expected, wanted) {
  // A THROW IS A FINDING, NOT A CRASH. `BigInt(4770000.5)` raises a RangeError,
  // so a comparison that lost its safe-integer guard would take the stage down
  // with an exception rather than report a fixture defect, and an exception
  // names no field. Catching it here turns "CI-03 crashed" into a sentence
  // saying which comparison threw and on what.
  let got;
  try {
    got = diffEndState(actual, expected).length;
  } catch (err) {
    report(`diffEndState ${what}: threw ${err instanceof Error ? err.name : 'a non-Error'}`);
    return;
  }
  if (got !== wanted) {
    report(`diffEndState ${what}: expected ${wanted} diff(s), got ${got}`);
  }
}

expectDiffs(
  'must agree when a bigint result states the same cents as an integer expectation',
  { floorCents: 4_770_000n },
  { floor_cents: 4_770_000 },
  0,
);
expectDiffs(
  'must disagree on one cent below, across the type boundary',
  { floorCents: 4_770_000n },
  { floor_cents: 4_769_999 },
  1,
);
expectDiffs(
  'must disagree on one cent above, across the type boundary',
  { floorCents: 4_770_000n },
  { floor_cents: 4_770_001 },
  1,
);
expectDiffs(
  'must disagree on a sign flip, which a magnitude comparison would accept',
  { floorCents: 4_770_000n },
  { floor_cents: -4_770_000 },
  1,
);
expectDiffs(
  'must disagree on a fractional expectation rather than throwing on BigInt()',
  { floorCents: 4_770_000n },
  { floor_cents: 4_770_000.5 },
  1,
);
expectDiffs(
  'must still disagree when the engine result carries no such field',
  {},
  { floor_cents: 4_770_000 },
  1,
);

// -----------------------------------------------------------------------------
// 3. The polarity derivation (ADR-048)
// -----------------------------------------------------------------------------
// HAND-BUILT DECLARED SETS, so these hold against any engine. The ruling is
// that a fixture citing only declared rules must MATCH and one citing anything
// undeclared must FAIL, and the case ADR-048 calls "the dangerous one" is a
// fixture citing no rule at all: "every rule this fixture cites is implemented"
// is vacuously true of it, and reading that as `direct` would assert against a
// fold that computes nothing.

/** @type {(what: string, source: string, declared: string[], wanted: string) => void} */
function expectPolarity(what, source, declared, wanted) {
  const got = derivePolarity(source, new Set(declared)).polarity;
  if (got !== wanted) {
    report(`derivePolarity ${what}: expected ${wanted}, got ${got}`);
  }
}

expectPolarity(
  'must derive direct when the engine declares every rule the fixture cites',
  'M01 R-13, R-18',
  ['R-13', 'R-18'],
  'direct',
);
expectPolarity(
  'must derive inverted when one cited rule is undeclared',
  'M01 R-13, R-32',
  ['R-13'],
  'inverted',
);
expectPolarity('must derive inverted when the declared set is empty', 'M01 R-13', [], 'inverted');
expectPolarity(
  'must never derive direct from a citation naming no rule at all (ADR-048 case 4)',
  'M01 INV-06, CV-01',
  ['R-13', 'R-18'],
  'inverted',
);

// -----------------------------------------------------------------------------

for (const finding of findings) process.stdout.write(`       ${finding}\n`);

process.stdout.write(
  findings.length === 0
    ? `${fixtures.length} fixture(s) loaded from ${dir}, 0 refused, the comparison holds on ` +
        `both sides of the bigint boundary, and the polarity derivation reads both directions ` +
        `and the vacuity case as ADR-048 states them.\n`
    : `${findings.length} finding(s) over ${fixtures.length} loaded fixture(s) in ${dir}.\n`,
);

process.exitCode = findings.length ? 1 : 0;
