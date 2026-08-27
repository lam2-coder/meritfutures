// =============================================================================
// apps/portal/src/app/payouts/source.ts
// =============================================================================
// WHERE THIS SEGMENT'S DATA WOULD COME FROM, AND THE ONE FILE THAT CHANGES WHEN
// IT DOES.
//
// THERE IS NO TRANSPORT IN THIS APPLICATION AND THAT IS ASSERTED RATHER THAN
// LAMENTED. `apps/portal/test/surface.test.ts` walks every `.ts` file under
// `src/` and fails on `fetch(`, `XMLHttpRequest`, `WebSocket` or `EventSource`,
// with a stated reason: "the fetch layer arrives with the framework. Asserting
// it now means THE FIRST `fetch` WRITTEN HERE IS A DECISION SOMEBODY MAKES ON
// PURPOSE rather than one that appears in a diff."
//
// This session is not that somebody, and the reason is not deference. A client
// for `/api/v1` needs a base URL, a session cookie policy, an error mapping
// onto ../../shell/app-shell.ts's `PortalErrorKind`, and a decision about
// caching that INV-M4-04's re-fetch depends on. Five other segments land in
// this same app in this same wave and every one of them needs the same client.
// A transport invented inside `app/payouts/` would be the sixth copy or the
// one everybody else has to adopt unread, and neither is this segment's to
// choose.
//
// SO THE PAGE RENDERS AN HONEST UNAVAILABLE STATE AND NAMES THE TWO ENDPOINTS
// IT IS WAITING ON. When the client and session 252's routes exist, `load`
// below gains a `ready` branch and NOTHING ELSE IN THIS SEGMENT CHANGES:
// ./view.ts already turns the two wire shapes into the screen, and
// ./sections.ts already renders it. The seam is one function.

import type { EligibilityResponse } from '../../api/types.ts';
import { toPayoutCenterView } from './view.ts';
import type { PayoutCenterView } from './view.ts';
import type { PayoutListItem } from './wire.ts';

/**
 * The two endpoints M04 section 4 names for this screen.
 *
 * `GET /accounts/:accountId/eligibility` exists in API_CONTRACT today.
 * `GET /payouts` exists in API_CONTRACT today. NEITHER IS IMPLEMENTED: session
 * 252 owns `GET /payouts` and `POST /accounts/:id/payout`.
 */
export const REQUIRED_ENDPOINTS = ['GET /accounts/:accountId/eligibility', 'GET /payouts'] as const;

/**
 * What the page got.
 *
 * `unavailable` IS NOT AN ERROR STATE. ../../shell/app-shell.ts's `ContentState`
 * has `loading`, `empty` and `error`, and this is none of the three: nothing is
 * in flight, nothing is absent from a populated response, and nothing failed.
 * Mapping it onto `error` would put a working screen into the vocabulary of a
 * fault, which is the same move M04 section 3.2 forbids when it refuses to word
 * a 422 as a rejection.
 */
export type PayoutCenterLoad =
  | { readonly kind: 'ready'; readonly view: PayoutCenterView }
  | { readonly kind: 'unavailable'; readonly missing: readonly string[] };

/**
 * Build the screen from two responses.
 *
 * EXPORTED SEPARATELY FROM `load` SO THE READY BRANCH IS EXERCISABLE TODAY.
 * `apps/portal/test/payout-center.test.ts` renders this segment's real output
 * through this function with responses transcribed from API_CONTRACT, so the
 * screen is proven against data rather than against a placeholder, months
 * before a transport exists to fetch it.
 */
export function readyFrom(input: {
  readonly eligibility: EligibilityResponse;
  readonly payouts: readonly PayoutListItem[];
}): PayoutCenterLoad {
  return { kind: 'ready', view: toPayoutCenterView(input) };
}

/**
 * What ./page.ts calls.
 *
 * IT IS ASYNC TODAY THOUGH IT AWAITS NOTHING, so that landing the transport is
 * a change to this function's body and not to its signature or to the page's.
 * A `Promise` returned by a function that will fetch is not speculation, it is
 * the shape the App Router already expects of a server component's data.
 */
export async function load(): Promise<PayoutCenterLoad> {
  return { kind: 'unavailable', missing: [...REQUIRED_ENDPOINTS] };
}
