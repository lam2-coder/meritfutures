// =============================================================================
// apps/portal
// =============================================================================
// Trader dashboard, payout center, certificates, KYC status, referrals.
//
// The authenticated trader surface, and the BOLA blast radius, so it is
// identity-scoped everywhere (OVERVIEW section 3). Every query it makes goes
// through `scopedDb(identity)` from @merit/db; VG-4 is the ESLint rule that
// makes "everywhere" mechanical, and it is wired: `merit/no-raw-db-client`
// runs over this path in CI-01 and blocks merge on a raw client import.
//
// It deploys as `portal`, INFRA section 2.1's name, reproduced not invented. It
// read `portal-api` until ADR-089 ruled that name a fused PROCESS, not an origin.
//
// -----------------------------------------------------------------------------
// WHAT IS BUILT, AND WHAT THE ABSENCES MEAN
// -----------------------------------------------------------------------------
// M04's READ SURFACES ARE HERE: the account list and detail (SC-M4-02,
// SC-M4-03), the equity series, the timeline, the eligibility display, the
// rules page (SC-M4-05), purchases and the rule diff (SC-M4-06), KYC status
// (SC-M4-07), certificates (SC-M4-08), referrals (SC-M4-09), section 3.8's
// economic-calendar panel, and the shell that carries ADR-068's impersonation
// band. Each is a pure function from a wire shape to a render-ready shape, with
// the module's invariants expressed as types rather than as habits: a required
// `as_of_trading_day` (INV-M4-02), formatted money strings (INV-M4-01), a
// three-valued gate state (INV-M4-05), a branded `CopyBlock` no literal can
// satisfy (INV-M4-08), and a branded `DisclosureBlock` for the two compliance
// obligations that are not rule text (INV-M4-09, NFA I-26-12).
//
// ALL ELEVEN OF SECTION 3.1's SCREENS NOW HAVE A ROUTE, AND THE COUNT IS
// DERIVED FROM `next build`'s OWN ROUTE TABLE RATHER THAN FROM THIS PARAGRAPH'S
// PREDECESSOR. That predecessor read "EIGHT ... THE THREE THAT DO NOT ARE
// SC-M4-01, SC-M4-10 AND SC-M4-11", and it was already stale when this session
// read it: SC-M4-10 and SC-M4-11 landed with `app/wallet/` and `app/security/`,
// and the export blocks at the foot of this file were updated for them while
// this paragraph was not. Both halves of that drift are repaired here.
//
// So the screens with a route are SC-M4-01 `/sign-in`, SC-M4-02 `/accounts`,
// SC-M4-03 `/accounts/[account]`, SC-M4-04 `/payouts`, SC-M4-05
// `/calendar/[accountId]/rules`, SC-M4-06 `/purchases`, SC-M4-07 `/kyc`,
// SC-M4-08 `/certificates`, SC-M4-09 `/referrals`, SC-M4-10 `/wallet` and
// SC-M4-11 `/security`. Section 3.8's economic-calendar panel claims no
// `SC-M4-nn` by `M04:189` and has a route of its own at `/calendar`.
//
// A ROUTE FOR EVERY SCREEN IS NOT A WORKING PRODUCT AND THIS PARAGRAPH DOES NOT
// SAY IT IS. SC-M4-01 renders three factors and NONE of them can be completed:
// all four routes behind it are registered and not one is wired, and
// `app/sign-in/availability.ts` carries the measurement with each blocker
// quoted. The screen states that rather than standing in for a sign-in, which
// is the same rule `app/page.tsx` follows about inventing an account.
//
// `surface.test.ts` asserts the write boundary rather than promising it, and
// this app is the wrong side of it by construction.
//
// EVERYTHING THAT CHANGES ANYTHING IS ABSENT, AND DELIBERATELY. No session
// minting, no session handling, no payout request, no destination change, no
// contact change. SECURITY C-27's authority boundary is auth and therefore money
// path under CLAUDE.md's regime table, and ADR-003 gives it its own session with
// its own fresh context. A read-only session that had started on the elevation
// prompt would have spent that session's budget with none of its care.
//
// "No auth" WAS THE FIRST CLAUSE AND IT IS NARROWED RATHER THAN DELETED, which
// is `surface.test.ts`'s own rule about amending a fence: "a session that
// deletes an entry instead of narrowing it has removed the control while
// appearing to satisfy it." SC-M4-01 exists as a SCREEN and submits nothing:
// every control on it carries `submits_to: null` typed as the literal, exactly
// as the payout centre's and the session list's do, and the write half of the
// clause is untouched. THE TRANSPORT HAS A `post` FROM ADR-219 AND NO SEGMENT
// CALLS IT: that entry ships the verb and wires no page, so "submits nothing"
// is a property of the six segments rather than of the client.
//
// THERE IS TRANSPORT NOW, AND IT IS ONE FILE. `src/http/client.ts`, ADR-162.
// THE SENTENCE THAT FOLLOWED IT IS CORRECTED RATHER THAN LEFT STANDING: it read
// "`app/payouts/` is the one segment wired to it. The other five still render
// from ports and reach nothing", and the other five have since been wired. All
// SIX segments reach the client today -- `(purchases)/source.ts`,
// `accounts/source.ts`, `calendar/load.ts`, `kyc/source.ts` and `kyc/page.ts`,
// `payouts/source.ts`, `referrals/data.ts` and `referrals/page.ts` -- and there
// is still exactly one client, which is what the old sentence was protecting.
//
// THE FRAMEWORK ARRIVED AND THIS PARAGRAPH IS CORRECTED RATHER THAN LEFT
// STANDING. It read "the workspace holds no Next.js, and admitting one is a
// VG-12 dependency decision plus a root lockfile change". ADR-095 made that
// admission and session 250 landed `next.config.mjs`, `app/layout.tsx` and the
// root page, so `pnpm-workspace.yaml` pins `next: 16.3.2` and this application
// renders documents. The sentence is repaired here because this session is the
// first to IMPORT that framework -- `src/http/client.ts` reaches
// `next/headers.js` for the inbound cookie -- and a header claiming the
// dependency does not exist would be false beside a file that resolves it.

