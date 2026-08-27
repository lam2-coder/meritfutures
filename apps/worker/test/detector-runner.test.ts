// =============================================================================
// apps/worker/test/detector-runner.test.ts -- CI-02, the `unit` project.
// =============================================================================
// THE VALIDATING HALF OF `src/detectors/`. `P7-e`, `P7`'s first done-gate.
//
// **THE SENTENCE THIS SUITE EXISTS TO MAKE FALSE IS A RUNNER THAT REPORTS
// SUCCESS WITHOUT HAVING FOUND ITS CANARIES.** `AS-M7-05`: a `detector_runs` row
// reading `status: ok`, `rows_scanned: 0`, `flags_raised: 0` "is
// indistinguishable from a genuinely quiet night, and quiet nights are the
// normal case, so nobody looks." `FM-M7-01` calls it the worst failure in the
// module, because everything downstream reads a green dashboard.
//
// **`P7` SECTION 11 RULE 13 IS THIS FILE'S SUBJECT AND IT HAS TWO HALVES, BOTH
// OF WHICH ARE ASSERTIONS HERE RATHER THAN PROSE ANYWHERE:**
//
//   NOTE 1  a synthetic subject is EXCLUDED FROM EVERY AGGREGATE
//           -> section 3, which walks every value the run wrote and every
//              counter it reported, and fails on a canary identifier in any of
//              them
//   NOTE 2  they are REGENERATED PER RUN, so a detector that memorized them
//           cannot pass while broken
//           -> section 4, which runs the same detector twice and refuses a
//              battery built at module load
//
// A comment saying either is so is exactly what this gate exists to refuse.
//
// -----------------------------------------------------------------------------
// THE FOUR CHEAP IMPLEMENTATIONS THIS SUITE REFUSES, AND EACH IS GREEN-LOOKING
// -----------------------------------------------------------------------------
//   a detector seeding NO canaries       `0 >= 0` satisfies the DDL's CHECK and
//                                        reports `ok` every night forever
//   a battery built at module load       found every run, including the runs
//                                        where the real query returns nothing
//   counting a canary hit as a flag      `flags_raised` climbs and the queue
//                                        fills with rows about nobody
//   counting canary rows in rows_scanned a statistic about real data that is
//                                        never zero even when the read is
//
// -----------------------------------------------------------------------------
// NOTHING HERE REACHES A DATABASE, AND SAYING SO IS PART OF THE SUITE
// -----------------------------------------------------------------------------
// `ci.yml`'s `integration` job runs on bare `ubuntu-latest` with no services
// block, so there is no Postgres in this pipeline at all. What IS asserted is
// the property at the resolution it lives at: WHICH port was called, with WHAT
// values, in WHAT order, and whether the transaction that ran them committed.
//
// **AND THE HONEST BOUND, WHICH SESSION 161 WROTE DOWN BEFORE THIS SLICE
// EXISTED AND WHICH THIS FILE DOES NOT GET TO WRITE OFF:** "The CI leg is NOT
// `INV-M7-07`'s control. `INV-M7-07` is a production property enforced by
// `detector_runs_synthetics_match_status`, emitting `detector.run_degraded` and
// paging ... The CI leg proves the canary MECHANISM works on one detector. It
// proves nothing about a nightly production run, which needs the database, the
// run row, the event, and a pager that this repository does not have."
//
// -----------------------------------------------------------------------------
// WHAT THIS SUITE READS RATHER THAN RESTATES
// -----------------------------------------------------------------------------
// Every constant `src/detectors/` declares because it cannot import it is BOUND
// to its source by reading that source as text.
//
//   packages/db/migrations/0008_risk.sql   the three run statuses, the two
//                                          CHECKs, the SLA band, the group
//                                          floor, and the NON-unique current
//                                          index
//   packages/db/src/schema.ts              every read and write key is a real
//                                          table
//   packages/db/src/seed/detectors/        the registry rows a run executes
//                                          under (P7-d)
//   docs/plans/M07-risk-abuse.md           AS-M7-05's four canary shapes and
//                                          detector.run_degraded's payload
//   docs/architecture/EVENTS.md            the two rows that ARE in the
//                                          catalogue, and the one that is not
//   docs/ops/runbooks/CRON_INVENTORY.md    the detector-runs row's own alarm
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  CANARY_NONCE_MIN_LENGTH,
  CANARY_PREFIX,
  CANARY_SHAPES,
  CanaryNonceError,
  canaryMint,
  canaryNonce,
  canarySubjectOf,
  carriesNonce,
  isCanaryId,
} from '../src/detectors/canary.ts';
import type { CanarySubject } from '../src/detectors/canary.ts';
import {
  DETECTOR_READ_TABLES,
  DETECTOR_RUN_STATUSES,
  DETECTOR_WRITE_TABLES,
  DetectorDeclined,
  DetectorRunnerUnwired,
  FLAG_SOURCE_INTERNAL,
  FLAG_STATUS_ON_RAISE,
  SLA_REQUIRED_AT_SEVERITY,
  UNWIRED_DETECTOR_RUNNER_IO,
} from '../src/detectors/ports.ts';
import type {
  Detector,
  DetectorEvent,
  DetectorFilter,
  DetectorFinding,
  DetectorRow,
  DetectorRunnerIo,
  DetectorScanInput,
  DetectorTx,
} from '../src/detectors/ports.ts';
import {
  DetectorBatteryError,
  DetectorCanaryLeak,
  DetectorFindingError,
  DetectorUnregistered,
  UNREGISTERED_VERSION,
  runDetectors,
} from '../src/detectors/runner.ts';
import type { DetectorRunOutcome, DetectorRunReport } from '../src/detectors/runner.ts';

// -----------------------------------------------------------------------------
// The sources, read as text
// -----------------------------------------------------------------------------

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string): string => readFileSync(`${ROOT}${path}`, 'utf8');

/**
 * A source file with its comments removed.
 *
 * **SESSION 292 FOUND THIS THE HARD WAY AND ITS FINDING IS REUSED RATHER THAN
 * REDISCOVERED**: an acquisition-point assertion written as a substring test
 * "failed on the file whose header names the accessor in order to say it does
 * not import it". Every file in `src/detectors/` names `@merit/db` and
 * `SqlExecutorReason` in prose, for exactly that reason, so the assertions in
 * section 6 read the CODE and the headers stay honest.
 */
const code = (path: string): string =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/.*$/, ''))
    .join('\n');

const RISK_SQL = read('packages/db/migrations/0008_risk.sql');
const SCHEMA_TS = read('packages/db/src/schema.ts');
const M07 = read('docs/plans/M07-risk-abuse.md');
const EVENTS = read('docs/architecture/EVENTS.md');
const CRON = read('docs/ops/runbooks/CRON_INVENTORY.md');
const SEED_ROWS = JSON.parse(read('packages/db/src/seed/detectors/m07-detectors-v1.rows.json')) as {
  rows: { detector: string; version: string; parameters: Record<string, unknown> }[];
};

// -----------------------------------------------------------------------------
// The fake, which makes nothing durable unless the transaction committed
// -----------------------------------------------------------------------------

interface Written {
  readonly table: string;
  readonly values: Record<string, unknown>;
}

interface FakeIo {
  readonly io: DetectorRunnerIo;
  /** Committed writes, in order. */
  readonly writes: Written[];
  /** Committed events, in order. */
  readonly events: DetectorEvent[];
  /** Every `rowsWhere` the run made. */
  readonly reads: { table: string; where: DetectorFilter }[];
  /** Every nonce handed out. */
  readonly nonces: string[];
}

