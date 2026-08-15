// =============================================================================
// apps/site
// =============================================================================
// Public marketing, plans, rules pages, stats, legal.
//
// Static and cacheable, and it renders rules FROM plan versions so that
// marketing cannot drift from the engine (OVERVIEW section 3). That is the
// whole reason this is an application rather than a set of pages: a rule
// published on a price card is read from the account's pinned plan version, not
// copied into a headline.
//
// GS-143's `<PlanValue>` component and the content lint are P4's work, not this
// session's (P1 section 2.3, tier 3). What the scaffold owes them is a
// deployable to land in.

/** The Railway service this app deploys as (INFRA section 2). */
export const SERVICE = 'site' as const;

/** Not an application yet. It is a deployable that starts. */
export function main(): void {
  console.log(`merit ${SERVICE}: no surface yet`);
}
