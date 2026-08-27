// =============================================================================
// apps/api/src/routes/internal.ts
// =============================================================================
// API_CONTRACT SECTION 9's FOUR `/internal/*` ROWS, AND THE FIRST OPERATOR
// MODULE THIS DEPLOYABLE HAS EVER HELD.
//
// | `POST /internal/batch/run`     | Manually trigger or resume the nightly
// |                                | batch | Guarded, idempotent per
// |                                | `(trading_day, run_id)`, requires `reason` |
// | `GET /internal/recon/status`   | Current mismatches and their ages | |
// | `GET /internal/jobs`           | Queue depth, failures, dead-man switch
// |                                | state | |
// | `GET /internal/health/deep`    | Dependency checks (DB, SFTP, Rise, PSP) |
// |                                | Admin origin only |
//
// -----------------------------------------------------------------------------
// THE REFUSAL THIS SESSION WAS DISPATCHED TO ESTABLISH ALREADY EXISTS, AND IT
// IS MECHANICAL RATHER THAN DOCUMENTED
// -----------------------------------------------------------------------------
// The question put to session 255 was whether anything in this tree refuses an
// `/internal/*` call arriving on the public surface, on the ground that an
// internal surface any deployable can call is the shape ADR-083 section 3
// refuses and that ADR-096's hole is that nothing enforced it. IT IS ENFORCED,
// in three independent places, and none of them is this file:
//
//   1. `surface.ts` classifies `/internal` as `operator` by PREFIX, so every
//      path below it is operator-classified with no list to keep current.
//   2. `registry.ts`'s `compose` calls `surfaceServes` on EVERY declared route
//      and never registers what this surface does not serve. The public
//      deployment's 404 is the router's, produced by there being nothing there.
//   3. `RI-09` refuses any OTHER deployable holding a file whose path spells
//      `/api/v1/internal/...`, which is the half `surface.ts` structurally
//      cannot see.
//
// So `ADR-143`'s conditional does not fire and no ruling is owed. What this
// file changes is that the mechanism now has a SUBJECT: until it landed,
// `compose`'s `withheld` list was empty on both surfaces and `index.ts`'s own
// startup line said so ("the only evidence a running public deployment can
// offer that the mechanism is live is that this number is not zero once an
// operator module exists"). These four rows are that operator module.
//
// -----------------------------------------------------------------------------
// THERE IS NO IN-PROCESS FACTOR CHECK HERE AND ITS ABSENCE IS THE RULING, NOT
// AN OVERSIGHT
// -----------------------------------------------------------------------------
// `auth.ts`'s `authorize` REFUSES `admin_sso` unconditionally and says why in
// its own comment: that module serves the public surface, and an endpoint in it
// declaring the operator token would be an operator route on the trader origin.
// Routing these four through `endpointHandler` would therefore answer 403 to
// every operator on the operator deployment, which is a route that cannot work.
//
// AND WRITING A SECOND, OPERATOR-FLAVOURED `authorize` HERE WOULD BE THE EXACT
// MISTAKE ADR-083 SECTION 4 REFUSES. "403 is what a permission check returns.
// 404 is what an absent route returns", and a process that registered the path
// and then refused it "can be made to answer 404, and every future handler,
// middleware ordering and error mapper is another chance to get that wrong".
// The two controls that actually hold this surface are:
//
//   THE SURFACE      this process registers these four only when
//                    `MERIT_API_SURFACE=operator`. On `public` they are
//                    withheld and the origin answers 404 by having nothing.
//   THE EDGE         `ADMIN_ORIGIN`'s IP allowlist and hardware-key SSO
//                    (C-08, C-22, ADR-012, INFRA section 13.2). That origin's
//                    value is never written into this repository, so the
//                    control is deliberately not expressible here.
//
// C-22 states the pair as one line: "`/internal/*` only on the admin origin".
//
// THE DECLARATION IS STILL WRITTEN DOWN. API_CONTRACT section 12 requires "a
// server-side declaration per endpoint" rather than discipline, and
// `INTERNAL_REQUIRED_FACTORS` below is it, derived from the same array the
// routes are derived from so the table and the registration cannot disagree.
// It declares `admin_sso` on all four, which is section 12's own cell. What it
// does NOT do is make this file the thing that applies it, and the difference
// is stated here rather than left for a reader to infer from an empty function.
//
// -----------------------------------------------------------------------------
// EVERY READ IS A PORT, AND `POST /internal/batch/run` REACHES NO QUEUE FROM
// HERE
// -----------------------------------------------------------------------------
// `public-methods.ts`'s shape, for its stated reason and for two more that are
// specific to this module:
//
//   `db.ts` HOLDS TWO DOORS AND NEITHER IS THE ONE THESE ROWS WOULD NEED.
//   `scoped` takes an identity and there is no identity on this surface;
//   `firm` is `FirmTableKey` and `reconciliations` is not one. The door that
//   would reach it is `system('operator-console')`, `db.ts` deliberately does
//   not open one, and widening `SystemReason` is refused by ADR-109 clause 1
//   and is outside this session's fence besides.
//
//   `apps/api` DECLARES NO `@merit/queue`. A job enqueue goes through that
//   package and not through raw SQL, and the manifest is the only place that
//   capability can be acquired (ADR-117 section 5, measured from this very
//   package). So `runBatch` is a port: the wiring slice that adds the manifest
//   line supplies an implementation that opens a transaction, takes
//   `sqlExecutor('job-enqueue')` off it and calls `enqueue` inside it, which is
//   ADR-006's transactional enqueue and is the only shape `JobTransaction`
//   admits. A trigger that reached its own connection is the saga bug that
//   interface exists to make unwriteable.
//
// AN UNSET PORT IS A 500 AND NOT A 503, and the two precedents in this tree
// disagree, so the choice is argued rather than copied. `auth.ts` answers 503
// for an unwired backend (ADR-120); `public-methods.ts` answers 500 and says
// 503 "would invite a retry against a process that will never succeed". THE
// SECOND ARGUMENT IS DECISIVE HERE AND IT IS DECISIVE BECAUSE OF THE BATCH
// TRIGGER: an operator working an incident who is told "service unavailable"
// retries, and every retry is another manual batch trigger against a process
// that cannot ever run one. A 500 says the deployment is broken, which is the
// true statement and the one that gets somebody to look at the deployment.
//
// -----------------------------------------------------------------------------
// WHAT IS TRANSCRIBED FROM THE CORPUS RATHER THAN INVENTED
// -----------------------------------------------------------------------------
//   `DEEP_HEALTH_DEPENDENCIES`  API_CONTRACT section 9's parenthesis, in its
//                               order: DB, SFTP, Rise, PSP.
//   `RECON_SOURCES`             `0014_marks.sql`'s CHECK on
//                               `reconciliations.our_source`.
//   `DEAD_MAN_SEVERITIES`       CRON_INVENTORY's severity column.
//   `delta_cents`               recomputed here as `our - platform`, which is
//                               `0014`'s own GENERATED expression, so the two
//                               sides and their difference can never disagree.
//
// TWO CORPUS DISAGREEMENTS ARE REPORTED RATHER THAN RESOLVED, both in this
// file's session log. M02 section 4 spells `POST /internal/batch/run` as
// accepting "an optional `trading_day` and an optional `from_stage`" where
// API_CONTRACT makes the anchor `(trading_day, run_id)` and requires `reason`;
// the frozen contract wins and `from_stage` is not carried. M02 also wants
// `GET /internal/recon/status` to be a per-day summary (files received,
// applied, quarantined, accounts reconciled, mismatches open, setpoints
// unconfirmed) where the contract's purpose column says "current mismatches
// and their ages". The contract's is what is built; M02's wider shape is a
// widening this session declines rather than smuggles in.
// =============================================================================

