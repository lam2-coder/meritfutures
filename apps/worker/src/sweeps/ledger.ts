// =============================================================================
// apps/worker/src/sweeps/ledger.ts
// =============================================================================
// THIS DEPLOYABLE'S LEDGER DOOR. TWO PORTS OVER `@merit/ledger`, AND EACH
// TRANSACTION IS RECOVERED BY IDENTITY RATHER THAN READ OFF A MEMBER THE PORT
// DOES NOT HAVE.
//
// ADR-305 section 7 slice 6 wrote the first half. `postLt01` had a declaration,
// a caller in `expiry.ts` and a rejector in `UNWIRED_EXPIRY_SWEEP_IO`, and no
// implementation anywhere; this file is the implementation and it is the whole
// of it.
//
// SLICE 7 (ADR-325) ADDED THE SECOND HALF, `ApprovalLedgerPort` OVER `LT-06`,
// AND IT LANDED HERE RATHER THAN IN `src/withdrawals/` FOR A REASON WORTH
// STATING WHERE THE CONSEQUENCE LIVES. `apps/worker/package.json`'s own
// `//dependencies.@merit/ledger` key says the grant reaches EXACTLY ONE FILE and
// names it, and `apps/api/test/ledger-posting-authority.test.ts` asserts the
// specifier occurs at exactly `apps/worker/src/sweeps/ledger.ts` and that
// `postTransaction(` is called from exactly that path. A second importer would
// turn both assertions red BY CHOICE rather than by succeeding, and the one-door
// pattern ADR-165 set is one door PER DEPLOYABLE and not one per module: a
// reviewer asking where `apps/worker` posts a ledger entry gets ONE answer with
// a path in it, and two files would be two answers.
//
// THE FILE'S NAME IS NOW NARROWER THAN ITS CONTENTS AND THAT IS REPORTED RATHER
// THAN REPAIRED. The withdrawal approval driver is not a `sweeps/` job; it lives
// at `src/withdrawals/approval-sweep.ts` and only its ledger adapter is here.
// Moving this file to `src/ledger.ts`, beside `src/db.ts` whose shape it copies,
// is the honest name and it is a RENAME of a money-path file that slice 6 landed
// four days ago, plus a rewrite of two assertions in a suite this row would then
// be editing for a reason that is not a finding. It is named as owed.
//
// -----------------------------------------------------------------------------
// THIS IS THE ONE FILE IN THIS DEPLOYABLE THAT NAMES `@merit/ledger`
// -----------------------------------------------------------------------------
// `src/db.ts` is the same shape one package over and states the reason ADR-165
// gave for it: a manifest line grants a capability to a whole deployable at
// once, and a reviewer asking where `apps/worker` posts a ledger entry should
// get ONE answer with a path in it. `apps/worker/package.json`'s own
// `//dependencies.@merit/ledger` key names this file, and
// `apps/api/test/ledger-posting-authority.test.ts` walks `apps/worker/src` and
// asserts the import occurs here and nowhere else. That is the difference
// between a convention and a control.
//
// IT REACHES NO DATABASE AND IT COULD NOT. There is no `@merit/db` import here,
// so ADR-165's ONE-DOOR rule is untouched and `test/db.test.ts` runs it: that
// suite parses every BARE SPECIFIER under `src/` and asserts the accessor is
// imported by `src/db.ts` alone.
//
// **THE CLAUSE `ports.ts` STATES IN GREP FORM IS NOT THE CONTROL AND WAS
// ALREADY FALSE AS SPELLED BEFORE THIS FILE EXISTED.** That header says
// `grep -rlE "from '@merit/db'" apps/worker/src` must print `src/db.ts` and
// nothing else; run today it prints SEVEN files, six of them because their
// COMMENTS quote the clause, and this file is the seventh for the same reason.
// The property is true and the command is not the way to read it, which is why
// the specifier scan is named here instead. Reported rather than repaired:
// `ports.ts` is outside this row's fence and the repair is a rewrite.
//
// `packages/ledger` declares no dependency of its own, cannot import a client
// and cannot open a pool, so what arrives here is always the caller's
// already-open transaction (ADR-006, and `packages/ledger/src/tx.ts` says why
// in its own header).
//
// -----------------------------------------------------------------------------
// THE HANDLE STAYS IN THE WIRING, WHICH IS ADR-315's RULING AND NOT A CHOICE
// TAKEN HERE
// -----------------------------------------------------------------------------
// `ExpiryTx` declares `rowsWhere`, `lockAt` and `updateAt` and NO `ledger`
// member. `ports.ts`'s docblock over `ExpiryLedgerPort` records why that
// member was refused rather than merely omitted, and the reason is worth
// repeating at the file that lives with the consequence: `ports.ts` imports
// nothing, so a `ledger` member could only RESTATE `@merit/ledger`'s
// `LedgerTx` there, and restating it writes `LedgerWriteKey`, which is exactly
// the two keys `EXPIRY_TABLES` excludes, back into the sweep's own port as an
// `insert` key union. That is a single-sided entry one call away from the
// sweep, past `assertBalanced`, past `LEDGER-C1` and past the halt check.
//
// SO THE PORT IS GIVEN AN `ExpiryTx` AND LOOKS THE LEDGER HANDLE UP BY THE
// IDENTITY OF THAT OBJECT. `packages/db/src/scoped-db.ts` already does this
// with `TERMS`, a module-scoped `WeakSet` that recognises a filter term by
// identity rather than by shape, and `ports.ts` cites that idiom by name where
// it declares `ExpiryFilterTerm`. This is the same idiom turned on a handle
// instead of on a term.
//
// A `WeakMap` RATHER THAN A `WeakSet`, AND THE DIFFERENCE IS A CAST THAT DOES
// NOT GET WRITTEN. Membership of a set is a boolean and `postLt01` would still
// be holding an `ExpiryTx` it had to assert into a `LedgerTx`; a map hands the
// value back already typed. The key and the value are THE SAME OBJECT, which
// is what "records it against itself" means and is the only reason no second
// handle exists: the `LedgerTx` this posting is written through IS the
// transaction the release was written through. `WeakMap` keys are held weakly
// and a self-referencing entry is collectable when nothing else holds the
// object, so a long-running process does not accumulate one entry per sweep.
//
// -----------------------------------------------------------------------------
// IT REFUSES A HANDLE THIS FILE DID NOT RECORD, AND THAT IS THE POINT OF THE
// LOOKUP RATHER THAN A SIDE EFFECT OF IT
// -----------------------------------------------------------------------------
// A handle nothing recorded is a handle whose authority this file cannot know.
// `SystemTx` carries a `reason` and `ScopedTx` carries an identity, and neither
// is readable through `ExpiryTx`, whose three members say nothing about which
// door opened the transaction. The refusal is therefore the honest answer and
// not a defensive one: the alternative is posting a payout through whatever
// object the caller happened to pass, which is `UNWIRED_EXPIRY_SWEEP_IO`'s
// sentence one level down. A fixture cannot reach the posting by shape, and a
// second transaction opened beside the release cannot reach it at all.
//
// -----------------------------------------------------------------------------
// THE HALT REFUSES THE POSTING AND NO OVERRIDE IS TAKEN
// -----------------------------------------------------------------------------
// `postTransaction` asserts against `ledger_halts` unless the caller passes
// `despiteHalt`, and this file passes no options at all: `PostOptions` is not
// named here, and the word occurs in NO CODE anywhere under `apps/worker/src`,
// which `test/sweep-ledger.test.ts` walks the tree to assert. A refused
// posting throws, the sweep's `releaseHold` catches it, `io.transact` rolls the
// release back and the request stays `held_pending_review`, which is the
// correct direction. `P5-k`'s nightly assertion is what reports the row that
// stayed held. Overriding a halt is a ruling this row does not take.
//
// -----------------------------------------------------------------------------
// NOTHING INSTALLS THIS, AND THAT IS SLICE 9's
// -----------------------------------------------------------------------------
// `UNWIRED_EXPIRY_SWEEP_IO` is still the default and no `ExpirySweepIo` is
// constructed anywhere in this deployable: `terms` needs `packages/db`'s
// constructors and `events` needs a sink `P5-n` has not written. So
// `recordExpiryTransaction` has NO caller under `src/`, the map is empty in
// every deployment, and `postLt01` would refuse every handle it was given.
// `ledger-posting-authority.test.ts` runs that measurement rather than trusting
// this paragraph.
// =============================================================================

