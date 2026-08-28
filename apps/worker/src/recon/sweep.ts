// =============================================================================
// apps/worker/src/recon/sweep.ts
// =============================================================================
// THE RECONCILIATION SWEEP: compare our end-of-day balance against the
// platform's stated one, account by account, for one trading day, and RECORD
// BOTH HALVES -- the run and what it found.
//
// `OVERVIEW` section 5.2 puts this stage inside the nightly batch by name
// ("W->>W: reconciliation: our EOD balance vs Rithmic stated") and `M02`'s
// `ST-M2-8` states its response: "Mismatch sets `recon_blocked`, alarms,
// excludes from eligibility." `M01`'s `FM-04` says the same from the engine's
// side. `0064_reconciliation_runs.sql` is the run record and this file is the
// producer it was written for.
//
// -----------------------------------------------------------------------------
// 1. WHAT WAS MEASURED BEFORE A LINE OF THIS WAS WRITTEN
// -----------------------------------------------------------------------------
// **NO RECONCILIATION RAN ANYWHERE IN THIS TREE, AND THE COMPARISON ITSELF WAS
// UNBUILT.** Not "the run record had no producer" -- the whole stage was absent.
// Derived from source at this commit rather than remembered, and pinned in
// `test/recon-sweep.test.ts` so it stays derived:
//
//   * NO module under `apps/*/src` or `packages/*/src` writes `reconciliations`
//     or `reconciliation_runs`. Every occurrence of either key outside this
//     directory is a READ (`apps/api/src/admin-source/liability.ts` folds open
//     mismatches, `apps/api/src/routes/internal.ts` renders them) or a
//     REGISTRATION (`packages/db/src/scope.ts`, `packages/db/src/schema.ts`).
//   * NOTHING SETS `accounts.recon_blocked`. Every occurrence in application
//     code reads it.
//   * `BatchWritePort.raiseReconciliation` IS A DIFFERENT CHANNEL AND IT WOULD
//     BE EASY TO MISTAKE FOR THIS ONE. `batch/ports.ts` declares it for `DO-3`:
//     "A failure does not throw: it returns an `AssertionFailure`, the batch
//     raises reconciliation, and NO STATE IS WRITTEN FOR THE DAY." That is the
//     fold REFUSING TO RUN. This file is the comparison, which runs after the
//     fold succeeded and disagrees with it. `batch/ports.ts` draws the same line
//     one register over between reconciliation and replay divergence, and no
//     adapter implements that port either.
//
// **SO HALF OF THIS FILE IS NEW AND THE OTHER HALF IS NEWER.** The producer for
// `0064` is what the dispatch asked for; the comparison it records the output of
// did not exist, and a producer that wrote the run row alone would have made
// `integrations.recon.last_run_at` truthful and the panel useless -- a clock
// over a check nobody performed.
//
// -----------------------------------------------------------------------------
// 2. THE TWO SIDES, AND WHY THIS PAIR IS A REAL COMPARISON RATHER THAN A
//    TAUTOLOGY
// -----------------------------------------------------------------------------
// `reconciliations` names them: `our_balance_cents` beside
// `platform_balance_cents`, with `our_source` saying which of Merit's two
// derivations was used and `source_ingest_file_id` saying which file carried the
// vendor's number.
//
//   OURS       `rule_states.balance_cents` for the account-day. `our_source` is
//              `'rule_state'`, which is the only one of `SD-M2-06`'s two this
//              deployable can reach (`ports.ts` header section 3).
//   THEIRS     the LIVE `daily_marks` row's `closing_balance_cents`, and only
//              when `daily_marks.source` is one of
//              {@link PLATFORM_STATED_MARK_SOURCES}. `daily_marks` is
//              "the only input the rules engine reads" (`0014`) and a `report`
//              or `api` mark is the vendor's own number as it arrived.
//
// **THE OBJECTION IS OBVIOUS AND IT IS ANSWERED BY THE SUPERSESSION RULE.**
// `packages/rules-engine/src/day/advance.ts` sets the state's balance to
// `mark.closingBalanceCents`, so on the day the fold ran the two sides are equal
// BY CONSTRUCTION and the comparison looks circular. It is not, because the mark
// the fold read and the mark that is LIVE NOW are different rows whenever a
// correction has landed: `0014`'s ruling 2 is "A CORRECTION PRODUCES A NEW MARK
// ROW AND POINTS THE OLD ONE AT IT. Never an UPDATE", and
// `daily_marks_live_per_account_day_uq` is `WHERE superseded_by IS NULL`. So a
// stored state folded from a superseded mark disagrees with the live one by
// exactly the correction, which is `FM-M2-08` -- "Our computed balance disagrees
// with the vendor's" -- arriving through the mechanism `0014` built for it. That
// is also `INV-04`'s neighbour and not `INV-04` itself: the replay self-audit
// recomputes from day one and compares against storage, and this compares
// storage against the vendor's latest word.
//
// **WHAT THIS PAIR CANNOT SEE IS NAMED RATHER THAN LEFT TO BE DISCOVERED.** A
// vendor number that was wrong when it arrived, was ingested, and was folded,
// agrees with itself here and always will. Catching that needs the LEDGER
// derivation, which is `SD-M2-06`'s second `our_source` and has no door in this
// deployable. `INV-M2-08`'s setpoint reconciliation, which `ST-M2-8` names in
// the same breath as this one, is a different subject entirely and is not built
// here.
//
// -----------------------------------------------------------------------------
// 3. THREE OUTCOMES AND NOT TWO. `uncomparable` IS THE ONE THAT MATTERS
// -----------------------------------------------------------------------------
// An account can fail to be comparable without anything being wrong with the
// balances, and collapsing that into either `match` or `mismatch` is a lie in a
// different direction each way. A `match` written for an account with no rule
// state is a clean bill of health for an account nobody folded; a `mismatch` is
// a `recon_blocked` for an account whose numbers nobody has disagreed about.
//
// So {@link compareBalances} returns {@link ReconVerdict} with an
// `uncomparable` arm, NO ROW IS WRITTEN for it, and the account does not count
// toward `accounts_done`. `reconciliation_runs_completed_is_whole` then does the
// rest by itself: the run cannot claim `completed`, and
// `reconciliation_runs_unhealthy_idx` surfaces it on the morning read.
//
// -----------------------------------------------------------------------------
// 4. WHAT THE THREE-STATE VOCABULARY COSTS, REPORTED AND NOT REPAIRED
// -----------------------------------------------------------------------------
// `0064` refused `'degraded'` because "a state with no producer is a vocabulary
// member nobody can write". **THIS FILE IS THAT PRODUCER AND IT IS THE CASE
// `degraded` WAS FOR.** One uncomparable account out of five thousand closes the
// whole night `failed`, which is the same word a sweep that died at account
// three gets. `detector_runs` splits them for a stated reason -- `SD-M7-01`, "a
// single failure state hides one inside the other" -- and this table cannot,
// because the member is a `CHECK` on a merged migration and only a superseding
// one moves it (constitution E2).
//
// The coarseness is chosen rather than suffered: of the three words `0064`
// allows, `failed` is the honest one, exactly as `DetectorDeclined` picks it one
// directory over ("`failed` is the honest one of the three, because the run did
// not produce an answer"). {@link ReconSweepReport} carries the per-account
// outcomes so the distinction survives in the report even where the column
// cannot hold it.
//
// -----------------------------------------------------------------------------
// 5. AN EMPTY POPULATION IS `failed`, AND THAT IS THIS FILE'S OTHER CONTROL
// -----------------------------------------------------------------------------
// `reconciliation_runs_completed_is_whole` is `status <> 'completed' OR
// accounts_done = accounts_total`, and at `0 of 0` IT IS SATISFIED VACUOUSLY. A
// night on which no ingest landed produces no live marks, and a producer that
// closed that run `completed` would write the exact row `0064`'s own reasoning
// warns about one column to the left: "a sweep over zero accounts is
// indistinguishable from a sweep that never looked".
//
// The database cannot close that hole -- `accounts_total > 0` is not a
// constraint `0064` carries, and adding one is a superseding migration this
// fence does not hold -- so the PRODUCER closes it: an empty population is
// {@link EMPTY_POPULATION_STATUS}. The run row still exists, with its clock and
// its `0 of 0`, and `reconciliation_runs_unhealthy_idx` puts it in front of
// whoever reads the morning list.
//
// -----------------------------------------------------------------------------
// 6. THE BLOCK IS SET AND IS NEVER CLEARED
// -----------------------------------------------------------------------------
// `0014_marks.sql`: a mismatch "sets accounts.recon_blocked = true and blocks
// eligibility until a HUMAN resolves it". Both halves are implemented, and the
// second one is implemented by NOT writing code: a `match` on a later day writes
// no `accounts` value at all, so a sweep can never lift a block an operator has
// not looked at. `reconciliations.status = 'resolved'` is the human's transition
// and `reconciliations_resolution_is_explained` requires a `resolved_by` and a
// `resolution_note` that a sweep does not have, so `ReconVerdict` has no path to
// it either.
//
// **THE CLEARING PATH DOES NOT EXIST ANYWHERE AND THAT IS REPORTED RATHER THAN
// BUILT.** No module in this tree writes `recon_blocked` in either direction,
// so the first account this sweep blocks stays blocked until somebody writes the
// operator's endpoint. That is a finding for the session log and not a reason to
// weaken the block, because the alternative -- a sweep that clears its own
// findings -- is the control deleting itself.
// =============================================================================

