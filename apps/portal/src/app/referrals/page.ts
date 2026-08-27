// =============================================================================
// apps/portal/src/app/referrals/page.ts
// =============================================================================
// SC-M4-09's App Router entry. `/referrals` on the portal origin.
//
// -----------------------------------------------------------------------------
// THIS SEGMENT IS WIRED NOW, AND THE PARAGRAPH THAT SAID OTHERWISE IS CORRECTED
// RATHER THAN LEFT STANDING
// -----------------------------------------------------------------------------
// This header read "There is no `src/app/layout.tsx` and no `next.config` in
// this tree, and both belong to the session that writes the portal's root
// document. Next refuses to build an `app/` directory with no root layout, so
// `pnpm --filter @merit/portal build` cannot pass until that lands." SESSION 250
// LANDED BOTH. `next.config.mjs`, `app/layout.tsx` and the root page exist, the
// portal build compiles this route, and a sentence claiming the build cannot
// pass would be false beside a build that does.
//
// The second half of the unwired state is gone too. ./data.ts used to reject on
// every call, naming the three things it needed; ADR-162 landed the transport,
// ADR-168 ruled on one of the three, and ./data.ts now performs
// `GET /affiliate/stats` through that client and reports the rest.
//
// -----------------------------------------------------------------------------
// THREE ARMS AND NOT ONE THROW, WHICH IS THE WHOLE OF WHAT THIS FILE DECIDES
// -----------------------------------------------------------------------------
// The old body awaited a function whose only behaviour was to reject, and the
// honesty of that was real: it refused to seed figures Merit never computed.
// What it could not do is tell an affiliate WHICH thing was wrong. ./data.ts's
// `ReferralScreenLoad` has three arms and this file is the branch:
//
//   `ready`        ./screen.ts, through `toReferralScreen` below
//   `unavailable`  ./states.ts's `ReferralsUnavailable`, which renders the
//                  reads still pending AND, separately, the one ADR-168 clause
//                  3 REFUSED. Two lists, two different words, because they are
//                  two different facts
//   `error`        ./states.ts's `ReferralsError`, the arm the payout centre
//                  does not have (ADR-162 section 5 item 1)
//
// -----------------------------------------------------------------------------
// `dynamic = 'force-dynamic'` IS LOAD BEARING RATHER THAN A DEFAULT
// -----------------------------------------------------------------------------
// This route reads one identity's commission figures, so there is no build-time
// answer for it and a statically generated one would be somebody else's. That
// is M04 section 1.2 and it is ADR-162 clause 4's third reason: every response
// on this surface is identity-scoped, and a cache is a key that would have to
// include the session or it serves one affiliate's earnings to another.
//
// -----------------------------------------------------------------------------
// NO ROUTE HANDLER, NO SERVER ACTION, AND NOTHING HERE SERVES THE API SURFACE
// -----------------------------------------------------------------------------
// ADR-095 ruling 3, on ADR-083 section 3: "No Next.js route handler and no
// Server Action may serve `/api/v1`, any operator path, or any surface
// API_CONTRACT specifies." This segment holds one `page` file and no `route`
// file, exports no `'use server'` function, and CONSUMES the contract's surface
// rather than answering on it. The screen is a read surface: it submits no
// creative, `POST /affiliate/creatives` is a write, and `ApiClient` in
// ../../http/client.ts declares `get` and no second method, so the transport
// could not perform one even if this file asked.

import { createElement } from 'react';
import type { ReactElement } from 'react';

import { toCreativeSubmission, toReferralPanel } from '../../view/referrals.ts';
import { disclosureBlock } from '../../view/disclosure.ts';
import type { DisclosureSource } from '../../view/disclosure.ts';
import { REFUSED_READS, load } from './data.ts';
import type { ReferralScreenData } from './data.ts';
import { ReferralScreen } from './screen.ts';
import type { ReferralScreenView } from './screen.ts';
import { ReferralsError, ReferralsUnavailable } from './states.ts';

/** M04 section 1.1: this screen is one identity's figures and is never static. */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Referrals' };

/** The heading every arm of this screen carries. One string, one screen. */
const HEADING = 'Referrals';

/**
 * The NFA I-26-12 disclosure's address in `content_documents`.
 *
 * `disclosureBlock()` takes the address as an ARGUMENT and the provenance is
 * asserted by the caller rather than proven, which `../../view/disclosure.ts`
 * states out loud: "no contract row serves `content_documents` to the portal".
 * So this constant is the caller's assertion, in one place, in a diff a
 * reviewer reads. THE TEXT IS NOT HERE AND MUST NEVER BE: a required
 * disclosure that is a literal typed at the point of render is the failure that
 * file exists to make impossible.
 *
 * WHICH IS ALSO WHY ./data.ts CARRIES THE TEXT AS A PENDING READ RATHER THAN AS
 * A REFUSED ONE. The address is settled and the sentence is not available; that
 * is a thing a later slice fixes, and it is spelled differently from a thing
 * ADR-168 decided nobody will.
 */
const NFA_DISCLOSURE: DisclosureSource = { slug: 'affiliate-nfa-disclosure', version: 1 };

/**
 * Assemble the screen from the wire.
 *
 * EXPORTED SO THE SUITE RENDERS THE SAME ASSEMBLY THE ROUTE DOES. A test that
 * built its own view model would assert the components and never the page.
 */
export function toReferralScreen(data: ReferralScreenData): ReferralScreenView {
  return {
    panel: toReferralPanel(data.stats, disclosureBlock(NFA_DISCLOSURE, data.disclosure_text)),
    creative: data.creative === null ? null : toCreativeSubmission(data.creative),
  };
}

/**
 * SC-M4-09.
 *
 * IT PERFORMS `GET /affiliate/stats` NOW, through ADR-162's client, carrying
 * the affiliate's `merit_session` cookie forward from the inbound request.
 * ./data.ts used to reject here and stated why a rendering session was not the
 * one to write a transport; it is that transport's caller now and this file is
 * the branch.
 */
export default async function ReferralsPage(): Promise<ReactElement> {
  const loaded = await load();

  if (loaded.kind === 'unavailable')
    return createElement(ReferralsUnavailable, {
      heading: HEADING,
      missing: loaded.missing,
      refused: REFUSED_READS,
    });

  if (loaded.kind === 'error')
    return createElement(ReferralsError, { heading: HEADING, error: loaded.error });

  return createElement(ReferralScreen, toReferralScreen(loaded));
}
