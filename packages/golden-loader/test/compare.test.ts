import { describe, expect, test } from 'vitest';

import { describeDiff, diffEndState, diffEvents, snakeToCamel } from '../src/index.js';

// =============================================================================
// THE PROOF THAT THE LOADER FAILS WHEN AN EXPECTED END STATE DOES NOT MATCH
// =============================================================================
// It is asserted HERE, against hand-built states, rather than against the
// engine, and that separation is the point. packages/rules-engine is a stub, so
// an "it fails" test driven through the engine would pass for the wrong reason:
// everything fails against a stub. These cases hold the engine's side fixed and
// move the expectation by one cent, which is the only way to see that the diff
// is reading the field it claims to read.

const state = {
  phase: 'funded',
  floorCents: 4_770_000,
  highWaterBalanceCents: 5_020_000,
  breached: false,
};

const expectation = {
  phase: 'funded',
  floor_cents: 4_770_000,
  high_water_balance_cents: 5_020_000,
  breached: false,
};

describe('diffEndState', () => {
  test('agrees when every pinned field agrees', () => {
    expect(diffEndState(state, expectation)).toEqual([]);
  });

  test('FAILS on one cent, and names the field', () => {
    const diffs = diffEndState(state, { ...expectation, floor_cents: 4_770_001 });
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.field).toBe('floor_cents');
    expect(describeDiff(diffs[0] as never)).toBe(
      'floor_cents: expected 4770001, engine produced 4770000',
    );
  });

  test('FAILS on a wrong boolean, which `==` and a truthiness check would both miss', () => {
    const diffs = diffEndState(state, { ...expectation, breached: true });
    expect(diffs.map((d) => d.field)).toEqual(['breached']);
  });

  test('FAILS on a field the engine result does not carry at all', () => {
    // The direction that decides whether the loader is worth anything today:
    // the stub's result carries none of these fields, and a
    // missing-field-is-a-pass rule would report every fixture green against an
    // engine that computes nothing.
    const diffs = diffEndState({ phase: 'funded' }, expectation);
    expect(diffs.map((d) => d.field)).toEqual([
      'floor_cents',
      'high_water_balance_cents',
      'breached',
    ]);
    expect(diffs[0]?.note).toContain('carries no "floorCents"');
  });

  test('ignores state the fixture does not pin', () => {
    // A fixture states the fields its scenario protects. GS-008 pins the floor
    // at account open and nothing else, because its registry row states nothing
    // else, and inventing the rest would be TR-01 read backwards.
    expect(diffEndState({ ...state, winDaysCount: 3 }, { floor_cents: 4_770_000 })).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // MONEY: `bigint` FROM THE ENGINE AGAINST A JSON NUMBER FROM THE FIXTURE
  // ---------------------------------------------------------------------------
  // INV-02 makes every money field a `bigint` and JSON has no literal for one,
  // so this is not an edge: it is EVERY money field of EVERY fixture. The cases
  // below are the ones that decide whether this stage can ever assert a cent,
  // and the second is the one that keeps the first from being a coercion.

  test('agrees when a bigint result states the same cents as an integer expectation', () => {
    expect(diffEndState({ floorCents: 4_770_000n }, { floor_cents: 4_770_000 })).toEqual([]);
  });

  test('FAILS on one cent across the type boundary, in both directions', () => {
    expect(diffEndState({ floorCents: 4_770_000n }, { floor_cents: 4_770_001 })).toHaveLength(1);
    expect(diffEndState({ floorCents: 4_770_001n }, { floor_cents: 4_770_000 })).toHaveLength(1);
  });

  test('FAILS on a negative expectation a magnitude comparison would accept', () => {
    expect(diffEndState({ floorCents: 4_770_000n }, { floor_cents: -4_770_000 })).toHaveLength(1);
  });

  test('FAILS on a fractional expectation rather than truncating it to cents', () => {
    // `BigInt(4770000.5)` THROWS, and a comparison that reached it would take
    // the stage down with a RangeError instead of reporting a finding. A
    // fixture stating half a cent has stated something money is not, and the
    // note says which of the two sides is wrong.
    const diffs = diffEndState({ floorCents: 4_770_000n }, { floor_cents: 4_770_000.5 });
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.note).toContain('no whole number of cents');
  });

  test('FAILS on an expectation beyond the range JSON round-trips', () => {
    // 2^53 and 2^53 + 1 are the same `number`. An expectation out there cannot
    // be compared faithfully whatever the engine returns, so it is a finding
    // rather than an agreement that happens to hold.
    const diffs = diffEndState(
      { lifetimeSettledCents: BigInt(Number.MAX_SAFE_INTEGER) + 2n },
      { lifetime_settled_cents: Number.MAX_SAFE_INTEGER + 2 },
    );
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.note).toContain('no whole number of cents');
  });

  test('renders the two types so a reader can tell them apart', () => {
    // Before the `n`, a type mismatch printed "expected 4770000, engine
    // produced 4770000": a diff whose two sides read identically, which sends
    // the reader looking for a defect in the differ.
    const diffs = diffEndState({ floorCents: 4_770_000n }, { floor_cents: 4_770_001 });
    expect(describeDiff(diffs[0] as never)).toBe(
      'floor_cents: expected 4770001, engine produced 4770000n',
    );
  });

  test('does not coerce a plain number on the ENGINE side of a money field', () => {
    // The direction deliberately not handled. A `number` where INV-02 requires
    // a `bigint` is a broken engine, and a comparison that accepted it would
    // hide exactly the defect the invariant exists to catch. The expectation is
    // never a `bigint`: it came through `JSON.parse`.
    expect(diffEndState({ floorCents: 4_770_000 }, { floor_cents: 4_770_000 })).toEqual([]);
    expect(diffEndState({ floorCents: 4_770_000n }, { floor_cents: '4770000' })).toHaveLength(1);
  });

  test('reads snake_case as the engine spells it', () => {
    expect(snakeToCamel('high_water_balance_cents')).toBe('highWaterBalanceCents');
    expect(snakeToCamel('phase')).toBe('phase');
  });
});

describe('diffEvents', () => {
  test('agrees on the same types in the same order', () => {
    expect(diffEvents([{ type: 'day.closed' }], ['day.closed'])).toEqual([]);
  });

  test('FAILS when an expected event was not emitted', () => {
    const diffs = diffEvents([], ['day.closed']);
    expect(diffs[0]?.note).toContain('expected 1 event(s), engine emitted 0');
  });

  test('FAILS on order, because every multi-event scenario pins one', () => {
    const diffs = diffEvents(
      [{ type: 'account.breached' }, { type: 'day.closed' }],
      ['day.closed', 'account.breached'],
    );
    expect(diffs.map((d) => d.field)).toEqual(['events[0]', 'events[1]']);
  });
});
