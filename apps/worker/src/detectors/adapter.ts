// =============================================================================
// apps/worker/src/detectors/adapter.ts
// =============================================================================
// THE DETECTOR RUNNER'S FIRST LIVE PORTS, AND THE ONE IT STILL CANNOT SERVE.
// ADR-349.
//
// -----------------------------------------------------------------------------
// THE SENTENCE THAT SENT THIS ROW, AND WHAT RE-DERIVING IT FOUND
// -----------------------------------------------------------------------------
// `schedule.ts`'s detector row said `UNWIRED_DETECTOR_RUNNER_IO` is the only
// `DetectorRunnerIo` in the tree, and that reproduced exactly. What did NOT
// reproduce is the reading that the adapter is the ONLY thing between
// `runDetectors` and a clock. `DetectorRunnerIo` has FIVE members and this file
// serves FOUR of them. The fifth is `events`, and it is not an adapter that is
// missing:
//
//   1. `TRANSACTION_EVENT_WRITER` is the workspace's only composed writer and
//      `@merit/ledger` publishes it, so the missing thing is the INSTALL and no
//      longer the reach. **THIS CLAUSE READ "and it is one deployable over",
//      WHICH WAS TRUE AND IS NOT** (kept beside its correction, `RI-14`):
//      `RI-04` forbade importing `apps/api`, `node-linker=isolated` made an
//      undeclared specifier unresolvable, and `test/event-sink.test.ts` section
//      3 still asserts that no relative specifier under `src` escapes this
//      deployable. ADR-410 moved the producer into a package this deployable
//      already declares and `test/db.test.ts` already permits, so none of the
//      three bites the writer any more. What is left is that no file under this
//      `src` composes a sink over it.
//   2. Of the runner's three event names, `detector.run_degraded` is a row in NO
//      version of `EVENTS.md` at all (`M07` section 5 carries it, marked NEW),
//      so `buildEvent` would refuse the NAME under `ADR-159` clause 1.
//   3. `detector.run_completed` is a catalogue row since `ADR-205` and the
//      runner's payload is one field short of it: `detector_run_id` is the
//      subject `subjectField` reads, and `test/event-sink.test.ts` section 4b
//      pins its absence.
//
// So `emitRunEvents` refusing is not this file failing to try. It is three
// blockers, none of which is an adapter, and none of which is inside this
// slice's fence.
//
// -----------------------------------------------------------------------------
// AND THE REFUSAL IS NOT QUIET, THOUGH IT NO LONGER COSTS THE RUN ITS ROW
// -----------------------------------------------------------------------------
// **THE PARAGRAPH HERE SAID `runner.ts` EMITS UNCONDITIONALLY SO A REJECTING
// `events.emit` ROLLS THE `detector_runs` ROW BACK, CALLED THAT THE HONEST
// ANSWER AND A USELESS RUN, AND ADR-409 RULES IT A DEFECT** (kept beside its
// correction, `RI-14`). The argument is sound and was applied to a population it
// is not about: a row committed without its page is `AS-M7-05`'s dashboard with
// an extra step only where there IS a page. The emit destroying every row was
// `detector.run_completed`, a BI point **no rule in `M07`, in `EVENTS` or in
// this deployable binds to the run row**; the bound one is
// `detector.run_degraded` and `ports.ts` says so of that name alone, citing
// `ADR-006`. So a BI event made every run unrecorded, `ok` runs included,
// against `INV-M7-07`. **`runner.ts` NOW EMITS THE PAGE FIRST AND FATALLY AND
// THE BI POINT SECOND AND RECOVERABLY**: this value RECORDS every non-degraded
// run carrying `DetectorAdapterUnwired` on the outcome, and a DEGRADED run still
// takes its row down with its page. Both are asserted in section 2 of
// `test/detector-adapter.test.ts`, the second of them being the control.
//
// -----------------------------------------------------------------------------
// THE SEAM, AND THE ONE THING IT MUST NOT BECOME
// -----------------------------------------------------------------------------
// {@link postgresDetectorRunnerIo} takes the sink as a SECOND PARAMETER with the
// refusal as its default, which is `writeRuleStateVia`'s shape in `batch/` and
// exists so the suite can drive a real detector through the real transact leg
// end to end. **A NO-OP SINK PASSED THERE WOULD BE THE WORST VALUE IN THIS
// FILE**: every run would commit, every `detector.run_degraded` page would be
// dropped on the floor, and the dashboard would be green. So
// `test/detector-adapter.test.ts` asserts by reading this deployable's own
// source that NO file under `src/` passes a second argument, and the one caller
// that does is a test that names itself.
//
// -----------------------------------------------------------------------------
// THE CAST AT THE BOUNDARY, AND THE RUN-TIME CHECK THAT MAKES IT HONEST
// -----------------------------------------------------------------------------
// `DetectorTx.rowsWhere` takes `DetectorFilter`, which is
// `Readonly<Record<string, unknown>>`, because a detector composes its window
// from registry parameters at run time and there is no narrower type it could
// have. `SystemTx.rowsWhere` takes `NamesAColumn<K, F>`. The two cannot meet
// without a cast, and this file is the one place in the deployable where they
// do.
//
// **WHAT THE CAST DOES NOT LOSE IS SAID TWICE, ONCE IN THE TYPE AND ONCE AT RUN
// TIME.** {@link ReadTablesAreAccessorKeys} makes every member of
// `DETECTOR_READ_TABLES` and `DETECTOR_WRITE_TABLES` a compile error here unless
// the accessor still carries a key of that name, derived from the door rather
// than imported, so a table renamed in `packages/db` stops this file compiling.
// And {@link refuseUnknownTable} re-checks membership at run time, because the
// port's compile-time guarantee is only as good as the caller's types and this
// adapter is the boundary a caller crosses.
//
// **THE COLUMN NAMES ARE NOT CHECKED HERE AND ARE NOT UNCHECKED EITHER.**
// `filterPredicate` throws `"<property>" is not a column of <key>` and an empty
// filter throws as "the unaddressed write under another name". Both land inside
// `attemptScan`'s `try`, so a detector naming a column that does not exist gets
// a `failed` run recorded with the accessor's message on it, which is exactly
// the outcome `INV-M7-07` wants and is not a silent empty window.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE DOES NOT DO
// -----------------------------------------------------------------------------
// It does not call `runDetectors`. `test/schedule.test.ts` case 3.1 derives a
// job's disposition from whether it has a caller under `src/`, so a call here
// would make the registry's `unscheduled` false while three blockers stand.
// It does not import `@merit/db`: the door and the terms both come from
// `src/db.ts`, per `ADR-165` and `test/db.test.ts`.
// It writes no table the runner does not write, and it holds no threshold: every
// number a detector runs on comes from `detector_definitions`, and this file
// never reads that table on its own account.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { atLeast, atMost, isNull } from '../db.ts';
import type { WorkerDb } from '../db.ts';
import { canaryNonce } from './canary.ts';
import type { CanaryNonce } from './canary.ts';
import { DETECTOR_READ_TABLES, DETECTOR_WRITE_TABLES } from './ports.ts';
import type {
  DetectorEventPort,
  DetectorFilter,
  DetectorReadTable,
  DetectorRunnerIo,
  DetectorTx,
  DetectorValues,
  DetectorWriteTable,
} from './ports.ts';

