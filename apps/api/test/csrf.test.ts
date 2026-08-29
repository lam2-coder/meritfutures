import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import {
  BASE_PATH,
  CSRF_SAFE_METHODS,
  LIVENESS_PATH,
  PROBLEM_MEDIA_TYPE,
  PROBLEM_TYPE_PREFIX,
  buildServer,
  csrfVerdict,
  defineRoutes,
  discoverRouteModules,
} from '../src/index.ts';
import type { RouteModule } from '../src/index.ts';

// CI-02, the `unit` project.
//
// WHAT THIS SUITE IS FOR. The constitution's Appendix D section D2 rules "CSRF
// on cookie mutations" among the binding application controls, and until
// ADR-221 nothing in this tree implemented it. `server.test.ts` watches the
// transport's two error shapes and `surface.test.ts` watches the partition;
// this is the suite that watches the CONTROL, which means watching it REFUSE.
//
// EVERY REQUEST BELOW GOES THROUGH `inject`, which is light-my-request feeding
// the real Fastify pipeline, so a 403 here is produced by the same hook a
// socket's request would meet. The pure-function cases are asserted separately
// because a verdict is a decision and a status is a consequence, and a suite
// that only ever reads statuses cannot tell WHICH clause admitted a request.

/** A module with one read and one write, so the same path can be asked both ways. */
const probe: RouteModule = defineRoutes({
  name: 'probe',
  routes: [
    { method: 'GET', path: '/me', handler: () => ({ read: true }) },
    { method: 'POST', path: '/checkout', handler: () => ({ wrote: true }) },
    { method: 'PATCH', path: '/me/phone', handler: () => ({ wrote: true }) },
  ],
});

/** The public deployment, over the probe module. */
function server(): ReturnType<typeof buildServer> {
  return buildServer({ surface: 'public', modules: [probe] });
}

// -----------------------------------------------------------------------------
// 1. THE CONTROL REFUSES, AND THE REQUEST IT REFUSES IS THE ONE ROW 221 NAMES
// -----------------------------------------------------------------------------

test('a write from the marketing origin is refused, which is the gap SameSite=Lax left open', async () => {
  // THE WHOLE FINDING, EXECUTED. INFRA section 2.1 rows `site` on
  // `meritfutures.com` and `api` on `app.meritfutures.com`. Those share a
  // registrable domain, so a `Lax` cookie IS sent on a form POST from the first
  // to the second and the request arrives fully authenticated. Nothing in this
  // tree refused it before ADR-221.
  const { app } = server();
  const res = await app.inject({
    method: 'POST',
    url: `${BASE_PATH}/checkout`,
    headers: {
      host: 'app.meritfutures.com',
      origin: 'https://meritfutures.com',
      cookie: 'merit_session=tok_stolen',
    },
    payload: {},
  });

  expect(res.statusCode).toBe(403);
  expect(res.headers['content-type']).toContain(PROBLEM_MEDIA_TYPE);
  const body: unknown = res.json();
  expect(body).toMatchObject({
    type: `${PROBLEM_TYPE_PREFIX}forbidden`,
    title: 'Forbidden',
    status: 403,
    code: 'forbidden',
  });
  // The handler never ran, so the refusal is the hook's and not a route's.
  expect(res.payload).not.toContain('wrote');
});

test('the refusal names no clause, so a forged caller learns nothing to send next', async () => {
  const { app } = server();
  const res = await app.inject({
    method: 'POST',
    url: `${BASE_PATH}/checkout`,
    headers: { host: 'app.meritfutures.com', origin: 'https://evil.example' },
    payload: {},
  });

  const body = res.json() as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(['code', 'instance', 'status', 'title', 'type']);
  // API_CONTRACT section 2: `required_factor` is a 403 extension member, and
  // its vocabulary is closed at six tokens none of which names an origin.
  expect(body['required_factor']).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain('origin');
});

test('a same-hostname write is accepted, which is the acceptance case watched', async () => {
  // A PROBE THAT ONLY EVER ATTEMPTS FORBIDDEN THINGS PASSES AGAINST A GUARD
  // THAT REJECTS EVERYTHING (dispatch protocol section 6). This is that case.
  const { app } = server();
  const res = await app.inject({
    method: 'POST',
    url: `${BASE_PATH}/checkout`,
    headers: {
      host: 'app.meritfutures.com',
      origin: 'https://app.meritfutures.com',
      cookie: 'merit_session=tok_real',
    },
    payload: {},
  });

  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ wrote: true });
});

test('a write with no Origin at all is accepted, which is every legitimate caller today', async () => {
  // ADR-219 section 3: the portal's SERVER holds the inbound cookie and calls
  // this API from Node, where `fetch` sends no `Origin`. `/webhooks/*` callers
  // are the same shape. Clause 2 is what makes this control need no client
  // change, and a control the portal cannot satisfy is the trap row 221 named.
  const { app } = server();
  const res = await app.inject({
    method: 'POST',
    url: `${BASE_PATH}/checkout`,
    headers: { host: 'app.meritfutures.com', cookie: 'merit_session=tok_real' },
    payload: {},
  });

  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ wrote: true });
});

