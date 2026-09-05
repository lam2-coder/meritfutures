// =============================================================================
// apps/worker/test/queue.test.ts
// =============================================================================
// THE ASSERTIONS ADR-333 IS WILLING TO HAVE WATCHED, AND WHICH HALF OF THE
// QUEUE DOOR EACH ONE COVERS.
//
// `apps/worker/test/db.test.ts` is the model and it is transcribed rather than
// reinvented: that file was written for ADR-165's admission of `@merit/db` to
// this deployable, and this one is the identical measurement for `@merit/queue`
// one capability over. Where a property is already asserted there, it is not
// restated here; two statements of one fact is what drifts.
//
// FIVE PROPERTIES, and no invariant or gate can see any of them.
//
//   1. THE ACQUISITION POINT. `RI-08` guards the accessor's manifest half over
//      every workspace package and NOTHING guards this one at all: `@merit/queue`
//      is on no admission list, so "which file may construct a queue over the
//      money database" is this case and the one in `test/schedule.test.ts` and
//      nothing else.
//   2. THE DOOR'S SURFACE. `JobQueue` publishes five methods and this deployable
//      takes TWO. The three it withholds are DERIVED from the vendor-neutral
//      list rather than typed here, so a sixth method arriving on that interface
//      is a decision somebody has to take in this file.
//   3. THE TWO EXECUTORS, and that neither can be handed the other's word. Two
//      of those are `@ts-expect-error` lines rather than expectations, because
//      the property is a COMPILE error and no runtime case can observe one.
//   4. THAT CONSTRUCTING THE DOOR OPENS NO SOCKET. `ci.yml`'s jobs run on bare
//      `ubuntu-latest` with no services block, so a door whose construction
//      needed a database would be a module this suite could not even import.
//   5. THAT NOTHING IS WIRED. The door exists and no module calls it, which is
//      the state ADR-326's register describes and which this row deliberately
//      does not move.
//
// WHAT IT PROVES NOTHING ABOUT. Whether pg-boss's own plans succeed against the
// applied schema: that needs a backend, `CI-04`'s second leg is still a dated
// condition, and ADR-333 section 6 is the measurement, taken by hand against
// PostgreSQL 16.13 over `0001`..`0082`. And whether a supervise pass reports its
// failures to anybody: nothing here starts one, which is section 4's ruling and
// is asserted below as an ABSENCE over the tree rather than claimed as a fix.
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { poolSqlExecutor } from '@merit/db';
import type { SystemTx } from '@merit/db';
import { JOB_QUEUE_METHODS } from '@merit/queue';
import { expect, test } from 'vitest';

import { stripComments } from '../../../packages/tooling/checks/strip-comments.mjs';

import { WORKER_SUPERVISOR_REASON, queueExecutor } from '../src/db.ts';
import { WORKER_BARREL_LEGS, WORKER_MODULES_NOT_RE_EXPORTED } from '../src/index.ts';
import { LIVE_QUEUE, workerQueue } from '../src/queue.ts';
import type { WorkerQueue } from '../src/queue.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');

/** Every `.ts` file under this deployable's `src/`. */
function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) found.push(full);
    }
  };
  walk(join(APP, 'src'));
  return found.sort();
}

const asPosix = (file: string): string => relative(APP, file).split('\\').join('/');

/**
 * Every file under `src/` that IMPORTS `specifier`.
 *
 * THE IMPORT AND NEVER THE MENTION, which is the distinction ADR-165 section 9
 * records paying for: `src/provisioning/ports.ts` names `@merit/queue` in its
 * own header in order to say that it does not import it, and a substring test
 * would read that sentence as a violation of the property it describes.
 */
function importersOf(specifier: string): string[] {
  const pattern = new RegExp(`from\\s+'${specifier.replace('/', '\\/')}'`);
  return sourceFiles()
    .filter((file) => pattern.test(readFileSync(file, 'utf8')))
    .map(asPosix);
}

// -----------------------------------------------------------------------------
// 1. The acquisition point, which nothing in CI-01 can see
// -----------------------------------------------------------------------------

test('exactly one file under src imports @merit/queue, and it is src/queue.ts', () => {
  // AN EXACT LIST AND NOT A LENGTH OR A `toContain`.
  // `apps/api/test/ledger-posting-authority.test.ts` states the reason in its
  // own words about the posting library: `toEqual([])` is what made the FIRST
  // adapter fail its case, and an exact list is what makes the SECOND one fail
  // it, where a `length` check would have retired the case the moment it first
  // turned. This one is turning now, and it is written so that it keeps biting.
  expect(importersOf('@merit/queue')).toEqual(['src/queue.ts']);
});

