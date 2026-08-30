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
// FOUR OF TEN ARE SERVED AND SIX REFUSE BY NAME, WHICH IS THE HOUSE SHAPE
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
// | `loadAccountDay`         | REFUSES. six fields, and `prior` needs the codec |
// | `accountDaysFrom`        | REFUSES. `loadAccountDay`'s blocker, per account |
// | `storedRuleStates`       | REFUSES. no `RuleStateRow` READER, ADR-239 B     |
// | `writeRuleState`         | COMPOSED AND WHOLE, `ADR-250`. See below          |
// | `raiseReconciliation`    | REFUSES. no event writer in this deployable      |
// | `raiseDivergence`        | REFUSES. no event writer in this deployable      |
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

import type { CalendarSlice, TradingDay } from '@merit/rules-engine';
import { buildCalendarSlice, encodeEngineGates } from '@merit/rules-engine';

import type { WorkerDb } from '../db.ts';
import type { BatchPorts, BatchReadPort, BatchWritePort } from './ports.ts';
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

/** The blocker `loadAccountDay` and `accountDaysFrom` share. `ADR-239` slice B. */
const ACCOUNT_DAY_BLOCKER =
  'an `AccountDay` carries six fields beyond the account id (`plan`, `prior`, `mark`, ' +
  '`settlements`, `openedOn`, `external`) and this adapter resolves none of them. `plan` is ' +
  '`resolvePlan(rules, size)` over the account`s PINNED `plan_versions.rules` and its ' +
  '`plan_version_sizes` row; `prior` is a stored `rule_states` row read back as a `RuleState`, ' +
  'which needs the `engine_gates` DECODER that ADR-239 slice A sizes and homes in ' +
  '`packages/rules-engine`; `external` is R-40`s five context facts across KYC, freezes, ' +
  'reconciliation and in-flight payouts. Each is a reading of a table this port would otherwise ' +
  'guess at, and ADR-241 section 6 sizes them as the next slice';

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

    loadAccountDay(): Promise<never> {
      return Promise.reject(new BatchPortUnwired('loadAccountDay', ACCOUNT_DAY_BLOCKER));
    },

    accountDaysFrom(): Promise<never> {
      return Promise.reject(new BatchPortUnwired('accountDaysFrom', ACCOUNT_DAY_BLOCKER));
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
