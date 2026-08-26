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
  statSync,
  existsSync,
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

// The ADR table's counterpart to `addMigrationRow`, written for `CI-06w`'s
// per-table boundary. THE TWO NUMERIC TABLES CLAIM OVERLAPPING INTEGER RANGES:
// the ADR table claims 1 to 71 and the migration table 1 to 45, so a gate that
// merged them into one map would report every number below 45 as claimed twice
// and would be red on arrival. Pinning that boundary means writing the SAME
// number into either table and asserting the two outcomes differ.
const addAdrRow = (body, number, state) => {
  const heading = '## Number allocation';
  const start = body.indexOf(heading);
  if (start === -1) throw new Error('seed anchor not found: the ADR allocation table');
  // Bounded to its own section, for the reason `addMigrationRow` states one
  // helper down: the last table row of an unbounded slice belongs to a table
  // further down the file, and the seed would then reserve nothing.
  const after = body.slice(start + heading.length);
  const end = after.search(/\n## /);
  const section = end === -1 ? after : after.slice(0, end);
  const rows = [...section.matchAll(/^\|.*\|$/gm)];
  if (rows.length < 3) throw new Error('seed anchor found no rows in the ADR table');
  const last = rows[rows.length - 1];
  const at = start + heading.length + last.index + last[0].length;
  return `${body.slice(0, at)}\n| ${number} | falsify probe | **reserved.** ${state} |${body.slice(at)}`;
};

const nextFreeMigration = (dir) =>
  String(nextFree(dir, '## Migration number allocation')).padStart(4, '0');
const nextFreeAdr = (dir) => String(nextFree(dir, '## Number allocation')).padStart(3, '0');

// A number the migration table ALREADY claims: `nextFree`'s mirror image, and
// the anchor `CI-06w`'s seed needs. Derived rather than pinned, on the standing
// rider: a seed naming `0034` goes silent the day ADR-065's merge lands and
// reports a tidy `did not fire`. Gaplessness over allocated-plus-reserved is
// `CI-06h`'s own assertion, so everything below the first free number is
// claimed by construction.
const lastClaimedMigration = (dir) => {
  const free = nextFree(dir, '## Migration number allocation');
  if (free <= 1) {
    throw new Error('seed anchor not found: the migration table claims no number at all');
  }
  return String(free - 1).padStart(4, '0');
};

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

// =============================================================================
// THE CI-06u REPAIR CASE SEEDS ITS OWN FIXTURE (ADR-064)
// =============================================================================
// A SEED MAY NOT PIN TO A LIVE IDENTIFIER, and a live REGISTER ENTRY is a live
// identifier. The case below has now outgrown three anchors, each failing the
// same way one level further out:
//
//   1. `inv-m20-06` in `M20-wallet.md`, hardcoded. `ADR-063`'s session repaired
//      that duplicate, the entry went, and the case reported DID NOT FAIL on a
//      tree where the gate was working.
//   2. The register's FIRST claim, derived. It assumed every claim carries
//      exactly two rows; `docs/sessions/README.md` carries FOUR under sessions
//      31, 49, 50 and 56, so deleting one left three and the read-back found
//      nothing. SEED IS STALE, again on a working tree.
//   3. Any live claim at all. `ADR-064` takes the register from 59 keys to 19
//      and names the two lines that take it to zero. Emptying it on today's tree
//      was measured directly: `gates.mjs check` reports `CI-06u` failing with
//      130 findings, and `falsify.mjs` reports 5 problems, the first being
//      `SEED IS STALE  seed anchor not found: no CI06U_REGISTER claim resolves
//      to two rows under one key`.
//
// THE GATE'S OWN FALSIFICATION WAS TIED TO THE DEFECT THE GATE EXISTS TO
// REMOVE, so the wave's success was what would end it. There is no live anchor
// that fixes that, because the corpus is ALLOWED to repair every one of them.
//
// So the seed builds its own. It writes a two-rows-under-one-key table, adds it
// to the COPY's register, and then removes the second row, which is the repair
// the case is about. Both halves are constructed, so the case holds on a tree
// whose real register is empty and it can never again report a stale anchor as
// a working gate.
const SEEDED_REGISTER_FILE = 'docs/GLOSSARY.md';

// Unmistakable on purpose. `rowsCarrying` matches a first cell by SUBSTRING, so
// a key that reads like corpus vocabulary could match a row the seed did not
// write and repair somebody else's table.
const SEEDED_REGISTER_KEY = 'seeded-register-fixture-key';

/**
 * The fixture table, two rows under one key, appended to the copy.
 *
 * It is a plain `Term` table because that is what the gate reads as an identity
 * column: `DIMENSION_HEADERS` exempts `From`, `Threat`, `Rank`, `Group`,
 * `Source` and `Digest`, and a fixture headed by one of those would be out of
 * scope and would assert nothing.
 */
const seedRegisterFixture = (dir) => {
  edit(
    dir,
    SEEDED_REGISTER_FILE,
    (b) =>
      `${b}\n<!-- seeded: the CI-06u register fixture -->\n\n| Term | Meaning |\n|---|---|\n` +
      `| ${SEEDED_REGISTER_KEY} | the row that stays |\n` +
      `| ${SEEDED_REGISTER_KEY} | the row the repair removes |\n`,
  );
  edit(dir, 'scripts/corpus/gates.mjs', (b) =>
    once(
      b,
      'const CI06U_REGISTER = new Map([',
      `const CI06U_REGISTER = new Map([\n  ['${SEEDED_REGISTER_FILE}', ['${SEEDED_REGISTER_KEY}']],`,
    ),
  );
};

/**
 * The claim the seed repaired, read back off the SEEDED tree.
 *
 * `expect` and `seed` are resolved against DIFFERENT TREES and this case
 * reported `FAILED OFF-TARGET` until they were made complementary: both derived
 * their target from the register's first live claim, and on the seeded copy the
 * row was already gone, so `expect` skipped past the repaired claim to the next
 * one and demanded a finding about a file the seed never touched. That is the
 * `CI-06p` seed's recorded lesson, which its own comment states as "`expect` is
 * resolved against the SEEDED tree".
 *
 * IT STILL READS BACK RATHER THAN NAMING `SEEDED_REGISTER_KEY`, even though the
 * seed now constructs both halves. `expect` is the only thing standing between
 * "the seed ran" and "the seed did what it says": if the fixture stops being
 * written, or the register edit stops landing, this throws instead of demanding
 * a finding that would never come.
 *
 * Every registered claim carries two or more rows on a clean tree, or the gate
 * would already be reporting it. So after the seed exactly one carries fewer,
 * and that one is the repair.
 */
function repairedRegisteredDuplicate(dir) {
  const body = readFileSync(join(dir, 'scripts/corpus/gates.mjs'), 'utf8');
  const start = body.indexOf('CI06U_REGISTER');
  for (const entry of body.slice(start).matchAll(/\[\s*'([^']+\.md)',\s*\[([^\]]*)\]/g)) {
    for (const k of entry[2].matchAll(/'([^']+)'/g)) {
      if (rowsCarrying(dir, entry[1], k[1]).length < 2) return { file: entry[1], key: k[1] };
    }
  }
  throw new Error('seed anchor not found: no registered claim was repaired on the seeded tree');
}