/** The Railway service this app deploys as (INFRA section 2). */
export const SERVICE = 'portal' as const;

/**
 * The `main` a `node src/index.ts` invocation would reach, which is not how this
 * application is served.
 *
 * "no surface yet" WAS ACCURATE AND IS NOW FALSE, SO THE LINE MOVES. The old
 * comment argued the string was "accurate rather than stale ... nothing here
 * listens on a port, and a line claiming otherwise would be the first false
 * statement in a module whose whole subject is not making false statements on a
 * screen". `pnpm --filter @merit/portal build` prints a route table of FIFTEEN
 * entries and `next start` listens, so the false statement is now the old one
 * and the same argument requires the repair. The number is re-derived from that
 * build on the way past rather than carried: it read TWELVE, and three routes
 * have landed since.
 *
 * WHAT IT SAYS INSTEAD IS THE THING A READER OF THIS ENTRY POINT NEEDS. `next`
 * serves `src/app/`; nothing routes through this function, and a caller who
 * reached it wanted the framework's server rather than this module's.
 */
export function main(): void {
  console.log(`merit ${SERVICE}: served by \`next start\`, not by this entry point`);
}

// -----------------------------------------------------------------------------
// The wire shapes this app reads. API_CONTRACT sections 3 and 6, transcribed.
// -----------------------------------------------------------------------------
// EVERY NAME `./api/types.ts` EXPORTS APPEARS BELOW, AND THAT IS NOW MECHANICAL.
// `test/api-types.test.ts` derives both lists from the two files and fails on a
// name in one and not the other, so this block cannot fall behind that file the
// way it had. `CursorPage` and the two page bounds are what it caught: the
// envelope every paginated endpoint in section 1 returns was reachable from
// three modules inside this application and from nothing outside it, so a
// consumer could name `MarkListItem` and could not name the shape the endpoint
// actually sends. The bounds are the contract's own numbers and the alternative
// to exporting them is the next caller writing `25` and `100` as literals.
export type {
  AccountDetail,
  AccountListItem,
  AffiliateStats,
  AuthFactor,
  CertificateResponse,
  CursorPage,
  EconomicCalendarFreshness,
  EconomicCalendarOccurrence,
  EconomicCalendarPanelResponse,
  EligibilityGates,
  EligibilityResponse,
  ImpersonationSession,
  JsonValue,
  KycStatus,
  MarkListItem,
  PlanRules,
  PlanSize,
  PlanVersionResponse,
  PurchaseListItem,
  SessionRow,
  TimelineItem,
  WalletCredit,
  WalletDebit,
  WalletDirection,
  WalletEntriesResponse,
  WalletEntry,
  WalletEntryBase,
  WalletHold,
  WalletHoldRule,
  WalletProvenance,
  WalletResponse,
} from './api/types.ts';
export { PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX } from './api/types.ts';

