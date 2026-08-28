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

// THE IDENTITY AND PAYMENT DETECTORS (session 311, `P7-h`)
// -----------------------------------------------------------------------------
// `D-07`, `D-08`, `D-09`, `D-10` and `D-11`, plus `D-16`'s v1 half and `D-18`'s
// detector, written against the runner and ports above and touching neither.
//
// **ALL SEVEN DECLINE UNDER `P7-d`'s SEED AS IT STANDS, AND THAT IS THE SLICE'S
// RESULT RATHER THAN ITS SHORTFALL.** `INV-M7-04` makes the registry the only
// source of a threshold -- *"'why did this not fire in March' must be answerable
// from data, and it cannot be if parameters live only in code"* -- and eleven of
// the eighteen seeded rows carry no number at all, because `OQ-M7-02` is the
// founder's and the seed writes no value it cannot cite. `DetectorDeclined` is
// the named way to say so, the runner records the run `failed`, and
// `detector_runs_unhealthy_idx` and `CRON_INVENTORY`'s dead-man switch both read
// it on the day it happens. The alternative is `FM-M7-01` exactly: a threshold
// this module invented, and *"detection appears healthy and is absent."*
//
// **SEVERITY IS THE BLOCKER FIVE OF THE SEVEN SHARE AND IT IS A MONEY DECISION
// EVERY TIME IT IS WRITTEN.** `M07` section 3.3: moving a detector from 3 to 4
// changes who gets held, because 4 and 5 is the band `G-HOLD-REQUIRED` reads to
// hold a payout for 48 hours under `ADR-040`, so it is *"a data change with a
// recorded effective date through `SD-M7-03`, never a deploy"*. A severity
// chosen in a `.ts` file is that decision made by a deploy. **AND THE CLOCK THAT
// BAND NEEDS IS NOT SEEDED EITHER**: `risk_flags_high_severity_has_sla` requires
// `sla_due_at` at 4 and 5, `OQ-M7-03` PROPOSES the duration and is OPEN, so the
// two detectors whose severity `M07` DOES state, `D-09` and `D-16` at 5, are
// blocked on an `sla_hours` the registry has no row for. It is NAMED rather than
// defaulted.
//
// **`ADR-155` BINDS HARDEST HERE AND IT IS THE TYPE THAT HOLDS IT.** `P7`
// section 8 says so of this slice by name and `ADR-155`'s consequences repeat
// it: `D-09`, `D-08` and `D-16`'s v1 half all produce hard-link signals and all
// three write `open`. There is no line here resisting the temptation because
// there is no line to resist with: `DetectorFinding` has no `status` field,
// `DetectorTx` has no addressed write, and `identity_links` is absent from
// `DETECTOR_WRITE_TABLES`, so **the hard link is READ here and never WRITTEN
// here** and clause 1's edge remains the resolver's. The foreclosure runs both
// ways and the suite asserts the flag lands at `open` at severity 5, which is
// the band an auto-enforce would have been written for.
//
// **`D-18` TESTS `footprint_present IS FALSE` AND NEVER `IS NOT TRUE`**, spelled
// once in `hasNoFootprint` and asserted at BOTH the places it runs: the window
// narrows on an equality against `false`, and the detector re-tests every leg
// over the merged rows because **the battery is merged AFTER the read and never
// travels through `rowsWhere` at all**. The near-miss is `M07`'s own, a vendor
// timeout, and the difference is a supplier outage against a flood of flags
// against real customers.
//
// **NO EVIDENCE OBJECT CARRIES A THRESHOLD**, asserted mechanically against the
// seed's own parameter keys. `INV-M7-10` is enforced several slices away by
// `P7-j`'s strip list, and a copy of a parameter inside `risk_flags.evidence`
// makes that stripping load-bearing in a second place; `INV-M7-04`'s chain
// reconstructs it from data, so the copy buys nothing and can drift.
//
// **TWO STRUCTURAL BLOCKERS ARE REPORTED RATHER THAN REACHED FOR** (`P7` section
// 11 rule 5). `D-09` has no input, which is `DEP-M7-04` arriving exactly where
// that row said it would: `payout_transfers` carries no identity column and
// reaches one only through `payout_requests`, which is not a member of
// `DETECTOR_READ_TABLES`. The remedy is one member in `detectors/ports.ts`,
// which is `P7-e`'s fence. And two of `D-18`'s four required legs are `D-15`'s
// checkout enrichment, which does not exist. Both predicates are written and
// tested against the shapes those inputs would produce, so the logic exists and
// is proven the day they land.
//
// **WHAT IS REAL** is seven predicates, seven windows and seven batteries, each
// predicate a pure exported function with a positive fixture and a near-miss
// fixture. **WHAT IS NOT IS A SINGLE FLAG**, and the difference is visible in
// `DETECTOR_BLOCKERS` and `detectorBlockerSummary` rather than left to a reader.
export {
  CANARY_MAGNITUDE,
  CONSISTENCY_GATE,
  CentsRangeError,
  D07_ENTITY_CAP,
  D08_PAYMENT_VELOCITY,
  D09_DESTINATION_CONCENTRATION,
  D10_AFFILIATE_SELF_DEAL,
  D11_DILUTION_TIMING,
  D16_LINK_CONFIDENCE,
  D18_REGISTRATION_PHONE,
  DETECTOR_BLOCKERS,
  DOCUMENTED_FLAG_TYPES,
  FLAG_TYPE_BY_DETECTOR,
  FLEET_LEGS_WITH_INPUT,
  FLEET_SIGNATURE_LEGS,
  IDENTITY_DETECTORS,
  IDENTITY_DETECTOR_IDS,
  MIN_CORRELATION_DAYS,
  accountOwners,
  cents,
  connected,
  detectorBlockerSummary,
  dilutionCandidates,
  failingGates,
  flagTypeOf,
  fleetSignatureRows,
  hardLinkEdges,
  hasNoFootprint,
  isVoipLine,
  liveEdges,
  overCapEntities,
  paymentVelocityBreaches,
  pearsonBp,
  registryBlockers,
  registryParameter,
  related,
  relatedComponents,
  selfDealAttributions,
  sharedDestinations,
  statedInteger,
  statedValue,
} from './detectors/identity.ts';
export type {
  DilutionCandidate,
  FleetSignatureRow,
  HardLinkEdge,
  IdentityDetectorId,
  IdentityGraph,
  OverCapEntity,
  PaymentVelocityBreach,
  RegistryBlocker,
  RegistryParameter,
  SelfDealAttribution,
  SharedDestination,
} from './detectors/identity.ts';

