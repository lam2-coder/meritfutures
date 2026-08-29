import { afterEach, expect, test } from 'vitest';

import { BASE_PATH, PROBLEM_MEDIA_TYPE, buildServer, discoverRouteModules } from '../src/index.ts';
import {
  ECONOMIC_CALENDAR_PATH,
  ECONOMIC_CALENDAR_REQUIRED_FACTORS,
  EconomicCalendarError,
  EconomicCalendarUnconfigured,
  renderEconomicCalendar,
  setEconomicCalendarSource,
} from '../src/routes/economic-calendar.ts';
import type {
  EconomicCalendarPanel,
  EconomicCalendarResponse,
  EconomicCalendarRow,
  EconomicCalendarSource,
} from '../src/routes/economic-calendar.ts';
import { resetAuthBackend, useAuthBackend, UNWIRED_AUTH_BACKEND } from '../src/routes/auth.ts';
import type { AuthBackend, AuthSession } from '../src/routes/auth.ts';

// CI-02, the `unit` project.
//
// WHAT THIS SUITE IS FOR. `GET /economic-calendar` renders two date strings that
// are in DIFFERENT VOCABULARIES: `scheduled_release_at` is a UTC instant and
// `release_trading_day` is an exchange CT trading day. On most rows the two
// agree, which is why the assertion that matters is the one on a row where they
// DO NOT. A test written against a row where they agree would pass against a
// route that derived the day from the instant, and would therefore assert
// nothing about the only thing this route exists to get right.

// -----------------------------------------------------------------------------
// THE DATE WHERE THE TWO ACTUALLY DIFFER, DERIVED ONCE, HERE, AND NOT IN SOURCE
// -----------------------------------------------------------------------------
// `0039_economic_calendar.sql` header item 5 gives the example in its own words:
// "a release at 23:30 UTC is not on the UTC calendar date the engine counts in".
// `0032_trading_calendar_holidays_coverage_revisions.sql` gives the mechanism:
// "The next session opens at 17:00 CT regardless".
//
//   2026-03-03T23:30:00Z   is the instant. Its UTC calendar date is 2026-03-03.
//   2026-03-03 17:30 CT    is the same instant in Central Time. US daylight
//                          time begins 2026-03-08, so 2026-03-03 is CST, UTC-6.
//   2026-03-04             is the TRADING DAY, because 17:30 CT is inside the
//                          session that opened at 17:00 CT on 2026-03-03, and
//                          that session's trading day is the next date.
//
// So `scheduled_release_at.slice(0, 10)` is `2026-03-03` and the trading day is
// `2026-03-04`. THE TWO DISAGREE, which is what makes the assertion below able
// to fail.
const DIVERGENT_INSTANT = '2026-03-03T23:30:00Z';
const DIVERGENT_UTC_DATE = '2026-03-03';
const DIVERGENT_TRADING_DAY = '2026-03-04';

/** The evening release. The row on which the vocabularies come apart. */
const EVENING: EconomicCalendarRow = {
  event_key: 'US.CPI.MOM',
  occurrence_key: '2026-03',
  tier: 1,
  scheduled_release_at: DIVERGENT_INSTANT,
  release_trading_day: DIVERGENT_TRADING_DAY,
  revision: 0,
  revision_reason: null,
};

/**
 * A morning release, where the two DO agree, kept deliberately.
 *
 * 2026-03-04T13:30:00Z is 07:30 CST on 2026-03-04, inside the session whose
 * trading day is 2026-03-04, so the UTC date and the trading day are the same
 * string. A suite that held only the divergent row could not tell "renders the
 * stored day" from "renders the day after the instant".
 */
const MORNING: EconomicCalendarRow = {
  event_key: 'US.NFP',
  occurrence_key: '2026-03',
  tier: 1,
  scheduled_release_at: '2026-03-04T13:30:00Z',
  release_trading_day: '2026-03-04',
  revision: 0,
  revision_reason: null,
};

const FRESH = { stale: false, covered_through_day: '2026-04-30' } as const;

function panelOf(
  occurrences: readonly EconomicCalendarRow[],
  freshness: EconomicCalendarPanel['freshness'] = FRESH,
): EconomicCalendarPanel {
  return { freshness, occurrences };
}

