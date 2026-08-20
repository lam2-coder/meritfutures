import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// =============================================================================
// GS-288, GS-289, GS-290: scheduled digest delivery
// =============================================================================
// CI-02, the `unit` project. ADR-066 section 3, closing the gap M06:377 named
// when it called the weekly digest "the single most useful recurring artifact
// this module produces" and specified no way to deliver it.
//
// WHAT THESE CAN AND CANNOT ASSERT, STATED FIRST, on 0039's test's rule that a
// check which cannot verify the whole of what it claims says so and verifies
// the part it can.
//
// There is no delivery job, no renderer and no transport: apps/ is a scaffold.
// NOTHING HERE SENDS ANYTHING. What these assert is that THE ARTIFACTS THAT
// DECIDE THOSE BEHAVIOURS SAY WHAT ADR-066 RULED -- the migration's schema, the
// module plan's declared surface, and the runbooks that own the alarm and the
// ritual. Every assertion below fails on a real, specific regression a future
// session could otherwise land without anybody noticing.
//
// The executed half exists and is not here: 0040's constraints were run against
// PostgreSQL 16.13 while the file was written, 24 assertions, 24 / 24,
// tabulated in DELTA_MANIFEST section 4b. THAT RUN IS NOT REPEATABLE FROM THE
// TREE, because a committed probe must be wired into corpus.yml and pinned in
// gates.mjs (CI-06s) and both are outside this session's fence. The debt is
// named in the manifest rather than left to be discovered from an absence.
//
// THE ONE THAT MATTERS MOST IS THE ALARM'S SOURCE. ADR-066 section 3 says the
// alarm reads `report_deliveries` and NEVER the job's own report, which is M05
// INV-M5-18's construction on a second sweep. An alarm rewired to a job's
// success signal would still be an alarm, would still fire on a bad day, and
// would be silent on the exact day GS-288 is about.

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');

const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

const MIGRATION = 'packages/db/migrations/0040_report_schedules.sql';
const M06 = 'docs/plans/M06-admin-ops-console.md';
const CRON = 'docs/ops/runbooks/CRON_INVENTORY.md';
const RITUAL = 'docs/ops/runbooks/WEEKLY_RISK_RITUAL.md';

/** The migration, minus `--` comments, so prose in the header cannot satisfy a DDL assertion. */
function ddl(): string {
  const body = read(MIGRATION);
  const stripped = body
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n');
  // 0039's guard, and it is the reason it exists: the header of both files is
  // the bulk of them and names every column in prose, so a test grepping the
  // whole file would pass on the comments alone.
  expect(stripped.length).toBeLessThan(body.length / 2);
  return stripped;
}

/** The column names of one `CREATE TABLE` block, in declaration order. */
function columnsOf(table: string): string[] {
  const sql = ddl();
  const start = sql.indexOf(`CREATE TABLE ${table} (`);
  expect(start, `${table} is not created by ${MIGRATION}`).toBeGreaterThan(-1);
  const end = sql.indexOf('\n);', start);
  expect(end).toBeGreaterThan(start);
  return sql
    .slice(start, end)
    .split('\n')
    .map((line) => /^ {2}(\w+)\s+\S/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined && name !== 'CONSTRAINT');
}

/** M06 section 3.6 alone, so an assertion about the surface cannot be satisfied by another section. */
function digestSection(): string {
  const body = read(M06);
  const start = body.indexOf('### 3.6 Scheduled digest delivery');
  expect(start, 'M06 has no section 3.6; the digest surface is gone').toBeGreaterThan(-1);
  const end = body.indexOf('\n## 4. API endpoints touched', start);
  expect(end, 'M06 section 3.6 is not followed by section 4').toBeGreaterThan(start);
  return body.slice(start, end);
}

// The four ADR-066 section 3 sizes, and nothing else is schedulable.
const THE_FOUR = [
  'daily_liability',
  'weekly_loss_ratio_cusum',
  'weekly_flag_queue',
  'monthly_revenue_cohort',
];

