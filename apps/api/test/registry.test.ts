import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import Fastify from 'fastify';
import { describe, expect, test } from 'vitest';

import {
  BASE_PATH,
  LIVENESS_PATH,
  ROUTE_MODULE_DIR,
  RouteRegistryError,
  compose,
  defineRoutes,
  discoverRouteModules,
} from '../src/index.ts';
import type { RouteModule } from '../src/index.ts';

// CI-02, the `unit` project.
//
// WHAT THIS SUITE IS FOR. `registry.ts` buys back, by hand, the three
// properties a hand-written route array would have given for free, and every
// one of the three is a run-time check rather than a type. A suite that only
// asserted the happy path would report a registry that composes and say nothing
// about the checks that are the reason the shape is affordable at all. So each
// refusal is watched refusing.

const ok = () => ({ ok: true });

const mod = (name: string, routes: RouteModule['routes']): RouteModule => ({ name, routes });

// -----------------------------------------------------------------------------
// defineRoutes: the module's own shape, checked in the module's own file
// -----------------------------------------------------------------------------

describe('defineRoutes refuses a module that would compose and mean nothing', () => {
  test('a module contributing no route', () => {
    expect(() => defineRoutes(mod('empty', []))).toThrow(RouteRegistryError);
    expect(() => defineRoutes(mod('empty', []))).toThrow(/declares no route/);
  });

  test('a name that is not a filename stem', () => {
    expect(() =>
      defineRoutes(mod('Kyc', [{ method: 'GET', path: '/kyc/status', handler: ok }])),
    ).toThrow(/is not a route module name/);
    expect(() =>
      defineRoutes(mod('', [{ method: 'GET', path: '/kyc/status', handler: ok }])),
    ).toThrow(/is not a route module name/);
  });

  test('the same METHOD and path twice inside one module', () => {
    expect(() =>
      defineRoutes(
        mod('kyc', [
          { method: 'GET', path: '/kyc/status', handler: ok },
          { method: 'GET', path: '/kyc/status', handler: ok },
        ]),
      ),
    ).toThrow(/declares `GET \/kyc\/status` twice/);
  });

  // THE FOOTGUN surface.ts EXISTS FOR, REACHED THROUGH THE REGISTRY. A module
  // that helpfully prefixed the base path would declare `/api/v1/internal/jobs`,
  // which the prefix rule classifies PUBLIC because it reads `/api`. That is an
  // operator route on the public surface with nothing reporting it, so the
  // registry refuses the declaration rather than the request.
  test('a path carrying the base path', () => {
    expect(() =>
      defineRoutes(
        mod('jobs', [{ method: 'GET', path: `${BASE_PATH}/internal/jobs`, handler: ok }]),
      ),
    ).toThrow(/carries the base path/);
  });

  test('a path with no leading slash', () => {
    expect(() =>
      defineRoutes(mod('jobs', [{ method: 'GET', path: 'internal/jobs', handler: ok }])),
    ).toThrow(/is not a contract path/);
  });

  test('a well-formed module is returned unchanged', () => {
    const m = mod('kyc', [{ method: 'POST', path: '/kyc/session', handler: ok }]);
    expect(defineRoutes(m)).toBe(m);
  });
});

// -----------------------------------------------------------------------------
// compose: the collisions thirteen concurrent slices make likely
// -----------------------------------------------------------------------------

describe('compose refuses the collisions a hand-written route array would have merged', () => {
  test('two modules declaring the same METHOD and path', () => {
    const app = Fastify();
    expect(() =>
      compose(app, 'public', [
        defineRoutes(mod('kyc', [{ method: 'GET', path: '/kyc/status', handler: ok }])),
        defineRoutes(mod('kyc-status', [{ method: 'GET', path: '/kyc/status', handler: ok }])),
      ]),
    ).toThrow(/both declare `GET \/kyc\/status`/);
  });

  test('two modules with the same name', () => {
    const app = Fastify();
    expect(() =>
      compose(app, 'public', [
        defineRoutes(mod('kyc', [{ method: 'GET', path: '/kyc/status', handler: ok }])),
        defineRoutes(mod('kyc', [{ method: 'POST', path: '/kyc/session', handler: ok }])),
      ]),
    ).toThrow(/two route modules are named `kyc`/);
  });

  // Rule 2, one level up from defineRoutes': a server composed from nothing
  // reports a successful startup and answers 404 for the entire contract.
  test('no module at all', () => {
    const app = Fastify();
    expect(() => compose(app, 'public', [])).toThrow(/no route module was composed/);
  });

  // The same collision reached the OTHER way: a duplicate is a defect even when
  // this surface would register neither copy, so the check runs before the
  // surface filter rather than after it.
  test('a duplicate is refused even when neither copy is served here', () => {
    const app = Fastify();
    expect(() =>
      compose(app, 'public', [
        defineRoutes(mod('jobs', [{ method: 'GET', path: '/internal/jobs', handler: ok }])),
        defineRoutes(mod('ops-jobs', [{ method: 'GET', path: '/internal/jobs', handler: ok }])),
      ]),
    ).toThrow(/both declare `GET \/internal\/jobs`/);
  });
});