interface FakeOptions {
  readonly rows?: Readonly<Record<string, readonly DetectorRow[]>>;
  readonly definitions?: readonly Record<string, unknown>[];
  readonly nonce?: readonly string[];
  readonly writeFails?: boolean;
}

/** A `detector_definitions` row as `readDefinition` narrows it. */
function definitionRow(
  detector: string,
  version = 'v1',
  parameters: Record<string, unknown> = { window_seconds: { state: 'stated', value: 2 } },
): Record<string, unknown> {
  return { detector, version, parameters, isSensitive: true, effectiveTo: null };
}

function fakeIo(options: FakeOptions = {}): FakeIo {
  const writes: Written[] = [];
  const events: DetectorEvent[] = [];
  const reads: { table: string; where: DetectorFilter }[] = [];
  const nonces: string[] = [];
  const pool = [...(options.nonce ?? ['nonce-aaaaaaaa', 'nonce-bbbbbbbb', 'nonce-cccccccc'])];
  // Handle -> the buffer its transaction stages into. A handle that was never
  // built by `open` below has no buffer, so an emit outside a transaction has
  // nowhere to go, which is the property ADR-006's criterion rests on.
  const buffers = new WeakMap<DetectorTx, { rows: Written[]; events: DetectorEvent[] }>();
  let clock = 0;
  let rowSeq = 0;

  function open(): { handle: DetectorTx; staged: { rows: Written[]; events: DetectorEvent[] } } {
    const staged = { rows: [] as Written[], events: [] as DetectorEvent[] };
    const handle: DetectorTx = {
      rowsWhere: (table, where) => {
        reads.push({ table, where });
        if (table === 'detectorDefinitions') {
          const detector = where['detector'];
          const all = options.definitions ?? [definitionRow(String(detector))];
          return Promise.resolve(all.filter((row) => row['detector'] === detector));
        }
        return Promise.resolve([...((options.rows ?? {})[table] ?? [])]);
      },
      insert: (table, values) => {
        if (options.writeFails === true) {
          return Promise.reject(new Error('write refused by the fixture'));
        }
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
    nonces,
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
        return new Date(Date.UTC(2026, 0, 5, 2, 0, 0) + clock);
      },
      nonce: () => {
        const next = pool.shift() ?? 'nonce-exhausted';
        nonces.push(next);
        return canaryNonce(next);
      },
    },
  };
}

// -----------------------------------------------------------------------------
// Detectors under test
// -----------------------------------------------------------------------------

interface StubOptions {
  readonly id?: string;
  readonly streams?: Detector['streams'];
  readonly canaries?: Detector['canaries'];
  readonly scan?: Detector['scan'];
}

function stub(options: StubOptions = {}): Detector {
  const id = options.id ?? 'D-01';
  return {
    id,
    streams: options.streams ?? (() => []),
    canaries: options.canaries ?? ((mint) => [mint.sameSecondFillCluster(id, 0)]),
    scan: options.scan ?? (() => ({ findings: [] })),
  };
}

/**
 * A real, small `D-01`: two accounts filling the same symbol and side on the
 * same instant.
 *
 * IT IS DELIBERATELY BLIND TO WHETHER A ROW IS SYNTHETIC, which is the property
 * the whole design turns on: a detector that could tell would be able to pass by
 * finding only its canaries.
 */
function clusterDetector(id = 'D-01'): Detector {
  return {
    id,
    streams: (request) => [
      { name: 'fills', table: 'fills', where: { tradingDay: request.tradingDay } },
    ],
    canaries: (mint) => [mint.sameSecondFillCluster(id, 0)],
    scan: ({ rows }: DetectorScanInput) => {
      const byInstant = new Map<string, Set<string>>();
      const identityOf = new Map<string, string>();
      for (const row of rows['fills'] ?? []) {
        const at = row['executedAt'];
        const key = [row['symbol'], row['side'], at instanceof Date ? at.toISOString() : at].join(
          '|',
        );
        const accounts = byInstant.get(key) ?? new Set<string>();
        accounts.add(String(row['accountId']));
        byInstant.set(key, accounts);
        identityOf.set(String(row['accountId']), String(row['identityId']));
      }
      const findings: DetectorFinding[] = [];
      for (const accounts of byInstant.values()) {
        if (accounts.size < 2) {
          continue;
        }
        const subjects = [...accounts].sort();
        const first = subjects[0] ?? '';
        findings.push({
          subjects,
          identityId: identityOf.get(first) ?? first,
          accountId: first,
          flagType: 'copy_cluster',
          severity: 3,
          evidence: { accounts_in_cluster: subjects.length },
        });
      }
      return { findings };
    },
  };
}

/** A real fill row, with UUID-shaped identifiers so nothing reads as a canary. */
function realFill(account: string, identity: string, at: string, seq: number): DetectorRow {
  return {
    id: `00000000-0000-4000-8000-00000000000${String(seq)}`,
    accountId: account,
    identityId: identity,
    symbol: 'ESH6',
    side: 'buy',
    quantity: 1,
    executedAt: new Date(at),
    tradingDay: at.slice(0, 10),
  };
}

const DAY = '2026-01-05';

function only(report: DetectorRunReport): DetectorRunOutcome {
  const outcome = report.outcomes[0];
  if (outcome === undefined) {
    throw new Error('the report carried no outcome');
  }
  return outcome;
}

/** Every string anywhere inside a committed write, however deeply nested. */
function stringsIn(value: unknown, into: string[] = []): string[] {
  if (typeof value === 'string') {
    into.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      stringsIn(item, into);
    }
  } else if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    for (const item of Object.values(value)) {
      stringsIn(item, into);
    }
  }
  return into;
}

// =============================================================================
// 1. The sources, and every retyped constant bound to one
// =============================================================================

