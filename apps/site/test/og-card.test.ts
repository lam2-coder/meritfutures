import { expect, test } from 'vitest';

import {
  assertAuthoredContentIsClean,
  ContentLintError,
  lintAuthoredContent,
  statisticWithTail,
} from '../src/content/lint.ts';
import type { PublishedStatistic } from '../src/stats/published.ts';
import { OgCardError, ogCard, ogCardText, ogImagePath } from '../src/routes/og.ts';
import { page } from '../src/routes/page.ts';
import { renderStatistic, statisticText, StatsRenderError } from '../src/routes/stats.ts';
import { BUILT_AT } from './fixtures.ts';

// CI-02, the `unit` project. GS-144's SECOND LEG: the OG image path.
//
// Session 186 measured this surface as four comments and no implementation, and
// recorded that GS-144's row could not move on a partial status. These are the
// assertions that make the row's own sentence executable: "the build fails,
// INCLUDING on the OG image path".

const disclosure = {
  form: 'short' as const,
  body: 'Counsel drafts this.',
  document_version: 3,
  document_slug: 'terms-of-service',
};

const envelope = (path = '/stats') =>
  page({ path, title: 'Published statistics', indexable: true, built_at: BUILT_AT, disclosure });

const stat = (overrides: Partial<PublishedStatistic> = {}): PublishedStatistic => ({
  stat_code: 'ST-01',
  definition_version: 2,
  window_start_day: '2026-04-14',
  window_end_day: '2026-08-20',
  as_of_trading_day: '2026-08-20',
  measure: 'rate',
  value: 1470n,
  value_unit: 'bp',
  numerator: 412n,
  numerator_unit: 'count',
  denominator: 2803n,
  sample_size: 2803,
  grain_key: null,
  suppressed_reason: null,
  restatement_of: null,
  method_path: '/methods/ST-01',
  ...overrides,
});

const card = (overrides: Partial<Parameters<typeof ogCard>[0]> = {}) =>
  ogCard({
    envelope: envelope(),
    title: 'Published statistics',
    description: 'Every figure here carries the window it was computed over.',
    alt: 'The Merit published statistics card.',
    ...overrides,
  });

// -----------------------------------------------------------------------------
// The direction that PASSES
// -----------------------------------------------------------------------------

test('a card that states its figure through the rendered row builds', () => {
  const built = card({ statistic: renderStatistic(stat()) });
  expect(built.statistic).toMatch(/2026-04-14 to 2026-08-20/);
  expect(built.statistic).toMatch(/as of 2026-08-20/);
  expect(built.statistic).toMatch(/n=2803/);
});

test('a card with no statistic at all builds, because most pages have none', () => {
  expect(card().statistic).toBeNull();
});

test('INV-M9-04: the image address is derived from the page path and never passed', () => {
  expect(ogImagePath('/stats')).toBe('/stats/opengraph-image');
  expect(ogImagePath('/')).toBe('/opengraph-image');
  expect(card({ envelope: envelope('/plans') }).image_path).toBe('/plans/opengraph-image');
});

// -----------------------------------------------------------------------------
// GS-144 on the OG image path, the direction that FAILS
// -----------------------------------------------------------------------------

test('GS-144: a statistic whose window is empty fails the build ON THE CARD', () => {
  const stripped = { ...renderStatistic(stat()), window: '' };
  expect(() => card({ statistic: stripped })).toThrow(StatsRenderError);
  expect(() => card({ statistic: stripped })).toThrow(/GS-144/);
});

test('GS-144: a statistic whose as-of trading day is empty fails the build on the card', () => {
  const stripped = { ...renderStatistic(stat()), as_of_trading_day: '   ' };
  expect(() => card({ statistic: stripped })).toThrow(StatsRenderError);
});

test('GS-144: a bare figure typed into the card DESCRIPTION fails the build', () => {
  expect(() => card({ description: 'Our trailing pass rate is 14.7%.' })).toThrow(ContentLintError);
});

test('GS-144: a bare figure typed into the card TITLE fails the build', () => {
  expect(() => card({ title: '$1,500 per payout' })).toThrow(ContentLintError);
});

test('GS-144: the ALT TEXT is a surface too, and it is the one nobody reviews', () => {
  expect(() => card({ alt: 'A card reading 90% pass rate.' })).toThrow(ContentLintError);
});

test('an empty title is refused, because an empty card is still an artifact Merit does not control', () => {
  expect(() => card({ title: '   ' })).toThrow(OgCardError);
});

// -----------------------------------------------------------------------------
// The structural half: there is no way to put a bare value on a card
// -----------------------------------------------------------------------------

test('every string a crop can carry away is enumerated, so a fifth field cannot go unchecked', () => {
  const built = card({ statistic: renderStatistic(stat()) });
  expect(ogCardText(built)).toEqual([built.title, built.description, built.alt, built.statistic]);
});

test('nothing a card carries would itself fail the lint, in both directions', () => {
  const built = card({ statistic: renderStatistic(stat()) });
  for (const text of ogCardText(built)) {
    // The tail is what makes the figure statable, and it is present.
    expect(() => assertAuthoredContentIsClean(text, 'card'), text).not.toThrow();
  }
  // And the same figure WITHOUT its tail does not survive the same check. This
  // pair is GS-144 in one test: the window is the difference between the two.
  expect(() => assertAuthoredContentIsClean('14.70%', 'card')).toThrow(ContentLintError);
});

// -----------------------------------------------------------------------------
// THE TWO HALVES ARE PINNED TO EACH OTHER MECHANICALLY
// -----------------------------------------------------------------------------
// The lint carves out a figure that carries its tail. That carve-out is only
// sound while the tail it recognises is the tail `statisticText` actually emits,
// so the format is asserted here rather than restated in a comment. A change to
// either side breaks this test instead of silently widening the carve-out.

test('the lint recognises the exact tail statisticText emits, for every unit ADR-031 enumerates', () => {
  const units: PublishedStatistic['value_unit'][] = ['bp', 'cents', 'count', 'duration_seconds'];
  for (const value_unit of units) {
    const text = statisticText(renderStatistic(stat({ value_unit, value: 17340n })));
    expect(statisticWithTail().test(text), `${value_unit}: ${text}`).toBe(true);
    expect(() => assertAuthoredContentIsClean(text, 'card'), text).not.toThrow();
  }
});

test('INV-M12-05: a suppressed row carries a reason and the tail, and the lint accepts that shape too', () => {
  const text = statisticText(
    renderStatistic(stat({ value: null, suppressed_reason: 'not yet meaningful' })),
  );
  expect(statisticWithTail().test(text)).toBe(true);
  expect(() => assertAuthoredContentIsClean(text, 'card')).not.toThrow();
});

test('the carve-out does not swallow a neighbouring bare figure', () => {
  const attached = statisticText(renderStatistic(stat()));
  const findings = lintAuthoredContent(`The cap is $1,500 and the rate is ${attached}.`);
  expect(findings.map((f) => f.quote)).toEqual(['$1,500']);
});

test('a suppressed row carries its reason and its sample rather than a blank (INV-M12-05)', () => {
  const built = card({
    statistic: renderStatistic(stat({ value: null, suppressed_reason: 'not yet meaningful' })),
  });
  expect(built.statistic).toMatch(/not yet meaningful/);
  expect(built.statistic).toMatch(/n=2803/);
});
