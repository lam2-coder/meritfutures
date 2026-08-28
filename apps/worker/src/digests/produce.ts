// =============================================================================
// apps/worker/src/digests/produce.ts
// =============================================================================
// `SD-M6-07`'s TWO PRODUCERS. `report_schedules` and `report_deliveries` landed
// in `0040` with ZERO ROWS on merge, deliberately, "so nothing below can be read
// as evidence that any digest has ever been delivered". These are the runs that
// write the first ones.
//
// -----------------------------------------------------------------------------
// THE ONE THING TO READ BEFORE ANY OTHER LINE
// -----------------------------------------------------------------------------
// **NOTHING THIS FILE RETURNS IS EVIDENCE OF ANYTHING.** `alarm.ts` reads
// `report_deliveries` and cannot be handed a value produced here, which is
// `ports.ts` section 1 and `CRON_INVENTORY`'s rule. {@link DigestRunReport}
// exists so an operator running this by hand sees what happened; it is a log
// line and never a control, and the moment it is treated as one, `GS-288` is
// live again.
//
// -----------------------------------------------------------------------------
// THE LADDER, AND ITS ORDER IS THE CONTROL
// -----------------------------------------------------------------------------
// `0040`'s `report_deliveries` carries eleven `CHECK` constraints and this file
// enforces every one of them in TypeScript BEFORE the row reaches the database.
// That is not belt and braces: the row is built in one function, the refusals
// name the constraint they mirror, and a fixture exercises each without needing
// PostgreSQL, which is what makes the near-miss testable.
//
// **THE ONE THAT MATTERS MOST IS `GS-290` AND IT IS ENFORCED TWICE.** `M06`
// section 3.6: "Full degradation to zero recipients is not a degraded success;
// it is a failure that has learned to look like one."
//
//   1. {@link decideOutcome} DOWNGRADES a send that reached nobody to `failed`,
//      whatever the transport claimed, so the row is never built wrong.
//   2. {@link deliveryValues} REFUSES to build a `delivered` row with an empty
//      `recipients_attempted` at all, so a future call site that skipped step 1
//      throws instead of writing.
//
// -----------------------------------------------------------------------------
// A DIGEST WITH NO PRODUCER GETS NO ROW, WHICH IS THE DESIGN AND NOT A GAP
// -----------------------------------------------------------------------------
// This slice produces `weekly_loss_ratio_cusum` and `weekly_flag_queue`. An
// enabled `daily_liability` or `monthly_revenue_cohort` schedule is SKIPPED and
// **NO `report_deliveries` ROW IS WRITTEN FOR IT**, because `0040` has no
// `skipped` outcome and says why: "A run that decides not to send writes
// `failed` with its reason, OR IT WRITES NOTHING AND THE MISSING ROW IS ITSELF
// THE FINDING. Both roads reach a human."
//
// Writing `failed` for a digest nobody has built yet would put a delivery
// failure in the log for a delivery that was never attempted, and the alarm one
// module over already reports the absence with the right name. **The skip is
// counted in the run report so the operator sees it, and the CONTROL is still
// the alarm.**
//
// -----------------------------------------------------------------------------
// `INV-M6-10`, AND WHAT THE FLAG-QUEUE DIGEST MAY CARRY
// -----------------------------------------------------------------------------
// `M06:54` permits trader-identifying data only when the query names a specific
// subject, and `ADR-066` section 3 says no digest is a bulk identity export.
// `ports.ts` declares bodies with no field that can hold a trader; this file
// renders them, and a renderer is where a type stops helping. So
// `test/digests.test.ts` sweeps the RENDERED ARTIFACT for uuid-shaped and
// mailbox-shaped text and refuses either.
//
// **THE ARTIFACT IS NEVER STORED, ONLY ITS SHA-256** (`0040` header item 4,
// `INV-M6-10`). A table holding every rendered digest body would BE the bulk
// export, sitting behind an admin route, created by the feature admitted on the
// promise that it was not one.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE DOES NOT DO
// -----------------------------------------------------------------------------
//   - It renders no PDF and ships no CSV wearing a PDF's name. A `pdf` schedule
//     writes `failed` with its reason (`RENDERED_FORMAT`).
//   - It writes no `report_schedules` row. `DIGEST_WRITE_TABLES` has one member
//     and that is `ports.ts` section 2.
//   - It chooses no window. `due_at` is the CALLER'S, because the anchor is
//     unstated and whatever schedules this job is what knows when it fired.
//   - It emits no event. `events` is `P5-b`'s and the sink is `P5-n`'s.
// =============================================================================