import {
  PLATFORM_STATED_MARK_SOURCES,
  RECON_SOURCE,
  type PlatformStatedMarkSource,
  type ReconRow,
  type ReconRunStatus,
  type ReconStatus,
  type ReconSweepIo,
  type ReconTx,
} from './ports.ts';

// -----------------------------------------------------------------------------
// The shapes
// -----------------------------------------------------------------------------

/** What the caller supplies per invocation. */
export interface ReconSweepConfig {
  /** The trading day being reconciled, `YYYY-MM-DD`. Never the day the sweep ran. */
  readonly tradingDay: string;
  /**
   * The nightly batch run this sweep is a stage of.
   *
   * **IT IS THE CALLER'S AND IT IS NEVER MINTED HERE, WHICH IS `0064`'s OWN
   * LANDMINE.** `reconciliation_runs.batch_run_id` is `uuid NOT NULL` with no
   * foreign key, because `EVENTS` section 5.3 declares that `run_id` in the
   * payloads of `batch.started`, `batch.completed` and `batch.failed` and no
   * table in this schema stores it. So "a producer writing a random uuid there
   * passes every check in this file", and the only defence available is that
   * this producer has no generator: the value arrives from the batch that
   * already holds it, and {@link runReconciliationSweep} refuses one that is not
   * a uuid rather than writing a plausible one.
   */
  readonly batchRunId: string;
}

