// =============================================================================
// apps/api/test/api-contract-coverage.test.ts
// =============================================================================
// `RI-17`, AND IT IS HERE RATHER THAN IN `repo-invariants.mjs` BECAUSE THE
// BOUNDARY PUT IT HERE.
//
// THE INVARIANT. Every endpoint `docs/architecture/API_CONTRACT.md` declares
// resolves to a route the registry declares, and every declared route resolves
// to a contract row. Both halves are read LIVE on every run: the contract
// through `packages/tooling/checks/api-contract-endpoints.mjs`, the routes
// through a real `compose()` over `discoverRouteModules()`. There is no stored
// list of either, and that is the whole difference between this check and the
// count it replaces. A number restated beside the thing it counts is a second
// thing that can disagree with it.
//
// -----------------------------------------------------------------------------
// WHY NOT IN repo-invariants.mjs, MEASURED RATHER THAN ASSUMED
// -----------------------------------------------------------------------------
// The reservation named `packages/tooling/checks/repo-invariants.mjs` and the
// dispatch that carried it said, in advance, that a `packages/tooling` check
// which cannot legally reach a real `compose()` is a finding to report and a
// check to move, never a fence to widen. Three things were measured on this
// branch and each of them alone is disqualifying.
//
//   1. `packages/tooling` CANNOT RESOLVE `@merit/api`. A probe placed in
//      `packages/tooling/checks/` importing it fails `ERR_MODULE_NOT_FOUND`,
//      and `packages/tooling/node_modules/@merit` does not exist. Declaring it
//      would make a shared package depend on a deployable, which is `RI-04`'s
//      argument pointed the other way.
//   2. IT CANNOT RESOLVE `fastify` EITHER, same probe, same error, and
//      `compose` takes a Fastify instance as its first argument.
//   3. `Invariant.run(root)` IS SYNCHRONOUS and returns `string[]`, while
//      `discoverRouteModules` is `async` because a route module is found on
//      disk and imported. An invariant cannot await it.
//
// The alternative that would keep the number in that file is a text parse of
// `routes/*.ts` instead of a composition. That is refused here for the reason
// `apps/api/test/account-reads.test.ts` states in its own header: a grep over
// route files has been wrong twice in this repository, and
// `CompositionReport.registered` over a real `compose()` is the only reliable
// answer to which routes exist. A check that reads its input the unreliable way
// in order to live in a nicer directory is a check weakened to pass.
//
// SO `node packages/tooling/checks/repo-invariants.mjs` STILL REPORTS 16 OF 16
// AND `RI-17` IS NOT AMONG THEM. It runs in CI-02 with the suite rather than in
// CI-01 with the invariants, which is a real difference and not a formality: a
// change that skips the test run is not refused by this file. The `RI-17` row
// in `docs/decisions/ALLOCATION.md` is amended in place to say so, per
// `ADR-065` T3, rather than joined by a second row. The shape has a precedent
// one deployable over: `apps/site/test/manifest.test.ts` is an in-app check
// whose natural home was `repo-invariants.mjs` and whose header says the same
// thing about the same file.
//
// -----------------------------------------------------------------------------
// WHY THE READER IS LOADED BY PATH AND VALIDATED AT RUN TIME
// -----------------------------------------------------------------------------
// The reader is a `.mjs` that ships no type declaration, so a static import of
// it from this project is `error TS7016: Could not find a declaration file`,
// measured on this branch. There were three ways out and this file takes the
// third.
//
//   1. `allowJs` in `apps/api/tsconfig.json`. Outside this session's fence, and
//      it widens a deployable's compiler settings to buy one test file a type.
//   2. A hand-written `api-contract-endpoints.d.mts` beside the reader. Inside
//      the fence, and REFUSED ANYWAY: it is a second copy of the reader's type
//      surface that nothing checks against the reader, which is the exact class
//      of defect this check exists to remove, and every other consumer would
//      then trust the copy rather than the source.
//   3. LOAD IT BY PATH AND VALIDATE THE SHAPE AT RUN TIME, which is what
//      `validateParsed` below does. This costs the static edge, so a renamed
//      export is caught by a red test here rather than by `tsc`. That is the
//      honest trade and it is stated rather than hidden: the check has to
//      validate the reader's output at run time regardless, because asserting
//      the coverage statement IS this check's second half, and a declaration
//      file would not have made that validation unnecessary.
//
// `apps/api/src/registry.ts` loads its own route modules exactly this way, by
// computed specifier and then validated against a type that no longer exists at
// run time, and says so in its own words. This is that pattern, one directory
// over.
//
// -----------------------------------------------------------------------------
// THE COVERAGE HALF, AND WHY A GREEN DIFF WITHOUT IT ASSERTS NOTHING
// -----------------------------------------------------------------------------
// A parser that silently drops rows produces a coverage report that looks like
// success. If the heading rule stops matching, the contract reads as zero
// endpoints; if the endpoint-table rule stops matching, it reads as eight
// fewer. So the reader's own statement about what it read is asserted here and
// not merely printed:
//
//   * `anomalies` IS EMPTY. A position inside a structure the reader claims to
//     read, from which it derived no endpoint, lands there with its line. This
//     is the conservation statement for everything INSIDE a structure.
//   * EVERY `read` COUNT IS NON-ZERO. That is the conservation statement for a
//     structure the reader stopped seeing ENTIRELY, which `anomalies` cannot
//     see because a structure nobody entered raises nothing.
//   * `duplicates` IS EMPTY, so `distinct` and `endpoints` are the same
//     population and the diff below is over the whole of it.
//   * EVERY `skipped` ENTRY STATES A REASON. A skip with no `detail` is a skip
//     nobody can audit.
//   * `describeCoverage` RENDERS EVERY ENTRY IT HOLDS, so the human-facing
//     statement cannot go quiet while the structured one is intact.
//
// None of those is a stored expectation about this corpus. Each is the reader
// being held to its own claim about itself.
//
// -----------------------------------------------------------------------------
// FIVE THINGS A GREEN RESULT HERE DOES NOT COVER
// -----------------------------------------------------------------------------
//   1. IT COMPARES `METHOD /path` AND NOTHING ELSE. A registered route whose
//      request schema, response allowlist, auth factor, idempotency or rate
//      limit differs from its contract row is invisible to it.
//   2. IT SAYS NOTHING ABOUT WHICH SURFACE serves a route. `declaredRoutes`
//      unions `registered` and `withheld` across `API_SURFACES` on purpose,
//      because a withheld route is DECLARED and merely not served by that
//      deployment. A route on the wrong side of `surfaceServes` is in neither
//      list.
//   3. IT IS BLIND TO A SURFACE THE CONTRACT NEVER ROWED. Session 329 finding 3
//      reports an event feed that `M06` names and `apps/admin/src/feed.ts`
//      implements with no contract row and no `apps/api` route. That is in
//      neither input, so it is in neither list.
//   4. IT DOES NOT ASSERT THAT A DECLARED ROUTE IS REGISTERED SOMEWHERE. A
//      route withheld on both surfaces answers 404 everywhere and still
//      resolves to a row, which is what `RI-17` states. That third question is
//      `ADR-166` clause 10's and is measured in this session's log rather than
//      gated here.
//   5. THE COVERAGE FLOOR SEES A TOTAL LOSS AND NOT A PARTIAL ONE. `count > 0`
//      fires when the reader stops seeing a structure ENTIRELY; this document
//      declares endpoints in more than one endpoint table, so a rule that stops
//      matching ONE of them leaves the count non-zero and the statement reads
//      as intact. The diff is the backstop, and the seeded case below watches
//      exactly that division rather than claiming it. The floor is deliberately
//      NOT strengthened into a count of tables: that number is the kind of
//      stored expectation `RI-17` exists to remove.
// =============================================================================

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import Fastify from 'fastify';
import { describe, expect, test } from 'vitest';

