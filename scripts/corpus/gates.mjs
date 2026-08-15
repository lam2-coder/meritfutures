#!/usr/bin/env node
// =============================================================================
// Corpus integrity gates: CI-06a to CI-06g, plus ADR-026's manifest gate.
// =============================================================================
// ZERO DEPENDENCIES, BY DESIGN. VG-12 requires human approval for any new
// package, and a docs gate is not worth spending that on. Everything here is
// node: builtins, so this runs on a bare checkout with no install step.
//
//   node scripts/corpus/gates.mjs check      # all gates, exit 1 on any failure
//   node scripts/corpus/gates.mjs generate   # rewrite the CI-06g counted spans
//
// Every gate is DERIVED FROM THE ARTIFACT, never from a number in prose. That
// is the whole point: seven hand-maintained counts in this corpus have been
// checked and seven were wrong (ADR-034).
// =============================================================================

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
const rel = (p) => relative(ROOT, p).split('\\').join('/');

function walk(dir, out = []) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    const p = join(dir, name);
    if (statSync(join(ROOT, p)).isDirectory()) walk(p, out);
    else if (name.endsWith('.md')) out.push(p.split('\\').join('/'));
  }
  return out;
}

// Documents the corpus gates. CLAUDE.md and README.md are living operational
// files carrying no gate status (INDEX says so); the constitution is read-only.
const NO_FRONTMATTER = new Set(['CLAUDE.md', 'README.md', 'MERIT_BUILD_MASTER_PROMPT.md']);
const corpusDocs = () => [...walk('docs'), ...walk('research'), 'packages/db/DELTA_MANIFEST.md'].sort();
const allMarkdown = () => [...corpusDocs(), ...NO_FRONTMATTER].sort();

const uniq = (a) => [...new Set(a)];
const nums = (s, re) => uniq([...s.matchAll(re)].map((m) => parseInt(m[1], 10))).sort((x, y) => x - y);

function contiguity(list, label) {
  const bad = [];
  for (let i = 1; i < list.length; i++) {
    if (list[i] === list[i - 1]) bad.push(`${label} duplicate: ${list[i]}`);
    else if (list[i] !== list[i - 1] + 1) bad.push(`${label} gap: ${list[i - 1]} -> ${list[i]}`);
  }
  if (list.length && list[0] !== 1) bad.push(`${label} does not start at 1 (starts ${list[0]})`);
  return bad;
}

