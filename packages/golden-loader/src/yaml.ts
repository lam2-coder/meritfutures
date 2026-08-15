// =============================================================================
// packages/golden-loader/src/yaml.ts
// =============================================================================
// A YAML SUBSET PARSER THAT REJECTS EVERYTHING IT DOES NOT UNDERSTAND.
//
// STRATEGY section 2 rules the fixture format as "YAML plus an expected
// end-state JSON sibling", and rejects TypeScript fixture builders because a
// builder can call the code under test. That ruling buys TR-01 and it costs a
// parser.
//
// WHY NOT THE `yaml` PACKAGE. VG-12 makes every new dependency a human
// admission decision (STRATEGY section 4.2, .npmrc), and a session cannot grant
// itself that approval. Swapping this file for `yaml` is a founder call and a
// small diff; the reasons to think about it before making it are in
// ../README.md, and the sharpest one is the date note below.
//
// WHY A REFUSING PARSER RATHER THAN A PERMISSIVE ONE. A fixture the loader
// MISREADS is worse than a fixture the loader rejects: it is a golden file that
// pins something nobody wrote. So every construct outside the subset throws
// with a line number rather than being coerced into something plausible.
//
// THE SUBSET, in full:
//
//   mappings          `key: value`, keys matching /[A-Za-z_][A-Za-z0-9_]*/
//   nesting           exactly two spaces per level, spaces only, never a tab
//   sequences         `- item`, indented two spaces past the key that owns them
//   empty collections `[]` and `{}` only; no other flow collection
//   integers          -?(0|[1-9][0-9]*)
//   booleans          true, false
//   null              null, ~
//   strings           quoted ('single' or "double"), or plain
//   comments          `#` at the start of a line or after whitespace
//
// AND WHAT IT REFUSES, each because reading it wrong is worse than not reading
// it: tabs, odd indentation, document markers, anchors and aliases, merge keys,
// block scalars (`|`, `>`), non-empty flow collections, duplicate keys,
// DECIMAL NUMBERS, AMBIGUOUS PLAIN SCALARS, and UNREAD CONTENT INSIDE A
// SEQUENCE ITEM.
//
// The float refusal is the one worth naming. "Money is integer cents; no floats
// in financial paths (applies to all doc examples too)" is a repository rule,
// and a fixture is where a money figure is stated by hand. `4770000.0` parses
// silently everywhere else in this ecosystem; here it is an error that names
// the rule.
//
// -----------------------------------------------------------------------------
// THE RULE THIS FILE IS WRITTEN AGAINST: REFUSE, NEVER MIS-READ
// -----------------------------------------------------------------------------
// A fixture the loader REJECTS costs a session five minutes. A fixture the
// loader MISREADS is a golden file pinning something nobody wrote, and it is
// indistinguishable from a correct one until the day it matters. So the subset
// is closed in both directions: a construct outside it throws with a line
// number, and no construct inside it may quietly produce a value the fixture
// author did not write.
//
// Two ways this parser could have failed that rule were found and closed, and
// both are recorded because each was a silent pass rather than a crash:
//
//   1. SEQUENCE ITEMS DROPPED THEIR TAIL. `parseNode` returns how much it
//      consumed and both sequence-item call sites discarded it, so
//      `- \n  - a\n  keep_me: 1` parsed to `[["a"]]` and `keep_me` was read off
//      the disk, held in memory and thrown away. That is a stated fixture input
//      the engine never sees, which is the failure mode `AWAITING_M01_INPUT` in
//      ../src/loader.ts exists to make impossible from the other direction.
//   2. PLAIN SCALARS A REAL YAML LIBRARY TYPES DIFFERENTLY. `True`, `yes`,
//      `NULL`, `0x1F`, `007`, `+5`, `1_000`, `.inf` and `1:30` were all read as
//      strings here and are booleans, null, integers, floats or a sexagesimal
//      elsewhere. See the date note below: this is that hazard generalized, and
//      the date is the only member of the class this parser admits.
//
// ONE HAZARD THIS FILE CREATES ON PURPOSE, RECORDED RATHER THAN HIDDEN. An
// unquoted `2026-11-03` is a STRING here and a `Date` under a real YAML
// library, because YAML's core schema resolves timestamps. GOLDEN_SCENARIOS
// section 2 prints trading days unquoted, so the fixtures are written the way
// the corpus prints them and this parser is what makes that safe.
//
// **ANYONE SWAPPING IN `yaml` MUST QUOTE EVERY DATE IN EVERY FIXTURE IN THE
// SAME COMMIT**, or the loader starts handing the engine a clock reading, in
// the one package whose entire contract is that it has none. Not the next
// commit and not a follow-up issue: the two edits are one edit, because the
// tree between them is a tree where every fixture loads, every test passes, and
// `trading_day` is a `Date`. `ADMITTED_TIMESTAMP` below is where that obligation
// is enforced in code, and it says so at the point a reader would change it.
//
// WHY NOT JUST QUOTE THE DATES NOW AND REMOVE THE HAZARD. Because the fixture
// format is a corpus document (GOLDEN_SCENARIOS section 2) and it prints them
// unquoted. Quoting them here would be the loader editing the specification to
// suit the implementation, which is TR-01's direction inverted.
// =============================================================================