import { defineRoutes } from '../registry.ts';
import { PROBLEM_MEDIA_TYPE, problem } from '../server.ts';
import type { HttpMethod, RouteDefinition, RouteHandler } from '../registry.ts';
import type { Problem } from '../server.ts';
import type { FieldError, RequiredFactor } from './auth.ts';
import { centsToJson } from './checkout.ts';

import type { FastifyReply, FastifyRequest } from 'fastify';

// -----------------------------------------------------------------------------
// The paths, as API_CONTRACT writes them
// -----------------------------------------------------------------------------

/** Section 9. Dependency checks, and the row the contract marks admin origin only. */
export const DEEP_HEALTH_PATH = '/internal/health/deep';

/** Section 9. Queue depth, failures, dead-man switch state. */
export const JOBS_PATH = '/internal/jobs';

/** Section 9. Current mismatches and their ages. */
export const RECON_STATUS_PATH = '/internal/recon/status';

/** Section 9. Manually trigger or resume the nightly batch. */
export const BATCH_RUN_PATH = '/internal/batch/run';

/**
 * Section 12's cell for every row this module serves.
 *
 * ONE CONSTANT RATHER THAN FOUR LITERALS, because the four rows share one cell
 * in the contract: "Trader session calls `/internal/*` from the public origin |
 * `admin_sso` | 404". A per-route literal would be four places to disagree with
 * one row of one table.
 */
export const OPERATOR_FACTOR: RequiredFactor = 'admin_sso';

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

/**
 * Thrown when this module cannot answer from what a port returned.
 *
 * EVERY CASE IS A DEFECT RATHER THAN A REQUEST THE CALLER GOT WRONG, so every
 * one becomes a 500 through `server.ts`'s error handler rather than a 4xx this
 * file invents. No caller can cause any of them.
 */
export class InternalOpsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InternalOpsError';
  }
}

// -----------------------------------------------------------------------------
// `GET /internal/health/deep`
// -----------------------------------------------------------------------------

/**
 * The four dependencies API_CONTRACT section 9 names, in the contract's order.
 *
 * CLOSED, and the closure is what makes a SHORT answer a finding. A deep health
 * check that silently omits a dependency reports the estate healthy on the
 * strength of the probes that happened to run, which is the failure this
 * endpoint exists to prevent rather than a smaller version of the answer.
 */
export const DEEP_HEALTH_DEPENDENCIES = ['db', 'sftp', 'rise', 'psp'] as const;

