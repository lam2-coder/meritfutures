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
    // `\d{2,}` and not `\d{2}`. The corpus passed session 99 on 2026-08-20 and
    // FOLD-05 had already allocated 98 to 104, so a two-digit pattern silently
    // stopped recognising session files as registry entries: CI-06c reported
    // them missing from INDEX and CI-06n could not see them at all. The cap was
    // invisible for 99 sessions and then blocked five at once.
    entry: (f) => /^docs\/sessions\/\d{4}-\d{2}-\d{2}-session-\d{2,}\.md$/.test(f),
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

// One allocation table's body, with the absolute line number of its first line
// so a finding can name the ROW rather than the key alone. `CI-06w` reports two
// rows claiming one number and "0034 is claimed twice" is not actionable
// without the two line numbers; every other reader here ignores the offset.
//
// The bound is a PARAMETER because the letter table needs a different one, and
// the difference is not style: it is the LAST `##` section in ALLOCATION.md, so
// `\n## ` runs to end of file there and every table row in the prose below it
// would claim a letter. See `allocatedLetterClaims` for the long form.
function allocationSection(body, heading, bound) {
  const start = body.indexOf(heading);
  if (start === -1) throw new Error(`allocation table not found: "${heading}"`);
  const from = start + heading.length;
  const rest = body.slice(from);
  const next = rest.search(bound);
  return {
    text: next === -1 ? rest : rest.slice(0, next),
    // `heading` carries no newline, so the slice ending just past it ends on
    // the heading's own line, and `text`'s line `i` is at `firstLine + i`.
    firstLine: body.slice(0, from).split('\n').length,
  };
}

// THE CLAIMS AS A MULTISET: number -> the line of every row claiming it.
//
// THIS FUNCTION IS THE REPAIR FOR `OI-11` AND `allocated()` BELOW IS NOW A VIEW
// OF IT. It returned a `Set` directly for fifteen gates, so TWO ROWS CLAIMING
// `0034` PRODUCED ONE MEMBER: gaplessness held, every-number-on-disk-is-claimed
// held, and the table whose entire purpose is to make a duplicate claim visible
// could not see one. `ADR-046` and `ADR-047` both claimed `0034` in ADJACENT
// ROWS of one file on one ref and nothing reported it.
//
// The remedy is NOT a second parser in `CI-06w`. Two expressions of "what does
// this table claim" agree until they do not, which is the defect session 20
// removed from this runner when `CI-06b` and `CI-06c` carried one document set
// twice. `CI-06w` asserts over THIS map, the one `CI-06f` and `CI-06h` read
// through, so a future refactor collapsing it back into a `Set` breaks the gate
// loudly rather than making it vacuous.
function allocatedClaims(body, heading) {
  const { text, firstLine } = allocationSection(body, heading, /\n## /);
  const claims = new Map();
  let rows = 0;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('|')) continue;
    // `| 001 to 032 |`, `| **033** |`, `| 0001 to 0028 |`. The header row and
    // the `|---|` separator do not match, which is how they are skipped.
    const m = /^\s*\*{0,2}(\d{3,4})\*{0,2}(?:\s+to\s+\*{0,2}(\d{3,4})\*{0,2})?\s*$/.exec(
      lines[i].split('|')[1] ?? '',
    );
    if (!m) continue;
    rows++;
    const to = m[2] ? Number(m[2]) : Number(m[1]);
    // A RANGE ROW CLAIMS EVERY NUMBER IN IT, one row-line per number, so an
    // overlap between `001 to 032` and a later `032` is the same finding as two
    // identical rows. That is the direction a per-row-literal check would miss.
    for (let n = Number(m[1]); n <= to; n++) {
      if (!claims.has(n)) claims.set(n, []);
      claims.get(n).push(firstLine + i);
    }
  }
  // A table that parses to nothing is a gate with an empty reservation set,
  // which reports every hole and no false pass. It is still a runner that has
  // lost its input, and rule 2 of this file says that is an ERROR, not a pass.
  if (rows === 0) throw new Error(`allocation table claims no numbers: "${heading}"`);
  return claims;
}

// The set view, which is what gaplessness and every-number-is-claimed want. It
// is DERIVED rather than parsed a second time, which is the whole of the
// arrangement above.
const allocated = (body, heading) => new Set(allocatedClaims(body, heading).keys());

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
// -----------------------------------------------------------------------------
// ADR-065 T3, made checkable: a reservation row that outlived its reservation
// -----------------------------------------------------------------------------
// T3 rules that when a claimed artifact lands, its reservation row is AMENDED IN
// PLACE rather than joined by a second row. `CI-06w` enforces the second half of
// that (one key, at most one row). NOTHING ENFORCED THE FIRST HALF, and the cost
// is measured rather than asserted: on 2026-08-20 the two tables carried TWELVE
// rows reading "Reserved, unwritten" for artifacts that were sitting on disk,
// against 43 rows that were correct. Four consecutive sessions recorded the debt
// and none could close it, because the session that lands a file does not hold
// ALLOCATION.md in its fence at the moment it lands.
//
// A STALE RESERVATION IS THE DANGEROUS DIRECTION, which is why this is a gate and
// not a tidy-up. `allocated()` treats a reserved number as legitimately absent,
// so CI-06f and CI-06h both stop reporting a hole at that number. A row that says
// "reserved" forever is a permanent exemption from the gaplessness check, granted
// by a sentence nobody re-reads.
//
// IT READS THE LAST CELL, because that is where the disposition lives in both
// tables, and it reuses `allocationSection` rather than scanning the file again:
// a second reader of these tables is OQ-P1-04's defect, which is the whole reason
// `allocatedClaims` is one function serving two gates.
function reservedRowDispositions(body, heading) {
  const { text } = allocationSection(body, heading, /\n## /);
  const out = new Map();
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').filter((c, i, a) => i > 0 && i < a.length - 1);
    if (cells.length < 2) continue;
    const m = /^\s*\*{0,2}(\d{3,4})\*{0,2}\s*$/.exec(cells[0] ?? '');
    if (!m) continue;
    out.set(Number(m[1]), cells[cells.length - 1]);
  }
  return out;
}

// One phrasing, checked as one string, because both tables use it verbatim and a
// looser match would catch "reserved" in ordinary prose about a reservation.
const READS_UNWRITTEN = (cell) => /\*\*Reserved, unwritten/.test(cell);

