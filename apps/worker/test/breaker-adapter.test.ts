// =============================================================================
// apps/worker/test/breaker-adapter.test.ts
// =============================================================================
// THE BREAKER EVALUATION'S FIRST LIVE PORTS, AND THE TWO THINGS STILL BETWEEN
// THEM AND A CLOCK. ADR-352.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE PROVES AND WHAT IT DELIBERATELY DOES NOT
// -----------------------------------------------------------------------------
// It proves that the evaluation's reads reach the accessor as the KEY it named
// and the FILTER it built, that its writes reach exactly one table and no other,
// that the clock is ONE instant and the trading day is anchored to that instant
// against the calendar rather than derived from it, and that the composed value
// a DEPLOYMENT gets writes NOTHING on the first night because its event sink
// refuses.
//
// It proves NOTHING about the predicate the real accessor composes from a
// filter, which is `packages/db/test/keyed-accessor.test.ts`'s and is the line
// `src/db.ts` draws about its own seam.
//
// -----------------------------------------------------------------------------
// THE FALSIFICATION, AND WHY THE COMMITTING CASE IS THE ONE THAT MATTERS
// -----------------------------------------------------------------------------
// Section 5 drives the REAL `evaluateBreaker` through the REAL adapter over a
// recording door, TWICE, and the pair is the point.
//
// Once on an estate where a plan CHANGES STATE, where the refusing sink must
// reject the whole run; and once on an estate where the previous row already
// carries the state the evaluation computes, where the run must COMMIT and write
// its row.
//
// **THE SECOND CASE IS THE ONE THIS SECTION EXISTS FOR.** A refusal that fired
// on every run would pass the first case for the wrong reason: it would prove
// only that the adapter is broken, not that it refuses exactly when an alert is
// owed. The committing case is what tells "refuses when a transition happens"
// apart from "never works".
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isFilterTerm } from '@merit/db';
import { describe, expect, it, test } from 'vitest';

import type { WorkerDb } from '../src/db.ts';
import {
  BreakerAdapterUnwired,
  BreakerCalendarRefused,
  BreakerTableRefused,
  UNWIRED_BREAKER_EVENT_SINK,
  postgresBreakerIo,
} from '../src/breaker/adapter.ts';
import { evaluateBreaker } from '../src/breaker/evaluate.ts';
import {
  BREAKER_READ_TABLES,
  BREAKER_WRITE_TABLES,
  BreakerDeclined,
  LOSS_RATIO_POLICY,
} from '../src/breaker/ports.ts';
import type { BreakerEvent, BreakerEventPort, BreakerTx, LossRatioPolicy } from '../src/breaker/ports.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..', 'src');
const ROOT = resolve(HERE, '..', '..', '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

/** Every `.ts` file under this deployable's `src`, by absolute path. */
function sources(dir: string = SRC): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sources(path));
    else if (entry.name.endsWith('.ts')) found.push(path);
  }
  return found.sort();
}

const relToSrc = (path: string): string => relative(SRC, path).split('\\').join('/');

// -----------------------------------------------------------------------------
// The door, substituted, so the adapter is exercised with no DATABASE_URL
// -----------------------------------------------------------------------------
// `test/db.test.ts` establishes this seam and this file spends it: the recorder
// below is a `SystemTx` in the methods the adapter is allowed to reach and
// THROWS BY NAME on every other member, so a leg of the adapter that reached for
// `lockAt`, `updateAt`, `deleteAt` or `sqlExecutor` fails here by name rather
// than by a type nobody re-reads.
//
// `rows` is NOT refused, because `anchorLastClosedDay` reads the calendar
// through it and this adapter's factory calls that on the way to a value.

type Row = Record<string, unknown>;
type Tables = Readonly<Record<string, readonly Row[]>>;

interface Recorder {
  readonly db: WorkerDb;
  readonly reads: { table: string; where: Row }[];
  readonly writes: { table: string; values: Row }[];
  readonly transactions: () => number;
}

