// =============================================================================
// apps/worker/src/digests/alarm-adapter.ts
// =============================================================================
// **THE DIGEST ALARM'S `DigestAlarmIo`, ALL THREE MEMBERS, OVER THIS
// DEPLOYABLE'S OWN DOORS. NOTHING HERE REFUSES.** ADR-353.
//
// `schedule.ts`'s row for `findUndeliveredWindows` said `UNWIRED_DIGEST_ALARM_IO`
// was the only `DigestAlarmIo` in the tree, and it was. This file is the second
// inhabitant, and it is the FIRST ADAPTER IN THIS DEPLOYABLE THAT SERVES ITS
// WHOLE PORT: `sweeps/expiry-adapter.ts` takes its fifth member as an argument
// nothing can be passed for, `detectors/adapter.ts` serves four of five and
// refuses the sink, `batch/statistics-adapter.ts` refuses three of nine. This
// port has three members and every one of them is a thing this deployable
// already holds.
//
// -----------------------------------------------------------------------------
// THE THREE MEMBERS, AND WHERE EACH ONE COMES FROM
// -----------------------------------------------------------------------------
//   read    `WorkerDb.batch`, NARROWED to a handle carrying `rowsWhere` and
//           nothing else. `src/db.ts` is the one file that names `@merit/db`
//   terms   `atLeast`, re-exported by `src/db.ts` from the accessor since
//           ADR-349, MINTED rather than shaped (see below)
//   now     the process clock, defaulted here and overridable
//
// **THERE IS NO FOURTH THING TO WITHHOLD.** The alarm writes nothing, emits
// nothing, and reads two tables that are `firm` in `scope.ts`, so no identity
// cast, no event sink and no vendor exists on this path to be missing. That is
// why this row's argument is short where its four predecessors' were long: a
// refusal here would have had to be manufactured, and ADR-353 section 2 says so
// in those terms rather than leaving the absence to be read as an oversight.
//
// -----------------------------------------------------------------------------
// THE HANDLE IS NARROWED AND IS NOT PASSED THROUGH, AND `ports.ts`' CLAIM ABOUT
// THAT IS TRUE AND IS STILL NOT WHAT THIS FILE DOES
// -----------------------------------------------------------------------------
// `ports.ts` section 3 says of `DigestReadTx`: *"`SystemTx` satisfies this
// structurally, so the wiring hands the same door in and the alarm receives a
// handle it CANNOT WRITE THROUGH."* **THE FIRST HALF WAS MEASURED AND HOLDS**:
// `function probe(tx: SystemTx): DigestReadTx { return tx; }` type-checks in
// this directory, which was watched to compile before this file was written.
//
// **THE SECOND HALF IS TRUE OF THE TYPE AND FALSE OF THE VALUE, AND THAT IS THE
// WHOLE REASON FOR THE FOUR LINES BELOW.** Passing the transaction through
// erases `insert`, `updateAt`, `deleteAt`, `rowAt`, `lockAt` and `sqlExecutor`
// from what the alarm may NAME while leaving every one of them on the object the
// alarm is holding. `alarm.ts` builds its whole construction on the alarm being
// unable to discharge the window it is complaining about, and a guarantee that
// survives only until somebody writes `as` is a weaker guarantee than the one
// that file's header claims. `detectorTx` one directory over narrows for the
// same reason and says so: this is "where they stop being reachable".
//
// **AND THE NARROWING COSTS NO CAST.** `detectors/adapter.ts` calls its
// `tx.rowsWhere(key as never, where as never)` "THE ONE CAST IN THIS DEPLOYABLE
// PAST A KEY TYPE" and buys back what it gave up with a conditional-type
// assertion and a run-time membership set. **NEITHER IS NEEDED HERE AND THE
// DIFFERENCE IS MEASURED RATHER THAN ASSUMED**: `DigestReadTable` is two string
// literals and `DigestFilter` is `Readonly<Record<string, unknown>>`, and
// `SystemTx.rowsWhere` accepts both as written. A `'notATable'` member added to
// `DIGEST_READ_TABLES` is `tsc` error `TS2345` AT THE CALL BELOW, which is the
// same protection the detector file's alias buys, obtained from the call site
// instead. Watched red before this file was written, and restored.
//
// -----------------------------------------------------------------------------
// THE TERM IS MINTED AND NEVER SHAPED
// -----------------------------------------------------------------------------
// `DigestTerms` is declared in `ports.ts` and DELIBERATELY not constructible
// there: `packages/db` keeps a `WeakSet` of every term it minted and
// `isFilterTerm` reads IDENTITY rather than shape, so a hand-rolled
// `{ term: 'at-least', value }` is refused by the accessor even though it
// type-checks everywhere above it. This file therefore does not build a term; it
// passes `src/db.ts`'s re-export through untouched.
//
// **ONE NAME AND NOT THREE.** `DigestTerms` declares `atLeast` alone and
// `ports.ts` argues both absences: this slice bounds a history read at its lower
// end and needs nothing else, and a port declaring a term no caller uses is a
// door held open for a caller who has not argued for it. `atLeast` reached this
// deployable through ADR-349 and `src/db.ts`'s own header names `digests/alarm.ts`
// as one of its two callers, so nothing here widens anything.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE DOES NOT DO
// -----------------------------------------------------------------------------
// IT DOES NOT CALL `findUndeliveredWindows`. Building a `DigestAlarmIo` makes
// the job RUNNABLE; calling it makes it RUN, and those are two decisions with
// two different blockers. ADR-353 section 3 takes the second one and leaves the
// job `unscheduled` on a blocker that is not an adapter: **nothing in this
// repository ever writes a `report_schedules` row**, so a clock in front of this
// today evaluates zero schedules and reports zero undelivered windows, and
// `M06` section 3.6's *"zero, always"* metric would read green because its
// subject set is empty. `test/schedule.test.ts` case 3.1 derives every
// disposition from a caller census over this tree, so a call here would move the
// row to `scheduled` by force and the case would be right to refuse it.
//
// IT IS NOT `./digests/adapter.ts` AND IT DOES NOT BUILD A `DigestIo`. The
// producer's port is row 354's and is a different set: seven members, of which
// `transport` has no inhabitant anywhere. One file serving both is one file
// whose success on the alarm half could be read as evidence about the delivery
// half, which is the exact indistinguishability `DigestUnwired`'s own message
// exists to prevent.
//
// IT NAMES NO PACKAGE. `@merit/db` is `src/db.ts`'s under ADR-165's
// one-door-per-package rule, and `test/digests.test.ts` case 10.2 asserts that
// the importer list under `apps/worker/src` is exactly `db.ts`. This file goes
// through that door and opens none.
//
// IT ADDS NO `SqlExecutorReason` MEMBER, ADDS NO `SystemReason` MEMBER, IMPORTS
// NO `pg`, AND CASTS PAST NO KEY TYPE (P5 section 11 rule 10, P7 section 11
// rule 10).
// =============================================================================

