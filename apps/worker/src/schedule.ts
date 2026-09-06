// =============================================================================
// apps/worker/src/schedule.ts
// =============================================================================
// **THE WORKER'S JOB REGISTRATION. WHICH JOBS THIS DEPLOYABLE HAS BUILT, WHICH
// ONE HAS A CLOCK, AND FOR EVERY OTHER ONE THE BLOCKER THAT KEEPS IT OFF ONE.**
//
// `ADR-305` section 7 slice 8, ruled by `ADR-326`. That entry's stop condition
// is that the jobs this deployable has built are "each scheduled, or each left
// unscheduled ON THE RECORD", and this file is the record. A job left
// unscheduled is a legitimate outcome; a job left unscheduled in silence is
// `ADR-239`'s defect, which is a process that looks healthy to a supervisor
// because it exits 0 having done nothing.
//
// -----------------------------------------------------------------------------
// WHY THE LIST IS DATA AND NOT A SENTENCE, WHICH IS THIS ROW'S OWN OPENING
// -----------------------------------------------------------------------------
// The docblock over the `./job.ts` leg of `index.ts` carried a hand-typed count
// of the jobs "still unscheduled". It named five and enumerated six, the
// inventory it cited marked three, and `ADR-325` then built a seventh the
// sentence predated. Nothing went red, because nothing derived the number from
// the tree. `test/schedule.test.ts` derives it from this array in both
// directions, so the next job is a row somebody adds or a suite that fails.
//
// -----------------------------------------------------------------------------
// THE CLOCK IS EXTERNAL AND `pg-boss` IS NOT IT. THREE REASONS, EACH MEASURED
// -----------------------------------------------------------------------------
// 1. **`JobQueue` HAS NO `schedule` METHOD AND CANNOT GROW ONE FROM HERE.**
//    `packages/queue/src/job-queue.ts` declares five methods, `JOB_QUEUE_METHODS`
//    lists them as data, and `EveryJobQueueMethodIsListed` makes a sixth a
//    COMPILE error until the list moves with it. `packages/queue/**` is outside
//    `ADR-326`'s fence, so a cron primitive is a later row's to admit.
// 2. **A CRON INSIDE THE PROCESS NEEDS A LONG-LIVED PROCESS, WHICH `ADR-241`
//    REFUSED IN TERMS.** `CRON_INVENTORY`'s nightly-batch row: "a long-lived
//    process has no exit code to fail with: the only status it ever leaves is
//    the status of its last moment", and that page's whole grammar is the
//    ABSENCE of a completion signal by an expected-by time, which presumes
//    discrete runs with discrete completions.
// 3. **THIS ITEM READ "THE ROLE THIS DEPLOYABLE CONNECTS AS CANNOT REACH THE
//    STORE. `0026_roles_and_grants.sql` grants `USAGE` and default privileges
//    `IN SCHEMA public` and nowhere else, so `merit_app` holds neither `USAGE`
//    nor `CREATE` on `pgboss`. `0079` states that as a deliberate omission and
//    `probe_pgboss_job_store.sql` REJECTION 5 asserts the absence, naming
//    `ADR-305` slice 8 as the row that owes the ruling. `ADR-326` rules it and
//    the migration that acts on the ruling is owed by a row whose fence holds
//    `packages/db/**`, which `ADR-326`'s does not", AND
//    `0082_pgboss_app_grants.sql` MADE IT FALSE ON THE DAY IT MERGED
//    (`ADR-327`, 2026-09-03).** It is kept beside its correction rather than
//    deleted, per `RI-14`, and ADR-338 registered it so `RI-35` holds the
//    correction to the tree. **THE ROLE REACHES THE STORE NOW**: `0082` grants
//    `USAGE` on `pgboss` plus the fifteen table privileges pg-boss was measured
//    to need, and `CREATE` is still withheld because `create_queue` runs DDL
//    only for a PARTITIONED queue, which `declareQueue` never asks for. **THE
//    ITEM'S CONCLUSION SURVIVES ANYWAY AND ITEMS 1 AND 2 CARRY IT**: a grant is
//    not a cron primitive, and this deployable is still a one-shot process.
//    **FOUND BY ADR-338 RATHER THAN BY A CHECK**, which is the whole argument
//    for registering it: `0079`'s falsification of a neighbouring sentence one
//    package over is `RI-35`'s own occurrence 3, and this is the same shape at a
//    site the register had never met.
//
// SO A SCHEDULED JOB HERE MEANS: an external scheduler starts a process, the
// process runs the job once, prints its completion line and exits, and the exit
// code is the only signal. That is `ADR-241`'s shape and this file adds no
// second one.
//
// -----------------------------------------------------------------------------
// WHY ONE JOB IS SCHEDULED AND ELEVEN ENTRY POINTS ARE NOT, AND IT IS ONE REASON
// -----------------------------------------------------------------------------
// **EVERY JOB BELOW EXCEPT THE NIGHTLY BATCH IS WRITTEN AGAINST PORTS THAT NO
// `src/` FILE IMPLEMENTS.** Nine `UNWIRED_*_IO` values stand as the only
// inhabitant of their own port type, and a census of callers under every `src/`
// tree in this workspace returns a caller for `runNightlyBatch` and for nothing
// else on this list. A schedule in front of a job with no live adapter is a
// scheduler that starts a process to throw, so the blocker is the adapter and
// the clock is downstream of it.
//
// **AND IT IS TRUE OF EVERY PORT EXCEPT TWO SINCE ADR-350, WHICH IS THE SAME
// AMENDMENT A SECOND TIME AND IS KEPT BESIDE THE FIRST.**
// `./batch/statistics-adapter.ts` implements `StatisticsPorts` over the one
// door, so the statistics run is the second job on this list whose ports have a
// live inhabitant. **IT IS THE FIRST ONE WHOSE ADAPTER IS PARTIAL ON PURPOSE**:
// three of its nine methods refuse, and two of the three refuse because a
// published statistic would otherwise be computed over a fact this estate cannot
// produce. `runStatisticsRun` reads every fact set per window, so a refusal ends
// the run rather than shrinking it, which is `FM-M12-02` holding by construction.
// **THE CALLER CENSUS DID NOT MOVE**: `runStatisticsRun` still has none.
//
// **THE OPENING CLAUSE IS NOW TRUE OF EVERY PORT EXCEPT ONE AND IT IS KEPT
// WHOLE, per `RI-14`.** ADR-338 wrote `./provisioning/queue-adapter.ts`, so
// `ProvisioningJobQueue` has a live inhabitant and the provisioning saga is
// written against FOUR ports of which ONE is now implemented. **THE NINE
// `UNWIRED_*_IO` VALUES DID NOT MOVE** and neither did the caller census: the
// saga's other three ports are a vendor adapter that does not exist and two
// that `provisioning/ports.ts` measures as blocked by `ADR-102`'s `WHERE`-less
// system write path, so the row below stays `unscheduled` and the disposition
// case that derives it from the tree stays green for the reason it always had.
//
// **AND ADR-344 TOOK THE SECOND BITE OUT OF THE SAME CLAUSE, WHICH IS ALSO KEPT
// WHOLE per `RI-14`.** `./sweeps/expiry-adapter.ts` builds an `ExpirySweepIo`
// over this deployable's own doors, so `UNWIRED_EXPIRY_SWEEP_IO` is no longer
// THE ONLY inhabitant of its port type and the count of ports with no
// implementation anywhere is EIGHT rather than nine. **THE `UNWIRED_*_IO`
// VALUES THEMSELVES DID NOT MOVE AND NEITHER DID THE CALLER CENSUS**: nine of
// them are still exported and still the DEFAULT, refusing is still the correct
// outcome for a deployment that installs nothing, and `runExpirySweep` still
// has no caller under any `src/`. The expiry row's own `why` carries the
// measurement and the fifth port it cannot serve.
//
// **AND ADR-349 TOOK THE THIRD BITE, ON THE DETECTOR RUNNER.**
// `./detectors/adapter.ts` builds a `DetectorRunnerIo` over the same doors, so
// `UNWIRED_DETECTOR_RUNNER_IO` is no longer THE ONLY inhabitant of its port type
// either, and the count of ports with no implementation anywhere is **SEVEN**
// rather than eight, derived over `apps/worker/src` after the merge that carried
// both rows. **THE NINE `UNWIRED_*_IO` VALUES STILL DID NOT MOVE** and the
// caller census did not either: nothing under any `src/` calls `runDetectors`.
//
// **AND THE DETECTOR ROW STAYS `unscheduled` FOR A REASON THAT IS NOT THE
// ADAPTER, WHICH IS WHY THE OPENING CLAUSE SURVIVES BEING FALSIFIED A THIRD
// TIME.** That adapter serves FOUR of `DetectorRunnerIo`'s five members. The
// fifth is the EVENT SINK and this deployable can reach no sink at all:
// `test/event-sink.test.ts` establishes the shape of that gap across three ports
// at once, and two of the detector runner's three event names would be refused
// by the producer one deployable over even if the import were legal. `runner.ts`
// emits inside the write transaction and emits UNCONDITIONALLY, so the composed
// value writes NO `detector_runs` row. That is the second blocker; the empty
// `detector_definitions` table is the third. The row's `why` enumerates all
// three.
// **AND ADR-345 TOOK THE THIRD BITE, WHICH IS WHY THE PARAGRAPH ABOVE'S "EIGHT"
// IS ALREADY STALE AND IS KEPT ANYWAY per `RI-14`.** `./recon/adapter.ts` builds
// a `ReconSweepIo` over this deployable's one door, so `UNWIRED_RECON_SWEEP_IO`
// is no longer THE ONLY inhabitant of its port type either. **THE TWO ROWS
// LANDED IN THE SAME WAVE AND EACH COUNTED NINE DOWN TO EIGHT WITHOUT SEEING THE
// OTHER**, which is this file's own lesson about hand-typed counts arriving one
// register over. **DERIVED AT THIS MERGE RATHER THAN SUBTRACTED**: of the nine
// `UNWIRED_*_IO` values, a census for a function or a value under `src/` whose
// type is the same port finds one for `ExpirySweepIo` and one for
// `ReconSweepIo` and none for the other seven. **THE VALUES THEMSELVES DID NOT
// MOVE AND NEITHER DID THE CALLER CENSUS**: all nine are still exported, still
// the DEFAULT, and refusing is still the correct outcome for a deployment that
// installs nothing; nothing under `src/` calls `runReconciliationSweep`, and the
// recon row's own `why` carries the three blockers that are not an adapter.
// **WIRING AND SCHEDULING ARE TWO DECISIONS AND THIS FILE IS WHERE THE SECOND
// ONE IS RECORDED**, which is the whole reason the disposition is derived from a
// census rather than typed.
//
// **AND THE CENSUS ABOVE IS A CENSUS OF CONSTRUCTORS, WHICH IS SAID BECAUSE IT
// IS NOT THE SAME QUESTION.** `UNWIRED_RULE_STATE_WRITER_IO` is counted among
// the seven and `batch/adapter.ts` composes a `RuleStateWriterIo` INLINE at its
// `writeRuleState` leg, so that one has an inhabitant no grep for a returned
// type will find. Reported here rather than repaired: the number this file cares
// about is which JOBS have no live io, and that one is a leg of a job that runs.
//
// **BOTH PARAGRAPHS ABOVE CALL THEMSELVES THE THIRD BITE AND BOTH SAY SEVEN,
// AND NEITHER IS THE COUNT ON THIS TREE.** ADR-349 and ADR-345 landed in the
// same wave on branches that could not see each other, exactly as ADR-344 and
// ADR-350 did one paragraph up, and each subtracted its own adapter from eight
// and arrived at seven. Both are kept whole under `RI-14` because each was
// correct over the tree it was derived on. **DERIVED AT THIS MERGE, OVER ALL
// THREE ROWS AT ONCE: THE COUNT IS SIX.** Of the nine `UNWIRED_*_IO` values, a
// census for a declaration under `apps/worker/src` whose RETURN type is the
// same port finds `./sweeps/expiry-adapter.ts` for `ExpirySweepIo`,
// `./detectors/adapter.ts` for `DetectorRunnerIo` and `./recon/adapter.ts` for
// `ReconSweepIo`, and nothing for the other six. **THE NINE VALUES STILL DID
// NOT MOVE AND NEITHER DID THE CALLER CENSUS**: all nine are still exported,
// still the DEFAULT, refusing is still the correct outcome for a deployment
// that installs nothing, and nothing under any `src/` calls `runExpirySweep`,
// `runDetectors` or `runReconciliationSweep`. **THE CENSUS IS OF CONSTRUCTORS
// AND THAT IS NOT THE SAME QUESTION**, which is ADR-345's caveat and it
// survives the correction: `UNWIRED_RULE_STATE_WRITER_IO` is among the six and
// `batch/adapter.ts:908` composes a `RuleStateWriterIo` INLINE through
// `writeRuleStateVia`, so that one has an inhabitant no grep for a returned
// type will find. Reported and not repaired: the number this file cares about
// is which JOBS have no live io, and that one is a leg of a job that runs.
//
// **THE WITHDRAWAL DRIVER IS THE ONE WHOSE BLOCKER IS NOT AN ADAPTER**, and it
// is the reason this row does not simply write eleven adapters. `ADR-305`
// section 5: past `approved` the only arrow is `transferring`, `packages/rail`
// opens no socket, and `0072`'s `WD-C2` refuses `approved --> cancelled` at the
// database. A live clock in front of `runWithdrawalApprovals` posts `LT-06`,
// extinguishes a trader's wallet claim and leaves the money in a state with no
// exit and no cancel. **THAT IS SLICE 9's HARM ARRIVING UNDER SLICE 8's NAME**,
// so the driver gets a `CRON_INVENTORY` row with a dead-man switch and does not
// get a live schedule, and the switch fires today precisely because the job is
// not running.
// =============================================================================

