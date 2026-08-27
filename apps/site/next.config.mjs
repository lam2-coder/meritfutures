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

/** @type {import('next').NextConfig} */
const nextConfig = {
  // On for the reason the portal's is on: every screen in this app is a pure
  // function of a page model built in `src/routes/`, so a component that breaks
  // under the development double render is a component holding state the page
  // model was supposed to have removed.
  reactStrictMode: true,
};

export default nextConfig;