test('the queue door does not reach the accessor, so each package still names one file', () => {
  // **THIS IS WHAT MAKES ONE IMPORTER STRUCTURAL RATHER THAN TIDY, AND IT IS THE
  // REASON THE POOL EXECUTOR LIVES IN `src/db.ts`.** ADR-165's pattern is one
  // file per PACKAGE, and `test/db.test.ts` asserts `@merit/db` reaches exactly
  // `src/db.ts`. A queue door that imported `poolSqlExecutor` for itself would
  // have made that a TWO-element list, which is an ADR-165 assertion loosened to
  // land this row's own subject. The two doors compose structurally instead:
  // `SqlExecutor` and `JobTransaction` are the same shape with no import in
  // either direction, which is the arrangement `packages/db` and `packages/queue`
  // already have between themselves.
  const door = readFileSync(join(APP, 'src/queue.ts'), 'utf8');
  expect(door).not.toMatch(/from '@merit\/db'/);
  expect(importersOf('@merit/db')).toEqual(['src/db.ts']);
});

test('the door is not re-exported, on the reason src/db.ts is not re-exported', () => {
  // A LEG WOULD PUBLISH THE CAPABILITY OUT OF THE DEPLOYABLE. `./sweeps/
  // ledger.ts` IS a leg and this one is not, and the difference is what each
  // hands out: that file exports an ADAPTER over a port, and this one exports
  // the capability itself, which is `./db.ts`'s class. `test/digests.test.ts`
  // case 9.3 sweeps for membership in one of the barrel's three lists and would
  // be equally happy with a leg, so the ruling is asserted here.
  expect(Object.keys(WORKER_MODULES_NOT_RE_EXPORTED)).toContain('./queue.ts');
  expect(WORKER_BARREL_LEGS as readonly string[]).not.toContain('./queue.ts');
});

// -----------------------------------------------------------------------------
// 2. The door's surface: two of five, and the three refusals are derived
// -----------------------------------------------------------------------------

test('the door publishes declareQueue and enqueue and nothing else', () => {
  expect(Object.keys(LIVE_QUEUE).sort()).toEqual(['declareQueue', 'enqueue']);

  // THE WITHHELD SET IS DERIVED FROM THE VENDOR-NEUTRAL LIST AND NOT TYPED.
  // `JOB_QUEUE_METHODS` is `packages/queue`'s own data and ADR-006 made its
  // narrowness a review criterion; reading it here means a SIXTH method arriving
  // on that interface fails in this file until somebody decides whether this
  // deployable takes it. A written list of three would have passed silently.
  const published = new Set(Object.keys(LIVE_QUEUE));
  const withheld = JOB_QUEUE_METHODS.filter((method) => !published.has(method));
  expect([...withheld].sort()).toEqual(['consume', 'start', 'stop']);
  for (const method of published) expect(JOB_QUEUE_METHODS as readonly string[]).toContain(method);
});

test('start, stop and consume are absent by CONSTRUCTION and not by convention', () => {
  // THERE IS NO METHOD AND NO ARGUMENT POSITION, which is `src/db.ts`'s own
  // argument for the reason parameter it refuses to accept: "the operator reason
  // is unreachable from `apps/worker` BY CONSTRUCTION and not by convention:
  // there is no argument position a caller could put it in."
  //
  // `tsc` REPORTS AN UNUSED `@ts-expect-error` AS AN ERROR OF ITS OWN, so the
  // day `WorkerQueue` grows one of these, the line below fails `pnpm run
  // typecheck` rather than passing quietly.
  const door: WorkerQueue = LIVE_QUEUE;
  // @ts-expect-error ADR-333 section 4: this deployable is a ONE-SHOT JOB and
  // `start()` is a sixty-second supervise interval whose failures reach no
  // caller of `JobQueue`. The door does not publish it.
  expect(door.start).toBeUndefined();
  // @ts-expect-error ADR-333 section 4: a consumer is the long-lived poller
  // ADR-241 refuses for this deployable.
  expect(door.consume).toBeUndefined();
  // @ts-expect-error ADR-333 section 4: nothing was started, so there is nothing
  // to stop; the pool both doors share is released by `closeWorkerDb()`.
  expect(door.stop).toBeUndefined();
});

