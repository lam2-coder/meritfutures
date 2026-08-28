// =============================================================================
// apps/admin/src/app/layout.tsx
// =============================================================================
// THE OPERATOR CONSOLE'S ROOT LAYOUT, AND IT IS THIN ON PURPOSE.
//
// ADR-182 ruling 2 puts this deployable on Next.js App Router and ruling 1 is
// the one underneath it: this console SERVES HTTP at `ADMIN_ORIGIN` and reads
// `api-admin` at `/api/v1` on the same origin (INFRA:53). App Router renders
// this file around every screen in this app, so whatever is here is a property
// of every screen rather than a habit each one has to remember.
//
// -----------------------------------------------------------------------------
// WHY THERE IS NO BAND AND NO FOOTER, WHICH IS A MEASUREMENT RATHER THAN A
// PREFERENCE
// -----------------------------------------------------------------------------
// `apps/portal/src/app/layout.tsx` carries two obligations because M04 states
// two: ADR-068 requirement 4 makes the impersonation banner shell chrome, and
// INV-M4-09 puts the simulated-environment disclosure in the footer. Both are
// written down as obligations on every screen.
//
// M06 STATES NO SUCH OBLIGATION FOR THIS CONSOLE. Its section 3 is a list of
// surfaces and its invariants attach to reads and to writes rather than to a
// shell: INV-M6-01's audit middleware and INV-M6-08's dual control are write
// path and WAVE-06 wave 5 holds every mutating surface behind ADR-171. A layout
// that invented chrome here would be adding a behavior the corpus does not
// carry, which the conventions refuse outright.
//
// -----------------------------------------------------------------------------
// AND P-M6-09 IS NOT SHELL CHROME, WHICH IS THE ONE THAT LOOKS LIKE IT SHOULD BE
// -----------------------------------------------------------------------------
// M06 section 3.1: "If anything here is red, every number above it is suspect
// and the page says so", and the trust panel is "placed last in the list and
// first on the page". That reads like chrome and it is not, because a verdict
// is a value produced by the same read that produced the numbers it gates. A
// shell has no read. A banner rendered here would either be a second call to
// `assessDataTrust` on inputs this file does not have, which is the second
// opinion the console may not offer, or a constant, which is worse. So the
// banner is `LiabilityHomePage.banner`, it is rendered by the document, and it
// is INHERITED there rather than recomputed.
//
// NO HOSTNAME IS RENDERED HERE OR ANYWHERE UNDER `src/app/`. ADR-012, and
// `test/surface.test.ts` sweeps every file in this package for one.

import type { ReactNode } from 'react';

export const metadata = {
  title: 'Merit operator console',
  description: 'M06 read surfaces. Numbers other modules computed, each rendered with its as-of',
};

export default function AdminRootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
