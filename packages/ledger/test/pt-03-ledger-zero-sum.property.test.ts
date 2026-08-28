// =============================================================================
// PT-03: LEDGER ZERO-SUM, PER TRANSACTION AND IN AGGREGATE
// =============================================================================
// STRATEGY section 3.1 rows `PT-03` as "ledger zero-sum, per transaction and in
// aggregate", and says why it is a property rather than a fixture: "per
// transaction is a deferred constraint in the database (ADR-016), so this
// property tests THE AGGREGATE THE CONSTRAINT CANNOT SEE."
//
// THE AGGREGATE HALF IS THE ONE THAT MATTERS AND IT IS THE ONE NOTHING ELSE
// COVERS. `0027`'s `ledger_entries_zero_sum` reads `WHERE transaction_id =
// NEW.transaction_id`: it fires once per entry, sums that transaction's legs,
// and knows nothing about any other transaction. So a database in which every
// individual transaction balances and the ledger as a whole does not is a
// database that trigger reports as healthy. That state is what makes a
// reconciliation fail months later with no record of which statement did it,
// and this file is the control for it.
//
// IT MEASURES WHAT WAS WRITTEN AND NOT WHAT WAS BUILT. The fold is driven
// THROUGH `postTransaction` into a recording writer, and the sum is taken over
// the `ledger_entries` rows that writer was asked to insert -- so a posting path
// that dropped a leg between the value and the INSERT would fail here, and a
// property asserted over `entriesOf` alone would not.
//
// `GS-231` IS `blocked / no-fixture-format` AND STAYS BLOCKED. It is `PT-03`'s
// golden pair and carries the per-identity assertion; this is the property and
// the two are not the same artifact.
//
// EVERY GENERATED VALUE IS INTEGER CENTS AS A `bigint`. `fc.bigInt` is used
// rather than `fc.integer` mapped afterwards, so that no `number` exists on this
// path at any point -- including in a generated test value, which the
// constitution names directly.

import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import {
  firmAccount,
  identityAccount,
  type AccountRef,
  type FirmAccountCode,
  type IdentityAccountCode,
} from '../src/accounts.ts';
import { readChart } from '../src/chart.ts';
import { postTransaction } from '../src/post.ts';
import { entriesOf, netCents, posting, transfer, type NonEmptyTransfers } from '../src/posting.ts';
import { RecordingTx, accountRow } from './recording-tx.ts';

// THESE TWO LISTS ARE HAND-KEPT AND `tsc` CANNOT SEE A GAP IN EITHER. They are
// typed `readonly FirmAccountCode[]` and `readonly IdentityAccountCode[]`, and a
// list missing a member of its union is a perfectly well typed shorter list. A
// code absent from here is a code this property test NEVER GENERATES, and
// nothing else in the tree would say so -- which is why
// `in-flight-obligation.test.ts` registers this file as a normative site and
// scans for it, and why ADR-187 measured the mint's price with `vitest` and
// `tsc` together and found `tsc` reported ZERO errors for the whole widening.
//
// `withdrawals_in_flight` is ADR-187's eighth code and the fifth firm one.
const FIRM_CODES: readonly FirmAccountCode[] = [
  'firm_treasury',
  'psp_clearing',
  'fees_revenue',
  'reserve',
  'withdrawals_in_flight',
];
const IDENTITY_CODES: readonly IdentityAccountCode[] = [
  'trader_withdrawable',
  'trader_wallet',
  'promotional_credit',
];
const IDENTITIES = ['identity-A', 'identity-B', 'identity-C'] as const;

/** Every account a generated posting can name, and the chart rows for all of them. */
const ALL_REFS: readonly AccountRef[] = [
  ...FIRM_CODES.map((code) => firmAccount(code)),
  ...IDENTITIES.flatMap((id) => IDENTITY_CODES.map((code) => identityAccount(code, id))),
];

const CHART_ROWS = ALL_REFS.map((ref, index) =>
  ref.scope === 'firm'
    ? accountRow(`acct-${String(index)}`, ref.code, 'firm')
    : accountRow(`acct-${String(index)}`, ref.code, 'identity', ref.identityId),
);

const refArb = fc.constantFrom(...ALL_REFS);

/** A POSITIVE amount in integer cents, up to roughly a million dollars. */
const amountArb = fc.bigInt({ min: 1n, max: 100_000_000n });

/**
 * A posting the constructors accept.
 *
 * The generator proposes transfers and DROPS the ones `transfer()` and
 * `posting()` refuse, rather than being written to avoid them: what is under
 * test is the arithmetic of what gets built, and steering the generator away
 * from the refusals would also steer it away from the shapes near them.
 */
const postingArb = fc
  .record({
    legs: fc.array(fc.tuple(refArb, refArb, amountArb), { minLength: 1, maxLength: 6 }),
    key: fc.string({ minLength: 1, maxLength: 12 }),
  })
  .map(({ legs, key }) => {
    const transfers = [];
    const claimed = new Map<string, string>();
    for (const [debit, credit, amountCents] of legs) {
      const debitKey = JSON.stringify(debit);
      const creditKey = JSON.stringify(credit);
      if (debitKey === creditKey) continue;
      if (claimed.get(debitKey) === 'credit' || claimed.get(creditKey) === 'debit') continue;
      claimed.set(debitKey, 'debit');
      claimed.set(creditKey, 'credit');
      transfers.push(transfer(debit, credit, amountCents));
    }
    if (transfers.length === 0) return undefined;
    return posting(
      {
        kind: 'generated',
        referenceKind: 'property',
        referenceId: 'pt-03',
        idempotencyKey: `pt-03-${key}`,
      },
      transfers as unknown as NonEmptyTransfers,
    );
  })
  .filter((p) => p !== undefined);

