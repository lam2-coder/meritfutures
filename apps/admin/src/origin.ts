// =============================================================================
// apps/admin/src/origin.ts
// =============================================================================
// ADR-012: A SEPARATE APEX DOMAIN, READ FROM THE ENVIRONMENT, NEVER WRITTEN DOWN.
//
// `apps/admin/src/index.ts` already carries the ruling: "the origin itself is a
// placeholder, `ADMIN_ORIGIN`, per the Wave 2 ruling recorded in INFRA section
// 13.2. It is read from the environment at deploy time and is deliberately not
// written down here." So this file resolves the variable and validates the
// shape; the value never appears in the tree, including in a default, including
// in a comment.
//
// INV-M6-02 is what the validation is FOR: "the admin origin shares no cookie,
// no CORS policy, and no CSP with any public surface ... An XSS on the portal
// cannot reach the admin surface even in principle." A cookie's scope follows
// the host, so `admin.<public host>` shares a cookie domain with the public
// surface by construction. That is the failure `apps/admin/src/index.ts` names
// in general terms -- "it silently converts a security control into a URL
// convention" -- arriving through a DNS record rather than through a router.
//
// SO THE CHECK IS AGAINST THE PUBLIC HOSTS RATHER THAN AGAINST A PATTERN. When
// the environment names the public origins, this file refuses an admin host
// that is equal to one, under one, or above one. It cannot compute a
// registrable apex without a public-suffix list and does not pretend to; what
// it can prove is the containment relation, and containment is what a cookie
// domain follows. When the public origins are absent the check is REPORTED AS
// NOT RUN rather than passed, on the rule this repository already applies to
// itself in `repo-invariants.mjs`.
// =============================================================================

/** Thrown when the admin origin cannot be resolved or fails ADR-012. */
export class OriginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OriginError';
  }
}

/** The placeholder ADR-012 and INFRA section 13.2 name. The value is not here. */
export const ADMIN_ORIGIN_VAR = 'ADMIN_ORIGIN';

/**
 * The public surfaces this origin must not share a cookie domain with. Their
 * own placeholders, on the same rule: names in the tree, values in the deploy.
 */
export const PUBLIC_ORIGIN_VARS = ['SITE_ORIGIN', 'PORTAL_ORIGIN'] as const;

/** Whether the separation check ran, and against what. */
export interface SeparationCheck {
  readonly ran: boolean;
  /** The public origin variables that were present to check against. */
  readonly checkedAgainst: readonly string[];
  /** Stated when `ran` is false. A check that cannot run is not a check that passed. */
  readonly note: string;
}

export interface AdminOrigin {
  /** The scheme-and-host origin, exactly as the environment gave it. */
  readonly origin: string;
  /** The host alone, which is what a cookie domain follows. */
  readonly host: string;
  readonly separation: SeparationCheck;
}

/**
 * The environment, passed in rather than read from `process.env`.
 *
 * A module that reaches for the ambient environment is a module a test cannot
 * put in a state, and the state that matters here is the one where the variable
 * is missing. That is the same argument `packages/rules-engine` makes about the
 * clock, applied to configuration.
 */
export type Environment = Readonly<Record<string, string | undefined>>;

function parseOrigin(raw: string, variable: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OriginError(`${variable} is not a URL, so it cannot be an origin`);
  }
  if (url.protocol !== 'https:')
    throw new OriginError(
      `${variable} is not https. The admin console is IP allowlisted behind hardware-key SSO ` +
        '(ADR-012, SECURITY) and none of that survives a cleartext origin',
    );
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '')
    throw new OriginError(
      `${variable} carries a path, a query or a fragment. An origin is a scheme and a host, and ` +
        'a path here is the route-group scaffold ADR-012 refuses, spelled as configuration',
    );
  return url;
}

/** `a` is `b`, or a subdomain of `b`. Cookie-domain containment, both directions checked. */
function isWithin(a: string, b: string): boolean {
  return a === b || a.endsWith(`.${b}`);
}

/**
 * Resolve the admin origin from the environment and check ADR-012 as far as the
 * environment allows.
 */
export function resolveAdminOrigin(env: Environment): AdminOrigin {
  const raw = env[ADMIN_ORIGIN_VAR];
  if (raw === undefined || raw.trim() === '')
    throw new OriginError(
      `${ADMIN_ORIGIN_VAR} is not set. It is read at deploy time and deliberately absent from the ` +
        'repository (ADR-012, INFRA section 13.2), so an unset one is a deploy that has not been ' +
        'configured rather than a default this file may supply',
    );

  const admin = parseOrigin(raw.trim(), ADMIN_ORIGIN_VAR);

  const present = PUBLIC_ORIGIN_VARS.filter((variable) => {
    const value = env[variable];
    return value !== undefined && value.trim() !== '';
  });

  for (const variable of present) {
    const value = env[variable];
    if (value === undefined) continue;
    const publicHost = parseOrigin(value.trim(), variable).host;
    if (isWithin(admin.host, publicHost) || isWithin(publicHost, admin.host))
      throw new OriginError(
        `${ADMIN_ORIGIN_VAR} and ${variable} share a cookie domain. INV-M6-02 requires the admin ` +
          'origin to share no cookie, no CORS policy and no CSP with any public surface, and a ' +
          'host that contains or is contained by a public host shares one by construction. ' +
          'ADR-012 requires a SEPARATE APEX, not a subdomain of the product',
      );
  }

  return {
    origin: admin.origin,
    host: admin.host,
    separation: {
      ran: present.length > 0,
      checkedAgainst: present,
      note:
        present.length > 0
          ? `checked against ${present.join(', ')}`
          : `NOT RUN: none of ${PUBLIC_ORIGIN_VARS.join(', ')} is set, so the separation this ` +
            'check exists to prove is unproven here. A check that cannot run is not a check that ' +
            'passed',
    },
  };
}
