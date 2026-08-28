// =============================================================================
// apps/worker/src/digests/ports.ts
// =============================================================================
// THE SCHEDULED DIGEST'S I/O BOUNDARY, and the boundary of the alarm that
// watches it. `SD-M6-07`'s producers, declared structurally, importing nothing.
//
// `breaker/ports.ts`, `detectors/ports.ts`, `sweeps/ports.ts`, `batch/ports.ts`
// and `provisioning/ports.ts` are the idiom and `ADR-165` is the reason it is
// REQUIRED rather than merely conventional: one door and one acquisition point,
// `src/db.ts`, checked by `grep -rlE "from '@merit/db'" apps/worker/src`
// printing that file AND NOTHING ELSE. `@merit/db`'s `SystemTx` is assignable to
// {@link DigestTx} with no import in either direction.
//
// NOTHING HERE ADDS A `SqlExecutorReason` MEMBER, ADDS A `SystemReason` MEMBER,
// IMPORTS `pg`, OR CASTS PAST A KEY TYPE (`P7` section 11 rule 10, `ADR-157`
// clause 7, `ADR-165`, and `merit/no-raw-db-client` is attached to `apps/**`).
//
// -----------------------------------------------------------------------------
// 1. THE ALARM ASSERTS THE QUERY AND NEVER THE JOB'S OWN REPORT
// -----------------------------------------------------------------------------
// `CRON_INVENTORY`'s scheduled-digest row: "It asserts the query, not the job:
// an enabled `report_schedules` row whose window has closed with no `delivered`
// `report_deliveries` row is the finding, EVALUATED INDEPENDENTLY OF WHETHER ANY
// DELIVERY RUN REPORTED SUCCESS. A job that reports success is not evidence that
// the work happened (`M05` `INV-M5-18`, `M02` `FM-M2-11`, `GS-288`)."
//
// **THAT IS A PROPERTY OF THE ALARM'S PARAMETER LIST AND NOT A COMMENT.**
// {@link DigestAlarmIo} carries a transaction and a clock and NOTHING a producer
// could hand it: there is no run report, no attempt count and no success flag on
// it, so "the run said it worked" is not a value the alarm can be given. A run
// that crashed after writing "success" and a run that never started are the same
// fact to the person who did not get the digest, and here they are the same
// input, because neither is an input at all.
//
// `alarm.ts` additionally holds NO IMPORT OF `produce.ts`, and
// `test/digests.test.ts` reads its source and asserts that. A type checker
// cannot see a coupling that is only a call, so the coupling is refused as text.
//
// -----------------------------------------------------------------------------
// 2. THE WRITE UNION HAS EXACTLY ONE MEMBER AND `report_schedules` IS NOT IT
// -----------------------------------------------------------------------------
// `0040` header item 5: "`report_schedules` IS MUTABLE AND `report_deliveries`
// IS NOT. A schedule is configuration ... and every such change is an
// `INV-M6-01` `admin_actions` row."
//
// A delivery job that could write a schedule could DISABLE THE SCHEDULE IT
// FAILED TO SERVE, which retires the alarm's own subject and leaves no
// `admin_actions` row behind. {@link DIGEST_WRITE_TABLES} having exactly one
// member makes that unreachable rather than forbidden: there is no `key` this
// port accepts that reaches `report_schedules`, and a slice that wants one is
// editing this line with an argument attached.
//
// **THERE IS NO `updateAt` AND NO `deleteAt` EITHER**, which is `0040`'s
// `REVOKE UPDATE, DELETE ON report_deliveries FROM merit_app, PUBLIC` carried up
// from the grant into the type. Without both halves, "one row per delivery
// attempt with its outcome" is a sentence in a header: a `failed` row could be
// moved to `delivered` after the fact, and the alarm's own evidence would be
// editable by the process the alarm exists to distrust.
//
// -----------------------------------------------------------------------------
// 3. THE READ SHAPE IS `ADR-157`'s, AND THIS SLICE NEEDS NOTHING IT REFUSED
// -----------------------------------------------------------------------------
// `ADR-157` clause 1 admits `atMost`, `atLeast` and `isNull` on the READ path
// and nothing else, and clause 6 REFUSED the scalar aggregate. A digest wants
// aggregates, so that refusal was read before this file was designed and the
// answer is that NOTHING HERE ASKS FOR ONE.
//
//   - The alarm's question is "the newest window this schedule has any record
//     of", which `ADR-157` would render as `max(due_at)` and does not have to:
//     the rows are folded in TypeScript, and the fold is over ONE SCHEDULE'S
//     delivery history, which `report_deliveries_delivered_window_idx` exists to
//     serve and which the caller may bound with the one term below.
//   - `every count in a digest body is a count of rows the producer already
//     holds`, so the counting is `Array.length` rather than `count(*)`.
//   - The one term used is `atLeast` on `due_at`, and it is OPTIONAL and the
//     CALLER'S. A horizon is a number and no document states one, so the alarm
//     reads a schedule's whole history by default and a deployment that wants
//     the read bounded supplies the instant and owns that choice.
//
// **IF THAT FOLD EVER STOPS BEING AFFORDABLE THE REMEDY IS AN ENTRY AND NOT A
// WIDENING HERE**, which is `breaker/ports.ts`'s disposition one directory over.
// It is not close today: `report_schedules` holds at most four enabled rows per
// channel by `report_schedules_live_uq`, and a weekly schedule accrues one row
// per week plus its retries.
//
// -----------------------------------------------------------------------------
// 4. NO NUMBER IN THIS FILE IS THIS SLICE'S, AND THE ANCHOR IS THE UNSTATED ONE
// -----------------------------------------------------------------------------
// **THE CADENCE IS STATED AND THE ANCHOR IS NOT, AND THE DIFFERENCE IS THE WHOLE
// DESIGN OF THE ALARM.** `0040`'s `cadence` column is GENERATED from `digest`
// and its `CASE` is transcribed into {@link CADENCE_BY_DIGEST}, so "weekly" is a
// schema fact. **WHICH weekday, at WHICH hour, in WHICH zone a weekly window
// closes is stated NOWHERE**: `CRON_INVENTORY`'s Expected-by cell for this row
// reads "the schedule's own window", `M06` section 3.6 names no time, and
// `WEEKLY_RISK_RITUAL` says "same time every week" without saying which.
// {@link DIGEST_WINDOW_ANCHOR} therefore ships every term `unstated` with its
// citation, on `breaker/ports.ts`'s `LOSS_RATIO_POLICY` precedent, and
// `test/digests.test.ts` asserts the nulls are still null so a later session
// cannot quietly fill one in.
//
// **SO THE ALARM IS ANCHORED ON THE SCHEDULE'S OWN HISTORY RATHER THAN ON A
// WALL CLOCK, AND WHAT THAT COSTS IS STATED RATHER THAN DISCOVERED.** It cannot
// say "the Monday 09:00 window closed and nothing arrived". It says "a full
// cadence period has passed since the newest window this schedule has any record
// of", which is the SAME FACT reported up to one period late in the worst case.
// The alternative was to invent a weekday, and an alarm firing against a window
// nobody agreed to is `GS-287`'s failure one runbook row over: a wrong window
// manufactures evidence, and here the evidence would be against the operator who
// did deliver.
//
// **A PERIOD IS NOT A THRESHOLD.** {@link CADENCE_PERIOD_MS} carries 24 hours
// for `daily` and 7 days for `weekly` because that is what the words mean, and
// `null` for `monthly` because a month has no fixed length and no day-of-month
// anchor is stated. A monthly schedule is therefore reported as
// `cadence_unanchored` rather than passed over in silence, which is the half of
// the alarm that cannot run saying so instead of returning green.
// =============================================================================

