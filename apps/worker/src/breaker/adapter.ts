// =============================================================================
// apps/worker/src/breaker/adapter.ts
// =============================================================================
// THE BREAKER EVALUATION'S FIRST LIVE PORTS, AND THE ONE THIS DEPLOYABLE CANNOT
// SERVE. ADR-352.
//
// -----------------------------------------------------------------------------
// THE SENTENCE THAT SENT THIS ROW, AND WHAT RE-DERIVING IT FOUND
// -----------------------------------------------------------------------------
// `schedule.ts`'s breaker row says `UNWIRED_BREAKER_IO` is the only `BreakerIo`
// in the tree, AND IT ALSO SAYS THE EVALUATOR WOULD DECLINE EVEN WIRED. Both
// halves reproduced exactly, which is worth saying plainly because the first
// half is the half a dispatch usually gets right and the second is the half that
// decides whether this job gets a clock.
//
// `BreakerIo` has FIVE members and this file serves FOUR of them. The fifth is
// `events`, and it is not an adapter that was never written:
//
//   1. `TRANSACTION_EVENT_WRITER` in `apps/api/src/events.ts` is the workspace's
//      only composed event writer. `RI-04` forbids one deployable depending on
//      another, `apps/worker/package.json` declares `@merit/db`,
//      `@merit/ledger`, `@merit/queue` and `@merit/rules-engine` and no `apps/*`
//      package at all, and under `node-linker=isolated` an undeclared specifier
//      resolves at neither run time nor build time. `test/event-sink.test.ts`
//      section 3 holds the fence.
//   2. AND THE NAME WOULD BE REFUSED EVEN IF THE FENCE DID NOT EXIST.
//      `EVENT_CATALOGUE` carries TEN names, derived by counting them, and not
//      one of them begins `breaker.`. `ADR-159` clause 1 makes the registry the
//      authority for a name, so `buildEvent` would throw at the NAME before it
//      ever read the payload.
//
// So `UNWIRED_BREAKER_EVENT_SINK` is not this file failing to try. It is two
// refusals, neither of which is inside this slice's fence.
//
// -----------------------------------------------------------------------------
// AND THE REFUSAL COSTS THE WHOLE RUN, WHICH IS WORSE THAN THE DETECTOR CASE
// -----------------------------------------------------------------------------
// `detectors/runner.ts` opens a transaction PER DETECTOR and `runOne` catches,
// so a refusing sink there costs one detector and the report says which.
// **`evaluateBreaker` OPENS ONE TRANSACTION FOR THE WHOLE RUN** (`ADR-006`: the
// alert commits with the row that changed state or neither does) AND CATCHES
// NOTHING. A single refused emit therefore rolls back every `plan_breaker_state`
// row the run had written and the call rejects.
//
// **AND THE FIRST RUN OF THIS JOB EMITS FOR EVERY ACTIVE PLAN.**
// `stateChangedEvent` returns `null` only when `previousState === state`, and on
// a plan's first evaluation `previousState` is `null` while `state` is one of
// the four `0016` admits. `null` is never equal to a state, so the event is
// built. A deployment holding this value therefore writes NOTHING on its first
// night rather than writing rows that go quiet later, and that is the honest
// outcome rather than a degraded one.
//
// -----------------------------------------------------------------------------
// THE CLOCK IS PINNED TO ONE INSTANT, AND THAT IS WHY THE FACTORY IS ASYNC
// -----------------------------------------------------------------------------
// **`tradingDayOf` IS SYNCHRONOUS AND THE ONLY HONEST SOURCE OF A TRADING DAY IN
// THIS DEPLOYABLE IS ASYNCHRONOUS.** That is the whole shape of this file and it
// is the ruling the writing forced.
//
// `ports.ts` says the day is "Supplied, never derived", and `ADR-146` clause 4
// forbids meeting an exchange CT trading day with a UTC calendar date derived
// from an instant. The one anchored source is `anchorLastClosedDay`, which reads
// `trading_calendar` AND `trading_calendar_loads` in one transaction and comes
// back with a COVERAGE VERDICT (`ADR-277`), and it returns a promise. A
// synchronous member cannot await it.
//
// So the day is resolved ONCE, BEFORE the value exists, and the factory is
// `async` because of it. **THE SAME INSTANT THEN BECOMES `now()`**, which is not
// a convenience: `ports.ts` states that `evaluated_on`, the window's lower bound
// and every override-expiry comparison all derive from `now`, so an instant that
// drifted from the one the day was anchored to would compute a thirty-day window
// against a day it does not belong to. `job.ts` anchors the nightly batch the
// same way, from `io.now()` and once.
//
// **AND `tradingDayOf` REFUSES ANY OTHER INSTANT RATHER THAN IGNORING ITS
// ARGUMENT.** A closure that returned its one day for every input would be a
// function whose parameter is a lie, and the lie would be invisible: a later
// caller passing a different instant would receive a day anchored to something
// else and no test could see it. It throws instead.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE DOES NOT DISCHARGE
// -----------------------------------------------------------------------------
// **THE EVALUATOR STILL DECLINES.** `resolvePolicy` runs BEFORE `io.now()` and
// before `io.transact`, and `LOSS_RATIO_POLICY.minSample` is `unstated` because
// `OQ-M6-02` is the founder's and is unanswered. So a deployment holding this
// value and the default policy raises `BreakerDeclined` without opening a
// transaction at all. **THAT IS A SECOND BLOCKER AND IT IS NOT AN ADAPTER**, and
// ADR-352 rules the job STILL UNSCHEDULED because of it.
//
// A THIRD IS MEASURED IN ADR-352 SECTION 5 AND IS NOT REPAIRED HERE: `0016`
// keys `plan_breaker_state` `PRIMARY KEY (plan_id, evaluated_on)`, `BreakerTx`
// publishes a plain `insert` with no upsert, and `CRON_INVENTORY` schedules this
// job DAILY while `evaluated_on` would carry the LAST CLOSED trading day. Those
// two cadences disagree on every non-session day. What `evaluated_on` means is a
// founder ruling and is recorded as an open question rather than decided here.
// =============================================================================

