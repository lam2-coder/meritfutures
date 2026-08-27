#!/usr/bin/env node
// =============================================================================
// scripts/db/assert_append_only_grants.mjs
// =============================================================================
// OI-03, ADR-128. The append-only set the DOCUMENT declares and the append-only
// set the DATABASE installs are the same set, in both directions.
//
//   node scripts/db/assert_append_only_grants.mjs            assert
//   node scripts/db/assert_append_only_grants.mjs --falsify  watch it fail on a seed
//
// -----------------------------------------------------------------------------
// OI-03 IS NOT A PREDICTION. IT HAD ALREADY HAPPENED THREE TIMES WHEN THIS RAN
// -----------------------------------------------------------------------------
// The item reads: "0026's append-only revoke list is a list, and a list drifts.
// Eighteen tables are named there against DATA_MODEL section 1's Mutability set.
// The CI check must assert the revoke list AGAINST THE DOCUMENT rather than
// trusting either."
//
// On the commit before this file, DATA_MODEL section 1 carried THREE copies of
// the Mutability bullet, left by three keep-both merges, reading "twenty-three
// tables ... four migrations", "twenty-two ... three migrations" and
// "twenty-two ... three migrations", over three different lists of which
// migrations revoke. The installed set was TWENTY-FIVE. Every gate was green,
// because CI-06u looks for duplicated PASSAGES and these three had diverged,
// CI-06i reads table NAMES and not privileges, and nothing at all read the
// database's grants. A revoke that a migration forgot would have been invisible
// in exactly the same way.
//
// -----------------------------------------------------------------------------
// WHY THIS IS A .mjs AND NOT A .sql, WHICH IS THE ITEM'S OWN WORD
// -----------------------------------------------------------------------------
// assert_no_floats.sql keeps its allowlist inside the SQL file, and that is the
// right shape there: the exemption is a database fact checked against a database
// fact. OI-03 asks for something a `.sql` file structurally cannot do, "assert
// the revoke list AGAINST THE DOCUMENT", because the document is markdown. So
// the two readers live here: the block between the append-only markers in
// DATA_MODEL section 1, and `has_table_privilege` over the installed schema.
//
// -----------------------------------------------------------------------------
// WHAT "APPEND-ONLY" MEANS TO THIS FILE, STATED RATHER THAN ASSUMED
// -----------------------------------------------------------------------------
// A table is append-only exactly when `merit_app` holds NEITHER `UPDATE` NOR
// `DELETE` on it. That is one question and it covers both halves of 0026's
// promise, because `merit_app` inherits everything granted to `PUBLIC`: a
// revoke that bound only the application role while PUBLIC kept the privilege
// would leave the table OFF the derived list and the mismatch would be reported.
//
// `impersonation_sessions` is the table that proves the definition is not a
// tautology. 0042 revokes DELETE and KEEPS UPDATE, deliberately, because
// recording the explicit exit is an update to a row that already exists. It is
// not on the document's list and it is not on the database's, and if either one
// gained it the other would disagree.
//
// -----------------------------------------------------------------------------
// THE STALE DIRECTION IS THE HALF THAT EARNS THE CHECK
// -----------------------------------------------------------------------------
// A table revoked in a migration and missing from the document is the obvious
// failure. A table NAMED IN THE DOCUMENT and not revoked in the database is the
// one that decays quietly: the entry stays, the migration that was supposed to
// revoke never lands or is superseded away, and the list still looks complete
// while guarding less. That is OI-08's lesson and assert_no_floats.sql's second
// falsification, one table over.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DOC = 'docs/architecture/data-model/README.md';
const BEGIN = '<!-- append-only:begin -->';
const END = '<!-- append-only:end -->';

// The derived side. `relkind = 'r'` is an ordinary table: a view has no rows to
// append to and a partitioned parent's privileges are its children's question.
const DERIVE_SQL = `
  SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND NOT has_table_privilege('merit_app', c.oid, 'UPDATE')
     AND NOT has_table_privilege('merit_app', c.oid, 'DELETE')
   ORDER BY 1`;

/**
 * The declared side, read from the fenced block between the two markers.
 * Parsed rather than grepped, because the prose around it names most of these
 * tables too and a grep of the section would report the document as declaring
 * every table it mentions.
 */
export function declaredTables(markdown) {
  const from = markdown.indexOf(BEGIN);
  const to = markdown.indexOf(END);
  if (from === -1 || to === -1 || to < from) {
    throw new Error(
      `${DOC} has no ${BEGIN} ... ${END} block. The declared append-only set has ` +
        'moved or been deleted, and this check would otherwise report every ' +
        'installed table as undeclared',
    );
  }
  const fenced = /```\n([\s\S]*?)```/.exec(markdown.slice(from + BEGIN.length, to));
  if (!fenced) {
    throw new Error(
      `${DOC}: the append-only markers are present and contain no fenced block, ` +
        'so the declared set reads as empty',
    );
  }
  const names = fenced[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (names.length === 0) {
    throw new Error(`${DOC}: the append-only block is empty`);
  }
  for (const name of names) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) {
      throw new Error(`${DOC}: "${name}" is not a table name; the block has picked up prose`);
    }
  }
  const seen = new Set();
  for (const name of names) {
    if (seen.has(name)) throw new Error(`${DOC}: ${name} is listed twice in the append-only block`);
    seen.add(name);
  }
  const sorted = [...names].sort();
  if (sorted.join('\n') !== names.join('\n')) {
    throw new Error(
      `${DOC}: the append-only block is not in alphabetical order. Order is what ` +
        'makes an addition a one-line diff instead of a paragraph a reviewer has to read',
    );
  }
  return names;
}

