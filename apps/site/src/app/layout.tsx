// =============================================================================
// apps/site/src/app/layout.tsx
// =============================================================================
// THE ROOT LAYOUT, WHICH IS WHERE `INV-M9-05` STOPS BEING A HABIT.
//
// "The simulated-environment disclosure appears on every page or the build
// fails." App Router renders this file around every page in this app, so there
// is nowhere for a page in `apps/site` to render that is outside this footer.
// A new surface cannot omit the disclosure by being new, which is the phrasing
// `render/disclosure.ts` uses of its own check.
//
// -----------------------------------------------------------------------------
// THE FOOTER HAS TWO SOURCES AND THEY ARE NOT INTERCHANGEABLE
// -----------------------------------------------------------------------------
// The disclosure a dispute quotes is a `content_documents` row, carrying the
// version acceptance was recorded against. `siteDisclosure` reads it and
// returns `null` rather than minting one when no API answers, and when it is
// null this footer falls back to a sentence QUOTED FROM THE CORPUS, marked as
// an interim source and carrying its citation.
//
// THAT FALLBACK IS `apps/portal/src/app/layout.tsx`'s MOVE AND ITS REASONING IS
// COPIED RATHER THAN RE-DERIVED: "minting a `DisclosureBlock` here would assert
// a provenance that does not exist ... The obligation is rendered rather than
// omitted, which is the direction that matters." A footer sourced from the
// corpus is strictly closer to the ruling than no footer at all, and it is
// visibly marked so nobody mistakes it for the citable row.
//
// WHAT IT DOES NOT DO IS LET A PAGE PAST `page()`. The envelope builders still
// refuse a null disclosure, so a marketing surface with no citable block
// renders no marketing copy at all. The footer obligation and the page model's
// precondition are two different controls and only one of them has a fallback.
//
// -----------------------------------------------------------------------------
// THE NAVIGATION IS `SITE_SURFACES` AND IS NEVER A LIST TYPED HERE
// -----------------------------------------------------------------------------
// `routes/paths.ts` carries `navigable` per surface because INV-M9-11 needs
// "reachable by link and unreachable by browsing" to be two booleans rather
// than one. A hand-written nav in this file would be the second copy that
// forgets one of them, and it would forget it silently.
// =============================================================================

import type { ReactElement, ReactNode } from 'react';

import { SITE_SURFACES } from '../routes/paths.ts';
import { siteBuild, siteDisclosure } from './build.ts';

/**
 * GLOSSARY, "sim, simulated and B-book", quoted verbatim.
 *
 * Not authored here and not edited here. Superseded by the `content_documents`
 * row the moment an endpoint serves one, which is what `siteDisclosure` reads
 * and what this constant stands in for.
 */
const SIMULATED_ENVIRONMENT_QUOTE =
  'All Merit trading, including the funded phase, occurs in a simulated ' +
  'environment; the firm takes the other side internally rather than routing ' +
  'trader orders to the exchange.';

export const metadata = {
  title: 'Merit',
  description: 'Merit plans, rules and published statistics',
};

export default async function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}): Promise<ReactElement> {
  const build = siteBuild();

  // A CONTENT READ THAT FAILS MUST NOT TAKE THE FOOTER WITH IT. The disclosure
  // is the one thing on this page that is required to be present, so the read
  // that sources it is the last read allowed to throw.
  let disclosure = null;
  try {
    disclosure = await siteDisclosure(build);
  } catch (cause) {
    console.error('the simulated-environment disclosure could not be read', cause);
  }

  return (
    <html lang="en">
      <body>
        <header>
          <nav aria-label="Primary">
            <ul>
              {SITE_SURFACES.filter((surface) => surface.navigable).map((surface) => (
                <li key={surface.path}>
                  <a href={surface.path}>{surface.title}</a>
                </li>
              ))}
            </ul>
          </nav>
        </header>

        <main>{children}</main>

        <footer
          data-testid="simulated-environment-disclosure"
          data-form={disclosure === null ? 'short' : disclosure.form}
          data-sourced={disclosure === null ? 'corpus' : 'content-document'}
        >
          <p>{disclosure === null ? SIMULATED_ENVIRONMENT_QUOTE : disclosure.body}</p>
          {disclosure === null ? (
            <p data-testid="disclosure-provenance-missing">
              This wording is quoted from the Merit glossary because no content document was
              read by this build. The citable version, the one an agreement is recorded
              against, arrives with the content endpoint.
            </p>
          ) : (
            <p data-testid="disclosure-provenance">
              Version {disclosure.document_version} of <code>{disclosure.document_slug}</code>.
            </p>
          )}
        </footer>
      </body>
    </html>
  );
}
