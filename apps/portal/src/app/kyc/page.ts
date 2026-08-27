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
// IT OPENS NO CONNECTION. There is no transport in this application and
// `surface.test.ts` asserts that no source file here performs a network call.
// The seam is `KycScreenSource`, whose production value refuses every method.
//
// -----------------------------------------------------------------------------
// THE TWO LEGS FAIL IN DIFFERENT DIRECTIONS, WHICH IS THE WHOLE OF THIS FILE
// -----------------------------------------------------------------------------
// THE CHROME FAILS THE PAGE. The impersonation band (ADR-068 requirement 4,
// through M04 section 3.9) and the simulated-environment disclosure
// (INV-M4-09, constitution section 6) are properties of the shell, required on
// every screen and on every error, empty and loading state. A page that
// rendered without them would be a compliance obligation failing silently,
// which is the only way that obligation fails, so an unavailable chrome leg
// throws and no document is produced.
//
// THE CONTENT FAILS TO A STATE. A status that cannot be read, or one that
// arrives malformed or carrying a screened key, renders the error content state
// inside intact chrome. That is `ContentState`'s reason for existing, and it is
// also the second line of the no-proxy defence: the refusal path renders a
// screen with no field of that payload anywhere on it.
//
// SO THE PRODUCTION DEPLOYMENT OF THIS PAGE THROWS TODAY, and that is stated
// rather than smoothed over. `UNWIRED_KYC_SCREEN_SOURCE` refuses `disclosure()`
// first, and a portal that cannot render a required disclosure must not render
// the screen it belongs on. It is `routes/kyc.ts`'s "a deployment that cannot
// store a payload does not verify one", one deployable over.
// =============================================================================

import type { ReactElement } from 'react';

import { toPortalErrorKind } from '../../shell/app-shell.ts';
import { KycScreen, toKycScreenPlaceholder, toKycScreenView } from './screen.ts';
import { currentKycScreenSource, screenKycStatus } from './source.ts';

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

  // THE CHROME FIRST, AND UNCAUGHT. See the header: an obligation that cannot
  // be met does not render.
  const disclosure = await source.disclosure();
  const impersonation = await source.impersonation();

  try {
    const status = screenKycStatus(await source.status());
    return KycScreen({ view: toKycScreenView({ status, impersonation, disclosure }) });
  } catch (cause) {
    // THE REFUSAL IS LOGGED AND THE SCREEN SAYS NOTHING ABOUT IT. Every error
    // reaching here is a defect somebody must fix upstream, and every one of
    // them names key paths, field names or a state token and never a value,
    // which is `ScreenedFieldError`'s stated reason for its own wording.
    console.error('kyc status refused', cause);
    return KycScreen({
      view: toKycScreenPlaceholder({
        content: { kind: 'error', error: toPortalErrorKind(503) },
        impersonation,
        disclosure,
      }),
    });
  }
}
