import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';

import { PAGE_LIMIT_MAX } from '../src/api/types.ts';
import type {
  CertificateResponse,
  PlanVersionResponse,
  PurchaseListItem,
} from '../src/api/types.ts';
import CertificatesPage from '../src/app/(purchases)/certificates/page.ts';
import { CertificatesScreen } from '../src/app/(purchases)/certificates-screen.ts';
import type { CertificateRequest } from '../src/app/(purchases)/ports.ts';
import PurchasesPage from '../src/app/(purchases)/purchases/page.ts';
import { PurchasesScreen } from '../src/app/(purchases)/purchases-screen.ts';
import {
  CERTIFICATE_IMAGE_PATH,
  CERTIFICATE_LIST_PATH,
  CERTIFICATE_LIST_READ,
  CERTIFICATE_READS_UNREACHABLE,
  DISCLOSURE_READ,
  PURCHASES_PAGE_LIMIT,
  PURCHASES_PATH,
  PURCHASES_UNREACHABLE,
  accountCertificatePath,
  isCertificateResponse,
  isPlanVersionResponse,
  isPurchaseListItem,
  loadCertificates,
  loadCertificatesFrom,
  loadPurchases,
  loadPurchasesFrom,
  planVersionPath,
  purchasesPagePath,
} from '../src/app/(purchases)/source.ts';
import {
  PENDING_READ_COPY,
  PURCHASES_ERROR_COPY,
  PurchasesError,
} from '../src/app/(purchases)/states.ts';
import {
  API_BASE_PATH,
  API_ORIGIN_VAR,
  SESSION_COOKIE,
  createApiClient,
} from '../src/http/client.ts';
import type { Transport } from '../src/http/client.ts';

// =============================================================================
// THE SEAM, FOR `(purchases)`. ADR-162 EXECUTED ON THE LAST OF THE SIX SEGMENTS
// =============================================================================
// EVERY ASSERTION BELOW GOES THROUGH THE REAL `createApiClient` OVER A STUB
// TRANSPORT, never through a mock of the client. What is being proven is the
// whole path -- URL composition, the forwarded cookie, `no-store`, the status
// mapping, the JSON read, this segment's guards, ../src/app/(purchases)/model.ts
// and both screens -- because a mock of `ApiClient` would prove only that a load
// calls a function.
//
// ./page-purchases.test.ts and ./page-certificates.test.ts assert the MARKUP and
// the certificate disclosure boundary over the fixtures, and neither moves this
// session. This file asserts what arrives from a wire, what happens when it does
// not, and that the boundary holds on the two arms the fixtures cannot reach.
//
// -----------------------------------------------------------------------------
// THE FACTS THIS FILE EXISTS TO KEEP STRAIGHT
// -----------------------------------------------------------------------------
//   GET /purchases                        REGISTERED. Read it, guard it, report
//   GET /plans/:planId/versions/:version   a refusal as a refusal
//   GET /accounts/:accountId/certificate  REGISTERED. One read per card
//   GET /certificates                     REGISTERED AND UNREADABLE HERE. The
//                                         portal transcribes no list item
//   GET /certificates/:code/image.png     REGISTERED AND NOT THIS SCREEN'S READ.
//                                         Section 1's first non-JSON response
//   the disclosure text                   NO CONTRACT ROW SERVES IT AT ALL
//
// A screen that spelled the last three the same way would tell a trader that
// Merit is still building something Merit built, or that something failed when
// nothing did. The assertions below are what stop that happening in a diff
// nobody read as a scope decision.

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const SEGMENT = join(HERE, '..', 'src', 'app', '(purchases)');

const ORIGIN = 'https://api.example.com';

/**
 * INV-M4-09's obligation, as `content_documents` would serve it.
 *
 * The text is the obligation's and not this file's to word; what matters here is
 * that it arrives from OUTSIDE the segment, which is why every `ready` assertion
 * passes it in and why `loadCertificates()` cannot reach one.
 */
const DISCLOSURE_TEXT =
  'All trading on Merit accounts is simulated. No order placed on a Merit ' +
  'account reaches a live exchange.';

const PLAN = 'plan_core_eod';

/** Two versions of one plan, differing in one leaf, which is all `toRuleDiff` needs. */
function planVersion(version: number, buffer: number): PlanVersionResponse {
  return {
    plan_version_id: `pv_core_${String(version)}`,
    plan_id: PLAN,
    version,
    status: version === 4 ? 'published' : 'retired',
    published_at: '2026-02-01T00:00:00Z',
    retired_at: version === 4 ? null : '2026-06-01T00:00:00Z',
    rules: { phase_funded: { buffer_bp: buffer, payout_cap_schedule: [{ from_ordinal: 1 }] } },
    copy_blocks: {},
    sizes: [],
  };
}

const V3 = planVersion(3, 200);
const V4 = planVersion(4, 250);

function purchase(over: Partial<PurchaseListItem> = {}): PurchaseListItem {
  return {
    purchase_id: 'pur_2',
    created_at: '2026-05-19T11:03:22Z',
    kind: 'new',
    plan: { plan_id: PLAN, code: 'core_eod', version: 3 },
    size_cents: 5_000_000,
    amount_paid_cents: 17_900,
    discount_cents: 3_000,
    status: 'paid',
    account_id: 'acc_7f21',
    ...over,
  };
}

