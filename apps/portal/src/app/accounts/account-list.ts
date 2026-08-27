// =============================================================================
// apps/portal/src/app/accounts/account-list.ts
// =============================================================================
// SC-M4-02, THE ACCOUNT LIST, RENDERED.
//
// M04 section 3.1's one thing it must get right: "Floor distance, because it is
// the number traders actually watch, and it is the number that decides whether
// they trade tomorrow." That sentence is a LAYOUT requirement as much as a data
// one, and FM-M4-08 says so in its own row: "mobile layout hides the failing
// gate below the fold ... this is a correctness bug, not a polish item." So
// floor distance is the FIRST row of every card here, before the balance it is
// derived from, and the ordering is asserted in the suite rather than left to a
// reader agreeing that it looks right.
//
// -----------------------------------------------------------------------------
// THE AS-OF LABEL IS PER CARD AND NOT PER PAGE, WHICH IS NOT A DETAIL
// -----------------------------------------------------------------------------
// `AccountCardView` extends `AccountState`, so each card carries its OWN
// `as_of_trading_day`. Two accounts on one screen can legitimately be as of two
// different days: the marks that close a day are per account, and an account
// provisioned yesterday has no mark for the day its neighbour has closed. A
// single page-level label would therefore state one day over figures that are
// as of two, which is INV-M4-02 satisfied in form and broken in substance.
//
// -----------------------------------------------------------------------------
// THIS SCREEN DOES NOT FOLD, AND OQ-M4-01 IS WHY
// -----------------------------------------------------------------------------
// ../../view/accounts.ts refuses to sum `withdrawable` across the list because
// OQ-M4-01 is OPEN: "does the portal show the identity-level aggregate?" is a
// founder question with a recommendation and not a ruling, and any total is a
// computed money value that would have to be the server's (INV-M4-01). A screen
// that added a totals row would answer that question with markup instead of
// with an ADR, so there is no totals row and this paragraph is why.
//
// -----------------------------------------------------------------------------
// THE LABELS ARE THIS FILE'S AND THE RULE SENTENCES ARE NOT, AND FM-M4-05 IS
// THE LINE BETWEEN THEM
// -----------------------------------------------------------------------------
// FM-M4-05 is "the portal renders A RULE from its own source rather than
// `copy_blocks`", and its detection is "a build-time check that no RULE-SHAPED
// string literal exists in portal source". A column label is not rule shaped: it
// names a field, states no threshold, carries no operator and changes with no
// plan version. The compliant fixture settles it by precedent, since it authors
// "Wallet balance", "Win days recorded" and "Next request opens" in its own
// body while taking every NUMBER from the data.
//
// WHAT IS STILL REFUSED HERE IS THE COMPOSED SENTENCE, which is the thing
// ../../view/accounts.ts names: "there is no `statusLabel`, no 'you are 3 days
// away', no assembled headline ... a composed sentence is where both of those
// get broken by somebody being helpful." Nothing below joins two server fields
// into a clause. Each label names one field and each value is one field's
// already-formatted string.

import { createElement } from 'react';
import type { ReactElement } from 'react';

import type { AccountCardView, BlockedReason } from '../../view/accounts.ts';
import { AsOf, Row, StateWord } from './elements.ts';

/**
 * The block keys the server reports, as nouns.
 *
 * EXHAUSTIVE BY TYPE RATHER THAN BY VIGILANCE. It is a `Record` over
 * `BlockedReason`, so a fourth member added to that union in
 * ../../view/accounts.ts fails this file's type check instead of rendering as a
 * blank cell on a screen whose whole subject is what is holding an account.
 *
 * EACH ENTRY STATES THE BLOCK AND NEVER ITS REMEDY. "What to do about it" is a
 * rule, it depends on the plan version, and it is `copy_blocks`'s (INV-M4-08).
 */
const BLOCKED_LABEL: Readonly<Record<BlockedReason, string>> = {
  payouts_frozen: 'payouts frozen',
  recon_blocked: 'reconciliation incomplete',
  kyc_required: 'identity verification required',
};

