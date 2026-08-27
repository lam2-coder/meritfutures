// =============================================================================
// apps/portal/src/app/accounts/page.ts
// =============================================================================
// SC-M4-02's ROUTE. `/accounts` on the portal origin.
//
// -----------------------------------------------------------------------------
// A `page.ts` IS A PAGE, MEASURED RATHER THAN ASSUMED
// -----------------------------------------------------------------------------
// `next@16.3.2`'s default `pageExtensions` is `["tsx","ts","jsx","js"]`, read
// out of the installed package's own `defaultConfig` rather than remembered.
// So this segment renders through the App Router without a `.tsx` anywhere, and
// therefore without the `jsx` compiler option that ADR-095 F7 assigns to
// whoever writes the first page and the root layout. `createElement` is what
// JSX compiles to; the tree is identical.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE IS NOT ALLOWED TO BE
// -----------------------------------------------------------------------------
// NOT A ROUTE HANDLER AND NOT A SERVER ACTION SERVING THE API. ADR-083 ruling 1
// and ADR-095 ruling 3: the API is its own deployable, on API_CONTRACT section
// 1's "no privileged back door", and a surface that CONTAINS the API has one by
// construction. `RI-09` refuses the path shape mechanically; this file is on
// the right side of it because `/accounts` is a SCREEN and the data comes from
// the API over the network like any other client's.
//
// NOT A READER OF `packages/db`. ADR-095 F4 is the half of that boundary
// nothing enforces: a server component runs on the server and may import the
// database directly, and `merit/no-raw-db-client` bans a raw client import
// while saying nothing about `scopedDb`. This segment imports ../../view and
// ../../api/types and nothing else, and `ports.ts` is the only seam it has to
// anything outside the application.
//
// -----------------------------------------------------------------------------
// THE ROUTE IS DYNAMIC AND THAT IS A CORRECTNESS CHOICE
// -----------------------------------------------------------------------------
// M04 section 1.2: the portal stores nothing durable, and "no client-side cache
// of a money number survives a navigation". A statically rendered account list
// is one trader's balances baked into an artifact and served to whoever asks
// next, which is FM-M4-03's shape arriving through a build step rather than
// through a query. `force-dynamic` says so in the framework's own vocabulary
// instead of leaving it to whichever default the version happens to ship.

import { createElement } from 'react';
import type { ReactElement } from 'react';

import { toAccountList } from '../../view/accounts.ts';
import { AccountListScreen } from './account-list.ts';
import { accountsSource } from './ports.ts';

/** Never prerendered, never cached. See the header. */
export const dynamic = 'force-dynamic';

/**
 * `/accounts`.
 *
 * IT THROWS TODAY, and the throw is `AccountsSourceNotWiredError` from
 * ./ports.ts rather than anything this file decides. The portal has screens and
 * no transport, and ./ports.ts states why a rendering session is not the one to
 * write the client. The alternative, a page that caught the absence and drew an
 * empty list, would render a trader who holds no accounts and a portal that
 * cannot reach the API as the same screen.
 */
export default async function AccountsPage(): Promise<ReactElement> {
  const { accounts } = await accountsSource().list();
  return createElement(AccountListScreen, { accounts: toAccountList(accounts) });
}
