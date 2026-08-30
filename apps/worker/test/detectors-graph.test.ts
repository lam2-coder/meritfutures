// =============================================================================
// apps/worker/test/detectors-graph.test.ts -- CI-02, the `unit` project.
// =============================================================================
// THE VALIDATING HALF OF `src/detectors/graph.ts`. `P7` SECTION 8's `P7-g`.
//
// **THE MOST VALUABLE ASSERTION IN THIS FILE IS A NEGATIVE ONE.** `GS-118` pins
// a six-account ring on the 5 trading day path and says `D-02` *"is asserted NOT
// to have fired, because its 20 day window has no data yet"*, which is the
// assertion a reader would omit and the one that makes the SECOND-CYCLE label
// mean something. Section 5 is it, and it is written the strong way: the ring
// produces no flag AND the same run finds its canary, so *"did not fire"* is
// distinguished from *"is broken"*, which is the distinction `AS-M7-05` exists
// to make and the one a bare `expect(flags).toBe(0)` would lose.
//
// -----------------------------------------------------------------------------
// WHAT IS ASSERTED THROUGH THE RUNNER AND WHAT IS ASSERTED DIRECTLY
// -----------------------------------------------------------------------------
// Every detector is driven through `runDetectors` under the REAL `P7-d` seed
// rows, read from `packages/db/src/seed/detectors/`, because the production
// question is what these detectors do under the registry that actually exists.
// **That is why three of the four suites here assert a `failed` run**: `D-03`,
// `D-13` and `D-14` decline under the seed as it stands, and a suite that only
// exercised them under invented parameters would be green about a tree in which
// Merit detects none of the three.
//
// The invented-parameter runs are here too, in their own `describe`s, clearly
// labelled, because the arithmetic has to be proved before the founder answers
// `OQ-M7-02` rather than after. **No number in `src/detectors/graph.ts` is
// compared against a literal**; the fixtures below supply thresholds through a
// `detector_definitions` row exactly as the seed would.
//
// -----------------------------------------------------------------------------
// NOTHING HERE REACHES A DATABASE
// -----------------------------------------------------------------------------
// `detector-runner.test.ts`'s bound applies unchanged and is not written off:
// what is asserted is WHICH port was called, with WHAT values, and whether the
// transaction that ran them committed. A canary battery proven in CI proves the
// mechanism and proves nothing about a nightly production run.
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { stripComments } from '../../../packages/tooling/checks/strip-comments.mjs';

import { canaryNonce, isCanaryId } from '../src/detectors/canary.ts';
import {
  CALENDAR_DAYS_PER_TRADING_DAY,
  CANARY_EPOCH,
  CAPPED_SEVERITY,
  D02,
  D02_CANARY_TRADING_DAYS,
  D03,
  D03_CANARY_TRADING_DAYS,
  D12,
  D13,
  D13_CANARY_TRADING_DAYS,
  D14,
  GRAPH_DETECTOR_IDS,
  GRAPH_FLAG_TYPE,
  addCalendarDays,
  asJsonNumber,
  bpAsDecimalString,
  cliquePositionSumDetector,
  correlationAtOrBelow,
  correlationBp,
  discoverClusters,
  graphDetectors,
  groupInverseExposureDetector,
  integerSquareRoot,
  inversePairDetector,
  netPositionsBySymbol,
  pearsonParts,
  readFrom,
  varianceRatioAtOrBelow,
  varianceRatioBp,
  varianceRatioParts,
  youngAccountFastPathDetector,
} from '../src/detectors/graph.ts';
import { DETECTOR_READ_TABLES, DETECTOR_WRITE_TABLES } from '../src/detectors/ports.ts';
import type {
  Detector,
  DetectorEvent,
  DetectorFilter,
  DetectorRow,
  DetectorRunnerIo,
  DetectorTx,
} from '../src/detectors/ports.ts';
import { runDetectors } from '../src/detectors/runner.ts';
import type { DetectorRunOutcome, DetectorRunReport } from '../src/detectors/runner.ts';

// -----------------------------------------------------------------------------
// The sources, read as text
// -----------------------------------------------------------------------------

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string): string => readFileSync(`${ROOT}${path}`, 'utf8');

// THE STRIPPING IS THE SHARED HOME'S (ADR-279), and this file changes no
// finding: `src/detectors/graph.ts` strips identically either way today. The
// copy is what is being removed, not a defect in this suite's answers.
const code = (path: string): string => stripComments(read(path));

const M07 = read('docs/plans/M07-risk-abuse.md');
const RISK_SQL = read('packages/db/migrations/0008_risk.sql');
const SCOPE_TS = read('packages/db/src/scope.ts');
const SCHEMA_TS = read('packages/db/src/schema.ts');
const GRAPH_TS = code('apps/worker/src/detectors/graph.ts');

interface SeedRow {
  readonly detector: string;
  readonly version: string;
  readonly parameters: Record<string, unknown>;
  readonly is_sensitive: boolean;
}

const SEED = (
  JSON.parse(read('packages/db/src/seed/detectors/m07-detectors-v1.rows.json')) as {
    rows: SeedRow[];
  }
).rows;

function seedRow(detector: string): SeedRow {
  const found = SEED.find((row) => row.detector === detector);
  if (found === undefined) {
    throw new Error(`${detector} has no seed row`);
  }
  return found;
}

/** The `state` of one seeded parameter, which is what decides a decline. */
function seededState(detector: string, name: string): string {
  const parameter = seedRow(detector).parameters[name] as { state?: unknown } | undefined;
  return String(parameter?.state ?? 'absent');
}

/** The `value` of one seeded parameter. */
function seededValue(detector: string, name: string): unknown {
  const parameter = seedRow(detector).parameters[name] as { value?: unknown } | undefined;
  return parameter?.value;
}

// -----------------------------------------------------------------------------
// The fake, which serves the REAL registry rows unless a fixture overrides them
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
  /** Rows by TABLE key, which is what a stream's `table` names. */
  readonly rows?: Readonly<Record<string, readonly DetectorRow[]>>;
  /** Parameter overrides by detector, folded onto the real seed row. */
  readonly parameters?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly nonce?: string;
}

/** A `stated` parameter, in the shape `P7-d`'s seed writes. */
function stated(value: unknown, unit = 'count'): Record<string, unknown> {
  return { state: 'stated', value, unit, cite: 'fixture', quote: 'supplied by this suite' };
}

function fakeIo(options: FakeOptions = {}): FakeIo {
  const writes: Written[] = [];
  const events: DetectorEvent[] = [];
  const reads: { table: string; where: DetectorFilter }[] = [];
  const buffers = new WeakMap<DetectorTx, { rows: Written[]; events: DetectorEvent[] }>();
  let clock = 0;
  let rowSeq = 0;

  function definitionFor(detector: string): Record<string, unknown> {
    const row = seedRow(detector);
    return {
      detector,
      version: row.version,
      parameters: { ...row.parameters, ...(options.parameters?.[detector] ?? {}) },
      isSensitive: row.is_sensitive,
      effectiveTo: null,
    };
  }

  function open(): { handle: DetectorTx; staged: { rows: Written[]; events: DetectorEvent[] } } {
    const staged = { rows: [] as Written[], events: [] as DetectorEvent[] };
    const handle: DetectorTx = {
      rowsWhere: (table, where) => {
        reads.push({ table, where });
        if (table === 'detectorDefinitions') {
          return Promise.resolve([definitionFor(String(where['detector']))]);
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
            return Promise.reject(
              new Error('an event was emitted on a handle no transaction opened'),
            );
          }
          staged.events.push(event);
          return Promise.resolve();
        },
      },
      now: () => {
        clock += 1000;
        return new Date(Date.UTC(2026, 7, 28, 2, 0, 0) + clock);
      },
      nonce: () => canaryNonce(options.nonce ?? 'nonce-p7g-graph'),
    },
  };
}

const TRADING_DAY = '2026-08-27';

async function runOne(
  detector: Detector,
  options: FakeOptions = {},
): Promise<{ report: DetectorRunReport; fake: FakeIo; outcome: DetectorRunOutcome }> {
  const fake = fakeIo(options);
  const report = await runDetectors([detector], { tradingDay: TRADING_DAY }, fake.io);
  const outcome = report.outcomes[0];
  if (outcome === undefined) {
    throw new Error('the runner reported no outcome');
  }
  return { report, fake, outcome };
}

/** The `risk_flags` rows a run committed. */
function flagsFrom(fake: FakeIo): Written[] {
  return fake.writes.filter((written) => written.table === 'riskFlags');
}

/** The `correlation_groups` rows a run committed. */
function groupsFrom(fake: FakeIo): Written[] {
  return fake.writes.filter((written) => written.table === 'correlationGroups');
}

// -----------------------------------------------------------------------------
// Real rows. NONE OF THEM CARRIES A CANARY IDENTIFIER, and section 10 asserts it
// -----------------------------------------------------------------------------

