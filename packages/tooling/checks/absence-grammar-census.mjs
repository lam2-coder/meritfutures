// =============================================================================
// packages/tooling/checks/absence-grammar-census.mjs
// =============================================================================
// A CENSUS OF THE ABSENCE GRAMMAR OVER `docs/`, AND IT IS NOT A GATE.
//
// -----------------------------------------------------------------------------
// WHAT THIS COUNTS, AND WHY IT IS NOT THE SAME QUESTION `RI-35` ANSWERS
// -----------------------------------------------------------------------------
// `RI-35` (`absence-claims.mjs`) binds a REGISTERED sentence to a REGISTERED
// artifact and asserts the artifact still absent. Its register is written and
// never computed, and its sweep deliberately walks no `docs/` file: that file's
// own words at `absence-claims.mjs:2463` are "THE SWEEP EXCLUDES `docs/` AND
// `test/`: a dated record quoting a false sentence is written out of citation
// grammar". `RI-14` states the neighbouring limit at
// `repo-invariants.mjs:2009`: it reads a listed set of files rather than the
// whole tree, "because the property is about reasons somebody wrote down and a
// survey of the tree would drown the finding".
//
// BOTH OF THOSE ARE RULINGS ABOUT A NARROW GRAMMAR: a claim that a NAMED,
// BACKTICKED thing does not exist. THIS FILE COUNTS A WIDER ONE: a claim that
// NO CHECK DOES SOMETHING. "no gate reads", "nothing binds", "not one check",
// "no invariant compares". That grammar names no artifact. It quantifies over
// the check population, and the check population is the thing this estate keeps
// changing, so a sentence in it can go false without a single character of the
// sentence changing.
//
// THIS FILE REPORTS AND REFUSES TO JUDGE. It produces a population, a
// stratification and a reproducible sample. It is not in `repo-invariants.mjs`'s
// `CHECKS` array and it must not be added to one: `ADR-446` section 6 derives
// why the population cannot carry a single pass/fail rate, and a gate over a
// population with two truth-conditions is a gate somebody switches off.
//
// -----------------------------------------------------------------------------
// LINE BREAKS ARE FLATTENED BEFORE ANYTHING IS COUNTED
// -----------------------------------------------------------------------------
// A substring scan over single lines cannot see a sentence that wraps. That is
// not a hypothetical: `RI-35`'s own `SWEEP_WINDOW` at `absence-claims.mjs:328`
// is TWO for exactly this reason, and its docblock records that occurrence 3
// wraps with the artifact on one line and the absence word on the next.
// `SWEEP_WINDOW` is a two-line window, which still loses a sentence that wraps
// across three. This file does not use a window. It joins the whole file into
// one string, keeps a per-character map back to the originating line, and
// segments SENTENCES rather than lines, so a citation is still `file:line`.
//
// -----------------------------------------------------------------------------
// THE POPULATION IS A FUNCTION OF THE GRAMMAR, WHICH IS WHY THE GRAMMAR IS DATA
// -----------------------------------------------------------------------------
// `ADR-446` section 3 reports three grammars over the same tree in the same
// session returning 14,353, 3,448 and 1,022. None is wrong. They are three
// different questions. So the grammar is exported as `ABSENCE_GRAMMAR` and
// every figure this file prints is stamped with the grammar id that produced
// it. A count quoted without its grammar is not re-derivable, and this file
// exists partly to make quoting one that way awkward.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * Nouns that name a member of the check population. The grammar quantifies over
 * these; it does not read claims about named exports, which is `RI-14`'s half.
 */
const SUBJECT = 'check|gate|test|assertion|invariant|runner|linter|probe|suite|rule|control|CI job';

/**
 * Verbs of CHECKING. A negated quantifier over the check population followed by
 * one of these is the claim "no check does X". Verbs of existence are excluded
 * deliberately: "no adapter exists" is a claim about the tree, not about the
 * suite, and `RI-14` already owns that shape.
 */
const VERB =
  'compares?|reads?|asserts?|binds?|verifies|enforces?|catches|tests?|checks?|' +
  'guards?|sees?|names?|covers?|proves?|measures?|counts?|derives?|' +
  'distinguishes|fails|parses?|inspects?|examines?|validates?|rejects?|flags?|' +
  'detects?|knows?|tracks?|watches?|opens?|touches?|reaches';

/**
 * The grammar, as data. Each entry is `{ id, re }` and every reported figure
 * carries the `id` set that produced it.
 * @type {ReadonlyArray<{ id: string, re: RegExp }>}
 */
export const ABSENCE_GRAMMAR = Object.freeze([
  {
    id: 'no-SUBJECT-VERB',
    re: new RegExp(
      String.raw`\bno\s+(?:other\s+|such\s+|single\s+|existing\s+|current\s+|second\s+)?(?:${SUBJECT})s?\b(?:\s+(?:in|under|on|of|here|anywhere|at|for)\b[^.]{0,40})?\s+(?:${VERB})\b`,
      'i',
    ),
  },
  {
    id: 'nothing-VERB',
    re: new RegExp(String.raw`\bnothing\s+(?:in\s+[^.]{0,30}\s+)?(?:${VERB})\b`, 'i'),
  },
  { id: 'not-one-SUBJECT', re: new RegExp(String.raw`\bnot one\s+(?:${SUBJECT})s?\b`, 'i') },
  {
    id: 'no-SUBJECT-does-not-VERB',
    re: new RegExp(
      String.raw`\bno\s+(?:${SUBJECT})\b[^.]{0,40}?\b(?:does not|cannot)\s+(?:${VERB})\b`,
      'i',
    ),
  },
]);

