// =============================================================================
// apps/site/src/catalog/types.ts
// =============================================================================
// WHAT A PUBLIC PAGE IS ALLOWED TO SEE, AND THE SHAPE THAT MAKES ADR-070'S
// RULING A COMPILE ERROR RATHER THAN A CONVENTION.
//
// M9 section 1.1: "the marketing site is a rendering of the configuration the
// engine executes, and every place it stops being that is a place where a
// promise and a rule can disagree". These types are that sentence given a
// shape. Every field below is a column or a jsonb key that exists in
// `0004_catalog.sql`, and nothing here is a value this application chose.
//
// THREE NAME FIELDS AND ONLY ONE OF THEM IS A NUMBER (M9 section 2.1,
// ADR-070 section 4). The plan display name names the plan, the marketed size
// label describes the size, and `size_cents` IS the size. INV-M9-12 says only
// the third is ever computed on, and the composition below is what enforces it:
//
//   * `PlanVersionSizeRow` arrives from `@merit/rules-engine` UNMODIFIED and
//     sits in its own field, `row`. It is the engine's own transcription of
//     `plan_version_sizes`, so every figure a surface renders is reached
//     through `size.row.*` and is by construction a stored cents value.
//   * `marketed_size_label` sits OUTSIDE `row`. M9 section 2.1: "It does not
//     appear on `PlanVersionSizeRow` and does not enter `validatePlan`, on
//     `types.ts`'s own stated rule that what the engine may not see, it may not
//     validate." Spreading the two into one flat object would put the label
//     inside the value handed to `resolvePlan`, and the ruling would survive
//     only as long as nobody wrote the obvious call.
//   * `MarketedSizeLabel` is an OPAQUE BRAND with no accessor that returns a
//     number. "Not parsed. Nothing anywhere reads a number back out of it."
//
// SD-M9-04 IS OWED AND IS NOT WRITTEN HERE. `plan_version_sizes` carries no
// `marketed_size_label` column on this ref; M9 section 2.1 states the migration
// is owed and the fence for this session is `apps/site/**`. The field is
// therefore modelled at its stated nullability (`text null`, with a CHECK that
// makes the empty string unwritable) so the render rule and GS-310's single
// absent case are both real the day the column lands. `marketedSizeLabel()`
// below is that CHECK, restated at the only boundary this application owns.
// =============================================================================

import type { Cents, PlanRulesJson, PlanVersionSizeRow } from '@merit/rules-engine';

// -----------------------------------------------------------------------------
// The marketed size label
// -----------------------------------------------------------------------------

/**
 * `plan_version_sizes.marketed_size_label` (SD-M9-04), as a display string and
 * as nothing else.
 *
 * THE BRAND IS THE WHOLE POINT AND IT IS NOT DECORATION. M9 section 2.1 lists
 * what the label may not be: not an input to anything, not the size selector's
 * key, not a URL segment, and not parsed. A bare `string` permits all four by
 * accident. A branded type permits none of them without a cast a reviewer can
 * see, and `renderSizeLabel` is the one function that consumes it.
 *
 * There is deliberately NO `parseMarketedSize`, no `toCents`, and no accessor
 * that returns anything but the string itself: "a capital figure, a runway and
 * a style name are all legitimate labels for the same row", so any function
 * that read a number out of one would be guessing which of the three it had.
 */
export type MarketedSizeLabel = string & { readonly __brand: 'MarketedSizeLabel' };

/**
 * SD-M9-04's `CHECK (marketed_size_label is null or btrim(...) <> '')`, at the
 * application boundary.
 *
 * **GS-310 HAS ONE ABSENT CASE BECAUSE OF THIS, NOT TWO.** M9 section 2.1: "the
 * empty string is **unwritable**: SD-M9-04's `CHECK` leaves `null` as the only
 * representation of absent, so there is exactly one case to render rather than
 * two." A constructor that accepted `''` would reintroduce the second case
 * here, one layer above the constraint, and the render rule would need a branch
 * the invariant says does not exist.
 *
 * It throws rather than returning null, because a blank label reaching this
 * function means a row exists that the database says cannot exist. Rendering
 * the GS-310 default over it would hide a broken constraint behind a correct
 * looking page, which is the disclosure failure FM-M9-09 is about wearing a
 * different hat.
 */
export function marketedSizeLabel(raw: string): MarketedSizeLabel {
  if (raw.trim() === '') {
    throw new MarketedSizeLabelError(
      'SD-M9-04 makes a blank marketed_size_label unwritable, so a blank one ' +
        'reaching the site means the CHECK is not on the column. Absent is null.',
    );
  }
  return raw as MarketedSizeLabel;
}

