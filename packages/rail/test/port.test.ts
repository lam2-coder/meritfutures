// =============================================================================
// packages/rail/test/port.test.ts
// =============================================================================
// THE TWO BRANDS AND THE ONE PROMISE THE PORT MAKES ABOUT `enqueue`.
//
// Every case here is about a claim the port's own header makes. The brands are
// the money-path half: an amount that did not come from a stored row and a key
// that was not generated at approval must both be unspellable, and "unspellable"
// is a claim a type makes at compile time and a function has to make at run time
// for a caller that reached it with an `any`.
// =============================================================================

import { describe, expect, test } from 'vitest';

import {
  RAIL_PROVIDER_IDS,
  TransferMintError,
  approvalKeyOf,
  createSandboxRail,
  transferAmountOf,
  type StoredTransferRow,
  type TransferInstruction,
} from '../src/index.ts';

const AT = new Date('2026-08-28T12:00:00.000Z');
const clock = (): Date => AT;

const row: StoredTransferRow = { amountCents: 125_00n, idempotencyKey: 'wd_9f3a' };

const instruction = (over: Partial<TransferInstruction> = {}): TransferInstruction => ({
  leg: 'wallet_withdrawal',
  referenceId: 'wd-1',
  amountCents: transferAmountOf(row),
  currency: 'USD',
  destinationRef: 'rise_dest_77',
  idempotencyKey: approvalKeyOf(row),
  ...over,
});

describe('the provider set, and the asymmetry with PspId', () => {
  test('one member, which is payout_transfers.provider DEFAULT', () => {
    expect(RAIL_PROVIDER_IDS).toStrictEqual(['rise']);
  });
});

describe('transferAmountOf is the only producer of an amount', () => {
  test('it returns the stored bigint unchanged', () => {
    expect(transferAmountOf(row)).toBe(125_00n);
  });

  test('a number is refused, which is how a float would arrive', () => {
    // A caller that reached here through an `any` is the case this guard is for;
    // the type already refuses it at compile time.
    const float = { amountCents: 125.5, idempotencyKey: 'k' } as unknown as StoredTransferRow;
    expect(() => transferAmountOf(float)).toThrow(TransferMintError);
    try {
      transferAmountOf(float);
      expect.unreachable('a float amount must not mint');
    } catch (error) {
      expect((error as TransferMintError).refusal).toBe('amount_not_bigint');
    }
  });

  test('zero and negative are refused, which is both tables own CHECK read forward', () => {
    for (const amountCents of [0n, -1n]) {
      try {
        transferAmountOf({ amountCents, idempotencyKey: 'k' });
        expect.unreachable(`${amountCents.toString()} must not mint`);
      } catch (error) {
        expect((error as TransferMintError).refusal).toBe('amount_not_positive');
      }
    }
  });
});

describe('approvalKeyOf is the only producer of a key, and it is the ROW key', () => {
  test('nothing is prefixed onto the stored key', () => {
    expect(approvalKeyOf(row)).toBe('wd_9f3a');
  });

  test('an empty key is refused, because INV-M5-06 needs one generated at approval', () => {
    try {
      approvalKeyOf({ amountCents: 1n, idempotencyKey: '' });
      expect.unreachable('an empty key must not mint');
    } catch (error) {
      expect((error as TransferMintError).refusal).toBe('approval_key_empty');
    }
  });

  test('an untrimmed key is REFUSED rather than trimmed', () => {
    // A silent trim would make `"k"` and `"k "` one key here and two rows in a
    // column that is UNIQUE over exact bytes.
    try {
      approvalKeyOf({ amountCents: 1n, idempotencyKey: 'wd_9f3a ' });
      expect.unreachable('an untrimmed key must not mint');
    } catch (error) {
      expect((error as TransferMintError).refusal).toBe('approval_key_untrimmed');
    }
  });
});

describe('enqueue is idempotent on the approval key, which is INV-M5-06', () => {
  test('the same key returns the same transfer and mints no second one', async () => {
    const rail = createSandboxRail({ secret: 's3cret', clock });

    const first = await rail.enqueue(instruction());
    const again = await rail.enqueue(instruction());

    expect(again).toStrictEqual(first);
    expect(rail.transfersMinted).toBe(1);
  });

  test('a DIFFERENT approval key is a different transfer', async () => {
    const rail = createSandboxRail({ secret: 's3cret', clock });

    const first = await rail.enqueue(instruction());
    const other = await rail.enqueue(
      instruction({
        referenceId: 'wd-2',
        idempotencyKey: approvalKeyOf({ amountCents: 1n, idempotencyKey: 'wd_0000' }),
      }),
    );

    expect(other.providerTransferId).not.toBe(first.providerTransferId);
    expect(rail.transfersMinted).toBe(2);
  });

  test('the acceptance echoes the key back, so a caller can prove what it keyed on', async () => {
    const rail = createSandboxRail({ secret: 's3cret', clock });
    const accepted = await rail.enqueue(instruction());
    expect(accepted.idempotencyKey).toBe('wd_9f3a');
    expect(accepted.provider).toBe('rise');
    expect(accepted.status).toBe('queued');
  });

  test('an acceptance never claims settled or failed', async () => {
    const rail = createSandboxRail({ secret: 's3cret', clock });
    const accepted = await rail.enqueue(instruction());
    expect(['queued', 'sent', 'retrying']).toContain(accepted.status);
  });
});

describe('health is a reachability probe and never a state', () => {
  test('it reports reachable and a latency, and no health word', async () => {
    const rail = createSandboxRail({ secret: 's3cret', clock, reachable: false, latencyMs: 9 });
    const probe = await rail.health();
    expect(probe).toStrictEqual({ provider: 'rise', reachable: false, latencyMs: 9 });
    expect(Object.keys(probe)).not.toContain('state');
    expect(Number.isInteger(probe.latencyMs)).toBe(true);
  });
});
