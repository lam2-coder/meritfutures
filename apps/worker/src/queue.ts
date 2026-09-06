// =============================================================================
// apps/worker/src/queue.ts
// =============================================================================
// THE ONE FILE IN THIS DEPLOYABLE THAT NAMES `@merit/queue`. ADR-333.
//
// The manifest line has been here since ADR-327 and reached no `src/` file for
// two rows: ADR-331 repaired the executor that lost the rows, ADR-332 published
// the pool-shaped door `packages/db` owed, and each of them recorded that the
// importer was the THIRD row of the three and not theirs to take. This is that
// row and this is that file.
//
// -----------------------------------------------------------------------------
// WHY THERE IS A FILE HERE AT ALL, WHICH IS `src/db.ts`'s ARGUMENT VERBATIM
// -----------------------------------------------------------------------------
// Nothing in `CI-01` can see this. `RI-08` guards the MANIFEST half of the
// accessor's admission over every workspace package; `@merit/queue` is on NO
// admission list, so the manifest line granted the capability to the WHOLE
// deployable and no gate anywhere asks where it landed. A reviewer asking "where
// does apps/worker construct a queue over the money database" should get one
// answer with a path in it, and `grep -rn "from '@merit/queue'" apps/worker/src`
// returning exactly this file is that answer.
//
// **AND IT IS AN ASSERTION RATHER THAN A CONVENTION**, which is the distinction
// `apps/api/src/db.ts` states about itself and declines to close: "a convention
// and it is not a control". `test/queue.test.ts` and `test/schedule.test.ts`
// case 5.1 each walk this deployable's `src/` tree and pin the importer list at
// EXACTLY `['./queue.ts']`, in the shape
// `apps/api/test/ledger-posting-authority.test.ts` already runs for the posting
// library: an exact list and not a length, because `toEqual([])` is what made
// the FIRST adapter fail that case and an exact list is what makes the SECOND
// one fail it.
//
// -----------------------------------------------------------------------------
// IT DOES NOT IMPORT `@merit/db`, AND THAT IS THE STRUCTURE RATHER THAN A STYLE
// -----------------------------------------------------------------------------
// ADR-165's pattern is ONE FILE PER PACKAGE. `@merit/db` names `src/db.ts`,
// `@merit/ledger` names `src/sweeps/ledger.ts`, and this file names
// `@merit/queue`. So the constructor's executor is taken FROM `src/db.ts`
// (`queueExecutor()`, which spends `'job-supervisor'`) rather than built here: a
// door that reached for `poolSqlExecutor` itself would have turned
// `test/db.test.ts`'s "exactly one file under src imports the accessor" into a
// two-element list, which is an assertion standing since session 292 loosened to
// land this row's own subject.
//
// The two halves meet STRUCTURALLY and neither package imports the other:
// `packages/db`'s `SqlExecutor` and `packages/queue`'s `JobTransaction` are the
// same one-method shape, bound by an assertion in
// `packages/db/test/write-accessor.test.ts` that READS `job-queue.ts` rather
// than restating it. That is ADR-102's arrangement, used here a deployable over.
//
// -----------------------------------------------------------------------------
// TWO METHODS OF FIVE, AND THE THREE THAT ARE WITHHELD ARE THE RULING
// -----------------------------------------------------------------------------
// `JobQueue` publishes `declareQueue`, `enqueue`, `consume`, `start` and `stop`.
// **THIS DOOR PUBLISHES THE FIRST TWO.** The absence of the other three is by
// CONSTRUCTION and not by convention, in `src/db.ts`'s own idiom for the reason
// parameter it refuses: there is no method and no argument position a caller
// could reach one through.
//
// **1. `start()` IS THE SUPERVISOR, AND ITS FAILURES REACH NO CALLER OF
// `JobQueue`.** pg-boss emits them on an `EventEmitter` that `pgBossQueue` does
// not expose -- the adapter returns five methods and none of them is one -- so a
// process that starts a supervise pass and hits a failure gets an UNHANDLED
// REJECTION naming a line in a vendor's `dist`, with nothing naming the queue.
// ADR-331 section 10 item 3 recorded that, ADR-332 section 10 item 2 recorded it
// again, and ADR-332's own rig had to count `unhandledRejection` for exactly
// that reason. **A DOOR IS THE PLACE THAT DECISION BELONGS AND THE DECISION IS
// TO NOT ENTER IT**: no module of this deployable may start one, so the failure
// that has no channel cannot arise here.
//
// **2. AND THIS DEPLOYABLE HAS NO CALLER FOR IT ANYWAY, WHICH IS ADR-241 RATHER
// THAN AN ARGUMENT INVENTED HERE.** The schedule is EXTERNAL, one process per
// run, and a timer inside a long-lived process is refused "because a long-lived
// process has no exit code to fail with". `start()` installs a SIXTY-SECOND
// supervise interval (pg-boss's own default, `attorney.js`: `config
// .superviseIntervalSeconds = config.superviseIntervalSeconds || 60`) and holds
// the event loop open with it. A one-shot job that started one would either exit
// before the first pass fired, having paid for a supervisor it never used, or
// HANG -- which is the defect `closeWorkerDb`'s docblock names in its own words:
// "a job a supervisor reads as still running and a dead-man switch reads as
// never finished".
//
// **3. `consume` IS THE POLLER AND IT IS THE SAME REFUSAL**, one method over: a
// consumer is a process that stays up. **4. `stop` FOLLOWS `start`.** With
// nothing started there is nothing to stop, and the process lifecycle this
// deployable actually has is `closeWorkerDb()`, which releases the ONE pool both
// doors share.
//
// **WHAT IS NOT CLOSED, STATED PLAINLY.** Somebody must eventually run the
// maintenance and consume these jobs, and that row meets the emitter gap before
// it meets anything else. Surfacing those failures means a SIXTH method on
// `JobQueue`, which is ADR-006's narrowness criterion and `packages/queue`'s
// subject; ADR-165 clause 5 and ADR-331 section 4 clause 4 both rule that an
// interface change is taken by a row whose OBJECT it is, and taking it here
// would be taking it as a MEANS. **IT IS OWED AND IT IS NOT TAKEN**, and what
// this door does instead is make this deployable unable to trip it.
//
// **THE "MEETS THE EMITTER GAP BEFORE ANYTHING ELSE" CLAUSE IS FALSE OF THE
// DRAIN AND IS KEPT BESIDE ITS CORRECTION per `RI-14` (ADR-355).** It is true
// of MAINTENANCE and of `consume`, which is why the sentence stands above. It
// is NOT true of taking a job off the queue. The emitter gap belongs to the
// SUPERVISOR, and a supervisor is the one path here with nobody to throw to.
// The vendor at the pinned version publishes `fetch`, `complete` and `fail`,
// all three of which resolve a db handle from the caller's own options and run
// ONE statement; `manager.fetch` rethrows every error but SQLSTATE 23505 and
// neither completion method touches a worker or an emitter. **So a one-shot
// drain's failure channel is the process exit code**, which is the channel
// ADR-241 already built and `test/entrypoint.test.ts` already spawns a process
// to assert, and the drain does not wait on the event sink.
//
// **NO PULL IS PUBLISHED ON `JobQueue`, WHICH IS WHY NO DRAIN LANDED WITH THE
// RULING** (`RI-35`, `job-queue-pull`). `JOB_QUEUE_METHODS` is five and none of
// them takes a job off a queue without staying up to do it, so the first slice
// is a SIXTH method on that interface and ADR-165 clause 5 makes it
// `packages/queue`'s row. **IT IS OWED AND IT IS NOT TAKEN**, and it is owed as
// a PULL rather than as an emitter.
//
// -----------------------------------------------------------------------------
// WHICH EXECUTOR EACH PATH TAKES, WHICH IS TWO CONNECTION LIFETIMES
// -----------------------------------------------------------------------------
//   CONSTRUCTION  `queueExecutor()`, the POOL, spending `'job-supervisor'`. It
//                 carries `declareQueue` and the queue-metadata read inside
//                 `enqueue`. It MUST NOT be one open transaction: every plan the
//                 vendor wraps in `locked()` renders `BEGIN ... COMMIT` as one
//                 string, so the first one COMMITS the caller's transaction and
//                 a job enqueued after it survives a ROLLBACK meant to take it
//                 (ADR-331 section 5, ADR-332 section 2.3, both measured).
//   ENQUEUE       the CALLER's open transaction, spending `'job-enqueue'`, which
//                 is ADR-006's whole point and is what `enqueueProvisioningOp`
//                 already passes as `tx.sqlExecutor('job-enqueue')`. It is a
//                 REQUIRED first argument with no overload that omits it, so
//                 this door cannot substitute the constructor's executor for it
//                 even by accident.
//
// **THE WRONG PAIRING IS A COMPILE ERROR IN BOTH DIRECTIONS AND IS PROVED RATHER
// THAN ASSERTED.** ADR-332 partitioned `SqlExecutorReason` instead of widening
// it: `poolSqlExecutor` takes `PoolSqlExecutorReason` and a transaction handle
// takes `TransactionSqlExecutorReason`, each an `Extract` of ONE member.
// `test/queue.test.ts` carries the two lines under `@ts-expect-error`, and `tsc`
// reports an UNUSED `@ts-expect-error` as an error of its own, so a parameter
// widened back to the union fails `pnpm run typecheck`.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE DOES NOT DO, AND MUST NOT GROW
// -----------------------------------------------------------------------------
// **THIS PARAGRAPH READ "NOTHING HERE IS WIRED AND NOTHING IS SCHEDULED. No
// module calls this door, `test/queue.test.ts` asserts that over the tree, and
// the saga still enqueues through `ProvisioningJobQueue`, its port", AND ADR-338
// MADE THE FIRST TWO CLAUSES FALSE.** It is kept beside its correction rather
// than deleted, per `RI-14`, and `RI-35` holds the correction to the tree: the
// register moved `worker-queue-door-caller` to `retired` in the same commit that
// falsified it, so a tree where the caller went away turns leg 3 red here
// instead of leaving a correction to be believed.
//
// **`src/provisioning/queue-adapter.ts` IS THE CALLER AND IT IS THE ONLY ONE.**
// It takes this door and returns the saga's `ProvisioningJobQueue`, narrowing
// two published methods to the one the saga names, and `test/queue.test.ts` case
// 5 pins the caller list at exactly that path -- an exact list and not a length,
// so a SECOND caller is a decision somebody takes in that file. **NOTHING IS
// SCHEDULED STILL, AND NOTHING IS ENQUEUED**: no module calls the adapter or the
// saga either, so the door is reachable and unspent.
//
// ADR-326 section 4's refusal stands
// unchanged: the blockers on the eleven unscheduled entry points are ADAPTERS
// rather than clocks, and **the withdrawal driver gets no clock at all until the
// payment rail exists**, because a live clock in front of it posts `LT-06` into
// `approved`, which has no exit and no cancel (ADR-305 section 5, `WD-C2` at
// `0072`). That is founder-owed and this file changes none of it.
//
// IT MINTS NO QUEUE NAME. `PROVISIONING_QUEUE_NAME` is declared in
// `src/provisioning/saga.ts` and re-exported by the barrel, and a second
// constant here would be two statements of one fact.
// =============================================================================