/** One of {@link DEEP_HEALTH_DEPENDENCIES}. */
export type DependencyName = (typeof DEEP_HEALTH_DEPENDENCIES)[number];

/**
 * What a probe concluded.
 *
 * Three members, and `degraded` is not decoration: `M07`'s detector language
 * uses it for a component that answers and answers wrong, which is the state an
 * operator most needs told apart from an outage.
 */
export const DEPENDENCY_STATUSES = ['ok', 'degraded', 'down'] as const;

/** One of {@link DEPENDENCY_STATUSES}. */
export type DependencyStatus = (typeof DEPENDENCY_STATUSES)[number];

/** How bad each status is. `worstOf` folds over this and nothing else orders them. */
const STATUS_RANK: Readonly<Record<DependencyStatus, number>> = { ok: 0, degraded: 1, down: 2 };

/** One dependency's probe result, as the port hands it over. */
export interface DependencyCheck {
  readonly name: DependencyName;
  readonly status: DependencyStatus;
  /** When the probe ran. An ISO 8601 instant, UTC in storage per the convention. */
  readonly checked_at: string;
  /** Free text for an operator. `null` rather than absent, so the field is always there. */
  readonly detail: string | null;
}

/** `GET /internal/health/deep`. */
export interface DeepHealthResponse {
  /** The worst of the four. `ok` only when every one of them is. */
  readonly status: DependencyStatus;
  readonly dependencies: readonly DependencyCheck[];
}

/** An ISO 8601 instant with an explicit zone. Refused rather than coerced. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** A trading day, `YYYY-MM-DD`. The calendar check is separate; see `isCalendarDay`. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Whether a `YYYY-MM-DD` string names a day that exists. `2026-02-30` does not. */
export function isCalendarDay(value: string): boolean {
  if (!DAY.test(value)) return false;
  const at = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === value;
}

function assertInstant(what: string, value: string): void {
  if (!INSTANT.test(value) || Number.isNaN(new Date(value).getTime()))
    throw new InternalOpsError(
      `${what} is \`${value}\`, which is not an ISO 8601 instant. An operator report whose ` +
        'timestamps cannot be parsed is a report whose ages cannot be believed',
    );
}

/**
 * Fold the four probes into one status.
 *
 * Exported so the suite can assert the fold directly rather than through four
 * rendered responses.
 */
export function worstOf(statuses: readonly DependencyStatus[]): DependencyStatus {
  let worst: DependencyStatus = 'ok';
  for (const status of statuses) if (STATUS_RANK[status] > STATUS_RANK[worst]) worst = status;
  return worst;
}

/**
 * Render the deep health response, refusing rather than guessing.
 *
 * THE ORDER IS THE CONTRACT'S AND NEVER THE PORT'S. Two probe implementations
 * that answered in two orders would produce two responses carrying the same
 * facts, and an operator comparing today's page against yesterday's would be
 * reading a diff of the probe rather than of the estate.
 */
export function renderDeepHealth(checks: readonly DependencyCheck[]): DeepHealthResponse {
  const byName = new Map<string, DependencyCheck>();
  for (const check of checks) {
    if (!(DEEP_HEALTH_DEPENDENCIES as readonly string[]).includes(check.name))
      throw new InternalOpsError(
        `the deep health probe reported \`${String(check.name)}\`, which is not one of ` +
          `${DEEP_HEALTH_DEPENDENCIES.join(', ')}. API_CONTRACT section 9 names the four this ` +
          'row covers, and a fifth is a dependency the contract does not know about',
      );
    if (!(DEPENDENCY_STATUSES as readonly string[]).includes(check.status))
      throw new InternalOpsError(
        `\`${check.name}\` reported status \`${String(check.status)}\`, which is not one of ` +
          `${DEPENDENCY_STATUSES.join(' | ')}`,
      );
    if (byName.has(check.name))
      throw new InternalOpsError(
        `the deep health probe reported \`${check.name}\` twice. Two answers about one ` +
          'dependency name neither, and the fold below would silently take whichever sorted last',
      );
    assertInstant(`\`${check.name}\`'s checked_at`, check.checked_at);
    byName.set(check.name, check);
  }

  const dependencies: DependencyCheck[] = [];
  for (const name of DEEP_HEALTH_DEPENDENCIES) {
    const check = byName.get(name);
    if (check === undefined)
      throw new InternalOpsError(
        `the deep health probe returned no result for \`${name}\`. A missing probe is not a ` +
          'passing one: rendering the response without it would report the estate on the ' +
          'strength of the checks that happened to run',
      );
    dependencies.push(check);
  }

  return { status: worstOf(dependencies.map((d) => d.status)), dependencies };
}

// -----------------------------------------------------------------------------
// `GET /internal/jobs`
// -----------------------------------------------------------------------------

/** CRON_INVENTORY's severity column. Closed, because a fourth level is a ruling. */
export const DEAD_MAN_SEVERITIES = ['S1', 'S2', 'S3'] as const;

/** One of {@link DEAD_MAN_SEVERITIES}. */
export type DeadManSeverity = (typeof DEAD_MAN_SEVERITIES)[number];

