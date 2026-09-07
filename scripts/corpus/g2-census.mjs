// =============================================================================
// scripts/corpus/g2-census.mjs
// =============================================================================
// THE `G2` CENSUS, KEPT, BECAUSE FOUR ROWS HAVE NOW BUILT IT AND THROWN IT AWAY.
// ADR-388 classifies a wrong pointer by asking whether it was true at the commit
// that wrote the citing line. ADR-396 section 7 found that `git blame -w` answers
// that question wrongly on any line a later row restyled, and ruled the question
// be put to `git log -S` instead. ADR-400 priced the disagreement corpus-wide,
// ADR-401 re-ran the dated census under the corrected instrument, and each of
// them rebuilt this scaffolding inside a session and lost it at the end of it.
// This file is that scaffolding, kept, on the precedent `citation-fan-in.mjs`
// and `covers-census.mjs` set in this directory.
//
// IT IS AN INSTRUMENT AND NOT A GATE. It is registered in no `GATES` array, it
// mints no `RI-nn` and no `CI-06` letter, and it asserts nothing. There is no
// threshold at which a census is wrong: a corpus with a hundred born-wrong
// pointers is not failing a check, it is holding a price, and the decision that
// price informs belongs to the row paying it. A runner that failed on a number
// would be answering a question nobody asked.
//
// -----------------------------------------------------------------------------
// IT STATES ITS TRAVERSAL AND ITS SEARCH STRING, WHICH IS WHY IT EXISTS
// -----------------------------------------------------------------------------
// ADR-401 section 5 ruled that a row deriving `G2` by `git log -S` states its
// traversal and its search string, or its figure is not reproducible. That entry
// measured four defensible readings of ADR-396's one-sentence rule, and the
// `--first-parent` reading names a different commit for every pointer in the
// corpus. A rule naming a command is not a rule naming a measurement. So both
// halves are fixed here, in code rather than in prose:
//
//   TRAVERSAL     the DEFAULT walk, `git log -S<token> HEAD -- <citing file>`.
//                 Not `--first-parent`, which on a history whose merges are pull
//                 requests attributes every introduction to the merge commit;
//                 not `--full-history`, which ADR-401 measured moving three.
//   SEARCH STRING the BACKTICKED TOKEN AS THE CITING FILE WRITES IT, recovered
//                 from the citing line rather than synthesised. This is the leg
//                 ADR-401 caught itself getting wrong: the reader's `cited`
//                 field is target-plus-coordinate, which is NOT the string in
//                 the file wherever the pointer sits inside a markdown link, and
//                 searching it returned more undecidables in one scope than the
//                 whole corpus has.
//
// -----------------------------------------------------------------------------
// THREE INSTRUMENTS, PRINTED SIDE BY SIDE, BECAUSE THE DISAGREEMENT IS THE POINT
// -----------------------------------------------------------------------------
//   blame        `git blame -w` at the citing line. The instrument every row
//                used before ADR-396, kept so the correction stays visible.
//   -S oldest    ADR-396 section 7 as written: the OLDEST introducing commit.
//   -S surviving ADR-406: the NEWEST introducing commit whose first parent held
//                the token zero times. Where a coordinate was written, deleted
//                and rewritten, `oldest` names the commit that wrote a line
//                which no longer exists; this names the one that wrote the line
//                alive today. Where the token never went away the two agree, so
//                the rule is a refinement and not a replacement.
//
// -----------------------------------------------------------------------------
// A PATH THIS REPOSITORY NEVER TRACKED IS UNDECIDABLE AND NOT BORN WRONG
// -----------------------------------------------------------------------------
// ADR-274 cites a line of `pg`'s own `lib/client.js` for `getStartupConf`. That
// file is a dependency's source; it has never been in any tree here. Resolving
// it finds nothing, and a census reading "no candidate file" as "the pointer
// was false on the day it was written" convicts a citation of a defect no
// commit in this repository can establish. It may well have been exact in
// `node_modules` that day. Such a pointer is refused rather than decided.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const PACKAGE = 'packages/tooling';
const CHECKS = join(REPO_ROOT, PACKAGE, 'checks');

/** RI-15 and RI-16 read a name within this many lines of the cited range. */
const CITATION_WINDOW = 2;

/** The internals this runner borrows, appended to the copy as one export. */
const BORROWED = [
  'citationsIn',
  'citationReader',
  'citationTargets',
  'citedReasonFiles',
  'documentScope',
  'nearestName',
  'read',
];

/**
 * The checker's citation grammar, loaded from a copy that exports it.
 *
 * The whole directory travels, under its own manifest and at the path it already
 * occupies, because `REPO_ROOT` and `OWN_PACKAGE` are derived from the module's
 * location and a sibling imports it back. `citation-fan-in.mjs` records the two
 * failure modes that shape is avoiding.
 *
 * @returns {Promise<Record<string, Function>>}
 */
