import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import {
  BASE_PATH,
  CONTENT_SECURITY_POLICY,
  CONTENT_TYPE_OPTIONS,
  SECURITY_HEADERS,
  STRICT_TRANSPORT_SECURITY,
  buildServer,
  defineRoutes,
  discoverRouteModules,
  securityHeaderEntries,
} from '../src/index.ts';
import type { RouteModule } from '../src/index.ts';

// CI-02, the `unit` project.
//
// WHAT THIS SUITE IS FOR. The constitution's Appendix D section D2 rules
// "strict CSP/HSTS/frame-deny" among the binding application controls, and
// until ADR-223 nothing in this repository set any of the three on any surface.
// The audit that found it also found the other half of the defect, which is
// that NO TEST ANYWHERE ASSERTED ANY SECURITY HEADER, so none of it would have
// failed if it had been added and later removed. This file is that half.
//
// IT WATCHES THE RESPONSES NO ROUTE PRODUCES, WHICH IS THE POINT. A per-route
// header would cover the 200s and would miss the not-found path, the CSRF
// refusal and the error handler, and those are exactly the responses an
// attacker sees most of.

/** One read, one write, and one handler that throws, so all four shapes exist. */
const probe: RouteModule = defineRoutes({
  name: 'probe',
  routes: [
    { method: 'GET', path: '/me', handler: () => ({ read: true }) },
    { method: 'POST', path: '/checkout', handler: () => ({ wrote: true }) },
    {
      method: 'GET',
      path: '/boom',
      handler: () => {
        throw new Error('deliberate');
      },
    },
  ],
});

function server(): ReturnType<typeof buildServer> {
  return buildServer({ surface: 'public', modules: [probe] });
}

/** The three names, read off the module rather than written a second time. */
const NAMES = Object.keys(SECURITY_HEADERS);

test('the header set is exactly the three ADR-223 rules, and each carries its ruled value', () => {
  expect(NAMES).toEqual([
    'Content-Security-Policy',
    'Strict-Transport-Security',
    'X-Content-Type-Options',
  ]);
  expect(CONTENT_SECURITY_POLICY).toBe(
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  expect(STRICT_TRANSPORT_SECURITY).toBe('max-age=31536000; includeSubDomains');
  expect(CONTENT_TYPE_OPTIONS).toBe('nosniff');
  expect(securityHeaderEntries().map(([name]) => name)).toEqual(NAMES);
});

// -----------------------------------------------------------------------------
// THE POLICY'S CONTENT, ASSERTED AS DIRECTIVES RATHER THAN AS A STRING
// -----------------------------------------------------------------------------
// A string comparison alone would pass a policy that had lost `frame-ancestors`
// and gained a longer `default-src`, as long as somebody updated the expected
// string in the same commit. These read the directives.

/** The policy as a map, which is how a browser reads it. */
function directives(policy: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const clause of policy.split(';')) {
    const parts = clause.trim().split(/\s+/).filter(Boolean);
    const name = parts.shift();
    if (name !== undefined) out.set(name, parts);
  }
  return out;
}

test('three directives do not fall back to default-src, so all three are spelled out', () => {
  const d = directives(CONTENT_SECURITY_POLICY);
  // CSP has no fallback for these, at any level. A policy that names only
  // `default-src 'none'` permits framing, which is D2's `frame-deny` undone by
  // an omission that reads as tidy.
  expect(d.get('frame-ancestors')).toEqual(["'none'"]);
  expect(d.get('form-action')).toEqual(["'none'"]);
  expect(d.get('base-uri')).toEqual(["'none'"]);
  expect(d.get('default-src')).toEqual(["'none'"]);
});

test('no source expression in the API policy names a host or a scheme', () => {
  // ADR-012 keeps every real hostname out of this repository and `INV-M6-02`
  // needs a policy that cannot span two origins. Both hold by construction if
  // every source expression is a quoted keyword, so that is what is asserted
  // rather than the absence of one particular hostname.
  for (const [name, sources] of directives(CONTENT_SECURITY_POLICY)) {
    for (const source of sources) {
      expect(source, `${name} carries a non-keyword source`).toMatch(/^'[a-z-]+'$/);
    }
  }
});