import { createHash } from 'node:crypto';

import {
  CADENCE_BY_DIGEST,
  CHANNELS,
  DIGESTS,
  FORMATS,
  PRODUCED_DIGESTS,
  RENDERED_FORMAT,
} from './ports.ts';
import { DigestRowError, readInteger, readText, readTextArray, record } from './rows.ts';
import type {
  Channel,
  Digest,
  DigestBody,
  DigestIo,
  DigestSendResult,
  DigestTx,
  DigestValues,
  FlagQueueDigestBody,
  Format,
  LossRatioDigestBody,
  LossRatioDigestLine,
  ProducedDigest,
} from './ports.ts';
import type { BreakerEvaluationReport } from '../breaker/evaluate.ts';

// -----------------------------------------------------------------------------
// The loss-ratio body, folded from `P7-k`'s own report
// -----------------------------------------------------------------------------

/**
 * `weekly_loss_ratio_cusum`'s body, from the breaker evaluation that produced it.
 *
 * **THIS IS THE `P7-k` DEPENDENCY MADE REAL RATHER THAN NAMED.** `P7` section 8
 * gives this slice "`P7-k` for the loss-ratio digest's content", and the content
 * is `BreakerDecision` field for field: `M06` section 3.6 builds this digest
 * from "`P-M6-05` with its sample size beside it (`INV-M6-07`) and `P-M6-06`".
 *
 * **`sampleSize` TRAVELS WITH EVERY RATIO AND THAT IS `AS-M6-02`.** "An alert
 * that omits it invites exactly the override that destroys the control", and a
 * digest is where an operator forms the impression an override is later argued
 * from. `LossRatioDigestLine.sampleSize` is a required `number`, so a line
 * without one does not compile.
 *
 * **`ratioBp` STAYS `null` WHERE THE BREAKER HAD NO RATIO.** `evaluate.ts`
 * returns `null` for a zero denominator on the stated ground that "a ratio over
 * no fees is undefined, not favourable, and returning 0 would read on the
 * dashboard as the healthiest plan Merit sells". A digest is a dashboard that
 * arrives by email, so the absence travels rather than being flattened to the
 * `0` the `NOT NULL` column had to hold.
 *
 * **THE CUSUM IS ABSENT AND CARRIES ITS BLOCKER.** `ADR-167` clause 5 and
 * `FM-M6-07`: an uncalibrated CUSUM is "either constant alarms or none, which is
 * the same as no chart". Rendering one weekly by email would be that failure
 * with a distribution list attached.
 */
export function lossRatioBodyFrom(
  report: BreakerEvaluationReport,
  coversThroughTradingDay: string,
  cusumBlockedOn: string | null,
): LossRatioDigestBody {
  const plans: LossRatioDigestLine[] = report.decisions.map((decision) => ({
    planCode: decision.planCode,
    metric: decision.metric,
    state: decision.state,
    ratioBp: decision.ratioBp,
    thresholdBp: decision.thresholdBp,
    sampleSize: decision.fold.sampleSize,
    minSample: decision.minSample,
    salesPaused: decision.salesPaused,
  }));
  return {
    digest: 'weekly_loss_ratio_cusum',
    coversThroughTradingDay,
    plans,
    cusumBlockedOn,
  };
}

// -----------------------------------------------------------------------------
// The artifact
// -----------------------------------------------------------------------------

/**
 * One CSV field, quoted so that no value can end the row it sits in.
 *
 * A digest body carries a plan code and a state and a free-text blocker, and a
 * comma or a newline inside any of them would move every column after it. The
 * artifact is what the SHA-256 is taken over and what an operator reads, so a
 * shifted column is a wrong number delivered under a right heading.
 */
