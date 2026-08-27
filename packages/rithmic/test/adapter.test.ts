import { expect, test } from 'vitest';

import { simulatorLiveFeed } from '../src/simulator/stream.ts';
import type { PlatformAdapter } from '../src/index.ts';
import { canonicalInput } from './canonical.ts';
import { simulate } from '../src/simulator/session.ts';

// CI-02, the `unit` project.
//
// =============================================================================
// THE INTERFACE IS COMPLETE, AND EXACTLY ONE OF ITS OPERATIONS IS IMPLEMENTED
// =============================================================================
// This file used to say "the adapter is an interface and nothing implements it
// yet" and that sentence is false as of ADR-154: `simulatorLiveFeed` implements
// `streamLive`. **The clean statement it replaces is worth naming**, because
// ADR-154 `F1` foreclosed it deliberately rather than losing it by accident.
//
// What is assertable is now two things rather than one, and the second is the
// half ADR-154 clause 3 calls load bearing.
// =============================================================================

// OVERVIEW section 3 names the operations this container has, and a missing one
// is a vendor specific that leaks out of this package the first time somebody
// needs it. `streamLive` joined that row on 2026-08-27 by ADR-154 and the row,
// the GLOSSARY entry and this test moved in one change, which clause 5 required:
// a test that read OVERVIEW by name while OVERVIEW said something else would be
// a contradiction that type-checks.
test('the adapter names every operation OVERVIEW gives this container', () => {
  const operations: Record<keyof PlatformAdapter, true> = {
    provision: true,
    entitle: true,
    ingestFills: true,
    ingestEOD: true,
    reconcile: true,
    streamLive: true,
  };
  expect(Object.keys(operations).sort()).toEqual([
    'entitle',
    'ingestEOD',
    'ingestFills',
    'provision',
    'reconcile',
    'streamLive',
  ]);
});

// ADR-154 clause 3: "`provision`, `entitle`, `ingestFills`, `ingestEOD` and
// `reconcile` are still not implemented by the simulator, for finding 6's
// reason, which is undisturbed for all five. The argument 'the simulator
// implements one method, so it may implement the others' is foreclosed here in
// advance, because those five have a parser and this one does not."
//
// **THE ANNOTATION IS NOT THE ASSERTION.** `simulatorLiveFeed` returns
// `Pick<PlatformAdapter, 'streamLive'>`, and a `Pick` bounds what a consumer may
// CALL rather than what the object CARRIES: an implementation that grew an
// `ingestEOD` beside `streamLive` would still satisfy that return type and every
// type-check in this repository. So the key set of the returned object is read
// at runtime, which is the only place the extra key would be visible.
test('the simulator implements streamLive and no other operation', () => {
  const feed = simulatorLiveFeed(simulate(canonicalInput()));
  expect(Object.keys(feed)).toEqual(['streamLive']);

  const refused: readonly Exclude<keyof PlatformAdapter, 'streamLive'>[] = [
    'provision',
    'entitle',
    'ingestFills',
    'ingestEOD',
    'reconcile',
  ];
  for (const operation of refused) {
    expect(Object.hasOwn(feed, operation)).toBe(false);
  }
});
