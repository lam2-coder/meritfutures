// =============================================================================
// apps/site/src/routes/plans.ts
// =============================================================================
// PG-M9-02. THE PAGE WHERE EVERY NUMBER HAS A LIVE CONSEQUENCE AT CHECKOUT.
//
// M9 section 1.1 names why this surface is unlike the rest: "Every number on it
// is a config value with a live consequence at checkout. A stale render is a
// price Merit will not honor."
//
// SO THERE IS NOTHING TO RENDER FROM EXCEPT THE CATALOG, and this file has no
// argument other than one. It cannot fall back to a default price, cannot
// substitute a plan name for a missing size, and cannot decide that a plan with
// no sellable version should still appear with last year's figures. Each of
// those is a line somebody would write under deadline, and each of them is
// FM-M9-01 with a friendlier cause.
//
// WHAT COUNTS AS SELLABLE IS TWO COLUMNS AND NOT ONE. `public_visible` is false
// while a version is published-for-engine and not yet on sale, and
// `superseded_by` is set once a newer version exists. A version fails to be
// sellable for either reason, and INV-M9-11's "never the default" is the same
// sentence read from the pricing page: a superseded version has a permanent
// page and no place on this one.
//
// AND THE ORDERING IS THE CONTROL, WHICH IS NOT THIS FILE'S JOB TO IMPLEMENT.
// INV-M9-04 makes a version purchasable only after revalidation returns, so
// this page is correct because the publish path waited, not because the page
// checked. AS-M9-01's counter is ordering rather than freshness, and a
// freshness check added here would be the second mechanism that looks like the
// first and does not do its work.
// =============================================================================

import type { BuiltAt, SiteCatalog, SitePlanVersionView, SiteSizeView } from '../catalog/types.ts';
import { renderCadenceCopy } from '../render/cadence.ts';
import type { SimulatedEnvironmentDisclosure } from '../render/disclosure.ts';
import type { SizeFigures } from '../render/size-label.ts';
import { hasMarketedLabel, renderSizeFigures, renderSizeLabel } from '../render/size-label.ts';
import type { PageEnvelope } from './page.ts';
import { page } from './page.ts';
import { planVersionPath, planVersionRulesPath, planVersionSizePath } from './paths.ts';

/**
 * The versions a pricing page may show.
 *
 * Exported because the config-render parity suite compares this set against
 * `GET /plans`, and a test that re-derived "sellable" with its own predicate
 * would be asserting two implementations agree rather than asserting the page
 * is right.
 */
export function sellableVersions(catalog: SiteCatalog): readonly SitePlanVersionView[] {
  return catalog.versions.filter((v) => v.public_visible && v.superseded_by === null);
}

/** One size, as the pricing page shows it. */
export interface PlanSizeCard {
  /** GS-309 and GS-310. The label, or the capital figure when there is none. */
  readonly label: string;
  /** Whether the label above is Merit's words or the row's own number. */
  readonly label_is_marketed: boolean;
  /** The permanent per-size address, keyed by `size_cents`. */
  readonly path: string;
  /** Every figure, and every one of them from the row. */
  readonly figures: SizeFigures;
}

/** One plan, as the pricing page shows it. */
export interface PlanCard {
  readonly plan_code: string;
  readonly plan_name: string;
  readonly version: number;
  readonly path: string;
  readonly rules_path: string;
  /** INV-M9-08, derived from this version's own config. */
  readonly cadence_copy: string;
  readonly sizes: readonly PlanSizeCard[];
}

/** PG-M9-02's model. */
export interface PlansPage {
  readonly envelope: PageEnvelope;
  readonly plans: readonly PlanCard[];
}

/**
 * PG-M9-02, built from the catalog and from nothing else.
 *
 * THE ENVELOPE IS `page` AND NOT `planPage`, and the choice is deliberate
 * rather than an oversight. INV-M9-03 requires a page to state "the plan
 * version it renders", singular, and this page renders several: a stamp naming
 * one of them would be a page claiming to describe a version it only partly
 * describes. Each card links to its version's own page, which carries the stamp
 * for that version, and the index carries the build moment for all of them.
 */
export function plansPage(
  catalog: SiteCatalog,
  disclosure: SimulatedEnvironmentDisclosure | null,
): PlansPage {
  return {
    envelope: page({
      path: '/plans',
      title: 'Plans and pricing',
      indexable: true,
      built_at: catalog.built_at,
      disclosure,
    }),
    plans: sellableVersions(catalog).map(planCard),
  };
}

/** One sellable version, as a card. */
export function planCard(version: SitePlanVersionView): PlanCard {
  return {
    plan_code: version.plan_code,
    plan_name: version.plan_name,
    version: version.version,
    path: planVersionPath(version),
    rules_path: planVersionRulesPath(version),
    cadence_copy: renderCadenceCopy(version.rules),
    sizes: version.sizes.map((size) => planSizeCard(version, size)),
  };
}

/**
 * One size, as a card.
 *
 * `renderSizeLabel` and `renderSizeFigures` are called SEPARATELY and the
 * second is not given the first's output. That is GS-309's structural half
 * arriving at the page rather than staying in the render helpers: the label and
 * the figures reach this object from two functions that share no argument, so
 * there is no call site at which one could have produced the other.
 */
export function planSizeCard(version: SitePlanVersionView, size: SiteSizeView): PlanSizeCard {
  return {
    label: renderSizeLabel(size),
    label_is_marketed: hasMarketedLabel(size),
    path: planVersionSizePath(version, size),
    figures: renderSizeFigures(size.row, size.price_cents, size.reset_price_cents),
  };
}

/**
 * The build moment, restated for a caller that has a page and wants the stamp.
 *
 * Trivial, and it exists so that a footer component reads the envelope rather
 * than being handed a `BuiltAt` alongside it. Two paths to one value is how a
 * footer ends up stamping a different moment from the JSON-LD on the same page,
 * which INV-M9-03 requires to agree.
 */
export function builtAt(envelope: PageEnvelope): BuiltAt {
  return envelope.built_at;
}
