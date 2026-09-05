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
// EIGHT OF TEN ARE WHOLE AND TWO REFUSE BY NAME
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
// | `loadAccountDay`         | SERVED. SIX FIELDS OF SIX, `ADR-260`             |
// | `accountDaysFrom`        | SERVED. THE WALK, `ADR-346`. See below           |
// | `storedRuleStates`       | SERVED. the `RuleStateRow` reader, `ADR-346`     |
// | `writeRuleState`         | COMPOSED AND WHOLE, `ADR-250`. See below          |
// | `raiseReconciliation`    | REFUSES. no event writer in this deployable      |
// | `raiseDivergence`        | REFUSES. THREE BLOCKERS, `ADR-346`. See below    |
//
// **THE TWO ROWS THAT MOVED ARE THE REPLAY SELF-AUDIT'S TWO READS, AND MOVING
// THEM IS THE WHOLE OF WHAT `ADR-346` CHANGES ABOUT WHAT THIS DEPLOYABLE CAN
// DO.** `runReplayAudit` calls exactly `calendarWatermark`, `calendarSlice`,
// `accountsWithStoredState`, `storedRuleStates`, `accountDaysFrom` and, ON A
// FINDING ONLY, `raiseDivergence`. Five of those six now answer, so `INV-04`'s
// comparison runs against a real database and a book that agrees returns a
// report. A book that DISAGREES reaches the sixth and this deployment throws
// there, which is stated in the divergence section below rather than left for a
// reader to discover in an incident.
//
// **AND THE AUDIT WRITES NO `rule_states` ROW, WHICH IS STRUCTURAL RATHER THAN
// DISCIPLINED.** `M01` `B.4` steps 2 through 4 put every rewrite of stored state
// behind a dry run, a founder approval recorded as an `admin_actions` row
// carrying the report's digest, and a separate audited rewrite job.
// `runReplayAudit` names no write port but `raiseDivergence`, so there is no
// argument position through which this adapter's `writeRuleState` could reach
// the audit at all.
//
// **THE `loadAccountDay` ROW HAS READ "REFUSES" AND THEN "FIVE OF SIX", AND IT
// NOW READS SERVED.** It said six fields refused and `prior` needed a codec;
// `ADR-250` landed the codec and `ADR-258` resolved five. The sixth was
// `external`, which `ADR-248` ruled NOT CONSTRUCTIBLE because `hasPayoutInFlight`
// was a predicate `M01` stated at two grains. **`ADR-254` RULED THAT GRAIN
// ACCOUNT AND AMENDED `M01`**, so the field stopped waiting on a decision and
// started waiting on a resolver, and `ADR-260` wrote it. The constant that
// carried this port's blocker is DELETED rather than reworded, because there is
// no blocker to name; its identifier is not written out here, on the rule
// `wiring.test.ts` states for retired reasons -- a name reproduced beside a
// claim that it is gone reads as live to every grep and to every predicate
// asserting its absence.
//
// **THE CONSEQUENCE IS LOUD AND IS STATED HERE RATHER THAN DISCOVERED IN A
// REPORT: THE NIGHTLY FOLD NOW COMPLETES ON THIS DEPLOYABLE.** `runNightlyBatch`
// calls exactly `calendarWatermark`, `calendarSlice`, `accountsWithLiveMark`,
// `loadAccountDay` and `writeRuleState`, and every one of the five now answers.
// So the sixth field resolving is not a comment change: it is the batch writing
// `rule_states` rows where it stopped at the first account before.
//
// **THE SENTENCE THAT STOOD HERE SAID "`accountDaysFrom` AND `storedRuleStates`
// STILL REFUSE AND NEITHER IS ON THAT PATH; THEY ARE THE REPLAY AUDIT'S, WHICH
// IS UNSCHEDULED", AND `ADR-346` MADE THE FIRST HALF FALSE.** It is kept beside
// its correction rather than deleted, per `RI-14`. The second half is still
// true and is now the ONLY thing keeping the audit off a clock: neither read is
// on `runNightlyBatch`'s path, so nothing above changed when they landed, and
// `apps/worker/src/schedule.ts` still carries `runReplayAudit` as `unscheduled`
// because a divergence has nowhere to go. Scheduling it is not this row's and
// the divergence section below says what it is waiting on.
//
// **AND THE RESOLVER REFUSES PER ACCOUNT RATHER THAN NEVER.** `resolveExternalGates`
// throws an `ExternalGatesRefusal` naming the leg, and the loudest case is the
// one `ADR-260` was sent at: an account whose `accounts.status` is
// `provisioning_pending`, which `account_status` declares and `AccountStatus`
// does not. That stops the batch, which is correct, because a daily mark
// arriving for an account still being provisioned is an anomaly and not a day to
// fold. `nightly.ts` does not catch, `main` does not catch, and the process
// leaves a non-zero status.
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

import type {
  BreachKind,
  CalendarSlice,
  ExternalGates,
  KycChainRow,
  Phase,
  TradingDay,
} from '@merit/rules-engine';
import {
  buildCalendarSlice,
  decodeCapScheduleCents,
  decodeEngineGates,
  encodeEngineGates,
  resolveExternalGates,
  resolvePlan,
} from '@merit/rules-engine';

import type { WorkerDb } from '../db.ts';
import type {
  AccountDay,
  BatchPorts,
  BatchReadPort,
  BatchWritePort,
  RuleStateRow,
  StoredContextGates,
} from './ports.ts';
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

// THE TWO CONSTANTS THAT CARRIED THE REPLAY AUDIT'S READ BLOCKERS ARE DELETED
// RATHER THAN REWORDED, on the rule `wiring.test.ts` states for retired reasons
// and this file already spent once on `loadAccountDay`: a name reproduced beside
// a claim that it is gone reads as live to every grep and to every predicate
// asserting its absence. What each SAID is recorded in `ADR-346` section 2 and
// is not written out here. One of the two was discharged by writing the walk it
// named; the other narrowed to nothing once `toRuleState` was read honestly,
// because a `RuleStateRow` is that reader's twenty-two fields plus four, and
// the four are the account id, the stored context gates, the hash bytes and the
// calendar stamp.

/** The blocker both event channels share. */
const EVENT_SINK_BLOCKER =
  'both findings are EVENTS and this deployable has no writer for one. `TRANSACTION_EVENT_WRITER` ' +
  'in `apps/api/src/events.ts` is the only composed writer in this tree, `apps/worker` declares ' +
  '`@merit/db` and `@merit/rules-engine` and nothing else, and under `node-linker=isolated` an ' +
  'undeclared import does not resolve at all. `EVENTS.md:194` names ' +
  '`replay.divergence_detected` one of the two events that must never be quiet, so a channel ' +
  'that swallowed a finding here would be the quiet this deployable exists to end';

