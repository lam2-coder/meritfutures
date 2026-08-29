import { expect, test } from 'vitest';

import { NO_PRE_IDENTITY_DOORS } from './db-recorder.ts';
import type { ApiDb } from '../src/db.ts';
import {
  ECONOMIC_CALENDAR_HORIZON_VAR,
  EconomicCalendarError,
  EconomicCalendarUnconfigured,
  databaseEconomicCalendar,
  newestCoverageDay,
  resolveEconomicCalendarHorizon,
} from '../src/routes/economic-calendar.ts';

// CI-02, the `unit` project.
//
// =============================================================================
// THE SUITE FOR THE HALF THAT WAS A SENTENCE IN A RUNBOOK (ADR-240)
// =============================================================================
// `economic-calendar.test.ts` next door asserts what the ROUTE does with a
// panel. This file asserts what the DEPLOYMENT does to produce one, and the two
// are kept apart because they fail for different reasons: that one fails when a
// renderer derives a day from an instant, and this one fails when a freshness
// verdict is published against a threshold nobody set.
//
// -----------------------------------------------------------------------------
// WHY THE FIXTURE IS LOCAL AND NOT `recordingDb`
// -----------------------------------------------------------------------------
// `db-recorder.ts` answers every `rows` call from one canned array, which is
// right for an adapter that reads one table and cannot express an adapter that
// reads three. This one reads `economic_calendar_current`,
// `economic_calendar_loads` and `trading_calendar` in one transaction, and a
// fixture that handed all three the same rows could not tell a correct read of
// the calendar from a read of the loads table by mistake.
//
// SO THE FIXTURE ANSWERS BY KEY AND RECORDS THE FILTER, and it asserts the same
// class of property `db-recorder.ts` states it is for: WHICH DOOR was opened,
// WHICH TABLE was named and WHAT WAS NAMED IN THE FILTER. It proves nothing
// about whether the composed predicate reaches one row or many, which is
// `packages/db`'s and is asserted in `packages/db/test/keyed-accessor.test.ts`.
//
// -----------------------------------------------------------------------------
// THE CLOCK IS A PARAMETER, WHICH IS WHAT MAKES THE STALENESS CASES WRITABLE
// -----------------------------------------------------------------------------
// Every case below fixes an instant and puts sessions on either side of it. A
// suite that used the real clock would assert nothing about the comparison: it
// would pass in March and fail in April against unchanged code, which is the
// class of test that gets deleted rather than fixed.
// =============================================================================

/** The instant every case below reads at. Fixed, and it is inside a session. */
const NOW = new Date('2026-03-04T15:00:00.000Z');

/** One `trading_calendar` row, as the accessor hands it over. */
function session(tradingDay: string, openAt: string | null): Record<string, unknown> {
  return { tradingDay, sessionOpenAt: openAt === null ? null : new Date(openAt) };
}

/** One `economic_calendar_loads` row. Only `coverage_end_day` is read. */
function load(coverageEndDay: string): Record<string, unknown> {
  return { coverageEndDay };
}

/** One `economic_calendar_current` row, in the accessor's camelCase. */
function occurrence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventKey: 'US.CPI.MOM',
    occurrenceKey: '2026-03',
    tier: 1,
    // The divergent row `economic-calendar.test.ts` derives: 23:30 UTC on
    // 2026-03-03 is 17:30 CST, inside the session whose trading day is
    // 2026-03-04. The two columns disagree, so a rendering that built one from
    // the other would be visible here too.
    scheduledReleaseAt: new Date('2026-03-03T23:30:00.000Z'),
    releaseTradingDay: '2026-03-04',
    revision: 0,
    revisionReason: null,
    ...overrides,
  };
}

interface Read {
  readonly key: string;
  readonly where: unknown;
}

interface Fixture {
  readonly db: ApiDb;
  readonly reads: Read[];
  readonly doors: string[];
}

/**
 * A firm door that answers by table key.
 *
 * THE HANDLE IS CAST FOR `db-recorder.ts`' STATED REASON: `FirmTx` is a branded
 * interface with six methods and a `sqlExecutor`, and a fixture implementing all
 * of them faithfully would be a second accessor. What is recorded is the CALL.
 *
 * `sqlExecutor` THROWS, so a future edit reaching past the keyed vocabulary
 * fails here rather than passing quietly.
 */
