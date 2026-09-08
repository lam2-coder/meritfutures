import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  WORD_WINDOW,
  census,
  commentBody,
  correctionFramed,
  grammarOf,
  main,
  units,
} from '../checks/absence-grammar-census.mjs';
import { CORPUS_SCAN_MS } from './scan-budget.js';

// =============================================================================
// AN INSTRUMENT THAT COUNTS THE SENTENCES SAYING NOTHING CHECKS SOMETHING
// =============================================================================
// ADR-442. Every case below SEEDS a sentence into a tree built for that case and
// requires the census to name it, or seeds one that must NOT be named and
// requires the census to leave it alone. The seeds are the only thing standing
// between this module and the failure the three entries behind it all suffered:
// a search that quietly reaches a shorter list and reports the same confidence.
//
// **THE SYNTHETIC TREES ARE THE POINT AND NOT A CONVENIENCE**, on
// `dependants.test.ts`'s own reasoning one file over: a census that could only
// be exercised against the live repository would pin a live cardinal, and a
// pinned live cardinal is the thing ADR-383 section 8 rules against and the
// thing this instrument exists to stop three more rows from typing.
//
// **NO CASE HERE ASSERTS A FIGURE OVER THE REAL TREE.** The one case that runs
// against the repository asserts a SHAPE -- that the two grammars nest and that
// the floor is not empty -- because a number asserted here would go red on the
// day somebody writes an honest sentence, which is the gate this instrument
// refuses to be.
// =============================================================================

/** A tree built for one case, with the files that case needs and nothing else. */
function treeWith(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'absence-grammar-'));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body, 'utf8');
  }
  return root;
}

const at = (root: string, rel: string) => census(root).sites.filter((site) => site.file === rel);

describe('the grammar, sentence by sentence', () => {
  test('a negated checking noun with a verification verb is NARROW', () => {
    expect(grammarOf('No gate in this repository compares the two.')).toBe('machinery');
    expect(grammarOf('no check in this tree compares a column type against the DDL')).toBe(
      'machinery',
    );
  });

  test('a universal negative with a verification verb is WIDE and not NARROW', () => {
    expect(grammarOf('nothing in this tree compares a transcribed column TYPE')).toBe('universal');
    expect(grammarOf('The drift direction that costs is the one nobody watches.')).toBe(
      'universal',
    );
  });

  test('a negated adjective carries its own subject and verb', () => {
    expect(grammarOf('the choice rests on the same unenforced sentence twice')).toBe(
      'negated-adjective',
    );
  });

  test('a negated noun with NO verification verb near it is not a claim about coverage', () => {
    expect(grammarOf('There is no gate at the end of the corridor.')).toBeNull();
    expect(grammarOf('Nothing here throws.')).toBeNull();
  });

  test('`rule` and `case` are deliberately outside NARROW, because this corpus owns both words', () => {
    // A BUSINESS RULE AND A GOLDEN CASE ARE NOT CHECKING MACHINERY. Admitting
    // either noun would inflate the FLOOR with sentences about the domain, and a
    // floor that is not a floor is worse than a wider ceiling.
    expect(grammarOf('An unbroken holiday: no rule fires and no counter advances.')).toBeNull();
    expect(grammarOf('The `folded` arm, so no case reads through a union.')).toBeNull();
  });

  test('`control` IS inside NARROW, added by ADR-446 as the one extension that survived', () => {
    // FOUND BY A SECOND CENSUS WRITTEN BLIND TO THIS ONE. Unlike `rule` and
    // `case` above, this corpus uses `control` for a check and nothing else, and
    // ADR-446 section 5 adjudicated every sentence the addition reaches.
    expect(grammarOf('No control here detects a hedge whose other leg sits at another firm.')).toBe(
      'machinery',
    );
    expect(grammarOf('a discipline the corpus depends on and no control enforces')).toBe(
      'machinery',
    );
    expect(grammarOf('no control that reads one branch can see it')).toBe('machinery');
  });

  test('`control` obeys the same window and the same verb requirement as every other noun', () => {
    expect(grammarOf('There is no control at the end of the corridor.')).toBeNull();
  });

  describe('the three extensions ADR-446 REFUSED stay refused, each pinned by the case that refused it', () => {
    // A refusal nobody can re-run is an opinion. These are the sentences the
    // measurement turned on, so a later row re-proposing any of the three has to
    // delete a case that says why, rather than simply not know.

    test('`fail` is NOT a verification verb: this corpus fails tests, gates and runs', () => {
      expect(grammarOf('so nothing fails on it, and it is outside a fence')).toBeNull();
      expect(
        grammarOf('a vacated number reserves nothing and an early renumber fails the gate'),
      ).toBeNull();
    });

    test('`name` is NOT a verification verb, and it is worse than `fail` by an order of magnitude', () => {
      expect(
        grammarOf('collapsing it into that column is nothing like the named mistake'),
      ).toBeNull();
    });

    test('`not one <mechanism>` is a FENCE statement, which is the opposite of a defect report', () => {
      // This estate closes entries with these. They report what a diff did NOT
      // touch, are true by construction, and would be counted as coverage holes.
      expect(grammarOf('NOT ONE GATE WAS WEAKENED, NOT ONE TEST WAS SKIPPED.')).toBeNull();
      expect(grammarOf('six comments, in three files, and not one assertion changed')).toBeNull();
      expect(
        grammarOf('Two controls that happen to cover one route are not one control written twice.'),
      ).toBeNull();
    });
  });

  test('the verb has to be within the window, so a subject does not borrow a later clause', () => {
    const near = 'no gate compares them';
    const far = `no gate ${'x '.repeat(WORD_WINDOW + 4)}compares them`;
    expect(grammarOf(near)).toBe('machinery');
    expect(grammarOf(far)).toBeNull();
  });
});

