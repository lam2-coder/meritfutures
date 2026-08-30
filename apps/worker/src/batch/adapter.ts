// =============================================================================
// apps/worker/src/batch/adapter.ts
// =============================================================================
// `BatchPorts` OVER POSTGRES, THROUGH THIS DEPLOYABLE'S ONE DOOR.
//
// `ADR-239` measured that no `BatchPorts` VALUE was constructed under any `src/`
// in this workspace, and `apps/api/test/rule-state-producibility.test.ts` runs
// that measurement as a test. This file is the value. It is built on
// `WorkerDb.batch`, which is `systemDb('nightly-batch')` and `transaction()`,
// and it reaches `@merit/db` through `src/db.ts` and through nothing else:
// `test/db.test.ts` and `digests.test.ts` case 10.2 both assert that this
// deployable has exactly one file naming that package, and this file is not it.
//
// -----------------------------------------------------------------------------
// FOUR OF TEN ARE WHOLE, ONE IS FIVE FIELDS OF SIX, AND FIVE REFUSE BY NAME
// -----------------------------------------------------------------------------
// `databaseAccountReads` serves one of four and `databaseAuthBackend` four of
// sixteen, and in every case the refusal carries the blocker rather than a
// shrug. A partial adapter that answered with a plausible value would be worse
// than one that refuses, because the nightly batch's output is a money row and
// `runNightlyBatch` counts a `written` outcome per account that did not throw.
//
// | port                     | here                                             |
// |--------------------------|--------------------------------------------------|
// | `calendarWatermark`      | SERVED. `max(trading_calendar_revisions.id)`     |
// | `calendarSlice`          | SERVED. `trading_calendar`, sessions and coverage|
// | `accountsWithLiveMark`   | SERVED. `daily_marks` for the day, unsuperseded  |
// | `accountsWithStoredState`| SERVED. every `rule_states.account_id`           |
// | `loadAccountDay`         | FIVE FIELDS OF SIX. `external` refuses, ADR-248  |
// | `accountDaysFrom`        | REFUSES. `loadAccountDay`'s blocker, per account |
// | `storedRuleStates`       | REFUSES. no `RuleStateRow` READER, ADR-239 B     |
// | `writeRuleState`         | COMPOSED AND WHOLE, `ADR-250`. See below          |
// | `raiseReconciliation`    | REFUSES. no event writer in this deployable      |
// | `raiseDivergence`        | REFUSES. no event writer in this deployable      |
//
// **THE `loadAccountDay` ROW READ "REFUSES. six fields, and `prior` needs the
// codec" AND EVERY CLAUSE OF IT IS NOW FALSE.** It was written when
// `decodeEngineGates` did not exist. `ADR-250` landed the codec, and the half
// of that reason nobody re-derived is that `prior` is a `RuleState` and NOT a
// `RuleStateRow`: it carries no `contextGates`, no `stateHash` and no
// `calendarRevisionId`, so it is a STRICTLY SMALLER read than `storedRuleStates`
// and the codec was the whole of what it was missing. `ADR-250` section 7 said
// so of the row and not of this field. Five of the six resolve here and one does
// not; `ACCOUNT_DAY_BLOCKER` names that one and nothing else.
//
// **THE WRITE PORT IS COMPOSED RATHER THAN WRITTEN AND THAT IS THE POINT.**
// `writeRuleStateVia` in `state-writer.ts` already holds every column, every
// refusal and the unique-violation reading; what it takes is a
// `RuleStateWriterIo`, whose `transact` is the door THIS file supplies and
// whose `encodeEngineGates` is `ADR-239` slice A. That slice's home is
// `packages/rules-engine` and not this deployable, on `ADR-239`'s own reasoning:
// `readLiability` in `apps/api` needs the DECODER and cannot import
// `apps/worker`, so an encoder here and a decoder there is `FM-16`, two
// statements of one predicate with nothing comparing them. So the encoder leg
// was `UNWIRED_RULE_STATE_WRITER_IO`'s UNTIL `ADR-250` landed that slice at
// `gates-codec.ts`; this file now IMPORTS the encoder, in that one property.
//
// **THE REFUSALS ARE NOT A WEAKER POSITION THAN THE EXIT-0 THIS ROW REPLACES.**
// A port that throws stops the batch, `runNightlyBatch` does not catch, `main`
// does not catch, and the process leaves a NON-ZERO status. `ADR-241` is the
// ruling; the property is asserted by a test that watches a real process exit.
//
// -----------------------------------------------------------------------------
// WHAT THE ADAPTER OWES AND HAS NOT PAID
// -----------------------------------------------------------------------------
// `nightly.ts` states it in terms: "THE ADAPTER OWES A PER-ACCOUNT ADVISORY
// LOCK", which is `FM-10` rather than a preference. This adapter does not take
// one, because `SystemTx` publishes `lockAt` over a ROW and `FM-10`'s lock is on
// the ACCOUNT, taken around the whole fold rather than around the insert. That
// debt is why `ADR-241` fixes the batch's concurrency at 1 in the job that runs
// it: one account in flight at a time is not the lock, and it is the difference
// between a race with the settlement webhook and a queue behind it.
//
// -----------------------------------------------------------------------------
// EVERY READ HERE IS A WHOLE-TABLE READ, STATED RATHER THAN DISCOVERED
// -----------------------------------------------------------------------------
// `SystemTx.rowsWhere` narrows by EQUALITY on a column or by a `FilterTerm`, and
// the three term constructors live in `@merit/db`, which this file may not
// import. So `superseded_by IS NULL` and `session_close_at <= $1` are applied in
// this process rather than in the query, over rows the accessor returned. For
// `trading_calendar` and `trading_calendar_revisions` that is a few thousand
// rows and it is the right trade. For `rule_states` it is not, and
// `accountsWithStoredState` says so at its own site: it is `B.1`'s "every
// account that has ever existed", it grows with the estate, and the repair is a
// distinct read on the accessor rather than a filter term.
// =============================================================================

import type { BreachKind, CalendarSlice, Phase, TradingDay } from '@merit/rules-engine';
import {
  buildCalendarSlice,
  decodeEngineGates,
  encodeEngineGates,
  resolvePlan,
} from '@merit/rules-engine';

import type { WorkerDb } from '../db.ts';
import type { AccountDay, BatchPorts, BatchReadPort, BatchWritePort } from './ports.ts';
import { writeRuleStateVia } from './state-writer.ts';

/**
 * The transaction the one door hands out, named without importing `@merit/db`.
 *
 * DERIVED FROM THE DOOR RATHER THAN RE-EXPORTED THROUGH IT, so `src/db.ts` grows
 * nothing and this file still names no package it is not allowed to name. If the
 * door's callback signature changes, this type changes with it and every use
 * below fails to compile, which is what a derived type is for.
 */
export type BatchTx = Parameters<Parameters<WorkerDb['batch']>[0]>[0];

/**
 * A port this deployment cannot serve, and the blocker it is waiting on.
 *
 * SEPARATE FROM `RuleStateWriterUnwired` BECAUSE THEY NAME DIFFERENT THINGS. That
 * one says a deployment installed no writer; this one says a deployment installed
 * this adapter and the adapter cannot answer, because the work behind the answer
 * is a slice with a home and a name. The message carries both, because the first
 * question anybody asks a red batch is what to build next.
 */
export class BatchPortUnwired extends Error {
  /** The `BatchPorts` method that refused. */
  readonly port: string;

  // THE FIELD IS ASSIGNED RATHER THAN DECLARED IN THE PARAMETER LIST, on
  // `RuleStateEncodingRefusal`'s own reason: ADR-083 runs every deployable under
  // `node --experimental-strip-types`, and a TypeScript parameter property is
  // `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` at load time while `tsc --noEmit`
  // accepts it.
  constructor(port: string, blocker: string) {
    super(
      `BatchPorts.${port} cannot be served by this deployment: ${blocker}. The batch refuses ` +
        'rather than returning, because a fold fed an invented input writes a money row that ' +
        'nobody can tell from a correct one.',
    );
    this.name = 'BatchPortUnwired';
    this.port = port;
  }
}