/**
 * `phase` and `status`, as nouns.
 *
 * BOTH ARE RENDERED AND NEITHER IS DERIVED FROM THE OTHER. They are two
 * independent server fields on `AccountListItem`: a `funded` account can be
 * `breached`, and a screen that showed one of them would be choosing which half
 * of that pair the trader gets to see.
 */
const PHASE_LABEL: Readonly<Record<AccountCardView['phase'], string>> = {
  eval: 'evaluation',
  funded: 'funded',
  closed: 'closed',
  graduated: 'graduated',
};

const STATUS_LABEL: Readonly<Record<AccountCardView['status'], string>> = {
  provisioning_pending: 'provisioning',
  active: 'active',
  breached: 'breached',
  expired: 'expired',
  closed_admin: 'closed by Merit',
  closed_chargeback: 'closed after a chargeback',
  graduated: 'graduated',
};

/**
 * One card. SC-M4-02.
 *
 * THE HEADING IS THE PLAN'S OWN `name` AND IS NOT ASSEMBLED. The compliant
 * fixture's heading reads "Funded account 50K", which joins a phase, a noun and
 * a size; that is three fields composed into a headline and it is the shape
 * ../../view/accounts.ts refuses. The plan name is one server field and the
 * phase, the status and the size each get their own row below it, so the same
 * information reaches the trader without this file writing a clause.
 */
export function AccountCard(props: { readonly account: AccountCardView }): ReactElement {
  const { account } = props;

  return createElement(
    'article',
    null,
    createElement('h2', null, account.plan.name),

    // FIRST, AND THE ORDER IS THE REQUIREMENT. SC-M4-02 and FM-M4-08.
    createElement(Row, { label: 'Floor distance', children: account.floor_distance }),
    createElement(Row, { label: 'Balance', children: account.balance }),
    createElement(Row, { label: 'Floor', children: account.floor }),
    createElement(Row, { label: 'Withdrawable', children: account.withdrawable }),
    createElement(Row, { label: 'Account size', children: account.size }),
    createElement(Row, {
      label: 'Phase',
      children: createElement(StateWord, { children: PHASE_LABEL[account.phase] }),
    }),
    createElement(Row, {
      label: 'Status',
      children: createElement(StateWord, { children: STATUS_LABEL[account.status] }),
    }),

    // ABSENT WHEN NOTHING IS BLOCKED, rather than present and empty.
    // ../../view/accounts.ts: an empty `blocked` "is a different fact from
    // 'eligible': eligibility is the eligibility endpoint's answer and this is
    // the account card's, and conflating them is how a card and a gate list end
    // up disagreeing on one screen." So there is no "eligible" row here and
    // there never will be; SC-M4-04 renders that endpoint's answer.
    account.blocked.length === 0
      ? null
      : createElement(Row, {
          label: 'Blocked',
          children: account.blocked.map((reason) =>
            createElement(StateWord, { key: reason, children: BLOCKED_LABEL[reason] }),
          ),
        }),

    createElement(AsOf, { as_of_trading_day: account.as_of_trading_day }),
  );
}

/**
 * SC-M4-02's screen.
 *
 * A ZERO-LENGTH LIST IS THE TRADER HOLDING NO ACCOUNTS AND IS NOT A LOAD
 * FAILURE. ../../shell/app-shell.ts is emphatic that those are different
 * states: "`empty` IS A STATE AND NOT A ZERO-LENGTH `ready`. A trader with no
 * accounts and a trader whose accounts failed to load must not look alike." The
 * distinction is the shell's and is made before this function is called: a
 * failed read never reaches this screen, because ./page.ts has nothing to hand
 * it. What arrives here is always the `ready` payload, so a zero-length array
 * here carries exactly one meaning and the copy states that meaning and no
 * other.
 */
export function AccountListScreen(props: {
  readonly accounts: readonly AccountCardView[];
}): ReactElement {
  return createElement(
    'main',
    null,
    createElement('h1', null, 'Accounts'),
    props.accounts.length === 0
      ? createElement('p', null, 'You hold no accounts.')
      : props.accounts.map((account) =>
          createElement(AccountCard, { key: account.account_id, account }),
        ),
  );
}
