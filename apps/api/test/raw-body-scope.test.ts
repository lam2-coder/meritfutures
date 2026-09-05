import Fastify from 'fastify';
import { describe, expect, test } from 'vitest';

import {
  BASE_PATH,
  RouteRegistryError,
  buildServer,
  compose,
  defineRoutes,
  discoverRouteModules,
  installRawBodyParser,
} from '../src/index.ts';
import type { RouteModule } from '../src/index.ts';
import { KYC_WEBHOOK_PATH } from '../src/routes/webhooks-kyc.ts';
import { PSP_WEBHOOK_PATH } from '../src/routes/webhooks-psp.ts';
import { RISE_WEBHOOK_PATH } from '../src/routes/webhooks-rise.ts';

// CI-02, the `unit` project.
//
// WHAT THIS SUITE IS FOR. ADR-340 wired `installRawWebhookBodyParser` onto the
// real composition path, and the mechanism it built spans FOUR files:
// `registry.ts` declares `rawBody` and registers those routes inside a child
// context, and the three webhook modules declare it. The danger it carries is
// one thing and one thing only: a raw parser reaching a route that wanted an
// object. So the scope is watched in ONE file from both sides rather than
// spread across three receivers' suites, where a reviewer would have to hold
// three files open to see whether the blast radius is what the ADR claims.
//
// IT IS ALSO ITS OWN FILE BECAUSE THE OTHER THREE ARE HELD BY CONCURRENT ROWS.
// `webhooks-psp.test.ts`, `webhooks-rise.test.ts` and `kyc.test.ts` each belong
// to a receiver's slice; this row is the registration and its proof.

/** Every module on disk, which is what the deployments actually compose. */
const onDisk = await discoverRouteModules();

/**
 * The same modules with every `rawBody` stripped: the tree AS IT STOOD BEFORE
 * ADR-340.
 *
 * IT IS DERIVED FROM THE REAL MODULES RATHER THAN HAND-WRITTEN, so the "before"
 * is the same handler, the same dependencies and the same composition as the
 * "after", differing in the one flag whose effect is the claim.
 */
const withoutRawBody = (modules: readonly RouteModule[]): readonly RouteModule[] =>
  modules.map((module) => ({
    name: module.name,
    routes: module.routes.map((route) => ({
      method: route.method,
      path: route.path,
      handler: route.handler,
    })),
  }));

/**
 * API_CONTRACT section 10's three rows, and the answer each receiver's OWN code
 * reaches once it is entered at all.
 *
 * THE TWO 404s AND THE 503 ARE NOT A PREFERENCE, THEY ARE THE PATH. A row
 * carrying `:provider` with no adapter resolved names no resource, so its
 * resolver answers `not_found` before any dependency is consulted; the Rise row
 * carries no path parameter, so nothing there could be absent and 503 is
 * section 2's code for a dependency that is not there.
 */
const ROWS = [
  { path: RISE_WEBHOOK_PATH, status: 503, code: 'service_unavailable' },
  { path: PSP_WEBHOOK_PATH.replace(':provider', 'psp_a'), status: 404, code: 'not_found' },
  { path: KYC_WEBHOOK_PATH.replace(':provider', 'acme'), status: 404, code: 'not_found' },
] as const;

const post = (path: string) =>
  ({
    method: 'POST' as const,
    url: `${BASE_PATH}${path}`,
    headers: { 'content-type': 'application/json' },
    payload: Buffer.from('{"hello":"world"}'),
  }) as const;

/**
 * A handler that reports WHAT IT WAS GIVEN rather than what it expected.
 *
 * The claim under test is about the type of `request.body` at two routes
 * composed onto one instance, so the handler asserts nothing and the test does.
 */
const bodyShape = async (request: { body: unknown }) => ({
  bytes: request.body instanceof Uint8Array,
  body: request.body,
});

/** A body route that asks for bytes and a body route beside it that does not. */
const mixed = [
  defineRoutes({
    name: 'health',
    routes: [{ method: 'POST', path: '/checkout', handler: bodyShape }],
  }),
  defineRoutes({
    name: 'kyc',
    routes: [{ method: 'POST', path: '/kyc/session', handler: bodyShape, rawBody: true }],
  }),
];

// -----------------------------------------------------------------------------
// The finding, and the fix, on the composition a deployment actually runs
// -----------------------------------------------------------------------------