function account(id: string, identityId: string, sizeCents = 5000000n): DetectorRow {
  return { id, identityId, sizeCents, openedOn: '2026-08-01', status: 'active', phase: 'funded' };
}

function mark(accountId: string, tradingDay: string, realizedPnlCents: bigint): DetectorRow {
  return {
    id: `${accountId}-${tradingDay}`,
    accountId,
    tradingDay,
    realizedPnlCents,
    tradedDay: true,
    winDay: realizedPnlCents > 0n,
    supersededBy: null,
  };
}

function fill(
  accountId: string,
  tradingDay: string,
  at: Date,
  side: string,
  quantity: number,
  symbol = 'ESH6',
): DetectorRow {
  return {
    id: `${accountId}-${at.toISOString()}-${side}`,
    accountId,
    tradingDay,
    executedAt: at,
    side,
    quantity,
    symbol,
    isCorrected: false,
  };
}

function signal(identityId: string, valueHash: string, kind = 'device'): DetectorRow {
  return { id: `${identityId}-${kind}`, identityId, kind, valueHash, observationCount: 1 };
}

function link(identityA: string, identityB: string): DetectorRow {
  return {
    id: `${identityA}-${identityB}`,
    identityA,
    identityB,
    linkKind: 'shared_device',
    confidenceBp: 9000,
    suppressed: false,
  };
}

/** `days` consecutive calendar days ending at `TRADING_DAY`, oldest first. */
function tradingDays(days: number, endingAt = TRADING_DAY): readonly string[] {
  const found: string[] = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    found.push(addCalendarDays(endingAt, -back));
  }
  return found;
}

/** A magnitude that varies by day, so a mirrored series has variance. */
function magnitude(day: number): bigint {
  return BigInt(250000 * (day + 1));
}

/** Two accounts whose realized P&L is exactly mirrored over `days` days. */
function hedgedMarks(
  longAccount: string,
  shortAccount: string,
  days: readonly string[],
): readonly DetectorRow[] {
  return days.flatMap((day, at) => [
    mark(longAccount, day, magnitude(at)),
    mark(shortAccount, day, -magnitude(at)),
  ]);
}

// =============================================================================
// 1. The constants are bound to their sources rather than restated
// =============================================================================

describe('the sources this module transcribes', () => {
  it('names the five detectors M07 section 3.2 gives P7-g', () => {
    for (const [id, row] of [
      [D02, 'Inverse P&L pair'],
      [D03, 'Group inverse exposure'],
      [D12, 'Day-0 graph-prior pairing'],
      [D13, 'Young-account fast path'],
      [D14, 'Clique position-sum'],
    ] as const) {
      expect(M07).toContain(`| ${id.startsWith('D-1') ? `**${id}**` : id} |`);
      expect(seedRow(id).parameters['_meta']).toMatchObject({ name: row });
    }
  });

  it('registers four detectors and leaves D-12 out, because its output is neither a flag nor a group', () => {
    expect([...GRAPH_DETECTOR_IDS]).toEqual([D02, D03, D13, D14]);
    expect(graphDetectors().map((one) => one.id)).toEqual([...GRAPH_DETECTOR_IDS]);
    expect([...GRAPH_DETECTOR_IDS]).not.toContain(D12);
    // M07's own words for why it cannot be one.
    expect(M07).toContain('Output is a watched-cluster set, not a flag');
    // And the runner arithmetic that makes it degraded if it were.
    expect(code('apps/worker/src/detectors/runner.ts')).toContain(
      "found < expected ? 'degraded' : 'ok'",
    );
  });

  it('uses only tables the ports declare readable and writable', () => {
    for (const table of ['dailyMarks', 'accounts', 'identityLinks', 'identitySignals', 'fills']) {
      expect([...DETECTOR_READ_TABLES]).toContain(table);
      expect(SCHEMA_TS).toContain(`export const ${table} = pgTable(`);
    }
    expect([...DETECTOR_WRITE_TABLES]).toContain('correlationGroups');
    // correlation_groups IS registered, so P7-g's producer needs no schema change.
    expect(SCOPE_TS).toContain('correlationGroups');
  });

  it('takes every threshold from the registry and compares against no literal', () => {
    // The numbers M07 states are in the SEED and not in this module.
    expect(seededValue(D02, 'correlation_floor_bp')).toBe(-8000);
    expect(seededValue(D02, 'window_trading_days')).toBe(20);
    expect(seededValue(D13, 'correlation_floor_bp')).toBe(-9500);
    expect(seededValue(D13, 'window_trading_days')).toBe(5);
    expect(GRAPH_TS).not.toContain('-8000');
    expect(GRAPH_TS).not.toContain('-9500');
    expect(GRAPH_TS).toContain("'correlation_floor_bp'");
    expect(GRAPH_TS).toContain("'window_trading_days'");
  });

  it('opens no second door onto the database', () => {
    expect(GRAPH_TS).not.toContain("from '@merit/db'");
    expect(GRAPH_TS).not.toContain("from 'pg'");
    expect(GRAPH_TS).not.toContain('SqlExecutorReason');
    expect(GRAPH_TS).not.toContain('SystemReason');
    expect(GRAPH_TS).not.toContain('sqlExecutor');
  });

  it('never writes a risk_flags status, because DetectorFinding has no field for one', () => {
    expect(GRAPH_TS).not.toContain('enforced');
    expect(GRAPH_TS).not.toMatch(/status:\s*'(open|dismissed|enforced|expired)'/);
    expect(RISK_SQL).toContain("status             risk_flag_status NOT NULL DEFAULT 'open'");
  });
});

// =============================================================================
// 2. The statistics are exact integers, and no float appears in any of them
// =============================================================================

describe('the integer statistics', () => {
  it('computes an exactly mirrored pair as -1.0000 and fires at every floor', () => {
    const a = [100n, -300n, 700n, -200n, 500n];
    const b = a.map((value) => -value);
    const parts = pearsonParts(a, b);
    expect(correlationBp(parts)).toBe(-10000);
    expect(correlationAtOrBelow(parts, -8000)).toBe(true);
    expect(correlationAtOrBelow(parts, -9500)).toBe(true);
    expect(correlationAtOrBelow(parts, -10000)).toBe(true);
  });

  it('computes an exactly copied pair as +1.0000 and fires at no floor', () => {
    const a = [100n, -300n, 700n, -200n, 500n];
    const parts = pearsonParts(a, [...a]);
    expect(correlationBp(parts)).toBe(10000);
    expect(correlationAtOrBelow(parts, -1)).toBe(false);
  });

  it('returns false rather than dividing by zero when a series is constant', () => {
    const parts = pearsonParts([5n, 5n, 5n], [1n, -2n, 4n]);
    expect(correlationBp(parts)).toBeUndefined();
    expect(correlationAtOrBelow(parts, -8000)).toBe(false);
  });

  it('decides the firing test WITHOUT the rounded figure it reports', () => {
    // A pair whose true correlation sits just inside -0.8000. The reported bp is
    // TRUNCATED TOWARD ZERO, so the reported number can read as if it were
    // outside the floor while the exact comparison says it is inside.
    const a = [3n, 1n, 4n, 1n, 5n, 9n, 2n, 6n];
    const b = [-3n, -2n, -4n, 1n, -5n, -8n, -1n, -7n];
    const parts = pearsonParts(a, b);
    const reported = correlationBp(parts) ?? 0;
    // The decision is taken from the squared inequality, never from `reported`.
    for (const floor of [-9000, -9500, -9900]) {
      const exact = correlationAtOrBelow(parts, floor);
      const naive = reported <= floor;
      expect(typeof exact).toBe('boolean');
      // Where they disagree, the exact answer is the one the detector uses.
      if (exact !== naive) {
        expect(reported).toBeGreaterThan(floor);
      }
    }
    expect(GRAPH_TS).toContain('10000n * magnitude * (10000n * magnitude)');
  });

  it('computes a variance ratio of zero for a group that sums flat every day', () => {
    const days = 8;
    const legs: bigint[][] = [[], [], []];
    for (let day = 0; day < days; day += 1) {
      legs[0]?.push(2n * magnitude(day));
      legs[1]?.push(-magnitude(day));
      legs[2]?.push(-magnitude(day));
    }
    const parts = varianceRatioParts(legs);
    expect(parts.numerator).toBe(0n);
    expect(parts.denominator).toBeGreaterThan(0n);
    expect(varianceRatioBp(parts)).toBe(0);
    expect(varianceRatioAtOrBelow(parts, 2000)).toBe(true);
  });

  it('refuses a group whose members all traded nothing rather than calling it hedged', () => {
    const parts = varianceRatioParts([
      [0n, 0n, 0n],
      [0n, 0n, 0n],
      [0n, 0n, 0n],
    ]);
    expect(parts.denominator).toBe(0n);
    expect(varianceRatioBp(parts)).toBeUndefined();
    expect(varianceRatioAtOrBelow(parts, 10000)).toBe(false);
  });

  it('leaves an independent group near 1.0000 rather than near zero', () => {
    const parts = varianceRatioParts([
      [10n, -4n, 7n, 1n, -9n],
      [3n, 8n, -2n, 6n, 4n],
      [-5n, 2n, 9n, -7n, 1n],
    ]);
    const ratio = varianceRatioBp(parts) ?? 0;
    expect(ratio).toBeGreaterThan(3000);
    expect(varianceRatioAtOrBelow(parts, 2000)).toBe(false);
  });

  it('keeps a large integer exact on its way into a jsonb evidence object', () => {
    const beyondDouble = 9007199254740993n;
    expect(asJsonNumber(beyondDouble)).toBe('9007199254740993');
    expect(asJsonNumber(1234n)).toBe(1234);
    // The naive move, which ADR-157 section 5 finding 8 measured as lossy.
    expect(Number(beyondDouble).toString()).not.toBe('9007199254740993');
    expect(JSON.parse(JSON.stringify({ v: asJsonNumber(beyondDouble) }))).toEqual({
      v: '9007199254740993',
    });
  });

  it('writes a numeric column as an exact decimal string and never as a number', () => {
    expect(bpAsDecimalString(-9500)).toBe('-0.9500');
    expect(bpAsDecimalString(0)).toBe('0.0000');
    expect(bpAsDecimalString(12345)).toBe('1.2345');
    expect(RISK_SQL).toContain('statistic          numeric NOT NULL');
    expect(RISK_SQL).toContain('threshold          numeric NOT NULL');
  });

  it('has an integer square root that never overshoots', () => {
    for (const value of [0n, 1n, 2n, 3n, 4n, 99n, 100n, 101n, 10n ** 30n + 7n]) {
      const root = integerSquareRoot(value);
      expect(root * root).toBeLessThanOrEqual(value);
      expect((root + 1n) * (root + 1n)).toBeGreaterThan(value);
    }
  });
});

