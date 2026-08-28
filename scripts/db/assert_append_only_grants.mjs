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
// A table is append-only exactly when `merit_app` holds `INSERT` and holds
// NEITHER `UPDATE` NOR `DELETE` on it. The application can add a row and can
// never change or remove one. `merit_app` inherits everything granted to
// `PUBLIC`, so testing that one role tests both: a revoke that bound only the
// application role while PUBLIC kept the privilege would leave the table OFF the
// derived list and the mismatch would be reported.
//
// THE `INSERT` CONJUNCT WAS ADDED AFTER THE DEFINITION WITHOUT IT REPORTED A
// FALSE FINDING ON `main`, AND IT IS THE HALF THIS FILE GOT WRONG.
//
// The original definition asked only "does merit_app lack UPDATE and DELETE",
// and every table in the schema satisfied the unstated premise that merit_app
// could reach it at all. 0050 created the first table it cannot: `REVOKE ALL ON
// live_account_state FROM merit_app, PUBLIC` (0050:233), for FM-M12-08, which is
// a CONFIDENTIALITY sentence and not a mutability one -- the stats worker runs as
// merit_app and must hold no read path to the live cache. Under the old question
// that table answered YES and was reported as append-only and undeclared.
//
// IT IS NOT APPEND-ONLY, AND THE CLAIM IS FALSE IN BOTH DIRECTIONS. 0050:254
// grants `SELECT, INSERT, UPDATE` on it to `merit_live`, so the row IS updated,
// by the upsert the table exists for. A table nobody may update and a table the
// application may not see are different properties, and folding the second into
// the first would have put a sentence in DATA_MODEL that the migration beside it
// contradicts.
//
// SO THE SECOND SET IS DECLARED RATHER THAN THE FIRST ONE WIDENED, and the
// partition below is what keeps this from being a narrowing that guards less.
// `live_account_state` is still declared, still asserted in both directions, and
// still fails this check the moment it drifts; it is declared as what it is.
//
// `impersonation_sessions` is the table that proves the definition is not a
// tautology. 0042 revokes DELETE and KEEPS UPDATE, deliberately, because
// recording the explicit exit is an update to a row that already exists. It is
// not on either document list and not on either derived one, and if any of the
// four gained it the others would disagree.
//
// -----------------------------------------------------------------------------
// THE PARTITION IS WHY ADDING A CONJUNCT DOES NOT WEAKEN THE GATE
// -----------------------------------------------------------------------------
// Adding `AND has INSERT` makes a derived set SMALLER, and a smaller derived set
// is exactly how a check is narrowed until it reads nothing. That move is
// refused here by asserting the partition instead of trusting it.
//
// EVERY table holding neither UPDATE nor DELETE must land in exactly one of the
// two declared sets. A table that holds INSERT is append-only; a table that
// holds no verb at all is unreachable; and a table that is neither -- one that
// lost INSERT but kept SELECT, or kept INSERT but lost SELECT -- belongs to no
// declared set and FAILS, by its own finding, rather than falling silently out
// of the check. So the union this file guards is the same union it guarded
// before the conjunct existed, and the conjunct only decides WHICH list a table
// owes an entry to.
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
const UNREACHABLE_BEGIN = '<!-- unreachable:begin -->';
const UNREACHABLE_END = '<!-- unreachable:end -->';

// The derived side. `relkind = 'r'` is an ordinary table: a view has no rows to
// append to and a partitioned parent's privileges are its children's question.
//
// THE THREE QUERIES SHARE ONE `WHERE` PREFIX ON PURPOSE. `IMMUTABLE_PREFIX` is
// the population every one of them reads -- the tables `merit_app` cannot change
// or remove -- and the three differ only in how they split it. Writing the
// prefix once is what makes the partition assertion below a fact about one
// population rather than a comparison of three independently drifting ones.
const IMMUTABLE_PREFIX = `
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND NOT has_table_privilege('merit_app', c.oid, 'UPDATE')
     AND NOT has_table_privilege('merit_app', c.oid, 'DELETE')`;

/** Append-only: the application may add a row and may never change or remove one. */
const DERIVE_SQL = `
  SELECT c.relname ${IMMUTABLE_PREFIX}
     AND has_table_privilege('merit_app', c.oid, 'INSERT')
   ORDER BY 1`;

/** Unreachable: the application holds no verb at all. Not the same property, and
 *  not a stronger version of it -- another role may update the table freely. */
const DERIVE_UNREACHABLE_SQL = `
  SELECT c.relname ${IMMUTABLE_PREFIX}
     AND NOT has_table_privilege('merit_app', c.oid, 'INSERT')
     AND NOT has_table_privilege('merit_app', c.oid, 'SELECT')
   ORDER BY 1`;