/**
 * `raiseDivergence`'s blocker, WHICH IS THREE AND NOT ONE. `ADR-346`.
 *
 * **IT SHARED `EVENT_SINK_BLOCKER` WITH `raiseReconciliation` AND IT IS SPLIT
 * OFF FOR `ADR-258`'s REASON ONE PORT UP**: a shared constant reads as one
 * blocker, and discharging the sink would leave this port refusing for two
 * reasons the sink's sentence never mentioned. Reconciliation's refusal really
 * is the sink alone and keeps the shared one.
 *
 * THE THREE ARE ORDERED CHEAPEST FIRST AND THE THIRD IS THE RULING.
 *
 *   1. THE SINK, which is the shared blocker above and is re-derived rather
 *      than inherited: `EVENT_CATALOGUE` in `apps/api/src/events.ts` carries ten
 *      names and not one of them begins `replay.`, so `buildEvent` would refuse
 *      this name on `ADR-159` clause 1 even if the fence between the two
 *      deployables did not exist. `event-sink.test.ts` holds the fence.
 *   2. THE MODE IS NOT ON THE FINDING. `ReplayDivergenceFinding` carries an
 *      account, a day, an engine version and the fields that moved, and NOT
 *      `ReplayAuditConfig.mode`, so an adapter cannot tell `B.4` step 1's
 *      nightly detection from `B.4` step 2's dry run. Step 2 says "writing
 *      nothing" and step 4 says its findings are "an audit trail rather than as
 *      alerts", so a halt written on every finding would halt THE WHOLE BOOK on
 *      the first engine upgrade, which is `B.4`'s own opening sentence about
 *      burying the one real divergence.
 *   3. `B.1`'s HALT HAS NO COLUMN AND THE CORPUS IS SILENT ON WHICH. "Any
 *      difference halts payout eligibility for that account and pages" is the
 *      commitment; the two flags that carry such a halt are already spoken for.
 *      `accounts.recon_blocked` is RECONCILIATION's, which `0064` states in
 *      terms, and `ports.ts` keeps the two channels apart by name because
 *      collapsing them "would make a replay divergence indistinguishable from a
 *      vendor arithmetic failure on the page". `accounts.payouts_frozen` is an
 *      INVESTIGATION's, and `STATE_MACHINES` section 6 requires a written reason
 *      and a ToS clause on the transition that sets it, neither of which a job
 *      has. `ADR-346` records the open question rather than choosing, because a
 *      halt written into the wrong channel is a halt whose reason nobody can
 *      read and whose release nobody owns.
 */
const REPLAY_DIVERGENCE_BLOCKER =
  'THE FINDING HAS THREE BLOCKERS AND ONLY THE FIRST IS THE EVENT SINK (ADR-346). (1) THE ' +
  'SINK: `EVENT_CATALOGUE` in `apps/api/src/events.ts` carries ten names and none of them ' +
  'begins `replay.`, so the only composed writer in this tree would refuse this name on ' +
  'ADR-159 clause 1 before the fence between the deployables was even reached. (2) THE MODE ' +
  'IS NOT ON THE FINDING: `ReplayDivergenceFinding` carries no `ReplayMode`, so this adapter ' +
  "cannot tell B.4 step 1's nightly detection from B.4 step 2's dry run, which is the run " +
  'that writes NOTHING, and a halt on every finding would halt the whole book on the first ' +
  "engine upgrade. (3) B.1's HALT HAS NO COLUMN: `accounts.recon_blocked` is " +
  "reconciliation's channel (0064) and `ports.ts` keeps the two apart by name, and " +
  "`accounts.payouts_frozen` is an investigation's and requires a written reason and a ToS " +
  'clause no job can supply. ADR-346 records that as an OPEN QUESTION rather than choosing ' +
  'one. A divergence therefore STOPS THIS RUN with a non-zero exit (ADR-241) rather than ' +
  'halting the account, and that is a refusal and not the control B.1 specifies';

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

// -----------------------------------------------------------------------------
// Coverage, which is a SECOND table and is the thing that makes UNKNOWN an answer
// -----------------------------------------------------------------------------
// `ADR-042` F-4: a day outside every `trading_calendar_loads` interval is
// UNKNOWN, and unknown is not a holiday. `0032`'s own header calls confusing the
// two "the single most silent failure available to this table", and
// `packages/db/src/scope.ts`'s registration of `tradingCalendar` states the
// consequence for every reader in one sentence: "A READER MUST THEREFORE CONSULT
// BOTH TABLES".
//
// THIS ADAPTER DID NOT, AND NEITHER DID ITS CALLER. That is `ADR-268` finding 2,
// `ADR-273` finding 1, and `ADR-277` is the repair.
//
// NO DOOR IS WIDENED TO READ IT. `SystemTx.rows` is declared over `TableKey`,
// which is every registered table, and `tradingCalendarLoads` is registered
// `firm` like its neighbour. So the read below is the accessor answering a
// question it already published; `CATALOG_TABLE_KEYS` is still five,
// `packages/db/src/scoped-db.ts` is read and not written, and nothing in this
// diff names a key set.

/** One `trading_calendar_loads` row, as the INCLUSIVE bounds it declares. */
interface CoverageInterval {
  readonly from: string;
  readonly to: string;
}

function toCoverageInterval(value: unknown): CoverageInterval {
  const row = asRow(value, 'tradingCalendarLoads');
  return {
    from: text(row, 'coverageStartDay', 'tradingCalendarLoads'),
    to: text(row, 'coverageEndDay', 'tradingCalendarLoads'),
  };
}

async function readCoverageIntervals(tx: BatchTx): Promise<readonly CoverageInterval[]> {
  return (await tx.rows('tradingCalendarLoads')).map(toCoverageInterval);
}

/**
 * Whether ONE interval spans `from` through `to`, both inclusive.
 *
 * **ONE, AND THE UNION OF SEVERAL IS DELIBERATELY NOT ACCEPTED.** Two adjacent
 * loads are not one interval and merging them would require deciding that one
 * day is the successor of another, which is the date arithmetic `R-02` forbids.
 * `packages/db/src/scoped-db.ts` states the same refusal on the door where money
 * leaves the firm and states its remedy: "a load that means to extend coverage
 * overlaps its predecessor by a day, which is a fact its own row states". This
 * fold is that door's rule transcribed, so the batch and the payout endpoint
 * agree about which estates they will answer on.
 *
 * THE COMPARISON IS STRING ORDERING ON `YYYY-MM-DD`, WHICH IS CHRONOLOGICAL
 * BECAUSE THE SHAPE IS FIXED-WIDTH AND ZERO-PADDED. That is this file's existing
 * idiom for the same domain (`latestClosedSession`'s own maximum), and it
 * is the reason no `Date` is constructed here: a day parsed into an instant and
 * compared is the crossing `ADR-146` clause 4 forbids.
 */
function spannedByOneLoad(
  intervals: readonly CoverageInterval[],
  from: string,
  to: string,
): boolean {
  return intervals.some((interval) => interval.from <= from && interval.to >= to);
}

// -----------------------------------------------------------------------------
// The day this run closes, as a value from which the day is UNREACHABLE without
// looking at the verdict
// -----------------------------------------------------------------------------

