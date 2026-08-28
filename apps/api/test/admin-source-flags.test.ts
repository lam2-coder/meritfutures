// =============================================================================
// apps/api/test/admin-source-flags.test.ts
// =============================================================================
// `P7-i`'s suite. THE CENTRE OF IT IS `GS-120` AND EVERYTHING ELSE IS SUPPORT.
//
// `GS-120`, verbatim: "Fifty innocent D-01 clusters do not outrank one identity
// with three independent detector families implicated". `AS-M7-03`. That case is
// section 1 below and it is written the strong way: the noisy identity carries
// MORE flags AND a HIGHER severity than the corroborated one, so an
// implementation that ordered by count, by severity, or by flag type would pass
// a weaker version of this test and fails this one.
//
// -----------------------------------------------------------------------------
// THE THREE CHEAP IMPLEMENTATIONS THIS SUITE EXISTS TO REFUSE
// -----------------------------------------------------------------------------
// 1. ORDER BY RAW FLAG COUNT. `AS-M7-03` names it: "not by raw flag count".
//    Section 1 refuses it, fifty against three.
// 2. ONE FAMILY PER DETECTOR. Reads plausibly, and section 2 refuses it: D-01,
//    D-04 and D-05 all read `fills`, so three detectors on one poisoned stream
//    would score depth 3 and outrank a genuinely corroborated identity.
// 3. ONE FAMILY PER `flag_type`. The same defect wearing the column the row
//    actually carries, because those three detectors write `copy_cluster`,
//    `news_window` and `martingale`. Section 2 refuses it with the same fixture,
//    which is why that fixture is built out of the real flag-type constants
//    rather than out of invented strings.
//
// -----------------------------------------------------------------------------
// THE COLLISION IS ASSERTED HERE RATHER THAN LEFT IN A COMMENT
// -----------------------------------------------------------------------------
// Section 8. API_CONTRACT section 8 sorts this queue by severity then age,
// `routes/admin-reads.ts` enforces that flat across the page, and a
// corroboration page violates it by construction. Both sentences are read out of
// their own documents at run time and the violation is asserted as a fact, so
// the day either document moves this suite says so instead of a 500 discovering
// it in front of an operator. `admin-reads.ts` is `P7-b`'s file and is NOT
// edited by this slice.
// =============================================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TABLE_KEYS } from '@merit/db';
import type { SystemTx, TableKey } from '@merit/db';

import {
  DETECTOR_FAMILIES,
  FAMILY_BY_DETECTOR,
  FLAG_READ_TABLES,
  UNATTRIBUTED_DETECTOR,
  UNRESOLVED_FLAG_STATUSES,
  familyOf,
  readCorroboration,
  readFlagQueue,
} from '../src/admin-source/flags.ts';
import type { FlagsTx } from '../src/admin-source/flags.ts';
import {
  DEFAULT_GRAPH_LIMITS,
  GRAPH_READ_TABLES,
  readIdentityGraph,
} from '../src/admin-source/graph.ts';
import type { GraphTx } from '../src/admin-source/graph.ts';
import { IMPLEMENTED_ADMIN_READS, composeAdminReadSource } from '../src/admin-source/index.ts';
import type { AdminSourceTx } from '../src/admin-source/index.ts';
import { AdminReadError } from '../src/routes/admin-reads.ts';
import type { FlagListItem, FlagListQuery } from '../src/routes/admin-reads.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const REPO = join(APP, '..', '..');

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

// -----------------------------------------------------------------------------
// The recorder
// -----------------------------------------------------------------------------

type Row = Readonly<Record<string, unknown>>;
type Tables = Readonly<Record<string, readonly Row[]>>;

/**
 * ADR-112's read vocabulary, and NOTHING ELSE ON THE OBJECT.
 *
 * THAT IS AN ASSERTION AND NOT A CONVENIENCE. Both adapters are handed a value
 * carrying exactly `rows`, `rowsWhere` and `rowAt`, so if either ever reached for
 * `insert`, `updateAt`, `deleteAt` or `sqlExecutor` every case in this file
 * would fail with a `TypeError` rather than pass quietly. The read-only
 * narrowing in `FlagsTx` and `GraphTx` is proved by this fake existing.
 *
 * `rowsWhere` is an ANDed conjunction of EQUALITIES, which is what the real
 * accessor composes (ADR-112). It is deliberately not smarter: an in-memory
 * filter that supported more than the accessor does would let this suite agree
 * with a fake about a predicate the database would refuse.
 */
class Recorder {
  readonly calls: string[] = [];

  constructor(private readonly tables: Tables) {}

  rows(key: string): Promise<unknown[]> {
    this.calls.push(`rows ${key}`);
    return Promise.resolve([...(this.tables[key] ?? [])]);
  }

  rowsWhere(key: string, where: Row): Promise<unknown[]> {
    const terms = Object.keys(where).sort();
    if (terms.length === 0)
      throw new Error(`rowsWhere ${key} was handed an empty filter, which does not compile`);
    this.calls.push(`rowsWhere ${key} ${terms.join('+')}`);
    return Promise.resolve(
      (this.tables[key] ?? []).filter((row) => terms.every((term) => row[term] === where[term])),
    );
  }

  rowAt(key: string, at: Row): Promise<unknown> {
    const terms = Object.keys(at).sort();
    this.calls.push(`rowAt ${key} ${terms.join('+')}`);
    return Promise.resolve(
      (this.tables[key] ?? []).find((row) => terms.every((term) => row[term] === at[term])),
    );
  }
}

function flagsTx(tables: Tables): { tx: FlagsTx; recorder: Recorder } {
  const recorder = new Recorder(tables);
  return { tx: recorder as unknown as FlagsTx, recorder };
}

function graphTx(tables: Tables): { tx: GraphTx; recorder: Recorder } {
  const recorder = new Recorder(tables);
  return { tx: recorder as unknown as GraphTx, recorder };
}

// -----------------------------------------------------------------------------
// The fixtures
// -----------------------------------------------------------------------------

/** The three `flag_type`s `detectors/fills.ts` writes, by their own names. */
const D01_FLAG_TYPE = 'copy_cluster';
const D04_FLAG_TYPE = 'news_window';
const D05_FLAG_TYPE = 'martingale';

