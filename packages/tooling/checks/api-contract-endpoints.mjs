// =============================================================================
// packages/tooling/checks/api-contract-endpoints.mjs
// =============================================================================
// A READER, NOT A CHECK. It exports no `Invariant` and `repo-invariants.mjs`
// does not import it. The slice that wrote it was dispatched to make one
// question mechanically answerable and was forbidden to gate the answer: a gate
// over a diff nobody has read yet pins whatever the tree happens to say today,
// including its defects. So there is no `RI-nn` here and no number was reserved
// for one.
//
// It lives in `checks/` because that is the only directory `packages/tooling`
// holds readers in today (`ui-server-endpoints.mjs` sits beside it), and a
// second directory would need an `exports` entry in a manifest this slice's
// fence does not cover. The directory name is the misnomer; this header is the
// correction.
//
// -----------------------------------------------------------------------------
// WHAT IT IS FOR
// -----------------------------------------------------------------------------
// `CompositionReport.registered`, produced over a real `compose()`, is the only
// reliable answer to "which routes exist"; a grep over route files has been
// wrong twice in this repository and `apps/api/test/account-reads.test.ts` says
// so in its own header. There was no reliable answer at all to the other half,
// "which endpoints the contract specifies", so the two halves could not be
// diffed and "what is UNBUILT" could not be measured.
//
// An earlier attempt pulled backtick-quoted paths out of this document with one
// regex and produced 35 distinct paths against 72 declared routes. That number
// is not a corpus finding. It is what reading PROSE gets you: section 1 spells
// `POST /accounts/:id/reset` where the heading spells `:accountId`, section 8
// names three paths in a sentence that also says one of them is NOT a field on
// another, and section 12 describes requests that must be REFUSED.
//
// -----------------------------------------------------------------------------
// THE TWO STRUCTURES IT READS, AND WHY THOSE TWO
// -----------------------------------------------------------------------------
// STRUCTURE 1, THE ENDPOINT HEADING. A `###` or `####` heading whose text
// begins with an HTTP method. This document declares an endpoint by giving it a
// heading and then writing its auth, request, response, errors and limits under
// it; every other mention is a reference to a heading that already exists.
//
// Four headings carry MORE THAN ONE endpoint, comma separated, and a segment
// after the first may omit the method and inherit the one to its left:
//
//     ### POST /auth/passkey/register/options, /auth/passkey/register/verify
//     #### POST /phone/change, GET /phone/change, POST /phone/change/:id/cancel
//
// Reading one entry per heading would lose five endpoints silently. The
// document itself names that failure at section 8: "One heading over three
// paths reads as one endpoint to anything parsing this document."
//
// STRUCTURE 2, THE ENDPOINT TABLE. A markdown table whose FIRST HEADER CELL IS
// EXACTLY `Endpoint`. Sections 9 and 10 declare their endpoints in tables
// rather than under headings, and the header cell is the document saying what
// its rows are keyed on. The rule is a SHAPE and not a section number, so a new
// endpoint table is read the day it lands and a new prose table is not.
//
// -----------------------------------------------------------------------------
// WHAT IT SKIPS, AND WHY EACH SKIP IS DELIBERATE
// -----------------------------------------------------------------------------
// SKIP 1, A TABLE KEYED ON ANYTHING BUT AN ENDPOINT. Section 11's is keyed on
// `Surface` and section 12's on `Token` and on `Test`. Their endpoint-shaped
// cells are RESTATEMENTS of headings above them, and their other rows are not
// endpoints at all: `Authenticated reads`, `Public catalog`, `Admin`,
// `Webhooks`, and a `Test` column whose rows are sentences. Reading them adds
// no endpoint and invents several.
//
// SKIP 2, PROSE, ENTIRELY. Including a fenced code block, and including a
// sentence naming a path. This is the skip that produced the 35.
//
// SKIP 3, A SUBSECTION THAT DELIBERATELY CARRIES NO `METHOD /path` HEADING.
// Two exist and the document states the intent in its own words: 6.1's live
// dashboard channel ("This subsection specifies a PAYLOAD and deliberately
// carries no `METHOD /path` heading") and section 8's live Open Liability ("A
// payload rather than a `METHOD /path` heading"). This reader needs no list of
// them, which is the point of stating the skip this way: it reads headings, and
// those two subsections have no endpoint heading to read. Naming them in a
// constant here would be a second copy of a ruling, and it would drift.
//
// -----------------------------------------------------------------------------
// A ROW IT CANNOT PARSE IS REPORTED AND NEVER DROPPED
// -----------------------------------------------------------------------------
// A parser that silently drops rows produces a coverage report that looks like
// success, and a coverage report that looks like success is worse than none,
// because the next session builds on it. So every position INSIDE a structure
// this reader claims to read, from which it could not derive a `METHOD /path`,
// lands in `anomalies` with its line number and its text. `anomalies` being
// empty is a claim the caller can check; it is not an assumption.
// =============================================================================