import { anchorLastClosedDay } from '../batch/adapter.ts';
import { atLeast, atMost } from '../db.ts';
import type { WorkerDb } from '../db.ts';
import { BREAKER_READ_TABLES, BREAKER_WRITE_TABLES } from './ports.ts';
import type {
  BreakerEventPort,
  BreakerFilter,
  BreakerIo,
  BreakerReadTable,
  BreakerTx,
  BreakerValues,
  BreakerWriteTable,
} from './ports.ts';

/**
 * The transaction the one door hands out, named without importing `@merit/db`.
 *
 * DERIVED FROM THE DOOR RATHER THAN RE-EXPORTED THROUGH IT, which is
 * `detectors/adapter.ts`'s `WorkerDetectorTx` and its reason: if the door's
 * callback signature changes, this type changes with it and every use below
 * fails to compile.
 */
export type WorkerBreakerTx = Parameters<Parameters<WorkerDb['batch']>[0]>[0];

/**
 * Every key the accessor admits, derived from the door.
 *
 * `SystemTx.rows` is generic over `TableKey` and its parameter type IS that
 * union, so this alias is the accessor's vocabulary reached without naming the
 * package. That is what lets the assertion below exist in a file that may not
 * import `@merit/db`.
 */
type AccessorTableKey = Parameters<WorkerBreakerTx['rows']>[0];

/**
 * Both breaker table unions are subsets of the accessor's keys, at COMPILE time.
 *
 * **THIS IS THE HALF OF THE CAST THAT A TEST CANNOT BUY**, on
 * `detectors/adapter.ts`'s argument: a run-time membership check proves the
 * caller named a table this file expected, and it cannot prove that
 * `'planBreakerState'` is still a key of the accessor. A table renamed in
 * `packages/db` leaves both lists here unchanged and every read failing at the
 * database. The conditional resolves to `never` in that case, and a
 * `never`-typed constant with a value assigned to it is a `tsc` error at this
 * line.
 */