import { atLeast } from '../db.ts';
import type { WorkerDb } from '../db.ts';

import type { DigestAlarmIo, DigestFilter, DigestReadTable, DigestReadTx } from './ports.ts';

/**
 * The transaction this deployable's one door hands out, named without importing
 * `@merit/db`.
 *
 * DERIVED FROM THE DOOR RATHER THAN RE-EXPORTED THROUGH IT, which is
 * `batch/adapter.ts`'s `BatchTx` and its reason: `src/db.ts` grows nothing, and
 * if the door's callback signature changes this type changes with it and every
 * use below stops compiling.
 */
export type WorkerDigestTx = Parameters<Parameters<WorkerDb['batch']>[0]>[0];

/**
 * One open transaction, as the ALARM needs to see it: one filtered read.
 *
 * ONE METHOD AND NOT SEVEN, and this function is where the other six stop being
 * reachable rather than merely stop being nameable. The header is the argument.
 *
 * The key and the filter cross unchanged. `DigestReadTable` is a subset of the
 * accessor's own key union and the compiler checks that AT THIS CALL, so a
 * member added to `DIGEST_READ_TABLES` that is not a registered table is a
 * compile error here and not a run-time surprise in a live database.
 */
export function digestAlarmReadTx(tx: WorkerDigestTx): DigestReadTx {
  return {
    rowsWhere(key: DigestReadTable, where: DigestFilter): Promise<unknown[]> {
      return tx.rowsWhere(key, where);
    },
  };
}