// -----------------------------------------------------------------------------
// The vocabulary, transcribed from `0040` and never designed here
// -----------------------------------------------------------------------------

/**
 * `report_schedules.digest`, transcribed from the merged `CHECK`.
 *
 * `0040_report_schedules.sql`: `digest text NOT NULL CHECK (digest IN
 * ('daily_liability', 'weekly_loss_ratio_cusum', 'weekly_flag_queue',
 * 'monthly_revenue_cohort'))`. A TRANSCRIPTION and not a design, and
 * `test/digests.test.ts` reads the migration as text and asserts this tuple
 * against it, so a fifth name cannot drift in on either side.
 *
 * **THE CLOSED SET IS THE FEATURE.** `0040`'s header: "That CHECK is the whole
 * difference between this file and the module `ADR-066` refused. A fifth digest
 * needs a migration, which needs a ruling."
 */
export const DIGESTS = [
  'daily_liability',
  'weekly_loss_ratio_cusum',
  'weekly_flag_queue',
  'monthly_revenue_cohort',
] as const;

/** One of {@link DIGESTS}. */
export type Digest = (typeof DIGESTS)[number];

/** `report_schedules.cadence`'s value space, from the generated column's `CASE`. */
export const CADENCES = ['daily', 'weekly', 'monthly'] as const;

