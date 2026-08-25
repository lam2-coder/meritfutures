import { expect, test } from 'vitest';

import {
  civilFromDays,
  compactTradingDay,
  daysFromCivil,
  formatInstantUtc,
  parseInstantUtc,
  parseTradingDay,
  InstantFormatError,
} from '../src/simulator/time.ts';

// CI-02, the `unit` project.
//
// The reason this module exists rather than a `new Date()` is asserted here
// first, because it is the whole argument: `Date` ACCEPTS the 30th of February
// and lands on the 2nd of March, and it returns Invalid Date rather than
// throwing on a shape it cannot read. Both failures are silent, both are
// deterministic, and both would put a wrong value in a CSV column that a parser
// reads as a real one.

test('a date that does not exist is refused rather than rolled forward', () => {
  expect(() => parseTradingDay('2026-02-30')).toThrow(InstantFormatError);
  expect(() => parseTradingDay('2026-13-01')).toThrow(InstantFormatError);
  expect(() => parseTradingDay('2027-02-29')).toThrow(InstantFormatError);
  // 2028 is a leap year and the 29th is real, which is the other half of the pair.
  expect(() => parseTradingDay('2028-02-29')).not.toThrow();
});

test('a shape this module cannot render back is refused rather than parsed', () => {
  expect(() => parseInstantUtc('2026-11-02T13:30:00+00:00')).toThrow(InstantFormatError);
  expect(() => parseInstantUtc('2026-11-02T13:30:00.000Z')).toThrow(InstantFormatError);
  expect(() => parseInstantUtc('2026-11-02 13:30:00Z')).toThrow(InstantFormatError);
  expect(() => parseInstantUtc('not an instant')).toThrow(InstantFormatError);
});

test('an out-of-range time component is refused', () => {
  expect(() => parseInstantUtc('2026-11-02T24:00:00Z')).toThrow(InstantFormatError);
  expect(() => parseInstantUtc('2026-11-02T13:60:00Z')).toThrow(InstantFormatError);
  expect(() => parseInstantUtc('2026-11-02T13:30:60Z')).toThrow(InstantFormatError);
});

test('the civil-date conversions are exact inverses across a wide span', () => {
  // Every day from 1970 to 2100 rather than a handful of samples: the
  // conversions are the arithmetic every instant in every file passes through,
  // and an era boundary that is wrong by a day is wrong for a whole century.
  for (let days = 0; days <= 47_500; days += 1) {
    const { year, month, day } = civilFromDays(days);
    expect(daysFromCivil(year, month, day)).toBe(days);
  }
});

test('the epoch, a leap day and a century boundary', () => {
  expect(daysFromCivil(1970, 1, 1)).toBe(0);
  expect(formatInstantUtc(0)).toBe('1970-01-01T00:00:00Z');
  expect(formatInstantUtc(parseInstantUtc('2028-02-29T23:59:59Z'))).toBe('2028-02-29T23:59:59Z');
  // 2000 is a leap year and 1900 was not, which is the rule a naive `% 4`
  // implementation gets wrong exactly twice per four hundred years.
  expect(daysFromCivil(2000, 3, 1) - daysFromCivil(2000, 2, 28)).toBe(2);
  expect(daysFromCivil(1900, 3, 1) - daysFromCivil(1900, 2, 28)).toBe(1);
});

test('parse and format round-trip the instants the canonical run uses', () => {
  for (const instant of [
    '2026-11-02T13:30:00Z',
    '2026-11-02T20:00:00Z',
    '2026-11-04T20:30:00Z',
    '2026-12-31T23:59:59Z',
  ]) {
    expect(formatInstantUtc(parseInstantUtc(instant))).toBe(instant);
  }
});

test('the compact form is the file-name form, and it validates before it strips', () => {
  expect(compactTradingDay('2026-11-02')).toBe('20261102');
  expect(() => compactTradingDay('2026-02-30')).toThrow(InstantFormatError);
});

test('a non-integral epoch is refused rather than floored', () => {
  expect(() => formatInstantUtc(1.5)).toThrow(InstantFormatError);
  expect(() => formatInstantUtc(Number.NaN)).toThrow(InstantFormatError);
});