interface FlagSpec {
  readonly id: string;
  readonly identityId: string;
  readonly detector: string;
  readonly severity: number;
  readonly status?: string;
  readonly flagType?: string;
  readonly firstDetectedOn?: string;
  readonly accountId?: string | null;
  readonly evidence?: Row;
}

/** One `risk_flags` row and the `detector_runs` row it points at. */
function flag(spec: FlagSpec): { flag: Row; run: Row } {
  const runId = `run-${spec.detector}`;
  return {
    flag: {
      id: spec.id,
      identityId: spec.identityId,
      accountId: spec.accountId ?? null,
      flagType: spec.flagType ?? 'copy_cluster',
      severity: spec.severity,
      status: spec.status ?? 'open',
      source: 'internal',
      detectorRunId: runId,
      evidence: spec.evidence ?? { pair_share_bp: 6000, window_seconds: 2 },
      firstDetectedOn: spec.firstDetectedOn ?? '2026-08-20',
    },
    run: { id: runId, detector: spec.detector, detectorVersion: 'v1' },
  };
}

function tablesOf(specs: readonly FlagSpec[]): Tables {
  const built = specs.map(flag);
  const runs = new Map<string, Row>();
  for (const one of built) runs.set(one.run['id'] as string, one.run);
  return { riskFlags: built.map((one) => one.flag), detectorRuns: [...runs.values()] };
}

const WHOLE_QUEUE: FlagListQuery = {
  flagType: null,
  status: null,
  severity: null,
  limit: 100,
  cursor: null,
};

function query(over: Partial<FlagListQuery> = {}): FlagListQuery {
  return { ...WHOLE_QUEUE, ...over };
}

function identitiesInOrder(items: readonly FlagListItem[]): readonly string[] {
  const seen: string[] = [];
  for (const item of items) if (!seen.includes(item.identity_id)) seen.push(item.identity_id);
  return seen;
}

// =============================================================================
// 0. THE SHAPES
// =============================================================================

describe('the tables these modules name', () => {
  it('are all keys packages/db registers', () => {
    // The half neither module can make about itself: `@merit/db` is reachable
    // from `src/db.ts` and from this suite, and nothing under `admin-source/`
    // imports it.
    const keys: readonly TableKey[] = [...FLAG_READ_TABLES, ...GRAPH_READ_TABLES];
    for (const key of keys) expect(TABLE_KEYS).toContain(key);
  });

  it('are the tables the two reads actually touch and no wider', () => {
    expect([...FLAG_READ_TABLES].sort()).toStrictEqual(['detectorRuns', 'riskFlags']);
    expect([...GRAPH_READ_TABLES].sort()).toStrictEqual([
      'accounts',
      'identities',
      'identityLinks',
      'payoutRequests',
      'ruleStates',
    ]);
  });
});

describe('the handle', () => {
  it('is satisfied by SystemTx, so the operator door needs no new shape', () => {
    // COMPILE-TIME, AND THE ASSIGNMENT IS THE ASSERTION. If `AdminSourceTx` ever
    // asked for something `SystemTx` does not carry, this line fails `tsc` and no
    // run-time expectation is needed. It is `null as unknown as` rather than a
    // real handle because taking one would open a connection.
    const handle: AdminSourceTx = null as unknown as SystemTx;
    expect(handle).toBeNull();
  });

  it('carries no write method, proved by both adapters running against a fake that has none', async () => {
    const recorder = new Recorder(
      tablesOf([{ id: 'f1', identityId: 'i1', detector: 'D-01', severity: 3 }]),
    );
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(recorder)).sort()).toStrictEqual([
      'constructor',
      'rowAt',
      'rows',
      'rowsWhere',
    ]);
    const result = await readFlagQueue(recorder as unknown as FlagsTx, query());
    expect(result.page.data).toHaveLength(1);
  });
});

// =============================================================================
// 1. GS-120. THE CASE THIS SLICE EXISTS FOR
// =============================================================================

describe('GS-120: queue ordering under manufactured noise', () => {
  /**
   * `AS-M7-03`'s attack, built at its own numbers.
   *
   * `noisy` is the manufactured half: fifty D-01 clusters, every one technically
   * correct, every one at severity 3. `ring` is the real case: three flags,
   * severity 2, across `daily-marks`, `payout-transfers` and `attributions`.
   *
   * THE NOISY IDENTITY WINS ON BOTH OF THE WRONG KEYS. It has 47 more flags and
   * it is a whole severity band higher, so a queue ordered by count OR by
   * severity puts it first and this fixture says so.
   */
  const specs: readonly FlagSpec[] = [
    ...Array.from({ length: 50 }, (_unused, index) => ({
      id: `noise-${String(index).padStart(2, '0')}`,
      identityId: 'noisy',
      detector: 'D-01',
      flagType: D01_FLAG_TYPE,
      severity: 3,
    })),
    { id: 'ring-a', identityId: 'ring', detector: 'D-02', flagType: 'inverse_pair', severity: 2 },
    {
      id: 'ring-b',
      identityId: 'ring',
      detector: 'D-09',
      flagType: 'payment_velocity',
      severity: 2,
    },
    {
      id: 'ring-c',
      identityId: 'ring',
      detector: 'D-10',
      flagType: 'affiliate_self_deal',
      severity: 2,
    },
  ];

  it('ranks three families above fifty flags from one, and severity does not rescue the noise', async () => {
    const { tx } = flagsTx(tablesOf(specs));
    const { page } = await readFlagQueue(tx, query());

    expect(page.data).toHaveLength(53);
    // THE ASSERTION. Every one of the ring's three flags precedes every one of
    // the fifty, at a LOWER severity and a smaller count.
    expect(page.data.slice(0, 3).map((item) => item.flag_id)).toStrictEqual([
      'ring-a',
      'ring-b',
      'ring-c',
    ]);
    expect(identitiesInOrder(page.data)).toStrictEqual(['ring', 'noisy']);
    expect(page.data.slice(0, 3).every((item) => item.severity === 2)).toBe(true);
    expect(page.data[3]?.severity).toBe(3);
  });

  it('scores the depths the way AS-M7-03 counts them', async () => {
    const { tx } = flagsTx(tablesOf(specs));
    const noisy = await readCorroboration(tx, 'noisy');
    const ring = await readCorroboration(tx, 'ring');

    expect(noisy).toStrictEqual({ identityId: 'noisy', depth: 1, families: ['fills'] });
    expect(ring).toStrictEqual({
      identityId: 'ring',
      depth: 3,
      families: ['attributions', 'daily-marks', 'payout-transfers'],
    });
  });

  it('does not move the noisy identity up when the poisoning gets louder', async () => {
    // The adversary doubles the volume. `AS-M7-03`: "poisoning one detector does
    // not move an identity up the queue", and the depth is the reason it cannot.
    const louder = [
      ...specs,
      ...Array.from({ length: 50 }, (_unused, index) => ({
        id: `more-${String(index).padStart(2, '0')}`,
        identityId: 'noisy',
        detector: 'D-01',
        flagType: D01_FLAG_TYPE,
        severity: 3,
      })),
    ];
    const { tx } = flagsTx(tablesOf(louder));
    const { page } = await readFlagQueue(tx, query({ limit: 3 }));
    expect(page.data.map((item) => item.identity_id)).toStrictEqual(['ring', 'ring', 'ring']);
  });
});

