#!/usr/bin/env node
// =============================================================================
// scripts/corpus/gates.mjs
// =============================================================================
// The corpus-integrity gates of STRATEGY section 4.4, as a runnable check.
//
//   node scripts/corpus/gates.mjs check            run every gate
//   node scripts/corpus/gates.mjs check CI-06i     run one gate
//   node scripts/corpus/gates.mjs list             list the gates
//   node scripts/corpus/gates.mjs anchors <f.md>   the anchors a file offers
//
// Exit code is 0 only when every gate that ran reported PASS.
//
// TWO RULES THIS FILE IS WRITTEN UNDER, both from the corpus that asked for it:
//
//   1. NEVER WEAKEN A GATE TO PASS IT. A gate that cannot check the whole of
//      what its STRATEGY row specifies says so in its `covers` line and checks
//      the part it can. It never returns PASS for a check it did not perform.
//   2. A GATE THAT CANNOT RUN IS NOT A GATE THAT PASSED. Any gate that cannot
//      reach its inputs reports ERROR, which is a non-zero exit, not a skip.
//
// No dependencies, on purpose: a gate with an install step is a gate that stops
// running on the day the install breaks.
//
// PROVENANCE (2026-08-15 reconciliation of PR #7 and PR #8). Two sessions wrote
// this file independently. The founder ruled PR #8's runner the base BECAUSE IT
// HAD BEEN FALSIFIED: it produced 109 phantom broken anchors and 119 phantom
// refless edge cases, both were traced to bugs in the runner rather than to the
// corpus, both were fixed, and only then did it find 27 real broken anchors.
// PR #7's runner had not been watched fail correctly, which is this phase's own
// definition of done for a gate.
//
// Ported in from PR #7 rather than discarded with it, each one real added
// coverage the base did not have:
//   * the ADR-026 manifest completeness gate, which PR #8 had no equivalent of
//   * CI-06h's tree half, and the sql_tables / sql_triggers / manifest_changes /
//     index_entries span queries the install job cross-checks
//   * CI-06d's contiguity check (EC and GS run 1..n with no holes)
//   * CI-06b's depends_on resolution
//   * CI-06a's duplicate-heading suffixes and <a name> anchors
//   * the `anchors` dev subcommand
// Deliberately NOT ported, in writing rather than by omission: PR #7's narrower
// document scopes, its `failed += problems.length` exit accounting (it counts
// findings where this runner counts gates), and its prose. See the session log.
//
// Added here, by neither branch: CI-06j, the trigger-body column resolution
// gate. It is the check that would have caught ADR-035.
// =============================================================================

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

