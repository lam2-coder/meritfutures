import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { stripComments } from '../../../packages/tooling/checks/strip-comments.mjs';

import {
  CADENCES,
  CADENCE_BY_DIGEST,
  CADENCE_PERIOD_MS,
  CHANNELS,
  DELIVERY_OUTCOMES,
  DIGESTS,
  DIGEST_ALARM_KINDS,
  DIGEST_READ_TABLES,
  DIGEST_WINDOW_ANCHOR,
  DIGEST_WRITE_TABLES,
  DigestRowError,
  DigestUnwired,
  FORMATS,
  PRODUCED_DIGESTS,
  RENDERED_FORMAT,
  UNWIRED_DIGEST_ALARM_IO,
  UNWIRED_DIGEST_IO,
  WORKER_BARREL_LEGS,
  WORKER_MODULES_BEHIND_A_LEG,
  WORKER_MODULES_NOT_RE_EXPORTED,
  artifactDigest,
  decideOutcome,
  deliveryValues,
  evaluateSchedule,
  findUndeliveredWindows,
  foldWindows,
  lossRatioBodyFrom,
  nextAttempt,
  readAlarmSchedule,
  readProducerSchedule,
  renderDigest,
  runDigestDeliveries,
} from '../src/index.ts';
import type {
  AlarmSchedule,
  BreakerEvaluationReport,
  DeclaredRow,
  DigestAlarmIo,
  DigestBody,
  DigestFilter,
  DigestFilterTerm,
  DigestIo,
  DigestReadTable,
  DigestReadTx,
  DigestSendResult,
  DigestTx,
  DigestValues,
  DigestWindowFold,
  DigestWriteTable,
  FlagQueueDigestBody,
  LossRatioDigestBody,
} from '../src/index.ts';

// =============================================================================
// `P7-l`, and the rule the whole slice turns on is `CRON_INVENTORY:35`:
//
//   THE ALARM ASSERTS THE QUERY AND NEVER THE JOB'S OWN REPORT. An enabled
//   schedule whose window closed with no `delivered` row is the finding,
//   evaluated independently of whether any run reported success.
//
// ADR-403: THE POINTER ABOVE IS WRONG AND IT IS DELIBERATELY LEFT WRONG.
// At the commit that wrote this comment, coordinate thirty-five of that
// runbook held the Tier-1 economic calendar staleness check row, and the
// Scheduled digest delivery row this slice is about sat one line below it.
// The pointer was one short on the day it was written. Both rows carry the
// same house phrase, "It asserts the query, not the job", which occurs five
// times in that file then and now, so the wrong line read exactly like the
// claim being made. G1 holds and G2 fails, which is ADR-388 class two, and
// repair is forbidden: moving the number would convert a record of a check
// that did not check into a record of one that did. The rule quoted above
// is unaffected and still true. Only the claim about where it was read is
// false. The retired coordinate is spelled in words rather than written in
// backticks, per ADR-388 section 4, so no check reads it as a live pointer.
//
// WHAT THIS SUITE IS FOR, ONE SENTENCE PER SECTION.
//
//   1. THE BINDS. Every constant is a transcription of `0040` or of an approved
//      plan, asserted against the primary source READ AS TEXT rather than
//      against a copy. A fifth digest cannot drift in on either side.
//   2. THE NUMBERS THIS SLICE DID NOT INVENT. Every anchor term is still
//      `unstated` and `monthly` still has no period, so filling one in is a red
//      suite rather than a quiet commit.
//   3. THE ALARM'S INDEPENDENCE, STRUCTURALLY. Its door cannot hold a run
//      report, its module imports nothing from the producer, and its handle
//      cannot write. A type checker sees none of the second, so it is read as
//      text.
//   4. THE FINDINGS, EACH WITH ITS NEAR-MISS. A detector tested only against a
//      case that should fire proves nothing about its threshold (`M07` section
//      8), and the same is true of an alarm.
//   5. **`GS-288`, THE NAMED CASE.** A run reports success, writes no
//      `delivered` row, and the alarm fires anyway. Run in three shapes, because
//      the three ways a report can be a lie are three different fixtures.
//   6. THE PRODUCER'S LADDER, against every one of `0040`'s eleven `CHECK`s.
//   7. `GS-290`, in both of the producer's two enforcements of it.
//   8. `INV-M6-10`, swept over the RENDERED artifact, because a type says
//      nothing about what a producer put in a string.
//   9. THE BARREL, in both directions, plus a TOTAL sweep of `src/`.
//  10. THE DOOR. No `pg`, no `@merit/db`, no `SqlExecutorReason` anywhere under
//      `src/digests/`.
// =============================================================================

const ROOT = join(import.meta.dirname, '..', '..', '..');
const MIGRATION = readFileSync(
  join(ROOT, 'packages/db/migrations/0040_report_schedules.sql'),
  'utf8',
);
const M06 = readFileSync(join(ROOT, 'docs/plans/M06-admin-ops-console.md'), 'utf8');
const ADR_066 = readFileSync(join(ROOT, 'docs/decisions/ADR-066.md'), 'utf8');
const CRON = readFileSync(join(ROOT, 'docs/ops/runbooks/CRON_INVENTORY.md'), 'utf8');
const PORTS_SOURCE = readFileSync(join(ROOT, 'apps/worker/src/digests/ports.ts'), 'utf8');
const ALARM_SOURCE = readFileSync(join(ROOT, 'apps/worker/src/digests/alarm.ts'), 'utf8');
const PRODUCE_SOURCE = readFileSync(join(ROOT, 'apps/worker/src/digests/produce.ts'), 'utf8');
const BARREL = readFileSync(join(ROOT, 'apps/worker/src/index.ts'), 'utf8');

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const NOW = new Date('2026-08-28T12:00:00.000Z');

/** The rendered artifact as text, which is what a recipient would read. */
function text(artifact: Uint8Array): string {
  return new TextDecoder().decode(artifact);
}

// -----------------------------------------------------------------------------
// A store, and it is the only thing either run may believe
// -----------------------------------------------------------------------------

// **THE STORE HOLDS THE ROWS `schema.ts` DECLARES NOW, AND THAT IS ADR-426's
// STRENGTHENING RATHER THAN ITS COST.** It read `Record<string, unknown>[]`,
// which let a fake stand in for the driver while agreeing with nothing: a
// fixture missing a column, or carrying one under a name no migration ever
// created, compiled and the suite went green on a row PostgreSQL cannot
// produce. Both fixtures below already carried every column, so what this
// costs is one `id` on `delivery()` and what it buys is that the next one
// cannot forget.
interface Store {
  reportSchedules: DeclaredRow<'reportSchedules'>[];
  reportDeliveries: DeclaredRow<'reportDeliveries'>[];
}

function emptyStore(): Store {
  return { reportSchedules: [], reportDeliveries: [] };
}

function schedule(
  over: Partial<DeclaredRow<'reportSchedules'>> = {},
): DeclaredRow<'reportSchedules'> {
  return {
    id: 'sched-loss',
    digest: 'weekly_loss_ratio_cusum',
    cadence: 'weekly',
    format: 'csv',
    channel: 'email',
    recipients: ['risk@merit.example'],
    enabled: true,
    createdBy: 'founder',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  };
}

function delivery(
  over: Partial<DeclaredRow<'reportDeliveries'>> = {},
): DeclaredRow<'reportDeliveries'> {
  return {
    // `bigint` AND NOT A NUMBER. `0040` declares this column
    // `generatedAlwaysAsIdentity` over `bigint`, and the accessor pins
    // `{ mode: 'bigint' }`, so the row the driver hands back carries a `bigint`
    // here. The fixture said nothing at all before this row, which is the
    // silence the typed store above closes.
    id: 1n,
    scheduleId: 'sched-loss',
    dueAt: new Date('2026-08-24T00:00:00.000Z'),
    attempt: 1,
    coversThroughTradingDay: '2026-08-21',
    channel: 'email',
    format: 'csv',
    recipientsAttempted: ['risk@merit.example'],
    recipientsOmitted: [],
    omissionReason: null,
    outcome: 'delivered',
    failureReason: null,
    attemptedAt: new Date('2026-08-24T00:05:00.000Z'),
    deliveredAt: new Date('2026-08-24T00:05:01.000Z'),
    artifactDigest: Buffer.alloc(32),
    createdAt: new Date('2026-08-24T00:05:01.000Z'),
    ...over,
  };
}

