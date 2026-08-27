// =============================================================================
// apps/portal/src/app/referrals/page.ts
// =============================================================================
// SC-M4-09's App Router entry, and the FIRST route file this application has
// ever had under `src/app/`.
//
// -----------------------------------------------------------------------------
// THIS SEGMENT IS SHIPPED UNWIRED AND SAYS SO
// -----------------------------------------------------------------------------
// There is no `src/app/layout.tsx` and no `next.config` in this tree, and both
// belong to the session that writes the portal's root document. Next refuses to
// build an `app/` directory with no root layout, so `pnpm --filter @merit/portal
// build` cannot pass until that lands, and this session does not invent one:
// a second root layout would be two sessions authoring one document, and the
// merge would keep whichever landed second.
//
// What this segment does have is a render that is complete on its own, proved
// by `apps/portal/test/app-referrals.test.ts` rendering it to HTML with
// `react-dom/server` and asserting the compliance clause against that output.
//
// -----------------------------------------------------------------------------
// `dynamic = 'force-dynamic'` IS LOAD BEARING RATHER THAN A DEFAULT
// -----------------------------------------------------------------------------
// This route reads one identity's commission figures, so there is no build-time
// answer for it and a statically generated one would be somebody else's. Opting
// out of prerendering also means `next build` does not execute `loadReferralScreenData`
// and does not fail on its refusal, which keeps the unwired state a runtime
// fact rather than a build error for the next session to inherit.
//
// -----------------------------------------------------------------------------
// NO ROUTE HANDLER, NO SERVER ACTION, AND NOTHING HERE SERVES `/api/v1`
// -----------------------------------------------------------------------------
// ADR-095 ruling 3, on ADR-083 section 3: "No Next.js route handler and no
// Server Action may serve `/api/v1`, any operator path, or any surface
// API_CONTRACT specifies." This segment holds one `page` file and no `route`
// file, exports no `'use server'` function, and consumes M04 section 1.1's
// `/api/v1` rather than answering on it. The screen is a read surface: it
// submits no creative, and `POST /affiliate/creatives` is a write that belongs
// with the session that admits a transport.

import { createElement } from 'react';
import type { ReactElement } from 'react';

import { toCreativeSubmission, toReferralPanel } from '../../view/referrals.ts';
import { disclosureBlock } from '../../view/disclosure.ts';
import type { DisclosureSource } from '../../view/disclosure.ts';
import { loadReferralScreenData } from './data.ts';
import type { ReferralScreenData } from './data.ts';
import { ReferralScreen } from './screen.ts';
import type { ReferralScreenView } from './screen.ts';

/** M04 section 1.1: this screen is one identity's figures and is never static. */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Referrals' };

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
 * THIS ROUTE CANNOT COMPLETE TODAY AND THE REFUSAL IS THE HONEST HALF OF
 * SHIPPING UNWIRED. `loadReferralScreenData` rejects, naming the three things
 * it needs; nothing below it is reached, and nothing below it is seeded so that
 * it would be.
 */
export default async function ReferralsPage(): Promise<ReactElement> {
  const data = await loadReferralScreenData();
  return createElement(ReferralScreen, toReferralScreen(data));
}