/**
 * The blocker `loadAccountDay` and `accountDaysFrom` share, NARROWED TO ONE FIELD.
 *
 * **THIS CONSTANT NAMED SIX FIELDS AND RESOLVED NONE OF THEM. IT NOW NAMES ONE.**
 * `plan`, `prior`, `mark`, `settlements` and `openedOn` are all read below, off
 * tables this deployable's one door already reaches. `external` is not, and it is
 * not a resolver nobody has written: `ADR-248` ruled it NOT CONSTRUCTIBLE because
 * `hasPayoutInFlight` is a predicate `M01` states at two grains, and a value
 * invented for any of R-40's five is a veto that never fires on the door where
 * money leaves the firm.
 */
const ACCOUNT_DAY_BLOCKER =
  '`AccountDay.external` is an `ExternalGates`, which ADR-248 ruled NOT CONSTRUCTIBLE in this ' +
  'deployable: `hasPayoutInFlight` reads R-38, and M01 states R-38 at the ACCOUNT grain in ' +
  'section 2.1 and at the IDENTITY grain in Group F, which differ by exactly the identities ' +
  'holding more than one account. A resolver written here would pick the winner of an open ' +
  'corpus question inside a worker, and both a permissive and a refusing default are wrong: one ' +
  'pays a trader R-38 would stop and the other denies every eligible trader while reading as a ' +
  'working gate. THE OTHER FIVE FIELDS RESOLVE AND ARE RESOLVED BEFORE THIS THROWS, so the ' +
  'refusal is about the gates and about nothing else. It clears when the grain is RULED';

/**
 * `accountDaysFrom`'s blocker, which is `loadAccountDay`'s AND ONE MORE.
 *
 * **IT IS NOT THE SAME REASON AND SHARING THE CONSTANT WOULD SAY IT WAS.** This
 * port is `INV-04`'s left-hand side: every day from day one, which is a walk
 * over the account's whole mark history rather than one call repeated. Nothing
 * in this session built that walk, and the day it is built it still cannot
 * return, because every element of the array carries the same `external`.
 */
const ACCOUNT_DAYS_FROM_BLOCKER =
  `${ACCOUNT_DAY_BLOCKER}. AND THIS PORT OWES A SECOND THING: it is INV-04's whole input ` +
  'history rather than one day, so it is a walk over every live `daily_marks` row for the ' +
  'account with a per-day prior, and no session has written that walk. Both are owed and the ' +
  'gates are the one that is not a matter of typing it';

/** The blocker every `engine_gates` READ shares. `ADR-239` slice A. */
const DECODER_BLOCKER =
  'THE CODEC LANDED (ADR-250) AND THIS REASON NARROWS TO WHAT IS LEFT. ' +
  '`decodeEngineGates` (`packages/rules-engine/src/gates-codec.ts`) rebuilds an ' +
  '`EngineGateResults` whose cents are `bigint`, and this file imports its encoder. ' +
  'WHAT IS ABSENT IS A `RuleStateRow` READER: one jsonb leaf decoded is not a row rebuilt, ' +
  '`contextGates` has its own stored shape, and the rest of that read is ADR-239 slice B';

/** The blocker both event channels share. */
const EVENT_SINK_BLOCKER =
  'both findings are EVENTS and this deployable has no writer for one. `TRANSACTION_EVENT_WRITER` ' +
  'in `apps/api/src/events.ts` is the only composed writer in this tree, `apps/worker` declares ' +
  '`@merit/db` and `@merit/rules-engine` and nothing else, and under `node-linker=isolated` an ' +
  'undeclared import does not resolve at all. `EVENTS.md:194` names ' +
  '`replay.divergence_detected` one of the two events that must never be quiet, so a channel ' +
  'that swallowed a finding here would be the quiet this deployable exists to end';

// -----------------------------------------------------------------------------
// Reading rows the accessor typed as `unknown`
// -----------------------------------------------------------------------------
// `SystemTx.rows` returns `unknown[]`, so every field below is checked at the
// boundary and a surprise is a named throw rather than an `undefined` travelling
// into a fold. This is `account-reads.ts`'s idiom one deployable over, and it is
// transcribed rather than imported because that file is in another app.

/** A row the accessor returned, as a bag of columns. */
function asRow(value: unknown, key: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new BatchRowError(`a ${key} row is not an object`);
  return value as Record<string, unknown>;
}

/** A column the schema declares `NOT NULL` and `text` or `date`. */
function text(row: Record<string, unknown>, column: string, key: string): string {
  const value = row[column];
  if (typeof value !== 'string')
    throw new BatchRowError(`${key}.${column} is not text on the row the accessor returned`);
  return value;
}

/** A column the schema declares `NOT NULL` and `boolean`. */
function flag(row: Record<string, unknown>, column: string, key: string): boolean {
  const value = row[column];
  if (typeof value !== 'boolean') throw new BatchRowError(`${key}.${column} is not a boolean`);
  return value;
}

/**
 * A `bigint` key column, accepted in both spellings the driver produces.
 *
 * `pg` hands a `bigint` back as a string by default and drizzle's
 * `{ mode: 'bigint' }` converts it. A `number` is REFUSED, on
 * `account-reads.ts`'s reason: a `number` here means the value came through a
 * path that had already lost precision, and reading it would hide that.
 */
function bigintOf(row: Record<string, unknown>, column: string, key: string): bigint {
  const value = row[column];
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw new BatchRowError(
    `${key}.${column} is not an integer; it is ${typeof value}. An identity column read as a ` +
      'float is a watermark that silently stops moving',
  );
}

/** A `timestamptz` column, which the driver hands back as a `Date` or as `null`. */
function instantOrNull(row: Record<string, unknown>, column: string, key: string): Date | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  throw new BatchRowError(`${key}.${column} is not a timestamp`);
}

/** A row this adapter could not read as the schema declares it. */
export class BatchRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchRowError';
  }
}

// -----------------------------------------------------------------------------
// The calendar, as the engine needs it
// -----------------------------------------------------------------------------

/**
 * One `trading_calendar` row, as this adapter reads it.
 *
 * `sessionCloseAt` is here and `sessionOpenAt` is not, because the only question
 * this file asks of an instant is whether a session has ALREADY CLOSED. Reading
 * a column nothing consumes is how a reader comes to believe a decision depends
 * on it.
 */
interface CalendarRow {
  readonly tradingDay: string;
  readonly isHalfDay: boolean;
  readonly isHoliday: boolean;
  readonly halted: boolean;
  readonly sessionCloseAt: Date | null;
}

function toCalendarRow(value: unknown): CalendarRow {
  const row = asRow(value, 'tradingCalendar');
  return {
    tradingDay: text(row, 'tradingDay', 'tradingCalendar'),
    isHalfDay: flag(row, 'isHalfDay', 'tradingCalendar'),
    isHoliday: flag(row, 'isHoliday', 'tradingCalendar'),
    halted: flag(row, 'halted', 'tradingCalendar'),
    sessionCloseAt: instantOrNull(row, 'sessionCloseAt', 'tradingCalendar'),
  };
}

async function readCalendarRows(tx: BatchTx): Promise<readonly CalendarRow[]> {
  const rows = (await tx.rows('tradingCalendar')).map(toCalendarRow);
  return [...rows].sort((a, b) =>
    a.tradingDay < b.tradingDay ? -1 : a.tradingDay > b.tradingDay ? 1 : 0,
  );
}