/**
 * Which day the batch may fold, or why it may not fold one.
 *
 * **`tradingDay` IS ON THE `anchored` ARM ALONE AND THAT IS THE WHOLE CONTROL.**
 * `ADR-273` ruling 1: a fold may leave the coverage read to its caller only when
 * the caller is handed a value from which the day is unreachable without
 * discriminating on a coverage verdict. This deployable had no such value, which
 * is why its caller could forget and did. A consumer that reads `.tradingDay`
 * without narrowing on `kind` now does not compile, and that is a fence rather
 * than a memory.
 *
 * **THE REFUSED ARM CARRIES NO DAY, NOT EVEN AS DIAGNOSTICS.** `apps/api`'s
 * `CalendarAnchor` puts the coverage-blind answer inside its `uncovered` arm as
 * `anchor_day`, which is correct THERE because that value crosses an HTTP
 * boundary as an operator's diagnostic and never re-enters a fold. Here the one
 * consumer is the job that writes `rule_states`, and a field holding exactly the
 * wrong answer beside a refusal is a field somebody reaches for when the refusal
 * is inconvenient. The sentence in `why` names the day; nothing hands it back as
 * a `TradingDay`.
 */
export type TradingDayAnchor =
  | { readonly kind: 'anchored'; readonly tradingDay: TradingDay }
  | { readonly kind: 'refused'; readonly why: string };

/**
 * The latest trading day whose session has already closed at `at`, or `null`.
 *
 * **PRIVATE, AND ITS PRIVACY IS THE OTHER HALF OF THE REPAIR.** It was
 * `readLastClosedTradingDay`, exported from this file and re-exported from the
 * barrel, so its callers were unbounded by construction and every one of them
 * received a bare `TradingDay | null` in which `null` means "no session has
 * closed" and never "outside coverage". `ADR-273` section 10 named that exact
 * shape as the one a census cannot see. There is now no way to reach it from
 * outside this module, so there is no second caller to remember anything.
 *
 * **THE DAY IS READ FROM THE CALENDAR AND IS NEVER DERIVED FROM A CLOCK.**
 * `ADR-146` clause 4 forbids a UTC calendar date derived from an instant meeting
 * an exchange CT trading day, and this fold never crosses the two: an instant is
 * compared only with an instant (`session_close_at <= at`), and the trading day
 * is READ off the row that comparison selected.
 */
function latestClosedSession(rows: readonly CalendarRow[], at: Date): string | null {
  let latest: string | null = null;
  for (const row of rows) {
    if (row.isHoliday) continue;
    const close = row.sessionCloseAt;
    if (close === null) continue;
    if (close.getTime() > at.getTime()) continue;
    if (latest === null || row.tradingDay > latest) latest = row.tradingDay;
  }
  return latest;
}

/**
 * The earliest trading day whose session has NOT yet closed at `at`, or `null`.
 *
 * **THIS IS THE FACT THAT MAKES THE FIRST ONE THE *LAST CLOSED* DAY RATHER THAN
 * THE LAST DAY MERIT KNOWS ABOUT**, and it is an instant against an instant, so
 * it establishes that `at` falls inside a window the calendar carries without
 * any deployment ever computing a date.
 */
function earliestSessionAhead(rows: readonly CalendarRow[], at: Date): string | null {
  let earliest: string | null = null;
  for (const row of rows) {
    if (row.isHoliday) continue;
    const close = row.sessionCloseAt;
    if (close === null) continue;
    if (close.getTime() <= at.getTime()) continue;
    if (earliest === null || row.tradingDay < earliest) earliest = row.tradingDay;
  }
  return earliest;
}

/**
 * Both tables, read inside ONE transaction.
 *
 * **ONE, AND THE CROSSING IS REFUSED FOR `scoped-db.ts`'s OWN REASON RATHER THAN
 * FOR TIDINESS.** `WorkerDb.batch` opens a transaction per call, so two calls are
 * two snapshots; and `trading_calendar` is the one table in this estate the
 * corpus built a CORRECTION mechanism for, so a row can legitimately move between
 * them. A basis day chosen from a calendar the transaction that checked coverage
 * never read is exactly the verdict that door refuses to produce, and this job
 * writes its answer into `rule_states` where it is the payout basis.
 */
async function readCalendarAndCoverage(
  db: WorkerDb,
): Promise<{ calendar: readonly CalendarRow[]; coverage: readonly CoverageInterval[] }> {
  return db.batch(async (tx) => {
    const calendar = await readCalendarRows(tx);
    const coverage = await readCoverageIntervals(tx);
    return { calendar, coverage };
  });
}

/**
 * The last closed trading day at `at`, PROVED COVERED, or a refusal.
 *
 * **THREE FACTS AND NO FOURTH OUTCOME, WHICH IS `lastClosedTradingDayStatement`'s
 * RULE TRANSCRIBED RATHER THAN INVENTED.** `ADR-268` built that door on the
 * payout path and this fold is the same predicate in another deployable; before
 * this entry the two disagreed, and a batch that folded an estate the payout
 * endpoint refuses to answer on is the disagreement written into money rows.
 *
 *   1. **A SESSION HAS CLOSED.** On a database nobody has loaded the exchange
 *      calendar into this is every day, and it is a refusal rather than a guess
 *      (`ADR-241` section 5).
 *   2. **A SESSION AHEAD OF `at` EXISTS.** Without it the calendar is EXHAUSTED
 *      and the day fact 1 found is the last day Merit knows about rather than
 *      the last closed one. This is `ADR-273` finding 1's stated harm: a calendar
 *      loaded through June and a job run in August folds June's day and stamps
 *      `rule_states` with it, exiting 0.
 *   3. **ONE LOAD SPANS BOTH DAYS**, so nothing between them is unknown and no
 *      session can have closed inside a gap.
 */
export async function anchorLastClosedDay(db: WorkerDb, at: Date): Promise<TradingDayAnchor> {
  const { calendar, coverage } = await readCalendarAndCoverage(db);

  const closed = latestClosedSession(calendar, at);
  if (closed === null) {
    return {
      kind: 'refused',
      why:
        '`trading_calendar` carries no session that has already closed, so there is no day to ' +
        'close. On a database nobody has loaded the exchange calendar into this is every day, ' +
        'and an empty calendar is not an unbroken holiday (ADR-042 F-4)',
    };
  }

  const ahead = earliestSessionAhead(calendar, at);
  if (ahead === null) {
    return {
      kind: 'refused',
      why:
        `the latest closed session is ${closed} and \`trading_calendar\` carries no session that ` +
        'has NOT yet closed, so the calendar is EXHAUSTED and every day after that one is ' +
        'outside coverage. That makes it the last day Merit knows about rather than the last ' +
        'closed day R-06 permits, and folding it would stamp `rule_states` with a confident ' +
        'basis for a night nobody loaded. Load the exchange calendar forward',
    };
  }

  if (!spannedByOneLoad(coverage, closed, ahead)) {
    return {
      kind: 'refused',
      why:
        `no \`trading_calendar_loads\` row covers ${closed} through ${ahead} in ONE interval, so ` +
        'the days between them are not known to be loaded and a session may have closed inside ' +
        'the gap. Adjacent loads are deliberately not merged, because merging them on a date ' +
        'successor is the date arithmetic R-02 forbids; a load that means to extend coverage ' +
        'overlaps its predecessor by a day',
    };
  }

  return { kind: 'anchored', tradingDay: closed as TradingDay };
}

