// =============================================================================
// apps/portal/src/app/wallet/sections.ts
// =============================================================================
// THE ELEMENT TREE FOR SC-M4-10. Every component here is a pure function from a
// view model built in ../../view/wallet.ts to a React element. None of them
// formats a number, compares a threshold, or authors a sentence about a rule.
//
// -----------------------------------------------------------------------------
// THIS SEGMENT IS `.ts` AND NOT `.tsx`, WHICH IS A CONTROL DECISION
// -----------------------------------------------------------------------------
// `app/payouts/page.ts` wrote the argument in full and it applies here word for
// word, because this is the second screen in this application where money is
// rendered. Four controls in this repository are scoped to `*.ts` and none of
// them sees a `.tsx` file:
//
//   1. `eslint.config.js`'s `merit/no-raw-db-client` block (VG-4).
//   2. `eslint.config.js`'s `merit/no-calendar-in-expiry-path` block (ADR-042).
//   3. `apps/portal/test/inv-m4-01.test.ts`, which walks `src/` for `.ts` files
//      and fails on an arithmetic operator beside a `_cents` or `_bp`
//      identifier. IT IS THE STANDING SUBSTITUTE FOR INV-M4-01's UNWRITTEN LINT
//      RULE and this is a screen it exists for.
//   4. `apps/portal/test/surface.test.ts`, which walks the same set for
//      `fetch(`, `XMLHttpRequest`, `WebSocket` and `EventSource`.
//
// A `.tsx` wallet screen would drop all four by choosing a file extension, on
// the screen that renders a trader's whole balance. That is weakening four gates
// to pass none of them.
//
// -----------------------------------------------------------------------------
// NO SENTENCE ON THIS SCREEN IS A RULE SENTENCE, AND THAT IS THE HARD PART
// -----------------------------------------------------------------------------
// M04 section 3.5 requires this screen to state a great deal -- that the balance
// is money already earned and held until withdrawn, that it is not an account,
// earns no interest and cannot be sent to another trader, that spending is
// instant and internal, and that withdrawing carries KYC, a cooling window, a
// minimum, a settlement window and NO FEE. It then rules the wording: "The
// wording is a `copy_blocks` entry (INV-M4-08) and a counsel-review item."
//
// SO NOT ONE OF THOSE SENTENCES IS WRITTEN HERE. ../../view/wallet.ts carries
// them as a branded `CopyBlock | null` slot, nothing can currently fill it (see
// ./source.ts for why: `copy_blocks` hangs off `plan_versions` and a wallet has
// no plan version), and this file renders the ABSENCE where the sentence
// belongs, by name, so a trader and a reviewer can both see which statement is
// owed rather than finding a blank.
//
// THE LABELS ARE NOT SENTENCES AND THE DISTINCTION IS THE CONTRACT'S OWN FIELD
// NAMES. "Balance", "Withdrawable" and "Held" are `balance_cents`,
// `withdrawable_cents` and `held_cents` spelled for a reader, which is
// `app/payouts/view.ts`'s `humanise` argument: "changing a label means changing
// a contract key, which is a diff on API_CONTRACT rather than a wording decision
// taken in a component."
//
// -----------------------------------------------------------------------------
// AND NOTHING HERE IS A SCORE, A STREAK OR A LEVEL
// -----------------------------------------------------------------------------
// Section 3.5's last rule, and ADR-019a's bright line "arriving in the one place
// it is most tempting to cross". There is no bar whose width is a proportion of
// anything, no rank, no badge, no personal best, no comparison against any other
// trader or against this trader's own past, and no element that grows with the
// number. The balance is three amounts and a timestamp in normal document flow.
//
// THAT ALSO SATISFIES FM-M4-08 STRUCTURALLY, which is `app/payouts/sections.ts`'s
// second mechanism: this segment ships no width, no column, no grid, no float
// and no fixed dimension, so there is nothing here that lays out differently at
// 375px than at 1920px. A screen with no layout cannot have a layout bug.

import { createElement } from 'react';
import type { ReactElement } from 'react';

import type { CopyBlock } from '../../copy/copy-block.ts';
import type { PortalErrorKind } from '../../shell/app-shell.ts';
import type {
  WalletBalanceView,
  WalletEntryView,
  WalletExitView,
  WalletHoldView,
  WalletStatementView,
  WalletView,
} from '../../view/wallet.ts';