function csvField(value: string | number | boolean | null): string {
  if (value === null) return '';
  return `"${String(value).replaceAll('"', '""')}"`;
}

function csvRow(fields: readonly (string | number | boolean | null)[]): string {
  return fields.map(csvField).join(',');
}

/**
 * Render a body as the CSV artifact that is sent and hashed.
 *
 * **THE HEADER NAMES THE AS-OF DAY ON EVERY ARTIFACT**, which is `INV-M6-04`:
 * "every number names its as-of moment and its source, and a digest that leaves
 * the console loses the page that would have said so".
 *
 * **NOTHING TRADER-IDENTIFYING IS REACHABLE FROM HERE.** The bodies carry no
 * such field (`ports.ts`), and the suite sweeps this function's output anyway,
 * because a type says nothing about what a producer put in a string.
 */
export function renderDigest(body: DigestBody): Uint8Array {
  const lines: string[] = [];
  if (body.digest === 'weekly_loss_ratio_cusum') {
    lines.push(csvRow(['merit_digest', body.digest]));
    lines.push(csvRow(['covers_through_trading_day', body.coversThroughTradingDay]));
    lines.push(
      csvRow([
        'cusum',
        body.cusumBlockedOn === null
          ? 'reported'
          : `absent: blocked on ${body.cusumBlockedOn} (ADR-167 clause 5, FM-M6-07)`,
      ]),
    );
    lines.push('');
    lines.push(
      csvRow([
        'plan_code',
        'metric',
        'state',
        'ratio_bp',
        'threshold_bp',
        'sample_size',
        'min_sample',
        'sales_paused',
      ]),
    );
    for (const plan of body.plans)
      lines.push(
        csvRow([
          plan.planCode,
          plan.metric,
          plan.state,
          plan.ratioBp,
          plan.thresholdBp,
          plan.sampleSize,
          plan.minSample,
          plan.salesPaused,
        ]),
      );
  } else {
    lines.push(csvRow(['merit_digest', body.digest]));
    lines.push(csvRow(['covers_through_trading_day', body.coversThroughTradingDay]));
    lines.push(csvRow(['total_open', body.totalOpen]));
    lines.push(csvRow(['queue', body.queueLink]));
    lines.push('');
    lines.push(csvRow(['severity', 'open', 'oldest_first_detected_on', 'queue_link']));
    for (const band of body.bands)
      lines.push(csvRow([band.severity, band.open, band.oldestFirstDetectedOn, band.queueLink]));
  }
  return new Uint8Array(Buffer.from(`${lines.join('\n')}\n`, 'utf8'));
}

/**
 * The artifact's SHA-256, and the artifact itself is never stored.
 *
 * `0040` header item 4 and `INV-M6-10`. "The SHA-256 answers 'was what arrived
 * what we generated' and answers nothing about any trader."
 * `report_deliveries_digest_is_sha256` requires exactly 32 bytes, which this
 * returns by construction.
 */
export function artifactDigest(artifact: Uint8Array): Buffer {
  return createHash('sha256').update(artifact).digest();
}

// -----------------------------------------------------------------------------
// The row, and every `CHECK` in `0040` is enforced before it is written
// -----------------------------------------------------------------------------

/** Everything one delivery attempt records. */
export interface DeliveryAttempt {
  readonly scheduleId: string;
  readonly dueAt: Date;
  readonly attempt: number;
  readonly coversThroughTradingDay: string;
  readonly channel: string;
  readonly format: string;
  readonly attempted: readonly string[];
  readonly omitted: readonly string[];
  readonly omissionReason: string | null;
  readonly outcome: 'delivered' | 'failed';
  readonly failureReason: string | null;
  readonly attemptedAt: Date;
  readonly deliveredAt: Date | null;
  readonly artifactDigest: Buffer | null;
}

function stated(value: string | null): boolean {
  return value !== null && value.trim().length > 0;
}

