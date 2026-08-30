// =============================================================================
// apps/worker/test/entrypoint.test.ts
// =============================================================================
// **THE ASSERTIONS THAT WATCH A PROCESS EXIT, RATHER THAN REASONING ABOUT ONE.**
//
// The defect `ADR-241` repairs was a deployable that exited 0 having done
// nothing, and the trap the allocation row named is that a job which cannot fail
// loudly is that same defect in a new costume. So nothing here calls `main` and
// inspects a returned value: every case below SPAWNS A REAL NODE PROCESS, waits
// for it, and reads `status`. A test that imported the module and asserted on a
// rejected promise would have proved that a function throws, which was never in
// doubt, and would have said nothing about what a supervisor sees.
//
// `spawnSync` is used rather than an async spawn because the exit status is the
// whole subject and there is nothing to interleave.
//
// CI-02, the `unit` project. It needs no database: the entry-point case runs
// with `DATABASE_URL` deliberately UNSET and asserts the refusal that produces,
// and the two harness cases run against a stub door.
// =============================================================================

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const ROOT = join(APP, '..', '..');

const START = join(APP, 'src', 'start.ts');
const HARNESS = join(HERE, 'entrypoint-harness.ts');

/** Run a file under the same flags `package.json`'s `start` uses. */
function run(file: string, args: readonly string[], env: Record<string, string>) {
  return spawnSync(process.execPath, ['--experimental-strip-types', file, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    // A DELIBERATELY EMPTY ENVIRONMENT PLUS WHAT THE CASE NAMES. Inheriting
    // `process.env` would let a `DATABASE_URL` on a developer's machine change
    // what case 1 measures, and a test whose result depends on the tester's
    // shell is not a control.
    env: { PATH: process.env['PATH'] ?? '', ...env },
  });
}

// -----------------------------------------------------------------------------
// 1. The entry point exists, is what `start` names, and calls `main`
// -----------------------------------------------------------------------------

test('1.1 package.json `start` names the entry point and not the barrel', () => {
  const manifest: unknown = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8'));
  const scripts = (manifest as { scripts?: Record<string, unknown> }).scripts ?? {};
  expect(scripts['start']).toBe('node --experimental-strip-types src/start.ts');
});

test('1.2 the entry point calls `main` at the top level and catches nothing', () => {
  const source = readFileSync(START, 'utf8');
  const code = source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');

  // THE MEASUREMENT THAT FOUND THE DEFECT, RE-RUN AGAINST THE REPAIR. ADR-239
  // and the allocation row both grepped for a top-level call to `main` and got
  // zero. It is one here, at column zero, in the file `start` names.
  expect(/^await main\(\)/m.test(code)).toBe(true);

  // AND NOTHING BETWEEN THE JOB AND THE PROCESS SWALLOWS ITS FAILURE. A `catch`
  // that logged and fell through would restore the exit-0 this row exists to
  // end, and it would restore it invisibly, because the log would still look
  // like a broken batch to a reader and like a healthy one to a supervisor.
  expect(code).not.toMatch(/\bcatch\b/);
});

test('1.3 the barrel still does not call `main`, which is why the entry point exists', () => {
  // `index.ts` is this package's `exports` target, so importing it must have no
  // effect. This is the OTHER half of 1.2 and not a restatement of it: the
  // defect was one file doing neither, and the repair must not become one file
  // doing both.
  const barrel = readFileSync(join(APP, 'src', 'index.ts'), 'utf8');
  expect(/^(await )?main\(\)/m.test(barrel)).toBe(false);
});

// -----------------------------------------------------------------------------
// 2. A failing job leaves a NON-ZERO status
// -----------------------------------------------------------------------------

test('2.1 the real entry point, with no DATABASE_URL, exits non-zero', () => {
  const result = run(START, [], { MERIT_ENGINE_VERSION: 'entrypoint-test' });

  // THE CENTRAL ASSERTION OF THIS FILE. Before ADR-241 this command printed
  // nothing and exited 0.
  expect(result.status).not.toBe(0);
  expect(result.status).toBeGreaterThan(0);
  expect(result.stderr).toContain('DATABASE_URL');
});

test('2.2 a job that refuses its inputs exits non-zero and names the input', () => {
  const result = run(HARNESS, ['empty-calendar'], {});
  expect(result.status).toBeGreaterThan(0);
  expect(result.stderr).toContain('WorkerJobRefusal');
  expect(result.stderr).toContain('trading_calendar');
});

test('2.3 a REFUSED account, mid-batch, also exits non-zero', () => {
  // THE CASE THAT MATTERS MOST, because it is the one an operator will actually
  // meet: the day resolved, the watermark was read, the fold started, and one
  // account could not be folded. `runNightlyBatch` does not catch, `main` does
  // not catch, and the entry point does not catch.
  //
  // **THIS CASE HAS MOVED TWICE AND IS STRONGEST NOW.** It began as an unwired
  // PORT refusing before it read anything, which proved only that a throw leaves
  // a status. `ADR-258` made the port resolve five fields first. `ADR-260`
  // resolved the sixth, so there is no unwired port left on the nightly path,
  // and what is under test is the refusal `ADR-260` OWES: an account whose
  // `accounts.status` is `provisioning_pending`, the member `account_status`
  // declares and `AccountStatus` does not.
  //
  // **THE PROCESS IS THE POINT.** A unit test can assert that a function throws.
  // Only a spawned process can assert that the throw is not swallowed between
  // the resolver and the supervisor, which is the whole of what `ADR-241` bought
  // and the thing a permissive default would have silently taken back.
  const result = run(HARNESS, ['refusing-gates'], {});
  expect(result.status).toBeGreaterThan(0);
  expect(result.stderr).toContain('ExternalGatesRefusal');
  expect(result.stderr).toContain('provisioning_pending');

  // AND THE MESSAGE NAMES THE ACCOUNT AND THE LEG, because an operator meeting
  // this holds an account id and needs to know which of five columns to look at.
  expect(result.stderr).toContain('accountStatus');
  expect(result.stderr).toContain('0f8fad5b');

  // AND IT DOES NOT SUGGEST A DEFAULT WOULD HAVE BEEN SAFER, which is the one
  // conclusion a reader of this failure must not draw. ADR-248 section 8 ruled
  // both directions unsafe and the message carries it.
  expect(result.stderr).toContain('VETOES');
});

// -----------------------------------------------------------------------------
// 3. A job that completes leaves ZERO, and says what it did
// -----------------------------------------------------------------------------

test('3.1 a completed run exits 0 and prints the report the dead-man switch reads', () => {
  const result = run(HARNESS, ['closed-day'], {});
  expect(result.status).toBe(0);

  const line: unknown = JSON.parse(result.stdout.trim());
  expect(line).toEqual({
    job: 'nightly-batch',
    outcome: 'completed',
    tradingDay: '2026-08-28',
    engineVersion: 'harness-1',
    calendarRevisionId: null,
    accountsConsidered: 0,
    written: 0,
    refused: 0,
    absent: 0,
  });
});

test('3.2 the empty book is a COMPLETED run and not a silent one', () => {
  // ADR-241 section 5. A first run against a database with a calendar and no
  // marks writes nothing, and the difference between that and the defect this
  // row repairs is that this one SAYS SO. `written: 0` beside
  // `accountsConsidered: 0` is a job reporting an empty book; the old exit 0
  // reported nothing at all.
  const result = run(HARNESS, ['closed-day'], {});
  expect(result.stdout.trim().length).toBeGreaterThan(0);
  expect(result.stdout).toContain('"outcome":"completed"');
});
