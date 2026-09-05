// =============================================================================
// apps/worker/src/provisioning/ports.ts
// =============================================================================
// THE SAGA's I/O BOUNDARY, DECLARED HERE FOR THE REASON `batch/ports.ts`
// DECLARES THE NIGHTLY BATCH's ONE DIRECTORY OVER: the fold is pure, the I/O is
// behind an interface, and the whole pipeline is therefore assertable with no
// database. `ci.yml`'s `integration` job runs on bare `ubuntu-latest` with no
// services block, so there is no Postgres anywhere in this pipeline to run a
// saga against, and a suite that LOOKED like it exercised one would be worse
// than one that says it did not.
//
// -----------------------------------------------------------------------------
// NOTHING HERE IMPORTS `@merit/db`, `@merit/queue` OR `@merit/rithmic`, AND THE
// REASON IS A MANIFEST RATHER THAN A DESIGN
// -----------------------------------------------------------------------------
// `apps/worker/package.json` declares `@merit/rules-engine` and nothing else,
// `.npmrc` sets `node-linker=isolated`, and under isolated linking an
// undeclared import does not resolve at all. `src/index.ts`'s own header has
// said so since session 147: "the wiring is one manifest line and one call, in
// the session that brings the first job with it."
//
// **THIS SESSION IS THAT SESSION AND THE MANIFEST IS OUTSIDE ITS FENCE.**
// [P3 wave 3](docs/plans/P3-wave3-modules.md) section 9's `P3-l` row and
// section 15's prompt both fence this slice at `src/provisioning/**`,
// `src/index.ts` and `test/provisioning.test.ts`, and neither holds
// `apps/worker/package.json` or `pnpm-lock.yaml`. So the wiring is REPORTED in
// the pull-request body rather than reached for, and the ports below are what
// the wiring session implements. The shapes are not guesses: every one is the
// structural subset of a real interface that already exists, and the suite
// BINDS the load-bearing one by READING its source rather than by restating it.
//
// -----------------------------------------------------------------------------
// WHAT THE ACCESSOR CANNOT SERVE TODAY, MEASURED RATHER THAN ASSUMED
// -----------------------------------------------------------------------------
// ADR-102 gives the write path three doors and a `provisioning_queue` row is
// reachable only through the system one: the table is `derived` through
// `account_id`, ADR-102 clause 3 makes a scoped INSERT `OwnedTableKey` only, so
// `ScopedTx.insert('provisioningQueue', ...)` is a compile error, and
// `FirmTx` serves `FirmTableKey` only. ADR-102 section 8 item 2 names this
// slice by number and says the same: "`P3-l` (session 222) inserts
// `provisioning_queue` ... the provisioning saga runs on a job with no session
// ... But both must say which they are, and that is the point." It is
// `SystemTx`, and the reason is `'nightly-batch'`: M02 section 3.1 makes the
// provisioning queue drain `ST-M2-9`, a stage OF the nightly batch.
//
// **`SystemTx` CAN SERVE THE INSERT AND CANNOT SERVE THE OTHER TWO.** Rendered
// through the same driverless handle ADR-102's own suite uses:
//
//   insert -> insert into "provisioning_queue" (...) values (...) returning ...
//   update -> update "provisioning_queue" set "status" = $1 returning ...
//   select -> select ... from "provisioning_queue"
//   delete -> delete from "provisioning_queue" returning ...
//
// **THE LAST THREE CARRY NO `WHERE` CLAUSE AND THERE IS NO ARGUMENT THAT WOULD
// GIVE THEM ONE.** `updateStatement`, `deleteStatement` and `selectStatement`
// each take `where: SQL | undefined` in a REQUIRED argument position, on
// `job-queue.ts`'s own reasoning that "an optional predicate is one a caller
// reaches the unsafe form of by leaving something out" -- and `systemTx` passes
// `undefined` for all three, with no way for a caller to supply anything else.
//
// So a saga that advanced one row from `written` to `delivered` through
// `SystemTx.update` would set EVERY ROW IN THE TABLE to `delivered`. That is
// worse than the `semi-join` class ADR-102 inherits and names as open: a
// semi-join DELETE removes a subset and leaves the rest, while this writes a
// superset. It is a FINDING for the pull-request body and possibly a
// superseding entry, and it is NOT routed around: `sqlExecutor` would run the
// statement, the one word a transaction handle may write is `'job-enqueue'`,
// and using that word
// to run a status update is the second door ADR-102 exists to make somebody
// write by hand.
//
// **THE CONSEQUENCE IS IN THE TYPES BELOW.** `ProvisioningWritePort` carries
// the enqueue, which the accessor serves today. `ProvisioningAdvancePort` and
// `ProvisioningReadPort` are declared and are BLOCKED, each saying so on its
// own declaration, so the gap is visible in the type rather than left to a
// reader of this comment.