type BreakerTablesAreAccessorKeys = [BreakerReadTable, BreakerWriteTable] extends [
  AccessorTableKey,
  AccessorTableKey,
]
  ? true
  : never;

/** The assertion above, given a value so the compiler has to evaluate it. */
const BREAKER_TABLES_ARE_ACCESSOR_KEYS: BreakerTablesAreAccessorKeys = true;

/** Read so the constant above is not an unused binding under `noUnusedLocals`. */
export const BREAKER_TABLES_AGREE_WITH_THE_ACCESSOR: boolean = BREAKER_TABLES_ARE_ACCESSOR_KEYS;

/**
 * Raised when a port this adapter installed cannot answer, with the blocker.
 *
 * SEPARATE FROM `BreakerUnwired` BECAUSE THEY NAME DIFFERENT THINGS, on
 * `DetectorAdapterUnwired`'s reasoning one directory over. That error says a
 * deployment installed NO adapter. This one says a deployment installed THIS
 * adapter and one member of it is blocked on work that has a home and a name,
 * which is the first question anybody asks a run that rejected.
 */
export class BreakerAdapterUnwired extends Error {
  /** The `BreakerIo` member that refused. */
  readonly port: string;

  // THE FIELD IS ASSIGNED RATHER THAN DECLARED IN THE PARAMETER LIST, on
  // `DetectorAdapterUnwired`'s reason: ADR-083 runs every deployable under
  // `node --experimental-strip-types` and a TypeScript parameter property is
  // `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` at load time.
  constructor(port: string, blocker: string) {
    super(
      `BreakerIo.${port} cannot be served by this deployment: ${blocker}. The whole run is ` +
        'rejected rather than committed without it, because evaluateBreaker holds ONE ' +
        'transaction for every plan and a plan_breaker_state row that commits while its ' +
        'breaker.state_changed alert is lost is a plan that stopped selling with nobody told.',
    );
    this.name = 'BreakerAdapterUnwired';
    this.port = port;
  }
}

/** The event sink's blocker, in the two parts the header enumerates. */
const EVENT_SINK_BLOCKER =
  'the only composed event writer in this workspace is TRANSACTION_EVENT_WRITER in ' +
  'apps/api/src/events.ts, RI-04 forbids one deployable depending on another and ' +
  'node-linker=isolated makes an undeclared specifier unresolvable, so no sink is reachable ' +
  'from apps/worker at all. AND THE NAME WOULD BE REFUSED ANYWAY: EVENT_CATALOGUE carries ten ' +
  'names and none of them begins `breaker.`, so buildEvent would throw at the name under ' +
  'ADR-159 clause 1 before it read the payload';

/**
 * The event sink this deployable has, which is a refusal.
 *
 * **A NO-OP SINK HERE WOULD BE THE WORST VALUE IN THIS FILE.** Every evaluation
 * would commit, every `breaker.state_changed` alert would be dropped on the
 * floor, and a plan whose sales had just been paused would have paused them with
 * nobody told. `ports.ts` says so in its own words citing `ADR-006`, and
 * `AS-M6-02` is the counter: an alert that omits its sample size "invites
 * exactly the override that destroys the control", and an alert that never
 * arrives omits everything.
 */
export const UNWIRED_BREAKER_EVENT_SINK: BreakerEventPort = {
  emit: () => Promise.reject(new BreakerAdapterUnwired('events.emit', EVENT_SINK_BLOCKER)),
};

/** Raised when a caller names a table outside the two closed unions. */
export class BreakerTableRefused extends Error {
  constructor(kind: 'read' | 'write', key: string) {
    super(
      `the breaker evaluation may not ${kind} \`${key}\`. INV-M5-12 closes both lists and this ` +
        'adapter is where the closure is enforced at run time: there is no code path from any ' +
        'liability signal to a payout block, and a table this evaluation cannot name is how ' +
        'that stays true.',
    );
    this.name = 'BreakerTableRefused';
  }
}

