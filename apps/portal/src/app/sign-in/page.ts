// =============================================================================
// apps/portal/src/app/sign-in/page.ts
// =============================================================================
// SC-M4-01's ROUTE. `/sign-in`, and it is the last row of `M04` section 3.1's
// table that this application did not serve.
//
// -----------------------------------------------------------------------------
// THE PATH IS CHOSEN AND THE CORPUS IS SILENT, SO IT IS SAID RATHER THAN IMPLIED
// -----------------------------------------------------------------------------
// No approved document names a portal path for this screen. `M04` section 3.1
// gives screens ids and not routes, and API_CONTRACT's `/auth/*` are the API's
// paths rather than this application's. `/sign-in` is therefore a naming
// decision taken here: it is the words a person uses, and it does not shadow the
// API namespace, which would invite a later reader to expect `/auth` in this app
// to reach the contract's `/auth`. It claims no `SC-M4-nn`, no ADR and no
// ruling, and a founder who prefers another word moves one directory.
//
// -----------------------------------------------------------------------------
// THIS PAGE IS STATIC AND THE OMISSION OF `force-dynamic` IS DELIBERATE
// -----------------------------------------------------------------------------
// EVERY OTHER SCREEN IN THIS APPLICATION CARRIES `export const dynamic =
// 'force-dynamic'` AND THIS ONE MUST NOT, so the absence is argued here rather
// than left to look like the line somebody forgot.
//
// `test/route-rendering.test.ts` DERIVES the requirement instead of listing it:
// "a page is required to be dynamic exactly when its transitive import closure
// inside `src/` reaches `src/http/client.ts`". This page's closure does not. It
// is PRE-IDENTITY by definition, so there is no session to read anything with
// and no trader datum on it to bake into an artifact; that is `app/page.tsx`'s
// position exactly, and its reason applies verbatim: "forcing it dynamic would
// assert a requirement it does not have."
//
// THE SAME TEST IS WHAT STOPS THAT DRIFTING. Its acceptance half pins the number
// of routes whose imports reach the client, so this segment acquiring a client
// import fails that count even before it fails the declaration check, which is
// the direction a guard should fail in.
//
// -----------------------------------------------------------------------------
// WHAT THIS PAGE DOES NOT DO
// -----------------------------------------------------------------------------
// IT SERVES NO API PATH AND OPENS NO CONNECTION. ADR-083 section 3, ADR-095
// ruling 3, ADR-162: no `route.ts` in this segment, no `'use server'` anywhere
// in it, and the one `fetch(` in this application is in `src/http/client.ts`.
//
// IT SIGNS NOBODY IN, AND SAYS SO ON THE SCREEN. Four routes stand behind it,
// all four are registered, and not one is wired; ./availability.ts carries the
// measurement, each blocker quoted, and the reason none of them reaches the
// person reading the page. Delivery is a vendor integration in nobody's fence,
// which is ADR-200's own first sentence about the product's honest state.
//
// IT SHOWS NO PASSWORD FIELD, NO RESET LINK AND NO RECOVERY STEP. `0002` records
// that there is no password table anywhere in the schema by design and ADR-039
// is the ruling. ./sections.ts carries the argument for stating that by shape
// rather than by sentence, and `test/sign-in.test.ts` asserts it.

import type { ReactElement } from 'react';
import { createElement } from 'react';

import { SIGN_IN } from './availability.ts';
import { SignIn } from './sections.ts';

/**
 * Next.js's own metadata export. The tab title, and nothing else.
 *
 * NO DESCRIPTION AND NO OPEN GRAPH TAGS. `app/kyc/page.ts`'s rule is that "the
 * fewer places its existence is described the better", and it was written about
 * an authenticated screen. This one is reachable without a session, which cuts
 * the same way for a different reason: a sign-in page is what a phishing kit
 * copies, and every extra piece of describable chrome is another thing to copy.
 */
export const metadata = {
  title: 'Sign in',
};

/** `/sign-in`. */
export default function SignInPage(): ReactElement {
  return createElement(SignIn, { view: SIGN_IN });
}
