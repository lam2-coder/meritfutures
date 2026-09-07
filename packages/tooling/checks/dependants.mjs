// -----------------------------------------------------------------------------
// WHAT DEPENDS ON A FILE, DERIVED RATHER THAN DEFINED
// -----------------------------------------------------------------------------
// ADR-422. THIS FILE EXISTS BECAUSE THREE ROWS IN A ROW ANSWERED "WHAT DEPENDS
// ON THIS FILE?" AND ALL THREE ANSWERS WERE SHORT, EACH BY EXACTLY THE WIDTH OF
// THE THING THAT HAD JUST BITTEN THE ROW BEFORE.
//
//   ADR-414 read the question as IMPORTS, found one consumer, and handed on
//   "retiring the pair is a coherent slice for a row holding both sides".
//
//   ADR-418 held both sides, re-derived that figure, found it TRUE, and found
//   the inference under it FALSE: a PATH STRING in a register is a dependant no
//   module graph reaches. It priced the retirement at three files.
//
//   ADR-419 took that price and found it was FIVE, because a DIRECTORY-WALK
//   MEMBERSHIP ASSERTION in a fourth describe block is a dependant that neither
//   an import scan nor a scan for uses of a named constant reaches.
//
// **THE PATTERN IS THE FINDING AND IT IS WHY THIS FILE IS NOT A GATE.** Each row
// widened the DEFINITION of "depends on" by the width of its own injury, and a
// definition widened that way is always exactly one kind short: the kind nobody
// has been bitten by yet. ADR-419 section 10 handed the problem on in those
// words, to `packages/tooling`, as "a bigger thing than a leg".
//
// -----------------------------------------------------------------------------
// THE ONE PROPERTY THIS MODULE IS BUILT AROUND
// -----------------------------------------------------------------------------
// **A CHECK THAT SILENTLY MISSES A KIND IS WORSE THAN NO CHECK AT ALL**, because
// silence is what let three rows each believe they held the whole list. So this
// module answers in three registers and never in one:
//
//   `sites`      what it FOUND, each attributed to a named kind
//   `undecided`  what it SAW AND COULD NOT RESOLVE, named individually
//   `BLIND`      what it CANNOT SEE AT ALL, written down before anybody asks
//
// A caller that reads `sites` and ignores the other two has reproduced ADR-418's
// error with better tooling. The CLI prints all three and the report carries all
// three, and `BLIND` is a written register rather than a computed one for the
// same reason `ABSENCE_ARTIFACTS` is: a blind spot nobody wrote down is a blind
// spot nobody can be held to.
//
// -----------------------------------------------------------------------------
// USAGE
// -----------------------------------------------------------------------------
//   node packages/tooling/checks/dependants.mjs apps/api/src/events.ts
//   node packages/tooling/checks/dependants.mjs --kinds
//   node packages/tooling/checks/dependants.mjs --blind
//
// The exit code is 0 whenever the derivation RAN. This module reports; it does
// not judge. Nothing in this tree states a policy about what may depend on what,
// and inventing one here so that the module could exit 1 would be minting a
// control nobody asked for, which ADR-275 refused on ADR-274's precedent.
// -----------------------------------------------------------------------------

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { stripComments } from './strip-comments.mjs';

/** The workspace root, three levels up from `packages/tooling/checks`. */
const HERE = dirname(new URL(import.meta.url).pathname);
export const REPO_ROOT = resolve(HERE, '../../..');

/** Never walked. The same set `absence-claims.mjs` skips, for the same reason. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next']);

/** Files whose comments must be stripped before anything is read out of them. */
const SOURCE = /\.(ts|tsx|mts|cts|mjs|cjs|js|jsx)$/;

/** Files read as data rather than as code: a literal in one is just its text. */
const DATA = /\.(json|jsonc)$/;

/** Files that carry prose about the tree and never load it. */
const PROSE = /\.(md|txt|ya?ml|sql|sh)$/;

/** Extensions a specifier may omit, in the order a TypeScript ESM resolver tries. */
const IMPLICIT = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx'];

// -----------------------------------------------------------------------------
// THE KIND REGISTER. Written, never computed.
// -----------------------------------------------------------------------------

/**
 * @typedef {'import' | 'path-literal' | 'enumeration' | 'config-glob' | 'prose'} KindId
 * @typedef {{ id: KindId, breaks: 'delete' | 'move' | 'neither', found: string, what: string }} Kind
 * @typedef {{ kind: KindId, file: string, detail: string, dated?: boolean, retention?: Retention }} Site
 * @typedef {{ file: string, detail: string, why: string, near: boolean }} Undecided
 */

/**
 * Every kind of dependence this module can see, and the row that discovered it.
 *
 * **`found` IS PART OF THE REGISTER AND NOT DECORATION.** The whole argument of
 * ADR-422 is that this list grew one entry at a time, each entry paid for by a
 * row that lost a day to it, and a reader deciding whether the list is complete
 * needs to see that history rather than a tidy taxonomy.
 *
 * @type {Kind[]}
 */
export const KINDS = [
  {
    id: 'import',
    breaks: 'delete',
    found: 'ADR-414, and it was the whole of that row`s definition',
    what:
      'A module specifier that RESOLVES to the target: a static `import`, an ' +
      '`export ... from`, a dynamic `import()` or a `require()`. Spelled ' +
      'relatively or through a workspace package name. Invisible to any search ' +
      'for the target`s repo-relative path, because a relative specifier does ' +
      'not contain it: the worker`s replay-adapter suite reaches the ' +
      'compatibility module ADR-410 left behind, and the module`s own path does ' +
      'not occur anywhere in that suite.',
  },
  {
    id: 'path-literal',
    breaks: 'delete',
    found: 'ADR-418, on the `site` field of an `RI-35` register entry',
    what:
      'The target`s repo-relative path inside a STRING LITERAL of a source or ' +
      'data file, comments stripped. A check that opens the file, a test`s ' +
      '`OLD_PATH` constant, a registry row, an assertion that names the path ' +
      'outright. Invisible to every module graph. ADR-418 traced this kind ' +
      'through the named CONSTANT and so missed the site that spells the ' +
      'literal in place, which is what cost ADR-419 its second measurement.',
  },
  {
    id: 'enumeration',
    breaks: 'delete',
    found: 'ADR-419, on a directory-walk membership assertion',
    what:
      'A file that READS A DIRECTORY containing the target and depends on what ' +
      'the walk returns. It may name no path to the target at all: an assertion ' +
      'that a walk of a deployable`s sources yields more than twenty files ' +
      'depends on every one of them and mentions none. This is population ' +
      'dependence and it is the first kind here that a text search cannot ' +
      'express. IT REPORTS REACH AND NOT RETENTION: a walk that returns the ' +
      'target and whose caller then filters it out by extension is still ' +
      'reported, because dropping a site on a filter that LOOKED like it ' +
      'excluded the file is the confident short answer this module refuses. ' +
      'ADR-427 ADDS A `retention` TIER RATHER THAN A FILTER: each site carries ' +
      '`selected`, `excluded`, `unfiltered` or `unreadable`, derived by testing ' +
      'the target`s real bytes against the CONTENT predicates the reporting ' +
      'file applies to the walk`s answer. **NO SITE IS DROPPED BY IT AND NO ' +
      'COUNT MOVES**, and `excluded` means a deletion is not felt through those ' +
      'predicates while a CHANGE to the target`s bytes would be, which is a ' +
      'negative dependence and still a dependence.',
  },
  {
    id: 'config-glob',
    breaks: 'move',
    found:
      'ADR-422, and NO ROW HAS BEEN BITTEN BY IT YET, which is the reason it ' +
      'is written down here before one is',
    what:
      'A GLOB in a build or check configuration that MATCHES the target: a ' +
      '`tsconfig.json` `include`, an `eslint.config.js` `files`, the ' +
      '`format:check` glob in the root manifest. It names no file and no ' +
      'directory read happens. **IT DOES NOT BREAK ON DELETION AND THAT IS ' +
      'WHY IT IS DANGEROUS.** A file MOVED out of every glob that reached it ' +
      'stops being typechecked, linted and formatted, and every gate stays ' +
      'green, which is the direction the comment stripper beside this file ' +
      'calls the worst a defect can fail in. ADR-410 MOVED the producer this ' +
      'estate has spent five rows on, so the operation that would fire this ' +
      'kind is exactly the operation that started the chain.',
  },
  {
    id: 'prose',
    breaks: 'neither',
    found: 'ADR-414, whose entire body was sixteen sentences of it',
    what:
      'The target`s path in a COMMENT, or anywhere in a document. Nothing ' +
      'breaks and nothing goes red; the sentence merely becomes false. ADR-414 ' +
      'was a whole row spent repairing this kind after ADR-410 moved one file, ' +
      'so it is a cost even though it is not a break. Sites under a DATED ' +
      'record are flagged `dated` and are NOT a cost: [ADR-386] rules a pointer ' +
      'in a dated record is named and never repaired.',
  },
];