describe('the named set, which is what makes this not a report builder', () => {
  test('digest is a closed vocabulary of exactly the four ADR-066 admits', () => {
    const sql = ddl();
    const check = /digest\s+text NOT NULL CHECK \(digest IN \(([\s\S]*?)\)\)/.exec(sql);
    expect(check, '0040 does not constrain `digest` to a closed set').not.toBeNull();
    const named = [...check![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    // EXACTLY, in both directions. A fifth value admitted here is the report
    // builder ADR-066 section 8 rejected, arriving one custom report at a time;
    // a missing one is a digest the ruling sized and nobody can schedule.
    expect(named).toEqual(THE_FOUR);
  });

  test('cadence is generated from digest, so the two cannot disagree', () => {
    const sql = ddl();
    // If this were an ordinary column, a daily liability digest could be
    // scheduled monthly by one careless insert and nothing would object.
    // 0019's `mutable` and 0029's `rate_limit_exempt` are the idiom.
    expect(sql).toMatch(/cadence\s+text NOT NULL GENERATED ALWAYS AS \(/);
    expect(sql).toMatch(/\) STORED,/);
    for (const digest of THE_FOUR) {
      expect(sql, `the CASE has no arm for ${digest}`).toMatch(
        new RegExp(`WHEN '${digest}'\\s+THEN '(daily|weekly|monthly)'`),
      );
    }
  });

  test('the two MUST digests are named in M06 as the ritual input they are sized for', () => {
    const section = digestSection();
    // ADR-066 section 3: the daily liability and weekly loss-ratio digests are
    // MUST because they are the C8 ritual's input, not because of the report.
    expect(section).toMatch(/\*\*Liability\*\*\s*\|\s*daily[\s\S]*?\*\*MUST\*\*/);
    expect(section).toMatch(/\*\*Plan loss ratios and CUSUM\*\*\s*\|\s*weekly[\s\S]*?\*\*MUST\*\*/);
    expect(section).toContain('P-M6-07');
  });
});

describe('GS-288: the alarm fires on the delivery record, never on the job', () => {
  test('the delivery row carries the window it discharges', () => {
    const sql = ddl();
    // WITHOUT THIS COLUMN THE ALARM HAS NOTHING TO FIRE ON. Absence is only
    // detectable against an expectation: "nothing arrived" and "not due yet"
    // return the same empty set.
    expect(sql).toMatch(/due_at\s+timestamptz NOT NULL/);
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX\s+report_deliveries_window_attempt_uq[\s\S]*?\(\s*schedule_id\s*,\s*due_at\s*,\s*attempt\s*\)/,
    );
  });

  test('the alarm has an index shaped like its query', () => {
    expect(ddl()).toMatch(
      /CREATE INDEX\s+report_deliveries_delivered_window_idx[\s\S]*?WHERE outcome = 'delivered'/,
    );
  });

  test('CRON_INVENTORY carries the dead-man row and says it asserts the query', () => {
    const body = read(CRON);
    const row = body.split('\n').find((l) => l.includes('**Scheduled digest delivery**'));
    expect(row, 'the digest job is not in the cron inventory').toBeDefined();
    // The inventory's own rule: a job in the estate without a dead-man switch
    // is a job that does not exist.
    expect(row).toContain('report_deliveries');
    expect(row).toContain('It asserts the query, not the job');
    expect(row).toContain('INV-M5-18');
  });

  test('a retry is a new row, so the failure that was retried survives', () => {
    const sql = ddl();
    expect(sql).toMatch(/report_deliveries_attempt_is_ordinal/);
    // An attempt counter updated in place answers "how bad was it" with
    // "fine, eventually".
    expect(sql).toMatch(
      /REVOKE\s+UPDATE\s*,\s*DELETE\s+ON report_deliveries\s+FROM merit_app, PUBLIC/,
    );
  });

  test('there is no `skipped` outcome', () => {
    const sql = ddl();
    const check = /outcome\s+text NOT NULL CHECK \(outcome IN \(([^)]*)\)\)/.exec(sql);
    expect(check, '0040 does not constrain `outcome`').not.toBeNull();
    const values = [...check![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    // A skip that can be RECORDED as an outcome is a skip that reads as normal
    // in a list of outcomes, and the acceptance is that a failed delivery
    // alarms and never silently skips.
    expect(values).toEqual(['delivered', 'failed']);
    expect(digestSection()).toContain('no `skipped` outcome');
  });
});

describe('GS-289: no digest is a bulk identity export (INV-M6-10)', () => {
  test('the delivery table stores a digest of the artifact and never the artifact', () => {
    const sql = ddl();
    expect(sql).toMatch(/artifact_digest\s+bytea NULL/);
    expect(sql).toMatch(/report_deliveries_digest_is_sha256/);
    // A COLUMN THAT COULD HOLD THE RENDERED BODY IS THE FINDING. M16 stores
    // `rendered_body` deliberately, for proof of notice about ONE recipient;
    // the same column here would be every liability figure and every flag-queue
    // row for every trader, behind an admin route, created by the feature that
    // was admitted on the promise it was not a bulk export.
    for (const forbidden of [/rendered_body/, /\bbody\b\s+text/, /payload\s+(text|jsonb)/]) {
      expect(forbidden.test(sql), `0040 stores an artifact body: ${forbidden}`).toBe(false);
    }
  });

  test('the column set of report_deliveries is pinned, so a body column cannot be added quietly', () => {
    expect(columnsOf('report_deliveries')).toEqual([
      'id',
      'schedule_id',
      'due_at',
      'attempt',
      'covers_through_trading_day',
      'channel',
      'format',
      'recipients_attempted',
      'recipients_omitted',
      'omission_reason',
      'outcome',
      'failure_reason',
      'attempted_at',
      'delivered_at',
      'artifact_digest',
      'created_at',
    ]);
  });

  test('M06 keeps INV-M6-10 explicit for the flag-queue digest, which is the one at risk', () => {
    const section = digestSection();
    expect(section).toContain('INV-M6-10');
    expect(section).toMatch(/counts and links, never trader-identifying rows/);
  });
});

describe('GS-290: degradation records the removal and cannot reach zero', () => {
  test('an omission with no stated reason is unwritable', () => {
    const sql = ddl();
    // An equivalence rather than an implication, closing both directions: an
    // attempt that omitted nobody may not claim a removal it did not make.
    expect(sql).toMatch(
      /report_deliveries_omission_states_its_reason CHECK \(\s*\(cardinality\(recipients_omitted\) > 0\) = \(omission_reason IS NOT NULL\)/,
    );
  });

  test('a delivery that reached nobody cannot be recorded as delivered', () => {
    // THE SHARPEST CONSTRAINT IN THE FILE. Full degradation to zero recipients
    // is not a degraded success, it is a failure that has learned to look like
    // one, and it is the exact shape of the thing this table exists against.
    expect(ddl()).toMatch(
      /report_deliveries_delivered_reached_somebody CHECK \(\s*outcome <> 'delivered' OR cardinality\(recipients_attempted\) > 0/,
    );
  });

  test('cardinality, not array_length (ADR-035, superseded seven times by 0028)', () => {
    const sql = ddl();
    // array_length(ARRAY[]::text[], 1) is NULL and a CHECK that evaluates to
    // NULL PASSES. Seven constraints shipped with that defect before 0028.
    expect(sql).not.toMatch(/array_length/);
    expect(sql).toMatch(/cardinality\(/);
  });

  test('the recipient sets are disjoint and wellformed on both tables', () => {
    const sql = ddl();
    expect(sql).toMatch(/report_deliveries_recipient_sets_disjoint/);
    expect(sql).toMatch(/report_schedules_recipients_wellformed/);
    expect(sql).toMatch(/report_deliveries_attempted_wellformed/);
    expect(sql).toMatch(/report_deliveries_omitted_wellformed/);
    // The helper is total for NULL, which is the half a NULL-passing CHECK
    // would leak through.
    expect(sql).toMatch(/SELECT r IS NOT NULL/);
  });
});

describe('the boundaries this file is not allowed to cross', () => {
  test('SFTP reuses no M02 object and stores no credential', () => {
    const sql = ddl();
    // M02's SFTP is a vendor wire format provisional under ADR-005. Coupling
    // them would make a change to a report a PROVISIONING INCIDENT.
    for (const forbidden of [/ingest_files/, /raw_ingest_rows/, /provisioning/i, /rithmic/i]) {
      expect(forbidden.test(sql), `0040 reaches into M02: ${forbidden}`).toBe(false);
    }

    // THE SECRET CHECK READS COLUMN NAMES AND NOT THE FILE, and that is a
    // correction rather than a style. The first version matched /credential/i
    // over the whole DDL and failed on `COMMENT ON COLUMN ... 'Never a
    // credential'` -- a sentence promising the opposite of what the test
    // accused it of. A tripwire that fires on the denial and would keep firing
    // however the denial were reworded is a tripwire nobody leaves switched on.
    const names = [...columnsOf('report_schedules'), ...columnsOf('report_deliveries')];
    for (const forbidden of [/password/i, /private_key/i, /secret/i, /credential/i, /token/i]) {
      const hit = names.find((n) => forbidden.test(n));
      expect(hit, `0040 has a column that could hold a secret: ${hit}`).toBeUndefined();
    }
    expect(digestSection()).toContain('reuses no [M02](M02-rithmic-bridge.md) code path');
  });

  test('the schedule table is NOT append-only and the delivery table is', () => {
    const sql = ddl();
    const revoke = /REVOKE\s+UPDATE\s*,\s*DELETE\s+ON ([\s\S]*?) FROM merit_app, PUBLIC/.exec(sql);
    expect(revoke, '0040 does not revoke UPDATE and DELETE').not.toBeNull();
    expect(revoke![1]).toContain('report_deliveries');
    // Deliberate: recipients change and a schedule gets disabled, each an
    // INV-M6-01 admin_actions row. Revoking here would make a schedule
    // unchangeable, which is not what append-only is for.
    expect(revoke![1]).not.toContain('report_schedules');
  });

  test('the ritual runbook names the digest as its input, not as an implication', () => {
    const body = read(RITUAL);
    // ADR-066 section 3's acceptance, in the runbook rather than implied. The
    // ritual and the artifact were specified in different documents months
    // apart and neither said the other existed.
    expect(body).toContain('## The input is a delivered digest, not a remembered login');
    expect(body).toContain('report_deliveries');
    expect(body).toContain('a job that reports success is not evidence that the work happened');
  });

  test('GS-288 to GS-290 are cited and not renumbered', () => {
    const section = digestSection();
    for (const gs of ['GS-288', 'GS-289', 'GS-290']) expect(section).toContain(gs);
    // They were registered in section 36 before any fold session ran, so that
    // four concurrent sessions could not race for numbers.
    const registry = read(
      'docs/testing/golden-scenarios/36-gs-285-to-gs-299-the-vendor-parity-gap-fill.md',
    );
    expect(registry).toMatch(/\| GS-288 \| A scheduled digest fails to deliver/);
    expect(registry).toMatch(
      /\| GS-290 \| A digest schedule names a recipient who has been removed/,
    );
  });
});