/**
 * A day an operator named, PROVED CARRIED AND PROVED COVERED, or a refusal.
 *
 * **THIS REPLACES `calendarCarriesDay`, WHOSE REFUSAL SAID "outside coverage"
 * AND WHOSE QUERY ASKED `trading_calendar` FOR A ROW.** A `trading_calendar` row
 * states that Merit knows what this day IS, a session or a holiday. It states
 * nothing about whether anybody LOADED it, and the two are separate facts in
 * separate tables with no constraint tying them: `0032` declares no foreign key
 * between them, and `0048` header item 7 rules explicitly that CALENDAR-C3's
 * retroactivity test is the FOLD EXTENT and not the coverage window, so a
 * calendar row may be inserted for a day no load ever declared. A check that
 * asks the wrong table and reports the right-sounding reason is worse than no
 * check, because it makes a reader stop looking.
 *
 * **BOTH FACTS ARE REQUIRED AND NEITHER IMPLIES THE OTHER.** A covered day with
 * no row is a bug in the load, which `0032` says in its own DDL comment, and it
 * refuses here. A carried day outside every load is the wrong-answer path this
 * entry exists to close.
 *
 * **THE "CAN THE CALENDAR SEE PAST IT" FACT IS DELIBERATELY NOT ASKED HERE.**
 * `RB-01` re-runs a night that failed, so the day is named precisely because it
 * is behind; demanding a session ahead of `now()` would refuse the one thing the
 * override exists for. What `R-06` needs of a NAMED day is that it is real and
 * that it was loaded, and that is what this asks.
 */
