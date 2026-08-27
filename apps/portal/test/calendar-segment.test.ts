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
  ECONOMIC_CALENDAR_PATH,
  accountPath,
  pinnedVersionPath,
  readEconomicCalendarPanel,
  readPinnedRules,
  readTimeline,
  timelinePagePath,
  timelinePath,
} from '../src/app/calendar/load.ts';
import { RulesScreen } from '../src/app/calendar/rules-screen.tsx';
import { TimelineScreen } from '../src/app/calendar/timeline-screen.tsx';
import EconomicCalendarPage from '../src/app/calendar/page.tsx';
import AccountTimelinePage from '../src/app/calendar/[accountId]/timeline/page.tsx';
import AccountRulesPage from '../src/app/calendar/[accountId]/rules/page.tsx';
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

      // The as-of clause is about the STAMP, so these renders declare a
      // complete read and the paging clause below is where the other arm is
      // asserted. A default here would be the thing `timeline-screen.tsx`
      // refuses to have.
      paging: { kind: 'complete' },
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

describe('the frame, inside the chrome the root layout owns', () => {
  // `src/app/layout.tsx` renders the impersonation band and the
  // simulated-environment disclosure around every route in this app, so these
  // are ABSENCE assertions and that is the point: a second disclosure on one
  // screen is not defence in depth, it is two disclosures. ADR-068 requirement 4
  // and INV-M4-09 are the layout's to keep, and the layout's own header says why
  // it can: "there is nowhere for a screen to render that is outside this file."
  it('does not duplicate the band or the disclosure the layout already renders', () => {
    for (const html of [
      calendarHtml(),
      timelineHtml('2026-03-13', '2026-03-13'),
      render(
        createElement(RulesScreen, {
          shell: TRADER_SHELL,
          rules: toRulesView(PINNED_VERSION),
          as_of_trading_day: '2026-03-13',
          freshness: { kind: 'unstated' },
        }),
      ),
    ]) {
      expect(html).not.toContain(TRADER_SHELL.simulated_environment_disclosure);
      expect(html).not.toContain('data-placement="shell-band"');
      expect(html).not.toContain('<footer');
    }
  });

  it('renders the error state in the portal vocabulary, and not the content behind it', () => {
    const html = render(
      createElement(EconomicCalendarScreen, {
        shell: {
          impersonation: null,
          simulated_environment_disclosure: TRADER_SHELL.simulated_environment_disclosure,
          content: { kind: 'error', error: 'not_found' },
        },
        panel: toEconomicCalendarPanel(COVERED_CALENDAR, VIEWER_TIMEZONE),
      }),
    );

    expect(html).toContain('data-content-state="error"');
    expect(html).toContain('data-error-kind="not_found"');

    // INV-M4-07: the wording is "not found" and the vocabulary has no `forbidden`.
    expect(html.toLowerCase()).not.toContain('forbidden');

    // The content is not rendered behind the error, though the panel was built.
    expect(html).not.toContain('data-group-trading-day');
  });

  it('renders `empty` as its own state rather than as a zero-length ready', () => {
    const html = render(
      createElement(EconomicCalendarScreen, {
        shell: {
          impersonation: null,
          simulated_environment_disclosure: TRADER_SHELL.simulated_environment_disclosure,
          content: { kind: 'empty' },
        },
        panel: toEconomicCalendarPanel(COVERED_CALENDAR, VIEWER_TIMEZONE),
      }),
    );
    expect(html).toContain('data-content-state="empty"');
    expect(html).not.toContain('data-group-trading-day');
  });
});