/** One queue's depth and failure count. */
export interface QueueDepth {
  readonly queue: string;
  /** Jobs waiting. A count, so a negative one is a defect rather than a small number. */
  readonly depth: number;
  /** Jobs that exhausted their retries. */
  readonly failed: number;
}

/**
 * One row of CRON_INVENTORY's scheduled table, as the estate currently answers it.
 *
 * `expected_by` IS THE INVENTORY'S OWN CELL AND IS NOT A COMPUTED DEADLINE. That
 * document writes times as `06:00 CT`, the trading day follows the exchange
 * session calendar, and converting one here would put a second calendar in a
 * route handler.
 */
export interface DeadManSwitch {
  readonly job: string;
  readonly severity: DeadManSeverity;
  /** CRON_INVENTORY's "Expected by" cell, verbatim. */
  readonly expected_by: string;
  /** The last completion signal, or `null` if the job has never reported one. */
  readonly last_completed_at: string | null;
  /** Whether the switch is alerting right now. */
  readonly firing: boolean;
}

/** What the port returns for `GET /internal/jobs`. */
export interface JobsSnapshot {
  readonly queues: readonly QueueDepth[];
  readonly deadManSwitches: readonly DeadManSwitch[];
}

/** `GET /internal/jobs`. */
export interface JobsResponse {
  readonly queues: readonly QueueDepth[];
  readonly dead_man_switches: readonly DeadManSwitch[];
  /**
   * How many switches are firing.
   *
   * DERIVED FROM THE ARRAY BESIDE IT AND NEVER SUPPLIED, so the number an
   * operator scans and the list they then read cannot disagree.
   */
  readonly firing: number;
}

function assertCount(what: string, value: number): void {
  if (!Number.isInteger(value) || value < 0)
    throw new InternalOpsError(
      `${what} is \`${String(value)}\`, which is not a count. A queue depth and a failure ` +
        'total are non-negative integers, and a fractional or negative one is a broken ' +
        'aggregate rather than a small number',
    );
}

/**
 * Render the jobs response, refusing rather than guessing.
 *
 * AN EMPTY SWITCH LIST IS A THROW AND AN EMPTY QUEUE LIST IS NOT, and the
 * asymmetry is CRON_INVENTORY's own rule: "a job in this table without a
 * dead-man switch is a job that does not exist". A response carrying no switch
 * reports that nothing is firing, which is indistinguishable from nothing being
 * watched, and this endpoint is the page an operator opens to tell those apart.
 * A workspace can legitimately have declared no queue yet; it cannot
 * legitimately watch nothing, because the inventory has rows today.
 */
export function renderJobs(snapshot: JobsSnapshot): JobsResponse {
  const queues = new Set<string>();
  for (const queue of snapshot.queues) {
    if (queue.queue === '')
      throw new InternalOpsError('a queue depth was reported for an unnamed queue');
    if (queues.has(queue.queue))
      throw new InternalOpsError(
        `queue \`${queue.queue}\` was reported twice. Two depths for one queue name neither`,
      );
    queues.add(queue.queue);
    assertCount(`queue \`${queue.queue}\`'s depth`, queue.depth);
    assertCount(`queue \`${queue.queue}\`'s failed count`, queue.failed);
  }

  if (snapshot.deadManSwitches.length === 0)
    throw new InternalOpsError(
      'no dead-man switch was reported. CRON_INVENTORY states that "a job in this table ' +
        'without a dead-man switch is a job that does not exist", and an empty list here says ' +
        'nothing is firing where the true statement is that nothing is being watched',
    );

  const jobs = new Set<string>();
  for (const switchRow of snapshot.deadManSwitches) {
    if (switchRow.job === '')
      throw new InternalOpsError('a dead-man switch was reported for an unnamed job');
    if (jobs.has(switchRow.job))
      throw new InternalOpsError(
        `dead-man switch for \`${switchRow.job}\` was reported twice. Two states for one job ` +
          'name neither, and one of them is the one that says it is firing',
      );
    jobs.add(switchRow.job);
    if (!(DEAD_MAN_SEVERITIES as readonly string[]).includes(switchRow.severity))
      throw new InternalOpsError(
        `\`${switchRow.job}\` carries severity \`${String(switchRow.severity)}\`, which is not ` +
          `one of ${DEAD_MAN_SEVERITIES.join(' | ')}. CRON_INVENTORY's column is those three`,
      );
    if (switchRow.expected_by === '')
      throw new InternalOpsError(
        `\`${switchRow.job}\` carries no expected-by time. CRON_INVENTORY's rule is that "every ` +
          'row below therefore has an expected-by time, and the absence of the completion ' +
          'signal by that time is itself an alert", so a switch without one watches nothing',
      );
    if (switchRow.last_completed_at !== null)
      assertInstant(`\`${switchRow.job}\`'s last_completed_at`, switchRow.last_completed_at);
  }

  return {
    queues: snapshot.queues,
    dead_man_switches: snapshot.deadManSwitches,
    firing: snapshot.deadManSwitches.filter((s) => s.firing).length,
  };
}

// -----------------------------------------------------------------------------
// `GET /internal/recon/status`
// -----------------------------------------------------------------------------

