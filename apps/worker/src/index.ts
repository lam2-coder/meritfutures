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
// design. `apps/worker/package.json` declares `@merit/rules-engine` AND
// `@merit/db` (ADR-165, session 292) and nothing else; adding `@merit/queue` to
// it is outside session 147's fence, and under `node-linker=isolated` an
// undeclared import does not resolve at all. So the wiring is one manifest line
// and one call, in the session that brings the first job with it.
//
// THIS SENTENCE READ "AND NOTHING ELSE" UNTIL 2026-08-27 AND ADR-165 MADE IT
// FALSE. That entry's section 10 finding 2 named both occurrences in this file,
// reported them rather than reaching into a file it was fenced out of, and said
// "whoever holds it next repairs the sentence in the same commit". This is that
// commit.
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
// OWED FOR `@merit/queue`, AND IT IS OWED BY A DIFFERENT SESSION THAN THIS
// ONE.** The paragraph above still stands FOR THE QUEUE: `@merit/queue` is not
// in `apps/worker/package.json`, `node-linker=isolated` makes an undeclared
// import unresolvable, and P3 wave 3's `P3-l` fence holds `src/provisioning/**`,
// this file and `test/provisioning.test.ts` and holds neither the manifest nor
// `pnpm-lock.yaml`. **IT NO LONGER STANDS FOR THE ACCESSOR**, which ADR-165
// admitted; the second half of finding 2 is repaired here with the first. So the saga is written against PORTS, exactly as
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
// **THE THREE CLOCKS ARE THREE DIFFERENT ACTS AND THE THIRD IS NOT WRITABLE
// FROM THIS PATH.** The hold releases and PAYS (`INV-M5-17`); the withdrawal
// halt releases, resumes the rail and posts NOTHING (`INV-M20-14`); the payout
// freeze's release target is `settled`, which needs `effective_trading_day` and
// so an exchange session calendar, and `merit/no-calendar-in-expiry-path` bans
// that import in this exact path by glob under ADR-042 -- a rule whose own
// header names THIS SWEEP as the failure it was written for. `INV-M5-07`'s
// `applySettlement` EXISTS, in `packages/rules-engine/src/payout/settle.ts`, and
// takes a `CalendarSlice`, so calling it needs the very import that rule
// forbids. So that leg is swept, warned on, and REPORTED as an `unreleasable`
// finding rather than guessed. `sweeps/expiry.ts`'s header section 3 is the
// measurement, and AN EARLIER DRAFT OF IT CLAIMED THE FUNCTION DID NOT EXIST AT
// ALL, WHICH WAS FALSE -- a truncated grep read as an absence, which is the
// error class CLAUDE.md names by name. The correction makes the blocker a
// checkable control rather than a gap somebody could close by writing a
// function, and `test/expiry.test.ts` now asserts both halves of it.
//
// **IT IS WRITTEN AGAINST PORTS AND IT IS STILL UNWIRED, but the reason it gave
// for that has been RULED AND IS NO LONGER TRUE.** This header said the gap was
// a WORD: that `SystemReason` is `'nightly-batch' | 'operator-console'`, that an
// hourly sweep is neither, and that adding a third member was `P5-a`'s line to
// write. **ADR-165 (session 292) ruled the opposite and ruled it better**:
// `SystemReason` gains NO member, because `'nightly-batch'` "already names what
// a detector run, a fold, a sweep and a nightly assertion each are", and this
// deployable now takes exactly ONE door at `src/db.ts`. So the vocabulary was
// never the obstacle and P5 rule 10 was right to forbid reaching for it: the
// slice that owned the question answered it, and the answer was that there was
// nothing to add.
//
// **WHAT REMAINS IS AN ADAPTER AND A SCHEDULE, AND NEITHER IS TAKEN HERE.**
// `WorkerDb` is not re-exported from this barrel and `ExpirySweepIo` has no
// implementation over it; ADR-165 section 10 finding 6 names that one line and
// leaves it to the slice that needs it, and inventing a caller for it in a
// barrel would be this file deciding how the sweep is scheduled. WHAT IS REAL IS
// THE THREE LEGS, THE LOCK, THE KEY DISCIPLINE AND THE REPORT; WHAT IS NOT IS
// THE WIRING, and the difference is visible in the type rather than left to a
// reader.
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

