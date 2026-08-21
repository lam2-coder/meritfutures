// =============================================================================
// apps/site/src/catalog/ports.ts
// =============================================================================
// THE SITE'S I/O BOUNDARY, DECLARED BEFORE ITS IMPLEMENTATION EXISTS.
//
// This is `apps/worker/src/batch/ports.ts`'s idiom one application over, and
// its argument carries unchanged: "There is no Drizzle client in this
// repository, no `pg` dependency in any manifest". Everything above this file
// is a pure function from config to a page model, which is what lets a rendering
// rule be tested without a database and what makes FM-M9-08's post-deploy
// digest meaningful. NOTHING HERE OPENS A CONNECTION.
//
// THE SITE'S BOUNDARY IS NARROWER THAN THE WORKER'S AND THE NARROWNESS IS A
// SECURITY PROPERTY RATHER THAN A STAGE OF CONSTRUCTION. INV-M9-10: "The
// marketing origin holds no session, no trader data, and no write path...
// the most-attacked and least-privileged surface in the estate is also the one
// with nothing to steal." So every port below is a READ, and the one write path
// M9 owns is declared in its own section with a comment saying where it runs.
//
// TWO ENDPOINTS ARE DELIBERATELY ABSENT AND THEIR ABSENCE IS THE DESIGN. M9
// section 4: there is no newsletter subscribe endpoint on this origin (it posts
// directly to [M10](M10)'s provider) and no contact form (support is M10's
// widget). "Each absence removes an unauthenticated write path from the most
// exposed origin in the estate." A port added here for either one would be that
// decision reversed without anybody deciding it.
//
// NOTHING ABOUT A VISITOR IS WRITTEN ANYWHERE. M9 section 2: "no analytics or
// visitor table... That keeps INV-M9-10 true by construction rather than by
// policy." There is no write port for a page view, and there is not going to be
// one.
// =============================================================================

import type { ContentDocument, ContentKind } from '../content/documents.js';
import type { StatsPublication } from '../stats/published.js';
import type { BuiltAt, SiteCatalog } from './types.js';

/**
 * `GET /plans` and `GET /plans/:planId/versions/:version`.
 *
 * IT RETURNS SUPERSEDED VERSIONS TOO, and that is the difference between this
 * port and the public catalog endpoint as a checkout would use it. INV-M9-11
 * requires every version to keep a page forever, so the build needs the archive
 * and not only the shelf; `sellableVersions` is what narrows it for the pricing
 * page, at the layer that renders rather than at the layer that reads.
 *
 * `built_at` is an ARGUMENT because the read is what stamps the build. A port
 * that returned a catalog and left the caller to stamp it would let two reads
 * in one build carry two moments, which INV-M9-03 requires to agree.
 *
 * DEP-M9-01 and DEP-M9-07 are what this port depends on and neither is
 * satisfied on this ref: the endpoints must carry `copy_blocks` alongside
 * `rules`, and each size's `marketed_size_label`. The API_CONTRACT amendment
 * DEP-M9-07 implies is owed and M9 section 4 says so in the same breath as
 * stating the requirement.
 */
export interface CatalogReadPort {
  readCatalog(built_at: BuiltAt): Promise<SiteCatalog>;
}

/**
 * `GET /public/stats`. M12's published aggregate.
 *
 * DEP-M9-03: M12 publishes with window, as-of day, sample size, and a method
 * reference. Without all four, "INV-M9-06 and AS-M9-03's counter both become
 * impossible; the page either computes its own numbers or publishes naked
 * ones", and this module refuses both, so a publication missing them fails the
 * build at `assertWindowAttached` rather than rendering.
 */
export interface StatsReadPort {
  readPublishedStats(): Promise<StatsPublication>;
}

/**
 * `GET /public/content/:kind/:slug`. Versioned content retrieval, for the build
 * and for permanent archive URLs.
 *
 * THE TWO READS ARE SEPARATE METHODS BECAUSE THEY ANSWER DIFFERENT QUESTIONS.
 * `readLive` answers "what does this document say now" and `readVersion`
 * answers "what did version 3 say", and a single method with an optional
 * version would make the second one reachable by forgetting an argument, which
 * is the wrong direction for a call whose answer is quoted in agreements.
 */
