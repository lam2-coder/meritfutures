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
// participates in the same transactions and the same PITR as the money data.
// THE INTERFACE NOW EXISTS AND THE JOB STORE DOES NOT (ADR-086, session 147).
// `@merit/queue` publishes `JobQueue` and `pgBossQueue`, whose `enqueue` takes
// the caller's open transaction as its first argument; what has not landed is
// the migration that installs pg-boss's schema, and `pgBossQueue` is configured
// `migrate: false` precisely so that gap fails loudly rather than being closed
// by a library running DDL on the money database at boot.
//
// NOTHING HERE IMPORTS IT YET, and the reason is a manifest rather than a
// design. `apps/worker/package.json` declares `@merit/rules-engine` and nothing
// else; adding `@merit/queue` to it is outside session 147's fence, and under
// `node-linker=isolated` an undeclared import does not resolve at all. So the
// wiring is one manifest line and one call, in the session that brings the first
// job with it.
//
// THE FIRST JOB IS THE NIGHTLY BATCH, and it is here as a function rather than
// as a scheduled worker. `runNightlyBatch` takes its ports as an argument and
// this app has no adapter to give it. THAT IS NO LONGER BECAUSE THE CLIENT DOES
// NOT EXIST: `packages/db` said so in its own header until ADR-084 landed
// `scopedDb(identity)` and `systemDb(reason)` on 2026-08-23, and that header now
// reads "BOTH HALVES NOW EXIST". What is missing is an adapter implementing
// `BatchPorts` over those accessors, which is a smaller and more specific gap
// than the one this comment used to name. What is real is the fold, the row, and
// the hash; what is not is the wiring, and the difference is visible in the type
// rather than left to a reader.

// -----------------------------------------------------------------------------
// M02's PROVISIONING SAGA (session 222, P3-l)
// -----------------------------------------------------------------------------
// THE FIRST CALLER ADR-006's TRANSACTIONAL-ENQUEUE CRITERION HAS EVER BEEN
// GRADED AGAINST. That entry closed with "enqueue participates in the same
// transaction as the state change that caused it, which removes a whole class
// of saga bugs (committed the purchase, lost the provisioning job)", and
// `job-queue.ts` recorded that nothing in this workspace could produce the
// `JobTransaction` its `enqueue` requires. ADR-102 produced one and
// `enqueueProvisioningOp` calls it.
//
// **THE MANIFEST LINE THIS HEADER HAS ASKED FOR SINCE SESSION 147 IS STILL
// OWED, AND IT IS OWED BY A DIFFERENT SESSION THAN THIS ONE.** The paragraph
// above still stands: `apps/worker/package.json` declares `@merit/rules-engine`
// and nothing else, `node-linker=isolated` makes an undeclared import
// unresolvable, and P3 wave 3's `P3-l` fence holds `src/provisioning/**`,
// this file and `test/provisioning.test.ts` and holds neither the manifest nor
// `pnpm-lock.yaml`. So the saga is written against PORTS, exactly as
// `runNightlyBatch` is, and `src/provisioning/ports.ts` says what each port's
// implementation is and what blocks two of them.
//
// **WHAT IS REAL IS THE PIPELINE, THE DIGEST, THE MACHINE, THE COMPENSATION AND
// THE EXIT; WHAT IS NOT IS THE WIRING**, and the difference is visible in the
// type rather than left to a reader. That is this file's own standard for the
// batch above and it is applied to the saga unchanged.

export {
  PROVISIONING_OPERATIONS,
  PROVISIONING_STATUSES,
  isProvisioningOperation,
  isProvisioningStatus,
} from './provisioning/index.ts';
export type { ProvisioningOperation, ProvisioningStatus } from './provisioning/index.ts';

export {
  BATCH_ID_SHORT_LENGTH,
  ProvisioningPayloadError,
  batchId,
  canonicalPayload,
  payloadHash,
  provisioningFileName,
  renderPayload,
} from './provisioning/index.ts';
export type { ProvisioningPayload, ProvisioningValue } from './provisioning/index.ts';

export {
  LIVE_STATUSES,
  PERMITTED_TRANSITIONS,
  TRANSITION_REFUSALS,
  advance,
} from './provisioning/index.ts';
export type { Transition, TransitionRefusal } from './provisioning/index.ts';

// INV-M2-13. `setpointConfirmation` is the ONLY producer of a
// `SetpointConfirmation`, and the brand's symbol is module-local, so the type
// cannot be constructed anywhere else without a cast.
export {
  ADMISSION_REFUSALS,
  RISK_FLOOR_CENTS_FIELD,
  admitToTrading,
  readProvisioningRow,
  setpointConfirmation,
} from './provisioning/index.ts';
export type {
  AdmissionRefusal,
  AdmissionSubject,
  ProvisioningRow,
  SetpointConfirmation,
  TradingAdmission,
} from './provisioning/index.ts';

export {
  COMPENSATING_OPERATION,
  REVOCATION_ORDER,
  compensationFor,
  inRevocationOrder,
  revocationRank,
} from './provisioning/index.ts';
export type { CompensationOutcome } from './provisioning/index.ts';

export {
  PROVISIONING_QUEUE_NAME,
  buildBatch,
  enqueueProvisioningOp,
  entitleAfterSetpoint,
  runProvisioningSaga,
} from './provisioning/index.ts';
export type {
  EnqueuedIntent,
  EntitlementChange,
  PlatformProvisioningPort,
  ProvisioningAdvancePort,
  ProvisioningBatch,
  ProvisioningIntent,
  ProvisioningJobQueue,
  ProvisioningJobRequest,
  ProvisioningOp,
  ProvisioningReadPort,
  ProvisioningSqlExecutor,
  ProvisioningTx,
  SagaIo,
  SagaOutcome,
} from './provisioning/index.ts';

