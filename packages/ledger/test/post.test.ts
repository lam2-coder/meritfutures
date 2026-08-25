// =============================================================================
// packages/ledger/test/post.test.ts
// =============================================================================
// THE WRITE, ASSERTED AS THE SEQUENCE OF CALLS IT MAKES THROUGH ADR-102's
// ACCESSOR. Nothing here executes SQL and the header of `recording-tx.ts` says
// why: there is no Postgres in CI, and a test that skips is worse than one that
// does not exist. The round trip is executed by hand and reported in ADR-104.

import { describe, expect, test } from 'vitest';

import { firmAccount, identityAccount } from '../src/accounts.ts';
import { readChart } from '../src/chart.ts';
import { postTransaction } from '../src/post.ts';
import {
  assertBalanced,
  entriesOf,
  netCents,
  posting,
  transfer,
  type NonEmptyTransfers,
  type Posting,
} from '../src/posting.ts';
import { RecordingTx, accountRow, haltRow } from './recording-tx.ts';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';

const CHART_ROWS = [
  accountRow('acct-treasury', 'firm_treasury', 'firm'),
  accountRow('acct-clearing', 'psp_clearing', 'firm'),
  accountRow('acct-fees', 'fees_revenue', 'firm'),
  accountRow('acct-wallet-a', 'trader_wallet', 'identity', A),
  accountRow('acct-withdrawable-a', 'trader_withdrawable', 'identity', A),
  accountRow('acct-wallet-b', 'trader_wallet', 'identity', B),
];

const header = (key: string) => ({
  kind: 'payout.approved',
  referenceKind: 'payout_request',
  referenceId: 'pr-1',
  idempotencyKey: key,
});

async function fresh(halts: readonly Record<string, unknown>[] = []) {
  const tx = new RecordingTx(CHART_ROWS, halts);
  const chart = await readChart(tx);
  return { tx, chart };
}

describe('a posting is written as one transaction row and then its entries', () => {
  test('the header row goes first, because ledger_entries.transaction_id references it', async () => {
    const { tx, chart } = await fresh();
    const post = posting(header('k1'), [
      transfer(firmAccount('psp_clearing'), firmAccount('firm_treasury'), 9_900n),
    ]);
    const written = await postTransaction(tx, chart, post);

    expect(tx.inserts.map((i) => i.key)).toEqual([
      'ledgerTransactions',
      'ledgerEntries',
      'ledgerEntries',
    ]);
    expect(written.entryCount).toBe(2);
    expect(written.netCents).toBe(0n);
    expect(written.transactionId).toMatch(/^00000000-0000-4000-8000-\d{12}$/);
  });

  test('every entry carries the transaction id the header INSERT returned', async () => {
    const { tx, chart } = await fresh();
    const written = await postTransaction(
      tx,
      chart,
      posting(header('k2'), [
        transfer(firmAccount('psp_clearing'), firmAccount('firm_treasury'), 10_000n),
        transfer(
          identityAccount('trader_withdrawable', A),
          identityAccount('trader_wallet', A),
          250n,
        ),
      ] as NonEmptyTransfers),
    );
    for (const row of tx.entryRows()) {
      expect(row['transactionId']).toBe(written.transactionId);
    }
  });

  test('each reference resolves to the ledger_accounts.id the chart holds for it', async () => {
    const { tx, chart } = await fresh();
    await postTransaction(
      tx,
      chart,
      posting(header('k3'), [
        transfer(firmAccount('firm_treasury'), identityAccount('trader_wallet', B), 4_200n),
      ]),
    );
    expect(tx.entryRows().map((r) => r['ledgerAccountId'])).toEqual([
      'acct-treasury',
      'acct-wallet-b',
    ]);
    expect(tx.entryRows().map((r) => r['amountCents'])).toEqual([4_200n, -4_200n]);
  });

  test('the header writes every NOT NULL column and reversalOf as an explicit null', async () => {
    const { tx, chart } = await fresh();
    await postTransaction(
      tx,
      chart,
      posting(header('k4'), [
        transfer(firmAccount('psp_clearing'), firmAccount('fees_revenue'), 1n),
      ]),
    );
    expect(tx.inserts[0]?.values).toMatchObject({
      kind: 'payout.approved',
      referenceKind: 'payout_request',
      referenceId: 'pr-1',
      idempotencyKey: 'k4',
      reversalOf: null,
    });
  });

  test('currency is never written, because 0009 defaults it and calls it reserved', async () => {
    const { tx, chart } = await fresh();
    await postTransaction(
      tx,
      chart,
      posting(header('k5'), [
        transfer(firmAccount('psp_clearing'), firmAccount('fees_revenue'), 1n),
      ]),
    );
    for (const row of tx.entryRows()) expect(Object.keys(row)).not.toContain('currency');
  });

  test('a reversal carries the transaction it reverses, because SD-M5-05 makes a correction a new row', async () => {
    const { tx, chart } = await fresh();
    await postTransaction(
      tx,
      chart,
      posting({ ...header('k6'), reversalOf: 'original-transaction' }, [
        transfer(firmAccount('firm_treasury'), firmAccount('psp_clearing'), 9_900n),
      ]),
    );
    expect(tx.inserts[0]?.values['reversalOf']).toBe('original-transaction');
  });

  test('the path touches ledger_transactions and ledger_entries and no other table', async () => {
    const { tx, chart } = await fresh();
    await postTransaction(
      tx,
      chart,
      posting(header('k7'), [
        transfer(firmAccount('psp_clearing'), firmAccount('firm_treasury'), 5n),
      ]),
    );
    // `LedgerTx` names no UPDATE and no DELETE at all, which is how
    // `ledger_entries`' append-only rule (0009's header, 0026's grants,
    // SD-M5-05) is kept whatever authority the injected handle carries.
    expect(new Set(tx.inserts.map((i) => i.key))).toEqual(
      new Set(['ledgerTransactions', 'ledgerEntries']),
    );
    expect(new Set(tx.reads)).toEqual(new Set(['ledgerAccounts', 'ledgerHalts']));
  });
});

