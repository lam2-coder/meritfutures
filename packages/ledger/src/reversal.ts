// =============================================================================
// packages/ledger/src/reversal.ts
// =============================================================================
// `SD-M5-05` AS CODE, AND THE NINTH LEDGER TRANSACTION BUILT OUT OF IT.
//
// "Corrections are compensating entries, never updates. Without a link, a
// reversal is a transaction that happens to be equal and opposite, and
// reconstructing which reversal answered which original becomes archaeology at
// exactly the moment (a chargeback dispute, an audit) when it must be instant."
// That is `SD-M5-05` and `0009:89-97` carries it as a nullable self-FK. This
// file is the other half: the part that makes a reversal EXACT rather than
// merely equal and opposite in the writer's intention.
//
// -----------------------------------------------------------------------------
// THE NEGATION IS STRUCTURAL, WHICH IS `posting.ts`'s OWN CLAIM ONE LEVEL UP
// -----------------------------------------------------------------------------
// `posting.ts` makes an unbalanced posting unrepresentable by never letting a
// caller construct one leg: a `Transfer` yields `+a` against the debit and `-a`
// against the credit and nothing else emits an entry at all. `reversalPosting`
// leans on exactly that. It does not negate amounts, does not read
// `entriesOf`, and does not build a leg. It SWAPS each transfer's two sides and
// keeps its amount, and the negation follows from the same arithmetic that makes
// the original balance.
//
// SO A PARTIAL REVERSAL IS NOT REFUSED HERE, IT IS UNAVAILABLE. There is no
// parameter for an amount, so `reversalPosting` cannot express "reverse 20,000
// of the 50,000". `0038`'s `assert_adjustment_reversal_is_sound` check 5 rules
// what that case is instead -- "a reversal is exact; a partial correction is a
// full reversal plus a new credit" -- and this shape is that ruling expressed as
// a missing argument rather than as a thrown error.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE CANNOT PROVE, STATED HERE BECAUSE IT IS WHY `0057` AND `0059`
// EXIST
// -----------------------------------------------------------------------------
// It can prove the reversal is exact, because the shape leaves no way to build
// an inexact one. It CANNOT prove that a withdrawal which reached `failed` was
// ever handed to it, and it cannot prove the reversal was built once rather than
// twice. Both are facts about rows, and the only thing in this estate that sees
// rows is the database: `WD-C1` in `0057` is the first and
// `ledger_transactions_reversal_of_idx`, made UNIQUE by the same migration, is
// the second. ADR-189 section 4 is the argument that neither half is sufficient
// alone, and this comment exists so that a later reader who deletes the
// migration's trigger knows what it was carrying that this file is not.
//
// THE THIRD IS `LEDGER-C3` IN `0059`, AND IT IS THE ONE THIS FILE IS NOT MERELY
// INSUFFICIENT FOR BUT INCAPABLE OF. `0009:103-104` says a reversal "may not
// chain onto another reversal" and its row-local CHECK could only ever say
// `reversal_of <> id`. `ReversalHeader.reversalOf` below is a string: whether it
// names a row that is ITSELF a reversal is a fact about a row, this library
// opens no database transaction and cannot, and a guard written here would
// either refuse nothing or lie. ADR-193 rules that the trigger is the whole of
// the control, and DELIBERATELY ADDS NOTHING HERE: `posting()` accepts
// `reversalOf` on its header directly, so a rule enforced in `reversalPosting`
// is bypassed by the public constructor one file over without a cast and
// without a lint.
//
// WHAT `0059` DOES NOT REFUSE IS THE OPERATION. A reversal of a reversal is a
// re-application, it is legitimate, and `0009:104` states its shape in the same
// sentence as the prohibition: a new transaction with its own kind, its own
// idempotency key and its own reason, and not this builder's output wearing
// `reversal_of`.
//
// -----------------------------------------------------------------------------
// WHY `LT-09` IS BUILT HERE AND NOT IN `packages/rail`
// -----------------------------------------------------------------------------
// `packages/rail` is the external leg's package and rail exhaustion is its
// event, so it is the first place to look. It declares NO workspace dependency,
// and that absence is stated as the design in three places -- its manifest's
// `//` key, `src/index.ts`'s header, and `RI-08`'s admitted list -- so importing
// `@merit/ledger` there would break a property this estate asserts rather than
// merely holds.
//
// THE SECOND REASON IS THE BETTER ONE AND IT WOULD STAND WITHOUT THE FIRST. What
// `LT-09` IS, is the reversal of `LT-06`. `reversal_of`, exactness, and the two
// account codes are ledger facts and not rail facts, and the rail's contribution
// is one boolean: the retry budget is spent. The posting belongs where the chart
// of accounts is.

import { firmAccount, identityAccount, type IdentityId } from './accounts.ts';
import { posting, transfer, type Posting } from './posting.ts';