/**
 * Build the `report_deliveries` row, refusing every shape `0040` refuses.
 *
 * ELEVEN CONSTRAINTS, EACH MIRRORED BY NAME, so a refusal here reads the same as
 * the refusal the database would have given and a fixture can exercise it
 * without PostgreSQL.
 *
 * **`report_deliveries_delivered_reached_somebody` IS THE ONE THAT MATTERS
 * MOST** (`GS-290`, `M06` section 3.6), and it is the second of this file's two
 * enforcements of it: {@link decideOutcome} has already downgraded a send that
 * reached nobody, and this refuses to build the row even if a future call site
 * skips that step.
 */
export function deliveryValues(attempt: DeliveryAttempt): DigestValues {
  const where = `report_deliveries(${attempt.scheduleId}, ${attempt.dueAt.toISOString()})`;

  if (!Number.isSafeInteger(attempt.attempt) || attempt.attempt < 1)
    throw new DigestRowError(
      `${where}: attempt is ${String(attempt.attempt)} and ` +
        'report_deliveries_attempt_is_ordinal requires attempt >= 1. A retry is a NEW ROW at the ' +
        'next ordinal, because the failure that was retried is the evidence',
    );

  for (const [name, list] of [
    ['recipients_attempted', attempt.attempted],
    ['recipients_omitted', attempt.omitted],
  ] as const) {
    if (new Set(list).size !== list.length || list.some((one) => one.trim().length === 0))
      throw new DigestRowError(
        `${where}: ${name} has a blank or a duplicate element, which ` +
          'report_recipients_are_wellformed refuses',
      );
  }

  const overlap = attempt.attempted.filter((one) => attempt.omitted.includes(one));
  if (overlap.length > 0)
    throw new DigestRowError(
      `${where}: ${JSON.stringify(overlap)} is both attempted and omitted, which ` +
        'report_deliveries_recipient_sets_disjoint refuses. A name cannot be both reached and ' +
        'left out in one attempt',
    );

  if (attempt.omitted.length > 0 !== stated(attempt.omissionReason))
    throw new DigestRowError(
      `${where}: report_deliveries_omission_states_its_reason is an EQUIVALENCE. GS-290 degrades ` +
        'to the remaining recipients AND RECORDS THE REMOVAL, so an attempt that omitted somebody ' +
        'may not stay silent about it and one that omitted nobody may not claim a removal it did ' +
        'not make',
    );

  const delivered = attempt.outcome === 'delivered';

  if (delivered && attempt.attempted.length === 0)
    throw new DigestRowError(
      `${where}: report_deliveries_delivered_reached_somebody. A delivery that reached NOBODY ` +
        'cannot be written as `delivered`. Full degradation to zero recipients is not a degraded ' +
        'success, it is a failure that has learned to look like one (GS-290, M06 section 3.6)',
    );

  if (delivered !== (attempt.deliveredAt !== null))
    throw new DigestRowError(
      `${where}: report_deliveries_delivered_has_timestamp is an equivalence and this row breaks it`,
    );

  if (delivered !== (attempt.artifactDigest !== null))
    throw new DigestRowError(
      `${where}: report_deliveries_delivered_has_digest is an equivalence and this row breaks it`,
    );

  if (attempt.artifactDigest !== null && attempt.artifactDigest.length !== 32)
    throw new DigestRowError(
      `${where}: artifact_digest is ${String(attempt.artifactDigest.length)} bytes and ` +
        'report_deliveries_digest_is_sha256 requires 32. A hash is a SHA-256 digest or it is not ' +
        'a hash',
    );

  if (!delivered !== stated(attempt.failureReason))
    throw new DigestRowError(
      `${where}: report_deliveries_failure_states_its_reason. A failed delivery with no stated ` +
        'reason records that something went wrong and NOT what, which is the alarm arriving ' +
        'without its evidence',
    );

  if (attempt.deliveredAt !== null && attempt.deliveredAt.getTime() < attempt.attemptedAt.getTime())
    throw new DigestRowError(
      `${where}: report_deliveries_delivery_follows_attempt refuses a delivery before its attempt`,
    );

  return {
    scheduleId: attempt.scheduleId,
    dueAt: attempt.dueAt,
    attempt: attempt.attempt,
    coversThroughTradingDay: attempt.coversThroughTradingDay,
    channel: attempt.channel,
    format: attempt.format,
    recipientsAttempted: [...attempt.attempted],
    recipientsOmitted: [...attempt.omitted],
    omissionReason: attempt.omissionReason,
    outcome: attempt.outcome,
    failureReason: attempt.failureReason,
    attemptedAt: attempt.attemptedAt,
    deliveredAt: attempt.deliveredAt,
    artifactDigest: attempt.artifactDigest,
  };
}