export interface ContentReadPort {
  readLive(kind: ContentKind, slug: string, locale: string): Promise<ContentDocument | null>;
  readVersion(
    kind: ContentKind,
    slug: string,
    locale: string,
    version: number,
  ): Promise<ContentDocument | null>;
  /** Every version of every document of a kind, for the archive and for M9-K-01. */
  listAll(kind: ContentKind, locale: string): Promise<readonly ContentDocument[]>;
}

/**
 * The edge geo lookup of M9 section 3.3.
 *
 * IT RETURNS `null` RATHER THAN THROWING WHEN THE LOOKUP IS UNAVAILABLE, and
 * that shape is FM-M9-04's "fail open on the notice and closed at checkout"
 * expressed in the signature. The notice is courtesy; the control is server side
 * at [M3](M03) and [M19](M19) and is unaffected by anything this port does or
 * fails to do.
 *
 * AS-M9-04: "It is defeated by a VPN and is expected to be, which is why it is
 * documented as a notice rather than as a control."
 */
export interface GeoLookupPort {
  /** The visitor's country, or `null` when the edge could not say. */
  lookupCountry(): Promise<string | null>;
  /** `geo_restrictions`, the SAME table checkout and campaign targeting read (DEP-M9-04). */
  readRestrictedCountries(): Promise<readonly string[]>;
}

/** Everything a build reads. Assembled once, passed down, never widened. */
export interface SitePorts {
  readonly catalog: CatalogReadPort;
  readonly stats: StatsReadPort;
  readonly content: ContentReadPort;
  readonly geo: GeoLookupPort;
}

// -----------------------------------------------------------------------------
// The one write path, which does not run on this origin
// -----------------------------------------------------------------------------

/**
 * `POST /internal/revalidate`. Owned by M9 and NOT reachable from the public
 * internet.
 *
 * M9 section 4: "Called by the publish action and by content publishing. Admin
 * origin and service credential only, path allowlisted, never reachable from the
 * public internet." It is declared in this package because M9 owns its contract
 * and because SD-M9-03's row is the audit trail INV-M9-04 waits on, and it is
 * declared in its own section because a reader who skims must not come away
 * thinking the marketing origin has a write path.
 *
 * INV-M9-04 makes the CALLER's ordering the control: "The publish action is not
 * complete until revalidation returns... Ordering is the control, not a cache
 * TTL." That ordering lives in [M3](M03)'s publish transaction, so nothing in
 * this package can enforce it and nothing in this package should pretend to.
 */
export interface RevalidationRequest {
  /** `page_revalidations.trigger`: `plan_version_published`, `content_published`. */
  readonly trigger: string;
  /** The plan version or content document that caused it. */
  readonly reference_id: string | null;
  /** Every derived path. `page_revalidations_has_paths` requires at least one. */
  readonly paths: readonly string[];
}

/** `page_revalidations.status`. A settled row always carries `completed_at`. */
export type RevalidationStatus = 'pending' | 'ok' | 'failed';

/** One `page_revalidations` row (SD-M9-03), as the caller sees it come back. */
export interface RevalidationResult {
  readonly id: string;
  readonly status: RevalidationStatus;
  readonly requested_at: string;
  readonly completed_at: string | null;
}

/**
 * `site.revalidation_failed`. M9 section 5's field set, verbatim.
 *
 * It BLOCKS the plan version from becoming purchasable when the trigger was a
 * plan publish (INV-M9-04), which is the safe direction: "A failure leaves the
 * old version on sale, which is the direction that costs Merit a delay rather
 * than costing a trader a surprise."
 */
export interface RevalidationFailedEvent {
  readonly trigger: string;
  readonly reference_id: string | null;
  readonly paths: readonly string[];
  readonly error: string;
}

// The paths a publish must invalidate are `derivedPaths` in `routes/paths.ts`,
// beside the functions that address those pages. They are DERIVED FROM THE
// VERSION RATHER THAN LISTED, because a hand-maintained list of derived paths
// is a hand-maintained count in a different costume and it drifts the same way:
// the day a fourth per-version surface is added, the list is short by one and
// the publish reports ok having revalidated three of four.
