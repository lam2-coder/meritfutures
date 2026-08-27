#!/usr/bin/env node
// =============================================================================
// scripts/corpus/fixture-backlog.mjs
// =============================================================================
// THE FIXTURE BACKLOG, DERIVED FROM THE ROWS RATHER THAN STATED ABOVE THEM.
//
//   node scripts/corpus/fixture-backlog.mjs          print the derivation
//
// `OI-25` is the open item and `WAVE-04` section 6 is its origin. The backlog is
// arrived at BY SUBTRACTION: somebody counted a population once, wrote the
// number into a summary table above the rows it counts, and every session that
// moves a row now owes that number an edit. `ADR-034` ruled the class -- "no
// document states a quantity a script can derive, unless the number sits in a
// generated span the script rewrites" -- on evidence of five hand-maintained
// counts checked and five found wrong. This file is the query behind the span,
// so the eleven numbers in section 39 are READ and can no longer be TYPED.
//
// WHAT WAS ALREADY THERE, BECAUSE IT CHANGES WHAT THIS IS FOR.
// `CI-06/fixture-inventory` assertion 5 ALREADY compares both summary tables to
// the rows, in both directions, and has since it landed. Its own finding text
// names what it cannot do:
//
//     "This is a hand-maintained count over hand-maintained rows (ADR-034) and
//      CI-06g cannot reach it, because it is not a generated span"
//
// So the number was CHECKED and still STATED, and the gap between those two is
// this file's entire subject. A checked-but-stated number still has to be
// retyped by hand every time a row moves, and the gate that refuses the wrong
// value is also the gate that tells the typist which value will pass. Session
// 237 is moving 227 rows; under a check, its diff shows a human editing a
// summary number, and a reader cannot tell "moved by the right amount" from
// "typed until green". Under a span, the summary is machine output and the row
// dispositions are the only thing a human touched. The check stays: it is the
// second, independent reading that catches a span whose query drifts from the
// property the document means, which is precisely what `ADR-034` says a
// generated span does NOT protect against ("a generated span can still be
// generated from the wrong query").
//
// THE VOCABULARY IS READ OUT OF `gates.mjs` AND NEVER RE-DECLARED HERE, and that
// is the one design decision in this file worth arguing. `FIXTURE_STATUSES` and
// `FIXTURE_BLOCKERS` are closed vocabularies written in the runner on `ADR-074`
// section 2's argument: a vocabulary computed from the terms currently in use
// admits every typo as a new term and can never fail. A SECOND copy here would
// be a second declaration of one closed set, which is the duplicate-key class
// `WAVE-03` spent nine sessions on, and it would fail in the worst direction: a
// term added to the runner and not to this file would produce a summary table
// missing a row while every count in it stayed arithmetically correct.
//
// READING ANOTHER SCRIPT'S SOURCE FOR A DECLARATION IS THIS DIRECTORY'S OWN
// IDIOM, not an invention here. `falsify.mjs` reads the CI-06 letters, the gate
// ids and `RETIRED_REGISTER` out of `gates.mjs` as TEXT for the same reason, and
// throws when its anchor is not found rather than proceeding over an empty list.
// The alternative -- importing `gates.mjs` -- would need two exports added to a
// file two other sessions are live in, and would make this module's load order
// depend on that file's.
//
// THE RULES THIS FILE IS WRITTEN UNDER are `gates.mjs`'s two, unchanged:
//
//   1. NEVER WEAKEN A CHECK TO PASS IT. Every query here counts EVERY row or it
//      throws. A derivation that silently drops a row it could not classify is
//      worse than the stated number it replaces, because it reads as machine
//      output.
//   2. A DERIVATION THAT CANNOT RUN IS NOT A DERIVATION THAT AGREED. No parse
//      here returns zero on an input it failed to read: an empty row set, an
//      empty vocabulary and a partition that does not close are all errors.
//
// WHAT IT DOES NOT DO. It takes no view on whether a row's disposition is the
// RIGHT one. `CI-06/fixture-inventory` asserts the status against the fixture
// directory and the citation against the suite; this file only counts what the
// rows say. A row moved to the wrong status is counted correctly into the wrong
// bucket, and that is the other gate's half.
// =============================================================================

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/** The document whose rows are the population. The same path `gates.mjs` reads. */
export const FIXTURE_STATUS_DOC = 'docs/testing/golden-scenarios/39-fixture-status-and-blockers.md';

