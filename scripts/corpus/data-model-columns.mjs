#!/usr/bin/env node
// =============================================================================
// scripts/corpus/data-model-columns.mjs
// =============================================================================
// CI-06i RECONCILES THE TABLE SET. NOTHING RECONCILES THE COLUMNS.
//
//   node scripts/corpus/data-model-columns.mjs        run it
//   node scripts/corpus/data-model-columns.mjs list   its id, title and covers
//
// Exit code is 0 only when every design record names exactly the columns the
// migrations give its table.
//
// WHY IT EXISTS. `CI-06i` requires a `### <table>` design record for every
// `CREATE TABLE` and a `CREATE TABLE` for every design record, in both
// directions, and its own header says why it stops there: "It is deliberately a
// NAME-SET check rather than a column check. Column-level drift is caught by the
// generated diff against a live catalogue, which needs a database." So a record
// can omit a column its table carries and READ AS COMPLETE WHILE BEING
// INCOMPLETE, indefinitely, with every gate green. `OI-15` is one instance of
// that: `0043` added `admin_actions.initiative` and
// `admin_actions.on_behalf_of_identity_id` and the design record carried
// neither for four sessions.
//
// THE PREMISE OF CI-06i'S LIMIT IS FALSE, and that is the whole finding. A live
// catalogue is needed to check a column's TYPE, its DEFAULT and its collation.
// It is not needed to check that a column EXISTS: the migrations declare the
// column set in the tree, forward-only from empty, and no migration in this set
// drops or renames a column. The direction that costs a module a rebuild is the
// name, and the name is checkable on every push with nothing but the tree.
//
// BOTH DIRECTIONS, on CI-06i's own reasoning one level down. A column the
// schema carries and the record omits is a module built blind, because the next
// module is built by reading the design record rather than the DDL. A column the
// record names and the schema does not create is a module built against a
// fiction, and it is the direction that is easy to get wrong: `ADR-029` refused
// `kyc_verifications.dedupe_matched_identity_id`, and the record keeps a row for
// it deliberately, struck through, saying it was never created. That row is a
// TOMBSTONE and not a claim. See `recordColumns` for how it is read.
//
// -----------------------------------------------------------------------------
// TWO THINGS THIS FILE DOES NOT DO, WRITTEN DOWN RATHER THAN LEFT TO A READER
// -----------------------------------------------------------------------------
// 1. IT IS NOT REGISTERED IN gates.mjs, AND THAT IS A DEFERRAL RATHER THAN A
//    DESIGN. Three design records fail it today and all three are outside the
//    fence of the session that wrote this file, so registering it would put a
//    RED gate in `pnpm run verify` and the only remedy available here would be
//    to weaken it. Working agreements section 9: never weaken a gate to pass it.
//    The three are named in ADR-134 and in this session's log. Registration is
//    the two lines the ADR quotes, and it belongs to the session that repairs
//    the last of them; the check is landed now so that the repair has something
//    to be checked by.
//
// 2. IT PARSES THE MIGRATIONS A SECOND TIME. `gates.mjs` already holds a
//    `columnCatalogue()` that answers exactly this question, and OQ-P1-04's
//    ruling is one parser called twice rather than two expressions of one parse.
//    IT CAN NOW BE IMPORTED, AND THE BLOCKER THIS PARAGRAPH NAMED IS SPENT.
//    `gates.mjs:9118` reads `export const GATES = [`, and `:9324` opens the
//    guard `const invokedDirectly = ...` closed at `:9327` by
//    `if (invokedDirectly) process.exit(main());`, under a comment reading
//    "Importable by the suite that reads this report, runnable by CI-06". That
//    guard landed in `55824c62` on 2026-08-30 for ADR-294, three sessions after
//    this header was written, and the same file also exports `EXIT` at `:9202`
//    and `runGates` at `:9227`. So the duplication below is now a DEFERRAL WITH
//    NO BLOCKER rather than a blocked repair, and its remedy clause at the foot
//    of this paragraph is available and unclaimed.
//
//    **THIS PARAGRAPH READ "IT CANNOT BE IMPORTED: `gates.mjs` ends in
//    `process.exit(main())` at module scope with no direct-invocation guard, so
//    importing it runs every gate and exits the process. Adding that guard is a
//    behavioural edit to a file two other sessions are live in, which is a merge
//    hazard this file is not worth."** It was TRUE when it was written and
//    `55824c62` falsified it while nothing went red, which is the defect
//    ADR-324, ADR-326, ADR-327 and ADR-328 are each an occurrence of. ADR-329
//    finding 6 found it here; ADR-330 widened `RI-35`'s leg-6 sweep to read
//    `scripts/` and the check reported this line by discovery. The retired
//    sentence is kept beside its correction under `RI-14` rather than deleted,
//    and it is bound to that guard by `RI-35`, so the day somebody removes the
//    guard this quote goes red instead of quietly becoming true again.
//
//    THE REPAIR IS THE DERIVATION AND NOT THE WORDING, AND THE PARSERS ARE NOT
//    TOUCHED. This paragraph's duplication argument rested on the false clause
//    only for its BLOCKER, not for its ruling: `OQ-P1-04` still says one parser
//    called twice, and `RI-36` has since added a third reader of this same
//    migration set (ADR-329 section 3.1). Deciding what to do about that is a
//    row with its own fence, named as owed in ADR-330 and deliberately not
//    started here, because collapsing three readers into one is a change to what
//    `CI-06i`, this file and `RI-36` each assert and not a comment repair.
//
//    THE DUPLICATION FAILS IN THE SAFE DIRECTION: a catalogue that parses
//    NARROWER than gates.mjs's reports a column the record has as absent from
//    the schema, which is a loud false finding somebody investigates, never a
//    silent pass. The remedy at registration time is to export the one in
//    gates.mjs and delete the copy below, and that is ADR-134 clause 4.
// =============================================================================

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const MIGRATIONS = 'packages/db/migrations';
const RECORDS = 'docs/architecture/data-model';

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// Line comments and block comments go before anything is matched. `0043`'s
// header prose names `initiative` and `on_behalf_of_identity_id` a dozen times
// in comments, and a parser reading them would find the columns whether or not
// the DDL declared them.
const stripSqlComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

