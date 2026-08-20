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
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  !/^docs\/reviews\//.test(file) && // verdicts are overwritten artifacts
  !isRegistryEntry(file);

// -----------------------------------------------------------------------------
// The registries, and what an ENTRY is (ADR-043)
// -----------------------------------------------------------------------------
// A registry is a directory of entry files plus a README that indexes them. An
// ENTRY IS A FRAGMENT, NOT A DOCUMENT: it carries no frontmatter and gets no
// INDEX.md row, because splitting four registries per entry would take the corpus
// from 72 documents to roughly 340 and INDEX from 85 rows to about 400, which
// destroys the one artifact whose entire value is being readable.
//
// THAT EXEMPTION IS PAID FOR RATHER THAN TAKEN, and CI-06n is the payment.
// CI-06c's guarantee is "if a thing is not in INDEX.md, it does not exist", and
// exempting 340 files from it with nothing in its place is weakening a gate to
// pass it. CI-06n asserts, in both directions, that every entry has a row in its
// registry README and every README row resolves. The guarantee becomes transitive
// rather than lost: INDEX carries the README, the README carries the entry.
//
// THE README IS NOT AN ENTRY. It is an ordinary corpus document, checked by
// CI-06b and required in INDEX by CI-06c, which is what anchors the chain.
const REGISTRIES = [
  {
    id: 'decisions',
    dir: 'docs/decisions',
    readme: 'docs/decisions/README.md',
    // ALLOCATION.md is a corpus document, not an entry: three tables read AS
    // TABLES by CI-06f and CI-06h. Excluded here so CI-06b still checks it.
    entry: (f) => /^docs\/decisions\/(ADR-(?:\d{3}|D\d+)\.md|gates\/[^/]+\.md)$/.test(f),
  },
  {
    id: 'edge-cases',
    dir: 'docs/edge-cases',
    readme: 'docs/edge-cases/README.md',
    // The battery file is an entry too: one file holding 22 identifiers, per
    // ADR-043's ruling that a table row is not a document.
    entry: (f) => /^docs\/edge-cases\/EC-\d{3}(-to-\d{3}-appendix-b4-battery)?\.md$/.test(f),
  },
  {
    id: 'data-model',
    dir: 'docs/architecture/data-model',
    readme: 'docs/architecture/data-model/README.md',
    // A table design record. README.md is the only other file in the directory
    // and it is a corpus document, so the predicate excludes it by shape rather
    // than by name: a record is `<snake_case>.md`.
    entry: (f) => /^docs\/architecture\/data-model\/[a-z][a-z0-9_]*\.md$/.test(f),
  },
  {
    id: 'sessions',
    dir: 'docs/sessions',
    readme: 'docs/sessions/README.md',
    entry: (f) => /^docs\/sessions\/\d{4}-\d{2}-\d{2}-session-\d{2}\.md$/.test(f),
  },
  {
    id: 'golden-scenarios',
    dir: 'docs/testing/golden-scenarios',
    readme: 'docs/testing/golden-scenarios/README.md',
    // Per SECTION, not per entry (ADR-043): 257 identifiers live as 301 table
    // rows, and a row is not a document.
    entry: (f) => /^docs\/testing\/golden-scenarios\/\d{2}-[a-z0-9-]+\.md$/.test(f),
  },
];

// -----------------------------------------------------------------------------
// The golden-scenario registry, read from the directory (ADR-043 stage 5)
// -----------------------------------------------------------------------------
// Same rule-2 guard as the other directory readers: a glob matching nothing
// returns an empty array rather than throwing, and CI-06d and CI-06e both derive
// their GS set from this, so an empty read would make every citation resolve
// against nothing and report a clean corpus.
function goldenBody() {
  const dir = 'docs/testing/golden-scenarios';
  if (!existsSync(join(ROOT, dir))) {
    throw new Error(`${dir} does not exist; the golden-scenario registry has moved or is gone`);
  }
  const files = readdirSync(join(ROOT, dir))
    .filter((f) => /^\d{2}-.*\.md$/.test(f))
    .sort()
    .map((f) => join(dir, f));
  if (files.length === 0) throw new Error(`no GS section files in ${dir}; the gate cannot run`);
  return files.map((f) => read(f)).join('\n');
}

// -----------------------------------------------------------------------------
// The edge-case registry, read from the directory (ADR-043 stage 2)
// -----------------------------------------------------------------------------
// Same rule-2 problem as adrFiles: the input is a glob, and a glob that matches
// nothing returns an empty array rather than throwing, so the emptiness check is
// the whole of "a gate that cannot run is not a gate that passed" here.
//
// It returns the concatenated BODY rather than a list of identifiers, because
// CI-06d and CI-06e each parse it differently: one wants definitions, the other
// wants the two entry FORMS and their golden-scenario fields. Handing both the
// same text keeps one reader rather than two that agree until they do not.
function edgeCaseBody() {
  const dir = 'docs/edge-cases';
  if (!existsSync(join(ROOT, dir))) {
    throw new Error(`${dir} does not exist; the edge-case registry has moved or is gone`);
  }
  const files = readdirSync(join(ROOT, dir))
    .filter((f) => /^EC-\d{3}.*\.md$/.test(f))
    .sort()
    .map((f) => join(dir, f));
  if (files.length === 0) throw new Error(`no EC entry files in ${dir}; the gate cannot run`);
  return files.map((f) => read(f)).join('\n');
}

const isRegistryEntry = (file) => REGISTRIES.some((r) => r.entry(file));

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
// ADR-043 moved these from docs/DECISIONS.md to docs/decisions/ALLOCATION.md.
// The three tables stayed in ONE file precisely because this parser reads them as
// tables; a table split into a file per row is not a table.
const ALLOCATION_DOC = 'docs/decisions/ALLOCATION.md';
const ADR_ALLOCATION = '## Number allocation';
const MIGRATION_ALLOCATION = '## Migration number allocation';

// -----------------------------------------------------------------------------
// The ADR registry, read from the directory (ADR-043)
// -----------------------------------------------------------------------------
// THE FAILURE MODE THIS SHAPE EXISTS TO PREVENT: a gate whose input path no
// longer exists finds nothing and PASSES. Before the split, `read('docs/
// DECISIONS.md')` threw ENOENT and the runner reported ERROR, which is rule 2
// working. After the split the input is a GLOB, and a glob that matches nothing
// returns an empty array rather than throwing. So the emptiness check is not
// decoration: it is the whole of rule 2 on a directory-shaped input, and every
// reader below is written to go through this one function.
function adrFiles() {
  const dir = 'docs/decisions';
  if (!existsSync(join(ROOT, dir))) {
    throw new Error(`${dir} does not exist; the ADR registry has moved or is gone`);
  }
  const files = readdirSync(join(ROOT, dir))
    .filter((f) => /^ADR-(?:\d{3}|D\d+)\.md$/.test(f))
    .sort()
    .map((f) => join(dir, f));
  if (files.length === 0) {
    throw new Error(`no ADR entry files in ${dir}; the gate cannot run`);
  }
  return files;
}