/** The runner that declares the two closed vocabularies. Read as text, never imported. */
const GATES = 'scripts/corpus/gates.mjs';

// A `const NAME = [ ... ];` declaration at the start of a line, so a mention of
// the name inside a comment or a finding string cannot be mistaken for the
// declaration. The members are the single-quoted strings inside it.
function declaredVocabulary(source, name) {
  const m = new RegExp(`^const ${name} = \\[([\\s\\S]*?)\\];`, 'm').exec(source);
  if (m === null) {
    throw new Error(
      `${GATES}: no top-level \`const ${name} = [...]\` declaration. This file reads the ` +
        'closed vocabulary out of the runner rather than declaring a second copy of it, so a ' +
        'renamed or restructured declaration is an error here and never an empty vocabulary',
    );
  }
  const terms = [...m[1].matchAll(/'([^']+)'/g)].map((t) => t[1]);
  if (terms.length === 0) {
    throw new Error(
      `${GATES}: \`${name}\` parsed to zero terms. An empty vocabulary would classify every ` +
        'row as unknown and derive a backlog of zero, which reads exactly like a clean tree',
    );
  }
  return terms;
}

/**
 * The two closed vocabularies, in the runner's own declaration order, which is
 * the order the summary tables are written in.
 */
export function vocabularies() {
  const source = read(GATES);
  return {
    statuses: declaredVocabulary(source, 'FIXTURE_STATUSES'),
    blockers: declaredVocabulary(source, 'FIXTURE_BLOCKERS'),
  };
}

/**
 * The rows of section 39: `| GS-nnn | status | blocker | citation |`, read
 * positionally. The same shape `gates.mjs` reads, deliberately, so the two
 * cannot disagree about what a row is.
 */
