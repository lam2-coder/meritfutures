// =============================================================================
// apps/worker/test/trading-day-coverage.test.ts
// =============================================================================
// **THE DAY THIS DEPLOYABLE FOLDS, AND THE COVERAGE FACT IT USED TO SKIP.**
// `ADR-277`.
//
// `ADR-268` finding 2 reported that `readLastClosedTradingDay` consulted no
// coverage. `ADR-273` finding 1 re-derived it and enlarged it: the CALLER
// supplied none either, because `calendarCarriesDay` asked a coverage-shaped
// question of `trading_calendar`, which states that a day IS a session and never
// that anybody LOADED it. Both entries left it as a finding because `apps/worker`
// was outside their fences. This file is the executed half of the repair.
//
// -----------------------------------------------------------------------------
// THE CENTRAL CASE NEEDS NO SECOND CALLER AND NO SEEDED DEFECT, WHICH IS THE ONE
// THING THIS SUITE HAD TO SOLVE
// -----------------------------------------------------------------------------
// The failure is "the batch gets a confident day for a date the estate never
// loaded", and proving it by adding a coverage-blind caller to a `src/` file is
// the widening `ADR-277`'s row forbids. It is unnecessary, because ON THE RIGHT
// ESTATE THE REFUSAL CARRIES THE WRONG ANSWER INSIDE ITSELF: a calendar holding
// sessions through `2026-08-28` whose loads reach only `2026-06-30`, read at
// `2026-08-30`, refuses with `2026-08-28` NAMED in the refusal, and `2026-08-28`
// is exactly the day the coverage-blind fold returned. One case asserts both
// halves at once. This is `apps/api/test/last-closed-day-coverage-split.test.ts`'s
// method one deployable over, and it is deliberate: the two suites now measure
// the same property on the two folds that used to disagree about it.
//
// AND THE REFUSAL IS SHOWN TO BE CONDITIONAL, without which every refusal case
// here is satisfied by a reader that refuses everything.
//
// -----------------------------------------------------------------------------
// THE CALENDAR IS SYNTHETIC AND THIS FILE SAYS SO RATHER THAN IMPLYING IT
// -----------------------------------------------------------------------------
// `TR-01` forbids writing down which days the exchange trades from recollection.
// Whether CME traded on any day below is NOT asserted and is not what this file
// tests, which is which rows the two readers consult, in how many transactions,
// and which answers they refuse.
//
// CI-02, the `unit` project. No database: every case drives the real exported
// readers over a door that holds rows, and the source-level cases parse the real
// files rather than copies of them.
// =============================================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { stripComments } from '../../../packages/tooling/checks/strip-comments.mjs';

import type { SystemTx } from '@merit/db';
import type { TradingDay } from '@merit/rules-engine';

import { anchorLastClosedDay, anchorNamedDay } from '../src/batch/adapter.ts';
import type { BatchTx } from '../src/batch/adapter.ts';
import type { WorkerDb } from '../src/db.ts';
import { TRADING_DAY_VAR, WorkerJobRefusal, resolveTradingDay } from '../src/job.ts';
import type { WorkerJobIo } from '../src/job.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

const ADAPTER_REL = 'apps/worker/src/batch/adapter.ts';
const JOB_REL = 'apps/worker/src/job.ts';
const BARREL_REL = 'apps/worker/src/index.ts';

const sourceOf = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