/** One of {@link CADENCES}. */
export type Cadence = (typeof CADENCES)[number];

/**
 * `cadence`, transcribed arm for arm from `0040`'s generated column.
 *
 * NEVER READ FROM A ROW AND NEVER WRITTEN, which is the column's own ruling
 * carried up: "the cadence is a PROPERTY OF THE DIGEST rather than a choice, so
 * as an ordinary column a daily liability digest could be scheduled monthly by
 * one careless insert and nothing would object." A producer that took the
 * cadence off the row would be trusting a value this map already knows, and the
 * suite asserts the two agree on every row it reads.
 */
export const CADENCE_BY_DIGEST: Readonly<Record<Digest, Cadence>> = {
  daily_liability: 'daily',
  weekly_loss_ratio_cusum: 'weekly',
  weekly_flag_queue: 'weekly',
  monthly_revenue_cohort: 'monthly',
};

/**
 * The two digests THIS SLICE produces, and the other two are named absences.
 *
 * `P7` section 8's `P7-l` row names these two. **THE ROW CALLS THEM "the two
 * MUST digests" AND THE PRIMARY SOURCES DISAGREE**, which is recorded here
 * rather than left for the next reader: `M06` section 3.6's own sizing table
 * makes `daily_liability` and `weekly_loss_ratio_cusum` the two **MUST**s
 * ("They are the C8 ritual's input") and `weekly_flag_queue` a **SHOULD**
 * ("useful and nothing depends on them"), and `ADR-066` section 3 says the same
 * in the same words. So one of the two built here is a MUST and the other is a
 * SHOULD, and **the MUST with no producer is `daily_liability`**, whose content
 * is `P-M6-01`, `P-M6-03` and `P-M6-07`'s reserve coverage ratio and therefore
 * waits on `AdminReadSource.readLiability`, which is `P5-l`'s and has not
 * landed. That is reported and not repaired.
 */
export const PRODUCED_DIGESTS = ['weekly_flag_queue', 'weekly_loss_ratio_cusum'] as const;

/** One of {@link PRODUCED_DIGESTS}. */
export type ProducedDigest = (typeof PRODUCED_DIGESTS)[number];

/**
 * `report_deliveries.outcome`. TWO VALUES, and the absence of a third is ruled.
 *
 * `0040` header item 2: "THERE IS DELIBERATELY NO `skipped` OUTCOME ... A skip
 * that can be RECORDED as an outcome is a skip that reads as normal in a list of
 * outcomes." A run that declines to send writes `failed` with its reason, or it
 * writes nothing and the missing row is itself the finding. Both roads reach a
 * human, and `test/digests.test.ts` asserts this tuple has exactly two members
 * so a third cannot arrive as a convenience.
 */
export const DELIVERY_OUTCOMES = ['delivered', 'failed'] as const;

/** One of {@link DELIVERY_OUTCOMES}. */
export type DeliveryOutcome = (typeof DELIVERY_OUTCOMES)[number];

/** `report_schedules.channel` and `report_deliveries.channel`. */
export const CHANNELS = ['email', 'sftp'] as const;

/** One of {@link CHANNELS}. */
export type Channel = (typeof CHANNELS)[number];

/** `report_schedules.format` and `report_deliveries.format`. */
export const FORMATS = ['csv', 'pdf'] as const;

/** One of {@link FORMATS}. */
export type Format = (typeof FORMATS)[number];

/**
 * The one format this slice renders.
 *
 * **A `pdf` SCHEDULE DECLINES AND WRITES `failed`, AND IT DOES NOT SHIP A CSV
 * WEARING A PDF'S NAME.** `report_deliveries.format` is transcribed at attempt
 * time precisely so a historical delivery says what it actually was, and a row
 * claiming `pdf` over CSV bytes would make that column lie in the one table the
 * alarm treats as evidence. No PDF renderer exists in this workspace and
 * bringing one is a dependency rather than a slice.
 */
export const RENDERED_FORMAT = 'csv' as const;

// -----------------------------------------------------------------------------
// The tables, and no others
// -----------------------------------------------------------------------------