const sqlFiles = () =>
  readdirSync(join(ROOT, MIGRATIONS))
    .filter((f) => extname(f) === '.sql')
    .sort()
    .map((f) => `${MIGRATIONS}/${f}`);

// -----------------------------------------------------------------------------
// The schema half: table -> Set<column>, from the migrations and nothing else
// -----------------------------------------------------------------------------
// gates.mjs's `columnCatalogue()`, for the reason in the header. Kept
// line-for-line comparable to it on purpose, including the `NOT_A_COLUMN` set
// and the two-statement shape, so a reader can diff the two rather than read
// both.
//
// NO DROP COLUMN AND NO RENAME COLUMN HANDLING, and that is asserted rather than
// assumed: `run()` refuses to report on a tree that has grown either, because a
// catalogue that accumulates columns is correct only while nothing removes one.
const NOT_A_COLUMN = new Set([
  'constraint',
  'primary',
  'unique',
  'check',
  'foreign',
  'exclude',
  'like',
  'partition',
]);

function columnCatalogue() {
  const cols = new Map();
  const add = (t, c) => {
    if (!cols.has(t)) cols.set(t, new Set());
    cols.get(t).add(c);
  };
  for (const file of sqlFiles()) {
    const sql = stripSqlComments(read(file));
    for (const m of sql.matchAll(
      /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s*\(/gi,
    )) {
      const table = m[1].toLowerCase();
      if (!cols.has(table)) cols.set(table, new Set());
      // Balanced scan from the opening paren, then split the top level on commas.
      let depth = 0;
      let i = m.index + m[0].length - 1;
      const start = i + 1;
      for (; i < sql.length; i++) {
        if (sql[i] === '(') depth++;
        else if (sql[i] === ')') {
          depth--;
          if (depth === 0) break;
        }
      }
      let d = 0;
      let item = '';
      const items = [];
      for (const ch of sql.slice(start, i)) {
        if (ch === '(') d++;
        if (ch === ')') d--;
        if (ch === ',' && d === 0) {
          items.push(item);
          item = '';
        } else item += ch;
      }
      items.push(item);
      for (const raw of items) {
        const first = raw.trim().split(/\s/)[0];
        if (!first) continue;
        if (NOT_A_COLUMN.has(first.toLowerCase())) continue;
        if (!/^[a-z_][a-z0-9_]*$/i.test(first)) continue;
        add(table, first.toLowerCase());
      }
    }
    // EVERY `ADD COLUMN` IN THE STATEMENT AND NOT ONLY THE FIRST. gates.mjs
    // carried the narrower expression until 2026-08-16 and four of `0031`'s five
    // hold columns were invisible to it, `hold_expires_at` among them.
    for (const m of sql.matchAll(/\bALTER\s+TABLE\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)/gi)) {
      const table = m[1].toLowerCase();
      let depth = 0;
      let i = m.index + m[0].length;
      for (; i < sql.length; i++) {
        if (sql[i] === '(') depth++;
        else if (sql[i] === ')') depth--;
        else if (sql[i] === ';' && depth === 0) break;
      }
      for (const c of sql
        .slice(m.index + m[0].length, i)
        .matchAll(/\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)) {
        add(table, c[1].toLowerCase());
      }
    }
  }
  return cols;
}

