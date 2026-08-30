// =============================================================================
// apps/worker/src/job.ts
// =============================================================================
// **THE JOB THIS DEPLOYABLE RUNS, AND THE REASON THIS FILE EXISTS IS THAT IT
// RAN NOTHING.**
//
// `ADR-239` measured it and `ADR-241` fixes it: `apps/worker/package.json`'s
// `start` was `node --experimental-strip-types src/index.ts`, `index.ts`
// declared `export function main(): void`, and nothing in the file called it. So
// the process loaded a barrel of exports, defined `main`, and exited 0. **THAT
// IS WHAT A HEALTHY SERVICE LOOKS LIKE TO A SUPERVISOR**, and it is why no
// trader in this deployment has ever been evaluated.
//
// -----------------------------------------------------------------------------
// THE EXIT CODE IS THE ONLY SIGNAL, SO NOTHING HERE CATCHES
// -----------------------------------------------------------------------------
// `main` awaits `runNightlyBatch` and does not wrap it. A refusing port rejects,
// the rejection travels out of `main`, `src/start.ts` does not catch it either,
// and the process leaves a non-zero status. **A `try` around this call that
// logged and returned would rebuild the defect in a new costume**: the batch
// would be visibly broken in a log nobody reads and invisibly fine to the thing
// that pages.
//
// The one thing `main` does with an error is nothing. The one thing it does with
// success is print the report, because `CRON_INVENTORY`'s dead-man switch for
// this row watches for `batch.completed` and a run that says nothing has told
// the switch nothing.
//
// -----------------------------------------------------------------------------
// THREE INPUTS, AND EVERY ONE OF THEM REFUSES RATHER THAN DEFAULTING
// -----------------------------------------------------------------------------
// `NightlyBatchConfig` has three fields and each is decided here.
//
// **`tradingDay` IS READ FROM THE CALENDAR AND NEVER FROM A CLOCK.** `ADR-146`
// clause 4 forbids a UTC calendar date derived from an instant meeting an
// exchange CT trading day, so the fold compares an instant with an instant and
// READS the day off the row it selected. `MERIT_BATCH_TRADING_DAY` overrides it,
// which `RB-01` needs to re-run a night that failed.
//
// **AND NEITHER PATH GETS A DAY WITHOUT A COVERAGE VERDICT, WHICH IS `ADR-277`
// AND IS A TYPE RATHER THAN A HABIT.** This function used to call a fold that
// returned `TradingDay | null` and a guard named `calendarCarriesDay` whose
// refusal said "outside coverage" while its query asked `trading_calendar` for a
// ROW. Coverage is `trading_calendar_loads` and nothing in the schema ties the
// two, so the batch folded days no load ever declared and stamped `rule_states`
// with them. Both paths now come back as a `TradingDayAnchor` whose `tradingDay`
// lives on the `anchored` arm ALONE: a future edit that forgets the verdict does
// not compile.
//
// **`engineVersion` IS A DEPLOYMENT FACT AND THIS REPOSITORY DOES NOT KNOW IT.**
// There is no `ENGINE_VERSION` constant in `packages/rules-engine`, measured over
// its `src/`, and `@merit/rules-engine`'s manifest version is `0.0.0` on every
// build ever made. Stamping `0.0.0` on every row would make `INV-04`'s replay
// comparison unable to tell two builds apart, which is the one thing the column
// exists for, so the value comes from the environment and its absence is a
// refusal. That is `ADR-226`'s rule about an absent secret applied to a build
// identifier: a deployment that has not set it fails identically every night
// rather than writing rows nobody can attribute.
//
// **`concurrency` IS 1 AND IT IS A RULING RATHER THAN A DEFAULT.** `Appendix B.5`
// permits worker concurrency and `FM-10` requires a per-account advisory lock
// before it is safe: "settlement webhook and nightly batch race on the same
// account -> anchors advanced twice, or once with the wrong values". The adapter
// owes that lock and does not hold it (`adapter.ts`), so this file runs one
// account at a time. **ONE IN FLIGHT IS NOT THE LOCK.** It is the difference
// between a race and a queue, and the constant moves when the lock lands and not
// before, which is why it is not an environment variable somebody could raise.
// =============================================================================

import type { TradingDay } from '@merit/rules-engine';

import { runNightlyBatch, type NightlyBatchReport } from './batch/nightly.ts';
import { anchorLastClosedDay, anchorNamedDay, postgresBatchPorts } from './batch/adapter.ts';
import { LIVE_DB, type WorkerDb } from './db.ts';

/** `Appendix B.5` worker concurrency, held at one until `FM-10`'s lock exists. */
export const BATCH_CONCURRENCY = 1;

/** The environment variable naming the build that folds. No default exists. */
export const ENGINE_VERSION_VAR = 'MERIT_ENGINE_VERSION';

/** The environment variable that overrides the day, for `RB-01`'s re-run. */
export const TRADING_DAY_VAR = 'MERIT_BATCH_TRADING_DAY';

/**
 * Everything this job needs from the world.
 *
 * THE CLOCK IS AN ARGUMENT AND NOT A CALL, so a suite runs the job at a fixed
 * instant and a deployment passes `Date`. The engine reads no clock at all
 * (`M01` section 1.4) and this is the layer that is allowed to hold one, on the
 * condition that it only ever compares it with another instant.
 */
export interface WorkerJobIo {
  readonly db: WorkerDb;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly now: () => Date;
  /** Where the run report goes. `console` in a deployment. */
  readonly log: (line: string) => void;
}

