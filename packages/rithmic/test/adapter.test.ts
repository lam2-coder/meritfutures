import { expect, test } from 'vitest';

import type { PlatformAdapter } from '../src/index.js';

// CI-02, the `unit` project.
//
// The adapter is an interface and nothing implements it yet (M02 holds at
// `review` by ADR-005 pending the vendor call). What is assertable today is
// that the interface a second adapter must satisfy is complete: OVERVIEW
// section 3 names five operations, and a missing one is a vendor specific that
// leaks out of this package the first time somebody needs it.
test('the adapter names every operation OVERVIEW gives this container', () => {
  const operations: Record<keyof PlatformAdapter, true> = {
    provision: true,
    entitle: true,
    ingestFills: true,
    ingestEOD: true,
    reconcile: true,
  };
  expect(Object.keys(operations).sort()).toEqual([
    'entitle',
    'ingestEOD',
    'ingestFills',
    'provision',
    'reconcile',
  ]);
});