const el = createElement;

/**
 * A value the server did not report, said in words.
 *
 * ../../format/money.ts refuses to render a null money field as `0.00` because
 * that "would state a fact the server did not send", and
 * `app/payouts/sections.ts` records that AN EMPTY CELL MAKES THE SAME STATEMENT
 * BY OMISSION, invisibly. On this screen the null that matters is a hold's
 * `available_at`, which API_CONTRACT calls "the honest answer today" because no
 * landed column carries the card networks' dispute window.
 */
const NOT_REPORTED = 'not reported';

/**
 * A sentence that has to come from a published plan version and has not.
 *
 * IT NAMES WHAT IS MISSING RATHER THAN RENDERING NOTHING. A blank where the
 * wallet's framing belongs is the failure INV-M4-08 exists to prevent, arrived
 * at by omission instead of by invention: ../../copy/copy-block.ts makes exactly
 * that argument about `copyBlock` throwing rather than returning null, and this
 * is the same decision one layer up, where the absence is expected and a throw
 * would take the screen down over copy that was never published.
 */
const COPY_PENDING = 'This wording is published with the plan version and is not yet available.';

/** One published sentence, or the statement that it is not published. */
function Published({
  copy,
  name,
}: {
  readonly copy: CopyBlock | null;
  readonly name: string;
}): ReactElement {
  return copy === null
    ? el('p', { className: 'merit-copy merit-copy--pending', 'data-copy': name }, COPY_PENDING)
    : el('p', { className: 'merit-copy', 'data-copy': name }, copy);
}

// -----------------------------------------------------------------------------
// The balance
// -----------------------------------------------------------------------------

/** One hold, with the rule that placed it and the date it lifts, or its absence. */
export function Hold({ hold }: { readonly hold: WalletHoldView }): ReactElement {
  return el(
    'li',
    { className: 'merit-hold', 'data-rule': hold.rule },
    el('span', { className: 'merit-hold__amount' }, hold.amount),
    el('span', { className: 'merit-hold__since' }, hold.since),
    el('span', { className: 'merit-hold__available' }, hold.available_at ?? NOT_REPORTED),
  );
}

/**
 * Section 3.5's first element: the balance, and the two components the server
 * computed it from.
 *
 * THE TIER IS ON THE ELEMENT AND IN THE MARKUP. INV-M4-11 makes the tier a
 * required prop rather than a footnote and ../../view/as-of.ts enforces it as a
 * type; carrying it onto the rendered element is what makes it readable from the
 * bytes, which is how `test/wallet.test.ts` asserts it.
 *
 * THREE FIGURES, EACH READ FROM ITS OWN FIELD. There is no arithmetic in this
 * component and none in the view model behind it: API_CONTRACT section 6.2
 * states `balance = withdrawable + held` on the server precisely so no client
 * derives one from the others.
 */
export function Balance({ balance }: { readonly balance: WalletBalanceView }): ReactElement {
  return el(
    'section',
    {
      className: 'merit-wallet-balance',
      'data-tier': balance.tier,
      'aria-labelledby': 'merit-wallet-balance-heading',
    },
    el('h2', { id: 'merit-wallet-balance-heading' }, 'Wallet balance'),
    el(
      'dl',
      { className: 'merit-wallet-balance__figures' },
      el('dt', null, 'Balance'),
      el('dd', { className: 'merit-figure', 'data-figure': 'balance' }, balance.balance),
      el('dt', null, 'Withdrawable'),
      el('dd', { className: 'merit-figure', 'data-figure': 'withdrawable' }, balance.withdrawable),
      el('dt', null, 'Held'),
      el('dd', { className: 'merit-figure', 'data-figure': 'held' }, balance.held),
    ),
    // The server's stamp, rendered rather than interpreted. Not a trading day:
    // see ../../view/wallet.ts on why this screen carries an instant.
    el('p', { className: 'merit-wallet-balance__as-of' }, `As of ${balance.as_of}`),
    balance.holds.length === 0
      ? null
      : el(
          'ul',
          { className: 'merit-wallet-balance__holds' },
          ...balance.holds.map((hold) => el(Hold, { key: hold.rule + hold.since, hold })),
        ),
  );
}

