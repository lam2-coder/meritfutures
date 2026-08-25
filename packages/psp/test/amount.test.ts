// =============================================================================
// packages/psp/test/amount.test.ts
// =============================================================================
// EVERY EXPECTED VALUE HERE IS READ OUT OF `0006_commerce.sql`, never out of
// `amount.ts`. ADR-084 section 7 is why: that session's first suite passed all
// 22 assertions against a seeded violation because the expected value had been
// taken from the code under test. The three branches below are
// `purchases_wallet_debit_bounds`, transcribed, and the mixed case's arithmetic
// is ADR-019's own worked example ("a trader with $60 in the wallet buying a
// $99 evaluation").
// =============================================================================

import { describe, expect, test } from 'vitest';

import { CardLegError, cardLegOf, type PurchaseRowMoney } from '../src/amount.ts';

describe('cardLegOf: the card leg is not amount_paid_cents', () => {
  test("payment_method='psp' charges the whole amount", () => {
    const row: PurchaseRowMoney = {
      paymentMethod: 'psp',
      amountPaidCents: 9900n,
      walletDebitCents: 0n,
    };
    expect(cardLegOf(row)).toBe(9900n);
  });

  test("payment_method='mixed' charges the REMAINDER, which is ADR-019's common case", () => {
    // $99 evaluation, $60 in the wallet. The card sees $39 and a port that took
    // a plain `amountCents` would have shown the buyer $99.
    const row: PurchaseRowMoney = {
      paymentMethod: 'mixed',
      amountPaidCents: 9900n,
      walletDebitCents: 6000n,
    };
    expect(cardLegOf(row)).toBe(3900n);
  });

  test("payment_method='wallet' is REFUSED rather than returning zero (INV-M3-13)", () => {
    const row: PurchaseRowMoney = {
      paymentMethod: 'wallet',
      amountPaidCents: 9900n,
      walletDebitCents: 9900n,
    };
    expect(() => cardLegOf(row)).toThrow(CardLegError);
    try {
      cardLegOf(row);
      expect.unreachable('a wallet-funded purchase must not reach a processor');
    } catch (error) {
      expect((error as CardLegError).refusal).toBe('wallet_funded_purchase_has_no_card_leg');
    }
  });
});

describe('cardLegOf re-checks the DDL bounds, because a row can arrive unwritten', () => {
  const violations: ReadonlyArray<readonly [string, PurchaseRowMoney]> = [
    [
      "'psp' with a wallet debit",
      { paymentMethod: 'psp', amountPaidCents: 9900n, walletDebitCents: 1n },
    ],
    [
      "'mixed' with a zero wallet debit",
      { paymentMethod: 'mixed', amountPaidCents: 9900n, walletDebitCents: 0n },
    ],
    [
      "'mixed' with the wallet covering the whole amount",
      { paymentMethod: 'mixed', amountPaidCents: 9900n, walletDebitCents: 9900n },
    ],
    [
      "'mixed' with the wallet exceeding the amount",
      { paymentMethod: 'mixed', amountPaidCents: 9900n, walletDebitCents: 9901n },
    ],
    [
      "'wallet' whose debit does not equal the amount",
      { paymentMethod: 'wallet', amountPaidCents: 9900n, walletDebitCents: 5000n },
    ],
    [
      "'wallet' at zero, which the CHECK requires to be > 0",
      { paymentMethod: 'wallet', amountPaidCents: 0n, walletDebitCents: 0n },
    ],
    ['a negative amount', { paymentMethod: 'psp', amountPaidCents: -1n, walletDebitCents: 0n }],
  ];

  for (const [name, row] of violations) {
    test(`refuses ${name}`, () => {
      expect(() => cardLegOf(row)).toThrow(CardLegError);
      try {
        cardLegOf(row);
        expect.unreachable('the row violates purchases_wallet_debit_bounds');
      } catch (error) {
        expect((error as CardLegError).refusal).toBe('row_violates_wallet_debit_bounds');
      }
    });
  }

  test('refuses money that is not a bigint, which is where a float would arrive', () => {
    // The cast is the point: this is what a JSON body deserialised without care
    // looks like by the time it reaches a money function.
    const row = {
      paymentMethod: 'psp',
      amountPaidCents: 99,
      walletDebitCents: 0,
    } as unknown as PurchaseRowMoney;
    try {
      cardLegOf(row);
      expect.unreachable('money on this path is integer cents as bigint');
    } catch (error) {
      expect((error as CardLegError).refusal).toBe('amount_is_not_integer_cents');
    }
  });
});