// =============================================================================
// 2. INDEPENDENCE IS THE INPUT, NOT THE DETECTOR AND NOT THE FLAG TYPE
// =============================================================================

describe('independent means the input an adversary would have to manufacture', () => {
  /**
   * ONE POISONED `fills` STREAM, THREE DETECTORS, THREE `flag_type`s.
   *
   * D-01, D-04 and D-05 all read `fills` (`M07` section 3.2) and write
   * `copy_cluster`, `news_window` and `martingale`. An implementation counting
   * detectors, or counting flag types, scores `poisoned` at depth 3 and puts it
   * above `real`, which carries two genuinely separate streams. THAT IS THE
   * ATTACK SUCCEEDING against the control written to stop it.
   */
  const specs: readonly FlagSpec[] = [
    { id: 'p1', identityId: 'poisoned', detector: 'D-01', flagType: D01_FLAG_TYPE, severity: 3 },
    { id: 'p2', identityId: 'poisoned', detector: 'D-04', flagType: D04_FLAG_TYPE, severity: 3 },
    { id: 'p3', identityId: 'poisoned', detector: 'D-05', flagType: D05_FLAG_TYPE, severity: 3 },
    { id: 'r1', identityId: 'real', detector: 'D-02', flagType: 'inverse_pair', severity: 1 },
    { id: 'r2', identityId: 'real', detector: 'D-08', flagType: 'payment_velocity', severity: 1 },
  ];

  it('gives three fills detectors one family and two separate streams two', async () => {
    const { tx } = flagsTx(tablesOf(specs));
    expect((await readCorroboration(tx, 'poisoned')).depth).toBe(1);
    expect((await readCorroboration(tx, 'real')).depth).toBe(2);
  });

  it('ranks the two real streams above the three poisoned ones, at a lower severity', async () => {
    const { tx } = flagsTx(tablesOf(specs));
    const { page } = await readFlagQueue(tx, query());
    expect(identitiesInOrder(page.data)).toStrictEqual(['real', 'poisoned']);
  });

  it('gives every detector M07 section 3.2 lists exactly one family', () => {
    for (const [detector, family] of Object.entries(FAMILY_BY_DETECTOR)) {
      expect(DETECTOR_FAMILIES, `${detector} names a family outside the closed set`).toContain(
        family,
      );
      expect(typeof family).toBe('string');
    }
    // NO DETECTOR CONTRIBUTES MORE THAN ONE. The map's value type is one family
    // and this asserts the property the type expresses, so a later author who
    // widens it to an array meets a red test rather than a silent inflation.
    expect(Object.values(FAMILY_BY_DETECTOR).every((value) => typeof value === 'string')).toBe(
      true,
    );
  });

  it('makes an unknown detector its own family, which cannot inflate a depth', async () => {
    expect(familyOf('D-99')).toBe('D-99');
    const loud = Array.from({ length: 40 }, (_unused, index) => ({
      id: `u${String(index).padStart(2, '0')}`,
      identityId: 'unknown-detector',
      detector: 'D-99',
      severity: 4,
    }));
    const { tx } = flagsTx(tablesOf(loud));
    expect((await readCorroboration(tx, 'unknown-detector')).depth).toBe(1);
  });

  it('lets an unknown detector still corroborate a known one, so a new detector is not invisible', async () => {
    const { tx } = flagsTx(
      tablesOf([
        { id: 'n1', identityId: 'mixed', detector: 'D-99', severity: 2 },
        { id: 'n2', identityId: 'mixed', detector: 'D-02', severity: 2 },
      ]),
    );
    const corroboration = await readCorroboration(tx, 'mixed');
    expect(corroboration.depth).toBe(2);
    expect(corroboration.families).toStrictEqual(['D-99', 'daily-marks']);
  });

  it('names a flag with no detector run rather than borrowing its source', async () => {
    const { tx } = flagsTx({
      riskFlags: [
        {
          id: 'vendor-1',
          identityId: 'vendor',
          accountId: null,
          flagType: 'copy_cluster',
          severity: 3,
          status: 'open',
          source: 'vendor:quantsentry',
          detectorRunId: null,
          evidence: {},
          firstDetectedOn: '2026-08-20',
        },
      ],
      detectorRuns: [],
    });
    const { page } = await readFlagQueue(tx, query());
    expect(page.data[0]?.detector).toBe(UNATTRIBUTED_DETECTOR);
    expect(page.data[0]?.detector).not.toBe('internal');
    expect(page.data[0]?.detector).not.toBe('vendor:quantsentry');
  });
});

// =============================================================================
// 3. DEPTH COUNTS UNRESOLVED FLAGS ONLY
// =============================================================================

