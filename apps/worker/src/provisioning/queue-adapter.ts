// =============================================================================
// apps/worker/src/provisioning/queue-adapter.ts
// =============================================================================
// **THE FIRST CALLER `src/queue.ts`'s DOOR HAS EVER HAD, AND THE FIRST LIVE
// `ProvisioningJobQueue` IN THIS REPOSITORY.** ADR-338.
//
// ADR-333 wrote the door and wired nothing, and said so in terms: "NOTHING HERE
// IS WIRED AND NOTHING IS SCHEDULED ... the saga still enqueues through
// `ProvisioningJobQueue`, its port", on ADR-165 clause 5's rule that **the row
// that writes a door is not the row that wires a job**. This is that second row
// and this is that job's queue half.
//
// -----------------------------------------------------------------------------
// WHAT WAS ACTUALLY MISSING, MEASURED RATHER THAN ASSUMED
// -----------------------------------------------------------------------------
// `ProvisioningJobQueue` is declared in `ports.ts` and `enqueueProvisioningOp`
// takes one as an argument. Before this file the ONLY value of that type in the
// workspace was `fakeQueue()` inside `test/provisioning.test.ts`: the port was
// declared, exercised by a double, and had no inhabitant under any `src/`. So a
// deployment that had reached the saga would have had nothing to hand it, which
// is `schedule.ts`'s "a schedule in front of a job with no live adapter is a
// scheduler that starts a process to throw" read one port at a time.
//
// -----------------------------------------------------------------------------
// AN ADAPTER AND NOT AN ASSIGNMENT, WHICH IS A RULING BECAUSE THE ASSIGNMENT
// WOULD HAVE COMPILED
// -----------------------------------------------------------------------------
// `WorkerQueue` is structurally assignable to `ProvisioningJobQueue` today:
// `JobTransaction` and `ProvisioningSqlExecutor` are the same one-method shape,
// `JobPayload` is `Record<string, unknown>`, and `JobId` is a branded `string`
// that widens to `string` on the way out. **`export const
// LIVE_PROVISIONING_QUEUE = LIVE_QUEUE` WOULD HAVE TYPE-CHECKED**, and it is
// refused for two reasons that outlive the compiler.
//
// **1. IT WOULD HAND THE SAGA `declareQueue`.** The saga's port names ONE
// method. A value carrying two lets a future step inside the pipeline declare a
// queue on the CONSTRUCTOR's executor -- the pool -- from inside a caller's
// transaction, which is the pairing `src/queue.ts` section 3 partitioned the
// reason vocabulary to prevent. The narrowing is an object literal for
// `workerQueue()`'s own stated reason: a value that HAS one property, rather
// than a cast that still carries two at runtime for anybody who casts back.
//
// **2. IT WOULD MAKE THE WIRING INVISIBLE TO THE CHECK THAT WATCHES FOR IT.**
// `RI-35`'s `worker-queue-door-caller` probe looks for a property access on
// `LIVE_QUEUE` or a call to `workerQueue(`, and a bare re-export is neither.
// That probe was widened by this row for a related reason and the widening is
// recorded in ADR-338 section 5.
//
// -----------------------------------------------------------------------------
// `declareProvisioningQueue` IS HERE BECAUSE AN ENQUEUE WITHOUT IT THROWS
// -----------------------------------------------------------------------------
// **pg-boss REFUSES AN UNDECLARED QUEUE**, which is why `JobQueue` carries
// `declareQueue` at all (`job-queue.ts`: "a BullMQ adapter implements it as a
// no-op, while a pg-boss adapter cannot invent it"). And
// `0079_pgboss_job_store.sql` section 3 says in its own words that **"IT
// CREATES NO QUEUE AND ENQUEUES NOTHING. `pgboss.queue` ships empty"**. So
// `PROVISIONING_QUEUE_NAME` names a queue that exists in no database this
// repository can build, and an adapter shipped without a way to declare it
// would be an enqueue path whose first live call fails.
//
// **IT TAKES THE DOOR AS AN ARGUMENT AND HAS NO DEFAULT.** A deployment passes
// `LIVE_QUEUE`; a suite passes a recorder. It is a separate function rather
// than a lazy declare inside `enqueue`, because a declare runs on the POOL and
// an enqueue runs INSIDE the caller's transaction (`src/queue.ts` section 3):
// folding one into the other would put a pg-boss `locked()` plan, which renders
// its own `BEGIN ... COMMIT`, in front of a money-path transaction, and
// ADR-331 section 5 measured what that costs.
//
// **NOTHING CALLS IT YET AND NOTHING CALLS THE ADAPTER EITHER.** `RI-35` binds
// that absence at `provisioning-saga-caller` and `schedule.ts` carries the
// blocker: `runProvisioningSaga` has FOUR ports and this row lights ONE. The
// other three are `PlatformProvisioningPort`, whose implementation is
// `packages/rithmic`'s and does not exist, and `ProvisioningAdvancePort` and
// `ProvisioningReadPort`, which `ports.ts` measures as BLOCKED by ADR-102's
// `WHERE`-less system write path rather than by a missing session.
//
// -----------------------------------------------------------------------------
// WHAT STOPS THE JOB STORE GROWING, STATED PLAINLY BECAUSE THE ANSWER IS THIN
// -----------------------------------------------------------------------------
// **NOTHING DRAINS `pgboss.job` AND NOTHING IN THIS DEPLOYABLE MAY.**
// `src/queue.ts` withholds `consume`, `start` and `stop` on ADR-241's ruling
// that this deployable is a one-shot job, and `test/queue.test.ts` asserts over
// the tree that no module here calls the first two.
//
// **WHAT STOPS THE STORE GROWING TODAY IS THAT NOTHING ENQUEUES.** No module
// under any `src/` calls the saga or this adapter, so zero rows are written and
// the store cannot grow. That is a fact about the tree and not a control, and
// it EXPIRES the moment a caller lands. **The row that gives the saga a caller
// owes a drain, or owes the argument for running without one**, and it meets
// the failure channel before it meets anything else: pg-boss reports a
// supervise failure on an emitter `pgBossQueue` does not expose, so surfacing
// it is a SIXTH method on `JobQueue` and therefore `packages/queue`'s row and
// not this deployable's (ADR-165 clause 5, ADR-331 section 4 clause 4).
// =============================================================================

