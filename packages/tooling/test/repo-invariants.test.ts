import { mkdirSync, mkdtempSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import {
  CHECKS,
  COVERAGE_NEEDLES,
  clearingConditionPairs,
  DB_ADMITTED,
  DEPLOYABLES,
  REPO_ROOT,
  SURFACE_OWNER,
  needle,
} from '../checks/repo-invariants.mjs';
import { SUBJECTS } from '../checks/response-shape-copies.mjs';

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

/**
 * Run `fn` with `DB_ADMITTED` temporarily holding `names`, then RESTORE WHAT
 * SHIPPED rather than emptying it.
 *
 * THE `finally { DB_ADMITTED.length = 0 }` THESE CASES USED TO WRITE WAS
 * CORRECT ONLY WHILE THE LIST WAS EMPTY, and ADR-120 made it a list with a
 * member. Clearing to empty is not a restore: it is a mutation that happened to
 * agree with the shipped value, and the day it stopped agreeing every case after
 * it in this file would have run against an admission list the repository does
 * not have. That is the same class as RI-04's second copy -- a fixture that goes
 * stale in step with the thing it is testing -- arriving inside a `finally`.
 */
function withDbAdmitted<T>(names: readonly string[], fn: () => T): T {
  const shipped = [...DB_ADMITTED];
  DB_ADMITTED.length = 0;
  DB_ADMITTED.push(...names);
  try {
    return fn();
  } finally {
    DB_ADMITTED.length = 0;
    DB_ADMITTED.push(...shipped);
  }
}

const seeded: string[] = [];
afterEach(() => {
  for (const dir of seeded.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const write = (root: string, rel: string, body: string): void => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), body);
};

/**
 * The packages the fixture declares, in ONE place.
 *
 * The RI-08 case below builds "every package in this workspace" from this list
 * rather than from a second copy of it, on the rule the fixture's own RI-04
 * comment states: a fixture that maintains its own copy of the thing under test
 * goes stale in step with it and cannot fail.
 */
const FIXTURE_PACKAGES = ['rules-engine', 'db', 'ledger'] as const;

/** A file of `n` lines carrying each name on its own one-based line. */
const linesNaming = (n: number, at: Readonly<Record<number, string>>): string =>
  Array.from({ length: n }, (_, i) => {
    const name = at[i + 1];
    return name === undefined ? '//' : `export function ${name}(): void {}`;
  })
    .join('\n')
    .concat('\n');

/** A tree that satisfies every invariant, which each case then breaks in one way. */
function cleanTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'merit-invariants-'));
  seeded.push(root);

  write(root, 'pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n  - 'packages/*'\n");
  write(root, '.nvmrc', '22\n');
  // RI-14 reads these files BY NAME, so the clean tree carries all of them with
  // reasons that are TRUE. A fixture missing one makes the rename guard fire on
  // every case, which is the guard working and the fixture wrong. That happened
  // twice while this check was written, both times caught by running it.
  write(
    root,
    'apps/api/test/wiring.test.ts',
    'const BLOCKED = {\n' +
      '  useRailBackend:\n' +
      "    'a vendor adapter this workspace does not ship, named in no package.json.',\n" +
      '};\n' +
      '// The gate reads `principal(request)` (`routes/admin-wallet.ts:538`).\n',
  );
  write(root, 'apps/api/src/idempotency.ts', '// The protocol over the store port.\n');
  write(root, 'apps/api/src/routes/wallet-withdrawals.ts', '// The external leg.\n');
  // RI-15 NAMES THREE MORE FILES BY NAME AND THE FIXTURE CARRIES ALL OF THEM,
  // for the reason stated above RI-14's three: a fixture missing one makes the
  // rename guard fire on every case, which is the guard working and the fixture
  // wrong. Each one carries a citation that is TRUE against this fixture, so the
  // clean direction is a real pass rather than an empty one.
  write(root, 'apps/api/src/idempotency-store.ts', 'export const databaseIdempotencyStore = 1;\n');
  write(root, 'apps/worker/src/detectors/fills.ts', linesNaming(1100, { 1059: 'martingale' }));
  // RI-16 READS docs/ AND ITS REGISTER NAMES TWO DOCUMENTS AND TWO SOURCE
  // FILES, so the fixture carries all four and reproduces all four registered
  // findings. THE REGISTER SHRINKS ONLY: an entry matching no finding is itself
  // a finding, so a fixture that omitted these would make RI-16 report four on
  // every case in this file -- the register working and the fixture wrong. That
  // is the same trap RI-14's three files and RI-15's six set twice while they
  // were being written.
  write(
    root,
    'apps/api/src/routes/payouts.ts',
    '// The store is `databaseIdempotencyStore` (`src/idempotency-store.ts:1`).\n' +
      '//\n'.repeat(399),
  );
  write(root, 'apps/worker/src/sweeps/ports.ts', '//\n'.repeat(250));
  write(
    root,
    'docs/plans/FOLD-01-phone-identity.md',
    '# FOLD-01\n\n## Evidence\n\n' +
      '| 3 | the vendor already buys phone footprint | `DECISIONS.md:483` |\n' +
      '| 4 | the store that exists | `databaseIdempotencyStore` ' +
      '(`apps/api/src/idempotency-store.ts:1`) |\n',
  );
  // AND THE FOUR THE IN-TOKEN NAME BINDING ADDED, which point from a plan into
  // `apps/admin/src/page.ts` and are each THIRTY lines short. The fixture
  // reproduces the drift at the same distance rather than at some other one, so
  // a case reads the register's own numbers back.
  write(
    root,
    'apps/admin/src/page.ts',
    Array.from({ length: 680 }, (_, i) => {
      const name = {
        249: 'assertNamesNoSubject',
        293: 'assertFloatIsNotReserve',
        421: 'buildLiabilityHome',
        660: 'renderLiabilityHome',
      }[i + 1];
      return name === undefined ? '//' : `export function ${name}(): void {}`;
    })
      .join('\n')
      .concat('\n'),
  );
  write(
    root,
    'docs/plans/WAVE-06-admin-console-transport.md',
    '# WAVE-06\n\n## The modules\n\n' +
      '| [`page.ts`](../../apps/admin/src/page.ts) | the liability home assembled ' +
      '([`buildLiabilityHome:391`](../../apps/admin/src/page.ts)), its line rendering ' +
      '([`renderLiabilityHome:630`](../../apps/admin/src/page.ts)), and two assertions: ' +
      '[`assertNamesNoSubject:219`](../../apps/admin/src/page.ts) and ' +
      '[`assertFloatIsNotReserve:263`](../../apps/admin/src/page.ts) |\n',
  );
  write(
    root,
    'docs/decisions/ALLOCATION.md',
    '# Number allocation\n\n## Reservations\n\n' +
      '| 164 | `PayoutTx.ledger` (`routes/payouts.ts:395`) is required, and the worker at ' +
      "`systemDb('nightly-batch')` (`sweeps/ports.ts:219`) already posts |\n" +
      '| 168 | `PayoutTx.ledger` is a required `LedgerTx` at `routes/payouts.ts:395` |\n',
  );
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
  for (const pkg of FIXTURE_PACKAGES) {
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
  // RI-15's REGISTER SHRINKS ONLY, so the fixture reproduces every one of its
  // eight entries. An entry matching nothing here would be a finding on EVERY
  // case in this file -- the guard working and the fixture wrong, which is the
  // trap RI-14's three files and the six-file list this check used to carry set
  // twice while they were being written. Each seed reproduces the REAL distance,
  // so a case reads the register's own numbers back rather than some other ones.
  write(root, 'apps/api/src/routes/admin-wallet.ts', linesNaming(700, { 601: 'principal' }));
  write(
    root,
    'apps/api/src/admin-source/index.ts',
    linesNaming(200, { 193: 'IMPLEMENTED_ADMIN_READS' }),
  );
  write(root, 'apps/api/src/routes/admin-reads.ts', linesNaming(900, { 853: 'handle' }));
  write(
    root,
    'packages/db/src/scoped-db.ts',
    linesNaming(800, { 543: 'update', 687: 'FilterTerm' }),
  );
  write(root, 'packages/ledger/src/posting.ts', linesNaming(300, { 232: 'entriesOf' }));
  write(
    root,
    'apps/admin/src/index.ts',
    '// [`IMPLEMENTED_ADMIN_READS:178`](../../api/src/admin-source/index.ts) is data.\n',
  );
  write(
    root,
    'apps/api/src/admin-source/flags.ts',
    '// D-01, D-04 and D-05 write `copy_cluster`, `news_window` and `martingale`\n' +
      '// (`detectors/fills.ts:505`, `:810`, `:1059`).\n',
  );
  for (const rel of ['apps/api/src/routes/admin-feed.ts', 'apps/api/test/admin-feed.test.ts']) {
    write(
      root,
      rel,
      '// `adminHandler` resolves `currentReadSource()` before it calls `spec.handle`\n' +
        '// (`admin-reads.ts:856`).\n',
    );
  }
  write(
    root,
    'apps/api/src/routes/webhooks-psp.ts',
    '// `firmTx.update` (`scoped-db.ts:720`) hardcodes `undefined` for its WHERE clause.\n',
  );
  write(
    root,
    'apps/api/test/admin-payouts.test.ts',
    '// A debit is positive, read off `entriesOf` at `packages/ledger/src/posting.ts:235`.\n',
  );
  write(
    root,
    'apps/api/test/db.test.ts',
    '// `atMost(value)` mints a frozen `FilterTerm` (`scoped-db.ts:662`).\n',
  );
  // RI-18'S THREE INPUTS, AND THE FIXTURE DECLARES EACH SHAPE THREE TIMES ON
  // PURPOSE. The check compares COPIES, so a fixture with one declaration would
  // make it throw its own non-vacuity guard on every case in this file -- the
  // guard working and the fixture wrong, which is the trap RI-14's, RI-15's and
  // RI-16's inputs each set once while they were being written.
  //
  // THE NAMES COME FROM `SUBJECTS` AND ARE NOT A SECOND COPY OF THEM, for the
  // reason `DEPLOYABLES` is read above rather than retyped: a fixture holding
  // its own list of what the check is about cannot fail when that list grows,
  // it goes stale in step.
  //
  // THE THREE COPIES SPELL THE SHAPE DIFFERENTLY ON PURPOSE: an `interface`
  // reaching a second declaration by reference, a `type` alias with
  // `ReadonlyArray<>` where the contract writes `Array<>` and the interface
  // writes `readonly []`, and no `readonly` at all in the document. The real
  // divergence this check exists for hides behind exactly those differences,
  // and three byte-identical copies would not tell a reader whether the parser
  // or a string comparison was doing the work.
  for (const subject of SUBJECTS) {
    write(
      root,
      'docs/architecture/API_CONTRACT.md',
      `### GET /admin/${subject}\n` +
        '```ts\n' +
        `type ${subject} = {\n` +
        '  as_of: string;\n' +
        '  nested: { cents: number };\n' +
        '  rows: Array<{ day: string }>;\n' +
        '};\n' +
        '```\n',
    );
    write(
      root,
      `apps/${SURFACE_OWNER}/src/routes/${subject}.ts`,
      `interface ${subject}Nested {\n  readonly cents: number;\n}\n` +
        `export interface ${subject} {\n` +
        '  readonly as_of: string;\n' +
        `  readonly nested: ${subject}Nested;\n` +
        '  readonly rows: readonly { readonly day: string }[];\n' +
        '}\n',
    );
    write(
      root,
      'apps/admin/src/api/types.ts',
      `export type ${subject} = {\n` +
        '  readonly as_of: string;\n' +
        '  readonly nested: { readonly cents: number };\n' +
        '  readonly rows: ReadonlyArray<{ readonly day: string }>;\n' +
        '};\n',
    );
  }
  // RI-19'S PAIR, AND THE FIXTURE STATES THE CONDITION TWICE ON PURPOSE. The
  // check compares a module's enumeration against the case that restates it, so
  // a fixture with one statement would make its non-vacuity guard throw on every
  // case in this file -- the guard working and the fixture wrong, which is the
  // trap RI-14's, RI-15's, RI-16's and RI-18's inputs each set once while they
  // were being written.
  //
  // THE SPELLING IS `B5`'s OWN, so the seeded cases below read like the defect
  // they stand for rather than like an alphabet. The module enumerates the three
  // terms and the case restates them in one sentence, which is exactly the shape
  // session 392 left on the real tree after it found the two statements carrying
  // two of three terms each.
  write(
    root,
    'apps/api/src/admin-source/blocked-read.ts',
    '// B9. The group is blocked and the condition is stated ONCE, here.\n' +
      '//\n' +
      '// **CLEARING CONDITION, ALL THREE TERMS:**\n' +
      '//   1. A `writeRuleState` IMPLEMENTATION lands.\n' +
      '//   2. A primary source declares the stored `engine_gates` ENCODING.\n' +
      '//   3. `eligible_next_7d` gains its `| null`.\n',
  );
  write(
    root,
    'apps/api/test/admin-source-blocked-read.test.ts',
    '// CLEARING CONDITION, ALL THREE TERMS: a `writeRuleState` implementation\n' +
      '// lands, AND a primary source declares the stored `engine_gates` ENCODING,\n' +
      '// AND `eligible_next_7d` gains its `| null`.\n',
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
    // THE BRANCH THAT WAS UNREACHABLE ON THE REAL TREE UNTIL ADR-120. `apps/api`
    // was the name ADR-109 expected to join first ("whether `apps/api` gets
    // `@merit/db` ... it does not here"), and session 232 is the slice whose
    // subject that admission is. The case is unchanged in substance: one
    // admitted package is exempt and the one beside it is still a finding, which
    // is the whole of what an admission buys.
    const root = cleanTree();
    write(
      root,
      'apps/api/package.json',
      JSON.stringify({ name: '@merit/api', dependencies: { '@merit/db': 'workspace:*' } }),
    );
    siteWith(root, { '@merit/db': 'workspace:*' });
    withDbAdmitted(['@merit/api'], () => {
      const out = findings('RI-08', root);
      expect(out).toHaveLength(1);
      expect(out.join('\n')).toContain('apps/site/package.json');
    });
  });

  // ---------------------------------------------------------------------------
  // THE SHIPPED LIST, WHICH EVERY CASE ABOVE IS BLIND TO
  // ---------------------------------------------------------------------------
  // Every seeded case runs against a synthetic tree, so all of them stay green if
  // `DB_ADMITTED` is emptied, widened, or filled with names that declare nothing.
  // The two below read the REPOSITORY, and they are the only assertions in this
  // file about the list as it ships.
  test('the shipped admission is doing work: the real tree is a finding without it', () => {
    // THE DIRECTION AN ADMISSION LIST FAILS IN IS SILENCE. With the list as it
    // ships RI-08 is clean over the whole workspace; with it emptied,
    // `apps/api/package.json` is exactly the finding ADR-117 section 4 promised
    // the manifest line would become, and ADR-120 is the second diff that
    // answered it.
    expect(findings('RI-08', REPO_ROOT)).toEqual([]);
    const out = withDbAdmitted([], () => findings('RI-08', REPO_ROOT).join('\n'));
    expect(out).toContain('apps/api/package.json: dependencies.@merit/db');
  });

  test('every admitted package really declares the accessor', () => {
    // A STALE ADMISSION IS THE SAME DEFECT AS A STALE NAME, ONE STEP LATER. The
    // check THROWS on an admission naming a package that does not exist, because
    // that reads as though the accessor is permitted somewhere it is not. An
    // admission naming a package that exists and declares nothing reads the same
    // way and throws nothing, so it is asserted here: a name earns its place by
    // being a package that actually reaches the trader database, and "we might
    // need it later" is the list joining itself.
    //
    // ASSERTED AS A PROPERTY OVER THE LIST AND NEVER AS A COPY OF IT. A second
    // spelling of `DB_ADMITTED` here would be RI-04's own defect (see
    // `cleanTree`), and six approval clauses in this corpus have drifted on an
    // enumeration while the ruling held every time.
    expect(DB_ADMITTED.length).toBeGreaterThan(0);
    const unadmitted = withDbAdmitted([], () => findings('RI-08', REPO_ROOT).join('\n'));
    for (const name of DB_ADMITTED) {
      expect(unadmitted).toContain(`${name} is not in DB_ADMITTED`);
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
    write(
      root,
      'scripts/demo/uses-hook.ts',
      "import { hook } from './hook.js';\nexport { hook };\n",
    );
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

  // ---------------------------------------------------------------------------
  // RI-14, seeded with THE ACTUAL SENTENCE, in both directions
  // ---------------------------------------------------------------------------
  // The seed is not invented. It is the reason `apps/api/test/wiring.test.ts`
  // carried on 2026-08-28, beside the export that refuted it, which is the state
  // the file was actually in while every gate reported green. A check watched
  // failing on a fabricated shape proves it recognises the shape; watched failing
  // on the sentence that got through proves it would have caught the thing.
  //
  // BOTH DIRECTIONS ON THE SAME FILE, for RI-13's reason: a case that only ever
  // plants a violation cannot tell a check that reads the refuted-marker from one
  // that fails every absence claim it sees.
  // BOTH exports, because the real tree has both and the distinction is the whole
  // reason this check cannot tell a type from its implementation: `IdempotencyStore`
  // is the interface in `idempotency.ts` and `databaseIdempotencyStore` is the
  // implementation in `idempotency-store.ts`. The false reason denied the second by
  // naming the first, and it is the first that a runner can look up.
  const STORE_EXPORT =
    'export interface IdempotencyStore { readonly find: () => void }\n' +
    'export function databaseIdempotencyStore(): IdempotencyStore {\n' +
    '  return null as never;\n' +
    '}\n';

  const FALSE_REASON =
    'const BLOCKED = {\n' +
    '  useWithdrawalBackend:\n' +
    "    'an `IdempotencyStore` implementation, which no file in this tree provides. ' +\n" +
    "    'The adapter returns UNWIRED_STORE for that arm deliberately.',\n" +
    '};\n';

  test('RI-14 catches the reason that actually got through, beside the export refuting it', () => {
    const root = cleanTree();
    write(root, 'apps/api/src/idempotency-store.ts', STORE_EXPORT);
    write(root, 'apps/api/test/wiring.test.ts', FALSE_REASON);
    expect(findings('RI-14', root).join('\n')).toContain(
      'the reason claims `IdempotencyStore` does not exist and the tree EXPORTS it',
    );
  });

  test('RI-14 goes quiet on the SAME file once the claim is marked as refuted', () => {
    // THE DIRECTION THE CHECK MUST NOT PUSH. The corrected file deliberately
    // QUOTES the false sentence rather than deleting it, because a false sentence
    // deleted leaves nothing for the next reader to check. If this case failed,
    // the check would be pressuring every correction into a deletion.
    const root = cleanTree();
    write(root, 'apps/api/src/idempotency-store.ts', STORE_EXPORT);
    write(
      root,
      'apps/api/test/wiring.test.ts',
      '// THE REASON THAT STOOD HERE WAS FALSE AND IS REPLACED RATHER THAN DELETED.\n' +
        '// It read: no implementation of `IdempotencyStore` exists in this tree.\n' +
        '// `databaseIdempotencyStore` has exported it since ADR-112.\n' +
        FALSE_REASON.replace('which no file in this tree provides', 'no driver for its edges'),
    );
    expect(findings('RI-14', root)).toEqual([]);
  });

  test('RI-14 does not fire on a thing that exists and cannot be CONSTRUCTED', () => {
    // ADR-172's finding 1 was TRUE: `usePayoutBackend` cannot be constructed at
    // all, because `PayoutTx.ledger` is a non-nullable `LedgerTx` no live door
    // satisfies. A check that failed that reason would be wrong, and it is the
    // nearest true claim to the false one, which is why it is asserted here.
    const root = cleanTree();
    write(root, 'apps/api/src/payouts.ts', 'export interface PayoutTx { readonly x: number }\n');
    write(
      root,
      'apps/api/test/wiring.test.ts',
      'const BLOCKED = {\n' +
        '  usePayoutBackend:\n' +
        "    'a door satisfying `PayoutTx`. It is declared and NO LIVE DEPLOYMENT CAN ' +\n" +
        "    'CONSTRUCT ONE, which is a fact about its ledger arm and not about its absence.',\n" +
        '};\n',
    );
    expect(findings('RI-14', root)).toEqual([]);
  });

  test('RI-14 reads a SHOUTED claim, which the first draft of it did not', () => {
    // THE GAP THAT WAS REAL. The first version of this check was case-sensitive
    // and a claim reading "No implementation of `IdempotencyStore` exists in this
    // tree" walked straight past it. This codebase shouts in its comments as a
    // house style, and the emphatic half is exactly where somebody states a claim
    // they are sure of, so a case-sensitive matcher reads the quiet half and skips
    // the half that matters.
    const root = cleanTree();
    write(root, 'apps/api/src/idempotency-store.ts', STORE_EXPORT);
    write(
      root,
      'apps/api/test/wiring.test.ts',
      'const BLOCKED = {\n' +
        '  useWithdrawalBackend:\n' +
        "    'NO IMPLEMENTATION OF `IdempotencyStore` EXISTS IN THIS TREE.',\n" +
        '};\n',
    );
    expect(findings('RI-14', root).join('\n')).toContain(
      'the reason claims `IdempotencyStore` does not exist',
    );
  });

  test('RI-14 fails loudly when the file it reads is renamed away', () => {
    // A check that names the files it reads is emptied by a rename, silently, and
    // then reports PASS forever. This is that failure made loud.
    const root = cleanTree();
    rmSync(join(root, 'apps/api/test/wiring.test.ts'));
    expect(findings('RI-14', root).join('\n')).toContain(
      'apps/api/test/wiring.test.ts does not exist',
    );
  });

  // ---------------------------------------------------------------------------
  // RI-15, seeded with THE ACTUAL POINTERS, in both directions
  // ---------------------------------------------------------------------------
  // The seeds are not invented. They are the four line citations
  // `apps/api/test/wiring.test.ts` carried on 2026-08-28, checked one by one
  // against the files they name and found to point at the wrong line. THE CLAIMS
  // HELD AT THEIR REAL LINES AND THE POINTERS DID NOT, which is why nothing
  // failed and why a reader who followed one concluded the reason was invented.
  //
  // All four were also restored into the REAL FILE on the real tree while this
  // check was written: three fire, at four sites, and the tree was restored byte
  // for byte after. The cases below are the same seeds against the synthetic
  // fixture, which is what makes them fast and their targets legible.

  /**
   * The file these cases write their reason into.
   *
   * NOT `wiring.test.ts` AND NOT `detectors/fills.ts` ANY MORE, and the reason
   * is the input set itself: RI-15 reads every source file this tree holds, so
   * a seed needs no particular one, and the files the REGISTER's eight entries
   * depend on then stay intact under every case below. A case that overwrote one
   * of them would turn the register's shrinks-only guard red for a reason that
   * has nothing to do with what the case is about.
   */
  const REASON = 'apps/api/src/reasons.ts';

  /** A file of `n` lines carrying `name` on line `at`, one-based. */
  const fileWithNameAt = (n: number, at: number, name: string): string =>
    Array.from({ length: n }, (_, i) =>
      i + 1 === at ? `export function ${name}(): void {}` : '//',
    )
      .join('\n')
      .concat('\n');

  test('RI-15 catches the pointer that was eighteen lines off, in the reason that replaced a false one', () => {
    const root = cleanTree();
    write(
      root,
      'apps/api/src/routes/wallet-withdrawals.ts',
      fileWithNameAt(1400, 1254, 'gateNoInFlight'),
    );
    write(
      root,
      REASON,
      'const BLOCKED = {\n' +
        '  useWithdrawalBackend:\n' +
        "    'both statuses are in `OPEN_WITHDRAWAL_STATUSES`, so `gateNoInFlight` ' +\n" +
        "    '(`routes/wallet-withdrawals.ts:1233`) would refuse that identity every later withdrawal.',\n" +
        '};\n',
    );
    expect(findings('RI-15', root).join('\n')).toContain(
      'cites `routes/wallet-withdrawals.ts:1233` for `gateNoInFlight` and `gateNoInFlight` is at ' +
        'apps/api/src/routes/wallet-withdrawals.ts:1254, 21 lines away',
    );
  });

  test('RI-15 goes quiet on the SAME entry once the pointer is corrected', () => {
    // THE DIRECTION THAT MATTERS AS MUCH AS THE OTHER. A case that only ever
    // plants a violation cannot tell a check that resolves a pointer from one
    // that fails every pointer it sees, and this check reads 57 citations in
    // `wiring.test.ts` alone.
    const root = cleanTree();
    write(
      root,
      'apps/api/src/routes/wallet-withdrawals.ts',
      fileWithNameAt(1400, 1254, 'gateNoInFlight'),
    );
    write(
      root,
      REASON,
      'const BLOCKED = {\n' +
        '  useWithdrawalBackend:\n' +
        "    'both statuses are in `OPEN_WITHDRAWAL_STATUSES`, so `gateNoInFlight` ' +\n" +
        "    '(`routes/wallet-withdrawals.ts:1254`) would refuse that identity every later withdrawal.',\n" +
        '};\n',
    );
    expect(findings('RI-15', root)).toEqual([]);
  });

  test('RI-15 reads a bare `:12` against the path cited above it', () => {
    // The corrected file writes the path once and continues with bare pointers,
    // and the defect this check exists for was written in that shape. A check
    // that skipped them would pass the thing it was written for.
    const root = cleanTree();
    write(
      root,
      'apps/api/src/routes/wallet-withdrawals.ts',
      fileWithNameAt(1400, 1254, 'gateNoInFlight'),
    );
    write(
      root,
      REASON,
      'const BLOCKED = {\n' +
        '  useWithdrawalBackend:\n' +
        "    'NOTHING drives `requested --> approved` (`routes/wallet-withdrawals.ts:57-60`), ' +\n" +
        "    'and so `gateNoInFlight` ' +\n" +
        "    '(`:1233`) would refuse that identity.',\n" +
        '};\n',
    );
    expect(findings('RI-15', root).join('\n')).toContain(
      'cites `routes/wallet-withdrawals.ts:1233`',
    );
  });

  test('RI-15 stays armed after a backtick used as an APOSTROPHE, which its first draft did not', () => {
    // THE BUG THAT WAS REAL, AND IT WAS SILENT. The first version paired
    // backticks from the start of the file. `wiring.test.ts:215` writes "the
    // engine`s own `RuleState`", using a backtick as an apostrophe, and ONE
    // stray backtick inverts every pairing after it: the check found no name
    // beside any of the three seeded pointers below it and reported PASS. A
    // check that cannot fail, hiding inside a check that can.
    const root = cleanTree();
    write(
      root,
      'apps/api/src/routes/wallet-withdrawals.ts',
      fileWithNameAt(1400, 1254, 'gateNoInFlight'),
    );
    write(
      root,
      REASON,
      'const BLOCKED = {\n' +
        '  usePayoutBackend:\n' +
        "    'whose `state` is the engine`s own `RuleState`.',\n" +
        '  useWithdrawalBackend:\n' +
        "    'so `gateNoInFlight` (`routes/wallet-withdrawals.ts:1233`) would refuse.',\n" +
        '};\n',
    );
    expect(findings('RI-15', root).join('\n')).toContain('for `gateNoInFlight`');
  });

  test('RI-15 reads a SHOUTED name, for the reason RI-14 reads a shouted claim', () => {
    const root = cleanTree();
    write(
      root,
      'apps/api/src/routes/wallet-withdrawals.ts',
      fileWithNameAt(1400, 1254, 'gateNoInFlight'),
    );
    write(
      root,
      REASON,
      'const BLOCKED = {\n' +
        "  useWithdrawalBackend: 'AND `GATENOINFLIGHT` (`routes/wallet-withdrawals.ts:1233`) REFUSES.',\n" +
        '};\n',
    );
    expect(findings('RI-15', root).join('\n')).toContain('for `GATENOINFLIGHT`');
  });

  test('RI-15 catches a path no file in this tree has', () => {
    const root = cleanTree();
    write(
      root,
      REASON,
      "const BLOCKED = { useRailBackend: 'the adapter (`routes/rail-vendor.ts:12`) is not shipped.' };\n",
    );
    expect(findings('RI-15', root).join('\n')).toContain(
      'cites `routes/rail-vendor.ts:12` and NO FILE IN THIS TREE has that path',
    );
  });

  test('RI-15 catches a pointer past the end of the file it names', () => {
    const root = cleanTree();
    write(
      root,
      REASON,
      "const BLOCKED = { useStore: 'the store (`src/idempotency-store.ts:900`) exists.' };\n",
    );
    expect(findings('RI-15', root).join('\n')).toContain('has 2 lines');
  });

  test('RI-15 does not fire on a NEGATED claim, whose cited line must NOT hold the name', () => {
    // "`fills` HAS NO `identity_id` (`schema.ts:3005`)" cites the line the table
    // is DECLARED on, and the name must be absent from it. Asserting the inverse
    // is a second check and the existence half of it is RI-14's. This is the
    // shape that put three false findings on `detectors/fills.ts` before the
    // rule was written, and it is one of the two that keep this check quiet.
    const root = cleanTree();
    write(root, 'packages/db/src/schema.ts', fileWithNameAt(40, 20, 'fills'));
    write(
      root,
      REASON,
      '// The identity edge is on the `accounts` row below, because `fills` HAS NO\n' +
        '// `identity_id` (`packages/db/src/schema.ts:20`), and a canary carrying a\n' +
        '// column the table does not have is one a detector could find.\n',
    );
    expect(findings('RI-15', root)).toEqual([]);

    // AND THE SAME SENTENCE WITHOUT THE NEGATION FIRES, which is what keeps this
    // case from passing for some other reason. A quiet rule asserted only in the
    // quiet direction is indistinguishable from a binding that never happened.
    write(
      root,
      REASON,
      '// The identity edge is on the `accounts` row below, because `fills` carries\n' +
        '// `identity_id` (`packages/db/src/schema.ts:20`), and a canary carrying a\n' +
        '// column the table does not have is one a detector could find.\n',
    );
    expect(findings('RI-15', root).join('\n')).toContain('for `identity_id`');
  });

  test('RI-15 does not fire on a POSSESSIVE, which names a thing the pointer is not about', () => {
    // "`realized_pnl_cents` is `daily_marks`' (`schema.ts:652`)" cites the COLUMN
    // and names the TABLE. An apostrophe is not glue, so the binding is dropped
    // rather than guessed, and the citation is checked for resolution and range.
    const root = cleanTree();
    write(root, 'packages/db/src/schema.ts', fileWithNameAt(40, 20, 'realizedPnlCents'));
    write(
      root,
      REASON,
      "// `realized_pnl_cents` is `daily_marks`' (`packages/db/src/schema.ts:20`).\n",
    );
    expect(findings('RI-15', root)).toEqual([]);

    // AND THE SAME SENTENCE WITHOUT THE APOSTROPHE FIRES, for the reason above.
    write(
      root,
      REASON,
      '// `realized_pnl_cents` is on `daily_marks` (`packages/db/src/schema.ts:20`).\n',
    );
    expect(findings('RI-15', root).join('\n')).toContain('for `daily_marks`');
  });

  test('RI-15 says nothing about a citation with NO name beside it, which is its stated miss', () => {
    // THE HOLE, ASSERTED RATHER THAN LEFT TO BE DISCOVERED. This is the fourth
    // of the four false citations of 2026-08-28: `:1506` was a `.send({` and the
    // identity arm was at `:1527`, and the sentence carrying it says "the
    // identity arm this route presents", which names nothing a runner can look
    // up. The check is silent here and its `covers` says so.
    const root = cleanTree();
    write(
      root,
      'apps/api/src/routes/wallet-withdrawals.ts',
      fileWithNameAt(1600, 1527, 'identityScope'),
    );
    write(
      root,
      REASON,
      'const BLOCKED = {\n' +
        "  useWithdrawalBackend: 'it serves the identity arm this route presents " +
        "(`routes/wallet-withdrawals.ts:1506`).',\n" +
        '};\n',
    );
    expect(findings('RI-15', root)).toEqual([]);
  });

  test('RI-15 admits a pointer one line off and catches one three lines off', () => {
    // THE WINDOW, IN BOTH DIRECTIONS, AT ITS TWO BOUNDARIES. The widest TRUE
    // citation measured in this corpus is one line off, and the narrowest FALSE
    // one on record is three: `admin-writes.ts:266` for a declaration at `:269`.
    // A case that only asserted the catch could not tell this window from one of
    // zero, and a window of zero is a check nobody could keep green.
    const root = cleanTree();
    write(root, 'apps/api/src/routes/admin-writes.ts', fileWithNameAt(300, 269, 'principal'));
    const reason = (line: number): string =>
      'const BLOCKED = {\n' +
      `  useAdminWriteBackend: '\`principal(request)\` (\`routes/admin-writes.ts:${line}\`).',\n` +
      '};\n';

    write(root, REASON, reason(267));
    expect(findings('RI-15', root)).toEqual([]);

    write(root, REASON, reason(266));
    expect(findings('RI-15', root).join('\n')).toContain(
      'cites `routes/admin-writes.ts:266` for `principal` and `principal` is at ' +
        'apps/api/src/routes/admin-writes.ts:269, 3 lines away',
    );
  });

  test('RI-15 does not bind a name inside a token whose path it only GUESSED', () => {
    // THE BOUNDARY THE IN-TOKEN BINDING STOPS AT, and it is a measurement rather
    // than a preference. `detectors/fills.ts` writes ``the tier `M07:111` names``
    // two lines under a citation of `0008_risk.sql`, and `M07` is a PLAN and a
    // section line rather than a symbol in that migration. EVERY ONE OF THE
    // SEVEN prefixed tokens in this check's input is that shape -- five `M07`
    // and two `M20` -- and none is a symbol, so a name bound onto an INHERITED
    // path would be the check guessing a file and then guessing a name in it.
    const root = cleanTree();
    write(root, 'packages/db/src/schema.ts', fileWithNameAt(40, 20, 'fills'));
    write(
      root,
      'apps/api/src/idempotency.ts',
      '// `packages/db/src/schema.ts:20` is the reader.\n// The tier `M07:23` names.\n',
    );
    expect(findings('RI-15', root)).toEqual([]);

    // AND THE SAME INHERITED POINTER WITH THE NAME WRITTEN IN FRONT OF IT FIRES,
    // which is what keeps the silence above from passing because the file went
    // unread or the inheritance stopped resolving.
    write(
      root,
      'apps/api/src/idempotency.ts',
      '// `packages/db/src/schema.ts:20` is the reader.\n// The edge `fills` (`:23`) drifts.\n',
    );
    expect(findings('RI-15', root).join('\n')).toContain('for `fills`');
  });

  test('RI-15 reads a token whose prefix is a PATH as naming nothing', () => {
    // `admin-reads.ts:694` names the FILE it points into and no symbol in it, so
    // there is nothing for a runner to look up. The in-token binding takes the
    // prefix only where it is NOT a path, and this is that boundary.
    const root = cleanTree();
    write(root, 'packages/db/src/schema.ts', fileWithNameAt(40, 20, 'fills'));
    write(root, 'apps/api/src/idempotency.ts', '// The reader is `schema.ts:23`.\n');
    expect(findings('RI-15', root)).toEqual([]);
  });

  test('RI-15 survives the rename that used to empty it, and follows the file', () => {
    // THE DEFECT THAT MADE THIS INPUT SET DERIVED. A check that NAMES the files it
    // reads is emptied by a rename, silently, and then reports PASS forever;
    // session 351 found the softer half of the same thing, `routes/verify.ts`
    // carrying the same two drifted pointers as the copies this check flagged and
    // never read because nobody had typed its name. The set is the WALK now, so a
    // renamed file is still read and the finding follows it to its new path.
    const root = cleanTree();
    renameSync(
      join(root, 'apps/api/src/routes/webhooks-psp.ts'),
      join(root, 'apps/api/src/routes/webhooks-provider.ts'),
    );
    const found = findings('RI-15', root).join('\n');
    expect(found).toContain(
      'apps/api/src/routes/webhooks-provider.ts:1: cites `scoped-db.ts:720` for `update`',
    );
    // AND THE REGISTER ENTRY THAT NAMED THE OLD PATH NOW NAMES NOTHING, which is
    // the half that keeps a register from outliving its reason.
    expect(found).toContain(
      'apps/api/src/routes/webhooks-psp.ts: the register claims `scoped-db.ts:720`',
    );
  });

  test('RI-15 throws when the walk reaches no source file at all', () => {
    // THE DIRECTION A DERIVED SET FAILS IN, and it is RI-16's guard rather than a
    // new idea. A list goes stale LOUDLY the day one of its names is wrong; a
    // walk goes stale SILENTLY the day it stops reaching the tree, and then every
    // drifted pointer in it passes for the wrong reason. Zero is an ERROR.
    const root = cleanTree();
    rmSync(join(root, 'apps'), { recursive: true });
    rmSync(join(root, 'packages'), { recursive: true });
    rmSync(join(root, 'vitest.config.ts'));
    rmSync(join(root, 'eslint.config.js'));
    expect(() => findings('RI-15', root)).toThrow(/NO source file/);
  });

  // ---------------------------------------------------------------------------
  // RI-16, and every seed runs in BOTH directions
  // ---------------------------------------------------------------------------
  // The check reads 603 citations on the real tree and returns four findings, so
  // a case that only ever plants a violation cannot tell it from a check that
  // fails every pointer it sees. Each transition below is therefore asserted
  // twice: the defect fires, and the repaired or excluded form is silent.
  //
  // The seeds are the shapes the corpus actually writes. `M05:214` is a real
  // bare pointer out of `ALLOCATION.md` naming a PLAN and a section line, and
  // ``[`:1`](../../path.ts)`` is the real markdown-link shape whose path the
  // document states rather than the runner guessing it.

  /** A live document: a heading that names no date, so its body is in scope. */
  const liveDoc = (body: string): string => `# Notes\n\n## The seam\n\n${body}\n`;
  const LIVE_DOC = 'docs/architecture/NOTES.md';

  test('RI-16 catches a pointer past the end of the file it names', () => {
    const root = cleanTree();
    write(
      root,
      LIVE_DOC,
      liveDoc('The store is `databaseIdempotencyStore` (`apps/api/src/idempotency-store.ts:900`).'),
    );
    expect(findings('RI-16', root).join('\n')).toContain(
      'docs/architecture/NOTES.md:5: cites `apps/api/src/idempotency-store.ts:900` and ' +
        'apps/api/src/idempotency-store.ts has 2 lines',
    );
  });

  test('RI-16 goes quiet on the SAME sentence once the pointer is corrected', () => {
    const root = cleanTree();
    write(
      root,
      LIVE_DOC,
      liveDoc('The store is `databaseIdempotencyStore` (`apps/api/src/idempotency-store.ts:1`).'),
    );
    expect(findings('RI-16', root)).toEqual([]);
  });

  test('RI-16 catches a path no file in this tree has', () => {
    // THE FINDING IT ARRIVED WITH, IN THE SHAPE IT ARRIVED IN.
    // `docs/plans/FOLD-01-phone-identity.md` cites `DECISIONS.md:483`, and
    // `DECISIONS.md` is this corpus's NICKNAME for the ADR registry rather than
    // a file it has ever had. That one is registered; this is the same shape on
    // a document the register does not name.
    const root = cleanTree();
    write(root, LIVE_DOC, liveDoc('The adapter (`routes/rail-vendor.ts:12`) is not shipped.'));
    expect(findings('RI-16', root).join('\n')).toContain(
      'cites `routes/rail-vendor.ts:12` and NO FILE IN THIS TREE has that path',
    );
  });

  test('RI-16 admits a name two lines off and catches one three lines off', () => {
    // THE WINDOW, AT ITS TWO BOUNDARIES, because a case that only asserted the
    // catch could not tell this window from one of zero.
    const root = cleanTree();
    write(root, 'packages/db/src/schema.ts', fileWithNameAt(40, 20, 'fills'));
    const cite = (line: number): string =>
      liveDoc(`The canary reads \`fills\` (\`packages/db/src/schema.ts:${line}\`).`);

    write(root, LIVE_DOC, cite(22));
    expect(findings('RI-16', root)).toEqual([]);

    write(root, LIVE_DOC, cite(23));
    expect(findings('RI-16', root).join('\n')).toContain(
      'cites `packages/db/src/schema.ts:23` for `fills` and `fills` is at ' +
        'packages/db/src/schema.ts:20, 3 lines away',
    );
  });

  test('RI-16 reads a SHOUTED name, for the reason RI-14 reads a shouted claim', () => {
    // RI-14's first draft was case-sensitive and a shouted claim walked past it.
    // This corpus shouts in its documents as a house style, and a matcher that
    // reads the quiet half and skips the emphatic half skips the half where
    // somebody states a claim they are sure of.
    const root = cleanTree();
    write(root, 'packages/db/src/schema.ts', fileWithNameAt(40, 20, 'fills'));
    write(root, LIVE_DOC, liveDoc('**`FILLS`** (`packages/db/src/schema.ts:23`) IS THE EDGE.'));
    expect(findings('RI-16', root).join('\n')).toContain('for `FILLS`');
  });

  test('RI-16 says nothing under a DATED heading and says it under a plain one', () => {
    // THE EXCLUSION THAT MAKES THE CHECK POSSIBLE, ASSERTED IN BOTH DIRECTIONS,
    // and it is CI-06/derivable-counts' rule rather than this check's: an entry
    // headed with a date or a session number is a RECORD OF A MEASUREMENT MADE
    // THAT DAY, and repairing it would rewrite the record to say something it
    // did not say. A case that only planted the defect could not tell this rule
    // from a check that reads nothing at all.
    const root = cleanTree();
    const body =
      'The store is `databaseIdempotencyStore` (`apps/api/src/idempotency-store.ts:900`).';

    write(root, LIVE_DOC, `# Notes\n\n## The seam (2026-08-24)\n\n${body}\n`);
    expect(findings('RI-16', root)).toEqual([]);

    write(root, LIVE_DOC, `# Notes\n\n## Session 207: the seam\n\n${body}\n`);
    expect(findings('RI-16', root)).toEqual([]);

    write(root, LIVE_DOC, `# Notes\n\n## The seam\n\n${body}\n`);
    expect(findings('RI-16', root).join('\n')).toContain('has 2 lines');
  });

  test('RI-16 says nothing inside a fenced block', () => {
    // A worked example of this check's own finding is exactly what the document
    // explaining it would quote. CI-06t masks fences for the same reason.
    const root = cleanTree();
    const body =
      'The store is `databaseIdempotencyStore` (`apps/api/src/idempotency-store.ts:900`).';
    write(root, LIVE_DOC, liveDoc(`\`\`\`\n${body}\n\`\`\``));
    expect(findings('RI-16', root)).toEqual([]);

    // AND THE SAME SENTENCE OUTSIDE THE FENCE FIRES, for the reason every case
    // in this block is written twice: a silence asserted alone is
    // indistinguishable from a check that never looked.
    write(root, LIVE_DOC, liveDoc(body));
    expect(findings('RI-16', root).join('\n')).toContain('has 2 lines');
  });

  test('RI-16 does NOT inherit a path into a bare pointer, and reads the same line spelled out', () => {
    // THE ONE THING IT DISAGREES WITH RI-15 ABOUT, in both directions. `M05:214`
    // is a real bare pointer out of `ALLOCATION.md` and it names a PLAN and a
    // section line. Inheriting the path cited beside it turns it into a
    // citation of a file nobody wrote, which is the check guessing; all fifteen
    // findings inheritance adds inside this scope are that.
    const root = cleanTree();
    write(
      root,
      LIVE_DOC,
      liveDoc(
        'The store is `databaseIdempotencyStore` (`apps/api/src/idempotency-store.ts:1`), ' +
          'and the ladder is `M05:900`.',
      ),
    );
    expect(findings('RI-16', root)).toEqual([]);

    // AND THE SAME POINTER WITH THE PATH WRITTEN OUT FIRES, which is what keeps
    // this case from passing for some other reason.
    write(
      root,
      LIVE_DOC,
      liveDoc(
        'The store is `databaseIdempotencyStore` (`apps/api/src/idempotency-store.ts:1`), ' +
          'and the ladder is `apps/api/src/idempotency-store.ts:900`.',
      ),
    );
    expect(findings('RI-16', root).join('\n')).toContain('has 2 lines');
  });

  test('RI-16 takes the path a markdown LINK states, in both directions', () => {
    // THE HALF OF THE BARE-POINTER HOLE THAT CLOSES WITHOUT GUESSING. The
    // document states the path in the link; the runner does not infer it. This
    // is 130 of the 603 citations in scope, so a check that dropped them would
    // be reading three quarters of what it claims.
    const root = cleanTree();
    write(root, LIVE_DOC, liveDoc('The store is [`:1`](../../apps/api/src/idempotency-store.ts).'));
    expect(findings('RI-16', root)).toEqual([]);

    write(
      root,
      LIVE_DOC,
      liveDoc('The store is [`:900`](../../apps/api/src/idempotency-store.ts).'),
    );
    expect(findings('RI-16', root).join('\n')).toContain('has 2 lines');
  });

  test('RI-16 binds the name a citation carries INSIDE its own backticks', () => {
    // THE SHAPE MARKDOWN ACTUALLY WRITES, AND THE ONE THIS CHECK WAS BLIND TO.
    // `WAVE-06` section 4.1 carried
    // ``[`setAdminReadSource:706`](../../apps/api/src/routes/admin-reads.ts)``
    // against a declaration at :739 and RI-16 was GREEN on it. Seeded with
    // `:99999`, the same citation turned it RED, so the pointer WAS in scope and
    // the RANGE half worked; what did not reach it is the NAME half, which bound
    // only a backticked name written IN FRONT of the pointer. There is nothing in
    // front of this one, because the name is inside the pointer's own backticks.
    const root = cleanTree();
    write(root, 'packages/db/src/schema.ts', fileWithNameAt(40, 20, 'fills'));
    write(root, LIVE_DOC, liveDoc('The edge is [`fills:23`](../../packages/db/src/schema.ts).'));
    expect(findings('RI-16', root).join('\n')).toContain(
      'cites `../../packages/db/src/schema.ts:23` for `fills` and `fills` is at ' +
        'packages/db/src/schema.ts:20, 3 lines away',
    );

    // AND THE SAME CITATION REPOINTED IS SILENT, because a catch asserted alone
    // is indistinguishable from a check that fires on every token it can parse.
    write(root, LIVE_DOC, liveDoc('The edge is [`fills:20`](../../packages/db/src/schema.ts).'));
    expect(findings('RI-16', root)).toEqual([]);
  });

  test('RI-16 reads a token that names its own FILE as naming nothing', () => {
    // THE HALF THE IN-TOKEN BINDING MUST NOT TAKE. This corpus writes
    // ``[`EVENTS:396`](../architecture/EVENTS.md)`` for a pointer into a
    // DOCUMENT, and `EVENTS` there is the file rather than a symbol on line 396.
    // Binding it would assert that the line says "EVENTS", which the document
    // never claimed, and there are more pointers of that shape than of the other.
    const root = cleanTree();
    write(
      root,
      'docs/architecture/EVENTS.md',
      `# Events\n\n## Catalogue\n\n${'| a |\n'.repeat(40)}`,
    );
    write(root, LIVE_DOC, liveDoc('Section 11 opens at [`EVENTS:40`](./EVENTS.md).'));
    expect(findings('RI-16', root)).toEqual([]);

    // AND A PREFIX THAT IS NOT THAT FILE'S NAME BINDS, which is what keeps the
    // silence above from passing for the reason that nothing binds at all.
    write(root, LIVE_DOC, liveDoc('Section 11 opens at [`catalogueRow:40`](./EVENTS.md).'));
    expect(findings('RI-16', root).join('\n')).toContain('for `catalogueRow`');
  });

  test('RI-16 catches a register entry that no longer names a finding', () => {
    // THE REGISTER SHRINKS ONLY, which is CI-06u's rule about its own and the
    // difference between a register and an exemption list. The entry names the
    // repair the gate is waiting for; the day the repair lands, the entry has to
    // go with it, and this is what makes that happen rather than hoping for it.
    const root = cleanTree();
    write(
      root,
      'docs/plans/FOLD-01-phone-identity.md',
      liveDoc('The vendor buys phone footprint.'),
    );
    expect(findings('RI-16', root).join('\n')).toContain(
      'docs/plans/FOLD-01-phone-identity.md: the register claims `DECISIONS.md:483` is a known ' +
        'finding and it is not one on this ref',
    );
  });

  // ---------------------------------------------------------------------------
  // RI-13, and the seeds run in BOTH directions on the same entry
  // ---------------------------------------------------------------------------
  // The block is what an unsigned entry owes its reader, so the cases that matter
  // are the two transitions: an entry that lacks it must be a finding, and the
  // same entry with it added must be silent. A case that only ever plants a
  // violation cannot tell a check that recognises the block from a check that
  // returns a finding for every unsigned entry it sees.
  const UNSIGNED_ADR = [
    '## ADR-900: a ruling (2026-08-27, status: proposed)',
    '',
    '- **Decision:** the reading that costs a caller a narrowing is taken.',
    '',
    '### 4. Approval',
    '',
    '**Approval line: PENDING, UNSIGNED.** Not money path.',
    '',
  ].join('\n');

  const FOUNDER_BLOCK =
    '**What a founder read adds and this entry cannot.** The ruling picks one of ' +
    'two coherent readings and the other one is not absurd: it costs every caller ' +
    'a narrowing it would otherwise not write, and the cost lands forever on a ' +
    'path nobody revisits. Whether that price is right is the judgement.\n';

  test('RI-13 catches an unsigned ADR that never says what the founder must decide', () => {
    const root = cleanTree();
    write(root, 'docs/decisions/ADR-900.md', UNSIGNED_ADR);
    expect(findings('RI-13', root).join('\n')).toContain(
      'ADR-900.md: approval withheld at :7 and the entry carries no `What a founder read adds` block',
    );
  });

  test('RI-13 goes quiet on the SAME entry once the block is added', () => {
    const root = cleanTree();
    write(root, 'docs/decisions/ADR-900.md', `${UNSIGNED_ADR}\n${FOUNDER_BLOCK}`);
    expect(findings('RI-13', root)).toEqual([]);
  });

  test('RI-13 accepts "nothing here is a judgement" as the answer', () => {
    // THE DIRECTION THE CHECK MUST NOT PUSH. An entry that is pure transcription
    // against an approved document owes the founder no decision, and one forced to
    // fabricate a question is worse than one that had none: it spends a read on a
    // decision nobody has to make. The check reads the block's LENGTH, never its
    // meaning, which is exactly what makes this pass on the same terms as a
    // three-judgement answer.
    const root = cleanTree();
    const nothing =
      '**What a founder read adds and this entry cannot: nothing, and here is why.** ' +
      'Every clause is transcribed from an approved plan and the entry cites the line ' +
      'each came from. No reading was chosen, nothing was refused, and there is no ' +
      'alternative whose cost anybody had to weigh.\n';
    write(root, 'docs/decisions/ADR-900.md', `${UNSIGNED_ADR}\n${nothing}`);
    expect(findings('RI-13', root)).toEqual([]);
  });

  test('RI-13 catches the block used as a LABEL with nothing behind it', () => {
    // A grep for the marker alone would pass this, and it is the cheapest way to
    // make the check quiet: write the heading, answer nothing.
    const root = cleanTree();
    write(
      root,
      'docs/decisions/ADR-900.md',
      `${UNSIGNED_ADR}\n**What a founder read adds and this entry cannot.** Nothing much.\n`,
    );
    expect(findings('RI-13', root).join('\n')).toContain('and then says nothing');
  });

  test('RI-13 leaves an entry whose approval is GRANTED out of scope', () => {
    const root = cleanTree();
    write(
      root,
      'docs/decisions/ADR-900.md',
      UNSIGNED_ADR.replace('PENDING, UNSIGNED.', 'GRANTED 2026-08-27.'),
    );
    expect(findings('RI-13', root)).toEqual([]);
  });

  test('RI-13 reads a grant written DEEPER in the approval section than its first line', () => {
    // ADR-111 IS THE CASE, AND THE CHECK FAILED IT BEFORE THIS SEED EXISTED. Its
    // approval section opens by recording that the entry landed with no approval
    // line, runs a shell block whose comments start with `#`, and signs at the
    // bottom. Reading the section as ending at the first `#` inside the fence lost
    // the signature and reported a SIGNED entry as unsigned.
    const root = cleanTree();
    write(
      root,
      'docs/decisions/ADR-900.md',
      [
        '## ADR-900: a ruling (2026-08-27, status: accepted)',
        '',
        '### 4. The approval line, ADDED BY THE LOOP',
        '',
        '**This entry landed with no approval line and the log says UNSIGNED.**',
        '',
        '```',
        '# 1. what was verified at merge',
        'pnpm run verify   -> exit 0',
        '```',
        '',
        '**SIGNED ON DELEGATED AUTHORITY, 2026-08-27. Not money path.**',
        '',
      ].join('\n'),
    );
    expect(findings('RI-13', root)).toEqual([]);
  });

  test('RI-13 does NOT read a disposition out of prose about somebody else"s grant', () => {
    // THE OPPOSITE DIRECTION, AND IT IS THE ONE THAT FAILS SILENTLY. ADR-119 has
    // `**REFUSED**` in a table cell about an empty world and ADR-137 cites a
    // recommendation another entry GRANTED. Both are unsigned. A disposition read
    // from anywhere in the section drops them out of scope with nothing reported,
    // so a disposition is read only at the FRONT of a line, where a signature goes.
    const root = cleanTree();
    write(
      root,
      'docs/decisions/ADR-900.md',
      [
        '## ADR-900: a ruling (2026-08-27, status: proposed)',
        '',
        '### 4. Approval',
        '',
        '| 5 | An empty world | **REFUSED**, which is another entry"s sentence |',
        '',
        '- **The clause to read before signing is clause 1.** It says an item that',
        '  ADR-059 recommendation 3 GRANTED does not hold what its register says.',
        '',
        '- **Approval line: PENDING, UNSIGNED.** Not money path.',
        '',
      ].join('\n'),
    );
    expect(findings('RI-13', root).join('\n')).toContain('ADR-900.md: approval withheld at :10');
  });

  test('RI-13 leaves an entry carrying NO approval statement out of scope', () => {
    // THE DELIBERATE HOLE, AND IT IS IN `covers`. Thirty-one pre-FREEZE entries
    // record no approval at all. Reading their silence as "unsigned" would fail
    // them for a convention that did not exist when they were written, so an
    // unreadable status puts an entry out of scope rather than into a finding.
    const root = cleanTree();
    write(
      root,
      'docs/decisions/ADR-900.md',
      '## ADR-900: a ruling (2026-08-14, status: accepted)\n\n- **Decision:** a thing.\n',
    );
    expect(findings('RI-13', root)).toEqual([]);
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
  // exempted. Both cases go through `withDbAdmitted`, which restores what
  // SHIPPED rather than emptying the list: it is module state, and since
  // ADR-120 it is module state with a member in it.
  test('RI-08 throws on an admission naming a package that does not exist', () => {
    const root = cleanTree();
    withDbAdmitted(['@merit/gone'], () => {
      expect(() => findings('RI-08', root)).toThrow(/cannot run/);
    });
  });

  test('RI-08 throws when the admission list covers every package', () => {
    // The end state of one admission at a time. A green result here would mean
    // "no package outside the list declares the accessor" over an empty
    // remainder, which is RI-04 reporting PASS about a deployable its literal
    // did not name, and RI-09 reporting PASS with no operator prefixes.
    const root = cleanTree();
    const everybody = [
      ...DEPLOYABLES.map((app) => `@merit/${app}`),
      // Every fixture package but the accessor itself, which is what `admitted`
      // is a list of and therefore cannot be a member of.
      ...FIXTURE_PACKAGES.filter((pkg) => pkg !== 'db').map((pkg) => `@merit/${pkg}`),
    ];
    withDbAdmitted(everybody, () => {
      expect(() => findings('RI-08', root)).toThrow(/asserting nothing/);
    });
  });

  test('RI-16 throws when no tracked `.md` under docs/ is left to read', () => {
    // A check that names a TREE rather than a file is emptied by a move, and it
    // then reports PASS forever about a corpus it never opened.
    const root = cleanTree();
    rmSync(join(root, 'docs'), { recursive: true, force: true });
    expect(() => findings('RI-16', root)).toThrow(/cannot run/);
  });

  test('RI-16 throws when every citation falls out of scope', () => {
    // THE DIRECTION THAT FAILS SILENTLY, and it is the same shape as RI-09
    // reporting PASS with no operator prefixes. The record-heading rule holds
    // 2,288 of 2,950 path-bearing citations out of scope on the real tree, so a
    // rule that widened by accident would empty this check while it kept saying
    // PASS. Zero in scope is an ERROR, not a clean result.
    const root = cleanTree();
    for (const doc of [
      'docs/plans/FOLD-01-phone-identity.md',
      'docs/decisions/ALLOCATION.md',
      'docs/plans/WAVE-06-admin-console-transport.md',
    ]) {
      write(
        root,
        doc,
        `# D\n\n## The rows (2026-08-24)\n\nThe store (\`src/idempotency-store.ts:900\`).\n`,
      );
    }
    expect(() => findings('RI-16', root)).toThrow(/NO citation in scope/);
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

// -----------------------------------------------------------------------------
// RI-19, whose subject is the clearing-condition pattern itself
// -----------------------------------------------------------------------------
// EVERY SEED BELOW IS THE DEFECT THAT ACTUALLY HAPPENED OR ONE STEP FROM IT.
// `B5`'s condition was stated in `apps/api/src/admin-source/liability.ts` and in
// `apps/api/test/admin-source-liability.test.ts` WITH TWO OF ITS THREE TERMS
// EACH, and each statement was individually true, so four sessions in a row read
// a two-term condition off a three-term blocker. The first two cases are that
// defect in each of its two directions.
//
// THE LAST TWO CASES ARE THE REACH RATHER THAN THE CATCH. A check that claims
// more than it does is the defect class this corpus found four times on
// 2026-08-28, and adding a fifth inside the invariant written to prevent one
// would be a poor joke. What RI-19 does NOT see is asserted here, in the suite,
// where it cannot quietly stop being true.
describe('RI-19 binds the two statements of one clearing condition', () => {
  const CONDITION = 'apps/api/test/admin-source-blocked-read.test.ts';

  test('it catches the case dropping a term the module enumerates, which is `B5` exactly', () => {
    // SESSION 392's OWN PRE-REPAIR TEXT. The case named the `| null` and not the
    // `engine_gates` ENCODING; the module named the encoding and not the
    // `| null`. Neither named the other's second term and no control compared
    // them. This is the half a reader of the CASE would have been missing.
    const root = cleanTree();
    write(
      root,
      CONDITION,
      '// CLEARING CONDITION, ALL THREE TERMS: a `writeRuleState` implementation\n' +
        '// lands, AND `eligible_next_7d` gains its `| null`.\n',
    );
    const found = findings('RI-19', root);
    expect(found.join('\n')).toContain('term 2 of the condition');
    expect(found.join('\n')).toContain('NAMED NOWHERE IN THE CASE');
    // AND IT NAMES THE TERM BY ITS OWN IDENTIFIER, which is what makes the
    // finding actionable rather than a count that went red.
    expect(found.join('\n')).toContain('`engine_gates`');
  });

  test('it catches the case holding a term the module has dropped, the other direction', () => {
    const root = cleanTree();
    write(
      root,
      'apps/api/src/admin-source/blocked-read.ts',
      '// **CLEARING CONDITION, ALL TWO TERMS:**\n' +
        '//   1. A `writeRuleState` IMPLEMENTATION lands.\n' +
        '//   2. A primary source declares the stored `engine_gates` ENCODING.\n',
    );
    const found = findings('RI-19', root).join('\n');
    expect(found).toContain('the case names `eligible_next_7d`');
    expect(found).toContain('NO TERM OF THE MODULE CARRIES IT');
    // The count arm fires on the same seed and reports the disagreement from the
    // case's side, because the two statements now differ about how many terms
    // the blocker has. Both readings of one drift, which is the point.
    expect(found).toContain('says ALL THREE TERMS where');
  });

  test('it catches a module whose spelled count has stopped agreeing with its own items', () => {
    // RI-04's failure arriving on the condition itself: its literal held four
    // names where the tree had five, and it passed green for three sessions.
    const root = cleanTree();
    write(
      root,
      'apps/api/src/admin-source/blocked-read.ts',
      '// **CLEARING CONDITION, ALL FOUR TERMS:**\n' +
        '//   1. A `writeRuleState` IMPLEMENTATION lands.\n' +
        '//   2. A primary source declares the stored `engine_gates` ENCODING.\n' +
        '//   3. `eligible_next_7d` gains its `| null`.\n',
    );
    expect(findings('RI-19', root).join('\n')).toContain('says ALL FOUR TERMS and enumerates 3');
  });

  test('it reports a module that declares terms and enumerates none, rather than passing', () => {
    // The enumeration IS the term set. A statement with no `1.` item binds
    // nothing, and reporting PASS over it would be this check asserting the
    // agreement of a list it never read.
    const root = cleanTree();
    write(
      root,
      'apps/api/src/admin-source/blocked-read.ts',
      '// **CLEARING CONDITION, ALL THREE TERMS:** a `writeRuleState` lands, and\n' +
        '// the rest of it is prose.\n',
    );
    expect(findings('RI-19', root).join('\n')).toContain('ENUMERATES NONE');
  });

  test('it reports a term that shares every identifier with a sibling, rather than passing', () => {
    // A CHECK NEVER RETURNS PASS FOR SOMETHING IT DID NOT LOOK AT, which is this
    // runner's rule 1. Two terms naming only `writeRuleState` are two terms RI-19
    // cannot tell apart, and silence there would be the check covering less than
    // its own words claim.
    const root = cleanTree();
    write(
      root,
      'apps/api/src/admin-source/blocked-read.ts',
      '// **CLEARING CONDITION, ALL THREE TERMS:**\n' +
        '//   1. A `writeRuleState` IMPLEMENTATION lands.\n' +
        '//   2. A second `writeRuleState` thing happens.\n' +
        '//   3. `eligible_next_7d` gains its `| null`.\n',
    );
    expect(findings('RI-19', root).join('\n')).toContain('shares every identifier it names');
  });

  test('it THROWS when the form it binds has left the tree, rather than reporting agreement', () => {
    // A CHECK THAT CANNOT RUN IS NOT A CHECK THAT PASSED. Zero declarations means
    // the marker was reworded, and every restatement in the tree is unbound the
    // moment that happens. Reporting PASS there is RI-04's three green sessions.
    const root = cleanTree();
    write(root, 'apps/api/src/admin-source/blocked-read.ts', '// nothing is blocked.\n');
    write(root, CONDITION, '// nothing is blocked.\n');
    expect(() => findings('RI-19', root)).toThrow(/found NO clearing condition/);
  });

  test('it THROWS rather than guessing which restatement belongs to which condition', () => {
    const root = cleanTree();
    write(
      root,
      'apps/api/src/admin-source/blocked-read.ts',
      '// **CLEARING CONDITION, ALL ONE TERMS:**\n' +
        '//   1. A `writeRuleState` IMPLEMENTATION lands.\n' +
        '//\n' +
        '// **CLEARING CONDITION, ALL ONE TERMS:**\n' +
        '//   1. A `readRuleState` IMPLEMENTATION lands.\n',
    );
    expect(() => findings('RI-19', root)).toThrow(/pairs them BY FILE/);
  });

  test('a restatement spelling an identifier in another case holds, which is prose and not drift', () => {
    // The comparison is case-folded on purpose. `EngineGates` and `engineGates`
    // are one term written by two hands, and a check that went red on that would
    // be teaching sessions to ignore it.
    const root = cleanTree();
    write(
      root,
      CONDITION,
      '// CLEARING CONDITION, ALL THREE TERMS: a `WRITERULESTATE` lands, AND a\n' +
        '// source declares the stored `Engine_Gates` ENCODING, AND\n' +
        '// `ELIGIBLE_NEXT_7D` gains its `| NULL`.\n',
    );
    expect(findings('RI-19', root)).toEqual([]);
  });

  test('IT IS BLIND TO A TERM WHOSE MEANING INVERTS WHILE ITS IDENTIFIERS STAY PUT', () => {
    // THE LIMIT, ASSERTED RATHER THAN DESCRIBED. RI-19 reads identifiers and not
    // prose, so "gains its `| null`" and "LOSES its `| null`" are the same term
    // to it. This case exists so the next reader learns that from a green
    // assertion here instead of from a condition that drifted past a check
    // whose `covers` they took at its word.
    const root = cleanTree();
    write(
      root,
      CONDITION,
      '// CLEARING CONDITION, ALL THREE TERMS: a `writeRuleState` implementation\n' +
        '// is REMOVED, AND nothing declares the stored `engine_gates` ENCODING,\n' +
        '// AND `eligible_next_7d` LOSES its `| null`.\n',
    );
    expect(findings('RI-19', root)).toEqual([]);
  });

  test('IT IS BLIND TO A RESTATEMENT THAT DOES NOT DECLARE ITS OWN TERM COUNT', () => {
    // THE SECOND LIMIT, AND IT IS THE LARGER ONE. The corpus states clearing
    // conditions nine other ways and RI-19 reads none of them: it binds the form
    // session 392 established and makes that form load-bearing. A case that
    // restates the condition WITHOUT the marker is not in any pair, and the two
    // statements are then free to drift exactly as `B5`'s did.
    const root = cleanTree();
    write(
      root,
      CONDITION,
      '// CLEARING CONDITION, RESTATED: a `writeRuleState` implementation lands,\n' +
        '// AND `eligible_next_7d` gains its `| null`.\n',
    );
    // Two of three terms, no control, and RI-19 says nothing. This is the hole.
    expect(findings('RI-19', root)).toEqual([]);
  });
});

describe('RI-19 is about a real pair on the real tree, which is separate from its verdict', () => {
  test('it binds `B5`s condition across `liability.ts` and its case, with three terms', () => {
    // "IT RETURNED AN EMPTY ARRAY" IS NOT EVIDENCE THAT IT LOOKED. RI-04 passed
    // green for three sessions while checking nothing, so this case asserts the
    // SUBJECT: the pair RI-19 found, which side is canonical, and how many terms
    // it derived. Every number here is read out of the tree at run time.
    const { pairs, declared } = clearingConditionPairs(REPO_ROOT);
    expect(declared).toBeGreaterThanOrEqual(2);
    const b5 = pairs.get('apps/api::admin-source-liability');
    expect(b5).toBeDefined();
    expect(b5?.module.map((m) => m.file)).toEqual(['apps/api/src/admin-source/liability.ts']);
    expect(b5?.case.map((c) => c.file)).toEqual(['apps/api/test/admin-source-liability.test.ts']);
    // THE MODULE ENUMERATES AND THE CASE RESTATES, which is session 392's repair
    // in its own words: the condition is written ONCE, in the module.
    expect(b5?.module[0]?.terms.length).toBe(3);
    expect(b5?.module[0]?.count).toBe(3);
    expect(b5?.case[0]?.count).toBe(3);
    expect(b5?.case[0]?.terms.length).toBe(0);
  });
});
