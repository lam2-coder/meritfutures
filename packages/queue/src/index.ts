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
// driver is.
//
// **THAT PARAGRAPH ENDED "That door is not published by `packages/db` and the
// reason it would need is not a member of `SqlExecutorReason`; ADR-331 refuses
// to mint either as a means and leaves both owed to the row whose subject they
// are", AND ADR-332 IS THAT ROW.** It is kept beside its correction rather than
// deleted, per RI-14. Both halves landed at once, because ADR-331 ruled they
// were owed together: `@merit/db` exports `poolSqlExecutor`, which takes
// `'job-supervisor'`, a SECOND member of a vocabulary that is still closed
// because it is PARTITIONED -- each producer's parameter type is an `Extract` of
// ONE member, so a transaction handle still admits `'job-enqueue'` and nothing
// else, and the widening bought no caller a row it could not already reach.
//
// AND THE CONSTRUCTOR HALF IS NO LONGER "MEASURED UNUSABLE" IN EITHER OF ITS
// TWO SENSES. Against PostgreSQL 16.13 as `merit_app` over `0001`..`0082`, a
// queue constructed on that door ran `start()`, `declareQueue` and a full
// supervise pass: 77 statements, ZERO failures, both the monitor and the
// maintain phase reached on every queue, while `enqueue` stayed on its caller's
// transaction in both directions -- present after a COMMIT and absent after a
// ROLLBACK. ADR-332 sections 6 and 7.
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
// THE IMPORTER EXISTS, AND SINCE ADR-333 IT IS `apps/worker/src/queue.ts`. That
// deployable's ONE DOOR constructs `pgBossQueue` over `@merit/db`'s
// `poolSqlExecutor('job-supervisor')` and republishes TWO of `JobQueue`'s five
// methods: `declareQueue` and `enqueue`. `start`, `stop` and `consume` are
// withheld there, because a supervise pass emits its failures on an emitter this
// package does not expose and because that deployable is a one-shot job
// (ADR-241). So what ships from here is the interface, its adapter, the suite
// that proves the enqueue joins the transaction it is given, and now one caller.
//
// **THIS PARAGRAPH READ "WHAT IS STILL ABSENT IS THE IMPORTER, AND SINCE ADR-332
// IT IS THE ONLY THING. NO MODULE IN THIS WORKSPACE IMPORTS `@merit/queue`. It
// is in `apps/worker`'s manifest since ADR-327 and reaches no `src/` file
// there", AND ADR-333 WROTE THAT MODULE.** It is kept beside its correction
// rather than deleted, per `RI-14`, and `RI-35` still holds it: the claim was
// registered `live` against the `queue-door` artifact and moved to `retired` in
// the same commit that falsified it, so an importer that went away again turns
// this correction red rather than leaving it to be believed.
//
// WHAT IS STILL ABSENT IS A CONSUMER, AND IT IS A DIFFERENT ROW'S. Nothing in
// this workspace calls `consume` or `start`, so no job enqueued through the door
// is ever fetched and no maintenance pass ever runs. The blocker is not a
// manifest and not a grant this time: it is that a caller of `start()` cannot
// observe what the supervisor fails at, which is section 10 item 3 of ADR-331
// and item 2 of ADR-332, unrepaired here and named again.
//
// **THIS HEADING READ "WHAT IS STILL ABSENT IS THE DOOR AND NOT THE SUPPLY",
// WHICH ADR-332 MADE AMBIGUOUS RATHER THAN FALSE**, and the ambiguity is worth
// one line because a session reads a heading to decide what to build. Two
// different things were called the door: the pool-shaped executor `packages/db`
// owes, which now exists, and the module under `apps/worker/src` that takes it
// and names a queue, which does not. Only the second is left, and ADR-332
// deliberately did not write it: ADR-331 section 4 clause 4 rules that the row
// widening the vocabulary and the row importing the package are different rows.

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