function sourceOf(panel: EconomicCalendarPanel): EconomicCalendarSource {
  return { readPanel: () => Promise.resolve(panel) };
}

/** The address, as a caller writes it. */
const url = `${BASE_PATH}${ECONOMIC_CALENDAR_PATH}`;

/**
 * A session, and a backend that recognises exactly one cookie value.
 *
 * The endpoint declares `session`, so reaching the handler at all needs one.
 * Nothing else about the session is used, which is the point section 6.1 makes:
 * "nothing in the response is per-trader".
 */
const SESSION: AuthSession = {
  id: 'ses_11111111',
  identityId: 'idn_11111111',
  userId: 'usr_11111111',
  authFactor: 'email_otp',
  elevatedAt: null,
  elevatedByFactor: null,
};

const GOOD_TOKEN = 'token-that-resolves';

const backend: AuthBackend = {
  ...UNWIRED_AUTH_BACKEND,
  sessionByToken: (token: string) => Promise.resolve(token === GOOD_TOKEN ? SESSION : null),
};

function serve() {
  return buildServer({ surface: 'public', modules: onDisk });
}

const authed = { cookie: `merit_session=${GOOD_TOKEN}` };

/** Every module on disk, which is what the deployments actually compose. */
const onDisk = await discoverRouteModules();

// A source or a backend set by one test and read by the next is a suite that
// passes for the wrong reason, so both are cleared after every case.
afterEach(() => {
  setEconomicCalendarSource(null);
  resetAuthBackend();
});

// -----------------------------------------------------------------------------
// THE CALENDAR CLAUSE
// -----------------------------------------------------------------------------

test('the trading day is rendered on a date where it differs from the UTC date', async () => {
  // The premise the whole assertion rests on, asserted rather than assumed: if
  // these two were ever equal, everything below would pass against a route that
  // derived the day from the instant.
  expect(DIVERGENT_INSTANT.slice(0, 10)).toBe(DIVERGENT_UTC_DATE);
  expect(DIVERGENT_TRADING_DAY).not.toBe(DIVERGENT_UTC_DATE);

  useAuthBackend(backend);
  setEconomicCalendarSource(sourceOf(panelOf([EVENING])));
  const { app } = serve();

  const response = await app.inject({ method: 'GET', url, headers: authed });
  expect(response.statusCode).toBe(200);

  const body = response.json<EconomicCalendarResponse>();
  const only = body.occurrences[0];
  expect(only).toBeDefined();
  expect(only?.release_trading_day).toBe(DIVERGENT_TRADING_DAY);
  expect(only?.release_trading_day).not.toBe(DIVERGENT_UTC_DATE);
  // And the instant is passed through unchanged, so the day was not recovered by
  // shifting the instant into some other zone either.
  expect(only?.scheduled_release_at).toBe(DIVERGENT_INSTANT);

  await app.close();
});

test('a row whose trading day equals the UTC date renders that day, not the next one', async () => {
  useAuthBackend(backend);
  setEconomicCalendarSource(sourceOf(panelOf([MORNING])));
  const { app } = serve();

  const body = (
    await app.inject({ method: 'GET', url, headers: authed })
  ).json<EconomicCalendarResponse>();
  expect(body.occurrences[0]?.release_trading_day).toBe('2026-03-04');
  expect(body.occurrences[0]?.scheduled_release_at.slice(0, 10)).toBe('2026-03-04');

  await app.close();
});

test('the route renders the source order and does not sort', async () => {
  useAuthBackend(backend);
  // The later instant first. `economic_calendar_release_idx` is where ordering
  // lives; a route that sorted RFC 3339 strings would be doing date arithmetic
  // on a format whose precision the contract does not fix.
  setEconomicCalendarSource(sourceOf(panelOf([MORNING, EVENING])));
  const { app } = serve();

  const body = (
    await app.inject({ method: 'GET', url, headers: authed })
  ).json<EconomicCalendarResponse>();
  expect(body.occurrences.map((o) => o.event_key)).toEqual(['US.NFP', 'US.CPI.MOM']);

  await app.close();
});

// -----------------------------------------------------------------------------
// The vocabulary refusals: a `*_at` that is not an instant, a `*_day` that is
// not a day
// -----------------------------------------------------------------------------

