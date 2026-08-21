// =============================================================================
// apps/site
// =============================================================================
// Public marketing, plans, rules pages, stats, legal.
//
// Static and cacheable, and it renders rules FROM plan versions so that
// marketing cannot drift from the engine (OVERVIEW section 3). That is the
// whole reason this is an application rather than a set of pages: a rule
// published on a price card is read from the account's pinned plan version, not
// copied into a headline.
//
// -----------------------------------------------------------------------------
// WHAT IS HERE, AND WHAT SHAPE IT IS IN
// -----------------------------------------------------------------------------
// EVERY SURFACE IS A PURE FUNCTION FROM CONFIG TO A PAGE MODEL, and no
// rendering framework has been chosen. M9 section 1.1 names "a fast statically
// generated Next.js application", and that is a hosting and templating decision
// that costs a dependency; what it templates is this. Building the page models
// first is what makes M9 section 8.3's coverage rule expressible at all: "Every
// value rendered on a public page is asserted equal to the same value fetched
// from the API in the same test run", which is a test over values and not over
// markup.
//
// THE CONTROLS THIS SESSION LANDED, EACH AS A SHAPE RATHER THAN A RULE:
//
//   INV-M9-01  no plan parameter is a literal here. Every figure comes off a
//              `plan_version_sizes` row and every ratio off `plan_versions.rules`
//   INV-M9-02  the rules page has no prose of its own. `assertRuleTextIsPublished`
//   INV-M9-03  a version-derived page cannot be built without its version stamp
//   INV-M9-04  `derivedPaths` derives the invalidation set rather than listing it
//   INV-M9-05  `page()` refuses to return a page with no disclosure
//   INV-M9-06  no numerator meets a denominator anywhere in this package
//   INV-M9-08  the cadence is `win_days.required_count`, never the digit 3
//   INV-M9-09  `payoutCopyOmitsALeg`, in both directions
//   INV-M9-11  `versionPageMeta`, and two booleans rather than one
//   INV-M9-12  `renderSizeFigures` is never given the label
//   INV-M9-13  `marketedSizeLabel()` leaves GS-310 one absent case
//
// -----------------------------------------------------------------------------
// WHAT IS DELIBERATELY NOT HERE
// -----------------------------------------------------------------------------
// GS-143's `<PlanValue>` COMPONENT AND VG-M9-2's CONTENT LINT ARE P4's WORK,
// not this session's (P1 section 2.3, tier 3). INV-M9-07 calls that lint "the
// single most important control in the module and the one most likely to be
// argued with", and it is a build-time lint over MDX rather than a function, so
// it lands with the framework that compiles the MDX. Nothing here weakens it and
// nothing here substitutes for it.
//
// GS-146's OPERATOR CHECK IS THE PUBLISH PATH'S. A `copy_block` whose wording
// contradicts its rule's operator fails validation ([M01](M01) section 2.4)
// rather than reaching a page, and a second implementation of a mechanical
// mapping in the renderer would disagree with the first the day one moved.
//
// SD-M9-04's MIGRATION IS OWED. `plan_version_sizes` carries no
// `marketed_size_label` column on this ref; M9 section 2.1 says the migration
// "is owed and is not written here", and `packages/**` was outside this
// session's fence. The field is modelled at its stated nullability so the
// rendering rule and GS-310's single absent case are real the day it lands, and
// DEP-M9-07's `API_CONTRACT` amendment is owed with it.
//
// NO ADAPTER EXISTS. `catalog/ports.ts` declares the read boundary and opens no
// connection, which is `apps/worker`'s idiom and `packages/db`'s own: what is
// real is the rendering and the rules, what is not is the wiring, and the
// difference is visible in the type rather than left to a reader.
// =============================================================================

import { SITE_SURFACES } from './routes/paths.js';

/** The Railway service this app deploys as (INFRA section 2). */
export const SERVICE = 'site' as const;

