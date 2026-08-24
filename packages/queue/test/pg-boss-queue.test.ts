// =============================================================================
// packages/queue/test/pg-boss-queue.test.ts
// =============================================================================
// THE VALIDATING HALF OF ADR-086, AND IT IS WRITTEN AGAINST THE FAILURE
// DIRECTION RATHER THAN THE SUCCESS ONE. ADR-006's consequence is that "enqueue
// participates in the same transaction as the state change that caused it,
// which removes a whole class of saga bugs ('committed the purchase, lost the
// provisioning job')". The direction that bug arrives from is an enqueue that
// does NOT roll back with its transaction, so `rolls back with the transaction`
// below is the case the entry's approval clause names, and `commits with the
// transaction` beside it is what stops that case from passing vacuously against
// an enqueue that writes nothing at all.
//
// EVERY EXPECTATION IS TAKEN FROM pg-boss'S OWN EMITTED SQL AND VALUES, never
// from `pg-boss-queue.ts`. ADR-084 section 7 is why: that session's first suite
// passed all 22 assertions against a seeded violation because the expected value
// was read out of the code under test. The statements here are captured verbatim
// off the connection they landed on.
//
// NO DATABASE, DELIBERATELY. These run in the `unit` project on every push.
// `CI-04`'s second leg is still a dated condition (STRATEGY section 4.1), so a
// suite that needed a live Postgres would be a suite that has never run.

import { describe, expect, test, vi } from 'vitest';

import { pgBossQueue, QUEUE_SCHEMA } from '../src/pg-boss-queue.js';
import type { DeliveredJob, JobId } from '../src/job-queue.js';
import {
  fakeDatabase,
  insertAccepted,
  insertDeduplicated,
  jobInserts,
  queueMetadata,
  type Responder,
  type Statement,
} from './fake-database.js';

const QUEUE = 'provisioning';

/** The job payload pg-boss serialises into `$1`. One job per insert. */
function insertedJob(statement: Statement): Record<string, unknown> {
  const [payload] = statement.values;
  expect(typeof payload).toBe('string');
  const jobs: unknown = JSON.parse(payload as string);
  expect(Array.isArray(jobs)).toBe(true);
  const [job] = jobs as Record<string, unknown>[];
  expect(job).toBeDefined();
  return job as Record<string, unknown>;
}

describe('enqueue rides on the transaction it is given', () => {
  test('the insert lands on the caller transaction and never on the queue connection', async () => {
    const db = fakeDatabase();
    const queueConnection = db.autocommit(queueMetadata(QUEUE));
    const tx = db.begin(insertAccepted('11111111-1111-1111-1111-111111111111'));

    const id = await pgBossQueue(queueConnection).enqueue(tx, {
      queue: QUEUE,
      payload: { accountId: 'acct-1' },
    });

    expect(id).toBe('11111111-1111-1111-1111-111111111111');

    // THE INSERT IS ON THE TRANSACTION. Matched on pg-boss's own SQL and on the
    // schema this package names, so a change of either is a failure here rather
    // than a silent pass.
    const onTx = jobInserts(tx.statements);
    expect(onTx).toHaveLength(1);
    expect(onTx[0]?.text).toContain(`INSERT INTO ${QUEUE_SCHEMA}.`);

    // AND NOWHERE ELSE. Deleting `db: tx` from the adapter moves this insert
    // onto `queueConnection`, and this is the assertion that says so.
    expect(jobInserts(queueConnection.statements)).toHaveLength(0);

    // The queue connection is not idle: it read the queue's row. That read is
    // asserted rather than tolerated, because "the transaction carries the whole
    // enqueue" would be a stronger claim than this design makes.
    expect(queueConnection.statements).toHaveLength(1);
    expect(queueConnection.statements[0]?.text).toContain('q.name');
  });

  test('rolls back with the transaction', async () => {
    const db = fakeDatabase();
    const queueConnection = db.autocommit(queueMetadata(QUEUE));
    const tx = db.begin(insertAccepted('22222222-2222-2222-2222-222222222222'));

    await pgBossQueue(queueConnection).enqueue(tx, {
      queue: QUEUE,
      payload: { accountId: 'acct-1' },
    });
    tx.rollback();

    // THE CLAUSE. The enqueue ran, the transaction did not commit, and no job
    // write is durable. An enqueue that reached any connection other than `tx`
    // would have committed on its own and would be in this list.
    expect(jobInserts(db.committed)).toHaveLength(0);

    // The enqueue really did happen, so the emptiness above is the rollback and
    // not an enqueue that never ran.
    expect(jobInserts(tx.statements)).toHaveLength(1);
  });

  test('commits with the transaction', async () => {
    const db = fakeDatabase();
    const queueConnection = db.autocommit(queueMetadata(QUEUE));
    const tx = db.begin(insertAccepted('33333333-3333-3333-3333-333333333333'));

    await pgBossQueue(queueConnection).enqueue(tx, {
      queue: QUEUE,
      payload: { accountId: 'acct-1' },
    });
    tx.commit();

    // WITHOUT THIS CASE THE ROLLBACK CASE IS VACUOUS: an enqueue that wrote
    // nothing at all would satisfy it. The pair is the assertion.
    expect(jobInserts(db.committed)).toHaveLength(1);
  });
});

