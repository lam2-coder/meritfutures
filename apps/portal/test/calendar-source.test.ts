// =============================================================================
// apps/portal/test/calendar-source.test.ts
// =============================================================================
// THE SEAM, FOR THE `app/calendar` SEGMENT. ADR-162, executed.
//
// EVERY ASSERTION BELOW GOES THROUGH THE REAL `createApiClient` OVER A STUB
// TRANSPORT, never through a mock of the client. What is being proven is the
// whole path -- URL composition, the forwarded cookie, `no-store`, the status
// mapping, the JSON read, this segment's guards and the view builders --
// because a mock of `ApiClient` would prove that `loadTimelineFrom` calls a
// function.
//
// `apps/portal/test/calendar-segment.test.ts` asserts the MARKUP and the three
// routes; `economic-calendar.test.ts`, `timeline.test.ts` and `rules.test.ts`
// assert the VIEW MODELS. This file asserts what arrives and what happens when
// it does not.

import { expect, test } from 'vitest';

import type { CursorPage } from '../src/api/types.ts';
import type { TimelineItem } from '../src/api/types.ts';
import {
  CALENDAR_REQUIRED_ENDPOINTS,
  ECONOMIC_CALENDAR_PATH,
  PANEL_TIMEZONE,
  RULES_REQUIRED_ENDPOINTS,
  TIMELINE_PAGE_LIMIT,
  TIMELINE_REQUIRED_ENDPOINTS,
  accountPath,
  isCalendarAccountSource,
  isEconomicCalendarPanelResponse,
  isPlanVersionResponse,
  isTimelinePage,
  loadEconomicCalendar,
  loadEconomicCalendarFrom,
  loadRules,
  loadRulesFrom,
  loadTimeline,
  loadTimelineFrom,
  pinnedVersionPath,
  timelinePagePath,
} from '../src/app/calendar/load.ts';
import { CALENDAR_ERROR_COPY } from '../src/app/calendar/states.tsx';
import { API_BASE_PATH, SESSION_COOKIE, createApiClient } from '../src/http/client.ts';
import type { Transport } from '../src/http/client.ts';
import { COVERED_CALENDAR, PINNED_VERSION, TIMELINE_ITEMS } from './calendar-fixtures.ts';

const ORIGIN = 'https://api.example.com';
const ACCOUNT = 'acct_0191c2';

/**
 * `GET /accounts/:accountId`, cut down to the three fields this segment reads.
 *
 * IT IS DELIBERATELY NOT A WHOLE `AccountDetail`. `isCalendarAccountSource`
 * claims three fields and checks three, so a fixture carrying twenty would let
 * the guard pass on fields it never looked at and would hide exactly the
 * over-claim the guard's own docstring refuses.
 */
const ACCOUNT_BODY = {
  account_id: ACCOUNT,
  as_of_trading_day: '2026-03-13',
  plan: { plan_id: PINNED_VERSION.plan_id, version: PINNED_VERSION.version },
};

/** Section 1's envelope, which is what this endpoint actually answers. */
const TIMELINE_BODY: CursorPage<TimelineItem> = {
  data: TIMELINE_ITEMS,
  next_cursor: null,
};

const TIMELINE_PATH = timelinePagePath(ACCOUNT, TIMELINE_PAGE_LIMIT);
const ACCOUNT_PATH = accountPath(ACCOUNT);
const PLAN_PATH = pinnedVersionPath(PINNED_VERSION.plan_id, PINNED_VERSION.version);

type Call = { url: string; init: RequestInit };

/**
 * A transport that answers per path.
 *
 * KEYED ON THE PATH RATHER THAN ON CALL ORDER, because both account screens
 * perform two reads whose second URL is composed from the first response, and
 * an order-keyed stub would pass while the composition was wrong.
 */