describe('THE SEEDED WRITE THAT MUST BE REFUSED, and it is refused before the database is asked', () => {
  // THE IMBALANCE IS UNREPRESENTABLE AND THAT IS REPORTED HONESTLY RATHER THAN
  // DRESSED UP AS A REFUSAL THIS SUITE WATCHED END TO END.
  //
  // `entriesOf` emits `+a` and `-a` for every transfer and nothing else emits
  // an entry, so NO `Posting` folds to a non-zero net -- not one built by
  // `posting()`, and not one assembled past both brands by a cast, because the
  // cast still goes through the same fold. The first test below proves that
  // over the worst forgery this file can write.
  //
  // So the guard `postTransaction` runs is driven DIRECTLY, with a credit that
  // has no debit, which is the same function on the same path with the fold
  // taken out of the way. The end-to-end direction is watched by MUTATION and
  // reported in ADR-104 section 9 rather than committed, because a committed
  // test for it would have to break `entriesOf` to reach it.

  test('a Posting assembled past BOTH brands still folds to zero, which is the claim', () => {
    const forged = {
      __brand: 'Posting',
      header: header('seeded'),
      transfers: [
        {
          __brand: 'Transfer',
          debit: firmAccount('firm_treasury'),
          credit: firmAccount('psp_clearing'),
          amountCents: 1_000n,
          memo: null,
        },
        {
          __brand: 'Transfer',
          debit: firmAccount('fees_revenue'),
          credit: identityAccount('trader_wallet', A),
          amountCents: 999_999_999n,
          memo: null,
        },
      ],
    } as unknown as Posting;
    expect(netCents(entriesOf(forged))).toBe(0n);
  });

  test('a credit with no debit is REFUSED by the guard the path runs, naming the cents', () => {
    const creditOnly = [{ account: firmAccount('psp_clearing'), amountCents: -1_000n, memo: null }];
    expect(() => assertBalanced(creditOnly, 1)).toThrow(/nets -1000c/);
    expect(() => assertBalanced(creditOnly, 1)).toThrow(/INV-M5-04/);
  });

  test('a debit with no credit is refused in the other direction, so the guard is not one-sided', () => {
    const debitOnly = [{ account: firmAccount('psp_clearing'), amountCents: 1_000n, memo: null }];
    expect(() => assertBalanced(debitOnly, 1)).toThrow(/nets 1000c/);
  });

  test('the guard passes on a balanced set, so it is not refusing everything', () => {
    expect(() =>
      assertBalanced(
        entriesOf(
          posting(header('ok'), [
            transfer(firmAccount('psp_clearing'), firmAccount('firm_treasury'), 7n),
          ]),
        ),
        1,
      ),
    ).not.toThrow();
  });

  test('a transaction row with NO entries is refused, and the database would have accepted it', async () => {
    const { tx, chart } = await fresh();
    const empty = {
      __brand: 'Posting',
      header: header('seeded-empty'),
      transfers: [],
    } as unknown as Posting;

    await expect(postTransaction(tx, chart, empty)).rejects.toThrow(
      /the zero-sum trigger never fires for/,
    );
    expect(tx.inserts, 'no row is written and no idempotency key is consumed').toEqual([]);
  });
});

