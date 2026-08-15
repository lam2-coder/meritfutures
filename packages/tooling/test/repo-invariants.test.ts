import { mkdirSync, mkdtempSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { CHECKS, COVERAGE_NEEDLES, REPO_ROOT, needle } from '../checks/repo-invariants.mjs';

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
  for (const app of ['site', 'portal', 'admin', 'worker']) {
    write(root, `apps/${app}/package.json`, JSON.stringify({ name: `@merit/${app}` }));
  }
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
});

// -----------------------------------------------------------------------------
// Rule 2 of the runner: a check that cannot run is not a check that passed
// -----------------------------------------------------------------------------
describe('a check that cannot reach its inputs throws rather than passing', () => {
  test.each([
    ['RI-01', 'packages/rules-engine/package.json'],
    ['RI-03', 'vitest.config.ts'],
    ['RI-05', '.nvmrc'],
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