describe('a dismissed flag is not corroboration', () => {
  it('refuses to let refuted noise be banked as depth', async () => {
    // The adversary manufactures three families' worth, every one of them
    // dismissed by an operator, and one live flag. If dismissals counted, this
    // identity would sit at depth 4 forever on the strength of findings that
    // were all judged wrong.
    const { tx } = flagsTx(
      tablesOf([
        { id: 'd1', identityId: 'banked', detector: 'D-02', severity: 3, status: 'dismissed' },
        { id: 'd2', identityId: 'banked', detector: 'D-09', severity: 3, status: 'dismissed' },
        { id: 'd3', identityId: 'banked', detector: 'D-10', severity: 3, status: 'dismissed' },
        { id: 'd4', identityId: 'banked', detector: 'D-01', severity: 3, status: 'open' },
        { id: 'g1', identityId: 'genuine', detector: 'D-02', severity: 1, status: 'open' },
        { id: 'g2', identityId: 'genuine', detector: 'D-08', severity: 1, status: 'investigating' },
      ]),
    );
    expect((await readCorroboration(tx, 'banked')).depth).toBe(1);
    expect((await readCorroboration(tx, 'genuine')).depth).toBe(2);

    const { page } = await readFlagQueue(tx, query());
    expect(identitiesInOrder(page.data)).toStrictEqual(['genuine', 'banked']);
  });

  it('counts investigating beside open, which is ADR-040s band and not a new one', () => {
    expect([...UNRESOLVED_FLAG_STATUSES]).toStrictEqual(['open', 'investigating']);
  });

  it('does not count an enforced flag, which is a finished case rather than a queue item', async () => {
    const { tx } = flagsTx(
      tablesOf([
        { id: 'e1', identityId: 'closed-case', detector: 'D-02', severity: 5, status: 'enforced' },
        { id: 'e2', identityId: 'closed-case', detector: 'D-09', severity: 5, status: 'enforced' },
        { id: 'e3', identityId: 'closed-case', detector: 'D-01', severity: 5, status: 'open' },
      ]),
    );
    expect((await readCorroboration(tx, 'closed-case')).depth).toBe(1);
  });
});

// =============================================================================
// 4. WITHIN A BAND, THE CONTRACT'S SORT IS EXACTLY WHAT AN OPERATOR GETS
// =============================================================================

describe('severity then age, within one corroboration band', () => {
  it('orders by severity descending then by age ascending then by id', async () => {
    const { tx } = flagsTx(
      tablesOf([
        {
          id: 'b',
          identityId: 'one',
          detector: 'D-01',
          severity: 3,
          firstDetectedOn: '2026-08-01',
        },
        {
          id: 'a',
          identityId: 'one',
          detector: 'D-01',
          severity: 3,
          firstDetectedOn: '2026-08-01',
        },
        {
          id: 'c',
          identityId: 'one',
          detector: 'D-01',
          severity: 5,
          firstDetectedOn: '2026-08-20',
        },
        {
          id: 'd',
          identityId: 'one',
          detector: 'D-01',
          severity: 3,
          firstDetectedOn: '2026-07-01',
        },
      ]),
    );
    const { page } = await readFlagQueue(tx, query());
    // 5 first; then the three 3s oldest first; then the id breaking the exact tie.
    expect(page.data.map((item) => item.flag_id)).toStrictEqual(['c', 'd', 'a', 'b']);
  });
});

// =============================================================================
// 5. THE FILTERS, AND WHERE CORROBORATION IS COMPUTED
// =============================================================================

describe('the filters', () => {
  /**
   * THE IDS ARE CHOSEN SO THE LAST TIE-BREAK WORKS AGAINST THE RIGHT ANSWER.
   *
   * The first draft named the corroborated identity's flags `x1` and the lonely
   * one's `y1`, `y2`, and seeding "compute corroboration over the filtered page"
   * did NOT turn it red: with both identities collapsed to depth 1 the flag id
   * broke the tie and put `x1` first anyway, which is the right order for the
   * wrong reason. `z1` sorts LAST, so only an implementation that reads the rows
   * the filter hid can put it first.
   */
  const specs: readonly FlagSpec[] = [
    { id: 'z1', identityId: 'corroborated', detector: 'D-02', severity: 5 },
    { id: 'z2', identityId: 'corroborated', detector: 'D-09', severity: 2 },
    { id: 'z3', identityId: 'corroborated', detector: 'D-10', severity: 2 },
    { id: 'a1', identityId: 'lonely', detector: 'D-01', severity: 5 },
    { id: 'a2', identityId: 'lonely', detector: 'D-01', severity: 5 },
  ];

  it('reads the whole table when nothing is filtered, rather than a narrowing that is true', async () => {
    const { tx, recorder } = flagsTx(tablesOf(specs));
    await readFlagQueue(tx, query());
    expect(recorder.calls).toContain('rows riskFlags');
    expect(recorder.calls.filter((call) => call === 'rowsWhere riskFlags status')).toHaveLength(0);
  });

  it('pushes every one of section 8s three filters down as an equality', async () => {
    const { tx, recorder } = flagsTx(tablesOf(specs));
    await readFlagQueue(tx, query({ flagType: 'copy_cluster', status: 'open', severity: 5 }));
    expect(recorder.calls[0]).toBe('rowsWhere riskFlags flagType+severity+status');
    expect(recorder.calls).not.toContain('rows riskFlags');
  });

  it('computes corroboration over the identitys whole set and never over the filtered page', async () => {
    // Filtered to severity 5, both identities contribute one or two rows. The
    // corroboration that decides the order lives entirely in the rows the FILTER
    // HID, so an implementation that ranked over the filtered set alone would
    // read both at depth 1 and fall back to the id.
    const { tx } = flagsTx(tablesOf(specs));
    const { page } = await readFlagQueue(tx, query({ severity: 5 }));
    expect(page.data.map((item) => item.flag_id)).toStrictEqual(['z1', 'a1', 'a2']);
    expect(identitiesInOrder(page.data)).toStrictEqual(['corroborated', 'lonely']);
  });

  it('reports what it cost, so an expensive page is a number rather than a surprise', async () => {
    const { tx } = flagsTx(tablesOf(specs));
    const { cost } = await readFlagQueue(tx, query());
    expect(cost).toStrictEqual({
      filteredFlags: 5,
      identities: 2,
      corroborationRows: 5,
      // Four distinct runs: D-02, D-09, D-10 and D-01.
      detectorRuns: 4,
    });
  });
});

// =============================================================================
// 6. PAGING
// =============================================================================