// -----------------------------------------------------------------------------
// THE BREAKER AND CUSUM EVALUATOR (session 320, `P7-k`)
// -----------------------------------------------------------------------------
// `SD-M6-02`'s DAILY PRODUCER, and `plan_breaker_state`'s first writer since
// `0016` landed the table. `GS-113` is the gate.
//
// **`INV-M5-12` IS THE ONE TO READ AND IT IS ENFORCED BY THE WRITE UNION**:
// `BREAKER_WRITE_TABLES` has exactly ONE member, so the breaker pauses SALES and
// there is no `key` this port accepts that reaches a payout, a wallet, a halt or
// a restriction. A trader who has earned money is paid while Merit has stopped
// selling.
//
// **`insufficient_data` IS FIRST CLASS AND SALES ARE NOT PAUSED THERE**
// (`AS-M6-02`, `GS-113`), `sample_size` is written beside `min_sample` on every
// row, and `breaker.state_changed` carries the sample size into the alert
// (`M06:265`) as a REQUIRED field rather than an optional one.
//
// **IT DECLINES TODAY AND THAT IS THE HONEST OUTCOME**: `OQ-M6-02` is the
// founder's, so `LOSS_RATIO_POLICY` ships both minimum terms `unstated` and
// `BreakerDeclined` is the named way to say "I have no floor". The CUSUM folds
// in integer basis points (`ADR-167` clause 4) and renders ABSENT until
// `DEP-M6-05` supplies `mu_0` and `sigma` (`ADR-167` clause 5).
export {
  BREAKER_READ_TABLES,
  BREAKER_STATES,
  BREAKER_STATE_CHANGED,
  BREAKER_WRITE_TABLES,
  BreakerDeclined,
  BreakerUnwired,
  LOSS_RATIO_POLICY,
  SALES_PAUSED_STATE,
  UNWIRED_BREAKER_IO,
} from './breaker/ports.ts';
export type {
  BreakerEvent,
  BreakerEventPort,
  BreakerFilter,
  BreakerFilterTerm,
  BreakerIo,
  BreakerReadTable,
  BreakerRow,
  BreakerState,
  BreakerStateChanged,
  BreakerTerms,
  BreakerTx,
  BreakerValues,
  BreakerWriteTable,
  LossRatioPolicy,
  PolicyNumber,
} from './breaker/ports.ts';
export {
  BreakerRowError,
  UNCALIBRATED_CUSUM,
  applyOverride,
  cusumOf,
  decideState,
  evaluateBreaker,
  foldCusum,
  foldWindow,
  lossRatioBp,
  passRateBp,
  resolvePolicy,
  salesPaused,
  stateChangedEvent,
  toBreakerStateRow,
} from './breaker/evaluate.ts';
export type {
  BreakerDecision,
  BreakerEvaluationReport,
  BreakerFloor,
  BreakerOverride,
  CusumFold,
  CusumParameters,
  PassRateDay,
  PreviousEvaluation,
  ResolvedPolicy,
  StateInput,
  StateOutcome,
  WindowFold,
} from './breaker/evaluate.ts';

