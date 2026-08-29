// =============================================================================
// apps/site/next.config.mjs
// =============================================================================
// THE MARKETING ORIGIN'S CONFIG, AND MOST OF IT IS WHAT IS ABSENT.
//
// ADR-095 ruling 6 left "no page, no layout, no route, no `next.config`" to the
// slice that writes the first rendered document. `apps/portal/next.config.mjs`
// is that file for the portal and this is it for the site; the two are
// deliberately near identical, because the two refusals below are the same
// refusal and a reader who diffs them should find nothing interesting.
//
// -----------------------------------------------------------------------------
// THERE IS NO `rewrites`, NO `redirects` AND NO `basePath`, AND THAT IS A
// REFUSAL RATHER THAN A DEFAULT
// -----------------------------------------------------------------------------
// `RI-09` refuses a file whose PATH spells the API surface inside a UI
// deployable, and its own `covers` line names the hole it cannot see first: "a
// route reached by a catch-all segment, a REWRITE, a middleware or a hand-
// written router table declares nothing this check can find".
//
// A `rewrites()` entry is that hole with a config key on it. Three lines here
// would serve the operator surface from `meritfutures.com` with no file in this
// tree spelling either segment, which is API_CONTRACT section 1's "no
// privileged back door" undone by a manifest rather than by a route. `RI-11`
// reads this file for exactly that and ADR-138 section 3 is the ruling.
//
// THE SITE HAS A SECOND REASON THE PORTAL DOES NOT. M09 section 1.2 gives this
// origin "no session cookie and no authenticated route", and calls that "a
// security property, not an omission". A rewrite is how an origin acquires a
// route it never wrote, so it is how that property would be lost silently.
//
// -----------------------------------------------------------------------------
// `NEXT_TELEMETRY_DISABLED` IS SET HERE, WHICH IS ADR-095 `F5` DISCHARGED
// -----------------------------------------------------------------------------
// F5 forecloses "silence on the network during a build" and gives the remedy,
// "`NEXT_TELEMETRY_DISABLED=1` or a `next.config` line", to "the slice that
// writes the config". The notice was observed on this tree before this file
// existed, in this session's own baseline run of `next build`.
//
// IT IS THE ENVIRONMENT VARIABLE AND NOT A CONFIG KEY, for the reason the
// portal's copy of this paragraph measured: `next@16.3.2` carries no telemetry
// key in its config schema. This module is evaluated before the build begins,
// so the assignment lands first.
process.env['NEXT_TELEMETRY_DISABLED'] = '1';

