// =============================================================================
// apps/admin/next.config.mjs
// =============================================================================
// THE OPERATOR CONSOLE'S CONFIG, AND MOST OF IT IS WHAT IS ABSENT.
//
// ADR-095 ruling 6 left "no page, no layout, no route, no `next.config`" to the
// slice that writes the first rendered document. `apps/portal/next.config.mjs`
// is that file for the portal and `apps/site/next.config.mjs` is it for the
// site. This console's first document landed WITHOUT one: session 340's log
// records the gap in its own words, "`apps/admin` HAS NO `next.config.mjs`, so
// ADR-095 `F5`'s telemetry remedy is undischarged for this app", and records
// that its build was run with the variable set by hand. This file closes that.
//
// -----------------------------------------------------------------------------
// THERE IS NO `rewrites`, NO `redirects` AND NO `basePath`, AND ON THIS ORIGIN
// THAT REFUSAL IS SHARPER THAN IT IS ON THE OTHER TWO
// -----------------------------------------------------------------------------
// `RI-09` refuses a file whose PATH spells the API surface inside a UI
// deployable, and its own `covers` line names the hole it cannot see first: a
// route reached by a catch-all segment, a REWRITE, a middleware or a
// hand-written router table declares nothing that check can find. `RI-11` reads
// this file for exactly that, and ADR-138 section 3 is the ruling.
//
// THE SHARPER PART IS THIS DEPLOYABLE'S SHARED ORIGIN. INFRA:43 rows the
// `admin` service, codebase `apps/admin`, origin `ADMIN_ORIGIN`; INFRA:44 rows
// `api-admin`, codebase `apps/api` at `operator`, on the SAME origin under
// `/api/v1`; INFRA:53 is the routing rule that separates them by path. Two
// services answering one origin are already separated by a path, so a rewrite
// here would not merely ADD a surface: it would decide, from a file inside the
// console, which of two deployables answers a path the routing rule assigns to
// the other. `ADR-182` ruling 1 makes the operator surface's routes this
// console's DATA SOURCE and never its alternative, and a config key is the one
// way that sentence could stop being true without any route file moving.
//
// -----------------------------------------------------------------------------
// `NEXT_TELEMETRY_DISABLED` IS SET HERE, WHICH IS ADR-095 `F5` DISCHARGED
// -----------------------------------------------------------------------------
// F5 forecloses "silence on the network during a build": `next build` phones
// home unless the variable is set, and F5 names the remedy, an environment
// variable or a `next.config` line, and gives it to "the slice that writes the
// config". Session 340 set it by hand on this app's first real build, which is
// a remedy that lives in a scrollback rather than in the tree.
//
// IT IS THE ENVIRONMENT VARIABLE AND NOT A CONFIG KEY, for the reason the other
// two copies of this paragraph measured on this same version: `next@16.3.2`
// carries no telemetry key in its config schema. This module is evaluated
// before the build begins, so the assignment lands first.
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
// `form-action 'self'` IS THE ONE DIRECTIVE THAT DIFFERS FROM BOTH PUBLIC
// SURFACES, AND IT IS DERIVED RATHER THAN CHOSEN. `src/app/search/account-
// search.tsx` renders the only `<form>` element in the three UI deployables, a
// `GET` to `/search`, and `form-action` governs a `GET` submission as much as a
// `POST` one. The public surfaces have no form and therefore take `'none'`,
// which is strictly tighter. `test/security-headers.test.ts` counts the forms
// under `src/` in all three apps, so the derivation stays live: a form landing
// on the portal or a form leaving this console both turn it red.

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
  "default-src 'self'; base-uri 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'";

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
  // On for the reason the other two are on, and this console has a third. Every
  // screen here is a pure function of a page VALUE that `../src/page.ts` builds:
  // `renderLiabilityHomeDocument` takes a `LiabilityHomePage` and reads nothing
  // else, so a component that breaks under the development double render is a
  // component holding state the view model was supposed to have removed. The
  // third reason is `M06` section 1.2, "M6 aggregates numbers other modules
  // computed": a screen that behaved differently on its second render would be
  // a screen with arithmetic in it.
  reactStrictMode: true,

  // ADR-223. `'/:path*'` matches the root document and every path under it,
  // including `/_next/static/*`, so the static chunks `script-src 'self'`
  // trusts are served under the same policy as the documents that load them.
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