function firmFixture(rows: Readonly<Record<string, readonly unknown[]>>): Fixture {
  const reads: Read[] = [];
  const doors: string[] = [];
  const answer = (key: string, where: unknown): Promise<unknown[]> => {
    reads.push({ key, where });
    return Promise.resolve([...(rows[key] ?? [])]);
  };
  const tx = {
    __brand: 'FirmTx',
    sqlExecutor: () => {
      throw new Error('this fixture offers no sqlExecutor: the adapter may not reach for one');
    },
    rows: (key: string) => answer(key, undefined),
    rowsWhere: (key: string, where: unknown) => answer(key, where),
  };
  const db: ApiDb = {
    ...NO_PRE_IDENTITY_DOORS,
    scoped: () =>
      Promise.reject(
        new Error('this fixture opens no scoped door: the panel is nobody in particular'),
      ),
    firm: <T>(fn: (handle: never) => Promise<T>): Promise<T> => {
      doors.push('firm');
      return fn(tx as never);
    },
  } as ApiDb;
  return { db, reads, doors };
}

const CONFIGURED = { [ECONOMIC_CALENDAR_HORIZON_VAR]: '3' };

// -----------------------------------------------------------------------------
// The configuration, which is the whole of what ADR-240 supplies
// -----------------------------------------------------------------------------

test('an unset horizon is a refusal and never a default', () => {
  const answer = resolveEconomicCalendarHorizon({});
  expect('refusal' in answer).toBe(true);
  // The name is in the refusal so an operator reads which variable to set.
  expect(JSON.stringify(answer)).toContain(ECONOMIC_CALENDAR_HORIZON_VAR);
});

test('a blank horizon is the same refusal as an absent one', () => {
  // A variable set to whitespace is the shape a deployment reaches by pasting an
  // empty value, and `Number('  ')` is 0, so the blank has to be refused where
  // the coercion would have hidden it.
  expect(
    'refusal' in resolveEconomicCalendarHorizon({ [ECONOMIC_CALENDAR_HORIZON_VAR]: '   ' })
      ? true
      : false,
  ).toBe(true);
});

test('a fractional horizon is refused rather than rounded', () => {
  // A session is a row. `Number('2.5')` succeeds and names no quantity this
  // comparison has.
  expect(
    'refusal' in resolveEconomicCalendarHorizon({ [ECONOMIC_CALENDAR_HORIZON_VAR]: '2.5' }),
  ).toBe(true);
});

test('zero is refused, because a horizon of zero can never fire', () => {
  expect(
    'refusal' in resolveEconomicCalendarHorizon({ [ECONOMIC_CALENDAR_HORIZON_VAR]: '0' }),
  ).toBe(true);
});

test('a negative horizon is refused', () => {
  expect(
    'refusal' in resolveEconomicCalendarHorizon({ [ECONOMIC_CALENDAR_HORIZON_VAR]: '-3' }),
  ).toBe(true);
});

test('a whole positive number of trading days is accepted', () => {
  expect(resolveEconomicCalendarHorizon({ [ECONOMIC_CALENDAR_HORIZON_VAR]: '7' })).toEqual({
    tradingDays: 7,
  });
});

test('no value for the horizon is written into this repository', () => {
  // ADR-012, and it is asserted rather than trusted: the constant is a NAME and
  // this process is not a deployment, so reading it out of the real environment
  // must come back empty.
  expect(process.env[ECONOMIC_CALENDAR_HORIZON_VAR]).toBeUndefined();
});

// -----------------------------------------------------------------------------
// The refusal reaches the port, and it reaches it before the door is opened
// -----------------------------------------------------------------------------

test('an unconfigured deployment refuses without opening the door', async () => {
  const fixture = firmFixture({});
  const source = databaseEconomicCalendar(fixture.db, {}, () => NOW);

  await expect(source.readPanel()).rejects.toBeInstanceOf(EconomicCalendarUnconfigured);
  // A connection spent to answer a question the configuration already settled is
  // a refusal that costs a socket, and it would be identical for every caller.
  expect(fixture.doors).toEqual([]);
  expect(fixture.reads).toEqual([]);
});

// -----------------------------------------------------------------------------
// The reads: which door, which tables, and what the filters name
// -----------------------------------------------------------------------------

test('all three reads go through the firm door and through one transaction', async () => {
  const fixture = firmFixture({
    economicCalendarCurrent: [occurrence()],
    economicCalendarLoads: [load('2026-03-31')],
    tradingCalendar: [session('2026-03-05', '2026-03-04T23:00:00.000Z')],
  });

  await databaseEconomicCalendar(fixture.db, CONFIGURED, () => NOW).readPanel();

  // ONE door, opened ONCE. The three reads are one unit of work, so a load
  // landing between the calendar read and the coverage read cannot produce a
  // panel whose freshness describes a different moment than its rows.
  expect(fixture.doors).toEqual(['firm']);
  expect(fixture.reads.map((read) => read.key)).toEqual([
    'economicCalendarCurrent',
    'economicCalendarLoads',
    'tradingCalendar',
  ]);
});