/** Thrown by {@link marketedSizeLabel}. Named so a caller can tell it apart. */
export class MarketedSizeLabelError extends Error {
  override readonly name = 'MarketedSizeLabelError';
}

// -----------------------------------------------------------------------------
// One purchasable size, as a public surface sees it
// -----------------------------------------------------------------------------

/**
 * One row of `plan_version_sizes`, plus the two commerce columns the engine's
 * transcription deliberately omits, plus the label.
 *
 * `price_cents` AND `reset_price_cents` ARE HERE AND NOT IN `row` for the
 * reason `PlanVersionSizeRow`'s own header gives: "No `CV-nn` mentions either,
 * no rule reads a price, and M01 section 1.2 puts commerce outside this
 * module." They are columns on the same table and a pricing page cannot be
 * built without them, so they are carried at this layer, where nothing
 * validates a plan.
 */
export interface SiteSizeView {
  /**
   * THE ENGINE'S ROW, UNTOUCHED. Every figure on a surface that names this size
   * is reached through here: the drawdown, the profit target, the buffer, the
   * win-day floor and the cap schedule. That is the second half of GS-309.
   */
  readonly row: PlanVersionSizeRow;

  /** `plan_version_sizes.price_cents`. */
  readonly price_cents: Cents;

  /** `plan_version_sizes.reset_price_cents`. */
  readonly reset_price_cents: Cents;

  /**
   * `plan_version_sizes.marketed_size_label` (SD-M9-04). `null` is absent, and
   * absent has a stated rendering (GS-310). Outside `row` on purpose.
   */
  readonly marketed_size_label: MarketedSizeLabel | null;
}

// -----------------------------------------------------------------------------
// One plan version
// -----------------------------------------------------------------------------

/**
 * `plan_versions.copy_blocks`, keyed by rule path.
 *
 * INV-M9-02: "Rule text on a public page is the pinned `copy_blocks` of the
 * plan version being displayed, verbatim". The value type is `string` and the
 * rules page has no template of its own to interpolate it into, because
 * AS-M9-05's seam is exactly the place a template would grow.
 */
export type CopyBlocks = Readonly<Record<string, string>>;

/**
 * What supersedes this version, when something does.
 *
 * INV-M9-11 requires a superseded page to be reachable, labeled, and to name
 * its successor, so the successor's slug is carried rather than looked up: a
 * page that has to query to say what replaced it is a page that renders without
 * saying so when the query fails.
 */
export interface SupersededBy {
  readonly version: number;
  readonly public_slug: string;
}

/** One `plan_versions` row and its sizes, as a public surface sees it. */
export interface SitePlanVersionView {
  readonly plan_id: string;
  /** `plans.code`. The stable identifier: `core_eod`, `merit_rapid`, `direct`. */
  readonly plan_code: string;
  /**
   * `plans.name`. THE ONE NAME FIELD THAT IS NOT VERSIONED, and OQ-M9-05 is the
   * open residual on that. Carried here beside a version because that is where
   * a page needs it, never because the version pins it.
   */
  readonly plan_name: string;
  readonly version: number;

  /** SD-M9-01. The permanent public URL segment. Never derived from `version`. */
  readonly public_slug: string;
  /** SD-M9-01. Published-for-engine and on-sale are two facts, not one. */
  readonly public_visible: boolean;

  /** ISO-8601 UTC. `null` while the version is a draft. */
  readonly published_at: string | null;
  /** `null` while this is the current version. INV-M9-11. */
  readonly superseded_by: SupersededBy | null;

  /** `plan_versions.rules`. STRUCTURE. Every cents value is on a size row. */
  readonly rules: PlanRulesJson;
  /** `plan_versions.copy_blocks`. INV-M9-02. */
  readonly copy_blocks: CopyBlocks;

  readonly sizes: readonly SiteSizeView[];
}

// -----------------------------------------------------------------------------
// The catalog, and the moment it was read
// -----------------------------------------------------------------------------

/**
 * The build stamp INV-M9-03 requires on every page, supplied rather than read.
 *
 * NOTHING IN THIS APPLICATION CALLS `Date.now()`, and that is the engine's rule
 * applied one layer out for a different reason. The engine may not read a clock
 * because it must be replayable; a renderer may not read one because two
 * renders of the same build must produce the same bytes, which is what makes
 * FM-M9-08's "build digest asserted post-deploy" checkable at all. The build
 * stamps this once and every page renders the same string.
 */
export type BuiltAt = string & { readonly __brand: 'BuiltAt' };

/** What one build read out of the catalog. */
export interface SiteCatalog {
  /** Every version a public page may render, current and superseded alike. */
  readonly versions: readonly SitePlanVersionView[];
  readonly built_at: BuiltAt;
}