// =============================================================================
// 3. `D-12`, which is a function because the port has no shape for it
// =============================================================================

describe('D-12, the watched-cluster set', () => {
  const empty = { links: [], signals: [], accounts: [] };

  it('joins identities that share any signal, which is M07:110s own construction', () => {
    const clusters = discoverClusters({
      ...empty,
      signals: [signal('i-1', 'device-aaa'), signal('i-2', 'device-aaa'), signal('i-3', 'other')],
      accounts: [account('a-1', 'i-1'), account('a-2', 'i-2'), account('a-3', 'i-3')],
    });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.identityIds).toEqual(['i-1', 'i-2']);
    expect(clusters[0]?.accountIds).toEqual(['a-1', 'a-2']);
    expect(clusters[0]?.via).toEqual(['signal:device']);
    expect(M07).toContain('a candidate search over accounts sharing any signal');
  });

  it('merges a signal component and a link component into one', () => {
    const clusters = discoverClusters({
      links: [link('i-2', 'i-3')],
      signals: [signal('i-1', 'device-aaa'), signal('i-2', 'device-aaa')],
      accounts: [account('a-1', 'i-1'), account('a-2', 'i-2'), account('a-3', 'i-3')],
    });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.identityIds).toEqual(['i-1', 'i-2', 'i-3']);
    expect(clusters[0]?.via).toEqual(['identity_link', 'signal:device']);
  });

  it('NEAR MISS: two identities on the same signal VALUE under different KINDS are not joined', () => {
    // The same bytes under `device` and under `card` are two different facts.
    const clusters = discoverClusters({
      ...empty,
      signals: [signal('i-1', 'shared-bytes', 'device'), signal('i-2', 'shared-bytes', 'card')],
      accounts: [account('a-1', 'i-1'), account('a-2', 'i-2')],
    });
    expect(clusters).toEqual([]);
  });

  it('NEAR MISS: one identity holding several accounts is D-07s entity cap and not a ring', () => {
    const clusters = discoverClusters({
      ...empty,
      signals: [signal('i-1', 'device-aaa')],
      accounts: [account('a-1', 'i-1'), account('a-2', 'i-1'), account('a-3', 'i-1')],
    });
    expect(clusters).toEqual([]);
  });

  it('drops a SUPPRESSED link and keeps a DISPUTED one, because AS-M7-04 renders the dispute', () => {
    // The caller narrows `suppressed` AT THE QUERY, so a suppressed row never
    // reaches this function; a disputed one does and stays an edge.
    const disputed = { ...link('i-1', 'i-2'), disputedAt: new Date('2026-08-20T00:00:00.000Z') };
    const clusters = discoverClusters({
      ...empty,
      links: [disputed],
      accounts: [account('a-1', 'i-1'), account('a-2', 'i-2')],
    });
    expect(clusters).toHaveLength(1);
    expect(
      inversePairDetector()
        .streams({
          detector: D02,
          tradingDay: TRADING_DAY,
          definition: {
            detector: D02,
            version: 'v1',
            parameters: seedRow(D02).parameters,
            isSensitive: true,
          },
          terms: fakeIo().io.terms,
          now: new Date(),
        })
        .map((one) => one.table),
    ).toEqual(['dailyMarks', 'accounts']);
    expect(GRAPH_TS).toContain('suppressed: false');
    expect(M07).toContain('a disputed link renders on the graph before an admin acts');
  });

  it('reads a bytea value_hash by its BYTES rather than by reference', () => {
    const bytes = new Uint8Array([1, 2, 255]);
    const clusters = discoverClusters({
      ...empty,
      signals: [
        { id: 's-1', identityId: 'i-1', kind: 'device', valueHash: bytes },
        { id: 's-2', identityId: 'i-2', kind: 'device', valueHash: new Uint8Array([1, 2, 255]) },
      ],
      accounts: [account('a-1', 'i-1'), account('a-2', 'i-2')],
    });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.identityIds).toEqual(['i-1', 'i-2']);
  });

  it('is order independent: the same edges in any order give the same clusters', () => {
    const signals = [
      signal('i-3', 'device-aaa'),
      signal('i-1', 'device-aaa'),
      signal('i-2', 'device-aaa'),
    ];
    const accounts = [account('a-1', 'i-1'), account('a-2', 'i-2'), account('a-3', 'i-3')];
    const forward = discoverClusters({ ...empty, signals, accounts });
    const backward = discoverClusters({ ...empty, signals: [...signals].reverse(), accounts });
    expect(forward).toEqual(backward);
    expect(forward[0]?.identityIds).toEqual(['i-1', 'i-2', 'i-3']);
  });
});

// =============================================================================
// 4. `D-02`, THE ONE THAT RUNS, under the real seed row
// =============================================================================

