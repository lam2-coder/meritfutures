// =============================================================================
// apps/site/src/routes/paths.ts
// =============================================================================
// THE ROUTE TABLE, AND WHY A PLAN VERSION'S URL IS A COLUMN RATHER THAN A
// FORMULA.
//
// SD-M9-01 put `public_slug` on `plan_versions` and `0004_catalog.sql` records
// the reason on the column itself: "Deriving the URL from the version number
// would make the archive URL change whenever numbering does, which breaks
// exactly the links AS-M9-07 depends on: the trader who wants to show someone
// the rules their account was sold under." So every function below that
// addresses a version READS the slug. None of them builds one, and there is no
// `slugify` in this file for the same reason there is no `parseMarketedSize` in
// `size-label.ts`: a function that can construct an address is a function that
// can construct a DIFFERENT address for the same row next year.
//
// FM-M9-07 IS WHY THIS IS THE FILE THE LINK CHECK RUNS OVER. "A 404 on a rules
// page a trader was enforced against is an evidentiary problem as well as a
// marketing one", and [M06](M06)'s evidence packs carry the pinned version's
// `copy_blocks` on the assumption that the public artifact they came from is
// still reachable. `M9-K-01` walks every `public_slug` nightly; what it walks
// is the output of `planVersionPath`.
//
// GS-148 IS FOUR CLAIMS AND THIS FILE OWNS THREE OF THEM. A superseded
// version's URL "resolves, is labeled superseded, names its successor, and is
// excluded from indexing and navigation." The labelling is the page's;
// resolving, naming and exclusion are decided here, by `versionPageMeta`,
// because a page that decided its own indexability would decide it once per
// page and one of them would decide it differently.
//
// THE `PG-M9-nn` IDENTIFIERS BELOW ARE ONLY THE ONES M09 ITSELF NAMES, and the
// gap is deliberate rather than an omission. The frozen plan declares the
// series and uses exactly three of it: PG-M9-02 (plans and pricing), PG-M9-03
// (rules pages) and PG-M9-05 (stats). Numbering the other surfaces here would
// be this session allocating in a shared registry with no allocation table,
// which is the duplicate-key class WAVE-03 spent nine sessions on and which
// session 107 hit again inside the prompt asking for the gate that catches it.
// The other surfaces are real and carry no identifier until one is allocated.
// =============================================================================

import type { SitePlanVersionView, SiteSizeView } from '../catalog/types.js';
import { sizeSegment } from '../render/size-label.js';

// -----------------------------------------------------------------------------
// The surface inventory
// -----------------------------------------------------------------------------

/** A public surface, and what it is allowed to be. */
export interface SiteSurface {
  /** The `PG-M9-nn` identifier, where M09 allocates one. `null` otherwise. */
  readonly id: string | null;
  readonly path: string;
  readonly title: string;
  /** Whether a search engine may index it. INV-M9-11's second half. */
  readonly indexable: boolean;
  /** Whether it appears in a navigational path. Reachable by link is not the same. */
  readonly navigable: boolean;
}

/**
 * The static surfaces. Per-version pages are not here because they are one per
 * row, and a table that enumerated them would be a second copy of
 * `plan_versions` maintained by hand.
 *
 * THE STATS PAGE IS IN THE PRIMARY NAVIGATION ON LAUNCH DAY, which is OQ-M9-04
 * answered in the direction its own recommendation gives: "a transparency page
 * that appears once the numbers look good is not a transparency page." The
 * threshold below which a figure renders as "not yet meaningful" is M12's
 * (`statistic_definitions.min_sample`) and is not this module's to hold.
 *
 * THE RESTRICTED-JURISDICTION LIST IS A PAGE. AS-M9-04: "The restricted list is
 * published as a page, not only enforced at checkout, so the position is a
 * stated policy rather than an error message."
 */
export const SITE_SURFACES: readonly SiteSurface[] = [
  { id: null, path: '/', title: 'Home', indexable: true, navigable: true },
  { id: 'PG-M9-02', path: '/plans', title: 'Plans and pricing', indexable: true, navigable: true },
  {
    id: 'PG-M9-05',
    path: '/stats',
    title: 'Published statistics',
    indexable: true,
    navigable: true,
  },
  { id: null, path: '/faq', title: 'Frequently asked questions', indexable: true, navigable: true },
  { id: null, path: '/blog', title: 'Blog', indexable: true, navigable: true },
  { id: null, path: '/legal', title: 'Legal', indexable: true, navigable: true },
  {
    id: null,
    path: '/restricted-jurisdictions',
    title: 'Restricted jurisdictions',
    indexable: true,
    navigable: true,
  },
];

