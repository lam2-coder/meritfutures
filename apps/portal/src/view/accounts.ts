// =============================================================================
// apps/portal/src/view/accounts.ts
// =============================================================================
// SC-M4-02 (account list) and SC-M4-03 (account detail), as view models.
//
// -----------------------------------------------------------------------------
// WHY A VIEW MODEL AT ALL, AND WHY IT CARRIES STRINGS
// -----------------------------------------------------------------------------
// M04 section 1.1 names `apps/portal` as "a Next.js App Router application".
// There is no Next.js in this workspace and adding one is a dependency
// admission (VG-12) plus a root lockfile change, which is P1's scaffold work
// and not a read-surface session's. What this session can build without
// pre-empting that decision is the layer the framework would render: pure
// functions from a wire shape to a render-ready shape, with the module's
// invariants expressed in the types.
//
// THAT SPLIT IS NOT A COMPROMISE, IT IS WHERE THE INVARIANTS LIVE. INV-M4-01,
// INV-M4-02, INV-M4-05 and INV-M4-08 are all statements about what a component
// is HANDED, not about how it paints. A JSX file that receives
// `AccountCardView` cannot render a balance without its trading day, cannot
// perform arithmetic on a money value, and cannot show a skipped gate as
// satisfied, because none of those things is reachable from what it was given.
//
// SO EVERY MONEY FIELD BELOW IS A `string`. It has already been through
// ../format/money.ts, which is INV-M4-01's "formatting helper is the only
// permitted consumer" made structural rather than reviewed: a component cannot
// add two amounts it only has as text, and a diff that tries is unmistakable.
//
// -----------------------------------------------------------------------------
// AND THE PORTAL COMPOSES NO SENTENCE HERE
// -----------------------------------------------------------------------------
// The plan's fields are passed through under their own names. There is no
// `statusLabel`, no "you are 3 days away", no assembled headline. Two reasons,
// and the second is the one that would be lost: FM-M4-05 bans rule text in
// portal source, and section 1.2 says the portal does not decide what a trader
// may see. A composed sentence is where both of those get broken by somebody
// being helpful.

import type { AccountDetail, AccountListItem } from '../api/types.ts';
import type { CopyBlock, PinnedPlanCopy } from '../copy/copy-block.ts';
import { COPY_KEYS, copyBlock } from '../copy/copy-block.ts';
import { formatCents, formatOptionalBasisPoints, formatOptionalCents } from '../format/money.ts';
import type { AccountState } from './as-of.ts';

/** One reason the server has blocked a payout path on this account. */
export type BlockedReason = 'payouts_frozen' | 'recon_blocked' | 'kyc_required';

/**
 * SC-M4-02's card. Extends `AccountState`, so INV-M4-02's day is not optional.
 *
 * `floor_distance` IS FIRST AMONG THE MONEY FIELDS BY INTENT. SC-M4-02's "one
 * thing it must get right" is "floor distance, because it is the number traders
 * actually watch, and it is the number that decides whether they trade
 * tomorrow". FM-M4-08 is the same claim about layout: a number below the fold
 * is a number that was not shown.
 */
export type AccountCardView = AccountState & {
  readonly account_id: string;
  readonly plan: {
    readonly plan_id: string;
    readonly code: string;
    readonly name: string;
    readonly version: number;
  };
  readonly phase: AccountListItem['phase'];
  readonly status: AccountListItem['status'];

  /** The server's `balance - floor`. Never this app's. */
  readonly floor_distance: string;
  readonly balance: string;
  readonly floor: string;
  readonly withdrawable: string;
  readonly size: string;

  /**
   * The blocks the server reported, in a fixed order and as keys rather than
   * as sentences. Empty when nothing is blocked, which is a different fact from
   * "eligible": eligibility is the eligibility endpoint's answer and this is
   * the account card's, and conflating them is how a card and a gate list end
   * up disagreeing on one screen.
   */
  readonly blocked: readonly BlockedReason[];
};