test('a scheduled_release_at carrying an offset is refused', () => {
  // The same instant as `DIVERGENT_INSTANT`, written in Central Time. It names
  // the right moment and it is a stored timezone arriving through the response,
  // which is the column `0039` header item 4 refused to create.
  expect(() =>
    renderEconomicCalendar(
      panelOf([{ ...EVENING, scheduled_release_at: '2026-03-03T17:30:00-06:00' }]),
    ),
  ).toThrow(EconomicCalendarError);
});

test('a scheduled_release_at that is a bare day is refused', () => {
  expect(() =>
    renderEconomicCalendar(panelOf([{ ...EVENING, scheduled_release_at: '2026-03-03' }])),
  ).toThrow(EconomicCalendarError);
});

test('a release_trading_day carrying an instant is refused', () => {
  expect(() =>
    renderEconomicCalendar(panelOf([{ ...EVENING, release_trading_day: '2026-03-04T00:00:00Z' }])),
  ).toThrow(EconomicCalendarError);
});

test('a release_trading_day that is not a calendar date is refused', () => {
  expect(() =>
    renderEconomicCalendar(panelOf([{ ...EVENING, release_trading_day: '2026-13-40' }])),
  ).toThrow(EconomicCalendarError);
});

test('covered_through_day is held to the same day vocabulary', () => {
  expect(() =>
    renderEconomicCalendar(
      panelOf([EVENING], { stale: false, covered_through_day: '2026-04-30T00:00:00Z' }),
    ),
  ).toThrow(EconomicCalendarError);
});

// -----------------------------------------------------------------------------
// The freshness refusal: DEP-M4-09's confident empty panel
// -----------------------------------------------------------------------------

test('not stale with nothing ever loaded is refused', () => {
  expect(() =>
    renderEconomicCalendar(panelOf([], { stale: false, covered_through_day: null })),
  ).toThrow(EconomicCalendarError);
});

test('stale with nothing ever loaded renders, and says so', async () => {
  useAuthBackend(backend);
  setEconomicCalendarSource(sourceOf(panelOf([], { stale: true, covered_through_day: null })));
  const { app } = serve();

  const response = await app.inject({ method: 'GET', url, headers: authed });
  expect(response.statusCode).toBe(200);
  const body = response.json<EconomicCalendarResponse>();
  // The empty list is honest here BECAUSE the freshness fact is beside it. This
  // is the pair `DEP-M4-09` exists to make distinguishable from a quiet week.
  expect(body).toEqual({ freshness: { stale: true, covered_through_day: null }, occurrences: [] });

  await app.close();
});

// -----------------------------------------------------------------------------
// The shapes `0039` forbids with a constraint, refused here too
// -----------------------------------------------------------------------------

test('two rows for one occurrence are refused', () => {
  expect(() =>
    renderEconomicCalendar(
      panelOf([EVENING, { ...EVENING, revision: 1, revision_reason: 'source revised' }]),
    ),
  ).toThrow(EconomicCalendarError);
});

test('a tier outside 1 to 3 is refused', () => {
  expect(() => renderEconomicCalendar(panelOf([{ ...EVENING, tier: 4 }]))).toThrow(
    EconomicCalendarError,
  );
});

test('a negative revision is refused', () => {
  expect(() => renderEconomicCalendar(panelOf([{ ...EVENING, revision: -1 }]))).toThrow(
    EconomicCalendarError,
  );
});

test('an original stating a reason is refused, and so is a revision omitting one', () => {
  expect(() =>
    renderEconomicCalendar(panelOf([{ ...EVENING, revision: 0, revision_reason: 'why' }])),
  ).toThrow(EconomicCalendarError);
  expect(() =>
    renderEconomicCalendar(panelOf([{ ...EVENING, revision: 2, revision_reason: null }])),
  ).toThrow(EconomicCalendarError);
});

test('a revision renders with its reason', () => {
  const rendered = renderEconomicCalendar(
    panelOf([{ ...EVENING, revision: 1, revision_reason: 'BLS moved the release' }]),
  );
  expect(rendered.occurrences[0]?.revision).toBe(1);
  expect(rendered.occurrences[0]?.revision_reason).toBe('BLS moved the release');
});

// -----------------------------------------------------------------------------
// The allowlist, the declaration, and the surface
// -----------------------------------------------------------------------------

