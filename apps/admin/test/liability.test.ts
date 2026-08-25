import { describe, expect, test } from 'vitest';

import { readingIsPresent, render } from '../src/figure.ts';
import {
  LiabilityError,
  type LiabilitySnapshot,
  inAdversarialOrder,
  theThreeNumbers,
} from '../src/liability.ts';

// =============================================================================
// M6-A: the three numbers
// =============================================================================
// THESE ARE UNIT TESTS AND NOT GOLDEN FIXTURES, WHICH IS A DELIBERATE LIMIT.
// GS-115 is registered to this module and its fixture format is
// `packages/rules-engine/fixtures/GS-NNN-*.yaml`, a day stream folded through
// the engine (session 107's finding). This session is fenced to `apps/admin`,
// so it cannot register a fixture and does not name its files `*.golden.test.ts`:
// a suite that claimed the CI-03 stage without a registered fixture would read
// as coverage of GS-115 while covering the rendering of one hand-written row.
//
// What is asserted here is what this module owns: that a snapshot row becomes
// three separately defined numbers, and that an incoherent row does not become
// a page at all.
// =============================================================================

/**
 * GS-115's book, as the registry states it: "an account with 500,000c
 * withdrawable, a 150,000c cap, and 6 ladder rungs left contributes 500,000c to
 * open liability, 150,000c to bounded near-term liability, and 900,000c to
 * remaining ladder exposure".
 */
const GS_115: LiabilitySnapshot = {
  asOfInstant: '2026-08-20T21:00:00.000Z',
  withdrawableAcrossFundedCents: 500_000n,
  walletBalancesCents: 0n,
  boundedNearTermCents: 150_000n,
  remainingLadderExposureCents: 900_000n,
};

function centsOf(reading: ReturnType<typeof theThreeNumbers>['openLiability']): bigint {
  if (!readingIsPresent(reading)) throw new Error('expected a figure');
  return reading.figure.cents;
}

function definitionOf(reading: ReturnType<typeof theThreeNumbers>['openLiability']): string {
  if (!readingIsPresent(reading)) throw new Error('expected a figure');
  return reading.figure.definition;
}

describe('M6-A-06: GS-115 book, the three numbers diverge and are never conflated', () => {
  const three = theThreeNumbers(GS_115);

  test('each number is the one its own definition describes', () => {
    expect(centsOf(three.openLiability)).toBe(500_000n);
    expect(centsOf(three.boundedNearTerm)).toBe(150_000n);
    expect(centsOf(three.remainingLadderExposure)).toBe(900_000n);
  });

  test('no two of them are equal on this book', () => {
    const values = inAdversarialOrder(three).map(centsOf);
    expect(new Set(values).size).toBe(3);
  });

  test('each definition says what the number is NOT, which is the anti-conflation device', () => {
    for (const reading of inAdversarialOrder(three)) {
      expect(definitionOf(reading)).toContain('NOT');
    }
  });

  test('the three definitions are distinct texts, not one text three times', () => {
    const definitions = inAdversarialOrder(three).map(definitionOf);
    expect(new Set(definitions).size).toBe(3);
  });

  test('every one of the three renders its own as-of and source (INV-M6-04)', () => {
    for (const reading of inAdversarialOrder(three)) {
      expect(render(reading)).toContain('2026-08-20T21:00:00.000Z');
      expect(render(reading)).toContain('liability_snapshots');
    }
  });
});

describe('M6-A-07: INV-M6-11, wallet balances are inside open liability and shown beside it', () => {
  const withWallet = theThreeNumbers({ ...GS_115, walletBalancesCents: 250_000n });

  test('open liability is the sum of the two components', () => {
    expect(centsOf(withWallet.openLiability)).toBe(750_000n);
    expect(centsOf(withWallet.openLiabilityComponents.withdrawable)).toBe(500_000n);
    expect(centsOf(withWallet.openLiabilityComponents.wallet)).toBe(250_000n);
  });

  test('the wallet component states that it has already cleared every gate', () => {
    expect(definitionOf(withWallet.openLiabilityComponents.wallet)).toContain('cleared every gate');
  });

  test('the withdrawable component states that it has not', () => {
    expect(definitionOf(withWallet.openLiabilityComponents.withdrawable)).toContain(
      'still has to clear',
    );
  });

  test('the components are not in the three-number list', () => {
    expect(inAdversarialOrder(withWallet)).toHaveLength(3);
  });

  test('a wallet balance that grows moves open liability and not the cash figure', () => {
    const more = theThreeNumbers({ ...GS_115, walletBalancesCents: 400_000n });
    expect(centsOf(more.openLiability)).toBe(900_000n);
    expect(centsOf(more.boundedNearTerm)).toBe(centsOf(withWallet.boundedNearTerm));
  });
});

describe('M6-A-08: an incoherent row is refused rather than rendered', () => {
  test('bounded near-term above the withdrawable sum is impossible termwise', () => {
    expect(() => theThreeNumbers({ ...GS_115, boundedNearTermCents: 500_001n })).toThrow(
      LiabilityError,
    );
  });

  test('bounded near-term equal to the withdrawable sum is permitted', () => {
    expect(() => theThreeNumbers({ ...GS_115, boundedNearTermCents: 500_000n })).not.toThrow();
  });

  test.each([
    ['withdrawableAcrossFundedCents'],
    ['walletBalancesCents'],
    ['boundedNearTermCents'],
    ['remainingLadderExposureCents'],
  ] as const)('a negative %s is refused', (column) => {
    expect(() => theThreeNumbers({ ...GS_115, [column]: -1n })).toThrow(LiabilityError);
  });

  test('remaining ladder exposure above open liability is NOT refused: it is GS-115', () => {
    expect(centsOf(theThreeNumbers(GS_115).remainingLadderExposure)).toBeGreaterThan(
      centsOf(theThreeNumbers(GS_115).openLiability),
    );
  });
});