describe('the request translates into pg-boss job fields', () => {
  test('every optional field reaches the inserted job, read back out of pg-boss', async () => {
    const db = fakeDatabase();
    const queueConnection = db.autocommit(queueMetadata(QUEUE));
    const tx = db.begin(insertAccepted('44444444-4444-4444-4444-444444444444'));
    const notBefore = new Date('2026-09-01T14:30:00.000Z');

    await pgBossQueue(queueConnection).enqueue(tx, {
      queue: QUEUE,
      payload: { accountId: 'acct-1' },
      key: 'provision:acct-1',
      notBefore,
      retryLimit: 4,
      retryDelaySeconds: 30,
    });

    const inserted = jobInserts(tx.statements)[0];
    expect(inserted).toBeDefined();
    const job = insertedJob(inserted as Statement);

    expect(job['name']).toBe(QUEUE);
    expect(job['data']).toEqual({ accountId: 'acct-1' });
    // `key` IS THE IDEMPOTENCY KEY AND pg-boss SPELLS IT `singletonKey`. The
    // interface does not adopt the vendor's spelling, so this assertion is what
    // holds the translation in place.
    expect(job['singletonKey']).toBe('provision:acct-1');
    // AN ISO-8601 STRING AND NOT A `Date`, because pg-boss `JSON.stringify`s the
    // job before it reaches `$1`. Asserted in the form it actually crosses the
    // wire in: the corpus stores timestamps UTC, and this is what UTC looks like
    // by the time the database sees it.
    expect(job['startAfter']).toBe(notBefore.toISOString());
    expect(job['retryLimit']).toBe(4);
    expect(job['retryDelay']).toBe(30);
  });

  test('an omitted field is omitted rather than sent as a default this package invented', async () => {
    const db = fakeDatabase();
    const queueConnection = db.autocommit(queueMetadata(QUEUE));
    const tx = db.begin(insertAccepted('55555555-5555-5555-5555-555555555555'));

    await pgBossQueue(queueConnection).enqueue(tx, { queue: QUEUE, payload: {} });

    const inserted = jobInserts(tx.statements)[0];
    const job = insertedJob(inserted as Statement);

    // NULL AND NOT A VALUE. A retry policy invented here would silently override
    // the one the queue was declared with, which is the queue owner's decision
    // and not the caller's.
    expect(job['singletonKey']).toBeNull();
    expect(job['retryLimit']).toBeUndefined();
    expect(job['retryDelay']).toBeUndefined();
  });
});

describe('deduplication is an answer and not an error', () => {
  test('a key that matched a live job returns null', async () => {
    const db = fakeDatabase();
    const queueConnection = db.autocommit(queueMetadata(QUEUE));
    const tx = db.begin(insertDeduplicated);

    const id: JobId | null = await pgBossQueue(queueConnection).enqueue(tx, {
      queue: QUEUE,
      payload: {},
      key: 'provision:acct-1',
    });

    // pg-boss RETURNS NO ROW when the singleton key collides, and this interface
    // passes that through as `null`. It does not throw: the caller of an
    // idempotent enqueue wants to know WHICH of the two happened, and a retry on
    // a deduplicated enqueue is how an idempotency key becomes decoration.
    expect(id).toBeNull();
    expect(jobInserts(tx.statements)).toHaveLength(1);
  });
});

