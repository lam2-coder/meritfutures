// =============================================================================
// packages/db/test/last-closed-trading-day-door.test.ts -- CI-02, `unit`.
// =============================================================================
// THE VALIDATING HALF OF ADR-268. `R-06` permits a payout evaluation against ONE
// day, the LAST CLOSED one, so `PayoutTx.subject()` has to select the stored
// `rule_states` row BY DAY. `ADR-264` section 5 found that the day was
// unreadable exactly where the state is read: `tradingCalendar` is scope class
// `firm` and `CATALOG_TABLE_KEYS` is a closed list of five that does not carry
// it. It named two remedies, a two-transaction crossing or a sixth catalogued
// key, and took neither. ADR-268 takes a third and this file is its assertions.
//
// -----------------------------------------------------------------------------
// THE PROPERTY, EXACTLY
// -----------------------------------------------------------------------------
// "A caller receives ONE trading day that the calendar can still see past, or
// nothing at all." Three halves, and each is a way the obvious door is wrong:
//
//   1. THE FOLD HAPPENS INSIDE THE DOOR. A catalogue admission would hand the
//      caller every calendar row and let it pick the maximum itself. That fold
//      is stated TWICE in this tree already (`readLastClosedTradingDay` in
//      `apps/worker/src/batch/adapter.ts` and `lastClosedDay` in
//      `apps/api/src/admin-source/liability.ts`) and the two disagree about
//      whether coverage is consulted. A third statement of it would be the
//      first on the money path.
//   2. AN EXHAUSTED CALENDAR IS A REFUSAL AND NOT AN ANSWER. `ADR-042` F-4 and
//      `0032`'s header item 5: an uncovered day is UNKNOWN and unknown is not a
//      holiday. The maximum closed row of a calendar that stops there is not
//      known to be the LAST closed day, and `R-06` asks for the last one.
//   3. NO INSTANT EVER BECOMES A DAY. `ADR-146` clause 4 forbids a UTC calendar
//      date derived from a timestamp meeting an exchange CT trading day. The
//      door compares an instant only with an instant (`session_close_at`
//      against `now()`) and a day only with a day, and the day it returns is
//      READ off the row that comparison selected.
//
// -----------------------------------------------------------------------------
// NOTHING HERE EXECUTES AGAINST POSTGRES, AND SAYING SO IS PART OF THE SUITE
// -----------------------------------------------------------------------------
// `ci.yml`'s `integration` job runs on bare `ubuntu-latest` with no services
// block. Every assertion below reads the SQL the accessor BUILDS, through a
// driverless Drizzle handle (`drizzle-orm/pg-proxy`) that records `(sql,
// params)` and answers rows this file composes. That is `account-cap-door.
// test.ts`'s construction and its stated limit: what is proved here is the
// statement and the resolution, never that PostgreSQL agrees.
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { getTableColumns } from 'drizzle-orm';
import { type PgColumn, type PgTable } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/pg-proxy';
import { describe, expect, test } from 'vitest';

import { CATALOG_TABLE_KEYS, SCOPE_RULES, TABLES, type TableKey } from '../src/index.ts';
import { lastClosedTradingDayStatement, type StatementSource } from '../src/scoped-db.ts';

const SCOPED_DB_SRC = readFileSync(
  fileURLToPath(new URL('../src/scoped-db.ts', import.meta.url)),
  'utf8',
);

interface Sent {
  readonly sql: string;
  readonly params: unknown[];
}

/** The property names of one table, in the order a `SELECT *` returns them. */
function propertiesOf(key: TableKey): string[] {
  return Object.keys(getTableColumns(TABLES[key] as PgTable));
}

/** The Drizzle property name for a SQL column name on one table. */
function propertyFor(key: TableKey, sqlName: string): string {
  const columns = getTableColumns(TABLES[key] as PgTable) as unknown as Record<string, PgColumn>;
  for (const [property, column] of Object.entries(columns)) {
    if (column.name === sqlName) return property;
  }
  throw new Error(`${key} declares no column named ${sqlName}`);
}

/**
 * One row of a table, as `drizzle-orm/pg-proxy` hands it back.
 *
 * Every column this file does not name is null, which is what makes a door that
 * read one of them visible.
 */
function rowOf(key: TableKey, values: Readonly<Record<string, unknown>>): unknown[] {
  const properties = propertiesOf(key);
  const row = new Array(properties.length).fill(null) as unknown[];
  for (const [sqlName, value] of Object.entries(values)) {
    row[properties.indexOf(propertyFor(key, sqlName))] = value;
  }
  return row;
}

