#!/usr/bin/env node
// =============================================================================
// scripts/db/assert_date_unit_shape.mjs
// =============================================================================
// ADR-042's SECOND MECHANISM. A shape check over packages/db/migrations:
//
//   1. No `interval` arithmetic against a `date` column.
//   2. No `timestamptz` cast to `date`.
//
//   node scripts/db/assert_date_unit_shape.mjs            check the tree
//   node scripts/db/assert_date_unit_shape.mjs --falsify  watch it fail on a seed
//
// IT IS VACUOUSLY TRUE TODAY AND THAT IS THE WHOLE ARGUMENT FOR WIRING IT NOW.
// Across the merged set there is zero `::date`, zero `CAST(... AS date)` and
// zero `interval` arithmetic. Nothing is wrong. A gate wired while it is green,
// and watched failing on a seeded violation, is the cheapest it will ever be.
//
// THE EXPOSURE IS WHAT ALREADY LANDED, not what is here. `0029` to `0031`
// introduced the first `interval '48 hours'` arithmetic and the first `now()`
// comparisons on the money path, plus an hourly sweep. THE MOMENT THAT IS
// IDIOMATIC IN THE PAYOUT TABLES, the next session that needs "five trading days
// from now" has a working pattern sitting right there, and
// `some_trading_day + interval '5 days'` produces a WRONG ANSWER ON ROUGHLY 104
// DAYS A YEAR while reading as though somebody thought about it. Nothing in the
// type system objects: `date + interval` is valid PostgreSQL that returns a
// timestamp, and the result lands back in a `date` column by an implicit cast.
//
// WHY BOTH DIRECTIONS ARE BANNED. Interval arithmetic against a date invents
// trading days that the exchange did not have. A `timestamptz::date` derives a
// trading day from a UTC calendar date, which is B4 #1 exactly: the trading day
// is data, never arithmetic, and 17:00 CT on Sunday is Monday's session.
//
// WHY A PARSE OF THE CONSTRUCT AND NOT A GREP FOR THE WORD. `0032`'s header uses
// the English word "interval" five times, describing the fabricated session
// interval that ADR-042 F-1 abolished. A grep for the letters would fire on a
// comment and would still miss `some_day + '5 days'::interval`, which is the
// same arithmetic spelled the other way round. Comments are stripped and string
// literals are neutralised before anything is matched.
//
// WHAT IT DOES NOT CATCH, stated rather than implied. It reads text, not a
// parse tree: arithmetic assembled at runtime in application code is invisible
// here, and so is a date reached through a view or a function body defined
// elsewhere. `merit/no-calendar-in-expiry-path` covers the application half and
// `CI-06m` covers the declaration half. Three mechanisms, because no one of
// them sees the whole thing.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS = 'packages/db/migrations';

/**
 * Comments out, string literals neutralised to same-length blanks so every
 * offset still points where it did. A dollar-quoted body ($$...$$) is PL/pgSQL
 * source and stays: a trigger that does date arithmetic is exactly as wrong as
 * a column default that does.
 */
export function neutralise(sql) {
  let out = sql.replace(/--[^\n]*/g, (m) => ' '.repeat(m.length));
  out = out.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  out = out.replace(/'(?:[^']|'')*'/g, (m) => `'${' '.repeat(Math.max(0, m.length - 2))}'`);
  return out;
}

/** Every `date` column the migrations declare, as a lower-cased name set. */
export function dateColumnNames(files) {
  const names = new Set();
  for (const { sql } of files) {
    for (const m of sql.matchAll(/^\s*([a-z_][a-z0-9_]*)\s+date\b/gim))
      names.add(m[1].toLowerCase());
    for (const m of sql.matchAll(
      /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s+date\b/gi,
    ))
      names.add(m[1].toLowerCase());
  }
  return names;
}

/**
 * The two banned shapes. Each returns findings as
 * `{ file, line, text, rule }`.
 */
