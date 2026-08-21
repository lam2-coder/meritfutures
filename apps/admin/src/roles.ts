// =============================================================================
// apps/admin/src/roles.ts
// =============================================================================
// THREE ROLES, CLOSED, AND NOTHING ON THIS PAGE MUTATES.
//
// API_CONTRACT section 8 fixes the set: "`owner` (all), `ops` (read plus
// account actions, no config or role changes), `readonly`". A fourth role is a
// change to the contract, so an unrecognised one is refused here rather than
// defaulted to the least privileged: a string that silently becomes `readonly`
// is a typo that grants a session it should have refused, and the refusal is
// the whole value of a closed set.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE DELIBERATELY DOES NOT CONTAIN
// -----------------------------------------------------------------------------
// INV-M6-09 is "`readonly` cannot mutate anything, and `ops` cannot change
// config, roles, or plan versions", and section 8.1 makes its test suite "one
// per mutating route per role, ENUMERATED FROM THE ROUTER". This session builds
// read surfaces and adds no mutating route, so there is nothing to enumerate
// and no negative-authz matrix is written here.
//
// That is a limit and it is stated rather than left to be inferred. Section
// 8.1a is explicit about where the enumeration starts when it does arrive:
// "`M6-N-09` is the next free identifier. The router enumeration starts there."
// `M6-N-01` to `M6-N-08` are ADR-068's, already claimed. A file that shipped a
// partial matrix now would be the "control that exists and enforces nothing"
// class, since a negative-authz suite over an empty router reads as coverage.
//
// -----------------------------------------------------------------------------
// EVERY ROLE MAY READ THE LIABILITY HOME PAGE, AND THAT IS NOT A GAP
// -----------------------------------------------------------------------------
// `readonly` exists precisely so that reading is separable from acting. The
// read-side risk AS-M6-05 names is not the liability page: it is the identity
// graph and one-click evidence export, "a read-only admin session and no write
// capability can still take the identity graph and a pack per account". Those
// are other surfaces with their own controls.
//
// INV-M6-10 is what keeps this page outside that risk, and `page.ts` asserts it
// rather than asserting it here: the liability home page renders aggregates and
// no trader-identifying data at all, so there is no subject to scope a read to.
// =============================================================================

/** Thrown when a role cannot be resolved. Never defaulted. */
export class RoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoleError';
  }
}

/** API_CONTRACT section 8's set, closed. */
export const ADMIN_ROLES = ['owner', 'ops', 'readonly'] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

/** Resolve a role, or refuse. There is no default and no fallthrough. */
export function requireAdminRole(value: string): AdminRole {
  const match = (ADMIN_ROLES as readonly string[]).indexOf(value);
  if (match < 0)
    throw new RoleError(
      `${JSON.stringify(value)} is not an admin role. API_CONTRACT section 8 closes the set at ` +
        `${ADMIN_ROLES.join(', ')}, and an unrecognised role is refused rather than defaulted: ` +
        'a string that quietly becomes `readonly` is a typo that granted a session',
    );
  const role = ADMIN_ROLES[match];
  if (role === undefined) throw new RoleError(`unreachable: ${value} matched but did not resolve`);
  return role;
}

/**
 * Whether a role may read the liability home page. All three may.
 *
 * The function exists rather than the constant `true` because the call site is
 * where a future reader looks for the answer, and because a page whose access
 * rule is unwritten is a page whose access rule gets assumed.
 */
export function mayReadLiabilityHome(role: AdminRole): boolean {
  return (ADMIN_ROLES as readonly AdminRole[]).includes(role);
}
