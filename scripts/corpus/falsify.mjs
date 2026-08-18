#!/usr/bin/env node
// =============================================================================
// scripts/corpus/falsify.mjs
// =============================================================================
// A GATE NOBODY HAS WATCHED FAIL IS NOT A GATE.
//
// This runs every gate in gates.mjs twice: once against the tree as it stands,
// where it must PASS, and once against a COPY of the tree carrying one seeded
// violation aimed at that gate, where it must FAIL. A gate that passes both
// times is not checking what its row says it checks, and this harness reports
// that as an error rather than as a green run.
//
// It then runs the SCOPE cases: a gate that fails on the right violation may
// still be reading the wrong set of files, which is the defect OQ-P1-04 named.
// Each scope case asserts one direction of one boundary, and no boundary is
// asserted in one direction only.
//
//   node scripts/corpus/falsify.mjs
//
// Exit code is 0 only when every gate passed clean AND failed dirty AND every
// scope case landed on the side of the boundary it names.
//
// WHY THIS EXISTS. Two independent sessions wrote a gates.mjs, and the founder
// picked between them on exactly this criterion: PR #8's runner had been watched
// produce 109 phantom broken anchors and 119 phantom refless edge cases, both
// traced to bugs in the runner rather than to the corpus. PR #7's had not been
// watched fail correctly. That judgment was made by reading a transcript. This
// file makes it a command, so the next reader does not have to take anyone's
// word for it.
//
// The copy is a plain directory copy rather than a git worktree, ON PURPOSE:
// the working tree is what CI and the founder actually read, and a harness that
// only ever tests committed state cannot verify a gate the moment it matters.
// =============================================================================

import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  renameSync,
  readdirSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const OWNERSHIP_DOC =
  'docs/testing/golden-scenarios/33-ownership-index-and-coverage-reconciliation.md';

const edit = (dir, file, fn) => {
  const p = join(dir, file);
  writeFileSync(p, fn(readFileSync(p, 'utf8')));
};
// Accepts a string or a RegExp, and CHECKS THE ANCHOR EXISTS either way. A seed
// whose anchor has moved must announce itself rather than replace nothing and
// report a gate that cannot fail.
const once = (body, needle, replacement) => {
  const found = typeof needle === 'string' ? body.includes(needle) : needle.test(body);
  if (!found) throw new Error(`seed anchor not found: ${needle}`);
  return body.replace(needle, replacement);
};

// Nudge a generated span off its query WITHOUT NAMING EITHER NUMBER.
//
// THIS SEED USED TO CARRY THE COUNT: `once(b, '<!--gen:ec_count-->140', '...141')`.
// It broke the first time an edge case was added, which is to say the first
// time the corpus did the ordinary thing the span exists to track, and it broke
// in the direction that matters least and reads worst: a HAND-MAINTAINED COUNT
// INSIDE THE HARNESS BUILT TO CATCH HAND-MAINTAINED COUNTS. ADR-034 is five for
// five on this class and this was the sixth site.
//
// Reading the span and adding one keeps the seed a real violation forever: the
// value written is wrong by construction whatever the query returns, and the
// anchor check survives because a missing span still throws rather than
// silently seeding nothing.
const bumpSpan = (body, name) => {
  const pattern = new RegExp(`<!--gen:${name}-->(\\d+)<!--/gen-->`);
  const found = pattern.exec(body);
  if (found === null) throw new Error(`seed anchor not found: a <!--gen:${name}--> span`);
  return body.replace(pattern, `<!--gen:${name}-->${Number(found[1]) + 1}<!--/gen-->`);
};

