// =============================================================================
// packages/tooling/checks/tree-input-budget.mjs
// =============================================================================
// A CASE WHOSE INPUT IS THIS REPOSITORY CARRIES A BUDGET SIZED AGAINST THIS
// REPOSITORY, AND THIS IS WHAT SAYS SO.
//
//   node packages/tooling/checks/tree-input-budget.mjs
//   node packages/tooling/checks/tree-input-budget.mjs --list
//
// `ADR-468` section 10 item 1 is the whole of the motivation and it is quoted
// rather than paraphrased:
//
//   "NOTHING ASSERTS THAT A CASE WHOSE INPUT IS THE TREE CARRIES A BUDGET SIZED
//    AGAINST THE TREE. Thirty-three call sites now carry one and the
//    thirty-fourth will be added without one, exactly as `ADR-466` section 10
//    item 2 predicted for the eighth. This row makes that prediction WORSE
//    rather than better, because a reader adding a case to any of eleven files
//    in `packages/tooling/test/` now has eight files where the constant is
//    imported and three where it is not, and no signal about which kind theirs
//    is."
//
// The failure is one sentence: somebody adds a case that walks the tree, does
// not import `CORPUS_SCAN_MS`, and the case runs on a 5000ms framework default
// that nobody chose. It goes green here and red on a slower runner, or on a
// larger tree, months later, on a diff that did not cause it.
//
// -----------------------------------------------------------------------------
// THE PREDICATE, AND WHY IT IS NOT KEYED ON `REPO_ROOT`
// -----------------------------------------------------------------------------
// `ADR-466` section 10 item 2 priced this check as "a `test()` whose body names
// `REPO_ROOT` outside a `join(REPO_ROOT, <literal>)` read". `ADR-468` section
// 3.2 FALSIFIED that predicate by deriving the population from inputs instead:
// THREE OF THE EIGHT FILES THAT WALK THIS TREE NAME `REPO_ROOT` NOWHERE, so a
// check keyed on that identifier misses three whole files, and one file that
// DOES name it scans nothing in three cases.
//
// SO THE KEY HERE IS A VALUE AND NEVER A NAME. A repository root reaches a case
// in three forms and this module derives all three:
//
//   FORM 1  an IMPORTED CONSTANT whose value is a directory of this repository.
//           Spelled `REPO_ROOT` in five suites and `DECISIONS` in one checker,
//           and this module reads the VALUE by importing the module rather than
//           matching the name
//   FORM 2  a root COMPUTED LOCALLY from `import.meta.url`, which no import and
//           no shared name reaches
//   FORM 3  a DEFAULT PARAMETER, so the call carries no root argument at all.
//           `derivedSet(root = REPO_ROOT)` and `derive(dir = DECISIONS)` are
//           walks with nothing at the call site to see
//
// A CASE IS IN THE POPULATION WHEN ITS BODY REACHES ONE OF THREE THINGS. The
// body is the case callback plus the bodies of every file-local helper it calls,
// transitively, because `sourceTree()` takes no argument and walks two
// directories of this repository.
//
//   W1  a call ARGUMENT whose value is a DIRECTORY of this repository. Bare
//       `REPO_ROOT`, or `join(REPO_ROOT, 'apps')`, which is resolved against
//       the real tree and kept because `apps` is a directory. The same fold
//       DROPS `join(REPO_ROOT, 'docs/architecture/API_CONTRACT.md')`, because
//       that resolves to a FILE and a named read does not grow with the tree
//   W2  a call to a DEFAULT-ROOTED WALKER with its root argument ABSENT. The
//       roster is derived from `packages/tooling/checks/` rather than written
//       here: a parameter whose default resolves to a directory of this
//       repository, and which flows into a directory-enumeration primitive
//   W3  a call to a ROOTLESS WALKER, which is a function that reaches a
//       default-rooted walker with no root of its own to override. Every CLI
//       `run` in this tree is one
//
// -----------------------------------------------------------------------------
// WHAT THE PREDICATE DELIBERATELY DOES NOT CATCH, AND WHY EACH IS RIGHT
// -----------------------------------------------------------------------------
//   A SIGNATURE DEFAULT IS NOT A USE. `transcript(checks, root = REPO_ROOT)` in
//   `repo-invariants.test.ts` is called only with `held`, `violated` and
//   `crashes` fixtures whose `run` ignores the root entirely: it NAMES the
//   constant and scans nothing. Only helper BODIES are read, never their
//   parameter lists, so those six cases stay out. This is the single most
//   misleading `REPO_ROOT` in the suite for anybody deriving a population by
//   search, and it is `ADR-468` section 10 item 6.
//
//   AN ARGV GUARD IS PART OF THE INPUT. `run(['--fix'])` and
//   `run(['--set', 'rcr_bp'], emit)` return before reading anything: the
//   walking function is called and no walk happens. A rootless walker whose
//   body opens with `if (argv.length > 0) return` is read as walking only when
//   that argument is absent or an empty array literal, which is derived from
//   the guard rather than assumed.
//
//   TWO NAMED FILES ARE NOT A TREE. `write-guard-set.mjs`s `derive` and
//   `legConventionShared` default to FILES, so no parameter of theirs resolves
//   to a directory and they never enter the roster. Their suite reaches the real
//   tree in every case and walks none of it, at 165ms worst.
//
// -----------------------------------------------------------------------------
// THREE LEGS, AND THE THIRD IS THE ONE THAT KEEPS THIS HONEST
// -----------------------------------------------------------------------------
//   Leg A  THE DERIVATION IS NOT VACUOUS. All three forms are found, the roster
//          is non-empty, and every suite parses. An absence check over an empty
//          scope reports PASS in silence, which is the defect this whole estate
//          is about, so leg A THROWS rather than reporting
//   Leg B  EVERY CASE IN THE POPULATION CARRIES THE BUDGET. The subject
//   Leg C  EVERY CASE CARRYING THE BUDGET IS IN THE POPULATION. Without this the
//          check is one-directional: a reader could satisfy leg B by pasting the
//          constant onto a fixture case, and a budget on a case whose input is
//          two files is a 60-second wall doing nothing but bounding a hang
//
// WHAT IT CANNOT SEE, WRITTEN DOWN BEFORE ANYBODY ASKS. A walk reached through a
// value this fold does not follow: a root stored in an object property, passed
// through an array, or returned from a function whose body names no root. A
// dynamic `check.run(root)` is read at the CALL SITE by W1, where the root is
// visible, and not through the property, which is why `findings(id, REPO_ROOT)`
// is caught and `runChecks(checks, { root })` inside a helper is not. A checker
// that walks through a primitive not in `ENUMERATORS`. And a semantic change: a
// rostered function that stops walking keeps its roster entry, because the
// roster is derived from a parameter reaching an enumerator and not from a
// measurement of the run.
// =============================================================================

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { splitArgs } from './dependants.mjs';
import { stripComments } from './strip-comments.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The workspace root, three levels up from `packages/tooling/checks`. */
export const REPO_ROOT = resolve(HERE, '../../..');

