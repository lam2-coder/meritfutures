import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// =============================================================================
// GS-285, GS-286, GS-287: the Tier-1 economic calendar
// =============================================================================
// CI-02, the `unit` project. ADR-066 section 5.1, closing M07 DEP-M7-06.
//
// WHAT THESE CAN AND CANNOT ASSERT, STATED FIRST because rule 1 of both this
// repository's check runners is that a check which cannot verify the whole of
// what it claims says so and verifies the part it can.
//
// The portal is a scaffold today: apps/portal/src/index.ts is nine lines and
// its own comment reads "Not an application yet". THERE IS NO PANEL COMPONENT
// TO RENDER AND NO DETECTOR TO RUN, so nothing here executes a query or mounts
// a view. What these tests assert is that THE ARTIFACTS THAT DECIDE THOSE
// BEHAVIOURS SAY WHAT ADR-066 RULED: the migration's schema, and the module
// plan's declared source. That is the strongest form available before the
// surface exists, and it is not a placeholder -- every assertion below fails on
// a real, specific regression that a future session could otherwise land
// without anybody noticing.
//
// What is deliberately NOT claimed: that any row satisfies any of this. Both
// tables have zero rows. GS-285's two renderings, GS-286's re-evaluation and
// GS-287's declining detector each need a database and a detector, and they get
// their executable half when D-04 and the panel are built. The corpus-level
// half is here so that the design cannot drift out from under them first.
//
// THE ONE THAT MATTERS MOST IS THE EMBED ASSERTION. ADR-066 section 5.1 calls a
// test that the panel's source is `economic_calendar` and not an external
// origin "the only mechanical form of one source of truth", and an embed is
// exactly the cheap thing a later session reaches for when asked for a calendar
// widget. It would satisfy the display and satisfy none of DEP-M7-06, D-04 or
// FM-M7-08.

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');

const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

const MIGRATION = 'packages/db/migrations/0039_economic_calendar.sql';
const M04 = 'docs/plans/M04-trader-portal.md';
const CRON = 'docs/ops/runbooks/CRON_INVENTORY.md';

/** The migration, minus `--` comments, so prose in the header cannot satisfy a DDL assertion. */
function ddl(): string {
  const body = read(MIGRATION);
  const stripped = body
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n');
  // The header is the bulk of this file and it names every column in prose. A
  // test that grepped the whole file would pass on the comments alone, which is
  // the "check that cannot fail" this repository has already found twice.
  expect(stripped.length).toBeLessThan(body.length / 2);
  return stripped;
}

/**
 * The column names of one `CREATE TABLE` block, in declaration order.
 *
 * Column lines are indented two spaces and open with an identifier; `CONSTRAINT`
 * lines are excluded by name. This exists because the first version of the
 * no-timezone assertion below was `/\btime_?zone\b/`, WHICH CANNOT MATCH
 * `display_timezone`: `_` is a word character, so there is no boundary before
 * `timezone`, and a seeded timezone column passed the test. Pinning the whole
 * set is the fix, and it is strictly stronger than any name pattern: a column
 * added for any reason fails here and has to be argued for.
 */
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

/** M04 section 3.8 alone, so an assertion about the panel cannot be satisfied by another section. */
function panelSection(): string {
  const body = read(M04);
  const start = body.indexOf('### 3.8 The economic calendar panel');
  expect(start, 'M04 has no section 3.8; the panel is gone').toBeGreaterThan(-1);
  const end = body.indexOf('\n## 4. API endpoints consumed', start);
  expect(end, 'M04 section 3.8 is not followed by section 4').toBeGreaterThan(start);
  return body.slice(start, end);
}

