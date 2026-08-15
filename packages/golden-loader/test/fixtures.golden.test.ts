import { describe, expect, test } from 'vitest';

import {
  AWAITING_ENGINE_INPUT,
  describeDiff,
  engineIsIdentityStub,
  loadFixtureDirectory,
  registryIds,
  runFixture,
  type GoldenFixture,
} from '../src/index.js';

// =============================================================================
// CI-03. THE GOLDEN STAGE.
// =============================================================================
//   pnpm exec vitest run --project golden
//
// STRATEGY section 4.1 makes this a stage that runs on every push and blocks
// independently of CI-02, which is why the projects in vitest.config.ts map to
// stages rather than to packages.
//
// THERE IS NO PER-FIXTURE TEST CODE HERE and there must never be any. STRATEGY
// section 3.2: that is what stops a fixture from quietly acquiring a bespoke
// assertion that weakens it. Everything below is written once and applied to
// whatever the directory holds.

const { fixtures, failures } = loadFixtureDirectory();
const stubbed = engineIsIdentityStub();

describe('the fixture directory', () => {
  test('every fixture loads', () => {
    expect(failures.map((f) => f.error.message)).toEqual([]);
  });

  test('there is at least one fixture, so a green stage means something', () => {
    // An empty directory satisfies every assertion in this file. The count is
    // not stated: `toBeGreaterThan(0)` is the property, and the number of
    // fixtures is derivable from the tree.
    expect(fixtures.length).toBeGreaterThan(0);
  });

  test('every fixture states a pin', () => {
    // STRATEGY section 3.2, loader rule 1. L-06 refuses one at load, so this
    // asserts the same thing from the other side: if the rule were ever
    // loosened, the loaded set would show it here rather than in a diff review.
    expect(fixtures.filter((f) => f.expected.pins.trim() === '')).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// The outcome assertions, whose polarity is READ OFF THE ENGINE
// -----------------------------------------------------------------------------
// TR-02 puts the fixture before the function on a money path: "the fixture
// exists, and FAILS, before the function does." packages/rules-engine currently
// ships the identity evaluation, so this stage asserts the failure rather than
// suffering it, and it does so without a per-fixture escape hatch. There is no
// `pending: true` a future session can reach for at 11pm, because the direction
// is not written in a fixture at all.
//
// WHEN M01 LANDS THIS FLIPS ON ITS OWN. No fixture is edited and no flag is
// removed; `engineIsIdentityStub()` stops holding and the same three fixtures
// become live assertions.

const named = (f: GoldenFixture): string => `${f.id} ${f.name}`;

describe.runIf(stubbed)('while the engine is the scaffold stub (TR-02)', () => {
  test('the stub is what is being asserted against, and that is derived rather than declared', () => {
    expect(stubbed).toBe(true);
  });

  test.each(fixtures.map((f) => [named(f), f] as [string, GoldenFixture]))(
    '%s does not yet match, because there is no engine to match',
    (_label, fixture) => {
      const { diffs } = runFixture(fixture);
      // A FIXTURE THAT MATCHES THE STUB IS THE FAILURE HERE. The stub returns
      // the state it was given and emits nothing, so a fixture it satisfies is
      // a fixture pinning nothing at all.
      expect(diffs.length).toBeGreaterThan(0);
    },
  );
});

describe.runIf(!stubbed)('against the real engine', () => {
  test.each(fixtures.map((f) => [named(f), f] as [string, GoldenFixture]))(
    '%s matches its expected end state',
    (_label, fixture) => {
      const { diffs } = runFixture(fixture);
      expect(diffs.map(describeDiff)).toEqual([]);
    },
  );
});

// -----------------------------------------------------------------------------
// What this stage does NOT cover, stated rather than implied
// -----------------------------------------------------------------------------
// The corpus runner's rule, applied here: a check that cannot verify the whole
// of what its row claims says so, and never returns green for something it did
// not look at.

// STATE HASHES ARE NOT COMPARED, and that is a decision rather than an
// omission. STRATEGY section 3.2 has the loader diff field by field "before
// comparing state hashes". A hash of the ENGINE's output can only be obtained
// by running the engine, which is the direction TR-01 forbids: a pin derived
// from the implementation proves only that the code agrees with itself. A hash
// of the FIXTURE's stated end state needs the full state shape, which is M01's.
// So the field-by-field diff is what runs, the expectation sibling has no
// `state_hash` key for a fixture to claim one through (L-04 refuses unknown
// keys), and the hash is an open item in the pull request rather than a line of
// dead code here.

describe('coverage this stage does not have', () => {
  test('it checks fixture to registry, and the reverse direction belongs to CI-06', () => {
    // STRATEGY section 3.2's loader rule 2 has two halves. This one holds: a
    // fixture whose id is not in the registry fails to load, which L-03 does
    // and which this asserts over the real set. The other half, a registry row
    // with no fixture, is the INVENTORY check and it is CI-06's; it cannot be
    // switched on until there is an engine to write expected end states
    // against, since today it would fail on every scenario the registry
    // defines. It arrives with P2.
    const registry = registryIds();
    expect(fixtures.filter((f) => !registry.has(f.id))).toEqual([]);
  });

  test('four fixture fields still reach no engine input, and they are named', () => {
    // GOLDEN_SCENARIOS section 2's format states them and the scaffold's engine
    // types declare none of them. The loader refuses any fixture field that is
    // neither mapped nor on this list, so nothing is dropped in silence; M01
    // empties it.
    expect([...AWAITING_ENGINE_INPUT]).toEqual([
      'account.phase',
      'account.opened_on',
      'days[].adjustment_cents',
      'settlements',
    ]);
  });
});
