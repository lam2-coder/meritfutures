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
import { loadDetail } from '../source.ts';
import { AccountsError, AccountsUnavailable } from '../states.ts';

/** Never prerendered, never cached. ./../page.ts's header states the argument. */
export const dynamic = 'force-dynamic';

/**
 * The heading every arm of this screen carries.
 *
 * IT IS NOT THE ACCOUNT'S NAME AND IT IS NOT THE ID FROM THE URL. The plan name
 * is on the account response, so it exists on exactly one of the three arms;
 * echoing the route parameter on the other two would put a string a stranger
 * chose into this application's own markup, on the screen INV-M4-07 is about.
 */
const HEADING = 'Account';

/**
 * `/accounts/:account`.
 *
 * `params` IS AWAITED because it is a promise in the App Router from Next 15
 * onward, and this workspace is pinned to `16.3.2` (ADR-095 ruling 1).
 *
 * IT PERFORMS TWO READS AND WAITS ON A THIRD. `GET /accounts/:accountId` and
 * `GET /plans/:planId/versions/:version` are registered and are fetched;
 * `GET /accounts/:accountId/marks` is not registered by `apps/api` on this
 * tree, so ./../source.ts reports it as the endpoint this screen is waiting on
 * and `ready` is unreachable from a browser until it lands. The measurement is
 * in that file's header and it was built rather than grepped.
 *
 * THE 404 ARM IS THE ONE THIS FILE'S HEADER WAS WRITTEN FOR. It said "nothing
 * in this file maps a status to a word, and that is deliberate", and nothing
 * does: `toPortalErrorKind` in ../../../shell/app-shell.ts maps the status
 * inside ADR-162's client, ./../states.ts words the result once, and a
 * cross-trader read reaches the trader as "not found" rather than as anything
 * that confirms the account exists.
 */
export default async function AccountPage(props: {
  readonly params: Promise<{ readonly account: string }>;
}): Promise<ReactElement> {
  const { account } = await props.params;
  const loaded = await loadDetail(account);

  if (loaded.kind === 'unavailable')
    return createElement(AccountsUnavailable, { heading: HEADING, missing: loaded.missing });

  if (loaded.kind === 'error')
    return createElement(AccountsError, { heading: HEADING, error: loaded.error });

  return createElement(AccountDetailScreen, {
    account: toAccountDetail(loaded.detail, loaded.pinned),
    series: toEquitySeries(loaded.detail.account_id, loaded.detail.as_of_trading_day, loaded.marks),
  });
}