/**
 * One account's two numbers, as {@link compareBalances} needs to see them.
 *
 * FLAT AND ALREADY EXTRACTED. The row reading happens in {@link readPopulation}
 * and throws named errors there, so the comparison itself has no parsing in it
 * and no way to turn a missing column into a balance.
 */
export interface ReconCandidate {
  readonly accountId: string;
  /** `daily_marks.source` on the LIVE mark. Not every value is the vendor's. */
  readonly markSource: string;
  /** The live mark's `closing_balance_cents`. Integer cents, never a `number`. */
  readonly platformBalanceCents: bigint;
  /** `daily_marks.ingest_file_id`. `SD-M2-06`'s vendor document. */
  readonly sourceIngestFileId: string | null;
  /** `rule_states.balance_cents`, or `null` when no state was stored for the day. */
  readonly ourBalanceCents: bigint | null;
}

/** Why an account could not be compared. Neither value is a balance disagreement. */
export type ReconUncomparableReason =
  /**
   * The live mark is not the platform speaking (`recomputed` or `simulated`).
   * `ports.ts`'s {@link PLATFORM_STATED_MARK_SOURCES} is why this is not a
   * `match`.
   */
  | 'mark_not_platform_stated'
  /**
   * No `rule_states` row for the account-day. The fold refused under `DO-3`, or
   * it has not run. Either way Merit has no number of its own to offer.
   */
  | 'no_rule_state';