/** Whether a job runs on a clock in a deployment, or does not. */
export type JobDisposition = 'scheduled' | 'unscheduled';

/**
 * One job entry point this deployable has built.
 *
 * KEYED ON THE ENTRY POINT AND NOT ON THE JOB, which is the distinction the
 * sentence this file replaces got wrong. Two entry points may answer to one
 * `CRON_INVENTORY` row: the nightly batch has its fold and its process wrapper,
 * and the digest work has a producer and the alarm that reads what the producer
 * failed to deliver. Counting rows and counting entry points give different
 * numbers, both are right about different questions, and the sentence that
 * named five and listed six was counting neither consistently.
 */
export interface WorkerJobEntryPoint {
  /** The module, by the specifier the barrel re-exports it under. */
  readonly module: string;
  /** The exported name. `test/schedule.test.ts` asserts the module exports it. */
  readonly entryPoint: string;
  /**
   * The `CRON_INVENTORY` scheduled-table row this job answers to, lower case
   * and without its parenthetical, which is that document's own normal form for
   * a job name (`gates.mjs`'s `normJob`).
   */
  readonly cronRow: string;
  readonly disposition: JobDisposition;
  /** For a scheduled job, how it starts. For an unscheduled one, the blocker. */
  readonly why: string;
}

/**
 * Every job entry point under `apps/worker/src`, with its disposition.
 *
 * SORTED BY MODULE. `test/schedule.test.ts` asserts, in both directions, that
 * every entry here names a module and an export the tree still carries, and that
 * every `export async function run*`, `start*` or `main` under `apps/worker/src`
 * appears here. A new job is a row somebody writes or a suite that goes red.
 */
