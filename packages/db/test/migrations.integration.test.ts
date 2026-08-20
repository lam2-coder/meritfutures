import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

// CI-04, the `integration` project.
//
// A NEON BRANCH PER RUN IS WHAT THIS STAGE IS FOR (STRATEGY section 2), which
// means it needs a Neon token, which means it CANNOT RUN ON A FORK PULL REQUEST
// and must degrade honestly rather than appear green (P1 section 2.2). Wiring
// that degradation is the CI job's work, not this file's.
//
// Until then the stage holds two assertions that need no database and are still
// worth failing on: no two migrations claim the same number, and every number
// below the highest one is either ON DISK or RESERVED in the allocation table.
//
// THE SECOND ASSERTION USED TO BE STRICT CONTIGUITY OVER THE FILES ALONE, and
// this header used to describe that as "the weaker half" of CI-06h. It was the
// STRONGER half and the description is what hid the incompatibility: CI-06h
// asserts gaplessness over ON DISK PLUS RESERVED, ALLOCATION says in terms that
// "an unspent reservation costs nothing", and ADR-066 reserves 0038 to 0042 for
// five sessions that land in whatever order they finish. The first of those
// sessions to land was FOLD-03 F4 with 0041, and strict contiguity failed on it
// while CI-06h passed. Renumbering is not the remedy: the numbers below it are
// claimed by other sessions, and E2 makes a merged migration unrenumberable.
//
// A HOLE THE ALLOCATION TABLE DOES NOT EXPLAIN STILL FAILS, which is the control
// this file was actually protecting.

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', 'migrations');
const ALLOCATION = join(HERE, '..', '..', '..', 'docs', 'decisions', 'ALLOCATION.md');
const HEADING = '## Migration number allocation';

// The same rows CI-06h reads, parsed the same way: a leading cell holding one
// number or a `nnnn to nnnn` range, bold or not.
function reserved(): Set<number> {
  const body = readFileSync(ALLOCATION, 'utf8');
  const start = body.indexOf(HEADING);
  if (start === -1) throw new Error(`allocation table not found: "${HEADING}"`);
  const rest = body.slice(start + HEADING.length);
  const next = rest.search(/\n## /);
  const claimed = new Set<number>();
  for (const line of (next === -1 ? rest : rest.slice(0, next)).split('\n')) {
    if (!line.startsWith('|')) continue;
    const m = /^\s*\*{0,2}(\d{3,4})\*{0,2}(?:\s+to\s+\*{0,2}(\d{3,4})\*{0,2})?\s*$/.exec(
      line.split('|')[1] ?? '',
    );
    if (!m?.[1]) continue;
    for (let n = Number(m[1]); n <= Number(m[2] ?? m[1]); n++) claimed.add(n);
  }
  // A PARSER THAT STOPPED MATCHING WOULD MAKE EVERY GAP LOOK UNEXPLAINED, which
  // is the opposite failure from the one above and just as silent.
  if (claimed.size === 0)
    throw new Error('no migration allocation rows parsed; the test cannot run');
  return claimed;
}

test('migration filenames are uniquely numbered', () => {
  const numbers = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => {
      const m = /^(\d{4})_/.exec(f);
      if (!m?.[1]) throw new Error(`${f} does not start with a 4-digit sequence number`);
      return Number(m[1]);
    })
    .sort((a, b) => a - b);

  expect(numbers.length).toBeGreaterThan(0);
  expect(new Set(numbers).size).toBe(numbers.length);
});

test('every number below the highest is on disk or reserved in ALLOCATION', () => {
  const onDisk = new Set(
    readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => Number(/^(\d{4})_/.exec(f)?.[1])),
  );
  const claimed = reserved();
  const max = Math.max(...onDisk, ...claimed);

  const holes: string[] = [];
  for (let n = 1; n <= max; n++) {
    if (!onDisk.has(n) && !claimed.has(n)) holes.push(String(n).padStart(4, '0'));
  }
  expect(holes).toEqual([]);
});
