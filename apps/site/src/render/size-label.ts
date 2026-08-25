// =============================================================================
// apps/site/src/render/size-label.ts
// =============================================================================
// GS-309 AND GS-310, WHICH ARE ONE RULE READ FROM TWO SIDES.
//
// M9 section 2.1 states the rendering rule once "so every surface shares it":
// a surface that names a size renders the pinned version's
// `marketed_size_label`, and EVERY FIGURE ON THAT SAME SURFACE is computed from
// `size_cents`. The two never swap roles.
//
// THE LABEL IS THE ONE NUMBER-BEARING STRING ON THIS SITE THAT NO GATE CAN
// CHECK, and M9 section 2.1 says so in the sentence the fold exists for: "a
// capital figure, a runway and a style name are all legitimate labels for the
// same row, so deciding whether a label agrees with a number would require
// knowing what the label means, and the entire point of the field is that Merit
// chooses what it means." FM-M9-09 is that failure, and its detection is a
// human reading the publish diff, never anything in this file.
//
// SO WHAT THIS FILE CAN ENFORCE IS THE HALF THAT IS CHECKABLE, and it is the
// half GS-309 exists for: that the label reached NO COMPUTATION. M9 section 8.3
// puts it as sharply as it can be put: "A test that checks only that the label
// rendered passes on a page that also priced from it, which is the one failure
// GS-309 exists to catch." `renderSizeFigures` below is the shape that makes
// that structural rather than tested: it takes `PlanVersionSizeRow` and the two
// commerce columns, and the label is not in its argument list at all.
//
// GS-310'S ABSENT CASE HAS ONE BRANCH, NOT TWO. SD-M9-04's CHECK makes the
// empty string unwritable and `marketedSizeLabel()` restates it, so `null` is
// the only representation of absent that reaches here. "A dash, a placeholder
// and the plan name were each rejected": the first two render a size page with
// no size on it, and the third is already on the page and says nothing about
// this row.
// =============================================================================

import type { Cents, PlanVersionSizeRow, SizeCapScheduleStep } from '@merit/rules-engine';

import type { SiteSizeView } from '../catalog/types.ts';
import { money } from './cents.ts';

/**
 * What a surface calls this size. GS-309 and GS-310, in four lines.
 *
 * The label is rendered VERBATIM. INV-M9-12: "The label is rendered and never
 * parsed, never rounded, and never converted back into a number." There is no
 * trim, no title-casing and no truncation here, because every one of those is a
 * transformation of a disclosure, and a disclosure Merit transformed is a
 * disclosure Merit wrote.
 *
 * When it is absent the surface renders the capital figure derived from
 * `size_cents`, through the same `money()` every other cents value on the page
 * goes through. "It is the default that cannot be wrong: it is the internal
 * truth rendered directly, it is never empty."
 */
export function renderSizeLabel(size: SiteSizeView): string {
  return size.marketed_size_label ?? money(size.row.size_cents);
}

/**
 * Whether this size is being described by Merit or by its own number.
 *
 * A surface may legitimately want to say so, and the alternative is that each
 * one re-derives it with its own `!== null`, which is how one of them ends up
 * testing the rendered string instead. Nothing here reads the label's content.
 */
export function hasMarketedLabel(size: SiteSizeView): boolean {
  return size.marketed_size_label !== null;
}

/**
 * The size selector's key and the URL segment, derived from `size_cents`.
 *
 * M9 section 2.1: "Not the size selector's key and not a URL segment. Both stay
 * derived from `size_cents`. A label that addressed a page would make a rename
 * move every URL, which breaks exactly the permanence INV-M9-11 and AS-M9-07
 * are built on."
 *
 * IT IS THE CENTS AND NOT A PRETTIER DERIVATION, and that is a choice against
 * legibility on purpose. `25000` would be dollars, which is a second money unit
 * in the URL space; `50k` would be an abbreviation, which is the label wearing
 * a different hat and would move if the size ever moved to 50,001. The cents
 * value is the row's own identity, it is stable for the life of the version,
 * and a URL is read by a machine far more often than by a person.
 */
export function sizeSegment(size: SiteSizeView): string {
  return String(size.row.size_cents);
}

/**
 * Every figure a surface renders beside the label, and NOT the label.
 *
 * THE ARGUMENT LIST IS THE CONTROL. This function cannot price from the label
 * because it is never given one: it takes the engine's own row plus the two
 * commerce columns that row deliberately omits, and returns strings. GS-309
 * asserts these against values derived from `size_cents`; there is nothing here
 * for such an assertion to be vacuous about.
 *
 * `null` is carried through rather than defaulted. `profit_target_cents` is
 * null on Direct because there is no evaluation, and `daily_loss_limit_cents`
 * is null when a plan configures none. Rendering `$0.00` for either would be a
 * target of zero and a limit of zero, which are different and reachable things
 * (`0004_catalog.sql` says so on the column itself). The surface decides how to
 * say "there is none"; this function refuses to say it with a number.
 */
export function renderSizeFigures(
  row: PlanVersionSizeRow,
  price_cents: Cents,
  reset_price_cents: Cents,
): SizeFigures {
  return {
    size: money(row.size_cents),
    price: money(price_cents),
    reset_price: money(reset_price_cents),
    drawdown: money(row.drawdown_cents),
    profit_target: row.profit_target_cents === null ? null : money(row.profit_target_cents),
    buffer: money(row.buffer_cents),
    win_day_floor: money(row.win_day_floor_cents),
    daily_loss_limit:
      row.daily_loss_limit_cents === null ? null : money(row.daily_loss_limit_cents),
    floor_lock_at_profit:
      row.floor_lock_at_profit_cents === null ? null : money(row.floor_lock_at_profit_cents),
    floor_lock_floor_at:
      row.floor_lock_floor_at_cents === null ? null : money(row.floor_lock_floor_at_cents),
    payout_caps: row.payout_cap_schedule_cents.map(renderCapStep),
  };
}

/** One step of `payout_cap_schedule_cents`, rendered. */
function renderCapStep(step: SizeCapScheduleStep): RenderedCapStep {
  return { from_ordinal: step.from_ordinal, cap: money(step.cap_cents) };
}

/** One rendered step of the cap ladder. The ordinal is a count, not money. */
export interface RenderedCapStep {
  readonly from_ordinal: number;
  readonly cap: string;
}

/**
 * The rendered figures for one size.
 *
 * EVERY FIELD IS A STRING OR NULL, never a number, and that is the last piece
 * of GS-309's structural half. A caller handed `Cents` could do arithmetic on
 * it; a caller handed `"$25,000.00"` cannot, and INV-M9-06's "there is no
 * arithmetic in this module" then holds by what the type offers rather than by
 * what a reviewer noticed.
 */
export interface SizeFigures {
  readonly size: string;
  readonly price: string;
  readonly reset_price: string;
  readonly drawdown: string;
  /** `null` on Direct: no evaluation, so no target. */
  readonly profit_target: string | null;
  readonly buffer: string;
  readonly win_day_floor: string;
  /** `null` when the plan configures none. Every v1 plan does. */
  readonly daily_loss_limit: string | null;
  /** SD-10. Present exactly when the floor lock is enabled. */
  readonly floor_lock_at_profit: string | null;
  readonly floor_lock_floor_at: string | null;
  readonly payout_caps: readonly RenderedCapStep[];
}
