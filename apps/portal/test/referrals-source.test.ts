import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';

import type { AffiliateStats } from '../src/api/types.ts';
import {
  AFFILIATE_STATS_PATH,
  NFA_DISCLOSURE_READ,
  REFUSED_READS,
  STATS_UNREACHABLE,
  isAffiliateStats,
  load,
  loadFrom,
} from '../src/app/referrals/data.ts';
import ReferralsPage from '../src/app/referrals/page.ts';
import {
  REFERRALS_ERROR_COPY,
  ReferralsError,
  ReferralsUnavailable,
} from '../src/app/referrals/states.ts';
import {
  API_BASE_PATH,
  API_ORIGIN_VAR,
  SESSION_COOKIE,
  createApiClient,
} from '../src/http/client.ts';
import type { Transport } from '../src/http/client.ts';
import type { CreateCreativeResponse } from '../src/view/referrals.ts';

// =============================================================================
// THE SEAM, FOR THE REFERRALS SEGMENT. ADR-162 executed, ADR-168 obeyed
// =============================================================================
// EVERY ASSERTION BELOW GOES THROUGH THE REAL `createApiClient` OVER A STUB
// TRANSPORT, never through a mock of the client. What is being proven is the
// whole path -- URL composition, the forwarded cookie, `no-store`, the status
// mapping, the JSON read, this segment's guard and the three screens -- because
// a mock of `ApiClient` would prove only that `loadFrom` calls a function.
//
// `apps/portal/test/referrals.test.ts` asserts the VIEW MODELS and
// `apps/portal/test/app-referrals.test.ts` asserts the MARKUP and the one
// compliance clause. This file asserts what arrives, what happens when it does
// not, and the one thing that is never going to arrive.
//
// -----------------------------------------------------------------------------
// THE FACT THIS FILE EXISTS TO KEEP STRAIGHT
// -----------------------------------------------------------------------------
// Three reads, three different facts, and the segment must not spell two of
// them the same way:
//
//   GET /affiliate/stats       REGISTERED. Read it, guard it, report a refusal
//                              as a refusal
//   the NFA disclosure text    NOTHING SERVES IT YET. A later slice can
//   GET /affiliate/creatives   REFUSED by ADR-168 clause 3. Nothing is coming
//
// A screen that put the third under "Waiting on" would be reopening a ruling by
// wording, and the assertions below are what stop that happening in a diff
// nobody read as a scope decision.

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');

const ORIGIN = 'https://api.example.com';

const DISCLOSURE_TEXT =
  'Merit accounts are simulated. Merit compensates this promoter for referred ' +
  'purchases. Past results do not predict future results.';

/** API_CONTRACT section 7's `AffiliateStats`, transcribed. */
const STATS: AffiliateStats = {
  code: 'TRADER77',
  commission_bp: 1_500,
  status: 'active',
  clicks_30d: 412,
  conversions_30d: 9,
  earned_cents_lifetime: 184_500,

  // NOT `earned` less `paid`, which is the only way to prove the guard and the
  // panel read the server's own figure. M08:13 puts a clawback window between
  // them and 184,500 less 130,000 is 54,500, not 42,000.
  payable_cents: 42_000,
  paid_cents_lifetime: 130_000,
  chargeback_rate_bp: 240,
};

/** `POST /affiliate/creatives`' response, which is the only place a creative appears. */
const CREATIVE: CreateCreativeResponse = {
  creative: {
    creative_id: '7c1f0a3e-9b42-4d51-8a10-2f6c5e0d1b93',
    kind: 'landing',
    url_or_ref: 'https://example.com/merit-eval-review',
    status: 'pending',
    submitted_at: '2026-08-27T14:02:11Z',
  },
  required_disclosure: {
    tos_version_id: '3d9b6c14-77ae-4b2f-9c08-51ad4e7f2c60',
    version: '4',
    text: 'This communication is a paid promotion of Merit Futures.',
  },
};

type Call = { url: string; init: RequestInit };

