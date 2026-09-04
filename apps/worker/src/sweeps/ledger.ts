// =============================================================================
// apps/worker/src/sweeps/ledger.ts
// =============================================================================
// `ExpiryLedgerPort` OVER `@merit/ledger`, AND THE TRANSACTION IS RECOVERED BY
// IDENTITY RATHER THAN READ OFF A MEMBER THE PORT DOES NOT HAVE.
//
// ADR-305 section 7 slice 6. `postLt01` had a declaration, a caller in
// `expiry.ts` and a rejector in `UNWIRED_EXPIRY_SWEEP_IO`, and no
// implementation anywhere; this file is the implementation and it is the whole
// of it.
//
// -----------------------------------------------------------------------------
// THIS IS THE ONE FILE IN THIS DEPLOYABLE THAT NAMES `@merit/ledger`
// -----------------------------------------------------------------------------
// `src/db.ts` is the same shape one package over and states the reason ADR-165
// gave for it: a manifest line grants a capability to a whole deployable at
// once, and a reviewer asking where `apps/worker` posts a ledger entry should
// get ONE answer with a path in it. `apps/worker/package.json`'s own
// `//dependencies.@merit/ledger` key names this file, and
// `test/sweep-ledger.test.ts` walks `src/` and asserts the name occurs here and
// nowhere else. That is the difference between a convention and a control.
//
// IT REACHES NO DATABASE AND IT COULD NOT. There is no `@merit/db` import here,
// so the ONE-DOOR clause ADR-165 states in terms is untouched: `grep -rlE
// "from '@merit/db'" apps/worker/src` still prints `apps/worker/src/db.ts` and
// nothing else. `packages/ledger` declares no dependency of its own, cannot
// import a client and cannot open a pool, so what arrives here is always the
// caller's already-open transaction (ADR-006, and `packages/ledger/src/tx.ts`
// says why in its own header).
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
// named here and `despiteHalt` does not occur in this deployable. A refused
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

import { lt01, postTransaction, readChart } from '@merit/ledger';
import type { LedgerTx } from '@merit/ledger';

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
