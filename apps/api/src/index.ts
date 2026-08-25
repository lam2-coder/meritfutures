// =============================================================================
// apps/api
// =============================================================================
// The `/api/v1` surface API_CONTRACT specifies, and the container OVERVIEW
// section 2 has drawn since 2026-08-13 without section 3 ever rowing it.
// ADR-083 is that ruling; this file is the deployable it creates.
//
// -----------------------------------------------------------------------------
// WHY THIS IS ITS OWN DEPLOYABLE AND NOT A SERVER INSIDE apps/portal
// -----------------------------------------------------------------------------
// The temptation is real and it had three documents behind it. INFRA section 2
// named one Railway service `portal-api`; ADR-089 retired that name as the very
// fusion this file refuses, and 2.1 rows `portal` and `api` apart. The other two
// still read that way: 13.2 puts "portal and API" on one origin, OVERVIEW 7's
// zone reads "API + portal + site". Both DEPLOYMENT topology, neither ownership.
//
// THE SENTENCE THAT DECIDES IT is API_CONTRACT section 1: "The portal, admin
// console, and site are the first clients of this API and have NO PRIVILEGED
// BACK DOOR: anything the UI can do, it does through these endpoints." A portal
// that CONTAINS the API has a privileged back door by construction, because a
// handler in the same package is an import away, and the guarantee degrades
// from a boundary into a habit. M04 section 4 states the same thing from the
// portal's side -- "M4 owns no endpoint" -- and `apps/portal/src/api/types.ts`
// is already a client's TRANSCRIPTION of the wire types rather than the types
// themselves, checked against the contract by `api-types.test.ts`.
//
// The diagram says it a third way. OVERVIEW section 2 draws THREE arrows into
// this container, `Site --> API`, `Portal --> API` and `Admin --> API`, and
// `RI-04` forbids an app depending on an app. An API living inside any one
// deployable makes the other two arrows unimplementable.
//
// -----------------------------------------------------------------------------
// WHAT IS HERE, AND WHAT SHAPE IT IS IN
// -----------------------------------------------------------------------------
// THIS DEPLOYABLE NOW SERVES. Session 144 landed it as a shell, and its header
// said why in the tense that was true then: "NO ROUTE IMPLEMENTS A BEHAVIOUR
// AND THAT IS NOT AN OVERSIGHT", because the framework was ruled and not
// installed and no handler had anything to read. ADR-100 admits Fastify into
// the catalog and builds the registry, and `GET /health` is registered and
// answers, so that paragraph is replaced rather than kept beside a tree that
// refutes it.
//
// WHAT IS STILL ABSENT IS EVERY ROUTE THAT READS OR WRITES. `packages/db`'s
// accessor is not wired here, so the one route this deployable serves is the
// one API_CONTRACT section 9 specifies as returning a constant. That is
// deliberate rather than partial: it is the smallest route that makes the
// registry a thing that runs instead of a thing that type-checks, and it is the
// only endpoint in the whole contract that needs no data to be correct.
//
// `surface.ts` is the half of ADR-083 that is structural: the route set a
// process registers is chosen at startup, so the public deployment answers 404
// for `/internal/*` by having nothing there. `registry.ts` is the half that
// decides whether the slices behind this one can run at once, and its header is
// where that argument lives.
// =============================================================================

export {
  compose,
  defineRoutes,
  discoverRouteModules,
  HTTP_METHODS,
  ROUTE_MODULE_DIR,
  RouteRegistryError,
} from './registry.js';
export type {
  CompositionReport,
  HttpMethod,
  RouteDefinition,
  RouteHandler,
  RouteModule,
} from './registry.js';
export { buildServer, problem, PROBLEM_MEDIA_TYPE, PROBLEM_TYPE_PREFIX } from './server.js';
export type { BuiltServer, Problem, ServerOptions } from './server.js';
export {
  API_SURFACES,
  BASE_PATH,
  LIVENESS_PATH,
  OPERATOR_PREFIXES,
  SERVICE_BY_SURFACE,
  SURFACE_VAR,
  SurfaceError,
  classifyPath,
  resolveSurface,
  surfaceServes,
} from './surface.js';
export type { ApiSurface, Environment, PathClass } from './surface.js';

import type { FastifyInstance } from 'fastify';

import { discoverRouteModules } from './registry.js';
import { buildServer } from './server.js';
import { SERVICE_BY_SURFACE, SurfaceError, resolveSurface } from './surface.js';
import type { Environment } from './surface.js';

/**
 * The Railway services this app deploys as, one per surface.
 *
 * The other four deployables export a single `SERVICE` constant. This one
 * cannot, and the reason is the ruling: one codebase, two deployments, and the
 * service is a fact about the deployment rather than about the package.
 */
export const SERVICES = Object.values(SERVICE_BY_SURFACE);

/**
 * The port to listen on.
 *
 * A DEFAULT IS SAFE HERE WHERE `MERIT_API_SURFACE`'S IS NOT, and the difference
 * is which direction a wrong value fails in. An unset surface decides whether
 * `/internal/*` is reachable and fails silently either way, so `resolveSurface`
 * refuses to guess. An unset port decides nothing about what is served: a wrong
 * one is unreachable within a second of the deploy, by everything at once.
 * Railway sets `PORT`.
 */
export const PORT_VAR = 'PORT';

/** Used when {@link PORT_VAR} is unset. */
export const DEFAULT_PORT = 3000;

/**
 * Start the process.
 *
 * The order is the ruling's. The surface is resolved FIRST, so a deployment
 * that has not been configured fails before anything is read off disk; then the
 * modules are discovered; then the server composes exactly what this surface
 * serves. Nothing listens until all three have succeeded.
 */
export async function main(env: Environment = process.env): Promise<FastifyInstance> {
  const surface = resolveSurface(env);
  const modules = await discoverRouteModules();
  const { app, report } = buildServer({ surface, modules, logger: true });

  const raw = env[PORT_VAR];
  const port = raw === undefined || raw.trim() === '' ? DEFAULT_PORT : Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new SurfaceError(
      `${PORT_VAR} is \`${String(raw)}\`, which is not a TCP port. Leave it unset to take ` +
        `${String(DEFAULT_PORT)}`,
    );

  await app.listen({ port, host: '0.0.0.0' });

  // THE WITHHELD COUNT IS THE LINE THAT MATTERS AND IT IS PRINTED ON PURPOSE.
  // ADR-083's 404 is produced by routes that were declared and never
  // registered, and the only evidence a running public deployment can offer
  // that the mechanism is live is that this number is not zero once an operator
  // module exists.
  app.log.info(
    {
      service: SERVICE_BY_SURFACE[surface],
      surface,
      modules: report.modules,
      registered: report.registered,
      withheld: report.withheld,
    },
    `merit ${SERVICE_BY_SURFACE[surface]}: ${String(report.registered.length)} route(s) ` +
      `registered, ${String(report.withheld.length)} withheld from this surface`,
  );
  return app;
}