// P7-l: THE TWO DIGESTS THE PLAN ROW NAMES ACQUIRE PRODUCERS, AND THE ALARM
// THAT WATCHES THEM ASSERTS THE QUERY AND NEVER THE JOB'S OWN REPORT.
//
// `report_schedules` and `report_deliveries` landed in `0040` with ZERO ROWS on
// merge, deliberately, "so nothing below can be read as evidence that any digest
// has ever been delivered". `weekly_loss_ratio_cusum` and `weekly_flag_queue`
// have producers now.
//
// **`CRON_INVENTORY`'s RULE IS A PROPERTY OF A PARAMETER LIST HERE.**
// `DigestAlarmIo` carries a transaction and a clock and nothing a producer could
// hand it, `alarm.ts` imports nothing from `produce.ts`, and the handle the
// alarm receives has no `insert`. A job that crashed after writing "success" and
// a job that never ran are the same fact to the person who did not get the
// digest, so they are the same input: neither is an input at all.
//
// **THE ROW CALLS THESE "the two MUST digests" AND `M06` SECTION 3.6 AND
// `ADR-066` SECTION 3 BOTH DISAGREE.** `weekly_flag_queue` is sized **SHOULD**;
// the second MUST is `daily_liability`, whose content needs
// `AdminReadSource.readLiability` and therefore waits on `P5-l`. Reported in
// `digests/ports.ts` beside `PRODUCED_DIGESTS`, and not repaired here.
//
// **NO NUMBER IN THIS SLICE IS ITS OWN.** The cadence is a schema fact
// (`0040`'s generated column); the weekday, the hour and the day of month a
// window closes on are stated nowhere, so `DIGEST_WINDOW_ANCHOR` ships every
// term `unstated` and the alarm anchors on each schedule's own history instead.
// `CADENCE_PERIOD_MS.monthly` is `null` and a monthly schedule is reported as
// `cadence_unanchored` rather than passed over.
export {
  CADENCES,
  CADENCE_BY_DIGEST,
  CADENCE_PERIOD_MS,
  CHANNELS,
  DELIVERY_OUTCOMES,
  DIGESTS,
  DIGEST_READ_TABLES,
  DIGEST_WINDOW_ANCHOR,
  DIGEST_WRITE_TABLES,
  DigestDeclined,
  DigestUnwired,
  FORMATS,
  PRODUCED_DIGESTS,
  RENDERED_FORMAT,
  UNWIRED_DIGEST_ALARM_IO,
  UNWIRED_DIGEST_IO,
} from './digests/ports.ts';
export type {
  Cadence,
  Channel,
  DeliveryOutcome,
  Digest,
  DigestAlarmIo,
  DigestBody,
  DigestContentPort,
  DigestEnvelope,
  DigestFilter,
  DigestFilterTerm,
  DigestIo,
  DigestReadTable,
  DigestReadTx,
  DigestRow,
  DigestSendResult,
  DigestTerms,
  DigestTransport,
  DigestTx,
  DigestValues,
  DigestWriteTable,
  FlagQueueDigestBand,
  FlagQueueDigestBody,
  Format,
  LossRatioDigestBody,
  LossRatioDigestLine,
  ProducedDigest,
  ScheduleNumber,
} from './digests/ports.ts';
export {
  DigestRowError,
  readBoolean,
  readInstant,
  readInteger,
  readNullableText,
  readText,
  readTextArray,
  readTradingDay,
  record,
} from './digests/rows.ts';
export {
  DIGEST_ALARM_KINDS,
  evaluateSchedule,
  findUndeliveredWindows,
  foldWindows,
  readAlarmSchedule,
} from './digests/alarm.ts';
export type {
  AlarmSchedule,
  DigestAlarmFinding,
  DigestAlarmKind,
  DigestAlarmOptions,
  DigestAlarmReport,
  WindowFold as DigestWindowFold,
} from './digests/alarm.ts';
export {
  artifactDigest,
  decideOutcome,
  deliveryValues,
  lossRatioBodyFrom,
  nextAttempt,
  readProducerSchedule,
  renderDigest,
  runDigestDeliveries,
} from './digests/produce.ts';
export type {
  DeliveryAttempt,
  DigestRunReport,
  DigestRunRequest,
  DigestScheduleResult,
  OutcomeDecision,
  ProducerSchedule,
} from './digests/produce.ts';

