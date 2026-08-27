// =============================================================================
// apps/portal/test/calendar-segment.test.ts
// =============================================================================
// THE `app/calendar` SEGMENT, RENDERED. Every assertion below is made against
// the actual HTML `react-dom/server` produced from the real view builders and
// the real wire fixtures, not against a view model on its way to a screen.
//
// THIS FILE IS `.ts` AND THE COMPONENTS IT RENDERS ARE `.tsx`, DELIBERATELY.
// `vitest.config.ts`'s `unit` project includes `apps/*/test/**/*.test.ts` and
// nothing else, so a `.test.tsx` here would be a suite that never runs and
// reports nothing, which is the failure that config file's own header is about.
// A server component is a function, so `createElement` reaches it from a `.ts`
// file with no JSX and no second test project.

import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { toEconomicCalendarPanel } from '../src/view/economic-calendar.ts';
import { toRulesView } from '../src/view/rules.ts';
import { toTimelineView } from '../src/view/timeline.ts';
import { AsOfContradictionError, freshnessAgainst } from '../src/app/calendar/as-of-stamp.tsx';
import { EconomicCalendarScreen } from '../src/app/calendar/economic-calendar-screen.tsx';
import {
  ApiReadError,
  ECONOMIC_CALENDAR_PATH,
  assertOk,
  pinnedVersionPath,
  readEconomicCalendarPanel,
  readPinnedRules,
  readTimeline,
  timelinePath,
} from '../src/app/calendar/load.ts';
import { RulesScreen } from '../src/app/calendar/rules-screen.tsx';
import { TimelineScreen } from '../src/app/calendar/timeline-screen.tsx';
import {
  COVERED_CALENDAR,
  DISPUTED_TRADING_DAY,
  DISPUTED_UTC_DAY,
  PINNED_VERSION,
  STALE_CALENDAR,
  TIMELINE_ITEMS,
  TRADER_SHELL,
  VIEWER_TIMEZONE,
} from './calendar-fixtures.ts';

const render = (element: Parameters<typeof renderToStaticMarkup>[0]): string =>
  renderToStaticMarkup(element);

const calendarHtml = (response = COVERED_CALENDAR) =>
  render(
    createElement(EconomicCalendarScreen, {
      shell: TRADER_SHELL,
      panel: toEconomicCalendarPanel(response, VIEWER_TIMEZONE),
    }),
  );

describe('the economic calendar screen', () => {
  // ---------------------------------------------------------------------------
  // THE CALENDAR CLAUSE
  // ---------------------------------------------------------------------------
  it('groups by the trading day on a date where the trading day and the calendar day differ', () => {
    const panel = toEconomicCalendarPanel(COVERED_CALENDAR, VIEWER_TIMEZONE);

    // The premise, asserted rather than assumed. If these two were ever equal
    // the rest of this test would pass against a renderer that groups by the
    // wrong field, which is the whole reason the dates were chosen.
    const disputed = panel.state === 'covered' ? panel.releases[0] : undefined;
    expect(disputed?.release_trading_day).toBe(DISPUTED_TRADING_DAY);
    expect(disputed?.local_day).toBe(DISPUTED_UTC_DAY);
    expect(disputed?.release_trading_day).not.toBe(disputed?.local_day);

    const html = calendarHtml();

    // The heading is the trading day.
    expect(html).toContain(`data-group-trading-day="${DISPUTED_TRADING_DAY}"`);

    // And no heading is the calendar day, which is the assertion that fails on
    // the naive renderer. `2026-03-12` is still on the page, on the release's
    // own row, labelled as the viewer's local time.
    expect(html).not.toContain(`data-group-trading-day="${DISPUTED_UTC_DAY}"`);
    expect(html).toContain(`data-local-day="${DISPUTED_UTC_DAY}"`);
    expect(html).toContain('(your local time)');
  });

  it('puts both same-day releases under one heading and keeps the stored order', () => {
    const html = calendarHtml();
    const headings = [...html.matchAll(/data-group-trading-day="([^"]+)"/g)].map((m) => m[1]);
    expect(headings).toEqual(['2026-03-13', '2026-03-16']);
    expect(html.indexOf('us_cpi')).toBeLessThan(html.indexOf('fomc_minutes'));
  });

  it('renders the stored instant beside its rendering, so neither can drift unseen', () => {
    expect(calendarHtml()).toContain('2026-03-12T22:30:00.000Z');
  });

  it('renders Tier 1 only', () => {
    const html = calendarHtml();
    expect(html).toContain('us_cpi');
    expect(html).not.toContain('eu_flash_pmi');
  });

  it('says a revised release moved, and gives the reason the column carried', () => {
    const html = calendarHtml();
    expect(html).toContain('data-revised="true"');
    expect(html).toContain('source publisher moved the release window');
  });

  it('carries no embed, iframe or third-party origin (INV-M4-16)', () => {
    const html = calendarHtml();
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('http://');
    expect(html).not.toMatch(/https:\/\/(?!\S*schema\.org)/);
  });

  it('says the calendar is stale rather than showing a confident empty list', () => {
    const html = calendarHtml(STALE_CALENDAR);
    expect(html).toContain('data-panel-state="stale"');
    expect(html).toContain('is stale');

    // The stale arm has no `releases` field, so there is nothing to draw even
    // though the fixture carries four occurrences.
    expect(html).not.toContain('us_cpi');
    expect(html).not.toContain('data-group-trading-day');
  });
});

