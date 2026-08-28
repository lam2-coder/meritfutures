// =============================================================================
// apps/portal/src/app/(purchases)/certificates/page.ts
// =============================================================================
// SC-M4-08 at `/certificates`.
//
// THIS PAGE IS AUTHENTICATED AND THE ARTIFACT IT RENDERS IS NOT. INV-M4-10: "No
// screen in this module is reachable without an authenticated session except the
// public certificate verification page." So the screen is the trader's own and
// the card on it is built to be shared, and ../model.ts is where that difference
// is turned into a closed list of fields rather than left to whatever the view
// module happens to expose.
//
// The route-group note, the no-route-handler note and the dynamic-route note are
// ../purchases/page.ts's, unchanged, and the last of the three is stronger here:
// a certificate card baked into a static artifact is one trader's card served to
// whoever asks next.
//
// -----------------------------------------------------------------------------
// THE FIXTURE SEAM IS GONE AND THIS SCREEN STILL CANNOT REACH `ready`
// -----------------------------------------------------------------------------
// This page used to import `FIXTURE_PORTS` and `CERTIFICATE_REQUESTS` by name.
// It now calls ../source.ts, which performs every read this segment has a source
// for and names the ones it does not: the trader's own certificate list, which
// `GET /certificates` serves and this application has no transcription of, and
// the simulated-environment disclosure text, which INV-M4-09 requires on this
// surface and no contract row serves at all. Both are argued at length in
// ../source.ts's header and neither is this file's to decide.
//
// SO THE ARM THIS PAGE RENDERS TODAY IS `unavailable`, WHICH IS NOT AN ERROR AND
// IS NOT AN EMPTY SCREEN. ../certificates-screen.ts's empty state says "No
// certificates yet. One is issued when an evaluation is passed and when a payout
// reaches your wallet", which is a POSITIVE CLAIM about a trader's record. A
// screen that rendered it because a read had no source would be making that
// claim on no evidence, on the surface AS-M4-03 is written about.

import { createElement } from 'react';
import type { ReactElement } from 'react';

import { CertificatesScreen } from '../certificates-screen.ts';
import { loadCertificates } from '../source.ts';
import { PurchasesError, PurchasesUnavailable } from '../states.ts';

/** Never prerendered, never cached. See ../purchases/page.ts's header. */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Certificates',
};

/** The heading every arm of this screen carries. One string, one screen. */
const HEADING = 'Certificates';

/** The class ../certificates-screen.ts puts on its own `main`, so all three arms match. */
const SCREEN = 'merit-screen-certificates';

export default async function CertificatesPage(): Promise<ReactElement> {
  const loaded = await loadCertificates();

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

  return CertificatesScreen({ model: { cards: loaded.cards, refused: loaded.refused } });
}
