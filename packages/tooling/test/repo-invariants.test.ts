import { mkdirSync, mkdtempSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import {
  CHECKS,
  COVERAGE_NEEDLES,
  DEPLOYABLES,
  REPO_ROOT,
  needle,
} from '../checks/repo-invariants.mjs';

// =============================================================================
// EACH INVARIANT IS WATCHED FAILING BEFORE IT IS TRUSTED
// =============================================================================
// falsify.mjs's rule, applied to the scaffold's own checks: a check that has
// only ever been seen pass is indistinguishable from a check that cannot fail.
// Every case below states the violation it plants and the finding it demands,
// because "it returned a non-empty array" is not evidence that it caught the
// thing you planted.
//
// The dirty direction runs against a SYNTHETIC minimal tree rather than a copy
// of the repository, so a case is fast and its seed is legible. The clean
// direction runs against the real repository, which is the tree these
// invariants are actually about.

const seeded: string[] = [];
afterEach(() => {
  for (const dir of seeded.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const write = (root: string, rel: string, body: string): void => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), body);
};

/** A tree that satisfies every invariant, which each case then breaks in one way. */
function cleanTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'merit-invariants-'));
  seeded.push(root);

  write(root, 'pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n  - 'packages/*'\n");
  write(root, '.nvmrc', '22\n');
  write(root, 'package.json', JSON.stringify({ name: 'merit', private: true }));
  write(
    root,
    'vitest.config.ts',
    ['unit', 'property', 'golden', 'integration']
      .map((s) => `{ test: { name: '${s}' } }`)
      .join('\n'),
  );
  write(
    root,
    '.github/workflows/ci.yml',
    'jobs:\n  x:\n    steps:\n      - node-version-file: .nvmrc\n',
  );
  for (const pkg of ['rules-engine', 'db']) {
    write(root, `packages/${pkg}/package.json`, JSON.stringify({ name: `@merit/${pkg}` }));
  }
  // RI-07's input: a module GRAPH, not a file. Two modules rather than one,
  // because the check throws when it walks fewer than two -- a graph walk that
  // reached only the entry point means the specifier scan stopped matching, and
  // a fixture with one file could not tell those apart.
  write(root, 'packages/rules-engine/src/index.ts', "export { floorAt } from './floor.js';\n");
  write(
    root,
    'packages/rules-engine/src/floor.ts',
    'export const floorAt = (n: number): number => (n < 0 ? 0 : n);\n',
  );
  // RI-04's OWN LIST, NOT A SECOND COPY OF IT. This read `['site', 'portal',
  // 'admin', 'worker']` while DEPLOYABLES read the same four, so the two agreed
  // by coincidence until ADR-083 added `apps/api` to the tree and neither list
  // learned about it. A fixture that maintains its own copy of the thing under
  // test cannot fail when that thing goes stale; it just goes stale in step.
  for (const app of DEPLOYABLES) {
    write(root, `apps/${app}/package.json`, JSON.stringify({ name: `@merit/${app}` }));
  }
  // RI-06's two inputs. The fixture registers one rule and attaches it, which is
  // the shape the invariant demands; the seeded cases below break it in each
  // direction separately.
  write(
    root,
    'packages/eslint-plugin-merit/index.js',
    "const plugin = { rules: {\n  'engine-purity': enginePurity,\n} };\n",
  );
  write(
    root,
    'eslint.config.js',
    "export default [{ rules: { 'merit/engine-purity': 'error' } }];\n",
  );
  return root;
}

const check = (id: string) => {
  const found = CHECKS.find((c) => c.id === id);
  if (!found) throw new Error(`no such check: ${id}`);
  return found;
};

const findings = (id: string, root: string): string[] => check(id).run(root);

// -----------------------------------------------------------------------------
// The clean direction, both trees
// -----------------------------------------------------------------------------
describe('clean tree: every invariant holds', () => {
  test.each(CHECKS.map((c) => [c.id, c.title] as const))('%s %s', (id) => {
    expect(findings(id, REPO_ROOT)).toEqual([]);
  });

  test('the synthetic fixture itself satisfies every invariant', () => {
    const root = cleanTree();
    for (const c of CHECKS)
      expect({ id: c.id, findings: c.run(root) }).toEqual({ id: c.id, findings: [] });
  });
});

// -----------------------------------------------------------------------------
// The dirty direction, one seeded violation per invariant
// -----------------------------------------------------------------------------
describe('seeded tree: each invariant fails on the violation it names', () => {
  // RI-06 EXISTS FOR A RULE WHOSE GLOB MATCHES NOTHING, so both directions are
  // seeded. An unplugged rule and an armed one produce byte-identical lint
  // output when there are no files for the rule to have an opinion about, and
  // that is precisely `merit/no-calendar-in-expiry-path`'s situation until P2.
  test('RI-06 catches a plugin rule that eslint.config.js attaches to nothing', () => {
    const root = cleanTree();
    write(
      root,
      'packages/eslint-plugin-merit/index.js',
      "const plugin = { rules: {\n  'engine-purity': enginePurity,\n  'no-calendar-in-expiry-path': noCalendarInExpiryPath,\n} };\n",
    );
    expect(findings('RI-06', root).join('\n')).toContain('attaches it to nothing');
  });

  test('RI-06 catches a config attaching a rule the plugin does not register', () => {
    const root = cleanTree();
    write(
      root,
      'eslint.config.js',
      "export default [{ rules: { 'merit/no-such-rule': 'error' } }];\n",
    );
    expect(findings('RI-06', root).join('\n')).toContain('does not register');
  });

  test('RI-01 catches a workspace dependency added to the engine', () => {
    const root = cleanTree();
    write(
      root,
      'packages/rules-engine/package.json',
      JSON.stringify({ name: '@merit/rules-engine', dependencies: { '@merit/db': 'workspace:*' } }),
    );
    expect(findings('RI-01', root).join('\n')).toContain(
      'dependencies.@merit/db is a `workspace:` specifier',
    );
  });

  test('RI-01 catches a workspace package imported without the workspace: protocol', () => {
    const root = cleanTree();
    write(
      root,
      'packages/rules-engine/package.json',
      JSON.stringify({ name: '@merit/rules-engine', devDependencies: { '@merit/db': '0.0.0' } }),
    );
    expect(findings('RI-01', root).join('\n')).toContain(
      'devDependencies.@merit/db is a package in this workspace',
    );
  });

  // THE NEEDLE IS ASSEMBLED HERE TOO. RI-02 is a text scan, so a file that
  // merely NAMES one of these keys is a finding of it, comments included. The
  // alternative is an exclusion for the check's own test, which is a hole in
  // the least visible possible place, so nothing in this file spells one out.
  test.each(COVERAGE_NEEDLES.map(([re, tool]) => [tool, re] as const))(
    'RI-02 catches %s',
    (tool, re) => {
      const root = cleanTree();
      // The seeded spelling is DERIVED FROM THE NEEDLE rather than retyped, so
      // a case cannot drift away from the pattern it is testing. Two
      // transforms make the pattern into literal text: drop the escaping
      // backslashes, and turn the one whitespace class into the whitespace it
      // stands for. A needle whose source does not survive that will fail this
      // case loudly, which is the direction it should fail in.
      const spelling = re.source.replaceAll('\\', '').replace('s*:', ': 80');
      write(root, 'vitest.config.ts', `export default { test: { coverage: { ${spelling} } } };\n`);
      expect(findings('RI-02', root)).toContain(`vitest.config.ts: reads as ${tool}`);
    },
  );

  test('RI-02 catches a coverage-gate config file existing at all', () => {
    const root = cleanTree();
    write(root, '.nycrc', '{}\n');
    expect(findings('RI-02', root).join('\n')).toContain(
      '.nycrc: a coverage-gate config file exists',
    );
  });

  test('RI-03 catches a vitest.workspace.ts, which Vitest 4 silently ignores', () => {
    const root = cleanTree();
    write(root, 'vitest.workspace.ts', 'export default [];\n');
    expect(findings('RI-03', root).join('\n')).toContain(
      'vitest.workspace.ts exists and Vitest 4 ignores it',
    );
  });

  test('RI-03 catches the golden stage being folded into another project', () => {
    const root = cleanTree();
    write(
      root,
      'vitest.config.ts',
      "{ test: { name: 'unit' } }\n{ test: { name: 'integration' } }\n",
    );
    const out = findings('RI-03', root).join('\n');
    expect(out).toContain("no project named 'golden'");
    expect(out).toContain("no project named 'property'");
  });

  test('RI-04 catches admin being folded into another deployable', () => {
    const root = cleanTree();
    rmSync(join(root, 'apps/admin'), { recursive: true });
    expect(findings('RI-04', root).join('\n')).toContain(
      'apps/admin/package.json does not exist: admin is not a separate deployable',
    );
  });

  test('RI-04 catches one app depending on another', () => {
    const root = cleanTree();
    write(
      root,
      'apps/portal/package.json',
      JSON.stringify({ name: '@merit/portal', dependencies: { '@merit/admin': 'workspace:*' } }),
    );
    expect(findings('RI-04', root).join('\n')).toContain('makes apps/portal depend on apps/admin');
  });

  test('RI-05 catches a workflow pinning the Node version inline', () => {
    const root = cleanTree();
    write(root, '.github/workflows/ci.yml', 'jobs:\n  x:\n    steps:\n      - node-version: 20\n');
    expect(findings('RI-05', root).join('\n')).toContain('pins the Node version inline');
  });

  test('RI-05 catches a second Node version hiding in engines', () => {
    const root = cleanTree();
    write(root, 'package.json', JSON.stringify({ name: 'merit', engines: { node: '>=20' } }));
    expect(findings('RI-05', root).join('\n')).toContain('engines.node is ">=20"');
  });

  // ---------------------------------------------------------------------------
  // RI-07, AND THE FIRST CASE IS THE ONE THAT JUSTIFIES THE CHECK EXISTING
  // ---------------------------------------------------------------------------
  // The others are defence in depth. The escape-hatch case is the one no other
  // mechanism in this repository can produce a finding for: the specifier is
  // RELATIVE, so `merit/engine-purity` returns early on it, and the file it
  // reaches is outside that rule's glob, so nothing lints the file either.
  test('RI-07 catches a relative import that escapes packages/rules-engine/src', () => {
    const root = cleanTree();
    write(root, 'packages/rules-engine/impure/io.ts', 'export const x = 1;\n');
    write(
      root,
      'packages/rules-engine/src/index.ts',
      "export { floorAt } from './floor.js';\nexport { x } from '../impure/io.js';\n",
    );
    const out = findings('RI-07', root).join('\n');
    expect(out).toContain('OUTSIDE');
    expect(out).toContain('packages/rules-engine/impure/io.ts');
  });

  test('RI-07 catches a Node builtin reached TRANSITIVELY, and names the trail', () => {
    // Two hops from the entry point, which is the whole difference between this
    // check and a per-file lint rule. The trail is asserted because a finding
    // that says "somewhere in the engine" is a finding somebody has to
    // reproduce before they can act on it.
    const root = cleanTree();
    write(
      root,
      'packages/rules-engine/src/floor.ts',
      "import { readFileSync } from 'node:fs';\nexport const floorAt = (): string => readFileSync('x', 'utf8');\n",
    );
    const out = findings('RI-07', root).join('\n');
    expect(out).toContain('node:fs');
    expect(out).toContain('Reached by: packages/rules-engine/src/index.ts');
  });

  test('RI-07 catches a bare specifier that is not a builtin', () => {
    const root = cleanTree();
    write(
      root,
      'packages/rules-engine/src/floor.ts',
      "import Decimal from 'decimal.js';\nexport const floorAt = (n: number): number => new Decimal(n).toNumber();\n",
    );
    const out = findings('RI-07', root).join('\n');
    expect(out).toContain('decimal.js');
    expect(out).toContain('neither relative nor a Node builtin');
  });

  test('RI-07 reports a relative import that resolves to nothing rather than skipping it', () => {
    // The direction matters. A walk that silently skipped what it could not
    // resolve would report PASS for a subgraph it never read, which is rule 1
    // of this runner: never weaken a check to pass it.
    const root = cleanTree();
    write(
      root,
      'packages/rules-engine/src/index.ts',
      "export { floorAt } from './floor.js';\nexport { gone } from './not-here.js';\n",
    );
    expect(findings('RI-07', root).join('\n')).toContain('resolves to no file on disk');
  });

  test('RI-07 does not report a specifier that appears only inside a comment', () => {
    // These files carry more prose than code and their headers quote real
    // import lines while explaining them. A check that read those as imports
    // would fail on the tree it is meant to protect, so the clean direction
    // needs this stated as its own case rather than left to the whole-repo run.
    const root = cleanTree();
    write(
      root,
      'packages/rules-engine/src/floor.ts',
      "// This module must never `import { readFileSync } from 'node:fs'`.\n" +
        "/* Nor `import Decimal from 'decimal.js'`, for INV-02's reason. */\n" +
        'export const floorAt = (n: number): number => n;\n',
    );
    expect(findings('RI-07', root)).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// Rule 2 of the runner: a check that cannot run is not a check that passed
