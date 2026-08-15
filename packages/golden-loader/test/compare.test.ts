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