/** SC-M4-02. One card, from one list item, with no field invented. */
export function toAccountCard(item: AccountListItem): AccountCardView {
  const blocked: BlockedReason[] = [];
  if (item.blocked.payouts_frozen) blocked.push('payouts_frozen');
  if (item.blocked.recon_blocked) blocked.push('recon_blocked');
  if (item.blocked.kyc_required) blocked.push('kyc_required');

  return {
    account_id: item.account_id,
    plan: item.plan,
    phase: item.phase,
    status: item.status,
    as_of_trading_day: item.as_of_trading_day,
    floor_distance: formatCents(item.floor_distance_cents),
    balance: formatCents(item.balance_cents),
    floor: formatCents(item.floor_cents),
    withdrawable: formatCents(item.withdrawable_cents),
    size: formatCents(item.size_cents),
    blocked,
  };
}

/**
 * OQ-M4-01 IS OPEN AND THIS FUNCTION IS DELIBERATELY NOT ITS ANSWER.
 *
 * "Does the portal show the identity-level aggregate? A trader with ten
 * accounts currently sees ten cards and no total." The recommendation is to
 * show a total, and it is a recommendation rather than a ruling. A session that
 * summed `withdrawable_cents` across the list here would have answered a
 * founder question by writing a `+`, and INV-M4-01 forbids the `+` for an
 * unrelated reason that happens to be the right one: any total is a computed
 * money value and would have to be the server's.
 *
 * So the list maps and does not fold.
 */
export function toAccountList(items: readonly AccountListItem[]): readonly AccountCardView[] {
  return items.map(toAccountCard);
}

/**
 * The eval progress card. SC-M4-03, and section 3.4's placement 2.
 *
 * `funded_reset` IS A REQUIRED FIELD OF TYPE `CopyBlock`, WHICH IS THE
 * PLACEMENT. Section 3.4: the ruling that "the funded phase starts at the
 * account size and eval profit is not carried (R-31)" must appear in plain
 * language on the eval progress card, "because that is the exact moment a
 * trader is forming the belief that the number they are watching is money they
 * will keep". A `CopyBlock` cannot be produced from a literal, so this card
 * cannot be built at all without the published sentence, and it cannot be built
 * with a sentence somebody wrote here.
 */
export type EvalProgressView = {
  readonly kind: 'eval';
  readonly profit_target: string | null;
  readonly profit: string | null;
  readonly funded_reset: CopyBlock;
};

/** The funded progress card. SC-M4-03: "every gate, gate by gate, with numbers." */
export type FundedProgressView = {
  readonly kind: 'funded';
  readonly buffer: string | null;
  readonly buffer_progress: string | null;
  readonly win_days: { readonly have: number; readonly need: number; readonly floor: string };
  readonly traded_days: { readonly have: number; readonly need: number };
  readonly consistency: ConsistencyView;
  readonly cadence: CadenceView;
  readonly ladder: { readonly payouts_settled: number; readonly payouts_to_graduate: number };
};

/**
 * A closed or graduated account has neither card.
 *
 * IT IS A CASE AND NOT A FALLBACK. `phase` has four values and two of them are
 * terminal, so a view model that modelled only eval and funded would be one
 * `else` away from rendering a funded card for a closed account.
 */
export type NoProgressView = { readonly kind: 'none' };

export type ProgressView = EvalProgressView | FundedProgressView | NoProgressView;

/**
 * The consistency meter, which section 3.3 says is visible AT ALL TIMES.
 *
 * "Ruled at the M1 gate (OQ-9): the consistency meter and
 * `profit_needed_to_dilute_cents` are shown at all times, not only when the
 * gate fails. The reason is AS-13: eligibility is not monotone in profit, so a
 * trader can make money and become less eligible, and the only defence against
 * that reading as a moved goalpost is that the shape of the rule was visible
 * before it bit."
 *
 * THE HEADROOM NUMBER IS OWED AND IS NOT COMPUTED HERE. Section 3.3: "when the
 * share is under the limit it also shows the headroom." The headroom is
 * `max_bp - best_day_share_bp`, which is arithmetic on two `_bp` fields and is
 * exactly what INV-M4-01 bans, and no endpoint returns it. Both numbers are
 * rendered so the trader can see the shape; the subtraction belongs to the
 * engine, which already computes the harder half of the same rule
 * (`profit_needed_to_dilute_cents`). Recorded in this session's log as an owed
 * field rather than closed with a `-`.
 */
export type ConsistencyView = {
  readonly best_day_share: string | null;
  readonly max: string | null;

  /** INV-M4-05. True means this gate was not evaluated, and it renders disabled. */
  readonly skipped: boolean;
};

