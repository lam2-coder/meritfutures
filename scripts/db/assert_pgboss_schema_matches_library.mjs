#!/usr/bin/env node
// =============================================================================
// scripts/db/assert_pgboss_schema_matches_library.mjs
// =============================================================================
// ADR-318, `0079`. THE MIGRATION BODY IS A TRANSCRIPT, AND A TRANSCRIPT NEEDS A
// READER. `0079_pgboss_job_store.sql` does not declare pg-boss's job store, it
// QUOTES it: the body between its two markers is the exact string
// `getConstructionPlans(QUEUE_SCHEMA)` returned from the installed pg-boss.
//
//   node scripts/db/assert_pgboss_schema_matches_library.mjs            assert
//   node scripts/db/assert_pgboss_schema_matches_library.mjs --emit     regenerate
//   node scripts/db/assert_pgboss_schema_matches_library.mjs --falsify  watch it fail
//
// -----------------------------------------------------------------------------
// WHAT GOES WRONG WITHOUT IT, AND IT IS NOT HYPOTHETICAL
// -----------------------------------------------------------------------------
// `packages/queue/src/pg-boss-queue.ts` sets `migrate: false`, so at `start()`
// pg-boss branches on that flag and runs `Contractor.check()` rather than
// `Contractor.start()`. `check()` throws `pg-boss is not installed` when the
// version table is absent and `pg-boss database requires migrations` unless the
// row in `<schema>.version` equals the schema version baked into the library's
// own manifest, its `pgboss.schema` key. Both were read out of the installed
// package rather than out of its documentation. `0079` writes that row, so THE
// MIGRATION IS ONLY CORRECT AGAINST ONE LIBRARY VERSION and a catalog bump is
// a schema change whether or not anybody notices. Merged migrations are sacred
// (constitution E2), so the remedy is always a NEW migration and never an edit,
// and this check is what makes somebody write it.
//
// THE SECOND DRIFT IS THE SPELLING. `QUEUE_SCHEMA` is declared in exactly one
// place so that the migration installing the schema and the runtime reading it
// cannot disagree, and that property is a claim until something compares them.
// Postgres folds a bare identifier to lower case and pg-boss stores a quoted one
// verbatim, so the two spellings differ by two characters, are indistinguishable
// in logs, and produce a SECOND EMPTY SCHEMA rather than an error.
//
// -----------------------------------------------------------------------------
// WHAT IT CANNOT SEE
// -----------------------------------------------------------------------------
// It compares TEXT and never runs SQL, so it says nothing about whether the body
// applies. That is `CI-06h`'s job, and `scripts/db/probe_pgboss_job_store.sql`
// is what asserts the installed objects behave. It also cannot see a pg-boss
// upgrade that changes nothing in the construction plans: that is a pass here
// and correctly so, because the installed schema and the library still agree.
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const QUEUE_SOURCE = 'packages/queue/src/pg-boss-queue.ts';
const QUEUE_MANIFEST = 'packages/queue/package.json';
const MIGRATIONS = 'packages/db/migrations';

// The two markers `0079` writes around the quoted body. They are asserted to
// appear exactly once each: a file carrying two of either has been edited into a
// shape this reader would compare the wrong half of.
const OPEN = '-- >>> BEGIN VERBATIM pg-boss getConstructionPlans OUTPUT >>>';
const CLOSE = '-- <<< END VERBATIM pg-boss getConstructionPlans OUTPUT <<<';

/** The one declaration site. Reading it is the point; a second one is a finding. */
function queueSchema() {
  const src = readFileSync(join(ROOT, QUEUE_SOURCE), 'utf8');
  const found = [...src.matchAll(/^export const QUEUE_SCHEMA = '([^']*)';$/gm)];
  if (found.length !== 1) {
    throw new Error(
      `${QUEUE_SOURCE}: expected exactly one \`export const QUEUE_SCHEMA\` declaration, ` +
        `found ${found.length}. The migration and the runtime no longer have one spelling.`,
    );
  }
  return found[0][1];
}

/**
 * pg-boss as `@merit/queue` itself resolves it, rather than as this script's own
 * directory would. The manifest that declares the dependency is the resolver.
 */
function library() {
  const require = createRequire(pathToFileURL(join(ROOT, QUEUE_MANIFEST)));
  const entry = require.resolve('pg-boss');
  const marker = `${'/pg-boss/'}`;
  const at = entry.lastIndexOf(marker);
  if (at === -1) throw new Error(`pg-boss resolved to an unexpected path: ${entry}`);
  const manifest = JSON.parse(
    readFileSync(join(entry.slice(0, at + marker.length), 'package.json'), 'utf8'),
  );
  return { entry, version: manifest.version, schemaVersion: manifest.pgboss?.schema };
}