/** The checkers the walker roster is derived from. */
export const CHECKS_DIR = resolve(HERE);

/** The suite this check is about. `ADR-468`s fence, exactly. */
export const SUITE_DIR = resolve(HERE, '../test');

/** The constant a case whose input is this repository must carry. */
export const BUDGET = 'CORPUS_SCAN_MS';

/**
 * Directory-enumeration primitives. A parameter that reaches one of these holds
 * a cost that grows with the tree; a parameter that reaches `readFileSync` and
 * nothing else holds a named read, whose cost is the size of one file.
 */
export const ENUMERATORS = ['readdirSync', 'readdir', 'opendirSync', 'opendir', 'globSync'];

/**
 * Path composition. The ARGUMENTS of these are never read as roots: the value of
 * the WHOLE call is, once it reaches something that does work with it. This is
 * the whole of the difference between `sourceFilesUnder(join(REPO_ROOT, 'apps'))`
 * and `readFileSync(join(REPO_ROOT, 'docs/architecture/API_CONTRACT.md'))`, and
 * it is settled by what is on disk rather than by the shape of the literal.
 */
export const COMPOSERS = ['join', 'resolve', 'dirname', 'basename', 'relative', 'fileURLToPath'];

// -----------------------------------------------------------------------------
// SOURCE MODEL
// -----------------------------------------------------------------------------
// Structure is scanned over source with comments removed and string literals
// BLANKED, so a parenthesis inside a string is not a parenthesis. Text is read
// back out of the same source with literals KEPT, at the same offsets, which is
// the property `strip-comments.test.ts` asserts over the whole tree. A module
// specifier and a path fragment are both string literals, so anything folded to
// a VALUE is read from the kept side and anything counted is read from the
// blanked one.
// -----------------------------------------------------------------------------

/**
 * @typedef {object} Source
 * @property {string} path      absolute
 * @property {string} dir       absolute
 * @property {string} kept      comments removed, literals kept
 * @property {string} blanked   comments removed, literals blanked
 */

/** @param {string} path @returns {Source} */
export function readSource(path) {
  const raw = readFileSync(path, 'utf8');
  const kept = stripComments(raw);
  const blanked = stripComments(raw, { literals: 'blank' });
  if (kept.length !== blanked.length) {
    throw new Error(`${path}: the two strip modes disagree on length, so no offset maps`);
  }
  return { path, dir: dirname(path), kept, blanked };
}

