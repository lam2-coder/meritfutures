// =============================================================================
// packages/ledger/src/payout.ts
// =============================================================================
// `LT-01`, `payout_approval`. THE BUILDER, IN THE LIBRARY BOTH DEPLOYABLES CAN
// IMPORT.
//
// This function was declared in `apps/api/src/routes/payouts.ts` from ADR-176
// until ADR-317 moved it here, and the move is CODE MOTION: the arithmetic, the
// account names, the memos, the `INV-M5-03` refusal and its message text are
// what was there, transcribed once and not restated. ADR-305's `F2` is why it
// moved: `apps/worker` cannot import `apps/api` (ADR-286), the hourly sweep's
// `ExpiryLedgerPort.postLt01` needs this posting, and `sweeps/ports.ts` refuses
// a second transcription of `debit trader_withdrawable / credit trader_wallet /
// credit fees_revenue` BY NAME, calling it ADR-092 section 5's
// two-statements-of-one-fact hazard arriving on the money path. So the choice
// was one statement in a package both deployables reach, or two statements. It
// is one.
//
// BOTH DOORS IN `apps/api` NOW IMPORT IT FROM HERE rather than one of them
// declaring it and the other reaching across a route module for it, and the
// property the old arrangement protected is unchanged: `LT-01` is stated ONCE
// in this repository. `apps/api/test/payouts.test.ts` holds that over three
// files where it used to hold it over two.
//
// THIS FILE OPENS NO TRANSACTION AND READS NO ROW, which is the whole package's
// rule and not this file's: `postTransaction` takes the caller's OPEN
// transaction as its first argument, so the movement commits with the state
// change that caused it (ADR-006).
// =============================================================================

import { firmAccount, identityAccount } from './accounts.ts';
import { posting, transfer, type Posting } from './posting.ts';

/**
 * Raised when a value on the money path is not integer cents.
 *
 * IT CAME HERE WITH `lt01` AND ITS NAME IS UNCHANGED ON PURPOSE (ADR-317). The
 * class is thrown at two sites: the `INV-M5-03` refusal below, and
 * `centsToJson` in `apps/api/src/routes/payouts.ts`, which imports it back. A
 * name is observable on a thrown error even where nothing catches it, and this
 * move was ruled to change no behaviour, so the name did not move either. The
 * word `Payout` is the only part of it that reads oddly from inside a
 * double-entry library; splitting the two throw sites onto two classes is a
 * ruling a later row may take and is not taken here, because taking it during a
 * motion ruled to change nothing is how a motion stops being one.
 */
export class PayoutMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayoutMoneyError';
  }
}

/**
 * M05 section 2.1's `LT-01`, `payout_approval`.
 *
 *   debit  `trader_withdrawable` (identity)  `approved_cents`
 *   credit `trader_wallet`       (identity)  `trader_cents`
 *   credit `fees_revenue`        (firm)      `firm_cents`
 *
 * THE TABLE'S THREE ENTRIES ARE WRITTEN AS TWO TRANSFERS AND THEREFORE FOUR
 * ENTRIES, AND THAT IS A PROPERTY OF `ADR-104` RULING 1 RATHER THAN A CHOICE
 * MADE HERE. "An entry is never constructed. A `Transfer` is, and every
 * transfer yields exactly two entries." A one-debit two-credit posting is
 * therefore UNREPRESENTABLE in this library, by the same construction that
 * makes the imbalance unrepresentable. The two debits are both against
 * `trader_withdrawable` and in the SAME direction, which `posting()` admits in
 * terms -- "`LEDGER-C1` refuses OPPOSITE signs and says nothing about two
 * debits ... which is what a fee and a principal against one treasury account
 * are" -- and they sum to `approved_cents` exactly, because `trader_cents +
 * firm_cents = approved_cents` is `INV-M5-03`.
 *
 * SO THE INVARIANT THE SHAPE DEPENDS ON IS ASSERTED HERE RATHER THAN ASSUMED.
 * `INV-M5-03` is enforced by a CHECK constraint on `payout_requests` and by the
 * engine's R-44, and neither of those runs between the engine returning a split
 * and this function turning it into two legs. If the two halves did not sum,
 * the total debit against the withdrawable position would silently stop being
 * `approved_cents` while every posting still balanced. That is the class of
 * error `LEDGER-C1` exists for, one level up, and it is checkable, so it is
 * checked.
 *
 * THE DEBIT IS `trader_withdrawable` AND NOT `firm_treasury`, and M05 says why
 * in terms: `firm_treasury` "books a cash movement at approval, which
 * contradicts the ruled recognition timing that payout liability books at
 * approval and cash derecognizes at settlement". That error has been made in
 * this repository once already.
 *
 * `firm_cents` IS RECOGNIZED AT APPROVAL and not held in suspense until
 * settlement, deliberately: "the firm's share is earned when the payout is
 * approved, and holding it in suspense until settlement would make the revenue
 * line depend on a payment rail's latency" (M05 section 2.1, ruled at the batch
 * 1 gate).
 *
 * THE ARGUMENT CENTS ARE `bigint` AND WERE `Cents` WHILE THIS LIVED IN
 * `apps/api` (ADR-317). `@merit/rules-engine` declares `type Cents = bigint`
 * (`packages/rules-engine/src/types.ts:38`), so the two spellings are the same
 * type; this package declares NO workspace dependency, deliberately, and the
 * alias is not reachable from here. `posting.ts` spells every amount `bigint`
 * for the same reason.
 */
export function lt01(args: {
  readonly identityId: string;
  readonly payoutRequestId: string;
  readonly idempotencyKey: string;
  readonly approvedCents: bigint;
  readonly traderCents: bigint;
  readonly firmCents: bigint;
}): Posting {
  if (args.traderCents + args.firmCents !== args.approvedCents) {
    throw new PayoutMoneyError(
      `INV-M5-03: trader_cents + firm_cents must equal approved_cents exactly, and ` +
        `${args.traderCents.toString()}c + ${args.firmCents.toString()}c is not ` +
        `${args.approvedCents.toString()}c. LT-01 debits the withdrawable position once per ` +
        'leg, so a split that does not sum would post a total debit that is not the amount ' +
        'approved, and every leg would still balance.',
    );
  }
  return posting(
    {
      kind: 'payout_approval',
      referenceKind: 'payout_request',
      referenceId: args.payoutRequestId,
      idempotencyKey: args.idempotencyKey,
    },
    [
      transfer(
        identityAccount('trader_withdrawable', args.identityId),
        identityAccount('trader_wallet', args.identityId),
        args.traderCents,
        'LT-01 payout approval: the trader half',
      ),
      transfer(
        identityAccount('trader_withdrawable', args.identityId),
        firmAccount('fees_revenue'),
        args.firmCents,
        'LT-01 payout approval: the firm share, recognized at approval',
      ),
    ],
  );
}
