// =============================================================================
// THE CENSUS IS WATCHED SEEING WHAT IT CLAIMS TO SEE, AND MISSING WHAT ADR-446
// SAYS IT MISSES
// =============================================================================
// `repo-invariants.test.ts`'s rule is that a check only ever seen pass is
// indistinguishable from a check that cannot fail. This file is not a gate, so
// the rule arrives in a different shape: a CENSUS only ever seen return a
// number is indistinguishable from a census returning the wrong number.
//
// So every claim `ADR-446` makes about this file is a case here. The flattening
// is watched catching a sentence that wraps across THREE lines, which is the
// one `RI-35`'s two-line `SWEEP_WINDOW` (`absence-claims.mjs:328`) cannot
// reach. And the THREE FALSE-POSITIVE CLASSES `ADR-446` section 5 names are
// each watched being counted, because a census whose limits are prose is a
// census whose limits nobody re-derives.
// =============================================================================

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import {
  ABSENCE_GRAMMAR,
  censusPopulation,
  censusReport,
  flattenDocument,
  grammarHits,
  isDatedRecord,
  sample,
  sentencesOf,
} from '../checks/absence-grammar-census.mjs';
import { REPO_ROOT } from '../checks/repo-invariants.mjs';

const seeded: string[] = [];
afterEach(() => {
  for (const dir of seeded.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway tree carrying one `docs/` file, addressed the way the census addresses one. */
function seed(file: string, body: string): { root: string; file: string } {
  const root = mkdtempSync(join(tmpdir(), 'census-'));
  seeded.push(root);
  const rel = `docs/${file}`;
  mkdirSync(join(root, 'docs', ...file.split('/').slice(0, -1)), { recursive: true });
  writeFileSync(join(root, rel), body, 'utf8');
  return { root, file: rel };
}

describe('line breaks are flattened before anything is counted', () => {
  test('a sentence wrapped across THREE lines is seen', () => {
    // The two-line window RI-35 uses would lose this one: the subject sits on
    // line 1 and the verb on line 3.
    const body = ['No check', 'in this', 'tree compares the two.'].join('\n');
    const { root, file } = seed('wrapped.md', body);
    const rows = censusPopulation(root, { files: [file] });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.line).toBe(1);
  });

  test('the same sentence on one line is seen too, so the flattening adds rather than replaces', () => {
    const { root, file } = seed('flat.md', 'No check in this tree compares the two.');
    expect(censusPopulation(root, { files: [file] })).toHaveLength(1);
  });

  test('a single-line scan is watched MISSING the wrapped one, which is why the flattening exists', () => {
    const body = ['No check', 'in this', 'tree compares the two.'].join('\n');
    const missedByLines = body.split('\n').filter((l) => grammarHits(l).length > 0);
    expect(missedByLines).toHaveLength(0);
  });

  test('the line map survives flattening and points at the ORIGINATING line', () => {
    const body = ['# Title', '', 'Filler here.', '', 'Nothing', 'checks it.'].join('\n');
    const { flat, lineAt } = flattenDocument(body);
    expect(flat).toContain('Nothing checks it.');
    expect(lineAt(flat.indexOf('Nothing'))).toBe(5);
  });

  test('flattening does not collapse whitespace, because that would invalidate every offset', () => {
    const { flat, lineAt } = flattenDocument('a    b\nNothing  checks it.');
    expect(lineAt(flat.indexOf('Nothing'))).toBe(2);
  });
});

describe('the grammar is data and every figure is stamped with the ids that produced it', () => {
  test('each entry has an id and a case-insensitive regex', () => {
    expect(ABSENCE_GRAMMAR.length).toBeGreaterThan(0);
    for (const g of ABSENCE_GRAMMAR) {
      expect(typeof g.id).toBe('string');
      expect(g.re.flags).toContain('i');
    }
  });

  test('the ids are unique, so a figure stamped with one is traceable to one pattern', () => {
    const ids = ABSENCE_GRAMMAR.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('SHOUTED prose is read, which is this estate house style and RI-14s own lesson', () => {
    expect(grammarHits('NOTHING CHECKS IT.')).toContain('nothing-VERB');
  });

  test('a claim about a NAMED export is NOT this grammar, because that half is RI-14s', () => {
    expect(grammarHits('No implementation of `IdempotencyStore` exists in this tree.')).toEqual([]);
  });
});

describe('the three false-positive classes ADR-446 section 5 names are each counted, not narrowed away', () => {
  test('a QUOTATION is counted, and the census cannot tell it from an assertion', () => {
    const quoting = 'The evidence offered for it is *"no check in this tree compares the two"*.';
    expect(grammarHits(quoting)).not.toEqual([]);
  });

  test('a FENCE statement is counted, and it is a completeness report rather than a defect', () => {
    expect(grammarHits('Nothing in this entry touches any of the three.')).not.toEqual([]);
  });

  test('an INCIDENTAL negation is counted, and it asserts nothing about check coverage', () => {
    expect(grammarHits('A token nothing checks is not a control.')).not.toEqual([]);
  });
});

describe('the dated/live split is BY FILE and ADR-446 section 7 records that the file is the wrong unit', () => {
  test('an ADR and a session log are dated records', () => {
    expect(isDatedRecord('docs/decisions/ADR-440.md')).toBe(true);
    expect(isDatedRecord('docs/sessions/2026-09-07-session-635.md')).toBe(true);
    expect(isDatedRecord('docs/reviews/2026-08-29-approval-population.md')).toBe(true);
  });

  test('the three MIXED-UNIT files fall on the LIVE side, which is the misassignment ADR-446 names', () => {
    expect(isDatedRecord('docs/STATE.md')).toBe(false);
    expect(isDatedRecord('docs/sessions/README.md')).toBe(false);
    expect(isDatedRecord('docs/decisions/ALLOCATION.md')).toBe(false);
  });

  test('a registry is not a dated record by path, so ALLOCATION rows are stratified live', () => {
    expect(isDatedRecord('docs/decisions/README.md')).toBe(false);
  });
});

describe('the sample is reproducible, which is what lets ADR-446 state a selection method', () => {
  const rows = Array.from({ length: 200 }, (_, i) => i);

  test('the same seed over the same population returns the same rows', () => {
    expect(sample(rows, 12, 446)).toEqual(sample(rows, 12, 446));
  });

  test('a different seed returns a different draw', () => {
    expect(sample(rows, 12, 446)).not.toEqual(sample(rows, 12, 447));
  });

  test('it draws without replacement', () => {
    const drawn = sample(rows, 40, 446);
    expect(new Set(drawn).size).toBe(40);
  });

  test('asking for more than the population returns the population', () => {
    expect(sample(rows, 500, 446)).toHaveLength(200);
  });
});

describe('sentence segmentation counts SENTENCES and never MATCHES', () => {
  test('two absence claims in one paragraph are two rows', () => {
    const { root, file } = seed(
      'two.md',
      'No gate reads the table. Nothing checks the second one either.',
    );
    expect(censusPopulation(root, { files: [file] })).toHaveLength(2);
  });

  test('a sentence satisfying two grammar entries is ONE row carrying two ids', () => {
    const hits = grammarHits('Not one check reads it and nothing binds it.');
    expect(hits.length).toBeGreaterThan(1);
  });

  test('a table row splits on the pipe, so a row of cells is not one sentence', () => {
    expect(sentencesOf('| nothing reads | nothing binds |').length).toBeGreaterThan(1);
  });
});

describe('the census runs over the real tree and reports a stratified population', () => {
  test('it returns a population, a split that sums to it, and a file count', () => {
    const r = censusReport(REPO_ROOT);
    expect(r.total).toBeGreaterThan(0);
    expect(r.dated + r.live).toBe(r.total);
    expect(r.files).toBeGreaterThan(0);
    expect(r.grammar).toEqual(ABSENCE_GRAMMAR.map((g) => g.id));
  });

  test('every row carries a citable file:line and a non-empty id set', () => {
    for (const row of censusReport(REPO_ROOT).rows.slice(0, 50)) {
      expect(row.file.startsWith('docs/')).toBe(true);
      expect(row.line).toBeGreaterThan(0);
      expect(row.ids.length).toBeGreaterThan(0);
    }
  });

  test('nothing outside docs/ enters the population', () => {
    expect(censusReport(REPO_ROOT).rows.every((r) => r.file.startsWith('docs/'))).toBe(true);
  });
});
