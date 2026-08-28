// =============================================================================
// apps/worker/src/digests/alarm.ts
// =============================================================================
// THE DEAD-MAN SWITCH FOR SCHEDULED DIGEST DELIVERY, AND IT ASSERTS THE QUERY
// AND NEVER THE JOB'S OWN REPORT.
//
// -----------------------------------------------------------------------------
// THE ONE RULE TO READ BEFORE ANY OTHER LINE
// -----------------------------------------------------------------------------
// `CRON_INVENTORY`, scheduled digest delivery: **"It asserts the query, not the
// job: an enabled `report_schedules` row whose window has closed with no
// `delivered` `report_deliveries` row is the finding, EVALUATED INDEPENDENTLY OF
// WHETHER ANY DELIVERY RUN REPORTED SUCCESS. A job that reports success is not
// evidence that the work happened (`M05` `INV-M5-18`, `GS-288`), and a report
// that stops arriving is how liability blindness starts."**
//
// **A JOB THAT CRASHED AFTER WRITING "SUCCESS" AND A JOB THAT NEVER RAN ARE THE
// SAME FACT TO THE PERSON WHO DID NOT GET THE DIGEST, AND THEY ARE THE SAME
// INPUT HERE, BECAUSE NEITHER IS AN INPUT AT ALL.** That is enforced in three
// places rather than asserted in one:
//
//   1. {@link DigestAlarmIo} carries a transaction and a clock and NOTHING a
//      producer could hand it. There is no run report, no attempt count and no
//      success flag on it, so the claim cannot be passed in.
//   2. **THIS FILE IMPORTS NOTHING FROM `produce.ts`.** A type checker cannot
//      see a coupling that is only a call, so `test/digests.test.ts` reads this
//      file's own source and refuses the import as text. `ports.ts` and
//      `rows.ts` are the only two modules named below.
//   3. `DigestAlarmIo.read` hands out a {@link DigestReadTx}, which HAS NO
//      `insert`. An alarm that could write is an alarm that could discharge the
//      window it is complaining about.
//
// -----------------------------------------------------------------------------
// THE THREE FINDINGS, AND THEY REST ON DIFFERENT EVIDENCE
// -----------------------------------------------------------------------------
// Absence is only detectable against an expectation (`0040` header item 1:
// "without a stored window, 'nothing arrived' and 'not due yet' are the same
// empty result"). There are two places an expectation can come from and this
// file uses both, because they fail differently:
//
//   `window_not_delivered`  A window that SOME attempt already claimed. One or
//                           more `report_deliveries` rows share a `due_at` that
//                           has passed, and none of them is `delivered`. Needs
//                           NO cadence arithmetic whatsoever: the expectation is
//                           the stored `due_at`. This is the run that tried and
//                           did not arrive, and the run that wrote `failed` and
//                           told nobody.
//
//   `window_overdue`        A full cadence period has passed since the newest
//                           window this schedule has ANY record of. This is the
//                           run that stopped running. It needs the period and
//                           not the anchor, which is the next section.
//
//   `no_window_recorded`    An enabled schedule with NO delivery row at all and
//                           a full period elapsed since `created_at`. **THIS IS
//                           THE ONE THAT FIRES ON THE ESTATE AS MERGED**, since
//                           `0040` leaves both tables with zero rows, and it is
//                           `GS-288` in its purest form: the window closed, the
//                           digest did not arrive, and no report exists to
//                           contradict or to confirm.
//
// A fourth outcome, `cadence_unanchored`, is the alarm SAYING IT CANNOT EVALUATE
// a schedule rather than returning green for it. See the next section.
//
// -----------------------------------------------------------------------------
// THE ANCHOR IS UNSTATED, SO THE CLOCK IS THE SCHEDULE'S OWN HISTORY
// -----------------------------------------------------------------------------
// `ports.ts` section 4. The CADENCE is a schema fact (`0040`'s generated
// column); WHICH weekday, at WHICH hour, in WHICH zone a window closes is stated
// in no approved document, and `DIGEST_WINDOW_ANCHOR` ships every term
// `unstated` with its citation rather than inventing one.
//
// **SO THIS FILE MEASURES ELAPSED TIME FROM A STORED INSTANT AND NEVER
// CONSTRUCTS A CALENDAR.** It cannot say "the Monday 09:00 window closed and
// nothing arrived"; it says "a full cadence period has passed since the newest
// window this schedule has any record of", which is the SAME FACT reported up to
// one period late in the worst case. **THE ALTERNATIVE WAS TO INVENT A WEEKDAY**,
// and an alarm firing against a window nobody agreed to is `GS-287`'s failure
// one runbook row over with the sign flipped: a wrong window manufactures
// evidence, and here the evidence would be against the operator who did deliver.
//
// **A MONTHLY SCHEDULE IS REPORTED AS `cadence_unanchored` AND IS NOT PASSED
// OVER.** A month is not a fixed number of milliseconds and no day-of-month
// anchor is stated, so `CADENCE_PERIOD_MS.monthly` is `null`. The half of the
// evaluation that needs a period cannot run; the half that does not
// (`window_not_delivered`) still runs, and the gap is a finding an operator
// reads rather than a green result nobody questions. **A 30-DAY CONSTANT WOULD
// HAVE BEEN A NUMBER THIS SLICE INVENTED**, which is the one thing the fence
// forbids outright.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE DOES NOT DO
// -----------------------------------------------------------------------------
//   - It writes nothing. Not a row, not an event, not a suppression.
//   - It reads no digest CONTENT and no trader-bearing table. `INV-M6-10` is not
//     reachable from here because `DIGEST_READ_TABLES` has two members and
//     neither is about a person.
//   - It emits no alert. `admin.report_windows_undelivered` and
//     `admin.report_deliveries_failed` are `M06` section 3.6's two metrics and
//     this run RETURNS them; the sink is `P5-n`'s and `events` is `P5-b`'s, so
//     inventing one here would be a producer for a table that is registered in
//     neither `schema.ts` nor `scope.ts`.
// =============================================================================

