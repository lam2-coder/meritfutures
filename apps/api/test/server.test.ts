import { expect, test } from 'vitest';

import {
  BASE_PATH,
  LIVENESS_PATH,
  PROBLEM_MEDIA_TYPE,
  PROBLEM_TYPE_PREFIX,
  buildServer,
  defineRoutes,
  discoverRouteModules,
} from '../src/index.js';
import type { RouteModule } from '../src/index.js';

// CI-02, the `unit` project.
//
// WHAT THIS SUITE IS FOR. `surface.test.ts` asserts the PARTITION and says in
// its own header that "the suite that watches a real 404 arrives with the
// routes". This is that suite. Every assertion below goes through Fastify's
// real router by way of `inject`, which is light-my-request feeding the
// server's own request pipeline rather than a stub of it, so a 404 here is
// produced the same way a socket's is.

/** Every module on disk, which is what the deployments actually compose. */
const onDisk = await discoverRouteModules();

/**
 * An operator module, and it is synthetic BECAUSE THIS SLICE OWNS NO OPERATOR
 * ROUTE.
 *
 * `/internal/jobs` is API_CONTRACT section 9's row and it belongs to whichever
 * slice implements queue depth. What is asserted here is not that endpoint's
 * behaviour, it is that a declared operator route is NOT REGISTERED on the
 * public deployment, and asserting that needs one to exist. The alternative is
 * to wait until a real operator route lands, which means the mechanism ADR-083
 * rests on ships unwatched.
 */
const ops: RouteModule = defineRoutes({
  name: 'ops',
  routes: [{ method: 'GET', path: '/internal/jobs', handler: () => ({ depth: 0 }) }],
});

// -----------------------------------------------------------------------------
// The route that serves
// -----------------------------------------------------------------------------

test('GET /api/v1/health answers 200 with exactly API_CONTRACT section 9s body', async () => {
  const { app } = buildServer({ surface: 'public', modules: onDisk });
  const res = await app.inject({ method: 'GET', url: `${BASE_PATH}${LIVENESS_PATH}` });
  expect(res.statusCode).toBe(200);
  // "returns `{ status: "ok" }` and nothing else: no version, no dependency
  // list, no build id". The strict equality is the "nothing else".
  expect(res.json()).toStrictEqual({ status: 'ok' });
  await app.close();
});

test('both deployments serve liveness, which is the row a section-heading partition gets wrong', async () => {
  for (const surface of ['public', 'operator'] as const) {
    const { app } = buildServer({ surface, modules: onDisk });
    const res = await app.inject({ method: 'GET', url: `${BASE_PATH}${LIVENESS_PATH}` });
    expect(res.statusCode).toBe(200);
    await app.close();
  }
});

// The base path is in the URL and not in the declaration, so a request to the
// bare contract path reaches nothing.
test('the liveness path without the base path is not served', async () => {
  const { app } = buildServer({ surface: 'public', modules: onDisk });
  const res = await app.inject({ method: 'GET', url: LIVENESS_PATH });
  expect(res.statusCode).toBe(404);
  await app.close();
});

// -----------------------------------------------------------------------------
// ADR-083's 404, watched being the ROUTER's
// -----------------------------------------------------------------------------

test('the public deployment answers 404 for an operator route it was given', async () => {
  const { app, report } = buildServer({ surface: 'public', modules: [...onDisk, ops] });
  // The route was DECLARED and not registered. That is the whole mechanism:
  // there is nothing at this path for a permission check to run against.
  expect(report.withheld).toStrictEqual(['GET /internal/jobs']);
  expect(report.registered).not.toContain('GET /internal/jobs');

  const res = await app.inject({ method: 'GET', url: `${BASE_PATH}/internal/jobs` });
  expect(res.statusCode).toBe(404);
  expect(res.headers['content-type']).toContain(PROBLEM_MEDIA_TYPE);
  expect(res.json()).toMatchObject({
    type: `${PROBLEM_TYPE_PREFIX}not_found`,
    title: 'Not found',
    status: 404,
    code: 'not_found',
  });
  await app.close();
});

test('the SAME module on the operator deployment answers 200 at the SAME path', async () => {
  const { app, report } = buildServer({ surface: 'operator', modules: [...onDisk, ops] });
  expect(report.registered).toContain('GET /internal/jobs');
  const res = await app.inject({ method: 'GET', url: `${BASE_PATH}/internal/jobs` });
  expect(res.statusCode).toBe(200);
  await app.close();
});

// A 403 here would mean a check ran. API_CONTRACT section 12 requires 404 from
// the public origin precisely so that no check has to be got right.
test('the public deployment never answers 403 for an operator path', async () => {
  const { app } = buildServer({ surface: 'public', modules: [...onDisk, ops] });
  for (const url of [`${BASE_PATH}/internal/jobs`, `${BASE_PATH}/admin/liability`]) {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(404);
  }
  await app.close();
});

// -----------------------------------------------------------------------------
// The problem document, API_CONTRACT sections 1 and 2
// -----------------------------------------------------------------------------

test('an unknown path answers an RFC 9457 problem document and not Fastifys default', async () => {
  const { app } = buildServer({ surface: 'public', modules: onDisk });
  const res = await app.inject({ method: 'GET', url: `${BASE_PATH}/nothing-here` });
  expect(res.statusCode).toBe(404);
  const body = res.json() as Record<string, unknown>;
  expect(Object.keys(body).sort()).toStrictEqual(['code', 'instance', 'status', 'title', 'type']);
  // Fastify's default 404 body carries the framework's own keys and echoes the
  // route back. None of the three may appear.
  expect(body).not.toHaveProperty('message');
  expect(body).not.toHaveProperty('error');
  expect(body).not.toHaveProperty('statusCode');
  expect(JSON.stringify(body)).not.toContain('nothing-here');
  expect(typeof body['instance']).toBe('string');
  await app.close();
});

test('a method the path does not serve is a problem document too', async () => {
  const { app } = buildServer({ surface: 'public', modules: onDisk });
  const res = await app.inject({ method: 'POST', url: `${BASE_PATH}${LIVENESS_PATH}` });
  expect(res.headers['content-type']).toContain(PROBLEM_MEDIA_TYPE);
  expect((res.json() as { code: string }).code).toBe('not_found');
  await app.close();
});

// API_CONTRACT section 1: "In production `/docs`, `/openapi.json`, and
// `/swagger` return 404". Nothing registers them, so this is already true; it
// is asserted so that a later slice adding a generator has to see this line.
test('the OpenAPI paths are 404 because nothing registers them', async () => {
  const { app } = buildServer({ surface: 'public', modules: onDisk });
  for (const url of ['/docs', '/openapi.json', '/swagger', `${BASE_PATH}/docs`]) {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(404);
  }
  await app.close();
});
