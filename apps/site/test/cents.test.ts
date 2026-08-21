import { expect, test } from 'vitest';

import { basisPoints, CentsFormatError, money } from '../src/render/cents.js';

// CI-02, the `unit` project. M9-C-nn's smallest half: the helper every figure on
// a public page goes through.

test('money renders integer cents exactly, with no rounding and no abbreviation', () => {
  expect(money(2_500_000n)).toBe('$25,000.00');
  expect(money(15_000_000n)).toBe('$150,000.00');
  expect(money(0n)).toBe('$0.00');
  expect(money(1n)).toBe('$0.01');
  expect(money(99n)).toBe('$0.99');
  expect(money(100n)).toBe('$1.00');
});

test('the separator groups from the right, at every digit count across a boundary', () => {
  expect(money(99_999n)).toBe('$999.99');
  expect(money(100_000n)).toBe('$1,000.00');
  expect(money(99_999_999n)).toBe('$999,999.99');
  expect(money(100_000_000n)).toBe('$1,000,000.00');
});

// THE REASON THIS FILE EXISTS RATHER THAN A SNAPSHOT. `Number(cents) / 100` is
// exact up to 2^53 cents and wrong above it, and the wrongness is silent. A
// figure past that boundary is not a realistic account size and IS a realistic
// lifetime-payouts total on the stats page (ST-03, `0021_transparency.sql`,
// which stores it as bigint cents for this reason).
test('money is exact past the float boundary, which is where the naive version fails', () => {
  const beyond = 9_007_199_254_740_993n; // 2^53 + 1, in cents
  expect(money(beyond)).toBe('$90,071,992,547,409.93');
  expect(money(beyond)).not.toBe(money(beyond - 1n));
});

test('a negative renders honestly rather than being clamped', () => {
  expect(money(-2_500_000n)).toBe('-$25,000.00');
  expect(money(-1n)).toBe('-$0.01');
});

test('basis points render as a percentage with no trailing zero and no float', () => {
  expect(basisPoints(1470)).toBe('14.7%');
  expect(basisPoints(1400)).toBe('14%');
  expect(basisPoints(10_000)).toBe('100%');
  expect(basisPoints(7)).toBe('0.07%');
  expect(basisPoints(70)).toBe('0.7%');
  expect(basisPoints(0)).toBe('0%');
});

// The one-liner this guards against renders 1400 as `14.0%`, which reads as a
// precision the config does not claim.
test('a whole percentage never renders a trailing fraction', () => {
  for (const bp of [100, 500, 1000, 2000, 5000]) {
    expect(basisPoints(bp)).not.toContain('.');
  }
});

test('a non-integer basis point is a defect upstream and is refused', () => {
  expect(() => basisPoints(14.7)).toThrow(CentsFormatError);
});
