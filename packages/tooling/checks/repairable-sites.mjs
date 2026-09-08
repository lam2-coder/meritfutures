// =============================================================================
// packages/tooling/checks/repairable-sites.mjs
// =============================================================================
// A REPAIR LIST IS NOT A REPAIR BACKLOG UNTIL SOMETHING HAS SAID WHICH OF ITS
// SITES ARE ELIGIBLE, AND THIS IS THAT SOMETHING.
//
//   node packages/tooling/checks/repairable-sites.mjs <path:line> [<path:line> ...]
//   node packages/tooling/checks/repairable-sites.mjs --list <file-of-sites>
//   node packages/tooling/checks/repairable-sites.mjs --at <ref> <path:line> ...
//
// `ADR-471` section 9 item 1 is the whole of the motivation and it is quoted
// rather than paraphrased:
//
//   "A REPAIR LIST IS NOT A REPAIR BACKLOG UNTIL SOMETHING HAS SAID WHICH OF
//    ITS SITES ARE ELIGIBLE, AND NOTHING DOES. Seven of the thirteen sites in
//    this row's dispatch were string literals that no repair may touch, and the
//    dispatch, the ALLOCATION row and ADR-469 all carried them as one
//    undifferentiated list."
//
// THE COST THAT ENTRY PAID IS THE REASON THIS EXISTS. `ADR-469` section 10 item
// 1 published thirteen `file:line` sites as owed. Row 471 opened them one at a
// time and found that seven were string literals: five the bodies of files a
// case writes into a temporary tree, and two the finding text an `expect`
// asserts. No repair may touch any of the seven, and the entry that published
// them could not tell, because a line-indexed sweep reads a LINE and not what
// the line IS. Most of a session's framing went on discovering that.
//
// -----------------------------------------------------------------------------
// WHAT IT ANSWERS, AND THE THING IT DELIBERATELY DOES NOT
// -----------------------------------------------------------------------------
// IT ANSWERS: MAY A REPAIR TOUCH THIS LINE AT ALL. It does not answer whether
// the pointer on the line is dead, whether the sentence around it is true, or
// whether deleting a number would improve it. Those are `ADR-467` section 9's
// USE-against-MENTION question, which that entry rules is not mechanically
// decidable over Merit prose, and they stay a human judgement.
//
// ELIGIBILITY IS A THIRD AXIS AND IT IS DECIDABLE. `ADR-467` section 9 ruled
// that USE against MENTION is not decidable and that ADJACENT against
// NON-ADJACENT is. COMMENT against LITERAL is a third: it costs one call to a
// reader this repository already ships, and it separates the sites a row may
// work on from the sites a row would be changing a test by touching.
//
// -----------------------------------------------------------------------------
// THE TEST, AND WHY `stripComments` IS EXACTLY THE RIGHT READER
// -----------------------------------------------------------------------------
// A line is run through `./strip-comments.mjs` WITH THE WHOLE FILE AROUND IT,
// and the surviving text at that same line index is compared with the raw line.
// That reader is `ADR-279`'s one-state scanner and its own header states the two
// properties this depends on: it PRESERVES STRING LITERALS and it PRESERVES
// NEWLINES. So a site that vanishes from its own line index was a comment, and a
// site that stays was code. Nothing here re-implements a scanner, which is
// `RI-30`'s rule about a ninth copy.
//
// -----------------------------------------------------------------------------
// SEVEN VERDICTS, AND ONLY ONE OF THEM SAYS YES
// -----------------------------------------------------------------------------
//   COMMENT  the line's whole content is comment. ELIGIBLE
//   MIXED    code with a comment after it. The pointer may be in either half,
//            so it is NOT eligible on this evidence and is handed back for
//            adjudication rather than waved through
//   CODE     the line survives whole. A seed, a `write` argument, an expected
//            finding, an assertion. INELIGIBLE, and this is the seven
//   BLANK    the index carries nothing. Usually the mark of a list that went
//            stale before anybody opened it
//   RANGE    the index is past the end of the file
//   ABSENT   no such file
//   OPAQUE   the file is not one this reader models. NOT eligible, NOT
//            ineligible, UNCLASSIFIED
//
// OPAQUE IS THE LOAD-BEARING ONE AND IT IS WHY THIS IS NOT AN ABSENCE CHECK
// WEARING A VERDICT'S CLOTHES. `stripComments` models the JavaScript family and
// nothing else. A `file:line` into a `.md`, a `.sql` or a `.yml` is a site this
// instrument HAS NO OPINION ABOUT, and the one thing it must never do is report
// such a site as eligible because no comment was found in a file it cannot read.
// That is `ADR-274`'s warned defect class, and `strip-comments.mjs`'s own header
// names it: an absence check over an emptied file goes GREEN and nobody looks.
//
// -----------------------------------------------------------------------------
// WHY THIS IS AN INSTRUMENT AND NOT A GATE
// -----------------------------------------------------------------------------
// It is run WHEN A LIST IS COMPILED, by the row compiling it, and its output
// goes into the entry that publishes the list. It is not registered in `CHECKS`,
// it mints no `RI-nn`, and it scans no tree of its own.
//
// A gate asserting that published pointer lists name only comment lines would
// have to read the corpus, and the corpus's published lists sit in DATED
// RECORDS. `ADR-386:169` rules that a pointer in a dated record is NAMED rather
// than repaired, so such a gate would ship red on findings no commit is
// permitted to close, and `ADR-450` section 6's second ground is that a gate
// whose findings may not be discharged is a gate somebody deletes. The list
// this instrument exists for is the one being WRITTEN, and at that moment it is
// not yet a record and it is still free.
//
// WHAT IT CANNOT SEE, WRITTEN DOWN BEFORE ANYBODY ASKS:
//
//   A SITE WHOSE INDEX HAS MOVED. A published `file:line` is a claim about a
//   file at the instant it was written. Read against a later worktree it may
//   land anywhere, and this instrument will faithfully classify whatever is
//   there NOW. `--at <ref>` reads the blob at the ref the list was compiled
//   against, which is the only reading under which the answer is about the site
//   the author meant. Section 2 of ADR-473 is what happens without it.
//
//   WHICH HALF OF A MIXED LINE THE POINTER IS ON. A one-line answer would need
//   the pointer text, and a list of `file:line` does not carry it.
//
//   WHETHER A COMMENT SITE SHOULD BE REPAIRED. It says a repair is PERMITTED,
//   never that one is warranted. `ADR-471` section 4 adjudicated 28 comment
//   sites and repaired three.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripComments } from './strip-comments.mjs';