function walk(dir, out = []) {
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const rel = join(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const allFiles = () => walk('.').map((p) => p.replace(/^\.\//, ''));
const markdownFiles = () => allFiles().filter((p) => extname(p) === '.md');

// GitHub's heading-to-anchor slug, which is what a `#anchor` link resolves
// against. Lowercase, strip anything that is not a word character, space or
// hyphen, then map EACH space to one hyphen.
//
// Each space, not each run of them. Written `\s+` this collapses the double
// space in "...domain  (2026-08-13..." to a single hyphen and reports 109
// perfectly good anchors as broken. The corpus was right and the gate was
// wrong, which is the failure mode a gate has to be tested against before it
// is trusted to fail a build.
function slug(heading) {
  return heading
    .replace(/<[^>]+>/g, '') // inline HTML in a heading is not part of its text
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/ /g, '-');
}

// Two heading texts that slug identically get `-1`, `-2` on GitHub, and the
// corpus deep-links into repeated section names. Ported from PR #7: without it
// a legitimate `#foo-1` reads as dead. This can only ADD anchors, never remove
// one, so it cannot make a real break pass unnoticed as a side effect.
//
// `<a name="x">` and `<a id="x">` are explicit anchors and count too.
function headingSlugs(body) {
  const seen = new Map();
  const out = new Set();
  for (const line of body.split('\n')) {
    const m = /^#{1,6}\s+(.*?)\s*$/.exec(line);
    if (!m) continue;
    const base = slug(m[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n === 0 ? base : `${base}-${n}`);
  }
  for (const m of body.matchAll(/<a[^>]+(?:name|id)="([^"]+)"/g)) out.add(m[1]);
  return out;
}

// A registry that numbers 1..n with no holes and no duplicates. Ported from
// PR #7's CI-06d. Takes the identifier strings, sorts numerically, reports what
// is wrong rather than only that something is.
function contiguity(ids, label) {
  const ns = [...new Set(ids.map((s) => Number(s.slice(-3))))].sort((a, b) => a - b);
  const bad = [];
  if (ns.length && ns[0] !== 1) bad.push(`${label} registry starts at ${ns[0]}, not 1`);
  for (let i = 1; i < ns.length; i++) {
    if (ns[i] !== ns[i - 1] + 1) bad.push(`${label} registry gap: ${ns[i - 1]} -> ${ns[i]}`);
  }
  return bad;
}

function frontmatter(body) {
  if (!body.startsWith('---\n')) return null;
  const end = body.indexOf('\n---', 4);
  if (end === -1) return null;
  const fields = {};
  for (const line of body.slice(4, end).split('\n')) {
    const m = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (m) fields[m[1]] = m[2].trim();
  }
  return fields;
}

// -----------------------------------------------------------------------------
// What counts as a corpus document
// -----------------------------------------------------------------------------
// ONE definition, called by CI-06b and CI-06c both, because until OQ-P1-04 was
// ruled this runner carried two of them ten lines apart. CI-06b globbed
// `^(docs|research|packages)/`; CI-06c globbed `^(docs|research)/` plus
// DELTA_MANIFEST by name. They agreed for exactly as long as `packages/` held
// one markdown file, and the first package README would have failed one and
// passed the other.
//
// THE RULING IS THE SHAPE, NOT THE REGEX. Bringing CI-06b's expression into
// line with CI-06c's would have produced two expressions of one concept that
// agree today, which is precisely how the defect was born. So there is one
// predicate and both gates call it.
//
// A package README is a source file that happens to be markdown. A corpus
// document is a thing with a gateable status and an INDEX row, and it is the
// second class these gates exist for. Exempting `README.md` by filename was
// rejected on evidence: `docs/legal/README.md`, `docs/ops/runbooks/README.md`
// and `research/calibration/README.md` are corpus documents, approved and
// indexed, and would have silently stopped being checked.
//
// THE BY-NAME ENTRY IS A HAND-MAINTAINED LIST, which is ADR-034's own drift
// class. Fine at one entry. If it reaches three it needs a rule instead of a
// list.
//
const isCorpusDocument = (file) =>
  (/^(docs|research)\//.test(file) || file === 'packages/db/DELTA_MANIFEST.md') &&
  !/^docs\/reviews\//.test(file); // verdicts are overwritten artifacts

// docs/INDEX.md is NOT excluded here, and the distinction is the ruling.
// INDEX is a corpus document: it carries frontmatter and a gate status, and
// CI-06b must check it. CI-06c skips it for an unrelated reason -- a list
// cannot contain itself -- which is a property of that gate's mechanics
// rather than of the document class. Folding the two together put INDEX's
// own frontmatter beyond every gate, so a hand-edit to `status: nearly`
// would have passed the whole runner.

// -----------------------------------------------------------------------------
// The allocation tables: ONE parser, called by CI-06f and CI-06h both (ADR-036)
// -----------------------------------------------------------------------------
// DECISIONS.md carries two allocation tables, one for ADR numbers and one for
// migration numbers, and the rule over both is ADR-034's: a number is claimed in
// the table BEFORE the artifact is written, and gaplessness is asserted over
// allocated PLUS reserved so a branch holding a reservation shows a hole and
// passes.
//
// ONE FUNCTION READS BOTH. Writing a second scan for the second table is
// OQ-P1-04's defect, in the runner OQ-P1-04 was ruled about, and the arrival of
// a second table is precisely the event that creates it. Two expressions of
// "what does this table claim" would have agreed for exactly as long as nothing
// was ever reserved.
//
// IT READS THE FIRST CELL OF TABLE ROWS ONLY. CI-06f's predecessor scanned the
// whole section with /\b(\d{3})\b/, so any three-digit numeral in the
// surrounding PROSE reserved that number. That is the dangerous direction: a
// number reserved by accident is a hole this gate stops reporting.
const ADR_ALLOCATION = '## Number allocation';
const MIGRATION_ALLOCATION = '## Migration number allocation';

function allocated(body, heading) {
  const start = body.indexOf(heading);
  if (start === -1) throw new Error(`allocation table not found: "${heading}"`);
  const rest = body.slice(start + heading.length);
  const next = rest.search(/\n## /);
  const claimed = new Set();
  let rows = 0;
  for (const line of (next === -1 ? rest : rest.slice(0, next)).split('\n')) {
    if (!line.startsWith('|')) continue;
    // `| 001 to 032 |`, `| **033** |`, `| 0001 to 0028 |`. The header row and
    // the `|---|` separator do not match, which is how they are skipped.
    const m = /^\s*\*{0,2}(\d{3,4})\*{0,2}(?:\s+to\s+\*{0,2}(\d{3,4})\*{0,2})?\s*$/.exec(
      line.split('|')[1] ?? '',
    );
    if (!m) continue;
    rows++;
    const to = m[2] ? Number(m[2]) : Number(m[1]);
    for (let n = Number(m[1]); n <= to; n++) claimed.add(n);
  }
  // A table that parses to nothing is a gate with an empty reservation set,
  // which reports every hole and no false pass. It is still a runner that has
  // lost its input, and rule 2 of this file says that is an ERROR, not a pass.
  if (rows === 0) throw new Error(`allocation table claims no numbers: "${heading}"`);
  return claimed;
}

// -----------------------------------------------------------------------------
// CI-06a  Link check
// -----------------------------------------------------------------------------
const ci06a = {
  id: 'CI-06a',
  title: 'Link check, including anchors',
  covers:
    'relative markdown links and their #anchors, resolved against the tree. ' +
    'Does NOT check external http(s) targets, which need network and belong ' +
    'to the lychee job in CI.',
  run() {
    const findings = [];
    const slugCache = new Map();
    for (const file of markdownFiles()) {
      const body = read(file);
      // Skip fenced code: a link inside a code fence is a sample, not a link.
      const lines = body.split('\n');
      let fenced = false;
      lines.forEach((line, i) => {
        if (/^\s*```/.test(line)) fenced = !fenced;
        if (fenced) return;
        // Inline code is a sample, not a link. GLOSSARY's own convention
        // paragraph shows `[win day](GLOSSARY.md#win-day)` as an example of the
        // form, and reading it as a link reports the file as linking to itself
        // through a path that does not exist.
        line = line.replace(/`[^`]*`/g, '');
        for (const m of line.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
          const target = m[1];
          if (/^(https?:|mailto:|#\))/.test(target)) continue;
          const [pathPart, anchor] = target.split('#');
          let targetFile = file;
          if (pathPart) {
            targetFile = relative(ROOT, resolve(join(ROOT, dirname(file)), pathPart));
            if (!existsSync(join(ROOT, targetFile))) {
              findings.push(`${file}:${i + 1} -> ${target} (no such file)`);
              continue;
            }
          }
          if (!anchor) continue;
          if (extname(targetFile) !== '.md') continue;
          if (!slugCache.has(targetFile)) slugCache.set(targetFile, headingSlugs(read(targetFile)));
          if (!slugCache.get(targetFile).has(anchor.toLowerCase())) {
            findings.push(`${file}:${i + 1} -> ${target} (no such heading)`);
          }
        }
      });
    }
    return findings;
  },
};

// -----------------------------------------------------------------------------
// CI-06b  Frontmatter present and valid
// -----------------------------------------------------------------------------
const ci06b = {
  id: 'CI-06b',
  title: 'Frontmatter present and valid on every tracked document',
  covers:
    'status, depends_on and last_updated on every corpus document, AND that every ' +
    'depends_on target resolves to a file that exists. The document set is ' +
    'isCorpusDocument, shared with CI-06c (OQ-P1-04). A markdown file under ' +
    'packages/ that is not on that list is a source file rather than a corpus ' +
    'document and is NOT checked. docs/INDEX.md IS checked here; only CI-06c ' +
    'skips it, and for a reason about that gate rather than about the file.',
  run() {
    const valid = new Set(['draft', 'review', 'approved', 'frozen']);
    const findings = [];
    for (const file of markdownFiles()) {
      if (!isCorpusDocument(file)) continue;
      const fm = frontmatter(read(file));
      if (!fm) {
        findings.push(`${file}: no frontmatter block`);
        continue;
      }
      for (const key of ['status', 'depends_on', 'last_updated']) {
        if (!(key in fm)) findings.push(`${file}: frontmatter missing ${key}`);
      }
      if (fm.status && !valid.has(fm.status)) {
        findings.push(`${file}: status "${fm.status}" is not one of ${[...valid].join(' | ')}`);
      }
      if (fm.last_updated && !/^\d{4}-\d{2}-\d{2}$/.test(fm.last_updated)) {
        findings.push(`${file}: last_updated "${fm.last_updated}" is not YYYY-MM-DD`);
      }
      // Ported from PR #7. A `depends_on` naming a file that does not exist is
      // a dependency nobody can follow, and the field is otherwise decoration.
      //
      // Resolved DOC-RELATIVE OR REPO-ROOT, deliberately. The corpus spells the
      // constitution both ways (`MERIT_BUILD_MASTER_PROMPT.md` from a nested
      // file, `../../MERIT_BUILD_MASTER_PROMPT.md` from a sibling) and both
      // plainly mean the same file. The gate's job is to catch a dependency
      // pointing at nothing, not to litigate a path convention nobody ruled.
      for (const dep of (fm.depends_on ?? '')
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)) {
        const found =
          existsSync(resolve(ROOT, dirname(file), dep)) || existsSync(resolve(ROOT, dep));
        if (!found) findings.push(`${file}: depends_on does not resolve -> ${dep}`);
      }
    }
    return findings;
  },
};

// -----------------------------------------------------------------------------
// CI-06c  INDEX completeness
// -----------------------------------------------------------------------------
const ci06c = {
  id: 'CI-06c',
  title: 'INDEX completeness, in both directions',
  covers:
    'every tracked document appears in docs/INDEX.md, and every INDEX link resolves. ' +
    '"If a thing is not in INDEX.md, it does not exist."',
  run() {
    const findings = [];
    const index = read('docs/INDEX.md');
    const linked = new Set();
    for (const m of index.matchAll(/\[[^\]]*\]\(([^)\s#]+)[^)]*\)/g)) {
      const target = relative(ROOT, resolve(join(ROOT, 'docs'), m[1]));
      linked.add(target);
      if (!existsSync(join(ROOT, target))) findings.push(`INDEX row does not resolve: ${m[1]}`);
    }
    // Scope widened at the reconciliation to match PR #7's: research/ and the
    // DELTA_MANIFEST are tracked documents that INDEX already carries, and a
    // gate that reads "every tracked document" while checking only docs/ is a
    // gate reporting green for a check it did not perform. That scope is now
    // isCorpusDocument, which CI-06b reads from too (OQ-P1-04).
    for (const file of markdownFiles()) {
      if (!isCorpusDocument(file)) continue;
      // Gate-local, not a scope rule: a list cannot contain itself. INDEX is a
      // corpus document and CI-06b checks its frontmatter; only this gate has
      // a reason to skip it.
      if (file === 'docs/INDEX.md') continue;
      if (!linked.has(file)) findings.push(`not in INDEX: ${file}`);
    }
    return findings;
  },
};

// -----------------------------------------------------------------------------
// CI-06d  Registry reconciliation
// -----------------------------------------------------------------------------
// THE QUERY IS NAMED, because "a script can derive it" is not a specification.
// Counting registry table ROWS gives the wrong answer (22 and 301); counting
// DISTINCT IDENTIFIERS gives the corpus's 140 and 257. This gate counts
// distinct identifiers.
const ci06d = {
  id: 'CI-06d',
  title: 'Registry reconciliation: every cited GS-nnn and EC-nnn exists',
  covers:
    'every GS-nnn and EC-nnn cited anywhere in docs/ resolves to a definition in ' +
    'its registry, counting DISTINCT IDENTIFIERS rather than table rows, AND that ' +
    'each registry runs 1..n with no holes and no duplicates.',
  run() {
    const findings = [];
    const gsBody = read('docs/testing/GOLDEN_SCENARIOS.md');
    const ecBody = read('docs/EDGE_CASES.md');
    const defined = (body, re) => new Set([...body.matchAll(re)].map((m) => m[1]));
    // A definition is an identifier at the start of a registry row or heading.
    const gs = defined(gsBody, /^[|#\s]*\**\s*(GS-\d{3})\b/gm);
    const ec = defined(ecBody, /^[|#\s]*\**\s*(EC-\d{3})\b/gm);
    if (gs.size === 0 || ec.size === 0) {
      throw new Error('registry parse produced zero identifiers; the gate cannot run');
    }
    // CONTIGUITY, ported from PR #7. Resolving every citation proves nothing
    // about the registry itself: a registry that skips EC-078 entirely has no
    // dangling citation, and the missing edge case is invisible from the
    // citation side. This is the half that looks at the registry.
    findings.push(...contiguity([...ec], 'EC'), ...contiguity([...gs], 'GS'));
    for (const file of markdownFiles()) {
      if (!/^docs\//.test(file)) continue;
      const body = read(file);
      for (const m of body.matchAll(/\b(GS-\d{3})\b/g)) {
        if (!gs.has(m[1])) findings.push(`${file}: cites ${m[1]}, not in GOLDEN_SCENARIOS`);
      }
      for (const m of body.matchAll(/\b(EC-\d{3})\b/g)) {
        if (!ec.has(m[1])) findings.push(`${file}: cites ${m[1]}, not in EDGE_CASES`);
      }
    }
    return [...new Set(findings)];
  },
};

// -----------------------------------------------------------------------------
// CI-06e  Every EC-nnn names a golden scenario, and it resolves
// -----------------------------------------------------------------------------
const ci06e = {
  id: 'CI-06e',
  title: 'Every edge case names a golden scenario reference, and it resolves',
  covers:
    'TR-04\'s second half. An edge case with no fixture is a decision nobody can test.',
  run() {
    const findings = [];
    const ecBody = read('docs/EDGE_CASES.md');
    const gs = new Set(
      [...read('docs/testing/GOLDEN_SCENARIOS.md').matchAll(/^[|#\s]*\**\s*(GS-\d{3})\b/gm)].map(
        (m) => m[1],
      ),
    );
    // THE REGISTRY HAS TWO DEFINITION FORMS AND BOTH ARE VALID.
    //   block form: `## EC-nnn: <name>` with a `- Golden scenario ref:` field
    //   table form: `| EC-nnn | ... | GS-nnn |`, the Appendix B4 battery, which
    //               is 22 rows under a single range heading
    // Reading only the block form reports 21 real entries as missing.
    const sites = new Map();
    for (const line of ecBody.split('\n')) {
      const row = /^\|\s*(EC-\d{3})\s*\|/.exec(line);
      if (row) sites.set(row[1], { id: row[1], text: line, form: 'table' });
    }
    for (const block of ecBody.split(/^## (?=EC-\d{3}:)/m).slice(1)) {
      const id = /^(EC-\d{3}):/.exec(block)[1];
      sites.set(id, { id, text: block, form: 'block' });
    }

    // An entry may state that it owns no golden scenario, and EC-057 does. That
    // is a considered answer rather than a forgotten field, so the gate accepts
    // it and REPORTS IT, because an accepted exception that nobody can see is
    // how a gate quietly stops gating. The sentinel is `none owned`, documented
    // in STRATEGY's CI-06e row. Introduced 2026-08-15 and open to a founder
    // ruling: the alternative is that EC-057 gets a scenario of its own.
    const accepted = [];
    for (const { id, text, form } of [...sites.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      const scope =
        form === 'block'
          ? (text.split('\n').find((l) => /golden scenario ref/i.test(l)) ?? null)
          : text;
      if (scope === null) {
        findings.push(`${id}: has no "Golden scenario ref:" field`);
        continue;
      }
      const cited = [...scope.matchAll(/\b(GS-\d{3})\b/g)].map((x) => x[1]);
      if (cited.length === 0) {
        if (/none owned/i.test(scope)) {
          accepted.push(id);
          continue;
        }
        findings.push(`${id}: names no golden scenario (${scope.trim().slice(0, 70)})`);
        continue;
      }
      for (const g of cited) if (!gs.has(g)) findings.push(`${id}: cites ${g}, which does not exist`);
    }
    if (accepted.length) {
      console.log(
        `       CI-06e note: ${accepted.length} entry(ies) declare "none owned", accepted: ` +
          accepted.join(', '),
      );
    }
    return findings;
  },
};

// -----------------------------------------------------------------------------
// CI-06f  ADR numbers unique, and gapless over allocated PLUS reserved
// -----------------------------------------------------------------------------
const ci06f = {
  id: 'CI-06f',
  title: 'ADR numbers are unique and gapless over allocated plus reserved',
  covers:
    'uniqueness and gaplessness within DECISIONS.md, against the allocation table. ' +
    'The cross-branch half (a PR may not claim a number already on main) belongs ' +
    'to the CI job, which can see both refs; this run cannot.',
  run() {
    const findings = [];
    const body = read('docs/DECISIONS.md');
    const headings = [...body.matchAll(/^## ADR-(\d{3}):/gm)].map((m) => Number(m[1]));
    const seen = new Set();
    for (const n of headings) {
      if (seen.has(n)) findings.push(`ADR-${String(n).padStart(3, '0')} appears more than once`);
      seen.add(n);
    }
    if (seen.size === 0) throw new Error('no ADR headings found; the gate cannot run');
    // The allocation table is the reserved set: any number it names is allowed
    // to be absent from this file, because a sibling branch holds it. Shared
    // with CI-06h since ADR-036; see `allocated` for why it is one function.
    const alloc = allocated(body, ADR_ALLOCATION);
    const max = Math.max(...seen, ...alloc);
    for (let n = 1; n <= max; n++) {
      if (!seen.has(n) && !alloc.has(n)) {
        findings.push(`ADR-${String(n).padStart(3, '0')} is neither present nor reserved (a hole)`);
      }
    }
    return findings;
  },
};

// -----------------------------------------------------------------------------
// CI-06g  THE COUNT GATE
// -----------------------------------------------------------------------------
// No document states a quantity a script can derive unless the number sits in a
// generated span the script rewrites. This run checks the half that is checkable
// without the generator: every generated span that EXISTS still matches its
// query. The corpus sweep for bare numerals is the generator's job and is
// declared here rather than silently omitted.
// EVERY KEY CARRIES ITS QUERY HERE RATHER THAN IN A READER'S HEAD. Counting
// rows in the EC and GS registries gives 22 and 301; counting DISTINCT
// IDENTIFIERS gives the corpus's 140 and 257. Both are "a script deriving it"
// and one is wrong, so the query is written down beside the key.
const SPAN_QUERIES = {
  adr_count: () =>
    new Set([...read('docs/DECISIONS.md').matchAll(/^## ADR-(\d{3}):/gm)].map((m) => m[1])).size,
  // DISTINCT IDENTIFIERS, not headings. EC-012 to EC-033 are the Appendix B4
  // battery and live as TABLE ROWS under one heading, so counting `## EC-nnn`
  // gives 119 against the registry's 140. This is the exact trap STRATEGY names
  // when it says counting rows gives 22 and counting identifiers gives 140.
  ec_count: () =>
    new Set([...read('docs/EDGE_CASES.md').matchAll(/\b(EC-\d{3})\b/g)].map((m) => m[1])).size,
  gs_count: () =>
    new Set(
      [...read('docs/testing/GOLDEN_SCENARIOS.md').matchAll(/\b(GS-\d{3})\b/g)].map((m) => m[1]),
    ).size,
  migration_files: () =>
    readdirSync(join(ROOT, 'packages/db/migrations')).filter((f) => extname(f) === '.sql').length,
  tables: () => tablesInMigrations().length,

  // ---------------------------------------------------------------------------
  // Ported from PR #7. These four spans are LIVE IN docs/STATE.md, which is why
  // the merge of the two branches failed CI-06g on arrival: PR #7 wrote the
  // spans into the document and PR #8's runner had no queries for them. That is
  // the gate doing exactly its job across a merge, and it is worth recording.
  // ---------------------------------------------------------------------------

  // `sql_tables` and `tables` are the same number by two parsers, kept as two
  // keys on purpose: the install job (CI-06h) cross-checks `^CREATE TABLE `
  // against the live catalogue, so the grep form has to stay derivable here.
  sql_tables: () => sqlMatchCount(/^CREATE TABLE /gm),
  sql_triggers: () => sqlMatchCount(/^CREATE (?:CONSTRAINT )?TRIGGER /gm),

  // ADR-026's manifest is the authority on how many schema changes are in
  // scope. Counts SD-nn and U-nn rows whether or not the id is bolded.
  manifest_changes: () =>
    (
      read('packages/db/DELTA_MANIFEST.md').match(
        /^\|\s*\*{0,2}(?:SD|U)-[A-Za-z0-9-]+\*{0,2}\s*\|/gm,
      ) || []
    ).length,

  index_entries: () => (read('docs/INDEX.md').match(/^\| \[/gm) || []).length,

  // Added at the reconciliation. STATE said "Sixteen files carry an E2 READ"
  // against seventeen on disk, which was the seventh hand-maintained count
  // found wrong. The E2 set grows whenever a money-path migration lands, which
  // is precisely when nobody is thinking about a sentence in STATE.
  e2_files: () => sqlFiles().filter((f) => read(f).includes('E2 READ: MONEY PATH')).length,
};

// Keys STRATEGY names as derivable that this runner deliberately does not
// implement, each with the reason, so a span using one fails loudly with the
// reason rather than silently having no query.
//
// `triggers` stays deferred while `sql_triggers` is implemented, and the
// distinction is the point: `sql_triggers` is what the DDL declares, `triggers`
// is what Postgres ends up with. They agree today and CI-06h is what proves it;
// a span asserting the second from a reading of the first would be a derivation
// that looks checked and is not.
const SPAN_DEFERRED = {
  indexes: 'needs a live apply; a reading of the .sql cannot count what Postgres builds',
  check_constraints: 'needs a live apply',
  triggers: 'needs a live apply; use sql_triggers for the DDL-declared count',
  delta_count: 'needs the manifest disposition tables parsed, and that query is not yet ruled',
};

const sqlFiles = () => {
  const dir = 'packages/db/migrations';
  return readdirSync(join(ROOT, dir))
    .filter((f) => extname(f) === '.sql')
    .sort()
    .map((f) => join(dir, f));
};

const sqlMatchCount = (re) =>
  sqlFiles().reduce((n, f) => n + (read(f).match(re) || []).length, 0);

// Spans inside a fenced code block are DOCUMENTATION OF THE FORM, not spans.
// STRATEGY's own CI-06g section shows `<!--gen:adr_count-->25<!--/gen-->` in a
// fence as the worked example; regenerating it would rewrite the explanation of
// the mechanism to match the mechanism.
function spansIn(body) {
  const masked = body.replace(/^```[\s\S]*?^```/gm, (block) => block.replace(/</g, '\0'));
  return [...masked.matchAll(/<!--gen:([a-z_]+)-->(.*?)<!--\/gen-->/gs)];
}

const ci06g = {
  id: 'CI-06g',
  title: 'COUNT GATE: every generated span still matches its query',
  covers:
    'the spans that exist, re-derived and compared. The corpus-wide sweep for bare ' +
    'numerals adjacent to a registry noun needs the generator and is NOT run here.',
  run() {
    const findings = [];
    let spans = 0;
    for (const file of markdownFiles()) {
      for (const [, name, content] of spansIn(read(file))) {
        spans++;
        if (SPAN_DEFERRED[name]) {
          findings.push(`${file}: span "${name}" has no query here (${SPAN_DEFERRED[name]})`);
          continue;
        }
        const query = SPAN_QUERIES[name];
        if (!query) {
          findings.push(`${file}: span "${name}" has no named query in gates.mjs`);
          continue;
        }
        const actual = String(query());
        if (content.trim() !== actual) {
          findings.push(
            `${file}: span "${name}" reads "${content.trim()}", its query gives "${actual}". ` +
              'Run: node scripts/corpus/gates.mjs generate',
          );
        }
      }
    }
    if (spans === 0) {
      findings.push(
        'no generated spans found anywhere in the corpus, so this gate is asserting ' +
          'nothing. CI-06g is specified and its spans do not exist yet.',
      );
    }
    return findings;
  },
};

// The generator half of CI-06g. "Either generate the number into the document,
// or delete it and point at the script" needs something that generates.
function generate() {
  let changed = 0;
  for (const file of markdownFiles()) {
    const body = read(file);
    let next = body;
    for (const [full, name, content] of spansIn(body)) {
      const query = SPAN_QUERIES[name];
      if (!query) continue;
      const actual = String(query());
      if (content.trim() === actual) continue;
      next = next.replace(full, `<!--gen:${name}-->${actual}<!--/gen-->`);
      console.log(`${file}: ${name} ${content.trim()} -> ${actual}`);
      changed++;
    }
    if (next !== body) writeFileSync(join(ROOT, file), next);
  }
  console.log(changed ? `\n${changed} span(s) rewritten.` : 'every span already matches its query.');
  return 0;
}

// -----------------------------------------------------------------------------
// CI-06i  THE TABLE-SET RECONCILIATION, BOTH DIRECTIONS
// -----------------------------------------------------------------------------
// Every CREATE TABLE in packages/db/migrations has a `### <table>` section in
// DATA_MODEL, and every such section has a CREATE TABLE.
//
// WHY IT EXISTS. At the schema-delta fold the migrations created 96 tables and
// DATA_MODEL documented 46 of them. Fifty tables had no design record at all,
// and nothing failed, because nothing was counting. The next module is built by
// reading DATA_MODEL rather than the DDL, so a table with no design record is a
// module built blind, and a section describing a table that does not exist is a
// module built against a fiction. Both directions matter and only one of them is
// obvious.
//
// It is deliberately a NAME-SET check rather than a column check. Column-level
// drift is caught by the generated diff against a live catalogue, which needs a
// database; this gate needs nothing but the tree, so it can run on every push.
function tablesInMigrations() {
  const dir = 'packages/db/migrations';
  const out = [];
  for (const file of readdirSync(join(ROOT, dir)).sort()) {
    if (extname(file) !== '.sql') continue;
    const body = read(join(dir, file));
    for (const m of body.matchAll(/^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_]+)/gim)) {
      out.push({ table: m[1].toLowerCase(), file });
    }
  }
  return out;
}

const ci06i = {
  id: 'CI-06i',
  title: 'DATA_MODEL and the migrations name the same table set, both directions',
  covers:
    'every CREATE TABLE has a `### <table>` design record, and every `### <table>` ' +
    'section has a CREATE TABLE. Table names only; columns are checked against a ' +
    'live catalogue, which needs a database.',
  run() {
    const findings = [];
    const created = tablesInMigrations();
    if (created.length === 0) throw new Error('no CREATE TABLE found; the gate cannot run');
    const inSql = new Map();
    for (const { table, file } of created) {
      if (inSql.has(table)) findings.push(`${table}: CREATE TABLE in both ${inSql.get(table)} and ${file}`);
      else inSql.set(table, file);
    }

    const doc = read('docs/architecture/DATA_MODEL.md');
    // A section is exactly `### <snake_case_name>` on its own line. Prose
    // headings under §17 ("### Verification performed") do not match, which is
    // intended: a design record is a heading that IS a table name.
    const sections = [...doc.matchAll(/^### ([a-z][a-z0-9_]*)\s*$/gm)].map((m) => m[1]);
    const inDoc = new Set();
    for (const name of sections) {
      if (inDoc.has(name)) findings.push(`${name}: has more than one \`### ${name}\` section`);
      inDoc.add(name);
    }

    for (const [table, file] of inSql) {
      if (!inDoc.has(table)) findings.push(`${table} (${file}): created by a migration, no design record`);
    }
    for (const name of inDoc) {
      if (!inSql.has(name)) findings.push(`${name}: has a design record, no CREATE TABLE creates it`);
    }
    return findings;
  },
};

// -----------------------------------------------------------------------------
// CI-06h  MIGRATION INSTALL AND OBJECT COUNTS, the half a tree can check
// -----------------------------------------------------------------------------
// The install itself needs a database and lives in the `migrations` job of
// .github/workflows/corpus.yml: forward-only apply from empty under
// ON_ERROR_STOP, a re-apply that MUST fail, and the object counts read from
// pg_indexes and pg_constraint rather than from a grep.
//
// What a tree can check is the two things that make that job meaningful, and
// both have a real failure mode:
//
//   1. THE SEQUENCE, AGAINST THE ALLOCATION TABLE (ADR-036). Migrations are
//      applied in filename order, so a duplicated or missing number is an
//      ordering nobody can reason about. Two files numbered 0028 apply in an
//      order decided by the rest of the filename.
//
//      DERIVING THE SET FROM THE TREE ALONE IS BLIND BY CONSTRUCTION, which is
//      the half ADR-036 adds. A branch can only see the files it holds, so two
//      branches forking from the same main both find 0028 and both write 0029,
//      and each passes locally. The collision surfaces at MERGE, in a directory,
//      and a merged migration cannot be renumbered -- E2 makes it sacred, so the
//      renumber-the-cheaper-branch remedy ADR-034 used for the ADR collision has
//      no equivalent here. So the check is CI-06f's: gapless over the numbers on
//      disk PLUS the numbers this table reserves, and every number on disk must
//      be claimed by a row.
//
//   2. THE WIRING STILL EXISTS. A gate whose CI job was deleted reports nothing
//      at all, which reads identically to a gate that passed. This asserts the
//      job is present and still carries the three steps that make it a check
//      rather than a smoke test.
const ci06h = {
  id: 'CI-06h',
  title: 'Migration numbers are gapless over allocated plus reserved, and the install job exists',
  covers:
    'migration filenames number 1..n with no duplicates, every number on disk is ' +
    'claimed by a row of the migration allocation table in DECISIONS.md, every ' +
    'hole matches a reservation, and the corpus workflow still carries the ' +
    'ON_ERROR_STOP apply, the must-fail re-apply, the database-derived counts ' +
    'and both database probes. ' +
    'TWO THINGS IT DOES NOT DO. The install itself needs a live PostgreSQL and ' +
    'runs in CI, so a green result here is NOT a claim that the set installs. And ' +
    'the cross-branch half, that a pull request may not claim a number already on ' +
    'main, needs a job that can see both refs; this run sees one, exactly as ' +
    "CI-06f's does. The table's State column is prose and is not parsed.",
  run() {
    const findings = [];
    const files = sqlFiles().map((p) => p.replace('packages/db/migrations/', ''));
    if (files.length === 0) throw new Error('no migration files found; the gate cannot run');
    const seen = new Map();
    for (const f of files) {
      const m = /^(\d{4})_/.exec(f);
      if (!m) {
        findings.push(`${f}: migration filename does not start with a 4-digit sequence number`);
        continue;
      }
      const n = Number(m[1]);
      if (seen.has(n)) findings.push(`${m[1]}: claimed by both ${seen.get(n)} and ${f}`);
      else seen.set(n, f);
    }

    // ADR-036. Same shape as CI-06f, same parser, and the start-at-0001 check
    // that used to live here is subsumed: a missing 0001 that nobody reserved
    // is the n = 1 hole.
    const pad = (n) => String(n).padStart(4, '0');
    const alloc = allocated(read('docs/DECISIONS.md'), MIGRATION_ALLOCATION);
    const max = Math.max(...seen.keys(), ...alloc);
    for (let n = 1; n <= max; n++) {
      if (!seen.has(n) && !alloc.has(n)) {
        findings.push(`${pad(n)} is neither on disk nor reserved (a hole in the migration sequence)`);
      }
    }
    for (const [n, f] of [...seen].sort((a, b) => a[0] - b[0])) {
      if (!alloc.has(n)) {
        findings.push(
          `${f}: ${pad(n)} is not claimed by the migration allocation table in ` +
            'docs/DECISIONS.md. Claim the number there before writing the file (ADR-036)',
        );
      }
    }

    const wf = '.github/workflows/corpus.yml';
    if (!existsSync(join(ROOT, wf))) {
      findings.push(`${wf} is missing: CI-06h's install half is not wired anywhere`);
      return findings;
    }
    const body = read(wf);
    const required = [
      ['ON_ERROR_STOP=1', 'the apply step no longer stops on the first error'],
      ['Re-applying the set fails', 'the must-fail re-apply step is gone'],
      ['pg_indexes', 'the counts are no longer derived from the database'],
      ['probe_ledger_constraints.sql', 'the ledger constraint probes are no longer run'],
      // Added with rider 2 of the P1 scaffold. The probe is now wired into the
      // migrations job, and this is what keeps it wired: a probe that ships
      // beside a fix and never runs again is the same object as the golden test
      // that was missing, and deleting the step is how it stops running.
      [
        'probe_plan_version_immutability.sql',
        "ADR-035's plan-version immutability probe is no longer run",
      ],
    ];
    for (const [needle, why] of required) {
      if (!body.includes(needle)) findings.push(`${wf}: ${why} (no "${needle}")`);
    }
    return findings;
  },
};

// -----------------------------------------------------------------------------
// CI-06j  EVERY COLUMN A TRIGGER BODY NAMES MUST EXIST ON THE TABLE IT GUARDS
// -----------------------------------------------------------------------------
// THIS IS THE CHECK THAT WOULD HAVE CAUGHT ADR-035.
//
// `assert_published_plan_version_immutable()` reads `NEW.config`. `plan_versions`
// has no `config` column; the rule contract is `rules`. PL/pgSQL resolves record
// fields AT EXECUTION, not at CREATE FUNCTION, so the migration installs
// cleanly, every existing probe passes, and the function is wrong only when it
// fires. It fired on the one transition the design permits, and the result was
// that no plan version could be retired.
//
// LEDGER-C2's idea applied to columns. LEDGER-C2 asserts that a ledger entry's
// account class was declared; this asserts that a trigger's column was declared.
// Both exist because "it reads correctly" is not a check.
//
// The catalogue is built from the tree rather than from a live database on
// purpose, so this runs on every push with no service. That costs one thing and
// it is stated: a column added by a migration this parser cannot read would
// produce a false finding rather than a silent pass, which is the direction a
// gate should fail in.

// Remove SQL comments without eating the contents of strings or dollar-quoted
// function bodies. Naive `--.*$` stripping mangles `'a--b'` and every RAISE
// message in 0027.
function stripSqlComments(sql) {
  let out = '';
  for (let i = 0; i < sql.length; ) {
    if (sql.startsWith('--', i)) {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl;
    } else if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
    } else if (sql[i] === "'") {
      const end = sql.indexOf("'", i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      out += sql.slice(i, stop);
      i = stop;
    } else {
      const dollar = /^\$([A-Za-z_]*)\$/.exec(sql.slice(i, i + 40));
      if (dollar) {
        const tag = `$${dollar[1]}$`;
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end === -1 ? sql.length : end + tag.length;
        out += sql.slice(i, stop);
        i = stop;
      } else {
        out += sql[i];
        i++;
      }
    }
  }
  return out;
}

// table -> Set(column), from CREATE TABLE bodies and ALTER TABLE ADD COLUMN.
function columnCatalogue() {
  const cols = new Map();
  const add = (t, c) => {
    if (!cols.has(t)) cols.set(t, new Set());
    cols.get(t).add(c);
  };
  const NOT_A_COLUMN = new Set([
    'constraint', 'primary', 'unique', 'check', 'foreign', 'exclude', 'like', 'partition',
  ]);
  for (const file of sqlFiles()) {
    const sql = stripSqlComments(read(file));
    for (const m of sql.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s*\(/gi)) {
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
      const inner = sql.slice(start, i);
      let d = 0;
      let item = '';
      const items = [];
      for (const ch of inner) {
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
    for (const m of sql.matchAll(
      /\bALTER\s+TABLE\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi,
    )) {
      add(m[1].toLowerCase(), m[2].toLowerCase());
    }
  }
  return cols;
}

// fn -> { file, body, tables:Set }, from CREATE FUNCTION and the CREATE TRIGGER
// rows that attach it. A function attached to two tables must resolve against
// both, because it runs for both.
//
// TWO PASSES, NOT ONE, and the harness is why. A superseding migration rebinds
// a guard with CREATE OR REPLACE FUNCTION and does NOT recreate the trigger,
// because the trigger already points at the name. Collecting definitions and
// attachments in a single file-ordered pass makes the later definition wipe the
// attachment the earlier file recorded, and the gate then reports a live guard
// as orphaned. That is exactly what it did on 0028, on the first run of
// falsify.mjs, which is the entire argument for owning a harness that runs the
// gates against a deliberately broken tree.
//
// The LATEST definition wins for the body, because that is what the database
// ends up executing. Attachments accumulate across every file.
function triggerFunctions() {
  const fns = new Map();
  const attached = new Map();
  for (const file of sqlFiles()) {
    const sql = stripSqlComments(read(file));
    for (const m of sql.matchAll(
      /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-z_][a-z0-9_]*)\s*\([^)]*\)\s+RETURNS\s+trigger\b([\s\S]*?)\$([A-Za-z_]*)\$([\s\S]*?)\$\3\$/gi,
    )) {
      fns.set(m[1].toLowerCase(), { file, body: m[4] });
    }
    for (const m of sql.matchAll(
      /\bCREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+[a-z_][a-z0-9_]*\s+([\s\S]*?)EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+([a-z_][a-z0-9_]*)\s*\(/gi,
    )) {
      const on = /\bON\s+([a-z_][a-z0-9_]*)/i.exec(m[1]);
      if (!on) continue;
      const fn = m[2].toLowerCase();
      if (!attached.has(fn)) attached.set(fn, new Set());
      attached.get(fn).add(on[1].toLowerCase());
    }
  }
  for (const [name, def] of fns) def.tables = attached.get(name) ?? new Set();
  return fns;
}

const ci06j = {
  id: 'CI-06j',
  title: 'Every NEW./OLD. column a trigger body names exists on the table it guards',
  covers:
    'record-field references in PL/pgSQL trigger functions, resolved against the ' +
    'columns the migrations declare, plus trigger functions never attached to a ' +
    'table. It does NOT resolve bare column references inside embedded SQL, which ' +
    'need a real parser or a live catalogue. ADR-035 was a NEW. reference.',
  run() {
    const findings = [];
    const cols = columnCatalogue();
    const fns = triggerFunctions();
    if (fns.size === 0) throw new Error('no trigger functions parsed; the gate cannot run');
    for (const [name, { file, body, tables }] of [...fns].sort()) {
      const refs = new Set([...body.matchAll(/\b(?:NEW|OLD)\.([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase()));
      if (tables.size === 0) {
        if (refs.size) findings.push(`${name} (${file}): reads NEW./OLD. and no CREATE TRIGGER attaches it to a table`);
        continue;
      }
      for (const table of [...tables].sort()) {
        const known = cols.get(table);
        if (!known) {
          findings.push(`${name} (${file}): attached to ${table}, which no migration creates`);
          continue;
        }
        for (const ref of [...refs].sort()) {
          if (!known.has(ref)) {
            findings.push(
              `${name} (${file}): reads NEW/OLD.${ref}, and ${table} has no such column ` +
                `(it has ${[...known].sort().join(', ')})`,
            );
          }
        }
      }
    }
    return findings;
  },
};

// -----------------------------------------------------------------------------
// ADR-026  MANIFEST COMPLETENESS
// -----------------------------------------------------------------------------
// Ported from PR #7, which is the only branch that had it. Every SD-nn and U-nn
// appearing anywhere in docs/ appears exactly once in DELTA_MANIFEST as a row
// carrying a disposition. A count nobody can drift beats a count somebody
// remembers to update, and this gate found `U-06` on its first run.
const adr026 = {
  id: 'ADR-026',
  title: 'Manifest completeness: every SD-nn and U-nn has exactly one row, with a disposition',
  covers:
    'every delta id cited anywhere in docs/ has exactly one DELTA_MANIFEST row, and ' +
    'every row states landed / reserved / deferred / rejected. It does NOT check ' +
    'that the disposition is TRUE of the migrations, which is the E2 read.',
  run() {
    const findings = [];
    const man = read('packages/db/DELTA_MANIFEST.md');
    const rows = new Map();
    for (const line of man.split('\n')) {
      const m = /^\| \*{0,2}((?:SD|U)-[A-Za-z0-9-]+?)\*{0,2} \|/.exec(line);
      if (!m) continue;
      rows.set(m[1], (rows.get(m[1]) ?? 0) + 1);
      if (!/\*\*(landed|reserved|deferred|rejected)/i.test(line)) {
        findings.push(`${m[1]}: manifest row carries no disposition`);
      }
    }
    if (rows.size === 0) throw new Error('no manifest rows parsed; the gate cannot run');
    for (const [id, n] of rows) {
      if (n > 1) findings.push(`${id}: appears in ${n} manifest rows, must be exactly one`);
    }
    const cited = new Set();
    for (const file of markdownFiles()) {
      if (!/^docs\//.test(file) && file !== 'packages/db/DELTA_MANIFEST.md') continue;
      for (const m of read(file).matchAll(/\b((?:SD|U)-(?:\d{2}|M\d{1,2}-\d{2}))\b/g)) cited.add(m[1]);
    }
    for (const id of [...cited].sort()) {
      if (!rows.has(id)) findings.push(`${id}: cited in docs/ but has no DELTA_MANIFEST row`);
    }
    return findings;
  },
};

// -----------------------------------------------------------------------------
// Runner
// -----------------------------------------------------------------------------
const GATES = [ci06a, ci06b, ci06c, ci06d, ci06e, ci06f, ci06g, ci06h, ci06i, ci06j, adr026];

function main() {
  const [cmd, only] = process.argv.slice(2);

  if (cmd === 'list') {
    for (const g of GATES) console.log(`${g.id}  ${g.title}\n      covers: ${g.covers}\n`);
    return 0;
  }
  if (cmd === 'generate') return generate();

  // Dev affordance ported from PR #7: CI-06a tells you a link is dead, this
  // tells you what to point it at instead.
  if (cmd === 'anchors') {
    if (!only) {
      console.error('usage: node scripts/corpus/gates.mjs anchors <file.md> [filter]');
      return 2;
    }
    const filter = (process.argv[4] ?? '').toLowerCase();
    for (const a of [...headingSlugs(read(only))].sort()) if (!filter || a.includes(filter)) console.log(a);
    return 0;
  }

  if (cmd !== 'check') {
    console.error(
      'usage: node scripts/corpus/gates.mjs check [GATE-ID] | generate | list | anchors <file.md>',
    );
    return 2;
  }

  const selected = only ? GATES.filter((g) => g.id === only) : GATES;
  if (selected.length === 0) {
    console.error(`no such gate: ${only}`);
    return 2;
  }

  let failed = 0;
  for (const gate of selected) {
    let findings;
    try {
      findings = gate.run();
    } catch (err) {
      console.log(`ERROR  ${gate.id}  ${gate.title}`);
      console.log(`       ${err.message}`);
      failed++;
      continue;
    }
    if (findings.length === 0) {
      console.log(`PASS   ${gate.id}  ${gate.title}`);
    } else {
      failed++;
      console.log(`FAIL   ${gate.id}  ${gate.title}  (${findings.length})`);
      for (const f of findings.slice(0, 40)) console.log(`       ${f}`);
      if (findings.length > 40) console.log(`       ... and ${findings.length - 40} more`);
    }
  }

  console.log(
    `\n${selected.length - failed} of ${selected.length} gates pass.` +
      (failed ? ' A gate that fails is a corpus that is wrong, not a gate to relax.' : ''),
  );
  return failed ? 1 : 0;
}

process.exit(main());
