import { readFileSync, readdirSync, statSync } from 'node:fs';
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
import type { ApiResult, Transport, WriteRequest } from '../src/http/client.ts';

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

// -----------------------------------------------------------------------------
// 6. The write verb (ADR-219)
// -----------------------------------------------------------------------------

const AUTH_ROUTES = join(REPO, 'apps', 'api', 'src', 'routes', 'auth.ts');

/** A client whose transport records, for the write cases below. */
function writer(response: Response | (() => never), sessionToken: string | null = 'tok_abc') {
  const { transport, calls } = recording(response);
  return {
    calls,
    client: createApiClient({ origin: 'https://api.example.com', sessionToken, transport }),
  };
}

/** A write with the fields every case below varies spelled out. */
function write(over: Partial<WriteRequest> = {}): WriteRequest {
  return { path: '/checkout', body: {}, idempotencyKey: null, ...over };
}

// 6.1 THE CSRF POSTURE, ASSERTED AGAINST THE TWO FACTS IT RESTS ON -------------

test('the write sends no CSRF token, because nothing on the server reads one', async () => {
  // THE RULING'S FIRST LEG, WATCHED. ADR-219 clause 1 mints no token on the
  // ground that `apps/api` has no CSRF control at all, so a header sent here
  // would be an unread header that a later reader counts as a control. THE DAY
  // THE API GROWS ONE THIS GOES RED, which is the direction it should fail in:
  // the client would then be the half that is missing.
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.ts')) files.push(full);
    }
  };
  walk(join(REPO, 'apps', 'api', 'src'));

  const matched = files.filter((file) => /csrf/i.test(readFileSync(file, 'utf8')));
  expect(matched, 'apps/api/src carries no CSRF control').toEqual([]);

  // And the client sends nothing that could be one.
  const { calls, client } = writer(json({ ok: true }, 201));
  await client.post(write());
  const headers = calls[0]?.init.headers as Record<string, string>;
  expect(Object.keys(headers).sort()).toEqual(['accept', 'content-type', 'cookie']);
});

test('the session cookie is SameSite=Lax, which is the cross-site half of the posture', () => {
  // THE RULING'S SECOND LEG. `SameSite=Lax` is what makes a cross-site forged
  // POST arrive with no session at all, and it is the reason clause 1 calls a
  // token a second copy of a control that already exists FOR THAT CASE. A
  // change to `SameSite=None` would make cross-site forgery live while every
  // other gate in this repository stayed green.
  const source = readFileSync(AUTH_ROUTES, 'utf8');
  const setter = /Set-Cookie',\s*`\$\{SESSION_COOKIE\}=\$\{token\}([^`]*)`/.exec(source);
  expect(setter, 'auth.ts sets the session cookie from a template').not.toBeNull();

  const attributes = setter?.[1] ?? '';
  expect(attributes).toContain('HttpOnly');
  expect(attributes).toContain('Secure');
  expect(attributes).toContain('SameSite=Lax');
  expect(attributes).not.toContain('SameSite=None');
});

