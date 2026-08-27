// =============================================================================
// apps/portal/src/app/accounts/ports.ts
// =============================================================================
// WHAT THIS SEGMENT NEEDS IN ORDER TO RENDER, DECLARED AS A PORT AND NOT BUILT.
//
// -----------------------------------------------------------------------------
// THERE IS NO CLIENT HERE AND WRITING ONE WOULD HAVE BEEN THE ERROR
// -----------------------------------------------------------------------------
// `apps/portal/test/surface.test.ts` asserts that "no source file in this app
// performs a network call", walking every `.ts` under `src/` for `fetch(`,
// `XMLHttpRequest`, `WebSocket` and `EventSource`, and says why: "a read surface
// with no transport is deliberate ... asserting it now means the first `fetch`
// written here is a decision somebody makes on purpose rather than one that
// appears in a diff."
//
// This session is not that decision. Two of the four routes below are being
// written concurrently, so a client authored here would be typed against a
// handler nobody has read, and the first thing it would do on landing is
// disagree with it. What a rendering session can honestly contribute is the
// EXACT LIST of what the screens consume, which is this file, plus screens that
// are already correct against it.
//
// -----------------------------------------------------------------------------
// FOUR ROUTES, AND THE THIRD AND FOURTH ARE THE ONES A READER WILL MISS
// -----------------------------------------------------------------------------
// The obvious two are the account list and the account detail. The other two
// are consequences of the view models rather than of the screens, and both are
// load bearing:
//
//   THE MARKS ROUTE CANNOT LABEL ITS OWN CHART. `toEquitySeries` takes
//   `as_of_trading_day` as an ARGUMENT, because the marks endpoint is cursor
//   paginated and "the newest row in THIS PAGE is the newest row the client
//   happens to hold". So the equity chart on the detail screen is a composition
//   of the marks response and the ACCOUNT response, and a caller that fetched
//   only the marks would put a stale date on the chart, quietly.
//
//   THE EVAL CARD CANNOT BE BUILT WITHOUT THE PINNED PLAN VERSION.
//   `toAccountDetail(detail, pinned)` takes `PinnedPlanCopy` as a REQUIRED
//   argument on both branches even though only the eval branch reads it, so the
//   detail screen needs `copy_blocks` from `GET /plans/:planId/versions/:version`
//   as well. `AccountDetail.plan` carries `plan_id` and `version`, so both path
//   parameters are on the account response and the composition is answerable.
//   It is a SECOND ROUND TRIP and no document says so, which is worth stating
//   once here rather than being discovered by whoever wires it.

import type { AccountDetail, AccountListItem, MarkListItem } from '../../api/types.ts';
import type { PinnedPlanCopy } from '../../copy/copy-block.ts';

/** Everything ./page.ts renders. One route. */
export type AccountListData = {
  readonly accounts: readonly AccountListItem[];
};

/**
 * Everything `./[account]/page.ts` renders. Three routes, composed.
 *
 * `marks` ARRIVES NEWEST FIRST, exactly as the endpoint sends it. The reversal
 * is `toEquitySeries`'s and is the only transformation applied to the data, so
 * a source that helpfully sorted here would be doing the one thing
 * ../../view/marks.ts reserves for itself.
 */
export type AccountDetailData = {
  readonly detail: AccountDetail;
  readonly pinned: PinnedPlanCopy;
  readonly marks: readonly MarkListItem[];
};

/**
 * The reads this segment performs, as an interface it does not implement.
 *
 * IT IS DELIBERATELY NOT A `fetch` WRAPPER. What goes behind it is a transport
 * decision with an origin, a session cookie, a cache posture and a failure
 * vocabulary, none of which is a rendering session's, and the shape above is
 * the only part of it these screens actually constrain.
 */
export type AccountsSource = {
  readonly list: () => Promise<AccountListData>;
  readonly detail: (account: string) => Promise<AccountDetailData>;
};

/**
 * The segment has screens and no transport.
 *
 * IT THROWS RATHER THAN RENDERING A PLACEHOLDER, which is the idiom this
 * application already uses in three places: `MissingCopyBlockError`,
 * `MissingDisclosureError` and `UnverifiableCertificateError` all refuse rather
 * than render an empty space, on ../../copy/copy-block.ts's argument that "a
 * null would be rendered as an empty space by every caller that forgot to
 * handle it".
 *
 * A PLACEHOLDER SCREEN IS THE PARTICULAR FAILURE HERE. An unwired portal that
 * rendered an empty account list would be indistinguishable, on screen, from a
 * trader who holds no accounts, which is the exact confusion
 * ../../shell/app-shell.ts refuses when it makes `empty` a state rather than a
 * zero-length `ready`.
 */
export class AccountsSourceNotWiredError extends Error {
  constructor() {
    super(
      'apps/portal has no transport. The accounts segment renders from an ' +
        '`AccountsSource` (apps/portal/src/app/accounts/ports.ts) and nothing ' +
        'in this application constructs one: `surface.test.ts` asserts that no ' +
        'source file here performs a network call, so the client is a decision ' +
        'somebody makes on purpose rather than one that appears in a diff. Four ' +
        "reads are needed: the account list, the account detail, that account's " +
        'marks page, and the pinned plan version whose `copy_blocks` the eval ' +
        'card cannot be constructed without.',
    );
    this.name = 'AccountsSourceNotWiredError';
  }
}

/**
 * The composition root, which does not exist yet.
 *
 * WHOEVER WIRES THE PORTAL OWNS REPLACING THIS FUNCTION AND NOTHING ELSE IN
 * THIS SEGMENT. The screens take view models, the view models take wire shapes,
 * and both are already correct; this is the single seam between them and the
 * network. That is the whole reason it is a function rather than an import: a
 * module-level constant would have had to be built at import time, and there is
 * nothing to build it from.
 */
export function accountsSource(): AccountsSource {
  throw new AccountsSourceNotWiredError();
}