// =============================================================================
// A SEED MAY NOT PIN TO A LIVE IDENTIFIER (founder rider, 2026-08-15)
// =============================================================================
// Two seeds were pinned to the literal `0029`. When ADR-039 to ADR-042 reserved
// 0029 through 0032, one seed started writing a file the table now claimed and
// STOPPED FIRING ITS FINDING, and the other inserted a second row for an
// already-reserved number and PASSED WHILE ASSERTING NOTHING. One went silent and
// one went vacuous, and only the silent one announced itself.
//
// Retargeting them to `0033` fixed both for exactly as long as nobody reserves
// 0033, which is the same bug with a later expiry date. The rule now is: A SEED
// DERIVES ITS IDENTIFIER FROM THE REGISTRY AT SEED TIME, so it moves with the
// table by construction and there is no literal left to go stale.
//
// The identifier is read from the tree copy rather than from ROOT, because the
// copy is what the gate will read. Reading ROOT would reintroduce the same class
// one level down: a number free in the source tree and claimed in the seeded one.
const nextFree = (dir, heading) => {
  const body = readFileSync(join(dir, 'docs/decisions/ALLOCATION.md'), 'utf8');
  const start = body.indexOf(heading);
  if (start === -1) throw new Error(`seed anchor not found: the "${heading}" table`);
  const rest = body.slice(start + heading.length);
  const next = rest.search(/\n## /);
  const claimed = new Set();
  let rows = 0;
  for (const line of (next === -1 ? rest : rest.slice(0, next)).split('\n')) {
    if (!line.startsWith('|')) continue;
    const m = /^\s*\*{0,2}(\d{3,4})\*{0,2}(?:\s+to\s+\*{0,2}(\d{3,4})\*{0,2})?\s*$/.exec(
      line.split('|')[1] ?? '',
    );
    if (!m) continue;
    rows++;
    const to = m[2] ? Number(m[2]) : Number(m[1]);
    for (let n = Number(m[1]); n <= to; n++) claimed.add(n);
  }
  // Rule 2 of gates.mjs, applied to the harness: a parser that reads nothing has
  // lost its input, and returning 1 here would seed a violation against a table
  // nobody parsed.
  if (rows === 0) throw new Error(`seed anchor found no rows in the "${heading}" table`);
  let n = 1;
  while (claimed.has(n)) n++;
  return n;
};

// Insert a migration allocation row. The anchor is the LAST row of the table
// rather than a literal, so this does not become the next pinned identifier.
const addMigrationRow = (body, number, state) => {
  const heading = '## Migration number allocation';
  const start = body.indexOf(heading);
  if (start === -1) throw new Error('seed anchor not found: the migration allocation table');
  // BOUNDED TO ITS OWN SECTION. Unbounded, `rest` runs to the end of the file and
  // the last table row belongs to the CI gate letter table BELOW this one, so the
  // reservation lands outside the section the parser reads and the seed quietly
  // reserves nothing. That is the vacuous class again, inside the fix for it.
  const after = body.slice(start + heading.length);
  const end = after.search(/\n## /);
  const section = end === -1 ? after : after.slice(0, end);
  const rows = [...section.matchAll(/^\|.*\|$/gm)];
  if (rows.length < 3) throw new Error('seed anchor found no rows in the migration table');
  const last = rows[rows.length - 1];
  const at = start + heading.length + last.index + last[0].length;
  return `${body.slice(0, at)}\n| ${number} | falsify probe | **reserved.** ${state} |${body.slice(at)}`;
};

const nextFreeMigration = (dir) =>
  String(nextFree(dir, '## Migration number allocation')).padStart(4, '0');
const nextFreeAdr = (dir) => String(nextFree(dir, '## Number allocation')).padStart(3, '0');

/**
 * The HIGHEST numbered ADR entry file that exists in the tree.
 *
 * Derived rather than pinned: `CI-06f/duplicate-heading` duplicates a heading
 * inside a file that already exists, so it plants a DUPLICATE and not a hole.
 * Pinning a number would eventually name a file that is not there, and the seed
 * would then plant nothing while still reporting a tidy `did not fire`.
 */
const lastAdrId = (dir) => {
  const ids = readdirSync(join(dir, 'docs/decisions'))
    .map((f) => /^ADR-(\d{3})\.md$/.exec(f))
    .filter(Boolean)
    .map((m) => m[1])
    .sort();
  if (ids.length === 0) throw new Error('seed anchor not found: no numbered ADR entry files');
  return ids[ids.length - 1];
};

// =============================================================================
// The letter registry, which is CI-06p's input
// =============================================================================
// Same rider as the numeric registries above: nothing here names a letter. The
// table grows by one row whenever a gate is written, so a seed pinned to `q`
// would go silent the first week somebody claims it, which is exactly how the
// two migration seeds went stale on 0029.
const LETTER_HEADING = '## CI gate identifier allocation';

// BOUNDED ON ANY HEADING rather than on `\n## `, and this differs from
// `addMigrationRow` one helper up on purpose. The letter table is the LAST `##`
// section in ALLOCATION.md, so a `\n## ` bound runs to end of file and the "last
// row" a seed anchors to would be a row of the prose sections below it. It is
// the same bound `allocatedLetters()` uses in gates.mjs, for the same reason.
function letterSection(body) {
  const start = body.indexOf(LETTER_HEADING);
  if (start === -1) throw new Error(`seed anchor not found: the "${LETTER_HEADING}" table`);
  const after = body.slice(start + LETTER_HEADING.length);
  const end = after.search(/\n#{1,6} /);
  return { at: start + LETTER_HEADING.length, section: end === -1 ? after : after.slice(0, end) };
}

const LETTER_CELL = /^\s*\*{0,2}`?([a-z])`?\*{0,2}(?:\s+to\s+\*{0,2}`?([a-z])`?\*{0,2})?\s*$/;

function claimedLetters(dir) {
  const { section } = letterSection(
    readFileSync(join(dir, 'docs/decisions/ALLOCATION.md'), 'utf8'),
  );
  const claimed = new Set();
  let rows = 0;
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue;
    const m = LETTER_CELL.exec(line.split('|')[1] ?? '');
    if (!m) continue;
    rows++;
    const to = (m[2] ?? m[1]).charCodeAt(0);
    for (let c = m[1].charCodeAt(0); c <= to; c++) claimed.add(String.fromCharCode(c));
  }
  // Rule 2 of gates.mjs applied to the harness, as `nextFree` does one registry
  // over: a parser that reads nothing would seed against a table nobody parsed.
  if (rows === 0) throw new Error(`seed anchor found no rows in the "${LETTER_HEADING}" table`);
  return claimed;
}

// The first letter the table does not claim, which is also the gate's first
// hole: CI-06p asserts that every implemented letter is claimed by a row, so on
// any tree where that assertion holds the table's claims are a superset of the
// runner's.
function nextFreeLetter(dir) {
  const claimed = claimedLetters(dir);
  for (let c = 'a'.charCodeAt(0); c <= 'x'.charCodeAt(0); c++) {
    const letter = String.fromCharCode(c);
    if (!claimed.has(letter)) return letter;
  }
  // Stops at `x` rather than `z` because every seed below needs two letters of
  // headroom above the one it names. A harness that silently wrapped past `z`
  // would plant nothing and report a tidy `did not fire`.
  throw new Error(`seed anchor exhausted: the "${LETTER_HEADING}" table claims a through x`);
}

// The CI-06 letters the runner implements, read from the tree COPY's gates.mjs
// rather than from ROOT's, on the same reasoning as `nextFree`: the copy is what
// the gate will read.
function implementedLettersIn(dir) {
  const body = readFileSync(join(dir, 'scripts/corpus/gates.mjs'), 'utf8');
  const out = [...body.matchAll(/id:\s*'CI-06([a-z])'/g)].map((m) => m[1]).sort();
  if (out.length === 0) {
    throw new Error('seed anchor not found: no CI-06<letter> gate ids in gates.mjs');
  }
  return out;
}

const STRATEGY_DOC_F = 'docs/testing/STRATEGY.md';
const GATE_INVENTORY_F = '### 4.4 Corpus integrity';

// The first row of STRATEGY's gate inventory whose first cell IS a `CI-06<letter>`,
// found by shape and BOUNDED TO SECTION 4.4, so a row of some later table is never
// the thing a seed duplicates. `####` subheadings inside 4.4 do not end it, which
// is what keeps the bound at the section rather than at the first prose block.
function strategyInventory(dir) {
  const body = readFileSync(join(dir, STRATEGY_DOC_F), 'utf8');
  const start = body.indexOf(GATE_INVENTORY_F);
  if (start === -1) throw new Error(`seed anchor not found: the "${GATE_INVENTORY_F}" section`);
  const lines = body.split('\n');
  const first = body.slice(0, start).split('\n').length - 1;
  for (let i = first + 1; i < lines.length; i++) {
    if (/^### /.test(lines[i])) break;
    if (!lines[i].startsWith('|')) continue;
    const m = /^\s*\*{0,2}`?CI-06([a-z])`?\*{0,2}\s*$/.exec(lines[i].split('|')[1] ?? '');
    if (m) return { lines, i, line: lines[i], letter: m[1] };
  }
  throw new Error('seed anchor not found: no CI-06 row in the STRATEGY gate inventory');
}

// Claim a letter, anchored to the LAST row of the letter table rather than to a
// literal, which is `addMigrationRow`'s rule with a different alphabet.
function addLetterRow(body, letter, note) {
  const { at, section } = letterSection(body);
  const rows = [...section.matchAll(/^\|.*\|$/gm)];
  if (rows.length < 3) throw new Error('seed anchor found no rows in the letter table');
  const last = rows[rows.length - 1];
  const end = at + last.index + last[0].length;
  return `${body.slice(0, end)}\n| **\`${letter}\`** | falsify probe | ${note} |${body.slice(end)}`;
}

// =============================================================================
// CI-06k's seeds, and why every one of them is DERIVED
// =============================================================================
// Same rider as the migration seeds above, applied to a different registry. The
// three things this gate reads are all things the corpus edits: the rows of
// API_CONTRACT section 12, the C-27 action names, and the class list the
// rate-limit exemption is generated over. A seed naming any of them by literal
// goes stale the first time one is reworded, and it goes stale SILENTLY, because
// a row that no longer matches is a seed that plants nothing.
//
// So each helper below finds its target by SHAPE and throws if the shape is
// gone. `seed anchor not found` is a harness problem and reads nothing like a
// gate problem, which is the whole value of the distinction.
const AUTHZ_DOC = 'docs/architecture/API_CONTRACT.md';
const AUTHZ_HEADING = '## 12. Negative-authz test matrix';

// The matrix as [before, headerLine, ...rows, after], so a seed can rewrite one
// cell of one row and put the file back together unchanged everywhere else.
function authzMatrix(dir) {
  const body = readFileSync(join(dir, AUTHZ_DOC), 'utf8');
  const start = body.indexOf(AUTHZ_HEADING);
  if (start === -1) throw new Error(`seed anchor not found: the "${AUTHZ_HEADING}" section`);
  const after = body.slice(start + AUTHZ_HEADING.length);
  const end = after.search(/\n## /);
  const section = end === -1 ? after : after.slice(0, end);
  const lines = section.split('\n');
  const headerAt = lines.findIndex((l) => l.trim().startsWith('|') && /required.factor/i.test(l));
  if (headerAt === -1) throw new Error('seed anchor not found: the required-factor column header');
  const col = lines[headerAt]
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .findIndex((c) => /required.factor/i.test(c));
  return { body, section, lines, headerAt, col, replace: (next) => body.replace(section, next) };
}

const isSeparator = (l) =>
  l
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .every((c) => /^\s*:?-+:?\s*$/.test(c));

// Rewrite cell `col` of the first row below the header that satisfies `pick`.
function editFactorCell(dir, pick, rewrite) {
  const m = authzMatrix(dir);
  for (let i = m.headerAt + 1; i < m.lines.length; i++) {
    const line = m.lines[i];
    if (!line.trim().startsWith('|') || isSeparator(line)) continue;
    const cells = line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|');
    if (cells.length <= m.col) continue;
    if (!pick(cells[m.col])) continue;
    const next = rewrite(cells[m.col]);
    if (next === null) continue;
    cells[m.col] = next;
    m.lines[i] = `| ${cells.map((c) => c.trim()).join(' | ')} |`;
    writeFileSync(join(dir, AUTHZ_DOC), m.replace(m.lines.join('\n')));
    return cells;
  }
  throw new Error('seed anchor not found: no matrix row matched the seed predicate');
}

// The migration that creates the generated exemption column, found rather than
// named: the file number is an allocated identifier and the rider forbids pinning
// to one. This is the same rule the migration seeds follow, one registry over.
function exemptionSite(dir) {
  const dir_ = join(dir, 'packages/db/migrations');
  for (const f of readdirSync(dir_).sort().reverse()) {
    if (!f.endsWith('.sql')) continue;
    const body = readFileSync(join(dir_, f), 'utf8');
    if (/ADD\s+COLUMN\s+rate_limit_exempt\s+boolean\s+GENERATED/i.test(body)) return { f, body };
  }
  throw new Error('seed anchor not found: no migration creates a generated rate_limit_exempt');
}

// A notification class that is NOT one of the two post-identity exempt classes,
// read from the same file at seed time. Today this is the pre-identity class the
// whole amendment is about; if it is ever renamed, this moves with it and the
// seed stays a real violation instead of quietly seeding a class nobody has.
function nonExemptClass(body) {
  const classes = new Set();
  for (const m of body.matchAll(/class\s+(?:NOT\s+)?IN\s*\(([^)]*)\)/gi)) {
    for (const q of m[1].matchAll(/'([a-z_]+)'/g)) classes.add(q[1]);
  }
  const found = [...classes].find((c) => c !== 'security' && c !== 'money');
  if (!found)
    throw new Error('seed anchor not found: no notification class outside security and money');
  return found;
}

// =============================================================================
// CI-06l's seeds, and why every one of them is DERIVED
// =============================================================================
// The same rider, a third registry over. The things this gate reads are the
// `*_expires_at` columns the migrations declare and the two lists in
// CRON_INVENTORY that disposition them, and BOTH SIDES MOVE: a migration adds a
// clock, a fold gives one a job, a rename changes a spelling. A seed naming
// `payout_requests.hold_expires_at` by literal would go stale the day that
// column is superseded, and it would go stale SILENTLY, because a row that no
// longer matches is a seed that plants nothing.
//
// So each helper finds its target by SHAPE at seed time and throws if the shape
// is gone.
const CRON_DOC_F = 'docs/ops/runbooks/CRON_INVENTORY.md';
const CRON_COVERAGE_F = '## Expiry columns and their release jobs';
const CRON_EXEMPT_F = '## The expiry exemption list';

// The rows of one section, with the offsets needed to put the file back
// together after rewriting exactly one of them.
function cronSection(dir, heading) {
  const body = readFileSync(join(dir, CRON_DOC_F), 'utf8');
  const start = body.indexOf(heading);
  if (start === -1) throw new Error(`seed anchor not found: the "${heading}" section`);
  const after = body.slice(start + heading.length);
  const end = after.search(/\n## /);
  const section = end === -1 ? after : after.slice(0, end);
  const lines = section.split('\n');
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l.startsWith('|')) continue;
    const cells = l
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    const m = /^`?([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)`?$/.exec(cells[0]);
    if (!m) continue; // the header row, and anything that is not an entry
    rows.push({ i, column: m[1], cells });
  }
  if (rows.length === 0) throw new Error(`seed anchor found no entries in "${heading}"`);
  return {
    body,
    lines,
    rows,
    write: (next) => writeFileSync(join(dir, CRON_DOC_F), body.replace(section, next.join('\n'))),
  };
}

// The first column the coverage table claims, whatever it is called today.
const firstCoveredColumn = (dir) => cronSection(dir, CRON_COVERAGE_F).rows[0].column;
const firstExemptColumn = (dir) => cronSection(dir, CRON_EXEMPT_F).rows[0].column;

// THE SAME COLUMN, READ LOOSELY, AND THE DISTINCTION IS A BUG THIS HARNESS HIT.
//
// `expect` is resolved against the SEEDED tree, after the seed has run. A seed
// that removes or rewrites the first coverage row therefore changes what
// `firstCoveredColumn` returns, and the case reports FAILED OFF-TARGET while
// the gate is doing exactly the right thing: it named the column the seed
// broke, and the harness had gone on to ask about a different one.
//
// This reads the first row's column whether or not that row still parses as an
// entry, so it names the same column before and after the seed. The strict
// reader above is what the GATE uses to decide coverage; this one is what the
// HARNESS uses to describe its own target, and they must not be the same
// function.
function firstCoverageColumnLoose(dir) {
  const body = readFileSync(join(dir, CRON_DOC_F), 'utf8');
  const start = body.indexOf(CRON_COVERAGE_F);
  if (start === -1) throw new Error(`seed anchor not found: the "${CRON_COVERAGE_F}" section`);
  const after = body.slice(start + CRON_COVERAGE_F.length);
  const end = after.search(/\n## /);
  const section = end === -1 ? after : after.slice(0, end);
  const m = /^\|\s*`?([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*expires_at)`?[^|]*\|/m.exec(section);
  if (!m) throw new Error('seed anchor not found: no column row in the coverage table');
  return m[1];
}

// One seeded violation per gate. Each is the SMALLEST edit that the gate's own
// row says must fail, and each names the real failure it stands in for.
//
// `expect` IS NOT DECORATION. Without it this harness scores "the gate exited
// non-zero" as success, and on its first run three gates failed on a truncated
// tree copy rather than on the seeded violation. A gate failing for a reason
// you did not plant tells you nothing about whether it can catch the thing you
// did plant. Every seed therefore names a substring its finding must contain.
const SEEDS = {
  'CI-06a': {
    what: 'a link to a heading that does not exist',
    real: '27 anchors broke silently across seven documents',
    // TARGETED AT A FILE THAT EXISTS, and ADR-043 is why it had to move. This
    // read `DECISIONS.md#no-such-heading-anywhere` until the split deleted that
    // file. The link would still have produced a finding, and the finding would
    // still have contained this `expect` string, so the harness would have gone
    // on reporting success -- while asserting the "no such file" branch instead
    // of the anchor branch it exists to test. Exactly the rider's vacuous class,
    // caught before it could report green.
    expect: 'ADR-034.md#no-such-heading-anywhere (no such heading)',
    seed: (d) =>
      edit(
        d,
        'docs/STATE.md',
        (b) => b + '\n[probe](decisions/ADR-034.md#no-such-heading-anywhere)\n',
      ),
  },
  'CI-06b': {
    what: 'a document whose status is not one of the four',
    real: 'a document without a gateable status cannot be gated, and the wave model is statuses',
    expect: 'status "nearly"',
    seed: (d) => edit(d, 'docs/GLOSSARY.md', (b) => once(b, 'status: approved', 'status: nearly')),
  },
  'CI-06c': {
    what: 'a tracked document absent from INDEX',
    real: '"if a thing is not in INDEX.md, it does not exist" had no enforcement',
    expect: 'not in INDEX: docs/PROBE_UNLISTED.md',
    seed: (d) =>
      writeFileSync(
        join(d, 'docs/PROBE_UNLISTED.md'),
        '---\nstatus: draft\ndepends_on: []\nlast_updated: 2026-08-15\n---\n\n# Probe\n',
      ),
  },
  'CI-06d': {
    what: 'a citation of a golden scenario the registry does not define',
    real: 'registry counts were quoted in gate summaries while wrong',
    expect: 'cites GS-999',
    seed: (d) => edit(d, 'docs/STATE.md', (b) => b + '\nSee GS-999 for the probe case.\n'),
  },
  'CI-06e': {
    what: 'an edge case whose golden scenario reference is gone',
    real: "TR-04's second half: an edge case with no fixture is a decision nobody can test",
    expect: 'names no golden scenario',
    // Targeted at a REAL `## EC-nnn:` block. Aimed at the first
    // `- Golden scenario ref:` line in the file, this lands on the convention
    // paragraph above EC-001, the gate correctly ignores it, and the harness
    // reports a gate that cannot fail. The seed was wrong and the gate was
    // right, which is the same shape as the 109 phantom anchors.
    // ADR-043 stage 2 moved the registry to a directory, so the seed targets the
    // ENTRY FILE. It no longer needs to slice past the convention paragraph: the
    // paragraph lives in the README and the entry file is only the entry, which is
    // the split making a seed simpler rather than harder.
    //
    // The stale version of this seed was watched failing as SEED IS STALE before
    // it was fixed, which is the mechanism the founder's rider asked for doing its
    // job on the first seed to need it.
    seed: (d) =>
      edit(d, 'docs/edge-cases/EC-001.md', (b) =>
        once(b, /^- Golden scenario ref:.*$/m, '- Golden scenario ref:'),
      ),
  },
  'CI-06f': {
    what: 'an ADR claiming a number nobody reserved',
    real: 'two pull requests claimed ADR-031 from the same base',
    // DERIVED, not pinned. `ADR-099` worked only while the registry was short of
    // 99, and the registry is the thing that grows. The seed writes an entry five
    // past the first free number, which opens a hole AT the first free number
    // whatever the table currently claims.
    expect: (d) => `ADR-${nextFreeAdr(d)} is neither present nor reserved (a hole)`,
    seed: (d) => {
      const n = String(Number(nextFreeAdr(d)) + 5).padStart(3, '0');
      writeFileSync(
        join(d, `docs/decisions/ADR-${n}.md`),
        `## ADR-${n}: probe  (2026-08-15, status: proposed)\n`,
      );
    },
  },
  'CI-06g': {
    what: 'a generated span hand-edited away from its query',
    real: 'every hand-maintained count in this corpus that has been checked was wrong',
    expect: 'span "ec_count"',
    seed: (d) => edit(d, 'docs/STATE.md', (b) => bumpSpan(b, 'ec_count')),
  },
  'CI-06h': {
    what: 'a hole in the migration sequence that no row reserves',
    real: 'migrations apply in filename order, so a missing number is an order nobody can reason about',
    // Was 'migration gap' until ADR-036 made the check gapless over allocated
    // PLUS reserved. The rename leaves 0028 allocated-but-absent, which is now
    // indistinguishable from a legitimate reservation and correctly passes; the
    // finding this seed plants is the UNRESERVED hole it opens.
    //
    // THE TARGET MOVES WITH THE TABLE, and that is the maintenance cost of a
    // seed pinned to a literal. This read 0029 until 2026-08-15, when ADR-039
    // to ADR-042 reserved 0029 through 0032 and the seeded hole landed on a
    // legitimate reservation, so the gate correctly passed and the seed proved
    // nothing. It was watched not failing before it was retargeted. 0033 is the
    // first number the table does not claim.
    expect: (d) => `${nextFreeMigration(d)} is neither on disk nor reserved`,
    seed: (d) => {
      const n = String(Number(nextFreeMigration(d)) + 5).padStart(4, '0');
      renameSync(
        join(d, 'packages/db/migrations/0028_supersede_plan_version_immutability.sql'),
        join(d, `packages/db/migrations/${n}_supersede_plan_version_immutability.sql`),
      );
    },
  },
  'CI-06i': {
    what: 'a DATA_MODEL section for a table no migration creates',
    real: '50 tables had a migration and no design record, and nothing failed because nothing counted',
    expect: 'probe_phantom_table',
    // ADR-043 stage 3: one file per design record, so a phantom record is a
    // phantom FILE. Watched reporting SEED IS STALE against the old path before
    // it was moved, which is the second seed the rider's mechanism has caught.
    seed: (d) =>
      writeFileSync(
        join(d, 'docs/architecture/data-model/probe_phantom_table.md'),
        '### probe_phantom_table\n\nA design record for a table no migration creates.\n',
      ),
  },
  'CI-06j': {
    what: 'a trigger body reading a column that is not on the table it guards',
    real: 'ADR-035, exactly: NEW.config on a table whose rule contract is `rules`',
    expect: 'plan_versoin_id',
    seed: (d) =>
      edit(d, 'packages/db/migrations/0027_triggers_invariants.sql', (b) =>
        once(
          b,
          'NEW.plan_version_id IS DISTINCT FROM OLD.plan_version_id',
          'NEW.plan_versoin_id IS DISTINCT FROM OLD.plan_version_id',
        ),
      ),
  },
  'CI-06n': {
    what: 'a registry entry file that its registry README does not list',
    real:
      'ADR-043 exempted entry files from INDEX, and an exemption with nothing in its ' +
      'place is a document that exists and nothing indexes',
    // Derived, so it cannot collide with a real ADR the way a pinned 999 would
    // the day the registry reaches it.
    expect: (d) =>
      `docs/decisions/ADR-${String(Number(nextFreeAdr(d)) + 7).padStart(3, '0')}.md: entry file with no row`,
    seed: (d) => {
      const n = String(Number(nextFreeAdr(d)) + 7).padStart(3, '0');
      writeFileSync(
        join(d, `docs/decisions/ADR-${n}.md`),
        `## ADR-${n}: an entry nothing indexes  (2026-08-15, status: proposed)\n`,
      );
    },
  },
  'CI-06q': {
    what: 'a dated citation of a founder ruling on a date no registry file declares',
    real:
      'two lines in packages/golden-loader attributed the deferral of ADR-048s polarity ' +
      'enforcement to a dated ruling by the founder, and no such ruling existed anywhere; ' +
      'the behaviour needed no authority at all and the citation was the whole defect',
    // A PRE-PROJECT DATE, AND THE CHOICE IS DELIBERATE. Every other derived seed
    // in this harness derives from a sequence so it cannot collide as the corpus
    // grows; a date is not a sequence, so the collision is avoided from the other
    // end. Merit's first ADR is dated 2026, so no registry file can ever declare
    // a ruling on a 2019 date, and the seed stays falsifiable forever without a
    // pin somebody has to move.
    expect: () => 'cites a ruling dated 2019-01-02',
    seed: (d) =>
      edit(
        d,
        'docs/GLOSSARY.md',
        (b) =>
          `${b}\n<!-- seeded -->\nThe cap was raised by a ` +
          // Assembled, so this harness is not itself a finding when the gate
          // scans the repository it lives in. RI-02's idiom, and the same reason
          // gates.mjs assembles the pattern rather than spelling it.
          ['found', 'er'].join('') +
          ' ' +
          ['rul', 'ing'].join('') +
          ', 2019-01-02, which nothing records.\n',
      ),
  },
  'CI-06r': {
    what: 'an ADR heading itself `status: proposed` while its own body records the founder accepting it',
    real:
      'ADR-006, ADR-007 and ADR-008 each headed themselves proposed while carrying, at their own ' +
      'line 6, a dated founder approval reading ACCEPTED, and the M1 gate closure recorded the ' +
      'founder accepting all three on that date; seventeen of seventeen gates passed over it ' +
      'because CI-06f reads numbers and never status and CI-06b validates frontmatter while an ' +
      'ADR carries its status in a heading',
    // A NEW ENTRY AT THE NEXT FREE NUMBER RATHER THAN AN EDIT TO AN EXISTING ONE.
    // The three real instances are repaired in the same commit range that wrote
    // this gate, so a seed that edited one of them would be a seed whose target
    // the next session can legitimately delete. `nextFreeAdr` is the same
    // derivation the CI-06n seed uses, and it keeps this falsifiable as the
    // registry grows.
    expect: (d) => `ADR-${nextFreeAdr(d)} heads itself \`status: proposed\``,
    seed: (d) => {
      const n = nextFreeAdr(d);
      writeFileSync(
        join(d, `docs/decisions/ADR-${n}.md`),
        `## ADR-${n}: an entry that contradicts itself  (2026-08-18, status: proposed)\n` +
          '- **' +
          // Assembled for RI-02's reason, the same one CI-06q's seed states: this
          // harness lives in the repository the gate scans, and a spelled-out
          // approval line here would make the harness its own finding.
          ['Found', 'er'].join('') +
          ' approval (2026-08-18): ' +
          ['ACCEP', 'TED'].join('') +
          '.** The signature is here and the heading still says proposed.\n',
      );
      // The entry needs its README row or CI-06n reports the seed instead, which
      // is a seed failing on a neighbour's finding and is the defect this
      // harness exists to refuse.
      edit(d, 'docs/decisions/README.md', (b) =>
        b.replace(
          /\n\n## Gate closures/,
          `\n| [ADR-${n}](ADR-${n}.md) | an entry that contradicts itself  (2026-08-18, status: proposed) |\n\n## Gate closures`,
        ),
      );
    },
  },
  'CI-06p': {
    what: 'a CI-06 letter claimed two past the last one, leaving the letters between it claimed by nobody',
    real:
      'three plan documents each stated which letters the other two were taking, which is ' +
      'one sequence hand-maintained in three places, and ADR-038 collided on the registry ' +
      'that already had a table',
    // The hole is at the FIRST free letter and the seed claims two past it, so
    // the reservation the seed writes is never the letter the finding names.
    // `expect` is resolved against the SEEDED tree, and a row claiming `free + 2`
    // does not move `free`, which is the CI-06l lesson applied before it bit.
    expect: (d) => `CI-06${nextFreeLetter(d)} is neither implemented nor reserved (a hole)`,
    seed: (d) => {
      const beyond = String.fromCharCode(nextFreeLetter(d).charCodeAt(0) + 2);
      edit(d, 'docs/decisions/ALLOCATION.md', (b) =>
        addLetterRow(b, beyond, 'a letter claimed two past the last one, which opens the hole'),
      );
    },
  },
  'CI-06k': {
    what: 'an endpoint in the negative-authz matrix with no required-factor cell',
    real:
      'C-27 is enforced by a server-side required-factor declaration per endpoint rather ' +
      'than by discipline, and a sensitive endpoint added later with nothing declared is ' +
      'the error a reading has to catch',
    // Assertion 1. The target is the first row that declares anything at all,
    // found by shape, so this survives any rewording of the matrix.
    expect: 'carries no required-factor cell drawn from the published vocabulary',
    seed: (d) =>
      editFactorCell(
        d,
        (c) => c.trim().length > 0,
        () => '',
      ),
  },
  'CI-06l': {
    what: 'a coverage row whose column cell stops naming a column, so the clock is dispositioned nowhere',
    real:
      'ADR-040 made the auto-release the load-bearing control of the whole enforcement ' +
      'window, and a clock with nothing scheduled to reach it is a bounded hold that ' +
      'becomes indefinite in silence. It fails no test, because there is no test a schema ' +
      'can fail by omission',
    // Assertion 1, and the target is DERIVED: whichever column the coverage
    // table happens to list first.
    //
    // THE SEED TAGS THE CELL RATHER THAN DELETING THE ROW, and that is not
    // squeamishness. `expect` is resolved after the seed, so a deleted row makes
    // the harness ask about the NEXT column while the gate correctly reports the
    // one that was deleted. Tagging leaves the row in place for the loose reader
    // to find, and it seeds the same violation: the gate's column reference is
    // ANCHORED, so a cell carrying prose beside the identifier is not a
    // disposition, and the column is then on neither list. That anchoring is
    // itself worth a test, because the alternative reading -- any cell
    // MENTIONING a column counts as covering it -- is how this gate would come
    // to pass on a table of commentary.
    expect: (d) => `${firstCoverageColumnLoose(d)}: an expiry column that names no release job`,
    seed: (d) => {
      const s = cronSection(d, CRON_COVERAGE_F);
      const row = s.rows[0];
      row.cells[0] = `${row.cells[0]} and see the note below`;
      s.lines[row.i] = `| ${row.cells.join(' | ')} |`;
      s.write(s.lines);
    },
  },
  'CI-06m': {
    what: 'a date column whose design-record row stops naming its unit',
    real:
      'the schema holds 49 `date` columns whose unit is not derivable from their type and only ' +
      'sometimes from their name. `published_statistics` carried `as_of_trading_day`, whose unit ' +
      'is in its name, beside `window_start_day`, whose design-record cell was EMPTY and whose ' +
      'unit lived only in M12, IN ONE TABLE. A sweep that reaches for the only calendar in the ' +
      'database gets the trading calendar, which is a different set of days, and the answer is ' +
      'wrong on roughly 104 days a year while reading as though somebody thought about it',
    // The target is DERIVED, like CI-06l's: whichever declared row the gate
    // happens to reach first. A seed naming `rule_states.trading_day` by literal
    // would go stale the day that column is superseded, and it would go stale
    // SILENTLY, because a row that no longer matches plants nothing.
    //
    // IT STRIPS THE UNIT TOKEN AND LEAVES THE PROSE, which is the realistic
    // shape of the defect: nobody deletes a Why cell, they reword it. The
    // vocabulary is closed precisely so a reworded cell stops declaring.
    expect: 'names no unit',
    seed: (d) => {
      const dir = join(d, 'docs/architecture/data-model');
      for (const f of readdirSync(dir).sort()) {
        if (!f.endsWith('.md')) continue;
        const p = join(dir, f);
        const lines = readFileSync(p, 'utf8').split('\n');
        const i = lines.findIndex((l) =>
          /\*\*Unit: (trading day|wall clock|rail clock)\*\*/.test(l),
        );
        if (i === -1) continue;
        lines[i] = lines[i].replace(
          /\*\*Unit: (?:trading day|wall clock|rail clock)\*\*,?/,
          'It records',
        );
        writeFileSync(p, lines.join('\n'));
        return;
      }
      throw new Error('seed anchor not found: no design-record row declares a unit');
    },
  },
  'ADR-026': {
    what: 'a delta cited in docs with no manifest row',
    real: 'the delta tally was wrong on the day it was written, and U-06 was uncounted',
    expect: 'SD-M9-99',
    seed: (d) => edit(d, 'docs/STATE.md', (b) => b + '\nSD-M9-99 is folded.\n'),
  },
};

// =============================================================================
// SCOPE CASES: a gate asserted to be correctly SCOPED, not merely quieter
// =============================================================================
// A SEEDS entry proves a gate CAN fail. It cannot prove the gate reads the
// right set of files, and OQ-P1-04 was exactly that defect: CI-06b's document
// set was one directory wider than CI-06c's, and the two agreed only because
// `packages/` had held one markdown file since it existed.
//
// The ruling narrowed CI-06b. A narrowing tested only from the quiet side is
// indistinguishable from a gate switched off, so every case below states ONE
// direction of a boundary and no boundary appears here in one direction only.
//
// `expect` is either the literal 'PASS' (the gate must not read this file at
// all) or a substring the gate's finding must contain. Same discipline as
// SEEDS: "it exited non-zero" is not evidence.
//
// TARGETED RATHER THAN EXHAUSTIVE, deliberately, and unlike SEEDS there is no
// completeness check over it. A scope case exists where a boundary has actually
// been argued about. Inventing one per gate would fill this file with cases
// nobody chose, which is the opposite of the point.
/**
 * One ADR entry heading itself `proposed`, with or without an accepting verdict.
 *
 * Shared by the CI-06r scope case and its control so the two files differ in
 * EXACTLY the approval line and nothing else. Writing them separately is how a
 * control ends up firing on an unrelated difference, which is a control that
 * proves the seed rather than the boundary.
 */
function seedProposedAdr(d, withApproval) {
  const n = nextFreeAdr(d);
  const approval =
    '- **' +
    ['Found', 'er'].join('') +
    ' approval (2026-08-18): ' +
    ['ACCEP', 'TED'].join('') +
    '.**\n';
  writeFileSync(
    join(d, `docs/decisions/ADR-${n}.md`),
    `## ADR-${n}: an entry awaiting a signature  (2026-08-18, status: proposed)\n` +
      '- Context: nobody has ruled on this yet, which is what `proposed` says.\n' +
      (withApproval ? approval : ''),
  );
  edit(d, 'docs/decisions/README.md', (b) =>
    b.replace(
      /\n\n## Gate closures/,
      `\n| [ADR-${n}](ADR-${n}.md) | an entry awaiting a signature  (2026-08-18, status: proposed) |\n\n## Gate closures`,
    ),
  );
}

const SCOPE_CASES = [
  {
    name: 'CI-06b/out',
    gate: 'CI-06b',
    what: 'a package README with no frontmatter, which must NOT be a finding',
    expect: 'PASS',
    seed: (d) => {
      mkdirSync(join(d, 'packages/rules-engine'), { recursive: true });
      writeFileSync(
        join(d, 'packages/rules-engine/README.md'),
        '# rules-engine\n\nA source file that happens to be markdown. No frontmatter, on purpose.\n',
      );
    },
  },
  {
    name: 'CI-06b/in',
    gate: 'CI-06b',
    what: 'a document under docs/ with no frontmatter, which MUST be a finding',
    expect: 'docs/PROBE_NO_FRONTMATTER.md: no frontmatter block',
    seed: (d) =>
      writeFileSync(
        join(d, 'docs/PROBE_NO_FRONTMATTER.md'),
        '# Probe\n\nA corpus document with no frontmatter block.\n',
      ),
  },
  {
    // The first fold of OQ-P1-04 put docs/INDEX.md inside the shared
    // predicate's exclusion, which was CI-06c's rule (a list cannot contain
    // itself) applied to the wrong question. INDEX's own frontmatter was then
    // checked by nothing: `status: nearly` would have passed every gate.
    // INDEX is a corpus document; only CI-06c has a reason to skip it.
    name: 'CI-06b/index',
    gate: 'CI-06b',
    what: "INDEX's own frontmatter is checked, which the first fold silently lost",
    expect: 'docs/INDEX.md: status "nearly" is not one of draft | review | approved | frozen',
    seed: (d) => {
      const f = join(d, 'docs/INDEX.md');
      writeFileSync(f, readFileSync(f, 'utf8').replace(/^status: .*$/m, 'status: nearly'));
    },
  },
  // ---------------------------------------------------------------------------
  // ADR-036, the migration allocation table. Both directions, and the pair is
  // the point: the reservation semantics make the gate QUIETER on one input and
  // LOUDER on another, and a change that only ever makes a gate quieter is
  // indistinguishable from switching it off.
  //
  // The SEEDS entry above proves CI-06h still reports an unreserved hole. It
  // cannot prove that a RESERVED hole passes, nor that an unclaimed number on
  // disk fails, without planting each case itself.
  //
  // BOTH CASES ARE PINNED TO A LITERAL AND BOTH MOVED ON 2026-08-15. They read
  // 0029 while the table reserved nothing and every number on disk was claimed.
  // ADR-039 to ADR-042 reserved 0029 through 0032, which made the reserved case
  // insert a SECOND row for a number already reserved (a pass that asserts
  // nothing) and made the unallocated case write a file the table now claims (a
  // finding that no longer fires). One had gone vacuous and one had gone silent,
  // and only the silent one announced itself. 0033 is the first free number.
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // ADR-043's boundary: an ENTRY is a fragment, a README is a document.
  // ---------------------------------------------------------------------------
  // The split moved 48 files into docs/decisions/ and exempted them from CI-06b
  // and CI-06c. An exemption tested only from the quiet side is indistinguishable
  // from a gate switched off, which is the same argument OQ-P1-04 settled for
  // CI-06b's document set, so both directions are asserted here.
  {
    name: 'CI-06b/entry-out',
    gate: 'CI-06b',
    what: 'an ADR entry file with no frontmatter, which must NOT be a finding',
    expect: 'PASS',
    // The control is the other side of the same line: a NON-entry file in the very
    // same directory must still be checked. Without it, a predicate that
    // accidentally matched all of docs/decisions/ would pass this case silently
    // and take ALLOCATION.md and the README out of every gate with it.
    control: {
      expect: 'docs/decisions/PROBE_NOT_AN_ENTRY.md: no frontmatter block',
      seed: (d) =>
        writeFileSync(
          join(d, 'docs/decisions/PROBE_NOT_AN_ENTRY.md'),
          '# Probe\n\nIn the registry directory, but not an entry. Still a corpus document.\n',
        ),
    },
    seed: (d) =>
      writeFileSync(
        join(d, 'docs/decisions/ADR-D2.md'),
        '## ADR-D2: probe  (2026-08-15, status: proposed)\n\nAn entry. No frontmatter, on purpose.\n',
      ),
  },
  // ---------------------------------------------------------------------------
  // CI-06k. THE GATE HAS THREE ASSERTIONS AND SEEDS CARRY ONE EACH.
  //
  // `SEEDS` holds exactly one violation per gate, so a gate asserting three
  // things is watched failing on one of them and taken on trust for the other
  // two. That is the shape this whole harness exists to refuse. The seeded
  // violation covers assertion 1; the two cases below cover assertions 2 and 3,
  // and assertion 2 is asserted in BOTH directions because it is a partition
  // rather than a rule: `session` on a read surface is correct and `session` on a
  // sensitive action is the SIM-swap hole, and a gate that cannot tell them apart
  // is either useless or refuses everything.
  // ---------------------------------------------------------------------------
  {
    name: 'CI-06k/single-factor-read',
    gate: 'CI-06k',
    what: 'a READ surface declaring a single factor, which must NOT be a finding',
    expect: 'PASS',
    // The control is the same token on the other side of the line. Without it,
    // a gate that had simply stopped reading the matrix would pass this case and
    // report nothing, which is a vacuous PASS of exactly the kind the CI-06h
    // reserved case was rewritten to stop producing.
    control: {
      expect: 'is a single factor',
      seed: (d) =>
        editFactorCell(
          d,
          (c) => /C-27:/.test(c),
          // The C-27 tag is PRESERVED and only the factor is downgraded. Replacing
          // the whole cell would untag the row, assertion 2 would report the action
          // as missing instead, and the case would fail off-target while looking
          // like it worked.
          (c) => `\`session\` ${/\(C-27:[^)]*\)/.exec(c)[0]}`,
        ),
    },
    seed: (d) => {
      const m = authzMatrix(d);
      const row =
        '| A probe read surface reached by a session established with one factor | `session` | 200 |';
      m.lines.splice(m.headerAt + 2, 0, row);
      writeFileSync(join(d, AUTHZ_DOC), m.replace(m.lines.join('\n')));
    },
  },
  {
    name: 'CI-06k/exempt-class',
    gate: 'CI-06k',
    what: 'a notification class outside security and money made rate-limit exempt, which MUST be a finding',
    // Assertion 3, and this is amendment 2's whole content: INV-M16-11 exempts
    // the post-identity security and money classes, and the same exemption
    // applied to an attacker-supplied destination funds SMS pumping. The class is
    // read from the migration at seed time rather than named here.
    expect: (d) => {
      const { body } = exemptionSite(d);
      return `rate_limit_exempt is generated over "${nonExemptClass(body)}"`;
    },
    // The quiet direction is the CLEAN TREE run at the top of this harness, where
    // the expression names security and money and the gate must pass. It is not
    // repeated as a case here because it is already asserted, on every run,
    // against the real corpus rather than against a seeded copy of it.
    seed: (d) => {
      const { f, body } = exemptionSite(d);
      const cls = nonExemptClass(body);
      const next = body.replace(
        /(ADD\s+COLUMN\s+rate_limit_exempt\s+boolean\s+GENERATED\s+ALWAYS\s+AS\s*\(\s*\n?\s*class\s+IN\s*\()([^)]*)\)/i,
        (_, head, list) => `${head}${list.trimEnd()}, '${cls}')`,
      );
      if (next === body) throw new Error('seed anchor not found: the rate_limit_exempt class list');
      writeFileSync(join(d, `packages/db/migrations/${f}`), next);
    },
  },
  // ---------------------------------------------------------------------------
  // CI-06l. FOUR ASSERTIONS, AND SEEDS CARRIES ONE.
  //
  // Same arithmetic as CI-06k one gate over: `SEEDS` holds one violation per
  // gate, so three of this gate's four assertions would be taken on trust. The
  // seeded violation covers the uncovered column; the three cases below cover
  // the exemption list being READ, the stale entry, and the phantom job.
  //
  // The stale-entry case is the one worth having. Assertion 1 alone reports a
  // tree with a renamed column and a leftover row as CLEAN: the list still names
  // something, so nothing looks missing, and the column under its new spelling
  // is covered by nothing. That is the NO-FLOATS list's own stated second
  // direction, and an allowlist only ever decays that way.
  // ---------------------------------------------------------------------------
  {
    name: 'CI-06l/exempt',
    gate: 'CI-06l',
    what: 'a column moved from the coverage table to the written exemption list, which must NOT be a finding',
    expect: 'PASS',
    // The control is the SAME move with the reason left blank. A `PASS` case
    // proves nothing unless the near-identical tree fails, and pairing it this
    // way tests two things at once: that the exemption list is read at all, and
    // that an exemption nobody defended is not an exemption. Seeding the control
    // as "move it and write no exemption row" would only have re-run the SEEDS
    // violation in a second tree.
    control: {
      // Resolved after the seed, where the column now sits at the top of the
      // exemption list, which is where the seed put it.
      expect: (d) => `${firstExemptColumn(d)}: on the exemption list with no reason`,
      seed: (d) => {
        const col = firstCoveredColumn(d);
        const s = cronSection(d, CRON_COVERAGE_F);
        s.lines.splice(s.rows[0].i, 1);
        s.write(s.lines);
        const e = cronSection(d, CRON_EXEMPT_F);
        e.lines.splice(e.rows[0].i, 0, `| \`${col}\` | |`);
        e.write(e.lines);
      },
    },
    seed: (d) => {
      const col = firstCoveredColumn(d);
      const s = cronSection(d, CRON_COVERAGE_F);
      s.lines.splice(s.rows[0].i, 1);
      s.write(s.lines);
      const e = cronSection(d, CRON_EXEMPT_F);
      e.lines.splice(
        e.rows[0].i,
        0,
        `| \`${col}\` | A probe exemption, and this cell is its reason. |`,
      );
      e.write(e.lines);
    },
  },
  {
    // ---------------------------------------------------------------------
    // THE ASSERTION ALREADY EXISTS. THE PARSER MADE IT UNREACHABLE.
    // ---------------------------------------------------------------------
    // CI-06f has carried `if (seen.has(n)) findings.push("ADR-nnn appears more
    // than once")` since it was written. It had never once been able to fire,
    // because `adrEntries()` read each file with a NON-GLOBAL `exec` and
    // returned AT MOST ONE entry per file: two headings in one file produced
    // one entry, and `seen` never collided.
    //
    // So `docs/decisions/ADR-046.md` carried TWO `## ADR-046` headings for two
    // unrelated rulings and every gate passed. This case is the seed that was
    // written BEFORE the parser was tightened and watched NOT firing, which is
    // the order the founder ruled: tightening a parser without one is how 109
    // phantom anchors happened.
    //
    // DERIVED, not pinned. It duplicates whatever the LAST numbered entry is,
    // so it cannot go stale against a registry that grows, and it appends to a
    // file that already exists rather than inventing a number the allocation
    // table would then flag instead (which would make this case pass for
    // CI-06f's OTHER assertion and prove nothing about duplicates).
    name: 'CI-06f/duplicate-heading',
    gate: 'CI-06f',
    what: 'two headings for one ADR number in one file, which MUST be a finding',
    expect: (d) => `ADR-${lastAdrId(d)} appears more than once`,
    seed: (d) => {
      const id = lastAdrId(d);
      const f = join(d, `docs/decisions/ADR-${id}.md`);
      writeFileSync(
        f,
        readFileSync(f, 'utf8') +
          `\n## ADR-${id}: a second ruling under the same number  (2026-08-16, status: accepted)\n`,
      );
    },
  },
  {
    name: 'CI-06l/stale-entry',
    gate: 'CI-06l',
    what: 'an exemption for a column no migration declares, which MUST be a finding',
    // Derived from a real entry's table, so the probe name moves with the
    // corpus and can never accidentally become a column somebody declares.
    expect: (d) =>
      `the exemption list names ${firstExemptColumn(d).split('.')[0]}.probe_renamed_expires_at`,
    seed: (d) => {
      const table = firstExemptColumn(d).split('.')[0];
      const e = cronSection(d, CRON_EXEMPT_F);
      e.lines.splice(
        e.rows[0].i,
        0,
        `| \`${table}.probe_renamed_expires_at\` | A row left behind by a rename. |`,
      );
      e.write(e.lines);
    },
  },
  {
    name: 'CI-06l/unknown-job',
    gate: 'CI-06l',
    what: 'a coverage row naming a release job the scheduled table does not carry, which MUST be a finding',
    // Assertion 4. "A job in this table without a dead-man switch is a job that
    // does not exist", and a coverage row citing a job with no row at all is the
    // original failure wearing the fix's clothing: the column looks dispositioned
    // and nothing is scheduled to reach it.
    expect: (d) => `${firstCoveredColumn(d)}: its coverage row names the release job`,
    seed: (d) => {
      const s = cronSection(d, CRON_COVERAGE_F);
      const row = s.rows[0];
      // The real job name plus a suffix, so the probe moves with whatever that
      // job is called and stays a job nobody scheduled.
      row.cells[1] = `${row.cells[1]} probe`;
      s.lines[row.i] = `| ${row.cells.join(' | ')} |`;
      s.write(s.lines);
    },
  },
  {
    name: 'CI-06d/unowned-scenario',
    gate: 'CI-06d',
    what: 'a scenario dropped from the ownership partition, which MUST be a finding',
    // THE DRIFT THIS ACTUALLY CAUGHT, kept as a case so it cannot recur. The
    // partition read 257 against a registry of 284 for as long as GS-258 to
    // GS-284 existed, and section 33.1 went on calling itself a partition while
    // twenty-seven scenarios were owned by nobody. Its own paragraph claimed the
    // sum agreed "or the build fails" and NO CHECK EXISTED.
    //
    // The target is DERIVED: whichever scenario the LAST owner row happens to
    // claim last, so a seed pinned to a number cannot go stale the way the two
    // pinned to `0029` did.
    expect: 'is in the registry and owned by nobody',
    seed: (d) => {
      const p = join(d, OWNERSHIP_DOC);
      const lines = readFileSync(p, 'utf8').split('\n');
      const cut = lines.findIndex((l) => l.startsWith('### 33.2'));
      let last = -1;
      for (let i = 0; i < (cut === -1 ? lines.length : cut); i++) {
        if (/^\|\s*\*\*.+?\*\*\s*\|\s*.*GS-\d{3}.*\|\s*\d+\s*\|$/.test(lines[i].trim())) last = i;
      }
      if (last === -1) throw new Error('seed anchor not found: no owner row in section 33.1');
      const cells = lines[last].trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
      const parts = cells[1].split(',');
      parts.pop();
      cells[1] = ` ${parts.join(',').trim()} `;
      // The declared count drops with it, so this seeds the UNOWNED direction
      // rather than tripping the declared-count assertion instead.
      cells[2] = ` ${Number(cells[2].trim()) - 1} `;
      lines[last] = `|${cells.join('|')}|`;
      writeFileSync(p, lines.join('\n'));
    },
  },
  {
    name: 'CI-06r/proposed-with-no-approval-line-is-not-a-finding',
    gate: 'CI-06r',
    what: 'an ADR legitimately awaiting signature: heading `proposed`, and NO approval line at all',
    expect: 'PASS',
    // THE BOUNDARY IS AT `contradicts itself`, NOT AT `is unsigned`, and this is
    // the direction that says so. Five entries head themselves proposed today
    // with no accepting verdict in the body -- ADR-001, ADR-033, ADR-036,
    // ADR-056 and ADR-058 -- and every one is an honest record of a ruling
    // nobody has made. The unsigned-ADR audit recommends a SPLIT rather than a
    // batch signature, which is the founder's to make and not a gate's.
    //
    // A gate that flagged them would be demanding signatures rather than
    // reporting contradictions, and it would go red on arrival on five files
    // whose only repair is a decision. The control fires on the same file with
    // the approval line added, which is the one edit that turns an honest
    // `proposed` into a contradiction.
    control: {
      expect: (d) => `ADR-${nextFreeAdr(d)} heads itself \`status: proposed\``,
      seed: (d) => seedProposedAdr(d, true),
    },
    seed: (d) => seedProposedAdr(d, false),
  },
  {
    name: 'CI-06q/undated-is-not-a-citation',
    gate: 'CI-06q',
    what: 'a reference to a founder ruling carrying NO date, which must NOT be a finding',
    expect: 'PASS',
    // THE BOUNDARY IS AT `dated`, NOT AT `mentions a ruling`, and this is the
    // direction that says so. This corpus talks about rulings constantly --
    // "this is a founder item rather than an engineering one", "it needs a
    // ruling" -- and 158 such mentions exist against 59 dated citations. A gate
    // that flagged all of them would be unusable and would be switched off in a
    // week, so the undated form is OUT OF SCOPE BY DESIGN.
    //
    // It is also the blind spot, and the two facts are the same fact: an
    // authority cited in words rather than by date cannot be resolved against a
    // registry, so the gate claims nothing about it. `covers` says so, and this
    // case is what stops that claim from being quietly widened later.
    control: {
      expect: 'cites a ruling dated 2019-01-03',
      seed: (d) =>
        edit(
          d,
          'docs/GLOSSARY.md',
          (b) =>
            `${b}\n<!-- control -->\nDecided by a ` +
            ['found', 'er'].join('') +
            ' ' +
            ['rul', 'ing'].join('') +
            ' on 2019-01-03, and nothing records it.\n',
        ),
    },
    seed: (d) =>
      edit(
        d,
        'docs/GLOSSARY.md',
        (b) =>
          `${b}\n<!-- seeded -->\nThe cap was raised by a ` +
          ['found', 'er'].join('') +
          ' ' +
          ['rul', 'ing'].join('') +
          ' last Tuesday, and nothing records it.\n',
      ),
  },
  {
    name: 'CI-06m/small-is-not-empty',
    gate: 'CI-06m',
    what: 'a fixture cut to a single session, which is small and legitimate and must NOT be a finding',
    // THE CONTROL FOR THE TWO CASES BELOW, and it is the one that keeps the
    // vacuity check honest. `sessions.length === 0` is rejected because an
    // empty array skips every assertion after it; SMALL is not the same
    // property and must stay legal, because `cme-2026.json` is deliberately
    // five sessions and `status: partial` says so.
    //
    // Without this direction the gate could be "hardened" into requiring a full
    // year, every seeded case above would still fire, and the harness would
    // report success while the fixture that actually exists had become illegal.
    // That is the failure mode falsify.mjs's own header names: a narrowing
    // tested only from the noisy side.
    //
    // THE CONTROL IS THE SAME EDIT CUT ONE FURTHER, to zero. Without it this
    // case is decoration: a gate that had simply stopped reading the fixture
    // directory would report PASS here and the harness would score it as
    // evidence. The two together say the boundary is at EMPTY and not at SMALL,
    // which is the only reading that leaves `cme-2026.json` legal.
    control: {
      expect: 'declares zero sessions',
      seed: (d) => {
        const dir = join(d, 'packages/rules-engine/fixtures/calendars');
        const file = readdirSync(dir)
          .filter((f) => f.endsWith('.json'))
          .sort()[0];
        if (!file) throw new Error('seed anchor not found: no calendar fixture');
        const p = join(dir, file);
        const fx = JSON.parse(readFileSync(p, 'utf8'));
        fx.sessions = [];
        fx.session_count = 0;
        writeFileSync(p, `${JSON.stringify(fx, null, 2)}\n`);
      },
    },
    expect: 'PASS',
    seed: (d) => {
      const dir = join(d, 'packages/rules-engine/fixtures/calendars');
      const file = readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()[0];
      if (!file) throw new Error('seed anchor not found: no calendar fixture');
      const p = join(dir, file);
      const fx = JSON.parse(readFileSync(p, 'utf8'));
      if (!Array.isArray(fx.sessions) || fx.sessions.length === 0) {
        throw new Error('seed anchor not found: the fixture declares no sessions to cut');
      }
      const first = fx.sessions[0];
      fx.sessions = [first];
      fx.session_count = 1;
      // Coverage narrows with it, so this stays a COHERENT small calendar
      // rather than one that trips the containment check for another reason.
      fx.coverage = { from: first.trading_day, to: first.trading_day };
      writeFileSync(p, `${JSON.stringify(fx, null, 2)}\n`);
    },
  },
  {
    name: 'CI-06m/vacuous-derivation',
    gate: 'CI-06m',
    what: 'a fixture emptied to zero sessions, which reproduces NOTHING and MUST be a finding',
    // THE THIRD DIRECTION, and it is here because the gate did not have it and
    // the hole was proven by execution rather than argued: the fixture was
    // emptied to `"sessions": []` with `"session_count": 0` and CI-06m REPORTED
    // PASS. Every check after the count is a loop, and every loop over an empty
    // array succeeds, so a derivation that reproduces nothing read exactly like
    // one that reproduces correctly.
    //
    // It is CI-06l/stale-entry's lesson in a different costume. That case
    // covers the direction an ALLOWLIST decays in; this covers the direction a
    // DERIVATION decays in. Both are the quiet direction, and both pass the
    // gate's headline assertion while asserting nothing.
    expect: 'declares zero sessions',
    seed: (d) => {
      const dir = join(d, 'packages/rules-engine/fixtures/calendars');
      const file = readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()[0];
      if (!file) throw new Error('seed anchor not found: no calendar fixture');
      const p = join(dir, file);
      const fx = JSON.parse(readFileSync(p, 'utf8'));
      // The count is emptied WITH the array, on purpose. Emptying only the array
      // would trip the declared-count check instead, and this case exists to
      // prove the gate catches the version where the file is internally
      // consistent and says nothing.
      fx.sessions = [];
      fx.session_count = 0;
      writeFileSync(p, `${JSON.stringify(fx, null, 2)}\n`);
    },
  },
  {
    name: 'CI-06m/phantom-generator',
    gate: 'CI-06m',
    what: 'a fixture claiming derivation from a generator that does not exist, which MUST be a finding',
    // CI-06l/unknown-job's assertion, one registry over. `generated_by` is the
    // one field separating a derived calendar from a typed one, so a citation
    // that resolves to nothing lets a hand-maintained file keep a provenance
    // line on top of it.
    expect: 'which does not exist',
    seed: (d) => {
      const dir = join(d, 'packages/rules-engine/fixtures/calendars');
      const file = readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()[0];
      if (!file) throw new Error('seed anchor not found: no calendar fixture');
      const p = join(dir, file);
      const fx = JSON.parse(readFileSync(p, 'utf8'));
      fx.generated_by = 'packages/db/src/seed/calendars/generate-that-moved.mjs';
      writeFileSync(p, `${JSON.stringify(fx, null, 2)}\n`);
    },
  },
  {
    name: 'CI-06h/reserved',
    gate: 'CI-06h',
    what: 'a hole a sibling branch has reserved, which must NOT be a finding',
    expect: 'PASS',
    // A CONTROL, BECAUSE A `PASS` CASE PROVES NOTHING ON ITS OWN. The old version
    // of this case inserted a reservation row and asserted the gate stayed quiet.
    // When the number it pinned to was reserved for real, the row became a
    // DUPLICATE of an existing reservation, the case went on passing, and it was
    // asserting nothing at all. Nothing announced that, because a vacuous PASS
    // and a real PASS are the same output.
    //
    // So the pair is run together: `control` seeds the SAME hole WITHOUT the
    // reservation and must produce the named finding. If the control goes quiet,
    // the hole is not a hole, the PASS below is vacuous, and the harness says so
    // instead of reporting green.
    control: {
      expect: (d) => `${nextFreeMigration(d)} is neither on disk nor reserved`,
      seed: (d) => {
        const n = String(Number(nextFreeMigration(d)) + 1).padStart(4, '0');
        writeFileSync(
          join(d, `packages/db/migrations/${n}_probe_opens_a_hole.sql`),
          '-- On disk above an unclaimed number, which is what makes the gap a hole.\n',
        );
        edit(d, 'docs/decisions/ALLOCATION.md', (b) =>
          addMigrationRow(b, n, 'the file above, so only the hole below it is at issue'),
        );
      },
    },
    seed: (d) => {
      const free = nextFreeMigration(d);
      const above = String(Number(free) + 1).padStart(4, '0');
      writeFileSync(
        join(d, `packages/db/migrations/${above}_probe_opens_a_hole.sql`),
        '-- Identical to the control tree.\n',
      );
      edit(d, 'docs/decisions/ALLOCATION.md', (b) => {
        const withAbove = addMigrationRow(b, above, 'the file above');
        // The only difference from the control: the hole is now reserved.
        return addMigrationRow(
          withAbove,
          free,
          'a sibling branch, unmerged. No file on disk here, which is the whole ' +
            'case: a branch cannot see its siblings',
        );
      });
    },
  },
  {
    name: 'CI-06h/unallocated',
    gate: 'CI-06h',
    what: 'a migration on disk that no allocation row claims, which MUST be a finding',
    // The first free number, so the file opens NO hole and the allocation finding
    // is the only one it can produce. That is what makes this a test of the
    // allocation half rather than of the contiguity half.
    expect: (d) => `${nextFreeMigration(d)} is not claimed by the migration allocation table`,
    seed: (d) =>
      writeFileSync(
        join(d, `packages/db/migrations/${nextFreeMigration(d)}_probe_unallocated.sql`),
        '-- A migration whose number came from `ls` rather than from the table.\n',
      ),
  },
  // ---------------------------------------------------------------------------
  // CI-06p. THE GATE HAS THREE ASSERTIONS AND THE SEED CARRIES ONE.
  //
  // CI-06k's precedent, two gates over: a gate asserting three things and
  // watched failing on one of them is taken on trust for the other two, and
  // "taken on trust" is the condition this harness exists to end. The seeded
  // violation covers assertion 3, the hole. These two cover assertions 1 and 2.
  //
  // THE QUIET DIRECTION IS THE CLEAN TREE RUN at the top of this harness, and it
  // is not decoration here: `o` is claimed by ADR-044 and no gate implements it,
  // so every clean run asserts that a letter a sibling branch reserved is a hole
  // that PASSES. That is `CI-06h/reserved`'s case, already planted in the corpus
  // rather than in a temporary directory, and duplicating it here would test the
  // same tree twice.
  // ---------------------------------------------------------------------------
  {
    name: 'CI-06p/duplicate-row',
    gate: 'CI-06p',
    what: "one letter heading two rows of STRATEGY's gate inventory, which MUST be a finding",
    // Assertion 1, and the letter is whichever one the inventory rows first.
    expect: (d) => `CI-06${strategyInventory(d).letter} heads more than one row`,
    seed: (d) => {
      const { lines, i, line } = strategyInventory(d);
      lines.splice(i + 1, 0, line);
      writeFileSync(join(d, STRATEGY_DOC_F), lines.join('\n'));
    },
  },
  {
    name: 'CI-06p/unclaimed-letter',
    gate: 'CI-06p',
    what: 'a gate in the runner whose letter no row of the table claims, which MUST be a finding',
    // Assertion 2, and it is the one that keeps the table from going vacuous:
    // gaplessness alone can never force a row, because a gate that exists in the
    // runner fills its own hole. Without this assertion the letters stay gapless
    // while the registry quietly stops being maintained.
    //
    // The target is the HIGHEST implemented letter, derived from the copy's own
    // gates.mjs, because that is the row a session most recently wrote and the
    // one a session is most likely to forget.
    expect: (d) => {
      const letters = implementedLettersIn(d);
      return `CI-06${letters[letters.length - 1]} is implemented in this runner and no row`;
    },
    seed: (d) => {
      const letters = implementedLettersIn(d);
      const letter = letters[letters.length - 1];
      const p = join(d, 'docs/decisions/ALLOCATION.md');
      const body = readFileSync(p, 'utf8');
      const kept = body.split('\n').filter((line) => {
        if (!line.startsWith('|')) return true;
        const m = LETTER_CELL.exec(line.split('|')[1] ?? '');
        return !(m && m[1] === letter && m[2] === undefined);
      });
      if (kept.length === body.split('\n').length) {
        throw new Error(`seed anchor not found: no row claiming \`${letter}\` on its own`);
      }
      writeFileSync(p, kept.join('\n'));
    },
  },
];

// =============================================================================
// LOADER CASES: CI-03's engine-independent halves, watched failing
// =============================================================================
// Same shape as everything above -- seed the copy, run the checker in the copy
// -- and it took one design decision in the checker to be possible at all.
// `copyTree` omits `node_modules`, so nothing needing vitest or a workspace
// resolution can run in a tree copy. `packages/golden-loader/check.mjs`
// therefore imports `./src/loader.ts` and `./src/compare.ts` directly and never
// the package barrel, which re-exports the one module importing the engine as a
// value. It needs relative modules only, so it runs where vitest cannot.
//
// THAT IS WHAT LETS A CASE SEED THE RULE AS WELL AS THE DATA. A seeded fixture
// proves the `L-nn` refusal fires. A seeded COMPARISON proves the stage would
// notice if the comparison stopped working, which no fixture can demonstrate
// while the polarity is inverted and every fixture is asserted to fail anyway.
//
// `expect` IS EITHER A SUBSTRING THE FINDING MUST CONTAIN OR THE LITERAL
// 'PASS', exactly as in SCOPE_CASES, and no boundary appears here in one
// direction only. A rule that refuses every fixture passes every violation case
// below and is useless.

/** The fixture the loader's own seeded-violation suite uses, for the same reason. */
const GS_011 =
  'packages/rules-engine/fixtures/GS-011-trailing-floor-ignores-the-intraday-high.yaml';

/** The comparison, which every money assertion this stage will ever make goes through. */
const COMPARE = 'packages/golden-loader/src/compare.ts';

/** ADR-048's derivation, which decides which direction each fixture is asserted in. */
const POLARITY = 'packages/golden-loader/src/polarity.ts';

const LOADER_CASES = [
  {
    name: 'L-13/cites-nothing',
    what: "a fixture whose `source:` cites no identifier at all, which is ADR-048's case 4",
    // THE VACUITY CASE, and the reason this rule is ADR-048's stated
    // prerequisite rather than its companion. "Every rule this fixture cites is
    // implemented" is trivially true of a fixture citing none, so without this
    // refusal such a fixture flips to `direct` against an engine that
    // implements nothing and fails for a reason with nothing to do with its
    // subject.
    expect: 'L-13 GS-011-trailing-floor-ignores-the-intraday-high.yaml: "source" cites no',
    seed: (d) => edit(d, GS_011, (b) => once(b, /^source: .*$/m, 'source: the floor')),
  },
  {
    name: 'L-13/unresolvable',
    what: 'a fixture citing a rule number M01 does not define',
    expect: 'cites R-99, which M01 does not define',
    seed: (d) => edit(d, GS_011, (b) => once(b, /^source: .*$/m, 'source: M01 R-99')),
  },
  {
    name: 'L-13/out-neighbouring-identifiers',
    what: 'a source naming ADR, RE-U and GS identifiers beside its rules, which must NOT be a finding',
    // THE DIRECTION A NARROWED RULE GOES QUIET IN. `ADR-048` contains `R-04`
    // and `RE-U-019` contains `R-01` as substrings, and neither is a citation.
    // A rule matching them would resolve citations nobody made; a rule that
    // then tightened to compensate would start refusing real fixtures. The
    // boundary is the word break, and this asserts it from the permissive side.
    expect: 'PASS',
    seed: (d) =>
      edit(d, GS_011, (b) =>
        once(b, /^source: .*$/m, 'source: M01 R-13, R-18, per ADR-048 and RE-U-019, see GS-011'),
      ),
  },
  {
    name: 'L-13/out-invariant-only',
    what: 'a source citing only an INV-nn, which P2 section 2 permits and must NOT be a finding',
    // P2 section 2 rules the citation as "at least one `R-nn`, `CV-nn` or
    // `INV-nn` that exists in M01", three prefixes rather than one. A rule
    // narrowed to `R-nn` would be quieter, would pass both violation cases
    // above, and would refuse a fixture the plan explicitly allows.
    expect: 'PASS',
    seed: (d) => edit(d, GS_011, (b) => once(b, /^source: .*$/m, 'source: M01 INV-06')),
  },
  {
    name: 'compare/bigint-boundary',
    what: 'the end-state comparison reverted to Object.is across the bigint boundary',
    // THE MUTANT IS THE CODE THIS REPOSITORY SHIPPED UNTIL TODAY, which is what
    // makes it worth seeding rather than a hypothetical. INV-02 makes every
    // money field the engine returns a `bigint` and JSON has no literal for
    // one, so `Object.is(4770000n, 4770000)` is false and EVERY money field of
    // EVERY fixture reported a diff it should not have.
    //
    // IT IS INVISIBLE FROM THE FIXTURES AND STAYS INVISIBLE UNTIL THE POLARITY
    // FLIPS, which is why this case seeds source rather than data: under
    // inversion a fixture that must FAIL fails, so a comparison that cannot
    // agree with anything is indistinguishable from one that works. No seeded
    // fixture can tell those apart. A seeded comparison can.
    expect: 'must agree when a bigint result states the same cents as an integer expectation',
    seed: (d) =>
      edit(d, COMPARE, (b) =>
        once(
          b,
          'if (bigintAgrees(got, wanted)) continue;',
          'if (Object.is(got, wanted)) continue;',
        ),
      ),
  },
  {
    name: 'compare/over-agreement',
    what: 'a bigint comparison that agrees with everything, which is the direction the fix could go wrong in',
    // THE CASE ABOVE ONLY PROVES THE COMPARISON CAN AGREE. A comparison that
    // agrees with everything also passes it, and would be far worse than the
    // defect being fixed: the old code could never assert a cent, and this one
    // would assert every cent was right. Money moves in the second direction.
    expect: 'must disagree on one cent below, across the type boundary',
    seed: (d) =>
      edit(d, COMPARE, (b) =>
        once(
          b,
          'return Number.isSafeInteger(expected) && actual === BigInt(expected);',
          'return true;',
        ),
      ),
  },
  {
    name: 'polarity/vacuous-empty-citation',
    what: "a citation naming no rule read as `direct`, which is ADR-048's case 4",
    // THE ONE ADR-048 CALLS "THE DANGEROUS ONE". "Every rule this fixture cites
    // is implemented" is vacuously true of a fixture citing none, so reading
    // that as `direct` asserts a match against a fold that computes nothing,
    // and the fixture then fails for a reason with nothing to do with its
    // subject. L-13 closes the half where a fixture cites nothing M01 defines;
    // this closes the half where it cites only a CV-nn or an INV-nn, which
    // P2 section 2 permits and which names no rule.
    expect: 'must never derive direct from a citation naming no rule at all',
    seed: (d) =>
      edit(d, POLARITY, (b) =>
        once(
          b,
          "      polarity: 'inverted',\n      cited,\n      undeclared: [],",
          "      polarity: 'direct',\n      cited,\n      undeclared: [],",
        ),
      ),
  },
  {
    name: 'polarity/declaration-ignored',
    what: 'the derivation reading an undeclared rule as implemented',
    // ADR-048's failure mode 2 from the loader's side: a fixture whose rules
    // the engine has NOT declared must stay `inverted`, because under inversion
    // a match is the failure condition. A derivation that ignores the declared
    // set flips every fixture at once, which is exactly the all-or-nothing
    // behaviour the ruling exists to replace.
    expect: 'must derive inverted when one cited rule is undeclared',
    seed: (d) =>
      edit(d, POLARITY, (b) =>
        once(
          b,
          'const undeclared = cited.filter((id) => !declared.has(id));',
          'const undeclared = [];',
        ),
      ),
  },
  {
    name: 'polarity/out-undeclared-rule-still-loads',
    what: 'a fixture citing a rule the engine has not declared, which must LOAD and derive inverted',
    // THE BOUNDARY BETWEEN L-13 AND THE DERIVATION, asserted from the side
    // where nothing may be refused. `R-32` is defined in M01 and is not in the
    // engine's declared set, so it is a resolvable citation of an unimplemented
    // rule: L-13 must accept it and the derivation must read it as `inverted`.
    // A loader that refused it would make "the fixture exists, and FAILS,
    // before the function does" impossible to write down, which is TR-02.
    expect: 'PASS',
    seed: (d) => edit(d, GS_011, (b) => once(b, /^source: .*$/m, 'source: M01 R-13, R-32')),
  },
  {
    name: 'compare/safe-integer-guard',
    what: 'the guard removed, so a fractional expectation reaches BigInt() and throws',
    // `BigInt(4770000.5)` THROWS A RangeError. Without the guard a fixture
    // stating half a cent takes the whole stage down with an exception instead
    // of producing a finding, and an exception is not a diff: nothing names the
    // field, and CI-03 reports a crash where it should report a fixture defect.
    expect: 'threw RangeError',
    seed: (d) =>
      edit(d, COMPARE, (b) =>
        once(
          b,
          'return Number.isSafeInteger(expected) && actual === BigInt(expected);',
          'return actual === BigInt(expected);',
        ),
      ),
  },
];

// `expect` may be a string or a function of the seeded tree, because a seed that
// derives its identifier cannot name its own finding in advance.
const resolveExpect = (e, dir) => (typeof e === 'function' ? e(dir) : e);

// SEEDING IS THE STEP THAT GOES STALE, so a throw from it is reported as its own
// outcome rather than crashing the run or, worse, being caught and treated as an
// ordinary failure. `seed anchor not found` means the harness no longer describes
// the corpus, which is a harness problem and reads nothing like a gate problem.
function trySeed(fn, dir) {
  try {
    fn(dir);
    return null;
  } catch (err) {
    return err.message;
  }
}

function gateIds() {
  const out = execFileSync('node', [join(ROOT, 'scripts/corpus/gates.mjs'), 'list'], {
    encoding: 'utf8',
  });
  return [...out.matchAll(/^(\S+)\s\s/gm)].map((m) => m[1]);
}

// EVERYTHING except .git and node_modules. Copying a named subset left .claude/
// out on the first run, and CI-06a and CI-06c then "failed" on links into a
// directory the harness had not copied. A harness that tests a tree the gates
// never see is testing the harness.
//
// `node_modules` IS SKIPPED AT EVERY DEPTH AND NOT ONLY AT THE ROOT, and the
// difference was a false green. This loop skipped the two names among ROOT's own
// entries, so pnpm's NESTED `packages/*/node_modules` were copied with their
// packages; a module reachable from `packages/golden-loader/src/loader.ts` could
// then resolve `@merit/rules-engine` through one, and the loader cases passed
// locally. On a CI runner that had not installed, the same cases failed with
// ERR_MODULE_NOT_FOUND.
//
// `check.mjs` states the invariant those cases rest on -- it "imports
// ./src/loader.ts ... directly and never ./src/index.ts", so the tree copy can
// have no workspace resolution at all -- and the copy step was quietly making
// the invariant untestable on the machine where it is written. A harness that is
// green locally and red in CI teaches its reader to distrust CI, which is the
// more expensive of the two failures.
const skipCopy = (entry) => entry === '.git' || entry === 'node_modules';

function copyTree(dir) {
  for (const entry of readdirSync(ROOT)) {
    if (skipCopy(entry)) continue;
    cpSync(join(ROOT, entry), join(dir, entry), {
      recursive: true,
      filter: (src) => !skipCopy(basename(src)),
    });
  }
}

const indentAll = (text) =>
  text
    .split('\n')
    .map((l) => `        ${l}`)
    .join('\n');

/**
 * Run CI-03's engine-independent halves IN THE COPY, exactly as `runGate` runs
 * a gate in the copy.
 *
 * `packages/golden-loader/check.mjs` imports `./src/loader.ts` and
 * `./src/compare.ts` directly and never the package barrel, so it needs no
 * workspace resolution and runs in a tree the copy step gave no `node_modules`.
 * That is what lets a loader case seed the RULE as well as the DATA: a seeded
 * fixture proves the rule fires, and a seeded comparison proves the comparison
 * is the thing being relied on.
 */
function runLoaderCheck(dir) {
  try {
    const stdout = execFileSync('node', [join(dir, 'packages/golden-loader/check.mjs')], {
      encoding: 'utf8',
    });
    return { pass: true, stdout };
  } catch (err) {
    return { pass: false, stdout: (err.stdout ?? '') + (err.stderr ?? '') };
  }
}

function runGate(dir, id) {
  try {
    const stdout = execFileSync('node', [join(dir, 'scripts/corpus/gates.mjs'), 'check', id], {
      encoding: 'utf8',
    });
    return { pass: true, stdout };
  } catch (err) {
    return { pass: false, stdout: (err.stdout ?? '') + (err.stderr ?? '') };
  }
}

function main() {
  const ids = gateIds();
  const missing = ids.filter((id) => !SEEDS[id]);
  if (missing.length) {
    // A NEW GATE WITH NO SEEDED VIOLATION IS THE FAILURE THIS FILE EXISTS TO
    // CATCH. It is an error, never a skip.
    console.error(`No seeded violation for: ${missing.join(', ')}. Add one to SEEDS.`);
    return 2;
  }

  console.log('CLEAN TREE: every gate must PASS\n');
  let bad = 0;
  for (const id of ids) {
    const { pass, stdout } = runGate(ROOT, id);
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${id}`);
    if (!pass) {
      bad++;
      console.log(
        stdout
          .split('\n')
          .map((l) => `        ${l}`)
          .join('\n'),
      );
    }
  }

  console.log('\nSEEDED TREE: each gate must FAIL on one violation aimed at it\n');
  for (const id of ids) {
    const dir = mkdtempSync(join(tmpdir(), 'merit-falsify-'));
    try {
      copyTree(dir);
      const stale = trySeed(SEEDS[id].seed, dir);
      if (stale) {
        bad++;
        console.log(`  SEED IS STALE       ${id}  <- seeded: ${SEEDS[id].what}`);
        console.log(`        ${stale}`);
        console.log('        The harness no longer describes the corpus. Fix the seed.');
        continue;
      }
      const expect = resolveExpect(SEEDS[id].expect, dir);
      const { pass, stdout } = runGate(dir, id);
      const findings = stdout
        .split('\n')
        .filter((l) => l.startsWith('       '))
        .map((l) => l.trim());
      const onTarget = findings.some((f) => f.includes(expect));
      if (pass) {
        bad++;
        console.log(`  DID NOT FAIL        ${id}  <- seeded: ${SEEDS[id].what}`);
        console.log(`        The gate reported PASS on a tree that violates it.`);
      } else if (!onTarget) {
        bad++;
        console.log(`  FAILED OFF-TARGET   ${id}  <- seeded: ${SEEDS[id].what}`);
        console.log(`        Expected a finding containing "${expect}". Got:`);
        for (const f of findings.slice(0, 3)) console.log(`          ${f.slice(0, 140)}`);
      } else {
        console.log(`  failed as required  ${id}  <- ${SEEDS[id].what}`);
        console.log(`        ${findings.find((f) => f.includes(expect)).slice(0, 150)}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log('\nSCOPE: each case asserts ONE direction of a gate boundary\n');
  for (const c of SCOPE_CASES) {
    const dir = mkdtempSync(join(tmpdir(), 'merit-scope-'));
    try {
      copyTree(dir);
      // THE CONTROL RUNS FIRST AND IN ITS OWN TREE. A `PASS` case only means
      // something if the same situation WITHOUT the exempting condition fails, so
      // a control that goes quiet turns the case below from evidence into
      // decoration, and that is reported here rather than discovered later.
      if (c.control) {
        const cdir = mkdtempSync(join(tmpdir(), 'merit-control-'));
        try {
          copyTree(cdir);
          const cstale = trySeed(c.control.seed, cdir);
          const cexpect = cstale ? null : resolveExpect(c.control.expect, cdir);
          const r = cstale ? null : runGate(cdir, c.gate);
          const cf = r
            ? r.stdout
                .split('\n')
                .filter((l) => l.startsWith('       '))
                .map((l) => l.trim())
            : [];
          if (cstale || r.pass || !cf.some((f) => f.includes(cexpect))) {
            bad++;
            console.log(`  CONTROL DID NOT FIRE  ${c.name}  <- ${c.what}`);
            console.log(
              cstale
                ? `        seeding the control failed: ${cstale}`
                : `        Without the exemption this must fail with "${cexpect}". It did not, ` +
                    'so the PASS below asserts nothing.',
            );
            continue;
          }
          console.log(`  control fires         ${c.name}`);
        } finally {
          rmSync(cdir, { recursive: true, force: true });
        }
      }
      const sstale = trySeed(c.seed, dir);
      if (sstale) {
        bad++;
        console.log(`  SEED IS STALE         ${c.name}  <- ${c.what}`);
        console.log(`        ${sstale}`);
        continue;
      }
      const cExpect = resolveExpect(c.expect, dir);
      const { pass, stdout } = runGate(dir, c.gate);
      const findings = stdout
        .split('\n')
        .filter((l) => l.startsWith('       '))
        .map((l) => l.trim());
      if (cExpect === 'PASS') {
        if (pass) {
          console.log(`  out of scope, passed  ${c.name}  <- ${c.what}`);
        } else {
          bad++;
          console.log(`  READ A FILE IT MUST NOT  ${c.name}  <- ${c.what}`);
          console.log(`        ${c.gate} reported FAIL on a tree that does not violate it:`);
          for (const f of findings.slice(0, 3)) console.log(`          ${f.slice(0, 140)}`);
        }
      } else if (!pass && findings.some((f) => f.includes(cExpect))) {
        console.log(`  in scope, failed      ${c.name}  <- ${c.what}`);
        console.log(`        ${findings.find((f) => f.includes(cExpect)).slice(0, 150)}`);
      } else {
        bad++;
        console.log(
          `  ${pass ? 'DID NOT FAIL         ' : 'FAILED OFF-TARGET    '} ${c.name}  <- ${c.what}`,
        );
        console.log(
          `        Expected a finding containing "${cExpect}". Got ${findings.length} finding(s):`,
        );
        for (const f of findings.slice(0, 3)) console.log(`          ${f.slice(0, 140)}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log("\nLOADER: CI-03's engine-independent halves, each seeded in the copy\n");

  // THE POSITIVE CONTROL COMES FIRST AND IS ITS OWN CASE. Every violation case
  // below is satisfied by a checker that refuses everything, so the unseeded
  // copy must come back clean before any of them means anything.
  {
    const dir = mkdtempSync(join(tmpdir(), 'merit-loader-'));
    try {
      copyTree(dir);
      const { pass, stdout } = runLoaderCheck(dir);
      if (pass) {
        console.log('  control comes back clean  an untouched copy of the tree');
      } else {
        bad++;
        console.log('  CONTROL DID NOT PASS      an untouched copy of the tree');
        console.log(
          '        Every violation case below is satisfied by a loader that refuses ' +
            'everything, so they assert nothing until this loads:',
        );
        console.log(indentAll(stdout));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  for (const c of LOADER_CASES) {
    const dir = mkdtempSync(join(tmpdir(), 'merit-loader-'));
    try {
      copyTree(dir);
      const stale = trySeed(c.seed, dir);
      if (stale) {
        bad++;
        console.log(`  SEED IS STALE             ${c.name}  <- ${c.what}`);
        console.log(`        ${stale}`);
        console.log('        The harness no longer describes the loader. Fix the seed.');
        continue;
      }
      const expect = resolveExpect(c.expect, dir);
      const { pass, stdout } = runLoaderCheck(dir);
      const findings = stdout
        .split('\n')
        .filter((l) => l.startsWith('       '))
        .map((l) => l.trim());
      if (expect === 'PASS') {
        if (pass) {
          console.log(`  out of scope, accepted    ${c.name}  <- ${c.what}`);
        } else {
          bad++;
          console.log(`  REFUSED A VALID INPUT     ${c.name}  <- ${c.what}`);
          for (const f of findings.slice(0, 3)) console.log(`          ${f.slice(0, 140)}`);
        }
      } else if (!pass && findings.some((f) => f.includes(expect))) {
        console.log(`  found as required         ${c.name}  <- ${c.what}`);
        console.log(`        ${findings.find((f) => f.includes(expect)).slice(0, 150)}`);
      } else {
        bad++;
        console.log(
          `  ${pass ? 'DID NOT FAIL             ' : 'FAILED OFF-TARGET        '} ${c.name}  <- ${c.what}`,
        );
        console.log(
          `        Expected a finding containing "${expect}". Got ${findings.length} finding(s):`,
        );
        for (const f of findings.slice(0, 3)) console.log(`          ${f.slice(0, 140)}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log(
    bad === 0
      ? `\nAll ${ids.length} gates pass clean and fail dirty, ${SCOPE_CASES.length} scope ` +
          `case(s) hold, and ${LOADER_CASES.length} loader case(s) land on the side of the ` +
          `CI-03 boundary they name. Each one has now been watched doing both.`
      : `\n${bad} problem(s). A gate that cannot be made to fail is not checking anything, and ` +
          `a gate that fails on a file outside its scope is checking the wrong thing.`,
  );
  return bad ? 1 : 0;
}

process.exit(main());
