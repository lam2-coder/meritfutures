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
// THE PARAGRAPH THAT STOOD HERE SAID THE PLAIN-NODE RUNTIME COULD NOT RUN, AND
// IT CAN. It recorded that `pnpm --filter @merit/api start` died because every
// module under `apps/api/src` wrote `./x.js` specifiers against `x.ts`. BOTH
// HALVES OF THE REPAIR LANDED (the specifiers, and `allowImportingTsExtensions`
// in `tsconfig.base.json`), `RI-10` now asserts the first over every
// deployable's shipped source, and `start.ts`'s own header replaced the same
// stale claim on the same evidence. Session 255 ran the process on both
// surfaces to measure this suite's subject over a real socket, so the finding is
// replaced rather than left beside a tree that refutes it.
//
// WHAT NEITHER SUITE COVERS IS STILL WORTH NAMING: `main()` reads the
// environment and binds a port, and this suite calls `buildServer` and
// `listen` directly. `resolveSurface` and the port parse are `listen`-adjacent
// and are asserted in `surface.test.ts` rather than here.

/**
 * A synthetic operator module, on `server.test.ts`'s stated reason and with its
 * path.
 *
 * IT USED TO BORROW API_CONTRACT SECTION 9's QUEUE-DEPTH ROW. Session 255's
 * `routes/internal.ts` now declares that row for real, `compose` refuses a
 * duplicate `METHOD /path`, and this suite's subject is the MECHANISM rather
 * than any endpoint: what it needs is an operator-classified path that no
 * contract row will ever spell, so the two cannot collide again.
 */
const OPS_PATH = '/internal/never-a-contract-row';

const ops = defineRoutes({
  name: 'ops',
  routes: [{ method: 'GET', path: OPS_PATH, handler: () => ({ depth: 0 }) }],
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
  const path = `${BASE_PATH}${OPS_PATH}`;

  const refused = await fetch(`${origins['public'] ?? ''}${path}`);
  expect(refused.status).toBe(404);
  expect(refused.headers.get('content-type')).toContain(PROBLEM_MEDIA_TYPE);
  expect(await refused.json()).toMatchObject({ status: 404, code: 'not_found' });

  const served = await fetch(`${origins['operator'] ?? ''}${path}`);
  expect(served.status).toBe(200);
  expect(await served.json()).toStrictEqual({ depth: 0 });
});