import { CADENCE_BY_DIGEST, CADENCE_PERIOD_MS, DIGESTS } from './ports.ts';
import { DigestRowError, readBoolean, readInstant, readText, record } from './rows.ts';
import type { Cadence, Digest, DigestAlarmIo, DigestReadTx, DigestRow } from './ports.ts';

// -----------------------------------------------------------------------------
// The findings
// -----------------------------------------------------------------------------

/**
 * What the alarm found. FOUR KINDS, and the fourth is the alarm declining.
 *
 * See this file's header for what each rests on. They are separate kinds rather
 * than one `undelivered` because the repair is different for each: a
 * `window_not_delivered` names a run that tried, a `window_overdue` names a job
 * that stopped, a `no_window_recorded` names a schedule nothing has ever served,
 * and a `cadence_unanchored` names a question this alarm cannot ask.
 */
export const DIGEST_ALARM_KINDS = [
  'window_not_delivered',
  'window_overdue',
  'no_window_recorded',
  'cadence_unanchored',
] as const;

/** One of {@link DIGEST_ALARM_KINDS}. */
export type DigestAlarmKind = (typeof DIGEST_ALARM_KINDS)[number];

/** One schedule's finding. */
export interface DigestAlarmFinding {
  readonly kind: DigestAlarmKind;
  readonly scheduleId: string;
  readonly digest: Digest;
  readonly cadence: Cadence;
  readonly channel: string;
  /** The window this finding is about, when the finding is about one window. */
  readonly dueAt: Date | null;
  /** The stored instant the elapsed time was measured from. */
  readonly since: Date | null;
  /** Milliseconds from {@link since} to the evaluation instant, or `null`. */
  readonly elapsedMs: number | null;
  /** What a reader needs in order to act, without opening this file. */
  readonly detail: string;
}