/**
 * The calendar this adapter loaded, as an `ADR-049` value.
 *
 * **A HOLIDAY IS IN `coverage` AND IS NOT IN `days`, AND THE DIFFERENCE IS THE
 * WHOLE REASON `coverage` IS NOT DERIVABLE FROM `days`.** `types.ts` states it:
 * "a day INSIDE coverage that is not in `days` is positively not a trading day,
 * and a day OUTSIDE coverage is UNKNOWN. Those two answers differ and only one
 * of them is safe to act on." A holiday row is Merit knowing the day and knowing
 * it carries no session, so it bounds the coverage it sits inside and appears in
 * no session list. `0032` made `session_open_at` nullable exactly and only on a
 * holiday, and `is_holiday` is read here rather than the nullability, because a
 * flag is the column the DDL made the discriminator.
 *
 * **`sequence` IS DENSE OVER SESSIONS AND NOT OVER CALENDAR ROWS.** `R-37`
 * counts a cadence gap by subtracting sequences, and the gap it wants is in
 * TRADING DAYS. `packages/harness`'s `toCalendarSlice` names the same line as
 * the one that would change for a calendar with holidays in it: this is that
 * calendar, and this is that line.
 *
 * **COVERAGE IS EXACTLY WHAT WAS LOADED.** A slice claiming more than it holds
 * turns "outside coverage" misses into "not a session" misses, which is the one
 * substitution `ADR-042 F-4` and `ADR-049` both refuse. An EMPTY calendar
 * therefore has no coverage to declare and this function refuses rather than
 * inventing a window: `buildCalendarSlice` would accept `days: []` with any
 * coverage at all, and a batch folding against an empty slice would raise
 * `calendar_coverage_miss` on every account, which reads like a data incident
 * rather than like a database nobody loaded a calendar into.
 */
export function toCalendarSlice(rows: readonly CalendarRow[]): CalendarSlice {
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (first === undefined || last === undefined) {
    throw new BatchPortUnwired(
      'calendarSlice',
      '`trading_calendar` holds no rows, so this deployment has no calendar to declare coverage ' +
        'over. A slice with empty coverage would make every lookup a coverage miss and every ' +
        'account a reconciliation, which reports a data incident where the fact is that nobody ' +
        'has loaded the exchange calendar',
    );
  }

  let sequence = 0;
  const days = rows
    .filter((row) => !row.isHoliday)
    .map((row) => {
      const day = {
        tradingDay: row.tradingDay as TradingDay,
        isHalfDay: row.isHalfDay,
        halted: row.halted,
        sequence,
      };
      sequence += 1;
      return day;
    });

  return buildCalendarSlice({
    days,
    coverage: { from: first.tradingDay as TradingDay, to: last.tradingDay as TradingDay },
  });
}

/**
 * The latest trading day whose session has already closed at `at`.
 *
 * **THE DAY THE JOB CLOSES IS READ FROM THE CALENDAR AND IS NEVER DERIVED FROM A
 * CLOCK.** `ADR-146` clause 4 forbids a UTC calendar date derived from an instant
 * meeting an exchange CT trading day, and this function never crosses the two: an
 * instant is compared only with an instant (`session_close_at <= at`), and the
 * trading day is READ off the row that comparison selected. That is
 * `databaseEconomicCalendar`'s idiom in `apps/api`, which counts sessions that
 * have not yet opened and compares a count with a horizon.
 *
 * `null` when no session has closed, which on a fresh database is every day.
 * `ADR-241` section 5 is what the job does with that answer.
 */
export async function readLastClosedTradingDay(db: WorkerDb, at: Date): Promise<TradingDay | null> {
  const rows = await db.batch(async (tx) => readCalendarRows(tx));
  let latest: string | null = null;
  for (const row of rows) {
    if (row.isHoliday) continue;
    const close = row.sessionCloseAt;
    if (close === null) continue;
    if (close.getTime() > at.getTime()) continue;
    if (latest === null || row.tradingDay > latest) latest = row.tradingDay;
  }
  return latest === null ? null : (latest as TradingDay);
}

/** Whether the calendar carries this day at all, holiday or session. */
export async function calendarCarriesDay(db: WorkerDb, day: TradingDay): Promise<boolean> {
  const rows = await db.batch(async (tx) => tx.rowsWhere('tradingCalendar', { tradingDay: day }));
  return rows.length > 0;
}

// -----------------------------------------------------------------------------
// The ports
// -----------------------------------------------------------------------------

function readPort(db: WorkerDb): BatchReadPort {
  return {
    /**
     * `max(trading_calendar_revisions.id)`, or `null` when the calendar has
     * never been corrected.
     *
     * `null` IS A FACT AND NOT AN ABSENCE OF ONE, which `ports.ts` states and
     * this implementation has to honour: on a fresh database the calendar has
     * genuinely never been corrected, so every row this run writes is stamped
     * `null` CORRECTLY and replay reads it as a pristine calendar rather than as
     * an unknown one.
     *
     * The whole table is read and the maximum taken here, because narrowing to a
     * maximum needs an ordering the accessor does not publish. The table holds
     * one row per calendar correction ever made, which is a number that grows
     * with incidents rather than with the estate.
     */
    async calendarWatermark(): Promise<number | null> {
      const rows = await db.batch(async (tx) => tx.rows('tradingCalendarRevisions'));
      let highest: bigint | null = null;
      for (const value of rows) {
        const id = bigintOf(
          asRow(value, 'tradingCalendarRevisions'),
          'id',
          'tradingCalendarRevisions',
        );
        if (highest === null || id > highest) highest = id;
      }
      if (highest === null) return null;
      if (highest > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new BatchRowError(
          `trading_calendar_revisions.id ${highest.toString(10)} is past Number.MAX_SAFE_INTEGER ` +
            'and `RuleStateRow.calendarRevisionId` is a `number`. A watermark rounded here would ' +
            'stamp a state row with a revision that was never issued',
        );
      }
      return Number(highest);
    },

    async calendarSlice(): Promise<CalendarSlice> {
      const rows = await db.batch(async (tx) => readCalendarRows(tx));
      return toCalendarSlice(rows);
    },

    /**
     * Every account with an UNSUPERSEDED `daily_marks` row on the day.
     *
     * `0014`'s grain is one row per account per trading day and a correction is a
     * NEW row with the old one pointing at it, so the day's rows are read and the
     * superseded ones dropped here. `ports.ts` is explicit that a superseded mark
     * is never folded.
     *
     * SORTED AND DEDUPLICATED, because `runNightlyBatch` reports its outcomes in
     * the order this array returned them and a report that differs between two
     * runs over identical data is a report nobody can diff.
     */
    async accountsWithLiveMark(tradingDay: TradingDay): Promise<readonly string[]> {
      const rows = await db.batch(async (tx) => tx.rowsWhere('dailyMarks', { tradingDay }));
      const accounts = new Set<string>();
      for (const value of rows) {
        const row = asRow(value, 'dailyMarks');
        const superseded = row['supersededBy'];
        if (superseded !== null && superseded !== undefined) continue;
        accounts.add(text(row, 'accountId', 'dailyMarks'));
      }
      return [...accounts].sort();
    },

    /**
     * Every account that has ever held a rule state.
     *
     * **THE ONE READ HERE THAT DOES NOT SCALE, SAID AT ITS OWN SITE.** `B.1` is
     * "for EVERY account that has ever existed", so the answer is a projection
     * over the whole of `rule_states`, and this implementation reads the whole
     * table to compute it because the accessor publishes no distinct-column read.
     * It is correct and it grows with the estate. The repair is a read on
     * `packages/db` rather than a filter here, and it is owed before the replay
     * audit runs nightly rather than before this file lands, because nothing
     * calls this port yet: `runNightlyBatch` does not, and `runReplayAudit` is
     * unscheduled.
     */
    async accountsWithStoredState(): Promise<readonly string[]> {
      const rows = await db.batch(async (tx) => tx.rows('ruleStates'));
      const accounts = new Set<string>();
      for (const value of rows)
        accounts.add(text(asRow(value, 'ruleStates'), 'accountId', 'ruleStates'));
      return [...accounts].sort();
    },

    /**
     * One account's inputs for one day: `null` when it has no live mark, five
     * of six fields when it has, and a refusal naming `external`.
     *
     * **THE FIVE ARE RESOLVED BEFORE THE SIXTH REFUSES, AND THE ORDER IS THE
     * CLAIM.** A port that threw on the field name without reading anything
     * would be asserting that the other five are unreachable, which is what the
     * retired reason said and is no longer true. Reading them first makes the
     * refusal a MEASUREMENT per account-day: the plan resolved, the prior
     * decoded, the mark was live, the settlements landed on this day, and the
     * anchor was read, and then `ADR-248`'s field stopped it. The cost is one
     * account's reads on a batch that was going to stop at the first account
     * anyway.
     *
     * **THE `null` ARM IS A WHOLE ANSWER AND NOT A SMALLER REFUSAL.** `ports.ts`
     * declares it -- "or `null` if it has no live mark" -- and `nightly.ts`
     * counts it as `absent` rather than as a failure, so an account whose mark
     * was superseded between the partition read and this call is answered
     * correctly today.
     */
    async loadAccountDay(accountId: string, tradingDay: TradingDay): Promise<AccountDay | null> {
      const day = await db.batch(async (tx) => resolveAccountDay(tx, accountId, tradingDay));
      if (day === null) return null;
      throw new BatchPortUnwired('loadAccountDay', `${ACCOUNT_DAY_BLOCKER}. ${witness(day)}`);
    },

    accountDaysFrom(): Promise<never> {
      return Promise.reject(new BatchPortUnwired('accountDaysFrom', ACCOUNT_DAYS_FROM_BLOCKER));
    },

    storedRuleStates(): Promise<never> {
      return Promise.reject(new BatchPortUnwired('storedRuleStates', DECODER_BLOCKER));
    },
  };
}

