// =============================================================================
// apps/portal/test/calendar-fixtures.ts
// =============================================================================
// THE DATA THE `app/calendar` SEGMENT'S SUITE RENDERS. Wire shapes, exactly as
// `api/types.ts` declares them, so the fixtures exercise the real view builders
// rather than hand-built view models.
//
// -----------------------------------------------------------------------------
// THE DATES ARE CHOSEN SO THE TRADING DAY AND THE CALENDAR DAY DISAGREE
// -----------------------------------------------------------------------------
// A fixture on a date where the two agree asserts nothing: the wrong renderer
// and the right one produce identical output, and the suite goes green on a
// screen that is wrong on every evening release of the year.
//
// `2026-03-12T22:30:00Z` IS 17:30 CT ON 12 MARCH 2026. US daylight time began
// on 8 March 2026, so America/Chicago is UTC-5 that day. The evening session has
// opened: migration 0032 records the open as "session opens at 17:00 CT
// regardless" and states the governing rule beside it, "session calendar (CT)
// is authoritative; storage is UTC". GLOSSARY's `session` entry closes it: "A
// fill belongs to the trading day whose session CONTAINS its execution
// timestamp." So that instant is trading day 2026-03-13.
//
// THREE ANSWERS FOR ONE INSTANT, AND ONLY ONE OF THEM IS THE TRADING DAY:
//
//   trading day (CT session calendar, the server's stored column)   2026-03-13
//   UTC calendar date (what a naive slice of the ISO string gives)  2026-03-12
//   the viewer's local date in America/New_York (18:30 EDT)         2026-03-12
//
// THE TRADING DAY HERE IS THE SERVER'S AND IS NOT DERIVED BY THE SUITE. It is
// written into the fixture because `release_trading_day` is a stored column
// (0039 header item 5) and the whole property under test is that the portal
// renders it rather than computing one. A helper in this file that computed the
// day from the instant would be the defect, written in the test.
//
// `2026-03-12T22:45:00Z` on the timeline is the same case fifteen minutes later
// and is there so the property is asserted on two surfaces rather than one.

import type {
  EconomicCalendarPanelResponse,
  PlanVersionResponse,
  TimelineItem,
} from '../src/api/types.ts';
import type { ShellView } from '../src/shell/app-shell.ts';

/** The viewer this suite renders for. Chosen because its local date differs from the trading day. */
export const VIEWER_TIMEZONE = 'America/New_York';

/** The instant whose three answers disagree. See the file header. */
export const DISPUTED_INSTANT = '2026-03-12T22:30:00.000Z';

/** The trading day that instant belongs to, as the server stores it. */
export const DISPUTED_TRADING_DAY = '2026-03-13';

/** The UTC calendar date of that instant, which a naive renderer would print instead. */
export const DISPUTED_UTC_DAY = '2026-03-12';

/** The ordinary shell: the trader's own session, no impersonation. */
export const TRADER_SHELL: ShellView = {
  impersonation: null,
  simulated_environment_disclosure:
    'Merit accounts are simulated. Trading is performed in a simulated environment and no ' +
    'order reaches a live exchange.',
  content: { kind: 'ready' },
};

/** A covered calendar carrying the disputed instant, a same-day release, and a later day. */
export const COVERED_CALENDAR: EconomicCalendarPanelResponse = {
  freshness: { stale: false, covered_through_day: '2026-03-20' },
  occurrences: [
    {
      event_key: 'us_cpi',
      occurrence_key: 'us_cpi@2026-03-13',
      tier: 1,
      scheduled_release_at: DISPUTED_INSTANT,
      release_trading_day: DISPUTED_TRADING_DAY,
      revision: 1,
      revision_reason: 'source publisher moved the release window',
    },
    {
      event_key: 'fomc_minutes',
      occurrence_key: 'fomc_minutes@2026-03-13',
      tier: 1,
      // 13:00 CT on 13 March, inside that day's session and before its close.
      scheduled_release_at: '2026-03-13T18:00:00.000Z',
      release_trading_day: '2026-03-13',
      revision: 0,
      revision_reason: null,
    },
    {
      event_key: 'us_nonfarm_payrolls',
      occurrence_key: 'us_nonfarm_payrolls@2026-03-16',
      // 07:30 CT on 16 March.
      tier: 1,
      scheduled_release_at: '2026-03-16T12:30:00.000Z',
      release_trading_day: '2026-03-16',
      revision: 0,
      revision_reason: null,
    },
    {
      // TIER 2, AND IT MUST NOT REACH THE SCREEN. DEP-M7-06 and D-04 read
      // Tier-1, and 0039 header item 3 keeps `tier` a column precisely so the
      // filter is re-derivable rather than a property of what was loaded.
      event_key: 'eu_flash_pmi',
      occurrence_key: 'eu_flash_pmi@2026-03-13',
      tier: 2,
      scheduled_release_at: '2026-03-13T08:00:00.000Z',
      release_trading_day: '2026-03-13',
      revision: 0,
      revision_reason: null,
    },
  ],
};

