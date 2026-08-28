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
// NOTHING IN THIS PACKAGE MUTATES, and the sentence that said so is NARROWED
// rather than left standing. It read "there is no route, no client and no write
// path in it". `W6-c` landed `src/http/client.ts`, so THERE IS A CLIENT NOW and
// that clause has expired; the other two hold and they are the two the claim
// rests on. The client declares `get` and no second method, reaches only the
// paths `apps/api/src/surface.ts` classifies as operator, and there is no write
// path for it to reach: WAVE-06 wave 5 holds every mutating surface behind
// ADR-171's admin identity provider. So INV-M6-01's audit middleware,
// INV-M6-08's dual control and section 8.1's negative-authz matrix still have
// nothing to attach to and none of them is half-built here. Section 8.1a names
// where the RBAC enumeration starts when the router arrives: `M6-N-09`.
//
// THE TRANSPORT IS ONE FILE AND ITS BASE URL IS RELATIVE. `src/http/client.ts`,
// on ADR-162's precedent, and `src/api/types.ts` holds the shapes it reads,
// transcribed from API_CONTRACT section 8. Neither is a leg of this barrel and
// both are in `ADMIN_MODULES_NOT_RE_EXPORTED` below with their reasons.
// `test/surface.test.ts` asserts the count of `fetch(` call sites, that no
// absolute origin is written anywhere in this package, and that no
// `NEXT_PUBLIC_` identifier appears in it, which are ADR-182 section 5 clauses 1
// and 2 made mechanical for the first time.
//
// The evidence pack is the ONE M06 surface this package does not contain, and
// that sentence named three surfaces two sessions ago. THE ACCOUNT DRILL-DOWN
// (3.2) IS NO LONGER AMONG THEM: `W6-j` landed `src/app/accounts/`. **THE TABLE
// THAT BLOCKED IT AND THE FEED IS REGISTERED AND BOTH ADAPTERS ARE WRITTEN**,
// which is [ADR-191](../../../docs/decisions/ADR-191.md) and session 356:
// `events` is a `TableKey` today, `admin-source/events.ts` supplies `listEvents`
// and `admin-source/account.ts` supplies `readAccount`, and
// `IMPLEMENTED_ADMIN_READS` holds FOUR names where this sentence said two.
// `GET /admin/accounts/:accountId` is registered on the operator surface,
// `AdminReadSource` declares `readAccount`, and all eight sections API_CONTRACT
// section 8 names now read registered tables. IT IS ALSO THE ONE READ IN
// SECTION 8 THE CONTRACT DOES NOT TYPE, so that screen renders the section
// roster and what arrived in each and never a field of one. THE EVENT FEED
// (1.1) IS NO LONGER AMONG THEM EITHER: `W6-h` landed `src/app/feed/`, and it
// was the ONE screen in this package whose route exists and whose adapter could
// not be written until the account drill-down joined it above, on the same table
// and for the same reason. **WHAT BLOCKS BOTH SCREENS NOW IS THE PORT AND NOT A
// TABLE**: no deployment composes `AdminReadSource`, because three of its seven
// methods -- `exportEvidence`, `readLiability` and `searchAccounts` -- have no
// module, so `start.ts` calls no setter and `setAdminReadSource` stays in
// `wiring.test.ts`'s BLOCKED list. Each screen states the measurement as a named
// blocker rather than rendering an invented row. THE FLAGS QUEUE (3.3) AND THE
// IDENTITY DRILL-DOWN (3.2a) ARE NO LONGER AMONG THEM, which is another sentence
// in this header WAVE-06 has narrowed rather than left standing: `W6-f` landed
// `src/app/flags/` and `W6-g` landed `src/app/identities/`. `GET /admin/flags`
// and `GET /admin/identities/:identityId/graph` are registered on the operator
// surface and `listFlags` and `readIdentityGraph` are two of the four entries in
// `IMPLEMENTED_ADMIN_READS` (`apps/api/src/admin-source/index.ts`), so each
// renders real rows the day an operator session exists and neither waits on an
// adapter nobody wrote.
//
// AND THE TWO DRILL-DOWNS ARE THE SCREENS IN THIS PACKAGE THAT MAY RENDER A
// SUBJECT, which is a sentence that named ONE of them until `W6-j`.
// `INV-M6-10` grants trader-identifying data only where the query names one,
// and M06 section 3.2a is where the bound on that licence is written for the
// identity: no index route, no search, no list. `src/app/identities/` holds one
// dynamic segment and the document module, and `test/identity-render.test.ts`
// asserts the directory rather than the intention.
//
// `src/app/accounts/` HOLDS THE SAME TWO FILES AND NO INDEX, FOR TWO REASONS
// RATHER THAN ONE. Section 3.2 states no browse bound of its own, so the fence
// is the first reason: the search surface is a different contract row and
// `AdminReadSource.searchAccounts` is owned by no plan at all. The second
// outlives the fence: an index with no query behind it is `FM-M6-10`, and the
// registered endpoint already refuses one by making `?query=` a validation
// failure when absent rather than an implied "everybody".
//
// THE TWO LICENCES ARE NOT THE SAME SIZE, AND THE DIFFERENCE IS THE CONTRACT
// RATHER THAN THE SCREEN. The identity drill-down checks every served id
// against the graph its query resolved, because `IdentityGraph` declares those
// members. The account drill-down has one id in its closure and cannot check a
// root at all, because its response declares no field to check one against.
//
// THERE IS A RENDERED DOCUMENT NOW, WHICH IS THE THIRD SENTENCE IN THIS HEADER
// THAT `WAVE-06` HAS NARROWED RATHER THAN LEFT STANDING. `W6-d` landed
// `src/app/`: the root layout, the liability home at `/`, and the module that
// turns a `LiabilityHomePage` value into the bytes a browser receives, with
// `INV-M6-10` asserted over those bytes rather than over a line array.
//
// NO MODULE UNDER `src/app/` IS A LEG OF THIS BARREL, AND NONE IS IN THE ABSENT
// LIST EITHER. That is a decision rather than an oversight. A route module is
// the framework's entry point and not a name a consumer imports; `package.json`
// publishes `.` and nothing else, and putting a React element on this read
// surface would widen it from the figures and folds it exists to publish. Both
// lists below are spelled in `.ts` and `B.2`'s sweep reads `.ts`, so that
// directory is outside both by construction. `test/render.test.ts` carries the
// sweeps that cover it.
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
 * **IT SHIPPED EMPTY AND `W6-c` IS THE FIRST SLICE TO USE IT**, which is the
 * case `W6-b` wrote it for and said so: the alternative is that the first slice
 * needing an unexported module has to weaken the sweep to land, and a gate
 * weakened to pass it is the one thing the conventions forbid outright. A module
 * belongs here when there is a reason to write down, and the suite asserts the
 * reason is written rather than left blank.
 *
 * **THE TWO ENTRIES ARE THE TRANSPORT SEAM, AND EACH STATES BOTH ITS REASON AND
 * ITS COST.** `src/api/types.ts` and `src/http/client.ts` are the shapes this
 * console reads and the one call that reads them; neither is the read surface
 * this barrel publishes, which is figures and folds. Being in this list means
 * `B.1` and `B.5` do not reach them, so `test/surface.test.ts` asserts that this
 * list holds exactly these two entries and that neither module's names reach the
 * package surface. **That is an absence checked in both directions rather than a
 * hole**, and it is where a later slice looks before adding a third entry.
 *
 * AN ALLOWLIST THAT FAILS IN BOTH DIRECTIONS: an unlisted module with no leg is
 * the obvious failure, and a stale entry for a module that no longer exists is
 * how a list silently grants more than it names.
 */
