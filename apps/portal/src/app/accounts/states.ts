// =============================================================================
// apps/portal/src/app/accounts/states.ts
// =============================================================================
// THE TWO SCREENS THAT ARE NOT `ready`, AND WHY THEY ARE TWO AND NOT ONE.
//
// ./source.ts's `AccountListLoad` and `AccountDetailLoad` have three arms.
// ./account-list.ts and ./account-detail.ts render the first. These render the
// other two, and the whole reason they are separate components is that they are
// separate facts:
//
//   `unavailable`  NOTHING FAILED AND NOTHING WAS REFUSED. Either this
//                  deployment has not been told where its API is, or the screen
//                  needs an endpoint `apps/api` does not register yet.
//   `error`        A REGISTERED ENDPOINT REFUSED OR FAILED, and the trader is
//                  told so in the vocabulary ../../shell/app-shell.ts owns.
//
// COLLAPSING THEM WOULD BE THE DEFECT ADR-162 SECTION 5 ITEM 1 REPORTS ON THE
// PAYOUT CENTRE, which has no error arm and therefore renders a 500 exactly as
// a missing endpoint. That entry says the repair "needs `./sections.ts` to
// render it and `./page.ts` to branch on it, and this session's fence holds
// neither". This segment's fence holds both, so the arm is rendered here.
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
// "forbidden", `not_found` says only that the thing was not found, and
// `apps/portal/test/accounts-source.test.ts` asserts the absence over the
// catalogue rather than trusting a reader to notice.
//
// -----------------------------------------------------------------------------
// THE COPY IS THIS SEGMENT'S OWN AND THE DUPLICATION IS REPORTED
// -----------------------------------------------------------------------------
// `app/kyc/copy.ts` holds a `KYC_CONTENT_COPY` of the same shape, written for
// the same union and for the same INV-M4-07 reason. This file does not import
// it: a segment reaching into another segment's copy catalogue couples two
// screens' wording to one edit, and `app/kyc/` is being wired concurrently.
//
// A SHARED CATALOGUE UNDER `src/shell/` IS PROBABLY RIGHT AND IS NOT TAKEN
// HERE, because that directory is outside this session's fence and because the
// second instance of a thing is the wrong moment to generalise it. It is
// reported in the pull request so the third instance is somebody's decision
// rather than somebody's copy and paste.

import { createElement } from 'react';
import type { ReactElement } from 'react';

import type { PortalErrorKind } from '../../shell/app-shell.ts';
import { Row } from './elements.ts';

/**
 * One sentence per member of the error vocabulary.
 *
 * `Record<PortalErrorKind, string>` IS THE MECHANISM. A member added to
 * ../../shell/app-shell.ts and not worded here is `error TS2741`, so this
 * catalogue cannot fall behind the union it words.
 *
 * `unexpected` DOES NOT APOLOGISE FOR A BUG IT CANNOT NAME. ../../shell/
 * app-shell.ts reserves that member for a `403`, "which is FM-M4-10 firing" and
 * is "a rendering bug until proven otherwise and an authorization bug if it is
 * not". The trader can act on neither, so the sentence says what is true and
 * what happens next, and section 9.2's page is where the actual response lives.
 */
export const ACCOUNTS_ERROR_COPY: Readonly<Record<PortalErrorKind, string>> = {
  not_found: 'We could not find that account.',
  unauthenticated: 'Please sign in again to see this.',
  rate_limited: 'That was a lot of requests at once. Try again in a moment.',
  server_error: 'We could not load this just now. Try again shortly.',
  unexpected: 'Something did not go as expected. Try again shortly.',
};

/**
 * The screen is built and the endpoint it needs is not served yet.
 *
 * IT STATES THAT NOTHING FAILED, IN WORDS, because the alternative reading is
 * the one a trader will reach for. A screen that listed endpoint names under a
 * bare heading would be read as a fault report by the only person who cannot
 * tell the difference.
 *
 * THE ENDPOINTS ARE RENDERED AS `Row`s RATHER THAN AS A LIST, which is
 * ./elements.ts's vocabulary and therefore the compliant fixture's: that
 * fixture's body is five element shapes, `.row` with `.label` and `.value` is
 * one of them, and a `<ul>` is not among them.
 */
export function AccountsUnavailable(props: {
  readonly heading: string;
  readonly missing: readonly string[];
}): ReactElement {
  return createElement(
    'main',
    null,
    createElement('h1', null, props.heading),
    createElement(
      'p',
      null,
      'This screen is built and is not connected to the API yet. Nothing has failed and ' +
        'nothing has been refused.',
    ),
    ...props.missing.map((name) =>
      createElement(Row, { key: name, label: 'Waiting on', children: name }),
    ),
  );
}

/**
 * A registered endpoint refused or failed.
 *
 * THE STATUS IS NOT ON THE SCREEN AND THAT IS INV-M4-07 AGAIN. A `404` printed
 * beside "we could not find that account" is the number a stranger would use to
 * tell "no such account" from "not yours", which is exactly what the server's
 * 404 exists to withhold. The status is carried on the load so a later
 * observability slice can report it; it is not trader-facing copy.
 */
export function AccountsError(props: {
  readonly heading: string;
  readonly error: PortalErrorKind;
}): ReactElement {
  return createElement(
    'main',
    null,
    createElement('h1', null, props.heading),
    createElement('p', null, ACCOUNTS_ERROR_COPY[props.error]),
  );
}