/** The same endpoint reporting itself past its own staleness threshold. */
export const STALE_CALENDAR: EconomicCalendarPanelResponse = {
  freshness: { stale: true, covered_through_day: '2026-02-27' },
  occurrences: COVERED_CALENDAR.occurrences,
};

/**
 * A timeline whose newest entry falls on the disputed instant, plus an event
 * kind this build has never heard of and an event with no trading day at all.
 *
 * The unknown kind is not decoration. `view/timeline.ts` requires that "an
 * event type this build has never heard of arrives with its own sentence
 * already written", and a suite whose fixtures are all known kinds cannot tell
 * a renderer that drops unknown ones from a renderer that does not.
 */
export const TIMELINE_ITEMS: readonly TimelineItem[] = [
  {
    occurred_at: '2026-03-12T22:45:00.000Z',
    trading_day: DISPUTED_TRADING_DAY,
    kind: 'account.funded',
    summary: 'Your account moved to funded after the evaluation gates cleared.',
    detail: { payout_cap_cents: 250000, consistency_bp: 4000, plan_code: 'merit_rapid' },
  },
  {
    occurred_at: '2026-03-11T14:00:00.000Z',
    trading_day: '2026-03-11',
    kind: 'day.closed',
    summary: 'Trading day 2026-03-11 closed and your marks are final.',
    detail: { realized_pnl_cents: -18750, win_day: false },
  },
  {
    occurred_at: '2026-03-10T09:00:00.000Z',
    trading_day: null,
    kind: 'merit.kind_this_build_has_never_seen',
    summary: 'A server-composed sentence about something new.',
    detail: {},
  },
];

/** A retired plan version, which is still somebody's contract. */
export const PINNED_VERSION: PlanVersionResponse = {
  plan_version_id: 'pv_0191c2',
  plan_id: 'merit_rapid',
  version: 3,
  status: 'retired',
  published_at: '2025-11-04T00:00:00.000Z',
  retired_at: '2026-02-01T00:00:00.000Z',
  rules: { win_days: { required_count: 3 }, phase_eval: { min_trading_days: 0 } },
  copy_blocks: {
    'payout.cadence': 'You may request a payout once every 5 trading days.',
    'phase_eval.min_trading_days': 'There is no minimum number of trading days in evaluation.',
    'win_days.required_count':
      'A payout requires 3 win days, where a win day is a trading day whose realized profit is ' +
      'at or above the win day floor for your account size.',
  },
  sizes: [
    {
      size_cents: 5000000,
      price_cents: 34900,
      reset_price_cents: 29900,
      drawdown_cents: 250000,
      profit_target_cents: 300000,
      buffer_cents: 50000,
      win_day_floor_cents: 20000,
      payout_cap_cents: 250000,
      min_payout_cents: 10000,
    },
    {
      // A funded-only shape: an ABSENT profit target, never a zero. A zero
      // profit target is a rule and an absent one is a different rule.
      size_cents: 10000000,
      price_cents: 54900,
      reset_price_cents: 44900,
      drawdown_cents: 400000,
      profit_target_cents: null,
      buffer_cents: 80000,
      win_day_floor_cents: 32000,
      payout_cap_cents: 500000,
      min_payout_cents: 10000,
    },
  ],
};