// -----------------------------------------------------------------------------
// The derivable quantities. Each key names its query HERE rather than in a
// reader's head: counting registry table ROWS gives 22 and 301 where counting
// DISTINCT IDENTIFIERS gives the correct 140 and 257. Both are "a script
// deriving it" and one is wrong (ADR-034).
// -----------------------------------------------------------------------------
const QUERIES = {
  adr_count: () => (rd('docs/DECISIONS.md').match(/^## ADR-\d{3}:/gm) || []).length,
  ec_count: () => ecDefined().length,
  gs_count: () => gsDefined().length,
  migration_files: () =>
    readdirSync(join(ROOT, 'packages/db/migrations')).filter((f) => f.endsWith('.sql')).length,
  index_entries: () => (rd('docs/INDEX.md').match(/^\| \[/gm) || []).length,

  // ADR-026's manifest is the authority on how many schema changes are in
  // scope. Counts SD-nn and U-nn rows whether or not the id is bolded.
  manifest_changes: () =>
    (rd('packages/db/DELTA_MANIFEST.md').match(/^\|\s*\*{0,2}(SD|U)-[A-Z0-9-]+\*{0,2}\s*\|/gm) || []).length,

  // Grep-derivable from the DDL, and verified to agree with the installed
  // database. Tables and triggers are declared exactly once each.
  sql_tables: () => sqlCount(/^CREATE TABLE /gm),
  sql_triggers: () => sqlCount(/^CREATE (?:CONSTRAINT )?TRIGGER /gm),

  // NOT here on purpose: index and check-constraint totals. Postgres creates a
  // backing index for every PRIMARY KEY and UNIQUE constraint, so grepping
  // CREATE INDEX derives 219 where the database reports 326. A derivation that
  // disagrees with the artifact by a third is worse than no derivation: it
  // would pass CI while telling the reader something false. Those two counts
  // are emitted by the install job (CI-06h) from pg_indexes and pg_constraint
  // against the real database, which is the only place they are knowable.
};

function sqlCount(re) {
  const dir = join(ROOT, 'packages/db/migrations');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .reduce((n, f) => n + (readFileSync(join(dir, f), 'utf8').match(re) || []).length, 0);
}

const ecDefined = () => {
  const s = rd('docs/EDGE_CASES.md');
  return uniq([
    ...nums(s, /^## EC-(\d{3}):/gm),
    ...nums(s, /^\| EC-(\d{3}) /gm),
  ]).sort((a, b) => a - b);
};
const gsDefined = () => nums(rd('docs/testing/GOLDEN_SCENARIOS.md'), /^\| GS-(\d{3})/gm);

// -----------------------------------------------------------------------------
// CI-06a: link check. Relative in-repo targets and their anchors.
// -----------------------------------------------------------------------------
// External URLs are NOT fetched. CI-06a exists because "the corpus's
// cross-references are its navigation", and a job that reaches the network is
// a job that fails on someone else's outage. Reachability of third-party URLs
// is a different check with a different failure mode.
function slug(heading) {
  return heading
    .replace(/<[^>]+>/g, '')
    .replace(/`/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/ /g, '-');
}

function anchorsOf(text) {
  const seen = new Map();
  const out = new Set();
  for (const m of text.matchAll(/^#{1,6} +(.+?)\s*$/gm)) {
    const base = slug(m[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n === 0 ? base : `${base}-${n}`);
  }
  for (const m of text.matchAll(/<a[^>]+(?:name|id)="([^"]+)"/g)) out.add(m[1]);
  return out;
}

// A link inside a code span or a fenced block is an ILLUSTRATION, not a
// reference. GLOSSARY line 9 documents the corpus's own link convention by
// showing `[win day](../GLOSSARY.md#win-day)` in backticks; read as a live
// link it is broken by construction, and "fixing" it corrupts the example.
// The first pass of this gate did exactly that before the revert.
const stripCode = (s) =>
  s.replace(/^```[\s\S]*?^```/gm, (b) => b.replace(/\S/g, ' '))
   .replace(/`[^`\n]*`/g, (b) => b.replace(/\S/g, ' '));

function gate06a() {
  const fail = [];
  for (const f of allMarkdown()) {
    const text = stripCode(rd(f));
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:)/.test(target)) continue;
      if (target === '#') continue; // deliberate top-of-page link, used corpus-wide
      const [path, anchor] = target.split('#');
      let targetFile = f;
      if (path) {
        const abs = resolve(ROOT, dirname(f), path);
        if (!existsSync(abs)) { fail.push(`${f}: broken link -> ${target}`); continue; }
        targetFile = rel(abs);
      }
      if (anchor && targetFile.endsWith('.md')) {
        if (!anchorsOf(rd(targetFile)).has(anchor)) fail.push(`${f}: dead anchor -> ${target}`);
      }
    }
  }
  return fail;
}

// -----------------------------------------------------------------------------
// CI-06b: frontmatter present and valid
// -----------------------------------------------------------------------------
const STATUSES = new Set(['draft', 'review', 'approved', 'frozen']);

function frontmatter(text) {
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---', 4);
  if (end === -1) return null;
  const fm = {};
  for (const line of text.slice(4, end).split('\n')) {
    const m = line.match(/^([a-z_]+):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim();
  }
  return fm;
}

function gate06b() {
  const fail = [];
  for (const f of corpusDocs()) {
    const fm = frontmatter(rd(f));
    if (!fm) { fail.push(`${f}: no frontmatter block`); continue; }
    if (!STATUSES.has(fm.status)) fail.push(`${f}: status "${fm.status ?? '(missing)'}" not one of ${[...STATUSES].join(', ')}`);
    if (fm.depends_on === undefined) fail.push(`${f}: depends_on missing`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fm.last_updated ?? '')) fail.push(`${f}: last_updated "${fm.last_updated ?? '(missing)'}" is not YYYY-MM-DD`);
    // depends_on is resolved DOC-RELATIVE OR REPO-ROOT. The corpus uses both
    // spellings for the constitution (`MERIT_BUILD_MASTER_PROMPT.md` from a
    // nested file, `../../MERIT_BUILD_MASTER_PROMPT.md` from a sibling), and
    // both plainly mean the same file. The gate's job is to catch a dependency
    // pointing at nothing, not to litigate a path convention nobody ruled;
    // normalizing 15 approved documents to satisfy a check I wrote this
    // afternoon would be the gate wagging the corpus.
    for (const dep of (fm.depends_on ?? '').replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean)) {
      const found = existsSync(resolve(ROOT, dirname(f), dep)) || existsSync(resolve(ROOT, dep));
      if (!found) fail.push(`${f}: depends_on target does not resolve -> ${dep}`);
    }
  }
  return fail;
}

// -----------------------------------------------------------------------------
// CI-06c: INDEX completeness, both directions
// -----------------------------------------------------------------------------
function gate06c() {
  const fail = [];
  const idx = rd('docs/INDEX.md');
  const listed = new Set();
  for (const m of idx.matchAll(/^\| \[[^\]]+\]\(([^)]+)\)/gm)) {
    const abs = resolve(ROOT, 'docs', m[1]);
    if (!existsSync(abs)) { fail.push(`INDEX row target does not resolve -> ${m[1]}`); continue; }
    listed.add(rel(abs));
  }
  for (const f of corpusDocs()) {
    if (f === 'docs/INDEX.md') continue;
    if (!listed.has(f)) fail.push(`${f}: tracked document absent from INDEX ("if a thing is not in INDEX.md, it does not exist")`);
  }
  return fail;
}

// -----------------------------------------------------------------------------
// CI-06d: registry reconciliation
// -----------------------------------------------------------------------------
function gate06d() {
  const ec = ecDefined(), gs = gsDefined();
  const fail = [...contiguity(ec, 'EC'), ...contiguity(gs, 'GS')];
  const ecSet = new Set(ec), gsSet = new Set(gs);
  for (const f of allMarkdown()) {
    const text = rd(f);
    for (const m of text.matchAll(/\bEC-(\d{3})\b/g)) {
      if (!ecSet.has(parseInt(m[1], 10))) fail.push(`${f}: cites EC-${m[1]}, which the registry does not define`);
    }
    for (const m of text.matchAll(/\bGS-(\d{3})\b/g)) {
      if (!gsSet.has(parseInt(m[1], 10))) fail.push(`${f}: cites GS-${m[1]}, which the registry does not define`);
    }
  }
  return uniq(fail);
}

// -----------------------------------------------------------------------------
// CI-06e: every EC names a golden scenario reference, and it resolves
// -----------------------------------------------------------------------------
// TR-04's second half. An edge case with no fixture is a decision nobody can
// test. The registry is hybrid: EC-001 to EC-011 are heading blocks carrying a
// "Golden scenario ref:" line, the rest are table rows with a GS column.
// The field is MANDATORY; its value may be an explicit "none owned" naming
// what covers the case instead. EC-057 is the live example: the refund-option
// case is covered by a unit suite and M7's velocity detector, and says so.
//
// That is not a hole, and failing it would push the next author toward
// inventing a golden scenario to satisfy a checker. What TR-04 is actually
// preventing is SILENCE: an edge case whose coverage nobody stated. So the
// gate requires the declaration and accepts a reasoned negative.
function gate06e() {
  const fail = [];
  const s = rd('docs/EDGE_CASES.md');
  for (const b of s.split(/^## /m)) {
    const m = b.match(/^EC-(\d{3}):/);
    if (!m) continue;
    const line = b.split('\n').find((l) => /^- Golden scenario ref:/.test(l));
    if (!line) fail.push(`EC-${m[1]}: no "Golden scenario ref:" line at all (TR-04). State a GS-nnn or "none owned" and what covers it instead`);
    else if (!/GS-\d{3}/.test(line) && !/none owned/i.test(line)) fail.push(`EC-${m[1]}: golden scenario ref names neither a GS-nnn nor an explicit "none owned"`);
  }
  for (const line of s.split('\n')) {
    const m = line.match(/^\| EC-(\d{3}) /);
    if (m && !/GS-\d{3}/.test(line) && !/none owned/i.test(line)) fail.push(`EC-${m[1]}: registry row names no golden scenario (TR-04)`);
  }
  return fail;
}

// -----------------------------------------------------------------------------
// CI-06f: ADR numbers unique, and gapless over ALLOCATED PLUS RESERVED
// -----------------------------------------------------------------------------
// A branch cannot see the numbers its siblings hold. Two pull requests forking
// from one main both read the registry, find the same maximum, and take the
// next integer; neither is wrong locally. So a hole matching a RESERVATION
// passes, and only an unreserved hole fails.
//
// Heading ORDER is deliberately not asserted: ADR-005 sits between ADR-008 and
// ADR-009 today. The set is still unique and gapless. See STRATEGY 4.4.
function reservations() {
  const s = rd('docs/DECISIONS.md');
  const sect = s.match(/## Number allocation[\s\S]*?\n\n(?=[^|\n])/);
  const out = new Set();
  if (!sect) return out;
  for (const line of sect[0].split('\n')) {
    if (!line.startsWith('|')) continue;
    const cell = line.split('|')[1] ?? '';
    const found = [...cell.matchAll(/(\d{3})/g)].map((m) => parseInt(m[1], 10));
    if (/\bto\b/.test(cell) && found.length === 2) {
      for (let i = found[0]; i <= found[1]; i++) out.add(i);
    } else found.forEach((n) => out.add(n));
  }
  return out;
}

function gate06f() {
  const fail = [];
  const s = rd('docs/DECISIONS.md');
  const headings = [...s.matchAll(/^## ADR-(\d{3}):/gm)].map((m) => parseInt(m[1], 10));
  const seen = new Set();
  for (const n of headings) {
    if (seen.has(n)) fail.push(`ADR-${String(n).padStart(3, '0')}: duplicate heading. The second branch to claim a number must renumber (ADR-034)`);
    seen.add(n);
  }
  const known = new Set([...seen, ...reservations()]);
  const max = Math.max(...known, 0);
  for (let i = 1; i <= max; i++) {
    if (!known.has(i)) fail.push(`ADR-${String(i).padStart(3, '0')}: unreserved hole in the sequence. Claim it in the allocation table or close the gap`);
  }
  return fail;
}

// -----------------------------------------------------------------------------
// CI-06g: the COUNT GATE
// -----------------------------------------------------------------------------
const SPAN = /<!--gen:([a-z_]+)-->(.*?)<!--\/gen-->/g;

// Fenced code blocks are EXCLUDED. STRATEGY 4.4 documents the span convention
// by showing one, and a documentation example is not a claim about the corpus.
// The gate found its own illustration on the first run, which is the correct
// instinct applied to the wrong text.
const maskFences = (s) => s.replace(/^```[\s\S]*?^```/gm, (b) => b.replace(/<!--gen:/g, '<!--XGENX:'));
const unmaskFences = (s) => s.replace(/<!--XGENX:/g, '<!--gen:');

function spanPass(mutate) {
  const problems = [];
  for (const f of allMarkdown()) {
    const before = maskFences(rd(f));
    const after = before.replace(SPAN, (whole, key, value) => {
      const q = QUERIES[key];
      if (!q) { problems.push(`${f}: unknown generated key "${key}". Add its query to QUERIES or remove the span`); return whole; }
      const derived = String(q());
      if (derived !== value) {
        problems.push(mutate
          ? `${f}: ${key} ${value} -> ${derived}`
          : `${f}: ${key} says ${value}, derived is ${derived}. Run "node scripts/corpus/gates.mjs generate"`);
      }
      return `<!--gen:${key}-->${derived}<!--/gen-->`;
    });
    if (mutate && after !== before) writeFileSync(join(ROOT, f), unmaskFences(after));
  }
  return problems;
}

// -----------------------------------------------------------------------------
// MANIFEST COMPLETENESS (ADR-026)
// -----------------------------------------------------------------------------
// Every SD-nn and U-nn appearing anywhere in docs/ appears exactly once in
// DELTA_MANIFEST as a row with a disposition. A count nobody can drift is
// better than a count someone remembers to update.
function gateManifest() {
  const fail = [];
  const man = rd('packages/db/DELTA_MANIFEST.md');
  const rows = new Map();
  for (const line of man.split('\n')) {
    const m = line.match(/^\| \*{0,2}((?:SD|U)-[A-Za-z0-9-]+?)\*{0,2} \|/);
    if (!m) continue;
    rows.set(m[1], (rows.get(m[1]) ?? 0) + 1);
    if (!/\*\*(landed|reserved|deferred|rejected)/i.test(line)) fail.push(`${m[1]}: manifest row carries no disposition`);
  }
  for (const [id, n] of rows) if (n > 1) fail.push(`${id}: appears in ${n} manifest rows, must be exactly one`);

  const cited = new Set();
  for (const f of [...walk('docs'), 'packages/db/DELTA_MANIFEST.md']) {
    for (const m of rd(f).matchAll(/\b((?:SD|U)-(?:\d{2}|M\d{1,2}-\d{2}))\b/g)) cited.add(m[1]);
  }
  for (const id of [...cited].sort()) {
    if (!rows.has(id)) fail.push(`${id}: cited in docs/ but has no row in DELTA_MANIFEST (ADR-026's completeness gate)`);
  }
  return fail;
}

// -----------------------------------------------------------------------------
// Runner
// -----------------------------------------------------------------------------
const GATES = [
  ['CI-06a', 'Link check: in-repo targets and anchors resolve', gate06a],
  ['CI-06b', 'Frontmatter present and valid on every tracked document', gate06b],
  ['CI-06c', 'INDEX completeness, both directions', gate06c],
  ['CI-06d', 'Registry reconciliation: EC and GS contiguous, every citation resolves', gate06d],
  ['CI-06e', 'Every EC names a golden scenario reference', gate06e],
  ['CI-06f', 'ADR numbers unique and gapless over allocated plus reserved', gate06f],
  ['CI-06g', 'COUNT GATE: no document states a quantity a script can derive', () => spanPass(false)],
  ['ADR-026', 'Manifest completeness: every SD-nn and U-nn has exactly one row', gateManifest],
];

const mode = process.argv[2] ?? 'check';

if (mode === 'generate') {
  const changed = spanPass(true);
  console.log(changed.length ? `Regenerated ${changed.length} span(s):\n  ${changed.join('\n  ')}` : 'All generated spans already match their derived values.');
  process.exit(0);
}

// Dev affordance: list the anchors a file actually offers. CI-06a tells you a
// link is dead; this tells you what to point it at instead.
if (mode === 'anchors') {
  const f = process.argv[3];
  if (!f) { console.error('usage: gates.mjs anchors <file.md> [filter]'); process.exit(2); }
  const filter = (process.argv[4] ?? '').toLowerCase();
  for (const a of [...anchorsOf(rd(f))].sort()) if (!filter || a.includes(filter)) console.log(a);
  process.exit(0);
}

if (mode !== 'check') {
  console.error(`usage: gates.mjs [check|generate|anchors <file.md> [filter]]`);
  process.exit(2);
}

let failed = 0;
for (const [id, title, fn] of GATES) {
  let problems;
  try {
    problems = fn();
  } catch (err) {
    problems = [`gate threw: ${err.message}`];
  }
  if (problems.length === 0) {
    console.log(`PASS  ${id}  ${title}`);
  } else {
    failed += problems.length;
    console.log(`FAIL  ${id}  ${title}`);
    for (const p of problems) console.log(`        ${p}`);
  }
}

console.log(
  failed === 0
    ? '\nAll corpus integrity gates pass.'
    : `\n${failed} problem(s). The corpus is the deliverable; a deliverable with no CI is one held together by attention.`
);
process.exit(failed === 0 ? 0 : 1);