export async function anchorNamedDay(db: WorkerDb, day: TradingDay): Promise<TradingDayAnchor> {
  const { calendar, coverage } = await readCalendarAndCoverage(db);

  if (!calendar.some((row) => row.tradingDay === day)) {
    return {
      kind: 'refused',
      why:
        `\`trading_calendar\` has no row for ${day}, so this deployment cannot say whether that ` +
        'day is a session, a holiday, or a date the exchange never had',
    };
  }

  if (!spannedByOneLoad(coverage, day, day)) {
    return {
      kind: 'refused',
      why:
        `\`trading_calendar\` carries ${day} and no \`trading_calendar_loads\` interval covers ` +
        'it. A calendar row says what a day IS and a load row says that somebody loaded it, and ' +
        'a day outside every load is UNKNOWN rather than a holiday (ADR-042 F-4). Folding it ' +
        'would write a confident basis for a day the estate never loaded',
    };
  }

  return { kind: 'anchored', tradingDay: day };
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
     * One account's inputs for one day: `null` when it has no live mark, and all
     * SIX fields when it has.
     *
     * **THIS PORT REFUSED SIX FIELDS, THEN ONE, AND NOW REFUSES NONE.** The last
     * one was `external`, `ADR-248` ruled it not constructible on a contradiction
     * in a frozen plan, `ADR-254` ruled the contradiction, and `ADR-260` wrote
     * the resolver. There is no unwired arm left on this method.
     *
     * **IT CAN STILL THROW, AND THAT IS A PER-ACCOUNT FACT RATHER THAN A PORT
     * THAT IS NOT WIRED.** `resolveExternalGates` refuses a leg it cannot
     * derive -- an `accounts.status` the engine's union does not admit, a KYC
     * chain with no single head, a `payout_requests.status` outside the declared
     * vocabulary -- because `R-41` conjoins all five as VETOES and a fact
     * defaulted to the permissive value is a veto that never fires. The
     * `ExternalGatesRefusal` names the account and every failing leg, and it
     * stops the batch, which is what a fold refuses to do with an invented input.
     *
     * **THE `null` ARM IS A WHOLE ANSWER AND NOT A SMALLER REFUSAL.** `ports.ts`
     * declares it -- "or `null` if it has no live mark" -- and `nightly.ts`
     * counts it as `absent` rather than as a failure, so an account whose mark
     * was superseded between the partition read and this call is answered
     * correctly today. **AN ACCOUNT THE RESOLVER REFUSES IS NOT ANSWERED `null`**:
     * that arm means no mark, and reusing it for an unfoldable account would hide
     * a mark that arrived for an account still being provisioned behind a count
     * of accounts that had no data.
     */
    async loadAccountDay(accountId: string, tradingDay: TradingDay): Promise<AccountDay | null> {
      return await db.batch(async (tx) => resolveAccountDay(tx, accountId, tradingDay));
    },

    /**
     * One account's whole input history, oldest first. `INV-04`'s LEFT-HAND SIDE.
     *
     * **IT IS THE WALK AND NOT A LOOP OVER `loadAccountDay`, WHICH IS THE ONE
     * THING THE RETIRED BLOCKER GOT RIGHT.** Every fact that is the ACCOUNT's
     * rather than the DAY's is read once for the whole history: the account row,
     * the pinned plan and its size row, the identity, the KYC chain, the payout
     * requests and the stored states. A per-day loop over the one-day reader
     * would re-read all seven once per trading day, which on `B.5`'s own figure
     * of 250 days per account is 250 plan resolutions to fold one life.
     *
     * **`prior` IS RESOLVED AND IS STILL NOT READ BY THE AUDIT.** `ports.ts`
     * says so at the port and `replay.ts` says why: folding from a stored prior
     * would audit the value being audited. It is filled because the field is
     * required and because a value invented for it would be the one thing this
     * file never does, and it costs no read: the account's `rule_states` rows
     * are already in hand for the same reason.
     *
     * **`external` IS RESOLVED ONCE PER ACCOUNT AND CARRIES TODAY'S CONTEXT, NOT
     * THE DAY'S, AND THE AUDIT NEVER READS IT EITHER.** `INV-23` keeps the
     * context gates out of the replayed state and `ADR-026` `C-07` keeps them out
     * of the hash, so `replay.ts` builds no context side at all and compares
     * none. What that buys is a real cost and it is stated rather than hidden:
     * `resolveExternalGates` REFUSES a leg it cannot derive, and a refusal here
     * stops the audit for the whole book at that account, over a field the audit
     * does not consume. The narrower port that would remove the cost is
     * `ADR-346` section 5's named repair and it is a contract change rather than
     * an adapter change, so it is registered and not taken here.
     */
    async accountDaysFrom(accountId: string): Promise<readonly AccountDay[]> {
      return await db.batch(async (tx) => resolveAccountHistory(tx, accountId));
    },

    /**
     * One account's stored `rule_states` rows, oldest first. `INV-04`'s RIGHT.
     *
     * **THE HASH IS THE BYTES STORAGE RETURNED AND IS NEVER RECOMPUTED HERE.**
     * `ports.ts` and `replay.ts` both state the consequence of getting this
     * wrong and it is the whole book: `jsonb` does not preserve key order, so a
     * hash re-derived from what Postgres gives back is a different serializer
     * and would disagree with every hash the batch wrote. `bytesOf` below
     * returns the column and this method has no path to `stateHash()` at all.
     *
     * SORTED BY `trading_day`, because `ports.ts` says oldest first and
     * `auditAccount` reports its findings in the order this array arrived.
     */
    async storedRuleStates(accountId: string): Promise<readonly RuleStateRow[]> {
      const rows = await db.batch(async (tx) => tx.rowsWhere('ruleStates', { accountId }));
      return rows
        .map((value) => toRuleStateRow(value, accountId))
        .sort((a, b) => (a.tradingDay < b.tradingDay ? -1 : a.tradingDay > b.tradingDay ? 1 : 0));
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

    /**
     * `INV-04`'s finding, AND THE ONE PORT THE AUDIT STILL CANNOT REACH.
     *
     * The three blockers are on `REPLAY_DIVERGENCE_BLOCKER` and the third is a
     * ruling the corpus does not make. A throw here stops the run and leaves a
     * non-zero exit status (`ADR-241`), which is loud and is NOT `B.1`'s halt:
     * the diverged account stays payout eligible until somebody reads the exit
     * code. That is said out loud so this method is not read as a control it is
     * not.
     */
    raiseDivergence(): Promise<never> {
      return Promise.reject(new BatchPortUnwired('raiseDivergence', REPLAY_DIVERGENCE_BLOCKER));
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
// THE SIXTH FIELD IS RESOLVED HERE AND NARROWED SOMEWHERE ELSE, ON PURPOSE
// -----------------------------------------------------------------------------
// `ADR-248` ruling 3 read that this deployable might not construct an
// `ExternalGates` at all, on the ground that `hasPayoutInFlight` was a predicate
// `M01` stated at two grains. The retired sentence is PARAPHRASED rather than
// quoted, for the reason one section up. `ADR-254` RULED THE GRAIN ACCOUNT and amended `M01`, so
// what was left was a resolver rather than a ruling, and `ADR-260` is it.
//
// **THIS FILE READS THE ROWS AND `packages/rules-engine/src/external-gates.ts`
// READS THE VALUES, AND THE SPLIT IS THE WHOLE DESIGN.** `resolveExternalGates`
// takes the RAW column values and returns the record or refuses by leg; nothing
// below narrows `accounts.status`, decides what `provisioning_pending` means,
// picks the head of a KYC chain or classifies a payout status. Those are one
// predicate that TWO deployables need -- this one for `AccountDay.external` and
// `apps/api` for `PayoutSubject.gates` -- neither can import the other, and the
// engine declares no workspace dependency, so it is the only place both arrows
// already point. An answer written here and a second one there is `FM-16` by
// name, which is the defect `ADR-239` slice A moved the gates codec to close.
//
// **AND NOTHING HERE DEFAULTS.** `evaluatePayout` conjoins all five as VETOES
// (`R-41`), so a value invented for any of them is a gate that never fires on the
// path where money leaves the firm. A row this reader cannot read is a
// `BatchRowError` and a value the resolver cannot derive is an
// `ExternalGatesRefusal`. Neither is a `false`.
//
// **THE FOUR TABLES ARE ALL REACHABLE ON THIS DOOR AND THE READ IS FOUR MORE PER
// ACCOUNT-DAY.** `identities` at the account's `identity_id`, every
// `kyc_verifications` row of that identity, and every `payout_requests` row of
// this account, plus the `accounts` row this function already holds.
// `payout_requests` is read TWICE per account-day -- once here for the statuses
// and once in `settlementsOn` for the settled rows -- and that is stated rather
// than hidden: both reads are on ONE transaction and therefore on one snapshot,
// so they cannot disagree, and merging them would put a settlement filter and a
// gate filter in one loop where the next reader has to work out which is which.
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
    // **ADR-302's COLLAPSE, AND THIS SIDE OF IT IS BEHAVIOUR-PRESERVING.**
    // `toCapScheduleCents` stood here and stated, in this deployable's own
    // helpers, exactly what the engine's codec now states once for all three
    // readers of the column: a safe-integer JSON number or a base-10 string of
    // digits, and a number past `Number.MAX_SAFE_INTEGER` REFUSED rather than
    // rounded. What changes is the class of the refusal, which is
    // `CapScheduleCodecError` and no longer `BatchRowError`; `decodeEngineGates`
    // one field down has thrown `EngineGatesCodecError` through this same adapter
    // since ADR-250 and nothing here branches on either.
    payout_cap_schedule_cents: decodeCapScheduleCents(
      row['payoutCapScheduleCents'],
      `${at}.payoutCapScheduleCents`,
    ),
    daily_loss_limit_cents: bigintOrNull(row, 'dailyLossLimitCents', at),
    floor_lock_enabled: flag(row, 'floorLockEnabled', at),
    floor_lock_at_profit_cents: bigintOrNull(row, 'floorLockAtProfitCents', at),
    floor_lock_floor_at_cents: bigintOrNull(row, 'floorLockFloorAtCents', at),
  };
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
 * One `rule_states` row as a `RuleStateRow`: `toRuleState`'s twenty-two fields
 * PLUS FOUR, and the four are exactly the ones `ADR-250` section 7 priced.
 *
 * **THAT ENTRY'S ARITHMETIC IS WHAT MADE THIS SMALL, AND IT IS QUOTED RATHER
 * THAN SUMMARISED BECAUSE IT IS THE REASON THE PORT STOPPED REFUSING.** It said
 * a `RuleStateRow` is "twenty-odd columns read back and rebuilt: `contextGates`
 * has its own stored shape, `calendarRevisionId` crosses a `bigint` column into
 * a `number | null` field ... ONE `jsonb` LEAF DECODED IS NOT A ROW REBUILT."
 * Every clause of that is true and the list is COMPLETE: this file's own header
 * already enumerated the three fields a `RuleState` does not carry, and the
 * fourth is the account id, which the caller passes in. So the row is the prior
 * reader plus `accountId`, `contextGates`, `stateHash` and `calendarRevisionId`,
 * and it is composed rather than transcribed.
 *
 * **COMPOSED AND NOT TRANSCRIBED IS THE POINT AND NOT A STYLE.** The two readers
 * would otherwise be two expressions of one column list, which is `FM-16`, and
 * the direction it would fail in is the worst available: `priorState` feeds the
 * NIGHTLY FOLD and this feeds the AUDIT OF THAT FOLD, so a field read one way
 * here and another way there would make the audit agree with a batch that was
 * wrong, or diverge from one that was right, and in both cases the disagreement
 * would be between two copies of this file rather than between the engine and
 * storage.
 *
 * THE `accountId` IS THE CALLER'S AND THE COLUMN IS CHECKED AGAINST IT. The port
 * read by `account_id`, so a row that came back carrying a different one is a
 * predicate that did not hold, and an audit that renamed such a row into the
 * account it asked for would compare one trader's day against another's.
 */
function toRuleStateRow(value: unknown, accountId: string): RuleStateRow {
  const row = asRow(value, 'ruleStates');
  const tradingDay = text(row, 'tradingDay', 'ruleStates');
  const at = `rule_states[${accountId}:${tradingDay}]`;

  const stored = text(row, 'accountId', at);
  if (stored !== accountId)
    throw new BatchRowError(
      `${at} carries account_id ${stored}, and the read that returned it named ${accountId}. ` +
        'The row is refused rather than renamed: an audit that compared it would be comparing ' +
        "one trader's day against another's",
    );

  return {
    ...toRuleState(row, at),
    accountId,
    contextGates: toStoredContextGates(row['contextGates'], `${at}.context_gates`),
    stateHash: bytesOf(row, 'stateHash', at),
    calendarRevisionId: revisionOf(row, at),
  };
}

/**
 * `rule_states.context_gates`, `SD-06`'s never-replayed half, decoded.
 *
 * **IT IS READ AND IT IS NOT COMPARED, AND BOTH HALVES MATTER.** `INV-23` keeps
 * these five out of the replayed state and `ADR-026` `C-07` keeps them out of
 * the hash, so `HASHED_COLUMNS` never names this field and no divergence can be
 * attributed to it. It is on `RuleStateRow` because `0015` declares the column
 * `NOT NULL` and the write port has to carry it, and a reader that returned a
 * row without it would be a reader whose output the writer cannot round-trip.
 *
 * `pass` IS NOT DERIVED FROM ITS NEIGHBOUR ON ANY LEG. `0015`'s claim for the
 * column is that these "were true on the day and may not be true now", so the
 * stored `pass` is the verdict the batch recorded and re-deriving it from the
 * stored `status` would be this reader deciding, years later, what a status
 * meant. That is `external-gates.ts`'s question and this is not that file.
 */
function toStoredContextGates(value: unknown, at: string): StoredContextGates {
  const gates = jsonRecord(value, at);
  const leg = (key: string): Record<string, unknown> =>
    jsonRecord(jsonField(gates, key, at), `${at}.${key}`);

  const accountActive = leg('accountActive');
  const kycVerified = leg('kycVerified');
  const notFrozen = leg('notFrozen');
  const reconClear = leg('reconClear');
  const noPayoutInFlight = leg('noPayoutInFlight');

  return {
    accountActive: {
      pass: jsonFlag(jsonField(accountActive, 'pass', at), `${at}.accountActive.pass`),
      status: jsonText(jsonField(accountActive, 'status', at), `${at}.accountActive.status`),
    },
    kycVerified: {
      pass: jsonFlag(jsonField(kycVerified, 'pass', at), `${at}.kycVerified.pass`),
      state: jsonText(jsonField(kycVerified, 'state', at), `${at}.kycVerified.state`),
    },
    notFrozen: {
      pass: jsonFlag(jsonField(notFrozen, 'pass', at), `${at}.notFrozen.pass`),
      reason: jsonNullable(
        jsonField(notFrozen, 'reason', at),
        `${at}.notFrozen.reason`,
        (raw, where) => jsonText(raw, where),
      ),
    },
    reconClear: { pass: jsonFlag(jsonField(reconClear, 'pass', at), `${at}.reconClear.pass`) },
    noPayoutInFlight: {
      pass: jsonFlag(jsonField(noPayoutInFlight, 'pass', at), `${at}.noPayoutInFlight.pass`),
    },
  };
}

/**
 * `rule_states.state_hash`, AS THE BYTES STORAGE RETURNED.
 *
 * **THE ONE COLUMN IN THIS FILE THAT MUST NOT BE RE-DERIVED, AND THE REASON IS
 * THE WHOLE BOOK.** `ports.ts` states it at the field and `replay.ts` calls it
 * "the single most important sentence in the file": the hash was computed over
 * the engine's canonical serialization in its declared field order, `jsonb` does
 * not preserve key order, and a hash recomputed from what Postgres gives back is
 * a different serializer that "would disagree with every hash this batch wrote".
 * A re-hash here would diverge every row on the first run.
 *
 * THIRTY-TWO BYTES OR THE ROW IS REFUSED. `rule_states_hash_is_sha256` is that
 * length at the store (`0015`), so a shorter value is a row the database says
 * cannot exist, and comparing a truncated digest is how two different states
 * come to agree.
 */
function bytesOf(row: Record<string, unknown>, column: string, at: string): Buffer {
  const value = row[column];
  if (!Buffer.isBuffer(value))
    throw new BatchRowError(
      `${at}.${column} is not bytes on the row the accessor returned; it is ${typeof value}. ` +
        'The stored hash is COMPARED and never recomputed (ADR-026 C-07, B.2), so there is no ' +
        'second value this reader could fall back to',
    );
  if (value.length !== 32)
    throw new BatchRowError(
      `${at}.${column} is ${String(value.length)} byte(s) and rule_states_hash_is_sha256 (0015) ` +
        'makes it thirty-two. A truncated digest is how two different states come to agree',
    );
  return value;
}

/**
 * `rule_states.calendar_revision_id`, `ADR-047`'s stamp, as a `number | null`.
 *
 * `null` IS A FACT AND NOT AN ABSENCE OF ONE, which is `calendarWatermark`'s own
 * sentence read from the other side: a row stamped `null` was folded under a
 * calendar that had never been corrected, and `inScopeForDetection` compares it
 * against the watermark by equality, so reading it as anything else would put
 * every pre-correction row out of scope and trip `OI-14` over a whole book.
 *
 * THE SAFE-INTEGER GUARD IS `calendarWatermark`'s AND IT IS HERE FOR THE OTHER
 * DIRECTION. That one refuses to STAMP a revision past `Number.MAX_SAFE_INTEGER`
 * and this one refuses to READ one back, because a stamp rounded on the way in
 * would compare equal to a watermark rounded the same way and the scope check
 * would pass on two numbers that are both wrong.
 */
function revisionOf(row: Record<string, unknown>, at: string): number | null {
  const value = bigintOrNull(row, 'calendarRevisionId', at);
  if (value === null) return null;
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER))
    throw new BatchRowError(
      `${at}.calendarRevisionId is ${value.toString(10)}, which is past Number.MAX_SAFE_INTEGER ` +
        'and `RuleStateRow.calendarRevisionId` is a `number`. A stamp rounded here compares ' +
        'equal to a watermark rounded the same way, so B.4 step 1 would scope on two wrong ' +
        'numbers that agree',
    );
  return Number(value);
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
  const live = liveMarksByDay(
    await tx.rowsWhere('dailyMarks', { accountId, tradingDay }),
    accountId,
  );
  const row = live.get(tradingDay);
  return row === undefined ? null : renderMark(row);
}