/** A driverless handle answering a queue of row sets, one per STATEMENT. */
function answering(queue: readonly unknown[][][]): { source: StatementSource; sent: Sent[] } {
  const sent: Sent[] = [];
  const source: StatementSource = drizzle(async (sql: string, params: unknown[]) => {
    sent.push({ sql, params });
    return { rows: queue[sent.length - 1] ?? [] };
  });
  return { source, sent };
}

/** A `trading_calendar` row at whatever day and close a case needs. */
const calendarRow = (tradingDay: unknown, sessionCloseAt: unknown): unknown[][] => [
  rowOf('tradingCalendar', {
    trading_day: tradingDay,
    session_open_at: sessionCloseAt === null ? null : new Date('2026-08-28T13:30:00Z'),
    session_close_at: sessionCloseAt,
    is_half_day: false,
    is_holiday: sessionCloseAt === null,
    halted: false,
  }),
];

/** A `trading_calendar_loads` row over whatever window a case needs. */
const loadRow = (from: string, to: string): unknown[][] => [
  rowOf('tradingCalendarLoads', {
    source_id: 'CME 2026',
    coverage_start_day: from,
    coverage_end_day: to,
    actor: 'calendar-loader',
  }),
];

const NO_ROWS: unknown[][] = [];

/** The three answers a well-formed calendar gives, in the order the door asks. */
const WELL_FORMED: readonly unknown[][][] = [
  calendarRow('2026-08-28', new Date('2026-08-28T20:00:00Z')),
  calendarRow('2026-08-31', new Date('2026-08-31T20:00:00Z')),
  loadRow('2026-01-02', '2026-12-31'),
];

// -----------------------------------------------------------------------------
// 1. THE READ, AND THE VOCABULARY IT NEVER CROSSES
// -----------------------------------------------------------------------------

describe('the door compares an instant with an instant and a day with a day', () => {
  test('the closed read filters on `session_close_at <= now()`, orders by day DESC and takes one', async () => {
    const { source, sent } = answering(WELL_FORMED);
    await lastClosedTradingDayStatement(source);

    const closed = sent[0] as Sent;
    expect(closed.sql).toContain('"trading_calendar"');
    expect(closed.sql).toContain('"session_close_at" <= now()');
    expect(closed.sql).toContain('order by "trading_calendar"."trading_day" desc');
    expect(closed.sql).toContain('limit');
  });

  test('the second read is the NEXT session, `session_close_at > now()`, day ASC, one row', async () => {
    const { source, sent } = answering(WELL_FORMED);
    await lastClosedTradingDayStatement(source);

    const ahead = sent[1] as Sent;
    expect(ahead.sql).toContain('"trading_calendar"');
    expect(ahead.sql).toContain('"session_close_at" > now()');
    expect(ahead.sql).toContain('order by "trading_calendar"."trading_day" asc');
    expect(ahead.sql).toContain('limit');
  });

  test('NEITHER CALENDAR READ CARRIES A CLOCK PARAMETER, because `now()` is the transaction-s', async () => {
    // A clock passed in would be a clock the caller could move, on the read that
    // decides which day a payout verdict is computed against. Inside a
    // transaction `now()` is that transaction's start instant, which is also
    // what makes the two reads one moment.
    //
    // THE ONE PARAMETER IS `LIMIT`, and asserting that rather than an empty list
    // is the stronger claim: it says the statement carries exactly one bound
    // value and that value is the row count. `now()` is INLINE SQL, so there is
    // no position in either statement for a caller-supplied instant to occupy.
    const { source, sent } = answering(WELL_FORMED);
    await lastClosedTradingDayStatement(source);

    expect((sent[0] as Sent).params).toEqual([1]);
    expect((sent[1] as Sent).params).toEqual([1]);
  });

  test('the coverage read is `trading_calendar_loads` and carries the two DAYS and no instant', async () => {
    const { source, sent } = answering(WELL_FORMED);
    await lastClosedTradingDayStatement(source);

    const coverage = sent[2] as Sent;
    expect(coverage.sql).toContain('"trading_calendar_loads"');
    expect(coverage.sql).toContain('"coverage_start_day" <=');
    expect(coverage.sql).toContain('"coverage_end_day" >=');
    expect(coverage.params).toEqual(['2026-08-28', '2026-08-31', 1]);
    for (const param of coverage.params) expect(param).not.toBeInstanceOf(Date);
  });

  test('three statements and no join, so neither table is read through the other', async () => {
    const { source, sent } = answering(WELL_FORMED);
    await lastClosedTradingDayStatement(source);

    expect(sent).toHaveLength(3);
    for (const statement of sent) expect(statement.sql).not.toContain('join');
  });

  test('A HOLIDAY FALLS OUT OF THE COMPARISON AND NOT OUT OF A BRANCH', () => {
    // `0032` made a holiday's `session_close_at` NULL and `NULL <= now()` is not
    // true, so a holiday is excluded by the predicate. That is
    // `databaseEconomicCalendar`'s idiom one route over, and it is asserted on
    // the SOURCE because the alternative -- a branch somebody has to remember to
    // write -- is what the other two folds of this predicate in the tree do.
    const door = SCOPED_DB_SRC.slice(
      SCOPED_DB_SRC.indexOf('export async function lastClosedTradingDayStatement'),
    );
    const body = door.slice(0, door.indexOf('\n}\n'));
    expect(body).not.toContain('isHoliday');
    expect(body).not.toContain('is_holiday');
  });
});

