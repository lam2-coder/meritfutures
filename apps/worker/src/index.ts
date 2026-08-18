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
//
// THE FIRST JOB IS THE NIGHTLY BATCH, and it is here as a function rather than
// as a scheduled worker. `runNightlyBatch` takes its ports as an argument and
// this app has no adapter to give it, because no Drizzle client exists yet
// (`packages/db` says so in its own header). What is real is the fold, the row,
// and the hash; what is not is the wiring, and the difference is visible in the
// type rather than left to a reader.

export { foldAccountDay, runNightlyBatch } from './batch/nightly.js';
export type {
  AccountDayFold,
  AccountDayOutcome,
  NightlyBatchConfig,
  NightlyBatchReport,
} from './batch/nightly.js';

export type {
  AccountDay,
  BatchPorts,
  BatchReadPort,
  BatchWritePort,
  ReconciliationFinding,
  ReplayDivergence,
  ReplayDivergenceFinding,
  RuleStateRow,
  StoredContextGates,
} from './batch/ports.js';

// SD-08. Exported because the replay self-audit is the other caller: it will
// re-derive a state and hash it with THIS function, and a second implementation
// of the canonical serialization would make the audit compare two serializers
// rather than two states.
export {
  canonicalStateSerialization,
  stateHash,
  StateHashError,
  EXCLUDED_COLUMNS,
  HASHED_COLUMNS,
} from './batch/state-hash.js';
export { ENGINE_GATE_LEAVES } from './batch/state-hash.js';
export type {
  ExcludedColumn,
  HashedColumn,
  HashedState,
  StateHashSubject,
} from './batch/state-hash.js';

// INV-04's comparison. `ENGINE_GATE_LEAVES` is exported above beside it because
// a divergence names a gate by its dotted path, which is what the list carries
// them for, and a consumer that cannot read the list cannot interpret the name.
//
// STILL NOT SCHEDULED. Nothing calls `runReplayAudit`: there is no cron, and
// `CRON_INVENTORY.md`'s `replay.audit_completed` signal has no producer and no
// entry in the EVENTS.md catalogue. The audit is built and unrun, which is the
// same shape as the batch above it.
export {
  auditAccount,
  diffStoredAgainstRecomputed,
  runReplayAudit,
  ReplayAuditRefusal,
} from './batch/replay.js';
export type {
  AccountDayInput,
  ReplayAccountReport,
  ReplayAuditConfig,
  ReplayAuditReport,
  ReplayMode,
} from './batch/replay.js';

/** The Railway service this app deploys as (INFRA section 2). */
export const SERVICE = 'worker' as const;

/** Still not a scheduled application: the batch exists, the queue does not. */
export function main(): void {
  console.log(`merit ${SERVICE}: nightly batch built, no scheduler yet`);
}
