// =============================================================================
// apps/api/src/registry.ts
// =============================================================================
// A MODULE CONTRIBUTES ITS ROUTES AS A UNIT AND THE SERVER COMPOSES THEM. THE
// SERVER OWNS NO LIST OF ROUTES AND NO LIST OF MODULES.
//
// -----------------------------------------------------------------------------
// WHY THIS SHAPE, AND WHAT THE ALTERNATIVE COSTS
// -----------------------------------------------------------------------------
// P4's `P4-d` row states the consequence in its money column: "the registry's
// SHAPE decides whether M19's seven route slices serialize". Session 168's
// collision table states it in the direction that fails:
//
//   "`M19-1` must create a registry that is per-module rather than one array,
//    or these seven serialize."
//
// The obvious registry is an array in one file that every route module is
// imported into. It is greppable and it is wrong here, because it makes the
// file it lives in a write collision for every slice that adds a route.
// `M19-2`, `M19-3`, `M19-6`, `M19-7`, `M19-8`, `M19-9` and `M19-11` each add a
// file under `routes/`, and `P4-f`, `M03`'s two, `M05`'s two and `M16`'s three
// are behind them. Under an array, thirteen branches each add one import line
// and one element in the same two places in one file: each merges cleanly
// alone and none of them together. That is `pnpm-lock.yaml`'s lesson in P3
// wave 1 and P4 section 9 rows it as SERIAL three ways for exactly this reason.
//
// SO THE MODULE LIST IS THE DIRECTORY LISTING AND IS NEVER WRITTEN DOWN.
// `discoverRouteModules` reads `src/routes/`, imports every `.ts` file in it in
// sorted order and validates what comes back. A slice that adds a route adds
// ONE NEW FILE and edits nothing that any other slice edits, so thirteen
// branches touch thirteen disjoint paths and merge in any order.
//
// This is the same refusal `repo-invariants.mjs` makes when it seeds itself
// from the migration directory rather than from a hand list, and the same one
// `pnpm-workspace.yaml`'s catalog makes about versions: a hand-maintained list
// that restates a directory drifts, and it drifts silently. The array's own
// failure mode is the loud version of that: a module writes `routes/kyc.ts`,
// forgets the import line, and the route does not exist with nothing saying so.
// A directory listing cannot have that failure.
//
// -----------------------------------------------------------------------------
// WHAT DISCOVERY COSTS, AND WHAT IS BOUGHT BACK
// -----------------------------------------------------------------------------
// An array is checked by `tsc`. A directory listing is not, so three properties
// an array gives away free are bought back deliberately here rather than
// assumed:
//
//   1. THE SHAPE IS TYPE-CHECKED AT THE DEFINITION SITE. Every module writes
//      `export default defineRoutes({...})`, and `defineRoutes` is typed
//      `(m: RouteModule) => RouteModule`, so `tsc --noEmit` reports a malformed
//      module IN THE MODULE'S OWN FILE. That is strictly better than an array,
//      where the error surfaces at the import site instead.
//   2. NOTHING IN THE DIRECTORY IS SILENTLY IGNORED. `discoverRouteModules`
//      THROWS on any `.ts` file under `routes/` that does not default-export a
//      valid module, and on any module whose `name` is not its filename stem.
//      A half-written route file fails the process at startup rather than
//      quietly not existing.
//   3. THE COLLISION AN ARRAY NEVER CAUGHT IS CAUGHT HERE. Two concurrent
//      slices declaring the same method and path is the defect thirteen
//      branches make likely, and an array would have merged both. `compose`
//      refuses a duplicate `METHOD /path` across the whole module set, and a
//      duplicate module name with it.
//
// -----------------------------------------------------------------------------
// THE SURFACE FILTER IS THE PATH'S DECISION AND NEVER THE MODULE'S
// -----------------------------------------------------------------------------
// ADR-083 section 4: a process serves exactly one surface, chosen at startup,
// and the public deployment answers 404 for `/internal/*` BY HAVING NOTHING
// THERE. So `compose` classifies every declared path with `surface.ts`'s
// `classifyPath` and registers only what this surface serves. A module cannot
// declare which surface it belongs to and there is deliberately no field for
// it: the contract already put the answer in the path, and a second place to
// say it is a second place to get it wrong.
//
// WHAT IS WITHHELD IS NOT REFUSED AT REQUEST TIME. It is never registered, so
// the 404 is the router's. `surfaceServes` returning false is not a permission
// check and must never become one; that is the whole distinction ADR-083 rests
// on, 403 being what a check returns and 404 being what an absent route
// returns.
// =============================================================================

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { BASE_PATH, classifyPath, surfaceServes } from './surface.ts';
import type { ApiSurface } from './surface.ts';

