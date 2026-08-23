// =============================================================================
// apps/api/src/surface.ts
// =============================================================================
// ONE CODEBASE, TWO SURFACES, AND A PROCESS SERVES EXACTLY ONE (ADR-083).
//
// API_CONTRACT is one contract: one base path, one error model, one idempotency
// rule, one pagination rule, one OpenAPI generator. Its sections 8 and 9 are
// headed "admin origin only", and its section 12 matrix requires a trader
// session calling `/internal/*` from the public origin to get **404** rather
// than 403. Those two facts pull in opposite directions for any implementation
// that puts the whole contract in one running process:
//
//   403 is what a permission check returns. 404 is what an ABSENT ROUTE
//   returns. A process that never registered a path cannot answer 403 for it,
//   and a process that registered it cannot be relied on to answer 404.
//
// So the route set is chosen at STARTUP and not per request. The public
// deployment registers no operator path, and its 404 is the router's, produced
// by there being nothing there. That is the same argument P1 section 2.1 makes
// about the admin console -- "it silently converts a security control into a
// URL convention" -- carried to the seam where the API meets it, and the reason
// the answer here is a second DEPLOYMENT rather than a second CODEBASE is that
// a second codebase would be a second transcription of the error model, the
// idempotency rule and the pagination rule. `apps/site`'s own manifest already
// records what a second transcription costs.
//
// -----------------------------------------------------------------------------
// THE PARTITION IS OVER PATH PREFIXES AND NOT OVER API_CONTRACT'S SECTIONS
// -----------------------------------------------------------------------------
// Section 9 is why. It is headed "Ops and internal (admin origin only)" and it
// holds `GET /health`, marked **Public**, beside `GET /internal/health/deep`,
// marked **Admin origin only**. A partition that read the section heading would
// put the liveness probe on the admin origin and leave the public deployment
// with nothing for the platform to poll. The prefix rule gets both rows right
// without a special case for either, because the contract already drew the
// distinction where it belongs: in the path.
// =============================================================================

/** Thrown when the surface cannot be resolved. There is no default to fall back to. */
export class SurfaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SurfaceError';
  }
}

/**
 * The two deployments of this codebase.
 *
 * `public` runs on the portal's origin and serves API_CONTRACT sections 3 to 7
 * and 10. `operator` runs on `ADMIN_ORIGIN` behind the IP allowlist and
 * hardware-key SSO (C-08, ADR-012) and serves sections 8 and 9.
 */
export type ApiSurface = 'public' | 'operator';

/** Closed, and closed is the point: a third surface is a ruling, not a value. */
export const API_SURFACES = ['public', 'operator'] as const satisfies readonly ApiSurface[];

/** API_CONTRACT section 1. A breaking change means `/api/v2`, never a silent shape change. */
export const BASE_PATH = '/api/v1';

/**
 * The prefixes API_CONTRACT sections 8 and 9 head "admin origin only".
 *
 * Written as prefixes rather than as an endpoint list on purpose. An endpoint
 * list here would be a second transcription of the contract, going stale the
 * first time a route is added; a prefix is the rule the contract itself states.
 */
export const OPERATOR_PREFIXES = ['/admin', '/internal'] as const;

/**
 * The liveness probe. API_CONTRACT section 9: "Public, returns `{ status: "ok" }`
 * and nothing else: no version, no dependency list, no build id."
 *
 * Served by BOTH deployments, and that is not a carve-out from the rule above.
 * A response carrying one constant discloses nothing the origin's own
 * reachability does not already disclose, which is exactly why the contract
 * marks it public and marks `/internal/health/deep`, which enumerates
 * dependencies, admin-origin only.
 */
export const LIVENESS_PATH = '/health';

/** Which deployment answers a path. */
export type PathClass = 'public' | 'operator' | 'liveness';

/** The environment, passed in rather than read from `process.env`. */
export type Environment = Readonly<Record<string, string | undefined>>;