import { LIVE_QUEUE } from '../queue.ts';
import type { WorkerQueue } from '../queue.ts';

import type { ProvisioningJobQueue } from './ports.ts';
import { PROVISIONING_QUEUE_NAME } from './saga.ts';

/**
 * The saga's queue port, over this deployable's door.
 *
 * A FACTORY AND NOT A CONSTANT, which is `workerQueue()`'s own reason one layer
 * up: `ci.yml`'s jobs run on bare `ubuntu-latest` with no services block, so a
 * suite drives the whole path with a recorder and no `DATABASE_URL`.
 *
 * **ONE METHOD OUT OF TWO IN, AND THE ONE THAT IS DROPPED IS THE RULING.** See
 * this file's header: `declareQueue` runs on the constructor's executor, which
 * is the POOL, and the saga runs inside a caller's open transaction. The two
 * cannot be reached through one value here.
 */
export function provisioningJobQueue(queue: WorkerQueue): ProvisioningJobQueue {
  return {
    // THE TRANSACTION IS PASSED STRAIGHT THROUGH AND NOTHING IS SUBSTITUTED FOR
    // IT. `enqueueProvisioningOp` produces it as `tx.sqlExecutor('job-enqueue')`
    // off the same handle the `provisioning_queue` row is inserted on, which is
    // ADR-006's transactional-enqueue criterion, and an adapter that reached for
    // an executor of its own here would be the saga bug that criterion exists to
    // remove.
    enqueue: (tx, request) => queue.enqueue(tx, request),
  };
}

/**
 * Register `PROVISIONING_QUEUE_NAME` with the job store. Idempotent.
 *
 * **IT MINTS NO NAME.** `PROVISIONING_QUEUE_NAME` is declared once, in
 * `saga.ts`, and a second constant here would be two statements of one fact,
 * which is `src/queue.ts`'s own refusal transcribed.
 *
 * **IT RUNS NO DDL AND THE MIGRATION IS WHY.** `pgboss.create_queue` runs
 * `CREATE TABLE pgboss.%I` only for a PARTITIONED queue and this asks for none,
 * so `merit_app` keeps the "no DDL" property `0026_roles_and_grants.sql:64`
 * gives it and `0082_pgboss_app_grants.sql` is a sufficient grant for this call.
 * `src/queue.ts`'s header carries that measurement.
 */
export function declareProvisioningQueue(queue: WorkerQueue): Promise<void> {
  return queue.declareQueue(PROVISIONING_QUEUE_NAME);
}

/**
 * The saga's queue port, opened onto the real pool.
 *
 * IT OPENS NO SOCKET AT MODULE SCOPE, which is `LIVE_QUEUE`'s property carried
 * one layer out rather than a new one: `queueExecutor()` resolves the pool
 * through `client()` per statement and pg-boss's constructor starts no timer, so
 * importing this module connects nothing and the FIRST statement is what needs a
 * `DATABASE_URL`.
 */
export const LIVE_PROVISIONING_QUEUE: ProvisioningJobQueue = provisioningJobQueue(LIVE_QUEUE);
