import { mkdirSync, mkdtempSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import {
  CHECKS,
  COVERAGE_NEEDLES,
  DB_ADMITTED,
  DEPLOYABLES,
  REPO_ROOT,
  SURFACE_OWNER,
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
  write(root, 'packages/rules-engine/src/index.ts', "export { floorAt } from './floor.ts';\n");
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
  // RI-09'S INPUT, AND IT IS THE FIXTURE'S OWN VOCABULARY RATHER THAN A COPY OF
  // THE REPOSITORY'S. The check parses `BASE_PATH` and `OPERATOR_PREFIXES` out
  // of whatever `apps/<owner>/src/surface.ts` the tree it is given holds, which
  // is what keeps the two lists in one place; the case below that rewrites this
  // file and watches the finding follow is what proves that rather than
  // asserting it. The spelling here matches the real one so the seeded cases
  // read like the defect they stand for.
  write(
    root,
    `apps/${SURFACE_OWNER}/src/surface.ts`,
    "export const BASE_PATH = '/api/v1';\n" +
      "export const OPERATOR_PREFIXES = ['/admin', '/internal'] as const;\n",
  );
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
      "export { floorAt } from './floor.ts';\nexport { x } from '../impure/io.ts';\n",
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
      "export { floorAt } from './floor.ts';\nexport { gone } from './not-here.ts';\n",
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

  // ---------------------------------------------------------------------------
  // RI-08, AND THE SEED IS ADR-096's OWN, WATCHED FAILING HERE AND ON THE TREE
  // ---------------------------------------------------------------------------
  // The entry measured the hole with a line it wrote into `apps/site/package.json`
  // and four commands that stayed green over it. The first case is that line.
  //
  // The three after it are the three readings of "resolves to the accessor",
  // because `spec.includes('@merit/db')` was the shape to beat: it reports
  // `@merit/dbtools` and it cannot see `link:../../packages/db`, where neither
  // the key nor the specifier writes the name down at all.
  //
  // THE `packages/queue` CASE IS THE WIDENED SCOPE, PROVEN RATHER THAN CLAIMED.
  // ADR-096 section 9 calls it "the second instance" and says an RI-08 covering
  // both is the better version; ADR-095 section 9 item 5b says the apps/site-only
  // scope does not reach `apps/portal` either. A check scoped to two names would
  // pass this case, which is what makes it worth a test rather than a sentence.
  const siteWith = (root: string, deps: Record<string, string>): void =>
    write(
      root,
      'apps/site/package.json',
      JSON.stringify({ name: '@merit/site', dependencies: deps }),
    );

  test("RI-08 catches ADR-096's own seed, the accessor declared by the marketing site", () => {
    const root = cleanTree();
    siteWith(root, { '@merit/db': 'workspace:*' });
    const out = findings('RI-08', root).join('\n');
    expect(out).toContain('apps/site/package.json: dependencies.@merit/db');
    expect(out).toContain('names it directly');
  });

  test('RI-08 catches the accessor aliased under another key', () => {
    const root = cleanTree();
    siteWith(root, { db: 'workspace:@merit/db@*' });
    expect(findings('RI-08', root).join('\n')).toContain('aliases it as `db`');
  });

  test('RI-08 catches the accessor linked by PATH, which writes no package name', () => {
    // The one form where neither the key nor the specifier spells `@merit/db`,
    // so a name test of any kind is blind to it and only resolution finds it.
    const root = cleanTree();
    siteWith(root, { db: 'link:../../packages/db' });
    expect(findings('RI-08', root).join('\n')).toContain('links its directory as `db`');
  });

  test('RI-08 reads all four dependency fields, not just `dependencies`', () => {
    const root = cleanTree();
    write(
      root,
      'apps/site/package.json',
      JSON.stringify({
        name: '@merit/site',
        devDependencies: { '@merit/db': 'workspace:*' },
        optionalDependencies: { db: 'npm:@merit/db@0.0.0' },
      }),
    );
    const out = findings('RI-08', root);
    expect(out).toHaveLength(2);
    expect(out.join('\n')).toContain('devDependencies.@merit/db');
    expect(out.join('\n')).toContain('optionalDependencies.db');
  });

  test('RI-08 catches packages/queue, which an apps/site-scoped check would not', () => {
    const root = cleanTree();
    write(
      root,
      'packages/queue/package.json',
      JSON.stringify({ name: '@merit/queue', dependencies: { '@merit/db': 'workspace:*' } }),
    );
    expect(findings('RI-08', root).join('\n')).toContain('packages/queue/package.json');
  });

  test('RI-08 does NOT refuse a package whose name merely starts with the accessor name', () => {
    // The substring trap, and the reason the alias target is PARSED rather than
    // searched for. `@merit/dbtools` is a different package by every reading.
    const root = cleanTree();
    write(root, 'packages/dbtools/package.json', JSON.stringify({ name: '@merit/dbtools' }));
    siteWith(root, { '@merit/dbtools': 'workspace:*', '@merit/rules-engine': 'workspace:*' });
    expect(findings('RI-08', root)).toEqual([]);
  });

  test('RI-08 does NOT read the accessor package against itself', () => {
    // RI-09's `if (app === SURFACE_OWNER) continue`, one register over. The
    // owner of a thing is not a consumer of it, and the exemption is derived
    // from the name on disk rather than written down here.
    const root = cleanTree();
    write(
      root,
      'packages/db/package.json',
      JSON.stringify({ name: '@merit/db', devDependencies: { '@merit/db': 'workspace:*' } }),
    );
    expect(findings('RI-08', root)).toEqual([]);
  });

  test('RI-08 admits a package that is named in DB_ADMITTED, and only that one', () => {
    // THE BRANCH THE EMPTY LIST NEVER EXERCISES. `apps/api` is the name expected
    // to join first (ADR-109: "whether apps/api gets @merit/db ... does not
    // here"), so the day it does, this is the behaviour it gets. The list is
    // restored in `finally` because it is module state shared with every other
    // case in this file.
    const root = cleanTree();
    write(
      root,
      'apps/api/package.json',
      JSON.stringify({ name: '@merit/api', dependencies: { '@merit/db': 'workspace:*' } }),
    );
    siteWith(root, { '@merit/db': 'workspace:*' });
    DB_ADMITTED.push('@merit/api');
    try {
      const out = findings('RI-08', root);
      expect(out).toHaveLength(1);
      expect(out.join('\n')).toContain('apps/site/package.json');
    } finally {
      DB_ADMITTED.length = 0;
    }
  });

  // ---------------------------------------------------------------------------
  // RI-10, AND BOTH DIRECTIONS ARE SEEDED BECAUSE BOTH HAPPENED ON 2026-08-25
  // ---------------------------------------------------------------------------
  // The first case is the defect as it lived here: 686 specifiers wrote `./x.js`
  // for files that are `x.ts`, every deployable died on its own first relative
  // import with ERR_MODULE_NOT_FOUND, and typecheck, lint, gates and the whole
  // Vitest suite were green throughout. RI-07 walked the same graph and passed,
  // because `resolveRelative` maps `.js` onto `.ts` on purpose.
  //
  // The second case is the direction the REPAIR got wrong, and it matters as
  // much: three of those 686 sites named a real `.js` file, because
  // packages/eslint-plugin-merit/index.js is genuine JavaScript. A check that
  // only looked for `.js` specifiers would have blessed the broken repair.
  test('RI-10 catches a `.js` specifier naming a file that is `.ts`', () => {
    const root = cleanTree();
    write(root, 'packages/db/src/thing.ts', 'export const thing = 1;\n');
    write(
      root,
      'packages/db/src/uses-it.ts',
      "import { thing } from './thing.js';\nexport { thing };\n",
    );
    const out = findings('RI-10', root).join('\n');
    expect(out).toContain('packages/db/src/uses-it.ts');
    expect(out).toContain('`./thing.js` names no file');
    expect(out).toContain('packages/db/src/thing.ts is what is there');
  });

  test('RI-10 catches the reverse: a `.ts` specifier naming a file that is genuinely `.js`', () => {
    const root = cleanTree();
    write(root, 'packages/db/src/legacy.js', 'export const legacy = 1;\n');
    write(
      root,
      'packages/db/src/uses-legacy.ts',
      "import { legacy } from './legacy.ts';\nexport { legacy };\n",
    );
    const out = findings('RI-10', root).join('\n');
    expect(out).toContain('packages/db/src/uses-legacy.ts');
    expect(out).toContain('`./legacy.ts` names no file');
  });

  test('RI-10 does NOT refuse a bare specifier, which resolves through package exports', () => {
    const root = cleanTree();
    write(root, 'packages/db/src/bare.ts', "import { z } from 'drizzle-orm';\nexport { z };\n");
    expect(findings('RI-10', root)).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // RI-10's SCOPE, AND THE WIDENING IS SEEDED BECAUSE THE `src/` LINE WAS BLIND
  // ---------------------------------------------------------------------------
  // ADR-121. `scripts/` joined the scope after the `src/` line let 19 broken
  // specifiers sit in `scripts/demo/` while every gate in the repository stayed
  // green, `node --experimental-strip-types scripts/demo/main.ts` died with
  // ERR_MODULE_NOT_FOUND, and nightly.yml ran the directory anyway.
  //
  // THE FIRST CASE IS THE SEEDED VIOLATION and it is the whole point: without
  // the widening it returns nothing, which is the state this ADR ended.
  //
  // THE SECOND IS THE NEAR MISS THAT MUST NOT FIRE, and it matters as much. The
  // test ruling survives the widening: `scripts/demo/test/` holds Vitest suites,
  // Vitest resolves the tolerant way, and a `.js` specifier there is not a
  // runtime defect. A widening that swallowed the ruling would be a different
  // check wearing this one's name.
  //
  // THE THIRD IS THE OTHER DIRECTION UNDER THE NEW SCOPE: a specifier naming a
  // real `.js` file in `scripts/` passes, because the file is there. Session
  // 148's blanket rewrite broke `packages/eslint-plugin-merit/index.js` and this
  // is that lesson pointed at the directory that just joined.
  test('RI-10 reaches scripts/, which the `src/` scope could not see', () => {
    const root = cleanTree();
    write(root, 'scripts/demo/thing.ts', 'export const thing = 1;\n');
    write(root, 'scripts/demo/main.ts', "import { thing } from './thing.js';\nexport { thing };\n");
    const out = findings('RI-10', root).join('\n');
    expect(out).toContain('scripts/demo/main.ts');
    expect(out).toContain('`./thing.js` names no file');
    expect(out).toContain('scripts/demo/thing.ts is what is there');
  });

  test('RI-10 still exempts tests after the widening, including under scripts/', () => {
    const root = cleanTree();
    write(root, 'scripts/demo/thing.ts', 'export const thing = 1;\n');
    write(
      root,
      'scripts/demo/test/thing.test.ts',
      "import { thing } from '../thing.js';\nexport { thing };\n",
    );
    expect(findings('RI-10', root)).toEqual([]);
  });

  test('RI-10 does NOT refuse a scripts/ specifier naming a file that is genuinely `.js`', () => {
    const root = cleanTree();
    write(root, 'scripts/demo/hook.js', 'export const hook = 1;\n');
    write(root, 'scripts/demo/uses-hook.ts', "import { hook } from './hook.js';\nexport { hook };\n");
    expect(findings('RI-10', root)).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // RI-09, AND THE FIRST TWO CASES ARE THE RULING (ADR-098) STATED AS A TEST
  // ---------------------------------------------------------------------------
  // ADR-095's approval clause is a path and four green commands: seed
  // `apps/portal/src/app/api/v1/admin/payouts/route.ts` and nothing in the
  // estate refuses it. The first case is that exact path and demands a finding.
  // The second is the direction a check written carelessly gets wrong, and it
  // matters more: `apps/api` OWNS this surface, so a route there must pass. A
  // check that refused both would be unusable the day P4-d writes the first
  // handler, and nobody would find that out until then.
  test("RI-09 catches ADR-095's own seed, an operator route inside a UI deployable", () => {
    const root = cleanTree();
    write(
      root,
      'apps/portal/src/app/api/v1/admin/payouts/route.ts',
      'export function GET(): Response { return new Response("{}"); }\n',
    );
    const out = findings('RI-09', root).join('\n');
    expect(out).toContain('apps/portal/src/app/api/v1/admin/payouts/route.ts');
    expect(out).toContain('spells `/api/v1/admin` inside apps/portal');
  });

  test('RI-09 does NOT refuse the same route under the deployable that owns the surface', () => {
    const root = cleanTree();
    write(
      root,
      `apps/${SURFACE_OWNER}/src/app/api/v1/admin/payouts/route.ts`,
      'export function GET(): Response { return new Response("{}"); }\n',
    );
    write(
      root,
      `apps/${SURFACE_OWNER}/src/routes/admin/payouts.ts`,
      'export const payouts = (): string => "ok";\n',
    );
    expect(findings('RI-09', root)).toEqual([]);
  });

  test('RI-09 does NOT refuse an api directory that is not below a routing root', () => {
    // `apps/portal/src/api/types.ts` EXISTS ON MAIN and is the portal's
    // TRANSCRIPTION of the wire types -- ADR-083 section 3 cites it as evidence
    // the portal is on the far side of the boundary, so a check that refused it
    // would refuse the thing the ruling holds up as correct. It is `src/api`,
    // not `app/api`, and the difference is exactly the framework's.
    const root = cleanTree();
    write(root, 'apps/portal/src/api/types.ts', 'export type Money = { cents: number };\n');
    expect(findings('RI-09', root)).toEqual([]);
  });

  test('RI-09 catches an operator route that does not carry the base path', () => {
    // App Router serves `app/internal/jobs/route.ts` at `/internal/jobs`. The
    // base-path shape cannot see this one, which is why there is more than one.
    const root = cleanTree();
    write(
      root,
      'apps/site/src/app/internal/jobs/route.ts',
      'export function GET(): Response { return new Response("{}"); }\n',
    );
    expect(findings('RI-09', root).join('\n')).toContain(
      'puts `internal` directly below the routing root `app` in apps/site',
    );
  });

  test('RI-09 sees through a route group, which the URL does not carry', () => {
    // `(ops)` is invisible in the URL, so a naive "the segment under the
    // routing root" test reads `(ops)` and finds nothing. Skipping it makes the
    // check catch MORE, which is the only direction a skip may run in here.
    const root = cleanTree();
    write(
      root,
      'apps/site/src/app/(ops)/admin/payouts/route.ts',
      'export function GET(): Response { return new Response("{}"); }\n',
    );
    expect(findings('RI-09', root).join('\n')).toContain('`admin` directly below the routing root');
  });

  test('RI-09 catches a Pages Router api directory with no version segment', () => {
    const root = cleanTree();
    write(root, 'apps/portal/src/pages/api/hello.ts', 'export default (): null => null;\n');
    expect(findings('RI-09', root).join('\n')).toContain(
      'an API surface inside a UI deployable by',
    );
  });

  test("RI-09 reads the tree's OWN operator prefixes rather than a copy of them", () => {
    // THE CASE THAT PROVES THE TWO LISTS ARE ONE LIST. A third prefix in
    // surface.ts must move the check without an edit here; if this file held
    // its own `['/admin', '/internal']`, the two would drift silently and the
    // drift is the entire failure mode RI-09 exists inside.
    const root = cleanTree();
    write(
      root,
      `apps/${SURFACE_OWNER}/src/surface.ts`,
      "export const BASE_PATH = '/api/v1';\n" +
        "export const OPERATOR_PREFIXES = ['/admin', '/internal', '/ops'] as const;\n",
    );
    write(
      root,
      'apps/portal/src/app/ops/route.ts',
      'export function GET(): Response { return new Response("{}"); }\n',
    );
    expect(findings('RI-09', root).join('\n')).toContain('`/ops` is an OPERATOR_PREFIXES entry');
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
    ['RI-08', 'packages/db/package.json'],
    ['RI-09', `apps/${SURFACE_OWNER}/src/surface.ts`],
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

  test('RI-09 throws when OPERATOR_PREFIXES parses to nothing', () => {
    // THE DIRECTION THAT MATTERS. An empty prefix list would make RI-09 report
    // PASS while asserting nothing at all about the operator surface, which is
    // the half it was written for -- and it is the same shape as RI-04
    // reporting PASS about a deployable its literal did not name.
    const root = cleanTree();
    write(root, `apps/${SURFACE_OWNER}/src/surface.ts`, "export const BASE_PATH = '/api/v1';\n");
    expect(() => findings('RI-09', root)).toThrow(/cannot run/);
  });

  // RI-08's TWO GUARDS ARE ABOUT THE ADMISSION LIST AND NOT ABOUT A MISSING
  // FILE, because that list is the direction the check gets weakened in. Nobody
  // deletes an invariant; somebody admits one more package each time one is
  // inconvenient, and the check keeps reporting PASS about a workspace it has
  // exempted. Both cases restore the list in `finally`: it is module state.
  test('RI-08 throws on an admission naming a package that does not exist', () => {
    const root = cleanTree();
    DB_ADMITTED.push('@merit/gone');
    try {
      expect(() => findings('RI-08', root)).toThrow(/cannot run/);
    } finally {
      DB_ADMITTED.length = 0;
    }
  });

  test('RI-08 throws when the admission list covers every package', () => {
    // The end state of one admission at a time. A green result here would mean
    // "no package outside the list declares the accessor" over an empty
    // remainder, which is RI-04 reporting PASS about a deployable its literal
    // did not name, and RI-09 reporting PASS with no operator prefixes.
    const root = cleanTree();
    for (const app of DEPLOYABLES) DB_ADMITTED.push(`@merit/${app}`);
    DB_ADMITTED.push('@merit/rules-engine');
    try {
      expect(() => findings('RI-08', root)).toThrow(/asserting nothing/);
    } finally {
      DB_ADMITTED.length = 0;
    }
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
