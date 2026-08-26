// =============================================================================
// apps/portal/src/view/rules.ts
// =============================================================================
// SC-M4-05, THE RULES PAGE, PER ACCOUNT. M04 section 3.1's one thing it must get
// right: "Rendered from the account's pinned `copy_blocks`. The whole rule, with
// its operator."
//
// -----------------------------------------------------------------------------
// PINNED, NEVER CURRENT, AND THE TYPE IS WHAT ENFORCES IT
// -----------------------------------------------------------------------------
// M04 section 4's obligation against `GET /plans/:planId/versions/:version` is
// "the rules page for an account reads the pinned version, not the current one".
// The current version is a DIFFERENT CONTRACT with the same plan's name on it,
// and a trader shown it is being shown terms they did not buy. API_CONTRACT
// section 4 is written for exactly this: the endpoint returns retired versions
// too, "so a trader can always retrieve the contract they bought".
//
// So this view takes a `PlanVersionResponse` and never a plan, and it renders
// `status: 'retired'` as a first-class state rather than as an error. A retired
// contract is still somebody's contract.
//
// -----------------------------------------------------------------------------
// INV-M4-08: NO RULE SENTENCE IS AUTHORED HERE, AND `CopyBlock` IS WHY NOT
// -----------------------------------------------------------------------------
//   "Every rule sentence on any screen comes from `copy_blocks` on the account's
//   pinned plan version | No rule text is authored in the portal. This is the
//   mechanism behind constitution 0.4's 'marketing must equal implementation to
//   the tick'."
//
// `RuleClauseView.sentence` is declared `CopyBlock`, whose brand is private to
// ../copy/copy-block.ts, so the only expression in this codebase that can
// satisfy it is a `copyBlock()` call. A builder who types the rule out does not
// get a failing test; they get a file that does not compile.
//
// THE PAGE READS EVERY KEY THE VERSION PUBLISHED RATHER THAN A LIST OF ITS OWN.
// A portal-side list of rule paths would be a second copy of the rule
// vocabulary, and its failure mode is silent: a version publishes a new clause,
// the page does not know the key, and the trader reads a rules page that is
// missing a rule while looking complete. `COPY_KEYS` names the keys this app
// reads BY NAME for its own purposes; this page reads what is there.
//
// -----------------------------------------------------------------------------
// THE NUMBERS COME OFF `sizes` AND GO STRAIGHT THROUGH THE FORMATTER
// -----------------------------------------------------------------------------
// INV-M4-01: no money value displayed anywhere is computed client side. Every
// `_cents` field below is read from one `PlanSize` row and handed to
// `formatCents`, which is the only permitted consumer. Nothing here subtracts,
// scales, or derives, and `profit_target_cents` being null (a funded-only plan
// shape) renders as an absence rather than as a zero, because a zero profit
// target is a rule and an absent one is a different rule.

import type { PlanSize, PlanVersionResponse } from '../api/types.ts';
import { type CopyBlock, MissingCopyBlockError, copyBlock } from '../copy/copy-block.ts';
import { formatCents, formatOptionalCents } from '../format/money.ts';

/** One published rule sentence, with the path it was published under. */
export type RuleClauseView = {
  /** The `copy_blocks` key. Rendered so a trader quoting a clause can name it. */
  readonly rule_path: string;

  /** Provenance enforced by the type. Only `copyBlock()` produces one. */
  readonly sentence: CopyBlock;
};

/**
 * One size row of the pinned version, formatted.
 *
 * NO `_cents` FIELD SURVIVES INTO THIS VIEW, WHICH IS THE MODULE'S RULE AND NOT
 * A PREFERENCE. `AccountCardView` carries five formatted strings and zero raw
 * integers for the same reason: a `_cents` field on a view model is an
 * invitation to the arithmetic INV-M4-01 bans, at the layer where nobody is
 * looking for it. A caller matching the account's own row against this table
 * compares `size`, which is a deterministic rendering of one integer.
 */
export type RuleSizeView = {
  readonly size: string;
  readonly price: string;
  readonly reset_price: string;
  readonly drawdown: string;

  /** Null on a plan shape with no eval profit target. An absence, never a zero. */
  readonly profit_target: string | null;
  readonly buffer: string;
  readonly win_day_floor: string;
  readonly payout_cap: string;
  readonly min_payout: string;
};

/** SC-M4-05. The contract this account was sold under. */
export type RulesPageView = {
  readonly plan_id: string;
  readonly plan_version_id: string;
  readonly version: number;

  /**
   * `retired` IS A STATE AND NOT AN ERROR. The endpoint serves retired versions
   * deliberately, and a trader on a retired contract is reading the right page.
   */
  readonly status: 'published' | 'retired';
  readonly published_at: string;
  readonly retired_at: string | null;

  /**
   * True when this version has been superseded. Derived from `status` and from
   * nothing else: a date comparison here would be the portal deciding a
   * lifecycle question the server already answered.
   */
  readonly superseded: boolean;

  /** Every clause the version published, ordered by rule path. */
  readonly clauses: readonly RuleClauseView[];
  readonly sizes: readonly RuleSizeView[];
};

function toSizeView(size: PlanSize): RuleSizeView {
  return {
    size: formatCents(size.size_cents),
    price: formatCents(size.price_cents),
    reset_price: formatCents(size.reset_price_cents),
    drawdown: formatCents(size.drawdown_cents),
    profit_target: formatOptionalCents(size.profit_target_cents),
    buffer: formatCents(size.buffer_cents),
    win_day_floor: formatCents(size.win_day_floor_cents),
    payout_cap: formatCents(size.payout_cap_cents),
    min_payout: formatCents(size.min_payout_cents),
  };
}

/**
 * The rules page for one account's PINNED plan version.
 *
 * A VERSION THAT PUBLISHED NO COPY THROWS, on `copyBlock()`'s own reasoning one
 * level up. A rules page rendering an empty list is INV-M4-08's failure reached
 * by omission: the screen looks like it worked and the trader learns nothing
 * about the contract they are bound by. DEP-M4-02 makes it a publish-gate defect
 * upstream ("`copy_blocks` exists for every rule on every published plan
 * version"), so the portal's job is to make it visible rather than to paper
 * over it, and the refusal names the version so the report is actionable.
 *
 * SIZE ORDER IS THE SERVER'S AND CLAUSE ORDER IS THE KEY'S. `sizes` arrives in
 * whatever order the endpoint sends and is not re-sorted, because a numeric
 * sort here would be arithmetic on a `_cents` field in the one place it looks
 * innocent. Clauses are sorted by `rule_path` so two renders of one version
 * agree, and because `Object.keys` order on a JSON object parsed from the wire
 * is an implementation detail nobody should be reading a contract through.
 */
export function toRulesView(pinned: PlanVersionResponse): RulesPageView {
  const paths = Object.keys(pinned.copy_blocks).sort();
  if (paths.length === 0) {
    throw new MissingCopyBlockError(pinned.plan_id, pinned.version, '<any rule>');
  }

  const source = {
    plan_id: pinned.plan_id,
    version: pinned.version,
    blocks: pinned.copy_blocks,
  };

  return {
    plan_id: pinned.plan_id,
    plan_version_id: pinned.plan_version_id,
    version: pinned.version,
    status: pinned.status,
    published_at: pinned.published_at,
    retired_at: pinned.retired_at,
    superseded: pinned.status === 'retired',
    clauses: paths.map((rule_path) => ({ rule_path, sentence: copyBlock(source, rule_path) })),
    sizes: pinned.sizes.map(toSizeView),
  };
}