describe('the sentence is the unit and the line is not', () => {
  test('a claim wrapped across two comment lines is ONE sentence and is found', () => {
    // THE CASE THIS MODULE EXISTS FOR. Neither line carries both halves, so a
    // line-oriented search reports nothing and reports it confidently.
    const root = treeWith({
      'src/a.ts': [
        '// ADR-112 foreclosure 4 records that nothing in this tree compares a',
        '// `schema.ts` column type against the DDL. So the type buys existence.',
        'export const a = 1;',
      ].join('\n'),
    });
    const found = at(root, 'src/a.ts');
    expect(found).toHaveLength(1);
    expect(found[0]?.grammar).toBe('universal');
    expect(found[0]?.sentence).toContain('column type against the DDL');
  });

  test('a full stop inside a backticked filename does not end a sentence', () => {
    // `schema.ts` SPLITS A CLAIM AT ITS OWN SUBJECT under a naive splitter, and
    // this corpus writes a filename inside prose in almost every claim it makes.
    const root = treeWith({
      'src/b.ts': '// no check in this tree compares a `schema.ts` column type to the DDL.\n',
    });
    const found = at(root, 'src/b.ts');
    expect(found).toHaveLength(1);
    expect(found[0]?.sentence).toBe(
      'no check in this tree compares a `schema.ts` column type to the DDL.',
    );
  });

  test('a run of comment lines is one unit and a break in it starts another', () => {
    const source = ['// first line', '// second line', 'const x = 1;', '// third line'].join('\n');
    expect(units('src/c.ts', source)).toEqual([
      { line: 1, text: 'first line second line' },
      { line: 4, text: 'third line' },
    ]);
  });

  test('a markdown paragraph is the unit, and a blank line ends it', () => {
    expect(units('docs/d.md', 'one\ntwo\n\nthree\n')).toEqual([
      { line: 1, text: 'one two' },
      { line: 4, text: 'three' },
    ]);
  });

  test('the long `"//key"` rulings this workspace writes into a manifest are read', () => {
    const root = treeWith({
      'package.json': '{\n  "//x": "No gate reads this key any more, and that is deliberate."\n}\n',
    });
    expect(at(root, 'package.json')).toHaveLength(1);
  });

  test('a marker is sliced off and never replaced, so every comment spelling reads the same', () => {
    expect(commentBody('// a')).toBe('a');
    expect(commentBody(' * a')).toBe('a');
    expect(commentBody('/** a')).toBe('a');
    expect(commentBody('-- a')).toBe('a');
    expect(commentBody('# a')).toBe('a');
    expect(commentBody('const a = 1;')).toBeNull();
  });
});

describe('a markdown table row is its own unit, so its citation resolves (ADR-446 section 6)', () => {
  test('two table rows are two units carrying their own line numbers', () => {
    const table = ['| a | nothing checks it |', '| b | no gate reads it |'].join('\n');
    const found = units('docs/x.md', table);
    expect(found).toHaveLength(2);
    expect(found[0]?.line).toBe(1);
    expect(found[1]?.line).toBe(2);
  });

  test('a subject in one row cannot borrow a verb from the next', () => {
    // BEFORE THIS BRANCH the whole table was one unit, so `nothing` on the first
    // row sat within the twelve-word window of `compares` on the second and the
    // pair was counted as one claim. ADR-446 section 6 measures the population
    // this removed.
    const table = ['| the count is nothing |', '| the gate compares them |'].join('\n');
    for (const unit of units('docs/x.md', table)) {
      expect(grammarOf(unit.text)).toBeNull();
    }
  });

  test('prose paragraphs are still paragraphs, so the split did not replace the old rule', () => {
    const prose = ['No gate', 'in this tree', 'compares the two.'].join('\n');
    const found = units('docs/x.md', prose);
    expect(found).toHaveLength(1);
    expect(grammarOf(found[0]?.text ?? '')).toBe('machinery');
  });

  test('a table sitting under a paragraph closes the paragraph rather than joining it', () => {
    const mixed = ['Some prose here.', '| nothing checks it |'].join('\n');
    const found = units('docs/x.md', mixed);
    expect(found).toHaveLength(2);
    expect(found[1]?.line).toBe(2);
  });
});