test('the response carries the contract fields and nothing the view also holds', () => {
  // `id`, `load_id` and `created_at` are on `economic_calendar_current` and are
  // not in API_CONTRACT's type. Section 1's allowlist is what keeps them out,
  // and a spread would have shipped all three.
  const withProvenance = {
    ...EVENING,
    id: 4242,
    load_id: 7,
    created_at: '2026-02-01T00:00:00Z',
  } as unknown as EconomicCalendarRow;

  const rendered = renderEconomicCalendar(panelOf([withProvenance]));
  expect(Object.keys(rendered.occurrences[0] ?? {}).sort()).toEqual([
    'event_key',
    'occurrence_key',
    'release_trading_day',
    'revision',
    'revision_reason',
    'scheduled_release_at',
    'tier',
  ]);
});

test('the endpoint declares session', () => {
  expect(ECONOMIC_CALENDAR_REQUIRED_FACTORS).toEqual({ 'GET /economic-calendar': 'session' });
});

test('a request with no session is unauthenticated, and the source is never read', async () => {
  useAuthBackend(backend);
  let reads = 0;
  setEconomicCalendarSource({
    readPanel: () => {
      reads += 1;
      return Promise.resolve(panelOf([EVENING]));
    },
  });
  const { app } = serve();

  const response = await app.inject({ method: 'GET', url });
  expect(response.statusCode).toBe(401);
  expect(response.headers['content-type']).toContain(PROBLEM_MEDIA_TYPE);
  expect(reads).toBe(0);

  await app.close();
});

test('an unwired source is a 503, and never a 404 and never a 500', async () => {
  useAuthBackend(backend);
  const { app } = serve();

  // 404 would say the calendar does not exist, which is a statement about the
  // world. An unwired source is a statement about this deployment.
  //
  // AND IT USED TO BE A 500, WHICH SAID THE WRONG THING TO THE OTHER READER.
  // ADR-240 separated `EconomicCalendarUnwired` from `EconomicCalendarError`
  // because the two are different facts: a 500 sends an operator looking for a
  // bug and a 503 sends them to the deployment, and only the second is true of
  // a port nobody installed. Every other case of `EconomicCalendarError` is
  // still a 500 and the cases above assert it.
  const response = await app.inject({ method: 'GET', url, headers: authed });
  expect(response.statusCode).toBe(503);
  expect(response.json<{ code: string }>().code).toBe('service_unavailable');

  await app.close();
});

test('a source that refuses as unconfigured is the same 503 and says nothing more', async () => {
  useAuthBackend(backend);
  // THE PORT IS WIRED AND THE DEPLOYMENT IS NOT CONFIGURED, which is the state
  // ADR-240 created and which no case could reach before it. The caller is told
  // exactly what an unwired port tells them; which half is unfinished is the
  // operator's and reaches the log.
  setEconomicCalendarSource({
    readPanel: () =>
      Promise.reject(
        new EconomicCalendarUnconfigured('no horizon is configured, so `stale` has no threshold'),
      ),
  });
  const { app } = serve();

  const response = await app.inject({ method: 'GET', url, headers: authed });
  expect(response.statusCode).toBe(503);
  expect(response.json<{ code: string }>().code).toBe('service_unavailable');
  expect(JSON.stringify(response.json())).not.toContain('horizon');

  await app.close();
});

test('a row the source cannot render is still a 500, so the two refusals stay apart', async () => {
  useAuthBackend(backend);
  // The separation ADR-240 drew has to hold in BOTH directions or it is a
  // rename. A tier of four is a defect in whatever wrote the row, and a 503
  // would tell an operator to go and look at a vault.
  setEconomicCalendarSource(sourceOf(panelOf([{ ...EVENING, tier: 4 }])));
  const { app } = serve();

  const response = await app.inject({ method: 'GET', url, headers: authed });
  expect(response.statusCode).toBe(500);
  expect(response.json<{ code: string }>().code).toBe('internal_error');

  await app.close();
});

test('the operator surface does not serve it', async () => {
  const { app } = buildServer({ surface: 'operator', modules: onDisk });
  const response = await app.inject({ method: 'GET', url, headers: authed });
  expect(response.statusCode).toBe(404);
  await app.close();
});