/** A construct outside the subset, always with the line it was found on. */
export class YamlSubsetError extends Error {
  readonly line: number;

  constructor(line: number, message: string) {
    super(`line ${line}: ${message}`);
    this.name = 'YamlSubsetError';
    this.line = line;
  }
}

export type YamlValue =
  string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue };

interface Line {
  /** 1-indexed line number in the source file, for error messages. */
  readonly n: number;
  readonly indent: number;
  /** The line with its indentation and any trailing comment removed. */
  readonly text: string;
}

const KEY = /^([A-Za-z_][A-Za-z0-9_]*):(?:[ ]+(\S.*))?$/;
const KEY_AHEAD = /^[A-Za-z_][A-Za-z0-9_]*:(?:[ ]|$)/;
const INTEGER = /^-?(0|[1-9][0-9]*)$/;
const DECIMAL = /^-?[0-9]+\.[0-9]+$/;
const EXPONENT = /^-?[0-9]+(\.[0-9]+)?[eE][-+]?[0-9]+$/;
const INDICATORS = new Set(['&', '*', '!', '|', '>', '%', '@', '`', '?', ',', '[', '{']);

/**
 * The one plain scalar shape that resolves to a non-string elsewhere and is
 * admitted here anyway, as a string.
 *
 * GOLDEN_SCENARIOS section 2 prints `trading_day: 2026-11-03` unquoted and the
 * fixtures are written the way the corpus prints them. **A real YAML library
 * resolves this through the core schema's timestamp rule and hands back a
 * `Date`**, which is a clock reading entering `@merit/rules-engine`, a package
 * whose entire contract is that it has none.
 *
 * **SO SWAPPING THIS PARSER FOR `yaml` MEANS QUOTING EVERY DATE IN EVERY
 * FIXTURE IN THE SAME COMMIT.** That is the whole reason this constant is a
 * named admission with a comment rather than one branch of a regex: the next
 * person to reach for the dependency reads this line while doing it.
 */
const ADMITTED_TIMESTAMP = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Plain scalars that mean one thing here and another under a real YAML library.
 *
 * EVERY ONE OF THESE PARSED AS A STRING BEFORE THIS TABLE EXISTED, silently.
 * The subset's own line is "strings: quoted or plain", and a plain string IS in
 * the subset, so none of these was a construct the parser failed to recognise:
 * they are constructs it recognised as the wrong thing. That is the failure
 * this file's header calls worse than a rejection, and a fixture is exactly
 * where it lands, because a fixture is where a value is stated by hand and
 * never computed.
 *
 * **QUOTING IS THE ESCAPE HATCH AND IT IS THE POINT.** `x: "yes"` is a string
 * under every schema anybody could swap in, so the refusal costs a fixture
 * author two characters and buys the guarantee that the file means the same
 * thing after the dependency question is settled either way.
 */
const AMBIGUOUS_PLAIN: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /^(?:y|n|yes|no|on|off|true|false|null)$/i,
    'YAML 1.1 resolves this to a boolean or to null and YAML 1.2 core resolves ' +
      'only the exact lowercase spellings, so its type depends on the library',
  ],
  [
    /^[-+]?0[xXoObB][0-9a-zA-Z_]*$/,
    'a hexadecimal, octal or binary integer literal, which is an integer under a ' +
      'real YAML library and is not in this subset',
  ],
  [
    /^[-+]?[0-9][0-9_]*$/,
    'an integer written with a leading zero, an explicit "+", or digit separators. ' +
      'The subset writes integers as -?(0|[1-9][0-9]*) and a real YAML library ' +
      'would resolve this form to a number',
  ],
  [
    /^[-+]?\.(?:inf|nan)$/i,
    'a YAML float constant. Money is integer cents and no float may appear in a fixture',
  ],
  [
    /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
    'a YAML 1.1 sexagesimal, which resolves to a single number rather than to the ' +
      'text as written',
  ],
  [
    /^\d{4}-\d{1,2}-\d{1,2}(?:[Tt\s].*)?$/,
    'a timestamp outside the YYYY-MM-DD form the fixture format prints. Only the ' +
      'bare trading day is admitted unquoted, and it is admitted as a string',
  ],
];

