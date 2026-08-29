// =============================================================================
// apps/portal/src/view/wallet.ts
// =============================================================================
// SC-M4-10's VIEW MODEL. M04 section 3.5, and it is the screen whose copy rule
// is stricter than its data rule.
//
// -----------------------------------------------------------------------------
// THE THREE FIGURES ARE READ AND NONE OF THEM IS COMPUTED
// -----------------------------------------------------------------------------
// API_CONTRACT section 6.2 states the identity explicitly: "`balance_cents`
// equals `withdrawable_cents + held_cents` and the sum is stated rather than
// left to a client, because the two components are computed from different
// inputs and a client that derived one by subtraction would render a stale
// figure whenever the other moved."
//
// So this file performs no addition and no subtraction on a `_cents` field. It
// formats three server numbers through ../format/money.ts and stores the
// strings, which is the idiom every other view model here uses and the reason
// INV-M4-01 survives a reviewer not noticing a `+`.
//
// -----------------------------------------------------------------------------
// INV-M20-08, AND IT IS THE ONE THING THIS SCREEN COULD GET WRONG SILENTLY
// -----------------------------------------------------------------------------
// `M20:64`: wallet balances are "segregated in reporting and in fact, and the
// float is never treated as working capital".
//
// THE FLOAT AND THE BALANCE ARE DIFFERENT QUANTITIES AND ONLY ONE OF THEM
// BELONGS ON A TRADER'S SCREEN. The float is the FIRM's aggregate -- every
// identity's wallet balance summed -- and `M20:424` puts it on M06's liability
// dashboard beside reserve, "with the RCR computed from reserve alone".
// `apps/admin/src/liability.ts` is where it renders and `P-M6-07` is its panel.
// What renders here is ONE identity's own balance, read from that identity's
// own scoped `GET /wallet`.
//
// THE MECHANICAL CONSEQUENCE IS THAT THERE IS NO AGGREGATE ANYWHERE IN THIS
// FILE. No sum across identities, no total, no count of anything but this
// trader's own entries, and no field named for the float. A screen with no
// aggregate cannot render one where the balance belongs.
//
// -----------------------------------------------------------------------------
// THE COPY IS NOT THIS FILE'S TO WRITE, AND THAT IS THE HARD PART OF SC-M4-10
// -----------------------------------------------------------------------------
// M04 section 3.5 requires the screen to say four things about the withdraw
// exit -- "KYC, the 48 hour destination-cooling window, a $100 minimum, and 2 to
// 3 business days" -- and to state "No withdrawal fee ... rather than merely
// absent". It then rules the wording: "The wording is a `copy_blocks` entry
// (INV-M4-08) and a counsel-review item."
//
// EVERY ONE OF THOSE IS A PARAMETER, AND THIS APPLICATION MAY NOT STATE ONE.
// `M20:30` carries the numbers (`$100 minimum`, `48h destination cooling`) and
// they are plan and policy parameters, which `apps/api/src/auth-backend.ts`
// states the rule for one deployable over: "no plan parameter is stated in
// application code". INV-M4-08 says the same thing about the sentence around
// them: "No rule text is authored in the portal."
//
// SO THE SENTENCES ARE A SLOT AND THE SLOT IS EMPTY TODAY, WHICH IS MEASURED.
// ../copy/copy-block.ts's `CopyBlock` is a branded string, so the only
// expression in this codebase whose type is `CopyBlock` is a call to
// `copyBlock()` over a published plan version: a literal cannot be assigned to
// one of these fields and the file would not compile. `GET /wallet` carries no
// copy field, and `copy_blocks` is a column on `plan_versions` while a wallet is
// per-identity and has no pinned plan version at all, so there is no row for the
// wallet's sentences to live on. That is reported rather than worked around, and
// this build renders the absence.
//
// THE POPULATED BRANCH IS REAL AND THE SUITE EXERCISES IT. `toWalletView` takes
// the copy as a parameter, so `test/wallet.test.ts` renders the same tree with
// sentences built through `copyBlock()` over a `PinnedPlanCopy` fixture. Both
// branches render; only one of them can be reached from a browser right now,
// which is ./payouts' `readyFrom` argument applied to a sentence.
//
// -----------------------------------------------------------------------------
// AND THE ONE THING M04 SAYS THE SCREEN MUST NOT DO
// -----------------------------------------------------------------------------
// Section 3.5: "It must not present the wallet balance as a score, a streak, or
// a level. That is ADR-019a's bright line arriving in the one place it is most
// tempting to cross."
//
// THERE IS NOTHING IN THIS VIEW MODEL A GAME COULD BE BUILT FROM. No rank, no
// tier of attainment, no progress toward a next threshold, no personal best, no
// streak, no comparison to any other trader or to this trader's own past. The
// figures are three amounts and a timestamp, and `test/wallet.test.ts` asserts
// the absence by name so the next field cannot arrive quietly.