/** The migration file, found by number rather than by a name this script repeats. */
function migrationPath() {
  const files = readdirSync(join(ROOT, MIGRATIONS)).filter((f) => /^0079_.*\.sql$/.test(f));
  if (files.length !== 1) {
    throw new Error(`${MIGRATIONS}: expected exactly one 0079_*.sql, found ${files.length}`);
  }
  return join(MIGRATIONS, files[0]);
}

function quoted(body, file) {
  const opens = body.split(OPEN).length - 1;
  const closes = body.split(CLOSE).length - 1;
  if (opens !== 1 || closes !== 1) {
    throw new Error(
      `${file}: expected exactly one open marker and one close marker, found ${opens} and ${closes}`,
    );
  }
  const from = body.indexOf(OPEN) + OPEN.length;
  const to = body.indexOf(CLOSE);
  if (to < from) throw new Error(`${file}: the close marker precedes the open marker`);
  // One newline belongs to each marker line and neither belongs to the quote.
  return body.slice(from, to).replace(/^\n/, '').replace(/\n$/, '');
}

async function main() {
  const mode = process.argv[2] ?? '';
  const schema = queueSchema();
  const { entry, version, schemaVersion } = library();
  const { getConstructionPlans } = await import(pathToFileURL(entry).href);
  const emitted = getConstructionPlans(schema);

  if (mode === '--emit') {
    process.stderr.write(
      `pg-boss@${version} (schema version ${schemaVersion}) resolved from ${QUEUE_MANIFEST}\n` +
        `QUEUE_SCHEMA = ${JSON.stringify(schema)} read from ${QUEUE_SOURCE}\n`,
    );
    process.stdout.write(emitted);
    return;
  }

  const file = migrationPath();
  const body = readFileSync(join(ROOT, file), 'utf8');
  const findings = [];

  // The header states the version it was emitted at, in a form a reader can
  // parse. A migration whose header and whose body disagree is worse than one
  // with no header at all.
  const pin =
    /^-- EMITTED-BY: pg-boss@(\S+) getConstructionPlans\('([^']*)'\), schema version (\d+)$/m.exec(
      body,
    );
  if (!pin) {
    findings.push(
      `${file}: no \`-- EMITTED-BY: pg-boss@<version> getConstructionPlans('<schema>'), schema version <n>\` line`,
    );
  } else {
    if (pin[1] !== version) {
      findings.push(
        `${file}: header says pg-boss@${pin[1]} and the installed library is ${version}. ` +
          'A merged migration is never edited (E2): supersede it with a new number.',
      );
    }
    if (pin[2] !== schema) {
      findings.push(
        `${file}: header says schema '${pin[2]}' and ${QUEUE_SOURCE} declares '${schema}'`,
      );
    }
    if (Number(pin[3]) !== Number(schemaVersion)) {
      findings.push(
        `${file}: header says pg-boss schema version ${pin[3]} and the installed library is at ` +
          `${schemaVersion}. \`Contractor.check()\` refuses any other number under migrate: false.`,
      );
    }
  }

  const inFile = quoted(body, file);
  if (inFile !== emitted) {
    const a = inFile.split('\n');
    const b = emitted.split('\n');
    let n = 0;
    while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
    findings.push(
      `${file}: the quoted body is not what pg-boss@${version} emits for schema '${schema}'. ` +
        `First difference at line ${n + 1} of the quoted region:\n` +
        `  migration: ${JSON.stringify(a[n] ?? '<end of body>')}\n` +
        `  library:   ${JSON.stringify(b[n] ?? '<end of body>')}\n` +
        'Regenerate with `--emit`, into a NEW migration number. 0079 is merged and merged migrations are never edited.',
    );
  }

  if (mode === '--falsify') {
    // A checker only ever run against a tree that satisfies it reports PASS in
    // exactly the same way as one narrowed until it reads nothing.
    const seeded = quoted(body.replace(OPEN, `${OPEN}\n-- seeded drift`), file);
    if (seeded === emitted) {
      console.error(
        'FALSIFY FAILED: a seeded line in the quoted body did not change the comparison',
      );
      process.exit(1);
    }
    if (findings.length > 0) {
      console.error(
        'FALSIFY FAILED: the unseeded tree is already failing, so the seed proves nothing',
      );
      for (const f of findings) console.error(`  ${f}`);
      process.exit(1);
    }
    console.log(
      'FALSIFY OK: a one-line edit to the quoted body is seen, and the clean tree passes.',
    );
    return;
  }

  if (findings.length > 0) {
    for (const f of findings) console.error(`FAIL   ${f}`);
    process.exit(1);
  }
  console.log(
    `PASS   ${file} quotes getConstructionPlans('${schema}') from pg-boss@${version} ` +
      `verbatim (${emitted.split('\n').length} lines), and its header pins that version and ` +
      `pg-boss schema version ${schemaVersion}.`,
  );
}

await main();
