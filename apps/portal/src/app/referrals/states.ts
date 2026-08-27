// =============================================================================
// apps/portal/src/app/referrals/states.ts
// =============================================================================
// THE TWO SCREENS THAT ARE NOT `ready`, AND WHY THEY ARE TWO AND NOT ONE.
//
// ./data.ts's `ReferralScreenLoad` has three arms. ./screen.ts renders the
// first. These render the other two, and the whole reason they are separate
// components is that they are separate facts:
//
//   `unavailable`  NOTHING FAILED AND NOTHING WAS REFUSED. Either this
//                  deployment has not been told where its API is, or a read
//                  this screen needs is served by nothing yet
//   `error`        A REGISTERED ENDPOINT REFUSED OR FAILED, and the affiliate
//                  is told so in the vocabulary ../../shell/app-shell.ts owns
//
// COLLAPSING THEM WOULD BE THE DEFECT ADR-162 SECTION 5 ITEM 1 REPORTS ON THE
// PAYOUT CENTRE, which has no error arm and therefore renders a 500 exactly as
// a missing endpoint.
//
// -----------------------------------------------------------------------------
// AND A THIRD FACT IS RENDERED HERE THAT NEITHER OTHER SEGMENT HAS ONE OF
// -----------------------------------------------------------------------------
// `AccountsUnavailable` one directory over renders one list, "Waiting on", and
// nothing it lists is refused. This screen has a read that IS refused:
// [ADR-168](../../../../../docs/decisions/ADR-168.md) clause 3 ruled
// `GET /affiliate/creatives` out by name, and its foreclosure 7 is that "the
// application named it, therefore it is owed" is the direction that turns a
// portal's prose into Merit's scope.
//
// SO THE TWO LISTS ARE RENDERED UNDER DIFFERENT WORDS, IN THE ONE PLACE A
// READER MEETS BOTH AT ONCE. "Waiting on" is a promise that something is
// coming. "Not served" is a decision, and it carries the entry that took it so
// a reader who disagrees has somewhere to go. A screen that put the refused
// read under "Waiting on" would be this application quietly reopening a ruling
// by wording, which is the same move `INV-M4-07` forbids one paragraph down and
// the same move session 158's rule forbids in `surface.test.ts`.
//
// -----------------------------------------------------------------------------
// INV-M4-07: THIS FILE WORDS A REFUSAL AND MAY NOT WORD IT AS A REFUSAL OF
// PERMISSION
// -----------------------------------------------------------------------------
//   "Cross-trader resource access returns 404, and the portal renders it as
//   'not found', NOT 'forbidden' ... existence is not confirmed to a stranger,
//   AND THE UI MUST NOT UNDO THAT BY WORDING."
//
// `PortalErrorKind` has no `forbidden` member for that reason, and a copy
// catalogue is exactly where the type's refusal gets reinstated by a sentence.
// So no string below says "not allowed", "no permission", "denied" or
// "forbidden", and `apps/portal/test/referrals-source.test.ts` asserts the
// absence over the catalogue rather than trusting a reader to notice.
//
// -----------------------------------------------------------------------------
// THIS IS THE THIRD CATALOGUE OF THIS SHAPE AND THAT IS REPORTED RATHER THAN
// RESOLVED
// -----------------------------------------------------------------------------
// `app/kyc/copy.ts` was the first and `app/accounts/states.ts` was the second,
// and that file said what to do about a third: "A SHARED CATALOGUE UNDER
// `src/shell/` IS PROBABLY RIGHT AND IS NOT TAKEN HERE, because that directory
// is outside this session's fence and because the second instance of a thing is
// the wrong moment to generalise it. It is reported in the pull request so the
// third instance is somebody's decision rather than somebody's copy and paste."
//
// THE THIRD INSTANCE IS THIS FILE AND `src/shell/` IS OUTSIDE THIS FENCE TOO.
// It is not imported from either sibling: a segment reaching into another
// segment's copy catalogue couples two screens' wording to one edit. So the
// moment that comment asked for has arrived and is reported in the pull
// request, and nothing is generalised in a session that may not hold the file
// the generalisation belongs in.

import { createElement } from 'react';
import type { ReactElement } from 'react';