/** `ADR-157` clause 1's `atLeast`, as a fake mints it. */
function atLeast(value: NonNullable<unknown>): DigestFilterTerm {
  return { term: 'at-least', value };
}

function matches(row: object, where: DigestFilter): boolean {
  const columns = row as Record<string, unknown>;
  return Object.entries(where).every(([column, expected]) => {
    if (typeof expected === 'object' && expected !== null && 'term' in expected) {
      const term = expected as DigestFilterTerm;
      const actual = columns[column];
      if (term.term !== 'at-least' || !(actual instanceof Date) || !(term.value instanceof Date))
        return false;
      return actual.getTime() >= term.value.getTime();
    }
    const actual = columns[column];
    if (actual instanceof Date && expected instanceof Date)
      return actual.getTime() === expected.getTime();
    return actual === expected;
  });
}

function readTxOver(store: Store): DigestReadTx {
  return {
    // THE FAKE IS GENERIC FOR THE REASON THE PORT IS. `store[key]` is a union of
    // the two row arrays until `K` pins it, and the cast is where a recorder
    // stands in for the driver: the accessor resolves the key to one table and
    // this fake resolves it to one array, and nothing in TypeScript relates the
    // two indexes.
    rowsWhere: <K extends DigestReadTable>(key: K, where: DigestFilter) =>
      Promise.resolve(store[key].filter((row) => matches(row, where)) as DeclaredRow<K>[]),
  };
}

function alarmIo(store: Store, now: Date = NOW): DigestAlarmIo {
  return {
    read: (fn) => fn(readTxOver(store)),
    terms: { atLeast },
    now: () => now,
  };
}

interface ProducerOptions {
  readonly send?: (recipients: readonly string[]) => DigestSendResult;
  readonly sendThrows?: Error;
  readonly contentThrows?: Error;
  /** The seeded defect of section 5: writes are swallowed and the run says fine. */
  readonly swallowWrites?: boolean;
  readonly now?: Date;
}

function producerIo(store: Store, options: ProducerOptions = {}): DigestIo {
  const now = options.now ?? NOW;
  const tx: DigestTx = {
    rowsWhere: <K extends DigestReadTable>(key: K, where: DigestFilter) =>
      Promise.resolve(store[key].filter((row) => matches(row, where)) as DeclaredRow<K>[]),
    insert: (key: DigestWriteTable, values: DigestValues) => {
      if (options.swallowWrites === true) return Promise.resolve([values]);
      // `insert` IS NOT PART OF ADR-426's SPEND. The write verb still crosses as
      // `DigestValues`, so what the producer appends is a partial row and the
      // store has to be told so. Narrowing the write path is a different row and
      // is named in ADR-426 section 9.
      store[key].push({ ...values } as DeclaredRow<'reportDeliveries'>);
      return Promise.resolve([values]);
    },
  };
  return {
    transact: (fn) => fn(tx),
    terms: { atLeast },
    content: {
      lossRatioCusum: (day) => {
        if (options.contentThrows !== undefined) return Promise.reject(options.contentThrows);
        return Promise.resolve(lossRatioBody(day));
      },
      flagQueue: (day) => {
        if (options.contentThrows !== undefined) return Promise.reject(options.contentThrows);
        return Promise.resolve(flagQueueBody(day));
      },
    },
    transport: {
      send: (envelope) => {
        if (options.sendThrows !== undefined) return Promise.reject(options.sendThrows);
        if (options.send !== undefined) return Promise.resolve(options.send(envelope.recipients));
        return Promise.resolve({
          attempted: [...envelope.recipients],
          omitted: [],
          omissionReason: null,
          deliveredAt: now,
          failureReason: null,
        });
      },
    },
    now: () => now,
    tradingDayOf: () => '2026-08-27',
  };
}

function lossRatioBody(coversThroughTradingDay: string): LossRatioDigestBody {
  return {
    digest: 'weekly_loss_ratio_cusum',
    coversThroughTradingDay,
    plans: [
      {
        planCode: 'core-eod-50k',
        metric: 'loss_ratio_30d',
        state: 'armed',
        ratioBp: 4211,
        thresholdBp: 6000,
        sampleSize: 412,
        minSample: 20,
        salesPaused: false,
      },
    ],
    cusumBlockedOn: 'DEP-M6-05',
  };
}

function flagQueueBody(coversThroughTradingDay: string): FlagQueueDigestBody {
  return {
    digest: 'weekly_flag_queue',
    coversThroughTradingDay,
    bands: [
      {
        severity: 4,
        open: 3,
        oldestFirstDetectedOn: '2026-08-11',
        queueLink: '/admin/flags?severity=4&status=open',
      },
      { severity: 2, open: 11, oldestFirstDetectedOn: null, queueLink: '/admin/flags?severity=2' },
    ],
    totalOpen: 14,
    queueLink: '/admin/flags?status=open',
  };
}

function alarmSchedule(over: Partial<AlarmSchedule> = {}): AlarmSchedule {
  return {
    id: 'sched-loss',
    digest: 'weekly_loss_ratio_cusum',
    cadence: 'weekly',
    channel: 'email',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  };
}

function window(dueAt: string, over: Partial<DigestWindowFold> = {}): DigestWindowFold {
  return { dueAt: new Date(dueAt), attempts: 1, delivered: true, failed: 0, ...over };
}

// =============================================================================
// 1. The binds, every one asserted against its primary source read as text
// =============================================================================