describe('the queue registers on its own connection', () => {
  test('declareQueue writes through the queue connection, not through a transaction', async () => {
    const db = fakeDatabase();
    const queueConnection = db.autocommit(() => []);

    await pgBossQueue(queueConnection).declareQueue(QUEUE);

    // pg-boss's OWN SQL for this, quoted rather than paraphrased: it calls the
    // schema's `create_queue` function under an advisory lock.
    expect(queueConnection.statements.length).toBeGreaterThan(0);
    const registered = queueConnection.statements.filter((s) =>
      s.text.includes(`${QUEUE_SCHEMA}.create_queue('${QUEUE}'`),
    );
    expect(registered).toHaveLength(1);
    // Declaring a queue is a schema-level act with no state change to join, so
    // it is deliberately NOT on the enqueue's transactional path.
    expect(db.committed.length).toBe(queueConnection.statements.length);
  });
});

describe('the queue does not install its own schema', () => {
  test('start() refuses on a database with no pg-boss installation, and emits no DDL', async () => {
    const notInstalled: Responder = (text) => {
      if (text.includes('version()')) return [{ version: 'PostgreSQL 16.4' }];
      if (text.includes('to_regclass')) return [{ name: null }];
      return [];
    };
    const db = fakeDatabase();
    const queueConnection = db.autocommit(notInstalled);

    // pg-boss DEFAULTS `migrate` TO TRUE, so the stock configuration would
    // install its schema here. `pg-boss-queue.ts` sets it false, which turns a
    // silent DDL run against the money database into a refusal.
    const outcome: Error | null = await pgBossQueue(queueConnection)
      .start()
      .then(
        () => null,
        (error: unknown) => error as Error,
      );

    // THE DDL ASSERTION COMES FIRST AND IT NAMES WHAT IT FOUND. Under
    // `migrate: true` pg-boss issues its construction plans inside a `BEGIN;
    // ... pg_advisory_xact_lock` block, so the DDL is not at the start of the
    // statement and an anchored pattern would miss it. Asserting the LIST rather
    // than a length is what makes the seeded failure print the schema it was
    // about to create instead of "expected 1 to be 0".
    const CREATES = /\bCREATE\s+(?:SCHEMA|TABLE|INDEX|FUNCTION|TYPE)\s+\S+/i;
    const ddl = queueConnection.statements
      .map((s) => CREATES.exec(s.text)?.[0])
      .filter((found): found is string => found !== undefined);
    expect(ddl).toEqual([]);

    expect(outcome).not.toBeNull();
    expect(outcome?.message).toMatch(/not installed/i);
  });
});

describe('a consumer sees one job per call', () => {
  test('a pg-boss batch is flattened in order', async () => {
    const fetched = { done: false };
    const worker: Responder = (text) => {
      if (text.includes('q.name')) {
        return [{ name: QUEUE, policy: 'standard', table: 'j', notify: false }];
      }
      if (text.includes("state = 'active'")) {
        if (fetched.done) return [];
        fetched.done = true;
        return [
          { id: 'job-1', name: QUEUE, data: { n: 1 } },
          { id: 'job-2', name: QUEUE, data: { n: 2 } },
        ];
      }
      return [];
    };
    const db = fakeDatabase();
    const queue = pgBossQueue(db.autocommit(worker));
    const seen: DeliveredJob[] = [];

    await queue.consume(QUEUE, async (job) => {
      seen.push(job);
    });
    await vi.waitFor(() => expect(seen).toHaveLength(2), { timeout: 5000 });
    await queue.stop();

    // ONE JOB PER CALL, IN ORDER. pg-boss hands its handler an array even at the
    // default batch size of one; the interface hands its handler a job, because
    // that is the shape a Redis-backed queue can also serve.
    expect(seen.map((j) => j.id)).toEqual(['job-1', 'job-2']);
    expect(seen.map((j) => j.queue)).toEqual([QUEUE, QUEUE]);
    expect(seen.map((j) => j.payload)).toEqual([{ n: 1 }, { n: 2 }]);
  });
});
