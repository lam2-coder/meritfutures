// =============================================================================
// apps/worker/test/db.test.ts
// =============================================================================
// THE ASSERTIONS ADR-165 IS WILLING TO HAVE WATCHED, AND AN HONEST STATEMENT OF
// WHICH HALF OF THE ADMISSION EACH ONE COVERS.
//
// The admission has two halves. `RI-08` in
// `packages/tooling/checks/repo-invariants.mjs` is the MANIFEST half over every
// workspace package, it runs in `CI-01`, and it is the control: it fails loudly
// the moment a package declares `@merit/db` without being on the list. Nothing
// in this file duplicates it, because `RI-08`'s own header states what the
// second copy costs -- "Two lists is the defect; one list read twice is the
// fix."
//
// WHAT THIS FILE COVERS IS THE OTHER HALF AND IT IS NARROWER: what
// `apps/worker` DOES with the capability now that it holds it. Four properties,
// each of which can go wrong silently and none of which `RI-08` can see.
//
//   1. The reason the one door runs at. It is a string in one file and nothing
//      but a reader would notice it becoming `'operator-console'`.
//   2. The door COUNT. A second door added beside a detector slice type-checks,
//      passes every gate, and is exactly the diff ADR-165 forecloses.
//   3. The acquisition point. `apps/api/src/db.ts` writes "one file names the
//      accessor" down as "a convention and it is not a control". Here it is an
//      assertion over this deployable's own `src/` tree.
//   4. What this deployable can import at all, which under
//      `node-linker=isolated` is exactly what its manifest declares.
//
// WHAT IT PROVES NOTHING ABOUT. Whether a composed predicate reaches one row or
// many: that is `packages/db`'s and is asserted in
// `packages/db/test/keyed-accessor.test.ts`. Whether `SystemReason` is still two
// members: `packages/ledger/test/accessor-bind.test.ts` already parses that out
// of `scoped-db.ts` and a second copy here would be the defect item 3 exists to
// avoid, one register over.
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import { LIVE_DB, WORKER_REASON, workerHandle } from '../src/db.ts';
import type { WorkerDb } from '../src/db.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');

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
    readFileSync(join(APP, '..', '..', 'packages', 'db', 'package.json'), 'utf8'),
  );
  const name = (manifest as { name?: unknown }).name;
  if (typeof name !== 'string' || name === '')
    throw new Error('packages/db declares no name; this suite has no accessor to look for');
  return name;
}

/** Every `.ts` file under this deployable's `src/`, repo-relative. */
function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) found.push(full);
    }
  };
  walk(join(APP, 'src'));
  return found.sort();
}

/**
 * Every BARE module specifier imported under `src/`.
 *
 * Bare rather than relative, because a relative import resolves inside this
 * deployable and is `RI-10`'s subject; a bare one is a CAPABILITY, and under
 * `.npmrc`'s `node-linker=isolated` it resolves only if the manifest declares
 * it. Static `import`, `export ... from` and `import type` all match, which is
 * every form this tree uses.
 *
 * A SPECIFIER AND NOT A SUBSTRING, AND THE DIFFERENCE WAS MEASURED RATHER THAN
 * ANTICIPATED. The first draft of the acquisition-point case below tested
 * whether a file CONTAINED the accessor's name and it failed on
 * `src/provisioning/ports.ts`, whose header names `@merit/db` in order to say
 * that it does not import it. A prose mention of a package a file deliberately
 * does not reach is the OPPOSITE of the property being asserted, so the
 * instrument is the import statement.
 */
function bareSpecifiersIn(file: string): Set<string> {
  const found = new Set<string>();
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+'([^']+)'/g)) {
    const spec = match[1] ?? '';
    if (!spec.startsWith('.')) found.add(spec);
  }
  return found;
}

/** Every bare specifier imported anywhere under `src/`. */
function bareSpecifiers(): Set<string> {
  const found = new Set<string>();
  for (const file of sourceFiles()) for (const spec of bareSpecifiersIn(file)) found.add(spec);
  return found;
}

// -----------------------------------------------------------------------------
// 1. The reason, which is the one string here that could silently become the
//    other member
// -----------------------------------------------------------------------------

test('the handle this deployable opens is a SystemDb carrying the nightly-batch reason', () => {
  const handle = workerHandle();

  // BUILT WITHOUT A DATABASE, AND THAT IS THE PROPERTY THAT MAKES THIS CASE
  // POSSIBLE AT ALL. `systemDb(reason)` composes a value; `transaction()` is
  // what opens a connection, and `ci.yml`'s `integration` job has no Postgres.
  expect(handle.__brand).toBe('SystemDb');
  expect(handle.reason).toBe('nightly-batch');
  expect(WORKER_REASON).toBe('nightly-batch');

  // NOT `'operator-console'`, written as its own expectation rather than left
  // implied by the line above. The failure this watches for is a one-word edit
  // in `src/db.ts`, and a reader of a failing suite should see the word.
  expect(handle.reason).not.toBe('operator-console');
});