/**
 * `reconciliations.our_source`'s CHECK, transcribed from `0014_marks.sql`.
 *
 * `SD-M2-06`'s whole point is that a mismatch names the two documents that
 * disagreed, and `our_source` is which of Merit's own two derivations was
 * compared. A row that cannot say which is a five-hour diagnosis (`FM-M2-08`).
 */
export const RECON_SOURCES = ['rule_state', 'ledger'] as const;

/** One of {@link RECON_SOURCES}. */
export type ReconSource = (typeof RECON_SOURCES)[number];

/**
 * One open mismatch, as the port hands it over.
 *
 * MONEY IS `bigint` HERE AND A JSON INTEGER ON THE WIRE. `our_balance_cents` and
 * `platform_balance_cents` are `bigint` columns in `0014`, the corpus rule is
 * integer cents with no floats in any financial path, and `centsToJson` is the
 * one conversion in this deployable that refuses past `Number.MAX_SAFE_INTEGER`
 * rather than serialising a wrong number.
 */
export interface ReconMismatchRow {
  readonly accountId: string;
  /** `YYYY-MM-DD`. */
  readonly tradingDay: string;
  readonly ourBalanceCents: bigint;
  readonly platformBalanceCents: bigint;
  readonly ourSource: ReconSource;
  /** `reconciliations.source_ingest_file_id`, nullable in the DDL. */
  readonly sourceIngestFileId: string | null;
  /** `reconciliations.created_at`. The instant the mismatch was recorded. */
  readonly openedAt: string;
}

/**
 * What the port returns for `GET /internal/recon/status`.
 *
 * `asOf` IS THE PORT'S AND NOT A CLOCK THIS FILE READS, and that is the whole
 * reason the age is computable without a clock in a handler. Every age below is
 * measured against ONE instant, so the response is internally consistent: two
 * rows whose ages differ by a second differ because they opened a second apart
 * and not because the handler read the clock twice.
 */
export interface ReconSnapshot {
  readonly asOf: string;
  readonly openMismatches: readonly ReconMismatchRow[];
}

/** One open mismatch, as the response carries it. */
export interface ReconMismatch {
  readonly account_id: string;
  readonly trading_day: string;
  readonly our_balance_cents: number;
  readonly platform_balance_cents: number;
  /** `our - platform`, recomputed here. `0014` generates the column the same way. */
  readonly delta_cents: number;
  readonly our_source: ReconSource;
  readonly source_ingest_file_id: string | null;
  readonly opened_at: string;
  /** Whole seconds between `opened_at` and the snapshot's `as_of`. The row's age. */
  readonly age_seconds: number;
}

/** `GET /internal/recon/status`. */
export interface ReconStatusResponse {
  readonly as_of: string;
  /** Oldest first, because the oldest unresolved mismatch is the one that matters. */
  readonly open_mismatches: readonly ReconMismatch[];
}

/**
 * Render the recon status, refusing rather than guessing.
 *
 * FOUR OF THE FIVE REFUSALS BELOW ARE SHAPES THE DATABASE ITSELF CANNOT
 * PRODUCE, and they are checked anyway for `public-methods.ts`'s stated reason:
 * the source is an interface rather than the database. `0014` carries
 * `reconciliations_account_day_uq`, `reconciliations_status_matches_delta` and
 * `reconciliations_mismatch_names_sources`, and what reaches an operator here
 * is not "the query was wrong", it is a page saying the estate reconciles when
 * it does not.
 */
