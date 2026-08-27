// =============================================================================
// apps/portal/src/app/kyc/page.ts
// =============================================================================
// SC-M4-07 AS A NEXT.JS APP ROUTER PAGE. `/kyc` on the portal origin.
//
// This is the file `CI-07`'s re-ruled artifact names. ADR-095 section 6 moved
// the row's artifact to "a `page`, `layout` or `route` file under
// `apps/*/src/app/`" because the `build` script existed and had nothing to
// build, and this is one of the six segments landing that artifact at once.
//
// -----------------------------------------------------------------------------
// WHAT THIS PAGE DOES NOT DO, AND EACH ABSENCE IS A RULING
// -----------------------------------------------------------------------------
// IT SERVES NO API PATH. ADR-095 ruling 3 and ADR-083 section 3: no route
// handler and no Server Action in this deployable may serve `/api/v1`, any
// operator path, or any surface API_CONTRACT specifies. There is no `route.ts`
// in this segment, no `'use server'` anywhere in it, and `RI-09` reads the path
// as well.
//
// IT PROXIES NO DOCUMENT. ADR-114 clause 6, and `source.ts` carries the two
// enforcement points. What this file adds is the ordering: the payload is
// screened before anything is assembled, so a document-shaped key refuses the
// content rather than reaching a component.
//
// IT OPENS NO CONNECTION AND NEITHER DOES ANY OTHER FILE IN THIS SEGMENT.
// ADR-162 put the one `fetch(` in this application in `src/http/client.ts` and
// `surface.test.ts` fails, by name and line, on a second file that grows one.
// The seam is still `KycScreenSource`; what changed is that its default reads
// `GET /kyc/status` through that client instead of refusing.
//
// IT STARTS NOTHING. `POST /kyc/session` is registered and is a WRITE -- two
// rows in one transaction, per `apps/api/src/routes/kyc.ts` -- and
// `surface.test.ts` asserts "nothing that changes a trader account exists in
// this app". `screen.ts` renders the next-step control with NO HANDLER for
// exactly this reason and this file adds none.
//
// -----------------------------------------------------------------------------
// THE CHROME IS THE LAYOUT'S, SO EVERY FAILURE HERE IS A CONTENT STATE
// -----------------------------------------------------------------------------
// This file rendered the impersonation band and the INV-M4-09 disclosure itself
// until session 250 landed `app/layout.tsx`, and it threw when either was
// unavailable: a page that cannot render a required disclosure must not render.
//
// THE LAYOUT RENDERS BOTH NOW, around every page in this app and outside every
// branch this file can take, so the obligation cannot fail here at all. What is
// left is content, and content fails to a STATE: a status that cannot be read,
// or one that arrives malformed or carrying a screened key, renders the error
// content state inside chrome that is already there.
//
// SO THE PRODUCTION DEPLOYMENT OF THIS PAGE RENDERS AN HONEST ERROR rather than
// dying, which is strictly better than what this file did an hour ago and is
// the wiring rather than a softening: nothing was relaxed, the obligation simply
// moved to a file that cannot skip it.
//
// -----------------------------------------------------------------------------
// THE ERROR KIND IS A MEASUREMENT NOW AND WAS A CONSTANT BEFORE
// -----------------------------------------------------------------------------
// THIS FILE RENDERED `toPortalErrorKind(503)` FOR EVERY FAILURE, which was the
// only honest answer while nothing here could fail for a reason: with no
// transport, every refusal was the same refusal. ADR-162's client maps the
// status the API actually returned, `./source.ts` carries it out on
// `KycStatusUnavailable`, and this file reads it.
//
// THE DIFFERENCE IS A SENTENCE A TRADER CAN ACT ON. A 401 is a session that
// expired and its copy says to sign in again; a 500 is Merit's outage and its
// copy says to try again shortly. Wording the first as the second sends a
// trader who could fix it in five seconds away to wait for nothing.
//
// EVERYTHING THAT IS NOT A MEASURED REFUSAL IS STILL `server_error`, which is
// the same value `toPortalErrorKind(503)` produced, so nothing about the
// screened-payload, malformed-payload or internal-tier-language paths moves.
// Those are defects upstream, the trader can do nothing about any of them, and
// no other member of the vocabulary is true.
//
// -----------------------------------------------------------------------------
// AND EVERY BRANCH OF THIS FUNCTION FAILS CLOSED, WHICH HERE IS COMPLIANCE
// -----------------------------------------------------------------------------
// `apps/api/src/routes/accounts.ts:824` states the posture one deployable over:
// a chain whose head cannot be named "fails closed, because the alternative is
// reporting somebody verified on the strength of an ordering this table does
// not declare."
//
// A KYC SCREEN IS NOT AN ORDINARY READ, and the two wrong answers are wrong in
// different ways. Rendering "verified" for a trader who is not is a statement
// Merit makes about an identity check that did not happen. Rendering NOTHING is
// the failure `screen.ts` and `view/kyc.ts` each already refuse, because a
// blank reads as neither and leaves the trader unable to tell a passed check
// from a broken page. There is exactly one non-`ready` return below, it always
// carries a `ContentState` with copy, and `toKycScreenPlaceholder` cannot be
// handed `ready` because its type excludes it.
// =============================================================================

