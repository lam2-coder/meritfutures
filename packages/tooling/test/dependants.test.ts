import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  BLIND,
  KINDS,
  closure,
  dependantsOf,
  foldDir,
  foldGlobList,
  foldRegExp,
  globToRegExp,
  isDatedRecord,
  literals,
  main,
  normalise,
  population,
  retentionOf,
  splitArgs,
  REPO_ROOT,
} from '../checks/dependants.mjs';

// =============================================================================
// AN INSTRUMENT THAT ANSWERS "WHAT DEPENDS ON THIS FILE?", AND THE THREE ROWS
// THAT ANSWERED IT SHORT
// =============================================================================
// ADR-422. Every case below SEEDS A DEPENDANT OF ONE KIND into a tree built for
// that case and requires the derivation to name it. The seeds are not examples:
// they are the only thing standing between this module and the failure it was
// built to end, which is a detector that quietly stops seeing a kind and reports
// a shorter list with the same confidence.
//
// **THE KINDS ARE NOT LISTED HERE.** `everySeededKindIsInTheRegister` reads them
// out of `KINDS` and requires each one to have been produced by a seed above it,
// so a kind added to that register with no detector behind it is RED, and a
// detector removed while its register entry stands is RED. A list typed twice is
// a list that disagrees with itself by the second edit.
//
// THE SYNTHETIC TREES ARE THE POINT AND NOT A CONVENIENCE. ADR-419 section 8
// withdrew a census because its artifact's cases build synthetic trees and the
// census accounted for repo-absolute paths, taxing every future fixture. This
// module takes `root` as an argument for exactly that reason: a tree built for
// one case is the ordinary way to use it, so no later fixture pays a tax for
// being synthetic.
// =============================================================================

/** A throwaway tree. `files` is repo-relative path to content. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'dependants-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, dirname(rel)), { recursive: true });
    writeFileSync(join(root, rel), body, 'utf8');
  }
  return root;
}

/** The files reported against `target` under `kind`, sorted. */
function found(root: string, target: string, kind: string): string[] {
  return dependantsOf(root, target)
    .sites.filter((s) => s.kind === kind)
    .map((s) => s.file)
    .sort();
}

/** Every kind any case below has actually seen the derivation produce. */
const witnessed = new Set<string>();

/** Record and return, so that the register case reads what the seeds proved. */
function witness(kind: string, files: string[]): string[] {
  if (files.length > 0) witnessed.add(kind);
  return files;
}

// -----------------------------------------------------------------------------

describe('the derivation refuses to answer rather than answer emptily', () => {
  test('a target outside the tree throws instead of returning no dependants', () => {
    const root = tree({ 'a.ts': 'export const a = 1;\n' });
    expect(() => dependantsOf(root, '../escape.ts')).toThrow(
      /outside the root|does not name a file/,
    );
  });

  test('an empty population throws, because nothing depends on anything there', () => {
    const root = mkdtempSync(join(tmpdir(), 'dependants-empty-'));
    expect(() => dependantsOf(root, 'a.ts')).toThrow(/population is EMPTY/);
  });

  test('a target that is not in the population is reported as absent rather than as unused', () => {
    const root = tree({ 'a.ts': 'export const a = 1;\n' });
    const report = dependantsOf(root, 'gone.ts');
    expect(report.exists).toBe(false);
    expect(report.population.files).toBeGreaterThan(0);
  });

  test('the population names the method it used, so a caller never has to assume one', () => {
    const walked = population(tree({ 'a.ts': '' }));
    expect(walked.method).toBe('directory walk');
    expect(population(REPO_ROOT).method).toBe('git ls-files');
  });
});

// -----------------------------------------------------------------------------
// KIND 1: THE MODULE GRAPH. ADR-414's whole definition.
// -----------------------------------------------------------------------------

