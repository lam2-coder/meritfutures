import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import {
  API_BASE_PATH,
  API_ORIGIN_VAR,
  ApiConfigError,
  SESSION_COOKIE,
  createApiClient,
  resolveApiOrigin,
} from '../src/http/client.ts';
import type { ApiResult, Transport } from '../src/http/client.ts';

// =============================================================================
// ADR-162. The one file in this application that performs a network call.
// =============================================================================
// Each of the five decisions `src/app/payouts/source.ts` named is asserted here
// rather than only argued in a header, and the two that are second copies of a
// constant `apps/api` owns are asserted AGAINST THAT FILE'S SOURCE.

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');

/** A transport that records what it was asked for and answers with `response`. */
function recording(response: Response | (() => never)): {
  readonly transport: Transport;
  readonly calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const transport: Transport = (url, init) => {
    calls.push({ url, init });
    if (typeof response !== 'function') return Promise.resolve(response.clone());
    return response();
  };
  return { transport, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// -----------------------------------------------------------------------------
// 1. The base URL
// -----------------------------------------------------------------------------

test('the API origin has no default and every refusal names the variable', () => {
  const refused: Record<string, string | undefined>[] = [
    {},
    { [API_ORIGIN_VAR]: '' },
    { [API_ORIGIN_VAR]: '   ' },
    { [API_ORIGIN_VAR]: 'api.example.com' },
    { [API_ORIGIN_VAR]: '/api/v1' },
    { [API_ORIGIN_VAR]: 'https://api.example.com/api/v1' },
    { [API_ORIGIN_VAR]: 'https://api.example.com/?x=1' },
    { [API_ORIGIN_VAR]: 'https://api.example.com/#frag' },
    { [API_ORIGIN_VAR]: 'http://api.example.com' },
  ];

  for (const env of refused) {
    expect(() => resolveApiOrigin(env), JSON.stringify(env)).toThrow(ApiConfigError);
    try {
      resolveApiOrigin(env);
    } catch (error) {
      expect((error as Error).message, JSON.stringify(env)).toContain(API_ORIGIN_VAR);
    }
  }
});

test('the API origin is accepted as an origin, and localhost is the one http exception', () => {
  expect(resolveApiOrigin({ [API_ORIGIN_VAR]: 'https://api.example.com' })).toBe(
    'https://api.example.com',
  );
  expect(resolveApiOrigin({ [API_ORIGIN_VAR]: 'https://api.example.com/' })).toBe(
    'https://api.example.com',
  );
  expect(resolveApiOrigin({ [API_ORIGIN_VAR]: ' https://api.example.com:8443 ' })).toBe(
    'https://api.example.com:8443',
  );

  // API_CONTRACT section 1 marks the cookie `Secure`, so http is refused
  // everywhere the browser would withhold it and permitted where it would not.
  expect(resolveApiOrigin({ [API_ORIGIN_VAR]: 'http://localhost:3000' })).toBe(
    'http://localhost:3000',
  );
  expect(resolveApiOrigin({ [API_ORIGIN_VAR]: 'http://127.0.0.1:3000' })).toBe(
    'http://127.0.0.1:3000',
  );
});

test('the base path is the one `apps/api/src/surface.ts` declares', () => {
  // A SECOND COPY OF A CONSTANT, ASSERTED AGAINST ITS SOURCE RATHER THAN
  // IMPORTED. `apps/portal` does not declare `@merit/api` and must not: that
  // package's closure is Fastify, `@merit/db`, `@merit/ledger` and five more.
  // This is `apiSurfaceVocabulary`'s treatment of the same constant in
  // `packages/tooling/checks/repo-invariants.mjs`, which parses it out of the
  // same file for the same reason.
  const source = readFileSync(join(REPO, 'apps', 'api', 'src', 'surface.ts'), 'utf8');
  const match = /export const BASE_PATH = '([^']+)'/.exec(source);
  expect(match, 'BASE_PATH is declared in apps/api/src/surface.ts').not.toBeNull();
  expect(match?.[1]).toBe(API_BASE_PATH);
});

test('the session cookie is the one `apps/api/src/routes/auth.ts` sets', () => {
  const source = readFileSync(join(REPO, 'apps', 'api', 'src', 'routes', 'auth.ts'), 'utf8');
  const match = /export const SESSION_COOKIE = '([^']+)'/.exec(source);
  expect(match, 'SESSION_COOKIE is declared in apps/api/src/routes/auth.ts').not.toBeNull();
  expect(match?.[1]).toBe(SESSION_COOKIE);
});

// -----------------------------------------------------------------------------
// 2. The session cookie, and what is NOT sent
// -----------------------------------------------------------------------------

test('the request carries exactly one cookie and nothing else identifies the caller', async () => {
  const { transport, calls } = recording(json([]));
  const client = createApiClient({
    origin: 'https://api.example.com',
    sessionToken: 'tok_abc',
    transport,
  });

  await client.get('/payouts');

  expect(calls.length).toBe(1);
  const init = calls[0]?.init;
  const headers = init?.headers as Record<string, string>;

  expect(calls[0]?.url).toBe(`https://api.example.com${API_BASE_PATH}/payouts`);
  expect(headers['cookie']).toBe(`${SESSION_COOKIE}=tok_abc`);
  expect(Object.keys(headers).sort()).toEqual(['accept', 'cookie']);

  // THE BROWSER IS NEVER THE CALLER, so `credentials` is absent rather than
  // set to anything: `apps/api` sends no `Access-Control-Allow-Origin` and a
  // client that asked for credentialed CORS would be asking for something the
  // server has not agreed to send.
  expect(init).not.toHaveProperty('credentials');
  expect(init?.method).toBe('GET');
});

