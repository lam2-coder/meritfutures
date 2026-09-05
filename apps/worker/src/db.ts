// =============================================================================
// apps/worker/src/db.ts
// =============================================================================
// THE ONE FILE IN THIS DEPLOYABLE THAT NAMES `@merit/db`, AND THE ADMISSION
// THAT LETS IT IS A RULING RATHER THAN A LINE. ADR-165.
//
// -----------------------------------------------------------------------------
// WHY THERE IS A FILE HERE AT ALL, RATHER THAN AN IMPORT IN EACH ADAPTER
// -----------------------------------------------------------------------------
// `RI-08` guards the MANIFEST and says so in its own `covers`: it does not read
// source, and the day `@merit/worker` joined `DB_ADMITTED` is the day this
// deployable acquired the capability everywhere at once. A reviewer asking
// "where does apps/worker reach the database" should get one answer with a path
// in it, and `grep -rln '@merit/db' apps/worker/src` returning exactly this file
// is that answer.
//
// `apps/api/src/db.ts` STATES THE SAME THING AND CALLS IT "a convention and not
// a control", because nothing there checks it. HERE IT IS CHECKED:
// `test/db.test.ts` walks this deployable's `src/` tree and asserts the name
// occurs in one file. That is a small thing and it is the difference between a
// convention and an assertion, and the identical assertion does NOT exist for
// `apps/api`, which is reported rather than repaired because that file is
// outside this slice's fence.
//
// -----------------------------------------------------------------------------
// ONE DOOR, AND THE OTHER THREE ARE ABSENT ON PURPOSE
// -----------------------------------------------------------------------------
// `batch(fn)`   every read and every write a scheduled job makes.
//
// THERE IS NO `scoped(identityId, fn)` AND ITS ABSENCE IS THE POINT. A request
// handler resolves a caller and acts on that caller's behalf; a scheduled job
// has nobody to resolve. `CRON_INVENTORY`'s scheduled-work table is this
// deployable's whole subject and not one of its rows arrives with an identity:
// the nightly batch partitions across every account that has ever existed, the
// ledger assertions are firm-wide by construction, and a detector run reads
// `fills` and `identity_links` ACROSS identities, which is the one thing a
// per-identity scope cannot express. A `scoped` door here would be a door
// somebody uses, and the only way to reach it would be to invent an identity
// out of a row this deployable just read, which is the shape `apps/api/src/db.ts`
// puts a UUID guard in front of precisely because it is dangerous.
//
// THERE IS NO `firm(fn)` AND THE REASON IS SUBSUMPTION RATHER THAN POLICY.
// `SystemTx.rows` and `SystemTx.insert` are declared over `TableKey`, which
// contains `FirmTableKey`, so every row a `FirmTx` could reach is already
// reachable through the one door below. A second door would buy nothing and
// cost a word somebody could use.
//
// THERE IS NO REASON PARAMETER, AND THAT IS WHAT FORECLOSES `'operator-console'`
// FROM THIS DEPLOYABLE. `SystemReason` has exactly two members and this file
// spends one of them at the call site rather than accepting it as an argument,
// so the operator reason is unreachable from `apps/worker` BY CONSTRUCTION and
// not by convention: there is no argument position a caller could put it in.
// **`SystemReason` GAINED NO MEMBER.** `'nightly-batch'` already names what a
// detector run, a fold, a sweep and a nightly assertion each are, and a third
// member taken for the detector service would be the vocabulary joining itself
// (P7 section 8, `P7-a`). `systemDb`'s own docstring in `packages/db` justifies
// `'nightly-batch'` by citing THIS deployable's `batch/ports.ts`, so the word
// was written for this caller before this caller could name the package the
// word lives in.
//
// -----------------------------------------------------------------------------
// THERE IS NO CAST HERE AND NOTHING TO GUARD
// -----------------------------------------------------------------------------
// `apps/api/src/db.ts` carries the workspace's one `IdentityId` assertion and a
// UUID check in front of it, because a scoped door takes a string that has to
// BE an identity. This door takes no argument at all. There is nothing to
// validate, nothing to assert past, and no malformed value that could reach a
// predicate and read like an empty account. That is a property of the door's
// SHAPE rather than of any discipline at the call sites.
//
// -----------------------------------------------------------------------------
// WHY THE DOOR IS AN INTERFACE AND NOT A FREE FUNCTION
// -----------------------------------------------------------------------------
// `transaction()` opens a real connection out of a real pool the first time it
// is called and `client()` throws when `DATABASE_URL` is unset, so every adapter
// in this deployable would be untestable except against a live database.
// `ci.yml`'s `integration` job has none (ADR-102 section 16, ADR-112 section 9).
// So the door is a parameter with a live default and a suite substitutes a
// recorder, which is `apps/api/src/db.ts`'s seam applied one deployable over.
//
// WHAT THAT SEAM CAN AND CANNOT PROVE. A recorder proves which key was named,
// which address was written, which values were set and which reason the handle
// carried. It proves NOTHING about whether the composed predicate reaches one
// row or many, because that is `packages/db`'s and is asserted in
// `packages/db/test/keyed-accessor.test.ts`. A case here that claimed it would
// be agreeing with its own fake.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE DOES NOT DO, AND MUST NOT GROW
// -----------------------------------------------------------------------------
// It does not import `pg` (`merit/no-raw-db-client` is attached to `apps/**`
// and this path is inside it), it does not import `drizzle-orm`, and it casts
// past no key type.
//
// **THAT SENTENCE ALSO READ "it reaches for no `sqlExecutor`", AND ADR-333 MADE
// IT FALSE.** It is kept beside its correction rather than deleted, per `RI-14`.
// What it was written against is a MONEY-PATH ADAPTER routing a scoped read or a
// scoped write around the key vocabulary, and that is still refused: no adapter
// in this deployable reaches for one, `test/db.test.ts`'s substitute throws on
// the method, and six suites assert their own module does not contain the word.
// What this file gained is the pool-shaped executor at the foot of it, which
// reaches no table at all and exists so that `src/queue.ts` can be the one file
// that names `@merit/queue`. The section at the bottom is the argument.
// P7 section 11 rule 10:
// `packages/db/src/scoped-db.ts` is `P5-a`'s file and no P7 slice moves it. If a
// detector needs a shape the accessor does not offer -- and ADR-157 section 5
// REFUSED the aggregate P7 asked for, on the evidence that a detector's blocker
// is the JOIN rather than the aggregate -- that is a finding for a pull-request
// body and a stop, not a widening here.
// =============================================================================

