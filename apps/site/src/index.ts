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
// VG-M9-2's CONTENT LINT LANDED IN P4-j AND IS NOW `content/lint.ts`. It was
// P1's to leave out (P1 section 2.3, tier 3) and this note recorded the reason;
// what that reason got wrong is worth keeping rather than deleting. It said the
// lint "lands with the framework that compiles the MDX", and no framework
// compiles anything here: `next build` still exits 1 on "Couldn't find any
// `pages` or `app` directory", and an App Router file under `apps/*/src/app/` is
// CI-07's dated arrival condition, which is `P4-i`'s cell rather than `P4-j`'s.
// So the lint is a check over the AUTHORED SOURCE and over the page models built
// from it, which is where "the build fails" is expressible today. GS-143 and
// GS-144 assert against that.
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
// THE ADAPTER EXISTS NOW AND IT IS AN HTTP CLIENT, WHICH IS A RULING RATHER THAN
// A CHOICE THIS PACKAGE MADE. [ADR-096](docs/decisions/ADR-096.md) ruling 1:
// `apps/site` "reads over HTTP, against the public API, and holds no database
// connection of any kind... It opens no pool, holds no credential, and imports
// nothing from `packages/db`." `catalog/adapter.ts` is that client and
// `catalog/ports.ts` is unchanged by it: the boundary was declared before the
// implementation existed, which is what let the ruling land after the ports and
// change nothing above them.
//
// WHAT THE ADAPTER STILL CANNOT REACH IS NAMED IN ITS OWN HEADER AND IS NOT
// PAPERED OVER. Three of M9's five endpoints are in no contract, the archive
// half of `CatalogReadPort` has no collection address, and
// `readRestrictedCountries` has no endpoint anywhere (ADR-096 section 7). Each
// of those refuses loudly at the call site rather than returning a value this
// package invented.
// =============================================================================

import { SITE_SURFACES } from './routes/paths.ts';

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
} from './catalog/types.ts';
export { MarketedSizeLabelError, marketedSizeLabel } from './catalog/types.ts';

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
} from './catalog/ports.ts';

// -----------------------------------------------------------------------------
// What a build reads THROUGH: the ports, resolved over HTTP (ADR-096)
// -----------------------------------------------------------------------------
export type { FetchLike, HttpResponse, SiteAdapterConfig } from './catalog/adapter.ts';
export {
  CONTENT_LOCALE_PARAM,
  CONTENT_VERSION_PARAM,
  PLANS_PATH,
  PUBLIC_STATS_PATH,
  SiteAdapterError,
  UnservedEndpointError,
  contentEndpoint,
  createSitePorts,
  planVersionEndpoint,
} from './catalog/adapter.ts';

export type { ContentDocument, ContentKind } from './content/documents.ts';
export { isLive } from './content/documents.ts';

// -----------------------------------------------------------------------------
// VG-M9-2, the control INV-M9-07 calls the most important one in the module
// -----------------------------------------------------------------------------
export type {
  AuthoredSurface,
  ContentFinding,
  ContentRule,
  ContentSurface,
} from './content/lint.ts';
export {
  ContentLintError,
  PLAN_VALUE_ATTRIBUTES,
  SETTLEMENT_WINDOW_CARVE_OUT,
  STATISTIC_TAIL_STRIPPING_ATTRIBUTES,
  assertAuthoredContentIsClean,
  authoredSurfaces,
  lintAuthoredContent,
  statisticWithTail,
} from './content/lint.ts';

export type {
  PublishedStatistic,
  StatisticMeasure,
  StatisticUnit,
  StatsPublication,
  StatsStaleEvent,
} from './stats/published.ts';

// -----------------------------------------------------------------------------
// How a figure becomes a string
// -----------------------------------------------------------------------------
export { CentsFormatError, basisPoints, money } from './render/cents.ts';
export type { RenderedCapStep, SizeFigures } from './render/size-label.ts';
export {
  hasMarketedLabel,
  renderSizeFigures,
  renderSizeLabel,
  sizeSegment,
} from './render/size-label.ts';

// -----------------------------------------------------------------------------
// The disclosures a page may not be missing
// -----------------------------------------------------------------------------
export type { DisclosureForm, SimulatedEnvironmentDisclosure } from './render/disclosure.ts';
export {
  CANONICAL_PAYOUT_COPY,
  DisclosureError,
  assertSimulatedDisclosurePresent,
  payoutCopyOmitsALeg,
} from './render/disclosure.ts';

export type { CadenceBinding, CadenceClaim } from './render/cadence.ts';
export {
  cadenceClaim,
  cadenceCopyPublishesADominatedGap,
  renderCadenceCopy,
} from './render/cadence.ts';

// -----------------------------------------------------------------------------
// The surfaces
// -----------------------------------------------------------------------------
export type { SiteSurface, VersionPageMeta } from './routes/paths.ts';
export {
  SITE_SURFACES,
  contentLivePath,
  contentVersionPath,
  derivedPaths,
  planVersionPath,
  planVersionRulesPath,
  planVersionSizePath,
  versionPageMeta,
} from './routes/paths.ts';

export type {
  PageEnvelope,
  PageInput,
  PlanPageInput,
  RenderedVersionStamp,
} from './routes/page.ts';
export { page, planPage } from './routes/page.ts';

export type { PlanCard, PlanSizeCard, PlansPage } from './routes/plans.ts';
export { builtAt, planCard, planSizeCard, plansPage, sellableVersions } from './routes/plans.ts';

export type { RuleBlock, RulesPage, RulesPageInput, SizeChoice } from './routes/rules.ts';
export {
  RulesPageError,
  assertRuleTextIsPublished,
  ruleBlocks,
  rulesPage,
} from './routes/rules.ts';

export type { RenderedStatistic, StatsPage } from './routes/stats.ts';
export {
  StatsRenderError,
  assertWindowAttached,
  renderStatistic,
  statisticText,
  statsPage,
  statsStaleness,
} from './routes/stats.ts';

export type {
  ContentPage,
  ContentPageInput,
  LegalIndexEntry,
  LegalIndexPage,
} from './routes/legal.ts';
export { contentPage, legalIndex } from './routes/legal.ts';

export type { GeoDisposition, GeoNotice } from './routes/geo.ts';
export { geoNotice } from './routes/geo.ts';

// -----------------------------------------------------------------------------
// The OG image path, which GS-144 names and which was four comments until now
// -----------------------------------------------------------------------------
export type { OgCard, OgCardInput } from './routes/og.ts';
export { OgCardError, ogCard, ogCardText, ogImagePath } from './routes/og.ts';

/**
 * Not a server yet. It is a deployable that starts.
 *
 * THE WIRING IS REAL AND THE HOSTING IS STILL NOT. `createSitePorts` resolves
 * the four read ports over HTTP, and no framework compiles these models into
 * markup: `next build` in this directory exits 1 on "Couldn't find any `pages`
 * or `app` directory", which is `CI-07`'s dated condition and `P4-i`'s and
 * `P4-j`'s subject rather than this entry point's. Printing the surface
 * inventory is the honest thing for it to do, because it reports what exists
 * rather than implying a server that does not.
 *
 * It builds NO PORTS. Constructing them here would need a base URL, and a
 * default one is a production origin written into a package that must not have
 * an opinion about which deployment it is (`assertBaseUrl` refuses the empty
 * case for the same reason `resolveSurface` refuses a default surface).
 */
export function main(): void {
  console.log(
    `merit ${SERVICE}: ${SITE_SURFACES.length} static surfaces, ports read over HTTP, no pages yet`,
  );
}