// -----------------------------------------------------------------------------
// The two exits
// -----------------------------------------------------------------------------

/**
 * The sentence a disabled sensitive control carries.
 *
 * SECTION 3.7 REQUIRES THE TRADER TO LEARN THE BOUNDARY BEFORE THEY ACT, and
 * names the failure it prevents: a trader who "logs in by SMS on a phone, opens
 * the wallet, types a destination, confirms it, and receives a 403" has learned
 * "that Merit's UI offers actions its API refuses". Worse, "the trader who is
 * actually being attacked sees an identical refusal, so the refusal carries no
 * information."
 *
 * IT NAMES THE ACTION AND NOT THE SESSION, which is what this build can honestly
 * say. `elevation_required` is a property of the ACTION under C-27 rather than a
 * claim about who is reading the screen (../../view/wallet.ts states why), so
 * this sentence is true for every trader on every visit. INV-M4-15 is what makes
 * that sufficient: "The disabled state is a convenience and the server is the
 * control."
 */
const ELEVATION_NOTE =
  'Moving money out of Merit needs a passkey or a second channel. A code sent by SMS is not enough on its own.';

/**
 * The sentence an inert control carries.
 *
 * IT SAYS THE CONTROL DOES NOT WORK YET AND DOES NOT BLAME THE TRADER. The cause
 * is that this application has no write path at all -- ../../http/client.ts's
 * `ApiClient` declares `get` and nothing else -- and `app/payouts/view.ts` set
 * the rule this follows: "An enabled control that silently does nothing is a
 * promise to a trader that the code cannot keep."
 */
const INERT_NOTE = 'This control is not available in this build.';

/**
 * One exit. Section 3.5's "two directions, deliberately asymmetric".
 *
 * BOTH ARE RENDERED AND NEITHER IS HIDDEN. Section 3.5: "Money out has two exits
 * and the screen shows both." A screen that showed only the withdrawal would
 * describe the wallet as a bank account, which is the misreading its whole first
 * paragraph exists to prevent.
 */
export function Exit({ exit }: { readonly exit: WalletExitView }): ReactElement {
  return el(
    'section',
    {
      className: 'merit-wallet-exit',
      'data-exit': exit.id,
      'data-elevation-required': String(exit.elevation_required),
    },
    el('h3', null, exit.id === 'spend' ? 'Spend on Merit' : 'Withdraw to a bank account'),
    el(Published, { copy: exit.published_copy, name: `wallet.${exit.id}` }),
    exit.elevation_required
      ? el('p', { className: 'merit-wallet-exit__elevation' }, ELEVATION_NOTE)
      : null,
    // THE CONTROL IS RENDERED AND IS DISABLED, rather than omitted. Section 3.7:
    // "The amount field stays usable and the submit is disabled, because a
    // trader who cannot yet submit can still legitimately want to know what they
    // would be withdrawing." A control that is absent teaches nothing about the
    // boundary; a control that is present and disabled is the boundary shown.
    el(
      'button',
      { type: 'button', disabled: true, className: 'merit-wallet-exit__submit' },
      exit.id === 'spend' ? 'Spend' : 'Withdraw',
    ),
    el('p', { className: 'merit-wallet-exit__inert' }, INERT_NOTE),
  );
}

// -----------------------------------------------------------------------------
// The statement
// -----------------------------------------------------------------------------

/**
 * One line of the statement.
 *
 * THE DIRECTION IS A WORD AND NOT ONLY A SIGN OR A COLOUR, which is
 * `app/payouts/sections.ts`'s rule about gate state: "a state carried only by a
 * colour is a state a screen reader and a screenshot both lose." The amount is
 * the magnitude the wire carried and this file does not sign it: `0011`
 * deliberately refused the ledger's signed convention and combining the two here
 * would be the portal deciding it back.
 *
 * THE PROVENANCE RENDERS ON CREDITS ONLY. Its absence on a debit is the schema
 * reported honestly (API_CONTRACT section 6.2) and printing one there would put
 * a class that does not describe the row onto the trader's statement.
 */
