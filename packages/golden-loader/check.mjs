#!/usr/bin/env node
// =============================================================================
// packages/golden-loader/check.mjs
// =============================================================================
// THE LOADER'S LOAD HALF, AS A COMMAND, OVER ANY FIXTURE DIRECTORY.
//
//   node packages/golden-loader/check.mjs [fixtureDir]
//
// IT EXISTS SO THE `L-nn` RULES CAN BE SEEDED AND WATCHED FROM OUTSIDE VITEST,
// which is what scripts/corpus/falsify.mjs needs and could not have. That
// harness works by copying the tree and running a checker inside the copy, and
// the copy deliberately omits `node_modules`, so nothing that needs vitest can
// run there at all. Pointing a checker in THIS tree at a seeded fixture
// directory is the same experiment with the dependency the other way round: the
// rule under test is this tree's, the data under test is the seeded copy's,
// which is the pairing a falsification harness actually wants.
//
// ../test/loader.test.ts asserts the same rules from inside vitest and neither
// is redundant: that file asserts the rule ID a refusal carries, and this one
// asserts that a directory of fixtures loads clean, which is the thing CI-03
// depends on before it compares anything.
//
// THE OUTPUT FORMAT IS SEVEN LEADING SPACES PER FINDING, matching what
// scripts/corpus/gates.mjs prints and what falsify.mjs parses. A harness that
// scores "it exited non-zero" as success is the defect that whole file exists
// to refuse, so every finding here says WHICH rule refused WHICH file.
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
  new URL('./src/index.ts', import.meta.url).href
);

const dir = process.argv[2] ?? FIXTURE_DIR;

const { fixtures, failures } = loadFixtureDirectory({ fixtureDir: dir });

for (const failure of failures) {
  process.stdout.write(`       ${failure.error.message}\n`);
}

// A DIRECTORY THAT HELD NOTHING IS A FINDING, NOT A CLEAN RUN. It is the vacuity
// class ADR-048 names, one level up from the one L-13 closes: every assertion
// below is satisfied by an empty directory, and "0 fixtures, 0 failures" reads
// as green in every summary line that will ever quote it.
if (fixtures.length === 0 && failures.length === 0) {
  process.stdout.write(`       no fixture loaded from ${dir}, so nothing was checked\n`);
}

const bad = failures.length + (fixtures.length === 0 ? 1 : 0);

process.stdout.write(
  bad === 0
    ? `${fixtures.length} fixture(s) loaded from ${dir}, 0 refused.\n`
    : `${bad} finding(s) over ${fixtures.length} loaded fixture(s) in ${dir}.\n`,
);

process.exitCode = bad ? 1 : 0;
