// =============================================================================
// apps/api/src/security-headers.ts
// =============================================================================
// THE CONSTITUTION'S `strict CSP/HSTS/frame-deny` (Appendix D, section D2) FOR
// THE JSON SURFACE, AND IT IS THREE CONSTANTS RATHER THAN A POLICY ENGINE.
//
// This file decides. `server.ts` wires the decision into the request lifecycle,
// which is why nothing is imported here: the header set is a pure value and is
// testable without a socket, a route or a framework. `csrf.ts` next door has
// the same shape for the same reason.
//
// -----------------------------------------------------------------------------
// WHAT WAS MISSING
// -----------------------------------------------------------------------------
// `MERIT_BUILD_MASTER_PROMPT.md:282` rules `strict CSP/HSTS/frame-deny` among
// eleven binding application controls. Before ADR-223, over the whole repository
// excluding `node_modules` and `.git`, the spellings `Content-Security-Policy`,
// `Strict-Transport-Security`, `X-Frame-Options` and `frame-ancestors` matched
// FIVE files and every one of them was prose. The only `reply.header` calls in
// this package were `Cache-Control`, `Retry-After` and `Set-Cookie`, and no test
// anywhere asserted any of the three.
//
// -----------------------------------------------------------------------------
// A JSON SURFACE NEEDS A DIFFERENT POLICY FROM A DOCUMENT SURFACE, NOT A
// SHRUNKEN COPY OF ONE
// -----------------------------------------------------------------------------
// `API_CONTRACT` section 1 makes every response of this deployable JSON, and
// section 2 makes every error `application/problem+json`. Nothing this process
// emits is a document, so `script-src`, `style-src` and `img-src` have no
// subject here. `default-src 'none'` says that in one directive and says it for
// every fetch type at once, including the ones a later CSP level adds.
//
// THE THREE DIRECTIVES THAT ARE NOT COVERED BY `default-src` ARE THE THREE THAT
// MATTER, AND THAT IS WHY THEY ARE SPELLED OUT. `frame-ancestors`, `form-action`
// and `base-uri` do not fall back to `default-src` in any CSP level, so a policy
// that names only `default-src 'none'` is a policy that permits framing. This
// one refuses it, which is D2's `frame-deny` on this surface.
//
// WHY `frame-ancestors` AND NOT `X-Frame-Options`. The two refuse exactly the
// same set, every browser that reads `frame-ancestors` ignores `X-Frame-Options`
// when both are present, and this deployable's callers are the three Next 16
// applications and three server-to-server webhook senders. ADR-221 section 3.1
// priced a second mechanism that refuses the same set as its first and called it
// a second copy of a control rather than defence in depth; that count is the
// precedent and this file takes it. ADR-223 section 5 records the refusal.
//
// -----------------------------------------------------------------------------
// HSTS IS ONE YEAR, WITH `includeSubDomains` AND WITHOUT `preload`
// -----------------------------------------------------------------------------
// `INFRA` section 2.1 rows both deployments of this codebase behind Cloudflare
// on hostnames this repository never spells, and an HSTS header names no host:
// it binds whatever host served it. So this constant is compatible with ADR-012
// by construction and needs no environment variable.
//
// `preload` IS NOT TAKEN HERE AND THE REASON IS THAT IT IS NOT REVERSIBLE ON
// MERIT'S CLOCK. A preload-list entry binds every subdomain of the apex, ships
// inside browser binaries, and takes months to leave once a subdomain cannot
// serve HTTPS. Two years plus `preload` is the founder's call on ADR-223's
// approval line rather than this file's.
//
// -----------------------------------------------------------------------------
// `X-Content-Type-Options` IS THE ONE HEADER HERE THAT D2 DOES NOT NAME
// -----------------------------------------------------------------------------
// It is declared as an addition in ADR-223 section 5 rather than smuggled in
// under D2's three words. The reason it belongs on THIS surface above all
// others: every response is `application/json` or `application/problem+json`,
// and a browser free to re-sniff one of those as HTML is a browser that can be
// made to execute a reflected value from a response whose own Content-Type said
// it was data.
// =============================================================================

/**
 * The API's Content-Security-Policy.
 *
 * EVERY SOURCE EXPRESSION IS A KEYWORD AND NEVER A HOST, which is the property
 * `INV-M6-02` needs and the property ADR-012 needs, and it holds here trivially
 * because the only keyword in the policy is `'none'`.
 */
export const CONTENT_SECURITY_POLICY =
  "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** D2's `HSTS`. One year, every subdomain, no preload-list entry. */
export const STRICT_TRANSPORT_SECURITY = 'max-age=31536000; includeSubDomains';

/** Not one of D2's three words. ADR-223 section 5 declares it. */
export const CONTENT_TYPE_OPTIONS = 'nosniff';

/**
 * The header set, in the order a reader should meet it.
 *
 * `Readonly<Record<string, string>>` rather than a list of pairs, because a
 * header name appearing twice in this table is a defect the type can refuse and
 * `reply.header` would silently combine.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'Strict-Transport-Security': STRICT_TRANSPORT_SECURITY,
  'X-Content-Type-Options': CONTENT_TYPE_OPTIONS,
};

/**
 * The header set as entries, for a caller that has to iterate it.
 *
 * `server.ts` is that caller and it is the only one. The function exists so the
 * hook does not reach into the object's shape, and so a test can assert the
 * ORDER as well as the membership.
 */
export function securityHeaderEntries(): readonly (readonly [string, string])[] {
  return Object.entries(SECURITY_HEADERS);
}
