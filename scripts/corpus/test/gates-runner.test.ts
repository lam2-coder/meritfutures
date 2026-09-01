import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { EXIT, GATES, runGates } from '../gates.mjs';

// =============================================================================
// ADR-296. The corpus runner reports a crashed gate apart from a failed one.
// =============================================================================
// THE TWIN OF THIS BLOCK IS `packages/tooling/test/repo-invariants.test.ts`, and
// the difference between the two defects is why this file states its own rather
// than inheriting it. `repo-invariants.mjs` printed `29 of 30 invariants hold.`
// over a run that measured twenty-nine, which put the unmeasured check on the
// HELD side of the sentence. `gates.mjs` never did that: a crashed gate has
// always printed ERROR, has always left the denominator alone and has always
// exited non-zero, so the count it printed was `32 of 33` and never `33 of 33`.
//
// What it got wrong is narrower, and it is what these cases pin. A crash was
// counted as a FAILURE, so the report asserted thirty-two measurements that did
// not hold when the truth was thirty-two measurements and ONE UNKNOWN, and it
// said so beside `a gate that fails is a corpus that is wrong`, which points the
// reader at the one place the defect is not. The exit code was `1`, the same
// code a genuinely violated corpus produces, so a shell could not tell a broken
// runner from a broken corpus either.
//
// THE FIXTURES ARE NOT REAL GATES AND CARRY NO `covers` LINE, deliberately. What
// is under test is the REPORT, so a fixture that resembled a gate closely enough
// to be mistaken for one would be an invitation to register it.
// =============================================================================

/** A gate that ran and found nothing. A fixture for the report, not a gate. */
const held = (id: string) => ({
  id,
  title: `${id} holds`,
  run: (): string[] => [],
});

/** A gate that ran and found something. */
const violated = (id: string) => ({
  id,
  title: `${id} is violated`,
  run: (): string[] => [`${id} found one thing`],
});

/** A gate that did not run. */
const crashes = (id: string) => ({
  id,
  title: `${id} cannot run`,
  run: (): string[] => {
    throw new Error(`${id} could not reach its inputs`);
  },
});

/** Run `gates` and collect the transcript the runner emits, line by line. */
const transcript = (
  gates: readonly { id: string; title: string; run: () => string[] }[],
): { lines: string[]; result: ReturnType<typeof runGates> } => {
  const lines: string[] = [];
  const result = runGates(gates, { emit: (line: string) => lines.push(line) });
  return { lines, result };
};

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * The exit code of a real invocation, read WITHOUT A PIPE.
 *
 * `node gates.mjs check | tail` reports `tail`'s status and not the runner's,
 * which is how a session records a false pass. `execFileSync` reads the child's
 * own status, which is the thing this row is half about.
 */
const exitCodeOf = (...args: string[]): number => {
  try {
    execFileSync(process.execPath, ['scripts/corpus/gates.mjs', ...args], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    });
    return 0;
  } catch (err) {
    return (err as { status: number }).status;
  }
};

