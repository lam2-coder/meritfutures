// =============================================================================
// apps/portal/src/app/layout.tsx
// =============================================================================
// THE ROOT LAYOUT, WHICH IS THE SHELL'S TWO OBLIGATIONS GIVEN A PLACE TO LIVE.
//
// `shell/app-shell.ts` has held them since session 111 and had nothing to render
// inside:
//
//   ADR-068 requirement 4, through M04 section 3.9: the impersonation banner is
//   SHELL CHROME, so it is on every screen AND on every error, empty and
//   loading state.
//
//   INV-M4-09: the simulated-environment disclosure appears in the footer, and
//   it is a compliance obligation rather than a design preference.
//
// THE ROOT LAYOUT IS WHY THEY ARE PROPERTIES RATHER THAN HABITS. App Router
// renders this file around every page in this app, so a screen that forgot the
// footer is not a screen a reviewer has to catch: there is nowhere for a screen
// to render that is outside this file.
//
// -----------------------------------------------------------------------------
// `content` IS `ready` HERE AND THAT IS A FACT ABOUT LAYOUTS, NOT A DEFAULT
// -----------------------------------------------------------------------------
// `ShellView` carries three fields and the layout owns two of them. The third,
// `content`, is the SCREEN's: a page decides whether it is showing data, an
// empty set, a spinner or an error, and `app/page.tsx` computes its own with
// `toPortalErrorKind`. What the layout can say about `content` is the one thing
// that is true whenever this function runs: App Router renders a layout around
// `children`, so at this level the chrome has something to wrap. That is
// `ready`, and it is measured off the framework's own contract rather than
// picked as the least-bad member of the union.
//
// -----------------------------------------------------------------------------
// THE DISCLOSURE SENTENCE IS AN INTERIM SOURCE AND IT SAYS SO
// -----------------------------------------------------------------------------
// `view/disclosure.ts` mints a `DisclosureBlock` from a `content_documents`
// address, and its header states the limit plainly: "NO CONTRACT ROW SERVES
// `content_documents` TO THE PORTAL, so `disclosureBlock()` takes the document's
// address as an ARGUMENT and the provenance is asserted by the caller rather
// than proven."
//
// THERE IS NO SUCH ROW AND NO SUCH ENDPOINT TODAY, so minting a
// `DisclosureBlock` here would assert a provenance that does not exist, which is
// the one failure that file's own header calls "a diff a reviewer reads". The
// constant below is therefore a PLAIN STRING, quoted from GLOSSARY's "sim,
// simulated and B-book" entry, carrying the citation at the point of use.
// `toShellView` types the field as `string` and not as `DisclosureBlock`, so
// nothing is being weakened to make this compile.
//
// The obligation is rendered rather than omitted, which is the direction that
// matters: INV-M4-09 fails when the footer is missing, and a footer sourced from
// the corpus is strictly closer to the ruling than no footer at all. ADR-138
// section 6 carries the endpoint as owed.

import type { ReactNode } from 'react';

import { toShellView } from '../shell/app-shell.ts';
import type { ImpersonationBannerView } from '../shell/impersonation-banner.ts';

/**
 * GLOSSARY, "sim, simulated and B-book": "All Merit trading, including the
 * funded phase, occurs in a simulated environment; the firm takes the other
 * side internally rather than routing trader orders to the exchange."
 *
 * Quoted, not authored. Superseded by the `content_documents` row the moment a
 * contract row serves one.
 */
const SIMULATED_ENVIRONMENT_DISCLOSURE =
  'All Merit trading, including the funded phase, occurs in a simulated ' +
  'environment; the firm takes the other side internally rather than routing ' +
  'trader orders to the exchange.';

/**
 * The impersonation band, or nothing.
 *
 * NULL IS THE ORDINARY CASE AND IS TODAY'S ONLY CASE, because no session
 * handling exists in this app: `apps/portal/src/index.ts` records that
 * "everything that changes anything is absent, and deliberately". The component
 * takes the view model rather than the session, so the day an operator session
 * resolves, the band arrives without this file learning anything new.
 *
 * THERE IS NO DISMISS CONTROL AND THERE IS NOWHERE TO PUT ONE. INV-M4-17 and
 * ADR-068 requirement 4: the band "cannot be closed rather than being hard to
 * close", which `ImpersonationBannerView` expresses by carrying no such field.
 */
function ImpersonationBand({ view }: { readonly view: ImpersonationBannerView | null }) {
  if (view === null) return null;
  return (
    <aside data-testid="impersonation-band" data-placement={view.placement}>
      <p>
        Operator session. {view.admin_user_id} is viewing {view.subject_identity_id}.
      </p>
      <p>
        {view.reason_code}: {view.reason_detail}
      </p>
      <p>Expires {view.expires_at}</p>
    </aside>
  );
}

export const metadata = {
  title: 'Merit',
  description: 'Merit trader portal',
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  const shell = toShellView({
    impersonation: null,
    simulated_environment_disclosure: SIMULATED_ENVIRONMENT_DISCLOSURE,
    content: { kind: 'ready' },
  });

  return (
    <html lang="en">
      <body>
        <ImpersonationBand view={shell.impersonation} />
        <main>{children}</main>
        <footer data-testid="simulated-environment-disclosure">
          {shell.simulated_environment_disclosure}
        </footer>
      </body>
    </html>
  );
}