/**
 * `0014`'s SUPERSESSION RULE, APPLIED ONCE FOR BOTH READERS.
 *
 * `liveMark` narrows to one day and the history walk takes every day, and the
 * rule they share is the whole of what makes a mark foldable: a correction is a
 * NEW row with the old one pointing at it, so a row carrying `superseded_by` is
 * never folded, and two LIVE rows on one day is refused rather than resolved.
 *
 * **ONE EXPRESSION RATHER THAN TWO, AND THE DIRECTION OF THE HAZARD IS WHY.**
 * The one-day reader feeds the NIGHTLY FOLD and the walk feeds THE AUDIT OF THAT
 * FOLD. A supersession rule written twice could drift, and the drift would show
 * up as a replay divergence on every corrected day: the audit would fold the
 * superseded mark, disagree with a batch that was right, and page. Two copies of
 * this predicate is the one defect that makes the self-audit lie in the
 * expensive direction.
 */
function liveMarksByDay(
  values: readonly unknown[],
  accountId: string,
): Map<string, Record<string, unknown>> {
  const byDay = new Map<string, Record<string, unknown>[]>();
  for (const value of values) {
    const row = asRow(value, 'dailyMarks');
    const superseded = row['supersededBy'];
    if (superseded !== null && superseded !== undefined) continue;
    const day = text(row, 'tradingDay', 'dailyMarks');
    const bucket = byDay.get(day);
    if (bucket === undefined) byDay.set(day, [row]);
    else bucket.push(row);
  }

  const live = new Map<string, Record<string, unknown>>();
  for (const [day, rows] of byDay) {
    const first = rows[0];
    if (first === undefined) continue;
    if (rows.length > 1)
      throw new BatchRowError(
        `daily_marks holds ${String(rows.length)} unsuperseded rows for account ${accountId} on ` +
          `${day}, and daily_marks_account_day_uq makes that unwritable. The fold refuses ` +
          'rather than choosing one, because either choice is a money row nobody can re-derive',
      );
    live.set(day, first);
  }
  return live;
}