describe('D-02 under the seed as it stands', () => {
  const days = tradingDays(20);

  it('finds its canary and reports ok, so a quiet night is distinguishable from a broken one', async () => {
    const { outcome, fake } = await runOne(inversePairDetector(), { rows: {} });
    expect(outcome.status).toBe('ok');
    expect(outcome.syntheticExpected).toBe(1);
    expect(outcome.syntheticFound).toBe(1);
    expect(outcome.syntheticMissing).toEqual([]);
    expect(outcome.detectorVersion).toBe(seedRow(D02).version);
    // The canary is a HIT and never a flag.
    expect(flagsFrom(fake)).toEqual([]);
    expect(outcome.flagsRaised).toBe(0);
  });

  it('flags a real pair mirrored over twenty trading days, at severity 3 and at open', async () => {
    const { outcome, fake } = await runOne(inversePairDetector(), {
      rows: {
        dailyMarks: hedgedMarks('a-long', 'a-short', days),
        accounts: [account('a-long', 'i-long'), account('a-short', 'i-short')],
      },
    });
    expect(outcome.status).toBe('ok');
    const flags = flagsFrom(fake);
    // ONE FLAG PER HUMAN. risk_flags.identity_id is who gets enforced against.
    expect(flags).toHaveLength(2);
    expect(flags.map((one) => one.values['identityId']).sort()).toEqual(['i-long', 'i-short']);
    for (const flag of flags) {
      expect(flag.values['status']).toBe('open');
      expect(flag.values['severity']).toBe(CAPPED_SEVERITY);
      expect(flag.values['flagType']).toBe(GRAPH_FLAG_TYPE);
      expect(flag.values['slaDueAt']).toBeUndefined();
      const evidence = flag.values['evidence'] as Record<string, unknown>;
      expect(evidence['correlation_bp']).toBe(-10000);
      expect(evidence['correlation_floor_bp']).toBe(-8000);
      expect(evidence['trading_days_compared']).toBe(20);
      expect(evidence['second_cycle_detector']).toBe(true);
    }
  });

  it('reports the size halves it cannot threshold rather than dropping or inventing them', async () => {
    const { fake } = await runOne(inversePairDetector(), {
      rows: {
        dailyMarks: hedgedMarks('a-long', 'a-short', days),
        accounts: [account('a-long', 'i-long', 5000000n), account('a-short', 'i-short', 10000000n)],
      },
    });
    const evidence = flagsFrom(fake)[0]?.values['evidence'] as Record<string, unknown>;
    expect(evidence['comparable_size_evaluated']).toBe(false);
    expect(evidence['comparable_size_tolerance_state']).toBe('unstated');
    expect(seededState(D02, 'comparable_size_tolerance_bp')).toBe('unstated');
    // A 50K account beside a 100K one: 0.5 exactly, in basis points.
    expect(evidence['size_cents_ratio_bp']).toBe(5000);
    expect(evidence['abs_pnl_ratio_bp']).toBe(10000);
    expect(M07).toContain('with comparable size');
  });

  it('caps severity below the money band, and the cap carries its own reason', async () => {
    const { fake } = await runOne(inversePairDetector(), {
      rows: {
        dailyMarks: hedgedMarks('a-long', 'a-short', days),
        accounts: [account('a-long', 'i-long'), account('a-short', 'i-short')],
      },
    });
    const evidence = flagsFrom(fake)[0]?.values['evidence'] as Record<string, unknown>;
    expect(evidence['severity_capped_at']).toBe(CAPPED_SEVERITY);
    expect(String(evidence['severity_cap_reason'])).toContain('sla_due_at');
    // M07 gives the 4 and SD-M7-02 asks for a clock nobody has set.
    expect(M07).toContain('D-02 below the floor with both accounts funded');
    expect(M07).toContain('need a stated time-to-first-touch');
    expect(RISK_SQL).toContain('severity < 4 OR sla_due_at IS NOT NULL');
  });

  it('NEAR MISS: a pair at -0.79 does not fire, and the near miss is the THRESHOLD', async () => {
    // Mirrored on nineteen of twenty days and copied on the twentieth, which
    // pulls the correlation above the -0.8000 floor without changing anything
    // else about the pair.
    const rows = [...hedgedMarks('a-long', 'a-short', days)].filter(
      (row) => row['accountId'] !== 'a-short' || row['tradingDay'] !== days[19],
    );
    rows.push(mark('a-short', days[19] ?? '', magnitude(19) * 3n));
    const { outcome, fake } = await runOne(inversePairDetector(), {
      rows: {
        dailyMarks: rows,
        accounts: [account('a-long', 'i-long'), account('a-short', 'i-short')],
      },
    });
    const parts = pearsonParts(
      days.map((_, at) => magnitude(at)),
      days.map((_, at) => (at === 19 ? magnitude(19) * 3n : -magnitude(at))),
    );
    expect(correlationBp(parts)).toBeGreaterThan(-8000);
    expect(flagsFrom(fake)).toEqual([]);
    // AND THE DETECTOR IS STILL WORKING, which is what makes it a near miss
    // rather than an outage.
    expect(outcome.status).toBe('ok');
    expect(outcome.syntheticFound).toBe(1);
  });

  it('NEAR MISS: a pair with nineteen common days does not fire, whatever its correlation', async () => {
    const short = tradingDays(19);
    const { outcome, fake } = await runOne(inversePairDetector(), {
      rows: {
        dailyMarks: hedgedMarks('a-long', 'a-short', short),
        accounts: [account('a-long', 'i-long'), account('a-short', 'i-short')],
      },
    });
    expect(flagsFrom(fake)).toEqual([]);
    expect(outcome.status).toBe('ok');
  });

  it('raises ONE flag when both accounts belong to one identity', async () => {
    const { fake } = await runOne(inversePairDetector(), {
      rows: {
        dailyMarks: hedgedMarks('a-long', 'a-short', days),
        accounts: [account('a-long', 'i-one'), account('a-short', 'i-one')],
      },
    });
    expect(flagsFrom(fake)).toHaveLength(1);
    expect(flagsFrom(fake)[0]?.values['identityId']).toBe('i-one');
  });

  it('raises NO flag for an account with no accounts row, rather than inventing an identity', async () => {
    const { fake } = await runOne(inversePairDetector(), {
      rows: {
        dailyMarks: hedgedMarks('a-long', 'a-short', days),
        accounts: [account('a-long', 'i-long')],
      },
    });
    const flags = flagsFrom(fake);
    expect(flags).toHaveLength(1);
    expect(flags[0]?.values['identityId']).toBe('i-long');
  });

  it('narrows its read with both of ADR-157s admitted terms and nothing else', async () => {
    const { fake } = await runOne(inversePairDetector(), { rows: {} });
    const marks = fake.reads.find((one) => one.table === 'dailyMarks');
    expect(marks?.where).toEqual({
      tradingDay: { term: 'at-least', value: readFrom(TRADING_DAY, 20) },
      supersededBy: { term: 'is-null' },
    });
    const accounts = fake.reads.find((one) => one.table === 'accounts');
    expect(accounts?.where).toEqual({ openedOn: { term: 'at-most', value: TRADING_DAY } });
    // (c) in the header: no read is unnarrowed, because an empty filter does not
    // compile against the accessor.
    for (const one of fake.reads) {
      expect(Object.keys(one.where).length).toBeGreaterThan(0);
    }
  });

  it('applies the windows upper bound in memory, because a column carries one narrowing', async () => {
    const future = addCalendarDays(TRADING_DAY, 5);
    const rows = [
      ...hedgedMarks('a-long', 'a-short', days),
      // Twenty more mirrored days AFTER the trading day the run is for.
      ...hedgedMarks('a-long', 'a-short', [future]),
    ];
    const { fake } = await runOne(inversePairDetector(), {
      rows: {
        dailyMarks: rows,
        accounts: [account('a-long', 'i-long'), account('a-short', 'i-short')],
      },
    });
    const evidence = flagsFrom(fake)[0]?.values['evidence'] as Record<string, unknown>;
    expect(evidence['last_trading_day']).toBe(TRADING_DAY);
    expect(evidence['trading_days_compared']).toBe(20);
  });
});

// =============================================================================
// 5. `GS-118`. THE NEGATIVE ASSERTION, WHICH IS THIS SLICE'S MOST VALUABLE TEST
// =============================================================================
//
// `M07` section 8.1: "A six-account ring on the 5 trading day path is flagged by
// D-01 and D-03 before the first settlement lands, and D-02 is asserted NOT to
// have fired, because its 20 day window has no data yet. AS-M7-01."
//
// `D-01` IS `P7-f`'s AND IS NOT ASSERTED HERE. What this suite owns is `D-02`'s
// negative and `D-03`'s positive, and `D-03`'s is shown under supplied
// parameters because it declines under the seed.

/** `GS-118`'s six-account ring: three mirrored pairs, one shared device. */
function sixAccountRing(days: readonly string[]): {
  readonly accounts: readonly DetectorRow[];
  readonly signals: readonly DetectorRow[];
  readonly marks: readonly DetectorRow[];
} {
  const accounts: DetectorRow[] = [];
  const signals: DetectorRow[] = [];
  const marks: DetectorRow[] = [];
  for (let member = 0; member < 6; member += 1) {
    accounts.push(account(`ring-a-${String(member)}`, `ring-i-${String(member)}`));
    signals.push(signal(`ring-i-${String(member)}`, 'ring-device'));
  }
  for (let pair = 0; pair < 3; pair += 1) {
    marks.push(
      ...hedgedMarks(`ring-a-${String(pair * 2)}`, `ring-a-${String(pair * 2 + 1)}`, days),
    );
  }
  return { accounts, signals, marks };
}