/** The workspace root, three levels up from `packages/tooling/checks`. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Extensions `stripComments` models. Anything else is `OPAQUE`. */
export const READABLE = /\.(?:ts|tsx|mts|cts|mjs|cjs|js|jsx)$/;

/** The one verdict that permits a repair. */
export const ELIGIBLE = 'COMMENT';

/**
 * Every verdict, in the order a report lists them.
 *
 * @type {readonly Verdict[]}
 */
export const VERDICTS = ['COMMENT', 'MIXED', 'CODE', 'BLANK', 'RANGE', 'ABSENT', 'OPAQUE'];

/**
 * @typedef {'COMMENT' | 'MIXED' | 'CODE' | 'BLANK' | 'RANGE' | 'ABSENT' | 'OPAQUE'} Verdict
 * @typedef {{ path: string, line: number }} Site
 * @typedef {{ site: Site, verdict: Verdict, raw: string | null, kept: string | null }} Ruling
 */

/**
 * A `path:line` token as a decision entry publishes it, or `null`.
 *
 * Accepts the shapes the corpus actually writes: a bare `a/b/c.ts:151`, a
 * GitHub-style `a/b/c.ts#L151`, and either wrapped in backticks, square
 * brackets or a trailing comma, because a list pasted out of an entry carries
 * its punctuation with it. A trailing comma is the exact reason `ADR-469` did
 * not see its own fourteenth site.
 *
 * @param {string} token
 * @returns {Site | null}
 */