/**
 * The tables a digest run or a digest alarm may READ, as a closed union.
 *
 * A NARROW UNION RATHER THAN THE WHOLE KEY SPACE, on `breaker/ports.ts`'s
 * argument: `SystemTx.rowsWhere` is declared over `TableKey` and reaches every
 * table in the estate with one word, and a handle that is wider is assignable to
 * a shape that is narrower, so the narrowing costs the caller nothing.
 *
 * **TWO TABLES AND NOT ONE MORE.** The digest BODIES arrive through
 * {@link DigestContentPort} rather than through this handle, and that is the
 * boundary `INV-M6-10` rests on: a producer that could read `identities`,
 * `risk_flags` or `accounts` directly is a producer one line away from putting a
 * trader in an email, and `M06:54` permits trader-identifying data only when the
 * query names a specific subject.
 */
export const DIGEST_READ_TABLES = ['reportSchedules', 'reportDeliveries'] as const;

/** One of {@link DIGEST_READ_TABLES}. */
export type DigestReadTable = (typeof DIGEST_READ_TABLES)[number];

/**
 * The tables a digest run may WRITE. EXACTLY ONE, and section 2 is why.
 *
 * `report_schedules` is ABSENT. A delivery job that could write a schedule could
 * disable the schedule it failed to serve, which retires the alarm's own subject
 * and leaves no `INV-M6-01` `admin_actions` row behind.
 *
 * `events` is absent for `breaker/ports.ts`'s reason: it is registered in
 * neither `schema.ts` nor `scope.ts`, and naming an unregistered table is a
 * compile error. `P5-b` holds it.
 */
export const DIGEST_WRITE_TABLES = ['reportDeliveries'] as const;

/** One of {@link DIGEST_WRITE_TABLES}. */
export type DigestWriteTable = (typeof DIGEST_WRITE_TABLES)[number];

// -----------------------------------------------------------------------------
// `ADR-157`'s terms, as this file must be able to name them
// -----------------------------------------------------------------------------

/**
 * One column's narrowing when it is not an equality, as `ADR-157` minted it.
 *
 * DECLARED AND NEVER CONSTRUCTED HERE, on `breaker/ports.ts`'s reasoning:
 * `packages/db` keeps a module-private `WeakSet` of the terms it minted and
 * `isFilterTerm` reads IDENTITY rather than shape (`ADR-157` clause 2), so a
 * caller cannot hand-roll one and nothing that crossed a process boundary is in
 * the set.
 */
export type DigestFilterTerm =
  | { readonly term: 'at-most'; readonly value: unknown }
  | { readonly term: 'at-least'; readonly value: unknown }
  | { readonly term: 'is-null' };

/**
 * The ONE read-path constructor this slice needs, supplied by the wiring.
 *
 * INJECTED RATHER THAN IMPORTED, for {@link DigestFilterTerm}'s reason.
 *
 * **THERE IS NO `atMost` AND NO `isNull` HERE AND BOTH ABSENCES ARE
 * DELIBERATE.** `ADR-157` admitted three terms; this slice bounds a history read
 * at its lower end and needs nothing else, and a port declaring a term no caller
 * uses is a door held open for a caller who has not argued for it.
 */
export interface DigestTerms {
  /** `column >= value`, INCLUSIVE. The horizon's lower bound. */
  atLeast(value: NonNullable<unknown>): DigestFilterTerm;
}

/** A filter, by Drizzle property name. `ADR-112`'s shape. */
export type DigestFilter = Readonly<Record<string, unknown>>;

/** A set of values to write, by Drizzle property name. */
export type DigestValues = Readonly<Record<string, unknown>>;

/** One row as this slice sees it. */
export type DigestRow = Readonly<Record<string, unknown>>;

// -----------------------------------------------------------------------------
// One open transaction, in two shapes, and the narrower one is the alarm's
// -----------------------------------------------------------------------------

/**
 * What the ALARM sees: reads and nothing else.
 *
 * **`insert` IS ABSENT AND THAT IS THE POINT.** An alarm that could write is an
 * alarm that could discharge the window it is complaining about, and the whole
 * construction here is that the evidence is written by one process and read by
 * another. `SystemTx` satisfies this structurally, so the wiring hands the same
 * door in and the alarm receives a handle it CANNOT WRITE THROUGH.
 */
export interface DigestReadTx {
  /** Rows matching a filter. The READ path is the only place a term may appear. */
  rowsWhere(key: DigestReadTable, where: DigestFilter): Promise<unknown[]>;
}