// -----------------------------------------------------------------------------
describe('a check that cannot reach its inputs throws rather than passing', () => {
  test.each([
    ['RI-01', 'packages/rules-engine/package.json'],
    ['RI-03', 'vitest.config.ts'],
    ['RI-05', '.nvmrc'],
    ['RI-07', 'packages/rules-engine/src/index.ts'],
  ])('%s throws when %s is gone', (id, input) => {
    const root = cleanTree();
    renameSync(join(root, input), join(root, `${input}.moved`));
    expect(() => findings(id, root)).toThrow(/cannot run/);
  });

  test('RI-01 throws when the workspace resolves no packages', () => {
    const root = cleanTree();
    write(root, 'pnpm-workspace.yaml', 'packages:\n');
    expect(() => findings('RI-01', root)).toThrow(/claims no packages/);
  });

  test('RI-07 throws when the graph walk reaches only the entry point', () => {
    // THE FAILURE MODE THIS GUARDS IS THE CHECK ITSELF BREAKING SILENTLY. If the
    // specifier scan stopped matching -- a regex edit, a syntax this file does
    // not parse -- RI-07 would walk one file, find no imports, and report PASS
    // about a thirteen-module package it never read. Reaching one file is
    // therefore an ERROR and not a clean result.
    const root = cleanTree();
    write(root, 'packages/rules-engine/src/index.ts', 'export const nothing = 1;\n');
    expect(() => findings('RI-07', root)).toThrow(/walked 1 file/);
  });
});

// -----------------------------------------------------------------------------
// The helper the two above depend on
// -----------------------------------------------------------------------------
test('needle assembles a pattern without spelling it', () => {
  // Both the pattern AND the subject are assembled. Writing the subject out was
  // the first version of this case, and it made THIS FILE a finding of RI-02
  // when the check ran against the real repository. The check was right and the
  // test was wrong, which is the direction that keeps a check trustworthy.
  const spelled = 'cover' + 'ageThreshold: 90';
  expect(needle('cover', 'ageThreshold').test(spelled)).toBe(true);
  expect(needle('cover', 'ageThreshold').test('coverage is reported as a trend')).toBe(false);
});
