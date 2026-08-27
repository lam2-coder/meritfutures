// =============================================================================
// apps/portal/src/app/accounts/figures.ts
// =============================================================================
// THE FIGURES `AccountCardView` CARRIES, RENDERED ONCE FOR BOTH SCREENS.
//
// SC-M4-02's card and SC-M4-03's detail show the same nine facts, and that is a
// property of the view models rather than a coincidence:
// `AccountDetailView extends AccountCardView`, so the detail screen is handed
// every field the card is handed. Two transcriptions of that list would drift,
// and the direction they drift in is not symmetrical -- the detail screen is
// the one somebody opens when something looks wrong, so a field that fell off
// it falls off exactly where it was being looked for.
//
// THIS FILE EXISTS BECAUSE THE SUITE CAUGHT THAT HAPPENING. The first draft of
// ./account-detail.ts rendered the money rows and omitted the phase, the status
// and the blocks, so a breached account's own screen showed its funded progress
// and never said "breached" anywhere. The repair is one component rather than a
// second copy of the row list.
//
// -----------------------------------------------------------------------------
// THE THREE VOCABULARIES ARE `Record`s OVER THE VIEW MODULE'S UNIONS
// -----------------------------------------------------------------------------
// So a member added to `BlockedReason`, to `phase` or to `status` fails this
// file's type check instead of rendering as a blank cell on the screen whose
// whole subject is what is holding an account.
//
// FM-M4-05 IS NOT ENGAGED BY A LABEL AND THE LINE IS WORTH STATING ONCE. That
// failure mode is "the portal renders A RULE from its own source rather than
// `copy_blocks`", detected by "a build-time check that no RULE-SHAPED string
// literal exists in portal source". None of the nouns below is rule shaped:
// each names a field or an enum member, states no threshold, carries no
// operator and does not change with a plan version. The compliant fixture
// settles it by precedent, authoring "Wallet balance", "Win days recorded" and
// "Next request opens" in its own body while taking every NUMBER from the data.
//
// WHAT STAYS REFUSED IS THE COMPOSED SENTENCE, which ../../view/accounts.ts
// names: "there is no `statusLabel`, no 'you are 3 days away', no assembled
// headline ... a composed sentence is where both of those get broken by
// somebody being helpful." Nothing here joins two server fields into a clause.

import { createElement } from 'react';
import type { ReactElement } from 'react';

import type { AccountCardView, BlockedReason } from '../../view/accounts.ts';
import { AsOf, Row, StateWord } from './elements.ts';

/**
 * The block keys the server reports, as nouns.
 *
 * EACH ENTRY STATES THE BLOCK AND NEVER ITS REMEDY. What to do about a block is
 * a rule, it depends on the plan version, and it is `copy_blocks`'s (INV-M4-08).
 */
export const BLOCKED_LABEL: Readonly<Record<BlockedReason, string>> = {
  payouts_frozen: 'payouts frozen',
  recon_blocked: 'reconciliation incomplete',
  kyc_required: 'identity verification required',
};

/**
 * `phase` and `status`, as nouns.
 *
 * BOTH ARE RENDERED AND NEITHER IS DERIVED FROM THE OTHER. They are two
 * independent server fields: a `funded` account can be `breached`, and a screen
 * that showed one of them would be choosing which half of that pair the trader
 * gets to see.
 */
export const PHASE_LABEL: Readonly<Record<AccountCardView['phase'], string>> = {
  eval: 'evaluation',
  funded: 'funded',
  closed: 'closed',
  graduated: 'graduated',
};

export const STATUS_LABEL: Readonly<Record<AccountCardView['status'], string>> = {
  provisioning_pending: 'provisioning',
  active: 'active',
  breached: 'breached',
  expired: 'expired',
  closed_admin: 'closed by Merit',
  closed_chargeback: 'closed after a chargeback',
  graduated: 'graduated',
};

/**
 * Every figure on `AccountCardView`, in the order SC-M4-02 requires.
 *
 * FLOOR DISTANCE IS FIRST AND THAT IS THE REQUIREMENT RATHER THAN A HABIT. M04
 * section 3.1 makes it the one thing the account list must get right, "because
 * it is the number traders actually watch, and it is the number that decides
 * whether they trade tomorrow", and FM-M4-08 makes that a LAYOUT claim: "mobile
 * layout hides the failing gate below the fold ... this is a correctness bug,
 * not a polish item." It is first on the detail screen too, because it does not
 * stop being that number on the screen the trader opened to look at it.
 *
 * THE AS-OF LABEL IS PART OF THIS BLOCK AND NOT OF THE PAGE. `AccountCardView`
 * extends `AccountState`, so each card carries its OWN day: two accounts on one
 * screen can legitimately be as of two different days, because the marks that
 * close a day are per account. A single page-level label would state one day
 * over figures that are as of two, which is INV-M4-02 satisfied in form and
 * broken in substance.
 */
export function AccountFigures(props: { readonly account: AccountCardView }): ReactElement {
  const { account } = props;

  return createElement(
    'div',
    null,
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
