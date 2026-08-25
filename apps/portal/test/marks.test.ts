import { expect, test } from 'vitest';

import type { MarkListItem } from '../src/api/types.ts';
import { toEquitySeries } from '../src/view/marks.ts';

// =============================================================================
// M4-R: the equity chart
// =============================================================================

/** As the endpoint sends them: `trading_day` DESCENDING. */
const MARKS: readonly MarkListItem[] = [
  {
    trading_day: '2026-08-20',
    opening_balance_cents: 5090000,
    closing_balance_cents: 5120000,
    high_balance_cents: 5131000,
    low_balance_cents: 5081000,
    realized_pnl_cents: 30000,
    traded_day: true,
    win_day: true,
    floor_cents: 5000000,
    withdrawable_cents: 120000,
    corrected: false,
  },
  {
    trading_day: '2026-08-19',
    opening_balance_cents: 5100000,
    closing_balance_cents: 5090000,
    high_balance_cents: 5104000,
    low_balance_cents: 5072000,
    realized_pnl_cents: -10000,
    traded_day: true,
    win_day: false,
    floor_cents: 5000000,
    withdrawable_cents: 90000,

    // The day a superseding mark exists for. This is the row the plan says must
    // be visibly marked.
    corrected: true,
  },
  {
    // A GAP IS LEFT IN THE DATA ON PURPOSE. 2026-08-18 is absent. A charting
    // helper that fills it would state a balance for a day the engine did not
    // close, and the portal owns no calendar with which to tell a holiday from
    // a missing row.
    trading_day: '2026-08-17',
    opening_balance_cents: 5100000,
    closing_balance_cents: 5100000,
    high_balance_cents: 5100000,
    low_balance_cents: 5100000,
    realized_pnl_cents: 0,
    traded_day: false,
    win_day: false,
    floor_cents: 5000000,
    withdrawable_cents: 100000,
    corrected: false,
  },
];

test('the series is the server order reversed, and nothing else', () => {
  const series = toEquitySeries('acc_1', '2026-08-20', MARKS);
  expect(series.points.map((p) => p.trading_day)).toEqual([
    '2026-08-17',
    '2026-08-19',
    '2026-08-20',
  ]);
});

test('no gap is filled, so the series is exactly as long as what the server sent', () => {
  // 2026-08-18 is missing from the input and is missing from the output. Three
  // rows in, three points out: no interpolation, no downsampling, no dedup.
  const series = toEquitySeries('acc_1', '2026-08-20', MARKS);
  expect(series.points).toHaveLength(MARKS.length);
  expect(series.points.map((p) => p.trading_day)).not.toContain('2026-08-18');
});

test('a corrected day survives into the point and into the legend', () => {
  const series = toEquitySeries('acc_1', '2026-08-20', MARKS);
  const corrected = series.points.filter((p) => p.corrected).map((p) => p.trading_day);
  expect(corrected).toEqual(['2026-08-19']);
  expect(series.corrected_days).toEqual(['2026-08-19']);
});

test('displayed money is formatted and plot magnitudes are bigint', () => {
  // The two representations, and the seam between them. A renderer can label
  // with `closing_balance` and cannot do arithmetic on it; it can scale
  // `plot.balance` and has to write `Number(...)` to do so, which is one
  // visible cast at one place rather than a `_cents` field drifting into float
  // arithmetic three files away.
  const first = toEquitySeries('acc_1', '2026-08-20', MARKS).points[0]!;

  expect(first.closing_balance).toBe('51,000.00');
  expect(first.realized_pnl).toBe('0.00');
  expect(typeof first.plot.balance).toBe('bigint');
  expect(first.plot).toEqual({
    balance: 5100000n,
    floor: 5000000n,
    high: 5100000n,
    low: 5100000n,
  });
});

test('a losing day keeps the sign on its realized P&L', () => {
  const series = toEquitySeries('acc_1', '2026-08-20', MARKS);
  const losing = series.points.find((p) => p.trading_day === '2026-08-19');
  expect(losing?.realized_pnl).toBe('-100.00');
  expect(losing?.win_day).toBe(false);
});

test('the as-of day is the caller supplied one, never the newest row in the page', () => {
  // INV-M4-02, and the shortcut it refuses. The marks endpoint is cursor
  // paginated: the newest row in THIS page is the newest row the client happens
  // to hold, which is not the same claim as the last closed day. Deriving the
  // label from the page would be wrong quietly on the first scroll.
  const olderPage = MARKS.slice(1);
  const series = toEquitySeries('acc_1', '2026-08-20', olderPage);
  expect(series.as_of_trading_day).toBe('2026-08-20');
  expect(series.points.at(-1)?.trading_day).toBe('2026-08-19');
});

test('an empty page is an empty series and not an error', () => {
  const series = toEquitySeries('acc_1', '2026-08-20', []);
  expect(series.points).toEqual([]);
  expect(series.corrected_days).toEqual([]);
  expect(series.as_of_trading_day).toBe('2026-08-20');
});

test('the input array is not mutated by the reversal', () => {
  // `Array.prototype.reverse` is in place, and the reversal here runs over the
  // mapped copy for that reason. A helper that reordered its caller's data
  // would corrupt whatever else on the page reads the same response, and it
  // would do it on the second render rather than the first.
  const input = [...MARKS];
  toEquitySeries('acc_1', '2026-08-20', input);
  expect(input.map((m) => m.trading_day)).toEqual(['2026-08-20', '2026-08-19', '2026-08-17']);
});