/**
 * The transaction the one door hands out, named without importing `@merit/db`.
 *
 * DERIVED FROM THE DOOR RATHER THAN RE-EXPORTED THROUGH IT, which is
 * `batch/adapter.ts`'s `BatchTx` and its reason: if the door's callback
 * signature changes, this type changes with it and every use below fails to
 * compile.
 */
export type WorkerDetectorTx = Parameters<Parameters<WorkerDb['batch']>[0]>[0];

/**
 * Every key the accessor admits, derived from the door.
 *
 * `SystemTx.rows` is generic over `TableKey` and its parameter type IS that
 * union, so this alias is the accessor's vocabulary reached without naming the
 * package. That is the whole trick that lets the assertion below exist in a file
 * that may not import `@merit/db`.
 */
type AccessorTableKey = Parameters<WorkerDetectorTx['rows']>[0];

/**
 * Both detector table unions are subsets of the accessor's keys, at COMPILE
 * time.
 *
 * **THIS IS THE HALF OF THE CAST THAT A TEST CANNOT BUY.** A run-time
 * membership check proves the caller named a table this file expected; it
 * cannot prove that `'economicCalendar'` is still a key of the accessor, because
 * a table renamed in `packages/db` leaves both lists here unchanged and every
 * read failing at the database. The conditional resolves to `never` in that
 * case, and a `never`-typed constant with a value assigned to it is a `tsc`
 * error at this line.
 */
type ReadTablesAreAccessorKeys = [DetectorReadTable, DetectorWriteTable] extends [
  AccessorTableKey,
  AccessorTableKey,
]
  ? true
  : never;

/** The assertion above, given a value so the compiler has to evaluate it. */
const DETECTOR_TABLES_ARE_ACCESSOR_KEYS: ReadTablesAreAccessorKeys = true;

/** Read so the constant above is not an unused binding under `noUnusedLocals`. */
export const DETECTOR_TABLES_AGREE_WITH_THE_ACCESSOR: boolean = DETECTOR_TABLES_ARE_ACCESSOR_KEYS;