export function renderReconStatus(snapshot: ReconSnapshot): ReconStatusResponse {
  assertInstant('the recon snapshot as_of', snapshot.asOf);
  const asOf = new Date(snapshot.asOf).getTime();

  const seen = new Set<string>();
  const rows: ReconMismatch[] = [];
  for (const row of snapshot.openMismatches) {
    const address = `${row.accountId}/${row.tradingDay}`;
    if (seen.has(address))
      throw new InternalOpsError(
        `two open mismatches were reported for \`${address}\`. ` +
          '`reconciliations_account_day_uq` makes the pair unique, so the pair is the address ' +
          'of one reconciliation and two answers to it name neither',
      );
    seen.add(address);

    if (!isCalendarDay(row.tradingDay))
      throw new InternalOpsError(
        `\`${row.accountId}\` carries trading day \`${row.tradingDay}\`, which is not a ` +
          'YYYY-MM-DD calendar date',
      );
    if (!(RECON_SOURCES as readonly string[]).includes(row.ourSource))
      throw new InternalOpsError(
        `\`${address}\` names our source as \`${String(row.ourSource)}\`, which is not one of ` +
          `${RECON_SOURCES.join(' | ')}. \`reconciliations_mismatch_names_sources\` requires a ` +
          'mismatch to name which of the two internal derivations disagreed (SD-M2-06)',
      );
    if (row.ourBalanceCents === row.platformBalanceCents)
      throw new InternalOpsError(
        `\`${address}\` is reported as an open mismatch and its two balances are equal at ` +
          `${row.ourBalanceCents.toString()} cents. \`reconciliations_status_matches_delta\` ` +
          'refuses exactly that row, and publishing it here would put a zero delta on the page ' +
          'an operator reads to decide whether the estate reconciles',
      );

    assertInstant(`\`${address}\`'s opened_at`, row.openedAt);
    const ageSeconds = Math.floor((asOf - new Date(row.openedAt).getTime()) / 1000);
    if (ageSeconds < 0)
      throw new InternalOpsError(
        `\`${address}\` opened at ${row.openedAt}, which is after the snapshot's as_of of ` +
          `${snapshot.asOf}. A negative age is a clock disagreement, and this row's whole ` +
          'purpose is the age',
      );

    rows.push({
      account_id: row.accountId,
      trading_day: row.tradingDay,
      our_balance_cents: centsToJson(row.ourBalanceCents),
      platform_balance_cents: centsToJson(row.platformBalanceCents),
      // RECOMPUTED, NEVER CARRIED. `0014` declares `delta_cents` GENERATED
      // ALWAYS AS (our - platform) STORED "so the two sides and their
      // difference can never disagree". A port that supplied all three could.
      delta_cents: centsToJson(row.ourBalanceCents - row.platformBalanceCents),
      our_source: row.ourSource,
      source_ingest_file_id: row.sourceIngestFileId,
      opened_at: row.openedAt,
      age_seconds: ageSeconds,
    });
  }

  // OLDEST FIRST, and the tie-break is the address so the order is total. An
  // unstable order on an operator page is a diff nobody can read.
  rows.sort(
    (a, b) =>
      b.age_seconds - a.age_seconds ||
      (a.account_id < b.account_id ? -1 : a.account_id > b.account_id ? 1 : 0) ||
      (a.trading_day < b.trading_day ? -1 : a.trading_day > b.trading_day ? 1 : 0),
  );

  return { as_of: snapshot.asOf, open_mismatches: rows };
}

// -----------------------------------------------------------------------------
// `POST /internal/batch/run`
// -----------------------------------------------------------------------------

/**
 * The request body.
 *
 * BOTH HALVES OF THE ANCHOR ARE REQUIRED AND THAT IS THE FAIL-CLOSED READING OF
 * A CONTRACT PHRASE. Section 9 says "idempotent per `(trading_day, run_id)`". An
 * anchor is a pair or it is not an anchor: with `run_id` optional, every call
 * that omitted it would be a fresh run under an incomplete key, and the
 * idempotency the contract promises would hold for exactly the callers who did
 * not need it. `run_id` is the caller's to choose on a trigger and names the
 * existing run on a resume, which is what "manually trigger or resume" is.
 *
 * `reason` IS THE CONTRACT'S OWN WORD. "requires `reason`", on the same footing
 * as `GET /admin/evidence/:accountId`'s required `?reason=`.
 */
export interface BatchRunRequest {
  /** `YYYY-MM-DD`. The day the batch is being run for. */
  readonly trading_day: string;
  /** The run this call names. Half the idempotency anchor. */
  readonly run_id: string;
  /** Why an operator is triggering a batch by hand. Required, and never blank. */
  readonly reason: string;
}

/**
 * What happened.
 *
 * THE THREE MEMBERS MAP ONE TO ONE ONTO `packages/queue`'s `enqueue` CONTRACT,
 * which returns "the job's id, or `null` when `key` matched a job already
 * queued" and whose own comment insists that null "is a SUCCESS and not a
 * failure". `started` and `resumed` carry a job id; `duplicate` carries none,
 * because the anchor deduplicated against a run already queued.
 */
export const BATCH_RUN_OUTCOMES = ['started', 'resumed', 'duplicate'] as const;

/** One of {@link BATCH_RUN_OUTCOMES}. */
export type BatchRunOutcome = (typeof BATCH_RUN_OUTCOMES)[number];

/** What the port is asked to do. The validated request, in this codebase's casing. */
export interface BatchRunCommand {
  readonly tradingDay: string;
  readonly runId: string;
  readonly reason: string;
}

/** What the port reports back. */
export interface BatchRunResult {
  readonly outcome: BatchRunOutcome;
  /** The queue's job id, or `null` for a `duplicate`. */
  readonly jobId: string | null;
}

/** `POST /internal/batch/run`. */
export interface BatchRunResponse {
  readonly trading_day: string;
  readonly run_id: string;
  readonly reason: string;
  readonly outcome: BatchRunOutcome;
  readonly job_id: string | null;
}

/**
 * The status every arm of this route answers with.
 *
 * ONE STATUS FOR ALL THREE OUTCOMES, which is the contract's own idempotency
 * semantics: "replaying a key with an identical body returns the original
 * response verbatim". A `duplicate` that answered 200 where the first call
 * answered 202 would return a DIFFERENT response to the replay, which is the
 * thing that sentence forbids. 202 is the honest code besides: the batch runs
 * on the worker and this route has accepted a request rather than completed a
 * run.
 */
export const BATCH_RUN_ACCEPTED = 202;

/**
 * A `run_id`'s alphabet and bound.
 *
 * BOUNDED BECAUSE IT IS HALF OF A PRIMARY KEY. The anchor is a stored pair in
 * whatever the wiring slice indexes it in, and an unbounded caller-supplied
 * string is a key nobody can index and a log line nobody can read. The alphabet
 * is what a job key can be on either queue backend, which is ADR-006's
 * containment criterion applied to the one field a caller chooses.
 */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

