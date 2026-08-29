// =============================================================================
// apps/api/src/csrf.ts
// =============================================================================
// THE CONSTITUTION'S `CSRF on cookie mutations` (Appendix D, section D2), AND
// IT IS AN ORIGIN CHECK RATHER THAN A TOKEN.
//
// This file decides. `server.ts` wires the decision into the request lifecycle
// and composes the refusal, which is why nothing is imported here: the verdict
// is a pure function of three header values and is testable without a socket,
// a route or a framework.
//
// -----------------------------------------------------------------------------
// WHAT WAS MISSING, AND WHY `SameSite=Lax` IS NOT IT
// -----------------------------------------------------------------------------
// `SameSite` IS A SITE CONTROL AND NOT AN ORIGIN CONTROL, AND MERIT'S TRADER
// SURFACES SHARE A SITE. INFRA section 2.1 rows `site` on `meritfutures.com`
// and rows both `portal` and `api` on `app.meritfutures.com`. Those hostnames
// have one registrable domain between them, so a request issued by a page on
// the marketing origin to the API is SAME-SITE: `Lax` permits it, and the
// host-only `merit_session` cookie is attached because the destination host is
// the host that set it.
//
// SO AN INJECTION ON THE MARKETING SITE WAS A FULLY AUTHENTICATED WRITE AGAINST
// A TRADER'S MONEY, and `Lax` did nothing about it. That is the gap this file
// closes and it is the reason the check compares HOSTNAMES rather than sites.
//
// The corpus already reasons this way one origin over: INFRA section 3 hard
// rule 3 puts the admin console and `api-admin` on a separate apex domain so
// that "cookie scope, CORS, and the CSP never span the two origins". The
// operator surfaces were separated at the site boundary on purpose. The trader
// surfaces were not.
//
// -----------------------------------------------------------------------------
// WHY AN ORIGIN CHECK AND NOT A MINTED TOKEN
// -----------------------------------------------------------------------------
// A token needs an issuing endpoint API_CONTRACT does not declare, a place to
// hold a value page script can read, and a matching change in every client. It
// buys nothing this check does not already have: both refuse exactly the
// requests a browser issues from a hostname that is not this one, and the token
// additionally cannot be reached by the portal's SERVER-SIDE caller at all.
// ADR-219's standard is that a token nothing checks is not a control; the
// converse holds here, which is that a token this check makes redundant is a
// second copy of a control rather than defence in depth.
//
// ONE MECHANISM, DELIBERATELY. `Sec-Fetch-Site` is the other candidate and it
// is strictly weaker for the one case that matters: the marketing origin's
// forged write arrives as `same-site`, which is the value an allowlist built on
// that header would ADMIT. A second mechanism that admits the gap is not depth.
//
// -----------------------------------------------------------------------------
// WHY HOSTNAME AND NOT SCHEME-HOST-PORT
// -----------------------------------------------------------------------------
// The boundary this control has to draw is the boundary the COOKIE draws, and a
// cookie is neither port-scoped nor scheme-scoped. `routes/auth.ts` sets
// `merit_session` with no `Domain` attribute, so it is host-only: it is sent to
// exactly one hostname and to no other, on any port and (subject to `Secure`)
// on any scheme. Comparing hostnames is therefore exactly as tight as the
// cookie is. A full-origin comparison would refuse nothing further, because a
// page that can occupy any port of this hostname already receives this cookie.
//
// -----------------------------------------------------------------------------
// THE FOUR RULES, AND THE DIRECTION EACH ONE FAILS IN
// -----------------------------------------------------------------------------
//   1. A SAFE METHOD PASSES. Safe is the closed list below and everything else
//      is unsafe, so a verb this contract does not use yet is GUARDED by
//      default rather than exempt by default. `registry.ts` closes the route
//      vocabulary at five; this file does not read that list, because the
//      property wanted here is "not a read", not "one of ours".
//   2. NO `Origin` HEADER PASSES, and this is the clause that admits every
//      legitimate caller. Browsers have set `Origin` on every request whose
//      method is not `GET` or `HEAD` since the Fetch standard folded form
//      submissions in, so a browser CANNOT issue a cookie-bearing unsafe
//      request without one. What arrives with no `Origin` is a non-browser
//      client, and a non-browser client holds no victim's cookie jar, which is
//      the whole mechanism a cross-site request forgery runs on. The portal's
//      server-side `fetch` and every `/webhooks/*` caller land here.
//   3. AN `Origin` THIS FILE CANNOT READ IS REFUSED. The literal `null` a
//      sandboxed frame or a cross-origin redirect sends, two headers Node
//      joined with a comma, a scheme that is not `http` or `https`: each is a
//      request whose origin cannot be shown to be this hostname, and the
//      answer to that is no rather than probably.
//   4. AN UNREADABLE `Host` IS REFUSED, for rule 3's reason from the other
//      side. Without it there is nothing to compare against, and a comparison
//      that cannot be made must not report a match.
//
// -----------------------------------------------------------------------------
// WHAT THIS DOES NOT CLAIM
// -----------------------------------------------------------------------------
// IT IS NO DEFENCE AGAINST SCRIPT RUNNING ON THIS HOSTNAME ITSELF. Such a page
// sends a matching `Origin` because it genuinely has one. `HttpOnly` is the
// control there and a token in a script-readable cookie would be no control at
// all, which is the second reason clause 1 of ADR-219 declined to mint one.
//
// IT IS ALSO NOT AN AUTHORIZATION CHECK. It refuses on the request's ORIGIN and
// never on the caller's identity, which is why it can and does run before any
// handler and before any body is parsed.
// =============================================================================