/** The filter honoured, including the terms `packages/db` minted. */
function matches(row: Row, where: Row): boolean {
  for (const [column, expected] of Object.entries(where)) {
    const actual = row[column];
    if (isFilterTerm(expected)) {
      const term = expected as unknown as { term: string; value: unknown };
      if (term.term === 'is-null') {
        if (actual !== null && actual !== undefined) return false;
        continue;
      }
      const bound = term.value;
      if (!(actual instanceof Date) || !(bound instanceof Date)) return false;
      if (term.term === 'at-least' && actual.getTime() < bound.getTime()) return false;
      if (term.term === 'at-most' && actual.getTime() > bound.getTime()) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

function recorder(tables: Tables = {}): Recorder {
  const reads: { table: string; where: Row }[] = [];
  const writes: { table: string; values: Row }[] = [];
  let opened = 0;
  let seq = 0;
  const of = (key: string): readonly Row[] => tables[key] ?? [];
  const refuse = (method: string) => (): never => {
    throw new Error(`the breaker adapter reached for SystemTx.${method}, which BreakerTx omits`);
  };
  const db: WorkerDb = {
    batch<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      opened += 1;
      return fn({
        __brand: 'SystemTx',
        reason: 'nightly-batch',
        // NOT REFUSED: the calendar anchor reads through `rows`.
        rows: (key: string) => Promise.resolve([...of(key)]),
        rowAt: refuse('rowAt'),
        lockAt: refuse('lockAt'),
        updateAt: refuse('updateAt'),
        deleteAt: refuse('deleteAt'),
        sqlExecutor: refuse('sqlExecutor'),
        rowsWhere: (table: string, where: Row) => {
          reads.push({ table, where });
          return Promise.resolve(of(table).filter((row) => matches(row, where)));
        },
        insert: (table: string, values: Row) => {
          seq += 1;
          const row = { ...values, id: `row-${String(seq)}` };
          writes.push({ table, values: row });
          return Promise.resolve([row]);
        },
      } as never);
    },
  };
  return { db, reads, writes, transactions: () => opened };
}

// -----------------------------------------------------------------------------
// The calendar this suite anchors against
// -----------------------------------------------------------------------------
// The row shapes are `trading-day-coverage.test.ts`'s, in the property names
// `packages/db/src/schema.ts` declares.

function session(day: string, closeAt: string): Row {
  return {
    tradingDay: day,
    isHalfDay: false,
    isHoliday: false,
    halted: false,
    sessionCloseAt: new Date(closeAt),
  };
}

function load(from: string, to: string): Row {
  return { coverageStartDay: from, coverageEndDay: to };
}

/** The instant every case in this file anchors to, unless it says otherwise. */
const AT = new Date('2026-08-30T12:00:00.000Z');

/** The day `AT` anchors to: the last session closed at or before it. */
const ANCHORED_DAY = '2026-08-28';

const CALENDAR: readonly Row[] = [
  session('2026-08-27', '2026-08-27T20:00:00.000Z'),
  session('2026-08-28', '2026-08-28T20:00:00.000Z'),
  session('2026-08-31', '2026-08-31T20:00:00.000Z'),
];

const COVERAGE: readonly Row[] = [load('2026-06-01', '2026-12-31')];

const CALENDAR_TABLES: Tables = { tradingCalendar: CALENDAR, tradingCalendarLoads: COVERAGE };

/** An estate with one active plan, its version, its fees and one settled payout. */
const IN_WINDOW = new Date('2026-08-20T00:00:00.000Z');

function estate(extra: Tables = {}): Tables {
  return {
    ...CALENDAR_TABLES,
    plans: [{ id: 'plan-1', code: 'CORE-25K', isActive: true }],
    planVersions: [{ id: 'ver-1', planId: 'plan-1' }],
    purchases: Array.from({ length: 25 }, (_unused, index) => ({
      id: `p-${String(index)}`,
      planVersionId: 'ver-1',
      status: 'paid',
      paidAt: IN_WINDOW,
      amountPaidCents: 9_900n,
    })),
    payoutRequests: [
      {
        id: 'r-1',
        planVersionId: 'ver-1',
        status: 'settled',
        settledAt: IN_WINDOW,
        approvedCents: 10_000n,
      },
    ],
    planBreakerState: [],
    ...extra,
  };
}

/**
 * A policy with the `OQ-M6-02` term supplied BY THIS SUITE and by nobody else.
 *
 * `breaker.test.ts` mints the same fixture for the same reason and the reason is
 * worth repeating here: `OQ-M6-02` is unanswered, `LOSS_RATIO_POLICY.minSample`
 * is `unstated`, and NO NUMBER IN THIS FILE IS THE CORPUS. It exists so the
 * cases below can reach the transaction at all, and section 6 asserts that the
 * shipped default still declines.
 */
function policyWith(minSample: number): LossRatioPolicy {
  return {
    ...LOSS_RATIO_POLICY,
    minSample: {
      state: 'stated',
      value: minSample,
      cite: 'this suite',
      quote: 'A FIXTURE VALUE. OQ-M6-02 is unanswered and no number here is the corpus.',
    },
  };
}

/** A sink that records instead of refusing, for the committing case only. */
function recordingSink(): { port: BreakerEventPort; events: BreakerEvent[] } {
  const events: BreakerEvent[] = [];
  return {
    events,
    port: {
      emit: (_tx: BreakerTx, event: BreakerEvent) => {
        events.push(event);
        return Promise.resolve();
      },
    },
  };
}

// =============================================================================
// 1. Four of five members are served, and the fifth refuses by name
// =============================================================================

describe('1. the composed default serves four members and refuses the fifth', () => {
  it('1.1 answers transact, terms, now and tradingDayOf', async () => {
    const rec = recorder(CALENDAR_TABLES);
    const io = await postgresBreakerIo(rec.db, AT);

    expect(io.now().getTime()).toBe(AT.getTime());
    expect(io.tradingDayOf(io.now())).toBe(ANCHORED_DAY);
    // THE ACCESSOR'S OWN CONSTRUCTORS AND NOT A COPY. A term is a term only if
    // `packages/db` minted it, so a wrapper that rebuilt the object would hand
    // back something the accessor refuses and `isFilterTerm` is what sees it.
    expect(isFilterTerm(io.terms.atLeast(IN_WINDOW))).toBe(true);
    expect(isFilterTerm(io.terms.atMost(IN_WINDOW))).toBe(true);
    await expect(io.transact(() => Promise.resolve('ran'))).resolves.toBe('ran');
  });

  it('1.2 refuses `events.emit` with the blocker named rather than returning', async () => {
    const rec = recorder(CALENDAR_TABLES);
    const io = await postgresBreakerIo(rec.db, AT);
    await expect(
      io.events.emit(null as never, null as never),
    ).rejects.toThrow(BreakerAdapterUnwired);
    // THE BLOCKER IS IN THE MESSAGE, because "not wired" is the answer that
    // sends the next session looking for a file that was never missing.
    await expect(io.events.emit(null as never, null as never)).rejects.toThrow(/RI-04/);
    await expect(io.events.emit(null as never, null as never)).rejects.toThrow(/node-linker=isolated/);
    // AND THE EXPORTED DEFAULT IS THE SAME REFUSAL, so a caller that named it
    // directly gets the same sentence.
    await expect(
      UNWIRED_BREAKER_EVENT_SINK.emit(null as never, null as never),
    ).rejects.toThrow(BreakerAdapterUnwired);
  });
});

// =============================================================================
// 2. The boundary: the one cast in this file, checked from both sides
// =============================================================================

describe('2. the table unions are closed at the boundary', () => {
  it('2.1 passes every declared read and write table through', async () => {
    const rec = recorder(CALENDAR_TABLES);
    const io = await postgresBreakerIo(rec.db, AT);
    await io.transact(async (tx) => {
      for (const table of BREAKER_READ_TABLES) await tx.rowsWhere(table, { id: 'x' });
      for (const table of BREAKER_WRITE_TABLES) await tx.insert(table, { id: 'x' });
      return null;
    });
    expect(rec.reads.map((r) => r.table)).toEqual([...BREAKER_READ_TABLES]);
    expect(rec.writes.map((w) => w.table)).toEqual([...BREAKER_WRITE_TABLES]);
  });

  it('2.2 refuses a payout table on the WRITE leg, which is INV-M5-12', async () => {
    const rec = recorder(CALENDAR_TABLES);
    const io = await postgresBreakerIo(rec.db, AT);
    // **THE WRITE UNION HAS EXACTLY ONE MEMBER AND A PAYOUT IS NOT IT.** The
    // breaker pauses SALES; a trader who has earned money is paid while Merit
    // has stopped selling, and after this refusal that is a property of what the
    // evaluation can NAME.
    await expect(
      io.transact(async (tx) => tx.insert('payoutRequests' as never, { id: 'x' })),
    ).rejects.toThrow(BreakerTableRefused);
    // `payoutRequests` IS READABLE AND IS NOT WRITABLE, and the asymmetry is the
    // ruling: settled payouts are `P-M6-05`'s numerator, so the evaluation reads
    // them and can never touch one.
    expect(BREAKER_READ_TABLES).toContain('payoutRequests');
    // And a table in neither union is refused on both legs.
    await expect(
      io.transact(async (tx) => tx.rowsWhere('wallets' as never, { id: 'x' })),
    ).rejects.toThrow(BreakerTableRefused);
    await expect(
      io.transact(async (tx) => tx.insert('wallets' as never, { id: 'x' })),
    ).rejects.toThrow(BreakerTableRefused);
    // AND NOTHING REACHED THE DOOR. A refusal that happened after the write is
    // not a refusal.
    expect(rec.writes).toEqual([]);
    expect(rec.reads).toEqual([]);
  });
});

// =============================================================================
// 3. ONE instant, and a trading day anchored to it rather than derived from it
// =============================================================================

describe('3. the clock is pinned and the day is read from the calendar', () => {
  it('3.1 returns the same instant every time it is asked', async () => {
    const rec = recorder(CALENDAR_TABLES);
    const io = await postgresBreakerIo(rec.db, AT);
    expect(io.now().getTime()).toBe(io.now().getTime());
    expect(io.now().getTime()).toBe(AT.getTime());
  });

  it('3.2 hands back a fresh Date, so a caller cannot move the anchor', async () => {
    const rec = recorder(CALENDAR_TABLES);
    const io = await postgresBreakerIo(rec.db, AT);
    const first = io.now();
    first.setUTCFullYear(1999);
    // THE MUTATION DID NOT LAND ON THE ANCHOR. `Date` is mutable and an
    // evaluation that mutated the value it was given would otherwise move the
    // instant its day was anchored to, silently.
    expect(io.now().getTime()).toBe(AT.getTime());
    expect(io.tradingDayOf(io.now())).toBe(ANCHORED_DAY);
  });

  it('3.3 REFUSES an instant it did not anchor rather than ignoring its argument', async () => {
    const rec = recorder(CALENDAR_TABLES);
    const io = await postgresBreakerIo(rec.db, AT);
    // A closure that returned its one day for every input would be a function
    // whose parameter is a lie, and a caller passing a different instant would
    // receive a day anchored to something else with nothing to see it.
    expect(() => io.tradingDayOf(new Date('2026-09-04T12:00:00.000Z'))).toThrow(
      BreakerCalendarRefused,
    );
  });

  it('3.4 reads the day off the calendar and never off the clock', async () => {
    // `AT` IS 2026-08-30 AND THE ANSWER IS 2026-08-28. A job deriving a day from
    // a UTC instant would return the 30th, which is `ADR-146` clause 4's
    // forbidden move and is exactly what this assertion is here to catch.
    const rec = recorder(CALENDAR_TABLES);
    const io = await postgresBreakerIo(rec.db, AT);
    expect(io.tradingDayOf(io.now())).toBe('2026-08-28');
    expect(io.tradingDayOf(io.now())).not.toBe('2026-08-30');
  });

  it('3.5 refuses to build at all when the calendar cannot name a day', async () => {
    // AN EMPTY CALENDAR IS NOT AN UNBROKEN HOLIDAY (`ADR-042` F-4). The factory
    // rejects rather than handing back a value whose `tradingDayOf` invents one.
    await expect(
      postgresBreakerIo(recorder({ tradingCalendar: [], tradingCalendarLoads: [] }).db, AT),
    ).rejects.toThrow(BreakerCalendarRefused);
  });

  it('3.6 refuses a day the coverage table never declared', async () => {
    // `ADR-277`: a day without a coverage verdict is not a day. A calendar
    // loaded through June and read in August folds June's day and stamps it.
    await expect(
      postgresBreakerIo(
        recorder({ tradingCalendar: CALENDAR, tradingCalendarLoads: [load('2026-06-01', '2026-06-30')] }).db,
        AT,
      ),
    ).rejects.toThrow(BreakerCalendarRefused);
  });
});

// =============================================================================
// 4. The seam, and the one value it must never be handed
// =============================================================================

test('4.1 no module under src passes a sink to postgresBreakerIo', () => {
  // **A NO-OP SINK PASSED THERE WOULD BE THE WORST VALUE IN THE FILE**: every
  // evaluation would commit, every `breaker.state_changed` alert would be
  // dropped, and a plan whose sales had just been paused would have paused them
  // with nobody told. The seam exists so THIS suite can drive the committing
  // case; a `src/` caller using it would be the silent failure it was built to
  // make impossible.
  const callers = sources()
    .filter((path) => relToSrc(path) !== 'breaker/adapter.ts')
    .filter((path) => /postgresBreakerIo\s*\([^)]*,[^)]*,/.test(readFileSync(path, 'utf8')))
    .map(relToSrc);
  expect(callers).toEqual([]);
});

// =============================================================================
// 5. THE FALSIFICATION: the real evaluator, the real adapter, both directions
// =============================================================================

describe('5. a deployment holding the composed default', () => {
  it('5.1 writes NOTHING on the first night, because every plan changes state', async () => {
    const rec = recorder(estate());
    const io = await postgresBreakerIo(rec.db, AT);

    // ONE TRANSACTION FOR THE WHOLE RUN AND NOTHING CATCHES. A single refused
    // emit rolls back every row the run had written, and `evaluateBreaker`
    // rejects rather than reporting a partial success.
    await expect(evaluateBreaker(io, policyWith(20))).rejects.toThrow(BreakerAdapterUnwired);

    // THE ROLLBACK IS THE POINT. The insert reached the recorder, because the
    // recorder is not a database and cannot roll back; a real transaction would
    // have discarded it. Both facts are asserted so a reader cannot mistake the
    // recorder's memory for a commit.
    expect(rec.writes.map((w) => w.table)).toEqual(['planBreakerState']);
  });

  it('5.2 emits on the FIRST evaluation because from_state is null, not armed', async () => {
    // `stateChangedEvent` returns `null` only when `previousState === state`.
    // On a plan's first evaluation `previousState` is `null` and `state` never
    // is, so the event is built and the refusal fires. This is why 5.1 loses the
    // whole first night rather than only the nights a transition happens.
    const rec = recorder(estate());
    const sink = recordingSink();
    const io = await postgresBreakerIo(rec.db, AT, sink.port);
    await evaluateBreaker(io, policyWith(20));
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]?.payload.from_state).toBeNull();
    expect(sink.events[0]?.name).toBe('breaker.state_changed');
  });

  it('5.3 COMMITS when no plan changes state, so the refusal is not universal', async () => {
    // **THIS IS THE CASE THE SECTION EXISTS FOR.** An adapter that refused on
    // every run would pass 5.1 for the wrong reason. Here the previous row
    // already carries the state the evaluation computes, `stateChangedEvent`
    // returns `null`, `io.events.emit` is never called, and the run commits its
    // row through the refusing sink untouched.
    const rec = recorder(
      estate({
        planBreakerState: [
          {
            planId: 'plan-1',
            evaluatedOn: '2026-08-27',
            state: 'armed',
            overrideReason: null,
            overrideExpiresAt: null,
            changedBy: null,
          },
        ],
      }),
    );
    const io = await postgresBreakerIo(rec.db, AT);
    const report = await evaluateBreaker(io, policyWith(20));

    expect(report.eventsEmitted).toBe(0);
    expect(report.rowsWritten).toBe(1);
    expect(report.evaluatedOn).toBe(ANCHORED_DAY);
    expect(report.decisions[0]?.state).toBe('armed');
    expect(report.decisions[0]?.previousState).toBe('armed');
    expect(rec.writes.map((w) => w.table)).toEqual(['planBreakerState']);
  });
});