function writePort(db: WorkerDb): BatchWritePort {
  return {
    /**
     * One `rule_states` row, through the writer that already owns the columns.
     *
     * **THE DOOR AND THE ENCODER ARE BOTH REAL NOW**, and this paragraph read
     * the opposite until `ADR-250`: the write reached
     * `RuleStateWriterUnwired('encodeEngineGates')` and the batch refused.
     * `state-writer.ts` put both halves on one `RuleStateWriterIo` so that "a
     * deployment installs a door and an encoding together or installs neither",
     * and the encoder is IMPORTED, not written here (`ADR-239` A, `FM-16`).
     */
    writeRuleState: writeRuleStateVia({
      transact: (fn) => db.batch((tx) => fn(tx)),
      encodeEngineGates,
    }),

    raiseReconciliation(): Promise<never> {
      return Promise.reject(new BatchPortUnwired('raiseReconciliation', EVENT_SINK_BLOCKER));
    },

    raiseDivergence(): Promise<never> {
      return Promise.reject(new BatchPortUnwired('raiseDivergence', EVENT_SINK_BLOCKER));
    },
  };
}

/**
 * The `BatchPorts` value this deployment runs the nightly batch against.
 *
 * ONE ARGUMENT, WHICH IS THE DOOR, so a suite substitutes a recorder and a
 * deployment passes `LIVE_DB`. That is `src/db.ts`'s own seam and the reason it
 * gave for being an interface rather than a free function.
 */
export function postgresBatchPorts(db: WorkerDb): BatchPorts {
  return { read: readPort(db), write: writePort(db) };
}

// =============================================================================
// THE ACCOUNT DAY: FIVE FIELDS OF SIX, READ OFF THE TABLES THAT HOLD THEM
// =============================================================================
// `ports.ts` says what an `AccountDay` is in one sentence -- "EVERY FIELD IS A
// ROW THE BATCH READ, NEVER A DEFAULT IT CHOSE" -- and names M01 section 5's
// input list: `daily_marks`, `trading_calendar`, `plan_versions`,
// `plan_version_sizes`, and settled `payout_requests`. Everything below is that
// list read through this deployable's one door, plus `accounts` for the pinned
// version, the size and R-32's anchor.
//
// -----------------------------------------------------------------------------
// WHAT THE CODEC ACTUALLY DISCHARGED, WHICH IS NARROWER THAN IT LOOKS
// -----------------------------------------------------------------------------
// `ADR-250` section 7 is careful and it is about `storedRuleStates`: "a
// `RuleStateRow` is twenty-odd columns read back and rebuilt: `contextGates` has
// its own stored shape, `calendarRevisionId` crosses a `bigint` column into a
// `number | null` field ... ONE `jsonb` LEAF DECODED IS NOT A ROW REBUILT."
// That is true of `storedRuleStates` and it is NOT true of `prior`.
//
// `AccountDay.prior` is a `RuleState`, and `RuleState` is NOT `RuleStateRow`.
// The three fields that made the row expensive are exactly the three a
// `RuleState` does not carry: `contextGates` (`INV-23` keeps it out of the
// replayed state), `stateHash` (`SD-08`, computed FROM a state rather than part
// of one) and `calendarRevisionId` (`ADR-047`, a stamp on the row). What is left
// is twenty scalar columns and one `jsonb` leaf, and the leaf is what `ADR-250`
// landed. So `prior` is a strictly smaller read than the port that still
// refuses, and the comment naming the codec as its blocker went stale the moment
// the codec merged.
//
// -----------------------------------------------------------------------------
// THE SIXTH FIELD IS NOT WRITTEN HERE AND THE REASON IS A RULING
// -----------------------------------------------------------------------------
// `ADR-248` ruling 3: `ExternalGates` is NOT CONSTRUCTIBLE in this deployable.
// Three of its five facts resolve off registered tables and two do not, and the
// one that matters is `hasPayoutInFlight`: `M01` section 2.1 declares R-38 at
// the ACCOUNT grain and Group F restates it at the IDENTITY grain, `M01` is
// FROZEN, and both sentences are in it. `evaluatePayout` conjoins all five as
// VETOES (`R-41`), so a value invented for any of them is a gate that never
// fires on the path where money leaves the firm. Nothing below writes one, and
// no permissive or refusing default stands in for one.
//
// -----------------------------------------------------------------------------
// A SECOND DECODER OF `plan_versions.rules` EXISTS AND THIS IS THE SECOND ONE
// -----------------------------------------------------------------------------
// STATED HERE RATHER THAN DISCOVERED LATER. `apps/site/src/catalog/adapter.ts`
// already decodes `PlanRulesJson` and `PlanVersionSizeRow` key for key, and this
// file now does it again. That is `FM-16`'s shape -- two statements of one
// predicate with nothing comparing them -- and it is the shape `ADR-239` slice A
// and `ADR-250` moved the gates codec into `packages/rules-engine` to avoid.
//
// THE TWO ARE NOT YET THE SAME PREDICATE, WHICH IS WHY THIS IS A FINDING RATHER
// THAN A DEFECT. That decoder reads an HTTP RESPONSE -- `ADR-096` ruling 1 puts
// `apps/site` on the public API with no database connection at all -- so its
// input is the wire's rendering, where `API_CONTRACT` makes cents a decimal
// STRING. This one reads the COLUMN, where `DATA_MODEL` section 11 writes
// `"min_payout_cents": 10000` as a JSON NUMBER. `ADR-250` section 5 drew exactly
// this line for the gates: "THE WIRE MAY BE LOSSY BECAUSE A CONTRACT IS AN
// ALLOWLIST. THE STORE MAY NOT." The two decoders will converge the day the API
// serves this shape out of the column, and the home for the merged one is
// `packages/rules-engine`, beside `gates-codec.ts`, on `ADR-250` section 2's
// argument unchanged. THIS ROW'S FENCE FORBIDS THAT PACKAGE, so the finding is
// registered and not taken.
//
// -----------------------------------------------------------------------------
// EVERY CENTS VALUE THAT ARRIVES AS A JSON NUMBER IS CHECKED FOR SAFETY
// -----------------------------------------------------------------------------
// `jsonb` numbers are `numeric` in Postgres and `number` after `JSON.parse`, so
// a cents value past `Number.MAX_SAFE_INTEGER` has ALREADY lost digits by the
// time this file sees it. `ADR-206` section 5 measured that leg on
// `engine_gates` and `ADR-250` executed it. The same leg carries
// `phase_funded.min_payout_cents` and every `payout_cap_schedule_cents.cap_cents`
// here, so both are refused rather than rounded: a cap silently reduced by
// rounding is a payout ceiling nobody published.
// =============================================================================

