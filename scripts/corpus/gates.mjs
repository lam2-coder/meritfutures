#!/usr/bin/env node
// =============================================================================
// scripts/corpus/gates.mjs
// =============================================================================
// The corpus-integrity gates of STRATEGY section 4.4, as a runnable check.
//
//   node scripts/corpus/gates.mjs check            run every gate
//   node scripts/corpus/gates.mjs check CI-06i     run one gate
//   node scripts/corpus/gates.mjs list             list the gates
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
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/ /g, '-');
}

function headingSlugs(body) {
  const out = new Set();
  for (const line of body.split('\n')) {
    const m = /^#{1,6}\s+(.*?)\s*$/.exec(line);
    if (m) out.add(slug(m[1]));
  }
  return out;
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
  covers: 'status, depends_on and last_updated on every .md under docs/ and packages/.',
  run() {
    const valid = new Set(['draft', 'review', 'approved', 'frozen']);
    const findings = [];
    for (const file of markdownFiles()) {
      if (!/^(docs|packages)\//.test(file)) continue;
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
    for (const file of markdownFiles()) {
      if (!/^docs\//.test(file)) continue;
      if (file === 'docs/INDEX.md') continue;
      if (/^docs\/reviews\//.test(file)) continue; // verdicts are overwritten artifacts
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
    'its registry, counting DISTINCT IDENTIFIERS rather than table rows.',
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
    // to be absent from this file, because a sibling branch holds it.
    const alloc = new Set();
    const tableStart = body.indexOf('## Number allocation');
    const tableEnd = body.indexOf('\n---', tableStart);
    for (const m of body.slice(tableStart, tableEnd).matchAll(/\b(\d{3})\b(?:\s*to\s*(\d{3}))?/g)) {
      const from = Number(m[1]);
      const to = m[2] ? Number(m[2]) : from;
      for (let n = from; n <= to; n++) alloc.add(n);
    }
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
};

// Keys STRATEGY names as derivable that this runner deliberately does not
// implement, each with the reason, so a span using one fails loudly with the
// reason rather than silently having no query.
const SPAN_DEFERRED = {
  indexes: 'needs a live apply; a reading of the .sql cannot count what Postgres builds',
  check_constraints: 'needs a live apply',
  triggers: 'needs a live apply',
  delta_count: 'needs the manifest disposition tables parsed, and that query is not yet ruled',
  index_entries: 'needs a ruled definition of what counts as an INDEX entry',
};

// Spans inside a fenced code block are DOCUMENTATION OF THE FORM, not spans.
// STRATEGY's own CI-06g section shows `<!--gen:adr_count-->25<!--/gen-->` in a
// fence as the worked example; regenerating it would rewrite the explanation of
// the mechanism to match the mechanism.
function spansIn(body) {
  const masked = body.replace(/^```[\s\S]*?^```/gm, (block) => block.replace(/</g, ' '));
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
// Runner
// -----------------------------------------------------------------------------
const GATES = [ci06a, ci06b, ci06c, ci06d, ci06e, ci06f, ci06g, ci06i];

function main() {
  const [cmd, only] = process.argv.slice(2);

  if (cmd === 'list') {
    for (const g of GATES) console.log(`${g.id}  ${g.title}\n      covers: ${g.covers}\n`);
    return 0;
  }
  if (cmd === 'generate') return generate();
  if (cmd !== 'check') {
    console.error('usage: node scripts/corpus/gates.mjs check [GATE-ID] | generate | list');
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
