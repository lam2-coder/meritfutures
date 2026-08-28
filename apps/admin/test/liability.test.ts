import { describe, expect, test } from 'vitest';

import type { Cents } from '@merit/rules-engine';

import { type Reading, readingIsPresent, render } from '../src/figure.ts';
import {
  LiabilityError,
  type LiabilitySnapshot,
  RCR_BREAKER_BP,
  type ReserveCoverageSnapshot,
  TREASURY_SOURCES,
  formatRatioBp,
  inAdversarialOrder,
  requireTreasurySource,
  reserveCoverage,
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

function centsOf(reading: Reading): bigint {
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

// =============================================================================
// M6-A: ADR-195's THIRD COMPONENT, AND THE SUM THAT DOES NOT MOVE
// =============================================================================
// INV-M6-15: "Open Liability does not move when a wallet withdrawal is
// approved, and it falls when that withdrawal's cash leaves."
//
// ADR-195 section 4 states the whole rule as a table over three postings, and
// this suite IS that table rather than a paraphrase of it. `W` is withdrawable
// across funded accounts, `B` is wallet balances, `F` is the firm-scoped
// `withdrawals_in_flight` obligation, all integer cents and all magnitudes:
//
//   LT-06 approval        W unchanged, B falls by amount, F rises by amount
//                         P-M6-01 UNCHANGED. The debt changed form
//   LT-07 settlement      W unchanged, B unchanged, F falls by amount
//                         P-M6-01 FALLS by amount. Merit paid
//   LT-09 rail exhausted  W unchanged, B rises by amount, F falls by amount
//                         P-M6-01 UNCHANGED. Nothing new is owed
//
// THE APPROVAL CASE IS THE ONE ADR-195 SECTION 9 ASKED FOR BY NAME, and it is
// the case a two-term panel fails: under two terms the approval moves only `B`,
// so the reported liability falls at the wrong event and then never reports the
// right one.
//
// THE FIXTURE CARRIES A LARGE WALLET FOR THE SAME REASON GS-229 CARRIES A LARGE
// FLOAT. On a book with an empty wallet there is nothing for `LT-06` to move
// out of, and a suite that proved conservation over a zero would have proved
// nothing.
// =============================================================================

/** The obligation's provenance, which ADR-195 clause 3 makes a choice of two. */
const IN_FLIGHT_SOURCE = 'ledger balance of withdrawals_in_flight (ADR-195 clause 3)';

/** GS-115's book with a wallet worth moving out of, and nothing yet in flight. */
const WITH_WALLET: LiabilitySnapshot = { ...GS_115, walletBalancesCents: 250_000n };

const APPROVED_CENTS = 25_000n;

const withTerms = (walletCents: Cents, inFlightCents: Cents): LiabilitySnapshot => ({
  ...WITH_WALLET,
  walletBalancesCents: walletCents,
  withdrawalsInFlight: { cents: inFlightCents, source: IN_FLIGHT_SOURCE },
});

describe('M6-A-70: INV-M6-15, the panel is invariant across the approval', () => {
  // Before LT-06: 250,000c in the wallet and nothing in flight. The obligation
  // is SUPPLIED as zero here rather than omitted, because "measured and empty"
  // and "no supplier" are different claims and M6-A-71 is the second one.
  const before = theThreeNumbers(withTerms(250_000n, 0n));
  const afterApproval = theThreeNumbers(withTerms(250_000n - APPROVED_CENTS, APPROVED_CENTS));

  test('the three components are summed into the total', () => {
    expect(centsOf(afterApproval.openLiability)).toBe(
      centsOf(afterApproval.openLiabilityComponents.withdrawable) +
        centsOf(afterApproval.openLiabilityComponents.wallet) +
        centsOf(afterApproval.openLiabilityComponents.withdrawalsInFlight),
    );
  });

  test('LT-06 moves amount_cents between two terms and the total does NOT move', () => {
    expect(centsOf(afterApproval.openLiability)).toBe(centsOf(before.openLiability));
    expect(centsOf(afterApproval.openLiabilityComponents.wallet)).toBe(
      centsOf(before.openLiabilityComponents.wallet) - APPROVED_CENTS,
    );
    expect(centsOf(afterApproval.openLiabilityComponents.withdrawalsInFlight)).toBe(
      centsOf(before.openLiabilityComponents.withdrawalsInFlight) + APPROVED_CENTS,
    );
    expect(centsOf(afterApproval.openLiabilityComponents.withdrawable)).toBe(
      centsOf(before.openLiabilityComponents.withdrawable),
    );
  });

  test('LT-07 is the only posting that moves the panel, and it falls by the amount', () => {
    const settled = theThreeNumbers(withTerms(250_000n - APPROVED_CENTS, 0n));
    expect(centsOf(settled.openLiability)).toBe(centsOf(before.openLiability) - APPROVED_CENTS);
  });

  test('LT-09 returns the amount to the wallet term and leaves the total where it was', () => {
    const reversed = theThreeNumbers(withTerms(250_000n, 0n));
    expect(centsOf(reversed.openLiability)).toBe(centsOf(afterApproval.openLiability));
    expect(centsOf(reversed.openLiabilityComponents.wallet)).toBe(
      centsOf(afterApproval.openLiabilityComponents.wallet) + APPROVED_CENTS,
    );
  });

  test('a two-term panel fails the approval case, which is why the term is a TERM', () => {
    const twoTerms = (three: ReturnType<typeof theThreeNumbers>): bigint =>
      centsOf(three.openLiabilityComponents.withdrawable) +
      centsOf(three.openLiabilityComponents.wallet);
    expect(twoTerms(afterApproval)).toBe(twoTerms(before) - APPROVED_CENTS);
  });

  test('the term is a MAGNITUDE: a ledger net arriving here is refused', () => {
    expect(() => theThreeNumbers(withTerms(250_000n, -APPROVED_CENTS))).toThrow(LiabilityError);
  });

  test('the component names both of its exits, which is the read it prevents', () => {
    const definition = definitionOf(afterApproval.openLiabilityComponents.withdrawalsInFlight);
    expect(definition).toContain('LT-07');
    expect(definition).toContain('LT-09');
    expect(definition).toContain('NOT money already gone');
  });

  test('the component carries its own source, because no column of this table holds it', () => {
    const rendered = render(afterApproval.openLiabilityComponents.withdrawalsInFlight);
    expect(rendered).toContain(IN_FLIGHT_SOURCE);
    expect(rendered).toContain(GS_115.asOfInstant);
  });

  test('the total states the rule rather than leaving the reader to derive it', () => {
    expect(definitionOf(afterApproval.openLiability)).toContain('INV-M6-15');
  });

  test('the components are still not in the three-number list', () => {
    expect(inAdversarialOrder(afterApproval)).toHaveLength(3);
  });

  test('the third term is not the float: P-M6-07 reads the wallet column alone', () => {
    const coverage = reserveCoverage({
      coverage: GS_229,
      floatCents: withTerms(250_000n - APPROVED_CENTS, APPROVED_CENTS).walletBalancesCents,
      floatAsOfInstant: GS_229_FLOAT_AS_OF,
    });
    expect(centsOf(coverage.walletFloat)).toBe(250_000n - APPROVED_CENTS);
  });
});

describe('M6-A-71: with no supplier the component is ABSENT and the total says so', () => {
  const unsupplied = theThreeNumbers(WITH_WALLET);

  test('the row carries no obligation and the component is absent, never zero', () => {
    expect(WITH_WALLET.withdrawalsInFlight).toBeUndefined();
    expect(readingIsPresent(unsupplied.openLiabilityComponents.withdrawalsInFlight)).toBe(false);
  });

  test('the absence names the missing column rather than saying unavailable', () => {
    const rendered = render(unsupplied.openLiabilityComponents.withdrawalsInFlight);
    expect(rendered).toContain('NO COLUMN');
    expect(rendered).toContain('liability_snapshots');
    expect(rendered).not.toContain('unavailable)');
  });

  test('the total is the first two components and states that it is INCOMPLETE', () => {
    expect(centsOf(unsupplied.openLiability)).toBe(750_000n);
    expect(definitionOf(unsupplied.openLiability)).toContain('INCOMPLETE');
  });

  test('a supplied row does NOT carry the incomplete clause', () => {
    expect(definitionOf(theThreeNumbers(withTerms(250_000n, 0n)).openLiability)).not.toContain(
      'INCOMPLETE',
    );
  });

  test('the total stays authoritative, because the term is provably zero today', () => {
    const reading = unsupplied.openLiability;
    if (!readingIsPresent(reading)) throw new Error('expected a figure');
    expect(reading.figure.authority).toBe('authoritative');
  });
});

// =============================================================================
// M6-A: P-M6-07, and the one thing section 5.3 rules
// =============================================================================
// FLOAT ENTERS THE DENOMINATOR AS EXPOSURE AND NEVER THE NUMERATOR AS RESERVE.
// GS-229 is the registered scenario, "reserve coverage computed while the
// wallet float is LARGE", and every fixture below carries a large float for
// that reason: on a book with an empty wallet, `reserve + float` IS `reserve`
// and a suite that passed would have proved nothing.
//
// THE SAME LIMIT AS THE THREE NUMBERS ABOVE APPLIES. These are unit tests, not
// GS-229's golden fixture: this session is fenced to `apps/admin` and cannot
// register one.
// =============================================================================

/**
 * The book that makes the misreading visible, and the figures are chosen so
 * that folding the float in FLIPS THE BREAKER rather than merely moving a
 * number:
 *
 *   reserve alone      2,000,000c / 2,500,000c = 8,000bp = 0.8000x  ARMED
 *   float folded in    3,500,000c / 2,500,000c = 14,000bp = 1.4000x not armed
 *
 * That is AS-M20-08 in two lines: "the breaker stops meaning anything at
 * exactly the moment it matters". The armed side is the true one.
 */
const GS_229: ReserveCoverageSnapshot = {
  asOfInstant: '2026-08-20T22:00:00.000Z',
  reserveCents: 2_000_000n,
  cvar99Cents: 2_500_000n,
  rcrBp: 8_000n,
  anchor: {
    accountCode: 'payout_wallet',
    asOfInstant: '2026-08-20T21:45:00.000Z',
    source: 'provider_api',
  },
};

const GS_229_FLOAT = 1_500_000n;
const GS_229_FLOAT_AS_OF = '2026-08-20T21:00:00.000Z';

const coverageOf = (
  overrides: Partial<ReserveCoverageSnapshot> = {},
  floatCents: Cents = GS_229_FLOAT,
): ReturnType<typeof reserveCoverage> =>
  reserveCoverage({
    coverage: { ...GS_229, ...overrides },
    floatCents,
    floatAsOfInstant: GS_229_FLOAT_AS_OF,
  });

describe('M6-A-31: GS-229, the RCR is computed from reserve alone', () => {
  const coverage = coverageOf();

  test('the ratio is the stored one and the float is not in it', () => {
    expect(coverage.ratioBp).toBe(8_000n);
    expect(coverage.breakerArmed).toBe(true);
  });

  test('folding the float in would flip the breaker, which is why it is not folded in', () => {
    const flattered = ((GS_229.reserveCents + GS_229_FLOAT) * 10_000n) / GS_229.cvar99Cents;
    expect(flattered).toBe(14_000n);
    expect(flattered < 10_000n).toBe(false);
    expect(coverage.breakerArmed).toBe(true);
  });

  test('reserve and float are two figures and neither is the other', () => {
    expect(centsOf(coverage.reserve)).toBe(2_000_000n);
    expect(centsOf(coverage.walletFloat)).toBe(1_500_000n);
    expect(centsOf(coverage.reserve)).not.toBe(centsOf(coverage.walletFloat));
  });

  test('no member of the panel holds reserve plus float', () => {
    const forbidden = GS_229.reserveCents + GS_229_FLOAT;
    for (const reading of [coverage.reserve, coverage.cvar99, coverage.walletFloat]) {
      expect(centsOf(reading)).not.toBe(forbidden);
    }
  });

  test('the float carries its own as-of and its own source, INV-M6-04', () => {
    if (!readingIsPresent(coverage.walletFloat)) throw new Error('expected a figure');
    expect(coverage.walletFloat.figure.asOf.instant).toBe(GS_229_FLOAT_AS_OF);
    expect(coverage.walletFloat.figure.asOf.source).toBe('liability_snapshots');
  });

  test('the coverage figures carry 0049 own clock and not the liability snapshot one', () => {
    if (!readingIsPresent(coverage.reserve)) throw new Error('expected a figure');
    expect(coverage.reserve.figure.asOf.instant).toBe('2026-08-20T22:00:00.000Z');
    expect(coverage.reserve.figure.asOf.source).toBe('reserve_coverage_snapshots');
  });
});

describe('M6-A-32: the coherence check refuses both shapes of the defect', () => {
  test('a numerator with the float folded into it is refused', () => {
    // The row a producer would write if it read INV-M5-15 as the numerator
    // clause: the reserve is the sum, and rcr_bp is still the generated one.
    expect(() => coverageOf({ reserveCents: GS_229.reserveCents + GS_229_FLOAT })).toThrow(
      LiabilityError,
    );
  });

  test('a ratio recomputed from float plus reserve is refused', () => {
    expect(() => coverageOf({ rcrBp: 14_000n })).toThrow(LiabilityError);
  });

  test('the refusal names both directions, because the reader has to know which', () => {
    let message = '';
    try {
      coverageOf({ rcrBp: 14_000n });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('folded into it');
    expect(message).toContain('recomputed from float plus reserve');
    expect(message).toContain('RESERVE ALONE');
  });

  test('a zero denominator is refused as a CVaR99 nobody computed', () => {
    expect(() => coverageOf({ cvar99Cents: 0n, rcrBp: 0n })).toThrow(/nobody computed/);
  });

  test('a negative reserve is refused', () => {
    expect(() => coverageOf({ reserveCents: -1n, rcrBp: 0n })).toThrow(LiabilityError);
  });

  test('a negative float is refused', () => {
    expect(() => coverageOf({}, -1n)).toThrow(/wallet_balances_cents/);
  });
});

describe('M6-A-33: the ratio is READ from 0049 generated column, not recomputed', () => {
  test('integer division truncates toward zero, exactly as Postgres does', () => {
    // 1c reserve over 3c CVaR99 is 3333.33..bp, and both Postgres integer
    // division and BigInt division truncate toward zero. 0049 states the
    // consequence: truncation LOWERS the ratio and therefore arms the breaker
    // marginally sooner rather than later.
    const coverage = coverageOf({ reserveCents: 1n, cvar99Cents: 3n, rcrBp: 3_333n }, 0n);
    expect(coverage.ratioBp).toBe(3_333n);
    expect(coverage.breakerArmed).toBe(true);
  });

  test('the ratio line says the database generated it and this page read it', () => {
    expect(coverageOf().ratioLine).toContain('GENERATED by the database and read rather than');
  });

  test('the breaker threshold is the GLOSSARY 1.0 and it pauses sales, never payouts', () => {
    expect(RCR_BREAKER_BP).toBe(10_000n);
    expect(coverageOf().ratioLine).toContain('pauses NEW SALES and never pauses payouts');
  });

  test('basis points render by bigint division, never through formatCents', () => {
    expect(formatRatioBp(8_000n)).toBe('0.8000');
    expect(formatRatioBp(10_000n)).toBe('1.0000');
    expect(formatRatioBp(12_345n)).toBe('1.2345');
    // The one that shows why the money renderer is the wrong one: 12,500bp is
    // 1.25x, and formatCents would print it as 125.00.
    expect(formatRatioBp(12_500n)).toBe('1.2500');
  });

  test('exactly 1.0000x is NOT armed, because the GLOSSARY says BELOW 1.0', () => {
    expect(coverageOf({ reserveCents: 2_500_000n, rcrBp: 10_000n }).breakerArmed).toBe(false);
    expect(coverageOf({ reserveCents: 2_499_900n, rcrBp: 9_999n }).breakerArmed).toBe(true);
  });
});

describe('M6-A-34: P-M6-07 attestation half, and the second ratio nobody supplies', () => {
  test('a manual attestation says so, because P-M6-07 asks for its staleness', () => {
    const line = coverageOf({
      anchor: { ...GS_229.anchor, source: 'manual_attestation' },
    }).attestationLine;
    expect(line).toContain('MANUAL ATTESTATION');
    expect(line).toContain('2026-08-20T21:45:00.000Z');
  });

  test('a provider reading says the staleness clause does not apply', () => {
    expect(coverageOf().attestationLine).toContain('Not a manual attestation');
  });

  test('a third source name is refused rather than defaulted to the provider arm', () => {
    expect(() => coverageOf({ anchor: { ...GS_229.anchor, source: 'spreadsheet' } })).toThrow(
      LiabilityError,
    );
    expect(TREASURY_SOURCES).toEqual(['provider_api', 'manual_attestation']);
    expect(requireTreasurySource('manual_attestation')).toBe('manual_attestation');
  });

  test('float coverage is absent with a named owner, never a zero', () => {
    const { floatCoverage } = coverageOf();
    expect(readingIsPresent(floatCoverage)).toBe(false);
    expect(render(floatCoverage)).toContain('GET /admin/wallet/reconciliation');
    expect(render(floatCoverage)).not.toContain('0.00');
  });
});