/** The comparison's answer. */
export type ReconVerdict =
  | {
      readonly kind: 'compared';
      /** `'match'` or `'mismatch'`. `'resolved'` is the human's (`ports.ts`). */
      readonly status: Extract<ReconStatus, 'match' | 'mismatch'>;
      readonly ourBalanceCents: bigint;
      readonly platformBalanceCents: bigint;
      /** `0014`'s own GENERATED expression, `our - platform`. Reported, never written. */
      readonly deltaCents: bigint;
      readonly ourSource: typeof RECON_SOURCE;
      readonly sourceIngestFileId: string | null;
    }
  | { readonly kind: 'uncomparable'; readonly reason: ReconUncomparableReason };

/** What happened to one account. */
export type ReconOutcome =
  | {
      readonly accountId: string;
      readonly kind: 'compared';
      readonly status: Extract<ReconStatus, 'match' | 'mismatch'>;
      readonly deltaCents: bigint;
      /** `accounts.recon_blocked` was set by this outcome. True exactly on a mismatch. */
      readonly blocked: boolean;
    }
  | {
      readonly accountId: string;
      readonly kind: 'uncomparable';
      readonly reason: ReconUncomparableReason;
    }
  | {
      readonly accountId: string;
      readonly kind: 'failed';
      /** The message the write threw. This account counts toward neither counter. */
      readonly error: string;
    };

/** What one sweep reports to its caller. */
export interface ReconSweepReport {
  /**
   * `reconciliation_runs.id`.
   *
   * NEVER NULL AND NEVER OPTIONAL. A sweep that cannot open its run row THROWS
   * rather than comparing anything: comparisons nobody recorded, made by a run
   * nobody can see, are the state `0064` exists to make impossible.
   */
  readonly runId: string;
  readonly batchRunId: string;
  readonly tradingDay: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  /** What the run row was closed at, or would have been. */
  readonly status: ReconRunStatus;
  /** Accounts carrying a live mark on the day. `reconciliation_runs.accounts_total`. */
  readonly accountsTotal: number;
  /** Accounts actually compared AND recorded. `reconciliation_runs.accounts_done`. */
  readonly accountsDone: number;
  /** What THIS RUN saw. `reconciliation_runs.mismatches_found`. */
  readonly mismatchesFound: number;
  /** In `accountId` order, never in completion order. */
  readonly outcomes: readonly ReconOutcome[];
}

/**
 * The status a sweep over an empty population closes at. Header section 5.
 *
 * `'completed'` is available and is refused: the completion control is satisfied
 * vacuously at `0 of 0`, and a run row claiming a clean night for a day whose
 * ingest never landed is the one row this producer must never write.
 */
export const EMPTY_POPULATION_STATUS: ReconRunStatus = 'failed';

/** Raised by a sweep that was handed an argument it will not write. */
export class ReconSweepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReconSweepError';
  }
}

/** Raised when a row the accessor returned does not carry what the DDL declares. */
export class ReconRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReconRowError';
  }
}

// -----------------------------------------------------------------------------
// The pure half
// -----------------------------------------------------------------------------

/** `YYYY-MM-DD`, which is what `trading_day` is and what an equality filter needs. */
const TRADING_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `0007_accounts.sql`'s `uuid`, in the one shape PostgreSQL renders. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a `daily_marks.source` is the platform's own number. `ports.ts`. */
export function isPlatformStated(source: string): source is PlatformStatedMarkSource {
  return (PLATFORM_STATED_MARK_SOURCES as readonly string[]).includes(source);
}

/**
 * Compare one account's two balances.
 *
 * PURE. No I/O, no clock, no port, and no floats: both sides are `bigint`
 * because every `*_cents` column involved is `bigint` and the Drizzle
 * declarations pin `{ mode: 'bigint' }`. A subtraction on `number` would lose
 * digits above 2^53 silently, and a balance is money.
 *
 * THE TWO REFUSALS COME BEFORE THE ARITHMETIC AND THEIR ORDER IS DELIBERATE.
 * The mark is checked first: "did the platform state a number at all" is prior
 * to "do we have one to compare against it", because a recomputed mark means
 * there is nothing to reconcile WITH, whatever Merit computed.
 */
