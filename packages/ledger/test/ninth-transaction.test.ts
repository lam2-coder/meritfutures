// =============================================================================
// packages/ledger/test/ninth-transaction.test.ts
// =============================================================================
// ADR-189's RULING AND ITS ONE DEPENDENCY, BOTH HELD AGAINST THE TREE.
//
// `LT-09` is what posts when the external rail is exhausted: the exact negation
// of `LT-06`, with `reversal_of` set, in the same database transaction as
// `transferring --> failed`. `reversal.ts` builds it and `0057` proves it
// happened, and the two halves prove different things, which is the whole of
// ADR-189 section 4.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE IS ACTUALLY FOR, WHICH IS NOT THE POSTING
// -----------------------------------------------------------------------------
// The posting's arithmetic is guaranteed by construction: `reversalPosting`
// swaps each transfer's two sides and `posting.ts` applies every sign, so an
// inexact reversal is unrepresentable rather than refused. A suite that only
// asserted the amounts would be asserting the type system.
//
// THE THING THAT CAN ACTUALLY BREAK IS THE JOIN. `ledger_entries` carries no
// withdrawal foreign key, so `(reference_kind, reference_id)` is the whole of
// the edge from a withdrawal to its postings, and `WD-C1` in `0057` reads the
// literal `'wallet_withdrawal'` out of its own function body. If the constant in
// `reversal.ts` and the literal in the migration ever stop agreeing, the trigger
// sums over zero rows and reports a clean obligation for every withdrawal in the
// system -- a guard that silently stops gating, which `0001:90` calls worse than
// an absent one. ADR-189 section 8 names this as where that entry is most likely
// wrong. THESE CASES ARE THE ONLY THING IN THIS ESTATE THAT WOULD SAY SO.
//
// THE MIGRATION IS RESOLVED BY CONTENT AND NOT BY NAME, for the reason
// `accounts.test.ts` and `chart-of-accounts-kinds.test.ts` each record after
// being caught by it: a watcher pinned to a filename watches that file and not
// the claim, and a later migration may supersede this one.
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { entriesOf, posting, transfer, type Posting } from '../src/posting.ts';
import { accountKey, firmAccount, identityAccount, type AccountRef } from '../src/accounts.ts';
import {
  WALLET_WITHDRAWAL_APPROVAL_KIND,
  WALLET_WITHDRAWAL_FAILURE_KIND,
  WALLET_WITHDRAWAL_REFERENCE_KIND,
  reversalPosting,
  walletWithdrawalFailureKey,
  walletWithdrawalFailurePosting,
  type WalletWithdrawalFacts,
} from '../src/reversal.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), 'utf8');
const MIGRATIONS = join(ROOT, 'packages', 'db', 'migrations');

const M05 = read('docs', 'plans', 'M05-payout-system.md');
const STATE_MACHINES = read('docs', 'architecture', 'STATE_MACHINES.md');

/**
 * The migration that installs `WD-C1`, found by its trigger name rather than by
 * its number, with `--` comments stripped FIRST.
 *
 * COMMENTS COME OFF BEFORE THE ANCHOR IS SOUGHT AND NOT AFTER, which is the
 * ordering bug ADR-187 finding 5 records as its fifth instance: `0057`'s header
 * quotes its own trigger name while explaining what it does, so a reader that
 * strips comments from the SLICE anchors in the prose.
 */
const WD_C1_SOURCE: string = ((): string => {
  const anchor = 'CREATE CONSTRAINT TRIGGER wallet_withdrawals_terminal_obligation_is_zero';
  const found = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS, name), 'utf8').replace(/--[^\n]*/g, ''))
    .filter((bare) => bare.includes(anchor));

  if (found.length === 0) {
    throw new Error(
      `no migration creates ${anchor}. ADR-189 rules that a terminal wallet withdrawal ` +
        'leaves nothing standing in withdrawals_in_flight, and WD-C1 is the only thing that ' +
        'proves it: without this trigger LT-09 is a promise.',
    );
  }
  return found[found.length - 1] as string;
})();

/**
 * The net per account over a set of entries, SUMMED rather than indexed.
 *
 * A MAP KEYED BY ACCOUNT IS WRONG HERE AND WAS WATCHED BEING WRONG. `LT-01`
 * posts TWO debits against one `trader_withdrawable` position, which `posting()`
 * allows in terms -- `LEDGER-C1` refuses OPPOSITE signs and says nothing about
 * two debits -- so a map built by assignment keeps the last leg and silently
 * drops the first. The first draft of this file did exactly that and compared
 * 5,000 against 25,000.
 */
function netByAccount(
  entries: readonly { account: AccountRef; amountCents: bigint }[],
): Map<string, bigint> {
  const net = new Map<string, bigint>();
  for (const entry of entries) {
    const key = accountKey(entry.account);
    net.set(key, (net.get(key) ?? 0n) + entry.amountCents);
  }
  return net;
}

