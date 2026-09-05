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
// THE INTERFACE EXISTS AND SO DOES THE JOB STORE. `@merit/queue` publishes
// `JobQueue` and `pgBossQueue`, whose `enqueue` takes the caller's open
// transaction as its first argument, and `0079_pgboss_job_store.sql` installed
// pg-boss's schema as a numbered migration on 2026-09-03 (ADR-318).
//
// **THIS PARAGRAPH READ "THE INTERFACE NOW EXISTS AND THE JOB STORE DOES NOT
// (ADR-086, session 147)" AND `0079` MADE IT FALSE**, and it is kept beside its
// correction rather than deleted because the shape of the error is the point:
// nothing derived the claim from `packages/db/migrations`, so a merged migration
// left a false sentence in a file with every gate green. `test/schedule.test.ts`
// now reads the migration directory and fails on the retired wording.
//
// `pgBossQueue` STAYS `migrate: false` AND THE MIGRATION IS THE REASON IT STILL
// SHOULD. The setting was chosen so the missing store failed loudly rather than
// being closed by a library running DDL on the money database at boot; with the
// store installed the same setting now does the OTHER half of the same job,
// because `Contractor.check()` under `migrate: false` refuses any
// `pgboss.version` other than the one the library was compiled with. A catalog
// bump to pg-boss is therefore a red boot and a new migration rather than a
// silent in-place upgrade of a schema inside the ledger's restore boundary.
//
// THE MANIFEST LINE IS HERE AND THE GRANT IS HERE, AND WHAT IS LEFT IS AN
// IMPORTER. `apps/worker/package.json` declares `@merit/queue` since ADR-327,
// and `0082_pgboss_app_grants.sql` grants `merit_app` `USAGE` on `pgboss` plus
// the fifteen table privileges pg-boss was MEASURED to need, so a call now
// reaches a schema the role can see. **THIS PARAGRAPH READ "NOTHING HERE IMPORTS
// IT YET, AND THE REASON HAS MOVED FROM A MANIFEST TO A GRANT ... every one of
// `JobQueue`'s five methods throws for this deployable today", AND `0082` MADE
// THE SECOND HALF FALSE.**
//
// AND THE IMPORTER IS HERE TOO, SINCE ADR-333. `src/queue.ts` is the ONE-DOOR
// module `@merit/ledger` got at `src/sweeps/ledger.ts` and `@merit/db` got at
// `src/db.ts` (ADR-165): the one file under `src/` that names the package. It
// takes its constructor executor from `src/db.ts` rather than reaching for the
// accessor itself, so each package still names exactly one file, and the queue
// name it declares is `PROVISIONING_QUEUE_NAME`, which `src/provisioning/
// saga.ts` already declares.
//
// **THIS PARAGRAPH READ "WHAT IS STILL MISSING IS NAMED RATHER THAN DEFERRED,
// because a deferral with no named blocker is not a finding (ADR-326 section
// 3.2). No module under `src/` imports `@merit/queue`, so the capability is
// declared and unexercised. The next row owes the ONE-DOOR module ... ADR-327
// section 5 says why that file is not here", AND ADR-333 WROTE THAT FILE.** It
// is kept beside its correction rather than deleted, per `RI-14`, and `RI-35`
// holds the correction to the tree: the sentence was a REGISTERED absence claim
// and the register moved it to `retired` in the same commit that falsified it,
// so a tree where the door went away turns the check red here instead of leaving
// a correction to be believed.
//
// **THE DOOR TAKES TWO OF `JobQueue`'s FIVE METHODS AND THAT IS THE RULING.**
// `declareQueue` and `enqueue` are published; `start`, `stop` and `consume` are
// not. A supervise pass emits its failures on an emitter `pgBossQueue` does not
// expose, so a process that starts one gets an unhandled rejection naming a
// vendor's `dist` (ADR-331 section 10 item 3, ADR-332 section 10 item 2); and
// this deployable is a ONE-SHOT JOB (ADR-241), so a sixty-second supervise
// interval here either never fires or holds the event loop open. `src/queue.ts`
// carries the argument and `test/queue.test.ts` asserts the absence over the
// tree rather than over the type.
//
// AND `0082` DOES NOT GRANT `CREATE`, WHICH IS A RULING AND NOT AN OMISSION.
// `pgboss.create_queue` runs `CREATE TABLE pgboss.%I` only for a PARTITIONED
// queue and `declareQueue` asks for none, so the application role keeps the "no
// DDL" property `0026_roles_and_grants.sql:64` gives it on `public`, on a schema
// that sits inside the PITR boundary protecting the ledger.
//
// THIS SENTENCE READ "AND NOTHING ELSE" AFTER `@merit/rules-engine` AND
// `@merit/db` UNTIL ADR-305 SECTION 7 SLICE 6 ADDED `@merit/ledger`, WHICH IS
// THE SECOND TIME THIS CLAUSE HAS GONE STALE. ADR-165 section 10 finding 2
// named the first occurrence, reported it rather than reaching into a file it
// was fenced out of, and said "whoever holds it next repairs the sentence in the
// same commit". The list is now read out of the manifest by the suite rather
// than counted here, which is the repair that does not need a third session.
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
// **THE MANIFEST LINE THIS HEADER HAS ASKED FOR SINCE SESSION 147 IS HERE.**
// It read "STILL NOT HERE" through two rewrites: ADR-326 measured the blocker
// under it rather than adding it, because `@merit/queue` resolves to a
// `JobQueue` whose every method runs against the `pgboss` schema and the role
// this deployable connects as could not reach that schema at all, so the line
// would have bought a resolvable import and a call that threw `permission denied
// for schema pgboss`. **`0082_pgboss_app_grants.sql` REMOVED THAT BLOCKER AND
// ADR-327 ADDED THE LINE.**
//
// **THE NEXT TWO PARAGRAPHS ARE HISTORY AS OF ADR-338 AND THEIR CORRECTION
// FOLLOWS THEM.** They are kept whole and unedited rather than rewritten,
// because `RI-14` keeps what was corrected beside its correction and because the
// register's `worker-queue-door-caller` row anchors on a line inside them: an
// edit to that line would move the anchor in the same commit that falsifies the
// claim, which is the one way to retire a sentence without leaving a record.
//
// THE SAGA IS STILL WRITTEN AGAINST PORTS, and that has not changed with the
// manifest OR with the door: `ProvisioningJobQueue` is a port,
// `enqueueProvisioningOp` calls it, and **no adapter over `LIVE_QUEUE` has a
// caller here**. `src/provisioning/ports.ts` says what each port's
// implementation is and what blocks two of them, and `src/schedule.ts` carries
// the blocker per job rather than as a generality.
//
// **THAT CLAUSE READ "no adapter over `pgBossQueue` exists yet because no module
// here imports the package", AND ADR-333 MADE ITS STATED REASON FALSE WHILE
// LEAVING ITS CONCLUSION STANDING** -- which is exactly the shape ADR-331 met
// one package over. It is kept beside its correction rather than deleted, per
// `RI-14`. A module here imports the package now; what is still absent is a
// CALLER, and `RI-35` binds that absence rather than this prose asserting it:
// the register carries a `worker-queue-door-caller` artifact, so the day
// somebody wires the saga to the door this correction goes red at its own line.
// **The row that writes a door is not the row that wires a job** (ADR-165
// clause 5, ADR-326 section 4).
//
// **AND ADR-338 IS THAT ROW, SO THE CLAUSE ABOVE IS FALSE AND THE PREDICTION
// UNDER IT CAME TRUE AT ITS OWN LINE.** `src/provisioning/queue-adapter.ts`
// carries `LIVE_PROVISIONING_QUEUE`, the first `ProvisioningJobQueue` under any
// `src/` in this workspace: before it, the only value of that type anywhere was
// `fakeQueue()` inside `test/provisioning.test.ts`. The
// `worker-queue-door-caller` probe flipped to `present`, `RI-35` went red at the
// clause above rather than at a count somebody would have had to notice, and the
// register moves that row to `retired` in the same commit, so a tree that loses
// the adapter again turns leg 3 red at the same line.
//
// **WHAT IS WIRED IS ONE PORT OF FOUR AND THE OTHER THREE ARE NAMED RATHER THAN
// DEFERRED.** `runProvisioningSaga` takes a queue, a platform, an advance port
// and a read port. `PlatformProvisioningPort`'s implementation is
// `packages/rithmic`'s and does not exist; `ProvisioningAdvancePort` and
// `ProvisioningReadPort` are BLOCKED by ADR-102's `WHERE`-less system write path
// and say so on their own declarations. So the saga still has no caller, `RI-35`
// still binds that at `provisioning-saga-caller`, and `schedule.ts` still
// registers the job `unscheduled`.
//
// **AND NOTHING IS ENQUEUED, WHICH IS WHAT STOPS THE JOB STORE GROWING.** No
// module under any `src/` calls the adapter or the saga, so zero rows are
// written; nothing here may drain one either, because the door withholds
// `consume` and `start` on ADR-241's one-shot ruling. That is a fact about the
// tree and not a control, and it expires the moment a caller lands: the row that
// gives the saga a caller owes a drain, or owes the argument for running without
// one (ADR-338 section 4).
//
// **WHAT IS REAL IS THE PIPELINE, THE DIGEST, THE MACHINE, THE COMPENSATION AND
// THE EXIT; WHAT IS NOT IS THE WIRING**, and the difference is visible in the
// type rather than left to a reader. That is this file's own standard for the
// batch above and it is applied to the saga unchanged. **"THE WIRING" IS NOW
// NARROWER THAN THE SENTENCE AND THE SENTENCE IS KEPT**: the queue half is wired
// and the platform, advance and read halves are not.

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

