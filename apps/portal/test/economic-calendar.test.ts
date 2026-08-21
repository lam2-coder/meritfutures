import { expect, test } from 'vitest';

import type {
  EconomicCalendarOccurrence,
  EconomicCalendarPanelResponse,
} from '../src/api/types.js';
import { toEconomicCalendarPanel } from '../src/view/economic-calendar.js';

// =============================================================================
// GS-285 and M04 section 3.8: the economic calendar panel
// =============================================================================

/**
 * ONE ROW. Every assertion below reads this one occurrence, which is the whole
 * of GS-285: "There is no timezone column: the conversion is a rendering, so
 * two correct answers come from one stored instant rather than from two rows."
 *
 * 12:30 UTC on a Friday is the shape of a Tier-1 US release.
 */
const CPI: EconomicCalendarOccurrence = {
  event_key: 'US_CPI',
  occurrence_key: '2026-09-11',
  tier: 1,
  scheduled_release_at: '2026-09-11T12:30:00Z',
  release_trading_day: '2026-09-11',
  revision: 0,
  revision_reason: null,
};

const COVERED: EconomicCalendarPanelResponse = {
  freshness: { stale: false, covered_through_day: '2026-10-31' },
  occurrences: [CPI],
};

test('GS-285: one row renders correctly on two dashboards in two timezones', () => {
  const chicago = toEconomicCalendarPanel(COVERED, 'America/Chicago');
  const tokyo = toEconomicCalendarPanel(COVERED, 'Asia/Tokyo');
  if (chicago.state !== 'covered' || tokyo.state !== 'covered') {
    return expect.unreachable('a covered calendar rendered as stale');
  }

  const inChicago = chicago.releases[0]!;
  const inTokyo = tokyo.releases[0]!;

  // 12:30 UTC is 07:30 in Chicago on the same date, and 21:30 in Tokyo.
  expect(inChicago.local_day).toBe('2026-09-11');
  expect(inChicago.local_time).toBe('07:30');
  expect(inTokyo.local_day).toBe('2026-09-11');
  expect(inTokyo.local_time).toBe('21:30');

  // AND BOTH CARRY THE SAME STORED INSTANT, WHICH IS THE POINT. Two correct
  // answers, one row, no timezone column anywhere in the chain.
  expect(inChicago.scheduled_release_at).toBe(CPI.scheduled_release_at);
  expect(inTokyo.scheduled_release_at).toBe(CPI.scheduled_release_at);
  expect(inChicago.event_key).toBe(inTokyo.event_key);
  expect(inChicago.occurrence_key).toBe(inTokyo.occurrence_key);
});

test('a conversion that crosses midnight moves the local date, not the row', () => {
  // 23:30 UTC is the case 0039's header item 5 warns about for the trading day,
  // and it is the case a timezone column would have got wrong here: the same
  // instant is one calendar date in Chicago and the next in Tokyo.
  const late: EconomicCalendarPanelResponse = {
    freshness: { stale: false, covered_through_day: '2026-10-31' },
    occurrences: [{ ...CPI, scheduled_release_at: '2026-09-11T23:30:00Z' }],
  };

  const chicago = toEconomicCalendarPanel(late, 'America/Chicago');
  const tokyo = toEconomicCalendarPanel(late, 'Asia/Tokyo');
  if (chicago.state !== 'covered' || tokyo.state !== 'covered') {
    return expect.unreachable('a covered calendar rendered as stale');
  }

  expect(chicago.releases[0]?.local_day).toBe('2026-09-11');
  expect(chicago.releases[0]?.local_time).toBe('18:30');
  expect(tokyo.releases[0]?.local_day).toBe('2026-09-12');
  expect(tokyo.releases[0]?.local_time).toBe('08:30');

  // The stored exchange-session day is unchanged by either rendering, because
  // it was transcribed with the release rather than derived from the instant.
  expect(chicago.releases[0]?.release_trading_day).toBe('2026-09-11');
  expect(tokyo.releases[0]?.release_trading_day).toBe('2026-09-11');
});

test('the trader sees a zone label they recognise', () => {
  const chicago = toEconomicCalendarPanel(COVERED, 'America/Chicago');
  const tokyo = toEconomicCalendarPanel(COVERED, 'Asia/Tokyo');
  if (chicago.state !== 'covered' || tokyo.state !== 'covered') {
    return expect.unreachable('a covered calendar rendered as stale');
  }
  expect(chicago.releases[0]?.timezone_label).toBe('CDT');
  expect(tokyo.releases[0]?.timezone_label).toBe('GMT+9');
});

test('a stale calendar SAYS SO and has no list to render as empty', () => {
  // Section 3.8: "An empty calendar panel looks exactly like a quiet week", and
  // DEP-M4-09: "the dangerous failure is not the empty panel, it is the
  // confident one". The union makes the confident version unrepresentable: the
  // stale arm has no `releases` field at all.
  const panel = toEconomicCalendarPanel(
    { freshness: { stale: true, covered_through_day: '2026-08-01' }, occurrences: [] },
    'America/Chicago',
  );

  expect(panel.state).toBe('stale');
  expect(panel).not.toHaveProperty('releases');
  expect(panel.covered_through_day).toBe('2026-08-01');
});

test('a stale calendar stays stale even when it carries rows', () => {
  // The freshness fact and the row set are different questions. A load that
  // covered last month still returns rows, and rendering them as current is the
  // confident panel with data behind it, which is worse rather than better.
  const panel = toEconomicCalendarPanel(
    { freshness: { stale: true, covered_through_day: '2026-08-01' }, occurrences: [CPI] },
    'America/Chicago',
  );
  expect(panel.state).toBe('stale');
  expect(panel).not.toHaveProperty('releases');
});

