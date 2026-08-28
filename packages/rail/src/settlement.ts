// =============================================================================
// packages/rail/src/settlement.ts
// =============================================================================
// M05 SECTION 3.1's `S-1` TO `S-7`, TRANSCRIBED, PLUS THE TWO THINGS `LT-07`
// TURNS OUT NOT TO HAVE.
//
// The step list is here rather than in a receiver because it is the SPECIFICATION
// of an ordering, and an ordering copied into each of the doors that reaches it
// is an ordering that drifts. `test/settlement-bind.test.ts` reads
// `docs/plans/M05-payout-system.md` AS TEXT and compares row by row, so this
// transcription cannot silently stop matching the document it transcribes.
//
// -----------------------------------------------------------------------------
// WHAT THE PORT OWNS IS S-1 AND HALF OF S-2, AND NOTHING ELSE, DELIBERATELY
// -----------------------------------------------------------------------------
// M05 section 3.1: "Settlement on the external leg is still the most
// consequential transition involving an outside party, so its steps are ordered
// and each is idempotent." Ordered and idempotent is a property of the RECEIVER
// running them in a transaction. This package reads no row and writes none, so
// it performs S-1, hands a receiver the two anchors S-2 needs, and stops.
//
// A PORT THAT PERFORMED S-3 THROUGH S-7 WOULD BE THE SECOND RULE `packages/psp`
// MADE STRUCTURAL, BROKEN: "nothing in the interface returns a decision. The
// adapter reports what the provider said. Whether that means an account gets
// created is Merit's logic, in one place." Whether a verified `transfer.settled`
// settles a payout is exactly such a decision, and it is one place: the receiver.
//
// -----------------------------------------------------------------------------
// THE STEP LIST NAMES `payout_requests` AND `ADR-019` MOVED THAT LEG INTERNAL.
// REPORTED, NOT RESOLVED
// -----------------------------------------------------------------------------
// S-4 sets `payout_requests.status = 'settled'` and S-5 calls `applySettlement`,
// which are the INTERNAL leg's effects under ADR-019: M05 section 3.1's own next
// paragraph says the internal leg's "approval, LT-01, the wallet credit, both
// anchor advances, the win-day reset, and `applySettlement` all commit in ONE
// database transaction ... `payout_requests.status` reaches `settled` and stops."
// The document keeps the seven steps "preserved as written because a webhook from
// a rail is exactly as untrustworthy as it always was", and the leg that reaches
// a rail today is `wallet_withdrawals`, whose settlement is `LT-07`.
//
// SO THE LIST IS TRANSCRIBED EXACTLY AS THE DOCUMENT WRITES IT and each step
// additionally carries which leg its effect belongs to, derived from the columns
// the step names rather than from a preference. NO STEP IS REWRITTEN, DROPPED OR
// RENUMBERED. Section 4 of this file's `LT_07_FINDINGS` is where the consequence
// lands.
// =============================================================================

import type { AcceptedTransfer, TransferLeg, VerifiedRailEvent } from './port.ts';

/** Who performs a step. The port performs exactly one of the seven. */
export type SettlementPerformer = 'port' | 'receiver';

/** One row of M05 section 3.1's table, plus what this package adds to it. */
export interface SettlementStep {
  /** `S-1` through `S-7`, as the document numbers them. */
  readonly id: `S-${1 | 2 | 3 | 4 | 5 | 6 | 7}`;
  /** The document's Action cell, verbatim. */
  readonly action: string;
  /** The document's "Idempotency anchor" cell, verbatim. */
  readonly anchor: string;
  /** Who runs it. Added here; not in the document. */
  readonly performedBy: SettlementPerformer;
  /**
   * Which leg the step's effect belongs to, or `null` where the step is about
   * the delivery rather than about either leg's state.
   *
   * DERIVED FROM THE COLUMNS THE STEP NAMES AND NOT CHOSEN. S-4 names
   * `payout_requests.status`; S-5 names `INV-M5-07`'s `payout_request_id`; S-7
   * names `SD-M5-04`'s `balance_reflection_status`, which is a `payout_requests`
   * column. S-1 and S-2 are about the delivery and the transfer.
   */
  readonly leg: TransferLeg | null;
}