// ADR-338. THE SAGA's QUEUE PORT, LIVE. It rides the `./provisioning/index.ts`
// leg rather than getting one of its own, because that barrel is this
// directory's single specifier here and a second one would make the
// `WORKER_BARREL_LEGS` list disagree with itself about how `provisioning`
// reaches this file.
export {
  LIVE_PROVISIONING_QUEUE,
  declareProvisioningQueue,
  provisioningJobQueue,
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

// -----------------------------------------------------------------------------
// `ADR-239` SLICE B: A `BatchPorts` VALUE, OVER POSTGRES (session 431)
// -----------------------------------------------------------------------------
// **THE FIRST `BatchPorts` VALUE CONSTRUCTED UNDER ANY `src/` IN THIS
// WORKSPACE.** `apps/api/test/rule-state-producibility.test.ts` case 2 runs that
// measurement as a test and it read zero until this leg. Four of its ten methods
// are served, six refuse by name with the slice that clears each, and `ADR-241`
// section 4 is the accounting. It is a leg rather than an internal module
// because it is the composition this deployable's own suite substitutes a
// recorder into, and a composition nobody can import is a composition nobody can
// test.
//
// **TWO NAMES LEFT THIS LEG IN `ADR-277` AND THEIR ABSENCE IS THE REPAIR RATHER
// THAN A TIDY-UP.** `readLastClosedTradingDay` handed every importer a
// `TradingDay | null` in which `null` meant "no session has closed" and never
// "outside coverage", and `calendarCarriesDay` answered a coverage-shaped
// question off `trading_calendar`, which is the wrong table. Both are gone from
// this barrel and from this deployable's exported surface; `anchorLastClosedDay`
// and `anchorNamedDay` replace them and hand back a `TradingDayAnchor` carrying
// the day on its `anchored` arm ALONE, so an importer that skips the coverage
// verdict does not compile.
export {
  BatchPortUnwired,
  BatchRowError,
  anchorLastClosedDay,
  anchorNamedDay,
  postgresBatchPorts,
  toCalendarSlice,
} from './batch/adapter.ts';
export type { BatchTx, TradingDayAnchor } from './batch/adapter.ts';

// -----------------------------------------------------------------------------
// ADR-350: A `StatisticsPorts` VALUE, OVER POSTGRES, WITH THREE PORTS REFUSING
// -----------------------------------------------------------------------------
// **THE FIRST `StatisticsPorts` VALUE CONSTRUCTED UNDER ANY `src/` IN THIS
// WORKSPACE**, on the leg above's own terms and with the same reason for being a
// leg: it is the composition this deployable's suite substitutes a recorder
// into, and a composition nobody can import is a composition nobody can test.
//
// **IT IS NOT THE SAME KIND OF LANDING AS THAT ONE AND THE DIFFERENCE IS ON THE
// RECORD.** Four of the six read ports and the write port are served; three
// refuse by name, and two of those three refuse because Merit cannot yet produce
// the FACT the definition asks for rather than because nobody has written the
// query. `runStatisticsRun` reads all five fact sets per window, so a refusal
// ends the run, and `ADR-350` argues that the totality is correct: a run that
// published only the statistics whose facts happened to be constructible is
// `FM-M12-02`'s selected set with the selection taken by an adapter.
export {
  FUNDED_LIVES_BLOCKER,
  PublishedWindowAlreadyExists,
  STATISTICS_HALT_SINK_BLOCKER,
  StatisticsPortUnwired,
  StatisticsRowError,
  WITHDRAWAL_SETTLEMENTS_BLOCKER,
  postgresStatisticsPorts,
} from './batch/statistics-adapter.ts';

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

// -----------------------------------------------------------------------------
// `B5` TERM 1: `writeRuleState`, IMPLEMENTED (session 395)
// -----------------------------------------------------------------------------
// **THE FIRST DATABASE IMPLEMENTATION OF ANY `BatchWritePort` MEMBER.** Until
// this leg, `writeRuleState`'s only satisfiers were test doubles and
// `scripts/demo/world.ts`, which refuses, and `rule_states` therefore held zero
// rows -- measured live over all 60 migrations by session 392 and again by 395.
// `apps/api/src/admin-source/liability.ts`'s `B5` block names that absence as
// term 1 of a three-term clearing condition.
//
// **THE DOOR WAS ALREADY OPEN AND THAT IS WHY THIS LEG IS SHORT.** `rule_states`
// is `derived` in `packages/db/src/scope.ts`, so it is a `TableKey` and not a
// `FirmTableKey`: `apps/api/src/db.ts`'s `firm` door cannot name it and its
// `scoped` door wants an identity a fold across every account does not have.
// `src/db.ts`'s `LIVE_DB.batch` yields a `SystemTx` whose `insert` is generic
// over `TableKey`. Nothing here widens a manifest, adds a `SystemReason` member
// or reaches a second door.
//
// **AND THE OTHER TWO `BatchWritePort` MEMBERS ARE NOT HERE.**
// `raiseReconciliation` and `raiseDivergence` expand a finding into events, and
// `test/event-sink.test.ts` establishes that no event producer is reachable from
// this deployable at all. A `BatchWritePort` composed from this leg plus two
// silent stubs would be a batch whose audit channel is a no-op, so no such
// composition exists and this leg exports the one method it can serve.
//
// **TERM 2 WAS UNCLEARED WHEN THIS LEG WAS WRITTEN AND IS CLEARED NOW. THE SEAM
// IS STILL RIGHT AND THAT IS THE POINT OF SAYING SO.** This paragraph read "no
// primary source declares what `rule_states.engine_gates` holds"; `ADR-206`
// (session 394) landed while this session was running and declares it, at
// `docs/architecture/data-model/rule_states.md`: the engine's own
// `EngineGateResults`, six groups and twenty-five leaves at `ENGINE_GATE_LEAVES`'
// dotted paths, cents as base-10 strings. **WHAT IS DECLARED IS NOT YET
// IMPLEMENTED**: no adapter in this tree encodes to that shape, `ADR-206` is
// `proposed` and UNSIGNED, and so `RuleStateWriterIo` still takes the encoding as
// a parameter and `UNWIRED_RULE_STATE_WRITER_IO` still refuses it by name. A port
// that refuses is the correct state until an encoder exists.
//
// **AND THE NUMBER IN THIS PARAGRAPH WAS WRONG IN BOTH COPIES.** It read
// "`EngineGateResults` types four leaves `bigint`". **SEVEN** of the
// twenty-five are `Cents`, derived by counting what `ENGINE_GATE_LEAVES` renders
// through `money()`. The four came from `packages/rules-engine/src/hash.ts`,
// which said four for the same reason and is repaired in the same commit.
// `state-hash.ts` still says in terms that its canonical serialization is NOT the
// column, which is what makes the encoding a separate declaration at all.
export {
  RULE_STATE_WRITE_COLUMNS,
  RULE_STATE_WRITE_TABLES,
  RuleStateAlreadyWritten,
  RuleStateEncodingRefusal,
  RuleStateWriterUnwired,
  UNWIRED_RULE_STATE_WRITER_IO,
  refuseUnstorableJson,
  ruleStateValues,
  writeRuleStateVia,
} from './batch/state-writer.ts';
export type {
  RuleStateTx,
  RuleStateValues,
  RuleStateWriteColumn,
  RuleStateWriteTable,
  RuleStateWriterIo,
} from './batch/state-writer.ts';

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
//
// **THE ADAPTER HALF OF THAT SENTENCE IS TAKEN NOW AND THE SCHEDULE HALF IS
// NOT, and the sentence is kept whole beside its correction per `RI-14`.**
// ADR-344 wrote `./sweeps/expiry-adapter.ts`, which is the leg immediately
// below: `expirySweepIo(db, events, now)` serves `transact` over
// `WorkerDb.batch`, `terms` over the accessor's own two read-path
// constructors, `ledger` over `EXPIRY_LEDGER` and `now` over the process
// clock. **FOUR PORTS OF FIVE, AND THE FIFTH IS A REQUIRED ARGUMENT RATHER
// THAN A REFUSING DEFAULT.** Every leg of this sweep emits inside its own
// release transaction, so an `events` port that rejected would be an hourly
// job that releases nothing while a dead-man switch watching for the job's
// ABSENCE reports it present, which is `ADR-239`'s defect with a clock in
// front of it. The only event producer in this repository is
// `apps/api/src/events.ts`, `RI-04` and `node-linker=isolated` put it out of
// reach of this deployable, and the producer's own header measures that
// `SystemTx` is the one handle in this workspace that can write `events` while
// `apps/api` opens no system door. So the handle and the producer are each in
// the deployable the other cannot import, no `ExpirySweepIo` is constructed,
// and `runExpirySweep` stays `unscheduled` in `schedule.ts` for a blocker that
// is now a call that does not compile rather than a sentence.
export { EXPIRY_TERMS, expirySweepIo } from './sweeps/expiry-adapter.ts';
export type { SweepTx } from './sweeps/expiry-adapter.ts';

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

// **THE LEDGER HALF OF THAT ADAPTER LANDED (ADR-305 section 7 slice 6) AND THE
// SCHEDULE DID NOT.** `sweeps/ledger.ts` is the one file in this deployable that
// names `@merit/ledger`, on the ONE-DOOR pattern `src/db.ts` holds for the
// accessor, and it discharges `ExpiryLedgerPort` and nothing else: `terms` needs
// `packages/db`'s constructors and `events` needs the sink `P5-n` has not
// written, so no `ExpirySweepIo` is constructed here or anywhere. THE LEG IS
// DECLARED BECAUSE THE MODULE EXISTS AND THE BARREL'S OWN SWEEP IS TOTAL, NOT
// BECAUSE ANYTHING INSTALLS IT: `recordExpiryTransaction` has no caller under
// `src/`, so `EXPIRY_LEDGER` refuses every handle it could be given today.
// **THE `terms` HALF OF THAT SENTENCE AND THE `recordExpiryTransaction` CLAUSE
// ARE BOTH FALSE NOW AND ARE KEPT BESIDE THEIR CORRECTION, per `RI-14`.**
// ADR-344 wrote `./sweeps/expiry-adapter.ts`, the leg above this one:
// `src/db.ts` re-exports the accessor's two read-path term constructors, so
// `terms` is served; `expirySweepIo` calls `recordExpiryTransaction` inside
// `WorkerDb.batch`'s callback, so `EXPIRY_LEDGER` now recognises the handle it
// is given rather than refusing every one. **WHAT IS STILL TRUE IS THE HALF
// THAT KEEPS THE JOB OFF A CLOCK**: `events` still needs the sink `P5-n` has
// not written, the only producer in this repository is `apps/api/src/events.ts`
// and `RI-04` plus `node-linker=isolated` put it out of reach, so
// `expirySweepIo` takes the sink as a REQUIRED argument, nothing in this tree
// can be passed for it, and no `ExpirySweepIo` is constructed here or anywhere.
// **AND SLICE 7 PUT A SECOND PORT BEHIND THE SAME DOOR (ADR-325).**
// `ApprovalLedgerPort` is `LT-06`, and its adapter is in `sweeps/ledger.ts`
// rather than beside the driver because the manifest's own
// `//dependencies.@merit/ledger` key grants the capability to EXACTLY ONE FILE
// and `apps/api/test/ledger-posting-authority.test.ts` asserts which. One door
// per DEPLOYABLE, which is what ADR-165 set for `@merit/db` at `src/db.ts`.
// `recordApprovalTransaction` has no caller under `src/` either, so
// `APPROVAL_LEDGER` refuses every handle it could be given today.
export {
  APPROVAL_LEDGER,
  ApprovalLedgerHandleUnknown,
  EXPIRY_LEDGER,
  ExpiryLedgerHandleUnknown,
  recordApprovalTransaction,
  recordExpiryTransaction,
} from './sweeps/ledger.ts';

// -----------------------------------------------------------------------------
// THE `LT-06` WITHDRAWAL-APPROVAL DRIVER (session 516, ADR-325)
// -----------------------------------------------------------------------------
// ADR-305 section 7 slice 7, ruled by ADR-316. `requested --> approved` and
// `cooling --> approved`, the transition and the posting TOGETHER in one
// transaction at `systemDb('nightly-batch')`, with `INV-M20-01`'s per-identity
// lock around each one and the wallet debit inside it.
//
// **IT IS THE FIRST WRITER OF A `wallet_entries` ROW IN THIS APPLICATION**, so
// `balance_after_cents >= 0` (`0011:90`) is exercised by a write for the first
// time, and the first `wallet_entries` DEBIT carries NO provenance, which `0080`
// made writable (ADR-322).
//
// **NOTHING SCHEDULES IT AND NOTHING WIRES IT.**
// `UNWIRED_WITHDRAWAL_APPROVAL_IO` is the only `WithdrawalApprovalSweepIo` in
// this tree and it refuses every call. Slice 8 is the clock and slice 9 is the
// installation, and slice 9 MUST NOT BE DISPATCHED BEFORE A PAYMENT RAIL
// EXISTS: past `approved` the only arrow is `transferring`, `packages/rail`
// opens no socket, and `0072`'s `WD-C2` refuses `approved --> cancelled` at the
// database, so a wired deployment would extinguish a wallet claim into a state
// with no exit and no cancel. That is strictly worse for a trader than the 503
// they get today. ADR-305 section 5 is the measurement.
export {
  APPROVABLE_STATUSES,
  APPROVAL_GUARDS,
  IDENTITY_STATUSES,
  KYC_STATES,
  MACHINE_APPROVAL_HOLDS,
  WALLET_DIRECTIONS,
  WITHDRAWAL_DEBIT_CAUSE,
  ApprovalRowError,
  currentKycState,
  decideMachineApproval,
  positionOf,
  runWithdrawalApprovals,
  toApprovalCandidateRow,
  toApprovalDestinationRow,
  toApprovalIdentityRow,
  toApprovalWalletEntryRow,
  walletDebitedEvent,
  withdrawalApprovalsClean,
  withdrawalApprovedEvent,
} from './withdrawals/approval-sweep.ts';
export type {
  ApprovalCandidateRow,
  ApprovalDestinationRow,
  ApprovalGuard,
  ApprovalIdentityRow,
  ApprovalOutcome,
  ApprovalWalletEntryRow,
  IdentityApprovalOutcome,
  IdentityStatus,
  KycState,
  MachineApprovalDecision,
  MachineApprovalHold,
  MachineApprovalValues,
  WithdrawalApprovalReport,
} from './withdrawals/approval-sweep.ts';

export {
  APPROVAL_TABLES,
  UNWIRED_WITHDRAWAL_APPROVAL_IO,
  WithdrawalApprovalUnwired,
} from './withdrawals/ports.ts';
export type {
  ApprovalEvent,
  ApprovalEventName,
  ApprovalEventPort,
  ApprovalFacts,
  ApprovalFilter,
  ApprovalLedgerPort,
  ApprovalTable,
  ApprovalTx,
  ApprovalValues,
  WithdrawalApprovalSweepIo,
} from './withdrawals/ports.ts';

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

// -----------------------------------------------------------------------------
// M10's LIFECYCLE MESSAGING (session 328, P7-m)
// -----------------------------------------------------------------------------
// `IN-M10-03`, AND WHAT IS REAL IS THE CONTRACT SET AND THE PROJECTION; WHAT IS
// NOT IS ANY DECLARED FIELD LIST AND ANY SEND. That is this file's own standard
// for the batch and the saga above, applied to a disclosure path.
//
// `integration_contracts` is `SD-M10-01`'s row and its stated reason is that
// "what are we sending Loops" should be answerable without reading a repository.
// The twelve contracts below carry the answer and today it is NOTHING: every
// allowlist ships `undeclared` and EMPTY, because `M10:31` says the module
// carries "the minimum payload each needs" and the corpus never says what that
// is for any of the twelve. `0018`'s own
// `integration_contracts_enabled_has_fields` is what makes that a legal row.
//
// **TWELVE AND NOT NINE.** `M10:31` and `M10:165` both say nine and `EVENTS`
// section 11 carries twelve; session 163 found it and this slice transcribes the
// document. The three M10 does not count are `payout.held`,
// `payout.hold_released` and `identity.restriction_lifted`, all three "always
// send", and `M10:372` generates the negative allowlist tests FROM THE CONTRACT
// ROWS, so a nine-row table would have generated a correct suite that never met
// them.
//
// THERE IS NO PORT AND NO `events` READ HERE, AND THE REASON IS NOT THIS SLICE'S
// CHOICE. `P7` section 8 named `P5-b` as the dependency for `events`; `P5-b` ran
// and REFUSED that table, and `packages/db/src/scope.ts` still says why. So the
// module takes the event as a VALUE, imports nothing at all, and the dispatcher
// that reads the table is owed by the session that gets `events` a scope class.
export {
  DISPATCH_STATUSES,
  FORBIDDEN_FIELDS,
  LOOPS_CONTRACTS,
  LOOPS_DISPATCH_POLICY,
  LOOPS_INTEGRATION,
  LOOPS_TRIGGERS,
  LoopsEgressError,
  contractFor,
  dispatchToLoops,
  evaluateGuard,
  forbiddenFor,
  projectForLoops,
  projectWith,
  triggerFor,
} from './integrations/loops.ts';
export type {
  DispatchNumber,
  DispatchStatus,
  GuardOutcome,
  LoopsContract,
  LoopsDispatchDecision,
  LoopsDispatchPolicy,
  LoopsEvent,
  LoopsGuard,
  LoopsLiveState,
  LoopsProjection,
  LoopsTrigger,
} from './integrations/loops.ts';

// -----------------------------------------------------------------------------
// THE NIGHTLY RECONCILIATION SWEEP (session 387)
// -----------------------------------------------------------------------------
// `OVERVIEW` section 5.2's own stage -- "W->>W: reconciliation: our EOD balance
// vs Rithmic stated" -- ARRIVING AS CODE FOR THE FIRST TIME. `0064` landed the
// run record on 2026-08-28 and named the producer as one of the two things that
// did not clear; this is that producer, AND THE COMPARISON IT RECORDS, because
// the comparison did not exist either.
//
// **THAT SECOND HALF WAS MEASURED RATHER THAN ASSUMED AND IT IS THE FINDING.**
// Nothing under `apps/*/src` or `packages/*/src` wrote `reconciliations`,
// nothing wrote `reconciliation_runs`, and nothing set `accounts.recon_blocked`;
// every occurrence of all three in application code is a read or a
// registration. So a producer that wrote only the run row would have made
// `integrations.recon.last_run_at` truthful and the panel useless, which is a
// threshold with no window in a different table.
//
// **`BatchWritePort.raiseReconciliation` IS NOT THIS.** That port is `DO-3`'s
// refusal channel -- the fold declining to run and writing no state -- and this
// is the comparison that runs after a fold succeeded and disagrees with it.
// `batch/ports.ts` draws the identical line one register over between
// reconciliation and replay divergence.
//
// **IT IS WRITTEN AGAINST PORTS AND IT IS UNWIRED, exactly as `runNightlyBatch`,
// the provisioning saga, the expiry sweep and the detector runner are** -- and
// the door question, which has decided the size of three slices in this
// deployable, is answered HERE and answered in this deployable's favour.
// `src/db.ts`'s `LIVE_DB.batch` yields a `SystemTx` whose `rowsWhere`, `insert`
// and `updateAt` are generic over `TableKey`, and the sweep's two tables sit in
// two different scope classes: `reconciliation_runs` is `firm` and
// `reconciliations` is `derived` through `account_id`. `apps/api`'s `firm` door
// can reach the first and CANNOT NAME THE SECOND, which `routes/internal.ts`
// already says about itself. So `apps/api` could have written the clock and
// never the finding, and the producer belongs here by the accessor's own key
// types rather than by preference.
//
// WHAT IS REAL IS THE COMPARISON, THE THREE-WAY VERDICT, THE RUN RECORD'S OPEN
// AND CLOSE, AND THE BLOCK; WHAT IS NOT IS THE ADAPTER AND THE SCHEDULE, and the
// difference is visible in the type rather than left to a reader.
export {
  EMPTY_POPULATION_STATUS,
  ReconRowError,
  ReconSweepError,
  compareBalances,
  isPlatformStated,
  runReconciliationSweep,
} from './recon/sweep.ts';
export type {
  ReconCandidate,
  ReconOutcome,
  ReconSweepConfig,
  ReconSweepReport,
  ReconUncomparableReason,
  ReconVerdict,
} from './recon/sweep.ts';

export {
  PLATFORM_STATED_MARK_SOURCES,
  RECON_READ_TABLES,
  RECON_RUN_STATUSES,
  RECON_SOURCE,
  RECON_STATUSES,
  RECON_WRITE_TABLES,
  ReconSweepUnwired,
  UNWIRED_RECON_SWEEP_IO,
} from './recon/ports.ts';
export type {
  PlatformStatedMarkSource,
  ReconFilter,
  ReconFilterTerm,
  ReconReadTable,
  ReconRow,
  ReconRunStatus,
  ReconStatus,
  ReconSweepIo,
  ReconTerms,
  ReconTx,
  ReconValues,
  ReconWriteTable,
} from './recon/ports.ts';

// -----------------------------------------------------------------------------
// THE JOB REGISTRATION (ADR-305 section 7 slice 8, ADR-326)
// -----------------------------------------------------------------------------
// WHICH JOBS THIS DEPLOYABLE HAS BUILT, WHICH ONE HAS A CLOCK, AND FOR EVERY
// OTHER ONE THE BLOCKER THAT KEEPS IT OFF ONE. It is a leg rather than a module
// the suite imports by path, because the docblock over `./job.ts` below now
// points at it instead of counting, and a pointer into a module this barrel does
// not carry would be one import short of the thing it names.
export {
  SCHEDULED_JOB_ENTRY_POINTS,
  UNSCHEDULED_CRON_ROWS,
  UNSCHEDULED_JOB_ENTRY_POINTS,
  WORKER_JOB_ENTRY_POINTS,
} from './schedule.ts';
export type { JobDisposition, WorkerJobEntryPoint } from './schedule.ts';

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
  './batch/adapter.ts',
  './batch/nightly.ts',
  './batch/ports.ts',
  './batch/replay.ts',
  './batch/state-hash.ts',
  './batch/state-writer.ts',
  './batch/statistics-adapter.ts',
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
  './integrations/loops.ts',
  './job.ts',
  './live/ingest.ts',
  './live/ports.ts',
  './provisioning/index.ts',
  './recon/ports.ts',
  './recon/sweep.ts',
  './schedule.ts',
  './sweeps/expiry-adapter.ts',
  './sweeps/expiry.ts',
  './sweeps/ledger.ts',
  './sweeps/ports.ts',
  './withdrawals/approval-sweep.ts',
  './withdrawals/ports.ts',
] as const;

