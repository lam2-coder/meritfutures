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
      view: toKycScreenPlaceholder({ state: { kind: 'error', error: toPortalErrorKind(503) } }),
    });
  }
}