export function Entry({ entry }: { readonly entry: WalletEntryView }): ReactElement {
  return el(
    'li',
    {
      className: 'merit-wallet-entry',
      'data-direction': entry.direction,

      // THE IDENTIFIERS ARE ON THE ELEMENT AND NOT IN THE PROSE, which is two
      // decisions rather than one.
      //
      // THEY ARE NOT SENTENCES A TRADER READS. A statement line reconciles to
      // memory on its cause, its amount, its date and the running balance; an
      // opaque id beside those is noise on the screen section 3.5 wants
      // trusted at a glance. But a trader disputing a line quotes something,
      // and `reference_id` is the payout request or the purchase the line came
      // from, so the value has to be IN the document rather than only behind it.
      //
      // AND `entry_id` IS THE BIGINT. API_CONTRACT: it is a decimal string and
      // "a client must not parse it", because a `wallet_entries.id` above
      // `Number.MAX_SAFE_INTEGER` "has already lost digits by the time anything
      // reads it". Rendering the string is what makes that property observable
      // in the bytes rather than only in a view model nobody serves;
      // `test/wallet.test.ts` asserts it against 9007199254740993, the first
      // integer JavaScript cannot represent.
      'data-entry': entry.entry_id,
      'data-reference': entry.reference_id,
      'data-ledger-transaction': entry.ledger_transaction_id,
    },
    el('span', { className: 'merit-wallet-entry__direction' }, entry.direction),
    el('span', { className: 'merit-wallet-entry__amount' }, entry.amount),
    // The business event, the server's own sentence, rendered verbatim.
    el('span', { className: 'merit-wallet-entry__cause' }, entry.cause),
    entry.provenance === null
      ? null
      : el('span', { className: 'merit-wallet-entry__provenance' }, entry.provenance),
    el('span', { className: 'merit-wallet-entry__balance-after' }, entry.balance_after),
    el('span', { className: 'merit-wallet-entry__at' }, entry.occurred_at),
  );
}

/**
 * Section 3.5's third element: "every credit and debit with its cause, because
 * the wallet is a ledger view and a ledger view that does not reconcile to the
 * trader's own memory is the fastest way to lose the trust the wallet was built
 * to earn."
 *
 * THE ORDER IS THE SERVER'S. API_CONTRACT fixes `occurred_at` descending, and a
 * client that re-sorted could disagree with the running `balance_after_cents`
 * it prints beside each row.
 */
export function Statement({
  statement,
}: {
  readonly statement: WalletStatementView;
}): ReactElement {
  return el(
    'section',
    { className: 'merit-wallet-statement', 'aria-labelledby': 'merit-wallet-statement-heading' },
    el('h2', { id: 'merit-wallet-statement-heading' }, 'Statement'),
    statement.entries.length === 0
      ? // AN EMPTY WALLET IS ZERO AND NOT AN ERROR. API_CONTRACT section 6.2:
        // "An identity with no `wallet_entries` row is `0` and not a `404` ...
        // a `404` on a wallet would tell a trader they have none."
        el('p', { className: 'merit-wallet-statement__empty' }, 'No wallet activity yet.')
      : el(
          'ol',
          { className: 'merit-wallet-statement__entries' },
          ...statement.entries.map((entry) => el(Entry, { key: entry.entry_id, entry })),
        ),
  );
}

// -----------------------------------------------------------------------------
// The screen
// -----------------------------------------------------------------------------

/** SC-M4-10, in section 3.5's order: the balance, the two exits, the timeline. */
export function Wallet({
  view,
  framing,
}: {
  readonly view: WalletView;
  readonly framing: CopyBlock | null;
}): ReactElement {
  return el(
    'main',
    { className: 'merit-wallet' },
    el('h1', null, 'Merit Wallet'),
    // Section 3.5's first element and the one "the copy on ... decides whether
    // traders trust the feature at all". Published, never authored here.
    el(Published, { copy: framing, name: 'wallet.balance_framing' }),
    el(Balance, { balance: view.balance }),
    el(
      'section',
      { className: 'merit-wallet-exits', 'aria-labelledby': 'merit-wallet-exits-heading' },
      el('h2', { id: 'merit-wallet-exits-heading' }, 'Moving money'),
      el(Exit, { exit: view.exits.spend }),
      el(Exit, { exit: view.exits.withdraw }),
    ),
    el(Statement, { statement: view.statement }),
  );
}

