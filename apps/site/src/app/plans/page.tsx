// =============================================================================
// apps/site/src/app/plans/page.tsx
// =============================================================================
// `/plans`. PG-M9-02, the surface M09 section 1.1 calls the riskiest of the
// three: "Every number on it is a config value with a live consequence at
// checkout. A stale render is a price Merit will not honor."
//
// EVERY FIGURE IS `plansPage`'s AND NONE IS THIS FILE'S. `routes/plans.ts`
// builds the cards, `render/size-label.ts` renders the figures off the row and
// `render/cents.ts` turns integer cents into a string. This module chooses
// elements and nothing else, which is what keeps INV-M9-01 a property of the
// package rather than a rule about this page.
//
// THE INDEX SHOWS SELLABLE VERSIONS ONLY, and that is `sellableVersions`
// deciding rather than this file filtering. A superseded version keeps its page
// forever (INV-M9-11) and is not on the shelf, which is two different facts
// that `routes/plans.ts` and `routes/paths.ts` already hold apart.
// =============================================================================

import type { ReactElement } from 'react';

import { plansPage } from '../../routes/plans.ts';
import { Figures, Surface, Unavailable } from '../chrome.tsx';
import { siteBuild, siteCatalog, siteDisclosure } from '../build.ts';

export const metadata = {
  title: 'Plans and pricing',
};

export default async function PlansIndexPage(): Promise<ReactElement> {
  const build = siteBuild();
  const read = await siteCatalog(build);
  const disclosure = await siteDisclosure(build).catch(() => null);

  if (read.kind !== 'read' || disclosure === null) {
    return (
      <>
        <h1>Plans and pricing</h1>
        <Unavailable
          surface="/plans"
          reason={read.kind === 'read' ? DISCLOSURE_MISSING : read.reason}
        />
      </>
    );
  }

  const model = plansPage(read.catalog, disclosure);

  return (
    <Surface envelope={model.envelope}>
      {model.plans.length === 0 ? (
        <p data-testid="no-sellable-plans">
          No plan version is on sale in this build of the catalog.
        </p>
      ) : (
        model.plans.map((plan) => (
          <section key={plan.path} data-testid="plan-card" data-plan-code={plan.plan_code}>
            <h2>
              <a href={plan.path}>{plan.plan_name}</a>
            </h2>
            <p>{plan.cadence_copy}</p>
            <p>
              <a href={plan.rules_path}>Rules for this version</a>
            </p>

            {plan.sizes.map((size) => (
              <article
                key={size.path}
                data-testid="plan-size-card"
                data-label-is-marketed={String(size.label_is_marketed)}
              >
                <h3>
                  <a href={size.path}>{size.label}</a>
                </h3>
                <Figures figures={size.figures} />
              </article>
            ))}
          </section>
        ))
      )}
    </Surface>
  );
}

/** The one reason this page can fail that is not about the catalog. */
const DISCLOSURE_MISSING =
  'This build read no simulated-environment disclosure, and INV-M9-05 makes that block a ' +
  'precondition of a page rather than a decoration on one.';