/** The facts one withdrawal is, in integer cents. 25,000c is ADR-187 section 6's figure. */
const FACTS: WalletWithdrawalFacts = {
  withdrawalId: '22222222-0000-0000-0000-000000000001',
  identityId: '11111111-1111-1111-1111-111111111111',
  amountCents: 25_000n,
  withdrawalIdempotencyKey: 'wd-key-01',
};

describe('the join WD-C1 depends on, which is the only thing here that can silently break', () => {
  test("reversal.ts's reference kind is the literal WD-C1 joins on", () => {
    expect(WD_C1_SOURCE).toContain(`t.reference_kind = '${WALLET_WITHDRAWAL_REFERENCE_KIND}'`);
  });

  test('the trigger reads the obligation account and no other', () => {
    expect(WD_C1_SOURCE).toContain("a.code           = 'withdrawals_in_flight'");
  });

  test('LT-09 posts under that reference kind, against the withdrawal', () => {
    const lt09 = walletWithdrawalFailurePosting(FACTS, 'approval-txn-id');
    expect(lt09.header.referenceKind).toBe(WALLET_WITHDRAWAL_REFERENCE_KIND);
    expect(lt09.header.referenceId).toBe(FACTS.withdrawalId);
  });
});

describe('the terminal states, which are the trigger WHEN clause and the drawing', () => {
  // ADR-189 section 2 enumerates them and checks each. The drawing is the
  // authority: three arrows into `[*]`, and every one of them must be named in
  // the WHEN clause or the guard has a state it cannot see.
  const TERMINAL = ['settled', 'failed', 'cancelled'] as const;

  test('STATE_MACHINES section 3.2 draws exactly these three into the terminal', () => {
    for (const state of TERMINAL) {
      expect(STATE_MACHINES).toContain(`    ${state} --> [*]`);
    }
  });

  test('WD-C1 fires on all three and not on failed alone', () => {
    expect(WD_C1_SOURCE).toContain("WHEN (NEW.status IN ('settled', 'failed', 'cancelled'))");
  });

  test('cancelled is reachable only from states before approval, so LT-06 never posted', () => {
    expect(STATE_MACHINES).toContain('    requested --> cancelled: G-TRADER-CANCELS');
    expect(STATE_MACHINES).toContain('    cooling --> cancelled: G-TRADER-CANCELS');
    // The whole of the argument: no edge into `cancelled` leaves a state at or
    // past `approved`. If one is ever drawn, this goes red and ADR-189 section
    // 2's table needs a fourth row rather than a reader's assumption.
    for (const from of ['approved', 'transferring']) {
      expect(STATE_MACHINES).not.toContain(`    ${from} --> cancelled`);
    }
  });
});

describe('LT-09 is the exact negation of LT-06 and the shape is what guarantees it', () => {
  const APPROVAL_TXN = '33333333-0000-0000-0000-000000000001';
  const lt09 = walletWithdrawalFailurePosting(FACTS, APPROVAL_TXN);

  test('two entries, +25000 on the obligation and -25000 on the wallet position', () => {
    const entries = entriesOf(lt09);
    expect(entries).toHaveLength(2);

    const byAccount = netByAccount(entries);
    expect(byAccount.get(accountKey(firmAccount('withdrawals_in_flight')))).toBe(25_000n);
    expect(byAccount.get(accountKey(identityAccount('trader_wallet', FACTS.identityId)))).toBe(
      -25_000n,
    );
  });

  test('it is the entry-for-entry negation of the LT-06 it reverses', () => {
    // Built here independently of `reversal.ts`'s private constructor, so that
    // this asserts the negation rather than restating the implementation.
    const lt06: Posting = posting(
      {
        kind: WALLET_WITHDRAWAL_APPROVAL_KIND,
        referenceKind: WALLET_WITHDRAWAL_REFERENCE_KIND,
        referenceId: FACTS.withdrawalId,
        idempotencyKey: FACTS.withdrawalIdempotencyKey,
      },
      [
        transfer(
          identityAccount('trader_wallet', FACTS.identityId),
          firmAccount('withdrawals_in_flight'),
          FACTS.amountCents,
        ),
      ],
    );

    const original = netByAccount(entriesOf(lt06));
    const reversal = netByAccount(entriesOf(lt09));
    expect([...reversal.keys()].sort()).toEqual([...original.keys()].sort());
    for (const [key, amount] of reversal) expect(amount).toBe(-(original.get(key) as bigint));
  });

  test('it carries SD-M5-05s link to the transaction it reverses', () => {
    expect(lt09.header.reversalOf).toBe(APPROVAL_TXN);
  });

  test('it is a compensating entry and never an update: LT-06 is untouched', () => {
    // Said as a property of the API rather than as prose. There is no exported
    // function here that takes a transaction id and an amount, so "adjust the
    // obligation by 25,000" has no spelling.
    expect(lt09.header.kind).toBe(WALLET_WITHDRAWAL_FAILURE_KIND);
    expect(lt09.transfers).toHaveLength(1);
  });
});

