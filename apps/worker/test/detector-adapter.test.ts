// =============================================================================
// apps/worker/test/detector-adapter.test.ts
// =============================================================================
// THE DETECTOR RUNNER'S FIRST LIVE PORTS, AND THE ONE THAT STILL REFUSES.
// ADR-349.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE PROVES AND WHAT IT DELIBERATELY DOES NOT
// -----------------------------------------------------------------------------
// It proves that a detector's declared window reaches the accessor as the KEY it
// named and the FILTER it built, that a detector's findings reach the accessor
// as inserts on the three tables `DETECTOR_WRITE_TABLES` admits and no other,
// that the nonce is fresh per run, and that the composed value a DEPLOYMENT gets
// records nothing because its event sink refuses.
//
// It proves NOTHING about the predicate the real accessor composes from a
// filter, which is `packages/db/test/keyed-accessor.test.ts`'s and is the line
// `src/db.ts` draws about its own seam: "a case here that claimed it would be
// agreeing with its own fake".
//
// -----------------------------------------------------------------------------
// THE FALSIFICATION, AND WHY THE SILENT CASE IS THE ONE THAT MATTERS
// -----------------------------------------------------------------------------
// Section 5 drives the REAL `D-01` detector through the REAL adapter over a
// recording door, twice. Once on data carrying the pattern `M07:108` describes,
// where a `risk_flags` row must be written; and once on data that carries no
// pattern at all, where NOTHING but the run row and the canary's own flag may be
// written.
//
// **THE SECOND CASE IS THE ONE THIS SECTION EXISTS FOR.** A detector that fires
// on clean data restricts a trader who did nothing, and `severity` 4 and 5 is
// the band `G-HOLD-REQUIRED` reads to hold a payout for 48 hours under
// `ADR-040`. A firing case that passes over a detector that fires on everything
// passes for the wrong reason; the silent case is what tells them apart.
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isFilterTerm } from '@merit/db';
import { describe, expect, it, test } from 'vitest';

import { stripComments } from '../../../packages/tooling/checks/strip-comments.mjs';
import type { WorkerDb } from '../src/db.ts';
import {
  DetectorAdapterUnwired,
  DetectorTableRefused,
  UNWIRED_DETECTOR_EVENT_SINK,
  postgresDetectorNonce,
  postgresDetectorRunnerIo,
} from '../src/detectors/adapter.ts';
import { canaryNonce, isCanaryId } from '../src/detectors/canary.ts';
import { fillClusteringNightly } from '../src/detectors/fills.ts';
import { DETECTOR_READ_TABLES, DETECTOR_WRITE_TABLES } from '../src/detectors/ports.ts';
import type {
  DetectorEvent,
  DetectorEventPort,
  DetectorRow,
  DetectorTx,
} from '../src/detectors/ports.ts';
import { runDetectors } from '../src/detectors/runner.ts';
import type { DetectorRunReport } from '../src/detectors/runner.ts';

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
// The door, substituted, so an adapter is exercised with no DATABASE_URL
// -----------------------------------------------------------------------------
// `test/db.test.ts` establishes this seam and this file spends it: the recorder
// below is a `SystemTx` in the two methods `DetectorTx` narrows to and THROWS on
// every other member, so a leg of the adapter that reached for `lockAt`,
// `updateAt`, `deleteAt`, `rowAt` or `sqlExecutor` fails here by name rather
// than by a type nobody re-reads.

interface Recorded {
  readonly table: string;
  readonly values: Record<string, unknown>;
}

interface Recorder {
  readonly db: WorkerDb;
  /** Every `rowsWhere` that crossed to the accessor, in order. */
  readonly reads: { table: string; where: Record<string, unknown> }[];
  /** Every `insert` that crossed, in order. Committed and staged alike. */
  readonly writes: Recorded[];
  /** How many units of work the adapter opened. */
  readonly transactions: () => number;
}