/** One live `daily_marks` row as the engine's `DailyMark`. */
function renderMark(row: Record<string, unknown>): LiveMark {
  return {
    tradingDay: text(row, 'tradingDay', 'dailyMarks') as TradingDay,
    openingBalanceCents: bigintOf(row, 'openingBalanceCents', 'dailyMarks'),
    closingBalanceCents: bigintOf(row, 'closingBalanceCents', 'dailyMarks'),
    highBalanceCents: bigintOf(row, 'highBalanceCents', 'dailyMarks'),
    lowBalanceCents: bigintOf(row, 'lowBalanceCents', 'dailyMarks'),
    realizedPnlCents: bigintOf(row, 'realizedPnlCents', 'dailyMarks'),
    adjustmentCents: bigintOf(row, 'adjustmentCents', 'dailyMarks'),
    fillCount: count(row, 'fillCount', 'dailyMarks'),
    sourceHash: digest(row, 'sourceHash', 'dailyMarks'),
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
  const facts = settledFacts(await tx.rowsWhere('payoutRequests', { accountId }));
  return byOrdinal(facts.filter((fact) => fact.effectiveTradingDay === tradingDay));
}

/**
 * EVERY settled `payout_requests` row of one account, as facts, unbucketed.
 *
 * `settlementsOn` takes the ones landing on a day and the history walk buckets
 * all of them, and the STATUS TERM and the DAY COLUMN are read in one place for
 * the reason `liveMarksByDay` gives: swapping `settled_trading_day` for
 * `effective_trading_day` changes whose money moves, and a batch and the audit
 * of that batch reading the pair differently is a divergence neither side is
 * wrong about.
 */
function settledFacts(values: readonly unknown[]): readonly Settlement[] {
  const facts: Settlement[] = [];
  for (const value of values) {
    const row = asRow(value, 'payoutRequests');
    if (text(row, 'status', 'payoutRequests') !== 'settled') continue;
    const effective = textOrNull(row, 'effectiveTradingDay', 'payoutRequests');
    if (effective === null)
      throw new BatchRowError(
        `payout_requests[${text(row, 'id', 'payoutRequests')}] is settled and carries no ` +
          'effective_trading_day, which payout_requests_settled_has_trading_days makes ' +
          'unwritable (0010). SD-03 puts the fact on the day the balance moved, and a ' +
          'settlement with no such day is a fold nobody can place',
      );
    facts.push({
      payoutRequestId: text(row, 'id', 'payoutRequests'),
      ordinal: count(row, 'payoutOrdinal', 'payoutRequests'),
      approvedCents: bigintOf(row, 'approvedCents', 'payoutRequests'),
      basisTradingDay: text(row, 'basisTradingDay', 'payoutRequests') as TradingDay,
      effectiveTradingDay: effective as TradingDay,
    });
  }
  return facts;
}

/** `applySettlement` is idempotent per request, so the ORDER is the report's. */
function byOrdinal(facts: readonly Settlement[]): readonly Settlement[] {
  return [...facts].sort((a, b) => a.ordinal - b.ordinal);
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
): Promise<AccountDay | null> {
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
    // R-40 AND R-38's INPUTS, resolved LAST because they are the reads this
    // function grew and the four before them are the ones it was proved on.
    external: await externalGates(tx, account, accountId),
    // R-32's anchor, READ AND NEVER DERIVED (ADR-051). `accounts.opened_on` is
    // `date NOT NULL`, so an account row that exists carries one.
    openedOn: text(account, 'openedOn', 'accounts') as TradingDay,
  };
}

/**
 * ONE ACCOUNT'S WHOLE INPUT HISTORY, OLDEST FIRST. `INV-04`'s LEFT-HAND SIDE.
 *
 * **EIGHT READS FOR A WHOLE LIFE, AND THAT COUNT IS THE PORT'S REASON FOR
 * EXISTING RATHER THAN AN OPTIMISATION.** `resolveAccountDay` above answers ONE
 * day and takes six reads to do it, five of which answer questions about the
 * ACCOUNT and not about the day: the account row, the plan version, the size
 * grid, the identity, the KYC chain and the payout requests. Repeating it per
 * day over `B.5`'s figure of 250 trading days is 1,500 reads to fold one life
 * and 7.5 million to audit a 5,000 account book, which is the shape the retired
 * blocker on this port said it existed to replace rather than to wrap. Here each
 * of those is read ONCE and only `daily_marks` and `rule_states` are added.
 *
 * -----------------------------------------------------------------------------
 * WHAT THIS SHARES WITH THE ONE-DAY READER, AND WHY SHARING IT IS THE POINT
 * -----------------------------------------------------------------------------
 * `resolvePinnedPlan`, `externalGates`, `liveMarksByDay`, `renderMark`,
 * `settledFacts`, `priorFrom` and `toRuleState` are all the one-day reader's and
 * are CALLED rather than restated. `replay.ts`'s whole subject is that a second
 * expression of one fold can drift from the first; the same is true one layer
 * down of a second expression of one READ, and the drift would be worse here
 * because it would be invisible: the batch would fold one set of inputs, the
 * audit would fold a slightly different set, and the divergence would be
 * reported against the ENGINE, which was right both times.
 *
 * -----------------------------------------------------------------------------
 * THREE THINGS THIS DOES THAT A READER SHOULD NOT HAVE TO INFER
 * -----------------------------------------------------------------------------
 *   1. THE DAYS ARE THE LIVE MARKS AND NOTHING ELSE. A superseded mark is not a
 *      day (`0014`), and an account with no live mark has no history rather than
 *      an empty one. `replay` sorts what it is given anyway, and the array is
 *      sorted here too because `ports.ts` promises oldest first and a caller
 *      that read `days[0]` for an opening fact would otherwise read whichever
 *      row the accessor returned first.
 *   2. A SETTLED FACT WHOSE EFFECTIVE DAY CARRIES NO LIVE MARK IS ATTACHED TO NO
 *      DAY, AND THE FOLD IS IDENTICAL EITHER WAY. `replay` FLATTENS whatever
 *      buckets it is handed and re-buckets by `effectiveTradingDay`
 *      (`groupSettlementsByEffectiveDay`), then reads the bucket for each MARK,
 *      so a fact whose day has no mark is never read no matter which day it
 *      arrived attached to. That is also exactly what the nightly fold does with
 *      it, because that fold runs per live mark too. A settlement stranded that
 *      way is a finding for reconciliation and there is nothing here for the
 *      audit to repair.
 *   3. `prior` IS FILLED AND `external` IS FILLED AND THE AUDIT READS NEITHER.
 *      Both are on `AccountDay` because the type requires them, both are real
 *      values off real rows, and `accountDaysFrom`'s docstring at the port says
 *      what each costs.
 */
