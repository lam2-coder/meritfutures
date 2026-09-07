import { tmpdir } from 'node:os';
import { describe, expect, test } from 'vitest';

import {
  REGISTER,
  countsByFile,
  registerFindings,
  registerTotals,
  reportFindings,
} from '../checks/skipped-tests.mjs';

// =============================================================================
// THE CHECK IS WATCHED FAILING, IN BOTH DIRECTIONS, AND THAT IS THE POINT
// =============================================================================
// A control that fires only when a case STOPS running has encoded somebody's
// idea of which skips are legitimate, and ADR-429 section 10 rules that class of
// check out by name: a static approximation of intent "would be a check that
// passes while the property it names is false". So the cases below assert the
// red on a count that went UP as hard as on a count that went DOWN, and neither
// one is described as the bad direction.
//
// THE REPORTS HERE ARE SYNTHETIC AND THE ONES IN ADR-435 SECTION 6 ARE NOT. This
// file cannot run Vitest inside Vitest, so it constructs the report shape and
// asserts over the comparison. The row that wrote it also produced two REAL
// reports that make the check red with no edit to the tree at all -- one by
// setting `DATABASE_URL`, one by passing `-t` -- and those are the evidence that
// the shape below is the shape Vitest actually emits.
// =============================================================================

/** A file's worth of assertion results, in the shape `--reporter=json` emits. */
function file(name: string, counts: { passed?: number; skipped?: number; unwritten?: number }) {
  const results: { status: string; fullName: string }[] = [];
  for (let i = 0; i < (counts.passed ?? 0); i++)
    results.push({ status: 'passed', fullName: `${name} passed ${i}` });
  for (let i = 0; i < (counts.skipped ?? 0); i++)
    results.push({ status: 'skipped', fullName: `${name} skipped ${i}` });
  for (let i = 0; i < (counts.unwritten ?? 0); i++)
    results.push({ status: 'todo', fullName: `${name} unwritten ${i}` });
  return { name: `/repo/${name}`, assertionResults: results };
}

/**
 * A whole report. The two summary fields are DERIVED from the files rather than
 * passed in, so that a case wanting them to disagree has to say so explicitly.
 */
function report(files: ReturnType<typeof file>[]) {
  const flat = files.flatMap((f) => f.assertionResults);
  return {
    numPendingTests: flat.filter((a) => a.status === 'skipped').length,
    numTodoTests: flat.filter((a) => a.status === 'todo').length,
    testResults: files,
  };
}

const ADMIN = 'apps/api/test/admin-writes.test.ts';
const POOL = 'packages/db/test/pool-executor.test.ts';
const GOLDEN = 'packages/golden-loader/test/determinism.test.ts';

/** The register's own numbers, so no case here retypes a count. */
const expected = (path: string) => {
  const row = REGISTER.find((r) => r.file === path);
  if (row === undefined) throw new Error(`${path} is not in the register`);
  return row;
};

/** A report in which every register row is satisfied exactly. */
const clean = () =>
  report([
    file(ADMIN, {
      passed: 33,
      skipped: expected(ADMIN).skipped,
      unwritten: expected(ADMIN).unwritten,
    }),
    file(POOL, { passed: 5, skipped: expected(POOL).skipped, unwritten: expected(POOL).unwritten }),
    file(GOLDEN, {
      passed: 9,
      skipped: expected(GOLDEN).skipped,
      unwritten: expected(GOLDEN).unwritten,
    }),
    file('packages/tooling/test/skipped-tests.test.ts', { passed: 20 }),
  ]);

describe('the register describes a tree that exists', () => {
  test('every row names a file that is really there, on the real repository', () => {
    // THE ONE CASE HERE PINNED TO THE LIVE TREE, and it is pinned deliberately.
    // A register row naming a deleted file is contradicted by no report ever,
    // because no report contains that file, so this is the only thing that can
    // catch it.
    expect(registerFindings()).toEqual([]);
  });

  test('a row naming a file that is not there is a finding, one per row', () => {
    const findings = registerFindings(tmpdir());
    expect(findings).toHaveLength(REGISTER.length);
    for (const f of findings) expect(f).toContain('names a file that does not exist');
  });

  test('the totals are summed from the rows and not typed beside them', () => {
    expect(registerTotals()).toEqual({
      skipped: REGISTER.reduce((n, r) => n + r.skipped, 0),
      unwritten: REGISTER.reduce((n, r) => n + r.unwritten, 0),
    });
  });
});

describe('a run that agrees with the register', () => {
  test('produces no findings', () => {
    expect(reportFindings(clean(), '/repo')).toEqual([]);
  });

  test('and a run that contains none of the registered files produces none either', () => {
    // CI-04's report. It runs one integration file, no register row appears in
    // it, and the check must say nothing rather than reporting three absences.
    const only = report([file('packages/db/test/migrations.integration.test.ts', { passed: 2 })]);
    expect(reportFindings(only, '/repo')).toEqual([]);
  });
});