test('a cross-origin READ is untouched, because a read is not a mutation', async () => {
  const { app } = server();
  const res = await app.inject({
    method: 'GET',
    url: `${BASE_PATH}/me`,
    headers: { host: 'app.meritfutures.com', origin: 'https://meritfutures.com' },
  });

  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ read: true });
});

test('PATCH is guarded too, so the control is the METHOD CLASS and not a verb', async () => {
  const { app } = server();
  const res = await app.inject({
    method: 'PATCH',
    url: `${BASE_PATH}/me/phone`,
    headers: { host: 'app.meritfutures.com', origin: 'https://meritfutures.com' },
    payload: {},
  });

  expect(res.statusCode).toBe(403);
});

// -----------------------------------------------------------------------------
// 2. THE HOOK'S COVERAGE IS THE INSTANCE'S AND IS NOT A LIST
// -----------------------------------------------------------------------------

test('a cross-origin write to a path nothing registered is refused before the 404', async () => {
  // The hook is on the root instance, so it runs ahead of the not-found
  // handler. That ordering is asserted rather than assumed: a control installed
  // per-route would leave the whole unregistered surface uncovered, and the
  // withheld operator routes are exactly that surface on this deployment.
  const { app } = server();
  const res = await app.inject({
    method: 'POST',
    url: `${BASE_PATH}/internal/jobs`,
    headers: { host: 'app.meritfutures.com', origin: 'https://meritfutures.com' },
    payload: {},
  });

  expect(res.statusCode).toBe(403);
});

test('the operator deployment carries the same control, over the modules on disk', async () => {
  // ADR-083 deploys one codebase twice. An admin write is a cookie mutation for
  // the same reason a trader write is, so the control cannot be the public
  // surface's alone. Asserted over the REAL module set rather than the probe.
  const onDisk = await discoverRouteModules();
  const { app } = buildServer({ surface: 'operator', modules: onDisk });
  const res = await app.inject({
    method: 'POST',
    url: `${BASE_PATH}/admin/anything`,
    headers: { host: 'admin.example', origin: 'https://evil.example' },
    payload: {},
  });

  expect(res.statusCode).toBe(403);
});

test('GET /health still answers on both surfaces with an Origin present', async () => {
  // The one route this deployable serves without data. A safe method is never
  // this control's business and a regression here would be the control reaching
  // past its own subject.
  const onDisk = await discoverRouteModules();
  for (const surface of ['public', 'operator'] as const) {
    const { app } = buildServer({ surface, modules: onDisk });
    const res = await app.inject({
      method: 'GET',
      url: `${BASE_PATH}${LIVENESS_PATH}`,
      headers: { host: 'app.meritfutures.com', origin: 'https://meritfutures.com' },
    });
    expect(res.statusCode, surface).toBe(200);
  }
});

// -----------------------------------------------------------------------------
// 3. THE VERDICT ITSELF, CLAUSE BY CLAUSE
// -----------------------------------------------------------------------------

test('every safe method is admitted by the safe-method clause and no other', () => {
  for (const method of CSRF_SAFE_METHODS)
    expect(csrfVerdict({ method, origin: 'https://evil.example', host: 'a.example' })).toEqual({
      allowed: true,
      reason: 'safe-method',
    });
  expect(CSRF_SAFE_METHODS).toEqual(['GET', 'HEAD', 'OPTIONS']);
});

test('an unsafe verb this contract does not use yet is guarded, not exempt', () => {
  // The fail-closed direction. `registry.ts` closes the route vocabulary at
  // five verbs; this check tests membership of the SAFE list, so a sixth verb
  // arrives guarded rather than arriving with a hole.
  for (const method of ['PUT', 'DELETE', 'PROPFIND', 'purge'])
    expect(csrfVerdict({ method, origin: 'https://evil.example', host: 'a.example' })).toEqual({
      allowed: false,
      reason: 'origin-mismatch',
    });
});

test('the method comparison is case-insensitive', () => {
  expect(csrfVerdict({ method: 'get', origin: 'https://evil.example', host: 'a.example' })).toEqual(
    { allowed: true, reason: 'safe-method' },
  );
});

test('port and scheme are ignored, because the cookie is scoped by neither', () => {
  // `routes/auth.ts` sets `merit_session` with no `Domain`, so it is host-only:
  // one hostname, any port, and (subject to `Secure`) any scheme. Comparing
  // hostnames is exactly as tight as the cookie is, and no tighter.
  const cases = [
    { origin: 'https://app.example.com', host: 'app.example.com' },
    { origin: 'https://app.example.com:8443', host: 'app.example.com' },
    { origin: 'http://app.example.com', host: 'app.example.com:443' },
    { origin: 'https://APP.example.com', host: 'app.EXAMPLE.com' },
    { origin: 'http://[::1]:8080', host: '[::1]:3000' },
  ];
  for (const { origin, host } of cases)
    expect(csrfVerdict({ method: 'POST', origin, host }), `${origin} vs ${host}`).toEqual({
      allowed: true,
      reason: 'same-host',
    });
});