// -----------------------------------------------------------------------------
// 2. The door count, which is the diff ADR-165 forecloses
// -----------------------------------------------------------------------------

test('there is exactly one door, it is named batch, and it takes no argument but the unit of work', () => {
  expect(Object.keys(LIVE_DB)).toEqual(['batch']);

  // A REASON PARAMETER IS WHAT WOULD MAKE `'operator-console'` REACHABLE FROM
  // THIS DEPLOYABLE, and it would arrive as a second argument. `Function.length`
  // counts declared parameters before the first default or rest, which is
  // exactly the shape being refused.
  expect(LIVE_DB.batch.length).toBe(1);
});

test('the door is an interface, so an adapter is testable with no database at all', async () => {
  // THE SEAM, EXERCISED RATHER THAN DESCRIBED. What a substitute proves is that
  // an adapter in this deployable can be written against `WorkerDb` and run
  // without `DATABASE_URL`; it proves nothing about the predicate the real
  // accessor would compose, which is `packages/db`'s and is asserted there.
  const named: string[] = [];
  const substitute: WorkerDb = {
    batch<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      return fn({
        __brand: 'SystemTx',
        reason: WORKER_REASON,
        rows: (key: string) => {
          named.push(key);
          return Promise.resolve([]);
        },
        sqlExecutor: () => {
          throw new Error('no adapter in this deployable may reach for one');
        },
      } as never);
    },
  };

  await substitute.batch(async (tx) => {
    await tx.rows('fills');
    await tx.rows('identityLinks');
  });

  expect(named).toEqual(['fills', 'identityLinks']);
});

// -----------------------------------------------------------------------------
// 3. The acquisition point, which apps/api states as a convention and does not
//    check
// -----------------------------------------------------------------------------

test('exactly one file under src imports the accessor, and it is src/db.ts', () => {
  const accessor = accessorPackageName();
  const importing = sourceFiles()
    .filter((file) => bareSpecifiersIn(file).has(accessor))
    .map((file) => relative(APP, file).split('\\').join('/'));

  expect(importing).toEqual(['src/db.ts']);
});

// -----------------------------------------------------------------------------
// 4. What this deployable can import at all
// -----------------------------------------------------------------------------

test('src reaches two workspace packages and one Node builtin, and no raw driver', () => {
  // `pg` AND `drizzle-orm` ARE THE TWO NAMES ADR-165 FORECLOSES AT THE SOURCE.
  // `merit/no-raw-db-client` bans them by lint over `apps/**`; this asserts the
  // same thing over this deployable from the other direction, so the property
  // survives an `eslint-disable` comment.
  //
  // `node:crypto` IS IN THE LIST BECAUSE IT IS REAL AND NOT BECAUSE IT IS
  // TOLERATED. A builtin is a different KIND of specifier from a package: it
  // resolves with no manifest line at all, so it is the one bare form
  // `node-linker=isolated` says nothing about, and `RI-07` is the invariant
  // whose whole subject is a builtin reaching a package that must not have one.
  // Writing it here rather than filtering it out is what makes a SECOND builtin
  // arriving a decision somebody sees.
  expect([...bareSpecifiers()].sort()).toEqual(['@merit/db', '@merit/rules-engine', 'node:crypto']);
});

test('every bare specifier src imports is declared in this deployable manifest', () => {
  const manifest: unknown = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8'));
  const declared = new Set<string>();
  for (const field of DEP_FIELDS) {
    const block = (manifest as Record<string, unknown>)[field];
    if (typeof block === 'object' && block !== null)
      for (const name of Object.keys(block)) declared.add(name);
  }

  // UNDER `node-linker=isolated` AN UNDECLARED SPECIFIER RESOLVES AT NEITHER RUN
  // TIME NOR BUILD TIME, which is what makes the manifest line the acquisition
  // point and `RI-08`'s manifest check the whole control rather than half of
  // one (ADR-117 section 5, measured; ADR-120 corrected the sentence that said
  // otherwise).
  // A `node:` SPECIFIER IS EXCLUDED AND THE EXCLUSION IS THE POINT OF THE
  // SENTENCE ABOVE: a builtin resolves without a manifest line, so requiring one
  // for it would assert something false about how the resolver works.
  for (const spec of bareSpecifiers())
    if (!spec.startsWith('node:')) expect(declared).toContain(spec);

  // THE ACCESSOR IS DECLARED IN `dependencies` AND NOWHERE ELSE. A dev-only
  // declaration would satisfy `RI-08` and fail to resolve in the deployed
  // service, which is a failure that waits until production to arrive.
  const runtime = (manifest as Record<string, Record<string, string> | undefined>)['dependencies'];
  expect(Object.keys(runtime ?? {})).toContain(accessorPackageName());
});