function serving(route: { body: unknown; status?: number }): {
  readonly transport: Transport;
  readonly calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    transport: (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(
        new Response(typeof route.body === 'string' ? route.body : JSON.stringify(route.body), {
          status: route.status ?? 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
  };
}

function clientFor(route: { body: unknown; status?: number }, token: string | null = null) {
  const served = serving(route);
  return {
    calls: served.calls,
    client: createApiClient({ origin: ORIGIN, sessionToken: token, transport: served.transport }),
  };
}

// -----------------------------------------------------------------------------
// 1. The path
// -----------------------------------------------------------------------------

test('the path is API_CONTRACT`s and agrees with the handler that serves it', () => {
  expect(AFFILIATE_STATS_PATH).toBe('/affiliate/stats');

  // A SECOND COPY OF A CONSTANT ANOTHER DEPLOYABLE OWNS IS ASSERTED RATHER THAN
  // HOPED FOR, which is the treatment ADR-162 gives `API_BASE_PATH` and
  // `SESSION_COOKIE` and `app/kyc/source.ts` gives its own path, for one stated
  // reason: a copy nobody checks drifts silently, and a wrong path here answers
  // 404, which `toPortalErrorKind` maps to `not_found`, on a screen that would
  // then tell an affiliate their referral record was not found.
  const route = readFileSync(join(REPO, 'apps/api/src/routes/affiliate.ts'), 'utf8');
  expect(route).toContain(`export const AFFILIATE_STATS_PATH = '${AFFILIATE_STATS_PATH}';`);

  // AND IT CARRIES NO BASE PATH. `../src/http/client.ts` appends it.
  expect(AFFILIATE_STATS_PATH.startsWith('/')).toBe(true);
  expect(AFFILIATE_STATS_PATH).not.toContain(API_BASE_PATH);
});

// -----------------------------------------------------------------------------
// 2. The read, through the real client
// -----------------------------------------------------------------------------

test('the ready branch is reached through a real request and carries one cookie', async () => {
  const { client, calls } = clientFor({ body: STATS }, 'tok_abc');

  const loaded = await loadFrom({ client, disclosureText: DISCLOSURE_TEXT, creative: CREATIVE });

  // THE REQUEST. Base path appended by the client and not by this segment, the
  // affiliate's one cookie forwarded, and `no-store` on a screen that renders
  // money.
  expect(calls.length).toBe(1);
  expect(calls[0]?.url).toBe(`${ORIGIN}${API_BASE_PATH}${AFFILIATE_STATS_PATH}`);
  expect(calls[0]?.init.method).toBe('GET');
  expect((calls[0]?.init.headers as Record<string, string>)['cookie']).toBe(
    `${SESSION_COOKIE}=tok_abc`,
  );
  expect(calls[0]?.init.cache).toBe('no-store');

  expect(loaded).toEqual({
    kind: 'ready',
    stats: STATS,
    creative: CREATIVE,
    disclosure_text: DISCLOSURE_TEXT,
  });
});

test('a missing cookie is still a request, because the portal authorizes nobody', async () => {
  const { client, calls } = clientFor({ body: STATS }, null);
  await loadFrom({ client, disclosureText: DISCLOSURE_TEXT, creative: null });

  // ADR-162's client header: "A MISSING COOKIE IS NOT AN ERROR HERE ... the
  // alternative would put the portal in the business of deciding who is signed
  // in, which is INV-M4-06 in the direction nobody watches."
  expect(calls.length).toBe(1);
  expect((calls[0]?.init.headers as Record<string, string>)['cookie']).toBeUndefined();
});

test('a refusal on a registered endpoint is an error and not a pending read', async () => {
  for (const [status, kind] of [
    [401, 'unauthenticated'],
    [404, 'not_found'],
    [429, 'rate_limited'],
    [500, 'server_error'],
    [403, 'unexpected'],
  ] as const) {
    const { client } = clientFor({ body: { type: 'about:blank' }, status });

    // THIS IS THE ARM THE PAYOUT CENTRE DOES NOT HAVE (ADR-162 section 5 item
    // 1). Without it every one of these five renders as "waiting on a read",
    // which is false on all five.
    expect(
      await loadFrom({ client, disclosureText: DISCLOSURE_TEXT, creative: null }),
      String(status),
    ).toEqual({ kind: 'error', error: kind, status });
  }
});

test('the error arm wins even when a read this screen also needs is pending', async () => {
  // A 500 ON A REGISTERED ENDPOINT IS THE MORE URGENT FACT. Reporting "waiting
  // on the NFA disclosure text" while `GET /affiliate/stats` was answering 500
  // would hide a live failure behind a known gap.
  const { client } = clientFor({ body: { type: 'about:blank' }, status: 500 });
  expect(await loadFrom({ client, disclosureText: null, creative: null })).toEqual({
    kind: 'error',
    error: 'server_error',
    status: 500,
  });
});

test('a transport failure propagates as an error with no status invented', async () => {
  const client = createApiClient({
    origin: ORIGIN,
    sessionToken: null,
    transport: () => Promise.reject(new Error('ECONNREFUSED')),
  });

  // ADR-162 clause 3: a request that never reached a status line has no number,
  // and `503` is the tempting one to invent.
  expect(await loadFrom({ client, disclosureText: DISCLOSURE_TEXT, creative: null })).toEqual({
    kind: 'error',
    error: 'server_error',
    status: null,
  });
});

test('a 200 that does not satisfy the guard is a server that answered wrongly', async () => {
  for (const body of [
    [STATS],
    { data: STATS, next_cursor: null },
    { ...STATS, payable_cents: 42_000.5 },
    { ...STATS, chargeback_rate_bp: '240' },
    'not json at all',
  ]) {
    const { client } = clientFor({ body });
    const loaded = await loadFrom({ client, disclosureText: DISCLOSURE_TEXT, creative: null });

    // NOT `unavailable`. The endpoint is registered and it replied, so "waiting
    // on a read" would be a false sentence about a real answer.
    //
    // THE ENVELOPE CASE IS IN THIS LIST ON PURPOSE. API_CONTRACT section 1's
    // `{ data, next_cursor }` wraps the cursor lists on this surface and
    // section 7 declares `AffiliateStats` as nine scalar fields, so a wrapped
    // body would be a server answering a different row's shape, and this guard
    // refuses it rather than reaching into `data`.
    expect(loaded.kind, JSON.stringify(body).slice(0, 60)).toBe('error');
    if (loaded.kind !== 'error') continue;
    expect(loaded.error).toBe('server_error');
    expect(loaded.status).toBe(body === 'not json at all' ? 200 : null);
  }
});

// -----------------------------------------------------------------------------
// 3. Pending is not refused, and the type is what keeps them apart
// -----------------------------------------------------------------------------

test('the read nothing serves is measured, and the read a ruling refused is not in it', async () => {
  const { client } = clientFor({ body: STATS });
  const loaded = await loadFrom({ client, disclosureText: null, creative: null });

  expect(loaded).toEqual({ kind: 'unavailable', missing: [NFA_DISCLOSURE_READ] });

  // THE LIST IS A MEASUREMENT AND NOT A CONSTANT. `GET /affiliate/stats` was
  // read successfully on this branch and is therefore NOT named, which a fixed
  // `REQUIRED_ENDPOINTS` spread would have named anyway.
  if (loaded.kind !== 'unavailable') return;
  expect(loaded.missing.map((pending) => pending.read)).not.toContain(
    `GET ${AFFILIATE_STATS_PATH}`,
  );

  // AND THE REFUSED READ IS NOT IN IT, ON ANY BRANCH. ADR-168 clause 3 ruled
  // `GET /affiliate/creatives` out by name; a screen that listed it as pending
  // would be this application reopening that ruling by wording, which is
  // foreclosure 7's "the application named it, therefore it is owed".
  for (const pending of loaded.missing) {
    expect(pending.kind).toBe('pending');
    expect(pending.read).not.toContain('creatives');
  }
});

test('the refused read names the ruling, and the two absences are different types', () => {
  expect(REFUSED_READS).toEqual([
    { kind: 'refused', read: 'GET /affiliate/creatives', ruling: 'ADR-168 clause 3' },
  ]);

  // THE DISCRIMINANT IS THE CONTROL AND IT IS A COMPILE-TIME ONE. `missing` is
  // `readonly PendingRead[]`, so a `RefusedRead` pushed into it is `error
  // TS2741` at the line that wrote it. This assertion is the runtime shadow of
  // that: the two constants cannot be confused by a reader either.
  expect(NFA_DISCLOSURE_READ.kind).toBe('pending');
  expect(STATS_UNREACHABLE.kind).toBe('pending');
  expect(REFUSED_READS.every((refused) => refused.kind === 'refused')).toBe(true);

  // AND THE SEGMENT ASKS FOR THE REFUSED ENDPOINT NOWHERE. ADR-168's own
  // measurement (its finding 6) was that no portal segment CALLS any of the
  // three reads it ruled on; this keeps that true now that the segment has a
  // client to call one with.
  //
  // THE PATH IS ALLOWED IN EXACTLY ONE PLACE, AND THE ASSERTION IS SCOPED TO
  // THAT RATHER THAN TO THE STRING. Recording a refusal requires naming what
  // was refused, so a bare "this string appears nowhere" check would forbid the
  // record along with the request. What may not exist is a REQUEST, and the one
  // path this segment ever hands the client is the stats path.
  const dir = join(HERE, '..', 'src', 'app', 'referrals');
  const stripped = (file: string): string =>
    readFileSync(join(dir, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ');

  const data = stripped('data.ts');
  expect(data.split('/affiliate/creatives').length - 1, 'named once in code').toBe(1);
  const declaration = data.slice(data.indexOf('export const REFUSED_READS'));
  expect(declaration.slice(0, declaration.indexOf('];'))).toContain('/affiliate/creatives');

  for (const file of ['page.ts', 'screen.ts', 'states.ts'])
    expect(stripped(file).includes('/affiliate/creatives'), `${file} names it in code`).toBe(false);

  expect(data).toContain('client.get(AFFILIATE_STATS_PATH)');
  expect(data, 'nothing in this segment requests the refused read').not.toMatch(
    /get\([^)]*creatives/,
  );
});

// -----------------------------------------------------------------------------
// 4. The guard, field by field
// -----------------------------------------------------------------------------

test('the guard accepts the contract shape and refuses every field the panel reads', () => {
  expect(isAffiliateStats(STATS)).toBe(true);

  // `toReferralPanel` READS ALL NINE, so all nine are required. ADR-162
  // foreclosure 5: a partial guard "reads as a complete one at the call site
  // and crashes on the field it skipped".
  expect(Object.keys(STATS).length).toBe(9);
  for (const field of Object.keys(STATS)) {
    const body: Record<string, unknown> = { ...STATS };
    delete body[field];
    expect(isAffiliateStats(body), `${field} is required`).toBe(false);
  }

  // Money is integer cents, and the basis-point figures are integers too:
  // ../src/format/money.ts is INV-M4-01's only permitted consumer of either and
  // it throws on a value that is not exact.
  for (const field of [
    'commission_bp',
    'earned_cents_lifetime',
    'payable_cents',
    'paid_cents_lifetime',
    'chargeback_rate_bp',
  ]) {
    expect(isAffiliateStats({ ...STATS, [field]: 1.5 }), `${field} is an integer`).toBe(false);
  }

  // The two counts are integers for the same reason, one layer up: a
  // fractional click count is a server that answered wrongly.
  for (const field of ['clicks_30d', 'conversions_30d'])
    expect(isAffiliateStats({ ...STATS, [field]: 4.5 }), `${field} is an integer`).toBe(false);

  // `status` and `code` ARE STRINGS AND NOT A CLOSED UNION, which is
  // ../src/view/referrals.ts's own ruling carried into the guard: "affiliates.
  // status, as the server sent it. The portal decides no lifecycle."
  expect(isAffiliateStats({ ...STATS, status: 'suspended' })).toBe(true);
  expect(isAffiliateStats({ ...STATS, status: 7 })).toBe(false);
  expect(isAffiliateStats({ ...STATS, code: null })).toBe(false);

  for (const notAnObject of [null, [], 'stats', 7, undefined])
    expect(isAffiliateStats(notAnObject), String(notAnObject)).toBe(false);
});

// -----------------------------------------------------------------------------
// 5. `load`, and the one error it converts
// -----------------------------------------------------------------------------

test('an unconfigured deployment reaches nothing and the screen says which reads', async () => {
  const saved = process.env[API_ORIGIN_VAR];
  delete process.env[API_ORIGIN_VAR];
  try {
    const loaded = await load();
    expect(loaded).toEqual({
      kind: 'unavailable',
      missing: [STATS_UNREACHABLE, NFA_DISCLOSURE_READ],
    });

    // THE TWO PENDING READS ARE PENDING FOR DIFFERENT REASONS AND SAY SO.
    // `GET /affiliate/stats` is registered and merely unreachable; the
    // disclosure text is served by nothing at all. Collapsing them would tell a
    // later reader that the stats endpoint does not exist.
    expect(STATS_UNREACHABLE.why).toBe('no_api_origin');
    expect(NFA_DISCLOSURE_READ.why).toBe('nothing_serves_it');
  } finally {
    if (saved !== undefined) process.env[API_ORIGIN_VAR] = saved;
  }
});

test('the conversion is narrow: anything that is not a configuration error propagates', async () => {
  // WITH AN ORIGIN SET, `load` GETS PAST `resolveApiOrigin` AND REACHES
  // `cookies()`, WHICH HAS NO REQUEST SCOPE HERE. That failure is NOT an
  // `ApiConfigError` and must not be rendered as a pending read: a screen that
  // reported every fault in this application as "waiting on GET
  // /affiliate/stats" would be the quiet failure ADR-162 foreclosure 6 refuses.
  const saved = process.env[API_ORIGIN_VAR];
  process.env[API_ORIGIN_VAR] = ORIGIN;
  try {
    await expect(load()).rejects.toBeDefined();
  } finally {
    if (saved === undefined) delete process.env[API_ORIGIN_VAR];
    else process.env[API_ORIGIN_VAR] = saved;
  }
});

// -----------------------------------------------------------------------------
// 6. The three arms as three screens
// -----------------------------------------------------------------------------

test('the page renders the unavailable arm, names both lists, and does not throw', async () => {
  const saved = process.env[API_ORIGIN_VAR];
  delete process.env[API_ORIGIN_VAR];
  try {
    const html = renderToStaticMarkup(await ReferralsPage());

    // NOT AN EXCEPTION AND NOT A SEEDED PANEL. ./data.ts used to reject here.
    expect(html).toContain('Nothing has failed');
    expect(html).toContain('Waiting on');
    expect(html).toContain(`GET ${AFFILIATE_STATS_PATH}`);
    expect(html).toContain('content_documents');

    // AND THE REFUSED READ IS ON THE SCREEN UNDER DIFFERENT WORDS. "Waiting on"
    // is a promise that something is coming; "Not served" is a decision, and it
    // carries the entry that took it.
    expect(html).toContain('Not served');
    expect(html).toContain('GET /affiliate/creatives (ADR-168 clause 3)');

    // THE REFUSED READ IS NEVER UNDER THE PENDING WORDS. This is the assertion
    // that fails if a later edit merges the two lists to tidy the markup.
    const waiting = html.slice(html.indexOf('Waiting on'), html.indexOf('Not served'));
    expect(waiting).not.toContain('creatives');
  } finally {
    if (saved !== undefined) process.env[API_ORIGIN_VAR] = saved;
  }
});

test('no sentence this segment shows an affiliate words a refusal as one of permission', () => {
  // INV-M4-07: "existence is not confirmed to a stranger, AND THE UI MUST NOT
  // UNDO THAT BY WORDING." `PortalErrorKind` has no `forbidden` member, and a
  // copy catalogue is where that refusal gets reinstated by a sentence.
  for (const [kind, sentence] of Object.entries(REFERRALS_ERROR_COPY)) {
    for (const word of ['forbidden', 'not allowed', 'permission', 'denied', 'unauthorized'])
      expect(sentence.toLowerCase(), `${kind} says ${word}`).not.toContain(word);
  }

  // AND THE STATUS IS NOT ON THE SCREEN. The load carries it for a later
  // observability slice; the markup does not.
  const refused = renderToStaticMarkup(
    ReferralsError({ heading: 'Referrals', error: 'not_found' }),
  );
  const text = refused.replace(/<[^>]*>/g, ' ');
  expect(text).toContain(REFERRALS_ERROR_COPY.not_found);
  expect(text, 'no status number reaches the affiliate').not.toMatch(/\d/);
});

test('the unavailable screen renders no refused section when there is nothing refused', () => {
  // The component is honest in both directions: a segment with no refused read
  // renders no decision, rather than an empty heading a reader would have to
  // interpret.
  const html = renderToStaticMarkup(
    ReferralsUnavailable({ heading: 'Referrals', missing: [NFA_DISCLOSURE_READ], refused: [] }),
  );
  expect(html).toContain('Waiting on');
  expect(html).not.toContain('Not served');
});