/**
 * An `AccountDay` with the one field this deployable may not construct removed.
 *
 * DERIVED FROM THE PORT RATHER THAN RESTATED, which is `BatchTx`'s own idiom at
 * the top of this file: if `ports.ts` grows a field, this type grows with it and
 * `resolveAccountDay` fails to compile, which is what a derived type is for.
 */
export type AccountDayInputs = Omit<AccountDay, 'external'>;

/** The two arguments `resolvePlan` takes, named off the function rather than re-imported. */
type PublishedRules = Parameters<typeof resolvePlan>[0];
type PublishedSizeRow = Parameters<typeof resolvePlan>[1];

type StoredPrior = NonNullable<AccountDay['prior']>;
type LiveMark = AccountDay['mark'];
type Settlement = AccountDay['settlements'][number];

/** `Phase`, as `0001:45` declares `account_phase` and `types.ts` declares the union. */
const PHASES = ['eval', 'funded', 'closed', 'graduated'] as const satisfies readonly Phase[];

/**
 * `BreachKind`, as `0065`'s CHECK declares it.
 *
 * TYPED `text` IN THE COLUMN AND CLOSED HERE, which is `packages/db`'s own
 * reading: `rule-state-breach-vocabulary.test.ts` derives this union from the
 * engine and compares it to the migration, so the vocabulary has a comparator.
 */
const BREACH_KINDS = [
  'trailing_eod_floor',
  'static_floor',
  'hard_daily_loss_limit',
] as const satisfies readonly BreachKind[];

/** `PublishedDrawdownType`. THREE MEMBERS, and `resolvePlan` is what narrows it to two. */
const DRAWDOWN_TYPES = ['trailing_eod', 'static', 'intraday_trailing'] as const;

/** `PublishedConsistency['mode']`. CV-06's two, explicit so nobody remembers which phase is which. */
const CONSISTENCY_MODES = ['pass_time_dilutable', 'payout_gated'] as const;

// -----------------------------------------------------------------------------
// Columns this file reads that the four boundary readers above do not cover
// -----------------------------------------------------------------------------

/** A `text` or `date` column the schema declares NULLABLE. */
function textOrNull(row: Record<string, unknown>, column: string, key: string): string | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  throw new BatchRowError(`${key}.${column} is neither text nor null on the row returned`);
}

/** An `integer` column, NOT NULL. A count, never money: `INV-02` keeps money in `bigint`. */
function count(row: Record<string, unknown>, column: string, key: string): number {
  const value = row[column];
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new BatchRowError(
    `${key}.${column} is not a safe integer count on the row the accessor returned`,
  );
}

/** A `bigint` column the schema declares NULLABLE. */
function bigintOrNull(row: Record<string, unknown>, column: string, key: string): bigint | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  return bigintOf(row, column, key);
}

/**
 * A `bytea` column rendered as the lowercase hex of its bytes.
 *
 * **THE RENDERING IS CHOSEN FOR AN ORDERING AND NOT FOR A DISPLAY.**
 * `DailyMark.sourceHash` is a `string` and `replay.ts` uses it for exactly one
 * thing: the tiebreaker in "a total order over marks: trading day, then
 * `sourceHash`". Hex is order preserving over the underlying bytes, so the order
 * this rendering produces is the order the bytes have; base64 is not, and a
 * rendering that reordered two marks of one day would reorder the fold.
 */
function digest(row: Record<string, unknown>, column: string, key: string): string {
  const value = row[column];
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  throw new BatchRowError(
    `${key}.${column} is not the bytes a bytea column returns; it is ${typeof value}`,
  );
}

// -----------------------------------------------------------------------------
// Values inside a `jsonb` column, which the driver hands back already parsed
// -----------------------------------------------------------------------------
// EVERY READ NAMES ITS PATH. A `plan_versions.rules` that is one key short
// stops the batch with the key's name in the message, because the alternative is
// `undefined` reaching `advanceDay` as a plan parameter.

function jsonRecord(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new BatchRowError(`${at} is not a JSON object`);
  return value as Record<string, unknown>;
}

/** A key that must be PRESENT. An absent key is never the same as a null one. */
function jsonField(source: Record<string, unknown>, key: string, at: string): unknown {
  if (!Object.hasOwn(source, key))
    throw new BatchRowError(
      `${at}.${key} is absent, and this build reads it. A missing plan key is a parameter this ` +
        'adapter would have to invent, and DATA_MODEL section 12 puts no plan parameter in ' +
        'application code',
    );
  return source[key];
}

function jsonList(value: unknown, at: string): unknown[] {
  if (!Array.isArray(value)) throw new BatchRowError(`${at} is not a JSON array`);
  return value;
}

function jsonText(value: unknown, at: string): string {
  if (typeof value !== 'string') throw new BatchRowError(`${at} is not a JSON string`);
  return value;
}

function jsonFlag(value: unknown, at: string): boolean {
  if (typeof value !== 'boolean') throw new BatchRowError(`${at} is not a JSON boolean`);
  return value;
}

function jsonInteger(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new BatchRowError(
      `${at} is not a safe integer; a ratio is integer basis points (INV-03)`,
    );
  return value;
}

/**
 * A cents value stored inside `jsonb`.
 *
 * A JSON NUMBER IS ADMITTED AND CHECKED, A STRING OF DIGITS IS ADMITTED, AND
 * NOTHING ELSE IS. `DATA_MODEL` section 11 writes `min_payout_cents` as a
 * number, so refusing numbers outright would refuse every row written to the
 * approved shape; admitting an unsafe one would take a figure that had already
 * lost digits in `JSON.parse` and hand it to `R-39` as a floor.
 */
function jsonCents(value: unknown, at: string): bigint {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value))
      throw new BatchRowError(
        `${at} is ${String(value)}, and integer cents were required. A fractional or unsafe ` +
          'cents value has already lost digits by the time this adapter sees it (INV-02)',
      );
    return BigInt(value);
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw new BatchRowError(
    `${at} is not integer cents, as a safe-integer number or a string of digits`,
  );
}

function jsonNullable<T>(
  value: unknown,
  at: string,
  read: (v: unknown, at: string) => T,
): T | null {
  return value === null ? null : read(value, at);
}

function jsonMember<T extends string>(value: unknown, allowed: readonly T[], at: string): T {
  const text_ = jsonText(value, at);
  for (const member of allowed) if (member === text_) return member;
  throw new BatchRowError(`${at} is "${text_}", which is outside {${allowed.join(', ')}}`);
}

/** A closed-vocabulary COLUMN, read the same way and refused the same way. */
function member<T extends string>(
  row: Record<string, unknown>,
  column: string,
  allowed: readonly T[],
  key: string,
): T {
  const value = text(row, column, key);
  for (const one of allowed) if (one === value) return one;
  throw new BatchRowError(
    `${key}.${column} is "${value}", which is outside {${allowed.join(', ')}}`,
  );
}

// -----------------------------------------------------------------------------
// `plan_versions.rules`, decoded key for key
// -----------------------------------------------------------------------------
// THE RETURN TYPE IS THE ENGINE'S OWN, so the day `PlanRulesJson` grows a key
// this decoder fails to compile rather than silently dropping it. That is the
// property a cast cannot have, and a cast over a stored bag is a transcription
// nothing checks.

function toPublishedRules(value: unknown, at: string): PublishedRules {
  const source = jsonRecord(value, at);
  const version = jsonInteger(jsonField(source, 'schema_version', at), `${at}.schema_version`);
  if (version !== 1)
    throw new BatchRowError(
      `${at}.schema_version is ${String(version)} and this build reads 1. The engine's ` +
        '`PlanRulesJson` declares the literal, so a second schema is a different build rather ' +
        'than a branch inside this one',
    );

  return {
    schema_version: 1,
    phase_eval: toEvalPhase(jsonField(source, 'phase_eval', at), `${at}.phase_eval`),
    phase_funded: toFundedPhase(jsonField(source, 'phase_funded', at), `${at}.phase_funded`),
  };
}