export function parseSite(token) {
  const trimmed = token
    .trim()
    .replace(/^[[`(]+/, '')
    .replace(/[\]`),.;]+$/, '');
  const match = /^(.+?)[:#]L?(\d+)$/.exec(trimmed);
  if (match === null) return null;
  const line = Number(match[2]);
  if (!Number.isInteger(line) || line < 1) return null;
  return { path: /** @type {string} */ (match[1]), line };
}

/**
 * Every line of one source text, classified, with the file stripped ONCE.
 *
 * The whole file goes through the reader together and always has to: a comment
 * is a span and not a line, and a line read on its own cannot tell an opener
 * inside a block from an opener inside a literal. A caller with a list over one
 * file wants this rather than a call per site, which is why it is exported.
 *
 * Index 0 of the result is line 1, as every published pointer in this corpus is
 * 1-indexed.
 *
 * @param {string} source
 * @returns {{ verdict: Verdict, raw: string, kept: string }[]}
 */
export function classifySource(source) {
  const raws = source.split('\n');
  const kepts = stripComments(source).split('\n');
  return raws.map((raw, i) => {
    const kept = kepts[i] ?? '';
    if (raw.trim() === '') return { verdict: /** @type {Verdict} */ ('BLANK'), raw, kept };
    if (kept.trim() === '') return { verdict: /** @type {Verdict} */ ('COMMENT'), raw, kept };
    if (kept.trimEnd() === raw.trimEnd())
      return { verdict: /** @type {Verdict} */ ('CODE'), raw, kept };
    return { verdict: /** @type {Verdict} */ ('MIXED'), raw, kept };
  });
}

/**
 * The verdict for one line index of one source text.
 *
 * `line` is 1-indexed. A caller classifying many sites in one file should reach
 * for `classifySource` instead: this strips the whole file on every call.
 *
 * @param {string} source
 * @param {number} line
 * @returns {{ verdict: Verdict, raw: string, kept: string }}
 */
export function classifyLine(source, line) {
  return classifySource(source)[line - 1] ?? { verdict: 'RANGE', raw: '', kept: '' };
}

/**
 * Read one path, either out of the worktree or out of a git ref.
 *
 * A ref read is `git show <ref>:<path>` and it is how a list compiled at one
 * commit is classified against the file the author was looking at. It returns
 * `null` when the blob is not in this clone, which on a shallow clone is not
 * the same thing as the commit not existing.
 *
 * @param {string} path Repository-relative.
 * @param {{ root?: string, at?: string | null }} [options]
 * @returns {string | null}
 */
export function readSource(path, options = {}) {
  const { root = REPO_ROOT, at = null } = options;
  if (at !== null) {
    try {
      return execFileSync('git', ['-C', root, 'show', `${at}:${path}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch {
      return null;
    }
  }
  const full = isAbsolute(path) ? path : join(root, path);
  if (!existsSync(full) || !statSync(full).isFile()) return null;
  return readFileSync(full, 'utf8');
}

/**
 * The verdict for one published site.
 *
 * `read` is injectable so a suite can seed a file without writing a tree, and
 * so `--at` and the worktree take the same path through this function.
 *
 * @param {Site} site
 * @param {{ root?: string, at?: string | null, read?: (p: string) => string | null }} [options]
 * @returns {Ruling}
 */
export function classifySite(site, options = {}) {
  // ONE RULING PATH FOR ONE SITE AND FOR MANY. Two copies of the OPAQUE,
  // ABSENT and RANGE decisions is how they drift apart, and `RI-30`'s rule
  // about a ninth comment stripper is the same rule one level up.
  return /** @type {Ruling} */ (classify([site], options).rulings[0]);
}

/**
 * Every site of a published list, with the split.
 *
 * @param {readonly (string | Site)[]} sites
 * @param {{ root?: string, at?: string | null, read?: (p: string) => string | null }} [options]
 * @returns {{ rulings: Ruling[], counts: Record<Verdict, number>, eligible: number,
 *            ineligible: number, unclassified: number, unparsed: string[] }}
 */
export function classify(sites, options = {}) {
  /** @type {Ruling[]} */
  const rulings = [];
  /** @type {string[]} */
  const unparsed = [];
  // ONE STRIP PER FILE, NOT ONE PER SITE. A published list is usually many
  // sites in one file, and `ADR-469`'s was thirteen in one.
  /** @type {Map<string, ReturnType<typeof classifySource> | null>} */
  const cache = new Map();
  const read = options.read ?? ((p) => readSource(p, options));
  for (const entry of sites) {
    const site = typeof entry === 'string' ? parseSite(entry) : entry;
    if (site === null) {
      unparsed.push(/** @type {string} */ (entry));
      continue;
    }
    if (!READABLE.test(site.path)) {
      rulings.push({ site, verdict: 'OPAQUE', raw: null, kept: null });
      continue;
    }
    if (!cache.has(site.path)) {
      const source = read(site.path);
      cache.set(site.path, source === null ? null : classifySource(source));
    }
    const lines = cache.get(site.path);
    if (lines === null || lines === undefined) {
      rulings.push({ site, verdict: 'ABSENT', raw: null, kept: null });
      continue;
    }
    const at = lines[site.line - 1];
    if (at === undefined) rulings.push({ site, verdict: 'RANGE', raw: null, kept: null });
    else rulings.push({ site, verdict: at.verdict, raw: at.raw, kept: at.kept });
  }
  const counts = /** @type {Record<Verdict, number>} */ (
    Object.fromEntries(VERDICTS.map((v) => [v, 0]))
  );
  for (const r of rulings) counts[r.verdict] += 1;
  return {
    rulings,
    counts,
    eligible: counts.COMMENT,
    ineligible: counts.MIXED + counts.CODE + counts.BLANK + counts.RANGE + counts.ABSENT,
    unclassified: counts.OPAQUE,
    unparsed,
  };
}

/**
 * The one-line summary an entry transcribes into its own prose.
 *
 * @param {ReturnType<typeof classify>} result
 * @returns {string}
 */
export function summarise(result) {
  const parts = VERDICTS.filter((v) => result.counts[v] > 0).map((v) => `${result.counts[v]} ${v}`);
  const total = result.rulings.length;
  return (
    `${total} site(s): ${result.eligible} ELIGIBLE, ${result.ineligible} INELIGIBLE, ` +
    `${result.unclassified} UNCLASSIFIED` +
    (parts.length > 0 ? ` (${parts.join(', ')})` : '') +
    (result.unparsed.length > 0 ? `; ${result.unparsed.length} token(s) unparsed` : '')
  );
}

const USAGE = [
  'usage: node packages/tooling/checks/repairable-sites.mjs [--at <ref>] <path:line> ...',
  '       node packages/tooling/checks/repairable-sites.mjs [--at <ref>] --list <file>',
  '',
  'Run this WHEN A REPAIR LIST IS COMPILED, on the list, and put the split in the',
  'entry that publishes it. It says which sites a repair may touch. It does NOT say',
  'which pointers are dead: that is ADR-467 section 9 and it is not mechanical.',
  '',
  '--at <ref> reads each path at that git ref. A published file:line is a claim',
  'about a file at the instant it was written, and a list compiled at one commit',
  'and classified against a later worktree classifies whatever moved into place.',
];

/**
 * @param {string[]} argv
 * @param {(line: string) => void} emit
 * @returns {number} Process exit code.
 */
export function run(argv, emit = (line) => console.log(line)) {
  /** @type {string[]} */
  const tokens = [];
  /** @type {string | null} */
  let at = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = /** @type {string} */ (argv[i]);
    if (arg === '--at') {
      const ref = argv[i + 1];
      if (ref === undefined) {
        emit('ERROR  --at needs a ref');
        return 2;
      }
      at = ref;
      i += 1;
    } else if (arg === '--list') {
      const path = argv[i + 1];
      if (path === undefined) {
        emit('ERROR  --list needs a file');
        return 2;
      }
      let text;
      try {
        text = readFileSync(path, 'utf8');
      } catch (err) {
        emit(`ERROR  cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`);
        return 2;
      }
      tokens.push(...text.split(/\s+/).filter((t) => t.length > 0));
      i += 1;
    } else if (arg.startsWith('-')) {
      for (const line of USAGE) emit(line);
      return 2;
    } else {
      tokens.push(arg);
    }
  }

  if (tokens.length === 0) {
    for (const line of USAGE) emit(line);
    return 2;
  }

  const result = classify(tokens, { at });
  for (const ruling of result.rulings) {
    const mark = ruling.verdict === ELIGIBLE ? 'ELIGIBLE  ' : 'INELIGIBLE';
    const label = ruling.verdict === 'OPAQUE' ? 'UNCLASSIFD' : mark;
    const shown = (ruling.raw ?? '').trim();
    emit(
      `${label} ${ruling.verdict.padEnd(7)} ${ruling.site.path}:${ruling.site.line}` +
        (shown === '' ? '' : `  ${shown.length > 96 ? `${shown.slice(0, 93)}...` : shown}`),
    );
  }
  for (const token of result.unparsed) emit(`UNPARSED   ${token}`);
  emit('');
  emit(summarise(result));
  if (result.unclassified > 0) {
    emit(
      `       ${result.unclassified} site(s) are OPAQUE: this reader models the JavaScript ` +
        'family and has NO OPINION about them. They are not eligible and they are not ' +
        'ineligible, and reporting them as either would be the vacuous pass ' +
        'strip-comments.mjs was written to end.',
    );
  }
  return result.unparsed.length > 0 ? 1 : 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(run(process.argv.slice(2)));
