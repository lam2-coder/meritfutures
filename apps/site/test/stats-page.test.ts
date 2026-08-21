import { expect, test } from 'vitest';

import { basisPoints, money } from '../src/render/cents.js';
import { DisclosureError } from '../src/render/disclosure.js';
import type { PublishedStatistic, StatsPublication } from '../src/stats/published.js';
import {
  StatsRenderError,
  assertWindowAttached,
  renderStatistic,
  statisticText,
  statsPage,
  statsStaleness,
} from '../src/routes/stats.js';
import { BUILT_AT } from './fixtures.js';

// CI-02, the `unit` project. AS-M9-03, GS-144, FM-M9-03.

const disclosure = {
  form: 'short' as const,
  body: 'Counsel drafts this.',
  document_version: 3,
  document_slug: 'terms-of-service',
};

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
  method_path: '/stats/method/ST-01/v2',
  ...overrides,
});

const publication = (
  statistics: readonly PublishedStatistic[],
  computed_at = '2026-08-21T02:00:00.000Z',
): StatsPublication => ({ statistics, computed_at });

// -----------------------------------------------------------------------------
// INV-M9-06: rendered, never computed
// -----------------------------------------------------------------------------

test('the rate is the stored value in its stored unit, not a ratio computed here', () => {
  const rendered = renderStatistic(stat({ value: 1470n, value_unit: 'bp' }));

  expect(rendered.value).toBe(basisPoints(1470));
  // 412 / 2803 is 14.70 percent to two places and is NOT what produced this.
  // Changing the components without changing the value must not move the figure.
  const inconsistent = renderStatistic(stat({ numerator: 1n, denominator: 999_999n }));
  expect(inconsistent.value).toBe(basisPoints(1470));
});

test('the components are published beside the value, unreduced', () => {
  const rendered = renderStatistic(stat());

  expect(rendered.numerator).toBe('412');
  expect(rendered.denominator).toBe('2,803');
});

test('money statistics render through the same helper as every other cents value', () => {
  const total = renderStatistic(
    stat({ stat_code: 'ST-03', measure: 'total', value: 41_200_000n, value_unit: 'cents' }),
  );
  expect(total.value).toBe(money(41_200_000n));
});

test('a duration renders in a unit a reader can read, by integer division', () => {
  expect(renderStatistic(stat({ value: 17_340n, value_unit: 'duration_seconds' })).value).toBe(
    '4h 49m',
  );
  expect(renderStatistic(stat({ value: 90n, value_unit: 'duration_seconds' })).value).toBe(
    '1m 30s',
  );
  expect(renderStatistic(stat({ value: 45n, value_unit: 'duration_seconds' })).value).toBe('45s');
});

// ST-03 holds lifetime money on a public surface and `0021` stores it as bigint
// for exactly this reason.
test('a total past the float boundary is exact', () => {
  const huge = renderStatistic(
    stat({ value: 9_007_199_254_740_993n, value_unit: 'cents', measure: 'total' }),
  );
  expect(huge.value).toBe(money(9_007_199_254_740_993n));
});

// -----------------------------------------------------------------------------
// GS-144: the window is not separable from the number
// -----------------------------------------------------------------------------

test('GS-144: the only accessor for the figure carries the window and the as-of day', () => {
  const text = statisticText(renderStatistic(stat()));

  expect(text).toContain(basisPoints(1470));
  expect(text).toContain('2026-04-14 to 2026-08-20');
  expect(text).toContain('as of 2026-08-20');
  expect(text).toContain('n=2803');
});

test('GS-144: a statistic without its window fails the build', () => {
  const stripped = { ...renderStatistic(stat()), window: '' };
  expect(() => assertWindowAttached(stripped)).toThrow(StatsRenderError);

  const undated = { ...renderStatistic(stat()), as_of_trading_day: '  ' };
  expect(() => assertWindowAttached(undated)).toThrow(StatsRenderError);
});

test('AS-M9-03: a statistic with no method link fails the build', () => {
  const unmethodical = { ...renderStatistic(stat()), method_path: '' };
  expect(() => assertWindowAttached(unmethodical)).toThrow(/method/);
});

test('a well formed statistic passes', () => {
  expect(() => assertWindowAttached(renderStatistic(stat()))).not.toThrow();
});

// -----------------------------------------------------------------------------
// INV-M12-05: never a number and never a blank
// -----------------------------------------------------------------------------