/**
 * Kinds of dependence this module CANNOT SEE, written down rather than left to
 * be discovered by the row they bite.
 *
 * **THIS ARRAY IS THE POINT OF THE MODULE.** An instrument that reports only
 * what it found is an instrument whose user infers completeness from silence,
 * and that inference is the exact mistake ADR-414, ADR-418 and ADR-419 each
 * made in turn. Anything added to this list is a kind somebody may not assume
 * away; anything REMOVED from it must be moved into `KINDS` with a detector
 * behind it, and `dependants.test.ts` asserts that every entry here carries a
 * reason so that an entry cannot be quietly emptied into a one-word stub.
 *
 * @type {{ id: string, what: string }[]}
 */
export const BLIND = [
  {
    id: 'transitive',
    what:
      'DIRECT dependants only. If A imports B and B imports the target, this ' +
      'module names B and never A. The transitive closure is a different ' +
      'question and answering it by default would let a caller read a short ' +
      'list as "nothing else is affected", which is the failure this module ' +
      'exists to stop rather than to relocate. **AN INSTANCE OF THIS WAS ' +
      'MEASURED RATHER THAN IMAGINED:** ADR-422 section 6 deleted the ' +
      'compatibility module in a throwaway worktree and a FIFTH suite went red ' +
      'that names its path nowhere, imports nothing from it, and enumerates no ' +
      'directory holding it. It asserts that every invariant holds, and one ' +
      'invariant reads the register that names the path. `closure()` and the ' +
      '`--hops=` flag answer this when it is asked for, and ADR-427 makes every ' +
      'ordinary run report HOW MANY files the second hop would add, so a caller ' +
      'reading the default is told the size of what it is short by rather than ' +
      'left to infer it is short by nothing.',
  },
  {
    id: 'by-symbol',
    what:
      'Dependence on a NAME rather than on a FILE. A consumer that takes ' +
      '`EVENT_NAMES` from a barrel depends on whichever module declares it, ' +
      'and this module resolves the barrel and stops there. "What breaks if I ' +
      'delete this file" and "what breaks if I rename this export" are ' +
      'different questions and only the first is answered here.',
  },
  {
    id: 'runtime-path',
    what:
      'A path ASSEMBLED at run time from data: read out of a JSON fixture, a ' +
      'SQL row, an environment variable, or joined from fragments no constant ' +
      'folder can put back together. Every such site that reaches a directory ' +
      'read is reported in `undecided` rather than dropped; one that reaches a ' +
      'FILE read is invisible here.',
  },
  {
    id: 'partial-spelling',
    what:
      'A literal that names the target by anything but its repo-relative path: ' +
      'a basename, a suffix such as `src/events.ts`, an extensionless form, or ' +
      'a path relative to some base the reader holds. Widening the match to ' +
      'catch these would return the whole tree on a common basename, so the ' +
      'narrow reading is deliberate and is a hole.',
  },
  {
    id: 'content-quote',
    what:
      'A file that quotes or asserts the target`s CONTENT without naming its ' +
      'path. `RI-35``s anchored sentence is carried by two files and bound at ' +
      'one of them by a marker; a reader searching for the path finds neither ' +
      'relationship.',
  },
  {
    id: 'generated-span',
    what:
      'A span written into a document by `gates.mjs generate` from a query ' +
      'over the tree. The document depends on the population and carries no ' +
      'code, so neither the import scan nor the enumeration folder sees it.',
  },
  {
    id: 'untracked',
    what:
      'When the population comes from `git ls-files`, a file present on disk ' +
      'and not tracked is not read. The report names which population method ' +
      'was used so this is visible rather than assumed.',
  },
];

// -----------------------------------------------------------------------------
// THE POPULATION
// -----------------------------------------------------------------------------

/**
 * Every file this derivation reads, and HOW the list was obtained.
 *
 * **`git ls-files` IS PREFERRED AND THE REASON IS ADR-419 SECTION 6.** That row
 * re-derived a register's figure with a walk it wrote itself, got three verdicts
 * wrong, and recorded the lesson that a figure re-derived by a second reader is
 * a figure about the second reader. The tree's own index is not a second reader.
 * A synthetic tree is not a git work tree, so the walk is kept as a fallback and
 * the method is REPORTED rather than assumed by the caller.
 *
 * @param {string} root
 * @returns {{ files: string[], method: 'git ls-files' | 'directory walk' }}
 */
export function population(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
    const files = out.split('\0').filter((f) => f.length > 0);
    if (files.length > 0) return { files, method: 'git ls-files' };
  } catch {
    // Not a work tree, or no git. The walk below is the answer, and the caller
    // is told which one it got.
  }
  /** @type {string[]} */
  const out = [];
  walk(root, '', out);
  return { files: out.sort(), method: 'directory walk' };
}

/**
 * Depth-first walk, repo-relative, `SKIP_DIRS` pruned.
 *
 * @param {string} root
 * @param {string} dir
 * @param {string[]} out
 * @returns {string[]}
 */
function walk(root, dir, out) {
  const here = dir === '' ? root : join(root, dir);
  for (const entry of readdirSync(here)) {
    if (SKIP_DIRS.has(entry)) continue;
    const rel = dir === '' ? entry : `${dir}/${entry}`;
    if (statSync(join(root, rel)).isDirectory()) walk(root, rel, out);
    else out.push(rel);
  }
  return out;
}

/**
 * Read a file, returning `null` rather than throwing when it cannot be read as
 * text. A binary blob in the population is not a dependant and is not an error.
 *
 * @param {string} root
 * @param {string} rel
 * @returns {string | null}
 */
