import { describe, expect, test } from 'vitest';

import { TRUST_KEYS, type TrustSignal, assessDataTrust } from '../src/data-trust.ts';
import {
  FigureError,
  type Figure,
  authoritative,
  readingIsPresent,
  render,
} from '../src/figure.ts';
import { liveOpenLiability } from '../src/live-liability.ts';
import { theThreeNumbers } from '../src/liability.ts';

// =============================================================================
// M6-A: section 3.5, the live figure that decides nothing
// =============================================================================

const TRUST_AS_OF = { instant: '2026-08-21T13:00:00.000Z', source: 'M2 recon status' };

const GREEN = assessDataTrust(
  TRUST_KEYS.map((key): TrustSignal => ({ key, state: 'ok', detail: '0', asOf: TRUST_AS_OF })),
);

const RED = assessDataTrust(
  TRUST_KEYS.map((key): TrustSignal => ({
    key,
    state: key === 'replay_divergences' ? 'red' : 'ok',
    detail: key === 'replay_divergences' ? '2 divergences' : '0',
    asOf: TRUST_AS_OF,
  })),
);

const three = theThreeNumbers({
  asOfInstant: '2026-08-20T21:00:00.000Z',
  withdrawableAcrossFundedCents: 500_000n,
  walletBalancesCents: 250_000n,
  boundedNearTermCents: 150_000n,
  remainingLadderExposureCents: 900_000n,
});

function asFigure(reading: typeof three.openLiability): Figure {
  if (!readingIsPresent(reading)) throw new Error('expected a figure');
  return reading.figure;
}

const LAST_CLOSED = asFigure(three.openLiability);

const INPUT = {
  lastClosedOpenLiability: LAST_CLOSED,
  movement: {
    cents: 12_500n,
    asOfInstant: '2026-08-21T13:00:00.000Z',
    feed: 'indicative marks feed',
  },
  sameDayAdjustments: { cents: 4_000n, asOfInstant: '2026-08-21T12:55:00.000Z' },
  dataTrust: GREEN,
};

describe('M6-A-12: the live figure is three terms and two of them are authoritative', () => {
  const live = liveOpenLiability(INPUT);

  test('the total is the sum of the three terms', () => {
    if (live.kind !== 'indicative') throw new Error('expected a live figure on a green board');
    expect(asFigure(live.reading).cents).toBe(750_000n + 4_000n + 12_500n);
  });

  test('the adjustments term is authoritative and the movement term is not', () => {
    if (live.kind !== 'indicative') throw new Error('expected a live figure');
    expect(asFigure(live.terms.sameDayAdjustments).authority).toBe('authoritative');
    expect(asFigure(live.terms.intradayMovement).authority).toBe('indicative');
  });

  test('the base is carried unchanged, so the live number cannot render alone', () => {
    if (live.kind !== 'indicative') throw new Error('expected a live figure');
    expect(live.terms.lastClosed).toBe(LAST_CLOSED);
  });

  test('the live figure carries the feed instant and the base as-of appears in its definition', () => {
    if (live.kind !== 'indicative') throw new Error('expected a live figure');
    const line = render(live.reading);
    expect(line).toContain('2026-08-21T13:00:00.000Z');
    expect(line).toContain('2026-08-20T21:00:00.000Z');
    expect(line).toContain('indicative marks feed');
  });

  test('it says INDICATIVE in the text, so a screenshot preserves the distinction', () => {
    if (live.kind !== 'indicative') throw new Error('expected a live figure');
    expect(render(live.reading)).toContain('INDICATIVE');
  });
});

describe('M6-A-13: INV-M6-12, nothing that decides can read it', () => {
  test('a control reaching for the live figure is refused', () => {
    const live = liveOpenLiability(INPUT);
    if (live.kind !== 'indicative') throw new Error('expected a live figure');
    expect(() => authoritative(asFigure(live.reading))).toThrow(FigureError);
  });

  test('the same control reads the as-of-last-closed figure without complaint', () => {
    expect(authoritative(LAST_CLOSED)).toBe(LAST_CLOSED);
  });

  test('an indicative base is refused, on a green board as well as a red one', () => {
    const compounded = {
      ...INPUT,
      lastClosedOpenLiability: { ...LAST_CLOSED, authority: 'indicative' as const },
    };
    expect(() => liveOpenLiability(compounded)).toThrow(FigureError);
    expect(() => liveOpenLiability({ ...compounded, dataTrust: RED })).toThrow(FigureError);
  });
});

describe('M6-A-14: P-M6-09 red suppresses it rather than showing it', () => {
  const live = liveOpenLiability({ ...INPUT, dataTrust: RED });

  test('no number is produced at all', () => {
    expect(live.kind).toBe('suppressed');
    expect(Object.hasOwn(live, 'reading')).toBe(false);
  });

  test('the reason is printed where the number would have been', () => {
    if (live.kind !== 'suppressed') throw new Error('expected suppression');
    expect(live.reason).toContain('data trust is red');
    expect(live.reason).toContain('worse than no number');
  });

  test('the as-of-last-closed figure is explicitly unaffected', () => {
    if (live.kind !== 'suppressed') throw new Error('expected suppression');
    expect(live.reason).toContain('as-of-last-closed figure above is unaffected');
  });

  test('a board red only because a signal is missing suppresses it too', () => {
    const missing = assessDataTrust([]);
    expect(liveOpenLiability({ ...INPUT, dataTrust: missing }).kind).toBe('suppressed');
  });
});

describe('M6-A-15: the movement is signed', () => {
  test('a book that moved in Merit favour lowers the live figure', () => {
    const live = liveOpenLiability({
      ...INPUT,
      movement: { ...INPUT.movement, cents: -30_000n },
    });
    if (live.kind !== 'indicative') throw new Error('expected a live figure');
    expect(asFigure(live.reading).cents).toBe(750_000n + 4_000n - 30_000n);
  });

  test('a reversing adjustment lowers it too', () => {
    const live = liveOpenLiability({
      ...INPUT,
      sameDayAdjustments: { ...INPUT.sameDayAdjustments, cents: -4_000n },
    });
    if (live.kind !== 'indicative') throw new Error('expected a live figure');
    expect(asFigure(live.reading).cents).toBe(750_000n + 12_500n - 4_000n);
  });
});
