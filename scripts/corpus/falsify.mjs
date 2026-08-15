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
const once = (body, needle, replacement) => {
  if (!body.includes(needle)) throw new Error(`seed anchor not found: ${needle}`);
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
    expect: 'no-such-heading-anywhere',
    seed: (d) => edit(d, 'docs/STATE.md', (b) => b + '\n[probe](DECISIONS.md#no-such-heading-anywhere)\n'),
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
    seed: (d) =>
      edit(d, 'docs/EDGE_CASES.md', (b) => {
        const at = b.indexOf('## EC-001:');
        if (at === -1) throw new Error('EC-001 block not found');
        return (
          b.slice(0, at) +
          b.slice(at).replace(/^- Golden scenario ref:.*$/m, '- Golden scenario ref:')
        );
      }),
  },
  'CI-06f': {
    what: 'an ADR claiming a number nobody reserved',
    real: 'two pull requests claimed ADR-031 from the same base',
    expect: 'a hole',
    seed: (d) => edit(d, 'docs/DECISIONS.md', (b) => b + '\n## ADR-099: probe  (2026-08-15, status: proposed)\n'),
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
    // finding this seed plants is the UNRESERVED hole it opens at 0029.
    expect: '0029 is neither on disk nor reserved',
    seed: (d) =>
      renameSync(
        join(d, 'packages/db/migrations/0028_supersede_plan_version_immutability.sql'),
        join(d, 'packages/db/migrations/0030_supersede_plan_version_immutability.sql'),
      ),
  },
  'CI-06i': {
    what: 'a DATA_MODEL section for a table no migration creates',
    real: '50 tables had a migration and no design record, and nothing failed because nothing counted',
    expect: 'probe_phantom_table',
    seed: (d) => edit(d, 'docs/architecture/DATA_MODEL.md', (b) => b + '\n### probe_phantom_table\nA table that does not exist.\n'),
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
  // cannot prove that a RESERVED hole passes, because the tree has no
  // reservations, and it cannot prove that an unclaimed number on disk fails,
  // because every number on disk is claimed.
  // ---------------------------------------------------------------------------
  {
    name: 'CI-06h/reserved',
    gate: 'CI-06h',
    what: 'a number reserved by a sibling branch, with no file here, which must NOT be a finding',
    expect: 'PASS',
    seed: (d) =>
      edit(d, 'docs/DECISIONS.md', (b) => {
        const m = /^\| 0001 to 0028 \|.*$/m.exec(b);
        if (!m) throw new Error('seed anchor not found: the 0001 to 0028 allocation row');
        const at = m.index + m[0].length;
        return (
          b.slice(0, at) +
          '\n| 0029 | a sibling branch, unmerged | **reserved.** No file on disk here, which is ' +
          'the whole case: a branch cannot see its siblings |' +
          b.slice(at)
        );
      }),
  },
  {
    name: 'CI-06h/unallocated',
    gate: 'CI-06h',
    what: 'a migration on disk that no allocation row claims, which MUST be a finding',
    // 0029 follows 0028, so this opens NO hole. The allocation finding is the
    // only one it can produce, which is what makes it a test of that half
    // rather than of the contiguity half.
    expect: '0029 is not claimed by the migration allocation table',
    seed: (d) =>
      writeFileSync(
        join(d, 'packages/db/migrations/0029_probe_unallocated.sql'),
        '-- A migration whose number came from `ls` rather than from the table.\n',
      ),
  },
];

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
      SEEDS[id].seed(dir);
      const { pass, stdout } = runGate(dir, id);
      const findings = stdout.split('\n').filter((l) => l.startsWith('       ')).map((l) => l.trim());
      const onTarget = findings.some((f) => f.includes(SEEDS[id].expect));
      if (pass) {
        bad++;
        console.log(`  DID NOT FAIL        ${id}  <- seeded: ${SEEDS[id].what}`);
        console.log(`        The gate reported PASS on a tree that violates it.`);
      } else if (!onTarget) {
        bad++;
        console.log(`  FAILED OFF-TARGET   ${id}  <- seeded: ${SEEDS[id].what}`);
        console.log(`        Expected a finding containing "${SEEDS[id].expect}". Got:`);
        for (const f of findings.slice(0, 3)) console.log(`          ${f.slice(0, 140)}`);
      } else {
        console.log(`  failed as required  ${id}  <- ${SEEDS[id].what}`);
        console.log(`        ${findings.find((f) => f.includes(SEEDS[id].expect)).slice(0, 150)}`);
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
      c.seed(dir);
      const { pass, stdout } = runGate(dir, c.gate);
      const findings = stdout.split('\n').filter((l) => l.startsWith('       ')).map((l) => l.trim());
      if (c.expect === 'PASS') {
        if (pass) {
          console.log(`  out of scope, passed  ${c.name}  <- ${c.what}`);
        } else {
          bad++;
          console.log(`  READ A FILE IT MUST NOT  ${c.name}  <- ${c.what}`);
          console.log(`        ${c.gate} reported FAIL on a tree that does not violate it:`);
          for (const f of findings.slice(0, 3)) console.log(`          ${f.slice(0, 140)}`);
        }
      } else if (!pass && findings.some((f) => f.includes(c.expect))) {
        console.log(`  in scope, failed      ${c.name}  <- ${c.what}`);
        console.log(`        ${findings.find((f) => f.includes(c.expect)).slice(0, 150)}`);
      } else {
        bad++;
        console.log(`  ${pass ? 'DID NOT FAIL         ' : 'FAILED OFF-TARGET    '} ${c.name}  <- ${c.what}`);
        console.log(`        Expected a finding containing "${c.expect}". Got ${findings.length} finding(s):`);
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
