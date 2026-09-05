// =============================================================================
// packages/db/test/pool-executor.test.ts -- CI-02, the `unit` project.
// =============================================================================
// THE VALIDATING HALF OF ADR-332: the POOL-shaped raw-SQL door, and the two
// things that keep it from being `client()` under another name.
//
// -----------------------------------------------------------------------------
// WHY THERE IS A SECOND PRODUCER AT ALL
// -----------------------------------------------------------------------------
// ADR-331 section 5 measured that `sqlExecutorOn` cannot construct the job
// queue, for a reason its own repair does not touch. Every plan pg-boss wraps in
// its `locked()` helper renders `BEGIN ... COMMIT` as ONE multi-statement
// string, so running one on a caller's OPEN transaction commits that
// transaction: ADR-006's whole consequence, that an enqueue rides the state
// change that caused it, gone one statement into construction. The executor the
// queue is constructed with therefore has to outlive every transaction, which
// means it has to come off the pool, which means it can only come from this
// package: `merit/no-raw-db-client` (VG-4) bans `pg` everywhere else and
// ADR-084 section 9 keeps `client()` unexported permanently.
//
// -----------------------------------------------------------------------------
// TWO OF THE THREE CASES BELOW NEED NO DATABASE AND THE REST DO, AND THE SPLIT
// IS SAID OUT LOUD RATHER THAN HIDDEN IN A SKIP
// -----------------------------------------------------------------------------
// `ci.yml`'s jobs run on bare `ubuntu-latest` with no services block, so the
// database-backed block below is SKIPPED there and runs for anybody who exports
// a `DATABASE_URL`. That is the degradation `apps/api/test/admin-writes.test.ts`
// already takes for its own reason cases, and it is honest in a way a case that
// silently asserts nothing is not: a skipped case reports as skipped.
//
// WHAT THE SKIPPED HALF IS FOR IS THE ONE PROPERTY NO TYPE CAN CARRY.
// `packages/queue/src/job-queue.ts` says it in its own words about
// `JobTransaction`: "being inside a transaction is a fact about a connection at
// a moment and no TypeScript type observes a moment." The hazard this door has
// and the transaction-bound one does not is exactly a fact about a moment -- a
// statement can leave a POOLED connection inside a transaction, where the money
// path's own `transaction()` would later check it out -- so it is measured
// against a real backend or it is not measured at all.

import { describe, expect, test } from 'vitest';

import { poolSqlExecutor, systemDb, transaction } from '../src/scoped-db.ts';
import { closeClient } from '../src/client.ts';

const DATABASE_URL = process.env['DATABASE_URL'];
const HAS_DATABASE = DATABASE_URL !== undefined && DATABASE_URL !== '';

/** `now()` is the transaction's clock and `statement_timestamp()` is the statement's. */
const IN_A_TRANSACTION =
  'SELECT now() < statement_timestamp() AS in_a_transaction, pg_backend_pid() AS pid';

const first = (rows: unknown[]): Record<string, unknown> => rows[0] as Record<string, unknown>;

describe('the pool door is a word somebody writes, and the vocabulary is partitioned', () => {
  test('the pool producer refuses the TRANSACTION producer`s member, even past a cast', () => {
    // The type already refuses it. This is the runtime half, on `sqlExecutorOn`'s
    // own stated reason: "so the parameter is not decorative, and so a cast past
    // the type still names its reason".
    expect(() => poolSqlExecutor('job-enqueue' as never)).toThrow(/not a reason to run raw SQL/);
    expect(() => poolSqlExecutor('whatever' as never)).toThrow(/not a reason to run raw SQL/);
  });

  // THE OTHER DIRECTION IS ASSERTED IN `write-accessor.test.ts`, beside the
  // three transaction authorities and the recording connection that already
  // exist there, so that a caller writing `'job-supervisor'` on a transaction
  // handle meets a case whichever of the two files a session opens. ADR-331
  // section 4 clause 2 is what makes that direction the important one: a member
  // minted on a transaction-bound producer "would hand the next session a door
  // that names the right intention and does the wrong thing".

  test('it yields the one-method shape and nothing else', () => {
    // The same shape the three transaction authorities produce. A second method
    // here would be a second thing a caller can do with a pool, which is the
    // whole of what `client()` staying unexported prevents.
    expect(Object.keys(poolSqlExecutor('job-supervisor'))).toEqual(['executeSql']);
  });
});