import type { ProvisioningPayload } from './payload.ts';
import type { ProvisioningOperation, ProvisioningStatus } from './vocabulary.ts';

/**
 * The caller's OPEN transaction, as `packages/queue` sees it.
 *
 * STRUCTURALLY IDENTICAL TO `JobTransaction` AND NAMED SEPARATELY BECAUSE THIS
 * APP CANNOT IMPORT IT. That is ADR-092 section 5's two-statements-of-one-fact
 * hazard and it is closed the way ADR-102 closed the identical one between
 * `packages/db` and `packages/queue`: `test/provisioning.test.ts` READS
 * `packages/queue/src/job-queue.ts` and compares the two interface bodies, so a
 * rename over there fails a test in here and the two must move together.
 *
 * `packages/db`'s `SqlExecutor` is the third statement of the same fact and it
 * is bound by ADR-102's own assertion, so the chain is closed end to end:
 * db <-> queue by that suite, and queue <-> this file by ours.
 */
export interface ProvisioningSqlExecutor {
  executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * The write authority for one step, as this saga needs it.
 *
 * A REAL `SystemTx` SATISFIES THIS STRUCTURALLY WITH NO ADAPTER: its `insert`
 * is generic over `TableKey`, which contains `'provisioningQueue'`, and its
 * `sqlExecutor` takes `TransactionSqlExecutorReason`, whose one member is
 * `'job-enqueue'` (ADR-332 partitioned the vocabulary; a transaction handle
 * admits that word and no other). The wiring session hands one in directly.
 */
export interface ProvisioningTx {
  /**
   * The state change. `provisioningQueue` and nothing else.
   *
   * NARROWED TO ONE KEY DELIBERATELY. `SystemTx.insert` reaches every table in
   * the estate with one word, which ADR-102 section 8 item 3 prices as the
   * widening it accepts; a saga that accepted the same reach would spend that
   * budget again for nothing. The narrowing is this file's and costs the
   * caller nothing, because a `SystemTx` is assignable to a narrower shape.
   */
  insert(key: 'provisioningQueue', values: Readonly<Record<string, unknown>>): Promise<unknown[]>;

