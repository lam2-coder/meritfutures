// =============================================================================
// packages/tooling/checks/skipped-tests.mjs
// =============================================================================
// THE SKIPPED-CASE REGISTER, AND THE COMPARISON THAT BINDS IT.
//
// A SKIP IS GREEN. That is the whole reason this file exists. A case that does
// not run reports as a skip, a skip and a pass are the same colour at the top of
// a CI page, and the only thing that distinguishes them is a number in a summary
// line nobody reads on a green run. ADR-429 section 10 states the consequence in
// its own terms -- `apps/api/test/admin-writes.test.ts:16-17` promises the cases
// "SKIP LOUDLY when there is none", and "loudness is a property of a log nobody
// reads on a green run".
//
// AND THE NUMBER WAS BOUND TO NOTHING. ADR-429 reported that
// `grep -rn "10 skipped"` over `scripts/`, `packages/tooling/`, `.github/` and
// `docs/STATE.md` returned nothing. On the tree this file lands on, the first
// three still return nothing and `docs/STATE.md` returns 76 lines, every one of
// them a hand-typed figure inside a session's prose. Neither shape is a control:
// a number no script derives cannot go red, and a number 76 sessions each typed
// by hand is a number that drifts. It had already drifted when this was written.
// ADR-429 itself took the suite from 10 skipped to 11 and every entry in
// `docs/STATE.md` still reads 10.
//
// -----------------------------------------------------------------------------
// WHAT THIS BINDS, STATED NARROWLY SO THE HOLES ARE NOT HIDDEN BY THE CLAIM
// -----------------------------------------------------------------------------
// For a Vitest JSON report handed to it, this compares the not-run counts OF
// EVERY TEST FILE IN THAT REPORT against `REGISTER` below, in both directions,
// and refuses anything it cannot account for. It asserts nothing at all about
// test files the report does not contain.
//
// A CASE IS NOT-RUN IN TWO WAYS AND BOTH ARE GREEN. Vitest counts them as
// `numPendingTests`, which is a skip, and `numTodoTests`, which is a case
// declared and left unwritten. This file calls the second one `unwritten`
// throughout, because the word the framework uses for it is banned in comments
// by `no-warning-comments` in `packages/tooling/eslint.base.js:53-56` and that
// rule is not weakened for a register's convenience.
//
// SO THE COVERAGE IS THE WIRING'S AND NOT THIS FILE'S. `.github/workflows/ci.yml`
// runs it over CI-02's report (`unit` and `property`) and CI-04's
// (`integration`). `golden` is run by `.github/workflows/golden.yml` and is NOT
// wired: that file was outside the fence of the row that wrote this, and ADR-435
// section 7 records the hole rather than letting the register's shape imply it
// is closed.
//
// -----------------------------------------------------------------------------
// WHY THE COMPARISON IS AGAINST A REPORT AND NOT AGAINST THE TREE
// -----------------------------------------------------------------------------
// THE TEMPTING VERSION OF THIS FILE READS THE TEST SOURCES AND COUNTS `test(`
// CALLS INSIDE `describe.skipIf(` BLOCKS. It is forbidden, and the ruling is
// ADR-429 section 10's: a static check that approximates a dynamic property "would
// be a check that passes while the property it names is false", which is "the
// failure this corpus has paid for more often than any other".
//
// THREE REASONS IT WOULD BE THAT CHECK, in ascending order of how badly.
//   1. `test.each`, a loop, or a helper that generates cases makes the count
//      uncomputable from the text.
//   2. A skip need not come from a `skipIf` at all. `describe.skip`, a runtime
//      `ctx.skip()`, a `-t` filter and the marker `numTodoTests` counts all
//      produce a green non-run, and a counter that enumerates the constructs it
//      knows about passes silently over the one it does not.
//   3. WORST, AND FATAL ON ITS OWN: the count is a property of the ENVIRONMENT
//      and not of the tree. `packages/db/test/pool-executor.test.ts` carries
//      `describe.skipIf(HAS_DATABASE)` at line 79 and `describe.skipIf(!HAS_DATABASE)`
//      at line 97, so which of the two skips depends on `DATABASE_URL`. A static
//      counter would have to MODEL the environment it expects, and a check that
//      models intent is the approximation ADR-429 forbids.
//
// THE REPORT HAS NONE OF THOSE PROBLEMS BECAUSE IT IS NOT AN APPROXIMATION OF THE
// RUN, IT IS THE RUN. Vitest counted the skips itself, in the environment CI
// actually has, and this file only compares two numbers.
//
// AND NO SUITE IS RUN HERE. The report is produced by the `vitest run` the stage
// already performs -- one extra `--reporter=json` on a command line -- so the
// runtime cost of this control is a file write and a second of Node start-up.
//
// -----------------------------------------------------------------------------
// WHAT IT COSTS, WHICH IS A THING FUTURE ROWS PAY AND NOT A THING THIS FILE GETS
// FOR FREE
// -----------------------------------------------------------------------------
// A ROW THAT CHANGES HOW MANY CASES ARE SKIPPED MUST EDIT `REGISTER`, AND CI IS
// RED UNTIL IT DOES. That is the point rather than a side effect: the control has
// to fire on a GOOD change as loudly as on a bad one, because a control that only
// fires on bad changes is one that has encoded somebody's idea of intent.
//
// PRICED FROM THE RECORD RATHER THAN GUESSED. `docs/STATE.md` carries 376 rows
// reporting a suite figure of the form `N passed / M skipped`, and M takes four
// values across all of them: 2, then 1, then 6, then 10, changing three times.
// The fourth change, 10 to 11, is ADR-429's and no row recorded it. So this would
// have fired FOUR TIMES IN 376 RECORDED ROWS, about once in ninety, and each
// firing is a one-line edit to the table below.
//
// TWO THINGS IT DELIBERATELY DOES NOT DO.
//   1. IT DOES NOT SAY WHICH TESTS OUGHT TO RUN. It has no opinion about whether
//      a skip is legitimate. `why` on each row is a note for a reader and is
//      asserted over by nothing.
//   2. IT DOES NOT MATCH TEST NAMES. A row states a file and a count; renaming a
//      case is free and moving one between files is red. Binding titles would tax
//      every rewording for a property nobody has asked for.
// =============================================================================

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');