describe('a run that disagrees, in BOTH directions', () => {
  test('ONE MORE skip in a registered block is red', () => {
    // THIS IS THE CHANGE THAT ALREADY HAPPENED AND NOTHING SAW. ADR-429 added a
    // case inside the block at `admin-writes.test.ts:702` and took the suite
    // from 10 skipped to 11; the count was caught by hand, by comparing the
    // `skipIf` sites against base.
    const grew = report([
      file(ADMIN, { passed: 33, skipped: expected(ADMIN).skipped + 1 }),
      file(POOL, { passed: 5, skipped: expected(POOL).skipped }),
      file(GOLDEN, { passed: 9, skipped: expected(GOLDEN).skipped }),
    ]);
    const findings = reportFindings(grew, '/repo');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain(ADMIN);
    expect(findings[0]).toContain(`${expected(ADMIN).skipped + 1} skipped`);
  });

  test('ONE FEWER skip in a registered block is red on the same terms', () => {
    // A case moved OUT of a gated block, or a `skipIf` condition that stopped
    // holding. It is not a worse or better event than the one above and it does
    // not get a different sentence.
    const shrank = report([
      file(ADMIN, { passed: 34, skipped: expected(ADMIN).skipped - 1 }),
      file(POOL, { passed: 5, skipped: expected(POOL).skipped }),
      file(GOLDEN, { passed: 9, skipped: expected(GOLDEN).skipped }),
    ]);
    const findings = reportFindings(shrank, '/repo');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain(`${expected(ADMIN).skipped - 1} skipped`);
  });

  test('a skip in a file with no register row is red', () => {
    const stray = report([
      file(ADMIN, { passed: 33, skipped: expected(ADMIN).skipped }),
      file(POOL, { passed: 5, skipped: expected(POOL).skipped }),
      file(GOLDEN, { passed: 9, skipped: expected(GOLDEN).skipped }),
      file('apps/worker/test/recon.test.ts', { passed: 4, skipped: 1 }),
    ]);
    const findings = reportFindings(stray, '/repo');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('has no register row, so it may not skip a case');
  });

  test('a registered block that VANISHED gets its own sentence', () => {
    // A block deleted, or a file that failed to import, reads differently from a
    // block that grew, and the reader of a red build should not have to work out
    // which happened.
    const gone = report([
      file(ADMIN, { passed: 39 }),
      file(POOL, { passed: 5, skipped: expected(POOL).skipped }),
      file(GOLDEN, { passed: 9, skipped: expected(GOLDEN).skipped }),
    ]);
    const findings = reportFindings(gone, '/repo');
    expect(findings).toHaveLength(2);
    expect(findings.some((f) => f.includes('reports none at all'))).toBe(true);
  });

  test('a case left unwritten is a green non-run too, and is red until registered', () => {
    // The second of Vitest's two not-run statuses, the one `numTodoTests`
    // counts. It reports green exactly the way a skip does.
    const unwritten = report([
      file(ADMIN, { passed: 33, skipped: expected(ADMIN).skipped }),
      file(POOL, { passed: 5, skipped: expected(POOL).skipped }),
      file(GOLDEN, { passed: 9, skipped: expected(GOLDEN).skipped }),
      file('apps/worker/test/breaker.test.ts', { passed: 4, unwritten: 1 }),
    ]);
    const findings = reportFindings(unwritten, '/repo');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('1 unwritten');
  });

  test('the whole of a filtered run is red, which is the `-t` and `.only` hazard', () => {
    // MEASURED RATHER THAN IMAGINED. A `-t` filter makes every non-matching case
    // report as a skip, and Vitest reports the run as `success: true` with zero
    // failures. The row that wrote this produced exactly that report against the
    // real `pool-executor.test.ts`: 1 passed, 6 skipped, success true. Nothing
    // else in this repository goes red on it.
    const filtered = report([
      file(ADMIN, { passed: 1, skipped: 38 }),
      file(POOL, { passed: 1, skipped: 6 }),
      file(GOLDEN, { passed: 1, skipped: 9 }),
    ]);
    expect(reportFindings(filtered, '/repo')).toHaveLength(3);
  });
});

describe('it refuses to under-assert rather than reporting a clean run it did not measure', () => {
  test('a summary that disagrees with its own per-case statuses is a finding', () => {
    const lying = { ...clean(), numPendingTests: 99 };
    const findings = reportFindings(lying, '/repo');
    expect(findings.some((f) => f.includes('cannot read this report'))).toBe(true);
  });

  test('a numTodoTests summary that disagrees is a finding on the same terms', () => {
    const lying = { ...clean(), numTodoTests: 3 };
    const findings = reportFindings(lying, '/repo');
    expect(findings.some((f) => f.includes('cannot read this report'))).toBe(true);
  });

  test('a report with no test files THROWS rather than passing', () => {
    // A comparison over nothing passes by having looked at nothing, which is the
    // shape `ci.yml` refuses one workflow file over when it forbids
    // `--passWithNoTests`.
    expect(() => reportFindings(report([]), '/repo')).toThrow(/no test files/);
  });

  test('something that is not a Vitest report THROWS', () => {
    expect(() => reportFindings({ ok: true }, '/repo')).toThrow(/not a Vitest JSON report/);
  });
});

describe('countsByFile', () => {
  test('relativises the absolute paths the reporter writes, and keeps the zeros', () => {
    const counts = countsByFile(clean(), '/repo');
    expect(counts.get(ADMIN)).toEqual({ skipped: expected(ADMIN).skipped, unwritten: 0 });
    // THE ZEROS ARE KEPT ON PURPOSE. They are how the comparison knows which
    // files this report is entitled to have an opinion about.
    expect(counts.get('packages/tooling/test/skipped-tests.test.ts')).toEqual({
      skipped: 0,
      unwritten: 0,
    });
  });

  test('`pending` and `skipped` are the same status under two names', () => {
    const mixed = {
      testResults: [
        {
          name: '/repo/x.test.ts',
          assertionResults: [{ status: 'pending' }, { status: 'skipped' }],
        },
      ],
    };
    expect(countsByFile(mixed, '/repo').get('x.test.ts')).toEqual({ skipped: 2, unwritten: 0 });
  });
});