/**
 * One evaluation.
 *
 * **`undeliveredWindows` IS `M06` SECTION 3.6's METRIC AND IT IS COMPUTED FROM
 * THE TABLE**: "`admin.report_windows_undelivered`, which is zero, always, and
 * is computed from the table rather than from the job's report."
 *
 * `deliveriesFailed` is that section's other metric,
 * `admin.report_deliveries_failed`, counted over the same read.
 */
export interface DigestAlarmReport {
  readonly evaluatedAt: Date;
  readonly schedulesEvaluated: number;
  readonly findings: readonly DigestAlarmFinding[];
  readonly undeliveredWindows: number;
  readonly deliveriesFailed: number;
}

// -----------------------------------------------------------------------------
// The schedule, as the alarm needs to see it
// -----------------------------------------------------------------------------

/** One enabled `report_schedules` row. */
export interface AlarmSchedule {
  readonly id: string;
  readonly digest: Digest;
  readonly cadence: Cadence;
  readonly channel: string;
  readonly createdAt: Date;
}

function isDigest(value: string): value is Digest {
  return (DIGESTS as readonly string[]).includes(value);
}

/**
 * Read one schedule, taking the cadence from the DIGEST and not from the row.
 *
 * **THE CADENCE IS DERIVED AND THE ROW'S COPY IS ONLY CHECKED**, which is
 * `0040`'s own reason for generating that column: "the cadence is a PROPERTY OF
 * THE DIGEST rather than a choice, so as an ordinary column a daily liability
 * digest could be scheduled monthly by one careless insert and nothing would
 * object." A reader that took the value off the row would hand that back to the
 * careless insert through the alarm instead of through the column.
 *
 * When the row carries a `cadence` at all, a disagreement with
 * {@link CADENCE_BY_DIGEST} is REFUSED rather than resolved. In PostgreSQL the
 * two cannot disagree; anything that reaches this branch is a fake or a driver
 * that has widened the shape, and either is a reason to stop.
 */
export function readAlarmSchedule(value: unknown, where: string): AlarmSchedule {
  const row: DigestRow = record(value, where);
  const digest = readText(row, 'digest', where);
  if (!isDigest(digest))
    throw new DigestRowError(
      `${where}.digest is ${JSON.stringify(digest)}, which 0040's CHECK does not admit. The digest ` +
        'vocabulary is closed at four and a fifth needs a migration, which needs a ruling',
    );
  const cadence = CADENCE_BY_DIGEST[digest];
  const stored = row['cadence'];
  if (typeof stored === 'string' && stored !== cadence)
    throw new DigestRowError(
      `${where}.cadence is ${JSON.stringify(stored)} while ${digest} generates ${cadence}. 0040 ` +
        'makes that column GENERATED ALWAYS precisely so the two facts cannot disagree, so a row ' +
        'where they do is not a row this alarm can reason about',
    );
  return {
    id: readText(row, 'id', where),
    digest,
    cadence,
    channel: readText(row, 'channel', where),
    createdAt: readInstant(row, 'createdAt', where),
  };
}

// -----------------------------------------------------------------------------
// The delivery history, folded per window
// -----------------------------------------------------------------------------

/** Every attempt that shares one `due_at`, folded. */
export interface WindowFold {
  readonly dueAt: Date;
  readonly attempts: number;
  readonly delivered: boolean;
  readonly failed: number;
}

/**
 * Fold one schedule's delivery rows into one entry per window.
 *
 * `ADR-157` clause 6 REFUSED the scalar aggregate, so the grouping is here and
 * not in the accessor, and `ports.ts` section 3 records that nothing in this
 * slice asks for one. The fold is over ONE SCHEDULE'S history, which
 * `report_deliveries_delivered_window_idx` exists to serve.
 *
 * **A ROW WHOSE `outcome` IS NEITHER VALUE IS REFUSED AND NOT IGNORED.** `0040`
 * admits exactly `delivered` and `failed` and deliberately has no `skipped`; a
 * third value reaching this fold would be counted as "not delivered" by
 * accident, which is the right answer for the wrong reason and would go on being
 * the right answer until the day somebody added a value meaning "delivered".
 */