// COMMENTS STRIPPED, ON `RI-25`'s AND `RI-27`'s SEED. Every file this suite
// parses discusses this subject at length in its own header, and two of them
// quote the retired identifiers in order to say they are retired. A matcher that
// read the raw file would agree with the prose rather than with the code.
//
// **THE SCANNER ADR-277 WROTE HERE NOW LIVES IN THE SHARED HOME AND IS IMPORTED
// (ADR-279).** Its reason stands verbatim: the idiom everywhere else in this
// tree was a block-comment replacement followed by a line-comment replacement,
// so a block-comment OPENER written inside a LINE comment opened a phantom block
// that ran to the next real closer and took every line of code between them with
// it. `apps/worker/src/index.ts` carries two, both inside prose quoting a glob,
// and under that idiom the barrel strips from 55,728 characters to 2,753: the
// export list this suite is here to read is one of the things that disappears,
// and every assertion over it passes VACUOUSLY. Seed 13 is what found it.
//
// **ADR-279 ALSO FOUND ONE DEFECT IN THE VERSION THIS FILE USED TO HOLD**, on
// three real files rather than by reading: a template SUBSTITUTION that opens a
// SECOND template closed the outer literal on the inner backtick and inverted
// every state after it, which left real docblocks unstripped in
// `packages/rules-engine/src/external-gates.ts`, `repo-invariants.mjs` and
// `scripts/ci/falsify-ci.mjs`. The shared home models `${...}` as code and this
// suite gets that repair by importing rather than by an edit here.

// -----------------------------------------------------------------------------
// A door that holds rows rather than one that connects
// -----------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Tables = Readonly<Record<string, readonly Row[]>>;

interface Door {
  readonly db: WorkerDb;
  /** One entry per `batch()` call, holding the table keys read inside it. */
  readonly transactions: string[][];
}

function doorOf(tables: Tables): Door {
  const transactions: string[][] = [];
  const of = (key: string): readonly Row[] => tables[key] ?? [];

  const db: WorkerDb = {
    batch<T>(fn: (tx: SystemTx) => Promise<T>): Promise<T> {
      const keys: string[] = [];
      transactions.push(keys);
      const tx = {
        rows: (key: string) => {
          keys.push(key);
          return Promise.resolve([...of(key)]);
        },
        rowsWhere: (key: string, where: Readonly<Record<string, unknown>>) => {
          keys.push(key);
          return Promise.resolve(
            of(key).filter((row) =>
              Object.entries(where).every(([column, value]) => row[column] === value),
            ),
          );
        },
      } as unknown as BatchTx;
      return fn(tx as unknown as SystemTx);
    },
  };

  return { db, transactions };
}

// -----------------------------------------------------------------------------
// The rows, in the property names `packages/db/src/schema.ts` declares
// -----------------------------------------------------------------------------

/** A session row. `sessionCloseAt` is the only instant either reader consults. */
function session(day: string, closeAt: string): Row {
  return {
    tradingDay: day,
    isHalfDay: false,
    isHoliday: false,
    halted: false,
    sessionCloseAt: new Date(closeAt),
  };
}

/** A holiday row: a POSITIVE fact, with no session and therefore no close. */
function holiday(day: string): Row {
  return {
    tradingDay: day,
    isHalfDay: false,
    isHoliday: true,
    halted: false,
    sessionCloseAt: null,
  };
}

/** One `trading_calendar_loads` row, as the inclusive bounds it declares. */
function load(from: string, to: string): Row {
  return { coverageStartDay: from, coverageEndDay: to };
}

const AT = new Date('2026-08-30T00:00:00.000Z');

/** Sessions through `2026-08-28`, plus one ahead of `AT`. */
const SESSIONS: readonly Row[] = [
  session('2026-06-29', '2026-06-29T20:00:00.000Z'),
  session('2026-06-30', '2026-06-30T20:00:00.000Z'),
  session('2026-08-27', '2026-08-27T20:00:00.000Z'),
  session('2026-08-28', '2026-08-28T20:00:00.000Z'),
  session('2026-08-31', '2026-08-31T20:00:00.000Z'),
];

/** The same window with nothing ahead of `AT`: an EXHAUSTED calendar. */
const EXHAUSTED: readonly Row[] = SESSIONS.filter(
  (row) => (row['sessionCloseAt'] as Date).getTime() <= AT.getTime(),
);

const io = (db: WorkerDb, env: Record<string, string> = {}): WorkerJobIo => ({
  db,
  env,
  now: () => AT,
  log: () => {},
});

