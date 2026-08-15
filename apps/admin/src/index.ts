// =============================================================================
// apps/admin
// =============================================================================
// Liability dashboard, account drill-down, flags queue, evidence export.
//
// A SEPARATE DEPLOYABLE FROM THE FIRST COMMIT, AND IT WILL LOOK LIKE WASTE FOR
// WEEKS. P1 section 2.1 makes the argument and three documents carry the
// ruling: ADR-012 puts the admin console on a separate apex domain, SECURITY
// treats one owned admin as total loss, and STRATEGY section 2 chose Playwright
// over Cypress SPECIFICALLY because that separate origin makes cross-origin a
// requirement rather than an edge case.
//
// The tempting scaffold is one application with three route groups. That choice
// is invisible for months, is a re-platform to undo, and it silently converts a
// security control into a URL convention. `RI-04` in @merit/tooling asserts the
// four deployables are four packages, so collapsing them fails CI-01 rather
// than passing review.
//
// The origin itself is a placeholder, `ADMIN_ORIGIN`, per the Wave 2 ruling
// recorded in INFRA section 13.2. It is read from the environment at deploy
// time and is deliberately not written down here.

/** The Railway service this app deploys as (INFRA section 2). */
export const SERVICE = 'admin' as const;

/**
 * Not an application yet. It is a deployable that starts, so that "separate
 * deployable" is a property of the tree rather than an intention.
 */
export function main(): void {
  console.log(`merit ${SERVICE}: no surface yet`);
}
