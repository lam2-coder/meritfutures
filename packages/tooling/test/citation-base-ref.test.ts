import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  CUTOFF,
  GRANDFATHERED,
  NAMING,
  OPENING_LINES,
  baseNamedIn,
  derive,
  legCutoffIsTightest,
  legDerivationIsReal,
  legForwardNamesItsTree,
  legGrandfatheredIsPinned,
  maskedLines,
  publishing,
  repoRelative,
  run,
  sitesIn,
} from '../checks/citation-base-ref.mjs';
import { CORPUS_SCAN_MS } from './scan-budget.js';

// =============================================================================
// EVERY LEG IS WATCHED FIRING AND WATCHED NOT OVER-FIRING, AND NO DATED RECORD
// IS EDITED TO DO IT
// =============================================================================
// The population this check reads is `docs/decisions/`, and every member of it
// below the cutoff is a record `ADR-386`:169 forbids repairing. So the legs take
// their inputs as arguments and every seeded case below builds its own corpus:
// a fabricated directory where the file has to be read, and a fabricated entry
// list where it does not.
//
// TWO CASES READ THE REAL TREE and both carry `CORPUS_SCAN_MS`, which is
// `tree-input-budget.mjs`'s rule and not a preference. Every other case here has
// a fixture for an input and carries none, because a budget on a case that reads
// a temporary directory is a wall doing nothing but bounding a hang.
//
// THE CASES ARE WRITTEN AS SHAPES AND NOT AS SITES. A case pinned to
// `ADR-416.md` would be this suite carrying the exact defect it exists to check:
// a claim about one file that stops being true when the file moves. The one case
// that names a real entry names it to assert a PROPERTY OF THE CUTOFF, which is
// the one thing about this check that is a claim about a specific dated record.
// =============================================================================

/** An entry as `derive` returns it. */
type Entry = ReturnType<typeof derive>[number];

/** A fabricated corpus, one entry per key. */
function corpus(entries: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'merit-citation-base-'));
  for (const [name, body] of Object.entries(entries)) writeFileSync(join(dir, name), body);
  return dir;
}

/** An entry row, without a file behind it. */
const entry = (number: number, sites: number, base: string | null): Entry => ({
  number,
  file: `ADR-${String(number).padStart(3, '0')}.md`,
  sites,
  base,
});

/**
 * A fabricated population that satisfies every leg.
 *
 * The grandfathered half is built to the pin exactly, because leg C's whole
 * purpose is to be sensitive to that number, and a fixture that missed it would
 * make every "does not fire" case below vacuous.
 */
function compliant(): Entry[] {
  const rows: Entry[] = [];
  for (let i = 0; i < GRANDFATHERED.publishing; i += 1) {
    const named = i >= GRANDFATHERED.unnamed;
    // The last row below the cutoff is `CUTOFF - 1` and it must be unnamed, so
    // leg D holds. Everything else is packed downwards from there.
    rows.push(entry(CUTOFF - 1 - i, 1, named ? 'deadbeef' : null));
  }
  rows.push(entry(CUTOFF, 3, 'deadbeef'), entry(CUTOFF + 1, 1, 'cafef00d'));
  return rows.sort((a, b) => a.number - b.number);
}

