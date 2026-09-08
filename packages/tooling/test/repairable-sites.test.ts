import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  ELIGIBLE,
  REPO_ROOT,
  READABLE,
  VERDICTS,
  classify,
  classifyLine,
  classifySite,
  classifySource,
  parseSite,
  run,
  summarise,
} from '../checks/repairable-sites.mjs';

// =============================================================================
// THE ELIGIBILITY INSTRUMENT, AND THE SEVEN SITES THAT PAID FOR IT
// =============================================================================
// ADR-473. `ADR-469` section 10 item 1 published thirteen `file:line` sites as
// owed. Seven of them are string literals: five the bodies of files a case
// writes into a temporary tree, and two the finding text an `expect` asserts.
// No repair may touch any of the seven, and row 471 spent most of a session's
// framing discovering that one site at a time.
//
// EVERY CASE BELOW IS WRITTEN AS A SHAPE RATHER THAN AS A SITE, and that is
// deliberate. A case pinned to `repo-invariants.test.ts:2271` would be a case
// carrying the exact defect this file exists to classify: a line index in
// another file, going stale in somebody else's diff. The shapes are reproduced
// from the seven and from the six, and no case names a line of a file it does
// not own except through a value read at run time.
//
// NOTHING HERE WALKS A DIRECTORY. Two cases read ONE NAMED FILE, which is a
// read whose cost is that file and not this repository, so no case carries the
// `CORPUS_SCAN_MS` budget and none should.
// =============================================================================

/** A string literal holding a comment, which is what five of the seven are. */
const SEED_BODY = [
  'const FILE = [',
  "  '// (`detectors/fills.ts:505`, `:810`, `:1059`).\\n',",
  '].join();',
].join('\n');

/** A comment carrying a pointer, which is what six of the thirteen are. */
const COMMENT_BODY = [
  'const x = 1;',
  '// `:1307` and `:911` are both `},`, the close of some other entry.',
  'export default x;',
].join('\n');

describe('parseSite reads the shapes a decision entry actually writes', () => {
  test('a bare path:line, and the punctuation a pasted list drags with it', () => {
    expect(parseSite('packages/a/b.ts:151')).toEqual({ path: 'packages/a/b.ts', line: 151 });
    expect(parseSite('`packages/a/b.ts:151`')).toEqual({ path: 'packages/a/b.ts', line: 151 });
    expect(parseSite('packages/a/b.ts:151,')).toEqual({ path: 'packages/a/b.ts', line: 151 });
    expect(parseSite('[packages/a/b.ts#L151]')).toEqual({ path: 'packages/a/b.ts', line: 151 });
  });

  // A TRAILING COMMA IS NOT A DETAIL. `ADR-469` missed its own fourteenth site
  // because `line 525,` fell outside its forms on the comma alone, and a list
  // pasted out of a rendered entry carries commas on every member but the last.
  test('a trailing comma does not lose a site, which is how ADR-469 lost one', () => {
    const list = 'packages/a/b.ts:1, packages/a/b.ts:2, packages/a/b.ts:3'.split(/,\s*/);
    expect(list.map((t) => parseSite(t)?.line)).toEqual([1, 2, 3]);
  });

  test('a token with no line is not a site', () => {
    expect(parseSite('packages/a/b.ts')).toBeNull();
    expect(parseSite('a prose sentence')).toBeNull();
    expect(parseSite('packages/a/b.ts:0')).toBeNull();
  });
});

