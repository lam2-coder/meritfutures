// =============================================================================
// apps/portal/src/view/referrals.ts
// =============================================================================
// SC-M4-09, THE REFERRAL PANEL. M04 section 3.1's one thing it must get right:
// "M8's trader-facing surface, WITH THE REQUIRED NFA I-26-12 DISCLOSURE."
//
// -----------------------------------------------------------------------------
// THE DISCLOSURE IS A REQUIRED PROP, WHICH IS THE ONLY VERSION OF "REQUIRED"
// THAT SURVIVES A REDESIGN
// -----------------------------------------------------------------------------
// M08:13: "NFA I-26-12 makes a promoter's claims the firm's problem", and
// `SD-M8-03` makes creative approval per asset AND per disclosure version
// because "NFA I-26-12 requires the disclosure to accompany the claim, and that
// is a per-creative fact". This panel is where a trader is invited to become
// that promoter, so it is the first place the disclosure has to accompany the
// invitation rather than sit two pages away in a terms document.
//
// `disclosure` is therefore a `DisclosureBlock` field on the view and not an
// optional footer: a panel rendered without it does not compile, in the idiom
// INV-M4-02 uses for `as_of_trading_day` and INV-M4-11 uses for `tier`. See
// ./disclosure.ts for what the brand buys and what it does not.
//
// -----------------------------------------------------------------------------
// THE PANEL SHOWS NUMBERS AND MAKES NO CLAIM ABOUT THEM
// -----------------------------------------------------------------------------
// M08 AS-M8-04 is a whole scenario about an affiliate publishing "guaranteed
// payouts at Merit" or fabricated earnings, and this is the surface a trader
// reads before they publish anything. So the panel renders `GET /affiliate/
// stats` and nothing else: no projection, no "you could earn", no lifetime
// extrapolation. There is no field on any type below that such a sentence could
// be written into, which is the same structural move the calendar panel makes
// against a news-window warning.
//
// -----------------------------------------------------------------------------
// INV-M4-01: EVERY NUMBER GOES STRAIGHT THROUGH A FORMATTER
// -----------------------------------------------------------------------------
// The tempting arithmetic on this panel is a conversion rate: conversions
// divided by clicks. THAT IS NOT A MONEY FIELD AND IT IS STILL NOT COMPUTED
// HERE, because M08 owns what a conversion rate means (a click attributed under
// last touch, a purchase that may charge back for months) and a ratio the
// portal invented would be a second definition of a number M12 publishes under
// a method page. The two counts are rendered as counts.
//
// `chargeback_rate_bp` is the firm's own basis-point figure and goes through
// `formatBasisPoints`, which is the only permitted consumer of a `_bp` field.

import type { AffiliateStats } from '../api/types.ts';
import { formatBasisPoints, formatCents } from '../format/money.ts';
import type { DisclosureBlock } from './disclosure.ts';

/**
 * The 30 day activity counts, as COUNTS.
 *
 * Both windows are the server's, named in the field, and the window is part of
 * the number rather than a caption beside it: a count whose window is stated
 * somewhere else is a count that gets quoted without one.
 */
export type ReferralActivityView = {
  readonly clicks_30d: number;
  readonly conversions_30d: number;
};

/**
 * The three money figures, formatted and never combined.
 *
 * `payable` IS NOT `earned` MINUS `paid` AND IS NOT COMPUTED THAT WAY HERE.
 * M08:13: "Commission is the only outflow in Merit that is paid on a promise
 * rather than on a settled fact, because a purchase can charge back for months
 * after the commission is payable." So earned, payable and paid are three
 * independent server answers with a clawback window between them, and the
 * subtraction that looks like it would reconcile them is both arithmetic on a
 * money field (INV-M4-01) and wrong.
 */
export type ReferralEarningsView = {
  readonly earned_lifetime: string;

  /** Earned, past its clawback window, and not yet paid. The server's own figure. */
  readonly payable: string;
  readonly paid_lifetime: string;
};

/** SC-M4-09. M08's trader-facing surface. */
export type ReferralPanelView = {
  /** The affiliate's own code. The address a click is attributed to. */
  readonly code: string;

  /** The commission rate, in basis points, formatted. */
  readonly commission: string;

  /** `affiliates.status`, as the server sent it. The portal decides no lifecycle. */
  readonly status: string;
  readonly activity: ReferralActivityView;
  readonly earnings: ReferralEarningsView;

  /** The firm's figure. Shown because a rising one is the affiliate's problem too. */
  readonly chargeback_rate: string;

  /** NFA I-26-12. A required field that cannot be authored in this module. */
  readonly disclosure: DisclosureBlock;
};

/**
 * The referral panel, from the wire.
 *
 * NOTHING IS HIDDEN WHEN IT IS ZERO. An affiliate with no clicks sees zero
 * clicks rather than an empty panel, on the calendar panel's reasoning one file
 * over: an empty surface and a surface that has not loaded look identical, and
 * the second is the one that gets refreshed forever.
 */
export function toReferralPanel(
  stats: AffiliateStats,
  disclosure: DisclosureBlock,
): ReferralPanelView {
  return {
    code: stats.code,
    commission: formatBasisPoints(stats.commission_bp),
    status: stats.status,
    activity: {
      clicks_30d: stats.clicks_30d,
      conversions_30d: stats.conversions_30d,
    },
    earnings: {
      earned_lifetime: formatCents(stats.earned_cents_lifetime),
      payable: formatCents(stats.payable_cents),
      paid_lifetime: formatCents(stats.paid_cents_lifetime),
    },
    chargeback_rate: formatBasisPoints(stats.chargeback_rate_bp),
    disclosure,
  };
}
