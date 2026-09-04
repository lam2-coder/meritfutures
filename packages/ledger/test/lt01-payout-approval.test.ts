// =============================================================================
// packages/ledger/test/lt01-payout-approval.test.ts
// =============================================================================
// ADR-317. `LT-01` ARRIVED IN THIS PACKAGE AND ITS REFUSAL ARRIVED WITH IT.
//
// `lt01` was declared in `apps/api/src/routes/payouts.ts` from ADR-176 and is
// declared in `packages/ledger/src/payout.ts` from ADR-317. The move is code
// motion and the row that ordered it said what mattered about it in one clause:
// `INV-M5-03`'s assertion TRAVELS WITH IT UNWEAKENED, because a split whose
// invariant was left behind is worse than no move at all.
//
// -----------------------------------------------------------------------------
// WHY THIS FILE EXISTS WHEN `apps/api/test/payouts.test.ts` ALREADY CALLS `lt01`
// -----------------------------------------------------------------------------
// That suite does still call it and every one of its `LT-01` cases still runs;
// nothing here replaces anything there. What it cannot do is run in this
// package. A builder whose only coverage lives in one deployable's suite is a
// builder the OTHER deployable imports on trust, and `apps/worker` is precisely
// the deployable this move exists to serve (ADR-305 `F2`). So the refusal is
// exercised where the function now lives, through the package's own public
// door.
//
// THE IMPORT IS PART OF THE ASSERTION, on `lt06-approval-builder.test.ts`'s
// idiom one file over: `package.json` names `./src/index.ts` as the whole of
// `@merit/ledger`'s public surface, so a specifier reached through the index is
// a specifier a deployable can reach through its manifest. Importing
// `../src/payout.ts` directly would go on passing with the door shut.
//
// NOTHING HERE TOUCHES A DATABASE. Every case is a pure call.
// =============================================================================

import { describe, expect, test } from 'vitest';

import { PayoutMoneyError, entriesOf, lt01, netCents } from '../src/index.ts';

/** M01 Appendix A.1's 50K column, as `apps/api/test/payouts.test.ts` seeds it. */
const ARGS = {
  identityId: '55555555-5555-5555-5555-000000000001',
  payoutRequestId: '66666666-6666-6666-6666-000000000001',
  idempotencyKey: 'a-trader-supplied-key',
  approvedCents: 50_000n,
  traderCents: 40_000n,
  firmCents: 10_000n,
};

describe('LT-01, through the package door', () => {
  test('names three accounts across two transfers and carries the caller key', () => {
    const post = lt01(ARGS);
    expect(post.header.kind).toBe('payout_approval');
    expect(post.header.referenceKind).toBe('payout_request');
    expect(post.header.referenceId).toBe(ARGS.payoutRequestId);
    expect(post.header.idempotencyKey).toBe(ARGS.idempotencyKey);
    expect(post.transfers).toHaveLength(2);
    expect(post.transfers[0]?.debit).toEqual({
      scope: 'identity',
      code: 'trader_withdrawable',
      identityId: ARGS.identityId,
    });
    expect(post.transfers[0]?.credit).toEqual({
      scope: 'identity',
      code: 'trader_wallet',
      identityId: ARGS.identityId,
    });
    expect(post.transfers[1]?.debit).toEqual({
      scope: 'identity',
      code: 'trader_withdrawable',
      identityId: ARGS.identityId,
    });
    expect(post.transfers[1]?.credit).toEqual({ scope: 'firm', code: 'fees_revenue' });
  });

  test('two transfers are FOUR entries and they sum to zero (ADR-104 ruling 1)', () => {
    const entries = entriesOf(lt01(ARGS));
    expect(entries).toHaveLength(4);
    expect(netCents(entries)).toBe(0n);

    // The DEBIT total against the withdrawable position is `approved_cents`,
    // which is the property `INV-M5-03` exists to keep true: it is the sum of
    // the two legs and nothing states it anywhere else in the posting.
    const withdrawable = entries
      .filter((entry) => entry.account.code === 'trader_withdrawable')
      .reduce((net, entry) => net + entry.amountCents, 0n);
    expect(withdrawable).toBe(ARGS.approvedCents);
  });

  // ---------------------------------------------------------------------------
  // THE CLAUSE THE ROW CALLED THE MONEY
  // ---------------------------------------------------------------------------
  test('REFUSES a split that does not sum to approved_cents (INV-M5-03)', () => {
    // `INV-M5-03` is enforced by a CHECK on `payout_requests` and by the
    // engine's R-44, and NEITHER runs between the engine returning a split and
    // this function turning it into two legs. Every posting below still
    // balances; what stops being true is that the withdrawable position was
    // debited by the amount approved.
    expect(() => lt01({ ...ARGS, firmCents: 10_001n })).toThrow(/INV-M5-03/);
    expect(() => lt01({ ...ARGS, firmCents: 9_999n })).toThrow(/INV-M5-03/);
    expect(() => lt01({ ...ARGS, approvedCents: 50_001n })).toThrow(/INV-M5-03/);
  });

  test('the refusal names the three amounts, so a caller can see WHICH split failed', () => {
    // The message is the one this builder threw in `apps/api` before the move
    // and it is asserted rather than assumed: ADR-317 is code motion, and a
    // message quietly rewritten in transit is a behaviour change.
    expect(() => lt01({ ...ARGS, firmCents: 10_001n })).toThrow(/40000c \+ 10001c is not 50000c/);
  });

  test('the refusal is a `PayoutMoneyError`, which the move did not rename', () => {
    // Nothing in this tree catches it by class today. The class and its `name`
    // are still observable on the thrown value, and ADR-317 was ruled to change
    // no behaviour, so both are pinned here rather than left to a later reader
    // to discover they were free to change.
    let thrown: unknown;
    try {
      lt01({ ...ARGS, firmCents: 10_001n });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(PayoutMoneyError);
    expect((thrown as Error).name).toBe('PayoutMoneyError');
  });

  test('REFUSES a zero or negative leg before the database is asked', () => {
    // This one is `posting.ts`'s and not this file's: `transfer()` refuses a
    // non-positive amount. It is asserted here because the refusal is what
    // makes a "split" of the whole amount plus nothing unrepresentable, and a
    // reader of `lt01` alone cannot see where it comes from.
    expect(() => lt01({ ...ARGS, traderCents: 0n, firmCents: ARGS.approvedCents })).toThrow();
    expect(() => lt01({ ...ARGS, traderCents: 60_000n, firmCents: -10_000n })).toThrow();
  });
});
