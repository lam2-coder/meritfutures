import { expect, test } from 'vitest';

import { BATCH_CONCURRENCY, SERVICE } from '../src/index.ts';

// CI-02, the `unit` project.
test('worker deploys as its own Railway service', () => {
  expect(SERVICE).toBe('worker');
});

// **THE TEST THAT STOOD HERE WAS THE DEFECT IN TEST FORM.** It read
// `expect(() => main()).not.toThrow()` under the name "the deployable starts",
// and it was green for the whole of the period in which this deployable started
// and did nothing: `main` was a `console.log`, nothing called it, and a test
// asserting that calling it does not throw could not tell that apart from a
// working service. ADR-241 replaces it rather than repairing it, and the
// replacement is `test/entrypoint.test.ts`, which SPAWNS A PROCESS and reads the
// status it left. Keeping this one would also be actively unsafe now: `main()`
// with no argument opens the live door, so the old line would try to reach a
// database from a unit test.
test('the batch runs one account at a time until FM-10s advisory lock exists', () => {
  // `job.ts` states the argument. It is a ruling rather than a tuning knob, so
  // it is a constant this suite can read and not an environment variable a
  // deployment could raise past the lock that does not exist.
  expect(BATCH_CONCURRENCY).toBe(1);
});