/**
 * The cadence gap, rendered as a DATE.
 *
 * EC-046: "The engine reports `next_eligible_trading_day` as a concrete date
 * resolved through the calendar, so the trader sees the actual date rather than
 * doing the arithmetic." The gap is counted in trading days and a holiday
 * cluster stretches it in calendar time, so a countdown rendered here would be
 * wrong in December in a way the trader reads as the rules changing.
 *
 * `days_since_last_payout` IS CARRIED AND IS NOT A COUNTDOWN. It is elapsed
 * time, which is a fact about the past and is safe to state. What is not here
 * is a "days remaining", because that is `need` minus `days_since_last_payout`
 * evaluated against a calendar the portal does not have.
 */
export type CadenceView = {
  readonly days_since_last_payout: number | null;
  readonly need: number;

  /** Null means the cadence gap is not what is holding this account. */
  readonly next_eligible_trading_day: string | null;
};

/** SC-M4-03's whole card. Extends `AccountCardView`, so INV-M4-02 travels with it. */
export type AccountDetailView = AccountCardView & {
  readonly platform: AccountDetail['platform'];
  readonly platform_account_ref: string | null;
  readonly front_end_permissions: readonly string[];
  readonly opened_on: string;
  readonly funded_on: string | null;
  readonly closed_on: string | null;
  readonly close_reason: string | null;
  readonly progress: ProgressView;

  /** The account's pinned plan version. SC-M4-05 links here; this module does not inline it. */
  readonly rules_url: string;
};

function toConsistency(source: AccountDetail['progress']['consistency']): ConsistencyView {
  return {
    best_day_share: formatOptionalBasisPoints(source.best_day_share_bp),
    max: formatOptionalBasisPoints(source.max_bp),
    skipped: source.skipped,
  };
}

/**
 * SC-M4-03.
 *
 * `pinned` IS A REQUIRED ARGUMENT EVEN THOUGH ONLY THE EVAL BRANCH READS IT,
 * and that is the placement obligation again. An optional argument would make
 * the funded path work without the plan's copy and leave the eval path to fail
 * at runtime on the one card section 3.4 names, which is the failure arriving
 * on exactly the screen the ruling was written for.
 *
 * IT THROWS WHEN THE SENTENCE IS UNPUBLISHED, and that is DEP-M4-02's contract:
 * "copy_blocks exists for every rule on every published plan version | M3
 * publish gate | The portal has no legitimate text to render and someone writes
 * a sentence in a component (FM-M4-05)." The alternative is an eval card with a
 * gap where the ruling belongs, which meets section 3.4 in form and not at all
 * in substance.
 */
export function toAccountDetail(detail: AccountDetail, pinned: PinnedPlanCopy): AccountDetailView {
  return {
    ...toAccountCard(detail),
    platform: detail.platform,
    platform_account_ref: detail.platform_account_ref,
    front_end_permissions: detail.front_end_permissions,
    opened_on: detail.opened_on,
    funded_on: detail.funded_on,
    closed_on: detail.closed_on,
    close_reason: detail.close_reason,
    rules_url: detail.rules_url,
    progress: toProgress(detail, pinned),
  };
}

function toProgress(detail: AccountDetail, pinned: PinnedPlanCopy): ProgressView {
  const p = detail.progress;

  if (detail.phase === 'eval') {
    return {
      kind: 'eval',
      profit_target: formatOptionalCents(p.profit_target_cents),
      profit: formatOptionalCents(p.profit_cents),
      funded_reset: copyBlock(pinned, COPY_KEYS.funded_reset),
    };
  }

  if (detail.phase === 'funded') {
    return {
      kind: 'funded',
      buffer: formatOptionalCents(p.buffer_cents),
      buffer_progress: formatOptionalCents(p.buffer_progress_cents),
      win_days: {
        have: p.win_days.have,
        need: p.win_days.need,
        floor: formatCents(p.win_days.floor_cents),
      },
      traded_days: { have: p.traded_days.have, need: p.traded_days.need },
      consistency: toConsistency(p.consistency),
      cadence: {
        days_since_last_payout: p.cadence.days_since_last_payout,
        need: p.cadence.need,
        next_eligible_trading_day: p.cadence.next_eligible_trading_day,
      },
      ladder: p.ladder,
    };
  }

  return { kind: 'none' };
}