import { closeClient, isNull, poolSqlExecutor, systemDb, transaction } from '@merit/db';
import type {
  FilterTerm,
  PoolSqlExecutorReason,
  SqlExecutor,
  SystemDb,
  SystemReason,
  SystemTx,
} from '@merit/db';

/**
 * The one reason this deployable ever runs at, spelled once.
 *
 * TYPED AS `SystemReason` RATHER THAN INFERRED AS A LITERAL, so a member
 * disappearing from that union is a compile error here rather than a silent
 * widening. It is `as const` as well, so the value stays a literal for anything
 * that compares against it.
 */
export const WORKER_REASON: SystemReason = 'nightly-batch' as const;

/**
 * The handle this deployable's one door is opened with.
 *
 * SEPARATE FROM `LIVE_DB` BECAUSE IT IS THE HALF THAT IS ASSERTABLE WITHOUT A
 * DATABASE. `systemDb(reason)` builds a value and connects nothing; the
 * connection is `transaction()`'s. So a suite can read the reason this
 * deployable would have run at without a `DATABASE_URL`, which is the only
 * property of this file that could silently become `'operator-console'`.
 */
export function workerHandle(): SystemDb {
  return systemDb(WORKER_REASON);
}

/**
 * The one door this deployable opens onto the trader database.
 *
 * It takes the whole unit of work rather than handing back a handle, so a
 * transaction cannot outlive the function that opened it and no caller has a
 * `commit` to forget.
 */