// =============================================================================
// THE BARREL'S OWN LEGS, AS DATA, BECAUSE A TYPE CHECKER CANNOT SEE AN EXPORT
// THAT IS SIMPLY GONE
// =============================================================================
// `P7` section 9 names this file as the phase's largest collision: SEVEN SLICES
// ON ONE HAND-MAINTAINED BARREL, and "a keep-both merge of a re-export list
// type-checks and drops nothing, which is what makes it easy to miss rather than
// safe". **IT HAPPENED ON 2026-08-28**: a keep-both merge deleted BOTH sides of
// a hunk in this file and `pnpm run typecheck` reported zero errors over it.
//
// `apps/api/src/admin-source/index.ts` fixes that class at COMPILE TIME, because
// its composition is an OBJECT and a `Pick` over a data array can disagree with
// it. **A RE-EXPORT LIST HAS NO SUCH SHAPE**: there is no value here for a type
// to be taken over, so the same trick does not transfer and forcing one would
// mean minting a runtime object whose only purpose is to be checked.
//
// **SO THE LEGS ARE DATA AND THE SUITE READS THIS FILE AS TEXT AGAINST THEM.**
// `test/digests.test.ts` asserts three things, and the third is the one that
// catches the failure nobody is looking for:
//
//   1. every specifier in {@link WORKER_BARREL_LEGS} appears in a `from` clause
//      of this file, so a dropped leg is a named failure rather than a silent
//      one;
//   2. every `from './...'` clause in this file is in that array, so a leg added
//      without its data entry fails too and the two halves cannot drift;
//   3. **every `.ts` module under `src/` is accounted for by exactly one of the
//      three lists below**, so a NEW module is a decision somebody records
//      rather than a file the barrel silently never met.
//
// The third found `batch/statistics.ts` while this list was being written: it
// has never been re-exported here, its suite imports it by path, and it is
// recorded below rather than added, because adding it is a barrel decision for
// the slice that owns that file and not a tidy-up for this one.
// =============================================================================