describe.skipIf(HAS_DATABASE)('with no DATABASE_URL, which is what CI has', () => {
  test('constructing the door opens no socket, and the FIRST statement is what needs one', async () => {
    // `client.ts`'s pool is lazy and that laziness is load-bearing: "the corpus
    // gates, the golden loader and every unit test import `@merit/db` for its
    // types". A door that resolved the pool at construction would make
    // constructing a queue a connection attempt.
    //
    // AND THE ERROR IS THE PROOF OF WHICH POOL IT IS. The message belongs to
    // `client.ts`'s own `connectionString()`, so a door that had built a pool of
    // its own would fail differently or not at all. That is ADR-084 section 2's
    // ruling -- the queue runs on THIS pool, because "a transaction is
    // per-connection, so a second driver is a second pool" -- asserted rather
    // than described.
    const executor = poolSqlExecutor('job-supervisor');
    await expect(executor.executeSql('SELECT 1')).rejects.toThrow(/DATABASE_URL is unset/);
  });
});

describe.skipIf(!HAS_DATABASE)('at a real backend', () => {
  test('a MULTI-STATEMENT plan comes back FLATTENED here too, not just on the transaction door', async () => {
    // ADR-331's repair, on the producer that did not exist when it landed. This
    // is the shape every `locked()` plan takes and the shape that used to return
    // `{ rows: undefined }`.
    const executor = poolSqlExecutor('job-supervisor');
    const out = await executor.executeSql('BEGIN; SELECT 1 AS a; SELECT 2 AS a; COMMIT;');
    expect(out.rows).toEqual([{ a: 1 }, { a: 2 }]);
    await closeClient();
  });

  test('a statement that leaves a transaction open CANNOT hand that connection back to the pool', async () => {
    // THE HAZARD THIS DOOR HAS AND THE TRANSACTION-BOUND ONE CANNOT. `pg`'s pool
    // returns a released client to the idle set and hands the same backend to
    // the next caller, so a bare `BEGIN` through a door built on `pool.query`
    // survives into the next statement AND into whatever checks that connection
    // out afterwards -- which, on this pool, is `transaction()` running a money
    // write. Measured before it was closed: three statements through such a door
    // reported the same `pg_backend_pid` and `in_a_transaction` true twice.
    //
    // The door releases with DESTROY whenever the backend is not idle, so the
    // dirty connection is burned rather than pooled. Both halves are asserted:
    // the next statement is not in a transaction, and it is a DIFFERENT backend.
    const executor = poolSqlExecutor('job-supervisor');
    const before = first((await executor.executeSql(IN_A_TRANSACTION)).rows);
    await executor.executeSql('BEGIN');
    const after = first((await executor.executeSql(IN_A_TRANSACTION)).rows);
    expect(after['in_a_transaction']).toBe(false);
    expect(after['pid']).not.toEqual(before['pid']);
    await closeClient();
  });

  test('a BALANCED plan costs no connection, so the closure above is not a churn', async () => {
    // THE COST OF THE CLOSURE, MADE MECHANICAL. Everything pg-boss sends is
    // balanced: `locked()` renders its own `BEGIN` and its own `COMMIT` inside
    // ONE string, so the backend is idle when the statement returns and the
    // connection goes back to the pool like any other. A door that destroyed
    // unconditionally would open one connection per statement against the money
    // database forever, which is a real operational cost paid for a hazard no
    // balanced statement has.
    const executor = poolSqlExecutor('job-supervisor');
    const plan = 'BEGIN; SET LOCAL lock_timeout = 30000; SELECT 1 AS a; COMMIT;';
    await executor.executeSql(plan);
    const one = first((await executor.executeSql(IN_A_TRANSACTION)).rows);
    await executor.executeSql(plan);
    const two = first((await executor.executeSql(IN_A_TRANSACTION)).rows);
    expect(two['pid']).toEqual(one['pid']);
    await closeClient();
  });

  test('it is the pool `transaction()` runs on, proved by the lifecycle they share', async () => {
    // `closeClient()` ends the ONE pool `client()` holds. A door with a pool of
    // its own would keep working across it with its own backend; this one is
    // handed a new backend by the new pool, and a `transaction()` opened either
    // side of the close reaches the same database.
    const executor = poolSqlExecutor('job-supervisor');
    const before = first((await executor.executeSql(IN_A_TRANSACTION)).rows);
    await closeClient();
    const after = first((await executor.executeSql(IN_A_TRANSACTION)).rows);
    expect(after['pid']).not.toEqual(before['pid']);
    const inside = await transaction(systemDb('nightly-batch'), () => Promise.resolve('ran'));
    expect(inside).toBe('ran');
    await closeClient();
  });
});