/** What a send result means, once `GS-290` has been applied to it. */
export interface OutcomeDecision {
  readonly outcome: 'delivered' | 'failed';
  readonly failureReason: string | null;
  readonly deliveredAt: Date | null;
}

/**
 * Decide the outcome, DOWNGRADING a send that reached nobody.
 *
 * **A TRANSPORT'S OWN ACCOUNT OF ITSELF IS NOT AUTHORITATIVE HERE EITHER**,
 * which is `CRON_INVENTORY`'s rule applied one level down: a transport that
 * reports a delivery timestamp while naming no recipient it reached has
 * described a failure, and taking its word for it would write the exact row
 * `report_deliveries_delivered_reached_somebody` exists to refuse.
 */
export function decideOutcome(result: DigestSendResult): OutcomeDecision {
  if (result.attempted.length === 0)
    return {
      outcome: 'failed',
      failureReason: stated(result.failureReason)
        ? result.failureReason
        : 'the transport reached no recipient at all. GS-290: full degradation to zero recipients ' +
          'is not a degraded success, it is a failure that has learned to look like one',
      deliveredAt: null,
    };
  if (result.deliveredAt === null)
    return {
      outcome: 'failed',
      failureReason: stated(result.failureReason)
        ? result.failureReason
        : 'the transport reported no delivery time and no reason. A failed delivery with no ' +
          'stated reason is the alarm arriving without its evidence',
      deliveredAt: null,
    };
  return { outcome: 'delivered', failureReason: null, deliveredAt: result.deliveredAt };
}

// -----------------------------------------------------------------------------
// One schedule, one window
// -----------------------------------------------------------------------------

/** One enabled `report_schedules` row, as the producer needs to see it. */
export interface ProducerSchedule {
  readonly id: string;
  readonly digest: Digest;
  readonly format: Format;
  readonly channel: Channel;
  readonly recipients: readonly string[];
}

/** Read one schedule for the producer, refusing what `0040` refuses. */
export function readProducerSchedule(value: unknown, where: string): ProducerSchedule {
  const row = record(value, where);
  const digest = readText(row, 'digest', where);
  if (!(DIGESTS as readonly string[]).includes(digest))
    throw new DigestRowError(
      `${where}.digest is ${JSON.stringify(digest)}, which 0040's CHECK does not admit`,
    );
  const recipients = readTextArray(row, 'recipients', where);
  if (recipients.length === 0)
    throw new DigestRowError(
      `${where}.recipients is empty and report_schedules_has_recipients requires at least one. A ` +
        'schedule with no recipients is a control that delivers nothing while reading, in a list ' +
        'of schedules, exactly like one that does',
    );
  const format = readText(row, 'format', where);
  if (!(FORMATS as readonly string[]).includes(format))
    throw new DigestRowError(
      `${where}.format is ${JSON.stringify(format)}, which 0040's CHECK does not admit`,
    );
  const channel = readText(row, 'channel', where);
  if (!(CHANNELS as readonly string[]).includes(channel))
    throw new DigestRowError(
      `${where}.channel is ${JSON.stringify(channel)}, which 0040's CHECK does not admit`,
    );
  return {
    id: readText(row, 'id', where),
    digest: digest as Digest,
    format: format as Format,
    channel: channel as Channel,
    recipients,
  };
}

function isProduced(digest: Digest): digest is ProducedDigest {
  return (PRODUCED_DIGESTS as readonly string[]).includes(digest);
}