describe('the cursor', () => {
  const specs: readonly FlagSpec[] = [
    { id: 'a1', identityId: 'deep', detector: 'D-02', severity: 2 },
    { id: 'a2', identityId: 'deep', detector: 'D-09', severity: 4 },
    { id: 'a3', identityId: 'deep', detector: 'D-10', severity: 1 },
    { id: 'b1', identityId: 'shallow', detector: 'D-01', severity: 5 },
    {
      id: 'b2',
      identityId: 'shallow',
      detector: 'D-01',
      severity: 5,
      firstDetectedOn: '2026-08-19',
    },
    { id: 'b3', identityId: 'shallow', detector: 'D-01', severity: 3 },
  ];

  it('walks every flag exactly once across pages, in the same order one page would give', async () => {
    const { tx } = flagsTx(tablesOf(specs));
    const whole = await readFlagQueue(tx, query());
    const walked: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await readFlagQueue(tx, query({ limit: 2, cursor }));
      walked.push(...page.page.data.map((item) => item.flag_id));
      cursor = page.page.next_cursor;
      if (cursor === null) break;
    }
    expect(walked).toStrictEqual(whole.page.data.map((item) => item.flag_id));
    expect(new Set(walked).size).toBe(walked.length);
  });

  it('reports no next cursor on the last page, so a client stops', async () => {
    const { tx } = flagsTx(tablesOf(specs));
    const page = await readFlagQueue(tx, query({ limit: 6 }));
    expect(page.page.data).toHaveLength(6);
    expect(page.page.next_cursor).toBeNull();
  });

  it('refuses a cursor from a different ordering rather than paging at a meaningless position', async () => {
    const { tx } = flagsTx(tablesOf(specs));
    const foreign = Buffer.from('a2', 'utf8').toString('base64url');
    await expect(readFlagQueue(tx, query({ cursor: foreign }))).rejects.toThrow(AdminReadError);
  });
});

// =============================================================================
// 7. THE ROWS, READ DEFENSIVELY
// =============================================================================

describe('a row an operator must not be shown', () => {
  function oneFlag(over: Row): Tables {
    return {
      riskFlags: [
        {
          id: 'f1',
          identityId: 'i1',
          accountId: null,
          flagType: 'copy_cluster',
          severity: 3,
          status: 'open',
          detectorRunId: null,
          evidence: {},
          firstDetectedOn: '2026-08-20',
          ...over,
        },
      ],
      detectorRuns: [],
    };
  }

  it('refuses a severity outside the CHECK rather than rendering it at a default band', async () => {
    const { tx } = flagsTx(oneFlag({ severity: 6 }));
    await expect(readFlagQueue(tx, query())).rejects.toThrow(/BETWEEN 1 AND 5/);
  });

  it('refuses a status outside the closed set', async () => {
    const { tx } = flagsTx(oneFlag({ status: 'escalated' }));
    await expect(readFlagQueue(tx, query())).rejects.toThrow(/not one of open, investigating/);
  });

  it('refuses evidence that is not an object', async () => {
    const { tx } = flagsTx(oneFlag({ evidence: 'clustered' }));
    await expect(readFlagQueue(tx, query())).rejects.toThrow(/evidence that is not an object/);
  });

  it('refuses a first_detected_on that is not a trading day', async () => {
    const { tx } = flagsTx(oneFlag({ firstDetectedOn: '2026-08-20T00:00:00Z' }));
    await expect(readFlagQueue(tx, query())).rejects.toThrow(/exchange trading day/);
  });

  it('converts a Date through its UTC parts rather than a local clock', async () => {
    const { tx } = flagsTx(oneFlag({ firstDetectedOn: new Date('2026-08-20T00:30:00.000Z') }));
    const { page } = await readFlagQueue(tx, query());
    expect(page.data[0]?.first_detected_on).toBe('2026-08-20');
  });

  it('renders no date through a local accessor, which is the half the case above cannot see', () => {
    // **THE CASE ABOVE IS BLIND TO THIS AND THAT IS MEASURED RATHER THAN
    // ASSUMED.** Seeding `getUTCFullYear` to `getFullYear` in both modules left
    // it GREEN, because CI and this container both run at `TZ=UTC` and the two
    // accessors agree there. A control that only fires on a developer's laptop
    // is not a control, so the property is asserted at the source instead: no
    // file under `admin-source/` may reach a local-clock accessor at all.
    //
    // Storage is UTC and the trading day follows the exchange session calendar
    // in CT, so a `date` rendered through a local clock is off by one for the
    // hours the two disagree, and `assertContractScalars` would pass the wrong
    // day happily because it checks the SHAPE of a `_on` member and not its
    // value.
    for (const name of ['flags.ts', 'graph.ts', 'index.ts']) {
      const source = read(join(APP, 'src', 'admin-source', name));
      for (const local of ['getFullYear(', 'getMonth(', 'getDate(', 'toLocaleDateString('])
        expect(source, `${name} reads a Date through ${local}`).not.toContain(local);
    }
    // And the UTC accessors are present where a date is rendered, so this case
    // cannot pass by the conversion having been deleted.
    const flags = read(join(APP, 'src', 'admin-source', 'flags.ts'));
    for (const utc of ['getUTCFullYear(', 'getUTCMonth(', 'getUTCDate(']) {
      expect(flags).toContain(utc);
      expect(read(join(APP, 'src', 'admin-source', 'graph.ts'))).toContain(utc);
    }
  });
});

describe('evidence_summary', () => {
  it('carries the names of the numbers and never the numbers', async () => {
    const { tx } = flagsTx(
      tablesOf([
        {
          id: 'f1',
          identityId: 'i1',
          detector: 'D-01',
          severity: 3,
          evidence: { window_seconds: 2, pair_share_bp: 6100, shared_fills: 47 },
        },
      ]),
    );
    const { page } = await readFlagQueue(tx, query());
    const summary = page.data[0]?.evidence_summary ?? '';
    expect(summary).toBe('pair_share_bp, shared_fills, window_seconds');
    // INV-M7-10. Not one threshold, count or measurement reaches the summary.
    for (const value of ['2', '6100', '47']) expect(summary).not.toContain(value);
  });
});

// =============================================================================
// 8. THE COLLISION WITH API_CONTRACT SECTION 8, ASSERTED RATHER THAN DESCRIBED
// =============================================================================