/**
 * Remove a trailing `#` comment, respecting quotes.
 *
 * A `#` inside a quoted scalar is content. A `#` that opens a comment is either
 * at the start of the line or preceded by whitespace, which is YAML's own rule
 * and is the one that keeps `plan: CORE-50K#1` from losing its suffix.
 */
function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line.charAt(i);
    if (quote !== null) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '#' && (i === 0 || /\s/.test(line.charAt(i - 1)))) return line.slice(0, i);
  }
  return line;
}

function scan(source: string): Line[] {
  const lines: Line[] = [];
  source.split('\n').forEach((original, index) => {
    const n = index + 1;
    if (original.includes('\t')) {
      throw new YamlSubsetError(n, 'tab character; the subset indents with spaces only');
    }
    const withoutComment = stripComment(original).trimEnd();
    if (withoutComment.trim() === '') return;
    if (withoutComment.trim() === '---' || withoutComment.trim() === '...') {
      throw new YamlSubsetError(n, 'document marker; a fixture file holds exactly one document');
    }
    const indent = withoutComment.length - withoutComment.trimStart().length;
    if (indent % 2 !== 0) {
      throw new YamlSubsetError(n, `indent of ${indent} spaces; the subset steps by two`);
    }
    lines.push({ n, indent, text: withoutComment.slice(indent) });
  });
  return lines;
}