describe('the three webhook rows over the real composition path', () => {
  test('WITHOUT the flag every one of them is 500 and no receiver is entered', async () => {
    for (const row of ROWS) {
      const { app } = buildServer({ surface: 'public', modules: withoutRawBody(onDisk) });
      const response = await app.inject(post(row.path));

      // `rawBodyOf` refuses the parsed object before the receiver's first line,
      // so this 500 is the same answer for all three and says nothing about any
      // of them. That is exactly what made the receivers unverifiable.
      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({ code: 'internal_error' });
      await app.close();
    }
  });

  test('WITH it each row reaches its own designed answer', async () => {
    for (const row of ROWS) {
      const { app } = buildServer({ surface: 'public', modules: onDisk });
      const response = await app.inject(post(row.path));

      expect(response.statusCode).toBe(row.status);
      expect(response.json()).toMatchObject({ code: row.code });
      await app.close();
    }
  });

  test("the 404s are the receivers' own, which the withheld list shows", async () => {
    // The same two paths on a deployment that does not serve them are also 404,
    // and the difference is that nothing was registered there at all. A test
    // that only asserted the code would pass on a route that had vanished.
    const { report } = buildServer({ surface: 'operator', modules: onDisk });
    for (const path of [RISE_WEBHOOK_PATH, PSP_WEBHOOK_PATH, KYC_WEBHOOK_PATH])
      expect(report.withheld).toContain(`POST ${path}`);

    const publicSide = buildServer({ surface: 'public', modules: onDisk });
    for (const path of [RISE_WEBHOOK_PATH, PSP_WEBHOOK_PATH, KYC_WEBHOOK_PATH])
      expect(publicSide.report.registered).toContain(`POST ${path}`);
    await publicSide.app.close();
  });
});

// -----------------------------------------------------------------------------
// The scope, which is the whole reason this is a child context
// -----------------------------------------------------------------------------

describe('the raw parser reaches the routes that asked for it and no others', () => {
  test('a sibling route composed alongside a raw one still receives a parsed object', async () => {
    const app = Fastify();
    compose(app, 'public', mixed);

    const raw = await app.inject(post('/kyc/session'));
    expect(raw.json()).toMatchObject({ bytes: true });

    const parsed = await app.inject(post('/checkout'));
    expect(parsed.json()).toMatchObject({ bytes: false, body: { hello: 'world' } });

    await app.close();
  });

  test('the report names exactly the routes served raw, and it is a subset of the registered', () => {
    const { report } = buildServer({ surface: 'public', modules: onDisk });

    // THE ONLY CHEAP CONTROL AGAINST A RAW PARSER REACHING A ROUTE THAT WANTED
    // AN OBJECT. If a fourth route ever declares `rawBody`, this line goes red
    // and somebody decides rather than discovers.
    expect([...report.raw].sort()).toStrictEqual(
      [`POST ${KYC_WEBHOOK_PATH}`, `POST ${PSP_WEBHOOK_PATH}`, `POST ${RISE_WEBHOOK_PATH}`].sort(),
    );
    for (const endpoint of report.raw) expect(report.registered).toContain(endpoint);
  });

  test('a surface that withholds a raw route creates no context for it', async () => {
    const operator = compose(Fastify(), 'operator', mixed);
    expect(operator.raw).toStrictEqual([]);
    expect(operator.withheld).toContain('POST /kyc/session');
  });
});

// -----------------------------------------------------------------------------
// The two ways this mechanism breaks quietly
// -----------------------------------------------------------------------------

describe('the shapes that would fail at boot or mean nothing', () => {
  test('a caller that also installs the parser on the ROOT still boots', async () => {
    // Three suites do exactly this to build an app without going through
    // `compose`. Fastify reports a non-default `application/json` parser as
    // already present, so without the remove inside `installRawBodyParser` the
    // child context throws FST_ERR_CTP_ALREADY_PRESENT at `ready()` and every
    // one of those suites goes red on a boot error naming a vendor file.
    const app = Fastify();
    compose(app, 'public', mixed);
    installRawBodyParser(app);

    const response = await app.inject(post('/kyc/session'));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ bytes: true });
    await app.close();
  });

  test('`rawBody` on a verb that carries no body is refused at the definition', () => {
    const declared = () =>
      defineRoutes({
        name: 'catalog',
        routes: [{ method: 'GET', path: '/plans', handler: () => ({ ok: true }), rawBody: true }],
      });
    expect(declared).toThrow(RouteRegistryError);
    expect(declared).toThrow(/only POST \| PATCH \| PUT carry a body/);
  });
});