import { lt01, postTransaction, readChart, walletWithdrawalApprovalPosting } from '@merit/ledger';
import type { LedgerTx } from '@merit/ledger';

import type { ApprovalFacts, ApprovalLedgerPort, ApprovalTx } from '../withdrawals/ports.ts';
import type { ExpiryLedgerPort, ExpiryTx, Lt01Values } from './ports.ts';

/**
 * Every transaction the wiring opened and handed to the sweep.
 *
 * IDENTITY AND NOT SHAPE, which is `TERMS`' reason in
 * `packages/db/src/scoped-db.ts` and holds harder here: an object with a `rows`
 * and an `insert` method is not evidence of anything, and a shape check would
 * read a fake as a live handle onto the trader database.
 *
 * THE VALUE IS THE KEY. It is stored a second time under a `LedgerTx` type so
 * the lookup returns a typed handle rather than a boolean somebody has to cast
 * past, and storing anything else would mean a posting written through a
 * transaction other than the one the release was written through.
 */
const OPENED = new WeakMap<ExpiryTx, LedgerTx>();

/**
 * Record the transaction this wiring just opened, and hand it straight back.
 *
 * THE CALLER IS THE WIRING AND THERE IS NOT ONE YET. Slice 9 opens ONE
 * transaction through `WorkerDb.batch`, passes it through here, and gives the
 * result to `ExpirySweepIo.transact`'s callback as the `ExpiryTx` it already
 * satisfies. The argument is `ExpiryTx & LedgerTx` because `SystemTx` satisfies
 * both structurally and nothing narrower can serve the posting.
 *
 * IT RETURNS ITS ARGUMENT so the recording cannot be forgotten at a call site
 * that meant to do it: `transact(fn)` is written as
 * `db.batch((tx) => fn(recordExpiryTransaction(tx)))` and there is no arrangement
 * of that line in which the handle reaches the sweep unrecorded. `mintTerm` in
 * `packages/db/src/scoped-db.ts` is the same three lines for the same reason.
 */
