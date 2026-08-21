// =============================================================================
// apps/site/src/render/cadence.ts
// =============================================================================
// INV-M9-08, AND THE ONE PLACE ON THIS SITE WHERE A NUMBER IS DERIVED RATHER
// THAN READ.
//
// The invariant: "The published cadence for **Merit Rapid is about 3 trading
// days**, and the copy attributes it to the **win-day gate**, never to the 1
// day cadence gap." [ADR-018](docs/decisions/ADR-018.md), [EC-049].
//
// **`3` IS A WIN-DAY COUNT AND INV-M9-01 NAMES WIN-DAY COUNTS EXPLICITLY**, so
// writing it into a template would be the disclosure defect this module is
// built to prevent, arrived at by transcribing the invariant literally. ADR-018
// is not a ruling that the number is three; it is a ruling that the number is
// `win_days.required_count`, which was five, is three, and is a launch
// candidate that can move again. EC-049 records the cost of getting this
// backwards from the other side: "the number a trader would compute from the
// published gap is wrong by a factor of five".
//
// SO THE CADENCE IS COMPUTED FROM CONFIG, AND SO IS THE ATTRIBUTION. A plan's
// real cadence is whichever of its two gates binds:
//
//   the win-day gate       `win_days.required_count` trading days, because each
//                          win day needs its own trading day and they reset to
//                          the settled payout's basis day (R-47)
//   the cadence gap        `min_settlement_lag_trading_days +
//                          cadence_gap_trading_days`, which is ADR-018's own
//                          comparison: "the comparison becomes `0 + 1 <= 3`"
//
// **A DOMINATED GATE MAY NOT BE PUBLISHED AT ALL**, which is the half most
// likely to be argued with. EC-049 and INV-M9-08: a gap that never binds "may
// not be described as the reason the plan is fast" and "may not be published as
// a protection at all". Publishing a 1 day gap beside a 3 trading day cadence
// invites a trader to compute the wrong answer from Merit's own page, and the
// answer they compute is favourable, which is the direction that becomes a
// grievance rather than a correction.
//
// THIS FILE PERFORMS ARITHMETIC AND INV-M9-06 SAYS THERE IS NONE IN THIS
// MODULE. The two do not collide and the boundary is worth stating: INV-M9-06
// is about STATISTICS, which are M12's ("The page fetches M12's published
// aggregate and renders it"). What happens here is a comparison between two
// published config integers to decide which gate binds, and it produces a
// sentence rather than a figure. If it ever produces a number a reader would
// treat as a measurement, it has become M12's and belongs there.
// =============================================================================

import type { PlanRulesJson } from '@merit/rules-engine';

/** Which gate actually bounds the plan's payout cycle. */
export type CadenceBinding = 'win_day_gate' | 'cadence_gap';

/**
 * What a surface may say about a plan's cadence, and what it may not.
 *
 * `dominated_gap_trading_days` is carried so a surface can be checked for
 * mentioning it, never so a surface can render it. It is the number that must
 * not appear.
 */
export interface CadenceClaim {
  /** The cycle length in trading days, from whichever gate binds. */
  readonly trading_days: number;
  /** What the copy must attribute the cadence to. */
  readonly binding: CadenceBinding;
  /**
   * `true` when the cadence gap never binds. INV-M9-08 and EC-049 then forbid
   * publishing it as a reason, as a protection, or at all.
   */
  readonly gap_is_dominated: boolean;
  /** The gap's own figure when it is dominated, so a lint can look for it. */
  readonly dominated_gap_trading_days: number | null;
}

/**
 * The cadence a plan version actually has, derived from its own config.
 *
 * The gap's effective length includes `min_settlement_lag_trading_days` because
 * the two gates use DIFFERENT ANCHORS, which is the second half of EC-049's
 * title and the reason the naive comparison is wrong. ADR-019 drives the lag to
 * 0 for the cadence anchor on v1, which makes the gap weaker still rather than
 * making the term unnecessary.
 *
 * TIES GO TO THE WIN-DAY GATE. When the two are equal the gap adds nothing a
 * trader can act on, so it is dominated by the definition EC-049 uses ("The 1
 * day gap never binds"), and attributing the cadence to the gap would publish a
 * gate that could be removed with no effect on the number beside it.
 */