// =============================================================================
// 1. THE REGISTERED GAP, MEASURED ON THE ESTATE THAT CARRIES THE WRONG ANSWER
// =============================================================================

describe('1. a calendar loaded through June and read in August', () => {
  const tables: Tables = {
    tradingCalendar: SESSIONS,
    tradingCalendarLoads: [load('2026-06-01', '2026-06-30')],
  };

  test('1.1 refuses, and NAMES the day the coverage-blind fold handed out', async () => {
    // BOTH HALVES IN ONE CASE. `2026-08-28` is the latest session closed at
    // `AT`, so it is exactly what `readLastClosedTradingDay` returned and what
    // `resolveTradingDay` stamped on every `rule_states` row. It appears here
    // only inside a refusal.
    const anchor = await anchorLastClosedDay(doorOf(tables).db, AT);

    expect(anchor.kind).toBe('refused');
    if (anchor.kind === 'anchored') throw new Error('unreachable, and the narrowing is the point');
    expect(anchor.why).toContain('2026-08-28');
    expect(anchor.why).toContain('trading_calendar_loads');
  });

  test('1.2 `resolveTradingDay` turns that into a loud refusal on `tradingDay`', async () => {
    // ABOVE THE WATERMARK READ AND ABOVE THE TRANSACTION, `ADR-241` section 5:
    // a job that cannot say which day it is closing writes nothing at all.
    await expect(resolveTradingDay(io(doorOf(tables).db))).rejects.toThrow(WorkerJobRefusal);

    const refusal = await resolveTradingDay(io(doorOf(tables).db)).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(WorkerJobRefusal);
    expect((refusal as WorkerJobRefusal).input).toBe('tradingDay');
    expect((refusal as WorkerJobRefusal).message).toContain('2026-08-28');
  });

  test('1.3 THE REFUSAL IS CONDITIONAL: coverage past the next session anchors', async () => {
    // Without this the whole of section 1 and section 2 is satisfied by a reader
    // that refuses everything. The rows are identical; only the load moves.
    const covered = await anchorLastClosedDay(
      doorOf({
        tradingCalendar: SESSIONS,
        tradingCalendarLoads: [load('2026-06-01', '2026-09-30')],
      }).db,
      AT,
    );

    expect(covered).toEqual({ kind: 'anchored', tradingDay: '2026-08-28' });
  });
});

// =============================================================================
// 2. THREE FACTS, AND EACH ONE REFUSES ON ITS OWN
// =============================================================================