/**
 * The alarm's unit of work: one read-only transaction over the one door.
 *
 * IT SPENDS `'nightly-batch'`, WHICH IS THE ONLY `SystemReason` THIS DEPLOYABLE
 * HAS, and no member was added to that union for it. `src/db.ts` ruled that and
 * a dead-man switch is scheduled work: `WORKER_REASON` is what a scheduled job
 * runs at whether it reads or writes.
 *
 * ONE TRANSACTION FOR THE WHOLE EVALUATION AND NOT ONE PER SCHEDULE, which is
 * `alarm.ts`'s shape and not this file's choice: `findUndeliveredWindows` opens
 * exactly one `io.read` and loops inside it. That is the right shape for this
 * job, because a report folded across two transactions could show a window as
 * undelivered that a delivery committed between them.
 */
export function postgresDigestAlarmRead(db: WorkerDb): DigestAlarmIo['read'] {
  return <T>(fn: (tx: DigestReadTx) => Promise<T>): Promise<T> =>
    db.batch((tx) => fn(digestAlarmReadTx(tx)));
}

/**
 * ADR-157 clause 1's lower-bound constructor, as the alarm's port.
 *
 * A CONSTANT AND NOT A FACTORY, because the function closes over nothing: a term
 * is minted per call by `packages/db` and this value only says WHICH constructor
 * goes with the one name the port declares. `sweeps/expiry-adapter.ts`'s
 * `EXPIRY_TERMS` is the same shape one directory over.
 *
 * **PASSED THROUGH AND NOT WRAPPED.** A wrapper that rebuilt, spread or froze
 * the returned object would hand back something `isFilterTerm` refuses, because
 * that predicate reads a `WeakSet` of the objects `mintTerm` built rather than
 * the shape they have, and the refusal would arrive at the first live scan
 * rather than at this line.
 */
export const DIGEST_ALARM_TERMS: DigestAlarmIo['terms'] = { atLeast };

/**
 * The alarm's whole outside world, over this deployable's own doors.
 *
 * **EVERY MEMBER IS SERVED AND NOTHING IS DEFAULTED TO A REFUSAL**, which is the
 * first time that is true of an adapter in this deployable, and ADR-353 section
 * 2 makes the case rather than letting it pass unremarked. There is no argument
 * here with no default, because there is no capability in this port that this
 * repository lacks.
 *
 * ONE REQUIRED ARGUMENT, WHICH IS THE DOOR, so a suite substitutes a recorder
 * and needs no `DATABASE_URL` and a deployment passes `LIVE_DB`. That is
 * `postgresBatchPorts`' shape and `src/db.ts`'s own seam.
 *
 * **A VALUE BUILT HERE IS SAFE TO HOLD AND IS STILL NOT SAFE TO SCHEDULE**, and
 * the two are separate. `expiry-adapter.ts` refused to export a live constant
 * because a name a later row schedules is a name a later row schedules; the same
 * caution applies to this factory for a DIFFERENT reason, which is that the
 * subject set is empty rather than that the work would roll back. ADR-353
 * section 3 holds the ruling and `schedule.ts`'s row carries it.
 *
 * @param db the door, so a suite substitutes a recorder and needs no `DATABASE_URL`
 * @param now the alarm's one instant, defaulted to the process clock
 */
export function postgresDigestAlarmIo(
  db: WorkerDb,
  now: () => Date = () => new Date(),
): DigestAlarmIo {
  return {
    read: postgresDigestAlarmRead(db),
    terms: DIGEST_ALARM_TERMS,
    // THE PROCESS CLOCK, AND IT IS THE ONLY INSTANT THE RUN GETS.
    // `findUndeliveredWindows` calls `io.now()` ONCE and every `elapsedMs` in
    // the report is measured from that one value, so a fixture pins the whole
    // evaluation by passing its own and the database never supplies an instant.
    // `RI-28` refuses a process-local clock READ in shipped source; this is a
    // clock injected at the wiring, which is the shape `job.ts` already spends.
    now,
  };
}