/** A reset and the purchase it replaced, newest first, which is the server's order. */
const PURCHASES: readonly PurchaseListItem[] = [
  purchase({
    purchase_id: 'pur_3',
    kind: 'reset',
    created_at: '2026-08-20T14:02:11Z',
    plan: { plan_id: PLAN, code: 'core_eod', version: 4 },
  }),
  purchase(),
];

const PASS_CARD: CertificateResponse = {
  certificate_id: '9f3c8b02-7a41-4d55-b0e1-2c6a9d14f7e8',
  kind: 'pass',
  image_url: 'https://cdn.example.com/cards/QK7M2P.png?exp=1787000000&sig=6a1f',
  verify_url: 'https://example.com/verify/QK7M2P',
  issued_at: '2026-06-18T21:04:33Z',
  claims: { plan_code: 'core_eod', size_cents: 5_000_000, trading_day: '2026-06-18' },
};

const REQUESTS: readonly CertificateRequest[] = [
  { account_id: 'acc_7f21', kind: 'pass' },
  { account_id: 'acc_0aa9', kind: 'pass' },
];

type Call = { url: string; init: RequestInit };
type Route = { readonly body: unknown; readonly status?: number; readonly type?: string };

/**
 * A transport that answers by path and records every call.
 *
 * AN UNROUTED PATH IS A 404, which is what the API answers for one and is the
 * status this segment turns into a `null` certificate. A stub that threw instead
 * would make a wrong path look like an outage.
 */
function router(routes: Readonly<Record<string, Route>>): {
  readonly transport: Transport;
  readonly calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    transport: (url, init) => {
      calls.push({ url, init });
      const route = routes[url.slice(url.indexOf(API_BASE_PATH) + API_BASE_PATH.length)];
      const body = route === undefined ? { type: 'about:blank' } : route.body;
      return Promise.resolve(
        new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status: route === undefined ? 404 : (route.status ?? 200),
          headers: { 'content-type': route?.type ?? 'application/json' },
        }),
      );
    },
  };
}

function clientFor(routes: Readonly<Record<string, Route>>, token: string | null = null) {
  const served = router(routes);
  return {
    calls: served.calls,
    client: createApiClient({ origin: ORIGIN, sessionToken: token, transport: served.transport }),
  };
}

/** The whole purchases screen, served. */
const PURCHASES_ROUTES: Readonly<Record<string, Route>> = {
  [purchasesPagePath(PURCHASES_PAGE_LIMIT)]: { body: { data: PURCHASES, next_cursor: null } },
  [planVersionPath(PLAN, 3)]: { body: V3 },
  [planVersionPath(PLAN, 4)]: { body: V4 },
};

/** One card served, one account with no card of that kind. */
const CERTIFICATE_ROUTES: Readonly<Record<string, Route>> = {
  [accountCertificatePath(REQUESTS[0]!)]: { body: PASS_CARD },
};

// -----------------------------------------------------------------------------
// 1. The paths, asserted against the handlers that serve them
// -----------------------------------------------------------------------------

test('every path is API_CONTRACT`s and agrees with the route module that registers it', () => {
  // A SECOND COPY OF A CONSTANT ANOTHER DEPLOYABLE OWNS IS ASSERTED RATHER THAN
  // HOPED FOR, which is the treatment ADR-162 gives `API_BASE_PATH` and
  // `SESSION_COOKIE` and ../src/app/referrals/data.ts gives its own path: a copy
  // nobody checks drifts silently, and a wrong path answers 404, which
  // `toPortalErrorKind` maps to `not_found`, on a screen that would then tell a
  // trader their purchases were not found.
  const catalog = readFileSync(join(REPO, 'apps/api/src/routes/catalog.ts'), 'utf8');
  expect(catalog).toContain(`export const PURCHASES_PATH = '${PURCHASES_PATH}';`);

  const reads = readFileSync(join(REPO, 'apps/api/src/routes/account-reads.ts'), 'utf8');
  expect(reads).toContain("export const CERTIFICATE_PATH = '/accounts/:accountId/certificate';");
  expect(accountCertificatePath({ account_id: ':accountId', kind: 'pass' })).toBe(
    '/accounts/%3AaccountId/certificate?kind=pass',
  );

  const certificates = readFileSync(join(REPO, 'apps/api/src/routes/certificates.ts'), 'utf8');
  expect(certificates).toContain(`export const CERTIFICATES_PATH = '${CERTIFICATE_LIST_PATH}';`);

  // THE `.png` IS LOAD-BEARING. ADR-168 finding 5: the dispatch that reserved
  // the row dropped the extension, and "a path written without it would not be
  // the path M11 approved".
  expect(CERTIFICATE_IMAGE_PATH).toContain('.png');
  expect(certificates).toContain(
    `export const CERTIFICATE_IMAGE_PATH = '${CERTIFICATE_IMAGE_PATH}';`,
  );

  // AND NONE OF THEM CARRIES THE BASE PATH. ../src/http/client.ts appends it.
  for (const path of [
    PURCHASES_PATH,
    CERTIFICATE_LIST_PATH,
    CERTIFICATE_IMAGE_PATH,
    planVersionPath(PLAN, 3),
    accountCertificatePath(REQUESTS[0]!),
  ]) {
    expect(path.startsWith('/'), path).toBe(true);
    expect(path, path).not.toContain(API_BASE_PATH);
  }
});