describe('2. the three facts `lastClosedTradingDayStatement` proves, proved here', () => {
  test('2.1 a fresh database: no session has closed', async () => {
    // `ADR-241` section 5's first row. An empty calendar is not an unbroken
    // holiday, and there is no day for `R-06` to permit.
    const anchor = await anchorLastClosedDay(
      doorOf({ tradingCalendar: [], tradingCalendarLoads: [] }).db,
      AT,
    );

    expect(anchor.kind).toBe('refused');
    if (anchor.kind === 'anchored') throw new Error('unreachable');
    expect(anchor.why).toContain('no session that has already closed');
  });

  test('2.2 an EXHAUSTED calendar refuses even when the day itself is covered', async () => {
    // THE FACT THAT IS NOT A COVERAGE READ AND IS THE REASON THE OTHER TWO ARE
    // NOT ENOUGH. `2026-08-28` sits inside the load; what is missing is any
    // session ahead of `AT`, so it is the last day Merit KNOWS ABOUT rather than
    // the last CLOSED one.
    const anchor = await anchorLastClosedDay(
      doorOf({
        tradingCalendar: EXHAUSTED,
        tradingCalendarLoads: [load('2026-06-01', '2026-12-31')],
      }).db,
      AT,
    );

    expect(anchor.kind).toBe('refused');
    if (anchor.kind === 'anchored') throw new Error('unreachable');
    expect(anchor.why).toContain('EXHAUSTED');
    expect(anchor.why).toContain('2026-08-28');
  });

  test('2.3 two ADJACENT loads are not one interval, so the gap refuses', async () => {
    // Merging them on a date successor is the date arithmetic `R-02` forbids,
    // and `packages/db/src/scoped-db.ts` refuses the same estate on the payout
    // door for the same stated reason. A load that means to extend coverage
    // overlaps its predecessor by a day.
    const anchor = await anchorLastClosedDay(
      doorOf({
        tradingCalendar: SESSIONS,
        tradingCalendarLoads: [load('2026-06-01', '2026-08-28'), load('2026-08-29', '2026-12-31')],
      }).db,
      AT,
    );

    expect(anchor.kind).toBe('refused');
    if (anchor.kind === 'anchored') throw new Error('unreachable');
    expect(anchor.why).toContain('ONE interval');
  });

  test('2.4 one OVERLAPPING load spanning both days anchors', async () => {
    // 2.3's remedy, so 2.3 measures the seam rather than the reader.
    const anchor = await anchorLastClosedDay(
      doorOf({
        tradingCalendar: SESSIONS,
        tradingCalendarLoads: [load('2026-06-01', '2026-08-31'), load('2026-08-31', '2026-12-31')],
      }).db,
      AT,
    );

    expect(anchor).toEqual({ kind: 'anchored', tradingDay: '2026-08-28' });
  });

  test('2.5 a holiday is never the day, and never the session ahead', async () => {
    // A holiday carries no `session_close_at`, so it is excluded by the NULL and
    // by the flag both. `2026-08-31` is the only session ahead here; if the
    // holiday counted, the span test would be asked about the wrong day.
    const anchor = await anchorLastClosedDay(
      doorOf({
        tradingCalendar: [...SESSIONS, holiday('2026-08-29'), holiday('2026-08-30')],
        tradingCalendarLoads: [load('2026-06-01', '2026-08-31')],
      }).db,
      AT,
    );

    expect(anchor).toEqual({ kind: 'anchored', tradingDay: '2026-08-28' });
  });
});

// =============================================================================
// 3. THE NAMED DAY, AND THE GUARD THAT ASKED THE WRONG TABLE
// =============================================================================

