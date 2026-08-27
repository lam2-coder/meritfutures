// =============================================================================
// apps/portal/next.config.mjs
// =============================================================================
// THE FIRST `next.config` IN THIS REPOSITORY, AND MOST OF IT IS WHAT IS ABSENT.
//
// ADR-095 ruling 6 left "no page, no layout, no route, no `next.config`" to the
// slice that writes the first rendered document. This is that file, and ADR-138
// is the ruling that lands beside it.
//
// -----------------------------------------------------------------------------
// THERE IS NO `rewrites`, NO `redirects` AND NO `basePath`, AND THAT IS A
// REFUSAL RATHER THAN A DEFAULT
// -----------------------------------------------------------------------------
// `RI-09` refuses a file whose PATH spells the API surface inside a UI
// deployable, and its own `covers` line names the hole it cannot see first:
// "a route reached by a catch-all segment, a REWRITE, a middleware or a hand-
// written router table declares nothing this check can find".
//
// A `rewrites()` entry is that hole with a config key on it. Three lines here
// would serve `/api/v1/admin/payouts` from `apps/portal`'s origin with no file
// anywhere in this tree spelling either segment, which is API_CONTRACT section
// 1's "no privileged back door" undone by a manifest rather than by a route.
// `RI-11` reads this file for exactly that, and ADR-138 section 3 is the ruling.
//
// -----------------------------------------------------------------------------
// `NEXT_TELEMETRY_DISABLED` IS SET HERE, WHICH IS ADR-095 `F5` DISCHARGED
// -----------------------------------------------------------------------------
// F5 forecloses "silence on the network during a build": `next build` phones
// home unless the variable is set, and F5 names "`NEXT_TELEMETRY_DISABLED=1` or
// a `next.config` line" as the remedy and gives it to "the slice that writes the
// config".
//
// IT IS THE ENVIRONMENT VARIABLE AND NOT A CONFIG KEY, MEASURED RATHER THAN
// ASSUMED: `next@16.3.2` carries no telemetry key in its config schema, and
// `NEXT_TELEMETRY_DISABLED` is the only spelling `dist/telemetry/storage.js`
// reads. Setting it in a script would need a cross-platform env shim, which is
// a package, which is a VG-12 admission for one variable. This module is
// evaluated before the build begins, so the assignment lands first.
process.env['NEXT_TELEMETRY_DISABLED'] = '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The React Strict Mode double-render is a development-only behaviour and it
  // is on because this app's screens are pure functions of a wire shape: a
  // component that breaks under a second render is a component holding state
  // the view model was supposed to have removed.
  reactStrictMode: true,
};

export default nextConfig;