/** Thrown when a module, or the composed set, is not well formed. */
export class RouteRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RouteRegistryError';
  }
}

/**
 * The verbs API_CONTRACT uses, and no others.
 *
 * Closed for `surface.ts`'s reason for closing `API_SURFACES`: a verb this
 * contract does not use is a ruling and not a value. `HEAD` and `OPTIONS` are
 * absent because Fastify answers both from the routes that are registered.
 */
export const HTTP_METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const;

/** One of {@link HTTP_METHODS}. */
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** A handler is a function over the request. The framework is the adapter. */
export type RouteHandler = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<unknown> | unknown;

/**
 * One endpoint, as API_CONTRACT writes it.
 *
 * `path` carries NO base path, for `surface.ts`'s stated reason: the base path
 * is one string in one place, and a path that carries its own copy classifies
 * `/api/v1/internal/jobs` as public. `assertContractPath` inside `classifyPath`
 * refuses it, so a module that prefixes its own base path fails at startup
 * rather than serving an operator route on the public origin.
 */
export interface RouteDefinition {
  readonly method: HttpMethod;
  readonly path: string;
  readonly handler: RouteHandler;
}

/**
 * A module's whole contribution, which is the unit the server composes.
 *
 * `name` must equal the module file's stem. It is not decoration: it is what
 * every error below names, and checking it is what makes a copied file that
 * kept the original's name a startup failure rather than a duplicate-path
 * mystery.
 */
export interface RouteModule {
  readonly name: string;
  readonly routes: readonly RouteDefinition[];
}

/** Module names are lowercase, digits and hyphens: the filename stem's alphabet. */
const MODULE_NAME = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Declare a module's routes.
 *
 * IT RETURNS ITS ARGUMENT AND THE TYPE ANNOTATION IS THE WHOLE POINT. This is
 * where `tsc --noEmit` reads the shape, in the module author's own file, which
 * is the property discovery would otherwise cost. It also validates at run time,
 * because a type is erased before the process starts and the file this module
 * lives in was found on disk rather than imported by name.
 */
export function defineRoutes(module: RouteModule): RouteModule {
  if (!MODULE_NAME.test(module.name))
    throw new RouteRegistryError(
      `\`${module.name}\` is not a route module name. It must be the module file's stem, ` +
        'which is lowercase letters, digits and hyphens',
    );
  // Rule 2, as this repository's checks state it everywhere: a module
  // contributing no route is a file whose every assertion below holds
  // vacuously, and it is the shape a half-written slice lands in.
  if (module.routes.length === 0)
    throw new RouteRegistryError(
      `route module \`${module.name}\` declares no route. A module that contributes nothing is ` +
        'a file the server would compose and report as composed',
    );

  const seen = new Set<string>();
  for (const route of module.routes) {
    if (!HTTP_METHODS.includes(route.method))
      throw new RouteRegistryError(
        `route module \`${module.name}\` declares method \`${String(route.method)}\` for ` +
          `\`${route.path}\`, which is not one of ${HTTP_METHODS.join(' | ')}`,
      );
    // Throws on a path that is not a contract path, or that carries BASE_PATH.
    classifyPath(route.path);
    const key = `${route.method} ${route.path}`;
    if (seen.has(key))
      throw new RouteRegistryError(
        `route module \`${module.name}\` declares \`${key}\` twice. The second declaration ` +
          'would replace the first with nothing reporting it',
      );
    seen.add(key);
  }
  return module;
}

/** What `compose` did, so a caller can assert on it and a process can log it. */
export interface CompositionReport {
  /** The surface these routes were composed for. */
  readonly surface: ApiSurface;
  /** Module names, in the order they were composed. */
  readonly modules: readonly string[];
  /** `METHOD /path`, registered on this surface. */
  readonly registered: readonly string[];
  /**
   * `METHOD /path`, declared by a module and NOT registered, because this
   * surface does not serve the path.
   *
   * THE PUBLIC DEPLOYMENT'S 404 IS THIS LIST BEING NON-EMPTY AND NOTHING ELSE.
   * The route was never registered, so the router has nothing to answer with.
   */
  readonly withheld: readonly string[];
}

/**
 * Register every route the surface serves, and no others.
 *
 * @param app the Fastify instance to register on.
 * @param surface the surface this process is, from `resolveSurface`.
 * @param modules every module, in the order they are to be composed.
 */