describe('3. `MERIT_BATCH_TRADING_DAY`, which looked like it checked coverage', () => {
  test('3.1 a day the calendar does not carry refuses', async () => {
    // The half `calendarCarriesDay` did answer correctly, kept.
    const anchor = await anchorNamedDay(
      doorOf({
        tradingCalendar: SESSIONS,
        tradingCalendarLoads: [load('2026-06-01', '2026-12-31')],
      }).db,
      '2026-07-04' as TradingDay,
    );

    expect(anchor.kind).toBe('refused');
    if (anchor.kind === 'anchored') throw new Error('unreachable');
    expect(anchor.why).toContain('has no row for 2026-07-04');
  });

  test('3.2 A CARRIED DAY THAT NO LOAD COVERS REFUSES, and it is the case that passed', async () => {
    // **THE WHOLE OF `ADR-277`'s NAMED-DAY HALF IN ONE CASE.** `calendarCarriesDay`
    // returned TRUE here, because a `trading_calendar` row exists, and its
    // refusal text said "a day the calendar does not carry is a day outside
    // coverage". The row is real and the coverage is not, and nothing in the
    // schema ties them: `0032` declares no foreign key between the tables, and
    // `0048` header item 7 rules that CALENDAR-C3's retroactivity test is the
    // FOLD EXTENT and not the coverage window, so a calendar row may be inserted
    // for a day no load ever declared.
    const anchor = await anchorNamedDay(
      doorOf({
        tradingCalendar: SESSIONS,
        tradingCalendarLoads: [load('2026-08-01', '2026-12-31')],
      }).db,
      '2026-06-30' as TradingDay,
    );

    expect(anchor.kind).toBe('refused');
    if (anchor.kind === 'anchored') throw new Error('unreachable');
    expect(anchor.why).toContain('trading_calendar_loads');
    expect(anchor.why).toContain('2026-06-30');
  });

  test('3.3 a day both carried and covered anchors', async () => {
    const anchor = await anchorNamedDay(
      doorOf({
        tradingCalendar: SESSIONS,
        tradingCalendarLoads: [load('2026-06-01', '2026-12-31')],
      }).db,
      '2026-06-30' as TradingDay,
    );

    expect(anchor).toEqual({ kind: 'anchored', tradingDay: '2026-06-30' });
  });

  test('3.4 `RB-01`s re-run still works on an EXHAUSTED calendar', async () => {
    // THE FACT THE NAMED PATH DELIBERATELY DOES NOT ASK. The override exists to
    // re-run a night that failed, so the day is named precisely because it is
    // behind; demanding a session ahead of `now()` would refuse the one thing
    // the variable is for. Section 2.2's estate, answered.
    const anchor = await anchorNamedDay(
      doorOf({
        tradingCalendar: EXHAUSTED,
        tradingCalendarLoads: [load('2026-06-01', '2026-08-28')],
      }).db,
      '2026-08-28' as TradingDay,
    );

    expect(anchor).toEqual({ kind: 'anchored', tradingDay: '2026-08-28' });
  });

  test('3.5 `resolveTradingDay` refuses 3.2s estate and names the variable', async () => {
    const door = doorOf({
      tradingCalendar: SESSIONS,
      tradingCalendarLoads: [load('2026-08-01', '2026-12-31')],
    });
    const refusal = await resolveTradingDay(io(door.db, { [TRADING_DAY_VAR]: '2026-06-30' })).catch(
      (error: unknown) => error,
    );

    expect(refusal).toBeInstanceOf(WorkerJobRefusal);
    expect((refusal as WorkerJobRefusal).input).toBe(TRADING_DAY_VAR);
    expect((refusal as WorkerJobRefusal).message).toContain(TRADING_DAY_VAR);
    expect((refusal as WorkerJobRefusal).message).toContain('2026-06-30');
  });

  test('3.6 a malformed override still refuses BEFORE any read', async () => {
    // The shape guard is above both readers, so a typo opens no transaction.
    const door = doorOf({ tradingCalendar: SESSIONS, tradingCalendarLoads: [] });
    await expect(
      resolveTradingDay(io(door.db, { [TRADING_DAY_VAR]: '30-08-2026' })),
    ).rejects.toThrow(WorkerJobRefusal);

    expect(door.transactions).toHaveLength(0);
  });
});

// =============================================================================
// 4. ONE TRANSACTION, BECAUSE TWO SNAPSHOTS IS THE CROSSING THE DOOR REFUSES
// =============================================================================

describe('4. both tables are read inside one transaction', () => {
  const tables: Tables = {
    tradingCalendar: SESSIONS,
    tradingCalendarLoads: [load('2026-06-01', '2026-12-31')],
  };

  test('4.1 `anchorLastClosedDay` opens ONE and names BOTH keys inside it', async () => {
    // `WorkerDb.batch` opens a transaction per call, so two calls are two
    // snapshots; and `trading_calendar` is the one table in this estate the
    // corpus built a CORRECTION mechanism for, so a row can legitimately move
    // between them. A basis day chosen from a calendar the transaction that
    // checked coverage never read is the verdict `scoped-db.ts` refuses to
    // produce, and this job writes its answer where the payout basis lives.
    const door = doorOf(tables);
    await anchorLastClosedDay(door.db, AT);

    expect(door.transactions).toHaveLength(1);
    expect(door.transactions[0]).toEqual(['tradingCalendar', 'tradingCalendarLoads']);
  });

  test('4.2 `anchorNamedDay` does the same', async () => {
    const door = doorOf(tables);
    await anchorNamedDay(door.db, '2026-06-30' as TradingDay);

    expect(door.transactions).toHaveLength(1);
    expect(door.transactions[0]).toEqual(['tradingCalendar', 'tradingCalendarLoads']);
  });

  test('4.3 a refusal opens exactly one and no more', async () => {
    // The reads happen before either verdict, so a refusing estate costs the
    // same one transaction rather than an extra one per fact.
    const door = doorOf({ tradingCalendar: SESSIONS, tradingCalendarLoads: [] });
    await anchorLastClosedDay(door.db, AT);

    expect(door.transactions).toHaveLength(1);
  });
});

