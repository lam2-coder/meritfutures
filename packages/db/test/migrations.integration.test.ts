import { readdirSync } from 'node:fs';
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
// Until then the stage holds one assertion that needs no database and is still
// worth failing on: the migration set is a contiguous, uniquely numbered
// sequence applied in filename order. CI-06h asserts the same thing against the
// allocation table in DECISIONS.md; this asserts the weaker half locally, so
// that a developer who has just added a file learns about a collision here
// rather than at merge, where E2 makes a migration unrenumberable.

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

test('migration filenames are a gapless, uniquely numbered sequence', () => {
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
  expect(numbers).toEqual(numbers.map((_, i) => i + 1));
});