test('nothing under src starts a supervisor, which is the ruling made mechanical', () => {
  // **THE GAP ADR-331 SECTION 10 ITEM 3 AND ADR-332 SECTION 10 ITEM 2 BOTH LEFT
  // OWED IS CLOSED FOR THIS DEPLOYABLE BY NOT ENTERING IT.** pg-boss emits a
  // supervise failure on an emitter `pgBossQueue` does not expose, so a process
  // that starts one gets an unhandled rejection naming a line in a vendor's
  // `dist` and nothing names the queue. The door's answer is that no module here
  // may start one, and the assertion is over the TREE rather than over the type,
  // because a cast past `WorkerQueue` satisfies a type and not a grep.
  for (const file of sourceFiles()) {
    const body = stripComments(readFileSync(file, 'utf8'));
    expect(body, `${asPosix(file)} calls .start(), and no module here may start one`).not.toMatch(
      /\.start\s*\(/,
    );
    expect(body, `${asPosix(file)} calls .consume(), which this door withholds`).not.toMatch(
      /\.consume\s*\(/,
    );
  }
});

// -----------------------------------------------------------------------------
// 3. The two executors, and the two words that cannot be swapped
// -----------------------------------------------------------------------------

test('the constructor executor spends the POOL word and yields one method', () => {
  expect(WORKER_SUPERVISOR_REASON).toBe('job-supervisor');
  expect(WORKER_SUPERVISOR_REASON).not.toBe('job-enqueue');

  // ONE METHOD AND NOT A HANDLE, which is ADR-332 leg 3 read at this deployable:
  // there is no `connect`, no Drizzle handle and no key vocabulary, so a caller
  // gets one statement at a time and cannot compose two into a unit of work.
  expect(Object.keys(queueExecutor())).toEqual(['executeSql']);
});

/**
 * The two pairings that DO NOT COMPILE. Never called; `tsc` checks the body.
 *
 * **THIS IS THE PROOF AND NOT AN ASSERTION ABOUT ONE.** ADR-332 partitioned
 * `SqlExecutorReason`: the pool door takes `PoolSqlExecutorReason` and a
 * transaction handle takes `TransactionSqlExecutorReason`, each an `Extract` of
 * ONE member. `tsc` reports an UNUSED `@ts-expect-error` as an error of its own,
 * so if either parameter type were widened back to the union, or either member
 * renamed, these two lines fail `pnpm run typecheck`. A runtime `expect` could
 * not see this at all: the guard past a cast is `packages/db`'s and is asserted
 * there, and what is asserted here is that no cast is NEEDED.
 */
function theTwoPairingsThatDoNotCompile(tx: SystemTx): void {
  // @ts-expect-error ADR-333 section 3: `'job-enqueue'` is one statement inside
  // a caller's transaction and this door outlives every transaction.
  void poolSqlExecutor('job-enqueue');
  // @ts-expect-error ADR-333 section 3: `'job-supervisor'` names a handle that
  // must outlive a transaction, and this handle IS one. ADR-331 section 5
  // measured what happens when the two are confused.
  void tx.sqlExecutor('job-supervisor');
}

test('neither producer can be handed the other producer word', () => {
  // The proof is the function above; this case is what makes it compiled and
  // reported. A declaration nothing references is a declaration a bundler or a
  // future lint rule may drop, and a dropped compile-time proof is silent.
  expect(typeof theTwoPairingsThatDoNotCompile).toBe('function');
  expect(theTwoPairingsThatDoNotCompile.length).toBe(1);
});

// -----------------------------------------------------------------------------
// 4. Construction opens no socket, and the first STATEMENT is what needs one
// -----------------------------------------------------------------------------

test('the door is constructed with no DATABASE_URL and the first statement is what needs it', async () => {
  // `ci.yml`'s jobs run on bare `ubuntu-latest` with no services block, so this
  // module being importable at all is a property rather than an accident:
  // `poolSqlExecutor` resolves the pool PER STATEMENT and `pgBossQueue`
  // constructs a value over the executor it is handed and opens nothing.
  expect(typeof LIVE_QUEUE.declareQueue).toBe('function');

  // AND IT IS PROOF OF WHICH POOL, which is ADR-332 section 7's own reasoning
  // for the same case one package down: the rejection is `client.ts`'s own
  // `DATABASE_URL is unset`, so a door that had built a pool of its own would
  // fail differently or not at all.
  const before = process.env['DATABASE_URL'];
  delete process.env['DATABASE_URL'];
  try {
    await expect(LIVE_QUEUE.declareQueue('adr-333-never-reached')).rejects.toThrow(/DATABASE_URL/);
  } finally {
    if (before !== undefined) process.env['DATABASE_URL'] = before;
  }
});

test('the door is a factory over an executor, so a suite substitutes a recorder', async () => {
  // THE SEAM, EXERCISED RATHER THAN DESCRIBED, on `test/db.test.ts`'s own
  // reasoning: what a substitute proves is that this deployable's queue door can
  // be driven with no `DATABASE_URL`. It proves nothing about what pg-boss's
  // plans do against the applied schema, which needs a backend and is ADR-333
  // section 6.
  const sent: string[] = [];
  const recorder = {
    executeSql(text: string): Promise<{ rows: unknown[] }> {
      sent.push(text.trim().split('\n')[0] ?? '');
      return Promise.resolve({ rows: [] });
    },
  };
  const door = workerQueue(recorder);
  expect(Object.keys(door).sort()).toEqual(['declareQueue', 'enqueue']);
  await door.declareQueue('adr-333-recorded');
  expect(sent.length).toBeGreaterThan(0);
});

// -----------------------------------------------------------------------------
// 5. Nothing is wired, which is this row's own statement of what it did not do
// -----------------------------------------------------------------------------

test('the door has no caller under src, so this row wired nothing', () => {
  // **THE ROW THAT WRITES A DOOR IS NOT THE ROW THAT WIRES A JOB**, which is
  // ADR-326 section 4's refusal and ADR-165 clause 5's rule about whose row an
  // authority change is. The saga still calls its PORT, no adapter over this
  // door exists, `test/schedule.test.ts` case 3.1's caller census is unmoved and
  // the wired counts do not move either.
  const callers = sourceFiles()
    .filter((file) => asPosix(file) !== 'src/queue.ts')
    .filter((file) =>
      /\bLIVE_QUEUE\b|\bworkerQueue\s*\(/.test(stripComments(readFileSync(file, 'utf8'))),
    )
    .map(asPosix);
  expect(callers).toEqual([]);
});
