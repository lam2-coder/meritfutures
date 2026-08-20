import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

// CI-04, the `integration` project.
//
// A NEON BRANCH PER RUN IS WHAT THIS STAGE IS FOR (STRATEGY section 2), which
// means it needs a Neon token, which means it CANNOT RUN ON A FORK PULL REQUEST
// and must degrade honestly rather than appear green (P1 section 2.2). Wiring
// that degradation is the CI job's work, not this file's.
//
// Until then the stage holds the assertions that need no database and are still
// worth failing on: every migration filename carries a 4-digit sequence number,
// the set starts at 0001, and NO TWO FILES CLAIM THE SAME NUMBER. That last one
// is the whole local value of this file, and it is why the file predates any
// gate: a developer who has just added a colliding file learns about it here
// rather than at merge, where E2 makes a migration unrenumberable.
//
// -----------------------------------------------------------------------------
// WHY THE 1..n CONTIGUITY ASSERTION IS GONE, AND WHY THAT IS NOT A WEAKENED GATE
// -----------------------------------------------------------------------------
// It used to read `expect(numbers).toEqual(numbers.map((_, i) => i + 1))`, under
// a comment claiming CI-06h "asserts the same thing" and that this was "the
// weaker half". BOTH HALVES OF THAT CLAIM WERE FALSE, and the second one is
// what made it dangerous: this assertion was not weaker than CI-06h, it was
// STRICTER IN A DIRECTION ADR-036 EXPLICITLY RULES OUT.
//
// ADR-036's rule, quoted from the one parser both gates read
// (scripts/corpus/gates.mjs, "The allocation tables"): a number is claimed in
// ALLOCATION.md BEFORE the artifact is written, and "gaplessness is asserted
// over allocated PLUS reserved SO A BRANCH HOLDING A RESERVATION SHOWS A HOLE
// AND PASSES". ALLOCATION.md's own 0041 row says it again: "Gaplessness is
// asserted over allocated plus reserved, so an unspent reservation costs
// nothing."
//
// A HOLE ON DISK IS THEREFORE THE RULED, EXPECTED STATE, not a defect. FOLD-03
// is the case that surfaced it: 0038 is reserved for the money-path adjustment
// migration and is sequenced LAST (session F6), while 0039 lands in session F1.
// Any branch that writes 0039 before 0038 exists has a legal, reserved hole at
// 0038 -- and the old assertion failed on exactly that, so the ruled workflow
// could not produce a green test run.
//
// THE PROPERTY IS NOT LOST, IT IS ASSERTED BY THE GATE THAT OWNS IT. CI-06h
// checks gaplessness over disk PLUS ALLOCATION.md's reservations, checks that
// every number on disk is claimed by a row, and runs in the same CI. What is
// removed here is a SECOND, DISAGREEING EXPRESSION of one property -- which is
// OQ-P1-04's defect by name, in the corpus that ruled it, and the parser
// comment names writing a second scan as precisely the thing not to do.
//
// AND IT IS NOT RE-IMPLEMENTED HERE. Reading ALLOCATION.md from this file would
// mean a second copy of that parser, which is the defect above. gates.mjs ends
// in `process.exit(main())` and cannot be imported, so there is no honest way to
// share the one parser into vitest. The gapless-over-reserved half is deferred
// to CI-06h by name rather than approximated locally, per rule 1 of both
// runners: a check that cannot verify the whole of what it claims verifies the
// part it can and SAYS SO, and never returns PASS for something it did not look
// at.

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Every migration's sequence number, ascending. Throws on an unnumbered file. */
function migrationNumbers(): number[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => {
      const m = /^(\d{4})_/.exec(f);
      if (!m?.[1]) throw new Error(`${f} does not start with a 4-digit sequence number`);
      return Number(m[1]);
    })
    .sort((a, b) => a - b);
}

test('every migration filename carries a 4-digit sequence number, and the set is non-empty', () => {
  // The emptiness check is not decoration. `readdirSync` on a directory that has
  // moved returns nothing rather than throwing, and a set of zero migrations
  // satisfies every assertion below it vacuously.
  expect(migrationNumbers().length).toBeGreaterThan(0);
});

test('no two migrations claim the same number', () => {
  // THE ASSERTION THIS FILE EXISTS FOR. Two files numbered 0028 apply in an
  // order decided by the rest of the filename, and once merged neither can be
  // renumbered (constitution E2).
  const numbers = migrationNumbers();
  const duplicates = numbers.filter((n, i) => numbers.indexOf(n) !== i);
  expect(duplicates).toEqual([]);
});

test('the migration sequence starts at 0001', () => {
  // A missing 0001 that nobody reserved is a hole CI-06h reports; a set that
  // starts at 0002 because the first file was renamed is one this catches
  // locally and immediately.
  expect(migrationNumbers()[0]).toBe(1);
});

test('holes in the on-disk sequence are left to CI-06h, which reads the reservations', () => {
  // Not a placeholder: this pins the DIRECTION of the deferral so the 1..n
  // assertion cannot be reinstated by a later reader who reads "gapless" in the
  // ALLOCATION table and assumes it means gapless on disk. A reserved-but-
  // unwritten number is a hole here BY RULING (ADR-036), and 0038 is one today.
  const numbers = migrationNumbers();
  const highest = numbers[numbers.length - 1];
  expect(highest).toBeDefined();
  // The span may exceed the count. That is legal, and it is the whole point.
  expect(numbers.length).toBeLessThanOrEqual(highest as number);
});