/**
 * `reference_kind` for every posting about a wallet withdrawal.
 *
 * ADR-189 clause 4 rules it, and it is the convention already in force rather
 * than a new one: `payouts.ts` posts `LT-01` under `'payout_request'` and
 * `checkout.ts` posts under `'purchase'`, each the singular of the table the
 * posting is about.
 *
 * IT IS EXPORTED BECAUSE `0057` DEPENDS ON IT AND CANNOT SEE IT.
 * `ledger_entries` carries no withdrawal foreign key, so `(reference_kind,
 * reference_id)` is the whole of the edge from a withdrawal to its postings, and
 * `WD-C1` joins on this exact literal. A posting written under a different
 * tuple is invisible to that trigger. One constant, one file, and
 * `ninth-transaction.test.ts` holds it against the migration's text.
 */
export const WALLET_WITHDRAWAL_REFERENCE_KIND = 'wallet_withdrawal';

/** `LT-06`. M05 section 2.1: the external leg's approval. */
export const WALLET_WITHDRAWAL_APPROVAL_KIND = 'wallet_withdrawal_approval';

/**
 * `LT-09`. M05 section 2.1: the external leg's failure, ruled by ADR-189.
 *
 * NAMED FOR THE TRANSITION AND NOT FOR THE MECHANISM, which is what the other
 * two postings on this leg do: `LT-06` is `_approval` and `LT-07` is
 * `_settlement`, each named for the state change it accompanies, and this one
 * accompanies `transferring --> failed`. `wallet_withdrawal_reversal` was the
 * available alternative and is refused because `reversal_of` on the row already
 * carries the mechanism, and a `kind` spelling it would state one fact twice.
 */
export const WALLET_WITHDRAWAL_FAILURE_KIND = 'wallet_withdrawal_failure';

/** The header fields a reversal supplies that its original cannot. */
export interface ReversalHeader {
  /** The reversing transaction's own `kind`. Never the original's. */
  readonly kind: string;
  /** `ledger_transactions.idempotency_key`, globally UNIQUE, so never the original's. */
  readonly idempotencyKey: string;
  /** `ledger_transactions.id` of the transaction being reversed. `SD-M5-05`'s link. */
  readonly reversalOf: string;
}

/**
 * The exact negation of a posting, linked to it.
 *
 * THE ONE THING IT DOES IS SWAP EACH TRANSFER'S TWO SIDES. Amounts are carried
 * across untouched and no leg is constructed, so every property `posting.ts`
 * guarantees about the original holds about this: it balances, it is
 * `LEDGER-C1` clean if the original was, and its entries are `entriesOf(original)`
 * with every sign inverted.
 *
 * THE REFERENCE IS THE ORIGINAL'S AND THAT IS DELIBERATE. A reversal is about
 * the same withdrawal, payout or purchase as the transaction it answers, and
 * `WD-C1` reads exactly that: it sums the obligation over every transaction
 * naming one withdrawal, which only works if the reversal names it too. What
 * does NOT carry across is the `idempotency_key`, because the column is globally
 * unique and a reversal is a second event.
 *
 * @throws {Error} when `reversalOf` is empty, or names the posting's own key,
 *   or when the header is otherwise unbuildable. `posting()` performs those
 *   refusals and this function does not restate them.
 */
export function reversalPosting(original: Posting, header: ReversalHeader): Posting {
  if (header.idempotencyKey === original.header.idempotencyKey) {
    throw new Error(
      `this reversal claims ${JSON.stringify(header.idempotencyKey)}, which is the key of the ` +
        'transaction it reverses. `ledger_transactions.idempotency_key` is text NOT NULL ' +
        'UNIQUE globally (0009), so the database would refuse the second row: a reversal is a ' +
        'second EVENT and it names itself, never the event it answers (ADR-175 clause 1).',
    );
  }

  const [first, ...rest] = original.transfers.map((t) =>
    transfer(t.credit, t.debit, t.amountCents, t.memo ?? undefined),
  );

  // UNREACHABLE THROUGH `posting()`, WHICH REFUSES AN EMPTY TRANSFER LIST, and
  // kept for `assertBalanced`'s own stated reason: `Posting` is a branded
  // interface and a brand is a cast somebody can write. It is also what makes
  // the argument below a `NonEmptyTransfers` without one.
  if (first === undefined) {
    throw new Error(
      'a posting with no transfers reached reversalPosting. `posting()` refuses that shape, ' +
        'so this one was assembled past its brand by a cast, and reversing nothing would ' +
        'write a `ledger_transactions` row the zero-sum trigger never fires for.',
    );
  }

  return posting(
    {
      kind: header.kind,
      referenceKind: original.header.referenceKind,
      referenceId: original.header.referenceId,
      idempotencyKey: header.idempotencyKey,
      reversalOf: header.reversalOf,
    },
    [first, ...rest],
  );
}

/** What `LT-06` and `LT-09` are both built from. One withdrawal, in cents. */
export interface WalletWithdrawalFacts {
  /** `wallet_withdrawals.id`. The `reference_id` of every posting about it. */
  readonly withdrawalId: string;
  /** `wallet_withdrawals.identity_id`. Whose `trader_wallet` position moves. */
  readonly identityId: IdentityId;
  /** `wallet_withdrawals.amount_cents`. POSITIVE integer cents; the sign is `posting.ts`'s. */
  readonly amountCents: bigint;
  /**
   * `wallet_withdrawals.idempotency_key`, the row's OWN stored key.
   *
   * `LT-06` posts under it bare, which `wallet-withdrawals.ts` states in its own
   * words: not one naming an endpoint, because the approval edge is reachable
   * from a sweep and an operator console as well as from a route.
   */
  readonly withdrawalIdempotencyKey: string;
}