/**
 * The seven steps, in order, exactly as M05 section 3.1 writes them.
 *
 * `as const` AND A TUPLE, so the ORDER is part of the type and a reordering is a
 * compile-time change rather than a silent one. The order is the specification:
 * S-1 is "rejected before any state is touched", and a list whose first element
 * were anything else would be a list that had already lost its point.
 */
export const SETTLEMENT_STEPS = [
  {
    id: 'S-1',
    action: 'Verify webhook signature, timestamp, and nonce; reject outside the replay window',
    anchor: 'rejected before any state is touched',
    performedBy: 'port',
    leg: null,
  },
  {
    id: 'S-2',
    action:
      'Resolve the transfer by `provider_transfer_id`; if already `settled`, return 200 and stop',
    anchor: 'unique `provider_transfer_id`',
    performedBy: 'receiver',
    leg: null,
  },
  {
    id: 'S-3',
    action: 'Post LT-02',
    anchor: 'unique `ledger_transactions.idempotency_key`',
    performedBy: 'receiver',
    leg: 'payout_request',
  },
  {
    id: 'S-4',
    action: "Set `payout_requests.status = 'settled'`, `settled_at`, `settled_trading_day`",
    anchor: 'status transition guard',
    performedBy: 'receiver',
    leg: 'payout_request',
  },
  {
    id: 'S-5',
    action: "Call M1's `applySettlement` with `basis_trading_day` and `effective_trading_day`",
    anchor: 'unique on `payout_request_id` (INV-M5-07)',
    performedBy: 'receiver',
    leg: 'payout_request',
  },
  {
    id: 'S-6',
    action: 'Emit `payout.settled`, `payout.win_days_reset`',
    anchor: 'event dedupe by `(name, reference_id)`',
    performedBy: 'receiver',
    leg: 'payout_request',
  },
  {
    id: 'S-7',
    action: "Mark `balance_reflection_status = 'pending'` and start the observation window",
    anchor: 'SD-M5-04',
    performedBy: 'receiver',
    leg: 'payout_request',
  },
] as const satisfies readonly SettlementStep[];

/** The one step this package performs. Named, so the claim is checkable. */
export const PORT_PERFORMED_STEPS: readonly string[] = SETTLEMENT_STEPS.filter(
  (step) => step.performedBy === 'port',
).map((step) => step.id);

// -----------------------------------------------------------------------------
// What the port hands a receiver, which is S-2's input and nothing more
// -----------------------------------------------------------------------------

/**
 * The facts a receiver needs to run S-2, and the field this type does NOT carry
 * is the one section 4 is about.
 *
 * THERE IS NO LEDGER IDEMPOTENCY KEY HERE. See {@link LT_07_FINDINGS} finding B.
 */
export interface SettlementAnchors {
  /** API_CONTRACT section 10's anchor, first half. */
  readonly providerTransferId: string;
  /** Its second half. */
  readonly providerEventId: string;
  /** The rail's own word for what happened. Never Merit's disposition. */
  readonly eventType: string;
  /**
   * The approval key the transfer was enqueued under, echoed back through
   * {@link AcceptedTransfer}. `INV-M5-06`'s key, identical on every attempt.
   */
  readonly approvalIdempotencyKey: string;
  /** Which leg is settling. */
  readonly leg: TransferLeg;
}

/**
 * Read S-2's anchors off a verified delivery and the acceptance it answers.
 *
 * IT REFUSES A MISMATCH RATHER THAN PREFERRING ONE SIDE. The delivery names a
 * `provider_transfer_id` and the acceptance named one; if they disagree, the
 * receiver has been handed two different transfers and picking either is picking
 * one at random on the money path.
 *
 * @throws {SettlementAnchorError} when the two sides name different transfers.
 */
export function settlementAnchorsOf(
  event: VerifiedRailEvent,
  accepted: AcceptedTransfer,
  leg: TransferLeg,
): SettlementAnchors {
  if (event.providerTransferId !== accepted.providerTransferId) {
    throw new SettlementAnchorError(
      `the delivery names transfer ${JSON.stringify(event.providerTransferId)} and the ` +
        `acceptance named ${JSON.stringify(accepted.providerTransferId)}. S-2 resolves the ` +
        'transfer by provider_transfer_id, and two different ones is not a resolution.',
    );
  }
  if (event.provider !== accepted.provider) {
    throw new SettlementAnchorError(
      `the delivery is ${event.provider}'s and the acceptance is ${accepted.provider}'s. ` +
        'payout_transfers_provider_transfer_uq is unique on (provider, provider_transfer_id), ' +
        'so the pair is the address and half of it is not.',
    );
  }
  return {
    providerTransferId: event.providerTransferId,
    providerEventId: event.providerEventId,
    eventType: event.eventType,
    approvalIdempotencyKey: accepted.idempotencyKey,
    leg,
  };
}

