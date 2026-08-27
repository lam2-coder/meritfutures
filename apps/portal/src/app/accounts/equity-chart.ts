// =============================================================================
// apps/portal/src/app/accounts/equity-chart.ts
// =============================================================================
// SC-M4-03's EQUITY CHART, WHICH IS M04 SECTION 4's OBLIGATION AGAINST THE
// MARKS ENDPOINT:
//
//   "The equity chart. A day carrying `corrected: true` is VISIBLY MARKED,
//   because a chart that silently changes shape is how trust in the data goes."
//
// -----------------------------------------------------------------------------
// THE THREE THINGS THIS FILE DOES NOT DO ARE THE THREE ../../view/marks.ts
// REFUSES, AND THE REFUSAL ONLY BECOMES REAL HERE
// -----------------------------------------------------------------------------
// That module's header names NO GAP FILLING, NO SMOOTHING AND NO DOWNSAMPLING,
// and then says why each would invent a balance the ledger never held. Those
// are refusals a view model can STATE and only a renderer can KEEP: a chart
// library is where interpolation, curve smoothing and point thinning actually
// live, and every one of them is one prop away in every library. So this chart
// is hand-built out of SVG primitives, and what it draws is exactly the points
// it was handed, in the order it was handed them, one vertex each.
//
// `points` ARRIVES OLDEST FIRST because `toEquitySeries` reversed it. This file
// does not sort, filter or deduplicate: index `i` is the i-th vertex.
//
// -----------------------------------------------------------------------------
// WHERE THE `bigint` TO PIXEL SEAM IS, AND WHY THERE IS EXACTLY ONE
// -----------------------------------------------------------------------------
// ../../view/marks.ts made the geometry values `bigint` on purpose: "whatever
// draws the chart has to write `Number(point.plot.balance)` to get into
// floating-point pixel space, and that cast is one visible expression at one
// seam, in a reviewer's diff, rather than a `_cents` field quietly
// participating in float arithmetic three files away."
//
// `scale()` BELOW IS THAT SEAM AND IT IS THE ONLY `Number(` IN THIS FILE. Every
// other value here is either a `bigint` magnitude or an already-formatted
// string that came out of ../../format/money.ts. INV-M4-01 is untouched: a
// pixel is not a money value, and no money value on this screen is computed by
// this application.
//
// THE COORDINATES IT EMITS ARE INTEGERS. `scale` rounds, so the markup carries
// no floating-point literal at all and the same series renders byte for byte
// the same twice. The float exists for the width of one expression.
//
// -----------------------------------------------------------------------------
// THE AXIS LABELS ARE POINTS' OWN STRINGS AND ARE NEVER COMPUTED
// -----------------------------------------------------------------------------
// A chart normally picks round numbers for its axis and formats them. That
// would be this application computing a money value for display, which is
// exactly INV-M4-01's ban, and it would put a number on the screen that no
// ledger row holds. So the two labels this chart carries are the HIGHEST and
// LOWEST figures actually present in the series, rendered from the very
// `EquityPointView` string fields that produced the extremes.

import { createElement } from 'react';
import type { ReactElement } from 'react';

import type { EquityPointView, EquitySeriesView } from '../../view/marks.ts';
import { AsOf } from './elements.ts';

/**
 * The drawing box, in user units.
 *
 * The element itself is emitted at `width="100%"` with this `viewBox`, so the
 * chart fills whatever column the layout gives it and stays legible at 375px.
 * That is the one part of M04 section 1.1's "mobile first" this segment can
 * honour without owning a stylesheet.
 */
const WIDTH = 640;
const HEIGHT = 240;

/** One extreme of the series, and the point-string that states it. */
type Extreme = { readonly value: bigint; readonly label: string };

/**
 * The highest and lowest magnitudes drawn, with the labels that name them.
 *
 * THE FLOOR IS INCLUDED IN THE EXTENT AND THAT IS NOT COSMETIC. The floor line
 * is the thing the balance is read against, and a y-range computed from the
 * balance alone puts the floor off the canvas on exactly the accounts where the
 * distance to it is the whole story (SC-M4-02's sentence, one screen over).
 */
function extent(points: readonly EquityPointView[]): {
  readonly top: Extreme;
  readonly bottom: Extreme;
} {
  const first = points[0];
  if (first === undefined) throw new RangeError('extent of an empty series');

  let top: Extreme = { value: first.plot.high, label: first.high_balance };
  let bottom: Extreme = { value: first.plot.low, label: first.low_balance };

  for (const point of points) {
    for (const candidate of [
      { value: point.plot.high, label: point.high_balance },
      { value: point.plot.low, label: point.low_balance },
      { value: point.plot.floor, label: point.floor },
    ] satisfies readonly Extreme[]) {
      if (candidate.value > top.value) top = candidate;
      if (candidate.value < bottom.value) bottom = candidate;
    }
  }

  return { top, bottom };
}

/**
 * THE ONE SEAM. A magnitude to a y coordinate, as an integer.
 *
 * A FLAT SERIES DRAWS DOWN THE MIDDLE rather than dividing by zero. It happens
 * on a real account: one closed day, or a run of days with no movement at all.
 */