export function compareBalances(candidate: ReconCandidate): ReconVerdict {
  if (!isPlatformStated(candidate.markSource)) {
    return { kind: 'uncomparable', reason: 'mark_not_platform_stated' };
  }
  if (candidate.ourBalanceCents === null) {
    return { kind: 'uncomparable', reason: 'no_rule_state' };
  }

  const deltaCents = candidate.ourBalanceCents - candidate.platformBalanceCents;

  // `reconciliations_status_matches_delta`: a match has a zero delta and a
  // mismatch does not, by construction rather than by this function's care. The
  // database re-derives `delta_cents` as a GENERATED column, so a status written
  // here that disagreed with the two balances beside it is a `23514` rather than
  // a bad row.
  return {
    kind: 'compared',
    status: deltaCents === 0n ? 'match' : 'mismatch',
    ourBalanceCents: candidate.ourBalanceCents,
    platformBalanceCents: candidate.platformBalanceCents,
    deltaCents,
    // WRITTEN ON A MATCH TOO, although `reconciliations_mismatch_names_sources`
    // only requires it off `'match'`. A match whose source is null is a row that
    // cannot say which of Merit's two derivations agreed, which is the same
    // five-hour diagnosis `SD-M2-06` exists to prevent, arriving a day later.
    ourSource: RECON_SOURCE,
    sourceIngestFileId: candidate.sourceIngestFileId,
  };
}

// -----------------------------------------------------------------------------
// Reading rows, which is where a missing column becomes an error instead of a
// balance
// -----------------------------------------------------------------------------

function asRow(key: string, value: unknown): ReconRow {
  if (typeof value !== 'object' || value === null) {
    throw new ReconRowError(`${key} returned a row that is not an object`);
  }
  return value as ReconRow;
}

function requireString(key: string, row: ReconRow, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ReconRowError(`${key}.${field} is not a non-empty string`);
  }
  return value;
}

function optionalString(key: string, row: ReconRow, field: string): string | null {
  const value = row[field];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new ReconRowError(`${key}.${field} is neither null nor a string`);
  }
  return value;
}

/**
 * One `*_cents` column, and a `number` is REFUSED rather than coerced.
 *
 * `sweeps/ports.ts` states the rule for the same reason one directory over: a
 * `number` arriving here means the handle is not the accessor and the value may
 * already have lost digits. Money is integer cents and nothing in this path may
 * see a float.
 */
function requireCents(key: string, row: ReconRow, field: string): bigint {
  const value = row[field];
  if (typeof value !== 'bigint') {
    throw new ReconRowError(
      `${key}.${field} is ${typeof value} and money is integer cents: the column is bigint and ` +
        'the accessor pins { mode: "bigint" }, so anything else has already lost digits.',
    );
  }
  return value;
}

// -----------------------------------------------------------------------------
// The population, read as two windows and joined here
// -----------------------------------------------------------------------------

/**
 * Every account carrying a live mark on the day, with both numbers attached.
 *
 * TWO WINDOW READS AND A JOIN IN MEMORY, which is `ADR-157` section 5's granted
 * shape: the accessor has no join and no projection, so the sweep pulls the
 * day's live marks and the day's rule states and matches them by `account_id`
 * here. The cost is named rather than waved at -- the rows crossing the boundary
 * are the DAY's rather than the mismatch's -- and it is bounded by one trading
 * day in both cases.
 *
 * **THE MARK READ CARRIES `ADR-157`'s `IS NULL` TERM AND THAT IS WHAT MAKES IT
 * THE LIVE MARK.** `daily_marks_live_per_account_day_uq` is `(account_id,
 * trading_day) WHERE superseded_by IS NULL`, so "live" is that predicate; a read
 * without it would pull every superseded correction and force this function to
 * re-derive the index's own rule by hand.
 */