/**
 * Every module this barrel re-exports, by the specifier it re-exports it under.
 *
 * SORTED, AND APPEND-ONLY. A slice that adds a leg adds its line here in the
 * same change, which costs one line and is the whole price of the check above.
 */
export const WORKER_BARREL_LEGS = [
  './batch/nightly.ts',
  './batch/ports.ts',
  './batch/replay.ts',
  './batch/state-hash.ts',
  './breaker/evaluate.ts',
  './breaker/ports.ts',
  './detectors/canary.ts',
  './detectors/fills.ts',
  './detectors/graph.ts',
  './detectors/identity.ts',
  './detectors/ports.ts',
  './detectors/runner.ts',
  './digests/alarm.ts',
  './digests/ports.ts',
  './digests/produce.ts',
  './digests/rows.ts',
  './live/ingest.ts',
  './live/ports.ts',
  './provisioning/index.ts',
  './sweeps/expiry.ts',
  './sweeps/ports.ts',
] as const;

/**
 * Modules that reach this barrel THROUGH a leg rather than as one.
 *
 * `provisioning/index.ts` is itself a barrel over these six, which is why it is
 * the only `provisioning` specifier above. They are listed rather than left out
 * so that the sweep in the suite is TOTAL: a module that is neither a leg, nor
 * behind one, nor deliberately absent is a module nobody has decided about.
 */
export const WORKER_MODULES_BEHIND_A_LEG: Readonly<Record<string, string>> = {
  './provisioning/admission.ts': 're-exported through ./provisioning/index.ts',
  './provisioning/compensation.ts': 're-exported through ./provisioning/index.ts',
  './provisioning/machine.ts': 're-exported through ./provisioning/index.ts',
  './provisioning/payload.ts': 're-exported through ./provisioning/index.ts',
  './provisioning/ports.ts': 're-exported through ./provisioning/index.ts',
  './provisioning/saga.ts': 're-exported through ./provisioning/index.ts',
  './provisioning/vocabulary.ts': 're-exported through ./provisioning/index.ts',
};

/**
 * Modules this barrel deliberately does NOT re-export, each with its reason.
 *
 * AN ALLOWLIST THAT FAILS IN BOTH DIRECTIONS, in the NO-FLOATS list's idiom: an
 * unlisted module with no leg is the obvious failure, and a stale entry for a
 * module that no longer exists is how a list silently grants more than it names.
 */
export const WORKER_MODULES_NOT_RE_EXPORTED: Readonly<Record<string, string>> = {
  './db.ts':
    'THE ONE DOOR. ADR-165 and `test/db.test.ts`: this is the only file under apps/worker/src ' +
    'that may import @merit/db, and re-exporting it would put the accessor one import away from ' +
    'every consumer of this package.',
  './batch/statistics.ts':
    "M12's statistics run (ADR-122) has never been re-exported here and `test/statistics.test.ts` " +
    'imports it by path. FOUND BY WRITING THIS LIST rather than by a merge, and RECORDED rather ' +
    'than repaired: adding a leg is a decision for the slice that owns that file.',
};

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
      'detector runner built, seven identity and payment detectors built and every one of them ' +
      'declining on an unseeded threshold, breaker evaluator built and declining on an unstated ' +
      'minimum sample, two digest producers built and the delivery dead-man switch built and ' +
      'reading the delivery table rather than any run report, job interface built, no job store ' +
      'and no scheduler yet',
  );
}