/**
 * What the PRODUCER sees: the reads above plus one append.
 *
 * **`updateAt` AND `deleteAt` ARE ABSENT**, which is section 2: `0040`'s
 * `REVOKE UPDATE, DELETE ON report_deliveries` carried up from the grant into
 * the type, so an append-only log is append-only in TypeScript as well as in
 * PostgreSQL. A retry is a new row at the next `attempt` ordinal, which is
 * `report_deliveries_window_attempt_uq` read as a design rather than as an
 * obstacle: "the failure that was retried is the evidence".
 *
 * **THERE IS NO `lockAt`.** `ADR-157` clause 4's row lock buys nothing here: two
 * concurrent runs on the same window contend on
 * `report_deliveries_window_attempt_uq`, which refuses the second at the
 * database rather than letting both through, and a lost duplicate delivery is
 * the correct outcome.
 */
export interface DigestTx extends DigestReadTx {
  /** Append one delivery attempt, returning it. */
  insert(key: DigestWriteTable, values: DigestValues): Promise<unknown[]>;
}

// -----------------------------------------------------------------------------
// The cadence's period, and the anchor that is unstated
// -----------------------------------------------------------------------------

/**
 * A number the corpus states, with the source it was read from.
 *
 * `breaker/ports.ts`'s `PolicyNumber` shape, adopted rather than reinvented:
 * each value is `{state, value, cite, quote}` rather than a bare number, and a
 * value the corpus does not state is `unstated` with a `null` rather than
 * absent. A reader asking "where does this come from" gets the answer from the
 * value.
 */
export type ScheduleNumber =
  | {
      readonly state: 'stated';
      readonly value: number;
      readonly cite: string;
      readonly quote: string;
    }
  | {
      readonly state: 'unstated';
      readonly value: null;
      readonly cite: string;
      readonly quote: string;
    };

/**
 * How long one window of each cadence lasts, in milliseconds.
 *
 * **A PERIOD IS THE MEANING OF THE WORD AND NOT A THRESHOLD SOMEBODY CHOSE**,
 * which is why `daily` and `weekly` carry values while every term in
 * {@link DIGEST_WINDOW_ANCHOR} carries `null`. A daily cadence is one window per
 * day and a civil day is 24 hours; `due_at` is a `timestamptz` and not a trading
 * day, so no exchange calendar is being derived here and
 * `merit/no-calendar-in-expiry-path`'s concern one directory over does not
 * arise.
 *
 * **`monthly` IS `null` BECAUSE A MONTH HAS NO FIXED LENGTH**, and the honest
 * consequence is reported rather than smoothed: a 30-day constant would be a
 * number this slice invented, and the alarm returns `cadence_unanchored` for a
 * monthly schedule instead. `monthly_revenue_cohort` is not one of this slice's
 * two digests, so nothing here needs the value it does not have.
 */
export const CADENCE_PERIOD_MS: Readonly<Record<Cadence, number | null>> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: null,
};

/**
 * WHEN a window closes, and every term of it is `unstated`.
 *
 * Section 4 of this file's header. `CRON_INVENTORY`'s Expected-by cell for the
 * scheduled-digest row reads "the schedule's own window", which names a thing
 * rather than defining one; `M06` section 3.6's table gives each digest a
 * cadence and no time; `WEEKLY_RISK_RITUAL` says "same time every week, whether
 * or not anything looks wrong" and never says which time.
 *
 * `test/digests.test.ts` asserts every member is still `unstated`, so filling
 * one in is a red suite rather than a quiet commit.
 */
export const DIGEST_WINDOW_ANCHOR: Readonly<Record<string, ScheduleNumber>> = {
  weekdayOfWeeklyWindow: {
    state: 'unstated',
    value: null,
    cite: 'CRON_INVENTORY (scheduled digest delivery), M06 section 3.6, WEEKLY_RISK_RITUAL',
    quote:
      'Expected by: "the schedule\'s own window". The cadence is generated from the digest and no ' +
      'approved document names the day of the week a weekly window closes on.',
  },
  hourOfWindowClose: {
    state: 'unstated',
    value: null,
    cite: 'CRON_INVENTORY (scheduled digest delivery), M06 section 3.6',
    quote:
      'Every other row in the cron inventory carries a wall-clock expected-by time in CT. This one ' +
      'carries the phrase "the schedule\'s own window", and no schedule column holds a time.',
  },
  dayOfMonthlyWindow: {
    state: 'unstated',
    value: null,
    cite: 'ADR-066 section 3, M06 section 3.6',
    quote:
      'The monthly revenue and cohort digest is sized SHOULD and no document names the day of the ' +
      'month it is due. A month is also not a fixed number of milliseconds, so CADENCE_PERIOD_MS ' +
      'carries null for it as well.',
  },
};

