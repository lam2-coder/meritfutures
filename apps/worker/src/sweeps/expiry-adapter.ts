// =============================================================================
// apps/worker/src/sweeps/expiry-adapter.ts
// =============================================================================
// **THE HOURLY EXPIRY SWEEP'S ADAPTER: FOUR OF ITS FIVE PORTS OVER THIS
// DEPLOYABLE'S OWN DOORS, AND THE FIFTH TAKEN AS AN ARGUMENT BECAUSE THERE IS
// NOTHING IN THIS REPOSITORY TO PASS IT.** ADR-344.
//
// `schedule.ts`'s row for `runExpirySweep` said `UNWIRED_EXPIRY_SWEEP_IO` was
// the only `ExpirySweepIo` in the tree, and it was: the job has been written,
// suited and unrunnable since session 291. This file is the half of that gap
// this deployable can close by itself, and its header is mostly about the half
// it cannot.
//
// -----------------------------------------------------------------------------
// THE FIVE PORTS, AND WHERE EACH ONE COMES FROM
// -----------------------------------------------------------------------------
//   transact  `WorkerDb.batch`, which is `systemDb('nightly-batch')` through
//             `src/db.ts`, with `recordExpiryTransaction` around the handle
//   terms     `atMost` and `isNull`, re-exported by `src/db.ts` from the
//             accessor, MINTED rather than shaped (see below)
//   ledger    `EXPIRY_LEDGER` in `src/sweeps/ledger.ts`, which ADR-305 slice 6
//             wrote and nothing has ever called
//   now       the process clock, defaulted here and overridable
//   events    **THE CALLER'S, WITH NO DEFAULT, BECAUSE THIS DEPLOYABLE HAS NO
//             EVENT SINK AND CANNOT REACH ONE**
//
// -----------------------------------------------------------------------------
// THE SINK IS A REQUIRED PARAMETER AND THAT IS THE RULING, NOT AN OVERSIGHT
// -----------------------------------------------------------------------------
// **THERE IS NO `LIVE_EXPIRY_SWEEP_IO` IN THIS FILE AND THERE MUST NOT BE ONE
// UNTIL A SINK EXISTS.** The tempting shape is a live constant built over an
// `events` port that rejects, on `batch/adapter.ts`'s `EVENT_SINK_BLOCKER`
// precedent one directory over. It is REFUSED here, and the difference between
// the two cases is the whole reason:
//
//   `BatchWritePort.raiseReconciliation` is an EXCEPTION channel. The nightly
//   fold does its work and refuses only when it has a divergence to report, so
//   a live `BatchPorts` with two refusing legs is a batch that runs.
//
//   **EVERY LEG OF THIS SWEEP EMITS.** `releaseHold` emits inside the release
//   transaction, `releaseWithdrawalHalt` emits inside its own, and the freeze
//   leg's entire output is `payout.freeze_expiring`. A sweep over a rejecting
//   sink releases NOTHING: every `io.transact` rolls back, every outcome is
//   `failed`, and the report says the estate could not be swept.
//
// That direction is FAIL-CLOSED and it is not the hazard. The hazard is the
// value: a `LIVE_EXPIRY_SWEEP_IO` exported from here is a name a later row
// schedules, and the deployment that follows runs an hourly job whose every
// release rolls back while `CRON_INVENTORY`'s dead-man switch, which fires on
// the JOB'S ABSENCE rather than on its outcome, reports a job that is present.
// **THAT IS `ADR-239`'s DEFECT WITH A CLOCK IN FRONT OF IT**: a process that
// looks healthy to a supervisor because it exits having done nothing. So the
// missing capability is a PARAMETER, the wiring row cannot compile without
// supplying one, and there is nothing in this repository it could supply.
//
// -----------------------------------------------------------------------------
// WHY THERE IS NOTHING TO SUPPLY, MEASURED RATHER THAN ASSERTED
// -----------------------------------------------------------------------------
// `apps/api/src/events.ts` holds `EVENT_CATALOGUE`, `buildEvent`,
// `makeEventSink` and `TRANSACTION_EVENT_WRITER`, and it is the ONLY event
// producer in this repository: nothing under `packages/**` carries one.
// `apps/worker` cannot reach it. `RI-04` refuses a deployable that depends on a
// deployable, `.npmrc`'s `node-linker=isolated` means an undeclared specifier
// resolves at neither run time nor build time, and `test/event-sink.test.ts`
// section 3 asserts that no relative specifier under `apps/worker/src` resolves
// outside this app. Three independent refusals, and none of them is a line this
// row may edit.
//
// **AND THE PRODUCER IS ON THE WRONG SIDE OF THE FENCE FROM THE HANDLE, WHICH IS
// THE FINDING RATHER THAN THE INCONVENIENCE.** `apps/api/src/events.ts` states
// it against itself: `events` is an `either`-class row, `ScopedTx.insert` is
// generic over `OwnedTableKey` and `FirmTx.insert` over `FirmTableKey`, so
// "`SystemTx` is the ONE handle in this workspace that can write this table",
// and `apps/api` opens only `scoped` and `firm` doors. **THE ONE DEPLOYABLE
// HOLDING A `SystemTx` IS THIS ONE**, and `WorkerDb.batch` hands one to the
// callback four lines below. So the producer has no handle and the handle has no
// producer, each in the deployable the other cannot import, and the repair is a
// package both arrows already reach rather than an import either side could
// write. That is `P5-n`'s slice and it is not this row's fence.
//
// **THE SWEEP WOULD STILL LOSE ONE OF ITS THREE NAMES ON THE DAY THE SINK
// ARRIVES, AND THAT IS SAID HERE SO NOBODY READS THIS FILE AS THE LAST
// BLOCKER.** `test/event-sink.test.ts` section 5 measures it:
// `payout.freeze_expiring`'s payload names neither tenancy column, so
// `assertTenanted` refuses it AFTER `buildEvent` has accepted the name. That is
// ADR-191 section 9's registered open item, its repair is a field on the
// catalogue row for the producer to resolve tenancy from, and EVENTS.md is what
// owes it. The hold and the withdrawal-halt names are both accepted.
//
// -----------------------------------------------------------------------------
// THE TERMS ARE MINTED AND NEVER SHAPED, WHICH IS WHY THEY COME THROUGH THE DOOR
// -----------------------------------------------------------------------------
// `ExpiryTerms` is declared in `ports.ts` and DELIBERATELY not constructible
// there: `packages/db` keeps a `WeakSet` of every term it minted and
// `isFilterTerm` reads IDENTITY rather than shape, so a hand-rolled
// `{ term: 'at-most', value }` is refused by the accessor even though it
// type-checks everywhere above it. This file therefore does not build a term; it
// passes `src/db.ts`'s re-exports through untouched, and the suite asserts
// `isFilterTerm` over what the port hands back rather than asserting the shape.
//
// -----------------------------------------------------------------------------
// THE HANDLE IS RECORDED ON THE WAY IN, AND THAT IS THE ONE LINE THE LEDGER
// DEPENDS ON
// -----------------------------------------------------------------------------
// `EXPIRY_LEDGER.postLt01` recovers its `LedgerTx` by the IDENTITY of the
// `ExpiryTx` it is given (ADR-315), and the only thing that records one is
// `recordExpiryTransaction`. **UNTIL THIS FILE IT HAD NO CALLER**, so the map
// was empty in every deployment and the adapter refused every handle. The call
// is written INSIDE `db.batch`'s callback and the recorder returns its own
// argument, so there is no arrangement of that line in which the sweep is handed
// a transaction the ledger cannot recognise.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE DOES NOT DO
// -----------------------------------------------------------------------------
// IT DOES NOT CALL `runExpirySweep`. Building an `ExpirySweepIo` makes the job
// RUNNABLE; calling it makes it RUN, and those are two decisions with two
// different blockers. `test/schedule.test.ts` case 3.1 derives every
// disposition from a caller census over this tree, so a call here would move the
// row to `scheduled` by force and the case would be right to refuse it.
//
// IT IMPORTS NO CALENDAR. `merit/no-calendar-in-expiry-path` is scoped by glob
// to `apps/**/*expiry*.ts`, which is why this file is named for the sweep rather
// than called `adapter.ts` beside `batch/adapter.ts`: the file that hands the
// sweep a live database is exactly where reaching for the trading calendar is
// tempting, and ADR-042's rule is wrong on roughly 104 days a year.
//
// IT NAMES NO PACKAGE. `@merit/db` is `src/db.ts`'s and `@merit/ledger` is
// `src/sweeps/ledger.ts`'s, both under ADR-165's one-door-per-package rule, and
// `test/db.test.ts` section 3 and
// `apps/api/test/ledger-posting-authority.test.ts` each assert the importer list
// is exactly one file. This file goes through both doors and opens neither.
//
// IT ADDS NO `SqlExecutorReason` MEMBER, ADDS NO `SystemReason` MEMBER, IMPORTS
// NO `pg`, AND CASTS PAST NO KEY TYPE (P5 section 11 rule 10, P7 section 11
// rule 10).
// =============================================================================