describe('the harvest: which pointers count as publishing a source site', () => {
  test('a markdown link whose label carries the line is a site', () => {
    expect(sitesIn('see [`scoped-db.ts:4480`](../../packages/db/src/scoped-db.ts)')).toEqual([
      { path: 'packages/db/src/scoped-db.ts', line: 4480 },
    ]);
  });

  test('a link whose target carries `#Lnnn` is the same site by another spelling', () => {
    expect(sitesIn('[the guard](../../packages/db/src/scoped-db.ts#L473)')).toEqual([
      { path: 'packages/db/src/scoped-db.ts', line: 473 },
    ]);
  });

  test('a link followed by a backticked line is a site', () => {
    expect(sitesIn('[`refusal-naming.js`](../../packages/x/refusal-naming.js)`:198`')).toEqual([
      { path: 'packages/x/refusal-naming.js', line: 198 },
    ]);
  });

  test('a bare repo-relative path:line is a site', () => {
    expect(sitesIn('`apps/api/test/wiring.test.ts:434` is the one')).toEqual([
      { path: 'apps/api/test/wiring.test.ts', line: 434 },
    ]);
  });

  test('a pointer into a document or a migration is not a SOURCE site', () => {
    // OPAQUE is `repairable-sites.mjs`'s verdict for these and this check
    // inherits its `READABLE`, so the two instruments read one population.
    expect(
      sitesIn('[ADR-386](ADR-386.md):169 and `packages/db/migrations/0016_x.sql:229`'),
    ).toEqual([]);
  });

  test('an external link is not a site whatever line it carries', () => {
    expect(sitesIn('[v4](https://example.invalid/checkout.ts:12)')).toEqual([]);
    expect(repoRelative('https://example.invalid/x.ts')).toBeNull();
  });

  test('a path with no line is not a site, because a site is a claim about a line', () => {
    expect(sitesIn('[`scoped-db.ts`](../../packages/db/src/scoped-db.ts)')).toEqual([]);
  });

  test('a fenced block is masked, because a quotation of a pointer is not a publication', () => {
    const dir = corpus({
      'ADR-900.md': [
        '## ADR-900: a worked example, off `deadbeef`',
        '',
        'The example a reader should not read as a citation:',
        '',
        '```',
        'packages/db/src/scoped-db.ts:4480',
        '```',
      ].join('\n'),
    });
    expect(derive(dir)[0]?.sites).toBe(0);
  });

  test('an inline code span is NOT masked, which is the whole difference from the register', () => {
    // `price-register.mjs` blanks backticked spans because its idiom is written
    // in prose. Nearly every pointer this corpus publishes is written inside
    // backticks, so the same mask here would harvest almost nothing.
    expect(maskedLines('a `packages/x/y.ts:9` b')[0]).toBe('a `packages/x/y.ts:9` b');
    expect(sitesIn('a `packages/x/y.ts:9` b')).toHaveLength(1);
  });

  test('the same site written twice in one entry counts once', () => {
    const dir = corpus({
      'ADR-900.md': [
        '## ADR-900: a repetition, off `deadbeef`',
        '',
        '`packages/x/y.ts:9` and again `packages/x/y.ts:9` and once more at',
        '[`y.ts:9`](../../packages/x/y.ts).',
      ].join('\n'),
    });
    expect(derive(dir)[0]?.sites).toBe(1);
  });
});

describe('the adjacency test: which token counts as a named base', () => {
  test.each(NAMING)('a commit-shaped token behind `%s` is a base', (word) => {
    expect(baseNamedIn(`branch \`claude/x\` ${word} \`fa413d9f\`, session 1`)).toBe('fa413d9f');
  });

  test('an all-digit token behind a naming word is a base, because SHAs are sometimes all digits', () => {
    // `69662904` and `74381018` are real bases three entries and one entry name.
    // A rule demanding a letter would have refused both.
    expect(baseNamedIn('off `claude/wave-435s` at `69662904`, session 633')).toBe('69662904');
  });

  test('a commit-shaped token behind no naming word is not a base', () => {
    expect(baseNamedIn('the hash `fa413d9f` appears in the fixture')).toBeNull();
  });

  test('a cardinal that happens to be commit-shaped is not a base', () => {
    // The `bigint` ceiling. This is the case the adjacency test exists for and
    // it is a shape rather than a site: the number is written out, not read
    // from the entry that carries it.
    expect(baseNamedIn('the threshold naming 9223372036854775807 as its ceiling')).toBeNull();
  });

  test('a token behind a word that names another commit is not this entry`s base', () => {
    expect(baseNamedIn('every commit since 96ed60c has carried it')).toBeNull();
  });

  test('only the opening lines are read', () => {
    const dir = corpus({
      'ADR-900.md': [
        '## ADR-900: a late base',
        '',
        'It publishes `packages/x/y.ts:9`.',
        '',
        '',
        '',
        'The base was at `deadbeef` and this line is past the opening.',
      ].join('\n'),
    });
    const [only] = derive(dir);
    expect(only?.sites).toBe(1);
    expect(only?.base).toBeNull();
    expect(OPENING_LINES).toBe(6);
  });
});

describe('leg A, which throws because every other leg reports an absence', () => {
  test('an empty corpus is an error and not a pass', () => {
    expect(() => {
      legDerivationIsReal([]);
    }).toThrow(/no numbered entry/);
  });

  test('a harvest that finds no published site at all is an error', () => {
    expect(() => {
      legDerivationIsReal([entry(500, 0, 'deadbeef'), entry(100, 0, null)]);
    }).toThrow(/no entry publishes a source file:line/);
  });

  test('an empty FORWARD population is an error, because that is the vacuous pass', () => {
    expect(() => {
      legDerivationIsReal([entry(CUTOFF - 1, 1, null)]);
    }).toThrow(/empty population and passes by seeing nothing/);
  });

  test('an empty GRANDFATHERED population is an error, because the pin is what catches a break', () => {
    expect(() => {
      legDerivationIsReal([entry(CUTOFF, 1, 'deadbeef')]);
    }).toThrow(/cannot catch an emptied harvest/);
  });

  test('a population with both halves is not an error', () => {
    expect(() => {
      legDerivationIsReal(compliant());
    }).not.toThrow();
  });
});

