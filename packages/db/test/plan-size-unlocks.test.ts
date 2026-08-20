import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

// =============================================================================
// INV-M18-07 AS AN ASSERTION RATHER THAN AS A PARAGRAPH
// =============================================================================
// M18 INV-M18-07: "Graduation confers no rule change on any account." SD-M18-04
// grants a purchase entitlement when a ladder completes, and INV-M18-07 is the
// invariant a future reader will think that violates. The reconciliation is
// that an unlock changes only WHICH `plan_version_sizes` ROW MAY BE PURCHASED,
// and this corpus prefers a gate over care, so it is asserted here.
//
// THIS RUNS IN THE `unit` PROJECT AND THAT IS THE POINT. The obvious home was
// `migrations.integration.test.ts`, and its own header says why that would have
// been a control nobody runs: the `integration` stage needs a Neon branch per
// run, cannot run on a fork pull request, and is deliberately not selected by
// CI-02. An assertion about a money-path invariant that runs in a stage with no
// database is an assertion that reports nothing.
//
// SO THE PROPERTY IS RESTATED IN A FORM THAT NEEDS NO DATABASE, and the restated
// form is stronger rather than weaker: instead of granting one unlock and
// diffing two tables afterwards, it asserts that `plan_size_unlocks` HAS
// NOWHERE TO PUT A RULE PARAMETER. A grant writes a row of that table; that
// table has no field that is a rule scalar; therefore no grant can move one, on
// any row, ever, rather than on the one row a fixture happened to touch.
//
// THE VOCABULARY IS DERIVED FROM `plan_version_sizes` ITSELF AND IS NOT A LIST
// KEPT HERE. A hand-maintained list of rule parameters in a test asserting that
// rule parameters cannot appear is the second-expression-of-one-concept defect
// ADR-036 exists against, and it would go stale the first time a scalar is
// added. Deriving it means a NEW rule scalar is automatically in scope.
// =============================================================================

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', 'migrations');

const UNLOCK_TABLE = 'plan_size_unlocks';
const SIZES_TABLE = 'plan_version_sizes';

/** Every migration body, so a later file that touches this table is in scope. */
function migrations(): { file: string; sql: string }[] {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (files.length === 0) throw new Error('no migrations found; the test cannot run');
  return files.map((file) => ({ file, sql: readFileSync(join(MIGRATIONS, file), 'utf8') }));
}

/**
 * Column names of one `CREATE TABLE`, read out of whichever migration creates
 * it. Comment lines are dropped first: this corpus's migrations carry more
 * prose than DDL and a `--` line mentioning a column is not a column.
 */
function columnsOf(table: string): string[] {
  const opener = new RegExp(`CREATE TABLE ${table}\\s*\\(`);
  for (const { sql } of migrations()) {
    const m = opener.exec(sql);
    if (!m) continue;
    const body = sql.slice(m.index + m[0].length);
    const end = body.indexOf('\n);');
    if (end === -1) throw new Error(`unterminated CREATE TABLE ${table}`);
    const names: string[] = [];
    for (const raw of body.slice(0, end).split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('--')) continue;
      // A constraint clause is not a column.
      if (/^(CONSTRAINT|PRIMARY KEY|UNIQUE|FOREIGN KEY|CHECK)\b/i.test(line)) continue;
      const name = /^([a-z_][a-z0-9_]*)\s+/.exec(line)?.[1];
      if (name) names.push(name);
    }
    if (names.length === 0) throw new Error(`parsed zero columns for ${table}`);
    return names;
  }
  throw new Error(`no migration creates ${table}`);
}

/**
 * The per-size rule scalars, derived rather than listed.
 *
 * Keys and timestamps are structural bookkeeping and `size_cents` is the
 * entitlement's subject; the exclusions carry their reasons inline. Every other
 * column of that table is a number the engine reads.
 */
function ruleScalars(): string[] {
  const structural = new Set([
    'id',
    'plan_version_id',
    'created_at',
    'updated_at',
    // THE SUBJECT OF THE ENTITLEMENT, not a rule it could move.
    // `plan_size_unlocks.unlocked_size_cents` NAMES a published size, and
    // naming which published row applies is the whole of what an unlock does.
    'size_cents',
  ]);
  const scalars = columnsOf(SIZES_TABLE).filter((c) => !structural.has(c));
  if (scalars.length === 0) throw new Error('no rule scalars derived; the test cannot run');
  return scalars;
}

test('the rule-scalar vocabulary is derived and non-trivial', () => {
  // A PARSER THAT SILENTLY STOPPED MATCHING WOULD MAKE EVERY ASSERTION BELOW
  // VACUOUS, which is the failure this corpus has recorded three times. The
  // known scalars are named here as a floor on the derivation, not as the list
  // the assertions use.
  const scalars = ruleScalars();
  for (const known of ['drawdown_cents', 'buffer_cents', 'profit_target_cents']) {
    expect(scalars).toContain(known);
  }
  expect(scalars.length).toBeGreaterThanOrEqual(6);
});

test('plan_size_unlocks has nowhere to put a rule parameter (INV-M18-07)', () => {
  const columns = columnsOf(UNLOCK_TABLE);
  expect(columns.length).toBeGreaterThan(0);

  // Substring rather than equality, so `unlock_drawdown_cents` fails too. An
  // exact-name check is one rename away from passing over the violation.
  const offenders = columns.flatMap((column) =>
    ruleScalars()
      .filter((scalar) => column.includes(scalar.replace(/_cents$/, '')))
      .map((scalar) => `${column} carries the rule scalar ${scalar}`),
  );
  expect(offenders).toEqual([]);
});

test('plan_size_unlocks references no rule-bearing table', () => {
  const { sql } = migrations().find((m) => m.sql.includes(`CREATE TABLE ${UNLOCK_TABLE}`))!;
  const m = new RegExp(`CREATE TABLE ${UNLOCK_TABLE}\\s*\\(`).exec(sql)!;
  const body = sql.slice(m.index, sql.indexOf('\n);', m.index));

  // An FK to either is a path a grant could write through.
  expect(body).not.toMatch(/REFERENCES\s+rule_states/);
  expect(body).not.toMatch(new RegExp(`REFERENCES\\s+${SIZES_TABLE}`));
});

test('the unlock migration writes no row of rule_states or plan_version_sizes', () => {
  const unlock = migrations().find((m) => m.sql.includes(`CREATE TABLE ${UNLOCK_TABLE}`))!;

  // Comments in this file discuss both tables at length, so the search is over
  // DDL rather than over prose.
  const ddl = unlock.sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');

  expect(ddl).not.toMatch(/\bUPDATE\b/i);
  expect(ddl).not.toMatch(/\brule_states\b/);
  // It may not alter the per-size scalars either: adding a column there would
  // be a rule change arriving through the unlock's own migration.
  expect(ddl).not.toMatch(new RegExp(`ALTER TABLE\\s+${SIZES_TABLE}`, 'i'));
});