// -----------------------------------------------------------------------------
// THE AS-OF CLAUSE
// -----------------------------------------------------------------------------
const timelineHtml = (as_of_trading_day: string, closed_through_day: string | null): string =>
  render(
    createElement(TimelineScreen, {
      shell: TRADER_SHELL,
      timeline: toTimelineView('acct_0191c2', as_of_trading_day, TIMELINE_ITEMS),
      freshness: freshnessAgainst(as_of_trading_day, closed_through_day),
    }),
  );

describe('the as-of stamp', () => {
  it('says a deliberately stale as-of is stale, and names the day it is behind', () => {
    // The account speaks for 2026-03-09. The server has closed through
    // 2026-03-13, which is four sessions later.
    const html = timelineHtml('2026-03-09', '2026-03-13');

    expect(html).toContain('data-freshness="stale"');
    expect(html).toContain('data-as-of-trading-day="2026-03-09"');
    expect(html).toContain('Merit has since closed trading day');
    expect(html).toContain('2026-03-13');
    expect(html).toContain('is not what your account is worth now');

    // And it does not also carry the sentence that would make it look current.
    expect(html).not.toContain('data-freshness="current"');
    expect(html).not.toContain('there is no later closed trading day');
  });

  it('says a current as-of is current, on the same component and the same fixture', () => {
    const html = timelineHtml('2026-03-13', '2026-03-13');
    expect(html).toContain('data-freshness="current"');
    expect(html).toContain('there is no later closed trading day');
    expect(html).not.toContain('data-freshness="stale"');
  });

  it('refuses to imply current when no endpoint published a freshness fact', () => {
    const html = timelineHtml('2026-03-13', null);
    expect(html).toContain('data-freshness="unstated"');
    expect(html).toContain('has not published which trading day it has closed through');
    expect(html).not.toContain('data-freshness="current"');
  });

  it('refuses a figure dated after the day the firm says it has closed through', () => {
    expect(() => freshnessAgainst('2026-03-14', '2026-03-13')).toThrow(AsOfContradictionError);
  });
});

describe('the timeline screen', () => {
  it('renders every entry it was given, including a kind this build has never seen', () => {
    const html = timelineHtml('2026-03-13', '2026-03-13');
    expect(html).toContain(`data-entry-count="${TIMELINE_ITEMS.length}"`);
    for (const item of TIMELINE_ITEMS) {
      expect(html).toContain(`data-kind="${item.kind}"`);
      expect(html).toContain(item.summary);
    }
  });

  it('renders the entry trading day and never derives one from the instant', () => {
    const html = timelineHtml('2026-03-13', '2026-03-13');

    // The 22:45Z entry is trading day 2026-03-13 and its UTC date is 2026-03-12.
    expect(html).toContain(`data-trading-day="${DISPUTED_TRADING_DAY}"`);
    expect(html).not.toContain(`data-trading-day="${DISPUTED_UTC_DAY}"`);

    // The instant is still on the page, labelled as the stored UTC timestamp.
    expect(html).toContain('2026-03-12T22:45:00.000Z');
  });

  it('renders an entry with no trading day as an absence, never as a filled-in day', () => {
    expect(timelineHtml('2026-03-13', '2026-03-13')).toContain('data-trading-day="none"');
  });

  it('renders money out of `detail` formatted, never as raw cents', () => {
    const html = timelineHtml('2026-03-13', '2026-03-13');
    expect(html).toContain('2,500.00');
    expect(html).toContain('40.00%');
    expect(html).not.toContain('>250000<');
    expect(html).toContain('data-is-money="true"');
  });
});