import { pgBossQueue } from '@merit/queue';
import type { JobId, JobPayload, JobRequest, JobTransaction } from '@merit/queue';

import { queueExecutor } from './db.ts';

/**
 * The queue, as this deployable is allowed to see it.
 *
 * TWO METHODS. See this file's header for the three that are withheld and why;
 * the shape is `WorkerDb`'s applied to a different capability, and the absences
 * are the ruling rather than a simplification.
 *
 * IT IS AN INTERFACE AND NOT A FREE FUNCTION for `WorkerDb`'s stated reason: the
 * live value reaches a real pool, `ci.yml`'s jobs have no Postgres, and a door
 * that could not be substituted would make every future adapter in this
 * deployable untestable.
 */
export interface WorkerQueue {
  /**
   * Register a queue.
   *
   * ON THE CONSTRUCTOR'S EXECUTOR, WHICH IS THE POOL. pg-boss wraps this in its
   * `locked()` helper, so the statement carries its own `BEGIN` and `COMMIT` and
   * would commit a caller's transaction if it were handed one.
   */
  declareQueue(queue: string): Promise<void>;

  /**
   * Enqueue one job INSIDE the caller's open transaction.
   *
   * Returns the job's id, or `null` when `key` matched a job already queued,
   * which is a SUCCESS and not a failure.
   *
   * THE TRANSACTION IS THE FIRST ARGUMENT AND IT IS NOT OPTIONAL, which is
   * `job-queue.ts`'s rule carried through rather than restated: it is the one
   * primitive a Redis backend cannot honour, it is admitted on ADR-006's ruling,
   * and it is in the required position so that no caller reaches the unsafe form
   * by leaving something out. In this deployable the value comes from
   * `tx.sqlExecutor('job-enqueue')` inside `LIVE_DB.batch(fn)`.
   */
  enqueue<P extends JobPayload>(tx: JobTransaction, request: JobRequest<P>): Promise<JobId | null>;
}