/** The remainder. MUST BE EMPTY: a table here holds neither UPDATE nor DELETE
 *  and matches neither declared set, so no list in the document describes it.
 *
 *  It reduces to ONE shape, written out rather than left as the negation of the
 *  other two: no INSERT, but SELECT. The application can read the table and can
 *  do nothing else to it. That is neither append-only nor out of reach, and it
 *  is a real thing a migration could produce -- a REVOKE of INSERT that meant to
 *  take SELECT with it, which is 0050's mistake made one verb short. */
const DERIVE_UNCLASSIFIED_SQL = `
  SELECT c.relname ${IMMUTABLE_PREFIX}
     AND NOT has_table_privilege('merit_app', c.oid, 'INSERT')
     AND has_table_privilege('merit_app', c.oid, 'SELECT')
   ORDER BY 1`;

/**
 * The declared side, read from the fenced block between the two markers.
 * Parsed rather than grepped, because the prose around it names most of these
 * tables too and a grep of the section would report the document as declaring
 * every table it mentions.
 */
export function declaredTables(markdown, begin = BEGIN, end = END) {
  const from = markdown.indexOf(begin);
  const to = markdown.indexOf(end);
  if (from === -1 || to === -1 || to < from) {
    throw new Error(
      `${DOC} has no ${begin} ... ${end} block. The declared set has ` +
        'moved or been deleted, and this check would otherwise report every ' +
        'installed table as undeclared',
    );
  }
  const fenced = /```\n([\s\S]*?)```/.exec(markdown.slice(from + begin.length, to));
  if (!fenced) {
    throw new Error(
      `${DOC}: the ${begin} markers are present and contain no fenced block, ` +
        'so the declared set reads as empty',
    );
  }
  const names = fenced[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (names.length === 0) {
    throw new Error(`${DOC}: the ${begin} block is empty`);
  }
  for (const name of names) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) {
      throw new Error(`${DOC}: "${name}" is not a table name; the block has picked up prose`);
    }
  }
  const seen = new Set();
  for (const name of names) {
    if (seen.has(name)) throw new Error(`${DOC}: ${name} is listed twice in the ${begin} block`);
    seen.add(name);
  }
  const sorted = [...names].sort();
  if (sorted.join('\n') !== names.join('\n')) {
    throw new Error(
      `${DOC}: the ${begin} block is not in alphabetical order. Order is what ` +
        'makes an addition a one-line diff instead of a paragraph a reviewer has to read',
    );
  }
  return names;
}

function installedTables(seedSql = '', deriveSql = DERIVE_SQL, allowEmpty = false) {
  // BEGIN/ROLLBACK around the whole thing so a --falsify seed cannot survive the
  // process, even if the assertion below throws. The seed and the read are ONE
  // psql session for the same reason: a GRANT in one invocation and a query in
  // the next would be two transactions and the rollback would come too late.
  const script = `\\set ON_ERROR_STOP on\nBEGIN;\n${seedSql}\n${deriveSql};\nROLLBACK;\n`;
  const out = execFileSync('psql', ['-At', '-q', '-f', '-'], {
    input: script,
    encoding: 'utf8',
  });
  const names = out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (names.length === 0 && !allowEmpty) {
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
          `UPDATE or DELETE on it, or no longer holds INSERT. The word "append-only" ` +
          `in its comment is false (VG-8). Either a migration owes it a REVOKE, or the ` +
          `document owes it a deletion; a list wider than the schema guards less than ` +
          `it names`,
      );
    }
  }
  for (const t of installed) {
    if (!inDoc.has(t)) {
      findings.push(
        `${t}: the database leaves merit_app INSERT and revokes UPDATE and DELETE, and ` +
          `DATA_MODEL section 1 does not list it. The set is exact rather than ` +
          `illustrative, so a table guarded and undeclared is the same drift as one ` +
          `declared and unguarded, read from the other end`,
      );
    }
  }
  return findings;
}

/** The second set, compared in both directions by the same shape. Its findings
 *  read differently because the property is different: an entry here says the
 *  application role holds NO verb on the table, which is a statement about who
 *  owns it and not about whether its rows change. */
export function compareUnreachable(declared, installed) {
  const findings = [];
  const inDoc = new Set(declared);
  const inDb = new Set(installed);
  for (const t of declared) {
    if (!inDb.has(t)) {
      findings.push(
        `${t}: DATA_MODEL section 1 declares it unreachable by merit_app and the ` +
          `database still grants merit_app a verb on it. A REVOKE ALL was dropped, ` +
          `superseded, or never landed, and the confidentiality sentence the entry ` +
          `cites is now false`,
      );
    }
  }
  for (const t of installed) {
    if (!inDoc.has(t)) {
      findings.push(
        `${t}: merit_app holds NO privilege on it and DATA_MODEL section 1 does not ` +
          `list it as unreachable. A table leaving the application role's reach is a ` +
          `larger event than an append-only revoke and is never silent: name it, and ` +
          `cite the sentence the REVOKE implements`,
      );
    }
  }
  return findings;
}

function report(findings) {
  for (const f of findings) console.error(`  ${f}`);
}

/** The partition, asserted rather than trusted. See the header: this is what
 *  keeps the `INSERT` conjunct from being a narrowing. */
