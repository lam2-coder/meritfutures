import { expect, test } from 'vitest';

import type { Cents } from '@merit/rules-engine';

import type { SiteCatalog } from '../src/catalog/types.js';
import { money } from '../src/render/cents.js';
import { DisclosureError } from '../src/render/disclosure.js';
import { plansPage, sellableVersions } from '../src/routes/plans.js';
import { BUILT_AT, label, sizeRow, sizeView, versionView } from './fixtures.js';

// CI-02, the `unit` project. M9-C-nn: config-render parity, and M9-D-nn's
// layout half.

const disclosure = {
  form: 'short' as const,
  body: 'Counsel drafts this.',
  document_version: 3,
  document_slug: 'terms-of-service',
};

const catalog = (versions: SiteCatalog['versions']): SiteCatalog => ({
  versions,
  built_at: BUILT_AT,
});

// -----------------------------------------------------------------------------
// Section 8.3's coverage rule: assert against the source, never a snapshot
// -----------------------------------------------------------------------------

test('every figure on the page equals the value on the row it came from', () => {
  const size = sizeView({
    row: sizeRow({ size_cents: 5_000_000n as Cents, drawdown_cents: 200_000n as Cents }),
    price_cents: 29_500n as Cents,
  });
  const version = versionView({ sizes: [size] });

  const rendered = plansPage(catalog([version]), disclosure).plans[0]!.sizes[0]!;

  expect(rendered.figures.size).toBe(money(size.row.size_cents));
  expect(rendered.figures.price).toBe(money(size.price_cents));
  expect(rendered.figures.reset_price).toBe(money(size.reset_price_cents));
  expect(rendered.figures.drawdown).toBe(money(size.row.drawdown_cents));
  expect(rendered.figures.buffer).toBe(money(size.row.buffer_cents));
  expect(rendered.figures.win_day_floor).toBe(money(size.row.win_day_floor_cents));
});

// INV-M9-01. The page carries no number of its own, so moving a config value
// moves the page. A page that had stopped reading config would still render the
// old figure and this is what would catch it.
test('moving a price moves the page', () => {
  const cheap = versionView({ sizes: [sizeView({ price_cents: 16_500n as Cents })] });
  const dearer = versionView({ sizes: [sizeView({ price_cents: 19_900n as Cents })] });

  const a = plansPage(catalog([cheap]), disclosure).plans[0]!.sizes[0]!.figures.price;
  const b = plansPage(catalog([dearer]), disclosure).plans[0]!.sizes[0]!.figures.price;

  expect(a).toBe(money(16_500n as Cents));
  expect(b).toBe(money(19_900n as Cents));
  expect(a).not.toBe(b);
});

// -----------------------------------------------------------------------------
// What is sellable is two columns, not one
// -----------------------------------------------------------------------------

test('a superseded version is never on the pricing page', () => {
  const v1 = versionView({
    version: 1,
    public_slug: 'merit-rapid-v1',
    superseded_by: { version: 2, public_slug: 'merit-rapid-v2' },
  });
  const v2 = versionView({ version: 2, public_slug: 'merit-rapid-v2' });

  const shown = plansPage(catalog([v1, v2]), disclosure).plans;

  expect(shown).toHaveLength(1);
  expect(shown[0]!.version).toBe(2);
});

test('a published but not-yet-visible version is not on the pricing page either', () => {
  const engineOnly = versionView({ public_visible: false, superseded_by: null });

  expect(sellableVersions(catalog([engineOnly]))).toHaveLength(0);
  expect(plansPage(catalog([engineOnly]), disclosure).plans).toHaveLength(0);
});

// The page has no fallback, which is FM-M9-01's cause removed rather than
// detected. A plan with no sellable version simply is not shown.
test('a catalog with nothing sellable renders no plans and does not invent one', () => {
  const shown = plansPage(catalog([]), disclosure).plans;
  expect(shown).toEqual([]);
});

// -----------------------------------------------------------------------------
// GS-309 arriving at the page
// -----------------------------------------------------------------------------

test('GS-309: the card carries the label and prices from size_cents', () => {
  const size = sizeView({
    row: sizeRow({ size_cents: 2_500_000n as Cents }),
    marketed_size_label: label('Two week runway'),
  });
  const card = plansPage(catalog([versionView({ sizes: [size] })]), disclosure).plans[0]!.sizes[0]!;

  expect(card.label).toBe('Two week runway');
  expect(card.label_is_marketed).toBe(true);
  expect(card.figures.size).toBe(money(2_500_000n as Cents));
  expect(card.path).toContain('2500000');
  expect(card.path).not.toContain('runway');
});

test('GS-310: an absent label puts the capital figure where the label goes', () => {
  const size = sizeView({ marketed_size_label: null });
  const card = plansPage(catalog([versionView({ sizes: [size] })]), disclosure).plans[0]!.sizes[0]!;

  expect(card.label_is_marketed).toBe(false);
  expect(card.label).toBe(money(size.row.size_cents));
  expect(card.label).toBe(card.figures.size);
});

// -----------------------------------------------------------------------------
// The envelope
// -----------------------------------------------------------------------------

test('INV-M9-05: the pricing page cannot be built without a disclosure', () => {
  expect(() => plansPage(catalog([versionView()]), null)).toThrow(DisclosureError);
});

test('INV-M9-03: the page states the moment it was built', () => {
  const { envelope } = plansPage(catalog([versionView()]), disclosure);
  expect(envelope.built_at).toBe(BUILT_AT);
});

// The index renders several versions, so a stamp naming one of them would be a
// page claiming to describe a version it only partly describes. Each card links
// to the version page that carries its own stamp.
test('the index carries no single version stamp and every card links to one that does', () => {
  const page = plansPage(catalog([versionView()]), disclosure);

  expect(page.envelope.renders_version).toBeNull();
  expect(page.plans[0]!.path).toBe('/plans/merit-rapid-v1');
  expect(page.plans[0]!.rules_path).toBe('/plans/merit-rapid-v1/rules');
});

// INV-M9-08 reaching the surface it is published on.
test('the card states the cadence and attributes it to the win-day gate', () => {
  const card = plansPage(catalog([versionView()]), disclosure).plans[0]!;

  expect(card.cadence_copy).toContain('3 trading days');
  expect(card.cadence_copy).toContain('win-day gate');
  expect(card.cadence_copy).not.toContain('cadence gap');
});