export function findings(files) {
  const out = [];
  const dateCols = dateColumnNames(files);

  for (const { file, sql } of files) {
    const clean = neutralise(sql);
    const lineOf = (index) => clean.slice(0, index).split('\n').length;
    const lineText = (index) => sql.split('\n')[lineOf(index) - 1]?.trim() ?? '';

    // 1a. `<something> +/- interval '...'` or `+/- '...'::interval`, where the
    //     left side is a date column this schema declares.
    const INTERVAL_ARITH =
      /([a-z_][a-z0-9_.]*)\s*([+-])\s*(?:interval\b|'[^']*'\s*::\s*interval\b|\(\s*interval\b)/gi;
    for (const m of clean.matchAll(INTERVAL_ARITH)) {
      const left = (m[1].split('.').pop() ?? '').toLowerCase();
      if (!dateCols.has(left)) continue;
      out.push({
        file,
        line: lineOf(m.index),
        text: lineText(m.index),
        rule: 'interval-against-date',
        detail:
          `\`${m[1]}\` is a date column and this is interval arithmetic against it. ` +
          'A trading day is data, never arithmetic (B4 #1): adding days to one invents sessions ' +
          'the exchange did not have, and it is wrong on roughly 104 days a year. If the answer ' +
          'wanted is a release deadline, the unit is wall-clock hours on a timestamptz (ADR-042).',
      });
    }

    // 1b. The mirror: `interval '...' + <date column>`.
    const INTERVAL_ARITH_LEFT = /interval\s*'[^']*'\s*\+\s*([a-z_][a-z0-9_.]*)/gi;
    for (const m of clean.matchAll(INTERVAL_ARITH_LEFT)) {
      const right = (m[1].split('.').pop() ?? '').toLowerCase();
      if (!dateCols.has(right)) continue;
      out.push({
        file,
        line: lineOf(m.index),
        text: lineText(m.index),
        rule: 'interval-against-date',
        detail: `\`${m[1]}\` is a date column and this is interval arithmetic against it, written left to right.`,
      });
    }

    // 2. A cast to `date`, in either spelling. Narrowed to casts whose SOURCE is
    //    a timestamp: `'2026-01-01'::date` in a seed is a literal being typed,
    //    not a trading day being derived from a clock.
    const CAST_COLON = /([a-z_][a-z0-9_.()]*)\s*::\s*date\b/gi;
    for (const m of clean.matchAll(CAST_COLON)) {
      const src = m[1].toLowerCase();
      if (!/now\(\)|current_timestamp|_at\b|timestamp/.test(src)) continue;
      out.push({
        file,
        line: lineOf(m.index),
        text: lineText(m.index),
        rule: 'timestamptz-cast-to-date',
        detail:
          `\`${m[1]}::date\` derives a day from an instant. THE TRADING DAY IS THE SESSION THAT ` +
          "CONTAINS THE INSTANT, not the instant's UTC calendar date: 17:00 CT on Sunday belongs " +
          "to Monday's session. Resolve it through trading_calendar containment (R-01), never a cast.",
      });
    }
    const CAST_FN = /\bCAST\s*\(([^)]*?)\s+AS\s+date\s*\)/gi;
    for (const m of clean.matchAll(CAST_FN)) {
      const src = m[1].toLowerCase();
      if (!/now\(\)|current_timestamp|_at\b|timestamp/.test(src)) continue;
      out.push({
        file,
        line: lineOf(m.index),
        text: lineText(m.index),
        rule: 'timestamptz-cast-to-date',
        detail: `\`CAST(${m[1].trim()} AS date)\` derives a day from an instant. Resolve it through trading_calendar containment (R-01).`,
      });
    }
  }
  return out;
}

function loadMigrations() {
  const dir = join(ROOT, MIGRATIONS);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: `${MIGRATIONS}/${f}`, sql: readFileSync(join(dir, f), 'utf8') }));
  // A checker whose input set went empty would report a clean tree.
  if (files.length === 0)
    throw new Error(`${MIGRATIONS} holds no .sql; the shape check cannot run`);
  return files;
}

// -----------------------------------------------------------------------------
// The seeded violations, and the positive control
// -----------------------------------------------------------------------------
// A CHECK THAT CANNOT FAIL IS NOT A CHECK, and this one has no natural failures
// to observe because the tree is clean by construction. So each rule ships with
// the violation it exists to catch, and `--falsify` watches it fire ON THAT
// FINDING rather than merely returning something.
//
// The last case is the positive control and it is the one that matters most:
// the UNTOUCHED tree must come back clean. A checker that rejected everything
// would pass every seeded case above and would gate nothing.
const SEEDS = [
  {
    name: 'five trading days from now, the exact defect ADR-042 predicted',
    sql: "ALTER TABLE rule_states ADD CONSTRAINT x CHECK (payout_anchor_day + interval '5 days' > trading_day);",
    rule: 'interval-against-date',
  },
  {
    name: "the same arithmetic spelled '5 days'::interval, which a word grep misses",
    sql: "ALTER TABLE rule_states ADD CONSTRAINT y CHECK (trading_day + '5 days'::interval > payout_anchor_day);",
    rule: 'interval-against-date',
  },
  {
    name: 'written left to right',
    sql: "ALTER TABLE daily_marks ADD CONSTRAINT z CHECK (interval '1 day' + trading_day IS NOT NULL);",
    rule: 'interval-against-date',
  },
  {
    name: 'a trading day derived from a clock by cast',
    sql: 'ALTER TABLE fills ALTER COLUMN trading_day SET DEFAULT (now())::date;',
    rule: 'timestamptz-cast-to-date',
  },
  {
    name: 'the same cast in CAST() spelling',
    sql: 'ALTER TABLE fills ALTER COLUMN trading_day SET DEFAULT CAST(executed_at AS date);',
    rule: 'timestamptz-cast-to-date',
  },
];

