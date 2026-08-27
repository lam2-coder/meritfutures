// =============================================================================
// apps/site/src/app/build.ts
// =============================================================================
// WHAT THE BUILD READS WITH, RESOLVED ONCE.
//
// `catalog/ports.ts` declares the four reads and `catalog/adapter.ts` resolves
// them over HTTP (ADR-096 ruling 1). Neither of them decides WHERE the API is,
// and neither should: `SiteAdapterConfig` takes `apiBaseUrl` as a parameter and
// this file is the one place that answers it. That is the whole content of this
// module. No page model is built here and no figure is formatted here.
//
// -----------------------------------------------------------------------------
// AN UNCONFIGURED BUILD IS A STATE AND NOT A CRASH, AND THAT IS THE POINT
// -----------------------------------------------------------------------------
// There is no API to read on this ref. `next build` prerenders every static
// page, so a page that threw when the catalog was unreachable would make the
// deployable's own build the thing that fails, and a build step that fails is
// not a gate. Every read below therefore resolves to `unconfigured` or to a
// caught error, and a page renders what is true instead of inventing a number.
//
// THAT IS NOT A WEAKENING OF `INV-M9-05`, and the direction matters. The
// invariant is enforced by `page()` and `planPage()`, which throw on a missing
// disclosure, and this module never hands them one it did not read. A page with
// no disclosure does not render marketing copy without it; it renders no
// marketing copy at all.
//
// -----------------------------------------------------------------------------
// TWO VARIABLES, BOTH OWED TO `INFRA` SECTION 7
// -----------------------------------------------------------------------------
// INFRA section 2.1 rows the `site` service with `MERIT_API_SURFACE` "not set"
// and names no other variable for it, so neither name below is read off a
// document. They are declared here, in the app that reads them, and are carried
// as owed to the slice that holds INFRA rather than written into a frozen
// document from outside its fence.
// =============================================================================

import type { SitePorts } from '../catalog/ports.ts';
import type { BuiltAt, SiteCatalog } from '../catalog/types.ts';
import { createSitePorts } from '../catalog/adapter.ts';
import type { SimulatedEnvironmentDisclosure } from '../render/disclosure.ts';

/** The API origin and base path this build reads the public surface from. */
export const API_BASE_URL_VAR = 'MERIT_SITE_API_BASE_URL';

/** The build moment, supplied by the build. See {@link siteBuiltAt}. */
export const BUILT_AT_VAR = 'MERIT_SITE_BUILT_AT';

/**
 * The `content_documents` address the footer disclosure comes from.
 *
 * TAKEN FROM THE SUITE RATHER THAN CHOSEN HERE. `test/adapter.test.ts` builds
 * "the disclosure INV-M9-05 requires, built from a document read over HTTP"
 * from exactly this kind, slug and locale, so the wiring and the assertion
 * name the same row. A second spelling in this file would be the drift that
 * test exists to catch, discovered a year later on a page instead.
 */
export const DISCLOSURE_ADDRESS = {
  kind: 'legal',
  slug: 'simulated-environment',
  locale: 'en',
} as const;

/**
 * The environment a build reads its two variables out of.
 *
 * TYPED AS A PLAIN RECORD AND NOT AS `NodeJS.ProcessEnv`. The framework's own
 * `next-env.d.ts` augments `ProcessEnv` with a REQUIRED `NODE_ENV`, so a test
 * that supplies the two variables this module reads and nothing else could not
 * name the type it was passing. The functions below read two string keys and
 * care about nothing else, and this is that fact written down.
 */
export type SiteEnv = Readonly<Record<string, string | undefined>>;

/** A build that can read, or the reason it cannot. */
export type SiteBuild =
  | { readonly kind: 'wired'; readonly ports: SitePorts; readonly built_at: BuiltAt }
  | { readonly kind: 'unconfigured'; readonly reason: string };

/**
 * The build moment, read from the environment and never from a clock.
 *
 * `catalog/types.ts` states the rule on `BuiltAt` itself: "NOTHING IN THIS
 * APPLICATION CALLS `Date.now()` ... a renderer may not read one because two
 * renders of the same build must produce the same bytes, which is what makes
 * FM-M9-08's build digest asserted post-deploy checkable at all."
 *
 * A `Date.now()` here would satisfy "the build stamps this once" within one
 * build and falsify that sentence for every reader after. So the stamp is
 * SUPPLIED, and a build that was handed none has no stamp rather than a fresh
 * one.
 *
 * IT IS VALIDATED RATHER THAN TRUSTED. The brand on `BuiltAt` is a compile-time
 * marker and a cast is the only way to mint one, so the cast is made in exactly
 * one place and behind a shape check: an unparseable value would otherwise
 * reach INV-M9-03's version stamp and be rendered at a reader as the moment a
 * page describes.
 */
