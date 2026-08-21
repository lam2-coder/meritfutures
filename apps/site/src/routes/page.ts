// =============================================================================
// apps/site/src/routes/page.ts
// =============================================================================
// THE LAYOUT ENVELOPE, WHICH IS WHERE INV-M9-05 AND INV-M9-03 STOP BEING
// SOMETHING EACH PAGE HAS TO REMEMBER.
//
// INV-M9-05's enforcement column is one clause long and it is the design: "A
// layout-level component, so a new page cannot omit it by being new." A page
// built by calling `page()` cannot reach the build without a disclosure,
// because the function refuses to return one. That is a different control from
// a checklist, and the difference shows up eighteen months from now when
// somebody adds the ninth surface.
//
// INV-M9-03 IS THE SAME SHAPE POINTED AT CITEABILITY: "Every published page
// states the plan version it renders and the moment it was built... A public
// page that cannot say which version it describes is unciteable, and it will be
// cited (AS-M9-07)." So a page derived from a plan version carries the stamp in
// its type, and `planPage` is the only way to build one.
//
// THE STAMP IS `version` AND `public_slug` TOGETHER, and carrying both is not
// redundancy. The number is what a human quotes in a dispute and the slug is
// what resolves to the document; AS-M9-07 is a trader and a support agent
// reading two different things while both believe they are reading the account's
// rules, and closing that needs the human-facing label and the machine-facing
// address to travel as one value.
// =============================================================================

import type { BuiltAt, SitePlanVersionView } from '../catalog/types.js';
import type { SimulatedEnvironmentDisclosure } from '../render/disclosure.js';
import { assertSimulatedDisclosurePresent } from '../render/disclosure.js';
import { versionPageMeta } from './paths.js';

/**
 * INV-M9-03's version stamp: what this page describes, in both the form a human
 * quotes and the form a machine resolves.
 */
export interface RenderedVersionStamp {
  readonly plan_code: string;
  readonly version: number;
  readonly public_slug: string;
  /** INV-M9-11. A superseded page says so in the stamp, not only in the prose. */
  readonly superseded: boolean;
  /** The successor's address, when there is one. */
  readonly successor_path: string | null;
}

/** What every page carries regardless of what it is about. */
export interface PageEnvelope {
  readonly path: string;
  readonly title: string;
  /** INV-M9-11, and GS-148's third claim. */
  readonly indexable: boolean;
  readonly canonical_path: string;
  /** INV-M9-03. Supplied by the build, never read from a clock. */
  readonly built_at: BuiltAt;
  /** INV-M9-03. `null` only on a page that renders no plan version. */
  readonly renders_version: RenderedVersionStamp | null;
  /** INV-M9-05. Present on every page or the build fails. */
  readonly disclosure: SimulatedEnvironmentDisclosure;
}

/** What a caller supplies to build a page that renders no plan version. */
export interface PageInput {
  readonly path: string;
  readonly title: string;
  readonly indexable: boolean;
  readonly built_at: BuiltAt;
  readonly disclosure: SimulatedEnvironmentDisclosure | null;
}

/**
 * A page that renders no plan version: home, FAQ, blog, the restricted list.
 *
 * `disclosure` is typed nullable ON PURPOSE. A caller that already had a
 * non-null value would make the check below unreachable and the invariant would
 * hold by the type rather than by the control, which sounds better and is
 * worse: the value arrives from content at build time, so `null` is what a
 * missing legal document actually produces, and this is the layer that has to
 * refuse it.
 */
export function page(input: PageInput): PageEnvelope {
  assertSimulatedDisclosurePresent(input.disclosure, input.path);

  return {
    path: input.path,
    title: input.title,
    indexable: input.indexable,
    canonical_path: input.path,
    built_at: input.built_at,
    renders_version: null,
    disclosure: input.disclosure,
  };
}

/**
 * A page derived from one plan version. The only way to build one.
 *
 * Indexability and the canonical address are NOT parameters. They are decided
 * by `versionPageMeta` from the version's own row, so a caller cannot index a
 * superseded page by passing `true`, and a page cannot be its own canonical
 * while a successor exists. GS-148's exclusion is a property of the row rather
 * than of the call site.
 *
 * `path` IS a parameter, because a version has several pages (the version page,
 * its rules page, its per-size pages) and they share one stamp and one policy.
 */
export function planPage(input: PlanPageInput): PageEnvelope {
  assertSimulatedDisclosurePresent(input.disclosure, input.path);

  const meta = versionPageMeta(input.version);

  return {
    path: input.path,
    title: input.title,
    indexable: meta.indexable,
    canonical_path: meta.superseded ? (meta.successor_path ?? input.path) : input.path,
    built_at: input.built_at,
    renders_version: {
      plan_code: input.version.plan_code,
      version: input.version.version,
      public_slug: input.version.public_slug,
      superseded: meta.superseded,
      successor_path: meta.successor_path,
    },
    disclosure: input.disclosure,
  };
}

/** What a caller supplies to build a page derived from a plan version. */
export interface PlanPageInput {
  readonly path: string;
  readonly title: string;
  readonly version: SitePlanVersionView;
  readonly built_at: BuiltAt;
  readonly disclosure: SimulatedEnvironmentDisclosure | null;
}