describe('the rules screen', () => {
  const rulesHtml = (): string =>
    render(
      createElement(RulesScreen, {
        shell: TRADER_SHELL,
        rules: toRulesView(PINNED_VERSION),
        as_of_trading_day: '2026-03-13',
        freshness: freshnessAgainst('2026-03-13', '2026-03-13'),
      }),
    );

  it('renders every clause the version published, whole, with its rule path', () => {
    const html = rulesHtml();
    const paths = Object.keys(PINNED_VERSION.copy_blocks).sort();
    expect(html).toContain(`data-clause-count="${paths.length}"`);
    for (const path of paths) {
      expect(html).toContain(`data-rule-path="${path}"`);
      expect(html).toContain(PINNED_VERSION.copy_blocks[path]);
    }
  });

  it('says a retired version is superseded, above the clauses rather than below them', () => {
    const html = rulesHtml();
    expect(html).toContain('has been superseded and it is still your contract');
    expect(html.indexOf('superseded')).toBeLessThan(html.indexOf('data-rule-path'));
  });

  it('renders an absent profit target as an absence and never as a zero', () => {
    const html = rulesHtml();
    const cells = [...html.matchAll(/data-column="profit_target"[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(cells).toEqual(['3,000.00', 'none']);
    expect(cells).not.toContain('0.00');
  });

  it('keeps the size order the server sent', () => {
    const sizes = [...rulesHtml().matchAll(/data-column="size"[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(sizes).toEqual(['50,000.00', '100,000.00']);
  });
});

describe('the chrome every screen renders inside', () => {
  it('carries the simulated-environment disclosure on all three screens (INV-M4-09)', () => {
    const disclosure = TRADER_SHELL.simulated_environment_disclosure;
    expect(calendarHtml()).toContain(disclosure);
    expect(timelineHtml('2026-03-13', '2026-03-13')).toContain(disclosure);
    expect(
      render(
        createElement(RulesScreen, {
          shell: TRADER_SHELL,
          rules: toRulesView(PINNED_VERSION),
          as_of_trading_day: '2026-03-13',
          freshness: { kind: 'unstated' },
        }),
      ),
    ).toContain(disclosure);
  });

  it('carries the band and the disclosure on an error state, where content is not rendered', () => {
    const html = render(
      createElement(EconomicCalendarScreen, {
        shell: {
          impersonation: {
            placement: 'shell-band',
            admin_user_id: 'admin_44',
            subject_identity_id: 'idn_0191c2',
            reason_code: 'support_ticket',
            reason_detail: 'ticket 8812, trader cannot describe their dashboard',
            expires_at: '2026-03-13T18:00:00.000Z',
            exit: { action: 'end_impersonation' },
          },
          simulated_environment_disclosure: TRADER_SHELL.simulated_environment_disclosure,
          content: { kind: 'error', error: 'not_found' },
        },
        panel: toEconomicCalendarPanel(COVERED_CALENDAR, VIEWER_TIMEZONE),
      }),
    );

    expect(html).toContain('data-placement="shell-band"');
    expect(html).toContain('data-error-kind="not_found"');
    expect(html).toContain(TRADER_SHELL.simulated_environment_disclosure);

    // INV-M4-07: the wording is "not found" and the vocabulary has no `forbidden`.
    expect(html.toLowerCase()).not.toContain('forbidden');

    // The content is not rendered behind the error.
    expect(html).not.toContain('data-group-trading-day');
  });

  it('has no dismiss control on the band, because the view model has no field for one', () => {
    const html = render(
      createElement(EconomicCalendarScreen, {
        shell: {
          impersonation: {
            placement: 'shell-band',
            admin_user_id: 'admin_44',
            subject_identity_id: 'idn_0191c2',
            reason_code: 'support_ticket',
            reason_detail: 'ticket 8812',
            expires_at: '2026-03-13T18:00:00.000Z',
            exit: { action: 'end_impersonation' },
          },
          simulated_environment_disclosure: TRADER_SHELL.simulated_environment_disclosure,
          content: { kind: 'ready' },
        },
        panel: toEconomicCalendarPanel(COVERED_CALENDAR, VIEWER_TIMEZONE),
      }),
    );
    expect(html).not.toContain('dismiss');
    expect(html).not.toContain('<button');
  });
});

describe('the segment request plan', () => {
  it('names the three /api/v1 paths these screens read', () => {
    expect(ECONOMIC_CALENDAR_PATH).toBe('/economic-calendar');
    expect(timelinePath('acct_0191c2')).toBe('/accounts/acct_0191c2/timeline');
    expect(pinnedVersionPath('merit_rapid', 3)).toBe('/plans/merit_rapid/versions/3');
  });

  it('encodes an identifier rather than interpolating it into a path', () => {
    expect(timelinePath('a/../b')).toBe('/accounts/a%2F..%2Fb/timeline');
  });

  it('refuses a non-2xx with its status, and composes no sentence for it', () => {
    expect(() => assertOk(404, ECONOMIC_CALENDAR_PATH)).toThrow(ApiReadError);
    expect(() => assertOk(200, ECONOMIC_CALENDAR_PATH)).not.toThrow();
    try {
      assertOk(404, ECONOMIC_CALENDAR_PATH);
    } catch (error) {
      expect((error as ApiReadError).status).toBe(404);
      // INV-M4-07: the wording is toPortalErrorKind's and never this file's.
      expect((error as ApiReadError).message.toLowerCase()).not.toContain('forbidden');
      expect((error as ApiReadError).message.toLowerCase()).not.toContain('not found');
    }
  });

  it('reads each body into the view model its screen takes', () => {
    expect(readEconomicCalendarPanel(COVERED_CALENDAR, VIEWER_TIMEZONE).state).toBe('covered');
    expect(readTimeline(TIMELINE_ITEMS, 'acct_0191c2', '2026-03-13').entries).toHaveLength(
      TIMELINE_ITEMS.length,
    );
    expect(readPinnedRules(PINNED_VERSION).superseded).toBe(true);
  });
});