// =============================================================================
// 5. THE TYPE IS THE FENCE, AND A COUNT IS ONLY TRUE ON THE DAY IT IS MEASURED
// =============================================================================

describe('5. what makes forgetting the coverage read a compile error', () => {
  test('5.1 `tradingDay` is declared on the `anchored` arm ALONE', async () => {
    // `ADR-273` ruling 1 is a rule about TYPES and this is where it is enforced
    // for this deployable. A `tradingDay` added to the refused arm compiles
    // perfectly and silently defeats the union, which is why the shape is
    // asserted rather than assumed.
    const code = stripComments(sourceOf(ADAPTER_REL));
    const union = code.slice(code.indexOf('export type TradingDayAnchor'));
    const body = union.slice(0, union.indexOf('};') + 2);

    expect(body).toMatch(/kind:\s*'anchored';\s*readonly tradingDay: TradingDay/);
    expect(body.match(/tradingDay/g)).toHaveLength(1);
    expect(body).toMatch(/kind:\s*'refused';\s*readonly why: string/);
  });

  test('5.2 the coverage-blind fold is not exported, from the file or the barrel', async () => {
    // **THE OTHER HALF OF THE REPAIR.** `readLastClosedTradingDay` was exported
    // and re-exported, so its callers were unbounded by construction and every
    // one received a bare `TradingDay | null`. `ADR-273` section 10 named that
    // exact shape as the one a census cannot see.
    const adapter = stripComments(sourceOf(ADAPTER_REL));
    const barrel = stripComments(sourceOf(BARREL_REL));

    expect(adapter).not.toMatch(/\bexport\s+(?:async\s+)?function\s+readLastClosedTradingDay\b/);
    expect(adapter).not.toMatch(/\bexport\s+(?:async\s+)?function\s+calendarCarriesDay\b/);
    expect(adapter).toMatch(/\bfunction latestClosedSession\b/);
    expect(barrel).not.toContain('readLastClosedTradingDay');
    expect(barrel).not.toContain('calendarCarriesDay');
  });

  test('5.3 every anchor call in the caller is guarded, asserted as an EQUALITY', async () => {
    // `ADR-273`'s idiom rather than two pinned numbers: a third branch added
    // without its guard moves one count and not the other. Two pinned numbers
    // both move when somebody adds a guarded branch, and neither moves when
    // somebody adds an unguarded one.
    const code = stripComments(sourceOf(JOB_REL));
    const calls = [...code.matchAll(/await anchor(?:LastClosedDay|NamedDay)\(/g)];
    const guards = [...code.matchAll(/\.kind !== 'anchored'/g)];

    expect(calls).toHaveLength(2);
    expect(guards).toHaveLength(calls.length);
  });

  test('5.4 the caller names no table, so the coverage read has ONE statement', async () => {
    // `FM-16` is two statements of one predicate with nothing comparing them,
    // and this repair adds no fifth statement of `R-06`: the caller asks and
    // narrows, and the adapter is the only file in this deployable that names
    // either calendar table.
    const job = stripComments(sourceOf(JOB_REL));

    expect(job).not.toContain('tradingCalendarLoads');
    expect(job).not.toContain('trading_calendar_loads');
    expect(job).not.toContain("rows('tradingCalendar')");
  });
});