/**
 * `LT-06`, the external leg's approval. EXPORTED, and `LT-09` is still built on it.
 *
 * M05 section 2.1 rules it: debit the identity's `trader_wallet` by
 * `amount_cents`, credit `withdrawals_in_flight`. ADR-181 derived the credit
 * slot's class and scope and ADR-187 minted its code; `0056` seeded the row so
 * that `chart.ts`'s `resolve` finds it.
 *
 * IT WAS PRIVATE BECAUSE THE SESSION THAT WROTE THIS FILE (ADR-189, 2026-08-28)
 * DID NOT RULE `LT-06`'s WRITER. ADR-270 CLAUSE 2 RULED IT ON 2026-08-30: a
 * transaction a clock opens, at `systemDb('nightly-batch')` in `apps/worker`.
 * ADR-314 opens the door on that discharge and on nothing else. THE ARITHMETIC IS
 * STILL STATED ONCE: `walletWithdrawalFailurePosting` below composes this builder
 * through `reversalPosting`, so `LT-06` and `LT-09` cannot disagree, and a second
 * builder beside this one is ADR-092 section 5's two-statements-of-one-fact hazard
 * arriving on the money path. NOTHING IN THIS TREE POSTS IT YET.
 */
export function walletWithdrawalApprovalPosting(facts: WalletWithdrawalFacts): Posting {
  return posting(
    {
      kind: WALLET_WITHDRAWAL_APPROVAL_KIND,
      referenceKind: WALLET_WITHDRAWAL_REFERENCE_KIND,
      referenceId: facts.withdrawalId,
      idempotencyKey: facts.withdrawalIdempotencyKey,
    },
    [
      transfer(
        identityAccount('trader_wallet', facts.identityId),
        firmAccount('withdrawals_in_flight'),
        facts.amountCents,
        'LT-06 wallet withdrawal approval: the claim becomes an obligation',
      ),
    ],
  );
}

/**
 * `LT-09`, the ninth ledger transaction. What posts when the rail is exhausted.
 *
 * ADR-189. `STATE_MACHINES` section 3.2 draws `transferring --> failed:
 * G-TRANSFER-EXHAUSTED` and M05 section 2.1 declared eight transactions, none of
 * which was a wallet withdrawal that failed on the rail. `LT-06` posted, so the
 * trader's wallet claim is extinguished; `LT-07` never posts, so no cash leaves;
 * `withdrawals_in_flight` carries a credit balance against a withdrawal that
 * will never settle. This is what returns it to zero and gives the trader their
 * claim back.
 *
 * IT IS A COMPENSATING ENTRY AND NEVER AN UPDATE. `LT-06` is not deleted, not
 * amended and no balance is adjusted in place. `SD-M5-05` is the ruling and
 * `reversalOf` is its link.
 *
 * POST IT IN THE SAME DATABASE TRANSACTION AS THE TRANSITION TO `failed`.
 * `WD-C1` in `0057` is `DEFERRABLE INITIALLY DEFERRED` precisely so that both
 * can live in one, and a handler that transitions the row in one transaction and
 * posts in a second is refused by the first COMMIT. That is ADR-006's
 * consequence relied on rather than restated.
 *
 * @param approvalTransactionId `ledger_transactions.id` of the `LT-06` this
 *   reverses. The caller reads it; this library opens no transaction and cannot.
 */
export function walletWithdrawalFailurePosting(
  facts: WalletWithdrawalFacts,
  approvalTransactionId: string,
): Posting {
  return reversalPosting(walletWithdrawalApprovalPosting(facts), {
    kind: WALLET_WITHDRAWAL_FAILURE_KIND,
    idempotencyKey: walletWithdrawalFailureKey(facts.withdrawalIdempotencyKey),
    reversalOf: approvalTransactionId,
  });
}

/**
 * `LT-09`'s `ledger_transactions.idempotency_key`.
 *
 * ADR-175 clause 1 is the rule -- a key names the EVENT it posts and never the
 * DOOR that reached it -- and clause 3 is the spelling, `${kind} ${the
 * withdrawal's stored key}`, ruled there for `LT-07` and taken here for the same
 * reason it was taken there. `LT-06` already claims the bare key under a
 * globally unique column, so bare is unavailable; an endpoint prefix is the
 * thing `LT-06` refused. ADR-189 clause 5 extends clause 3 to this posting and
 * says so rather than treating it as covered.
 *
 * A REPLAYED FAILURE IS THEREFORE REFUSED BY THE DATABASE rather than by a
 * handler, which is what the column is for.
 */
export function walletWithdrawalFailureKey(withdrawalIdempotencyKey: string): string {
  return `${WALLET_WITHDRAWAL_FAILURE_KIND} ${withdrawalIdempotencyKey}`;
}