// -----------------------------------------------------------------------------
// The bodies, and `INV-M6-10` is a property of these types
// -----------------------------------------------------------------------------

/**
 * One plan's line in the loss-ratio and CUSUM digest.
 *
 * `M06` section 3.6: built from "`P-M6-05` with its sample size beside it
 * (`INV-M6-07`) and `P-M6-06`". **`sampleSize` IS NOT OPTIONAL**, which is
 * `INV-M6-07` and `AS-M6-02`'s counter as a type: a ratio without its sample
 * size is the number that gets the breaker overridden, and a `number` rather
 * than `number | undefined` makes omitting it a compile error.
 *
 * **THERE IS NO IDENTITY, ACCOUNT OR TRADER FIELD ON THIS TYPE** (`INV-M6-10`).
 * A plan code is a product and not a person.
 */
export interface LossRatioDigestLine {
  readonly planCode: string;
  readonly metric: string;
  readonly state: string;
  /** Integer basis points, or `null` when there is no ratio. Never a float. */
  readonly ratioBp: number | null;
  readonly thresholdBp: number;
  readonly sampleSize: number;
  readonly minSample: number;
  readonly salesPaused: boolean;
}

/**
 * The loss-ratio and CUSUM digest's body.
 *
 * **THE CUSUM IS ABSENT AND THE REASON TRAVELS WITH THE ABSENCE.** `ADR-167`
 * clause 5 renders `per_plan[].cusum` absent until `DEP-M6-05` supplies `mu_0`
 * and `sigma`, `apps/admin/src/page.ts` already lists `P-M6-06` as PENDING
 * rather than drawing an empty chart, and `breaker/evaluate.ts`'s `cusumOf`
 * returns `null` for the same reason. **A digest that rendered an uncalibrated
 * CUSUM would be `FM-M6-07` delivered weekly by email**, which is the failure
 * with a distribution list attached, so the body carries the blocker's name
 * instead of a chart.
 */
export interface LossRatioDigestBody {
  readonly digest: 'weekly_loss_ratio_cusum';
  readonly coversThroughTradingDay: string;
  readonly plans: readonly LossRatioDigestLine[];
  readonly cusumBlockedOn: string | null;
}

/**
 * One severity band in the flag-queue digest. COUNTS AND A LINK.
 *
 * `M06` section 3.6: "The flag-queue digest carries **counts and links, never
 * trader-identifying rows**, which keeps it inside `INV-M6-10`'s rule that
 * trader-identifying data renders only when the query names a specific subject",
 * and `ADR-066` section 3 says the same. Built from "the queue's depth and age
 * by severity, section 9's `admin.flags_open`".
 *
 * **THE LINK IS TO THE QUEUE AND NEVER TO A SUBJECT, AND THAT READING IS STATED
 * RATHER THAN ASSUMED.** "Counts and links" is ambiguous about what a link
 * points at, and a link to `/admin/identities/<uuid>` carries an identifier into
 * an inbox, which is exactly the bulk export `INV-M6-10` forbids and this
 * feature was admitted on the promise of not being. So the link is the console's
 * own filtered queue view, where the specific-subject query then happens under
 * the console's own controls.
 *
 * **`oldestFirstDetectedOn` IS A TRADING DAY AND NOT A FLAG.** `M07` section 3.3
 * makes age the thing an operator reads; a date is age and is nobody's identity.
 */
export interface FlagQueueDigestBand {
  readonly severity: 1 | 2 | 3 | 4 | 5;
  readonly open: number;
  readonly oldestFirstDetectedOn: string | null;
  readonly queueLink: string;
}

/**
 * The flag-queue digest's body.
 *
 * **NO FIELD ON THIS TYPE CAN HOLD A TRADER**, which is `INV-M6-10` as a
 * property rather than as a rule somebody followed. `test/digests.test.ts`
 * sweeps the RENDERED artifact for uuid-shaped and mailbox-shaped text and
 * refuses either, because a type says nothing about what a producer put in a
 * string.
 */