export function compose(
  app: FastifyInstance,
  surface: ApiSurface,
  modules: readonly RouteModule[],
): CompositionReport {
  // Rule 2 again, one level up: a server composed from no module would report
  // an empty registration as a successful one, and that is what a discovery
  // that read the wrong directory produces.
  if (modules.length === 0)
    throw new RouteRegistryError(
      'no route module was composed. A server with no route reports a successful startup and ' +
        'answers 404 for the whole contract, which is indistinguishable from a working ' +
        'operator deployment',
    );

  const byName = new Set<string>();
  const byEndpoint = new Map<string, string>();
  const registered: string[] = [];
  const withheld: string[] = [];

  for (const module of modules) {
    // Re-validated rather than trusted. `discoverRouteModules` calls this
    // through the module's own `defineRoutes`, but `compose` is also called
    // directly by tests and by any future caller that assembles a list, and a
    // check that only runs on one of two paths is a check with a way around it.
    defineRoutes(module);

    if (byName.has(module.name))
      throw new RouteRegistryError(
        `two route modules are named \`${module.name}\`. A module name is how every message ` +
          'here identifies a file, and two files answering to one name make each of them unnameable',
      );
    byName.add(module.name);

    for (const route of module.routes) {
      const endpoint = `${route.method} ${route.path}`;
      const owner = byEndpoint.get(endpoint);
      if (owner !== undefined)
        throw new RouteRegistryError(
          `route modules \`${owner}\` and \`${module.name}\` both declare \`${endpoint}\`. ` +
            'This is the collision concurrent route slices make likely and the one a hand-written ' +
            'route array would have merged without noticing: Fastify refuses the second ' +
            'registration, so the surviving handler is whichever file sorted first',
        );
      byEndpoint.set(endpoint, module.name);

      // THE PATH DECIDES, NOT THE MODULE. ADR-083 section 4.
      if (!surfaceServes(surface, route.path)) {
        withheld.push(endpoint);
        continue;
      }
      app.route({ method: route.method, url: `${BASE_PATH}${route.path}`, handler: route.handler });
      registered.push(endpoint);
    }
  }

  return {
    surface,
    modules: modules.map((m) => m.name),
    registered,
    withheld,
  };
}

/**
 * The directory every route module lives in, and the ONLY thing that decides
 * what a deployment can serve.
 *
 * Relative to this file rather than to the process's working directory, so
 * `pnpm start` from anywhere finds the same set.
 */
export const ROUTE_MODULE_DIR = join(import.meta.dirname, 'routes');

/**
 * Every route module on disk, in filename order.
 *
 * THE ORDER IS SORTED AND NOT THE DIRECTORY'S. `readdir` order is a filesystem
 * fact, so an unsorted composition would make `compose`'s duplicate-endpoint
 * message name a different file on a different machine.
 *
 * NOTHING IS SKIPPED AND THERE IS NO EXCLUSION LIST. Every `.ts` file in
 * `routes/` is a route module; the registry machinery lives here in `src/`
 * precisely so that the rule is total. An exclusion list would be the
 * hand-maintained list this whole design refuses, one directory over.
 */
export async function discoverRouteModules(
  dir: string = ROUTE_MODULE_DIR,
): Promise<readonly RouteModule[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.ts')).sort();
  if (files.length === 0)
    throw new RouteRegistryError(
      `${dir} holds no \`.ts\` file. A discovery that finds nothing composes nothing, and ` +
        '`compose` refuses that rather than starting a server that answers 404 for the ' +
        'whole contract',
    );

  const modules: RouteModule[] = [];
  for (const file of files) {
    const stem = file.slice(0, -'.ts'.length);
    const imported: unknown = await import(pathToFileURL(join(dir, file)).href);
    const value = (imported as { default?: unknown }).default;
    if (value === null || typeof value !== 'object')
      throw new RouteRegistryError(
        `${file} is in ${dir} and does not default-export a route module. Every \`.ts\` file ` +
          'in that directory is one; there is no exclusion list, because a list of files that ' +
          'are not routes is the hand-maintained list this registry exists to avoid',
      );
    const module = value as RouteModule;
    if (module.name !== stem)
      throw new RouteRegistryError(
        `${file} declares a module named \`${String(module.name)}\`. A module's name is its ` +
          "file's stem, so this is a copied file that kept the original's name, and the two " +
          'would collide under a name naming neither',
      );
    // Validates the module against a type that no longer exists at run time.
    modules.push(defineRoutes(module));
  }
  return modules;
}
