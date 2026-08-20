// =============================================================================
// packages/harness/test/ratio.test.ts
// =============================================================================
// THE EXACT ARITHMETIC, AT ITS EDGES. Every case here is one where a float or a
// truncation would have given a different answer, because a rational library
// whose tests only exercise the easy cases is a rational library nobody needed.
// =============================================================================

import { describe, expect, it } from 'vitest';
import {
  add,
  compare,
  equals,
  floorDiv,
  format,
  fromInteger,
  maximum,
  multiply,
  ratio,
  RatioError,
  subtract,
  toBasisPoints,
} from '../src/ratio.js';

describe('a ratio', () => {
  it('reduces, so two spellings of one value compare and serialize the same', () => {
    // `run.ts` reports an output as identical across sweep arms by comparing
    // values. Two spellings of one number would make that report wrong in the
    // direction that matters: it would say the arms differed when they did not.
    expect(ratio(2n, 4n)).toEqual({ numerator: 1n, denominator: 2n });
    expect(ratio(29n, 10n)).toEqual({ numerator: 29n, denominator: 10n });
    expect(equals(ratio(135_000n, 5n), ratio(27_000n, 1n))).toBe(true);
  });

  it('keeps the sign on the numerator', () => {
    expect(ratio(1n, -2n)).toEqual({ numerator: -1n, denominator: 2n });
  });

  it('refuses a zero denominator rather than answering zero', () => {
    // `HO-07`'s rule. An output with no sample is absent at the call site and is
    // never a ratio, so a ratio that answered `0/1` here would erase the
    // distinction in the one place a reader cannot see it.
    expect(() => ratio(0n, 0n)).toThrow(RatioError);
    expect(() => ratio(5n, 0n)).toThrow(RatioError);
  });

  it('adds, subtracts and multiplies exactly', () => {
    expect(add(ratio(1n, 3n), ratio(1n, 6n))).toEqual({ numerator: 1n, denominator: 2n });
    expect(subtract(ratio(1n, 3n), ratio(1n, 2n))).toEqual({ numerator: -1n, denominator: 6n });
    expect(multiply(ratio(2n, 3n), ratio(3n, 4n))).toEqual({ numerator: 1n, denominator: 2n });
  });

  it('compares by cross multiplication, so no division rounds a comparison', () => {
    // The case a cents-per-day integer comparison gets wrong: 1/3 and 2/6 are
    // one rate, and 1/3 is strictly above 33/100.
    expect(compare(ratio(1n, 3n), ratio(2n, 6n))).toBe(0);
    expect(compare(ratio(1n, 3n), ratio(33n, 100n))).toBe(1);
    expect(maximum(ratio(1n, 3n), ratio(33n, 100n))).toEqual({ numerator: 1n, denominator: 3n });
  });

  it('floors a negative division rather than truncating it', () => {
    // The language's `/` truncates toward zero, which is not floor for
    // negatives. A contribution can be negative and a margin with it, so this is
    // on the money path rather than beside it.
    expect(floorDiv(-7n, 2n)).toBe(-4n);
    expect(floorDiv(7n, 2n)).toBe(3n);
    expect(floorDiv(-8n, 2n)).toBe(-4n);
    expect(floorDiv(-1n, 3n)).toBe(-1n);
  });

  it('floors basis points, so a value outside a band never renders inside it', () => {
    // `TR-03`'s shape: 14.99999 percent nearest-rounds to 15.00 and floors to
    // 14.9999, and only one of those two is still outside a band that ends at
    // 14.99 percent.
    expect(toBasisPoints(ratio(1n, 3n))).toBe(3_333n);
    expect(toBasisPoints(ratio(2n, 3n))).toBe(6_666n);
    expect(toBasisPoints(ratio(-1n, 3n))).toBe(-3_334n);
    expect(toBasisPoints(fromInteger(1n))).toBe(10_000n);
  });

  it('formats with the sign carried and the magnitude truncated', () => {
    expect(format(ratio(29n, 10n), 2)).toBe('2.90');
    expect(format(ratio(1n, 3n), 4)).toBe('0.3333');
    expect(format(ratio(-5n, 2n), 2)).toBe('-2.50');
    expect(format(ratio(0n, 5n), 2)).toBe('0.00');
    expect(format(ratio(29n, 10n), 0)).toBe('2');
  });

  it('refuses a decimal count it cannot render exactly', () => {
    expect(() => format(ratio(1n, 3n), -1)).toThrow(RatioError);
    expect(() => format(ratio(1n, 3n), 13)).toThrow(RatioError);
  });
});
