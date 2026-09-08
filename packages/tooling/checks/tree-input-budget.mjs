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
// that walks through a primitive not in `ENUMERATORS`.
//
// -----------------------------------------------------------------------------
// THE ROSTER IS MEASURED AND NOT ONLY DERIVED (`ADR-472`)
// -----------------------------------------------------------------------------
// `ADR-470` section 10 item 2 held the last gap open: a rostered function that
// STOPS walking keeps its roster entry and nothing notices, and a function that
// STARTS walking through a primitive outside `ENUMERATORS` never gets one. Both
// are failures of a roster derived from source alone, so both are answered by
// RUNNING the roster rather than by reading it harder.
//
//   Leg D  EVERY ROSTERED WALKER IS MEASURED ENUMERATING. Each one is called in
//          a child process against a PLANTED tree with a counted number of
//          files, and what it reads is recorded
//   Leg E  ANYTHING THAT ENUMERATES WHEN CALLED WITH NO ARGUMENT AT ALL IS IN
//          THE ROSTER. That is the roster's own definition run backwards, over
//          every exported function of `packages/tooling/checks/` whose
//          parameters all carry defaults
//
// THE HARD HALF IS DOING THAT WITHOUT A SECOND COPY OF EVERY CHECKER'S INPUTS,
// AND THE ANSWER IS THAT THE MEASUREMENT WATCHES THE ENUMERATION AND NEVER THE
// RESULT. A checker handed eight placeholder files instead of its corpus throws,
// and it throws AFTER it has enumerated, which is the only thing being asked.
// So the planted tree needs no fidelity to anything: one line of placeholder
// text, eight extensions, and a directory shape MATERIALISED ON DEMAND out of
// the paths the checker itself asks for. Nothing in this module knows what any
// checker's inputs mean, and nothing in it has to.
//
// THE INSTRUMENT IS A DORMANT PATCH OVER `node:fs` AND `node:child_process`,
// installed by `--import` in the child BEFORE any module of this repository is
// instantiated, and ARMED only around one call. While armed, every path inside
// this repository is served from the planted tree, every write and every spawn
// throws instead of happening, and `process.exit` throws. While disarmed it is
// a pass-through, which is what lets the child do its own bookkeeping through
// the same functions.
//
// A SPAWN COUNTS AS AN ENUMERATION AND THAT IS THE POINT. `git ls-files` is the
// primitive outside `ENUMERATORS` that section 3.4 item 3 named as invisible;
// the measurement sees it because it watches the process boundary rather than
// the parser.
//
// WHAT THE MEASUREMENT STILL CANNOT SEE, WRITTEN DOWN BEFORE ANYBODY ASKS. A
// walker whose walk is gated behind an argument this measurement will not
// invent is INCONCLUSIVE rather than clean: it is counted, named in the report
// and never reported as a finding. Leg E reaches only what can be called with
// no argument, which is a stated fraction of the exported surface. And a walker
// that enumerates only under some argument shape is a walker neither leg reaches.
// =============================================================================

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
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
 * @property {string} name      the callee's last identifier
 * @property {string} whole     the callee as written. A leading `.` means the
 *                              receiver is an expression, not a name
 * @property {string} receiver  the callee of the receiver CALL, when there is
 *                              one: `expect(x).toBe(y)` has receiver `expect`
 * @property {string[]} args
 * @property {number} at
 */