export function cadenceClaim(rules: PlanRulesJson): CadenceClaim {
  const funded = rules.phase_funded;
  const winDays = funded.win_days.required_count;
  const gap = funded.min_settlement_lag_trading_days + funded.cadence_gap_trading_days;

  const gapIsDominated = gap <= winDays;

  return {
    trading_days: gapIsDominated ? winDays : gap,
    binding: gapIsDominated ? 'win_day_gate' : 'cadence_gap',
    gap_is_dominated: gapIsDominated,
    dominated_gap_trading_days: gapIsDominated ? funded.cadence_gap_trading_days : null,
  };
}

/**
 * The published cadence sentence, with its attribution, from config.
 *
 * "About" is load bearing and is not hedging. ADR-018: "The cadence is a floor
 * on effort, not a schedule." A trader who earns no win day earns no cycle, so
 * a number stated as exact would be a promise the gate does not make.
 *
 * The win-day arm names the mechanism rather than restating the count twice,
 * because AS-M9-05's seam is the sentence: a reader who is told only "about
 * three trading days" and later discovers the days must each be winning days at
 * a floor has found a gap between the marketing and the rule. Naming the
 * mechanism in the same sentence closes it.
 */
export function renderCadenceCopy(rules: PlanRulesJson): string {
  const claim = cadenceClaim(rules);
  const days = `${claim.trading_days} trading day${claim.trading_days === 1 ? '' : 's'}`;

  if (claim.binding === 'win_day_gate') {
    const count = rules.phase_funded.win_days.required_count;
    return (
      `About ${days} between payouts, set by the win-day gate: ` +
      `${count} winning day${count === 1 ? '' : 's'} at or above the win-day floor, ` +
      'each on its own trading day, counted again from the basis day of every settled payout.'
    );
  }

  return `About ${days} between payouts, set by the cadence gap.`;
}

/**
 * INV-M9-08's lint. Whether a piece of cadence copy attributes the cycle to a
 * gate that never binds.
 *
 * IT LOOKS FOR THE DOMINATED FIGURE AND FOR THE WORDS, because either alone is
 * the violation. "Our one day cadence gap keeps things moving" names no digit;
 * "payouts every 1 trading day" names no gate. A page carrying the dominated
 * number at all is publishing a gap EC-049 says may not be published, whatever
 * it says around it.
 *
 * It returns `false` when the gap is not dominated: a binding gate is a real
 * protection and describing it is correct.
 */
export function cadenceCopyPublishesADominatedGap(rules: PlanRulesJson, text: string): boolean {
  const claim = cadenceClaim(rules);
  if (!claim.gap_is_dominated) return false;

  const lowered = text.toLowerCase();
  if (/cadence gap|cooldown|cool-down|waiting period/.test(lowered)) return true;

  const gapDays = claim.dominated_gap_trading_days;
  if (gapDays === null) return false;

  // WHEN THE GAP'S FIGURE EQUALS THE PUBLISHED CADENCE THERE IS NOTHING TO
  // CATCH, and this guard is not a softening. A page saying "about 1 trading
  // day" on a plan whose win-day gate binds at one day is stating the cadence
  // correctly; the digit happens to be the gap's too. Firing here would make
  // the correct sentence unwritable, and a lint whose only fix is to say
  // something less true is a lint that gets disabled.
  if (gapDays === claim.trading_days) return false;

  // The figure beside a day unit. A bare digit is not enough: a price, an
  // ordinal and a ladder length are all digits, and a lint that fired on every
  // one of them would be turned off rather than obeyed.
  const figure = new RegExp(`\\b${gapDays}\\b[^.]{0,24}\\b(trading day|day|business day)s?\\b`);
  return figure.test(lowered);
}