// -----------------------------------------------------------------------------
// The surface filter, ADR-083 section 4, at the registration seam
// -----------------------------------------------------------------------------

describe('the path decides which deployment registers a route, and the module never does', () => {
  const modules = [
    defineRoutes(mod('health', [{ method: 'GET', path: LIVENESS_PATH, handler: ok }])),
    defineRoutes(mod('kyc', [{ method: 'POST', path: '/kyc/session', handler: ok }])),
    defineRoutes(
      mod('ops', [
        { method: 'GET', path: '/internal/jobs', handler: ok },
        { method: 'GET', path: '/admin/liability', handler: ok },
      ]),
    ),
  ];

  test('the public deployment registers neither operator route', () => {
    const report = compose(Fastify(), 'public', modules);
    expect(report.registered).toStrictEqual(['GET /health', 'POST /kyc/session']);
    expect(report.withheld).toStrictEqual(['GET /internal/jobs', 'GET /admin/liability']);
  });

  test('the operator deployment registers neither public route, and keeps liveness', () => {
    const report = compose(Fastify(), 'operator', modules);
    expect(report.registered).toStrictEqual([
      'GET /health',
      'GET /internal/jobs',
      'GET /admin/liability',
    ]);
    expect(report.withheld).toStrictEqual(['POST /kyc/session']);
  });

  // Every declared route lands in exactly one of the two lists on either
  // surface. A route that fell out of both would be a path nothing serves and
  // nothing reports.
  test('every declared route is either registered or withheld, on both surfaces', () => {
    const declared = modules.flatMap((m) => m.routes.map((r) => `${r.method} ${r.path}`));
    for (const surface of ['public', 'operator'] as const) {
      const report = compose(Fastify(), surface, modules);
      expect([...report.registered, ...report.withheld].sort()).toStrictEqual([...declared].sort());
    }
  });
});

// -----------------------------------------------------------------------------
// Discovery: the directory listing IS the module list
// -----------------------------------------------------------------------------

describe('discoverRouteModules reads the directory and validates what it finds', () => {
  test('it finds every `.ts` file in src/routes and nothing else', async () => {
    // THE SORT IS ON THE FILENAME AND THE STRIP COMES AFTER IT, which is the
    // order `discoverRouteModules` produces: it sorts `readdir`'s output and
    // strips `.ts` per file as it imports. Stripping first sorts a DIFFERENT
    // set of strings, and the two agree only while no module's stem is a prefix
    // of another's -- `'-'` is 0x2D and `'.'` is 0x2E, so `wallet-withdrawals`
    // sorts BEFORE `wallet` by filename and AFTER it by stem. Session 303 found
    // that by adding `wallet-withdrawals.ts` beside `wallet.ts`, and repaired
    // the derivation rather than renaming a module the contract's own path
    // names. The assertion itself is unchanged: this is still an equality
    // against the directory, and the directory is still the module list.
    const onDisk = readdirSync(ROUTE_MODULE_DIR)
      .filter((f) => f.endsWith('.ts'))
      .sort()
      .map((f) => f.slice(0, -'.ts'.length));
    const modules = await discoverRouteModules();
    // THE ASSERTION IS AN EQUALITY AND NOT A COUNT, and it is the whole reason
    // this registry can be a directory listing: a module added by any future
    // slice appears here with no line of this file changing, and a module that
    // failed to load throws before this comparison rather than shrinking it.
    expect(modules.map((m) => m.name)).toStrictEqual(onDisk);
    expect(modules.length).toBeGreaterThan(0);
  });

  // `apps/api` itself holds `package.json` and `tsconfig.json` and no `.ts`
  // file at its top level, so it is a real empty-of-modules directory rather
  // than a fixture. `src/` is deliberately NOT used here: it holds `start.ts`,
  // whose import starts a server, which is exactly why the machinery lives
  // there and the modules do not.
  test('a directory holding no module is refused rather than composed', async () => {
    const appRoot = join(ROUTE_MODULE_DIR, '..', '..');
    expect(readdirSync(appRoot).filter((f) => f.endsWith('.ts'))).toStrictEqual([]);
    await expect(discoverRouteModules(appRoot)).rejects.toThrow(/holds no `\.ts` file/);
  });
});