// -----------------------------------------------------------------------------
// ADR-162. The one file in this application that performs a network call.
// -----------------------------------------------------------------------------
// `apps/portal/test/surface.test.ts` used to assert that NO file here holds a
// `fetch(`; it now asserts that exactly `src/http/client.ts` does, per needle,
// with `XMLHttpRequest`, `WebSocket` and `EventSource` still at zero files. The
// client is exported because five other segments need this one and not a sixth,
// and because a transport reachable only through a deep relative path is a
// transport the next author writes again.
export {
  API_BASE_PATH,
  API_ORIGIN_VAR,
  ApiConfigError,
  SESSION_COOKIE,
  createApiClient,
  resolveApiOrigin,
  serverApiClient,
} from './http/client.ts';
export type {
  ApiClient,
  ApiFailure,
  ApiResult,
  ApiSuccess,
  SessionToken,
  Transport,
} from './http/client.ts';

// -----------------------------------------------------------------------------
// INV-M4-01's only permitted consumer of a money field.
// -----------------------------------------------------------------------------
export {
  formatBasisPoints,
  formatCents,
  formatOptionalBasisPoints,
  formatOptionalCents,
} from './format/money.ts';

// -----------------------------------------------------------------------------
// INV-M4-08. A rule sentence the portal cannot have written.
// -----------------------------------------------------------------------------
export { COPY_KEYS, MissingCopyBlockError, copyBlock } from './copy/copy-block.ts';
export type { CopyBlock, PinnedPlanCopy } from './copy/copy-block.ts';

// -----------------------------------------------------------------------------
// The read surfaces.
// -----------------------------------------------------------------------------
export type { AccountState, Tier, Tiered } from './view/as-of.ts';

export { toAccountCard, toAccountDetail, toAccountList } from './view/accounts.ts';
export type {
  AccountCardView,
  AccountDetailView,
  BlockedReason,
  CadenceView,
  ConsistencyView,
  EvalProgressView,
  FundedProgressView,
  NoProgressView,
  ProgressView,
} from './view/accounts.ts';

export { toEligibilityView } from './view/eligibility.ts';
export type {
  ConsistencyMeterView,
  EligibilityView,
  GateFact,
  GateId,
  GateState,
  GateView,
} from './view/eligibility.ts';

export { toEquitySeries } from './view/marks.ts';
export type { EquityPlotValues, EquityPointView, EquitySeriesView } from './view/marks.ts';

export { toTimelineView } from './view/timeline.ts';
export type { TimelineDetail, TimelineEntryView, TimelineView } from './view/timeline.ts';

export { toEconomicCalendarPanel } from './view/economic-calendar.ts';
export type { EconomicCalendarPanelView, ReleaseView } from './view/economic-calendar.ts';

// -----------------------------------------------------------------------------
// P4-h's five screens. SC-M4-05 to SC-M4-09.
// -----------------------------------------------------------------------------

export { toRulesView } from './view/rules.ts';
export type { RuleClauseView, RuleSizeView, RulesPageView } from './view/rules.ts';

export { toPurchaseHistory, toRuleDiff } from './view/purchases.ts';
export type {
  PurchaseHistoryView,
  PurchaseRowView,
  RuleChangeKind,
  RuleChangeView,
  RuleDiffView,
} from './view/purchases.ts';