test('no session token sends no cookie header, and the API decides rather than the portal', async () => {
  const { transport, calls } = recording(json([]));
  const client = createApiClient({
    origin: 'https://api.example.com',
    sessionToken: null,
    transport,
  });

  const result = await client.get('/payouts');

  // The call IS made. Refusing to make it would put the portal in the business
  // of deciding who is signed in, which INV-M4-06 gives to the server.
  expect(calls.length).toBe(1);
  expect(Object.keys(calls[0]?.init.headers as Record<string, string>)).toEqual(['accept']);
  expect(result.ok).toBe(true);
});

// -----------------------------------------------------------------------------
// 3. The error mapping
// -----------------------------------------------------------------------------

test('every status maps through the shell vocabulary and no member is added', async () => {
  const expected: readonly (readonly [number, string])[] = [
    [404, 'not_found'],
    [401, 'unauthenticated'],
    [429, 'rate_limited'],
    [500, 'server_error'],
    [503, 'server_error'],

    // 403 is deliberately unmapped in `shell/app-shell.ts` and falls to
    // `unexpected`. This file does not second-guess that.
    [403, 'unexpected'],
    [418, 'unexpected'],
  ];

  for (const [status, kind] of expected) {
    const { transport } = recording(json({ type: 'about:blank' }, status));
    const client = createApiClient({
      origin: 'https://api.example.com',
      sessionToken: null,
      transport,
    });
    const result: ApiResult = await client.get('/payouts');
    expect(result.ok, String(status)).toBe(false);
    if (result.ok) continue;
    expect(result.error, String(status)).toBe(kind);
    expect(result.status, String(status)).toBe(status);
  }
});

test('a request that never reached a status line is server_error with no status', async () => {
  const { transport } = recording(() => {
    throw new TypeError('fetch failed');
  });
  const client = createApiClient({
    origin: 'https://api.example.com',
    sessionToken: null,
    transport,
  });

  const result = await client.get('/payouts');
  expect(result.ok).toBe(false);
  if (result.ok) return;

  // `status: null` IS WHAT KEEPS "NOTHING ANSWERED" DISTINGUISHABLE FROM "THE
  // SERVER SAID 500" without a second vocabulary. No number is invented.
  expect(result.error).toBe('server_error');
  expect(result.status).toBeNull();
});

test('a 2xx whose body is not JSON is server_error, and the status it did have is carried', async () => {
  const { transport } = recording(new Response('<html>oops</html>', { status: 200 }));
  const client = createApiClient({
    origin: 'https://api.example.com',
    sessionToken: null,
    transport,
  });

  const result = await client.get('/payouts');
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toBe('server_error');
  expect(result.status).toBe(200);
});

// -----------------------------------------------------------------------------
// 4. The cache
// -----------------------------------------------------------------------------

test('every read is no-store, and the client offers no way to say otherwise', async () => {
  const { transport, calls } = recording(json([]));
  const client = createApiClient({
    origin: 'https://api.example.com',
    sessionToken: 'tok_abc',
    transport,
  });

  await client.get('/payouts');
  await client.get('/me');

  // M04 section 1.2, INV-M4-04, and the identity-scoping argument in the
  // client's own section 4: a cache key that omits the session serves one
  // trader's response to another, which is FM-M4-03.
  expect(calls.map((call) => call.init.cache)).toEqual(['no-store', 'no-store']);

  // `get` takes ONE argument. There is no options object a caller could put a
  // revalidate window into, which is the foreclosure expressed as an arity.
  expect(client.get.length).toBe(1);
});

// -----------------------------------------------------------------------------
// 5. One client, and it refuses a path it cannot compose
// -----------------------------------------------------------------------------

test('a path is spelled as API_CONTRACT spells it, and the base path is appended here', async () => {
  const client = createApiClient({
    origin: 'https://api.example.com',
    sessionToken: null,
    transport: recording(json([])).transport,
  });

  await expect(client.get('payouts')).rejects.toBeInstanceOf(ApiConfigError);

  // A caller that repeats the base path composes `/api/v1/api/v1/payouts`,
  // which is a 404 that reads like a missing endpoint. It is not refused here
  // because refusing it would mean this file knowing the shape of every path
  // API_CONTRACT declares; the assertion is that the composition is stated.
  const { transport, calls } = recording(json([]));
  const composed = createApiClient({
    origin: 'https://api.example.com',
    sessionToken: null,
    transport,
  });
  await composed.get(`${API_BASE_PATH}/payouts`);
  expect(calls[0]?.url).toBe(`https://api.example.com${API_BASE_PATH}${API_BASE_PATH}/payouts`);
});

test('a successful read hands back `unknown` and asserts no shape', async () => {
  const { transport } = recording(json({ anything: [1, 2, 3] }));
  const client = createApiClient({
    origin: 'https://api.example.com',
    sessionToken: null,
    transport,
  });

  const result = await client.get('/payouts');
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  // `body` is `unknown`. A caller cannot read a field off it without narrowing,
  // which is the foreclosure the client's section 5 argues: a generic `get<T>`
  // is a cast the compiler cannot check.
  expect(result.body).toEqual({ anything: [1, 2, 3] });
});