export const WORKER_JOB_ENTRY_POINTS: readonly WorkerJobEntryPoint[] = [
  {
    module: './batch/nightly.ts',
    entryPoint: 'runNightlyBatch',
    cronRow: 'nightly batch',
    disposition: 'scheduled',
    why:
      'THE ONE JOB WITH A LIVE ADAPTER AND THE ONLY ENTRY POINT ON THIS LIST WITH A CALLER. ' +
      '`postgresBatchPorts(io.db)` implements `BatchPorts` over `systemDb`, `main` calls it and ' +
      '`src/start.ts` calls `main`. ADR-241 ruled the schedule EXTERNAL: the platform scheduler ' +
      'starts one process per run and a failed fold leaves a non-zero exit status.',
  },
  {
    module: './batch/replay.ts',
    entryPoint: 'runReplayAudit',
    cronRow: 'replay self-audit',
    disposition: 'unscheduled',
    why:
      'NO LIVE PORTS AND NO CALLER. The audit takes its reads and its writes as an argument and ' +
      'no `src/` file supplies one, so a clock in front of it would start a process with nothing ' +
      'to hand it. ADR-119 is why it is its own job rather than a leg of the batch.',
  },
  {
    module: './batch/statistics.ts',
    entryPoint: 'runStatisticsRun',
    cronRow: 'statistics run',
    disposition: 'unscheduled',
    why:
      'NO LIVE PORTS AND NO CALLER, and its own CRON_INVENTORY row already says so in its own ' +
      'words. Its two preconditions are the batch and the self-audit, and the second of those ' +
      'is unscheduled one row up, so scheduling this one first would publish off an unaudited ' +
      'fold. ADR-122. ' +
      'THE FIRST CLAUSE IS HALF FALSE NOW AND IS KEPT BESIDE ITS CORRECTION per RI-14. ADR-350 ' +
      'wrote `./batch/statistics-adapter.ts`, so `StatisticsPorts` has an inhabitant that ' +
      'reaches the real tables: four of the six read ports and the write port are SERVED. ' +
      'WHAT KEEPS THIS ROW UNSCHEDULED IS FOUR THINGS AND THE ADAPTER IS NONE OF THEM. ' +
      'ONE, there is still NO CALLER: no `src/` file calls `runStatisticsRun`. ' +
      'TWO, the self-audit precondition above is unchanged, so `selfAuditGreen` can never be ' +
      'established and every run would halt at `waiting` with `inputs_not_vouched`. ' +
      'THREE, `statistic_definitions` has NO ROWS in this repository, no seed and no migration ' +
      'that inserts one, so a run over a freshly migrated database halts at ' +
      '`no_effective_definitions`. ' +
      'FOUR, three ports REFUSE and two of those refuse because Merit cannot yet produce the ' +
      "FACT the definition asks for: ST-02's denominator needs the plan's maximum plausible " +
      'time-to-first-payout, which no column, plan rule or config row carries, and ST-06 needs ' +
      'the trading day a rail settlement counts for, which no column carries and no document ' +
      'rules. A clock in front of this job today is a process that pages every night and ' +
      'publishes nothing, which is the ADR-239 defect in its other direction.',
  },
  {
    module: './breaker/evaluate.ts',
    entryPoint: 'evaluateBreaker',
    cronRow: 'plan breaker evaluation',
    disposition: 'unscheduled',
    why:
      'THIS ROW READ "`UNWIRED_BREAKER_IO` is the only `BreakerIo` in the tree" AND ADR-352 ' +
      'WROTE THE SECOND ONE, so the sentence is kept beside its correction (RI-14) and the ' +
      'disposition does not move, BECAUSE THE ADAPTER WAS NEVER THE ONLY BLOCKER AND THERE ARE ' +
      'THREE. The row already said so in its own second clause and that clause is unchanged and ' +
      'is now blocker two. ' +
      'ONE, `postgresBreakerIo` serves FOUR of `BreakerIo`s five members; the fifth is `events` ' +
      'and no sink is reachable from this deployable at all (RI-04, node-linker=isolated), while ' +
      'the name `breaker.state_changed` is in none of `EVENT_CATALOGUE`s ten and would be refused ' +
      'by the producer under ADR-159 clause 1 even if one were. AND THE COST IS THE WHOLE RUN ' +
      'RATHER THAN ONE PLAN: `evaluate.ts` holds ONE transaction for every plan (ADR-006) and ' +
      'catches nothing, and the FIRST evaluation emits for every active plan because `from_state` ' +
      'is null there, so a deployment holding the composed value writes no `plan_breaker_state` ' +
      'row at all on its first night. ' +
      "TWO, `OQ-M6-02`'s minimum sample is the founder's and is unanswered, so the evaluator " +
      'raises `BreakerDeclined` rather than inventing a floor, and it raises it BEFORE it opens a ' +
      'transaction or reads the clock. ' +
      'THREE, AND IT IS NEW AND IS NOT RULED ANYWHERE: `0016` keys `plan_breaker_state` PRIMARY ' +
      'KEY (plan_id, evaluated_on), `BreakerTx` publishes a plain insert with no upsert, and ' +
      'CRON_INVENTORY schedules this job DAILY while `evaluated_on` would carry the LAST CLOSED ' +
      'trading day. Those two cadences disagree on every non-session day, where a second run ' +
      'recomputes a DIFFERENT window against the SAME key and Postgres refuses it. What ' +
      '`evaluated_on` means is a founder ruling and ADR-352 section 5 records it as an open ' +
      'question rather than deciding it. A clock in front of this job today is a process that ' +
      'pages every weekend and writes nothing.',
  },
  {
    module: './detectors/runner.ts',
    entryPoint: 'runDetectors',
    cronRow: 'detector runs',
    disposition: 'unscheduled',
    why:
      'THIS ROW READ "`UNWIRED_DETECTOR_RUNNER_IO` is the only `DetectorRunnerIo` in the tree" ' +
      'AND ADR-349 WROTE THE SECOND ONE, so the sentence is kept beside its correction (RI-14) ' +
      'and the disposition does not move, because THE ADAPTER WAS NEVER THE ONLY BLOCKER AND ' +
      'THERE ARE THREE. (1) `postgresDetectorRunnerIo` serves four of `DetectorRunnerIo`s five ' +
      'members; the fifth is `events` and no sink is reachable from this deployable at all ' +
      '(RI-04, node-linker=isolated), while two of the runners three event names would be ' +
      'refused by the producer even if one were. `runner.ts` emits INSIDE the write transaction ' +
      'and emits UNCONDITIONALLY, so a deployment holding the composed value writes no ' +
      '`detector_runs` row and every outcome comes back `unrecorded`. (2) `detector_definitions` ' +
      'has no producer: `packages/db/src/seed/detectors/` is a JSON file and no `.ts` under any ' +
      '`src/` reads it, so `readDefinition` finds nothing and every detector is ' +
      '`DetectorUnregistered`. (3) Eleven of the eighteen seeded rows state no number at all ' +
      '(`OQ-M7-02` is the founders and unanswered), so a loaded registry still gets ' +
      '`DetectorDeclined`. Only the first is an adapter, and its row already carries the marker ' +
      'and both halves of its dead-man switch are live and correct today: a run that is absent ' +
      'is a job nobody scheduled.',
  },
  {
    module: './digests/alarm.ts',
    entryPoint: 'findUndeliveredWindows',
    cronRow: 'scheduled digest delivery',
    disposition: 'unscheduled',
    why:
      'THE SECOND OF THE TWO DIGEST ENTRY POINTS, and the half the replaced sentence was ' +
      'counting as one with the first. `UNWIRED_DIGEST_ALARM_IO` is the only `DigestAlarmIo` in ' +
      'the tree. It reads what the producer failed to deliver, so it is exactly as unscheduled ' +
      'as the producer and not more so.',
  },
  {
    module: './digests/produce.ts',
    entryPoint: 'runDigestDeliveries',
    cronRow: 'scheduled digest delivery',
    disposition: 'unscheduled',
    why:
      '`UNWIRED_DIGEST_IO` is the only `DigestIo` in the tree. Its row asserts the query rather ' +
      'than the job, so the switch is correct with nothing running: an enabled schedule whose ' +
      'window has closed with no delivered row is the finding.',
  },
  {
    module: './job.ts',
    entryPoint: 'main',
    cronRow: 'nightly batch',
    disposition: 'scheduled',
    why:
      "THE PROCESS WRAPPER FOR THE FOLD ABOVE AND NOT A SECOND JOB. It resolves the run's three " +
      'inputs, awaits `runNightlyBatch` without wrapping it, and prints the completion line the ' +
      "dead-man switch reads. It is listed rather than folded into the fold's row because the " +
      'derivation in the suite reads exported names and would otherwise report it as unaccounted.',
  },
  {
    module: './live/ingest.ts',
    entryPoint: 'startLiveIngest',
    cronRow: 'live feed expectation sweep',
    disposition: 'unscheduled',
    why:
      'A CONTINUOUS CONSUMER RATHER THAN A DISCRETE RUN, which is the one job here that would ' +
      'not fit the inventory grammar even fully wired. `UNWIRED_LIVE_INGEST_IO` is the only ' +
      '`LiveIngestIo` in the tree, and the SWEEP its row is named for is blocked on a grant ' +
      "rather than an adapter: `0050`'s `REVOKE ALL` means `merit_app` cannot read the live " +
      'cache at all, so the expectation needs a table both roles reach.',
  },
  {
    module: './provisioning/saga.ts',
    entryPoint: 'runProvisioningSaga',
    cronRow: 'provisioning csv push',
    disposition: 'unscheduled',
    why:
      'NO LIVE PORTS AND NO CALLER, and this is the one job whose wiring would ALSO need the ' +
      'job store: `enqueueProvisioningOp` puts the row and the job on one transaction through a ' +
      '`ProvisioningJobQueue`. The `JobQueue` that `@merit/queue` publishes satisfies that port ' +
      'structurally, and the header above measures the store as unreachable by the role this ' +
      'deployable connects as. ' +
      'THE FIRST CLAUSE AND THE LAST ARE BOTH FALSE NOW AND ARE KEPT BESIDE THEIR CORRECTION ' +
      'per RI-14. `0082` (ADR-327) made the role reach the store, and ADR-338 wrote ' +
      '`./provisioning/queue-adapter.ts`, so `ProvisioningJobQueue` has a live inhabitant and ' +
      'the job store is reachable from here. WHAT IS STILL TRUE IS THE HALF THAT KEEPS THIS ROW ' +
      'UNSCHEDULED: there is NO CALLER, and three of the saga`s four ports have no ' +
      'implementation, the platform one because `packages/rithmic` implements nothing and the ' +
      'advance and read ones because ADR-102`s system write path renders no WHERE clause. ' +
      'AND NOTHING DRAINS THE QUEUE: this deployable`s door withholds `consume` and `start` on ' +
      'ADR-241`s one-shot ruling, so the row that gives this job a caller owes a drain or owes ' +
      'the argument for running without one.',
  },
  {
    module: './recon/sweep.ts',
    entryPoint: 'runReconciliationSweep',
    cronRow: 'per-identity ledger reconciliation',
    disposition: 'unscheduled',
    why:
      'THE FIRST CLAUSE OF THIS ROW READ "`UNWIRED_RECON_SWEEP_IO` is the only `ReconSweepIo` in ' +
      'the tree" AND ADR-345 MADE IT FALSE, and it is kept beside its correction per RI-14. ' +
      '`./recon/adapter.ts` is a second inhabitant, so the sweep is RUNNABLE against a real ' +
      'database and this row stays unscheduled for reasons that are not the adapter. ' +
      'THE BLOCK HAS NO RELEASE: the sweep sets `accounts.recon_blocked` on a mismatch and ' +
      '`0014_marks.sql` reserves the clearing for a HUMAN, and nothing in this tree clears it in ' +
      'code or in a route, so a clock today is a control that can stop eligibility and no ' +
      'control that can restore it. THE RUN NEEDS A `batch_run_id` NOBODY IS MINTING: OVERVIEW ' +
      'section 5.2 puts this stage INSIDE the nightly batch and `runReconciliationSweep` refuses ' +
      'a non-uuid rather than generating one, so the caller is `batch/`s and not this file`s. ' +
      'AND THE SWITCH WOULD BE SATISFIED BY THE WRONG CHECK: the row above is INV-M20-10`s ' +
      'per-identity WALLET assertion, S1 because a per-identity error hides behind a global zero ' +
      '(GS-231), and this sweep compares a rule state against a vendor mark per ACCOUNT-DAY. ' +
      'That registration mismatch is reported in ADR-345 as an open question and is not ' +
      'repaired here.',
  },
  {
    module: './sweeps/expiry.ts',
    entryPoint: 'runExpirySweep',
    cronRow: 'freeze expiry sweep',
    disposition: 'unscheduled',
    why:
      '`UNWIRED_EXPIRY_SWEEP_IO` is the only `ExpirySweepIo` in the tree. THREE `*_expires_at` ' +
      'COLUMNS NAME THIS JOB AS THEIR RELEASER in the coverage table, so it is the one entry ' +
      'here whose absence CI-06l can see the shape of, and it is still unscheduled. ' +
      'THE FIRST SENTENCE IS FALSE NOW AND IS KEPT BESIDE ITS CORRECTION per RI-14. ADR-344 ' +
      'wrote `./sweeps/expiry-adapter.ts`, so `expirySweepIo` builds an `ExpirySweepIo` over ' +
      'this deployable`s own doors: `transact` over `WorkerDb.batch`, `terms` over the ' +
      'accessor`s two read-path constructors, `ledger` over `EXPIRY_LEDGER` and `now` over the ' +
      'process clock. FOUR PORTS OF FIVE. THE LAST SENTENCE IS UNCHANGED AND THE FIFTH PORT IS ' +
      'WHY: this deployable has no event sink and cannot reach one. The only producer in this ' +
      'repository is `apps/api/src/events.ts`; RI-04 refuses a deployable depending on a ' +
      'deployable, `node-linker=isolated` means an undeclared specifier resolves at neither run ' +
      'time nor build time, and `test/event-sink.test.ts` case 3 asserts no relative specifier ' +
      'under this `src/` escapes the app. AND THE FENCE RUNS THE WRONG WAY ROUND THE HANDLE: ' +
      'that producer`s own header measures `SystemTx` as the one handle in this workspace that ' +
      'can write `events`, and `apps/api` opens only `scoped` and `firm` doors, so the producer ' +
      'has no handle and the handle has no producer. `expirySweepIo` therefore takes the sink ' +
      'as a REQUIRED argument with no default, and nothing in this tree can be passed for it, ' +
      'so the blocker is a call that does not compile rather than a sentence. A REFUSING ' +
      'DEFAULT WAS REFUSED: every leg of this sweep emits inside its own release transaction, ' +
      'so a live io over a rejecting sink is an hourly job that releases nothing while the S1 ' +
      'dead-man switch, which fires on the JOB`S ABSENCE, reports it present. That is ADR-239`s ' +
      'defect with a clock in front of it, and it is strictly worse for a trader than the ' +
      'unswept estate the switch alarms on today.',
  },
  {
    module: './withdrawals/approval-sweep.ts',
    entryPoint: 'runWithdrawalApprovals',
    cronRow: 'withdrawal approval sweep',
    disposition: 'unscheduled',
    why:
      'THE ONE ENTRY HERE WHOSE BLOCKER IS NOT AN ADAPTER, AND IT MUST STAY UNSCHEDULED UNTIL A ' +
      'PAYMENT RAIL EXISTS. `UNWIRED_WITHDRAWAL_APPROVAL_IO` is the only ' +
      '`WithdrawalApprovalSweepIo` in the tree, and writing one is not the whole of it: ADR-305 ' +
      'section 5 measures that a run posts `LT-06`, extinguishes the wallet claim and leaves an ' +
      'approved withdrawal with no exit and no cancel. The rail is FOUNDER-OWED and is not a ' +
      'slice.',
  },
];

