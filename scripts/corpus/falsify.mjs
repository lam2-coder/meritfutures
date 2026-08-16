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
  cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, renameSync, readdirSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

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

const nextFreeMigration = (dir) => String(nextFree(dir, '## Migration number allocation')).padStart(4, '0');
const nextFreeAdr = (dir) => String(nextFree(dir, '## Number allocation')).padStart(3, '0');

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
      edit(d, 'docs/STATE.md', (b) => b + '\n[probe](decisions/ADR-034.md#no-such-heading-anywhere)\n'),
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
        once(b, 'NEW.plan_version_id IS DISTINCT FROM OLD.plan_version_id', 'NEW.plan_versoin_id IS DISTINCT FROM OLD.plan_version_id'),
      ),
  },
  'CI-06n': {
    what: 'a registry entry file that its registry README does not list',
    real:
      'ADR-043 exempted entry files from INDEX, and an exemption with nothing in its ' +
      'place is a document that exists and nothing indexes',
    // Derived, so it cannot collide with a real ADR the way a pinned 999 would
    // the day the registry reaches it.
    expect: (d) => `docs/decisions/ADR-${String(Number(nextFreeAdr(d)) + 7).padStart(3, '0')}.md: entry file with no row`,
    seed: (d) => {
      const n = String(Number(nextFreeAdr(d)) + 7).padStart(3, '0');
      writeFileSync(
        join(d, `docs/decisions/ADR-${n}.md`),
        `## ADR-${n}: an entry nothing indexes  (2026-08-15, status: proposed)\n`,
      );
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
  const out = execFileSync('node', [join(ROOT, 'scripts/corpus/gates.mjs'), 'list'], { encoding: 'utf8' });
  return [...out.matchAll(/^(\S+)\s\s/gm)].map((m) => m[1]);
}

// EVERYTHING except .git and node_modules. Copying a named subset left .claude/
// out on the first run, and CI-06a and CI-06c then "failed" on links into a
// directory the harness had not copied. A harness that tests a tree the gates
// never see is testing the harness.
function copyTree(dir) {
  for (const entry of readdirSync(ROOT)) {
    if (entry === '.git' || entry === 'node_modules') continue;
    cpSync(join(ROOT, entry), join(dir, entry), { recursive: true });
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
      console.log(stdout.split('\n').map((l) => `        ${l}`).join('\n'));
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
      const findings = stdout.split('\n').filter((l) => l.startsWith('       ')).map((l) => l.trim());
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
          const cf = r ? r.stdout.split('\n').filter((l) => l.startsWith('       ')).map((l) => l.trim()) : [];
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
      const findings = stdout.split('\n').filter((l) => l.startsWith('       ')).map((l) => l.trim());
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
        console.log(`  ${pass ? 'DID NOT FAIL         ' : 'FAILED OFF-TARGET    '} ${c.name}  <- ${c.what}`);
        console.log(`        Expected a finding containing "${cExpect}". Got ${findings.length} finding(s):`);
        for (const f of findings.slice(0, 3)) console.log(`          ${f.slice(0, 140)}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log(
    bad === 0
      ? `\nAll ${ids.length} gates pass clean and fail dirty, and ${SCOPE_CASES.length} scope ` +
          `case(s) hold. Each one has now been watched doing both.`
      : `\n${bad} problem(s). A gate that cannot be made to fail is not checking anything, and ` +
          `a gate that fails on a file outside its scope is checking the wrong thing.`,
  );
  return bad ? 1 : 0;
}

process.exit(main());
