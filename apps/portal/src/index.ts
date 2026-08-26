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
// SEVEN OF SECTION 3.1's ELEVEN SCREENS EXIST. The four that do not are
// SC-M4-01 and SC-M4-11 (one auth surface, money path, and P4 section 4.4 says
// inventing a phase for it "is not a plan's to do"), SC-M4-04 the payout centre
// and SC-M4-10 the wallet, which P4 section 6 gives to P5 because both read a
// surface P5 creates. `surface.test.ts` asserts the boundary rather than
// promising it, and this app is the wrong side of it by construction.
//
// EVERYTHING THAT CHANGES ANYTHING IS ABSENT, AND DELIBERATELY. No auth, no
// session handling, no payout request, no destination change, no contact
// change. SECURITY C-27's authority boundary is auth and therefore money path
// under CLAUDE.md's regime table, and ADR-003 gives it its own session with its
// own fresh context. A read-only session that had started on the elevation
// prompt would have spent that session's budget with none of its care.
//
// THERE IS NO FRAMEWORK HERE YET EITHER. M04 section 1.1 names a Next.js App
// Router application; the workspace holds no Next.js, and admitting one is a
// VG-12 dependency decision plus a root lockfile change, which belongs to P1's
// scaffold rather than to a read-surface session. What a framework would render
// is what this app now exports.

/** The Railway service this app deploys as (INFRA section 2). */
export const SERVICE = 'portal' as const;

/**
 * Not an application yet. It is a deployable that starts.
 *
 * IT STILL PRINTS "no surface yet" AND THAT IS ACCURATE RATHER THAN STALE.
 * There are view models and no server: nothing here listens on a port, and a
 * line claiming otherwise would be the first false statement in a module whose
 * whole subject is not making false statements on a screen.
 */
export function main(): void {
  console.log(`merit ${SERVICE}: no surface yet`);
}

// -----------------------------------------------------------------------------
// The wire shapes this app reads. API_CONTRACT sections 3 and 6, transcribed.
// -----------------------------------------------------------------------------
export type {
  AccountDetail,
  AccountListItem,
  AffiliateStats,
  CertificateResponse,
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
  TimelineItem,
} from './api/types.ts';

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
// The shell every screen renders inside. ADR-068 requirement 4, INV-M4-09.
// -----------------------------------------------------------------------------
export { toPortalErrorKind, toShellView } from './shell/app-shell.ts';
export type { ContentState, PortalErrorKind, ShellView } from './shell/app-shell.ts';

export { toImpersonationBanner } from './shell/impersonation-banner.ts';
export type { ImpersonationBannerView, ImpersonationExit } from './shell/impersonation-banner.ts';