/**
 * The verb vocabulary, closed at the five `registry.ts` closes it at.
 *
 * IT IS A SECOND COPY AND THE ALTERNATIVE WAS WORSE. `HTTP_METHODS` lives in
 * `apps/api/src/registry.ts`, and `packages/tooling` may not import a
 * deployable. `repo-invariants.mjs` faces the same problem for `BASE_PATH` and
 * resolves it by parsing that source as TEXT, which is available here too, but
 * it buys nothing: this reader reads a DOCUMENT, and a verb the document uses
 * that the registry has never heard of is exactly the finding a caller wants
 * reported rather than silently normalised away. So the list is stated here,
 * the divergence is a caller's finding to make, and this comment is the record
 * that it is two lists rather than one.
 */
export const CONTRACT_METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];

/**
 * `GET`, `POST`, ... at the very start of a string, ended by space or by the
 * string.
 *
 * THE `|$` ARM IS A DEFECT THE FIXTURE FOUND AND NOT A GENERALITY. This read
 * ` +`, so a heading whose whole text was a bare `GET` did not begin with a
 * method as far as the reader was concerned, and it fell into the count of
 * headings stating no method: a MALFORMED ENDPOINT HEADING, SILENTLY DROPPED,
 * which is the one thing this reader promises not to do. It is invisible on the
 * live document because every heading there is well formed, which is exactly
 * why the test is written against a fixture that carries the shape.
 *
 * The word boundary is spelled as an alternation rather than as `\\b`, so
 * `GETTING STARTED` is a section heading and not a `GET`.
 */
const LEADING_METHOD = new RegExp(`^(${CONTRACT_METHODS.join('|')})(?: +|$)`);