describe('leg B, the forward assertion and the only leg a future entry can break', () => {
  test('an entry at the cutoff that publishes and names no tree is a finding', () => {
    const findings = legForwardNamesItsTree([...compliant(), entry(CUTOFF, 4, null)]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('names no base commit');
  });

  test('the finding names the words that would discharge it', () => {
    const [finding] = legForwardNamesItsTree([entry(CUTOFF + 90, 2, null)]);
    for (const word of NAMING) expect(finding).toContain(`\`${word}\``);
  });

  test('the same entry below the cutoff is not a finding, and that is the whole ruling', () => {
    expect(legForwardNamesItsTree([entry(CUTOFF - 1, 4, null)])).toHaveLength(0);
  });

  test('an entry above the cutoff that publishes nothing is not a finding', () => {
    expect(legForwardNamesItsTree([entry(CUTOFF + 90, 0, null)])).toHaveLength(0);
  });

  test('it does not fire on a compliant population', () => {
    expect(legForwardNamesItsTree(compliant())).toHaveLength(0);
  });

  test('it fires once per entry and not once per site', () => {
    expect(
      legForwardNamesItsTree([entry(CUTOFF + 1, 40, null), entry(CUTOFF + 2, 1, null)]),
    ).toHaveLength(2);
  });
});

describe('leg C, the pin that makes an emptied harvest red instead of green', () => {
  test('a harvest that lost the grandfathered population is a finding and not a pass', () => {
    const findings = legGrandfatheredIsPinned([entry(CUTOFF + 1, 1, 'deadbeef')]);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toContain('It moved because the harvest changed');
  });

  test('one entry more below the cutoff moves the pin', () => {
    const findings = legGrandfatheredIsPinned([...compliant(), entry(1, 1, 'deadbeef')]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain(String(GRANDFATHERED.publishing + 1));
  });

  test('one entry fewer naming no base moves the other half of the pin', () => {
    const rows = compliant();
    const unnamed = rows.find((row) => row.number < CUTOFF && row.base === null);
    expect(unnamed).toBeDefined();
    if (unnamed !== undefined) unnamed.base = 'deadbeef';
    const findings = legGrandfatheredIsPinned(rows);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain(String(GRANDFATHERED.unnamed - 1));
  });

  test('it does not fire on a population built to the pin', () => {
    expect(legGrandfatheredIsPinned(compliant())).toHaveLength(0);
  });
});

describe('leg D, so the cutoff cannot be raised to walk away from a finding', () => {
  test('a tree whose entry below the cutoff names a base is a finding', () => {
    const rows = compliant().map((row) =>
      row.number === CUTOFF - 1 ? { ...row, base: 'deadbeef' } : row,
    );
    expect(legCutoffIsTightest(rows)).toHaveLength(1);
  });

  test('a tree with no entry immediately below the cutoff is a finding', () => {
    expect(legCutoffIsTightest([entry(CUTOFF, 1, 'deadbeef')])).toHaveLength(1);
  });

  test('it does not fire while the entry below the cutoff still publishes and names nothing', () => {
    expect(legCutoffIsTightest(compliant())).toHaveLength(0);
  });
});

describe('run, over a fabricated corpus', () => {
  test('a corpus with both halves and no violation is a pass', () => {
    // `run` reads the real tree by design, so the fabricated pass is asserted
    // through the legs it composes rather than through `run` itself.
    const rows = compliant();
    expect([
      ...legForwardNamesItsTree(rows),
      ...legGrandfatheredIsPinned(rows),
      ...legCutoffIsTightest(rows),
    ]).toEqual([]);
  });

  test('an argument is refused, because every input is derived from the tree', () => {
    expect(run(['--at', 'HEAD'])).toBe(2);
  });

  test('publishing is the population and it is the entries with a site', () => {
    expect(publishing([entry(1, 0, null), entry(2, 1, null)]).map((row) => row.number)).toEqual([
      2,
    ]);
  });
});

describe('the real corpus', () => {
  test(
    'every entry at or above the cutoff that publishes a source site names its tree',
    () => {
      const entries = derive();
      legDerivationIsReal(entries);
      expect(legForwardNamesItsTree(entries)).toEqual([]);
      expect(legGrandfatheredIsPinned(entries)).toEqual([]);
      expect(legCutoffIsTightest(entries)).toEqual([]);
      // NOT VACUOUS, ASSERTED RATHER THAN ASSUMED. The three legs above are all
      // absences, and an absence over an empty population is silence.
      const publishers = publishing(entries);
      expect(publishers.filter((row) => row.number >= CUTOFF).length).toBeGreaterThan(0);
      expect(publishers.filter((row) => row.number < CUTOFF)).toHaveLength(
        GRANDFATHERED.publishing,
      );
    },
    CORPUS_SCAN_MS,
  );

  test(
    'the check passes on the tree it ships with',
    () => {
      expect(run()).toBe(0);
    },
    CORPUS_SCAN_MS,
  );
});