/** Statements this catalogue cannot model, as `file: statement` strings. */
function unmodelledStatements() {
  const out = [];
  for (const file of sqlFiles()) {
    const sql = stripSqlComments(read(file));
    for (const m of sql.matchAll(/\b(DROP|RENAME)\s+COLUMN\b/gi)) out.push(`${file}: ${m[0]}`);
    for (const m of sql.matchAll(/\bALTER\s+TABLE\s+[a-z_][a-z0-9_]*\s+RENAME\s+TO\b/gi))
      out.push(`${file}: ${m[0]}`);
  }
  return out;
}

// -----------------------------------------------------------------------------
// The record half: the names a `| Column | ... |` table claims
// -----------------------------------------------------------------------------
// AN ENTRY IS THE FIRST CELL OF A ROW UNDER A HEADER WHOSE FIRST CELL IS
// `Column`, which is `allocatedClaims`' rule with a different alphabet: a
// column named in a Why cell, in a constraint expression or in the prose below
// the table is a MENTION and never a claim, so a record may discuss a sibling
// table's columns freely.
//
// A STRUCK-THROUGH FIRST CELL IS A TOMBSTONE AND NOT A CLAIM, and this is the
// one rule here that is a decision rather than a parse. `kyc_verifications`
// keeps `~~dedupe_matched_identity_id~~` with "never created, by ADR-029" in its
// constraints cell. That row is the record doing its job: it answers the reader
// who arrives with the approved design in hand and looks for the column. Reading
// it as a claim would report the corpus's clearest example of a design record
// EARNING its keep as the corpus's worst example of one drifting.
//
// A TOMBSTONE THE SCHEMA CONTRADICTS IS STILL A FINDING, in `run()`: a record
// saying a column was never created, about a column a migration creates, is the
// fiction direction wearing a strikethrough.
function recordColumns(body, table) {
  const claimed = new Set();
  const tombstoned = new Set();
  let inTable = false;
  for (const line of body.split('\n')) {
    if (!line.startsWith('|')) {
      inTable = false;
      continue;
    }
    const first = (line.split('|')[1] ?? '').trim();
    if (/^:?-+:?$/.test(first.replace(/\s/g, ''))) continue; // the delimiter row
    if (/^\*{0,2}Column\*{0,2}$/i.test(first)) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    const tomb = first.includes('~~');
    // `\`name\`` and `\`table.name\`` both, the second because a record is free
    // to qualify its own columns and a parser that refused the qualified spelling
    // would report the column as absent from the record.
    for (const m of first.matchAll(/`(?:([a-z_][a-z0-9_]*)\.)?([a-z_][a-z0-9_]*)`/g)) {
      if (m[1] !== undefined && m[1] !== table) continue;
      (tomb ? tombstoned : claimed).add(m[2]);
    }
  }
  return { claimed, tombstoned };
}

// The `### <table>` heading is what defines a record, read from the file rather
// than trusted from the filename. CI-06i's predicate, verbatim, and it owns the
// findings about a heading that disagrees with its filename; this gate reports
// only that it could not read one.
const HEADING = /^### ([a-z][a-z0-9_]*)\s*$/m;

