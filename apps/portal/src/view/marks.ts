// =============================================================================
// apps/portal/src/view/marks.ts
// =============================================================================
// SC-M4-03's equity chart. M04 section 4's obligation against
// `GET /accounts/:accountId/marks`:
//
//   "The equity chart. A day carrying `corrected: true` is VISIBLY MARKED,
//   because a chart that silently changes shape is how trust in the data goes."
//
// -----------------------------------------------------------------------------
// THE SERIES IS A RE-ORDERING AND NOTHING ELSE
// -----------------------------------------------------------------------------
// The endpoint is "cursor paginated by `trading_day` descending" and a chart
// reads left to right, so the one transformation here is a reversal. What this
// file deliberately does NOT do is the three things a charting helper normally
// does, each of which would invent a balance the ledger never held:
//
//   NO GAP FILLING. A trading day with no mark is a day that closed with no
//   mark, and drawing a point there states a balance for a day the engine did
//   not close. The portal has no trading calendar (see ./as-of.ts) so it cannot
//   even tell a holiday from a missing row, which makes the temptation to
//   interpolate a temptation to guess.
//
//   NO SMOOTHING AND NO DOWNSAMPLING. Both change the shape of the line, and
//   the shape of the line is the claim. A smoothed equity curve hides the
//   intraday low that a floor breach turns on.
//
//   NO DEDUPLICATION. `corrected` says a day has a superseding mark. Which rows
//   the endpoint returns is the endpoint's decision, and a client that dropped
//   one would be making a correction invisible in the exact place the plan says
//   it must be visible.
//
// The suite asserts the first of those by length: the series is exactly as long
// as what the server sent.
//
// -----------------------------------------------------------------------------
// WHY THERE ARE TWO REPRESENTATIONS OF EACH NUMBER, AND WHERE INV-M4-01 SITS
// -----------------------------------------------------------------------------
// INV-M4-01 is "no money value DISPLAYED anywhere is computed client side". A
// chart displays money in its axis labels and its tooltips, and it also needs a
// magnitude to turn into a pixel offset. Those are different things and
// collapsing them is what makes this file subtle.
//
//   `label` FIELDS ARE THE DISPLAYED MONEY. Already through the formatter,
//   already strings, and nothing downstream can do arithmetic on them.
//
//   `plot` FIELDS ARE GEOMETRY. They are `bigint`, and they carry no `_cents`
//   suffix, because they are not money values to be shown: they are magnitudes
//   a scale converts to coordinates. A pixel is not a money value and scaling
//   one is not the arithmetic INV-M4-01 bans.
//
// THE `bigint` IS THE CONTROL AND IT IS DELIBERATE. Whatever draws the chart
// has to write `Number(point.plot.balance)` to get into floating-point pixel
// space, and that cast is one visible expression at one seam, in a reviewer's
// diff, rather than a `_cents` field quietly participating in float arithmetic
// three files away. It is the same idiom as ../format/money.ts refusing a
// non-integer: make the boundary somewhere a person looks.

import type { MarkListItem } from '../api/types.js';
import { formatCents } from '../format/money.js';
import type { AccountState } from './as-of.js';

/** The magnitudes a scale turns into coordinates. Never displayed. See the header. */
export type EquityPlotValues = {
  readonly balance: bigint;
  readonly floor: bigint;
  readonly high: bigint;
  readonly low: bigint;
};

/** One closed day, ready to draw and ready to label. */
export type EquityPointView = {
  readonly trading_day: string;

  /** Displayed money, formatted. */
  readonly opening_balance: string;
  readonly closing_balance: string;
  readonly high_balance: string;
  readonly low_balance: string;
  readonly realized_pnl: string;
  readonly floor: string;
  readonly withdrawable: string;

  readonly traded_day: boolean;
  readonly win_day: boolean;

  /**
   * REQUIRED, so a point cannot reach a renderer without its correction state.
   *
   * The plan's sentence is about trust rather than about accuracy: the number
   * is right either way, and what a silent change costs is the trader's belief
   * that the chart is the same chart it was yesterday.
   */
  readonly corrected: boolean;

  readonly plot: EquityPlotValues;
};

/** The chart. Extends `AccountState` so INV-M4-02's day travels with the series. */
export type EquitySeriesView = AccountState & {
  readonly account_id: string;

  /**
   * Oldest first. The server sends newest first, and this reversal is the only
   * transformation applied to the data.
   */
  readonly points: readonly EquityPointView[];

  /**
   * The days that carry a superseding mark, listed so a legend can state the
   * correction rather than leaving it to a per-point glyph nobody reads.
   *
   * A FILTER, NOT A JUDGEMENT. `corrected` is the server's flag; this is the
   * subset of days carrying it, in the same order as `points`.
   */
  readonly corrected_days: readonly string[];
};

function toPoint(mark: MarkListItem): EquityPointView {
  return {
    trading_day: mark.trading_day,
    opening_balance: formatCents(mark.opening_balance_cents),
    closing_balance: formatCents(mark.closing_balance_cents),
    high_balance: formatCents(mark.high_balance_cents),
    low_balance: formatCents(mark.low_balance_cents),
    realized_pnl: formatCents(mark.realized_pnl_cents),
    floor: formatCents(mark.floor_cents),
    withdrawable: formatCents(mark.withdrawable_cents),
    traded_day: mark.traded_day,
    win_day: mark.win_day,
    corrected: mark.corrected,
    plot: {
      balance: BigInt(mark.closing_balance_cents),
      floor: BigInt(mark.floor_cents),
      high: BigInt(mark.high_balance_cents),
      low: BigInt(mark.low_balance_cents),
    },
  };
}

/**
 * `GET /accounts/:accountId/marks` to a chartable series.
 *
 * `as_of_trading_day` IS AN ARGUMENT RATHER THAN A DERIVATION, and that is
 * INV-M4-02 refusing an obvious shortcut. The newest mark's `trading_day` looks
 * like the last closed day and is not the same claim: the marks endpoint is
 * cursor paginated, so the newest row in THIS PAGE is the newest row the client
 * happens to hold. Taking the label from the page would put a stale date on the
 * chart the first time somebody scrolls, and it would be wrong quietly. The
 * account endpoints carry the real answer and the caller passes it in.
 */
export function toEquitySeries(
  account_id: string,
  as_of_trading_day: string,
  marks: readonly MarkListItem[],
): EquitySeriesView {
  const points = marks.map(toPoint).reverse();

  return {
    account_id,
    as_of_trading_day,
    points,
    corrected_days: points.filter((p) => p.corrected).map((p) => p.trading_day),
  };
}
