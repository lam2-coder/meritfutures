// =============================================================================
// apps/site/src/app/plans/[slug]/rules/page.tsx
// =============================================================================
// `/plans/:public_slug/rules`. THE SIZE SELECTOR, AND WHY IT IS NOT A RULES
// PAGE.
//
// -----------------------------------------------------------------------------
// THIS ROUTE HAS NO PAGE MODEL AND THAT IS A FINDING RATHER THAN A GAP I FILLED
// -----------------------------------------------------------------------------
// `derivedPaths` lists `planVersionRulesPath(version)` among the addresses a
// publish must invalidate, so the route is real. But `rulesPage` is
// PG-M9-03 "for one version at one SIZE": it takes a `size` argument, asserts
// that size belongs to the version, and stamps its envelope at
// `planVersionSizePath(version, size)`. There is no size in this URL.
//
// SO A `rulesPage` COULD ONLY BE BUILT HERE BY PICKING A DEFAULT SIZE, and
// picking one is an editorial decision no document in the corpus makes. OQ-M9-01
// is answered as "one size at a time with a selector, on the same URL as the
// comparison", which describes the child route and leaves the parent's content
// unstated. Choosing the smallest, or the first, or the most popular would be
// this file deciding which size a trader sees first on the page whose entire
// subject is the contract they will be enforced against.
//
// WHAT IT RENDERS INSTEAD IS THE SELECTOR, built from `planCard`'s own sizes so
// that the labels and the addresses are the same ones every other surface uses.
// The choice a reader makes here lands on a page that DOES have a model.
// =============================================================================

import type { Metadata } from 'next';
import type { ReactElement } from 'react';

import { planCard } from '../../../../routes/plans.ts';
import { planPage } from '../../../../routes/page.ts';
import { planVersionRulesPath } from '../../../../routes/paths.ts';
import { Surface, Unavailable, envelopeMetadata } from '../../../chrome.tsx';
import { siteBuild, siteCatalog, siteDisclosure } from '../../../build.ts';

interface RulesParams {
  readonly params: Promise<{ readonly slug: string }>;
}

export async function generateStaticParams(): Promise<readonly { readonly slug: string }[]> {
  const read = await siteCatalog(siteBuild());
  if (read.kind !== 'read') return [];
  return read.catalog.versions.map((version) => ({ slug: version.public_slug }));
}

export async function generateMetadata({ params }: RulesParams): Promise<Metadata> {
  const { slug } = await params;
  const build = siteBuild();
  const read = await siteCatalog(build);
  if (read.kind !== 'read') return { title: 'Rules' };

  const version = read.catalog.versions.find((candidate) => candidate.public_slug === slug);
  if (version === undefined) return { title: 'Rules' };

  const disclosure = await siteDisclosure(build).catch(() => null);
  if (disclosure === null) return { title: `${version.plan_name} rules` };

  return envelopeMetadata(
    planPage({
      path: planVersionRulesPath(version),
      title: `${version.plan_name} rules`,
      version,
      built_at: read.catalog.built_at,
      disclosure,
    }),
  );
}

export default async function RulesSelectorPage({ params }: RulesParams): Promise<ReactElement> {
  const { slug } = await params;
  const build = siteBuild();
  const read = await siteCatalog(build);

  if (read.kind !== 'read') {
    return (
      <>
        <h1>Rules</h1>
        <Unavailable surface={`/plans/${slug}/rules`} reason={read.reason} />
      </>
    );
  }

  const version = read.catalog.versions.find((candidate) => candidate.public_slug === slug);
  const disclosure = await siteDisclosure(build).catch(() => null);

  if (version === undefined || disclosure === null) {
    return (
      <>
        <h1>Rules</h1>
        <Unavailable
          surface={`/plans/${slug}/rules`}
          reason={
            version === undefined
              ? 'No plan version with this address was in the catalog this build read.'
              : 'This build read no simulated-environment disclosure, and INV-M9-05 makes ' +
                'that block a precondition of a page rather than a decoration on one.'
          }
        />
      </>
    );
  }

  const envelope = planPage({
    path: planVersionRulesPath(version),
    title: `${version.plan_name} rules`,
    version,
    built_at: read.catalog.built_at,
    disclosure,
  });
  const card = planCard(version);

  return (
    <Surface envelope={envelope}>
      <p>{card.cadence_copy}</p>
      <p>
        The rules are published one account size at a time, because every figure in them is that
        size&apos;s own row. Choose a size to read the rules it is sold under.
      </p>
      <ul data-testid="size-selector">
        {card.sizes.map((size) => (
          <li key={size.path}>
            <a href={size.path}>{size.label}</a>
          </li>
        ))}
      </ul>
    </Surface>
  );
}