describe('GS-285: one row, two timezones, and no embed', () => {
  test('the panel declares economic_calendar as its source', () => {
    const section = panelSection();
    expect(section).toContain('economic_calendar');
  });

  test('INV-M4-16 exists and binds the panel to Merit-owned data', () => {
    const body = read(M04);
    expect(body).toContain('INV-M4-16');
    // The invariant table row, not merely a mention in the prose.
    expect(body).toMatch(/\|\s*INV-M4-16\s*\|[^|]*economic_calendar/);
  });

  test('no external calendar origin is admitted anywhere in the portal or its plan', () => {
    // THE ASSERTION ADR-066 SECTION 5.1 NAMES. An embed cannot carry a revision,
    // cannot be staleness-monitored and cannot be joined to `fills`, so one
    // rendered beside the panel is a second source of truth for "when was the
    // news" -- the exact failure FM-M7-08 already guards.
    //
    // The vendor names are the ones a calendar widget actually ships from. The
    // list is not exhaustive and does not pretend to be: it is a tripwire on the
    // obvious reach, and INV-M4-16 is the rule.
    const forbidden = [
      /<iframe/i,
      /forexfactory/i,
      /investing\.com/i,
      /tradingview/i,
      /myfxbook/i,
      /econoday/i,
      /calendar[-_]?widget/i,
    ];
    // apps/portal is where a widget would land; M04 is where one would be
    // admitted in writing. Both are checked, because a plan that admitted an
    // embed would be the more durable failure.
    for (const file of [M04, 'apps/portal/src/index.ts']) {
      const body = read(file);
      for (const pattern of forbidden) {
        expect(pattern.test(body), `${file} names an external calendar origin: ${pattern}`).toBe(
          false,
        );
      }
    }
  });

  test('the schema stores one instant and no timezone, so the conversion is a rendering', () => {
    expect(ddl()).toMatch(/scheduled_release_at\s+timestamptz\s+NOT NULL/);

    // THE COLUMN SET IS PINNED, NOT PATTERN-MATCHED. A timezone column beside
    // the instant would be the second answer to "when was the news" and would
    // make two traders' dashboards disagree by construction, so GS-285 is only
    // meaningful while it stays absent -- and "absent" is asserted by naming
    // everything that is present.
    expect(columnsOf('economic_calendar')).toEqual([
      'id',
      'load_id',
      'event_key',
      'occurrence_key',
      'tier',
      'scheduled_release_at',
      'release_trading_day',
      'revision',
      'revision_reason',
      'created_at',
    ]);
  });

  test('release_trading_day is stored rather than derived from the UTC instant (B4 #1)', () => {
    const sql = ddl();
    expect(sql).toMatch(/release_trading_day\s+date\s+NOT NULL/);
    // Deriving the trading day from the timestamp is the error the corpus has
    // warned about three times on trading_calendar: a release at 23:30 UTC is
    // not on the UTC calendar date the engine counts in. If a later session
    // replaces the column with a cast, this fails.
    expect(sql).not.toMatch(/release_trading_day[^,]*GENERATED/i);
    expect(sql).not.toMatch(/scheduled_release_at::date/);
  });
});

