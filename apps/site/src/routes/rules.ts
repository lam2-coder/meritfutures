// =============================================================================
// apps/site/src/routes/rules.ts
// =============================================================================
// PG-M9-03. THE PAGE THAT IS THE IMPLEMENTATION RATHER THAN A DESCRIPTION OF
// ONE.
//
// M9 section 1.1: "The published `copy_blocks` are the contract a trader will
// be enforced against. This page is the implementation, not a description of
// it."
//
// SO THIS FILE HAS NO SENTENCES ABOUT RULES IN IT, and that absence is the
// module's central structural control. INV-M9-02: "The rules page has no prose
// of its own. The plain-English explainer **is** the `copy_blocks` content,
// authored with the plan version and published with it, so the marketing
// sentence and the executed rule change in the same commit and the same publish
// action." AS-M9-05 is what a template here would cost: the forensic reader's
// prize is not a wrong number, it is an operator, "you need to make at least
// $150 on five days" against `realized_pnl_cents >= win_day_floor_cents`, and a
// page that composed its own sentence around a config value would manufacture
// exactly that seam on every render.
//
// GS-146 IS NOT ENFORCED HERE AND THAT IS THE RIGHT BOUNDARY. "A `copy_block`
// whose wording contradicts its rule's operator fails validation rather than
// reaching a page", and the validation is the PUBLISH path's ([M01](M01)
// section 2.4, [M3](M03) section 3.3). A second operator check in the renderer
// would be a second implementation of a mechanical mapping, and the two would
// disagree on the day one of them was updated. What this file guarantees is
// narrower and is the half a renderer can guarantee: the string that reaches
// the page is the string that was validated.
//
// THE ONE PIECE OF PROSE THIS MODULE OWNS IS THE SUPERSESSION NOTICE, and the
// boundary is worth stating because it looks like a violation. INV-M9-02 is
// about RULE TEXT. GS-148 separately requires a superseded page to be
// "unmistakably labeled" and to name its successor, which is navigational
// chrome about the document rather than a statement about a rule, and it cannot
// come from `copy_blocks` because a version published before its successor
// existed cannot contain a sentence about it.
// =============================================================================

import type { SitePlanVersionView, SiteSizeView } from '../catalog/types.ts';
import { renderCadenceCopy } from '../render/cadence.ts';
import type { SimulatedEnvironmentDisclosure } from '../render/disclosure.ts';
import type { SizeFigures } from '../render/size-label.ts';
import { hasMarketedLabel, renderSizeFigures, renderSizeLabel } from '../render/size-label.ts';
import type { PageEnvelope } from './page.ts';
import { planPage } from './page.ts';
import { planVersionSizePath } from './paths.ts';

/** One published rule block, keyed by the rule path it explains. */
export interface RuleBlock {
  /** The `copy_blocks` key: the rule path this text is the explainer for. */
  readonly rule_path: string;
  /** `copy_blocks[rule_path]`, verbatim. Never interpolated, never wrapped. */
  readonly body: string;
}

/** One entry of OQ-M9-01's size selector. */
export interface SizeChoice {
  readonly label: string;
  readonly path: string;
  readonly selected: boolean;
}

/** PG-M9-03's model, for one version at one size. */
export interface RulesPage {
  readonly envelope: PageEnvelope;
  readonly plan_name: string;
  /** GS-309. The label, or the capital figure when there is none. */
  readonly size_label: string;
  readonly size_label_is_marketed: boolean;
  /** Every figure, from the row. */
  readonly figures: SizeFigures;
  /** INV-M9-08, derived from this version's own config. */
  readonly cadence_copy: string;
  /** OQ-M9-01: one size at a time, with a selector to the others. */
  readonly size_choices: readonly SizeChoice[];
  /** INV-M9-02. Every string here is a `copy_blocks` value. */
  readonly blocks: readonly RuleBlock[];
  /** GS-148. `null` unless this version has been superseded. */
  readonly supersession_notice: string | null;
}

/** What a caller supplies to build a rules page. */
export interface RulesPageInput {
  readonly version: SitePlanVersionView;
  /** The size the page is rendering. Must be one of the version's own. */
  readonly size: SiteSizeView;
  readonly disclosure: SimulatedEnvironmentDisclosure | null;
}

/**
 * PG-M9-03 for one version at one size.
 *
 * The build stamp comes from the version's envelope rather than from an
 * argument, so a rules page cannot state a moment its own catalog read did not
 * happen at. `planPage` decides indexability, which is what makes a superseded
 * version's rules page excluded without this function deciding anything.
 */