/** @param {string} blanked @param {number} open @param {string} shut @returns {number} */
function closing(blanked, open, shut) {
  const start = /** @type {string} */ (blanked[open]);
  let depth = 0;
  for (let i = open; i < blanked.length; i += 1) {
    const ch = blanked[i];
    if (ch === start) depth += 1;
    else if (ch === shut) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** @param {string} blanked @param {number} open @returns {number} */
export const closingParen = (blanked, open) => closing(blanked, open, ')');

/** @param {string} blanked @param {number} open @returns {number} */
export const closingBrace = (blanked, open) => closing(blanked, open, '}');

/** @param {string} text @param {number} at @returns {number} */
export function lineAt(text, at) {
  let line = 1;
  for (let i = 0; i < at && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

/** @param {string} text @param {number} from @returns {number} */
function firstNonSpace(text, from) {
  let i = from;
  while (i < text.length && /\s/.test(/** @type {string} */ (text[i]))) i += 1;
  return i;
}

/** @param {string} name @returns {RegExp} */
const wordRe = (name) => new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`);

/** @param {string} abs @returns {string} */
const rel = (abs) => relative(REPO_ROOT, abs) || '.';

// -----------------------------------------------------------------------------
// DECLARATIONS, AT ANY DEPTH
// -----------------------------------------------------------------------------
// AT ANY DEPTH AND NOT ONLY AT THE TOP, because `absence-grammar-census.test.ts`
// computes its root inside a `describe` block and `repo-invariants.test.ts`
// declares `transcript` inside one. A declaration this fold cannot see is a
// helper whose walk is invisible.
// -----------------------------------------------------------------------------

/** `const NAME =` / `let NAME =`, exported or not, at any indentation. */
const BINDING =
  /(?:^|[\n;{}])\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=/g;

/**
 * The end of an initialiser starting at `from`: the first `;` or newline at
 * bracket depth zero.
 *
 * @param {string} blanked
 * @param {number} from
 * @returns {number}
 */
function endOfInitialiser(blanked, from) {
  let depth = 0;
  for (let i = from; i < blanked.length; i += 1) {
    const ch = blanked[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth < 0) return i;
    } else if (depth === 0 && (ch === ';' || ch === '\n')) return i;
  }
  return blanked.length;
}

/**
 * Every `const`/`let` binding in a source, name to the text of its initialiser.
 * A name bound more than once maps to `null`, which this module treats as
 * unresolvable rather than guessing which binding a use meant.
 *
 * @param {Source} src
 * @returns {Map<string, string | null>}
 */
export function bindings(src) {
  /** @type {Map<string, string | null>} */
  const out = new Map();
  for (const m of src.blanked.matchAll(BINDING)) {
    const name = /** @type {string} */ (m[1]);
    const from = m.index + m[0].length;
    const end = endOfInitialiser(src.blanked, from);
    if (out.has(name)) out.set(name, null);
    else out.set(name, src.kept.slice(from, end).trim());
  }
  return out;
}

/**
 * @typedef {object} Fn
 * @property {string} name
 * @property {boolean} exported
 * @property {{ name: string, def: string | null }[]} params
 * @property {string} body     the BODY only. Parameter defaults are NOT in it
 * @property {string} blanked  the same body with string literals blanked
 * @property {boolean} top      declared at column zero, so at module scope
 * @property {number} at
 */

const FUNCTION_DECL =
  /(?:^|\n)([ \t]*)(export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
const ARROW_DECL =
  /(?:^|\n)([ \t]*)(export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*(?:async\s+)?(?:<[^>]*>\s*)?\(/g;

/**
 * The `{` that opens a function body, given the `)` that closes its parameters.
 *
 * A RETURN-TYPE ANNOTATION CARRIES BRACES AND THE FIRST ONE IS NOT THE BODY.
 * `function worstVictim(): { readonly path: string; ... } {` cost this fold a
 * whole case the first time it ran: the type object was read as the body, the
 * body was never read, and the one case reaching the tree through `worstVictim`
 * silently left the population.
 *
 * @param {string} blanked
 * @param {number} close   index of `)`
 * @returns {number}
 */
export function bodyBrace(blanked, close) {
  let depth = 0;
  for (let i = close + 1; i < blanked.length; i += 1) {
    const ch = blanked[i];
    if (ch === '<' || ch === '(' || ch === '[') depth += 1;
    else if (ch === '>' || ch === ')' || ch === ']') depth -= 1;
    else if (ch === '{' && depth === 0) {
      const shut = closingBrace(blanked, i);
      if (shut < 0) return -1;
      const next = firstNonSpace(blanked, shut + 1);
      // A `}` followed by another `{` closed a TYPE and the body is still ahead.
      // A `}` followed by anything else closed the body.
      if (blanked[next] !== '{') return i;
      i = next - 1;
    } else if (ch === ';' && depth === 0) return -1;
  }
  return -1;
}

/**
 * Every function-like declaration in a source, at any depth.
 *
 * @param {Source} src
 * @returns {Map<string, Fn>}
 */
export function functions(src) {
  /** @type {Map<string, Fn>} */
  const out = new Map();

  for (const m of src.blanked.matchAll(FUNCTION_DECL)) {
    const open = m.index + m[0].length - 1;
    const close = closingParen(src.blanked, open);
    if (close < 0) continue;
    const brace = bodyBrace(src.blanked, close);
    if (brace < 0) continue;
    const end = closingBrace(src.blanked, brace);
    if (end < 0) continue;
    add(out, {
      name: /** @type {string} */ (m[3]),
      exported: m[2] !== undefined,
      params: params(src.kept.slice(open + 1, close)),
      body: src.kept.slice(brace + 1, end),
      blanked: src.blanked.slice(brace + 1, end),
      top: m[1] === '',
      at: m.index,
    });
  }

  for (const m of src.blanked.matchAll(ARROW_DECL)) {
    const open = m.index + m[0].length - 1;
    const close = closingParen(src.blanked, open);
    if (close < 0) continue;
    const arrow = src.blanked.indexOf('=>', close);
    if (arrow < 0) continue;
    if (src.blanked.slice(close + 1, arrow).includes('(')) continue;
    const rest = arrow + 2;
    const opener = firstNonSpace(src.blanked, rest);
    const end =
      src.blanked[opener] === '{'
        ? closingBrace(src.blanked, opener)
        : endOfInitialiser(src.blanked, rest);
    if (end < 0) continue;
    add(out, {
      name: /** @type {string} */ (m[3]),
      exported: m[2] !== undefined,
      params: params(src.kept.slice(open + 1, close)),
      body: src.kept.slice(rest, end),
      blanked: src.blanked.slice(rest, end),
      top: m[1] === '',
      at: m.index,
    });
  }

  return out;
}

/**
 * A NAME DECLARED TWICE AT THE SAME SCOPE IS NOT RESOLVED BY GUESSING: the
 * entry is emptied and nothing is claimed about either declaration.
 *
 * A MODULE-SCOPE DECLARATION WINS OVER A NESTED ONE, and the reason is
 * `repo-invariants.mjs`, which declares `walk` three times: once at module scope
 * as the tree walk every invariant runs on, and twice as a local arrow inside
 * another function. Emptying that entry made the file's whole walk invisible and
 * put `RI-19`s real-tree case out of the population, which is one budgeted case
 * silently reported as unearned.
 *
 * @param {Map<string, Fn>} out
 * @param {Fn} fn
 */
function add(out, fn) {
  const seen = out.get(fn.name);
  if (seen === undefined) {
    out.set(fn.name, fn);
    return;
  }
  if (seen.top !== fn.top) {
    if (fn.top) out.set(fn.name, fn);
    return;
  }
  out.set(fn.name, { ...seen, params: [], body: '', blanked: '' });
}

/**
 * @param {string} text  a parameter list, without its parentheses
 * @returns {{ name: string, def: string | null }[]}
 */
export function params(text) {
  const parts = splitArgs(text);
  if (parts === null) return [];
  return parts.map((part) => {
    const eq = topLevelEquals(part);
    const left = (eq < 0 ? part : part.slice(0, eq)).replace(/:[\s\S]*$/, '').trim();
    return { name: left.replace(/^\.\.\./, ''), def: eq < 0 ? null : part.slice(eq + 1).trim() };
  });
}

/** @param {string} part @returns {number} */
function topLevelEquals(part) {
  let depth = 0;
  for (let i = 0; i < part.length; i += 1) {
    const ch = part[i];
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') depth -= 1;
    else if (
      ch === '=' &&
      depth === 0 &&
      part[i + 1] !== '=' &&
      part[i - 1] !== '=' &&
      part[i - 1] !== '!' &&
      part[i - 1] !== '<' &&
      part[i - 1] !== '>'
    ) {
      return i;
    }
  }
  return -1;
}

/**
 * @typedef {object} Call
 * @property {string} name    the callee's last identifier
 * @property {string} whole   the callee as written. A leading `.` means the
 *                            receiver is an expression this fold cannot follow
 * @property {string[]} args
 * @property {number} at
 */

const CALLEE = /(?<![\w$])([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(?:<[^<>()]*>\s*)?\(/g;
const KEYWORDS = ['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'await', 'typeof'];

/**
 * Every call in a text, with its arguments split. A call whose arguments do not
 * balance is DROPPED rather than guessed at.
 *
 * @param {string} text
 * @returns {Call[]}
 */
export function callsIn(text) {
  /** @type {Call[]} */
  const out = [];
  for (const m of text.matchAll(CALLEE)) {
    const written = /** @type {string} */ (m[1]);
    if (KEYWORDS.includes(written)) continue;
    const open = m.index + m[0].length - 1;
    const close = closingParen(text, open);
    if (close < 0) continue;
    const args = splitArgs(text.slice(open + 1, close));
    if (args === null) continue;
    const parts = written.split('.');
    // `check(id).run(root)`: the receiver is a CALL, so the match starts after a
    // `.` with no name in front of it. Recorded as `.run`, which is dotted, which
    // is unresolvable, which is exactly what it is.
    const dotted = text[m.index - 1] === '.';
    out.push({
      name: /** @type {string} */ (parts[parts.length - 1]),
      whole: dotted ? `.${written}` : written,
      args,
      at: m.index,
    });
  }
  return out;
}

// -----------------------------------------------------------------------------
// PATH FOLDING: THE VALUE OF AN EXPRESSION, AGAINST THE REAL TREE
// -----------------------------------------------------------------------------

const LITERAL = /^(['"`])([^'"`]*)\1$/;

/**
 * The absolute path an expression evaluates to, or `null` when this fold does
 * not reach one. `null` is "I could not tell", never "it is not a root".
 *
 * @param {string} expr
 * @param {string} file          the absolute path of the file it is written in
 * @param {Map<string, string | null>} binds
 * @param {number} [depth]
 * @returns {string | null}
 */
export function foldPath(expr, file, binds, depth = 0) {
  if (depth > 8) return null;
  const text = expr.trim().replace(/\s+as\s+const$/, '');

  const literal = LITERAL.exec(text);
  if (literal !== null) return /** @type {string} */ (literal[2]);

  if (/^import\.meta\.url$/.test(text)) return pathToFileURL(file).href;

  const url = /^new\s+URL\s*\(/.exec(text);
  if (url !== null) {
    const at = text.indexOf('(');
    const close = closingParen(text, at);
    if (close < 0) return null;
    const args = splitArgs(text.slice(at + 1, close));
    if (args === null || args.length === 0) return null;
    const first = foldPath(/** @type {string} */ (args[0]), file, binds, depth + 1);
    if (first === null) return null;
    const base =
      args.length > 1 ? foldPath(/** @type {string} */ (args[1]), file, binds, depth + 1) : null;
    let href;
    try {
      href = new URL(first, base ?? pathToFileURL(file).href).href;
    } catch {
      return null;
    }
    const tail = text.slice(close + 1).trim();
    if (tail === '.pathname') return fileURLToPath(href);
    return tail === '' ? href : null;
  }

  const call = /^([A-Za-z_$][\w$.]*)\s*\(/.exec(text);
  if (call !== null) {
    const at = text.indexOf('(');
    const close = closingParen(text, at);
    if (close !== text.length - 1) return null;
    const args = splitArgs(text.slice(at + 1, close));
    if (args === null) return null;
    return foldCall(/** @type {string} */ (call[1]), args, file, binds, depth);
  }

  if (/^[A-Za-z_$][\w$]*$/.test(text)) {
    const bound = binds.get(text);
    if (bound === undefined || bound === null) return null;
    return foldPath(bound, file, binds, depth + 1);
  }

  return null;
}

/**
 * @param {string} fn
 * @param {string[]} args
 * @param {string} file
 * @param {Map<string, string | null>} binds
 * @param {number} depth
 * @returns {string | null}
 */
function foldCall(fn, args, file, binds, depth) {
  const folded = args.map((a) => foldPath(a, file, binds, depth + 1));
  if (folded.some((f) => f === null)) return null;
  const parts = /** @type {string[]} */ (folded);
  if (fn === 'join') return join(...parts);
  if (fn === 'resolve') return resolve(...parts);
  if (fn === 'dirname')
    return parts.length === 1 ? dirname(/** @type {string} */ (parts[0])) : null;
  if (fn === 'fileURLToPath') {
    if (parts.length !== 1) return null;
    const one = /** @type {string} */ (parts[0]);
    if (one.startsWith('/')) return one;
    try {
      return fileURLToPath(one);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Whether a folded path is a DIRECTORY of this repository. The whole
 * discrimination between a walk and a named read is this one call, and it is
 * resolved against the tree on the run rather than against a pattern.
 *
 * ABSOLUTE OR NOTHING. `'packages/db/migrations'` is a string a case compares
 * against, not a root it holds, and resolving it against the process working
 * directory would make every path-shaped literal in the suite a walk.
 *
 * @param {string | null} path
 * @returns {boolean}
 */
export function isTreeDirectory(path) {
  if (path === null || path === '' || !isAbsolute(path)) return false;
  const abs = resolve(path);
  if (relative(REPO_ROOT, abs).startsWith('..')) return false;
  return existsSync(abs) && statSync(abs).isDirectory();
}

// -----------------------------------------------------------------------------
// THE MODEL: EVERY MODULE, AND WHAT EACH PARAMETER REACHES
// -----------------------------------------------------------------------------

/**
 * @typedef {object} Mod
 * @property {Source} src
 * @property {Map<string, Fn>} fns
 * @property {Map<string, string | null>} binds
 * @property {Map<string, string>} imported   local name to `module#name`
 */

/**
 * Which local name each relative import binds, as `modulePath#exportedName`.
 *
 * @param {Source} src
 * @returns {Map<string, string>}
 */
export function importsOf(src) {
  /** @type {Map<string, string>} */
  const out = new Map();
  // READ OFF THE SOURCE WITH LITERALS KEPT. A module specifier IS a string
  // literal, so the blanked reading has nothing left inside the quotes.
  const re = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  for (const m of src.kept.matchAll(re)) {
    const spec = /** @type {string} */ (m[2]);
    if (!spec.startsWith('.')) continue;
    const target = resolveSpecifier(src.dir, spec);
    if (target === null) continue;
    for (const raw of /** @type {string} */ (m[1]).split(',')) {
      const parts = raw.trim().split(/\s+as\s+/);
      const exported = /** @type {string} */ (parts[0]).trim();
      const local = (parts[1] ?? exported).trim();
      if (exported === '' || local === '') continue;
      out.set(local, `${target}#${exported}`);
    }
  }
  return out;
}

/** @param {string} fromDir @param {string} spec @returns {string | null} */
function resolveSpecifier(fromDir, spec) {
  const base = resolve(fromDir, spec);
  for (const candidate of [base, base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.mjs')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Read a set of files into one model, and fold every imported constant into the
 * binding table of the module that USES it. That last step is form 1: a root
 * reaches `absence-grammar-census.mjs` under a name its own file never declares.
 *
 * @param {string[]} files
 * @returns {Map<string, Mod>}
 */
export function model(files) {
  /** @type {Map<string, Mod>} */
  const mods = new Map();
  for (const file of files) {
    const src = readSource(file);
    mods.set(file, { src, fns: functions(src), binds: bindings(src), imported: importsOf(src) });
  }
  for (const mod of mods.values()) {
    for (const [local, target] of mod.imported) {
      const hash = target.lastIndexOf('#');
      const home = mods.get(target.slice(0, hash));
      if (home === undefined || mod.binds.has(local)) continue;
      const declared = home.binds.get(target.slice(hash + 1));
      if (declared === undefined || declared === null) continue;
      const folded = foldPath(declared, home.src.path, home.binds);
      if (folded !== null) mod.binds.set(local, `'${folded}'`);
    }
  }
  return mods;
}

/**
 * The `module#name` a bare callee resolves to, from where it is written.
 *
 * A DOTTED CALLEE RESOLVES TO NOTHING. `check(id).run(root)` is a property of a
 * value, and reading it as `price-register.mjs#run` because both are spelled
 * `run` is how a fold invents a walk that is not there.
 *
 * @param {string} whole
 * @param {string} file
 * @param {Map<string, Mod>} mods
 * @returns {string | null}
 */
export function resolveCallee(whole, file, mods) {
  if (whole.includes('.')) return null;
  const mod = mods.get(file);
  if (mod === undefined) return null;
  if (mod.fns.has(whole)) return `${file}#${whole}`;
  const target = mod.imported.get(whole);
  if (target === undefined) return null;
  return mods.has(target.slice(0, target.lastIndexOf('#'))) ? target : null;
}

/**
 * Every local name a root is folded into inside one body, starting with the
 * parameter itself. `derivedSet` does `const dir = join(root, MIGRATIONS)` and
 * then `readdirSync(dir)`, so a fold that only reads arguments sees no walk in
 * the function whose whole job is one.
 *
 * ONLY THROUGH AN ALIAS OR A PATH COMPOSITION, and the reason is measured
 * rather than tidy. Propagating through ANY expression made `legPaths` unknown:
 * `const length = target.split(...).length` carried the taint into
 * `findings.push(...)`, a dotted call this fold cannot follow, and five cases
 * that resolve named files under a directory joined the population. A root that
 * has been counted is a NUMBER, and a number reaches no walk.
 *
 * @param {string} blanked
 * @param {string} param
 * @returns {Set<string>}
 */
export function carriersOf(blanked, param) {
  const out = new Set([param]);
  let moved = true;
  while (moved) {
    moved = false;
    for (const m of blanked.matchAll(BINDING)) {
      const name = /** @type {string} */ (m[1]);
      if (out.has(name)) continue;
      const from = m.index + m[0].length;
      const init = blanked.slice(from, endOfInitialiser(blanked, from)).trim();
      if (!stillAPath(init, out)) continue;
      out.add(name);
      moved = true;
    }
  }
  return out;
}

/**
 * Whether an initialiser is still a PATH: a carrier aliased, a path composed
 * from one, or either of those on a branch of a choice. `walk` opens with
 * `const here = dir === '' ? root : join(root, dir)`, and a rule that read only
 * the head of the expression lost the whole `dependants.mjs` walk to a ternary.
 *
 * @param {string} init
 * @param {Set<string>} carriers
 * @returns {boolean}
 */
function stillAPath(init, carriers) {
  if (![...carriers].some((c) => wordRe(c).test(init))) return false;
  return branchesOf(init).some((branch) => {
    const text = branch.trim();
    if (carriers.has(text)) return true;
    const call = /^([A-Za-z_$][\w$.]*)\s*\(/.exec(text);
    if (call === null) return false;
    const written = /** @type {string} */ (call[1]).split('.');
    return COMPOSERS.includes(/** @type {string} */ (written[written.length - 1]));
  });
}

/**
 * The operands of a choice, at bracket depth zero: `a ? b : c`, `a ?? b`,
 * `a || b`. An expression with no choice in it is its own only operand.
 *
 * @param {string} init
 * @returns {string[]}
 */
function branchesOf(init) {
  /** @type {string[]} */
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < init.length; i += 1) {
    const ch = init[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (depth === 0 && (ch === '?' || ch === ':' || ch === '|')) {
      out.push(init.slice(start, i));
      start = i + 1;
      if (init[i + 1] === '?' || init[i + 1] === '|') {
        start += 1;
        i += 1;
      }
    }
  }
  out.push(init.slice(start));
  return out;
}

/**
 * What a parameter reaches, per `module#name#index`:
 *
 *   `walks`    it reaches a directory-enumeration primitive
 *   `unknown`  it reaches a call this fold cannot follow, so no claim is made
 *   absent     it provably reaches neither, over calls that all resolve
 *
 * THE THREE STATES ARE THE POINT AND TWO WOULD BE WRONG. `legPaths(prices, dir)`
 * resolves named targets under `dir` and enumerates nothing, so it is PROVABLY
 * clean and its five cases stay out of the population. `findings(id, root)` hands
 * the root to `check(id).run(root)`, which this fold cannot follow, so it is
 * UNKNOWN and its five cases stay in. Collapsing unknown into clean loses the
 * five that matter; collapsing it into walks gains the five that do not.
 *
 * @param {Map<string, Mod>} mods
 * @returns {Map<string, 'walks' | 'unknown'>}
 */
export function reaches(mods) {
  /** @type {Map<string, 'walks' | 'unknown'>} */
  const out = new Map();
  const key = (/** @type {string} */ f, /** @type {string} */ n, /** @type {number} */ i) =>
    `${f}#${n}#${String(i)}`;

  let moved = true;
  while (moved) {
    moved = false;
    for (const [file, mod] of mods) {
      for (const [name, fn] of mod.fns) {
        for (let i = 0; i < fn.params.length; i += 1) {
          const id = key(file, name, i);
          if (out.get(id) === 'walks') continue;
          const param = /** @type {{ name: string }} */ (fn.params[i]).name;
          if (param === '') continue;
          const verdict = paramVerdict(fn.blanked, param, file, mods, out, key);
          if (verdict === null) continue;
          if (out.get(id) === verdict) continue;
          if (out.get(id) === 'unknown' && verdict === 'unknown') continue;
          out.set(id, verdict);
          moved = true;
        }
      }
    }
  }
  return out;
}

/**
 * @param {string} blanked
 * @param {string} param
 * @param {string} file
 * @param {Map<string, Mod>} mods
 * @param {Map<string, 'walks' | 'unknown'>} out
 * @param {(f: string, n: string, i: number) => string} key
 * @returns {'walks' | 'unknown' | null}
 */
function paramVerdict(blanked, param, file, mods, out, key) {
  if (!wordRe(param).test(blanked)) return null;
  const carriers = carriersOf(blanked, param);
  let unknown = false;
  for (const call of callsIn(blanked)) {
    const holder = call.args.findIndex((a) => [...carriers].some((c) => wordRe(c).test(a)));
    if (holder < 0) continue;
    if (call.whole.includes('.')) {
      unknown = true;
      continue;
    }
    if (ENUMERATORS.includes(call.name)) return 'walks';
    const target = resolveCallee(call.whole, file, mods);
    if (target === null) continue;
    const hash = target.lastIndexOf('#');
    const inner = out.get(key(target.slice(0, hash), target.slice(hash + 1), holder));
    if (inner === 'walks') return 'walks';
    if (inner === 'unknown') unknown = true;
  }
  return unknown ? 'unknown' : null;
}

// -----------------------------------------------------------------------------
// THE WALKER ROSTER
// -----------------------------------------------------------------------------

/**
 * @typedef {object} Walker
 * @property {string} module
 * @property {string} name
 * @property {number[]} rootParams      indices whose default is a directory of this tree
 * @property {boolean} rootless         reaches a defaulted root with none of its own
 * @property {number | null} argvGuard  index of a parameter whose non-emptiness returns early
 */

/**
 * @param {Map<string, Mod>} mods
 * @param {Map<string, 'walks' | 'unknown'>} verdicts
 * @param {string} [only]   restrict to modules under this directory
 * @returns {Map<string, Walker>}
 */
export function roster(mods, verdicts, only = CHECKS_DIR) {
  /** @type {Map<string, Walker>} */
  const out = new Map();
  /** @type {Set<string>} */
  const rootless = new Set();

  let moved = true;
  while (moved) {
    moved = false;
    for (const [file, mod] of mods) {
      for (const [name, fn] of mod.fns) {
        const id = `${file}#${name}`;
        if (rootless.has(id)) continue;
        if (walksWithNoRootOfItsOwn(fn.blanked, file, mods, verdicts, rootless)) {
          rootless.add(id);
          moved = true;
        }
      }
    }
  }

  for (const [file, mod] of mods) {
    if (relative(only, file).startsWith('..')) continue;
    for (const [name, fn] of mod.fns) {
      if (!fn.exported) continue;
      const rootParams = defaultedRoots(file, name, fn, mod, verdicts);
      const isRootless = rootless.has(`${file}#${name}`);
      if (rootParams.length === 0 && !isRootless) continue;
      out.set(`${file}#${name}`, {
        module: file,
        name,
        rootParams,
        rootless: isRootless,
        argvGuard: argvGuardOf(fn),
      });
    }
  }
  return out;
}

/**
 * @param {string} file
 * @param {string} name
 * @param {Fn} fn
 * @param {Mod} mod
 * @param {Map<string, 'walks' | 'unknown'>} verdicts
 * @returns {number[]}
 */
function defaultedRoots(file, name, fn, mod, verdicts) {
  /** @type {number[]} */
  const out = [];
  for (let i = 0; i < fn.params.length; i += 1) {
    const param = /** @type {{ def: string | null }} */ (fn.params[i]);
    if (param.def === null) continue;
    if (verdicts.get(`${file}#${name}#${String(i)}`) !== 'walks') continue;
    if (isTreeDirectory(foldPath(param.def, mod.src.path, mod.binds))) out.push(i);
  }
  return out;
}

/**
 * @param {string} blanked
 * @param {string} file
 * @param {Map<string, Mod>} mods
 * @param {Map<string, 'walks' | 'unknown'>} verdicts
 * @param {Set<string>} rootless
 * @returns {boolean}
 */
function walksWithNoRootOfItsOwn(blanked, file, mods, verdicts, rootless) {
  for (const call of callsIn(blanked)) {
    const target = resolveCallee(call.whole, file, mods);
    if (target === null) continue;
    if (rootless.has(target)) return true;
    const hash = target.lastIndexOf('#');
    const other = target.slice(0, hash);
    const name = target.slice(hash + 1);
    const mod = mods.get(other);
    const fn = mod?.fns.get(name);
    if (mod === undefined || fn === undefined) continue;
    for (const i of defaultedRoots(other, name, fn, mod, verdicts)) {
      if (call.args[i] === undefined) return true;
    }
  }
  return false;
}

/**
 * A parameter whose non-emptiness returns before anything is read, derived from
 * the guard in the body. `run(['--fix'])` and `run(['--set', 'rcr_bp'], emit)`
 * call a walking function and no walk happens.
 *
 * @param {Fn} fn
 * @returns {number | null}
 */
function argvGuardOf(fn) {
  for (let i = 0; i < fn.params.length; i += 1) {
    const name = /** @type {{ name: string }} */ (fn.params[i]).name;
    if (name === '') continue;
    const guard = new RegExp(
      `if\\s*\\(\\s*${name}\\.length\\s*(?:>\\s*0|!==?\\s*0)\\s*\\)\\s*\\{[\\s\\S]{0,800}?return`,
    );
    if (guard.test(fn.blanked)) return i;
  }
  return null;
}

// -----------------------------------------------------------------------------
// THE SUITE: EVERY CASE, AND WHETHER ITS INPUT IS THE TREE
// -----------------------------------------------------------------------------

/**
 * How many times each of the three forms was the evidence. Named rather than a
 * bare count, because leg A asserts that each one is still being read.
 *
 * @typedef {{ W1: number, W2: number, W3: number }} Forms
 */

/**
 * @typedef {object} Case
 * @property {string} file        repository-relative
 * @property {number} line
 * @property {string} title
 * @property {boolean} budgeted
 * @property {string[]} why       the evidence, one sentence per walk found
 */

/**
 * Every case declaration in a file.
 *
 * @param {Source} src
 * @returns {{ at: number, head: string, args: string[] }[]}
 */
export function caseSites(src) {
  /** @type {{ at: number, head: string, args: string[] }[]} */
  const out = [];
  const re = /(?<![\w$.])(test|it)((?:\.[A-Za-z_$][\w$]*)*)\s*\(/g;
  let m;
  while ((m = re.exec(src.blanked)) !== null) {
    let open = m.index + m[0].length - 1;
    let close = closingParen(src.blanked, open);
    if (close < 0) continue;
    // `test.each(table)(name, fn, timeout)`: the case's own call is the SECOND
    // one, and the timeout that matters is its third argument.
    const chain = /** @type {string} */ (m[2]);
    if (chain.includes('.each')) {
      const next = firstNonSpace(src.blanked, close + 1);
      if (src.blanked[next] !== '(') continue;
      open = next;
      close = closingParen(src.blanked, open);
      if (close < 0) continue;
    }
    const args = splitArgs(src.kept.slice(open + 1, close));
    if (args === null) continue;
    out.push({ at: m.index, head: `${/** @type {string} */ (m[1])}${chain}`, args });
    re.lastIndex = close;
  }
  return out;
}

/**
 * The text a case reaches: its own callback plus the bodies of every file-local
 * helper it calls, transitively.
 *
 * PARAMETER LISTS ARE NOT IN IT. A signature default is not a use, which is what
 * keeps `transcript(checks, root = REPO_ROOT)`s six cases out of the population:
 * they name the constant and scan nothing.
 *
 * @param {string} body
 * @param {Map<string, Fn>} helpers
 * @returns {string}
 */
export function reachableText(body, helpers) {
  /** @type {Set<string>} */
  const seen = new Set();
  let text = body;
  let frontier = [body];
  while (frontier.length > 0) {
    /** @type {string[]} */
    const next = [];
    for (const chunk of frontier) {
      for (const call of callsIn(chunk)) {
        if (call.whole.includes('.')) continue;
        const fn = helpers.get(call.whole);
        if (fn === undefined || seen.has(call.whole)) continue;
        seen.add(call.whole);
        next.push(fn.body);
        text += `\n${fn.body}`;
      }
    }
    frontier = next;
  }
  return text;
}

/**
 * @param {string} text
 * @param {string} file
 * @param {Mod} mod
 * @param {Map<string, Mod>} mods
 * @param {Map<string, 'walks' | 'unknown'>} verdicts
 * @param {Map<string, Walker>} walkers
 * @returns {string[]}
 */
export function walksIn(text, file, mod, mods, verdicts, walkers) {
  /** @type {string[]} */
  const why = [];
  for (const call of callsIn(text)) {
    const target = resolveCallee(call.whole, file, mods);

    // W1: an argument whose VALUE is a directory of this repository, unless the
    // callee is path composition, or is a function this fold has read whole and
    // which provably enumerates nothing with it.
    if (!COMPOSERS.includes(call.name)) {
      for (let i = 0; i < call.args.length; i += 1) {
        const arg = /** @type {string} */ (call.args[i]);
        const folded = foldPath(arg, mod.src.path, mod.binds);
        if (!isTreeDirectory(folded)) continue;
        if (target !== null) {
          const hash = target.lastIndexOf('#');
          const seen = verdicts.get(
            `${target.slice(0, hash)}#${target.slice(hash + 1)}#${String(i)}`,
          );
          if (seen === undefined) continue;
        }
        why.push(
          `W1 \`${call.whole}\` is handed ${rel(String(folded))} as argument ${String(i + 1)}`,
        );
      }
    }

    const walker = target === null ? undefined : walkers.get(target);
    if (walker === undefined) continue;

    // W2: a default-rooted walker with its root argument absent.
    for (const i of walker.rootParams) {
      if (call.args[i] === undefined) {
        why.push(
          `W2 \`${call.whole}()\` leaves argument ${String(i + 1)} of \`${walker.name}\` at its ` +
            'default, which is a directory of this repository',
        );
      }
    }

    // W3: a rootless walker, unless its own argv guard says this call returns first.
    if (walker.rootless && walker.rootParams.length === 0) {
      const guard = walker.argvGuard;
      const given = guard === null ? undefined : call.args[guard];
      const stopped = guard !== null && given !== undefined && !/^\[\s*\]$/.test(given.trim());
      if (!stopped) {
        why.push(`W3 \`${call.whole}()\` reaches a walk with no root of its own to override`);
      }
    }
  }
  return why;
}

/**
 * Every case in the suite, classified.
 *
 * @param {string} [suite]
 * @param {string} [checks]
 * @returns {{ cases: Case[], files: string[], walkers: Map<string, Walker>, forms: Forms }}
 */
export function census(suite = SUITE_DIR, checks = CHECKS_DIR) {
  const suiteFiles = readdirSync(suite)
    .filter((name) => name.endsWith('.test.ts'))
    .sort()
    .map((name) => join(suite, name));
  const checkFiles = readdirSync(checks)
    .filter((name) => name.endsWith('.mjs'))
    .sort()
    .map((name) => join(checks, name));

  const mods = model([...checkFiles, ...suiteFiles]);
  const verdicts = reaches(mods);
  const walkers = roster(mods, verdicts, checks);

  /** @type {Case[]} */
  const cases = [];
  /** @type {Forms} */
  const forms = { W1: 0, W2: 0, W3: 0 };

  for (const file of suiteFiles) {
    const mod = /** @type {Mod} */ (mods.get(file));
    for (const site of caseSites(mod.src)) {
      const text = reachableText(site.args[1] ?? '', mod.fns);
      const why = walksIn(text, file, mod, mods, verdicts, walkers);
      for (const one of why) forms[/** @type {keyof Forms} */ (one.slice(0, 2))] += 1;
      cases.push({
        file: rel(file),
        line: lineAt(mod.src.kept, site.at),
        title: titleOf(/** @type {string} */ (site.args[0] ?? '')),
        budgeted: site.args.some((a) => wordRe(BUDGET).test(a)),
        why,
      });
    }
  }
  return { cases, files: suiteFiles.map(rel), walkers, forms };
}

/**
 * A case's name, for the report. Looser than `LITERAL`, which folds PATHS and
 * must stay strict: a case title routinely quotes the other three quote
 * characters inside itself.
 *
 * @param {string} arg
 * @returns {string}
 */
function titleOf(arg) {
  const text = arg.trim();
  const quote = text[0];
  if ((quote === "'" || quote === '"' || quote === '`') && text.endsWith(quote)) {
    return text.slice(1, -1);
  }
  return text.split('\n')[0] ?? '';
}

// -----------------------------------------------------------------------------
// THE LEGS
// -----------------------------------------------------------------------------

/**
 * Leg A THROWS rather than reporting, because every finding below is an ABSENCE
 * and an absence check over an empty scope reports PASS in silence.
 *
 * @param {ReturnType<typeof census>} seen
 */
export function legDerivationIsReal(seen) {
  if (seen.files.length === 0) throw new Error(`no suite found under ${rel(SUITE_DIR)}`);
  if (seen.cases.length === 0) throw new Error(`no case found in ${rel(SUITE_DIR)}`);
  if (seen.walkers.size === 0) throw new Error(`no walker derived from ${rel(CHECKS_DIR)}`);
  if ([...seen.walkers.values()].every((w) => w.rootParams.length === 0)) {
    throw new Error('no DEFAULT-ROOTED walker derived, so form 3 is not being read at all');
  }
  if (!seen.walkers.has(`${join(CHECKS_DIR, 'price-register.mjs')}#derive`)) {
    throw new Error(
      'price-register.mjs#derive is not in the roster. It is the walk whose default is spelled ' +
        '`DECISIONS`, so its absence means the fold has stopped reading values and started ' +
        'reading names (ADR-468 section 3.2)',
    );
  }
  if (seen.forms.W1 === 0) throw new Error('no W1 walk found, so no root value is being folded');
  if (seen.forms.W2 === 0 && seen.forms.W3 === 0) {
    throw new Error('no W2 or W3 walk found, so no defaulted root is being read');
  }
}

/** @param {Case[]} cases @returns {string[]} */
export function legBudgetCarried(cases) {
  return cases
    .filter((c) => c.why.length > 0 && !c.budgeted)
    .map(
      (c) =>
        `${c.file}:${String(c.line)} \`${c.title}\` has this repository for an input and carries ` +
        `no ${BUDGET}. ${/** @type {string} */ (c.why[0])}`,
    );
}

/** @param {Case[]} cases @returns {string[]} */
export function legBudgetEarned(cases) {
  return cases
    .filter((c) => c.why.length === 0 && c.budgeted)
    .map(
      (c) =>
        `${c.file}:${String(c.line)} \`${c.title}\` carries ${BUDGET} and this fold finds no walk ` +
        'of this repository in it. A budget on a case whose input is a fixture is a wall twelve ' +
        'times the default doing nothing but bounding a hang',
    );
}

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------

const emit = (/** @type {string} */ line) => {
  console.log(line);
};

/**
 * @param {string[]} [argv]
 * @param {(line: string) => void} [out]
 * @returns {number}
 */
export function run(argv = [], out = emit) {
  const listing = argv.length === 1 && argv[0] === '--list';
  if (argv.length > 0 && !listing) {
    out('usage: node packages/tooling/checks/tree-input-budget.mjs [--list]');
    out('');
    out('It takes no argument. Every input it has is derived from the tree on the run.');
    return 2;
  }

  /** @type {ReturnType<typeof census>} */
  let seen;
  try {
    seen = census();
    legDerivationIsReal(seen);
  } catch (err) {
    out(`ERROR  the derivation did not run: ${String(err)}`);
    return 2;
  }

  const population = seen.cases.filter((one) => one.why.length > 0);

  if (listing) {
    out(`WALKERS  ${String(seen.walkers.size)} derived from ${rel(CHECKS_DIR)}`);
    for (const walker of [...seen.walkers.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      out(
        `         ${rel(walker.module)}#${walker.name}  ` +
          `rootParams=[${walker.rootParams.join(',')}] rootless=${String(walker.rootless)} ` +
          `argvGuard=${walker.argvGuard === null ? 'none' : String(walker.argvGuard)}`,
      );
    }
    out('');
    out(`POPULATION  ${String(population.length)} case(s) of ${String(seen.cases.length)}`);
    for (const one of population) {
      out(`         ${one.file}:${String(one.line)}  ${one.budgeted ? 'budgeted' : 'BARE'}`);
      for (const why of one.why) out(`             ${why}`);
    }
    return 0;
  }

  const findings = [...legBudgetCarried(seen.cases), ...legBudgetEarned(seen.cases)];

  if (findings.length === 0) {
    const suites = new Set(population.map((one) => one.file));
    out(
      `PASS   ${String(population.length)} case(s) over ${String(suites.size)} suite(s) have this ` +
        `repository for an input and every one carries ${BUDGET}; ` +
        `${String(seen.cases.length - population.length)} case(s) do not and none carries it; ` +
        `derived from ${String(seen.walkers.size)} walker(s) in ${rel(CHECKS_DIR)} over ` +
        `${String(seen.files.length)} suite file(s), by ${String(seen.forms.W1)} root value(s), ` +
        `${String(seen.forms.W2)} defaulted root(s) and ${String(seen.forms.W3)} rootless call(s)`,
    );
    return 0;
  }

  out(`FAIL   the budget does not follow the input (${String(findings.length)})`);
  for (const finding of findings) out(`       ${finding}`);
  out('');
  out(
    'THE BUDGET BELONGS TO THE INPUT. A case that walks a directory of this repository imports ' +
      `${BUDGET} from packages/tooling/test/scan-budget.ts and passes it as the third argument ` +
      'to `test()`. A case whose input is a fixture tree, a named file or a module keeps the ' +
      'framework default, because for it the only thing a timeout does is bound a hang. ' +
      '`node packages/tooling/checks/tree-input-budget.mjs --list` prints the population and the ' +
      'evidence for every member of it.',
  );
  return 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(run(process.argv.slice(2)));