function toEvalPhase(value: unknown, at: string): PublishedRules['phase_eval'] {
  const source = jsonRecord(value, at);
  return {
    enabled: jsonFlag(jsonField(source, 'enabled', at), `${at}.enabled`),
    profit_target_bp: jsonInteger(
      jsonField(source, 'profit_target_bp', at),
      `${at}.profit_target_bp`,
    ),
    drawdown: toDrawdown(jsonField(source, 'drawdown', at), `${at}.drawdown`),
    daily_loss_limit: toDailyLossLimit(
      jsonField(source, 'daily_loss_limit', at),
      `${at}.daily_loss_limit`,
    ),
    min_trading_days: jsonInteger(
      jsonField(source, 'min_trading_days', at),
      `${at}.min_trading_days`,
    ),
    consistency: toConsistency(jsonField(source, 'consistency', at), `${at}.consistency`),
    max_days: jsonNullable(jsonField(source, 'max_days', at), `${at}.max_days`, jsonInteger),
  };
}

function toFundedPhase(value: unknown, at: string): PublishedRules['phase_funded'] {
  const source = jsonRecord(value, at);
  return {
    drawdown: toDrawdown(jsonField(source, 'drawdown', at), `${at}.drawdown`),
    daily_loss_limit: toDailyLossLimit(
      jsonField(source, 'daily_loss_limit', at),
      `${at}.daily_loss_limit`,
    ),
    min_trading_days: jsonInteger(
      jsonField(source, 'min_trading_days', at),
      `${at}.min_trading_days`,
    ),
    win_days: toWinDays(jsonField(source, 'win_days', at), `${at}.win_days`),
    consistency: toConsistency(jsonField(source, 'consistency', at), `${at}.consistency`),
    buffer_bp: jsonInteger(jsonField(source, 'buffer_bp', at), `${at}.buffer_bp`),
    cadence_gap_trading_days: jsonInteger(
      jsonField(source, 'cadence_gap_trading_days', at),
      `${at}.cadence_gap_trading_days`,
    ),
    // M01 SECTION 2.4 REQUIRES THIS KEY AND DATA_MODEL SECTION 11's EXAMPLE
    // DOES NOT CARRY IT, which `types.ts` records at the field itself as "a
    // disagreement between two approved documents". It is READ rather than
    // defaulted, on that field's own reason: writing `0` here would be the
    // literal in engine code M01 refused, and `ADR-019`'s v1 value of zero is a
    // published constant rather than this adapter's opinion. A row missing it
    // stops the batch with the key's name, which is the honest half of the
    // disagreement rather than a silent side taken in a worker.
    min_settlement_lag_trading_days: jsonInteger(
      jsonField(source, 'min_settlement_lag_trading_days', at),
      `${at}.min_settlement_lag_trading_days`,
    ),
    payout_cap_schedule: toCapScheduleBp(
      jsonField(source, 'payout_cap_schedule', at),
      `${at}.payout_cap_schedule`,
    ),
    min_payout_cents: jsonCents(
      jsonField(source, 'min_payout_cents', at),
      `${at}.min_payout_cents`,
    ),
    split_bp: jsonInteger(jsonField(source, 'split_bp', at), `${at}.split_bp`),
    max_payouts: jsonInteger(jsonField(source, 'max_payouts', at), `${at}.max_payouts`),
    post_payout_floor_rule: {
      mode: jsonText(
        jsonField(
          jsonRecord(
            jsonField(source, 'post_payout_floor_rule', at),
            `${at}.post_payout_floor_rule`,
          ),
          'mode',
          `${at}.post_payout_floor_rule`,
        ),
        `${at}.post_payout_floor_rule.mode`,
      ),
    },
  };
}

function toDrawdown(value: unknown, at: string): PublishedRules['phase_funded']['drawdown'] {
  const source = jsonRecord(value, at);
  return {
    // THE THIRD MEMBER IS ADMITTED HERE AND REFUSED BY `resolvePlan`, which is
    // R-17 arriving where CV-01 put it. A decoder that narrowed to two would
    // make that refusal unreachable and its test vacuous.
    type: jsonMember(jsonField(source, 'type', at), DRAWDOWN_TYPES, `${at}.type`),
    amount_bp: jsonInteger(jsonField(source, 'amount_bp', at), `${at}.amount_bp`),
    lock: toFloorLock(jsonField(source, 'lock', at), `${at}.lock`),
  };
}

function toFloorLock(
  value: unknown,
  at: string,
): PublishedRules['phase_funded']['drawdown']['lock'] {
  const source = jsonRecord(value, at);
  return {
    enabled: jsonFlag(jsonField(source, 'enabled', at), `${at}.enabled`),
    at_profit_cents: jsonNullable(
      jsonField(source, 'at_profit_cents', at),
      `${at}.at_profit_cents`,
      jsonCents,
    ),
    floor_at_cents: jsonNullable(
      jsonField(source, 'floor_at_cents', at),
      `${at}.floor_at_cents`,
      jsonCents,
    ),
  };
}

function toDailyLossLimit(
  value: unknown,
  at: string,
): PublishedRules['phase_funded']['daily_loss_limit'] {
  const source = jsonRecord(value, at);
  return {
    type: jsonText(jsonField(source, 'type', at), `${at}.type`),
    amount_bp: jsonNullable(jsonField(source, 'amount_bp', at), `${at}.amount_bp`, jsonInteger),
  };
}

function toConsistency(value: unknown, at: string): PublishedRules['phase_funded']['consistency'] {
  const source = jsonRecord(value, at);
  return {
    enabled: jsonFlag(jsonField(source, 'enabled', at), `${at}.enabled`),
    max_day_share_bp: jsonNullable(
      jsonField(source, 'max_day_share_bp', at),
      `${at}.max_day_share_bp`,
      jsonInteger,
    ),
    mode: jsonMember(jsonField(source, 'mode', at), CONSISTENCY_MODES, `${at}.mode`),
  };
}

function toWinDays(value: unknown, at: string): PublishedRules['phase_funded']['win_days'] {
  const source = jsonRecord(value, at);
  return {
    required_count: jsonInteger(jsonField(source, 'required_count', at), `${at}.required_count`),
    floor_bp: jsonInteger(jsonField(source, 'floor_bp', at), `${at}.floor_bp`),
    reset_on_payout: jsonFlag(jsonField(source, 'reset_on_payout', at), `${at}.reset_on_payout`),
  };
}

function toCapScheduleBp(
  value: unknown,
  at: string,
): PublishedRules['phase_funded']['payout_cap_schedule'] {
  return jsonList(value, at).map((step, index) => {
    const where = `${at}[${String(index)}]`;
    const source = jsonRecord(step, where);
    return {
      from_ordinal: jsonInteger(jsonField(source, 'from_ordinal', where), `${where}.from_ordinal`),
      cap_bp: jsonInteger(jsonField(source, 'cap_bp', where), `${where}.cap_bp`),
    };
  });
}

// -----------------------------------------------------------------------------
// `plan_version_sizes`, one row, as the engine transcribes it
// -----------------------------------------------------------------------------

/**
 * One size row.
 *
 * `price_cents` AND `reset_price_cents` ARE COLUMNS AND ARE NOT READ. `types.ts`
 * says why in its own words: no `CV-nn` mentions either, no rule reads a price,
 * and M01 section 1.2 puts commerce outside the engine. A reader that could see
 * the price could grow a rule about it.
 */
function toSizeRow(value: unknown, at: string): PublishedSizeRow {
  const row = asRow(value, at);
  return {
    // THE BRAND IS ASSERTED AT THE ONE BOUNDARY THAT CAN. `INV-16` is that an
    // account's `plan_version_id` is an input and is never chosen by the engine;
    // this value is `plan_version_sizes.plan_version_id`, which is the column the
    // account's own pinned version resolved to, so the identity is CARRIED here
    // and invented nowhere.
    plan_version_id: text(row, 'planVersionId', at) as PublishedSizeRow['plan_version_id'],
    size_cents: bigintOf(row, 'sizeCents', at),
    drawdown_cents: bigintOf(row, 'drawdownCents', at),
    profit_target_cents: bigintOrNull(row, 'profitTargetCents', at),
    buffer_cents: bigintOf(row, 'bufferCents', at),
    win_day_floor_cents: bigintOf(row, 'winDayFloorCents', at),
    payout_cap_schedule_cents: toCapScheduleCents(
      row['payoutCapScheduleCents'],
      `${at}.payoutCapScheduleCents`,
    ),
    daily_loss_limit_cents: bigintOrNull(row, 'dailyLossLimitCents', at),
    floor_lock_enabled: flag(row, 'floorLockEnabled', at),
    floor_lock_at_profit_cents: bigintOrNull(row, 'floorLockAtProfitCents', at),
    floor_lock_floor_at_cents: bigintOrNull(row, 'floorLockFloorAtCents', at),
  };
}