describe('GS-118: detection cadence beats extraction on the minimum-variance path', () => {
  const ring = sixAccountRing(tradingDays(5));

  it('D-02 IS ASSERTED NOT TO HAVE FIRED on a five trading day life', async () => {
    const { outcome, fake } = await runOne(inversePairDetector(), {
      rows: { dailyMarks: ring.marks, accounts: ring.accounts, identitySignals: ring.signals },
    });

    // THE NEGATIVE.
    expect(flagsFrom(fake)).toEqual([]);
    expect(outcome.flagsRaised).toBe(0);

    // AND THE HALF THAT MAKES THE NEGATIVE WORTH ANYTHING: the same run found
    // its canary, so this is a detector that looked and saw nothing rather than
    // a detector that is not running. `AS-M7-05` is the whole reason the
    // distinction has to be observable.
    expect(outcome.status).toBe('ok');
    expect(outcome.syntheticExpected).toBe(1);
    expect(outcome.syntheticFound).toBe(1);

    // AND THE REASON IS THE WINDOW rather than the threshold, the parameters or
    // an accident: every pair on the ring is at -1.0000, which is far below the
    // -0.8000 floor, and not one of them has twenty common trading days.
    const parts = pearsonParts(
      ring.marks
        .filter((row) => row['accountId'] === 'ring-a-0')
        .map((row) => row['realizedPnlCents'] as bigint),
      ring.marks
        .filter((row) => row['accountId'] === 'ring-a-1')
        .map((row) => row['realizedPnlCents'] as bigint),
    );
    expect(correlationBp(parts)).toBe(-10000);
    expect(correlationAtOrBelow(parts, -8000)).toBe(true);
    expect(parts.n).toBe(5);
    expect(seededValue(D02, 'window_trading_days')).toBe(20);
    expect(M07).toContain('D-02 is asserted **not** to have fired');
  });

  it('D-02 carries the SECOND-CYCLE label from the registry and not from a comment', async () => {
    const { fake } = await runOne(inversePairDetector(), {
      rows: {
        dailyMarks: hedgedMarks('a-long', 'a-short', tradingDays(20)),
        accounts: [account('a-long', 'i-long'), account('a-short', 'i-short')],
      },
    });
    const evidence = flagsFrom(fake)[0]?.values['evidence'] as Record<string, unknown>;
    expect(evidence['second_cycle_detector']).toBe(true);
    expect(seededValue(D02, 'second_cycle_detector')).toBe(true);
    expect(M07).toContain('explicitly labelled a **second-cycle** detector');
    expect(GRAPH_TS).toContain("'second_cycle_detector'");
  });

  it('D-03 DECLINES on the same ring under the seed, so GS-118s positive half is unserved today', async () => {
    const { outcome } = await runOne(groupInverseExposureDetector(), {
      rows: { dailyMarks: ring.marks, accounts: ring.accounts, identitySignals: ring.signals },
    });
    expect(outcome.status).toBe('failed');
    expect(String(outcome.error)).toContain('declined to run');
    expect(seededState(D03, 'max_variance_ratio_bp')).toBe('unstated');
  });

  it('D-03 FIRES on the same ring the moment its parameters are stated', async () => {
    const { outcome, fake } = await runOne(groupInverseExposureDetector(), {
      rows: { dailyMarks: ring.marks, accounts: ring.accounts, identitySignals: ring.signals },
      parameters: {
        [D03]: {
          window_trading_days: stated(5, 'trading_days'),
          max_variance_ratio_bp: stated(2000, 'bp'),
          max_candidate_group_size: stated(8),
          severity: stated(3, 'severity'),
        },
      },
    });
    expect(outcome.status).toBe('ok');
    const groups = groupsFrom(fake);
    expect(groups).toHaveLength(1);
    expect((groups[0]?.values['memberAccountIds'] as string[]).length).toBe(6);
    expect(groups[0]?.values['statistic']).toBe('0.0000');
    expect(groups[0]?.values['threshold']).toBe('0.2000');
    expect(flagsFrom(fake)).toHaveLength(6);
    expect(M07).toContain('D-03 detects at **group** level');
  });
});

// =============================================================================
// 6. `D-03`, which declines, and the arithmetic behind the decline
// =============================================================================

describe('D-03 under the seed as it stands', () => {
  it('declines naming EVERY unstated parameter at once rather than the first one', async () => {
    const { outcome } = await runOne(groupInverseExposureDetector());
    expect(outcome.status).toBe('failed');
    for (const name of [
      'window_trading_days',
      'max_variance_ratio_bp',
      'max_candidate_group_size',
    ]) {
      expect(seededState(D03, name)).toBe('unstated');
      expect(String(outcome.error)).toContain(name);
    }
    expect(String(outcome.error)).toContain('OQ-M7-02');
  });

  it('reads NOTHING when it declines, so a detector with no threshold pays for no window', async () => {
    const { fake } = await runOne(groupInverseExposureDetector());
    // The registry read happens; nothing else does.
    expect(fake.reads.map((one) => one.table)).toEqual(['detectorDefinitions']);
  });

  it('is STILL blocked with all three stated, because its severity 5 has no clock', async () => {
    const { outcome } = await runOne(groupInverseExposureDetector(), {
      parameters: {
        [D03]: {
          window_trading_days: stated(5, 'trading_days'),
          max_variance_ratio_bp: stated(2000, 'bp'),
          max_candidate_group_size: stated(8),
        },
      },
    });
    expect(outcome.status).toBe('failed');
    expect(String(outcome.error)).toContain('sla_due_at');
    expect(String(outcome.error)).toContain('SD-M7-02');
    // The seed's own severity for this detector, which is the money band.
    const severity = seedRow(D03).parameters['severity'] as { cases?: { value?: number }[] };
    expect(severity.cases?.[0]?.value).toBe(5);
    expect(M07).toContain('D-03 with a funded member eligible this week');
  });

  it('records the run even though it produced no answer, which is INV-M7-07', async () => {
    const { fake } = await runOne(groupInverseExposureDetector());
    const runs = fake.writes.filter((one) => one.table === 'detectorRuns');
    expect(runs).toHaveLength(1);
    expect(runs[0]?.values['status']).toBe('failed');
    expect(runs[0]?.values['detector']).toBe(D03);
    expect(RISK_SQL).toContain('detector_runs_unhealthy_idx');
  });

  it('finds its canary clique under supplied parameters, and writes no flag for it', async () => {
    const { outcome, fake } = await runOne(groupInverseExposureDetector(), {
      parameters: {
        [D03]: {
          window_trading_days: stated(5, 'trading_days'),
          max_variance_ratio_bp: stated(2000, 'bp'),
          max_candidate_group_size: stated(8),
          severity: stated(3, 'severity'),
        },
      },
    });
    expect(outcome.status).toBe('ok');
    expect(outcome.syntheticExpected).toBe(1);
    expect(outcome.syntheticFound).toBe(1);
    expect(flagsFrom(fake)).toEqual([]);
    expect(groupsFrom(fake)).toEqual([]);
    expect(D03_CANARY_TRADING_DAYS).toBeGreaterThanOrEqual(20);
  });

  it('NEAR MISS: three linked accounts trading independently do not fire', async () => {
    const days = tradingDays(5);
    const independent: DetectorRow[] = [];
    const legs = [
      [10n, -4n, 7n, 1n, -9n],
      [3n, 8n, -2n, 6n, 4n],
      [-5n, 2n, 9n, -7n, 1n],
    ];
    legs.forEach((leg, member) => {
      leg.forEach((value, at) => {
        independent.push(mark(`ind-a-${String(member)}`, days[at] ?? '', value * 100000n));
      });
    });
    const { outcome, fake } = await runOne(groupInverseExposureDetector(), {
      rows: {
        dailyMarks: independent,
        accounts: [0, 1, 2].map((member) =>
          account(`ind-a-${String(member)}`, `ind-i-${String(member)}`),
        ),
        identitySignals: [0, 1, 2].map((member) => signal(`ind-i-${String(member)}`, 'ind-device')),
      },
      parameters: {
        [D03]: {
          window_trading_days: stated(5, 'trading_days'),
          max_variance_ratio_bp: stated(2000, 'bp'),
          max_candidate_group_size: stated(8),
          severity: stated(3, 'severity'),
        },
      },
    });
    expect(groupsFrom(fake)).toEqual([]);
    expect(flagsFrom(fake)).toEqual([]);
    expect(outcome.status).toBe('ok');
  });

  it('NEAR MISS: a hedged group of TWO is identity_links job and never reaches the table', async () => {
    const days = tradingDays(5);
    const { fake } = await runOne(groupInverseExposureDetector(), {
      rows: {
        dailyMarks: hedgedMarks('pair-a-0', 'pair-a-1', days),
        accounts: [account('pair-a-0', 'pair-i-0'), account('pair-a-1', 'pair-i-1')],
        identitySignals: [signal('pair-i-0', 'pair-device'), signal('pair-i-1', 'pair-device')],
      },
      parameters: {
        [D03]: {
          window_trading_days: stated(5, 'trading_days'),
          max_variance_ratio_bp: stated(2000, 'bp'),
          max_candidate_group_size: stated(8),
          severity: stated(3, 'severity'),
        },
      },
    });
    expect(groupsFrom(fake)).toEqual([]);
    expect(RISK_SQL).toContain('array_length(member_account_ids, 1) >= 3');
  });

  it('NEAR MISS: a group above max_candidate_group_size is not searched at all', async () => {
    const ring = sixAccountRing(tradingDays(5));
    const { fake } = await runOne(groupInverseExposureDetector(), {
      rows: { dailyMarks: ring.marks, accounts: ring.accounts, identitySignals: ring.signals },
      parameters: {
        [D03]: {
          window_trading_days: stated(5, 'trading_days'),
          max_variance_ratio_bp: stated(2000, 'bp'),
          max_candidate_group_size: stated(5),
          severity: stated(3, 'severity'),
        },
      },
    });
    expect(groupsFrom(fake)).toEqual([]);
    expect(M07).toContain('with a bounded search size so the cost stays linear');
  });
});

// =============================================================================
// 7. `D-13`. THE THREE CONDITIONS ARE ANDED, PROVED BY BREAKING ONE AT A TIME
// =============================================================================