/**
 * A dated record is a document whose truth is indexed to its own date and which
 * `ADR-386:169` rules cannot be repaired by a commit: every pointer in one is
 * NAMED instead. That ruling is the whole reason this census stratifies.
 * @param {string} file repo-relative path
 * @returns {boolean}
 */
export function isDatedRecord(file) {
  return (
    /^docs\/sessions\/\d{4}-\d{2}-\d{2}-/.test(file) ||
    /^docs\/decisions\/ADR-[^/]+\.md$/.test(file) ||
    /^docs\/reviews\//.test(file)
  );
}

/**
 * Flatten a document to one string, keeping a map from character offset back to
 * the 1-based source line. Nothing is counted before this runs.
 * @param {string} text
 * @returns {{ flat: string, lineAt: (offset: number) => number }}
 */
export function flattenDocument(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  /** @type {number[]} */ const starts = [];
  let flat = '';
  for (let i = 0; i < lines.length; i += 1) {
    starts.push(flat.length);
    flat += (lines[i] ?? '') + (i === lines.length - 1 ? '' : ' ');
  }
  const lineAt = (/** @type {number} */ offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((starts[mid] ?? 0) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  // Whitespace is NOT collapsed. Collapsing it would shorten the string and
  // invalidate every offset in `starts`, which is what the line map is for.
  return { flat, lineAt };
}

/**
 * Segment a flattened document into sentences. A sentence boundary is terminal
 * punctuation followed by whitespace and an opening character. Markdown list
 * bullets and table pipes are boundaries too, because a table cell is a
 * sentence for this purpose and a row of them is not one.
 * @param {string} flat
 * @returns {Array<{ text: string, offset: number }>}
 */
export function sentencesOf(flat) {
  /** @type {Array<{ text: string, offset: number }>} */ const out = [];
  const re = /(?<=[.!?])\s+(?=[A-Z`*_[(])|\s+\|\s+|(?:^|\s)[-*]\s+\*\*/g;
  let last = 0;
  for (const m of flat.matchAll(re)) {
    const end = (m.index ?? 0) + m[0].length;
    const text = flat.slice(last, m.index);
    if (text.trim() !== '') out.push({ text, offset: last });
    last = end;
  }
  const tail = flat.slice(last);
  if (tail.trim() !== '') out.push({ text: tail, offset: last });
  return out;
}

/**
 * Which grammar entries a sentence satisfies.
 * @param {string} sentence
 * @returns {string[]} matching grammar ids, empty when the sentence is not in scope
 */
export function grammarHits(sentence) {
  return ABSENCE_GRAMMAR.filter((g) => g.re.test(sentence)).map((g) => g.id);
}

/**
 * Every tracked `docs/` markdown file, from git rather than from a directory
 * walk, so an untracked scratch file cannot enter a reported population.
 * @param {string} root
 * @returns {string[]}
 */
export function censusFiles(root) {
  return execFileSync('git', ['-C', root, 'ls-files', 'docs'], { encoding: 'utf8' })
    .split('\n')
    .filter((f) => f.endsWith('.md'));
}

/**
 * The population: one row per SENTENCE in scope, never one per match.
 * @param {string} root
 * @param {{ files?: string[] }} [opts]
 * @returns {Array<{ file: string, line: number, ids: string[], text: string, dated: boolean }>}
 */
export function censusPopulation(root, opts = {}) {
  const files = opts.files ?? censusFiles(root);
  /** @type {Array<{ file: string, line: number, ids: string[], text: string, dated: boolean }>} */
  const rows = [];
  for (const file of files) {
    let raw;
    try {
      raw = readFileSync(`${root}/${file}`, 'utf8');
    } catch {
      continue;
    }
    const { flat, lineAt } = flattenDocument(raw);
    for (const s of sentencesOf(flat)) {
      const ids = grammarHits(s.text);
      if (ids.length === 0) continue;
      rows.push({
        file,
        line: lineAt(s.offset),
        ids,
        text: s.text.trim().slice(0, 400),
        dated: isDatedRecord(file),
      });
    }
  }
  return rows;
}

/**
 * A deterministic sample. The selection method is stated rather than described:
 * an LCG seeded with `seed`, drawing without replacement from the stratum, and
 * the same seed over the same population returns the same rows on every host.
 * @param {ReadonlyArray<T>} rows
 * @param {number} n
 * @param {number} seed
 * @returns {T[]}
 * @template T
 */
export function sample(rows, n, seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  const idx = rows.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const a = idx[i];
    const b = idx[j];
    if (a !== undefined && b !== undefined) {
      idx[i] = b;
      idx[j] = a;
    }
  }
  /** @type {T[]} */ const out = [];
  for (const i of idx.slice(0, Math.min(n, idx.length))) {
    const r = rows[i];
    if (r !== undefined) out.push(r);
  }
  return out;
}

/**
 * Population totals, stratified by `isDatedRecord`. Every figure this returns is
 * computed at call time; nothing here caches a count or carries one in prose.
 * @param {string} root
 * @param {{ files?: string[] }} [opts]
 */
export function censusReport(root, opts = {}) {
  const rows = censusPopulation(root, opts);
  const dated = rows.filter((r) => r.dated);
  const live = rows.filter((r) => !r.dated);
  /** @type {Map<string, number>} */ const byFile = new Map();
  for (const r of rows) byFile.set(r.file, (byFile.get(r.file) ?? 0) + 1);
  /** @type {Map<string, number>} */ const byId = new Map();
  for (const r of rows) for (const id of r.ids) byId.set(id, (byId.get(id) ?? 0) + 1);
  return {
    grammar: ABSENCE_GRAMMAR.map((g) => g.id),
    total: rows.length,
    dated: dated.length,
    live: live.length,
    files: byFile.size,
    byFile,
    byId,
    rows,
  };
}
