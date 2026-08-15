// =============================================================================
// apps/worker
// =============================================================================
// Nightly batch, provisioning delivery, Rise transfers, detectors, hygiene
// jobs. Long-running and retryable work must never sit in a request path
// (OVERVIEW section 3).
//
// UNDER apps/ AND NOT packages/, ruled as a plan decision in P1 section 2.1
// because OVERVIEW's container table is the one row with no path prefix. It is
// a deployable with its own lifecycle, not a library anything imports. Putting
// it under `packages/` would make "apps are deployables, packages are
// libraries" false in exactly one place, and that rule is load-bearing: VG-4 is
// phrased over app paths, and a rule phrased over app paths is expressible only
// if app paths are a glob.
//
// The queue is pg-boss inside the same Postgres (ADR-006), so the job store
// participates in the same transactions and the same PITR as the money data. It
// arrives with the first job.

/** The Railway service this app deploys as (INFRA section 2). */
export const SERVICE = 'worker' as const;

/** Not an application yet. It is a deployable that starts. */
export function main(): void {
  console.log(`merit ${SERVICE}: no jobs yet`);
}