describe('the ordering this queue is given and the ordering the route enforces', () => {
  const CONTRACT = read(join(REPO, 'docs', 'architecture', 'API_CONTRACT.md'));
  const M07 = read(join(REPO, 'docs', 'plans', 'M07-risk-abuse.md'));
  const ADMIN_READS = read(join(APP, 'src', 'routes', 'admin-reads.ts'));

  it('reads both sentences out of their own documents, because a paraphrase is what drifts', () => {
    // API_CONTRACT section 8, `GET /admin/flags`.
    expect(CONTRACT).toContain(
      'Sorted by severity then age. Filterable by type, status, severity.',
    );
    // M07 AS-M7-03 clause 3.
    expect(M07).toContain(
      'The queue sorts by the number of **independent** detector families implicated on an identity, not by raw flag count.',
    );
  });

  it('finds the route still enforcing severity monotonically across the page', () => {
    // `assertFlagOrder` is module private, so this reads the refusal at its
    // source. The day `P7-b`'s owner changes it, this case says so.
    expect(ADMIN_READS).toContain('function assertFlagOrder');
    expect(ADMIN_READS).toContain('if (previous.severity < current.severity)');
  });

  it('produces a page that assertFlagOrder refuses, which is the collision as a fact', async () => {
    // GS-120's own fixture: the corroborated identity is at severity 2 and the
    // noisy one at 3, so the page inverts severity by construction. THIS IS NOT
    // A DEFECT IN THIS ADAPTER. It is two approved documents stating different
    // sorts for one queue, and it is asserted here so the wiring slice meets it
    // as a red test rather than as a 500 in front of an operator.
    const { tx } = flagsTx(
      tablesOf([
        { id: 'ring-a', identityId: 'ring', detector: 'D-02', severity: 2 },
        { id: 'ring-b', identityId: 'ring', detector: 'D-09', severity: 2 },
        { id: 'ring-c', identityId: 'ring', detector: 'D-10', severity: 2 },
        { id: 'noise-1', identityId: 'noisy', detector: 'D-01', severity: 3 },
      ]),
    );
    const { page } = await readFlagQueue(tx, query());

    const inversions = page.data.filter(
      (item, index) => index > 0 && (page.data[index - 1]?.severity ?? 0) < item.severity,
    );
    expect(inversions.map((item) => item.flag_id)).toStrictEqual(['noise-1']);
  });
});

// =============================================================================
// 9. THE GRAPH
// =============================================================================

/**
 * The five tables a graph read touches, named, and still a {@link Tables}.
 *
 * IT EXTENDS RATHER THAN REDECLARES, and that is not a style choice: the first
 * draft was a plain interface, which carries no index signature and is therefore
 * NOT assignable to `Tables`. `pnpm vitest` transpiles and does not type-check,
 * so the whole suite ran green over fifteen `tsc` errors, which is
 * `apps/api/test/admin-writes.test.ts`'s own warning about the gap between the
 * two arriving one file over.
 */
interface GraphFixture extends Tables {
  readonly identities: readonly Row[];
  readonly accounts: readonly Row[];
  readonly identityLinks: readonly Row[];
  readonly ruleStates: readonly Row[];
  readonly payoutRequests: readonly Row[];
}

function link(over: Row): Row {
  return {
    id: 'l1',
    identityA: 'a',
    identityB: 'b',
    linkKind: 'shared_device',
    confidenceBp: 7000,
    evidence: { device_fingerprint_seen: 4 },
    suppressed: false,
    ...over,
  };
}

const SIMPLE: GraphFixture = {
  identities: [
    { id: 'a', status: 'active' },
    { id: 'b', status: 'restricted' },
    { id: 'c', status: 'active' },
  ],
  accounts: [
    { id: 'acc-a1', identityId: 'a', phase: 'funded' },
    { id: 'acc-a2', identityId: 'a', phase: 'eval' },
    { id: 'acc-b1', identityId: 'b', phase: 'funded' },
  ],
  identityLinks: [link({ id: 'l1', identityA: 'a', identityB: 'b' })],
  ruleStates: [
    { accountId: 'acc-a1', tradingDay: '2026-08-19', withdrawableCents: 100_00n },
    { accountId: 'acc-a1', tradingDay: '2026-08-20', withdrawableCents: 250_00n },
    { accountId: 'acc-a2', tradingDay: '2026-08-20', withdrawableCents: 7_00n },
    { accountId: 'acc-b1', tradingDay: '2026-08-20', withdrawableCents: 40_00n },
  ],
  payoutRequests: [
    { identityId: 'a', status: 'settled', traderCents: 900_00n, firmCents: 100_00n },
    { identityId: 'a', status: 'approved', traderCents: 500_00n, firmCents: 50_00n },
    { identityId: 'b', status: 'settled', traderCents: 10_00n, firmCents: 1_00n },
  ],
};

describe('readIdentityGraph', () => {
  it('answers null for an identity that is not there, and a graph of one for an unlinked one', async () => {
    const { tx } = graphTx(SIMPLE);
    expect(await readIdentityGraph(tx, 'nobody')).toBeNull();

    const lone = await readIdentityGraph(tx, 'c');
    expect(lone?.graph.root).toStrictEqual({ identity_id: 'c', status: 'active', accounts: 0 });
    expect(lone?.graph.nodes).toHaveLength(1);
    expect(lone?.graph.edges).toStrictEqual([]);
  });

  it('reads both legs of the canonical order, because an edge is stored once', async () => {
    const { tx, recorder } = graphTx(SIMPLE);
    await readIdentityGraph(tx, 'a');
    expect(recorder.calls).toContain('rowsWhere identityLinks identityA');
    expect(recorder.calls).toContain('rowsWhere identityLinks identityB');
  });

  it('reaches the neighbour and reports the edge field by field', async () => {
    const { tx } = graphTx(SIMPLE);
    const result = await readIdentityGraph(tx, 'a');
    expect(result?.graph.nodes.map((node) => node.identity_id)).toStrictEqual(['a', 'b']);
    expect(result?.graph.edges).toStrictEqual([
      {
        a: 'a',
        b: 'b',
        link_kind: 'shared_device',
        confidence_bp: 7000,
        evidence: { device_fingerprint_seen: 4 },
      },
    ]);
  });

  it('takes the latest rule_states row per account and never the first it met', async () => {
    const { tx } = graphTx(SIMPLE);
    const result = await readIdentityGraph(tx, 'a');
    const nodeA = result?.graph.nodes.find((node) => node.identity_id === 'a');
    // 250_00 from the 2026-08-20 row plus 7_00, NOT the 100_00 of 2026-08-19.
    expect(nodeA?.total_withdrawable_cents).toBe(257_00);
  });

  it('counts open liability over funded accounts only, which is not the node sum', async () => {
    const { tx } = graphTx(SIMPLE);
    const result = await readIdentityGraph(tx, 'a');
    const nodeSum = (result?.graph.nodes ?? []).reduce(
      (total, node) => total + node.total_withdrawable_cents,
      0,
    );
    // Nodes: (250_00 + 7_00) + 40_00. Open liability drops `acc-a2`'s eval 7_00.
    expect(nodeSum).toBe(297_00);
    expect(result?.graph.aggregate.open_liability_cents).toBe(290_00);
    expect(result?.graph.aggregate.open_liability_cents).not.toBe(nodeSum);
  });

  it('counts trader_cents on settled requests, and neither firm_cents nor an approved one', async () => {
    const { tx } = graphTx(SIMPLE);
    const result = await readIdentityGraph(tx, 'a');
    expect(result?.graph.aggregate.payouts_lifetime_cents).toBe(910_00);
  });

  it('reports the identity and account counts of the whole cluster', async () => {
    const { tx } = graphTx(SIMPLE);
    const result = await readIdentityGraph(tx, 'a');
    expect(result?.graph.aggregate.identities).toBe(2);
    expect(result?.graph.aggregate.accounts).toBe(3);
  });

  it('measures the argmax it paid for, so the amplification is a number', async () => {
    const { tx } = graphTx(SIMPLE);
    const result = await readIdentityGraph(tx, 'a');
    // Four `rule_states` rows read to decide three accounts.
    expect(result?.cost.ruleStatesRead).toBe(4);
    expect(result?.cost.accounts).toBe(3);
  });
});

