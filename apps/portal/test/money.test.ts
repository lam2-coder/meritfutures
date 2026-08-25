import { expect, test } from 'vitest';

import {
  formatBasisPoints,
  formatCents,
  formatOptionalBasisPoints,
  formatOptionalCents,
} from '../src/format/money.ts';

// =============================================================================
// M4-R: the formatter is exact, and it refuses what it cannot render exactly
// =============================================================================
// M04's governing sentence: "render exactly what the engine computed, never
// recompute it, and NEVER ROUND IT." These cases are the boundary pairs where a
// float-based implementation drifts, plus the refusal that makes drift loud.

test('cents render exactly, at every magnitude that has ever been a bug', () => {
  expect(formatCents(0)).toBe('0.00');
  expect(formatCents(5)).toBe('0.05');
  expect(formatCents(50)).toBe('0.50');
  expect(formatCents(99)).toBe('0.99');
  expect(formatCents(100)).toBe('1.00');
  expect(formatCents(999)).toBe('9.99');
  expect(formatCents(1000)).toBe('10.00');
  expect(formatCents(150000)).toBe('1,500.00');
  expect(formatCents(100000000)).toBe('1,000,000.00');
});

test('a negative floor distance keeps its sign', () => {
  // A breached account's balance is below its floor. Dropping the sign here
  // would show the trader the magnitude of a shortfall as though it were
  // headroom, which is FM-M4-01 in its most damaging single character.
  expect(formatCents(-4207)).toBe('-42.07');
  expect(formatCents(-5)).toBe('-0.05');
  expect(formatCents(-150000)).toBe('-1,500.00');
});

test('the amounts a float implementation would be trusted on are exact here', () => {
  // A CLAIM THAT WAS CHECKED AND CAME BACK FALSE, KEPT BECAUSE THE FALSE
  // VERSION IS THE ONE A REVIEWER EXPECTS. The obvious argument for integer
  // formatting is that `(cents / 100).toFixed(2)` drifts by a cent somewhere.
  // Over every integer from 0 to 2,000,000 cents it does not: the two agree on
  // all of them. So this suite does not assert a divergence that is not there.
  //
  // The real argument is the one below this: agreement inside the safe-integer
  // range is not a property anybody can check at the call site, and it stops
  // holding outside it. An exact implementation needs no range to be true on.
  expect(formatCents(70705)).toBe('707.05');
  expect(formatCents(1005)).toBe('10.05');
  expect(formatCents(102425)).toBe('1,024.25');
  expect(formatCents(8635)).toBe('86.35');
});

test('cents beyond the safe-integer range are exact, where float division is not', () => {
  // THIS is where the two implementations part company, and it is why the
  // formatter is integer-only rather than merely careful. `9007199254740993 /
  // 100` in double arithmetic starts by losing the final digit of the numerator,
  // because the value is not representable, and reports ...09.92.
  expect(Number(9007199254740993n) / 100).toBeCloseTo(90071992547409.92, 2);
  expect(formatCents(9007199254740993n)).toBe('90,071,992,547,409.93');

  // And it is what makes M01 INV-02's "bigint at every boundary" a transport
  // change rather than a rewrite of this app: when the wire moves off JSON
  // numbers, the call sites do not move.
  expect(formatCents(9007199254740993n)).toBe(formatCents(BigInt('9007199254740993')));
});

test('a value that is not an exact integer is refused, not rendered', () => {
  // The failure mode this exists to prevent is not a wrong string. It is a
  // RIGHT-LOOKING string: 1234.5600000000001 cents rendering as '12.35' hides
  // the arithmetic that produced it, and the whole of INV-M4-01 is that the
  // arithmetic should not have happened.
  expect(() => formatCents(1234.56)).toThrow(RangeError);
  expect(() => formatCents(0.1 + 0.2)).toThrow(RangeError);
  expect(() => formatCents(Number.NaN)).toThrow(RangeError);
  expect(() => formatCents(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  expect(() => formatCents(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
});

test('the refusal names the invariant, because the reader is a builder', () => {
  expect(() => formatCents(1.5)).toThrow(/INV-M4-01/);
});

test('basis points render to the hundredth of a percent', () => {
  expect(formatBasisPoints(3400)).toBe('34.00%');
  expect(formatBasisPoints(50)).toBe('0.50%');
  expect(formatBasisPoints(0)).toBe('0.00%');
  expect(formatBasisPoints(10000)).toBe('100.00%');
  expect(formatBasisPoints(2)).toBe('0.02%');
});

test('an absent money value renders as an absence and never as zero', () => {
  // `profit_needed_to_dilute_cents` of null means the consistency gate was not
  // evaluated. Rendered as '0.00' it reads as "nothing further is needed",
  // which is the exact inversion INV-M4-05 exists to prevent one field over.
  expect(formatOptionalCents(null)).toBeNull();
  expect(formatOptionalCents(0)).toBe('0.00');
  expect(formatOptionalBasisPoints(null)).toBeNull();
  expect(formatOptionalBasisPoints(0)).toBe('0.00%');
});