export interface FlagQueueDigestBody {
  readonly digest: 'weekly_flag_queue';
  readonly coversThroughTradingDay: string;
  readonly bands: readonly FlagQueueDigestBand[];
  readonly totalOpen: number;
  readonly queueLink: string;
}

/** Either digest's body. */
export type DigestBody = LossRatioDigestBody | FlagQueueDigestBody;

/**
 * Where a digest's contents come from, and it is NOT this handle's tables.
 *
 * **BOTH BODIES ARE INPUTS AND NEITHER IS QUERIED HERE**, which is section 3's
 * table union stated as a port. The loss-ratio body is `P7-k`'s
 * `BreakerEvaluationReport` folded by `lossRatioBodyFrom` in `produce.ts`, and
 * the flag-queue body is `P7-i`'s queue, which lives in
 * `apps/api/src/admin-source/flags.ts`. **`apps/worker` DECLARES NEITHER
 * `@merit/api` NOR ANY PATH INTO IT** and under `node-linker=isolated` an
 * undeclared import does not resolve at all, so the flag queue crosses as a
 * SUMMARY the deployment supplies rather than as a call this deployable makes.
 */
export interface DigestContentPort {
  lossRatioCusum(coversThroughTradingDay: string): Promise<LossRatioDigestBody>;
  flagQueue(coversThroughTradingDay: string): Promise<FlagQueueDigestBody>;
}

// -----------------------------------------------------------------------------
// The transport, and `GS-290` is in its return type
// -----------------------------------------------------------------------------

/** What a transport is handed. It carries bytes and a destination and no credential. */
export interface DigestEnvelope {
  readonly digest: ProducedDigest;
  readonly channel: Channel;
  readonly format: Format;
  readonly recipients: readonly string[];
  readonly artifact: Uint8Array;
}

/**
 * What a transport reports, and `GS-290` is why `omitted` is a first-class half.
 *
 * "A schedule naming a recipient who has been removed delivers to the rest AND
 * RECORDS THE REMOVAL." A transport that returned only a boolean would make that
 * unrecordable, and `report_deliveries_omission_states_its_reason` is an
 * equivalence in both directions: an attempt that omitted nobody may not claim a
 * removal it did not make, and one that omitted somebody may not stay silent.
 *
 * **A TRANSPORT THAT REACHED NOBODY REPORTS `attempted: []` AND THE PRODUCER
 * REFUSES TO CALL THAT A DELIVERY** (`report_deliveries_delivered_reached_somebody`,
 * and `M06` section 3.6: "Full degradation to zero recipients is not a degraded
 * success; it is a failure that has learned to look like one").
 */
export interface DigestSendResult {
  readonly attempted: readonly string[];
  readonly omitted: readonly string[];
  /** Required when `omitted` is non-empty, refused when it is empty. */
  readonly omissionReason: string | null;
  /** `null` when nothing was delivered. */
  readonly deliveredAt: Date | null;
  /** Required when nothing was delivered, refused when something was. */
  readonly failureReason: string | null;
}

/** The channel adapter. */
export interface DigestTransport {
  send(envelope: DigestEnvelope): Promise<DigestSendResult>;
}

// -----------------------------------------------------------------------------
// Everything the two runs cannot do for themselves
// -----------------------------------------------------------------------------

/**
 * THE ALARM'S WHOLE OUTSIDE WORLD, AND IT CANNOT BE HANDED A RUN REPORT.
 *
 * Section 1 of this file's header. There is no field on this interface that a
 * producer could set, no report, no attempt count and no success flag, so
 * "the delivery job said it worked" is not a value this alarm can receive. A job
 * that crashed after writing "success" and a job that never ran are the same
 * fact to the person who did not get the digest, and here they are the same
 * input, because neither is an input at all.
 *
 * `now` IS INJECTED AND IS THE ONLY CLOCK, so a fixture pins the whole
 * evaluation and the database never supplies an instant.
 */
export interface DigestAlarmIo {
  read<T>(fn: (tx: DigestReadTx) => Promise<T>): Promise<T>;
  readonly terms: DigestTerms;
  now(): Date;
}