export function recordExpiryTransaction<T extends ExpiryTx & LedgerTx>(tx: T): T {
  OPENED.set(tx, tx);
  return tx;
}

/**
 * Raised when `postLt01` is given a handle this file never recorded.
 *
 * IT NAMES THE WIRING RATHER THAN THE CALLER, because the caller is
 * `releaseHold` and the caller is not what is wrong: the sweep passed on the
 * handle it was given, and what is missing is the `recordExpiryTransaction` the
 * wiring owed. `ExpirySweepUnwired`'s message is the model, and the value this
 * one would otherwise have to invent is the same one: whether a held payout was
 * released and paid.
 */
export class ExpiryLedgerHandleUnknown extends Error {
  constructor() {
    super(
      'ExpiryLedgerPort.postLt01 was given a transaction this deployment did not open. The ' +
        'LT-01 posting is written through the SAME transaction as the release (ADR-006), so ' +
        'the handle is recovered by identity through `recordExpiryTransaction` and a handle ' +
        'that was never recorded is a handle whose authority this adapter cannot know. It ' +
        'refuses rather than posting a payout through an object a caller happened to pass.',
    );
    this.name = 'ExpiryLedgerHandleUnknown';
  }
}

/**
 * The `LT-01` posting, on the transaction the release was written through.
 *
 * THREE CALLS AND NOTHING MORE, which is what `ports.ts` specifies once the
 * handle is in hand. This file names no ledger account, writes no transfer and
 * contains no ledger arithmetic: `lt01` holds the split, asserts `INV-M5-03`
 * over it internally and is the ONE definition of `LT-01` in this repository
 * (ADR-317). A second transcription of `debit trader_withdrawable / credit
 * trader_wallet / credit fees_revenue` here is ADR-092 section 5's
 * two-statements-of-one-fact hazard arriving on the money path.
 *
 * `readChart` IS READ THROUGH THE SAME HANDLE, so the chart a posting resolves
 * against is the chart visible inside that transaction and not one read beside
 * it. It is not cached across calls: a chart cached in this module would
 * outlive the transaction it was read in, and `LEDGER-C1` is checked against
 * the account uuids it resolves.
 *
 * NOTHING IS RETURNED. `PostedTransaction` carries a transaction id, an entry
 * count and a net that is always `0n`, and the port declares `Promise<void>`
 * because the sweep has nothing to do with any of the three: the release
 * already happened, and what a failure means is a rolled-back transaction
 * rather than a value to inspect.
 */
export const EXPIRY_LEDGER: ExpiryLedgerPort = {
  async postLt01(tx: ExpiryTx, values: Lt01Values): Promise<void> {
    const ledger = OPENED.get(tx);
    if (ledger === undefined) throw new ExpiryLedgerHandleUnknown();
    await postTransaction(ledger, await readChart(ledger), lt01(values));
  },
};

// =============================================================================
// `ApprovalLedgerPort`, WHICH IS THE SAME MECHANISM ON A DIFFERENT POSTING
// =============================================================================
// ADR-325, ADR-305 section 7 slice 7. `LT-06` extinguishes a trader's wallet
// claim and turns it into a firm obligation, and the driver that posts it is
// `src/withdrawals/approval-sweep.ts`.
//
// A SECOND MAP AND NOT A SECOND ENTRY IN THE FIRST, because the two ports take
// two different handle shapes: `ExpiryTx` has three members and `ApprovalTx` has
// five, and a single map keyed on the wider shape would let a handle recorded
// for the expiry sweep serve an approval posting. THE REFUSAL IS THE POINT OF
// THE LOOKUP and a map that recognised more handles than its own wiring opened
// would be a weaker refusal wearing the same mechanism.
// -----------------------------------------------------------------------------