/**
 * Modules that reach this barrel THROUGH a leg rather than as one.
 *
 * `provisioning/index.ts` is itself a barrel over these EIGHT, which is why it
 * is the only `provisioning` specifier above. They are listed rather than left
 * out so that the sweep in the suite is TOTAL: a module that is neither a leg,
 * nor behind one, nor deliberately absent is a module nobody has decided about.
 *
 * **THIS SENTENCE READ "these six" AND THE LIST HELD SEVEN, WHICH IS A COUNT
 * NOTHING DERIVES.** Found by ADR-338 while adding the eighth, and corrected by
 * counting the entries below rather than by trusting the word. It is recorded
 * rather than merely fixed because it is the third hand-written count in this
 * deployable's barrel to be wrong (`ADR-241` found "FIVE ... enumerated SIX" in
 * this same file), and the repair that does not need a fourth session is a
 * derivation: `test/digests.test.ts` reads the list, so the LIST cannot drift
 * from the tree, and only the numeral in this prose can.
 */
export const WORKER_MODULES_BEHIND_A_LEG: Readonly<Record<string, string>> = {
  './provisioning/admission.ts': 're-exported through ./provisioning/index.ts',
  './provisioning/compensation.ts': 're-exported through ./provisioning/index.ts',
  './provisioning/machine.ts': 're-exported through ./provisioning/index.ts',
  './provisioning/payload.ts': 're-exported through ./provisioning/index.ts',
  './provisioning/ports.ts': 're-exported through ./provisioning/index.ts',
  './provisioning/queue-adapter.ts': 're-exported through ./provisioning/index.ts',
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
  // The phrasing below avoids ending a wrapped segment with the word "from",
  // which `test/db.test.ts`'s bare-specifier scan reads as an import. Session
  // 320 reported that defect and this session walked into it; the regex is
  // still live, that file is nobody's this wave, and the note is here so the
  // next writer does not rediscover it by turning the suite red.
  './db.ts':
    'THE ONE DOOR. ADR-165 and `test/db.test.ts`: this is the only file under apps/worker/src ' +
    'that may import @merit/db. Re-exporting it would leave every consumer of this package one ' +
    'import short of the accessor.',
  './queue.ts':
    'THE OTHER ONE DOOR (ADR-333). This is the only file under apps/worker/src that may import ' +
    '@merit/queue, and `test/queue.test.ts` and `test/schedule.test.ts` case 5.1 each pin the ' +
    'importer list at exactly this one file. IT IS NOT A LEG AND `./sweeps/ledger.ts` IS, WHICH ' +
    'IS THE DISTINCTION WORTH READING: that file exports an ADAPTER over a port, and this one ' +
    'exports the CAPABILITY, which is `./db.ts`s class. Re-exporting it would leave every ' +
    'consumer of this package one import short of a constructed queue on the money database.',
  './start.ts':
    'THE PROCESS ENTRY POINT. `apps/api/src/start.ts` states the ruling this transcribes: this ' +
    'package`s `exports` target is `index.ts`, so importing it must have no effect, and a barrel ' +
    'that re-exported the entry point would run the nightly batch on import. It is not a module ' +
    'anything imports; `package.json`s `start` names it and nothing else does. ADR-241.',
  './batch/statistics.ts':
    "M12's statistics run (ADR-122) has never been re-exported here and `test/statistics.test.ts` " +
    'imports it by path. FOUND BY WRITING THIS LIST rather than by a merge, and RECORDED rather ' +
    'than repaired: adding a leg is a decision for the slice that owns that file.',
};