function readText(root, rel) {
  try {
    const text = readFileSync(join(root, rel), 'utf8');
    return text.includes('\u0000') ? null : text;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// PATH ARITHMETIC, POSIX AND REPO-RELATIVE THROUGHOUT
// -----------------------------------------------------------------------------

/**
 * Normalise a repo-relative path: forward slashes, no `.`, `..` resolved, no
 * leading or trailing separator. Returns `null` when the path escapes the root,
 * because a dependant outside the tree is not a dependant this module can name.
 *
 * @param {string} path
 * @returns {string | null}
 */
export function normalise(path) {
  /** @type {string[]} */
  const out = [];
  for (const seg of path.split('\\').join('/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join('/');
}

/**
 * Whether `dir` contains `file`, with `deep` deciding whether nesting counts.
 *
 * @param {string} dir  repo-relative, `''` for the root
 * @param {string} file  repo-relative
 * @param {boolean} deep
 * @returns {boolean}
 */
function contains(dir, file, deep) {
  const prefix = dir === '' ? '' : `${dir}/`;
  if (!file.startsWith(prefix)) return false;
  const rest = file.slice(prefix.length);
  return deep ? rest.length > 0 : !rest.includes('/');
}

/** @param {string} rel @returns {string} */
function parentOf(rel) {
  const cut = rel.lastIndexOf('/');
  return cut === -1 ? '' : rel.slice(0, cut);
}

// -----------------------------------------------------------------------------
// KIND 1: THE MODULE GRAPH
// -----------------------------------------------------------------------------

/** Every specifier shape a resolver in this tree honours. */
const SPECIFIER = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*(['"])([^'"\n]+)\1/g;

/**
 * The workspace's package name to directory map, read from every manifest in
 * the population rather than from `pnpm-workspace.yaml`, so that a package the
 * workspace file does not glob is still resolved.
 *
 * @param {string} root
 * @param {string[]} files
 * @returns {Map<string, string>}
 */
function packageDirs(root, files) {
  /** @type {Map<string, string>} */
  const dirs = new Map();
  for (const rel of files) {
    if (!rel.endsWith('package.json')) continue;
    const text = readText(root, rel);
    if (text === null) continue;
    try {
      const parsed = /** @type {{ name?: unknown }} */ (JSON.parse(text));
      if (typeof parsed.name === 'string') dirs.set(parsed.name, parentOf(rel));
    } catch {
      // A manifest that does not parse is a different defect and not this one.
    }
  }
  return dirs;
}

/**
 * Candidate files a specifier could name, in resolver order.
 *
 * `.js` IS TRIED AS `.ts` BECAUSE THIS TREE IS ESM TYPESCRIPT, where a source
 * file importing `./x.js` means `./x.ts` on disk. A resolver that did not do
 * this would report a suite as importing nothing.
 *
 * @param {string} base  repo-relative, extension included or not
 * @returns {string[]}
 */
function candidates(base) {
  const out = [base];
  for (const ext of IMPLICIT) out.push(`${base}${ext}`);
  for (const ext of IMPLICIT) out.push(`${base}/index${ext}`);
  const swap = base.match(/^(.*)\.(js|mjs|cjs|jsx)$/);
  if (swap !== null) {
    for (const ext of ['.ts', '.mts', '.cts', '.tsx']) out.push(`${swap[1]}${ext}`);
  }
  return out;
}

/**
 * The file a specifier resolves to, or `null`.
 *
 * @param {string} spec
 * @param {string} fromDir  repo-relative directory of the importing file
 * @param {Map<string, string>} pkgs
 * @param {Set<string>} present
 * @returns {string | null}
 */
function resolveSpecifier(spec, fromDir, pkgs, present) {
  /** @type {string | null} */
  let base = null;
  if (spec.startsWith('.')) {
    base = normalise(`${fromDir}/${spec}`);
  } else {
    // Longest package name first: `@merit/db` must not swallow `@merit/db-x`.
    const names = [...pkgs.keys()].sort((a, b) => b.length - a.length);
    for (const name of names) {
      if (spec !== name && !spec.startsWith(`${name}/`)) continue;
      const sub = spec.slice(name.length);
      const dir = /** @type {string} */ (pkgs.get(name));
      base = sub === '' ? `${dir}/src/index` : normalise(`${dir}${sub}`);
      break;
    }
  }
  if (base === null) return null;
  for (const candidate of candidates(base)) if (present.has(candidate)) return candidate;
  return null;
}

// -----------------------------------------------------------------------------
// KIND 2: A PATH IN A STRING LITERAL
// -----------------------------------------------------------------------------

/**
 * Every string-literal span in already-stripped source, as text without quotes.
 *
 * A TEMPLATE LITERAL IS RETURNED WHOLE, substitutions and all, because a
 * template that carries the target path around a `${...}` still carries the
 * path. What it must not do is span the whole file, so an unterminated quote
 * ends at its own newline.
 *
 * @param {string} stripped
 * @returns {string[]}
 */
export function literals(stripped) {
  /** @type {string[]} */
  const out = [];
  const re = /'([^'\n\\]*(?:\\.[^'\n\\]*)*)'|"([^"\n\\]*(?:\\.[^"\n\\]*)*)"|`([^`]*)`/g;
  for (const m of stripped.matchAll(re)) out.push(m[1] ?? m[2] ?? m[3] ?? '');
  return out;
}

// -----------------------------------------------------------------------------
// KIND 3: A DIRECTORY READ THAT REACHES THE TARGET
// -----------------------------------------------------------------------------

/** The directory-reading calls this tree makes. */
const ENUMERATOR = /\b(readdirSync|readdir|opendirSync|opendir|globSync|glob)\s*\(/g;

/** A binding this module can fold, at any scope depth. */
const BINDING =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]*(?:\n(?![\s]*(?:const|let|var|function|class|export|import)\b)[^;\n]*)*)/g;

/**
 * Fold a source expression to a PATH FRAGMENT, or `null`.
 *
 * **THIS IS DELIBERATELY A SMALL FOLDER AND NOT AN EVALUATOR.** It knows string
 * literals, `join`, `resolve`, template literals whose substitutions are named
 * bindings, and the spellings this tree uses to name its own location, and it
 * follows a binding by name to a bounded depth. Everything else returns `null`,
 * and every `null` at an enumeration call site is REPORTED as undecided rather
 * than skipped. A folder that guessed would produce the one result this module
 * may not produce, which is a confident short list.
 *
 * **IT RETURNS A FRAGMENT AND NOT A NORMALISED PATH**, because `'..'` is a
 * perfectly good argument to `join` and normalising each part in turn would
 * make `join(ROOT, '..', '..')` unfoldable while `join(ROOT, '../..')` folded.
 * The caller normalises once, at the end, where the whole path is known.
 *
 * @param {string} expr
 * @param {string} fileDir  repo-relative directory of the file being read
 * @param {Map<string, string>} bindings
 * @param {number} depth
 * @returns {string | null}
 */
export function foldFragment(expr, fileDir, bindings, depth = 0) {
  if (depth > 12) return null;
  const text = expr.trim();

  const quoted = text.match(/^'([^']*)'$|^"([^"]*)"$/);
  if (quoted !== null) return quoted[1] ?? quoted[2] ?? '';

  const tpl = text.match(/^`([^`]*)`$/);
  if (tpl !== null) {
    const body = /** @type {string} */ (tpl[1]);
    if (!body.includes('${')) return body;
    let out = '';
    let rest = body;
    for (;;) {
      const open = rest.indexOf('${');
      if (open === -1) {
        out += rest;
        break;
      }
      out += rest.slice(0, open);
      const close = rest.indexOf('}', open);
      if (close === -1) return null;
      const inner = foldFragment(rest.slice(open + 2, close), fileDir, bindings, depth + 1);
      if (inner === null) return null;
      out += inner;
      rest = rest.slice(close + 1);
    }
    return out;
  }

  // The spellings of "the directory this file is in", and one of the root.
  if (/^import\.meta\.dirname$/.test(text)) return fileDir;
  if (/^__dirname$/.test(text)) return fileDir;
  if (/^process\.cwd\(\)$/.test(text)) return '';
  const url = text.match(
    /^fileURLToPath\(\s*new URL\(\s*['"]([^'"]*)['"]\s*,\s*import\.meta\.url\s*\)\s*\)$/,
  );
  if (url !== null) return `${fileDir}/${url[1]}`;
  if (/^(?:path\.)?dirname\(\s*fileURLToPath\(\s*import\.meta\.url\s*\)\s*\)$/.test(text)) {
    return fileDir;
  }
  if (/^fileURLToPath\(\s*import\.meta\.url\s*\)$/.test(text)) return fileDir;

  const call = text.match(/^(?:path\.)?(join|resolve)\s*\(([\s\S]*)\)$/);
  if (call !== null) {
    const parts = splitArgs(/** @type {string} */ (call[2]));
    if (parts === null) return null;
    /** @type {string[]} */
    const acc = [];
    for (const part of parts) {
      const folded = foldFragment(part, fileDir, bindings, depth + 1);
      if (folded === null) return null;
      // `resolve` discards everything left of an absolute segment. `join` does
      // not, and an absolute segment there is a path outside the tree either way.
      if (folded.startsWith('/')) {
        if (call[1] !== 'resolve') return null;
        acc.length = 0;
      }
      acc.push(folded);
    }
    // AN EMPTY SEGMENT IS THE REPOSITORY ROOT AND NOT A LEADING SLASH.
    // `join(ROOT, 'apps')` where `ROOT` folded to `''` is `apps`, and joining
    // the empty string in would produce `/apps`, which the caller then reads as
    // a path outside the tree and refuses to fold at all.
    return acc.filter((part) => part !== '').join('/');
  }

  if (/^[A-Za-z_$][\w$]*$/.test(text) && bindings.has(text)) {
    return foldFragment(/** @type {string} */ (bindings.get(text)), fileDir, bindings, depth + 1);
  }
  return null;
}

/**
 * `foldFragment` normalised to a repo-relative directory, or `null` when it did
 * not fold or when it names somewhere outside the tree.
 *
 * @param {string} expr
 * @param {string} fileDir
 * @param {Map<string, string>} bindings
 * @returns {string | null}
 */
export function foldDir(expr, fileDir, bindings) {
  const fragment = foldFragment(expr, fileDir, bindings, 0);
  if (fragment === null || fragment.startsWith('/')) return null;
  return normalise(fragment);
}

/**
 * Split a call's argument list at top-level commas. `null` when the parentheses
 * or quotes do not balance, which is a fold this module refuses rather than
 * guesses at.
 *
 * @param {string} text
 * @returns {string[] | null}
 */
export function splitArgs(text) {
  /** @type {string[]} */
  const out = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote !== '') {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
    if (depth < 0) return null;
  }
  if (depth !== 0 || quote !== '') return null;
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * The argument text of a call whose opening parenthesis is at `open`, and the
 * whole call's text. `null` when the call does not close.
 *
 * @param {string} text
 * @param {number} open  index of `(`
 * @returns {{ args: string, whole: string } | null}
 */
function callAt(text, open) {
  let depth = 0;
  let quote = '';
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (quote !== '') {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        return { args: text.slice(open + 1, i), whole: text.slice(open + 1, i) };
      }
    }
  }
  return null;
}

/** @param {string} text @returns {Map<string, string>} */
function bindingsIn(text) {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const m of text.matchAll(BINDING)) {
    const name = /** @type {string} */ (m[1]);
    if (!out.has(name)) out.set(name, /** @type {string} */ (m[2]));
  }
  return out;
}

/**
 * Whether a file recurses through directories under its own power: a named
 * function whose body calls itself, or an explicit `recursive: true`.
 *
 * A NON-RECURSIVE READ OF A GRANDPARENT DIRECTORY DOES NOT REACH THE TARGET,
 * and saying it does would put most of this tree in every answer. Saying it
 * never does would miss the walker idiom this repository writes everywhere, so
 * both are derived and the reason is carried into the site's detail.
 *
 * @param {string} stripped
 * @returns {boolean}
 */
function walksDeep(stripped) {
  if (/recursive\s*:\s*true/.test(stripped)) return true;
  for (const m of stripped.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = /** @type {string} */ (m[1]);
    const rest = stripped.slice(/** @type {number} */ (m.index) + m[0].length);
    if (new RegExp(`\\b${name}\\s*\\(`).test(rest)) return true;
  }
  for (const m of stripped.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g,
  )) {
    const name = /** @type {string} */ (m[1]);
    const rest = stripped.slice(/** @type {number} */ (m.index) + m[0].length);
    if (new RegExp(`\\b${name}\\s*\\(`).test(rest)) return true;
  }
  return false;
}

/**
 * The value expression beginning at `from`: everything up to the comma or
 * closing bracket that ends it at depth zero.
 *
 * @param {string} text
 * @param {number} from
 * @returns {string | null}
 */
function expressionAt(text, from) {
  let depth = 0;
  let quote = '';
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    if (quote !== '') {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return text.slice(from, i).trim();
      depth -= 1;
    } else if (ch === ',' && depth === 0) return text.slice(from, i).trim();
  }
  return null;
}

/**
 * The span of a `{ ... }` block whose opening brace is at or after `from`.
 *
 * @param {string} text
 * @param {number} from
 * @returns {{ start: number, end: number } | null}
 */
function blockAt(text, from) {
  const open = text.indexOf('{', from);
  if (open === -1) return null;
  let depth = 0;
  let quote = '';
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (quote !== '') {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return { start: open, end: i };
    }
  }
  return null;
}

/**
 * Locally defined functions that ENUMERATE ONE OF THEIR OWN PARAMETERS, and
 * which parameter it is.
 *
 * **THIS IS THE IDIOM THIS TREE ACTUALLY WRITES AND WITHOUT IT THE ENUMERATION
 * KIND BARELY WORKS HERE.** ADR-419's own finding, the membership assertion in
 * `event-placement.test.ts`, is spelled `walk(join(APP, 'src'), ...)` around a
 * `readdirSync(dir)` whose `dir` is a parameter. A folder that stopped at the
 * `readdirSync` would report that call undecided and the file`s real subject
 * unseen, which is the same shape of miss the three rows before this one made.
 *
 * **ADR-427 RECORDS THE EXPRESSION RATHER THAN A POSITION INSIDE IT.** The first
 * version read only the FIRST argument of a `join`, so a walker spelled
 * `readdirSync(join(ROOT, dir))` around a parameter `dir` was not recognised at
 * all and its read was counted against the standing figure for what the kind
 * cannot aim. Keeping the whole argument expression and folding it at the call
 * site with the parameter bound to what was passed handles both spellings with
 * one rule and adds no second reading of any of them.
 *
 * @param {string} stripped
 * @returns {Map<string, { param: string, expr: string, decl: number, start: number, end: number }>}
 */
function walkerFunctions(stripped) {
  /** @type {Map<string, { param: string, expr: string, decl: number, start: number, end: number }>} */
  const out = new Map();
  const decl =
    /(?:function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\()/g;
  for (const m of stripped.matchAll(decl)) {
    const name = m[1] ?? m[2];
    if (name === undefined || out.has(name)) continue;
    const open = /** @type {number} */ (m.index) + m[0].length - 1;
    const signature = callAt(stripped, open);
    if (signature === null) continue;
    const params = (splitArgs(signature.args) ?? []).map((prm) =>
      (prm.split('=')[0] ?? '').replace(/:.*$/, '').trim(),
    );
    const body = blockAt(stripped, open + signature.args.length + 2);
    if (body === null) continue;
    const text = stripped.slice(body.start, body.end);
    let taken = false;
    for (const call of text.matchAll(ENUMERATOR)) {
      if (taken) break;
      const at = /** @type {number} */ (call.index) + call[0].length - 1;
      const inner = callAt(text, at);
      if (inner === null) continue;
      const first = (splitArgs(inner.args) ?? [])[0];
      if (first === undefined) continue;
      // ANY parameter MENTIONED in the directory expression makes this a walker,
      // wherever in that expression it stands.
      for (const param of params) {
        if (param === '' || !new RegExp(`\\b${param}\\b`).test(first)) continue;
        out.set(name, {
          param,
          expr: first.trim(),
          decl: /** @type {number} */ (m.index),
          start: body.start,
          end: body.end,
        });
        taken = true;
        break;
      }
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// KIND 3, SECOND REGISTER: WHAT THE CALLER DOES WITH THE WALK'S ANSWER
// -----------------------------------------------------------------------------
// ADR-427. ADR-422 section 11 handed on that `enumeration` has a precision of
// **1 in 18** against the red set on its own test target and that the module
// offers NO WAY TO TELL REACH FROM RETENTION, and it named modelling the
// caller's filter as *the first place this module could go quiet*.
//
// **THE TIER BELOW IS NOT A FILTER AND THAT DISTINCTION IS THE WHOLE DESIGN.**
// Nothing here can remove a site, shorten a list or change a count. It attaches
// a WORD to a site that is reported either way, exactly as the `near` tier
// attaches one to an `undecided` entry without dropping a single one of the 171.
// A tier that is wrong costs a reader one wasted look. A filter that is wrong
// costs a reader the file, and that is the asymmetry ADR-422 was pointing at.
//
// **ONLY CONTENT PREDICATES ARE READ, AND THE REASON IS THAT THEY CANNOT BE
// SELECTION.** A directory walk in this tree selects on an entry's NAME: an
// extension, a prefix, a skip set. It never selects on an entry's BYTES, because
// the walk has not opened the file yet. So a predicate over a file's CONTENT is
// always applied DOWNSTREAM of the walk, to the walk's answer, which is the one
// place where reach and retention actually differ. Reading name predicates as
// well would need this module to decide which side of the walk each one sits on,
// and deciding that wrong in the quiet direction is the failure ADR-422 named.
//
// **THE BIAS IS STATED RATHER THAN TUNED: ANYTHING THIS MODULE CANNOT FOLD
// COUNTS AS SENSITIVE.** A predicate it does not recognise, a target it cannot
// read, a regular expression it will not build: every one of them yields
// `unfiltered`, which is the tier that claims the least. `excluded` is reachable
// only when a predicate WAS folded and the target's real bytes were tested
// against it and failed.
// -----------------------------------------------------------------------------

/**
 * @typedef {'unfiltered' | 'selected' | 'excluded' | 'unreadable'} Retention
 */

/** Calls that yield a file's TEXT, before any locally declared reader is added. */
const READERS = ['readFileSync', 'readFile'];

/**
 * The names in `stripped` that return a file's text: the built-in readers, plus
 * any locally declared function whose head calls one.
 *
 * **A HELPER CALLED `read` IS THE IDIOM THIS TREE WRITES** and a predicate
 * spelled over it is invisible to a scan that knows only the built-in name.
 *
 * @param {string} stripped
 * @returns {Set<string>}
 */
export function readerNames(stripped) {
  const out = new Set(READERS);
  const decl =
    /(?:function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|[A-Za-z_$][\w$]*\s*=>))/g;
  for (const m of stripped.matchAll(decl)) {
    const name = m[1] ?? m[2];
    if (name === undefined || out.has(name)) continue;
    // **THE DECLARATION'S OWN BODY, AND A SHORT ONE.** A helper that returns a
    // file's text is one line; a WALKER that happens to read a file somewhere
    // inside it is not a reader, and calling it one would invent a content
    // predicate over its result. An invented predicate the target fails is the
    // one way this tier could claim `excluded` where nothing excludes anything,
    // so the bound is deliberate and is stated rather than tuned.
    const body = declarationBody(stripped, /** @type {number} */ (m.index));
    if (body === null || body.length > 400) continue;
    if (READERS.some((r) => new RegExp(`\\b${r}\\s*\\(`).test(body))) out.add(name);
  }
  return out;
}

/**
 * The body of a declaration beginning at `from`: a braced block, or the rest of
 * the line for an expression arrow. `null` when neither is there.
 *
 * @param {string} stripped
 * @param {number} from
 * @returns {string | null}
 */
function declarationBody(stripped, from) {
  const open = stripped.indexOf('(', from);
  const arrow = stripped.indexOf('=>', from);
  const lineEnd = stripped.indexOf('\n', from);
  const brace = stripped.indexOf('{', from);
  if (brace !== -1 && (open === -1 || brace > open) && (lineEnd === -1 || brace < lineEnd)) {
    const block = blockAt(stripped, brace);
    if (block !== null) return stripped.slice(block.start, block.end + 1);
  }
  if (arrow !== -1 && (lineEnd === -1 || arrow < lineEnd)) {
    return stripped.slice(arrow, lineEnd === -1 ? stripped.length : lineEnd);
  }
  return null;
}

/**
 * A regular expression written as a literal, or bound to a name that folds to
 * one, or `null` when this module will not build it.
 *
 * @param {string} token
 * @param {Map<string, string>} bindings
 * @param {number} depth
 * @returns {RegExp | null}
 */
export function foldRegExp(token, bindings, depth = 0) {
  if (depth > 4) return null;
  const text = token.trim();
  const literal = text.match(/^\/((?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+)\/([a-z]*)$/);
  if (literal !== null) {
    try {
      return new RegExp(/** @type {string} */ (literal[1]), /** @type {string} */ (literal[2]));
    } catch {
      // A pattern this runtime will not compile is one this module does not fold.
      return null;
    }
  }
  if (/^[A-Za-z_$][\w$]*$/.test(text) && bindings.has(text)) {
    return foldRegExp(/** @type {string} */ (bindings.get(text)), bindings, depth + 1);
  }
  return null;
}

/**
 * Every predicate in `stripped` that tests a FILE'S CONTENT and that this module
 * can fold, each as a test over the bytes of a candidate file.
 *
 * Three shapes, and they are the three this tree writes:
 *
 *     RE.test(read(file))            a regular expression over the text
 *     read(file).includes(LITERAL)   a substring of the text
 *     read(file).match(RE)           the same question spelled the other way
 *
 * A fourth shape is deliberately absent: a predicate whose subject this module
 * cannot see is not guessed at, it is simply not returned, and a file with no
 * returned predicates is reported `unfiltered`.
 *
 * @param {string} stripped
 * @param {Map<string, string>} bindings
 * @param {string} fileDir
 * @returns {{ source: string, test: (text: string) => boolean }[]}
 */
export function contentPredicates(stripped, bindings, fileDir) {
  const readers = readerNames(stripped);
  const anyReader = new RegExp(`\\b(?:${[...readers].join('|')})\\s*\\(`);
  /** @type {{ source: string, test: (text: string) => boolean }[]} */
  const out = [];

  // `RE.test(<anything that reads a file>)`.
  for (const m of stripped.matchAll(
    /(\/(?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+\/[a-z]*|[A-Za-z_$][\w$]*)\s*\.\s*test\s*\(/g,
  )) {
    const open = /** @type {number} */ (m.index) + m[0].length - 1;
    const call = callAt(stripped, open);
    if (call === null || !anyReader.test(call.args)) continue;
    const re = foldRegExp(/** @type {string} */ (m[1]), bindings);
    if (re === null) continue;
    out.push({ source: `\`${m[1]}\` over the file`, test: (text) => re.test(text) });
  }

  // `<read>(...).includes(LITERAL)` and `<read>(...).match(RE)`.
  for (const name of readers) {
    for (const m of stripped.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))) {
      const open = /** @type {number} */ (m.index) + m[0].length - 1;
      const call = callAt(stripped, open);
      if (call === null) continue;
      const after = stripped.slice(open + call.args.length + 2);
      const chained = after.match(/^\s*\.\s*(includes|match|search)\s*\(/);
      if (chained === null) continue;
      const inner = callAt(after, /** @type {number} */ (chained.index) + chained[0].length - 1);
      if (inner === null) continue;
      const arg = inner.args.trim();
      if (chained[1] === 'includes') {
        const needle = foldFragment(arg, fileDir, bindings, 0);
        if (needle === null || needle === '') continue;
        out.push({
          source: `\`includes(${arg.slice(0, 60)})\``,
          test: (text) => text.includes(needle),
        });
        continue;
      }
      const re = foldRegExp(arg, bindings);
      if (re === null) continue;
      out.push({ source: `\`${chained[1]}(${arg.slice(0, 60)})\``, test: (text) => re.test(text) });
    }
  }
  return out;
}

/**
 * Which side of a file's own content predicates the target falls on.
 *
 * **`excluded` DOES NOT MEAN "NOT A DEPENDANT" AND THE CLI SAYS SO ON EVERY
 * RUN.** It means the walk reaches the target and every content predicate this
 * file applies to the walk's answer drops it, so a DELETION is not felt through
 * those predicates while a CHANGE to the target's bytes would be. That is a
 * negative dependence and it is still a dependence: the assertion under it is
 * green BECAUSE of what the target does not contain, which is a property a
 * reader may not assume is stable.
 *
 * @param {{ source: string, test: (text: string) => boolean }[]} predicates
 * @param {string | null} targetText
 * @returns {Retention}
 */
export function retentionOf(predicates, targetText) {
  if (predicates.length === 0) return 'unfiltered';
  if (targetText === null) return 'unreadable';
  return predicates.some((p) => p.test(targetText)) ? 'selected' : 'excluded';
}

/**
 * The positional index of a walker's directory parameter in its own signature.
 *
 * @param {string} stripped
 * @param {{ param: string, decl: number }} walker
 * @returns {number}
 */
function walkerParamIndex(stripped, walker) {
  const open = stripped.indexOf('(', walker.decl);
  if (open === -1) return -1;
  const signature = callAt(stripped, open);
  if (signature === null) return -1;
  return (splitArgs(signature.args) ?? [])
    .map((prm) => (prm.split('=')[0] ?? '').replace(/:.*$/, '').trim())
    .indexOf(walker.param);
}

/**
 * Whether a file with an unresolved directory read PLAUSIBLY reaches the target.
 *
 * **THIS IS WHAT MAKES THE UNDECIDED LIST READABLE INSTEAD OF MERELY HONEST.**
 * An unresolved `readdirSync(dir)` could in principle reach anything, so the
 * bare list of them is a repository-wide figure rather than an answer about one
 * target. The rule is stated rather than tuned: a file is NEAR when it names,
 * as a folded binding or as a plain literal, a directory that CONTAINS the
 * target and is at least two segments deep, or when the file itself already
 * yielded a site of another kind for this target.
 *
 * **THE TWO-SEGMENT FLOOR IS THE WHOLE OF THE JUDGEMENT AND IT IS A HOLE.**
 * Without it every file carrying the literal `'apps'`, or an empty string, is
 * near everything under `apps`, and the tier stops sorting anything. With it, a
 * file that walks the target`s directory through a route this module cannot
 * fold AND never names anything more specific than `apps` is reported as
 * `near: false` and is countable but not pointed at. That residue is
 * `unresolvedEnumerations` and it is printed on every run for exactly this
 * reason: it is the part of the enumeration kind this module concedes it cannot
 * aim, and a reader who needs certainty about one file reads the file.
 *
 * @param {string} stripped
 * @param {string} fileDir
 * @param {Map<string, string>} bindings
 * @param {string} target
 * @returns {boolean}
 */
function reachesTarget(stripped, fileDir, bindings, target) {
  /** @param {string | null} dir @returns {boolean} */
  const specific = (dir) =>
    dir !== null && dir.split('/').length >= 2 && contains(dir, target, true);
  if (specific(fileDir)) return true;
  for (const value of bindings.values()) {
    if (specific(foldDir(value, fileDir, bindings))) return true;
  }
  for (const lit of literals(stripped)) {
    if (lit.includes('/') && specific(normalise(lit))) return true;
  }
  return false;
}

// -----------------------------------------------------------------------------
// KIND 4: A GLOB IN A CONFIGURATION
// -----------------------------------------------------------------------------

/**
 * A glob as a regular expression, `**` crossing separators and `*` not.
 *
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i] ?? '';
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // `**/` may match nothing at all, which is why the separator is folded in.
        if (glob[i + 2] === '/') {
          out += '(?:[^/]+/)*';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else out += '[^/]*';
      continue;
    }
    if (ch === '?') {
      out += '[^/]';
      continue;
    }
    if (ch === '{') {
      const close = glob.indexOf('}', i);
      if (close !== -1) {
        const alts = glob.slice(i + 1, close).split(',');
        out += `(?:${alts.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`;
        i = close;
        continue;
      }
    }
    out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/**
 * A list of glob patterns computed by an expression, or `null` when this module
 * will not fold it.
 *
 * ADR-427. ADR-422 section 11 handed on that the test runner's configuration
 * COMPUTES its include lists and that **nothing in this tree can currently say
 * which files that configuration reaches**. This folds the four spellings that
 * configuration actually uses and refuses everything else:
 *
 *     ['a', 'b']                     an array of literals
 *     NAME                           a binding holding one of these
 *     [...A, ...B]                   spreads of bindings
 *     ARR.map((p) => `${p}/x`)       a map to a template over the element
 *     f('lit')                       a call to a bound arrow returning one
 *
 * **A REFUSAL HERE IS STILL AN UNDECIDED ENTRY AND NEVER AN ABSENCE**, which is
 * the only property that makes folding safe to attempt at all: a fold that fails
 * leaves the configuration exactly where ADR-422 left it, named on every run.
 *
 * @param {string} expr
 * @param {Map<string, string>} bindings
 * @param {number} depth
 * @returns {string[] | null}
 */
export function foldGlobList(expr, bindings, depth = 0) {
  if (depth > 8) return null;
  const text = expr.trim();

  const array = text.match(/^\[([\s\S]*)\]$/);
  if (array !== null) {
    const parts = splitArgs(/** @type {string} */ (array[1]));
    if (parts === null) return null;
    /** @type {string[]} */
    const out = [];
    for (const part of parts) {
      const item = part.trim();
      if (item === '') continue;
      const spread = item.match(/^\.\.\.([\s\S]*)$/);
      const folded =
        spread !== null
          ? foldGlobList(/** @type {string} */ (spread[1]), bindings, depth + 1)
          : (() => {
              const one = foldFragment(item, '', bindings, 0);
              return one === null ? null : [one];
            })();
      if (folded === null) return null;
      out.push(...folded);
    }
    return out;
  }

  // `ARR.map((p) => BODY)`, the spelling that made this configuration undecided.
  const mapped = text.match(/^([\s\S]+?)\s*\.\s*map\s*\(([\s\S]*)\)$/);
  if (mapped !== null) {
    const source = foldGlobList(/** @type {string} */ (mapped[1]), bindings, depth + 1);
    if (source === null) return null;
    const arrow = /** @type {string} */ (mapped[2]).match(
      /^\s*(?:\(\s*([A-Za-z_$][\w$]*)[^)]*\)|([A-Za-z_$][\w$]*))\s*=>\s*([\s\S]*)$/,
    );
    if (arrow === null) return null;
    const param = arrow[1] ?? arrow[2];
    const body = /** @type {string} */ (arrow[3]);
    if (param === undefined) return null;
    /** @type {string[]} */
    const out = [];
    for (const element of source) {
      // An element carrying a quote or a newline is not substituted, because the
      // literal this builds to stand in for it would no longer be one.
      if (/['"`\n\\]/.test(element)) return null;
      const scope = new Map(bindings);
      scope.set(param, `'${element}'`);
      const one = foldFragment(body, '', scope, 0);
      if (one === null) return null;
      out.push(one);
    }
    return out;
  }

  // `f('lit')` where `f` is a bound arrow whose body folds to a list.
  const call = text.match(/^([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)$/);
  if (call !== null && bindings.has(/** @type {string} */ (call[1]))) {
    const arrow = /** @type {string} */ (bindings.get(/** @type {string} */ (call[1]))).match(
      /^\s*(?:\(\s*([A-Za-z_$][\w$]*)[^)]*\)|([A-Za-z_$][\w$]*))\s*=>\s*([\s\S]*)$/,
    );
    const args = splitArgs(/** @type {string} */ (call[2]));
    if (arrow !== null && args !== null && args.length === 1) {
      const param = arrow[1] ?? arrow[2];
      const argument = foldFragment(/** @type {string} */ (args[0]), '', bindings, 0);
      if (param !== undefined && argument !== null && !/['"`\n\\]/.test(argument)) {
        const scope = new Map(bindings);
        scope.set(param, `'${argument}'`);
        return foldGlobList(/** @type {string} */ (arrow[3]), scope, depth + 1);
      }
    }
    return null;
  }

  if (/^[A-Za-z_$][\w$]*$/.test(text) && bindings.has(text)) {
    return foldGlobList(/** @type {string} */ (bindings.get(text)), bindings, depth + 1);
  }
  return null;
}

/**
 * Glob patterns a configuration file states, each resolved against the
 * directory that configuration is read from.
 *
 * **THE CONFIGURATIONS ARE NAMED RATHER THAN SNIFFED.** A pattern list this
 * module found by guessing at shapes would go quiet the day somebody renamed a
 * field, and quiet is the failure mode this whole module is written against.
 * `vitest.config.ts` computes its include lists from a `SOURCES` array through
 * `.map`, which this module cannot fold, so it is reported as UNDECIDED and is
 * not silently absent.
 *
 * @param {string} root
 * @param {string[]} files
 * @returns {{ globs: { file: string, field: string, pattern: string, base: string }[], undecided: { file: string, detail: string, why: string }[] }}
 */
function configGlobs(root, files) {
  /** @type {{ file: string, field: string, pattern: string, base: string }[]} */
  const globs = [];
  /** @type {{ file: string, detail: string, why: string }[]} */
  const undecided = [];

  for (const rel of files) {
    const base = parentOf(rel);
    const name = rel.slice(base === '' ? 0 : base.length + 1);

    if (/^tsconfig(\..+)?\.json$/.test(name)) {
      const text = readText(root, rel);
      if (text === null) continue;
      let parsed;
      try {
        parsed = /** @type {Record<string, unknown>} */ (JSON.parse(stripComments(text)));
      } catch {
        undecided.push({ file: rel, detail: 'include/exclude', why: 'the manifest did not parse' });
        continue;
      }
      for (const field of ['include', 'exclude', 'files']) {
        const value = parsed[field];
        if (!Array.isArray(value)) continue;
        for (const pattern of value) {
          if (typeof pattern === 'string') globs.push({ file: rel, field, pattern, base });
        }
      }
      continue;
    }

    if (rel === 'package.json' && base === '') {
      const text = readText(root, rel);
      if (text === null) continue;
      /** @type {{ scripts?: Record<string, unknown> }} */
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        continue;
      }
      for (const [script, body] of Object.entries(parsed.scripts ?? {})) {
        if (typeof body !== 'string') continue;
        for (const m of body.matchAll(/"([^"]*[*{][^"]*)"/g)) {
          globs.push({
            file: rel,
            field: `scripts.${script}`,
            pattern: /** @type {string} */ (m[1]),
            base: '',
          });
        }
      }
      continue;
    }

    if (rel === 'eslint.config.js') {
      const text = readText(root, rel);
      if (text === null) continue;
      const stripped = stripComments(text);
      for (const m of stripped.matchAll(/\b(files|ignores)\s*:\s*\[([^\]]*)\]/g)) {
        const field = /** @type {string} */ (m[1]);
        for (const lit of literals(/** @type {string} */ (m[2]))) {
          globs.push({ file: rel, field, pattern: lit, base: '' });
        }
      }
      continue;
    }

    if (rel === 'vitest.config.ts') {
      const text = readText(root, rel);
      if (text === null) continue;
      const stripped = stripComments(text);
      const bindings = bindingsIn(stripped);
      // ADR-427. EVERY `include` AND `exclude` IS FOLDED OR NAMED, ONE BY ONE.
      // The old reading asked whether ANY include was computed and declared the
      // whole configuration undecided on the answer, so a list this module could
      // read was lost beside one it could not.
      for (const m of stripped.matchAll(/\b(include|exclude)\s*:\s*/g)) {
        const field = /** @type {string} */ (m[1]);
        const from = /** @type {number} */ (m.index) + m[0].length;
        const value = expressionAt(stripped, from);
        const folded = value === null ? null : foldGlobList(value, bindings, 0);
        if (folded === null) {
          undecided.push({
            file: rel,
            detail: `test.projects[].${field}`,
            why: 'the pattern list is computed by an expression this module does not fold',
          });
          continue;
        }
        for (const pattern of folded) globs.push({ file: rel, field, pattern, base: '' });
      }
    }
  }
  return { globs, undecided };
}

// -----------------------------------------------------------------------------
// KIND 5: PROSE, AND WHICH OF IT IS DATED
// -----------------------------------------------------------------------------

/**
 * Whether a document is a DATED RECORD, whose pointers ADR-386 rules are named
 * and never repaired.
 *
 * @param {string} rel
 * @returns {boolean}
 */
export function isDatedRecord(rel) {
  if (rel.startsWith('docs/sessions/')) return true;
  if (/^docs\/decisions\/ADR-[\w-]+\.md$/.test(rel)) return true;
  if (/^docs\/reviews\/\d{4}-\d{2}-\d{2}-/.test(rel)) return true;
  return false;
}

// -----------------------------------------------------------------------------
// THE DERIVATION
// -----------------------------------------------------------------------------

/**
 * Everything in `root` that depends on `target`, partitioned by kind, with what
 * could not be resolved named beside it.
 *
 * @param {string} root
 * @param {string} target  repo-relative path of the file being asked about
 * @returns {{
 *   target: string,
 *   exists: boolean,
 *   population: { files: number, method: string },
 *   sites: Site[],
 *   undecided: Undecided[],
 *   unresolvedEnumerations: number,
 *   aliases: string[],
 * }}
 */
export function dependantsOf(root, target) {
  const normalised = normalise(target);
  if (normalised === null || normalised === '') {
    throw new Error(
      `dependants: \`${target}\` does not name a file inside the tree. A target outside the ` +
        'root has no dependants this module could enumerate, and returning an empty list for ' +
        'it would be the confident short answer this module exists to refuse',
    );
  }
  const { files, method } = population(root);
  if (files.length === 0) {
    throw new Error(
      'dependants: the population is EMPTY. Every kind below would report nothing over an ' +
        'empty tree and the report would be indistinguishable from a file nothing depends on',
    );
  }
  const present = new Set(files);
  const pkgs = packageDirs(root, files);
  const targetDir = parentOf(normalised);
  // READ ONCE, HERE. Every content predicate below is tested against the
  // target's REAL bytes rather than against a guess about them, and a target
  // this module cannot read yields the tier that claims the least.
  const targetText = readText(root, normalised);

  /** @type {Site[]} */
  const sites = [];
  /** @type {Undecided[]} */
  const undecided = [];
  let unresolvedEnumerations = 0;

  for (const rel of files) {
    if (rel === normalised) continue;
    const text = readText(root, rel);
    if (text === null) continue;
    const fileDir = parentOf(rel);

    if (SOURCE.test(rel)) {
      const stripped = stripComments(text);

      for (const m of stripped.matchAll(SPECIFIER)) {
        const spec = /** @type {string} */ (m[2]);
        if (resolveSpecifier(spec, fileDir, pkgs, present) === normalised) {
          sites.push({ kind: 'import', file: rel, detail: `specifier \`${spec}\`` });
        }
      }

      for (const lit of literals(stripped)) {
        if (lit.includes(normalised)) {
          sites.push({
            kind: 'path-literal',
            file: rel,
            detail: `literal \`${lit.slice(0, 120)}\``,
          });
        }
      }

      const bindings = bindingsIn(stripped);
      const deep = walksDeep(stripped);
      const enumFrom = sites.length;
      const walkers = walkerFunctions(stripped);
      /** @type {{ detail: string }[]} */
      const pending = [];
      for (const m of stripped.matchAll(ENUMERATOR)) {
        const open = /** @type {number} */ (m.index) + m[0].length - 1;
        // A read INSIDE a recognised walker is accounted for at that walker's
        // call sites below. Counting it here as well would report one hole twice
        // and inflate the figure this module offers as the size of its blind spot.
        if ([...walkers.values()].some((w) => open > w.start && open < w.end)) continue;
        const call = callAt(stripped, open);
        if (call === null) {
          unresolvedEnumerations += 1;
          pending.push({ detail: `\`${m[1]}(\` whose call does not close` });
          continue;
        }
        const args = splitArgs(call.args);
        const first = args === null || args.length === 0 ? null : (args[0] ?? null);
        const dir = first === null ? null : foldDir(first, fileDir, bindings);
        if (dir === null) {
          unresolvedEnumerations += 1;
          pending.push({ detail: `\`${m[1]}(${(first ?? '').slice(0, 80)})\`` });
          continue;
        }
        if (dir === targetDir || contains(dir, normalised, deep)) {
          sites.push({
            kind: 'enumeration',
            file: rel,
            detail:
              `\`${m[1]}\` over \`${dir === '' ? '.' : dir}\`` +
              (dir === targetDir ? '' : ', reached by a recursive walk'),
          });
        }
      }

      // The same question asked one call deep: a local walker takes the
      // directory as a parameter, so the directory is at the walker's CALL SITE.
      for (const [name, walker] of walkers) {
        const paramIndex = walkerParamIndex(stripped, walker);
        for (const call of stripped.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))) {
          const at = /** @type {number} */ (call.index);
          if (at > walker.start && at < walker.end) continue;
          // THE DECLARATION IS NOT A CALL SITE. Counting it as one reported a
          // parameter list as a directory read that did not fold, which is a
          // read that never happened inflating the figure this module publishes
          // as the size of its own blind spot.
          if (at <= walker.decl && at + call[0].length > walker.decl) continue;
          if (at >= walker.decl && at < walker.start) continue;
          const inner = callAt(stripped, at + call[0].length - 1);
          if (inner === null) continue;
          const passed = paramIndex === -1 ? undefined : (splitArgs(inner.args) ?? [])[paramIndex];
          if (passed === undefined) continue;
          // Fold the walker's OWN directory expression with its parameter bound
          // to what this call site passed, so `join(ROOT, dir)` resolves here.
          const scope = new Map(bindings);
          scope.set(walker.param, passed);
          const dir = foldDir(walker.expr, fileDir, scope);
          if (dir === null) {
            unresolvedEnumerations += 1;
            pending.push({ detail: `\`${name}(${passed.slice(0, 60)})\`, a local walker` });
            continue;
          }
          if (dir === targetDir || contains(dir, normalised, deep)) {
            sites.push({
              kind: 'enumeration',
              file: rel,
              detail: `the local walker \`${name}\` over \`${dir === '' ? '.' : dir}\``,
            });
          }
        }
      }
      // ADR-427. THE TIER IS ATTACHED AFTER BOTH PASSES AND ADDS NO SITE AND
      // REMOVES NONE. `sites` is the answer; `retention` is advice about how to
      // read one entry of it, and a reader who ignores it is left exactly where
      // ADR-422 left them rather than anywhere worse.
      const mine = sites.slice(enumFrom).filter((site) => site.kind === 'enumeration');
      if (mine.length > 0) {
        const tier = retentionOf(contentPredicates(stripped, bindings, fileDir), targetText);
        for (const site of mine) site.retention = tier;
      }

      if (pending.length > 0) {
        const near =
          sites.some((site) => site.file === rel && site.kind !== 'prose') ||
          reachesTarget(stripped, fileDir, bindings, normalised);
        for (const p of pending) {
          undecided.push({
            file: rel,
            detail: p.detail,
            why: 'the directory argument did not fold to a repo-relative path',
            near,
          });
        }
      }
      continue;
    }

    if (DATA.test(rel)) {
      for (const lit of literals(text)) {
        if (lit.includes(normalised)) {
          sites.push({
            kind: 'path-literal',
            file: rel,
            detail: `literal \`${lit.slice(0, 120)}\``,
          });
        }
      }
      continue;
    }

    if (PROSE.test(rel) && text.includes(normalised)) {
      const count = text.split(normalised).length - 1;
      sites.push({
        kind: 'prose',
        file: rel,
        detail: `${count} mention(s)`,
        dated: isDatedRecord(rel),
      });
      continue;
    }

    // A source file's COMMENTS are prose too, and the stripped pass above threw
    // them away on purpose. This is the second reading of the same file and it
    // is deliberate: ADR-414 spent a whole row on exactly these sentences.
  }

  // The comment half of kind 5, read back over the source files.
  for (const rel of files) {
    if (rel === normalised || !SOURCE.test(rel)) continue;
    const text = readText(root, rel);
    if (text === null || !text.includes(normalised)) continue;
    const stripped = stripComments(text, { literals: 'blank' });
    const inCode = stripped.split(normalised).length - 1;
    const total = text.split(normalised).length - 1;
    if (total > inCode) {
      sites.push({
        kind: 'prose',
        file: rel,
        detail: `${total - inCode} mention(s) in comments`,
        dated: isDatedRecord(rel),
      });
    }
  }

  const { globs, undecided: configUndecided } = configGlobs(root, files);
  for (const g of globs) {
    // A pattern is relative to the directory its configuration is read from, so
    // `apps/api/tsconfig.json`'s `src/**/*.ts` is asked about `src/events.ts`
    // and never about the repo-relative path. Matching the repo-relative path
    // against a package-relative pattern is how a glob check reports nothing.
    const subject =
      g.base === ''
        ? normalised
        : normalised.startsWith(`${g.base}/`)
          ? normalised.slice(g.base.length + 1)
          : null;
    if (subject === null) continue;
    if (globToRegExp(g.pattern).test(subject)) {
      sites.push({
        kind: 'config-glob',
        file: g.file,
        detail: `${g.field} pattern \`${g.pattern}\``,
      });
    }
  }
  for (const u of configUndecided) undecided.push({ ...u, near: true });

  // `tsconfig.base.json` path aliases are a second address every specifier could
  // be spelled at, and this module resolves none of them. ADR-418 checked by
  // hand that there are none; this makes the check happen on every run.
  /** @type {string[]} */
  const aliases = [];
  for (const rel of files) {
    if (!/tsconfig(\..+)?\.json$/.test(rel)) continue;
    const text = readText(root, rel);
    if (text === null) continue;
    try {
      const parsed = /** @type {{ compilerOptions?: { paths?: Record<string, unknown> } }} */ (
        JSON.parse(stripComments(text))
      );
      for (const key of Object.keys(parsed.compilerOptions?.paths ?? {}))
        aliases.push(`${rel}: ${key}`);
    } catch {
      // Reported above as an undecided configuration.
    }
  }

  sites.sort((a, b) => a.kind.localeCompare(b.kind) || a.file.localeCompare(b.file));
  undecided.sort((a, b) => a.file.localeCompare(b.file));

  return {
    target: normalised,
    exists: present.has(normalised),
    population: { files: files.length, method },
    sites,
    undecided,
    unresolvedEnumerations,
    aliases,
  };
}

// -----------------------------------------------------------------------------
// THE SECOND HOP, WHICH IS THE BLIND SPOT MADE ANSWERABLE RATHER THAN ONLY NAMED
// -----------------------------------------------------------------------------

/**
 * A path-shaped substring, so a literal can be tested against the population
 * without comparing it to every tracked file in turn.
 */
const PATHISH = /[\w.@-]+(?:\/[\w.@-]+)+/g;

/**
 * The whole reverse-dependency graph in one pass: for each file, the files that
 * REACH it by a kind whose dependence COMPOSES.
 *
 * **`import` AND `path-literal` ONLY, AND THE EXCLUSION IS THE POINT.** "A reads
 * B and B reads C" is a fact about A and C. "A walks the directory C is in" is
 * not: a walk makes every file under that directory a first-hop dependant of
 * every other one, so a closure that followed enumerations would return the
 * tree on the second hop and mean nothing. `config-glob` and `prose` are
 * excluded for the same reason in reverse, being about a MOVE and about a
 * SENTENCE rather than about a run.
 *
 * @param {string} root
 * @returns {{ edges: Map<string, Set<string>>, files: string[], method: string }}
 */
export function graph(root) {
  const { files, method } = population(root);
  const present = new Set(files);
  const pkgs = packageDirs(root, files);
  /** @type {Map<string, Set<string>>} */
  const edges = new Map();
  /** @param {string} target @param {string} dependant */
  const add = (target, dependant) => {
    const set = edges.get(target);
    if (set === undefined) edges.set(target, new Set([dependant]));
    else set.add(dependant);
  };

  for (const rel of files) {
    const isSource = SOURCE.test(rel);
    if (!isSource && !DATA.test(rel)) continue;
    const text = readText(root, rel);
    if (text === null) continue;
    const body = isSource ? stripComments(text) : text;
    const fileDir = parentOf(rel);

    if (isSource) {
      for (const m of body.matchAll(SPECIFIER)) {
        const to = resolveSpecifier(/** @type {string} */ (m[2]), fileDir, pkgs, present);
        if (to !== null && to !== rel) add(to, rel);
      }
    }
    for (const lit of literals(body)) {
      for (const candidate of lit.match(PATHISH) ?? []) {
        const to = normalise(candidate);
        if (to !== null && to !== rel && present.has(to)) add(to, rel);
      }
    }
  }
  return { edges, files, method };
}

/**
 * Files that reach `target` within `hops` composing steps, and the hop each was
 * first reached at.
 *
 * **THIS IS THE `transitive` ENTRY OF `BLIND` TURNED INTO A SETTING.** That
 * entry says this module reports DIRECT dependants and that the closure is a
 * different question; this answers the different question when it is asked for,
 * and never by default, because a caller who did not ask for depth must not be
 * handed a list whose entries mean something else.
 *
 * @param {string} root
 * @param {string} target
 * @param {number} hops
 * @returns {{ reached: Map<string, number>, method: string, files: number }}
 */
export function closure(root, target, hops) {
  const normalised = normalise(target);
  if (normalised === null || normalised === '') {
    throw new Error(`dependants: \`${target}\` does not name a file inside the tree`);
  }
  const { edges, files, method } = graph(root);
  /** @type {Map<string, number>} */
  const reached = new Map();
  let frontier = [normalised];
  for (let hop = 1; hop <= hops && frontier.length > 0; hop += 1) {
    /** @type {string[]} */
    const next = [];
    for (const from of frontier) {
      for (const dependant of edges.get(from) ?? []) {
        if (dependant === normalised || reached.has(dependant)) continue;
        reached.set(dependant, hop);
        next.push(dependant);
      }
    }
    frontier = next;
  }
  return { reached, method, files: files.length };
}

// -----------------------------------------------------------------------------
// THE CLI
// -----------------------------------------------------------------------------

/**
 * @param {string[]} argv
 * @param {(line: string) => void} emit
 * @param {string} root
 * @returns {number}
 */
export function main(argv, emit = console.log, root = REPO_ROOT) {
  const target = argv[0];
  if (target === undefined || target === '--help') {
    emit('usage: node packages/tooling/checks/dependants.mjs <repo-relative-path>');
    emit('       node packages/tooling/checks/dependants.mjs --kinds');
    emit('       node packages/tooling/checks/dependants.mjs <path> --hops=3');
    emit('       node packages/tooling/checks/dependants.mjs --blind');
    return target === undefined ? 1 : 0;
  }
  if (target === '--kinds') {
    for (const kind of KINDS) {
      emit(`${kind.id}  (breaks on ${kind.breaks}; found by ${kind.found})`);
      emit(`    ${kind.what}`);
    }
    return 0;
  }
  if (target === '--blind') {
    emit('KINDS THIS MODULE CANNOT SEE. A short `sites` list is not a complete one.');
    for (const b of BLIND) {
      emit(`${b.id}`);
      emit(`    ${b.what}`);
    }
    return 0;
  }

  const hopsFlag = argv.find((a) => a.startsWith('--hops='));
  if (hopsFlag !== undefined) {
    const hops = Number(hopsFlag.slice('--hops='.length));
    if (!Number.isInteger(hops) || hops < 1) {
      emit('--hops= takes a whole number of composing steps, at least 1.');
      return 1;
    }
    const result = closure(root, target, hops);
    emit(`target      ${normalise(target)}`);
    emit(`population  ${result.files} file(s), by ${result.method}`);
    emit(
      `hops        ${hops}, following \`import\` and \`path-literal\` only. An enumeration does ` +
        'not compose and a closure over one returns the tree.',
    );
    emit('');
    const byHop = [...result.reached.entries()].sort(
      (a, b) => a[1] - b[1] || a[0].localeCompare(b[0]),
    );
    for (const [file, hop] of byHop) emit(`    hop ${hop}  ${file}`);
    emit('');
    emit(`${result.reached.size} file(s) reach it within ${hops} step(s).`);
    return 0;
  }

  const report = dependantsOf(root, target);
  emit(`target      ${report.target}${report.exists ? '' : '   (NOT PRESENT IN THE POPULATION)'}`);
  emit(`population  ${report.population.files} file(s), by ${report.population.method}`);
  emit('');

  for (const kind of KINDS) {
    const mine = report.sites.filter((s) => s.kind === kind.id);
    const dated = mine.filter((s) => s.dated === true).length;
    emit(
      `${kind.id.padEnd(12)} ${String(mine.length).padStart(4)} site(s)` +
        (dated > 0 ? `, ${dated} of them in a dated record ADR-386 says stays as it is` : '') +
        `   [breaks on ${kind.breaks}]`,
    );
    for (const s of mine) {
      const tier = s.retention === undefined ? '' : `[${s.retention}] `;
      emit(`    ${s.dated === true ? '(dated) ' : ''}${tier}${s.file}  ${s.detail}`);
    }
    if (kind.id === 'enumeration' && mine.length > 0) {
      const count = (/** @type {Retention} */ t) => mine.filter((s) => s.retention === t).length;
      emit(
        `             retention: ${count('selected')} selected, ${count('excluded')} excluded, ` +
          `${count('unfiltered')} unfiltered, ${count('unreadable')} unreadable. ` +
          'A TIER AND NOT A FILTER: every site above is reported whatever its tier, and ' +
          '`excluded` means a DELETION is not felt through this file`s content predicates ' +
          'while a CHANGE to the target`s bytes would be.',
      );
    }
  }

  emit('');
  emit(`UNDECIDED   ${report.undecided.length} site(s) this module SAW and could not resolve.`);
  for (const u of report.undecided) {
    emit(`    ${u.near ? '(near) ' : ''}${u.file}  ${u.detail}  -- ${u.why}`);
  }
  emit(
    `            ${report.unresolvedEnumerations} directory read(s) repo-wide did not fold, which is the ` +
      'size of what the enumeration kind cannot see.',
  );
  emit(
    `            ${report.aliases.length} tsconfig path alias(es), each a second address a specifier ` +
      'could be spelled at and none of them resolved here.',
  );
  for (const a of report.aliases) emit(`    ${a}`);

  // ADR-427 DECIDES THE QUESTION ADR-422 SECTION 11 LEFT OPEN, AND DECIDES IT
  // AGAINST WIDENING THE DEFAULT. A hop-2 entry means something weaker than a
  // hop-1 entry: "this breaks" against "this breaks for as long as some other
  // file goes unrepaired". Merging the two into one default list would make
  // every entry mean the weaker thing, and a list of fifteen where four are
  // direct teaches its reader to skim, which is how a long list goes quiet
  // without a single site being dropped.
  //
  // **SO THE DEFAULT STAYS AT ONE HOP AND THE RUN STOPS LETTING A CALLER NOT
  // KNOW THAT.** ADR-422 section 6 measured a file going red that is outside
  // the one-hop closure and inside the two-hop one, so a caller reading the
  // default is short by an amount that is DERIVABLE. It is derived here, on
  // every ordinary run, and named rather than listed. The cost is one further
  // pass over the population.
  const near = closure(root, report.target, 1).reached.size;
  const far = closure(root, report.target, 2).reached.size;
  emit('');
  emit(
    `TRANSITIVE  ${near} file(s) reach it in ONE composing step and ${far} within TWO, so ` +
      `${far - near} file(s) depend on it only THROUGH another file and are NOT listed above.`,
  );
  emit(
    '            The default is one hop and stays one: a two-hop entry means "red for as long ' +
      'as some other file is unrepaired", which is weaker than what an entry above means. ' +
      '`--hops=2` names them.',
  );

  emit('');
  emit(
    'BLIND. Kinds this module cannot see at all, so that a short list above is not read as a complete one:',
  );
  for (const b of BLIND) emit(`    ${b.id}: ${b.what.split('. ')[0]}.`);
  return 0;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].split('\\').join('/'))
) {
  process.exit(main(process.argv.slice(2)));
}
