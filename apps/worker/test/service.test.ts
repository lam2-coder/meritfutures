import { expect, test } from 'vitest';

import { SERVICE, main } from '../src/index.js';

// CI-02, the `unit` project.
test('worker deploys as its own Railway service', () => {
  expect(SERVICE).toBe('worker');
});

test('the deployable starts', () => {
  expect(() => main()).not.toThrow();
});