test('1.1 the digest vocabulary is 0040’s CHECK, transcribed, and it is closed at four', () => {
  const clause = /digest\s+text NOT NULL CHECK \(digest IN \(([\s\S]*?)\)\)/.exec(MIGRATION);
  expect(clause, '0040 no longer declares the digest CHECK in the shape this test reads').not.toBe(
    null,
  );
  const admitted = [...(clause?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
  expect(admitted).toEqual([...DIGESTS]);
  expect(DIGESTS).toHaveLength(4);
  expect(MIGRATION).toContain('`report_schedules.digest` IS A CLOSED VOCABULARY OF FOUR');
});

test('1.2 the cadence map is 0040’s generated column, arm for arm', () => {
  // The CASE is written with alignment padding, so each arm is matched on its
  // two literals rather than on the whitespace between them.
  for (const digest of DIGESTS) {
    const arm = new RegExp(`WHEN '${digest}'\\s+THEN '([a-z]+)'`).exec(MIGRATION);
    expect(arm?.[1], `0040's CASE no longer maps ${digest}`).toBe(CADENCE_BY_DIGEST[digest]);
  }
  expect(new Set(Object.values(CADENCE_BY_DIGEST))).toEqual(new Set(CADENCES));
});

test('1.3 there are exactly two outcomes and there is deliberately no `skipped`', () => {
  const clause = /outcome\s+text NOT NULL CHECK \(outcome IN \(([^)]*)\)\)/.exec(MIGRATION);
  const admitted = [...(clause?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((match) => match[1]);
  expect(admitted).toEqual([...DELIVERY_OUTCOMES]);
  expect(DELIVERY_OUTCOMES).toHaveLength(2);
  expect(DELIVERY_OUTCOMES).not.toContain('skipped');
  expect(MIGRATION).toContain('THERE IS DELIBERATELY NO `skipped` OUTCOME');
});

test('1.4 the channel and format vocabularies are 0040’s', () => {
  expect(MIGRATION).toContain("format        text NOT NULL CHECK (format IN ('csv', 'pdf'))");
  expect(MIGRATION).toContain("channel       text NOT NULL CHECK (channel IN ('email', 'sftp'))");
  expect([...FORMATS]).toEqual(['csv', 'pdf']);
  expect([...CHANNELS]).toEqual(['email', 'sftp']);
});

test('1.5 the read union is two tables and the write union is exactly one', () => {
  expect([...DIGEST_READ_TABLES]).toEqual(['reportSchedules', 'reportDeliveries']);
  expect(DIGEST_WRITE_TABLES).toHaveLength(1);
  expect([...DIGEST_WRITE_TABLES]).toEqual(['reportDeliveries']);
  // `report_schedules` is configuration and every change to it is an INV-M6-01
  // admin_actions row. A delivery job that could write one could disable the
  // schedule it failed to serve.
  expect(DIGEST_WRITE_TABLES as readonly string[]).not.toContain('reportSchedules');
  expect(MIGRATION).toContain('`report_schedules` IS MUTABLE AND `report_deliveries` IS NOT');
});

test('1.6 the append-only grant is carried into the type: no update and no delete', () => {
  expect(MIGRATION).toContain('REVOKE UPDATE, DELETE ON report_deliveries FROM merit_app, PUBLIC;');
  expect(PORTS_SOURCE).not.toMatch(/^\s*updateAt\(/m);
  expect(PORTS_SOURCE).not.toMatch(/^\s*deleteAt\(/m);
  expect(PORTS_SOURCE).not.toMatch(/^\s*lockAt\(/m);
});

test('1.7 CRON_INVENTORY’s rule is quoted in this slice rather than paraphrased', () => {
  expect(CRON).toContain(
    'an enabled [`report_schedules`](../../architecture/data-model/report_schedules.md) row whose ' +
      'window has closed with no `delivered`',
  );
  expect(CRON).toContain('evaluated independently of whether any delivery run reported success');
  // The alarm's own header quotes it, with the line wrapping this file cannot
  // depend on removed before the comparison.
  const unwrapped = ALARM_SOURCE.replaceAll(/\n\/\/ ?/g, ' ').replaceAll(/\s+/g, ' ');
  expect(unwrapped).toContain(
    'EVALUATED INDEPENDENTLY OF WHETHER ANY DELIVERY RUN REPORTED SUCCESS',
  );
});

test('1.8 the plan row calls both digests MUST and the two approved sources do not', () => {
  // P7's `P7-l` row says "the two MUST digests". M06 section 3.6's sizing table
  // and ADR-066 section 3 both size `weekly_flag_queue` as SHOULD. This slice
  // builds what the row names and records the disagreement rather than
  // inheriting it.
  expect(M06).toContain('| **Flag queue summary** | weekly |');
  expect(M06).toMatch(/\*\*Flag queue summary\*\*[^|]*\|[^|]*\|[^|]*\| SHOULD \|/);
  expect(ADR_066).toContain('**The flag-queue and monthly cohort digests are SHOULD**');
  expect(PORTS_SOURCE).toContain('THE PRIMARY SOURCES DISAGREE');
  expect([...PRODUCED_DIGESTS]).toEqual(['weekly_flag_queue', 'weekly_loss_ratio_cusum']);
  // The MUST with no producer is `daily_liability`, and its absence is stated.
  expect(PRODUCED_DIGESTS as readonly string[]).not.toContain('daily_liability');
});

// =============================================================================
// 2. The numbers this slice did not invent
// =============================================================================

test('2.1 every window anchor is still `unstated`, so nobody can quietly fill one in', () => {
  const terms = Object.entries(DIGEST_WINDOW_ANCHOR);
  expect(terms.length).toBeGreaterThan(0);
  for (const [name, term] of terms) {
    expect(term.state, `${name} has acquired a value`).toBe('unstated');
    expect(term.value, `${name} has acquired a value`).toBe(null);
    expect(term.cite.length, `${name} states no source`).toBeGreaterThan(0);
    expect(term.quote.length, `${name} quotes no source`).toBeGreaterThan(0);
  }
});

test('2.2 a period is the meaning of the word, and `monthly` has none', () => {
  expect(CADENCE_PERIOD_MS.daily).toBe(DAY_MS);
  expect(CADENCE_PERIOD_MS.weekly).toBe(WEEK_MS);
  // A month is not a fixed number of milliseconds and no day-of-month anchor is
  // stated. A 30-day constant would be a number this slice invented.
  expect(CADENCE_PERIOD_MS.monthly).toBe(null);
});

test('2.3 the corpus states no delivery weekday, hour or zone for this row', () => {
  // The Expected-by cell for the scheduled-digest row names a thing rather than
  // defining one, which is why the anchor terms above are unstated.
  expect(CRON).toContain('| **Scheduled digest delivery**');
  expect(CRON).toContain("per schedule: daily, weekly and monthly | the schedule's own window");
});

test('2.4 only one format is rendered, and a pdf schedule is not quietly served csv', () => {
  expect(RENDERED_FORMAT).toBe('csv');
  expect(FORMATS as readonly string[]).toContain('pdf');
});

// =============================================================================
// 3. The alarm's independence from the producer, structurally
// =============================================================================

test('3.1 the alarm module imports nothing from the producer', () => {
  // A type checker cannot see a coupling that is only a call, so it is read as
  // text. `ports.ts` and `rows.ts` are the only two modules the alarm names.
  const imports = [...ALARM_SOURCE.matchAll(/^import[\s\S]*?from '([^']+)';$/gm)].map(
    (match) => match[1],
  );
  expect(imports.length).toBeGreaterThan(0);
  expect(new Set(imports)).toEqual(new Set(['./ports.ts', './rows.ts']));
  expect(imports).not.toContain('./produce.ts');
});

test('3.2 the alarm’s door has no field a producer could set', () => {
  const io = UNWIRED_DIGEST_ALARM_IO as unknown as Record<string, unknown>;
  expect(Object.keys(io).sort()).toEqual(['now', 'read', 'terms']);
  for (const forbidden of ['report', 'lastRun', 'succeeded', 'attempts', 'runReport'])
    expect(Object.keys(io)).not.toContain(forbidden);
});

test('3.3 the alarm’s handle cannot write', () => {
  const store = emptyStore();
  const handle = readTxOver(store) as unknown as Record<string, unknown>;
  expect(Object.keys(handle)).toEqual(['rowsWhere']);
  expect(handle['insert']).toBeUndefined();
  // And the alarm's own source never names one.
  expect(ALARM_SOURCE).not.toContain('tx.insert');
});

test('3.4 both unwired doors refuse rather than returning a plausible answer', async () => {
  await expect(findUndeliveredWindows(UNWIRED_DIGEST_ALARM_IO)).rejects.toThrow(DigestUnwired);
  await expect(runDigestDeliveries(UNWIRED_DIGEST_IO, { dueAt: NOW })).rejects.toThrow(
    DigestUnwired,
  );
});

// =============================================================================
// 4. The findings, each with its near-miss
// =============================================================================

test('4.1 a closed window whose only attempts failed is a finding', () => {
  const findings = evaluateSchedule(
    alarmSchedule(),
    [window('2026-08-24T00:00:00.000Z', { delivered: false, attempts: 3, failed: 3 })],
    NOW,
  );
  expect(findings.map((one) => one.kind)).toContain('window_not_delivered');
  expect(findings[0]?.detail).toContain('independent of what any run reported');
});

test('4.2 NEAR MISS: the same window, delivered once after two failures, is NOT a finding', () => {
  const findings = evaluateSchedule(
    alarmSchedule(),
    [window('2026-08-24T00:00:00.000Z', { delivered: true, attempts: 3, failed: 2 })],
    NOW,
  );
  expect(findings.map((one) => one.kind)).not.toContain('window_not_delivered');
});

test('4.3 NEAR MISS: a window that has not closed yet is not a finding', () => {
  const findings = evaluateSchedule(
    alarmSchedule(),
    [
      window('2026-08-27T00:00:00.000Z', { delivered: true }),
      window('2026-08-29T00:00:00.000Z', { delivered: false }),
    ],
    NOW,
  );
  expect(findings).toEqual([]);
});

test('4.4 a schedule with no delivery row at all, a period past its creation, is a finding', () => {
  const findings = evaluateSchedule(alarmSchedule(), [], NOW);
  expect(findings).toHaveLength(1);
  expect(findings[0]?.kind).toBe('no_window_recorded');
  expect(findings[0]?.since?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
});

test('4.5 NEAR MISS: a schedule created inside the current period is not yet a finding', () => {
  const findings = evaluateSchedule(
    alarmSchedule({ createdAt: new Date(NOW.getTime() - WEEK_MS + 1000) }),
    [],
    NOW,
  );
  expect(findings).toEqual([]);
});

test('4.6 the boundary is inclusive: exactly one period elapsed is already a finding', () => {
  expect(
    evaluateSchedule(alarmSchedule({ createdAt: new Date(NOW.getTime() - WEEK_MS) }), [], NOW).map(
      (one) => one.kind,
    ),
  ).toEqual(['no_window_recorded']);
  expect(
    evaluateSchedule(alarmSchedule({ createdAt: new Date(NOW.getTime() - WEEK_MS + 1) }), [], NOW),
  ).toEqual([]);
});

test('4.7 a delivered history that then stops is `window_overdue`', () => {
  const findings = evaluateSchedule(
    alarmSchedule(),
    [window('2026-08-01T00:00:00.000Z'), window('2026-08-08T00:00:00.000Z')],
    NOW,
  );
  expect(findings.map((one) => one.kind)).toEqual(['window_overdue']);
  expect(findings[0]?.elapsedMs).toBe(NOW.getTime() - Date.parse('2026-08-08T00:00:00.000Z'));
});

test('4.8 NEAR MISS: a delivered history still inside its period is silent', () => {
  expect(
    evaluateSchedule(
      alarmSchedule(),
      [window(new Date(NOW.getTime() - WEEK_MS + 1000).toISOString())],
      NOW,
    ),
  ).toEqual([]);
});

test('4.9 a monthly schedule reports `cadence_unanchored` rather than passing', () => {
  const findings = evaluateSchedule(
    alarmSchedule({ digest: 'monthly_revenue_cohort', cadence: 'monthly' }),
    [],
    NOW,
  );
  expect(findings.map((one) => one.kind)).toEqual(['cadence_unanchored']);
  expect(findings[0]?.detail).toContain('says so rather than returning green');
});

test('4.10 a monthly schedule still gets the half of the alarm that needs no period', () => {
  const findings = evaluateSchedule(
    alarmSchedule({ digest: 'monthly_revenue_cohort', cadence: 'monthly' }),
    [window('2026-07-01T00:00:00.000Z', { delivered: false, failed: 1 })],
    NOW,
  );
  expect(findings.map((one) => one.kind)).toEqual(['window_not_delivered', 'cadence_unanchored']);
});

test('4.11 every declared alarm kind is producible, so none is decoration', () => {
  const produced = new Set<string>();
  for (const finding of evaluateSchedule(
    alarmSchedule(),
    [window('2026-08-01T00:00:00.000Z', { delivered: false, failed: 1 })],
    NOW,
  ))
    produced.add(finding.kind);
  for (const finding of evaluateSchedule(alarmSchedule(), [], NOW)) produced.add(finding.kind);
  for (const finding of evaluateSchedule(
    alarmSchedule({ digest: 'monthly_revenue_cohort', cadence: 'monthly' }),
    [],
    NOW,
  ))
    produced.add(finding.kind);
  expect([...produced].sort()).toEqual([...DIGEST_ALARM_KINDS].sort());
});

test('4.12 a disabled schedule is not the alarm’s subject', async () => {
  const store = emptyStore();
  store.reportSchedules.push(schedule({ enabled: false }));
  const report = await findUndeliveredWindows(alarmIo(store));
  expect(report.schedulesEvaluated).toBe(0);
  expect(report.findings).toEqual([]);
});

test('4.13 an adapter that ignores the filter still cannot enrol a disabled schedule', async () => {
  // **SEEDED AND NOT CAUGHT UNTIL THIS FIXTURE EXISTED.** Deleting the alarm's
  // re-read of `enabled` changes nothing while the fake honours the filter it
  // was given, and a filter is a PROMISE ABOUT A READ rather than a property of
  // the row that came back. A disabled schedule alarming forever is how an
  // operator learns to ignore this page, so the predicate the whole subject set
  // rests on is checked on the row as well as sent in the filter.
  const store = emptyStore();
  store.reportSchedules.push(schedule({ enabled: false }));
  store.reportSchedules.push(schedule({ id: 'sched-flags', digest: 'weekly_flag_queue' }));
  const blind: DigestAlarmIo = {
    read: (fn) =>
      fn({
        rowsWhere: <K extends DigestReadTable>(key: K) =>
          Promise.resolve(store[key] as DeclaredRow<K>[]),
      }),
    terms: { atLeast },
    now: () => NOW,
  };
  const report = await findUndeliveredWindows(blind);
  expect(report.schedulesEvaluated).toBe(1);
  expect(report.findings.map((one) => one.scheduleId)).toEqual(['sched-flags']);
});

test('4.14 the cadence is derived from the digest and a row that disagrees is refused', () => {
  expect(() => readAlarmSchedule(schedule({ cadence: 'monthly' }), 'reportSchedules[0]')).toThrow(
    DigestRowError,
  );
  expect(readAlarmSchedule(schedule({ cadence: 'weekly' }), 'r').cadence).toBe('weekly');
  // A digest outside 0040's closed set is refused rather than defaulted.
  expect(() => readAlarmSchedule(schedule({ digest: 'weekly_suppressions' }), 'r')).toThrow(
    /which 0040's CHECK does not admit/,
  );
});

test('4.15 an outcome 0040 does not admit is refused rather than counted as not-delivered', () => {
  expect(() => foldWindows([delivery({ outcome: 'skipped' })], 'reportDeliveries')).toThrow(
    DigestRowError,
  );
});

// **THIS CASE NOW NEEDS A CAST TO SAY WHAT IT ALWAYS SAID, AND THAT IS ADR-426's SHARPEST FINDING
// RATHER THAN A NUISANCE.** Under the narrowed port `dueAt` IS a `Date`, so a string in that slot
// is a compile error and the malformed input this case exists to watch is no longer expressible
// without casting past the type. The cast stays and the case stays, because the type says "this
// cannot happen" on the authority of a TRANSCRIPTION. This read "`ADR-112` foreclosure 4 records
// that no check in this tree compares a `schema.ts` column type against the DDL." `RI-14`
// (ADR-444): FALSE when written; stated ONCE at limit 1 of `CatalogRow`
// (`packages/db/src/scoped-db.ts:3466`). THE EVIDENCE THIS BLOCK FIRST GAVE WAS ALSO WRONG, which
// `ADR-441` found: foreclosure 4 is about ADDRESSABILITY and EXHAUSTIVENESS and says nothing
// about comparing a column type. The ruling survives on a narrower footing, because what is
// compared is the folded MIGRATION TEXT and not the database. `ADR-299` section 5.1 item 5 rules
// that such a type does not retire a runtime check, and deleting either the cast or the refusal
// would trade a guard that fires for a claim nothing verifies.
test('4.16 a `due_at` that is not a Date is refused, because Invalid Date compares false', () => {
  expect(() =>
    foldWindows(
      [delivery({ dueAt: '2026-08-24T00:00:00.000Z' as unknown as Date })],
      'reportDeliveries',
    ),
  ).toThrow(/Invalid Date/);
  expect(() => foldWindows([delivery({ dueAt: new Date('nope') })], 'reportDeliveries')).toThrow(
    /Invalid Date/,
  );
});

test('4.17 the two M06 section 3.6 metrics are computed from the table', async () => {
  expect(M06).toContain('`admin.report_windows_undelivered`, which is zero, always, and is');
  const store = emptyStore();
  store.reportSchedules.push(schedule());
  store.reportDeliveries.push(
    delivery({
      attempt: 1,
      outcome: 'failed',
      failureReason: 'smtp 550',
      deliveredAt: null,
      artifactDigest: null,
    }),
    delivery({
      attempt: 2,
      outcome: 'failed',
      failureReason: 'smtp 550',
      deliveredAt: null,
      artifactDigest: null,
    }),
  );
  const report = await findUndeliveredWindows(alarmIo(store));
  expect(report.deliveriesFailed).toBe(2);
  expect(report.undeliveredWindows).toBeGreaterThan(0);
});

// =============================================================================
// 5. GS-288, THE NAMED CASE: the run reports success and nothing arrived
// =============================================================================

test('5.1 SEEDED: writes are swallowed, the run reports `delivered: 1`, and the alarm fires', async () => {
  // THE DEFECT THIS SLICE EXISTS AGAINST. A job that crashed after writing
  // "success" and a job that never ran are the same fact to the person who did
  // not get the digest. Here the transport succeeds, the producer builds a
  // valid `delivered` row, and the insert is lost.
  const store = emptyStore();
  store.reportSchedules.push(schedule({ createdAt: new Date('2026-08-01T00:00:00.000Z') }));

  const run = await runDigestDeliveries(producerIo(store, { swallowWrites: true }), {
    dueAt: new Date('2026-08-24T00:00:00.000Z'),
  });

  // The run's own account of itself is unambiguous and is worth nothing.
  expect(run.delivered).toBe(1);
  expect(run.failed).toBe(0);
  expect(run.results[0]?.outcome).toBe('delivered');

  // And the table, which is the only evidence, holds nothing.
  expect(store.reportDeliveries).toHaveLength(0);

  const alarm = await findUndeliveredWindows(alarmIo(store));
  expect(alarm.findings.map((one) => one.kind)).toEqual(['no_window_recorded']);
  expect(alarm.undeliveredWindows).toBe(1);
});

test('5.2 SEEDED: the same store, and a green run report cannot be handed to the alarm', async () => {
  const store = emptyStore();
  store.reportSchedules.push(schedule({ createdAt: new Date('2026-08-01T00:00:00.000Z') }));
  const run = await runDigestDeliveries(producerIo(store, { swallowWrites: true }), {
    dueAt: new Date('2026-08-24T00:00:00.000Z'),
  });
  // There is no parameter on either the door or the call through which this
  // value could travel, which is why the fixture above cannot be written any
  // other way. The run report says so in its own value as well.
  expect(run.evidenceIsTheDeliveryTable).toBe(true);
  expect(Object.keys(UNWIRED_DIGEST_ALARM_IO)).not.toContain('report');
  const before = await findUndeliveredWindows(alarmIo(store));
  expect(before.findings).toHaveLength(1);
});

test('5.3 SEEDED: the run writes a `failed` row and still reports the window as served', async () => {
  // The second shape of the same lie: evidence exists and says the opposite of
  // what a summary would. The alarm reads the row.
  const store = emptyStore();
  store.reportSchedules.push(schedule({ createdAt: new Date('2026-08-01T00:00:00.000Z') }));
  await runDigestDeliveries(
    producerIo(store, {
      send: () => ({
        attempted: [],
        omitted: [],
        omissionReason: null,
        deliveredAt: NOW,
        failureReason: null,
      }),
    }),
    { dueAt: new Date('2026-08-24T00:00:00.000Z') },
  );
  expect(store.reportDeliveries).toHaveLength(1);
  expect(store.reportDeliveries[0]?.['outcome']).toBe('failed');
  const alarm = await findUndeliveredWindows(alarmIo(store));
  expect(alarm.findings.map((one) => one.kind)).toEqual(['window_not_delivered']);
});

test('5.4 SEEDED: the job stops running entirely after a healthy history', async () => {
  // The third shape: nothing reports anything at all, because nothing runs.
  const store = emptyStore();
  store.reportSchedules.push(schedule());
  store.reportDeliveries.push(delivery({ dueAt: new Date('2026-08-10T00:00:00.000Z') }));
  const alarm = await findUndeliveredWindows(alarmIo(store));
  expect(alarm.findings.map((one) => one.kind)).toEqual(['window_overdue']);
});

test('5.5 NEAR MISS: the run wrote its row, and the alarm is silent', async () => {
  const store = emptyStore();
  store.reportSchedules.push(schedule());
  await runDigestDeliveries(producerIo(store), {
    dueAt: new Date(NOW.getTime() - DAY_MS),
  });
  expect(store.reportDeliveries).toHaveLength(1);
  expect(store.reportDeliveries[0]?.['outcome']).toBe('delivered');
  const alarm = await findUndeliveredWindows(alarmIo(store));
  expect(alarm.findings).toEqual([]);
  expect(alarm.undeliveredWindows).toBe(0);
});

test('5.6 an enabled digest with no producer gets NO row, and the alarm is what reports it', async () => {
  const store = emptyStore();
  store.reportSchedules.push(
    schedule({
      id: 'sched-liability',
      digest: 'daily_liability',
      cadence: 'daily',
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    }),
  );
  const run = await runDigestDeliveries(producerIo(store), { dueAt: NOW });
  expect(run.withoutProducer).toBe(1);
  expect(run.results[0]?.outcome).toBe('no_producer');
  // 0040 has no `skipped` outcome: "it writes nothing and the missing row is
  // itself the finding".
  expect(store.reportDeliveries).toHaveLength(0);
  const alarm = await findUndeliveredWindows(alarmIo(store));
  expect(alarm.findings.map((one) => one.kind)).toEqual(['no_window_recorded']);
});

// =============================================================================
// 6. The producer's ladder, against 0040's constraints
// =============================================================================

function attemptOver(over: Record<string, unknown> = {}): Parameters<typeof deliveryValues>[0] {
  return {
    scheduleId: 'sched-loss',
    dueAt: new Date('2026-08-24T00:00:00.000Z'),
    attempt: 1,
    coversThroughTradingDay: '2026-08-21',
    channel: 'email',
    format: 'csv',
    attempted: ['risk@merit.example'],
    omitted: [],
    omissionReason: null,
    outcome: 'delivered',
    failureReason: null,
    attemptedAt: new Date('2026-08-24T00:05:00.000Z'),
    deliveredAt: new Date('2026-08-24T00:05:01.000Z'),
    artifactDigest: Buffer.alloc(32),
    ...over,
  } as Parameters<typeof deliveryValues>[0];
}

test('6.1 a well-formed delivered attempt builds the row 0040 declares', () => {
  const values = deliveryValues(attemptOver());
  expect(Object.keys(values).sort()).toEqual(
    [
      'artifactDigest',
      'attempt',
      'attemptedAt',
      'channel',
      'coversThroughTradingDay',
      'deliveredAt',
      'dueAt',
      'failureReason',
      'format',
      'omissionReason',
      'outcome',
      'recipientsAttempted',
      'recipientsOmitted',
      'scheduleId',
    ].sort(),
  );
});

test('6.2 report_deliveries_attempt_is_ordinal', () => {
  expect(() => deliveryValues(attemptOver({ attempt: 0 }))).toThrow(/attempt >= 1/);
  expect(() => deliveryValues(attemptOver({ attempt: 1.5 }))).toThrow(/attempt >= 1/);
});

test('6.3 report_recipients_are_wellformed, both arrays', () => {
  expect(() => deliveryValues(attemptOver({ attempted: ['a@b.c', 'a@b.c'] }))).toThrow(
    /blank or a duplicate/,
  );
  expect(() =>
    deliveryValues(attemptOver({ omitted: ['   '], omissionReason: 'removed' })),
  ).toThrow(/blank or a duplicate/);
});

test('6.4 report_deliveries_recipient_sets_disjoint', () => {
  expect(() =>
    deliveryValues(
      attemptOver({ omitted: ['risk@merit.example'], omissionReason: 'removed 2026-08-20' }),
    ),
  ).toThrow(/both attempted and omitted/);
});

test('6.5 report_deliveries_omission_states_its_reason is an EQUIVALENCE, both directions', () => {
  // Omitted somebody and said nothing.
  expect(() => deliveryValues(attemptOver({ omitted: ['gone@merit.example'] }))).toThrow(
    /EQUIVALENCE/,
  );
  // Omitted nobody and claimed a removal.
  expect(() => deliveryValues(attemptOver({ omissionReason: 'removed' }))).toThrow(/EQUIVALENCE/);
  // Both halves present is accepted, which is GS-290's degraded delivery.
  expect(() =>
    deliveryValues(
      attemptOver({ omitted: ['gone@merit.example'], omissionReason: 'recipient removed' }),
    ),
  ).not.toThrow();
});

test('6.6 report_deliveries_delivered_has_timestamp and _has_digest, both directions', () => {
  expect(() => deliveryValues(attemptOver({ deliveredAt: null }))).toThrow(
    /delivered_has_timestamp/,
  );
  expect(() => deliveryValues(attemptOver({ artifactDigest: null }))).toThrow(
    /delivered_has_digest/,
  );
  expect(() =>
    deliveryValues(
      attemptOver({
        outcome: 'failed',
        failureReason: 'smtp 550',
        deliveredAt: new Date('2026-08-24T00:05:01.000Z'),
        artifactDigest: null,
      }),
    ),
  ).toThrow(/delivered_has_timestamp/);
});

test('6.7 report_deliveries_digest_is_sha256', () => {
  expect(() => deliveryValues(attemptOver({ artifactDigest: Buffer.alloc(20) }))).toThrow(
    /requires 32/,
  );
  expect(artifactDigest(renderDigest(lossRatioBody('2026-08-21')))).toHaveLength(32);
});

test('6.8 report_deliveries_failure_states_its_reason, both directions', () => {
  expect(() =>
    deliveryValues(attemptOver({ outcome: 'failed', deliveredAt: null, artifactDigest: null })),
  ).toThrow(/failure_states_its_reason/);
  expect(() => deliveryValues(attemptOver({ failureReason: 'why' }))).toThrow(
    /failure_states_its_reason/,
  );
});

test('6.9 report_deliveries_delivery_follows_attempt', () => {
  expect(() =>
    deliveryValues(
      attemptOver({
        attemptedAt: new Date('2026-08-24T00:05:02.000Z'),
        deliveredAt: new Date('2026-08-24T00:05:01.000Z'),
      }),
    ),
  ).toThrow(/delivery_follows_attempt/);
});

test('6.10 the attempt ordinal is derived from the rows already there', () => {
  expect(nextAttempt([], 'r')).toBe(1);
  expect(nextAttempt([delivery({ attempt: 1 }), delivery({ attempt: 3 })], 'r')).toBe(4);
});

test('6.11 a retry is a new row at the next ordinal and the first row survives it', async () => {
  const store = emptyStore();
  store.reportSchedules.push(schedule());
  const dueAt = new Date('2026-08-24T00:00:00.000Z');
  await runDigestDeliveries(
    producerIo(store, {
      send: () => ({
        attempted: [],
        omitted: [],
        omissionReason: null,
        deliveredAt: null,
        failureReason: 'smtp 421',
      }),
    }),
    { dueAt },
  );
  await runDigestDeliveries(producerIo(store), { dueAt });
  expect(store.reportDeliveries.map((row) => row['attempt'])).toEqual([1, 2]);
  expect(store.reportDeliveries.map((row) => row['outcome'])).toEqual(['failed', 'delivered']);
  // And the window now carries a delivered row, so the alarm is silent about it.
  expect(evaluateSchedule(alarmSchedule(), foldWindows(store.reportDeliveries, 'r'), NOW)).toEqual(
    [],
  );
});

test('6.12 a pdf schedule writes `failed` with its reason and no csv is sent under that name', async () => {
  const store = emptyStore();
  store.reportSchedules.push(schedule({ format: 'pdf' }));
  await runDigestDeliveries(producerIo(store), { dueAt: new Date('2026-08-24T00:00:00.000Z') });
  expect(store.reportDeliveries).toHaveLength(1);
  expect(store.reportDeliveries[0]?.['outcome']).toBe('failed');
  expect(store.reportDeliveries[0]?.['format']).toBe('pdf');
  expect(String(store.reportDeliveries[0]?.['failureReason'])).toContain('no pdf renderer exists');
});

test('6.13 a content failure and a transport failure both write `failed` with the reason', async () => {
  for (const options of [
    { contentThrows: new Error('the breaker declined') },
    { sendThrows: new Error('smtp unreachable') },
  ]) {
    const store = emptyStore();
    store.reportSchedules.push(schedule());
    await runDigestDeliveries(producerIo(store, options), {
      dueAt: new Date('2026-08-24T00:00:00.000Z'),
    });
    expect(store.reportDeliveries[0]?.['outcome']).toBe('failed');
    expect(String(store.reportDeliveries[0]?.['failureReason']).length).toBeGreaterThan(0);
  }
});

test('6.14 a transport that names a destination the schedule does not carry is refused', async () => {
  const store = emptyStore();
  store.reportSchedules.push(schedule());
  await expect(
    runDigestDeliveries(
      producerIo(store, {
        send: () => ({
          attempted: ['risk@merit.example', 'attacker@elsewhere.example'],
          omitted: [],
          omissionReason: null,
          deliveredAt: NOW,
          failureReason: null,
        }),
      }),
      { dueAt: new Date('2026-08-24T00:00:00.000Z') },
    ),
  ).rejects.toThrow(/may not add a destination/);
});

test('6.15 a schedule with no recipients is refused, which report_schedules_has_recipients is', () => {
  expect(() => readProducerSchedule(schedule({ recipients: [] }), 'r')).toThrow(
    /report_schedules_has_recipients/,
  );
  expect(() => readProducerSchedule(schedule({ channel: 'carrier-pigeon' }), 'r')).toThrow(
    /does not admit/,
  );
  expect(() => readProducerSchedule(schedule({ format: 'xlsx' }), 'r')).toThrow(/does not admit/);
});

// =============================================================================
// 7. GS-290, and it is enforced twice
// =============================================================================

test('7.1 GS-290 first enforcement: a send that reached nobody is DOWNGRADED to failed', () => {
  const decision = decideOutcome({
    attempted: [],
    omitted: ['gone@merit.example'],
    omissionReason: 'removed',
    // The transport claims a delivery time. It is not believed.
    deliveredAt: NOW,
    failureReason: null,
  });
  expect(decision.outcome).toBe('failed');
  expect(decision.deliveredAt).toBe(null);
  expect(decision.failureReason).toContain('reached no recipient at all');
});

test('7.2 GS-290 second enforcement: the row cannot be BUILT delivered with nobody attempted', () => {
  expect(() =>
    deliveryValues(
      attemptOver({ attempted: [], omitted: ['gone@merit.example'], omissionReason: 'removed' }),
    ),
  ).toThrow(/delivered_reached_somebody/);
});

test('7.3 GS-290 degraded delivery: the rest are served AND the removal is recorded', async () => {
  const store = emptyStore();
  store.reportSchedules.push(
    schedule({ recipients: ['risk@merit.example', 'gone@merit.example'] }),
  );
  await runDigestDeliveries(
    producerIo(store, {
      send: () => ({
        attempted: ['risk@merit.example'],
        omitted: ['gone@merit.example'],
        omissionReason: 'recipient removed from the operator directory',
        deliveredAt: NOW,
        failureReason: null,
      }),
    }),
    { dueAt: new Date('2026-08-24T00:00:00.000Z') },
  );
  const row = store.reportDeliveries[0];
  expect(row?.['outcome']).toBe('delivered');
  expect(row?.['recipientsOmitted']).toEqual(['gone@merit.example']);
  expect(String(row?.['omissionReason']).length).toBeGreaterThan(0);
});

test('7.4 full degradation to zero recipients writes `failed` end to end', async () => {
  const store = emptyStore();
  store.reportSchedules.push(schedule({ recipients: ['gone@merit.example'] }));
  await runDigestDeliveries(
    producerIo(store, {
      send: () => ({
        attempted: [],
        omitted: ['gone@merit.example'],
        omissionReason: 'recipient removed from the operator directory',
        deliveredAt: NOW,
        failureReason: null,
      }),
    }),
    { dueAt: new Date('2026-08-24T00:00:00.000Z') },
  );
  expect(store.reportDeliveries[0]?.['outcome']).toBe('failed');
  expect(store.reportDeliveries[0]?.['deliveredAt']).toBe(null);
  expect(store.reportDeliveries[0]?.['artifactDigest']).toBe(null);
});

// =============================================================================
// 8. INV-M6-10, swept over the rendered artifact
// =============================================================================

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const MAILBOX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

test('8.1 the flag-queue artifact carries counts and links and no trader', () => {
  const rendered = text(renderDigest(flagQueueBody('2026-08-21')));
  expect(rendered).not.toMatch(UUID);
  expect(rendered).not.toMatch(MAILBOX);
  expect(rendered).toContain('severity');
  expect(rendered).toContain('/admin/flags');
  expect(rendered).toContain('2026-08-21');
});

test('8.2 the loss-ratio artifact carries plan codes and no trader', () => {
  const rendered = text(renderDigest(lossRatioBody('2026-08-21')));
  expect(rendered).not.toMatch(UUID);
  expect(rendered).not.toMatch(MAILBOX);
  expect(rendered).toContain('core-eod-50k');
});

test('8.3 SEEDED: a body carrying an identity uuid in a link is caught by the sweep', () => {
  const poisoned: FlagQueueDigestBody = {
    ...flagQueueBody('2026-08-21'),
    queueLink: '/admin/identities/3f2504e0-4f89-11d3-9a0c-0305e82c3301',
  };
  const rendered = text(renderDigest(poisoned));
  expect(rendered).toMatch(UUID);
});

test('8.4 every field a body carries is a number, a plan code, a day or a link', () => {
  // INV-M6-10 as a property of the type, checked over both bodies' keys.
  const bodies: DigestBody[] = [lossRatioBody('2026-08-21'), flagQueueBody('2026-08-21')];
  for (const body of bodies)
    for (const key of Object.keys(body))
      expect([
        'identityId',
        'accountId',
        'email',
        'recipients',
        'traderName',
        'flagId',
      ]).not.toContain(key);
});

test('8.5 the artifact is hashed and never stored, which is 0040 header item 4', () => {
  expect(MIGRATION).toContain('NO ARTIFACT IS STORED HERE, ONLY ITS DIGEST');
  expect(PRODUCE_SOURCE).toContain('THE ARTIFACT IS NEVER STORED, ONLY ITS SHA-256');
  const a = artifactDigest(renderDigest(lossRatioBody('2026-08-21')));
  const b = artifactDigest(renderDigest(lossRatioBody('2026-08-22')));
  expect(a.equals(b)).toBe(false);
});

test('8.6 a value carrying a comma or a newline cannot shift a column', () => {
  const rendered = text(
    renderDigest({
      ...lossRatioBody('2026-08-21'),
      plans: [
        {
          planCode: 'core,"eod\n50k',
          metric: 'loss_ratio_30d',
          state: 'armed',
          ratioBp: 1,
          thresholdBp: 6000,
          sampleSize: 1,
          minSample: 20,
          salesPaused: false,
        },
      ],
    }),
  );
  expect(rendered).toContain('"core,""eod\n50k"');
});

// =============================================================================
// 9. The barrel, in both directions, plus a total sweep of src/
// =============================================================================

function barrelSpecifiers(): readonly string[] {
  return [...BARREL.matchAll(/from '(\.\/[^']+\.ts)';/g)].map((match) => match[1] ?? '');
}

test('9.1 every declared leg is still re-exported by the barrel', () => {
  const specifiers = new Set(barrelSpecifiers());
  for (const leg of WORKER_BARREL_LEGS)
    expect(specifiers, `${leg} is no longer re-exported by the barrel`).toContain(leg);
});

test('9.2 every specifier the barrel re-exports is a declared leg', () => {
  const declared = new Set<string>(WORKER_BARREL_LEGS);
  for (const specifier of new Set(barrelSpecifiers()))
    expect(declared, `${specifier} is re-exported and is not in WORKER_BARREL_LEGS`).toContain(
      specifier,
    );
});

test('9.3 the three lists cover every module under src/, and nothing appears twice', () => {
  // THE SWEEP THAT CATCHES THE FAILURE NOBODY IS LOOKING FOR: a new module the
  // barrel has never met. It found `batch/statistics.ts` when it was written.
  const modules: string[] = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(ROOT, 'apps/worker/src', relative), {
      withFileTypes: true,
    })) {
      const next = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (entry.name.endsWith('.ts') && next !== 'index.ts') modules.push(`./${next}`);
    }
  };
  walk('');
  expect(modules.length).toBeGreaterThan(20);

  const legs = new Set<string>(WORKER_BARREL_LEGS);
  const behind = new Set(Object.keys(WORKER_MODULES_BEHIND_A_LEG));
  const absent = new Set(Object.keys(WORKER_MODULES_NOT_RE_EXPORTED));

  for (const module of modules) {
    const memberships = [legs.has(module), behind.has(module), absent.has(module)].filter(Boolean);
    expect(
      memberships.length,
      `${module} is in ${String(memberships.length)} of the barrel's three lists and must be in ` +
        'exactly one. A module that is neither a leg, nor behind one, nor deliberately absent is ' +
        'a module nobody has decided about',
    ).toBe(1);
  }

  // And in the other direction: a stale entry for a module that no longer
  // exists is how an allowlist silently grants more than it names.
  const present = new Set(modules);
  for (const listed of [...legs, ...behind, ...absent])
    expect(present, `${listed} is listed by the barrel and no longer exists`).toContain(listed);
});

test('9.4 every name this slice exports is re-exported, NAME by NAME and not module by module', () => {
  // **SEEDED AND NOT CAUGHT BY 9.1, WHICH IS WHY THIS TEST EXISTS.** Deleting
  // the `export type { ... } from './digests/produce.ts'` block leaves the
  // VALUE block behind, so the module is still a specifier, `9.1` is still
  // green and `pnpm run typecheck` reports zero errors. The 2026-08-28 merge
  // that started all of this "deleted BOTH sides of a hunk"; one side is the
  // cheaper and likelier accident and module granularity cannot see it.
  //
  // ASSERTED FOR THIS SLICE'S FOUR MODULES ONLY. The other legs re-export
  // subsets deliberately and widening this sweep onto them is a decision for
  // whoever holds those files, which is reported rather than taken here.
  const declared = (source: string): readonly string[] =>
    [
      ...source.matchAll(
        /^export (?:declare )?(?:const|function|class|interface|type|enum) ([A-Za-z0-9_]+)/gm,
      ),
    ].map((match) => match[1] ?? '');
  const reExported = new Set(
    [...BARREL.matchAll(/^\s{2}([A-Za-z0-9_]+)(?: as [A-Za-z0-9_]+)?,$/gm)].map(
      (match) => match[1] ?? '',
    ),
  );
  // The SOURCE name is what is captured, so a leg re-exported under an alias
  // still counts: `WindowFold as DigestWindowFold` is `alarm.ts`'s own export
  // renamed because `breaker` already publishes a `WindowFold` from this barrel.
  for (const [module, source] of [
    ['./digests/ports.ts', PORTS_SOURCE],
    ['./digests/rows.ts', readFileSync(join(ROOT, 'apps/worker/src/digests/rows.ts'), 'utf8')],
    ['./digests/alarm.ts', ALARM_SOURCE],
    ['./digests/produce.ts', PRODUCE_SOURCE],
  ] as const) {
    const names = declared(source);
    expect(names.length, `${module} declares no exports, which cannot be right`).toBeGreaterThan(3);
    for (const name of names)
      expect(
        reExported,
        `${module} exports \`${name}\` and the barrel no longer re-exports it. A type checker ` +
          'cannot see an export that is simply gone, so this is the only thing that can',
      ).toContain(name);
  }
});

test('9.5 every reason in the not-re-exported list is stated rather than blank', () => {
  for (const [module, reason] of Object.entries(WORKER_MODULES_NOT_RE_EXPORTED))
    expect(reason.trim().length, `${module} is absent with no stated reason`).toBeGreaterThan(40);
  expect(Object.keys(WORKER_MODULES_NOT_RE_EXPORTED)).toContain('./batch/statistics.ts');
  expect(Object.keys(WORKER_MODULES_NOT_RE_EXPORTED)).toContain('./db.ts');
});

// =============================================================================
// 10. The door
// =============================================================================

test('10.1 nothing under src/digests reaches the accessor or the driver', () => {
  // ANCHORED AT A LINE START AND NOT SEARCHED AS A SUBSTRING, which is the
  // latent defect session 320 found in `db.test.ts`: a wrapped comment ending in
  // the word "from" reads as an import, and every `ports.ts` in this deployable
  // QUOTES the grep that proves the rule inside its own header.
  const imports = (source: string): readonly string[] =>
    [...source.matchAll(/^import[\s\S]*?from '([^']+)';$/gm)].map((match) => match[1] ?? '');
  for (const source of [PORTS_SOURCE, ALARM_SOURCE, PRODUCE_SOURCE]) {
    expect(imports(source)).not.toContain('pg');
    expect(imports(source)).not.toContain('@merit/db');
    // The identifiers are searched as CODE rather than as prose, so a header
    // that names the rule does not fail the rule.
    const code = source.replaceAll(/^\/\/.*$/gm, '').replaceAll(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toContain('SqlExecutorReason');
    expect(code).not.toContain('sqlExecutor');
    expect(code).not.toContain('SystemReason');
  }
});

test('10.2 src/db.ts is still the only file under apps/worker/src that imports @merit/db', () => {
  const offenders: string[] = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(ROOT, 'apps/worker/src', relative), {
      withFileTypes: true,
    })) {
      const next = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (
        entry.name.endsWith('.ts') &&
        /^import[\s\S]*?from '@merit\/db';$/m.test(
          readFileSync(join(ROOT, 'apps/worker/src', next), 'utf8'),
        )
      )
        offenders.push(next);
    }
  };
  walk('');
  expect(offenders).toEqual(['db.ts']);
});

test('10.3 the loss-ratio body is P7-k’s report folded, and the sample size travels', () => {
  const report: BreakerEvaluationReport = {
    evaluatedOn: '2026-08-27',
    metric: 'loss_ratio_30d',
    decisions: [
      {
        planId: 'plan-1',
        planCode: 'core-eod-50k',
        evaluatedOn: '2026-08-27',
        metric: 'loss_ratio_30d',
        fold: {
          numeratorCents: 150_000n,
          denominatorCents: 99_000n,
          sampleSize: 1,
          settledPayoutCount: 1,
        },
        ratioBp: 151_515,
        thresholdBp: 6000,
        minSample: 20,
        state: 'insufficient_data',
        floor: 'sample_size',
        override: null,
        previousState: null,
        salesPaused: false,
        floors: { minSample: 20, minSettledPayouts: null },
      },
    ],
    rowsWritten: 1,
    eventsEmitted: 0,
    plansPaused: 0,
    plansInsufficientData: 1,
  };
  const body = lossRatioBodyFrom(report, '2026-08-27', 'DEP-M6-05');
  expect(body.plans[0]?.sampleSize).toBe(1);
  expect(body.plans[0]?.salesPaused).toBe(false);
  expect(body.cusumBlockedOn).toBe('DEP-M6-05');
  // AS-M6-02's own scenario travels into the digest with its sample size
  // attached, which is INV-M6-07 and is why `sampleSize` is not optional.
  const rendered = text(renderDigest(body));
  expect(rendered).toContain('insufficient_data');
  expect(rendered).toContain('"1"');
  expect(rendered).toContain('absent: blocked on DEP-M6-05');
});

test('10.4 a ratio the breaker had no opinion about stays null and does not become zero', () => {
  const body: LossRatioDigestBody = {
    ...lossRatioBody('2026-08-21'),
    plans: [{ ...lossRatioBody('2026-08-21').plans[0], ratioBp: null } as never],
  };
  const rendered = text(renderDigest(body));
  const dataRow = rendered.split('\n').at(-2) ?? '';
  expect(dataRow).toContain(',,');
  expect(dataRow).not.toContain('"0"');
});

// =============================================================================
// 11. `ADR-303` LIMIT 4, SPENT FOR ONE VERB ON ONE HANDLE, AND THE MAPPING IT
//     DELETES (ADR-426)
// =============================================================================
// [ADR-421](docs/decisions/ADR-421.md) section 9 priced this: a narrowing that
// no reader can see buys nothing, and what makes limit 4 takeable is a row that
// holds the accessor AND a port family together and can show a HAND-WRITTEN
// MAPPING DELETED in the same commit. This section is that proof for the digest
// slice, which is the deployable's smallest read surface: two tables, twenty-one
// columns, one verb, and no money column on either table.
//
// WHAT IS DELETED IS THE EXISTENCE MAPPING AND NOT ONE REFUSAL. `ADR-299`
// section 5.1 item 5 is quoted in `packages/db/test/catalog-read.test.ts` and
// rules it: "a type derived from a transcription does not retire a runtime
// check". So `record()` -- whose whole content was `unknown` written down a
// second time -- goes, and every value refusal in `rows.ts` stays where it is.

const ROWS_SOURCE = readFileSync(join(ROOT, 'apps/worker/src/digests/rows.ts'), 'utf8');

test('11.1 the read port hands back the accessor row and no longer re-states `unknown`', () => {
  // THE MEMBER'S OWN RETURN, read the way `limit-4-census.test.ts` reads the
  // door: the first `Promise<` after this signature's parameter list closes.
  // Reading "an `unknown` nearby" is the defect that entry recorded catching in
  // its own fourth case, and it is not repeated here.
  const start = PORTS_SOURCE.indexOf('export interface DigestReadTx {');
  expect(start, '`DigestReadTx` was not found in `ports.ts`').toBeGreaterThan(-1);
  const block = PORTS_SOURCE.slice(start, PORTS_SOURCE.indexOf('\n}', start));
  const own = /rowsWhere[^)]*\)\s*:\s*(Promise<[^;{]*?)[;{]/.exec(block);
  expect(own?.[1], '`DigestReadTx.rowsWhere` has no readable return').toBeDefined();
  expect(own?.[1]?.trim()).not.toBe('Promise<unknown[]>');

  // AND THE KEY IS STILL THE NARROW UNION. The row spends limit 4's RETURN and
  // widens no key vocabulary, which is the half [ADR-424](docs/decisions/ADR-424.md)
  // section 7 watches: a `SystemTx` whose key vocabulary narrowed stops
  // satisfying `LiabilityTx` and `AdminSourceTx`, and nothing here touches it.
  expect(block).toContain('K extends DigestReadTable');
});

test('11.2 the hand-written existence mapping is DELETED from the slice', () => {
  const code = (source: string): string => stripComments(source, { literals: 'blank' });

  // THE ALIAS THAT WROTE `unknown` DOWN A SECOND TIME.
  expect(code(PORTS_SOURCE)).not.toContain('Readonly<Record<string, unknown>>;\n\n// ----');
  expect(code(PORTS_SOURCE)).not.toMatch(/export type DigestRow\b/);

  // THE FUNCTION THAT CAST IT. `record(` is the mapping [ADR-421](docs/decisions/ADR-421.md)
  // section 5 calls "a second place the `unknown` is written down", and it is
  // gone from the module that declared it and from both callers.
  expect(code(ROWS_SOURCE)).not.toMatch(/export function record\b/);
  for (const [name, source] of [
    ['alarm.ts', ALARM_SOURCE],
    ['produce.ts', PRODUCE_SOURCE],
  ] as const)
    expect(code(source), `${name} still calls the deleted mapping`).not.toMatch(/\brecord\(/);
});

test('11.3 every value refusal in `rows.ts` survived the deletion, one for one', () => {
  // `ADR-299` SECTION 5.1 ITEM 5. The narrowing buys reading a column without a guard for its
  // EXISTENCE; it buys nothing about the VALUE. This read "`schema.ts` is a transcription and no
  // check in this tree compares it to the DDL." `RI-14` (ADR-444): FALSE when written; stated
  // ONCE at limit 1 of `CatalogRow` (`packages/db/src/scoped-db.ts:3466`). A row that deleted
  // these along with the mapping would trade a refusal that fires for a type that cannot.
  const code = stripComments(ROWS_SOURCE, { literals: 'blank' });
  const READERS = [
    'readText',
    'readNullableText',
    'readInstant',
    'readBoolean',
    'readInteger',
    'readTextArray',
    'readTradingDay',
  ] as const;
  for (const reader of READERS)
    expect(code, `${reader} was deleted along with the mapping`).toContain(
      `export function ${reader}`,
    );
  // AND EVERY ONE OF THEM STILL REFUSES, ASSERTED PER READER RATHER THAN BY A
  // TOTAL. A count would have been the wrong instrument twice over: it is a
  // derivable number written down (`CI-06`), and it passes just as happily when
  // one reader loses its `throw` and another grows a second one. The property is
  // "each reader can still refuse", so each reader is read.
  for (const reader of READERS) {
    const start = code.indexOf(`export function ${reader}`);
    const body = code.slice(start, code.indexOf('\n}', start));
    // A REFUSAL REACHED THROUGH A DELEGATE COUNTS, AND THE FIRST FORM OF THIS
    // CASE DID NOT SAY SO. It demanded a `throw` in every body and went RED on
    // `readNullableText`, which has never had one: it returns `null` for an
    // absent value and hands everything else to `readText`. That is the reader
    // refusing through the one it delegates to, so the case reads for either.
    const refuses =
      body.includes('throw new DigestRowError(') ||
      READERS.some((other) => other !== reader && body.includes(`${other}(`));
    expect(refuses, `${reader} can no longer refuse, so the type retired a check`).toBe(true);
  }
});
