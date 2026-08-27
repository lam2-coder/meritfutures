import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';

import KycStatusPage from '../src/app/kyc/page.ts';
import { KYC_CONTENT_COPY, KYC_STATE_COPY } from '../src/app/kyc/copy.ts';
import {
  KYC_STATUS_PATH,
  KycStatusShapeError,
  KycStatusUnavailable,
  SERVER_KYC_SCREEN_SOURCE,
  ScreenedFieldError,
  resetKycScreenSource,
  statusFrom,
  useKycScreenSource,
} from '../src/app/kyc/source.ts';
import {
  API_BASE_PATH,
  API_ORIGIN_VAR,
  SESSION_COOKIE,
  createApiClient,
} from '../src/http/client.ts';
import type { ApiClient, Transport } from '../src/http/client.ts';

// =============================================================================
// THE SEAM, FOR THE `kyc` SEGMENT. ADR-162, executed rather than re-ruled.
// =============================================================================
// EVERY ASSERTION BELOW GOES THROUGH THE REAL `createApiClient` OVER A STUB
// TRANSPORT, never through a mock of the client. What is being proven is the
// whole path -- URL composition, the forwarded cookie, `no-store`, the status
// mapping, the JSON read, this segment's screen and ./page.ts's render --
// because a mock of `ApiClient` would prove only that `statusFrom` calls a
// function.
//
// AND THE FAILURE DIRECTION IS THE ONE THAT MATTERS HERE. A KYC status is not
// an ordinary read: a screen that says "verified" for a trader who is not is a
// statement Merit makes about an identity check. `apps/api/src/routes/
// accounts.ts:824` states the posture on the same question one deployable over
// -- it "fails closed, because the alternative is reporting somebody verified
// on the strength of an ordering this table does not declare" -- and the
// fail-closed block below is that sentence asserted over every way this read
// can go wrong, on the RENDERED BYTES rather than on a return value.
// =============================================================================

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const SEGMENT = join(HERE, '..', 'src', 'app', 'kyc');

const ORIGIN = 'https://api.example.com';

/** A well-formed `GET /kyc/status` body, as API_CONTRACT section 7 declares it. */
function statusBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    state: 'verified',
    placement: 'pre_funded',
    verified_at: '2026-08-20T14:02:11Z',
    expires_at: '2028-08-20T14:02:11Z',
    action_required: null,
    ...over,
  };
}