export interface WorkerDb {
  /**
   * Everything a scheduled job reads and writes.
   *
   * NO IDENTITY AND NO REASON, and both absences are the ruling rather than a
   * simplification. The header says why.
   */
  batch<T>(fn: (tx: SystemTx) => Promise<T>): Promise<T>;
}

/**
 * The door, opened onto the real pool.
 *
 * One line of delegation, which is the whole of what this package adds to the
 * accessor. There is no guard because there is no argument to guard.
 */
export const LIVE_DB: WorkerDb = {
  batch<T>(fn: (tx: SystemTx) => Promise<T>): Promise<T> {
    return transaction(workerHandle(), fn);
  },
};

/**
 * Release the pool, so a job that finished can let the process EXIT.
 *
 * **IT IS ON THE FILE AND NOT ON `WorkerDb` BECAUSE IT IS PROCESS LIFECYCLE AND
 * NOT A UNIT OF WORK.** The door above takes a whole unit of work precisely so
 * that no caller holds a handle it could forget to close; a `close` on that
 * interface would hand every adapter the one capability the shape exists to
 * withhold, and a suite substituting a recorder would have to implement it.
 *
 * **WHY THE DEPLOYABLE NEEDS IT AT ALL, which `apps/api` does not.** That
 * service means to keep listening; this one is a ONE-SHOT JOB (`ADR-241`), and
 * `pg` holds the event loop open. A batch that completed and then hung is a job
 * a supervisor reads as still running and a dead-man switch reads as never
 * finished, which is the exit-0-and-do-nothing defect in its other direction.
 * `closeClient`'s own docstring names this caller: "for a process that means to
 * exit".
 *
 * IDEMPOTENT, because `closeClient` returns without acting when no pool was ever
 * opened. A run that refused before it read a row closes nothing and says so by
 * doing nothing.
 */
export function closeWorkerDb(): Promise<void> {
  return closeClient();
}

// =============================================================================
// THE ONE FILTER TERM, WHICH IS NOT A DOOR EITHER AND HAS TO SAY WHY
// =============================================================================
// **IT IS HERE FOR THE SAME REASON THE EXECUTOR BELOW IS: ADR-165's PATTERN IS
// ONE FILE PER PACKAGE, AND A TERM IS ONLY A TERM IF `packages/db` MINTED IT.**
// `scoped-db.ts` keeps a module-private `WeakSet` of every term it minted and
// `isFilterTerm` reads IDENTITY rather than shape, on the stated ground that "a
// `jsonb` column holding an object that looks like a term is a VALUE, and a
// shape check would read it as a range". So a caller cannot hand-roll one, and
// an adapter that needs `column IS NULL` needs the constructor rather than a
// copy of its output.
//
// **WHAT NEEDED IT WAS `src/recon/adapter.ts` (ADR-345) AND THE NEED IS THE
// DEFINITION OF "LIVE" RATHER THAN A CONVENIENCE.**
// `daily_marks_live_per_account_day_uq` is `(account_id, trading_day) WHERE
// superseded_by IS NULL`, so a reconciliation sweep that read every mark and
// filtered in this process would re-derive that index's own predicate by hand
// and would pull every superseded correction across the boundary to do it.
// `apps/worker/src/recon/ports.ts` argued that before an adapter existed, and
// `ADR-157` admits `IS NULL` ON THE READ PATH BY NAME, so this is the granted
// shape rather than a widening of anything.
//
// -----------------------------------------------------------------------------
// WHY IT IS NOT A SECOND DOOR IN ADR-165 CLAUSE 2's SENSE
// -----------------------------------------------------------------------------
// **THE CLAUSE COUNTS DOORS ONTO TABLES AND THIS REACHES NO TABLE AND NAMES NO
// COLUMN.** `isNull()` takes NOTHING and returns a frozen two-word object. It
// carries no key vocabulary, no scope predicate, no reason and no connection;
// it cannot be handed to `transaction()`, and the only way it reaches a database
// at all is as one value of a filter a caller composed through a door that was
// already open. `atMost` and `atLeast` are deliberately NOT re-exported: this
// deployable has one caller needing one term, and a vocabulary re-exported ahead
// of a caller is a word somebody uses.
//
// **AND IT WIDENS NOTHING A CALLER COULD NOT ALREADY REACH.** A term REMOVES
// rows from a read the handle already serves, which is `scoped-db.ts`'s own
// argument for why a conjunction is safe on this boundary and a disjunction is
// not: "a conjunction can only REMOVE rows from the read the caller already
// holds at this authority, and a disjunction can add them back." An adapter
// without this constructor reads MORE rows, not fewer.
//
// **IT IS ALSO REFUSED ON EVERY WRITE, BY `packages/db` AND NOT BY THIS FILE.**
// `addressPredicate` throws on a term in an address, on every write path and
// every addressed read, because a term cannot name one row. So there is no
// composition of what this exports that reaches an UPDATE or a DELETE.
// =============================================================================

