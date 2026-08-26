// =============================================================================
// packages/affiliate
// =============================================================================
// M08's attribution fold, and nothing else yet.
//
// WHAT IS IN THIS PACKAGE IS DECIDED BY WHAT P3 SAYS `P3-n` CONTAINS, and P3
// section 12 states the boundary in one sentence: "M08's content in P3 is
// COUPONS AND AFFILIATE ATTRIBUTION and attribution is where it stops. The
// commission clock and the payout leg are P5's with the rest of the payout
// rail. `P3-n` writes the attribution and no commission."
//
// So `commission.ts` and `clawback.ts` are named by session 162's `M08-6` and
// `M08-7`, are not in this fence, and are deliberately absent rather than
// stubbed. A stub of a money computation is a shape a later caller imports
// before anybody has ruled what it returns.
//
// IT DECLARES NO DEPENDENCY, WHICH IS WHAT LETS `apps/api` IMPORT IT WITHOUT
// ADMITTING ANYTHING. The one line `pnpm-lock.yaml` gains for this package is
// its own importers block plus the workspace link under `apps/api`; no catalog
// entry moves and no registry package is added, so VG-12 is asked to admit
// nothing. `pnpm-workspace.yaml` is UNTOUCHED, because its `packages/*` glob
// already covers this directory: session 162's `M08-5` predicted a serial
// collision on that file and the glob makes the prediction wrong, which is
// recorded here rather than left as a surprise for the next package.
// =============================================================================

export {
  LAST_TOUCH_WINDOW_DAYS,
  LAST_TOUCH_WINDOW_MS,
  LINKED_SELF_DEAL_VOID_REASON,
  LITERAL_SELF_DEAL_VOID_REASON,
  AttributionError,
  resolveAttribution,
  withinLastTouchWindow,
  type AffiliateRef,
  type AttributionDecision,
  type AttributionInput,
  type AttributionModel,
  type AttributionRow,
  type ClickRef,
  type LinkConfidence,
  type NoAttributionReason,
} from './attribution.ts';
