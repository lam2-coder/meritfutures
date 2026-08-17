#!/usr/bin/env node
// =============================================================================
// scripts/ci/engine-digest.mjs
// =============================================================================
// A CANONICAL DIGEST OF EVERYTHING THE ENGINE COMPUTES, ON STDOUT AND NOTHING
// ELSE, so `RE-D-02` can diff two PROCESSES rather than two closures.
//
//   node scripts/ci/engine-digest.mjs
//   TZ=Asia/Kolkata LC_ALL=ja_JP.UTF-8 node scripts/ci/engine-digest.mjs
//
// -----------------------------------------------------------------------------
// WHY A SEPARATE PROCESS IS NOT AN IMPLEMENTATION DETAIL
// -----------------------------------------------------------------------------
// M01 section 1.4: "`RE-D-02` runs the suite under `TZ=Asia/Kolkata` with a
// non-English locale and DIFFS THE OUTPUT AGAINST THE DEFAULT RUN."
//
// The timezone half of that could be done in one process: V8 re-reads
// `process.env.TZ` on every `Date` operation. THE LOCALE HALF CANNOT. Node
// resolves the ICU default locale ONCE AT STARTUP, so assigning
// `process.env.LC_ALL` afterwards changes nothing that `Intl` or a bare
// `toLocaleDateString()` will ever read. Measured, not assumed, and the
// measurement is `localeIsProcessScoped()` in the PT-06 harness.
//
// So an in-process locale test would pass on every seed forever while proving
// nothing, and the only honest way to randomize a locale is to put it in the
// environment BEFORE the process starts. That is what this file exists for.
//
// -----------------------------------------------------------------------------
// TWO CORPORA, AND ONE OF THEM IS CURRENTLY VACUOUS
// -----------------------------------------------------------------------------
//   demo      `runDemo` folds a seeded population through the REAL `advanceDay`
//             and `evaluatePayout`. 45 of 50 rules. This half bites today
//   golden    the fixture directory, folded through `evaluate`, WHICH IS STILL
//             THE SCAFFOLD'S IDENTITY STUB. This half is M01's literal
//             instruction and proves nothing yet
//
// THE DIGEST SAYS WHICH IS WHICH, ON EVERY RUN, DERIVED FROM
// `engineIsIdentityStub()` RATHER THAN FROM THIS COMMENT. ADR-038's mechanism:
// "CI-03 prints what it currently proves." The day the loader folds `advanceDay`
// the `scope` line changes by itself and the golden half starts meaning
// something, with no edit here and nobody to remember.
//
// -----------------------------------------------------------------------------
// NOTHING BUT THE DIGEST GOES TO STDOUT
// -----------------------------------------------------------------------------
// The caller diffs this stream byte for byte. A warning, a progress line or a
// timing would each be a difference between two runs that has nothing to do
// with the engine, so the experimental-types warning is filtered exactly as
// `scripts/demo/run.mjs` filters it, and every diagnostic goes to stderr.
// =============================================================================

import { createHash } from 'node:crypto';
import { register } from 'node:module';

// Node's type stripping is behind an experimental flag and prints a warning on
// every run. `scripts/demo/run.mjs` drops that one warning and no other, and the
// same restraint applies here for a stronger reason: a warning on stdout would
// be a spurious diff.
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name !== 'ExperimentalWarning') process.stderr.write(`${warning.stack ?? ''}\n`);
});

// The workspace publishes its libraries from source (`"exports": ".": "./src/index.ts"`)
// and nothing here is built by tsc, so Node needs the one resolution step that
// retries a missing `./x.js` as `x.ts`. VG-12 makes a loader package a
// deliberate admission and `scripts/demo` already declined to spend one.
register(new URL('../demo/ts-resolve.mjs', import.meta.url));

const { engineIsIdentityStub, loadFixtureDirectory, runFixture } = await import(
  new URL('../../packages/golden-loader/src/index.ts', import.meta.url).href
);
const { DEFAULT_OPTIONS, runDemo } = await import(new URL('../demo/main.ts', import.meta.url).href);

/**
 * A stable stringification: object keys sorted, `bigint` tagged so it can never
 * collide with the string of the same digits.
 *
 * M01 section 1.4 bans "iteration over an object's keys where the result affects
 * output" inside the engine, because key order is insertion order and drifts
 * with a refactor. THIS FILE IS THE PLACE THAT ORDER MUST BE IMPOSED: a digest
 * whose bytes depended on insertion order would differ between two runs for a
 * reason that is not the environment, which is the one thing RE-D-02 must never
 * report.
 */
function canonical(value) {
  if (typeof value === 'bigint') return `bigint:${value.toString()}`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 32);

/** @type {string[]} */
const lines = [];

// -----------------------------------------------------------------------------
// Scope, derived
// -----------------------------------------------------------------------------
const stubbed = engineIsIdentityStub();
lines.push(`scope golden=${stubbed ? 'VACUOUS-identity-stub' : 'LIVE'} demo=LIVE`);

// -----------------------------------------------------------------------------
// The demo corpus: the real fold
// -----------------------------------------------------------------------------
// Options are pinned here rather than taken from the command line. A digest
// whose corpus depended on an argument would let two runs differ for a reason
// the caller chose, and RE-D-02 compares runs that must differ ONLY in `TZ` and
// `LC_ALL`.
const DEMO_OPTIONS = { ...DEFAULT_OPTIONS, days: 25, accountsPerCohort: 2 };
lines.push(`demo ${sha(runDemo(DEMO_OPTIONS))}`);

// -----------------------------------------------------------------------------
// The golden corpus: M01's literal instruction
// -----------------------------------------------------------------------------
const { fixtures, failures } = loadFixtureDirectory();

// A corpus that failed to load is not a corpus that agreed. Two runs that both
// loaded nothing would produce two identical digests and RE-D-02 would report
// determinism about an empty set.
if (failures.length > 0) {
  process.stderr.write(`engine-digest: ${failures.length} fixture(s) failed to load\n`);
  process.exitCode = 1;
}
if (fixtures.length === 0) {
  process.stderr.write('engine-digest: the fixture directory loaded zero fixtures\n');
  process.exitCode = 1;
}

lines.push(`golden count=${fixtures.length}`);
for (const fixture of [...fixtures].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
  const outcome = runFixture(fixture);
  lines.push(
    // `outcome.result` WAS AN `EngineResult` AND IS NOW THE FOLD'S OWN OUTPUT.
    // `runFixture` called `evaluate`, which returns `{ newState, events }`; it
    // folds `advanceDay`, which carries a `RuleState` and accumulates events
    // across the stream. The digest covers `assertions` too, because a day the
    // fold REFUSED is part of what a run produced and two runs that refused
    // different days have not agreed.
    `golden ${fixture.id} ${sha(canonical({ state: outcome.state, events: outcome.events, assertions: outcome.assertions, diffs: outcome.diffs }))}`,
  );
}

process.stdout.write(`${lines.join('\n')}\n`);