async function readPopulation(
  tx: ReconTx,
  io: ReconSweepIo,
  tradingDay: string,
): Promise<readonly ReconCandidate[]> {
  const markRows = await tx.rowsWhere('dailyMarks', {
    tradingDay,
    supersededBy: io.terms.isNull(),
  });
  const stateRows = await tx.rowsWhere('ruleStates', { tradingDay });

  const ours = new Map<string, bigint>();
  for (const raw of stateRows) {
    const row = asRow('ruleStates', raw);
    ours.set(
      requireString('ruleStates', row, 'accountId'),
      requireCents('ruleStates', row, 'balanceCents'),
    );
  }

  const candidates: ReconCandidate[] = [];
  for (const raw of markRows) {
    const row = asRow('dailyMarks', raw);
    const accountId = requireString('dailyMarks', row, 'accountId');
    candidates.push({
      accountId,
      markSource: requireString('dailyMarks', row, 'source'),
      platformBalanceCents: requireCents('dailyMarks', row, 'closingBalanceCents'),
      sourceIngestFileId: optionalString('dailyMarks', row, 'ingestFileId'),
      ourBalanceCents: ours.get(accountId) ?? null,
    });
  }

  // SORTED BY ACCOUNT, WHICH IS THE REPORT'S ORDER AND NOT A TIDINESS. Two runs
  // over identical data must produce identical reports, because the first thing
  // anybody does with a mismatch list is diff it against yesterday's.
  return candidates.sort((a, b) =>
    a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0,
  );
}

// -----------------------------------------------------------------------------
// The writes, and there are exactly four shapes of them
// -----------------------------------------------------------------------------

interface OpenRunValues {
  readonly batchRunId: string;
  readonly tradingDay: string;
  readonly startedAt: Date;
  readonly accountsTotal: number;
}

/**
 * Write the run row at the START of the sweep, and return its id.
 *
 * `0064`: `started_at` is `NOT NULL` where `detector_runs`' pair is nullable,
 * because "the row is created BY the start of the sweep". `accounts_done` and
 * `mismatches_found` are left to their defaults, which are zero and which is
 * what they truly are at this instant.
 */
async function openRun(tx: ReconTx, values: OpenRunValues): Promise<string> {
  const written = await tx.insert('reconciliationRuns', {
    batchRunId: values.batchRunId,
    tradingDay: values.tradingDay,
    startedAt: values.startedAt,
    accountsTotal: values.accountsTotal,
    accountsDone: 0,
    mismatchesFound: 0,
    // `reconciliation_runs_finished_when_not_running` is an EQUIVALENCE, so
    // `'running'` and a null `finished_at` are one fact written once. The column
    // is left unset rather than set to null for the same reason.
    status: 'running' satisfies ReconRunStatus,
  });
  const row = written[0];
  if (typeof row !== 'object' || row === null) {
    throw new ReconRowError('reconciliation_runs insert returned no row');
  }
  const id = (row as ReconRow)['id'];
  if (typeof id !== 'string' || id.length === 0) {
    throw new ReconRowError(
      'reconciliation_runs insert returned no id. Every later write in this sweep addresses the ' +
        'run by it, and a sweep that cannot address its own run row can never close it.',
    );
  }
  return id;
}

/**
 * Record one comparison, INSERTING or UPDATING as the unique key requires.
 *
 * `reconciliations_account_day_uq` is `(account_id, trading_day)`, so a
 * REDELIVERED day -- `RB-02` section A's remedy -- reconciles an account that
 * already has a row, and the second comparison is an UPDATE. `0064` refused a
 * unique index on its own `trading_day` for the same runbook sentence, and this
 * is the other side of that ruling: the RUN is a list per day and the
 * COMPARISON is one row per account per day.
 *
 * **THE UPDATE IS ADDRESSED BY `id` AND NOT BY THE NATURAL KEY, AND THAT IS A
 * MEASUREMENT RATHER THAN A STYLE.** The obvious address is `{accountId,
 * tradingDay}` and the accessor REFUSES it -- executed against a live database
 * before this line was written, message quoted verbatim:
 *
 *   `a write to reconciliations must name a row. [account_id, trading_day]`
 *   `contains no unique key reconciliations declares, so this predicate can`
 *   `match more than one row. Declared: (id).`
 *
 * `uniqueKeys` in `packages/db/src/scoped-db.ts` derives its roster from the
 * DRIZZLE DECLARATION -- inline and table-level primary keys, inline `.unique()`
 * and table-level unique constraints -- and `reconciliations_account_day_uq` is
 * a `CREATE UNIQUE INDEX`, which is none of those four. That is not this table's
 * gap: `schema.ts` carries NO `uniqueIndex` declaration at all, and the
 * migrations create SIXTY-ONE unique indexes of which THIRTY-THREE are
 * unconditional. So no unique INDEX in this estate is addressable, which is
 * reported rather than repaired -- that file is `P5-a`'s and no slice here moves
 * it.
 *
 * Addressing by the primary key costs nothing and is stronger: the row was just
 * read on THIS transaction, so its `id` is the row the check found rather than
 * whatever the predicate would match on re-evaluation.
 *
 * **THE READ AND THE WRITE ARE ON THE SAME OPEN TRANSACTION**, so the existence
 * check cannot race with the write it guards.
 */
