// =============================================================================
// apps/portal/src/app/(purchases)/states.ts
// =============================================================================
// THE TWO SCREENS THAT ARE NOT `ready`, AND WHY THEY ARE TWO AND NOT ONE.
//
// ./source.ts's `PurchasesLoad` and `CertificatesLoad` have three arms.
// ./purchases-screen.ts and ./certificates-screen.ts render the first. These
// render the other two, and the whole reason they are separate components is
// that they are separate facts:
//
//   `unavailable`  NOTHING FAILED AND NOTHING WAS REFUSED. Either this
//                  deployment has not been told where its API is, or a read the
//                  screen needs has no source this application can use.
//   `error`        A REGISTERED ENDPOINT REFUSED OR FAILED, and the trader is
//                  told so in the vocabulary ../../shell/app-shell.ts owns.
//
// COLLAPSING THEM WOULD BE THE DEFECT ADR-162 SECTION 5 ITEM 1 REPORTS ON THE
// PAYOUT CENTRE, which has no error arm and therefore renders a 500 exactly as a
// missing endpoint. ../accounts/states.ts is this file's shape and its header
// carries the same paragraph; the duplication is reported in the pull request
// rather than resolved by reaching into `src/shell/`, which this fence does not
// hold, and because the second and third instances of a thing are the wrong
// moment to generalise it.
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
// "forbidden", and `apps/portal/test/purchases-source.test.ts` asserts the
// absence over the catalogue rather than trusting a reader to notice.
//
// -----------------------------------------------------------------------------
// AND ON SC-M4-08 THE CERTIFICATE DISCLOSURE BOUNDARY BINDS THESE STATES TOO
// -----------------------------------------------------------------------------
// INV-M11-01 and AS-M4-03 rule 3 are written as absences -- "no identity, no
// email, no display name, no cumulative total, no lifetime figure" -- and
// ./model.ts's allowlist is the control for the `ready` arm only. A state
// component is a second way onto the same page, and an endpoint path carrying an
// account id, or an error sentence quoting a response, would put a value onto
// SC-M4-08 past every assertion written about a card. NOTHING BELOW INTERPOLATES
// A RESPONSE, A ROUTE PARAMETER OR AN IDENTIFIER: the `unavailable` arm renders
// the read as its own document spells it, `:accountId` and all, and the `error`
// arm renders one of five fixed sentences.

import { createElement as h } from 'react';
import type { ReactElement } from 'react';

import type { PortalErrorKind } from '../../shell/app-shell.ts';
import type { PendingRead } from './source.ts';

/**
 * One sentence per member of the error vocabulary.
 *
 * `Record<PortalErrorKind, string>` IS THE MECHANISM. A member added to
 * ../../shell/app-shell.ts and not worded here is `error TS2741`, so this
 * catalogue cannot fall behind the union it words.
 *
 * `not_found` SAYS ONLY THAT THE THING WAS NOT FOUND. On these two screens the
 * 404 a trader can actually reach is a purchase or a certificate that is not
 * theirs, and INV-M4-07 is explicit that the portal renders that as not found
 * rather than as a refusal of permission.
 *
 * `unexpected` DOES NOT APOLOGISE FOR A BUG IT CANNOT NAME. ../../shell/
 * app-shell.ts reserves that member for a `403`, "which is FM-M4-10 firing" and
 * is "a rendering bug until proven otherwise and an authorization bug if it is
 * not". The trader can act on neither.
 */
export const PURCHASES_ERROR_COPY: Readonly<Record<PortalErrorKind, string>> = {
  not_found: 'We could not find that.',
  unauthenticated: 'Please sign in again to see this.',
  rate_limited: 'That was a lot of requests at once. Try again in a moment.',
  server_error: 'We could not load this just now. Try again shortly.',
  unexpected: 'Something did not go as expected. Try again shortly.',
};

/**
 * One sentence per reason a read was not made.
 *
 * `Record<PendingRead['why'], string>` FOR `PURCHASES_ERROR_COPY`'S REASON. A
 * third `why` was added to that union in ./source.ts this session and a
 * catalogue that could fall behind it would render a blank beside a read name,
 * which reads as a fault rather than as a state.
 *
 * NONE OF THE THREE SAYS ANYTHING FAILED, because none of them did.
 */
export const PENDING_READ_COPY: Readonly<Record<PendingRead['why'], string>> = {
  no_api_origin: 'This deployment has not been told where the API is.',
  nothing_serves_it: 'No endpoint serves this yet.',
  no_transcription: 'The endpoint exists and this screen cannot read its answer yet.',
};

/**
 * The screen is built and a read it needs did not happen.
 *
 * IT STATES THAT NOTHING FAILED, IN WORDS, because the alternative reading is
 * the one a trader will reach for. A screen that listed endpoint names under a
 * bare heading would be read as a fault report by the only person who cannot
 * tell the difference.
 *
 * THE READS ARE RENDERED AS `dt`/`dd` PAIRS, which is ./certificates-screen.ts's
 * vocabulary in this segment and reflows at 375px with no stylesheet, which is
 * that file's stated constraint and is unchanged here.
 */
export function PurchasesUnavailable(props: {
  readonly heading: string;
  readonly screen: string;
  readonly missing: readonly PendingRead[];
}): ReactElement {
  return h(
    'main',
    { className: `merit-screen ${props.screen}` },
    h('h1', null, props.heading),
    h(
      'p',
      { className: 'merit-note' },
      'This screen is built and is not connected to the API yet. Nothing has failed and ' +
        'nothing has been refused.',
    ),
    h(
      'dl',
      { className: 'merit-waiting' },
      ...props.missing.flatMap((read) => [
        h('dt', { key: `${read.read}-t`, className: 'merit-fact-label' }, 'Waiting on'),
        h(
          'dd',
          { key: `${read.read}-d`, className: 'merit-fact-value' },
          `${read.read}. ${PENDING_READ_COPY[read.why]}`,
        ),
      ]),
    ),
  );
}

/**
 * A registered endpoint refused or failed.
 *
 * THE STATUS IS NOT ON THE SCREEN AND THAT IS INV-M4-07 AGAIN. A `404` printed
 * beside "we could not find that" is the number a stranger would use to tell "no
 * such thing" from "not yours", which is exactly what the server's 404 exists to
 * withhold. ./source.ts carries the status on the load so a later observability
 * slice can report it; it is not trader-facing copy.
 */
export function PurchasesError(props: {
  readonly heading: string;
  readonly screen: string;
  readonly error: PortalErrorKind;
}): ReactElement {
  return h(
    'main',
    { className: `merit-screen ${props.screen}` },
    h('h1', null, props.heading),
    h('p', { className: 'merit-error' }, PURCHASES_ERROR_COPY[props.error]),
  );
}
