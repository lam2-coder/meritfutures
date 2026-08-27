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
// The route-group note, the no-route-handler note and the fixture seam are
// ../purchases/page.ts's, unchanged. `GET /accounts/:accountId/certificate` is
// approved in API_CONTRACT section 6 and is claimed by NO session in this wave,
// and the disclosure text has no contract row at all; ../ports.ts states both.

import type { ReactElement } from 'react';

import { CertificatesScreen } from '../certificates-screen.ts';
import { CERTIFICATE_REQUESTS, FIXTURE_PORTS } from '../fixtures.ts';
import { certificatesPageModel } from '../model.ts';

export const metadata = {
  title: 'Certificates',
};

export default async function CertificatesPage(): Promise<ReactElement> {
  return CertificatesScreen({
    model: await certificatesPageModel(FIXTURE_PORTS, CERTIFICATE_REQUESTS),
  });
}