function parseScalar(raw: string, n: number): YamlValue {
  const text = raw.trim();

  if (text === '[]') return [];
  if (text === '{}') return {};
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null' || text === '~') return null;

  if (DECIMAL.test(text) || EXPONENT.test(text)) {
    throw new YamlSubsetError(
      n,
      `decimal number "${text}". Money is integer cents and thresholds are basis points; ` +
        'no float may appear in a fixture',
    );
  }
  if (INTEGER.test(text)) return Number(text);

  if (text.startsWith('"') || text.startsWith("'")) {
    const quote = text.charAt(0);
    if (text.length < 2 || !text.endsWith(quote)) {
      throw new YamlSubsetError(
        n,
        `unterminated ${quote === '"' ? 'double' : 'single'}-quoted string`,
      );
    }
    const body = text.slice(1, -1);
    if (quote === "'") {
      if (body.includes("'") && !body.includes("''")) {
        throw new YamlSubsetError(n, 'stray quote inside a single-quoted string');
      }
      return body.replace(/''/g, "'");
    }
    if (/\\(?!["\\])/.test(body)) {
      throw new YamlSubsetError(
        n,
        'escape sequence outside the subset; only \\" and \\\\ are read',
      );
    }
    return body.replace(/\\(["\\])/g, '$1');
  }

  if (INDICATORS.has(text.charAt(0))) {
    throw new YamlSubsetError(n, `"${text.charAt(0)}" opens a construct outside the subset`);
  }
  if (text.includes(': ')) {
    throw new YamlSubsetError(n, `ambiguous plain scalar containing ": " -> ${text}`);
  }

  // The plain scalar is a string here. Under a real YAML library some plain
  // scalars are not strings, and reading one as the wrong type is the silent
  // mis-parse this parser exists to make impossible. The trading day is the one
  // admitted member of that class and it is admitted deliberately; everything
  // else in it is refused and quoting is the way to say "I meant the text".
  if (ADMITTED_TIMESTAMP.test(text)) return text;
  for (const [pattern, why] of AMBIGUOUS_PLAIN) {
    if (pattern.test(text)) {
      throw new YamlSubsetError(
        n,
        `ambiguous plain scalar "${text}": ${why}. Quote it to mean the text, ` +
          'or write it in the form the subset states',
      );
    }
  }
  return text;
}

function parseNode(lines: Line[], i: number, indent: number): [YamlValue, number] {
  const first = lines[i];
  if (first === undefined) throw new YamlSubsetError(0, 'unexpected end of file');
  if (first.text === '-' || first.text.startsWith('- ')) return parseSequence(lines, i, indent);
  return parseMapping(lines, i, indent);
}

function parseMapping(lines: Line[], start: number, indent: number): [YamlValue, number] {
  const map: Record<string, YamlValue> = {};
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) break;
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new YamlSubsetError(line.n, `indent of ${line.indent} where ${indent} was expected`);
    }

    const match = KEY.exec(line.text);
    if (match === null) {
      throw new YamlSubsetError(line.n, `not a "key: value" pair in the subset -> ${line.text}`);
    }
    const key = match[1] as string;
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      throw new YamlSubsetError(line.n, `duplicate key "${key}"`);
    }

    const inline = match[2];
    if (inline !== undefined) {
      map[key] = parseScalar(inline, line.n);
      i += 1;
      continue;
    }

    const next = lines[i + 1];
    if (next === undefined || next.indent <= indent) {
      throw new YamlSubsetError(line.n, `key "${key}" has no value`);
    }
    if (next.indent !== indent + 2) {
      throw new YamlSubsetError(
        next.n,
        `indent of ${next.indent} where ${indent + 2} was expected`,
      );
    }
    const [value, after] = parseNode(lines, i + 1, next.indent);
    map[key] = value;
    i = after;
  }

  return [map, i];
}

/**
 * Parse one sequence item's whole block, and refuse to read part of it.
 *
 * `parseNode` returns how far it got, and BOTH SEQUENCE-ITEM CALL SITES USED TO
 * DISCARD THAT NUMBER. `parseSequence` stops at the first line that is not a
 * dash rather than throwing, so an item that opened a nested sequence and then
 * carried anything else silently lost the remainder:
 *
 *     days:
 *       -
 *         - a
 *         keep_me: 1        <- read from disk, parsed, and thrown away
 *
 * parsed to `{days: [["a"]]}` with no error on any stream. THAT IS THE ONE
 * OUTCOME THIS PARSER IS WRITTEN TO MAKE IMPOSSIBLE: the fixture states an
 * input, the engine never sees it, and the scenario goes green while pinning
 * something else. ../src/loader.ts refuses a fixture field it can neither map
 * nor list for exactly this reason, and a field the parser never surfaces
 * cannot reach that refusal at all.
 *
 * So the item's block is read to the end or the file does not load.
 */
function readWholeItem(block: Line[], indent: number, dash: number): YamlValue {
  const [value, consumed] = parseNode(block, 0, indent);
  const unread = block[consumed];
  if (unread !== undefined) {
    throw new YamlSubsetError(
      unread.n,
      `unread content inside the sequence item opened on line ${dash} -> ${unread.text}`,
    );
  }
  return value;
}

function parseSequence(lines: Line[], start: number, indent: number): [YamlValue, number] {
  const items: YamlValue[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) break;
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new YamlSubsetError(line.n, `indent of ${line.indent} where ${indent} was expected`);
    }
    if (line.text !== '-' && !line.text.startsWith('- ')) break;

    const itemIndent = indent + 2;
    const rest = line.text === '-' ? '' : line.text.slice(2).trim();

    // The item's continuation lines: everything indented past the dash.
    let j = i + 1;
    const continuation: Line[] = [];
    while (j < lines.length) {
      const candidate = lines[j];
      if (candidate === undefined || candidate.indent < itemIndent) break;
      continuation.push(candidate);
      j += 1;
    }

    if (rest === '') {
      const head = continuation[0];
      if (head === undefined) throw new YamlSubsetError(line.n, 'sequence item with no value');
      if (head.indent !== itemIndent) {
        throw new YamlSubsetError(
          head.n,
          `indent of ${head.indent} where ${itemIndent} was expected`,
        );
      }
      items.push(readWholeItem(continuation, itemIndent, line.n));
    } else if (KEY_AHEAD.test(rest)) {
      // `- key: value` opens a mapping whose first pair shares the dash's line.
      // Reading it as one virtual block is what keeps the mapping parser the
      // only place mapping rules are written.
      const virtual: Line[] = [{ n: line.n, indent: itemIndent, text: rest }, ...continuation];
      items.push(readWholeItem(virtual, itemIndent, line.n));
    } else {
      if (continuation.length > 0) {
        throw new YamlSubsetError(line.n, 'a scalar sequence item may not carry a nested block');
      }
      items.push(parseScalar(rest, line.n));
    }

    i = j;
  }

  return [items, i];
}

/**
 * Parse one fixture document.
 *
 * @throws {YamlSubsetError} on any construct outside the subset above.
 */
export function parseYamlSubset(source: string): YamlValue {
  const lines = scan(source);
  const head = lines[0];
  if (head === undefined) throw new YamlSubsetError(1, 'empty document');
  if (head.indent !== 0)
    throw new YamlSubsetError(head.n, 'the document must start at column zero');

  const [value, consumed] = parseNode(lines, 0, 0);
  const trailing = lines[consumed];
  if (trailing !== undefined) {
    throw new YamlSubsetError(trailing.n, `unread content after the document -> ${trailing.text}`);
  }
  return value;
}