describe('the constants this deployable retypes are bound to their sources', () => {
  it('DETECTOR_RUN_STATUSES is 0008_risk.sql’s CHECK, in its order', () => {
    const check = /status\s+text NOT NULL CHECK \(status IN \(([\s\S]*?)\)\)/.exec(RISK_SQL);
    expect(check).not.toBeNull();
    const declared = [...(check?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(declared).toEqual([...DETECTOR_RUN_STATUSES]);
  });

  it('the run CHECK is the one that cannot see a battery of zero', () => {
    // `status <> 'ok' OR synthetic_found >= synthetic_expected` is satisfied at
    // `0 >= 0`, which is why `mintBattery` refuses an empty battery in code.
    expect(RISK_SQL).toContain('detector_runs_synthetics_match_status');
    expect(RISK_SQL).toContain("status <> 'ok' OR synthetic_found >= synthetic_expected");
  });

  it('SLA_REQUIRED_AT_SEVERITY is risk_flags_high_severity_has_sla’s band', () => {
    const check = /risk_flags_high_severity_has_sla CHECK \(\s*severity < (\d)/.exec(RISK_SQL);
    expect(check).not.toBeNull();
    expect(Number(check?.[1])).toBe(SLA_REQUIRED_AT_SEVERITY);
  });

  it('FLAG_STATUS_ON_RAISE is the column default and INV-M7-02’s only value', () => {
    expect(RISK_SQL).toContain(
      `status             risk_flag_status NOT NULL DEFAULT '${FLAG_STATUS_ON_RAISE}'`,
    );
    expect(M07).toContain('No detector transitions a flag past `open`');
  });

  it('FLAG_SOURCE_INTERNAL is 0008’s reserved value', () => {
    expect(RISK_SQL).toContain(
      `source             text NOT NULL DEFAULT '${FLAG_SOURCE_INTERNAL}'`,
    );
  });

  it('a correlation group starts at three, as the CHECK says', () => {
    expect(RISK_SQL).toContain('correlation_groups_is_a_group');
    expect(RISK_SQL).toContain('array_length(member_account_ids, 1) >= 3');
  });

  it('every readable and writable key is a real table in schema.ts', () => {
    for (const key of [...DETECTOR_READ_TABLES, ...DETECTOR_WRITE_TABLES]) {
      expect(SCHEMA_TS).toContain(`export const ${key} = pgTable(`);
    }
  });

  it('the read and write sets are disjoint except where a run reads what it wrote', () => {
    // `detectorRuns` is written and never read back by this runner: the run row
    // is the output. A key in both sets would be a detector able to read its own
    // previous verdicts, which is a feedback loop nobody designed.
    const overlap = DETECTOR_READ_TABLES.filter((k) =>
      (DETECTOR_WRITE_TABLES as readonly string[]).includes(k),
    );
    expect(overlap).toEqual([]);
  });

  it('detector_definitions_current_idx is NOT unique, so the ambiguity the runner refuses is reachable', () => {
    // This is why `readDefinition` refuses two current rows in code rather than
    // trusting the schema. If somebody makes the index unique, this assertion is
    // the one that says so.
    expect(RISK_SQL).toContain('CREATE INDEX detector_definitions_current_idx');
    expect(RISK_SQL).not.toContain('CREATE UNIQUE INDEX detector_definitions_current_idx');
  });

  it('CANARY_SHAPES are the four AS-M7-05 names and no fifth', () => {
    const sentence =
      /constructed to trip exactly that detector: (.*?)\. The run asserts/.exec(M07)?.[1] ?? '';
    expect(sentence).toContain('a hedged pair with correlation -0.95');
    expect(sentence).toContain('a same-second fill cluster');
    expect(sentence).toContain('a martingale sequence');
    expect(sentence).toContain('a destination shared by two identities');
    expect([...CANARY_SHAPES]).toEqual([
      'hedged-pair',
      'same-second-fill-cluster',
      'martingale-sequence',
      'shared-destination',
    ]);
  });

  it('detector.run_degraded’s payload is M07 section 5’s, field for field', () => {
    const row = M07.split('\n').find((line) => line.includes('`detector.run_degraded` **NEW**'));
    expect(row).toBeDefined();
    for (const field of [
      'detector',
      'detector_version',
      'trading_day',
      'synthetic_expected',
      'synthetic_found',
      'rows_scanned',
    ]) {
      expect(row).toContain(field);
    }
  });

  it('detector.run_completed IS in the EVENTS catalogue and run_degraded is NOT, which is the reported gap', () => {
    // ADR-159 clause 1 makes the authority for a name the registry rather than a
    // producer. `EVENTS.md` is outside this slice's fence, so the gap is
    // reported rather than repaired, and this assertion goes RED on the day
    // somebody adds the row -- which is the point at which the payload above
    // should be re-derived from the catalogue instead of from M07.
    expect(EVENTS).toContain('`detector.run_completed`');
    expect(EVENTS).not.toContain('detector.run_degraded');
    expect(EVENTS).toContain('`flag.raised`');
  });

  it('CRON_INVENTORY’s detector-runs row alarms on canaries not found', () => {
    const row = CRON.split('\n').find((line) => line.startsWith('| **Detector runs**'));
    expect(row).toBeDefined();
    expect(row).toContain('canaries not found');
    expect(row).toContain('GS-122');
  });

  it('P7-d’s seed carries a row for every detector this runner could be given', () => {
    // The registry IS the seed (P7-d). A detector with no row cannot run at all,
    // which is what `readDefinition` refuses, so the seed's coverage is the set
    // of detectors wave 2 may build.
    expect(SEED_ROWS.rows.length).toBe(18);
    for (const row of SEED_ROWS.rows) {
      expect(row.version).toBe('v1');
      expect(Object.keys(row.parameters).length).toBeGreaterThan(0);
    }
  });

  it('eleven of the eighteen rows carry no stated number, which is what DetectorDeclined is for', () => {
    // `ports.ts` states this count and it is DERIVED here rather than trusted,
    // because a hand-maintained count in a docstring is the defect CLAUDE.md
    // asks for a mechanical assertion in place of. It is also the measurement
    // behind DetectorDeclined: most of wave 2's detectors have no threshold to
    // run against yet, and OQ-M7-02 is the founder's on every one of them.
    const withoutANumber = SEED_ROWS.rows.filter(
      (row) =>
        !Object.entries(row.parameters).some(([key, value]) => {
          if (key === '_meta' || value === null || typeof value !== 'object') {
            return false;
          }
          const parameter = value as { state?: unknown; value?: unknown };
          return parameter.state === 'stated' && typeof parameter.value === 'number';
        }),
    );
    expect(withoutANumber.length).toBe(11);
  });
});

// =============================================================================
// 2. The battery itself
// =============================================================================

describe('the canary battery', () => {
  const nonce = canaryNonce('nonce-aaaaaaaa');

  it('refuses a nonce with too little entropy to be per-run', () => {
    expect(() => canaryNonce('short')).toThrow(CanaryNonceError);
    expect(() => canaryNonce('x'.repeat(CANARY_NONCE_MIN_LENGTH))).not.toThrow();
  });

  it('refuses a nonce carrying an identifier separator', () => {
    expect(() => canaryNonce('aaaa:bbbb')).toThrow(/":" or "#"/);
    expect(() => canaryNonce('aaaa#bbbb')).toThrow(/":" or "#"/);
  });

  it('mints identifiers under the namespace, and no UUID can collide with one', () => {
    const subject = canaryMint(nonce).subject('D-01', 0);
    expect(subject.id).toBe(`${CANARY_PREFIX}:D-01:nonce-aaaaaaaa:0`);
    expect(isCanaryId(subject.id)).toBe(true);
    expect(isCanaryId('00000000-0000-4000-8000-000000000001')).toBe(false);
    expect(canarySubjectOf(subject.actor('a-1'))).toBe(subject.id);
    expect(canarySubjectOf(subject.row(3))).toBe(subject.id);
  });

  it('carriesNonce reads THIS run’s nonce and not merely the namespace', () => {
    const mine = canaryMint(nonce).subject('D-01', 0);
    const theirs = canaryMint(canaryNonce('nonce-bbbbbbbb')).subject('D-01', 0);
    expect(carriesNonce(mine.id, nonce)).toBe(true);
    expect(carriesNonce(theirs.id, nonce)).toBe(false);
    expect(isCanaryId(theirs.id)).toBe(true);
  });

  const mint = canaryMint(nonce);

  it('the hedged pair mirrors exactly, varies day to day, and is integer cents', () => {
    const pair = mint.hedgedPair('D-13', 0);
    const rows = pair.rows['dailyMarks'] ?? [];
    expect(rows.length).toBe(10);
    const byDay = new Map<string, bigint[]>();
    for (const row of rows) {
      const day = String(row['tradingDay']);
      byDay.set(day, [...(byDay.get(day) ?? []), row['realizedPnlCents'] as bigint]);
      expect(typeof row['realizedPnlCents']).toBe('bigint');
    }
    expect(byDay.size).toBe(5);
    for (const [, pnl] of byDay) {
      // Exactly mirrored: correlation -1.0000, which clears D-02's -8000 bp and
      // D-13's -9500 bp with no boundary case in either.
      expect((pnl[0] ?? 0n) + (pnl[1] ?? 0n)).toBe(0n);
    }
    // A flat series has zero variance and an undefined Pearson correlation. A
    // canary that produced NaN would be "not found" while the detector works.
    const magnitudes = new Set([...byDay.values()].map((p) => String(p[0])));
    expect(magnitudes.size).toBeGreaterThan(1);
  });

  it('the fill cluster puts two identities on one instant, so D-01’s same-identity filter does not eat it', () => {
    const cluster = mint.sameSecondFillCluster('D-01', 0);
    const rows = cluster.rows['fills'] ?? [];
    const identities = new Set(rows.map((r) => String(r['identityId'])));
    expect(identities.size).toBe(2);
    const accounts = new Set(rows.map((r) => String(r['accountId'])));
    expect(accounts.size).toBe(2);
    // Every fill either account has is in the cluster, so the SHARE half of
    // D-01's statistic is 100 percent and clears any configured floor.
    const instants = new Map<string, number>();
    for (const row of rows) {
      const at = (row['executedAt'] as Date).toISOString();
      instants.set(at, (instants.get(at) ?? 0) + 1);
    }
    for (const count of instants.values()) {
      expect(count).toBe(2);
    }
  });

  it('the martingale doubles after each loss, over more than one sequence, in integers', () => {
    const seq = mint.martingaleSequence('D-05', 0);
    const rows = seq.rows['fills'] ?? [];
    const sequences = new Set(rows.map((r) => Number(r['sequenceOrdinal'])));
    // "Strategy level, never a single sequence" (M07:112), and D-05's
    // min_sequences is `unstated` in the registry, so the battery sits above any
    // plausible minimum rather than on an unset threshold.
    expect(sequences.size).toBeGreaterThan(1);
    for (const ordinal of sequences) {
      const inSequence = rows.filter((r) => Number(r['sequenceOrdinal']) === ordinal);
      for (let n = 1; n < inSequence.length; n += 1) {
        expect(Number(inSequence[n]?.['quantity'])).toBe(
          Number(inSequence[n - 1]?.['quantity']) * 2,
        );
        expect(Number.isInteger(Number(inSequence[n]?.['quantity']))).toBe(true);
      }
    }
  });

  it('the shared destination puts one destination_ref under two identities', () => {
    const shared = mint.sharedDestination('D-09', 0);
    const rows = shared.rows['payoutTransfers'] ?? [];
    expect(new Set(rows.map((r) => String(r['destinationRef']))).size).toBe(1);
    expect(new Set(rows.map((r) => String(r['identityId']))).size).toBe(2);
    for (const row of rows) {
      expect(typeof row['amountCents']).toBe('bigint');
    }
  });

  it('every actor of every shape carries the run’s nonce', () => {
    const shapes: CanarySubject[] = [
      mint.hedgedPair('D-02', 0),
      mint.sameSecondFillCluster('D-01', 1),
      mint.martingaleSequence('D-05', 2),
      mint.sharedDestination('D-09', 3),
    ];
    expect(shapes.map((s) => s.shape).sort()).toEqual([...CANARY_SHAPES].sort());
    for (const subject of shapes) {
      expect(carriesNonce(subject.id, nonce)).toBe(true);
      for (const actor of subject.actors) {
        expect(carriesNonce(actor, nonce)).toBe(true);
      }
    }
  });
});

// =============================================================================
// 3. AS-M7-05 NOTE 1: EXCLUDED FROM EVERY AGGREGATE
// =============================================================================

describe('AS-M7-05 note 1: a synthetic subject is excluded from every aggregate', () => {
  const config = { tradingDay: DAY };

  it('NO canary identifier reaches ANY value of ANY committed write', async () => {
    // THE AGGREGATE ASSERTION, and it is stated over the writes rather than over
    // a list of queries, because the run's aggregates ARE its writes: rows
    // scanned, flags raised, the counters, the group rows and the event
    // payloads. A canary never becomes a row, so no present or future aggregate
    // can include one -- including the aggregates nobody has written yet.
    const fake = fakeIo({
      rows: {
        fills: [
          realFill('acct-real-a', 'ident-real-a', '2026-01-05T15:00:00.000Z', 1),
          realFill('acct-real-b', 'ident-real-b', '2026-01-05T15:00:00.000Z', 2),
        ],
      },
    });
    const report = await runDetectors([clusterDetector()], config, fake.io);
    const outcome = only(report);

    expect(outcome.status).toBe('ok');
    expect(outcome.syntheticExpected).toBe(1);
    expect(outcome.syntheticFound).toBe(1);
    expect(fake.writes.length).toBeGreaterThan(0);

    for (const written of fake.writes) {
      for (const value of stringsIn(written.values)) {
        expect(isCanaryId(value)).toBe(false);
      }
    }
    for (const event of fake.events) {
      for (const value of stringsIn(event.payload)) {
        expect(isCanaryId(value)).toBe(false);
      }
    }
  });

  it('rows_scanned counts the real rows and never the canary rows', async () => {
    const fake = fakeIo({
      rows: {
        fills: [
          realFill('acct-real-a', 'ident-real-a', '2026-01-05T15:00:00.000Z', 1),
          realFill('acct-real-b', 'ident-real-b', '2026-01-05T15:00:00.000Z', 2),
        ],
      },
    });
    const report = await runDetectors([clusterDetector()], config, fake.io);
    const outcome = only(report);
    // Two real rows. The battery adds twelve more and NONE of them is counted:
    // `rows_scanned` is a statistic about real data, and AS-M7-05's note is
    // unqualified about "every aggregate, statistic, and published number".
    expect(outcome.rowsScanned).toBe(2);
    expect(outcome.rowsByStream).toEqual({ fills: 2 });
    const run = fake.writes.find((w) => w.table === 'detectorRuns');
    expect(run?.values['rowsScanned']).toBe(2);
  });

  it('rows_scanned is ZERO when the read returns nothing, even though the canaries were found', async () => {
    // THE CASE AS-M7-05 IS ABOUT. A read that broke returns nothing; the battery
    // is still found because it never travelled through the read; and the run is
    // `ok` with `rows_scanned: 0`. That combination is exactly the "quiet night"
    // the entry describes, and the canary does NOT catch it -- which is the
    // limit `canary.ts`'s header states and this case pins so nobody claims
    // otherwise.
    const fake = fakeIo({ rows: { fills: [] } });
    const outcome = only(await runDetectors([clusterDetector()], config, fake.io));
    expect(outcome.rowsScanned).toBe(0);
    expect(outcome.syntheticFound).toBe(1);
    expect(outcome.status).toBe('ok');
  });

  it('a canary hit raises no risk_flags row and does not move flags_raised', async () => {
    const fake = fakeIo({ rows: { fills: [] } });
    const outcome = only(await runDetectors([clusterDetector()], config, fake.io));
    expect(outcome.syntheticFound).toBe(1);
    expect(outcome.flagsRaised).toBe(0);
    expect(fake.writes.filter((w) => w.table === 'riskFlags')).toEqual([]);
    const run = fake.writes.find((w) => w.table === 'detectorRuns');
    expect(run?.values['flagsRaised']).toBe(0);
    expect(fake.events.filter((e) => e.name === 'flag.raised')).toEqual([]);
  });

  it('a real cluster raises exactly one flag beside a found canary', async () => {
    const fake = fakeIo({
      rows: {
        fills: [
          realFill('acct-real-a', 'ident-real-a', '2026-01-05T15:00:00.000Z', 1),
          realFill('acct-real-b', 'ident-real-b', '2026-01-05T15:00:00.000Z', 2),
        ],
      },
    });
    const outcome = only(await runDetectors([clusterDetector()], config, fake.io));
    expect(outcome.flagsRaised).toBe(1);
    const flags = fake.writes.filter((w) => w.table === 'riskFlags');
    expect(flags.length).toBe(1);
    expect(flags[0]?.values['identityId']).toBe('ident-real-a');
    expect(flags[0]?.values['evidence']).toEqual({ accounts_in_cluster: 2 });
  });

  it('a finding naming BOTH a real and a synthetic subject is REFUSED and fails the run', async () => {
    // The worst outcome available here is a risk_flags row against a person
    // whose evidence is partly a subject Merit manufactured, and the second
    // worst is a real flag suppressed as synthetic. Neither is chosen.
    const mixed = stub({
      canaries: (mint) => [mint.sameSecondFillCluster('D-01', 0)],
      scan: ({ rows }) => {
        const canaryAccount = (rows['fills'] ?? [])
          .map((r) => String(r['accountId']))
          .find(isCanaryId);
        return {
          findings: [
            {
              subjects: ['acct-real-a', canaryAccount ?? ''],
              identityId: 'ident-real-a',
              flagType: 'copy_cluster',
              severity: 3,
              evidence: { n: 1 },
            },
          ],
        };
      },
    });
    const fake = fakeIo();
    const outcome = only(await runDetectors([mixed], config, fake.io));
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain(DetectorCanaryLeak.name);
    expect(fake.writes.filter((w) => w.table === 'riskFlags')).toEqual([]);
    // INV-M7-07 still holds: the run is recorded.
    expect(outcome.recorded).toBe(true);
  });

  it('a finding whose identityId is a canary while its subjects are real is refused', async () => {
    const leaky = stub({
      scan: ({ request }) => ({
        findings: [
          {
            subjects: ['acct-real-a'],
            identityId: `${CANARY_PREFIX}:${request.detector}:nonce-aaaaaaaa:0#i-leader`,
            flagType: 'copy_cluster',
            severity: 3,
            evidence: { n: 1 },
          },
        ],
      }),
    });
    const outcome = only(await runDetectors([leaky], config, fakeIo().io));
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain(DetectorCanaryLeak.name);
  });

  it('a row arriving FROM the database carrying a canary identifier fails the run', async () => {
    // The check that would catch a future session persisting a battery, which is
    // the one way "never written, therefore excluded" could stop being true.
    const fake = fakeIo({
      rows: {
        fills: [
          {
            id: '00000000-0000-4000-8000-000000000001',
            accountId: `${CANARY_PREFIX}:D-01:nonce-zzzzzzzz:0#a-leader`,
            symbol: 'ESH6',
            side: 'buy',
            executedAt: new Date('2026-01-05T15:00:00.000Z'),
          },
        ],
      },
    });
    const outcome = only(await runDetectors([clusterDetector()], config, fake.io));
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain(DetectorCanaryLeak.name);
    expect(outcome.error).toContain('excluded from every aggregate');
  });

  it('a finding naming a canary this run did not mint is refused', async () => {
    const stale = stub({
      scan: () => ({
        findings: [
          {
            subjects: [`${CANARY_PREFIX}:D-01:nonce-zzzzzzzz:0#a-leader`],
            identityId: 'ident-real-a',
            flagType: 'copy_cluster',
            severity: 3,
            evidence: { n: 1 },
          },
        ],
      }),
    });
    const outcome = only(await runDetectors([stale], config, fakeIo().io));
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain(DetectorCanaryLeak.name);
  });
});

// =============================================================================
// 4. AS-M7-05 NOTE 2: REGENERATED PER RUN
// =============================================================================

describe('AS-M7-05 note 2: the subjects are regenerated per run', () => {
  const config = { tradingDay: DAY };

  it('two runs mint two disjoint batteries', async () => {
    const detector = clusterDetector();
    const seen: string[][] = [];
    const spy: Detector = {
      ...detector,
      canaries: (mint) => {
        const subjects = detector.canaries(mint);
        seen.push(subjects.map((s) => s.id));
        return subjects;
      },
    };
    const first = await runDetectors([spy], config, fakeIo({ nonce: ['nonce-aaaaaaaa'] }).io);
    const second = await runDetectors([spy], config, fakeIo({ nonce: ['nonce-bbbbbbbb'] }).io);
    expect(first.nonce).not.toBe(second.nonce);
    expect(seen.length).toBe(2);
    const [a = [], b = []] = seen;
    expect(a).not.toEqual(b);
    expect(a.filter((id) => b.includes(id))).toEqual([]);
    expect(only(first).syntheticFound).toBe(1);
    expect(only(second).syntheticFound).toBe(1);
  });

  it('a battery built at module load is REFUSED rather than counted', async () => {
    // The exact defect AS-M7-05 names: "a detector that has memorized them
    // passes while broken for real data". A frozen array carries some other
    // run's nonce, so the run cannot reach `ok` at all.
    const memorized = canaryMint(canaryNonce('nonce-frozenxx')).sameSecondFillCluster('D-01', 0);
    const cheating = stub({ canaries: () => [memorized] });
    const outcome = only(await runDetectors([cheating], config, fakeIo().io));
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain(DetectorBatteryError.name);
    expect(outcome.error).toContain('regenerated per run');
  });

  it('a detector that seeds NO canaries is refused, because 0 >= 0 satisfies the DDL forever', async () => {
    const lazy = stub({ canaries: () => [] });
    const fake = fakeIo();
    const outcome = only(await runDetectors([lazy], config, fake.io));
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain(DetectorBatteryError.name);
    expect(outcome.syntheticExpected).toBe(0);
    // And the run is still recorded, at `failed`, so the morning read sees it.
    expect(fake.writes.find((w) => w.table === 'detectorRuns')?.values['status']).toBe('failed');
  });

  it('two subjects sharing an identifier are refused, because synthetic_found counts distinct', async () => {
    const duplicating = stub({
      canaries: (mint) => [mint.sameSecondFillCluster('D-01', 0), mint.hedgedPair('D-01', 0)],
    });
    const outcome = only(await runDetectors([duplicating], config, fakeIo().io));
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain(DetectorBatteryError.name);
  });
});

// =============================================================================
// 5. GS-122: a run that finds none of its canaries
// =============================================================================

describe('GS-122: the run that finds none of its canaries', () => {
  const config = { tradingDay: DAY };

  /** A detector whose query returns nothing, which is AS-M7-05's whole subject. */
  const broken = stub({
    canaries: (mint) => [mint.sameSecondFillCluster('D-01', 0), mint.hedgedPair('D-01', 1)],
    scan: () => ({ findings: [] }),
  });

  it('is degraded, never ok', async () => {
    const fake = fakeIo();
    const outcome = only(await runDetectors([broken], config, fake.io));
    expect(outcome.status).toBe('degraded');
    expect(outcome.syntheticExpected).toBe(2);
    expect(outcome.syntheticFound).toBe(0);
    expect(outcome.syntheticMissing.length).toBe(2);
  });

  it('writes a detector_runs row whose counters and status agree with the DDL CHECK', async () => {
    const fake = fakeIo();
    await runDetectors([broken], config, fake.io);
    const run = fake.writes.find((w) => w.table === 'detectorRuns');
    expect(run).toBeDefined();
    const values = run?.values ?? {};
    expect(values['status']).toBe('degraded');
    expect(values['syntheticExpected']).toBe(2);
    expect(values['syntheticFound']).toBe(0);
    // `status <> 'ok' OR synthetic_found >= synthetic_expected`, evaluated.
    expect(
      values['status'] !== 'ok' ||
        Number(values['syntheticFound']) >= Number(values['syntheticExpected']),
    ).toBe(true);
  });

  it('emits detector.run_degraded with M07 section 5’s payload, and run_completed beside it', async () => {
    const fake = fakeIo();
    await runDetectors([broken], config, fake.io);
    const names = fake.events.map((e) => e.name);
    expect(names).toContain('detector.run_completed');
    expect(names).toContain('detector.run_degraded');
    const degraded = fake.events.find((e) => e.name === 'detector.run_degraded');
    expect(degraded?.payload).toEqual({
      detector: 'D-01',
      detector_version: 'v1',
      trading_day: DAY,
      synthetic_expected: 2,
      synthetic_found: 0,
      rows_scanned: 0,
    });
  });

  it('finding SOME of the battery is still degraded', async () => {
    // A partial battery is the subtle case: `synthetic_found` is non-zero, so a
    // runner comparing against zero would report `ok`. The DDL's CHECK is `>=`
    // and so is this.
    const half = stub({
      canaries: (mint) => [mint.sameSecondFillCluster('D-01', 0), mint.hedgedPair('D-01', 1)],
      scan: ({ rows }) => {
        const account = (rows['fills'] ?? []).map((r) => String(r['accountId'])).find(isCanaryId);
        return {
          findings:
            account === undefined
              ? []
              : [
                  {
                    subjects: [account],
                    identityId: 'unused',
                    flagType: 'copy_cluster',
                    severity: 1,
                    evidence: { n: 1 },
                  },
                ],
        };
      },
    });
    const outcome = only(await runDetectors([half], { tradingDay: DAY }, fakeIo().io));
    expect(outcome.syntheticFound).toBe(1);
    expect(outcome.syntheticExpected).toBe(2);
    expect(outcome.status).toBe('degraded');
  });

  it('a degraded run still writes its real flags', async () => {
    // A detector whose battery came back short is not trusted, and it is also
    // not silenced: the flags it did raise are evidence a human reads. Dropping
    // them would turn one broken detector into a quiet night by a second route.
    const fake = fakeIo({
      rows: {
        fills: [
          realFill('acct-real-a', 'ident-real-a', '2026-01-05T15:00:00.000Z', 1),
          realFill('acct-real-b', 'ident-real-b', '2026-01-05T15:00:00.000Z', 2),
        ],
      },
    });
    const partial: Detector = {
      ...clusterDetector(),
      canaries: (mint) => [mint.hedgedPair('D-01', 7)],
    };
    const outcome = only(await runDetectors([partial], config, fake.io));
    expect(outcome.status).toBe('degraded');
    expect(outcome.flagsRaised).toBe(1);
    expect(fake.writes.filter((w) => w.table === 'riskFlags').length).toBe(1);
  });
});

// =============================================================================
// 6. INV-M7-02 and ADR-155: `open`, and nothing else, ever
// =============================================================================

describe('INV-M7-02 and ADR-155: no detector writes a status other than open', () => {
  const config = { tradingDay: DAY };

  it('every risk_flags row this runner writes carries status open', async () => {
    const fake = fakeIo({
      rows: {
        fills: [
          realFill('acct-real-a', 'ident-real-a', '2026-01-05T15:00:00.000Z', 1),
          realFill('acct-real-b', 'ident-real-b', '2026-01-05T15:00:00.000Z', 2),
        ],
      },
    });
    await runDetectors([clusterDetector()], config, fake.io);
    const flags = fake.writes.filter((w) => w.table === 'riskFlags');
    expect(flags.length).toBeGreaterThan(0);
    for (const flag of flags) {
      expect(flag.values['status']).toBe('open');
      expect(flag.values['source']).toBe(FLAG_SOURCE_INTERNAL);
      expect(flag.values['resolvedAt']).toBeUndefined();
      expect(flag.values['resolvedBy']).toBeUndefined();
    }
  });

  it('a severity 5 finding is written at open too, which is where an auto-enforce would show', async () => {
    // The band an automatic path to `enforced` would be written for. ADR-155,
    // INV-M7-02, STATE_MACHINES section 7, P7 section 11 rule 11: no slice adds
    // one, and this is the behavioural half of the assertion below.
    const fake = fakeIo();
    await runDetectors(
      [
        stub({
          scan: () => ({
            findings: [
              {
                subjects: ['acct-real-a'],
                identityId: 'ident-real-a',
                flagType: 'destination_concentration',
                severity: 5,
                slaDueAt: new Date('2026-01-06T02:00:00.000Z'),
                evidence: { identities_sharing_destination: 2 },
              },
            ],
          }),
        }),
      ],
      config,
      fake.io,
    );
    const flag = fake.writes.find((w) => w.table === 'riskFlags');
    expect(flag?.values['severity']).toBe(5);
    expect(flag?.values['status']).toBe(FLAG_STATUS_ON_RAISE);
    expect(flag?.values['status']).toBe('open');
  });

  it('the runner reads no status from the finding, because the finding has no status to read', () => {
    // A finding carrying `status` is a TYPE ERROR under
    // exactOptionalPropertyTypes, and the assertion below is the runtime half:
    // the whole of `runner.ts` names `enforced` and `dismissed` nowhere.
    const source = read('apps/worker/src/detectors/runner.ts');
    const ports = read('apps/worker/src/detectors/ports.ts');
    expect(source).not.toMatch(/'enforced'/);
    expect(source).not.toMatch(/'dismissed'/);
    // `DetectorFinding` declares no `status` member. A later session adding one
    // turns this red before it turns anything else red.
    const finding = /export interface DetectorFinding \{([\s\S]*?)\n\}/.exec(ports)?.[1] ?? '';
    expect(finding).not.toMatch(/^\s*readonly status/m);
    expect(finding.length).toBeGreaterThan(0);
  });

  it('the transaction handle has no addressed write, so a transition has nowhere to go', () => {
    const ports = read('apps/worker/src/detectors/ports.ts');
    const handle = /export interface DetectorTx \{([\s\S]*?)\n\}/.exec(ports)?.[1] ?? '';
    expect(handle).toContain('rowsWhere');
    expect(handle).toContain('insert');
    // ADR-112 removed `update` and `delete` from every handle in the workspace;
    // this port additionally has no `updateAt` and no `deleteAt`.
    expect(handle).not.toMatch(/updateAt|deleteAt|\bupdate\b|\bdelete\b/);
  });

  it('this deployable’s one door is untouched: no detector file names @merit/db', () => {
    // ADR-165. `apps/worker/src/db.ts` is the one file that names the accessor
    // and `test/db.test.ts` asserts it over the whole tree; this is the same
    // assertion narrowed to the three files this slice added, so a reader of
    // THIS suite does not have to go and find that one.
    for (const file of ['runner.ts', 'ports.ts', 'canary.ts']) {
      expect(code(`apps/worker/src/detectors/${file}`)).not.toContain('@merit/db');
    }
  });

  it('no detector file adds a reason member, imports pg, or casts past a key type', () => {
    // P7 section 11 rule 10 and ADR-157 section 5, asserted rather than promised.
    for (const file of ['runner.ts', 'ports.ts', 'canary.ts']) {
      const source = code(`apps/worker/src/detectors/${file}`);
      expect(source).not.toMatch(/from 'pg'/);
      expect(source).not.toMatch(/sqlExecutor/);
      expect(source).not.toMatch(/SqlExecutorReason/);
      expect(source).not.toMatch(/SystemReason/);
      expect(source).not.toMatch(/as\s+TableKey/);
    }
  });
});

// =============================================================================
// 7. INV-M7-04: the run records the parameters it ran under
// =============================================================================

describe('INV-M7-04: a run records the parameters it ran under', () => {
  const config = { tradingDay: DAY };

  it('reads the registry row before anything else, on effective_to IS NULL', async () => {
    const fake = fakeIo();
    await runDetectors([stub()], config, fake.io);
    const first = fake.reads[0];
    expect(first?.table).toBe('detectorDefinitions');
    expect(first?.where['detector']).toBe('D-01');
    expect(first?.where['effectiveTo']).toEqual({ term: 'is-null' });
  });

  it('records the registry’s version and never one from the detector’s code', async () => {
    const fake = fakeIo({ definitions: [definitionRow('D-01', 'v7')] });
    const outcome = only(await runDetectors([stub()], config, fake.io));
    expect(outcome.detectorVersion).toBe('v7');
    expect(fake.writes.find((w) => w.table === 'detectorRuns')?.values['detectorVersion']).toBe(
      'v7',
    );
  });

  it('hands the detector the registry’s parameters', async () => {
    const seen: unknown[] = [];
    const reader = stub({
      streams: (request) => {
        seen.push(request.definition.parameters);
        return [];
      },
    });
    const parameters = { window_seconds: { state: 'stated', value: 2, unit: 'seconds' } };
    await runDetectors(
      [reader],
      config,
      fakeIo({ definitions: [definitionRow('D-01', 'v1', parameters)] }).io,
    );
    expect(seen).toEqual([parameters]);
  });

  it('refuses to run a detector with no current registry row', async () => {
    const fake = fakeIo({ definitions: [] });
    const outcome = only(await runDetectors([stub()], config, fake.io));
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain(DetectorUnregistered.name);
    expect(outcome.error).toContain('Why did this not fire in March');
    expect(fake.writes.find((w) => w.table === 'detectorRuns')?.values['detectorVersion']).toBe(
      UNREGISTERED_VERSION,
    );
  });

  it('refuses TWO current rows rather than picking one', async () => {
    const fake = fakeIo({
      definitions: [definitionRow('D-01', 'v1'), definitionRow('D-01', 'v2')],
    });
    const outcome = only(await runDetectors([stub()], config, fake.io));
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain(DetectorUnregistered.name);
    expect(outcome.error).toContain('NOT UNIQUE');
  });

  it('every flag names the run, and the run names the detector and its version', async () => {
    const fake = fakeIo({
      rows: {
        fills: [
          realFill('acct-real-a', 'ident-real-a', '2026-01-05T15:00:00.000Z', 1),
          realFill('acct-real-b', 'ident-real-b', '2026-01-05T15:00:00.000Z', 2),
        ],
      },
    });
    await runDetectors([clusterDetector()], config, fake.io);
    const run = fake.writes.find((w) => w.table === 'detectorRuns');
    const flag = fake.writes.find((w) => w.table === 'riskFlags');
    expect(flag?.values['detectorRunId']).toBe(run?.values['id']);
    expect(run?.values['detector']).toBe('D-01');
    expect(run?.values['detectorVersion']).toBe('v1');
    // The chain INV-M7-04 depends on: flag -> run -> (detector, version) ->
    // detector_definitions.parameters.
    expect(SEED_ROWS.rows.some((r) => r.detector === 'D-01' && r.version === 'v1')).toBe(true);
  });
});

// =============================================================================
// 8. INV-M7-07: every run is recorded, including the ones that raised nothing
// =============================================================================

describe('INV-M7-07: every run is recorded', () => {
  const config = { tradingDay: DAY };

  it('records a run that raised nothing', async () => {
    const fake = fakeIo();
    const outcome = only(
      await runDetectors(
        [
          stub({
            scan: ({ rows }) => {
              const account = (rows['fills'] ?? [])
                .map((r) => String(r['accountId']))
                .find(isCanaryId);
              return {
                findings:
                  account === undefined
                    ? []
                    : [
                        {
                          subjects: [account],
                          identityId: 'unused',
                          flagType: 'copy_cluster',
                          severity: 1,
                          evidence: { n: 1 },
                        },
                      ],
              };
            },
          }),
        ],
        config,
        fake.io,
      ),
    );
    expect(outcome.status).toBe('ok');
    expect(outcome.flagsRaised).toBe(0);
    expect(outcome.recorded).toBe(true);
    expect(fake.writes.filter((w) => w.table === 'detectorRuns').length).toBe(1);
  });

  it('records a run whose read threw', async () => {
    const throwing = stub({
      streams: () => {
        throw new Error('the join condition drifted');
      },
    });
    const fake = fakeIo();
    const outcome = only(await runDetectors([throwing], config, fake.io));
    expect(outcome.status).toBe('failed');
    expect(outcome.recorded).toBe(true);
    expect(fake.writes.find((w) => w.table === 'detectorRuns')?.values['status']).toBe('failed');
  });

  it('records a DetectorDeclined as failed rather than as a quiet ok', async () => {
    // Eleven of the eighteen registry rows carry no number at all, so a detector
    // reading `{state: 'unstated', value: null}` has to decline. Declining and
    // reporting `ok` would be FM-M7-01 written on purpose.
    const declining = stub({
      scan: () => {
        throw new DetectorDeclined('D-01', 'min_shared_fill_share_bp is unstated in the registry');
      },
    });
    const fake = fakeIo();
    const outcome = only(await runDetectors([declining], config, fake.io));
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain('DetectorDeclined');
    expect(fake.writes.find((w) => w.table === 'detectorRuns')?.values['status']).toBe('failed');
  });

  it('one detector’s failure never stops another’s run', async () => {
    const fake = fakeIo();
    const report = await runDetectors(
      [
        stub({
          id: 'D-01',
          streams: () => {
            throw new Error('broken');
          },
        }),
        stub({ id: 'D-02', canaries: (mint) => [mint.hedgedPair('D-02', 0)] }),
      ],
      config,
      fake.io,
    );
    expect(report.outcomes.map((o) => o.detector)).toEqual(['D-01', 'D-02']);
    expect(report.failed).toEqual(['D-01']);
    expect(report.degraded).toEqual(['D-02']);
    expect(fake.writes.filter((w) => w.table === 'detectorRuns').length).toBe(2);
  });

  it('reports a run whose row could NOT be written rather than pretending it was', async () => {
    const fake = fakeIo({ writeFails: true });
    const report = await runDetectors([stub()], config, fake.io);
    const outcome = only(report);
    expect(outcome.recorded).toBe(false);
    expect(report.unrecorded).toEqual(['D-01']);
    expect(fake.writes).toEqual([]);
  });

  it('the run row carries the clock the caller supplied and never the database’s', async () => {
    const fake = fakeIo();
    await runDetectors([stub()], config, fake.io);
    const run = fake.writes.find((w) => w.table === 'detectorRuns');
    expect(run?.values['startedAt']).toBeInstanceOf(Date);
    expect(run?.values['finishedAt']).toBeInstanceOf(Date);
    expect((run?.values['finishedAt'] as Date).getTime()).toBeGreaterThan(
      (run?.values['startedAt'] as Date).getTime(),
    );
    expect(run?.values['tradingDay']).toBe(DAY);
  });

  it('nothing commits when the transaction that staged it rejects', async () => {
    // ADR-006's criterion: the event commits with the run or neither does. A
    // degraded run whose page committed while the row rolled back is AS-M7-05
    // with an extra step.
    const fake = fakeIo({ writeFails: true });
    await runDetectors([stub()], config, fake.io);
    expect(fake.writes).toEqual([]);
    expect(fake.events).toEqual([]);
  });
});

// =============================================================================
// 9. Severity is a money decision wherever a slice writes one
// =============================================================================

describe('severity is a money decision', () => {
  const config = { tradingDay: DAY };

  function finder(finding: DetectorFinding): Detector {
    return stub({ scan: () => ({ findings: [finding] }) });
  }

  const base: DetectorFinding = {
    subjects: ['acct-real-a'],
    identityId: 'ident-real-a',
    flagType: 'copy_cluster',
    severity: 3,
    evidence: { n: 1 },
  };

  it('refuses a severity 4 finding with no SLA clock, at the port and not at the database', async () => {
    // M07 section 3.3: moving a detector from 3 to 4 changes who gets held.
    // ADR-040: 4 and 5 is the band G-HOLD-REQUIRED reads to hold a payout for 48
    // hours. Letting the database refuse it would roll back the run row too, so
    // INV-M7-07 would fail in the same instant.
    const outcome = only(
      await runDetectors([finder({ ...base, severity: 4 })], config, fakeIo().io),
    );
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain(DetectorFindingError.name);
    expect(outcome.error).toContain('risk_flags_high_severity_has_sla');
  });

  it('accepts a severity 4 finding that carries its clock', async () => {
    const due = new Date('2026-01-07T02:00:00.000Z');
    const fake = fakeIo();
    const outcome = only(
      await runDetectors([finder({ ...base, severity: 4, slaDueAt: due })], config, fake.io),
    );
    expect(outcome.status).toBe('degraded'); // its battery is unfound, separately
    expect(fake.writes.find((w) => w.table === 'riskFlags')?.values['slaDueAt']).toBe(due);
  });

  it('refuses a severity outside 1 to 5, and a non-integer severity', async () => {
    for (const severity of [0, 6, 3.5]) {
      const outcome = only(
        await runDetectors([finder({ ...base, severity })], config, fakeIo().io),
      );
      expect(outcome.status).toBe('failed');
      expect(outcome.error).toContain(DetectorFindingError.name);
    }
  });

  it('refuses a flag with empty evidence, which is INV-M7-03', async () => {
    const outcome = only(
      await runDetectors([finder({ ...base, evidence: {} })], config, fakeIo().io),
    );
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain('never a bare label');
  });

  it('flag.raised carries the names of the numbers and not the numbers', async () => {
    const fake = fakeIo();
    await runDetectors(
      [finder({ ...base, evidence: { window_seconds: 2, shared_fills: 11 } })],
      config,
      fake.io,
    );
    const raised = fake.events.find((e) => e.name === 'flag.raised');
    expect(raised?.payload['evidence_summary']).toEqual(['shared_fills', 'window_seconds']);
    expect(raised?.payload['severity']).toBe(3);
    expect(raised?.payload['detector_version']).toBe('v1');
  });
});

// =============================================================================
// 10. correlation_groups, which is P7-g's door
// =============================================================================

describe('correlation_groups, and the door P7-g writes through', () => {
  const config = { tradingDay: DAY };

  const group = {
    subjects: ['acct-a', 'acct-b', 'acct-c'],
    memberAccountIds: ['acct-a', 'acct-b', 'acct-c'],
    method: 'group-variance-ratio',
    statistic: '0.0412',
    threshold: '0.2000',
    evidence: { members: 3 },
  };

  it('writes a group row against the run', async () => {
    const fake = fakeIo();
    await runDetectors(
      [stub({ scan: () => ({ findings: [], groups: [group] }) })],
      config,
      fake.io,
    );
    const run = fake.writes.find((w) => w.table === 'detectorRuns');
    const written = fake.writes.find((w) => w.table === 'correlationGroups');
    expect(written?.values['detectorRunId']).toBe(run?.values['id']);
    expect(written?.values['tradingDay']).toBe(DAY);
    expect(written?.values['memberAccountIds']).toEqual(['acct-a', 'acct-b', 'acct-c']);
  });

  it('refuses a group of two, because 0008 says a group starts at three', async () => {
    const outcome = only(
      await runDetectors(
        [
          stub({
            scan: () => ({
              findings: [],
              groups: [{ ...group, memberAccountIds: ['acct-a', 'acct-b'] }],
            }),
          }),
        ],
        config,
        fakeIo().io,
      ),
    );
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain('at least three');
  });

  it('refuses a statistic that crossed the boundary as a number', async () => {
    // numeric comes back from pg as a string, and the naive Number() on one is
    // lossy (ADR-157 section 5 finding 8). A number here has already been
    // through a binary float.
    const outcome = only(
      await runDetectors(
        [
          stub({
            scan: () => ({ findings: [], groups: [{ ...group, statistic: 0.0412 }] }) as never,
          }),
        ],
        config,
        fakeIo().io,
      ),
    );
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain('exact decimal string');
  });

  it('a group naming a canary subject writes no correlation_groups row', async () => {
    const fake = fakeIo();
    const outcome = only(
      await runDetectors(
        [
          stub({
            canaries: (mint) => [mint.hedgedPair('D-01', 0)],
            scan: ({ rows }) => {
              const accounts = [
                ...new Set((rows['dailyMarks'] ?? []).map((r) => String(r['accountId']))),
              ];
              return {
                findings: [],
                groups: [
                  {
                    ...group,
                    subjects: accounts,
                    memberAccountIds: [...accounts, `${accounts[0] ?? ''}-third`],
                  },
                ],
              };
            },
          }),
        ],
        config,
        fake.io,
      ),
    );
    expect(outcome.syntheticFound).toBe(1);
    expect(outcome.groupsRecorded).toBe(0);
    expect(fake.writes.filter((w) => w.table === 'correlationGroups')).toEqual([]);
  });
});

// =============================================================================
// 11. The unwired default, which serves nothing
// =============================================================================

describe('the unwired default refuses rather than reporting a clean night', () => {
  it('every port refuses by name', async () => {
    await expect(UNWIRED_DETECTOR_RUNNER_IO.transact(() => Promise.resolve(1))).rejects.toThrow(
      DetectorRunnerUnwired,
    );
    expect(() => UNWIRED_DETECTOR_RUNNER_IO.now()).toThrow(/DetectorRunnerIo\.now/);
    expect(() => UNWIRED_DETECTOR_RUNNER_IO.nonce()).toThrow(/DetectorRunnerIo\.nonce/);
    expect(() => UNWIRED_DETECTOR_RUNNER_IO.terms.atMost(1)).toThrow(DetectorRunnerUnwired);
    expect(() => UNWIRED_DETECTOR_RUNNER_IO.terms.atLeast(1)).toThrow(DetectorRunnerUnwired);
    expect(() => UNWIRED_DETECTOR_RUNNER_IO.terms.isNull()).toThrow(DetectorRunnerUnwired);
  });

  it('says why, in the words AS-M7-05 uses', () => {
    expect(() => UNWIRED_DETECTOR_RUNNER_IO.now()).toThrow(/indistinguishable from a clean night/);
  });
});
