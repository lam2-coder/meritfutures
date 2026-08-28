// =============================================================================
// apps/portal/src/app/wallet/page.ts
// =============================================================================
// SC-M4-10's ROUTE. `/wallet`, the Merit Wallet, and it is one of the two
// screens M04 section 3.1 named that this application did not serve.
//
// MEASURED FROM THE BUILD RATHER THAN FROM THE PLAN. `pnpm --filter
// @merit/portal build` printed TWELVE routes before this session -- `/`,
// `/_not-found`, `/accounts`, `/accounts/[account]`, `/calendar`,
// `/calendar/[accountId]/rules`, `/calendar/[accountId]/timeline`,
// `/certificates`, `/kyc`, `/payouts`, `/purchases`, `/referrals` -- covering
// `SC-M4-02` through `SC-M4-09` and neither `SC-M4-10` nor `SC-M4-11`. Session
// 368 reached the same count from the other direction and rowed the three
// missing screens as `SC-M4-01`, `SC-M4-10` and `SC-M4-11`.
//
// -----------------------------------------------------------------------------
// WHAT THIS PAGE DOES NOT DO, AND EACH ABSENCE IS A RULING
// -----------------------------------------------------------------------------
// IT SERVES NO API PATH. ADR-083 section 3 and ADR-095 ruling 3: no route
// handler and no Server Action in this deployable may serve `/api/v1`, any
// operator path, or any surface API_CONTRACT specifies. There is no `route.ts`
// in this segment and no `'use server'` anywhere in it.
//
// IT MOVES NO MONEY. `POST /wallet/withdrawals` is registered -- measured in the
// same `CompositionReport` that confirmed the two reads -- and it is a WRITE,
// it is one of the three sensitive actions C-27 names, and `test/surface.test.ts`
// asserts that "nothing that changes a trader account exists in this app". Both
// exits on this screen render their control with NO HANDLER and a `submits_to`
// typed as the literal `null`, so wiring one is a type change a reviewer reads
// rather than a handler that appears in a diff.
//
// IT OPENS NO CONNECTION. ADR-162 put the one `fetch(` in this application in
// `src/http/client.ts` and `surface.test.ts` fails, by name and line, on a
// second file that grows one.
//
// -----------------------------------------------------------------------------
// AND IT FAILS TO A SCREEN THAT NEVER SHOWS A NUMBER IT DID NOT RECEIVE
// -----------------------------------------------------------------------------
// `app/kyc/page.ts` states the posture for a screen whose two wrong answers are
// wrong in different ways, and a wallet has the same asymmetry in a sharper
// form. Rendering a balance the server did not send is the worst statement this
// application can make; rendering nothing leaves a trader unable to tell an
// empty wallet from a broken page. So `./sections.ts` has exactly two arms, the
// unavailable one carries no figure at all and says the balance is unaffected,
// and an empty statement renders as "no activity yet" rather than as a fault --
// which is API_CONTRACT section 6.2's own ruling that "an identity with no
// `wallet_entries` row is `0` and not a `404`".

import type { ReactElement } from 'react';
import { createElement } from 'react';

import { walletFraming } from '../../view/wallet.ts';
import { Wallet, WalletUnavailable } from './sections.ts';
import { load } from './source.ts';

/**
 * Next.js's own metadata export. The tab title, and nothing else.
 *
 * NO DESCRIPTION AND NO OPEN GRAPH TAGS, which is `app/kyc/page.ts`'s rule and
 * is stronger here: this is an authenticated screen showing one person's money,
 * and a share card for a wallet is not a thing to build.
 */
export const metadata = {
  title: 'Merit Wallet',
};

/**
 * Never prerendered, never cached.
 *
 * A STATICALLY RENDERED WALLET IS ONE TRADER'S BALANCE BAKED INTO AN ARTIFACT
 * AND SERVED TO WHOEVER ASKS NEXT. `app/accounts/page.ts` wrote the argument --
 * M04 section 1.2's "no client-side cache of a money number survives a
 * navigation", and a static money screen is "FM-M4-03's shape arriving through a
 * build step rather than through a query" -- and FM-M4-03 is the IDOR row whose
 * blast radius is "firm-ending".
 *
 * THE LINE IS ALSO NOT OPTIONAL AND `test/route-rendering.test.ts` IS WHY. That
 * gate requires `force-dynamic` on exactly those pages whose transitive import
 * closure reaches `src/http/client.ts`. This page reaches it through
 * ./source.ts, so the gate requires this declaration and would have failed the
 * suite had it been omitted -- which is the repair session 368 landed after the
 * payout centre prerendered static for months with the build exiting 0.
 */
export const dynamic = 'force-dynamic';

/**
 * `/wallet`.
 *
 * ASYNC AND OTHERWISE DOING NOTHING A COMPONENT DOES. Every decision is in
 * ./source.ts and ../../view/wallet.ts, both synchronous and pure below the
 * fetch, so the suite renders the same tree this function returns and reads the
 * bytes.
 */
export default async function WalletPage(): Promise<ReactElement> {
  const loaded = await load();

  return loaded.kind === 'ready'
    ? createElement(Wallet, { view: loaded.view, framing: walletFraming(loaded.copy) })
    : createElement(WalletUnavailable, { missing: loaded.missing });
}