function recorder(rows: Readonly<Record<string, readonly DetectorRow[]>> = {}): Recorder {
  const reads: { table: string; where: Record<string, unknown> }[] = [];
  const writes: Recorded[] = [];
  let opened = 0;
  let seq = 0;
  const refuse = (method: string) => (): never => {
    throw new Error(`the detector adapter reached for SystemTx.${method}, which DetectorTx omits`);
  };
  const db: WorkerDb = {
    batch<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      opened += 1;
      return fn({
        __brand: 'SystemTx',
        reason: 'nightly-batch',
        rows: refuse('rows'),
        rowAt: refuse('rowAt'),
        lockAt: refuse('lockAt'),
        updateAt: refuse('updateAt'),
        deleteAt: refuse('deleteAt'),
        sqlExecutor: refuse('sqlExecutor'),
        rowsWhere: (table: string, where: Record<string, unknown>) => {
          reads.push({ table, where });
          return Promise.resolve([...(rows[table] ?? [])]);
        },
        insert: (table: string, values: Record<string, unknown>) => {
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

/** A sink that records, which is the one port a deployment may not have. */
function recordingSink(): { port: DetectorEventPort; events: DetectorEvent[] } {
  const events: DetectorEvent[] = [];
  return {
    port: {
      emit: (_tx: DetectorTx, event: DetectorEvent) => {
        events.push(event);
        return Promise.resolve();
      },
    },
    events,
  };
}

const TRADING_DAY = '2026-02-10';
const stated = (value: unknown): Record<string, unknown> => ({ state: 'stated', value });

/** `D-01`'s registry row, with both numbers stated, as `P7-d`'s seed does not. */
const D01_DEFINITION: Record<string, unknown> = {
  detector: 'D-01',
  version: 'v1',
  parameters: { window_seconds: stated(2), min_shared_fill_share_bp: stated(5000) },
  isSensitive: true,
  effectiveTo: null,
};

// =============================================================================
// 1. Five members, four of them served
// =============================================================================

describe('the composed value serves four ports and refuses the fifth', () => {
  it('declares exactly the five members DetectorRunnerIo names', () => {
    const io = postgresDetectorRunnerIo(recorder().db);
    expect(Object.keys(io).sort()).toEqual(['events', 'nonce', 'now', 'terms', 'transact']);
  });

  it('serves transact, terms, now and nonce', async () => {
    const rec = recorder({ fills: [] });
    const io = postgresDetectorRunnerIo(rec.db);

    await io.transact(async (tx) => tx.rowsWhere('fills', { tradingDay: TRADING_DAY }));
    expect(rec.reads).toEqual([{ table: 'fills', where: { tradingDay: TRADING_DAY } }]);
    expect(io.now()).toBeInstanceOf(Date);
    expect(io.nonce().length).toBeGreaterThan(8);
    // THE TERMS ARE THE ACCESSOR'S OWN MINT AND NOT A LOOKALIKE. `isFilterTerm`
    // reads WeakSet membership rather than shape, so this is the assertion a
    // hand-rolled `{term: 'at-least'}` cannot pass: it would be a jsonb VALUE to
    // the accessor and would narrow nothing.
    expect(isFilterTerm(io.terms.atLeast(1))).toBe(true);
    expect(isFilterTerm(io.terms.atMost(1))).toBe(true);
    expect(isFilterTerm(io.terms.isNull())).toBe(true);
  });

  it('refuses the event sink by default, and names all three blockers', async () => {
    const io = postgresDetectorRunnerIo(recorder().db);
    expect(io.events).toBe(UNWIRED_DETECTOR_EVENT_SINK);
    await expect(
      io.events.emit({} as DetectorTx, { name: 'detector.run_completed', payload: {} }),
    ).rejects.toThrow(DetectorAdapterUnwired);

    const why = await io.events
      .emit({} as DetectorTx, { name: 'detector.run_completed', payload: {} })
      .catch((error: unknown) => (error as Error).message);
    expect(why).toContain('RI-04');
    expect(why).toContain('detector.run_degraded');
    expect(why).toContain('detector_run_id');
  });
});

// =============================================================================
// 2. THE FINDING: the composed default records NOTHING, and says so
// =============================================================================
// **THIS IS THE CASE THE ROW WAS DISPATCHED TO WRITE AND IT PASSES BY FAILING.**
// `runner.ts` calls `emitRunEvents` inside the write transaction and calls it
// unconditionally, so the refusal above rolls back the `detector_runs` row that
// was inserted three statements earlier. A deployment holding
// `postgresDetectorRunnerIo(LIVE_DB)` therefore writes no run row at all, which
// is why ADR-349 rules the job still unscheduled.

test('a deployment holding the composed default writes no detector_runs row', async () => {
  const rec = recorder({ fills: [], accounts: [], detectorDefinitions: [D01_DEFINITION] });
  const report = await runDetectors(
    [fillClusteringNightly],
    { tradingDay: TRADING_DAY },
    postgresDetectorRunnerIo(rec.db),
  );

  expect(report.unrecorded).toEqual(['D-01']);
  expect(report.outcomes[0]?.recorded).toBe(false);
  expect(report.outcomes[0]?.error).toContain('DetectorAdapterUnwired');
  // THE ROLLBACK IS THE POINT. The insert reached the recorder, because the
  // recorder is not a database and cannot roll back; what the runner reports is
  // `recorded: false`, and a real transaction would have discarded every row
  // below. Both facts are asserted so a reader cannot mistake the recorder's
  // memory for a commit.
  expect(rec.writes.map((w) => w.table)).toContain('detectorRuns');
  expect(report.outcomes[0]?.flagsRaised).toBe(0);
});

// =============================================================================
// 3. The boundary: the one cast in this deployable, checked from both sides
// =============================================================================

describe('the table unions are closed at the boundary', () => {
  it('passes every declared read and write table through', async () => {
    const rec = recorder();
    const io = postgresDetectorRunnerIo(rec.db);
    await io.transact(async (tx) => {
      for (const table of DETECTOR_READ_TABLES) await tx.rowsWhere(table, { id: 'x' });
      for (const table of DETECTOR_WRITE_TABLES) await tx.insert(table, { id: 'x' });
      return null;
    });
    expect(rec.reads.map((r) => r.table)).toEqual([...DETECTOR_READ_TABLES]);
    expect(rec.writes.map((w) => w.table)).toEqual([...DETECTOR_WRITE_TABLES]);
  });

  it('refuses a table outside the union rather than casting it into the accessor', async () => {
    const rec = recorder();
    const io = postgresDetectorRunnerIo(rec.db);
    // `risk_flags` IS WRITABLE AND IS NOT READABLE, and the asymmetry is the
    // ruling rather than an oversight: a detector that could read the flags
    // another detector raised would be corroborating itself, and `AS-M7-03`
    // clause 3 puts corroboration in the QUEUE'S ordering, one deployable over.
    await expect(
      io.transact(async (tx) => tx.rowsWhere('riskFlags' as never, { id: 'x' })),
    ).rejects.toThrow(DetectorTableRefused);
    // `identity_links` IS READABLE AND IS NOT WRITABLE, which is the same
    // asymmetry running the other way: a link written by this runner would be a
    // graph edge with a detector run as its author (`ADR-155`, `P7-h`).
    expect(DETECTOR_READ_TABLES).toContain('identityLinks');
    await expect(
      io.transact(async (tx) => tx.insert('identityLinks' as never, { id: 'x' })),
    ).rejects.toThrow(DetectorTableRefused);
    // And a table in neither union is refused on both legs.
    await expect(
      io.transact(async (tx) => tx.rowsWhere('adminActions' as never, { id: 'x' })),
    ).rejects.toThrow(DetectorTableRefused);
    // AND NOTHING REACHED THE DOOR. A refusal that happened after the write is
    // not a refusal.
    expect(rec.writes).toEqual([]);
    expect(rec.reads).toEqual([]);
  });

  it('reaches for no SystemTx member DetectorTx omits', async () => {
    const rec = recorder({ fills: [], accounts: [], detectorDefinitions: [D01_DEFINITION] });
    const sink = recordingSink();
    const report = await runDetectors(
      [fillClusteringNightly],
      { tradingDay: TRADING_DAY },
      postgresDetectorRunnerIo(rec.db, sink.port),
    );
    // The recorder throws by name on `rows`, `rowAt`, `lockAt`, `updateAt`,
    // `deleteAt` and `sqlExecutor`, so a clean run is the assertion.
    expect(report.outcomes[0]?.error).toBeUndefined();
    expect(report.outcomes[0]?.recorded).toBe(true);
  });
});

// =============================================================================
// 4. The nonce, whose freshness is the adapter's own promise
// =============================================================================

describe('the nonce', () => {
  it('is accepted by the identifier grammar and is disjoint across runs', () => {
    const first = postgresDetectorNonce();
    const second = postgresDetectorNonce();
    expect(first).not.toBe(second);
    // `canaryNonce` is the only producer and it refuses a short value or one
    // carrying an identifier separator. Round-tripping proves the adapter's
    // source satisfies it rather than casting past it.
    expect(canaryNonce(first)).toBe(first);
    expect(first).not.toContain(':');
    expect(first).not.toContain('#');
    expect(first.length).toBeGreaterThanOrEqual(8);
  });

  it('gives two runs of one detector two batteries', async () => {
    const runOnce = async (): Promise<DetectorRunReport> => {
      const rec = recorder({ fills: [], accounts: [], detectorDefinitions: [D01_DEFINITION] });
      const sink = recordingSink();
      return await runDetectors(
        [fillClusteringNightly],
        { tradingDay: TRADING_DAY },
        postgresDetectorRunnerIo(rec.db, sink.port),
      );
    };
    const [a, b] = [await runOnce(), await runOnce()];
    // AS-M7-05 note 2: a static battery lets a detector that memorized it pass
    // while broken. The runner cannot see a repeated nonce from inside one run,
    // so this is the adapter's assertion to carry.
    expect(a.nonce).not.toBe(b.nonce);
  });
});

// =============================================================================
// 5. THE FALSIFICATION: it fires on the pattern and it is SILENT on clean data
// =============================================================================

interface Fired {
  readonly report: DetectorRunReport;
  readonly rec: Recorder;
  readonly events: DetectorEvent[];
  /** `risk_flags` rows, minus the canary's own. */
  readonly realFlags: Record<string, unknown>[];
}

const CLUSTER_AT = Date.parse('2026-02-10T15:30:00.000Z');

/**
 * `n` fills for each of two accounts, at the same instant, one symbol, one side.
 *
 * `M07:108` is the pattern: more than a configured share of one account's fills
 * within `window_seconds` of another account's, on the same symbol and side.
 * With `shared` at 4 and no extras the share is 10000bp against a 5000bp floor.
 */
function clusteredFills(shared: number, extras: number): DetectorRow[] {
  const fills: DetectorRow[] = [];
  for (let n = 0; n < shared; n += 1) {
    const at = CLUSTER_AT + n * 10_000;
    for (const account of ['acc-a', 'acc-b']) {
      fills.push({
        id: `f-${account}-${String(n)}`,
        accountId: account,
        symbol: 'ESH6',
        side: 'buy',
        quantity: 2,
        executedAt: new Date(at),
        tradingDay: TRADING_DAY,
      });
    }
  }
  // THE EXTRAS SIT HOURS AWAY, so they enlarge the DENOMINATOR and not the
  // numerator. That is the only way to move the share one fill at a time.
  for (let n = 0; n < extras; n += 1) {
    for (const [account, hours] of [
      ['acc-a', 1],
      ['acc-b', 2],
    ] as const) {
      fills.push({
        id: `f-${account}-x${String(n)}`,
        accountId: account,
        symbol: 'ESH6',
        side: 'buy',
        quantity: 2,
        executedAt: new Date(CLUSTER_AT + hours * 3_600_000 + n * 10_000),
        tradingDay: TRADING_DAY,
      });
    }
  }
  return fills;
}

const TWO_ACCOUNTS: DetectorRow[] = [
  { id: 'acc-a', identityId: 'id-a', phase: 'eval', openedOn: '2026-01-02' },
  { id: 'acc-b', identityId: 'id-b', phase: 'eval', openedOn: '2026-01-02' },
];

async function runD01(fills: DetectorRow[]): Promise<Fired> {
  const rec = recorder({
    fills,
    accounts: TWO_ACCOUNTS,
    detectorDefinitions: [D01_DEFINITION],
  });
  const sink = recordingSink();
  const report = await runDetectors(
    [fillClusteringNightly],
    { tradingDay: TRADING_DAY },
    // THE SINK IS THE SUITE'S AND THE OTHER FOUR PORTS ARE THE ADAPTER'S. That
    // split is the whole reason the second parameter exists, and section 6
    // asserts that no module under `src/` uses it.
    postgresDetectorRunnerIo(rec.db, sink.port),
  );
  const flags = rec.writes.filter((w) => w.table === 'riskFlags').map((w) => w.values);
  return {
    report,
    rec,
    events: sink.events,
    // THE CANARY'S OWN FLAG IS NOT A FINDING ABOUT A TRADER. `runner.ts`
    // partitions synthetic subjects out of the real findings and only the real
    // ones reach `risk_flags`, so a canary identifier appearing here would be a
    // leak rather than a detection.
    realFlags: flags.filter((flag) => !isCanaryId(flag['identityId'])),
  };
}

describe('the real D-01 detector, driven through the real adapter', () => {
  it('FIRES on the pattern M07:108 describes', async () => {
    const fired = await runD01(clusteredFills(4, 0));

    expect(fired.report.outcomes[0]?.status).toBe('ok');
    expect(fired.report.outcomes[0]?.recorded).toBe(true);
    // **TWO FLAGS AND NOT ONE, AND THE PAIR IS THE FINDING RATHER THAN A
    // DUPLICATE.** `INV-M7-01` attaches a flag to a HUMAN, and a copy cluster is
    // an accusation about a RELATIONSHIP: both sides of the pair are named,
    // because the runner has no evidence which of the two led. Asserting one
    // here would have been asserting that a detector picks a culprit.
    expect(fired.realFlags).toHaveLength(2);
    expect(fired.realFlags.map((f) => f['identityId']).sort()).toEqual(['id-a', 'id-b']);
    const flag = fired.realFlags[0] ?? {};
    expect(flag['flagType']).toBe('copy_cluster');
    expect(flag['status']).toBe('open');
    expect(flag['source']).toBe('internal');
    expect(flag['firstDetectedOn']).toBe(TRADING_DAY);
    // **AND NEITHER REACHES THE MONEY BAND TODAY.** `severity` 4 and 5 is what
    // `G-HOLD-REQUIRED` reads to hold a payout for 48 hours (`ADR-040`), and
    // `sla_hours` is unstated in every row of `P7-d`'s seed (`OQ-M7-03`), so
    // `fills.ts` caps rather than raising a flag on an invented clock. A flag
    // written here cannot hold anybody's payout.
    for (const raised of fired.realFlags) {
      expect(Number(raised['severity'])).toBeLessThan(4);
      expect(raised['slaDueAt']).toBeUndefined();
    }
    // INV-M7-03: the numbers behind the accusation, never a bare label.
    expect(Object.keys(flag['evidence'] as Record<string, unknown>).length).toBeGreaterThan(0);
    // INV-M7-04: the flag joins back to the run, and the run to the registry.
    expect(flag['detectorRunId']).toBe(
      fired.rec.writes.find((w) => w.table === 'detectorRuns')?.values['id'],
    );
    expect(
      fired.rec.writes.find((w) => w.table === 'detectorRuns')?.values['detectorVersion'],
    ).toBe('v1');
  });

  it('IS SILENT on clean data, and the run is still recorded', async () => {
    // TWO ACCOUNTS TRADING THE SAME SYMBOL AND NOWHERE NEAR EACH OTHER. Every
    // fill is an hour or two from every other account's, so no pair is inside
    // `window_seconds` and the share is zero against a 5000bp floor.
    const clean = clusteredFills(0, 6);
    expect(clean.length).toBeGreaterThan(0);
    const quiet = await runD01(clean);

    // **THE ASSERTION THIS SECTION EXISTS FOR.** A flag here is a restriction on
    // a trader who did nothing.
    expect(quiet.realFlags).toEqual([]);

    // AND THE QUIET NIGHT IS STILL A RECORDED RUN, which is INV-M7-07 and is the
    // half AS-M7-05 says nobody looks at. `rows_scanned` is non-zero, so the
    // record distinguishes "read the data and found nothing" from "read
    // nothing", which is the sentence runner.ts exists to make false.
    expect(quiet.report.outcomes[0]?.status).toBe('ok');
    expect(quiet.report.outcomes[0]?.recorded).toBe(true);
    expect(quiet.report.outcomes[0]?.rowsScanned).toBe(clean.length + TWO_ACCOUNTS.length);
    expect(quiet.report.outcomes[0]?.flagsRaised).toBe(0);
    expect(quiet.rec.writes.filter((w) => w.table === 'detectorRuns')).toHaveLength(1);

    // AND THE CANARY WAS STILL FOUND, so the silence is a detector that WORKED
    // and found nothing rather than a detector that has stopped looking. That
    // distinction is the whole of GS-122.
    expect(quiet.report.outcomes[0]?.syntheticExpected).toBeGreaterThan(0);
    expect(quiet.report.outcomes[0]?.syntheticFound).toBe(
      quiet.report.outcomes[0]?.syntheticExpected,
    );
    expect(quiet.report.degraded).toEqual([]);
  });

  it('records a failed run rather than a silent empty window when a read throws', async () => {
    // The accessor throws on a filter naming a column that is not one, and on an
    // empty filter. Both land inside `attemptScan`'s catch, so the outcome is a
    // recorded `failed` run and never a window that quietly returned nothing.
    const rec = recorder({ detectorDefinitions: [D01_DEFINITION] });
    const sink = recordingSink();
    const exploding: WorkerDb = {
      batch: (fn) =>
        rec.db.batch(async (tx) => {
          const guarded = {
            ...tx,
            rowsWhere: (table: string, where: Record<string, unknown>) =>
              table === 'fills'
                ? Promise.reject(new Error('"noSuchColumn" is not a column of fills'))
                : tx.rowsWhere(table as never, where as never),
          };
          return await fn(guarded as never);
        }),
    };
    const report = await runDetectors(
      [fillClusteringNightly],
      { tradingDay: TRADING_DAY },
      postgresDetectorRunnerIo(exploding, sink.port),
    );

    expect(report.outcomes[0]?.status).toBe('failed');
    expect(report.outcomes[0]?.recorded).toBe(true);
    expect(report.outcomes[0]?.error).toContain('is not a column of fills');
    expect(report.failed).toEqual(['D-01']);
  });
});

// =============================================================================
// 6. The seam, and the value it must never be handed
// =============================================================================
// A no-op sink passed as the second argument would make every run commit and
// every `detector.run_degraded` page vanish, which is `AS-M7-05` produced
// deliberately. The parameter exists so section 5 above can drive a real
// detector end to end; nothing shipped may use it.

test('no module under src passes a second argument to postgresDetectorRunnerIo', () => {
  const offenders: string[] = [];
  for (const path of sources()) {
    const text = stripComments(readFileSync(path, 'utf8'));
    for (const match of text.matchAll(/postgresDetectorRunnerIo\(([^)]*)\)/g)) {
      const args = (match[1] ?? '').trim();
      // The declaration itself reads as a call to this scan and carries the
      // default in its parameter list, so it is named rather than counted.
      if (relToSrc(path) === 'detectors/adapter.ts') continue;
      if (args.includes(',')) offenders.push(`${relToSrc(path)}: ${args}`);
    }
  }
  expect(offenders).toEqual([]);
});

// =============================================================================
// 7. The other two blockers, derived rather than described
// =============================================================================
// ADR-349's finding is that the adapter was never the only thing between
// `runDetectors` and a clock. These two are the other halves, and each is
// measured here so the day one lifts, this file says so.

test('detector_definitions has no producer, so a wired runner would find no registry row', () => {
  // `P7-d`'s seed is a JSON file. Nothing under any `src/` reads it, so a run
  // against a real database finds zero current rows and `readDefinition` raises
  // `DetectorUnregistered` for every detector.
  const readers: string[] = [];
  for (const dir of ['apps', 'packages']) {
    const walk = (at: string): void => {
      for (const entry of readdirSync(at, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'test') continue;
        const path = join(at, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
          if (stripComments(readFileSync(path, 'utf8')).includes('m07-detectors-v1'))
            readers.push(relative(ROOT, path));
        }
      }
    };
    walk(join(ROOT, dir));
  }
  expect(readers).toEqual([]);
});

test('eleven of the eighteen seeded rows state no number, so a loaded registry still declines', () => {
  const seed = JSON.parse(read('packages/db/src/seed/detectors/m07-detectors-v1.rows.json')) as {
    counts: Record<string, number>;
    rows: { detector: string; parameters: Record<string, { state?: string; value?: unknown }> }[];
  };
  // DERIVED FROM THE ROWS AND CHECKED AGAINST THE FILE'S OWN COUNT, so a seed
  // that gains a stated number moves both or fails here.
  // THE PREDICATE IS THE GENERATOR'S OWN `hasAStatedNumber`, transcribed rather
  // than approximated: a parameter counts only if its key is not `_`-prefixed,
  // its state is `stated`, AND its value is a number. Counting `state` alone
  // gives zero, because every row states SOMETHING (a flag type, a boolean),
  // and zero would have made this case pass over an assertion about nothing.
  const withNoStatedNumber = seed.rows.filter(
    (row) =>
      !Object.entries(row.parameters).some(
        ([key, value]) =>
          !key.startsWith('_') && value.state === 'stated' && typeof value.value === 'number',
      ),
  );
  expect(seed.rows).toHaveLength(18);
  expect(withNoStatedNumber).toHaveLength(seed.counts['rows_with_no_stated_number'] ?? -1);
  expect(withNoStatedNumber.length).toBe(11);
});

test('a raised flag has no reader: nothing under src composes the admin read source', () => {
  // `GET /admin/flags` reaches `AdminReadSource.listFlags`, which
  // `composeImplementedAdminReads` supplies. No module under any `src/` calls
  // it, so a flag this adapter caused to be written is a flag nothing serves.
  const callers: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.ts')) {
        const text = stripComments(readFileSync(path, 'utf8'));
        if (/composeImplementedAdminReads\s*\(/.test(text)) callers.push(relative(ROOT, path));
      }
    }
  };
  walk(join(ROOT, 'apps', 'api', 'src'));
  // The declaration is its own occurrence and is named rather than counted.
  expect(callers).toEqual(['apps/api/src/admin-source/index.ts']);
});