async function resolveAccountHistory(
  tx: BatchTx,
  accountId: string,
): Promise<readonly AccountDay[]> {
  const account = asRow(
    (await tx.rowAt('accounts', { id: accountId })) ?? missing('accounts', accountId),
    'accounts',
  );

  // THE ACCOUNT'S FACTS, READ ONCE FOR THE WHOLE LIFE. `INV-16` makes the plan
  // version an input pinned on the account and `ADR-051` makes `opened_on` an
  // account fact, so neither can differ between two days of one life -- which is
  // exactly what `lifeOf` in `replay.ts` asserts on the way back in.
  const plan = await resolvePinnedPlan(
    tx,
    text(account, 'planVersionId', 'accounts'),
    bigintOf(account, 'sizeCents', 'accounts'),
  );
  const openedOn = text(account, 'openedOn', 'accounts') as TradingDay;
  const external = await externalGates(tx, account, accountId);

  const live = liveMarksByDay(await tx.rowsWhere('dailyMarks', { accountId }), accountId);
  const states = (await tx.rowsWhere('ruleStates', { accountId })).map((value) =>
    asRow(value, 'ruleStates'),
  );

  const settlements = new Map<string, Settlement[]>();
  for (const fact of settledFacts(await tx.rowsWhere('payoutRequests', { accountId }))) {
    const bucket = settlements.get(fact.effectiveTradingDay);
    if (bucket === undefined) settlements.set(fact.effectiveTradingDay, [fact]);
    else bucket.push(fact);
  }

  const days: AccountDay[] = [];
  for (const day of [...live.keys()].sort()) {
    const row = live.get(day);
    if (row === undefined) continue;
    const tradingDay = day as TradingDay;
    days.push({
      accountId,
      plan,
      prior: priorFrom(states, accountId, tradingDay),
      mark: renderMark(row),
      settlements: byOrdinal(settlements.get(day) ?? []),
      external,
      openedOn,
    });
  }
  return days;
}

/**
 * The five context facts, read off four tables and narrowed by the engine.
 *
 * **EVERY VALUE HANDED OVER IS THE RAW COLUMN.** `accounts.status` goes across
 * as the `text` this reader found, not as an `AccountStatus`, because narrowing
 * it here would be the second place the seven-versus-six question is answered
 * and `external-gates.ts` exists to hold it in one. The same is true of
 * `kyc_verifications.state` and `payout_requests.status`.
 *
 * **THE IDENTITY ROW IS REQUIRED AND ITS ABSENCE IS `missing()` RATHER THAN A
 * FALSE.** `accounts.identity_id` is `uuid NOT NULL REFERENCES identities(id)`,
 * so an account whose owner cannot be read is a foreign key that did not hold,
 * and `identities.payouts_frozen` is a VETO: reading it as `false` because the
 * row was not there is the exact shape `R-41` makes expensive.
 *
 * **THE KYC READ IS THE WHOLE CHAIN AND NOT THE HEAD.** `SD-M19-01` makes a
 * re-verification a NEW ROW pointing at the one it supersedes, so the head is a
 * property of the SET and cannot be addressed. `scope.ts` puts `supersedes`
 * inside the identity, so the chain never leaves it.
 *
 * **THE PAYOUT READ IS EVERY ROW OF THIS ACCOUNT AND THE STATUS FILTER IS THE
 * ENGINE'S.** A filter here would be a sixth copy of
 * `payout_requests_no_in_flight_uq`'s predicate with nothing comparing it, which
 * is what `ADR-254` finding 4 asked the resolver not to be.
 */
async function externalGates(
  tx: BatchTx,
  account: Record<string, unknown>,
  accountId: string,
): Promise<ExternalGates> {
  const identityId = text(account, 'identityId', 'accounts');
  const identity = asRow(
    (await tx.rowAt('identities', { id: identityId })) ?? missing('identities', identityId),
    'identities',
  );

  const kycChain: KycChainRow[] = (await tx.rowsWhere('kycVerifications', { identityId })).map(
    (value) => {
      const row = asRow(value, 'kycVerifications');
      return {
        id: text(row, 'id', 'kycVerifications'),
        state: text(row, 'state', 'kycVerifications'),
        supersedes: textOrNull(row, 'supersedes', 'kycVerifications'),
      };
    },
  );

  const payoutRequestStatuses = (await tx.rowsWhere('payoutRequests', { accountId })).map((value) =>
    text(asRow(value, 'payoutRequests'), 'status', 'payoutRequests'),
  );

  return resolveExternalGates({
    accountId,
    accountStatus: text(account, 'status', 'accounts'),
    identityPayoutsFrozen: flag(identity, 'payoutsFrozen', 'identities'),
    accountPayoutsFrozen: flag(account, 'payoutsFrozen', 'accounts'),
    reconBlocked: flag(account, 'reconBlocked', 'accounts'),
    kycChain,
    payoutRequestStatuses,
  });
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
  const rows = (await tx.rowsWhere('ruleStates', { accountId })).map((value) =>
    asRow(value, 'ruleStates'),
  );
  return priorFrom(rows, accountId, tradingDay);
}

/**
 * The same walk over rows ALREADY IN HAND, which is what the history reader has.
 *
 * `priorState` reads and this decides, and the split is the only thing that
 * makes the history walk a walk: it resolves a prior for every day of a life off
 * ONE read of `rule_states` rather than one read per day.
 */
function priorFrom(
  rows: readonly Record<string, unknown>[],
  accountId: string,
  tradingDay: TradingDay,
): AccountDay['prior'] {
  let latest: Record<string, unknown> | null = null;
  let latestDay = '';
  for (const row of rows) {
    const day = text(row, 'tradingDay', 'ruleStates');
    if (day >= tradingDay) continue;
    if (latest === null || day > latestDay) {
      latest = row;
      latestDay = day;
    }
  }
  return latest === null ? null : toRuleState(latest, `rule_states[${accountId}:${latestDay}]`);
}

// `witness()` LIVED HERE AND IS DELETED WITH THE REFUSAL IT SERVED. `ADR-258`
// built it so that `loadAccountDay`'s throw carried evidence of the five fields
// that HAD resolved, on the ground that "a refusal that names only the missing
// field is indistinguishable from a port that read nothing". There is no refusal
// on this port any more, so keeping the function would be keeping a message for
// a throw nothing reaches. What replaces it is narrower and is the engine's:
// `ExternalGatesRefusal` names the account and every leg it could not derive,
// which is the same property applied to the failure that DOES remain.
