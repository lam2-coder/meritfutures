// =============================================================================
// packages/rail/test/schema-bind.test.ts
// =============================================================================
// THE ASYMMETRY `port.ts` CLAIMS, ASSERTED IN THE DIRECTION THAT CAN GO WRONG.
//
// `RailProviderId` is narrower than the column it describes, and the file says
// so. THIS FILE ASSERTS THE ABSENCE OF THE CHECK rather than asserting a
// constraint that is not there, which is the only way round that is honest: the
// day somebody adds a CHECK to `payout_transfers.provider`, this goes red and
// the next reader is told that the type may now be derived from a constraint
// instead of from a DEFAULT.
//
// AND IT BINDS THE COLUMNS THE PORT'S SHAPES ARE ABOUT. `StoredTransferRow` is
// two fields because two tables present the rail with the same two facts, and
// that claim is only true while both tables really carry both columns.
//
// IT ASSERTS NOTHING ABOUT WHAT A ROUTE WOULD WRITE, because this package writes
// nothing. Everything here is read out of the migrations and compared to a type.
// =============================================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { RAIL_PROVIDER_IDS } from '../src/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), 'utf8');

const PAYOUTS_SQL = read('packages', 'db', 'migrations', '0010_payouts.sql');
const WALLET_SQL = read('packages', 'db', 'migrations', '0011_wallet.sql');

/** One `CREATE TABLE name (...)` body, as written. */
function tableBody(source: string, name: string): string {
  const at = source.indexOf(`CREATE TABLE ${name} (`);
  expect(at, `${name} is created`).toBeGreaterThan(-1);
  return source.slice(at, source.indexOf('\n);', at));
}

const TRANSFERS = tableBody(PAYOUTS_SQL, 'payout_transfers');
const WITHDRAWALS = tableBody(WALLET_SQL, 'wallet_withdrawals');

describe('the provider column, and why this type is derived from a DEFAULT', () => {
  test('payout_transfers.provider is text NOT NULL DEFAULT rise', () => {
    expect(TRANSFERS).toMatch(/provider\s+text NOT NULL DEFAULT 'rise'/);
  });

  test('and it carries NO CHECK, which is the asymmetry with purchases.psp', () => {
    // The needle is any CHECK naming this column, in the table body. Its absence
    // is the finding; a CHECK appearing here later is a different world and this
    // test is where a reader is told so.
    expect(TRANSFERS).not.toMatch(/CHECK\s*\(\s*provider/);
    expect(TRANSFERS).not.toMatch(/provider\s+text NOT NULL[^,]*CHECK/);
  });

  test('the type is one member, and it is that DEFAULT', () => {
    expect(RAIL_PROVIDER_IDS).toStrictEqual(['rise']);
    expect(TRANSFERS).toContain("DEFAULT 'rise'");
  });

  test('the only other place in the tree naming the value agrees', () => {
    const rise = read('apps', 'api', 'src', 'rise-webhook.ts');
    expect(rise).toContain("export const RISE_PROVIDER = 'rise';");
  });

  test('the STATUS column IS closed by a CHECK, so the absence above is not the file style', () => {
    // Without this control, "no CHECK on provider" could be true of a table that
    // has no CHECKs at all and the finding would be about nothing.
    expect(TRANSFERS).toMatch(
      /status\s+text NOT NULL CHECK \(status IN \(\s*'queued', 'sent', 'settled', 'failed', 'retrying'\s*\)\)/,
    );
  });
});

describe('StoredTransferRow is two fields because two tables present the same two facts', () => {
  test('payout_transfers carries a positive-checked amount and a UNIQUE key', () => {
    expect(TRANSFERS).toContain('idempotency_key        text NOT NULL UNIQUE');
    expect(TRANSFERS).toContain('amount_cents           bigint NOT NULL CHECK (amount_cents > 0)');
  });

  test('wallet_withdrawals carries the same two, and its key is unique PER IDENTITY', () => {
    expect(WITHDRAWALS).toContain('idempotency_key           text NOT NULL');
    expect(WITHDRAWALS).toContain(
      'amount_cents              bigint NOT NULL CHECK (amount_cents > 0)',
    );
    expect(WALLET_SQL).toContain('CREATE UNIQUE INDEX wallet_withdrawals_identity_idempotency_uq');
  });

  test('both amounts are bigint, so integer cents is the schemas word and not this ports', () => {
    for (const [what, body] of [
      ['payout_transfers', TRANSFERS],
      ['wallet_withdrawals', WITHDRAWALS],
    ] as const) {
      expect(body, what).toMatch(/amount_cents\s+bigint/);
      expect(body, what).not.toMatch(/amount_cents\s+(numeric|real|double|float)/);
    }
  });
});

describe('the anchor the contract names, and the reason a withdrawal has no transfer row', () => {
  test('provider plus provider_transfer_id is the unique index', () => {
    expect(PAYOUTS_SQL).toContain('CREATE UNIQUE INDEX payout_transfers_provider_transfer_uq');
    expect(PAYOUTS_SQL).toContain('ON payout_transfers (provider, provider_transfer_id)');
  });

  test('payout_transfers cannot hold a withdrawal, which is what TransferLeg is about', () => {
    // `payout_request_id` is NOT NULL and references payout_requests, so a
    // wallet_withdrawals row has nowhere to be written here. Reported in
    // `port.ts` beside `TransferLeg` and not repaired by this session.
    expect(TRANSFERS).toContain(
      'payout_request_id      uuid NOT NULL REFERENCES payout_requests(id)',
    );
  });

  test('one transfer emits more than one event, which is why the anchor is a PAIR', () => {
    // The status vocabulary is five members, so anchoring on the transfer alone
    // would make the second event about a transfer look like a duplicate of the
    // first. `replay.test.ts` drives that case.
    const statuses = ['queued', 'sent', 'settled', 'failed', 'retrying'];
    for (const status of statuses) expect(TRANSFERS).toContain(`'${status}'`);
  });
});
