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
import { join, dirname, relative, resolve, extname, basename } from 'node:path';
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
            "artifact lands; a row left reserved is a permanent exemption from this gate's own " +
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
// -----------------------------------------------------------------------------
// ADR-088's three helpers, beside the two queries that use them.
// -----------------------------------------------------------------------------
// The ADR ENTRY set is narrower than `REGISTRIES`' `decisions` predicate, which
// also admits `gates/`. A gate closure is a record of a signing session and has
// never had a row in the ADR table; including it here would invent eight rows.
const adrEntryFiles = () =>
  markdownFiles()
    .filter((f) => /^docs\/decisions\/ADR-(?:\d{3}|D\d+)\.md$/.test(f))
    .sort();

// The same predicate `REGISTRIES` uses, with its `\d{2,}` intact: a two-digit
// pattern silently stopped recognising session files at 99 and the cap was
// invisible for 99 sessions.
//
// SORTED BY (date, session number) AND NOT BY FILENAME, because filenames sort
// `session-9` after `session-10` and the table would reorder itself the first
// time it was generated.
const sessionEntryFiles = () =>
  markdownFiles()
    .filter((f) => /^docs\/sessions\/\d{4}-\d{2}-\d{2}-session-\d{2,}\.md$/.test(f))
    .sort((a, b) => {
      const key = (f) => {
        const m = /(\d{4}-\d{2}-\d{2})-session-(\d+)\.md$/.exec(f);
        return [m[1], Number(m[2])];
      };
      const [da, na] = key(a);
      const [db, nb] = key(b);
      return da === db ? na - nb : da < db ? -1 : 1;
    });

// `ADR-D1` carries no three-digit number. It is pinned immediately after
// `ADR-015`, which is where the registry has carried it since it was written;
// sorting it to either end would move a row for no reason anybody asked for.
const adrSortKey = (id) => (id === 'ADR-D1' ? 15.5 : Number(id.slice(4)));

// THE LINK TEXT COMES FROM THE FILENAME AND NEVER FROM THE HEADING. The headings
// carry variants the table has never carried: two read `Session 95, continued`
// and several read `Session 134 (P2-b)`, while every one of the 183 rows reads
// `<date> - Session <n>`. The filename is the one canonical source for both
// halves of the link, so the label cannot drift when a heading style does.
const sessionLabel = (file) => {
  const m = /(\d{4}-\d{2}-\d{2})-session-(\d+)\.md$/.exec(file);
  return `${m[1]} - Session ${Number(m[2])}`;
};