function toCapScheduleCents(
  value: unknown,
  at: string,
): PublishedSizeRow['payout_cap_schedule_cents'] {
  return jsonList(value, at).map((step, index) => {
    const where = `${at}[${String(index)}]`;
    const source = jsonRecord(step, where);
    return {
      from_ordinal: jsonInteger(jsonField(source, 'from_ordinal', where), `${where}.from_ordinal`),
      cap_cents: jsonCents(jsonField(source, 'cap_cents', where), `${where}.cap_cents`),
    };
  });
}

// -----------------------------------------------------------------------------
// `rule_states`, one row, as a `RuleState`
// -----------------------------------------------------------------------------

/**
 * The prior state, rebuilt.
 *
 * **THREE COLUMNS OF THE ROW ARE NOT READ AND THEIR ABSENCE IS THE POINT.**
 * `context_gates` is `INV-23`'s half that never enters the replayed state,
 * `state_hash` is computed FROM a state rather than carried by one, and
 * `calendar_revision_id` is `ADR-047`'s stamp on the row. A `RuleState` has no
 * field for any of the three, so reading them here would be reading columns
 * nothing consumes -- which this file's calendar reader already names as "how a
 * reader comes to believe a decision depends on it".
 *
 * `computed_at`, `created_at` and `id` are the database's, per `ports.ts`.
 */
function toRuleState(value: unknown, at: string): StoredPrior {
  const row = asRow(value, at);
  return {
    tradingDay: text(row, 'tradingDay', at) as TradingDay,
    phase: member(row, 'phase', PHASES, at),
    balanceCents: bigintOf(row, 'balanceCents', at),
    floorOpenCents: bigintOf(row, 'floorOpenCents', at),
    floorCents: bigintOf(row, 'floorCents', at),
    floorLocked: flag(row, 'floorLocked', at),
    highWaterBalanceCents: bigintOf(row, 'highWaterBalanceCents', at),
    withdrawableCents: bigintOf(row, 'withdrawableCents', at),
    tradedDaysCount: count(row, 'tradedDaysCount', at),
    winDaysCount: count(row, 'winDaysCount', at),
    consistencyBestDayCents: bigintOf(row, 'consistencyBestDayCents', at),
    consistencyPeriodProfitCents: bigintOf(row, 'consistencyPeriodProfitCents', at),
    consistencyPeriodStartDay: textOrNull(
      row,
      'consistencyPeriodStartDay',
      at,
    ) as TradingDay | null,
    payoutsSettledCount: count(row, 'payoutsSettledCount', at),
    payoutAnchorDay: textOrNull(row, 'payoutAnchorDay', at) as TradingDay | null,
    cadenceAnchorDay: textOrNull(row, 'cadenceAnchorDay', at) as TradingDay | null,
    lifetimeSettledCents: bigintOf(row, 'lifetimeSettledCents', at),
    // ADR-250's codec, and the reason this port stopped waiting on one. It is
    // IMPORTED rather than written here: `apps/api` decodes the same column and
    // cannot import this deployable, so a second decoding would be FM-16.
    engineGates: decodeEngineGates(row['engineGates']),
    engineEligible: flag(row, 'engineEligible', at),
    breached: flag(row, 'breached', at),
    breachKind: breachKindOf(row, at),
    engineVersion: text(row, 'engineVersion', at),
  };
}

/**
 * `breach_kind`, with `0065`'s own pairing checked on the way past.
 *
 * `rule_states_breach_flag_matches_kind` is `breached = (breach_kind IS NOT
 * NULL)` at the store, so a row that reaches this reader with the pair split is
 * a row the database says cannot exist. It is refused rather than repaired,
 * because `day/progression.ts` records that a `null` kind on a `breached` row
 * would tell a consumer "a drawdown type that never happened".
 */
function breachKindOf(row: Record<string, unknown>, at: string): BreachKind | null {
  const raw = textOrNull(row, 'breachKind', at);
  const kind = raw === null ? null : jsonMember(raw, BREACH_KINDS, `${at}.breachKind`);
  const breached = flag(row, 'breached', at);
  if (breached !== (kind !== null))
    throw new BatchRowError(
      `${at} carries breached=${String(breached)} with breach_kind=${String(raw)}, which ` +
        '`rule_states_breach_flag_matches_kind` refuses at the store (0065)',
    );
  return kind;
}

// -----------------------------------------------------------------------------
// `daily_marks` and settled `payout_requests`
// -----------------------------------------------------------------------------

/**
 * The day's LIVE mark, or `null`.
 *
 * `0014`'s grain is one row per account per trading day and a correction is a
 * NEW row with the old one pointing at it, so the day's rows are read and the
 * superseded ones dropped here. TWO LIVE ROWS IS REFUSED rather than resolved:
 * the unique index makes it impossible, so a pair reaching this function is a
 * database nobody can fold, and picking one would fold a mark chosen by
 * whichever order the accessor happened to return.
 *
 * `tradedDay` AND `winDay` ARE COLUMNS AND ARE NOT READ. `types.ts` states the
 * rule: the engine DERIVES both, "and an engine that read them would be an
 * engine whose breach and win-day arithmetic depended on the ingester agreeing
 * with it".
 */
async function liveMark(
  tx: BatchTx,
  accountId: string,
  tradingDay: TradingDay,
): Promise<LiveMark | null> {
  const rows = await tx.rowsWhere('dailyMarks', { accountId, tradingDay });
  const live = rows
    .map((value) => asRow(value, 'dailyMarks'))
    .filter((row) => row['supersededBy'] === null || row['supersededBy'] === undefined);

  const first = live[0];
  if (first === undefined) return null;
  if (live.length > 1)
    throw new BatchRowError(
      `daily_marks holds ${String(live.length)} unsuperseded rows for account ${accountId} on ` +
        `${tradingDay}, and daily_marks_account_day_uq makes that unwritable. The fold refuses ` +
        'rather than choosing one, because either choice is a money row nobody can re-derive',
    );

  return {
    tradingDay: text(first, 'tradingDay', 'dailyMarks') as TradingDay,
    openingBalanceCents: bigintOf(first, 'openingBalanceCents', 'dailyMarks'),
    closingBalanceCents: bigintOf(first, 'closingBalanceCents', 'dailyMarks'),
    highBalanceCents: bigintOf(first, 'highBalanceCents', 'dailyMarks'),
    lowBalanceCents: bigintOf(first, 'lowBalanceCents', 'dailyMarks'),
    realizedPnlCents: bigintOf(first, 'realizedPnlCents', 'dailyMarks'),
    adjustmentCents: bigintOf(first, 'adjustmentCents', 'dailyMarks'),
    fillCount: count(first, 'fillCount', 'dailyMarks'),
    sourceHash: digest(first, 'sourceHash', 'dailyMarks'),
  };
}

/**
 * `D-M5-1`: the settlements whose `effective_trading_day` IS THIS DAY.
 *
 * **THE STATUS TERM IS `settled` AND THE DAY TERM IS `effective_trading_day`,
 * AND SWAPPING EITHER CHANGES WHOSE MONEY MOVES.** `0010`'s own comment splits
 * the two dates: "settled_trading_day is when the settlement happened;
 * effective_trading_day is the FIRST TRADING DAY WHOSE OPENING BALANCE"
 * reflects it, which is `SD-03`, and `DO-2` applies the fact on the day the
 * balance moved. `payout_requests_settled_has_trading_days` makes both columns
 * `NOT NULL` on a `settled` row, so the filter cannot silently drop one.
 *
 * SORTED BY ORDINAL, because `applySettlement` is idempotent per request and the
 * batch's report is diffed against yesterday's.
 */
