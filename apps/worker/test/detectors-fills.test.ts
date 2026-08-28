// =============================================================================
// apps/worker/test/detectors-fills.test.ts -- CI-02, the `unit` project.
// =============================================================================
// THE VALIDATING HALF OF `src/detectors/fills.ts`. `P7` section 8's `P7-f`.
//
// -----------------------------------------------------------------------------
// THE NEAR-MISSES ARE THE DELIVERABLE AND THE POSITIVES ARE THE EASY HALF
// -----------------------------------------------------------------------------
// `M07` section 8: "Every detector needs a near-miss fixture, not only a
// positive. A detector tested only against a case that should fire proves
// nothing about its threshold, and threshold errors are how a detector becomes
// either noise or nothing." `P7` section 11 rule 12 repeats it as a rule.
//
// So every threshold in this file is asserted TWICE, and the two fixtures differ
// by ONE UNIT rather than by a comfortable margin:
//
//   D-01  share      3 of 4 shared fills FIRES; 2 of 4 does NOT, at a 5000bp
//                    floor, because the statistic is "MORE THAN a configured
//                    share" and 2/4 is exactly the floor
//   D-01  window     fills 2s apart FIRE; fills 3s apart do NOT, at a 2 second
//                    window, and the 2s case is the inclusive boundary
//   D-01  identity   the SAME pair of clusters raises nothing when the two
//                    accounts belong to one identity (`M07` section 3.4)
//   D-04  events     entries near 3 distinct releases FIRE; entries near 2 do
//                    NOT, at a minimum of 3, AND twenty entries on ONE release
//                    do not fire at any count
//   D-05  slope      100 -> 200 contracts after a loss FIRES; 100 -> 199 does
//                    NOT, at a 10000bp escalation floor
//   D-05  sequences  three sequences FIRE; two do NOT, at a minimum of three
//   D-05  loss       the firing series with WINNING days raises nothing, which
//                    is the "after loss" qualifier asserted rather than assumed
//
// -----------------------------------------------------------------------------
// WHAT THIS SUITE ASSERTS THAT A READER MIGHT EXPECT SOMEWHERE ELSE
// -----------------------------------------------------------------------------
//   the shipped seed        all three detectors DECLINE against
//                           `packages/db/src/seed/detectors/`'s real rows, which
//                           is the honest state of `OQ-M7-02` and not a defect
//   the evidence            carries the conduct and NO parameter (`M07` section
//                           3.4: "it discloses no threshold")
//   the severity cap        a finding that would score 4 or 5 with no seeded
//                           `sla_hours` is written at 3 with the cap recorded,
//                           and is written at 5 with a clock the moment the
//                           registry states one
//   `status`                every `risk_flags` row this file can cause is
//                           `open` (`ADR-155`, `INV-M7-02`)
//   the canary columns      `D-04`'s and `D-05`'s synthetic rows use only column
//                           names `packages/db/src/schema.ts` gives the tables
//                           they claim to be, which is the property `D-05`'s
//                           whole shape turns on
//
// -----------------------------------------------------------------------------
// NOTHING HERE REACHES A DATABASE
// -----------------------------------------------------------------------------
// `detector-runner.test.ts`'s bound is inherited verbatim and not written off:
// the CI leg proves the mechanism, and it proves nothing about a nightly
// production run, which needs the database, the run row, the event and a pager
// this repository does not have.
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { CANARY_SHAPES, canaryMint, canaryNonce, isCanaryId } from '../src/detectors/canary.ts';
import type {
  Detector,
  DetectorEvent,
  DetectorFilter,
  DetectorRow,
  DetectorRunnerIo,
  DetectorTx,
} from '../src/detectors/ports.ts';
import { FLAG_SOURCE_INTERNAL, FLAG_STATUS_ON_RAISE } from '../src/detectors/ports.ts';
import { runDetectors } from '../src/detectors/runner.ts';
import type { DetectorRunReport } from '../src/detectors/runner.ts';
import {
  CANARY_INSTANT,
  D01,
  D04,
  D05,
  FILL_DETECTORS,
  fillClustering,
  martingaleSequences,
  newsWindowClustering,
} from '../src/detectors/fills.ts';

// -----------------------------------------------------------------------------
// The sources, read as text
// -----------------------------------------------------------------------------

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string): string => readFileSync(`${ROOT}${path}`, 'utf8');

/** A source file with its comments removed, on session 292's finding. */
const code = (path: string): string =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/.*$/, ''))
    .join('\n');

const FILLS_TS = code('apps/worker/src/detectors/fills.ts');
const RISK_SQL = read('packages/db/migrations/0008_risk.sql');
const SCHEMA_TS = read('packages/db/src/schema.ts');
const M07 = read('docs/plans/M07-risk-abuse.md');
const SEED_ROWS = JSON.parse(read('packages/db/src/seed/detectors/m07-detectors-v1.rows.json')) as {
  rows: {
    detector: string;
    version: string;
    parameters: Record<string, unknown>;
    is_sensitive: boolean;
  }[];
};

/** The Drizzle property names `schema.ts` gives one `pgTable` block. */
function columnsOf(table: string): Set<string> {
  const start = SCHEMA_TS.indexOf(`= pgTable('${table}', {`);
  expect(start, `schema.ts declares ${table}`).toBeGreaterThan(-1);
  const end = SCHEMA_TS.indexOf('\n});', start);
  const block = SCHEMA_TS.slice(start, end);
  return new Set([...block.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):/gm)].map((m) => m[1] ?? ''));
}

