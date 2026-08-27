// =============================================================================
// apps/portal/src/app/referrals/data.ts
// =============================================================================
// THE PORT THIS SEGMENT NEEDS AND DOES NOT HAVE, DECLARED RATHER THAN INVENTED.
//
// `apps/portal` has no transport. `src/api/` holds wire TYPES and no client,
// and `surface.test.ts` asserts that absence over every source file in the app:
// "no source file in this app performs a network call ... asserting it now
// means the first `fetch` written here is a decision somebody makes on purpose
// rather than one that appears in a diff." This session is a rendering session
// and is not that decision, so this file declares the shape of the answer and
// refuses to produce one.
//
// -----------------------------------------------------------------------------
// A REFUSAL RATHER THAN A FIXTURE, AND THE REASON IS WHICH FAILURE IS SURVIVABLE
// -----------------------------------------------------------------------------
// The tempting alternative is to seed plausible numbers so the route renders
// today. A referral screen showing invented commission figures is a screen that
// looks finished and states amounts Merit never computed, on the surface M08
// AS-M8-04 is about. `ReferralDataUnwiredError` is loud, names the two contract
// rows it needs, and cannot be mistaken for data.
//
// The fixtures that exercise the render live in `apps/portal/test/`, where a
// fixture is a fixture.

import type { AffiliateStats } from '../../api/types.ts';
import type { CreateCreativeResponse } from '../../view/referrals.ts';

/**
 * The two wire answers SC-M4-09 renders.
 *
 * `creative` IS NULLABLE BECAUSE NO CONTRACT ROW READS ONE BACK. API_CONTRACT
 * section 7 carries `POST /affiliate/creatives` and no `GET`, so the only
 * moment this response exists is the submission itself and every other render
 * of this screen has nothing to show. ADR-113 section 5 records the operator
 * half as owed; the trader-side READ is owed too and is named here.
 */
export type ReferralScreenData = {
  readonly stats: AffiliateStats;
  readonly creative: CreateCreativeResponse | null;

  /**
   * The NFA I-26-12 disclosure's TEXT, from the `content_documents` row the
   * page names.
   *
   * IT IS ON THE PORT AND NOT IN THE PAGE, and the reason is the strongest
   * sentence in `../../view/disclosure.ts`: a required disclosure "cannot be a
   * literal typed at the point of render". A page that held the sentence would
   * be exactly that, and the brand would be satisfied by the thing it exists to
   * refuse. NO CONTRACT ROW SERVES `content_documents` TO THE PORTAL, so this
   * field is a second thing the client owes and is named rather than assumed.
   */
  readonly disclosure_text: string;
};

/** The screen was rendered before anything could answer for it. */
export class ReferralDataUnwiredError extends Error {
  constructor() {
    super(
      'the referrals screen has no data source. apps/portal declares wire types ' +
        'and no transport, and this segment shipped its render ahead of the ' +
        'client that will feed it. It needs GET /affiliate/stats and, where one ' +
        'exists, the POST /affiliate/creatives response for the submission under ' +
        'review, and the NFA I-26-12 disclosure text, which no contract row ' +
        'serves to the portal at all. Rendering seeded figures instead would ' +
        'state commission amounts ' +
        'Merit never computed, on the one screen M08 AS-M8-04 is about.',
    );
    this.name = 'ReferralDataUnwiredError';
  }
}

/**
 * Read the screen's data.
 *
 * WHOEVER WRITES THE PORTAL'S API CLIENT REPLACES THIS BODY AND NOTHING ELSE.
 * The signature is the contract between that session and this one.
 */
export function loadReferralScreenData(): Promise<ReferralScreenData> {
  return Promise.reject(new ReferralDataUnwiredError());
}