// -----------------------------------------------------------------------------
// THE STREAMING INGEST (session 299, `P6-f`)
// -----------------------------------------------------------------------------
// ADR-020's TIER 2, AND THE ONE MODULE IN THIS DEPLOYABLE THAT MAY NOT REACH THE
// DATABASE THROUGH `src/db.ts`. That is not a style choice and it is worth the
// paragraph, because the reflex is to wire it like everything above.
//
// `client.ts` opens ONE pool from ONE `DATABASE_URL`, so **one process is one
// role**, and this deployable holds `merit_app`. `0050` ends
// `REVOKE ALL ON live_account_state FROM merit_app, PUBLIC`, which is
// `FM-M12-08` ("the stats worker holds no read grant on the live cache") and
// `FM-M13-07` written as permissions rather than conventions. **So `merit_app`
// can neither read nor write the live cache, and no adapter built on
// `workerHandle()` can serve this ingest.** ADR-164 clause 4: any process that
// touches the cache connects as `merit_live`, and no process holds both roles.
// WHICH process that is, is `P6-b`'s address and `P6-g`'s mechanism.
//
// **THE CHEAP ESCAPE IS `0050`'s `F1` AND IT IS NOT TAKEN**: granting
// `merit_app` `SELECT` makes `FM-M12-08` false SILENTLY -- nothing fails, the
// read works, and the stats worker acquires a read grant on the indicative tier.
//
// **WHAT IS REAL IS THE PREDICATE, THE COALESCING QUEUE, THE REFUSALS AND THE
// REPORT; WHAT IS NOT IS THE WIRING**, and the difference is visible in the type
// rather than left to a reader. That is `runNightlyBatch`'s standard, the
// provisioning saga's and the expiry sweep's, applied unchanged.
//
// **`INV-M2-14` IS ASSERTED AND NOT ASSUMED.** `src/live/` imports nothing but
// itself, and `test/live-ingest.test.ts` derives the four forbidden tables from
// `0050`'s own `REVOKE` and asserts each is present in the module headers and
// absent from the module code.
//
// TWO THINGS ARE OWED AND BOTH ARE REPORTED RATHER THAN REACHED FOR. The
// expectation row feed loss is measured against needs a table `merit_live` can
// write and `merit_app` can read, which is a migration and a grant; and every
// `feed.*` event belongs to the expectation sweep (ADR-161 clause 7), so nothing
// here emits one.
export { TICK_REFUSALS, liveIngestClean, refuseTick, startLiveIngest } from './live/ingest.ts';
export type {
  FeedGap,
  LiveIngestConfig,
  LiveIngestReport,
  LiveIngestRun,
  TickRefusal,
} from './live/ingest.ts';

export {
  LIVE_CACHE_UPSERT_SQL,
  LIVE_CACHE_WRITTEN_COLUMNS,
  LiveIngestUnwired,
  UNWIRED_LIVE_INGEST_IO,
  supersedes,
} from './live/ports.ts';
export type {
  FeedExpectation,
  FeedExpectationPort,
  IngestTick,
  LiveAccountRefPort,
  LiveCacheOutcome,
  LiveCacheRow,
  LiveCacheWritePort,
  LiveCacheWrittenColumn,
  LiveFeedPort,
  LiveIngestIo,
  LiveOrdinal,
  LiveSubscription,
} from './live/ports.ts';