import { compose, discoverRouteModules } from '../src/registry.ts';
import { API_SURFACES } from '../src/surface.ts';
import type { RouteModule } from '../src/registry.ts';

const ROOT = join(import.meta.dirname, '../../..');

/** The document that declares the endpoints, repo-relative for messages. */
const CONTRACT_REL = 'docs/architecture/API_CONTRACT.md';

/** The reader that parses it, repo-relative for messages. */
const READER_REL = 'packages/tooling/checks/api-contract-endpoints.mjs';

// -----------------------------------------------------------------------------
// The reader's shape, as THIS CHECK NEEDS IT, validated rather than declared
// -----------------------------------------------------------------------------

/** One line of the reader's statement about what it read or did not read. */
interface CoverageEntry {
  readonly kind: string;
  readonly detail: string;
  readonly count: number;
}

/** One endpoint the document declares, with where it was found. */
interface ContractEndpoint {
  readonly endpoint: string;
  readonly line: number;
  readonly source: string;
  readonly raw: string;
}

/** What `readApiContractEndpoints` returns, restricted to what is read here. */
interface ParsedContract {
  readonly endpoints: readonly ContractEndpoint[];
  readonly distinct: readonly string[];
  readonly duplicates: readonly { readonly endpoint: string; readonly lines: readonly number[] }[];
  readonly anomalies: readonly {
    readonly line: number;
    readonly text: string;
    readonly why: string;
  }[];
  readonly read: readonly CoverageEntry[];
  readonly skipped: readonly CoverageEntry[];
}