import type { PortalErrorKind } from '../../shell/app-shell.ts';
import type { PendingRead, RefusedRead } from './data.ts';

/**
 * One sentence per member of the error vocabulary.
 *
 * `Record<PortalErrorKind, string>` IS THE MECHANISM. A member added to
 * ../../shell/app-shell.ts and not worded here is `error TS2741`, so this
 * catalogue cannot fall behind the union it words.
 *
 * `not_found` IS WORDED FOR THIS SCREEN AND NOT FOR AN ACCOUNT. The only thing
 * a 404 on `GET /affiliate/stats` can mean to the person reading it is that
 * Merit has no referral record for them, and the sentence says that without
 * saying whether one exists for anybody else.
 *
 * `unexpected` DOES NOT APOLOGISE FOR A BUG IT CANNOT NAME. ../../shell/
 * app-shell.ts reserves that member for a `403`, "which is FM-M4-10 firing" and
 * is "a rendering bug until proven otherwise and an authorization bug if it is
 * not". The affiliate can act on neither.
 */
export const REFERRALS_ERROR_COPY: Readonly<Record<PortalErrorKind, string>> = {
  not_found: 'We could not find a referral record for you.',
  unauthenticated: 'Please sign in again to see this.',
  rate_limited: 'That was a lot of requests at once. Try again in a moment.',
  server_error: 'We could not load this just now. Try again shortly.',
  unexpected: 'Something did not go as expected. Try again shortly.',
};

/** One labelled row. ./screen.ts's `fact`, without the figure styling. */
function row(label: string, value: string): ReactElement {
  return createElement(
    'div',
    { className: 'mf-referrals__fact', key: `${label}:${value}` },
    createElement('dt', null, label),
    createElement('dd', null, value),
  );
}

/**
 * The screen is built and a read it needs is not served yet.
 *
 * IT STATES THAT NOTHING FAILED, IN WORDS, because the alternative reading is
 * the one an affiliate will reach for. A screen that listed read names under a
 * bare heading would be read as a fault report by the only person who cannot
 * tell the difference.
 *
 * THE REFUSED LIST IS A REQUIRED PROP AND MAY BE EMPTY, AND AN EMPTY ONE
 * RENDERS NOTHING. It is passed in rather than imported so this component
 * renders exactly what the page decided to say, it is required so a caller
 * cannot drop the fact by forgetting it, and it is typed `RefusedRead[]` so a
 * `PendingRead` cannot arrive in the slot that words a decision as final. A
 * heading over no rows is a sentence a reader has to interpret, so there is
 * none.
 */
export function ReferralsUnavailable(props: {
  readonly heading: string;
  readonly missing: readonly PendingRead[];
  readonly refused: readonly RefusedRead[];
}): ReactElement {
  return createElement(
    'main',
    null,
    createElement('h1', null, props.heading),
    createElement(
      'p',
      null,
      'This screen is built and is not connected to the API yet. Nothing has failed.',
    ),
    createElement('dl', null, ...props.missing.map((pending) => row('Waiting on', pending.read))),
    props.refused.length === 0
      ? null
      : createElement(
          'section',
          { 'aria-label': 'Not served' },
          createElement(
            'p',
            null,
            'These are decided rather than pending. Merit does not serve them and is not ' +
              'building them.',
          ),
          createElement(
            'dl',
            null,
            ...props.refused.map((refused) =>
              row('Not served', `${refused.read} (${refused.ruling})`),
            ),
          ),
        ),
  );
}

/**
 * A registered endpoint refused or failed.
 *
 * THE STATUS IS NOT ON THE SCREEN AND THAT IS INV-M4-07. A number printed
 * beside "we could not find a referral record for you" is what tells a stranger
 * "no such record" from "not yours", which is exactly what the server's 404
 * exists to withhold. The status is carried on the load so a later
 * observability slice can report it; it is not affiliate-facing copy.
 */
export function ReferralsError(props: {
  readonly heading: string;
  readonly error: PortalErrorKind;
}): ReactElement {
  return createElement(
    'main',
    null,
    createElement('h1', null, props.heading),
    createElement('p', null, REFERRALS_ERROR_COPY[props.error]),
  );
}
