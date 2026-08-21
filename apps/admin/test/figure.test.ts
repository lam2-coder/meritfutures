import { describe, expect, test } from 'vitest';

import {
  FigureError,
  absent,
  authoritative,
  figure,
  formatCents,
  readingIsPresent,
  render,
} from '../src/figure.js';

// =============================================================================
// M6-A: liability figure vocabulary
// =============================================================================
// Section 8.1's `M6-A-nn` suite is "liability aggregation correctness (the three
// numbers, against fixtures)". These are its floor: the properties every figure
// on the page has before any particular number is computed.
// =============================================================================

const AS_OF = { instant: '2026-08-20T21:00:00.000Z', source: 'liability_snapshots' };

const OPEN = {
  panel: 'P-M6-01',
  label: 'Open liability',
  definition: 'sum(withdrawable) across funded accounts plus wallet balances',
  cents: 500_000n,
  asOf: AS_OF,
  authority: 'authoritative' as const,
};

describe('M6-A-01: INV-M6-04, a figure cannot exist without its as-of and its source', () => {
  test('a well-formed figure carries both', () => {
    const reading = figure(OPEN);
    expect(readingIsPresent(reading)).toBe(true);
    if (!readingIsPresent(reading)) throw new Error('unreachable');
    expect(reading.figure.asOf.instant).toBe('2026-08-20T21:00:00.000Z');
    expect(reading.figure.asOf.source).toBe('liability_snapshots');
  });

  test('a blank source is refused', () => {
    expect(() => figure({ ...OPEN, asOf: { ...AS_OF, source: '   ' } })).toThrow(FigureError);
  });

  test('a day is not a moment', () => {
    expect(() => figure({ ...OPEN, asOf: { ...AS_OF, instant: '2026-08-20' } })).toThrow(
      FigureError,
    );
  });

  test('a local-offset instant is refused, because UTC is the storage convention', () => {
    expect(() =>
      figure({ ...OPEN, asOf: { ...AS_OF, instant: '2026-08-20T16:00:00.000-05:00' } }),
    ).toThrow(FigureError);
  });
});

describe('M6-A-02: AS-M6-04, the definition is a field and the renderer cannot drop it', () => {
  test('a figure with no definition is refused', () => {
    expect(() => figure({ ...OPEN, definition: '' })).toThrow(FigureError);
  });

  test('every rendering prints the definition, the as-of and the source', () => {
    const line = render(figure(OPEN));
    expect(line).toContain('5000.00');
    expect(line).toContain('sum(withdrawable) across funded accounts plus wallet balances');
    expect(line).toContain('2026-08-20T21:00:00.000Z');
    expect(line).toContain('liability_snapshots');
  });

  test('a panel outside constitution M6 fixed list is refused', () => {
    expect(() => figure({ ...OPEN, panel: 'P-M6-11' })).toThrow(FigureError);
    expect(() => figure({ ...OPEN, panel: 'liability' })).toThrow(FigureError);
  });
});

describe('M6-A-03: absent is a value and zero is not', () => {
  const GAP_FIELDS = {
    panel: 'P-M6-03',
    label: 'Largest single identity share',
    definition: 'the largest single identity share of the eligible-next-7-days total',
    reason: 'no column: SD-M6-01 identity-max did not land in 0009',
  };
  const gap = absent(GAP_FIELDS);

  test('an absent reading exposes no cents to read as zero', () => {
    expect(readingIsPresent(gap)).toBe(false);
    expect(Object.hasOwn(gap, 'cents')).toBe(false);
  });

  test('the rendering states the reason rather than a number', () => {
    expect(render(gap)).toContain('not available');
    expect(render(gap)).toContain('SD-M6-01');
    expect(render(gap)).not.toContain('0.00');
  });

  test('a blank reason is refused: "unavailable" spelled by the schema is the same silence', () => {
    expect(() => absent({ ...GAP_FIELDS, reason: '' })).toThrow(FigureError);
  });
});

describe('M6-A-04: INV-M6-12, a control cannot read an indicative figure', () => {
  const live = figure({
    ...OPEN,
    label: 'Open liability, live',
    authority: 'indicative',
  });

  test('the authoritative gate refuses it', () => {
    if (!readingIsPresent(live)) throw new Error('unreachable');
    expect(() => authoritative(live.figure)).toThrow(FigureError);
  });

  test('the authoritative gate passes an as-of-last-closed figure through unchanged', () => {
    const closed = figure(OPEN);
    if (!readingIsPresent(closed)) throw new Error('unreachable');
    expect(authoritative(closed.figure)).toBe(closed.figure);
  });

  test('the rendering says INDICATIVE in the text, not in a style', () => {
    expect(render(live)).toContain('INDICATIVE');
  });
});

describe('M6-A-05: money is integer cents and no float renders one', () => {
  test.each([
    [0n, '0.00'],
    [1n, '0.01'],
    [99n, '0.99'],
    [100n, '1.00'],
    [150_000n, '1500.00'],
    [-4_207n, '-42.07'],
    [9_007_199_254_740_993n, '90071992547409.93'],
  ])('%s cents renders as %s', (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });

  test('a value past IEEE-754 exact integers survives, which a float would not', () => {
    const beyond = 9_007_199_254_740_993n;
    expect(formatCents(beyond)).not.toBe(formatCents(beyond - 1n));
  });
});