test('HSTS is a year, covers subdomains, and does not ask for the preload list', () => {
  expect(STRICT_TRANSPORT_SECURITY).toMatch(/^max-age=(\d+); includeSubDomains$/);
  const maxAge = Number(/^max-age=(\d+)/.exec(STRICT_TRANSPORT_SECURITY)?.[1]);
  expect(maxAge).toBeGreaterThanOrEqual(31536000);
  // A preload-list entry ships inside browser binaries and takes months to
  // leave. ADR-223's approval line puts it to the founder; until it is signed,
  // this asserts the absence rather than leaving it to a reader to notice.
  expect(STRICT_TRANSPORT_SECURITY).not.toContain('preload');
});

// -----------------------------------------------------------------------------
// THROUGH THE REAL PIPELINE. Every request below goes through `inject`, which
// is light-my-request feeding the same Fastify instance a socket would reach.
// -----------------------------------------------------------------------------

/** Read the three off a response, in the shape the assertions want them. */
function headersOf(res: { headers: Record<string, unknown> }): Record<string, unknown> {
  return Object.fromEntries(NAMES.map((n) => [n, res.headers[n.toLowerCase()]]));
}

const EXPECTED: Record<string, string> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'Strict-Transport-Security': STRICT_TRANSPORT_SECURITY,
  'X-Content-Type-Options': CONTENT_TYPE_OPTIONS,
};

test('a 200 carries all three', async () => {
  const { app } = server();
  const res = await app.inject({ method: 'GET', url: `${BASE_PATH}/me` });
  expect(res.statusCode).toBe(200);
  expect(headersOf(res)).toEqual(EXPECTED);
});

test('the not-found path carries all three, and no route produces it', async () => {
  const { app } = server();
  const res = await app.inject({ method: 'GET', url: `${BASE_PATH}/nothing-here` });
  expect(res.statusCode).toBe(404);
  expect(headersOf(res)).toEqual(EXPECTED);
});

test('a path outside the API base path entirely carries all three', async () => {
  const { app } = server();
  const res = await app.inject({ method: 'GET', url: '/' });
  expect(res.statusCode).toBe(404);
  expect(headersOf(res)).toEqual(EXPECTED);
});

test('the error handler carries all three', async () => {
  const { app } = server();
  const res = await app.inject({ method: 'GET', url: `${BASE_PATH}/boom` });
  expect(res.statusCode).toBe(500);
  expect(headersOf(res)).toEqual(EXPECTED);
});

test('THE CSRF REFUSAL CARRIES ALL THREE, which is the ordering ADR-223 rules', async () => {
  // ADR-221's hook can END a request before any handler runs. If the header
  // hook were registered after it, the one response class produced by a
  // deliberate attack would be the one class with no policy on it. This is the
  // assertion that fails if the two `addHook` calls in `server.ts` swap.
  const { app } = server();
  const res = await app.inject({
    method: 'POST',
    url: `${BASE_PATH}/checkout`,
    headers: { origin: 'https://attacker.example', host: 'api.merit.test' },
  });
  expect(res.statusCode).toBe(403);
  expect(headersOf(res)).toEqual(EXPECTED);
});

test('both surfaces carry all three, over the real on-disk route modules', async () => {
  const onDisk = await discoverRouteModules();
  for (const surface of ['public', 'operator'] as const) {
    const { app } = buildServer({ surface, modules: onDisk });
    const res = await app.inject({ method: 'GET', url: `${BASE_PATH}/health` });
    expect(headersOf(res), `${surface} surface`).toEqual(EXPECTED);
  }
});

// -----------------------------------------------------------------------------
// THE LEG THAT LIVES IN ANOTHER FILE
// -----------------------------------------------------------------------------
// ADR-221 asserted `auth.ts`'s cookie templates from `csrf.test.ts` because the
// argument for comparing hostnames rested on a line in a file the control does
// not import. The same shape applies here: the hook's coverage argument rests
// on `server.ts` registering the header hook BEFORE the CSRF one, and the
// injected 403 above proves the behaviour. This reads the registration order as
// text as well, because a future refactor could preserve the behaviour on the
// 403 path and lose it on a path this suite has not thought of.

test('server.ts registers the header hook before the CSRF hook', () => {
  const source = readFileSync(join(import.meta.dirname, '../src/server.ts'), 'utf8');
  const headerHook = source.indexOf('securityHeaderEntries()');
  const csrfHook = source.indexOf('csrfVerdict({');
  expect(headerHook).toBeGreaterThan(-1);
  expect(csrfHook).toBeGreaterThan(-1);
  expect(headerHook).toBeLessThan(csrfHook);
});