export const ADMIN_MODULES_NOT_RE_EXPORTED: Readonly<Record<string, string>> = {
  './api/types.ts':
    'W6-c. The wire shapes, transcribed from API_CONTRACT sections 8 and 9. They are NOT the read ' +
    'surface this barrel publishes: every one of the 74 names above is a figure, a fold or a ' +
    "rendering, and a wire type is the shape of somebody else's document. API_CONTRACT is the " +
    'authority for it and `@merit/admin` offering a second import site for a contract shape is a ' +
    'second place to read the contract from. THE COST IS STATED RATHER THAN HIDDEN: B.1 and B.5 do ' +
    'not reach a module in this list, so `test/surface.test.ts` asserts instead that this list ' +
    "holds exactly these two entries and that neither module's names reach the package surface, " +
    'which turns the absence into a checked property rather than a hole. AND THE PROMOTION IS ' +
    'STILL OWED AND NO SLICE IN THIS WAVE MAY TAKE IT, WHICH IS NOW A FENCE RATHER THAN A ' +
    'SHORTFALL: B.1 requires a leg to declare more than three exports, and where W6-f and W6-g ' +
    'left this module three declarations short of nothing but the count, W6-h has taken it to ' +
    'SIX, `LiabilityResponse`, `FlagListItem`, `IdentityGraph`, `EventFeedQuery`, ' +
    '`AdminEventItem` and `EventFeedResponse`, so the count no longer holds the promotion back ' +
    'and the fence alone does. AND THE FENCE IS MECHANICAL rather than a preference: ' +
    '`test/service.test.ts` pins the surface at 74 names ' +
    'over 8 legs and derives its compile-time coverage from its own source, and ' +
    '`test/surface.test.ts` pins this list at exactly two entries, so a ninth leg cannot land ' +
    'without both files moving and no slice in WAVE-06 holds either.',
  './http/client.ts':
    "W6-c. The console's one `fetch`, on ADR-162's precedent. It is deliberately NOT on the " +
    'package surface: `package.json` publishes `.` and nothing else, so re-exporting ' +
    "`createAdminApiClient` would put this package's only network primitive on the very surface " +
    'this slice exists to narrow to one file. Every consumer of it is INSIDE this package and ' +
    'reaches it by relative path, which is measured rather than assumed: no file under ' +
    "`apps/portal/src/app/` reads the portal's client through `src/index.ts` and every one of " +
    "them imports `../../http/client.ts` directly, so the portal's stated reason for exporting " +
    'it (that a transport behind a deep relative path gets written again) is not what its own ' +
    'segments do. `test/surface.test.ts` carries the assertions this costs.',
};

