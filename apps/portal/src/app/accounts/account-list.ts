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
// THE FIGURES THEMSELVES ARE ./figures.ts's AND NOT THIS FILE'S
// -----------------------------------------------------------------------------
// `AccountDetailView extends AccountCardView`, so SC-M4-03's screen is handed
// every field this one is, and a second transcription of the row list would
// drift. `AccountFigures` is that list, once, and it carries the ordering
// requirement and the per-card as-of label with it.

import { createElement } from 'react';
import type { ReactElement } from 'react';

import type { AccountCardView } from '../../view/accounts.ts';
import { AccountFigures } from './figures.ts';

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
  return createElement(
    'article',
    null,
    createElement('h2', null, props.account.plan.name),
    createElement(AccountFigures, { account: props.account }),
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
