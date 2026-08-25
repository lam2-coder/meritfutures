// =============================================================================
// packages/queue/test/surface.test.ts
// =============================================================================
// ADR-006 CLOSED WITH A REVIEW CRITERION AND NOT A DESIGN NOTE: "The job
// interface stays narrow enough that a later move to BullMQ is a contained
// change, and that narrowness is now a review criterion on M2 and M5, not an
// aspiration." A criterion a person applies by reading is an aspiration wearing
// a different word, so this file applies it by running.
//
// THREE THINGS, AND EACH IS THE OTHERS' COMPLEMENT.
//
//   1. THE INTERFACE IS FIVE METHODS, and the adapter implements exactly those
//      five. A sixth method is a diff somebody has to defend.
//   2. THE VENDOR IS NAMED IN ONE MODULE, over the whole tree. "A contained
//      change" is a fact about how many files import `pg-boss`, and it is a fact
//      that decays silently: the second import is always added in a session with
//      a deadline, and nothing else in this repository would notice it.
//   3. THE PACKAGE EXPORTS NO pg-boss TYPE, so a caller receives a `JobQueue`
//      and can name nothing else. ADR-084's `index.ts` makes the same move about
//      `client()` and for the same reason: the boundary is only a boundary while
//      nothing crosses it.
//
// IT READS THE TREE RATHER THAN A LIST OF FILES. A registry of "files allowed to
// import pg-boss" is a second statement of the containment, maintained by hand,
// and ADR-034 is this corpus's record of what hand-maintained lists do.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { JOB_QUEUE_METHODS } from '../src/job-queue.ts';
import * as queuePackage from '../src/index.ts';
import { pgBossQueue } from '../src/pg-boss-queue.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Directories that are not this repository's source, whatever they contain. */
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next']);

/** Every TypeScript file under the workspace's two source roots. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      if (SKIP.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.ts') || entry.endsWith('.mts')) out.push(full);
    }
  };
  walk(join(ROOT, 'apps'));
  walk(join(ROOT, 'packages'));
  return out;
}

/**
 * Files that IMPORT the vendor, by every route the module system offers.
 *
 * Matched on the specifier and not on the word, so this file, `index.ts`'s
 * header and every comment that explains the choice are not findings. The same
 * four forms `merit/no-raw-db-client` reads, for the same reason it reads four:
 * a re-export and a dynamic import are the same import with the binding
 * forwarded.
 */
function importsPgBoss(): string[] {
  const specifier = /(?:from|import|require)\s*\(?\s*['"]pg-boss(?:\/[^'"]*)?['"]/;
  return sourceFiles()
    .filter((file) => specifier.test(readFileSync(file, 'utf8')))
    .map((file) => relative(ROOT, file));
}

describe('the interface is as narrow as ADR-006 requires', () => {
  test('the adapter implements exactly the five declared methods, in both directions', () => {
    // Built with a throwaway executor, because constructing the queue must not
    // touch a database: `pgBossQueue` is handed a connection rather than opening
    // one, which is what this line proves in passing.
    const queue = pgBossQueue({ executeSql: async () => ({ rows: [] }) });

    const implemented = Object.keys(queue).sort();
    const declared = [...JOB_QUEUE_METHODS].sort();

    // BOTH DIRECTIONS IN ONE EQUALITY. A method on the object that is not on the
    // interface is a vendor primitive that leaked; a method on the interface
    // that is not on the object cannot happen at compile time and is asserted
    // anyway, because a compile-time guarantee nobody re-derives is a guarantee
    // that survives its own deletion.
    expect(implemented).toEqual(declared);
    expect(declared).toHaveLength(5);
    for (const method of declared) {
      expect(typeof queue[method as keyof typeof queue]).toBe('function');
    }
  });

  test('the package publishes three values, and no pg-boss type among them', () => {
    // TYPES ARE ERASED, so this is the value surface. It is pinned rather than
    // described: ADR-084's index.ts keeps `client()` off its own export list on
    // the same argument, that a boundary is only a boundary while nothing
    // crosses it.
    expect(Object.keys(queuePackage).sort()).toEqual([
      'JOB_QUEUE_METHODS',
      'QUEUE_SCHEMA',
      'pgBossQueue',
    ]);
  });
});

describe('the vendor is contained', () => {
  test('exactly one module in the workspace imports pg-boss', () => {
    // THE WHOLE OF "a later move to BullMQ is a contained change", AS A NUMBER.
    // The day this list has two entries the move stops being contained, and this
    // is the only thing in the repository that would say so.
    expect(importsPgBoss()).toEqual(['packages/queue/src/pg-boss-queue.ts']);
  });

  test('the scan is not vacuous: it finds this workspace and it finds the import', () => {
    // A WALK THAT FOUND NOTHING WOULD PASS THE CASE ABOVE IF THE FILE MOVED, and
    // an empty scan reporting green is the failure mode STATE records for the
    // corpus gates: "two of the eleven once failed on a truncated tree copy and
    // would have been scored as working."
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(50);
    expect(files.map((f) => relative(ROOT, f))).toContain('packages/queue/src/pg-boss-queue.ts');
  });

  test('exactly one manifest in the workspace declares pg-boss', () => {
    // THE OTHER HALF OF CONTAINMENT, AND THE ONE AN IMPORT SCAN CANNOT SEE.
    // `node-linker=isolated` means a package that does not declare pg-boss
    // cannot resolve it, so the manifest list is what makes the import list
    // enforceable rather than merely true today.
    const manifests: string[] = [];
    for (const parent of ['apps', 'packages']) {
      for (const entry of readdirSync(join(ROOT, parent)).sort()) {
        const rel = `${parent}/${entry}/package.json`;
        const body = readFileSync(join(ROOT, rel), 'utf8');
        const manifest: unknown = JSON.parse(body);
        const fields = manifest as Record<string, Record<string, string> | undefined>;
        const declares = ['dependencies', 'devDependencies', 'peerDependencies'].some((field) =>
          Object.keys(fields[field] ?? {}).includes('pg-boss'),
        );
        if (declares) manifests.push(rel);
      }
    }
    expect(manifests).toEqual(['packages/queue/package.json']);
  });
});