// =============================================================================
// 6. The adapter is not the only blocker, and the other two are asserted
// =============================================================================

describe('6. what this adapter does NOT discharge', () => {
  it('6.1 the shipped policy still declines, without opening a transaction', async () => {
    const rec = recorder(estate());
    const io = await postgresBreakerIo(rec.db, AT);
    const openedByTheFactory = rec.transactions();

    // `resolvePolicy` RUNS BEFORE `io.now()` AND BEFORE `io.transact`, so the
    // decline costs no unit of work at all. `OQ-M6-02` is the founder's and is
    // unanswered, and a breaker running on an invented floor is `AS-M6-02`
    // produced deliberately.
    await expect(evaluateBreaker(io)).rejects.toThrow(BreakerDeclined);
    expect(rec.transactions()).toBe(openedByTheFactory);
    expect(rec.writes).toEqual([]);
    expect(LOSS_RATIO_POLICY.minSample.state).toBe('unstated');
    expect(LOSS_RATIO_POLICY.minSample.value).toBeNull();
  });

  it('6.2 the event name this code emits is in NO catalogue and NO registry row', () => {
    // **THE DIVERGENCE, PINNED AS AN ASSERTION RATHER THAN ONLY AS PROSE.**
    // ADR-352 section 5 names it and does not rule it.
    const catalogue = read('apps/api/src/events.ts');
    const body = catalogue.slice(catalogue.indexOf('export const EVENT_CATALOGUE'));
    const names = [...body.matchAll(/^ {2}'([a-z_]+\.[a-z_]+)':/gm)].map((m) => m[1]);
    // TEN, DERIVED AT THE MOMENT THIS RUNS rather than carried from a prior run.
    expect(names).toHaveLength(10);
    expect(names.filter((name) => name.startsWith('breaker.'))).toEqual([]);

    // AND THE REGISTRY CARRIES A DIFFERENT PAIR UNDER A DIFFERENT NAME.
    const events = read('docs/architecture/EVENTS.md');
    expect(events).toContain('`circuit_breaker.tripped`');
    expect(events).toContain('`circuit_breaker.reset`');
    expect(events).not.toContain('`breaker.state_changed`');

    // WHILE THE MODULE PLAN CARRIES THE NAME THE CODE EMITS, MARKED NEW.
    const m06 = read('docs/plans/M06-admin-ops-console.md');
    expect(m06).toContain('`breaker.state_changed` **NEW**');
  });

  it('6.3 the primary key and a plain insert disagree with a DAILY cadence', () => {
    // **THE THIRD BLOCKER, MEASURED HERE AND RULED NOWHERE.** `evaluated_on`
    // carries the LAST CLOSED trading day; `CRON_INVENTORY` schedules this job
    // DAILY. Those cadences disagree on every non-session day, and the primary
    // key makes the disagreement fatal rather than idempotent.
    const migration = read('packages/db/migrations/0016_treasury_controls.sql');
    expect(migration).toContain('PRIMARY KEY (plan_id, evaluated_on)');

    // AND THE PORT PUBLISHES NO UPSERT, so a second run on the same anchored day
    // is refused by Postgres rather than absorbed.
    const ports = read('apps/worker/src/breaker/ports.ts');
    expect(ports).toContain('insert(key: BreakerWriteTable, values: BreakerValues)');
    expect(ports).not.toContain('onConflict');
    expect(ports).not.toContain('upsert');

    // The cadence is the corpus's and is not invented here.
    const cron = read('docs/ops/runbooks/CRON_INVENTORY.md');
    expect(cron).toContain('**Plan breaker evaluation**');
  });
});