// The heading inside an entry file is still the definition, so the ADR-nnn form
// is read from the TEXT rather than trusted from the filename. A file named
// ADR-041.md whose heading says ADR-014 is a real defect and this is what sees it.
function adrEntries() {
  const out = [];
  for (const file of adrFiles()) {
    // GLOBAL, AND THAT IS THE WHOLE OF A DEFECT THIS FILE CARRIED FOR THIRTY
    // ENTRIES. It was `/^## ADR-(\d{3}|D\d+):/m.exec(...)`, a NON-GLOBAL exec
    // returning the FIRST heading and nothing else, so a file with two headings
    // produced one entry.
    //
    // CI-06f has always carried `if (seen.has(n)) findings.push("... appears
    // more than once")`. IT COULD NEVER FIRE: two headings in one file gave one
    // entry and `seen` never collided. `docs/decisions/ADR-046.md` carried two
    // `## ADR-046` headings for two unrelated rulings and fifteen gates passed
    // over it.
    //
    // The assertion did not need writing. The parser needed to be capable of
    // reaching it, which is a different repair and a smaller one, and it is why
    // `CI-06f/duplicate-heading` in falsify.mjs was written and watched NOT
    // firing before this line changed.
    const ms = [...read(file).matchAll(/^## ADR-(\d{3}|D\d+):/gm)];
    if (ms.length === 0) {
      out.push({ file, id: null });
      continue;
    }
    for (const m of ms) {
      out.push({ file, id: m[1], expected: `docs/decisions/ADR-${m[1]}.md` });
    }
  }
  return out;
}

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
    'its registry, counting DISTINCT IDENTIFIERS rather than table rows; that ' +
    'each registry runs 1..n with no holes and no duplicates; AND that the golden ' +
    'ownership partition in section 33.1 covers every GS-nnn EXACTLY ONCE, in both ' +
    "directions, with each owner's declared count agreeing with its own cell. " +
    'It does NOT judge whether an owner is the RIGHT one, which is a reading and ' +
    'not a parse.',
  run() {
    const findings = [];
    const gsBody = goldenBody();
    const ecBody = edgeCaseBody();
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

    // THE OWNERSHIP PARTITION, ASSERTED IN BOTH DIRECTIONS.
    //
    // Section 33.1 calls itself a partition and says so in its own first
    // sentence: "the counts sum to the registry total rather than to something
    // larger. That is the property that makes the table checkable."
    //
    // IT WAS NOT CHECKABLE, IT WAS MERELY CHECKED-SOUNDING. The same paragraph
    // claimed the sum agreed with the registry "or the build fails", and NO
    // CHECK EXISTED. So when FOLD-01 and FOLD-02 added GS-258 to GS-284, the
    // table went on summing to 257 and TWENTY-SEVEN SCENARIOS WERE OWNED BY
    // NOBODY, while the document kept describing itself as a partition. The
    // claim survived being false for exactly as long as nobody added up a
    // column by hand.
    //
    // A coverage figure nobody can add up is a coverage figure nobody should
    // quote, and P2's done-condition quotes this one: it owes M1's owned set
    // rather than the registry total, so an unowned scenario is a scenario no
    // phase has promised to make green.
    //
    // Both directions, because a partition fails in two ways and only one of
    // them is visible from the registry: a scenario owned by nobody, and a
    // scenario owned twice. The second is the one that inflates a coverage
    // claim while every individual row still looks right.
    const OWNERSHIP =
      'docs/testing/golden-scenarios/33-ownership-index-and-coverage-reconciliation.md';
    if (!existsSync(join(ROOT, OWNERSHIP))) {
      throw new Error(`${OWNERSHIP} does not exist; the ownership partition cannot be checked`);
    }
    const ownedBy = new Map();
    const dupes = [];
    // Bounded to 33.1. Unbounded, this reads 33.2's co-ownership table, whose
    // whole purpose is to name a scenario a SECOND time, and every row there
    // would be reported as a duplicate.
    const ownBody = read(OWNERSHIP).split('### 33.2')[0];
    let ownerRows = 0;
    for (const line of ownBody.split('\n')) {
      const m = /^\|\s*\*\*(.+?)\*\*\s*\|\s*(.+?)\s*\|\s*(\d+)\s*\|$/.exec(line.trim());
      if (!m) continue;
      ownerRows++;
      const [, owner, ranges, declared] = m;
      const ids = [];
      for (const part of ranges.split(',')) {
        const t = part.trim();
        const range = /^GS-(\d{3})\s+to\s+GS-(\d{3})$/.exec(t);
        const one = /^GS-(\d{3})$/.exec(t);
        if (range) for (let n = Number(range[1]); n <= Number(range[2]); n++) ids.push(n);
        else if (one) ids.push(Number(one[1]));
        else
          findings.push(
            `${OWNERSHIP}: ${owner}'s cell holds "${t}", which is not a GS-nnn or a range`,
          );
      }
      // The declared count is the second independent statement of one number,
      // and it is what catches a range edited at one end only.
      if (ids.length !== Number(declared)) {
        findings.push(
          `${OWNERSHIP}: ${owner} declares ${declared} against ${ids.length} scenarios in its own cell`,
        );
      }
      for (const n of ids) {
        const id = `GS-${String(n).padStart(3, '0')}`;
        if (ownedBy.has(id)) dupes.push(`${id}: owned by both ${ownedBy.get(id)} and ${owner}`);
        else ownedBy.set(id, owner);
      }
    }
    // Rule 2 on a derived input: a parser that stopped matching would report a
    // corpus in which nobody owns anything as fully partitioned.
    if (ownerRows === 0) {
      throw new Error(
        `${OWNERSHIP}: section 33.1 parsed to zero owner rows; the partition is asserting nothing`,
      );
    }
    findings.push(...dupes);
    for (const id of gs) {
      if (!ownedBy.has(id))
        findings.push(`${OWNERSHIP}: ${id} is in the registry and owned by nobody`);
    }
    for (const id of ownedBy.keys()) {
      if (!gs.has(id))
        findings.push(
          `${OWNERSHIP}: ${id} is owned by ${ownedBy.get(id)} and is not in the registry`,
        );
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
  covers: "TR-04's second half. An edge case with no fixture is a decision nobody can test.",
  run() {
    const findings = [];
    const ecBody = edgeCaseBody();
    const gs = new Set([...goldenBody().matchAll(/^[|#\s]*\**\s*(GS-\d{3})\b/gm)].map((m) => m[1]));
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
      for (const g of cited)
        if (!gs.has(g)) findings.push(`${id}: cites ${g}, which does not exist`);
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
    'uniqueness and gaplessness across the docs/decisions/ entry files, against the ' +
    'allocation table, plus that each entry file is named for the ADR its heading declares. ' +
    'The cross-branch half (a PR may not claim a number already on main) belongs ' +
    'to the CI job, which can see both refs; this run cannot.',
  run() {
    const findings = [];
    const seen = new Set();
    // ADDED AT THE SPLIT (ADR-043): the filename must agree with the heading.
    // Before the move, "which ADR is this" had one answer because there was one
    // file. Now there are two answers and they can disagree, so a file whose name
    // and heading differ is a new defect class that arrived WITH the directory.
    for (const { file, id, expected } of adrEntries()) {
      if (id === null) {
        findings.push(`${file}: no "## ADR-nnn:" heading; it is not a readable entry`);
        continue;
      }
      if (file !== expected)
        findings.push(`${file}: heading says ADR-${id}, so it belongs at ${expected}`);
      if (/^D/.test(id)) continue; // outside the numbered sequence, by name
      const n = Number(id);
      if (seen.has(n)) findings.push(`ADR-${id} appears more than once`);
      seen.add(n);
    }
    if (seen.size === 0) throw new Error('no numbered ADR entries found; the gate cannot run');
    // The allocation table is the reserved set: any number it names is allowed
    // to be absent, because a sibling branch holds it. Shared with CI-06h since
    // ADR-036; see `allocated` for why it is one function.
    const alloc = allocated(read(ALLOCATION_DOC), ADR_ALLOCATION);
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
  // DISTINCT NUMBERED IDENTIFIERS, read from the entry headings rather than by
  // counting files (ADR-043). Counting files would count ADR-D1, which is outside
  // the numbered sequence, and would count a stray file with no heading.
  adr_count: () =>
    new Set(
      adrEntries()
        .map((e) => e.id)
        .filter((id) => id && !/^D/.test(id)),
    ).size,
  // DISTINCT IDENTIFIERS, not headings. EC-012 to EC-033 are the Appendix B4
  // battery and live as TABLE ROWS under one heading, so counting `## EC-nnn`
  // gives 119 against the registry's 140. This is the exact trap STRATEGY names
  // when it says counting rows gives 22 and counting identifiers gives 140.
  ec_count: () => new Set([...edgeCaseBody().matchAll(/\b(EC-\d{3})\b/g)].map((m) => m[1])).size,
  gs_count: () => new Set([...goldenBody().matchAll(/\b(GS-\d{3})\b/g)].map((m) => m[1])).size,
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

  // HOW MANY CHECKS THIS RUNNER RUNS, which STRATEGY 4.4 stated by hand and got
  // wrong. It read "All ten of the gates above, plus ADR-026's ... eleven checks"
  // against eleven gate rows plus ADR-026, which is twelve, and it had been wrong
  // since CI-06n was added. A count of the gates, written beside the gates, is the
  // one place that cannot drift from them. Reads GATES rather than counting
  // STRATEGY's table rows, because the runner is the artifact and the table is the
  // description of it.
  gate_count: () => GATES.length,

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

const sqlMatchCount = (re) => sqlFiles().reduce((n, f) => n + (read(f).match(re) || []).length, 0);

// Spans inside a fenced code block are DOCUMENTATION OF THE FORM, not spans.
// STRATEGY's own CI-06g section shows `<!--gen:adr_count-->25<!--/gen-->` in a
// fence as the worked example; regenerating it would rewrite the explanation of
// the mechanism to match the mechanism.
//
// THE NAME CLASS CARRIES DIGITS, AND IT DID NOT UNTIL 2026-08-16. It was
// `[a-z_]+`, so `<!--gen:e2_files-->` matched NOTHING: the only span in the
// corpus with a digit in its name was invisible to both halves of CI-06g, the
// gate passed while the number was wrong, and `generate` had nothing to rewrite.
// INDEX.md said 18 files carry an `E2 READ: MONEY PATH` header against 19 on
// disk, in the same sentence that says "all three are generated spans now".
// Found when 0032 became the nineteenth. A span that cannot be parsed is worse
// than a hand-maintained number, because it reads as checked.
function spansIn(body) {
  const masked = body.replace(/^```[\s\S]*?^```/gm, (block) => block.replace(/</g, '\0'));
  return [...masked.matchAll(/<!--gen:([a-z0-9_]+)-->(.*?)<!--\/gen-->/gs)];
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
  console.log(
    changed ? `\n${changed} span(s) rewritten.` : 'every span already matches its query.',
  );
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
      if (inSql.has(table))
        findings.push(`${table}: CREATE TABLE in both ${inSql.get(table)} and ${file}`);
      else inSql.set(table, file);
    }

    // ADR-043 stage 3: one file per design record. The heading is still what
    // defines the record, read from the file rather than trusted from the
    // filename, so a file whose name and heading disagree is visible here the way
    // CI-06f made it visible for ADRs.
    const dir = 'docs/architecture/data-model';
    if (!existsSync(join(ROOT, dir))) {
      throw new Error(`${dir} does not exist; the design records have moved or are gone`);
    }
    const recordFiles = readdirSync(join(ROOT, dir))
      .filter((f) => /^[a-z][a-z0-9_]*\.md$/.test(f))
      .sort();
    if (recordFiles.length === 0)
      throw new Error(`no design records in ${dir}; the gate cannot run`);
    const sections = [];
    for (const f of recordFiles) {
      const m = /^### ([a-z][a-z0-9_]*)\s*$/m.exec(read(join(dir, f)));
      if (!m) {
        findings.push(
          `${dir}/${f}: no \`### <table>\` heading; it is not a readable design record`,
        );
        continue;
      }
      if (`${m[1]}.md` !== f)
        findings.push(`${dir}/${f}: heading says ${m[1]}, so it belongs at ${m[1]}.md`);
      sections.push(m[1]);
    }
    const inDoc = new Set();
    for (const name of sections) {
      if (inDoc.has(name)) findings.push(`${name}: has more than one \`### ${name}\` section`);
      inDoc.add(name);
    }

    for (const [table, file] of inSql) {
      if (!inDoc.has(table))
        findings.push(`${table} (${file}): created by a migration, no design record`);
    }
    for (const name of inDoc) {
      if (!inSql.has(name))
        findings.push(`${name}: has a design record, no CREATE TABLE creates it`);
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
    'ON_ERROR_STOP apply, the must-fail re-apply, the database-derived counts, ' +
    'the whole-schema NO-FLOATS assertion and every probe pinned in the ' +
    "required-needle list below. THAT LIST IS THE COUNT: this line read 'all " +
    "five database probes' while the list held six, which is a hand-maintained " +
    'number in the gate file that exists to end hand-maintained numbers. ' +
    'TWO THINGS IT DOES NOT DO. The install itself needs a live PostgreSQL and ' +
    'runs in CI, so a green result here is NOT a claim that the set installs. And ' +
    'the cross-branch half, that a pull request may not claim a number already on ' +
    'main, needs a job that can see both refs; this run sees one, exactly as ' +
    "CI-06f's does. The table has no State column to parse: it claimed a merge " +
    "state no single ref can see, it was wrong eleven times, and ADR-034's " +
    'remedy deleted it. The half that IS derivable is derived, here and by the ' +
    '`allocation` subcommand.',
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
    const alloc = allocated(read(ALLOCATION_DOC), MIGRATION_ALLOCATION);
    const max = Math.max(...seen.keys(), ...alloc);
    for (let n = 1; n <= max; n++) {
      if (!seen.has(n) && !alloc.has(n)) {
        findings.push(
          `${pad(n)} is neither on disk nor reserved (a hole in the migration sequence)`,
        );
      }
    }
    for (const [n, f] of [...seen].sort((a, b) => a[0] - b[0])) {
      if (!alloc.has(n)) {
        findings.push(
          `${f}: ${pad(n)} is not claimed by the migration allocation table in ` +
            `${ALLOCATION_DOC}. Claim the number there before writing the file (ADR-036)`,
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
      // OI-07 CLOSES BY BEING PINNED HERE, NOT BY THE FILE EXISTING. A probe
      // that ships beside a fix and never runs again is the same object as the
      // golden test that was missing, and an unpinned step is one delete away
      // from exactly that. probe_payout_hold.sql was wired into the workflow on
      // 2026-08-16 and never added to this list, so it has been deletable
      // without a gate noticing since the day it landed; it is pinned now for
      // the same reason as the other two.
      [
        'probe_payout_hold.sql',
        "ADR-040 and ADR-041's payout hold and restriction probe is no longer run",
      ],
      [
        'probe_phone_identity.sql',
        "ADR-039's phone identity and auth probe is no longer run (OI-07)",
      ],
      // OI-06. ADR-045's guards are the only thing that makes ADR-042 F-2's
      // prior image obligatory, and they are DEFERRED constraint triggers, so
      // the probe that proves they fire is the only place the deferred check is
      // ever forced. Arriving pinned rather than being pinned later: the probe
      // step above went unpinned from the day it landed, which is the failure
      // this list exists to end and it was found one file over.
      [
        'probe_calendar_revision_required.sql',
        "ADR-045's calendar prior-image guards are no longer probed (OI-06)",
      ],
      // EC-157. PINNED IN THE SAME COMMIT THAT WIRES IT, which is the first
      // time that has happened in this list. Every earlier entry records the
      // opposite: probe_payout_hold.sql, probe_calendar_revision_required.sql
      // and probe_reversible_contact_addresses.sql were each wired and left
      // unpinned, three instances of OI-07, and the third was caught only
      // because somebody went looking one file over.
      //
      // The reason this one matters as much as any: it is the only probe here
      // whose failure mode is a constraint REFUSING a legitimate row. Delete it
      // and the whole of EC-157 reverts to being a paragraph, because nothing
      // else in the job would notice a migration putting the adjustment back
      // into the closing identity.
      [
        'probe_daily_marks_identities.sql',
        "EC-157's mark identities are no longer probed; nothing would catch the " +
          'adjustment returning to the closing identity (Repair A, 0036)',
      ],
      // OQ-M10-06. AND THIS IS OI-07 A THIRD TIME, CAUGHT BEFORE THE MERGE
      // RATHER THAN A DAY AFTER IT. probe_reversible_contact_addresses.sql was
      // wired into corpus.yml in the commit that created it and NOT added to
      // this list, which is the identical omission probe_payout_hold.sql made
      // above and which left that file one `git rm` from being OI-07 again for
      // a day. Wiring a probe and pinning it are two edits in two files and the
      // second one is the one that makes the first one permanent.
      //
      // It carries the only assertions in this job that watch a GRANT, and the
      // only ones that watch INV-M10-12: 0034's octet_length floor is what
      // stops a plaintext telephone number being written into a bytea column
      // that every reader will believe holds ciphertext.
      [
        'probe_reversible_contact_addresses.sql',
        "ADR-046's sealed addresses, plaintext floor and dispatcher grants are " +
          'no longer probed (OQ-M10-06)',
      ],
      // OQ-P2-02. Pinned in the commit that wires it, which is now the rule
      // rather than the exception: probe_payout_hold.sql and
      // probe_reversible_contact_addresses.sql were each wired and left
      // unpinned, and DELTA_MANIFEST section 18 records that three occurrences
      // is a pattern rather than three accidents.
      //
      // IT IS THE ONLY PROBE HERE WHOSE SUCCESS CASES OUTNUMBER ITS REJECTIONS,
      // and that is a property of what 0035 installs rather than a style. The
      // dangerous edit to a nullable column is a TIGHTENING, and a tightening
      // is invisible to an inventory of refusals: NOT NULL on
      // calendar_revision_id passes all four rejections below and refuses every
      // state row the engine writes until the calendar has been corrected once.
      // Deleting this step deletes the only assertion that ADR-047's column is
      // still permissive in the two directions the ruling requires.
      [
        'probe_rule_states_calendar_revision.sql',
        "ADR-047's calendar watermark on rule_states is no longer probed, so " +
          'nothing asserts the column stays nullable, stays permissive of an ' +
          'older watermark, or stays out of the state_hash contract (OQ-P2-02)',
      ],
      // OI-08. The NO-FLOATS assertion lived inside 0027 and could only ever
      // see 0001-0027, so five migrations sat outside the guard the corpus
      // believed protected every money column. It runs in the install job now,
      // where it is positionally last by construction; unpinned, it could be
      // moved back to a position that reads a prefix of the schema.
      [
        'assert_no_floats.sql',
        'the NO-FLOATS assertion no longer runs over the whole applied schema (OI-08)',
      ],
      // OI-07's FOURTH OCCURRENCE, and it was live on main until CI-06s found
      // it. The probe was written and wired in the same session and this line
      // was not, which is the identical omission probe_payout_hold.sql made and
      // probe_reversible_contact_addresses.sql repeated: wiring a probe and
      // pinning it are two edits in two files, and the second is the one that
      // gets forgotten because the first one makes the tests pass.
      //
      // ADDED BY THE SESSION THAT WROTE CI-06s, which is why the gate could be
      // watched failing on a real violation before its own seeds existed. A
      // gate that fails on arrival is a gate somebody switches off.
      [
        'probe_rule_states_high_water_bound.sql',
        "ADR-053's scoped high-water bound is no longer probed, so nothing " +
          'asserts that a locked account may make a new closing high, that the ' +
          'unlocked half still refuses, or that the three NOT NULLs the ' +
          'predicate depends on and does not name are still there (OI-07)',
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
  for (let i = 0; i < sql.length;) {
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
    'constraint',
    'primary',
    'unique',
    'check',
    'foreign',
    'exclude',
    'like',
    'partition',
  ]);
  for (const file of sqlFiles()) {
    const sql = stripSqlComments(read(file));
    for (const m of sql.matchAll(
      /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s*\(/gi,
    )) {
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
    // A MULTI-COLUMN `ALTER TABLE` DECLARED ONE COLUMN TO THIS PARSER UNTIL
    // 2026-08-16, and CI-06l is what found it on its first run.
    //
    // The expression here required ADD COLUMN to follow the table name
    // immediately, so `ALTER TABLE payout_requests ADD COLUMN a, ADD COLUMN b,
    // ADD COLUMN c` contributed `a` and nothing else. 0031 adds five hold
    // columns in one statement and FOUR OF THEM WERE INVISIBLE, including
    // `hold_expires_at`, which is the clock ADR-040's whole enforcement window
    // rests on.
    //
    // IT FAILS IN THE SAFE DIRECTION AND THAT IS WHY IT SURVIVED. A column
    // missing from this catalogue makes CI-06j report a live trigger reference
    // as a phantom, which is a false finding somebody investigates, not a false
    // pass nobody sees. No trigger has named one of the four yet, so nothing
    // fired. It would have fired on the first guard written over the hold.
    // Widening a catalogue can only ever remove CI-06j findings, never add one.
    for (const m of sql.matchAll(/\bALTER\s+TABLE\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)/gi)) {
      const table = m[1].toLowerCase();
      // The statement runs to the first `;` at paren depth zero. A CHECK body
      // holds parentheses and never a statement terminator, so depth is enough.
      let depth = 0;
      let i = m.index + m[0].length;
      for (; i < sql.length; i++) {
        if (sql[i] === '(') depth++;
        else if (sql[i] === ')') depth--;
        else if (sql[i] === ';' && depth === 0) break;
      }
      for (const c of sql
        .slice(m.index + m[0].length, i)
        .matchAll(/\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)) {
        add(table, c[1].toLowerCase());
      }
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
      const refs = new Set(
        [...body.matchAll(/\b(?:NEW|OLD)\.([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase()),
      );
      if (tables.size === 0) {
        if (refs.size)
          findings.push(
            `${name} (${file}): reads NEW./OLD. and no CREATE TRIGGER attaches it to a table`,
          );
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
      for (const m of read(file).matchAll(/\b((?:SD|U)-(?:\d{2}|M\d{1,2}-\d{2}))\b/g))
        cited.add(m[1]);
    }
    for (const id of [...cited].sort()) {
      if (!rows.has(id)) findings.push(`${id}: cited in docs/ but has no DELTA_MANIFEST row`);
    }
    return findings;
  },
};

// -----------------------------------------------------------------------------
// CI-06k  DECLARED AUTHORITY
// -----------------------------------------------------------------------------
// ADR-039 amendment 4 (C-27) and amendment 2, made checkable from the tree.
//
// C-27 is enforced "by a server-side required-factor declaration per endpoint,
// not by discipline". A declaration nothing reads is discipline with extra
// steps, so this gate reads it. Three assertions, no database:
//
//   1. Every row of API_CONTRACT section 12's matrix carries a required-factor
//      cell. This is the one that catches a SENSITIVE ENDPOINT ADDED LATER: the
//      author who adds a row has to answer the question, and an empty cell is a
//      finding rather than an omission nobody sees.
//   2. Every sensitive action C-27 names -- payout destination change, contact
//      change, external withdrawal -- appears in that matrix and declares a
//      NON-SINGLE factor. `session` is the single-factor token, and a C-27 row
//      declaring it is the SIM-swap hole the invariant exists to close.
//   3. No notification_kinds class outside the post-identity security and money
//      classes is rate_limit_exempt. This is amendment 2: INV-M16-11 was
//      written for authenticated recipients, and applied to an attacker-supplied
//      number it funds SMS pumping (AS-M16-07).
//
// WHY ASSERTION 3 READS THE GENERATED EXPRESSION RATHER THAN COUNTING ROWS.
// `rate_limit_exempt` is GENERATED ALWAYS AS (class IN (...)) STORED, which is
// SD-M16-07 making the exemption unforgeable at the seed-row level. The only
// place the policy can change is that expression, so that is what is read. A
// gate reading seed rows would be checking the half the schema already makes
// impossible while ignoring the half a migration can still move.
//
// THE C-27 ACTION LIST IS HARDCODED HERE, and that is the one hand-maintained
// thing in this gate. It is three strings from a frozen invariant; if C-27 ever
// names a fourth, this list is where it goes, and the gate fails loudly on the
// missing row rather than silently passing a matrix that never grew.
const API_CONTRACT_DOC = 'docs/architecture/API_CONTRACT.md';
const NEGATIVE_AUTHZ_HEADING = '## 12. Negative-authz test matrix';

// C-27's own words, in C-27's order.
const C27_SENSITIVE_ACTIONS = [
  'payout destination change',
  'contact change',
  'external withdrawal',
];

// The closed vocabulary API_CONTRACT section 12 publishes. `session` is the
// single-factor token and is the whole point of the partition: any single factor
// establishes a session sufficient for every READ surface, and no single factor
// is sufficient for a sensitive action.
const SINGLE_FACTOR_TOKENS = new Set(['none', 'session']);
const ELEVATING_FACTOR_TOKENS = new Set(['passkey', 'dual_channel']);
const FACTOR_TOKENS = new Set([...SINGLE_FACTOR_TOKENS, ...ELEVATING_FACTOR_TOKENS, 'admin_sso']);

// Rows of the matrix, as [cells]. Bounded to its own section for the same reason
// falsify.mjs's addMigrationRow is: unbounded, this runs into section 13 and
// starts reading a table that answers a different question.
function negativeAuthzRows(body) {
  const start = body.indexOf(NEGATIVE_AUTHZ_HEADING);
  if (start === -1) {
    throw new Error(`negative-authz matrix not found: "${NEGATIVE_AUTHZ_HEADING}"`);
  }
  const after = body.slice(start + NEGATIVE_AUTHZ_HEADING.length);
  const end = after.search(/\n## /);
  const section = end === -1 ? after : after.slice(0, end);
  const rows = [];
  for (const line of section.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
    rows.push({ line: line.trim(), cells });
  }
  return rows;
}

// The factor tokens a cell declares, and nothing else.
//
// BACKTICKS ARE STRIPPED RATHER THAN MATCHED THROUGH, and the first version of
// this gate got that wrong in a way worth recording. It read /`([a-z_]+)`/, which
// requires each token to be its own code span. The document writes C-27's
// elevation as ONE span, `passkey or dual_channel`, because that is how it reads
// to a human; the pattern matched nothing inside it and the gate reported every
// sensitive row as carrying no declaration. The corpus was right and the gate was
// wrong, which is CI-06a's 109 phantom anchors in a new place, so the tokens are
// now matched as words against the closed vocabulary.
const factorTokensIn = (cell) => {
  const bare = cell.replace(/`/g, '');
  return [...new Set([...bare.matchAll(/\b([a-z_]+)\b/g)].map((m) => m[1]))].filter((t) =>
    FACTOR_TOKENS.has(t),
  );
};

const ci06k = {
  id: 'CI-06k',
  title:
    'Declared authority: every endpoint declares a factor, and no sensitive action accepts a single one',
  covers:
    'ADR-039 amendment 4 (C-27) and amendment 2, from the tree with no database. ' +
    'Every row of API_CONTRACT section 12 carries a required-factor cell drawn from ' +
    'the published vocabulary; every sensitive action C-27 names appears there and ' +
    'declares a non-single factor; and notification_kinds.rate_limit_exempt is ' +
    'generated over the post-identity security and money classes only. ' +
    'THREE THINGS IT DOES NOT DO. It does not check that a HANDLER honours the ' +
    'declaration, which needs the running server and is the negative-authz suite ' +
    "itself. It does not know which endpoints are sensitive beyond C-27's three " +
    'named actions, so an endpoint nobody classified is invisible to assertion 2. ' +
    'And it reads the generated expression rather than seed rows, because the ' +
    'generated column is what makes a seed row unable to lie.',
  run() {
    const findings = [];

    // --- assertions 1 and 2: the required-factor column ----------------------
    const rows = negativeAuthzRows(read(API_CONTRACT_DOC));
    if (rows.length === 0) {
      throw new Error('negative-authz matrix parsed to zero rows; the gate cannot run');
    }
    // The header names the column, so the position is read rather than assumed.
    // A matrix whose columns are reordered still checks the right cell, and a
    // matrix that LOST the column reports that instead of checking cell 1 of
    // something else.
    const headerAt = rows.findIndex((r) => /required.factor/i.test(r.cells.join('|')));
    if (headerAt === -1) {
      throw new Error(
        `no "Required factor" column in ${API_CONTRACT_DOC} section 12; ` +
          'CI-06k is asserting nothing about the matrix',
      );
    }
    const header = rows[headerAt];
    const col = header.cells.findIndex((c) => /required.factor/i.test(c));
    const testCol = col === 0 ? 1 : 0;
    const seenActions = new Map();
    let checked = 0;
    // ONLY THE ROWS BELOW THE HEADER. The section also carries the vocabulary
    // legend, a two-column table ABOVE the matrix, and reading the whole section
    // as one table reported every legend row as an endpoint with no declaration.
    // The matrix is the table the header opens; anything above it answers a
    // different question.
    for (const { cells } of rows.slice(headerAt + 1)) {
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue; // the |---|---| separator
      if (cells.length <= col) continue;
      checked++;
      const cell = cells[col];
      const test = cells[testCol] ?? '(unnamed row)';
      const tokens = factorTokensIn(cell);
      if (tokens.length === 0) {
        findings.push(
          `${API_CONTRACT_DOC} section 12: "${test.slice(0, 60)}" carries no required-factor ` +
            `cell drawn from the published vocabulary (cell reads "${cell.slice(0, 40)}")`,
        );
        continue;
      }
      // A `C-27:` tag is what makes a row a sensitive action rather than a row
      // that happens to mention one. Reading the prose instead would classify
      // the elevation endpoint's own row, which is not a sensitive action.
      const tagged = /C-27:\s*([^)|]+)/.exec(cell);
      if (!tagged) continue;
      const action = tagged[1].trim().toLowerCase();
      if (!C27_SENSITIVE_ACTIONS.includes(action)) {
        findings.push(
          `${API_CONTRACT_DOC} section 12: "${test.slice(0, 60)}" tags C-27 action ` +
            `"${action}", which C-27 does not name (it names ${C27_SENSITIVE_ACTIONS.join(', ')})`,
        );
        continue;
      }
      seenActions.set(action, (seenActions.get(action) ?? 0) + 1);
      const single = tokens.filter((t) => SINGLE_FACTOR_TOKENS.has(t));
      const elevating = tokens.filter((t) => ELEVATING_FACTOR_TOKENS.has(t));
      if (single.length || elevating.length === 0) {
        findings.push(
          `${API_CONTRACT_DOC} section 12: "${test.slice(0, 60)}" is the C-27 sensitive action ` +
            `"${action}" and declares ${tokens.map((t) => `\`${t}\``).join(', ')}, which is a ` +
            'single factor. C-27 requires a passkey assertion or a dual-channel confirmation, ' +
            'and specifically never SMS alone',
        );
      }
    }
    if (checked === 0) {
      throw new Error('negative-authz matrix has a header and no data rows; the gate cannot run');
    }
    for (const action of C27_SENSITIVE_ACTIONS) {
      if (!seenActions.has(action)) {
        findings.push(
          `${API_CONTRACT_DOC} section 12: C-27 names "${action}" as a sensitive action and no ` +
            'row of the matrix declares a required factor for it',
        );
      }
    }

    // --- assertion 3: the rate-limit exemption, from the DDL -----------------
    // Rule 2 of this file. The column is created by a migration; if no migration
    // creates it, this gate has lost its input and says so rather than passing.
    let expr = null;
    for (const file of sqlFiles()) {
      const m =
        /ADD\s+COLUMN\s+rate_limit_exempt\s+boolean\s+GENERATED\s+ALWAYS\s+AS\s*\(([\s\S]*?)\)\s*STORED/i.exec(
          stripSqlComments(read(file)),
        );
      if (m) expr = { file, text: m[1] };
    }
    if (expr === null) {
      throw new Error(
        'no generated notification_kinds.rate_limit_exempt column found in the migrations; ' +
          "CI-06k's third assertion cannot run",
      );
    }
    const exempted = [...expr.text.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    if (exempted.length === 0) {
      throw new Error(
        `rate_limit_exempt is generated from "${expr.text.trim()}", which names no class; ` +
          'the gate cannot tell what is exempt',
      );
    }
    // THE POST-IDENTITY CLASSES, and they are exactly INV-M16-11's two. Anything
    // else in this expression is a pre-identity or lower class inheriting an
    // exemption written for authenticated recipients.
    const POST_IDENTITY_EXEMPT = new Set(['security', 'money']);
    for (const cls of exempted) {
      if (!POST_IDENTITY_EXEMPT.has(cls)) {
        findings.push(
          `${expr.file}: notification_kinds.rate_limit_exempt is generated over "${cls}", which ` +
            'is outside the post-identity security and money classes. INV-M16-11 was written for ' +
            'authenticated recipients at an address Merit already holds; applied to an ' +
            'attacker-supplied destination the exemption funds SMS pumping (ADR-039 amendment 2)',
        );
      }
    }
    return findings;
  },
};

// -----------------------------------------------------------------------------
// CI-06l  EVERY EXPIRY HAS A SWEEP
// -----------------------------------------------------------------------------
// ADR-040, made checkable from the tree. No database.
//
// THE FAILURE IT EXISTS FOR. A clock in the schema with nothing scheduled to
// reach it is a hold that becomes indefinite in silence. The column is there,
// the index is there, the CHECK that made the clock mandatory is there, and
// every one of those reads as a control. A bounded hold with no releaser is a
// denial nobody had to authorize, and IT FAILS NO TEST, because there is no
// test a schema can fail by omission. ADR-040 made the auto-release the
// load-bearing control of the whole enforcement window; this is the part of
// that control a reading can check.
//
// Each `*_expires_at` column the migrations declare either names a release job
// in CRON_INVENTORY's coverage table, or appears on that document's written
// exemption list with a reason.
//
// FOUR ASSERTIONS, and the last two are the ones an allowlist decays through:
//
//   1. Every expiry column is covered, by exactly one of the two lists. A
//      column on neither is the finding the gate is named for.
//   2. No column is on BOTH. Two dispositions for one clock is the same defect
//      as two expressions of one concept, and the ambiguity always resolves in
//      whichever direction the reader already believed.
//   3. NO STALE ENTRY, in either list. This is the NO-FLOATS list's own second
//      direction, and it is the one that decays quietly: the entry stays, the
//      column is renamed, and the new spelling is unguarded while the list
//      still looks complete. Assertion 1 alone would report that tree as clean.
//   4. A named release job EXISTS as a row of the scheduled table. A coverage
//      row pointing at a job nobody scheduled is the original failure wearing
//      the fix's clothing, and it is one rename away at all times.
//
// WHY `*_expires_at` AND NOT EVERY CLOCK. `identity_restriction_episodes.
// sla_due_at` is a real clock this gate cannot see, and CRON_INVENTORY says so
// rather than leaving it to a grep. Widening the pattern to catch it would also
// catch every `starts_at`, `verified_at` and `created_at` in the schema, and a
// gate that fails on correct DDL is a gate that gets switched off. The
// narrowness is declared here instead of being fixed badly.
const CRON_DOC = 'docs/ops/runbooks/CRON_INVENTORY.md';
const CRON_SCHEDULED = '## Scheduled work';
const CRON_COVERAGE = '## Expiry columns and their release jobs';
const CRON_EXEMPT = '## The expiry exemption list';

// Rows of one `##` section, as [cells]. Bounded to its own section for the same
// reason negativeAuthzRows is: unbounded, this runs on into the next table and
// starts reading rows that answer a different question.
function cronRows(body, heading) {
  const start = body.indexOf(heading);
  if (start === -1) throw new Error(`${CRON_DOC}: section not found: "${heading}"`);
  const after = body.slice(start + heading.length);
  const end = after.search(/\n## /);
  const rows = [];
  for (const line of (end === -1 ? after : after.slice(0, end)).split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue; // the |---|---| separator
    rows.push(cells);
  }
  return rows;
}

// A job name, comparable across the two tables that spell it differently.
// Links flatten to their text, emphasis and code spans are stripped, and
// PARENTHETICALS GO: the scheduled table writes "Nightly batch (day close, rule
// fold, eligibility)" and a coverage row cites "Nightly batch". Matching on the
// raw cell would make every citation of that job a phantom finding, which is
// CI-06a's 109 phantom anchors one table over.
const normJob = (cell) =>
  cell
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*`]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

// `table.column` out of a cell, and nothing else. Anchored so a cell of prose
// mentioning a column in passing is not read as a list entry: an entry is a
// cell that IS the identifier, optionally in a code span.
const columnRef = (cell) => {
  const m = /^`?([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)`?$/.exec(cell.trim());
  return m ? `${m[1]}.${m[2]}` : null;
};

// Every `*_expires_at` column the migrations declare, as `table.column`. Reads
// the same catalogue CI-06j builds, so the two gates cannot disagree about what
// a column is: one parser, called twice, which is OQ-P1-04's ruling applied
// before the second expression exists rather than after.
function expiryColumns() {
  const out = [];
  for (const [table, cols] of columnCatalogue()) {
    for (const col of cols) if (/expires_at$/.test(col)) out.push(`${table}.${col}`);
  }
  return out.sort();
}

const ci06l = {
  id: 'CI-06l',
  title:
    'Every expiry has a sweep: each *_expires_at column names a release job or a written exemption',
  covers:
    'every `*_expires_at` column the migrations declare is dispositioned exactly once in ' +
    `${CRON_DOC}, either in the coverage table with a release job that is itself a row of ` +
    'the scheduled table, or on the written exemption list with a reason. Stale entries in ' +
    'either list are findings, which is the direction an allowlist decays in. ' +
    'THREE THINGS IT DOES NOT DO. It does not check that the named job RUNS, which is what ' +
    'the dead-man switch is for and needs the estate. It does not read any clock whose ' +
    'column is not named `*_expires_at`, so `identity_restriction_episodes.sla_due_at` is ' +
    'covered by the document and invisible to the gate, declared rather than fixed because ' +
    'a wider pattern would match every timestamp in the schema. And it does not judge ' +
    'whether an exemption reason is GOOD, only that one was written.',
  run() {
    const findings = [];
    const columns = expiryColumns();
    // Rule 2 on a derived input. A catalogue parser that silently stopped
    // matching would report a corpus with no clocks in it as fully covered.
    if (columns.length === 0) {
      throw new Error('no *_expires_at columns found in the migrations; the gate cannot run');
    }
    const body = read(CRON_DOC);

    const scheduled = new Set(
      cronRows(body, CRON_SCHEDULED)
        .slice(1)
        .map((r) => normJob(r[0])),
    );
    if (scheduled.size === 0) {
      throw new Error(`${CRON_DOC}: the scheduled table parsed to zero jobs; the gate cannot run`);
    }

    // `.slice(1)` drops the header row of each table. A header whose first cell
    // happens to parse as a column reference would otherwise be an entry.
    const covered = new Map();
    for (const cells of cronRows(body, CRON_COVERAGE).slice(1)) {
      const col = columnRef(cells[0] ?? '');
      if (col === null) continue;
      covered.set(col, { job: (cells[1] ?? '').trim(), line: cells.join(' | ') });
    }
    const exempt = new Map();
    for (const cells of cronRows(body, CRON_EXEMPT).slice(1)) {
      const col = columnRef(cells[0] ?? '');
      if (col === null) continue;
      exempt.set(col, (cells[1] ?? '').trim());
    }
    if (covered.size === 0 && exempt.size === 0) {
      throw new Error(
        `${CRON_DOC}: neither the coverage table nor the exemption list parsed to a single ` +
          '`table.column` entry, so CI-06l is asserting nothing about either',
      );
    }

    const declared = new Set(columns);
    for (const col of columns) {
      const hasJob = covered.has(col);
      const isExempt = exempt.has(col);
      // Assertion 1.
      if (!hasJob && !isExempt) {
        findings.push(
          `${col}: an expiry column that names no release job in ${CRON_DOC} and is not on ` +
            'its exemption list. A bounded hold with no releaser is a denial nobody had to ' +
            'authorize (ADR-040). Give it a job, or exempt it in writing with a reason',
        );
        continue;
      }
      // Assertion 2.
      if (hasJob && isExempt) {
        findings.push(
          `${col}: dispositioned twice in ${CRON_DOC}, once with the release job ` +
            `"${normJob(covered.get(col).job)}" and once on the exemption list. One clock, one ` +
            'disposition: two of them is an ambiguity that resolves in whichever direction the ' +
            'reader already believed',
        );
        continue;
      }
      // Assertion 4.
      if (hasJob) {
        const job = normJob(covered.get(col).job);
        if (job === '') {
          findings.push(
            `${col}: its coverage row names no release job (row reads "${covered.get(col).line.slice(0, 70)}")`,
          );
        } else if (!scheduled.has(job)) {
          findings.push(
            `${col}: its coverage row names the release job "${job}", which is not a row of ` +
              `${CRON_DOC}'s scheduled table. "A job in this table without a dead-man switch is ` +
              'a job that does not exist", and a job with no row at all is one rename away at ' +
              'all times',
          );
        }
      }
      // An exemption with no reason is an exemption nobody has to defend.
      if (isExempt && exempt.get(col) === '') {
        findings.push(
          `${col}: on the exemption list with no reason written beside it. The list is only ` +
            'worth its exemptions if each one states why no job is needed',
        );
      }
    }

    // Assertion 3, BOTH LISTS. The quiet direction: an entry naming a column no
    // migration declares means the list looks complete while the real column,
    // under its new spelling, is covered by nothing.
    for (const [col] of covered) {
      if (!declared.has(col)) {
        findings.push(
          `${CRON_DOC}: the coverage table names ${col}, which no migration declares as an ` +
            '`*_expires_at` column. A stale entry is how a list silently grants more than it ' +
            'names: the row stays, the column is renamed, and the new name is covered by nothing',
        );
      }
    }
    for (const [col] of exempt) {
      if (!declared.has(col)) {
        findings.push(
          `${CRON_DOC}: the exemption list names ${col}, which no migration declares as an ` +
            '`*_expires_at` column. Same stale-entry failure, on the list where it is cheaper ' +
            'to leave a row behind',
        );
      }
    }
    return findings;
  },
};

// -----------------------------------------------------------------------------
// CI-06n  REGISTRY INDEX COMPLETENESS, BOTH DIRECTIONS
// -----------------------------------------------------------------------------
// THIS GATE IS THE PRICE OF ADR-043's INDEX EXEMPTION, and it is written down as
// a price rather than assumed.
//
// CI-06c guarantees "if a thing is not in INDEX.md, it does not exist". ADR-043
// exempts registry ENTRY files from that, because four registries split per entry
// would take INDEX from 85 rows to about 400 and destroy the one artifact whose
// whole value is being readable. An exemption with nothing in its place is
// weakening a gate to pass it, which rule 1 of this file forbids.
//
// So the guarantee becomes TRANSITIVE instead of lost: CI-06c puts the registry
// README in INDEX, and this gate puts every entry in the README. An entry file
// that nothing indexes fails here exactly as it used to fail there.
//
// BOTH DIRECTIONS, and the second is the one that matters after a split. A README
// row pointing at a file that was renamed or never written is a registry claiming
// coverage it does not have, which reads identically to coverage.
const ci06n = {
  id: 'CI-06n',
  title: 'Every registry entry has a README row, and every README row resolves',
  covers:
    'the transitive half of CI-06c for the registries ADR-043 split. Every entry ' +
    'file in a registry directory is linked from that registry README, and every ' +
    'entry link in the README resolves to a file that exists. It does NOT check the ' +
    'entry contents; CI-06f checks that an ADR entry is named for its own heading.',
  run() {
    const findings = [];
    let checked = 0;
    for (const reg of REGISTRIES) {
      if (!existsSync(join(ROOT, reg.dir))) {
        findings.push(`${reg.dir}: registry directory does not exist`);
        continue;
      }
      if (!existsSync(join(ROOT, reg.readme))) {
        findings.push(`${reg.readme}: registry README does not exist`);
        continue;
      }
      const onDisk = walk(reg.dir).filter((f) => reg.entry(f));
      // Rule 2 on a directory-shaped input. A registry whose entry predicate
      // matches nothing is a gate asserting nothing, and it must say so rather
      // than report the empty set as agreement.
      if (onDisk.length === 0) {
        findings.push(
          `${reg.dir}: no entry files match this registry's entry pattern, so ` +
            'CI-06n is asserting nothing about it',
        );
        continue;
      }
      const body = read(reg.readme);
      const linked = new Set();
      for (const m of body.matchAll(/\[[^\]]*\]\(([^)\s#]+)[^)]*\)/g)) {
        const target = relative(ROOT, resolve(join(ROOT, dirname(reg.readme)), m[1]));
        if (!reg.entry(target)) continue; // rows pointing elsewhere are not entry rows
        linked.add(target);
        if (!existsSync(join(ROOT, target))) {
          findings.push(`${reg.readme}: row does not resolve -> ${m[1]}`);
        }
      }
      for (const f of onDisk) {
        if (!linked.has(f)) findings.push(`${f}: entry file with no row in ${reg.readme}`);
      }
      checked += onDisk.length;
    }
    if (REGISTRIES.length === 0 || checked === 0) {
      findings.push('no registry entries checked; CI-06n is asserting nothing');
    }
    return findings;
  },
};

// -----------------------------------------------------------------------------
// CI-06m  THE CALENDAR'S OWN COUNTS, ITS DERIVATION, AND THE UNIT OF EVERY DATE
// -----------------------------------------------------------------------------
// ADR-042, P1 S-E section 7.1. Three checks, one subject: THE TRADING DAY IS
// DATA, AND A DATE COLUMN WITHOUT A UNIT IS A NUMBER WITHOUT ONE.
//
// THE FAILURE IT EXISTS FOR, and it is two failures wearing one face.
//
// The calendar decides what a trading day IS, and every counter the engine
// keeps is counted in trading days. The engine is a pure function of the
// calendar it is handed and cannot go and check: `types: []`,
// `merit/engine-purity` and `RI-01` each guarantee that. SO A WRONG ROW CHANGES
// RULE OUTCOMES WITH NO CHANGE TO A LINE OF ENGINE CODE, silently.
//
// And the schema holds 49 `date` columns whose unit is NOT derivable from their
// type and only sometimes from their name. `published_statistics` carries
// `as_of_trading_day`, whose unit is in the name, beside `window_start_day`,
// whose unit lived only in M12 and whose design-record cell was EMPTY, in one
// table. The exposure is not historical: `0029` to `0031` made
// `interval '48 hours'` idiomatic on the money path, so the next session that
// needs "five trading days from now" has a working pattern sitting right there
// that is wrong on roughly 104 days a year.
//
// WHY THREE CHECKS AND NOT THREE GATES. They share one input set and one
// ruling. Splitting them would make the calendar's counts, its derivation and
// its units three rows that can each be disabled without the other two moving,
// which is the arrangement ADR-034 and ADR-036 were each written to end.
//
// WHAT IT DOES NOT DO. It does not check a transcribed value against the CME
// publication, which no gate can: that is OQ-SE-04's second blind transcription
// and `generate.mjs --diff`. It does not judge whether a declared unit is the
// RIGHT one, only that one of the three is declared. And it reads the DDL
// rather than a live catalogue, so a column that exists only in a database is
// invisible here exactly as it is to CI-06i.
const CAL_SOURCE_DIR = 'packages/db/src/seed/calendars';
const CAL_FIXTURE_DIR = 'packages/rules-engine/fixtures/calendars';

// THE CLOSED UNIT VOCABULARY, and it is closed on purpose. ADR-042 rules that
// an obligation Merit binds itself to is measured in exactly one of two units,
// and that the third thing the corpus says is the RAIL'S, quoted and never
// computed. Three tokens, therefore, and a date column declares one of them.
//
// An open vocabulary would defeat the check within a release: every cell would
// declare its own phrasing, no two would agree, and "the unit is named" would
// become "some words about time are present".
const UNIT_TOKENS = [
  { token: 'trading day', why: 'the exchange CT trading day, answered only by TradingCalendar' },
  { token: 'wall clock', why: "Merit's own clock, answered only by now()" },
  { token: 'rail clock', why: "the rail's own clock, quoted and never computed by Merit" },
];
// THE DECLARATION IS A MARKER, NOT A MENTION, and that distinction was learned
// rather than designed. The first version of this check matched the token
// anywhere in the row, and three rows passed it by accident: `basis_trading_day`
// says "Not a wall clock", `effective_trading_day` explains what it is not, and
// `accounts.opened_on` said "trading day, not a timestamp" in prose while the
// cell beside it had been given the WRONG unit. Prose that mentions a unit and a
// row that declares one are different things, and only the second is checkable.
//
// So the form is exactly `**Unit: <token>**`. It also makes the seeded violation
// honest: stripping the marker removes the declaration no matter what the
// surrounding sentence happens to say.
const UNIT_MARKER = /\*\*Unit:\s*([a-z ]+?)\s*\*\*/i;
const unitDeclared = (text) => {
  const m = UNIT_MARKER.exec(text);
  if (!m) return null;
  const token = m[1].trim().toLowerCase();
  return UNIT_TOKENS.some((u) => u.token === token) ? token : { invalid: token };
};

// "business day" is not a unit Merit computes (ADR-042): it is the rail's
// language, quoted where the rail's leg is described and never calculated. So it
// can never BE the declaration, and a row that tries is the finding. It may
// still appear in the PROSE of a cell that quotes the rail, which is why this
// reads the marker rather than banning the word.
const BUSINESS_DAY = /business[ -]day/i;

/** Every `date` column the migrations declare, as `table.column`. */
function dateColumns() {
  const out = [];
  for (const file of sqlFiles()) {
    const sql = stripSqlComments(read(file));
    for (const m of sql.matchAll(
      /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s*\(/gi,
    )) {
      const table = m[1].toLowerCase();
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
      let d = 0;
      let item = '';
      const items = [];
      for (const ch of sql.slice(start, i)) {
        if (ch === '(') d++;
        if (ch === ')') d--;
        if (ch === ',' && d === 0) {
          items.push(item);
          item = '';
        } else item += ch;
      }
      items.push(item);
      for (const raw of items) {
        const p = raw.trim().split(/\s+/);
        if (!p[0] || !/^[a-z_][a-z0-9_]*$/i.test(p[0])) continue;
        if (
          [
            'constraint',
            'primary',
            'unique',
            'check',
            'foreign',
            'exclude',
            'like',
            'partition',
          ].includes(p[0].toLowerCase())
        )
          continue;
        // `date` exactly. `timestamptz` is a different unit question and
        // `daterange` is not a day.
        if (/^date$/i.test(p[1] ?? '')) out.push(`${table}.${p[0].toLowerCase()}`);
      }
    }
    for (const m of sql.matchAll(
      /ALTER\s+TABLE\s+([a-z_][a-z0-9_]*)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s+date\b/gi,
    ))
      out.push(`${m[1].toLowerCase()}.${m[2].toLowerCase()}`);
  }
  return [...new Set(out)].sort();
}

/**
 * The design-record row for `column` in `table`, as its raw line. Matches the
 * column inside a code span so a row that MENTIONS another column in prose is
 * not mistaken for that column's row; a record may declare two columns in one
 * row (`created_at`, `updated_at`) and that row answers for both.
 */
function designRow(table, column) {
  const path = `docs/architecture/data-model/${table}.md`;
  if (!existsSync(join(ROOT, path))) return { path, row: null, missingFile: true };
  for (const line of read(path).split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    const first = t.replace(/^\|/, '').split('|')[0] ?? '';
    if (new RegExp('`[^`]*\\b' + column + '\\b[^`]*`').test(first)) return { path, row: t };
  }
  return { path, row: null };
}

const ci06m = {
  id: 'CI-06m',
  title:
    'The calendar declares its own counts, its generated file is derived, and every date column names its unit',
  covers:
    'THREE CHECKS. (1) Every calendar source file is internally coherent: its transcription ' +
    'state, its exception lists and its declared counts agree with each other and with its own ' +
    "contents, through `generate.mjs`'s own parser rather than a second copy of it. " +
    '(2) Every generated calendar and every fixture is DERIVED and reproduces: a transcribed ' +
    'source regenerates byte-identically, and an untranscribed one has no generated file at all, ' +
    'because a generated artifact nobody can reproduce is the drift the derivation exists to end. ' +
    '(3) Every `date` column the migrations declare has a design-record row naming its unit from ' +
    'the closed vocabulary trading day | wall clock | rail clock. ' +
    'IT DOES NOT check a transcribed value against the CME publication, which no gate can: that ' +
    "is OQ-SE-04's blind second transcription. It does not judge whether the declared unit is the " +
    'RIGHT one, only that one is declared.',
  run() {
    const findings = [];

    // -------------------------------------------------------------------------
    // 1. The source file's declared counts agree with its own contents
    // -------------------------------------------------------------------------
    if (!existsSync(join(ROOT, CAL_SOURCE_DIR))) {
      throw new Error(`${CAL_SOURCE_DIR} does not exist; the calendar source has moved or is gone`);
    }
    const sources = readdirSync(join(ROOT, CAL_SOURCE_DIR))
      .filter((f) => f.endsWith('.source.json'))
      .sort();
    // Rule 2 on a derived input. A directory that stopped matching would report
    // a repository with no calendar in it as fully checked.
    if (sources.length === 0) {
      throw new Error(
        `${CAL_SOURCE_DIR} holds no *.source.json, so CI-06m is asserting nothing about the calendar`,
      );
    }

    for (const file of sources) {
      const path = `${CAL_SOURCE_DIR}/${file}`;
      let src;
      try {
        src = JSON.parse(read(path));
      } catch (e) {
        findings.push(`${path}: is not parseable JSON (${e.message})`);
        continue;
      }

      const awaiting = src.status === 'awaiting-transcription';
      if (src.status !== 'transcribed' && !awaiting) {
        findings.push(
          `${path}: status "${src.status}" is neither "transcribed" nor "awaiting-transcription"`,
        );
        continue;
      }

      // NULL IS NOT THE EMPTY LIST, and this is the assertion that keeps it so.
      // `holidays: null` says nobody has read the publication; `holidays: []`
      // asserts the exchange closes on no day of the year, and it would load
      // clean while making every counter advance through Christmas. ADR-042
      // F-1's lesson, that a holiday is a positive fact rather than an absence,
      // applied one layer earlier to the file. BOTH DIRECTIONS: a file claiming
      // to await transcription while carrying values is the same defect
      // mirrored, and it is the one a half-finished edit produces.
      const nulls = ['holidays', 'early_closes'].filter((k) => src[k] === null);
      const declared = src.declared ?? {};
      const declaredNulls = ['holiday_count', 'early_close_count', 'session_count'].filter(
        (k) => declared[k] === null,
      );
      if (awaiting && (nulls.length !== 2 || declaredNulls.length !== 3)) {
        findings.push(
          `${path}: status is "awaiting-transcription" but the file carries values. ` +
            'An untranscribed source states null for holidays, early_closes and every declared count',
        );
      }
      if (!awaiting && (nulls.length > 0 || declaredNulls.length > 0)) {
        findings.push(
          `${path}: status is "transcribed" but ${[...nulls, ...declaredNulls].join(', ')} is null. ` +
            'Null means nobody has read the publication, and it is not the empty list',
        );
      }

      // The declared-count agreement itself is `checkRows`'s
      // `declared-count-disagrees`, and it is called through the generator
      // rather than reimplemented here: two expressions of one concept agree
      // exactly until they do not (OQ-P1-04).
      if (!awaiting) {
        try {
          calendarGenerator().build(read(path), { sourceFile: path });
        } catch (e) {
          findings.push(
            `${path}: ${e.finding ? `REJECTED [${e.finding}] ` : ''}${e.detail ?? e.message}`,
          );
        }
      }

      // ---------------------------------------------------------------------
      // 2. The generated file is derived, and reproduces
      // ---------------------------------------------------------------------
      const generatedPath = `${CAL_SOURCE_DIR}/${file.replace(/\.source\.json$/, '.generated.json')}`;
      const generatedExists = existsSync(join(ROOT, generatedPath));
      if (awaiting && generatedExists) {
        findings.push(
          `${generatedPath} exists beside an untranscribed source. A generated file nobody can ` +
            'reproduce is the hand-maintained calendar the derivation exists to abolish',
        );
      }
      if (!awaiting && !generatedExists) {
        findings.push(
          `${generatedPath} is missing. A transcribed source without its generated file means the ` +
            'reviewable artifact does not exist and git holds no history of it',
        );
      }
      if (!awaiting && generatedExists) {
        try {
          const g = calendarGenerator();
          if (g.serialize(g.build(read(path), { sourceFile: path })) !== read(generatedPath)) {
            findings.push(
              `${generatedPath} is not what ${path} generates. Regenerate with ` +
                `\`node ${CAL_SOURCE_DIR}/generate.mjs ${path} --out ${generatedPath}\` and commit the result`,
            );
          }
        } catch {
          /* the build failure is already a finding above */
        }
      }
    }

    // The fixture calendars, which are the OTHER hand-maintained calendar and
    // the reason this check is the load-bearing one. cme-2026.json says in its
    // own note that two hand-maintained calendars is the drift class this
    // corpus has found repeatedly. Deriving it is S-E's commitment; until the
    // publication is transcribed it cannot be derived from anything, so what is
    // asserted today is that it declares its own counts and that they agree
    // with its own contents, which is the same two-statements-of-one-number
    // discipline one file over.
    if (!existsSync(join(ROOT, CAL_FIXTURE_DIR))) {
      throw new Error(
        `${CAL_FIXTURE_DIR} does not exist; the golden fixtures cannot resolve a session`,
      );
    }
    const fixtures = readdirSync(join(ROOT, CAL_FIXTURE_DIR))
      .filter((f) => f.endsWith('.json'))
      .sort();
    if (fixtures.length === 0) {
      throw new Error(
        `${CAL_FIXTURE_DIR} holds no calendar fixture; CI-06m is asserting nothing about it`,
      );
    }
    for (const file of fixtures) {
      const path = `${CAL_FIXTURE_DIR}/${file}`;
      let fx;
      try {
        fx = JSON.parse(read(path));
      } catch (e) {
        findings.push(`${path}: is not parseable JSON (${e.message})`);
        continue;
      }
      const sessions = Array.isArray(fx.sessions) ? fx.sessions : null;
      if (sessions === null) {
        findings.push(`${path}: has no \`sessions\` array`);
        continue;
      }
      // THE VACUITY DIRECTION, AND IT WAS FOUND BY EXECUTION RATHER THAN BY
      // READING. Every per-session assertion below is a loop, and every loop
      // over an empty array succeeds. A fixture emptied to `"sessions": []`
      // with `"session_count": 0` satisfied the declared-count check (0 equals
      // 0), the coverage check (nothing to fall outside it) and the weekend
      // check (nothing to land on a Saturday), and CI-06m REPORTED PASS. A
      // derivation that reproduces nothing read exactly like one that
      // reproduces correctly, which is what this gate exists to tell apart.
      //
      // It is the same defect the corpus has now found four times in four
      // costumes: `array_length` on an empty array returning NULL and the CHECK
      // passing (ADR-035, seven constraints), `{}` accepted as a
      // `trading_calendar_revisions` prior image, an allowlist that decays by
      // keeping a stale entry (CI-06l), and this. THE EMPTY CASE IS NEVER THE
      // SAFE DEFAULT: it is the single value the assertion exists to reject,
      // and it is the one value that skips the assertion entirely.
      if (sessions.length === 0) {
        findings.push(
          `${path}: declares zero sessions. Every check below this one is a loop, so an empty ` +
            'array satisfies all of them and the fixture asserts NOTHING while reading as ' +
            'derived. A calendar with no sessions cannot resolve the day a golden fixture ' +
            'names, and L-08 would refuse every lookup rather than one',
        );
        continue;
      }
      if (typeof fx.session_count !== 'number') {
        findings.push(
          `${path}: declares no \`session_count\`. The declared count is the second independent ` +
            'statement of one number, and it is what catches a row deleted while editing',
        );
      } else if (fx.session_count !== sessions.length) {
        findings.push(
          `${path}: declares session_count ${fx.session_count} against ${sessions.length} sessions`,
        );
      }
      const from = fx.coverage?.from;
      const to = fx.coverage?.to;
      if (typeof from !== 'string' || typeof to !== 'string') {
        findings.push(
          `${path}: has no \`coverage\` interval, which L-08 needs to refuse a day it does not hold`,
        );
      } else {
        for (const s of sessions) {
          const day = s.trading_day;
          if (typeof day !== 'string') {
            findings.push(`${path}: a session has no trading_day`);
            continue;
          }
          if (day < from || day > to)
            findings.push(`${path}: session ${day} is outside coverage ${from}..${to}`);
          // A weekend row is the transcription slip this catches without any
          // knowledge of the exchange: Saturday has no session, ever.
          const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
          if (dow === 0 || dow === 6) findings.push(`${path}: session ${day} falls on a weekend`);
        }
      }
      // A fixture that is not `partial` claims to be a real calendar, and a real
      // calendar is derived rather than typed.
      if (fx.status !== 'partial' && !fx.generated_by) {
        findings.push(
          `${path}: status "${fx.status}" is not "partial" and the file names no generator. ` +
            "Two hand-maintained calendars is the drift class this file's own note describes",
        );
      }
      // THE CITATION MUST RESOLVE, which is `CI-06l/unknown-job`'s assertion one
      // registry over: a coverage row naming a release job nobody scheduled is
      // the original failure wearing the fix's clothing. A fixture naming a
      // generator that has moved is the same shape and is worse, because
      // `generated_by` is the ONE field that distinguishes a derived calendar
      // from a typed one. Left unchecked, a file goes on claiming derivation
      // from a script that no longer exists, and the claim is what a reader
      // trusts instead of re-deriving.
      if (typeof fx.generated_by === 'string' && !existsSync(join(ROOT, fx.generated_by))) {
        findings.push(
          `${path}: names generator "${fx.generated_by}", which does not exist. A file that ` +
            'claims to be derived from a script nobody can run is hand-maintained with a ' +
            'provenance line on top',
        );
      }
    }

    // -------------------------------------------------------------------------
    // 3. Every date column names its unit
    // -------------------------------------------------------------------------
    const dates = dateColumns();
    if (dates.length === 0) {
      throw new Error('no `date` columns found in the migrations; the unit check cannot run');
    }
    for (const ref of dates) {
      const [table, column] = ref.split('.');
      const { path, row, missingFile } = designRow(table, column);
      if (missingFile) {
        // CI-06i owns "a table with no design record" and would report this
        // too. Named here rather than skipped, because a silent skip is how a
        // whole table's date columns leave the gate's sight.
        findings.push(`${ref}: no design record at ${path} (CI-06i owns the table-level finding)`);
        continue;
      }
      if (row === null) {
        findings.push(`${ref}: ${path} has no row for the column`);
        continue;
      }
      const declared = unitDeclared(row);
      if (declared === null) {
        findings.push(
          `${ref}: its row in ${path} names no unit. A date column's unit is not derivable from ` +
            `its type and only sometimes from its name. Declare one, as \`**Unit: <token>**\`, ` +
            `from: ${UNIT_TOKENS.map((u) => u.token).join(' | ')}`,
        );
        continue;
      }
      if (typeof declared === 'object') {
        findings.push(
          `${ref}: its row declares \`**Unit: ${declared.invalid}**\`, which is not one of ` +
            `${UNIT_TOKENS.map((u) => u.token).join(' | ')}.` +
            (BUSINESS_DAY.test(declared.invalid)
              ? ' "business day" is the rail\'s language (ADR-042): Merit quotes it and never' +
                ' computes it, and there is no business-day calendar in this system.'
              : ' The vocabulary is closed so that two rows cannot declare the same unit in two' +
                ' spellings and agree only by accident.'),
        );
      }
    }

    return findings;
  },
};

// THE GENERATOR IS IMPORTED, NEVER REIMPLEMENTED. `checkRows` already owns
// `declared-count-disagrees` and `build` already owns the session rule; a
// second copy here would be two expressions of one concept, which agree exactly
// until they do not (OQ-P1-04, and ADR-036's stated precedent for extending the
// migrations job rather than adding a sibling with its own parser).
//
// Top-level await, so the failure mode of a moved or broken generator is this
// gate reporting ERROR rather than every gate failing to load.
let _calendarGenerator = null;
let _calendarGeneratorError = null;
try {
  _calendarGenerator = await import(
    pathToFileURL(join(ROOT, `${CAL_SOURCE_DIR}/generate.mjs`)).href
  );
} catch (e) {
  _calendarGeneratorError = e;
}
function calendarGenerator() {
  if (_calendarGenerator === null) {
    throw new Error(
      `${CAL_SOURCE_DIR}/generate.mjs could not be loaded, so CI-06m cannot check the calendar ` +
        `against its own parser: ${_calendarGeneratorError?.message ?? 'unknown error'}`,
    );
  }
  return _calendarGenerator;
}

// -----------------------------------------------------------------------------
// CI-06p  THE LETTER REGISTRY, READ THE WAY THE TWO NUMERIC ONES ARE READ
// -----------------------------------------------------------------------------
// CI-06o  No model on the money path, and a money path outside the scope list
// -----------------------------------------------------------------------------
// ADR-044 SECTION 8, WHICH SPECIFIES THIS GATE AND THEN SAYS IT DOES NOT EXIST:
//
//   "No module that resolves, directly or transitively, from
//   `packages/rules-engine` or from the payout, ledger or auth paths may import
//   a model SDK or reach a model endpoint. The banned-identifier list is
//   declared in one place, and A PATH ADDED TO THE MONEY-PATH SET WITHOUT BEING
//   ADDED TO THE GATE'S SCOPE IS ITSELF A FINDING."
//
// "A rule that says no model on the money path and is enforced by people
// remembering it is a control that exists, stays valid, and enforces nothing."
// Until this runs and has been WATCHED FAILING, prohibition 1 is prose.
//
// -----------------------------------------------------------------------------
// THE FIRST ASSERTION IS NEARLY VACUOUS TODAY AND THE SECOND IS WHY IT SHIPS NOW
// -----------------------------------------------------------------------------
// There is no ledger, payout or auth package: `packages/` holds db,
// eslint-plugin-merit, golden-loader, rithmic, rules-engine and tooling. So
// assertion 1 scans one package and finds nothing, which is ADR-042's argument
// for its SQL shape check rather than a reason to defer: a gate written while
// its subject is empty is a gate nobody has to argue with later, and the day
// `packages/payout` arrives is the day somebody would otherwise have had to
// remember this ADR.
//
// ASSERTION 2 IS THE ONE WITH TEETH, and it is what stops assertion 1 going
// quietly vacuous. A scope list is a claim about coverage, and a coverage claim
// that nothing checks decays the first time a directory is added. So the gate
// DISCOVERS money paths independently of its own scope list and reports any it
// finds that the list does not name.
//
// -----------------------------------------------------------------------------
// WHY THIS IS NOT A FOURTH SPELLING OF RI-07, WHICH WAS CHECKED BEFORE IT WAS
// WRITTEN
// -----------------------------------------------------------------------------
// `RI-07` walks the engine's transitive module graph and reports "a bare
// specifier that is neither" a Node builtin nor a relative path, so an
// `import ... from '@anthropic-ai/sdk'` inside `packages/rules-engine/src`
// ALREADY fails there. Three things here are outside it:
//
//   scope      RI-07 starts at `packages/rules-engine/src/index.ts` and follows
//              relative imports. It says nothing about the payout, ledger or
//              auth paths, and it reaches no file the engine does not import
//   endpoints  RI-07 reads SPECIFIERS. A model reached by URL is a string
//              literal in a file that imports nothing unusual
//   the list   RI-07 has no ban list; it allows relative-or-builtin and refuses
//              the rest. ADR-044 requires the banned identifiers in ONE place,
//              which is what `MODEL_SDK_SPECIFIERS` and `MODEL_ENDPOINT_HOSTS`
//              below are, and what a reader adding an SDK looks for
//
// `merit/engine-purity` is also not this: it reads one file at a time, returns
// early on relative specifiers, and is attached to `rules-engine/src/**` only.
// Neither mechanism has assertion 2 at all.

/**
 * THE BANNED IDENTIFIER LIST, DECLARED IN ONE PLACE (ADR-044 section 8).
 *
 * Matched against IMPORT SPECIFIERS, exactly or as a package prefix, and never
 * as a loose substring. That is not fastidiousness: scanning for `cohere` over
 * this repository matches "co**here**nt" in five files of the engine's own test
 * generators, which was measured before this list was written rather than
 * discovered by a false red.
 */
const MODEL_SDK_SPECIFIERS = [
  '@anthropic-ai/sdk',
  'openai',
  '@google/generative-ai',
  '@google/genai',
  'cohere-ai',
  '@mistralai/mistralai',
  'replicate',
  'langchain',
  '@langchain/core',
  'ollama',
  '@aws-sdk/client-bedrock-runtime',
  'together-ai',
  'groq-sdk',
  '@huggingface/inference',
];

/** Matched against string literals. Dotted hosts, so they need no word guard. */
const MODEL_ENDPOINT_HOSTS = [
  'api.anthropic.com',
  'api.openai.com',
  'generativelanguage.googleapis.com',
  'api.cohere.ai',
  'api.mistral.ai',
  'api.replicate.com',
  'api.together.xyz',
  'api.groq.com',
  'bedrock-runtime.',
  'api-inference.huggingface.co',
];

/**
 * The paths assertion 1 scans. ADR-044 names four money paths and one of them
 * exists; the other three are listed as the names assertion 2 watches for.
 */
const CI06O_SCOPE = ['packages/rules-engine'];

/**
 * How assertion 2 RECOGNISES a money path without being told.
 *
 * ADR-044's four are the rules engine, payout, ledger and auth, and CLAUDE.md's
 * session-length regime names the same four. A package or app whose directory
 * name carries one of these words is a money path, and if the scope list does
 * not name it the gate says so.
 */
const MONEY_PATH_WORDS = ['rules-engine', 'payout', 'ledger', 'auth'];

/**
 * Comments removed while string literals are respected, because a URL contains
 * `//` and a naive stripper eats the rest of the line that holds it. Walks the
 * source once tracking which of five states it is in.
 */
function stripJsComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Every specifier a static import, re-export, dynamic import or require names. */
function importSpecifiers(src) {
  const out = [];
  const patterns = [
    /(?:^|[^\w$])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|[^\w$])import\s*['"]([^'"]+)['"]/g,
    /(?:^|[^\w$])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /(?:^|[^\w$])require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src)) !== null) out.push(m[1]);
  }
  return out;
}

/** `openai` matches `openai` and `openai/shims`, and never `openai-ish`. */
const isBannedSpecifier = (spec) =>
  MODEL_SDK_SPECIFIERS.find((b) => spec === b || spec.startsWith(`${b}/`));

const CI06O_SOURCE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

const ci06o = {
  id: 'CI-06o',
  title: 'No model SDK or model endpoint on the money path, and no money path outside the scope list',
  covers:
    "ADR-044 section 8's prohibition 1, in two assertions. ONE: no file under a " +
    'money-path scope entry imports a model SDK or names a model endpoint host, ' +
    'read from STATIC import, re-export, dynamic-import and require specifiers ' +
    'and from string literals, with comments stripped. TWO: every money path the ' +
    'gate can DISCOVER, meaning a child of packages/ or apps/ whose directory ' +
    "name carries one of ADR-044's four money-path words, is named in the scope " +
    'list, so a path added to the money-path set without being added here is ' +
    'itself a finding. IT IS NOT RI-07: that walks the engine module graph only, ' +
    'reads specifiers and not endpoints, and has no ban list and no assertion 2. ' +
    'WHAT IT CANNOT DO, stated because a gate implying coverage it lacks is worse ' +
    'than its absence: a host BUILT AT RUNTIME from concatenation or an env var ' +
    'is invisible to it, as is a model call made by a dependency inside its own ' +
    'package (node_modules is never walked), and discovery is BY NAME, so a money ' +
    'path whose directory name does not say so -- apps/worker runs the nightly ' +
    'batch today -- is not found by assertion 2 and must be added by hand.',
  run() {
    const findings = [];
    let scanned = 0;

    // Assertion 1.
    for (const dir of CI06O_SCOPE) {
      if (!existsSync(join(ROOT, dir))) {
        findings.push(`${dir}: scope entry does not exist, so nothing under it is checked`);
        continue;
      }
      for (const file of walk(dir)) {
        if (!CI06O_SOURCE.has(extname(file))) continue;
        scanned++;
        const src = stripJsComments(read(file));
        for (const spec of importSpecifiers(src)) {
          const banned = isBannedSpecifier(spec);
          if (banned) findings.push(`${file}: imports the model SDK "${banned}"`);
        }
        for (const host of MODEL_ENDPOINT_HOSTS) {
          if (src.includes(host)) findings.push(`${file}: names the model endpoint "${host}"`);
        }
      }
    }

    // Rule 2 on a directory-shaped input. A scope that matches no file is a gate
    // asserting nothing, and it must say so rather than pass quietly.
    if (scanned === 0) {
      findings.push('the scope list matched no source file, so assertion 1 asserted nothing');
    }

    // Assertion 2, and it is the half that keeps assertion 1 honest.
    let discovered = 0;
    for (const root of ['packages', 'apps']) {
      if (!existsSync(join(ROOT, root))) continue;
      for (const entry of readdirSync(join(ROOT, root))) {
        if (entry === 'node_modules') continue;
        const rel = `${root}/${entry}`;
        if (!statSync(join(ROOT, rel)).isDirectory()) continue;
        const word = MONEY_PATH_WORDS.find((w) => entry.includes(w));
        if (!word) continue;
        discovered++;
        if (!CI06O_SCOPE.includes(rel)) {
          findings.push(
            `${rel}: money path (its name carries "${word}") is not in CI-06o's scope list, ` +
              'so ADR-044 prohibition 1 is not enforced over it',
          );
        }
      }
    }
    if (discovered === 0) {
      findings.push('discovery matched no money path, so assertion 2 asserted nothing');
    }

    return findings;
  },
};

// -----------------------------------------------------------------------------
// The third allocation table in ALLOCATION.md claims `CI-06` LETTERS, and for a
// week nothing read it. That is not an oversight, it is a parser fact: the
// shared `allocated()` above matches a three-digit or four-digit first cell and
// A LETTER DOES NOT PARSE. So the table that was written to end three plan
// documents hand-maintaining one sequence was itself the one registry with no
// gate over it, and it said so in its own words.
//
// THE ASSERTION SET IS NAMED BY THE TABLE, not invented here: "uniqueness of the
// letters in the STRATEGY rows, and gaplessness over allocated plus reserved,
// which is CI-06f's assertion with a different alphabet." Three checks:
//
//   1. UNIQUENESS IN THE STRATEGY INVENTORY. Each `CI-06<letter>` heads at most
//      one row of section 4.4. Two rows for one letter is ADR-038's collision in
//      the document that describes the gates rather than in the runner.
//   2. EVERY IMPLEMENTED LETTER IS CLAIMED BY A ROW. This is CI-06h's second
//      assertion and it is the one that keeps the table from going vacuous:
//      gaplessness alone can never force a row, because a gate that exists in
//      the runner fills its own hole. Without this the sequence stays gapless
//      while the registry quietly stops being maintained, which is the state
//      this table was created to end.
//   3. GAPLESS OVER IMPLEMENTED PLUS RESERVED. `o` is reserved by ADR-044 and
//      unwritten, so a hole a sibling branch holds must pass, exactly as it does
//      on the two tables above. The maximum is taken over the STRATEGY letters
//      too, so a letter rowed in STRATEGY and claimed nowhere is a hole rather
//      than a row above the horizon that nothing looks at.
//
// SAME TWO-REF GAP, INHERITED VERBATIM. A branch cannot see a letter its sibling
// took, which is why gaplessness runs over reserved at all.
const LETTER_ALLOCATION = '## CI gate identifier allocation';
const STRATEGY_DOC = 'docs/testing/STRATEGY.md';
const GATE_INVENTORY = '### 4.4 Corpus integrity';

// The letters a table section claims, from the FIRST CELL OF TABLE ROWS ONLY,
// which is `allocated()`'s rule with a different alphabet. `| `a` to `j` |` is a
// range and `| **`k`** |` is one letter; the header row and the `|---|`
// separator match neither, which is how they are skipped.
//
// BOUNDED ON ANY HEADING RATHER THAN ON `\n## `, and the difference is not
// style. This is the LAST `##` section in the file, so a `\n## ` bound runs to
// end of file and every table row in the prose sections below it would claim a
// letter. The two numeric tables each have a `##` sibling beneath them and never
// had this problem, which is exactly why copying their bound would have been
// wrong in a way nothing would have reported.
function allocatedLetters(body) {
  const start = body.indexOf(LETTER_ALLOCATION);
  if (start === -1) throw new Error(`allocation table not found: "${LETTER_ALLOCATION}"`);
  const rest = body.slice(start + LETTER_ALLOCATION.length);
  const next = rest.search(/\n#{1,6} /);
  const claimed = new Set();
  let rows = 0;
  for (const line of (next === -1 ? rest : rest.slice(0, next)).split('\n')) {
    if (!line.startsWith('|')) continue;
    const m = /^\s*\*{0,2}`?([a-z])`?\*{0,2}(?:\s+to\s+\*{0,2}`?([a-z])`?\*{0,2})?\s*$/.exec(
      line.split('|')[1] ?? '',
    );
    if (!m) continue;
    rows++;
    const to = (m[2] ?? m[1]).charCodeAt(0);
    for (let c = m[1].charCodeAt(0); c <= to; c++) claimed.add(String.fromCharCode(c));
  }
  // Rule 2. A table that parses to nothing is a gate with an empty reservation
  // set: it reports every hole and no false pass, and it is still a runner that
  // has lost its input.
  if (rows === 0) throw new Error(`allocation table claims no letters: "${LETTER_ALLOCATION}"`);
  return claimed;
}

// The letters the runner actually implements, read from GATES rather than from
// STRATEGY's table, because the runner is the artifact and the table is the
// description of it. Same reasoning as `gate_count`'s query.
const implementedLetters = () =>
  new Set(
    GATES.map((g) => /^CI-06([a-z])$/.exec(g.id))
      .filter(Boolean)
      .map((m) => m[1]),
  );

// The letters STRATEGY section 4.4 rows, in order, so a duplicate is visible.
// Bounded to its own `###` section for the same reason `negativeAuthzRows` and
// `cronRows` are: unbounded, this runs into 4.5 and reads a table answering a
// different question.
function strategyGateLetters() {
  const body = read(STRATEGY_DOC);
  const start = body.indexOf(GATE_INVENTORY);
  if (start === -1) throw new Error(`${STRATEGY_DOC}: section not found: "${GATE_INVENTORY}"`);
  const after = body.slice(start + GATE_INVENTORY.length);
  const end = after.search(/\n### /);
  const out = [];
  for (const line of (end === -1 ? after : after.slice(0, end)).split('\n')) {
    if (!line.startsWith('|')) continue;
    const m = /^\s*\*{0,2}`?CI-06([a-z])`?\*{0,2}\s*$/.exec(line.split('|')[1] ?? '');
    if (m) out.push(m[1]);
  }
  return out;
}

const ci06p = {
  id: 'CI-06p',
  title: 'CI gate letters are unique in STRATEGY and gapless over implemented plus reserved',
  covers:
    "CI-06f's assertion with a different alphabet, over the third allocation table. " +
    'Each CI-06<letter> heads at most one row of STRATEGY section 4.4; every letter the ' +
    'runner implements is claimed by a row of the letter table, which is what stops the ' +
    'table going vacuous once gaplessness can be satisfied by the gate itself; and the ' +
    'letters are gapless over implemented plus reserved, so a letter a sibling branch ' +
    'holds is a hole that passes. ' +
    "THREE THINGS IT DOES NOT DO. It inherits CI-06f and CI-06h's cross-branch gap " +
    'verbatim: a pull request may not claim a letter already taken on main, and this run ' +
    'sees one ref. It does not require an implemented gate to HAVE a STRATEGY row, ' +
    'because ADR-026 is a check in this runner with no letter at all and the rule would ' +
    'be a shape nobody has ruled. And it says nothing about whether a gate does what its ' +
    'row claims, which is falsify.mjs and not a parse.',
  run() {
    const findings = [];
    const implemented = implementedLetters();
    // Rule 2 on a derived input. A regex that stopped matching the gate ids
    // would make every claimed letter unimplemented and every row a finding,
    // which is loud; an EMPTY implemented set with an empty table would be
    // silent, and that is the direction this guard is for.
    if (implemented.size === 0) {
      throw new Error('no CI-06<letter> gates found in this runner; the gate cannot run');
    }
    const reserved = allocatedLetters(read(ALLOCATION_DOC));

    // Assertion 1.
    const rowed = strategyGateLetters();
    if (rowed.length === 0) {
      throw new Error(
        `${STRATEGY_DOC}: the ${GATE_INVENTORY} inventory parsed to zero CI-06 rows; ` +
          'CI-06p is asserting nothing about it',
      );
    }
    const seen = new Set();
    for (const letter of rowed) {
      if (seen.has(letter)) {
        findings.push(
          `${STRATEGY_DOC}: CI-06${letter} heads more than one row of the ${GATE_INVENTORY} ` +
            'inventory. One letter is one gate, and two rows for it is the collision this ' +
            'registry exists to end, in the document that describes the gates',
        );
      }
      seen.add(letter);
    }

    // Assertion 2, which is CI-06h's and not CI-06f's.
    for (const letter of [...implemented].sort()) {
      if (!reserved.has(letter)) {
        findings.push(
          `CI-06${letter} is implemented in this runner and no row of the letter table in ` +
            `${ALLOCATION_DOC} claims it. Claim the letter there before writing the gate ` +
            '(ADR-034, ADR-036), or the table stops being what a sibling branch reads',
        );
      }
    }

    // Assertion 3. The STRATEGY letters are in the maximum so a letter rowed
    // there and claimed nowhere is a hole rather than a row nothing reaches.
    const all = [...implemented, ...reserved, ...rowed].map((c) => c.charCodeAt(0));
    const max = Math.max(...all);
    for (let c = 'a'.charCodeAt(0); c <= max; c++) {
      const letter = String.fromCharCode(c);
      if (!implemented.has(letter) && !reserved.has(letter)) {
        findings.push(
          `CI-06${letter} is neither implemented nor reserved (a hole). A letter is claimed ` +
            `in ${ALLOCATION_DOC} before the gate is written, and a hole a sibling branch ` +
            'has reserved passes',
        );
      }
    }
    return findings;
  },
};

// -----------------------------------------------------------------------------
// `allocation`: the derivation the allocation tables point at
// -----------------------------------------------------------------------------
// THE STATE COLUMN WAS DELETED AND THIS IS THE HALF THAT REPLACED IT. It read
// `allocated` or `reserved, unmerged` and was wrong eleven times in nine days,
// because a runner reading one ref cannot tell a reservation from an allocation
// and neither can a reader. ADR-034's remedy is to generate the value or delete
// it and point at the source; the half a single ref CAN answer is "is the
// artifact in this tree", and this prints it per claimed row.
//
// IT IS NOT A GATE AND IT ASSERTS NOTHING. `absent` here means absent from THIS
// REF, which is the whole of what the deleted column got wrong. A sibling branch
// may hold the file, and `git ls-remote` is still the manual step.
function allocationReport() {
  const body = read(ALLOCATION_DOC);
  const line = (id, present, note) =>
    console.log(`  ${id.padEnd(10)}${present ? 'present  ' : 'absent   '}${note}`);

  const adrOnDisk = new Set(
    adrEntries()
      .map((e) => e.id)
      .filter((id) => id && !/^D/.test(id))
      .map(Number),
  );
  console.log(`ADR numbers        ${ALLOCATION_DOC}, "${ADR_ALLOCATION}"`);
  for (const n of [...allocated(body, ADR_ALLOCATION)].sort((a, b) => a - b)) {
    const id = String(n).padStart(3, '0');
    line(`ADR-${id}`, adrOnDisk.has(n), `docs/decisions/ADR-${id}.md`);
  }

  const migrationsOnDisk = new Map(
    sqlFiles()
      .map((p) => [/(\d{4})_/.exec(p), p.replace('packages/db/migrations/', '')])
      .filter(([m]) => m)
      .map(([m, f]) => [Number(m[1]), f]),
  );
  console.log(`\nMigration numbers  ${ALLOCATION_DOC}, "${MIGRATION_ALLOCATION}"`);
  for (const n of [...allocated(body, MIGRATION_ALLOCATION)].sort((a, b) => a - b)) {
    const id = String(n).padStart(4, '0');
    line(id, migrationsOnDisk.has(n), migrationsOnDisk.get(n) ?? 'no file on this ref');
  }

  const implemented = implementedLetters();
  console.log(`\nCI gate letters    ${ALLOCATION_DOC}, "${LETTER_ALLOCATION}"`);
  for (const letter of [...allocatedLetters(body)].sort()) {
    const has = implemented.has(letter);
    line(`CI-06${letter}`, has, has ? 'a gate in this runner' : 'no gate in this runner');
  }

  console.log(
    '\n`absent` means absent from THIS REF and nothing more. A sibling branch may hold it,\n' +
      'which is the two-ref gap CI-06f, CI-06h and CI-06p each declare, and it is why the\n' +
      'State column that used to claim otherwise was deleted rather than repaired again.',
  );
  return 0;
}

// -----------------------------------------------------------------------------
// CI-06q  Cited authority exists
// -----------------------------------------------------------------------------
// ON 2026-08-17 A MERGE-BLOCKING STAGE CITED AN AUTHORITY THAT DID NOT EXIST.
// Two lines in packages/golden-loader/src/coverage.ts attributed the deferral of
// ADR-048's polarity enforcement to a dated ruling by the founder. No such
// ruling existed, in `docs/` or anywhere else, and ADR-048 does not mention
// enforcement being deferred.
//
// THE BEHAVIOUR WAS CORRECT AND NEEDED NO AUTHORITY AT ALL: a derived direction
// cannot be enforced against a fold that reaches none of the rules a fixture
// cites, which is a tautology rather than a decision. THE CITATION WAS THE WHOLE
// DEFECT, and nothing in this repository could see it, because no gate had ever
// asked whether a cited ruling exists.
//
// -----------------------------------------------------------------------------
// WHAT "RESOLVES" MEANS, AND WHY THE OBVIOUS READING IS CIRCULAR
// -----------------------------------------------------------------------------
// The tempting definition is "some file under docs/ mentions that date near the
// word ruling". THAT DEFINITION IS SATISFIED BY THE CITATIONS THEMSELVES. Two
// session logs cite the 2026-08-17 ruling in exactly that shape, so the gate
// would have read one citation as the authority for another and PASSED ON THE
// DEFECT THAT COMMISSIONED IT. Measured, not reasoned about: 59 dated citations
// exist in this tree and the ones under docs/ outnumber the declarations.
//
// So resolution is to a REGISTRY DECLARATION, which is structural rather than
// prose, and there are exactly two shapes:
//
//   an ADR heading      `## ADR-nnn: <title>  (YYYY-MM-DD, status: ...)`
//   a gates/ filename   docs/decisions/gates/<slug>-YYYY-MM-DD.md
//
// Both are places a ruling is DECLARED. Neither can be produced by writing a
// sentence that cites one.
//
// -----------------------------------------------------------------------------
// WHAT IT CANNOT SEE, STATED RATHER THAN IMPLIED
// -----------------------------------------------------------------------------
// THE SHARPEST LIMITATION FIRST, BECAUSE IT IS THE ONE A READER WOULD OTHERWISE
// ASSUME AWAY: this gate would NOT have caught the defect that commissioned it.
// 2026-08-17 carries three declared rulings (ADR-050, ADR-051, ADR-052), so a
// citation naming that date resolves. What was wrong was not that the date had
// no ruling; it was that the rulings it has DO NOT SAY WHAT THE CITATION
// CLAIMED. This gate checks that a cited authority EXISTS. It cannot check that
// the authority says what the citation says it says, because that is a reading
// of two documents against each other and no regex performs it.
//
// THE ASSERTION THAT WOULD HAVE CAUGHT IT is one step stronger: a citation must
// name the ruling (`ADR-nnn` or a `gates/` file) and not merely its date, so the
// claim can be checked against the document it rests on. IT IS NOT WRITTEN HERE
// AND THE REASON IS A MEASUREMENT: 28 of the 59 dated citations name no ruling,
// and they sit in GLOSSARY, API_CONTRACT, INFRA, OVERVIEW, SECURITY, DATA_MODEL
// and nine ADRs. Every one of those is frozen, so the cleanup is an ADR and a
// session rather than a gate, and a gate that fails on arrival is a gate
// somebody switches off. It is declared here in the idiom the letter table used
// for its own duplicate-row check: named, measured, and blocked on a cleanup.
//
// A PARAPHRASE IS OUT OF REACH. "as the founder decided last Tuesday", "per the
// gate call", or a citation with the date spelled in words matches nothing here.
// The gate reads one written form and claims no more than that form.
//
// THE NEEDLE IS ASSEMBLED FROM FRAGMENTS so this file is not itself a finding
// when the gate scans the repository it lives in. That is RI-02's idiom in
// packages/tooling, which matched its own prose twice, and the alternative
// considered and rejected there was a by-name exclusion for the file that
// defines the check: a hole in exactly the place a hole is least visible.

const ISO_DATE_SOURCE = '20\\d{2}-[01]\\d-[0-3]\\d';

/** The cited form, assembled so the pattern cannot match its own definition. */
const CITED_RULING_SOURCE =
  ['found', 'er'].join('') + '[- ]' + ['rul', 'ing'].join('') + '[^.\\n]{0,40}?';

/** Every date on which a ruling is DECLARED by a registry file. */
function declaredRulingDates() {
  const dates = new Set();
  const iso = new RegExp(ISO_DATE_SOURCE, 'g');

  const decisions = 'docs/decisions';
  for (const file of readdirSync(join(ROOT, decisions)).filter((f) => /^ADR-\d+\.md$/.test(f))) {
    // The heading's parenthetical, which is where every ADR in this corpus
    // carries its date. A date in an ADR's BODY declares nothing: ADR-052's body
    // cites 2026-08-16 while ruling on 2026-08-17.
    for (const lineText of read(join(decisions, file)).split('\n')) {
      if (!lineText.startsWith('## ADR-')) continue;
      const paren = /\(([^)]*)\)\s*$/.exec(lineText.trim());
      if (paren === null) continue;
      for (const m of paren[1].matchAll(iso)) dates.add(m[0]);
      break;
    }
  }

  const gatesDir = join(decisions, 'gates');
  if (existsSync(join(ROOT, gatesDir))) {
    for (const file of readdirSync(join(ROOT, gatesDir))) {
      for (const m of file.matchAll(iso)) dates.add(m[0]);
    }
  }

  return dates;
}

const ci06q = {
  id: 'CI-06q',
  title: 'Every dated citation of a founder ruling resolves to a declared ruling',
  covers:
    'CITED AUTHORITY EXISTS. Every dated reference to a ruling by the founder, in ' +
    'any .md, .ts or .mjs under docs/, scripts/ or packages/, names a date on which ' +
    'a ruling is DECLARED by a registry file: an ADR whose heading parenthetical ' +
    'carries that date, or a file under docs/decisions/gates/ whose filename does. ' +
    'Resolution is deliberately NOT "some document mentions the date", because the ' +
    'citations then satisfy each other and the gate passes on the defect it exists ' +
    'for. ' +
    'IT WOULD NOT HAVE CAUGHT THE DEFECT THAT COMMISSIONED IT, and that is the ' +
    'limitation to read first: the miscited date HAS declared rulings, and what was ' +
    'wrong is that they do not say what the citation claimed. This gate checks that ' +
    'an authority EXISTS, never that it says what is attributed to it. The stronger ' +
    'assertion (a citation must NAME its ruling, not just date it) is declared in ' +
    'this file and not written, because 28 of 59 citations would fail it today and ' +
    'they sit in frozen documents. ' +
    'A PARAPHRASE IS OUT OF REACH: only one written form is read, so an undated ' +
    'reference, a date spelled in words, or "as the founder decided last week" ' +
    'matches nothing and is claimed as nothing.',
  run() {
    const findings = [];
    const declared = declaredRulingDates();

    // A check that resolved against an empty set would call every citation a
    // finding, which reads as 59 defects rather than as a broken check.
    if (declared.size === 0) {
      throw new Error(
        'no declared ruling dates were parsed from docs/decisions; CI-06q cannot run, ' +
          'and resolving every citation against an empty set would report the whole ' +
          'corpus as unresolved rather than reporting itself as broken',
      );
    }

    const cited = new RegExp(CITED_RULING_SOURCE + '(' + ISO_DATE_SOURCE + ')', 'g');
    let scanned = 0;
    let citations = 0;

    for (const rel of allFiles()) {
      if (!/^(docs|scripts|packages)\//.test(rel)) continue;
      if (!/\.(md|ts|mjs)$/.test(rel)) continue;
      scanned++;
      const lines = read(rel).split('\n');
      lines.forEach((lineText, i) => {
        for (const m of lineText.matchAll(cited)) {
          citations++;
          const date = m[1];
          if (declared.has(date)) continue;
          findings.push(
            `${rel}:${i + 1}: cites a ruling dated ${date}, and no registry file ` +
              'declares one on that date. A ruling is declared by an ADR heading ' +
              'parenthetical or by a file under docs/decisions/gates/; a document merely ' +
              'mentioning the date is another citation, not the authority. Either the ' +
              'ruling is unrecorded and needs writing down, or the citation is ' +
              'attributing a decision to an authority that does not exist',
          );
        }
      });
    }

    // TWO WAYS THIS GATE COULD GO QUIET, BOTH REFUSED. A glob that stopped
    // matching, and a needle that stopped matching, produce the same clean
    // result as a corpus with no defect in it.
    if (scanned < 100) {
      throw new Error(
        `CI-06q scanned ${scanned} file(s), which is far below this corpus's size; ` +
          'the file filter has stopped matching and the gate is asserting about a ' +
          'tree it did not read',
      );
    }
    if (citations === 0) {
      throw new Error(
        'CI-06q found no dated citation anywhere in the corpus. This corpus is built ' +
          'on recorded rulings and cites them constantly, so zero means the needle has ' +
          'stopped matching rather than that the citations are gone',
      );
    }

    return findings;
  },
};

// -----------------------------------------------------------------------------
// CI-06r  AN ADR'S HEADING STATUS AGREES WITH ITS OWN BODY
// -----------------------------------------------------------------------------
// The twelfth instance of one class: A FACT CARRIED IN PROSE INSIDE A REGISTRY,
// and this time inside the registry ADR-034 and ADR-036 were written to protect.
//
// ADR-006, ADR-007 and ADR-008 each head themselves `status: proposed` while
// carrying, at their own line 6, `Founder approval (2026-08-13): ACCEPTED`, and
// the M1 gate closure records the founder accepting all three on that date.
// SEVENTEEN OF SEVENTEEN GATES PASSED OVER IT, and neither of the two that look
// at ADRs was ever going to catch it: `CI-06f` reads numbers and gaplessness and
// never status, and `CI-06b` validates FRONTMATTER while an ADR entry carries
// its status in a HEADING. A registry entry that contradicts itself in the one
// field a reader scans for is exactly what a registry gate is for.
//
// ONLY ONE DIRECTION OF THE OBVIOUS PAIR IS ASSERTED, AND THE OTHER IS REFUTED
// BY THE TREE RATHER THAN DEFERRED. The symmetric rule reads well and is false:
// "an entry heading itself `accepted` must carry an approval line" fails on
// THIRTY-FOUR entries today (ADR-005, ADR-018 to ADR-032, ADR-034, ADR-037 to
// ADR-049, ADR-051, ADR-D1), and every one of them is legitimate. Those
// approvals live in the gate-closure records under docs/decisions/gates/, which
// is where this corpus has recorded a batch sign-off from the beginning. So the
// asymmetry is a fact about how approval is recorded rather than an omission:
// AN ENTRY WITH NO APPROVAL LINE CLAIMS NOTHING, and an entry claiming an
// acceptance while heading itself unapproved contradicts itself. Writing the
// symmetric half would have gone red on arrival on thirty-four files whose only
// available repair is to invent thirty-four founder signatures, and STATE's own
// sentence is that a gate which fails on arrival is a gate somebody switches off.
//
// AN APPROVAL LINE IS A NEEDLE PLUS A VERDICT, and both halves are load bearing.
// `docs/decisions/ADR-047.md:26` reads "**Founder approval as an `admin_actions`
// row carrying the report digest**", which is a step in a protocol the ADR
// specifies rather than a verdict on the ADR itself, and four other entries
// carry a bare `**Founder ruling.**` as a section header. A needle-only match
// reads all five as approvals. Requiring a token from the CLOSED vocabulary
// below is what separates a recorded verdict from prose about verdicts, and a
// line carrying the needle and no token is deliberately claimed as nothing.
const ADR_STATUS_HEADING =
  /^## (ADR-(?:\d{3}|D\d+)):[^\n]*?\(\s*[^()]*?status:\s*([a-z]+)\s*\)\s*$/gm;
const APPROVAL_NEEDLE = /founder\s+(?:approval|ruling)/i;

// UPPERCASE ONLY, WHICH IS THE CORPUS'S OWN FORM AND IS THE TIGHTER READING.
// Every recorded verdict in docs/decisions is written in capitals; lowercase
// "approved" appears inside ordinary prose (ADR-018's "`w=3` approved") and
// matching it would read a sentence as a signature.
const ACCEPTING_VERDICTS = ['ACCEPTED', 'GRANTED', 'ADOPTED', 'APPROVED'];
const OPEN_VERDICTS = ['PENDING', 'DECLINED', 'REJECTED', 'WITHDRAWN', 'SUPERSEDED'];

/**
 * Every approval line in one entry body, with the verdict it records.
 *
 * A LINE MAY CARRY BOTH, AND THE ACCEPTANCE WINS. ADR-052, ADR-054 and ADR-055
 * each carry a `GRANTED` line and, below it, the `PENDING` line as it stood when
 * the ruling was proposed, kept deliberately so the record reads against itself.
 * A file holding both is approved with its history intact, so an entry is read
 * as accepted when ANY of its lines accepts.
 */
function approvalLines(body) {
  const out = [];
  body.split('\n').forEach((line, i) => {
    if (!APPROVAL_NEEDLE.test(line)) return;
    const accepting = ACCEPTING_VERDICTS.filter((v) => line.includes(v));
    const open = OPEN_VERDICTS.filter((v) => line.includes(v));
    if (accepting.length === 0 && open.length === 0) return;
    out.push({ line: i + 1, accepting, open, text: line.trim() });
  });
  return out;
}

// CI-06s  Every probe is run and pinned
// -----------------------------------------------------------------------------
// OI-07 HAS NOW HAPPENED FOUR TIMES AND THE FOURTH WAS LIVE ON MAIN WHEN THIS
// GATE WAS WRITTEN. `probe_rule_states_high_water_bound.sql` was on disk, was
// wired at corpus.yml, and the string `high_water_bound` appeared NOWHERE in
// this file. STATE records the first three: `probe_payout_hold.sql` was wired
// and never pinned, so it had been one delete away from being OI-07 again since
// the day it landed, and `probe_reversible_contact_addresses.sql` then made the
// identical omission and was caught before merge only by a human reading the
// diff. STATE's own words: "Three occurrences is a pattern: the fix is a gate
// asserting that every scripts/db/probe_*.sql on disk is both run and pinned."
//
// WIRING A PROBE AND PINNING IT ARE TWO EDITS IN TWO FILES, and that is the
// whole mechanism. The workflow step makes it run; CI-06h's needle makes
// deleting the step a gate failure. A probe with the first and not the second
// runs until somebody tidies the workflow, and then stops running silently.
//
// -----------------------------------------------------------------------------
// THE STALE DIRECTION IS THE HALF THAT EARNS THE GATE
// -----------------------------------------------------------------------------
// A needle naming a probe no file provides is a finding too. CI-06l's record
// says why in the words this gate is built on: the stale-entry checks are the
// ones that earn it, because they run in the direction nobody looks. A LIST
// NAMING SOMETHING THAT NO LONGER EXISTS STILL LOOKS COMPLETE. Renaming a probe
// and updating only the workflow leaves CI-06h pinning a filename that cannot
// be deleted because it is already gone, and every gate stays green.
//
// -----------------------------------------------------------------------------
// IT MATCHES THE STEP, NOT THE MENTION, AND THE NEAR-MISS IS REAL
// -----------------------------------------------------------------------------
// The probes are invoked as `psql ... -f scripts/db/probe_*.sql`. A parser that
// matched any mention of a filename in the workflow would also match its
// COMMENTS, and corpus.yml carries `rule_states_high_water_bounds_balance` in a
// comment three lines above the step that runs
// `probe_rule_states_high_water_bound.sql`. Those are different strings --
// `bounds_balance` against `bound` -- and a loose parser reading either one
// would have reported the probe as wired for the wrong reason. This is the
// span-parser class CI-06g and CI-06n have each met.
//
// AND THE PINNED SIDE IS READ FROM CI-06h's BLOCK ALONE, not from this file as
// a whole, because this file mentions probe filenames in the prose above. A
// gate that counted its own comment as a pin would report every probe pinned
// the moment it was written, which is the same defect one level up.
const ci06s = {
  id: 'CI-06s',
  title: 'Every probe on disk is run by the workflow and pinned by CI-06h',
  covers:
    'A PROBE IS RUN AND PINNED, IN BOTH DIRECTIONS. Every scripts/db/probe_*.sql ' +
    'on disk appears as a psql STEP in .github/workflows/corpus.yml and as a ' +
    "needle in CI-06h's required list, and every probe filename that list names " +
    'exists on disk. ' +
    'IT MATCHES THE STEP AND NOT THE MENTION: the needle is the `-f ' +
    'scripts/db/<file>` argument of a psql invocation, so a filename appearing ' +
    'only in a workflow comment is claimed as nothing. corpus.yml names ' +
    '`rule_states_high_water_bounds_balance` in a comment three lines above the ' +
    'step running `probe_rule_states_high_water_bound.sql`, which is the ' +
    'near-miss a loose parser reads as coverage. ' +
    "THE PINNED SIDE IS READ FROM CI-06h's BLOCK ALONE, because this file names " +
    'probe filenames in its own prose and a gate counting its own comment as a ' +
    'pin would report every probe pinned on the day it was written. ' +
    'WHAT IT CANNOT SEE: whether the probe asserts anything. A file that is run ' +
    'and pinned and contains one comment passes here. Coverage of what a probe ' +
    "proves is DELTA_MANIFEST section 13's success-case discipline and no parse " +
    'reaches it. No database.',
  run() {
    const findings = [];
    const probeDir = 'scripts/db';
    const workflow = '.github/workflows/corpus.yml';

    const onDisk = existsSync(join(ROOT, probeDir))
      ? readdirSync(join(ROOT, probeDir))
          .filter((f) => /^probe_[a-z0-9_]+\.sql$/.test(f))
          .sort()
      : [];

    // The STEP. `-f` is what makes it an invocation rather than a sentence.
    const wired = new Set();
    if (existsSync(join(ROOT, workflow))) {
      const wf = read(workflow);
      for (const m of wf.matchAll(/psql\b[^\n]*?-f\s+scripts\/db\/(probe_[a-z0-9_]+\.sql)/g)) {
        wired.add(m[1]);
      }
    } else {
      findings.push(`${workflow} is missing, so no probe is run at all`);
      return findings;
    }

    // CI-06h's block, bounded. `const ci06h = {` to the next top-level `const`
    // gate declaration, so this gate's own prose is outside the window.
    const self = read('scripts/corpus/gates.mjs');
    const from = self.indexOf('\nconst ci06h = {');
    // The NEXT top-level gate declaration, whichever letter it is. Naming one
    // would be wrong the day a session inserts a gate between them, and the
    // declarations are not in alphabetical order: ci06i precedes ci06h today.
    const after = from === -1 ? -1 : self.slice(from + 1).search(/\nconst ci06[a-z] = \{/);
    const to = after === -1 ? self.length : from + 1 + after;
    const pinned = new Set();
    if (from !== -1) {
      for (const m of self.slice(from, to).matchAll(/'(probe_[a-z0-9_]+\.sql)'/g)) {
        pinned.add(m[1]);
      }
    }

    for (const probe of onDisk) {
      if (!wired.has(probe)) {
        findings.push(
          `${probeDir}/${probe} exists and no step in ${workflow} runs it. A probe ` +
            `that ships beside a fix and never runs again is the same object as the ` +
            `golden test that was missing (OI-07). Add a psql step for it`,
        );
      }
      if (!pinned.has(probe)) {
        findings.push(
          `${probeDir}/${probe} is not pinned by CI-06h's required-needle list, so ` +
            `deleting its workflow step would be a silent change rather than a gate ` +
            `failure. THIS IS OI-07's SHAPE and it has occurred four times. Add the ` +
            `filename to the list in ci06h's run()`,
        );
      }
    }

    // The stale direction: a list naming something that no longer exists still
    // looks complete.
    for (const probe of [...pinned].sort()) {
      if (!onDisk.includes(probe)) {
        findings.push(
          `CI-06h pins ${probe} and no file provides it. The needle asserts a step ` +
            `nobody can delete because the probe is already gone, so CI-06h passes ` +
            `while proving nothing about it. Remove the needle or restore the probe`,
        );
      }
    }
    for (const probe of [...wired].sort()) {
      if (!onDisk.includes(probe)) {
        findings.push(
          `${workflow} runs ${probeDir}/${probe} and no such file exists, so the ` +
            `migrations job fails at that step rather than proving anything`,
        );
      }
    }

    // Sentinels. Each zero means a parser stopped matching, and every probe
    // would then pass for the wrong reason.
    if (onDisk.length === 0) {
      throw new Error(
        `CI-06s found no probe under ${probeDir}. This repository has carried ` +
          'probes since 0028, so zero means the directory or the naming has moved ' +
          'and this gate is asserting about a tree it did not read',
      );
    }
    if (wired.size === 0) {
      throw new Error(
        `CI-06s matched no psql probe step in ${workflow}. Zero means the step ` +
          'form has moved, at which point every probe reads as unwired and the ' +
          'findings above are noise rather than evidence',
      );
    }
    if (pinned.size === 0) {
      throw new Error(
        "CI-06s read no probe filename out of CI-06h's block. Zero means the " +
          'block bounds or the needle form have moved, and every probe would then ' +
          'report as unpinned',
      );
    }

    return findings;
  },
};

const ci06r = {
  id: 'CI-06r',
  title: "An ADR's heading status agrees with the verdict recorded in its own body",
  covers:
    'AN ADR ENTRY IS READ AGAINST ITSELF. An entry whose body records a founder ' +
    'verdict of ACCEPTED, GRANTED, ADOPTED or APPROVED may not head itself ' +
    '`status: proposed`. That is the state ADR-006, ADR-007 and ADR-008 were in ' +
    'while seventeen gates passed, because CI-06f reads ADR numbers and never ' +
    'status and CI-06b validates frontmatter while an ADR carries its status in a ' +
    'heading. ' +
    'IT COMPARES A FILE WITH ITSELF AND CAN CHECK NEITHER HALF AGAINST THE GATE ' +
    'RECORD, which is the boundary to read first and is the same one CI-06q ' +
    'states one row above it. An entry that heads itself `accepted` while no ' +
    'founder ever signed it passes here and always will, and so does an entry ' +
    'whose approval line names a date on which nothing was ruled. What this gate ' +
    'proves is that a reader scanning the heading and a reader reading the body ' +
    'reach the same answer; whether that answer is TRUE is a question about the ' +
    'gate-closure records under docs/decisions/gates/ that no file-local check ' +
    'can reach. ' +
    'THE SYMMETRIC HALF IS DELIBERATELY NOT ASSERTED AND IS REFUTED RATHER THAN ' +
    'DEFERRED. "An entry heading itself accepted must carry an approval line" is ' +
    'false of this corpus: 34 entries head accepted and carry none, legitimately, ' +
    'because their approvals are recorded in the gate-closure files where batch ' +
    'sign-offs have always lived. An entry with no approval line claims nothing ' +
    'and cannot contradict itself. ' +
    'A VERDICT IS A CLOSED UPPERCASE VOCABULARY and a founder-approval needle ' +
    'carrying no token from it is claimed as nothing, so a protocol step that ' +
    'uses the words (ADR-047 line 26) and a bare "Founder ruling." section header ' +
    'are both out of reach, on purpose.',
  run() {
    const findings = [];
    let entries = 0;
    let approvals = 0;

    for (const file of adrFiles()) {
      const body = read(file);
      const lines = approvalLines(body);
      approvals += lines.length;

      for (const m of [...body.matchAll(ADR_STATUS_HEADING)]) {
        entries++;
        const [, id, status] = m;
        if (status !== 'proposed') continue;

        const accepted = lines.filter((l) => l.accepting.length > 0);
        if (accepted.length === 0) continue;

        const at = accepted[0];
        findings.push(
          `${file}: ${id} heads itself \`status: proposed\` and its own line ${at.line} ` +
            `records the founder's verdict as ${at.accepting.join(' and ')}. The signature ` +
            `exists and the status word is what is stale: correct the heading to ` +
            `\`accepted\`, citing the record that carries the verdict. ` +
            `The line reads: ${JSON.stringify(at.text.slice(0, 160))}`,
        );
      }
    }

    // Two sentinels, and they fail differently on purpose. A parser that stopped
    // matching headings would report nothing and look like a clean corpus, which
    // is CI-06f's `adrEntries` defect one gate over: the assertion was there for
    // thirty entries and the parser could not reach it.
    if (entries === 0) {
      throw new Error(
        'CI-06r parsed no ADR heading carrying a status. Every entry in ' +
          'docs/decisions carries one today, so zero means the heading form has ' +
          'moved and this gate is asserting about a tree it did not read',
      );
    }
    if (approvals === 0) {
      throw new Error(
        'CI-06r found no founder-approval line anywhere in docs/decisions. This ' +
          'registry records verdicts constantly, so zero means the needle or the ' +
          'verdict vocabulary has stopped matching and every proposed entry would ' +
          'pass for the wrong reason',
      );
    }

    return findings;
  },
};

// -----------------------------------------------------------------------------
// CI-06t  EVERY GENERATED SPAN IS CLOSED BEFORE THE NEXT ONE OPENS
// -----------------------------------------------------------------------------
// THIS COMMENT NAMES THE TOKENS AND NEVER SPELLS THEM, and that is not fussiness:
// a document describing this gate is a document carrying the defect unless it is
// careful. The reservation row for this very letter spelled an opener out while
// reserving a gate against spelling openers out, and CI-06g caught it within the
// minute. So: an OPENER is the `gen:` comment naming a span, and a CLOSER is its
// partner. Neither appears literally anywhere in this file; the seed in
// falsify.mjs assembles them, which is the one place a literal is unavoidable.
//
// THE DEFECT. On 2026-08-18 a planning session appended a section to STATE.md and
// CI-06g failed, reporting that the `ec_count` span "reads" ten thousand
// characters of unrelated prose. THE CAUSE WAS TWO DAYS OLD AND HAD BEEN PASSING.
// A line described a falsify.mjs seed by spelling an opener out and never closing
// it. `spansIn` matches an opener only when a closer follows it, so an opener
// with nothing after it MATCHES NOTHING AND IS SKIPPED IN SILENCE. It was
// invisible for exactly as long as it was the last such token in the file, and
// the first append below it supplied the closer it had been waiting for. The
// stale opener then paired with the NEW span's closer and swallowed everything
// between, including that span's own opener.
//
// SO A TOTAL COUNT OF OPENERS AGAINST CLOSERS IS NOT THIS CHECK, and the
// distinction is the whole gate. A file can hold equal numbers of each and still
// be wrong: `docs/sessions/2026-08-15-session-30.md` opened twice on one line
// with neither closed while a third sat unclosed above it, and any balance-count
// reading would have to see three closers appear later to call it a finding.
// What matters is ORDER: each opener is followed by its closer BEFORE ANY OTHER
// OPENER APPEARS, which is what makes the non-greedy pair in `spansIn` mean what
// it looks like it means.
//
// FOURTH INSTANCE OF THE SPAN-PARSER CLASS, and this gate is a reader too, which
// is the honest thing to say about it. CI-06n's parser matched a prose mention
// rather than a table row (`OI-09`); CI-06g's own falsify seed hardcoded the
// value it was checking; and `registryIds()` re-implemented the `gs_count` query
// instead of calling it. Each was a reader looser or narrower than the property
// it claimed. This one is narrower than "the spans are correct" on purpose: it
// says nothing about a span's NAME or its CONTENT, which is CI-06g's half.
//
// THE DOCUMENT SET IS `markdownFiles()`, WHICH IS CI-06g's, AND NOT
// `isCorpusDocument`. That is a deliberate choice against the obvious reuse.
// `isCorpusDocument` is `CI-06b` and `CI-06c`'s shared reader under `OQ-P1-04`,
// and it answers "is this a thing with a gateable status and an INDEX row" --
// a different question. This gate exists to protect ONE parser, `spansIn`, and
// the population at risk is exactly the population that parser reads, which is
// every markdown file. Guarding a narrower set than the reader you are
// protecting is how a gate ends up green over the file that breaks. Two of the
// four real sites found on arrival sit in `docs/sessions/`, which both readers
// cover; the third sat under `docs/decisions/gates/`, which `isCorpusDocument`
// excludes as a registry entry and `markdownFiles()` does not.

/**
 * Span tokens in one document, in the order they appear, with the code fences
 * masked exactly as `spansIn` masks them.
 *
 * THE MASKING IS NOT OPTIONAL AND IS NOT DEFENSIVE. STRATEGY's own CI-06g
 * section carries a worked example of a span inside a fence, and a scan that
 * did not mask would report the document explaining the gate as a violation of
 * it. Sharing the mask with `spansIn` is what makes "quoted" mean one thing.
 */
function spanTokens(body) {
  const masked = body.replace(/^```[\s\S]*?^```/gm, (block) => block.replace(/</g, '\0'));
  // Assembled rather than spelled, for the reason the block comment above gives.
  const OPENER = new RegExp(`<!--${'gen'}:([a-z0-9_]+)-->`, 'g');
  const CLOSER = new RegExp(`<!--/${'gen'}-->`, 'g');
  const at = (i) => masked.slice(0, i).split('\n').length;
  const tokens = [];
  for (const m of masked.matchAll(OPENER))
    tokens.push({ kind: 'opener', at: m.index, line: at(m.index), name: m[1] });
  for (const m of masked.matchAll(CLOSER))
    tokens.push({ kind: 'closer', at: m.index, line: at(m.index) });
  // Two sweeps and one sort rather than one alternating pattern, because a
  // single regex would have to name both forms and the sort is the cheap half.
  //
  // SORTED BY CHARACTER OFFSET AND NOT BY LINE, and the first draft of this
  // function sorted by line and reported fifty findings against a clean tree.
  // INDEX.md carries three spans on ONE line and STRATEGY carries two; a
  // line-keyed sort with an opener-first tiebreak reads those as three openers
  // followed by three closers, which is the exact shape this gate calls a
  // finding. A reader looser or narrower than the property it claims is the
  // class this gate is the fourth instance of, and it was the fifth for about a
  // minute.
  return tokens.sort((a, b) => a.at - b.at);
}

const ci06t = {
  id: 'CI-06t',
  title: 'Every generated span is closed before the next one opens',
  covers:
    'SPAN BALANCE, READ AS ORDER RATHER THAN AS A COUNT. In every markdown file, ' +
    'each generated-span opener is followed by its closer BEFORE ANY OTHER OPENER ' +
    'APPEARS, and a closer with no opener before it is a finding. ' +
    'A TOTAL COUNT OF OPENERS AGAINST CLOSERS IS NOT THIS CHECK and would have ' +
    'passed on the defect that commissioned it. CI-06g reads a span by matching ' +
    'an opener to the next closer anywhere after it, so an opener with no closer ' +
    'after it matches NOTHING and is skipped in silence, and the moment a later ' +
    'span supplies a closer the stale opener swallows everything between them, ' +
    'including that later span own opener. That is a defect which passes for as ' +
    'long as it is the last such token in the file and fails on the next append. ' +
    'IT SAYS NOTHING ABOUT A SPAN NAME OR ITS CONTENT, which is CI-06g half. A ' +
    'perfectly balanced file whose every span holds a stale number passes here ' +
    'and is CI-06g finding, and the two gates are deliberately not merged so ' +
    'that neither is taken on trust for the other. ' +
    'IT READS markdownFiles(), WHICH IS CI-06g OWN SET, and deliberately not ' +
    'isCorpusDocument: the population at risk is exactly the population the ' +
    'parser being protected reads, and one of the four real sites found on ' +
    'arrival sat in a directory isCorpusDocument excludes. ' +
    'IT IS A READER TOO, which is the fourth instance of that class here and is ' +
    'stated rather than left to be discovered. Code fences are masked with the ' +
    'same expression CI-06g uses, so a worked example of a span inside a fence ' +
    'is quoted rather than counted; a token constructed at runtime, or split ' +
    'across a line, is out of reach and is claimed as nothing.',
  run() {
    const findings = [];
    let documents = 0;
    let tokens = 0;

    for (const file of markdownFiles()) {
      const found = spanTokens(read(file));
      if (found.length === 0) continue;
      documents++;
      tokens += found.length;

      let open = null;
      for (const token of found) {
        if (token.kind === 'opener') {
          if (open) {
            findings.push(
              `${file}:${token.line}: span "${token.name}" opens while "${open.name}" ` +
                `(line ${open.line}) is still unclosed. CI-06g will pair the earlier opener ` +
                `with a LATER closer and read everything between them as its content. Name ` +
                `the span rather than spelling its opener, which is the repair STATE.md took`,
            );
          }
          open = token;
        } else {
          if (!open) {
            findings.push(
              `${file}:${token.line}: a span closer with no opener before it. Either the ` +
                `opener was deleted and its closer left behind, or a document is quoting a ` +
                `closer outside a code fence`,
            );
          }
          open = null;
        }
      }
      if (open) {
        findings.push(
          `${file}:${open.line}: span "${open.name}" opens and is never closed. IT IS ` +
            `INVISIBLE TO CI-06g FOR EXACTLY AS LONG AS NOTHING IS APPENDED BELOW IT, ` +
            `and the first section added after it supplies the closer it has been waiting ` +
            `for. Name the span rather than spelling its opener`,
        );
      }
    }

    // The sentinel, and it fails differently from a finding on purpose. This
    // gate reports nothing on a corpus with no spans in it and on a corpus
    // whose token pattern has stopped matching, and those two are not the same
    // fact. `CI-06g` carries the identical guard for the identical reason.
    if (documents === 0 || tokens === 0) {
      throw new Error(
        'CI-06t found no generated-span token in any markdown file. This corpus ' +
          'carries them in INDEX, STATE, STRATEGY and several session logs, so zero ' +
          'means the token pattern has stopped matching and every unbalanced document ' +
          'in the tree would pass for the wrong reason',
      );
    }

    return findings;
  },
};

// -----------------------------------------------------------------------------
// CI-06u  No markdown table in docs/ has two rows with the same first-cell key
// -----------------------------------------------------------------------------
// THE DEFECT IS THE MERGE, AND THE GATE IS NOT A BETTER MERGE SCRIPT. The review
// desk resolves conflicts KEEP-BOTH and then dedupes only lines longer than 60
// characters that are byte-identical after comment stripping. Two sessions
// appending to the same markdown table do not produce two appended rows: they
// produce a copy of every row the table ALREADY HAD, and every copy carrying a
// different link, a different count or a different wording is under the dedupe's
// reach and survives. Three occurrences are on record before this gate:
// `ADR-050` twice in the decisions README with DIFFERENT titles, fourteen `CI-06`
// rows in STRATEGY, and duplicated passages in STATE recorded as `OI-10`.
//
// ONLY ONE OF THE THREE WAS CAUGHT BY A GATE, and it was caught by accident.
// `CI-06p` asserts that each `CI-06<letter>` heads at most one row of STRATEGY
// section 4.4, because that is the table it was written for. The defect is not
// table-specific and neither is the remedy: a merge script runs on one machine
// under one operator, a gate runs on every pull request. This is `CI-06p`'s
// first assertion, generalised to every table in `docs/`.
//
// -----------------------------------------------------------------------------
// SCOPE, WHICH WAS SURVEYED BEFORE THE ASSERTION WAS WRITTEN
// -----------------------------------------------------------------------------
// The survey of 2026-08-19 read 861 tables and 6,693 body rows on a clean `main`
// and found 211 repeated first cells in 12 files. They are TWO POPULATIONS and
// the gate would be useless if it conflated them.
//
// FIRST: tables whose first column is a DIMENSION and not an identity. A
// transition table's row is keyed by (From, To, Guard) and many transitions
// leave one state; a STRIDE table's first cell is one of six threat categories
// by construction. Repetition there is the shape of the table, not damage to it,
// and no amount of merging makes it a defect. Those are exempted BY THE HEADER
// OF THE FIRST COLUMN, in `DIMENSION_HEADERS` below, one entry per shape with
// the table that earns it named.
//
// SECOND: tables whose first column IS a key, where a repeat means the registry
// can no longer answer the question it exists to answer. 105 of those survive
// the exemptions, in 8 files, and THREE OF THE PAIRS CONTRADICT EACH OTHER:
// `G-ELIGIBLE` in STATE_MACHINES is defined once as `identities.status <>
// 'restricted'` and once as `identities.status = 'active'`, both citing ADR-041,
// on the money path; INDEX gives `M05` two different purposes; STATE says both
// `21` checks and `Eleven`. `docs/sessions/README.md` carries the ENTIRE session
// index twice, one copy truncated at session 62.
//
// THE 105 ARE REGISTERED RATHER THAN EXEMPTED, and the difference is the whole
// design. `falsify.mjs` runs every gate against the tree as it stands and a gate
// that cannot pass there is an ERROR, so a gate landing red on 105 findings
// cannot land at all. The register pins the exact (file, key) pairs that exist
// on `main` today. A NEW duplicate is a finding. And a register entry that no
// longer names a real duplicate is ALSO a finding, so a repair forces the
// register down by one rather than leaving an exemption behind it. That is the
// direction an allowlist has to decay in; `CI-06l` states the same rule about
// its own exemption list, and `CI-06e` prints its accepted set on every run for
// the same reason this one prints its register size.
//
// FIVE THINGS IT DOES NOT DO, written here rather than left to be discovered.
//   1. IT READS THE FIRST CELL AND NOTHING ELSE. Two rows with the same key and
//      identical content are the same finding as two that contradict, and this
//      gate cannot tell them apart. Which of a contradictory pair is TRUE is a
//      question for a founder ruling, never for a parse.
//   2. THE SCOPE JUDGMENT IS RECORDED, NOT DERIVED. `DIMENSION_HEADERS` is a
//      reading of six table shapes by a session. A NEW table whose first column
//      is a dimension under a header not in that list is a false finding, and
//      the remedy is to add the header WITH ITS ARGUMENT, never to relax the
//      matching. The list decays loudly, which is the safe direction: a stale
//      exemption matching no table is reported.
//   3. THE REGISTER IS PER (FILE, KEY), NOT PER TABLE. A key duplicated in two
//      different tables of one file is one register entry, so repairing one of
//      the two tables does not shrink the register. It is the coarser grain on
//      purpose: a per-table register would key on a line number and go stale on
//      every edit above it.
//   4. IT INHERITS THE TWO-REF GAP `CI-06f`, `CI-06h` and `CI-06p` each declare.
//      A pull request appending a row that a sibling branch has already appended
//      is the exact defect this gate is for, and this run sees ONE ref. It
//      catches the duplication when the branches merge, which is one merge later
//      than anybody would like and is still before `main`.
//   5. A ROW SPLIT ACROSS LINES IS OUT OF REACH. A table cell carrying a literal
//      newline is not expressible in GitHub-flavoured markdown, so this is a
//      boundary of the format rather than of the parser, but a row whose leading
//      `|` is indented past a list marker parses as prose here and is claimed as
//      nothing.
const CI06U_DOCS = 'docs/';

// A first column whose header names a DIMENSION rather than an IDENTITY. Each
// entry is one argued table shape, and each is only here because the survey
// found it firing.
const DIMENSION_HEADERS = new Map([
  // STATE_MACHINES's transition tables. A row is keyed by (From, To, Guard) and
  // `active` has four outgoing edges. The GUARD table in the same file is NOT
  // exempt and is where ten of the 105 are.
  ['from', 'STATE_MACHINES transition tables: a row is keyed by (From, To, Guard)'],
  // SECURITY's STRIDE tables. S/T/R/I/D/E is a six-value category and section
  // 2.6 alone lists four spoofing scenarios.
  ['threat', 'SECURITY STRIDE tables: the first cell is one of six threat categories'],
  // WAVE-01's session table. Rank is a priority band holding six sessions.
  ['rank', 'WAVE-01: a priority band, many sessions to a rank'],
  // Session 58's before/after table. Group is A / F / H over golden scenarios.
  ['group', 'session logs: a grouping column over the rows being reported'],
  // STATE's citation tables. `0007_accounts.sql` is cited twice for two
  // different claims, which is what a citation table is for.
  ['source', 'citation tables: one source saying two things is the point of the table'],
  // M02's ingest dedupe matrix. `new` is an INPUT CONDITION, not an identifier.
  ['digest', 'M02 dedupe matrix: the first cell is an input condition'],
]);

// THE REGISTER. Every (file, key) pair whose duplicate exists on `main` as of
// 2026-08-19, surveyed before the assertion was written. NOT ONE OF THESE IS
// ACCEPTED AS CORRECT; each is a repair this session's fence did not reach, and
// each is named in the session log with what the two rows say. The register
// SHRINKS ONLY: an entry that no longer names a duplicate is reported, so the
// day a file is repaired is the day its entry has to go.
const CI06U_REGISTER = new Map([
  // THE SESSIONS INDEX IS NOT A MERGE ARTIFACT AND IS REGISTERED FOR A DIFFERENT
  // REASON. Since session 45 the convention has been that parallel sessions on one
  // day SHARE a number and a log file, each appending its own `##` section: 45, 47
  // and 48 each hold three. So two rows pointing at one file are two ENTRIES, and
  // the row's identity is (file, subject) rather than the file alone. This table
  // has an EMPTY header, so no `DIMENSION_HEADERS` entry can reach it.
  //
  // THAT CONVENTION AND THIS GATE ARE IN CONFLICT AND ONE OF THEM MUST GIVE. A
  // session number naming three different sessions is not an identifier, and
  // WAVE-01 already recorded this registry racing twice with four entries numbered
  // 31. The review desk registered the pair rather than renumbering thirty sessions
  // while resolving a merge. IT IS A RULING THAT IS OWED, not a duplicate to repair,
  // and it is the one register entry here that may legitimately grow before it
  // shrinks.

  // The P1-item table, recorded as OI-10. Its two `CI-06, corpus integrity`
  // rows say `21` checks and `Eleven` checks.
  [
    'docs/STATE.md',
    [
      'ci-01, ci-02, ci-05',
      'ci-03, golden files',
      'ci-04, ci-07 to ci-09',
      'ci-06, corpus integrity',
      'ci-06h, migration install',
      'the monorepo scaffold',
      'the reconciled schema and migrations',
      'tradingcalendar as data',
      'vg-1 to vg-12',
    ],
  ],
  // THE MONEY-PATH TEN ARE REPAIRED AND THIS ENTRY IS GONE, WHICH IS THE
  // DIRECTION THIS REGISTER DECAYS IN. Session 78 read all ten pairs against
  // primary sources: FOUR were contradictions and SIX were copies. The four are
  // ruled in ADR-062 (`G-ELIGIBLE` reads `identities.status = 'active'`,
  // `G-FREEZE-CLEARED` keeps its expiry disjunct, `G-HOLD-REQUIRED` keeps the
  // severity 4+ band, `G-ENFORCEMENT-RESTRICT` requires the investigating-to-
  // enforced path); the six landed as ADR-061 repairs, each keeping one half
  // verbatim. The register loses the file ENTIRELY in the same commit as the
  // repair, so the assertion below now speaks for seven files and not eight.
  // All three allocation tables, the ADR numbers, the migration numbers and the
  // letters. `r` is NOT here: the file argues that duplicate deliberately and
  // the two rows are byte-identical but for one link, so the dedupe reached it.
  // These fifteen carry a reservation row and a merged row for one number,
  // which is exactly the State column ADR-034 deleted, growing back as rows.
  [
    'docs/decisions/ALLOCATION.md',
    [
      '0033',
      '0034',
      '039',
      '040',
      '041',
      '042',
      '043',
      '044',
      '045',
      '046',
      '050',
      '054',
      '055',
      '057',
      '059',
      'k',
      'l',
      'm',
    ],
  ],
  // THE WHOLE SESSION INDEX, TWICE. Lines 120 onward re-list sessions 1 to 74
  // under a second header row, and the first copy stops at session 62. Written
  // out rather than expressed as a range: a range is a rule, and a rule that
  // has to be re-derived on every repair is how a register stops being read.
  [
    'docs/sessions/README.md',
    [
      '2026-08-19 - session 75',
      '2026-08-13 - session 1',
      '2026-08-13 - session 2',
      '2026-08-13 - session 3',
      '2026-08-13 - session 4',
      '2026-08-13 - session 5',
      '2026-08-14 - session 6',
      '2026-08-14 - session 7',
      '2026-08-14 - session 8',
      '2026-08-14 - session 9',
      '2026-08-14 - session 10',
      '2026-08-14 - session 11',
      '2026-08-14 - session 12',
      '2026-08-14 - session 13',
      '2026-08-14 - session 14',
      '2026-08-14 - session 15',
      '2026-08-14 - session 16',
      '2026-08-14 - session 17',
      '2026-08-15 - session 18',
      '2026-08-15 - session 19',
      '2026-08-15 - session 20',
      '2026-08-15 - session 21',
      '2026-08-15 - session 22',
      '2026-08-15 - session 23',
      '2026-08-15 - session 24',
      '2026-08-15 - session 25',
      '2026-08-15 - session 26',
      '2026-08-15 - session 27',
      '2026-08-15 - session 28',
      '2026-08-15 - session 29',
      '2026-08-15 - session 30',
      '2026-08-16 - session 31',
      '2026-08-16 - session 32',
      '2026-08-16 - session 33',
      '2026-08-16 - session 34',
      '2026-08-16 - session 36',
      '2026-08-16 - session 37',
      '2026-08-16 - session 38',
      '2026-08-16 - session 39',
      '2026-08-16 - session 40',
      '2026-08-16 - session 41',
      '2026-08-16 - session 42',
      '2026-08-16 - session 43',
      '2026-08-16 - session 44',
      '2026-08-16 - session 45',
      '2026-08-16 - session 46',
      '2026-08-16 - session 47',
      '2026-08-17 - session 48',
      '2026-08-17 - session 49',
      '2026-08-17 - session 50',
      '2026-08-17 - session 51',
      '2026-08-17 - session 52',
      '2026-08-17 - session 53',
      '2026-08-17 - session 54',
      '2026-08-17 - session 55',
      '2026-08-18 - session 56',
      '2026-08-18 - session 57',
      '2026-08-18 - session 58',
      '2026-08-18 - session 59',
    ],
  ],
]);

// A delimiter row: `|---|---|`, `| :--- | ---: |`. It carries no data and is not
// a body row. A SECOND one inside a table is not skipped quietly by accident --
// it is a keep-both artifact in its own right, and STRATEGY section 4.4 carries
// one today -- but naming it is `CI-06p`'s business, not this gate's.
const isDelimiterRow = (line) => /^\s*\|[\s|:-]*\|\s*$/.test(line) && line.includes('-');

// A table is a MAXIMAL RUN OF CONSECUTIVE `|` LINES carrying at least one
// delimiter row, which is what GitHub renders as one table. Reading a second
// delimiter row as the start of a second table is the reading that makes the
// `docs/sessions/README.md` defect invisible: the duplicate index there sits
// under a re-inserted header, and two tables that happen to be adjacent have no
// duplicate between them.
//
// Fenced blocks are skipped whole. A worked example of a table inside a fence is
// quoted prose, and `CI-06t` masks fences for the same reason.
function markdownTables(body) {
  const lines = body.split('\n');
  const out = [];
  let fence = null;
  let run = null;
  const flush = () => {
    if (run && run.some((r) => isDelimiterRow(r.raw))) out.push(run);
    run = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) {
      if (fence && line.trim().startsWith(fence)) fence = null;
      else if (!fence) fence = f[1];
      flush();
      continue;
    }
    if (fence) continue;
    if (line.trimStart().startsWith('|')) (run ??= []).push({ n: i + 1, raw: line });
    else flush();
  }
  flush();
  return out;
}

// The cells of one row. A pipe escaped as `\|` is content and does not split,
// which is how a cell carrying a regex or an SQL alternation survives.
function rowCells(raw) {
  let s = raw.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/);
}

// A cell to the key it claims. Link text rather than link target, because the
// `r` rows of the letter table differ ONLY in their target and are the same
// claim; emphasis stripped, because a row bolded on one branch and plain on the
// other is one key and a gate that read them as two would miss the merge it
// exists for.
//
// `_` IS NOT STRIPPED and that is deliberate. It is an emphasis marker in
// markdown and an identifier character in this corpus, where first cells carry
// `held_pending_review` and `phone_hash`. Stripping it would fold
// `hold_expires` and `holdexpires` into one key, which invents a duplicate;
// inventing one is worse than missing one here, because a false finding in a
// merge gate is how the gate gets switched off.
const firstCellKey = (cell) =>
  cell
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/[`*~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const ci06u = {
  id: 'CI-06u',
  title: 'No markdown table in docs/ has two rows with the same first-cell key',
  covers:
    "CI-06p's first assertion, generalised off the one table it was written for. In every " +
    'markdown table under docs/, no two body rows carry the same first cell, because the ' +
    'review desk merge script resolves keep-both and re-appends rows a table already had. ' +
    'SCOPE IS STATED IN TWO PLACES AND NEITHER IS A RELAXATION. Tables whose first column ' +
    'is a DIMENSION rather than an identity (transition tables keyed by From, STRIDE ' +
    'tables keyed by threat category, and four more) are out of scope by header, one ' +
    'argued shape per entry, and an exemption matching no table is a finding. The 105 ' +
    'duplicate keys the 2026-08-19 survey found on main are REGISTERED, not exempted: a ' +
    'register entry that no longer names a real duplicate is a finding, so the register ' +
    'shrinks as repairs land and cannot become furniture. ' +
    'FIVE THINGS IT DOES NOT DO. It reads the first cell and nothing else, so two rows ' +
    'that CONTRADICT each other are the same finding as two that are identical, and which ' +
    'half is true is a founder ruling. The dimension list is a recorded reading of six ' +
    'table shapes, not a derivation, so a new dimension column under a new header is a ' +
    'false finding whose remedy is another argued entry. The register is per (file, key) ' +
    'and not per table, so a key duplicated in two tables of one file is one entry. It ' +
    'inherits the one-ref gap CI-06f, CI-06h and CI-06p each declare, and catches a ' +
    'cross-branch duplication at the merge rather than at the pull request. And a row ' +
    'indented past a list marker parses as prose and is claimed as nothing.',
  run() {
    const findings = [];
    const files = markdownFiles().filter((p) => p.startsWith(CI06U_DOCS));
    // Rule 2 on a glob-shaped input, which is the shape that returns empty
    // instead of throwing. A prefix that stops matching would make every table
    // in the corpus unread and every duplicate pass.
    if (files.length === 0) {
      throw new Error(`no markdown files under ${CI06U_DOCS}; the gate cannot run`);
    }

    const found = new Map(); // file -> Set(key)
    const exemptionUsed = new Set();
    let tables = 0;
    let inScope = 0;

    for (const file of files.sort()) {
      const body = read(file);
      for (const rows of markdownTables(body)) {
        tables++;
        const delimiterAt = rows.findIndex((r) => isDelimiterRow(r.raw));
        // The header is the row above the first delimiter. A table opening ON a
        // delimiter has no header and is in scope: `docs/sessions/README.md`'s
        // second copy opens that way and it is the largest finding here.
        const header =
          delimiterAt > 0 ? firstCellKey(rowCells(rows[delimiterAt - 1].raw)[0] ?? '') : '';
        if (DIMENSION_HEADERS.has(header)) {
          exemptionUsed.add(header);
          continue;
        }
        inScope++;
        const seen = new Map();
        let past = false;
        for (const row of rows) {
          if (isDelimiterRow(row.raw)) {
            past = true;
            continue;
          }
          if (!past) continue;
          const key = firstCellKey(rowCells(row.raw)[0] ?? '');
          // An empty first cell claims nothing. The corpus's two-column layout
          // tables carry `| | |` continuation rows by the hundred and a gate
          // that read them as one repeated key would report every one of them.
          if (!key) continue;
          if (!seen.has(key)) {
            seen.set(key, row.n);
            continue;
          }
          if (!found.has(file)) found.set(file, new Set());
          found.get(file).add(key);
          if (CI06U_REGISTER.get(file)?.includes(key)) continue;
          findings.push(
            `${file}:${row.n}: the first cell "${key.slice(0, 60)}" already heads the row at ` +
              `line ${seen.get(key)} of the same table (opens at line ${rows[0].n}). Two rows ` +
              'for one key is the keep-both merge, and the registry can no longer answer the ' +
              'question it exists to answer. Keep ONE row',
          );
        }
      }
    }

    if (tables === 0) {
      throw new Error(
        `CI-06u parsed zero markdown tables under ${CI06U_DOCS}. This corpus is written in ` +
          'tables, so zero means the table parser has stopped matching and every duplicate ' +
          'row in the tree would pass for the wrong reason',
      );
    }

    // THE REGISTER SHRINKS ONLY. An entry naming a duplicate that is no longer
    // there is a repair that landed without the register following it, and a
    // register nobody has to maintain is an exemption list that outlives its
    // reason. This is the same assertion CI-06l makes about its own exemptions.
    let registered = 0;
    for (const [file, keys] of CI06U_REGISTER) {
      for (const key of keys) {
        registered++;
        if (found.get(file)?.has(key)) continue;
        findings.push(
          `${file}: the register claims "${key}" is a known duplicate and it is not one on ` +
            'this ref. Either the repair landed and this line goes, or the file moved and ' +
            'the register moved with it. A register entry that names nothing exempts nothing ' +
            'and hides the next one',
        );
      }
    }

    // An exemption matching no table has the same problem in the other list.
    for (const [header, why] of DIMENSION_HEADERS) {
      if (exemptionUsed.has(header)) continue;
      findings.push(
        `no table under ${CI06U_DOCS} has "${header}" as its first-column header, and the ` +
          `dimension exemption for it (${why}) now covers nothing. Delete it: an exemption ` +
          'nobody can point at a table for is how a scope decision stops being reviewable',
      );
    }

    console.log(
      `       CI-06u note: ${inScope} of ${tables} tables in scope, ` +
        `${tables - inScope} exempt by first-column header (${[...DIMENSION_HEADERS.keys()].join(', ')}); ` +
        `${registered} known duplicate key(s) registered across ${CI06U_REGISTER.size} file(s), ` +
        'each one a repair this gate is waiting for',
    );
    return findings;
  },
};

// -----------------------------------------------------------------------------
// Runner
// -----------------------------------------------------------------------------
const GATES = [
  ci06a,
  ci06b,
  ci06c,
  ci06d,
  ci06e,
  ci06f,
  ci06g,
  ci06h,
  ci06i,
  ci06j,
  ci06k,
  ci06l,
  ci06m,
  ci06n,
  ci06o,
  ci06p,
  ci06q,
  ci06r,
  ci06s,
  adr026,
  ci06t,
  ci06u,
];

function main() {
  const [cmd, only] = process.argv.slice(2);

  if (cmd === 'list') {
    for (const g of GATES) console.log(`${g.id}  ${g.title}\n      covers: ${g.covers}\n`);
    return 0;
  }
  if (cmd === 'generate') return generate();
  if (cmd === 'allocation') return allocationReport();

  // Dev affordance ported from PR #7: CI-06a tells you a link is dead, this
  // tells you what to point it at instead.
  if (cmd === 'anchors') {
    if (!only) {
      console.error('usage: node scripts/corpus/gates.mjs anchors <file.md> [filter]');
      return 2;
    }
    const filter = (process.argv[4] ?? '').toLowerCase();
    for (const a of [...headingSlugs(read(only))].sort())
      if (!filter || a.includes(filter)) console.log(a);
    return 0;
  }

  if (cmd !== 'check') {
    console.error(
      'usage: node scripts/corpus/gates.mjs check [GATE-ID] | generate | allocation | list | ' +
        'anchors <file.md>',
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
