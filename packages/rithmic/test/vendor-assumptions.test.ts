import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import {
  FILE_MODE_VENDOR_ASSUMPTIONS,
  OUT_OF_SCOPE_FOR_FILE_MODE,
} from '../src/simulator/assumptions.js';

// CI-02, the `unit` project.
//
// =============================================================================
// THE COMMENT LIST IS THE DIFF, AND THIS IS WHAT MAKES THAT TRUE
// =============================================================================
// M02 holds at `status: review` under ADR-005 and section 11's rows are
// unconfirmed. This package is written against the public CSV/SFTP description
// and every place the real spec could differ carries its `V-M2-nn`, so that
// when the vendor call happens the citation list IS the diff.
//
// A citation list only works if it is closed against the table it cites, in
// both directions and without a hand-maintained count anywhere. ADR-034 is the
// hand-maintained-count class and this corpus has found fifteen of them wrong;
// M02's own header states the remedy, which is to state the rule rather than
// the numeral. So: THE ROW SET IS PARSED FROM M02 AND NOTHING HERE COUNTS IT.
//
// WHAT THIS PROVES:
//
//   - no `V-M2-nn` in `src/` was invented, and none has been renumbered away
//   - no row of section 11 has silently fallen off the in-scope list
//   - a row ADDED to section 11 fails here until it is classified, which is the
//     direction that matters: a new vendor question the simulator quietly does
//     not consider is the one nobody notices
//
// WHAT IT DOES NOT PROVE, stated because the check would otherwise be read as
// stronger than it is: it cannot tell whether the comment citing `V-M2-05` sits
// on the line that actually depends on `V-M2-05`. That is a reading, and the
// conformance suite M02 section 8.2 specifies (one case per row, each with the
// fixture that encodes it) is what turns it into an assertion. This check keeps
// the LIST honest; the suite is what keeps the CLAIMS honest.
// =============================================================================

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');
const M02 = join(HERE, '..', '..', '..', 'docs', 'plans', 'M02-rithmic-bridge.md');

/** `assumptions.ts` IS the table. Every id appears there by definition, so it is not a citation. */
const NOT_A_CITATION = join(SRC, 'simulator', 'assumptions.ts');

const VENDOR_ID = /V-M2-\d{2}/g;
/** A section 11 row: the id is the first cell, optionally bolded. */
const TABLE_ROW = /^\|\s*\*{0,2}(V-M2-\d{2})\*{0,2}\s*\|/gm;

function everyTypeScriptFile(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...everyTypeScriptFile(path));
    else if (entry.endsWith('.ts')) found.push(path);
  }
  return found.sort();
}

/** Section 11's rows, read from M02 rather than restated here. */
function declaredRows(): readonly string[] {
  const body = readFileSync(M02, 'utf8');
  const ids = [...body.matchAll(TABLE_ROW)].map((match) => match[1] ?? '');
  // A check that cannot reach its inputs throws rather than reporting a pass on
  // an empty set, which is `repo-invariants.mjs`'s second standing rule. A
  // reformatted table would otherwise make every assertion below vacuously
  // true.
  if (ids.length < 10) {
    throw new Error(
      `parsed ${ids.length} V-M2 rows from ${M02}. Section 11's table is the input to this ` +
        'check and it could not be read; the check has not passed, it has failed to run',
    );
  }
  return ids;
}

const DECLARED = declaredRows();
const IN_SCOPE = FILE_MODE_VENDOR_ASSUMPTIONS.map((row) => row.id);
const OUT_OF_SCOPE = OUT_OF_SCOPE_FOR_FILE_MODE.map((row) => row.id);

test('section 11 parses to a gapless V-M2-01..nn run', () => {
  const expected = DECLARED.map((_, index) => `V-M2-${String(index + 1).padStart(2, '0')}`);
  expect(DECLARED).toEqual(expected);
});

test('in-scope and out-of-scope partition section 11 exactly', () => {
  const classified = [...IN_SCOPE, ...OUT_OF_SCOPE].sort();
  expect(classified).toEqual([...DECLARED].sort());
});

test('no row is classified twice', () => {
  const both = IN_SCOPE.filter((id) => OUT_OF_SCOPE.includes(id));
  expect(both).toEqual([]);
  expect(new Set(IN_SCOPE).size).toBe(IN_SCOPE.length);
  expect(new Set(OUT_OF_SCOPE).size).toBe(OUT_OF_SCOPE.length);
});

test('every in-scope row is cited somewhere in src', () => {
  // An assumption nothing depends on is a decoration, and a decoration on this
  // list is worse than an absence: it makes the vendor call look covered.
  const sources = everyTypeScriptFile(SRC).filter((path) => path !== NOT_A_CITATION);
  const cited = new Map<string, string[]>();
  for (const path of sources) {
    const body = readFileSync(path, 'utf8');
    for (const match of body.matchAll(VENDOR_ID)) {
      const where = cited.get(match[0]) ?? [];
      const file = relative(SRC, path);
      if (!where.includes(file)) where.push(file);
      cited.set(match[0], where);
    }
  }
  const uncited = IN_SCOPE.filter((id) => !cited.has(id));
  expect(uncited, `in-scope rows with no citation in src: ${uncited.join(', ')}`).toEqual([]);
});

test('every V-M2 citation in src names a row section 11 actually has', () => {
  const sources = everyTypeScriptFile(SRC).filter((path) => path !== NOT_A_CITATION);
  const declared = new Set(DECLARED);
  const invented: string[] = [];
  for (const path of sources) {
    for (const match of readFileSync(path, 'utf8').matchAll(VENDOR_ID)) {
      if (!declared.has(match[0])) invented.push(`${relative(SRC, path)}: ${match[0]}`);
    }
  }
  expect(invented, `citations naming no section 11 row: ${invented.join(', ')}`).toEqual([]);
});

test('every classified row carries the two sentences that make it actionable', () => {
  // A row that says only "V-M2-08" tells a reader nothing at the moment the
  // call happens. Each in-scope row states what was ASSUMED and what MOVES, and
  // each out-of-scope row states why it cannot bite here.
  for (const row of FILE_MODE_VENDOR_ASSUMPTIONS) {
    expect(row.id).toMatch(/^V-M2-\d{2}$/);
    expect(row.assumed.length).toBeGreaterThan(40);
    expect(row.whatMoves.length).toBeGreaterThan(40);
  }
  for (const row of OUT_OF_SCOPE_FOR_FILE_MODE) {
    expect(row.id).toMatch(/^V-M2-\d{2}$/);
    expect(row.why.length).toBeGreaterThan(40);
  }
});