/**
 * Every transaction the approval wiring opened and handed to the driver.
 *
 * IDENTITY AND NOT SHAPE, which is {@link OPENED}'s reason and holds harder
 * here: `LT-06` is the posting that extinguishes a wallet claim, and a shape
 * check would read a fake as a live handle onto the trader database.
 */
const OPENED_APPROVALS = new WeakMap<ApprovalTx, LedgerTx>();

/**
 * Record the transaction this wiring just opened, and hand it straight back.
 *
 * THE CALLER IS THE WIRING AND THERE IS NOT ONE YET. Slice 9 opens ONE
 * transaction through `WorkerDb.batch`, passes it through here, and gives the
 * result to `WithdrawalApprovalSweepIo.transact`'s callback as the `ApprovalTx`
 * it already satisfies. The argument is `ApprovalTx & LedgerTx` because
 * `SystemTx` satisfies both structurally and nothing narrower can serve the
 * posting.
 *
 * IT RETURNS ITS ARGUMENT so the recording cannot be forgotten at a call site
 * that meant to do it, which is {@link recordExpiryTransaction}'s reason and
 * `mintTerm`'s in `packages/db/src/scoped-db.ts`.
 */
export function recordApprovalTransaction<T extends ApprovalTx & LedgerTx>(tx: T): T {
  OPENED_APPROVALS.set(tx, tx);
  return tx;
}

/**
 * Raised when `postLt06` is given a handle this file never recorded.
 *
 * IT NAMES THE WIRING RATHER THAN THE CALLER, on
 * {@link ExpiryLedgerHandleUnknown}'s reason: the driver passed on the handle it
 * was given, and what is missing is the `recordApprovalTransaction` the wiring
 * owed. The value this one would otherwise have to invent is whether a trader's
 * wallet claim was extinguished.
 */
export class ApprovalLedgerHandleUnknown extends Error {
  constructor() {
    super(
      'ApprovalLedgerPort.postLt06 was given a transaction this deployment did not open. The ' +
        'LT-06 posting is written through the SAME transaction as the approval (ADR-006), so ' +
        'the handle is recovered by identity through `recordApprovalTransaction` and a handle ' +
        'that was never recorded is a handle whose authority this adapter cannot know. It ' +
        "refuses rather than extinguishing a trader's wallet claim through an object a caller " +
        'happened to pass.',
    );
    this.name = 'ApprovalLedgerHandleUnknown';
  }
}

/**
 * The `LT-06` posting, on the transaction the approval was written through.
 *
 * THREE CALLS AND NOTHING MORE. This file names no ledger account, writes no
 * transfer and contains no ledger arithmetic:
 * `walletWithdrawalApprovalPosting` holds the single transfer, is the ONE
 * definition of `LT-06` in this repository, and `LT-09` is still built on it
 * through `reversalPosting`, so the two cannot disagree (ADR-314). A second
 * transcription of `debit trader_wallet / credit withdrawals_in_flight` here is
 * ADR-092 section 5's two-statements-of-one-fact hazard arriving on the money
 * path, and `LT-06` being a SINGLE transfer is exactly what makes it the one a
 * session would be tempted to inline.
 *
 * IT RETURNS THE TRANSACTION ID AND `postLt01` RETURNS NOTHING, WHICH IS A
 * DIFFERENCE IN WHAT THE TWO JOBS OWE RATHER THAN AN INCONSISTENCY. The expiry
 * sweep appends no wallet row and has nothing to do with the id; this driver
 * appends the debit, `wallet_entries.ledger_transaction_id` is `uuid NOT NULL
 * REFERENCES ledger_transactions(id)` (`0011:83`), and `APPROVAL_TABLES`
 * excludes both ledger keys deliberately, so the id can be neither invented nor
 * read back. ADR-316 section 3.3 declared this port `Promise<void>` and ADR-325
 * section 3 records the finding.
 *
 * `readChart` IS READ THROUGH THE SAME HANDLE, so the chart a posting resolves
 * against is the chart visible inside that transaction and not one read beside
 * it. It is not cached across calls, because a cached chart would outlive the
 * transaction it was read in and `LEDGER-C1` is checked against the account
 * uuids it resolves.
 */
export const APPROVAL_LEDGER: ApprovalLedgerPort = {
  async postLt06(tx: ApprovalTx, facts: ApprovalFacts): Promise<string> {
    const ledger = OPENED_APPROVALS.get(tx);
    if (ledger === undefined) throw new ApprovalLedgerHandleUnknown();
    const posted = await postTransaction(
      ledger,
      await readChart(ledger),
      walletWithdrawalApprovalPosting(facts),
    );
    return posted.transactionId;
  },
};