// -----------------------------------------------------------------------------
// The fake, which is `detector-runner.test.ts`'s and makes nothing durable
// unless the transaction committed
// -----------------------------------------------------------------------------

interface Written {
  readonly table: string;
  readonly values: Record<string, unknown>;
}

interface FakeIo {
  readonly io: DetectorRunnerIo;
  readonly writes: Written[];
  readonly events: DetectorEvent[];
  readonly reads: { table: string; where: DetectorFilter }[];
}

interface FakeOptions {
  /** Rows BY TABLE, which is what the accessor is keyed on. */
  readonly rows?: Readonly<Record<string, readonly DetectorRow[]>>;
  readonly definitions?: readonly Record<string, unknown>[];
  readonly nonce?: string;
}

const RUN_NOW = new Date('2026-02-10T02:00:00.000Z');

function fakeIo(options: FakeOptions = {}): FakeIo {
  const writes: Written[] = [];
  const events: DetectorEvent[] = [];
  const reads: { table: string; where: DetectorFilter }[] = [];
  const buffers = new WeakMap<DetectorTx, { rows: Written[]; events: DetectorEvent[] }>();
  let rowSeq = 0;

  function open(): { handle: DetectorTx; staged: { rows: Written[]; events: DetectorEvent[] } } {
    const staged = { rows: [] as Written[], events: [] as DetectorEvent[] };
    const handle: DetectorTx = {
      rowsWhere: (table, where) => {
        reads.push({ table, where });
        if (table === 'detectorDefinitions') {
          const all = options.definitions ?? [];
          return Promise.resolve(all.filter((row) => row['detector'] === where['detector']));
        }
        return Promise.resolve([...((options.rows ?? {})[table] ?? [])]);
      },
      insert: (table, values) => {
        rowSeq += 1;
        const row = { ...values, id: `written-${String(rowSeq)}` };
        staged.rows.push({ table, values: row });
        return Promise.resolve([row]);
      },
    };
    buffers.set(handle, staged);
    return { handle, staged };
  }

  return {
    writes,
    events,
    reads,
    io: {
      transact: async <T>(fn: (handle: DetectorTx) => Promise<T>): Promise<T> => {
        const { handle, staged } = open();
        const value = await fn(handle);
        writes.push(...staged.rows);
        events.push(...staged.events);
        return value;
      },
      terms: {
        atMost: (value) => ({ term: 'at-most', value }),
        atLeast: (value) => ({ term: 'at-least', value }),
        isNull: () => ({ term: 'is-null' }),
      },
      events: {
        emit: (handle, event) => {
          const staged = buffers.get(handle);
          if (staged === undefined) {
            return Promise.reject(new Error('an event was emitted outside a transaction'));
          }
          staged.events.push(event);
          return Promise.resolve();
        },
      },
      now: () => RUN_NOW,
      nonce: () => canaryNonce(options.nonce ?? 'nonce-aaaaaaaa'),
    },
  };
}

// -----------------------------------------------------------------------------
// The registry rows the fixtures run under
// -----------------------------------------------------------------------------

const stated = (value: unknown): Record<string, unknown> => ({ state: 'stated', value });

const TRADING_DAY = '2026-02-10';

const D01_PARAMETERS: Record<string, unknown> = {
  window_seconds: stated(2),
  min_shared_fill_share_bp: stated(5000),
};

const D04_PARAMETERS: Record<string, unknown> = {
  lookback_days: stated(30),
  release_window_seconds: stated(60),
  min_events_in_pattern: stated(3),
  fires_on_single_event: stated(false),
};

const D05_PARAMETERS: Record<string, unknown> = {
  lookback_days: stated(60),
  size_after_loss_slope_bp: stated(10_000),
  min_sequences: stated(3),
  severity: stated(2),
};

function definitionRow(
  detector: string,
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  return { detector, version: 'v1', parameters, isSensitive: true, effectiveTo: null };
}

interface RunResult {
  readonly report: DetectorRunReport;
  readonly fake: FakeIo;
  readonly flags: Record<string, unknown>[];
}

async function run(
  detector: Detector,
  parameters: Record<string, unknown>,
  rows: Readonly<Record<string, readonly DetectorRow[]>> = {},
  nonce?: string,
): Promise<RunResult> {
  const fake = fakeIo({
    rows,
    definitions: [definitionRow(detector.id, parameters)],
    ...(nonce === undefined ? {} : { nonce }),
  });
  const report = await runDetectors([detector], { tradingDay: TRADING_DAY }, fake.io);
  return {
    report,
    fake,
    flags: fake.writes.filter((w) => w.table === 'riskFlags').map((w) => w.values),
  };
}

// -----------------------------------------------------------------------------
// The fixtures
// -----------------------------------------------------------------------------

const CLUSTER_AT = Date.parse('2026-02-10T15:30:00.000Z');

interface ClusterFixture {
  /** How many of each account's fills sit in the cluster. */
  readonly shared: number;
  /** How many of each account's fills sit nowhere near the other account. */
  readonly extra: number;
  /** Seconds between the leader's fill and the follower's. Default 0. */
  readonly gapSeconds?: number;
  /** The follower's identity. Default a SECOND identity. */
  readonly followerIdentity?: string;
}

/**
 * Two accounts, one symbol, one side, and a share this fixture controls exactly.
 *
 * THE EXTRAS SIT AN HOUR AND TWO HOURS AWAY so that they enlarge the DENOMINATOR
 * without enlarging the numerator, which is the only way to move the share by
 * one fill at a time.
 */