// THE DETECTOR RUNNER AND THE CANARIES (session 300, `P7-e`)
// -----------------------------------------------------------------------------
// **`P7`'s FIRST DONE-GATE, AND IT IS A REFUSAL RATHER THAN A FEATURE.** P7
// section 8: "a canary gate fires when a detector finds NOTHING", and none of
// this phase's three gates "can be satisfied by writing more code". So the
// thing to read here is not what the runner produces; it is what it refuses to
// report.
//
// **THE SENTENCE THE SLICE EXISTS TO MAKE FALSE IS `AS-M7-05`'s**: a
// `detector_runs` row reading `status: ok`, `rows_scanned: 0`, `flags_raised: 0`
// "is indistinguishable from a genuinely quiet night, and quiet nights are the
// normal case, so nobody looks." `FM-M7-01` calls it the worst failure in M07,
// because everything downstream reads a green dashboard. Every run therefore
// seeds a battery of synthetic subjects, asserts it found them, and a run that
// finds fewer than it seeded is `degraded` and emits `detector.run_degraded`,
// which pages (`INV-M7-07`, `SD-M7-01`, `GS-122`).
//
// **BOTH OF `AS-M7-05`'s IMPLEMENTATION NOTES SHIP AS ASSERTIONS AND NEITHER AS
// A COMMENT**, which is `P7` section 11 rule 13:
//
//   NOTE 1, excluded from every aggregate  A CANARY IS NEVER WRITTEN AT ALL.
//     The `is_synthetic` marker `AS-M7-05` names does not exist in any
//     migration -- `M02 OQ-M2-01` PROPOSES it and is open -- and no migration
//     number is allocated to this slice. So the subjects are minted in memory
//     and discarded, which makes "excluded from every aggregate" true of the
//     queries nobody has written yet rather than of the ones somebody audited.
//     `test/detector-runner.test.ts` section 3 walks every value of every
//     committed write and every counter the run reported and fails on a canary
//     identifier in any of them.
//   NOTE 2, regenerated per run  EVERY CANARY IDENTIFIER CARRIES THE RUN'S
//     NONCE and the runner checks each one, so a battery built at module load
//     is refused rather than counted. A detector cannot pass this by being
//     careful; only by having minted from the mint it was handed.
//
// **THE HALF THAT IS NOT DISCHARGED IS STATED RATHER THAN IMPLIED.** A canary
// that never travelled through `rowsWhere` proves the detector's PREDICATE
// still matches and proves nothing about whether the READ still returns the
// rows it used to. Closing that needs a persisted subject, which needs the
// marker column, which needs a migration and the ruling that goes with it.
// `src/detectors/canary.ts`'s header is the argument and the suite pins the
// case: a run whose read returned nothing still finds its canaries and reports
// `ok` at `rows_scanned: 0`.
//
// **NO PATH TO `enforced`, AND IT IS THE TYPE THAT STOPS IT** (`ADR-155`,
// `INV-M7-02`, `STATE_MACHINES` section 7, `P7` rule 11). `DetectorTx` has no
// addressed write, so a transition has no method to go through, and
// `DetectorFinding` has no `status` field, so `enforced` is not a value a
// detector avoids -- it is a word with nowhere to go. The runner stamps `open`
// and reads nothing from the finding.
//
// **THE READ SHAPE IS `ADR-157`'s AND ITS REFUSAL IS DESIGNED FOR.** That entry
// refused the aggregate `P7` section 10 item 1 asked for, on the evidence that
// `P7`'s own section 3.1 names a JOIN as every wave-2 detector's blocker. What
// it granted is the range term, and the shape here is what that grant implies:
// a detector declares WINDOWS, the runner reads each through `rowsWhere`, and
// the join happens in the runner. The cost is named rather than waved at -- the
// rows crossing the boundary are the window's rather than the match's -- so
// `DetectorRunOutcome.rowsByStream` reports it per stream and a window that is
// too wide is a number somebody can read rather than a slow night.
//
// **IT IS WRITTEN AGAINST PORTS AND IT IS UNWIRED, exactly as `runNightlyBatch`,
// the provisioning saga and the expiry sweep are.** The gap here is an ADAPTER
// rather than a word: `src/db.ts`'s `LIVE_DB.batch` already satisfies
// `DetectorRunnerIo.transact` at `systemDb('nightly-batch')`, which `M07`
// section 1.1 makes the right authority for a nightly run, so `SystemReason`
// gains no member and `ADR-165`'s one door is not opened a second time. What is
// missing is the event sink (`P5-n`'s), the scheduler, and the detectors
// themselves (`P7-f`, `P7-g`, `P7-h`). WHAT IS REAL IS THE RUN RECORD, THE
// BATTERY, THE PARTITION AND THE THREE-STATE VERDICT; WHAT IS NOT IS THE
// WIRING, and the difference is visible in the type rather than left to a
// reader.
export {
  CANARY_NONCE_MIN_LENGTH,
  CANARY_PREFIX,
  CANARY_SHAPES,
  CanaryNonceError,
  canaryMint,
  canaryNonce,
  canarySubjectId,
  canarySubjectOf,
  carriesNonce,
  hedgedPair,
  isCanaryId,
  martingaleSequence,
  sameSecondFillCluster,
  sharedDestination,
} from './detectors/canary.ts';
export type {
  CanaryMint,
  CanaryNonce,
  CanaryRow,
  CanaryShape,
  CanarySubject,
  CanarySubjectId,
  FillClusterOptions,
  HedgedPairOptions,
  MartingaleOptions,
  SharedDestinationOptions,
} from './detectors/canary.ts';

export {
  DETECTOR_READ_TABLES,
  DETECTOR_RUN_STATUSES,
  DETECTOR_WRITE_TABLES,
  DetectorDeclined,
  DetectorRunnerUnwired,
  FLAG_SOURCE_INTERNAL,
  FLAG_STATUS_ON_RAISE,
  SLA_REQUIRED_AT_SEVERITY,
  UNWIRED_DETECTOR_RUNNER_IO,
} from './detectors/ports.ts';
export type {
  Detector,
  DetectorDefinition,
  DetectorEvent,
  DetectorEventName,
  DetectorEventPort,
  DetectorFilter,
  DetectorFilterTerm,
  DetectorFinding,
  DetectorGroup,
  DetectorOutcome,
  DetectorReadTable,
  DetectorRow,
  DetectorRunStatus,
  DetectorRunnerIo,
  DetectorScanInput,
  DetectorScanRequest,
  DetectorStream,
  DetectorTerms,
  DetectorTx,
  DetectorValues,
  DetectorWriteTable,
} from './detectors/ports.ts';