/**
 * What renders when a read did not answer.
 *
 * IT NAMES THE ENDPOINTS AND SAYS NOTHING ABOUT A BALANCE. A wallet screen that
 * rendered `0.00` because a request failed would tell a trader their money is
 * gone, which is the single worst false statement this application could make.
 */
export function WalletUnavailable({
  missing,
}: {
  readonly missing: readonly string[];
}): ReactElement {
  return el(
    'main',
    { className: 'merit-wallet merit-wallet--unavailable' },
    el('h1', null, 'Merit Wallet'),
    el(
      'p',
      null,
      'Your wallet cannot be shown right now. This is a problem on our side and your balance is unaffected.',
    ),
    el(
      'ul',
      { className: 'merit-wallet__missing' },
      ...missing.map((endpoint) => el('li', { key: endpoint }, endpoint)),
    ),
  );
}

// -----------------------------------------------------------------------------
// The error arm, which is ADR-217's and is the sentence the old screen could not
// say
// -----------------------------------------------------------------------------

/**
 * One sentence per member of `PortalErrorKind`.
 *
 * `Record<PortalErrorKind, string>` IS THE MECHANISM, and it is
 * `app/referrals/states.ts`'s `REFERRALS_ERROR_COPY` and `app/kyc/copy.ts`'s
 * `KYC_CONTENT_COPY`: a member added to the union in ../../shell/app-shell.ts
 * and not added here is `error TS2741`, so this screen cannot silently acquire
 * a failure it has no sentence for.
 *
 * THREE MEMBERS SHARE ONE SENTENCE AND THAT IS DELIBERATE RATHER THAN LAZY.
 * `unexpected` is a `403` on a read surface, which ../../shell/app-shell.ts
 * calls "FM-M4-10 firing" and "a rendering bug until proven otherwise", and
 * INV-M4-07 spends its whole row keeping a "forbidden" vocabulary off this
 * screen: giving it its own sentence would tell a trader they lack permission
 * to see their own money, on the reading of an alertable defect. `not_found`
 * cannot reach this arm at all, because ./source.ts routes a 404 to the
 * unavailable arm on API_CONTRACT section 6.2's ruling that an empty wallet is
 * `0` and not a `404`; it is written out because the record is what keeps the
 * vocabulary from drifting, not because the sentence is reachable today.
 *
 * THE TWO THAT DIFFER ARE THE TWO A TRADER CAN ACT ON, and every sentence ends
 * the same way because it is true in every one of these cases: these are READ
 * failures, and no read moves money.
 */
export const WALLET_ERROR_COPY: Readonly<Record<PortalErrorKind, string>> = {
  not_found:
    'Your wallet cannot be shown right now. This is a problem on our side and your balance is unaffected.',
  unauthenticated:
    'You are signed out. Sign in again to see your wallet. Your balance is unaffected.',
  rate_limited: 'Too many requests. Wait a moment and reload the page. Your balance is unaffected.',
  server_error:
    'Your wallet cannot be shown right now. This is a problem on our side and your balance is unaffected.',
  unexpected:
    'Your wallet cannot be shown right now. This is a problem on our side and your balance is unaffected.',
};

/**
 * A read that reached a server which then refused or failed.
 *
 * IT SHOWS NO FIGURE, which is the same rule `WalletUnavailable` follows and
 * ./page.ts's reason for it: rendering a balance the server did not send is the
 * worst statement this application can make.
 *
 * AND IT NAMES NO ENDPOINT. `WalletUnavailable` lists the paths it did not get
 * because a path this deployment does not serve is a fact about the build and a
 * reader of that screen is the person who can fix it. A 401 is a fact about the
 * trader's own session; a list of API paths under it tells them nothing they can
 * use and reads as a stack trace on a money screen. The `status` is carried in
 * the type for whoever logs it and is not rendered.
 */
export function WalletError({ error }: { readonly error: PortalErrorKind }): ReactElement {
  return el(
    'main',
    { className: 'merit-wallet merit-wallet--error' },
    el('h1', null, 'Merit Wallet'),
    el('p', null, WALLET_ERROR_COPY[error]),
  );
}
