import { expect, test } from 'vitest';

import type { Cents } from '@merit/rules-engine';

import { MarketedSizeLabelError, marketedSizeLabel } from '../src/catalog/types.js';
import { money } from '../src/render/cents.js';
import {
  hasMarketedLabel,
  renderSizeFigures,
  renderSizeLabel,
  sizeSegment,
} from '../src/render/size-label.js';
import { label, sizeRow, sizeView } from './fixtures.js';

// CI-02, the `unit` project. GS-309 and GS-310 as this module can hold them; the
// golden-file form is owed and has no home yet, per session 107's finding that
// every fixture on disk is M1-shaped.

// -----------------------------------------------------------------------------
// GS-309: a plan marketed under a runway label is rendered and priced
// -----------------------------------------------------------------------------

test('GS-309: the label renders verbatim and every figure comes from size_cents', () => {
  const size = sizeView({ marketed_size_label: label('One quarter runway') });

  expect(renderSizeLabel(size)).toBe('One quarter runway');

  const figures = renderSizeFigures(size.row, size.price_cents, size.reset_price_cents);

  // THE ASSERTION IS AGAINST THE SOURCE AND NOT AGAINST A STRING (section 8.3).
  // Each expectation is derived from the same row the page rendered, so a page
  // that stopped reading config fails here rather than going green on a literal.
  expect(figures.size).toBe(money(size.row.size_cents));
  expect(figures.price).toBe(money(size.price_cents));
  expect(figures.reset_price).toBe(money(size.reset_price_cents));
  expect(figures.drawdown).toBe(money(size.row.drawdown_cents));
  expect(figures.profit_target).toBe(money(size.row.profit_target_cents!));
  expect(figures.buffer).toBe(money(size.row.buffer_cents));
  expect(figures.win_day_floor).toBe(money(size.row.win_day_floor_cents));
  expect(figures.payout_caps).toEqual([
    { from_ordinal: 1, cap: money(size.row.payout_cap_schedule_cents[0]!.cap_cents) },
  ]);
});

// The one failure GS-309 exists to catch (M9 section 8.3): a surface that
// rendered the label AND priced from it. A label that reads as money is the
// case where the defect is invisible in the output, so the fixture uses one.
test('GS-309: a label that reads as money still reaches no figure', () => {
  const size = sizeView({
    row: sizeRow({ size_cents: 2_500_000n as Cents }),
    marketed_size_label: label('$50K'),
  });

  const figures = renderSizeFigures(size.row, size.price_cents, size.reset_price_cents);

  expect(renderSizeLabel(size)).toBe('$50K');
  expect(figures.size).toBe(money(2_500_000n as Cents));
  for (const rendered of Object.values(figures)) {
    expect(JSON.stringify(rendered)).not.toContain('50K');
  }
});

test('GS-309: the label addresses nothing, so the segment moves only with size_cents', () => {
  const unlabelled = sizeView();
  const labelled = sizeView({ marketed_size_label: label('Starter') });
  const renamed = sizeView({ marketed_size_label: label('Foundation') });

  expect(sizeSegment(labelled)).toBe(sizeSegment(unlabelled));
  expect(sizeSegment(renamed)).toBe(sizeSegment(labelled));
  expect(sizeSegment(labelled)).toBe(String(labelled.row.size_cents));

  const bigger = sizeView({ row: sizeRow({ size_cents: 5_000_000n as Cents }) });
  expect(sizeSegment(bigger)).not.toBe(sizeSegment(unlabelled));
});

// -----------------------------------------------------------------------------
// GS-310: the marketed label is absent
// -----------------------------------------------------------------------------

test('GS-310: an absent label renders the capital figure derived from size_cents', () => {
  const size = sizeView({ marketed_size_label: null });

  expect(hasMarketedLabel(size)).toBe(false);
  expect(renderSizeLabel(size)).toBe(money(size.row.size_cents));
});

test('GS-310: never an empty string, never a placeholder, never the plan name', () => {
  const rendered = renderSizeLabel(sizeView({ marketed_size_label: null }));

  expect(rendered).not.toBe('');
  expect(rendered.trim()).not.toBe('');
  expect(rendered).not.toBe('-');
  expect(rendered).not.toBe('Merit Rapid');
});

// SD-M9-04's CHECK is what leaves this ONE case instead of two. The constructor
// carries it at the application boundary, so a blank label cannot become a
// second absent case one layer above the constraint.
test('GS-310: the empty string is unwritable, so null is the only absent case', () => {
  expect(() => marketedSizeLabel('')).toThrow(MarketedSizeLabelError);
  expect(() => marketedSizeLabel('   ')).toThrow(MarketedSizeLabelError);
  expect(marketedSizeLabel(' Starter ')).toBe(' Starter ');
});

// -----------------------------------------------------------------------------
// The nulls that are not zeroes
// -----------------------------------------------------------------------------

test('a null profit target renders as absent rather than as a target of zero', () => {
  const direct = sizeView({ row: sizeRow({ profit_target_cents: null }) });
  const figures = renderSizeFigures(direct.row, direct.price_cents, direct.reset_price_cents);

  expect(figures.profit_target).toBeNull();
  expect(figures.profit_target).not.toBe(money(0n as Cents));
});

test('a null daily loss limit renders as absent rather than as a limit of zero', () => {
  const size = sizeView({ row: sizeRow({ daily_loss_limit_cents: null }) });
  const figures = renderSizeFigures(size.row, size.price_cents, size.reset_price_cents);

  expect(figures.daily_loss_limit).toBeNull();
});

test('the floor lock cents render exactly when the lock is enabled', () => {
  const locked = sizeView({
    row: sizeRow({
      floor_lock_enabled: true,
      floor_lock_at_profit_cents: 260_000n as Cents,
      floor_lock_floor_at_cents: 2_500_000n as Cents,
    }),
  });
  const figures = renderSizeFigures(locked.row, locked.price_cents, locked.reset_price_cents);

  expect(figures.floor_lock_at_profit).toBe(money(locked.row.floor_lock_at_profit_cents!));
  expect(figures.floor_lock_floor_at).toBe(money(locked.row.floor_lock_floor_at_cents!));
});