/**
 * One test file that reports at least one case as not-run.
 *
 * @typedef {object} RegisterRow
 * @property {string} file    Repository-relative path of the test file.
 * @property {number} skipped   Cases Vitest reports skipped (`numPendingTests`).
 * @property {number} unwritten Cases Vitest counts in `numTodoTests`.
 * @property {string} why       A note for a reader. Asserted over by nothing.
 */

/**
 * THE ONE PLACE THE COUNT IS STATED.
 *
 * A file absent from this list must report ZERO not-run cases. There is no
 * "unregistered but tolerated" state, because a tolerance is where the next
 * silent skip would live.
 *
 * @type {readonly RegisterRow[]}
 */
export const REGISTER = [
  {
    file: 'apps/api/test/admin-writes.test.ts',
    skipped: 6,
    unwritten: 0,
    why:
      '`describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === "")` at line 702. ' +
      'No CI job has a database, so all six skip on every push. ADR-429 section 10: the ' +
      'one job with a `services:` block runs no vitest, and every job that runs vitest ' +
      'has no database. THIS IS THE BLOCK WHOSE COUNT WENT 5 TO 6 UNNOTICED.',
  },
  {
    file: 'packages/db/test/pool-executor.test.ts',
    skipped: 4,
    unwritten: 0,
    why:
      '`describe.skipIf(!HAS_DATABASE)` at line 97. The COMPLEMENTARY block at line 79 ' +
      'is `describe.skipIf(HAS_DATABASE)` and runs, so handing CI a database does not ' +
      'take this to zero: it takes it to 1, and the four here become runs. ADR-429 ' +
      'section 8 measured that exchange. This number moving to 1 is the shape of the ' +
      'day somebody wires a database, and it should be red on that day too.',
  },
  {
    file: 'packages/golden-loader/test/determinism.test.ts',
    skipped: 1,
    unwritten: 0,
    why:
      '`test.skipIf(!stubbed)` at line 191. It is the one skip here that is not about a ' +
      'database: the case exists so that the golden corpus being folded by an identity ' +
      'stub has a NAME in the log rather than being a silent absence, and it disappears ' +
      'the day the loader stops being a stub.',
  },
];

/**
 * The count this register states, summed rather than typed a second time.
 *
 * @returns {{ skipped: number, unwritten: number }}
 */
export function registerTotals() {
  return {
    skipped: REGISTER.reduce((n, r) => n + r.skipped, 0),
    unwritten: REGISTER.reduce((n, r) => n + r.unwritten, 0),
  };
}

