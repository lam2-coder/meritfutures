// =============================================================================
// apps/site/src/app/page.tsx
// =============================================================================
// `/`. THE HOME SURFACE, AND WHAT IT RENDERS IS WHAT IS TRUE TODAY.
//
// -----------------------------------------------------------------------------
// WHY THERE IS NO PRICE AND NO PASS RATE ON THIS PAGE
// -----------------------------------------------------------------------------
// M09 section 1.2: "M9 reads `plan_versions`. It contains no threshold, no
// price, and no rule text of its own." No API answers on this ref, so this page
// has read no plan version and no published statistic, and a headline figure
// here would be a number this application invented about a product it does not
// own. INV-M9-01 is the invariant and a home page is where marketing pressure
// to break it is highest.
//
// -----------------------------------------------------------------------------
// WHAT IT DOES RENDER IS CORPUS TEXT, AND EACH PIECE CARRIES ITS CONTROL
// -----------------------------------------------------------------------------
// `CANONICAL_PAYOUT_COPY` is AS-M9-06's sentence, quoted from the frozen plan
// rather than written here, and `payoutCopyOmitsALeg` is INV-M9-09's control
// run over it on this page. The two legs are named together at the same weight
// because the constant names them that way, and the assertion beside it is what
// makes that a property rather than a hope.
//
// `geoNotice(null, [])` IS THE REAL FUNCTION ON THE REAL DISPOSITION. The edge
// lookup is `GeoLookupPort` and nothing serves it (ADR-096 section 7), so the
// visitor's country is `null`, which is FM-M9-04's "fail open on the notice and
// closed at checkout" exactly: the call to action is shown and the enforcement
// that matters is M3's at checkout and M19's at verification.
// =============================================================================

import type { ReactElement } from 'react';

import { CANONICAL_PAYOUT_COPY, payoutCopyOmitsALeg } from '../render/disclosure.ts';
import { geoNotice } from '../routes/geo.ts';
import { SITE_SURFACES } from '../routes/paths.ts';
import { page } from '../routes/page.ts';
import { Surface, Unavailable } from './chrome.tsx';
import { siteBuild, siteDisclosure } from './build.ts';

export const metadata = {
  title: 'Merit',
  description: 'Merit plans, rules and published statistics',
};

export default async function HomePage(): Promise<ReactElement> {
  const build = siteBuild();
  const geo = geoNotice(null, []);

  // INV-M9-09 RUN ON THE PAGE RATHER THAN ASSERTED IN A COMMENT. The constant
  // names both legs, so this is `false`; it is computed anyway, because the day
  // somebody replaces the constant with a headline this is the line that fires.
  const payoutCopyIsWhole = !payoutCopyOmitsALeg(CANONICAL_PAYOUT_COPY);

  const body = (
    <>
      <section data-testid="payout-copy" data-both-legs={String(payoutCopyIsWhole)}>
        <h2>Payouts</h2>
        <p>{CANONICAL_PAYOUT_COPY}</p>
      </section>

      <section data-testid="geo-notice" data-disposition={geo.disposition}>
        <h2>Where Merit accepts traders</h2>
        {geo.notice === null ? (
          <p>
            Merit does not accept traders in every jurisdiction. The published list is at{' '}
            <a href={geo.restricted_list_path}>{geo.restricted_list_path}</a>, and eligibility is
            checked at checkout rather than here.
          </p>
        ) : (
          <p>{geo.notice}</p>
        )}
      </section>

      <section data-testid="surface-inventory">
        <h2>What is published here</h2>
        <ul>
          {SITE_SURFACES.map((surface) => (
            <li key={surface.path}>
              <a href={surface.path}>{surface.title}</a>
            </li>
          ))}
        </ul>
      </section>
    </>
  );

  const disclosure = await siteDisclosure(build).catch(() => null);

  if (build.kind !== 'wired' || disclosure === null) {
    return (
      <>
        <h1>Merit</h1>
        {body}
        <Unavailable
          surface="/"
          reason={
            build.kind === 'wired'
              ? 'This build read no simulated-environment disclosure, so it renders no page ' +
                'envelope. INV-M9-05 makes that block a precondition of a page rather than a ' +
                'decoration on one.'
              : build.reason
          }
        />
      </>
    );
  }

  const envelope = page({
    path: '/',
    title: 'Merit',
    indexable: true,
    built_at: build.built_at,
    disclosure,
  });

  return <Surface envelope={envelope}>{body}</Surface>;
}