const ci06f = {
  id: 'CI-06f',
  title: 'ADR numbers are unique and gapless over allocated plus reserved',
  covers:
    'uniqueness and gaplessness across the docs/decisions/ entry files, against the ' +
    'allocation table, plus that each entry file is named for the ADR its heading declares, ' +
    'plus ADR-065 T3: a row may not still read "Reserved, unwritten" once its entry file ' +
    'exists, because `allocated()` treats a reserved number as legitimately absent and a row ' +
    'left reserved is therefore a permanent exemption from the gaplessness check above. ' +
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
    const allocBody = read(ALLOCATION_DOC);
    const alloc = allocated(allocBody, ADR_ALLOCATION);
    const max = Math.max(...seen, ...alloc);
    for (let n = 1; n <= max; n++) {
      if (!seen.has(n) && !alloc.has(n)) {
        findings.push(`ADR-${String(n).padStart(3, '0')} is neither present nor reserved (a hole)`);
      }
    }
    // ADR-065 T3: the entry exists, so the row may no longer call itself unwritten.
    for (const [n, cell] of reservedRowDispositions(allocBody, ADR_ALLOCATION)) {
      if (seen.has(n) && READS_UNWRITTEN(cell)) {
        findings.push(
          `ADR-${String(n).padStart(3, '0')}: the allocation row still reads "Reserved, unwritten" ` +
            'and the entry file exists. ADR-065 T3 amends the reservation row IN PLACE when the ' +
            'artifact lands; a row left reserved is a permanent exemption from this gate\'s own ' +
            'gaplessness check',
        );
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
    'hole matches a reservation, no row still reads "Reserved, unwritten" once its ' +
    'file is on disk (ADR-065 T3, the same assertion CI-06f makes for entries), ' +
    'and the corpus workflow still carries the ' +
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
    const allocBody = read(ALLOCATION_DOC);
    const alloc = allocated(allocBody, MIGRATION_ALLOCATION);
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

    // ADR-065 T3, the migration half of CI-06f's assertion. The file is on disk,
    // so the row may no longer call itself unwritten. Migrations make this
    // sharper than ADRs do: a migration is SPENT the moment it merges, and
    // `0041` and `0044` both landed under a filename the reservation did not
    // name, so a row left reading "reserved" is also a row still advertising a
    // filename nobody wrote.
    for (const [n, cell] of reservedRowDispositions(allocBody, MIGRATION_ALLOCATION)) {
      if (seen.has(n) && READS_UNWRITTEN(cell)) {
        findings.push(
          `${pad(n)}: the allocation row still reads "Reserved, unwritten" and ${seen.get(n)} ` +
            'is on disk. ADR-065 T3 amends the reservation row IN PLACE when the artifact ' +
            'lands; a row left reserved is a permanent exemption from the hole check above',
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
      // ADR-068, AUTH AND THEREFORE MONEY PATH. Pinned in the commit that
      // wires it, which is the rule rather than the exception now: OI-07 has
      // four recorded occurrences of a probe wired and left unpinned.
      //
      // Deleting this step deletes the only assertion that the session-type
      // boundary holds IN BOTH DIRECTIONS. The forward guard alone passes an
      // inventory of refusals with the ordering hole wide open, and the hole is
      // an impersonation token resolving on the trader auth path, which GS-303
      // calls the failure that makes every other control on that table
      // decorative. It is also the only step asserting that an ORDINARY TRADER
      // SESSION STILL OPENS with the mirror installed.
      [
        'probe_impersonation_session_type.sql',
        "ADR-068's session-type boundary is no longer probed, so nothing " +
          'asserts that the mirror closes the ordering hole, that a restricted ' +
          'identity is still impersonable (GS-302), that ordinary trader login ' +
          'still works, or that C2 reads the explicit exit rather than the ' +
          'expiry alone',
      ],
      // 0045, SD-M21-02. The publish-decision record is the only control
      // standing between a published rule contract and the amnesia FM-M21-03
      // names. It is a CHECK, so nothing but a probe can watch it refuse, and
      // its blank-waiver floor is a SEPARATE constraint precisely because
      // num_nonnulls counts '' as present.
      [
        'probe_simulation_decision_record.sql',
        'nothing asserts that a published plan_version records what it was ' +
          'decided on, that the recorded exception stays cheap while the ' +
          'unrecorded one is impossible, that a blank waiver is refused by its ' +
          'own named floor, or that calibrationDigest()\'s HEX output decodes ' +
          'to the 32 bytea bytes the column requires',
      ],
      // 0046, ADR-079. Pinned in the commit that wires it. THE PIN MATTERS MORE
      // HERE THAN THE STEP DOES: the eval-pass row this entry exists for is
      // EXEMPT from the constraint it installs (payout_anchor_day IS NULL), so
      // the only cases that watch the new constraint refuse anything are
      // REJECTION 1 and REJECTION 2 in this file. Delete the step and nothing
      // anywhere asserts that the replacement is a control rather than a shape.
      [
        'probe_consistency_period_after_anchor.sql',
        "ADR-079's anchor-relative period bound is no longer probed, so " +
          'nothing asserts that the eval-pass row 0015 refused is writable, ' +
          'that a period starting ON its anchor is refused (AS-12, R-47 is ' +
          'strict), that one starting before it is refused, that the retired ' +
          'name is gone from the catalogue, or that both IS NULL guards are ' +
          'still load bearing',
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
// The multiset, for the reason `allocatedClaims` states one registry over: a
// `Set` here hid a LIVE double claim of the letter `u` by two different gates
// for twenty-two gates, and `CI-06p`'s uniqueness assertion could not see it
// because `CI-06p` reads STRATEGY's rows and the second claim was in this file.
function allocatedLetterClaims(body) {
  const { text, firstLine } = allocationSection(body, LETTER_ALLOCATION, /\n#{1,6} /);
  const claims = new Map();
  let rows = 0;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('|')) continue;
    const m = /^\s*\*{0,2}`?([a-z])`?\*{0,2}(?:\s+to\s+\*{0,2}`?([a-z])`?\*{0,2})?\s*$/.exec(
      lines[i].split('|')[1] ?? '',
    );
    if (!m) continue;
    rows++;
    const to = (m[2] ?? m[1]).charCodeAt(0);
    for (let c = m[1].charCodeAt(0); c <= to; c++) {
      const letter = String.fromCharCode(c);
      if (!claims.has(letter)) claims.set(letter, []);
      claims.get(letter).push(firstLine + i);
    }
  }
  // Rule 2. A table that parses to nothing is a gate with an empty reservation
  // set: it reports every hole and no false pass, and it is still a runner that
  // has lost its input.
  if (rows === 0) throw new Error(`allocation table claims no letters: "${LETTER_ALLOCATION}"`);
  return claims;
}

const allocatedLetters = (body) => new Set(allocatedLetterClaims(body).keys());

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
// can no longer answer the question it exists to answer. THE SURVEY MEASURED
// 106 OF THOSE SURVIVING THE EXEMPTIONS, IN 8 FILES, ON 2026-08-19 -- a frozen
// historical figure, dated and attributed here on purpose, and THE ONLY COUNT
// LEFT IN THIS HEADER. It is what the gate was written against, it is what
// session 75's log, WAVE-03 and ADR-061 all cite, and nothing recomputes it, so
// it cannot drift. The header said `105` for five sites and a week while the
// runner printed 106 on every run; see the note at the foot of this gate for
// what the register holds TODAY, which is a different question and a moving
// one. THREE OF THE PAIRS CONTRADICT EACH OTHER:
// `G-ELIGIBLE` in STATE_MACHINES is defined once as `identities.status <>
// 'restricted'` and once as `identities.status = 'active'`, both citing ADR-041,
// on the money path; INDEX gives `M05` two different purposes; STATE says both
// `21` checks and `Eleven`. `docs/sessions/README.md` carries the ENTIRE session
// index twice, one copy truncated at session 62.
//
// THEY ARE REGISTERED RATHER THAN EXEMPTED, and the difference is the whole
// design. `falsify.mjs` runs every gate against the tree as it stands and a gate
// that cannot pass there is an ERROR, so a gate landing red on the survey's
// findings could not land at all. The register pins the exact (file, key) pairs
// that exist on the ref it is read against, and THE RUNNER PRINTS ITS SIZE ON
// EVERY RUN rather than restating it here: repairs move that number and a copy
// of it in a comment is ADR-034's class, inside the gate written to catch
// registries disagreeing with themselves. A NEW duplicate is a finding. And a register entry that no
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
  // exempt, and it carried ten of the survey's duplicates until ADR-062's
  // session repaired them; it carries none today. THE COUNT IS GONE FROM THIS
  // LINE RATHER THAN CORRECTED TO ZERO: what this comment is for is the
  // ARGUMENT that one table in this file is exempt and its neighbour is not,
  // and a running total beside it was stale within two sessions of being
  // written. The register prints its own size.
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
  // REASON, WHICH IS NOW A RULING RATHER THAN AN OWED ONE. `ADR-064` rules that a
  // session number is a DAY-AND-SLOT ALLOCATION and not an identifier: parallel
  // sessions on one day share a number and a log file, each appending its own
  // `##` section, and the identifier of a session is (log file, `##` heading).
  // The 83 files on disk hold 121 sections and the index carries 121 rows over 83
  // first cells, so THE FIRST CELL HERE IS A POINTER AND NOT A KEY. This gate
  // reads first cells as identities and is right to do so everywhere else.
  //
  // THE MERGE IS REPAIRED AND THE CONVENTION IS WHAT IS LEFT. This entry held 59
  // keys while the file carried the whole index TWICE under a re-inserted header
  // row. Forty of those were the second copy and they are gone; the NINETEEN
  // below are the convention, and every one of them is a file holding two to four
  // sections. Written out rather than expressed as a range: a range is a rule,
  // and a rule that has to be re-derived on every repair is how a register stops
  // being read.
  //
  // THESE NINETEEN NAME A REPAIR THIS GATE IS STILL WAITING FOR, and it is not
  // the repair the register assumes. ADR-064 section 4 rules the destination:
  // this table's first column is a DIMENSION rather than an identity, exactly as
  // `From` is on a transition table keyed by (From, To, Guard), and it cannot
  // reach `DIMENSION_HEADERS` today only because its header is EMPTY. Giving the
  // table the header `Session` and adding `session` to `DIMENSION_HEADERS` takes
  // this entry to zero without renumbering anything. That is deliberately NOT
  // done here: the exemption is corpus-wide, and the control that makes it safe,
  // `CI-06/session-index-matches-sections`, is not written. The two land together
  // or neither does.
  [
    'docs/sessions/README.md',
    [
      '2026-08-16 - session 31',
      '2026-08-16 - session 32',
      '2026-08-16 - session 33',
      '2026-08-16 - session 40',
      '2026-08-16 - session 42',
      '2026-08-16 - session 45',
      '2026-08-16 - session 47',
      '2026-08-17 - session 48',
      '2026-08-17 - session 49',
      '2026-08-17 - session 50',
      '2026-08-17 - session 51',
      '2026-08-17 - session 52',
      '2026-08-17 - session 54',
      '2026-08-17 - session 55',
      '2026-08-18 - session 56',
      '2026-08-18 - session 57',
      '2026-08-18 - session 58',
      '2026-08-18 - session 59',
      '2026-08-19 - session 75',
    ],
  ],
]);

// A delimiter row: `|---|---|`, `| :--- | ---: |`. It carries no data and is not
// a body row. A SECOND one inside a table is not skipped quietly by accident --
// it is a keep-both artifact in its own right -- but naming it is `CI-06p`'s
// business, not this gate's. STRATEGY section 4.4 carried one until session 83
// removed it with the orphan run it had split off; the general case stands.
const isDelimiterRow = (line) => /^\s*\|[\s|:-]*\|\s*$/.test(line) && line.includes('-');

// `CI-06v`'s single-line concession, named rather than written as a bare `2` at
// the comparison. A run shorter than this claims nothing.
const ORPHAN_MIN_ROWS = 2;

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
  return markdownRuns(body).filter((run) => run.some((r) => isDelimiterRow(r.raw)));
}

// EVERY maximal run, including the ones `markdownTables` throws away. The split
// exists so `CI-06v` reads the discarded half rather than carrying a second copy
// of this loop: two expressions of one concept that agree today is the defect
// session 20 removed from this runner when `CI-06b` and `CI-06c` carried two
// regexes for one document set, ten lines apart, agreeing until they did not.
function markdownRuns(body) {
  const lines = body.split('\n');
  const out = [];
  let fence = null;
  let run = null;
  const flush = () => {
    if (run) out.push(run);
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
    'argued shape per entry, and an exemption matching no table is a finding. The duplicate ' +
    'keys the 2026-08-19 survey found on main are REGISTERED, not exempted: a register entry ' +
    'that no longer names a real duplicate is a finding, so the register shrinks as repairs ' +
    'land and cannot become furniture. Its size is PRINTED ON EVERY RUN rather than stated ' +
    'here, because a repair moves it and this text does not. ' +
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

const ci06v = {
  id: 'CI-06v',
  title: 'No orphan table fragment under docs/',
  covers:
    'A run of consecutive pipe lines carrying NO delimiter row is a finding. Such a run ' +
    'renders as prose rather than as a table, and every table gate in this runner drops ' +
    'it on the floor: `markdownTables` keeps a run only if it carries a delimiter, so an ' +
    'orphan fragment is not a table nobody checked, it is rows nobody can see. ' +
    'THE CAUSE IT IS AIMED AT is the review desk merge script resolving keep-both ' +
    'mid-table, which re-inserts a header and a delimiter and leaves a blank line behind ' +
    'them; the rows below the blank become an orphan run. STRATEGY section 4.4 carried ' +
    'one of exactly that shape holding six of its own gate rows, CI-06u\'s among them, ' +
    'and ADR-065 records four more in ALLOCATION\'s letter table. ' +
    'THE RULE ON RUN LENGTH IS TWO, AND IT IS A CHOICE. A single isolated pipe line ' +
    'claims nothing: a sentence that happens to start with a pipe, or a one-row table ' +
    'quoted illustratively outside a fence, is prose and a gate that called it a fragment ' +
    'would be reporting on English. Measured over docs/ when this gate was written, ' +
    'there are ZERO single isolated pipe lines, so the concession costs nothing today and ' +
    'is made against tomorrow. ' +
    'FOUR THINGS IT DOES NOT DO. It does not read cells, so a fragment whose rows ' +
    'contradict the table above them is the same finding as one that repeats it, and ' +
    'which half is true is a founder ruling. It cannot see a genuine ONE-row orphan, by ' +
    'the rule above. It says nothing about a table that is well formed and wrong: a ' +
    'delimiter row is the whole test, so a run carrying a delimiter passes however ' +
    'damaged its content is, which is CI-06u\'s business and not this gate\'s. And it ' +
    'inherits the one-ref gap CI-06f, CI-06h, CI-06p and CI-06u each declare: it catches ' +
    'a fragment introduced by a merge at the merge, never at the pull request that fed it.',
  run() {
    const findings = [];
    const files = markdownFiles().filter((p) => p.startsWith(CI06U_DOCS));
    // Rule 2 on a glob-shaped input. A prefix that stopped matching would make
    // every fragment in the corpus pass for the wrong reason.
    if (files.length === 0) {
      throw new Error(`no markdown files under ${CI06U_DOCS}; the gate cannot run`);
    }

    let runs = 0;
    let orphanRows = 0;
    for (const file of files.sort()) {
      for (const run of markdownRuns(read(file))) {
        runs++;
        if (run.some((r) => isDelimiterRow(r.raw))) continue;
        // The single-line concession, stated in `covers` and applied here.
        if (run.length < ORPHAN_MIN_ROWS) continue;
        orphanRows += run.length;
        findings.push(
          `${file}:${run[0].n}-${run[run.length - 1].n}: ${run.length} consecutive pipe ` +
            'lines carry no delimiter row, so they render as prose and no table gate reads ' +
            `them. First row: ${run[0].raw.trim().slice(0, 70)}`,
        );
      }
    }

    // Rule 2 again, on the parser rather than on the input. This corpus is
    // written in tables; zero runs means the run splitter has stopped matching
    // and every fragment in the tree would pass silently.
    if (runs === 0) {
      throw new Error(
        `CI-06v parsed zero pipe runs under ${CI06U_DOCS}. This corpus is written in ` +
          'tables, so zero means the run splitter has stopped matching and this gate is ' +
          'asserting nothing',
      );
    }

    console.log(
      `       CI-06v note: ${runs} pipe run(s) under ${CI06U_DOCS}, ` +
        `minimum orphan length ${ORPHAN_MIN_ROWS}; ${orphanRows} orphan row(s) found`,
    );
    return findings;
  },
};

// -----------------------------------------------------------------------------
// CI-06w  Every allocation claim is read as a MULTISET, not a set
// -----------------------------------------------------------------------------
// THE REGISTRY THAT EXISTS TO MAKE A DOUBLE CLAIM VISIBLE COULD NOT SEE ONE.
// `allocated()` and `allocatedLetters()` folded claims into a `Set`, so two
// rows claiming `0034` produced ONE MEMBER. Every assertion built on them still
// held: the sequence was gapless, every number on disk was claimed, and no gate
// in this runner had any way to notice that two different artifacts had been
// promised the same number. This is `OI-11`.
//
// IT IS NOT HYPOTHETICAL AND BOTH OCCURRENCES ARE ON RECORD.
//   * `0034` was claimed by `ADR-047` for the `rule_states` calendar revision
//     and by `ADR-046` for the reversible contact addresses, in ADJACENT ROWS
//     of one table, on one ref, and FIFTEEN GATES PASSED OVER IT. `ADR-046`
//     wrote the file and merged, so the other subject landed as `0035`.
//     Recovery was free only because the second file was still unwritten; a
//     merged migration is sacred (constitution E2) and cannot be renumbered.
//   * The letter `u` was claimed by TWO DIFFERENT GATES and twenty-two gates
//     passed over that, recorded in ADR-065 section 4.
//
// WHY THIS IS NOT ALREADY `CI-06u`'s JOB. The two are not the same assertion
// and the distinction is worth stating plainly, because two gates whose scopes
// are not separable is how a gate gets deleted later.
//
//   `CI-06u` reads TABLES. It would report a duplicate row in this file, and on
//   today's tree it does read all three of these tables. It did NOT catch `u`,
//   for a reason that is itself a finding: the row sat in an ORPHAN FRAGMENT.
//   Four blank lines split the letter table into five runs and only the first
//   carried a delimiter, so nine rows were invisible to every table gate in the
//   runner. `CI-06v` now closes that hole and `S6` repaired the blanks.
//
//   `CI-06w` reads CLAIMS. It asserts at the SEMANTIC level, over the very maps
//   `CI-06f`, `CI-06h` and `CI-06p` resolve their own answers through, so the
//   properties it protects survive things `CI-06u` cannot see:
//
//     1. A RANGE OVERLAP IS NOT A DUPLICATE ROW. `| 001 to 032 |` and a later
//        `| 032 |` are two textually distinct first cells and `CI-06u` is
//        right to pass them. They claim `032` twice, and this gate says so.
//     2. `CI-06u` IS DEFEATED BY PRESENTATION. Its key is the first cell after
//        emphasis and links are stripped; `| 0034 |` against `| **0034** |`
//        folds to one key today, but a row rewritten as `| 0034 to 0034 |`
//        does not, and neither does one that reaches a claim through a range.
//        This gate reads the number, never the spelling of the cell.
//     3. IT CANNOT GO VACUOUS BY REFACTOR. `CI-06u`'s reach over this file is
//        an accident of the tables being tables. If somebody folds
//        `allocatedClaims` back into a `Set` -- the exact edit that created
//        `OI-11` -- `CI-06u` goes on passing and this gate stops compiling a
//        finding it should have. That is why it asserts over the shared parser
//        instead of parsing the file a third time.
//
//   The overlap is real and is not a reason to keep one: on the population that
//   actually occurs, two verbatim rows, they agree. `CI-06u` REGISTERS its
//   duplicates and can be silenced per (file, key); this gate registers
//   nothing, has no exemption list, and no way to accept a claim twice.
//
// THE FOURTH ASSERTION IS THE SAME `Set` ONE LEVEL IN, AND IT IS AN ADDITION TO
// THE THREE THIS GATE WAS COMMISSIONED FOR. `implementedLetters()` builds the
// runner's own letter set with `new Set(GATES.map(...))`, so TWO GATE OBJECTS
// CARRYING ONE ID COLLAPSE TO ONE MEMBER and `CI-06p` reports a letter that is
// implemented twice as implemented once. That is not a thought experiment: PR
// #112 and PR #114 each define `id: 'CI-06u'` independently, #114 is open, and
// a keep-both merge of it lands exactly here with nothing in the tree able to
// see it. Registry and runner are one defect with one mechanism, and splitting
// them across two gates would put the cheaper half in a gate nobody wrote.
const ci06w = {
  id: 'CI-06w',
  title: 'Every allocation claim is read as a multiset: one key, at most one row',
  covers:
    'Each ADR number, each migration number and each CI-06 letter is claimed by AT MOST ONE ' +
    "ROW of its own table in ALLOCATION, and each gate id appears at most once in the runner's " +
    'GATES list. This is OI-11. allocated(), allocatedLetters() and implementedLetters() each ' +
    'accumulated claims into a Set, so a second claim produced no second member: gaplessness ' +
    'held, every-artifact-on-disk-is-claimed held, and the registry whose entire purpose is to ' +
    'make a double claim visible could not see one. 0034 was double-claimed by two migrations ' +
    'in adjacent rows and fifteen gates passed; the letter u was double-claimed by two gates ' +
    'and twenty-two passed. ' +
    'IT IS NOT CI-06u AND THE SCOPES ARE SEPARABLE. CI-06u reads TABLES and does read these ' +
    'three; it missed u because the row sat in an orphan fragment, which CI-06v now closes. ' +
    'CI-06w reads CLAIMS, over the same maps CI-06f, CI-06h and CI-06p answer through, and so ' +
    'it sees three things a table parse cannot: a RANGE OVERLAP (001 to 032 against a later ' +
    '032 is two distinct first cells and one number claimed twice), a claim reached through ' +
    'any spelling of the cell rather than the cell text itself, and -- the reason it is ' +
    'written this way -- a future refactor folding the claims back into a Set, which would ' +
    'leave CI-06u passing and every double claim invisible again. CI-06u can also be silenced ' +
    'per (file, key) by its register; this gate has no register and no exemption list. ' +
    'THREE THINGS IT DOES NOT DO. It inherits the one-ref gap CI-06f, CI-06h, CI-06p and ' +
    'CI-06u each declare: two BRANCHES claiming one number is the commonest form of this ' +
    'defect and this run sees one ref, so it catches that at the merge and never at the pull ' +
    'request. It says nothing about WHICH of two rows is right, which is ADR-065 section 1 and ' +
    'a founder ruling rather than a parse. And it reads only the three tables ALLOCATION ' +
    'carries: a registry with no allocation table at all, which docs/sessions is, is out of ' +
    'reach until it has one.',
  run() {
    const findings = [];
    const body = read(ALLOCATION_DOC);

    // Each table's claims, keyed and formatted for the identifier it allocates.
    // `allocatedClaims` and `allocatedLetterClaims` each throw when their table
    // parses to zero rows, which is rule 2 on all three inputs.
    const registries = [
      {
        heading: ADR_ALLOCATION,
        what: 'ADR number',
        claims: allocatedClaims(body, ADR_ALLOCATION),
        label: (n) => `ADR-${String(n).padStart(3, '0')}`,
      },
      {
        heading: MIGRATION_ALLOCATION,
        what: 'migration number',
        claims: allocatedClaims(body, MIGRATION_ALLOCATION),
        label: (n) => String(n).padStart(4, '0'),
      },
      {
        heading: LETTER_ALLOCATION,
        what: 'CI gate letter',
        claims: allocatedLetterClaims(body),
        label: (l) => `CI-06${l}`,
      },
    ];

    const note = [];
    for (const { heading, what, claims, label } of registries) {
      let rows = 0;
      for (const lines of claims.values()) rows += lines.length;
      note.push(`${claims.size} ${what}(s) over ${rows} claim(s)`);
      // Sorted so the report is stable across runs: a gate whose finding order
      // moves with Map insertion is a gate whose diff nobody can read.
      for (const key of [...claims.keys()].sort()) {
        const lines = claims.get(key);
        if (lines.length < 2) continue;
        findings.push(
          `${ALLOCATION_DOC}: ${label(key)} is claimed by ${lines.length} rows of the ` +
            `"${heading}" table, at line(s) ${lines.join(', ')}. The claims fold into a Set ` +
            'downstream, so the second claim adds no member: the sequence stays gapless and ' +
            'the registry can no longer say which artifact holds the number. Keep ONE row ' +
            '(ADR-065 section 1: the merge row is the durable fact, and it carries the ' +
            "branch row's reasoning where that says something the merge row does not)",
        );
      }
    }

    // The runner's own registry. Rule 2: an empty GATES would make this
    // assertion silent rather than loud, and silence is the direction that
    // matters on a duplicate check.
    if (GATES.length === 0) {
      throw new Error('GATES is empty; CI-06w is asserting nothing about the runner');
    }
    const byId = new Map();
    for (const g of GATES) byId.set(g.id, (byId.get(g.id) ?? 0) + 1);
    note.push(`${byId.size} gate id(s) over ${GATES.length} registration(s)`);
    for (const id of [...byId.keys()].sort()) {
      if (byId.get(id) < 2) continue;
      findings.push(
        `scripts/corpus/gates.mjs: the gate id ${id} is registered ${byId.get(id)} times in ` +
          'GATES. implementedLetters() folds those ids into a Set, so CI-06p reports a letter ' +
          'implemented twice as implemented once, and both gates run under one name. This is ' +
          'what a keep-both merge of two branches that each wrote the same CI-06<letter> ' +
          'produces. Rename one (ADR-065 section 5 rules the successor identifier is a slug)',
      );
    }

    console.log(`       CI-06w note: ${note.join('; ')}`);
    return findings;
  },
};

// -----------------------------------------------------------------------------
// CI-06/conflict-markers  No file carries a line beginning with a conflict marker
// -----------------------------------------------------------------------------
// THE RECORD THAT COMMISSIONED THIS GATE IS WRONG ABOUT ITS OWN EVIDENCE, AND
// SAYING SO IS THE FIRST THING THIS BLOCK DOES. `OI-19` in STATE reads "`<<<<<<<
// HEAD` stood in INDEX and STATE and 22 of 22 gates passed over it". It never
// stood in a COMMIT. No commit reachable from any branch head or any
// pull-request head has ever carried a leading marker in any `.md`, `.ts`,
// `.mjs` or `.json` file:
//
//     git log --all -G'^<<<<<<< ' -- '*.md' '*.ts' '*.mjs' '*.json'
//
// returns nothing, run on this branch on 2026-08-21. It stood in a WORKING TREE
// during a merge. The record also disagrees with itself on the gate count, 22 in
// session 105 and in STATE against 24 in session 106.
//
// TWO THINGS FOLLOW AND BOTH ARE LOAD BEARING.
//
//   THE GATE IS STILL WORTH WRITING, because the boundary it protects is THE
//   PUSH AND NOT THE HISTORY. The dirty tree is what CI and the founder read,
//   `falsify.mjs` copies the working tree rather than a git worktree for exactly
//   that reason, and a merge resolved by hand at the wrong moment is one `git
//   add -A` away from being history. That the corpus has never shipped one is
//   the state this gate exists to keep.
//
//   ITS FALSIFICATION CASE SEEDS A MARKER RATHER THAN ANCHORING ON A HISTORICAL
//   ONE, because there is no historical one to anchor on. That is the better
//   outcome and not a concession: `OI-21` records that a harness anchored to
//   corpus state decays as the corpus is repaired, and a seeded anchor does not.
//
// THE LIVE COMPLICATION, MEASURED RATHER THAN ASSUMED. STATE carries the string
// `<<<<<<< HEAD` THREE TIMES IN PROSE, at the `OI-19` entry and the two entries
// that discuss it. Those are this gate's own subject matter written down. The
// assertion is therefore "a line BEGINNING with a marker" and never "a file
// containing one":
//
//     grep -n '^<<<<<<< ' docs/STATE.md
//
// returns nothing, re-run on this branch rather than taken from the brief, and
// so does the same search over every tracked file for all four marker shapes
// including diff3's `|||||||`. No exemption is registered because none is
// needed. `CI-06/conflict-markers/mid-line` asserts that boundary in the harness
// with a control on the other side of it, so the concession is watched rather
// than claimed.
//
// THE MARKERS ARE SPELLED BY REPETITION AND NEVER AS LITERALS. A gate whose
// source spells a marker at the start of one of its own lines is its own first
// finding, and this repository has already paid for that class once: `CI-06t`
// exists because a line of prose describing a `falsify.mjs` seed SPELLED A
// GENERATED-SPAN OPENER OUT and `CI-06g` swallowed ten thousand characters of
// unrelated text. Naming the shape instead of writing it is the same repair.
//
// SCOPE IS THE WHOLE TREE, NOT `docs/`. A conflict marker in a migration, a
// workflow or a `.ts` file is worse than one in prose, not better. `allFiles()`
// is what "tracked" means here, and the equality was measured rather than
// assumed: on 2026-08-21 the runner's walk reached 1,022 files and `git
// ls-files` returned the same 1,022, with no file on either side of the
// difference. The walk is used rather than `git ls-files` because `falsify.mjs`
// copies the tree WITHOUT `.git`, so a gate shelling out to git would report
// ERROR in every seeded copy and could never be watched failing. The residual
// gap is stated rather than hidden: a file that is ignored by `.gitignore` and
// present on disk would be read here and is not tracked. Every current
// `.gitignore` entry is build output or a crash journal, and none of it is
// something git merges.
const CONFLICT_MARKER_WIDTH = 7;
const markerOf = (char) => char.repeat(CONFLICT_MARKER_WIDTH);

// Each marker carries its own matcher and its own argument, because the three
// are not equally unambiguous and pretending they are is how a gate acquires a
// false finding.
const CONFLICT_MARKERS = [
  {
    // The ours-side opener. Git writes seven `<`, a space and a label. The bare
    // form with no label is matched too, because a half-finished hand
    // resolution produces it and nothing legitimate in this tree begins with
    // seven `<`: not markdown, not TypeScript, not SQL, not YAML, not JSON.
    marker: markerOf('<'),
    what: 'the ours-side opener',
    match: (line) => line.startsWith(markerOf('<')),
  },
  {
    // THE ONE AMBIGUOUS MARKER, AND IT IS ASSERTED ANYWAY. Git writes exactly
    // seven `=` alone on the line, and a markdown setext H1 underline of exactly
    // seven `=` is textually identical to it. So this matcher requires the WHOLE
    // LINE, where the other two are prefix matches: `========` under a heading
    // is eight and passes, and a setext underline is a shape a Merit document
    // has never used (measured: zero lines in the tree begin with seven `=`).
    // It is kept because a hand resolution that deletes the outer markers and
    // leaves the middle one is exactly what a careless fix produces, and that is
    // the only state the other two cannot see.
    marker: markerOf('='),
    what: 'the separator',
    match: (line) => line.trimEnd() === markerOf('='),
  },
  {
    // The theirs-side closer. Seven `>` at a line start is seven nested
    // blockquotes in markdown, which no document in this corpus comes close to,
    // and is nothing at all in every other file type here.
    marker: markerOf('>'),
    what: 'the theirs-side closer',
    match: (line) => line.startsWith(markerOf('>')),
  },
];

// DIFF3'S BASE MARKER IS DELIBERATELY NOT ASSERTED, in writing rather than by
// omission. `merge.conflictStyle = diff3` or `zdiff3` writes a fourth marker of
// seven `|` before the base section. Seven `|` at a line start is also a
// markdown table row of empty cells, and this corpus is written in tables. The
// exclusion costs nothing: diff3 writes the outer two markers as well as the
// base one, so a diff3 conflict is caught twice over by the rows above.

// A file git will not merge as text cannot carry a marker git wrote into it.
// THE DISCRIMINATOR IS UTF-8 VALIDITY AND NOT A NUL BYTE, and the difference is
// two real source files. `packages/rithmic/src/simulator/session.ts` and
// `stream.ts` embed a literal NUL in a template literal as a composite-key
// separator; a NUL test drops both from this gate's scope, which is the
// "parser narrower than the property it claims" class this runner has now found
// six times. A round-trip through UTF-8 keeps them and drops exactly the six
// `.xlsx` workbooks, measured on 2026-08-21. It is derived rather than listed,
// so a seventh binary file needs no edit here.
const isUtf8Text = (buf) => Buffer.from(buf.toString('utf8'), 'utf8').equals(buf);

const conflictMarkers = {
  id: 'CI-06/conflict-markers',
  title: 'No file carries a line beginning with a merge conflict marker',
  covers:
    'Every file the runner walks, not just docs/: no line BEGINS with one of the three ' +
    'markers git writes into a file it could not merge. This is OI-19. ' +
    'THE RECORD THAT COMMISSIONED IT IS WRONG ABOUT ITS OWN EVIDENCE and the gate says so ' +
    'rather than inheriting it: no commit reachable from any branch head or pull-request ' +
    "head has ever carried a leading marker (git log --all -G'^<<<<<<< ' returns nothing). " +
    'It stood in a WORKING TREE during a merge. The gate is still worth writing because the ' +
    'boundary it protects is the PUSH and not the history, and its falsification case ' +
    'SEEDS a marker rather than anchoring on a historical one, which is OI-21 applied. ' +
    'A LINE BEGINNING WITH A MARKER, NEVER A FILE CONTAINING ONE. STATE carries the opener ' +
    'three times in PROSE, at the OI-19 entry and the two that discuss it, and all three ' +
    'are mid-line. No exemption is registered because none is needed, and ' +
    'CI-06/conflict-markers/mid-line asserts that boundary with a control on the far side. ' +
    'THE SEPARATOR IS MATCHED AS A WHOLE LINE where the outer two are prefix matches, ' +
    'because a markdown setext H1 underline of exactly seven equals signs is textually ' +
    'identical to it; the tree carries zero such lines today. ' +
    "DIFF3'S BASE MARKER OF SEVEN PIPES IS NOT ASSERTED: it is also a table row of empty " +
    'cells, and diff3 writes the outer two markers anyway, so the case is caught twice over. ' +
    'TWO THINGS IT DOES NOT DO. It reads the WORKING TREE through the runner walk rather ' +
    'than through git, so a file ignored by .gitignore and present on disk is read here and ' +
    'is not tracked; the walk and git ls-files returned the same 1,022 files when this was ' +
    'written. And it skips a file that is not valid UTF-8, which is the six .xlsx workbooks ' +
    'and nothing else -- a NUL-byte test would instead have dropped two .ts sources that ' +
    'embed a literal NUL as a key separator.',
  run() {
    const findings = [];
    const files = allFiles();

    // Rule 2 on the input. An empty walk would make this gate report a clean
    // tree for the one reason that means it read nothing.
    if (files.length === 0) {
      throw new Error('the runner walk reached zero files; CI-06/conflict-markers cannot run');
    }

    let scanned = 0;
    let skipped = 0;
    let lines = 0;
    for (const file of files.sort()) {
      const buf = readFileSync(join(ROOT, file));
      if (!isUtf8Text(buf)) {
        skipped++;
        continue;
      }
      scanned++;
      const body = buf.toString('utf8');
      let n = 0;
      for (const line of body.split('\n')) {
        n++;
        lines++;
        const hit = CONFLICT_MARKERS.find((m) => m.match(line));
        if (!hit) continue;
        findings.push(
          `${file}:${n}: line begins with the conflict marker "${hit.marker}" (${hit.what}). ` +
            'Git writes this into a file it could not merge, so the file states two ' +
            'contradictory things and ships as one. Resolve the merge; a generated span is ' +
            'resolved by running: node scripts/corpus/gates.mjs generate',
        );
      }
    }

    // Rule 2 on the reader. Every markdown file in this corpus is text, so zero
    // scanned means the UTF-8 discriminator has inverted and every marker in the
    // tree is being skipped in silence.
    if (scanned === 0) {
      throw new Error(
        `CI-06/conflict-markers read zero text files out of ${files.length}. The UTF-8 ` +
          'check has inverted and every file in the tree is being skipped as binary',
      );
    }

    console.log(
      `       CI-06/conflict-markers note: ${lines} line(s) over ${scanned} text file(s); ` +
        `${skipped} file(s) skipped as not valid UTF-8; ` +
        `markers asserted: ${CONFLICT_MARKERS.map((m) => m.marker).join(' ')}`,
    );
    return findings;
  },
};

// -----------------------------------------------------------------------------
// CI-06/fixture-inventory  The fixture registry and the fixture directory agree
// -----------------------------------------------------------------------------
// THE DIRECTION THIS GATE OWNS HAS BEEN NAMED AND UNIMPLEMENTED SINCE CI-03 WAS
// WRITTEN, AND CI-03 SAYS SO ON EVERY RUN IN ITS OWN WORDS: "The inventory check
// for a registry row with no fixture is CI-06's and is not switched on." A
// sentence that reports its own hole on every run for as long as nobody writes
// the gate is the most polite form of a silent failure there is.
//
// SIX ASSERTIONS, AND THE PARTITION IS THE POINT. `39-fixture-status-and-
// blockers.md` is a registry of 316 rows whose STATUS COLUMN IS A CLAIM ABOUT
// THE DIRECTORY. ADR-072 says so in the document's own words: "`status` is
// derived from the directory and not from this file". A claim about the
// directory that nothing compares to the directory is a claim.
//
//   1. ONE ROW PER REGISTERED SCENARIO, BOTH DIRECTIONS. The registry set is
//      read from the OTHER section files and never from the status document
//      itself, which is what stops the assertion being circular: reading the
//      status document for its own scope would let a row define the very
//      identifier it is then checked against, so an invented id would register
//      itself and pass. Spelling an unregistered id out here would also be a
//      CI-06d finding in its own right, which is that gate doing its job on
//      this one's documentation.
//   2. EVERY FIXTURE ON DISK HAS A `written` ROW. This is the direction CI-03
//      names. It is the one that catches a fixture landing without the registry
//      moving, which is exactly what happened three times in this wave.
//   3. NO ROW CLAIMS `written` WITHOUT BOTH FILES. A fixture is a `.yaml` and
//      its `.expected.json` sibling; one without the other is a scenario the
//      loader cannot run and the registry calls done.
//   4. EVERY `blocked` ROW NAMES A BLOCKER FROM THE CLOSED VOCABULARY AND A
//      CITATION, and every row that is NOT blocked names NO blocker.
//   5. THE TWO SUMMARY TABLES ARE DERIVED FROM THE ROWS. They are
//      hand-maintained counts sitting above 316 hand-maintained rows, which is
//      ADR-034's class, and CI-06g cannot reach them because they are not
//      generated spans.
//   6. EVERY `covered-elsewhere` ROW'S CITED ASSERTION IS NOT DISABLED. The
//      other three statuses are facts about a directory this gate lists. This
//      one is a fact about a suite, and it is the only status whose evidence
//      lives in a file nothing else here reads.
//
// ASSERTION 6 IS WRITTEN AGAINST ADR-076 SECTION 1'S RULING AND NOT AGAINST
// WAVE-05 SECTION 2'S SENTENCE, AND THE DIFFERENCE IS THE WHOLE ITEM. The plan
// asks that "every such row's citation resolves and its file names the row's
// id". BOTH ARE TRUE OF `GS-072` AND ITS ASSERTION RUNS NOWHERE: the cited
// block is `describe.skipIf(!replayExists)` over `Object.keys(engine)
// .includes('replay')`, which is false, so the block reports a named skip, never
// enters its body, and the body throws rather than asserting. ADR-076 is
// WITHHELD on exactly that, in its own approval line, and the rule it gives
// instead is the one implemented here: A ROW IS DISCHARGED WHEN ITS ASSERTION IS
// EXECUTED SOMEWHERE A GATE CAN READ.
//
// HOW EXECUTION IS DETECTED IS RULED HERE, BECAUSE THE RULING SAYS "SOMEWHERE A
// GATE CAN READ" AND NOT WHICH GATE. Two honest answers exist.
//
//   THE ONE BUILT: A STATIC PARSE that refuses a citation whose every naming of
//   the row sits inside a construct carrying a modifier from `TEST_DISABLERS`,
//   or inside the comment run immediately above one, which is where this corpus
//   writes the id a block discharges. The vocabulary is the array and is not
//   restated here, for `FIXTURE_STATUSES`' reason one file over. It reads files
//   and nothing else, which is what every other check in this runner does.
//
//   THE ONE REFUSED: SHELLING OUT TO VITEST and reading which cases reported.
//   It is genuinely stronger -- it would see a case that runs and fails, which
//   the parse cannot -- and it is refused on two grounds that are not cost.
//   FIRST, `falsify.mjs` copies the tree WITHOUT `node_modules`, on a decision
//   its own loader-cases block states in terms, so a gate that needs a workspace
//   resolution CANNOT BE WATCHED FAILING; and a gate nobody has watched fail is
//   not a gate, which is the criterion this whole runner was chosen on. SECOND,
//   STRATEGY says of this runner that "a gate with an install step is a gate
//   that stops running on the day the install breaks", and a vitest gate is an
//   install step wearing a different hat.
//
// WHAT ASSERTION 6 CANNOT SEE, and it is more than the other five leave out.
// IT CANNOT SEE AN OUTCOME. A case that runs and FAILS reads here exactly like
// one that runs and passes; the suite is what asserts that, and `CI-01` is what
// runs the suite. IT CANNOT SEE WHICH case discharges the row, because the ids
// that name the executing cases are BUILT AT RUNTIME -- `it(reC('CV-01'))`
// composes `RE-C-01` from a template, so no parse in this tree reaches the title
// `RE-C-01` -- which is why the reader asks whether the row's naming is DISABLED
// and never whether the live naming is the assertion. A comment naming a row
// beside a live suite that asserts something else entirely passes here. THAT IS
// THE FLOOR AND THE DESK READ IS THE CEILING, and the floor is the half that
// runs on every push. IT TAKES A CONDITIONAL AS DISABLED: `runIf` is in the list
// beside `skip`, because a case that runs when a condition holds is a case this
// gate cannot promise ran, and a false condition is the entire subject here.
// AND IT READS EXTENT FROM INDENTATION, which prettier writes and
// `pnpm run format:check` enforces; where it cannot, it says so and fails rather
// than scoping a block to whatever it found.
//
// THE ONE READING IT DELIBERATELY DOES NOT TAKE. "Every naming must be live"
// would refuse a file that names the row from a live assertion AND from a
// skipped one, and that reader is BROADER THAN THE PROPERTY: section 39's rule
// is that a named suite runs an assertion for the row, which such a file
// satisfies. The strict half is not discarded, it is COUNTED -- the note prints
// how many rows name themselves from inside a disabled block as well as outside
// it, which is zero today and is the number to watch.
//
// ASSERTION 4 IS NARROWED AGAINST THE BRIEF, DELIBERATELY AND IN WRITING. The
// W8 brief says "every NON-WRITTEN row names a blocker from the closed
// vocabulary AND a citation". Read literally that flags the two `writable` rows,
// and it is the document that says otherwise: "`writable` means all three of
// ADR-072's conditions hold now. `blocked` means at least one fails". A blocker
// on a `writable` row is a contradiction and the absence of one is correct. So
// the assertion runs on `blocked` rows, and the `writable` and `written` rows
// get the OPPOSITE assertion rather than none: they must name no blocker at all.
// Every row is covered in both directions and no row is covered by nothing.
//
// ITS FIRST RUN WAS RED, THE THREE FINDINGS WERE REGISTERED RATHER THAN
// TOLERATED, AND THE REGISTER IS NOW EMPTY. `GS-049`, `GS-059` and `GS-080`
// were on disk with rows that did not say `written`: W2 (session 109) wrote
// `GS-080` and W4 (session 117) wrote `GS-059` and `GS-049`, and the status
// document is `W1`'s file, which was not in that session's fence. The register
// is `CI06U_REGISTER`'s idiom exactly and carries its defining property: A
// REGISTER ENTRY THAT NO LONGER NAMES A REAL DEFECT IS ITSELF A FINDING.
// Session 127 repaired all three rows and this gate then reported all three
// ENTRIES, which is the property working rather than the gate misfiring; they
// are removed in the commit that reads that finding. The map remains, empty,
// because it registers NAMED rows and never a blanket tolerance: a fourth
// fixture landing without its row moving fails on the day it lands.
//
// WHAT THE REGISTER DID NOT DECIDE. `GS-049`'s row read `blocked /
// format-cannot-express` on the argument that the scenario carries three probe
// shapes and one fixture is one stream. Whether one fixture DISCHARGES that row
// is a disposition question for the session that owns the file, not a parse, and
// this gate takes no view: it asserts only that a fixture on disk and a row that
// denies it cannot both stand. Section 39 now carries that disposition in prose
// above its own table, which is where a disposition belongs.
const FIXTURE_STATUS_DOC = 'docs/testing/golden-scenarios/39-fixture-status-and-blockers.md';
const FIXTURE_DIR = 'packages/rules-engine/fixtures';

// WRITTEN IN THE RUNNER, NOT DERIVED FROM THE DOCUMENT, on ADR-074 section 2's
// argument: a vocabulary computed from the terms currently in use admits every
// typo as a new term and can never fail. Assertion 5 then checks the document's
// summary table against this list in both directions, so the two cannot drift
// and a genuinely new blocker is a deliberate edit here.
//
// `covered-elsewhere` IS THE FOURTH AND IT ARRIVES WITH ASSERTION 6, NOT ALONE.
// ADR-076 section 1 adds it to the STATUS column and leaves the blocker
// vocabulary closed at six, on the argument that a blocker names which of W1,
// W2, W3 fails and on these rows none has. A status term admitted here with no
// assertion behind it would be the vacuity this list exists against, one column
// over: every other status is a fact this gate checks against the directory,
// and this one is a fact about a suite.
const FIXTURE_STATUSES = ['written', 'writable', 'blocked', 'covered-elsewhere'];
const FIXTURE_BLOCKERS = [
  'no-fixture-format',
  'format-cannot-express',
  'vendor-call',
  'outside-loader-boundary',
  'open-question',
  'no-plan-record-value',
];

// Each entry names a REAL defect and the session that created it. An entry that
// stops naming one is a finding (CI06U_REGISTER's property), so this map is the
// list of repairs the gate is waiting for and not a list of things it forgives.
//
// IT IS EMPTY, AND IT GOT THERE THE WAY THE PROPERTY SAYS IT SHOULD. It held
// `GS-080` (W2, session 109), `GS-059` and `GS-049` (W4, session 117): three
// fixtures on disk whose rows read `writable` or `blocked`, in a file the
// session that wrote the gate did not fence. Session 127 repaired all three
// rows to `written`, at which point the entries stopped naming a real defect
// and BECAME FINDINGS themselves -- which is what this map is for, and it is
// the reason they are deleted here rather than left as a comment. The map stays
// because the mechanism is not spent: a FOURTH fixture landing under a row that
// does not move is a finding on the day it lands, and registering it by name is
// how a repair gets recorded without a blanket tolerance being written.
const CI06FIXTURE_REGISTER = new Map([]);

// The registry set, read from every section file EXCEPT the status document. A
// scope that included the status document would be circular: the row would
// define the identifier the row is then checked against.
function goldenRegistryIds() {
  const dir = 'docs/testing/golden-scenarios';
  const files = readdirSync(join(ROOT, dir))
    .filter((f) => /^\d{2}-.*\.md$/.test(f))
    .filter((f) => join(dir, f) !== FIXTURE_STATUS_DOC)
    .sort()
    .map((f) => join(dir, f));
  if (files.length === 0) {
    throw new Error(`no GS section files in ${dir} outside the status document; scope is empty`);
  }
  const body = files.map((f) => read(f)).join('\n');
  const ids = new Set([...body.matchAll(/\b(GS-\d{3})\b/g)].map((m) => m[1]));
  if (ids.size === 0) {
    throw new Error(`no GS identifiers in ${dir} outside the status document; scope is empty`);
  }
  return ids;
}

// A row is `| GS-nnn | status | blocker | citation |`. Read positionally rather
// than by header name, and the row shape is asserted rather than assumed: a row
// with the wrong number of cells is a finding here and not a silent skip.
function fixtureStatusRows() {
  const rows = [];
  const lines = read(FIXTURE_STATUS_DOC).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\|\s*GS-\d{3}\s*\|/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    rows.push({
      id: /GS-\d{3}/.exec(cells[0])[0],
      status: (cells[1] ?? '').replace(/[`*]/g, ''),
      blocker: (cells[2] ?? '').replace(/[`*]/g, ''),
      citation: cells[3] ?? '',
      cells: cells.length,
      n: i + 1,
    });
  }
  if (rows.length === 0) {
    throw new Error(`no GS rows parsed from ${FIXTURE_STATUS_DOC}; the gate cannot run`);
  }
  return rows;
}

// The fixtures on disk, keyed by scenario. `.yaml` and `.expected.json` are
// tracked separately because assertion 3 is about the PAIR and reporting "no
// fixture" for a scenario missing only its expectation would name the wrong
// repair.
function fixturesOnDisk() {
  if (!existsSync(join(ROOT, FIXTURE_DIR))) {
    throw new Error(`${FIXTURE_DIR} does not exist; the fixture directory has moved or is gone`);
  }
  const found = new Map();
  for (const f of readdirSync(join(ROOT, FIXTURE_DIR)).sort()) {
    const m = /^(GS-\d{3})-.*?(\.expected\.json|\.yaml)$/.exec(f);
    if (!m) continue;
    const entry = found.get(m[1]) ?? { yaml: [], expected: [] };
    if (m[2] === '.yaml') entry.yaml.push(f);
    else entry.expected.push(f);
    found.set(m[1], entry);
  }
  if (found.size === 0) {
    throw new Error(`no GS fixtures found in ${FIXTURE_DIR}; every "written" row would fail`);
  }
  return found;
}

// -----------------------------------------------------------------------------
// ASSERTION 6's readers: is the cited assertion RUNNING, or merely present
// -----------------------------------------------------------------------------
// THE VOCABULARY OF A DISABLED TEST CONSTRUCT, written out here for
// FIXTURE_STATUSES' own reason and not computed from the tree. `runIf` is in the
// list beside `skip` and `skipIf` deliberately: a case that runs only when a
// condition holds is a case this gate cannot promise ran, and the whole subject
// of assertion 6 is a condition that was false. `only` is handled apart, below,
// because it does not disable the construct it sits on -- it silences every
// OTHER case in the file, which is the same defect pointing the other way.
const TEST_DISABLERS = ['skip', 'skipIf', 'todo', 'fails', 'runIf'];

// A citation names a test file when its link target ends in one of these. The
// filter is the first of section 39's three traps closed: "a path that resolves
// is not a running assertion", and `validate.ts` names four of these six rows
// beside the rule each one guards. A citation pointing there resolves, contains
// the id, and executes nothing.
const CITED_TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

// Every `describe`, `it` and `test` in a source file, with its modifier chain,
// the comment run immediately above it, and its extent.
//
// THE EXTENT IS READ FROM INDENTATION AND THAT IS A CHOICE WITH A PRICE. The
// alternative is a JavaScript lexer inside a gate that has none, to answer a
// question prettier already answers: the closer of a construct opened at column
// N is the next non-blank line at column N or less, and in a formatted tree it
// begins with `)` or `}`. WHEN IT DOES NOT, THE GATE SAYS SO AND FAILS rather
// than scoping the block to whatever it found -- a reader that guesses an extent
// would silently mis-scope a skip, which is the one thing this reader exists to
// locate. `pnpm run format:check` is a merge blocker, so the assumption is one
// the tree is already held to.
//
// THE COMMENT RUN IS PART OF THE BLOCK AND THAT IS NOT A CONVENIENCE. This
// corpus writes the `GS-nnn` a block discharges in the comment ABOVE the
// `describe`, which session 123 did for all six sites on purpose so a gate could
// find them. A reader that took only the block body would find `GS-072` nowhere
// inside `describe.skipIf(!replayExists)` and report the row clean.
function testConstructs(src) {
  const lines = src.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(describe|it|test)((?:\.[A-Za-z]+)*)\s*[(`]/.exec(lines[i]);
    if (m === null) continue;
    const [, indent, kind, chain] = m;
    let end = 0;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '') continue;
      if (/^\s*/.exec(lines[j])[0].length > indent.length) continue;
      // `it.each([` closes its TABLE at the opener's own column and re-opens the
      // call on the same line: `])('%s ...', (a, b) => {`. That line is a
      // continuation of the opener and not its closer, and a reader that stopped
      // there would scope every `.each` block to its argument list. Four of the
      // six sites assertion 6 reads are written that way.
      if (/^\s*[\]`,]/.test(lines[j])) continue;
      end = /^\s*[)}]/.test(lines[j]) ? j + 1 : -1;
      break;
    }
    let top = i;
    while (top > 0 && /^\s*\/\//.test(lines[top - 1])) top--;
    const mods = chain.split('.').filter(Boolean);
    out.push({
      n: i + 1,
      spelling: `${kind}${chain}`,
      mods,
      disabled: mods.some((x) => TEST_DISABLERS.includes(x)),
      only: mods.includes('only'),
      top: top + 1,
      end,
    });
  }
  return out;
}

// The repository-relative link targets a citation cell names, resolved against
// the status document's own directory. Anchors are dropped and absolute schemes
// are skipped; `join` normalises the `../../../` these citations are written in.
function citedPaths(citation) {
  const dir = dirname(FIXTURE_STATUS_DOC);
  const out = [];
  for (const m of citation.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1].split('#')[0];
    if (target === '' || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    const rel = join(dir, target);
    if (!out.includes(rel)) out.push(rel);
  }
  return out;
}

// The two summary tables above the rows. Read by a FLAT scan for a row whose
// first cell is a declared term and whose second parses as an integer, which is
// safe here rather than lax: a data row's first cell is always `GS-nnn`, and a
// blocker term appears in a data row's THIRD cell and never its first, so no
// data row can be mistaken for a summary row.
function fixtureSummaryCounts(vocabulary) {
  const declared = new Map();
  for (const line of read(FIXTURE_STATUS_DOC).split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim().replace(/[`*]/g, ''));
    if (cells.length < 2) continue;
    if (!vocabulary.includes(cells[0])) continue;
    if (!/^\d+$/.test(cells[1])) continue;
    declared.set(cells[0], Number(cells[1]));
  }
  return declared;
}

const fixtureInventory = {
  id: 'CI-06/fixture-inventory',
  title: 'The fixture registry and the fixture directory agree, in both directions',
  covers:
    'The 316 rows of docs/testing/golden-scenarios/39-fixture-status-and-blockers.md against ' +
    'the golden-scenario registry and against packages/rules-engine/fixtures. SIX ' +
    'ASSERTIONS. (1) Every registered GS-nnn has exactly one row and every row names a ' +
    'registered scenario, with the registry read from the OTHER section files so the scope ' +
    'is not circular. (2) Every fixture on disk has a "written" row -- THE DIRECTION CI-03 ' +
    'REPORTS AS NOT SWITCHED ON, on every run, in its own words. (3) No row claims "written" ' +
    'without BOTH the .yaml and its .expected.json sibling. (4) Every "blocked" row names a ' +
    'blocker from the closed vocabulary AND a citation, and every row that is not blocked ' +
    'names NO blocker. (5) The two summary tables equal the counts derived from the rows, ' +
    'and their term lists equal the closed vocabularies in both directions. (6) Every ' +
    '"covered-elsewhere" row cites a TEST file that resolves, names the row, and does not ' +
    'name it ONLY from inside a disabled construct (skip, skipIf, todo, fails, runIf) or the ' +
    'comment run above one. ' +
    'ASSERTION 6 IMPLEMENTS ADR-076 SECTION 1 AND NOT WAVE-05 SECTION 2, DELIBERATELY. The ' +
    'plan asks that the citation resolve and the file name the id; both are true of GS-072, ' +
    'whose cited block is a describe.skipIf over a false condition whose body throws, and ' +
    'ADR-076 is WITHHELD on precisely that. The ruling makes discharge depend on the ' +
    'assertion being EXECUTED, so that is what is asserted. ' +
    'IT IS A STATIC PARSE AND NOT A VITEST RUN, RULED HERE. A run would be stronger and is ' +
    'refused because falsify.mjs copies the tree without node_modules, so a gate needing a ' +
    'workspace resolution can never be watched failing -- and a gate nobody has watched fail ' +
    'is not a gate. THREE THINGS IT CANNOT SEE. It cannot see an OUTCOME, so a case that ' +
    'runs and fails reads like one that passes. It cannot see WHICH case discharges the row, ' +
    'because the executing ids are built at runtime (it(reC("CV-01")) composes RE-C-01 from ' +
    'a template), so it asks whether the naming is disabled and never whether the live ' +
    'naming is the assertion. And it reads block extent from INDENTATION, saying so and ' +
    'failing where it cannot rather than scoping a block to whatever it found. ' +
    'ASSERTION 4 IS NARROWED AGAINST THE W8 BRIEF, IN WRITING. The brief says every ' +
    'NON-WRITTEN row names a blocker, which would flag the two "writable" rows; the document ' +
    'defines writable as all three ADR-072 conditions holding, so a blocker there is a ' +
    'contradiction. Those rows get the opposite assertion rather than none. ' +
    'THE VOCABULARIES ARE WRITTEN IN THE RUNNER AND NOT DERIVED (ADR-074 section 2): a ' +
    'vocabulary computed from the terms in use admits every typo and can never fail. ' +
    'ROWS ARE REGISTERED, NEVER EXEMPTED, AND THE REGISTER IS EMPTY TODAY. It held GS-049, ' +
    'GS-059 and GS-080, on disk with rows that denied it; session 127 repaired all three and ' +
    'the entries then became findings in their own right, which is the property working. Its ' +
    'size prints on every run and is deliberately not restated here. A FOURTH such fixture ' +
    'fails on the day it lands. ' +
    'TWO THINGS IT DOES NOT DO. It does not read a fixture body, so a .yaml that pins the ' +
    'wrong thing is CI-03 and the loader cases, never this gate. And it takes no view on ' +
    'whether one fixture DISCHARGES a row arguing several probe shapes, which is a ' +
    'disposition for the session that owns the file.',
  run() {
    const findings = [];
    const rows = fixtureStatusRows();
    const registry = goldenRegistryIds();
    const disk = fixturesOnDisk();

    // -- 1. one row per registered scenario, both directions --------------
    const byId = new Map();
    for (const r of rows) {
      if (r.cells !== 4) {
        findings.push(
          `${FIXTURE_STATUS_DOC}:${r.n}: the ${r.id} row has ${r.cells} cells, not the four ` +
            'this table declares (id, status, blocker, citation). A row this gate cannot read ' +
            'positionally is a row it would otherwise skip in silence',
        );
      }
      byId.set(r.id, [...(byId.get(r.id) ?? []), r.n]);
    }
    for (const id of [...byId.keys()].sort()) {
      const at = byId.get(id);
      if (at.length > 1) {
        findings.push(
          `${FIXTURE_STATUS_DOC}: ${id} has ${at.length} rows, at line(s) ${at.join(', ')}. ` +
            'One row per scenario: two rows are two statuses and the registry cannot say which',
        );
      }
    }
    for (const id of [...registry].sort()) {
      if (!byId.has(id)) {
        findings.push(
          `${FIXTURE_STATUS_DOC}: ${id} is registered in the golden-scenario registry and has ` +
            'no row here, so its fixture status is stated nowhere (ADR-072)',
        );
      }
    }
    for (const id of [...byId.keys()].sort()) {
      if (!registry.has(id)) {
        findings.push(
          `${FIXTURE_STATUS_DOC}: ${id} has a row here and is not in the golden-scenario ` +
            'registry, so the row states a status for a scenario that does not exist',
        );
      }
    }

    // -- 2. every fixture on disk has a `written` row ----------------------
    const written = new Set(rows.filter((r) => r.status === 'written').map((r) => r.id));
    const stale = [];
    for (const id of [...disk.keys()].sort()) {
      if (written.has(id)) continue;
      const row = rows.find((r) => r.id === id);
      const says = row ? `reads "${row.status}"` : 'has no row at all';
      if (CI06FIXTURE_REGISTER.has(id)) {
        stale.push(id);
        continue;
      }
      findings.push(
        `${FIXTURE_STATUS_DOC}: ${id} has a fixture on disk (${disk.get(id).yaml.join(', ')}) ` +
          `and its row ${says}. This is the direction CI-03 reports as not switched on: a ` +
          'fixture landed and the registry did not move. Either the row becomes "written" ' +
          'with a citation pointing at the fixture, or the fixture is not a fixture',
      );
    }

    // The register's own property, and the reason it cannot become furniture:
    // an entry naming a row that has since been repaired is a finding here.
    for (const [id, why] of CI06FIXTURE_REGISTER) {
      if (!disk.has(id)) {
        findings.push(
          `scripts/corpus/gates.mjs: CI06FIXTURE_REGISTER holds ${id} and no fixture for it is ` +
            `on disk, so the entry no longer names a real defect. Remove it. (${why})`,
        );
      } else if (written.has(id)) {
        findings.push(
          `scripts/corpus/gates.mjs: CI06FIXTURE_REGISTER holds ${id} and its row now reads ` +
            '"written", so the entry no longer names a real defect. Remove it, in the commit ' +
            'that repairs the row (WAVE-03: a register entry goes with its repair)',
        );
      }
    }

    // -- 3. no `written` row without both files ---------------------------
    for (const r of rows.filter((x) => x.status === 'written')) {
      const on = disk.get(r.id);
      if (!on || on.yaml.length === 0) {
        findings.push(
          `${FIXTURE_STATUS_DOC}:${r.n}: ${r.id} claims "written" and no ${r.id}-*.yaml is in ` +
            `${FIXTURE_DIR}. ADR-072: the status is derived from the directory, not from this file`,
        );
        continue;
      }
      if (on.expected.length === 0) {
        findings.push(
          `${FIXTURE_STATUS_DOC}:${r.n}: ${r.id} claims "written" and has ${on.yaml.join(', ')} ` +
            'with no .expected.json sibling. A fixture with no expectation is a scenario the ' +
            'loader cannot run and the registry calls done',
        );
      }
    }

    // -- 4. status and blocker vocabulary, and the citation ---------------
    for (const r of rows) {
      if (!FIXTURE_STATUSES.includes(r.status)) {
        findings.push(
          `${FIXTURE_STATUS_DOC}:${r.n}: ${r.id} has status "${r.status}", which is not one of ` +
            `${FIXTURE_STATUSES.join(', ')} (ADR-072)`,
        );
        continue;
      }
      if (r.status === 'blocked') {
        if (!FIXTURE_BLOCKERS.includes(r.blocker)) {
          findings.push(
            `${FIXTURE_STATUS_DOC}:${r.n}: ${r.id} is blocked and names "${r.blocker}", which ` +
              `is not in the closed vocabulary (${FIXTURE_BLOCKERS.join(', ')}). A blocker ` +
              'outside the vocabulary is a reason nobody can count or clear',
          );
        }
        if (r.citation === '') {
          findings.push(
            `${FIXTURE_STATUS_DOC}:${r.n}: ${r.id} is blocked and cites nothing. ADR-072 ` +
              'requires a stated blocker WITH a citation that supports it; a blocker with no ' +
              'citation is an assertion, which is the thing the table replaced',
          );
        }
      } else if (r.blocker !== '') {
        findings.push(
          `${FIXTURE_STATUS_DOC}:${r.n}: ${r.id} is "${r.status}" and still names the blocker ` +
            `"${r.blocker}". Only a blocked row has a blocker: writable means every ADR-072 ` +
            'condition holds, and written means the fixture is on disk',
        );
      }
    }

    // -- 5. the summary tables are derived from the rows -------------------
    const derived = new Map(FIXTURE_STATUSES.map((s) => [s, 0]));
    const derivedBlockers = new Map(FIXTURE_BLOCKERS.map((b) => [b, 0]));
    for (const r of rows) {
      if (derived.has(r.status)) derived.set(r.status, derived.get(r.status) + 1);
      if (r.status === 'blocked' && derivedBlockers.has(r.blocker)) {
        derivedBlockers.set(r.blocker, derivedBlockers.get(r.blocker) + 1);
      }
    }
    for (const [vocabulary, actual, what] of [
      [FIXTURE_STATUSES, derived, 'status'],
      [FIXTURE_BLOCKERS, derivedBlockers, 'blocker'],
    ]) {
      const declared = fixtureSummaryCounts(vocabulary);
      for (const term of vocabulary) {
        if (!declared.has(term)) {
          findings.push(
            `${FIXTURE_STATUS_DOC}: the ${what} summary table has no row for "${term}", which ` +
              `the rows below use ${actual.get(term)} time(s). A vocabulary term with no ` +
              'summary row is a count nobody maintains',
          );
          continue;
        }
        if (declared.get(term) !== actual.get(term)) {
          findings.push(
            `${FIXTURE_STATUS_DOC}: the ${what} summary says ${declared.get(term)} row(s) are ` +
              `"${term}" and the rows below give ${actual.get(term)}. This is a ` +
              'hand-maintained count over hand-maintained rows (ADR-034) and CI-06g cannot ' +
              'reach it, because it is not a generated span',
          );
        }
      }
      for (const term of declared.keys()) {
        if (vocabulary.includes(term)) continue;
        findings.push(
          `${FIXTURE_STATUS_DOC}: the ${what} summary declares "${term}", which is not in the ` +
            "runner's closed vocabulary. Adding a term is a deliberate edit to gates.mjs " +
            '(ADR-074 section 2: a vocabulary derived from what is in use can never fail)',
        );
      }
    }

    // -- 6. a `covered-elsewhere` row's assertion must be EXECUTED ---------
    // ADR-076 section 1's governing rule, and NOT WAVE-05 section 2's sentence.
    // The plan's row asks that "every such row's citation resolves and its file
    // names the row's id"; both are true of GS-072, whose cited block is a
    // `describe.skipIf` over a false condition and whose body throws rather than
    // asserting, and ADR-076 is WITHHELD on exactly that. So the plan's
    // assertion is implemented as its ruling states it and not as it spells it.
    //
    // The first condition, "the scenario has no golden fixture", needs no code
    // here: assertion 2 already fails any row that is not `written` while a
    // fixture for it sits on disk, and a `covered-elsewhere` row with a fixture
    // is that finding.
    let mixed = 0;
    for (const r of rows.filter((x) => x.status === 'covered-elsewhere')) {
      const cited = citedPaths(r.citation).filter((p) => CITED_TEST_FILE.test(p));
      const resolved = cited.filter((p) => existsSync(join(ROOT, p)));
      if (resolved.length === 0) {
        findings.push(
          `${FIXTURE_STATUS_DOC}:${r.n}: ${r.id} is "covered-elsewhere" and no cited suite ` +
            `EXECUTES it: its citation names ${cited.length} test file(s) and ${
              cited.length === 0
                ? 'a status meaning "a named suite runs it" has to name the suite'
                : `none of them is on disk (${cited.join(', ')})`
            }`,
        );
        continue;
      }
      let live = 0;
      const why = [];
      for (const p of resolved) {
        const lines = read(p).split('\n');
        const at = lines.flatMap((l, i) => (l.includes(r.id) ? [i + 1] : []));
        if (at.length === 0) {
          why.push(`${p} does not name ${r.id} anywhere`);
          continue;
        }
        const constructs = testConstructs(lines.join('\n'));
        const unreadable = constructs.filter((c) => c.end <= 0);
        if (unreadable.length > 0) {
          findings.push(
            `${p}:${unreadable[0].n}: this gate cannot read where \`${unreadable[0].spelling}\` ` +
              'closes, so it cannot tell whether it is skipped, and it refuses to guess. The ' +
              'extent is read as the next non-blank line indented no deeper than the opener, ' +
              'which prettier writes and `pnpm run format:check` enforces',
          );
          why.push(`${p} has a construct whose extent this gate cannot read`);
          continue;
        }
        if (constructs.length === 0) {
          why.push(`${p} declares no describe, it or test at all`);
          continue;
        }
        const only = constructs.find((c) => c.only);
        if (only) {
          why.push(
            `${p} carries \`${only.spelling}\` at :${only.n}, which silences every other case ` +
              'in the file',
          );
          continue;
        }
        const dead = constructs.filter((c) => c.disabled);
        const buried = at.filter((n) => dead.some((c) => n >= c.top && n <= c.end));
        if (buried.length === at.length) {
          const c = dead.find((x) => at[0] >= x.top && at[0] <= x.end);
          why.push(
            `${p} names ${r.id} at line(s) ${buried.join(', ')} and every one of them is inside ` +
              `\`${c.spelling}\` opened at :${c.n}, which reports a named skip and never enters ` +
              'its body',
          );
          continue;
        }
        if (buried.length > 0) mixed++;
        live++;
      }
      if (live === 0) {
        findings.push(
          `${FIXTURE_STATUS_DOC}:${r.n}: ${r.id} is "covered-elsewhere" and no cited suite ` +
            `EXECUTES it: ${why.join('; ')}. ADR-076 section 1 discharges a row when its ` +
            'assertion is EXECUTED somewhere a gate can read, and "the path resolves and the ' +
            'file names the id" is satisfied by a skipped block',
        );
      }
    }

    console.log(
      `       CI-06/fixture-inventory note: ${rows.length} row(s) against ${registry.size} ` +
        `registered scenario(s) and ${disk.size} fixture(s) on disk ` +
        `(${[...derived].map(([s, n]) => `${n} ${s}`).join(', ')}); ` +
        `${stale.length} stale row(s) registered across ${CI06FIXTURE_REGISTER.size} entry ` +
        (CI06FIXTURE_REGISTER.size === 0
          ? '(entries), so every fixture on disk is claimed by a row that says so'
          : '(entries), each one a repair this gate is waiting for') +
        `; ${derived.get('covered-elsewhere')} covered-elsewhere row(s) read for EXECUTION, ` +
        `${mixed} of them naming their row from inside a disabled block as well as outside it`,
    );
    return findings;
  },
};

// -----------------------------------------------------------------------------
// CI-06/identifier-series  Every member of a declared series has ONE definition
// -----------------------------------------------------------------------------
// ADR-074, IMPLEMENTED AS RULED. Its scope, its exemptions and its
// definition-site parse are that ruling's and not this session's. Where the
// ruling and the tree disagree the disagreement is REPORTED and never resolved
// by re-scoping, and there are four such places; each is named below and every
// one is also in the pull request.
//
// THE RULE, QUOTED FROM ADR-074 SECTION 1 RATHER THAN PARAPHRASED:
//
//   "A definition site is a table row whose first cell LEADS with the
//    identifier, or a markdown heading whose text LEADS with the identifier,
//    occurring inside the series' DECLARED REGISTER. Every member of an
//    in-scope series has exactly one. Every other occurrence anywhere in the
//    repository is a citation and is unconstrained."
//
// Four things in that sentence are load bearing and each is a measurement.
//
//   "LEADS WITH", NOT "EQUALS". STATE writes its finding rows as
//   `| **`OI-06`. The 48 hour payout-destination cooling window has no
//   storage.** |`: identifier, full stop, then the finding, all in one cell. An
//   equality rule reports the six rows that exist as six rows that do not.
//
//   A ROW OR A HEADING, AND NOT A BOLD LEAD. The heading shape carries the 42
//   `AS-*` and `OQ-*` series that have no rows at all. The bold lead is
//   rejected because a bold span opening a line is this corpus's ordinary
//   emphasis idiom, present thousands of times, and admitting it makes the rule
//   match prose.
//
//   INSIDE THE DECLARED REGISTER, WHICH IS THE WHOLE RULING. A first cell is
//   not always an identity: `ADR-014` leads four rows, its own register row and
//   three in ADR-052 and ADR-057 whose first column is THE SOURCE BEING QUOTED.
//   Scoping the search to a named register removes that class instead of
//   enumerating it. A register is a FILE, or a file and ONE `##` SECTION, and
//   the section granularity is not a convenience: M01 section 1 holds `INV`'s
//   24 definition rows and Appendix A holds one more for the same identifier in
//   a COVERAGE table, so a file-wide register reports `INV` as broken. Measured
//   here: section scoping is what takes `INV`, `CV` and `RB` from failing to
//   clean.
//
//   THE SEARCH SPACE IS THE REPOSITORY, NOT `docs/`. Registers already live
//   under `packages/`.
//
// THE SCOPE IS WRITTEN, NEVER DISCOVERED (ADR-074 section 2), and this is the
// assertion the gate is worth nothing without. A gate whose scope is "every
// series that currently satisfies the rule" PASSES FOREVER BY CONSTRUCTION: the
// day a series breaks it leaves scope and the gate reports 115 of 115. So the
// table below is a closed list, one argued entry each, and it is here rather
// than in a document for CI-06w's reason: the registration and the
// implementation are the same line and cannot drift apart.
//
// FOUR PLACES WHERE THE RULING AND THE TREE DISAGREE. Each is reported, none is
// resolved by widening or narrowing on this session's authority.
//
//   1. THE COUNT DOES NOT REPRODUCE, AND ADR-074 SECTION 3 ASKS FOR EXACTLY
//      THIS CHECK: "The count is stated so W8 can check that its transcription
//      reproduced it." It states 118 series and 1,086 members. Transcribing its
//      own four classes gives 117 and 1,083, and the two class subtotals are
//      where it goes: the module row says 96 against the 93 its own rule
//      enumerates, and the design row says 7 against the 9 series it lists by
//      name (`DG`, `SS`, and seven `OQ-*`). The two errors are +3 and -2 and the
//      TOTAL is therefore right by one. Nothing is added to close the gap:
//      adding a series ADR-074 does not name would be choosing scope, which
//      section 2 makes the ruling's job and not the runner's.
//   2. `OQ-F6` IS RULED IN SCOPE AND HAS NO REGISTER THAT SECTION 1 ADMITS.
//      Its only definition sites are table rows in a SESSION LOG, and a session
//      log is a registry ENTRY rather than a corpus document (ADR-043). Section
//      1 requires "a corpus document or a package README". The RULE governs the
//      LIST that applies it, so `OQ-F6` is PENDING: a real defect, named, with
//      the artifact it waits for. That is section 5's own mechanism and not an
//      exemption; it is counted, and it fails the day a register appears
//      without the series being promoted.
//   3. `P-M6` IS RULED IN SCOPE AND HAS A MEMBER THAT WAS DELIBERATELY NOT
//      MINTED. `P-M6-11` appears in session 112, which says so in terms: "a
//      `P-M6-nn` written in application code is a claim on a series with no
//      allocation table". Whoever holds M06 next decides whether the panel
//      table gains a row or the third number lives inside `P-M6-01`'s block.
//      That is a disposition and not a parse, so `P-M6` is PENDING with that
//      decision named as the artifact.
//   4. SECTION 5 NAMES TEN OF THE EIGHTEEN SERIES IN ITS FIRST PENDING CLASS.
//      The other eight are not identified anywhere in the ruling or the survey,
//      and eight of the twelve candidates in the tree would have to be picked
//      by this session to reach the stated count. They are not. The pending
//      register below holds the TEN THAT ARE NAMED plus `OQ-F6` and `P-M6`, and
//      the shortfall against 44 is reported rather than filled in.
//
// SO: 115 SERIES, 1,070 MEMBERS, ZERO FINDINGS ON ARRIVAL, which is the state
// ADR-074 section 6 rules the gate must arrive in, reached at three fewer
// series than it states and with every difference written down. A gate over
// 1,070 members that passes the day it is written has proven nothing yet; its
// value is entirely in what it refuses tomorrow, and the two mechanisms that
// make that real are the written scope above and the pending register below.

// The DECLARED SCOPE. `series -> register`, where a register is a file, or a
// file and one `##` section written after a `##` separator, or an ADR-043
// registry directory. Grouped by ADR-074 section 3's four classes.
const DECLARED_SERIES = new Map([
  // ---------------------------------------------------------------------------
  // 93 in the module plan that owns the series: `INV-M*`, `AS-M*`, `FM-M*`,
  // `DEP-M*` and each module's own specials, in M02 through M21. `AS-M*` is
  // defined by HEADING, consistently, which is the shape a row-only rule misses
  // on 349 members. Two are declared rather than derived and would be wrong if
  // derived: `M12` has TWO plan files and the series live in the transparency
  // one, and `NC-M16` needs a section because M16 section 3 repeats its
  // identifiers in a state table.
  // ---------------------------------------------------------------------------
  ['AN-M13', 'docs/plans/M13-trader-analytics-journal.md'],
  ['AS-M10', 'docs/plans/M10-integrations.md'],
  ['AS-M11', 'docs/plans/M11-certificates-social-proof.md'],
  ['AS-M12', 'docs/plans/M12-transparency-platform.md'],
  ['AS-M13', 'docs/plans/M13-trader-analytics-journal.md'],
  ['AS-M14', 'docs/plans/M14-loyalty-retention.md'],
  ['AS-M15', 'docs/plans/M15-discord-integration.md'],
  ['AS-M16', 'docs/plans/M16-notification-center.md'],
  ['AS-M17', 'docs/plans/M17-offers-engine.md'],
  ['AS-M18', 'docs/plans/M18-graduation-track.md'],
  ['AS-M19', 'docs/plans/M19-kyc-identity.md'],
  ['AS-M2', 'docs/plans/M02-rithmic-bridge.md'],
  ['AS-M20', 'docs/plans/M20-wallet.md'],
  ['AS-M21', 'docs/plans/M21-plan-designer.md'],
  ['AS-M3', 'docs/plans/M03-billing-checkout.md'],
  ['AS-M4', 'docs/plans/M04-trader-portal.md'],
  ['AS-M5', 'docs/plans/M05-payout-system.md'],
  ['AS-M6', 'docs/plans/M06-admin-ops-console.md'],
  ['AS-M7', 'docs/plans/M07-risk-abuse.md'],
  ['AS-M8', 'docs/plans/M08-affiliate-system.md'],
  ['AS-M9', 'docs/plans/M09-marketing-site.md'],
  ['CT-M11', 'docs/plans/M11-certificates-social-proof.md'],
  ['DEP-M10', 'docs/plans/M10-integrations.md'],
  ['DEP-M11', 'docs/plans/M11-certificates-social-proof.md'],
  ['DEP-M12', 'docs/plans/M12-transparency-platform.md'],
  ['DEP-M13', 'docs/plans/M13-trader-analytics-journal.md'],
  ['DEP-M14', 'docs/plans/M14-loyalty-retention.md'],
  ['DEP-M15', 'docs/plans/M15-discord-integration.md'],
  ['DEP-M16', 'docs/plans/M16-notification-center.md'],
  ['DEP-M17', 'docs/plans/M17-offers-engine.md'],
  ['DEP-M18', 'docs/plans/M18-graduation-track.md'],
  ['DEP-M19', 'docs/plans/M19-kyc-identity.md'],
  ['DEP-M2', 'docs/plans/M02-rithmic-bridge.md'],
  ['DEP-M20', 'docs/plans/M20-wallet.md'],
  ['DEP-M21', 'docs/plans/M21-plan-designer.md'],
  ['DEP-M3', 'docs/plans/M03-billing-checkout.md'],
  ['DEP-M4', 'docs/plans/M04-trader-portal.md'],
  ['DEP-M5', 'docs/plans/M05-payout-system.md'],
  ['DEP-M6', 'docs/plans/M06-admin-ops-console.md'],
  ['DEP-M7', 'docs/plans/M07-risk-abuse.md'],
  ['DEP-M8', 'docs/plans/M08-affiliate-system.md'],
  ['DEP-M9', 'docs/plans/M09-marketing-site.md'],
  ['FM-M10', 'docs/plans/M10-integrations.md'],
  ['FM-M11', 'docs/plans/M11-certificates-social-proof.md'],
  ['FM-M12', 'docs/plans/M12-transparency-platform.md'],
  ['FM-M13', 'docs/plans/M13-trader-analytics-journal.md'],
  ['FM-M14', 'docs/plans/M14-loyalty-retention.md'],
  ['FM-M15', 'docs/plans/M15-discord-integration.md'],
  ['FM-M16', 'docs/plans/M16-notification-center.md'],
  ['FM-M17', 'docs/plans/M17-offers-engine.md'],
  ['FM-M18', 'docs/plans/M18-graduation-track.md'],
  ['FM-M19', 'docs/plans/M19-kyc-identity.md'],
  ['FM-M2', 'docs/plans/M02-rithmic-bridge.md'],
  ['FM-M20', 'docs/plans/M20-wallet.md'],
  ['FM-M21', 'docs/plans/M21-plan-designer.md'],
  ['FM-M3', 'docs/plans/M03-billing-checkout.md'],
  ['FM-M4', 'docs/plans/M04-trader-portal.md'],
  ['FM-M5', 'docs/plans/M05-payout-system.md'],
  ['FM-M6', 'docs/plans/M06-admin-ops-console.md'],
  ['FM-M7', 'docs/plans/M07-risk-abuse.md'],
  ['FM-M8', 'docs/plans/M08-affiliate-system.md'],
  ['FM-M9', 'docs/plans/M09-marketing-site.md'],
  ['GP-M18', 'docs/plans/M18-graduation-track.md'],
  ['IN-M10', 'docs/plans/M10-integrations.md'],
  ['INV-M10', 'docs/plans/M10-integrations.md'],
  ['INV-M11', 'docs/plans/M11-certificates-social-proof.md'],
  ['INV-M12', 'docs/plans/M12-transparency-platform.md'],
  ['INV-M13', 'docs/plans/M13-trader-analytics-journal.md'],
  ['INV-M14', 'docs/plans/M14-loyalty-retention.md'],
  ['INV-M15', 'docs/plans/M15-discord-integration.md'],
  ['INV-M16', 'docs/plans/M16-notification-center.md'],
  ['INV-M17', 'docs/plans/M17-offers-engine.md'],
  ['INV-M18', 'docs/plans/M18-graduation-track.md'],
  ['INV-M19', 'docs/plans/M19-kyc-identity.md'],
  ['INV-M2', 'docs/plans/M02-rithmic-bridge.md'],
  ['INV-M20', 'docs/plans/M20-wallet.md'],
  ['INV-M21', 'docs/plans/M21-plan-designer.md'],
  ['INV-M3', 'docs/plans/M03-billing-checkout.md'],
  ['INV-M4', 'docs/plans/M04-trader-portal.md'],
  ['INV-M5', 'docs/plans/M05-payout-system.md'],
  ['INV-M7', 'docs/plans/M07-risk-abuse.md'],
  ['INV-M8', 'docs/plans/M08-affiliate-system.md'],
  ['INV-M9', 'docs/plans/M09-marketing-site.md'],
  ['LM-M14', 'docs/plans/M14-loyalty-retention.md'],
  ['LT', 'docs/plans/M05-payout-system.md'],
  ['NC-M16', 'docs/plans/M16-notification-center.md##1. Purpose and invariants'],
  ['OF-M17', 'docs/plans/M17-offers-engine.md'],
  ['PL-M19', 'docs/plans/M19-kyc-identity.md'],
  ['RS-M15', 'docs/plans/M15-discord-integration.md'],
  ['SC-M4', 'docs/plans/M04-trader-portal.md'],
  ['V-M2', 'docs/plans/M02-rithmic-bridge.md'],
  ['WF-M20', 'docs/plans/M20-wallet.md'],
  // ---------------------------------------------------------------------------
  // 5 in M01, each in its own `##` section. ADR-074 section 3 labels this row
  // "four series in three sections" and its count column says 5; five series in
  // five sections is what the tree holds, and the sections are load bearing
  // rather than decorative -- `INV` and `CV` both have a second, COVERAGE row in
  // Appendix A for identifiers section 1 and section 2 already define.
  // ---------------------------------------------------------------------------
  ['INV', 'docs/plans/M01-rules-engine.md##1. Purpose and invariants'],
  ['CV', 'docs/plans/M01-rules-engine.md##2. Entities and schema deltas'],
  ['FM', 'docs/plans/M01-rules-engine.md##6. Failure modes'],
  ['AS', 'docs/plans/M01-rules-engine.md##7. Adversarial scenarios'],
  ['RE-P', 'docs/plans/M01-rules-engine.md##8. Test plan'],
  // ---------------------------------------------------------------------------
  // 10 in a testing or architecture document. `S` and `D` are in this class by
  // ADR-074 section 3 and their registers are module plans, which is the
  // ruling's classification and the tree's location disagreeing about a label
  // rather than about a fact. `RB` needs a section: the runbooks README carries
  // a definition table in section 2 and a carried-forward table in section 4.
  // `FOLD`'s register is an ADR-043 registry DIRECTORY, which section 6 of the
  // survey records as a real register shape for `EC` and `ADR` too.
  // ---------------------------------------------------------------------------
  ['C', 'docs/architecture/SECURITY.md'],
  ['PT', 'docs/testing/STRATEGY.md'],
  ['TR', 'docs/testing/STRATEGY.md'],
  ['VG', 'docs/testing/STRATEGY.md'],
  ['RE-S', 'docs/testing/SIMULATION_HARNESS.md'],
  ['PP', 'docs/testing/SIMULATION_HARNESS.md'],
  ['S', 'docs/plans/M12-statistic-definitions.md'],
  ['D', 'docs/plans/M07-risk-abuse.md'],
  ['RB', 'docs/ops/runbooks/README.md##2. The runbooks'],
  ['FOLD', 'docs/testing/golden-scenarios'],
  // ---------------------------------------------------------------------------
  // 7 in a design or fold document. ADR-074 names NINE here and counts seven;
  // the nine are these eight plus `OQ-F6`, which is pending below because its
  // only definition sites are in a session log. Seven `OQ-*` sub-series are in
  // scope and twenty are not, and the split is a finding rather than an
  // inconsistency: the FOLD and PHASE plans register their open questions in the
  // document that raises them and the MODULE plans do not. Same prefix, two
  // conventions, one of them checkable. `OQ-P1` is clean and identically shaped
  // to `OQ-P2` and ADR-074 does not name it, so it is undeclared and counted.
  // ---------------------------------------------------------------------------
  ['DG', 'docs/design/DESIGN_SYSTEM.md'],
  ['SS', 'docs/design/DESIGN_SYSTEM.md'],
  ['OQ-F3', 'docs/plans/FOLD-03-vendor-parity-gap-fill.md'],
  ['OQ-F4', 'docs/plans/FOLD-04-impersonation-and-admin-parity.md'],
  ['OQ-F5', 'docs/plans/FOLD-05-plan-config-and-designer.md'],
  ['OQ-SE', 'docs/plans/P1-SE-trading-calendar.md'],
  ['OQ-P2', 'docs/plans/P2-rules-engine.md'],
  ['OQ-FREEZE', 'docs/STATE.md'],
]);

// THE PENDING REGISTER (ADR-074 section 5). 44 series are neither in scope nor
// exempt, and calling them exempt would be the dishonest move that section
// exists to avoid. They are PENDING: a real defect, named, with the artifact it
// waits for.
//
// IT CARRIES `CI06U_REGISTER`'s DEFINING PROPERTY: a register entry that no
// longer names a real defect is a FINDING. So it shrinks as repairs land and it
// cannot become furniture. The predicate is stated rather than assumed: an entry
// is still real while at least one member of the series lacks exactly one
// definition site across every CORPUS DOCUMENT in the tree. A series every one
// of whose members has become singly defined has effectively been repaired, and
// the gate then fails until it is promoted into the declared scope IN THE SAME
// COMMIT, which is WAVE-03's rule that a register entry travels with its repair.
//
// THIS HOLDS 38 AND ADR-074 STATES 44. Section 5 names ten of the eighteen in
// its first class; the other eight are identified nowhere in the ruling or in
// the survey, and picking eight of the twelve candidates in the tree would be
// this session choosing scope. `OQ-F6` and `P-M6` are here for the reasons given
// above and are the 37th and 38th. The shortfall is reported, not filled in.
const PENDING_SERIES = new Map([
  // A register with holes or doubles: the repair is to the register. Ten of the
  // eighteen ADR-074 section 5 counts, which is all of the ones it names.
  ['R', "a repair to M01's rule table: 13 members are doubled because a coverage table shares a section with the definition table"],
  ['ST', "a repair to M12's table: 7 members doubled, the same coverage-beside-definition shape"],
  ['RE-U', 'a table in the document that owns it; members have no row'],
  ['L', 'a table in the fixtures README; members have no row'],
  ['RI', 'a table in the tooling README; members have no row'],
  ['HO', 'a table in the document that owns it; members have no row'],
  ['M6-N', 'a table in M06; members have no row'],
  ['INV-M6', 'a table in M06 covering every member; some have no row'],
  ['PW', 'a table in the document that owns it; members have no row'],
  ['OI', "an OI allocation table in ALLOCATION.md, superseding DELTA_MANIFEST section 16 (ADR-074 section 7). NOT this session's to move, and the gate does not wait on it: the day that table lands this entry stops naming a defect and the gate fails until OI is promoted in the same commit"],
  // No register at all, small. Each needs a table in the document that owns it,
  // or an argued move into ADR-074 section 4's class X3.
  ['RE-C', 'a table in the document that owns it, or an argued move into X3'],
  ['RE-R', 'a table in the document that owns it, or an argued move into X3'],
  ['SF-M21', 'a table in M21, or an argued move into X3'],
  ['DT', 'a table in the document that owns it, or an argued move into X3'],
  ['PG-M9', 'a table in M09, or an argued move into X3'],
  ['OQ-P', 'a register that is a corpus document: its rows are in docs/reviews, which ADR-074 section 1 rules can never be a register because a review record binds nothing by existing'],
  // Ruled in scope by ADR-074 and moved here on ADR-074's own section 1 rule,
  // with the disagreement reported rather than resolved by re-scoping.
  ['OQ-F6', "a register in a CORPUS DOCUMENT. Its only definition sites today are table rows in a session log, and a session log is a registry ENTRY rather than a corpus document (ADR-043), which ADR-074 section 1 does not admit as a register"],
  ['P-M6', "a disposition for whoever holds M06 next: session 112 records that P-M6-11 was deliberately NOT minted, and that the panel table either gains a row or the third number is declared to live inside P-M6-01's block"],
  // `OQ-M*`, no register at all. Twenty series, and the ruling this waits on is
  // expressly NOT ADR-074's to make, because it is a question about how rulings
  // are recorded rather than about identifiers.
  ['OQ-M2', 'a ruling naming which end of an open question\'s lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it'],
  ['OQ-M3', 'a ruling naming which end of an open question\'s lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it'],
  ['OQ-M4', 'a ruling naming which end of an open question\'s lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it'],
  ['OQ-M5', 'a ruling naming which end of an open question\'s lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it'],
  ['OQ-M6', 'a ruling naming which end of an open question\'s lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it'],
  ['OQ-M7', 'a ruling naming which end of an open question\'s lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it'],
  ['OQ-M8', 'a ruling naming which end of an open question\'s lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it'],
  ['OQ-M9', 'a ruling naming which end of an open question\'s lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it'],
  ['OQ-M10', 'a ruling naming which end of an open question\'s lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it'],
  ['OQ-M11', 'a ruling naming which end of an open question\'s lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it'],
  ['OQ-M12', 'a ruling naming which end of an open question\'s lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it'],
  ['OQ-M13', 'a ruling naming which end of an open question\'s lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it'],
  ['OQ-M14', 'a ruling naming which end of an open question\'s lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it'],
  ['OQ-M15', 'a ruling naming which end of an open question\'s lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it'],
  ['OQ-M16', 'a ruling naming which end of an open question\'s lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it'],
  ['OQ-M17', 'a ruling naming which end of an open question\'s lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it'],
  ['OQ-M18', 'a ruling naming which end of an open question\'s lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it'],
  ['OQ-M19', 'a ruling naming which end of an open question\'s lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it'],
  ['OQ-M20', 'a ruling naming which end of an open question\'s lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it'],
  ['OQ-M21', 'a ruling naming which end of an open question\'s lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it'],
]);

// The member census. Digits are TWO OR THREE, which is the survey's own floor
// and is stated as a known gap rather than left implicit: `D0-1` is a
// single-digit member and is invisible to this reader, exactly as it was to the
// census ADR-074 is ruled on. Fenced blocks are masked, because a code fence
// shows identifiers as EXAMPLES and a census that counts them is counting
// documentation of the form.
const SERIES_MEMBER = /\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)-(\d{2,3})\b/g;