test('three registered writes answer with a Set-Cookie this client cannot deliver', () => {
  // 6.2's inbound dead end, counted rather than left in prose. `next@16.3.2`
  // raises `ReadonlyRequestCookiesError` outside a Server Action or a Route
  // Handler, and ADR-138 section 3 with RI-11 refuse a Server Action in this
  // deployable outright, so a session established through `post` reaches no
  // browser.
  const source = readFileSync(AUTH_ROUTES, 'utf8');
  const emitters = source
    .split('\n')
    .filter((line) => /(set|clear)SessionCookie\(/.test(line) && !line.includes('function '));

  expect(emitters.length, 'auth.ts call sites that emit a Set-Cookie').toBe(3);
});

// 6.2 THE COOKIE FORWARD, WHICH THE METHOD DOES NOT CHANGE ---------------------

test('a write carries exactly one cookie and the method adds only a content type', async () => {
  const { calls, client } = writer(json({ id: 'pur_1' }, 201));

  await client.post(write({ path: '/checkout', body: { plan_version_id: 'pv_1' } }));

  expect(calls.length).toBe(1);
  const url = calls[0]?.url;
  const init = calls[0]?.init as RequestInit;
  const headers = init.headers as Record<string, string>;

  expect(url).toBe(`https://api.example.com${API_BASE_PATH}/checkout`);
  expect(init.method).toBe('POST');
  expect(headers['cookie']).toBe(`${SESSION_COOKIE}=tok_abc`);
  expect(headers['content-type']).toBe('application/json');
  expect(Object.keys(headers).sort()).toEqual(['accept', 'content-type', 'cookie']);
  expect(init.body).toBe('{"plan_version_id":"pv_1"}');

  // The browser is never the caller on a write either, so there is no
  // `credentials` mode here for the same reason there is none on the read.
  expect(init).not.toHaveProperty('credentials');

  // `fetch` rewrites a followed 3xx into a bodyless GET, so a redirect on a
  // write is refused rather than followed.
  expect(init.redirect).toBe('error');
  expect(init.cache).toBe('no-store');
});

test('no session token still makes the write, because the portal authorizes nobody', async () => {
  const { calls, client } = writer(json({ ok: true }), null);

  await client.post(write({ path: '/auth/otp', body: { email: 'a@b.c' } }));

  expect(calls.length).toBe(1);
  expect(Object.keys(calls[0]?.init.headers as Record<string, string>).sort()).toEqual([
    'accept',
    'content-type',
  ]);
});

// 6.3 IDEMPOTENCY --------------------------------------------------------------

test('the caller supplies the key and this file never mints one', async () => {
  const { calls, client } = writer(json({ id: 'pay_1' }, 202));

  await client.post(write({ path: '/accounts/acc_1/payout', idempotencyKey: 'key-abc-123' }));
  await client.post(write({ path: '/accounts/acc_1/payout', idempotencyKey: 'key-abc-123' }));

  // TWO CALLS, ONE KEY. A transport that minted a key per call would send two
  // different keys on a retry, which API_CONTRACT line 23 makes a second payout
  // rather than a replay of the first.
  const sent = calls.map(
    (call) => (call.init.headers as Record<string, string>)['idempotency-key'],
  );
  expect(sent).toEqual(['key-abc-123', 'key-abc-123']);
});

test('a null key sends no header, and the omission is the caller writing it out', async () => {
  const { calls, client } = writer(json({ ok: true }));

  await client.post(write({ path: '/kyc/session', idempotencyKey: null }));

  const headers = calls[0]?.init.headers as Record<string, string>;
  expect(headers).not.toHaveProperty('idempotency-key');
  expect(Object.keys(headers).sort()).toEqual(['accept', 'content-type', 'cookie']);
});

test('the header name is the one `apps/api` reads off the request', () => {
  // A SECOND COPY OF A HEADER NAME, ASSERTED AGAINST ITS READER, which is the
  // treatment `API_BASE_PATH` and `SESSION_COOKIE` already get above.
  const source = readFileSync(join(REPO, 'apps', 'api', 'src', 'routes', 'affiliate.ts'), 'utf8');
  expect(source).toContain("headers['idempotency-key']");
});

test('a key that is not a legal header value is refused before anything is sent', async () => {
  // Every one written as an ESCAPE rather than a literal, so no control byte
  // ever lands in this file. One did during drafting, turning an intended
  // internal space into a NUL and making this case pass for the wrong reason.
  const illegal = ['', ' key', 'key ', 'a\r\nx-injected: 1', 'a\nb', 'k\tey', 'a\u0000b'];

  for (const key of illegal) {
    const { calls, client } = writer(json({ ok: true }));
    await expect(
      client.post(write({ idempotencyKey: key })),
      JSON.stringify(key),
    ).rejects.toBeInstanceOf(ApiConfigError);
    expect(calls.length, JSON.stringify(key)).toBe(0);
  }

  // THE ACCEPTANCE DIRECTION, which is the half a refuse-everything guard would
  // pass without. A ULID, a UUID and a base64 key all reach the socket, and so
  // does an INTERNAL space: RFC 9110 permits one inside a field value and it is
  // only the ends that are trimmed, so the boundary is asserted rather than
  // guessed at.
  for (const key of ['01J8Z04F2C9AB3CDEF', 'a1b2-c3d4/e5+f6=', 'two words']) {
    const { calls, client } = writer(json({ ok: true }));
    await client.post(write({ idempotencyKey: key }));
    expect(calls.length, key).toBe(1);
    expect((calls[0]?.init.headers as Record<string, string>)['idempotency-key']).toBe(key);
  }
});

// 6.4 THE BODY, THE 204, AND THE SHARED MAPPING --------------------------------

test('a body that serialises to nothing is refused rather than sent as an empty one', async () => {
  const { calls, client } = writer(json({ ok: true }));

  await expect(client.post(write({ body: undefined }))).rejects.toBeInstanceOf(ApiConfigError);
  await expect(client.post(write({ body: () => 1 }))).rejects.toBeInstanceOf(ApiConfigError);
  await expect(client.post(write({ body: Symbol('x') }))).rejects.toBeInstanceOf(ApiConfigError);
  expect(calls.length).toBe(0);

  // A route with no payload says `{}` out loud and that IS sent.
  await client.post(write({ body: {} }));
  expect(calls[0]?.init.body).toBe('{}');
});

test('a body that cannot be serialised at all is a caller defect and not a transport failure', async () => {
  const circular: Record<string, unknown> = {};
  circular['self'] = circular;

  const { calls, client } = writer(json({ ok: true }));
  await expect(client.post(write({ body: circular }))).rejects.toBeInstanceOf(ApiConfigError);
  expect(calls.length).toBe(0);
});

test('a 204 is a success with a null body, and a 200 with no body is still server_error', async () => {
  const noContent = writer(new Response(null, { status: 204 }));
  const settled = await noContent.client.post(write({ path: '/auth/logout' }));

  // RFC 9110 gives a 204 no content, `auth.ts` uses it twice, and without this
  // arm a successful logout parses an empty stream and renders as an outage.
  expect(settled.ok).toBe(true);
  if (settled.ok) expect(settled.body).toBeNull();

  // THE ASYMMETRY IS DELIBERATE AND IS ASSERTED. An empty body on a 200 is a
  // server that answered wrongly, which is section 3's existing reading and
  // does not move.
  const empty = writer(new Response('', { status: 200 }));
  const wrong = await empty.client.post(write());
  expect(wrong.ok).toBe(false);
  if (!wrong.ok) {
    expect(wrong.error).toBe('server_error');
    expect(wrong.status).toBe(200);
  }
});

test('a write maps every status through the same vocabulary the read does', async () => {
  const expected: readonly (readonly [number, string])[] = [
    [404, 'not_found'],
    [401, 'unauthenticated'],
    [429, 'rate_limited'],
    [500, 'server_error'],
    [503, 'server_error'],

    // 409 `conflict` and 409 `idempotency_key_reuse` are two answers a write
    // gets that a read never does, and BOTH land on `unexpected`, because
    // `shell/app-shell.ts` owns that vocabulary and this file adds no member to
    // it. ADR-219 section 5 registers the problem document as unread.
    [409, 'unexpected'],
    [403, 'unexpected'],
  ];

  for (const [status, kind] of expected) {
    const { client } = writer(json({ type: 'about:blank', code: 'conflict' }, status));
    const result: ApiResult = await client.post(write());
    expect(result.ok, String(status)).toBe(false);
    if (result.ok) continue;
    expect(result.error, String(status)).toBe(kind);
    expect(result.status, String(status)).toBe(status);
  }
});

test('a write that never reached a status line is server_error with no status', async () => {
  const { client } = writer(() => {
    throw new TypeError('fetch failed');
  });

  const result = await client.post(write());
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toBe('server_error');
  expect(result.status).toBeNull();
});

test('a write refuses a path it cannot compose, and takes one argument', async () => {
  const { calls, client } = writer(json({ ok: true }));

  await expect(client.post(write({ path: 'checkout' }))).rejects.toBeInstanceOf(ApiConfigError);
  expect(calls.length).toBe(0);

  // The arity foreclosure `get` already carries: there is no options object a
  // caller could put a cache window or a second cookie into.
  expect(client.post.length).toBe(1);
});
