// =============================================================================
// apps/portal/src/view/timeline.ts
// =============================================================================
// `GET /accounts/:accountId/timeline`, and M04 section 4's obligation against
// it: "Trader-safe subset only. THE PORTAL NEVER RECEIVES detector internals or
// other identities' ids, so it cannot leak them (INV-M4-06)."
//
// -----------------------------------------------------------------------------
// THIS FILE DROPS NOTHING, AND THAT IS THE INVARIANT RATHER THAN A SHORTCUT
// -----------------------------------------------------------------------------
// The tempting shape for a timeline renderer is an allowlist of known `kind`
// values with everything else skipped. It would look defensive and it would be
// the opposite of INV-M4-06.
//
//   THE SUBSETTING IS THE SERVER'S. API_CONTRACT: "Excluded from the trader
//   projection: detector internals, flag evidence, admin reasoning, other
//   identities' ids." Section 1.2's boundary table says it in the general case:
//   "Deciding what a trader may see | API, `scopedDb(identity)` | Authorization
//   is server side. THE PORTAL NOT RENDERING A LINK IS A CONVENIENCE, NEVER A
//   CONTROL."
//
//   SO A CLIENT-SIDE FILTER IS ACTIVELY HARMFUL. If the portal filtered, a
//   leak in the projection would be invisible in the product and would still be
//   in the response body, one devtools tab away. The filter would hide the
//   defect from everyone except the person exploiting it, and it would let the
//   negative-authz suite pass against a broken projection because the screen
//   looked right. A portal that renders everything it is given fails LOUDLY
//   when the server sends something it should not have.
//
//   AND AN UNKNOWN `kind` STILL RENDERS. `summary` is composed server side, so
//   an event type this build has never heard of arrives with its own sentence
//   already written. A renderer that skipped unknown kinds would silently drop
//   the newest thing that happened to the trader's account, which is the one
//   entry they are most likely to be looking for.
//
// -----------------------------------------------------------------------------
// WHAT IT DOES DO
// -----------------------------------------------------------------------------
// One transformation, for one reason: `detail` is an open map of scalars, and
// any key ending `_cents` or `_bp` is money the server put in a bag. Rendering
// that raw would put an unformatted integer number of cents on screen beside
// formatted ones, which is FM-M4-01's "a displayed number disagrees with the
// engine" produced by a unit rather than by a value. So money in `detail` goes
// through ../format/money.ts like money everywhere else, and everything else is
// carried untouched.

import type { TimelineItem } from '../api/types.ts';
import { formatBasisPoints, formatCents } from '../format/money.ts';
import type { AccountState } from './as-of.ts';

/** One detail scalar, after money keys have been formatted. */
export type TimelineDetail = {
  readonly key: string;
  readonly value: string | number | boolean | null;

  /** True when this value went through the money formatter. Lets a renderer align it. */
  readonly is_money: boolean;
};

/** One entry, rendered whole. */
export type TimelineEntryView = {
  readonly occurred_at: string;
  readonly trading_day: string | null;

  /** The event name. Carried even when this build has never seen it. */
  readonly kind: string;

  /** The server's sentence. Never rewritten here (INV-M4-08's reasoning, one surface over). */
  readonly summary: string;
  readonly detail: readonly TimelineDetail[];
};

/** The account timeline. Extends `AccountState`: INV-M4-02. */
export type TimelineView = AccountState & {
  readonly account_id: string;

  /** In the order received. The endpoint is chronological and this file does not sort. */
  readonly entries: readonly TimelineEntryView[];
};

// THESE ARE `endsWith` CALLS AND WERE REGEX LITERALS UNTIL THE CHECK CAUGHT
// THEM. `/_cents$/` reads to test/inv-m4-01.test.ts as a `/` beside a
// money-suffixed identifier, which is the exact shape it hunts. The finding was
// a false positive and the rewrite is still the right resolution: the check has
// no parser, the substitute rule is worth more than the regex was, and a
// suppression comment here would have been the first hole in a control on its
// first working day.
const CENTS = '_cents';
const BASIS_POINTS = '_bp';

function toDetail(key: string, value: string | number | boolean | null): TimelineDetail {
  if (value !== null && typeof value === 'number') {
    if (key.endsWith(CENTS)) return { key, value: formatCents(value), is_money: true };
    if (key.endsWith(BASIS_POINTS)) return { key, value: formatBasisPoints(value), is_money: true };
  }

  // A money-suffixed key carrying a non-number is left exactly as it arrived.
  // The alternative is throwing on a response the server is entitled to send,
  // and a timeline that refuses to render because one detail was a string is a
  // screen that goes blank at the moment something unusual happened.
  return { key, value, is_money: false };
}

function toEntry(item: TimelineItem): TimelineEntryView {
  return {
    occurred_at: item.occurred_at,
    trading_day: item.trading_day,
    kind: item.kind,
    summary: item.summary,
    detail: Object.entries(item.detail).map(([key, value]) => toDetail(key, value)),
  };
}

/**
 * The whole timeline, entry for entry.
 *
 * `entries.length === items.length` IS THE ASSERTION THE SUITE MAKES, and it is
 * INV-M4-06 stated as a number. Every future change to this function has to
 * keep that equality, which is a harder thing to break by accident than a
 * comment saying "do not filter".
 */
export function toTimelineView(
  account_id: string,
  as_of_trading_day: string,
  items: readonly TimelineItem[],
): TimelineView {
  return {
    account_id,
    as_of_trading_day,
    entries: items.map(toEntry),
  };
}
