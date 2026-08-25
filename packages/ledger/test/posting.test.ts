// =============================================================================
// packages/ledger/test/posting.test.ts
// =============================================================================
// THE CONSTRUCTION, AND EVERY REFUSAL IN IT.

import { describe, expect, test } from 'vitest';

import { firmAccount, identityAccount } from '../src/accounts.ts';
import {
  entriesOf,
  identitiesTouchedBy,
  netCents,
  posting,
  transfer,
  type NonEmptyTransfers,
  type Transfer,
} from '../src/posting.ts';

const TREASURY = firmAccount('firm_treasury');
const CLEARING = firmAccount('psp_clearing');
const FEES = firmAccount('fees_revenue');
const WALLET_A = identityAccount('trader_wallet', 'identity-A');
const WITHDRAWABLE_A = identityAccount('trader_withdrawable', 'identity-A');
const WALLET_B = identityAccount('trader_wallet', 'identity-B');

const header = (key: string) => ({
  kind: 'purchase.captured',
  referenceKind: 'purchase',
  referenceId: 'ref-1',
  idempotencyKey: key,
});

describe('a transfer is the only unit, and it refuses three shapes', () => {
  test('it carries a positive amount and applies no sign of its own', () => {
    const t = transfer(CLEARING, TREASURY, 12_345n, 'a memo');
    expect(t.amountCents).toBe(12_345n);
    expect(t.memo).toBe('a memo');
  });

  test('a `number` amount is refused, because JSON has no other numeric type and a float is one', () => {
    expect(() => transfer(CLEARING, TREASURY, 100 as unknown as bigint)).toThrow(
      /integer cents as a bigint/,
    );
    expect(() => transfer(CLEARING, TREASURY, 5.5 as unknown as bigint)).toThrow(
      /integer cents as a bigint/,
    );
  });

  test('zero is refused because `amount_cents <> 0` refuses it, and a negative because it is the same transfer backwards', () => {
    expect(() => transfer(CLEARING, TREASURY, 0n)).toThrow(/POSITIVE amount/);
    expect(() => transfer(CLEARING, TREASURY, -1n)).toThrow(/POSITIVE amount/);
  });

  test('a transfer from an account to itself is LEDGER-C1 at the smallest scale', () => {
    expect(() => transfer(TREASURY, firmAccount('firm_treasury'), 1n)).toThrow(/LEDGER-C1/);
    expect(() => transfer(WALLET_A, identityAccount('trader_wallet', 'identity-A'), 1n)).toThrow(
      /LEDGER-C1/,
    );
  });

  test('the same class for two different people is two accounts and is allowed', () => {
    expect(() => transfer(WALLET_A, WALLET_B, 1n)).not.toThrow();
  });
});

describe('the imbalance is unrepresentable', () => {
  test('one transfer is two entries, equal and opposite, and the sign convention is 0009 own', () => {
    const p = posting(header('k1'), [transfer(CLEARING, TREASURY, 900n)]);
    const entries = entriesOf(p);
    expect(entries.map((e) => e.amountCents)).toEqual([900n, -900n]);
    expect(entries[0]?.account).toBe(CLEARING); // debit is positive
    expect(entries[1]?.account).toBe(TREASURY); // credit is negative
  });

  test('any set of transfers nets exactly zero, whatever it is', () => {
    const p = posting(header('k2'), [
      transfer(CLEARING, TREASURY, 10_000n),
      transfer(WALLET_B, FEES, 1_500n),
      transfer(WITHDRAWABLE_A, WALLET_A, 7n),
    ] as NonEmptyTransfers);
    expect(netCents(entriesOf(p))).toBe(0n);
    expect(entriesOf(p)).toHaveLength(6);
  });

  test('every entry is non-zero, which is the CHECK 0009 puts on the column', () => {
    const p = posting(header('k3'), [transfer(CLEARING, TREASURY, 1n)]);
    for (const entry of entriesOf(p)) expect(entry.amountCents).not.toBe(0n);
  });
});

describe('a posting refuses what 0027 would refuse at COMMIT', () => {
  test('LEDGER-C1 across transfers: one account with both signs', () => {
    expect(() =>
      posting(header('k4'), [
        transfer(CLEARING, TREASURY, 10_000n),
        transfer(TREASURY, FEES, 1_000n),
      ] as NonEmptyTransfers),
    ).toThrow(/LEDGER-C1/);
  });

  test('two transfers in the SAME direction against one account are allowed, as 0027 allows them', () => {
    expect(() =>
      posting(header('k5'), [
        transfer(TREASURY, WALLET_A, 500n),
        transfer(TREASURY, WALLET_B, 700n),
      ] as NonEmptyTransfers),
    ).not.toThrow();
  });

  test('a posting with no transfers is refused, and the database would have accepted it', () => {
    expect(() => posting(header('k6'), [] as unknown as NonEmptyTransfers)).toThrow(
      /at least one transfer/,
    );
  });

  test('every NOT NULL header column is required', () => {
    for (const field of ['kind', 'referenceKind', 'referenceId', 'idempotencyKey'] as const) {
      const broken = { ...header('k7'), [field]: '' };
      expect(() => posting(broken, [transfer(CLEARING, TREASURY, 1n)]), field).toThrow(
        new RegExp(`needs a ${field}`),
      );
    }
  });

  test('reversalOf is absent or is a transaction id, and never an empty string', () => {
    expect(() =>
      posting({ ...header('k8'), reversalOf: '' }, [transfer(CLEARING, TREASURY, 1n)]),
    ).toThrow(/reversalOf is present and empty/);
    expect(() =>
      posting({ ...header('k9'), reversalOf: 'other-transaction' }, [
        transfer(CLEARING, TREASURY, 1n),
      ]),
    ).not.toThrow();
  });
});

describe('the subjects a halt is checked against', () => {
  test('a firm-only posting names no identity, which is why a halt never blocks one', () => {
    const p = posting(header('k10'), [transfer(CLEARING, TREASURY, 1n)]);
    expect(identitiesTouchedBy(p)).toEqual([]);
  });

  test('every identity whose account appears is a subject, each named once', () => {
    const p = posting(header('k11'), [
      transfer(TREASURY, WALLET_A, 100n),
      transfer(WITHDRAWABLE_A, WALLET_B, 200n),
    ] as NonEmptyTransfers);
    expect([...identitiesTouchedBy(p)].sort()).toEqual(['identity-A', 'identity-B']);
  });
});

describe('the brand is what a cast has to get past, and it is the reason post.ts re-sums', () => {
  test('a hand-built leg is not a Transfer and reaching the path needs a cast', () => {
    const forged = {
      __brand: 'Transfer',
      debit: CLEARING,
      credit: CLEARING,
      amountCents: -1n,
      memo: null,
    } as Transfer;
    // It compiles only through the cast above, and `posting()` still refuses it
    // on LEDGER-C1 -- but nothing here checks the sign, which is `post.ts`'s job.
    expect(() => posting(header('k12'), [forged])).toThrow(/LEDGER-C1/);
  });
});
