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
// The temptation is real and it has a document behind it: INFRA section 2 names
// the Railway service `portal-api`, INFRA section 13.2 puts "portal and API" on
// one origin, and OVERVIEW section 7's application zone reads "API + portal +
// site". Every one of those is about DEPLOYMENT topology, and none of them is
// about who owns the endpoint.
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
// NO ROUTE IMPLEMENTS A BEHAVIOUR AND THAT IS NOT AN OVERSIGHT. This session's
// fence holds no `packages/db`, `ScopedDb` is an interface with one field whose
// own header states that neither the client nor the accessor exists, and the
// workspace declares zero runtime dependencies. A handler written here today
// would have nothing to read and nothing to write. So this is the shape the
// four existing apps landed in: real structure, no wiring, and the difference
// visible in the types rather than left to a reader.
//
// What IS real is `surface.ts`, and it is real because it is the half of
// ADR-083 that is structural rather than a preference. The route set a process
// registers is chosen at startup, so the public deployment answers 404 for
// `/internal/*` by having nothing there, which is what API_CONTRACT section
// 12's matrix requires and what no per-request check reliably produces.
//
// THE FRAMEWORK IS FASTIFY 5 AND IT IS NOT INSTALLED HERE. ADR-083 section 5
// rules it and measures the three properties the choice rests on; the version
// belongs in `pnpm-workspace.yaml`'s `catalog:` block, which this session does
// not hold. A manifest that declared `fastify` against a catalog entry that
// does not exist would not install, so the ruling lands here and the dependency
// lands with the session that holds the catalog.
// =============================================================================

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

import { SERVICE_BY_SURFACE, SURFACE_VAR, resolveSurface } from './surface.js';
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
 * Still not a server: the framework is ruled and not installed, and no route
 * exists to register.
 *
 * It resolves the surface anyway, because the surface is the one thing a
 * misconfigured deployment must fail on rather than guess at.
 */
export function main(env: Environment = process.env): void {
  const surface = resolveSurface(env);
  console.log(
    `merit ${SERVICE_BY_SURFACE[surface]}: ${surface} surface selected by ${SURFACE_VAR}, no routes yet`,
  );
}
