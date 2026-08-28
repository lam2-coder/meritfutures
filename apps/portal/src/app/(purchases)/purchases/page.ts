// =============================================================================
// apps/portal/src/app/(purchases)/purchases/page.ts
// =============================================================================
// SC-M4-06 at `/purchases`.
//
// THE ROUTE GROUP `(purchases)` CARRIES NO URL SEGMENT, which is why this file
// serves `/purchases` and its sibling serves `/certificates`. The group is this
// session's one directory under `app/`; the two screens inside it keep the URLs
// they should have rather than one being nested under the other. It is also a
// shape this repository's own tooling already reads: `repo-invariants.mjs`
// RI-09 strips `(group)` and `@slot` segments before deciding what a path
// spells, so the check sees `/purchases` here, exactly as a browser will.
//
// NEITHER FILE IN THIS SEGMENT IS A ROUTE HANDLER OR A SERVER ACTION. There is
// no `route.ts` and no `'use server'` anywhere under it, so nothing here serves
// `/api/v1` or an operator path (ADR-083 section 3, ADR-095 ruling 3). `RI-11`
// in `packages/tooling/checks/ui-server-endpoints.mjs` is the mechanism and it
// reads every compiled file under `apps/`, this one included.
//
// THE SEAM MOVED AND IT IS STILL ONE IMPORT LINE. This page used to import
// `FIXTURE_PORTS` by name, from a file called `fixtures.ts`, over a header that
// said "when the routes land, two import lines move and nothing else in this
// segment does". `GET /purchases` and `GET /plans/:planId/versions/:version` are
// both registered -- ../source.ts has the composition report rather than a grep
// -- and this is that import line moving. ../fixtures.ts is still read by the
// suite and is no longer served to anybody.
//
// -----------------------------------------------------------------------------
// THREE ARMS AND NOT TWO, WHICH IS THE WHOLE OF WHAT THIS FILE DECIDES
// -----------------------------------------------------------------------------
// Only `ready` reaches ../purchases-screen.ts, so an empty history there still
// means one thing: a trader who has bought nothing. What the third arm adds is
// the distinction the payout centre cannot make (ADR-162 section 5 item 1): an
// endpoint that refused is not an endpoint that does not exist yet, and this
// screen says a different sentence for each.
//
// -----------------------------------------------------------------------------
// THE ROUTE IS DYNAMIC AND THAT IS A CORRECTNESS CHOICE
// -----------------------------------------------------------------------------
// M04 section 1.2: the portal stores nothing durable, and "no client-side cache
// of a money number survives a navigation". A statically rendered purchase
// history is one trader's record baked into an artifact and served to whoever
// asks next, which is FM-M4-03's shape arriving through a build step rather than
// through a query. ADR-162 clause 4 already makes every read `no-store`;
// `force-dynamic` says the same thing in the framework's own vocabulary instead
// of leaving it to whichever default the version happens to ship, and it is what
// moves this route from `○ (Static)` to `ƒ (Dynamic)` in the build output.

import { createElement } from 'react';
import type { ReactElement } from 'react';

import { PurchasesScreen } from '../purchases-screen.ts';
import { loadPurchases } from '../source.ts';
import { PurchasesError, PurchasesUnavailable } from '../states.ts';

/** Never prerendered, never cached. See the header. */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Purchases',
};

/** The heading every arm of this screen carries. One string, one screen. */
const HEADING = 'Purchases';

/** The class ../purchases-screen.ts puts on its own `main`, so all three arms match. */
const SCREEN = 'merit-screen-purchases';

export default async function PurchasesPage(): Promise<ReactElement> {
  const loaded = await loadPurchases();

  if (loaded.kind === 'unavailable')
    return createElement(PurchasesUnavailable, {
      heading: HEADING,
      screen: SCREEN,
      missing: loaded.missing,
    });

  if (loaded.kind === 'error')
    return createElement(PurchasesError, {
      heading: HEADING,
      screen: SCREEN,
      error: loaded.error,
    });

  return PurchasesScreen({ model: { history: loaded.history, resets: loaded.resets } });
}