/**
 * The door, over an executor somebody else owns.
 *
 * A FACTORY AND NOT A CONSTANT, so a suite can drive the whole path with a
 * recorder and no `DATABASE_URL`. `LIVE_QUEUE` below is the one call that spends
 * the real one, exactly as `LIVE_DB` is for the accessor.
 *
 * **THE NARROWING IS AN OBJECT LITERAL AND NOT A CAST**, and the difference is
 * the whole control: a `pgBossQueue(...) as WorkerQueue` would still be carrying
 * `start`, `stop` and `consume` at runtime for anybody who cast back, while this
 * returns a value that HAS only two properties. `test/queue.test.ts` asserts
 * `Object.keys` rather than the type for that reason.
 */
export function workerQueue(executor: JobTransaction): WorkerQueue {
  // NEITHER OPTION IS PASSED AND THE SECOND ONE IS A FINDING RATHER THAN A
  // PREFERENCE. `schema` exists "for tests that need two installations, and for
  // nothing else", and this is the shipped door. `applicationName` was reached
  // for and then MEASURED INERT against pg-boss@12.28.0 as installed: the string
  // `application_name` occurs in exactly one file of that package's `dist`, its
  // own pool-backed driver `db.js`, as `config.application_name =
  // config.application_name || 'pgboss'`; and `index.js`'s `getDb()` returns
  // `this.#config.db` VERBATIM when one is supplied, constructing no pool at all.
  // `pgBossQueue` always supplies one, so the option can never reach a
  // connection. Passing it would have put a value in a diff that does nothing.
  // The file names are the VENDOR's and carry no line number on purpose: a
  // catalog bump moves them, and `pg-boss-queue.ts` cites the same `dist` the
  // same way.
  const queue = pgBossQueue(executor);
  return {
    declareQueue: (name: string): Promise<void> => queue.declareQueue(name),
    enqueue: <P extends JobPayload>(
      tx: JobTransaction,
      request: JobRequest<P>,
    ): Promise<JobId | null> => queue.enqueue(tx, request),
  };
}

/**
 * The door, opened onto the real pool.
 *
 * IT OPENS NO SOCKET AT MODULE SCOPE AND THAT IS ASSERTED RATHER THAN HOPED.
 * `queueExecutor()` resolves the pool through `client()` PER STATEMENT and
 * pg-boss's constructor starts no timer, so importing this module connects
 * nothing; the FIRST statement is what needs a `DATABASE_URL`, and the rejection
 * a caller gets without one is `client.ts`'s own, which is what proves this is
 * the pool `LIVE_DB.batch(fn)` already runs on rather than a second one.
 */
export const LIVE_QUEUE: WorkerQueue = workerQueue(queueExecutor());