export {
  INTERNAL_TIER_TERMS,
  InternalTierLanguageError,
  KYC_STATES,
  UnknownKycStateError,
  toKycStatusView,
} from './view/kyc.ts';
export type { KycNextStep, KycState, KycStatusView } from './view/kyc.ts';

// INV-M4-09 and NFA I-26-12, as a brand no literal can satisfy.
export { MissingDisclosureError, disclosureBlock } from './view/disclosure.ts';
export type { DisclosureBlock, DisclosureSource } from './view/disclosure.ts';

export { UnverifiableCertificateError, toCertificateView } from './view/certificates.ts';
export type { CertificateClaimsView, CertificateView } from './view/certificates.ts';

export { toReferralPanel } from './view/referrals.ts';
export type {
  ReferralActivityView,
  ReferralEarningsView,
  ReferralPanelView,
} from './view/referrals.ts';

// -----------------------------------------------------------------------------
// SC-M4-10 and SC-M4-11, the two screens section 3.1 named and this app did not
// serve. Measured from the build rather than from the plan: `pnpm --filter
// @merit/portal build` printed twelve routes covering SC-M4-02 to SC-M4-09 and
// neither of these, and all four endpoints they read were confirmed through
// `CompositionReport.registered` over a real `compose()`.
//
// NOTHING RE-EXPORTED HERE PERFORMS OR PREPARES A WRITE, which is the fence
// `test/surface.test.ts`'s third test asserts and which this pair of screens is
// the closest any read surface has come to. Both of them RENDER a control for a
// C-27 sensitive action and neither of them has a route to submit it to: every
// such control carries a `submits_to`/`revokes_at` typed as the literal `null`.
// UNTIL ADR-219 THE REASON WAS THAT ../http/client.ts's `ApiClient` DECLARED
// `get` AND NOTHING ELSE. It declares `post` now, and the `null`s did not move:
// that entry ships the transport and wires no page, so the reason is the
// segments' rather than the transport's and wiring one is a type change.
// -----------------------------------------------------------------------------

export { toWalletView, walletFraming } from './view/wallet.ts';
export type {
  WalletBalanceView,
  WalletCopy,
  WalletEntryView,
  WalletExitId,
  WalletExitView,
  WalletExitsView,
  WalletHoldView,
  WalletStatementView,
  WalletView,
} from './view/wallet.ts';

export { factorLabel, isRevocable, toSecurityView } from './view/sessions.ts';
export type { ActiveSessionView, SecurityGap, SecurityView } from './view/sessions.ts';

// -----------------------------------------------------------------------------
// SC-M4-01, the last row of section 3.1 with no route, and the one screen here
// that reads nothing at all.
//
// IT IS PRE-IDENTITY, so there is no identity-scoped read to perform and
// API_CONTRACT gives this surface no GET: every endpoint behind it is a POST,
// and while `./http/client.ts` has carried a `post` since ADR-219, that entry
// wires no page and this screen still calls nothing. What is
// exported is the view model and the measurement it is built from, so a
// consumer can read what this deployment can serve without importing a route
// segment. NOTHING HERE PERFORMS OR PREPARES A WRITE: every control carries a
// `submits_to` typed as the literal `null`, on the wallet's and the session
// list's precedent, and `test/surface.test.ts`'s money-path name fence passes
// over these exports unamended.
// -----------------------------------------------------------------------------

export { SIGN_IN_FACTORS, toSignInView } from './view/sign-in.ts';
export type { FactorAvailability, SignInFactorView, SignInView } from './view/sign-in.ts';

// -----------------------------------------------------------------------------
// The shell every screen renders inside. ADR-068 requirement 4, INV-M4-09.
// -----------------------------------------------------------------------------
export { toPortalErrorKind, toShellView } from './shell/app-shell.ts';
export type { ContentState, PortalErrorKind, ShellView } from './shell/app-shell.ts';

export { toImpersonationBanner } from './shell/impersonation-banner.ts';
export type { ImpersonationBannerView, ImpersonationExit } from './shell/impersonation-banner.ts';