describe('suppression', () => {
  const CONTESTED: GraphFixture = {
    identities: [
      { id: 'a', status: 'active' },
      { id: 'b', status: 'active' },
      { id: 'c', status: 'active' },
    ],
    accounts: [],
    identityLinks: [
      link({ id: 'live', identityA: 'a', identityB: 'b' }),
      link({ id: 'contested', identityA: 'a', identityB: 'b', suppressed: true }),
      link({ id: 'only-path', identityA: 'b', identityB: 'c', suppressed: true }),
    ],
    ruleStates: [],
    payoutRequests: [],
  };

  it('does not pull an identity into the cluster across a suppressed edge', async () => {
    const { tx } = graphTx(CONTESTED);
    const result = await readIdentityGraph(tx, 'a');
    // `c` is reachable ONLY through the suppressed edge, so it is not a member.
    expect(result?.graph.nodes.map((node) => node.identity_id)).toStrictEqual(['a', 'b']);
    expect(result?.graph.aggregate.identities).toBe(2);
  });

  it('still shows a suppressed edge between two identities the walk reached', async () => {
    // SD-M7-04: the dispute renders on the graph and the admin sees it BEFORE
    // acting. Hiding it would make the contest invisible at the moment it is
    // supposed to be read.
    const { tx } = graphTx(CONTESTED);
    const result = await readIdentityGraph(tx, 'a');
    expect(result?.graph.edges).toHaveLength(2);
  });

  it('returns no edge whose endpoint is not a node, so the graph is closed', async () => {
    const { tx } = graphTx(CONTESTED);
    const result = await readIdentityGraph(tx, 'a');
    const members = new Set((result?.graph.nodes ?? []).map((node) => node.identity_id));
    for (const edge of result?.graph.edges ?? []) {
      expect(members).toContain(edge.a);
      expect(members).toContain(edge.b);
    }
  });

  it('refuses a suppressed value the column cannot hold rather than guessing at it', async () => {
    const { tx } = graphTx({
      ...CONTESTED,
      identityLinks: [link({ id: 'l1', identityA: 'a', identityB: 'b', suppressed: null })],
    });
    await expect(readIdentityGraph(tx, 'a')).rejects.toThrow(/successfully contested/);
  });
});

describe('the bounds', () => {
  /** A chain a to b to c to d to e, one edge each. */
  const CHAIN: GraphFixture = {
    identities: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, status: 'active' })),
    accounts: [],
    identityLinks: [
      link({ id: 'ab', identityA: 'a', identityB: 'b' }),
      link({ id: 'bc', identityA: 'b', identityB: 'c' }),
      link({ id: 'cd', identityA: 'c', identityB: 'd' }),
      link({ id: 'de', identityA: 'd', identityB: 'e' }),
    ],
    ruleStates: [],
    payoutRequests: [],
  };

  it('stops at maxDepth, because one identitys neighbourhood is not the whole estate', async () => {
    const { tx } = graphTx(CHAIN);
    const result = await readIdentityGraph(tx, 'a', { maxNodes: 100, maxDepth: 2 });
    expect(result?.graph.nodes.map((node) => node.identity_id)).toStrictEqual(['a', 'b', 'c']);
    expect(result?.cost.depthReached).toBe(2);
  });

  it('REFUSES at maxNodes rather than truncating, because a partial aggregate looks right', async () => {
    const { tx } = graphTx(CHAIN);
    await expect(readIdentityGraph(tx, 'a', { maxNodes: 2, maxDepth: 10 })).rejects.toThrow(
      /REFUSED rather than truncated/,
    );
  });

  it('carries a default nothing in the corpus rules, stated as a parameter', () => {
    expect(DEFAULT_GRAPH_LIMITS.maxNodes).toBeGreaterThan(0);
    expect(DEFAULT_GRAPH_LIMITS.maxDepth).toBeGreaterThan(0);
  });

  it('refuses a link naming an identity the estate does not have', async () => {
    const { tx } = graphTx({ ...CHAIN, identities: [{ id: 'a', status: 'active' }] });
    await expect(readIdentityGraph(tx, 'a')).rejects.toThrow(/ON DELETE RESTRICT/);
  });
});