/**
 * Raised when a port this adapter installed cannot answer, with the blocker.
 *
 * SEPARATE FROM `DetectorRunnerUnwired` BECAUSE THEY NAME DIFFERENT THINGS, on
 * `BatchPortUnwired`'s own reasoning one directory over. That error says a
 * deployment installed NO adapter. This one says a deployment installed THIS
 * adapter and one member of it is blocked on work that has a home and a name,
 * which is the first question anybody asks a report full of `unrecorded`.
 */
export class DetectorAdapterUnwired extends Error {
  /** The `DetectorRunnerIo` member that refused. */
  readonly port: string;

  // THE FIELD IS ASSIGNED RATHER THAN DECLARED IN THE PARAMETER LIST, on
  // `BatchPortUnwired`'s reason: ADR-083 runs every deployable under
  // `node --experimental-strip-types` and a TypeScript parameter property is
  // `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` at load time.
  constructor(port: string, blocker: string) {
    super(
      `DetectorRunnerIo.${port} cannot be served by this deployment: ${blocker}. The run is ` +
        'refused rather than committed without it, because a detector_runs row that commits ' +
        'while its detector.run_degraded page is lost is the green dashboard AS-M7-05 exists to ' +
        'refuse, with one extra step.',
    );
    this.name = 'DetectorAdapterUnwired';
    this.port = port;
  }
}

/** The event sink's blocker, in the three parts the header enumerates. */
const EVENT_SINK_BLOCKER =
  'the only composed event writer in this workspace is TRANSACTION_EVENT_WRITER and ' +
  '@merit/ledger publishes it, so this deployable can NAME the writer: RI-04 forbade the ' +
  'import while it sat in another deployable and ADR-410 moved it to a package apps/worker ' +
  'already declares. What is missing is the INSTALL, because no file under this src composes ' +
  'a sink over it. AND ' +
  'WIRING ONE WOULD NOT MAKE THESE THREE NAMES WRITE: detector.run_degraded is a row in no ' +
  'version of EVENTS.md (M07 section 5 carries it, marked NEW) so buildEvent would refuse the ' +
  'name under ADR-159 clause 1, and detector.run_completed is a catalogue row whose ' +
  'subjectField reads detector_run_id, which runner.ts does not put in the payload ' +
  '(test/event-sink.test.ts section 4b is the pin). ONE of the three blockers is inside ' +
  'apps/worker now and the other two are not, which is what ADR-410 changed about this ' +
  'sentence';

/**
 * The sink this deployment installs, which refuses.
 *
 * **IT IS THE DEFAULT AND NOT AN OPTION**, because the alternative default is a
 * sink that swallows, and a swallowed `detector.run_degraded` is a detector
 * reporting health it does not have. `ports.ts` states the criterion this
 * honours: the event "commits with the run row that is degraded, or neither
 * does".
 */
export const UNWIRED_DETECTOR_EVENT_SINK: DetectorEventPort = {
  emit: () => Promise.reject(new DetectorAdapterUnwired('events.emit', EVENT_SINK_BLOCKER)),
};

/**
 * Raised when a key crosses this boundary that is not in the port's own union.
 *
 * A RUN-TIME CHECK BEHIND A COMPILE-TIME TYPE, which is worth the six lines
 * because this file holds the deployable's only cast past a `TableKey`. The
 * port's guarantee is only as strong as the caller's types, and the caller here
 * is detector code composing a stream list from registry parameters.
 */
export class DetectorTableRefused extends Error {
  constructor(kind: 'read' | 'write', key: string) {
    super(
      `"${key}" is not a detector ${kind} table. DETECTOR_READ_TABLES and ` +
        'DETECTOR_WRITE_TABLES are closed unions and their absences are the ruling ' +
        '(detectors/ports.ts): identity_links, identity_restriction_episodes and admin_actions ' +
        'are each excluded by name. This adapter casts past the accessor key type once, and it ' +
        'refuses a key it was not shown rather than casting a surprise into a live database.',
    );
    this.name = 'DetectorTableRefused';
  }
}

const READ_TABLES: ReadonlySet<string> = new Set(DETECTOR_READ_TABLES);
const WRITE_TABLES: ReadonlySet<string> = new Set(DETECTOR_WRITE_TABLES);

/** The membership half of the cast, checked rather than assumed. */
function refuseUnknownTable(kind: 'read' | 'write', key: string): void {
  const allowed = kind === 'read' ? READ_TABLES : WRITE_TABLES;
  if (!allowed.has(key)) throw new DetectorTableRefused(kind, key);
}

/**
 * One open transaction, as a detector run needs to see it.
 *
 * TWO METHODS AND NOT SEVEN. `SystemTx` publishes `rows`, `rowAt`, `lockAt`,
 * `updateAt`, `deleteAt` and `sqlExecutor` beside the two below, and this
 * function is where they stop being reachable: `DetectorTx` declares an INSERT
 * and a filtered READ and nothing else, so `INV-M7-02` (a detector may cause no
 * status but `open`) is a property of what a detector can NAME rather than of a
 * value somebody remembered not to set. `ports.ts` argues each absence; this is
 * the code that makes the argument true.
 */