/** `D-13`'s parameters as they would look with `OQ-M7-02` answered. */
const D13_SUPPLIED = {
  size_mirroring_tolerance_bp: stated(100, 'bp'),
  timing_mirroring_tolerance_seconds: stated(5, 'seconds'),
  severity: stated(3, 'severity'),
};

interface FastPathOptions {
  readonly mirroredPnl?: boolean;
  readonly followerContracts?: number;
  readonly followerLagSeconds?: number;
  readonly markDays?: number;
  readonly clustered?: boolean;
}

/** A young hedged pair inside a cluster, with one condition breakable at a time. */
function fastPathRows(options: FastPathOptions = {}): Readonly<Record<string, DetectorRow[]>> {
  const markDays = options.markDays ?? 5;
  const days = tradingDays(markDays);
  const marks: DetectorRow[] = [];
  const fills: DetectorRow[] = [];
  days.forEach((day, at) => {
    const size = magnitude(at);
    marks.push(mark('fast-a-0', day, size));
    marks.push(mark('fast-a-1', day, (options.mirroredPnl ?? true) ? -size : size));
    const base = new Date(`${day}T14:30:00.000Z`);
    fills.push(fill('fast-a-0', day, base, 'buy', 2));
    fills.push(
      fill(
        'fast-a-1',
        day,
        new Date(base.getTime() + (options.followerLagSeconds ?? 1) * 1000),
        'sell',
        options.followerContracts ?? 2,
      ),
    );
  });
  return {
    dailyMarks: marks,
    fills,
    accounts: [account('fast-a-0', 'fast-i-0'), account('fast-a-1', 'fast-i-1')],
    identitySignals:
      (options.clustered ?? true)
        ? [signal('fast-i-0', 'fast-device'), signal('fast-i-1', 'fast-device')]
        : [signal('fast-i-0', 'device-0'), signal('fast-i-1', 'device-1')],
    identityLinks: [],
  };
}

describe('D-13, the young-account fast path', () => {
  it('declines under the seed, naming both unstated tolerances and its unstated severity', async () => {
    const { outcome, fake } = await runOne(youngAccountFastPathDetector());
    expect(outcome.status).toBe('failed');
    for (const name of ['size_mirroring_tolerance_bp', 'timing_mirroring_tolerance_seconds']) {
      expect(seededState(D13, name)).toBe('unstated');
      expect(String(outcome.error)).toContain(name);
    }
    expect(seededState(D13, 'severity')).toBe('unstated');
    expect(fake.reads.map((one) => one.table)).toEqual(['detectorDefinitions']);
  });

  it('reads conditions_combined from the registry and refuses a row that says otherwise', async () => {
    expect(seededValue(D13, 'conditions_combined')).toBe('conjunction');
    const { outcome } = await runOne(youngAccountFastPathDetector(), {
      parameters: {
        [D13]: { ...D13_SUPPLIED, conditions_combined: stated('disjunction', 'text') },
      },
    });
    expect(outcome.status).toBe('failed');
    expect(String(outcome.error)).toContain('All three, not any of three');
    expect(M07).toContain('All three, not any of three');
  });

  it('FIRES when all three conditions hold', async () => {
    const { outcome, fake } = await runOne(youngAccountFastPathDetector(), {
      rows: fastPathRows(),
      parameters: { [D13]: D13_SUPPLIED },
    });
    expect(outcome.status).toBe('ok');
    const flags = flagsFrom(fake);
    expect(flags).toHaveLength(2);
    const evidence = flags[0]?.values['evidence'] as Record<string, unknown>;
    expect(evidence['conditions_combined']).toBe('conjunction');
    expect(evidence['correlation_bp']).toBe(-10000);
    expect(evidence['size_deviation_bp']).toBe(0);
    expect(evidence['timing_deviation_seconds']).toBe(1);
    expect(evidence['discovered_via']).toEqual(['signal:device']);
  });

  it('finds its canary, whose whole life is exactly the window', async () => {
    const { outcome } = await runOne(youngAccountFastPathDetector(), {
      parameters: { [D13]: D13_SUPPLIED },
    });
    expect(outcome.syntheticExpected).toBe(1);
    expect(outcome.syntheticFound).toBe(1);
    expect(outcome.status).toBe('ok');
    expect(D13_CANARY_TRADING_DAYS).toBe(seededValue(D13, 'window_trading_days'));
  });

  it('NEAR MISS 1 of 3: mirrored size and timing, and NO inverse correlation', async () => {
    const { fake } = await runOne(youngAccountFastPathDetector(), {
      rows: fastPathRows({ mirroredPnl: false }),
      parameters: { [D13]: D13_SUPPLIED },
    });
    expect(flagsFrom(fake)).toEqual([]);
  });

  it('NEAR MISS 2 of 3: inverse correlation and mirrored timing, and NO size mirroring', async () => {
    const { fake } = await runOne(youngAccountFastPathDetector(), {
      rows: fastPathRows({ followerContracts: 20 }),
      parameters: { [D13]: D13_SUPPLIED },
    });
    expect(flagsFrom(fake)).toEqual([]);
  });

  it('NEAR MISS 3 of 3: inverse correlation and mirrored size, and NO timing mirroring', async () => {
    const { fake } = await runOne(youngAccountFastPathDetector(), {
      rows: fastPathRows({ followerLagSeconds: 3600 }),
      parameters: { [D13]: D13_SUPPLIED },
    });
    expect(flagsFrom(fake)).toEqual([]);
  });

  it('is a CONJUNCTION and not a disjunction, which is what the three near misses prove', async () => {
    // Each of the three fixtures satisfies TWO conditions. A disjunction would
    // have fired on all three of them and a conjunction fires on none.
    for (const broken of [
      { mirroredPnl: false },
      { followerContracts: 20 },
      { followerLagSeconds: 3600 },
    ]) {
      const { fake } = await runOne(youngAccountFastPathDetector(), {
        rows: fastPathRows(broken),
        parameters: { [D13]: D13_SUPPLIED },
      });
      expect(flagsFrom(fake)).toEqual([]);
    }
    // And the unbroken fixture, so the three above are not all failing for some
    // fourth reason.
    const { fake } = await runOne(youngAccountFastPathDetector(), {
      rows: fastPathRows(),
      parameters: { [D13]: D13_SUPPLIED },
    });
    expect(flagsFrom(fake)).toHaveLength(2);
  });

  it('NEAR MISS: an OLD pair with all three conditions is D-02s and not this detectors', async () => {
    const { fake } = await runOne(youngAccountFastPathDetector(), {
      rows: fastPathRows({ markDays: 12 }),
      parameters: { [D13]: D13_SUPPLIED },
    });
    expect(flagsFrom(fake)).toEqual([]);
    expect(M07).toContain("D-13 and D-14 both operate on D-12's clusters");
  });

  it('NEAR MISS: a pair outside every cluster is not on D-12s watched set', async () => {
    const { fake } = await runOne(youngAccountFastPathDetector(), {
      rows: fastPathRows({ clustered: false }),
      parameters: { [D13]: D13_SUPPLIED },
    });
    expect(flagsFrom(fake)).toEqual([]);
  });
});

// =============================================================================
// 8. `D-14`. POSITIONS RATHER THAN REALIZED P&L, AND THE TABLE DOES NOT EXIST
// =============================================================================

const D14_SUPPLIED = { max_abs_summed_position: stated(0), severity: stated(3, 'severity') };

/** A clique of three whose net positions sum to `net` on one symbol. */
function cliqueFills(
  legs: readonly (readonly [string, number])[],
): Readonly<Record<string, DetectorRow[]>> {
  const fills: DetectorRow[] = [];
  legs.forEach(([side, quantity], member) => {
    fills.push(
      fill(
        `clq-a-${String(member)}`,
        TRADING_DAY,
        new Date(`${TRADING_DAY}T14:3${String(member)}:00.000Z`),
        side,
        quantity,
      ),
    );
  });
  return {
    fills,
    accounts: legs.map((_, member) =>
      account(`clq-a-${String(member)}`, `clq-i-${String(member)}`),
    ),
    identitySignals: legs.map((_, member) => signal(`clq-i-${String(member)}`, 'clq-device')),
    identityLinks: [],
  };
}