describe('GS-286: a revision moves the panel and D-04 together', () => {
  test('revision is a stored ordinal, not a boolean or a flag', () => {
    const sql = ddl();
    expect(sql).toMatch(/revision\s+integer\s+NOT NULL/);
    expect(sql).toMatch(/economic_calendar_revision_is_ordinal/);
  });

  test('a revision is an append: the unique key includes revision', () => {
    const sql = ddl();
    // Without `revision` in the key, a corrected time would have to overwrite
    // the original and "what did the calendar say when D-04 read it" stops
    // being answerable.
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX\s+economic_calendar_occurrence_revision_uq[\s\S]*?\(\s*event_key\s*,\s*occurrence_key\s*,\s*revision\s*\)/,
    );
  });

  test('append-only is a grant, not a convention (VG-8)', () => {
    const sql = ddl();
    // 0026's ALTER DEFAULT PRIVILEGES makes both tables UPDATE-able the instant
    // they exist. Without this REVOKE, "the revision is a row, not an update" is
    // a sentence in a header and a loader can move the instant in place.
    const revoke = /REVOKE\s+UPDATE\s*,\s*DELETE\s+ON([\s\S]*?)FROM\s+merit_app\s*,\s*PUBLIC/.exec(
      sql,
    );
    expect(revoke, '0039 does not revoke UPDATE and DELETE').not.toBeNull();
    expect(revoke?.[1]).toContain('economic_calendar');
    expect(revoke?.[1]).toContain('economic_calendar_loads');
  });

  test('one definition of "current", ordered by revision, read by both consumers', () => {
    const sql = ddl();
    // The view IS the mechanism. Two consumers each picking the maximum revision
    // in their own code is a convention that fails as the panel showing 08:30
    // while D-04 clusters against 09:00.
    expect(sql).toMatch(/CREATE VIEW\s+economic_calendar_current/);
    expect(sql).toMatch(/DISTINCT ON\s*\(\s*event_key\s*,\s*occurrence_key\s*\)/);
    expect(sql).toMatch(/ORDER BY\s+event_key\s*,\s*occurrence_key\s*,\s*revision\s+DESC/);
  });

  test('a revision states its reason and an original may not claim one', () => {
    const sql = ddl();
    // An equivalence rather than an implication, closing both directions. Both
    // sides are total, so there is no NULL-passes trap: ADR-035 found that
    // defect seven times and 0032 found it again.
    expect(sql).toMatch(
      /economic_calendar_revision_states_its_reason\s+CHECK\s*\(\s*\(\s*revision\s*=\s*0\s*\)\s*=\s*\(\s*revision_reason\s+IS NULL\s*\)\s*\)/,
    );
  });
});

describe('GS-287: a stale calendar declines rather than firing on wrong windows', () => {
  test('the coverage bound exists, which is what makes declining possible', () => {
    const sql = ddl();
    // Without a stored coverage bound, an exhausted calendar returns no releases
    // and that is byte-identical to a quiet week. D-04 would then report a clean
    // result it has no basis for.
    expect(sql).toMatch(/CREATE TABLE economic_calendar_loads/);
    expect(sql).toMatch(/coverage_start_day\s+date\s+NOT NULL/);
    expect(sql).toMatch(/coverage_end_day\s+date\s+NOT NULL/);
    expect(sql).toMatch(/economic_calendar_loads_coverage_ordered/);
  });

  test('the alarm reads the coverage fact, and every release traces to a load', () => {
    const sql = ddl();
    expect(sql).toMatch(/economic_calendar_loads_horizon_idx[\s\S]*?coverage_end_day\s+DESC/);
    // A release with no load is a release whose freshness cannot be judged.
    expect(sql).toMatch(
      /load_id\s+bigint\s+NOT NULL\s*REFERENCES economic_calendar_loads\(id\) ON DELETE RESTRICT/,
    );
  });

  test('FM-M7-08 has a dead-man switch, because a job without one does not exist', () => {
    // CRON_INVENTORY's own opening rule: "a job in this table without a dead-man
    // switch is a job that does not exist". FM-M7-08 requires the alarm; this is
    // where an alarm becomes real.
    const body = read(CRON);
    const row = body
      .split('\n')
      .find((line) => /economic calendar staleness/i.test(line) && line.startsWith('|'));
    expect(row, 'CRON_INVENTORY has no economic calendar staleness row').toBeDefined();
    expect(row).toContain('FM-M7-08');
    // ADR-040's idiom, and the reason this is not a smoke test: the alarm asserts
    // the query independently of whether any loader reported success. A job that
    // reports success is not evidence that the work happened.
    expect(row).toMatch(/asserts the query, not the job/i);
  });

  test('the declining behaviour is pinned in writing, not left to the detector author', () => {
    // The load-bearing half of GS-287. Firing on a wrong window manufactures
    // evidence against a trader, so "decline" is a ruling rather than an
    // implementation preference, and it has to survive the session that
    // eventually writes D-04.
    const row = read(CRON)
      .split('\n')
      .find((line) => /economic calendar staleness/i.test(line) && line.startsWith('|'));
    expect(row).toMatch(/decline/i);
    expect(row).toMatch(/manufactures evidence against a trader/i);
  });
});
