import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import {
  CONTRACT_METHODS,
  describeCoverage,
  readApiContractEndpoints,
  tableCells,
} from '../checks/api-contract-endpoints.mjs';

// =============================================================================
// THE SUBJECT IS A FIXTURE AND NEVER `docs/architecture/API_CONTRACT.md`
// =============================================================================
// A test pinned to the live corpus goes red every time a contract row lands,
// which is a check that punishes the work it exists to support. Session 336 is
// adding a contract row concurrently with the session that wrote this file, so
// the failure mode is not hypothetical: a suite asserting "72 endpoints" would
// have been red before it was merged, and the repair a later session reaches
// for is to edit the number, which is the assertion deleting itself.
//
// `fixtures/api-contract.fixture.md` therefore carries every SHAPE the live
// document has, at one twentieth the size, plus three shapes the live document
// does NOT have: a heading whose whole text is a bare method, a heading segment
// naming an action where a path belongs, and a row of an endpoint table that
// states no endpoint. A reader is only trusted on a malformed input once it has
// been given one, and the first of those three was a REAL DEFECT this fixture
// found: the reader dropped it silently into its count of non-endpoint
// headings, which is the one thing it promises not to do.
//
// -----------------------------------------------------------------------------
// EVERY EXPECTATION IS WRITTEN OUT, NOT COMPUTED FROM THE READER
// -----------------------------------------------------------------------------
// The fixture is small enough to hold its whole answer in this file, so the
// oracle is a list a human wrote from reading the markdown. A test that derives
// its expectation by running the thing it is testing asserts that the reader is
// deterministic and nothing else.
// =============================================================================

const FIXTURE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'api-contract.fixture.md'),
  'utf8',
);

/** The whole answer, in document order, written from reading the fixture. */
const EXPECTED: ReadonlyArray<readonly [string, number, 'heading' | 'table']> = [
  ['POST /auth/otp', 32, 'heading'],
  ['POST /auth/passkey/register/options', 36, 'heading'],
  ['POST /auth/passkey/register/verify', 36, 'heading'],
  ['POST /phone/change', 42, 'heading'],
  ['GET /phone/change', 42, 'heading'],
  ['POST /phone/change/:id/cancel', 42, 'heading'],
  ['GET /accounts/:accountId/certificate', 48, 'heading'],
  ['POST /admin/plans/:planId/versions', 70, 'heading'],
  ['POST /internal/batch/run', 82, 'table'],
  ['GET /health', 83, 'table'],
  ['GET /health', 84, 'table'],
  ['GET /internal/pipe', 86, 'table'],
];

const read = () => readApiContractEndpoints(FIXTURE);

describe('the reader reads both structures and nothing else', () => {
  test('every endpoint, in document order, with its line and its structure', () => {
    expect(read().endpoints.map((e) => [e.endpoint, e.line, e.source])).toEqual(
      EXPECTED.map((e) => [...e]),
    );
  });

  test('a heading carrying several endpoints yields one entry per endpoint', () => {
    // THE FAILURE THIS WATCHES IS NAMED BY THE LIVE DOCUMENT ITSELF, section 8:
    // "One heading over three paths reads as one endpoint to anything parsing
    // this document." A reader taking one entry per heading passes every other
    // case in this file and loses five endpoints on the real contract.
    const atLine = (line: number) => read().endpoints.filter((e) => e.line === line);
    expect(atLine(36).map((e) => e.endpoint)).toEqual([
      'POST /auth/passkey/register/options',
      'POST /auth/passkey/register/verify',
    ]);
    expect(atLine(42).map((e) => e.endpoint)).toEqual([
      'POST /phone/change',
      'GET /phone/change',
      'POST /phone/change/:id/cancel',
    ]);
  });

  test('a segment stating no method inherits the one to its left, and never the one to its right', () => {
    const one = readApiContractEndpoints('### GET /a, /b, POST /c, /d');
    expect(one.distinct.sort()).toEqual(['GET /a', 'GET /b', 'POST /c', 'POST /d'].sort());
    expect(one.anomalies).toEqual([]);
  });

  test('`METHOD /path` is the key, so two methods on one path are two entries', () => {
    const both = read().endpoints.filter((e) => e.path === '/phone/change');
    expect(both.map((e) => e.method)).toEqual(['POST', 'GET']);
  });

  test('a query string is stripped, because a route is registered on a path', () => {
    // Both of the live document's query-string headings would be unmatchable
    // against every route that exists if this did not hold.
    expect(read().distinct).toContain('GET /accounts/:accountId/certificate');
    expect(read().distinct.some((e) => e.includes('?'))).toBe(false);
  });

  test('a table is read only when its first header cell is exactly `Endpoint`', () => {
    const skipped = read().skipped.find((s) => s.kind === 'tables keyed on something else');
    expect(skipped?.count).toBe(2);
    expect(skipped?.detail).toContain('`Code`');
    expect(skipped?.detail).toContain('`Surface`');
    // The `Surface` table's first row restates `POST /auth/otp` and its other
    // two rows are `Authenticated reads` and `Webhooks`. Reading it would add
    // nothing and invent two.
    expect(read().endpoints.filter((e) => e.line > 88)).toEqual([]);
  });

  test('prose is read not at all', () => {
    // Section 1 of the fixture names `POST /accounts/:id/reset` and
    // `/openapi.json`. The first is the live document's own spelling drift and
    // the second is a path that must 404. This is the skip that produced 35
    // distinct paths where the tree has 72 routes.
    expect(read().distinct).not.toContain('POST /accounts/:id/reset');
    expect(read().distinct.some((e) => e.includes('openapi'))).toBe(false);
  });

  test('a fenced block is read not at all, including lines shaped like the structures that are read', () => {
    expect(read().distinct).not.toContain('GET /inside-a-fence');
  });

  test('a subsection deliberately carrying no `METHOD /path` heading contributes nothing', () => {
    // 2.1 is the fixture's copy of the live document's 6.1 and section 8 live
    // payloads. The reader needs no list of them: it reads headings, and those
    // subsections have no endpoint heading to read. A constant naming them here
    // would be a second copy of a ruling, and it would drift.
    expect(read().endpoints.filter((e) => e.line > 48 && e.line < 68)).toEqual([]);
  });
});

