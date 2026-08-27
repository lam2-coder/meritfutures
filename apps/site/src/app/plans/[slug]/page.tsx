// =============================================================================
// apps/site/src/app/plans/[slug]/page.tsx
// =============================================================================
// `/plans/:public_slug`. ONE PLAN VERSION'S PERMANENT PAGE.
//
// THE SEGMENT IS `public_slug` AND NOT THE VERSION NUMBER, which is
// `routes/paths.ts` ruling rather than this file choosing:
// `0004_catalog.sql` records that "deriving the URL from the version number
// would make the archive URL change whenever numbering does, which breaks
// exactly the links AS-M9-07 depends on". This page therefore LOOKS UP a slug
// and never builds one.
//
// SUPERSEDED VERSIONS RESOLVE HERE FOREVER (INV-M9-11), and every consequence
// of that is decided before this file runs: `planPage` takes indexability and
// the canonical address from `versionPageMeta`, and `envelopeMetadata` is where
// the resulting boolean reaches a crawler. This module cannot index a
// superseded page by passing a flag, because it passes none.
// =============================================================================

import type { Metadata } from 'next';
import type { ReactElement } from 'react';

import type { BuiltAt, SitePlanVersionView } from '../../../catalog/types.ts';
import type { SimulatedEnvironmentDisclosure } from '../../../render/disclosure.ts';
import { planCard } from '../../../routes/plans.ts';
import { planPage } from '../../../routes/page.ts';
import { planVersionPath } from '../../../routes/paths.ts';
import { Figures, Surface, Unavailable, envelopeMetadata } from '../../chrome.tsx';
import { siteBuild, siteCatalog, siteDisclosure } from '../../build.ts';

/** The route parameters App Router hands this segment. */
interface VersionParams {
  readonly params: Promise<{ readonly slug: string }>;
}

/**
 * Every version's page, current and superseded alike.
 *
 * IT IS THE ARCHIVE AND NOT THE SHELF. `CatalogReadPort` "returns superseded
 * versions too ... INV-M9-11 requires every version to keep a page forever, so
 * the build needs the archive and not only the shelf", and this is the
 * generator that turns that into files. `sellableVersions` narrows the pricing
 * index and is deliberately not used here.
 *
 * AN UNREADABLE CATALOG PRERENDERS NOTHING AND FAILS NOTHING. The route stays
 * live and resolves on demand, which is the honest outcome for a build that
 * read no catalog.
 */
export async function generateStaticParams(): Promise<readonly { readonly slug: string }[]> {
  const read = await siteCatalog(siteBuild());
  if (read.kind !== 'read') return [];
  return read.catalog.versions.map((version) => ({ slug: version.public_slug }));
}

export async function generateMetadata({ params }: VersionParams): Promise<Metadata> {
  const { slug } = await params;
  const resolved = await resolveVersion(slug);
  if (resolved === null) return { title: 'Plan version' };

  const { version, built_at, disclosure } = resolved;
  if (disclosure === null) return { title: version.plan_name };

  return envelopeMetadata(
    planPage({
      path: planVersionPath(version),
      title: version.plan_name,
      version,
      built_at,
      disclosure,
    }),
  );
}

export default async function PlanVersionPage({ params }: VersionParams): Promise<ReactElement> {
  const { slug } = await params;
  const resolved = await resolveVersion(slug);

  if (resolved === null || resolved.disclosure === null) {
    return (
      <>
        <h1>Plan version</h1>
        <Unavailable
          surface={`/plans/${slug}`}
          reason={
            resolved === null
              ? 'No plan version with this address was in the catalog this build read.'
              : 'This build read no simulated-environment disclosure, and INV-M9-05 makes ' +
                'that block a precondition of a page rather than a decoration on one.'
          }
        />
      </>
    );
  }

  const { version, built_at, disclosure } = resolved;
  const envelope = planPage({
    path: planVersionPath(version),
    title: version.plan_name,
    version,
    built_at,
    disclosure,
  });
  const card = planCard(version);

  return (
    <Surface envelope={envelope}>
      <p>{card.cadence_copy}</p>
      <p>
        <a href={card.rules_path}>Rules for this version</a>
      </p>

      {card.sizes.map((size) => (
        <article
          key={size.path}
          data-testid="plan-size-card"
          data-label-is-marketed={String(size.label_is_marketed)}
        >
          <h2>
            <a href={size.path}>{size.label}</a>
          </h2>
          <Figures figures={size.figures} />
        </article>
      ))}
    </Surface>
  );
}

/**
 * What both exports above need, read once per call rather than threaded.
 *
 * THE STAMP IS THE CATALOG'S AND NOT THE ENVIRONMENT'S, which is what
 * `routes/rules.ts` states of its own: "a rules page cannot state a moment its
 * own catalog read did not happen at". Reading `MERIT_SITE_BUILT_AT` a second
 * time here would let one page claim two moments.
 */
async function resolveVersion(slug: string): Promise<{
  readonly version: SitePlanVersionView;
  readonly built_at: BuiltAt;
  readonly disclosure: SimulatedEnvironmentDisclosure | null;
} | null> {
  const build = siteBuild();
  const read = await siteCatalog(build);
  if (read.kind !== 'read') return null;

  const version = read.catalog.versions.find((candidate) => candidate.public_slug === slug);
  if (version === undefined) return null;

  return {
    version,
    built_at: read.catalog.built_at,
    disclosure: await siteDisclosure(build).catch(() => null),
  };
}
