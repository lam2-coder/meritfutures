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

/**
 * The file the naive idiom mangles most, among those carrying a PHANTOM span.
 *
 * DERIVED RATHER THAN NAMED, and the reason is this file's own subject one level
 * up: the two cases below named `apps/worker/src/index.ts`, and they turned red
 * when ADR-327 removed one glob from one prose sentence in it. A hand-named
 * subject for a property about the whole tree is the same defect as a
 * hand-maintained count, and it fails the same way, which is silently until
 * somebody edits a comment.
 *
 * A PHANTOM SPAN IS THE SUBJECT AND A REAL BLOCK COMMENT IS NOT. The first
 * `/*`..`*\/` match in a file is usually a JSDoc, which BOTH the idiom and the
 * scanner remove correctly and which therefore proves nothing. The span this
 * suite is about is the one whose OPENER sits inside a `//` line comment, so the
 * search skips matches until it finds one.
 *
 * "Mangles most" is the characters the SCANNER keeps and the IDIOM deletes,
 * because that is exactly the quantity an absence check over the idiom's output
 * cannot see. An empty walk THROWS rather than returning a winner.
 */
function phantomSpan(source: string): RegExpExecArray | null {
  const spans = /\/\*[\s\S]*?\*\//g;
  let match = spans.exec(source);
  while (match !== null) {
    const lineStart = source.lastIndexOf('\n', match.index) + 1;
    if (source.slice(lineStart, match.index).includes('//')) return match;
    match = spans.exec(source);
  }
  return null;
}

function sourceTree(): readonly string[] {
  const files = [
    ...sourceFilesUnder(join(REPO_ROOT, 'apps')),
    ...sourceFilesUnder(join(REPO_ROOT, 'packages')),
  ];
  if (files.length < 100) {
    throw new Error(
      `the source walk found ${files.length} file(s); this suite compares an idiom against a ` +
        'scanner over the real tree, and an empty walk would report PASS in silence',
    );
  }
  return files;
}

function worstVictim(): { readonly path: string; readonly source: string; readonly eaten: number } {
  let best: { path: string; source: string; eaten: number } | undefined;
  for (const path of sourceTree()) {
    const source = readFileSync(path, 'utf8');
    if (phantomSpan(source) === null) continue;
    const eaten = stripComments(source).length - naive(source).length;
    if (best === undefined || eaten > best.eaten) best = { path, source, eaten };
  }
  if (best === undefined) {
    throw new Error(
      'no file in the tree carries a block-comment opener inside a line comment. That is the ' +
        'whole subject of this suite, so its absence is a finding rather than a pass',
    );
  }
  return best;
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

  test('the idiom silently deletes source the scanner keeps, over the whole tree', () => {
    // **THIS CASE AND THE ONE BELOW NAMED `apps/worker/src/index.ts` UNTIL
    // ADR-327, AND WHAT HAPPENED TO THEM IS THIS SUITE'S OWN SUBJECT.** The
    // barrel's phantom span opened on the `/**` inside a single prose glob, in a
    // sentence saying the `pgboss` grant was owed. `0082` discharged that
    // blocker, ADR-327 retired the sentence, the opener went with it, and two
    // cases about an IDIOM turned red on a comment edit in another package.
    //
    // ADR-279 section 2 reported 55,728 characters to 2,753 on that one file.
    // The number was never the property and the FILE was never the property
    // either: what matters is that the idiom removes source across the tree and
    // that every absence check reading its output is asking a question of a file
    // with the declarations taken out. So both halves are derived here.
    let total = 0;
    let losing = 0;
    for (const path of sourceTree()) {
      const source = readFileSync(path, 'utf8');
      const eaten = stripComments(source).length - naive(source).length;
      if (eaten > 0) {
        total += eaten;
        losing += 1;
      }
    }
    expect(losing).toBeGreaterThan(200);
    expect(total).toBeGreaterThan(50_000);

    // And it is concentrated rather than spread thin: one file loses more than
    // ten thousand characters on its own.
    const { path, eaten } = worstVictim();
    expect(eaten, `${path} is the worst case and the idiom barely touches it`).toBeGreaterThan(
      10_000,
    );
  });

  test('a local clock read placed inside the phantom span survives the scanner', () => {
    // SEED 12, AS ADR-277 SECTION 7 LEFT IT AND ADR-279 SECTION 2 WATCHED IT ON
    // THE REAL TREE: under the idiom `RI-28` reported PASS with this line live in
    // a shipped source file. The span is now derived along with the file, so the
    // seed lands inside it by construction rather than by somebody having checked
    // once that a chosen line number was still inside it.
    const { path, source } = worstVictim();
    const span = phantomSpan(source);
    expect(span, `${path} carries no phantom block for the idiom to open`).not.toBeNull();

    // The end of the line the OPENER sits on, which is inside the span and is a
    // line boundary, so the seeded declaration lands as its own statement.
    const at = source.indexOf('\n', span?.index ?? 0);
    expect(at, 'the phantom span holds no line boundary to seed at').toBeGreaterThan(-1);
    expect(at).toBeLessThan((span?.index ?? 0) + (span?.[0].length ?? 0));

    // THE SENTINEL IS UNIQUE AND `getHours` IS NOT. The derived victim is
    // whatever file the idiom mangles most, and one candidate carries the string
    // `getHours` in its own fixtures, which would have made this case pass for a
    // reason that has nothing to do with the seed.
    const seeded = `${source.slice(0, at)}\nexport const SEEDED_PHANTOM_CLOCK = new Date().getHours();${source.slice(at)}`;
    expect(seeded).not.toBe(source);

    expect(naive(seeded)).not.toContain('SEEDED_PHANTOM_CLOCK');
    expect(stripComments(seeded)).toContain('SEEDED_PHANTOM_CLOCK = new Date().getHours()');
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
