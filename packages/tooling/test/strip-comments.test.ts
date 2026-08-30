import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { REPO_ROOT } from '../checks/repo-invariants.mjs';
import { stripComments } from '../checks/strip-comments.mjs';

// =============================================================================
// THE ONE COMMENT STRIPPER, AND THE THREE DEFECTS IT EXISTS TO END
// =============================================================================
// ADR-279. Seven copies of a comment stripper stood in this tree, five of them
// the two-replacement idiom, and every case below is written as a comparison
// against that idiom rather than as an assertion about an output string,
// because the point is never "this returns X". The point is that the idiom
// returns something CATASTROPHICALLY smaller and every absence check over it
// goes vacuously green.
//
// The naive spelling is reproduced here VERBATIM, as the five sites wrote it.
// It is the only copy of it left in the repository and `RI-30` admits this file
// by name for that reason: a repair with no record of what it repaired is a
// repair the next session undoes.
// =============================================================================

/** The two-replacement idiom, exactly as `repo-invariants.mjs:647` wrote it until ADR-279. */
const naive = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const BARREL = 'apps/worker/src/index.ts';

/** Every JavaScript-family source file in the workspace, `node_modules` aside. */
function sourceFilesUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFilesUnder(full, out);
    else if (/\.(ts|tsx|mts|mjs|js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('a block-comment opener inside a line comment', () => {
  test('opens a phantom block for the naive idiom and does not for the scanner', () => {
    const source = [
      '// P3-l fences `src/provisioning/**`, this file and nothing else.',
      'export const KEPT = 1;',
      '// Nothing under `apps/*/src` writes it.',
      'export const SECOND = 2;',
    ].join('\n');

    // The phantom block runs from the glob in line 1 to the glob in line 3 and
    // takes the declaration between them with it.
    expect(naive(source)).not.toContain('KEPT');

    const code = stripComments(source);
    expect(code).toContain('export const KEPT = 1;');
    expect(code).toContain('export const SECOND = 2;');
    expect(code).not.toContain('P3-l');
  });

  test('the worker barrel is 2,753 characters to the idiom and is not to the scanner', () => {
    const source = readFileSync(join(REPO_ROOT, BARREL), 'utf8');

    // THE MEASUREMENT ADR-279 SECTION 2 REPORTS, ASSERTED RATHER THAN QUOTED.
    // The exact numbers are not pinned: this file grows every wave and a case
    // that pinned 55,728 would be red on the next prose edit for no reason.
    // The RATIO is the property, and it is not close.
    expect(source.length).toBeGreaterThan(50_000);
    expect(naive(source).length).toBeLessThan(source.length / 10);
    expect(stripComments(source).length).toBeGreaterThan(naive(source).length * 4);

    // The barrel's job is its export list, and that is what the idiom deletes.
    expect(naive(source)).not.toContain('PROVISIONING_OPERATIONS');
    expect(stripComments(source)).toContain('PROVISIONING_OPERATIONS');
  });

  test('a local clock read placed inside the phantom span survives the scanner', () => {
    const source = readFileSync(join(REPO_ROOT, BARREL), 'utf8');
    const seeded = source.replace(
      "export type { Transition, TransitionRefusal } from './provisioning/index.ts';",
      "export type { Transition, TransitionRefusal } from './provisioning/index.ts';\n" +
        'export const SEEDED = new Date().getHours();',
    );
    expect(seeded).not.toBe(source);

    // THIS IS SEED 12, AS ADR-277 SECTION 7 LEFT IT AND ADR-279 SECTION 2
    // WATCHED IT ON THE REAL TREE: under the idiom `RI-28` reported PASS with
    // this line live in a shipped source file.
    expect(naive(seeded)).not.toContain('getHours');
    expect(stripComments(seeded)).toContain('new Date().getHours()');
  });
});

describe('what the scanner keeps', () => {
  test('a `//` inside a string literal is not a comment', () => {
    const source = "const url = 'https://merit.example/v1'; const after = 1;";
    expect(stripComments(source)).toContain('https://merit.example/v1');
    expect(stripComments(source)).toContain('const after = 1;');
  });

  test('a `//` inside a block comment does not reopen anything', () => {
    const source = '/* a // b */ const kept = 1;';
    expect(stripComments(source)).toContain('const kept = 1;');
    expect(stripComments(source)).not.toContain('a // b');
  });

  test('newlines survive a block comment, so a `file:line` is the line', () => {
    const source = [
      'const first = 1;',
      '/*',
      ' * four',
      ' * lines',
      ' */',
      'const sixth = 6;',
    ].join('\n');
    const code = stripComments(source);
    expect(code.split('\n')).toHaveLength(6);
    expect(code.slice(0, code.indexOf('const sixth')).split('\n')).toHaveLength(6);

    // THE IDIOM COLLAPSES THE WHOLE BLOCK TO ONE SPACE, which is why `RI-28`
    // reported `apps/worker/src/index.ts:143` for a seed on line 1,124: three
    // of the six lines are gone and every line number after them is wrong.
    expect(naive(source).split('\n')).toHaveLength(3);
  });

  test('a nested template literal does not flip the state', () => {
    // THE ADR-277 SCANNER GOT THIS WRONG AND THE SHARED HOME DOES NOT.
    // `packages/rules-engine/src/external-gates.ts` carries the shape: a
    // template whose SUBSTITUTION opens a second template. That scanner closed
    // the outer literal on the inner backtick and read the rest of the file
    // with its states inverted, which left real docblocks unstripped.
    const source = [
      'const m = `a ${xs.map((x) => `<${x}>`).join()} b`;',
      '/* gone */ const n = 2;',
    ].join('\n');
    const code = stripComments(source);
    expect(code).toContain('const n = 2;');
    expect(code).not.toContain('gone');
  });
});

describe('literals: blank', () => {
  test('a spelling written inside a string is not a call', () => {
    const source = "const seed = 'return value.toLocaleString();';\nconst real = 1;";
    expect(stripComments(source)).toContain('toLocaleString');
    expect(stripComments(source, { literals: 'blank' })).not.toContain('toLocaleString');
    expect(stripComments(source, { literals: 'blank' })).toContain('const real = 1;');
  });

  test('a template SUBSTITUTION is code and survives blanking', () => {
    const source = 'const s = `hour ${at.getHours()} of ${day}`;';
    expect(stripComments(source, { literals: 'blank' })).toContain('at.getHours()');
    expect(stripComments(source, { literals: 'blank' })).not.toContain('hour');
  });

  test('the two modes agree on length and on every newline, over the whole tree', () => {
    // `RI-28` DEPENDS ON THIS AND NOT ON A COMMENT. It reads one file twice,
    // hunts three call spellings in the blanked text and the `process.env.TZ`
    // key in the text that still holds literals, and reports `file:line` from a
    // single `lineAt` over the blanked one. That is only true while an index
    // into one reading is the same index into the other.
    const files = sourceFilesUnder(REPO_ROOT);
    expect(files.length).toBeGreaterThan(500);
    const disagree = files.filter((file) => {
      const source = readFileSync(file, 'utf8');
      const keep = stripComments(source);
      const blank = stripComments(source, { literals: 'blank' });
      if (keep.length !== blank.length) return true;
      for (let i = 0; i < keep.length; i++) {
        if ((keep[i] === '\n') !== (blank[i] === '\n')) return true;
      }
      return false;
    });
    expect(disagree).toEqual([]);
  });

  test('quotes, length and newlines are preserved so every offset still maps', () => {
    const source = "const a = 'one\\ntwo';\nconst b = 2;";
    const blanked = stripComments(source, { literals: 'blank' });
    expect(blanked).toHaveLength(source.length);
    expect(blanked.split('\n')).toHaveLength(source.split('\n').length);
    expect(blanked).toContain("const a = '");
  });
});