test('a suppressed statistic renders its reason with its sample, and no number', () => {
  const suppressed = renderStatistic(
    stat({
      value: null,
      value_unit: null,
      sample_size: 41,
      suppressed_reason: 'not yet meaningful',
    }),
  );

  expect(suppressed.value).toBeNull();
  expect(suppressed.not_meaningful).toBe('not yet meaningful');
  expect(statisticText(suppressed)).toContain('not yet meaningful');
  expect(statisticText(suppressed)).toContain('n=41');
});

test('a suppressed statistic is never a blank, which is what makes suppression visible', () => {
  const suppressed = renderStatistic(
    stat({ value: null, value_unit: null, suppressed_reason: 'sample below minimum' }),
  );
  expect(statisticText(suppressed).trim()).not.toBe('');
  expect(() => assertWindowAttached(suppressed)).not.toThrow();
});

// The third state `published_statistics_value_or_suppression` says cannot
// exist, and which a mapping bug can still produce on the way here.
test('neither a value nor a reason is a build failure', () => {
  const neither = { ...renderStatistic(stat()), value: null, not_meaningful: null };
  expect(() => assertWindowAttached(neither)).toThrow(StatsRenderError);
});

// INV-M12-03: a correction is a new value with a restatement note, and the
// superseded value stays visible.
test('a restatement names what it restates', () => {
  const corrected = renderStatistic(stat({ restatement_of: 'a1b2c3' }));
  expect(corrected.restates).toBe('a1b2c3');
});

// -----------------------------------------------------------------------------
// FM-M9-03: staleness
// -----------------------------------------------------------------------------

test('a fresh payload emits nothing', () => {
  const fresh = publication([stat()], '2026-08-21T02:00:00.000Z');
  expect(statsStaleness(fresh, '2026-08-21T10:00:00.000Z', 24)).toBeNull();
});

test('site.stats_stale carries the as-of day, the age, and the budget', () => {
  const old = publication([stat()], '2026-08-18T02:00:00.000Z');
  const event = statsStaleness(old, '2026-08-21T10:00:00.000Z', 24);

  expect(event).not.toBeNull();
  expect(event!.as_of_trading_day).toBe('2026-08-20');
  expect(event!.budget_hours).toBe(24);
  expect(event!.age_hours).toBe(80);
});

// Two builds of one input must produce the same alarms, so neither timestamp is
// read from a clock.
test('the freshness check reads no clock: same inputs, same answer', () => {
  const old = publication([stat()], '2026-08-18T02:00:00.000Z');
  const first = statsStaleness(old, '2026-08-21T10:00:00.000Z', 24);
  const second = statsStaleness(old, '2026-08-21T10:00:00.000Z', 24);

  expect(first).toEqual(second);
});

test('an unparseable timestamp is a defect and says so', () => {
  expect(() =>
    statsStaleness(publication([stat()], 'whenever'), '2026-08-21T10:00:00.000Z', 24),
  ).toThrow(StatsRenderError);
});

// -----------------------------------------------------------------------------
// The page
// -----------------------------------------------------------------------------

test('the page renders what M12 published and computes nothing', () => {
  const page = statsPage(publication([stat(), stat({ stat_code: 'ST-02' })]), disclosure, BUILT_AT);

  expect(page.statistics).toHaveLength(2);
  expect(page.statistics.map((s) => s.stat_code)).toEqual(['ST-01', 'ST-02']);
  expect(page.computed_at).toBe('2026-08-21T02:00:00.000Z');
});

// The as-of day is what the number describes; computed_at is when the run
// happened. A page that showed one and alarmed on the other would report the
// wrong staleness in whichever direction the run lagged the data.
test('the build moment, the run moment and the as-of day are three different facts', () => {
  const page = statsPage(publication([stat()]), disclosure, BUILT_AT);

  expect(page.envelope.built_at).toBe(BUILT_AT);
  expect(page.computed_at).toBe('2026-08-21T02:00:00.000Z');
  expect(page.statistics[0]!.as_of_trading_day).toBe('2026-08-20');
});

test('INV-M9-05: the stats page cannot be built without a disclosure', () => {
  expect(() => statsPage(publication([stat()]), null, BUILT_AT)).toThrow(DisclosureError);
});

test('the page carries no version stamp, because it renders no plan version', () => {
  expect(
    statsPage(publication([stat()]), disclosure, BUILT_AT).envelope.renders_version,
  ).toBeNull();
});