const CALLEE = /(?<![\w$])([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(?:<[^<>()]*>\s*)?\(/g;
const KEYWORDS = ['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'await', 'typeof'];

/**
 * Every call in a text, with its arguments split. A call whose arguments do not
 * balance is DROPPED rather than guessed at.
 *
 * STRUCTURE IS READ OFF `blanked` AND ARGUMENT TEXT OFF `kept`, at the same
 * offsets. Reading structure off the kept side made the fixture sources inside
 * this check's OWN suite into code: a `run()` written inside a template literal
 * was folded as a call, and the check reported its own test file as a case that
 * walks the tree. A string is data in every file, including the ones that quote
 * this repository at themselves.
 *
 * @param {string} blanked
 * @param {string} [kept]
 * @returns {Call[]}
 */
export function callsIn(blanked, kept = blanked) {
  /** @type {Call[]} */
  const out = [];
  for (const m of blanked.matchAll(CALLEE)) {
    const written = /** @type {string} */ (m[1]);
    if (KEYWORDS.includes(written)) continue;
    const open = m.index + m[0].length - 1;
    const close = closingParen(blanked, open);
    if (close < 0) continue;
    const args = splitArgs(kept.slice(open + 1, close));
    if (args === null) continue;
    const parts = written.split('.');
    // `check(id).run(root)`: the receiver is a CALL, so the match starts after a
    // `.` with no name in front of it. Recorded as `.run`, which is dotted, which
    // is unresolvable, which is exactly what it is.
    const dotted = blanked[m.index - 1] === '.';
    out.push({
      name: /** @type {string} */ (parts[parts.length - 1]),
      whole: dotted ? `.${written}` : written,
      receiver: dotted ? receiverOf(blanked, m.index - 1) : '',
      args,
      at: m.index,
    });
  }
  return out;
}

/**
 * The callee of the call a dotted call hangs off, or `''`. `expect(x).toBe(y)`
 * answers `expect`, which is how a MATCHER is told from a reader: a matcher
 * compares a directory and never opens one.
 *
 * @param {string} blanked
 * @param {number} dot   index of the `.`
 * @returns {string}
 */
function receiverOf(blanked, dot) {
  let i = dot - 1;
  while (i >= 0 && /[\w$.]/.test(/** @type {string} */ (blanked[i]))) i -= 1;
  if (blanked[i] !== ')') return '';
  let depth = 0;
  for (; i >= 0; i -= 1) {
    const ch = blanked[i];
    if (ch === ')') depth += 1;
    else if (ch === '(') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (i < 0) return '';
  const before = /([A-Za-z_$][\w$]*)$/.exec(blanked.slice(0, i));
  return before === null ? '' : /** @type {string} */ (before[1]);
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
 * A closure argument does not hand its enclosing root to the callee: it CAPTURES
 * it, and its own body is already being read as part of the same body. Reading
 * `names.filter((name) => existsSync(resolve(dir, name)))` as "dir was handed to
 * something unresolvable" makes every callback in the estate a walk.
 *
 * @param {string} arg
 * @returns {boolean}
 */
function isClosure(arg) {
  let depth = 0;
  for (let i = 0; i < arg.length; i += 1) {
    const ch = arg[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (depth === 0 && ch === '=' && arg[i + 1] === '>') return true;
  }
  return /^(?:async\s+)?function\b/.test(arg.trim());
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
    const holder = call.args.findIndex(
      (a) => !isClosure(a) && [...carriers].some((c) => wordRe(c).test(a)),
    );
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
      `if\\s*\\(\\s*${name}\\.length\\s*(?:>\\s*0|!==?\\s*0)\\s*\\)\\s*\\{?[\\s\\S]{0,800}?return`,
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
 * @typedef {object} CaseSite
 * @property {number} at
 * @property {string} head
 * @property {string[]} args         literals kept, for the title
 * @property {string[]} blankedArgs  literals blanked, for anything COUNTED
 * @property {{ kept: string, blanked: string }} callback
 */

/**
 * Every case declaration in a file.
 *
 * @param {Source} src
 * @returns {CaseSite[]}
 */
export function caseSites(src) {
  /** @type {CaseSite[]} */
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
    const blanked = splitArgs(src.blanked.slice(open + 1, close));
    if (args === null || blanked === null || args.length !== blanked.length) continue;
    out.push({
      at: m.index,
      head: `${/** @type {string} */ (m[1])}${chain}`,
      args,
      blankedArgs: blanked,
      callback: { kept: args[1] ?? '', blanked: blanked[1] ?? '' },
    });
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
 * @param {{ kept: string, blanked: string }} body
 * @param {Map<string, Fn>} helpers
 * @returns {{ kept: string, blanked: string }}
 */
export function reachableText(body, helpers) {
  /** @type {Set<string>} */
  const seen = new Set();
  let kept = body.kept;
  let blanked = body.blanked;
  let frontier = [body];
  while (frontier.length > 0) {
    /** @type {{ kept: string, blanked: string }[]} */
    const next = [];
    for (const chunk of frontier) {
      for (const call of callsIn(chunk.blanked, chunk.kept)) {
        if (call.whole.includes('.')) continue;
        const fn = helpers.get(call.whole);
        if (fn === undefined || seen.has(call.whole)) continue;
        seen.add(call.whole);
        next.push({ kept: fn.body, blanked: fn.blanked });
        kept += `\n${fn.body}`;
        blanked += `\n${fn.blanked}`;
      }
    }
    frontier = next;
  }
  return { kept, blanked };
}

/**
 * @param {{ kept: string, blanked: string }} text
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
  for (const call of callsIn(text.blanked, text.kept)) {
    const target = resolveCallee(call.whole, file, mods);

    // W1: an argument whose VALUE is a directory of this repository, unless the
    // callee is path composition, or a MATCHER, which compares a directory and
    // never opens one, or a function this fold has read whole and which provably
    // enumerates nothing with it.
    if (!COMPOSERS.includes(call.name) && call.receiver !== 'expect') {
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
 * @returns {{ cases: Case[], files: string[], walkers: Map<string, Walker>, forms: Forms, mods: Map<string, Mod> }}
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
      const text = reachableText(site.callback, mod.fns);
      const why = walksIn(text, file, mod, mods, verdicts, walkers);
      for (const one of why) forms[/** @type {keyof Forms} */ (one.slice(0, 2))] += 1;
      cases.push({
        file: rel(file),
        line: lineAt(mod.src.kept, site.at),
        title: titleOf(/** @type {string} */ (site.args[0] ?? '')),
        // COUNTED OFF THE BLANKED READING. A constant written inside a string
        // is not a budget, and this check's own suite quotes fixture sources
        // that carry it: read off the kept side, three fixtures made their
        // enclosing case look budgeted and leg C reported all three.
        budgeted: site.blankedArgs.some((a) => wordRe(BUDGET).test(a)),
        why,
      });
    }
  }
  return { cases, files: suiteFiles.map(rel), walkers, forms, mods };
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
// THE MEASURED ROSTER
// -----------------------------------------------------------------------------
// `ADR-472`. Everything above derives the roster by reading source. Everything
// below RUNS it, in a child process, against a tree this module plants and
// counts. The two derivations share no step, which is the only reason either
// one is worth believing.
// -----------------------------------------------------------------------------

/** This module, by path. The child is this same file in another mode. */
export const SELF = fileURLToPath(import.meta.url);

/** Set in the child, so a measured `run()` cannot spawn a measurement of its own. */
export const MEASURE_ENV = 'MERIT_TREE_INPUT_BUDGET_MEASURING';

/** The child mode's flag. Not a user-facing option and the usage text omits it. */
export const MEASURE_CHILD = '--measure-child';

/**
 * The extensions the planted files carry, AS A FLOOR AND NO LONGER AS THE WHOLE
 * SET (`ADR-474`). It is a list of suffixes rather than a copy of anything: a
 * checker that filters its listing to `.sql` has to find at least one `.sql`
 * name in it or the measurement learns nothing about what it reads. The content
 * behind every one of them is `PLANTED_LINE`.
 *
 * IT STAYS WRITTEN DOWN BECAUSE THE DERIVATION DOES NOT REACH ALL EIGHT.
 * Nothing under `packages/tooling/checks/` spells `.yml` or `.txt` in a suffix
 * test at all, so a set that REPLACED this list rather than adding to it would
 * plant fewer kinds of name than the list it replaced, which is the same silent
 * thinning `ADR-472` section 10 item 4 is about, arriving from the other side.
 */
export const PLANTED_EXTENSIONS = [
  '.mjs',
  '.ts',
  '.test.ts',
  '.md',
  '.sql',
  '.json',
  '.yml',
  '.txt',
];

/** What every planted file contains. One line, the same line, every time. */
export const PLANTED_LINE = '// merit tree-input-budget planted file; no checker input is here\n';

// -----------------------------------------------------------------------------
// THE EXTENSION SET, READ OUT OF THE CHECKERS THEMSELVES (`ADR-474`)
// -----------------------------------------------------------------------------
// `ADR-472` section 10 item 4 named the gap and it is quoted rather than
// paraphrased:
//
//   "THE PLANTED TREE KNOWS EIGHT EXTENSIONS AND THEY ARE WRITTEN DOWN.
//    `PLANTED_EXTENSIONS` is the single place where the measurement carries
//    knowledge about what a checker's inputs look like. A checker filtering on a
//    ninth would enumerate a directory whose every name it rejects, which shows
//    as an enumeration with no reads and is still a correct verdict, but the
//    read comparison silently stops being available for it."
//
// SO THE SET IS READ OUT OF THE CHECKERS' OWN SUFFIX TESTS AND UNIONED WITH THE
// FLOOR. One shape is parsed and it is the one this module already parses: the
// single string-literal argument of `endsWith`, taken off `callsIn`, structure
// from the blanked side and text from the kept one, exactly as everything else
// here reads a literal.
//
// WHAT THIS PARSE DOES WHEN IT CANNOT DECIDE, WRITTEN DOWN BEFORE ANYBODY ASKS,
// BECAUSE `ADR-470` SECTION 7 HOLDS FOUR PARSING DEFECTS OPEN AND EVERY ONE OF
// THEM FAILED SILENTLY BY LOSING SOMETHING. This is the fifth parse in this
// module and it is built so that its errors are GAINS:
//
//   IT ADDS AND NEVER SUBTRACTS. The floor is a floor. A suffix this parse
//   fails to find is still planted if it was written down, so the worst a miss
//   can do is leave the set where it already was. A parse that REPLACED the
//   floor would turn every miss into exactly the silent thinning it exists to
//   end
//   A CANDIDATE IT CANNOT RULE OUT IS PLANTED. `endsWith('_at')` is a column
//   name and `endsWith('package.json')` is a whole filename, and neither is an
//   extension. Both are planted anyway, because a name carrying a suffix
//   nothing filters on costs one file and serves nothing, while a name missing
//   a suffix something DOES filter on costs the read comparison
//   A LITERAL NO FILE CAN CARRY IS REFUSED AND COUNTED, NEVER DROPPED IN
//   SILENCE. `endsWith('/')` in `absence-claims.mjs` is a suffix test on a PATH
//   and not on a name, and no directory can hold a file whose name ends in a
//   separator. Those literals are named in `--list` and counted in the report
//   AN ARGUMENT THAT IS NOT A LITERAL IS COUNTED TOO, as `unfolded`. It is the
//   only class this parse genuinely cannot see through, and a number that moves
//   is a reader's signal that it grew
//   AND A PARSE THAT DECIDES NOTHING AT ALL THROWS. `legSuffixesAreDerived` is
//   leg A applied to this derivation: falling back to the floor and reporting a
//   figure indistinguishable from a working one is the defect, not the remedy
//
// WHAT IT STILL CANNOT SERVE, AND EXTENSIONS ARE NOT THE ONLY WAY TO REJECT A
// NAME. `price-register.mjs` filters its listing with `/^ADR-\d+\.md$/`, which
// requires a name PREFIX. `merit-planted-1.md` carries the extension and fails
// the pattern, so both of that checker's rostered walkers enumerate and read
// nothing, on this tree, today, before this row touched anything. Inventing a
// name to satisfy a pattern is the fidelity to checker inputs `ADR-472` section
// 3.2 refused, so it is not attempted. `enumeratesUnread` MEASURES the residue
// instead of parsing for it, and the report states the count.
// -----------------------------------------------------------------------------

/** The call whose single string-literal argument is the tail of a filename. */
export const SUFFIX_TESTS = ['endsWith'];

/**
 * What a name a directory can actually hold may end in. `'/'`, `')'` and
 * `'/${target}'` are all real arguments of real suffix tests in this tree and
 * none of them is a filename tail.
 */
const PLANTABLE_SUFFIX = /^[\w.+-]{1,64}$/;

/**
 * @typedef {object} Suffixes
 * @property {string[]} derived   suffixes read out of the checkers themselves
 * @property {string[]} refused   literals no planted name can carry, kept by
 *                                name so the report can state them
 * @property {number} unfolded    suffix tests whose argument is not a literal
 */

/**
 * EVERY SUFFIX THE CHECKERS THEMSELVES TEST A FILENAME AGAINST.
 *
 * @param {Map<string, Mod>} mods
 * @param {string} [checks]
 * @returns {Suffixes}
 */
export function suffixLiterals(mods, checks = CHECKS_DIR) {
  /** @type {Set<string>} */
  const derived = new Set();
  /** @type {Set<string>} */
  const refused = new Set();
  let unfolded = 0;
  for (const [file, mod] of mods) {
    if (relative(checks, file).startsWith('..')) continue;
    for (const call of callsIn(mod.src.blanked, mod.src.kept)) {
      if (!SUFFIX_TESTS.includes(call.name) || call.args.length !== 1) continue;
      const literal = LITERAL.exec(/** @type {string} */ (call.args[0]).trim());
      if (literal === null) {
        unfolded += 1;
        continue;
      }
      const text = /** @type {string} */ (literal[2]);
      if (PLANTABLE_SUFFIX.test(text)) derived.add(text);
      else refused.add(text);
    }
  }
  return { derived: [...derived].sort(), refused: [...refused].sort(), unfolded };
}

/**
 * The floor and the derivation together. THE UNION AND NOT THE DERIVATION, for
 * the reason `PLANTED_EXTENSIONS` gives.
 *
 * @param {Map<string, Mod>} mods
 * @param {string} [checks]
 * @param {string[]} [floor]
 * @returns {string[]}
 */
export function plantedExtensions(mods, checks = CHECKS_DIR, floor = PLANTED_EXTENSIONS) {
  return [...new Set([...floor, ...suffixLiterals(mods, checks).derived])].sort();
}

/**
 * Leg A for the extension derivation. A parse that decides NOTHING is the
 * silent failure `ADR-470` section 7 holds four instances of, so it THROWS
 * rather than falling back to the floor and reporting a figure a reader cannot
 * tell from a working one.
 *
 * @param {Suffixes} suffixes
 */
export function legSuffixesAreDerived(suffixes) {
  if (suffixes.derived.length === 0) {
    throw new Error(
      `not one ${SUFFIX_TESTS.join('/')} literal was read out of ${rel(CHECKS_DIR)}, so the ` +
        'planted tree is running on its written floor alone and the derivation reads nothing',
    );
  }
}

/**
 * TWO ROUNDS, DIFFERING ONLY IN HOW MANY FILES ARE PLANTED PER DIRECTORY. A
 * named read of one file reads the same one file in both; an enumeration reads
 * more in the second. The comparison is the measurement `ADR-470` section 10
 * item 2 asked for, and the round tags appear in the report.
 *
 * PER DIRECTORY IS A MULTIPLE OF THE EXTENSION COUNT AND NOT A NUMBER
 * (`ADR-474`). `plant` cycles the extensions, so a round planting fewer files
 * than there are extensions never reaches the last of them: with the set
 * written as eight and the small round written as 8, a ninth extension would
 * have been planted in the LARGE round only, and the comparison that ninth
 * exists to make possible would have compared nothing against nothing. At the
 * floor's eight these are 8 and 24, which is what they were written as.
 */
export const ROUND_SIZES = [
  { tag: 'small', perExtension: 1 },
  { tag: 'large', perExtension: 3 },
];

/**
 * @param {string[]} ext
 * @returns {{ tag: string, perDir: number }[]}
 */
export function roundsFor(ext) {
  return ROUND_SIZES.map((one) => ({ tag: one.tag, perDir: ext.length * one.perExtension }));
}

/** The rounds the written floor alone gives, which is what they used to be. */
export const ROUNDS = roundsFor(PLANTED_EXTENSIONS);

/** A ceiling on materialised directories, so a walker cannot plant forever. */
export const PLANT_CAP = 200;

/**
 * The denominator leg E's population is a fraction of: every exported function
 * of the checks directory. A report that states seven without stating the
 * surface it is seven of is a report about a population nobody can size, which
 * is the defect this whole estate is about.
 *
 * @param {Map<string, Mod>} mods
 * @param {string} [checks]
 * @returns {number}
 */
export function exportedSurface(mods, checks = CHECKS_DIR) {
  let total = 0;
  for (const [file, mod] of mods) {
    if (relative(checks, file).startsWith('..')) continue;
    for (const fn of mod.fns.values()) if (fn.exported) total += 1;
  }
  return total;
}

/**
 * THE DORMANT PATCH, INSTALLED BY `--import` BEFORE ANY MODULE OF THIS
 * REPOSITORY IS INSTANTIATED.
 *
 * It must run before anything else because an ESM `import { readdirSync }`
 * binds at instantiation: patching the module afterwards reaches nothing that
 * is already loaded, which was measured rather than assumed. `--import` is the
 * only ordering guarantee available, and the patch is a `data:` module so that
 * it can import nothing of this repository and leave no file behind.
 *
 * WHILE DISARMED IT IS A PASS-THROUGH. `fixture === null` is the disarmed
 * state, and the child does all of its own bookkeeping in it, through these
 * same functions.
 *
 * @param {string} repoRoot
 * @param {string} self
 * @param {string[]} [ext]  the planted extension set, derived by `run` and
 *                          defaulting to the written floor
 * @returns {string}
 */
export function measurementPatch(repoRoot, self, ext = PLANTED_EXTENSIONS) {
  return `
const { createRequire } = await import('node:module');
const require = createRequire(${JSON.stringify(self)});
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const S = {
  repoRoot: ${JSON.stringify(repoRoot)},
  fixture: null,
  perDir: 0,
  ext: ${JSON.stringify(ext)},
  line: ${JSON.stringify(PLANTED_LINE)},
  cap: ${String(PLANT_CAP)},
  materialised: new Set(),
  planted: new Set(),
  enumerated: new Set(),
  read: new Set(),
  touched: 0,
  named: 0,
  spawned: [],
  wrote: [],
};
globalThis.__meritTreeInputBudgetMeasure = S;
const real = {
  mkdirSync: fs.mkdirSync,
  writeFileSync: fs.writeFileSync,
  existsSync: fs.existsSync,
};
const inRepo = (p) =>
  typeof p === 'string' && (p === S.repoRoot || p.startsWith(S.repoRoot + path.sep));
const to = (p) => (S.fixture !== null && inRepo(p) ? S.fixture + p.slice(S.repoRoot.length) : p);
const under = (q) =>
  S.fixture !== null &&
  typeof q === 'string' &&
  (q === S.fixture || q.startsWith(S.fixture + path.sep));
const plant = (dir) => {
  if (S.materialised.has(dir) || S.materialised.size >= S.cap) return;
  S.materialised.add(dir);
  real.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < S.perDir; i += 1) {
    const f = path.join(dir, 'merit-planted-' + String(i + 1) + S.ext[i % S.ext.length]);
    real.writeFileSync(f, S.line);
    S.planted.add(f);
  }
};
const wrap = (host, names, kind) => {
  for (const name of names) {
    const orig = host[name];
    if (typeof orig !== 'function') continue;
    host[name] = (...a) => {
      if (S.fixture === null) return orig(...a);
      if (kind === 'write') {
        S.wrote.push(String(a[0]));
        throw new Error('a measured run may not write');
      }
      if (kind === 'spawn') {
        S.spawned.push((String(a[0]) + ' ' + (Array.isArray(a[1]) ? a[1].join(' ') : '')).trim());
        throw new Error('a measured run may not spawn');
      }
      const q = to(a[0]);
      if (under(q)) {
        S.touched += 1;
        if (kind === 'enum') {
          S.enumerated.add(q);
          if (!real.existsSync(q)) plant(q);
        }
        if (kind === 'read') {
          if (S.planted.has(q)) S.read.add(q);
          // A NAMED READ IS ANSWERED RATHER THAN REFUSED, and it is counted
          // apart from the planted tree so that the count comparison stays a
          // comparison. A walker whose first act is to read one file by name
          // would otherwise die on ENOENT before reaching its walk, and leg D
          // would call it stale for a file the measurement failed to provide.
          else if (S.named < S.cap && !real.existsSync(q)) {
            S.named += 1;
            real.mkdirSync(path.dirname(q), { recursive: true });
            real.writeFileSync(q, S.line);
          }
        }
      }
      return orig(q, ...a.slice(1));
    };
  }
};
wrap(fs, ${JSON.stringify(ENUMERATORS)}, 'enum');
wrap(fs, ['readFileSync', 'readFile', 'openSync'], 'read');
wrap(fs, ['statSync', 'lstatSync', 'existsSync'], 'stat');
wrap(
  fs,
  ['writeFileSync', 'appendFileSync', 'mkdirSync', 'rmSync', 'rmdirSync', 'unlinkSync',
   'renameSync', 'copyFileSync', 'cpSync', 'symlinkSync', 'chmodSync', 'truncateSync',
   'writeFile', 'appendFile', 'mkdir', 'rm', 'unlink', 'rename', 'createWriteStream'],
  'write',
);
wrap(cp, ['execSync', 'execFileSync', 'spawnSync', 'exec', 'execFile', 'spawn', 'fork'], 'spawn');
require('node:fs');
require('node:child_process');
const exit = process.exit;
process.exit = (code) => {
  if (S.fixture === null) return exit(code);
  throw new Error('a measured run may not exit');
};
`;
}

/**
 * @typedef {object} State
 * @property {string | null} fixture
 * @property {number} perDir
 * @property {Set<string>} materialised
 * @property {Set<string>} planted
 * @property {Set<string>} enumerated
 * @property {Set<string>} read
 * @property {number} touched
 * @property {number} named
 * @property {string[]} spawned
 * @property {string[]} wrote
 */

/** @returns {State | null} */
function measurementState() {
  const held = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (globalThis))[
    '__meritTreeInputBudgetMeasure'
  ];
  return held === undefined ? null : /** @type {State} */ (held);
}

/**
 * @typedef {object} Invocation
 * @property {string} module
 * @property {string} name
 * @property {boolean} rostered
 * @property {('default' | 'empty')[]} args
 */

/**
 * WHAT TO CALL, AND WITH WHAT.
 *
 * A ROSTERED WALKER IS CALLED WITH ITS DEFAULTS IN PLACE. Every parameter that
 * has a default is passed `undefined`, which is what makes the default apply,
 * and every parameter that has none is passed the EMPTY ARRAY. The empty array
 * is uniform and is never anything shaped like a checker's real input: a walker
 * that will not walk on an empty argument is reported INCONCLUSIVE rather than
 * as a finding, which is the honest reading of what was measured.
 *
 * A PROBE IS CALLED WITH NO ARGUMENT AT ALL, and the probe set is every
 * exported function of the checks directory whose parameters ALL carry
 * defaults. That is the roster's own definition run backwards: a function that
 * enumerates with nothing supplied has a defaulted root or is rootless, so it
 * belongs in the roster, and leg E says so.
 *
 * @param {Map<string, Mod>} mods
 * @param {Map<string, Walker>} walkers
 * @param {string} [checks]
 * @returns {Invocation[]}
 */
export function measurementPlan(mods, walkers, checks = CHECKS_DIR) {
  /** @type {Invocation[]} */
  const calls = [];
  for (const walker of walkers.values()) {
    const fn = mods.get(walker.module)?.fns.get(walker.name);
    if (fn === undefined) continue;
    calls.push({
      module: walker.module,
      name: walker.name,
      rostered: true,
      args: fn.params.map(
        (p) => /** @type {'default' | 'empty'} */ (p.def === null ? 'empty' : 'default'),
      ),
    });
  }
  for (const [file, mod] of mods) {
    if (relative(checks, file).startsWith('..')) continue;
    for (const [name, fn] of mod.fns) {
      if (!fn.exported) continue;
      if (walkers.has(`${file}#${name}`)) continue;
      if (!fn.params.every((p) => p.def !== null)) continue;
      calls.push({ module: file, name, rostered: false, args: [] });
    }
  }
  return calls;
}

/**
 * @typedef {object} Row
 * @property {string} round
 * @property {number} perDir
 * @property {string} module
 * @property {string} name
 * @property {boolean} rostered
 * @property {number} dirs      distinct directories enumerated under the planted root
 * @property {number} planted   files planted for this call
 * @property {number} read      distinct planted files opened
 * @property {number} touched   any access at all under the planted root
 * @property {number} named     files the run asked for BY NAME and was given
 * @property {string[]} spawned
 * @property {string[]} wrote
 * @property {string | null} error
 */

/**
 * THE PARENT HALF. One child process, both rounds, every call.
 *
 * A MEASUREMENT THAT DID NOT RUN IS NOT A MEASUREMENT, so a child that fails
 * throws here rather than returning an empty list that would read as clean.
 *
 * @param {Invocation[]} calls
 * @param {string} [self]
 * @param {string[]} [ext]
 * @returns {Row[]}
 */
export function measure(calls, self = SELF, ext = PLANTED_EXTENSIONS) {
  const base = mkdtempSync(join(tmpdir(), 'merit-measured-roster-'));
  const spec = join(base, 'spec.json');
  const out = join(base, 'out.json');
  const patch = `data:text/javascript,${encodeURIComponent(measurementPatch(REPO_ROOT, self, ext))}`;
  try {
    writeFileSync(spec, JSON.stringify({ base, out, calls, rounds: roundsFor(ext) }));
    execFileSync(process.execPath, ['--import', patch, self, MEASURE_CHILD, spec], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, [MEASURE_ENV]: '1' },
      timeout: 300_000,
    });
    return /** @type {Row[]} */ (JSON.parse(readFileSync(out, 'utf8')));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

/**
 * THE CHILD HALF. It runs with the patch installed and disarmed, imports every
 * module it will call BEFORE arming anything so that import-time work is not
 * attributed to any call, then arms the patch around one call at a time.
 *
 * @param {string} specPath
 * @returns {Promise<number>}
 */
export async function measureChild(specPath) {
  const state = measurementState();
  if (state === null) {
    process.stderr.write('the measurement patch is not installed, so nothing was measured\n');
    return 2;
  }
  const spec =
    /** @type {{ base: string, out: string, calls: Invocation[], rounds: typeof ROUNDS }} */ (
      JSON.parse(readFileSync(specPath, 'utf8'))
    );

  /** @type {Map<string, Record<string, unknown> | null>} */
  const loaded = new Map();
  for (const call of spec.calls) {
    if (loaded.has(call.module)) continue;
    try {
      loaded.set(call.module, await import(pathToFileURL(call.module).href));
    } catch {
      loaded.set(call.module, null);
    }
  }

  const quiet = { log: console.log, error: console.error, warn: console.warn };
  /** @type {Row[]} */
  const rows = [];
  for (const round of spec.rounds) {
    for (let i = 0; i < spec.calls.length; i += 1) {
      const call = /** @type {Invocation} */ (spec.calls[i]);
      const fixture = join(spec.base, round.tag, String(i));
      // THE PLANTED ROOT IS LEFT UNCREATED ON PURPOSE. Creating it here made a
      // walker that enumerates the root itself find an EMPTY directory that
      // already existed, so nothing was planted into it and the run read zero
      // of zero files. Materialisation is on demand, and the root is the first
      // thing demanded.
      mkdirSync(dirname(fixture), { recursive: true });
      state.materialised.clear();
      state.planted.clear();
      state.enumerated.clear();
      state.read.clear();
      state.touched = 0;
      state.named = 0;
      state.spawned.length = 0;
      state.wrote.length = 0;
      state.perDir = round.perDir;
      /** @type {string | null} */
      let error = null;
      console.log = () => {};
      console.error = () => {};
      console.warn = () => {};
      state.fixture = fixture;
      try {
        const mod = loaded.get(call.module);
        const fn = mod === null || mod === undefined ? undefined : mod[call.name];
        if (typeof fn !== 'function') throw new Error('not an exported function');
        /** @type {(...a: unknown[]) => unknown} */ (fn)(
          ...call.args.map((kind) => (kind === 'default' ? undefined : [])),
        );
      } catch (err) {
        error = String(err instanceof Error ? err.message : err).slice(0, 200);
      } finally {
        state.fixture = null;
        console.log = quiet.log;
        console.error = quiet.error;
        console.warn = quiet.warn;
      }
      rows.push({
        round: round.tag,
        perDir: round.perDir,
        module: call.module,
        name: call.name,
        rostered: call.rostered,
        dirs: state.enumerated.size,
        planted: state.planted.size,
        read: state.read.size,
        touched: state.touched,
        named: state.named,
        spawned: [...state.spawned],
        wrote: [...state.wrote],
        error,
      });
    }
  }
  writeFileSync(spec.out, JSON.stringify(rows));
  return 0;
}

/**
 * @typedef {object} Verdict
 * @property {boolean} rostered
 * @property {number} dirs      the most directories enumerated in any round
 * @property {number} touched   the most accesses of any kind in any round
 * @property {number} named     the most named files answered in any round
 * @property {string[]} spawns
 * @property {number[]} read    planted files opened, one per round, in order
 * @property {number[]} planted files planted, one per round, in order
 * @property {string | null} error
 */

/**
 * ONE VERDICT PER FUNCTION, FOLDED OVER THE ROUNDS.
 *
 * @param {Row[]} rows
 * @returns {Map<string, Verdict>}
 */
export function measuredVerdicts(rows) {
  /** @type {Map<string, Verdict>} */
  const out = new Map();
  for (const row of rows) {
    const id = `${row.module}#${row.name}`;
    const held = out.get(id) ?? {
      rostered: row.rostered,
      dirs: 0,
      touched: 0,
      named: 0,
      spawns: [],
      read: [],
      planted: [],
      error: null,
    };
    held.dirs = Math.max(held.dirs, row.dirs);
    held.touched = Math.max(held.touched, row.touched);
    held.named = Math.max(held.named, row.named);
    for (const one of row.spawned) if (!held.spawns.includes(one)) held.spawns.push(one);
    held.read.push(row.read);
    held.planted.push(row.planted);
    if (held.error === null) held.error = row.error;
    out.set(id, held);
  }
  return out;
}

/** @param {Verdict} v @returns {boolean} */
export const enumerates = (v) => v.dirs > 0 || v.spawns.length > 0;

/**
 * ENUMERATED, AND OPENED NOTHING THE PLANTED TREE HELD. `ADR-472` section 10
 * item 4 is this shape exactly: a checker filtering on a name the planted tree
 * does not carry enumerates a directory whose every name it rejects. The
 * verdict stays right and the READ COMPARISON stops being available for it, so
 * leg D's evidence thins with nothing saying so.
 *
 * IT IS COUNTED AND NAMED, AND IT IS NOT A FINDING. A walker that enumerates
 * names and never opens one is doing its job, and a leg that reddened on this
 * would be this check inventing a defect out of its own planted tree. The count
 * stands beside `inconclusive` in the report, which is the same standing for
 * the same reason, and a diff that moves it from two to three is visible there.
 *
 * @param {Verdict} v @returns {boolean}
 */
export const enumeratesUnread = (v) => enumerates(v) && v.read.every((n) => n === 0);

/** @param {Verdict} v @returns {boolean} */
export const grewWithTheTree = (v) =>
  v.read.length > 1 &&
  v.read.some((n, i) => i > 0 && n > 0 && n > /** @type {number} */ (v.read[i - 1]));

/**
 * LEG D. EVERY ROSTERED WALKER IS MEASURED ENUMERATING.
 *
 * THE THREE OUTCOMES ARE NOT TWO. A walker that enumerates or spawns is
 * measured. A walker that reads the planted tree and enumerates NOTHING in it
 * is a finding, because its roster entry says it walks and the run says it
 * reads. A walker that never reached the planted tree at all is INCONCLUSIVE,
 * because the empty argument it was handed is the likelier explanation, and a
 * finding raised on that would be this check inventing a defect.
 *
 * @param {Map<string, Verdict>} verdicts
 * @returns {string[]}
 */
export function legRosterIsMeasured(verdicts) {
  /** @type {string[]} */
  const out = [];
  for (const [id, v] of verdicts) {
    if (!v.rostered || enumerates(v)) continue;
    if (v.touched === 0) continue;
    const hash = id.lastIndexOf('#');
    out.push(
      `${rel(id.slice(0, hash))}#${id.slice(hash + 1)} is in the roster and a measured run of it ` +
        `reads a planted tree ${String(v.touched)} time(s) and enumerates no directory of it. ` +
        'The roster says this function walks and the run says it does not, so one of the two is ' +
        'stale (ADR-472)',
    );
  }
  return out;
}

/**
 * LEG E. ANYTHING THAT ENUMERATES WITH NO ARGUMENT AT ALL IS IN THE ROSTER.
 *
 * This is the direction a fold over source cannot cover: a function that walks
 * through a primitive `ENUMERATORS` does not name never gets an entry, and
 * `git ls-files` is the live example. The measurement sees a spawn because it
 * watches the process boundary rather than the parser.
 *
 * @param {Map<string, Verdict>} verdicts
 * @returns {string[]}
 */
export function legRosterIsComplete(verdicts) {
  /** @type {string[]} */
  const out = [];
  for (const [id, v] of verdicts) {
    if (v.rostered || !enumerates(v)) continue;
    const hash = id.lastIndexOf('#');
    const how =
      v.spawns.length > 0
        ? `spawns \`${/** @type {string} */ (v.spawns[0])}\``
        : `enumerates ${String(v.dirs)} directory(ies)`;
    out.push(
      `${rel(id.slice(0, hash))}#${id.slice(hash + 1)} ${how} when it is called with no argument ` +
        'at all, and it is not in the roster. A walk reached with nothing supplied is a defaulted ' +
        'root or a rootless walker by definition, so the roster is missing it (ADR-472)',
    );
  }
  return out;
}

/**
 * The three counts the report states, so that a PASS names the population it
 * measured rather than the one it hoped for.
 *
 * @param {Map<string, Verdict>} verdicts
 * @returns {{ rostered: number, measured: number, inconclusive: number, probed: number, grew: number, spawning: string[], blinded: string[] }}
 */
export function measuredSummary(verdicts) {
  let rostered = 0;
  let measured = 0;
  let inconclusive = 0;
  let probed = 0;
  let grew = 0;
  /** @type {string[]} */
  const spawning = [];
  /** @type {string[]} */
  const blinded = [];
  for (const [id, v] of verdicts) {
    if (!v.rostered) {
      probed += 1;
      continue;
    }
    rostered += 1;
    if (enumerates(v)) measured += 1;
    else if (v.touched === 0) inconclusive += 1;
    if (grewWithTheTree(v)) grew += 1;
    const hash = id.lastIndexOf('#');
    const name = `${rel(id.slice(0, hash))}#${id.slice(hash + 1)}`;
    if (v.spawns.length > 0) spawning.push(name);
    if (enumeratesUnread(v)) blinded.push(name);
  }
  return { rostered, measured, inconclusive, probed, grew, spawning, blinded };
}

/**
 * Leg A for the measurement: a measured roster in which nothing was measured is
 * an absence check over an empty scope, so it THROWS rather than reporting.
 *
 * @param {Map<string, Verdict>} verdicts
 */
export function legMeasurementIsReal(verdicts) {
  if (verdicts.size === 0) throw new Error('the measurement returned no row at all');
  const summary = measuredSummary(verdicts);
  if (summary.rostered === 0) throw new Error('no rostered walker was measured');
  if (summary.measured === 0) {
    throw new Error(
      'not one rostered walker was measured enumerating, so the instrument is not reading ' +
        'anything and every verdict below it is worthless',
    );
  }
  if (summary.grew === 0) {
    throw new Error(
      'no walker read more planted files from the larger tree than from the smaller one, so the ' +
        'two rounds are not distinguishable and nothing was compared',
    );
  }
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
  /** @type {Map<string, Verdict> | null} */
  let measured = null;
  /** @type {Suffixes | null} */
  let suffixes = null;
  /** @type {string[]} */
  let ext = PLANTED_EXTENSIONS;
  try {
    seen = census();
    legDerivationIsReal(seen);
    // THE MEASUREMENT IS SKIPPED IN THE CHILD AND NOWHERE ELSE. `run` is itself
    // a rostered walker, so a child measuring it would spawn a child of its own.
    if (process.env[MEASURE_ENV] !== '1') {
      suffixes = suffixLiterals(seen.mods);
      legSuffixesAreDerived(suffixes);
      ext = plantedExtensions(seen.mods);
      measured = measuredVerdicts(measure(measurementPlan(seen.mods, seen.walkers), SELF, ext));
      legMeasurementIsReal(measured);
    }
  } catch (err) {
    out(`ERROR  the derivation did not run: ${String(err)}`);
    return 2;
  }

  const population = seen.cases.filter((one) => one.why.length > 0);

  if (listing) {
    out(`WALKERS  ${String(seen.walkers.size)} derived from ${rel(CHECKS_DIR)}`);
    for (const walker of [...seen.walkers.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      const v = measured?.get(`${walker.module}#${walker.name}`);
      const run =
        v === undefined
          ? 'not measured'
          : enumerates(v)
            ? `MEASURED dirs=${String(v.dirs)} read=[${v.read.join(',')}] of ` +
              `[${v.planted.join(',')}] planted, ${String(v.named)} named read(s) answered` +
              (v.spawns.length > 0 ? ` spawn=\`${/** @type {string} */ (v.spawns[0])}\`` : '')
            : v.touched === 0
              ? 'INCONCLUSIVE, the call read nothing under the planted root'
              : `READS BUT DOES NOT ENUMERATE, ${String(v.touched)} access(es)`;
      out(
        `         ${rel(walker.module)}#${walker.name}  ` +
          `rootParams=[${walker.rootParams.join(',')}] rootless=${String(walker.rootless)} ` +
          `argvGuard=${walker.argvGuard === null ? 'none' : String(walker.argvGuard)}`,
      );
      out(`             ${run}`);
      if (v !== undefined && enumeratesUnread(v)) {
        out(
          '             ENUMERATES AND READS NONE OF IT, so the read comparison is not available ' +
            'for this walker. Its filter rejects every planted name (ADR-474)',
        );
      }
    }
    out('');
    if (suffixes !== null) {
      out(
        `EXTENSIONS  ${String(ext.length)} planted: ${String(PLANTED_EXTENSIONS.length)} written ` +
          `floor and ${String(suffixes.derived.length)} read out of ` +
          `${SUFFIX_TESTS.join('/')} literal(s) in ${rel(CHECKS_DIR)}`,
      );
      out(`         set      ${ext.join(' ')}`);
      out(`         derived  ${suffixes.derived.join(' ')}`);
      out(
        `         refused  ${String(suffixes.refused.length)}, no planted name can carry them: ` +
          `${suffixes.refused.map((one) => `\`${one}\``).join(' ')}`,
      );
      out(
        `         unfolded ${String(suffixes.unfolded)} suffix test(s) whose argument is not a ` +
          'string literal, which is the one class this parse cannot see through',
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

  const findings = [
    ...legBudgetCarried(seen.cases),
    ...legBudgetEarned(seen.cases),
    ...(measured === null ? [] : legRosterIsMeasured(measured)),
    ...(measured === null ? [] : legRosterIsComplete(measured)),
  ];

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
    if (measured !== null) {
      const m = measuredSummary(measured);
      out(
        `       the roster is MEASURED: ${String(m.measured)} of ${String(m.rostered)} walker(s) ` +
          `enumerate a planted tree when run, ${String(m.inconclusive)} inconclusive; ` +
          `${String(m.grew)} read more of the larger planted tree than of the smaller; ` +
          `${String(m.spawning.length)} enumerate by spawning a process` +
          (m.spawning.length === 0 ? '' : ` (${m.spawning.join(', ')})`) +
          `; ${String(m.probed)} of the ${String(exportedSurface(seen.mods))} exported ` +
          'function(s) there are callable with no argument at all, and were run, and none of ' +
          'them enumerates unrostered',
      );
      // THE PLANTED TREE'S OWN KNOWLEDGE, STATED. `ADR-474`. A PASS that does
      // not say how many kinds of name it planted, or how many walkers rejected
      // every one of them, is a PASS over evidence nobody can size.
      if (suffixes !== null) {
        out(
          `       the planted tree carries ${String(ext.length)} extension(s): ` +
            `${String(PLANTED_EXTENSIONS.length)} written floor and ` +
            `${String(suffixes.derived.length)} read out of the checkers' own ` +
            `${SUFFIX_TESTS.join('/')} literal(s), ${String(suffixes.refused.length)} literal(s) ` +
            `refused as unplantable and ${String(suffixes.unfolded)} argument(s) not a literal; ` +
            `${String(m.blinded.length)} rostered walker(s) enumerate it and read none of it` +
            (m.blinded.length === 0 ? '' : ` (${m.blinded.join(', ')})`) +
            ', so the read comparison is not available for them',
        );
      }
    }
    return 0;
  }

  out(
    `FAIL   the budget does not follow the input, or the roster does not follow the run ` +
      `(${String(findings.length)})`,
  );
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
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  // THE CHILD MODE IS NOT A USER-FACING OPTION and the usage text omits it. It
  // is this same file, re-entered with the measurement patch installed.
  // NOT `await`. A top-level await here leaves this module still EVALUATING
  // while the child imports it back, and a dynamic import of a module that is
  // mid-evaluation never settles: `run` and `census` are exports of this file
  // and are two of the calls the child makes. The promise chain runs after
  // evaluation finishes, so the cycle resolves.
  if (argv[0] === MEASURE_CHILD && argv.length === 2) {
    void measureChild(/** @type {string} */ (argv[1])).then(
      (code) => {
        process.exit(code);
      },
      (err) => {
        process.stderr.write(`${String(err)}\n`);
        process.exit(2);
      },
    );
  } else {
    process.exit(run(argv));
  }
}
