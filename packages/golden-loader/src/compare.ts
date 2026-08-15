// =============================================================================
// packages/golden-loader/src/compare.ts
// =============================================================================
// STRATEGY section 3.2: the loader "diffs the result against the expected
// end-state JSON field by field". This is that diff, and it is deliberately
// separable from everything that reads a file, so the assertion that it FAILS
// on a wrong expectation can be made against hand-built states rather than
// against whatever the engine happens to do today.
//
// FIELD BY FIELD, NOT DEEP EQUALITY OF THE WHOLE OBJECT. Two reasons, and the
// second is the load-bearing one:
//
//   1. The report names the field. "floor_cents: expected 4770000, got 4750000"
//      is a finding; "objects differ" is a puzzle.
//   2. An expectation states the fields the scenario exists to pin, and the
//      engine's state carries more than that. GS-008 pins the floor at account
//      open and states nothing about the high-water basis, because the corpus
//      states nothing about it. Whole-object equality would force every fixture
//      to assert every field, and a fixture author filling in fields the plan
//      document does not state is inventing pins, which is TR-01 inverted.
//
// AN EXPECTED FIELD THE RESULT DOES NOT CARRY IS A DIFF, NOT A SKIP. That is
// the direction that decides whether the whole loader is worth anything: while
// packages/rules-engine is a stub whose result has no `floorCents` at all, a
// missing-field-is-a-pass rule would report every fixture green against an
// engine that computes nothing.
// =============================================================================

/** One field where the engine and the fixture disagree. */
export interface Diff {
  /** The field as the fixture names it, snake_case, so the message matches the file. */
  readonly field: string;
  readonly expected: unknown;
  readonly actual: unknown;
  /** Present when the field is missing rather than merely different. */
  readonly note?: string;
}

/** `high_water_balance_cents` -> `highWaterBalanceCents`. */
export function snakeToCamel(field: string): string {
  return field.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function show(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/** A one-line rendering of a diff, for a test failure message. */
export function describeDiff(diff: Diff): string {
  if (diff.note !== undefined)
    return `${diff.field}: ${diff.note} (expected ${show(diff.expected)})`;
  return `${diff.field}: expected ${show(diff.expected)}, engine produced ${show(diff.actual)}`;
}

/**
 * Diff an engine result's state against a fixture's expected end state.
 *
 * The expectation is keyed as the fixture writes it and the result is keyed as
 * the engine declares it, so this is also the one place the two spellings meet.
 */
export function diffEndState(
  actual: Readonly<Record<string, unknown>>,
  expected: Readonly<Record<string, unknown>>,
): Diff[] {
  const diffs: Diff[] = [];

  for (const field of Object.keys(expected)) {
    const wanted = expected[field];
    const key = snakeToCamel(field);

    if (!Object.prototype.hasOwnProperty.call(actual, key)) {
      diffs.push({
        field,
        expected: wanted,
        actual: undefined,
        note: `the engine result carries no "${key}"`,
      });
      continue;
    }

    const got = actual[key];
    if (!Object.is(got, wanted)) diffs.push({ field, expected: wanted, actual: got });
  }

  return diffs;
}

/**
 * Diff the emitted event types against the expected sequence.
 *
 * ORDER IS PART OF THE EXPECTATION. Every scenario in the registry that pins
 * more than one event pins an ordering with it, and a set comparison would let
 * a breach be emitted after the day it breached on.
 */
export function diffEvents(
  actual: readonly { readonly type: string }[],
  expected: readonly string[],
): Diff[] {
  const diffs: Diff[] = [];

  if (actual.length !== expected.length) {
    diffs.push({
      field: 'events',
      expected,
      actual: actual.map((e) => e.type),
      note: `expected ${expected.length} event(s), engine emitted ${actual.length}`,
    });
    return diffs;
  }

  expected.forEach((type, i) => {
    const emitted = actual[i];
    if (emitted === undefined || emitted.type !== type) {
      diffs.push({ field: `events[${i}]`, expected: type, actual: emitted?.type });
    }
  });

  return diffs;
}
