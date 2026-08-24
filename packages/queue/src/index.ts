// =============================================================================
// packages/queue
// =============================================================================
// The job interface, and pg-boss behind it (ADR-006, ADR-086).
//
// WHY THIS IS A LIBRARY AND NOT A DEPLOYABLE. `pnpm-workspace.yaml`: "apps/* are
// DEPLOYABLES and packages/* are LIBRARIES, and the split is not decoration."
// Both `apps/api` and `apps/worker` enqueue, so a queue that lived in either
// would make the other import a deployable, which RI-04 reports as a finding in
// those words: "a deployable that imports a deployable is one deployable."
//
// THE VENDOR IS BEHIND THE INTERFACE AND NOT BESIDE IT. `pgBossQueue` is
// exported; `PgBoss` is not, and neither is any pg-boss type. A caller receives
// a `JobQueue` and can name nothing else, which is what makes ADR-006's "later
// move to BullMQ is a contained change" a property of this tree rather than an
// intention. `test/surface.test.ts` asserts the containment by reading the tree.
//
// -----------------------------------------------------------------------------
// IT HOLDS NO CONNECTION, AND THE THING IT NEEDS DOES NOT EXIST YET
// -----------------------------------------------------------------------------
// `pgBossQueue(executor)` takes its connection as an argument and `enqueue`
// takes the caller's transaction as its first parameter, so this package opens
// no pool: ADR-084 section 2 ruled that the queue runs on `packages/db`'s pool
// because "a transaction is per-connection, so a second driver is a second pool
// and that consequence stops being implementable."
//
// `@merit/db` CANNOT SUPPLY EITHER ONE TODAY, and that is ADR-086 section 6's
// finding rather than a gap this package worked around. Its public surface is
// `scopedDb`, `systemDb`, `scopePredicate`, the scope registry, the schema and
// `closeClient`; `client()` is deliberately unexported and ADR-084 section 9
// rules it permanently so; and NOTHING on that surface runs a transaction or
// yields a SQL executor. So there is no second pool here and there is also no
// first one: what lands is the interface, its adapter and the suite that proves
// the enqueue joins the transaction it is given. The wiring waits on one export
// from a package this session's fence does not hold.

export { JOB_QUEUE_METHODS } from './job-queue.js';
export type {
  DeliveredJob,
  EveryJobQueueMethodIsListed,
  JobHandler,
  JobId,
  JobPayload,
  JobQueue,
  JobRequest,
  JobTransaction,
} from './job-queue.js';

export { pgBossQueue, QUEUE_SCHEMA } from './pg-boss-queue.js';
export type { PgBossQueueOptions } from './pg-boss-queue.js';