/** A delivery and an acceptance that do not name the same transfer. */
export class SettlementAnchorError extends Error {
  constructor(detail: string) {
    super(`rail settlement: ${detail}`);
    this.name = 'SettlementAnchorError';
  }
}

// -----------------------------------------------------------------------------
// Section 4. WHY THIS FILE MINTS NO `LT-07`, IN THREE FINDINGS
// -----------------------------------------------------------------------------

/**
 * THE THREE THINGS THAT MAKE `LT-07` UNWRITABLE IN THIS TREE TODAY.
 *
 * P5 section 8 puts `LT-07` inside this slice and this slice does not have an
 * ADR number, so each of these is REPORTED with the primary source that says it
 * rather than resolved by picking. `test/lt-07.test.ts` asserts all three by
 * reading those sources, so none of them is a comment that can go stale
 * quietly: the day any of them is fixed, this package goes red.
 *
 * Each entry is `{id, claim, sources}`, and the sources are paths a second
 * reader can open.
 */
export const LT_07_FINDINGS = [
  {
    id: 'A',
    claim:
      "LT-07's credit leg names an account class that does not exist. M05 section 2.1 writes " +
      'LT-07 as `debit firm_treasury; credit the payout wallet position`, and ' +
      '`ledger_accounts_code_is_declared` in 0009_ledger.sql declares seven codes, none of ' +
      'which is a pooled payout wallet position. SD-M5-07 is why: LT-01 "previously credited ' +
      "the payout wallet position as a firm obligation to pay; it now credits the identity's " +
      'trader_wallet", and the pooled class went away with it. trader_wallet is NOT the ' +
      'substitution, because ADR-124 records LT-02 and LT-07 as the FIRM-ONLY postings a ' +
      'global halt must refuse, and trader_wallet is identity scoped.',
    sources: [
      'docs/plans/M05-payout-system.md',
      'packages/db/migrations/0009_ledger.sql',
      'docs/decisions/ADR-124.md',
    ],
  },
  {
    id: 'B',
    claim:
      "LT-07's ledger idempotency key has two recorded conventions in this tree and they point " +
      'opposite ways. LT-01 is posted under `${PAYOUT_ENDPOINT} ${idempotencyKey}` by three ' +
      "doors that build the identical string. LT-06's key is recorded as the withdrawal's OWN " +
      'stored key and explicitly "NOT one naming this endpoint, because the approval edge is ' +
      'reachable from a sweep and an operator console as well as from here". Neither ' +
      'generalises: bare is the string LT-06 already claims for the same withdrawal, and ' +
      'ledger_transactions.idempotency_key is text NOT NULL UNIQUE, so the second posting is ' +
      'refused by the database; endpoint-prefixed reintroduces exactly what LT-06 refused.',
    sources: [
      'apps/api/src/routes/payouts.ts',
      'apps/api/src/routes/admin-payouts.ts',
      'apps/worker/src/sweeps/expiry.ts',
      'apps/api/src/routes/wallet-withdrawals.ts',
    ],
  },
  {
    id: 'C',
    claim:
      'No file in this tree says whether firm_treasury is an asset or a liability, so a ' +
      'receiver cannot derive which direction LT-07 moves it. ledger_accounts.kind is ' +
      "CHECK (kind IN ('asset','liability','revenue','expense','equity')) and nothing seeds a " +
      'row for firm_treasury: the only INSERT into ledger_accounts anywhere is ' +
      'scripts/db/probe_ledger_constraints.sql, which seeds trader_withdrawable, trader_wallet ' +
      'and fees_revenue and not this one. This is reported as an ABSENCE and no direction is ' +
      'inferred from it here.',
    sources: ['packages/db/migrations/0009_ledger.sql', 'scripts/db/probe_ledger_constraints.sql'],
  },
] as const;
