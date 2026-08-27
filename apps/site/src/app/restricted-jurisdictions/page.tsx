// =============================================================================
// apps/site/src/app/restricted-jurisdictions/page.tsx
// =============================================================================
// `/restricted-jurisdictions`. AS-M9-04: "The restricted list is published as a
// page, not only enforced at checkout, so the position is a stated policy
// rather than an error message."
//
// THE LIST IS READ AND IS NEVER TYPED HERE. `routes/geo.ts` states the rule on
// its own argument: DEP-M9-04 makes `geo_restrictions` "the single source for
// checkout enforcement, campaign targeting, and the site notice", and "a
// country code typed into this module would be that drift created
// deliberately". A country code typed into this PAGE would be the same drift
// one layer out, so when the read fails this page publishes no list at all.
//
// `readRestrictedCountries` HAS NO ENDPOINT ANYWHERE, which ADR-096 section 7
// records by name, so the adapter's production value refuses it with
// `UnservedEndpointError` rather than returning an empty list. THAT DISTINCTION
// IS THE WHOLE REASON THIS PAGE CANNOT SHOW AN EMPTY LIST: an empty list here
// reads as "Merit accepts traders everywhere", which is a policy statement, and
// it would be one this build inferred from a missing endpoint.
//
// THE NOTICE FAILING IS NOT THE CONTROL FAILING. FM-M9-04 is "fail open on the
// notice and closed at checkout": enforcement is M3's at checkout and M19's at
// verification and is unaffected by anything on this page.
// =============================================================================

import type { ReactElement } from 'react';

import { page } from '../../routes/page.ts';
import { Surface, Unavailable } from '../chrome.tsx';
import { siteBuild, siteDisclosure } from '../build.ts';

export const metadata = {
  title: 'Restricted jurisdictions',
};

export default async function RestrictedJurisdictionsSurface(): Promise<ReactElement> {
  const build = siteBuild();

  if (build.kind !== 'wired') {
    return (
      <>
        <h1>Restricted jurisdictions</h1>
        <Unavailable surface="/restricted-jurisdictions" reason={build.reason} />
      </>
    );
  }

  try {
    const restricted = await build.ports.geo.readRestrictedCountries();
    const disclosure = await siteDisclosure(build);
    const envelope = page({
      path: '/restricted-jurisdictions',
      title: 'Restricted jurisdictions',
      indexable: true,
      built_at: build.built_at,
      disclosure,
    });

    return (
      <Surface envelope={envelope}>
        <p>
          Merit does not open accounts for residents of the jurisdictions below. Eligibility is
          checked when an account is opened and when identity is verified, so this page is the
          stated position rather than the control.
        </p>
        <ul data-testid="restricted-countries">
          {restricted.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
      </Surface>
    );
  } catch (cause) {
    console.error('the restricted jurisdiction list could not be read', cause);
    return (
      <>
        <h1>Restricted jurisdictions</h1>
        <Unavailable
          surface="/restricted-jurisdictions"
          reason={
            'The restricted jurisdiction list could not be read for this build. It is published ' +
            'from the same table checkout enforces against, and no list is shown here rather ' +
            'than a shorter one assembled somewhere else.'
          }
        />
      </>
    );
  }
}