describe('kind `import`: a specifier that resolves to the file', () => {
  test('a relative specifier is found even though it does not contain the target path', () => {
    const root = tree({
      'apps/lantern/src/producer.ts': 'export const EVENT_NAMES = [];\n',
      'apps/hand/test/replay.test.ts': "const m = await import('../../lantern/src/producer.ts');\n",
    });
    expect(witness('import', found(root, 'apps/lantern/src/producer.ts', 'import'))).toEqual([
      'apps/hand/test/replay.test.ts',
    ]);
    // THE POINT OF THIS KIND IN ONE ASSERTION: no text search for the target's
    // own path can reach that consumer, and ADR-418 recorded exactly this pair.
    expect(found(root, 'apps/lantern/src/producer.ts', 'path-literal')).toEqual([]);
  });

  test('a `.js` specifier resolves to the `.ts` file on disk, as this tree spells ESM', () => {
    const root = tree({
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': "import { a } from './a.js';\nexport const b = a;\n",
    });
    expect(found(root, 'src/a.ts', 'import')).toEqual(['src/b.ts']);
  });

  test('a workspace package name resolves to that package`s barrel', () => {
    const root = tree({
      'packages/lantern-ledger/package.json': '{"name":"@merit/lantern-ledger"}',
      'packages/lantern-ledger/src/index.ts': 'export const x = 1;\n',
      'apps/lantern/src/use.ts':
        "import { x } from '@merit/lantern-ledger';\nexport const y = x;\n",
    });
    expect(found(root, 'packages/lantern-ledger/src/index.ts', 'import')).toEqual([
      'apps/lantern/src/use.ts',
    ]);
  });

  test('a longer package name is not swallowed by a shorter one that prefixes it', () => {
    const root = tree({
      'packages/alpha/package.json': '{"name":"@merit/alpha"}',
      'packages/alpha/src/index.ts': 'export const a = 1;\n',
      'packages/alpha-seed/package.json': '{"name":"@merit/alpha-seed"}',
      'packages/alpha-seed/src/index.ts': 'export const b = 1;\n',
      'apps/lantern/src/use.ts': "import { b } from '@merit/alpha-seed';\nexport const c = b;\n",
    });
    expect(found(root, 'packages/alpha/src/index.ts', 'import')).toEqual([]);
    expect(found(root, 'packages/alpha-seed/src/index.ts', 'import')).toEqual([
      'apps/lantern/src/use.ts',
    ]);
  });

  test('a specifier inside a COMMENT is not an import, which is what `RI-25` was bitten by', () => {
    const root = tree({
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts':
        "// this file used to `import { a } from './a.js'` and no longer does\nexport const b = 1;\n",
    });
    expect(found(root, 'src/a.ts', 'import')).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// KIND 2: A PATH IN A LITERAL. ADR-418's finding.
// -----------------------------------------------------------------------------

describe('kind `path-literal`: the repo-relative path in a string a runner reads', () => {
  test('a register field naming the path is a dependant no module graph reaches', () => {
    const root = tree({
      'apps/lantern/src/producer.ts': 'export const EVENT_NAMES = [];\n',
      'packages/seedtooling/checks/register.mjs':
        "export const CLAIMS = [{ site: 'apps/lantern/src/producer.ts' }];\n",
    });
    expect(
      witness('path-literal', found(root, 'apps/lantern/src/producer.ts', 'path-literal')),
    ).toEqual(['packages/seedtooling/checks/register.mjs']);
    expect(found(root, 'apps/lantern/src/producer.ts', 'import')).toEqual([]);
  });

  test('a literal spelled IN PLACE is found, and not only one bound to a named constant', () => {
    // ADR-418 traced this kind through the `OLD_PATH` constant and so missed the
    // site in a fourth describe block that writes the literal out. ADR-419 paid
    // for that miss with a second measurement, and this case is that miss.
    const root = tree({
      'apps/lantern/src/producer.ts': 'export const EVENT_NAMES = [];\n',
      'apps/lantern/test/placement.test.ts':
        "const OLD_PATH = 'apps/lantern/src/other.ts';\n" +
        'read(OLD_PATH);\n' +
        "expect(walked).toContain('apps/lantern/src/producer.ts');\n",
    });
    expect(found(root, 'apps/lantern/src/producer.ts', 'path-literal')).toEqual([
      'apps/lantern/test/placement.test.ts',
    ]);
  });

  test('the path in a JSON file is a literal too', () => {
    const root = tree({
      'apps/lantern/src/producer.ts': 'export const a = 1;\n',
      'config/register.json': '{"site":"apps/lantern/src/producer.ts"}',
    });
    expect(found(root, 'apps/lantern/src/producer.ts', 'path-literal')).toEqual([
      'config/register.json',
    ]);
  });

  test('the path in a COMMENT is prose and never a literal, so a run is not claimed to break', () => {
    const root = tree({
      'apps/lantern/src/producer.ts': 'export const a = 1;\n',
      'apps/lantern/src/feed.ts':
        '// `apps/lantern/src/producer.ts` refuses an email-shaped value\nexport const f = 1;\n',
    });
    expect(found(root, 'apps/lantern/src/producer.ts', 'path-literal')).toEqual([]);
    expect(found(root, 'apps/lantern/src/producer.ts', 'prose')).toEqual([
      'apps/lantern/src/feed.ts',
    ]);
  });
});

// -----------------------------------------------------------------------------
// KIND 3: A DIRECTORY READ. ADR-419's finding.
// -----------------------------------------------------------------------------

describe('kind `enumeration`: a walk whose answer the target is part of', () => {
  test('a directory read that names NO path to the target is still a dependant', () => {
    const root = tree({
      'apps/lantern/src/producer.ts': 'export const a = 1;\n',
      'apps/lantern/test/placement.test.ts':
        "const found = readdirSync('apps/lantern/src');\nexpect(found.length).toBeGreaterThan(20);\n",
    });
    expect(
      witness('enumeration', found(root, 'apps/lantern/src/producer.ts', 'enumeration')),
    ).toEqual(['apps/lantern/test/placement.test.ts']);
    // AND IT MENTIONS THE TARGET NOWHERE. This is the assertion that separates
    // population dependence from every kind a text search can express.
    expect(found(root, 'apps/lantern/src/producer.ts', 'path-literal')).toEqual([]);
    expect(found(root, 'apps/lantern/src/producer.ts', 'import')).toEqual([]);
  });

  test('a read of a SIBLING directory is not a dependant', () => {
    const root = tree({
      'apps/lantern/src/producer.ts': 'export const a = 1;\n',
      'apps/lantern/test/other.test.ts': "const found = readdirSync('apps/lantern/test');\n",
    });
    expect(found(root, 'apps/lantern/src/producer.ts', 'enumeration')).toEqual([]);
  });

  test('a NON-recursive read of a grandparent is not a dependant', () => {
    const root = tree({
      'apps/lantern/src/producer.ts': 'export const a = 1;\n',
      'tools/shallow.mjs': "const top = readdirSync('apps/lantern');\n",
    });
    expect(found(root, 'apps/lantern/src/producer.ts', 'enumeration')).toEqual([]);
  });

  test('a RECURSIVE read of a grandparent is', () => {
    const root = tree({
      'apps/lantern/src/producer.ts': 'export const a = 1;\n',
      'tools/deep.mjs': "const all = readdirSync('apps/lantern', { recursive: true });\n",
    });
    expect(found(root, 'apps/lantern/src/producer.ts', 'enumeration')).toEqual(['tools/deep.mjs']);
  });

  test('the directory is folded through the constants this tree actually writes', () => {
    const root = tree({
      'apps/lantern/src/producer.ts': 'export const a = 1;\n',
      'apps/lantern/test/folded.test.ts':
        "const ROOT = join(import.meta.dirname, '..', '..', '..');\n" +
        "const SRC = join(ROOT, 'apps/lantern/src');\n" +
        'const files = readdirSync(SRC);\n',
    });
    expect(found(root, 'apps/lantern/src/producer.ts', 'enumeration')).toEqual([
      'apps/lantern/test/folded.test.ts',
    ]);
  });

  test('a LOCAL WALKER taking the directory as a parameter is followed to its call site', () => {
    // This is ADR-419's own site in miniature: `readdirSync(dir)` where `dir` is
    // a parameter, and the directory that decides the answer is at the call.
    const root = tree({
      'apps/lantern/src/producer.ts': 'export const a = 1;\n',
      'apps/lantern/test/walker.test.ts':
        'function walk(dir, out) {\n' +
        '  for (const e of readdirSync(dir)) out.push(e);\n' +
        '  return out;\n' +
        '}\n' +
        "const found = walk(join(ROOT, 'apps/lantern/src'), []);\n" +
        "const ROOT = '';\n",
    });
    expect(found(root, 'apps/lantern/src/producer.ts', 'enumeration')).toEqual([
      'apps/lantern/test/walker.test.ts',
    ]);
  });
});

// -----------------------------------------------------------------------------
// KIND 4: A GLOB IN A CONFIGURATION. Found here, by nothing that hurt.
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// ADR-427: REACH AND RETENTION, AS A TIER AND NEVER AS A FILTER
// -----------------------------------------------------------------------------
// ADR-422 section 11 handed on that `enumeration` has a precision of 1 in 18
// against the red set on its own test target, that the module offers no way to
// tell REACH from RETENTION, and that modelling the caller's filter *would be
// the first place this module could go quiet*.
//
// **THE CASE THAT MATTERS MOST IN THIS BLOCK IS THE ONE THAT ASSERTS A SITE IS
// STILL REPORTED.** Every other case here could be satisfied by a module that
// had quietly turned its tier into a filter, and that module would be strictly
// worse than the one ADR-422 shipped. So the tier is watched from both ends:
// that it distinguishes, and that it removes nothing.
//
// The fixtures name `apps/lantern` and `packages/alpha*`, namespaces no tracked
// file uses, on ADR-422 section 8's finding that a fixture spelling a live path
// makes its own file a derived dependant of that path.
// -----------------------------------------------------------------------------

/** A consumer that walks a directory and then filters what it got on CONTENT. */
function consumer(dir: string, predicate: string): string {
  return [
    "import { readdirSync, readFileSync } from 'node:fs';",
    `const found = readdirSync('${dir}');`,
    `const kept = found.filter((f) => ${predicate});`,
    'export const count = kept.length;',
  ].join('\n');
}

describe('ADR-427: what the caller does with the walk`s answer', () => {
  test('a content predicate the target FAILS tiers the site `excluded` and STILL REPORTS IT', () => {
    const root = tree({
      'apps/lantern/src/target.ts': 'export const target = 1;\n',
      'apps/lantern/test/reader.test.ts': consumer(
        'apps/lantern/src',
        "readFileSync(f, 'utf8').includes('ABSENT_MARKER')",
      ),
    });
    const sites = dependantsOf(root, 'apps/lantern/src/target.ts').sites.filter(
      (s) => s.kind === 'enumeration',
    );
    // THE SITE IS THE ANSWER AND THE TIER IS ADVICE ABOUT IT. If this length
    // ever reads 0, the tier has become a filter and this module has gone quiet
    // in exactly the direction ADR-422 warned the work would go.
    expect(sites.map((s) => s.file)).toEqual(['apps/lantern/test/reader.test.ts']);
    expect(sites[0]?.retention).toBe('excluded');
  });

  test('a content predicate the target SATISFIES tiers the site `selected`', () => {
    const root = tree({
      'apps/lantern/src/target.ts': 'export const PRESENT_MARKER = 1;\n',
      'apps/lantern/test/reader.test.ts': consumer(
        'apps/lantern/src',
        "readFileSync(f, 'utf8').includes('PRESENT_MARKER')",
      ),
    });
    const sites = dependantsOf(root, 'apps/lantern/src/target.ts').sites.filter(
      (s) => s.kind === 'enumeration',
    );
    expect(sites[0]?.retention).toBe('selected');
  });

  test('a walk with no content predicate at all is `unfiltered`, which claims the least', () => {
    const root = tree({
      'apps/lantern/src/target.ts': 'export const target = 1;\n',
      'apps/lantern/test/reader.test.ts':
        "import { readdirSync } from 'node:fs';\n" +
        "export const found = readdirSync('apps/lantern/src');\n",
    });
    const sites = dependantsOf(root, 'apps/lantern/src/target.ts').sites.filter(
      (s) => s.kind === 'enumeration',
    );
    expect(sites[0]?.retention).toBe('unfiltered');
  });

  test('a predicate this module CANNOT fold leaves the site `unfiltered`, never `excluded`', () => {
    // THE BIAS IS THE MECHANISM. An unrecognised predicate must push a site
    // towards "assume sensitive" and never towards "assume dropped", because the
    // second direction is the one that costs a reader the file.
    const root = tree({
      'apps/lantern/src/target.ts': 'export const target = 1;\n',
      'apps/lantern/test/reader.test.ts': consumer('apps/lantern/src', 'somebodyElsesOracle(f)'),
    });
    const sites = dependantsOf(root, 'apps/lantern/src/target.ts').sites.filter(
      (s) => s.kind === 'enumeration',
    );
    expect(sites[0]?.retention).toBe('unfiltered');
  });

  test('the tier moves NO count: the same sites are reported whichever way the filter falls', () => {
    // The two trees differ only in whether the target carries the marker the
    // consumer filters on, so a tier that had become a filter would report a
    // different number of sites for one of them.
    const build = (body: string): number =>
      dependantsOf(
        tree({
          'apps/lantern/src/target.ts': body,
          'apps/lantern/test/reader.test.ts': consumer(
            'apps/lantern/src',
            "readFileSync(f, 'utf8').includes('MARKER')",
          ),
        }),
        'apps/lantern/src/target.ts',
      ).sites.filter((s) => s.kind === 'enumeration').length;
    expect(build('export const MARKER = 1;\n')).toBe(1);
    expect(build('export const other = 1;\n')).toBe(1);
  });

  test('a local `read` helper is recognised, so a predicate spelled over it is not invisible', () => {
    const root = tree({
      'apps/lantern/src/target.ts': 'export const target = 1;\n',
      'apps/lantern/test/reader.test.ts': [
        "import { readdirSync, readFileSync } from 'node:fs';",
        "const read = (p: string): string => readFileSync(p, 'utf8');",
        "const found = readdirSync('apps/lantern/src');",
        'export const kept = found.filter((f) => /ABSENT/.test(read(f)));',
      ].join('\n'),
    });
    const sites = dependantsOf(root, 'apps/lantern/src/target.ts').sites.filter(
      (s) => s.kind === 'enumeration',
    );
    expect(sites[0]?.retention).toBe('excluded');
  });

  test('a regular expression bound to a NAME is folded, as this tree spells its predicates', () => {
    const bindings = new Map([['SPEC', '/\\bpresent\\b/']]);
    expect(foldRegExp('SPEC', bindings)?.test('a present word')).toBe(true);
    expect(foldRegExp('SPEC', bindings)?.test('absent')).toBe(false);
    // A name bound to something that is not a pattern is not guessed at.
    expect(foldRegExp('OTHER', new Map([['OTHER', "'a string'"]]))).toBeNull();
  });

  test('`excluded` is only ever reached by TESTING the target, never by failing to read it', () => {
    // A target whose bytes cannot be read yields the tier that says so, rather
    // than the tier that says the filter dropped it.
    expect(retentionOf([{ source: 'x', test: () => false }], null)).toBe('unreadable');
    expect(retentionOf([], 'anything')).toBe('unfiltered');
  });
});

describe('ADR-427: a computed pattern list is folded, and a refusal is still UNDECIDED', () => {
  /** The shape the test runner's configuration actually writes. */
  const computed = [
    "const SOURCES = ['apps/*', 'packages/*'];",
    'const UNIT = SOURCES.map((s) => `${s}/test/**/*.test.ts`);',
    'const suffixed = (suffix: string) => SOURCES.map((s) => `${s}/test/**/*.${suffix}.test.ts`);',
    'const GOLDEN = suffixed(`golden`);',
    'export default { test: { projects: [ { test: { name: `unit`, include: UNIT, exclude: [...GOLDEN] } } ] } };',
  ].join('\n');

  test('a list computed by `.map` over an array of literals reaches the files it reaches', () => {
    const root = tree({
      'vitest.config.ts': computed,
      'packages/alpha/test/one.test.ts': 'export const one = 1;\n',
    });
    const report = dependantsOf(root, 'packages/alpha/test/one.test.ts');
    expect(
      report.sites
        .filter((s) => s.kind === 'config-glob' && s.file === 'vitest.config.ts')
        .map((s) => s.detail),
    ).toContain('include pattern `packages/*/test/**/*.test.ts`');
    // AND THE CONFIGURATION IS NO LONGER UNDECIDED ABOUT ITSELF.
    expect(report.undecided.filter((u) => u.file === 'vitest.config.ts')).toEqual([]);
  });

  test('a list built by CALLING a bound arrow is folded too, including through a spread', () => {
    const root = tree({
      'vitest.config.ts': computed,
      'packages/alpha/test/one.golden.test.ts': 'export const one = 1;\n',
    });
    const details = dependantsOf(root, 'packages/alpha/test/one.golden.test.ts')
      .sites.filter((s) => s.kind === 'config-glob' && s.file === 'vitest.config.ts')
      .map((s) => s.detail);
    expect(details).toContain('exclude pattern `packages/*/test/**/*.golden.test.ts`');
  });

  test('a list this module will NOT fold is named UNDECIDED and never silently absent', () => {
    const root = tree({
      'vitest.config.ts':
        'export default { test: { projects: [ { test: { include: whateverThisIs() } } ] } };\n',
      'packages/alpha/test/one.test.ts': 'export const one = 1;\n',
    });
    const report = dependantsOf(root, 'packages/alpha/test/one.test.ts');
    expect(report.undecided.map((u) => u.file)).toContain('vitest.config.ts');
  });

  test('foldGlobList refuses what it cannot fold rather than returning a short list', () => {
    const bindings = new Map([['A', "['x/*']"]]);
    expect(foldGlobList('A', bindings)).toEqual(['x/*']);
    expect(foldGlobList('[...A, ...A]', bindings)).toEqual(['x/*', 'x/*']);
    expect(foldGlobList('[...A, ...MISSING]', bindings)).toBeNull();
    expect(foldGlobList('somethingElse()', bindings)).toBeNull();
  });
});

describe('ADR-427: the walker recogniser reads the whole directory expression', () => {
  test('a walker whose parameter is not the FIRST argument of the join is followed', () => {
    const root = tree({
      'packages/alpha/src/target.ts': 'export const target = 1;\n',
      'packages/alpha/test/w.test.ts': [
        "import { readdirSync } from 'node:fs';",
        "import { join } from 'node:path';",
        "const ROOT = 'packages/alpha';",
        'function under(sub: string): string[] {',
        '  return readdirSync(join(ROOT, sub));',
        '}',
        "export const found = under('src');",
      ].join('\n'),
    });
    expect(
      witness('enumeration', found(root, 'packages/alpha/src/target.ts', 'enumeration')),
    ).toEqual(['packages/alpha/test/w.test.ts']);
  });

  test('a walker`s DECLARATION is not counted as one of its own call sites', () => {
    // A parameter list is not a directory read. Counting it as one reported a
    // read that never happened, and the figure it inflated is the one this
    // module publishes as the size of what its enumeration kind cannot aim.
    const root = tree({
      'packages/alpha/src/target.ts': 'export const target = 1;\n',
      'packages/alpha/test/w.test.ts': [
        "import { readdirSync } from 'node:fs';",
        'function under(dir: string): string[] {',
        '  return readdirSync(dir);',
        '}',
        "export const found = under('packages/alpha/src');",
      ].join('\n'),
    });
    const report = dependantsOf(root, 'packages/alpha/src/target.ts');
    expect(report.sites.filter((s) => s.kind === 'enumeration').map((s) => s.file)).toEqual([
      'packages/alpha/test/w.test.ts',
    ]);
    expect(report.undecided).toEqual([]);
    expect(report.unresolvedEnumerations).toBe(0);
  });
});

describe('kind `config-glob`: a pattern that reaches the file and names no file', () => {
  test('a `tsconfig.json` include that matches the target is a dependant of the MOVE', () => {
    const root = tree({
      'apps/lantern/src/producer.ts': 'export const a = 1;\n',
      'apps/lantern/tsconfig.json': '{"include":["src/**/*.ts"]}',
    });
    expect(
      witness('config-glob', found(root, 'apps/lantern/src/producer.ts', 'config-glob')),
    ).toEqual(['apps/lantern/tsconfig.json']);
  });

  test('a glob that does NOT match is not a dependant', () => {
    const root = tree({
      'apps/lantern/src/producer.ts': 'export const a = 1;\n',
      'apps/lantern/tsconfig.json': '{"include":["test/**/*.ts"]}',
    });
    expect(found(root, 'apps/lantern/src/producer.ts', 'config-glob')).toEqual([]);
  });

  test('the root manifest`s format glob and the eslint `files` list are read as globs', () => {
    const root = tree({
      'apps/lantern/src/producer.ts': 'export const a = 1;\n',
      'package.json':
        '{"scripts":{"format:check":"prettier --check \\"{apps,packages}/**/*.{ts,json}\\""}}',
      'eslint.config.js': "export default [{ files: ['apps/**/*.ts'] }];\n",
    });
    expect(found(root, 'apps/lantern/src/producer.ts', 'config-glob')).toEqual([
      'eslint.config.js',
      'package.json',
    ]);
  });

  test('`**/` matches zero directories as well as many', () => {
    expect(globToRegExp('apps/**/*.ts').test('apps/events.ts')).toBe(true);
    expect(globToRegExp('apps/**/*.ts').test('apps/lantern/src/producer.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/a/b.ts')).toBe(false);
    expect(globToRegExp('{apps,packages}/**/*.{ts,json}').test('packages/alpha/x.json')).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// KIND 5: PROSE, AND WHICH OF IT ADR-386 SAYS TO LEAVE ALONE.
// -----------------------------------------------------------------------------

describe('kind `prose`: what goes false rather than red', () => {
  test('a document naming the path is reported, and a dated record is flagged as such', () => {
    const root = tree({
      'apps/lantern/src/producer.ts': 'export const a = 1;\n',
      'docs/SEEDSTATE.md': 'The producer is at `apps/lantern/src/producer.ts`.\n',
      'docs/sessions/2026-01-01-session-000.md':
        'measured `apps/lantern/src/producer.ts` on this day\n',
    });
    const sites = dependantsOf(root, 'apps/lantern/src/producer.ts').sites.filter(
      (s) => s.kind === 'prose',
    );
    expect(
      witness(
        'prose',
        sites.map((s) => s.file),
      ).sort(),
    ).toEqual(['docs/SEEDSTATE.md', 'docs/sessions/2026-01-01-session-000.md']);
    expect(sites.find((s) => s.file === 'docs/sessions/2026-01-01-session-000.md')?.dated).toBe(
      true,
    );
    expect(sites.find((s) => s.file === 'docs/SEEDSTATE.md')?.dated).toBe(false);
  });

  test('the dated-record rule is the one ADR-386 states and not a guess at filenames', () => {
    // THE ARGUMENTS ARE SYNTHETIC ON PURPOSE and it is this module's own finding
    // that made them so: a literal naming a live path makes the file carrying it
    // a `path-literal` dependant of that path, whether it reads the file or
    // merely spells its name. Section 7 of ADR-422 measured the first version of
    // this suite doing exactly that to the file it was written about.
    expect(isDatedRecord('docs/sessions/2026-01-01-session-000.md')).toBe(true);
    expect(isDatedRecord('docs/decisions/ADR-000.md')).toBe(true);
    expect(isDatedRecord('docs/reviews/2026-01-01-a-seeded-audit.md')).toBe(true);
    expect(isDatedRecord('docs/decisions/NOT-DATED.md')).toBe(false);
    expect(isDatedRecord('docs/SEEDSTATE.md')).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// THE HALF THAT MATTERS MORE THAN THE FINDINGS
// -----------------------------------------------------------------------------

describe('what it could not resolve is NAMED rather than dropped', () => {
  test('a directory read this module cannot fold appears in `undecided`', () => {
    const root = tree({
      'apps/lantern/src/producer.ts': 'export const a = 1;\n',
      'apps/lantern/test/opaque.test.ts':
        'const dir = fromSomewhereElse();\nconst found = readdirSync(dir);\n',
    });
    const report = dependantsOf(root, 'apps/lantern/src/producer.ts');
    expect(report.sites.filter((s) => s.kind === 'enumeration')).toEqual([]);
    expect(report.undecided.map((u) => u.file)).toContain('apps/lantern/test/opaque.test.ts');
    expect(report.unresolvedEnumerations).toBeGreaterThan(0);
  });

  test('an unresolvable read in a file that already names the target`s directory is flagged NEAR', () => {
    const root = tree({
      'apps/lantern/src/producer.ts': 'export const a = 1;\n',
      'apps/lantern/test/near.test.ts':
        "const label = 'apps/lantern/src';\nconst found = readdirSync(whatever);\n",
      'tools/far.mjs': 'const found = readdirSync(whatever);\n',
    });
    const report = dependantsOf(root, 'apps/lantern/src/producer.ts');
    expect(report.undecided.find((u) => u.file === 'apps/lantern/test/near.test.ts')?.near).toBe(
      true,
    );
    // AND THE FAR ONE IS STILL THERE. The tier sorts; it never drops.
    expect(report.undecided.find((u) => u.file === 'tools/far.mjs')?.near).toBe(false);
  });

  test('a tsconfig `paths` alias is reported, because it is a second address this module does not resolve', () => {
    const root = tree({
      'apps/lantern/src/producer.ts': 'export const a = 1;\n',
      'tsconfig.seed.json': '{"compilerOptions":{"paths":{"@merit/*":["packages/*/src"]}}}',
    });
    expect(dependantsOf(root, 'apps/lantern/src/producer.ts').aliases).toEqual([
      'tsconfig.seed.json: @merit/*',
    ]);
  });
});

describe('the two registers, read rather than typed twice', () => {
  test('every kind in KINDS was produced by a seed above, and every seed maps to a kind', () => {
    // **THIS IS THE CASE THAT STOPS A DETECTOR GOING QUIET.** A kind whose
    // detector is removed while its register entry stands leaves that entry
    // unwitnessed, and a kind produced by a detector with no entry is a kind no
    // reader of `--kinds` is told about. Both are RED here.
    expect([...witnessed].sort()).toEqual(KINDS.map((k) => k.id).sort());
  });

  test('every kind states what breaks, and it is one of the three answers', () => {
    for (const kind of KINDS) {
      expect(['delete', 'move', 'neither']).toContain(kind.breaks);
      expect(kind.found.length).toBeGreaterThan(10);
      expect(kind.what.length).toBeGreaterThan(80);
    }
  });

  test('BLIND is not empty and no entry is a stub', () => {
    // An instrument whose declared blind spots can be emptied to a word is an
    // instrument whose user goes back to inferring completeness from silence.
    expect(BLIND.length).toBeGreaterThan(3);
    for (const blind of BLIND) expect(blind.what.length).toBeGreaterThan(80);
  });

  test('no id is spelt twice in either register', () => {
    const ids = [...KINDS.map((k) => k.id), ...BLIND.map((b) => b.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the small parts, because a wrong one is silent', () => {
  test('normalise resolves `..` and refuses to leave the tree', () => {
    expect(normalise('apps/lantern/test/../../lantern/src/producer.ts')).toBe(
      'apps/lantern/src/producer.ts',
    );
    expect(normalise('a/./b//c')).toBe('a/b/c');
    expect(normalise('../outside')).toBe(null);
  });

  test('splitArgs splits at top level and refuses an unbalanced call', () => {
    expect(splitArgs("ROOT, 'a/b', join(x, y)")).toEqual(['ROOT', "'a/b'", 'join(x, y)']);
    expect(splitArgs("'a,b', c")).toEqual(["'a,b'", 'c']);
    expect(splitArgs('a, (b')).toBe(null);
  });

  test('foldDir knows the spellings and admits the ones it does not', () => {
    const bindings = new Map([
      ['ROOT', "join(import.meta.dirname, '..', '..', '..')"],
      ['SRC', "join(ROOT, 'apps/lantern/src')"],
    ]);
    expect(foldDir('SRC', 'apps/lantern/test', bindings)).toBe('apps/lantern/src');
    expect(foldDir('`${ROOT}/apps`', 'apps/lantern/test', bindings)).toBe('apps');
    expect(foldDir('somethingElse', 'apps/lantern/test', bindings)).toBe(null);
    expect(foldDir('join(ROOT, unknownVariable)', 'apps/lantern/test', bindings)).toBe(null);
  });

  test('literals keeps a template whole and does not run past a newline', () => {
    expect(literals('const a = \'x\'; const b = "y";')).toEqual(['x', 'y']);
    expect(literals('const a = `p/${q}/r`;')).toEqual(['p/${q}/r']);
    expect(literals("const a = 'unterminated\nconst b = 'x';")).toEqual(['x']);
  });
});

describe('the second hop, asked for and never assumed', () => {
  test('a file that reaches the target only THROUGH another is absent at one hop and present at two', () => {
    // THE SHAPE ADR-422 SECTION 6 MEASURED. `runner` reads the target's path;
    // `suite` reads `runner` and never names the target, so deleting the target
    // reddens `suite` and no direct kind can see why.
    const root = tree({
      'apps/lantern/src/producer.ts': 'export const a = 1;\n',
      'tools/runner.mjs': "export const SITE = 'apps/lantern/src/producer.ts';\n",
      'tools/suite.test.ts': "import { SITE } from './runner.mjs';\nexpect(SITE).toBeTruthy();\n",
    });
    const direct = dependantsOf(root, 'apps/lantern/src/producer.ts');
    expect(direct.sites.map((s) => s.file)).not.toContain('tools/suite.test.ts');

    const one = closure(root, 'apps/lantern/src/producer.ts', 1);
    expect([...one.reached.keys()]).toEqual(['tools/runner.mjs']);

    const two = closure(root, 'apps/lantern/src/producer.ts', 2);
    expect(two.reached.get('tools/runner.mjs')).toBe(1);
    expect(two.reached.get('tools/suite.test.ts')).toBe(2);
  });

  test('ADR-427: an ORDINARY run reports how many files the second hop would add', () => {
    // The default is one hop and stays one, so the run has to say how short it
    // is. ADR-422 section 6 measured a file going red that is outside the
    // one-hop closure, so "not listed above" is a real quantity on a real
    // target and a caller who is not told it infers it is zero.
    const root = tree({
      'packages/alpha/src/target.ts': 'export const target = 1;\n',
      'packages/alpha/src/middle.ts': "export * from './target.ts';\n",
      'packages/alpha/src/outer.ts':
        "import { target } from './middle.ts';\nexport const o = target;\n",
    });
    const lines: string[] = [];
    main(['packages/alpha/src/target.ts'], (line) => lines.push(line), root);
    const footer = lines.find((line) => line.startsWith('TRANSITIVE'));
    expect(footer).toBeDefined();
    expect(footer).toContain('1 file(s) reach it in ONE composing step and 2 within TWO');
    expect(footer).toContain('1 file(s) depend on it only THROUGH another file');
  });

  test('the closure does NOT compose enumerations, which would return the tree', () => {
    // A walk of a directory makes every file in it a first-hop dependant of
    // every other, so one composing step over enumerations is the whole tree.
    const root = tree({
      'apps/lantern/src/producer.ts': 'export const a = 1;\n',
      'apps/lantern/src/other.ts': 'export const b = 1;\n',
      'tools/walker.mjs': "const all = readdirSync('apps/lantern/src');\n",
      'tools/reader.mjs': "import './walker.mjs';\n",
    });
    expect(dependantsOf(root, 'apps/lantern/src/producer.ts').sites.map((s) => s.file)).toContain(
      'tools/walker.mjs',
    );
    expect([...closure(root, 'apps/lantern/src/producer.ts', 3).reached.keys()]).toEqual([]);
  });

  test('a cycle terminates and each file is reported at the hop it was FIRST reached', () => {
    // `c` reaches the target directly AND through `b`, so an unguarded walk
    // reports it at 2 having already reported it at 1. The hop is what a reader
    // uses to decide how far a change travels, so the LATER number is the wrong
    // one and this case is what stops it being written.
    const root = tree({
      'a.ts': "import './b.js';\nexport const a = 1;\n",
      'b.ts': "import './a.js';\nexport const b = 1;\n",
      'c.ts': "import './b.js';\nimport './a.js';\nexport const c = 1;\n",
    });
    const out = closure(root, 'a.ts', 9);
    expect(out.reached.get('b.ts')).toBe(1);
    expect(out.reached.get('c.ts')).toBe(1);
    expect(out.reached.has('a.ts')).toBe(false);
  });
});

describe('on this repository, where the answer has to be about the real tree', () => {
  test('the derivation runs over the real population and the population is not trivial', () => {
    // A CHECK THAT CANNOT RUN IS NOT A CHECK THAT PASSED, and every kind above
    // would report nothing over a tree that failed to enumerate.
    const report = dependantsOf(REPO_ROOT, 'packages/tooling/checks/dependants.mjs');
    expect(report.exists).toBe(true);
    expect(report.population.files).toBeGreaterThan(1000);
    expect(report.population.method).toBe('git ls-files');
  });

  test('this suite is derived as an importing dependant of the module it tests', () => {
    const report = dependantsOf(REPO_ROOT, 'packages/tooling/checks/dependants.mjs');
    expect(report.sites.filter((s) => s.kind === 'import').map((s) => s.file)).toContain(
      'packages/tooling/test/dependants.test.ts',
    );
  });

  test('the closure reaches this suite from the comment stripper in two composing steps', () => {
    // Both ends of this are in `packages/tooling` and the middle is the module
    // under test, so the case says something about the real graph without
    // binding a file another row may rewrite.
    const out = closure(REPO_ROOT, 'packages/tooling/checks/strip-comments.mjs', 2);
    expect(out.reached.get('packages/tooling/checks/dependants.mjs')).toBe(1);
    expect(out.reached.get('packages/tooling/test/dependants.test.ts')).toBeLessThanOrEqual(2);
  });

  test('the module reads the one comment stripper rather than carrying a second copy', () => {
    const report = dependantsOf(REPO_ROOT, 'packages/tooling/checks/strip-comments.mjs');
    expect(report.sites.filter((s) => s.kind === 'import').map((s) => s.file)).toContain(
      'packages/tooling/checks/dependants.mjs',
    );
  });
});