// -----------------------------------------------------------------------------
// 2. THE ANSWER
// -----------------------------------------------------------------------------

describe('a calendar that can still see past the closed day answers with the day', () => {
  test('the day is the one the closed read selected', async () => {
    const { source } = answering(WELL_FORMED);
    await expect(lastClosedTradingDayStatement(source)).resolves.toBe('2026-08-28');
  });

  test('the caller receives a bare string, so there is nowhere to put a second answer', async () => {
    const { source } = answering(WELL_FORMED);
    const day = await lastClosedTradingDayStatement(source);
    expect(typeof day).toBe('string');
  });
});

// -----------------------------------------------------------------------------
// 3. THE REFUSALS, AND THE ORDER IS PART OF EACH ONE
// -----------------------------------------------------------------------------

describe('the calendar refuses rather than guessing, and stops reading when it does', () => {
  test('no session has closed: the refusal names the load and reads nothing else', async () => {
    const { source, sent } = answering([NO_ROWS]);
    await expect(lastClosedTradingDayStatement(source)).rejects.toThrow(
      /no `trading_calendar` row carries a session that has already closed/,
    );
    expect(sent).toHaveLength(1);
  });

  test('AN EXHAUSTED CALENDAR IS A REFUSAL, which is the whole of F-4 on this door', async () => {
    // The maximum closed row of a calendar that stops there is not known to be
    // the LAST closed day: every day after it is outside coverage, and outside
    // coverage is UNKNOWN rather than a holiday. Answering it would evaluate a
    // payout against a floor that has moved, on an endpoint that reads as
    // working.
    const { source, sent } = answering([
      calendarRow('2026-08-28', new Date('2026-08-28T20:00:00Z')),
      NO_ROWS,
    ]);
    await expect(lastClosedTradingDayStatement(source)).rejects.toThrow(
      /carries no session that has NOT yet closed/,
    );
    expect(sent).toHaveLength(2);
  });

  test('no load interval spans both days: a coverage gap is a refusal too', async () => {
    const { source, sent } = answering([
      calendarRow('2026-08-28', new Date('2026-08-28T20:00:00Z')),
      calendarRow('2026-08-31', new Date('2026-08-31T20:00:00Z')),
      NO_ROWS,
    ]);
    await expect(lastClosedTradingDayStatement(source)).rejects.toThrow(
      /no `trading_calendar_loads` row covers/,
    );
    expect(sent).toHaveLength(3);
  });

  test('the refusals name the reading, so the session that meets one does not invent it', async () => {
    const { source } = answering([NO_ROWS]);
    await expect(lastClosedTradingDayStatement(source)).rejects.toThrow(/R-06/);
  });
});

// -----------------------------------------------------------------------------
// 4. A DAY IS A DAY, ON BOTH ROWS
// -----------------------------------------------------------------------------
// `trading_day` is `date`, which this driver hands back as `YYYY-MM-DD`. A value
// arriving as a `Date` has already crossed a timezone conversion this module did
// not make, and rendering it would produce a UTC calendar date meeting an
// exchange CT trading day -- ADR-146 clause 4's forbidden failure, arriving
// through a driver rather than through a line of code.