import type { ReactElement } from 'react';

import type { PortalErrorKind } from '../../shell/app-shell.ts';
import { KycScreen, toKycScreenPlaceholder, toKycScreenView } from './screen.ts';
import { KycStatusUnavailable, currentKycScreenSource, screenKycStatus } from './source.ts';

/**
 * How to word a refusal, from what actually refused.
 *
 * `server_error` IS THE FALLBACK AND IT IS THE VALUE THIS FILE USED TO HARDCODE
 * for everything. Every error that is not a `KycStatusUnavailable` is a defect
 * somebody must fix upstream -- a screened key, a malformed payload, an
 * internal-tier sentence, a source that answers nothing -- and none of them is
 * anything the trader did or can act on.
 *
 * IT ADDS NO MEMBER TO `PortalErrorKind`. ADR-162 clause 3, and
 * `../../shell/app-shell.ts` is where the portal decides how to word a refusal.
 */
function refusalKind(cause: unknown): PortalErrorKind {
  return cause instanceof KycStatusUnavailable ? cause.error : 'server_error';
}

/**
 * Next.js's own metadata export. The tab title, and nothing else.
 *
 * NO DESCRIPTION AND NO OPEN GRAPH TAGS. This is an authenticated screen about
 * one person's identity check; the fewer places its existence is described the
 * better, and a share card for a verification page is not a thing to build.
 */
export const metadata = {
  title: 'Identity verification',
};

/**
 * NEVER STATICALLY GENERATED, AND THIS LINE IS A CONTROL RATHER THAN A HINT.
 *
 * The App Router's default is to prerender a page with no dynamic input, and a
 * prerendered KYC status is one trader's verification state served to every
 * trader from a cache. `M04:25` makes this app identity-scoped everywhere and
 * OVERVIEW section 3 names the portal as the BOLA blast radius; a cached
 * identity-scoped page is that blast radius realised by a build default.
 */
export const dynamic = 'force-dynamic';

/**
 * `/kyc`.
 *
 * ASYNC AND OTHERWISE DOING NOTHING A COMPONENT DOES. Every decision is in
 * `screen.ts`, which is synchronous and pure, so the suite can render the same
 * tree this function returns and read the bytes.
 */
export default async function KycStatusPage(): Promise<ReactElement> {
  const source = currentKycScreenSource();

  try {
    const status = screenKycStatus(await source.status());
    return KycScreen({ view: toKycScreenView({ status }) });
  } catch (cause) {
    // THE REFUSAL IS LOGGED AND THE SCREEN SAYS NOTHING ABOUT IT. Every error
    // reaching here is a defect somebody must fix upstream, and every one of
    // them names key paths, field names or a state token and never a value,
    // which is `ScreenedFieldError`'s stated reason for its own wording.
    console.error('kyc status refused', cause);
    return KycScreen({
      view: toKycScreenPlaceholder({ state: { kind: 'error', error: refusalKind(cause) } }),
    });
  }
}
