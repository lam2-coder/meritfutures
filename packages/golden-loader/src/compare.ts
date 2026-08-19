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
// -----------------------------------------------------------------------------
// NESTED EXPECTATIONS, AND WHY A LEAF PATH IS THE DELIVERABLE
// -----------------------------------------------------------------------------
// `engine_gates` is a nested object and this function compared flat fields with
// `Object.is`, so a fixture pinning a per-gate verdict COULD NEVER MATCH by any
// value: two object literals are never `Object.is`-equal. That is not a bug in
// any one fixture, it is a comparison path that had no reachable success case,
// and `GS-021` and `GS-022` say so in their own siblings -- they reach R-30's
// denominator STATE and record that they cannot reach its FLAG.
//
// A DIFFERENCE MUST NAME THE LEAF, NOT THE OBJECT. Reporting
// `engine_gates: expected {...}, engine produced {...}` hands a reader two
// twenty-five-field objects and asks them to find the disagreement, which is a
// divergence report that costs more than it saves. `apps/worker`'s
// `ENGINE_GATE_LEAVES` carries dotted paths for exactly this reason and this
// walk follows that idiom rather than inventing a second one.
//
// THE PATH IS IN THE FIXTURE'S SPELLING, NOT THE ENGINE'S. `field` is already
// reported as the expectation writes it while `key` is the engine's camel case,
// and a reader chasing a diff is looking at their own YAML. So a nested path
// reads `engine_gates.traded_days.skipped` and can be found by search in the
// file that stated it.
//
// ONLY PLAIN OBJECTS RECURSE. An array, a `null`, a `bigint` and a `Date` are
// all `typeof 'object'` or otherwise deceptive, and descending into any of them
// would turn a value comparison into a structural one. Arrays in particular:
// `events` is compared by `diffEvents` with its own ordering rule, and a silent
// element-wise walk here would be a second, weaker copy of it.

/** `true` for a `{...}` literal, and false for null, arrays and every wrapper. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function diffEndState(
  actual: Readonly<Record<string, unknown>>,
  expected: Readonly<Record<string, unknown>>,
): Diff[] {
  return diffNested(actual, expected, '');
}

/**
 * One level of the walk. `prefix` is the dotted path already travelled, in the
 * fixture's spelling, and is empty at the root.
 */
function diffNested(
  actual: Readonly<Record<string, unknown>>,
  expected: Readonly<Record<string, unknown>>,
  prefix: string,
): Diff[] {
  const diffs: Diff[] = [];

  for (const name of Object.keys(expected)) {
    const field = prefix === '' ? name : `${prefix}.${name}`;
    const wanted = expected[name];
    const key = snakeToCamel(name);

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

    // A NESTED EXPECTATION DESCENDS. The expectation drives the walk, so a
    // fixture pins the leaves it cares about and stays silent about the other
    // twenty-four; asserting the whole object would make every fixture restate
    // fields it has no claim about.
    if (isPlainObject(wanted)) {
      if (!isPlainObject(got)) {
        // The shapes disagree, which is a different finding from a wrong value:
        // the fixture expects a record and the engine has something else there.
        diffs.push({
          field,
          expected: wanted,
          actual: got,
          note: 'the expectation states a nested object and the engine result does not carry one here',
        });
        continue;
      }
      diffs.push(...diffNested(got, wanted, field));
      continue;
    }

    // AND THE REVERSE SHAPE MISMATCH, which would otherwise reach `Object.is`
    // and report "expected 3, engine produced [object Object]".
    if (isPlainObject(got)) {
      diffs.push({
        field,
        expected: wanted,
        actual: got,
        note: 'the engine result carries a nested object where the expectation states a value',
      });
      continue;
    }

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