import type { WalletEntry, WalletHold, WalletProvenance, WalletResponse } from '../api/types.ts';
import type { CopyBlock } from '../copy/copy-block.ts';
import { formatCents } from '../format/money.ts';
import type { Tiered } from './as-of.ts';

// -----------------------------------------------------------------------------
// 1. The balance, and its two components
// -----------------------------------------------------------------------------

/** One hold, formatted. The rule token is the server's and is not translated. */
export type WalletHoldView = {
  readonly rule: WalletHold['rule'];
  readonly amount: string;
  readonly since: string;

  /**
   * NULL IS THE HONEST ANSWER TODAY AND IT RENDERS AS ONE.
   *
   * API_CONTRACT section 6.2: no landed column carries the card networks'
   * dispute window for a purchase, and "a date computed by adding a chosen
   * number of days to `earliest_credit_at` would be a number this repository
   * invented". So the field is carried through as `null` and the screen says
   * the date is not reported rather than showing a date nobody computed.
   */
  readonly available_at: string | null;
};

/**
 * The balance panel.
 *
 * `Tiered` IS REQUIRED AND THE VALUE IS `authoritative`. INV-M4-11 makes the
 * tier a required prop rather than a footnote, and a wallet balance is as
 * authoritative as a number gets in this product: `M20`'s wallet is money
 * "already earned, already through every gate, owed unconditionally". There is
 * no indicative wallet figure and there is no socket that could produce one.
 */
export type WalletBalanceView = Tiered & {
  /** The whole balance. The sum the server stated, never one this file added. */
  readonly balance: string;

  /** What could leave as cash today, on the server's own arithmetic. */
  readonly withdrawable: string;

  /** What is held, and `holds` is why. Empty when this is `0.00`. */
  readonly held: string;
  readonly holds: readonly WalletHoldView[];

  /**
   * The server's stamp, carried and not parsed.
   *
   * NOT AN `AccountState` AND THE DISTINCTION IS DELIBERATE. INV-M4-02's
   * `as_of_trading_day` labels ACCOUNT state, which is T+1 and belongs to a
   * trading day the exchange calendar defines. A wallet balance is not account
   * state: `M20` section 1.2 makes it money that has already left the accounts
   * and is owed unconditionally, and `GET /wallet` stamps it with an INSTANT
   * rather than with a trading day. Typing it as a trading day would be this
   * application claiming a calendar it does not own, which ../view/as-of.ts
   * refuses one layer down for the same reason.
   */
  readonly as_of: string;
};

function toHold(hold: WalletHold): WalletHoldView {
  return {
    rule: hold.rule,
    amount: formatCents(hold.cents),
    since: hold.since,
    available_at: hold.available_at,
  };
}

// -----------------------------------------------------------------------------
// 2. The two exits, which M04 calls directions
// -----------------------------------------------------------------------------
// Section 3.5: "Two directions, deliberately asymmetric. Money in is instant and
// needs no explanation. Money out has two exits and the screen shows both:
// SPEND on an evaluation or a reset, which is instant and internal, and WITHDRAW
// to a bank destination, which carries KYC, the 48 hour destination-cooling
// window, a $100 minimum, and 2 to 3 business days."
//
// THE NAME IS `exit` AND NOT `direction`, AND THE RENAME PREVENTS A REAL
// COLLISION. `WalletDirection` is already taken by API_CONTRACT section 6.2,
// where it is the CREDIT/DEBIT discriminator on a statement entry. Two different
// closed vocabularies under one word in one screen's source is how a guard ends
// up asserting the wrong one, so section 3.5's other word is used for its own
// concept and the contract keeps `direction`.