  /** The raw executor, for the enqueue and for nothing else. One reason, closed. */
  sqlExecutor(reason: 'job-enqueue'): ProvisioningSqlExecutor;
}

/** One job, as `packages/queue`'s `JobRequest` declares it. */
export interface ProvisioningJobRequest {
  readonly queue: string;
  readonly payload: Readonly<Record<string, unknown>>;
  /** At most one job under this key is queued at a time. */
  readonly key?: string;
}

/**
 * The queue, narrowed to the one method this saga calls.
 *
 * **THE TRANSACTION IS THE FIRST ARGUMENT AND THERE IS NO OVERLOAD THAT OMITS
 * IT**, which is `job-queue.ts`'s rule reproduced rather than reinvented:
 * "this is the one primitive on the interface that a Redis backend cannot
 * honour, it is admitted on ADR-006's ruling, and it is in the required
 * position so that no caller reaches the unsafe form by leaving something out."
 *
 * `null` IS A SUCCESS AND NOT A FAILURE. `enqueue` returns `null` when `key`
 * deduplicated the job against one already queued, and `job-queue.ts` brands
 * `JobId` precisely so a caller cannot treat that null as an error and retry.
 * `saga.ts` treats it as the success it is.
 */
export interface ProvisioningJobQueue {
  enqueue(tx: ProvisioningSqlExecutor, request: ProvisioningJobRequest): Promise<string | null>;
}

/**
 * The platform, as M02 section 2.1 declares it.
 *
 * **THIS IS M02's SIGNATURE AND NOT `packages/rithmic`'s, AND THE TWO
 * DISAGREE.** `packages/rithmic/src/index.ts:73` declares
 * `provision(): Promise<PlatformAccountId>` and `entitle(): Promise<void>`,
 * both NULLARY, in a file whose own header says it "declares it and implements
 * none of it" and that "M02 fills it in". M02 section 2.1 declares
 * `provision(ops: readonly ProvisioningOp[]): Promise<ProvisioningBatch>` and
 * `entitle(changes: readonly EntitlementChange[]): Promise<ProvisioningBatch>`.
 * The scaffold is a placeholder and the module plan is the specification, so
 * the specification is what this port carries. **`packages/rithmic` is outside
 * this session's fence**, so reconciling the two is reported rather than done.
 *
 * `platform` IS ON THE PORT BECAUSE M02 PUTS IT THERE: the adapter declares
 * `readonly platform: 'rithmic' | 'simulator'`, and `INV-M2-11` makes simulator
 * output and vendor output pass through the same parser and normalizer. This
 * saga is indifferent to which it is holding, which is the whole point of the
 * field being on the adapter rather than a branch in here.
 */
export interface PlatformProvisioningPort {
  readonly platform: 'rithmic' | 'simulator';
  provision(ops: readonly ProvisioningOp[]): Promise<ProvisioningBatch>;
  entitle(changes: readonly EntitlementChange[]): Promise<ProvisioningBatch>;
}

/** One intent, as it goes to the platform. The row it came from is already committed. */
export interface ProvisioningOp {
  readonly accountId: string;
  readonly operation: ProvisioningOperation;
  readonly payload: ProvisioningPayload;
  /** SD-M2-01's digest of `payload`. Thirty-two bytes. */
  readonly payloadHash: Buffer;
  /**
   * `provisioning_queue.file_name`, once assigned.
   *
   * `null` UNTIL BATCH BUILD, which is `0007:280`'s own word for the column
   * (`idempotent name, assigned at batch build`). A retry reads this rather
   * than recomputing; see `payload.ts`'s note on why recomputing is wrong.
   */
  readonly fileName: string | null;
}

/** One entitlement change. M02 section 2.1's `EntitlementChange`. */
export interface EntitlementChange {
  readonly accountId: string;
  readonly entitlement: string;
  readonly active: boolean;
}

/** What `provision` and `entitle` return: the file or files written. */
export interface ProvisioningBatch {
  readonly fileName: string;
  readonly operation: ProvisioningOperation;
  readonly intentCount: number;
}

/**
 * Advancing ONE row through M02 section 3.2's machine.
 *
 * **BLOCKED, AND THE BLOCKER IS ADR-102's WRITE PATH RATHER THAN THIS FENCE.**
 * See this file's header: `SystemTx.update(key, values)` renders
 * `update "provisioning_queue" set "status" = $1 returning ...` with no `WHERE`
 * clause, and there is no argument that gives it one. So this port is declared
 * and has no implementation in this repository, deliberately: `machine.ts`
 * DECIDES the transition and something that can name a row has to APPLY it.
 *
 * It is declared rather than omitted because the saga's shape depends on the
 * decision existing, and because a port nobody wrote is a smaller and more
 * specific gap than a saga nobody finished -- which is `batch/ports.ts`'s own
 * argument for existing before its adapter did.
 */
export interface ProvisioningAdvancePort {
  /** Move one row, named by its primary key, to `to`. Returns the rows it moved. */
  advance(tx: ProvisioningTx, rowId: string, to: ProvisioningStatus): Promise<readonly unknown[]>;
}

/**
 * Reading one account's rows, for `INV-M2-13`'s exit.
 *
 * **EVERY ROW FOR THIS ACCOUNT, UNFILTERED, AND THE CONTRACT IS STATED HERE
 * BECAUSE THE EXIT DEPENDS ON IT.** `admitToTrading` cannot be made to admit by
 * a filtered set -- evidence is evidence -- but it can be made to DIAGNOSE
 * wrongly, and an operator reading `no_provisioning_row` about an account with
 * a failed setpoint is an operator looking in the wrong place.
 *
 * **ALSO BLOCKED, AND FOR THE SAME REASON.** `SystemTx.rows(key)` renders
 * `select ... from "provisioning_queue"` with no predicate, which is every
 * account's rows rather than one account's.
 */
export interface ProvisioningReadPort {
  rowsFor(accountId: string): Promise<readonly unknown[]>;
}