test('the view is read and the base table is never named', async () => {
  const fixture = firmFixture({ economicCalendarLoads: [load('2026-03-31')] });

  await databaseEconomicCalendar(fixture.db, CONFIGURED, () => NOW).readPanel();

  // `0039` calls the view "the only definition of that anywhere". An adapter
  // over `economic_calendar` would re-derive the maximum revision in
  // TypeScript, which is `FM-M7-08`'s second source of truth.
  expect(fixture.reads.map((read) => read.key)).not.toContain('economicCalendar');
});

test('the occurrence read is bounded by the clock and by nothing else', async () => {
  const fixture = firmFixture({ economicCalendarLoads: [load('2026-03-31')] });

  await databaseEconomicCalendar(fixture.db, CONFIGURED, () => NOW).readPanel();

  const view = fixture.reads.find((read) => read.key === 'economicCalendarCurrent');
  // AN INSTANT AGAINST AN INSTANT. The filter names `scheduledReleaseAt` and
  // carries the clock's own value, so nothing converts a timestamp into a day.
  // `tier` is deliberately absent: `0039` header item 3 makes it a column and
  // not an import filter, and a filter here would make the field a constant.
  expect(Object.keys(view?.where as Record<string, unknown>)).toEqual(['scheduledReleaseAt']);
  expect(JSON.stringify(view?.where)).toContain(NOW.toISOString());
});

test('the session read names the clock and the coverage day, each in its own vocabulary', async () => {
  const fixture = firmFixture({ economicCalendarLoads: [load('2026-03-31')] });

  await databaseEconomicCalendar(fixture.db, CONFIGURED, () => NOW).readPanel();

  const calendar = fixture.reads.find((read) => read.key === 'tradingCalendar');
  const where = calendar?.where as Record<string, { term: string; value: unknown }>;
  expect(Object.keys(where).sort()).toEqual(['sessionOpenAt', 'tradingDay']);
  // THE ASSERTION ADR-146 CLAUSE 4 IS ABOUT. `sessionOpenAt` is bounded by a
  // `Date` and `tradingDay` by a `YYYY-MM-DD` string, and neither bound was
  // built from the other. A route that derived a UTC calendar date from the
  // clock would show up here as a string on the `sessionOpenAt` side or a Date
  // on the `tradingDay` side.
  expect(where['sessionOpenAt']?.value).toBeInstanceOf(Date);
  expect(where['tradingDay']?.value).toBe('2026-03-31');
});

// -----------------------------------------------------------------------------
// The freshness verdict
// -----------------------------------------------------------------------------

test('nothing ever loaded is stale, and the sessions are not even counted', async () => {
  const fixture = firmFixture({ economicCalendarLoads: [] });

  const panel = await databaseEconomicCalendar(fixture.db, CONFIGURED, () => NOW).readPanel();

  expect(panel.freshness).toEqual({ stale: true, covered_through_day: null });
  // `DEP-M4-09`: the dangerous failure is the confident one. There is no
  // coverage day to bound a session read with, and `renderEconomicCalendar`
  // refuses the opposite pair outright.
  expect(fixture.reads.map((read) => read.key)).not.toContain('tradingCalendar');
});

test('fewer sessions ahead than the horizon is stale', async () => {
  const fixture = firmFixture({
    economicCalendarLoads: [load('2026-03-06')],
    // Two sessions still ahead, against a horizon of three.
    tradingCalendar: [
      session('2026-03-05', '2026-03-04T23:00:00.000Z'),
      session('2026-03-06', '2026-03-05T23:00:00.000Z'),
    ],
  });

  const panel = await databaseEconomicCalendar(fixture.db, CONFIGURED, () => NOW).readPanel();

  expect(panel.freshness).toEqual({ stale: true, covered_through_day: '2026-03-06' });
});

test('as many sessions ahead as the horizon is not stale', async () => {
  const fixture = firmFixture({
    economicCalendarLoads: [load('2026-03-09')],
    tradingCalendar: [
      session('2026-03-05', '2026-03-04T23:00:00.000Z'),
      session('2026-03-06', '2026-03-05T23:00:00.000Z'),
      session('2026-03-09', '2026-03-08T22:00:00.000Z'),
    ],
  });

  const panel = await databaseEconomicCalendar(fixture.db, CONFIGURED, () => NOW).readPanel();

  // THE BOUNDARY IS ASSERTED IN BOTH DIRECTIONS, one case up and one here, so a
  // comparison written `<=` instead of `<` fails one of the two. A suite
  // holding only the stale case would pass against a source that always said
  // stale.
  expect(panel.freshness).toEqual({ stale: false, covered_through_day: '2026-03-09' });
});

