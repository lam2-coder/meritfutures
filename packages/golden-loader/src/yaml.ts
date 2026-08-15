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
// block scalars (`|`, `>`), non-empty flow collections, duplicate keys, and
// DECIMAL NUMBERS.
//
// The float refusal is the one worth naming. "Money is integer cents; no floats
// in financial paths (applies to all doc examples too)" is a repository rule,
// and a fixture is where a money figure is stated by hand. `4770000.0` parses
// silently everywhere else in this ecosystem; here it is an error that names
// the rule.
//
// ONE HAZARD THIS FILE CREATES ON PURPOSE, RECORDED RATHER THAN HIDDEN. An
// unquoted `2026-11-03` is a STRING here and a `Date` under a real YAML
// library, because YAML's core schema resolves timestamps. GOLDEN_SCENARIOS
// section 2 prints trading days unquoted, so the fixtures are written the way
// the corpus prints them and this parser is what makes that safe. Anyone
// swapping in `yaml` must quote every date in every fixture in the same commit,
// or the loader starts handing the engine a clock reading.
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
      items.push(parseNode(continuation, 0, itemIndent)[0]);
    } else if (KEY_AHEAD.test(rest)) {
      // `- key: value` opens a mapping whose first pair shares the dash's line.
      // Reading it as one virtual block is what keeps the mapping parser the
      // only place mapping rules are written.
      const virtual: Line[] = [{ n: line.n, indent: itemIndent, text: rest }, ...continuation];
      items.push(parseNode(virtual, 0, itemIndent)[0]);
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