describe('money is integer cents', () => {
  it('refuses a withdrawable past the safe integer range rather than rounding it', async () => {
    const { tx } = graphTx({
      identities: [{ id: 'a', status: 'active' }],
      accounts: [{ id: 'acc', identityId: 'a', phase: 'funded' }],
      identityLinks: [],
      ruleStates: [
        { accountId: 'acc', tradingDay: '2026-08-20', withdrawableCents: 9_007_199_254_740_993n },
      ],
      payoutRequests: [],
    });
    await expect(readIdentityGraph(tx, 'a')).rejects.toThrow(/not a safe integer number of cents/);
  });

  it('treats an account with no stored state as zero rather than refusing the graph', async () => {
    // `rule_states` is the nightly batch's, so an account opened today has none.
    // Refusing here would let a new account hide a cluster.
    const { tx } = graphTx({
      identities: [{ id: 'a', status: 'active' }],
      accounts: [{ id: 'fresh', identityId: 'a', phase: 'funded' }],
      identityLinks: [],
      ruleStates: [],
      payoutRequests: [],
    });
    const result = await readIdentityGraph(tx, 'a');
    expect(result?.graph.nodes[0]?.total_withdrawable_cents).toBe(0);
    expect(result?.graph.aggregate.open_liability_cents).toBe(0);
  });

  it('reads every money member as a safe integer, which is what assertContractScalars demands', async () => {
    const { tx } = graphTx(SIMPLE);
    const result = await readIdentityGraph(tx, 'a');
    const money = [
      ...(result?.graph.nodes ?? []).map((node) => node.total_withdrawable_cents),
      result?.graph.aggregate.open_liability_cents ?? 0,
      result?.graph.aggregate.payouts_lifetime_cents ?? 0,
    ];
    for (const value of money) expect(Number.isSafeInteger(value)).toBe(true);
  });
});

// =============================================================================
// 10. THE COMPOSITION
// =============================================================================

describe('the composition file', () => {
  const ADMIN_READS = read(join(APP, 'src', 'routes', 'admin-reads.ts'));

  /** `AdminReadSource`'s six method names, read out of its declaration. */
  const declared = (() => {
    const block = /export interface AdminReadSource \{([\s\S]*?)\n\}/.exec(ADMIN_READS)?.[1] ?? '';
    return [...block.matchAll(/^\s{2}(\w+)\(/gm)].map((match) => match[1] ?? '').sort();
  })();

  function composedOver(tables: Tables): ReturnType<typeof composeAdminReadSource> {
    return composeAdminReadSource({
      operator: async (fn) => await fn(new Recorder(tables) as unknown as AdminSourceTx),
    });
  }

  it('reads the ports six methods out of its own declaration', () => {
    expect(declared).toStrictEqual([
      'exportEvidence',
      'listFlags',
      'readAccount',
      'readIdentityGraph',
      'readLiability',
      'searchAccounts',
    ]);
  });

  it('composes exactly the methods it declares, so a merge cannot drop a leg quietly', () => {
    // THE RUN-TIME HALF OF THE CONTROL. The compile-time half is the `Pick` in
    // `index.ts`, which refuses either side alone; this refuses a composition
    // whose keys and whose declared list have drifted apart at run time.
    const composed = composedOver({ riskFlags: [], detectorRuns: [] });
    expect(Object.keys(composed).sort()).toStrictEqual([...IMPLEMENTED_ADMIN_READS].sort());
  });

  it('composes only names the port actually declares', () => {
    for (const name of IMPLEMENTED_ADMIN_READS) expect(declared).toContain(name);
  });

  it('composes a PARTIAL port, which is why nothing wires it', () => {
    expect(IMPLEMENTED_ADMIN_READS.length).toBeLessThan(declared.length);
    // The four this directory does not implement, named so a later slice knows
    // what is left rather than counting.
    const missing = declared.filter(
      (name) => !(IMPLEMENTED_ADMIN_READS as readonly string[]).includes(name),
    );
    expect(missing).toStrictEqual([
      'exportEvidence',
      'readAccount',
      'readLiability',
      'searchAccounts',
    ]);
  });

  it('returns the page from listFlags and drops the cost', async () => {
    const composed = composedOver(
      tablesOf([{ id: 'f1', identityId: 'i1', detector: 'D-01', severity: 3 }]),
    );
    const page = await composed.listFlags(query());
    expect(Object.keys(page).sort()).toStrictEqual(['data', 'next_cursor']);
    expect(page.data[0]?.flag_id).toBe('f1');
  });

  it('returns the graph from readIdentityGraph, and null where the route answers 404', async () => {
    const composed = composedOver(SIMPLE);
    expect(await composed.readIdentityGraph('nobody')).toBeNull();
    const graph = await composed.readIdentityGraph('a');
    expect(Object.keys(graph ?? {}).sort()).toStrictEqual(['aggregate', 'edges', 'nodes', 'root']);
  });
});

describe('what this directory does not do', () => {
  const FILES = ['flags.ts', 'graph.ts', 'index.ts'];

  /**
   * Every bare module specifier a file imports, `db.test.ts`'s own reader.
   *
   * READING THE IMPORTS AND NOT THE TEXT, and the distinction is one this suite
   * discovered by failing on itself: the first draft asserted that the word
   * `@merit/db` did not appear in these files at all, and `flags.ts` NAMES the
   * accessor in prose to explain why it does not import it. A control that reds
   * on a comment is a control somebody deletes the comment to satisfy.
   */
  function importsIn(file: string): readonly string[] {
    return [
      ...read(file).matchAll(/(?:^|\n)\s*(?:import|export)(?:\s+type)?[\s\S]*?from\s+'([^']+)'/g),
    ].map((match) => match[1] ?? '');
  }

  it('takes nothing off the accessor, so test/db.test.ts pinned map does not move', () => {
    // `src/db.ts`'s property, extended to a directory that did not exist when it
    // was written. A `@merit/db` import here would be a second file in this
    // deployable able to open a connection, and `db.test.ts` pins that map to
    // two files.
    for (const name of FILES)
      expect(
        importsIn(join(APP, 'src', 'admin-source', name)),
        `${name} imports the accessor`,
      ).not.toContain('@merit/db');
  });

  it('installs no read source, so the {declared, wired, blocked} triple is unchanged', () => {
    // `P7-i`'s fence does not hold `wiring.test.ts`, and the way not to move that
    // file's numbers is not to CALL the setter. The call and not the name, for
    // the reason the reader above gives.
    expect(read(join(APP, 'src', 'start.ts'))).not.toContain('setAdminReadSource(');
    for (const name of FILES)
      expect(read(join(APP, 'src', 'admin-source', name))).not.toContain('setAdminReadSource(');
  });

  it('edits neither admin-reads.ts nor the write side', () => {
    // The write side already exists and this slice adds no second refusal to it.
    const writes = read(join(APP, 'src', 'routes', 'admin-writes.ts'));
    expect(writes).not.toContain('admin-source');
    expect(read(join(APP, 'src', 'routes', 'admin-reads.ts'))).not.toContain('admin-source');
  });
});