/**
 * The next attempt ordinal for a window, DERIVED from the rows already there.
 *
 * NOT A COUNTER THIS RUN KEEPS. `report_deliveries_window_attempt_uq` refuses a
 * second write at the same ordinal, so a run that guessed would be refused at
 * the database on its first retry, and a run that read the table says out loud
 * that it is retrying, which is what that index is for.
 */
export function nextAttempt(rows: readonly unknown[], where: string): number {
  let highest = 0;
  for (const [index, value] of rows.entries()) {
    const at = `${where}[${String(index)}]`;
    const attempt = readInteger(record(value, at), 'attempt', at);
    if (attempt > highest) highest = attempt;
  }
  return highest + 1;
}

// -----------------------------------------------------------------------------
// The run
// -----------------------------------------------------------------------------

/** What one schedule's turn produced. */
export interface DigestScheduleResult {
  readonly scheduleId: string;
  readonly digest: Digest;
  readonly attempt: number | null;
  readonly outcome: 'delivered' | 'failed' | 'no_producer';
  readonly reason: string | null;
}

/**
 * What one run of the producer did.
 *
 * **THIS IS A LOG LINE AND NOT A CONTROL.** See this file's header: `alarm.ts`
 * cannot be handed this value and does not want it. A reader who treats
 * `delivered` here as evidence that a digest arrived has reconstructed `GS-288`
 * by hand.
 */
export interface DigestRunReport {
  readonly dueAt: Date;
  readonly coversThroughTradingDay: string;
  readonly results: readonly DigestScheduleResult[];
  readonly delivered: number;
  readonly failed: number;
  readonly withoutProducer: number;
  /** Say it in the value, so a log that is read out of context still says it. */
  readonly evidenceIsTheDeliveryTable: true;
}

/** What a run is asked to discharge. */
export interface DigestRunRequest {
  /**
   * The window this run discharges.
   *
   * **THE CALLER'S, BECAUSE THE ANCHOR IS UNSTATED** (`ports.ts` section 4). No
   * approved document names the weekday, the hour or the zone a window closes
   * on, so whatever schedules this job is what knows when it fired, and this run
   * records what it was told rather than deriving a calendar nobody wrote down.
   */
  readonly dueAt: Date;
}

async function deliverOne(
  io: DigestIo,
  tx: DigestTx,
  schedule: ProducerSchedule,
  digest: ProducedDigest,
  request: DigestRunRequest,
  coversThroughTradingDay: string,
): Promise<DigestScheduleResult> {
  const attempt = nextAttempt(
    await tx.rowsWhere('reportDeliveries', {
      scheduleId: schedule.id,
      dueAt: request.dueAt,
    }),
    `reportDeliveries(${schedule.id})`,
  );

  const write = async (
    decision: OutcomeDecision,
    attempted: readonly string[],
    omitted: readonly string[],
    omissionReason: string | null,
    artifact: Uint8Array | null,
  ): Promise<DigestScheduleResult> => {
    await tx.insert(
      'reportDeliveries',
      deliveryValues({
        scheduleId: schedule.id,
        dueAt: request.dueAt,
        attempt,
        coversThroughTradingDay,
        channel: schedule.channel,
        format: schedule.format,
        attempted,
        omitted,
        omissionReason,
        outcome: decision.outcome,
        failureReason: decision.failureReason,
        attemptedAt: io.now(),
        deliveredAt: decision.deliveredAt,
        artifactDigest:
          decision.outcome === 'delivered' && artifact !== null ? artifactDigest(artifact) : null,
      }),
    );
    return {
      scheduleId: schedule.id,
      digest: schedule.digest,
      attempt,
      outcome: decision.outcome,
      reason: decision.failureReason,
    };
  };

  // A format this slice cannot render writes `failed` with its reason and never
  // a CSV under a PDF's name. `report_deliveries.format` is transcribed at
  // attempt time so a historical delivery says what it actually was, and a row
  // claiming `pdf` over CSV bytes would make that column lie in the one table
  // the alarm treats as evidence.
  if (schedule.format !== RENDERED_FORMAT)
    return write(
      {
        outcome: 'failed',
        failureReason:
          `this schedule asks for ${schedule.format} and no ${schedule.format} renderer exists in ` +
          'this workspace. Sending CSV under that name would make report_deliveries.format false ' +
          'in the one table the delivery alarm treats as evidence',
        deliveredAt: null,
      },
      [],
      [],
      null,
      null,
    );

  let body: DigestBody;
  try {
    body =
      digest === 'weekly_loss_ratio_cusum'
        ? await io.content.lossRatioCusum(coversThroughTradingDay)
        : await io.content.flagQueue(coversThroughTradingDay);
  } catch (error) {
    return write(
      {
        outcome: 'failed',
        failureReason: `the digest content could not be produced: ${String(error)}`,
        deliveredAt: null,
      },
      [],
      [],
      null,
      null,
    );
  }

  const artifact = renderDigest(body);

  let result: DigestSendResult;
  try {
    result = await io.transport.send({
      digest,
      channel: schedule.channel,
      format: schedule.format,
      recipients: schedule.recipients,
      artifact,
    });
  } catch (error) {
    return write(
      {
        outcome: 'failed',
        failureReason: `the transport refused: ${String(error)}`,
        deliveredAt: null,
      },
      [],
      [],
      null,
      null,
    );
  }

  // A transport that names a destination the schedule never carried has added a
  // recipient, which is the one direction `recipients` may not move without an
  // INV-M6-01 admin_actions row. It is refused rather than recorded.
  const named = new Set(schedule.recipients);
  const foreign = [...result.attempted, ...result.omitted].filter((one) => !named.has(one));
  if (foreign.length > 0)
    throw new DigestRowError(
      `the transport reported ${JSON.stringify(foreign)} for schedule ${schedule.id}, which its ` +
        '`recipients` array does not name. A delivery run may not add a destination: that is a ' +
        'schedule change and every schedule change is an INV-M6-01 admin_actions row',
    );

  return write(
    decideOutcome(result),
    result.attempted,
    result.omitted,
    result.omissionReason,
    artifact,
  );
}