type Validated<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly FieldError[] };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Validate the batch-run body.
 *
 * UNKNOWN FIELDS ARE IGNORED AND NOT REFUSED, on API_CONTRACT section 12's own
 * row for a client-supplied price: "field ignored; server price used". That is
 * what lets M02's `from_stage`, which API_CONTRACT does not carry, be sent by a
 * future client without this route inventing a meaning for it.
 */
export function validateBatchRunRequest(body: unknown): Validated<BatchRunRequest> {
  const row = asRecord(body);
  if (row === null) return { ok: false, errors: [{ path: '', message: 'must be a JSON object' }] };

  const errors: FieldError[] = [];
  const tradingDay = row['trading_day'];
  const runId = row['run_id'];
  const reason = row['reason'];

  if (typeof tradingDay !== 'string' || !isCalendarDay(tradingDay))
    errors.push({ path: 'trading_day', message: 'must be a YYYY-MM-DD calendar date' });
  if (typeof runId !== 'string' || !RUN_ID.test(runId))
    errors.push({
      path: 'run_id',
      message:
        'must be 1 to 64 characters of letters, digits, dot, underscore, colon or hyphen, ' +
        'starting with a letter or digit',
    });
  // TRIMMED BEFORE THE TEST, so " " is a missing reason rather than a present
  // one. "requires `reason`" is a requirement on the word an operator wrote,
  // and a space satisfies a length check while explaining nothing.
  if (typeof reason !== 'string' || reason.trim() === '')
    errors.push({ path: 'reason', message: 'is required and must not be blank' });

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      trading_day: tradingDay as string,
      run_id: runId as string,
      reason: (reason as string).trim(),
    },
  };
}

/**
 * Render the batch-run response, refusing rather than guessing.
 *
 * THE TWO REFUSALS HERE ARE THE SHARPEST ASSERTIONS IN THIS FILE AND THEY ARE
 * MONEY-ADJACENT IN BOTH DIRECTIONS.
 *
 *   A `started` OR `resumed` WITH NO JOB ID is a trigger that reported success
 *   and enqueued nothing. That is the exact failure `RB-01` is opened for,
 *   arriving as a green response during an incident, and it is worse than an
 *   error because an operator who sees it stops looking.
 *
 *   A `duplicate` WITH A JOB ID is the idempotency claim broken: two jobs stand
 *   under one `(trading_day, run_id)` anchor, and a batch run is money on the
 *   transparency surface (ADR-122 rules `input_digest` over exactly this path).
 */
export function renderBatchRun(request: BatchRunRequest, result: BatchRunResult): BatchRunResponse {
  if (!(BATCH_RUN_OUTCOMES as readonly string[]).includes(result.outcome))
    throw new InternalOpsError(
      `the batch runner reported outcome \`${String(result.outcome)}\`, which is not one of ` +
        `${BATCH_RUN_OUTCOMES.join(' | ')}`,
    );
  if (result.outcome !== 'duplicate' && result.jobId === null)
    throw new InternalOpsError(
      `the batch runner reported \`${result.outcome}\` for ` +
        `(${request.trading_day}, ${request.run_id}) and no job id. A run that started with ` +
        'nothing enqueued is a trigger that reports success and does no work, which is the ' +
        'failure RB-01 exists for arriving as a 202',
    );
  if (result.outcome === 'duplicate' && result.jobId !== null)
    throw new InternalOpsError(
      `the batch runner reported \`duplicate\` for (${request.trading_day}, ${request.run_id}) ` +
        `and job id \`${result.jobId}\`. API_CONTRACT section 9 makes that pair the idempotency ` +
        'anchor, so a duplicate that produced a job is two runs standing under one anchor',
    );

  return {
    trading_day: request.trading_day,
    run_id: request.run_id,
    reason: request.reason,
    outcome: result.outcome,
    job_id: result.jobId,
  };
}

// -----------------------------------------------------------------------------
// The port
// -----------------------------------------------------------------------------

/**
 * Everything these four rows read or reach, as one interface.
 *
 * ONE PORT AND NOT FOUR, because the four rows are one operator surface served
 * by one deployment: a wiring slice that could supply the recon read and not
 * the health probe would be a deployment that has not been finished, and this
 * file answers that the same way whichever method is missing. Four setters
 * would buy the ability to half-wire the operator console, which is not an
 * ability anybody has asked for.
 *
 * `runBatch` IS THE ONE THAT WRITES AND IT IS DELIBERATELY NOT A QUEUE HANDLE.
 * See this file's header: `apps/api` declares no `@merit/queue`, and the
 * implementation this interface waits for opens a transaction, takes
 * `sqlExecutor('job-enqueue')` off it and enqueues INSIDE it.
 */
export interface InternalOpsSource {
  readDependencies(): Promise<readonly DependencyCheck[]>;
  readJobs(): Promise<JobsSnapshot>;
  readReconStatus(): Promise<ReconSnapshot>;
  runBatch(command: BatchRunCommand): Promise<BatchRunResult>;
}