/** Section 3.5's two exits. Closed: a third way out of a wallet is a ruling. */
export type WalletExitId = 'spend' | 'withdraw';

/**
 * One exit, with its published sentence and its control.
 *
 * `submits_to` IS TYPED AS THE LITERAL `null` SO THAT WIRING IT IS A TYPE CHANGE
 * A REVIEWER READS, which is `app/payouts/view.ts`'s `RequestControlView`
 * precedent and the same argument: "An enabled control that silently does
 * nothing is a promise to a trader that the code cannot keep, and this
 * application's whole subject is not making false statements on a screen."
 *
 * THE REASON IT IS NULL IS NOT ELEVATION AND SAYING SO MATTERS. Until ADR-219
 * there was no write path in this application at all, because ../http/client.ts's
 * `ApiClient` declared `get` and nothing else. `post` exists now and NOTHING IN
 * THIS SEGMENT CALLS IT: that entry ships the transport and wires no page.
 * `test/surface.test.ts` still fails on a second file growing a `fetch(`, and
 * ADR-083 section 3 with ADR-095 ruling 3 still forbid a route handler or a
 * Server Action here. So both exits are inert for a reason that has nothing to
 * do with who the trader is, and a screen that blamed the trader's session for
 * it would be wrong about its own cause.
 */
export type WalletExitView = {
  readonly id: WalletExitId;

  /**
   * The published wording, or its absence.
   *
   * BRANDED, SO A LITERAL CANNOT BE ASSIGNED HERE. See this file's header: the
   * four parameters section 3.5 requires on the withdraw exit are plan and
   * policy parameters, no endpoint carries them, and the portal may not state
   * one. `null` today, on a measurement.
   */
  readonly published_copy: CopyBlock | null;

  /**
   * Section 3.7's authority boundary, as a property of the ACTION.
   *
   * TRUE ON `withdraw` AND FALSE ON `spend`, and both come straight out of C-27
   * rather than out of any session's state. "External withdrawal" is one of the
   * three sensitive actions C-27 names and section 3.7's table puts it on "SC-
   * M4-10's withdraw direction"; spending inside Merit is M03's checkout and is
   * not on that list.
   *
   * IT IS A STATEMENT ABOUT THE ACTION AND NEVER A CLAIM ABOUT THIS SESSION,
   * which is what lets this screen be honest without reading an endpoint it
   * cannot reach. INV-M4-15: "The disabled state is a convenience and the server
   * is the control." The server refuses a non-elevated withdrawal whatever this
   * field says, and this field's only job is section 3.7's stated purpose --
   * that the trader "learns it before they act" rather than after.
   */
  readonly elevation_required: boolean;

  /** See the type doc. Literal `null` until a write path exists. */
  readonly submits_to: null;
};

/**
 * Both exits, in section 3.5's own order: the instant internal one, then the
 * external one that carries every control.
 */
export type WalletExitsView = {
  readonly spend: WalletExitView;
  readonly withdraw: WalletExitView;
};

/**
 * The sentences this screen would render if a plan version published them.
 *
 * COLLECTED IN ONE CONSTANT FOR ../copy/copy-block.ts's OWN STATED REASON: "A
 * key spelled two ways in two components is a sentence that renders on one
 * screen and throws on the other." Reconciling this vocabulary against M3's
 * publish gate is then a diff on one object.
 *
 * THE KEYS ARE PROPOSALS AND ARE NOT TRANSCRIBED FROM ANYWHERE, which is the
 * same statement `COPY_KEYS` makes about its own: `grep -r copy_blocks docs/`
 * returns prose and no key vocabulary, so the corpus says what must be published
 * and never what the keys are called.
 */
export type WalletCopy = {
  /** Section 3.5's payable-balance framing, and its three negatives. */
  readonly balance_framing: CopyBlock;
  readonly spend: CopyBlock;
  readonly withdraw: CopyBlock;
};

// -----------------------------------------------------------------------------
// 3. The statement
// -----------------------------------------------------------------------------
// Section 3.5: "Every credit and debit with its cause, because the wallet is a
// ledger view and a ledger view that does not reconcile to the trader's own
// memory is the fastest way to lose the trust the wallet was built to earn."

