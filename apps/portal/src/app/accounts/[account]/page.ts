// =============================================================================
// apps/portal/src/app/accounts/[account]/page.ts
// =============================================================================
// SC-M4-03's ROUTE. `/accounts/:account` on the portal origin, the account
// detail and the equity chart, which M04 section 3.1 rows as one screen.
//
// -----------------------------------------------------------------------------
// THREE READS COMPOSE INTO ONE SCREEN, AND TWO OF THE THREE ARE NOT OBVIOUS
// -----------------------------------------------------------------------------
// The account detail is the one a reader expects. The other two are forced by
// the view models rather than chosen here, and ./../ports.ts records both:
//
//   `toEquitySeries` takes `as_of_trading_day` as an ARGUMENT because the marks
//   endpoint is cursor paginated, so the chart's label comes from the ACCOUNT
//   response and never from the marks page it draws.
//
//   `toAccountDetail` takes `PinnedPlanCopy` as a REQUIRED argument on both
//   branches, so the pinned plan version's `copy_blocks` is a precondition of
//   the screen and not of the eval case alone. Section 3.4 placement 2 is why:
//   the ruling has to be on the eval card, so a card that could be built
//   without it is a card that renders without it.
//
// -----------------------------------------------------------------------------
// INV-M4-07 IS THE SERVER'S AND THE WORDING IS THIS SURFACE'S
// -----------------------------------------------------------------------------
//   "Cross-trader resource access returns 404, and the portal renders it as
//   'not found', NOT 'forbidden' ... existence is not confirmed to a stranger,
//   AND THE UI MUST NOT UNDO THAT BY WORDING."
//
// Nothing in this file maps a status to a word, and that is deliberate:
// ../../../shell/app-shell.ts owns the vocabulary, has no `forbidden` member
// for a 404 to be mapped onto, and `toPortalErrorKind` is the one place a
// status becomes a state. A page that caught its own errors would be a second
// place, and a second place is where the two eventually disagree.

import { createElement } from 'react';
import type { ReactElement } from 'react';

import { toAccountDetail } from '../../../view/accounts.ts';
import { toEquitySeries } from '../../../view/marks.ts';
import { AccountDetailScreen } from '../account-detail.ts';
import { accountsSource } from '../ports.ts';

/** Never prerendered, never cached. ./../page.ts's header states the argument. */
export const dynamic = 'force-dynamic';

/**
 * `/accounts/:account`.
 *
 * `params` IS AWAITED because it is a promise in the App Router from Next 15
 * onward, and this workspace is pinned to `16.3.2` (ADR-095 ruling 1).
 *
 * IT THROWS TODAY, for ./../page.ts's reason and with the same error.
 */
export default async function AccountPage(props: {
  readonly params: Promise<{ readonly account: string }>;
}): Promise<ReactElement> {
  const { account } = await props.params;
  const data = await accountsSource().detail(account);

  return createElement(AccountDetailScreen, {
    account: toAccountDetail(data.detail, data.pinned),
    series: toEquitySeries(data.detail.account_id, data.detail.as_of_trading_day, data.marks),
  });
}
