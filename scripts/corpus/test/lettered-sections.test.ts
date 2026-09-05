import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { letteredSections } from '../gates.mjs';

// =============================================================================
// ADR-339. The lettered sequence of the delta manifest, derived rather than typed.
// =============================================================================
// `## 4c.` HEADS FOUR SECTIONS, and until this span the only record of that was
// a sentence that said it headed one. The numeric half of the manifest's section
// 16 is an allocation table with a row per claim; the lettered half takes no row
// at all, by that table's own written rule, so its whole register was prose.
//
// THESE CASES PIN A RULING AND NOT ONLY A PARSER. The ruling is that the
// manifest's tolerance of a recorded collision EXTENDS to the letters, so the
// register counts and never objects. `tolerates a fifth 4c` is the case that
// says so, and it is the one that would go red if somebody later decided the
// letters should be unique after all. A green suite over a register that had
// quietly started refusing a collision would look exactly like this one.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MANIFEST = join(ROOT, 'packages/db/DELTA_MANIFEST.md');

/** A manifest body carrying the shape the reader is specified over. */
const seed = (lines: string[]): string =>
  ['---', 'status: approved', '---', '', ...lines].join('\n');

/** The data rows of a rendered register, without its header and delimiter. */
const rowsOf = (table: string): string[] =>
  table
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .map((line) => line.trim());

describe('the lettered register is derived from the manifest, not typed beside it', () => {
  // THE LIVE FILE, AND THE FOUR-WAY COLLISION IS PINNED BY A CASE RATHER THAN BY
  // A SENTENCE. That is the whole subject: the sentence said `4c` recorded one
  // fold, it records four, and nothing could tell the difference.
  test('reads the live manifest and records `4c` four times', () => {
    const rows = rowsOf(letteredSections(readFileSync(MANIFEST, 'utf8')));

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatch(/^\| `4a` \| 1 \|/);
    expect(rows[1]).toMatch(/^\| `4b` \| 1 \|/);
    expect(rows[2]).toMatch(/^\| `4c` \| 4 \|/);
  });

  // THE TOLERANCE, EXECUTED RATHER THAN ASSERTED. Section 16 rules that a
  // collision "is left in place and the table allocates forward", because
  // renumbering breaks every citation of whichever one moves. A register that
  // refused a repeated key would be red on landing over a state this document
  // ruled correct, which is what ADR-337 section 8.2 found when it read the
  // uniqueness gate the numeric half had specified and could not write.
  test('tolerates a fifth `4c`: it counts the collision and does not object', () => {
    const table = letteredSections(
      seed([
        '## 4a. FOLD-01: the first',
        '## 4c. FOLD-05: the third',
        '## 4c. FOLD-03: the fourth',
        '## 4c. FOLD-04: the fifth',
        '## 4c. FOLD-04: the sixth',
        '## 4c. a fifth section on one key',
      ]),
    );

    expect(rowsOf(table)).toEqual([
      '| `4a` | 1 | FOLD-01: the first |',
      '| `4c` | 5 | FOLD-05: the third; FOLD-03: the fourth; FOLD-04: the fifth; FOLD-04: the sixth; a fifth section on one key |',
    ]);
  });

  // THE DRIFT THIS EXISTS TO END. A letter appended to the file moves the
  // register, so `CI-06g` reports the span stale until `generate` runs. Before
  // this span the same event moved nothing at all and the sentence beside it
  // stayed wrong for sixteen days.
  test('a new letter appears in the register, so the span goes stale when one lands', () => {
    const before = letteredSections(seed(['## 4a. the first', '## 4c. the second']));
    const after = letteredSections(
      seed(['## 4a. the first', '## 4c. the second', '## 4d. the next fold']),
    );

    expect(before).not.toBe(after);
    expect(rowsOf(after)).toHaveLength(3);
    expect(rowsOf(after)[2]).toBe('| `4d` | 1 | the next fold |');
  });

  // THE ORDER IS THE NUMERIC PARENT AND THEN THE LETTER, NOT THE STRING. A
  // lexicographic sort puts `12a` before `4c`, which reads as a sequence that
  // ran backwards. No second parent exists in the file today, so this is the
  // case that keeps the reader correct for the first one that does.
  test('sorts by numeric parent before letter, so `12a` follows `4c`', () => {
    const rows = rowsOf(
      letteredSections(seed(['## 12a. later', '## 4c. earlier', '## 4a. earliest'])),
    );

    expect(rows.map((row) => /^\| `([^`]+)`/.exec(row)?.[1])).toEqual(['4a', '4c', '12a']);
  });

  // WHAT IS NOT A LETTERED SECTION. Each of these was checked against the live
  // file rather than invented: `## 16.` is the allocation table's own heading,
  // `### ` opens every sub-heading in it, and `## 4a` with no dot is not the
  // form any heading in the file uses.
  test('reads only `## <n><letter>.` headings, at depth two, with the dot', () => {
    const rows = rowsOf(
      letteredSections(
        seed([
          '## 4a. counted',
          '## 16. Allocation: a numbered section is not this reader s',
          '### 4b. a sub-heading is not a section',
          '#### 4b. nor is a deeper one',
          '## 4b a heading with no dot',
          'a paragraph mentioning ## 4b. is not a heading',
        ]),
      ),
    );

    expect(rows).toEqual(['| `4a` | 1 | counted |']);
  });

  // A FENCED BLOCK IS A QUOTED TRANSCRIPT. This file's sections are made of
  // runner transcripts, and a register poisoned by a quotation regenerates
  // quietly. It changes nothing on the live tree, which is measured in the
  // reader's own comment and is why the case is here rather than the claim.
  test('a heading inside a fenced block is a quotation and is not counted', () => {
    const rows = rowsOf(
      letteredSections(
        seed(['## 4a. counted', '```', 'FAIL RI-37', '## 4d. quoted, not taken', '```']),
      ),
    );

    expect(rows).toEqual(['| `4a` | 1 | counted |']);
  });

  // RULE 1 AND NOT RULE 2, on RI-37's sentinel idiom and `adr_registry`'s. An
  // empty register regenerating quietly over a file that carries six lettered
  // sections is the loud-and-wrong direction: it would erase the collision the
  // register exists to record and CI-06g would pass on the erasure.
  test('throws rather than regenerating an empty register', () => {
    expect(() => letteredSections(seed(['## 16. Allocation', '### Section numbers']))).toThrow(
      /no `## <n><letter>\.` heading in packages\/db\/DELTA_MANIFEST\.md/,
    );
  });

  // THE LAYOUT IS LOAD BEARING AND IT IS ADR-088's FINDING, quoted in
  // `generate`'s own comment: a table span whose body does not open and close
  // with a newline welds its first row to the opener comment, detaches the rows
  // from their delimiter, and `CI-06v` reports the whole table as an orphan.
  test('opens and closes with a newline, so the rows sit under their delimiter', () => {
    const table = letteredSections(seed(['## 4a. the first']));

    expect(table.startsWith('\n')).toBe(true);
    expect(table.endsWith('\n')).toBe(true);
    expect(table.split('\n')[2]).toBe('|---|---|---|');
  });
});
