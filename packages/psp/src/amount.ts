// =============================================================================
// packages/psp/src/amount.ts
// =============================================================================
// M03 SECTION 2.1's THIRD RULE, AND THE PROBLEM IT LEAVES BEHIND.
//
//   "No adapter method takes a price. `PurchaseIntent` carries a `purchase_id`;
//    the amount is read from the purchase row the server wrote. This makes
//    INV-M3-02 structural rather than a review item."
//
// A payment processor is handed a number. It cannot be otherwise: the session
// the buyer is redirected into shows an amount. So the rule cannot be honoured
// by leaving the amount out of the intent, and the reading where the adapter
// itself reads the purchase row is worse than the disease -- it would put a
// database dependency and a money read inside the package whose entire job is
// to isolate a vendor.
//
// WHAT IS HONOURED INSTEAD IS THE RULE'S REASON. INV-M3-02 is that price,
// discount and cap eligibility are computed SERVER SIDE from
// `plan_version_sizes`, "never from the request", and its stated enforcement is
// that "the Zod schema has no price field at all. THE ABSENCE IS THE CONTROL
// (Appendix E's Enrichlead lesson)." The failure it names is a number that
// travelled from a request body to a processor. So the type of the amount says
// where it came from, and there is exactly one function in this workspace that
// can produce that type, and it takes a purchase ROW.
//
// -----------------------------------------------------------------------------
// THE SECOND FINDING, WHICH IS ARITHMETIC AND NOT PHILOSOPHY
// -----------------------------------------------------------------------------
// THE AMOUNT THE CARD IS CHARGED IS NOT `amount_paid_cents`.
//
// `0006_commerce.sql:189`'s `purchases_wallet_leg_matches_method` reads,
// verbatim, and the constraint's NAME was checked against the file rather than
// remembered: the first draft of this comment called it
// `purchases_wallet_debit_bounds`, which is not a constraint in this schema.
//
//     (payment_method = 'psp'    AND wallet_debit_cents = 0)
//     OR
//     (payment_method = 'wallet' AND wallet_debit_cents = amount_paid_cents
//                                AND amount_paid_cents > 0)
//     OR
//     (payment_method = 'mixed'  AND wallet_debit_cents > 0
//                                AND wallet_debit_cents < amount_paid_cents)
//
// ADR-019 admitted `mixed` because "a trader with $60 in the wallet buying a
// $99 evaluation is the common case, not an edge one" (SD-M3-06). On that row
// `amount_paid_cents` is 9900 and the card leg is 3900, and a port that took a
// plain `amountCents` would have let the commonest wallet case charge the card
// the whole 9900 with every type in the workspace green. The subtraction lives
// here, once, rather than at each of the call sites session 220 and the dispute
// path will write.
//
// MONEY IS INTEGER CENTS AND THE TYPE IS `bigint`, matching the `bigint`
// columns in the DDL. There is no float anywhere on this path and no `number`
// that holds money.
// =============================================================================

import type { CardAmountCents } from './port.ts';

/**
 * The columns of `purchases` this computation reads, and no others.
 *
 * It is a structural type rather than an import from `@merit/db` on purpose:
 * this package declares no workspace dependency, and a row shape narrow enough
 * to write out is a row shape a reader can check against the DDL without
 * leaving the file. `0006_commerce.sql`:
 *
 *   payment_method     text NOT NULL CHECK (payment_method IN ('psp','wallet','mixed'))
 *   amount_paid_cents  bigint NOT NULL CHECK (amount_paid_cents >= 0)
 *   wallet_debit_cents bigint NOT NULL DEFAULT 0 CHECK (wallet_debit_cents >= 0)
 */
export interface PurchaseRowMoney {
  readonly paymentMethod: 'psp' | 'wallet' | 'mixed';
  readonly amountPaidCents: bigint;
  readonly walletDebitCents: bigint;
}

