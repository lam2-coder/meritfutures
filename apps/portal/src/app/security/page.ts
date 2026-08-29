// =============================================================================
// apps/portal/src/app/security/page.ts
// =============================================================================
// SC-M4-11's ROUTE. `/security`, and it is the second of the two screens M04
// section 3.1 named that this application did not serve.
//
// THE ROW IT SATISFIES HAD BEEN OWED SINCE BEFORE IT HAD AN ID. `M04:92`:
// "SC-M4-11 records a surface this module had already committed to and never
// gave a row. AS-M4-05 counter 2 says 'the trader sees every active session with
// its creation IP, user agent, and last-seen time, and can revoke any of them',
// and GS-104 asserts a destination change is 'visible in the active-session and
// security views'. Both are commitments in the approved text; neither had a
// screen id, and SD-M4-03 was written in section 2 to serve a screen that
// section 3.1 did not list."
//
// -----------------------------------------------------------------------------
// WHAT THIS PAGE DOES NOT DO
// -----------------------------------------------------------------------------
// IT SERVES NO API PATH AND OPENS NO CONNECTION. ADR-083 section 3, ADR-095
// ruling 3, ADR-162: no `route.ts` in this segment, no `'use server'` anywhere
// in it, and the one `fetch(` in this application is in `src/http/client.ts`.
//
// IT REVOKES NOTHING, AND THAT IS THE ONE THING THIS SCREEN IS FOR. ./source.ts
// carries the measurement and the refusal in full: `POST /sessions/:id/revoke`
// is registered AND wired, and this screen still does not call it. Until
// ADR-219 the reason was that the transport had no verb but GET; that entry
// took the ruling, added `post` and DELIBERATELY WIRED NO PAGE, so what is
// missing here is now a segment slice rather than a transport one. The control
// renders disabled and the screen says so instead of promising a trader they
// have thrown an attacker out.
//
// IT SHOWS NO PASSWORD ROW AND NO RESET LINK. Merit is passwordless in the
// schema (`0002:280`, ADR-039), so there is nothing here to reset.
// ./sections.ts carries that in full and `test/security.test.ts` asserts it.

import type { ReactElement } from 'react';
import { createElement } from 'react';

import { Security, SecurityUnavailable } from './sections.ts';
import { load } from './source.ts';

/**
 * Next.js's own metadata export. The tab title, and nothing else.
 *
 * NO DESCRIPTION AND NO OPEN GRAPH TAGS, which is `app/kyc/page.ts`'s rule:
 * "This is an authenticated screen about one person's identity check; the fewer
 * places its existence is described the better."
 */
export const metadata = {
  title: 'Security',
};

/**
 * Never prerendered, never cached.
 *
 * A STATICALLY RENDERED SESSION LIST IS ONE TRADER'S DEVICES BAKED INTO AN
 * ARTIFACT AND SERVED TO WHOEVER ASKS NEXT, which is FM-M4-03's IDOR arriving
 * through a build step. It is also the screen a trader opens when they suspect
 * their account is compromised, so a cached answer is a stale answer at the one
 * moment staleness is dangerous.
 *
 * `test/route-rendering.test.ts` REQUIRES THIS LINE ON THIS PAGE and derives the
 * requirement rather than listing it: a page must be dynamic exactly when its
 * transitive import closure reaches `src/http/client.ts`, and this one reaches it
 * through ./source.ts.
 */
export const dynamic = 'force-dynamic';

/** `/security`. */
export default async function SecurityPage(): Promise<ReactElement> {
  const loaded = await load();

  return loaded.kind === 'ready'
    ? createElement(Security, { view: loaded.view })
    : createElement(SecurityUnavailable, { missing: loaded.missing });
}
