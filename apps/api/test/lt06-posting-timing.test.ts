import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  walletWithdrawalFailurePosting,
  entriesOf,
  identityAccount,
  firmAccount,
} from '@merit/ledger';
import { expect, test } from 'vitest';

// CI-02, the `unit` project.
//
// =============================================================================
// WHY `LT-06` CANNOT TAKE THE REMEDY `LT-01` TOOK, PINNED AT EACH SOURCE
// =============================================================================
// ADR-267. ADR-176 cleared an identical-LOOKING obstruction on the payout route
// by deleting `PayoutTx.ledger`, recording the approval on the request path and
// posting `LT-01` later at a system authority. `useWithdrawalBackend`'s entry
// now refuses on the same-shaped obstruction one leg over, so the question the
// dispatching row asked is whether that remedy transfers.
//
// IT DOES NOT, AND THE REASON IS NOT AN ANALOGY. It is that `LT-01` CREDITS the
// wallet and `LT-06` DEBITS it, and that the corpus separates the two legs' two
// holds by exactly this fact and calls that separation "the whole of the
// difference between the two legs". A deferred CREDIT understates a position and
// refuses more than it should; a deferred DEBIT overstates one and lets out
// money already promised away.
//
// ADR-238 IS THE PRECEDENT THIS FILE FOLLOWS RATHER THAN THE ONE IT ARGUES WITH.
// Its section 6 found the same remedy does not transfer to `LT-08` because M20
// pins that posting to the purchase transaction BY NAME and `DEP-M20-02` states
// the consequence of moving it. The pins for `LT-06` are different sentences in
// the same two documents, and each has a case below.
//
// -----------------------------------------------------------------------------
// WHY IT READS THE CORPUS AS TEXT
// -----------------------------------------------------------------------------
// Four of the six pins are sentences in FROZEN plans, and a ruling whose ground
// is a sentence is only as durable as a reader's memory of it. This is
// `ninth-transaction.test.ts`'s idiom, which holds `packages/ledger`'s `LT-09`
// transcription against M05 section 2.1 AS TEXT, applied to a ruling instead of
// to a builder: the day somebody edits one of these sentences, the case for it
// turns red and the session doing the editing learns which ruling it is moving.
//
// NOTHING HERE TOUCHES A DATABASE. Every case is a string read or a pure call.
// -----------------------------------------------------------------------------

const HERE = import.meta.dirname;
const ROOT = join(HERE, '..', '..', '..');

const read = (...parts: readonly string[]): string => readFileSync(join(ROOT, ...parts), 'utf8');

const M05 = read('docs', 'plans', 'M05-payout-system.md');
const M20 = read('docs', 'plans', 'M20-wallet.md');
const WITHDRAWALS = read('apps', 'api', 'src', 'routes', 'wallet-withdrawals.ts');
const WALLET_SQL = read('packages', 'db', 'migrations', '0011_wallet.sql');
const TERMINAL_SQL = read(
  'packages',
  'db',
  'migrations',
  '0057_terminal_withdrawal_obligation.sql',
);

// -----------------------------------------------------------------------------
// PIN 1. THE DIRECTIONS, READ OFF THE SHIPPED BUILDER AND OFF M05 SECTION 2.1
// -----------------------------------------------------------------------------
// ADR-267 clause 1. This is the fact the whole ruling rests on and it is the one
// fact here that is not a sentence: it is arithmetic a shipped function performs.

test('ADR-267 clause 1: `LT-06` DEBITS the wallet, measured through the exact negation the library exports', () => {
  // WHEN THIS CASE WAS WRITTEN `walletWithdrawalApprovalPosting` WAS PRIVATE,
  // deliberately, because nothing in this tree ruled `LT-06`'s writer. That was
  // ADR-267, dated 2026-08-30. ADR-270 clause 2 ruled the writer on 2026-08-30
  // as well, three entries later on the same day: a transaction a clock opens,
  // at `systemDb('nightly-batch')` in `apps/worker`. ADR-314 exported the
  // builder on that discharge. SO NOBODY OVERRODE A DELIBERATE DECISION HERE.
  // The decision was conditional on its own face and the condition was met.
  //
  // THE CASE IS UNCHANGED ANYWAY, AND DELIBERATELY SO. It still reads `LT-06`'s
  // signs through `LT-09`, built from it by `reversalPosting`, which swaps each
  // transfer's two sides and does nothing else. That composition is still the
  // only construction of `LT-06`'s arithmetic in `packages/ledger`, so an export
  // that altered the arithmetic turns this red. Which is why the export was
  // checked here rather than by a second case asserting the same thing another
  // way.
  const identityId = '11111111-1111-4111-8111-111111111111';
  const entries = entriesOf(
    walletWithdrawalFailurePosting(
      {
        withdrawalId: '22222222-2222-4222-8222-222222222222',
        identityId,
        amountCents: 25_000n,
        withdrawalIdempotencyKey: 'a-trader-supplied-key',
      },
      '33333333-3333-4333-8333-333333333333',
    ),
  );

  const wallet = identityAccount('trader_wallet', identityId);
  const inFlight = firmAccount('withdrawals_in_flight');

  const netOf = (code: string): bigint =>
    entries
      .filter((entry) => entry.account.code === code)
      .reduce((sum, entry) => sum + entry.amountCents, 0n);

  // `LT-09` CREDITS the wallet: it gives the claim back. Positive is debit
  // (`0009`'s COMMENT ON COLUMN, applied in `posting.ts` in one place).
  expect(netOf(wallet.code)).toBe(-25_000n);
  expect(netOf(inFlight.code)).toBe(25_000n);

  // Therefore `LT-06`, of which this is the exact negation, DEBITS the wallet
  // by the same amount. That is the sentence ADR-267 clause 1 turns on.
});

