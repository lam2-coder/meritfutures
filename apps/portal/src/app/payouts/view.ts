// =============================================================================
// apps/portal/src/app/payouts/view.ts
// =============================================================================
// SC-M4-04, THE PAYOUT CENTER, AS A PURE FUNCTION FROM TWO WIRE SHAPES TO ONE
// RENDER-READY SHAPE. Everything on this screen that is a decision is made
// here, in a `.ts` file, and ./page.ts holds only the element tree. The split
// is not tidiness: it is what keeps four existing controls pointed at the one
// screen in this application where money is rendered. See ./page.ts's header
// for the four and for why this segment is `.ts` rather than `.tsx`.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE COMPUTES, WHICH IS NOTHING A SERVER DECIDED
// -----------------------------------------------------------------------------
// INV-M4-01: no money value displayed anywhere is computed client side. Every
// amount below goes through ../../format/money.ts and no other path exists.
// INV-M4-03: no client-side gate evaluation exists. `RequestControlView.enabled`
// IS `EligibilityResponse.eligible`, assigned across, and the gate list is
// ../../view/eligibility.ts's output passed through untouched.
//
// THE ONE COMPARISON THIS FILE MAKES IS NOT A GATE EVALUATION AND SECTION 3
// BELOW IS THE ARGUMENT. `toVerdict` compares the server's own `eligible`
// boolean against the server's own list of failing gates. It decides no rule,
// reads no threshold and computes no number. What it detects is that the two
// halves of one response disagree, and it renders that disagreement rather than
// hiding it.
//
// -----------------------------------------------------------------------------
// NO SENTENCE ON THIS SCREEN NAMES A THRESHOLD, AN OPERATOR OR A CONSEQUENCE
// -----------------------------------------------------------------------------
// INV-M4-08: "Every rule sentence on any screen comes from `copy_blocks` on the
// account's pinned plan version. No rule text is authored in the portal."
//
// The gate list needs labels and this file authors none of them. `humanise`
// below is a MECHANICAL TRANSFORM of an identifier the contract already
// declares: `traded_days` becomes "Traded days", `profit_needed_to_dilute`
// becomes "Profit needed to dilute". The label set is therefore the contract's
// own key set, and changing a label means changing a contract key, which is a
// diff on API_CONTRACT rather than a wording decision taken in a component.
// The numbers beside each label are the server's. A label plus the server's
// numbers is the whole rule shown without any part of it having been written
// here, which is what SC-M4-03's "gate by gate, with numbers" asks for.
//
// `not_frozen.reason` and `failure_note` are rendered VERBATIM. Both are
// server-composed trader-safe sentences, and ../../view/eligibility.ts already
// records that the first is "carried and not rewritten".

import type { EligibilityResponse } from '../../api/types.ts';
import { formatCents } from '../../format/money.ts';
import type { AccountState } from '../../view/as-of.ts';
import { toEligibilityView } from '../../view/eligibility.ts';
import type { EligibilityView, GateId } from '../../view/eligibility.ts';
import type { PayoutHold, PayoutListItem, PayoutStatus, PayoutTimelineEntry } from './wire.ts';

// -----------------------------------------------------------------------------
// 1. Labels, derived rather than authored
// -----------------------------------------------------------------------------

/**
 * Words that are acronyms, cased as acronyms.
 *
 * THIS CHANGES CASE AND NEVER WORDS, which is why it is not the authoring
 * INV-M4-08 forbids: `kyc_verified` renders "KYC verified" rather than "Kyc
 * verified", and the label is still the contract's key. A set that started
 * replacing a key with a friendlier synonym would have crossed the line, so it
 * holds exactly the tokens that are initialisms and its membership test is
 * whether upper-casing the token is the only edit.
 */
const ACRONYMS = new Set(['kyc']);

/**
 * An identifier the contract declares, as a label a person reads.
 *
 * Underscores become spaces and the first letter is capitalised. That is the
 * entire transform, and its entire purpose is that no word on the gate list
 * originated in this repository.
 */
export function humanise(identifier: string): string {
  const words = identifier
    .split('_')
    .map((word) => (ACRONYMS.has(word) ? word.toUpperCase() : word));
  const spaced = words.join(' ');
  return spaced.length === 0 ? spaced : `${spaced.slice(0, 1).toUpperCase()}${spaced.slice(1)}`;
}

// -----------------------------------------------------------------------------
// 2. The payout history. API_CONTRACT `GET /payouts`
// -----------------------------------------------------------------------------