export const dataModelColumns = {
  id: 'CI-06/data-model-columns',
  title: 'Every design record names exactly the columns its table carries, both directions',
  covers:
    "CI-06i'S SECOND HALF. CI-06i reconciles the TABLE set in both directions and stops " +
    'at the name; this reconciles the COLUMN set of every `### <table>` design record ' +
    'against the columns the migrations declare for it, also in both directions. A column ' +
    'the schema carries and the record omits is a module built blind. A column the record ' +
    'names and no migration creates is a module built against a fiction. ' +
    'A STRUCK-THROUGH ROW IS A TOMBSTONE and is excluded from what a record CLAIMS, so ' +
    "ADR-029's `dedupe_matched_identity_id` row is not a finding; a tombstone the schema " +
    'CONTRADICTS is a finding, because a record cannot say a column was never created ' +
    'about a column that exists. ' +
    'THREE THINGS IT DOES NOT DO. It reads NAMES and never types, nullability, defaults or ' +
    'collation, which is the half CI-06i is right that a live catalogue is needed for; the ' +
    'record may say `text` about a `uuid` and this gate is silent. It reads the FIRST CELL ' +
    'of a `| Column |` table only, so a column documented in prose alone is invisible to ' +
    'it exactly as it is to a reader skimming the table. And it models no `DROP COLUMN`, ' +
    'no `RENAME COLUMN` and no `ALTER TABLE ... RENAME TO`: rather than guess, it ERRORS ' +
    'the day a migration adds one, because a catalogue that only accumulates is correct ' +
    'only while nothing removes.',
  run() {
    const findings = [];

    if (!existsSync(join(ROOT, MIGRATIONS))) {
      throw new Error(`${MIGRATIONS} does not exist; the gate cannot run`);
    }
    if (!existsSync(join(ROOT, RECORDS))) {
      throw new Error(`${RECORDS} does not exist; the design records have moved or are gone`);
    }

    // Rule 2, on the input this gate would go vacuous without. A migration set
    // that parses to no columns makes every record's every row a fiction
    // finding, which is loud; the direction this guard is for is a parser that
    // has stopped matching entirely, where the loop below simply never runs.
    const catalogue = columnCatalogue();
    if (catalogue.size === 0) {
      throw new Error(`no CREATE TABLE found under ${MIGRATIONS}; the gate cannot run`);
    }

    // Rule 1 rather than rule 2, deliberately. This is not an input the gate
    // cannot reach; it is a schema the gate's model of a migration set does not
    // cover, and reporting on it would be claiming to have checked something
    // that was not checked.
    const unmodelled = unmodelledStatements();
    if (unmodelled.length > 0) {
      throw new Error(
        'the migrations now carry a statement this catalogue does not model, so its column ' +
          'sets are no longer the schema: ' +
          unmodelled.join('; ') +
          '. Teach columnCatalogue() the statement before trusting this gate again',
      );
    }

    const files = readdirSync(join(ROOT, RECORDS))
      .filter((f) => /^[a-z][a-z0-9_]*\.md$/.test(f))
      .sort();
    if (files.length === 0) throw new Error(`no design records in ${RECORDS}; the gate cannot run`);

    let reconciled = 0;
    let tombstones = 0;
    for (const f of files) {
      const body = read(`${RECORDS}/${f}`);
      const m = HEADING.exec(body);
      // CI-06i owns "this file is not a readable design record" and would report
      // it; reporting it here too would make one defect two findings in two
      // gates, which is the collision CI-06e and CI-06d divide a population to
      // avoid.
      if (!m) continue;
      const table = m[1];
      const inSql = catalogue.get(table);
      // Likewise CI-06i's: a record with no CREATE TABLE is its finding.
      if (!inSql) continue;

      const { claimed, tombstoned } = recordColumns(body, table);
      tombstones += tombstoned.size;
      if (claimed.size === 0) {
        findings.push(
          `${RECORDS}/${f}: no \`| Column |\` table, so the record names none of the ` +
            `${inSql.size} column(s) \`${table}\` carries`,
        );
        continue;
      }
      reconciled++;

      for (const col of [...inSql].sort()) {
        if (claimed.has(col)) continue;
        if (tombstoned.has(col)) {
          findings.push(
            `${RECORDS}/${f}: \`${table}.${col}\` is struck through here, and a migration ` +
              'creates it. A tombstone the schema contradicts is a fiction with a line through it',
          );
          continue;
        }
        findings.push(
          `${RECORDS}/${f}: \`${table}.${col}\` is in the migrations and not in the record`,
        );
      }
      for (const col of [...claimed].sort()) {
        if (inSql.has(col)) continue;
        findings.push(
          `${RECORDS}/${f}: \`${table}.${col}\` is in the record and no migration creates it`,
        );
      }
    }

    // Rule 2 again, on the half a missing-input guard cannot see. Every record
    // could parse to a heading and none to a column table, and the loop above
    // would then report nothing at all while asserting nothing at all.
    if (reconciled === 0) {
      throw new Error(
        `no design record under ${RECORDS} parsed to a \`| Column |\` table; the gate cannot run`,
      );
    }
    console.log(
      `       ${dataModelColumns.id} note: ${reconciled} record(s) reconciled against ` +
        `${catalogue.size} table(s) in ${sqlFiles().length} migration(s); ` +
        `${tombstones} tombstoned column(s) read as records rather than as claims`,
    );
    return findings;
  },
};

function main() {
  const [cmd] = process.argv.slice(2);
  if (cmd === 'list') {
    console.log(
      `${dataModelColumns.id}  ${dataModelColumns.title}\n      covers: ${dataModelColumns.covers}\n`,
    );
    return 0;
  }
  if (cmd !== undefined && cmd !== 'check') {
    console.error('usage: node scripts/corpus/data-model-columns.mjs [check] | list');
    return 2;
  }

  let findings;
  try {
    findings = dataModelColumns.run();
  } catch (err) {
    console.log(`ERROR  ${dataModelColumns.id}  ${dataModelColumns.title}`);
    console.log(`       ${err.message}`);
    return 1;
  }
  if (findings.length === 0) {
    console.log(`PASS   ${dataModelColumns.id}  ${dataModelColumns.title}`);
    return 0;
  }
  console.log(`FAIL   ${dataModelColumns.id}  ${dataModelColumns.title}  (${findings.length})`);
  for (const f of findings) console.log(`       ${f}`);
  console.log(
    '\nA design record that omits a column its table carries reads as complete and is not.',
  );
  return 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(main());