export function unclassified(names) {
  return names.map(
    (t) =>
      `${t}: merit_app holds neither UPDATE nor DELETE on it, so its rows are ` +
      `immutable to the application, but it holds SELECT and not INSERT -- so it ` +
      `is neither append-only nor unreachable and NEITHER declared set describes ` +
      `it. A REVOKE took INSERT and left SELECT. Decide which sentence the table ` +
      `implements and declare it there; a table in no list is a table this check ` +
      `does not read`,
  );
}

function assertTree() {
  const markdown = readFileSync(join(ROOT, DOC), 'utf8');
  const declared = declaredTables(markdown);
  const declaredUnreachable = declaredTables(markdown, UNREACHABLE_BEGIN, UNREACHABLE_END);
  const installed = installedTables();
  const installedUnreachable = installedTables('', DERIVE_UNREACHABLE_SQL, true);

  // THE PARTITION FIRST. A finding here means the two comparisons below are
  // reading a population smaller than the one the file claims to guard, so it is
  // reported before either of them rather than alongside them.
  const findings = [
    ...unclassified(installedTables('', DERIVE_UNCLASSIFIED_SQL, true)),
    ...compare(declared, installed),
    ...compareUnreachable(declaredUnreachable, installedUnreachable),
  ];
  if (findings.length > 0) {
    console.error(
      `APPEND-ONLY: the declared sets (${declared.length} append-only, ` +
        `${declaredUnreachable.length} unreachable) and the installed sets ` +
        `(${installed.length}, ${installedUnreachable.length}) disagree on ` +
        `${findings.length}:`,
    );
    report(findings);
    process.exit(1);
  }
  console.log(
    `assert_append_only_grants: the document and the database name the same ` +
      `${declared.length} append-only tables and the same ` +
      `${declaredUnreachable.length} unreachable by merit_app, and every table ` +
      `immutable to merit_app is in exactly one of those two sets.`,
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
  const declaredUnreachable = declaredTables(markdown, UNREACHABLE_BEGIN, UNREACHABLE_END);
  const installed = installedTables();
  const installedUnreachable = installedTables('', DERIVE_UNREACHABLE_SQL, true);
  if (
    compare(declared, installed).length !== 0 ||
    compareUnreachable(declaredUnreachable, installedUnreachable).length !== 0 ||
    unclassified(installedTables('', DERIVE_UNCLASSIFIED_SQL, true)).length !== 0
  ) {
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

  // 3. UNREACHABLE, DECLARED AND REACHABLE. The document names a table the
  //    database still lets merit_app touch. Phantom, for seed 1's reason.
  watch(
    'unreachable and reachable',
    compareUnreachable(
      [...declaredUnreachable, 'zzz_phantom_unreachable'].sort(),
      installedUnreachable,
    ),
    'zzz_phantom_unreachable',
  );

  // 4. UNREACHABLE AND UNDECLARED. Seeded on `fills`, because that is the table
  //    INV-M2-14 names first and a silent REVOKE ALL there would take the
  //    engine's read path with it.
  watch(
    'unreachable and undeclared',
    compareUnreachable(
      declaredUnreachable,
      installedTables('REVOKE ALL ON fills FROM merit_app, PUBLIC;', DERIVE_UNREACHABLE_SQL, true),
    ),
    'fills',
  );

  // 5. THE PARTITION HOLDS ONLY BECAUSE IT IS CHECKED. Seeded as the one shape
  //    the remainder can take: INSERT taken, SELECT left. `wallet_entries` is
  //    append-only today, so the seed moves a table OUT of a declared set
  //    without moving it into the other one -- which is precisely the silent
  //    drop that adding the INSERT conjunct would otherwise have made possible.
  watch(
    'classified by neither set',
    unclassified(
      installedTables(
        'REVOKE INSERT ON wallet_entries FROM merit_app, PUBLIC;',
        DERIVE_UNCLASSIFIED_SQL,
        true,
      ),
    ),
    'wallet_entries',
  );

  // 6. THE SEED DID NOT LEAK. The GRANT above lived inside a transaction this
  //    file rolled back; proving that rather than trusting it is the same
  //    discipline assert_no_floats.sql applies to its own two seeds.
  const after = installedTables();
  const afterUnreachable = installedTables('', DERIVE_UNREACHABLE_SQL, true);
  if (
    after.length !== installed.length ||
    afterUnreachable.length !== installedUnreachable.length
  ) {
    console.error(
      `FALSIFY FAILED: a seeded REVOKE leaked. The installed sets were ` +
        `${installed.length} and ${installedUnreachable.length} before, and are ` +
        `${after.length} and ${afterUnreachable.length} now`,
    );
    failures += 1;
  }

  if (failures > 0) process.exit(1);
  console.log(
    'assert_append_only_grants: falsified in both directions on both sets and on ' +
      'the partition between them, and no seed leaked.',
  );
}

const argv = process.argv.slice(2);
if (argv.includes('--falsify')) falsify();
else assertTree();