/**
 * `column IS NULL`, minted by the accessor. `ADR-157`'s read-path term.
 *
 * A FRESH TERM PER CALL, WHICH IS THE ACCESSOR'S RULE AND NOT THIS FILE'S
 * PREFERENCE. `isNull`'s own docstring: "A FRESH OBJECT PER CALL rather than a
 * shared constant, because membership of `TERMS` is what makes a term a term
 * and a frozen singleton would work equally well right up until somebody
 * exported it." A `const` here would be exactly that export, so this is a
 * function that delegates and never a value that is held.
 *
 * TYPED AS `FilterTerm` AND NOT NARROWED HERE. The caller that needs one member
 * of the union narrows it against the discriminant and refuses the others, which
 * is `src/recon/adapter.ts`'s `reconIsNull`: a narrowing performed at the
 * acquisition point would put this file in the business of knowing which member
 * each caller wants.
 */
export function columnIsNull(): FilterTerm {
  return isNull();
}

// =============================================================================
// THE POOL-SHAPED EXECUTOR, WHICH IS NOT A FOURTH DOOR AND HAS TO SAY WHY
// =============================================================================
// **IT IS HERE AND NOT IN `src/queue.ts`, AND THAT PLACEMENT IS THE WHOLE OF
// WHAT MAKES ONE IMPORTER STRUCTURAL IN THIS DEPLOYABLE.** ADR-165's pattern is
// ONE FILE PER PACKAGE: `@merit/db` names this file, `@merit/ledger` names
// `src/sweeps/ledger.ts`, and since ADR-333 `@merit/queue` names `src/queue.ts`.
// A queue door that reached for `poolSqlExecutor` itself would have made
// `test/db.test.ts`'s "exactly one file under src imports the accessor" a
// TWO-element list, which is an assertion standing since session 292 loosened to
// land a later row's subject. The two doors compose STRUCTURALLY instead:
// `SqlExecutor` here and `JobTransaction` there are the same shape and neither
// package imports the other, which is the arrangement `packages/db` and
// `packages/queue` already have between themselves (ADR-102).
//
// -----------------------------------------------------------------------------
// WHY IT IS NOT A SECOND DOOR IN ADR-165 CLAUSE 2's SENSE
// -----------------------------------------------------------------------------
// **THE CLAUSE COUNTS DOORS ONTO TABLES AND THIS REACHES NO TABLE.** It says
// this file "opens `batch(fn)` over `systemDb('nightly-batch')` and declares no
// `scoped`, no `firm`, and no reason parameter", and every one of those three is
// a `TableKey`-generic handle: a `scoped` door would need the workspace's second
// `IdentityId` cast and a `firm` door is a strict subset of the one above. This
// value has no `rows`, no `insert`, no `updateAt`, no key vocabulary and no
// scope predicate. It hands out ONE METHOD that takes a string, which is
// ADR-332 leg 3, and `transaction()` has no overload that takes it, so there is
// no argument position anywhere in the accessor where it becomes a scope.
//
// **AND IT IS A BIGGER AUTHORITY OBJECT ALL THE SAME, WHICH IS SAID HERE RATHER
// THAN LEFT FOR A REVIEWER TO NOTICE.** ADR-331 section 4 clause 3's words are
// "a pool-shaped raw-SQL door runs arbitrary statements, unscoped, outside any
// transaction, on the money database", and that is true of what this returns.
// What bounds it in THIS deployable is the same thing that bounds the reason
// above: there is no parameter. `poolSqlExecutor(reason)` takes a word and this
// function takes NOTHING, so the only statements it can carry are the ones
// `src/queue.ts` hands to pg-boss, and a second caller wanting raw SQL on the
// pool is a diff in this file with an argument attached.
//
// -----------------------------------------------------------------------------
// THE TWO WORDS ARE TWO CONNECTION LIFETIMES AND THE TYPE REFUSES THE SWAP
// -----------------------------------------------------------------------------
// `'job-supervisor'` is pg-boss's work on its OWN schema -- queue metadata, the
// polling fetch, maintenance and completion -- on a handle that outlives every
// transaction. `'job-enqueue'` is ONE statement INSIDE the caller's open
// transaction, which is ADR-006's whole consequence and is what
// `enqueueProvisioningOp` already spends through `tx.sqlExecutor('job-enqueue')`.
// ADR-332 PARTITIONED the vocabulary rather than widening it: each producer's
// parameter is an `Extract` of one member, so `poolSqlExecutor('job-enqueue')`
// and `tx.sqlExecutor('job-supervisor')` are COMPILE ERRORS in both directions.
// `test/queue.test.ts` proves that with two `@ts-expect-error` lines rather than
// asserting it, because `tsc` reports an unused one as an error of its own.
//
// **THE CONFUSION IS NOT THEORETICAL AND ITS PRICE IS MEASURED.** ADR-331
// section 5 and ADR-332 section 2.3 ran a supervisor on the transaction-bound
// producer: every plan the vendor wraps in `locked()` renders `BEGIN ... COMMIT`
// as ONE string, the first one COMMITS the caller's transaction, and an enqueue
// after it SURVIVED A ROLLBACK that was supposed to take it. That is ADR-006's
// property inverted, at construction, before any Merit code has run a line.
// =============================================================================

