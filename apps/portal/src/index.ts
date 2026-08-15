// =============================================================================
// apps/portal
// =============================================================================
// Trader dashboard, payout center, certificates, KYC status, referrals.
//
// The authenticated trader surface, and the BOLA blast radius, so it is
// identity-scoped everywhere (OVERVIEW section 3). Every query it makes goes
// through `scopedDb(identity)` from @merit/db; VG-4 is the ESLint rule that
// makes "everywhere" mechanical, and it lands with CI-01.
//
// It deploys as `portal-api` rather than `portal`: the service name is INFRA
// section 2's and is reproduced rather than invented.

/** The Railway service this app deploys as (INFRA section 2). */
export const SERVICE = 'portal-api' as const;

/** Not an application yet. It is a deployable that starts. */
export function main(): void {
  console.log(`merit ${SERVICE}: no surface yet`);
}