test('the horizon is what decides it, and a different value flips the verdict', async () => {
  const rows = {
    economicCalendarLoads: [load('2026-03-06')],
    tradingCalendar: [
      session('2026-03-05', '2026-03-04T23:00:00.000Z'),
      session('2026-03-06', '2026-03-05T23:00:00.000Z'),
    ],
  };

  const strict = await databaseEconomicCalendar(
    firmFixture(rows).db,
    { [ECONOMIC_CALENDAR_HORIZON_VAR]: '3' },
    () => NOW,
  ).readPanel();
  const relaxed = await databaseEconomicCalendar(
    firmFixture(rows).db,
    { [ECONOMIC_CALENDAR_HORIZON_VAR]: '2' },
    () => NOW,
  ).readPanel();

  // WITHOUT THIS PAIR THE VARIABLE COULD BE READ AND IGNORED and every other
  // case here would still pass. The rows are identical and only the
  // configuration differs.
  expect(strict.freshness.stale).toBe(true);
  expect(relaxed.freshness.stale).toBe(false);
});

test('the newest coverage day wins, whatever order the loads arrive in', () => {
  // A `date` is zero-padded ISO and has one spelling, so string order is
  // chronological order (ADR-146 finding 8). An INSTANT does not, which is why
  // `renderEconomicCalendar` refuses to sort those.
  expect(newestCoverageDay([load('2026-03-06'), load('2026-04-30'), load('2026-01-02')])).toBe(
    '2026-04-30',
  );
  expect(newestCoverageDay([])).toBeNull();
});

// -----------------------------------------------------------------------------
// The rows, off the accessor
// -----------------------------------------------------------------------------

test('the stored trading day is carried across and the instant is rendered separately', async () => {
  const fixture = firmFixture({
    economicCalendarCurrent: [occurrence()],
    economicCalendarLoads: [load('2026-03-31')],
  });

  const panel = await databaseEconomicCalendar(fixture.db, CONFIGURED, () => NOW).readPanel();

  // THE ROW WHERE THE TWO VOCABULARIES COME APART. The instant's UTC date is
  // 2026-03-03 and the trading day is 2026-03-04, so an adapter that built the
  // day out of the instant would produce the first string here.
  expect(panel.occurrences[0]?.scheduled_release_at).toBe('2026-03-03T23:30:00.000Z');
  expect(panel.occurrences[0]?.release_trading_day).toBe('2026-03-04');
});

test('a scheduled_release_at that is not a Date is refused rather than coerced', async () => {
  const fixture = firmFixture({
    economicCalendarCurrent: [occurrence({ scheduledReleaseAt: '2026-03-03T23:30:00Z' })],
    economicCalendarLoads: [load('2026-03-31')],
  });

  // A string here would mean the column was read through a path that is not the
  // one this adapter believes it is on, and `new Date(string)` would hide it.
  await expect(
    databaseEconomicCalendar(fixture.db, CONFIGURED, () => NOW).readPanel(),
  ).rejects.toBeInstanceOf(EconomicCalendarError);
});

test('a release_trading_day that is not a string is refused', async () => {
  const fixture = firmFixture({
    economicCalendarCurrent: [occurrence({ releaseTradingDay: new Date('2026-03-04') })],
    economicCalendarLoads: [load('2026-03-31')],
  });

  await expect(
    databaseEconomicCalendar(fixture.db, CONFIGURED, () => NOW).readPanel(),
  ).rejects.toBeInstanceOf(EconomicCalendarError);
});

test('a revision reason survives as text and an original survives as null', async () => {
  const fixture = firmFixture({
    economicCalendarCurrent: [
      occurrence(),
      occurrence({
        occurrenceKey: '2026-04',
        revision: 1,
        revisionReason: 'the source revised the release time',
      }),
    ],
    economicCalendarLoads: [load('2026-03-31')],
  });

  const panel = await databaseEconomicCalendar(fixture.db, CONFIGURED, () => NOW).readPanel();

  // `economic_calendar_revision_states_its_reason` is an equivalence and
  // `renderEconomicCalendar` checks it. What this asserts is that the adapter
  // carries both halves across rather than flattening one of them.
  expect(panel.occurrences[0]?.revision_reason).toBeNull();
  expect(panel.occurrences[1]?.revision_reason).toBe('the source revised the release time');
});
