// =============================================================================
// packages/ledger/test/lt06-approval-builder.test.ts
// =============================================================================
// ADR-314. THE DOOR, AND THE ONE PROPERTY THAT OPENING IT COULD HAVE COST.
//
// `walletWithdrawalApprovalPosting` was module-scoped from the day `reversal.ts`
// was written (ADR-189, 2026-08-28) on a ground the file stated in its own
// words: the session did not rule `LT-06`'s writer. ADR-270 clause 2 ruled it on
// 2026-08-30, and ADR-314 opens the door on that discharge. The export itself is
// one keyword and one line in `index.ts` and needs no case.
//
// -----------------------------------------------------------------------------
// WHAT NEEDS A CASE IS THAT `LT-06` IS STILL SAID ONCE
// -----------------------------------------------------------------------------
// `LT-09` IS THE REVERSAL OF `LT-06`, and it is exact because
// `walletWithdrawalFailurePosting` composes the SAME builder through
// `reversalPosting` rather than restating the two legs beside it. A second
// construction of that arithmetic is ADR-092 section 5's two-statements-of-one-
// fact hazard arriving on the money path, and the cheap way to acquire one is
// exactly this change: a builder that is now callable from outside is a builder
// somebody can be tempted to reimplement inside, "just for the export".
//
// SO THE CASES BELOW WATCH THE COMPOSITION FROM BOTH SIDES. One reads the
// entries and asserts `LT-09` is the negation OF THE EXPORTED BUILDER, which a
// fork of the arithmetic breaks the moment the two copies part. The other reads
// `reversal.ts` as text, on `ninth-transaction.test.ts`'s idiom, and asserts
// there is ONE call and ONE statement of the wallet leg in the whole of
// `packages/ledger/src`.
//
// WHAT THIS FILE DOES NOT DO IS RE-ASSERT `LT-06`'s DIRECTION. That is
// `apps/api/test/lt06-posting-timing.test.ts` PIN 1, which reads the signs
// through `LT-09`'s negation and is ADR-267 clause 1's whole evidence. A second
// case saying the same thing another way would make the older one look
// redundant, and the older one is the one a ruling rests on.
//
// NOTHING HERE TOUCHES A DATABASE. Every case is a pure call or a string read.
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';

// THE IMPORT IS THE ASSERTION. `package.json` names `./src/index.ts` as the
// whole of `@merit/ledger`'s public surface, so a specifier this file can reach
// through the index is a specifier a deployable can reach through the manifest.
// Every other suite in this package imports the module directly, which would
// have gone on passing with the door shut.
import {
  WALLET_WITHDRAWAL_APPROVAL_KIND,
  WALLET_WITHDRAWAL_REFERENCE_KIND,
  accountKey,
  entriesOf,
  walletWithdrawalApprovalPosting,
  walletWithdrawalFailurePosting,
  type EntryDraft,
  type WalletWithdrawalFacts,
} from '../src/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE = join(HERE, '..');
const SRC = join(PACKAGE, 'src');

const FACTS: WalletWithdrawalFacts = {
  withdrawalId: '44444444-4444-4444-4444-000000000001',
  identityId: '55555555-5555-5555-5555-000000000001',
  amountCents: 25_000n,
  withdrawalIdempotencyKey: 'a-trader-supplied-key',
};

const netByAccount = (entries: readonly EntryDraft[]): Map<string, bigint> => {
  const net = new Map<string, bigint>();
  for (const entry of entries) {
    const key = accountKey(entry.account);
    net.set(key, (net.get(key) ?? 0n) + entry.amountCents);
  }
  return net;
};

/**
 * A line that CONSTRUCTS the wallet account reference, rather than one that
 * merely names the code. `accounts.ts` declares `'trader_wallet'` in the union
 * and in the scope map and `chart.ts` and `post.ts` discuss it in prose; none of
 * those is a leg of a posting, and a check that counted them would be red on
 * arrival and useless afterwards.
 */
const matchesWalletLeg = (line: string): boolean =>
  line.includes("identityAccount('trader_wallet'");

describe('the builder has a public door', () => {
  test('`@merit/ledger`s index exports it, which is the whole of ADR-314', () => {
    expect(typeof walletWithdrawalApprovalPosting).toBe('function');

    // The manifest's `exports` map is what makes the index the public surface
    // rather than one module among five, so it is read rather than assumed.
    const manifest: unknown = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8'));
    expect(manifest).toMatchObject({ name: '@merit/ledger', exports: { '.': './src/index.ts' } });
  });

  test('it builds `LT-06`s header off the withdrawal, under the withdrawals own bare key', () => {
    const lt06 = walletWithdrawalApprovalPosting(FACTS);

    expect(lt06.header.kind).toBe(WALLET_WITHDRAWAL_APPROVAL_KIND);
    expect(lt06.header.referenceKind).toBe(WALLET_WITHDRAWAL_REFERENCE_KIND);
    expect(lt06.header.referenceId).toBe(FACTS.withdrawalId);

    // ADR-175 clause 1: a key names the EVENT and never the door that reached
    // it. `LT-06` posts under the row's stored key bare, which is what makes
    // `walletWithdrawalFailureKey` prefix rather than share it.
    expect(lt06.header.idempotencyKey).toBe(FACTS.withdrawalIdempotencyKey);

    // `LT-06` reverses nothing. `SD-M5-05`'s link belongs to `LT-09`.
    expect(lt06.header.reversalOf).toBeUndefined();
  });
});

describe('`LT-09` still derives from it, and a fork of the arithmetic is what that forbids', () => {
  test('the ninth transaction is the entry-for-entry negation OF THE EXPORTED BUILDER', () => {
    // Measured against the exported function rather than against a hand-built
    // copy of M05's row. `ninth-transaction.test.ts` holds the copy, on purpose,
    // because a transcription cannot be its own authority; this case holds the
    // COMPOSITION, which is the thing a second builder would silently break.
    const lt06 = netByAccount(entriesOf(walletWithdrawalApprovalPosting(FACTS)));
    const lt09 = netByAccount(
      entriesOf(walletWithdrawalFailurePosting(FACTS, '66666666-6666-6666-6666-000000000001')),
    );

    expect([...lt09.keys()].sort()).toEqual([...lt06.keys()].sort());
    expect(lt09.size).toBe(2);
    for (const [key, amount] of lt09) expect(amount).toBe(-(lt06.get(key) as bigint));
  });

  test('the composition is one call, read out of `reversal.ts` as text', () => {
    const source = readFileSync(join(SRC, 'reversal.ts'), 'utf8');
    expect(source).toContain('return reversalPosting(walletWithdrawalApprovalPosting(facts), {');
  });

  test('the wallet leg is stated ONCE in the whole of `packages/ledger/src`', () => {
    // ADR-092 section 5. A `.filter` over a hardcoded file list watches those
    // files and not the claim, which is the miss `in-flight-obligation.test.ts`
    // records against itself, so the directory is walked.
    const walk = (dir: string): readonly string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(join(dir, entry.name))
          : entry.name.endsWith('.ts')
            ? [join(dir, entry.name)]
            : [],
      );

    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(0);

    const constructions = files.flatMap((file) => {
      const hits = readFileSync(file, 'utf8').split('\n').filter(matchesWalletLeg);
      return hits.map((line) => `${file}: ${line.trim()}`);
    });

    // One site: `walletWithdrawalApprovalPosting`'s own debit leg. A second is
    // a second statement of `LT-06`, wherever it sits and whatever it is called.
    expect(constructions).toHaveLength(1);
    expect(constructions[0]).toContain('reversal.ts');
  });
});