export function siteBuiltAt(env: SiteEnv = process.env): BuiltAt | null {
  const raw = env[BUILT_AT_VAR];
  if (raw === undefined || raw.trim() === '') return null;

  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(trimmed)) return null;

  return trimmed as BuiltAt;
}

/**
 * The four ports, or the reason there are none.
 *
 * `createSitePorts` refuses a base URL that is empty, relative or trailing
 * slashed, and it refuses by throwing. That refusal is caught here and becomes
 * a reason string, because an operator who set the variable wrongly should see
 * a page saying so rather than a build that died.
 */
export function siteBuild(env: SiteEnv = process.env): SiteBuild {
  const base = env[API_BASE_URL_VAR];
  const built_at = siteBuiltAt(env);

  if (base === undefined || base.trim() === '') {
    return {
      kind: 'unconfigured',
      reason:
        `${API_BASE_URL_VAR} is not set, so this build read no API. The public surface is ` +
        "rendered from `plan_versions` and from M12's published statistics, and this build " +
        'was handed no address to read either from.',
    };
  }

  if (built_at === null) {
    return {
      kind: 'unconfigured',
      reason:
        `${BUILT_AT_VAR} is not set to an ISO-8601 UTC instant, so this build carries no ` +
        'stamp. INV-M9-03 requires every page to state the moment it describes, and this ' +
        'application reads no clock to invent one with.',
    };
  }

  try {
    return { kind: 'wired', ports: createSitePorts({ apiBaseUrl: base.trim() }), built_at };
  } catch (cause) {
    return {
      kind: 'unconfigured',
      reason: `${API_BASE_URL_VAR} was refused: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
}

/**
 * The simulated-environment block INV-M9-05 requires, read from content.
 *
 * IT RETURNS `null` RATHER THAN MINTING ONE. `SimulatedEnvironmentDisclosure`
 * carries `document_version` and `document_slug` so that the block "can be
 * quoted in a dispute, and it will be"; a literal assembled in this file would
 * carry a provenance no row backs, which is the one move
 * `apps/portal/src/app/layout.tsx` refused by name when it had the same choice.
 *
 * `form` IS `short` BECAUSE THE SITE FOOTER TAKES THE SHORT FORM on every page
 * (TOS_CLAUSES section 2's inventory, quoted in `render/disclosure.ts`). The
 * full form is checkout's, which is M3's origin and not this one.
 */
export async function siteDisclosure(
  build: SiteBuild,
): Promise<SimulatedEnvironmentDisclosure | null> {
  if (build.kind !== 'wired') return null;

  const { kind, slug, locale } = DISCLOSURE_ADDRESS;
  const document = await build.ports.content.readLive(kind, slug, locale);
  if (document === null) return null;

  return {
    form: 'short',
    body: document.body_mdx,
    document_version: document.version,
    document_slug: document.slug,
  };
}

/** What one page got when it asked for the catalog. */
export type CatalogRead =
  | { readonly kind: 'read'; readonly catalog: SiteCatalog }
  | { readonly kind: 'absent'; readonly reason: string };

/**
 * The catalog, or the reason this page has none.
 *
 * FOUR SURFACES READ THE CATALOG (the pricing index and the three per-version
 * pages) and each of them fails in the same three ways: nothing configured, the
 * read threw, or the read returned a shape the adapter refused. Writing the
 * branch once means the four pages cannot disagree about what an unreadable
 * catalog looks like, which is the disagreement a reader would find as two
 * different empty states on two pages next year.
 *
 * THE ERROR IS LOGGED AND NOT RENDERED. `SiteAdapterError` messages name paths,
 * fields and status codes, which belong in a build log and not on a public
 * marketing page.
 */
export async function siteCatalog(build: SiteBuild): Promise<CatalogRead> {
  if (build.kind !== 'wired') return { kind: 'absent', reason: build.reason };

  try {
    return { kind: 'read', catalog: await build.ports.catalog.readCatalog(build.built_at) };
  } catch (cause) {
    console.error('the plan catalog could not be read', cause);
    return {
      kind: 'absent',
      reason:
        'The plan catalog could not be read from the API for this build. Every figure on a ' +
        'plans page comes from a `plan_versions` row, so this page renders none.',
    };
  }
}