function clusterFixture(fixture: ClusterFixture): Record<string, DetectorRow[]> {
  const gap = (fixture.gapSeconds ?? 0) * 1000;
  const fills: DetectorRow[] = [];
  for (let n = 0; n < fixture.shared; n += 1) {
    const at = CLUSTER_AT + n * 10_000;
    fills.push({
      id: `f-a-${String(n)}`,
      accountId: 'acc-a',
      symbol: 'ESH6',
      side: 'buy',
      quantity: 2,
      executedAt: new Date(at),
      tradingDay: TRADING_DAY,
    });
    fills.push({
      id: `f-b-${String(n)}`,
      accountId: 'acc-b',
      symbol: 'ESH6',
      side: 'buy',
      quantity: 2,
      executedAt: new Date(at + gap),
      tradingDay: TRADING_DAY,
    });
  }
  for (let n = 0; n < fixture.extra; n += 1) {
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
  return {
    fills,
    accounts: [
      { id: 'acc-a', identityId: 'id-a', phase: 'eval', openedOn: '2026-01-02' },
      {
        id: 'acc-b',
        identityId: fixture.followerIdentity ?? 'id-b',
        phase: 'eval',
        openedOn: '2026-01-02',
      },
    ],
  };
}

const RELEASE_AT = Date.parse('2026-02-04T13:30:00.000Z');

/** One account entering near `releases` distinct Tier-1 releases. */
function newsFixture(releases: number, entriesPerRelease: number): Record<string, DetectorRow[]> {
  const calendar: DetectorRow[] = [];
  const fills: DetectorRow[] = [];
  for (let n = 0; n < releases; n += 1) {
    const at = RELEASE_AT + n * 24 * 3_600_000;
    calendar.push({
      id: BigInt(n + 1),
      occurrenceKey: `rel-${String(n)}`,
      tier: 1,
      scheduledReleaseAt: new Date(at),
      releaseTradingDay: new Date(at).toISOString().slice(0, 10),
    });
    for (let e = 0; e < entriesPerRelease; e += 1) {
      fills.push({
        id: `f-news-${String(n)}-${String(e)}`,
        accountId: 'acc-n',
        symbol: 'ESH6',
        side: 'buy',
        quantity: 3,
        executedAt: new Date(at + e * 1000),
        tradingDay: new Date(at).toISOString().slice(0, 10),
      });
    }
  }
  return {
    fills,
    economicCalendar: calendar,
    accounts: [{ id: 'acc-n', identityId: 'id-n', phase: 'eval', openedOn: '2026-01-02' }],
  };
}

const SIZE_DAY_ZERO = Date.parse('2026-02-02T15:00:00.000Z');

/** One account's day series: `sizes[i]` contracts on day `i`, all losses or all wins. */
function sizeFixture(sizes: readonly number[], losing = true): Record<string, DetectorRow[]> {
  const fills: DetectorRow[] = [];
  const marks: DetectorRow[] = [];
  sizes.forEach((contracts, n) => {
    const at = new Date(SIZE_DAY_ZERO + n * 24 * 3_600_000);
    const day = at.toISOString().slice(0, 10);
    fills.push({
      id: `f-m-${String(n)}`,
      accountId: 'acc-m',
      symbol: 'ESH6',
      side: 'buy',
      quantity: contracts,
      executedAt: at,
      tradingDay: day,
    });
    marks.push({
      id: BigInt(n + 1),
      accountId: 'acc-m',
      tradingDay: day,
      realizedPnlCents: losing ? -125_00n : 125_00n,
      tradedDay: true,
    });
  });
  return {
    fills,
    dailyMarks: marks,
    accounts: [{ id: 'acc-m', identityId: 'id-m', phase: 'eval', openedOn: '2026-01-02' }],
  };
}

/** The firing series, and the two that miss it by one unit. */
const MARTINGALE_FIRES = [100, 200, 150, 100, 200, 150, 100, 200];
const MARTINGALE_ONE_SEQUENCE_SHORT = [100, 200, 150, 100, 200, 150];
const MARTINGALE_ONE_CONTRACT_SHORT = [100, 199, 150, 100, 199, 150, 100, 199];

// =============================================================================
// 1. D-01, AND THE THREE THINGS THAT DECIDE WHETHER IT FIRES
// =============================================================================

describe('D-01 fill clustering', () => {
  it('fires on a cross-identity cluster above the share floor', async () => {
    const { report, flags } = await run(
      fillClustering(),
      D01_PARAMETERS,
      clusterFixture({ shared: 3, extra: 1 }),
    );
    expect(report.outcomes[0]?.status).toBe('ok');
    // ONE FLAG PER IDENTITY. The conduct implicates two humans and enforcement
    // acts at the identity, so both are named.
    expect(flags).toHaveLength(2);
    expect(flags.map((f) => f['identityId']).sort()).toEqual(['id-a', 'id-b']);
    expect(flags.every((f) => f['flagType'] === 'copy_cluster')).toBe(true);
    const evidence = flags[0]?.['evidence'] as Record<string, unknown>;
    expect(evidence['shared_fills']).toEqual({ 'acc-a': 3, 'acc-b': 3 });
    expect(evidence['total_fills']).toEqual({ 'acc-a': 4, 'acc-b': 4 });
  });

  it('DOES NOT fire when the share is exactly the floor, which is the near-miss', async () => {
    // 2 of 4 shared is 5000bp and the floor is 5000bp. M07:108 is "MORE THAN a
    // configured share", so the boundary belongs to the trader. One shared fill
    // is the whole difference between this case and the one above.
    const { report, flags } = await run(
      fillClustering(),
      D01_PARAMETERS,
      clusterFixture({ shared: 2, extra: 2 }),
    );
    expect(report.outcomes[0]?.status).toBe('ok');
    expect(flags).toHaveLength(0);
  });

  it('pairs on the inclusive edge of the window and not one second past it', async () => {
    const inside = await run(
      fillClustering(),
      D01_PARAMETERS,
      clusterFixture({ shared: 3, extra: 1, gapSeconds: 2 }),
    );
    expect(inside.flags).toHaveLength(2);

    const outside = await run(
      fillClustering(),
      D01_PARAMETERS,
      clusterFixture({ shared: 3, extra: 1, gapSeconds: 3 }),
    );
    expect(outside.flags).toHaveLength(0);
  });

  it('FILTERS SAME-IDENTITY PAIRS AT THE DETECTOR RATHER THAN IN THE QUEUE', async () => {
    // M07 section 3.4: copy trading between accounts of ONE verified identity is
    // ALLOWED, and "removing it at the query removes the single largest source
    // of benign noise from this module's most-fired detector". The fixture is
    // byte for byte the firing one above with one field changed.
    const { report, flags, fake } = await run(
      fillClustering(),
      D01_PARAMETERS,
      clusterFixture({ shared: 3, extra: 1, followerIdentity: 'id-a' }),
    );
    expect(report.outcomes[0]?.status).toBe('ok');
    expect(flags).toHaveLength(0);
    // AND IT IS NOT A DISMISSAL EITHER: no row of any kind was written about it.
    expect(fake.writes.filter((w) => w.table !== 'detectorRuns')).toHaveLength(0);
  });

  it('raises nothing when the identity edge cannot be resolved', async () => {
    const rows = clusterFixture({ shared: 3, extra: 1 });
    const { flags } = await run(fillClustering(), D01_PARAMETERS, { ...rows, accounts: [] });
    expect(flags).toHaveLength(0);
  });

  it('runs ON INGEST with a narrowed window and still finds its canary', async () => {
    const at = new Date(CLUSTER_AT + 20_000);
    const { report, flags, fake } = await run(
      fillClustering({ at }),
      D01_PARAMETERS,
      clusterFixture({ shared: 3, extra: 1 }),
    );
    // AS-M7-01 counter 2. The narrowed stream is `at - window_seconds`, one
    // range term on `executed_at` beside the day's equality, which is exactly
    // what ADR-157 section 5 granted P7 by name.
    const narrowed = fake.reads.find((r) => 'executedAt' in r.where);
    expect(narrowed?.table).toBe('fills');
    expect(narrowed?.where['tradingDay']).toBe(TRADING_DAY);
    expect(narrowed?.where['executedAt']).toEqual({
      term: 'at-least',
      value: new Date(at.getTime() - 2000),
    });
    expect(report.outcomes[0]?.status).toBe('ok');
    expect(report.outcomes[0]?.syntheticFound).toBe(1);
    expect(flags).toHaveLength(2);
    expect((flags[0]?.['evidence'] as Record<string, unknown>)['detected_on']).toBe('ingest');
  });

  it('reads the day even on ingest, because the share denominator is the day', async () => {
    // The one non-obvious property in this slice: a two second read cannot
    // supply "a share of BOTH ACCOUNTS' FILLS", so the ingest mode buys
    // detection latency and not read cost.
    const { fake } = await run(
      fillClustering({ at: new Date(CLUSTER_AT) }),
      D01_PARAMETERS,
      clusterFixture({ shared: 3, extra: 1 }),
    );
    const fillReads = fake.reads.filter((r) => r.table === 'fills');
    expect(fillReads).toHaveLength(2);
    expect(fillReads.some((r) => !('executedAt' in r.where))).toBe(true);
  });

  it('narrows the account book by openedOn and never reads it unfiltered', async () => {
    const { fake } = await run(
      fillClustering(),
      D01_PARAMETERS,
      clusterFixture({ shared: 3, extra: 1 }),
    );
    const accountRead = fake.reads.find((r) => r.table === 'accounts');
    expect(accountRead?.where).toEqual({ openedOn: { term: 'at-most', value: TRADING_DAY } });
  });
});

// =============================================================================
// 2. D-04, WHOSE WHOLE SUBJECT IS THAT IT NEVER FIRES ON ONE EVENT
// =============================================================================

describe('D-04 news-window clustering', () => {
  it('fires on entries near three distinct releases', async () => {
    const { report, flags } = await run(newsWindowClustering(), D04_PARAMETERS, newsFixture(3, 1));
    expect(report.outcomes[0]?.status).toBe('ok');
    expect(flags).toHaveLength(1);
    expect(flags[0]?.['flagType']).toBe('news_window');
    expect(flags[0]?.['identityId']).toBe('id-n');
    const evidence = flags[0]?.['evidence'] as Record<string, unknown>;
    expect(evidence['releases_entered_near']).toBe(3);
    expect(evidence['release_keys']).toEqual(['rel-0', 'rel-1', 'rel-2']);
  });

  it('DOES NOT fire on two releases, which is the near-miss', async () => {
    const { report, flags } = await run(newsWindowClustering(), D04_PARAMETERS, newsFixture(2, 5));
    expect(report.outcomes[0]?.status).toBe('ok');
    expect(flags).toHaveLength(0);
  });

  it('DOES NOT fire on twenty entries around ONE release, at any fill count', async () => {
    // M07:111's own words: "one trade around a release is a normal trading day",
    // and the count that matters is of RELEASES rather than of fills. This is
    // the case a reader would get wrong by counting entries.
    const { flags } = await run(newsWindowClustering(), D04_PARAMETERS, newsFixture(1, 20));
    expect(flags).toHaveLength(0);
  });

  it('DOES NOT fire on entries outside the release window', async () => {
    const rows = newsFixture(3, 1);
    const moved = (rows['fills'] ?? []).map((fill) => ({
      ...fill,
      // 61 seconds from a 60 second window.
      executedAt: new Date((fill['executedAt'] as Date).getTime() + 61_000),
    }));
    const { flags } = await run(newsWindowClustering(), D04_PARAMETERS, { ...rows, fills: moved });
    expect(flags).toHaveLength(0);
  });

  it('DECLINES a registry that would make it a single-event detector', async () => {
    const { report } = await run(
      newsWindowClustering(),
      { ...D04_PARAMETERS, min_events_in_pattern: stated(1) },
      newsFixture(3, 1),
    );
    expect(report.outcomes[0]?.status).toBe('failed');
    expect(report.outcomes[0]?.error).toContain('DetectorDeclined');
    expect(report.outcomes[0]?.error).toContain('NEVER A SINGLE EVENT');
  });

  it('reads only Tier-1 releases, since DEP-M7-06 supplies a Tier-1 calendar', async () => {
    const { fake } = await run(newsWindowClustering(), D04_PARAMETERS, newsFixture(3, 1));
    const calendarRead = fake.reads.find((r) => r.table === 'economicCalendar');
    expect(calendarRead?.where['tier']).toBe(1);
  });
});

// =============================================================================
// 3. D-05, AND THE TWO NEAR-MISSES THAT ARE ONE CONTRACT AND ONE SEQUENCE AWAY
// =============================================================================

describe('D-05 martingale sequence', () => {
  it('fires on three escalating-after-loss sequences', async () => {
    const { report, flags } = await run(
      martingaleSequences(),
      D05_PARAMETERS,
      sizeFixture(MARTINGALE_FIRES),
    );
    expect(report.outcomes[0]?.status).toBe('ok');
    expect(flags).toHaveLength(1);
    expect(flags[0]?.['flagType']).toBe('martingale');
    const evidence = flags[0]?.['evidence'] as Record<string, unknown>;
    expect(evidence['sequences']).toBe(3);
    expect(evidence['traded_days']).toBe(8);
  });

  it('DOES NOT fire one sequence short, which is the count near-miss', async () => {
    const { report, flags } = await run(
      martingaleSequences(),
      D05_PARAMETERS,
      sizeFixture(MARTINGALE_ONE_SEQUENCE_SHORT),
    );
    expect(report.outcomes[0]?.status).toBe('ok');
    expect(flags).toHaveLength(0);
  });

  it('DOES NOT fire one CONTRACT short of the slope, which is the threshold near-miss', async () => {
    // 100 -> 199 against a 10000bp floor: 199 * 10000 is 1,990,000 and
    // 100 * 20000 is 2,000,000. The comparison is an integer cross-multiplication
    // precisely so that this case is one contract away rather than a rounding.
    const { report, flags } = await run(
      martingaleSequences(),
      D05_PARAMETERS,
      sizeFixture(MARTINGALE_ONE_CONTRACT_SHORT),
    );
    expect(report.outcomes[0]?.status).toBe('ok');
    expect(flags).toHaveLength(0);
  });

  it('DOES NOT fire on the same escalation after WINNING days', async () => {
    // The "after loss" qualifier asserted rather than assumed: the identical
    // size series raises nothing when the days it follows were profitable.
    const { flags } = await run(
      martingaleSequences(),
      D05_PARAMETERS,
      sizeFixture(MARTINGALE_FIRES, false),
    );
    expect(flags).toHaveLength(0);
  });

  it('DECLINES a registry that would make it a single-sequence detector', async () => {
    const { report } = await run(
      martingaleSequences(),
      { ...D05_PARAMETERS, min_sequences: stated(1) },
      sizeFixture(MARTINGALE_FIRES),
    );
    expect(report.outcomes[0]?.status).toBe('failed');
    expect(report.outcomes[0]?.error).toContain('never a single sequence');
  });

  it('reads daily_marks for the loss, because fills has no realized P&L column', async () => {
    // THE FINDING D-05's SHAPE TURNS ON. M07 gives D-05 the input `fills` and
    // `fills` has no P&L column of any kind; `realized_pnl_cents` is
    // `daily_marks`'. A detector fitting a regression to a P&L field on a fill
    // row would find its canary every night and never fire on a real martingale.
    expect(columnsOf('fills').has('realizedPnlCents')).toBe(false);
    expect(columnsOf('daily_marks').has('realizedPnlCents')).toBe(true);
    const { fake } = await run(
      martingaleSequences(),
      D05_PARAMETERS,
      sizeFixture(MARTINGALE_FIRES),
    );
    expect(fake.reads.some((r) => r.table === 'dailyMarks')).toBe(true);
  });
});

// =============================================================================
// 4. THE CANARIES: ONE PER DETECTOR, FOUND, AND NEVER WRITTEN
// =============================================================================

describe('the canary battery', () => {
  const cases = [
    { detector: fillClustering(), parameters: D01_PARAMETERS, id: D01 },
    { detector: newsWindowClustering(), parameters: D04_PARAMETERS, id: D04 },
    { detector: martingaleSequences(), parameters: D05_PARAMETERS, id: D05 },
  ];

  for (const { detector, parameters, id } of cases) {
    it(`${id} finds its canary against an empty read`, async () => {
      const { report, fake, flags } = await run(detector, parameters);
      const outcome = report.outcomes[0];
      expect(outcome?.status).toBe('ok');
      expect(outcome?.syntheticExpected).toBe(1);
      expect(outcome?.syntheticFound).toBe(1);
      // AS-M7-05 note 1: the canary is in no aggregate because it is in no row.
      expect(outcome?.rowsScanned).toBe(0);
      expect(flags).toHaveLength(0);
      expect(JSON.stringify(fake.writes).includes('canary:')).toBe(false);
    });

    it(`${id}'s canary is regenerated per run`, async () => {
      // AS-M7-05 note 2. Two runs, two nonces, and the mechanism is the runner's
      // -- what is asserted here is that THESE detectors mint from the mint they
      // are handed rather than from a constant, which is the only way a battery
      // built at module load could have survived.
      const first = await run(detector, parameters, {}, 'nonce-aaaaaaaa');
      const second = await run(detector, parameters, {}, 'nonce-bbbbbbbb');
      expect(first.report.outcomes[0]?.syntheticFound).toBe(1);
      expect(second.report.outcomes[0]?.syntheticFound).toBe(1);
      expect(first.report.nonce).not.toBe(second.report.nonce);
    });

    it(`${id} finds its canary WITH real rows beside it`, async () => {
      // The battery must survive the real query returning something, or the
      // canary only proves the empty case.
      const rows =
        id === D01
          ? clusterFixture({ shared: 3, extra: 1 })
          : id === D04
            ? newsFixture(3, 1)
            : sizeFixture(MARTINGALE_FIRES);
      const { report } = await run(detector, parameters, rows);
      expect(report.outcomes[0]?.syntheticFound).toBe(1);
      expect(report.outcomes[0]?.status).toBe('ok');
    });
  }

  it('every canary sits where no exchange session is open', async () => {
    // A Saturday at 03:00 UTC, which is 21:00 Friday CT. D-01 pairs ACCOUNTS and
    // D-04 pairs an account with a RELEASE, so a battery inside live trading
    // could pair a synthetic actor with a real one, and the runner refuses that
    // finding by failing the whole run.
    expect(CANARY_INSTANT.getUTCDay()).toBe(6);
    expect(CANARY_INSTANT.getUTCHours()).toBe(3);
  });

  it('declares only shapes AS-M7-05 names', () => {
    for (const shape of ['same-second-fill-cluster', 'martingale-sequence'] as const) {
      expect(CANARY_SHAPES).toContain(shape);
    }
    expect(M07).toContain('a same-second fill cluster');
    expect(M07).toContain('a martingale sequence');
  });
});

// =============================================================================
// 5. WHAT A CANARY ROW MAY CONTAIN, WHICH IS WHERE `canary.ts`'s DEFECT SHOWS
// =============================================================================

describe('the canary rows this file builds', () => {
  it('uses only column names schema.ts gives the table each row claims to be', async () => {
    // THE PROPERTY D-05's WHOLE DESIGN TURNS ON, asserted over the two batteries
    // this file builds. `mint.martingaleSequence` puts `realizedPnlCents` and
    // `sequenceOrdinal` on a `fills` row and `fills` has neither column, so a
    // detector written against that shape passes its canary every night and
    // fires on nothing real. That is `canary.ts`'s to repair and this suite does
    // not assert against another slice's file; what it asserts is that the rows
    // BUILT HERE cannot have the same defect.
    const byStream: Record<string, string> = {
      fills: 'fills',
      marks: 'daily_marks',
      releases: 'economic_calendar',
      accounts: 'accounts',
    };
    for (const detector of [newsWindowClustering(), martingaleSequences()]) {
      const subjects = detector.canaries(canaryMint(canaryNonce('nonce-aaaaaaaa')));
      for (const subject of subjects) {
        for (const [stream, rows] of Object.entries(subject.rows)) {
          const table = byStream[stream];
          expect(table, `${stream} is a stream this suite knows the table of`).toBeDefined();
          const columns = columnsOf(table ?? '');
          for (const row of rows) {
            for (const column of Object.keys(row)) {
              expect(columns.has(column), `${detector.id}: ${stream}.${column}`).toBe(true);
            }
          }
        }
      }
    }
  });
});

// =============================================================================
// 6. THE SHIPPED SEED, WHICH IS THE STATE OF `OQ-M7-02` AND NOT A DEFECT
// =============================================================================

describe('against the registry as P7-d seeded it', () => {
  const seeded = (detector: string): Record<string, unknown> => {
    const row = SEED_ROWS.rows.find((r) => r.detector === detector);
    expect(row, `${detector} is seeded`).toBeDefined();
    return {
      detector,
      version: row?.version ?? '',
      parameters: row?.parameters ?? {},
      isSensitive: row?.is_sensitive ?? true,
      effectiveTo: null,
    };
  };

  for (const [detector, parameter] of [
    [D01, 'min_shared_fill_share_bp'],
    [D04, 'lookback_days'],
    [D05, 'lookback_days'],
  ] as const) {
    it(`${detector} DECLINES on ${parameter}, and the run is recorded failed`, async () => {
      const fake = fakeIo({ definitions: [seeded(detector)] });
      const target = FILL_DETECTORS.find((d) => d.id === detector);
      expect(target).toBeDefined();
      const report = await runDetectors(
        target === undefined ? [] : [target],
        { tradingDay: TRADING_DAY },
        fake.io,
      );
      const outcome = report.outcomes[0];
      expect(outcome?.status).toBe('failed');
      expect(outcome?.error).toContain('DetectorDeclined');
      expect(outcome?.error).toContain(parameter);
      // INV-M7-07: the run is RECORDED even though it produced no answer, which
      // is what CRON_INVENTORY's dead-man switch and detector_runs_unhealthy_idx
      // both read.
      expect(outcome?.recorded).toBe(true);
      expect(fake.writes.filter((w) => w.table === 'detectorRuns')).toHaveLength(1);
      expect(fake.writes.filter((w) => w.table === 'riskFlags')).toHaveLength(0);
    });
  }

  it('names a parameter for every threshold M07 leaves configured', () => {
    // The bind in the other direction: the seed's keys and this file's reads
    // are the same words, so a rename in either place fails here rather than at
    // 02:00 on a night the detector silently declines.
    for (const [detector, keys] of [
      [D01, ['window_seconds', 'min_shared_fill_share_bp']],
      [D04, ['release_window_seconds', 'min_events_in_pattern', 'fires_on_single_event']],
      [D05, ['size_after_loss_slope_bp', 'min_sequences']],
    ] as const) {
      const row = SEED_ROWS.rows.find((r) => r.detector === detector);
      for (const key of keys) {
        expect(Object.keys(row?.parameters ?? {}), `${detector}.${key}`).toContain(key);
        expect(FILLS_TS, `${detector}.${key} is read by name`).toContain(key);
      }
    }
  });

  it('reads lookback_days from the registry, which M07 names for neither detector', () => {
    // REPORTED RATHER THAN CHOSEN. "A pattern across many events" and "over a
    // minimum number of sequences" both need history and neither states how
    // much, so the parameter is asked of the registry and the detector declines
    // without it. It is absent from the seed today, which is why both decline.
    for (const detector of [D04, D05]) {
      const row = SEED_ROWS.rows.find((r) => r.detector === detector);
      expect(Object.keys(row?.parameters ?? {})).not.toContain('lookback_days');
    }
    expect(FILLS_TS).toContain("'lookback_days'");
  });
});

// =============================================================================
// 7. SEVERITY, WHICH IS A MONEY DECISION EVERY TIME IT IS WRITTEN
// =============================================================================

describe('severity', () => {
  it('caps a 5 at 3 when no sla_hours is seeded, and records why on the flag', async () => {
    // ADR-040: 4 and 5 is the band G-HOLD-REQUIRED reads to hold a payout for 48
    // hours, and risk_flags_high_severity_has_sla makes the clock mandatory
    // there. OQ-M7-03 is OPEN and no seed row carries a duration, so the choice
    // is between an invented clock holding a real trader's money and a capped
    // flag that says so.
    const { flags } = await run(
      martingaleSequences(),
      { ...D05_PARAMETERS, severity: stated(5) },
      sizeFixture(MARTINGALE_FIRES),
    );
    expect(flags).toHaveLength(1);
    expect(flags[0]?.['severity']).toBe(3);
    expect(flags[0]?.['slaDueAt']).toBeUndefined();
    const evidence = flags[0]?.['evidence'] as Record<string, unknown>;
    expect(evidence['severity_capped_from']).toBe(5);
    expect(String(evidence['severity_cap_reason'])).toContain('OQ-M7-03');
  });

  it('writes the 5 with its clock the moment the registry states one', async () => {
    const { flags } = await run(
      martingaleSequences(),
      { ...D05_PARAMETERS, severity: stated(5), sla_hours: stated(24) },
      sizeFixture(MARTINGALE_FIRES),
    );
    expect(flags[0]?.['severity']).toBe(5);
    expect(flags[0]?.['slaDueAt']).toEqual(new Date(RUN_NOW.getTime() + 24 * 3_600_000));
    expect(
      (flags[0]?.['evidence'] as Record<string, unknown>)['severity_capped_from'],
    ).toBeUndefined();
  });

  it('records the funded fact without inferring the case it cannot read', async () => {
    // M07 section 3.3 scores D-01 at 5 for "a funded member ELIGIBLE THIS WEEK".
    // Payout eligibility has no read in DETECTOR_READ_TABLES, and a funded
    // account is not a funded account eligible this week: the difference is 48
    // hours of somebody's payout.
    const rows = clusterFixture({ shared: 3, extra: 1 });
    const funded = (rows['accounts'] ?? []).map((account) => ({ ...account, phase: 'funded' }));
    const { flags } = await run(fillClustering(), D01_PARAMETERS, { ...rows, accounts: funded });
    expect(flags).toHaveLength(2);
    expect(flags[0]?.['severity']).toBe(3);
    const evidence = flags[0]?.['evidence'] as Record<string, unknown>;
    expect(evidence['funded_member_present']).toBe(true);
    expect(String(evidence['severity_case_unreachable'])).toContain('ELIGIBLE THIS WEEK');
  });

  it('scores an evaluation-only cluster at the cited case, which is 3', async () => {
    const { flags } = await run(
      fillClustering(),
      D01_PARAMETERS,
      clusterFixture({ shared: 3, extra: 1 }),
    );
    expect(flags.every((f) => f['severity'] === 3)).toBe(true);
    expect(M07).toContain('D-01 clustering across evaluations');
  });
});

// =============================================================================
// 8. WHAT EVERY FLAG THIS FILE CAN CAUSE LOOKS LIKE
// =============================================================================

describe('the flags these three raise', () => {
  const everyFlag = async (): Promise<Record<string, unknown>[]> => {
    const all: Record<string, unknown>[] = [];
    all.push(
      ...(await run(fillClustering(), D01_PARAMETERS, clusterFixture({ shared: 3, extra: 1 })))
        .flags,
    );
    all.push(...(await run(newsWindowClustering(), D04_PARAMETERS, newsFixture(3, 1))).flags);
    all.push(
      ...(await run(martingaleSequences(), D05_PARAMETERS, sizeFixture(MARTINGALE_FIRES))).flags,
    );
    return all;
  };

  it('is open, internal, and attached to a run', async () => {
    const flags = await everyFlag();
    expect(flags).toHaveLength(4);
    for (const flag of flags) {
      // ADR-155, INV-M7-02, STATE_MACHINES section 7, P7 rule 11. The runner
      // stamps it and nothing in this file could have supplied another value.
      expect(flag['status']).toBe(FLAG_STATUS_ON_RAISE);
      expect(flag['status']).toBe('open');
      expect(flag['source']).toBe(FLAG_SOURCE_INTERNAL);
      expect(typeof flag['detectorRunId']).toBe('string');
      expect(flag['firstDetectedOn']).toBe(TRADING_DAY);
      expect(isCanaryId(flag['identityId'])).toBe(false);
    }
  });

  it('uses a flag_type 0008_risk.sql reserves', async () => {
    for (const flagType of ['copy_cluster', 'news_window', 'martingale']) {
      expect(RISK_SQL).toContain(flagType);
    }
    const flags = await everyFlag();
    expect(new Set(flags.map((f) => f['flagType']))).toEqual(
      new Set(['copy_cluster', 'news_window', 'martingale']),
    );
  });

  it('CARRIES THE CONDUCT AND DISCLOSES NO THRESHOLD', async () => {
    // M07 section 3.4: "the evidence is the conduct: these fills, on these
    // accounts, held by these two identities, at these timestamps, against this
    // ToS clause ... and IT DISCLOSES NO THRESHOLD." The seed's own
    // is_sensitive_reason is the same point from the other side: "A ring told
    // the window is 2 seconds spaces its entries by 3."
    const flags = await everyFlag();
    for (const flag of flags) {
      const evidence = JSON.stringify(flag['evidence']);
      for (const parameter of [
        'window_seconds',
        'min_shared_fill_share_bp',
        'release_window_seconds',
        'min_events_in_pattern',
        'size_after_loss_slope_bp',
        'min_sequences',
        'threshold',
      ]) {
        expect(evidence, `${String(flag['flagType'])} discloses ${parameter}`).not.toContain(
          parameter,
        );
      }
      // And it is not a bare label either (INV-M7-03).
      expect(Object.keys(flag['evidence'] as Record<string, unknown>).length).toBeGreaterThan(3);
    }
  });

  it('emits flag.raised and detector.run_completed and never run_degraded', async () => {
    const { fake } = await run(
      fillClustering(),
      D01_PARAMETERS,
      clusterFixture({ shared: 3, extra: 1 }),
    );
    const names = fake.events.map((e) => e.name);
    expect(names.filter((n) => n === 'flag.raised')).toHaveLength(2);
    expect(names).toContain('detector.run_completed');
    expect(names).not.toContain('detector.run_degraded');
  });
});

// =============================================================================
// 9. THE FENCE, READ OFF THE FILE ITSELF
// =============================================================================

describe('what src/detectors/fills.ts may not contain', () => {
  it('does not reach the database around the one door', () => {
    // P7 section 11 rule 10, ADR-157 section 5, ADR-165. The header names all
    // three in prose, which is why this reads the CODE with its comments
    // stripped (session 292's finding, reused).
    expect(FILLS_TS).not.toContain("from '@merit/db'");
    expect(FILLS_TS).not.toContain('SqlExecutorReason');
    expect(FILLS_TS).not.toContain('SystemReason');
    expect(FILLS_TS).not.toContain("from 'pg'");
    expect(FILLS_TS).not.toContain('sqlExecutor');
  });

  it('has no path to any risk_flags.status at all', () => {
    // Not "no path to enforced": no path to a status. DetectorFinding has no
    // such field and this file names none, so `enforced` is a word with nowhere
    // to go rather than a value somebody remembered to avoid.
    expect(FILLS_TS).not.toContain('enforced');
    expect(FILLS_TS).not.toMatch(/\bstatus:/);
  });

  it('writes no threshold of its own', () => {
    // Every number in a comparison comes from `statedInteger`, which reads the
    // registry. The three literals this file does carry are 10000 (basis points
    // per unit, twice), the tier, and the canary's own shape.
    expect(FILLS_TS).toContain('statedInteger(D01, definition');
    expect(FILLS_TS).toContain('statedInteger(D04, definition');
    expect(FILLS_TS).toContain('statedInteger(D05, definition');
  });

  it('exports all three from the worker barrel', async () => {
    const barrel = (await import('../src/index.ts')) as Record<string, unknown>;
    for (const name of [
      'fillClustering',
      'newsWindowClustering',
      'martingaleSequences',
      'FILL_DETECTORS',
    ]) {
      expect(barrel[name], name).toBeDefined();
    }
    expect(FILL_DETECTORS.map((d) => d.id)).toEqual([D01, D04, D05]);
  });
});
