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
// time and is deliberately not written down here. `origin.ts` resolves it.
//
// -----------------------------------------------------------------------------
// WHAT EXISTS HERE, AND WHAT DOES NOT
// -----------------------------------------------------------------------------
// The liability home page's READ surface: M06 section 3.1's panels as far as
// their suppliers exist, AS-M6-04's three numbers, section 3.5's live figure,
// and P-M6-09 gating all of it.
//
// NOTHING IN THIS PACKAGE MUTATES. That is a property of the tree rather than a
// convention: there is no route, no client and no write path in it, so
// INV-M6-01's audit middleware, INV-M6-08's dual control and section 8.1's
// negative-authz matrix have nothing to attach to yet and none of them is
// half-built here. Section 8.1a names where the RBAC enumeration starts when
// the router arrives: `M6-N-09`.
//
// The account drill-down (3.2), the identity drill-down (3.2a), the flags queue
// (3.3), the event feed and the evidence pack are M06 surfaces this package does
// not contain.

/** The Railway service this app deploys as (INFRA section 2). */
export const SERVICE = 'admin' as const;

// -----------------------------------------------------------------------------
// The read surface, and the only thing anything outside this app may import
// -----------------------------------------------------------------------------
// The `exports` map publishes `.` and nothing else, so a consumer cannot reach
// past this file into a module and rebuild a figure without its definition.

export {
  type AbsentFigure,
  type AsOf,
  type Authority,
  type Figure,
  FigureError,
  type Reading,
  absent,
  authoritative,
  figure,
  formatCents,
  readingIsPresent,
  render,
} from './figure.ts';

export {
  type DataTrust,
  DataTrustError,
  type MissingSignal,
  TRUST_KEYS,
  type TrustKey,
  type TrustSignal,
  type TrustState,
  assessDataTrust,
} from './data-trust.ts';

export {
  LiabilityError,
  type LiabilitySnapshot,
  type ThreeNumbers,
  inAdversarialOrder,
  theThreeNumbers,
} from './liability.ts';

export {
  type IndicativeMovement,
  type LiveOpenLiability,
  type SameDayAdjustments,
  liveOpenLiability,
} from './live-liability.ts';

export {
  ADMIN_ORIGIN_VAR,
  type AdminOrigin,
  type Environment,
  OriginError,
  PUBLIC_ORIGIN_VARS,
  type SeparationCheck,
  resolveAdminOrigin,
} from './origin.ts';

export {
  ADMIN_ROLES,
  type AdminRole,
  RoleError,
  mayReadLiabilityHome,
  requireAdminRole,
} from './roles.ts';

export {
  type EligibleNextSevenDays,
  type LiabilityHomeInput,
  type LiabilityHomePage,
  PageError,
  type PanelRendering,
  type PendingPanel,
  ageAtRender,
  assertNamesNoSubject,
  buildLiabilityHome,
  renderLiabilityHome,
} from './page.ts';

/**
 * The deployable starts, and says what it is rather than what it will be.
 *
 * IT DOES NOT RENDER A PAGE. `buildLiabilityHome` needs an environment, a role,
 * a snapshot row and the trust signals, and there is no server here to receive
 * a request carrying them. A `main` that invented inputs in order to print
 * something would be the confidently wrong number AS-M6-04 is about, printed by
 * the process whose subject is not printing it.
 */
export function main(): void {
  console.log(`merit ${SERVICE}: liability home read surface, no server yet`);
}
