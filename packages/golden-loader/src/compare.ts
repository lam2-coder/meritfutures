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
  // A `bigint` RENDERS WITH ITS `n`, and that is the whole reason this branch
  // exists. `String(4770000n)` and `String(4770000)` are the same four-and-a-bit
  // characters, so before this the report for a type mismatch read "expected
  // 4770000, engine produced 4770000" -- a diff whose two sides are printed
  // identically, which reads as a bug in the differ rather than as the finding
  // it is. Whatever this file decides about comparing the two, it may not
  // describe them in a way a reader cannot tell apart.
  if (typeof value === 'bigint') return `${value}n`;
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

// -----------------------------------------------------------------------------
// `bigint` ON ONE SIDE AND A JSON NUMBER ON THE OTHER
// -----------------------------------------------------------------------------
// INV-02: "all money is `bigint` integer cents at every boundary", so every
// money field the engine returns is a `bigint`. A fixture is a text file and
// JSON HAS NO LITERAL FOR ONE, so every money field an expectation pins is a
// `number`. `Object.is(4770000n, 4770000)` is FALSE, and the loader's own
// header already names this boundary on the input side: `requireInteger` checks
// and `BigInt` widens, "and there is no other" crossing. There was one, on the
// way back out, and it had no check at all.
//
// WHAT THAT COST IS EVERY MONEY ASSERTION THIS STAGE WILL EVER MAKE. Under the
// inverted polarity it is invisible: a fixture that must FAIL fails, and it
// fails for a reason nobody planted. The moment a fixture's polarity flips to
// `direct` it becomes a fixture that can never match, whatever the engine
// computes, because the one field class every money scenario pins is compared
// across two types that are never `Object.is`-equal.
//
// THE COERCION GOES ONE WAY AND ONLY ONE. A `bigint` from the engine is
// compared against an integer `number` from the expectation. The reverse is not
// handled and must not be: an expectation cannot hold a `bigint` (it came
// through `JSON.parse`), and a `number` on the ENGINE's side of a money field
// would be INV-02 broken, which is a finding rather than something to smooth
// over. `Number.isSafeInteger` is the guard that keeps this from widening into
// a coercion: an expected value that is fractional, or beyond the range JSON
// round-trips faithfully, is reported as the mismatch it is rather than
// silently truncated by `BigInt()`.

/** `true` when a `bigint` result and a JSON expectation state the same cents. */
function bigintAgrees(actual: bigint, expected: number): boolean {
  return Number.isSafeInteger(expected) && actual === BigInt(expected);
}

/**
 * A one-line rendering of a diff, for a test failure message.
 *
 * A NOTED DIFF STILL SHOWS BOTH SIDES, AND IT DID NOT UNTIL THE FOLD WAS REAL.
 * The event-count note read "expected 9 event(s), engine emitted 7 (expected
 * a,b,c...)": the count of what the engine emitted, and then the EXPECTED list
 * again. Which seven it emitted -- the one thing that says where the stream
 * diverged -- was computed, carried on `diff.actual`, and never printed. Against
 * the identity stub the answer was always "none" and the omission cost nothing;
 * the first fixture folded through `advanceDay` made it the difference between a
 * finding and a puzzle.
 */
export function describeDiff(diff: Diff): string {
  if (diff.note !== undefined) {
    return (
      `${diff.field}: ${diff.note} (expected ${show(diff.expected)}, ` +
      `engine produced ${show(diff.actual)})`
    );
  }
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

    if (typeof got === 'bigint' && typeof wanted === 'number') {
      if (bigintAgrees(got, wanted)) continue;
      diffs.push({
        field,
        expected: wanted,
        actual: got,
        // A fractional or out-of-range expectation is a different finding from
        // a wrong one, and reporting them the same way sends a reader looking
        // for an engine defect. Money is integer cents (INV-02) and a fixture
        // stating anything else has stated a value this comparison cannot
        // faithfully make, which is the fixture's defect and says so.
        ...(Number.isSafeInteger(wanted)
          ? {}
          : {
              note: 'the expectation is not a safe integer, so it states no whole number of cents',
            }),
      });
      continue;
    }

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