describe('D-14, clique position-sum', () => {
  it('declines under the seed, and its INPUT TABLE does not exist either', async () => {
    const { outcome } = await runOne(cliquePositionSumDetector());
    expect(outcome.status).toBe('failed');
    expect(seededState(D14, 'max_abs_summed_position')).toBe('unstated');
    expect(String(outcome.error)).toContain('max_abs_summed_position');
    // THE SECOND BLOCKER, WHICH NO SEED ROW SHOWS.
    expect(SCOPE_TS).not.toMatch(/^\s*positions:/m);
    expect(SCHEMA_TS).not.toMatch(/pgTable\('[a-z_]*positions'/);
    expect([...DETECTOR_READ_TABLES]).not.toContain('positions');
    expect(M07).toContain('live and end-of-day positions across a D-12 clique');
  });

  it('works on POSITIONS and not on realized P&L, which is its whole point', async () => {
    expect(seededValue(D14, 'basis')).toBe('positions');
    const positions = netPositionsBySymbol([
      fill('a-1', TRADING_DAY, new Date(`${TRADING_DAY}T14:30:00.000Z`), 'buy', 4),
      fill('a-1', TRADING_DAY, new Date(`${TRADING_DAY}T14:31:00.000Z`), 'sell', 1),
    ]);
    expect(positions.get('a-1')?.get('ESH6')).toBe(3);
    expect(M07).toContain('working on positions rather than realized P&L');
    // No mark of any kind reaches this detector: it declares no `dailyMarks`
    // stream at all.
    const { fake } = await runOne(cliquePositionSumDetector(), {
      parameters: { [D14]: D14_SUPPLIED },
    });
    expect(fake.reads.map((one) => one.table)).not.toContain('dailyMarks');
  });

  it('FIRES on a clique whose legs sum to zero and whose gross position is not', async () => {
    const { outcome, fake } = await runOne(cliquePositionSumDetector(), {
      rows: cliqueFills([
        ['buy', 4],
        ['sell', 3],
        ['sell', 1],
      ]),
      parameters: { [D14]: D14_SUPPLIED },
    });
    expect(outcome.status).toBe('ok');
    const flags = flagsFrom(fake);
    expect(flags).toHaveLength(3);
    const evidence = flags[0]?.values['evidence'] as Record<string, unknown>;
    expect(evidence['basis']).toBe('positions');
    expect(evidence['positions_derived_from']).toBe('fills');
    expect(evidence['hedged_symbols']).toEqual([
      { symbol: 'ESH6', net_position: 0, gross_position: 8 },
    ]);
  });

  it('is INVARIANT to which pair carries the hedge, which pairwise detection is not', async () => {
    // AS-M7-02's rotation: the same clique, the leg moved to a different member.
    for (const legs of [
      [
        ['buy', 4],
        ['sell', 3],
        ['sell', 1],
      ],
      [
        ['sell', 3],
        ['buy', 4],
        ['sell', 1],
      ],
      [
        ['sell', 1],
        ['sell', 3],
        ['buy', 4],
      ],
    ] as const) {
      const { fake } = await runOne(cliquePositionSumDetector(), {
        rows: cliqueFills(legs),
        parameters: { [D14]: D14_SUPPLIED },
      });
      expect(flagsFrom(fake)).toHaveLength(3);
    }
  });

  it('NEAR MISS: an IDLE clique sums to zero and MUST NOT fire', async () => {
    // Every member opened and closed, so every net position is zero and the
    // clique sums to zero for a reason that has nothing to do with hedging.
    const rows = cliqueFills([
      ['buy', 4],
      ['buy', 3],
      ['buy', 1],
    ]);
    for (const member of [0, 1, 2]) {
      const quantity = [4, 3, 1][member] ?? 0;
      rows['fills']?.push(
        fill(
          `clq-a-${String(member)}`,
          TRADING_DAY,
          new Date(`${TRADING_DAY}T15:0${String(member)}:00.000Z`),
          'sell',
          quantity,
        ),
      );
    }
    const { outcome, fake } = await runOne(cliquePositionSumDetector(), {
      rows,
      parameters: { [D14]: D14_SUPPLIED },
    });
    expect(flagsFrom(fake)).toEqual([]);
    expect(outcome.status).toBe('ok');
  });

  it('NEAR MISS: a clique carrying a residual above the ceiling does not fire', async () => {
    const { fake } = await runOne(cliquePositionSumDetector(), {
      rows: cliqueFills([
        ['buy', 4],
        ['sell', 2],
        ['sell', 1],
      ]),
      parameters: { [D14]: D14_SUPPLIED },
    });
    expect(flagsFrom(fake)).toEqual([]);
  });

  it('fires on the same residual once the ceiling admits it, so the near miss IS the threshold', async () => {
    const { fake } = await runOne(cliquePositionSumDetector(), {
      rows: cliqueFills([
        ['buy', 4],
        ['sell', 2],
        ['sell', 1],
      ]),
      parameters: { [D14]: { ...D14_SUPPLIED, max_abs_summed_position: stated(1) } },
    });
    expect(flagsFrom(fake)).toHaveLength(3);
  });

  it('finds its canary under supplied parameters and writes no flag for it', async () => {
    const { outcome, fake } = await runOne(cliquePositionSumDetector(), {
      parameters: { [D14]: D14_SUPPLIED },
    });
    expect(outcome.syntheticExpected).toBe(1);
    expect(outcome.syntheticFound).toBe(1);
    expect(flagsFrom(fake)).toEqual([]);
  });
});

// =============================================================================
// 9. THE MEASUREMENT `ADR-157` SECTION 5 ASKED THIS SLICE FOR
// =============================================================================
//
// "A detector can pull its window through `rowsWhere` and do the join in the
// runner. What that costs is real and is named rather than waved at: THE ROWS
// CROSSING THE BOUNDARY ARE THE WINDOW'S RATHER THAN THE MATCH'S, so a detector
// over a wide window pays for every row it did not match."
//
// The dispatch asked for the number rather than the sentence. These two cases
// take it.

/** A marked population of `accounts` accounts, one hedged trio inside it. */
function population(
  accounts: number,
  days: readonly string[],
): Readonly<Record<string, DetectorRow[]>> {
  const rows: DetectorRow[] = [];
  const book: DetectorRow[] = [];
  const signals: DetectorRow[] = [];
  for (let member = 0; member < accounts; member += 1) {
    const accountId = `pop-a-${String(member).padStart(3, '0')}`;
    const identityId = `pop-i-${String(member).padStart(3, '0')}`;
    book.push(account(accountId, identityId));
    // THE TRIO SHARES ONE DEVICE. Everybody else shares nothing, so the
    // candidate search finds exactly one group.
    signals.push(signal(identityId, member < 3 ? 'trio-device' : `device-${String(member)}`));
    days.forEach((day, at) => {
      const size = magnitude(at);
      const pnl =
        member === 0 ? 2n * size : member === 1 || member === 2 ? -size : size * BigInt(member % 7);
      rows.push(mark(accountId, day, pnl));
    });
  }
  return { dailyMarks: rows, accounts: book, identitySignals: signals, identityLinks: [] };
}

describe('the cost ADR-157 section 5 named, measured', () => {
  const ACCOUNTS = 60;
  const DAYS = 20;
  const days = tradingDays(DAYS);

  it('D-03 reads the WINDOWs rows to compute over the MATCHs, and the ratio is the population', async () => {
    const { outcome, fake } = await runOne(groupInverseExposureDetector(), {
      rows: population(ACCOUNTS, days),
      parameters: {
        [D03]: {
          window_trading_days: stated(DAYS, 'trading_days'),
          max_variance_ratio_bp: stated(2000, 'bp'),
          max_candidate_group_size: stated(8),
          severity: stated(3, 'severity'),
        },
      },
    });
    expect(outcome.status).toBe('ok');
    expect(groupsFrom(fake)).toHaveLength(1);

    // WHAT CROSSED THE BOUNDARY.
    expect(outcome.rowsByStream['marks']).toBe(ACCOUNTS * DAYS);
    expect(outcome.rowsByStream['accounts']).toBe(ACCOUNTS);
    expect(outcome.rowsByStream['signals']).toBe(ACCOUNTS);
    expect(outcome.rowsScanned).toBe(ACCOUNTS * DAYS + ACCOUNTS * 2);

    // WHAT THE MATCH NEEDED.
    const matched = (groupsFrom(fake)[0]?.values['memberAccountIds'] as string[]).length * DAYS;
    expect(matched).toBe(60);

    // THE RATIO, WHICH IS THE MEASUREMENT. It is the marked population divided
    // by the group, and it GROWS as the group gets smaller, which is the
    // opposite of what a reader would guess about a narrower finding.
    expect(outcome.rowsScanned / matched).toBe(22);
    expect((ACCOUNTS * DAYS) / matched).toBe(ACCOUNTS / 3);
  });

  it('D-02 pays the same cost AND is quadratic in accounts, which M07 gives it no bound for', async () => {
    const { outcome } = await runOne(inversePairDetector(), { rows: population(ACCOUNTS, days) });
    expect(outcome.rowsByStream['marks']).toBe(ACCOUNTS * DAYS);
    expect(outcome.rowsScanned).toBe(ACCOUNTS * DAYS + ACCOUNTS);
    // Every pair of the marked population is compared, because M07:109 gives
    // D-02 no candidate bound where M07:310 gives D-03 `max_candidate_group_size`.
    // The comparison count is NOT reported on any flag: see the case below.
    expect(seededState(D03, 'max_candidate_group_size')).toBe('unstated');
    expect(seedRow(D02).parameters['max_candidate_group_size']).toBeUndefined();
  });

  it('puts NO count over its own input into a flag, because a detector cannot see a canary', async () => {
    const { outcome, fake } = await runOne(inversePairDetector(), {
      rows: population(ACCOUNTS, days),
    });
    const evidence = flagsFrom(fake)[0]?.values['evidence'] as Record<string, unknown>;
    // The canary's two accounts are in the same merged stream and are
    // indistinguishable to the detector, so "accounts in the window" computed
    // inside `scan` is 62 rather than 60 and would be a published number
    // carrying two subjects Merit manufactured.
    for (const key of ['accounts_in_window', 'pairs_compared', 'candidate_groups_considered']) {
      expect(evidence[key]).toBeUndefined();
    }
    expect(GRAPH_TS).not.toContain('pairs_compared');
    // The runner's counts ARE canary free, because it takes them before the
    // battery is merged, and they carry the same information.
    expect(outcome.rowsByStream['marks']).toBe(ACCOUNTS * DAYS);
    expect(M07).toContain('excluded from every aggregate');
  });

  it('reads a window bounded by a DERIVATION, because this tree has no trading calendar', async () => {
    const { fake } = await runOne(inversePairDetector(), { rows: {} });
    const marks = fake.reads.find((one) => one.table === 'dailyMarks');
    expect(marks?.where).toMatchObject({
      tradingDay: { term: 'at-least', value: addCalendarDays(TRADING_DAY, -40) },
    });
    expect(CALENDAR_DAYS_PER_TRADING_DAY).toBe(2);
    // The generous direction is the safe one: too small silently shortens the
    // window and turns a detection into a false negative.
    expect(readFrom(TRADING_DAY, 20) < addCalendarDays(TRADING_DAY, -20)).toBe(true);
    expect(code('apps/worker/src/detectors/canary.ts')).not.toContain('TradingCalendar');
  });
});

// =============================================================================
// 10. THE FINDINGS, ASSERTED AS ABSENCES SO THE DAY ONE CLOSES THE SUITE SAYS SO
// =============================================================================

describe('what this slice reports rather than repairs', () => {
  it('D-12 has no output table: correlation_groups requires a statistic and a threshold', () => {
    expect(RISK_SQL).toContain('statistic          numeric NOT NULL');
    expect(RISK_SQL).toContain('threshold          numeric NOT NULL');
    // A watched cluster has neither, and M07 forbids it being a flag.
    expect(M07).toContain('Output is a watched-cluster set, not a flag');
    expect(M07).toContain('it seeds D-13 and D-14 rather than accusing anyone');
    // So nothing registers it, and nothing writes one.
    expect(graphDetectors().map((one) => one.id)).not.toContain(D12);
    expect(GRAPH_TS).not.toContain(`id: ${D12}`);
  });

  it('D-12 runs NIGHTLY here and its registry row says funding time', () => {
    expect(seededValue(D12, 'runs_at')).toBe('funding');
    expect(seededValue(D12, 'window_trading_days')).toBe(0);
    // Nothing in this deployable emits or consumes an event at funding.
    expect(read('docs/ops/runbooks/CRON_INVENTORY.md')).toContain('detector');
  });

  it('SD-M7-02s clock is PROPOSED in an open question and stated nowhere', () => {
    expect(M07).toContain('need a stated time-to-first-touch');
    // The band exists, the column exists, the CHECK exists. The number does not.
    expect(RISK_SQL).toContain('sla_due_at         timestamptz NULL');
    expect(RISK_SQL).toContain('severity < 4 OR sla_due_at IS NOT NULL');

    // THE NEAREST THING TO A DURATION IS `OQ-M7-03`, AND THREE THINGS ARE WRONG
    // WITH READING IT AS ONE. It is an OPEN QUESTION for the founder rather than
    // a ruling; it PROPOSES rather than states; and it covers SEVERITY 5 only,
    // while the CHECK binds 4 as well.
    expect(M07).toContain('**OQ-M7-03. What is the SLA on severity 5?** Proposed:');
    expect(M07).toContain('4 hours to first touch during business hours, 24 hours otherwise');
    expect(M07).not.toContain('OQ-M7-03 (RULED');
    // And its business-hours arm needs a calendar this tree does not have,
    // which is the same absence CALENDAR_DAYS_PER_TRADING_DAY works around.
    expect(code('apps/worker/src/detectors/canary.ts')).not.toContain('TradingCalendar');
  });

  it('the flag_type vocabulary has no GROUP member, so a group finding borrows a pair word', () => {
    expect(RISK_SQL).toContain('flag_type          text NOT NULL');
    expect(RISK_SQL).toContain('inverse_pair, copy_cluster, news_window');
    expect(RISK_SQL).not.toContain('group_inverse_exposure');
    // The column has no CHECK, so a new value is insertable without a migration,
    // and minting one is the flags queue's decision rather than this module's.
    expect(RISK_SQL).not.toContain('CHECK (flag_type');
    expect(GRAPH_FLAG_TYPE).toBe('inverse_pair');
  });

  it('a canary cannot be sized to the parameters it has to satisfy', () => {
    // `Detector.canaries` takes a mint and not a request, so the battery cannot
    // read `window_trading_days`.
    expect(code('apps/worker/src/detectors/ports.ts')).toContain(
      'canaries(mint: CanaryMint): readonly CanarySubject[];',
    );
    expect(D02_CANARY_TRADING_DAYS).toBe(2 * Number(seededValue(D02, 'window_trading_days')));
    // D-13's is exact in BOTH directions: fewer and the window is unfilled, more
    // and the account is not young.
    expect(D13_CANARY_TRADING_DAYS).toBe(Number(seededValue(D13, 'window_trading_days')));
  });

  it('every canary this module mints carries the runs nonce and none of them is written', async () => {
    for (const detector of [
      inversePairDetector(),
      groupInverseExposureDetector(),
      youngAccountFastPathDetector(),
      cliquePositionSumDetector(),
    ]) {
      const { fake } = await runOne(detector, {
        parameters: {
          [D03]: {
            window_trading_days: stated(5, 'trading_days'),
            max_variance_ratio_bp: stated(2000, 'bp'),
            max_candidate_group_size: stated(8),
            severity: stated(3, 'severity'),
          },
          [D13]: D13_SUPPLIED,
          [D14]: D14_SUPPLIED,
        },
      });
      for (const written of fake.writes) {
        for (const value of Object.values(written.values)) {
          expect(isCanaryId(value)).toBe(false);
          if (Array.isArray(value)) {
            for (const one of value) {
              expect(isCanaryId(one)).toBe(false);
            }
          }
        }
      }
    }
  });

  it('mints every canary at an epoch before Merit exists, so a replay still finds it', () => {
    expect(CANARY_EPOCH < '2026-01-01').toBe(true);
    expect(addCalendarDays(CANARY_EPOCH, 0)).toBe(CANARY_EPOCH);
  });
});

// =============================================================================
// 11. THE BARREL, WHICH IS `P7` SECTION 9's LARGEST DECLARED COLLISION
// =============================================================================
//
// "SEVEN SLICES ON ONE HAND-MAINTAINED BARREL ... A keep-both merge of a
// re-export list type-checks and drops nothing, which is what makes it easy to
// miss rather than safe." `tsc` cannot see a leg that was dropped, because a
// shorter list is a valid list. So the check is a derivation from the source
// rather than a second hand-maintained copy of it.

describe('apps/worker/src/index.ts, the barrel', () => {
  const BARREL = read('apps/worker/src/index.ts');

  /** Every name a module exports, read from its source. */
  function exportedNames(path: string): readonly string[] {
    const source = code(path);
    const found = new Set<string>();
    for (const match of source.matchAll(
      /^export (?:async )?(?:function|const|class|interface|type) (\w+)/gm,
    )) {
      found.add(match[1] ?? '');
    }
    return [...found].filter((name) => name.length > 0).sort();
  }

  it('re-exports every name src/detectors/graph.ts declares', () => {
    const missing = exportedNames('apps/worker/src/detectors/graph.ts').filter(
      (name) => !new RegExp(`(^|[\\s,{])${name}(,|\\s|$)`, 'm').test(BARREL),
    );
    expect(missing).toEqual([]);
  });

  it('still carries P7-es three legs beside this one, which is what a keep-both merge loses', () => {
    for (const leg of ['./detectors/canary.ts', './detectors/ports.ts', './detectors/runner.ts']) {
      expect(BARREL).toContain(`} from '${leg}';`);
    }
    expect(BARREL).toContain("} from './detectors/graph.ts';");
    // The names a lost leg would take with it, one per module, spot checked
    // because the regexp above only covers this slice's own file.
    for (const name of ['canaryMint', 'UNWIRED_DETECTOR_RUNNER_IO', 'runDetectors']) {
      expect(BARREL).toContain(name);
    }
  });
});