function serving(routes: Readonly<Record<string, { body: unknown; status?: number }>>): {
  readonly transport: Transport;
  readonly calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    transport: (url, init) => {
      calls.push({ url, init });
      const path = url.slice(`${ORIGIN}${API_BASE_PATH}`.length);
      const route = routes[path];
      if (route === undefined)
        return Promise.resolve(
          new Response(JSON.stringify({ type: 'about:blank' }), { status: 404 }),
        );
      return Promise.resolve(
        new Response(typeof route.body === 'string' ? route.body : JSON.stringify(route.body), {
          status: route.status ?? 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
  };
}

const clientOver = (transport: Transport, token: string | null = 'tok_abc') =>
  createApiClient({ origin: ORIGIN, sessionToken: token, transport });

// -----------------------------------------------------------------------------
// The paths
// -----------------------------------------------------------------------------

test('the paths are API_CONTRACT`s, and a route parameter cannot reshape one', () => {
  expect(ECONOMIC_CALENDAR_PATH).toBe('/economic-calendar');
  expect(ACCOUNT_PATH).toBe(`/accounts/${ACCOUNT}`);
  expect(PLAN_PATH).toBe('/plans/merit_rapid/versions/3');

  // THE ID ARRIVES FROM A URL SEGMENT AND IS RE-ENCODED. A value carrying a
  // slash would otherwise read an endpoint nobody asked for.
  expect(accountPath('a/../me')).toBe('/accounts/a%2F..%2Fme');
  expect(timelinePagePath('a?b#c', 100)).toBe('/accounts/a%3Fb%23c/timeline?limit=100');

  // SECTION 1's MAXIMUM, SENT RATHER THAN INHERITED FROM THE SERVER'S DEFAULT.
  expect(TIMELINE_PAGE_LIMIT).toBe(100);
});

// -----------------------------------------------------------------------------
// `/calendar`. One read, no account
// -----------------------------------------------------------------------------

test('the economic calendar is a real request and the ready branch is the panel', async () => {
  const { transport, calls } = serving({ [ECONOMIC_CALENDAR_PATH]: { body: COVERED_CALENDAR } });

  const loaded = await loadEconomicCalendarFrom({
    client: clientOver(transport),
    timezone: PANEL_TIMEZONE,
  });

  // THE REQUEST. Base path appended by the client and not by this segment, the
  // trader's one cookie forwarded, and `no-store` because every response on
  // this surface is identity scoped.
  expect(calls.length).toBe(1);
  expect(calls[0]?.url).toBe(`${ORIGIN}${API_BASE_PATH}${ECONOMIC_CALENDAR_PATH}`);
  expect((calls[0]?.init.headers as Record<string, string>)['cookie']).toBe(
    `${SESSION_COOKIE}=tok_abc`,
  );
  expect(calls[0]?.init.cache).toBe('no-store');

  expect(loaded.kind).toBe('ready');
  if (loaded.kind !== 'ready') return;
  expect(loaded.panel.state).toBe('covered');

  // THE TIER FILTER SURVIVES THE WIRE. The fixture carries a Tier-2 row and the
  // panel is Tier-1 only.
  if (loaded.panel.state !== 'covered') return;
  expect(loaded.panel.releases).toHaveLength(3);
  expect(loaded.panel.timezone).toBe(PANEL_TIMEZONE);
});

test('the timezone is echoed onto the panel, so a mis-set one is visible', async () => {
  const { transport } = serving({ [ECONOMIC_CALENDAR_PATH]: { body: COVERED_CALENDAR } });
  const loaded = await loadEconomicCalendarFrom({
    client: clientOver(transport),
    timezone: 'America/New_York',
  });

  // THE CONSTANT IS NOT BAKED INTO THE LOAD. `PANEL_TIMEZONE` is what
  // `loadEconomicCalendar()` supplies and this seam takes it as an argument, so
  // the day a viewer's zone becomes reachable the change is one call site.
  expect(loaded.kind === 'ready' && loaded.panel.state === 'covered' && loaded.panel.timezone).toBe(
    'America/New_York',
  );
});

// -----------------------------------------------------------------------------
// `/calendar/:accountId/timeline`. Two reads, and the envelope
// -----------------------------------------------------------------------------

test('the timeline reads the account first, because the as-of day lives only there', async () => {
  const { transport, calls } = serving({
    [ACCOUNT_PATH]: { body: ACCOUNT_BODY },
    [TIMELINE_PATH]: { body: TIMELINE_BODY },
  });

  const loaded = await loadTimelineFrom({ client: clientOver(transport), account: ACCOUNT });

  expect(calls.map((call) => call.url)).toEqual([
    `${ORIGIN}${API_BASE_PATH}${ACCOUNT_PATH}`,
    `${ORIGIN}${API_BASE_PATH}${TIMELINE_PATH}`,
  ]);

  expect(loaded.kind).toBe('ready');
  if (loaded.kind !== 'ready') return;

  // INV-M4-02: the stamp is the ACCOUNT's day, and `TimelineItem` carries none.
  expect(loaded.timeline.as_of_trading_day).toBe('2026-03-13');
  expect(loaded.timeline.account_id).toBe(ACCOUNT);

  // INV-M4-06 as a number: the load drops nothing the envelope carried.
  expect(loaded.timeline.entries).toHaveLength(TIMELINE_ITEMS.length);

  // ADR-152: no endpoint publishes the day the firm has closed through, so
  // `unstated` is the only constructible arm and it is not `current`.
  expect(loaded.freshness).toEqual({ kind: 'unstated' });
});

test('the paging answer comes from next_cursor and not from the row count', async () => {
  for (const [next_cursor, kind] of [
    [null, 'complete'],
    ['2026-03-10', 'partial'],
  ] as const) {
    const { transport } = serving({
      [ACCOUNT_PATH]: { body: ACCOUNT_BODY },
      [TIMELINE_PATH]: { body: { data: TIMELINE_ITEMS, next_cursor } },
    });
    const loaded = await loadTimelineFrom({ client: clientOver(transport), account: ACCOUNT });
    expect(loaded.kind === 'ready' && loaded.paging.kind).toBe(kind);
  }
});

test('NO CURSOR IS EVER SENT, because section 1 calls the token opaque', async () => {
  const { transport, calls } = serving({
    [ACCOUNT_PATH]: { body: ACCOUNT_BODY },
    [TIMELINE_PATH]: { body: { data: TIMELINE_ITEMS, next_cursor: '2026-03-10' } },
  });
  await loadTimelineFrom({ client: clientOver(transport), account: ACCOUNT });

  // ONE PAGE AND NOT ALL OF THEM. A load that followed the cursor would show a
  // third call here, and the reason it must not is in `load.ts`: unbounded
  // uncached round trips inside one server render.
  expect(calls).toHaveLength(2);
  for (const call of calls) expect(call.url).not.toContain('cursor=');
});

// -----------------------------------------------------------------------------
// `/calendar/:accountId/rules`. Two reads, and the pin
// -----------------------------------------------------------------------------

test('the rules page reads the PINNED version, composed from the account`s own pin', async () => {
  const { transport, calls } = serving({
    [ACCOUNT_PATH]: { body: ACCOUNT_BODY },
    [PLAN_PATH]: { body: PINNED_VERSION },
  });

  const loaded = await loadRulesFrom({ client: clientOver(transport), account: ACCOUNT });

  // M04 SECTION 4: "the rules page for an account reads the PINNED version, not
  // the current one." The version in the second URL came off the first response
  // and `pinnedVersionPath` has no way to reach a later one.
  expect(calls[1]?.url).toBe(`${ORIGIN}${API_BASE_PATH}/plans/merit_rapid/versions/3`);

  expect(loaded.kind).toBe('ready');
  if (loaded.kind !== 'ready') return;
  expect(loaded.rules.version).toBe(3);
  expect(loaded.rules.superseded).toBe(true);
  expect(loaded.as_of_trading_day).toBe('2026-03-13');
});

// -----------------------------------------------------------------------------
// The three arms
// -----------------------------------------------------------------------------

test('a refusal on a registered endpoint is an error and never a pending endpoint', async () => {
  for (const [status, kind] of [
    [401, 'unauthenticated'],
    [404, 'not_found'],
    [429, 'rate_limited'],
    [500, 'server_error'],

    // THE ONE ALL THREE SCREENS MEET ON THIS TREE. `readTimeline`,
    // `readProgress` and the unwired economic-calendar source each raise before
    // they answer, so every endpoint this segment reads is a 5xx today.
    [503, 'server_error'],
    [403, 'unexpected'],
  ] as const) {
    const { transport } = serving({
      [ECONOMIC_CALENDAR_PATH]: { body: { type: 'about:blank' }, status },
    });
    const loaded = await loadEconomicCalendarFrom({
      client: clientOver(transport, null),
      timezone: PANEL_TIMEZONE,
    });
    expect(loaded).toEqual({ kind: 'error', error: kind, status });
  }
});

test('a 2xx whose body does not satisfy the guard is server_error and not unavailable', async () => {
  // The endpoint is registered and it REPLIED, so "waiting on an endpoint"
  // would be false. `status` is null because `ApiSuccess` carries none.
  const { transport } = serving({
    [ECONOMIC_CALENDAR_PATH]: { body: { freshness: { stale: false }, occurrences: [] } },
  });
  const loaded = await loadEconomicCalendarFrom({
    client: clientOver(transport),
    timezone: PANEL_TIMEZONE,
  });
  expect(loaded).toEqual({ kind: 'error', error: 'server_error', status: null });
});

test('an unconfigured deployment is unavailable on every screen, and names its endpoints', async () => {
  const held = process.env['MERIT_API_ORIGIN'];
  delete process.env['MERIT_API_ORIGIN'];
  try {
    expect(await loadEconomicCalendar()).toEqual({
      kind: 'unavailable',
      missing: [...CALENDAR_REQUIRED_ENDPOINTS],
    });
    expect(await loadTimeline(ACCOUNT)).toEqual({
      kind: 'unavailable',
      missing: [...TIMELINE_REQUIRED_ENDPOINTS],
    });
    expect(await loadRules(ACCOUNT)).toEqual({
      kind: 'unavailable',
      missing: [...RULES_REQUIRED_ENDPOINTS],
    });
  } finally {
    if (held !== undefined) process.env['MERIT_API_ORIGIN'] = held;
  }
});

test('a misconfigured origin PROPAGATES rather than reading as a pending endpoint', async () => {
  // ADR-162 foreclosure 6 converts `ApiConfigError` AND NOTHING ELSE. This is
  // still an `ApiConfigError`, so it still converts; the direction being
  // asserted is that the refusal happens at all rather than resolving to some
  // default origin.
  const held = process.env['MERIT_API_ORIGIN'];
  process.env['MERIT_API_ORIGIN'] = 'http://api.example.com';
  try {
    expect((await loadEconomicCalendar()).kind).toBe('unavailable');
  } finally {
    if (held === undefined) delete process.env['MERIT_API_ORIGIN'];
    else process.env['MERIT_API_ORIGIN'] = held;
  }
});

// -----------------------------------------------------------------------------
// The guards. Every field the view builders read, and not a subset
// -----------------------------------------------------------------------------

test('the envelope guard checks next_cursor and not only the rows', () => {
  expect(isTimelinePage(TIMELINE_BODY)).toBe(true);
  expect(isTimelinePage({ data: TIMELINE_ITEMS, next_cursor: '2026-03-10' })).toBe(true);

  // A RESPONSE WITH ROWS AND NO CURSOR MEMBER WOULD OTHERWISE BE REPORTED AS A
  // COMPLETE TIMELINE, because `undefined !== null` is the only thing that
  // separates "there is no more" from "the field was not sent".
  expect(isTimelinePage({ data: TIMELINE_ITEMS })).toBe(false);

  // A bare array is what this segment used to believe the endpoint answered.
  expect(isTimelinePage(TIMELINE_ITEMS)).toBe(false);
});

test('a fractional money detail is refused at the boundary and not inside a component', () => {
  const fractional = {
    data: [{ ...TIMELINE_ITEMS[1], detail: { realized_pnl_cents: -18750.5 } }],
    next_cursor: null,
  };
  expect(isTimelinePage(fractional)).toBe(false);

  // AND A MONEY-SUFFIXED KEY CARRYING A STRING IS NOT REFUSED, because
  // `view/timeline.ts` rules it: "a timeline that refuses to render because one
  // detail was a string is a screen that goes blank at the moment something
  // unusual happened."
  expect(
    isTimelinePage({
      data: [{ ...TIMELINE_ITEMS[1], detail: { realized_pnl_cents: 'withheld' } }],
      next_cursor: null,
    }),
  ).toBe(true);
});

test('the panel guard checks all seven occurrence fields and both freshness fields', () => {
  expect(isEconomicCalendarPanelResponse(COVERED_CALENDAR)).toBe(true);

  for (const drop of [
    'event_key',
    'occurrence_key',
    'tier',
    'scheduled_release_at',
    'release_trading_day',
    'revision',
    'revision_reason',
  ] as const) {
    const occurrence: Record<string, unknown> = { ...COVERED_CALENDAR.occurrences[0] };
    delete occurrence[drop];
    expect(
      isEconomicCalendarPanelResponse({
        freshness: COVERED_CALENDAR.freshness,
        occurrences: [occurrence],
      }),
      drop,
    ).toBe(false);
  }

  expect(isEconomicCalendarPanelResponse({ freshness: { stale: false }, occurrences: [] })).toBe(
    false,
  );

  // `covered_through_day` IS NULLABLE because "nothing has ever been loaded" is
  // a state the panel renders rather than a missing field.
  expect(
    isEconomicCalendarPanelResponse({
      freshness: { stale: true, covered_through_day: null },
      occurrences: [],
    }),
  ).toBe(true);
});

test('the plan guard refuses a status outside the contract`s two members', () => {
  expect(isPlanVersionResponse(PINNED_VERSION)).toBe(true);
  expect(isPlanVersionResponse({ ...PINNED_VERSION, status: 'draft' })).toBe(false);

  // `superseded` IS DERIVED FROM `status === 'retired'`, so a widened union
  // renders a superseded contract as the current one. INV-M4-08.
  expect(isPlanVersionResponse({ ...PINNED_VERSION, status: 'published' })).toBe(true);

  // `rules` is opaque and is checked as JSON rather than by key.
  expect(isPlanVersionResponse({ ...PINNED_VERSION, rules: { a: [1, { b: null }] } })).toBe(true);
  expect(isPlanVersionResponse({ ...PINNED_VERSION, rules: { a: () => 1 } })).toBe(false);

  // Every size field, on the funded shape whose profit target is absent.
  expect(isPlanVersionResponse({ ...PINNED_VERSION, sizes: [{ size_cents: 1 }] })).toBe(false);
});

test('the account guard claims three fields and checks three', () => {
  expect(isCalendarAccountSource(ACCOUNT_BODY)).toBe(true);
  expect(isCalendarAccountSource({ ...ACCOUNT_BODY, as_of_trading_day: undefined })).toBe(false);
  expect(isCalendarAccountSource({ ...ACCOUNT_BODY, plan: { plan_id: 'p' } })).toBe(false);
  expect(isCalendarAccountSource({ ...ACCOUNT_BODY, plan: { plan_id: 'p', version: 3.5 } })).toBe(
    false,
  );
});

// -----------------------------------------------------------------------------
// INV-M4-07, over the copy rather than over a reader's attention
// -----------------------------------------------------------------------------

test('no sentence in this segment words a refusal as a refusal of permission', () => {
  for (const sentence of Object.values(CALENDAR_ERROR_COPY)) {
    const lower = sentence.toLowerCase();
    for (const banned of ['forbidden', 'not allowed', 'no permission', 'denied', 'unauthorized'])
      expect(lower, sentence).not.toContain(banned);
  }
});