export function foldWindows(rows: readonly unknown[], where: string): readonly WindowFold[] {
  const byWindow = new Map<
    number,
    { dueAt: Date; attempts: number; delivered: boolean; failed: number }
  >();
  for (const [index, value] of rows.entries()) {
    const at = `${where}[${String(index)}]`;
    const row = record(value, at);
    const dueAt = readInstant(row, 'dueAt', at);
    const outcome = readText(row, 'outcome', at);
    if (outcome !== 'delivered' && outcome !== 'failed')
      throw new DigestRowError(
        `${at}.outcome is ${JSON.stringify(outcome)}. 0040 admits \`delivered\` and \`failed\` and ` +
          'nothing else, and deliberately has no `skipped`: a skip that can be recorded as an ' +
          'outcome is a skip that reads as normal in a list of outcomes',
      );
    const key = dueAt.getTime();
    const existing = byWindow.get(key) ?? { dueAt, attempts: 0, delivered: false, failed: 0 };
    byWindow.set(key, {
      dueAt,
      attempts: existing.attempts + 1,
      delivered: existing.delivered || outcome === 'delivered',
      failed: existing.failed + (outcome === 'failed' ? 1 : 0),
    });
  }
  return [...byWindow.values()].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}

// -----------------------------------------------------------------------------
// One schedule's evaluation
// -----------------------------------------------------------------------------

/**
 * Evaluate one enabled schedule against its own delivery history.
 *
 * **IT IS HANDED THE HISTORY AND THE CLOCK AND NOTHING ELSE.** There is no
 * parameter here through which a run's own account of itself could arrive, which
 * is this file's header rule expressed at the one function that decides.
 */
export function evaluateSchedule(
  schedule: AlarmSchedule,
  windows: readonly WindowFold[],
  now: Date,
): readonly DigestAlarmFinding[] {
  const findings: DigestAlarmFinding[] = [];
  const base = {
    scheduleId: schedule.id,
    digest: schedule.digest,
    cadence: schedule.cadence,
    channel: schedule.channel,
  };

  // 1. A window somebody already claimed, closed, with nothing delivered in it.
  //    No cadence arithmetic: the expectation is the stored `due_at`.
  for (const window of windows) {
    if (window.dueAt.getTime() > now.getTime()) continue;
    if (window.delivered) continue;
    findings.push({
      ...base,
      kind: 'window_not_delivered',
      dueAt: window.dueAt,
      since: window.dueAt,
      elapsedMs: now.getTime() - window.dueAt.getTime(),
      detail:
        `${schedule.digest} has ${String(window.attempts)} attempt(s) for the window due at ` +
        `${window.dueAt.toISOString()} and none of them is \`delivered\`. The window has closed. ` +
        'This finding is read from `report_deliveries` and is independent of what any run reported.',
    });
  }

  const period = CADENCE_PERIOD_MS[schedule.cadence];

  // 2. The alarm declining, which is a finding and not a pass.
  if (period === null) {
    findings.push({
      ...base,
      kind: 'cadence_unanchored',
      dueAt: null,
      since: null,
      elapsedMs: null,
      detail:
        `${schedule.digest} is ${schedule.cadence} and a ${schedule.cadence} window has no fixed ` +
        'length and no stated day anchor in the corpus, so this alarm cannot tell whether a window ' +
        'has closed with nothing recorded. It says so rather than returning green. The windows ' +
        'that carry attempts are still evaluated above.',
    });
    return findings;
  }

  // 3. Nothing has ever been recorded for this schedule.
  if (windows.length === 0) {
    const elapsed = now.getTime() - schedule.createdAt.getTime();
    if (elapsed >= period)
      findings.push({
        ...base,
        kind: 'no_window_recorded',
        dueAt: null,
        since: schedule.createdAt,
        elapsedMs: elapsed,
        detail:
          `${schedule.digest} has been enabled since ${schedule.createdAt.toISOString()}, at least ` +
          `one ${schedule.cadence} window has closed since, and \`report_deliveries\` holds no row ` +
          'for it at all. Nothing arrived and no run left evidence either way.',
      });
    return findings;
  }

  // 4. The newest window on record is a whole period or more behind.
  const newest = windows[windows.length - 1];
  if (newest === undefined) return findings;
  const elapsed = now.getTime() - newest.dueAt.getTime();
  if (elapsed >= period)
    findings.push({
      ...base,
      kind: 'window_overdue',
      dueAt: null,
      since: newest.dueAt,
      elapsedMs: elapsed,
      detail:
        `${schedule.digest} has no record of any window after ${newest.dueAt.toISOString()}, and ` +
        `at least one further ${schedule.cadence} window has closed since. The anchor is this ` +
        "schedule's own history because no document states one, so this fires up to one period " +
        'late and never against a window nobody agreed to.',
    });

  return findings;
}