export {
  DetectorBatteryError,
  DetectorCanaryLeak,
  DetectorFindingError,
  DetectorUnregistered,
  UNREGISTERED_VERSION,
  runDetectors,
} from './detectors/runner.ts';
export type {
  DetectorRunConfig,
  DetectorRunOutcome,
  DetectorRunReport,
} from './detectors/runner.ts';

// -----------------------------------------------------------------------------
// P7-f's THREE FILL DETECTORS (session 309)
// -----------------------------------------------------------------------------
// APPENDED. `P7` section 9 rows this file as the phase's largest collision --
// seven slices on one hand-maintained barrel -- and names the hazard precisely:
// "a keep-both merge of a re-export list type-checks and drops nothing, which is
// what makes a lost leg easy to miss". So the resolution is an APPEND, both
// sides are kept, and the whole barrel is re-read after any merge rather than
// trusted to the type checker, which cannot see an export that is simply gone.
export {
  CANARY_INSTANT,
  D01,
  D04,
  D05,
  FILL_DETECTORS,
  fillClustering,
  fillClusteringNightly,
  martingaleSequences,
  martingaleSequencesNightly,
  newsWindowClustering,
  newsWindowClusteringNightly,
} from './detectors/fills.ts';
export type { FillClusteringOptions } from './detectors/fills.ts';

// The graph detectors (`P7-g`), and the count they ship at
// -----------------------------------------------------------------------------
//
// `D-02`, `D-03`, `D-12`, `D-13` and `D-14`, and **ONE OF THE FIVE PRODUCES AN
// ANSWER TONIGHT.** The other four are stated here rather than left for a reader
// to discover from a green suite:
//
//   `D-02`  RUNS, capped at severity 3   `comparable_size_tolerance_bp` is
//                                        unstated, so half of `M07:109`'s
//                                        statistic is unevaluable, and the
//                                        severity 4 `M07:151` gives it also
//                                        needs an `sla_due_at` whose duration
//                                        `SD-M7-02` asks for and nothing states
//   `D-03`  DECLINES                     three unstated parameters, and a
//                                        severity 5 with no clock behind them
//   `D-12`  IS NOT A `Detector`          its output is neither a flag nor a
//                                        group, and `runner.ts` marks a detector
//                                        that returns neither `degraded` on
//                                        every run. It ships as
//                                        `discoverClusters` and the other three
//                                        call it
//   `D-13`  DECLINES                     two of its three tolerances unstated
//   `D-14`  DECLINES                     its threshold unstated, AND its
//                                        declared input -- "live and end-of-day
//                                        POSITIONS" -- has no table in
//                                        `scope.ts` at all
//
// **A DECLINE IS `DetectorDeclined` AND THE RUNNER RECORDS IT AS `failed`**, so
// `detector_runs_unhealthy_idx` and `CRON_INVENTORY`'s dead-man switch both see
// it on the morning of the day it happens. Leaving the three unregistered would
// make the same absence invisible, which is `FM-M7-01` reached by omission.
// Every threshold is read from `detector_definitions` (`INV-M7-04`) and the
// three declines are one founder answer to `OQ-M7-02` away from running.
export {
  CALENDAR_DAYS_PER_TRADING_DAY,
  CANARY_EPOCH,
  CAPPED_SEVERITY,
  D02,
  D02_CANARY_TRADING_DAYS,
  D03,
  D03_CANARY_TRADING_DAYS,
  D12,
  D13,
  D13_CANARY_TRADING_DAYS,
  D14,
  GRAPH_DETECTOR_IDS,
  GRAPH_FLAG_TYPE,
  addCalendarDays,
  asJsonNumber,
  bpAsDecimalString,
  cliquePositionSumDetector,
  correlationAtOrBelow,
  correlationBp,
  discoverClusters,
  graphDetectors,
  groupInverseExposureDetector,
  integerSquareRoot,
  inversePairDetector,
  netPositionsBySymbol,
  pearsonParts,
  readFrom,
  varianceRatioAtOrBelow,
  varianceRatioBp,
  varianceRatioParts,
  youngAccountFastPathDetector,
} from './detectors/graph.ts';
export type {
  ClusterInput,
  PearsonParts,
  VarianceRatioParts,
  WatchedCluster,
} from './detectors/graph.ts';

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
      'detector runner built, job interface built, no job store and no scheduler yet',
  );
}