/** The two functions this check calls, once the module has been validated. */
interface Reader {
  readApiContractEndpoints(markdown: string): ParsedContract;
  describeCoverage(parsed: ParsedContract): readonly string[];
}

/**
 * A validation failure in the reader's shape is a failure of this check to RUN,
 * which is a throw and never a pass. `repo-invariants.mjs` states the rule in
 * its own header and it is the same rule here.
 */
function unusable(what: string): never {
  throw new Error(
    `${READER_REL} ${what}. This check loads that module by path and validates its shape at ` +
      'run time, because it ships no type declaration and a hand-written one would be a ' +
      'second copy of it. A shape this check cannot read is a check that CANNOT RUN, which ' +
      'is a failure and not a skip',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** @returns the value at `field`, having checked it is an array. */
function arrayAt(holder: Record<string, unknown>, field: string, where: string): unknown[] {
  const value = holder[field];
  if (!Array.isArray(value)) unusable(`returns no array \`${field}\` in ${where}`);
  return value;
}

function stringAt(holder: Record<string, unknown>, field: string, where: string): string {
  const value = holder[field];
  if (typeof value !== 'string') unusable(`returns no string \`${field}\` in ${where}`);
  return value;
}

function numberAt(holder: Record<string, unknown>, field: string, where: string): number {
  const value = holder[field];
  if (typeof value !== 'number' || !Number.isInteger(value))
    unusable(`returns no integer \`${field}\` in ${where}`);
  return value;
}

function recordAt(value: unknown, where: string): Record<string, unknown> {
  if (!isRecord(value)) unusable(`returns a non-object entry in ${where}`);
  return value;
}

function coverageEntries(holder: Record<string, unknown>, field: string): CoverageEntry[] {
  return arrayAt(holder, field, 'its result').map((entry) => {
    const row = recordAt(entry, `\`${field}\``);
    return {
      kind: stringAt(row, 'kind', `\`${field}\``),
      detail: stringAt(row, 'detail', `\`${field}\``),
      count: numberAt(row, 'count', `\`${field}\``),
    };
  });
}

/**
 * Narrow the reader's output to {@link ParsedContract}, throwing on any field
 * this check depends on that is missing or of the wrong type.
 *
 * THE ALTERNATIVE WAS A TYPE ASSERTION AND IT WOULD HAVE BEEN WORSE. STRATEGY
 * section 4.5 relaxes the assertion ban inside test fixtures, so an `as` here
 * would lint clean; it would also turn a renamed export into `undefined` read
 * as an empty list, which is a check reporting PASS about a parse that never
 * happened.
 */
function validateParsed(value: unknown): ParsedContract {
  if (!isRecord(value)) unusable('did not return an object');
  const endpoints = arrayAt(value, 'endpoints', 'its result').map((entry) => {
    const row = recordAt(entry, '`endpoints`');
    return {
      endpoint: stringAt(row, 'endpoint', '`endpoints`'),
      line: numberAt(row, 'line', '`endpoints`'),
      source: stringAt(row, 'source', '`endpoints`'),
      raw: stringAt(row, 'raw', '`endpoints`'),
    };
  });
  const distinct = arrayAt(value, 'distinct', 'its result').map((entry) => {
    if (typeof entry !== 'string') unusable('returns a non-string in `distinct`');
    return entry;
  });
  const duplicates = arrayAt(value, 'duplicates', 'its result').map((entry) => {
    const row = recordAt(entry, '`duplicates`');
    return {
      endpoint: stringAt(row, 'endpoint', '`duplicates`'),
      lines: arrayAt(row, 'lines', '`duplicates`').map((line) => {
        if (typeof line !== 'number') unusable('returns a non-number in `duplicates.lines`');
        return line;
      }),
    };
  });
  const anomalies = arrayAt(value, 'anomalies', 'its result').map((entry) => {
    const row = recordAt(entry, '`anomalies`');
    return {
      line: numberAt(row, 'line', '`anomalies`'),
      text: stringAt(row, 'text', '`anomalies`'),
      why: stringAt(row, 'why', '`anomalies`'),
    };
  });
  return {
    endpoints,
    distinct,
    duplicates,
    anomalies,
    read: coverageEntries(value, 'read'),
    skipped: coverageEntries(value, 'skipped'),
  };
}

/**
 * Load the reader from disk and validate that it exports what is called here.
 *
 * The specifier is COMPUTED, which is what keeps `tsc` from resolving a `.mjs`
 * with no declaration file and reporting TS7016. The header says why that is
 * the trade this file takes rather than the one it hides.
 */
async function loadReader(): Promise<Reader> {
  const module: unknown = await import(pathToFileURL(join(ROOT, READER_REL)).href);
  if (!isRecord(module)) unusable('did not load as a module namespace');
  const read = module['readApiContractEndpoints'];
  const describe_ = module['describeCoverage'];
  if (typeof read !== 'function') unusable('exports no `readApiContractEndpoints` function');
  if (typeof describe_ !== 'function') unusable('exports no `describeCoverage` function');
  return {
    readApiContractEndpoints: (markdown) => validateParsed(read(markdown)),
    describeCoverage: (parsed) => {
      const lines: unknown = describe_(parsed);
      if (!Array.isArray(lines)) unusable('`describeCoverage` returned no array');
      return lines.map((line) => {
        if (typeof line !== 'string') unusable('`describeCoverage` returned a non-string line');
        return line;
      });
    },
  };
}

// -----------------------------------------------------------------------------
// The registry half: a real compose(), both surfaces, registered AND withheld
// -----------------------------------------------------------------------------

/**
 * Every `METHOD /path` the modules on disk DECLARE, across every surface.
 *
 * `registered` and `withheld` are unioned because a withheld route is declared
 * and merely not served by that deployment: the public deployment's 404 on
 * `/admin/liability` is `withheld` being non-empty and nothing else, and a
 * check reading only `registered` would report every operator route as
 * uncontracted on the public surface.
 *
 * `API_SURFACES` is read out of `surface.ts` rather than written here, so a
 * third surface is composed by this check on the day it is declared.
 */
function declaredRoutes(modules: readonly RouteModule[]): string[] {
  const declared = new Set<string>();
  for (const surface of API_SURFACES) {
    const report = compose(Fastify(), surface, modules);
    for (const endpoint of report.registered) declared.add(endpoint);
    for (const endpoint of report.withheld) declared.add(endpoint);
  }
  return [...declared].sort();
}

// -----------------------------------------------------------------------------
// The check itself, PURE, so a seeded violation can be watched failing
// -----------------------------------------------------------------------------

/**
 * `RI-17`'s findings over one parse and one route set. Empty when it holds.
 *
 * Pure on purpose: the seeds below run the REAL reader over a MUTATED copy of
 * the live document and call this with the result, so what is watched failing
 * is the check itself rather than a rehearsal of it. A check that has only ever
 * been seen pass is indistinguishable from a check that cannot fail.
 */
export function ri17Findings(parsed: ParsedContract, declared: readonly string[]): string[] {
  const findings: string[] = [];

  // THE COVERAGE HALF FIRST, because a diff over a parse that dropped rows is a
  // diff whose emptiness means nothing, and a reader that read the wrong thing
  // should say so before the lists it produced are believed.
  for (const anomaly of parsed.anomalies)
    findings.push(
      `COVERAGE: ${CONTRACT_REL}:${anomaly.line}: the reader entered a structure it claims to ` +
        `read and derived no endpoint from \`${anomaly.text}\` (${anomaly.why}). An endpoint ` +
        'declared in a shape the reader cannot parse is an endpoint this diff cannot see, and ' +
        'the diff would come back green about it',
    );

  for (const entry of parsed.read) {
    if (entry.count > 0) continue;
    findings.push(
      `COVERAGE: the reader read ZERO \`${entry.kind}\` (${entry.detail}). A structure this ` +
        'document declares endpoints in that the reader no longer sees at all raises no ' +
        'anomaly, because nothing entered it. Every endpoint declared that way is missing ' +
        'from the contract half of this diff',
    );
  }
  if (parsed.read.length === 0)
    findings.push(
      'COVERAGE: the reader states it read NOTHING. A coverage report with no entries cannot ' +
        'be held to any claim, so the parse below it is taken entirely on trust',
    );

  for (const entry of parsed.skipped) {
    if (entry.detail.trim() !== '') continue;
    findings.push(
      `COVERAGE: the reader skipped \`${entry.kind}\` and states no reason for it. A skip ` +
        'nobody can audit is the shape a silently dropped structure lands in',
    );
  }

  for (const duplicate of parsed.duplicates)
    findings.push(
      `COVERAGE: ${CONTRACT_REL} declares \`${duplicate.endpoint}\` at lines ` +
        `${duplicate.lines.join(', ')}. Two headings for one endpoint means two places state ` +
        'its auth, its request and its errors, and nothing makes them agree',
    );

  // THE DIFF, IN BOTH DIRECTIONS. Sets rather than lists, because the contract
  // half is already deduplicated and the route half is unioned over surfaces.
  const contract = new Set(parsed.distinct);
  const routes = new Set(declared);

  for (const endpoint of [...contract].sort()) {
    if (routes.has(endpoint)) continue;
    findings.push(
      `UNBUILT: ${CONTRACT_REL} declares \`${endpoint}\` and NO ROUTE MODULE DECLARES IT. ` +
        'The contract is the specification in a frozen corpus, so this is a commitment the ' +
        'tree has not met: every deployment answers 404 for it and nothing else reports that',
    );
  }

  for (const endpoint of [...routes].sort()) {
    if (contract.has(endpoint)) continue;
    findings.push(
      `UNCONTRACTED: a route module declares \`${endpoint}\` and ${CONTRACT_REL} declares no ` +
        'row for it. A path served by this deployable that the contract does not specify has ' +
        'no stated auth, no stated response allowlist and no stated rate limit, and no ' +
        'reviewer can tell whether it was meant to be public',
    );
  }

  return findings;
}

// -----------------------------------------------------------------------------
// The live run
// -----------------------------------------------------------------------------

const reader = await loadReader();
const contractPath = join(ROOT, CONTRACT_REL);
const markdown = readFileSync(contractPath, 'utf8');
const modules = await discoverRouteModules();
const declared = declaredRoutes(modules);
const parsed = reader.readApiContractEndpoints(markdown);

/** The document's digest, so the seeds can prove they mutated a COPY. */
const contractDigest = createHash('sha256').update(markdown).digest('hex');

describe('RI-17: the contract and the registry declare the same endpoints', () => {
  // A CHECK THAT COMPARED TWO EMPTY SETS IS NOT A CHECK THAT PASSED, and it is
  // the shape both halves fail into: a reader whose rules stopped matching
  // returns nothing, and a discovery that read the wrong directory composes
  // nothing. `compose` refuses the second itself; this refuses the first.
  test('both halves of the diff have inputs, so an empty finding list means something', () => {
    expect(parsed.distinct.length).toBeGreaterThan(0);
    expect(declared.length).toBeGreaterThan(0);
    expect(modules.length).toBeGreaterThan(0);
  });

  test('every declared endpoint resolves to a route, and every route to a row', () => {
    const findings = ri17Findings(parsed, declared);
    expect(findings, reader.describeCoverage(parsed).join('\n')).toStrictEqual([]);
  });

  // The reader's statement about itself, asserted rather than printed. The
  // findings above already carry it; this names the property separately so a
  // failure says WHICH half broke.
  test('the reader read every structure it claims to read, and dropped nothing', () => {
    expect(parsed.anomalies).toStrictEqual([]);
    expect(parsed.duplicates).toStrictEqual([]);
    expect(parsed.read.length).toBeGreaterThan(0);
    for (const entry of parsed.read) expect(entry.count, entry.kind).toBeGreaterThan(0);
    for (const entry of parsed.skipped) expect(entry.detail, entry.kind).not.toBe('');
  });

  // A coverage statement that is intact in the structure and silent in the
  // rendering is a statement no reader of the output can check.
  test('describeCoverage renders every entry the result holds', () => {
    const rendered = reader.describeCoverage(parsed).join('\n');
    for (const entry of [...parsed.read, ...parsed.skipped]) expect(rendered).toContain(entry.kind);
  });
});

// -----------------------------------------------------------------------------
// Seeded violations, watched failing
// -----------------------------------------------------------------------------

/** A copy of the live document with `line` (1-based) removed. */
function withoutLine(source: string, line: number): string {
  const lines = source.split('\n');
  lines.splice(line - 1, 1);
  return lines.join('\n');
}

/**
 * The header row of every endpoint table, derived from the reader's own output
 * rather than from a second copy of its rule: a table-sourced endpoint is a
 * body row, consecutive body rows are one table, the first of them is preceded
 * by a delimiter row, and the delimiter row is preceded by the header.
 */
function endpointTableHeaderLines(result: ParsedContract): number[] {
  const rows = result.endpoints
    .filter((e) => e.source === 'table')
    .map((e) => e.line)
    .sort((a, b) => a - b);
  expect(rows.length, 'the live document declares endpoints in a table').toBeGreaterThan(0);
  const headers: number[] = [];
  for (const [index, line] of rows.entries())
    if (index === 0 || line !== (rows[index - 1] ?? 0) + 1) headers.push(line - 2);
  return headers;
}

/** A copy of `source` with the `Endpoint` header cell renamed on each of `headers`. */
function renameEndpointColumns(source: string, headers: readonly number[]): string {
  const lines = source.split('\n');
  for (const header of headers) {
    const before = lines[header - 1] ?? '';
    expect(before, 'the derived header row is the `Endpoint` one').toMatch(/^\| *Endpoint\b/);
    lines[header - 1] = before.replace(/^\| *Endpoint\b/, '| Route');
  }
  return lines.join('\n');
}

describe('RI-17 fails on a seeded violation, which is the whole of its evidence', () => {
  test('a contract row with no route is reported as UNBUILT', () => {
    const seeded = `${markdown}\n\n### GET /admin/ri17-seeded-projection\n`;
    const findings = ri17Findings(reader.readApiContractEndpoints(seeded), declared);
    expect(findings).toStrictEqual([expect.stringContaining('UNBUILT') as unknown as string]);
    expect(findings[0]).toContain('GET /admin/ri17-seeded-projection');
  });

  test('a route with no contract row is reported as UNCONTRACTED', () => {
    // The heading is chosen from the parse rather than named here, so the seed
    // does not go stale when the document moves. One that declares a single
    // endpoint, because deleting a three-path heading removes three.
    const single = parsed.endpoints.find((e) => e.source === 'heading' && !e.raw.includes(','));
    expect(single, 'the live document declares an endpoint under its own heading').toBeDefined();
    if (single === undefined) return;
    const seeded = withoutLine(markdown, single.line);
    const findings = ri17Findings(reader.readApiContractEndpoints(seeded), declared);
    expect(findings).toStrictEqual([expect.stringContaining('UNCONTRACTED') as unknown as string]);
    expect(findings[0]).toContain(single.endpoint);
  });

  test('a coverage statement that no longer matches is reported before the diff', () => {
    // The `Endpoint` header cell is the WHOLE of the endpoint-table rule, so
    // renaming it is a table the reader stops seeing entirely. Nothing enters
    // it, so it raises no anomaly: only the `read` count going to zero says so.
    const headers = endpointTableHeaderLines(parsed);
    const result = reader.readApiContractEndpoints(renameEndpointColumns(markdown, headers));
    const findings = ri17Findings(result, declared);

    const coverage = findings.filter((f) => f.startsWith('COVERAGE:'));
    expect(coverage.length).toBeGreaterThan(0);
    expect(coverage.join('\n')).toContain('read ZERO');
    // And every row those tables declared is now uncontracted, which is the
    // green-looking failure the coverage assertion exists to name first.
    expect(findings.filter((f) => f.startsWith('UNCONTRACTED')).length).toBeGreaterThan(0);
  });

  // THE LIMIT OF THE COVERAGE FLOOR, WATCHED RATHER THAN CLAIMED. `count > 0`
  // sees a structure the reader stopped reading ENTIRELY and cannot see one it
  // stopped reading in PART: this document declares endpoints in more than one
  // endpoint table, so renaming one leaves the count non-zero and the coverage
  // statement looks intact. The diff is the backstop and it holds, which is why
  // the floor is not strengthened into a stored count of tables here: that
  // number would be the very thing `RI-17` exists to stop anyone writing down.
  test('a PARTIAL structure loss passes the coverage floor and is caught by the diff', () => {
    const headers = endpointTableHeaderLines(parsed);
    expect(
      headers.length,
      'more than one endpoint table, or this case proves nothing',
    ).toBeGreaterThan(1);
    const result = reader.readApiContractEndpoints(
      renameEndpointColumns(markdown, headers.slice(0, 1)),
    );
    const findings = ri17Findings(result, declared);
    expect(findings.filter((f) => f.startsWith('COVERAGE:'))).toStrictEqual([]);
    expect(findings.filter((f) => f.startsWith('UNCONTRACTED')).length).toBeGreaterThan(0);
  });

  test('an endpoint the reader cannot parse is an anomaly and not a silent drop', () => {
    // A heading whose whole text is a bare method: an endpoint declared in a
    // shape the reader enters and cannot finish. It is the defect session 338's
    // fixture found in the reader itself, seeded here against the real document.
    const seeded = `${markdown}\n\n#### GET\n`;
    const result = reader.readApiContractEndpoints(seeded);
    expect(result.anomalies.length).toBe(1);
    const findings = ri17Findings(result, declared);
    expect(findings).toStrictEqual([expect.stringContaining('COVERAGE:') as unknown as string]);
  });

  test('the seeds mutated a copy and the live document is byte for byte unchanged', () => {
    expect(createHash('sha256').update(readFileSync(contractPath, 'utf8')).digest('hex')).toBe(
      contractDigest,
    );
  });
});
