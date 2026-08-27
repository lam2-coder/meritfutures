// =============================================================================
// apps/portal/src/app/calendar/styles.ts
// =============================================================================
// MOBILE FIRST, WHICH M04 SECTION 1.1 STATES AS A PROPERTY OF THE APPLICATION
// AND NOT AS A PREFERENCE: "`apps/portal`, a Next.js App Router application,
// MOBILE FIRST, consuming `/api/v1` and nothing else."
//
// So every rule below is written for the narrow viewport and the one media
// query WIDENS. There is no `max-width` breakpoint anywhere in this file, which
// is the mechanical form of the claim: a rule that only applies above a width
// cannot be the rule a phone gets.
//
// -----------------------------------------------------------------------------
// WHY THIS IS A STRING IN A SEGMENT AND NOT A STYLESHEET IN A LAYOUT
// -----------------------------------------------------------------------------
// A global stylesheet is imported by `src/app/layout.tsx`, and the layout is
// session 250's file, not this session's. Writing one here would be inventing
// the layout this session was told not to invent. A `<style>` element rendered
// by the segment's own frame is scoped to the segment by ownership rather than
// by a scoping mechanism: it lands with these screens, it leaves with them, and
// when the design system's real stylesheet arrives this constant is deleted in
// one place. DESIGN_SYSTEM owns the eventual answer and this is not it.
//
// THE CLASS PREFIX IS `merit-` FOR THE SAME REASON. Nothing else in the tree
// emits CSS today, so the prefix is not defending against a collision that
// exists; it is defending against the one a global stylesheet will create the
// day it lands, when a bare `.stale` in two files stops meaning two things.

/**
 * The segment's styles. One string, one place, one deletion when the design
 * system's stylesheet arrives.
 *
 * THE STALE AND UNSTATED STATES ARE NOT STYLED QUIETLY. A staleness notice a
 * theme can make subtle is a staleness notice that will be made subtle, so the
 * two honest-but-unwelcome states carry a border and a weight of their own
 * rather than a colour alone. Colour alone would also fail a reader who cannot
 * distinguish it, on the one line of the screen that most needs reading.
 */
export const SEGMENT_STYLES = `
.merit-screen { margin: 0 auto; max-width: 44rem; padding: 1rem; font: 1rem/1.5 system-ui, sans-serif; }
.merit-screen h1 { font-size: 1.375rem; margin: 0 0 .25rem; }
.merit-screen h2 { font-size: 1.0625rem; margin: 1.5rem 0 .5rem; }
.merit-screen h3 { font-size: .9375rem; margin: 1rem 0 .375rem; }

.merit-band { border: 2px solid; padding: .75rem; margin: 0 0 1rem; }
.merit-band__line { margin: .25rem 0; }
.merit-band__exit { margin-top: .5rem; }

.merit-as-of { border-left: 4px solid; padding: .5rem .75rem; margin: .75rem 0; }
.merit-as-of--stale, .merit-as-of--unstated { border: 2px solid; border-left-width: 6px; font-weight: 500; }
.merit-as-of__note { display: block; margin-top: .25rem; }

.merit-trading-day { white-space: nowrap; font-variant-numeric: tabular-nums; }
.merit-trading-day__unit, .merit-local-clock__unit { font-size: .8125rem; opacity: .8; }
.merit-local-clock { font-variant-numeric: tabular-nums; }

.merit-day-group { margin: 1.25rem 0; }
.merit-release, .merit-entry { border-top: 1px solid; padding: .625rem 0; }
.merit-release__revised { display: block; margin-top: .25rem; font-weight: 600; }

.merit-detail { display: grid; grid-template-columns: 1fr; gap: .125rem .75rem; margin: .375rem 0 0; }
.merit-detail dt { font-size: .8125rem; opacity: .85; }
.merit-detail dd { margin: 0 0 .375rem; font-variant-numeric: tabular-nums; }

.merit-sizes { width: 100%; border-collapse: collapse; display: block; overflow-x: auto; }
.merit-sizes th, .merit-sizes td { padding: .375rem .5rem; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.merit-sizes th:first-child, .merit-sizes td:first-child { text-align: left; }

.merit-clause { margin: 0 0 .75rem; }
.merit-clause__path { display: block; font-size: .75rem; letter-spacing: .04em; text-transform: uppercase; opacity: .8; }

.merit-empty, .merit-stale { border: 2px solid; padding: .75rem; margin: .75rem 0; }
.merit-footer { border-top: 1px solid; margin-top: 2rem; padding-top: .75rem; font-size: .8125rem; }

@media (min-width: 40rem) {
  .merit-screen { padding: 1.5rem 2rem; }
  .merit-detail { grid-template-columns: auto 1fr; }
  .merit-sizes { display: table; }
}
`;