import { atMost, isNull } from '../db.ts';
import type { WorkerDb } from '../db.ts';

import { EXPIRY_LEDGER, recordExpiryTransaction } from './ledger.ts';
import type { ExpiryEventPort, ExpirySweepIo, ExpiryTerms, ExpiryTx } from './ports.ts';

/**
 * The transaction this deployable's one door hands out, named without importing
 * `@merit/db`.
 *
 * DERIVED FROM THE DOOR RATHER THAN RE-EXPORTED THROUGH IT, which is
 * `batch/adapter.ts`'s `BatchTx` for its own stated reason: `src/db.ts` grows
 * nothing, and if the door's callback signature changes this type changes with
 * it and every use below stops compiling.
 */
export type SweepTx = Parameters<Parameters<WorkerDb['batch']>[0]>[0];

/**
 * ADR-157's two read-path constructors, as the sweep's port.
 *
 * A CONSTANT AND NOT A FACTORY, because neither function closes over anything: a
 * term is minted per call by `packages/db` and this value only says WHICH
 * constructor goes with which name. That is the whole of what the sweep is
 * responsible for, and `test/expiry.test.ts` is what asserts which term lands on
 * which column.
 *
 * **THE TWO NAMES ARE PASSED THROUGH AND NOT WRAPPED.** A wrapper that rebuilt,
 * spread or froze the returned object would hand back something `isFilterTerm`
 * refuses, because that predicate reads a `WeakSet` of the objects `mintTerm`
 * built rather than the shape they have. The suite runs `isFilterTerm` over what
 * this hands back for exactly that reason.
 */
