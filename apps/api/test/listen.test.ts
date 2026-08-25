import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, expect, test } from 'vitest';

import {
  BASE_PATH,
  LIVENESS_PATH,
  PROBLEM_MEDIA_TYPE,
  buildServer,
  defineRoutes,
  discoverRouteModules,
} from '../src/index.ts';
import type { FastifyInstance } from 'fastify';

// CI-02, the `unit` project.
//
// WHAT THIS SUITE IS FOR, AND WHY IT IS SEPARATE FROM server.test.ts.
// `server.test.ts` asserts through `inject`, which is light-my-request feeding
// Fastify's own pipeline: real routing, real handlers, NO SOCKET. This suite
// binds a real listener and issues real `fetch` requests over TCP, so every
// status code below came off the wire.
//
// THE ONE THING NEITHER SUITE COVERS IS THE PLAIN-NODE RUNTIME, and it is
// reported rather than papered over. `pnpm --filter @merit/api start` cannot run
// today: `node --experimental-strip-types` requires an import specifier to name
// the file that exists, and every module under `apps/api/src` writes `./x.js`
// against `x.ts`. That is not this deployable's defect alone -- `apps/admin` and
// `apps/worker` declare the same start script and fail the same way on their own
// first relative import -- and the repair needs `allowImportingTsExtensions` in
// a `tsconfig.json` that is outside session 209's fence. Session 209's log and
// pull request carry the measurement.

const ops = defineRoutes({
  name: 'ops',
  routes: [{ method: 'GET', path: '/internal/jobs', handler: () => ({ depth: 0 }) }],
});

/** `{ public: origin, operator: origin }`, each on an ephemeral port. */
const origins: Record<string, string> = {};
const servers: FastifyInstance[] = [];

beforeAll(async () => {
  const modules = [...(await discoverRouteModules()), ops];
  for (const surface of ['public', 'operator'] as const) {
    const { app } = buildServer({ surface, modules });
    // Port 0 is the kernel's "any free port". A fixed port would make this
    // suite fail on a machine that happens to be running something.
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address() as AddressInfo;
    origins[surface] = `http://127.0.0.1:${String(address.port)}`;
    servers.push(app);
  }
});

afterAll(async () => {
  await Promise.all(servers.map((app) => app.close()));
});

test('a real request to the public origin gets 200 and the contracts body', async () => {
  const res = await fetch(`${origins['public'] ?? ''}${BASE_PATH}${LIVENESS_PATH}`);
  expect(res.status).toBe(200);
  expect(await res.json()).toStrictEqual({ status: 'ok' });
});

test('a real request to the operator origin gets 200 for liveness too', async () => {
  const res = await fetch(`${origins['operator'] ?? ''}${BASE_PATH}${LIVENESS_PATH}`);
  expect(res.status).toBe(200);
  expect(await res.json()).toStrictEqual({ status: 'ok' });
});

// API_CONTRACT section 12's matrix, over a socket. The two origins run the SAME
// module set and answer differently, and the difference is which routes each
// registered at startup.
test('one path, two origins: 404 on public and 200 on operator', async () => {
  const path = `${BASE_PATH}/internal/jobs`;

  const refused = await fetch(`${origins['public'] ?? ''}${path}`);
  expect(refused.status).toBe(404);
  expect(refused.headers.get('content-type')).toContain(PROBLEM_MEDIA_TYPE);
  expect(await refused.json()).toMatchObject({ status: 404, code: 'not_found' });

  const served = await fetch(`${origins['operator'] ?? ''}${path}`);
  expect(served.status).toBe(200);
  expect(await served.json()).toStrictEqual({ depth: 0 });
});