test('ADR-267 clause 1: M05 section 2.1 puts the wallet on OPPOSITE sides of `LT-01` and `LT-06`', () => {
  // The asymmetry stated in the primary source rather than derived from the
  // builder, because the builder is a transcription of this row and a
  // transcription cannot be its own authority.
  const lt01 = M05.split('\n').find((line) => line.startsWith('| LT-01 |'));
  const lt06 = M05.split('\n').find((line) => line.startsWith('| LT-06 |'));

  expect(lt01).toBeDefined();
  expect(lt06).toBeDefined();

  // `LT-01` CREDITS `trader_wallet`. Its debit leg is `trader_withdrawable`,
  // which is not a wallet balance and is not what INV-M20-01 governs.
  expect(lt01).toContain('debit `trader_withdrawable` (identity) `approved_cents`');
  expect(lt01).toContain('credit **`trader_wallet`** (identity) `trader_cents`');

  // `LT-06` DEBITS `trader_wallet`.
  expect(lt06).toContain('debit `trader_wallet` (identity) `amount_cents`');
});

// -----------------------------------------------------------------------------
// PIN 2. INV-M20-01 BINDS EVERY WALLET DEBIT TO THE TRANSACTION THAT CHECKS IT
// -----------------------------------------------------------------------------
// ADR-267 clause 2. This is `LT-06`'s `DEP-M20-02`: a sentence that pins the
// posting's transaction and states the consequence of moving it in its own first
// clause.

test('ADR-267 clause 2: INV-M20-01 requires the check and the debit in ONE transaction', () => {
  const row = M20.split('\n').find((line) => line.startsWith('| INV-M20-01 |'));
  expect(row).toBeDefined();
  expect(row).toContain('A wallet balance is **never negative**');
  expect(row).toContain(
    'every debit is checked against the live position inside the same transaction',
  );
});

test('ADR-267 clause 2: the funds check `LT-06` would be split from is on the REQUEST path', () => {
  // `gateFunds` runs inside `decideWithdrawal`, which is the handler that
  // creates the row at `requested` or `cooling`. Under ADR-176's remedy the
  // debit would post from a different transaction at a different authority, and
  // the two would then be exactly what INV-M20-01 forbids.
  const decide = WITHDRAWALS.indexOf('export async function decideWithdrawal(');
  const funds = WITHDRAWALS.indexOf('const funds = gateFunds(amountCents, entries);', decide);
  const insert = WITHDRAWALS.indexOf('await tx.insertWithdrawal({', decide);

  expect(decide).toBeGreaterThan(-1);
  expect(funds).toBeGreaterThan(decide);
  expect(insert).toBeGreaterThan(funds);
});

// -----------------------------------------------------------------------------
// PIN 3. THE CORPUS SEPARATES THE TWO HOLDS BY THIS EXACT FACT
// -----------------------------------------------------------------------------
// ADR-267 clause 3, and it is the decisive one. ADR-176's remedy IS "a decision
// that has posted nothing". M20 names that shape, pins it to the INTERNAL leg,
// and says in terms that the external leg is the other one.

test('ADR-267 clause 3: M20 section 3.3a separates the payout hold from the wallet halt by the posting', () => {
  const row = M20.split('\n').find((line) => line.startsWith('| Ledger at entry |'));
  expect(row).toBeDefined();
  expect(row).toContain('**nothing posted**');
  expect(row).toContain("LT-06 already posted; **the money is already the trader's**");
});