function detectorTx(tx: WorkerDetectorTx): DetectorTx {
  return {
    rowsWhere(key: DetectorReadTable, where: DetectorFilter): Promise<unknown[]> {
      refuseUnknownTable('read', key);
      // THE ONE CAST IN THIS DEPLOYABLE PAST A KEY TYPE, and the header is its
      // argument. The key is checked twice, once by the type alias above at
      // compile time and once by the line above at run time; the FILTER is
      // checked by the accessor, which throws on a property that is not a
      // column and on an empty filter, and both throws land in attemptScan's
      // catch and are recorded as a `failed` run.
      return tx.rowsWhere(key as never, where as never);
    },
    insert(key: DetectorWriteTable, values: DetectorValues): Promise<unknown[]> {
      refuseUnknownTable('write', key);
      return tx.insert(key as never, values as never);
    },
  };
}

/**
 * The unit of work a detector run reads and writes in.
 *
 * IT SPENDS `'nightly-batch'` AND `SystemReason` GAINED NO MEMBER, which
 * `src/db.ts` ruled and `M07` section 1.1 makes true of this job: a detector
 * run is nightly work with nobody to resolve. `runDetectors` opens TWO of these
 * per detector, a read and a write, and `runner.ts` says why: a read that threw
 * poisons its transaction, and the run whose read failed is the run that most
 * needs a row.
 */
export function postgresDetectorTransact(db: WorkerDb): DetectorRunnerIo['transact'] {
  return <T>(fn: (tx: DetectorTx) => Promise<T>): Promise<T> =>
    db.batch((tx) => fn(detectorTx(tx)));
}

/**
 * This run's nonce, drawn from the process's CSPRNG.
 *
 * **FRESHNESS IS THIS FUNCTION'S WHOLE PROMISE AND `ports.ts` SAYS SO**: the
 * runner enforces that every subject carries THIS run's nonce, which makes a
 * memorized BATTERY unusable, and what it cannot see from inside one run is an
 * adapter that returned the same nonce twice. `randomUUID` draws from
 * `crypto.randomBytes`, which is the only source in this deployable with real
 * entropy behind it.
 *
 * IT IS 36 CHARACTERS OF HEX AND HYPHENS, so `canaryNonce`'s two refusals
 * (shorter than 8, or carrying `:` or `#`) cannot fire on it. The constructor is
 * still called rather than the value cast, because a cast here would be this
 * file deciding that a nonce is well formed and the module that owns the
 * identifier grammar deciding it is the point.
 */
export function postgresDetectorNonce(): CanaryNonce {
  return canaryNonce(randomUUID());
}

/**
 * The `DetectorRunnerIo` this deployment would run detectors against.
 *
 * ONE REQUIRED ARGUMENT, WHICH IS THE DOOR, so a suite substitutes a recorder
 * and a deployment passes `LIVE_DB`. That is `postgresBatchPorts`' shape and
 * `src/db.ts`'s own seam.
 *
 * **THE SECOND ARGUMENT DEFAULTS TO A REFUSAL AND MUST STAY THAT WAY IN `src/`.**
 * The header says what a no-op sink here would cost and
 * `test/detector-adapter.test.ts` asserts that no module under `src/` passes it.
 * A deployment that calls this with one argument gets a value whose reads and
 * writes are real, whose clock and nonce are real, and whose every run comes
 * back `unrecorded` because the sink refuses inside the write transaction. That
 * is the state of this job today and ADR-349 records it rather than hiding it
 * behind a sink that returns.
 */
export function postgresDetectorRunnerIo(
  db: WorkerDb,
  events: DetectorEventPort = UNWIRED_DETECTOR_EVENT_SINK,
): DetectorRunnerIo {
  return {
    transact: postgresDetectorTransact(db),
    // THE ACCESSOR'S OWN CONSTRUCTORS, REACHED BY NAME THROUGH THE ONE DOOR AND
    // NOT WRAPPED, which is `sweeps/expiry-adapter.ts`'s idiom one directory
    // over. A term is a term only if `packages/db` minted it (`isFilterTerm`
    // reads WeakSet membership rather than shape), so a wrapper that rebuilt,
    // spread or froze a copy of the returned object would hand back something
    // the accessor refuses, and the refusal would arrive at the first live scan
    // rather than at this line.
    terms: { atMost, atLeast, isNull },
    events,
    // THE PROCESS CLOCK, AND IT IS THE ONLY ONE A RUN GETS. `started_at`,
    // `finished_at` and every `sla_due_at` derive from it, so a fixture pins the
    // whole run and the database never supplies an instant.
    now: () => new Date(),
    nonce: postgresDetectorNonce,
  };
}