describe('a row it cannot parse is reported and never dropped', () => {
  test('all three malformed positions are anomalies, with their lines and their text', () => {
    expect(read().anomalies.map((a) => [a.line, a.text, a.kind])).toEqual([
      [68, 'GET', 'endpoint-heading-segment'],
      [70, 'publish', 'endpoint-heading-segment'],
      [85, 'Queue depth', 'endpoint-table-row'],
    ]);
  });

  test('a heading whose whole text is a bare method is an anomaly and not a non-endpoint heading', () => {
    // THE REGRESSION THIS PINS IS THE DEFECT THE FIXTURE FOUND. The reader
    // required a space after the method, so `### GET` did not begin with a
    // method as far as it was concerned and fell into the count of headings
    // stating no method. It is invisible on the live document, where every
    // heading is well formed, and it is a malformed endpoint heading silently
    // dropped.
    const bare = readApiContractEndpoints('### GET');
    expect(bare.endpoints).toEqual([]);
    expect(bare.anomalies.map((a) => a.text)).toEqual(['GET']);
    expect(bare.skipped.find((s) => s.kind === 'headings stating no method')?.count).toBe(0);
  });

  test('a heading beginning with a word that merely starts with a method is a section heading', () => {
    const getting = readApiContractEndpoints('## GETTING STARTED');
    expect(getting.endpoints).toEqual([]);
    expect(getting.anomalies).toEqual([]);
    expect(getting.skipped.find((s) => s.kind === 'headings stating no method')?.count).toBe(1);
  });

  test('an endpoint declared twice is reported rather than silently deduplicated', () => {
    // `distinct` collapses it, which is what a diff wants; `duplicates` is how
    // the caller learns the document said it twice.
    expect(read().duplicates).toEqual([{ endpoint: 'GET /health', lines: [83, 84] }]);
    expect(read().distinct.filter((e) => e === 'GET /health')).toHaveLength(1);
  });
});

describe('the coverage it states is derived from the read it did', () => {
  test('the read counts are the read', () => {
    const r = read();
    const count = (kind: string) => r.read.find((x) => x.kind === kind)?.count;
    expect(count('endpoint headings')).toBe(6);
    expect(count('endpoints from those headings')).toBe(
      EXPECTED.filter(([, , source]) => source === 'heading').length,
    );
    expect(count('endpoint tables')).toBe(1);
    expect(count('rows of those tables')).toBe(5);
  });

  test('every heading in the fixture is either read or counted as skipped', () => {
    // The property that makes the coverage statement an ACCOUNT rather than a
    // list: no heading falls between the two counts. This is the assertion the
    // bare-method defect failed in the other direction, by counting a heading
    // it should have read.
    const r = read();
    // The oracle counts headings itself rather than asking the reader, and it
    // has to honour the fence to do it: the fixture carries a `#### GET` line
    // INSIDE a TypeScript block, and a counter that misses that reports 14
    // where the document has 13. That is this assertion catching its own oracle
    // rather than the reader, which is why the toggle is written out here
    // instead of imported.
    let fenced = false;
    const headings = FIXTURE.split('\n').filter((l) => {
      if (l.startsWith('```')) {
        fenced = !fenced;
        return false;
      }
      return !fenced && /^#{1,6} /.test(l);
    }).length;
    const read_ = r.read.find((x) => x.kind === 'endpoint headings')?.count ?? 0;
    const skipped = r.skipped.find((x) => x.kind === 'headings stating no method')?.count ?? 0;
    expect(read_ + skipped).toBe(headings);
    expect(headings).toBe(13);
  });

  test('`describeCoverage` prints every anomaly and every duplicate', () => {
    const lines = describeCoverage(read()).join('\n');
    expect(lines).toContain('ANOMALIES: 3');
    expect(lines).toContain('line 85: Queue depth');
    expect(lines).toContain('DUPLICATE DECLARATIONS: 1');
    expect(lines).toContain('GET /health at lines 83, 84');
  });

  test('the method vocabulary is the five `registry.ts` closes on', () => {
    // It is a SECOND COPY, deliberately, and the reader's header says why. This
    // asserts the copy, so a divergence is a diff on a test rather than a
    // reader quietly failing to see a verb the contract started using.
    expect(CONTRACT_METHODS).toEqual(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);
  });
});

describe('table cells are split on pipes that are not content', () => {
  test('a pipe inside backticks is content', () => {
    expect(tableCells('| `a|b` | second |')).toEqual(['`a|b`', 'second']);
    expect(read().distinct).toContain('GET /internal/pipe');
  });

  test('an empty first column stays visible rather than shifting every cell left', () => {
    expect(tableCells('|  | second | third |')).toEqual(['', 'second', 'third']);
  });
});

describe('the reader is fast enough to be run on every measurement', () => {
  test('the fixture reads in under 50 ms', () => {
    // `RI-16`'s reader took over five minutes on one document before three
    // defects in it were found. A slow reader is a defect and not a cost of the
    // job, and the shapes that made that one slow -- a greedy run over a
    // character class, a leading group that is optional at every index -- are
    // the shapes this one avoids on purpose.
    const started = performance.now();
    readApiContractEndpoints(FIXTURE);
    expect(performance.now() - started).toBeLessThan(50);
  });
});