function seriesMembers() {
  const members = new Map();
  const files = markdownFiles();
  if (files.length === 0) throw new Error('no markdown files; the identifier census is empty');
  for (const file of files) {
    const masked = read(file).replace(/^```[\s\S]*?^```/gm, '');
    for (const m of masked.matchAll(SERIES_MEMBER)) {
      if (!members.has(m[1])) members.set(m[1], new Set());
      members.get(m[1]).add(m[0]);
    }
  }
  if (members.size === 0) throw new Error('the identifier census found no series; it is vacuous');
  return members;
}

// A register is a FILE, a file and one `##` SECTION after a `##` separator, or
// an ADR-043 registry DIRECTORY. Returns null when it cannot be read, which the
// caller reports as a finding rather than skipping.
function registerBody(register) {
  const [file, section] = register.split('##');
  const path = join(ROOT, file);
  if (!existsSync(path)) return null;
  if (statSync(path).isDirectory()) {
    const entries = readdirSync(path).filter((f) => extname(f) === '.md');
    if (entries.length === 0) return null;
    return entries.sort().map((f) => read(join(file, f))).join('\n');
  }
  const body = read(file);
  if (!section) return body;
  const lines = body.split('\n');
  const start = lines.findIndex((l) => /^##\s/.test(l) && l.replace(/^##\s+/, '').trim() === section);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

// "LEADS WITH", not "equals", and emphasis, code ticks and a link opener are
// stripped from the LEFT only. Stripping is CI-06u's `firstCellKey` idea and not
// a second copy of it: this one answers a different question, whether one named
// identifier opens the cell, rather than what the cell's key is.
const leadsWith = (text, id) => new RegExp(`^[*\`[]*${id}\\b`).test(text.trim());

// A row OR a heading, and NOT a bold lead. Counts the sites for one identifier
// inside one register body.
function definitionSites(body, id) {
  let sites = 0;
  for (const line of body.split('\n')) {
    if (/^#{1,6}\s/.test(line)) {
      if (leadsWith(line.replace(/^#{1,6}\s+/, ''), id)) sites++;
      continue;
    }
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1);
    if (cells.length > 0 && leadsWith(cells[0], id)) sites++;
  }
  return sites;
}

// Every corpus document, concatenated once, for the pending register's
// predicate. Registry ENTRIES are excluded through the runner's own
// `isCorpusDocument`, which is what keeps a session log from counting as the
// place a series is defined -- the exact reason `OQ-F6` is pending.
function corpusDefinitionCounts() {
  const counts = new Map();
  for (const file of markdownFiles().filter(isCorpusDocument)) {
    for (const line of read(file).split('\n')) {
      let text = null;
      if (/^#{1,6}\s/.test(line)) text = line.replace(/^#{1,6}\s+/, '');
      else if (line.startsWith('|')) text = line.split('|')[1] ?? '';
      if (text === null) continue;
      const m = /^[*`[]*([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)-(\d{2,3})\b/.exec(text.trim());
      if (!m) continue;
      const id = `${m[1]}-${m[2]}`;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

const identifierSeries = {
  id: 'CI-06/identifier-series',
  title: 'Every member of a declared identifier series has exactly one definition site',
  covers:
    'ADR-074, implemented as ruled. A definition site is a TABLE ROW whose first cell LEADS ' +
    'with the identifier, or a MARKDOWN HEADING whose text leads with it, occurring inside ' +
    "the series' DECLARED REGISTER; every member of an in-scope series has exactly one, and " +
    'every other occurrence anywhere in the repository is a citation and is unconstrained. ' +
    'A register is a FILE, or a file and ONE ## SECTION, or an ADR-043 registry directory. ' +
    'THE SCOPE IS WRITTEN AND NEVER COMPUTED (ADR-074 section 2), because a gate whose scope ' +
    'is "every series that currently satisfies the rule" passes forever by construction: the ' +
    'day a series breaks it leaves scope and the gate reports every series clean. ' +
    'A BOLD LEAD IS NOT A DEFINITION SITE: a bold span opening a line is this corpus\'s ' +
    'ordinary emphasis idiom and admitting it makes the rule match prose. SECTION ' +
    'GRANULARITY IS LOAD BEARING, not a convenience: M01 section 1 holds INV\'s definition ' +
    'rows and Appendix A holds a COVERAGE row for the same identifiers, so a file-wide ' +
    'register reports INV, CV and RB as broken. ' +
    'THE PENDING REGISTER IS THE SECOND TABLE (ADR-074 section 5): series that are neither ' +
    'in scope nor exempt are named as real defects with the artifact each waits for, and an ' +
    'entry that no longer names a defect is itself a finding, so it shrinks as repairs land ' +
    'and cannot become furniture. UNDECLARED SERIES ARE CLAIMED AS NOTHING AND COUNTED ON ' +
    'EVERY RUN, which is the honest measure of what this gate does not cover. ' +
    'FOUR PLACES WHERE THE RULING AND THE TREE DISAGREE ARE REPORTED RATHER THAN RE-SCOPED: ' +
    "ADR-074's stated 118 series and 1,086 members do not reproduce from its own four " +
    'classes (117 and 1,083, with the module row 3 high and the design row 2 low); OQ-F6 is ' +
    'ruled in scope with its only definition sites in a SESSION LOG, which section 1 does ' +
    'not admit as a register; P-M6 is ruled in scope and P-M6-11 was deliberately not ' +
    'minted; and section 5 names ten of the eighteen series in its first pending class. ' +
    'THREE THINGS IT DOES NOT DO. The member census has a TWO-DIGIT FLOOR, so a ' +
    'single-digit member is invisible to it exactly as it was to the census ADR-074 is ' +
    'ruled on. It says nothing about the CONTENT of a definition, only that exactly one ' +
    'exists. And it inherits the one-ref gap: two branches each defining one identifier is ' +
    'caught at the merge and never at the pull request.',
  run() {
    const findings = [];
    const members = seriesMembers();

    // Rule 2 on both tables. An empty scope reports every series clean, which is
    // the failure mode ADR-074 section 2 is written against.
    if (DECLARED_SERIES.size === 0) throw new Error('DECLARED_SERIES is empty; the gate asserts nothing');
    if (PENDING_SERIES.size === 0) throw new Error('PENDING_SERIES is empty; the register asserts nothing');

    // -- the declared scope --------------------------------------------------
    let scoped = 0;
    for (const series of [...DECLARED_SERIES.keys()].sort()) {
      const register = DECLARED_SERIES.get(series);
      const body = registerBody(register);
      if (body === null) {
        findings.push(
          `scripts/corpus/gates.mjs: ${series} declares the register "${register}" and it ` +
            'cannot be read. A declared register that has moved makes every member of the ' +
            'series unverifiable, and a scope entry matching nothing is itself a finding',
        );
        continue;
      }
      const ids = [...(members.get(series) ?? [])].sort();
      if (ids.length === 0) {
        findings.push(
          `scripts/corpus/gates.mjs: ${series} is declared in scope and the census finds no ` +
            'member of it anywhere. The series has been renamed or removed, and a scope entry ' +
            'naming nothing is a finding (ADR-074 section 2)',
        );
        continue;
      }
      scoped += ids.length;
      for (const id of ids) {
        const sites = definitionSites(body, id);
        if (sites === 1) continue;
        findings.push(
          sites === 0
            ? `${register}: ${id} has NO definition site in its declared register. A row whose ` +
              'first cell leads with it, or a heading whose text does, and neither exists: ' +
              'every occurrence of it in the corpus is a citation of something undefined'
            : `${register}: ${id} has ${sites} definition sites in its declared register and ` +
              'must have exactly one. Two rows or headings leading with one identifier are two ' +
              'definitions, and which is the definition cannot be read off the page',
        );
      }
    }

    // -- the pending register, and why it cannot become furniture ------------
    const corpusSites = corpusDefinitionCounts();
    let pendingMembers = 0;
    for (const series of [...PENDING_SERIES.keys()].sort()) {
      const ids = [...(members.get(series) ?? [])];
      if (ids.length === 0) {
        findings.push(
          `scripts/corpus/gates.mjs: PENDING_SERIES holds ${series} and the census finds no ` +
            'member of it. The entry no longer names a real defect. Remove it ' +
            `(${PENDING_SERIES.get(series)})`,
        );
        continue;
      }
      pendingMembers += ids.length;
      const undefinedMembers = ids.filter((id) => (corpusSites.get(id) ?? 0) !== 1);
      if (undefinedMembers.length > 0) continue;
      findings.push(
        `scripts/corpus/gates.mjs: PENDING_SERIES holds ${series} and every one of its ` +
          `${ids.length} members now has exactly one definition site in a corpus document, so ` +
          'the entry no longer names a real defect. Promote it into DECLARED_SERIES with its ' +
          'register, in the commit that repaired it (WAVE-03: a register entry goes with its ' +
          `repair). It was waiting for: ${PENDING_SERIES.get(series)}`,
      );
    }

    // -- what the gate does NOT cover, counted rather than assumed -----------
    let undeclared = 0;
    let undeclaredMembers = 0;
    for (const [series, ids] of members) {
      if (DECLARED_SERIES.has(series) || PENDING_SERIES.has(series)) continue;
      undeclared++;
      undeclaredMembers += ids.size;
    }

    console.log(
      `       CI-06/identifier-series note: ${DECLARED_SERIES.size} declared series over ` +
        `${scoped} member(s); ${PENDING_SERIES.size} pending over ${pendingMembers} member(s), ` +
        'each one a repair this gate is waiting for; ' +
        `${undeclared} series over ${undeclaredMembers} member(s) claimed as nothing. ` +
        'ADR-074 section 3 states 118 declared and 1,086 members and section 5 states 44 ' +
        'pending; the transcription reproduces neither and the differences are in this gate ' +
        "block and in the pull request, not resolved by widening or narrowing the ruling's scope",
    );
    return findings;
  },
};

// CI-06/gate-inventory  Every stage row of STRATEGY section 4.1 is closed
// -----------------------------------------------------------------------------
// ADR-073 SECTION 2 IS THE RULING AND SECTION 8 NAMES THE FOUR ASSERTIONS. A row
// of the pipeline inventory is CLOSED when it is (a) implemented, naming the
// workflow file and the job that runs it; or (b) waiting, on a dated activation
// condition naming ONE artifact; or (c), for CI-10 alone, discharged by a
// register outside Actions. A row that is none of the three is a finding.
//
// -----------------------------------------------------------------------------
// WHICH OF THE TWO READINGS OF (b) THIS GATE IMPLEMENTS, IN ONE SENTENCE
// -----------------------------------------------------------------------------
// IT ASSERTS BOTH, SPLIT PER ARTIFACT AND NOT PER GATE: every condition must be
// present, dated and name exactly one artifact, and each artifact that is a fact
// about THIS TREE is additionally probed and must resolve to ABSENT, while an
// artifact that no repository file can report -- CI-04's Neon branch is the
// clean case, since no file here changes when a database branch is provisioned
// -- is REGISTERED as unprobeable with its reason, so the gate asserts CI-04's
// condition and never CI-04's artifact.
//
// That split is the whole value of the gate, because ADR-073 section 8 says the
// absence assertion is "the one an implementer is most likely to leave out,
// because it is the only one that fails on good news", and leaving it out
// wholesale on the strength of the one artifact that cannot be read would be
// exactly that. Two of six can be read and two of six are read.
//
// -----------------------------------------------------------------------------
// THE SHARPEST JUDGEMENT IN THIS GATE IS NOT ADR-073's, AND IT IS THE LEG
// -----------------------------------------------------------------------------
// ADR-073 gave CI-09 a DISPOSITION and not a partial-implementation rule. Session
// 114 built one leg of the four its Contents cell states, so a gate that asks
// "is this row implemented" and takes the row's first word for the answer READS
// ONE LEG AS FOUR. The ruling nowhere says it should not, and the ruling is not
// where the answer is.
//
// THE RULE THIS GATE IMPLEMENTS, STATED SO IT CAN BE ARGUED WITH:
//
//   A DISPOSITION APPLIES TO A LEG AND NEVER TO A ROW. A row is CLOSED when it
//   carries at least one leg and every leg it carries is well formed. A row is
//   OPEN for each activation condition it carries, WHETHER OR NOT it also
//   carries an implementation.
//
// So CI-09 is closed, is partially implemented, and is open on three legs, all
// three at once, and no single number describes it. The note line therefore
// prints THREE counts rather than one -- rows with no implementation leg at all,
// rows carrying both, and conditions over the whole table -- because the two
// readings of "how many are open" give 3 and 6 and a gate that printed one of
// them would be choosing for the reader.
//
// WHY NOT DECOMPOSE THE Contents CELL INSTEAD, which is the obvious alternative:
// CI-01's contents are `tsc --noEmit`, ESLint and prettier and its implementation
// is ONE job, so a rule that split on the contents cell would report eight open
// legs across five rows that are entirely built. The Closure cell is where a
// disposition is written down, so the Closure cell is where the legs are.
//
// -----------------------------------------------------------------------------
// IT READS ONE WRITTEN FORM, WHICH IS NOW IN THE DOCUMENT
// -----------------------------------------------------------------------------
// CI-06q's rule: one written form is read, and a paraphrase is claimed as
// nothing. The form is stated in STRATEGY section 4 above the table rather than
// only here, because a document whose gate reads a shape nobody wrote down
// drifts out of its gate's reach one edit at a time. Three of CI-09's conditions
// read `artifact <text>` where the other three read `Artifact: **<text>**` when
// this gate was written; both were repaired to the one form in the same branch,
// and the `condition-with-no-artifact` scope case is what stops the loose form
// from returning quietly.
//
// AND THE PROBES MATCH THE ARTIFACT, NOT THE MENTION, which is CI-06s's near-miss
// one registry over and is live here rather than hypothetical: `pnpm-lock.yaml`
// names `@vitest/browser-playwright` today as an unmet optional peer of Vitest,
// and a probe grepping for `playwright` would report CI-08's artifact ARRIVED
// and reopen a row on a package nobody installed.
const PIPELINE_INVENTORY = '### 4.1 Pipeline stages';
const WORKFLOW_DIR = '.github/workflows';

// The three leg openers, as written forms. `waiting, <date>` carries the date in
// the opener because ADR-073 (b) requires the condition to be DATED, and an
// opener that matched a bare `Waiting` would let an undated condition through
// the one assertion that is pure form.
const LEG_OPENERS = [
  { kind: 'implemented', re: /\*\*Implemented\b/g },
  { kind: 'waiting', re: /\bwaiting,\s*(\d{4}-\d{2}-\d{2})/gi },
  { kind: 'discharged', re: /\*\*Discharged outside Actions\b/g },
];

// A cell to its legs, in document order, each running to the next opener. A leg
// is the unit a disposition applies to; see the ruling above.
function closureLegs(cell) {
  const marks = [];
  for (const { kind, re } of LEG_OPENERS) {
    for (const m of cell.matchAll(re)) marks.push({ kind, at: m.index, date: m[1] ?? null });
  }
  marks.sort((a, b) => a.at - b.at);
  return marks.map((mark, i) => ({
    kind: mark.kind,
    date: mark.date,
    text: cell.slice(mark.at, i + 1 < marks.length ? marks[i + 1].at : cell.length),
  }));
}

// The rows of section 4.1, bounded to their own `###` section for the reason
// `strategyGateLetters` states one section over: unbounded, this runs into 4.2
// and reads a table answering a different question about the same identifiers.
function pipelineRows() {
  const body = read(STRATEGY_DOC);
  const start = body.indexOf(PIPELINE_INVENTORY);
  if (start === -1) throw new Error(`${STRATEGY_DOC}: section not found: "${PIPELINE_INVENTORY}"`);
  const firstLine = body.slice(0, start).split('\n').length;
  const after = body.slice(start + PIPELINE_INVENTORY.length);
  const end = after.search(/\n### /);
  const lines = (end === -1 ? after : after.slice(0, end)).split('\n');
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('|')) continue;
    const cells = rowCells(lines[i]);
    const m = /^\s*\*{0,2}`?(CI-\d{2})`?\*{0,2}\s*$/.exec(cells[0] ?? '');
    if (!m) continue;
    rows.push({ id: m[1], line: firstLine + i, cells, closure: (cells[4] ?? '').trim() });
  }
  // Rule 2. A section that parses to no row is a runner that has lost its input,
  // and it would report an inventory of nothing as an inventory in order.
  if (rows.length === 0) {
    throw new Error(
      `CI-06/gate-inventory read no CI-nn row out of ${STRATEGY_DOC} "${PIPELINE_INVENTORY}". ` +
        'Zero means the table or the first-cell form has moved, and every assertion below ' +
        'would then hold vacuously',
    );
  }
  return rows;
}

// The top-level job KEYS of one workflow. Returns null when the file is absent,
// which the caller reports rather than skipping: a row naming a workflow that
// does not exist is the finding, not a reason to stay quiet.
function workflowJobs(file) {
  const rel = `${WORKFLOW_DIR}/${file}`;
  if (!existsSync(join(ROOT, rel))) return null;
  const lines = read(rel).split('\n');
  const at = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (at === -1) return new Set();
  const jobs = new Set();
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (/^[A-Za-z_]/.test(line)) break; // the next top-level key ends the block
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m) jobs.add(m[1]);
  }
  return jobs;
}

// An artifact's bolded text to the key both registers are written against. Links
// collapse to their text and code ticks are dropped, so `**[M07](...)'s detector
// code**` and a later unlinked spelling of it are one artifact rather than two.
//
// `*` IS NOT STRIPPED, and this gate's first run is why. `firstCellKey` strips it
// because a row bolded on one branch and plain on the other is one key; here the
// text is already the INSIDE of a bold span, so a surviving `*` is not emphasis,
// and CI-07's artifact is the glob `apps/*/package.json`. Stripping it produced
// `apps//package.json`, which matched no register entry and reported the live
// condition unreadable and the live probe stale, in one run. Same shape as
// CI-06u's `_`: a character that is markup in one register and content in this
// one, and inventing a mismatch is worse than folding two spellings together.
const artifactKey = (text) =>
  text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// THE PROBES. WRITTEN AND NEVER COMPUTED, on ADR-074 section 2's rule: a probe
// table derived from the conditions in use would grow a passing entry for every
// condition anybody writes, which is a gate whose scope is "whatever it already
// covers". A new condition therefore FAILS until somebody decides, in this file,
// whether its artifact can be read at all.
//
// Each probe returns a string describing what it FOUND, meaning the artifact has
// ARRIVED and the row is a finding, or null for absent, which is the state the
// condition asserts.
function appsWithBuildScript() {
  const dir = 'apps';
  const manifests = existsSync(join(ROOT, dir))
    ? readdirSync(join(ROOT, dir))
        .sort()
        .map((app) => `${dir}/${app}/package.json`)
        .filter((p) => existsSync(join(ROOT, p)))
    : [];
  if (manifests.length === 0) {
    throw new Error(
      "CI-06/gate-inventory found no apps/*/package.json, so CI-07's probe reads nothing " +
        'and would report the artifact absent for the wrong reason',
    );
  }
  const found = manifests.filter((p) =>
    Object.prototype.hasOwnProperty.call(JSON.parse(read(p)).scripts ?? {}, 'build'),
  );
  return found.length === 0 ? null : `${found.join(', ')} carries a \`build\` script`;
}

function playwrightInLockfile() {
  const lock = 'pnpm-lock.yaml';
  if (!existsSync(join(ROOT, lock))) {
    throw new Error(
      `CI-06/gate-inventory found no ${lock}, so CI-08's probe reads nothing and would ` +
        'report the artifact absent for the wrong reason',
    );
  }
  // THE PACKAGE NAME AT A KEY OR A RESOLUTION, never the substring. ADR-073
  // measured the only occurrence in this lockfile as `@vitest/browser-playwright`,
  // a different package, and a loose needle would reopen CI-08 on it.
  const hit = /(^|[\s'"/])@playwright\/test(?=[@:\s'"]|$)/m.exec(read(lock));
  return hit === null ? null : `${lock} names \`@playwright/test\``;
}

const INVENTORY_PROBES = new Map([
  ['a build script in any apps/*/package.json', appsWithBuildScript],
  ['@playwright/test present in the lockfile', playwrightInLockfile],
]);

// THE UNPROBEABLE REGISTER, and it is a register rather than an exemption list
// because it carries CI06U_REGISTER's defining property: AN ENTRY THAT NO LONGER
// NAMES A REAL CONDITION IS ITSELF A FINDING. It shrinks when a condition is
// re-ruled to name a path or a manifest key, which is ADR-073 section 2 (b)'s own
// requirement and which FOUR OF THE SIX CONDITIONS DO NOT MEET TODAY. That is
// reported here and in the pull request rather than asserted, because the repair
// is a ruling on what each artifact IS and ADR-073 is where that is taken.
const UNPROBEABLE_ARTIFACTS = new Map([
  [
    'a Neon branch provisioned for CI',
    'a provisioned database branch is estate and not tree: no file in this repository ' +
      'changes when it is created, so no probe over the tree can report it. This is the ' +
      'condition the gate asserts and the artifact the gate cannot (ADR-073 section 4)',
  ],
  [
    'a demo-world seed script',
    'the condition names neither a path nor a manifest key. ADR-073 section 5 measures ' +
      'packages/db/src/seed/ as holding calendar sources and nothing else, but that ' +
      'measurement is evidence in the ruling rather than the artifact the row names, and ' +
      'picking the path here would be the runner choosing scope (ADR-074 section 2)',
  ],
  [
    'the VG-12 admission',
    'the admission is .github/CODEOWNERS plus a branch-protection setting, and session 23 ' +
      'records why no job can see it: "a job can see the dependency surface changed and ' +
      'cannot see that a human agreed". A repository file cannot report it',
  ],
  [
    "M07's detector code",
    'the condition names a module plan and not a path or a manifest key. ADR-073 section 5 ' +
      'measures `canary` as appearing in no .ts file in the tree; that needle is evidence ' +
      'in the ruling and is not what the row states',
  ],
]);

const gateInventory = {
  id: 'CI-06/gate-inventory',
  title: 'Every pipeline stage row is implemented in a workflow or waits on a dated artifact',
  covers:
    'ADR-073 SECTION 2, IMPLEMENTED AS RULED, over every row of STRATEGY section 4.1. ' +
    'A DISPOSITION APPLIES TO A LEG AND NEVER TO A ROW: a row is closed when it carries at ' +
    'least one leg and every leg is well formed, and it is OPEN for each activation ' +
    'condition it carries whether or not it also carries an implementation. That rule is ' +
    "THIS GATE's and not ADR-073's, which gave CI-09 a disposition and no " +
    'partial-implementation rule; session 114 built one of CI-09\'s four legs and a gate ' +
    'reading the row\'s first word would read one leg as four. ' +
    'AN IMPLEMENTED LEG names a workflow under .github/workflows/ and the job or jobs that ' +
    'run it, and every one of them must be a top-level job key in that file. ' +
    'A WAITING LEG carries a date in its opener and exactly one `Artifact: **...**` clause, ' +
    'and its artifact must be registered here as probeable or as unprobeable. ' +
    'A DISCHARGED LEG links a register that resolves; ADR-073 gives CI-10 alone this ' +
    'disposition and a second row taking it is reported rather than accepted. ' +
    'IT ASSERTS BOTH READINGS OF (b), SPLIT PER ARTIFACT: every condition must be present, ' +
    'dated and name one artifact, and each artifact that is a fact about THIS TREE is ' +
    'additionally probed and must resolve to ABSENT, so the gate FAILS ON GOOD NEWS the day ' +
    'a build script or an installed Playwright lands. CI-04\'s Neon branch is not a fact ' +
    'about this tree, so for that row the gate asserts the CONDITION and never the ARTIFACT. ' +
    'THE PROBE TABLE AND THE UNPROBEABLE REGISTER ARE WRITTEN AND NEVER COMPUTED, so a new ' +
    'condition fails until somebody decides in this file whether its artifact can be read; ' +
    'and an entry in either that names no live condition is itself a finding, so the ' +
    'register shrinks as ADR-073 re-rules an artifact into a path or a manifest key. ' +
    'FOUR OF THE SIX CONDITIONS name neither a path nor a manifest key, which ADR-073 ' +
    'section 2 (b) requires; that is REPORTED on every run rather than asserted, because ' +
    'the repair is a ruling on what each artifact is. ' +
    'THREE THINGS IT DOES NOT DO. It never asks whether a Contents cell is TRUE, which is ' +
    "ADR-073's own second limit: CI-02 promises the PT-nn suites and the tree has neither. " +
    'It rules on the STAGE row and never on the VG rows of section 4.2, whose conditions ' +
    'would chain and which ADR-073 section 8 deliberately leaves unruled. And it reads a ' +
    'job NAME in a file, never a run: a job that exists and is disabled by an `if:` passes ' +
    'here and is nothing this parse can reach.',
  run() {
    const findings = [];
    const rows = pipelineRows();

    const seenArtifacts = new Set();
    let implementedRows = 0;
    let partialRows = 0;
    let noImplementation = 0;
    let conditions = 0;
    let discharged = 0;
    let probed = 0;
    let registered = 0;

    for (const row of rows) {
      const where = `${STRATEGY_DOC}:${row.line} ${row.id}`;
      const legs = closureLegs(row.closure);

      if (legs.length === 0) {
        findings.push(
          `${where} carries no disposition. ADR-073 section 2 rules a row closed when it is ` +
            'implemented, when it carries a dated activation condition naming one artifact, ' +
            'or when a register outside Actions discharges it, and a row that is none of the ' +
            'three is a finding',
        );
        continue;
      }

      const waiting = legs.filter((l) => l.kind === 'waiting');
      const built = legs.filter((l) => l.kind === 'implemented');
      conditions += waiting.length;
      if (legs.some((l) => l.kind === 'discharged')) discharged++;
      if (built.length > 0 && waiting.length === 0) implementedRows++;
      else if (built.length > 0) partialRows++;
      else if (waiting.length > 0) noImplementation++;

      for (const leg of legs) {
        if (leg.kind === 'implemented') {
          const file = /\.github\/workflows\/([A-Za-z0-9_-]+\.ya?ml)/.exec(leg.text);
          if (!file) {
            findings.push(
              `${where} claims an implementation and names no workflow under ` +
                `${WORKFLOW_DIR}/. ADR-073 disposition (a) is the workflow file AND the job ` +
                'name that runs it, because a job name is a string in a file and a claim ' +
                'that names neither is a claim about a run nobody can check',
            );
            continue;
          }
          const jobs = workflowJobs(file[1]);
          if (jobs === null) {
            findings.push(
              `${where} names ${WORKFLOW_DIR}/${file[1]} and no such file exists, so the ` +
                'row is closed against a workflow that cannot run',
            );
            continue;
          }
          const named = [...leg.text.matchAll(/\bjobs?\s+((?:`[A-Za-z0-9_-]+`(?:\s+and\s+)?)+)/g)]
            .flatMap((m) => [...m[1].matchAll(/`([A-Za-z0-9_-]+)`/g)].map((j) => j[1]));
          if (named.length === 0) {
            findings.push(
              `${where} names ${WORKFLOW_DIR}/${file[1]} and no job in it. A workflow file ` +
                'is not a disposition: ADR-073 (a) wants the job, because a stage can be ' +
                'named in a file that runs a different one',
            );
            continue;
          }
          for (const job of named) {
            if (jobs.has(job)) continue;
            findings.push(
              `${where} names job \`${job}\` and ${WORKFLOW_DIR}/${file[1]} has no such ` +
                `job (it has ${[...jobs].sort().join(', ') || 'none'}). A renamed job leaves ` +
                'a row claiming an implementation that stopped existing, and nothing else ' +
                'in this corpus reads that cell',
            );
          }
          continue;
        }

        if (leg.kind === 'discharged') {
          const link = /\]\(([^)]+)\)/.exec(leg.text);
          if (!link) {
            findings.push(
              `${where} is discharged outside Actions and links no register. ADR-073 ` +
                'disposition (c) is the register that carries the obligation, and a row ' +
                'cannot be moved into (c) by asserting it',
            );
            continue;
          }
          const target = resolve(dirname(join(ROOT, STRATEGY_DOC)), link[1].split('#')[0]);
          if (!existsSync(target)) {
            findings.push(
              `${where} is discharged by "${link[1]}" and that register does not resolve, so ` +
                'the obligation is discharged into nothing',
            );
          }
          continue;
        }

        // A waiting leg. Form first, then the artifact.
        const clauses = [...leg.text.matchAll(/Artifact:\s*\*\*(.+?)\*\*/g)];
        if (clauses.length === 0) {
          findings.push(
            `${where} carries a condition dated ${leg.date} and no \`Artifact: **...**\` ` +
              'clause. A dated condition naming no artifact is the word "deferred" with a ' +
              'date on it: nothing reopens the row, which is the decay ADR-073 exists to end',
          );
          continue;
        }
        if (clauses.length > 1) {
          findings.push(
            `${where} carries a condition dated ${leg.date} naming ${clauses.length} ` +
              'artifacts and ADR-073 section 2 allows one. A condition naming two artifacts ' +
              'cannot fail cleanly, because the gate cannot say which half arrived',
          );
          continue;
        }

        const key = artifactKey(clauses[0][1]);
        seenArtifacts.add(key);
        const probe = INVENTORY_PROBES.get(key);
        if (!probe) {
          if (UNPROBEABLE_ARTIFACTS.has(key)) registered++;
          else {
            findings.push(
              `${where} waits on the artifact "${key}" and this gate has not been told how ` +
                'to read it. Add a probe to INVENTORY_PROBES, or an entry to ' +
                'UNPROBEABLE_ARTIFACTS naming why no probe over this tree can report it. ' +
                'A condition whose arrival nothing watches for is a condition that never ' +
                'fires, and the tables are written rather than computed so that this ' +
                'decision is taken by a person once rather than defaulted to silence',
            );
          }
          continue;
        }
        probed++;
        const arrived = probe();
        if (arrived === null) continue;
        findings.push(
          `${where}: the artifact "${key}" HAS ARRIVED (${arrived}), so the row reopened on ` +
            'the commit that added it and the stage is not written. This is the half of ' +
            "ADR-073's ruling that fails on good news, and it is the whole reason the " +
            'condition is a condition rather than the word "deferred". Write the stage, or ' +
            'take a ruling that moves the row',
        );
      }
    }

    // THE STALE DIRECTION, which is the half that earns a register. A list naming
    // something that no longer exists still looks complete, and CI-06l's record is
    // the precedent: an entry here that names no live condition would let a
    // re-ruled artifact pass unread.
    for (const key of INVENTORY_PROBES.keys()) {
      if (seenArtifacts.has(key)) continue;
      findings.push(
        `scripts/corpus/gates.mjs: INVENTORY_PROBES holds a probe for "${key}" and no ` +
          `condition in ${STRATEGY_DOC} section 4.1 names it. The row was written, the ` +
          'artifact was re-ruled, or the wording moved; either way the probe asserts ' +
          'nothing. Remove it or repoint it',
      );
    }
    for (const key of UNPROBEABLE_ARTIFACTS.keys()) {
      if (seenArtifacts.has(key)) continue;
      findings.push(
        `scripts/corpus/gates.mjs: UNPROBEABLE_ARTIFACTS registers "${key}" and no ` +
          `condition in ${STRATEGY_DOC} section 4.1 names it. A register entry that no ` +
          'longer names a real condition is a finding, which is what keeps this register ' +
          'from becoming furniture (CI-06u and CI-06/fixture-inventory, same property)',
      );
    }

    // Rule 2 on the registers themselves. Either one emptied would report every
    // artifact unregistered or every artifact registered, and both read as a gate
    // asserting something it is not.
    if (INVENTORY_PROBES.size === 0) throw new Error('INVENTORY_PROBES is empty; no artifact is read');
    if (UNPROBEABLE_ARTIFACTS.size === 0) {
      throw new Error('UNPROBEABLE_ARTIFACTS is empty; the register asserts nothing');
    }

    console.log(
      `       CI-06/gate-inventory note: ${rows.length} stage row(s); ${implementedRows} ` +
        `implemented outright, ${partialRows} carrying an implementation AND a condition, ` +
        `${noImplementation} with no implementation leg at all, ${discharged} discharged ` +
        `outside Actions. ${conditions} activation condition(s) over the table, ${probed} of ` +
        `them probed against this tree and ${registered} registered as unprobeable ` +
        'with a reason. THE TWO READINGS OF "HOW MANY ARE OPEN" GIVE ' +
        `${noImplementation} AND ${conditions} and both are printed because a row can be ` +
        'implemented and waiting at once; ADR-073 ruled four rows open and session 114 ' +
        "built one leg of CI-09's four. Four of the six conditions name neither a path nor " +
        'a manifest key, which ADR-073 section 2 (b) requires, and that is in the register ' +
        'and in the pull request rather than resolved by this runner',
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
  ci06v,
  ci06w,
  conflictMarkers,
  fixtureInventory,
  identifierSeries,
  gateInventory,
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