test('one page is read, at the maximum the contract states, and no cursor is ever sent', () => {
  // app/calendar/load.ts took this decision for this application: one page, the
  // contract's maximum as the limit. Section 1's number is transcribed once in
  // ../src/api/types.ts, and `apps/api/src/routes/catalog.ts` declares its own
  // maximum from the same sentence; a third copy here would be the one that
  // disagrees, and a limit above the maximum is a `validation_failed`.
  expect(PURCHASES_PAGE_LIMIT).toBe(PAGE_LIMIT_MAX);
  const catalog = readFileSync(join(REPO, 'apps/api/src/routes/catalog.ts'), 'utf8');
  expect(catalog).toContain(`export const PURCHASES_MAX_LIMIT = ${String(PAGE_LIMIT_MAX)};`);

  expect(purchasesPagePath(PURCHASES_PAGE_LIMIT)).toBe('/purchases?limit=100');
  expect(purchasesPagePath(PURCHASES_PAGE_LIMIT)).not.toContain('cursor');

  // Section 1 calls the token `<opaque>`, which binds the client: nothing in
  // this application constructs one, parses one, or reads a meaning out of one.
  const source = readFileSync(join(SEGMENT, 'source.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  expect(source, 'no cursor is composed into a path').not.toMatch(/cursor=/);
});

// -----------------------------------------------------------------------------
// 2. SC-M4-06, wired end to end through the real client
// -----------------------------------------------------------------------------

test('the ready branch is reached through real requests and carries one cookie', async () => {
  const { client, calls } = clientFor(PURCHASES_ROUTES, 'tok_abc');
  const loaded = await loadPurchasesFrom({ client });

  expect(loaded.kind).toBe('ready');
  if (loaded.kind !== 'ready') return;

  // THE LIST READ IS FIRST AND THE TWO PLAN READS FOLLOW IT, because the diff's
  // path parameters live on the first response. ../src/app/(purchases)/model.ts
  // reads BOTH sides and never subtracts one from the other.
  expect(calls.map((call) => call.url)).toEqual([
    `${ORIGIN}${API_BASE_PATH}${purchasesPagePath(PURCHASES_PAGE_LIMIT)}`,
    `${ORIGIN}${API_BASE_PATH}${planVersionPath(PLAN, 3)}`,
    `${ORIGIN}${API_BASE_PATH}${planVersionPath(PLAN, 4)}`,
  ]);

  for (const call of calls) {
    expect(call.init.method).toBe('GET');
    expect((call.init.headers as Record<string, string>)['cookie']).toBe(
      `${SESSION_COOKIE}=tok_abc`,
    );

    // ADR-162 clause 4, on a screen that renders money: every read is
    // `no-store`, and the client offers no way to say otherwise.
    expect(call.init.cache).toBe('no-store');
  }

  // ORDER IS THE SERVER'S. ../src/view/purchases.ts refuses to re-sort, because
  // "re-sorting here would produce a page whose second screenful does not follow
  // its first".
  expect(loaded.history.rows.map((row) => row.purchase_id)).toEqual(['pur_3', 'pur_2']);

  // AND THE DIFF IS PAIRED OVER THE SERVER'S OWN LIST ORDER, from the two
  // versions that were actually read.
  expect(loaded.resets.length).toBe(1);
  const reset = loaded.resets[0]!;
  expect(reset.state).toBe('paired');
  if (reset.state !== 'paired') return;
  expect(reset.diff.from.version).toBe(3);
  expect(reset.diff.to.version).toBe(4);
  expect(reset.diff.changes.map((change) => change.rule_path)).toEqual(['phase_funded.buffer_bp']);
});

test('a missing cookie is still a request, because the portal authorizes nobody', async () => {
  const { client, calls } = clientFor(PURCHASES_ROUTES, null);
  await loadPurchasesFrom({ client });

  // ADR-162's client header: "A MISSING COOKIE IS NOT AN ERROR HERE ... the
  // alternative would put the portal in the business of deciding who is signed
  // in, which is INV-M4-06 in the direction nobody watches."
  expect((calls[0]?.init.headers as Record<string, string>)['cookie']).toBeUndefined();
});

test('a reset whose earlier purchase is not on the page is unpairable, not unchanged', async () => {
  // A cursor list has a second page, and ../src/app/(purchases)/model.ts renders
  // that as an unpairable panel rather than as an empty diff: "An omission that
  // reads as a positive claim is the worst failure available on this screen."
  const only = [PURCHASES[0]!];
  const { client, calls } = clientFor({
    [purchasesPagePath(PURCHASES_PAGE_LIMIT)]: { body: { data: only, next_cursor: 'opaque' } },
  });

  const loaded = await loadPurchasesFrom({ client });
  expect(loaded.kind).toBe('ready');
  if (loaded.kind !== 'ready') return;
  expect(loaded.resets[0]?.state).toBe('unpairable');

  // AND NO PLAN VERSION WAS READ, because there was nothing to compare.
  expect(calls.length).toBe(1);
});

// -----------------------------------------------------------------------------
// 3. The arm the payout centre does not have
// -----------------------------------------------------------------------------

test('a refusal on a registered endpoint is an error and not a pending read', async () => {
  for (const [status, kind] of [
    [401, 'unauthenticated'],
    [404, 'not_found'],
    [429, 'rate_limited'],
    [500, 'server_error'],
    [503, 'server_error'],
    [403, 'unexpected'],
  ] as const) {
    const { client } = clientFor({
      [purchasesPagePath(PURCHASES_PAGE_LIMIT)]: { body: { type: 'about:blank' }, status },
    });

    // THIS IS THE ARM ADR-162 SECTION 5 ITEM 1 REPORTS MISSING FROM THE PAYOUT
    // CENTRE. Without it every one of these six renders as "waiting on an
    // endpoint", which is false on all six.
    //
    // THE 503 IS IN THIS LIST ON PURPOSE. Both certificate rows in `apps/api`
    // ship an unwired backend today and answer 503, and that is a REGISTERED
    // ENDPOINT FAILING rather than a screen still being built. A client that
    // special-cased it into `unavailable` would report every real outage as a
    // pending endpoint.
    expect(await loadPurchasesFrom({ client }), String(status)).toEqual({
      kind: 'error',
      error: kind,
      status,
    });
  }
});

test('a refusal on the SECOND read is reported too, and the screen does not half render', async () => {
  const { client } = clientFor({
    [purchasesPagePath(PURCHASES_PAGE_LIMIT)]: { body: { data: PURCHASES, next_cursor: null } },
    [planVersionPath(PLAN, 3)]: { body: V3 },
    [planVersionPath(PLAN, 4)]: { body: { type: 'about:blank' }, status: 500 },
  });

  // The failure crosses ../src/app/(purchases)/model.ts, which has no error arm
  // of its own, and is caught by class on the other side. A history rendered
  // with a silently missing diff would be the omission that reads as a claim.
  expect(await loadPurchasesFrom({ client })).toEqual({
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
  expect(await loadPurchasesFrom({ client })).toEqual({
    kind: 'error',
    error: 'server_error',
    status: null,
  });
});

test('a 200 that does not satisfy a guard is a server that answered wrongly', async () => {
  for (const body of [
    PURCHASES,
    { data: PURCHASES },
    { data: PURCHASES, next_cursor: 7 },
    { data: [purchase({ amount_paid_cents: 17_900.5 })], next_cursor: null },
    { data: [{ ...purchase(), status: 'settled' }], next_cursor: null },
    'not json at all',
  ]) {
    const { client } = clientFor({
      [purchasesPagePath(PURCHASES_PAGE_LIMIT)]: { body },
    });
    const loaded = await loadPurchasesFrom({ client });

    // NOT `unavailable`. The endpoint is registered and it replied, so "waiting
    // on an endpoint" would be a false sentence about a real answer.
    //
    // THE BARE ARRAY AND THE MISSING CURSOR ARE IN THIS LIST ON PURPOSE. Section
    // 1's envelope governs every list on this surface and `undefined !== null`
    // is the only thing separating "there is no more" from "the field was not
    // sent", which is app/calendar/load.ts's reason for checking both members.
    expect(loaded.kind, JSON.stringify(body).slice(0, 50)).toBe('error');
    if (loaded.kind !== 'error') continue;
    expect(loaded.error).toBe('server_error');
    expect(loaded.status).toBe(body === 'not json at all' ? 200 : null);
  }
});

// -----------------------------------------------------------------------------
// 4. SC-M4-08, wired as far as it goes
// -----------------------------------------------------------------------------

test('one read per card, and a 404 is no certificate rather than an error', async () => {
  const { client, calls } = clientFor(CERTIFICATE_ROUTES, 'tok_abc');
  const loaded = await loadCertificatesFrom({
    client,
    requests: REQUESTS,
    disclosureText: DISCLOSURE_TEXT,
  });

  expect(calls.map((call) => call.url)).toEqual(
    REQUESTS.map((request) => `${ORIGIN}${API_BASE_PATH}${accountCertificatePath(request)}`),
  );

  // ./ports.ts: `readCertificate` "returns `null` for an account that has no
  // certificate of that kind, which is the ordinary case and not an error: a
  // trader who has not passed has no pass card." The API answers that case with
  // a 404, so the second request contributes no card and no refusal.
  expect(loaded.kind).toBe('ready');
  if (loaded.kind !== 'ready') return;
  expect(loaded.cards.length).toBe(1);
  expect(loaded.refused).toEqual([]);
  expect(loaded.cards[0]?.verify_url).toBe(PASS_CARD.verify_url);
});

test('the reads this screen CAN make are made even when ready is out of reach', async () => {
  const { client, calls } = clientFor(CERTIFICATE_ROUTES);
  const loaded = await loadCertificatesFrom({
    client,
    requests: REQUESTS,
    disclosureText: null,
  });

  // ../src/app/accounts/source.ts's argument on the identical shape:
  // short-circuiting before the requests would render the same words for less
  // work, and would cost the two things that make the difference between a
  // screen and a placeholder -- a refusal on a registered endpoint would never
  // be reported as one, and the wired path would first run in production on the
  // day the missing read lands.
  expect(calls.length).toBe(REQUESTS.length);

  // AND THE LIST IS A MEASUREMENT AND NOT A CONSTANT. The per-card read
  // succeeded on this branch and is therefore NOT named; only the disclosure is.
  expect(loaded).toEqual({ kind: 'unavailable', missing: [DISCLOSURE_READ] });
});

test('the read the portal cannot transcribe is named, and it is not named as unserved', async () => {
  const { client, calls } = clientFor(CERTIFICATE_ROUTES);
  const loaded = await loadCertificatesFrom({ client, requests: null, disclosureText: null });

  expect(loaded).toEqual({
    kind: 'unavailable',
    missing: [CERTIFICATE_LIST_READ, DISCLOSURE_READ],
  });

  // NO REQUEST WAS MADE, because there was nothing to ask for: the account ids
  // and kinds this screen reads by have no wire source inside this segment.
  expect(calls.length).toBe(0);

  // THE TWO PENDING READS ARE PENDING FOR DIFFERENT REASONS AND SAY SO.
  // `GET /certificates` is in `CompositionReport.registered` on the public
  // surface; what is missing is a transcription of `CertificateListItem` in
  // ../src/api/types.ts. The disclosure text is served by nothing at all.
  // Collapsing them would tell a later reader that an endpoint session 297
  // registered does not exist.
  expect(CERTIFICATE_LIST_READ.why).toBe('no_transcription');
  expect(DISCLOSURE_READ.why).toBe('nothing_serves_it');
  expect(CERTIFICATE_LIST_READ.read).toContain(CERTIFICATE_LIST_PATH);
});

test('a refusal outranks a pending read, on the screen that has both', async () => {
  // A 503 ON A REGISTERED ENDPOINT IS THE MORE URGENT FACT. Reporting "waiting
  // on the disclosure text" while the certificate read was failing would hide a
  // live failure behind a known gap.
  const { client } = clientFor({
    [accountCertificatePath(REQUESTS[0]!)]: { body: { type: 'about:blank' }, status: 503 },
  });

  expect(await loadCertificatesFrom({ client, requests: REQUESTS, disclosureText: null })).toEqual({
    kind: 'error',
    error: 'server_error',
    status: 503,
  });
});

test('a blank disclosure still refuses the page rather than rendering cards without it', async () => {
  // `disclosureBlock()` treats a blank document as missing and throws, and that
  // error is NOT a `PortRefusal`: it must keep propagating rather than being
  // rendered as a transport failure. "A blank where a required disclosure
  // belongs is the obligation failing silently, which is the only way it fails."
  const { client } = clientFor(CERTIFICATE_ROUTES);
  await expect(
    loadCertificatesFrom({ client, requests: REQUESTS, disclosureText: '   ' }),
  ).rejects.toThrow();
});

// -----------------------------------------------------------------------------
// 5. The `.png` row, which is registered and is not read here
// -----------------------------------------------------------------------------

test('the image endpoint is not requested by this segment, and could not be read if it were', async () => {
  // ONE. THIS SCREEN HOLDS NO `code`. The row is served off `certificates.code`
  // and `CertificateResponse` does not carry it, which
  // ../src/app/(purchases)/model.ts states in its own field comment.
  expect(Object.keys(PASS_CARD)).not.toContain('code');

  // TWO. THE CLIENT READS JSON. ADR-162 clause 3 maps a 2xx whose body is not
  // JSON to `server_error` WITH the status it did have, so a PNG through this
  // client is an error rather than an image. The repair is a second method on a
  // file ADR-162 owns, and this is the measurement rather than the claim.
  const { client } = clientFor({
    '/certificates/QK7M2P/image.png': { body: '\x89PNG\r\n\x1a\n', type: 'image/png' },
  });
  expect(await client.get('/certificates/QK7M2P/image.png')).toEqual({
    ok: false,
    error: 'server_error',
    status: 200,
  });

  // AND THE PATH IS NAMED IN CODE EXACTLY ONCE, AS A CONSTANT, AND IS HANDED TO
  // NO REQUEST. Recording a row requires naming it, so the assertion is scoped
  // to what may not exist, which is a call.
  const stripped = (file: string): string =>
    readFileSync(join(SEGMENT, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ');

  const source = stripped('source.ts');
  expect(source.split('image.png').length - 1, 'named once in code').toBe(1);
  expect(source).toContain("export const CERTIFICATE_IMAGE_PATH = '/certificates/:code/image.png'");
  expect(source, 'nothing here requests the image row').not.toMatch(/get\([^)]*image/);

  for (const file of ['purchases/page.ts', 'certificates/page.ts', 'states.ts'])
    expect(stripped(file).includes('image.png'), `${file} names it in code`).toBe(false);
});

// -----------------------------------------------------------------------------
// 6. The guards, field by field
// -----------------------------------------------------------------------------

test('the purchase guard requires every field the row view reads', () => {
  expect(isPurchaseListItem(purchase())).toBe(true);

  for (const field of Object.keys(purchase())) {
    const body: Record<string, unknown> = { ...purchase() };
    delete body[field];
    expect(isPurchaseListItem(body), `${field} is required`).toBe(false);
  }

  // Money is integer cents. ../src/format/money.ts is INV-M4-01's only permitted
  // consumer of a `_cents` field and it throws on a value that is not exact, so
  // a fractional figure would reach the screen as a `RangeError` inside a
  // component rather than as an honest error state.
  for (const field of ['size_cents', 'amount_paid_cents', 'discount_cents'])
    expect(isPurchaseListItem({ ...purchase(), [field]: 1.5 }), field).toBe(false);

  // The two closed unions, which the screen branches on.
  expect(isPurchaseListItem({ ...purchase(), kind: 'renewal' })).toBe(false);
  expect(isPurchaseListItem({ ...purchase(), status: 'settled' })).toBe(false);
  expect(isPurchaseListItem({ ...purchase(), status: 'charged_back' })).toBe(true);

  // `account_id` IS NULL UNTIL THE PURCHASE PROVISIONS AN ACCOUNT, which is a
  // real and temporary state rather than a defect.
  expect(isPurchaseListItem({ ...purchase(), account_id: null })).toBe(true);

  // The version composes a URL as well as being rendered.
  expect(
    isPurchaseListItem({ ...purchase(), plan: { plan_id: PLAN, code: 'c', version: 1.5 } }),
  ).toBe(false);

  for (const notAnObject of [null, [], 'purchase', 7, undefined])
    expect(isPurchaseListItem(notAnObject), String(notAnObject)).toBe(false);
});

test('the plan version guard checks the whole response, because toRuleDiff takes the whole type', () => {
  expect(isPlanVersionResponse(V4)).toBe(true);

  // ADR-162 foreclosure 5 with the sign flipped: a predicate returning `value is
  // PlanVersionResponse` after checking three fields would CLAIM five nobody
  // checked, and the next reader of that type is entitled to `sizes`.
  for (const field of Object.keys(V4)) {
    const body: Record<string, unknown> = { ...V4 };
    delete body[field];
    expect(isPlanVersionResponse(body), `${field} is required`).toBe(false);
  }

  expect(isPlanVersionResponse({ ...V4, status: 'draft' })).toBe(false);
  expect(isPlanVersionResponse({ ...V4, retired_at: '2026-06-01T00:00:00Z' })).toBe(true);
  expect(isPlanVersionResponse({ ...V4, copy_blocks: { 'phase.x': 7 } })).toBe(false);

  // `rules` IS CHECKED AS A JSON TREE AND NOT AS A RULE SCHEMA.
  // ../src/api/types.ts declares it opaque and says why: "the day a rule gains a
  // key, the diff renders 'nothing changed' about a contract that changed". A
  // guard that enumerated keys would reintroduce exactly that one layer lower.
  expect(isPlanVersionResponse({ ...V4, rules: { anything_at_all: [1, { deep: null }] } })).toBe(
    true,
  );
  expect(isPlanVersionResponse({ ...V4, rules: [] })).toBe(false);
  expect(isPlanVersionResponse({ ...V4, rules: { bad: () => 1 } })).toBe(false);

  // One `sizes` row, and `profit_target_cents` is the nullable one.
  const size = {
    size_cents: 5_000_000,
    price_cents: 17_900,
    reset_price_cents: 14_900,
    drawdown_cents: 250_000,
    profit_target_cents: null,
    buffer_cents: 100_000,
    win_day_floor_cents: 15_000,
    payout_cap_cents: 150_000,
    min_payout_cents: 10_000,
  };
  expect(isPlanVersionResponse({ ...V4, sizes: [size] })).toBe(true);
  expect(isPlanVersionResponse({ ...V4, sizes: [{ ...size, buffer_cents: null }] })).toBe(false);
  expect(isPlanVersionResponse({ ...V4, sizes: [{ ...size, price_cents: 179.5 }] })).toBe(false);
});

test('the certificate guard admits an absent amount and refuses a null one', () => {
  expect(isCertificateResponse(PASS_CARD)).toBe(true);

  for (const field of Object.keys(PASS_CARD)) {
    const body: Record<string, unknown> = { ...PASS_CARD };
    delete body[field];
    expect(isCertificateResponse(body), `${field} is required`).toBe(false);
  }

  // A PASS CARD CLAIMS NO MONEY AND A PAYOUT CARD CLAIMS AN AMOUNT.
  // ../src/view/certificates.ts: rendering an absent amount as `0.00` "would
  // turn the first into a false claim about the second". So absent is admitted,
  // and a `null` is not: the contract declares `number | undefined` and a server
  // sending `null` has answered a shape nobody agreed.
  const claims = PASS_CARD.claims;
  expect(
    isCertificateResponse({ ...PASS_CARD, claims: { ...claims, amount_cents: 150_000 } }),
  ).toBe(true);
  expect(isCertificateResponse({ ...PASS_CARD, claims: { ...claims, amount_cents: null } })).toBe(
    false,
  );
  expect(isCertificateResponse({ ...PASS_CARD, claims: { ...claims, amount_cents: 1.5 } })).toBe(
    false,
  );

  // A BLANK `verify_url` IS ADMITTED HERE AND REFUSED ONE LAYER UP, on purpose.
  // ../src/view/certificates.ts throws `UnverifiableCertificateError` and
  // ../src/app/(purchases)/model.ts turns that into a card-level refusal with a
  // reason; refusing it in the guard would turn one bad card into a whole-page
  // `server_error`, which is an outage on the surface a trader reaches for when
  // they want to prove something.
  expect(isCertificateResponse({ ...PASS_CARD, verify_url: '' })).toBe(true);
});

test('a card that cannot be verified is refused with its claims taken off the page', async () => {
  const blank = { ...PASS_CARD, verify_url: '   ' };
  const { client } = clientFor({ [accountCertificatePath(REQUESTS[0]!)]: { body: blank } });
  const loaded = await loadCertificatesFrom({
    client,
    requests: [REQUESTS[0]!],
    disclosureText: DISCLOSURE_TEXT,
  });

  expect(loaded.kind).toBe('ready');
  if (loaded.kind !== 'ready') return;
  expect(loaded.cards).toEqual([]);
  expect(loaded.refused.map((refusal) => refusal.kind)).toEqual(['pass']);

  // AND THE REASON CARRIES NO `certificate_id`. That is the key SD-M11-01
  // separated from the public `code`, and an error string is the route nobody
  // watches.
  expect(loaded.refused[0]?.reason).not.toContain(PASS_CARD.certificate_id);
});

// -----------------------------------------------------------------------------
// 7. The loads, and the one error they convert
// -----------------------------------------------------------------------------

test('an unconfigured deployment reaches nothing and each screen says which reads', async () => {
  const saved = process.env[API_ORIGIN_VAR];
  delete process.env[API_ORIGIN_VAR];
  try {
    expect(await loadPurchases()).toEqual({
      kind: 'unavailable',
      missing: PURCHASES_UNREACHABLE,
    });
    expect(await loadCertificates()).toEqual({
      kind: 'unavailable',
      missing: [...CERTIFICATE_READS_UNREACHABLE, CERTIFICATE_LIST_READ, DISCLOSURE_READ],
    });

    // THE REASONS DIFFER ON ONE SCREEN AND THAT IS THE POINT OF THE FIELD. Two
    // of the certificates screen's three reads are registered endpoints that are
    // merely unreachable; the other two are not reachable at any origin.
    expect(PURCHASES_UNREACHABLE.every((read) => read.why === 'no_api_origin')).toBe(true);
    expect(CERTIFICATE_READS_UNREACHABLE.every((read) => read.why === 'no_api_origin')).toBe(true);
  } finally {
    if (saved !== undefined) process.env[API_ORIGIN_VAR] = saved;
  }
});

test('the conversion is narrow: anything that is not a configuration error propagates', async () => {
  // WITH AN ORIGIN SET, A LOAD GETS PAST `resolveApiOrigin` AND REACHES
  // `cookies()`, WHICH HAS NO REQUEST SCOPE HERE. That failure is NOT an
  // `ApiConfigError` and must not be rendered as a pending read: a screen that
  // reported every fault in this application as "waiting on GET /purchases"
  // would be the quiet failure ADR-162 foreclosure 6 refuses.
  const saved = process.env[API_ORIGIN_VAR];
  process.env[API_ORIGIN_VAR] = ORIGIN;
  try {
    await expect(loadPurchases()).rejects.toBeDefined();
    await expect(loadCertificates()).rejects.toBeDefined();
  } finally {
    if (saved === undefined) delete process.env[API_ORIGIN_VAR];
    else process.env[API_ORIGIN_VAR] = saved;
  }
});

// -----------------------------------------------------------------------------
// 8. The three arms as screens, and the boundary asserted over the bytes
// -----------------------------------------------------------------------------

test('both pages render the unavailable arm, name their reads, and do not throw', async () => {
  const saved = process.env[API_ORIGIN_VAR];
  delete process.env[API_ORIGIN_VAR];
  try {
    const purchases = renderToStaticMarkup(await PurchasesPage());
    expect(purchases).toContain('Nothing has failed');
    expect(purchases).toContain('Waiting on');
    expect(purchases).toContain('GET /purchases');
    expect(purchases).toContain(PENDING_READ_COPY.no_api_origin);

    const certificates = renderToStaticMarkup(await CertificatesPage());
    expect(certificates).toContain('GET /accounts/:accountId/certificate');
    expect(certificates).toContain(CERTIFICATE_LIST_PATH);
    expect(certificates).toContain('content_documents');
    expect(certificates).toContain(PENDING_READ_COPY.no_transcription);

    // AND THE EMPTY STATE IS NOT WHAT A TRADER SEES. ../src/app/(purchases)/
    // certificates-screen.ts's empty sentence is a POSITIVE CLAIM about their
    // record, and a screen that rendered it because a read had no source would
    // be making that claim on no evidence.
    expect(certificates).not.toContain('No certificates yet');
  } finally {
    if (saved !== undefined) process.env[API_ORIGIN_VAR] = saved;
  }
});

test('NOTHING THE CORPUS EXCLUDES REACHES SC-M4-08 ON ANY OF ITS THREE ARMS', async () => {
  // Session 261's lesson and ./page-certificates.test.ts's shape, extended to
  // the two arms a fixture cannot reach. INV-M11-01 and AS-M4-03 rule 3 are
  // written as absences -- "no identity, no email, no display name, no
  // cumulative total, no lifetime figure" -- so the check is written as one, and
  // it reads the OUTPUT rather than the model: a value can reach a page through
  // an `alt`, a `title`, an error string or a `data-` prop without ever
  // appearing in a visible field.
  const { client } = clientFor(CERTIFICATE_ROUTES);
  const ready = await loadCertificatesFrom({
    client,
    requests: REQUESTS,
    disclosureText: DISCLOSURE_TEXT,
  });
  expect(ready.kind).toBe('ready');
  if (ready.kind !== 'ready') return;

  const saved = process.env[API_ORIGIN_VAR];
  delete process.env[API_ORIGIN_VAR];
  let unavailable: string;
  try {
    unavailable = renderToStaticMarkup(await CertificatesPage());
  } finally {
    if (saved !== undefined) process.env[API_ORIGIN_VAR] = saved;
  }

  const arms: readonly [string, string][] = [
    ['ready', renderToStaticMarkup(CertificatesScreen({ model: ready }))],
    ['unavailable', unavailable],
    [
      'error',
      renderToStaticMarkup(
        PurchasesError({
          heading: 'Certificates',
          screen: 'merit-screen-certificates',
          error: 'not_found',
        }),
      ),
    ],
  ];

  for (const [arm, html] of arms) {
    // The primary key SD-M11-01 separated from the public `code` so the token
    // could be rotated after an incident. It never enters the render tree.
    expect(html, `${arm} renders no certificate_id`).not.toContain(PASS_CARD.certificate_id);

    // `certificates.account_id` and `identity_id` are columns on the row and on
    // no response and no screen. The screen is not grouped by account for this
    // reason.
    for (const request of REQUESTS)
      expect(html, `${arm} renders no account identifier`).not.toContain(request.account_id);

    // INV-M11-01's own list, read as a denylist over the output. It is the
    // WEAKER half (a denylist is wrong about every field invented after it is
    // written, which is why ../src/app/(purchases)/model.ts's allowlist is the
    // real control) and it is here because it is the half that catches a value
    // arriving through an attribute.
    for (const forbidden of ['@', 'identity', 'lifetime', 'cumulative', 'balance', 'total'])
      expect(html.toLowerCase(), `${arm} contains "${forbidden}"`).not.toContain(forbidden);
  }

  // AND THE READY ARM IS A REAL RENDER RATHER THAN AN EMPTY ONE, so the
  // absences above are absences from a page that had something to leak.
  expect(arms[0]![1]).toContain('Evaluation pass certificate');
  expect(arms[0]![1]).toContain(PASS_CARD.claims.trading_day);
});

test('no sentence this segment shows a trader words a refusal as one of permission', () => {
  // INV-M4-07: "existence is not confirmed to a stranger, AND THE UI MUST NOT
  // UNDO THAT BY WORDING." `PortalErrorKind` has no `forbidden` member, and a
  // copy catalogue is where that refusal gets reinstated by a sentence.
  for (const [kind, sentence] of Object.entries(PURCHASES_ERROR_COPY))
    for (const word of ['forbidden', 'not allowed', 'permission', 'denied', 'unauthorized'])
      expect(sentence.toLowerCase(), `${kind} says ${word}`).not.toContain(word);

  // AND THE STATUS IS NOT ON THE SCREEN. The load carries it so a later
  // observability slice can report it; the markup does not, because a `404`
  // beside "we could not find that" is the number a stranger would use to tell
  // "no such thing" from "not yours".
  const text = renderToStaticMarkup(
    PurchasesError({ heading: 'Purchases', screen: 'merit-screen-purchases', error: 'not_found' }),
  ).replace(/<[^>]*>/g, ' ');
  expect(text).toContain(PURCHASES_ERROR_COPY.not_found);
  expect(text, 'no status number reaches the trader').not.toMatch(/\d/);
});

test('the ready arm renders the screen the fixtures render, from the wire', async () => {
  const { client } = clientFor(PURCHASES_ROUTES);
  const loaded = await loadPurchasesFrom({ client });
  expect(loaded.kind).toBe('ready');
  if (loaded.kind !== 'ready') return;

  const html = renderToStaticMarkup(
    PurchasesScreen({ model: { history: loaded.history, resets: loaded.resets } }),
  );
  expect(html).toContain('What changed when you reset');
  expect(html).toContain('phase_funded.buffer_bp');

  // INV-M4-01 over the wired path as well as the fixture path: no total is
  // computed anywhere and there is nowhere to put one.
  const visible = html.replace(/<[^>]*>/g, ' ').toLowerCase();
  for (const word of ['total', 'lifetime', 'sum', 'spent', 'altogether'])
    expect(visible, `no "${word}" appears on the purchases page`).not.toMatch(
      new RegExp(`\\b${word}`, 'u'),
    );
});