describe('the three routes', () => {
  // THEY PERFORM REAL READS NOW, AND THIS SUITE EXERCISES THE ONE ARM IT CAN
  // REACH WITHOUT A REQUEST SCOPE. `serverApiClient()` resolves the origin
  // BEFORE it imports `next/headers.js`, so a process with no
  // `MERIT_API_ORIGIN` reaches `ApiConfigError` without ever touching the
  // framework, and that is the `unavailable` arm. The `ready` and `error` arms
  // go through `createApiClient` over a stub transport in
  // `apps/portal/test/calendar-source.test.ts`, which is where the seam is
  // asserted rather than the routing.
  const withoutOrigin = async (run: () => Promise<void>): Promise<void> => {
    const held = process.env['MERIT_API_ORIGIN'];
    delete process.env['MERIT_API_ORIGIN'];
    try {
      await run();
    } finally {
      if (held !== undefined) process.env['MERIT_API_ORIGIN'] = held;
    }
  };

  const params = Promise.resolve({ accountId: 'acct_0191c2' });

  const routeHtml = async (): Promise<readonly (readonly [string, string])[]> => [
    ['calendar', render(await EconomicCalendarPage())],
    ['timeline', render(await AccountTimelinePage({ params }))],
    ['rules', render(await AccountRulesPage({ params }))],
  ];

  it('each render an unconfigured deployment as unavailable and never as a failure', async () => {
    await withoutOrigin(async () => {
      for (const [name, html] of await routeHtml()) {
        expect(html, name).toContain('data-content-state="unavailable"');

        // NOTHING FAILED AND THE SCREEN SAYS SO. `unavailable` and `error` are
        // two different facts and this is the one where no request was made.
        expect(html, name).toContain('Nothing has failed');
        expect(html, name).not.toContain('data-content-state="error"');
        expect(html.toLowerCase(), name).not.toContain('forbidden');
      }
    });
  });

  it('name the endpoints they were going to read, so an operator can act on it', async () => {
    await withoutOrigin(async () => {
      const html = new Map(await routeHtml());
      const calendar = html.get('calendar') ?? '';
      const timeline = html.get('timeline') ?? '';
      const rules = html.get('rules') ?? '';
      expect(calendar).toContain('GET /economic-calendar');

      // THE FOURTH ENDPOINT. Both account screens read `GET /accounts/:accountId`
      // first, because `as_of_trading_day` and the plan pin live only there.
      expect(timeline).toContain('GET /accounts/:accountId');
      expect(timeline).toContain('GET /accounts/:accountId/timeline');
      expect(rules).toContain('GET /accounts/:accountId');
      expect(rules).toContain('GET /plans/:planId/versions/:version');
    });
  });

  it('do not echo the route parameter into their own markup', async () => {
    await withoutOrigin(async () => {
      // INV-M4-07's direction: on an arm that read nothing, the id in the URL
      // is a string a stranger chose.
      for (const [name, html] of (await routeHtml()).slice(1))
        expect(html, name).not.toContain('acct_0191c2');
    });
  });

  it('emit no chrome of their own, because the layout wraps them', async () => {
    await withoutOrigin(async () => {
      for (const [name, html] of await routeHtml()) {
        expect(html, name).not.toContain('<footer');
        expect(html, name).not.toContain('data-placement="shell-band"');
      }
    });
  });
});

describe('the paging clause', () => {
  // `./load.ts` reads ONE page of a cursor-paginated list. The screen may not
  // render a truncated timeline as a whole one, and `paging` is a required prop
  // with no default so that a caller cannot fail to say which it holds.
  const paged = (paging: { kind: 'complete' } | { kind: 'partial' }): string =>
    render(
      createElement(TimelineScreen, {
        shell: TRADER_SHELL,
        timeline: toTimelineView('acct_0191c2', '2026-03-13', TIMELINE_ITEMS),
        freshness: { kind: 'unstated' },
        paging,
      }),
    );

  it('says a complete timeline is complete', () => {
    const html = paged({ kind: 'complete' });
    expect(html).toContain('data-paging="complete"');
    expect(html).toContain('This is the whole timeline');
    expect(html).not.toContain('has not loaded');
  });

  it('says a truncated one is truncated, and claims no end of the list', () => {
    const html = paged({ kind: 'partial' });
    expect(html).toContain('data-paging="partial"');
    expect(html).toContain('has not loaded');

    // API_CONTRACT section 6 gives this endpoint the word "Chronological" and
    // no direction, so the screen must not say which end it read.
    //
    // ASSERTED ON THE PAGING PARAGRAPH RATHER THAN ON THE PAGE. The as-of
    // stamp's `unstated` note legitimately says "the most recent one" about a
    // TRADING DAY, and a whole-document search cannot tell that sentence from a
    // claim about which end of the list this is.
    const start = html.indexOf('data-paging="partial"');
    const statement = html.slice(start, html.indexOf('</p>', start)).toLowerCase();
    expect(statement).toContain('has not loaded');
    for (const end of ['most recent', 'oldest', 'newest', 'latest'])
      expect(statement, end).not.toContain(end);
  });

  it('refuses to claim nothing has happened on a page that carried nothing', () => {
    const empty = render(
      createElement(TimelineScreen, {
        shell: TRADER_SHELL,
        timeline: toTimelineView('acct_0191c2', '2026-03-13', []),
        freshness: { kind: 'unstated' },
        paging: { kind: 'partial' },
      }),
    );
    expect(empty).toContain('data-entries="none"');
    expect(empty).not.toContain('Nothing has happened on this account yet');
    expect(empty).toContain('not a claim that nothing has happened');
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

  it('names the account read both account screens force, and sends section 1`s limit', () => {
    expect(accountPath('acct_0191c2')).toBe('/accounts/acct_0191c2');

    // THE LIMIT IS IN THE REQUEST RATHER THAN INHERITED FROM THE SERVER'S
    // DEFAULT, because the screen has to state what it read and a default in
    // another deployable can move without a diff here.
    expect(timelinePagePath('acct_0191c2', 100)).toBe('/accounts/acct_0191c2/timeline?limit=100');
  });

  it('reads each body into the view model its screen takes', () => {
    expect(readEconomicCalendarPanel(COVERED_CALENDAR, VIEWER_TIMEZONE).state).toBe('covered');
    expect(readTimeline(TIMELINE_ITEMS, 'acct_0191c2', '2026-03-13').entries).toHaveLength(
      TIMELINE_ITEMS.length,
    );
    expect(readPinnedRules(PINNED_VERSION).superseded).toBe(true);
  });
});