const SPAN_QUERIES = {
  // OI-25. Eleven keys built from FIXTURE_STATUSES and FIXTURE_BLOCKERS below,
  // so a term added there gets its query on the same commit. The argument is in
  // the script's own header and in ADR-133; this is the whole of the wiring.
  ...(await import('./fixture-backlog.mjs')).FIXTURE_BACKLOG_QUERIES,
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

  // OI-24, open since session 95, whose register row names its own remedy: "M06's
  // hand-maintained delta count. Open, and the remedy is a `<!--gen:-->` span".
  // M06 section 2's opening sentence read "Five deltas", was corrected once by
  // session 89 to "Six deltas", and `SD-M6-10` made it wrong again three sessions
  // later with four concurrent sessions about to move it. That is the argument
  // that the number cannot be hand-maintained rather than an argument to maintain
  // it harder, and it is why session 95 left the sentence wrong ON PURPOSE and
  // filed the item instead.
  //
  // THE ROWS OF THE TABLE, BY FIRST CELL, which is `manifest_changes`' own form
  // one entry up rather than a second way of reading a delta table. It counts a
  // pipe-leading line whose first cell is an `SD-M6-nn` and asserts nothing about
  // where that line sits; `CI-06v` is the gate that says the rows are inside a
  // table. That division matters here: `SD-M6-11` was sitting PAST the table's
  // terminating blank line when this query was written, one pipe run of length
  // one, under `CI-06v`'s minimum orphan length of two and therefore invisible to
  // it. The row is moved back into the table in the same commit as this query.
  m06_delta_count: () =>
    (
      read('docs/plans/M06-admin-ops-console.md').match(/^\|\s*\*{0,2}SD-M6-\d+\*{0,2}\s*\|/gm) ||
      []
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

  // ---------------------------------------------------------------------------
  // ADR-088. THE TWO REGISTRY TABLES, DERIVED FROM THE FILES THEY INDEX.
  // ---------------------------------------------------------------------------
  // EVERY OTHER SPAN IN THIS MAP RETURNS A SCALAR. These two return a TABLE, and
  // nothing in the mechanism had to change to allow it: `spansIn` already matches
  // with the `s` flag so a span body may span lines, and `generate` writes
  // `String(query())` verbatim. A multi-line span was expressible for as long as
  // the mechanism has existed and no query had used it.
  //
  // WHY THESE TWO. Measured over the last 25 FIRST-PARENT merges, which is one
  // merge per session: `docs/sessions/README.md` is touched by 25 of 25 and
  // `docs/decisions/README.md` by 10 of 25. They are the first and third most
  // contended files in the tree, and a row transcribed by hand once per session
  // is ADR-034's subject exactly. Session 149 found 27 ADR rows carrying a stale
  // status word, four of them signed the day before.
  //
  // THE STATUS COLUMN CANNOT DRIFT AFTER THIS, because it is no longer copied.
  // `CI-06r` compares an ADR heading with its own body and says so in its own
  // covers line: it "COMPARES A FILE WITH ITSELF AND CAN CHECK NEITHER HALF
  // AGAINST THE GATE RECORD". Nothing compared that heading to the row
  // transcribing it, and now nothing needs to.
  //
  // THE ROW IS THE HEADING, WHICH IS ONLY LOSSLESS BECAUSE TEN HEADINGS MOVED
  // FIRST. Five README rows carried a richer summary than the ADR's own heading
  // and five differed in capitalisation; ADR-088 authorises the ten edits that
  // make the heading say what its row said. The eleventh differing row, ADR-080,
  // needed no edit: there the heading was already the majority convention and it
  // is the row that adopts it.
  //
  // ORDER IS NUMERIC ASCENDING, and that moves seven rows plus `ADR-D1`. The
  // order it replaces is order-of-append, which is not an order a reader can scan
  // for a number. `ADR-D1` carries no three-digit number and is pinned where the
  // registry has always carried it, immediately after `ADR-015`, by the rule
  // below rather than by accident.
  // THE SPAN OWNS THE HEADER AND DELIMITER ROWS TOO, not just the body, and that
  // is `CI-06v`'s doing rather than a preference. A `<!--gen:` line terminates a
  // table for that gate's parser, so an opener sitting between `|---|---|` and
  // the first row leaves the body as an orphan fragment: "85 consecutive pipe
  // lines carry no delimiter row, so they render as prose and no table gate reads
  // them". The whole table inside the span is the only arrangement where the
  // delimiter and its rows cannot be separated by the generator.
  adr_registry: () => {
    const rows = adrEntryFiles().map((file) => {
      const heading = read(file).split('\n', 1)[0];
      const m = /^## (ADR-[0-9A-Za-z]+): (.*)$/.exec(heading);
      if (!m) throw new Error(`${file}: first line is not an ADR heading`);
      return { file: basename(file), id: m[1], title: m[2] };
    });
    rows.sort((a, b) => adrSortKey(a.id) - adrSortKey(b.id));
    const body = rows.map((r) => `| [${r.id}](${r.file}) | ${r.title} |`).join('\n');
    return `\n| ADR | Title |\n|---|---|\n${body}\n`;
  },

  // ADR-088, and the key is ADR-064's, which is signed: "identity is
  // `(log file, section heading)`". So a row is one `##` SECTION, not one file.
  // 145 files hold 185 sections, and before this span the table carried 183 rows:
  // session 95's second and third sections had never been indexed at all.
  //
  // THE TEXT COMES FROM THE SECTION'S OWN `<!--index:` LINE AND NEVER FROM THE
  // HEADING. Checked at source before this was written: session 49's four rows
  // differ from its four headings in every one, and carry text no heading has, so
  // generating from headings would rewrite 183 rows to say less. The marker is
  // deliberately NOT a `gen:` span: it is an input to one, `spansIn` cannot see
  // it, and `CI-06t` does not count it.
  //
  // A SECTION WITH NO MARKER IS A FINDING RATHER THAN A SKIPPED ROW, because a
  // silently omitted row is the defect this span exists to end.
  session_entries: () => {
    const rows = [];
    for (const file of sessionEntryFiles()) {
      const lines = read(file).split('\n');
      let heading = null;
      for (const line of lines) {
        if (line.startsWith('## ')) {
          if (heading) throw new Error(`${file}: section "${heading}" has no <!--index: --> line`);
          heading = line.slice(3).trim();
          continue;
        }
        const m = /^<!--index:\s*(.*?)\s*-->$/.exec(line);
        if (!m) continue;
        if (!heading) throw new Error(`${file}: an index line precedes any section heading`);
        rows.push(`| [${sessionLabel(file)}](${basename(file)}) | ${m[1]} |`);
        heading = null;
      }
      if (heading) throw new Error(`${file}: section "${heading}" has no <!--index: --> line`);
    }
    return `\n| | |\n|---|---|\n${rows.join('\n')}\n`;
  },
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
        if (content.trim() !== actual.trim()) {
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
      // COMPARED TRIMMED, WRITTEN VERBATIM. ADR-088's two table spans return a
      // value that OPENS AND CLOSES WITH A NEWLINE, so that the rows sit on
      // their own lines under the table's delimiter row instead of the first row
      // being welded to the opener comment. Collapsing that layout detaches the
      // body from its `|---|---|` and `CI-06v` reports the whole table as an
      // orphan fragment, which is how this was found.
      if (content.trim() === actual.trim()) continue;
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
          "own named floor, or that calibrationDigest()'s HEX output decodes " +
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
      // 0047, ADR-087, OI-29, MONEY PATH. Pinned in the commit that wires it.
      //
      // THE PIN CARRIES A DIRECTION THE STEP DOES NOT. Two of this probe's
      // sixteen assertions -- `0045 A` and `0045 B` -- exist to prove that
      // 0047's trigger does NOT answer the two rows 0045's CHECK is supposed to
      // refuse. A BEFORE ROW trigger fires before the table's CHECK
      // constraints, so a later migration widening this guard by one clause
      // would silently take over those refusals and every caller resolving
      // publish failures by constraint name would stop working. Nothing else in
      // this job would notice, because both rows would still be refused.
      //
      // And SUCCESS 3 asserts a HOLE rather than a control: a simulation run
      // anchored to no plan version still decides any publish, because 0045
      // makes that column nullable on purpose. Delete this step and the only
      // executable record of what OI-29b still costs goes with it.
      [
        'probe_publish_decision_is_sound.sql',
        "ADR-087's publish-decision soundness is no longer probed, so nothing " +
          'asserts that a publish decided on a failed, queued or running run is ' +
          'refused, that a run anchored to another plan or another version of ' +
          'the same plan is refused, that both the INSERT and the publish-' +
          "transition UPDATE are guarded, that 0045's two CHECK refusals still " +
          "arrive by name, or that 0028's immutability guard still answers " +
          'first on a published row (OI-29)',
      ],
      // 0048, ADR-128. THREE SECURITY DEFINER PATHS AND A CALENDAR GUARD, and
      // the three functions are the only way anything writes daily_marks.
      // superseded_by, identity_links' dispute columns or a rule_states row.
      // Deleting this step would take the negative-authz test with it (VG-5,
      // DATA_MODEL section 14): nothing else in this job asserts that merit_app
      // still cannot UPDATE those three tables directly, and nothing else
      // asserts that EXECUTE was revoked from PUBLIC, which PostgreSQL grants by
      // default on every function it creates.
      [
        'probe_audited_writes.sql',
        "ADR-128's audited writes are no longer probed, so nothing asserts that " +
          'the three SECURITY DEFINER paths exist and work, that merit_app still ' +
          'cannot UPDATE daily_marks, identity_links or rule_states directly, ' +
          'that EXECUTE is not granted to PUBLIC, that the ruled mark correction ' +
          'is performable at all (it was not, before 0048, in either order), that ' +
          'one live mark per account-day still holds now the constraint is ' +
          'deferred, that a rewrite requires B.4 step 3 approval and a moved ' +
          'version-like input, or that CALENDAR-C3 refuses a retroactive calendar ' +
          'INSERT while leaving a forward extension alone (OI-04, OI-12, OI-13)',
      ],
      // 0049, ADR-128. THE NUMBER THAT PAUSES SALES. rcr_bp is a GENERATED
      // column and REJECTION 1 is the only place anything asserts that a zero
      // CVaR99 reaches the NAMED constraint rather than raising a bare division
      // by zero, which is what it does the moment the NULLIF is removed.
      [
        'probe_reserve_coverage.sql',
        "ADR-128's reserve coverage snapshot is no longer probed, so nothing " +
          'asserts that coverage of exactly 1.0 renders exactly 10000 bp rather ' +
          'than arming the breaker on a fully covered book, that truncation runs ' +
          'toward zero, that rcr_bp cannot be written by hand and therefore cannot ' +
          'disagree with its own inputs, that RESERVE-C1 holds the reserve to the ' +
          'attestation it cites (INV-M5-11), that a zero CVaR99 is refused BY NAME ' +
          'rather than by arithmetic, or that the table is append-only and invisible ' +
          'to merit_analytics (OI-01)',
      ],
      // 0064. SESSION 374's B4. Pinned in the commit that wires it, which is the
      // rule rather than the exception now: OI-07 has four recorded occurrences
      // of a probe wired and left unpinned, and CI-06s exists because the second
      // edit is the one that gets forgotten.
      //
      // REJECTION 1 is ADR-199 section 5's refusal written as a constraint, and
      // SUCCESS 4 is the only place anything asserts that the two readings come
      // apart on real rows. SUCCESS 2 is the acceptance case for a table that is
      // deliberately NOT append-only: delete this step and nothing says the
      // producer can still close a sweep it started.
      // 0066, ADR-213. MONEY PATH. The grid every cents value of a payout
      // approval is read from, and the guard that did not exist while the
      // design record said it did.
      //
      // Deleting this step deletes the only assertion that session 401's
      // measured mutation stays refused, and it takes SIX ACCEPTANCE CASES with
      // it. Those are the half that matter here: the failure mode of an
      // over-corrected fix on this table is a guard that refuses EVERY write,
      // which passes all eleven refusals and makes plan authoring impossible.
      // Nothing in apps/ writes this table today, so nobody would find out.
      [
        'probe_published_size_grid_immutable.sql',
        "0066's published size grid guard is no longer probed, so nothing " +
          'asserts that session 401\'s measured mutation stays refused, that ' +
          'an INSERT into a published version is refused as well as an UPDATE ' +
          'and a DELETE, that a row cannot be moved onto or off a published ' +
          'version, or that a draft grid, the publish transition and the one ' +
          'permitted retirement all still work (ADR-213)',
      ],
      [
        'probe_reconciliation_run.sql',
        'the reconciliation run record is no longer probed, so nothing asserts ' +
          'that a sweep which stopped at the account boundary cannot claim it ' +
          'completed (ADR-199 section 5, reconciliation_runs_completed_is_whole), ' +
          'that the latest run and the latest COVERING run come apart on real ' +
          'rows, that one trading day may carry a second run at all (RB-02 ' +
          'section A), that mismatches_found and mismatches_open are different ' +
          'facts rather than one copied twice, that merit_app may still UPDATE ' +
          'the row closing a run, or that reconciliation health stays off the ' +
          'merit_analytics surface',
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
//
// -----------------------------------------------------------------------------
// IT MATCHES A ROW, NOT A MENTION, AND THAT IS `OI-09` CLOSED (ADR-132)
// -----------------------------------------------------------------------------
// FOR ITS FIRST YEAR THIS GATE READ THE README AS ONE STRING and accepted any
// markdown link anywhere in it. Its title said ROW and its parser said MENTION,
// and the two are different claims. ADR-043 section 3, the ruling that asked for
// this gate, says "every entry file has a row in its registry README", so the
// TITLE was the correct half and the parser was the loose one.
//
// THE DEFECT IS NOT HYPOTHETICAL AND IT IS HOW THE GAP WAS FOUND. On 2026-08-16
// ADR-043 itself had no row in the ADR registry table. It was linked from a
// sentence in that README's preamble, this gate accepted the sentence, and one
// ADR of 43 sat outside the registry it belongs to with twelve gates green. The
// ADR that was missing was the ADR that WROTE this gate to pay for its own
// CI-06c exemption. The row was added that day and the parser was left alone,
// carried as `OI-09`, because narrowing a parser without measuring what the
// narrowing costs is the other half of the same mistake.
//
// THIS IS A NARROWING, NOT A WEAKENING, AND THE DIRECTION IS WHAT DECIDES IT.
// Rule 1 forbids a gate that returns PASS for a check it did not perform. This
// change makes the gate report MORE, not less: an entry indexed only by a
// sentence was green and is now a finding. Nothing that failed before passes now.
//
// AND IT COST NOTHING TO MAKE TRUE, which is the number the ruling turns on:
// 648 entry files across the five registries, 648 satisfied under the loose
// reading, 648 satisfied under this one. No document goes RED. Every registry
// README already indexes by table, so the corpus was already obeying the title;
// only the check was not.
//
// A FENCED BLOCK IS A SAMPLE, NOT A ROW, which is CI-06a's own reading of a
// fenced link one file over. docs/decisions/README.md carries the ADR entry
// FORMAT in a fence, and a registry that documents its own row shape must not
// have the documentation counted as coverage. That is the near-miss CI-06s
// names in the workflow-comment direction, one registry along.
//
// WHAT THE NARROWING GIVES UP, STATED RATHER THAN LEFT TO BE DISCOVERED: a link
// in a README's PROSE that points at nothing is no longer reported here, because
// it is not a row and this gate no longer claims anything about mentions. It is
// not unchecked. CI-06a resolves every relative markdown link in every markdown
// file, registry READMEs included, so a broken prose link fails there and fails
// under the gate whose title covers it.
const ci06n = {
  id: 'CI-06n',
  title: 'Every registry entry has a README row, and every README row resolves',
  covers:
    'the transitive half of CI-06c for the registries ADR-043 split. Every entry ' +
    'file in a registry directory is linked from a TABLE ROW of that registry ' +
    'README, and every entry link in a row resolves to a file that exists. ' +
    'A ROW IS A LINE BEGINNING WITH `|`, OUTSIDE A CODE FENCE. A link in the ' +
    "README's prose, or inside a fence, is claimed as NOTHING: it does not index " +
    'an entry, and an entry carrying only such a link is reported with the line ' +
    'it sits on and why it does not count, because that is the repair. ' +
    'ADR-043 asked for a row and this gate ' +
    'accepted a sentence until ADR-132; the entry that fell through was ADR-043 ' +
    'itself. WHAT IT GIVES UP: a prose link that does not resolve is not reported ' +
    'here, because a mention is not a row. CI-06a resolves every relative link in ' +
    'every markdown file and catches it there. ' +
    'It does NOT check the entry contents; CI-06f checks that an ADR entry is ' +
    'named for its own heading.',
  run() {
    const findings = [];
    let checked = 0;
    let rowLinks = 0;
    let mentions = 0;
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
      const lines = read(reg.readme).split('\n');
      const linked = new Set();
      // Entry -> the first link to it that is NOT a row, and which kind it is.
      // Kept only so a finding can say WHERE that link is and WHY it does not
      // count: an entry indexed by a sentence is one row away from correct, and
      // a finding that names the sentence is the difference between a repair
      // and a search. This is why the fenced lines are still SCANNED rather
      // than skipped -- a sample is not a row, and saying so beats silence.
      const mentioned = new Map();
      let fenced = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*```/.test(line)) {
          fenced = !fenced;
          continue;
        }
        const isRow = line.startsWith('|') && !fenced;
        for (const m of line.matchAll(/\[[^\]]*\]\(([^)\s#]+)[^)]*\)/g)) {
          const target = relative(ROOT, resolve(join(ROOT, dirname(reg.readme)), m[1]));
          if (!reg.entry(target)) continue; // links pointing elsewhere are not entry rows
          if (!isRow) {
            if (!mentioned.has(target)) {
              mentioned.set(target, {
                line: i + 1,
                why: fenced ? 'inside a code fence, which is a sample' : 'prose',
              });
            }
            continue;
          }
          rowLinks++;
          linked.add(target);
          if (!existsSync(join(ROOT, target))) {
            findings.push(`${reg.readme}: row does not resolve -> ${m[1]}`);
          }
        }
      }
      for (const f of onDisk) {
        if (linked.has(f)) continue;
        const at = mentioned.get(f);
        findings.push(
          `${f}: entry file with no row in ${reg.readme}` +
            (at ? `, and the link at ${reg.readme}:${at.line} is ${at.why} rather than a row` : ''),
        );
      }
      for (const t of mentioned.keys()) if (!linked.has(t)) mentions++;
      checked += onDisk.length;
    }
    if (REGISTRIES.length === 0 || checked === 0) {
      findings.push('no registry entries checked; CI-06n is asserting nothing');
    }
    // THE MENTION COUNT IS PRINTED RATHER THAN INFERRED. Zero is the corpus
    // saying every registry indexes by table; a number above zero is the exact
    // population `OI-09` was opened about, visible on every run instead of on
    // the day somebody re-reads the parser.
    console.log(
      `       CI-06n note: ${checked} entry file(s) over ${rowLinks} README row ` +
        `link(s) across ${REGISTRIES.length} registry(ies); ` +
        `${mentions} entry link(s) outside any row, prose or fenced, claimed as nothing`,
    );
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
//
// ADR-082 WIDENED THE THIRD DEFINITION AND ADDED NO TOKEN, and the distinction
// is what keeps the sentence above true. The set is closed because it partitions
// on ONE question with exactly three answers: who answers this date, and may
// Merit compute it? Merit's exchange calendar, Merit's own clock, or neither.
// `rail clock` is the third answer, and its name is its first and commonest
// member rather than its boundary; a calibration vendor's observation date is
// the same answer with a different counterparty. A fourth token would partition
// on "who is the counterparty" instead, which has no finite answer set, and the
// next date column from a KYC provider or a market-data feed would have as good
// a claim to its own token as this one had. That is the direction the paragraph
// above names, so the widening moves the DEFINITION and never the token list.
const UNIT_TOKENS = [
  { token: 'trading day', why: 'the exchange CT trading day, answered only by TradingCalendar' },
  { token: 'wall clock', why: "Merit's own clock, answered only by now()" },
  {
    token: 'rail clock',
    why:
      "a third party's own clock, quoted and never computed by Merit: a payment rail's, " +
      "a calibration vendor's, any counterparty whose day Merit reads and never derives " +
      '(ADR-082). `rail` names the class after its commonest member and is not a claim ' +
      'that the counterparty is a payment rail',
  },
];
// THE DEFINITIONS ARE PRINTED WITH THE FINDING, and until ADR-082 they were
// not. `why` was carried beside every token and rendered nowhere: the finding
// offered `trading day | wall clock | rail clock` and no definition of any of
// them, so a session standing at a failing column had to open THIS FILE to
// learn what it was choosing between. Session 120 did exactly that, and the
// item it opened is the one ADR-082 closes.
//
// That is the widening's own delivery mechanism. A definition that reaches the
// decision only if the reader goes looking for it is prose, and ADR-042 already
// ruled that prose is not a control. A token's meaning belongs where the token
// is refused.
const unitVocabulary = () => UNIT_TOKENS.map((u) => `\`${u.token}\` (${u.why})`).join(' | ');

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
    // THE TALLY IS PRINTED SO THAT A VOCABULARY CHANGE CANNOT RE-CLASSIFY A
    // COLUMN IN SILENCE, and it is here because ADR-082 needed the figure and
    // this gate did not have one. A definition may be widened without any token
    // string moving, in which case every declaration must resolve exactly as it
    // did before; that claim is worth nothing if the only way to check it is to
    // read 57 design-record rows by hand. The note makes the before and the
    // after two lines of one runner's output.
    //
    // It counts RESOLUTIONS and not declarations. A design record may answer for
    // two columns in one row (`created_at`, `updated_at`), so the tally sums to
    // the number of date columns that resolved and not to the number of markers
    // on disk, and those are different numbers on purpose.
    const tally = new Map(UNIT_TOKENS.map((u) => [u.token, 0]));
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
            `from: ${unitVocabulary()}`,
        );
        continue;
      }
      if (typeof declared === 'object') {
        findings.push(
          `${ref}: its row declares \`**Unit: ${declared.invalid}**\`, which is not one of ` +
            `${UNIT_TOKENS.map((u) => u.token).join(' | ')}. The three are: ${unitVocabulary()}.` +
            (BUSINESS_DAY.test(declared.invalid)
              ? ' "business day" is the rail\'s language (ADR-042): Merit quotes it and never' +
                ' computes it, and there is no business-day calendar in this system.'
              : ' The vocabulary is closed so that two rows cannot declare the same unit in two' +
                ' spellings and agree only by accident.'),
        );
        continue;
      }
      tally.set(declared, tally.get(declared) + 1);
    }

    console.log(
      `       CI-06m note: ${dates.length} \`date\` column(s) in scope over ` +
        `${UNIT_TOKENS.length} token(s); ` +
        `${UNIT_TOKENS.map((u) => `${tally.get(u.token)} ${u.token}`).join(', ')}; ` +
        `${dates.length - [...tally.values()].reduce((a, b) => a + b, 0)} unresolved`,
    );

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
 * The paths assertion 1 scans. ADR-044 names four money paths and TWO of them
 * now exist; the other two are listed as the names assertion 2 watches for.
 *
 * `packages/ledger` JOINED THIS LIST BECAUSE ASSERTION 2 DEMANDED IT. ADR-104
 * landed the posting path and this gate failed on the good news, naming the
 * package and quoting its own rule back: a directory whose name carries one of
 * `MONEY_PATH_WORDS` and is absent from this list means ADR-044 prohibition 1 is
 * not enforced over it. That is the mechanism working exactly as its own header
 * describes -- "DISCOVERS money paths independently of its own scope list" --
 * and the remedy is this line rather than an exemption.
 */
const CI06O_SCOPE = ['packages/rules-engine', 'packages/ledger'];

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
  title:
    'No model SDK or model endpoint on the money path, and no money path outside the scope list',
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
// CI-06/closed-letter-series  THE `CI-06<letter>` SERIES IS CLOSED AT `w`
// -----------------------------------------------------------------------------
// ADR-065 SECTION 5 RULED THE SUCCESSOR IDENTIFIER A SLUG AND IT DID NOT CLOSE
// THE SERIES. Nine slug gates have been written since and every one of them took
// a slug by discipline alone, which is ADR-042's prose wearing a convention's
// name: nothing in this runner would have reported a twenty-fourth letter.
//
// ADR-131 closes it. The members are `a` through `w`, they are historical names
// that stay exactly as they are, and no new letter may be claimed by anybody.
//
// THE CLOSED SET IS WRITTEN AND NEVER COMPUTED, which is ADR-074 section 2's
// rule applied to a registry rather than to a series. A gate deriving its closed
// set from the letters the runner currently implements would admit every new
// letter on the commit that added it and report the series closed at whatever
// the tree happens to hold. That is a control that cannot fail.
//
// THREE INPUTS, BECAUSE THERE ARE THREE PLACES A LETTER CAN BE TAKEN: the
// runner's own gate ids, the letter table in ALLOCATION, and STRATEGY section
// 4.4's inventory. CI-06p already reads all three and asserts they agree with
// each other; this gate asserts what they may say at all, which is the assertion
// a registry needs once it is closed and no agreement can supply.
//
// ASSERTION 4 RUNS THE OTHER WAY AND IT IS WHAT KEEPS THE CONSTANT LOAD BEARING.
// Every member of the closed series must still be claimed by a row of the letter
// table. Without it the written constant is decorative, because three subset
// assertions over sets that only shrink are all satisfied by an empty tree.
//
// WHAT THE CLOSURE BUYS THE HARNESS, and it is the reason the last letter is
// RETIRED rather than spent. `falsify.mjs`'s `nextFreeLetter()` scans `a` to `x`
// and throws `seed anchor exhausted` when all are claimed, and the CI-06p seed
// writes a row TWO PAST the letter it returns. With the series closed at `w`,
// `nextFreeLetter()` returns `x` on every future tree and the seed writes `z` on
// every future tree. The CI-06p falsification case can no longer go stale, and
// before this closure it was one claim away from dying.
//
// FOUR THINGS IT DOES NOT DO. It renames nothing: ADR-131 section 4 rules the
// rename out on the record rather than on the cost, and a letter already spent
// is a name in 145 session logs that were true when they were written. It reads
// no gate BODY, so whether a gate still deserves its letter is a question for
// the session that owns that gate. It inherits the one-ref gap CI-06f, CI-06h
// and CI-06p each declare, so a sibling branch claiming `x` is invisible here
// and is caught when the two branches meet. And it says nothing about slugs: a
// slug cannot exhaust, so there is no slug series to close.

/**
 * The CI-06 letter series, CLOSED. Written, never derived, per ADR-074 section 2.
 * The last member is read from this string rather than typed a second time.
 */
const CLOSED_LETTER_SERIES = 'abcdefghijklmnopqrstuvw';

const ci06ClosedLetterSeries = {
  id: 'CI-06/closed-letter-series',
  title: 'The CI-06<letter> series is closed at w, and a new gate takes a slug',
  covers:
    'ADR-131, implemented as ruled. THE CLOSED SET IS A WRITTEN STRING and the gate is worth ' +
    'nothing without that: a closed set computed from the tree admits every new letter on the ' +
    'commit that adds it, which is ADR-074 section 2 exactly. FOUR ASSERTIONS. Three subset ' +
    'checks over the three places a letter can be taken (the runner gate ids, the ALLOCATION ' +
    'letter table, the STRATEGY 4.4 inventory) and a fourth running the other way, that every ' +
    'closed member is still claimed by a row, which is what stops the three from passing ' +
    'vacuously on a tree that has lost its inputs. ' +
    'IT IS NOT CI-06p. That gate asks whether the three registries AGREE; this one asks what ' +
    'they may say at all. Agreement cannot express a closure, because a letter claimed in all ' +
    'three places agrees with itself. ' +
    'FOUR THINGS IT DOES NOT DO. It renames nothing (ADR-131 section 4). It reads no gate ' +
    'body, so whether a gate deserves its letter belongs to whoever owns that gate. It ' +
    'inherits the one-ref gap CI-06f, CI-06h and CI-06p each declare, so a letter a sibling ' +
    'branch claims is invisible until the branches meet. And it asserts nothing about slugs, ' +
    'because a slug cannot exhaust and there is no slug series to close.',
  run() {
    const findings = [];
    const closed = new Set(CLOSED_LETTER_SERIES);
    const last = CLOSED_LETTER_SERIES[CLOSED_LETTER_SERIES.length - 1];

    // Rule 2 on a derived input, and it is CI-06p's guard verbatim. A regex that
    // stopped matching the gate ids would empty this set, and an empty set
    // satisfies assertion 1 in silence.
    const implemented = implementedLetters();
    if (implemented.size === 0) {
      throw new Error('no CI-06<letter> gates found in this runner; the gate cannot run');
    }
    // `allocatedLetterClaims` throws on a table that parses to no rows, so this
    // input carries its own Rule 2 guard one function down.
    const claimed = allocatedLetters(read(ALLOCATION_DOC));
    const rowed = strategyGateLetters();
    if (rowed.length === 0) {
      throw new Error(
        `${STRATEGY_DOC}: the ${GATE_INVENTORY} inventory parsed to zero CI-06 rows; ` +
          'CI-06/closed-letter-series is asserting nothing about it',
      );
    }

    // One sentence for all three subset assertions, because they are one rule
    // read in three places and a reader who hits it in CI should not have to
    // work out which registry made it different.
    const beyond = (letter, where) =>
      `CI-06${letter} ${where}, and the CI-06<letter> series is CLOSED at ${last} ` +
      '(ADR-131). A new gate takes a SLUG, CI-06/<subject>, per ADR-065 section 5. ' +
      `The letters past ${last} are retired rather than free: falsify.mjs's ` +
      'nextFreeLetter() holds them as the headroom every CI-06p seed spends';

    // Assertion 1: the runner.
    for (const letter of [...implemented].sort()) {
      if (!closed.has(letter)) findings.push(beyond(letter, 'is implemented in this runner'));
    }

    // Assertion 2: the registry. This is the one that fires on a RESERVATION,
    // which is where a letter is taken first (ADR-034: the claim precedes the
    // artifact), so it is the assertion that catches a new letter EARLIEST.
    for (const letter of [...claimed].sort()) {
      if (!closed.has(letter)) {
        findings.push(
          beyond(letter, `is claimed by a row of the letter table in ${ALLOCATION_DOC}`),
        );
      }
    }

    // Assertion 3: the description. A gate rowed in STRATEGY and claimed nowhere
    // is a letter taken in the document a reader consults first.
    for (const letter of [...new Set(rowed)].sort()) {
      if (!closed.has(letter)) {
        findings.push(
          beyond(letter, `heads a row of ${STRATEGY_DOC}'s "${GATE_INVENTORY}" inventory`),
        );
      }
    }

    // Assertion 4, the other direction. A CLOSED series is a record, so a member
    // does not leave it. Without this the three above are satisfied by a tree
    // that has lost the table entirely, and the written constant asserts nothing.
    for (const letter of closed) {
      if (!claimed.has(letter)) {
        findings.push(
          `CI-06${letter} is a member of the CLOSED CI-06<letter> series and no row of the ` +
            `letter table in ${ALLOCATION_DOC} claims it. A closed series is a record of ` +
            'names already spent; a row that goes is a citation the corpus can no longer ' +
            'decode, and 145 session logs cite these letters (ADR-131)',
        );
      }
    }

    console.log(
      `       CI-06/closed-letter-series note: ${closed.size} closed member(s), a to ${last}; ` +
        `${implemented.size} implemented in this runner, ${claimed.size} claimed by the letter ` +
        `table, ${new Set(rowed).size} rowed in STRATEGY; ` +
        `${26 - closed.size} letter(s) past ${last} retired unused and held as falsify headroom`,
    );
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
    // `2026-08-20 - session 95` JOINED THIS LIST WHEN THE TABLE BECAME GENERATED
    // (ADR-088) and it is not a new defect. That file has held three `##`
    // sections since the day it was written and the hand-maintained table
    // carried ONE row for it, so two of its sections were unindexed and its key
    // was not a duplicate. Generating the table from the sections surfaces the
    // other two, and a file sharing one path across several sections is exactly
    // the ADR-061 T3 shape the other twenty keys here already have.
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
      '2026-08-20 - session 95',
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
    "one of exactly that shape holding six of its own gate rows, CI-06u's among them, " +
    "and ADR-065 records four more in ALLOCATION's letter table. " +
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
    "damaged its content is, which is CI-06u's business and not this gate's. And it " +
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
// CI-06/table-row-width  Every table row carries the cell count its table declares
// -----------------------------------------------------------------------------
// THE RECEIPT IS PR #299 AND ALL 30 GATES PASSED OVER IT. A row inserted into the
// session reservation table of `docs/sessions/README.md` landed PAST the blank
// line that terminated the table, and the prettier run that followed absorbed the
// paragraph below into the table: the blank line and the paragraph's first
// sentence vanished, and NINE CONTINUATION LINES BECAME TABLE ROWS with first
// cells like `lands, its entry joins the list below`. The paragraph it ate was the
// one explaining the strikethrough rule.
//
// WHY THE TWO TABLE GATES BOTH STAYED GREEN, WHICH IS THE PART WORTH REPRODUCING
// BEFORE ANYTHING IS DESIGNED. `CI-06u` looks for DUPLICATE first cells and nine
// prose lines are all distinct. `CI-06v` looks for ORPHAN runs carrying no
// delimiter and these sat inside a well formed table. NEITHER GATE ASKS WHETHER A
// ROW BELONGS.
//
// THE HYPOTHESIS THAT PULL REQUEST NAMED, AND THE MEASUREMENT THAT REPLACED IT.
// #299 proposed the cheap check as "a table row whose first cell is not shaped
// like the table's key column". That was surveyed against every table under
// `docs/` before this gate was written, and the numbers are the argument:
//
//   * FIRST-CELL SHAPE, at a homogeneity threshold of 80%: 593 of 1,593 multi-row
//     tables are in scope at all (37%), 1,000 have no first column matching any
//     identifier shape, and 25 rows in 14 tables would need registering. AND IT
//     MISSES #299: eight absorbed rows drag the reservation table to 27 of 35
//     conforming, which is 0.77, so the table falls out of scope and the gate
//     goes quiet on the exact defect it was proposed for.
//   * FIRST-CELL SHAPE, at a threshold of 50% so that #299 IS caught: 155 rows in
//     67 tables to register on a clean tree. An allowlist that size is furniture
//     within a month.
//   * CELL COUNT: 1,604 of 1,604 tables in scope, ZERO shape exemptions needed,
//     17 rows to register, and it names all eight of #299's absorbed rows.
//
// So the discriminator is the CELL COUNT and not the first cell, and the survey is
// recorded here rather than the conclusion alone. `RI-10`'s lesson is what decided
// it: a check that needs a name-based exception is usually scoped wrong, and this
// one needs no exception of any kind. `DIMENSION_HEADERS` exists one gate up
// because `CI-06u` genuinely cannot be written without it; nothing of the sort is
// needed here.
//
// THE DELIMITER ROW IS THE AUTHORITY AND NOT THE HEADER, which is GitHub-flavoured
// markdown's own rule: the delimiter declares the column count, the header must
// match it or no table is rendered at all, and a body row with FEWER cells is
// padded with empty ones while a body row with MORE has the excess SILENTLY
// DISCARDED. Both directions are asserted and they are different defects:
//
//   FEWER is #299's shape. Prose that has been pulled inside the table renders as
//   a row of empty cells, and the sentence is now data.
//   MORE is a cell split by a pipe nobody escaped, and the tail of the row is
//   dropped on render. Fifteen of the seventeen registered rows are this, six of
//   them in `ALLOCATION`'s own ADR table, where a whole disposition paragraph is
//   invisible to every reader who reads the rendered file.
//
// MEASURED ON THIS REF RATHER THAN ASSUMED: every one of the 1,604 tables under
// `docs/` carries EXACTLY ONE delimiter row, EXACTLY ONE header row above it, and
// a header whose cell count already equals its delimiter's. So the header
// assertion below finds nothing today and is written for the day a column is
// added to one row of the pair and not the other, which is the edit that makes
// GitHub stop drawing the table entirely.
//
// FOUR THINGS IT DOES NOT DO, written here rather than left to be discovered.
//   1. IT COUNTS CELLS AND READS NONE OF THEM. A row of the right width whose
//      content is absorbed prose passes, and a row that contradicts the one above
//      it passes. What belongs in a cell is `CI-06u`'s question and a founder's.
//   2. A ONE-COLUMN TABLE IS BEYOND IT. Absorbed prose in a table whose delimiter
//      declares one cell has the right width by construction. There are none in
//      `docs/` today (the narrowest is two, 479 of them), so the gap is real and
//      unoccupied.
//   3. IT INHERITS THE ONE-REF GAP `CI-06f`, `CI-06h`, `CI-06p`, `CI-06u` and
//      `CI-06v` each declare. A pull request whose merge produces the ragged row
//      is caught at the merge and not at the pull request.
//   4. A ROW INDENTED PAST A LIST MARKER PARSES AS PROSE AND IS CLAIMED AS
//      NOTHING, exactly as it is for `CI-06u`, because both gates read the same
//      run splitter and a shared parser is the point of sharing it.
//
// THE REGISTER IS `CI-06u`'S, KEYED THE SAME WAY AND SHRINKING THE SAME WAY. Every
// (file, first-cell key) pair whose row is ragged on `main` as of 2026-08-26 is
// named below; not one is accepted as correct, and an entry that no longer names a
// ragged row is itself a finding, so a repair forces the register down by one
// rather than leaving an exemption behind it. It is keyed by first cell and NOT by
// line number for the reason `CI-06u` gives: four of the entries live in a
// GENERATED table whose rows move on every regeneration.
const CI06_WIDTH_REGISTER = new Map([
  [
    // One quoted table row inside a cell, its two inner pipes unescaped, so the
    // quotation splits into cells 3 and 4 and cell 4 is dropped on render.
    'docs/decisions/ADR-073.md',
    ['the implementation is stated identically in three documents and it is not a build check'],
  ],
  [
    // SIX ROWS OF THE ADR ALLOCATION TABLE, AND THIS IS THE WORST ENTRY HERE. The
    // table declares three columns; these rows carry four, so the FOURTH cell --
    // a whole disposition paragraph, in the registry a sibling branch reads to
    // decide whether a number is free -- is discarded by every markdown renderer
    // that draws this file. The repair is one escaped pipe per row and it belongs
    // to whoever next holds ALLOCATION; this session holds ONE ROW of that file
    // and takes only that row.
    'docs/decisions/ALLOCATION.md',
    ['079', '088', '095', '104', '112', '0046'],
  ],
  // A row that is SHORT rather than long: three columns declared, two supplied.
  ['docs/plans/M10-integrations.md', ['replica lag']],
  // An unescaped pipe inside `{ benefit_id, consumed_ref | reason }`.
  ['docs/plans/M14-loyalty-retention.md', ['loyalty.benefit_consumed / .expired / .revoked new']],
  // Three short rows in a four-column table, in a session log, which is a record
  // and is repaired by editing a record. Named rather than exempted for that
  // reason: the register is where a repair somebody has to decide on waits.
  [
    'docs/sessions/2026-08-18-session-59.md',
    ['r-02 counter advance', 'r-03 half day', 'r-06 last closed day'],
  ],
  [
    // FOUR, AND THREE OF THEM ARE IN A GENERATED TABLE. The `session_entries` span
    // builds each row from a session log's own `<!--index:` line, and three of
    // those lines carry a pipe inside an inline code span -- `INV-M19|SD-M19|...`
    // and `'next\.js|react'` -- which splits the generated row and drops its tail.
    // THE REPAIR IS THE GENERATOR AND NOT THESE ROWS: escaping the pipe as the
    // cell is built fixes all three and every one after them. It is not done here
    // because it rewrites the table five concurrent sessions are appending to
    // tonight, and a merge conflict in the row somebody else is landing is a worse
    // trade than a register entry that names the fix. The fourth, `217`, is a
    // hand-written reservation row carrying an unescaped pipe.
    'docs/sessions/README.md',
    ['217', '2026-08-24 - session 168', '2026-08-24 - session 183', '2026-08-24 - session 186'],
  ],
  // The `CI-06/conflict-markers` row spells the three markers, and the SEPARATOR
  // is seven `=` inside a code span, which splits nothing -- but the row also
  // carries an unescaped pipe further along. Session 231 holds STRATEGY's CI-09
  // row tonight and this session holds nothing in that file, so it is registered.
  ['docs/testing/STRATEGY.md', ['ci-06/conflict-markers']],
]);

const ci06TableRowWidth = {
  id: 'CI-06/table-row-width',
  title: 'Every markdown table row under docs/ carries the cell count its delimiter declares',
  covers:
    'THE DEFECT PR #299 LANDED AND ALL 30 GATES PASSED OVER. A row insertion landed past the ' +
    "table's terminating blank line and a prettier run absorbed NINE PROSE LINES INTO THE " +
    'TABLE AS ROWS, with first cells like "lands, its entry joins the list below". CI-06u ' +
    'looks for duplicate first cells and nine prose lines are all distinct; CI-06v looks for ' +
    'orphan runs and these sat inside a well formed table. NEITHER GATE ASKS WHETHER A ROW ' +
    'BELONGS, and this one asks it by CELL COUNT. ' +
    'THE DISCRIMINATOR WAS MEASURED, NOT ASSUMED, AND IT IS NOT THE ONE #299 PROPOSED. That ' +
    'pull request suggested "a first cell not shaped like the key column". Surveyed over ' +
    'every table under docs/: first-cell shape at an 80% homogeneity threshold covers 593 of ' +
    '1,593 multi-row tables, needs 25 registered rows, AND MISSES #299 (the reservation table ' +
    'falls to 27 of 35 conforming, below any usable threshold); at 50%, it catches #299 and ' +
    'costs 155 registered rows in 67 tables. CELL COUNT covers 1,604 of 1,604 tables, needs ' +
    "NO shape exemption of any kind, costs 17 registered rows, and names all eight of #299's " +
    "absorbed rows. RI-10's lesson decided it: a check needing a name-based exception is " +
    'scoped wrong, and this one needs no exception. ' +
    "THE DELIMITER ROW IS THE AUTHORITY, which is GFM's own rule: it declares the column " +
    'count, the header must match it or nothing renders as a table, a short row is padded ' +
    'with empty cells and a long row has its excess SILENTLY DISCARDED. Both directions are ' +
    "findings and they are different defects: SHORT is #299's absorbed prose, LONG is a cell " +
    'split by an unescaped pipe with its tail dropped on render -- fifteen of the seventeen ' +
    "registered rows, six in ALLOCATION's own ADR table where a whole disposition paragraph " +
    'is invisible to every reader of the rendered file. ' +
    'FOUR THINGS IT DOES NOT DO. It counts cells and reads none of them, so a row of the ' +
    "right width holding absorbed prose passes and that is CI-06u's question. A ONE-COLUMN " +
    'table is beyond it by construction and docs/ has none (the narrowest is two, 479 of ' +
    'them). It inherits the one-ref gap CI-06f, CI-06h, CI-06p, CI-06u and CI-06v each ' +
    'declare. And a row indented past a list marker parses as prose and is claimed as ' +
    'nothing, exactly as it is for CI-06u, because both read the same run splitter. ' +
    "THE REGISTER IS CI-06u'S, KEYED BY (file, first cell) AND SHRINKING ONLY: an entry that " +
    'no longer names a ragged row is a finding, so a repair forces it down by one. Its size ' +
    'is printed on every run rather than stated here, because a repair moves it and this ' +
    'text does not.',
  run() {
    const findings = [];
    const files = markdownFiles().filter((p) => p.startsWith(CI06U_DOCS));
    // Rule 2 on a glob-shaped input, the same guard CI-06u and CI-06v carry. A
    // prefix that stopped matching would make every ragged row in the corpus pass.
    if (files.length === 0) {
      throw new Error(`no markdown files under ${CI06U_DOCS}; the gate cannot run`);
    }

    const found = new Map(); // file -> Set(key)
    let tables = 0;
    let rows = 0;

    for (const file of files.sort()) {
      for (const table of markdownTables(read(file))) {
        tables++;
        const delimiterAt = table.findIndex((r) => isDelimiterRow(r.raw));
        // The delimiter declares the width. `markdownTables` only keeps runs that
        // carry one, so this index is never -1.
        const width = rowCells(table[delimiterAt].raw).length;

        // ASSERTION 1: the header agrees with the delimiter. GFM refuses to draw
        // a table at all when they disagree, so the whole block silently becomes
        // a paragraph of pipes. Zero tables under docs/ violate this today; it is
        // written for the edit that adds a column to one of the pair.
        if (delimiterAt > 0) {
          const headerWidth = rowCells(table[delimiterAt - 1].raw).length;
          if (headerWidth !== width) {
            findings.push(
              `${file}:${table[delimiterAt - 1].n}: the header row has ${headerWidth} cell(s) ` +
                `and the delimiter row below it declares ${width}. GitHub draws no table at ` +
                'all when those disagree: the whole block renders as a paragraph of pipes, ' +
                'and every table gate in this runner goes on reading it as a table',
            );
          }
        }

        // ASSERTION 2: every body row carries the declared width.
        let past = false;
        for (const row of table) {
          if (isDelimiterRow(row.raw)) {
            past = true;
            continue;
          }
          if (!past) continue;
          rows++;
          const cells = rowCells(row.raw);
          if (cells.length === width) continue;
          const key = firstCellKey(cells[0] ?? '');
          if (!found.has(file)) found.set(file, new Set());
          found.get(file).add(key);
          if (CI06_WIDTH_REGISTER.get(file)?.includes(key)) continue;
          findings.push(
            cells.length < width
              ? `${file}:${row.n}: this row has ${cells.length} cell(s) where its table's ` +
                  `delimiter declares ${width} (table opens at line ${table[0].n}). First cell: ` +
                  `"${key.slice(0, 60)}". A SHORT row renders as empty cells, and the shape ` +
                  'that produces one is prose absorbed past the blank line that ended the ' +
                  'table, which is PR #299 exactly. Either the row belongs and is missing ' +
                  'cells, or it is a sentence and belongs outside the table'
              : `${file}:${row.n}: this row has ${cells.length} cell(s) where its table's ` +
                  `delimiter declares ${width} (table opens at line ${table[0].n}). First cell: ` +
                  `"${key.slice(0, 60)}". A LONG row has its excess cells SILENTLY DISCARDED on ` +
                  'render, so the tail of this row is invisible to every reader of the ' +
                  'rendered file. The usual cause is a pipe inside a cell: escape it as \\|',
          );
        }
      }
    }

    // Rule 2 on the parser rather than on the input, which is CI-06u's guard
    // verbatim. This corpus is written in tables; zero means the table parser has
    // stopped matching and every ragged row in the tree would pass.
    if (tables === 0) {
      throw new Error(
        `CI-06/table-row-width parsed zero markdown tables under ${CI06U_DOCS}. This corpus ` +
          'is written in tables, so zero means the table parser has stopped matching and ' +
          'every ragged row in the tree would pass for the wrong reason',
      );
    }

    // THE REGISTER SHRINKS ONLY, which is CI-06u's property and CI-06l's before
    // it. An entry naming a row that is no longer ragged is a repair the register
    // did not follow, and a register nobody has to maintain is an exemption list
    // that outlives its reason.
    let registered = 0;
    for (const [file, keys] of CI06_WIDTH_REGISTER) {
      for (const key of keys) {
        registered++;
        if (found.get(file)?.has(key)) continue;
        findings.push(
          `${file}: the register claims the row headed "${key}" is a known ragged row and it ` +
            'is not one on this ref. Either the repair landed and this line goes, or the row ' +
            'moved and the register moves with it. A register entry that names nothing ' +
            'exempts nothing and hides the next one',
        );
      }
    }

    console.log(
      `       CI-06/table-row-width note: ${rows} body row(s) over ${tables} table(s) under ` +
        `${CI06U_DOCS}; ${registered} ragged row(s) registered across ` +
        `${CI06_WIDTH_REGISTER.size} file(s), each one a repair this gate is waiting for`,
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
//   5. THE TWO SUMMARY TABLES ARE DERIVED FROM THE ROWS. They WERE
//      hand-maintained counts sitting above hand-maintained rows, which is
//      ADR-034's class, and CI-06g could not reach them because they were not
//      generated spans. `OI-25` and `ADR-133` put them in one, and that CHANGES
//      WHAT THIS ASSERTION MEANS rather than retiring it: it no longer catches a
//      typist, because nobody types the number now. It cross-checks TWO
//      INDEPENDENT READERS of the same rows -- `fixture-backlog.mjs` writes the
//      span, the loop below re-derives it here with its own parser -- which is
//      the `sql_tables` against `tables` arrangement one screen up, and it is
//      exactly what a span alone does not buy. ADR-034 says so in terms: "a
//      generated span can still be generated from the wrong query".
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
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
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

// A generated span's own markers, ASSEMBLED AND NEVER SPELLED, for the reason
// CI-06/span-tokens' header gives at length: a file describing this mechanism is
// a file carrying the defect unless it is careful, and an opener written out with
// no closer after it pairs with the next span's closer and swallows everything
// between.
//
// WHY A SUMMARY CELL IS STRIPPED OF THEM. ADR-034's remedy for a derivable count
// is a generated span, and OI-25 put the eleven counts below into one. A reader
// that cannot parse a generated cell is a reader that FORBIDS the remedy it
// recommends: without this, assertion 5 would report every term as having no
// summary row at all on the commit that repaired them.
const SPAN_MARKERS = new RegExp(`<!--${'gen'}:[a-z0-9_]+-->|<!--/${'gen'}-->`, 'g');

// The two summary tables above the rows. Read by a FLAT scan for a row whose
// first cell is a declared term and whose second parses as an integer, which is
// safe here rather than lax: a data row's first cell is always `GS-nnn`, and a
// blocker term appears in a data row's THIRD cell and never its first, so no
// data row can be mistaken for a summary row.
function fixtureSummaryCounts(vocabulary) {
  const declared = new Map();
  for (const line of read(FIXTURE_STATUS_DOC).split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim().replace(/[`*]/g, '').replace(SPAN_MARKERS, ''));
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
    'The rows of docs/testing/golden-scenarios/39-fixture-status-and-blockers.md against ' +
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
              `"${term}" and the rows below give ${actual.get(term)}. Since OI-25 that cell is ` +
              'a generated span, so either it was hand-edited without regenerating (run: node ' +
              'scripts/corpus/gates.mjs generate) or fixture-backlog.mjs and this loop, which ' +
              'are two independent readers of the same rows, disagree -- and that is a parser ' +
              'defect in one of them rather than a stale number',
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
// ADR-074 AS AMENDED ON 2026-08-21 AND SIGNED, IMPLEMENTED AS RULED. Its scope,
// its exemptions and its definition-site parse are that ruling's and not this
// session's. Where the ruling and the tree disagree the disagreement is REPORTED
// and never resolved by re-scoping; session 115 reported four such places
// against the ruling as it then stood, the amendment resolved all four, and the
// last block of this comment is what each resolution cost this file.
//
// THE RULE, QUOTED FROM ADR-074 SECTION 1 RATHER THAN PARAPHRASED:
//
//   "A definition site is a table row whose first cell LEADS with the
//    identifier, or a markdown heading whose text LEADS with the identifier,
//    occurring inside the series' DECLARED REGISTER. Every member of an
//    in-scope series has exactly one, unless it is a DECLARED WITHHELD member
//    (section 5.1). Every other occurrence anywhere in the repository is a
//    citation and is unconstrained."
//
// Five things in that sentence are load bearing and each is a measurement.
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
//   enumerating it. A register is a FILE, a file and ONE `##` SECTION, or an
//   ADR-043 registry DIRECTORY, and section granularity is not a convenience:
//   M01 section 1 holds `INV`'s 24 definition rows and Appendix A holds one more
//   for the same identifier in a COVERAGE table, so a file-wide register reports
//   `INV` as broken. Measured here: section scoping is what takes `INV`, `CV`
//   and `RB` from failing to clean. The amendment widens the class ONE FILE
//   SHAPE FURTHER, to an ADR-043 registry ENTRY THAT BINDS: an `ADR`, an `EC`, a
//   `GS`. Never a session log and never a review record, and section 1 gives one
//   reason for both exclusions rather than two -- a review record binds nothing
//   by existing, and a session log is never afterwards amended, so a defect
//   inside either can never be repaired and an entry naming it could never
//   close. `OQ-F6`'s register is admitted by that widening and by nothing else.
//
//   A TABLE ROW IS A ROW WHEREVER IT SITS ON THE LINE. ADR-067's open-question
//   table is INDENTED TWO SPACES, inside a `- **Open questions for the
//   founder:**` list item, which is this corpus's ordinary shape for a decision
//   block's own tables. A parse anchored to column zero reads those three rows
//   as prose and reports a series with a perfectly good register as having none.
//   Leading whitespace is stripped before the ROW test only, which is the width
//   section 1 rules and not one character more: an indented `#` is a heading in
//   markdown only until the fourth space makes it a code block, and no clause
//   asks for that judgement to be made here.
//
//   THE SEARCH SPACE IS THE REPOSITORY, NOT `docs/`. Registers already live
//   under `packages/`.
//
// THE SCOPE IS WRITTEN, NEVER DISCOVERED (ADR-074 section 2), and this is the
// assertion the gate is worth nothing without. A gate whose scope is "every
// series that currently satisfies the rule" PASSES FOREVER BY CONSTRUCTION: the
// day a series breaks it leaves scope and the gate reports 117 of 117. So the
// tables below are closed lists, one argued entry each, and they are here rather
// than in a document for CI-06w's reason: the registration and the
// implementation are the same line and cannot drift apart.
//
// THE FOUR DISAGREEMENTS SESSION 115 REPORTED, AND WHAT THE AMENDMENT DID WITH
// EACH. This file carried all four as reported defects for one commit. None was
// closed by re-scoping and none is closed here on this session's authority: the
// ruling moved, in writing, and this is the transcription of where it moved to.
//
//   1. THE COUNT DID NOT REPRODUCE, AND ADR-074 SECTION 3 ASKED FOR EXACTLY
//      THAT CHECK: "The count is stated so W8 can check that its transcription
//      reproduced it." It stated 118 series and 1,086 members and the four
//      classes transcribed to 117 and 1,083. SECTION 3.1 RETRACED EVERY FIGURE
//      TO ITS SOURCE rather than adjusting the total: the module row's 96 was
//      3 high because it counted three series section 5 claims as pending at the
//      same time, the design row's 7 was 2 low because it copied the count of
//      the `OQ-*` sub-series into the column counting the class, the two errors
//      very nearly cancel, and 1,086 reproduces from no stated reading at all.
//      117 and 1,083 now sit inside a partition of all 215 series and all 2,106
//      members that CLOSES IN BOTH COLUMNS, which a corrected subtotal never
//      would have.
//   2. `OQ-F6` WAS RULED IN SCOPE WITH NO REGISTER SECTION 1 THEN ADMITTED, and
//      this file reported its only definition sites as rows in a SESSION LOG.
//      The reported evidence was wrong and the ruling was narrow, both:
//      `OQ-F6`'s rows are in ADR-067, THE ENTRY THAT RAISES IT, and session 94
//      carries a second copy, which is a citation. They were unreadable here for
//      a second reason nobody had named: they are indented two spaces inside a
//      list item and the row test was anchored to column zero. Section 1's
//      register class widens to an ADR-043 entry that binds and the row test
//      relaxes, so `OQ-F6` is IN SCOPE, register `docs/decisions/ADR-067.md`.
//   3. `P-M6` WAS RULED IN SCOPE AND `P-M6-11` WAS DELIBERATELY NOT MINTED.
//      A deliberate gap and an accidental one are different things and the
//      ruling had vocabulary for only the second. SECTION 5.1 GIVES IT ONE: a
//      WITHHELD MEMBER is an identifier of an in-scope series that a recorded
//      decision declined to mint, it is excluded from its series' membership,
//      and the series stays in scope. `P-M6` is IN SCOPE, register M06, with
//      `P-M6-11` withheld on session 112's record and in the third table below.
//   4. SECTION 5 NAMED TEN OF THE EIGHTEEN SERIES IN ITS FIRST PENDING CLASS.
//      The other eight were identified nowhere in the ruling or the survey and
//      twelve candidates in the tree could be argued into the description, so
//      this file held the ten that are named and reported the shortfall. THE
//      CLASS IS NARROWED TO THOSE TEN, on the ruling's own argument that an
//      arbitrary eight would be a worse artifact than an honest ten: a pending
//      entry's whole value is that it names one real defect and the repair that
//      ends it, and eight entries picked to satisfy a total name neither.
//
// SO: 117 SERIES, 1,083 MEMBERS, ZERO FINDINGS, which is the state ADR-074
// section 6 rules the gate must arrive in, at the count the amended ruling
// states and with nothing left over. A gate over 1,083 members that passes the
// day it is written has proven nothing yet; its value is entirely in what it
// refuses tomorrow, and the three mechanisms that make that real are the written
// scope above, the pending register below, and the withheld table that fails in
// BOTH directions.

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
  //
  // THE COMMENT SAID 93 AND THE BLOCK HELD 92 UNTIL `P-M6` LANDED IN IT, which
  // is ADR-074 section 8's fifth edit and is called out there rather than fixed
  // quietly: a class comment that disagrees with its own list is one more figure
  // that disagrees, inside the change that exists to end figures disagreeing.
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
  ['P-M6', 'docs/plans/M06-admin-ops-console.md'],
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
  // 9 in a design, fold or DECISION document, which is the number ADR-074
  // section 3's row names and section 3.1 restores to its count column. Seven
  // `OQ-*` sub-series are in scope and twenty are not, and the split is a
  // finding rather than an inconsistency: the FOLD and PHASE plans register
  // their open questions in the document that raises them and the MODULE plans
  // do not. Same prefix, two conventions, one of them checkable. `OQ-F6` is the
  // seventh and it obeys the same convention in a different FILE CLASS: the
  // document that raises it is an ADR rather than a plan, which is why section
  // 1's register class had to widen before it could be counted here. `OQ-P1` is
  // clean and identically shaped to `OQ-P2` and ADR-074 does not name it, so it
  // is undeclared and counted.
  // ---------------------------------------------------------------------------
  ['DG', 'docs/design/DESIGN_SYSTEM.md'],
  ['SS', 'docs/design/DESIGN_SYSTEM.md'],
  ['OQ-F3', 'docs/plans/FOLD-03-vendor-parity-gap-fill.md'],
  ['OQ-F4', 'docs/plans/FOLD-04-impersonation-and-admin-parity.md'],
  ['OQ-F5', 'docs/plans/FOLD-05-plan-config-and-designer.md'],
  ['OQ-F6', 'docs/decisions/ADR-067.md'],
  ['OQ-SE', 'docs/plans/P1-SE-trading-calendar.md'],
  ['OQ-P2', 'docs/plans/P2-rules-engine.md'],
  ['OQ-FREEZE', 'docs/STATE.md'],
]);

// THE PENDING REGISTER (ADR-074 section 5, as narrowed by section 8 resolution
// 4). 36 series are neither in scope nor exempt, and calling them exempt would
// be the dishonest move that section exists to avoid. They are PENDING: a real
// defect, named, with the artifact it waits for.
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
// THIS HOLDS 36 AND SO DOES THE AMENDED RULING. The first class is the ten it
// names and not the eighteen it counted: the other eight were identified nowhere
// in the ruling or in the survey, twelve candidates in the tree could be argued
// into the description, and picking eight of twelve to reach a total is the move
// section 5 refuses by name. `OQ-F6` and `P-M6` were the 37th and 38th entries
// here for one commit and are now in the declared scope above.
const PENDING_SERIES = new Map([
  // A register with holes or doubles: the repair is to the register. The ten
  // ADR-074 section 5 names, which is now the whole of its first class.
  [
    'R',
    "a repair to M01's rule table: 13 members are doubled because a coverage table shares a section with the definition table",
  ],
  ['ST', "a repair to M12's table: 7 members doubled, the same coverage-beside-definition shape"],
  ['RE-U', 'a table in the document that owns it; members have no row'],
  ['L', 'a table in the fixtures README; members have no row'],
  ['RI', 'a table in the tooling README; members have no row'],
  ['HO', 'a table in the document that owns it; members have no row'],
  ['M6-N', 'a table in M06; members have no row'],
  ['INV-M6', 'a table in M06 covering every member; some have no row'],
  ['PW', 'a table in the document that owns it; members have no row'],
  [
    'OI',
    "an OI allocation table in ALLOCATION.md, superseding DELTA_MANIFEST section 16 (ADR-074 section 7). NOT this session's to move, and the gate does not wait on it: the day that table lands this entry stops naming a defect and the gate fails until OI is promoted in the same commit",
  ],
  // No register at all, small. Each needs a table in the document that owns it,
  // or an argued move into ADR-074 section 4's class X3.
  ['RE-C', 'a table in the document that owns it, or an argued move into X3'],
  ['RE-R', 'a table in the document that owns it, or an argued move into X3'],
  ['SF-M21', 'a table in M21, or an argued move into X3'],
  ['DT', 'a table in the document that owns it, or an argued move into X3'],
  ['PG-M9', 'a table in M09, or an argued move into X3'],
  [
    'OQ-P',
    'a register that is a corpus document: its rows are in docs/reviews, which ADR-074 section 1 rules can never be a register because a review record binds nothing by existing',
  ],
  // `OQ-M*`, no register at all. Twenty series, and the ruling this waits on is
  // expressly NOT ADR-074's to make, because it is a question about how rulings
  // are recorded rather than about identifiers.
  [
    'OQ-M2',
    "a ruling naming which end of an open question's lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it",
  ],
  [
    'OQ-M3',
    "a ruling naming which end of an open question's lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it",
  ],
  [
    'OQ-M4',
    "a ruling naming which end of an open question's lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it",
  ],
  [
    'OQ-M5',
    "a ruling naming which end of an open question's lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it",
  ],
  [
    'OQ-M6',
    "a ruling naming which end of an open question's lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it",
  ],
  [
    'OQ-M7',
    "a ruling naming which end of an open question's lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it",
  ],
  [
    'OQ-M8',
    "a ruling naming which end of an open question's lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it",
  ],
  [
    'OQ-M9',
    "a ruling naming which end of an open question's lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it",
  ],
  [
    'OQ-M10',
    "a ruling naming which end of an open question's lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it",
  ],
  [
    'OQ-M11',
    "a ruling naming which end of an open question's lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it",
  ],
  [
    'OQ-M12',
    "a ruling naming which end of an open question's lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it",
  ],
  [
    'OQ-M13',
    "a ruling naming which end of an open question's lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it",
  ],
  [
    'OQ-M14',
    "a ruling naming which end of an open question's lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it",
  ],
  [
    'OQ-M15',
    "a ruling naming which end of an open question's lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it",
  ],
  [
    'OQ-M16',
    "a ruling naming which end of an open question's lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it",
  ],
  [
    'OQ-M17',
    "a ruling naming which end of an open question's lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it",
  ],
  [
    'OQ-M18',
    "a ruling naming which end of an open question's lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it",
  ],
  [
    'OQ-M19',
    "a ruling naming which end of an open question's lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it",
  ],
  [
    'OQ-M20',
    "a ruling naming which end of an open question's lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it",
  ],
  [
    'OQ-M21',
    "a ruling naming which end of an open question's lifecycle owns it: the module plan that raises it, or the gate-closure document that disposes of it",
  ],
]);

// THE WITHHELD TABLE (ADR-074 section 5.1). A gap in a series has two possible
// causes and the ruling as first written had vocabulary for only one of them.
//
//   "A WITHHELD MEMBER is an identifier of an in-scope series that a recorded
//    decision declined to mint. It is excluded from its series' membership and
//    its series stays IN SCOPE."
//
// IT IS DECLARED, NEVER INFERRED, and that is the whole difference between this
// and a hole. So it is a third closed list beside the two above, in the same
// idiom section 2 requires of both: one argued entry each, naming the
// identifier, the record of the decision, and what would end it.
//
// IT FAILS IN BOTH DIRECTIONS, which is what stops it being the cheap way to
// silence a finding. An entry whose identifier has ACQUIRED a definition site is
// a finding: the decision not to mint it has been reversed and this table has
// not been told. An entry whose identifier NO LONGER APPEARS ANYWHERE is a
// finding too: the reason to withhold it has gone with it. Both are watched
// failing in falsify.mjs, one case each, because an assertion nobody has seen
// fire is a comment.
//
// A DEFINITION SITE HERE MEANS WHAT SECTION 1 SAYS IT MEANS: a row or a heading
// inside the series' DECLARED REGISTER. An occurrence anywhere else is a
// citation and is unconstrained, and reading the first direction any wider would
// make the cited-in-a-session-log shape a finding, which is the opposite of what
// section 5.1 exists to record.
const WITHHELD_MEMBERS = new Map([
  [
    'P-M6-11',
    "session 112 declined to mint it, in terms: \"a `P-M6-nn` written in application code is a claim on a series with no allocation table, made from a fence that cannot add the row to the document that owns it, which is ADR-034's condition exactly\". The code cites AS-M6-04, an identifier that already exists, and the session's roster carries the eleventh number with the reason beside it. It ends when whoever holds M06 next decides whether the panel table gains a row or the third number is declared to live inside P-M6-01's block, which is a question about M06's read surface and is not ADR-074's to take",
  ],
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
    return entries
      .sort()
      .map((f) => read(join(file, f)))
      .join('\n');
  }
  const body = read(file);
  if (!section) return body;
  const lines = body.split('\n');
  const start = lines.findIndex(
    (l) => /^##\s/.test(l) && l.replace(/^##\s+/, '').trim() === section,
  );
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
//
// A TABLE ROW IS A ROW WHEREVER IT SITS ON THE LINE (ADR-074 section 1, and
// section 8's fourth edit). ADR-067's open-question table is indented two spaces
// inside a list item, which is this corpus's ordinary shape for a decision
// block's own tables, and a parse anchored to column zero reads its three rows
// as prose. The widening was MEASURED before it was ruled and again here: it
// adds no site anywhere in the declared scope except the three it was written
// for, so it cannot create a double it does not also fix.
//
// THE HEADING TEST IS LEFT ANCHORED, deliberately. Section 1 strips whitespace
// "before the row test" and says nothing about headings, an indented `#` stops
// being a heading at the fourth space, and a widening the ruling did not ask for
// is a widening nobody argued.
function definitionSites(body, id) {
  let sites = 0;
  for (const raw of body.split('\n')) {
    if (/^#{1,6}\s/.test(raw)) {
      if (leadsWith(raw.replace(/^#{1,6}\s+/, ''), id)) sites++;
      continue;
    }
    const line = raw.replace(/^\s+/, '');
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1);
    if (cells.length > 0 && leadsWith(cells[0], id)) sites++;
  }
  return sites;
}

// Every corpus document, concatenated once, for the pending register's
// predicate. Registry ENTRIES are excluded through the runner's own
// `isCorpusDocument`, and its row test stays ANCHORED TO COLUMN ZERO.
//
// THAT IS THE JUDGEMENT CALL ADR-074 SECTION 8 LEFT OPEN, AND THIS IS THE
// SESSION IT WAS LEFT TO. The declared scope now admits an ADR-043 entry as a
// register and reads an indented row; this predicate admits neither, so a
// pending series repaired inside an ADR entry, or in an indented table, would
// not be detected. It is left as it stands and the reason is a measurement
// rather than a preference: with both widenings applied here, NO PENDING ENTRY
// CHANGES STATE, at the commit ADR-074 was amended and again at this one. The
// asymmetry costs nothing today, and widening a predicate whose findings nobody
// has seen fire would be the second copy of a rule with none of the evidence.
// The day a repair does land inside an ADR entry, this is the line to move, and
// this comment is here so that session does not have to rediscover it.
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
    "A BOLD LEAD IS NOT A DEFINITION SITE: a bold span opening a line is this corpus's " +
    'ordinary emphasis idiom and admitting it makes the rule match prose. SECTION ' +
    "GRANULARITY IS LOAD BEARING, not a convenience: M01 section 1 holds INV's definition " +
    'rows and Appendix A holds a COVERAGE row for the same identifiers, so a file-wide ' +
    'register reports INV, CV and RB as broken. ' +
    'AN INDENTED TABLE ROW IS A ROW: ADR-067 writes its open-question table two spaces in, ' +
    "inside a list item, which is this corpus's ordinary shape for a decision block's own " +
    'tables, so leading whitespace is stripped before the row test and before that test only. ' +
    'THE PENDING REGISTER IS THE SECOND TABLE (ADR-074 section 5): series that are neither ' +
    'in scope nor exempt are named as real defects with the artifact each waits for, and an ' +
    'entry that no longer names a defect is itself a finding, so it shrinks as repairs land ' +
    'and cannot become furniture. THE WITHHELD TABLE IS THE THIRD (ADR-074 section 5.1): an ' +
    'identifier of an in-scope series that a RECORDED DECISION declined to mint is excluded ' +
    'from its series membership while the series stays in scope, and the entry fails in BOTH ' +
    'directions, when the identifier acquires a definition site and when it stops appearing ' +
    'at all. UNDECLARED SERIES ARE CLAIMED AS NOTHING AND COUNTED ON ' +
    'EVERY RUN, which is the honest measure of what this gate does not cover. ' +
    'THE FOUR DISAGREEMENTS SESSION 115 REPORTED ARE RESOLVED BY THE AMENDMENT OF 2026-08-21 ' +
    'AND NOT BY RE-SCOPING: section 3.1 retraces 118 and 1,086 to 117 and 1,083 inside a ' +
    'partition of all 215 series that closes in both columns; OQ-F6 is in scope on a register ' +
    'class that now admits the ADR entry raising it; P-M6 is in scope with P-M6-11 withheld; ' +
    'and the first pending class is narrowed to the ten series it names. ' +
    'THREE THINGS IT DOES NOT DO. The member census has a TWO-DIGIT FLOOR, so a ' +
    'single-digit member is invisible to it exactly as it was to the census ADR-074 is ' +
    'ruled on. It says nothing about the CONTENT of a definition, only that exactly one ' +
    'exists. And it inherits the one-ref gap: two branches each defining one identifier is ' +
    'caught at the merge and never at the pull request.',
  run() {
    const findings = [];
    const members = seriesMembers();

    // Rule 2 on the two tables it is about. An empty scope reports every series
    // clean, which is the failure mode ADR-074 section 2 is written against, and
    // an empty pending register asserts nothing about the 36 defects it holds.
    //
    // THE WITHHELD TABLE IS DELIBERATELY NOT GUARDED THE SAME WAY, and the
    // asymmetry is the point. An empty withheld table is the STRICT end of the
    // rule and not the vacuous one: with no entry, every member of every scoped
    // series must have a definition site. Section 5.1 declares one entry today
    // and says in terms what ends it, so the day M06 takes that disposition the
    // correct edit is to REMOVE THE LAST ROW, and a runner that threw on an
    // empty table would make the repair session edit this line to land it. That
    // is the furniture the register was designed against, pointing the other way.
    if (DECLARED_SERIES.size === 0)
      throw new Error('DECLARED_SERIES is empty; the gate asserts nothing');
    if (PENDING_SERIES.size === 0)
      throw new Error('PENDING_SERIES is empty; the register asserts nothing');

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
      // The CENSUS first and the MEMBERSHIP second, because they answer
      // different questions and only one of them is what section 5.1 narrows. A
      // series whose only members are withheld has not been renamed away, so the
      // scope-entry-names-nothing finding is asked of the census as it stands.
      const census = [...(members.get(series) ?? [])].sort();
      if (census.length === 0) {
        findings.push(
          `scripts/corpus/gates.mjs: ${series} is declared in scope and the census finds no ` +
            'member of it anywhere. The series has been renamed or removed, and a scope entry ' +
            'naming nothing is a finding (ADR-074 section 2)',
        );
        continue;
      }
      const ids = census.filter((id) => !WITHHELD_MEMBERS.has(id));
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

    // -- the withheld table, which fails in BOTH directions ------------------
    // ADR-074 section 5.1. Neither direction is inferred from the tree: the
    // entry is the claim, and both findings say the TABLE is wrong rather than
    // the corpus, because a decision recorded in a session log cannot be
    // repaired and only this list can be.
    for (const id of [...WITHHELD_MEMBERS.keys()].sort()) {
      const series = id.replace(/-\d{2,3}$/, '');
      const register = DECLARED_SERIES.get(series);
      if (register === undefined) {
        findings.push(
          `scripts/corpus/gates.mjs: WITHHELD_MEMBERS holds ${id} and ${series} is not in ` +
            'DECLARED_SERIES. A withheld member is an identifier OF AN IN-SCOPE SERIES ' +
            '(ADR-074 section 5.1); withholding a member of a series nothing asserts over ' +
            'excludes it from a census it was never in',
        );
        continue;
      }
      if (!(members.get(series) ?? new Set()).has(id)) {
        findings.push(
          `scripts/corpus/gates.mjs: WITHHELD_MEMBERS holds ${id} and the census no longer ` +
            'finds it anywhere. The reason to withhold it has gone with it, so the entry ' +
            `names nothing. Remove it (${WITHHELD_MEMBERS.get(id)})`,
        );
        continue;
      }
      const body = registerBody(register);
      if (body === null) continue; // already a finding above, against the series
      const sites = definitionSites(body, id);
      if (sites === 0) continue;
      findings.push(
        `${register}: ${id} is in WITHHELD_MEMBERS and has ${sites} definition site(s) in the ` +
          'declared register of ' +
          `${series}. The decision not to mint it has been REVERSED and the withheld table has ` +
          'not been told: either the entry goes, in the commit that minted the identifier, or ' +
          `the definition site does (${WITHHELD_MEMBERS.get(id)})`,
      );
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

    // THE NOTE CITES THE AMENDED SECTIONS, and this is ADR-074 section 8's sixth
    // edit: the figures it quoted before are the PRE-AMENDMENT ones, and a note
    // that keeps quoting 118, 1,086 and 44 reproduces on every run the error the
    // amendment was signed to end.
    //
    // WHETHER THE TRANSCRIPTION STILL AGREES IS COMPUTED AND NOT ASSERTED. The
    // ruled figures are ON ARRIVAL, which is the tense section 3 uses, and the
    // pending register SHRINKS AS REPAIRS LAND by section 5's own design: a
    // promotion moves two of the three in opposite directions and is the gate
    // working, not a defect. So a mismatch is PRINTED and is not a finding, and
    // the sentence saying so is derived from the tables rather than written into
    // a comment that can go quietly stale.
    const reproduces =
      DECLARED_SERIES.size === 117 && scoped === 1083 && PENDING_SERIES.size === 36;
    console.log(
      `       CI-06/identifier-series note: ${DECLARED_SERIES.size} declared series over ` +
        `${scoped} member(s), with ${WITHHELD_MEMBERS.size} withheld member(s) excluded from ` +
        `that count (ADR-074 section 5.1); ${PENDING_SERIES.size} pending over ` +
        `${pendingMembers} member(s), each one a repair this gate is waiting for; ` +
        `${undeclared} series over ${undeclaredMembers} member(s) claimed as nothing. ` +
        'ADR-074 AS AMENDED ON 2026-08-21 states 117 declared series over 1,083 members ' +
        '(section 3, retraced figure by figure in section 3.1) and 36 pending (section 5, ' +
        `narrowed to the ten it names by section 8 resolution 4) ON ARRIVAL, and this run ` +
        `${reproduces ? 'reproduces all three' : 'DOES NOT reproduce all three'}. ` +
        "The pending MEMBER figure is a different kind of number: the ruling's 281 is the " +
        "survey's count under docs/ at e23578a and reproduces there exactly, while this gate " +
        'counts the whole repository as section 1 requires and every document minted since ' +
        "moves it, which is section 3's own rule that a count of identifiers is a fact about a " +
        'moment rather than a transcription target',
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
// CI-07's ARTIFACT MOVED ON 2026-08-24 AND THIS IS THE PROBE THAT MOVED WITH IT.
// It read `apps/*/package.json` for a `build` script and required it ABSENT. That
// artifact ARRIVED when ADR-095 admitted Next.js, which is the assertion that
// fails on good news doing exactly its job, and ADR-095 section 6 re-ruled the row
// rather than relaxing the gate: the script now exists and has nothing to build,
// because `next build` exits 1 on "Couldn't find any `pages` or `app` directory".
//
// THE NEW ARTIFACT IS A PATH, WHICH IS WHAT ADR-073 SECTION 2 (b) ASKS FOR and
// what four of the six conditions still do not give. A router file is the input
// CI-07's own Contents cell needs: VG-2 greps a built bundle, and there is no
// bundle until there is something to render.
//
// THE NAMES ARE THE FRAMEWORK'S AND ARE MATCHED ON THE STEM, never the extension.
// `page`, `layout` and `route` are App Router's own reserved file names; the
// extension is `.tsx` today, `.ts` for a route handler, and neither is worth
// hard-coding when the stem is the thing the framework reserves.
// -----------------------------------------------------------------------------
// `appRouterFiles` IS RETIRED, ON THE SAME RULE AS `playwrightInLockfile` BELOW
// -----------------------------------------------------------------------------
// It probed CI-07's activation condition, "a page, layout or route file under
// apps/*/src/app/". THE ARTIFACT ARRIVED on 2026-08-27: session 250 wrote
// `apps/portal/src/app/layout.tsx` and `page.tsx`, the first renderable document
// this repository has ever had, and `next build` went from exiting 1 on
// "Couldn't find any `pages` or `app` directory" to prerendering a route.
//
// CI-07's stage was WRITTEN in the same series rather than its row relaxed, so
// the row now reads **Implemented.** and no condition in STRATEGY section 4.1
// names that artifact any more. This gate said so itself, in the finding that
// forced the deletion: "the row was written, the artifact was re-ruled, or the
// wording moved; either way the probe asserts nothing. Remove it or repoint it."
//
// `APP_ROUTER_STEMS` went with it. It had one caller and a set nothing reads is
// the same furniture as a probe nothing runs.

// -----------------------------------------------------------------------------
// `playwrightInLockfile` IS RETIRED, AND THE REGISTER'S OWN RULE IS WHY
// -----------------------------------------------------------------------------
// It probed CI-08's activation condition, "@playwright/test present in the
// lockfile". THE ARTIFACT ARRIVED (ADR-116) and CI-08's row is now implemented,
// so no condition in STRATEGY section 4.1 names that artifact any more. The
// stale-direction loop at the bottom of this gate then reports the probe as a
// finding in its own words: "a register entry that no longer names a real
// condition is a finding, which is what keeps this register from becoming
// furniture". Removing it is that rule applied to this file rather than an
// exception taken from it.
//
// WHAT WENT WITH IT, RECORDED SO IT IS NOT RE-DERIVED WRONG. The needle read a
// lockfile v9 ENTRY KEY, `name@version:` at exactly two spaces, and not an
// occurrence of the name. It was repaired to that shape by ADR-095 section 8
// after `next@16.3.2` was admitted: that version declares `@playwright/test` as
// an OPTIONAL PEER, pnpm writes a package's peer block into the lockfile
// verbatim at six spaces, and the previous needle read the declaration as an
// install and failed this gate at 29 of 30 on an artifact that was genuinely
// absent. THE REPAIR WAS PROVED BY THE ARRIVAL IT WAS REPAIRED FOR: on the
// install ADR-116 admits, the probe fired naming `'@playwright/test@1.56.1':`
// and not the peer line, which is the first and last time it fired for real.
// falsify.mjs's two cases aimed at it retire in the same commit and say so.
//
// A FUTURE ROW THAT NEEDS THIS SHAPE STARTS FROM THE PARAGRAPH ABOVE rather
// than from a grep, and the distinction it encodes is the general one: the
// artifact is the dependency, never a mention of it.

const INVENTORY_PROBES = new Map([]);

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
  // 'the VG-12 admission' IS RETIRED, AND THE REGISTER'S OWN RULE IS WHY.
  // It registered CI-09's Stryker leg, which is BUILT as of 2026-08-27
  // (ADR-127), so no condition in STRATEGY section 4.1 names it any more and
  // the stale-direction loop below reported it as a finding on the commit that
  // moved the row: "a register entry that no longer names a real condition is a
  // finding, which is what keeps this register from becoming furniture".
  //
  // WHAT ITS ENTRY SAID, KEPT BECAUSE THE SENTENCE IS THE REASON THE LEG WAITED
  // SEVEN DAYS: the admission is .github/CODEOWNERS plus a branch-protection
  // setting, and session 23 records why no job can see it, "a job can see the
  // dependency surface changed and cannot see that a human agreed".
  //
  // THIS ONE RETIRED DIFFERENTLY FROM ADR-116's `playwrightInLockfile`, and the
  // difference is worth a line. That probe retired because its artifact ARRIVED
  // and a probe reported it. This entry retires because its artifact arrived and
  // NOTHING COULD REPORT IT: an unprobeable condition closes silently by
  // construction, so the register shrinking is the only observable event there
  // ever was. ADR-127 section 7.
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
    "partial-implementation rule; session 114 built one of CI-09's four legs and a gate " +
    "reading the row's first word would read one leg as four. " +
    'AN IMPLEMENTED LEG names a workflow under .github/workflows/ and the job or jobs that ' +
    'run it, and every one of them must be a top-level job key in that file. ' +
    'A WAITING LEG carries a date in its opener and exactly one `Artifact: **...**` clause, ' +
    'and its artifact must be registered here as probeable or as unprobeable. ' +
    'A DISCHARGED LEG links a register that resolves; ADR-073 gives CI-10 alone this ' +
    'disposition and a second row taking it is reported rather than accepted. ' +
    'IT ASSERTS BOTH READINGS OF (b), SPLIT PER ARTIFACT: every condition must be present, ' +
    'dated and name one artifact, and each artifact that is a fact about THIS TREE is ' +
    'additionally probed and must resolve to ABSENT, so the gate FAILS ON GOOD NEWS the day ' +
    "a build script or an installed Playwright lands. CI-04's Neon branch is not a fact " +
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
          const named = [
            ...leg.text.matchAll(/\bjobs?\s+((?:`[A-Za-z0-9_-]+`(?:\s+and\s+)?)+)/g),
          ].flatMap((m) => [...m[1].matchAll(/`([A-Za-z0-9_-]+)`/g)].map((j) => j[1]));
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
    // 2026-08-27: THE EMPTY PROBE MAP HAS TWO CAUSES AND ONLY ONE IS A DEFECT.
    // The rule above was written when at least one condition was probeable, and
    // it read emptiness as neglect. Implementing CI-07 removed the last probe --
    // the app-router artifact ARRIVED, and this gate's own finding said of the
    // stale entry "the row was written, the artifact was re-ruled, or the wording
    // moved; either way the probe asserts nothing. Remove it or repoint it."
    //
    // What remains is three conditions that are each genuinely unreadable from
    // the tree and each REGISTERED with its reason: a Neon branch is estate and
    // not tree, the VG-12 admission is a human agreement no job can see, and
    // M07's detector code names a module plan rather than a path. An empty map
    // over exactly those is the world reported faithfully, not a register nobody
    // maintains.
    //
    // SO THE ASSERTION NARROWS TO WHAT IT ALWAYS MEANT, and it narrows by DELETING
    // a rule rather than by adding one, which is worth reading twice before anyone
    // restores it. The emptiness throw was a proxy for "some artifact is now read
    // by nothing", and THE PER-CONDITION LOOP ABOVE ALREADY ASSERTS EXACTLY THAT,
    // one artifact at a time, naming the artifact: every condition must be probed
    // or registered, and one that is neither is a finding there. So on every tree
    // where a throw here would have fired, that loop has already pushed a better
    // message -- and the throw's only remaining effect was to REPLACE it, which is
    // how `CI-06/gate-inventory/register-shrinks-when-an-artifact-is-re-ruled`
    // caught this: the scope case seeds a re-ruled artifact, expects the finding
    // that names it, and got the emptiness error instead.
    //
    // A CHECK THAT MASKS A MORE PRECISE CHECK IS NOT A SECOND OPINION. What is
    // left is the note below, which reports the honest state out loud so an empty
    // registry can never pass in silence.
    if (INVENTORY_PROBES.size === 0) {
      console.log(
        `       CI-06/gate-inventory note: INVENTORY_PROBES is empty and every one of the ` +
          `${seenArtifacts.size} waiting artifact(s) is registered unprobeable with a reason. ` +
          'The next condition naming a readable artifact fails here until a probe is written for it',
      );
    }
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
// -----------------------------------------------------------------------------
// CI-06/vg-inventory  Every VG row of STRATEGY section 4.2 is closed
// -----------------------------------------------------------------------------
// ADR-080 EXTENDS ADR-073's CLOSURE RULE TO THE TWELVE, and this gate is
// `CI-06/gate-inventory`'s sibling: same shape, one table down, five
// dispositions instead of three.
//
// UNLETTERED, AND THAT IS FORCED RATHER THAN STYLISTIC. `falsify.mjs`'s
// `nextFreeLetter()` scans `a` to `x` and throws `seed anchor exhausted` at the
// end, and its comment says why: "every seed below needs two letters of
// headroom above the one it names". The letters are claimed through `w`, so a
// lettered gate here would consume the anchor and take `pnpm run falsify` down
// with it. `ADR-082:124`'s "`x` stays unclaimed" records that ADR-082 took no
// letter; it does not release one. `CI-06/gate-inventory` already ships in this
// shape, so an unlettered sibling is the precedent as well as the necessity.
//
// THE ASSERTION THIS GATE EXISTS FOR IS CHAIN EXPIRY, and it is the one that
// cannot be read off the row. ADR-080 (d)'s second clause makes a chained leg
// available ONLY while the row it names is unimplemented, so a chained leg is a
// claim about ANOTHER TABLE that goes stale silently. Section 4.2 would report
// twelve well-formed rows in exactly the same way whether the rule discriminates
// or has stopped reading, which is the `VG-5` shape one table up.
const VG_INVENTORY = '### 4.2 The `VG` gates';

// The artifacts a section 4.2 condition can name that ARE facts about this tree,
// and the probe for each. WRITTEN AND NEVER COMPUTED, `CI-06/gate-inventory`'s
// property: a new condition fails until somebody decides in this file whether
// its artifact can be read.
//
// THE KEY MATCH IS ANCHORED AND NEVER A SUBSTRING. `fastify-plugin` contains
// `fastify`, so a substring probe reports the artifact ARRIVED on a package that
// is not it, and passes in exactly the same way as one that works. That is
// `gates.mjs`'s `@vitest/browser-playwright` lesson, and it is why the pattern
// requires `@` or `:` immediately after the name.
const VG_PROBES = {
  // THIS ENTRY REPLACED "`scopedDb` named under `apps/api/src`", WHICH ARRIVED,
  // WHICH IN TURN HAD REPLACED "fastify present in the lockfile", WHICH ARRIVED.
  // Twice now this gate has gone red on good news and twice the answer has been
  // to re-rule the row and shrink the register rather than to relax the gate.
  // ADR-100 was the first and ADR-120 is the second, and the shape is identical
  // both times: the register SHRINKS in the stale direction, so the arrived probe
  // is REMOVED rather than left beside a row that no longer waits on it.
  //
  // WHAT ARRIVED. ADR-120 wires `AuthBackend` and `IdempotencyStore` against the
  // accessor and admits `apps/api` to `DB_ADMITTED`, so `apps/api/src/db.ts`
  // names `scopedDb` and API_CONTRACT section 1's sentence -- "Every
  // authenticated handler resolves the caller to an identity and reads through
  // `scopedDb(identity)`" -- is a thing this deployable does rather than a thing
  // it could do. `POST /auth/logout`, `GET /sessions` and
  // `POST /sessions/:id/revoke` answer real codes through a real predicate.
  //
  // WHY THE NEW ARTIFACT IS A DATABASE IN CI AND NOT SOMETHING NEARER. `VG-3` is
  // server-side authz and `VG-6` is entitlement TESTED THROUGH THE API, and
  // `VG-6`'s implementation column is "integration suite calling endpoints with
  // no UI in the path". That suite is now writable and it is not RUNNABLE: every
  // entitlement it would assert is a row in a database, `ci.yml`'s `integration`
  // job runs on bare `ubuntu-latest` with no `services:` block, and a committed
  // suite that needs Postgres reports nothing there. THREE ENTRIES HAVE NOW NAMED
  // THIS AS OWED -- ADR-102 section 16, ADR-112 section 9 ("`CI-04` exists, its
  // project exists, and what it has never had is a database") and ADR-120 -- so
  // it is the honest next condition rather than an invented one.
  //
  // IT READS THE JOB AND NOT THE FILE, because `services:` appears nowhere in
  // that workflow today and a bare substring probe over the whole file would
  // report ARRIVED the first time any other job acquired one. The `integration`
  // job is the one `VG-6` names.
  "a `services:` block on `ci.yml`'s `integration` job": () => {
    const body = read(`${WORKFLOW_DIR}/ci.yml`);
    const start = body.indexOf('\n  integration:\n');
    if (start === -1) return false;
    const after = body.slice(start + 1);
    // The job ends at the next top-level job key, which is the next line
    // indented by exactly two spaces and ending in a colon.
    const end = after.slice(1).search(/\n {2}[a-z0-9-]+:\n/);
    const job = end === -1 ? after : after.slice(0, end + 1);
    return /\n {4}services:/.test(job);
  },
};

// Artifacts no repository file can report. Each carries ADR-080's own reason.
const VG_UNPROBEABLE = {
  'a bucket declared in any infrastructure manifest':
    'ADR-080 section 4: no file in this repository changes when a bucket is created, so the ' +
    'condition is asserted and the artifact is not',
  'an endpoint in [API_CONTRACT](../architecture/API_CONTRACT.md) whose request body is not `application/json`':
    'ADR-080 section 4: the media type is a property of a route that does not exist, and a grep ' +
    'for one would report on a string in a specification rather than on a served endpoint',
};

const vgInventory = {
  id: 'CI-06/vg-inventory',
  title: 'Every VG row is wired, chained to an unimplemented stage, or waiting on a dated artifact',
  covers:
    'ADR-080 APPLIED TO EVERY ROW OF STRATEGY section 4.2, as CI-06/gate-inventory does for 4.1. ' +
    'A row is closed when it carries at least one leg and every leg is well formed. ' +
    'WIRED names a workflow that resolves, every job it names is a top-level key in that ' +
    'workflow, and the step or rule it names resolves as a `name:` in that workflow or as a ' +
    'link on disk: ADR-080 section 3 makes this strictly stronger than 4.1 (a). ' +
    'CHAINED names exactly one 4.1 row, carries no Artifact clause, and THAT ROW MUST CARRY NO ' +
    'IMPLEMENTED LEG, which is ADR-080 (d) second clause and the assertion this gate exists ' +
    'for: a chained leg is a claim about another table and goes stale silently. ' +
    'WAITING is dated, names exactly one `Artifact: **...**`, and that artifact is registered ' +
    'here as probeable or unprobeable; a probed artifact must resolve to ABSENT, so the gate ' +
    'FAILS ON GOOD NEWS. DISCHARGED links a register that resolves. FINDING is an explicit ' +
    'disposition and a row carrying no leg at all is one. ' +
    'BOTH REGISTERS SHRINK IN THE STALE DIRECTION: an entry naming no live condition is a ' +
    'finding, so re-ruling an artifact into a path removes its entry rather than leaving it. ' +
    'THE KEY PROBE IS ANCHORED: `fastify-plugin` must not report `fastify` as arrived.',
  run() {
    const findings = [];
    const body = read(STRATEGY_DOC);
    const start = body.indexOf(VG_INVENTORY);
    if (start === -1) throw new Error(`${STRATEGY_DOC}: section not found: "${VG_INVENTORY}"`);
    const firstLine = body.slice(0, start).split('\n').length;
    const after = body.slice(start + VG_INVENTORY.length);
    const end = after.search(/\n### /);
    const lines = (end === -1 ? after : after.slice(0, end)).split('\n');

    const rows = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('|')) continue;
      const cells = rowCells(lines[i]);
      const m = /^\s*\*{0,2}`?(VG-\d{1,2})\b/.exec(cells[0] ?? '');
      if (!m) continue;
      rows.push({ id: m[1], line: firstLine + i, cells, closure: (cells[4] ?? '').trim() });
    }
    // Rule 2, as the sibling states it: a section parsing to no row is a runner
    // that has lost its input and would report an inventory of nothing as one in
    // order.
    if (rows.length === 0) {
      throw new Error(
        `CI-06/vg-inventory read no VG-nn row out of ${STRATEGY_DOC} "${VG_INVENTORY}". ` +
          'Zero means the table or the first-cell form has moved, and every assertion below ' +
          'would then hold vacuously',
      );
    }
    // Rule 2 for the registers themselves. An empty register makes every
    // registration assertion vacuous in the direction that passes.
    if (Object.keys(VG_PROBES).length === 0) throw new Error('VG_PROBES is empty');
    if (Object.keys(VG_UNPROBEABLE).length === 0) throw new Error('VG_UNPROBEABLE is empty');

    // 4.1's rows, for the chain-expiry assertion. Reused rather than reparsed:
    // two expressions of one concept agree exactly until they do not (OQ-P1-04).
    const stages = new Map();
    for (const r of pipelineRows()) {
      stages.set(
        r.id,
        closureLegs(r.closure).some((l) => l.kind === 'implemented'),
      );
    }

    const liveArtifacts = new Set();
    let wired = 0;
    let chained = 0;
    let waitingLegs = 0;
    let discharged = 0;
    let findingRows = 0;

    for (const row of rows) {
      const cell = row.closure;
      const at = `${STRATEGY_DOC}:${row.line}`;
      let legs = 0;

      // --- FINDING, an explicit disposition -----------------------------------
      if (/\*\*FINDING\b/.test(cell)) {
        legs++;
        findingRows++;
      }

      // --- WIRED --------------------------------------------------------------
      if (/\*\*Wired\b/.test(cell)) {
        legs++;
        wired++;
        const wf = /`?([a-z0-9-]+\.yml)`?/.exec(cell);
        if (!wf) {
          findings.push(`${at}: ${row.id} is Wired and names no workflow file`);
        } else {
          const jobs = workflowJobs(wf[1]);
          if (jobs === null) {
            findings.push(`${at}: ${row.id} is Wired on ${wf[1]}, which does not exist`);
          } else {
            const named = [...cell.matchAll(/`([a-z0-9-]+)`\s+job/g)].map((m2) => m2[1]);
            for (const j of named) {
              if (!jobs.has(j)) {
                findings.push(
                  `${at}: ${row.id} names the \`${j}\` job of ${wf[1]}, which has no such ` +
                    'top-level job key',
                );
              }
            }
            // ADR-080 section 3's strictly-stronger half: the STEP or RULE must
            // resolve too, not just the job.
            //
            // THE FORMS ARE THE TABLE'S OWN AND WERE READ OFF IT RATHER THAN
            // ASSUMED. A first version of this matched `**`x`**` and matched
            // NOTHING, so the assertion was vacuous and reported a wired row as
            // checked. The rows write `steps `a` and `b``, `step `a``, and
            // `rule [`name`](path)`.
            const wfBody = read(`${WORKFLOW_DIR}/${wf[1]}`);
            let checked = 0;
            for (const m2 of cell.matchAll(/\bsteps?\s+((?:`[^`]+`(?:\s*(?:,|and)\s*)?)+)/g)) {
              for (const t of m2[1].matchAll(/`([^`]+)`/g)) {
                checked++;
                if (!wfBody.includes(t[1])) {
                  findings.push(
                    `${at}: ${row.id} names step \`${t[1]}\`, which is not a step of ${wf[1]}. ` +
                      'ADR-080 section 3 makes the step resolve, not just the job',
                  );
                }
              }
            }
            for (const m2 of cell.matchAll(/\brule\s+\[`([^`]+)`\]\(([^)\s]+)\)/g)) {
              checked++;
              const target = resolve(dirname(join(ROOT, STRATEGY_DOC)), m2[2]);
              if (!existsSync(target)) {
                findings.push(
                  `${at}: ${row.id} names rule \`${m2[1]}\`, whose file does not resolve`,
                );
              }
            }
            // Rule 2 on this leg: a Wired row naming neither a step nor a rule
            // is a row whose strictly-stronger half asserted nothing.
            if (checked === 0) {
              findings.push(
                `${at}: ${row.id} is Wired and names no step and no rule. ADR-080 section 3 ` +
                  'makes this leg strictly stronger than 4.1 (a), and a row naming only a job ' +
                  'is 4.1 (a) with extra words',
              );
            }
          }
        }
      }

      // --- CHAINED ------------------------------------------------------------
      for (const m of cell.matchAll(
        /\*\*Chained,\s*(\d{4}-\d{2}-\d{2})\*\*,\s*on\s*`(CI-\d{2})`/g,
      )) {
        legs++;
        chained++;
        const onStage = m[2];
        if (!stages.has(onStage)) {
          findings.push(`${at}: ${row.id} chains on ${onStage}, which is not a row of section 4.1`);
          continue;
        }
        // THE ASSERTION THIS GATE EXISTS FOR.
        if (stages.get(onStage) === true) {
          findings.push(
            `${at}: ${row.id} is "Chained on ${onStage}" and ${onStage} now carries an ` +
              'IMPLEMENTED leg in section 4.1. ADR-080 (d): a chain is available only while ' +
              'the row it names is not implemented, so this leg has expired and the row needs ' +
              'a disposition of its own',
          );
        }
      }
      if (/\*\*Chained,/.test(cell) && /Artifact:/.test(cell) && !/\bwaiting,/i.test(cell)) {
        findings.push(
          `${at}: ${row.id} carries a chained leg AND an Artifact clause with no waiting ` +
            'opener. A chain names its next link; an artifact belongs to a waiting leg',
        );
      }

      // --- WAITING ------------------------------------------------------------
      for (const m of cell.matchAll(/\bwaiting,\s*(\d{4}-\d{2}-\d{2})/gi)) {
        legs++;
        waitingLegs++;
        void m;
      }
      const artifacts = [...cell.matchAll(/Artifact:\s*\*\*(.+?)\*\*/g)].map((m2) => m2[1].trim());
      if (/\bwaiting,/i.test(cell)) {
        if (artifacts.length !== 1) {
          findings.push(
            `${at}: ${row.id} is waiting and names ${String(artifacts.length)} artifacts. ` +
              'ADR-073 wants exactly one',
          );
        }
        for (const a of artifacts) {
          liveArtifacts.add(a);
          const probe = VG_PROBES[a];
          const unprobeable = Object.prototype.hasOwnProperty.call(VG_UNPROBEABLE, a);
          if (!probe && !unprobeable) {
            findings.push(
              `${at}: ${row.id} waits on "${a}", which is registered in neither VG_PROBES nor ` +
                'VG_UNPROBEABLE. Decide in gates.mjs whether this artifact can be read',
            );
          } else if (probe && probe() === true) {
            findings.push(
              `${at}: ${row.id} waits on "${a}" and the artifact HAS ARRIVED. This is the ` +
                'assertion that fails on good news: re-rule the row rather than the gate',
            );
          }
        }
      }

      // --- DISCHARGED ---------------------------------------------------------
      if (/\*\*Discharged outside Actions\b/.test(cell)) {
        legs++;
        discharged++;
        const links = [...cell.matchAll(/\]\(([^)\s]+)\)/g)].map((m2) => m2[1]);
        const resolves = links.some((l) =>
          existsSync(
            join(ROOT, resolve(dirname(join(ROOT, STRATEGY_DOC)), l).replace(`${ROOT}/`, '')),
          ),
        );
        if (links.length === 0 || !resolves) {
          findings.push(
            `${at}: ${row.id} is Discharged outside Actions and links no register that resolves`,
          );
        }
      }

      if (legs === 0) {
        findings.push(
          `${at}: ${row.id} carries no leg at all. ADR-080: a row is closed when it carries at ` +
            'least one leg, and a row carrying none is a finding',
        );
      }
    }

    // BOTH REGISTERS SHRINK IN THE STALE DIRECTION, CI06U_REGISTER's property.
    for (const a of Object.keys(VG_PROBES)) {
      if (!liveArtifacts.has(a)) {
        findings.push(
          `gates.mjs: VG_PROBES holds "${a}" and no section 4.2 row waits on it. The register ` +
            'shrinks when an artifact is re-ruled; an entry naming no live condition is stale',
        );
      }
    }
    for (const a of Object.keys(VG_UNPROBEABLE)) {
      if (!liveArtifacts.has(a)) {
        findings.push(
          `gates.mjs: VG_UNPROBEABLE holds "${a}" and no section 4.2 row waits on it. Same rule`,
        );
      }
    }

    console.log(
      `       CI-06/vg-inventory note: ${rows.length} VG row(s); ${wired} wired, ${chained} ` +
        `chained, ${waitingLegs} waiting leg(s) over ${liveArtifacts.size} artifact(s), ` +
        `${discharged} discharged outside Actions, ${findingRows} explicit FINDING(s). ` +
        `${Object.keys(VG_PROBES).length} artifact(s) probed against this tree and ` +
        `${Object.keys(VG_UNPROBEABLE).length} registered unprobeable with a reason`,
    );

    return findings;
  },
};

// -----------------------------------------------------------------------------
// CI-06/retired-constraints  A retired constraint name appears only where the
// appearance retires it or records it
// -----------------------------------------------------------------------------
// THE CORPUS MANDATES ONE HALF OF A SUPERSESSION AND HAS NEVER MANDATED THE
// OTHER. Before a constraint is cited the rule is to grep the migration
// directory for a superseding definition, and session 135 ran exactly that grep
// and was right to. The second sweep has never been run by anybody: once a
// migration supersedes a constraint, the citations ALREADY MERGED against the
// old name go on saying what the database used to do, and no rule and no gate
// looks at them.
//
// SESSION 141 MEASURED IT ON `0015` ALONE. 102 citation sites, 99 resolving and
// 3 stale, all three in one test file, and ONE OF THE THREE WAS INVERTED rather
// than merely out of date: the replacement predicate EXEMPTS the locked row the
// comment said it refused, and that comment was the stated justification for
// what the test caps its profit at. Session 151 repaired those three. THIS GATE
// IS WHAT STOPS THE FOURTH.
//
// SEEDED FROM THE MIGRATION DIRECTORY AND NEVER FROM A HAND LIST, which is
// session 141's own design constraint: a hand-maintained list of retired names
// is the same defect one level up, stale on the day the next supersession lands.
// RETIRED IS MECHANICAL: a name some migration DROPs and no migration ADDs back.
// Sixteen `DROP CONSTRAINT` statements less nine same-name re-adds is seven
// today, over four migrations, and the set grows by itself.
//
// UNLETTERED, AND THAT IS FORCED RATHER THAN STYLISTIC, on the reasoning
// `CI-06/vg-inventory` states: `falsify.mjs`'s `nextFreeLetter()` scans `a` to
// `x` and its own comment says every seed needs two letters of headroom above
// the one it names, so a lettered gate here consumes the seed anchor and takes
// `pnpm run falsify` down with it. `CI-06/gate-inventory` and
// `CI-06/vg-inventory` already ship in this shape.
//
// BOTH DIRECTIONS, and the second is the one a gate of this shape forgets. A
// retired name outside a permitted class is a finding; AND a run that parses NO
// retired name at all THROWS, because a scanner holding an empty needle list
// reports a clean tree for the one reason that means it read nothing. That is
// `CI-06/vg-inventory`'s rule 2, asserted here on the migration parse, on the
// walk, on the reader, and on both registers.
//
// TWO THINGS IT DOES NOT DO, in writing so that nobody counts them as covered.
// THE NINE SAME-NAME RE-ADDS ARE NOT ASSERTED: `0032` and eight others dropped a
// constraint and re-added it under its own name with a changed predicate, so the
// NAME resolves for every citation while the PREDICATE moved underneath it. That
// is not name-greppable and session 141 named it as the weaker shape it does not
// close. And this gate asserts EXISTENCE, NEVER CONTENT: whether a citation of a
// LIVE constraint describes it correctly is outside it.
const RETIRED_MIGRATION_DIR = 'packages/db/migrations';

// A comment is not a statement. `0032` carries the words `ADD CONSTRAINT below`
// in a comment explaining what it deliberately does not prove, and a parser
// reading that as a re-add would UN-RETIRE a name and shrink the needle list in
// silence, which is the one direction of this parse that fails quietly.
const withoutSqlComments = (body) =>
  body.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');

// {names some migration DROPs} minus {names some migration ADDs}. Order does not
// enter it: a name dropped in `0029` and re-added in `0029` is live, and so is
// one re-added ten migrations later, because the question this gate asks is
// whether the name exists in the schema at all.
function retiredConstraints() {
  const dropped = new Map();
  const added = new Set();
  let statements = 0;
  for (const file of sqlFiles()) {
    const body = withoutSqlComments(read(file));
    for (const m of body.matchAll(/\bDROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?([a-z0-9_]+)/gi)) {
      statements++;
      const name = m[1].toLowerCase();
      if (!dropped.has(name)) dropped.set(name, basename(file));
    }
    for (const m of body.matchAll(/\bADD\s+CONSTRAINT\s+([a-z0-9_]+)/gi)) {
      added.add(m[1].toLowerCase());
    }
  }
  return { statements, retired: new Map([...dropped].filter(([n]) => !added.has(n))) };
}

// WHERE THE APPEARANCE RETIRES IT OR RECORDS IT. WRITTEN AND NEVER COMPUTED, per
// ADR-074 section 2 and for the reason session 141 gives: an exemption set
// derived from what currently passes passes forever. A new class fails until
// somebody decides in this file that it dates its own contents.
//
// THE TEST FOR THE DATED CLASSES is session 141's own: whether a reader who
// wants to know what the database does TODAY would land on the sentence. A
// `## 2026-08-22 - Session 129` heading dates its own contents and a code
// comment does not. Two documents that are dated in practice are NOT here and
// are registered instead, deliberately: ALLOCATION is amended in place under
// ADR-065 T3 and DELTA_MANIFEST is a live specification, so neither is
// append-only and a row in either does not date itself.
const RETIRED_PERMITTED = [
  {
    what: 'the migration directory',
    match: (f) => f.startsWith(`${RETIRED_MIGRATION_DIR}/`) && extname(f) === '.sql',
    why:
      'the migration that defined the constraint and the migration that dropped it. A merged ' +
      'migration is never edited and only superseded (constitution E2), so it is a dated ' +
      'record of a schema by construction',
  },
  {
    what: 'the absence probes',
    match: (f) => /^scripts\/db\/probe_[a-z0-9_]+\.sql$/.test(f),
    why:
      'a probe naming a retired constraint is asserting that it is GONE. Removing the name ' +
      'from the probe is removing the assertion',
  },
  {
    what: 'the session logs',
    match: (f) => f.startsWith('docs/sessions/'),
    why:
      'a session log is a record of a position on a date and rewriting it destroys the only ' +
      'thing it is for. Session 129 found a defect that is stale as a claim about today and ' +
      'correct as a record of what that session found, which is why session 132 refuted it in ' +
      'a new entry rather than editing the old one',
  },
  {
    what: 'the signed rulings',
    match: (f) => /^docs\/decisions\/ADR-[A-Za-z0-9-]+\.md$/.test(f),
    why:
      'an ADR is dated, signed and superseded rather than edited. ADR-052 still quotes the ' +
      'retired constraint verbatim four rulings later, and that is the ruling being legible ' +
      'rather than the corpus being wrong',
  },
  {
    what: 'STATE',
    match: (f) => f === 'docs/STATE.md',
    why:
      'STATE is append-only and every section carries its own date. It is the only live ' +
      'document exempted as a class, and it is exempted because appending is the normal act ' +
      'and a register pinning its count would fail on every session that reports one of these',
  },
];

// THE REGISTER. Every file outside the permitted classes that cites a retired
// constraint on `main` as of 2026-08-24, surveyed before the assertion was
// written. NOT ONE OF THESE IS ACCEPTED AS CORRECT: each is a site this
// session's fence did not reach, and the one still WRONG is named as such.
//
// IT CARRIES CI06U_REGISTER's DEFINING PROPERTY AND ONE MORE. It SHRINKS ONLY,
// so an entry naming no citation is reported and the day a file is repaired is
// the day its number moves. And it PINS THE COUNT, in both directions, which is
// the assertion the gate exists for: three stale citations were merged into one
// file before anybody counted, and a register that only said "this file is
// known" would have taken the fourth in silence.
//
// KEYED BY FILE AND COUNT, NEVER BY CONSTRAINT NAME, and that is load-bearing
// rather than tidy. Spelling a retired name here would make this file a citation
// site of it, so the register would have to register itself and every edit to it
// would move its own number. The needles come from the migration directory and
// nothing in this block names one.
const RETIRED_REGISTER = new Map([
  [
    '.github/workflows/corpus.yml',
    {
      sites: 3,
      why:
        "the migrations job's comments state what two superseded constraints asserted and why " +
        "each probe names the REPLACEMENT. `CI-06s`'s near-miss is here: one of these comments " +
        'sits three lines above the step it describes, which is why that gate matches the STEP ' +
        'and not the mention',
    },
  ],
  [
    'apps/worker/test/replay.test.ts',
    {
      sites: 3,
      why:
        'THE THREE SESSION 141 FOUND, repaired by session 151 and now tensed: each states the ' +
        'retirement, the migration that did it and the live name. Registered rather than ' +
        'exempted because this gate reads existence and not tense, and because this is the ' +
        'file the whole defect was found in',
    },
  ],
  [
    'docs/architecture/data-model/README.md',
    {
      sites: 1,
      why:
        'THE ONE STILL WRONG, and it is a live invariant-to-enforcement row rather than a ' +
        'record. Both halves of it were falsified on 2026-08-16 by the migration that retired ' +
        'the constraint it names, its sibling document one directory down already carries the ' +
        'repaired wording, and session 141 reported it inside its own fence and was told not ' +
        'to widen the repair. It is not in this fence either. TWO LINES, NO RULING',
    },
  ],
  [
    'docs/architecture/data-model/contact_channels.md',
    {
      sites: 1,
      why:
        'records that `0019` wrote the check inline so Postgres generated the name, and that ' +
        '`0029` re-added it under a chosen one so the next widening does not depend on a ' +
        'generated name staying generated',
    },
  ],
  [
    'docs/architecture/data-model/daily_marks.md',
    {
      sites: 2,
      why:
        'the Constraints line names the superseding constraint and says what it supersedes; ' +
        'the paragraph under it records what the row said until 2026-08-16 and why that was ' +
        'wrong. This is the shape session 141 says the stale sites should have had',
    },
  ],
  [
    'docs/architecture/data-model/identity_signals.md',
    {
      sites: 1,
      why: "the same shape as contact_channels: `0029`'s drop and re-add, stated in one sentence",
    },
  ],
  [
    'docs/architecture/data-model/kyc_verifications.md',
    {
      sites: 1,
      why: 'the same shape again: `0003` wrote the check inline and `0029` renamed it',
    },
  ],
  [
    'docs/architecture/data-model/phone_change_requests.md',
    {
      sites: 1,
      why:
        "cites `0029`'s lesson about a generated name as the reason this table's foreign keys " +
        'are named rather than generated',
    },
  ],
  [
    'docs/decisions/ALLOCATION.md',
    {
      sites: 5,
      why:
        'the ADR and migration rows that allocated the two supersessions and the ruling behind ' +
        'each. Dated in practice and NOT exempted as a class: ALLOCATION is amended in place ' +
        'under ADR-065 T3, so it is not append-only and a row in it does not date itself',
    },
  ],
  [
    'docs/edge-cases/EC-157.md',
    {
      sites: 2,
      why:
        'the entry whose Repair A produced the superseding migration. It names the constraint ' +
        'in order to rule on it, which is the permitted shape in a document that is not ' +
        'append-only',
    },
  ],
  [
    'docs/edge-cases/README.md',
    { sites: 1, why: 'the registry preamble summarising what EC-157 found' },
  ],
  [
    'docs/plans/P2-rules-engine-build.md',
    {
      sites: 5,
      why:
        'A DISPATCH DOCUMENT, and the class session 141 flagged as still owed. Its `P2-c` brief ' +
        'reads as pending work against a constraint that has since been retired, including a ' +
        'quoted DDL block, so a session dispatched from it for a later slice would read that ' +
        'section as owed. Not repairable from this fence',
    },
  ],
  [
    'docs/testing/STRATEGY.md',
    {
      sites: 1,
      why:
        "`CI-06s`'s row quotes the corpus.yml comment in order to explain why that gate matches " +
        'the STEP and not the mention. Section 4.4 is in this fence for its own row only',
    },
  ],
  [
    'packages/db/DELTA_MANIFEST.md',
    {
      sites: 7,
      why:
        'the two supersession sections, which name the retired constraint in order to retire it ' +
        'and quote verbatim the PostgreSQL error that names it. Dated in practice and NOT ' +
        'exempted as a class: the manifest is a live specification of the schema delta, and a ' +
        'reader asking what the database does today does land in it',
    },
  ],
  [
    'packages/rules-engine/fixtures/GS-056-locked-floor-converts-the-account-into-a-free-option.expected.json',
    {
      sites: 1,
      why:
        'an expectation `note` recording the constraint this fixture was nearly withdrawn ' +
        'against, on a blocker that had been lifted two days before it was written',
    },
  ],
  [
    'packages/rules-engine/fixtures/GS-065-settled-payout-drops-the-balance-toward-a-floor-that-does-not-move.expected.json',
    { sites: 1, why: 'the same batch and the same note' },
  ],
  [
    'packages/rules-engine/fixtures/README.md',
    { sites: 1, why: "that batch's own record of the blocker and why it did not hold" },
  ],
  [
    'packages/rules-engine/src/day/floor.ts',
    {
      sites: 1,
      why:
        'THE SITE THAT FOUND EVERYTHING. It cites the same constraint at the same line as the ' +
        'three stale ones and RESOLVES, because it is TENSED: it says the constraint rejected ' +
        'such a row when a named ADR was written. One code comment carried its own date and ' +
        'three did not, and that was the whole difference',
    },
  ],
  [
    'packages/rules-engine/test/generators/day-sequence.property.test.ts',
    {
      sites: 1,
      why: 'records what the retired constraint and the two mark invariants jointly implied for the generator',
    },
  ],
  [
    'packages/rules-engine/test/generators/validate-day-sequence.ts',
    { sites: 2, why: "the same session's validator, carrying the same reasoning twice" },
  ],
  [
    'scripts/corpus/gates.mjs',
    {
      sites: 2,
      why:
        "`CI-06s`'s comment and `covers` line, which name a retired constraint in order to state " +
        'the near-miss that gate is written against. THIS GATE ADDS NONE OF ITS OWN: it is ' +
        'seeded from the migration directory and spells no constraint name anywhere, which is ' +
        'why the register above is keyed by file and count rather than by name',
    },
  ],
]);

const retiredConstraintsGate = {
  id: 'CI-06/retired-constraints',
  title: 'A retired constraint name appears only where the appearance retires it or records it',
  covers:
    "SESSION 141's RULE, SEEDED FROM THE MIGRATION DIRECTORY AND NEVER FROM A HAND LIST. " +
    'RETIRED is {names some migration DROPs} minus {names some migration ADDs}, parsed with SQL ' +
    'comments stripped because a comment is not a statement and a comment read as a re-add ' +
    'shrinks the needle list in silence. ' +
    'THE MATCH IS ANCHORED ON BOTH SIDES AND IS NEVER A SUBSTRING, and both edges are ' +
    'load-bearing here rather than hypothetical: one superseding migration names its ' +
    'replacement by SUFFIXING the retired name, so a loose right edge reports the LIVE ' +
    "constraint at every site naming it, and each supersession migration's own FILENAME embeds " +
    'the retired name after `supersede_`, so a loose left edge turns every link to that file ' +
    'into a finding. ' +
    'A CITATION IS A (LINE, NAME) PAIR outside the permitted classes. The permitted classes are ' +
    'WRITTEN AND NEVER COMPUTED (ADR-074 section 2): an exemption set derived from what ' +
    'currently passes passes forever. ' +
    'RETIRED_REGISTER PINS THE COUNT IN BOTH DIRECTIONS, which is the assertion this gate ' +
    'exists for: three stale citations reached one file before anybody counted, and a register ' +
    'saying only "this file is known" would have taken the fourth in silence. It SHRINKS ONLY, ' +
    "CI06U_REGISTER's property, and BOTH registers do: a permitted class exempting nothing and " +
    'a register entry naming nothing are each a finding. ' +
    'RULE 2 EVERYWHERE, because every assertion here is over a needle list: zero migrations, ' +
    'zero DROP statements, zero retired names, zero files walked or zero files read all THROW ' +
    'rather than reporting a clean tree for the one reason that means nothing was checked. ' +
    'TWO THINGS IT DOES NOT DO. The NINE same-name re-adds are not asserted: a constraint ' +
    'dropped and re-added under its own name with a changed predicate keeps resolving by name ' +
    'while its predicate moves underneath, and that is not name-greppable. And it asserts ' +
    'EXISTENCE, NEVER CONTENT: whether a citation of a LIVE constraint describes it correctly ' +
    'is outside it.',
  run() {
    const findings = [];

    // Rule 2 on the seed, in three steps, because each one fails differently and
    // all three end in a needle list of nothing.
    const migrations = sqlFiles();
    if (migrations.length === 0) {
      throw new Error(
        `CI-06/retired-constraints read no .sql file out of ${RETIRED_MIGRATION_DIR}. The seed ` +
          'is the migration directory and there is nothing to seed from',
      );
    }
    const { statements, retired } = retiredConstraints();
    if (statements === 0) {
      throw new Error(
        `CI-06/retired-constraints parsed no DROP CONSTRAINT statement out of ${migrations.length} ` +
          'migration(s). The corpus has retired constraints, so zero means the parse has lost ' +
          'its input rather than that nothing was ever dropped',
      );
    }
    if (retired.size === 0) {
      throw new Error(
        `CI-06/retired-constraints parsed ${statements} DROP CONSTRAINT statement(s) and no ` +
          'retired constraint name, so the needle list is empty and every assertion below would ' +
          'hold vacuously. Either every dropped name is re-added, which is a schema fact worth ' +
          'stating rather than passing on, or the ADD parse is over-matching',
      );
    }
    if (RETIRED_PERMITTED.length === 0) throw new Error('RETIRED_PERMITTED is empty');

    // `\b` written out. The names are `[a-z0-9_]+` by construction, so there is
    // no metacharacter to escape and no case to fold beyond the lowercase above.
    const needles = [...retired]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, droppedBy]) => ({
        name,
        droppedBy,
        re: new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`),
      }));

    const files = allFiles();
    if (files.length === 0) {
      throw new Error('the runner walk reached zero files; CI-06/retired-constraints cannot run');
    }

    const cited = new Map();
    const exempted = new Map(RETIRED_PERMITTED.map((c) => [c.what, 0]));
    let scanned = 0;
    let skipped = 0;
    let permittedSites = 0;
    for (const file of files.sort()) {
      const buf = readFileSync(join(ROOT, file));
      // The six .xlsx workbooks and nothing else, on CI-06/conflict-markers'
      // measurement. A NUL-byte test would instead drop two .ts sources that
      // embed a literal NUL as a key separator.
      if (!isUtf8Text(buf)) {
        skipped++;
        continue;
      }
      scanned++;
      const permitted = RETIRED_PERMITTED.find((c) => c.match(file));
      const lines = buf.toString('utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        for (const needle of needles) {
          if (!needle.re.test(lines[i])) continue;
          if (permitted) {
            permittedSites++;
            exempted.set(permitted.what, exempted.get(permitted.what) + 1);
            continue;
          }
          if (!cited.has(file)) cited.set(file, []);
          cited.get(file).push({ ...needle, line: i + 1 });
        }
      }
    }

    // Rule 2 on the reader, CI-06/conflict-markers' assertion exactly: zero text
    // files means the UTF-8 discriminator has inverted and every citation in the
    // tree is being skipped in silence.
    if (scanned === 0) {
      throw new Error(
        `CI-06/retired-constraints read zero text files out of ${files.length}. The UTF-8 check ` +
          'has inverted and every file in the tree is being skipped as binary',
      );
    }
    // Rule 2 on the seed one last time. The migration directory is permitted and
    // every retired name is dropped inside it, so a run where no needle matches
    // anywhere means the matcher is broken rather than that the tree is clean.
    if (permittedSites === 0) {
      throw new Error(
        `CI-06/retired-constraints matched none of its ${needles.length} retired name(s) in any ` +
          'permitted file. Every retired name is DROPped inside the migration directory, which ' +
          'is a permitted class, so zero here means the matcher is not matching',
      );
    }

    for (const [file, sites] of [...cited].sort()) {
      const entry = RETIRED_REGISTER.get(file);
      const at = sites
        .map((s) => `${s.line} (\`${s.name}\`, dropped by ${s.droppedBy})`)
        .join(', ');
      if (!entry) {
        for (const site of sites) {
          findings.push(
            `${file}:${site.line}: cites the retired constraint \`${site.name}\`, which ` +
              `${site.droppedBy} dropped and no migration re-adds. A retired name may appear ` +
              'only where the appearance retires it or records it. If this site records a ' +
              'position on a date it belongs in a permitted class; if it describes the live ' +
              'schema it is wrong. Adding a line to RETIRED_REGISTER without reading the site ' +
              'is neither',
          );
        }
        continue;
      }
      if (sites.length > entry.sites) {
        findings.push(
          `${file}: carries ${sites.length} citation(s) of a retired constraint and ` +
            `RETIRED_REGISTER claims ${entry.sites}, at line(s) ${at}. THIS IS THE ASSERTION ` +
            'THE GATE EXISTS FOR: three stale citations reached one file before anybody counted ' +
            'them, and the register is what stops the fourth',
        );
      } else if (sites.length < entry.sites) {
        findings.push(
          `${file}: carries ${sites.length} citation(s) of a retired constraint and ` +
            `RETIRED_REGISTER claims ${entry.sites}, at line(s) ${at}. The register SHRINKS ` +
            'ONLY, so the day a site is repaired is the day its number moves. An entry standing ' +
            'above what the file holds is a repair nobody recorded',
        );
      }
    }

    // BOTH REGISTERS SHRINK IN THE STALE DIRECTION, CI06U_REGISTER's property
    // and CI-06/vg-inventory's pair of them.
    const onDisk = new Set(files);
    for (const [file, entry] of RETIRED_REGISTER) {
      if (cited.has(file)) continue;
      const reason = !onDisk.has(file)
        ? 'no such file is in the runner walk'
        : RETIRED_PERMITTED.some((c) => c.match(file))
          ? 'the file is exempted as a permitted class, so the entry can never do anything'
          : 'no line in it cites a retired constraint';
      findings.push(
        `gates.mjs: RETIRED_REGISTER holds "${file}" (${entry.sites} site(s)) and ${reason}. ` +
          'The entry has done its work and goes; a register that only ever grows stops being a ' +
          'decision and becomes a list',
      );
    }
    for (const [what, n] of exempted) {
      if (n > 0) continue;
      findings.push(
        `gates.mjs: the permitted class "${what}" exempts no citation in this tree. An ` +
          'exemption that permits nothing is a rule nobody relies on, and it goes the same way ' +
          'a stale register entry does',
      );
    }

    console.log(
      `       CI-06/retired-constraints note: ${statements} DROP CONSTRAINT statement(s) over ` +
        `${migrations.length} migration(s) leave ${needles.length} retired name(s); ` +
        `${scanned} file(s) read and ${skipped} skipped as not UTF-8; ${permittedSites} site(s) ` +
        `exempted across ${RETIRED_PERMITTED.length} permitted class(es) and ` +
        `${[...cited.values()].reduce((n, s) => n + s.length, 0)} site(s) over ${cited.size} ` +
        `file(s) outside them, against a register of ${RETIRED_REGISTER.size} file(s)`,
    );

    return findings;
  },
};

// -----------------------------------------------------------------------------
// CI-06/derivable-counts  No prose sentence states a count this runner derives
// -----------------------------------------------------------------------------
// THE GATE `CI-06g` HAS DECLARED OWED ON EVERY RUN SINCE IT WAS WRITTEN, in its
// own covers line: "the corpus-wide sweep for bare numerals adjacent to a
// registry noun needs the generator and is NOT run here." `ADR-034` ruled the
// property -- "no document states a quantity a script can derive, unless the
// number sits in a generated span the script rewrites" -- and recorded that the
// sweep "is the gate's first run and is not done here". The generator exists now.
// This is the sweep.
//
// THE RECEIPT, AND IT IS A SHAPE NO MERGE CAN SEE. `schema.ts`'s header sentence
// states how many registered tables carry a later column. Tranche A raised it to
// NINE for `payout_requests`; tranche B raised it to NINE for
// `promotional_credit_grants`. Two branches reached the SAME NUMBER FOR DIFFERENT
// REASONS. Either copy reads NINE, names nine tables, is internally consistent,
// and is wrong by one; git sees no conflict because both sides wrote the same
// character. The answer was TEN and it was derived by replaying `ALTER TABLE`.
// `ADR-042` had already ruled that prose is not a control.
//
// HOW A DERIVABLE COUNT IS RECOGNISED WITHOUT FLAGGING EVERY NUMBER IN THE
// CORPUS. Three candidate rules were measured over every markdown file under
// `docs/` with the SAME reader that shipped below -- the cardinal must GOVERN the
// noun, one run of whitespace and no window -- so the comparison is between rules
// and not between parsers. The numbers are the argument:
//
//   * ANY VALUE. A cardinal governing a registry noun, whatever it counts: 1,677
//     sites, of which 206 are in live prose. Almost every one of the 206 is a
//     LOCAL SUBSET and not a population: `1 gate`, `2 gate`, `Six deltas`, `three
//     tables`. A gate reporting 206 findings on a clean tree is switched off in a
//     week, and it would be right to switch it off.
//   * A TOTALITY WORD BEFORE THE CARDINAL (`all 47 migrations`), at a value the
//     tree does not derive: five findings in live prose, and ALL FIVE ARE FALSE.
//     "All three tables are the approved design" is a local set with a totality
//     word in front of it, and so are the other four.
//   * VALUE-ANCHORED: the cardinal must equal what its bound query returns ON
//     THIS TREE. Zero findings in live prose on a clean tree, 137 sites under a
//     dated or session heading and 11 in a table row, both excluded by shape and
//     both counted on every run.
//
// The three figures move as the tree moves, which is why the RUN NOTE prints the
// live ones and this block is dated: measured on this branch, 2026-08-26.
//
// A number that equals the size of the population its own sentence names is
// overwhelmingly that population's size, and nothing looser survives contact with
// a corpus that argues in numbers.
//
// THE FALSE NEGATIVE THAT BUYS, STATED PLAINLY BECAUSE IT IS THE PRICE. A COUNT
// THAT HAS ALREADY DRIFTED IS INVISIBLE HERE. On the merged tree the receipt's
// sentence read NINE against a truth of TEN, and this gate would have been silent
// on it. That is not a hole in the argument, it is where the argument lives: ON
// EITHER BRANCH ALONE the sentence read NINE against a derivation of NINE, and
// the gate names it there -- while it is still RIGHT, which is the only moment a
// span can be installed without anyone having to decide what the truth is. A gate
// that fired on the drifted number would be asking a reader to adjudicate; this
// one asks only that a derivable number stop being typed.
//
// FOUR EXCLUSIONS, ALL BY SHAPE, ALL COUNTED ON EVERY RUN so the population they
// hold is visible rather than asserted.
//
//   1. INSIDE A GENERATED SPAN. That is the remedy and not the defect. Masked
//      with `spansIn`'s own expression, so "generated" means one thing here and
//      in `CI-06g`.
//   2. INSIDE A FENCED BLOCK. A worked example of this gate's own finding is
//      exactly what the document explaining it would quote. `CI-06t` masks fences
//      for the same reason and `CI-06v` skips them for the same reason.
//   3. UNDER A HEADING THAT NAMES A DATE OR A SESSION NUMBER. This is the
//      exclusion that makes the gate possible and it is the one worth arguing.
//      An entry headed `## ... (2026-08-24)` or `## Session 207: ...` IS A RECORD
//      OF A MEASUREMENT MADE THAT DAY. "All 47 migrations applied in order" was
//      true when it was written and a generated span there would REWRITE THE
//      RECORD TO SAY SOMETHING IT DID NOT SAY, which is a worse defect than the
//      one being repaired. `ADR-064` is what lets a session number stand beside a
//      date: a session number IS a day-and-slot allocation. 137 candidate sites
//      live under such headings against 11 in table rows and none in live prose,
//      and they are declared out of scope rather than missed. Only levels 1 and 2
//      set the flag: an ADR's `### 3.` subsection inherits its file's dated `##`
//      heading, which is what makes a whole dated ruling a record rather than
//      only its first paragraph.
//   4. INSIDE A TABLE ROW. `ADR-034`'s subject is a PROSE SENTENCE, and a
//      registry row is a per-row datum whose number belongs to that row rather
//      than to the document. 11 sites.
//
// FOUR MORE THINGS IT DOES NOT DO.
//   1. IT READS MARKDOWN ONLY, and the receipt's own file is therefore out of
//      reach. `generate()` rewrites `markdownFiles()` and nothing else, so a
//      finding in a `.ts` header would be a finding with no remedy, and a finding
//      with no remedy is how a gate gets switched off. Measured rather than
//      waved at: the same recogniser over every `.ts`, `.tsx`, `.mjs` and `.sql`
//      in the tree finds 17 sites, eleven under `packages/` -- four of them in
//      `schema.ts` and three in `scope.ts` -- and six in this runner and its
//      harness. Closing them needs the generator taught to write a comment
//      span, which is a change under `packages/` this session's fence forbids. It
//      is named here as owed rather than left for somebody to rediscover.
//   2. THE RECEIPT'S OWN NUMBER IS NOT IN THE VOCABULARY AND CANNOT BE. "How many
//      registered tables carry a later `ADD COLUMN`" is derived by
//      `packages/db/test/scoped-db.test.ts`'s replay and by nothing in this
//      runner. The gate reaches the CLASS the receipt belongs to; closing that
//      INSTANCE needs a query for it, in `SPAN_QUERIES`, reading the migrations.
//   3. THE VOCABULARY IS A RECORDED READING AND NOT A DERIVATION. Eight nouns
//      over eight scalar queries, each argued below. A derivable population with
//      no entry is unpoliced, and the remedy is another argued entry rather than
//      a looser match.
//   4. TWO QUERIES MAY RETURN THE SAME VALUE -- `adr_count` and `tables` are both
//      111 on this ref -- so the NOUN disambiguates and never the number. The
//      vocabulary is scanned in declaration order and the first noun that matches
//      wins, which is stated rather than left to a reader to infer.
const DERIVABLE_DOCS = 'docs/';

// A cardinal this corpus writes. Digits, or the English number words it actually
// uses. A DIGIT RUN WITH A LEADING ZERO IS NOT A COUNT: `0047` is a migration
// identifier and `047` is nothing anybody writes for forty-seven, and admitting
// them would make every identifier adjacent to its own noun a finding.
const CARDINAL_ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const CARDINAL_TENS = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

// The value of a written cardinal, or null if it is not one. Handles the three
// forms this corpus writes: `nine`, `ninety-five` (and `ninety five`), and `one
// hundred and four`.
function cardinalValue(text) {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const hundred = /^([a-z]+) hundred(?: and (.+))?$/.exec(t);
  if (hundred) {
    const h = CARDINAL_ONES.indexOf(hundred[1]);
    if (h < 1) return null;
    if (!hundred[2]) return h * 100;
    const rest = cardinalValue(hundred[2]);
    return rest === null ? null : h * 100 + rest;
  }
  const compound = /^([a-z]+)[- ]([a-z]+)$/.exec(t);
  if (compound) {
    const tens = CARDINAL_TENS[compound[1]];
    const ones = CARDINAL_ONES.indexOf(compound[2]);
    return tens !== undefined && ones > 0 ? tens + ones : null;
  }
  if (CARDINAL_TENS[t] !== undefined) return CARDINAL_TENS[t];
  const ones = CARDINAL_ONES.indexOf(t);
  return ones >= 0 ? ones : null;
}

const CARDINAL_WORD = new RegExp(
  `\\b(?:(?:${CARDINAL_ONES.slice(1, 10).join('|')}) hundred(?: and [a-z]+(?:-[a-z]+)?)?` +
    `|(?:${Object.keys(CARDINAL_TENS).join('|')})(?:[- ](?:${CARDINAL_ONES.slice(1, 10).join('|')}))?` +
    `|${CARDINAL_ONES.join('|')})\\b`,
  'gi',
);
// No leading zero, no thousands separator, no decimal point, and not glued to a
// word: `1,604`, `0047`, `16.13` and `M13` all fail this deliberately.
const CARDINAL_DIGITS = /(?<![\w.,-])[1-9]\d{0,3}(?![\w.,-])/g;

// THE VOCABULARY. One entry per population, each bound to a SCALAR query in
// SPAN_QUERIES, each with the reason it is a population somebody restates rather
// than a word that happens to follow a number. Scanned in order; the first noun
// that matches a site wins, which is how `adr_count` and `tables` stay apart on a
// ref where both return 111.
const DERIVABLE_NOUNS = [
  // SCOPED, AND IT IS THE FIRST ENTRY THAT IS. ADR-130.
  //
  // `deltas` is bound below to `manifest_changes`, the corpus-wide 117. M06
  // section 2 states the size of ITS OWN delta table, which is a PER-DOCUMENT
  // population under a noun the corpus-wide entry already owns, and the gate was
  // silent on it at EVERY value that sentence can hold: it read "Seven deltas"
  // against a truth of ten, and retyping it at ten with the span removed left the
  // gate silent too, because neither seven nor ten is 117.
  //
  // THE REMEDY THIS GATE NAMES COULD NOT BE APPLIED TO IT. "A derivable
  // population with no entry is unpoliced, and the remedy is another argued
  // entry" -- but the vocabulary is scanned in declaration order and the first
  // noun that matches wins, and this file already records what that costs:
  // "two vocabulary entries for one noun would make the first shadow the second
  // forever". So an argued entry for M06's deltas, added the only way the
  // vocabulary allowed, would have been unreachable. `OI-24` had been open on
  // that sentence since session 95 with its remedy named, and the sentence is the
  // one this gate's own rationale quotes -- "almost every one a local subset (1
  // gate, Six deltas, three tables)" -- as a specimen of the noise the
  // ANY-VALUE rule would produce. That reading was right about the RULE and wrong
  // about the SITE.
  //
  // A `file` predicate is what makes a per-document population expressible. A
  // scoped entry is declared BEFORE the global entry it shares a noun with, so
  // the global cannot shadow it, and it narrows rather than widens: it matches
  // fewer documents than the unscoped form, never more.
  {
    query: 'm06_delta_count',
    noun: /(?:schema )?deltas?/i,
    label: 'M06 schema deltas',
    file: /^docs\/plans\/M06-admin-ops-console\.md$/,
  },
  // The count ADR-034 was ruled over. INDEX stated it, drifted twice, and the
  // second drift landed on `main` on the day the ruling was written.
  { query: 'adr_count', noun: /ADRs?/, label: 'ADRs' },
  // ADR-034's own evidence table: "342 / 5 in STATE, 345 / 5 in DATA_MODEL,
  // actual 347 / 6". Two documents describing one migration set disagreed with
  // each other and both disagreed with the database.
  { query: 'sql_triggers', noun: /triggers?/i, label: 'triggers' },
  // The receipt's population, by the parser that can see it from here. The
  // migration set grows by one whenever a money-path change lands, which is
  // exactly when nobody is thinking about a sentence in a plan document.
  { query: 'migration_files', noun: /migrations?/i, label: 'migrations' },
  // `sql_tables` is the same number by a second parser and deliberately NOT
  // rowed here: two vocabulary entries for one noun would make the first
  // shadow the second forever.
  { query: 'tables', noun: /tables?/i, label: 'tables' },
  { query: 'gate_count', noun: /gates?/i, label: 'gates' },
  // STRATEGY names the trap in its own words: counting `## EC-nnn` headings
  // gives one number and counting identifiers gives another, so a hand-written
  // total here is wrong in a way that looks careful.
  { query: 'ec_count', noun: /edge cases?/i, label: 'edge cases' },
  { query: 'gs_count', noun: /golden scenarios?/i, label: 'golden scenarios' },
  // ADR-026's manifest. ADR-034's first row of evidence: stated 75, actual 88
  // numbered and 93 total, "wrong ON THE DAY IT WAS RECORDED, then quoted by
  // four documents, then given a correct increment on a wrong base".
  { query: 'manifest_changes', noun: /(?:schema )?deltas?/i, label: 'schema deltas' },
];

// A record of a measurement rather than a claim about the tree: a heading naming
// a DATE, or a SESSION, which ADR-064 rules is a day-and-slot allocation.
const RECORD_HEADING = /\b20\d{2}-[01]\d-[0-3]\d\b|\bsessions?\s+\d{1,4}\b/i;

const ci06DerivableCounts = {
  id: 'CI-06/derivable-counts',
  title: 'No prose sentence under docs/ states a count this runner can derive',
  covers:
    "THE SWEEP CI-06g DECLARES OWED IN ITS OWN COVERS LINE: 'the corpus-wide sweep for bare " +
    "numerals adjacent to a registry noun needs the generator and is NOT run here'. ADR-034 " +
    'ruled the property and recorded that the sweep is its first run and was not done there. ' +
    'THE RECEIPT IS A SHAPE NO MERGE CAN SEE: two tranches independently raised the same ' +
    'prose number to NINE for DIFFERENT tables, each copy internally consistent and each ' +
    'wrong by one, and git saw no conflict because both sides wrote the same character. ' +
    'THE RECOGNISER IS VALUE-ANCHORED AND THE ALTERNATIVES WERE MEASURED WITH THE SAME ' +
    'READER, so the comparison is between rules and not between parsers. A cardinal GOVERNING ' +
    'a registry noun at ANY value is 1,677 sites under docs/, 206 of them in live prose and ' +
    'almost every one a local subset (1 gate, Six deltas, three tables). A TOTALITY WORD ' +
    'before the cardinal at a value the tree does not derive gives five findings in live ' +
    'prose and ALL FIVE ARE FALSE. VALUE-ANCHORED gives zero in live prose, 137 sites under a ' +
    'dated or session heading and 11 in a table row (measured on this branch, 2026-08-26; the ' +
    'live figures are in the run note). So the cardinal must EQUAL what its bound query ' +
    'returns on this tree. ' +
    'THE FALSE NEGATIVE THAT BUYS IS STATED RATHER THAN HIDDEN: A COUNT THAT HAS ALREADY ' +
    'DRIFTED IS INVISIBLE. The merged receipt read NINE against a truth of TEN and this gate ' +
    'would have been silent on it. On EITHER BRANCH ALONE it read NINE against a derivation ' +
    'of NINE and is named there, while it is still right, which is the only moment a span can ' +
    'be installed without anyone adjudicating the truth. ' +
    'FOUR EXCLUSIONS, ALL BY SHAPE AND ALL COUNTED ON EVERY RUN. A generated span is the ' +
    'remedy, not the defect. A fenced block is a worked example. A HEADING NAMING A DATE OR A ' +
    'SESSION NUMBER makes its section a RECORD of a measurement made that day, and a span ' +
    'there would rewrite the record to say what it did not say; 137 candidate sites live ' +
    'under such headings, declared out of scope rather than missed. And a TABLE ROW is a ' +
    "per-row datum where ADR-034's subject is a prose sentence; 11 sites. " +
    'FOUR MORE THINGS IT DOES NOT DO. It reads MARKDOWN ONLY, because generate() rewrites ' +
    'markdown and a finding with no remedy is how a gate gets switched off; the same ' +
    'recogniser over every .ts, .tsx, .mjs and .sql finds 17 further sites, eleven under ' +
    'packages/ (four in schema.ts, three in scope.ts) and six in this runner and its ' +
    'harness, and closing them needs a comment-span generator. THE ' +
    "RECEIPT'S OWN NUMBER IS NOT IN THE VOCABULARY AND CANNOT BE: how many registered tables " +
    "carry a later ADD COLUMN is derived by scoped-db.test.ts's replay and by nothing in this " +
    'runner, so the gate reaches the CLASS and not that INSTANCE. The vocabulary is a ' +
    'recorded reading of eight populations, not a derivation, so an underivable one is ' +
    'unpoliced and the remedy is another argued entry. And two queries may return the same ' +
    'value, so the NOUN disambiguates and never the number, first match in declaration order.',
  run() {
    const findings = [];
    const files = markdownFiles().filter((p) => p.startsWith(DERIVABLE_DOCS));
    // Rule 2 on a glob-shaped input, the guard CI-06u, CI-06v and
    // CI-06/table-row-width all carry.
    if (files.length === 0) {
      throw new Error(`no markdown files under ${DERIVABLE_DOCS}; the gate cannot run`);
    }

    // THE VOCABULARY IS RESOLVED BEFORE ANYTHING IS READ, and a query that has
    // gone missing or stopped returning a number is an ERROR rather than an
    // entry that silently matches nothing. That is Rule 2 applied to the half of
    // this gate that is a reading of another table in this file: `SPAN_QUERIES`
    // is edited by every session that adds a derivation, and a vocabulary entry
    // pointing at a key somebody renamed would take this gate to zero findings
    // and read exactly like a clean tree.
    const vocabulary = [];
    for (const entry of DERIVABLE_NOUNS) {
      const query = SPAN_QUERIES[entry.query];
      if (!query) {
        throw new Error(
          `CI-06/derivable-counts: no SPAN_QUERIES entry named "${entry.query}" for the noun ` +
            `"${entry.label}". The vocabulary points at a query this runner no longer has`,
        );
      }
      const value = query();
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new Error(
          `CI-06/derivable-counts: the query "${entry.query}" returns ${JSON.stringify(value)}, ` +
            'which is not a count. Only scalar queries belong in this vocabulary',
        );
      }
      vocabulary.push({ ...entry, value });
    }

    let sites = 0;
    let cardinals = 0;
    const skipped = { record: 0, table: 0 };

    for (const file of files.sort()) {
      // Masked whole-body and in this order: a span may run over many lines
      // (ADR-088's two table spans do), so a per-line mask would miss it.
      // `spansIn`'s expression is reused rather than restated for the reason
      // `spanTokens` gives one gate over: sharing the mask is what makes
      // "generated" and "quoted" mean one thing across this runner.
      const blank = (m) => m.replace(/[^\n]/g, ' ');
      const body = read(file)
        .replace(new RegExp(`<!--${'gen'}:[a-z0-9_]+-->.*?<!--/${'gen'}-->`, 'gs'), blank)
        .replace(/^(```+|~~~+)[\s\S]*?^\1.*$/gm, blank);

      let inRecord = false;
      const lines = body.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const heading = /^(#{1,6})\s/.exec(line);
        if (heading) {
          // Levels 1 and 2 only. An ADR's `### 3.` inherits the dated `##` its
          // file opens with, which is what makes a whole dated ruling a record
          // rather than only its opening paragraph.
          if (heading[1].length <= 2) inRecord = RECORD_HEADING.test(line);
          continue;
        }
        const isTableRow = line.trimStart().startsWith('|');

        const found = [];
        for (const m of line.matchAll(CARDINAL_DIGITS)) found.push([Number(m[0]), m.index, m[0]]);
        for (const m of line.matchAll(CARDINAL_WORD)) {
          const value = cardinalValue(m[0]);
          if (value !== null) found.push([value, m.index, m[0]]);
        }

        for (const [value, at, text] of found) {
          cardinals++;
          // The noun must GOVERN the cardinal: one run of whitespace, then the
          // noun, allowing the emphasis this corpus wraps both in. A window would
          // admit "47 of the 111 tables", where the 47 counts something else
          // entirely.
          //
          // EMPHASIS IS ALLOWED ON EITHER SIDE OF THAT WHITESPACE, and the
          // trailing side was missed on the first reading. `**32 gates**` matched
          // and `**32** gates` did not, because the second closes its emphasis
          // BEFORE the space, which is a form this corpus writes constantly.
          //
          // EACH VOCABULARY PATTERN IS ANCHORED AGAINST THE TEXT RATHER THAN A
          // NOUN BEING CAPTURED FIRST AND COMPARED AFTER, and the difference was
          // three dead entries. Capturing with a lazy `[A-Za-z ]*?` and a
          // word-boundary lookahead stops at the FIRST word: `edge cases` was
          // read as `edge`, so `ec_count`, `gs_count` and `manifest_changes`
          // could never match anything and the gate was asserting five eighths
          // of what its vocabulary claimed, silently, on a clean tree. Anchoring
          // the entry's own pattern lets a multi-word noun match as one noun.
          //
          // THE ENTRY'S OWN FLAGS ARE CARRIED and no `i` is added here: `ADRs`
          // is case-sensitive on purpose and the rest are not, which is a
          // per-entry judgement recorded in the vocabulary rather than a blanket
          // rule applied at the comparison.
          const after = line.slice(at + text.length);
          let governed = null;
          const entry = vocabulary.find((v) => {
            // ADR-130. An entry with no `file` is corpus-wide, which is every
            // entry the vocabulary carried before scoping existed.
            if (v.file && !v.file.test(file)) return false;
            if (v.value !== value) return false;
            const m = new RegExp(
              `^[\`*_]{0,3}\\s+[\`*_]{0,3}(${v.noun.source})[\`*_]{0,3}(?![\\w-])`,
              v.noun.flags,
            ).exec(after);
            if (!m) return false;
            governed = m[1];
            return true;
          });
          if (!entry) continue;
          if (inRecord) {
            skipped.record++;
            continue;
          }
          if (isTableRow) {
            skipped.table++;
            continue;
          }
          sites++;
          findings.push(
            `${file}:${i + 1}: "${text} ${governed}" states a count this runner derives: ` +
              `the query "${entry.query}" returns ${entry.value} on this ref. ADR-034 rules ` +
              'that no document states a derivable quantity unless it sits in a generated ' +
              'span. Two branches that each move this number to the same value for different ' +
              'reasons merge green and wrong. Either put it in a generated span (add ' +
              `<!--${'gen'}:${entry.query}--> around the number and run: node ` +
              'scripts/corpus/gates.mjs generate) or delete the number and point at the script',
          );
        }
      }
    }

    // Rule 2 on the reader. This corpus argues in numbers; a scan that examined
    // no cardinal at all has lost its input, and it would report a clean tree
    // for the one reason that means it read nothing.
    if (cardinals === 0) {
      throw new Error(
        `CI-06/derivable-counts examined zero cardinals over ${files.length} file(s) under ` +
          `${DERIVABLE_DOCS}. This corpus argues in numbers, so zero means the cardinal ` +
          'reader has stopped matching and every derivable count in the tree would pass',
      );
    }

    console.log(
      `       CI-06/derivable-counts note: ${cardinals} cardinal(s) read over ${files.length} ` +
        `file(s); vocabulary ${vocabulary.map((v) => `${v.label}=${v.value}`).join(' ')}; ` +
        `${skipped.record} site(s) under a dated or session heading and ${skipped.table} in a ` +
        `table row, both out of scope by shape; ${sites} in scope`,
    );
    return findings;
  },
};

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
  ci06ClosedLetterSeries,
  ci06q,
  ci06r,
  ci06s,
  adr026,
  ci06t,
  ci06u,
  ci06v,
  ci06TableRowWidth,
  ci06w,
  conflictMarkers,
  fixtureInventory,
  identifierSeries,
  gateInventory,
  vgInventory,
  retiredConstraintsGate,
  ci06DerivableCounts,
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