describe('a quotation of a claim is not a claim, and is reported rather than deducted', () => {
  test("`RI-14`'s repair idiom is recognised as a frame", () => {
    expect(
      correctionFramed('This read "no check compares them." `RI-14`: FALSE when written.'),
    ).toBe(true);
    expect(correctionFramed('no check in this tree compares them')).toBe(false);
  });

  test('a repaired site still counts as a SITE and is marked framed', () => {
    // COUNTING A REPAIR AS A NEW DEFECT IS THE MECHANISM RUNNING BACKWARDS, and
    // deducting it silently would let an unknown frame shrink the population
    // with nothing saying so. It is a bucket and never a subtraction.
    const root = treeWith({
      'src/e.ts': '// This read "no check in this tree compares a column." FALSE when written.\n',
    });
    const found = at(root, 'src/e.ts');
    expect(found).toHaveLength(1);
    expect(found[0]?.framed).toBe(true);
  });
});

describe('a dated record is history and is separated rather than dropped', () => {
  test('an ADR entry and a session log are marked dated; live source is not', () => {
    const claim = 'no gate in this tree compares them.\n';
    const root = treeWith({
      'docs/decisions/ADR-999.md': claim,
      'docs/sessions/2026-09-07-session-999.md': claim,
      'src/f.ts': `// ${claim}`,
    });
    const byFile = new Map(census(root).sites.map((site) => [site.file, site.dated]));
    expect(byFile.get('docs/decisions/ADR-999.md')).toBe(true);
    expect(byFile.get('docs/sessions/2026-09-07-session-999.md')).toBe(true);
    expect(byFile.get('src/f.ts')).toBe(false);
  });
});

describe('the report', () => {
  test('it prints two grammars, names the population method, and asserts no verdict', () => {
    const root = treeWith({
      'src/g.ts': '// no gate in this tree compares them.\n',
      'docs/h.md': 'nothing in this tree reads that table.\n',
    });
    const lines: string[] = [];
    expect(main([], (line) => lines.push(line), root)).toBe(0);
    const report = lines.join('\n');
    expect(report).toContain('directory walk');
    expect(report).toMatch(/NARROW.*FLOOR/s);
    expect(report).toMatch(/WIDE.*CEILING/s);
    expect(report).toContain('cannot tell a TRUE claim from a FALSE one');
  });

  test('`--list` names every site, and the plain report names none', () => {
    const root = treeWith({ 'src/i.ts': '// no gate in this tree compares them.\n' });
    const plain: string[] = [];
    const listed: string[] = [];
    main([], (line) => plain.push(line), root);
    main(['--list'], (line) => listed.push(line), root);
    expect(plain.join('\n')).not.toContain('src/i.ts');
    expect(listed.join('\n')).toContain('src/i.ts:1');
  });
});

describe('over the repository itself, the SHAPE and never a figure', () => {
  // A NUMBER ASSERTED HERE WOULD GO RED THE DAY SOMEBODY WRITES AN HONEST
  // SENTENCE, which is precisely the gate the module's header refuses to be. So
  // the assertions are the two properties a reader needs in order to trust
  // either figure: that the floor is not vacuous, and that it nests inside the
  // ceiling by construction rather than by coincidence.
  const REPO = join(dirname(new URL(import.meta.url).pathname), '../../..');

  test(
    'the floor is not empty, so neither grammar is reporting an empty scope',
    () => {
      expect(
        census(REPO).sites.filter((site) => site.grammar === 'machinery').length,
      ).toBeGreaterThan(0);
    },
    CORPUS_SCAN_MS,
  );

  test(
    'NARROW nests inside WIDE, so the interval is an interval',
    () => {
      const sites = census(REPO).sites;
      const narrow = sites.filter((site) => site.grammar === 'machinery');
      expect(sites.length).toBeGreaterThanOrEqual(narrow.length);
    },
    CORPUS_SCAN_MS,
  );

  test(
    'the claim this row was commissioned over is inside the population it derives',
    () => {
      // THE ONE SITE ASSERTED BY PATH, AND IT IS THIS ROW'S OWN SUBJECT. It is
      // named by SUBJECT and never by line, because the file is another row's this
      // wave and a line number here would be a pointer into a moving target.
      const sites = census(REPO).sites.filter(
        (site) => site.file === 'packages/db/src/scoped-db.ts' && /compares/i.test(site.sentence),
      );
      expect(sites.length).toBeGreaterThan(0);
    },
    CORPUS_SCAN_MS,
  );
});
