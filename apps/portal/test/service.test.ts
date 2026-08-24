import { expect, test } from 'vitest';

import { SERVICE, main } from '../src/index.js';

// CI-02, the `unit` project.
test('portal deploys as its own Railway service', () => {
  expect(SERVICE).toBe('portal');
});

test('the deployable starts', () => {
  expect(() => main()).not.toThrow();
});
