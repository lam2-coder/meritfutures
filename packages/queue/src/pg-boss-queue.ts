// =============================================================================
// packages/queue/src/pg-boss-queue.ts
// =============================================================================
// THE ONLY FILE IN THE WORKSPACE THAT NAMES `pg-boss`. ADR-006 chose it and
// closed with the sentence this file is graded against: "the job interface stays
// narrow enough that a later move to BullMQ is a contained change." A move is
// contained exactly while the vendor's name appears in one module, so
// `test/surface.test.ts` asserts that it does, over the whole tree.
//
// -----------------------------------------------------------------------------
// IT OPENS NO POOL, AND IT CANNOT
// -----------------------------------------------------------------------------
// `pgBossQueue` is handed an EXECUTOR and constructs pg-boss over it, so this
// package never builds a connection and never reads `DATABASE_URL`. That is not
// tidiness, it is ADR-084 section 2's ruling made mechanical: `pg` was chosen
// over postgres.js at a measured cost of 14 packages BECAUSE a transaction is
// per-connection and a second driver is a second pool, at which point ADR-006's
// consequence "stops being implementable". A queue that could open its own pool
// would spend that cost and buy nothing with it.
//
// pg-boss's `ConstructorOptions.db` is what makes this possible: supplied, it is
// returned verbatim from the boss's own `getDb()` and no `pg.Pool` is ever
// constructed. That was verified against pg-boss@12.28.0's `dist/index.js`
// rather than assumed, and `test/pg-boss-queue.test.ts` runs the whole enqueue
// path with no database in the container.
//
// -----------------------------------------------------------------------------
// `migrate: false`, AND IT IS A REFUSAL RATHER THAN A DEFAULT
// -----------------------------------------------------------------------------
// pg-boss defaults `migrate` to TRUE (`dist/attorney.js`: `config.migrate =
// ('migrate' in config) ? config.migrate : true`), which means the stock
// configuration runs DDL against the money database at `start()`, from a
// library, outside the migration set. ADR-008 makes migrations "plain SQL files
// that can be reviewed line by line" and constitution E2 makes them sacred once
// merged. A queue that installs its own schema at boot puts tables inside the
// PITR boundary that protects the ledger with no review and no migration number.
//
// So it is off, and the schema arrives the way every other table in this system
// arrives: as a numbered migration, whose body pg-boss itself emits through
// `getConstructionPlans(schema)`. `0079_pgboss_job_store.sql` is that migration
// (ADR-318, 2026-09-03) and `0082_pgboss_app_grants.sql` is the grant that makes
// it reachable by the application role (ADR-327). `start()` against a database
// carrying neither FAILS, loudly, which is the right failure: the alternative is
// a silent install.
//
// **THIS PARAGRAPH READ "THAT MIGRATION DOES NOT EXIST YET and this package
// cannot write it: migration numbers are allocated in ALLOCATION and
// `packages/db/migrations/**` is outside session 147's fence", AND `0079` MADE
// IT FALSE ON THE DAY IT MERGED.** It is kept beside its correction rather than
// deleted, because the shape of the error is the point and it is the point for
// the FOURTH time: ADR-324 repaired one site of this class, ADR-326 repaired the
// worker barrel's, and ADR-326 section 8 finding 1 named this one and left it,
// on the argument that the row which repairs it should bring an assertion rather
// than a wording change. `test/surface.test.ts` now reads
// `packages/db/migrations` and fails on the retired wording, so the next
// migration that changes this answer turns a case red instead of a comment
// stale. A sentence about a directory should be derived from that directory.

import { PgBoss } from 'pg-boss';

import type {
  DeliveredJob,
  JobHandler,
  JobId,
  JobPayload,
  JobQueue,
  JobRequest,
  JobTransaction,
} from './job-queue.ts';

/**
 * The Postgres schema pg-boss owns.
 *
 * NAMED HERE AND NOWHERE ELSE, so the migration that installs it and the runtime
 * that reads it cannot disagree by a spelling. `pgboss` is pg-boss's own default
 * and is kept rather than renamed: a schema name that differs from the vendor's
 * default is a fact every operator has to be told.
 */
export const QUEUE_SCHEMA = 'pgboss';

/** How `pgBossQueue` may be configured. Deliberately two fields. */
export interface PgBossQueueOptions {
  /** Override the schema. For tests that need two installations, and for nothing else. */
  readonly schema?: string;
  /** What this connection calls itself in `pg_stat_activity`. */
  readonly applicationName?: string;
}