test('a sibling subdomain is a MISMATCH, which is the whole point of the ruling', () => {
  // `SameSite` would call this pair same-site. This control does not, and that
  // difference is the finding row 221 was reserved for.
  expect(
    csrfVerdict({
      method: 'POST',
      origin: 'https://meritfutures.com',
      host: 'app.meritfutures.com',
    }),
  ).toEqual({ allowed: false, reason: 'origin-mismatch' });
  expect(
    csrfVerdict({
      method: 'POST',
      origin: 'https://app.meritfutures.com.evil.example',
      host: 'app.meritfutures.com',
    }),
  ).toEqual({ allowed: false, reason: 'origin-mismatch' });
});

test('an Origin this file cannot read is refused rather than guessed at', () => {
  const unreadable = [
    'null', // a sandboxed frame, or a cross-origin redirect
    '',
    'https://a.example, https://b.example', // two headers Node folded into one
    'file:///etc/passwd',
    'chrome-extension://abcdef',
    'https://a.example/path',
    'https://user:pw@a.example',
    'not a url',
  ];
  for (const origin of unreadable)
    expect(csrfVerdict({ method: 'POST', origin, host: 'a.example' }), origin).toEqual({
      allowed: false,
      reason: 'unreadable-origin',
    });
});

test('a repeated Origin header is refused, because neither value may be preferred', () => {
  expect(
    csrfVerdict({
      method: 'POST',
      origin: ['https://a.example', 'https://evil.example'],
      host: 'a.example',
    }),
  ).toEqual({ allowed: false, reason: 'unreadable-origin' });
});

test('an unreadable Host is refused, and the delimiter check runs before the parse', () => {
  // `new URL('http://trusted@attacker')` reads `attacker`. A Host header
  // carrying a delimiter is rejected outright rather than reparsed into
  // whichever half the URL grammar prefers.
  for (const host of [undefined, '', 'a.example/x', 'a.example?x', 'trusted.example@a.example'])
    expect(
      csrfVerdict({ method: 'POST', origin: 'https://a.example', host }),
      String(host),
    ).toEqual({ allowed: false, reason: 'unreadable-host' });
});

test('an absent Host does not matter on a safe method or with no Origin', () => {
  expect(csrfVerdict({ method: 'GET', origin: 'https://a.example', host: undefined })).toEqual({
    allowed: true,
    reason: 'safe-method',
  });
  expect(csrfVerdict({ method: 'POST', origin: undefined, host: undefined })).toEqual({
    allowed: true,
    reason: 'no-origin',
  });
});

// -----------------------------------------------------------------------------
// 4. THE TWO FACTS IN OTHER FILES THAT THIS RULING RESTS ON
// -----------------------------------------------------------------------------

const AUTH_ROUTES = join(import.meta.dirname, '..', 'src', 'routes', 'auth.ts');

test('the session cookie is host-only, which is why a hostname comparison is enough', () => {
  // THE LEG THE `WHY HOSTNAME` ARGUMENT STANDS ON. A `Domain=` attribute would
  // widen the cookie to every subdomain of whatever it named, and this check
  // would then be drawn tighter than the cookie in a way nothing else here
  // would report. If this goes red, `csrf.ts`'s reasoning needs rereading
  // before the attribute lands.
  const source = readFileSync(AUTH_ROUTES, 'utf8');
  const emitted = source
    .split('\n')
    .filter((line) => line.includes('${SESSION_COOKIE}=') && line.includes('Path=/'));

  expect(emitted.length, 'Set-Cookie templates in auth.ts').toBeGreaterThan(0);
  for (const line of emitted) expect(line, line.trim()).not.toContain('Domain');
});

test('this control reads no token, so no client owes one', () => {
  // ADR-219 clause 1 declined to mint a client-side token on the ground that
  // nothing on the server reads one, and ADR-221 keeps that true rather than
  // overturning it: the control added here reads the `Origin` header and
  // nothing else. A token header appearing in this file would make the portal
  // the missing half of a control it has no way to know about.
  const source = readFileSync(join(import.meta.dirname, '..', 'src', 'csrf.ts'), 'utf8');
  expect(/x-csrf|csrf[-_]?token/i.test(source), 'csrf.ts names no token header').toBe(false);
});

test('a forged write is refused BEFORE its body is parsed', async () => {
  // THE ORDERING, WATCHED RATHER THAN INFERRED FROM THE HOOK'S NAME. A body
  // that would fail the JSON parser answers 403 and not 400, which is what
  // makes `onRequest` the right lifecycle point: an attacker's payload is never
  // read, so nothing downstream of the parser is reachable by a forged request.
  const { app } = server();
  const res = await app.inject({
    method: 'POST',
    url: `${BASE_PATH}/checkout`,
    headers: {
      host: 'app.meritfutures.com',
      origin: 'https://meritfutures.com',
      'content-type': 'application/json',
    },
    payload: '{ this is not json',
  });

  expect(res.statusCode).toBe(403);
  expect((res.json() as Record<string, unknown>)['code']).toBe('forbidden');
});