/** Why a row has no card leg to charge. Closed, and each member is a refusal. */
export type CardLegRefusal =
  | 'wallet_funded_purchase_has_no_card_leg'
  | 'row_violates_wallet_leg_bounds'
  | 'amount_is_not_integer_cents';

/**
 * The refusal. It is an error rather than a `null` for M03's own reason about
 * `verifyWebhook`: a returned absence gets ignored, and this one is on the
 * money path.
 */
export class CardLegError extends Error {
  readonly refusal: CardLegRefusal;

  constructor(refusal: CardLegRefusal, detail: string) {
    super(`no card leg: ${refusal} (${detail})`);
    this.name = 'CardLegError';
    this.refusal = refusal;
  }
}

/**
 * THE ONLY PRODUCER OF A `CardAmountCents` IN THIS WORKSPACE.
 *
 * Hand it the purchase row Merit wrote and it returns the card leg. There is no
 * cast, no constructor and no second door: `CardAmountCents` is a branded
 * `bigint` whose brand is declared in `port.ts` and never assigned anywhere but
 * the one line below, so a number from a request body cannot be spelled where a
 * `PurchaseIntent` wants one without a deliberate `as` a reviewer can grep for.
 *
 * IT REFUSES A WALLET-FUNDED ROW RATHER THAN RETURNING ZERO, and that refusal
 * is INV-M3-13 kept rather than a new rule: a wallet purchase "debits the
 * wallet IN THE SAME TRANSACTION that creates the purchase", which "makes the
 * entire PSP webhook machinery INAPPLICABLE to this path rather than merely
 * unused". A zero-amount session at a processor is the shape that path must not
 * be able to reach, so it is an error and not a value.
 *
 * IT ALSO RE-CHECKS THE DDL's OWN BOUNDS, and that is not distrust of Postgres.
 * A row can reach this function from a fixture, from a test, or from a service
 * that built it in memory before it was ever written, and every one of those is
 * a path the CHECK constraint never saw.
 */
export function cardLegOf(row: PurchaseRowMoney): CardAmountCents {
  const { paymentMethod, amountPaidCents, walletDebitCents } = row;

  if (typeof amountPaidCents !== 'bigint' || typeof walletDebitCents !== 'bigint') {
    throw new CardLegError(
      'amount_is_not_integer_cents',
      'money on this path is bigint cents and nothing else',
    );
  }
  if (amountPaidCents < 0n || walletDebitCents < 0n) {
    throw new CardLegError(
      'row_violates_wallet_leg_bounds',
      `amount_paid_cents=${amountPaidCents} wallet_debit_cents=${walletDebitCents}, both are CHECKed >= 0`,
    );
  }

  // The three branches are `purchases_wallet_leg_matches_method`, in its own order.
  if (paymentMethod === 'psp') {
    if (walletDebitCents !== 0n) {
      throw new CardLegError(
        'row_violates_wallet_leg_bounds',
        `payment_method='psp' requires wallet_debit_cents = 0, got ${walletDebitCents}`,
      );
    }
    return amountPaidCents as CardAmountCents;
  }

  if (paymentMethod === 'wallet') {
    if (walletDebitCents !== amountPaidCents || amountPaidCents <= 0n) {
      throw new CardLegError(
        'row_violates_wallet_leg_bounds',
        `payment_method='wallet' requires wallet_debit_cents = amount_paid_cents > 0, got ${walletDebitCents} against ${amountPaidCents}`,
      );
    }
    throw new CardLegError(
      'wallet_funded_purchase_has_no_card_leg',
      'INV-M3-13: a wallet purchase commits with its debit and reaches no processor',
    );
  }

  if (walletDebitCents <= 0n || walletDebitCents >= amountPaidCents) {
    throw new CardLegError(
      'row_violates_wallet_leg_bounds',
      `payment_method='mixed' requires 0 < wallet_debit_cents < amount_paid_cents, got ${walletDebitCents} against ${amountPaidCents}`,
    );
  }
  return (amountPaidCents - walletDebitCents) as CardAmountCents;
}
