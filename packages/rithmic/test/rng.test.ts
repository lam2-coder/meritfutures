import { expect, test } from 'vitest';

import { drawKey, draws, DrawError } from '../src/simulator/rng.ts';

// CI-02, the `unit` project.
//
// The determinism claim rests on this module, so the assertions are about the
// PROPERTIES it promises rather than about any particular value it happens to
// produce. A test pinning `draws('x').uint32() === 1234567` would pass and
// prove nothing about whether two keys are independent, which is the property
// the whole design is for.

test('the same key produces the same sequence', () => {
  const first = draws('alpha');
  const second = draws('alpha');
  for (let i = 0; i < 64; i += 1) expect(first.uint32()).toBe(second.uint32());
});

test('different keys produce different sequences', () => {
  // The counter-assertion to the one above. Without it, a generator that
  // ignored its key entirely would pass the first test.
  const first = draws('alpha');
  const second = draws('beta');
  const a = Array.from({ length: 32 }, () => first.uint32());
  const b = Array.from({ length: 32 }, () => second.uint32());
  expect(a).not.toEqual(b);
});

test('a sequence advances rather than repeating one value', () => {
  const sequence = draws('alpha');
  const values = new Set(Array.from({ length: 64 }, () => sequence.uint32()));
  expect(values.size).toBeGreaterThan(60);
});

test('every draw lands inside its stated range', () => {
  const sequence = draws('range');
  for (let i = 0; i < 2_000; i += 1) {
    const value = sequence.intBetween(-5, 7);
    expect(value).toBeGreaterThanOrEqual(-5);
    expect(value).toBeLessThanOrEqual(7);
    expect(Number.isSafeInteger(value)).toBe(true);
  }
});

test('a single-value range returns that value and consumes a draw', () => {
  const sequence = draws('single');
  expect(sequence.intBetween(4, 4)).toBe(4);
  expect(sequence.intBetween(4, 4)).toBe(4);
});

test('the rejection sampling is unbiased enough that no bucket is starved', () => {
  // A `% span` implementation over a span that does not divide 2^32 skews the
  // low buckets. Three buckets over 30,000 draws puts the expected count at
  // 10,000 each, and a five-percent band is far tighter than modulo bias but
  // far looser than the sampling noise, so this fails on the defect and not on
  // the seed.
  const sequence = draws('bias');
  const counts = [0, 0, 0];
  for (let i = 0; i < 30_000; i += 1) {
    const index = sequence.intBetween(0, 2);
    counts[index] = (counts[index] ?? 0) + 1;
  }
  for (const count of counts) {
    expect(count).toBeGreaterThan(9_500);
    expect(count).toBeLessThan(10_500);
  }
});

test('cents are drawn as bigints and never through a number', () => {
  const sequence = draws('cents');
  for (let i = 0; i < 500; i += 1) {
    const value = sequence.centsBetween(-1_000_000n, 1_000_000n);
    expect(typeof value).toBe('bigint');
    expect(value >= -1_000_000n && value <= 1_000_000n).toBe(true);
  }
});

test('a cents range wider than a double can hold is still exact', () => {
  const sequence = draws('wide');
  const low = 9_007_199_254_740_993n;
  const value = sequence.centsBetween(low, low + 3n);
  expect(value >= low && value <= low + 3n).toBe(true);
});

test('a basis-point chance is a chance and not a coin flip', () => {
  const never = draws('never');
  const always = draws('always');
  for (let i = 0; i < 200; i += 1) {
    expect(never.chanceInBasisPoints(0)).toBe(false);
    expect(always.chanceInBasisPoints(10_000)).toBe(true);
  }
});

test('an impossible draw throws rather than returning something plausible', () => {
  const sequence = draws('guards');
  expect(() => sequence.intBetween(5, 1)).toThrow(DrawError);
  expect(() => sequence.intBetween(0.5, 1)).toThrow(DrawError);
  expect(() => sequence.centsBetween(5n, 1n)).toThrow(DrawError);
  expect(() => sequence.chanceInBasisPoints(10_001)).toThrow(DrawError);
  expect(() => sequence.chanceInBasisPoints(-1)).toThrow(DrawError);
  expect(() => sequence.pick([])).toThrow(DrawError);
  expect(() => sequence.sumOfDraws(0, 1, 2)).toThrow(DrawError);
});

test('a non-ASCII key is refused rather than hashed as surrogates', () => {
  expect(() => draws('café')).toThrow(DrawError);
});

test('a key component carrying the separator is refused', () => {
  // Two different tuples that flatten to one key are two draws that silently
  // correlate, which is precisely what the keying exists to prevent.
  expect(() => drawKey('a|b', 'c')).toThrow(DrawError);
  expect(drawKey('a', 'b', 'c')).toBe('a|b|c');
});