describe('a trading day is a YYYY-MM-DD string or it is a throw', () => {
  test.each([
    ['a malformed closed day', '28/08/2026', '2026-08-31'],
    ['a malformed next session', '2026-08-28', 'next friday'],
  ])('%s throws, named', async (_name, closed, ahead) => {
    const { source } = answering([
      calendarRow(closed, new Date('2026-08-28T20:00:00Z')),
      calendarRow(ahead, new Date('2026-08-31T20:00:00Z')),
      loadRow('2026-01-02', '2026-12-31'),
    ]);
    await expect(lastClosedTradingDayStatement(source)).rejects.toThrow(
      /is not a YYYY-MM-DD trading day/,
    );
  });

  test('a non-string, non-date value fails CLOSED, and the message is the driver-s', async () => {
    // WATCHED, AND THE MESSAGE IS RECORDED RATHER THAN IMPROVED. Drizzle's own
    // `PgDateString` mapper runs before any line of this package sees the value
    // and calls `.toISOString()` on it, so a number dies there with
    // "value.toISOString is not a function" -- a refusal naming no column, no
    // table and no rule. The door still fails closed, which is the property that
    // matters on this path, and this case is where the fact is written down.
    const { source } = answering([
      calendarRow(20260828, new Date('2026-08-28T20:00:00Z')),
      calendarRow('2026-08-31', new Date('2026-08-31T20:00:00Z')),
      loadRow('2026-01-02', '2026-12-31'),
    ]);
    await expect(lastClosedTradingDayStatement(source)).rejects.toThrow();
  });
});

// -----------------------------------------------------------------------------
// 4b. A `Date` NEVER REACHES THE GUARD, AND WHAT RENDERS IT IS THE CROSSING
//     ADR-146 CLAUSE 4 FORBIDS
// -----------------------------------------------------------------------------
// **THIS BLOCK ASSERTED A DEFECT AND ADR-271 REPAIRED IT. THE CASES ARE KEPT AND
// THEIR CLAIM IS WHAT MOVED.** Two cases here originally asserted that a `Date`
// on a calendar row THROWS. Both went green-side-up, and measuring why produced
// ADR-268's largest finding:
//
//   1. `pg` parses a `date` column (OID 1082) into a JS `Date` at the PROCESS'S
//      LOCAL MIDNIGHT.
//   2. Drizzle's `PgDateString.mapFromDriverValue` then renders that `Date` with
//      `toISOString()`, which is UTC.
//
// So on a process whose `TZ` was east of UTC, the database's `2026-08-28`
// reached Merit code as `'2026-08-27'` -- `ADR-146` clause 4's forbidden failure
// performed by two libraries before any Merit line ran, on EVERY `date` column
// in the estate rather than only on this door.
//
// -----------------------------------------------------------------------------
// WHAT ADR-271 CHANGED, AND WHY ONLY ONE OF THE THREE CASES BELOW COULD FEEL IT
// -----------------------------------------------------------------------------
// `client.ts` now installs `setTypeParser(1082, ...)` returning the wire text
// verbatim, so step 1 no longer builds a `Date` and step 2's coercion is never
// reached. The three-offset proof is `date-column-timezone.test.ts`.
//
// **ONLY THE THIRD CASE TURNED RED, AND THAT IS ITSELF THE FINDING.** The first
// two compose their own rows and answer them through `drizzle-orm/pg-proxy`, so
// they exercise drizzle's mapper and NEVER `pg`'s parser -- which is exactly why
// a suite this thorough could pin a driver defect and not be able to fail on it.
// **A test that supplies its own driver values cannot see a driver defect.** The
// two cases keep their expected values, because drizzle's coercion is unchanged;
// what they no longer are is a bug report. They now record the coercion the
// parser exists to keep unreachable, and the case that says it is unreachable
// lives one file over.
//
// THE GUARD IS STILL NOT LOOSENED AND NOTHING IS DELETED.