function installedTables(seedSql = '') {
  // BEGIN/ROLLBACK around the whole thing so a --falsify seed cannot survive the
  // process, even if the assertion below throws. The seed and the read are ONE
  // psql session for the same reason: a GRANT in one invocation and a query in
  // the next would be two transactions and the rollback would come too late.
  const script = `\\set ON_ERROR_STOP on\nBEGIN;\n${seedSql}\n${DERIVE_SQL};\nROLLBACK;\n`;
  const out = execFileSync('psql', ['-At', '-q', '-f', '-'], {
    input: script,
    encoding: 'utf8',
  });
  const names = out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (names.length === 0) {
    throw new Error(
      'the database reports NO append-only table at all. Either the migrations ' +
        'have not been applied, or merit_app now holds UPDATE and DELETE on ' +
        'everything, and both of those make every finding below noise',
    );
  }
  return names;
}

/** ONE COMPARISON, exercised three ways, so a narrowing edit cannot pass the
 *  assertion while the falsification keeps testing the old logic. That is
 *  assert_no_floats.sql's shape and the reason for it is the same. */
export function compare(declared, installed) {
  const findings = [];
  const inDoc = new Set(declared);
  const inDb = new Set(installed);
  for (const t of declared) {
    if (!inDb.has(t)) {
      findings.push(
        `${t}: DATA_MODEL section 1 declares it append-only and merit_app still holds ` +
          `UPDATE or DELETE on it. The word "append-only" in its comment is false ` +
          `(VG-8). Either a migration owes it a REVOKE, or the document owes it a ` +
          `deletion; a list wider than the schema guards less than it names`,
      );
    }
  }
  for (const t of installed) {
    if (!inDoc.has(t)) {
      findings.push(
        `${t}: the database revokes UPDATE and DELETE from merit_app and DATA_MODEL ` +
          `section 1 does not list it. The set is exact rather than illustrative, so ` +
          `a table guarded and undeclared is the same drift as one declared and ` +
          `unguarded, read from the other end`,
      );
    }
  }
  return findings;
}

function report(findings) {
  for (const f of findings) console.error(`  ${f}`);
}

function assertTree() {
  const declared = declaredTables(readFileSync(join(ROOT, DOC), 'utf8'));
  const installed = installedTables();
  const findings = compare(declared, installed);
  if (findings.length > 0) {
    console.error(
      `APPEND-ONLY: the declared set (${declared.length}) and the installed set ` +
        `(${installed.length}) disagree on ${findings.length}:`,
    );
    report(findings);
    process.exit(1);
  }
  console.log(
    `assert_append_only_grants: the document and the database name the same ` +
      `${declared.length} append-only tables.`,
  );
}

// -----------------------------------------------------------------------------
// FALSIFICATION. One seed per direction, each watched firing ON ITS OWN FINDING
// -----------------------------------------------------------------------------
// STRATEGY section 4.4: a gate nobody has watched fail is not a gate. An
// assertion only ever run against a tree that satisfies it reports PASS in
// exactly the same way as one narrowed until it reads nothing, and this file
// would have reported PASS on the commit that carried three contradictory copies
// of the paragraph it exists to check.
//
// The DATABASE seed is a real GRANT inside a transaction that is rolled back in
// the same psql session, so the schema is unchanged either way. The DOCUMENT
// seed is applied to the parsed text rather than to the file, because writing to
// a tracked file and undoing it is how a falsification leaks.
function falsify() {
  const markdown = readFileSync(join(ROOT, DOC), 'utf8');
  const declared = declaredTables(markdown);
  const installed = installedTables();
  if (compare(declared, installed).length !== 0) {
    console.error('FALSIFY: the tree does not pass to begin with, so nothing below means anything');
    process.exit(1);
  }

  let failures = 0;
  const watch = (label, findings, needle) => {
    const hit = findings.find((f) => f.includes(needle));
    if (!hit) {
      console.error(`FALSIFY FAILED (${label}): no finding contained "${needle}"`);
      console.error(`  got: ${findings.length === 0 ? '(nothing)' : findings.join(' | ')}`);
      failures += 1;
      return;
    }
    console.log(`FALSIFIED (${label}): ${hit}`);
  };

  // 1. UNGUARDED: the document names a table the database does not revoke. A
  //    phantom name stands in for the real case, a migration that was supposed
  //    to revoke and did not, because seeding that would mean writing a
  //    migration.
  watch(
    'declared and unguarded',
    compare([...declared, 'zzz_phantom_append_only'].sort(), installed),
    'zzz_phantom_append_only',
  );

  // 2. UNDECLARED: the database revokes on a table the document does not name.
  //    Seeded on payout_requests deliberately, on assert_no_floats.sql's
  //    precedent: this is the table where an unannounced change to what may be
  //    rewritten would hurt most.
  watch(
    'guarded and undeclared',
    compare(
      declared,
      installedTables('REVOKE UPDATE, DELETE ON payout_requests FROM merit_app, PUBLIC;'),
    ),
    'payout_requests',
  );

  // 3. THE SEED DID NOT LEAK. The GRANT above lived inside a transaction this
  //    file rolled back; proving that rather than trusting it is the same
  //    discipline assert_no_floats.sql applies to its own two seeds.
  const after = installedTables();
  if (after.length !== installed.length) {
    console.error(
      `FALSIFY FAILED: the seeded REVOKE leaked. The installed set was ` +
        `${installed.length} before and is ${after.length} now`,
    );
    failures += 1;
  }

  if (failures > 0) process.exit(1);
  console.log('assert_append_only_grants: falsified in both directions, and the seed did not leak.');
}

const argv = process.argv.slice(2);
if (argv.includes('--falsify')) falsify();
else assertTree();