/**
 * The half that needs no report: the register describes a tree that exists.
 *
 * WITHOUT THIS THE REGISTER ROTS IN THE ONE DIRECTION THE COMPARISON CANNOT SEE.
 * A row naming a deleted file is never contradicted by any report, because no
 * report contains that file, so it would sit there stating a number about
 * nothing for as long as anyone left it.
 *
 * @param {string} [root] Repository root. Defaults to this file's own.
 * @returns {string[]} Findings, empty when the register is well formed.
 */
export function registerFindings(root = REPO_ROOT) {
  /** @type {string[]} */
  const findings = [];
  /** @type {Set<string>} */
  const seen = new Set();

  for (const row of REGISTER) {
    if (seen.has(row.file)) findings.push(`${row.file}: named by two register rows`);
    seen.add(row.file);

    if (!existsSync(join(root, row.file))) {
      findings.push(
        `${row.file}: register row names a file that does not exist. Either the file moved ` +
          'and the row moves with it, or the skips are gone and the row goes',
      );
    }
    for (const key of /** @type {const} */ (['skipped', 'unwritten'])) {
      const n = row[key];
      if (!Number.isInteger(n) || n < 0) {
        findings.push(`${row.file}: ${key} is ${String(n)}, which is not a count`);
      }
    }
    if (row.skipped === 0 && row.unwritten === 0) {
      findings.push(
        `${row.file}: register row states zero skipped and zero unwritten, which every ` +
          'unlisted file already states. Delete the row',
      );
    }
  }

  if (REGISTER.length === 0) {
    findings.push(
      'the register is empty, so every file in every report must report zero not-run ' +
        'cases. That is a legitimate state and it is also what a truncated file looks ' +
        'like, so it is reported rather than passed over',
    );
  }
  return findings;
}

/**
 * @typedef {object} FileCounts
 * @property {number} skipped
 * @property {number} unwritten
 */

/**
 * Per-file not-run counts, read off a Vitest JSON report.
 *
 * EVERY FILE IN THE REPORT GETS AN ENTRY, INCLUDING THE ZEROS, because the
 * comparison needs to know which files were actually run in order to know which
 * register rows this report is entitled to have an opinion about.
 *
 * @param {any} report Parsed `--reporter=json` output.
 * @param {string} [root] Repository root, for relativising the absolute paths.
 * @returns {Map<string, FileCounts>}
 */
export function countsByFile(report, root = REPO_ROOT) {
  /** @type {Map<string, FileCounts>} */
  const out = new Map();
  for (const file of report.testResults ?? []) {
    const rel = relative(root, String(file.name)).split('\\').join('/');
    const counts = out.get(rel) ?? { skipped: 0, unwritten: 0 };
    for (const a of file.assertionResults ?? []) {
      // `pending` is the summary field's spelling of the same thing the
      // per-case field spells `skipped`. Both are counted here and the
      // arithmetic check below is what would notice if that ever stopped
      // being true.
      if (a.status === 'skipped' || a.status === 'pending') counts.skipped++;
      else if (a.status === 'todo') counts.unwritten++;
    }
    out.set(rel, counts);
  }
  return out;
}

/**
 * The comparison. Both directions, plus a refusal to under-assert.
 *
 * @param {any} report Parsed `--reporter=json` output.
 * @param {string} [root] Repository root.
 * @returns {string[]} Findings, empty when the report and the register agree.
 */