/**
 * The package says what it is.
 *
 * TWO SENTENCES HERE WERE TRUE UNTIL THIS COMMIT AND THE CORRECTION IS THE
 * POINT OF THE EDIT. This docstring read "there is no server here to receive a
 * request carrying them" and the body printed "no server yet". ADR-182 section
 * 8 item 3 recorded both as stale in INTENT on the day `start` became `next
 * start`, and refused to reach past its fence to repair them; WAVE-06 section 9
 * named `W6-d` as the slice that makes them false in FACT. This is that slice:
 * `src/app/layout.tsx` and `src/app/page.tsx` exist, `next build` compiles a
 * served route from them, and `next start` is what the Railway service runs.
 *
 * SO `main()` IS NOT THE ENTRY POINT AND IS NOT ON THE REQUEST PATH. It is one
 * line that names the deployable, `test/service.test.ts` runs it, and nothing
 * that serves a byte reads it.
 *
 * AND THE HALF THAT WAS NEVER STALE IS UNCHANGED: NOTHING HERE INVENTS AN
 * INPUT. `buildLiabilityHome` needs an environment, a role, a snapshot row and
 * the trust signals, and `src/app/page.tsx` names the three things that block a
 * supplier and renders THEM with their reasons instead. It used to render a 503,
 * and ADR-190 clause 5 removed that: a screen renders no error kind it did not
 * receive, this route performs no read, so the page carries no `AdminErrorKind`
 * at all rather than a corrected one. A `main` that invented
 * inputs in order to print something would be the confidently wrong number
 * AS-M6-04 is about, printed by the process whose subject is not printing it.
 */
export function main(): void {
  console.log(
    `merit ${SERVICE}: liability home read surface. The service is served by ` +
      '`next start` and this module is the package export surface rather than its entry point',
  );
}
