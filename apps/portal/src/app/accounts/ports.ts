// =============================================================================
// apps/portal/src/app/accounts/ports.ts
// =============================================================================
// WHAT THIS SEGMENT NEEDS IN ORDER TO RENDER, DECLARED IN ONE PLACE.
//
// -----------------------------------------------------------------------------
// THE PORT IS GONE BECAUSE THE THING IT WAS WAITING FOR ARRIVED
// -----------------------------------------------------------------------------
// This file used to declare an `AccountsSource` interface, an
// `AccountsSourceNotWiredError` and an `accountsSource()` that threw it, under
// a header that said: "This session is not that decision ... a client authored
// here would be typed against a handler nobody has read", and, of the throwing
// function, "WHOEVER WIRES THE PORTAL OWNS REPLACING THIS FUNCTION AND NOTHING
// ELSE IN THIS SEGMENT."
//
// ADR-162 IS THAT DECISION AND ./source.ts IS THAT REPLACEMENT. The three are
// removed rather than left standing beside it, and the removal is the narrower
// of the two moves available:
//
//   `AccountsSource` DECLARED TWO METHODS THAT RETURN DATA OR THROW, and that
//   shape cannot express what this segment now knows. Three of its four
//   endpoints are registered and one is not (./source.ts's header has the
//   measurement), so the detail screen's honest answer today is "waiting on
//   `GET /accounts/:accountId/marks`", which is neither a value nor an
//   exception. A port left in place that nothing implements is not a fence; it
//   is a second description of the seam that no longer agrees with the first.
//
//   THE THROW WAS THE CONTROL AND IT IS REPLACED BY A STRONGER ONE RATHER THAN
//   DELETED. Its argument was that "an unwired portal that rendered an empty
//   account list would be indistinguishable, on screen, from a trader who holds
//   no accounts", and that argument is intact: `AccountListLoad` has three arms
//   and only the `ready` one reaches ./account-list.ts, so a zero-length list
//   still carries exactly one meaning. What changed is that the distinction is
//   now made by a type the compiler checks at every call site instead of by an
//   exception at one.
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
//
// THE SECOND ROUND TRIP WAS DISCOVERED EXACTLY AS PREDICTED AND IS NOW WRITTEN
// DOWN IN CODE. `loadDetailFrom` in ./source.ts performs the account read and
// then the plan read, sequentially, because both of the plan path's parameters
// arrive on the account response.

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
