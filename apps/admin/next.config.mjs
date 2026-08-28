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
};

export default nextConfig;