describe('two references resolving to ONE account is the case posting() cannot see', () => {
  test('LEDGER-C1 fires on the resolved uuid, not only on the reference', async () => {
    // A chart in which two DIFFERENT classes point at the same ledger_accounts
    // row. `posting()` compares references and sees two accounts; the database
    // sees one, and refuses at COMMIT. This is the check that agrees with it.
    const tx = new RecordingTx([
      accountRow('shared', 'firm_treasury', 'firm'),
      accountRow('shared', 'psp_clearing', 'firm'),
      accountRow('acct-wallet-a', 'trader_wallet', 'identity', A),
      accountRow('acct-wallet-b', 'trader_wallet', 'identity', B),
    ]);
    const chart = await readChart(tx);
    const post = posting(header('k8'), [
      transfer(firmAccount('firm_treasury'), identityAccount('trader_wallet', A), 100n),
      transfer(identityAccount('trader_wallet', B), firmAccount('psp_clearing'), 100n),
    ] as NonEmptyTransfers);

    await expect(postTransaction(tx, chart, post)).rejects.toThrow(/resolves two opposite-signed/);
    expect(tx.inserts).toEqual([]);
  });
});

describe('the chart', () => {
  test('an account the chart does not hold is a refusal naming it, never an account this path opens', async () => {
    const { tx, chart } = await fresh();
    const post = posting(header('k9'), [
      transfer(firmAccount('reserve'), firmAccount('firm_treasury'), 1n),
    ]);
    await expect(postTransaction(tx, chart, post)).rejects.toThrow(
      /no ledger account for firm reserve/,
    );
    expect(tx.inserts).toEqual([]);
  });

  test('two rows for one key is a database whose indexes are not the ones 0009 declares', async () => {
    const tx = new RecordingTx([
      accountRow('one', 'reserve', 'firm'),
      accountRow('two', 'reserve', 'firm'),
    ]);
    await expect(readChart(tx)).rejects.toThrow(/two accounts for firm reserve/);
  });

  test('the chart read is ONE read of the whole table, which is the cost chart.ts states', async () => {
    const { tx } = await fresh();
    expect(tx.reads).toEqual(['ledgerAccounts']);
  });
});

describe('ledger_halts is honoured by this path and by nothing else in the estate', () => {
  test('a live halt against an identity this posting touches REFUSES it, and nothing is written', async () => {
    const { tx, chart } = await fresh([haltRow('halt-1', A)]);
    const post = posting(header('k10'), [
      transfer(firmAccount('firm_treasury'), identityAccount('trader_wallet', A), 1_000n),
    ]);
    await expect(postTransaction(tx, chart, post)).rejects.toThrow(/a ledger halt is live against/);
    expect(tx.inserts).toEqual([]);
  });

  test('a RELEASED halt blocks nothing, because released_at IS NULL is what live means', async () => {
    const { tx, chart } = await fresh([haltRow('halt-2', A, new Date(2))]);
    await postTransaction(
      tx,
      chart,
      posting(header('k11'), [
        transfer(firmAccount('firm_treasury'), identityAccount('trader_wallet', A), 1_000n),
      ]),
    );
    expect(tx.inserts).toHaveLength(3);
  });

  test('a halt against a DIFFERENT identity does not block this posting', async () => {
    const { tx, chart } = await fresh([haltRow('halt-3', B)]);
    await postTransaction(
      tx,
      chart,
      posting(header('k12'), [
        transfer(firmAccount('firm_treasury'), identityAccount('trader_wallet', A), 5n),
      ]),
    );
    expect(tx.inserts).toHaveLength(3);
  });

  test('a firm-only posting is never blocked, because a halt names a subject and this names none', async () => {
    const { tx, chart } = await fresh([haltRow('halt-4', A), haltRow('halt-5', B)]);
    await postTransaction(
      tx,
      chart,
      posting(header('k13'), [
        transfer(firmAccount('psp_clearing'), firmAccount('firm_treasury'), 5n),
      ]),
    );
    expect(tx.inserts).toHaveLength(3);
  });

  test('the remediation posting says so in a word, and the word is a closed vocabulary', async () => {
    const { tx, chart } = await fresh([haltRow('halt-6', A)]);
    await postTransaction(
      tx,
      chart,
      posting({ ...header('k14'), reversalOf: 'the-bad-one' }, [
        transfer(identityAccount('trader_wallet', A), firmAccount('firm_treasury'), 1_000n),
      ]),
      { despiteHalt: 'halt-remediation' },
    );
    expect(tx.inserts).toHaveLength(3);
    // AND THE HALT TABLE IS NOT EVEN READ when the word is written, so the
    // override is a decision and not a filter somebody could weaken.
    expect(tx.reads).toEqual(['ledgerAccounts']);
  });

  test('a halt row with no subject is refused loudly, because 0016 makes identity_id NOT NULL', async () => {
    const tx = new RecordingTx(CHART_ROWS, [{ id: 'x', identityId: null, releasedAt: null }]);
    const chart = await readChart(tx);
    await expect(
      postTransaction(
        tx,
        chart,
        posting(header('k15'), [
          transfer(firmAccount('firm_treasury'), identityAccount('trader_wallet', A), 1n),
        ]),
      ),
    ).rejects.toThrow(/does not carry id and identityId as strings/);
  });
});