/** The Railway service this app deploys as (INFRA section 2). */
export const SERVICE = 'worker' as const;

/**
 * THIS DEPLOYABLE IS SCHEDULED NOW, AND WHAT USED TO STAND HERE WAS THE DEFECT.
 *
 * The paragraph this replaces read "Still not a scheduled application, and the
 * missing piece has moved again", and under it sat `export function main(): void`
 * whose body was a `console.log` describing everything the module does not do.
 * **NOTHING CALLED IT.** `ADR-239` measured `pnpm --filter @merit/worker start`
 * printing nothing and exiting 0, and the allocation row re-derived both halves:
 * `package.json`'s `start` named this file, and `grep -c "^main();"` over this
 * file returned 0. A process that exits 0 having done nothing is what a healthy
 * service looks like to a supervisor.
 *
 * **`main` NOW LIVES IN {@link WORKER_BARREL_LEGS}' `./job.ts` AND IS RE-EXPORTED
 * HERE**, `src/start.ts` calls it, and a failed batch leaves a NON-ZERO exit
 * status. `ADR-241` is the ruling, the schedule is EXTERNAL and registered in
 * `CRON_INVENTORY`, and `test/entrypoint.test.ts` watches a real process exit
 * rather than reasoning about one.
 *
 * WHAT IS STILL ABSENT IS NAMED RATHER THAN IMPLIED, AND IT IS NAMED IN DATA
 * BECAUSE THE LAST TWO ATTEMPTS AT NAMING IT IN PROSE BOTH WENT STALE WITH
 * EVERY GATE GREEN.
 *
 * **THIS PARAGRAPH READ "The job store is still not installed: pg-boss's schema
 * is not in `packages/db/migrations`, so there is nothing to enqueue into, and
 * the five other jobs this deployable has built (detector runs, the expiry
 * sweep, the two digest producers, the breaker evaluation and the statistics
 * run) are still unscheduled, each with its own row in `CRON_INVENTORY` saying
 * so."** Every clause of it is now false or was never right. `0079` installed
 * the schema and merged. The list said FIVE and enumerated SIX. The inventory it
 * cited carried the marker on fewer rows than either number. And `ADR-325` built
 * a further job after the sentence was written. **NOTHING WENT RED FOR ANY OF
 * IT**, because a hand-maintained count in a comment is asserted by nothing, and
 * that is the same defect `ADR-324` repaired at a different site one row ago.
 *
 * **THE REPAIR IS THAT THE LIST IS {@link WORKER_JOB_ENTRY_POINTS} AND THE
 * COUNT IS DERIVED FROM IT.** Every job entry point under `src/` carries its
 * `CRON_INVENTORY` row, its disposition and, when it has none, the blocker that
 * keeps it off a clock. `test/schedule.test.ts` reads the tree for job entry
 * points, reads `packages/db/migrations` for the store, and reads the inventory
 * for its markers, and fails when any of the three disagrees with the data.
 * `ADR-305` section 7 slice 8 and `ADR-326`.
 */
export {
  BATCH_CONCURRENCY,
  ENGINE_VERSION_VAR,
  TRADING_DAY_VAR,
  WorkerJobRefusal,
  liveWorkerIo,
  main,
  resolveEngineVersion,
  resolveTradingDay,
} from './job.ts';
export type { WorkerJobIo } from './job.ts';