test('a covered calendar with nothing scheduled is a positive claim', () => {
  const panel = toEconomicCalendarPanel(
    { freshness: { stale: false, covered_through_day: '2026-10-31' }, occurrences: [] },
    'America/Chicago',
  );
  expect(panel.state).toBe('covered');
  if (panel.state !== 'covered') return;
  expect(panel.releases).toEqual([]);
  expect(panel.covered_through_day).toBe('2026-10-31');
});

test('only Tier-1 renders, and the filter is a query over a stored column', () => {
  // 0039 header item 3: `tier` is a column and not an import filter, so a load
  // carrying lower tiers is rendered correctly rather than accidentally.
  const panel = toEconomicCalendarPanel(
    {
      freshness: { stale: false, covered_through_day: '2026-10-31' },
      occurrences: [
        CPI,
        { ...CPI, event_key: 'US_REDBOOK', occurrence_key: '2026-09-08', tier: 2 },
        { ...CPI, event_key: 'US_API_CRUDE', occurrence_key: '2026-09-09', tier: 3 },
      ],
    },
    'America/Chicago',
  );
  if (panel.state !== 'covered') return expect.unreachable('a covered calendar rendered as stale');

  expect(panel.releases.map((r) => r.event_key)).toEqual(['US_CPI']);
});

test('a revised release says the time moved, and carries the current revision', () => {
  // Section 3.8's table, and 0039 header item 1: a revision is a ROW, so the
  // panel reading `economic_calendar_current` is looking at the latest
  // transcription. What it adds is that the trader is told it changed.
  const panel = toEconomicCalendarPanel(
    {
      freshness: { stale: false, covered_through_day: '2026-10-31' },
      occurrences: [
        {
          ...CPI,
          scheduled_release_at: '2026-09-11T13:00:00Z',
          revision: 1,
          revision_reason: 'BLS moved the release by 30 minutes.',
        },
      ],
    },
    'America/Chicago',
  );
  if (panel.state !== 'covered') return expect.unreachable('a covered calendar rendered as stale');

  expect(panel.releases[0]?.revised).toBe(true);
  expect(panel.releases[0]?.local_time).toBe('08:00');
  expect(panel.releases[0]?.revision_reason).toBe('BLS moved the release by 30 minutes.');

  // Revision 0 is the original transcription and is not a move.
  const original = toEconomicCalendarPanel(COVERED, 'America/Chicago');
  if (original.state !== 'covered') return;
  expect(original.releases[0]?.revised).toBe(false);
});

test('the order is by the stored instant, so two traders see the same sequence', () => {
  const panel = (zone: string) =>
    toEconomicCalendarPanel(
      {
        freshness: { stale: false, covered_through_day: '2026-10-31' },
        occurrences: [
          {
            ...CPI,
            event_key: 'US_PPI',
            occurrence_key: 'b',
            scheduled_release_at: '2026-09-11T14:00:00Z',
          },
          {
            ...CPI,
            event_key: 'US_CPI',
            occurrence_key: 'a',
            scheduled_release_at: '2026-09-11T12:30:00Z',
          },
        ],
      },
      zone,
    );

  for (const zone of ['America/Chicago', 'Asia/Tokyo', 'Pacific/Auckland']) {
    const view = panel(zone);
    if (view.state !== 'covered') return expect.unreachable('a covered calendar rendered as stale');
    expect(
      view.releases.map((r) => r.event_key),
      `order in ${zone}`,
    ).toEqual(['US_CPI', 'US_PPI']);
  }
});

test('INV-M4-16: nothing in the view is an external origin', () => {
  // "No embed, iframe, or third-party calendar widget renders anywhere in the
  // portal." The absence of the field is the control, so this walks the built
  // view and fails on any key an origin could be assigned to.
  const banned = ['url', 'src', 'href', 'iframe', 'embed', 'widget', 'script', 'origin'];
  const keys: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node !== null && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        keys.push(key);
        walk(value);
      }
    }
  };
  walk(toEconomicCalendarPanel(COVERED, 'America/Chicago'));

  expect(keys.length, 'keys walked').toBeGreaterThan(5);
  for (const key of keys) {
    for (const bad of banned) {
      expect(key.toLowerCase().includes(bad), `${key} is not an origin`).toBe(false);
    }
  }
});

test('the panel is authoritative on both arms of the union', () => {
  // Section 3.8: a scheduled release time is a published fact Merit
  // transcribed. Rendering it as indicative "would teach the trader that
  // release times are approximate, which is the opposite of true".
  expect(toEconomicCalendarPanel(COVERED, 'America/Chicago').tier).toBe('authoritative');
  expect(
    toEconomicCalendarPanel(
      { freshness: { stale: true, covered_through_day: null }, occurrences: [] },
      'America/Chicago',
    ).tier,
  ).toBe('authoritative');
});

test('an unusable timezone or instant refuses rather than falling back', () => {
  // A fallback to UTC would show a Tier-1 release at the wrong hour to a trader
  // who had no way to know, which is FM-M7-08's wrong-window failure produced
  // by a default rather than by a stale row.
  expect(() => toEconomicCalendarPanel(COVERED, 'Mars/Olympus_Mons')).toThrow(RangeError);
  expect(() =>
    toEconomicCalendarPanel(
      {
        freshness: { stale: false, covered_through_day: '2026-10-31' },
        occurrences: [{ ...CPI, scheduled_release_at: 'sometime Friday' }],
      },
      'America/Chicago',
    ),
  ).toThrow(RangeError);
});
