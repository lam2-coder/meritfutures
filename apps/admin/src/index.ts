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
// (3.3) and the evidence pack are M06 surfaces this package does not contain.
//
// THE EVENT FEED WAS IN THAT SENTENCE AND IS NOT ANY MORE, WHICH IS THE SMALLER
// HALF OF WHAT `W6-b` FOUND. `feed.ts` landed as M06 section 1.1's fifth
// surface and this file never learned it, so the sentence describing the
// package went on saying the feed was absent while the module sat one directory
// away exporting fourteen names. A barrel that omits a module omits the
// module's description of itself too, and both were wrong in the same way.

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
  RCR_BREAKER_BP,
  type ReserveCoverage,
  type ReserveCoverageSnapshot,
  TREASURY_SOURCES,
  type ThreeNumbers,
  type TreasurySource,
  formatRatioBp,
  inAdversarialOrder,
  requireTreasurySource,
  reserveCoverage,
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
  type Feed,
  FeedError,
  type FeedEvent,
  type FeedInput,
  type FeedRow,
  type FeedScope,
  WITHHELD,
  assertWithheld,
  buildFeed,
  mayReadEventFeed,
  namesASubject,
  renderFeed,
  renderRow,
  thread,
} from './feed.ts';

export {
  type EligibleNextSevenDays,
  type LiabilityHomeInput,
  type LiabilityHomePage,
  PageError,
  type PanelRendering,
  type PendingPanel,
  ageAtRender,
  assertFloatIsNotReserve,
  assertNamesNoSubject,
  buildLiabilityHome,
  renderLiabilityHome,
} from './page.ts';

// =============================================================================
// THE BARREL'S OWN LEGS, AS DATA, BECAUSE A TYPE CHECKER CANNOT SEE AN EXPORT
// THAT WAS NEVER WRITTEN
// =============================================================================
// WAVE-06 section 5.1 measured this file and found it re-exported 51 of the 74
// names its modules declare. Twenty-three were missing: all fourteen of
// `feed.ts`, because the module is not a leg at all; eight of `liability.ts`,
// which `P5-l` added without extending the list; and `assertFloatIsNotReserve`
// from `page.ts`, the same omission one file over. `package.json` publishes `.`
// and nothing else, so each of those was a name no consumer in this workspace
// could import.
//
// **NOTHING WAS DELETED HERE. THE NAMES WERE NEVER ADDED**, and that difference
// decides the shape of the check rather than excusing it.
//
// -----------------------------------------------------------------------------
// WHAT `apps/api/src/admin-source/index.ts` KEEPS TWO OF, AND WHAT TRANSFERS
// -----------------------------------------------------------------------------
// That file carries two independent defences against a keep-both merge dropping
// a leg, and its header argues both: a COMPILE-TIME half, where
// [`IMPLEMENTED_ADMIN_READS:178`](../../api/src/admin-source/index.ts) is data
// and the return type is a `Pick` over it, so losing either half is a type error
// naming the member; and a RUN-TIME half, a `Partial` whose refusal names the
// missing method at the first request. Neither subsumes the other and the file
// keeps both.
//
// **THE `Pick` HALF DOES NOT TRANSFER AND `apps/worker/src/index.ts` ALREADY
// SAYS WHY**: a re-export list has no runtime value for a type to be taken over,
// and minting an object whose only purpose is to be checked would put a second
// copy of the surface in the file whose job is to have one. What transfers is
// the PRINCIPLE, which is that one defence is not enough and the two must fail
// at DIFFERENT TIMES. `test/service.test.ts` builds both:
//
//   COMPILE TIME. The suite imports every one of these names FROM THIS FILE, by
//   name, and binds each to its own module's declaration. Drop a name here and
//   `pnpm run typecheck` fails naming it. That is the gate that was green over
//   the 2026-08-28 worker deletion, and this is what puts a barrel inside it.
//
//   RUN TIME. The suite reads each module's SOURCE and asserts this file
//   re-exports every name it declares. The compile half cannot do that: a name
//   nobody has ever imported is a name nobody misses, which is exactly how all
//   23 of these went unnoticed. Only a check that reads the module can see a
//   name that was never added.
//
// **SO THE COMPILE HALF CATCHES DELETIONS EARLY AND BY NAME, AND THE TEXT HALF
// CATCHES OMISSIONS AT ALL.** Neither subsumes the other, and a third case
// asserts that the barrel's binding IS the module's binding, so a name
// re-exported from the wrong place fails too, which neither of the other two
// can see.
//
// The lists below are the module-granular layer, in `WORKER_BARREL_LEGS`'s
// idiom ([`apps/worker/src/index.ts:1038`](../../worker/src/index.ts)). They are
// what would have caught `feed.ts`: a module that is neither a leg nor
// deliberately absent is a module nobody has decided about, and the suite sweeps
// `src/` totally against them.
// =============================================================================

/**
 * Every module this barrel re-exports, by the specifier it re-exports it under.
 *
 * SORTED, AND APPEND-ONLY. A slice that adds a leg adds its line here in the
 * same change, which costs one line and is the whole price of the sweep.
 */
export const ADMIN_BARREL_LEGS = [
  './data-trust.ts',
  './feed.ts',
  './figure.ts',
  './liability.ts',
  './live-liability.ts',
  './origin.ts',
  './page.ts',
  './roles.ts',
] as const;

/**
 * Modules this barrel deliberately does NOT re-export, each with its reason.
 *
 * **IT IS EMPTY TODAY AND THAT IS THE HONEST STARTING STATE**, not an oversight:
 * every module under `src/` is a leg, so the sweep above is currently total and
 * the escape hatch has nothing in it. It exists anyway because the alternative
 * is that the first slice needing an unexported module has to weaken the sweep
 * to land, and a gate weakened to pass it is the one thing the conventions
 * forbid outright. A module belongs here when there is a reason to write down,
 * and the suite asserts the reason is written rather than left blank.
 *
 * AN ALLOWLIST THAT FAILS IN BOTH DIRECTIONS: an unlisted module with no leg is
 * the obvious failure, and a stale entry for a module that no longer exists is
 * how a list silently grants more than it names.
 */
export const ADMIN_MODULES_NOT_RE_EXPORTED: Readonly<Record<string, string>> = {};

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