export function reportFindings(report, root = REPO_ROOT) {
  /** @type {string[]} */
  const findings = [];

  if (!Array.isArray(report?.testResults)) {
    throw new Error('the report has no `testResults` array; this is not a Vitest JSON report');
  }
  if (report.testResults.length === 0) {
    throw new Error(
      'the report contains no test files, so comparing it against the register would ' +
        'pass by having looked at nothing',
    );
  }

  const actual = countsByFile(report, root);
  const byFile = new Map(REGISTER.map((r) => [r.file, r]));

  // DIRECTION 1: every file the report ran reports what the register says, and
  // an unlisted file reports nothing. This is the direction that catches a case
  // ADDED to a gated block, which is the one that has already happened.
  for (const [file, counts] of actual) {
    const row = byFile.get(file);
    const want = row
      ? { skipped: row.skipped, unwritten: row.unwritten }
      : { skipped: 0, unwritten: 0 };
    if (counts.skipped !== want.skipped || counts.unwritten !== want.unwritten) {
      findings.push(
        `${file}: the run reports ${counts.skipped} skipped and ${counts.unwritten} ` +
          `unwritten (\`.todo\`), the register says ${want.skipped} and ${want.unwritten}` +
          (row
            ? '. If the run is right, edit the row in packages/tooling/checks/skipped-tests.mjs'
            : '. This file has no register row, so it may not skip a case. Add a row, ' +
              'or make the case run'),
      );
    }
  }

  // DIRECTION 2: a register row for a file this report RAN and found clean. The
  // loop above already covers it, so this catches only the case where the file
  // is in the register and in the report's file list with no assertions at all,
  // which is what an import-time crash looks like.
  for (const row of REGISTER) {
    if (!actual.has(row.file)) continue;
    const counts = /** @type {FileCounts} */ (actual.get(row.file));
    if (counts.skipped === 0 && counts.unwritten === 0 && (row.skipped > 0 || row.unwritten > 0)) {
      // Already reported by direction 1. Kept as a distinct sentence because a
      // block that VANISHED reads differently from a block that grew, and the
      // reader of a red build should not have to work out which happened.
      findings.push(
        `${row.file}: the register expects ${row.skipped} skipped and ${row.unwritten} ` +
          `unwritten ` +
          'and the run reports none at all. The gated block is gone, is no longer gated, ' +
          'or the file failed to import',
      );
    }
  }

  // THE REFUSAL TO UNDER-ASSERT. If the summary and the per-case statuses
  // disagree, this file has misread the report format and every comparison above
  // it is worthless. It goes red rather than reporting a clean run it did not
  // measure, on `repo-invariants.mjs`'s rule that a check that crashed is not a
  // check that held.
  const summed = [...actual.values()].reduce(
    (acc, c) => ({ skipped: acc.skipped + c.skipped, unwritten: acc.unwritten + c.unwritten }),
    { skipped: 0, unwritten: 0 },
  );
  if (typeof report.numPendingTests === 'number' && report.numPendingTests !== summed.skipped) {
    findings.push(
      `the report's own summary says ${report.numPendingTests} pending and its per-case ` +
        `statuses sum to ${summed.skipped}. This checker cannot read this report, so it ` +
        'is not asserting anything about it',
    );
  }
  if (typeof report.numTodoTests === 'number' && report.numTodoTests !== summed.unwritten) {
    findings.push(
      `the report's own summary says ${report.numTodoTests} in numTodoTests and its ` +
        `per-case statuses sum to ${summed.unwritten}. This checker cannot read this ` +
        'report, so it is not asserting anything about it',
    );
  }

  return findings;
}

/**
 * @param {string[]} argv
 * @param {(line: string) => void} emit
 * @returns {number} Process exit code.
 */
export function run(argv, emit = (line) => console.log(line)) {
  const [reportPath] = argv;
  if (reportPath === undefined || reportPath.startsWith('-')) {
    emit('usage: node packages/tooling/checks/skipped-tests.mjs <vitest-json-report>');
    emit('');
    emit('Produce the report with the run you were going to do anyway:');
    emit('  pnpm exec vitest run --project unit --project property \\');
    emit('    --reporter=default --reporter=json --outputFile=/tmp/report.json');
    emit('');
    emit(
      'THE PATH IS REQUIRED AND THERE IS NO REGISTER-ONLY MODE. Half of this check ' +
        'silently passing is how the property it names becomes false while it is green.',
    );
    return 2;
  }

  const findings = registerFindings();
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch (err) {
    emit(`ERROR  cannot read ${reportPath}: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  findings.push(...reportFindings(report));

  const totals = registerTotals();
  if (findings.length === 0) {
    emit(
      `PASS   the run's not-run cases match the register: ${totals.skipped} skipped and ` +
        `${totals.unwritten} unwritten across ${REGISTER.length} file(s), of which this ` +
        `report ran ` +
        `${REGISTER.filter((r) => countsByFile(report).has(r.file)).length}`,
    );
    return 0;
  }
  emit(`FAIL   the skipped-case register and the run disagree (${findings.length})`);
  for (const f of findings) emit(`       ${f}`);
  emit('');
  emit(
    'A SKIP IS GREEN, WHICH IS WHY THIS IS RED. Either the change to what runs was ' +
      'intended, in which case the register is edited in the same commit, or it was not, ' +
      'in which case this is the warning that a case stopped running.',
  );
  return 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(run(process.argv.slice(2)));