/** Line indices whose first table cell mentions `key`, case-insensitively. */
function rowsCarrying(dir, file, key) {
  const lines = readFileSync(join(dir, file), 'utf8').split('\n');
  const needle = key.toLowerCase();
  const out = [];
  lines.forEach((line, i) => {
    if (!line.startsWith('|')) return;
    const first = (line.split('|')[1] ?? '').toLowerCase();
    if (first.includes(needle)) out.push(i);
  });
  return out;
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
/**
 * A generated-span opener and closer, ASSEMBLED RATHER THAN WRITTEN.
 *
 * `falsify.mjs` lives inside the tree `CI-06t` scans, so a literal opener here
 * would make this harness a finding of the gate it is proving. That is not a
 * hypothetical: the ALLOCATION row reserving this very letter spelled an opener
 * out while reserving a gate against spelling openers out, and `CI-06g` caught
 * it within the minute. Same reason `CI-06q`'s seed assembles its approval
 * phrase, and `RI-02`'s idiom generally.
 */
const opener = (name) => `<!--${'gen'}:${name}-->`;
const closer = () => `<!--/${'gen'}-->`;

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
  'CI-06o': {
    what: 'a model SDK imported by a file on the money path',
    real:
      'ADR-044 section 8 specified this prohibition and then said it was prose: a rule ' +
      'that says no model on the money path and is enforced by people remembering it is ' +
      'a control that exists, stays valid, and enforces nothing',
    // THE SEEDED FILE IS NEW RATHER THAN AN EDIT TO AN EXISTING ONE, so the seed
    // cannot go stale when the file it would have edited is renamed, and so the
    // violation is the whole of what the file contains.
    expect: () => 'packages/rules-engine/src/narrate.ts: imports the model SDK "@anthropic-ai/sdk"',
    seed: (d) =>
      writeFileSync(
        join(d, 'packages/rules-engine/src/narrate.ts'),
        "import Anthropic from '@anthropic-ai/sdk';\n" +
          'export const explain = async (why: string) => new Anthropic().messages.create({ why });\n',
      ),
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
  'CI-06s': {
    what: 'a probe added to scripts/db that no workflow step runs',
    real:
      'probe_rule_states_high_water_bound.sql was on disk, WAS wired at corpus.yml:432, and ' +
      'the string `high_water_bound` appeared nowhere in gates.mjs. That is OI-07 a fourth ' +
      'time, live on main the day this gate was written, after probe_payout_hold.sql was ' +
      'wired and never pinned and probe_reversible_contact_addresses.sql repeated the ' +
      'identical omission and was caught before merge only by a human reading the diff',
    // THE UNRUN DIRECTION IS THE SEED AND THE OTHER TWO ARE SCOPE CASES, because
    // the unpinned direction is the one this session REPAIRED. Seeding the
    // repair's own shape here would make the seed and the fix prove each other,
    // so that direction is seeded below on a different probe entirely.
    //
    // The file is written and NOT wired, which is the cheaper half of the two
    // edits and therefore the one a session actually makes: a probe lands beside
    // a fix, the fix merges, and nothing ever runs the probe again.
    expect: 'scripts/db/probe_seeded_never_run.sql exists and no step in',
    seed: (d) => {
      writeFileSync(
        join(d, 'scripts/db/probe_seeded_never_run.sql'),
        '-- A probe that ships beside a fix and is never run again.\n',
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
  'CI-06t': {
    what: 'a generated-span opener written into prose and never closed',
    real:
      'a session log described a falsify.mjs seed by spelling an opener out and never ' +
      'closing it. CI-06g matches an opener only when a closer follows it, so it was ' +
      'skipped in silence for two days, and the first section appended below it supplied ' +
      'the closer it had been waiting for. The stale opener then swallowed ten thousand ' +
      'characters of unrelated prose including the new span own opener',
    // THE ONLY PLACE IN THIS REPOSITORY WHERE A LITERAL TOKEN IS UNAVOIDABLE, and
    // it is assembled rather than written so that this file is not itself the
    // defect. RI-02's idiom, and the same reason CI-06q's seed assembles its
    // approval phrase: the harness lives inside the tree the gate scans.
    expect: 'opens and is never closed',
    seed: (d) =>
      edit(
        d,
        'docs/GLOSSARY.md',
        (b) => `${b}\n<!-- seeded -->\nThe count sits in a ${opener('ec_count')} span.\n`,
      ),
  },

  'CI-06u': {
    what: 'one table carrying two rows under the same first-cell key',
    real:
      "the review desk's merge script resolves conflicts keep-both and then dedupes only " +
      'lines over 60 characters that are byte-identical after comment stripping. Two ' +
      'sessions appending to one markdown table therefore re-append every row the table ' +
      'already had, and any copy differing by a link, a count or a wording is under the ' +
      "dedupe's reach. It has happened three times on main-bound branches: ADR-050 twice " +
      'in the decisions README with DIFFERENT titles, fourteen CI-06 rows in STRATEGY, ' +
      'and duplicated passages in STATE recorded as OI-10',
    // THE SEED CARRIES TWO DIFFERENT SECOND CELLS ON PURPOSE. A byte-identical
    // pair is the case the merge script's own dedupe already removes, so seeding
    // one would prove the gate fires on the population that never reaches main.
    // The rows that survive the dedupe are exactly the rows that disagree.
    expect: 'the first cell "seeded-term" already heads the row at line',
    seed: (d) =>
      edit(
        d,
        'docs/GLOSSARY.md',
        (b) =>
          `${b}\n<!-- seeded -->\n\n| Term | Meaning |\n|---|---|\n` +
          `| seeded-term | what one session wrote |\n` +
          `| seeded-term | what the other session wrote, which is not the same claim |\n`,
      ),
  },

  'CI-06v': {
    what: 'a run of consecutive pipe lines carrying no delimiter row',
    real:
      "the review desk's merge script resolves conflicts keep-both, so a session appending " +
      'to a table can land a SECOND header row and a SECOND delimiter row inside it with a ' +
      'blank line behind them. The rows below that blank line are then a run with no ' +
      'delimiter: markdownTables discards it, every table gate in the runner stops reading ' +
      'it, and GitHub draws it as prose. It has happened twice on main: six rows of ' +
      "STRATEGY section 4.4's own gate inventory, CI-06u's row among them, repaired by " +
      "session 83; and four runs holding nine rows in ALLOCATION's letter table, recorded " +
      'by ADR-065 and repaired by session S6',
    // THE SEED IS THE REAL SHAPE AND NOT A BARE FRAGMENT. A run of loose pipe
    // lines with nothing above them would fire the gate and would prove it fires
    // on a population that does not occur. What lands on main is a WELL FORMED
    // table followed by a re-inserted header, a re-inserted delimiter and a
    // blank, and it is the blank that orphans everything under it.
    expect: 'consecutive pipe lines carry no delimiter row',
    seed: (d) =>
      edit(
        d,
        'docs/GLOSSARY.md',
        (b) =>
          `${b}\n<!-- seeded: the keep-both merge artifact CI-06v is aimed at -->\n\n` +
          `| Term | Meaning |\n|---|---|\n| seeded-a | the table is well formed to here |\n` +
          `| Term | Meaning |\n|---|---|\n\n` +
          `| seeded-b | this row is below the blank and no table gate reads it |\n` +
          `| seeded-c | nor this one |\n`,
      ),
  },
  'CI-06w': {
    what: 'a second allocation row claiming a number the table already claims',
    real:
      '0034 was claimed by ADR-047 for the rule_states calendar revision and by ADR-046 for ' +
      'the reversible contact addresses, in ADJACENT ROWS of one table on one ref, and ' +
      'fifteen gates passed over it because allocated() folded both claims into one Set ' +
      'member. Recovery was free only because the second file was still unwritten, and a ' +
      'merged migration is sacred (E2)',
    // DERIVED, and the number is one the table already holds rather than a free
    // one. A seed claiming a FREE number opens no duplicate and would report a
    // gate that cannot fail; a seed naming a live number by literal goes silent
    // the day that row moves. `lastClaimedMigration` is neither.
    //
    // `expect` resolves against the SEEDED tree, and the seeded row does not
    // move the first free number, so it names the same number before and after.
    // That is the `CI-06l` lesson, applied before it bit.
    expect: (d) => `${lastClaimedMigration(d)} is claimed by 2 rows`,
    seed: (d) => {
      const claimed = lastClaimedMigration(d);
      edit(d, 'docs/decisions/ALLOCATION.md', (b) =>
        addMigrationRow(
          b,
          claimed,
          'a SECOND claim on a number this table already claims, which is the ' +
            'shape ADR-046 and ADR-047 landed in adjacent rows',
        ),
      );
    },
  },
  // THE ONE SEED IN THIS FILE THAT HAD NO HISTORICAL ANCHOR AVAILABLE, and the
  // absence is the finding rather than a gap. `OI-19` says `<<<<<<< HEAD` stood
  // in INDEX and STATE while the gates passed. It never stood in a COMMIT:
  // `git log --all -G'^<<<<<<< '` over `.md`, `.ts`, `.mjs` and `.json` returns
  // nothing on any branch head or pull-request head. It stood in a WORKING TREE
  // during a merge, which is precisely the boundary the gate protects and
  // precisely the state a git-history seed could not reproduce.
  //
  // SO THE SEED WRITES THE VIOLATION, and that is the better construction on
  // this file's own terms. `OI-21` records that a harness anchored to corpus
  // state decays as the corpus is repaired -- the two `0029` seeds went silent
  // and vacuous when the allocation table moved under them. A seeded marker
  // cannot go stale, because the tree it needs is one it creates.
  //
  // THE APPEND CARRIES NO ANCHOR ON PURPOSE. `once()` exists so a seed whose
  // anchor moved announces itself; an append has nothing to move. `CI-06a`'s
  // seed is built the same way and for the same reason.
  'CI-06/conflict-markers': {
    what: 'a line beginning with the ours-side conflict marker, seeded rather than anchored',
    real:
      'OI-19 records `<<<<<<< HEAD` standing in INDEX and STATE while 22 of 22 gates passed. ' +
      'It never stood in a commit, only in a working tree during a merge, and the record ' +
      'disagrees with itself on the count besides (22 in session 105 and in STATE, 24 in ' +
      'session 106). The boundary the gate protects is the PUSH and not the history, so the ' +
      'violation is seeded here rather than quoted from a history that does not hold one',
    expect: `line begins with the conflict marker "${'<'.repeat(7)}"`,
    seed: (d) => edit(d, 'docs/STATE.md', (b) => `${b}\n${'<'.repeat(7)} HEAD\n`),
  },
  // THE VIOLATION IS THE ONE CI-03 REPORTS AS NOT SWITCHED ON, and it is the one
  // that had actually happened three times when the gate was written. A fixture
  // lands and the registry does not move.
  //
  // A FOURTH SCENARIO, DERIVED, BECAUSE THREE ARE REGISTERED. Seeding one of
  // GS-049, GS-059 or GS-080 would land on a register entry and the gate would
  // correctly stay quiet, which is a seed that proves the register works and
  // nothing about the assertion. So the seed picks a row that is BLOCKED AND HAS
  // NO FIXTURE ON DISK -- a set no register entry can be in, by construction --
  // and gives it one.
  //
  // `expect` RESOLVES AGAINST THE SEEDED TREE, which is the CI-06l lesson
  // applied before it bit here: re-deriving "the first blocked row with no
  // fixture" after the seed would name the NEXT row while the gate correctly
  // names the one that was seeded. So the seeded file carries a marker in its
  // name and `expect` reads the id back out of the tree the gate will read.
  'CI-06/fixture-inventory': {
    what: 'a fixture on disk whose registry row does not say "written"',
    real:
      'GS-080 (W2, session 109), GS-059 and GS-049 (W4, session 117) all landed on disk while ' +
      "their rows went on reading writable or blocked. CI-03 has reported this direction as " +
      "CI-06's and not switched on, on every run, since it was written",
    expect: (d) => `${seededFixtureId(d)} has a fixture on disk`,
    seed: (d) => {
      const id = blockedWithNoFixture(d);
      writeFileSync(
        join(d, FIXTURE_DIR, `${id}-${SEED_MARK}.yaml`),
        `# seeded by falsify.mjs: a fixture whose row does not say written\nscenario: ${id}\n`,
      );
      writeFileSync(join(d, FIXTURE_DIR, `${id}-${SEED_MARK}.expected.json`), '{}\n');
    },
  },
  // ADR-074's rule is "exactly one", and the violation seeded is the SECOND
  // site rather than the missing one, on purpose. A missing site is the shape a
  // careless author produces; a SECOND site is the shape a merge produces, and
  // it is the one the corpus has actually suffered -- `CI-06u`'s register holds
  // 19 duplicate first cells today, every one of them from the review desk's
  // keep-both resolution. It is also the harder half to see by eye: the
  // identifier IS defined, twice, and both definitions look right.
  //
  // DERIVED, and re-derivable after the seed. The target is the first declared
  // series whose register is a WHOLE FILE (a section register would put the
  // appended row outside the section, changing nothing) and its first member.
  // Appending a row for an EXISTING member changes the site count and never the
  // member set or its ordering, so `expect` names the same identifier before and
  // after -- which is the `CI-06l` trap, checked for rather than tripped over.
  'CI-06/identifier-series': {
    what: 'a second definition site for an identifier inside its own declared register',
    real:
      'ADR-014 leads four table rows, its register row and three in ADR-052 and ADR-057 whose ' +
      'first column is the SOURCE BEING QUOTED, which is why ADR-074 scopes the search to a ' +
      'declared register rather than enumerating the exceptions. The duplicate-definition ' +
      "shape itself is the review desk's keep-both merge: CI-06u's register holds 19 duplicate " +
      'first cells on main today',
    expect: (d) => `${declaredFileRegister(d).id} has 2 definition sites`,
    seed: (d) => {
      const { register, id } = declaredFileRegister(d);
      edit(d, register, (b) => `${b}\n| ${id} | a second definition, seeded by falsify |\n`);
    },
  },
  // THE SEEDED VIOLATION IS THE ARRIVAL, AND IT IS THE ONLY ONE THAT FAILS ON
  // GOOD NEWS. ADR-073 section 8 names four assertions the gate must make and
  // says of this one: "the third of those four is the assertion that does the
  // work, and it is the one an implementer is most likely to leave out, because
  // it is the only one that fails on good news". Every other assertion this gate
  // makes fires on a document somebody wrote badly; THIS one fires on a commit
  // somebody was right to land, which is the entire difference between an
  // activation condition and the word "deferred".
  //
  // AN APP ROUTER FILE RATHER THAN A `build` SCRIPT SINCE 2026-08-24, and the
  // reason this seed moved is the reason the seed exists. CI-07's artifact WAS a
  // `build` script in an app manifest; ADR-095 admitted Next.js, the script
  // landed, this gate failed on good news exactly as designed, and the row was
  // re-ruled to the artifact one step down the chain: something for the build to
  // build. A seed left pointing at the old artifact would have gone vacuous in
  // the direction that reads as coverage, which is the defect the two `0029`
  // seeds recorded.
  //
  // DERIVED FROM THE TREE AT SEED TIME. No app is named here, so the seed follows
  // a rename or a fifth app. The selector is stable under its own seed: creating
  // `src/app/page.tsx` does not change which app sorts first.
  'CI-06/gate-inventory': {
    what: "an activation condition's artifact ARRIVING: an App Router file under apps/*/src/app/ reopens CI-07",
    real:
      'CI-07 has been open since P1 was declared closed and nothing could read its state, ' +
      'which ADR-073 gives as the reason a "deferred" marker no gate reads is the same ' +
      'marker. Its condition is a path precisely so that the commit adding the first ' +
      'renderable document reopens the row on the day it lands rather than whenever ' +
      'somebody rereads the table. THE ROW HAS ALREADY BEEN WATCHED FIRING FOR REAL: ' +
      'ADR-095 section 6 is the re-ruling that followed',
    expect: (d) => `HAS ARRIVED (${firstAppDir(d)}/src/app/page.tsx is an App Router file`,
    seed: (d) => {
      const app = firstAppDir(d);
      const dir = join(d, app, 'src/app');
      if (existsSync(join(dir, 'page.tsx'))) {
        throw new Error(`seed anchor not found: ${app}/src/app/page.tsx already exists`);
      }
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'page.tsx'), '// seeded by falsify.mjs\n');
    },
  },

  // The same shape one table down, and the same reason: ADR-073 section 8 calls
  // the absence assertion "the one an implementer is most likely to leave out,
  // because it is the only one that fails on good news", and ADR-080 inherits
  // it.
  //
  // THIS SEED MOVED WITH THE ARTIFACT ON 2026-08-25 AND IT MOVED BECAUSE IT
  // BROKE, WHICH IS THE DESIGN WORKING. It seeded a `fastify` key into the
  // lockfile while VG-3 and VG-6 waited on one. ADR-100 put a real one there,
  // so the seed anchor stopped existing and this case THREW rather than
  // reporting a pass: `pnpm run falsify` went to 1 problem on the commit that
  // delivered the artifact, one gate after `CI-06/vg-inventory` itself went to
  // 29 of 30. A harness that had matched loosely would have seeded a second key
  // and passed.
  //
  // THE ARTIFACT IS NOW `scopedDb` NAMED UNDER `apps/api/src`, which is
  // API_CONTRACT section 1's own mechanism for what both rows are about:
  // "Every authenticated handler resolves the caller to an identity and reads
  // through `scopedDb(identity)`". The seed is that name arriving in the
  // deployable.
  //
  // THE KEY IS ANCHORED AND THE NEAR-MISS IS A SCOPE CASE, unchanged in shape.
  // `scopedDbFixture` contains `scopedDb`; a substring probe would fire on it
  // and pass in exactly the same way as one that works, which is the
  // @vitest/browser-playwright lesson. The pair is deliberate: this seed proves
  // the probe FIRES, and `scoped-db-near-miss` proves it does not fire on a
  // longer name.
  'CI-06/vg-inventory': {
    what: "an activation condition's artifact ARRIVING: `scopedDb` named inside apps/api reopens VG-3 and VG-6",
    real:
      'VG-3 and VG-6 chained on CI-04 until 2026-08-24 and the chain EXPIRED when CI-04 got ' +
      'an implemented leg (ADR-085). Their condition is a fact about the tree precisely so that ' +
      'the commit making server-side authz writable reopens both rows on the day it lands ' +
      'rather than whenever somebody rereads the table. It was a lockfile key until ADR-100 ' +
      'delivered that key; it is now the accessor the contract names',
    expect: () => 'HAS ARRIVED',
    seed: (d) => {
      const rel = 'apps/api/src/falsify_seeded_handler.ts';
      if (existsSync(join(d, rel))) {
        throw new Error(`seed anchor not found: ${rel} already exists`);
      }
      writeFileSync(
        join(d, rel),
        '// seeded by falsify.mjs\nexport const read = () => scopedDb(identity);\n',
      );
    },
  },

  // THE SECOND SWEEP OF A SUPERSESSION, which the corpus has never mandated.
  // Session 135 ran the grep the rules DO mandate, for a superseding migration
  // BEFORE citing a constraint, and was right to; the grep for EXISTING
  // citations AFTER superseding has never been run by anybody, and three stale
  // ones reached one test file, one of them stating the OPPOSITE of what the
  // replacement predicate does. The seed is that exact act.
  //
  // THE NAME IS DERIVED AND NEVER SPELLED. A constraint name is a live
  // identifier under the standing rider: the set grows the day the next
  // supersession merges. It is also the gate's own design constraint one level
  // down, and a harness carrying a hand list would rot in the place gates.mjs
  // refuses to.
  'CI-06/retired-constraints': {
    what: 'a retired constraint name cited in a document that neither retires it nor records it',
    real:
      'the mandated grep runs BEFORE a constraint is cited and nobody has ever run the one ' +
      'AFTER superseding, so 3 of 102 citation sites went stale unnoticed and were found by ' +
      'hand a week later. Session 151 repaired those three. This is what stops the fourth, and ' +
      'the fourth arrives in a document nobody is rereading',
    expect: (d) => `cites the retired constraint \`${retiredNamesIn(d)[0].name}\``,
    seed: (d) => {
      const { name } = retiredNamesIn(d)[0];
      if (existsSync(join(d, RETIRED_SEED_DOC))) {
        throw new Error(`seed anchor not found: ${RETIRED_SEED_DOC} already exists`);
      }
      writeFileSync(
        join(d, RETIRED_SEED_DOC),
        '---\nstatus: draft\ndepends_on: []\nlast_updated: 2026-08-24\n---\n\n' +
          `# Seeded by falsify.mjs\n\nThe \`${name}\` CHECK refuses such a row.\n`,
      );
    },
  },
};

// ---------------------------------------------------------------------------
// CI-06/retired-constraints: readers for the migration directory and the register
// ---------------------------------------------------------------------------
// The document the seeds plant into. `docs/architecture/` is in none of the
// gate's permitted classes and no register entry names this path, so a file here
// is a finding by construction and stays one however the corpus is rearranged.
const RETIRED_SEED_DOC = 'docs/architecture/PROBE_RETIRED_CITATION.md';

// A file that exists, cites nothing, and is in neither register. Pinned as a
// PATH the way LOCKFILE and STRATEGY_PATH are, and the seed that uses it asserts
// all three properties rather than assuming them.
const RETIRED_CLEAN_FILE = 'pnpm-workspace.yaml';

// The gate's own matcher, which is `\b` written out. Reproduced here rather than
// approximated, because two scope cases below turn on exactly where its edges
// fall.
const retiredNameRe = (name) => new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`);

// {names some migration DROPs} minus {names some migration ADDs}, read out of
// the COPY, with SQL comments stripped exactly as the gate strips them. Reading
// ROOT would reintroduce the class one level down: a name retired in the source
// tree and re-added in the seeded one.
const retiredNamesIn = (d) => {
  const dir = join(d, 'packages/db/migrations');
  const dropped = new Map();
  const added = new Set();
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith('.sql')) continue;
    const body = readFileSync(join(dir, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/--[^\n]*/g, '');
    for (const m of body.matchAll(/\bDROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?([a-z0-9_]+)/gi)) {
      if (!dropped.has(m[1].toLowerCase())) dropped.set(m[1].toLowerCase(), f);
    }
    for (const m of body.matchAll(/\bADD\s+CONSTRAINT\s+([a-z0-9_]+)/gi)) {
      added.add(m[1].toLowerCase());
    }
  }
  const retired = [...dropped]
    .filter(([n]) => !added.has(n))
    .sort(([a], [b]) => a.localeCompare(b));
  if (retired.length === 0) {
    throw new Error('seed anchor not found: no retired constraint in the migration directory');
  }
  return retired.map(([name, file]) => ({ name, file }));
};

// The retired name whose SUPERSEDING MIGRATION EMBEDS IT IN ITS OWN FILENAME,
// which is the left half of the anchoring case. Found by shape rather than
// pinned, so it survives any renaming that keeps the property.
const supersededByFilenameIn = (d) => {
  const hit = retiredNamesIn(d).find((n) => n.file.includes(n.name));
  if (!hit) {
    throw new Error('seed anchor not found: no migration filename embeds the name it retires');
  }
  return hit;
};

// RETIRED_REGISTER, read out of the copy's gates.mjs at seed time, sorted by the
// number of sites. The two count cases have to name a file the register already
// holds, and picking one by hand is `soleWaiterVgRow`'s lesson a second time: an
// entry repaired away leaves the case firing on the wrong finding. The entry
// with the MOST sites is the one with headroom and it moves with the register.
const retiredRegisterIn = (d) => {
  const body = readFileSync(join(d, 'scripts/corpus/gates.mjs'), 'utf8');
  const start = body.indexOf('const RETIRED_REGISTER = new Map([');
  if (start === -1) throw new Error('seed anchor not found: const RETIRED_REGISTER');
  const end = body.indexOf('\n]);', start);
  if (end === -1) throw new Error('seed anchor not found: the end of RETIRED_REGISTER');
  const entries = [
    ...body.slice(start, end).matchAll(/\[\s*'([^']+)',\s*\{\s*sites:\s*(\d+)/g),
  ].map((m) => ({ file: m[1], sites: Number(m[2]) }));
  // Rule 2 of gates.mjs applied to the harness: a parser that reads nothing has
  // lost its input, and an empty list here would seed nothing while still
  // reporting a tidy `did not fire`.
  if (entries.length === 0) throw new Error('seed anchor found no entry in RETIRED_REGISTER');
  return entries.sort((a, b) => b.sites - a.sites || a.file.localeCompare(b.file));
};

// The newest dated session log, which is a permitted class by name.
const latestSessionLogIn = (d) => {
  const files = readdirSync(join(d, 'docs/sessions'))
    .filter((f) => /^\d{4}-\d{2}-\d{2}-session-\d+\.md$/.test(f))
    .sort();
  if (files.length === 0) throw new Error('seed anchor not found: no dated session log');
  return `docs/sessions/${files[files.length - 1]}`;
};

// The control both PASS cases below need: the BARE name, in the one document
// that is in no permitted class. Without it, a gate that had stopped reading
// anything at all would pass both of them and look correctly scoped.
const seedBareRetiredName = (d) => {
  const { name } = retiredNamesIn(d)[0];
  writeFileSync(join(d, RETIRED_SEED_DOC), `A row is refused by \`${name}\`.\n`);
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

/**
 * ADR-065 T3's seed anchor, DERIVED rather than pinned for `lastAdrId`'s reason.
 * It rewrites the disposition cell of a row whose artifact is present, turning a
 * correctly-amended row back into a reservation. Pinning a number would name a
 * row that a later renumber moves, and the seed would then plant nothing while
 * reporting a tidy `did not fire`.
 */
const reserveLandedRow = (d, heading, keyOf, present) => {
  const p = join(d, 'docs/decisions/ALLOCATION.md');
  const lines = readFileSync(p, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.startsWith(heading));
  if (start < 0) throw new Error(`seed anchor not found: ${heading}`);
  for (let i = start; i < lines.length; i++) {
    if (i > start && lines[i].startsWith('## ')) break;
    if (!lines[i].startsWith('|')) continue;
    const cells = lines[i].split('|');
    const m = /^\s*\*{0,2}(\d{3,4})\*{0,2}\s*$/.exec(cells[1] ?? '');
    if (!m || !present.has(Number(m[1]))) continue;
    cells[cells.length - 2] = ' **Reserved, unwritten.** seeded by falsify ';
    lines[i] = cells.join('|');
    writeFileSync(p, lines.join('\n'));
    return keyOf(Number(m[1]));
  }
  throw new Error(`seed anchor not found: no landed row under ${heading}`);
};

// -----------------------------------------------------------------------------
// CI-06/fixture-inventory readers
// -----------------------------------------------------------------------------
// EVERY SEED BELOW MARKS WHAT IT TOUCHED AND EVERY `expect` READS THE MARK BACK.
// `expect` is resolved against the SEEDED tree, so a seed that changes the very
// property its `expect` re-derives names the NEXT row while the gate correctly
// names the one that moved -- watched happening on CI-06l, reported as
// FAILED OFF-TARGET, and avoided here by construction rather than by care.
const FIXTURE_STATUS_PATH = 'docs/testing/golden-scenarios/39-fixture-status-and-blockers.md';
const FIXTURE_DIR = 'packages/rules-engine/fixtures';
const SEED_MARK = 'seeded-by-falsify';

const fixtureRows = (d) =>
  readFileSync(join(d, FIXTURE_STATUS_PATH), 'utf8')
    .split('\n')
    .map((line, i) => ({ line, n: i }))
    .filter(({ line }) => /^\|\s*GS-\d{3}\s*\|/.test(line))
    .map(({ line, n }) => {
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      return {
        n,
        line,
        cells,
        id: /GS-\d{3}/.exec(cells[0])[0],
        status: (cells[1] ?? '').replace(/[`*]/g, ''),
      };
    });

const fixtureIdsOnDisk = (d) =>
  new Set(
    readdirSync(join(d, FIXTURE_DIR))
      .map((f) => /^(GS-\d{3})-.*\.yaml$/.exec(f))
      .filter(Boolean)
      .map((m) => m[1]),
  );

// A row that is BLOCKED and has NO fixture on disk. No register entry can be in
// that set, because every registered entry names a row whose fixture exists, so
// a seed drawn from here can never land on one and go quiet for the wrong reason.
const blockedWithNoFixture = (d) => {
  const on = fixtureIdsOnDisk(d);
  const row = fixtureRows(d).find((r) => r.status === 'blocked' && !on.has(r.id));
  if (!row) throw new Error('seed anchor not found: no blocked row without a fixture on disk');
  return row.id;
};

// The id the seed wrote a fixture for, read back out of the directory.
const seededFixtureId = (d) => {
  const f = readdirSync(join(d, FIXTURE_DIR)).find((x) => x.includes(SEED_MARK));
  if (!f) throw new Error(`seed anchor not found: no ${SEED_MARK} fixture in ${FIXTURE_DIR}`);
  return /^(GS-\d{3})-/.exec(f)[1];
};

// The id of the row a seed rewrote, read back out of the mark it left in the
// row's own citation cell.
const markedFixtureRow = (d) => {
  const row = fixtureRows(d).find((r) => r.line.includes(SEED_MARK));
  if (!row) throw new Error(`seed anchor not found: no row marked ${SEED_MARK}`);
  return row.id;
};

// The summary counts at the head of section 39, moved WITHOUT EITHER NUMBER
// BEING WRITTEN HERE, on the same rule as `bumpSpan`: a hand-maintained count
// inside the harness built to catch hand-maintained counts breaks the first time
// the corpus does the ordinary thing.
//
// A seed that moves a row and leaves the summary alone fires assertion 5 as well
// as its own finding, and a `PASS` case cannot tolerate a second finding at all.
const bumpFixtureSummary = (body, term, delta) => {
  const p = new RegExp(`(\\|\\s*\\*{0,2}\`?${term}\`?\\*{0,2}\\s*\\|\\s*\\*{0,2})(\\d+)(\\*{0,2}\\s*\\|)`);
  const m = p.exec(body);
  if (m === null) throw new Error(`seed anchor not found: the "${term}" summary row`);
  return body.replace(p, `$1${Number(m[2]) + delta}$3`);
};

// The runner itself, seeded in the COPY. The loader cases already seed source
// files for the same reason: some properties are properties OF the checker, and
// the only way to watch one fail is to break it where the checker will read it.
const GATES_PATH = 'scripts/corpus/gates.mjs';
const seedFixtureRegisterEntry = (d, id) =>
  edit(d, GATES_PATH, (b) =>
    once(
      b,
      'const CI06FIXTURE_REGISTER = new Map([',
      `const CI06FIXTURE_REGISTER = new Map([\n  ['${id}', 'seeded by falsify.mjs'],`,
    ),
  );

// A scenario whose fixture is on disk AND whose row already says so. A register
// entry naming one of these names no defect at all, by construction, whatever
// the register happens to hold.
const writtenWithAFixture = (d) => {
  const on = fixtureIdsOnDisk(d);
  const row = fixtureRows(d).find((r) => r.status === 'written' && on.has(r.id));
  if (!row) throw new Error('seed anchor not found: no written row with a fixture on disk');
  return row.id;
};

// THE ROW WHOSE CITED SUITE NAMES IT ONLY FROM INSIDE A DISABLED BLOCK, derived
// from the tree and never pinned to `GS-072` (founder rider, 2026-08-15: a seed
// derives its identifier at seed time). The derivation is deliberately the
// SHAPE and not the id: the day the engine exports `replay` this skip clears,
// the anchor is gone, and the case announces itself rather than retargeting
// quietly onto some other row that happens to look similar.
const SKIPPED_SITE = 'scripts/demo/test/replay-determinism.property.test.ts';
const rowNamedOnlyInsideASkip = (d) => {
  const lines = readFileSync(join(d, SKIPPED_SITE), 'utf8').split('\n');
  const at = lines.findIndex((l) => /^\s*describe\.skipIf\(/.test(l));
  if (at === -1) throw new Error(`seed anchor not found: no skipped describe in ${SKIPPED_SITE}`);
  const ids = new Set();
  for (let i = at - 1; i >= 0 && /^\s*\/\//.test(lines[i]); i--) {
    for (const m of lines[i].matchAll(/\bGS-\d{3}\b/g)) ids.add(m[0]);
  }
  if (ids.size !== 1) {
    throw new Error(
      `seed anchor not found: the skipped block at ${SKIPPED_SITE}:${at + 1} names ` +
        `${ids.size} golden-scenario rows, not one`,
    );
  }
  return [...ids][0];
};

// Move that row to `covered-elsewhere`, leaving its citation exactly as it
// stands. The citation is the claim under test and rewriting it would be the
// case marking its own homework.
const seedCoveredElsewhere = (d) => {
  const id = rowNamedOnlyInsideASkip(d);
  const row = fixtureRows(d).find((r) => r.id === id);
  if (!row) throw new Error(`seed anchor not found: no section 39 row for ${id}`);
  const was = row.status;
  const blocker = (row.cells[2] ?? '').replace(/[`*]/g, '');
  rewriteFixtureRow(
    d,
    (r) => r.id === id,
    (cells) => {
      cells[1] = 'covered-elsewhere';
      cells[2] = '';
    },
  );
  edit(d, FIXTURE_STATUS_PATH, (b) => {
    let out = bumpFixtureSummary(b, was, -1);
    out = bumpFixtureSummary(out, 'covered-elsewhere', 1);
    return blocker === '' ? out : bumpFixtureSummary(out, blocker, -1);
  });
  return id;
};

// A `writable` ROW CARRYING A BLOCKER, BUILT BY THE SEED RATHER THAN FOUND, and
// it is the second seed in this file to make that move for the same reason.
//
// THE CHANGE THIS SESSION HAD TO MAKE. The old seed picked a row that already
// read `writable` and gave it a blocker. `GS-071` was the last such row and it
// left for `covered-elsewhere` when session 129 wrote its assertion, so the
// predicate matches nothing and the case announces a stale anchor forever --
// which is the harness reporting correctly and is still a case asserting
// nothing. `register-names-no-defect` one entry up hit this exact shape when
// session 131 emptied the register, and took this exact way out.
//
// So the seed CREATES the anchor. A `blocked` row is moved to `writable` with
// its blocker left in place: the status is now one that means every ADR-072
// condition holds, and the row still names a condition that fails. That is
// assertion 4's contradiction exactly, on the same branch the old seed reached,
// and the anchor cannot go stale while any row is blocked.
//
// A BLOCKED ROW AND NOT A WRITTEN ONE, deliberately. A `written` row has its
// fixture on disk, and moving it fires assertion 2 as well -- a second finding
// the case did not aim at and could pass on by accident.
const seedWritableWithABlocker = (d) => {
  const row = fixtureRows(d).find(
    (r) => r.status === 'blocked' && (r.cells[2] ?? '').replace(/[`*]/g, '') !== '',
  );
  if (!row) throw new Error('seed anchor not found: no blocked row naming a blocker');
  const blocker = row.cells[2].replace(/[`*]/g, '');
  rewriteFixtureRow(
    d,
    (r) => r.id === row.id,
    (cells) => {
      cells[1] = 'writable';
    },
  );
  edit(d, FIXTURE_STATUS_PATH, (b) => {
    let out = bumpFixtureSummary(b, 'blocked', -1);
    out = bumpFixtureSummary(out, 'writable', 1);
    return bumpFixtureSummary(out, blocker, -1);
  });
  return row.id;
};

// Rewrite one row in place, marking its citation cell so `expect` can find it
// again after the property it was chosen by has been changed.
const rewriteFixtureRow = (d, pick, rewrite) => {
  const p = join(d, FIXTURE_STATUS_PATH);
  const lines = readFileSync(p, 'utf8').split('\n');
  const row = fixtureRows(d).find(pick);
  if (!row) throw new Error('seed anchor not found: no fixture row matching the seed predicate');
  const cells = [...row.cells];
  rewrite(cells);
  cells[3] = `${cells[3]} (${SEED_MARK})`;
  lines[row.n] = `| ${cells.join(' | ')} |`;
  writeFileSync(p, lines.join('\n'));
  return row.id;
};

// -----------------------------------------------------------------------------
// CI-06/identifier-series readers
// -----------------------------------------------------------------------------
// THESE ARE A SECOND, LOOSER READER ON PURPOSE, which is the arrangement CI-06l
// arrived at and recorded: the gate's reader is anchored and strict, the
// harness's finds the same site before and after the edit. A harness that
// imported the gate's own parser would agree with it by construction and could
// never catch it reading the wrong thing.
const DECLARED_TABLE = /const DECLARED_SERIES = new Map\(\[([\s\S]*?)^\]\);/m;
const PENDING_TABLE = /const PENDING_SERIES = new Map\(\[([\s\S]*?)^\]\);/m;
const WITHHELD_TABLE = /const WITHHELD_MEMBERS = new Map\(\[([\s\S]*?)^\]\);/m;

const seriesTable = (d, pattern) => {
  const src = readFileSync(join(d, 'scripts/corpus/gates.mjs'), 'utf8');
  const block = pattern.exec(src);
  if (!block) throw new Error('seed anchor not found: the series table in gates.mjs');
  const out = [];
  for (const m of block[1].matchAll(/^\s*\['([A-Za-z0-9-]+)',\s*(?:'|")/gm)) {
    const line = block[1].slice(m.index, block[1].indexOf('\n', m.index));
    const detail = /^\s*\['[A-Za-z0-9-]+',\s*(?:'([^']*)'|"([^"]*)")/.exec(line);
    out.push({ series: m[1], detail: (detail && (detail[1] ?? detail[2])) ?? '' });
  }
  if (out.length === 0) throw new Error('seed anchor not found: no rows in the series table');
  return out;
};

const walkMarkdown = (d, sub = '.', out = []) => {
  for (const e of readdirSync(join(d, sub))) {
    if (e === 'node_modules' || e === '.git') continue;
    const rel = sub === '.' ? e : `${sub}/${e}`;
    if (statSync(join(d, rel)).isDirectory()) walkMarkdown(d, rel, out);
    else if (rel.endsWith('.md')) out.push(rel);
  }
  return out;
};

const seriesMembersIn = (d) => {
  const members = new Map();
  for (const f of walkMarkdown(d)) {
    const masked = readFileSync(join(d, f), 'utf8').replace(/^```[\s\S]*?^```/gm, '');
    for (const m of masked.matchAll(/\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)-(\d{2,3})\b/g)) {
      if (!members.has(m[1])) members.set(m[1], new Set());
      members.get(m[1]).add(m[0]);
    }
  }
  return members;
};

// Definition sites for every identifier over the whole tree, ignoring the
// corpus/entry distinction the gate makes. Loose on purpose, per the note above.
const anySiteCounts = (d) => {
  const counts = new Map();
  for (const f of walkMarkdown(d)) {
    for (const line of readFileSync(join(d, f), 'utf8').split('\n')) {
      let text = null;
      if (/^#{1,6}\s/.test(line)) text = line.replace(/^#{1,6}\s+/, '');
      else if (line.startsWith('|')) text = line.split('|')[1] ?? '';
      if (text === null) continue;
      const m = /^[*`[]*([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)-(\d{2,3})\b/.exec(text.trim());
      if (m) counts.set(`${m[1]}-${m[2]}`, (counts.get(`${m[1]}-${m[2]}`) ?? 0) + 1);
    }
  }
  return counts;
};

// The first declared series whose register is a WHOLE FILE, with its first
// member. A section register would put an appended row OUTSIDE the section and
// the seed would change nothing, which is a seed reporting a gate that cannot
// fail. Re-derivable after the seed: appending a row for an EXISTING member
// changes the site count and never the member set or its ordering.
const declaredFileRegister = (d) => {
  const members = seriesMembersIn(d);
  for (const { series, detail } of seriesTable(d, DECLARED_TABLE)) {
    if (detail.includes('##') || !detail.endsWith('.md')) continue;
    const ids = [...(members.get(series) ?? [])].sort();
    if (ids.length === 0) continue;
    return { series, register: detail, id: ids[0] };
  }
  throw new Error('seed anchor not found: no declared series with a whole-file register');
};

// A WITHHELD MEMBER (ADR-074 section 5.1) and the declared register of the
// series it belongs to. The first whose register is a WHOLE FILE, for
// `declaredFileRegister`'s reason: a row appended to a file whose register is one
// `##` SECTION lands outside the section and seeds nothing.
//
// STABLE UNDER EVERY SEED BELOW, which is the CI-06l trap checked for rather
// than tripped over: all three read the TABLE in gates.mjs, and no seed here
// touches the declared or withheld tables except the control that deletes the
// entry, which is a control and re-derives nothing after itself.
const withheldMember = (d) => {
  const registers = new Map(seriesTable(d, DECLARED_TABLE).map((r) => [r.series, r.detail]));
  for (const row of seriesTable(d, WITHHELD_TABLE)) {
    const id = row.series;
    const series = id.replace(/-\d{2,3}$/, '');
    const register = registers.get(series);
    if (!register || register.includes('##') || !register.endsWith('.md')) continue;
    return { id, series, register };
  }
  throw new Error('seed anchor not found: no withheld member whose series has a whole-file register');
};

// The withheld identifier read back out of the row the seed wrote, which is the
// same discipline `seededPendingSeries` records and for a sharper reason here:
// the CONTROL below deletes the WITHHELD_MEMBERS entry, so re-deriving from the
// table after that seed would find an EMPTY table and throw inside `expect`
// rather than name the identifier the gate is about to report.
const CITED_SEED_MARK = 'cited, not defined';
const seededWithheldId = (d) => {
  for (const line of readFileSync(join(d, 'docs/GLOSSARY.md'), 'utf8').split('\n')) {
    if (!line.startsWith('|') || !line.includes(CITED_SEED_MARK)) continue;
    const m = /^\|\s*([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{2,3})\s*\|/.exec(line);
    if (m) return m[1];
  }
  throw new Error(`seed anchor not found: no row marked "${CITED_SEED_MARK}" in docs/GLOSSARY.md`);
};

// Every occurrence of one identifier, gone from every markdown file. The
// replacement carries NO CAPITALS on purpose: a substitute that looked like an
// identifier would delete one census member and mint another, and the case would
// pass on a finding about the wrong thing.
const eraseIdentifier = (d, id) => {
  let touched = 0;
  for (const f of walkMarkdown(d)) {
    const p = join(d, f);
    const body = readFileSync(p, 'utf8');
    if (!body.includes(id)) continue;
    writeFileSync(p, body.split(id).join('the number this session declined to mint'));
    touched++;
  }
  if (touched === 0) throw new Error(`seed anchor not found: ${id} appears in no markdown file`);
};

// The smallest pending series ALL of whose members have zero definition sites
// today, so appending one row each makes every member singly defined and the
// entry stops naming a defect. A member already at one site would reach two and
// the series would stay broken, which passes the case for the wrong reason.
const pendingWithNoSites = (d) => {
  const members = seriesMembersIn(d);
  const counts = anySiteCounts(d);
  let best = null;
  for (const { series } of seriesTable(d, PENDING_TABLE)) {
    const ids = [...(members.get(series) ?? [])];
    if (ids.length === 0 || ids.some((id) => (counts.get(id) ?? 0) !== 0)) continue;
    if (best === null || ids.length < best.ids.length) best = { series, ids: ids.sort() };
  }
  if (best === null) throw new Error('seed anchor not found: no pending series with zero sites');
  return best;
};

// The pending series the seed actually repaired, read back out of the rows it
// wrote. THIS IS THE CI-06l TRAP AND IT WAS WALKED INTO ON THE FIRST RUN, which
// is the harness working: `pendingWithNoSites` selects on "every member has zero
// sites", the seed gives every member a site, and re-deriving after the seed
// therefore names the NEXT series while the gate correctly names the one that
// was repaired. It was watched reporting FAILED OFF-TARGET in exactly that
// state. A seed that changes the property its own `expect` selects on must read
// its mark back rather than re-derive.
const seededPendingSeries = (d) => {
  for (const line of readFileSync(join(d, 'docs/GLOSSARY.md'), 'utf8').split('\n')) {
    if (!line.startsWith('|') || !line.includes(PENDING_SEED_MARK)) continue;
    const m = /^\|\s*([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)-\d{2,3}\s*\|/.exec(line);
    if (m) return m[1];
  }
  throw new Error(`seed anchor not found: no row marked ${PENDING_SEED_MARK} in docs/GLOSSARY.md`);
};
const PENDING_SEED_MARK = 'a definition site, seeded by falsify';

const presentAdrNumbers = (d) =>
  new Set(
    readdirSync(join(d, 'docs/decisions'))
      .map((f) => /^ADR-(\d{3})\.md$/.exec(f))
      .filter(Boolean)
      .map((m) => Number(m[1])),
  );

const presentMigrationNumbers = (d) =>
  new Set(
    readdirSync(join(d, 'packages/db/migrations'))
      .map((f) => /^(\d{4})_/.exec(f))
      .filter(Boolean)
      .map((m) => Number(m[1])),
  );

// ---------------------------------------------------------------------------
// CI-06/gate-inventory: readers for STRATEGY section 4.1
// ---------------------------------------------------------------------------
// EVERY SELECTOR BELOW IS STABLE UNDER ITS OWN SEED, checked rather than assumed,
// because the CI-06l trap is that `expect` resolves against the SEEDED tree. The
// obvious selector for case 1 -- "the first row naming a workflow" -- is NOT
// stable: the seed removes the workflow, so re-deriving names the NEXT row while
// the gate correctly names the one that moved. Selecting on `**Implemented`,
// which no seed here removes, is stable by construction.
const STRATEGY_PATH = 'docs/testing/STRATEGY.md';
const PIPELINE_HEADING = '### 4.1 Pipeline stages';

// The rows of section 4.1, bounded to the section as the gate bounds them. The
// Closure cell is taken as the LAST cell rather than by index, so a pipe added to
// an earlier column moves the seed rather than silently mutating a neighbour.
const pipelineRowsIn = (d) => {
  const body = readFileSync(join(d, STRATEGY_PATH), 'utf8');
  const start = body.indexOf(PIPELINE_HEADING);
  if (start === -1) throw new Error(`seed anchor not found: "${PIPELINE_HEADING}"`);
  const after = body.slice(start + PIPELINE_HEADING.length);
  const end = after.search(/\n### /);
  const rows = [];
  for (const line of (end === -1 ? after : after.slice(0, end)).split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split(/(?<!\\)\|/).slice(1, -1);
    const m = /^\s*\*{0,2}`?(CI-\d{2})`?\*{0,2}\s*$/.exec(cells[0] ?? '');
    if (m) rows.push({ id: m[1], closure: (cells[cells.length - 1] ?? '').trim() });
  }
  if (rows.length === 0) throw new Error('seed anchor not found: no CI-nn row in section 4.1');
  return rows;
};

// The first row of the table, by position and not by content, so it is stable
// under a seed that empties a Closure cell. Selecting on what the cell SAYS
// would re-derive to the NEXT row after the seed, which is the CI-06l trap.
const firstPipelineRow = (d) => pipelineRowsIn(d)[0];

const implementedRow = (d) => {
  const row = pipelineRowsIn(d).find((r) => r.closure.includes('**Implemented'));
  if (!row) throw new Error('seed anchor not found: no row claiming an implementation');
  return row;
};

// The first row carrying BOTH an implementation leg and a dated condition. Today
// that is CI-09, built on one leg of four by session 114, and it is the row the
// whole partial-implementation ruling turns on.
const bothLegsRow = (d) => {
  const row = pipelineRowsIn(d).find(
    (r) => r.closure.includes('**Implemented') && /\bwaiting,\s*\d{4}-\d{2}-\d{2}/i.test(r.closure),
  );
  if (!row) throw new Error('seed anchor not found: no row carrying an implementation AND a condition');
  return row;
};

const firstArtifactRow = (d) => {
  const row = pipelineRowsIn(d).find((r) => /Artifact:\s*\*\*(.+?)\*\*/.test(r.closure));
  if (!row) throw new Error('seed anchor not found: no row carrying an `Artifact: **...**` clause');
  return row;
};

// CI-07's artifact is a PATH since ADR-095 re-ruled it from a manifest key, so
// this selector returns the app DIRECTORY where it used to return the manifest.
// Derived rather than spelled: a seed naming `apps/admin` goes vacuous the day
// that directory is renamed, and reads as coverage while asserting nothing. The
// selector is stable under its own seed, which is why it is the first app by name
// and not the first app carrying some property the seed then adds.
const firstAppDir = (d) => {
  const app = readdirSync(join(d, 'apps'))
    .sort()
    .find((a) => existsSync(join(d, 'apps', a, 'package.json')));
  if (!app) throw new Error('seed anchor not found: no apps/*/package.json');
  return `apps/${app}`;
};

// ---------------------------------------------------------------------------
// CI-06/vg-inventory: readers for STRATEGY section 4.2
// ---------------------------------------------------------------------------
// Same bounding rule as 4.1's readers above, and the same stability discipline:
// every selector below is chosen so that its own seed does not move it.
const VG_HEADING = '### 4.2 The `VG` gates';

const vgRowsIn = (d) => {
  const body = readFileSync(join(d, STRATEGY_PATH), 'utf8');
  const start = body.indexOf(VG_HEADING);
  if (start === -1) throw new Error(`${STRATEGY_PATH}: "${VG_HEADING}" not found`);
  const after = body.slice(start + VG_HEADING.length);
  const end = after.search(/\n### /);
  const rows = [];
  for (const line of (end === -1 ? after : after.slice(0, end)).split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.trim().replace(/^\||\|$/g, '').split('|');
    const m = /^\s*\*{0,2}`?(VG-\d{1,2})\b/.exec(cells[0] ?? '');
    if (!m) continue;
    rows.push({ id: m[1], closure: (cells[cells.length - 1] ?? '').trim() });
  }
  if (rows.length === 0) throw new Error('no VG rows parsed; the seed anchor has moved');
  return rows;
};

/** The first row carrying a chained leg. Stable: no seed here removes a chain. */
const chainedVgRow = (d) => {
  const row = vgRowsIn(d).find((r) => /\*\*Chained,/.test(r.closure));
  if (!row) throw new Error('no chained VG row; the chain-expiry seed has no anchor');
  return row;
};

/** The first row carrying a waiting leg with an artifact. */
const waitingVgRow = (d) => {
  const row = vgRowsIn(d).find((r) => /\bwaiting,/i.test(r.closure) && /Artifact:/.test(r.closure));
  if (!row) throw new Error('no waiting VG row with an artifact');
  return row;
};

/** The first row carrying a Wired leg with a bolded step. */
const wiredVgRow = (d) => {
  // The forms are the table's own: `steps \`a\` and \`b\``, `step \`a\``. Read off
  // the rows rather than assumed; a first version matched `**\`x\`**` and matched
  // nothing, which made the gate's step assertion vacuous.
  const row = vgRowsIn(d).find((r) => /\*\*Wired\b/.test(r.closure) && /\bsteps?\s+`/.test(r.closure));
  if (!row) throw new Error('no wired VG row naming a step');
  return row;
};

/** A waiting row whose artifact NO OTHER row waits on, so re-wording it empties a register entry. */
const soleWaiterVgRow = (d) => {
  const rows = vgRowsIn(d).filter((r) => /Artifact:\s*\*\*/.test(r.closure));
  const art = (r) => /Artifact:\s*\*\*(.+?)\*\*/.exec(r.closure)?.[1] ?? '';
  const counts = new Map();
  for (const r of rows) counts.set(art(r), (counts.get(art(r)) ?? 0) + 1);
  const row = rows.find((r) => counts.get(art(r)) === 1);
  if (!row) throw new Error('every waiting artifact has more than one waiter; the seed has no anchor');
  return row;
};

const LOCKFILE = 'pnpm-lock.yaml';

const SCOPE_CASES = [
  // -------------------------------------------------------------------------
  // CI-06/retired-constraints. Six cases, on CI-06o's rule that a gate
  // asserting several unrelated things and watched failing on one is taken on
  // trust for the rest. The SEEDS entry watches a NEW file; these watch the
  // register in both directions, the vacuity throw, and both edges of the
  // anchored match.
  // -------------------------------------------------------------------------
  {
    name: 'CI-06/retired-constraints/a-fourth-citation-in-a-registered-file',
    gate: 'CI-06/retired-constraints',
    what: 'one MORE citation inside a file the register already holds, which is the fourth this gate exists to stop',
    // THE CASE THE GATE WAS BUILT FOR. A register that said only "this file is
    // known" would take the next citation in silence, which is how three
    // arrived in one file before anybody counted. The count is pinned, so the
    // fourth has to be decided rather than merged.
    expect: (d) => {
      const e = retiredRegisterIn(d)[0];
      return `${e.file}: carries ${e.sites + 1} citation(s)`;
    },
    seed: (d) => {
      const e = retiredRegisterIn(d)[0];
      const { name } = retiredNamesIn(d)[0];
      edit(d, e.file, (b) => `${b}\nseeded by falsify.mjs: ${name}\n`);
    },
  },
  {
    name: 'CI-06/retired-constraints/the-register-shrinks-when-a-site-is-repaired',
    gate: 'CI-06/retired-constraints',
    what: 'a register entry standing ABOVE what its file holds, which is the stale direction CI06U_REGISTER’s property requires',
    // The register SHRINKS ONLY. The day a site is repaired is the day its
    // number moves, and an entry left standing is a repair nobody recorded. The
    // seed raises the number rather than repairing the file, which is the same
    // discrepancy from the other side and needs no judgement about which line
    // in a live document may be deleted.
    expect: (d) => {
      const e = retiredRegisterIn(d)[0];
      return `${e.file}: carries ${e.sites - 1} citation(s) of a retired constraint and RETIRED_REGISTER claims ${e.sites}`;
    },
    seed: (d) => {
      const e = retiredRegisterIn(d)[0];
      const path = e.file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const anchor = new RegExp(`('${path}',\\s*\\{\\s*sites:\\s*)${e.sites}\\b`);
      edit(d, 'scripts/corpus/gates.mjs', (b) => once(b, anchor, `$1${e.sites + 1}`));
    },
  },
  {
    name: 'CI-06/retired-constraints/a-register-entry-that-names-nothing',
    gate: 'CI-06/retired-constraints',
    what: 'a register entry for a file that cites nothing at all, which is the other half of the shrink-only property',
    expect: () => 'and no line in it cites a retired constraint',
    seed: (d) => {
      if (!existsSync(join(d, RETIRED_CLEAN_FILE))) {
        throw new Error(`seed anchor not found: ${RETIRED_CLEAN_FILE}`);
      }
      const body = readFileSync(join(d, RETIRED_CLEAN_FILE), 'utf8');
      for (const { name } of retiredNamesIn(d)) {
        if (retiredNameRe(name).test(body)) {
          throw new Error(
            `seed anchor not found: ${RETIRED_CLEAN_FILE} already cites a retired constraint`,
          );
        }
      }
      if (retiredRegisterIn(d).some((e) => e.file === RETIRED_CLEAN_FILE)) {
        throw new Error(`seed anchor not found: ${RETIRED_CLEAN_FILE} is already registered`);
      }
      edit(d, 'scripts/corpus/gates.mjs', (b) =>
        once(
          b,
          'const RETIRED_REGISTER = new Map([',
          'const RETIRED_REGISTER = new Map([\n  [\n    ' +
            `'${RETIRED_CLEAN_FILE}',\n    { sites: 1, why: 'seeded by falsify.mjs' },\n  ],`,
        ),
      );
    },
  },
  {
    name: 'CI-06/retired-constraints/no-retired-name-parses-at-all',
    gate: 'CI-06/retired-constraints',
    what: 'a migration directory in which every dropped name is re-added, which empties the needle list and makes every assertion below it hold vacuously',
    // RULE 2, AND THE ONE A SEEDED GATE OF THIS SHAPE MOST NEEDS. Every
    // assertion this gate makes is a scan for a list of names, so a run that
    // parses zero names reports a clean tree for the one reason that means
    // nothing was checked. It must THROW, and an ERROR is a non-zero exit
    // rather than a skip.
    expect: () => 'no retired constraint name',
    seed: (d) => {
      const names = retiredNamesIn(d);
      const number = nextFreeMigration(d);
      writeFileSync(
        join(d, `packages/db/migrations/${number}_falsify_readds_every_retired_name.sql`),
        `${names
          .map(({ name }) => `ALTER TABLE seeded_by_falsify ADD CONSTRAINT ${name} CHECK (true);`)
          .join('\n')}\n`,
      );
    },
  },
  {
    name: 'CI-06/retired-constraints/a-session-log-is-a-dated-record',
    gate: 'CI-06/retired-constraints',
    what: 'a retired constraint named in a dated session log, which records a position rather than describing the schema and must NOT be read',
    // MUST NOT FIRE. A session log is a record of what was true on a date, and
    // rewriting one destroys the only thing it is for: session 129's finding is
    // stale as a claim about today and correct as a record, which is why
    // session 132 refuted it in a new entry rather than editing the old one.
    expect: () => 'PASS',
    control: {
      expect: (d) => `cites the retired constraint \`${retiredNamesIn(d)[0].name}\``,
      seed: seedBareRetiredName,
    },
    seed: (d) => {
      const { name } = retiredNamesIn(d)[0];
      edit(d, latestSessionLogIn(d), (b) => `${b}\n<!-- seeded by falsify.mjs: ${name} -->\n`);
    },
  },
  {
    name: 'CI-06/retired-constraints/the-filename-and-the-suffix-are-not-citations',
    gate: 'CI-06/retired-constraints',
    what: 'a link to the superseding migration and a LONGER identifier built on the retired name, neither of which is a citation of it',
    // MUST NOT FIRE, AND BOTH EDGES ARE LOAD-BEARING HERE RATHER THAN
    // HYPOTHETICAL. One supersession names its replacement by SUFFIXING the
    // retired name, so a loose right edge reports the LIVE constraint at every
    // site naming it; and each supersession migration's own filename embeds the
    // retired name after `supersede_`, so a loose left edge turns every link to
    // that file, in INDEX, in ALLOCATION and in a dozen session logs, into a
    // finding. This is the @vitest/browser-playwright lesson on a name that is
    // a prefix of a live one.
    expect: () => 'PASS',
    control: {
      expect: (d) => `cites the retired constraint \`${retiredNamesIn(d)[0].name}\``,
      seed: seedBareRetiredName,
    },
    seed: (d) => {
      const { name, file } = supersededByFilenameIn(d);
      writeFileSync(
        join(d, RETIRED_SEED_DOC),
        `Superseded by [\`${file}\`](../../packages/db/migrations/${file}); the live ` +
          `constraint is \`${name}_seeded_suffix\`.\n`,
      );
    },
  },

  // -------------------------------------------------------------------------
  // CI-06/vg-inventory. Six cases, on CI-06o's rule that a gate asserting
  // several unrelated things and watched failing on one is taken on trust for
  // the rest. The chain-expiry case is the one this gate exists for.
  // -------------------------------------------------------------------------
  {
    name: 'CI-06/vg-inventory/no-disposition-at-all',
    gate: 'CI-06/vg-inventory',
    what: 'a VG row carrying no leg at all, which is ADR-080’s headline case',
    expect: (d) => `${vgRowsIn(d)[0].id} carries no leg at all`,
    seed: (d) => {
      const row = vgRowsIn(d)[0];
      edit(d, STRATEGY_PATH, (b) => once(b, row.closure, 'not decided yet'));
    },
  },
  {
    name: 'CI-06/vg-inventory/wired-names-no-step',
    gate: 'CI-06/vg-inventory',
    what: 'a Wired row whose named step resolves nowhere, which is ADR-080 section 3’s strictly-stronger half',
    // THE HALF 4.1 DOES NOT ASSERT. A workflow link and a job key both keep
    // resolving after a step is renamed, so a Wired row can go on naming a run
    // that stopped existing.
    expect: (d) => `${wiredVgRow(d).id} names step \`no-such-step\``,
    seed: (d) => {
      const row = wiredVgRow(d);
      edit(d, STRATEGY_PATH, (b) =>
        once(b, row.closure, row.closure.replace(/(\bsteps?\s+)`[^`]+`/, '$1`no-such-step`')),
      );
    },
  },
  {
    name: 'CI-06/vg-inventory/chained-on-an-implemented-row',
    gate: 'CI-06/vg-inventory',
    what: 'a chain pointed at a 4.1 row that IS implemented, which is the expiry ADR-080 (d) rules and the reason this gate exists',
    // THE CASE THE GATE WAS BUILT FOR. A chained leg is a claim about ANOTHER
    // TABLE, so it goes stale with no edit to the row that carries it, and
    // section 4.2 reads identically whether the rule discriminates or has
    // stopped. CI-01 is chosen because it is implemented outright and no seed
    // here touches it.
    expect: (d) => `${chainedVgRow(d).id} is "Chained on CI-01"`,
    seed: (d) => {
      const row = chainedVgRow(d);
      edit(d, STRATEGY_PATH, (b) =>
        once(b, row.closure, row.closure.replace(/on `CI-\d{2}`/, 'on `CI-01`')),
      );
    },
  },
  {
    name: 'CI-06/vg-inventory/condition-with-no-artifact',
    gate: 'CI-06/vg-inventory',
    what: 'a waiting leg naming no artifact, which is the ADR-073 form ADR-080 inherits',
    expect: (d) => `${waitingVgRow(d).id} is waiting and names 0 artifacts`,
    seed: (d) => {
      const row = waitingVgRow(d);
      edit(d, STRATEGY_PATH, (b) =>
        once(b, row.closure, row.closure.replace(/Artifact:\s*\*\*.+?\*\*/, 'Artifact: soon')),
      );
    },
  },
  {
    name: 'CI-06/vg-inventory/register-shrinks-when-an-artifact-is-re-ruled',
    gate: 'CI-06/vg-inventory',
    what: 'a register entry naming no live condition, which is the stale direction CI06U_REGISTER’s property requires',
    // The register must SHRINK when ADR-080 re-rules an artifact into a path.
    // Re-wording the row leaves the entry naming nothing, and a register that
    // only ever grows stops being a decision and becomes a list.
    expect: () => 'and no section 4.2 row waits on it',
    // THE SEED MUST REMOVE THE LAST WAITER, not any waiter. `fastify` has TWO
    // (VG-3 and VG-6), so re-wording one leaves the register entry live and the
    // case fires on the wrong finding. Found by running it. `soleWaiterVgRow`
    // picks a row whose artifact nothing else waits on.
    seed: (d) => {
      const row = soleWaiterVgRow(d);
      edit(d, STRATEGY_PATH, (b) =>
        once(b, row.closure, row.closure.replace(/Artifact:\s*\*\*(.+?)\*\*/, 'Artifact: **something else entirely**')),
      );
    },
  },
  {
    name: 'CI-06/vg-inventory/fastify-near-miss',
    gate: 'CI-06/vg-inventory',
    what: 'fastify-plugin in the lockfile must NOT reopen a row waiting on fastify (the substring lesson)',
    // RETAINED VERBATIM ON 2026-08-25 AND NO LONGER BOUNDING A LIVE PROBE, and
    // that is stated rather than left for a reader to work out. ADR-100 re-ruled
    // VG-3 and VG-6 off the lockfile, so `VG_PROBES` no longer holds a fastify
    // entry and this seed can no longer reopen anything. It still PASSES, and it
    // is neither deleted nor repointed for one reason: ADR-085's SIGNED approval
    // clause cites this case BY NAME -- "while `fastify-plugin` seeded into the
    // lockfile does NOT reopen the row" -- and a signed entry moves by a
    // superseding ADR and never by a session. Deleting it would leave that
    // citation resolving to nothing; repointing its seed would make its name and
    // ADR-085's sentence describe something it does not do.
    //
    // THE LIVE ANCHORING CASE IS `scoped-db-near-miss` BELOW, and ADR-085's
    // clause having gone stale is recorded in ADR-100 section 7 as a finding for
    // a superseding entry rather than repaired here.
    expect: () => 'PASS',
    seed: (d) => {
      edit(d, LOCKFILE, (b) => `${b}\n  fastify-plugin@5.0.1:\n    resolution: {integrity: sha512-seeded}\n`);
    },
  },
  {
    name: 'CI-06/vg-inventory/scoped-db-near-miss',
    gate: 'CI-06/vg-inventory',
    what: 'scopedDbFixture inside apps/api must NOT reopen a row waiting on scopedDb (the substring lesson)',
    // MUST NOT FIRE. `scopedDbFixture` contains `scopedDb`, so a probe matching
    // on substring reports the artifact ARRIVED on a name that is not it, and
    // passes in exactly the same way as one that works. This is the
    // @vitest/browser-playwright case carried onto the artifact ADR-100 re-ruled
    // these rows onto. Its control is the SEEDS entry for this gate, which seeds
    // a real `scopedDb` call and requires HAS ARRIVED.
    expect: () => 'PASS',
    seed: (d) => {
      const rel = 'apps/api/src/falsify_near_miss.ts';
      if (existsSync(join(d, rel))) {
        throw new Error(`seed anchor not found: ${rel} already exists`);
      }
      writeFileSync(
        join(d, rel),
        '// seeded by falsify.mjs\nexport const a = scopedDbFixture;\nexport const b = unscopedDbThing;\n',
      );
    },
  },

  // -------------------------------------------------------------------------
  // CI-06/gate-inventory. Six cases, because ONE SEED WATCHES ONE ASSERTION and
  // this gate makes four: the (a) job resolution in two halves, the (b) form
  // inside a row that is ALSO implemented, and the register's stale direction.
  // CI-06o's row states the rule these follow: a gate asserting several
  // unrelated things and watched failing on one of them is taken on trust for
  // the rest. The sixth is a SCOPE case rather than an assertion: it bounds the
  // probe that fires, which is the half a near-miss is for.
  // -------------------------------------------------------------------------
  {
    name: 'CI-06/gate-inventory/no-disposition-at-all',
    gate: 'CI-06/gate-inventory',
    what: "a row carrying none of the three dispositions, which is ADR-073's headline case",
    // WATCHED HERE RATHER THAN IN `SEEDS`, deliberately and with the cost stated.
    // The seeded violation is the ARRIVAL, because that is the assertion ADR-073
    // section 8 says an implementer leaves out. This one is the ruling's own
    // sentence -- "a row that is none of the three is a finding" -- and it is the
    // state every row of this table was in before W5 added the Closure column, so
    // leaving it unwatched would take the gate's primary assertion on trust.
    expect: (d) => `${firstPipelineRow(d).id} carries no disposition`,
    seed: (d) => {
      const row = firstPipelineRow(d);
      edit(d, STRATEGY_PATH, (b) => once(b, row.closure, 'deferred for now'));
    },
  },
  {
    name: 'CI-06/gate-inventory/implementation-names-no-workflow',
    gate: 'CI-06/gate-inventory',
    what: "an implemented row naming no workflow, which is the defect this branch repaired in CI-09's own row",
    // NOT HYPOTHETICAL. CI-09's Closure cell read "Implemented for the simulation
    // harness only" and named neither nightly.yml nor a job, because W5 wrote the
    // row before session 114 wrote the workflow. ADR-073 (a) is the file AND the
    // job, and a claim naming neither is a claim about a run nobody can check.
    expect: (d) => `${implementedRow(d).id} claims an implementation and names no workflow`,
    seed: (d) => {
      const row = implementedRow(d);
      edit(d, STRATEGY_PATH, (b) =>
        once(b, row.closure, row.closure.replace(/\[`[^`]+\.ya?ml`\]\([^)]*\)/, 'a workflow')),
      );
    },
  },
  {
    name: 'CI-06/gate-inventory/job-must-resolve',
    gate: 'CI-06/gate-inventory',
    what: 'a row naming a job the workflow it names does not have',
    // THE HALF THAT ROTS QUIETLY. A workflow link keeps resolving after a job is
    // renamed, so a row can go on claiming an implementation that stopped
    // existing, and nothing else in this corpus reads that cell.
    expect: (d) => `${implementedRow(d).id} names job \`no-such-job\``,
    seed: (d) => {
      const row = implementedRow(d);
      edit(d, STRATEGY_PATH, (b) =>
        once(b, row.closure, row.closure.replace(/\bjob `[A-Za-z0-9_-]+`/, 'job `no-such-job`')),
      );
    },
  },
  {
    name: 'CI-06/gate-inventory/condition-inside-an-implemented-row',
    gate: 'CI-06/gate-inventory',
    what: 'a malformed condition in a row that ALSO carries an implementation, which must still be read',
    // THIS IS THE CASE THE WHOLE PARTIAL-IMPLEMENTATION RULING RESTS ON. Session
    // 114 built one of CI-09's four legs. A gate that asks "is this row
    // implemented", sees the word, and stops READS ONE LEG AS FOUR -- and it
    // would go silent on exactly this seed. A disposition applies to a leg and
    // never to a row, and the only way to prove a runner believes that is to
    // break a condition sitting behind an implementation and watch it reported.
    expect: (d) => `${bothLegsRow(d).id} carries a condition dated`,
    seed: (d) => {
      const row = bothLegsRow(d);
      edit(d, STRATEGY_PATH, (b) =>
        once(b, row.closure, row.closure.replace(/\s*Artifact:\s*\*\*[^*]+\*\*\.?/, '')),
      );
    },
  },
  // ---------------------------------------------------------------------------
  // THE TWO PLAYWRIGHT CASES ARE RETIRED, WITH THE PROBE THEY AIMED AT
  // ---------------------------------------------------------------------------
  // `CI-06/gate-inventory/playwright-peer-declaration-is-not-an-install` and
  // `CI-06/gate-inventory/playwright-near-miss` both seeded a lockfile and
  // demanded that CI-08's needle read INSTALLED versus MENTIONED correctly.
  // THE ARTIFACT ARRIVED (ADR-116): `@playwright/test@1.56.1` is an entry key in
  // pnpm-lock.yaml, CI-08's row is implemented, and gates.mjs retired
  // `playwrightInLockfile` in the same commit because the register's own rule
  // makes a probe naming no live condition a finding. A falsification case
  // aimed at a probe that no longer exists is that same shape one level up.
  //
  // WHAT THEIR REMOVAL COSTS, STATED RATHER THAN ABSORBED. Both controls had
  // already stopped being seedable on the arrival commit: the first threw
  // "the lockfile already holds a @playwright/test entry" because its seed
  // asserts the absence it was written against, and the second could no longer
  // produce "HAS ARRIVED" because no row waits on that artifact. Measured, not
  // reasoned: `node scripts/corpus/falsify.mjs` reported both as CONTROL DID
  // NOT FIRE before this edit. What goes with them is the ONLY executable
  // statement in this repository that a peer declaration is not an install; the
  // statement survives as prose at gates.mjs's retirement note and in the
  // pnpm-workspace.yaml catalog comment, and as prose it is weaker. That is the
  // honest cost of the artifact arriving, and it is recorded in ADR-116
  // section 7 rather than left for a reader to notice the file got shorter.
  {
    name: 'CI-06/gate-inventory/register-shrinks-when-an-artifact-is-re-ruled',
    gate: 'CI-06/gate-inventory',
    what: 'a register entry naming a condition the table no longer carries, which must be a finding',
    // THE DIRECTION NOBODY LOOKS, and it is what separates a register from an
    // exemption list. Four of the six conditions name neither a path nor a
    // manifest key, which ADR-073 section 2 (b) requires, so four sit in
    // UNPROBEABLE_ARTIFACTS waiting for a ruling that gives them one. The day
    // that ruling lands the wording moves, and an entry that went on matching
    // nothing would silence the gate on the very condition that just became
    // readable. CI06U_REGISTER and CI06FIXTURE_REGISTER carry the same property.
    expect: `and no condition in ${STRATEGY_PATH} section 4.1 names it`,
    seed: (d) => {
      const row = firstArtifactRow(d);
      edit(d, STRATEGY_PATH, (b) =>
        once(
          b,
          row.closure,
          row.closure.replace(/(Artifact:\s*\*\*)([^*]+)(\*\*)/, '$1$2, re-ruled$3'),
        ),
      );
    },
  },
  {
    name: 'CI-06f/t3-stale-reservation',
    gate: 'CI-06f',
    what: 'an ADR row still reading "Reserved, unwritten" once its entry exists, which MUST be a finding',
    expect: (d) =>
      `ADR-${String(reserveLandedRow(d, '## Number allocation', (n) => n, presentAdrNumbers(d))).padStart(3, '0')}: the allocation row still reads "Reserved, unwritten"`,
    seed: () => {},
  },
  {
    name: 'CI-06h/t3-stale-reservation',
    gate: 'CI-06h',
    what: 'a migration row still reading "Reserved, unwritten" once its file exists, which MUST be a finding',
    expect: (d) =>
      `${String(reserveLandedRow(d, '## Migration number allocation', (n) => n, presentMigrationNumbers(d))).padStart(4, '0')}: the allocation row still reads "Reserved, unwritten"`,
    seed: () => {},
  },
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
    name: 'CI-06s/wired-but-unpinned',
    gate: 'CI-06s',
    what: 'a probe the workflow RUNS that CI-06h does not pin, which is OI-07 exactly',
    // SEEDED AFTER THE REPAIR AND ON A DIFFERENT PROBE, deliberately. This
    // session repaired the real fourth occurrence
    // (probe_rule_states_high_water_bound.sql) before writing this case. Seeding
    // the repaired probe would make the seed and the repair prove each other and
    // neither would prove the gate, so the case invents its own probe, wires it,
    // and leaves it unpinned -- which is the state the three real occurrences
    // were in.
    expect: 'is not pinned by CI-06h',
    seed: (d) => {
      writeFileSync(
        join(d, 'scripts/db/probe_seeded_unpinned.sql'),
        '-- Wired below, pinned nowhere. One delete from never running again.\n',
      );
      edit(d, '.github/workflows/corpus.yml', (b) =>
        b.replace(
          /(\n\s+psql -v ON_ERROR_STOP=1 -q -f scripts\/db\/probe_ledger_constraints\.sql)/,
          '$1\n          psql -v ON_ERROR_STOP=1 -q -f scripts/db/probe_seeded_unpinned.sql',
        ),
      );
    },
  },
  {
    name: 'CI-06s/stale-needle-names-a-probe-nobody-provides',
    gate: 'CI-06s',
    what: "a needle in CI-06h's list naming a probe that no file provides",
    // THE DIRECTION NOBODY LOOKS, and CI-06l's record says the stale-entry
    // checks are the ones that earn a gate for exactly this reason: A LIST
    // NAMING SOMETHING THAT NO LONGER EXISTS STILL LOOKS COMPLETE. Rename a
    // probe, update the workflow, and CI-06h goes on pinning a filename that
    // cannot be deleted because it is already gone. Every gate stays green and
    // the needle asserts nothing.
    expect: 'and no file provides it',
    seed: (d) => {
      edit(d, 'scripts/corpus/gates.mjs', (b) =>
        b.replace(
          /(\n {6}\[\n {8}'assert_no_floats\.sql',)/,
          "\n      ['probe_deleted_last_spring.sql', 'a probe nobody provides is no longer run'],$1",
        ),
      );
    },
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
    name: 'CI-06m/widened-definition-is-not-a-fourth-token',
    gate: 'CI-06m',
    what: 'a fourth unit token invented for the counterparty ADR-082 widened `rail clock` to cover, which MUST be a finding',
    // ADR-082's OWN CHECKABLE CLAUSE, and it is here because that ruling widened
    // a definition and a widened definition is exactly what invites a session to
    // widen the SET next.
    //
    // `rail clock` now reads "a third party's own clock ... a payment rail's, a
    // calibration vendor's, any counterparty whose day Merit reads and never
    // derives". The nearest thing to a correct guess after reading that sentence
    // is `vendor clock`, written by a session that took "a calibration vendor's"
    // for a licence rather than for a definition. It is refused, and the refusal
    // is watched here rather than asserted in the ADR, because a token nobody
    // has seen rejected is not a closed vocabulary.
    //
    // THE SEED TARGETS A `rail clock` ROW ON PURPOSE. Any declaring row would
    // produce the same finding, and would prove less: the rows this ruling
    // touched are the ones whose declarations a slide would move first, and
    // seeding one of them says the widening reached the definition and stopped
    // there.
    //
    // DERIVED, LIKE THE CASE ABOVE. A seed naming
    // `simulation_runs.calibration_observed_at` by literal would go stale the day
    // that column is superseded and would go stale SILENTLY, planting nothing
    // while still reporting a run.
    expect: 'declares `**Unit: vendor clock**`, which is not one of',
    seed: (d) => {
      const dir = join(d, 'docs/architecture/data-model');
      for (const f of readdirSync(dir).sort()) {
        if (!f.endsWith('.md')) continue;
        const p = join(dir, f);
        const lines = readFileSync(p, 'utf8').split('\n');
        const i = lines.findIndex((l) => /\*\*Unit: rail clock\*\*/.test(l));
        if (i === -1) continue;
        lines[i] = lines[i].replace(/\*\*Unit: rail clock\*\*/, '**Unit: vendor clock**');
        writeFileSync(p, lines.join('\n'));
        return;
      }
      throw new Error('seed anchor not found: no design-record row declares `rail clock`');
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
    name: 'CI-06v/a-heading-between-two-tables-is-not-a-finding',
    gate: 'CI-06v',
    what: 'two genuinely separate tables split by a HEADING, which must NOT be a finding',
    expect: 'PASS',
    // THE BOUNDARY IS THE RUN, NOT THE DOCUMENT. A heading is a non-pipe line,
    // so it ends the run exactly as a blank line does, and the two tables are
    // two runs that each carry their own delimiter. This case exists because
    // the obvious wrong implementation counts delimiters per FILE or per
    // SECTION, and both readings pass the seed above while calling every
    // multi-table document in this corpus a finding.
    //
    // The control keeps the heading and deletes the second delimiter, which is
    // the single edit that turns two lawful tables into one lawful table and
    // one orphan.
    control: {
      expect: 'consecutive pipe lines carry no delimiter row',
      seed: (d) =>
        edit(
          d,
          'docs/GLOSSARY.md',
          (b) =>
            `${b}\n<!-- control -->\n\n| Term | Meaning |\n|---|---|\n| ctl-a | first table |\n\n` +
            `#### A heading between them\n\n| Term | Meaning |\n| ctl-b | second table, no delimiter |\n`,
        ),
    },
    seed: (d) =>
      edit(
        d,
        'docs/GLOSSARY.md',
        (b) =>
          `${b}\n<!-- seeded -->\n\n| Term | Meaning |\n|---|---|\n| scope-a | first table |\n\n` +
          `#### A heading between them\n\n| Term | Meaning |\n|---|---|\n| scope-b | second table |\n`,
      ),
  },
  {
    name: 'CI-06v/a-pipe-line-inside-a-fence-claims-nothing',
    gate: 'CI-06v',
    what: 'an orphan-shaped fragment inside a fenced block, which must NOT be a finding',
    expect: 'PASS',
    // A worked example of a broken table is exactly what a document ABOUT this
    // gate would quote, and CI-06t masks fences for the same reason. Without
    // this case, the first entry explaining CI-06v to a reader becomes a
    // finding against itself.
    //
    // The control is the identical text with the fence removed, which is the
    // single edit that separates quoted prose from corpus content.
    control: {
      expect: 'consecutive pipe lines carry no delimiter row',
      seed: (d) =>
        edit(
          d,
          'docs/GLOSSARY.md',
          (b) => `${b}\n<!-- control -->\n\n| ctl-x | no delimiter |\n| ctl-y | none here either |\n`,
        ),
    },
    seed: (d) =>
      edit(
        d,
        'docs/GLOSSARY.md',
        (b) =>
          `${b}\n<!-- seeded -->\n\n\`\`\`\n| fenced-x | no delimiter |\n| fenced-y | none here either |\n\`\`\`\n`,
      ),
  },
  {
    name: 'CI-06v/a-single-pipe-line-claims-nothing',
    gate: 'CI-06v',
    what: 'ONE isolated pipe line, which must NOT be a finding',
    expect: 'PASS',
    // ORPHAN_MIN_ROWS IS 2 AND THIS CASE IS WHERE THAT CHOICE IS ASSERTED
    // RATHER THAN STATED. A single line starting with a pipe is prose: a
    // sentence, or a one-row table quoted illustratively. Measured over docs/
    // when the gate was written, there are ZERO of them, so the concession
    // costs nothing today and is made against tomorrow.
    //
    // The control adds ONE adjacent pipe line and nothing else, so the pair
    // brackets the minimum exactly: one passes, two fire. A future edit
    // dropping the minimum to 1 fires this case; a future edit raising it to 3
    // stops the control.
    control: {
      expect: 'consecutive pipe lines carry no delimiter row',
      seed: (d) =>
        edit(
          d,
          'docs/GLOSSARY.md',
          (b) => `${b}\n<!-- control -->\n\n| ctl-solo | and a second line below it |\n| ctl-pair | which makes a run of two |\n`,
        ),
    },
    seed: (d) =>
      edit(
        d,
        'docs/GLOSSARY.md',
        (b) => `${b}\n<!-- seeded -->\n\n| solo-line | one pipe line alone is prose |\n`,
      ),
  },
  // ---------------------------------------------------------------------------
  // CI-06w. THE SEED PROVES IT FIRES ON TWO VERBATIM ROWS. Neither case below
  // is that shape, because two verbatim rows is the population the gate is
  // easiest to get right on.
  //
  // Both boundaries name a way to write the SAME gate and have it be wrong in
  // one direction only, and each is pinned from both sides. A duplicate gate is
  // relaxed by making it quieter, so a case asserting only PASS proves nothing:
  // every `expect: 'PASS'` here carries a control that must fire.
  // ---------------------------------------------------------------------------
  {
    name: 'CI-06w/adjacent-ranges-do-not-overlap',
    gate: 'CI-06w',
    what: 'a range row claiming numbers that BEGIN where the table stops, which must NOT be a finding',
    expect: 'PASS',
    // THE ALLOCATION TABLES ARE WRITTEN IN RANGES -- `001 to 032`, `0001 to
    // 0028` -- and a gate reading the first cell as a LITERAL passes both sides
    // of this pair. It would report two rows reading `0034` and stay silent on
    // `0001 to 0034` beside `0034`, which is the same double claim written the
    // way this table actually writes claims.
    //
    // The pair is two two-number ranges, shifted past each other by two. The
    // seed's BEGINS at the first free number, so it touches the table's top
    // without overlapping it: adjacency is not a claim. The control's ENDS at
    // the highest claimed number, so both of its numbers are claimed twice.
    //
    // NEITHER RANGE MOVES THE FIRST FREE NUMBER, which is why the control's
    // range sits entirely inside the claimed region rather than straddling the
    // top by one. A straddling range would claim `free` and push `nextFree`
    // upward, and `expect` -- resolved against the SEEDED tree -- would then
    // name a number claimed only once and report a working gate as broken.
    // That is the `CI-06l` lesson again, and it bit here during writing.
    control: {
      expect: (d) => `${lastClaimedMigration(d)} is claimed by 2 rows`,
      seed: (d) => {
        const top = lastClaimedMigration(d);
        const from = String(Number(top) - 1).padStart(4, '0');
        edit(d, 'docs/decisions/ALLOCATION.md', (b) =>
          addMigrationRow(b, `${from} to ${top}`, 'a range ending ON the highest claimed number'),
        );
      },
    },
    seed: (d) => {
      const free = nextFreeMigration(d);
      const top = String(Number(free) + 1).padStart(4, '0');
      edit(d, 'docs/decisions/ALLOCATION.md', (b) =>
        addMigrationRow(b, `${free} to ${top}`, 'a range beginning where the table stops'),
      );
    },
  },
  {
    name: 'CI-06w/one-number-in-two-different-tables-is-two-claims',
    gate: 'CI-06w',
    what: 'the same number claimed once in the ADR table and once in the migration table, which must NOT be a finding',
    expect: 'PASS',
    // A KEY IS SCOPED TO ITS OWN TABLE, and this is the case that says so.
    // ALLOCATION's two numeric tables claim OVERLAPPING INTEGER RANGES -- ADR
    // 1 to 71, migrations 1 to 45 -- so the obvious wrong implementation, one
    // map over all three tables, reports every number below 45 as claimed twice
    // and is red on arrival on a clean tree. It is wrong in the LOUD direction,
    // which is the one that gets a gate deleted rather than relaxed.
    //
    // The seed claims the first free MIGRATION number, which the ADR table
    // already claims as an ADR. Two tables, one integer, two legitimate claims.
    //
    // The control writes the identical row into the ADR table instead, where
    // that number is already claimed. The two trees differ in WHICH TABLE the
    // row lands in and in nothing else, so a control that goes quiet means the
    // number was never claimed there and the PASS above is vacuous.
    control: {
      expect: (d) => `ADR-${nextFreeMigration(d).slice(1)} is claimed by 2 rows`,
      seed: (d) => {
        const n = nextFreeMigration(d);
        edit(d, 'docs/decisions/ALLOCATION.md', (b) =>
          addAdrRow(b, n.slice(1), 'a second claim, in the table that already claims it'),
        );
      },
    },
    seed: (d) => {
      const n = nextFreeMigration(d);
      edit(d, 'docs/decisions/ALLOCATION.md', (b) =>
        addMigrationRow(
          b,
          n,
          'free as a migration, and claimed as an ADR by the table above. Two ' +
            'registries, one integer, and neither claim is a duplicate of the other',
        ),
      );
    },
  },
  {
    name: 'CI-06t/unclosed-before-a-good-span-later',
    gate: 'CI-06t',
    what: 'an unclosed opener EARLY with a legitimate closed span LATER, which MUST be a finding',
    // THIS IS THE CASE A BALANCE COUNT PASSES, and it is the arrangement that
    // produced the defect. One opener with no closer, then a complete span
    // below it: two openers, one closer, and any reading that compares totals
    // sees an imbalance it cannot locate, while a reading that pairs each
    // opener with the NEXT closer anywhere after it sees one tidy span whose
    // content happens to be everything in between.
    //
    // It is in scope and must FAIL. If a future edit turns CI-06t into a
    // counter, the seed above still fires and this one stops, which is the
    // whole reason both exist.
    expect: 'is still unclosed',
    seed: (d) =>
      edit(
        d,
        'docs/GLOSSARY.md',
        (b) =>
          `${b}\n<!-- seeded -->\nThe stale one is a ${opener('ec_count')} written into prose.\n\n` +
          `A real span follows it: ${opener('gs_count')}284${closer()}\n`,
      ),
  },
  {
    name: 'CI-06t/a-document-with-no-spans-is-not-a-finding',
    gate: 'CI-06t',
    what: 'a document carrying no span token at all, which must NOT be a finding',
    expect: 'PASS',
    // The boundary is at `unbalanced`, not at `mentions a span`. Most of the
    // 494 markdown files in this tree carry no token and ten carry all 158 of
    // them; a gate that reported on the other 484 would be unusable. The
    // control fires on the same file with one unclosed opener added, which is
    // the single edit that turns a silent document into a finding.
    control: {
      expect: 'opens and is never closed',
      seed: (d) =>
        edit(
          d,
          'docs/GLOSSARY.md',
          (b) => `${b}\n<!-- control -->\nA ${opener('adr_count')} left open.\n`,
        ),
    },
    seed: (d) =>
      edit(
        d,
        'docs/GLOSSARY.md',
        (b) =>
          `${b}\n<!-- seeded -->\nThis paragraph discusses the ec_count span and carries no token.\n`,
      ),
  },
  {
    name: 'CI-06t/correctly-closed-spans-are-not-a-finding',
    gate: 'CI-06t',
    what: 'a document whose spans all open and close in order, which must NOT be a finding',
    expect: 'PASS',
    // TWO SPANS AND A SECOND ON THE SAME LINE, because the first draft of this
    // gate sorted tokens by LINE and read three spans on one line as three
    // openers followed by three closers. INDEX.md carries exactly that shape and
    // the draft reported fifty findings against a clean tree. This case is what
    // stops that regression returning quietly.
    control: {
      // The stale opener trails the good span, so the gate reaches end of file
      // with one open and reports THAT form rather than the interleaving one.
      // The first draft asserted the interleaving message here and the harness
      // said CONTROL DID NOT FIRE, which is the harness doing its job: a
      // control whose expectation is wrong proves nothing and the PASS beneath
      // it would have asserted nothing.
      expect: 'opens and is never closed',
      seed: (d) =>
        edit(
          d,
          'docs/GLOSSARY.md',
          (b) =>
            `${b}\n<!-- control -->\nOne ${opener('adr_count')}58${closer()} and a stale ` +
            `${opener('ec_count')} beside it.\n`,
        ),
    },
    seed: (d) =>
      edit(
        d,
        'docs/GLOSSARY.md',
        (b) =>
          `${b}\n<!-- seeded -->\nOne ${opener('adr_count')}58${closer()} then ` +
          `${opener('ec_count')}157${closer()} on the same line.\n\n` +
          `And another on its own: ${opener('gs_count')}284${closer()}\n`,
      ),
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
  // ---------------------------------------------------------------------------
  // CI-06o. TWO ASSERTIONS, AND `SEEDS` CARRIES ONE.
  //
  // The seeded violation covers assertion 1, which is nearly vacuous today: there
  // is no ledger, payout or auth package, so it scans one package and finds
  // nothing. ASSERTION 2 IS THE ONE WITH TEETH and it would otherwise be taken on
  // trust, which is CI-06k's arithmetic one gate over.
  //
  // A money path added without being added to the gate's scope is itself a
  // finding, and this is the case that watches it fire. It seeds the exact
  // scenario ADR-044 was written against: `packages/payout` arrives, nobody
  // remembers the ADR, and the gate says so rather than scanning a set that no
  // longer covers the money path.
  // ---------------------------------------------------------------------------
  {
    name: 'CI-06o/unscoped-money-path',
    gate: 'CI-06o',
    what: "a new money-path package that the gate's own scope list does not name",
    expect:
      'packages/payout: money path (its name carries "payout") is not in CI-06o\'s scope list',
    seed: (d) => {
      mkdirSync(join(d, 'packages/payout/src'), { recursive: true });
      writeFileSync(
        join(d, 'packages/payout/package.json'),
        JSON.stringify({ name: '@merit/payout', private: true }, null, 2) + '\n',
      );
      // THE SEEDED PACKAGE IS CLEAN, which is the point of this case rather than
      // an oversight. It imports no model SDK, so assertion 1 has nothing to say
      // about it and would report NOTHING. The finding is the scope gap itself:
      // an unscoped money path is a hole whether or not anybody has walked
      // through it yet.
      writeFileSync(
        join(d, 'packages/payout/src/index.ts'),
        'export const settle = (cents: bigint): bigint => cents;\n',
      );
    },
  },
  // ---------------------------------------------------------------------------
  // CI-06u. THE SEED PROVES IT FIRES. EVERY BOUNDARY BELOW IS ONE ITS SURVEY
  // ARGUED ABOUT, and none of the four appears in one direction only.
  //
  // This gate is the one in this file most at risk of being quietly relaxed,
  // because the cheapest way to make a false finding go away is to widen the
  // exemption until it stops matching. Each case pins one edge of the scope so
  // that widening it fails here rather than passing silently.
  // ---------------------------------------------------------------------------
  {
    name: 'CI-06u/a-dimension-column-repeats-and-is-not-a-finding',
    gate: 'CI-06u',
    what: 'a transition table whose From column repeats, which must NOT be a finding',
    expect: 'PASS',
    // THE POPULATION THIS PROTECTS IS REAL AND LARGE. The survey found 211
    // repeated first cells and 32 of them are this shape: `active` has four
    // outgoing edges in STATE_MACHINES, and S/T/R/I/D/E heads many rows each in
    // SECURITY by construction. A gate reporting those is a gate switched off
    // inside a week, which is the outcome the exemption exists to avoid.
    //
    // The control is the SAME TABLE with one word changed in the header row.
    // Header `From` and header `Term` differ in nothing else, so a control that
    // fires proves the exemption turns on the header and not on the content.
    control: {
      expect: 'the first cell "provisioning_pending" already heads the row at line',
      seed: (d) =>
        edit(
          d,
          'docs/GLOSSARY.md',
          (b) =>
            `${b}\n<!-- control -->\n\n| Term | To | Guard |\n|---|---|---|\n` +
            `| provisioning_pending | active | G-PROVISIONED |\n` +
            `| provisioning_pending | closed_admin | G-PROVISION-ABANDONED |\n`,
        ),
    },
    seed: (d) =>
      edit(
        d,
        'docs/GLOSSARY.md',
        (b) =>
          `${b}\n<!-- seeded -->\n\n| From | To | Guard |\n|---|---|---|\n` +
          `| provisioning_pending | active | G-PROVISIONED |\n` +
          `| provisioning_pending | closed_admin | G-PROVISION-ABANDONED |\n`,
      ),
  },
  {
    name: 'CI-06u/a-repaired-register-entry-is-itself-a-finding',
    gate: 'CI-06u',
    what: 'a registered duplicate that has been REPAIRED, which must be a finding',
    // THE DIRECTION AN ALLOWLIST DECAYS IN, and the reason the register is a
    // register rather than an exemption list. Without this assertion a register
    // line survives every repair and the gate ends up asserting nothing about
    // the files it reads.
    //
    // It seeds the REPAIR, not the damage: a registered file carries two rows
    // under one key, one of them goes, and the gate must now object to its own
    // register rather than say nothing.
    //
    // THE FIXTURE IS SYNTHETIC AND THE CASE NO LONGER TOUCHES A LIVE REGISTER
    // ENTRY. `seedRegisterFixture` above says why, and what the three anchors
    // this case outgrew each cost. The short form: the register is a debt the
    // corpus is expected to pay off, so anchoring the gate's own falsification
    // to it made the wave's success the thing that would end the case.
    expect: (d) =>
      `the register claims "${repairedRegisteredDuplicate(d).key}" is a known duplicate`,
    // THE SEED REMOVES THE WHOLE DUPLICATION, not one row of it, and the
    // difference is not cosmetic. Deleting a single row assumes the claim
    // carries exactly two, which `docs/sessions/README.md` broke when it became
    // the last file in the register: the parallel-session convention gives
    // sessions 31, 33, 49, 50 and 56 FOUR rows each, so removing one leaves
    // three and `repairedRegisteredDuplicate` finds nothing below two. The
    // fixture is written with two rows, but the loop stays general so a fixture
    // that later grows a third row does not silently stop firing.
    seed: (d) => {
      seedRegisterFixture(d);
      const file = SEEDED_REGISTER_FILE;
      const key = SEEDED_REGISTER_KEY;
      // RULE 2 ON THE FIXTURE ITSELF. If the table the seed just wrote does not
      // read back as a duplicate, the repair below removes nothing and the case
      // would demand a finding no gate can produce.
      const rows = rowsCarrying(d, file, key);
      if (rows.length < 2) {
        throw new Error(
          `seed anchor not found: the fixture table wrote ${rows.length} row(s) under ` +
            `"${key}" in ${file} and the repair needs two. The append landed somewhere ` +
            '`rowsCarrying` cannot see it',
        );
      }
      const p = join(d, file);
      const lines = readFileSync(p, 'utf8').split('\n');
      // Keep the first row carrying the key and drop the rest. That IS the
      // repair, so the register entry must now name nothing.
      for (const at of rows.slice(1).reverse()) lines.splice(at, 1);
      writeFileSync(p, lines.join('\n'));
    },
  },
  {
    name: 'CI-06u/two-separate-tables-may-share-a-key',
    gate: 'CI-06u',
    what: 'one key appearing once in each of two DIFFERENT tables, which must NOT be a finding',
    expect: 'PASS',
    // THE UNIT IS ONE TABLE AND NOT ONE FILE. A document that defines `R-35` in
    // a rules table and cites it in a coverage table further down is the normal
    // shape of this corpus, and a file-wide uniqueness rule would report
    // hundreds of them.
    //
    // The control is the SAME TWO TABLES with the blank line between them
    // removed, which is the whole difference between two tables and one. That
    // edit is not hypothetical: `docs/sessions/README.md` carries the entire
    // session index twice under a re-inserted header row with no blank line
    // between the copies, and a parser that split on the second delimiter row
    // would read it as two tidy tables and report nothing. 58 of the survey's
    // 105 findings live on the far side of this one boundary.
    control: {
      expect: 'the first cell "shared-key" already heads the row at line',
      seed: (d) =>
        edit(
          d,
          'docs/GLOSSARY.md',
          (b) =>
            `${b}\n<!-- control -->\n\n| Term | Meaning |\n|---|---|\n` +
            `| shared-key | defined here |\n` +
            `| Term | Meaning |\n|---|---|\n` +
            `| shared-key | cited there |\n`,
        ),
    },
    seed: (d) =>
      edit(
        d,
        'docs/GLOSSARY.md',
        (b) =>
          `${b}\n<!-- seeded -->\n\n| Term | Meaning |\n|---|---|\n` +
          `| shared-key | defined here |\n\n` +
          `| Term | Meaning |\n|---|---|\n` +
          `| shared-key | cited there |\n`,
      ),
  },
  {
    name: 'CI-06u/an-empty-first-cell-claims-nothing',
    gate: 'CI-06u',
    what: 'a table whose first cells are empty on every row, which must NOT be a finding',
    expect: 'PASS',
    // THE CORPUS'S TWO-COLUMN LAYOUT TABLE OPENS `| | |` AND CARRIES CONTINUATION
    // ROWS WITH NOTHING IN THE FIRST CELL. 37 tables under docs/ have an empty
    // first-column header alone. An empty cell claims no key, so reading empties
    // as one repeated key would report a large and entirely healthy population
    // and would bury the eight files that are actually damaged.
    //
    // The control gives the same three rows one identical non-empty first cell,
    // which is the single edit that turns a layout table into a registry with a
    // collision in it.
    control: {
      expect: 'the first cell "same" already heads the row at line',
      seed: (d) =>
        edit(
          d,
          'docs/GLOSSARY.md',
          (b) =>
            `${b}\n<!-- control -->\n\n| | |\n|---|---|\n` +
            `| same | first |\n| same | second |\n| same | third |\n`,
        ),
    },
    seed: (d) =>
      edit(
        d,
        'docs/GLOSSARY.md',
        (b) =>
          `${b}\n<!-- seeded -->\n\n| | |\n|---|---|\n` +
          `| | first |\n| | second |\n| | third |\n`,
      ),
  },
  // ---------------------------------------------------------------------------
  // CI-06/conflict-markers. TWO BOUNDARIES, ONE DIRECTION EACH.
  //
  // The first is the LIVE complication rather than an invented one. STATE
  // carries `<<<<<<< HEAD` three times in PROSE, at the `OI-19` entry and the
  // two entries that discuss it, because the marker is that gate's own subject
  // matter. The gate's assertion is "a line BEGINNING with a marker" and not
  // "a file containing one", so those three sites are outside it BY THE RULE
  // and no exemption is registered for them.
  //
  // A gate that quietly stopped matching would also pass this case, which is
  // what the control is for: the same token, in the same file, moved to the
  // start of its line, MUST fail. Without that, the PASS below is decoration.
  //
  // Both halves seed rather than anchor. The three prose sites are real today
  // and the case deliberately does not depend on them: `OI-21` is the record of
  // what happens to a harness pinned to corpus state, and if those entries are
  // ever reworded this case still asserts the boundary.
  // ---------------------------------------------------------------------------
  {
    name: 'CI-06/conflict-markers/mid-line',
    gate: 'CI-06/conflict-markers',
    what: 'the marker written MID-LINE in prose, which the gate must NOT read as a finding',
    expect: 'PASS',
    control: {
      expect: `line begins with the conflict marker "${'<'.repeat(7)}"`,
      seed: (d) =>
        edit(
          d,
          'docs/STATE.md',
          (b) => `${b}\n${'<'.repeat(7)} HEAD is what git writes, and here it leads the line.\n`,
        ),
    },
    seed: (d) =>
      edit(
        d,
        'docs/STATE.md',
        (b) => `${b}\nThe marker git writes is \`${'<'.repeat(7)} HEAD\`, quoted here mid-line.\n`,
      ),
  },
  {
    // THE SCOPE IS THE TREE AND NOT `docs/`, and this is the direction that
    // proves it. Every other corpus gate in this runner is scoped to `docs/` or
    // to one named file, so a reader is entitled to assume this one is too. A
    // conflict marker in a workflow, a migration or a package manifest is worse
    // than one in prose, not better: prose contradicts itself and a manifest
    // fails to parse.
    //
    // `pnpm-workspace.yaml` is chosen because it is at the repository ROOT and
    // outside every directory the other gates walk, so a gate narrowed to
    // `docs/` -- or to markdown -- goes quiet here rather than merely quieter.
    name: 'CI-06/conflict-markers/outside-docs',
    gate: 'CI-06/conflict-markers',
    what: 'a marker in a root-level non-markdown file, which MUST be a finding',
    expect: `pnpm-workspace.yaml:`,
    seed: (d) =>
      edit(d, 'pnpm-workspace.yaml', (b) => `${b}\n${'>'.repeat(7)} theirs-side-branch\n`),
  },
  // ---------------------------------------------------------------------------
  // CI-06/fixture-inventory. SIX ASSERTIONS, ONE SEED, FOUR CASES.
  //
  // SEEDS carries one violation per gate, which is assertion 2. The four cases
  // below carry the ones a single seed cannot reach, on CI-06k's precedent one
  // gate over. The first is the most important thing in this file about this
  // gate: it is the case that stops the REGISTER becoming an exemption list.
  // The last is assertion 6, and it is the one ADR-076 is withheld over.
  // ---------------------------------------------------------------------------
  {
    // THE REGISTER MUST NOT BE ABLE TO BECOME FURNITURE, and this is the only
    // direction that proves it. The gate shipped red-turned-quiet by three
    // registered rows; a register that merely silenced them would be an
    // exemption list with a better name, and would go on silencing them forever
    // after the repair landed.
    //
    // THE SEED WRITES THE ENTRY RATHER THAN REPAIRING THE ROW, AND THAT IS A
    // CHANGE THIS SESSION HAD TO MAKE. It used to repair a registered row to
    // `written` in the copy and watch the entry become a finding. Session 127
    // repaired all three rows on the tree and session 131 removed all three
    // entries, so there is no longer a registered row to repair: the old seed
    // would throw its anchor error forever, which is the harness announcing a
    // stale seed correctly and is still a case asserting nothing.
    //
    // So it runs the other way. Register a scenario that is ALREADY `written`
    // with its fixture on disk -- an entry naming no defect, by construction,
    // whatever the register holds -- and the entry MUST be the finding. Same
    // property, same branch of the gate, and an anchor that cannot go stale
    // because the seed creates it.
    name: 'CI-06/fixture-inventory/register-names-no-defect',
    gate: 'CI-06/fixture-inventory',
    what: 'a register entry naming an already-repaired row, which MUST itself be a finding',
    expect: (d) => `CI06FIXTURE_REGISTER holds ${writtenWithAFixture(d)} and its row now reads`,
    seed: (d) => seedFixtureRegisterEntry(d, writtenWithAFixture(d)),
  },
  {
    // ASSERTION 4 IS NARROWED AGAINST THE BRIEF AND THIS IS THE LOUD DIRECTION
    // OF THE NARROWING. The brief asks for a blocker on every NON-WRITTEN row,
    // which would flag any `writable` row; the document defines writable as
    // every ADR-072 condition holding, so a blocker there is a contradiction and
    // its absence is correct.
    //
    // A narrowing tested only from the quiet side is indistinguishable from a
    // gate that stopped reading those rows. This case shows a writable row is
    // still READ: build one carrying a blocker, from the closed vocabulary so
    // the finding cannot be the vocabulary check firing instead, and it must
    // fail. `seedWritableWithABlocker` says why the row is built rather than
    // found: `writable` holds no row today and the term stays in the vocabulary
    // regardless, so a seed that hunts for one asserts nothing the day the last
    // one leaves.
    name: 'CI-06/fixture-inventory/writable-with-a-blocker',
    gate: 'CI-06/fixture-inventory',
    what: 'a writable row that names a blocker, which MUST be a finding',
    expect: (d) => `${markedFixtureRow(d)} is "writable" and still names the blocker`,
    seed: (d) => seedWritableWithABlocker(d),
  },
  {
    // ASSERTION 3, WHICH THE SEED CANNOT REACH. A `written` row whose `.yaml` is
    // present and whose `.expected.json` is not is a scenario the loader cannot
    // run and the registry calls done, and it is the half of "both files" that a
    // reader checking the directory by eye would miss: the fixture IS there.
    //
    // The expectation is deleted rather than the fixture, on purpose. Deleting
    // the `.yaml` would fire the "no fixture at all" branch, which is a
    // different finding, and the case would pass while asserting the wrong one.
    name: 'CI-06/fixture-inventory/written-with-no-expectation',
    gate: 'CI-06/fixture-inventory',
    what: 'a written row whose .expected.json is gone while its .yaml remains, which MUST be a finding',
    expect: 'with no .expected.json sibling',
    seed: (d) => {
      const f = readdirSync(join(d, FIXTURE_DIR)).find((x) => /^GS-\d{3}-.*\.expected\.json$/.test(x));
      if (!f) throw new Error(`seed anchor not found: no .expected.json in ${FIXTURE_DIR}`);
      rmSync(join(d, FIXTURE_DIR, f));
    },
  },
  {
    // ASSERTION 6, AND IT IS THE ACCEPTANCE TEST FOR THE WHOLE ITEM RATHER THAN
    // ONE MORE CASE. ADR-076 is WITHHELD because its section 6 counts `GS-072`
    // among seven rows moving to `covered-elsewhere`, and `GS-072`'s cited site
    // is `describe.skipIf(!replayExists)` over a condition that is false: the
    // block reports a named skip, never enters its body, and the body throws
    // rather than asserting. WAVE-05 section 2 specifies the assertion as "the
    // citation resolves and its file names the row's id", AND BOTH ARE TRUE OF
    // `GS-072`. A gate built to that sentence admits the defect that withheld
    // the ruling, so the ruling's own governing rule is what is implemented and
    // this is where that is proven rather than claimed.
    //
    // THE TWO DIRECTIONS ARE THE POINT AND NEITHER MEANS ANYTHING ALONE. The
    // control moves the row to `covered-elsewhere` and changes nothing else: the
    // citation resolves, the file names the row, and the gate must still refuse
    // it. The case below then makes ONE further edit -- it removes the `.skipIf`
    // and touches nothing else -- and the gate must pass. Together they say the
    // boundary is THE SKIP and not the row, the file or the citation, which no
    // single direction can say.
    //
    // AND THE PASS DIRECTION IS ALSO THE HONEST STATEMENT OF THE GATE'S LIMIT.
    // With the skip gone that block's body still THROWS, so what the case proves
    // green is a suite that would fail if it ran. Assertion 6 reads whether an
    // assertion is DISABLED and never whether it passes; the suite is what
    // asserts that, and `CI-01` is what runs the suite. A reader who wants that
    // sentence tested rather than written has it here.
    name: 'CI-06/fixture-inventory/covered-elsewhere-must-execute',
    gate: 'CI-06/fixture-inventory',
    what: 'a covered-elsewhere row whose cited block is no longer skipped, which must NOT be a finding',
    expect: 'PASS',
    control: {
      expect: (d) => `${markedFixtureRow(d)} is "covered-elsewhere" and no cited suite EXECUTES it`,
      seed: (d) => seedCoveredElsewhere(d),
    },
    seed: (d) => {
      seedCoveredElsewhere(d);
      edit(d, SKIPPED_SITE, (b) => once(b, /^describe\.skipIf\([^)]*\)\(/m, 'describe('));
    },
  },
  // ---------------------------------------------------------------------------
  // CI-06/identifier-series. THREE BOUNDARIES, ONE DIRECTION EACH, and the first
  // two are the halves of ADR-074's rule that a reader would most reasonably
  // assume the other way round.
  // ---------------------------------------------------------------------------
  {
    // A BOLD LEAD IS NOT A DEFINITION SITE, and this is the direction that keeps
    // the gate from reporting on English. ADR-074 section 1 rejects the shape by
    // argument: a bold span opening a line is this corpus's ordinary emphasis
    // idiom, present thousands of times.
    //
    // The control is what makes the PASS mean something: the SAME text, in the
    // SAME register, written as a table row instead, must fail. Without it a
    // gate that had stopped reading the register at all would pass this case.
    name: 'CI-06/identifier-series/bold-lead',
    gate: 'CI-06/identifier-series',
    what: 'a bold lead naming an identifier inside its register, which must NOT be a definition site',
    expect: 'PASS',
    control: {
      expect: (d) => `${declaredFileRegister(d).id} has 2 definition sites`,
      seed: (d) => {
        const { register, id } = declaredFileRegister(d);
        edit(d, register, (b) => `${b}\n| ${id} | a row, which IS a definition site |\n`);
      },
    },
    seed: (d) => {
      const { register, id } = declaredFileRegister(d);
      edit(d, register, (b) => `${b}\n**${id}** is discussed here in prose, in bold, mid-document.\n`);
    },
  },
  {
    // EVERY OCCURRENCE OUTSIDE THE DECLARED REGISTER IS A CITATION AND IS
    // UNCONSTRAINED. This is the whole content of "inside the declared
    // register", and it is the direction ADR-074 section 1 says the union of
    // shapes gets wrong on 364 members: every EC and every ADR has both a
    // document and a register row, and a rule that cannot tell a register row
    // from the document it points at calls the corpus's own discipline a
    // violation.
    //
    // So: a second row leading with the same identifier, in a file that is NOT
    // its register, must be read as a citation. The control puts the identical
    // row INSIDE the register and must fail.
    name: 'CI-06/identifier-series/outside-the-register',
    gate: 'CI-06/identifier-series',
    what: 'a row leading with an identifier in a file that is not its register, which must NOT be a finding',
    expect: 'PASS',
    control: {
      expect: (d) => `${declaredFileRegister(d).id} has 2 definition sites`,
      seed: (d) => {
        const { register, id } = declaredFileRegister(d);
        edit(d, register, (b) => `${b}\n| ${id} | inside the register, which IS a second site |\n`);
      },
    },
    seed: (d) => {
      const { id } = declaredFileRegister(d);
      edit(d, 'docs/GLOSSARY.md', (b) => `${b}\n\n| | |\n|---|---|\n| ${id} | cited outside its register |\n`);
    },
  },
  {
    // THE PENDING REGISTER MUST NOT BECOME FURNITURE, and this is the only
    // direction that proves it. ADR-074 section 5 gives the register
    // CI06U_REGISTER's defining property in terms: "a register entry that no
    // longer names a real defect is a finding. So it shrinks as repairs land and
    // cannot become furniture."
    //
    // Repair one pending series in the copy by giving every member exactly one
    // definition site, and the ENTRY must become the finding. The target is
    // derived as the smallest pending series all of whose members have zero
    // sites today, so that one appended row each lands them on exactly one: a
    // member already at one site would reach two and the series would stay
    // broken, passing this case for the wrong reason.
    name: 'CI-06/identifier-series/pending-repaired',
    gate: 'CI-06/identifier-series',
    what: 'a pending series whose members all became singly defined, which MUST make its entry a finding',
    expect: (d) => `PENDING_SERIES holds ${seededPendingSeries(d)} and every one of its`,
    seed: (d) => {
      const { ids } = pendingWithNoSites(d);
      edit(
        d,
        'docs/GLOSSARY.md',
        (b) =>
          `${b}\n\n| | |\n|---|---|\n` +
          ids.map((id) => `| ${id} | ${PENDING_SEED_MARK} |`).join('\n') +
          '\n',
      );
    },
  },
  // ---------------------------------------------------------------------------
  // THE WITHHELD TABLE (ADR-074 section 5.1). THREE CASES, because the table
  // makes three claims and a table watched failing on one of them is taken on
  // trust for the other two.
  //
  // Its two failing directions are what stop it being the cheap way to silence a
  // finding: a withheld identifier that ACQUIRES a definition site is a finding,
  // and one that STOPS APPEARING ANYWHERE is a finding. The third case is the
  // exemption itself, and it is the one the whole table exists to buy: a member
  // nobody minted must NOT be reported against its series, and the control
  // deletes the entry to prove the pass is the table's doing rather than the
  // gate having stopped reading M06.
  // ---------------------------------------------------------------------------
  {
    name: 'CI-06/identifier-series/withheld-acquired-a-site',
    gate: 'CI-06/identifier-series',
    what: 'a withheld identifier that acquires a row in its own register, which MUST make the entry a finding',
    expect: (d) => `${withheldMember(d).id} is in WITHHELD_MEMBERS and has 1 definition site(s)`,
    seed: (d) => {
      const { id, register } = withheldMember(d);
      edit(d, register, (b) => `${b}\n| ${id} | minted after all, seeded by falsify |\n`);
    },
  },
  {
    name: 'CI-06/identifier-series/withheld-vanished',
    gate: 'CI-06/identifier-series',
    what: 'a withheld identifier that no longer appears anywhere, which MUST make the entry a finding',
    expect: (d) => `WITHHELD_MEMBERS holds ${withheldMember(d).id} and the census no longer finds it`,
    seed: (d) => eraseIdentifier(d, withheldMember(d).id),
  },
  {
    // THE EXEMPTION, AND THE ONLY DIRECTION THAT SHOWS THE TABLE EARNING ITS
    // PLACE. A withheld member has no definition site by construction, so the
    // gate must not report the series that owns it as broken; the seed adds a
    // row leading with the identifier in a file that is NOT its register, which
    // section 1 rules is a citation and unconstrained, and neither the row nor
    // the missing definition may fire.
    //
    // The control removes the WITHHELD_MEMBERS entry and changes nothing else.
    // Without it this case is satisfied by a gate that has stopped reading the
    // register at all, and with it the pass means the exclusion did the work.
    name: 'CI-06/identifier-series/withheld-is-excluded',
    gate: 'CI-06/identifier-series',
    what: 'a withheld member cited outside its register and defined nowhere, which must NOT be a finding',
    expect: 'PASS',
    control: {
      expect: (d) => `${seededWithheldId(d)} has NO definition site in its declared register`,
      seed: (d) => {
        const { id } = withheldMember(d);
        edit(d, 'docs/GLOSSARY.md', (b) => `${b}\n\n| | |\n|---|---|\n| ${id} | ${CITED_SEED_MARK} |\n`);
        edit(d, GATES_PATH, (b) => once(b, new RegExp(`^\\s*\\['${id}',[\\s\\S]*?\\],\\n`, 'm'), ''));
      },
    },
    seed: (d) => {
      const { id } = withheldMember(d);
      edit(d, 'docs/GLOSSARY.md', (b) => `${b}\n\n| | |\n|---|---|\n| ${id} | ${CITED_SEED_MARK} |\n`);
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