describe('PT-03: the ledger sums to zero, per transaction and in aggregate', () => {
  test('per transaction: every generated posting nets exactly zero cents', () => {
    fc.assert(
      fc.property(postingArb, (post) => {
        expect(netCents(entriesOf(post))).toBe(0n);
      }),
      { numRuns: 500 },
    );
  });

  test('per transaction: entries come in pairs and none of them is zero', () => {
    fc.assert(
      fc.property(postingArb, (post) => {
        const entries = entriesOf(post);
        expect(entries).toHaveLength(post.transfers.length * 2);
        for (const entry of entries) {
          expect(typeof entry.amountCents).toBe('bigint');
          expect(entry.amountCents).not.toBe(0n);
        }
      }),
      { numRuns: 500 },
    );
  });

  // THE HALF THE DATABASE CANNOT SEE.
  test('IN AGGREGATE: over any sequence of postings, every entry written sums to exactly zero', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(postingArb, { minLength: 1, maxLength: 12 }), async (posts) => {
        const tx = new RecordingTx(CHART_ROWS);
        const chart = await readChart(tx);
        for (const post of posts) await postTransaction(tx, chart, post);

        // Every transaction balanced on its own, which is all `0027` checks.
        const byTransaction = new Map<string, bigint>();
        for (const row of tx.entryRows()) {
          const id = String(row['transactionId']);
          byTransaction.set(id, (byTransaction.get(id) ?? 0n) + (row['amountCents'] as bigint));
        }
        for (const [id, net] of byTransaction) expect(net, id).toBe(0n);

        // AND the whole ledger balances, which nothing in the database checks.
        expect(tx.netCentsWritten()).toBe(0n);
        expect(byTransaction.size).toBe(posts.length);
      }),
      { numRuns: 120 },
    );
  });

  test('IN AGGREGATE: the per-account balances sum to zero, which is what a liability number is built on', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(postingArb, { minLength: 1, maxLength: 12 }), async (posts) => {
        const tx = new RecordingTx(CHART_ROWS);
        const chart = await readChart(tx);
        for (const post of posts) await postTransaction(tx, chart, post);

        const byAccount = new Map<string, bigint>();
        for (const row of tx.entryRows()) {
          const account = String(row['ledgerAccountId']);
          byAccount.set(account, (byAccount.get(account) ?? 0n) + (row['amountCents'] as bigint));
        }
        let total = 0n;
        for (const balance of byAccount.values()) total += balance;
        expect(total).toBe(0n);
      }),
      { numRuns: 120 },
    );
  });

  // THE PROPERTY IS NOT VACUOUS AND THIS IS WHAT SAYS SO. A generator that
  // produced nothing, or a fold that emitted no entries, would leave every
  // assertion above green while proving nothing at all.
  test('the generator produces real postings: multi-leg ones, and entries actually written', async () => {
    const seen = { postings: 0, entries: 0, multiLeg: 0 };
    await fc.assert(
      fc.asyncProperty(fc.array(postingArb, { minLength: 1, maxLength: 12 }), async (posts) => {
        const tx = new RecordingTx(CHART_ROWS);
        const chart = await readChart(tx);
        for (const post of posts) {
          await postTransaction(tx, chart, post);
          seen.postings += 1;
          if (post.transfers.length > 1) seen.multiLeg += 1;
        }
        seen.entries += tx.entryRows().length;
      }),
      { numRuns: 120 },
    );
    expect(seen.postings).toBeGreaterThan(100);
    expect(seen.entries).toBeGreaterThan(200);
    expect(
      seen.multiLeg,
      'a single-leg-only generator would not exercise LEDGER-C1 at all',
    ).toBeGreaterThan(20);
  });

  // AND THE PROPERTY DISCRIMINATES. A fold that dropped one leg is the exact
  // defect the aggregate half exists to catch, so it is watched being caught
  // here rather than only asserted to be catchable.
  test('a dropped credit leg is CAUGHT by the aggregate sum, which is the direction that destroys', () => {
    const post = posting(
      { kind: 'k', referenceKind: 'r', referenceId: 'i', idempotencyKey: 'one' },
      [
        transfer(firmAccount('psp_clearing'), firmAccount('firm_treasury'), 10_000n),
        transfer(
          identityAccount('trader_withdrawable', 'identity-A'),
          identityAccount('trader_wallet', 'identity-A'),
          250n,
        ),
      ] as NonEmptyTransfers,
    );
    const honest = entriesOf(post);
    expect(netCents(honest)).toBe(0n);

    const dropped = honest.filter((_, index) => index !== 1);
    expect(netCents(dropped)).not.toBe(0n);
    expect(netCents(dropped)).toBe(10_000n);
  });
});