/**
 * One line of the statement.
 *
 * `provenance` IS PRESENT ON CREDITS AND ABSENT ON DEBITS, AND THAT IS THE
 * SCHEMA REPORTED HONESTLY. API_CONTRACT section 6.2: the column is `NOT NULL`
 * on every row and its three members are the CREDIT list, "so a debit is stored
 * carrying a class that does not describe it. What a debit MEANS is `cause` and
 * `reference_id`." Rendering a provenance on a debit row would put the schema's
 * own defect on a screen as a fact about the trader's money.
 *
 * `amount` IS A MAGNITUDE AND `direction` CARRIES THE SIGN, unchanged from the
 * wire. The formatter would happily render a signed number, and combining the
 * two here would be this file deciding a convention `0011` deliberately refused.
 */
export type WalletEntryView = {
  readonly entry_id: string;
  readonly direction: WalletEntry['direction'];
  readonly provenance: WalletProvenance | null;
  readonly amount: string;
  readonly cause: string;
  readonly reference_id: string;
  readonly ledger_transaction_id: string;
  readonly balance_after: string;
  readonly occurred_at: string;
};

/**
 * The statement, in the order the server sent it.
 *
 * NOT SORTED HERE. API_CONTRACT section 6.2 fixes the ordering at `occurred_at`
 * descending, "which is `wallet_entries_identity_idx`'s own order", and a client
 * that re-sorted would be able to disagree with the running
 * `balance_after_cents` column it renders beside each row.
 */
export type WalletStatementView = {
  readonly entries: readonly WalletEntryView[];

  /** Section 1's cursor, carried so a later page control has its anchor. */
  readonly next_cursor: string | null;
};

function toEntry(entry: WalletEntry): WalletEntryView {
  return {
    entry_id: entry.entry_id,
    direction: entry.direction,
    provenance: entry.direction === 'credit' ? entry.provenance : null,
    amount: formatCents(entry.amount_cents),
    cause: entry.cause,
    reference_id: entry.reference_id,
    ledger_transaction_id: entry.ledger_transaction_id,
    balance_after: formatCents(entry.balance_after_cents),
    occurred_at: entry.occurred_at,
  };
}

// -----------------------------------------------------------------------------
// 4. The screen
// -----------------------------------------------------------------------------

/** SC-M4-10, whole. */
export type WalletView = {
  readonly balance: WalletBalanceView;
  readonly exits: WalletExitsView;
  readonly statement: WalletStatementView;
};

/**
 * Build the wallet screen from the two reads section 6.2 says compose it.
 *
 * TWO READS AND NOT ONE, ON THE CONTRACT'S OWN INSTRUCTION. Section 6.2 keeps
 * promotional credit off `GET /wallet` because "a `promotional_credit_cents`
 * field beside `balance_cents` is one client-side addition away from AS-M20-01,
 * credit converted to cash, so the wallet screen composes two reads rather than
 * one response mixing two kinds of money".
 *
 * @param wallet  `GET /wallet`.
 * @param entries `GET /wallet/entries`, already narrowed by the caller.
 * @param copy    the published sentences, or `null` when no plan version carries
 *                them. See the header: `null` is this build's measured state.
 */
export function toWalletView(input: {
  readonly wallet: WalletResponse;
  readonly entries: readonly WalletEntry[];
  readonly next_cursor: string | null;
  readonly copy: WalletCopy | null;
}): WalletView {
  const copy = input.copy;

  return {
    balance: {
      tier: 'authoritative',
      balance: formatCents(input.wallet.balance_cents),
      withdrawable: formatCents(input.wallet.withdrawable_cents),
      held: formatCents(input.wallet.held_cents),
      holds: input.wallet.holds.map(toHold),
      as_of: input.wallet.as_of,
    },
    exits: {
      spend: {
        id: 'spend',
        published_copy: copy === null ? null : copy.spend,
        elevation_required: false,
        submits_to: null,
      },
      withdraw: {
        id: 'withdraw',
        published_copy: copy === null ? null : copy.withdraw,
        elevation_required: true,
        submits_to: null,
      },
    },
    statement: {
      entries: input.entries.map(toEntry),
      next_cursor: input.next_cursor,
    },
  };
}

/** The balance framing sentence, or its absence. Section 3.5's first element. */
export function walletFraming(copy: WalletCopy | null): CopyBlock | null {
  return copy === null ? null : copy.balance_framing;
}
