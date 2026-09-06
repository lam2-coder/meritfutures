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
//   5. **THAT THE DOOR HAS EXACTLY ONE CALLER, AND WHICH ONE.** This heading
//      read "THAT NOTHING IS WIRED. The door exists and no module calls it,
//      which is the state ADR-326's register describes and which this row
//      deliberately does not move", and ADR-338 moved it: the caller is
//      `src/provisioning/queue-adapter.ts` and it is the saga's queue port. The
//      case below is the SAME instrument with a different expected value, and
//      what is still asserted as an absence is that nothing SPENDS the port.
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
import {
  LIVE_PROVISIONING_QUEUE,
  declareProvisioningQueue,
  provisioningJobQueue,
} from '../src/provisioning/queue-adapter.ts';
import { PROVISIONING_QUEUE_NAME } from '../src/provisioning/saga.ts';
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
  // THE STATEMENT AND NOT THE STRING, and the difference was MEASURED here
  // rather than anticipated. The first draft matched `from '@merit/db'`
  // anywhere in the file and reported SEVEN importers of the accessor: six of
  // them are `ports.ts` headers quoting the import form in order to say the
  // file does not use it. That is ADR-165 section 9's finding met a second
  // time, and the instrument is `test/db.test.ts`'s: an `import` or an
  // `export ... from` at the head of a line.
  const pattern = new RegExp(
    `(?:^|\\n)\\s*(?:import|export)[\\s\\S]*?from\\s+'${specifier.replace('/', '\\/')}'`,
  );
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
// 5. The door has exactly one caller, and it is the saga's queue port (ADR-338)
// -----------------------------------------------------------------------------