// -----------------------------------------------------------------------------
// Per-version addresses, which are permanent
// -----------------------------------------------------------------------------

/**
 * The permanent public URL for one plan version. SD-M9-01, INV-M9-11.
 *
 * It reads `public_slug` and nothing else. Not the version number, not the plan
 * code, and not the plan name: the first moves when numbering does, and the
 * other two are `plans` columns that a rename moves under every link ever
 * shared. OQ-M9-05 leaves `plans.name` mutable, which is exactly why no address
 * may be built out of it.
 */
export function planVersionPath(version: SitePlanVersionView): string {
  return `/plans/${version.public_slug}`;
}

/**
 * PG-M9-03. The rules page for one plan version.
 *
 * It is a child of the version's own address rather than a parallel `/rules/`
 * tree, so a superseded version's rules page inherits its parent's permanence
 * and its exclusion by construction. Two trees would need the supersession
 * policy applied twice, and AS-M9-07 is what happens when one copy of it is
 * missed.
 */
export function planVersionRulesPath(version: SitePlanVersionView): string {
  return `${planVersionPath(version)}/rules`;
}

/**
 * OQ-M9-01's proposal, as a path: one size at a time with a selector, on the
 * same URL as the comparison.
 *
 * THE SEGMENT IS `size_cents` AND NOT THE LABEL (M9 section 2.1). A label that
 * addressed a page would make a rename move every URL. `sizeSegment` is the one
 * function that derives it, and it lives with the label rules rather than here
 * so that the ban and the derivation are read together.
 */
export function planVersionSizePath(version: SitePlanVersionView, size: SiteSizeView): string {
  return `${planVersionRulesPath(version)}/${sizeSegment(size)}`;
}

/**
 * A versioned legal or content document's permanent address.
 *
 * `version` is required rather than optional, and that is the whole point.
 * SECURITY records acceptance against a version and "this module is where that
 * version resolves to words"; a bare `/legal/terms-of-service` is an address
 * whose content changes under a citation. The live document gets the same
 * treatment through {@link contentLivePath}, which is a different address on
 * purpose.
 */
export function contentVersionPath(kind: string, slug: string, version: number): string {
  return `/${kind}/${slug}/v${version}`;
}

/** The current version of a content document, for people rather than for citations. */
export function contentLivePath(kind: string, slug: string): string {
  return `/${kind}/${slug}`;
}

// -----------------------------------------------------------------------------
// GS-148: what a superseded version's page is allowed to be
// -----------------------------------------------------------------------------

/** What the build needs to know about one version's page. */
export interface VersionPageMeta {
  readonly path: string;
  readonly rules_path: string;
  /** INV-M9-11: superseded pages exist forever and are never the default. */
  readonly superseded: boolean;
  /** The successor's address, so the page can name it. `null` when current. */
  readonly successor_path: string | null;
  /**
   * The address a reader should be sent to instead. On a superseded page this
   * is the successor; on a current page it is the page itself.
   */
  readonly canonical_path: string;
  readonly indexable: boolean;
  readonly navigable: boolean;
}

/**
 * The supersession policy, decided once.
 *
 * "A superseded page is unmistakably labeled, states which version supersedes
 * it, and is excluded from indexing and from every navigational path, so it is
 * **reachable by link and unreachable by browsing**." That last phrase is the
 * whole design and it is two booleans rather than one: a page removed from
 * navigation but left indexable is still a landing page a stranger arrives on
 * from search, which is the accident INV-M9-11 forbids; a page removed from the
 * index but left in navigation is a page Merit itself walks people into.
 *
 * A VERSION THAT IS NOT `public_visible` IS ALSO EXCLUDED, and it is not the
 * same case. `plan_versions.public_visible` is false while a version is
 * published-for-engine and not yet on sale, so its page must exist (a pinned
 * account may already be enforced under it) and must not be advertised. The two
 * exclusions have different causes and one result, which is why they are
 * combined here rather than in a caller that would have to remember both.
 */
export function versionPageMeta(version: SitePlanVersionView): VersionPageMeta {
  const path = planVersionPath(version);
  const superseded = version.superseded_by !== null;
  const successorPath =
    version.superseded_by === null ? null : `/plans/${version.superseded_by.public_slug}`;
  const onSale = version.public_visible && !superseded;

  return {
    path,
    rules_path: planVersionRulesPath(version),
    superseded,
    successor_path: successorPath,
    canonical_path: successorPath ?? path,
    indexable: onSale,
    navigable: onSale,
  };
}