/**
 * The one reason this deployable ever runs raw SQL on the POOL at.
 *
 * TYPED AS `PoolSqlExecutorReason` RATHER THAN INFERRED AS A LITERAL, for
 * `WORKER_REASON`'s reason one vocabulary over: a rename of the member leaves
 * that alias `never` and this line stops compiling, where a copy of the string
 * would simply stop matching and say nothing.
 */
export const WORKER_SUPERVISOR_REASON: PoolSqlExecutorReason = 'job-supervisor' as const;

/**
 * The handle `src/queue.ts` constructs pg-boss over.
 *
 * NO PARAMETER, WHICH IS THIS FILE'S OWN IDIOM FOR A CLOSED VOCABULARY. The
 * reason is spent at the call site rather than accepted as an argument, exactly
 * as `workerHandle()` spends `'nightly-batch'`, so there is nothing a caller
 * could put a second word in.
 *
 * IT OPENS NO SOCKET AND IT IS THE POOL `batch(fn)` ALREADY RUNS ON.
 * `poolSqlExecutor` resolves the pool through `client()` PER STATEMENT, so
 * constructing a queue over this connects nothing and the FIRST statement is
 * what needs a `DATABASE_URL` (`test/queue.test.ts` asserts that, and the
 * rejection it names is `client.ts`'s own, which is the proof of WHICH pool).
 * **SO THE QUEUE NEEDS NO `close` OF ITS OWN**: `closeWorkerDb()` above already
 * releases the one pool both doors share, which is what lets a one-shot job that
 * enqueued something still EXIT.
 */
export function queueExecutor(): SqlExecutor {
  return poolSqlExecutor(WORKER_SUPERVISOR_REASON);
}