export function rulesPage(input: RulesPageInput, built_at: PageEnvelope['built_at']): RulesPage {
  const { version, size } = input;
  assertSizeBelongsToVersion(version, size);

  const envelope = planPage({
    path: planVersionSizePath(version, size),
    title: `${version.plan_name} rules`,
    version,
    built_at,
    disclosure: input.disclosure,
  });

  return {
    envelope,
    plan_name: version.plan_name,
    size_label: renderSizeLabel(size),
    size_label_is_marketed: hasMarketedLabel(size),
    figures: renderSizeFigures(size.row, size.price_cents, size.reset_price_cents),
    cadence_copy: renderCadenceCopy(version.rules),
    size_choices: version.sizes.map((candidate) => ({
      label: renderSizeLabel(candidate),
      path: planVersionSizePath(version, candidate),
      selected: candidate.row.size_cents === size.row.size_cents,
    })),
    blocks: ruleBlocks(version),
    supersession_notice: supersessionNotice(version),
  };
}

/**
 * `copy_blocks`, as an ordered list.
 *
 * ORDER IS LEXICOGRAPHIC BY RULE PATH AND THAT IS A STATED GAP RATHER THAN A
 * DESIGN. The order a rules page should read in is an editorial decision and
 * `copy_blocks` is a jsonb object, whose key order is not meaningful and which
 * M01 section 1.4 forbids iterating for exactly that reason. Sorting gives the
 * one property this layer can actually guarantee, which is that two builds of
 * the same version produce the same bytes: FM-M9-08's recovery asserts the
 * build digest after deploy, and a digest over map-iteration order alarms on
 * the runner rather than on an attacker.
 *
 * A reading order belongs with the authoring, on the publish payload, beside
 * the text it orders. That is an `API_CONTRACT` and [M3](M03) question and it
 * is owed rather than decided here.
 */
export function ruleBlocks(version: SitePlanVersionView): readonly RuleBlock[] {
  return Object.keys(version.copy_blocks)
    .sort()
    .map((rule_path) => ({ rule_path, body: version.copy_blocks[rule_path]! }));
}

/**
 * INV-M9-02, as an assertion a build can run.
 *
 * IT COMPARES THE STRINGS AND NOT A PATTERN. Every body on the page must be a
 * value of the version's own `copy_blocks`, identically: no trimming, no
 * wrapping, no "Note: " prefix, and no summary composed from several blocks.
 * Any of those is prose of this module's own, and the reason the check is
 * equality rather than containment is that containment would pass on a page
 * that had added a sentence around the block, which is the exact thing
 * AS-M9-05 is about.
 */
export function assertRuleTextIsPublished(page: RulesPage, version: SitePlanVersionView): void {
  const published = new Set(Object.values(version.copy_blocks));

  for (const block of page.blocks) {
    if (!published.has(block.body)) {
      throw new RulesPageError(
        `INV-M9-02: the block for ${block.rule_path} is not a published copy_block ` +
          'of this version. The rules page has no prose of its own, because the ' +
          'sentence and the rule have to change in the same publish action.',
      );
    }
  }
}

/**
 * GS-148's label. Navigational chrome about the document, never about a rule.
 *
 * It cannot come from `copy_blocks`: a version published before its successor
 * existed cannot contain a sentence naming it. It states the fact and the
 * address and stops there, because everything else a reader needs is on the
 * successor's own page.
 */
function supersessionNotice(version: SitePlanVersionView): string | null {
  const successor = version.superseded_by;
  if (successor === null) return null;

  return (
    `This is version ${version.version} of ${version.plan_name}, and it has been ` +
    `superseded by version ${successor.version}. Accounts opened under version ` +
    `${version.version} are still governed by the rules on this page.`
  );
}

/**
 * A size from one version rendered on another version's page would state that
 * version's rules beside this size's figures, which is FM-M9-09's failure
 * arriving through a call site instead of through a label.
 */
function assertSizeBelongsToVersion(version: SitePlanVersionView, size: SiteSizeView): void {
  if (!version.sizes.some((candidate) => candidate.row.size_cents === size.row.size_cents)) {
    throw new RulesPageError(
      `a size of ${size.row.size_cents} cents is not published on version ` +
        `${version.version} of ${version.plan_code}, so a page rendering it would ` +
        "state one version's rules beside another version's figures.",
    );
  }
}

/** Thrown by the rules page's build checks. */
export class RulesPageError extends Error {
  override readonly name = 'RulesPageError';
}