const READ_TABLES: ReadonlySet<string> = new Set(BREAKER_READ_TABLES);
const WRITE_TABLES: ReadonlySet<string> = new Set(BREAKER_WRITE_TABLES);

/** The membership half of the cast, checked rather than assumed. */
function refuseUnknownTable(kind: 'read' | 'write', key: string): void {
  const allowed = kind === 'read' ? READ_TABLES : WRITE_TABLES;
  if (!allowed.has(key)) throw new BreakerTableRefused(kind, key);
}

/**
 * One open transaction, as an evaluation needs to see it.
 *
 * TWO METHODS AND NOT SEVEN. `SystemTx` publishes `rows`, `rowAt`, `lockAt`,
 * `updateAt`, `deleteAt` and `sqlExecutor` beside the two below, and this
 * function is where they stop being reachable. `ports.ts` argues each absence
 * and `INV-M5-12` is the ruling: this evaluation writes `plan_breaker_state` and
 * emits one event and that is the complete list of its effects. **It pauses
 * sales. It does not pause payouts and cannot**, and after this function that is
 * a property of what the evaluation can NAME rather than of a value somebody
 * remembered not to set.
 */
function breakerTx(tx: WorkerBreakerTx): BreakerTx {
  return {
    rowsWhere(key: BreakerReadTable, where: BreakerFilter): Promise<unknown[]> {
      refuseUnknownTable('read', key);
      // THE CAST, AND THE HEADER OF `detectors/adapter.ts` IS ITS ARGUMENT. The
      // key is checked twice, once by the type alias above at compile time and
      // once by the line above at run time; the FILTER is checked by the
      // accessor, which throws on a property that is not a column and on an
      // empty filter.
      return tx.rowsWhere(key as never, where as never);
    },
    insert(key: BreakerWriteTable, values: BreakerValues): Promise<unknown[]> {
      refuseUnknownTable('write', key);
      return tx.insert(key as never, values as never);
    },
  };
}

/**
 * The unit of work one evaluation reads and writes in.
 *
 * IT SPENDS `'nightly-batch'` AND `SystemReason` GAINED NO MEMBER, which
 * `ports.ts` had already ruled in its own words: `LIVE_DB.batch` is
 * `transaction(systemDb('nightly-batch'), fn)` and a daily recomputation is a
 * scheduled job, which is what `'nightly-batch'` names.
 *
 * **ONE TRANSACTION FOR THE WHOLE RUN AND NOT ONE PER PLAN**, which is
 * `evaluateBreaker`'s shape rather than this function's choice, and `ADR-006` is
 * why: the alert commits with the row that changed state or neither does.
 */
export function postgresBreakerTransact(db: WorkerDb): BreakerIo['transact'] {
  return <T>(fn: (tx: BreakerTx) => Promise<T>): Promise<T> => db.batch((tx) => fn(breakerTx(tx)));
}

/**
 * Raised when the calendar cannot name a trading day for the instant given.
 *
 * **IT IS A REFUSAL AND NOT A FALLBACK.** `ADR-042` F-4 rules that an empty
 * calendar is not an unbroken holiday, and `ADR-277` rules that a day without a
 * coverage verdict is not a day. An adapter that answered anyway would stamp
 * `plan_breaker_state.evaluated_on` with a date no load ever declared, and the
 * dead-man switch that reads "a plan with no row for the day" would then be
 * satisfied by a row for a day that does not exist.
 */
export class BreakerCalendarRefused extends Error {
  constructor(why: string) {
    super(
      `the breaker evaluation cannot be anchored to a trading day: ${why}. The day is read from ` +
        'the exchange session calendar and is never derived from a clock (ADR-146 clause 4), so ' +
        'there is nothing to fall back to and a fabricated date would be this job inventing a ' +
        'calendar.',
    );
    this.name = 'BreakerCalendarRefused';
  }
}

