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
// IT HOLDS NO CONNECTION, AND WHAT SUPPLIES ONE EXISTS
// -----------------------------------------------------------------------------
// `pgBossQueue(executor)` takes its connection as an argument and `enqueue`
// takes the caller's transaction as its first parameter, so this package opens
// no pool: ADR-084 section 2 ruled that the queue runs on `packages/db`'s pool
// because "a transaction is per-connection, so a second driver is a second pool
// and that consequence stops being implementable."
//
// `@merit/db` SUPPLIES BOTH HALVES TODAY, AND THE HALVES ARE NOT IN THE SAME
// STATE. `transaction()` is exported from that package's barrel and is the only
// producer of `SqlExecutor`, which is structurally the `JobTransaction` this
// package's `enqueue` declares, so an enqueue riding the caller's transaction
// is buildable and `apps/worker`'s `enqueueProvisioningOp` calls a port shaped
// for it (ADR-102). `client()` stays unexported and ADR-084 section 9 rules it
// permanently so, so there is still no second pool here.
//
// **THIS PARAGRAPH READ "The CONSTRUCTOR half is supplied and MEASURED
// UNUSABLE: `sqlExecutorOn` returns `{ rows: result.rows }`, every one of
// pg-boss's `locked()` plans is a multi-statement string, and `pg` resolves
// those to a `Result[]` whose `.rows` is `undefined`, so a supervisor built on
// it throws inside its monitor phase", AND ADR-331 REPAIRED THE EXECUTOR IT
// NAMES.** It is kept beside its correction rather than deleted, per RI-14. The
// executor now flattens the array in statement order, which is what pg-boss's
// own adapters do, and a supervise pass measured against PostgreSQL 16.13 as
// `merit_app` completed both its monitor and its maintain phase with zero
// errors where the same pass used to abort on `undefined.filter`.
//
// WHAT THE CONSTRUCTOR HALF IS STILL MISSING IS A LIFETIME AND NOT A SHAPE, and
// ADR-331 measured that too rather than reasoning about it. `sqlExecutorOn` is
// bound to ONE OPEN TRANSACTION, and every plan the vendor wraps in `locked()`
// carries its own `BEGIN` and `COMMIT`. Run one on a caller's transaction and
// the `COMMIT` commits THAT transaction: the in-transaction test comparing
// `now()` against the statement clock reads true before that plan and false
// after it, so ADR-006's whole consequence is gone one statement into
// construction. The executor that constructs the queue therefore has to be
// POOL-shaped, one connection per statement, which is what the vendor's own
// driver is. That door is not published by `packages/db` and the reason it
// would need is not a member of `SqlExecutorReason`; ADR-331 refuses to mint
// either as a means and leaves both owed to the row whose subject they are.
//
// **THIS HEADING READ "IT HOLDS NO CONNECTION, AND THE THING IT NEEDS DOES NOT
// EXIST YET", AND UNDER IT: "`@merit/db` CANNOT SUPPLY EITHER ONE TODAY ... its
// public surface is `scopedDb`, `systemDb`, `scopePredicate`, the scope
// registry, the schema and `closeClient` ... and NOTHING on that surface runs a
// transaction or yields a SQL executor."** ADR-102 falsified every clause of it
// and nothing went red. It is the FIFTH site of the defect ADR-324, ADR-326 and
// ADR-327 each repaired once by hand, and it is kept beside its correction
// rather than deleted, per RI-14. `RI-35` binds it: the sentence is registered
// as retired against the two exports that falsified it, so a tree where they
// went away turns the correction red instead of leaving it to be believed.
//
// WHAT IS STILL ABSENT IS THE DOOR AND NOT THE SUPPLY.
// NO MODULE IN THIS WORKSPACE IMPORTS `@merit/queue`. It is in `apps/worker`'s
// manifest since ADR-327 and reaches no `src/` file there, so what ships from
// here is the interface, its adapter and the suite that proves the enqueue
// joins the transaction it is given. `RI-35` holds that sentence to the tree.

export { JOB_QUEUE_METHODS } from './job-queue.ts';
export type {
  DeliveredJob,
  EveryJobQueueMethodIsListed,
  JobHandler,
  JobId,
  JobPayload,
  JobQueue,
  JobRequest,
  JobTransaction,
} from './job-queue.ts';

export { pgBossQueue, QUEUE_SCHEMA } from './pg-boss-queue.ts';
export type { PgBossQueueOptions } from './pg-boss-queue.ts';