/**
 * The Railway service each surface deploys as.
 *
 * INFRA section 2's table names four services and none of them is this one; see
 * ADR-083 section 7, which reports that rather than editing a document outside
 * this session's fence. The names are service names and never hostnames:
 * `ADMIN_ORIGIN`'s value is never written into this repository (ADR-012,
 * INFRA section 13.2), and `api-admin` names the service that runs there
 * without naming where that is.
 */
export const SERVICE_BY_SURFACE = {
  public: 'api',
  operator: 'api-admin',
} as const satisfies Record<ApiSurface, string>;

/** The variable a deployment sets to choose its surface. */
export const SURFACE_VAR = 'MERIT_API_SURFACE';

// The base path is refused rather than tolerated, and this is the one check
// here that exists for a FOOTGUN rather than for a rule. `/api/v1/internal/jobs`
// passes a leading-slash test and then reads as `/api`, which the prefix rule
// classifies PUBLIC. A caller that helpfully prefixed its own base path would
// get an operator route onto the public surface and no error anywhere.
function assertContractPath(path: string): void {
  if (!path.startsWith('/'))
    throw new SurfaceError(
      `\`${path}\` is not a contract path. Paths are written here as API_CONTRACT writes them, ` +
        `leading slash and no \`${BASE_PATH}\` prefix, because the base path is one string in ` +
        'one place and a path that carries its own copy is a second one',
    );
  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`))
    throw new SurfaceError(
      `\`${path}\` carries the base path. Classification reads the CONTRACT path, and a prefixed ` +
        `one would classify \`${BASE_PATH}/internal/jobs\` as public by matching \`/api\` ` +
        'against neither operator prefix, which is an operator route on the public surface with ' +
        'nothing reporting it',
    );
}

/** `path` is `prefix`, or below it. Never a bare `startsWith`, which matches `/administration`. */
function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Which deployment answers this contract path, by the prefix rule.
 *
 * @param path as API_CONTRACT writes it: `/checkout`, `/internal/jobs`,
 *   `/webhooks/psp/:provider`. Without the base path.
 */
export function classifyPath(path: string): PathClass {
  assertContractPath(path);
  if (path === LIVENESS_PATH) return 'liveness';
  return OPERATOR_PREFIXES.some((prefix) => isUnder(path, prefix)) ? 'operator' : 'public';
}

/**
 * Whether a surface registers this path at all.
 *
 * The whole value of this function is what a `false` MEANS: the route is never
 * registered, so the deployment answers 404 by having nothing there. It is not
 * a permission check and it must never become one.
 */
export function surfaceServes(surface: ApiSurface, path: string): boolean {
  const cls = classifyPath(path);
  return cls === 'liveness' || cls === surface;
}

/**
 * Resolve the surface from the environment.
 *
 * NO DEFAULT, and the reason is `apps/admin/src/origin.ts`'s reason for
 * refusing a default `ADMIN_ORIGIN`: a deployment that has not been configured
 * is a deployment that has not been configured, and the value this file would
 * have to invent is the one that decides whether `/internal/*` is reachable. A
 * default of `public` fails closed and would still be wrong, because it turns a
 * misconfigured admin deployment into a silently useless one; a default of
 * `operator` fails open. There is no safe guess, so there is no guess.
 */
export function resolveSurface(env: Environment): ApiSurface {
  const raw = env[SURFACE_VAR];
  if (raw === undefined || raw.trim() === '')
    throw new SurfaceError(
      `${SURFACE_VAR} is not set. It selects the route set this process registers, so an unset ` +
        'one is a deploy that has not been configured rather than a default this file may ' +
        `supply. Set it to one of: ${API_SURFACES.join(', ')}`,
    );

  const value = raw.trim();
  const match = API_SURFACES.find((surface) => surface === value);
  if (match === undefined)
    throw new SurfaceError(
      `${SURFACE_VAR} is \`${value}\`, which is not one of ${API_SURFACES.join(' | ')}. ` +
        'The set is closed: a third surface is a ruling and not a value',
    );
  return match;
}