// -----------------------------------------------------------------------------
// THE SECURITY RESPONSE HEADERS, ADR-223
// -----------------------------------------------------------------------------
// `MERIT_BUILD_MASTER_PROMPT.md` Appendix D section D2 rules `strict CSP/HSTS/
// frame-deny` among the binding application controls. Before ADR-223 no file in
// this repository set any of the three on any surface, while `INFRA:71` and
// `M06`'s `INV-M6-02` both asserted an origin separation holding "even in
// principle" on the strength of a CSP nothing set. This block is the half of
// that ruling this deployable owns.
//
// IT IS `headers()` HERE AND NOT A CLOUDFLARE RULE. `INFRA:27` puts Cloudflare
// in front of every origin and `INFRA` rules NO ORIGIN LOCK anywhere, so a
// direct-to-origin request bypasses the edge; an edge rule is also invisible to
// every gate in this repository, to `vitest` and to the founder's `E2` read.
// ADR-221 section 6 ruled exactly that about the CSRF check and ADR-223 section
// 2 takes the same ground for these headers.
//
// EVERY SOURCE EXPRESSION IN THE POLICY IS A KEYWORD AND NEVER A HOST. `'self'`,
// `'none'` and `'unsafe-inline'` are the only tokens it carries, so no directive
// can grant one Merit origin access to another, and ADR-012's rule that no admin
// hostname is written into this repository holds by construction rather than by
// care. `INV-M6-02`'s separation IS that property, and the suite asserts it.
//
// `script-src` CARRIES `'unsafe-inline'`, WHICH IS NAMED RATHER THAN HIDDEN.
// `next@16.3.2` writes the React Flight payload into every document as two
// INLINE `<script>` elements, from `next/dist/server/app-render/use-flight-
// response.js` and `stream-ops.node.js`: a 43 byte bootstrap identical on every
// page, and a per-document payload measured between 6,428 and 7,691 bytes. A
// hash list cannot cover the second, because it changes with the document, and
// a nonce cannot reach either on a prerendered document, because Next injects a
// nonce only while rendering a request. ADR-223 section 4 prices the nonce, and
// section 4.1 states what would end this.
//
// `style-src` CARRIES IT TOO, FORCED BY FRAMEWORK DOCUMENTS AND NOT BY MERIT'S.
// `_not-found`, `_global-error`, `pages/404` and `pages/500` each ship one
// `<style>` element and four to seven `style=` attributes that Next writes
// itself, in all three UI deployables.
//
// HSTS IS ONE YEAR WITH `includeSubDomains` AND WITHOUT `preload`. Preloading is
// a browser-vendor list entry that is slow to leave and binds every subdomain of
// the apex, so ADR-223's approval line puts it to the founder rather than taking
// it here.
//
// `X-Frame-Options` IS DELIBERATELY NOT SET. `frame-ancestors 'none'` refuses
// exactly the set it would refuse, and every browser this app supports honours
// `frame-ancestors` and ignores `X-Frame-Options` when it is present. ADR-221
// section 3.1's count is the precedent: a second mechanism that refuses the same
// set is a second copy of a control rather than defence in depth.
//
// `form-action 'none'` IS DERIVED AND IS ASSERTED AGAINST THE SOURCE. This app
// contains no `<form>` element, so nothing legitimate submits one and an
// injected script gets no form submission to any origin at all, this app's own
// included. `test/security-headers.test.ts` counts the forms under `src/` and
// goes red if one lands, because the day a form arrives this directive is wrong.

/**
 * This deployable's Content-Security-Policy, ADR-223.
 *
 * ONE SINGLE-QUOTED-FREE STRING ON ONE LINE, DELIBERATELY. `apps/admin/test/
 * security-headers.test.ts` reads the two sibling configs as TEXT rather than
 * importing them, on ADR-221's precedent for reading `auth.ts`'s cookie
 * templates from `apps/api/test/csrf.test.ts`, because `RI-04` forbids one
 * deployable depending on another and a cross-app import is that dependency in
 * a test's costume. A one-line literal is what makes that read exact.
 */
export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; base-uri 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'";

/** D2's `HSTS`. Two years and `preload` are the founder's call, ADR-223. */
export const STRICT_TRANSPORT_SECURITY = 'max-age=31536000; includeSubDomains';

/**
 * Not one of D2's three words and declared as an addition in ADR-223 section 5.
 *
 * A document served as `text/html` that a browser is free to re-sniff is a
 * document whose Content-Type is advisory, and this app serves the static
 * chunks the CSP's `script-src 'self'` trusts.
 */
export const CONTENT_TYPE_OPTIONS = 'nosniff';

/** The header set, in the shape `headers()` returns. */
export const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
  { key: 'Strict-Transport-Security', value: STRICT_TRANSPORT_SECURITY },
  { key: 'X-Content-Type-Options', value: CONTENT_TYPE_OPTIONS },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // On for the reason the portal's is on: every screen in this app is a pure
  // function of a page model built in `src/routes/`, so a component that breaks
  // under the development double render is a component holding state the page
  // model was supposed to have removed.
  reactStrictMode: true,

  // ADR-223. `'/:path*'` matches the root document and every path under it,
  // including `/_next/static/*`, so the static chunks `script-src 'self'`
  // trusts are served under the same policy as the documents that load them.
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