test('ADR-267 clause 3: M20 calls that difference the WHOLE of the difference between the legs', () => {
  expect(M20).toContain('**it is the whole of the difference between the two legs**');
  expect(M20).toContain(
    'the internal one holds a decision that has posted nothing, and this one holds a payment ' +
      'whose ledger entry already exists',
  );
  // INV-M20-14 is what that sentence buys, and it is what a deferred `LT-06`
  // would make false for the whole of the deferral window: a halt landing on an
  // `approved` withdrawal whose posting has not happened is holding a CLAIM,
  // and releasing it would have to re-pay.
  expect(M20).toContain('**A halt expires, and release resumes the rail rather than re-paying**');
});

test('ADR-267 clause 3: the deferral the corpus DOES bless is the payout hold, and it says so once', () => {
  // M05's hold branch is ADR-176's remedy already shipped one leg over: the
  // whole evaluated decision frozen at request time, and only the posting
  // deferred. There is no sentence of this shape anywhere on the external leg,
  // and the section 3.3a row above is the sentence that says the opposite.
  expect(M05).toContain('**Only the ledger posting is deferred.**');
  expect(M20).not.toContain('Only the ledger posting is deferred');
});

// -----------------------------------------------------------------------------
// PIN 4. WHAT IS *NOT* THE REASON, ASSERTED SO A SUCCESSOR DOES NOT REACH FOR IT
// -----------------------------------------------------------------------------
// ADR-267 clause 4. ADR-176 clause 2 was "the price of clause 1": deleting the
// handle without storing the client's key would have committed approvals no door
// could ever post. That half is ALREADY PAID on this leg, and the remedy still
// fails. Which is the cleanest available evidence that the obstruction is the
// posting's TIMING and not its key.

test('ADR-267 clause 4: `wallet_withdrawals` already stores the key `LT-06` posts under', () => {
  expect(WALLET_SQL).toContain('idempotency_key           text NOT NULL,');
  expect(WALLET_SQL).toContain('ON wallet_withdrawals (identity_id, idempotency_key);');
  // And the create path writes it, which is what `PayoutRequestInsert` did NOT
  // do before ADR-176 clause 2.
  expect(WITHDRAWALS).toContain('  const written = await tx.insertWithdrawal({');
  const insert = WITHDRAWALS.indexOf('  const written = await tx.insertWithdrawal({');
  expect(WITHDRAWALS.slice(insert, insert + 400)).toContain('idempotencyKey,');
});

test('ADR-267 clause 4: nothing in the DDL refuses an `approved` withdrawal with no posting', () => {
  // `WD-C1` is the only thing in this database that reads a withdrawal's
  // postings, and its `WHEN` clause enumerates the three TERMINAL states. The
  // pin on `LT-06` is in the CORPUS and not in the schema, and saying so is part
  // of the ruling rather than an omission from it.
  expect(TERMINAL_SQL).toContain("  WHEN (NEW.status IN ('settled', 'failed', 'cancelled'))");
  expect(TERMINAL_SQL).not.toContain("NEW.status IN ('approved'");
});

// -----------------------------------------------------------------------------
// PIN 5. THE CONTROL THAT WOULD BE CARRYING THE SAFETY, AND HOW FAR IT REACHES
// -----------------------------------------------------------------------------
// ADR-267 clause 5. ADR-232 section 6 measured that "today nothing double-spends
// it only because `gateNoInFlight` refuses the second withdrawal anyway". That
// dependence is NARROWER than it reads, and this case is the measurement.

test('ADR-267 clause 5: `gateNoInFlight` exists in one file and is not on the wallet-SPEND path', () => {
  // `LT-08` debits the same `trader_wallet` position from `checkout.ts` under
  // INV-M3-13, and nothing there consults this gate. So a deferred `LT-06` would
  // leave two doors each checking the same cents against a position that still
  // holds them, and the second one is not the one `gateNoInFlight` refuses.
  const CHECKOUT = read('apps', 'api', 'src', 'routes', 'checkout.ts');
  expect(WITHDRAWALS).toContain('function gateNoInFlight(');
  expect(CHECKOUT).not.toContain('gateNoInFlight');

  // And `approved` is inside the list it refuses on, so the gate does not even
  // end at the approval: it is the reason the entry's LOCKOUT half is
  // discharged and the POSTING half is not.
  const open = WITHDRAWALS.indexOf('export const OPEN_WITHDRAWAL_STATUSES = [');
  expect(open).toBeGreaterThan(-1);
  expect(WITHDRAWALS.slice(open, open + 200)).toContain("'approved',");
});