/** One row of the status timeline M04 section 5 requires. */
export type PayoutRowView = {
  readonly payout_request_id: string;
  readonly account_id: string;

  /** The wire value, carried so a component can branch on the state itself. */
  readonly status: PayoutStatus;

  /** The wire value through `humanise`. "Held pending review", never "Declined". */
  readonly status_label: string;

  readonly approved: string;
  readonly trader: string;

  /** Null while held. The hold is pre-approval and there is no approval time. */
  readonly approved_at: string | null;
  readonly settled_at: string | null;

  /** Present only when the status is `held_pending_review`. */
  readonly hold: PayoutHold | null;

  readonly timeline: readonly PayoutTimelineEntry[];

  /** The server's own note. M04 section 5: "silence here is what payout-trust collapse is made of". */
  readonly failure_note: string | null;
};

/**
 * The history, in the order the server sent it.
 *
 * NOT SORTED HERE. The ordinal is the server's and a client that re-sorts a
 * list of payouts has produced a second answer to "which one was third", which
 * is the shape ../../view/eligibility.ts refuses one level up when it declines
 * to reorder the gate list by outcome.
 */
export type PayoutHistoryView = {
  readonly rows: readonly PayoutRowView[];
};

function toPayoutRow(item: PayoutListItem): PayoutRowView {
  return {
    payout_request_id: item.payout_request_id,
    account_id: item.account_id,
    status: item.status,
    status_label: humanise(item.status),
    approved: formatCents(item.approved_cents),
    trader: formatCents(item.trader_cents),
    approved_at: item.approved_at,
    settled_at: item.settled_at,
    hold: item.hold,
    timeline: item.timeline,
    failure_note: item.failure_note,
  };
}

export function toPayoutHistory(items: readonly PayoutListItem[]): PayoutHistoryView {
  return { rows: items.map(toPayoutRow) };
}

// -----------------------------------------------------------------------------
// 3. The verdict, and the case the corpus has not settled
// -----------------------------------------------------------------------------

/**
 * What the screen can honestly say about the server's answer.
 *
 * `unexplained` IS ADR-148's SUBJECT AND IT IS RENDERED RATHER THAN RESOLVED.
 *
 * `G-ELIGIBLE` (STATE_MACHINES section 10) is a conjunction of twelve terms.
 * The eligibility response declares TEN gates. Two of the twelve have no member
 * in the response at all:
 *
 *   1. `identities.status = 'active'`, which is ADR-062 section 1's ruling.
 *   2. `G-NO-IN-FLIGHT`, which API_CONTRACT surfaces as a `conflict` error on
 *      `POST /accounts/:id/payout` and never as a gate.
 *
 * So a trader whose identity is `restricted` or `closed`, or who already has a
 * request in flight, can receive `eligible: false` with all ten rendered gates
 * passing. On the one screen whose stated job is to show the whole rule, that
 * is ten green rows beside a refusal, and M04 section 3.2's copy rule ("not
 * yet, here is exactly what is left") has nothing to name.
 *
 * THIS FILE DOES NOT DECIDE WHETHER THE RESPONSE SHOULD GAIN THOSE MEMBERS.
 * That is a change to a frozen contract and it belongs to a ruling. What it
 * does is refuse to render the silent version: `unexplained` says the server
 * declined and that this response carries no failing gate, which is true,
 * checkable against the payload, and the opposite of a confident answer.
 *
 * See docs/decisions/ADR-148.md.
 */
export type Verdict =
  | { readonly kind: 'eligible' }
  | { readonly kind: 'blocked'; readonly by: readonly GateId[] }
  | { readonly kind: 'unexplained' };

/**
 * Two server fields, compared. No rule is evaluated and no threshold is read.
 *
 * `eligible` is the server's boolean and `failing` is
 * ../../view/eligibility.ts's filter over the server's own `pass` booleans.
 * INV-M4-03 bans a client deciding whether a rule is met; it does not ban a
 * client noticing that a response did not explain itself, and a screen that
 * could not notice would render the ten green rows.
 */
export function toVerdict(eligibility: EligibilityView): Verdict {
  if (eligibility.eligible) return { kind: 'eligible' };
  if (eligibility.failing.length === 0) return { kind: 'unexplained' };
  return { kind: 'blocked', by: eligibility.failing };
}

// -----------------------------------------------------------------------------
// 4. The request control. INV-M4-03, and the half that is owed
// -----------------------------------------------------------------------------