test('the door has exactly one caller under src, and it is the provisioning queue adapter', () => {
  // **THIS CASE READ `expect(callers).toEqual([])` UNDER THE HEADING "Nothing is
  // wired, which is this row's own statement of what it did not do", AND ADR-338
  // WIRED IT.** It is not deleted and it is not loosened to a length: the
  // instrument is unchanged and only the expected value moved, which is
  // `apps/api/test/ledger-posting-authority.test.ts`'s stated reason for an
  // exact list over a `toContain` -- `toEqual([])` is what made the FIRST caller
  // fail this case, and an exact list of one is what makes the SECOND one fail
  // it. A door with two callers is a decision somebody takes in this file.
  //
  // THE COMMENT STRIPPER IS STILL THE INSTRUMENT, for ADR-165 section 9's
  // recorded reason: `src/index.ts` and `src/queue.ts` both NAME `LIVE_QUEUE` in
  // order to say what does and does not call it, and a substring test would read
  // those sentences as callers.
  const callers = sourceFiles()
    .filter((file) => asPosix(file) !== 'src/queue.ts')
    .filter((file) =>
      /\bLIVE_QUEUE\b|\bworkerQueue\s*\(/.test(stripComments(readFileSync(file, 'utf8'))),
    )
    .map(asPosix);
  expect(callers).toEqual(['src/provisioning/queue-adapter.ts']);
});

test('the adapter publishes enqueue and nothing else, so declareQueue does not reach the saga', () => {
  // ONE METHOD OF THE DOOR'S TWO. `src/queue.ts` section 3 partitioned the
  // executor vocabulary so that a declare runs on the POOL and an enqueue runs
  // inside the caller's transaction; a port carrying both would let a step
  // inside the pipeline reach the pool one. `Object.keys` and not the type, on
  // `workerQueue()`'s own reason: the narrowing is an object literal, so the
  // value HAS one property rather than merely being typed as having one.
  expect(Object.keys(LIVE_PROVISIONING_QUEUE)).toEqual(['enqueue']);
  expect(Object.keys(provisioningJobQueue(LIVE_QUEUE))).toEqual(['enqueue']);
});

test('the adapter hands the CALLER transaction to the door, unsubstituted', () => {
  // **ADR-006's WHOLE CRITERION, AT THE ONE LAYER THIS ROW ADDED.** The saga
  // produces the executor as `tx.sqlExecutor('job-enqueue')` off the same handle
  // the `provisioning_queue` row is inserted on, and an adapter that reached for
  // an executor of its own here would be the saga bug ADR-006 was accepted to
  // remove. Asserted by OBJECT IDENTITY rather than by shape, because a
  // substituted executor of the same shape is exactly the defect.
  const seen: { tx: unknown; request: unknown }[] = [];
  const door: WorkerQueue = {
    declareQueue: () => Promise.reject(new Error('the saga may not declare a queue')),
    enqueue: (tx, request) => {
      seen.push({ tx, request });
      return Promise.resolve('job-1' as never);
    },
  };
  const callerTx = { executeSql: () => Promise.resolve({ rows: [] }) };
  const request = { queue: PROVISIONING_QUEUE_NAME, payload: { a: 1 }, key: 'k' };

  return provisioningJobQueue(door)
    .enqueue(callerTx, request)
    .then((jobId) => {
      expect(jobId).toBe('job-1');
      expect(seen).toHaveLength(1);
      expect(seen[0]?.tx).toBe(callerTx);
      expect(seen[0]?.request).toBe(request);
    });
});

test('a deduplicated enqueue returns null through the adapter, because null is a success', () => {
  // `job-queue.ts` brands `JobId` precisely so a caller cannot read this null as
  // an error and retry, and `saga.ts` treats it as the success it is. An adapter
  // that threw on it, or coerced it, would make an idempotency key decoration.
  const door: WorkerQueue = {
    declareQueue: () => Promise.resolve(),
    enqueue: () => Promise.resolve(null),
  };
  return expect(
    provisioningJobQueue(door).enqueue(
      { executeSql: () => Promise.resolve({ rows: [] }) },
      {
        queue: PROVISIONING_QUEUE_NAME,
        payload: {},
      },
    ),
  ).resolves.toBeNull();
});

test('declareProvisioningQueue declares the saga queue by the ONE name that declares it', () => {
  // IT MINTS NO NAME. `PROVISIONING_QUEUE_NAME` is declared in `saga.ts` and a
  // second constant in the adapter would be two statements of one fact. The case
  // reads the constant rather than the string, so a rename moves both together.
  //
  // **AND THE QUEUE IS NOT DECLARED ANYWHERE ELSE**, which is why this function
  // exists at all: `0079_pgboss_job_store.sql` says in its own words that
  // "`pgboss.queue` ships empty", and pg-boss refuses an undeclared queue.
  const declared: string[] = [];
  const door: WorkerQueue = {
    declareQueue: (name) => {
      declared.push(name);
      return Promise.resolve();
    },
    enqueue: () => Promise.reject(new Error('a declare is not an enqueue')),
  };
  return declareProvisioningQueue(door).then(() => {
    expect(declared).toEqual([PROVISIONING_QUEUE_NAME]);
    expect(PROVISIONING_QUEUE_NAME).toBe('provisioning');
  });
});

test('the live port is the real door and opens no socket until its first statement', async () => {
  // PROOF OF WHICH DOOR, on the reason case 4 gives for the same measurement one
  // layer down: the rejection is `client.ts`'s own `DATABASE_URL is unset`, so an
  // adapter built over a second pool, or over a double, would fail differently or
  // not at all. Importing this module has already happened at the head of this
  // file and connected nothing.
  const before = process.env['DATABASE_URL'];
  delete process.env['DATABASE_URL'];
  try {
    await expect(
      LIVE_PROVISIONING_QUEUE.enqueue(
        { executeSql: () => Promise.resolve({ rows: [] }) },
        { queue: PROVISIONING_QUEUE_NAME, payload: {} },
      ),
    ).rejects.toThrow(/DATABASE_URL/);
  } finally {
    if (before !== undefined) process.env['DATABASE_URL'] = before;
  }
});

test('nothing enqueues, which is what stops the job store growing', () => {
  // **THE HALF THIS ROW DID NOT WIRE, ASSERTED RATHER THAN PROMISED.** The door
  // withholds `consume` and `start`, so nothing in this deployable may drain
  // `pgboss.job`; what keeps that from being a growing table is that nothing
  // WRITES to it, and that is a fact about the tree which this case reads. The
  // day a caller lands, this case goes red and the row that lands it owes a
  // drain or owes the argument for running without one (ADR-338 section 4).
  //
  // THE ADAPTER'S OWN MODULE IS EXCLUDED because it declares the two names, and
  // nothing else is.
  // **THE INSTRUMENT EXCLUDES THREE MODULES BY NAME AND THE EXCLUSIONS WERE
  // MEASURED RATHER THAN ANTICIPATED.** The first draft of this case excluded
  // only the adapter and reported three "spenders", every one of them a
  // re-export or a declaration: `src/provisioning/queue-adapter.ts` declares the
  // two names, and `src/index.ts` and `src/provisioning/index.ts` are BARRELS
  // whose `export { LIVE_PROVISIONING_QUEUE, ... }` clause is a bare reference
  // that no comment stripper removes. That is ADR-165 section 9's finding in a
  // third costume, and the answer here is the register's own: name the three
  // modules, and count a CALL and never a mention anywhere else.
  const declaring = new Set([
    'src/provisioning/queue-adapter.ts',
    'src/index.ts',
    'src/provisioning/index.ts',
  ]);
  const spenders = sourceFiles()
    .filter((file) => !declaring.has(asPosix(file)))
    .filter((file) => {
      const body = stripComments(readFileSync(file, 'utf8'));
      return (
        /\bLIVE_PROVISIONING_QUEUE\s*[.,)]/.test(body) ||
        /(?<!function )\bdeclareProvisioningQueue\s*\(/.test(body) ||
        /(?<!function )\brunProvisioningSaga\s*\(/.test(body)
      );
    })
    .map(asPosix);
  expect(spenders).toEqual([]);

  // AND THE THREE EXCLUSIONS ARE NOT A HOLE, because each is asserted elsewhere:
  // the adapter's own surface is the case above, and both barrels are held by
  // `test/digests.test.ts`'s total sweep over `WORKER_BARREL_LEGS`,
  // `WORKER_MODULES_BEHIND_A_LEG` and `WORKER_MODULES_NOT_RE_EXPORTED`.
  for (const module of declaring)
    expect(sourceFiles().map(asPosix), `${module} is excluded and does not exist`).toContain(
      module,
    );
});

// -----------------------------------------------------------------------------
// 6. ADR-355: the drain is OWED, its shape is a one-shot pull, and neither the
//    interface nor this deployable can express one yet
// -----------------------------------------------------------------------------
// **THESE THREE CASES BIND A RULING RATHER THAN A WIRE, and the first is built
// to FAIL ON GOOD NEWS.** ADR-355 ruled that this deployable owes a drain for
// `PROVISIONING_QUEUE_NAME`, that the shape owed is a bounded pull which claims,
// settles, reports and exits, and that `consume` and `start` therefore stay
// withheld because those are the process that stays up. The reason no drain
// LANDED with that ruling is section 5.2: `JobQueue` publishes five methods and
// not one of them takes a job off a queue, so the first slice is a SIXTH method
// and ADR-165 clause 5 makes that `packages/queue`'s row and not this one's.
//
// A paragraph saying so goes stale in silence. The case below goes RED the day
// the sixth method lands, which is the day the drain becomes buildable and the
// day somebody should re-read the ruling rather than discover it by grep.

test('JobQueue publishes no pull, so the drain ADR-355 ruled owed is not expressible yet', () => {
  // THE LIST IS `packages/queue`'s OWN DATA, read rather than restated, which is
  // case 2's instrument pointed at a different property: case 2 asks WHICH of
  // the five this door takes, and this one asks whether any of the five is the
  // kind of method a drain is built from.
  expect([...JOB_QUEUE_METHODS].sort()).toEqual([
    'consume',
    'declareQueue',
    'enqueue',
    'start',
    'stop',
  ]);

  // **`consume` IS NOT A PULL AND THAT IS THE WHOLE DISTINCTION ADR-355 TURNS
  // ON.** `pgBossQueue` implements it as `boss.work()`, which registers a
  // handler and stays up; `manager.work` throws "Workers are disabled" when the
  // instance is stopped. A pull is `fetch`/`complete`/`fail`: one statement on
  // the caller's own handle, no supervisor, and a rejection that reaches the
  // caller. None of those three names is on this interface.
  const pulls = JOB_QUEUE_METHODS.filter((method) =>
    ['fetch', 'complete', 'fail', 'poll', 'drain'].includes(method),
  );
  expect(
    pulls,
    'a pull arrived on JobQueue: ADR-355 section 5.2 is now actionable and the drain is buildable',
  ).toEqual([]);
});

test('nothing under src drains a job, which is the absence ADR-355 rules is owed', () => {
  // THE ABSENCE IS BOUND THE WAY `RI-35` BINDS ONE, over STRIPPED source, which
  // is ADR-338's lesson applied ahead of the case: this file, `src/queue.ts` and
  // `src/provisioning/queue-adapter.ts` all now DISCUSS `fetch`, `complete` and
  // `fail` at length in prose, and a substring test over raw source would read
  // those sentences as the very wiring they say does not exist.
  const drainers = sourceFiles()
    .filter((file) => {
      const body = stripComments(readFileSync(file, 'utf8'));
      return /\.(?:fetch|complete|fail)\s*\(/.test(body);
    })
    .map(asPosix);
  expect(
    drainers,
    'a drain landed under src: ADR-355 ruled the shape, and the row that landed it owes the cycle, the batch size and the attempt ceiling section 8 leaves open',
  ).toEqual([]);
});

test('the advance and read ports are taken by no function, which three files said otherwise', () => {
  // **ADR-355 SECTION 7.** `src/index.ts` read "`runProvisioningSaga` takes a
  // queue, a platform, an advance port and a read port", and `schedule.ts` and
  // `queue-adapter.ts` carried the same claim. It takes neither: `SagaIo`'s four
  // members are `tx`, `queue`, `platform` and `rows`, and the last is DATA.
  //
  // THE CHECK IS A PARAMETER POSITION AND NEVER A MENTION, because all three
  // corrections quote the port names in order to say they are not taken.
  const takers = sourceFiles()
    .filter((file) => {
      const body = stripComments(readFileSync(file, 'utf8'));
      // A type annotation in an argument or a member position, which is what a
      // port being CONSUMED looks like. The declarations in `ports.ts` are
      // `export interface X {`, which this does not match.
      return /:\s*Provisioning(?:Advance|Read)Port\b/.test(body);
    })
    .map(asPosix);
  expect(
    takers,
    'a function now takes the advance or read port: ADR-355 section 7 recorded that none did',
  ).toEqual([]);

  // AND THE TWO INTERFACES STILL EXIST, so this case cannot pass by their
  // deletion, which would make the assertion above vacuously true.
  const ports = readFileSync(join(APP, 'src/provisioning/ports.ts'), 'utf8');
  expect(ports).toContain('export interface ProvisioningAdvancePort');
  expect(ports).toContain('export interface ProvisioningReadPort');
});