/**
 * The job refused to start, naming the input it refused on.
 *
 * BEFORE THE WATERMARK AND BEFORE THE FOLD, which is deliberate and is the
 * second trap this row named. `runNightlyBatch` reads the calendar watermark
 * before anything else, so every refusal that can be made about the RUN is made
 * here, above it, and a job that cannot say which day it is closing never opens
 * a transaction at all.
 */
export class WorkerJobRefusal extends Error {
  /** The input that refused. */
  readonly input: string;

  constructor(input: string, why: string) {
    super(`the nightly batch cannot run: ${why}`);
    this.name = 'WorkerJobRefusal';
    this.input = input;
  }
}

/** `YYYY-MM-DD`, which is the shape `date` renders and `TradingDay` carries. */
const TRADING_DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Which day this run closes.
 *
 * **A FRESH DATABASE ANSWERS "NONE" AND THAT IS A REFUSAL, NOT A GUESS.** With
 * no `trading_calendar` rows no session has closed, so there is no day to fold
 * and the job stops here with a non-zero exit, having read nothing else and
 * written nothing at all. `ADR-241` section 5 states the whole first-run
 * behaviour; the part that belongs in code is that the refusal happens ABOVE the
 * watermark read.
 *
 * **AN UNCOVERED DAY IS THE SAME KIND OF ANSWER AND IT WAS THE ONE THIS FUNCTION
 * DID NOT HAVE.** `ADR-042` F-4 rules that a day outside `trading_calendar_loads`
 * is UNKNOWN rather than a holiday, and `ADR-277` is why both branches below now
 * refuse on one. The refusal is LOUD where a default is silent: a job that folds
 * an uncovered day exits 0 having written a confident `YYYY-MM-DD` basis into
 * every `rule_states` row for a night the estate never loaded, and `INV-04`'s
 * replay later compares those rows against a calendar that never covered them.
 *
 * **NEITHER BRANCH DECIDES ANYTHING ABOUT COVERAGE ITSELF.** Each asks the
 * adapter and narrows on `kind`. That split is `ADR-273` ruling 1's condition
 * met: the value handed back does not carry a day until the verdict has been
 * read.
 */
export async function resolveTradingDay(io: WorkerJobIo): Promise<TradingDay> {
  const override = io.env[TRADING_DAY_VAR];
  if (override !== undefined && override !== '') {
    if (!TRADING_DAY_SHAPE.test(override)) {
      throw new WorkerJobRefusal(
        TRADING_DAY_VAR,
        `${TRADING_DAY_VAR} is "${override}", which is not a YYYY-MM-DD trading day`,
      );
    }
    const named = await anchorNamedDay(io.db, override as TradingDay);
    if (named.kind !== 'anchored') {
      throw new WorkerJobRefusal(
        TRADING_DAY_VAR,
        `${TRADING_DAY_VAR} names ${override} and ${named.why}`,
      );
    }
    return named.tradingDay;
  }

  const anchor = await anchorLastClosedDay(io.db, io.now());
  if (anchor.kind !== 'anchored') {
    throw new WorkerJobRefusal(
      'tradingDay',
      `${anchor.why}. Set ${TRADING_DAY_VAR} to fold a specific day once the calendar and its ` +
        'coverage both reach it',
    );
  }
  return anchor.tradingDay;
}

/** The build identifier stamped on every row this run writes. */
export function resolveEngineVersion(io: WorkerJobIo): string {
  const version = io.env[ENGINE_VERSION_VAR];
  if (version === undefined || version === '') {
    throw new WorkerJobRefusal(
      ENGINE_VERSION_VAR,
      `${ENGINE_VERSION_VAR} is not set. It is stamped on every \`rule_states\` row and is what ` +
        "INV-04's replay comparison reads to tell one build's fold from another's. There is no " +
        'constant in this repository to fall back to and a fabricated one would make every row ' +
        'this deployment ever wrote unattributable',
    );
  }
  return version;
}

/**
 * Run the nightly batch once and return its report.
 *
 * **THE DEFAULT ARGUMENT IS WHY `src/start.ts` CAN BE THREE LINES.** A process
 * calls `main()` and gets this deployment's real door; a suite calls `main(io)`
 * and gets its own. The default is an EXPRESSION rather than a module-level
 * value, so importing this file still opens nothing: `LIVE_DB` is a literal
 * whose `batch` calls `systemDb` and `transaction` when it is invoked and not
 * when it is read.
 */
export async function main(io: WorkerJobIo = liveWorkerIo()): Promise<NightlyBatchReport> {
  const tradingDay = await resolveTradingDay(io);
  const engineVersion = resolveEngineVersion(io);

  const report = await runNightlyBatch(postgresBatchPorts(io.db), {
    tradingDay,
    engineVersion,
    concurrency: BATCH_CONCURRENCY,
  });

  // THE COMPLETION LINE, and it is printed only on the path that completed.
  // `CRON_INVENTORY` gives this job an S2 dead-man switch on `batch.completed`
  // being absent; the event table is not wired, so this line is what a log-based
  // switch has to read until it is. The counts are the report's own and are not
  // recomputed here.
  io.log(
    JSON.stringify({
      job: 'nightly-batch',
      outcome: 'completed',
      tradingDay: report.tradingDay,
      engineVersion: report.engineVersion,
      calendarRevisionId: report.calendarRevisionId,
      accountsConsidered: report.accountsConsidered,
      written: report.written,
      refused: report.refused,
      absent: report.absent,
    }),
  );

  return report;
}

/** This deployment's own io: the live door, the real environment, a real clock. */
export function liveWorkerIo(): WorkerJobIo {
  return {
    db: LIVE_DB,
    env: process.env,
    now: () => new Date(),
    log: (line) => {
      console.log(line);
    },
  };
}