// Constructs that MUST NOT be findings. Each is legitimate SQL this schema
// either contains or would accept, and a checker that flagged them would be
// switched off within a week.
const SCOPE = [
  {
    name: 'the English word interval in a comment',
    sql: '-- a fabricated session interval is not inert\n',
  },
  {
    name: 'interval arithmetic against a timestamptz, which is the RULED unit',
    sql: "ALTER TABLE payout_requests ADD CONSTRAINT q CHECK (freeze_expires_at > created_at + interval '48 hours');",
  },
  {
    name: 'a date literal being typed, which derives nothing',
    sql: "INSERT INTO trading_calendar (trading_day) VALUES ('2026-01-01'::date);",
  },
  {
    name: 'an ordinary date comparison',
    sql: 'ALTER TABLE rule_states ADD CONSTRAINT r CHECK (cadence_anchor_day <= trading_day);',
  },
];

function falsify() {
  const base = loadMigrations();
  let failed = 0;

  // The positive control FIRST, because a checker that rejects everything
  // passes every seeded case below it.
  const clean = findings(base);
  if (clean.length === 0) {
    console.log('PASS   positive control  <- the untouched migration set is clean');
  } else {
    failed++;
    console.log('FAIL   positive control  <- the untouched migration set reported findings');
    for (const f of clean) console.log(`       ${f.file}:${f.line}  [${f.rule}] ${f.text}`);
  }

  for (const seed of SEEDS) {
    const got = findings([...base, { file: 'PROBE_seeded_violation.sql', sql: seed.sql }]);
    const hit = got.find((f) => f.file === 'PROBE_seeded_violation.sql' && f.rule === seed.rule);
    if (hit) {
      console.log(`PASS   ${seed.rule}  <- ${seed.name}`);
    } else {
      failed++;
      console.log(`FAIL   ${seed.rule}  <- ${seed.name}`);
      console.log(
        `       expected a [${seed.rule}] finding and got ${got.length - clean.length} new one(s)`,
      );
    }
  }

  for (const c of SCOPE) {
    const got = findings([...base, { file: 'PROBE_in_scope.sql', sql: c.sql }]);
    const spurious = got.filter((f) => f.file === 'PROBE_in_scope.sql');
    if (spurious.length === 0) {
      console.log(`PASS   out of scope       <- ${c.name}`);
    } else {
      failed++;
      console.log(`FAIL   out of scope       <- ${c.name} was reported as a violation`);
      for (const f of spurious) console.log(`       [${f.rule}] ${f.detail}`);
    }
  }

  console.log(
    failed
      ? `\n${failed} case(s) did not behave as required.`
      : `\nAll ${SEEDS.length} seeded violation(s) fire on their own finding, ` +
          `${SCOPE.length} in-scope construct(s) are left alone, and the clean tree passes.`,
  );
  return failed ? 1 : 0;
}

function main(argv) {
  if (argv.includes('--falsify')) return falsify();

  const found = findings(loadMigrations());
  if (found.length === 0) {
    console.log(
      'No interval arithmetic against a date column and no timestamptz cast to date across ' +
        `${MIGRATIONS}. This is VACUOUSLY TRUE and that is why it is wired: 0029 to 0031 made ` +
        "interval arithmetic idiomatic on the money path, and the next 'five trading days from " +
        "now' has a working pattern sitting right there that is wrong on 104 days a year.",
    );
    return 0;
  }
  for (const f of found) {
    console.error(`::error file=${f.file},line=${f.line}::[${f.rule}] ${f.detail}`);
    console.error(`  ${f.file}:${f.line}  ${f.text}\n`);
  }
  console.error(
    `${found.length} shape violation(s). ADR-042: the trading day is data, never arithmetic.`,
  );
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