/**
 * The methods a cross-origin page may reach without this check.
 *
 * CLOSED, and the closure is the fail-closed direction: membership is tested
 * against this list and everything absent from it is unsafe, so a verb added to
 * the contract later is guarded on the day it lands rather than on the day
 * somebody remembers this file. `HEAD` and `OPTIONS` are here because Fastify
 * answers both from registered routes and neither can carry a body.
 */
export const CSRF_SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'] as const;

/** One of {@link CSRF_SAFE_METHODS}. */
export type CsrfSafeMethod = (typeof CSRF_SAFE_METHODS)[number];

/** Why a request was admitted. Reported so a test can assert WHICH clause ran. */
export type CsrfAdmission = 'safe-method' | 'no-origin' | 'same-host';

/** Why a request was refused. Logged; never returned to the caller. */
export type CsrfRefusal = 'unreadable-origin' | 'unreadable-host' | 'origin-mismatch';

/**
 * The verdict.
 *
 * IT CARRIES THE CLAUSE AND NOT ONLY THE BOOLEAN, because the failure this
 * shape guards against is a check that passes everything for the wrong reason.
 * A suite asserting `allowed === true` on a request it believes is same-host
 * cannot tell that clause 2 admitted it because the header name was misspelled.
 */
export type CsrfVerdict =
  | { readonly allowed: true; readonly reason: CsrfAdmission }
  | { readonly allowed: false; readonly reason: CsrfRefusal };

/**
 * The three header values the verdict reads, in the shape Node hands them over.
 *
 * `string[]` is admitted in the type rather than assumed away: Node yields an
 * array for a repeated header it does not fold, and a check that narrowed with
 * a cast would read `[0]` and take the attacker's choice of two.
 */
export interface CsrfRequest {
  readonly method: string;
  readonly origin: string | readonly string[] | undefined;
  readonly host: string | undefined;
}

/** Characters a `Host` header may not carry, each of which would reparse it. */
const HOST_DELIMITERS = /[/?#@\\]/;

/**
 * The hostname an `Origin` names, or `null` when it does not name one.
 *
 * `URL` does the normalization this comparison depends on and doing it by hand
 * is where this class of check goes wrong: it lowercases, it punycodes a
 * unicode label, it strips the port, and it brackets an IPv6 literal. Both
 * sides go through it, so both sides are normalized identically or neither is.
 */
function originHostname(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  // `file:`, `data:`, an extension scheme: none of them is this API's hostname
  // and none of them can be compared to one.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // An `Origin` carries no path, no query and no credentials. A value that has
  // one is not an origin serialization, whatever `URL` made of it.
  if (url.pathname !== '/' || url.search !== '' || url.username !== '' || url.password !== '')
    return null;
  return url.hostname === '' ? null : url.hostname;
}

/**
 * The hostname a `Host` header names, or `null`.
 *
 * The delimiter check runs BEFORE the parse. `new URL('http://a@b')` reads `b`,
 * so a header of `trusted-host@attacker-host` would otherwise resolve to the
 * attacker's half of it under a name that reads as the trusted one.
 */
function requestHostname(value: string): string | null {
  if (value === '' || HOST_DELIMITERS.test(value)) return null;
  let url: URL;
  try {
    url = new URL(`http://${value}`);
  } catch {
    return null;
  }
  return url.hostname === '' ? null : url.hostname;
}

/**
 * Decide one request.
 *
 * PURE, TOTAL, AND IT READS NOTHING ELSE. Not the path, not the cookie, not the
 * surface. The path is deliberately out of scope: a control that exempts a list
 * of routes is a control whose list is its bypass, and `registry.ts` already
 * establishes that a second place to say which routes are special is a second
 * place to get it wrong.
 *
 * THE COOKIE IS OUT OF SCOPE TOO, AND THAT IS THE LESS OBVIOUS HALF. D2's words
 * are "cookie mutations", and the reading that fires only when a session cookie
 * arrives would miss LOGIN forgery, where a forged sign-in POST carries no
 * cookie at all and the RESPONSE is the mutation: the victim's browser ends up
 * holding the attacker's session and everything it does next lands in the
 * attacker's account. Reading the cookie to decide whether to read the origin
 * would also make the cookie's NAME the bypass. Every unsafe method is checked.
 */
export function csrfVerdict(request: CsrfRequest): CsrfVerdict {
  const method = request.method.toUpperCase();
  if ((CSRF_SAFE_METHODS as readonly string[]).includes(method))
    return { allowed: true, reason: 'safe-method' };

  const { origin } = request;
  if (origin === undefined) return { allowed: true, reason: 'no-origin' };
  // A repeated header. Neither value can be preferred, so neither is taken.
  if (typeof origin !== 'string') return { allowed: false, reason: 'unreadable-origin' };

  const claimed = originHostname(origin);
  if (claimed === null) return { allowed: false, reason: 'unreadable-origin' };

  const served = request.host === undefined ? null : requestHostname(request.host);
  if (served === null) return { allowed: false, reason: 'unreadable-host' };

  return claimed === served
    ? { allowed: true, reason: 'same-host' }
    : { allowed: false, reason: 'origin-mismatch' };
}