/**
 * The producer's whole outside world.
 *
 * `transact` TAKES THE UNIT OF WORK rather than handing back a handle, which is
 * `WorkerDb.batch`'s shape and its reason: a transaction cannot outlive the
 * function that opened it and no caller has a `commit` to forget.
 * **`apps/worker/src/db.ts` ALREADY SATISFIES IT** and `SystemReason` gains no
 * member: `LIVE_DB.batch` is `transaction(systemDb('nightly-batch'), fn)`, and a
 * scheduled digest is a scheduled job, which is what `'nightly-batch'` names.
 *
 * **`tradingDayOf` IS INJECTED AND IS NOT COMPUTED HERE.**
 * `report_deliveries.covers_through_trading_day` is a `date` and the trading day
 * follows the exchange session calendar maintained as data (`CLAUDE.md`,
 * `ADR-042`); a job deriving one from a UTC instant would be inventing a
 * calendar. `INV-M6-04` is why the column exists at all: "every number names its
 * as-of moment and its source, and a digest that leaves the console loses the
 * page that would have said so".
 */
export interface DigestIo {
  transact<T>(fn: (tx: DigestTx) => Promise<T>): Promise<T>;
  readonly terms: DigestTerms;
  readonly content: DigestContentPort;
  readonly transport: DigestTransport;
  now(): Date;
  /** The exchange trading day, as `YYYY-MM-DD`. Supplied, never derived. */
  tradingDayOf(at: Date): string;
}

/**
 * Raised when a run cannot proceed under what it was given.
 *
 * **IT IS A NAMED WAY TO SAY "I WILL NOT INVENT THIS" AND IT IS NOT AN
 * OUTCOME.** It is distinct from writing `failed`: a `failed` row is a delivery
 * that was attempted and did not arrive, and this is the run refusing to treat
 * an unanswerable question as an answer.
 */
export class DigestDeclined extends Error {
  readonly why: string;
  constructor(why: string) {
    super(`the digest run declined: ${why}`);
    this.name = 'DigestDeclined';
    this.why = why;
  }
}

/**
 * Raised by a port that is not installed.
 *
 * A PRODUCER THAT RETURNED A PLAUSIBLE SUCCESS WOULD BE A FIXTURE REPORTING THAT
 * MERIT'S WEEKLY RISK RITUAL HAS ITS INPUT. `delivered` on an unwired deployment
 * is indistinguishable from `delivered` on a real one, and it is the answer a
 * reader takes as evidence that the digest arrived. So the default refuses.
 */
export class DigestUnwired extends Error {
  constructor(what: string) {
    super(
      `DigestIo.${what} cannot be served by this deployment: no adapter is installed. The digest ` +
        'producer refuses rather than returning a plausible value, because a `delivered` reported ' +
        'by an unwired producer is indistinguishable from one reported by a wired producer, and ' +
        "that indistinguishability is what CRON_INVENTORY's dead-man switch for this row exists " +
        'to make false',
    );
    this.name = 'DigestUnwired';
  }
}

/**
 * The unwired default, which serves nothing.
 *
 * `CRON_INVENTORY`'s scheduled-digest row alarms on the DELIVERY RECORD, so a
 * deployment holding this default writes no `delivered` row and is alarmed as
 * such by the alarm in this same directory, which needs no adapter of the
 * producer's to say so.
 */
export const UNWIRED_DIGEST_IO: DigestIo = {
  transact: () => Promise.reject(new DigestUnwired('transact')),
  terms: {
    atLeast: () => {
      throw new DigestUnwired('terms.atLeast');
    },
  },
  content: {
    lossRatioCusum: () => Promise.reject(new DigestUnwired('content.lossRatioCusum')),
    flagQueue: () => Promise.reject(new DigestUnwired('content.flagQueue')),
  },
  transport: { send: () => Promise.reject(new DigestUnwired('transport.send')) },
  now: () => {
    throw new DigestUnwired('now');
  },
  tradingDayOf: () => {
    throw new DigestUnwired('tradingDayOf');
  },
};

/**
 * The unwired alarm door, which serves nothing and is NOT the producer's.
 *
 * A SEPARATE VALUE FROM {@link UNWIRED_DIGEST_IO} on section 1's ground: the two
 * runs are wired independently, and a deployment that wired the producer and not
 * the alarm is exactly the deployment where "the job reported success" is the
 * only thing anybody has.
 */
export const UNWIRED_DIGEST_ALARM_IO: DigestAlarmIo = {
  read: () => Promise.reject(new DigestUnwired('read')),
  terms: {
    atLeast: () => {
      throw new DigestUnwired('terms.atLeast');
    },
  },
  now: () => {
    throw new DigestUnwired('now');
  },
};