export { foldAccountDay, runNightlyBatch } from './batch/nightly.ts';
export type {
  AccountDayFold,
  AccountDayOutcome,
  NightlyBatchConfig,
  NightlyBatchReport,
} from './batch/nightly.ts';

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
} from './batch/ports.ts';

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
} from './batch/state-hash.ts';
export { ENGINE_GATE_LEAVES } from './batch/state-hash.ts';
export type {
  ExcludedColumn,
  HashedColumn,
  HashedState,
  StateHashSubject,
} from './batch/state-hash.ts';

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
} from './batch/replay.ts';
export type {
  AccountDayInput,
  ReplayAccountReport,
  ReplayAuditConfig,
  ReplayAuditReport,
  ReplayMode,
} from './batch/replay.ts';

// -----------------------------------------------------------------------------
// THE HOURLY EXPIRY SWEEP (session 291, `P5-j`)
// -----------------------------------------------------------------------------
// THE SECOND SCHEDULED JOB TO EXIST AS CODE, AND THE FIRST ONE THAT PAYS.
// `CRON_INVENTORY`'s release-job table gives THREE clocks to ONE row, on its own
// rule that "a second sweep is a second thing to stall", and `FM-M5-13` is that
// stall: every hold and every freeze silently becoming indefinite at once, with
// no operator having forgotten anything.
//
// **THE THREE CLOCKS ARE THREE DIFFERENT ACTS AND THE THIRD IS NOT WRITABLE BY
// ANY CODE IN THIS TREE.** The hold releases and PAYS (`INV-M5-17`); the
// withdrawal halt releases, resumes the rail and posts NOTHING (`INV-M20-14`);
// the payout freeze's release target is `settled`, which needs
// `effective_trading_day` (no trading calendar exists here) and the win-day
// reset of `INV-M5-07` (no `applySettlement` exists here), so that leg is swept,
// warned on, and REPORTED as an `unreleasable` finding rather than guessed.
// `sweeps/expiry.ts`'s header section 3 is the measurement.
//
// **IT IS WRITTEN AGAINST PORTS AND IT IS UNWIRED, exactly as `runNightlyBatch`
// and the provisioning saga are, and the gap here is a WORD rather than an
// adapter.** `SystemReason` is `'nightly-batch' | 'operator-console'` and an
// hourly sweep is neither; adding a third member is one line in
// `packages/db/src/scoped-db.ts`, which is `P5-a`'s file and not this session's,
// and P5 rule 10 says to report that rather than reach. So
// `ExpirySweepIo.transact` takes the unit of work and the wiring decides the
// authority. WHAT IS REAL IS THE THREE LEGS, THE LOCK, THE KEY DISCIPLINE AND
// THE REPORT; WHAT IS NOT IS THE WIRING, and the difference is visible in the
// type rather than left to a reader.
export {
  EXPIRY_CLOCKS,
  FREEZE_EXPIRING_LEAD_HOURS,
  FREEZE_EXPIRING_LEAD_MS,
  FREEZE_UNRELEASABLE,
  HELD,
  HOLD_COLUMNS,
  PAYOUT_ENDPOINT,
  PAYOUT_PATH,
  WITHDRAWAL_FREEZE_COLUMNS,
  ExpiryRowError,
  clearHold,
  clearWithdrawalHalt,
  expirySweepClean,
  releaseLedgerKey,
  runExpirySweep,
} from './sweeps/expiry.ts';
export type {
  ExpiryClock,
  ExpiryClockReport,
  ExpiryDisposition,
  ExpiryOutcome,
  ExpirySweepReport,
} from './sweeps/expiry.ts';

export { EXPIRY_TABLES, ExpirySweepUnwired, UNWIRED_EXPIRY_SWEEP_IO } from './sweeps/ports.ts';
export type {
  ExpiryEvent,
  ExpiryEventName,
  ExpiryEventPort,
  ExpiryFilter,
  ExpiryFilterTerm,
  ExpiryLedgerPort,
  ExpirySweepIo,
  ExpiryTable,
  ExpiryTerms,
  ExpiryTx,
  ExpiryValues,
  Lt01Values,
} from './sweeps/ports.ts';

/** The Railway service this app deploys as (INFRA section 2). */
export const SERVICE = 'worker' as const;

/**
 * Still not a scheduled application, and the missing piece has moved again.
 *
 * The batch exists, the queue's INTERFACE exists (ADR-086), the provisioning
 * saga exists, and now the hourly expiry sweep does. What is absent is the job
 * store: pg-boss's schema is not in `packages/db/migrations`, so there is
 * nothing to enqueue into, and nothing here installs a scheduler.
 *
 * **THAT ABSENCE IS ITSELF ALARMED AND THAT IS WHY IT IS SAFE TO STATE PLAINLY.**
 * `CRON_INVENTORY` gives the expiry sweep an **S1 dead-man switch on the job's
 * absence**, and `INV-M5-18`'s nightly assertion runs **on the query** rather
 * than on the job, so a deployment with no scheduler is a deployment two
 * unsuppressible alarms are already about to page on.
 */
export function main(): void {
  console.log(
    `merit ${SERVICE}: nightly batch built, provisioning saga built, expiry sweep built, ` +
      'job interface built, no job store and no scheduler yet',
  );
}