/**
 * The source, held at module scope because a route module contributes DATA.
 *
 * `public-methods.ts` states the argument: `compose` hands a handler nothing but
 * the request, so a module cannot be given a dependency at composition time
 * without being RUN at composition time. The handler reads this at REQUEST time
 * rather than closing over it, so wiring order cannot capture the unset value.
 */
let source: InternalOpsSource | null = null;

/** Wire the source, or pass `null` to unwire it. The unwire direction is the suite's. */
export function setInternalOpsSource(next: InternalOpsSource | null): void {
  source = next;
}

/** What is wired, or `null`. */
export function internalOpsSource(): InternalOpsSource | null {
  return source;
}

/**
 * The wired source, or a throw naming the deployment.
 *
 * ONE PLACE, so the four handlers cannot answer an unset port four ways.
 */
function wired(row: string): InternalOpsSource {
  if (source === null)
    throw new InternalOpsError(
      `no internal ops source is wired, so \`${row}\` cannot answer. This is a deployment that ` +
        'has not been finished rather than a request that failed: the process that builds this ' +
        'server is what supplies one, and no retry against this process will ever succeed',
    );
  return source;
}

// -----------------------------------------------------------------------------
// The handlers
// -----------------------------------------------------------------------------

/**
 * A problem document with section 2's `errors[]`.
 *
 * THE THIRD COPY OF THIS SHAPE IN THIS DIRECTORY AND IT IS REPORTED RATHER THAN
 * REPAIRED. `auth.ts` and `checkout.ts` hold the first two and NEITHER exports
 * it; exporting one of them is an edit to a file this session does not hold.
 */
interface ProblemDocument extends Problem {
  readonly errors?: readonly FieldError[];
}

function sendValidationFailed(
  reply: FastifyReply,
  requestId: string,
  errors: readonly FieldError[],
): FastifyReply {
  const body: ProblemDocument = { ...problem('validation_failed', 400, requestId), errors };
  return reply.code(body.status).type(PROBLEM_MEDIA_TYPE).send(body);
}

/** `GET /internal/health/deep`. */
export const deepHealthHandler: RouteHandler = async () =>
  renderDeepHealth(await wired(`GET ${DEEP_HEALTH_PATH}`).readDependencies());

/** `GET /internal/jobs`. */
export const jobsHandler: RouteHandler = async () =>
  renderJobs(await wired(`GET ${JOBS_PATH}`).readJobs());

/** `GET /internal/recon/status`. */
export const reconStatusHandler: RouteHandler = async () =>
  renderReconStatus(await wired(`GET ${RECON_STATUS_PATH}`).readReconStatus());

/**
 * `POST /internal/batch/run`.
 *
 * THE VALIDATION RUNS BEFORE THE PORT IS EVEN LOOKED UP. A malformed trigger is
 * a 400 whether or not the deployment is wired, and reaching the port first
 * would make an incident-time typo answer 500 on an unwired process and 400 on
 * a wired one, which is two answers to one request.
 */
export const batchRunHandler: RouteHandler = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const validated = validateBatchRunRequest(request.body);
  if (!validated.ok) return sendValidationFailed(reply, request.id, validated.errors);

  const body = validated.value;
  const result = await wired(`POST ${BATCH_RUN_PATH}`).runBatch({
    tradingDay: body.trading_day,
    runId: body.run_id,
    reason: body.reason,
  });
  return reply.code(BATCH_RUN_ACCEPTED).send(renderBatchRun(body, result));
};

// -----------------------------------------------------------------------------
// The module
// -----------------------------------------------------------------------------

/**
 * The four rows, in API_CONTRACT section 9's order.
 *
 * ONE ARRAY, and both the routes and the required-factor table are derived from
 * it, on `auth.ts`'s `requiredFactorTable` precedent: "derived from the same
 * array the routes are derived from, so the table and the registration cannot
 * disagree".
 */
export const INTERNAL_ENDPOINTS: readonly RouteDefinition[] = [
  { method: 'POST' as HttpMethod, path: BATCH_RUN_PATH, handler: batchRunHandler },
  { method: 'GET' as HttpMethod, path: RECON_STATUS_PATH, handler: reconStatusHandler },
  { method: 'GET' as HttpMethod, path: JOBS_PATH, handler: jobsHandler },
  { method: 'GET' as HttpMethod, path: DEEP_HEALTH_PATH, handler: deepHealthHandler },
];

/**
 * The declaration API_CONTRACT section 12 requires, keyed `METHOD /path`.
 *
 * IT IS A DECLARATION AND NOT AN ENFORCEMENT POINT, and this file's header says
 * what enforces it instead. A reviewer reading this table learns that all four
 * rows are the operator surface's; a reader who expected to find the check here
 * is answered by the header rather than by an absence.
 */
export const INTERNAL_REQUIRED_FACTORS: Readonly<Record<string, RequiredFactor>> =
  Object.fromEntries(
    INTERNAL_ENDPOINTS.map((route) => [`${route.method} ${route.path}`, OPERATOR_FACTOR]),
  );

export default defineRoutes({
  name: 'internal',
  routes: INTERNAL_ENDPOINTS,
});