function serving(
  body: unknown,
  status = 200,
): {
  readonly transport: Transport;
  readonly calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  return {
    calls,
    transport: (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
  };
}

/** A transport that never reaches a status line. DNS, refused, TLS, aborted. */
const DEAD: Transport = () => Promise.reject(new TypeError('fetch failed'));

function clientServing(body: unknown, status = 200, token: string | null = null): ApiClient {
  return createApiClient({
    origin: ORIGIN,
    sessionToken: token,
    transport: serving(body, status).transport,
  });
}

/** ./page.ts's own render, reached through the real client. */
async function renderThrough(client: ApiClient): Promise<string> {
  useKycScreenSource({ status: () => statusFrom(client) });
  try {
    return renderToStaticMarkup(await KycStatusPage());
  } finally {
    resetKycScreenSource();
  }
}

// -----------------------------------------------------------------------------
// 1. The path, re-derived from the handler that serves it
// -----------------------------------------------------------------------------

test('the path this segment reads is the one apps/api registers, character for character', () => {
  // A SECOND COPY OF A CONSTANT ANOTHER DEPLOYABLE OWNS IS ASSERTED RATHER THAN
  // HOPED FOR, which is the treatment ADR-162 gives `API_BASE_PATH` and
  // `SESSION_COOKIE` in `http-client.test.ts` and for the same stated reason: a
  // copy nobody checks drifts silently, and a wrong path here answers 404,
  // which `toPortalErrorKind` maps to `not_found`, on a screen that would then
  // tell a trader their verification was not found.
  const route = readFileSync(join(REPO, 'apps/api/src/routes/kyc.ts'), 'utf8');
  expect(route).toContain(`export const KYC_STATUS_PATH = '${KYC_STATUS_PATH}';`);

  // AND IT CARRIES NO BASE PATH. `../src/http/client.ts` appends `/api/v1`.
  expect(KYC_STATUS_PATH.startsWith('/')).toBe(true);
  expect(KYC_STATUS_PATH).not.toContain(API_BASE_PATH);
});

// -----------------------------------------------------------------------------
// 2. The read, through the real client
// -----------------------------------------------------------------------------

test('the ready branch is reached through a real request and is the same screen', async () => {
  const { transport, calls } = serving(statusBody());
  const client = createApiClient({ origin: ORIGIN, sessionToken: 'tok_abc', transport });

  const status = await statusFrom(client);

  // THE REQUEST. Base path appended by the client and not by this segment, the
  // trader's one cookie forwarded, and `no-store` on an identity-scoped read.
  expect(calls.length).toBe(1);
  expect(calls[0]?.url).toBe(`${ORIGIN}${API_BASE_PATH}${KYC_STATUS_PATH}`);
  expect((calls[0]?.init.headers as Record<string, string>)['cookie']).toBe(
    `${SESSION_COOKIE}=tok_abc`,
  );
  expect(calls[0]?.init.cache).toBe('no-store');
  expect(calls[0]?.init.method).toBe('GET');

  // THE FIVE FIELDS AND NOTHING ELSE.
  expect(status).toEqual({
    state: 'verified',
    placement: 'pre_funded',
    verified_at: '2026-08-20T14:02:11Z',
    expires_at: '2028-08-20T14:02:11Z',
    action_required: null,
  });
});

test('the page renders the trader status the API actually returned', async () => {
  // THE POSITIVE CONTROL FOR EVERYTHING BELOW. Without it, "no failure renders
  // verified" is satisfied by a page that can never render verified at all.
  const html = await renderThrough(clientServing(statusBody()));
  expect(html).toContain('data-state="verified"');
  expect(html).toContain('data-badge="verified"');
  expect(html).toContain(`>${KYC_STATE_COPY.verified}<`);
  expect(html).not.toContain('data-content=');

  const pending = await renderThrough(clientServing(statusBody({ state: 'pending' })));
  expect(pending).toContain('data-state="pending"');
  expect(pending).not.toContain('data-badge="verified"');
});

// -----------------------------------------------------------------------------
// 3. The guard, which is this segment's because the client returns `unknown`
// -----------------------------------------------------------------------------

test('a 200 that does not satisfy the guard is refused rather than rendered', async () => {
  // ADR-162 clause 5: the transport returns `unknown` and "narrowing is the
  // segment's and is forced". `screenKycStatus` is that narrowing and it was
  // already here; this asserts it is what the wire now goes through.
  for (const body of [
    null,
    'verified',
    [statusBody()],
    statusBody({ state: 4 }),
    statusBody({ placement: null }),
    statusBody({ verified_at: 17 }),
    statusBody({ expires_at: { at: 'soon' } }),
    statusBody({ action_required: 12 }),
  ]) {
    await expect(
      statusFrom(clientServing(body)),
      JSON.stringify(body).slice(0, 50),
    ).rejects.toBeInstanceOf(KycStatusShapeError);
  }
});

test('a document-shaped key on the wire refuses the read before a field is touched', async () => {
  // ADR-114 clause 6 reaching the transport. The screen runs over the WHOLE
  // payload first, so a passport refuses the render rather than riding along
  // beside five fields that projected cleanly.
  await expect(
    statusFrom(clientServing(statusBody({ document_image: 'data:image/jpeg;base64,QUJD' }))),
  ).rejects.toBeInstanceOf(ScreenedFieldError);

  await expect(
    statusFrom(clientServing(statusBody({ provider: { raw_result: { selfie_url: 'x' } } }))),
  ).rejects.toBeInstanceOf(ScreenedFieldError);
});

// -----------------------------------------------------------------------------
// 4. THE ERROR KIND IS A MEASUREMENT AND WAS A CONSTANT
// -----------------------------------------------------------------------------

test('a refused read carries the kind the API actually returned, not a constant', async () => {
  // ./page.ts rendered `toPortalErrorKind(503)` for every failure, because with
  // no transport every refusal was the same refusal. The status the API
  // returned is now carried the last two files, and the copy a trader reads
  // changes with it.
  const cases = [
    { status: 401, kind: 'unauthenticated' as const },
    { status: 404, kind: 'not_found' as const },
    { status: 429, kind: 'rate_limited' as const },
    { status: 500, kind: 'server_error' as const },
    { status: 503, kind: 'server_error' as const },
    // 403 IS DELIBERATELY UNMAPPED. `shell/app-shell.ts` spends a paragraph on
    // why: on a read surface it is FM-M4-10 firing and is "a rendering bug
    // until proven otherwise". This segment adds no member to that union.
    { status: 403, kind: 'unexpected' as const },
  ];

  for (const { status, kind } of cases) {
    let caught: unknown;
    try {
      await statusFrom(clientServing({ type: 'about:blank' }, status));
    } catch (error) {
      caught = error;
    }
    expect(caught, String(status)).toBeInstanceOf(KycStatusUnavailable);
    expect((caught as KycStatusUnavailable).error, String(status)).toBe(kind);
    expect((caught as KycStatusUnavailable).status, String(status)).toBe(status);

    const html = await renderThrough(clientServing({ type: 'about:blank' }, status));
    expect(html, String(status)).toContain(`data-content="${kind}"`);
    expect(html, String(status)).toContain(KYC_CONTENT_COPY[kind]);
  }
});

test('a request that never reached a status line has no status and is not given one', async () => {
  // ADR-162 clause 3. Inventing a number -- 503 is the tempting one -- would
  // put a sentence in the server's mouth that no server said.
  const client = createApiClient({ origin: ORIGIN, sessionToken: null, transport: DEAD });

  let caught: unknown;
  try {
    await statusFrom(client);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(KycStatusUnavailable);
  expect((caught as KycStatusUnavailable).error).toBe('server_error');
  expect((caught as KycStatusUnavailable).status).toBeNull();
});

test('a 2xx whose body is not JSON is the same answer with the status it did have', async () => {
  const transport: Transport = () =>
    Promise.resolve(new Response('<html>a load balancer</html>', { status: 200 }));
  const client = createApiClient({ origin: ORIGIN, sessionToken: null, transport });

  let caught: unknown;
  try {
    await statusFrom(client);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(KycStatusUnavailable);
  expect((caught as KycStatusUnavailable).error).toBe('server_error');
  expect((caught as KycStatusUnavailable).status).toBe(200);
});

// -----------------------------------------------------------------------------
// 5. FAIL CLOSED. Never verified, and never a blank that reads like neither
// -----------------------------------------------------------------------------

test('NO failure of this read renders verified, and none of them renders nothing', async () => {
  // `apps/api/src/routes/accounts.ts:824`: it "fails closed, because the
  // alternative is reporting somebody verified on the strength of an ordering
  // this table does not declare." This is the screen half of that sentence,
  // asserted on the bytes the page emitted rather than on a return value.
  //
  // THE PAYLOADS BELOW ALL CLAIM `verified`. That is the point: every one of
  // them would render a verification badge if the failure it carries were
  // swallowed anywhere on the path.
  const failures: { readonly label: string; readonly client: ApiClient }[] = [
    { label: '401', client: clientServing(statusBody(), 401) },
    { label: '403', client: clientServing(statusBody(), 403) },
    { label: '404', client: clientServing(statusBody(), 404) },
    { label: '429', client: clientServing(statusBody(), 429) },
    { label: '500', client: clientServing(statusBody(), 500) },
    { label: '503', client: clientServing(statusBody(), 503) },
    {
      label: 'no response at all',
      client: createApiClient({ origin: ORIGIN, sessionToken: null, transport: DEAD }),
    },
    { label: 'not an object', client: clientServing('verified') },
    { label: 'an array of one', client: clientServing([statusBody()]) },
    { label: 'a missing field', client: clientServing({ state: 'verified' }) },
    { label: 'a non-string state', client: clientServing(statusBody({ state: 4 })) },
    {
      label: 'a state the enum cannot produce',
      client: clientServing(statusBody({ state: 'probably_verified' })),
    },
    {
      label: 'a placement the CHECK cannot produce',
      client: clientServing(statusBody({ placement: 'pre_eval' })),
    },
    {
      label: 'a document on the wire',
      client: clientServing(statusBody({ passport_image: 'data:image/jpeg;base64,QUJD' })),
    },
    {
      label: 'an internal-tier sentence',
      client: clientServing(
        statusBody({ state: 'pending', action_required: 'Your account is under review.' }),
      ),
    },
  ];

  for (const { label, client } of failures) {
    const html = await renderThrough(client);

    // NEVER VERIFIED. Neither the badge, nor the state attribute, nor the word.
    expect(html, `${label} renders no verified badge`).not.toContain('data-badge="verified"');
    expect(html, `${label} renders no status at all`).not.toContain('data-state=');
    expect(html, `${label} does not say verified`).not.toContain(KYC_STATE_COPY.verified);

    // AND NEVER A BLANK. The heading is there, a content state is named, and it
    // carries a sentence a trader can read.
    expect(html, `${label} still renders the screen`).toContain('data-screen="SC-M4-07"');
    expect(html, `${label} names a content state`).toMatch(/data-content="[a-z_]+"/);

    const kind = /data-content="([a-z_]+)"/.exec(html)?.[1] as keyof typeof KYC_CONTENT_COPY;
    expect(KYC_CONTENT_COPY[kind], `${label} has copy`).toBeDefined();
    expect(html, `${label} renders that copy`).toContain(KYC_CONTENT_COPY[kind]);
  }
});

// -----------------------------------------------------------------------------
// 6. `ApiConfigError` AND NOTHING ELSE, asserted in both directions
// -----------------------------------------------------------------------------

test('an unconfigured deployment has no API to read and the screen says so', async () => {
  const saved = process.env[API_ORIGIN_VAR];
  delete process.env[API_ORIGIN_VAR];
  try {
    let caught: unknown;
    try {
      await SERVER_KYC_SCREEN_SOURCE.status();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(KycStatusUnavailable);
    expect((caught as KycStatusUnavailable).error).toBe('server_error');
    expect((caught as KycStatusUnavailable).status).toBeNull();
  } finally {
    if (saved !== undefined) process.env[API_ORIGIN_VAR] = saved;
  }
});

test('the conversion is narrow: anything that is not a configuration error propagates', async () => {
  // WITH AN ORIGIN SET, `status()` GETS PAST `resolveApiOrigin` AND REACHES
  // `cookies()`, WHICH HAS NO REQUEST SCOPE HERE. That failure is NOT an
  // `ApiConfigError` and must not be dressed up as one: a screen that reported
  // every fault in this application as "this deployment has no API" would be
  // the quiet failure ADR-162's foreclosure 6 refuses.
  const saved = process.env[API_ORIGIN_VAR];
  process.env[API_ORIGIN_VAR] = ORIGIN;
  try {
    let caught: unknown;
    try {
      await SERVER_KYC_SCREEN_SOURCE.status();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(caught).not.toBeInstanceOf(KycStatusUnavailable);
  } finally {
    if (saved === undefined) delete process.env[API_ORIGIN_VAR];
    else process.env[API_ORIGIN_VAR] = saved;
  }
});

// -----------------------------------------------------------------------------
// 7. THE WRITE IS NOT WIRED, AND THE REASON IS THE FENCE RATHER THAN AN ABSENCE
// -----------------------------------------------------------------------------

test('POST /kyc/session is registered by apps/api and is still not called from here', () => {
  // THE ENDPOINT EXISTS. Measured on this tree through the application
  // (`discoverRouteModules()` then `buildServer({ surface: 'public', modules })`,
  // reading `CompositionReport.registered`) and re-derived here from the module
  // that declares it, so this assertion fails if the route ever moves.
  const route = readFileSync(join(REPO, 'apps/api/src/routes/kyc.ts'), 'utf8');
  expect(route).toContain(`export const KYC_SESSION_PATH = '/kyc/session';`);
  expect(route).toMatch(/method: 'POST',\s*\n\s*path: KYC_SESSION_PATH,/);

  // AND IT IS A WRITE. `openVerification` is the port it goes through and the
  // module says what it does: two rows in one transaction, a new row every
  // time, no update. `apps/portal/test/surface.test.ts` asserts "nothing that
  // changes a trader account exists in this app", and session 158's rule in
  // that file is that a needle is narrowed and never deleted. Nothing in this
  // session needed it narrowed, so nothing was.
  expect(route).toContain('WRITES TWO ROWS IN ONE TRANSACTION');

  // THE TRANSPORT CANNOT DO IT EITHER, which is the second, independent fence.
  // `ApiClient` is `get` and no second method, and `src/http/client.ts` is
  // ADR-162's file rather than this segment's to extend.
  const client = createApiClient({ origin: ORIGIN, sessionToken: null, transport: DEAD });
  expect(Object.keys(client)).toEqual(['get']);

  // SO NO FILE IN THIS SEGMENT SPELLS THE PATH, in code. A constant declared
  // here for an endpoint nothing calls is an invitation to the next session.
  for (const entry of readdirSync(SEGMENT, { withFileTypes: true })) {
    const body = readFileSync(join(SEGMENT, entry.name), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ');
    expect(body, `${entry.name} does not name the session endpoint`).not.toContain('/kyc/session');
  }
});