export function backlogRows() {
  const rows = [];
  const lines = read(FIXTURE_STATUS_DOC).split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^\|\s*GS-\d{3}\s*\|/.test(lines[i])) continue;
    const cells = lines[i]
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim().replace(/[`*]/g, ''));
    rows.push({
      id: /GS-\d{3}/.exec(cells[0])[0],
      status: cells[1] ?? '',
      blocker: cells[2] ?? '',
      n: i + 1,
    });
  }
  if (rows.length === 0) {
    throw new Error(
      `no GS rows parsed from ${FIXTURE_STATUS_DOC}. Rule 2: a reader that found nothing has ` +
        'lost its input, and every count below would be zero and look derived',
    );
  }
  return rows;
}

/**
 * The whole derivation: the row total, one count per status term and one per
 * blocker term, with the partition asserted CLOSED in both directions.
 *
 * THE CLOSURE ASSERTION IS THE CONTROL AND NOT A FORMALITY. Summing the buckets
 * proves nothing on its own; comparing that sum to the row count is what makes
 * an unreadable row impossible to lose. A status term nobody declared, a
 * misspelt blocker, a row whose cells shifted: each one drops a row out of every
 * bucket, and each one is caught here as an arithmetic gap that names the rows
 * responsible rather than as a summary that is quietly short by one.
 */
export function fixtureBacklog() {
  const { statuses, blockers } = vocabularies();
  const rows = backlogRows();

  const byStatus = new Map(statuses.map((s) => [s, 0]));
  const byBlocker = new Map(blockers.map((b) => [b, 0]));
  const unknownStatus = [];
  const unknownBlocker = [];

  for (const r of rows) {
    if (byStatus.has(r.status)) byStatus.set(r.status, byStatus.get(r.status) + 1);
    else unknownStatus.push(`${r.id} (line ${r.n}) reads "${r.status}"`);
    if (r.status !== 'blocked') continue;
    if (byBlocker.has(r.blocker)) byBlocker.set(r.blocker, byBlocker.get(r.blocker) + 1);
    else unknownBlocker.push(`${r.id} (line ${r.n}) reads "${r.blocker}"`);
  }

  const statusTotal = [...byStatus.values()].reduce((a, b) => a + b, 0);
  if (statusTotal !== rows.length) {
    throw new Error(
      `${FIXTURE_STATUS_DOC}: the status partition does not close. ${rows.length} row(s) and ` +
        `${statusTotal} counted, so ${rows.length - statusTotal} row(s) fall outside the closed ` +
        `vocabulary [${statuses.join(', ')}]: ${unknownStatus.join('; ')}. A derived count that ` +
        'omits a row is worse than a stated one, because it reads as machine output',
    );
  }

  const blockedTotal = [...byBlocker.values()].reduce((a, b) => a + b, 0);
  const blocked = byStatus.get('blocked') ?? 0;
  if (blockedTotal !== blocked) {
    throw new Error(
      `${FIXTURE_STATUS_DOC}: the blocker partition does not close. ${blocked} blocked row(s) ` +
        `and ${blockedTotal} counted, so ${blocked - blockedTotal} name a term outside the ` +
        `closed vocabulary [${blockers.join(', ')}]: ${unknownBlocker.join('; ')}. ADR-072 ` +
        'requires a stated blocker from the vocabulary on every blocked row',
    );
  }

  return { rows: rows.length, byStatus, byBlocker };
}

// A span name from a vocabulary term. `covered-elsewhere` becomes
// `covered_elsewhere`, because `spansIn` matches `[a-z0-9_]+` and a hyphen in a
// span name is a span that parses as nothing at all -- which is how `e2_files`
// was invisible for two days while its gate reported PASS.
const spanKey = (prefix, term) => `${prefix}_${term.replace(/-/g, '_')}`;

/**
 * The span queries, one per vocabulary term plus the row total, BUILT FROM THE
 * VOCABULARY rather than listed. A blocker term added to `gates.mjs` gets its
 * query here on the same commit, and `CI-06/fixture-inventory` assertion 5
 * already requires the summary table to grow a row for it, so the two halves of
 * "a new term" cannot land apart.
 *
 * Each query re-derives the WHOLE backlog. That is deliberate: a per-key query
 * that counted only its own term could not assert the partition closes, and the
 * cost is eleven reads of one document by a script that runs in a gate.
 */
export const FIXTURE_BACKLOG_QUERIES = (() => {
  const { statuses, blockers } = vocabularies();
  const queries = { fixture_backlog_rows: () => fixtureBacklog().rows };
  for (const s of statuses) {
    queries[spanKey('fixture_status', s)] = () => fixtureBacklog().byStatus.get(s);
  }
  for (const b of blockers) {
    queries[spanKey('fixture_blocker', b)] = () => fixtureBacklog().byBlocker.get(b);
  }
  return queries;
})();

// -----------------------------------------------------------------------------
// The other half of ADR-034's remedy: "delete the number and point at the script"
// -----------------------------------------------------------------------------
// A document may point HERE instead of carrying a span, and a reader who wants
// the backlog without opening a gate runs this.
function main() {
  const { rows, byStatus, byBlocker } = fixtureBacklog();
  console.log(`${FIXTURE_STATUS_DOC}: ${rows} row(s)\n`);
  console.log('  status');
  for (const [term, n] of byStatus) console.log(`    ${String(n).padStart(4)}  ${term}`);
  console.log('\n  blocker (blocked rows only)');
  for (const [term, n] of byBlocker) console.log(`    ${String(n).padStart(4)}  ${term}`);
  console.log('\n  span queries');
  for (const [name, q] of Object.entries(FIXTURE_BACKLOG_QUERIES)) {
    console.log(`    ${String(q()).padStart(4)}  ${name}`);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