describe('the key, which is ADR-175 clause 3 extended rather than assumed to cover this', () => {
  test('it is the kind against the withdrawals own stored key', () => {
    expect(walletWithdrawalFailureKey('wd-key-01')).toBe('wallet_withdrawal_failure wd-key-01');
  });

  test('LT-09 posts under it, and never under LT-06s bare key', () => {
    const lt09 = walletWithdrawalFailurePosting(FACTS, 'approval-txn-id');
    expect(lt09.header.idempotencyKey).toBe(walletWithdrawalFailureKey('wd-key-01'));
    expect(lt09.header.idempotencyKey).not.toBe(FACTS.withdrawalIdempotencyKey);
  });

  test('a reversal that claims its originals key is refused before the database is asked', () => {
    const original = posting(
      {
        kind: 'k',
        referenceKind: WALLET_WITHDRAWAL_REFERENCE_KIND,
        referenceId: FACTS.withdrawalId,
        idempotencyKey: 'shared',
      },
      [transfer(firmAccount('firm_treasury'), firmAccount('fees_revenue'), 1n)],
    );
    expect(() =>
      reversalPosting(original, { kind: 'k-rev', idempotencyKey: 'shared', reversalOf: 'x' }),
    ).toThrow(/UNIQUE globally/);
  });
});

describe('reversalPosting, as SD-M5-05s mechanism rather than as LT-09s helper', () => {
  const multi = posting(
    {
      kind: 'payout_approval',
      referenceKind: 'payout_request',
      referenceId: '44444444-0000-0000-0000-000000000001',
      idempotencyKey: 'pr-key-01',
    },
    [
      transfer(
        identityAccount('trader_withdrawable', FACTS.identityId),
        identityAccount('trader_wallet', FACTS.identityId),
        25_000n,
        'the trader half',
      ),
      transfer(
        identityAccount('trader_withdrawable', FACTS.identityId),
        firmAccount('fees_revenue'),
        5_000n,
        'the firm share',
      ),
    ],
  );

  const reversed = reversalPosting(multi, {
    kind: 'payout_reversal',
    idempotencyKey: 'pr-key-01-rev',
    reversalOf: 'lt01-txn-id',
  });

  test('every leg of a multi-leg posting is negated, and none is dropped or netted', () => {
    // LT-03 is "the exact negation of LT-01". Three legs in, three legs out,
    // and the middle position's movement survives, which is the netting
    // `posting()`s own header refuses at construction.
    expect(entriesOf(reversed)).toHaveLength(entriesOf(multi).length);
    const original = netByAccount(entriesOf(multi));
    const back = netByAccount(entriesOf(reversed));
    expect([...back.keys()].sort()).toEqual([...original.keys()].sort());
    for (const [key, amount] of back) expect(amount).toBe(-(original.get(key) as bigint));
    // The middle position moved and still moves. 30,000 out of withdrawable in
    // two legs comes back as 30,000 in, not as one netted leg.
    expect(back.get(accountKey(identityAccount('trader_withdrawable', FACTS.identityId)))).toBe(
      -30_000n,
    );
  });

  test('the reference carries across and the idempotency key does not', () => {
    expect(reversed.header.referenceKind).toBe(multi.header.referenceKind);
    expect(reversed.header.referenceId).toBe(multi.header.referenceId);
    expect(reversed.header.idempotencyKey).not.toBe(multi.header.idempotencyKey);
  });

  test('a partial reversal has no spelling: the amount is not a parameter', () => {
    // ADR-067 section 4 and 0038 check 5: a reversal is exact, and a partial
    // correction is a full reversal plus a new credit. Asserted as the absence
    // of an argument, because that is the form the rule takes here.
    expect(reversalPosting.length).toBe(2);
  });
});

describe('the corpus says what this file builds', () => {
  test('M05 section 2.1 declares LT-09 and names its kind', () => {
    expect(M05).toContain(`| LT-09 | \`${WALLET_WITHDRAWAL_FAILURE_KIND}\` |`);
  });

  test('M05s LT-09 row states both legs, in the direction this file posts them', () => {
    expect(M05).toContain(
      'debit **`withdrawals_in_flight`** `amount_cents`; credit **`trader_wallet`** (identity) ' +
        "`amount_cents`, with `reversal_of` set to `LT-06`'s transaction",
    );
  });

  test('M05s LT-06 row still states the legs LT-09 negates, unedited by ADR-189', () => {
    expect(M05).toContain('| LT-06 | `wallet_withdrawal_approval` | debit `trader_wallet`');
    expect(M05).toContain('the credit leg is **`withdrawals_in_flight`**');
  });

  test('a transaction is reversed at most once, and the index that says so is UNIQUE', () => {
    expect(WD_C1_SOURCE).toContain(
      'CREATE UNIQUE INDEX ledger_transactions_reversal_of_idx\n  ON ledger_transactions ' +
        '(reversal_of) WHERE reversal_of IS NOT NULL;',
    );
  });
});