/** A heading, captured as its hashes and its text. */
const HEADING = /^(#{1,6}) +(.*)$/;

/** A markdown table's delimiter row: `|---|:--:|`. Nothing else looks like it. */
const TABLE_DELIMITER = /^\|(?: *:?-+:? *\|)+$/;

/** The header cell that makes a table an endpoint table. Exact, after trim. */
const ENDPOINT_COLUMN = 'Endpoint';

/**
 * Split a markdown table row into cells, honouring backtick spans.
 *
 * A pipe inside `` ` `` is content and not a cell boundary, which matters
 * because this document writes `pass|payout` in one heading and could write the
 * same inside a cell tomorrow. Written as a scan rather than as a regex on
 * session 333's finding: a greedy run over a character class backtracks over
 * every way to split a run of spaces, and a padded markdown table is one long
 * line of them.
 *
 * @param {string} line a line beginning with `|`.
 * @returns {string[]} the cells, trimmed, without the empty edges.
 */
export function tableCells(line) {
  /** @type {string[]} */
  const cells = [];
  let current = '';
  let inCode = false;
  for (const ch of line) {
    if (ch === '`') {
      inCode = !inCode;
      current += ch;
    } else if (ch === '|' && !inCode) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  // A well-formed row opens and closes with a pipe, so the first and last are
  // empty. Dropping them by position rather than by emptiness keeps a genuinely
  // empty first column visible instead of shifting every cell left by one.
  if (cells.length >= 2) {
    cells.shift();
    cells.pop();
  }
  return cells;
}

/**
 * Turn one `METHOD /path` fragment into an entry.
 *
 * The query string is stripped, because a route is registered on a PATH and
 * `registry.ts` keys on `METHOD /path`. Two headings carry one:
 * `GET /accounts/:accountId/certificate?kind=pass|payout` and
 * `GET /admin/accounts?query=`. Keeping it would make both unmatchable against
 * every route that exists.
 *
 * @param {string} method one of {@link CONTRACT_METHODS}.
 * @param {string} rawPath the path as the document writes it.
 * @returns {{method: string, path: string, endpoint: string} | undefined}
 */
function entry(method, rawPath) {
  const path = (rawPath.split('?')[0] ?? '').split('#')[0]?.trim() ?? '';
  if (!path.startsWith('/')) return undefined;
  return { method, path, endpoint: `${method} ${path}` };
}

/**
 * Read every endpoint an endpoint heading declares.
 *
 * The heading text is split on commas and read left to right. A segment stating
 * a method sets the method for itself and for the segments after it; a segment
 * stating none inherits. A segment yielding no path is an anomaly.
 *
 * @param {string} text the heading text, with the hashes already removed.
 * @returns {{entries: Array<{method: string, path: string, endpoint: string}>, unparsed: string[]}}
 */
function readHeadingEndpoints(text) {
  /** @type {Array<{method: string, path: string, endpoint: string}>} */
  const entries = [];
  /** @type {string[]} */
  const unparsed = [];
  let method = '';
  for (const segment of text.split(',')) {
    const trimmed = segment.trim();
    if (trimmed === '') continue;
    let rest = trimmed;
    const stated = LEADING_METHOD.exec(rest);
    if (stated !== null) {
      method = stated[1] ?? '';
      rest = rest.slice(stated[0].length);
    }
    // The path is the first whitespace-delimited token. Nothing in this
    // document follows a path with prose inside the same heading segment, and
    // if something does, this takes the path and leaves the prose rather than
    // failing the whole heading.
    const token = rest.split(/\s+/)[0] ?? '';
    const made = method === '' ? undefined : entry(method, token);
    if (made === undefined) unparsed.push(trimmed);
    else entries.push(made);
  }
  return { entries, unparsed };
}

/**
 * Read the `METHOD /path` out of an endpoint table's first cell.
 *
 * The cell is written `` `POST /internal/batch/run` ``. The backticks are
 * stripped rather than required, so a row that loses them is still read and a
 * row that is genuinely not an endpoint is still an anomaly.
 *
 * @param {string} cell the first cell of a body row.
 * @returns {{method: string, path: string, endpoint: string} | undefined}
 */
function readTableEndpoint(cell) {
  const bare = cell.replaceAll('`', '').trim();
  const stated = LEADING_METHOD.exec(bare);
  if (stated === null) return undefined;
  return entry(stated[1] ?? '', bare.slice(stated[0].length).split(/\s+/)[0] ?? '');
}

/**
 * @typedef {object} ContractEndpoints
 * @property {Array<{method: string, path: string, endpoint: string, line: number, source: 'heading' | 'table', raw: string}>} endpoints
 *   every endpoint the document declares, in document order, duplicates kept.
 * @property {string[]} distinct `METHOD /path`, sorted, deduplicated.
 * @property {Array<{endpoint: string, lines: number[]}>} duplicates
 *   an endpoint declared more than once. The document declaring one twice is a
 *   finding about the document and not about this reader.
 * @property {Array<{kind: string, line: number, text: string, why: string}>} anomalies
 *   a position inside a structure this reader READS, from which no endpoint
 *   could be derived. Never silently dropped.
 * @property {Array<{kind: string, detail: string, count: number}>} read
 *   what it read, derived from the read itself.
 * @property {Array<{kind: string, detail: string, count: number}>} skipped
 *   what it deliberately did not read, and how much of it there was.
 */

/**
 * Read `docs/architecture/API_CONTRACT.md` into a list of `METHOD /path`.
 *
 * Pure: it takes the markdown as a string and reads nothing from disk, which is
 * what lets its test run against a fixture contract instead of against the live
 * document. A test pinned to the live corpus goes red every time a contract row
 * lands, which is a check that punishes the work it exists to support.
 *
 * @param {string} markdown the whole document.
 * @returns {ContractEndpoints}
 */
export function readApiContractEndpoints(markdown) {
  /** @type {ContractEndpoints['endpoints']} */
  const endpoints = [];
  /** @type {ContractEndpoints['anomalies']} */
  const anomalies = [];

  let headingsSeen = 0;
  let headingsRead = 0;
  let endpointTables = 0;
  let endpointTableRows = 0;
  /** @type {Array<{header: string, line: number, rows: number}>} */
  const skippedTables = [];

  let inFence = false;
  /** `undefined` outside a table; the header cells inside one. */
  let tableHeader;
  /** The header row's line, for reporting a skipped table at its own position. */
  let tableHeaderLine = 0;
  let tableIsEndpoints = false;
  let tableRows = 0;

  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const lineNumber = i + 1;

    // A fence toggles, and NOTHING inside one is read. Section 2 and section 6.1
    // both carry TypeScript blocks, and a `type` line has been mistaken for a
    // table by a looser reader before.
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const isRow = line.startsWith('|');

    // A table ends at the first line that is not a row. Closing it here rather
    // than at end of file is what makes a skipped table reportable at the line
    // its header sat on.
    if (!isRow && tableHeader !== undefined) {
      if (!tableIsEndpoints)
        skippedTables.push({
          header: tableHeader[0] ?? '',
          line: tableHeaderLine,
          rows: tableRows,
        });
      tableHeader = undefined;
      tableIsEndpoints = false;
      tableRows = 0;
    }

    if (isRow) {
      if (tableHeader === undefined) {
        // A header row is only a header if a delimiter row follows it.
        const next = lines[i + 1] ?? '';
        if (!TABLE_DELIMITER.test(next.trim())) continue;
        tableHeader = tableCells(line);
        tableHeaderLine = lineNumber;
        tableIsEndpoints = (tableHeader[0] ?? '') === ENDPOINT_COLUMN;
        if (tableIsEndpoints) endpointTables += 1;
        i += 1; // the delimiter row is consumed with the header
        continue;
      }
      tableRows += 1;
      if (!tableIsEndpoints) continue;
      endpointTableRows += 1;
      const cells = tableCells(line);
      const first = cells[0] ?? '';
      const made = readTableEndpoint(first);
      if (made === undefined) {
        anomalies.push({
          kind: 'endpoint-table-row',
          line: lineNumber,
          text: first,
          why: 'a row of a table headed `Endpoint`, whose first cell states no `METHOD /path`',
        });
        continue;
      }
      endpoints.push({ ...made, line: lineNumber, source: 'table', raw: first });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading === null) continue;
    headingsSeen += 1;
    const text = (heading[2] ?? '').trim();
    if (!LEADING_METHOD.test(text)) continue;
    headingsRead += 1;
    const { entries, unparsed } = readHeadingEndpoints(text);
    for (const made of entries)
      endpoints.push({ ...made, line: lineNumber, source: 'heading', raw: text });
    for (const bad of unparsed)
      anomalies.push({
        kind: 'endpoint-heading-segment',
        line: lineNumber,
        text: bad,
        why: 'a comma-separated segment of a heading that begins with an HTTP method, stating no path',
      });
  }

  // A table running to the last line of the file closes here.
  if (tableHeader !== undefined && !tableIsEndpoints)
    skippedTables.push({ header: tableHeader[0] ?? '', line: tableHeaderLine, rows: tableRows });

  /** @type {Map<string, number[]>} */
  const byEndpoint = new Map();
  for (const e of endpoints)
    byEndpoint.set(e.endpoint, [...(byEndpoint.get(e.endpoint) ?? []), e.line]);
  const duplicates = [...byEndpoint.entries()]
    .filter(([, l]) => l.length > 1)
    .map(([endpoint, l]) => ({ endpoint, lines: l }))
    .sort((a, b) => a.endpoint.localeCompare(b.endpoint));

  const skippedTableRows = skippedTables.reduce((n, t) => n + t.rows, 0);

  return {
    endpoints,
    distinct: [...byEndpoint.keys()].sort(),
    duplicates,
    anomalies,
    read: [
      {
        kind: 'endpoint headings',
        detail:
          'a `#`..`######` heading whose text begins with one of ' + CONTRACT_METHODS.join(', '),
        count: headingsRead,
      },
      {
        kind: 'endpoints from those headings',
        detail:
          'comma-separated segments, a stated method carrying rightward to segments that omit one',
        count: endpoints.filter((e) => e.source === 'heading').length,
      },
      {
        kind: 'endpoint tables',
        detail: 'a markdown table whose first header cell is exactly `' + ENDPOINT_COLUMN + '`',
        count: endpointTables,
      },
      {
        kind: 'rows of those tables',
        detail: 'first cell read as `METHOD /path`',
        count: endpointTableRows,
      },
    ],
    skipped: [
      {
        kind: 'headings stating no method',
        detail:
          'a section or subsection heading, including the two subsections that deliberately carry no `METHOD /path` heading',
        count: headingsSeen - headingsRead,
      },
      {
        kind: 'tables keyed on something else',
        detail:
          skippedTables.length === 0
            ? 'none'
            : skippedTables
                .map((t) => `\`${t.header}\` at line ${t.line} (${t.rows} rows)`)
                .join('; '),
        count: skippedTables.length,
      },
      {
        kind: 'rows of those tables',
        detail: 'restatements of headings, plus rows that are not endpoints',
        count: skippedTableRows,
      },
      {
        kind: 'prose and fenced code',
        detail:
          'read NOT AT ALL. A path named in a sentence is a reference to a heading, a request that must be refused, or a spelling that differs from the heading (`:id` for `:accountId`)',
        count: 0,
      },
    ],
  };
}

/**
 * Render a reader's own coverage as lines of text.
 *
 * The coverage is DERIVED from the read rather than written beside it, on
 * `RI-04`'s rule for its title and `RI-05`'s for its `covers`: a hand-maintained
 * count is a hand-maintained count in a different costume, and it drifts.
 *
 * @param {ContractEndpoints} result
 * @returns {string[]}
 */
export function describeCoverage(result) {
  const out = ['READ:'];
  for (const r of result.read) out.push(`  ${String(r.count).padStart(4)}  ${r.kind}: ${r.detail}`);
  out.push('SKIPPED:');
  for (const s of result.skipped)
    out.push(`  ${String(s.count).padStart(4)}  ${s.kind}: ${s.detail}`);
  out.push(`ANOMALIES: ${result.anomalies.length}`);
  for (const a of result.anomalies) out.push(`  line ${a.line}: ${a.text} -- ${a.why}`);
  out.push(`DUPLICATE DECLARATIONS: ${result.duplicates.length}`);
  for (const d of result.duplicates) out.push(`  ${d.endpoint} at lines ${d.lines.join(', ')}`);
  return out;
}
