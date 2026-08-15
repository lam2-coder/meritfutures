import { expect, test } from 'vitest';

import type { ScopedDb } from '../src/index.js';

// CI-02, the `unit` project.
test('the accessor carries the identity it is scoped by', () => {
  const db = { identityId: 'i-1' as ScopedDb['identityId'] } satisfies ScopedDb;
  expect(db.identityId).toBe('i-1');
});
