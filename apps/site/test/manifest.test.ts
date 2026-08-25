// =============================================================================
// apps/site/test/manifest.test.ts
// =============================================================================
// ADR-096 SECTION 9's HOLE, NARROWED TO THIS PACKAGE AND NOT CLOSED.
//
// The entry measured the hole rather than predicting it: add
// `"@merit/db": "workspace:*"` to this app's manifest plus one
// `systemDb('nightly-batch').rows('accounts')` call under `src/`, and
// `tsc --noEmit`, `eslint apps packages`, `check:invariants` and
// `gates.mjs check` all stay green. "The control is an ABSENT dependency
// declaration, which is a control that announces nothing when it stops
// holding."
//
// WHAT THIS FILE IS. The manifest half of that control, as an assertion, over
// THIS package's four dependency fields and this package's own source.
//
// WHAT IT IS NOT, and the difference is the whole reason it is written down
// rather than claimed. ADR-096 section 9 names the remedy `RI-08`, "an
// `RI-08` over `apps/site`'s four dependency fields, refusing any specifier
// that resolves to `@merit/db`... It belongs to `P4-e`, in the same commit as
// the adapter", and says the better version covers `packages/queue` too, which
// holds the identical undeclared-dependency shape. `RI-08` LIVES IN
// `packages/tooling/checks/repo-invariants.mjs`, WHICH IS OUTSIDE THIS
// SESSION'S FENCE (P4 section 8's `P4-e` row: `apps/site/**`, `STATE`,
// `sessions/`), so it is not written here and `check:invariants` still reports
// eight invariants with `RI-08` absent. Three things this file therefore does
// NOT do, none of which a green run may be read as covering:
//
//   1. It does not see `packages/queue`, or any package but this one.
//   2. It runs in CI-02 with the suite, not in CI-01 with the invariants, so a
//      manifest change that skips the test run is not refused by it.
//   3. It reads a manifest and a source tree. A transitive dependency that
//      reaches `@merit/db` through a third package declares nothing here, which
//      is `RI-01`'s own stated limit one directory over.
//
// The hole is narrower after this file and it is still open. The pull request
// says so in those words.
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const ROOT = join(APP, '..', '..');

/** RI-01's list, and every one of the four is a place a dependency can hide. */
const DEP_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

/** The accessor package, read from its own manifest rather than written here. */
function accessorPackageName(): string {
  const manifest: unknown = JSON.parse(
    readFileSync(join(ROOT, 'packages/db/package.json'), 'utf8'),
  );
  const name = (manifest as { name?: unknown }).name;
  if (typeof name !== 'string' || name === '') {
    throw new Error('packages/db/package.json declares no name; this test cannot run');
  }
  return name;
}

/**
 * `CLIENT_FAMILIES`, parsed out of the ESLint rule that owns the list.
 *
 * RI-06's relationship to the plugin, one register over: parse the source of
 * truth and implement the comparison. A second copy of `['pg', 'drizzle-orm',
 * ...]` in this file would drift the day the rule grew a family, and it would
 * drift SILENTLY, which is the failure mode this file sits inside.
 */
function clientFamilies(): readonly string[] {
  const rel = 'packages/eslint-plugin-merit/rules/no-raw-db-client.js';
  const source = readFileSync(join(ROOT, rel), 'utf8');
  const block = /const CLIENT_FAMILIES = \[([\s\S]*?)\n\];/.exec(source);
  if (block?.[1] === undefined) {
    throw new Error(`${rel}: no CLIENT_FAMILIES literal found; this test cannot run`);
  }
  const names = [...block[1].matchAll(/names:\s*\[([^\]]*)\]/g)].flatMap((match) =>
    [...String(match[1]).matchAll(/'([^']+)'/g)].map((name) => String(name[1])),
  );
  if (names.length === 0) {
    throw new Error(`${rel}: CLIENT_FAMILIES parsed to zero names; this test asserts nothing`);
  }
  return names;
}

function siteManifest(): Readonly<Record<string, unknown>> {
  return JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8')) as Readonly<
    Record<string, unknown>
  >;
}

function sourceFiles(): readonly string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.ts')) files.push(path);
    }
  };
  walk(join(APP, 'src'));
  return files;
}

test('this app declares no dependency that reaches the database accessor', () => {
  const accessor = accessorPackageName();
  const manifest = siteManifest();
  const offences: string[] = [];

  for (const dependencyField of DEP_FIELDS) {
    const declared = manifest[dependencyField];
    if (declared === undefined) continue;
    for (const [name, spec] of Object.entries(declared as Record<string, unknown>)) {
      // BOTH SIDES ARE READ. The key catches the ordinary declaration and the
      // specifier catches the aliased one: `"db": "workspace:@merit/db@*"`
      // declares the same dependency under a name no key check would find.
      if (name === accessor || String(spec).includes(accessor)) {
        offences.push(`${dependencyField}.${name} is ${String(spec)}`);
      }
    }
  }

  expect(
    offences,
    `apps/site/package.json declares ${accessor}. ADR-096 ruling 1: this app "opens no pool, ` +
      'holds no credential, and imports nothing from packages/db". Section 8: the only ' +
      'database role a site reader could hold is `merit_app`, which holds INSERT and full DML, ' +
      'so a site that reads the database holds a WRITE-CAPABLE credential on the most-attacked ' +
      'origin in the estate, and INV-M9-10 stops being true by construction.',
  ).toEqual([]);
});

test('this app declares no database client in any dependency field', () => {
  // The MANIFEST half of what `merit/no-raw-db-client` does over imports. That
  // rule reads source and this reads the four fields, and neither substitutes
  // for the other: a declared driver nothing has imported yet is a driver the
  // next diff can import in one line.
  const families = clientFamilies();
  const manifest = siteManifest();
  const offences: string[] = [];

  for (const dependencyField of DEP_FIELDS) {
    const declared = manifest[dependencyField];
    if (declared === undefined) continue;
    for (const name of Object.keys(declared as Record<string, unknown>)) {
      const family = families.find((entry) => name === entry || name.startsWith(`${entry}/`));
      if (family !== undefined) offences.push(`${dependencyField}.${name} is ${family}`);
    }
  }

  expect(
    offences,
    `apps/site declares a database client (${families.length} families read)`,
  ).toEqual([]);
});

test('no source file in this app imports the database accessor', () => {
  const accessor = accessorPackageName();
  const files = sourceFiles();
  expect(files.length, 'source files walked').toBeGreaterThan(5);

  const offences: string[] = [];
  for (const file of files) {
    // Comments are stripped first, because this app's headers CITE the
    // accessor by name in the sentences that explain why it is not imported,
    // and a check that fired on its own rationale would be deleted within a
    // week.
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ');
    if (code.includes(accessor)) offences.push(file.slice(ROOT.length + 1));
  }

  expect(
    offences,
    `a source file names ${accessor}. The refusal today is module resolution -- a package that ` +
      'does not link it cannot name `ScopedDb` or `SystemDb` at all (ADR-096 section 4) -- and ' +
      'this asserts the source half so the refusal is not only the absent manifest line.',
  ).toEqual([]);
});