async function borrowGrammar() {
  const dir = mkdtempSync(join(tmpdir(), 'merit-g2-census-'));
  const pkg = join(dir, PACKAGE);
  const copy = join(pkg, 'checks/repo-invariants.mjs');
  cpSync(CHECKS, join(pkg, 'checks'), { recursive: true });
  cpSync(join(REPO_ROOT, PACKAGE, 'package.json'), join(pkg, 'package.json'));
  appendFileSync(copy, `\nexport { ${BORROWED.join(', ')} };\n`);
  try {
    return await import(pathToFileURL(copy).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** @type {(args: string[]) => string | null} */
const git = (args) => {
  try {
    return execFileSync('git', ['-C', REPO_ROOT, ...args], {
      encoding: 'utf8',
      maxBuffer: 1 << 30,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
};

/** `CITATION_TAIL`, reproduced so the pairing below reads the same tokens. */
const CITATION_TAIL = /:(\d+)(?:-(\d+))?((?:,\d+)+)?$/;

/**
 * The backticked token the citing line writes, for one emitted citation.
 *
 * THE PAIRING IS THE READER'S OWN AND NOT A REGEX, and the difference is not
 * cosmetic. A naive `/`([^`]+)`/g` sweep mispairs every line this corpus writes
 * as a name and a coordinate wrapped together in a double-backtick span holding
 * single-backticked tokens, and there are a dozen of them. So the scan here is
 * the one `citationsIn` documents: walk the backtick positions left to right,
 * read (k, k+1) as a token, and where that token is NOT a citation give its
 * closing backtick up to be the next token's opener. That is what keeps a
 * backtick used as an apostrophe -- or as the outer half of a double span --
 * from inverting every pairing after it.
 *
 * The reader emits one citation per NUMBER, so a comma list gives several
 * citations sharing one token; every one of them searches that whole token,
 * which is the string a diff actually added. Null where the line holds no token
 * ending in the coordinate, which is the inheritance case: the pointer was
 * written as a bare `:12` and its path came from a line above it. Such a
 * pointer has no search string, so `-S` refuses it rather than guessing one.
 *
 * AND THE TIE IS BROKEN ON THE TARGET AND NOT ON THE TOKEN, because a line that
 * cites two different files AT THE SAME LINE NUMBER is a real shape here and
 * picking the longer token silently searches the wrong file's history.
 *
 * @param {string} line  the citing line, verbatim
 * @param {{start: number, end: number, target: string}} c
 * @returns {string | null}
 */
function tokenOn(line, c) {
  const wanted = c.end === c.start ? `${c.start}` : `${c.start}-${c.end}`;
  /** @type {number[]} */
  const ticks = [];
  for (let i = line.indexOf('`'); i >= 0; i = line.indexOf('`', i + 1)) ticks.push(i);
  /** How well a token's own path half agrees with the target the reader resolved. */
  const agreement = (token) => {
    const path = token.slice(0, token.lastIndexOf(':'));
    if (path === '') return 1;
    if (path === c.target) return 3;
    if (c.target.endsWith(`/${path}`) || path.endsWith(`/${c.target}`)) return 2;
    return 0;
  };
  /** @type {string | null} */
  let best = null;
  let score = -1;
  for (let k = 0; k + 1 < ticks.length;) {
    const token = line.slice((ticks[k] ?? 0) + 1, ticks[k + 1] ?? 0);
    const tail = CITATION_TAIL.exec(token);
    if (tail === null) {
      k += 1;
      continue;
    }
    k += 2;
    const first = tail[2] === undefined ? `${tail[1]}` : `${tail[1]}-${tail[2]}`;
    const numbers = [first, ...(tail[3] ?? '').split(',').filter(Boolean)];
    if (!numbers.includes(wanted)) continue;
    const here = agreement(token);
    if (here > score || (here === score && best !== null && token.length > best.length)) {
      best = token;
      score = here;
    }
  }
  return best;
}

/**
 * Every named citation in the tree, in the three scopes the checks read.
 *
 * A citation with no name beside it is not in this population: `G2` asks whether
 * the cited line held THE NAMED SUBJECT, and a pointer that names nothing has no
 * subject to have held. That is RI-15's and RI-16's own `c.name === null` skip.
 *
 * @param {Record<string, Function>} g
 * @returns {any[]}
 */
function population(g) {
  const { tree } = g.citationReader(REPO_ROOT);
  /** @type {any[]} */
  const out = [];
  /** @type {(rel: string, c: any, scope: string) => void} */
  const take = (rel, c, scope) => {
    if (c.name === null) return;
    const line = g.read(REPO_ROOT, rel).split('\n')[c.at - 1] ?? '';
    out.push({ ...c, rel, scope, token: tokenOn(line, c) });
  };
  for (const rel of tree.filter((f) => f.startsWith('docs/') && f.endsWith('.md'))) {
    const { body, inRecord } = g.documentScope(g.read(REPO_ROOT, rel));
    for (const c of g.citationsIn(body, false))
      take(rel, c, inRecord[c.at - 1] === true ? 'dated' : 'live');
  }
  for (const rel of g.citedReasonFiles(tree))
    for (const c of g.citationsIn(g.read(REPO_ROOT, rel))) take(rel, c, 'source');
  return out;
}

/** A reader over one commit's tree, caching everything it touches. */
function historyReader() {
  /** @type {Map<string, string[]>} */
  const trees = new Map();
  /** @type {Map<string, string[] | null>} */
  const blobs = new Map();
  /** @type {Map<string, boolean>} */
  const untracked = new Map();
  /** @type {(sha: string) => string[]} */
  const treeAt = (sha) => {
    let t = trees.get(sha);
    if (t === undefined) {
      t = (git(['ls-tree', '-r', '--name-only', sha]) ?? '').split('\n').filter(Boolean);
      trees.set(sha, t);
    }
    return t;
  };
  /** @type {(sha: string, path: string) => string[] | null} */
  const linesAt = (sha, path) => {
    const k = `${sha}:${path}`;
    let v = blobs.get(k);
    if (v === undefined) {
      const out = git(['show', `${sha}:${path}`]);
      v = out === null ? null : out.split('\n');
      blobs.set(k, v);
    }
    return v;
  };
  /** @type {(c: any) => boolean} */
  const neverTracked = (c) => {
    const spec = c.href ?? c.target;
    let v = untracked.get(spec);
    if (v === undefined) {
      const out = git(['log', '--all', '--format=%H', '--max-count=1', '--', spec, `*/${spec}`]);
      v = out === null || out.trim() === '';
      untracked.set(spec, v);
    }
    return v;
  };
  return { treeAt, linesAt, neverTracked };
}

/**
 * Whether the pointer held its named subject in the tree at `sha`.
 *
 * Null means NOT DECIDABLE HERE, which today is one shape only: the cited path
 * has never been tracked in this repository at any commit on any ref.
 *
 * @returns {boolean | null}
 */
function holdsAt(H, g, sha, c) {
  const files = H.treeAt(sha);
  const spec = c.href ?? c.target;
  /** @type {string[]} */
  let found;
  if (c.href !== null || /^\.\.?\//.test(spec)) {
    const one = resolve(dirname(join(REPO_ROOT, c.rel)), spec).slice(REPO_ROOT.length + 1);
    found = files.includes(one) ? [one] : [];
  } else {
    found = files.filter((f) => f === spec || f.endsWith(`/${spec}`));
  }
  if (found.length === 0) return H.neverTracked(c) ? null : false;
  const reach = found.filter((f) => (H.linesAt(sha, f)?.length ?? 0) >= c.end);
  if (reach.length === 0) return false;
  const hit = g.nearestName(
    reach,
    (f) => H.linesAt(sha, f) ?? [],
    c.start,
    c.end,
    c.name.toLowerCase(),
  );
  return hit !== null && hit.away <= CITATION_WINDOW;
}

/** The commits `git log -S<token>` names over the citing file, newest first. */
function introductions(c) {
  if (c.token === null) return [];
  const out = git(['log', '--format=%H', `-S${c.token}`, 'HEAD', '--', c.rel]);
  return out === null ? [] : out.split('\n').filter(Boolean);
}

/**
 * The introduction that SURVIVES: the newest commit naming the token whose first
 * parent held it zero times. After that commit the token never went away, so it
 * is the commit that wrote the line standing today.
 */
function surviving(H, c, commits) {
  for (const sha of commits) {
    const parent = (git(['rev-parse', `${sha}^`]) ?? '').trim();
    const count = (sha2) => {
      let n = 0;
      for (const line of H.linesAt(sha2, c.rel) ?? []) {
        let i = line.indexOf(c.token);
        while (i >= 0) {
          n += 1;
          i = line.indexOf(c.token, i + 1);
        }
      }
      return n;
    };
    if ((parent === '' ? 0 : count(parent)) === 0 && count(sha) > 0) return sha;
  }
  return commits[commits.length - 1] ?? null;
}

const ORDER = /** @type {const} */ ([
  'nothing owed',
  'ONE repairable',
  'TWO born wrong',
  'false then, true now',
  'undecidable',
]);

/** @type {(H: any, g: any, c: any, sha: string | null) => string} */
function verdict(H, g, c, sha) {
  if (sha === null) return 'undecidable';
  const then = holdsAt(H, g, sha, c);
  if (then === null) return 'undecidable';
  if (then) return c.now ? 'nothing owed' : 'ONE repairable';
  return c.now ? 'false then, true now' : 'TWO born wrong';
}

function main(rows, label) {
  const cell = (k) => ORDER.map((o) => rows.filter((r) => r[k] === o).length);
  const a = cell('vBlame');
  const b = cell('vOldest');
  const d = cell('vSurviving');
  console.log(`\n  ${label}  (${rows.length} pointer(s))`);
  console.log('    verdict                    blame    -S oldest    -S surviving');
  ORDER.forEach((o, i) => {
    console.log(
      `    ${o.padEnd(23)}${String(a[i]).padStart(6)}${String(b[i]).padStart(13)}${String(d[i]).padStart(16)}`,
    );
  });
}

const g = await borrowGrammar();
const P = population(g);
// RULE 2: an empty population is a reader that has stopped reaching the corpus,
// not a corpus with no citations in it. It throws rather than reporting zero.
if (P.length === 0)
  throw new Error(
    'g2-census: the citation grammar returned NO named pointer in any of the three ' +
      'scopes. That is a reader that has stopped reaching this tree, and a census ' +
      'printed from it would read as a clean corpus. Fix the reader.',
  );

const H = historyReader();
for (const c of P) {
  c.now = holdsAt(H, g, 'HEAD', c) === true;
  const blamed = git(['blame', '-w', '-l', '-L', `${c.at},${c.at}`, 'HEAD', '--', c.rel]);
  c.blame = blamed === null ? null : (blamed.trim().split(/\s+/)[0] ?? '').replace(/^\^/, '');
  const commits = introductions(c);
  c.churn = commits.length;
  c.oldest = commits[commits.length - 1] ?? null;
  c.surviving = c.churn === 0 ? null : surviving(H, c, commits);
  c.vBlame = verdict(H, g, c, c.blame);
  c.vOldest = verdict(H, g, c, c.oldest);
  c.vSurviving = verdict(H, g, c, c.surviving);
}

console.log(
  `${P.length} named pointer(s), G2 derived three ways at ${git(['rev-parse', 'HEAD'])?.trim().slice(0, 8)}`,
);
main(P, 'ALL');
for (const s of ['dated', 'live', 'source'])
  main(
    P.filter((r) => r.scope === s),
    s.toUpperCase(),
  );

if (process.argv.includes('--holes')) {
  // HOLE ONE, on the key ADR-406 corrected: the same COORDINATE at more than one
  // distinct LINE of one file. Keying on (file, token) instead counts a comma
  // list -- one site writing several coordinates -- as a repeat, which it is not.
  /** @type {Map<string, Set<number>>} */
  const sites = new Map();
  for (const c of P) {
    const k = `${c.rel} ${c.cited}`;
    if (!sites.has(k)) sites.set(k, new Set());
    (sites.get(k) ?? new Set()).add(c.at);
  }
  const repeats = [...sites.entries()].filter(([, v]) => v.size > 1);
  const onRepeat = P.filter((c) => (sites.get(`${c.rel} ${c.cited}`)?.size ?? 0) > 1);
  const split = repeats.filter(([k]) => {
    const cs = P.filter((c) => `${c.rel} ${c.cited}` === k);
    return new Set(cs.map((c) => c.vBlame)).size > 1 || new Set(cs.map((c) => c.vOldest)).size > 1;
  });
  console.log('\n  HOLE ONE  a coordinate appearing twice in one file');
  console.log(`    coordinates written at more than one line of one file : ${repeats.length}`);
  console.log(`    pointers sitting on one                               : ${onRepeat.length}`);
  console.log(`    of those, sites that do NOT share one verdict         : ${split.length}`);

  const churned = P.filter((c) => c.churn > 1);
  const moved = P.filter((c) => c.vOldest !== c.vSurviving);
  console.log('\n  HOLE TWO  a citation written, deleted and rewritten');
  console.log(`    pointers whose token has more than one -S commit      : ${churned.length}`);
  console.log(
    `    of those, surviving names a different commit          : ${churned.filter((c) => c.surviving !== c.oldest).length}`,
  );
  console.log(`    pointers the surviving rule MOVES                     : ${moved.length}`);
  for (const c of moved)
    console.log(
      `      ${c.scope} ${c.rel}:${c.at}  ${c.cited}  \`${c.name}\`  ${c.vOldest} -> ${c.vSurviving}`,
    );
  console.log(
    `\n    verdict disagreements, blame vs -S oldest             : ${P.filter((c) => c.vBlame !== c.vOldest).length}`,
  );
  console.log(
    `    verdict disagreements, blame vs -S surviving          : ${P.filter((c) => c.vBlame !== c.vSurviving).length}`,
  );
  console.log(
    `    pointers with no introducing commit at all            : ${P.filter((c) => c.churn === 0).length}`,
  );
}