/**
 * The job interface, over pg-boss, over an executor somebody else owns.
 *
 * @param executor the connection pg-boss uses for its OWN work: queue metadata,
 *   the polling fetch, maintenance and completion. It is NOT the enqueue path.
 *   Every `enqueue` rides on the transaction its caller passes in, and this
 *   executor is never substituted for it.
 *
 *   IT MUST NOT BE ONE OPEN TRANSACTION, AND THAT IS A MEASUREMENT (ADR-331).
 *   Most of what the library runs on this handle is wrapped in its own
 *   `locked()` helper, which renders `BEGIN ... COMMIT` as one multi-statement
 *   string. Handed a caller's open transaction, the first such plan COMMITS it,
 *   which is ADR-006's consequence lost one statement into construction; and
 *   `pg` resolves a multi-statement string to one result PER STATEMENT, so an
 *   executor that reads `.rows` off that array hands back `undefined` and the
 *   supervise pass dies on it. What this parameter wants is a pool: one
 *   connection per statement, which is what the vendor's own driver is.
 */
export function pgBossQueue(executor: JobTransaction, options: PgBossQueueOptions = {}): JobQueue {
  const boss = new PgBoss({
    db: executor,
    schema: options.schema ?? QUEUE_SCHEMA,
    // See this file's header. The default is `true` and that default would run
    // DDL on the money database from inside a library.
    migrate: false,
    // pg-boss's LISTEN/NOTIFY path needs "a pg-boss-owned pool (or an adapter
    // that supports `listen`)" and holds a dedicated session-pinned connection.
    // `JobTransaction` has one method and it is not `listen`, which is the same
    // decision as `migrate` seen from the other side: this package is handed a
    // connection rather than owning one, so it polls. Stated because polling
    // latency is a real cost and a reader should not have to derive it.
    useListenNotify: false,
    ...(options.applicationName === undefined ? {} : { application_name: options.applicationName }),
  });

  return {
    async declareQueue(queue: string): Promise<void> {
      await boss.createQueue(queue);
    },

    async enqueue<P extends JobPayload>(
      tx: JobTransaction,
      request: JobRequest<P>,
    ): Promise<JobId | null> {
      // `db: tx` IS THE WHOLE RULING. pg-boss's `createJob` reads
      // `const db = wrapper || this.db` and runs the INSERT on it, so this one
      // property is the difference between a job that rolls back with the state
      // change that caused it and the saga bug ADR-006 was accepted to remove.
      // `test/pg-boss-queue.test.ts` asserts the insert reaches `tx` and that
      // the constructor's executor sees no insert at all; deleting this property
      // is the seeded violation that case was watched failing on.
      //
      // The queue-metadata READ still goes to the constructor's executor, and
      // that is correct: it is a cached lookup of a row this enqueue does not
      // write, and holding it inside the caller's transaction would lengthen a
      // money-path transaction to no purpose.
      const id = await boss.send(request.queue, request.payload, {
        db: tx,
        ...(request.key === undefined ? {} : { singletonKey: request.key }),
        ...(request.notBefore === undefined ? {} : { startAfter: request.notBefore }),
        ...(request.retryLimit === undefined ? {} : { retryLimit: request.retryLimit }),
        ...(request.retryDelaySeconds === undefined
          ? {}
          : { retryDelay: request.retryDelaySeconds }),
      });

      // `null` is pg-boss's answer when `singletonKey` matched a live job, which
      // is this interface's deduplication and is a success. It is returned as
      // itself rather than thrown, because the caller of an idempotent enqueue
      // wants to know which of the two happened.
      return id as JobId | null;
    },

    async consume<P extends JobPayload>(queue: string, handler: JobHandler<P>): Promise<void> {
      await boss.work<P>(queue, async (jobs) => {
        // SEQUENTIAL, AND OVER AN ARRAY THAT DEFAULTS TO ONE ELEMENT. pg-boss
        // hands its handler a batch even at `batchSize: 1`; the interface hands
        // ITS handler one job, because that is the shape a Redis-backed queue
        // can also serve. Sequential rather than `Promise.all` so that a batch
        // wider than one keeps a total order per worker, which is the weaker
        // guarantee and therefore the safe one to promise.
        for (const job of jobs) {
          const delivered: DeliveredJob<P> = {
            id: job.id as JobId,
            queue: job.name,
            payload: job.data,
          };
          await handler(delivered);
        }
      });
    },

    async start(): Promise<void> {
      await boss.start();
    },

    async stop(): Promise<void> {
      await boss.stop();
    },
  };
}