function scale(value: bigint, top: Extreme, bottom: Extreme): number {
  const range = top.value - bottom.value;
  if (range === 0n) return Math.round(HEIGHT / 2);
  const offset = Number(value - bottom.value) / Number(range);
  return Math.round(HEIGHT - offset * HEIGHT);
}

/** The x coordinate of vertex `i`, as an integer. One vertex per point, no thinning. */
function across(index: number, count: number): number {
  if (count <= 1) return Math.round(WIDTH / 2);
  return Math.round((index * WIDTH) / (count - 1));
}

function polyline(
  points: readonly EquityPointView[],
  pick: (point: EquityPointView) => bigint,
  top: Extreme,
  bottom: Extreme,
): string {
  return points
    .map((point, index) => `${across(index, points.length)},${scale(pick(point), top, bottom)}`)
    .join(' ');
}

/**
 * SC-M4-03's chart.
 *
 * THE CORRECTED MARK IS RENDERED TWICE, DELIBERATELY. ../../view/marks.ts
 * carries `corrected_days` beside the per-point `corrected` flag "so a legend
 * can state the correction rather than leaving it to a per-point glyph nobody
 * reads", and both halves are drawn: a ring on the vertex, and the days named
 * in text below the figure. A glyph alone is a mark a trader has to notice; the
 * list is the half that survives a screenshot.
 *
 * THE MARK IS A SHAPE AND NOT A COLOUR. DESIGN_SYSTEM section 2.3's rule, as
 * the compliant fixture quotes it, is that no semantic colour is ever the only
 * carrier of meaning. A hollow ring plus a named day carries it without one.
 */
export function EquityChart(props: { readonly series: EquitySeriesView }): ReactElement {
  const { series } = props;
  const { points } = series;

  if (points.length === 0) {
    return createElement(
      'section',
      null,
      createElement('h2', null, 'Equity'),
      createElement('p', null, 'No trading day has closed on this account yet.'),
    );
  }

  const { top, bottom } = extent(points);
  const firstDay = points[0]?.trading_day ?? '';
  const lastDay = points[points.length - 1]?.trading_day ?? '';

  return createElement(
    'section',
    null,
    createElement('h2', null, 'Equity'),
    createElement(
      'svg',
      {
        className: 'equity',
        role: 'img',
        width: '100%',
        viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
        preserveAspectRatio: 'none',
        'aria-labelledby': 'equity-title',
      },
      createElement(
        'title',
        { id: 'equity-title' },
        `Closing balance by trading day, ${firstDay} to ${lastDay}, against the account floor.`,
      ),

      // The floor first, so the balance draws over it.
      createElement('polyline', {
        className: 'equity-floor',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1,
        strokeDasharray: '4 4',
        points: polyline(points, (p) => p.plot.floor, top, bottom),
      }),
      createElement('polyline', {
        className: 'equity-balance',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        points: polyline(points, (p) => p.plot.balance, top, bottom),
      }),

      // FM-M4-01's chart half. One ring per corrected day, titled with the day.
      points.map((point, index) =>
        point.corrected
          ? createElement(
              'circle',
              {
                key: point.trading_day,
                className: 'equity-corrected',
                cx: across(index, points.length),
                cy: scale(point.plot.balance, top, bottom),
                r: 5,
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 2,
              },
              createElement('title', null, `${point.trading_day}: superseded by a later mark`),
            )
          : null,
      ),
    ),

    // The extremes, as the strings the points themselves carry. Never computed.
    createElement(
      'div',
      { className: 'row' },
      createElement('div', { className: 'label' }, 'Highest balance shown'),
      createElement('div', { className: 'value' }, top.label),
    ),
    createElement(
      'div',
      { className: 'row' },
      createElement('div', { className: 'label' }, 'Lowest balance shown'),
      createElement('div', { className: 'value' }, bottom.label),
    ),
    createElement(
      'div',
      { className: 'row' },
      createElement('div', { className: 'label' }, 'Days shown'),
      createElement('div', { className: 'value' }, `${firstDay} to ${lastDay}`),
    ),

    series.corrected_days.length === 0
      ? null
      : createElement(
          'div',
          { className: 'row' },
          createElement('div', { className: 'label' }, 'Corrected days'),
          createElement('div', { className: 'value' }, series.corrected_days.join(', ')),
        ),

    // THE PAGE THIS SERIES IS ON MAY HOLD FEWER DAYS THAN THE ACCOUNT HAS.
    // ../../view/marks.ts: the endpoint is cursor paginated, so "the newest row
    // in THIS PAGE is the newest row the client happens to hold", which is why
    // `as_of_trading_day` is passed in rather than read off the data. The count
    // is stated as its own figure so the chart's range is never read as the
    // account's whole history. It is a ROW rather than a sentence because a
    // sentence would have to inflect for one day, and this file writes no
    // clause it did not have to.
    createElement(
      'div',
      { className: 'row' },
      createElement('div', { className: 'label' }, 'Closed days in this page'),
      createElement('div', { className: 'value' }, String(points.length)),
    ),

    createElement(AsOf, { as_of_trading_day: series.as_of_trading_day }),
  );
}