describe('the corpus runner reports a crashed gate apart from a passed and a failed one', () => {
  test('a crash is an ERROR, counted apart from both PASS and FAIL', () => {
    const { lines, result } = transcript([held('CI-A'), held('CI-B'), crashes('CI-C')]);
    expect(result).toMatchObject({ passed: 2, failed: 0, errored: 1, total: 3 });
    expect(lines).toContain('PASS   CI-A  CI-A holds');
    expect(lines.find((line) => line.startsWith('ERROR  CI-C'))).toBe(
      'ERROR  CI-C  CI-C cannot run  (THIS GATE DID NOT RUN)',
    );
    expect(lines).toContain('       CI-C could not reach its inputs');
    expect(lines.some((line) => line.startsWith('FAIL   CI-C'))).toBe(false);
  });

  test('a run holding a crash never prints the gates-pass sentence', () => {
    // The shipped runner printed `2 of 3 gates pass.` here, and then told the
    // reader that a gate which fails is a corpus that is wrong. Neither half is
    // something this run is entitled to say: it measured two gates out of three.
    const { lines } = transcript([held('CI-A'), held('CI-B'), crashes('CI-C')]);
    expect(lines.some((line) => line.includes('gates pass.'))).toBe(false);
    expect(lines.some((line) => line.includes('a corpus that is wrong'))).toBe(false);
    expect(lines).toContain(
      '1 of 3 gate(s) COULD NOT RUN, so this run did not measure the corpus.',
    );
    expect(lines).toContain('2 passed, 0 failed, 1 errored, of 3 gate(s).');
    expect(lines.some((line) => line.includes('2 measurement(s) and 1 unknown(s)'))).toBe(true);
  });

  test('the crash is not subtracted from the denominator', () => {
    // 33 gates producing 32 passes, 0 fails and 1 crash is not `32 of 33`, and
    // it is emphatically not `32 of 32`. Subtracting the crashed gate would make
    // the arithmetic true and convert a broken runner into a smaller clean one,
    // which is the same lie with better manners.
    const { lines, result } = transcript([held('CI-A'), crashes('CI-B')]);
    expect(result.total).toBe(2);
    for (const line of lines) expect(line).not.toContain('of 1 gate');
    expect(lines).toContain('1 passed, 0 failed, 1 errored, of 2 gate(s).');
  });

  test('a crash exits CRASHED, and dominates a violation in the same run', () => {
    expect(runGates([held('CI-A'), crashes('CI-B')], { emit: () => {} }).exitCode).toBe(
      EXIT.CRASHED,
    );
    const both = runGates([violated('CI-A'), crashes('CI-B')], { emit: () => {} });
    expect(both).toMatchObject({ passed: 0, failed: 1, errored: 1, exitCode: EXIT.CRASHED });
    expect(EXIT.CRASHED).toBe(3);
    expect(EXIT.CRASHED).not.toBe(EXIT.VIOLATED);
    expect(EXIT.CRASHED).not.toBe(EXIT.USAGE);
  });

  test('a run with no crash keeps the wording and the exit code it always had', () => {
    // The half this row deliberately did not move. A case going red here would
    // mean the fix had reached past the crashed branch of the report.
    const clean = transcript([held('CI-A'), held('CI-B')]);
    expect(clean.lines).toEqual([
      'PASS   CI-A  CI-A holds',
      'PASS   CI-B  CI-B holds',
      '',
      '2 of 2 gates pass.',
    ]);
    expect(clean.result.exitCode).toBe(EXIT.OK);

    const dirty = transcript([held('CI-A'), violated('CI-B')]);
    expect(dirty.lines).toEqual([
      'PASS   CI-A  CI-A holds',
      'FAIL   CI-B  CI-B is violated  (1)',
      '       CI-B found one thing',
      '',
      '1 of 2 gates pass. A gate that fails is a corpus that is wrong, not a gate to relax.',
    ]);
    expect(dirty.result.exitCode).toBe(EXIT.VIOLATED);
  });

  test('a long FAIL is still truncated at forty findings, with the tail counted', () => {
    // Also unchanged, and asserted because the literal `40` became a named
    // constant in the same edit. A number no suite can see is a number that
    // drifts.
    const many = {
      id: 'CI-A',
      title: 'CI-A is violated many times over',
      run: (): string[] => Array.from({ length: 42 }, (_, i) => `finding ${i + 1}`),
    };
    const { lines } = transcript([many]);
    expect(lines).toContain('       finding 40');
    expect(lines).not.toContain('       finding 41');
    expect(lines).toContain('       ... and 2 more');
  });

  test('importing the runner does not run the gates, and the script still exits', () => {
    // `process.exit(main())` used to be unconditional at module scope, so this
    // file could not have imported the runner at all. The guard that makes the
    // import possible is also the guard that could silently stop the CLI from
    // exiting, so both halves are read here rather than assumed.
    expect(GATES.length).toBeGreaterThan(0);
    expect(exitCodeOf('nonsense')).toBe(EXIT.USAGE);
    expect(exitCodeOf('check', 'CI-06-NO-SUCH-GATE')).toBe(EXIT.USAGE);
  });
});