describe('the verdict is what the line IS, not what the line says', () => {
  test('FIRING: a pointer inside a string literal is CODE and no repair may touch it', () => {
    const { verdict } = classifyLine(SEED_BODY, 2);
    expect(verdict).toBe('CODE');
    expect(verdict).not.toBe(ELIGIBLE);
  });

  test('NOT OVER-FIRING: the same pointer in a comment is COMMENT and a repair may', () => {
    expect(classifyLine(COMMENT_BODY, 2).verdict).toBe(ELIGIBLE);
  });

  test('a line of a block comment is COMMENT, newlines being preserved', () => {
    const body = ['const x = 1;', '/*', ' * see `:99` in the reader.', ' */', 'export default x;'];
    expect(classifyLine(body.join('\n'), 3).verdict).toBe(ELIGIBLE);
    expect(classifyLine(body.join('\n'), 1).verdict).toBe('CODE');
  });

  // MIXED IS NOT ELIGIBLE AND THAT IS THE CONSERVATIVE CHOICE. The pointer may
  // be on either half of the line, and a list of `file:line` does not carry the
  // pointer text that would say which. Handing it back for adjudication is the
  // only answer that cannot authorise a repair into code.
  test('code with a comment after it is MIXED, and MIXED is not eligible', () => {
    const result = classifyLine("const p = 'x'; // see `:12`", 1);
    expect(result.verdict).toBe('MIXED');
    expect(result.verdict).not.toBe(ELIGIBLE);
  });

  test('an index with nothing on it is BLANK and one past the end is RANGE', () => {
    expect(classifyLine('const x = 1;\n\nexport default x;', 2).verdict).toBe('BLANK');
    expect(classifyLine('const x = 1;', 900).verdict).toBe('RANGE');
  });

  // THE `//` THAT IS NOT A COMMENT. `strip-comments.mjs`'s whole subject is that
  // the two-replacement idiom cannot tell a comment opener inside a literal from
  // a comment. An instrument built on the idiom would call the seed a comment
  // and wave a repair straight into a test's input.
  test('a comment opener inside a literal does not make the line a comment', () => {
    expect(classifyLine("const s = 'http://example.test/`:5`';", 1).verdict).toBe('CODE');
  });
});

describe('the reader has no opinion about a file it cannot read', () => {
  test('a site in a document is OPAQUE: not eligible, not ineligible', () => {
    const ruling = classifySite({ path: 'docs/decisions/ADR-469.md', line: 126 });
    expect(ruling.verdict).toBe('OPAQUE');
    expect(ruling.verdict).not.toBe(ELIGIBLE);
  });

  // AN ABSENCE CHECK OVER A FILE IT CANNOT PARSE REPORTS PASS IN SILENCE, which
  // is `ADR-274`'s warned class and the defect `strip-comments.mjs` was written
  // to end. `OPAQUE` is counted apart from both verdicts for that reason, and
  // this case is the one that stops a later reader folding it into either.
  test('OPAQUE is counted as UNCLASSIFIED and never as a repairable site', () => {
    const result = classify(['docs/x.md:1', 'packages/db/migrations/0001_x.sql:2']);
    expect(result.unclassified).toBe(2);
    expect(result.eligible).toBe(0);
    expect(result.ineligible).toBe(0);
    expect(summarise(result)).toContain('2 UNCLASSIFIED');
  });

  test('every extension this instrument claims to read is one stripComments models', () => {
    for (const ext of ['ts', 'tsx', 'mts', 'cts', 'mjs', 'cjs', 'js', 'jsx'])
      expect(READABLE.test(`a/b.${ext}`)).toBe(true);
    for (const ext of ['md', 'sql', 'yml', 'json']) expect(READABLE.test(`a/b.${ext}`)).toBe(false);
  });
});

describe('a published list is a claim about a file at an instant', () => {
  // NO SHA IS PINNED HERE ON PURPOSE. The property is that the SAME index over
  // two readings of one path gives two verdicts, and a case that named a commit
  // to prove it would be writing the defect it is about. The two readings are
  // injected, which is also how `--at <ref>` reaches the same code path.
  test('one index, two trees, two verdicts, and only the earlier one is the claim', () => {
    const site = { path: 'packages/a/b.ts', line: 2 };
    const asPublished = classifySite(site, { read: () => COMMENT_BODY });
    const asItStandsNow = classifySite(site, { read: () => SEED_BODY });
    expect(asPublished.verdict).toBe(ELIGIBLE);
    expect(asItStandsNow.verdict).toBe('CODE');
  });

  test('a path the reading cannot produce is ABSENT rather than eligible', () => {
    expect(
      classifySite({ path: 'packages/a/gone.ts', line: 1 }, { read: () => null }).verdict,
    ).toBe('ABSENT');
  });
});