/**
 * The `BreakerIo` this deployment would evaluate the breaker against.
 *
 * **IT IS `async` BECAUSE `tradingDayOf` IS NOT**, which the header argues at
 * length and is the ruling this row was forced to take. The calendar read is a
 * transaction and the port member is synchronous, so the day is anchored once,
 * here, before the value exists.
 *
 * **`at` DEFAULTS TO THE PROCESS CLOCK AND IS THEN THE ONLY INSTANT THE RUN
 * SEES.** `now()` returns it rather than reading the clock again, because
 * `ports.ts` states that `evaluated_on`, the window's lower bound and every
 * override-expiry comparison all derive from `now`: a second reading would
 * compute a window against an instant the day was not anchored to. A suite
 * passes its own instant and pins the whole evaluation, which is what `ports.ts`
 * says the injection is for.
 *
 * **THE SECOND ARGUMENT DEFAULTS TO A REFUSAL AND MUST STAY THAT WAY IN `src/`.**
 * `test/breaker-adapter.test.ts` asserts by reading this deployable's own source
 * that no module under `src/` passes it. A deployment that calls this with one
 * argument gets a value whose reads, writes, clock and calendar are all real and
 * whose first run rejects at the first state change, which is the state of this
 * job today and ADR-352 records it rather than hiding it behind a sink that
 * returns.
 *
 * **AND A DEPLOYMENT HOLDING THIS VALUE STILL DOES NOT EVALUATE**, because
 * `evaluateBreaker` resolves its policy before it touches any of this and
 * `OQ-M6-02` leaves `minSample` unstated. Wiring and scheduling are two
 * decisions and this file is only the first.
 */
export async function postgresBreakerIo(
  db: WorkerDb,
  at: Date = new Date(),
  events: BreakerEventPort = UNWIRED_BREAKER_EVENT_SINK,
): Promise<BreakerIo> {
  const anchor = await anchorLastClosedDay(db, at);
  if (anchor.kind !== 'anchored') throw new BreakerCalendarRefused(anchor.why);
  const tradingDay: string = anchor.tradingDay;
  const anchoredAt = at.getTime();

  return {
    transact: postgresBreakerTransact(db),
    // THE ACCESSOR'S OWN CONSTRUCTORS, REACHED BY NAME THROUGH THE ONE DOOR AND
    // NOT WRAPPED, which is `detectors/adapter.ts`'s idiom. A term is a term
    // only if `packages/db` minted it (`isFilterTerm` reads WeakSet membership
    // rather than shape), so a wrapper that rebuilt, spread or froze a copy of
    // the returned object would hand back something the accessor refuses, and
    // the refusal would arrive at the first live read rather than at this line.
    //
    // **THERE IS NO `isNull` HERE AND `BreakerTerms` DECLARES NONE.** `ports.ts`
    // rules the absence deliberate: this evaluation needs one window bound on
    // each of two tables and nothing else.
    terms: { atLeast, atMost },
    events,
    // A FRESH `Date` CARRYING THE ONE INSTANT, rather than the caller's own
    // object handed back. `Date` is mutable, and an evaluation that mutated the
    // value it was given would silently move the instant its day was anchored
    // to. The guard below then still passes, because it compares the instant
    // and not the identity.
    now: () => new Date(anchoredAt),
    tradingDayOf: (instant: Date): string => {
      // THE ARGUMENT IS CHECKED RATHER THAN IGNORED. This adapter anchored
      // exactly one instant against the calendar, so it can answer for exactly
      // one instant. A closure that returned its day for every input would be a
      // function whose parameter is a lie, and a caller passing a different
      // instant would receive a day anchored to something else with nothing to
      // see it.
      if (instant.getTime() !== anchoredAt)
        throw new BreakerCalendarRefused(
          `this adapter anchored ${new Date(anchoredAt).toISOString()} and was asked for ` +
            `${instant.toISOString()}. One evaluation gets one instant, and a second reading of ` +
            'the clock would compute a window against a day it was not anchored to',
        );
      return tradingDay;
    },
  };
}