// -----------------------------------------------------------------------------
// What a build reads
// -----------------------------------------------------------------------------
export type {
  BuiltAt,
  CopyBlocks,
  MarketedSizeLabel,
  SiteCatalog,
  SitePlanVersionView,
  SiteSizeView,
  SupersededBy,
} from './catalog/types.js';
export { MarketedSizeLabelError, marketedSizeLabel } from './catalog/types.js';

export type {
  CatalogReadPort,
  ContentReadPort,
  GeoLookupPort,
  RevalidationFailedEvent,
  RevalidationRequest,
  RevalidationResult,
  RevalidationStatus,
  SitePorts,
  StatsReadPort,
} from './catalog/ports.js';

export type { ContentDocument, ContentKind } from './content/documents.js';
export { isLive } from './content/documents.js';

export type {
  PublishedStatistic,
  StatisticMeasure,
  StatisticUnit,
  StatsPublication,
  StatsStaleEvent,
} from './stats/published.js';

// -----------------------------------------------------------------------------
// How a figure becomes a string
// -----------------------------------------------------------------------------
export { CentsFormatError, basisPoints, money } from './render/cents.js';
export type { RenderedCapStep, SizeFigures } from './render/size-label.js';
export {
  hasMarketedLabel,
  renderSizeFigures,
  renderSizeLabel,
  sizeSegment,
} from './render/size-label.js';

// -----------------------------------------------------------------------------
// The disclosures a page may not be missing
// -----------------------------------------------------------------------------
export type { DisclosureForm, SimulatedEnvironmentDisclosure } from './render/disclosure.js';
export {
  CANONICAL_PAYOUT_COPY,
  DisclosureError,
  assertSimulatedDisclosurePresent,
  payoutCopyOmitsALeg,
} from './render/disclosure.js';

export type { CadenceBinding, CadenceClaim } from './render/cadence.js';
export {
  cadenceClaim,
  cadenceCopyPublishesADominatedGap,
  renderCadenceCopy,
} from './render/cadence.js';

// -----------------------------------------------------------------------------
// The surfaces
// -----------------------------------------------------------------------------
export type { SiteSurface, VersionPageMeta } from './routes/paths.js';
export {
  SITE_SURFACES,
  contentLivePath,
  contentVersionPath,
  derivedPaths,
  planVersionPath,
  planVersionRulesPath,
  planVersionSizePath,
  versionPageMeta,
} from './routes/paths.js';

export type {
  PageEnvelope,
  PageInput,
  PlanPageInput,
  RenderedVersionStamp,
} from './routes/page.js';
export { page, planPage } from './routes/page.js';

export type { PlanCard, PlanSizeCard, PlansPage } from './routes/plans.js';
export { builtAt, planCard, planSizeCard, plansPage, sellableVersions } from './routes/plans.js';

export type { RuleBlock, RulesPage, RulesPageInput, SizeChoice } from './routes/rules.js';
export {
  RulesPageError,
  assertRuleTextIsPublished,
  ruleBlocks,
  rulesPage,
} from './routes/rules.js';

export type { RenderedStatistic, StatsPage } from './routes/stats.js';
export {
  StatsRenderError,
  assertWindowAttached,
  renderStatistic,
  statisticText,
  statsPage,
  statsStaleness,
} from './routes/stats.js';

export type {
  ContentPage,
  ContentPageInput,
  LegalIndexEntry,
  LegalIndexPage,
} from './routes/legal.js';
export { contentPage, legalIndex } from './routes/legal.js';

export type { GeoDisposition, GeoNotice } from './routes/geo.js';
export { geoNotice } from './routes/geo.js';

/**
 * Not a server yet. It is a deployable that starts.
 *
 * The rendering is real and the hosting is not: there is no adapter behind
 * `SitePorts` and no framework compiling these models into markup. Printing the
 * surface inventory is the honest thing for this entry point to do, because it
 * reports what exists rather than implying a server that does not.
 */
export function main(): void {
  console.log(`merit ${SERVICE}: ${SITE_SURFACES.length} static surfaces, no adapter yet`);
}