export const EXPIRY_TERMS: ExpiryTerms = { atMost, isNull };

/**
 * The sweep's whole outside world, over this deployable's doors.
 *
 * **`events` HAS NO DEFAULT AND NOTHING IN THIS REPOSITORY CAN BE PASSED FOR
 * IT.** That is the header's ruling in the type system: a wiring row that means
 * to schedule this job cannot construct its `io` without naming a sink, and
 * there is no sink to name, so the blocker stops being a sentence in
 * `schedule.ts` and becomes a call that does not compile. `declareProvisioningQueue`
 * takes its door as an argument with no default for the same reason (ADR-338).
 *
 * `now` IS DEFAULTED AND `events` IS NOT, AND THE ASYMMETRY IS THE POINT. A
 * process clock is a thing this deployable has; an event sink is a thing it does
 * not. `job.ts` already spends `() => new Date()` at the wiring for the nightly
 * fold, and ADR-157's bound is the sweep's own instant, so a fixture pins it by
 * passing its own.
 *
 * @param db the door, so a suite substitutes a recorder and needs no `DATABASE_URL`
 * @param events the sink, which this deployable cannot supply and the caller must
 * @param now the sweep's one instant, defaulted to the process clock
 */
export function expirySweepIo(
  db: WorkerDb,
  events: ExpiryEventPort,
  now: () => Date = () => new Date(),
): ExpirySweepIo {
  return {
    /**
     * ONE transaction per unit of work, RECORDED against the ledger adapter as
     * it is handed over.
     *
     * The recorder returns its own argument, so the handle the sweep writes the
     * release through IS the handle `postLt01` posts `LT-01` through, which is
     * ADR-006's requirement met by construction rather than by discipline.
     */
    transact: <T>(fn: (tx: ExpiryTx) => Promise<T>): Promise<T> =>
      db.batch((tx) => fn(recordExpiryTransaction(tx))),
    terms: EXPIRY_TERMS,
    ledger: EXPIRY_LEDGER,
    events,
    now,
  };
}