async function recordComparison(
  tx: ReconTx,
  accountId: string,
  tradingDay: string,
  verdict: Extract<ReconVerdict, { kind: 'compared' }>,
  now: Date,
): Promise<void> {
  const values = {
    ourBalanceCents: verdict.ourBalanceCents,
    platformBalanceCents: verdict.platformBalanceCents,
    status: verdict.status,
    ourSource: verdict.ourSource,
    sourceIngestFileId: verdict.sourceIngestFileId,
    updatedAt: now,
  };

  const existing = await tx.rowsWhere('reconciliations', { accountId, tradingDay });
  if (existing.length === 0) {
    await tx.insert('reconciliations', { accountId, tradingDay, ...values });
    return;
  }
  if (existing.length > 1) {
    throw new ReconRowError(
      `reconciliations holds ${existing.length} rows for one account-day, which ` +
        'reconciliations_account_day_uq forbids. The sweep refuses rather than picking one.',
    );
  }
  const id = asRow('reconciliations', existing[0])['id'];
  if (typeof id !== 'bigint') {
    throw new ReconRowError(
      `reconciliations.id is ${typeof id} and the column is bigint GENERATED ALWAYS AS IDENTITY.`,
    );
  }
  // `delta_cents` IS NOT WRITTEN IN EITHER BRANCH. It is `GENERATED ALWAYS AS
  // (our_balance_cents - platform_balance_cents) STORED`, so writing it is an
  // error rather than a duplication, and the two sides and their difference can
  // never disagree.
  //
  // `resolved_by` AND `resolution_note` ARE NOT WRITTEN AND NOT CLEARED. A
  // redelivery that re-finds a mismatch a human already resolved must not erase
  // what they wrote; that transition is theirs.
  await tx.updateAt('reconciliations', { id }, values);
}

/**
 * `0014_marks.sql`, and `M02`'s `ST-M2-8`: a mismatch blocks the account.
 *
 * ONE COLUMN, ONE DIRECTION, AND NEVER THE OTHER. Header section 6. There is no
 * branch in this function because there is no case in which a sweep sets this to
 * `false`.
 */
async function blockAccount(tx: ReconTx, accountId: string, now: Date): Promise<void> {
  await tx.updateAt('accounts', { id: accountId }, { reconBlocked: true, updatedAt: now });
}

interface CloseRunValues {
  readonly finishedAt: Date;
  readonly accountsDone: number;
  readonly mismatchesFound: number;
  readonly status: ReconRunStatus;
}

/**
 * Close the run row at the END of the sweep.
 *
 * `0064`: the record is mutable on purpose, written at the start and updated at
 * the end, because that is what makes a run that started and never finished
 * distinguishable from a run that never started at all. A sweep whose process
 * dies never reaches this function, and the row it left at `'running'` with an hours-old
 * `started_at` is the only way that crash is visible at all.
 */
async function closeRun(tx: ReconTx, runId: string, values: CloseRunValues): Promise<void> {
  await tx.updateAt(
    'reconciliationRuns',
    { id: runId },
    {
      finishedAt: values.finishedAt,
      accountsDone: values.accountsDone,
      mismatchesFound: values.mismatchesFound,
      status: values.status,
      updatedAt: values.finishedAt,
    },
  );
}

// -----------------------------------------------------------------------------
// The run
// -----------------------------------------------------------------------------