/**
 * The control's state, which is the server's answer and nothing else.
 *
 * INV-M4-03: "The payout request button is enabled ONLY when the server said
 * `eligible: true`, and the amount shown is the server's `max_payout_cents`."
 * Both fields below are assignments across from the response.
 *
 * `POST /accounts/:id/payout` IS NOT A C-27 SENSITIVE ACTION AND THIS CONTROL
 * IS THEREFORE NOT INV-M4-14's. The reading is easy to get backwards, so it is
 * written down. SECURITY C-27's sensitive set is "payout destination change,
 * contact change of either kind, or external withdrawal", and its row against
 * this route reads "C-27 ON THE EXTERNAL LEG". The external leg is
 * `POST /wallet/withdrawals` (M20 section 3.7, M05 section 3.6). A payout
 * request credits `trader_wallet`; it does not move money out of Merit. A
 * component that rendered this control disabled for a non-elevated session
 * would be refusing an eligible trader a control C-27 never asked to be
 * refused, which is FM-M4-10 pointed the wrong way.
 */
export type RequestControlView = {
  /** The server's `eligible`, assigned. */
  readonly enabled: boolean;

  /** The server's `max_payout_cents`, formatted. Zero when not eligible, and that is the server's zero. */
  readonly amount: string;
  readonly minimum: string;

  /** The server's failing gates, passed through so the disabled state carries the failing gate's own text. */
  readonly blocking: readonly GateId[];

  /**
   * THE ROUTE THIS CONTROL SUBMITS TO, WHICH DOES NOT EXIST, TYPED AS THE
   * LITERAL `null` SO THAT WIRING IT IS A TYPE CHANGE A REVIEWER READS.
   *
   * Section 3.2's confirm machine is money path: the re-fetch at confirm
   * (INV-M4-04, AS-M4-02), the idempotency key generated once per confirm
   * session rather than per tap, and the request body. ../../view/eligibility.ts
   * already recorded that half as owed and said the button was owed with it.
   * Session 252 owns `POST /accounts/:id/payout`.
   *
   * So this build renders the control INERT and says so on the screen. An
   * enabled control that silently does nothing is a promise to a trader that
   * the code cannot keep, and this application's whole subject is not making
   * false statements on a screen.
   */
  readonly submits_to: null;
};

function toRequestControl(eligibility: EligibilityView): RequestControlView {
  return {
    enabled: eligibility.eligible,
    amount: eligibility.max_payout,
    minimum: eligibility.min_payout,
    blocking: eligibility.failing,
    submits_to: null,
  };
}

// -----------------------------------------------------------------------------
// 5. The screen
// -----------------------------------------------------------------------------

/** SC-M4-04. Extends `AccountState`: INV-M4-02, the day travels with the numbers. */
export type PayoutCenterView = AccountState & {
  readonly account_id: string;

  /**
   * ALWAYS `authoritative`, AS A LITERAL TYPE, inherited from
   * ../../view/eligibility.ts and restated at this level because section 3.6's
   * tier table reads "Everything in the payout center | authoritative, ALWAYS"
   * and INV-M4-13 is the rule it enforces.
   */
  readonly tier: 'authoritative';

  readonly eligibility: EligibilityView;
  readonly verdict: Verdict;
  readonly request: RequestControlView;
  readonly history: PayoutHistoryView;
};

/**
 * The payout center, assembled from the two endpoints M04 section 4 names.
 *
 * `as_of_trading_day` COMES FROM THE ELIGIBILITY RESPONSE AND FROM NOWHERE
 * ELSE. `GET /payouts` carries no trading day: its rows are settled facts with
 * their own timestamps, and the day this screen is "as of" is the day the gates
 * were evaluated against. Taking it from anywhere else would label the gates
 * with a day they were not computed on, which is the failure INV-M4-02 exists
 * to prevent arrived at from the other direction.
 */
export function toPayoutCenterView(input: {
  readonly eligibility: EligibilityResponse;
  readonly payouts: readonly PayoutListItem[];
}): PayoutCenterView {
  const eligibility = toEligibilityView(input.eligibility);

  return {
    account_id: eligibility.account_id,
    as_of_trading_day: eligibility.as_of_trading_day,
    tier: 'authoritative',
    eligibility,
    verdict: toVerdict(eligibility),
    request: toRequestControl(eligibility),
    history: toPayoutHistory(input.payouts),
  };
}