describe('the date mapper would still coerce, which is why nothing may reach it', () => {
  test('a `Date` handed straight to the mapper is rendered as a UTC day, parser bypassed', async () => {
    const { source } = answering([
      calendarRow(new Date('2026-08-28T00:00:00Z'), new Date('2026-08-28T20:00:00Z')),
      calendarRow('2026-08-31', new Date('2026-08-31T20:00:00Z')),
      loadRow('2026-01-02', '2026-12-31'),
    ]);
    await expect(lastClosedTradingDayStatement(source)).resolves.toBe('2026-08-28');
  });

  test('THE RENDERING IS `toISOString`, so a local-midnight Date one zone east is the DAY BEFORE', async () => {
    // The value below is what `pg` USED TO hand back for the database day
    // `2026-08-28` in a process running at UTC+02:00, and drizzle's coercion of
    // it is unchanged. THIS CASE WAS THE BUG REPORT AND IS NOW THE MOTIVE: it
    // states what would happen again the day a `Date` reaches this mapper, which
    // is what `setTypeParser(1082, ...)` makes impossible from the driver and
    // what `RI-25` keeps anyone from undoing.
    const localMidnightAtPlusTwo = new Date('2026-08-27T22:00:00Z');
    const { source } = answering([
      calendarRow(localMidnightAtPlusTwo, new Date('2026-08-28T20:00:00Z')),
      calendarRow('2026-08-31', new Date('2026-08-31T20:00:00Z')),
      loadRow('2026-08-01', '2026-12-31'),
    ]);
    await expect(lastClosedTradingDayStatement(source)).resolves.toBe('2026-08-27');
  });

  // THE INVERTED ASSERTION. It read `expect(clientSrc).not.toContain(
  // 'setTypeParser')` and its title was "nothing in this package installs a
  // `date` type parser, which is why the above holds". It was the one case in
  // this file the repair could turn red, and it did. **IT IS INVERTED RATHER
  // THAN DELETED**, because the fact it pins is still the fact that decides
  // whether the two cases above describe the estate or only describe drizzle.
  //
  // THE SECOND LEG IS UNCHANGED AND IT IS NOT A LEFTOVER. `scoped-db.ts` must
  // still install NO parser: one parser in the one file that constructs the pool
  // is the repair, and a second one anywhere is the per-reader correction ADR-271
  // refused. `RI-25` asserts that across the whole tree.
  test('the `date` type parser is installed, in `client.ts` and nowhere else', () => {
    const clientSrc = readFileSync(
      fileURLToPath(new URL('../src/client.ts', import.meta.url)),
      'utf8',
    );
    expect(clientSrc).toContain('setTypeParser');
    expect(clientSrc).toContain('1082');
    expect(SCOPED_DB_SRC).not.toContain('setTypeParser');
  });
});

// -----------------------------------------------------------------------------
// 5. THE ADMISSION THAT WAS NOT TAKEN, AND THE TRANSACTION THAT WAS NOT SPLIT
// -----------------------------------------------------------------------------

describe('the catalogue list did not move to build this door', () => {
  test('CATALOG_TABLE_KEYS is still the same five members', () => {
    expect(CATALOG_TABLE_KEYS).toEqual([
      'coupons',
      'geoRestrictions',
      'midHealth',
      'planVersions',
      'planVersionSizes',
    ]);
  });

  test('neither calendar table is one of them', () => {
    expect(CATALOG_TABLE_KEYS as readonly string[]).not.toContain('tradingCalendar');
    expect(CATALOG_TABLE_KEYS as readonly string[]).not.toContain('tradingCalendarLoads');
  });

  test('both tables are still registered `firm`, which is the class the door reads them as', () => {
    expect(SCOPE_RULES.tradingCalendar.class).toBe('firm');
    expect(SCOPE_RULES.tradingCalendarLoads.class).toBe('firm');
  });

  test('the door is a method of the SCOPED transaction and returns one day', () => {
    // Not `string | null`: an absent value is one a caller can write `?? new
    // Date().toISOString().slice(0, 10)` against in one expression, and that
    // expression is ADR-146 clause 4's forbidden crossing spelled out.
    expect(SCOPED_DB_SRC).toContain('lastClosedTradingDay(): Promise<string>;');
  });

  test('ALL THREE READS ARRIVE ON THE ONE HANDLE, which is the two-transaction remedy refused', () => {
    // The recorder above is a single source. Three statements reaching it is the
    // property ADR-268 ruling 1 turns on: the day and the `rule_states` row it
    // selects are read at ONE snapshot, so a calendar correction landing between
    // them cannot produce a verdict whose basis day the transaction that
    // recorded it never saw.
    const { source, sent } = answering(WELL_FORMED);
    return lastClosedTradingDayStatement(source).then(() => {
      expect(sent).toHaveLength(3);
      expect(new Set(sent.map((statement) => statement.sql)).size).toBe(3);
    });
  });
});