/**
 * Reconcile one trading day, and record both the run and what it found.
 *
 * **ONE TRANSACTION TO READ THE POPULATION, ONE TO OPEN THE RUN, ONE PER
 * ACCOUNT, AND ONE TO CLOSE.** `OVERVIEW` section 5.2 requires the split:
 * "Any stage failing leaves prior stages committed per account and the batch
 * resumable at the account boundary, so a crash at account 2,341 of 5,000
 * resumes without double-applying a day." A single transaction around the sweep
 * would also make `0064`'s `'running'` state unreachable, because the row
 * written at the start would become visible only when the row written at the end
 * committed with it.
 *
 * **ONE ACCOUNT'S FAILURE NEVER STOPS ANOTHER'S**, on the detector runner's
 * reasoning: a sweep that aborted on the first bad account would leave the
 * estate one known problem and four thousand nine hundred unexamined ones, and
 * the run row would say `failed` either way.
 */
export async function runReconciliationSweep(
  config: ReconSweepConfig,
  io: ReconSweepIo,
): Promise<ReconSweepReport> {
  if (!TRADING_DAY.test(config.tradingDay)) {
    throw new ReconSweepError(
      `tradingDay ${JSON.stringify(config.tradingDay)} is not YYYY-MM-DD. It is the equality ` +
        'filter both window reads narrow on, so a malformed day matches nothing and would close a ' +
        'run over an empty population rather than failing here.',
    );
  }
  if (!UUID.test(config.batchRunId)) {
    throw new ReconSweepError(
      `batchRunId ${JSON.stringify(config.batchRunId)} is not a uuid. ` +
        'reconciliation_runs.batch_run_id is NOT NULL with no foreign key, because no batch run ' +
        'is a row in this schema, so nothing downstream can tell a wrong value from a right one ' +
        'and this refusal is the only check there is.',
    );
  }

  const startedAt = io.now();

  const population = await io.transact((tx) => readPopulation(tx, io, config.tradingDay));
  const accountsTotal = population.length;

  const runId = await io.transact((tx) =>
    openRun(tx, {
      batchRunId: config.batchRunId,
      tradingDay: config.tradingDay,
      startedAt,
      accountsTotal,
    }),
  );

  const outcomes: ReconOutcome[] = [];
  let accountsDone = 0;
  let mismatchesFound = 0;

  for (const candidate of population) {
    const verdict = compareBalances(candidate);
    if (verdict.kind === 'uncomparable') {
      outcomes.push({
        accountId: candidate.accountId,
        kind: 'uncomparable',
        reason: verdict.reason,
      });
      continue;
    }

    try {
      // THE FINDING AND ITS CONSEQUENCE COMMIT TOGETHER OR NOT AT ALL. A
      // `mismatch` row without the block is an account excluded from nothing,
      // and a block without the row is an account nobody can explain.
      await io.transact(async (tx) => {
        const now = io.now();
        await recordComparison(tx, candidate.accountId, config.tradingDay, verdict, now);
        if (verdict.status === 'mismatch') {
          await blockAccount(tx, candidate.accountId, now);
        }
      });
    } catch (error) {
      outcomes.push({
        accountId: candidate.accountId,
        kind: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    accountsDone += 1;
    if (verdict.status === 'mismatch') mismatchesFound += 1;
    outcomes.push({
      accountId: candidate.accountId,
      kind: 'compared',
      status: verdict.status,
      deltaCents: verdict.deltaCents,
      blocked: verdict.status === 'mismatch',
    });
  }

  // Header section 5. `completed` requires that the sweep covered its own
  // population AND that the population was not empty; the constraint enforces
  // the first half and this line is the whole of the second.
  const status: ReconRunStatus =
    accountsTotal === 0
      ? EMPTY_POPULATION_STATUS
      : accountsDone === accountsTotal
        ? 'completed'
        : 'failed';

  const finishedAt = io.now();
  await io.transact((tx) =>
    closeRun(tx, runId, { finishedAt, accountsDone, mismatchesFound, status }),
  );

  return {
    runId,
    batchRunId: config.batchRunId,
    tradingDay: config.tradingDay,
    startedAt,
    finishedAt,
    status,
    accountsTotal,
    accountsDone,
    mismatchesFound,
    outcomes,
  };
}