/**
 * Produce and deliver every enabled schedule this slice has a producer for.
 *
 * ONE TRANSACTION FOR THE WHOLE RUN, which is `ADR-006`'s criterion: the
 * delivery rows commit together or none of them does. A partially committed run
 * would leave some windows recorded and some not, and the alarm would report the
 * unrecorded half as missing, which is true and is not the failure that
 * happened.
 */
export async function runDigestDeliveries(
  io: DigestIo,
  request: DigestRunRequest,
): Promise<DigestRunReport> {
  const coversThroughTradingDay = io.tradingDayOf(request.dueAt);

  return io.transact(async (tx: DigestTx) => {
    const results: DigestScheduleResult[] = [];
    const rows = await tx.rowsWhere('reportSchedules', { enabled: true });

    for (const [index, value] of rows.entries()) {
      const schedule = readProducerSchedule(value, `reportSchedules[${String(index)}]`);
      if (!isProduced(schedule.digest)) {
        // NO ROW IS WRITTEN. See this file's header: 0040 has no `skipped`
        // outcome and the missing row is itself the finding.
        results.push({
          scheduleId: schedule.id,
          digest: schedule.digest,
          attempt: null,
          outcome: 'no_producer',
          reason:
            `${schedule.digest} has no producer in this slice, so NO report_deliveries row is ` +
            'written for it and the absence is the finding the delivery alarm reports. ' +
            `${CADENCE_BY_DIGEST[schedule.digest]} cadence.`,
        });
        continue;
      }
      results.push(
        await deliverOne(io, tx, schedule, schedule.digest, request, coversThroughTradingDay),
      );
    }

    return {
      dueAt: request.dueAt,
      coversThroughTradingDay,
      results,
      delivered: results.filter((one) => one.outcome === 'delivered').length,
      failed: results.filter((one) => one.outcome === 'failed').length,
      withoutProducer: results.filter((one) => one.outcome === 'no_producer').length,
      evidenceIsTheDeliveryTable: true,
    };
  });
}

/** Re-exported so a call site building a flag-queue body has the shape to hand. */
export type { FlagQueueDigestBody, LossRatioDigestBody };