describe('the split, on the file whose fourteenth site started this', () => {
  // ONE NAMED FILE READ AND NO WALK, so this case carries no scan budget and
  // should not. The site is found by its TEXT rather than by an index, because
  // an index written here would go stale in the next diff to that file, which
  // is the whole subject of this suite.
  const SUBJECT = 'packages/tooling/test/absence-claims.test.ts';
  const NEEDLE = 'line 525,';

  test('the comment carrying `line 525,` is ELIGIBLE where it actually sits', () => {
    const source = readFileSync(join(REPO_ROOT, SUBJECT), 'utf8');
    const line = source.split('\n').findIndex((l) => l.includes(NEEDLE)) + 1;
    expect(line).toBeGreaterThan(0);
    expect(classifyLine(source, line).verdict).toBe(ELIGIBLE);
  });

  // AND AN INDEX ALONE CARRIES NO INFORMATION ABOUT ELIGIBILITY IN THIS FILE.
  // Both verdicts occur in it, so a published `file:line` into it is a coin
  // toss until somebody reads the line. NO INDEX AND NO PROPORTION IS PINNED
  // HERE: the counts are derived on the run, because a number typed into this
  // case would be the defect this suite exists to classify.
  test('both verdicts occur in the subject, so an index alone decides nothing', () => {
    const lines = readFileSync(join(REPO_ROOT, SUBJECT), 'utf8').split('\n');
    const source = lines.join('\n');
    const seen = new Set(classifySource(source).map((r) => r.verdict));
    expect(seen.has(ELIGIBLE)).toBe(true);
    expect(seen.has('CODE')).toBe(true);
  });

  test('the instrument reports a split rather than a list', () => {
    const result = classify([
      'packages/tooling/checks/strip-comments.mjs:1',
      'docs/decisions/ADR-473.md:1',
    ]);
    expect(result.rulings).toHaveLength(2);
    expect(summarise(result)).toMatch(/ELIGIBLE.*INELIGIBLE.*UNCLASSIFIED/);
  });
});

describe('the CLI says what it found and refuses to guess', () => {
  test('no argument prints the usage and exits 2 rather than passing on an empty set', () => {
    const lines: string[] = [];
    expect(run([], (l) => lines.push(l))).toBe(2);
    expect(lines.join('\n')).toContain('WHEN A REPAIR LIST IS COMPILED');
  });

  test('an unparsable token is reported and changes the exit code', () => {
    const lines: string[] = [];
    expect(
      run(['packages/tooling/checks/strip-comments.mjs:1', 'not-a-site'], (l) => lines.push(l)),
    ).toBe(1);
    expect(lines.join('\n')).toContain('UNPARSED');
  });

  test('--at with no ref is an error and not a silent worktree read', () => {
    const lines: string[] = [];
    expect(run(['--at'], (l) => lines.push(l))).toBe(2);
    expect(lines.join('\n')).toContain('--at needs a ref');
  });

  test('the verdict vocabulary is closed and every member is reachable', () => {
    expect(new Set(VERDICTS).size).toBe(VERDICTS.length);
    expect(VERDICTS).toContain(ELIGIBLE);
    const reached = new Set([
      classifyLine(COMMENT_BODY, 2).verdict,
      classifyLine(SEED_BODY, 2).verdict,
      classifyLine("const p = 'x'; // c", 1).verdict,
      classifyLine('a\n\nb', 2).verdict,
      classifyLine('a', 9).verdict,
      classifySite({ path: 'a/b.ts', line: 1 }, { read: () => null }).verdict,
      classifySite({ path: 'a/b.md', line: 1 }).verdict,
    ]);
    expect([...reached].sort()).toEqual([...VERDICTS].sort());
  });
});