/**
 * The jobs a deployment actually runs on a clock.
 *
 * DERIVED AND NOT LISTED, so the two halves cannot disagree. A row whose
 * disposition changes moves between this and {@link UNSCHEDULED_JOB_ENTRY_POINTS}
 * without anybody editing a second place.
 */
export const SCHEDULED_JOB_ENTRY_POINTS: readonly WorkerJobEntryPoint[] =
  WORKER_JOB_ENTRY_POINTS.filter((job) => job.disposition === 'scheduled');

/** The jobs this deployable has built and left off a clock, each with its blocker. */
export const UNSCHEDULED_JOB_ENTRY_POINTS: readonly WorkerJobEntryPoint[] =
  WORKER_JOB_ENTRY_POINTS.filter((job) => job.disposition === 'unscheduled');

/**
 * The `CRON_INVENTORY` rows whose job this deployable has built and not wired.
 *
 * THIS IS THE NUMBER THE INVENTORY'S `NOT YET WIRED OR SCHEDULED` MARKERS HAVE
 * TO MATCH, and `test/schedule.test.ts` asserts the two against each other in
 * both directions. Distinct rows and not entry points, because the marker sits
 * on a ROW and two entry points can share one.
 */
export const UNSCHEDULED_CRON_ROWS: readonly string[] = [
  ...new Set(UNSCHEDULED_JOB_ENTRY_POINTS.map((job) => job.cronRow)),
].sort();