// -----------------------------------------------------------------------------
// The run
// -----------------------------------------------------------------------------

/**
 * What the alarm may be told to bound its history read by.
 *
 * **`null` MEANS THE WHOLE HISTORY AND IT IS THE DEFAULT**, because a horizon is
 * a number and no document states one. A deployment that wants the read bounded
 * supplies the instant itself and owns that choice; this file does not pick one
 * and then present it as the corpus's.
 *
 * When supplied it becomes `ADR-157` clause 1's `atLeast` term on `due_at`,
 * INCLUSIVE, which is the only term this slice uses.
 */
export interface DigestAlarmOptions {
  readonly historySince?: Date | null;
}

/**
 * Find every enabled schedule whose window closed with no `delivered` row.
 *
 * ONE READ-ONLY UNIT OF WORK. It writes nothing, it emits nothing, and it cannot
 * be handed a run's own report, which is this file's header rule.
 */
export async function findUndeliveredWindows(
  io: DigestAlarmIo,
  options: DigestAlarmOptions = {},
): Promise<DigestAlarmReport> {
  const now = io.now();
  const historySince = options.historySince ?? null;

  return io.read(async (tx: DigestReadTx) => {
    const findings: DigestAlarmFinding[] = [];
    let schedulesEvaluated = 0;
    let deliveriesFailed = 0;

    const rows = await tx.rowsWhere('reportSchedules', { enabled: true });
    for (const [index, value] of rows.entries()) {
      const where = `reportSchedules[${String(index)}]`;
      // `enabled: true` is the filter AND the row is re-read, because a filter
      // is a promise about a read and this is the predicate the whole alarm's
      // subject set rests on. A disabled schedule alarming forever is how an
      // operator learns to ignore this page.
      if (!readBoolean(record(value, where), 'enabled', where)) continue;
      const schedule = readAlarmSchedule(value, where);
      schedulesEvaluated += 1;

      const filter: Record<string, unknown> = { scheduleId: schedule.id };
      if (historySince !== null) filter['dueAt'] = io.terms.atLeast(historySince);
      const windows = foldWindows(
        await tx.rowsWhere('reportDeliveries', filter),
        `reportDeliveries(${schedule.id})`,
      );
      for (const window of windows) deliveriesFailed += window.failed;

      findings.push(...evaluateSchedule(schedule, windows, now));
    }

    return {
      evaluatedAt: now,
      schedulesEvaluated,
      findings,
      undeliveredWindows: findings.filter(
        (finding) =>
          finding.kind === 'window_not_delivered' ||
          finding.kind === 'window_overdue' ||
          finding.kind === 'no_window_recorded',
      ).length,
      deliveriesFailed,
    };
  });
}