async function settlementsOn(
  tx: BatchTx,
  accountId: string,
  tradingDay: TradingDay,
): Promise<readonly Settlement[]> {
  const rows = await tx.rowsWhere('payoutRequests', { accountId });
  const facts: Settlement[] = [];
  for (const value of rows) {
    const row = asRow(value, 'payoutRequests');
    if (text(row, 'status', 'payoutRequests') !== 'settled') continue;
    if (textOrNull(row, 'effectiveTradingDay', 'payoutRequests') !== tradingDay) continue;
    facts.push({
      payoutRequestId: text(row, 'id', 'payoutRequests'),
      ordinal: count(row, 'payoutOrdinal', 'payoutRequests'),
      approvedCents: bigintOf(row, 'approvedCents', 'payoutRequests'),
      basisTradingDay: text(row, 'basisTradingDay', 'payoutRequests') as TradingDay,
      effectiveTradingDay: tradingDay,
    });
  }
  return facts.sort((a, b) => a.ordinal - b.ordinal);
}

// -----------------------------------------------------------------------------
// The five, assembled
// -----------------------------------------------------------------------------

/**
 * Every field of an `AccountDay` this deployable may construct, or `null`.
 *
 * ONE TRANSACTION, and the reads are ordered cheapest-refusal-first: the live
 * mark decides the `null` arm, so an account with no mark costs one read rather
 * than five.
 *
 * **THIS FUNCTION TAKES NO ADVISORY LOCK AND THE DEBT IS THIS FILE'S HEADER'S.**
 * `FM-10`'s lock is on the ACCOUNT, held around the whole fold rather than around
 * a read, and `SystemTx.lockAt` publishes a lock over a ROW. `ADR-241` fixes the
 * batch's concurrency at 1 for exactly that reason, and nothing here changes it.
 */
export async function resolveAccountDay(
  tx: BatchTx,
  accountId: string,
  tradingDay: TradingDay,
): Promise<AccountDayInputs | null> {
  const mark = await liveMark(tx, accountId, tradingDay);
  if (mark === null) return null;

  const account = asRow(
    (await tx.rowAt('accounts', { id: accountId })) ?? missing('accounts', accountId),
    'accounts',
  );
  const planVersionId = text(account, 'planVersionId', 'accounts');
  const sizeCents = bigintOf(account, 'sizeCents', 'accounts');

  return {
    accountId,
    plan: await resolvePinnedPlan(tx, planVersionId, sizeCents),
    prior: await priorState(tx, accountId, tradingDay),
    mark,
    settlements: await settlementsOn(tx, accountId, tradingDay),
    // R-32's anchor, READ AND NEVER DERIVED (ADR-051). `accounts.opened_on` is
    // `date NOT NULL`, so an account row that exists carries one.
    openedOn: text(account, 'openedOn', 'accounts') as TradingDay,
  };
}

/** A row a NOT NULL foreign key says must exist. */
function missing(table: string, id: string): never {
  throw new BatchRowError(
    `${table} holds no row at ${id}, and a foreign key in this schema says it must. The fold ` +
      'refuses rather than continuing without it',
  );
}

/**
 * The account's PINNED plan version at its OWN size, resolved.
 *
 * **`INV-16` IS HONOURED BY THE SHAPE RATHER THAN BY A CHECK.** The version and
 * the size are the ACCOUNT's columns, passed in; this function chooses neither
 * and has no way to. `GS-041`'s "config migration never touches existing
 * accounts" is true at the only layer that could break it because that layer
 * never selects a version.
 *
 * THE SIZE GRID IS READ BY VERSION AND MATCHED IN THIS PROCESS. The unique key
 * is `(plan_version_id, size_cents)` and `0004:220` declares it as a standalone
 * `CREATE UNIQUE INDEX`, which `getTableConfig` cannot see, so `packages/db`
 * refuses that pair as an ADDRESS. A version has four size rows in v1, so the
 * read is four rows and the match is exact.
 */
async function resolvePinnedPlan(
  tx: BatchTx,
  planVersionId: string,
  sizeCents: bigint,
): Promise<AccountDay['plan']> {
  const version = asRow(
    (await tx.rowAt('planVersions', { id: planVersionId })) ??
      missing('plan_versions', planVersionId),
    'planVersions',
  );
  const rules = toPublishedRules(version['rules'], `plan_versions[${planVersionId}].rules`);

  const grid = await tx.rowsWhere('planVersionSizes', { planVersionId });
  const sizes = grid
    .map((value, index) => toSizeRow(value, `plan_version_sizes[${String(index)}]`))
    .filter((row) => row.size_cents === sizeCents);

  const size = sizes[0];
  if (size === undefined)
    throw new BatchRowError(
      `plan_version_sizes holds no row for plan version ${planVersionId} at ` +
        `${sizeCents.toString(10)} cents, and the account is pinned to that pair. Every cents ` +
        'value the fold reads lives on that row (M01 section 2.4), so there is no plan without it',
    );
  if (sizes.length > 1)
    throw new BatchRowError(
      `plan_version_sizes holds ${String(sizes.length)} rows for plan version ${planVersionId} ` +
        `at ${sizeCents.toString(10)} cents, which plan_version_sizes_version_size_uq (0004:220) ` +
        'makes unwritable. Choosing one would fold against a grid nobody published',
    );

  return resolvePlan(rules, size);
}

/**
 * The state carried INTO this day: the account's latest stored row strictly
 * before it, or `null` on the account's first day.
 *
 * **STRICTLY BEFORE, AND THE STRICTNESS IS `INV-14`.** `DO-1` refuses a mark
 * that is "not strictly after the prior state's day", so a row already stored
 * FOR this day is not a prior: taking it would fold the day against itself and
 * the insert would then meet `rule_states_account_day_uq`, which
 * `state-writer.ts` reads as `RuleStateAlreadyWritten`. That is the correct
 * report for a re-run, and it stays correct only because this read excludes the
 * day.
 *
 * THE LATEST RATHER THAN THE IMMEDIATELY PRECEDING SESSION, because an account
 * that did not trade on a session has no row for it and `R-33`'s counts are
 * phase scoped rather than gap scoped. The comparison is on the `date` string,
 * which is ISO 8601 and therefore orders lexicographically as it orders
 * chronologically.
 */
async function priorState(
  tx: BatchTx,
  accountId: string,
  tradingDay: TradingDay,
): Promise<AccountDay['prior']> {
  const rows = await tx.rowsWhere('ruleStates', { accountId });
  let latest: Record<string, unknown> | null = null;
  let latestDay = '';
  for (const value of rows) {
    const row = asRow(value, 'ruleStates');
    const day = text(row, 'tradingDay', 'ruleStates');
    if (day >= tradingDay) continue;
    if (latest === null || day > latestDay) {
      latest = row;
      latestDay = day;
    }
  }
  return latest === null ? null : toRuleState(latest, `rule_states[${accountId}:${latestDay}]`);
}

/**
 * What the five resolved to, carried into the refusal message.
 *
 * **A REFUSAL THAT NAMES ONLY THE MISSING FIELD IS INDISTINGUISHABLE FROM A
 * PORT THAT READ NOTHING**, and this port's whole claim is that it read
 * everything else. So the message carries the evidence: an operator meeting this
 * throw can see that the plan resolved, that the prior decoded, and that the
 * only thing between this batch and a `rule_states` row is `R-38`'s grain.
 */
function witness(day: AccountDayInputs): string {
  const prior = day.prior === null ? 'null (the account`s first day)' : day.prior.tradingDay;
  return (
    `The other five resolved for account ${day.accountId} on ${day.mark.tradingDay}: plan ` +
    `${day.plan.planVersionId} at ${day.plan.sizeCents.toString(10)} cents, prior ${prior}, a ` +
    `live mark, ${String(day.settlements.length)} settlement(s) effective on the day, and ` +
    `opened_on ${day.openedOn}`
  );
}
