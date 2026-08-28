// =============================================================================
// apps/worker/src/recon/ports.ts
// =============================================================================
// THE RECONCILIATION SWEEP'S I/O BOUNDARY. `detectors/ports.ts`,
// `sweeps/ports.ts`, `batch/ports.ts` and `provisioning/ports.ts` are the idiom
// and the reason is `ADR-165`'s: it rules ONE door and ONE acquisition point,
// `src/db.ts`, and `test/db.test.ts` walks this deployable's `src/` tree to
// assert that `@merit/db` occurs in that one file. So every shape here is
// DECLARED structurally and SATISFIED structurally: `@merit/db`'s `SystemTx` is
// assignable to {@link ReconTx} with no import in either direction.
//
// NOTHING HERE ADDS A `SystemReason` MEMBER, ADDS A `SqlExecutorReason` MEMBER,
// IMPORTS `pg`, OR CASTS PAST A KEY TYPE.
//
// -----------------------------------------------------------------------------
// 1. THE DOOR, MEASURED RATHER THAN ASSUMED, AND IT DECIDES WHICH DEPLOYABLE
//    THIS FILE LIVES IN
// -----------------------------------------------------------------------------
// The sweep writes TWO tables and they are in two different scope classes, and
// that pair is what puts this module in `apps/worker` rather than in `apps/api`.
//
//   `reconciliation_runs`  `firm` (`packages/db/src/scope.ts`). Reachable
//                          through `apps/api/src/db.ts`'s `firm` door AND
//                          through this deployable's `batch` door.
//   `reconciliations`      `derived` through `account_id`. NOT a `FirmTableKey`,
//                          so `apps/api`'s `firm` door cannot name it and its
//                          `scoped` door needs an identity a sweep over the
//                          whole population does not have. `routes/internal.ts`
//                          states exactly this about itself and calls the
//                          missing handle `system('operator-console')`, which
//                          `apps/api/src/db.ts` deliberately does not open.
//
// So `apps/api` can write the CLOCK and cannot write the FINDING, and a producer
// that lived there would be the defect this slice exists to avoid, wearing the
// shape of a fence. `src/db.ts`'s `LIVE_DB.batch` yields a `SystemTx` at
// `systemDb('nightly-batch')`, whose `rowsWhere`, `insert` and `updateAt` are
// generic over `TableKey`, and `TableKey` contains both classes. THE DOOR IS
// THIS DEPLOYABLE'S AND IT IS ALREADY OPEN; nothing here widens it.
//
// -----------------------------------------------------------------------------
// 2. `updateAt` IS PRESENT HERE AND ABSENT FROM `DetectorTx`, AND THE DIFFERENCE
//    IS THE MIGRATION RATHER THAN A PREFERENCE
// -----------------------------------------------------------------------------
// `detectors/ports.ts` removes the addressed write so that `INV-M7-02` is a
// property of the type. This port cannot: `0064_reconciliation_runs.sql` makes
// the run record MUTABLE ON PURPOSE: it is written when the sweep starts and
// updated when it stops, which is what makes a run that started and never
// finished distinguishable from a run that never started at all. So the close is
// an `UPDATE` or the distinction the panel needs does not exist. `reconciliations_account_day_uq`
// forces the second one: `RB-02` section A sends a quarantined day to
// REDELIVERY, a redelivered day is reconciled again, and the unique key makes
// that second comparison an UPDATE of the row already there rather than a
// `23505` at 02:00.
//
// THE WRITE UNION IS THREE AND THE THIRD IS THE CONSEQUENCE. `accounts` is here
// because `0014_marks.sql`'s own header is "a 'mismatch' sets
// accounts.recon_blocked = true and blocks eligibility until a HUMAN resolves
// it", which `M01`'s `FM-04` states as the response to a vendor balance
// disagreeing with ours. A mismatch recorded without the block is a finding with
// no consequence, and a finding with no consequence is the defect shape a
// threshold with no window has.
//
// **THE SWEEP CAN SET THE BLOCK AND MUST NOT CLEAR IT**, and that asymmetry is
// the control rather than an oversight. "Until a HUMAN resolves it" means a
// match on a later day may not lift a block the operator has not looked at:
// {@link ReconValues} is opaque, so the type cannot forbid it, and
// `test/recon-sweep.test.ts` walks every value of every committed write instead.
//
// -----------------------------------------------------------------------------
// 3. `ourSource` IS ONE LITERAL AND THE OTHER HALF OF `SD-M2-06` IS UNREACHABLE
//    FROM HERE
// -----------------------------------------------------------------------------
// `0014_marks.sql` gives `reconciliations.our_source` two values, `'rule_state'`
// and `'ledger'`, and says why both exist: the two internal derivations "can
// disagree with each other as well as with the vendor, and a nightly alarm that
// does not say which pair diverged is a five-hour diagnosis instead of a
// five-minute one (FM-M2-08)."
//
// THE LEDGER DERIVATION HAS NO DOOR IN THIS DEPLOYABLE. `apps/worker/package.json`
// declares `@merit/db` and `@merit/rules-engine` and nothing else, and under
// `node-linker=isolated` an undeclared specifier does not resolve -- session 379
// found the same wall in front of `ExpirySweepIo.ledger` and reported it rather
// than adding the manifest line, because the admission list is `RI-08`'s and a
// manifest edit is not this fence.
//
// So {@link RECON_SOURCE} is the single literal `'rule_state'` rather than the
// union of two. A later slice that acquires the ledger reaches a COMPILE ERROR
// at every write site rather than a field it may quietly leave alone, which is
// the difference between an absence somebody decided and an absence somebody
// inherited.
// =============================================================================

// -----------------------------------------------------------------------------
// The tables, and no others
// -----------------------------------------------------------------------------

/**
 * The tables a reconciliation sweep may READ, as a closed union of three.
 *
 * A NARROW UNION RATHER THAN THE WHOLE KEY SPACE, on `detectors/ports.ts`'s and
 * `sweeps/ports.ts`'s argument: `SystemTx.rowsWhere` is declared over `TableKey`
 * and reaches every table in the estate with one word, and a port accepting the
 * same reach would spend `ADR-102` section 8's widening a second time for
 * nothing. A wider handle is assignable to a narrower shape, so the narrowing
 * costs the wiring nothing.
 *
 * **`accounts` IS NOT HERE AND ITS ABSENCE IS THE POPULATION RULING.** The
 * sweep's population is every account carrying a LIVE MARK on the day, which is
 * `daily_marks_live_per_account_day_uq`'s set, and it is `ST-M2-7`'s
 * completeness subject read from the side the vendor wrote. Reading `accounts`
 * to widen or narrow that set would be this port deciding which accounts the
 * vendor was supposed to have reported on, which is a different check with a
 * different remedy (`M02`'s completeness gap, `EC-047`: never synthesize a flat
 * day).
 */
export const RECON_READ_TABLES = ['dailyMarks', 'ruleStates', 'reconciliations'] as const;

/** One of {@link RECON_READ_TABLES}. */
export type ReconReadTable = (typeof RECON_READ_TABLES)[number];

/**
 * The tables a reconciliation sweep may WRITE, as a closed union of three.
 *
 * `reconciliationRuns` is `0064`'s record and this slice is its first producer.
 * `reconciliations` is the finding. `accounts` is the consequence, and header
 * section 2 is why it is here and what the suite has to watch instead of the
 * type.
 *
 * **NO OTHER TABLE IS WRITABLE AND THE ABSENCES ARE THE RULING.** `dailyMarks`
 * is absent because a reconciliation never corrects a mark: `0014`'s ruling 2 is
 * SUPERSESSION, NEVER UPDATE, and a sweep that adjusted the number it disagreed
 * with would erase the disagreement it was run to find. `riskFlags` is absent
 * because `M02` section 2 draws the line by name -- `recon_blocked` "is a
 * data-quality state, not an enforcement state ... it says 'we do not trust our
 * own numbers here', not 'we suspect this trader'". `events` is absent because
 * `EVENTS` section 5.3 carries `recon.mismatch_detected` and `recon.resolved`
 * and no `recon.completed`, which is `0064`'s own owed half and an amendment to
 * a frozen document rather than a line of code.
 */
export const RECON_WRITE_TABLES = ['reconciliationRuns', 'reconciliations', 'accounts'] as const;

/** One of {@link RECON_WRITE_TABLES}. */
export type ReconWriteTable = (typeof RECON_WRITE_TABLES)[number];

// -----------------------------------------------------------------------------
// The three closed vocabularies, transcribed from the DDL
// -----------------------------------------------------------------------------

/**
 * `reconciliation_runs.status`, as `0064_reconciliation_runs.sql` declares it.
 *
 * THREE AND NOT `detector_runs`' THREE. `0064` refuses `'degraded'` by name --
 * "`detector_runs` earns it from the synthetic battery (SD-M7-01), a control
 * this table has no analogue of, and a state with no producer is a vocabulary
 * member nobody can write". THIS FILE IS THAT PRODUCER ARRIVING, and
 * `sweep.ts`'s header section 4 reports what the absence now costs. It is
 * reported and NOT taken: the member is a `CHECK` on a merged migration and only
 * a superseding one moves it.
 */
export const RECON_RUN_STATUSES = ['running', 'completed', 'failed'] as const;

/** One of {@link RECON_RUN_STATUSES}. */
export type ReconRunStatus = (typeof RECON_RUN_STATUSES)[number];

/**
 * `reconciliations.status`, as `0014_marks.sql` declares it.
 *
 * **THE SWEEP WRITES TWO OF THE THREE AND `'resolved'` IS THE HUMAN'S.**
 * `reconciliations_resolution_is_explained` requires `resolved_by` and
 * `resolution_note` on that status, and neither is a value a sweep has: the
 * resolver is a person and the note is what they found. {@link ReconVerdict}
 * therefore has no path to it.
 */
export const RECON_STATUSES = ['match', 'mismatch', 'resolved'] as const;

/** One of {@link RECON_STATUSES}. */
export type ReconStatus = (typeof RECON_STATUSES)[number];

/**
 * The one `reconciliations.our_source` this deployable can name. Header
 * section 3.
 */
export const RECON_SOURCE = 'rule_state' as const;

/**
 * The `daily_marks.source` values that carry THE PLATFORM'S OWN NUMBER.
 *
 * **THIS IS THE FILE'S SHARPEST REFUSAL AND IT IS THE ONE THAT KEEPS THE PANEL
 * HONEST.** `0014_marks.sql` gives `daily_marks.source` four values -- `report`,
 * `api`, `recomputed`, `simulated` -- and only the first two are the vendor
 * speaking. `recomputed` is OURS, and `reconciliations.platform_balance_cents`
 * is the platform's stated balance, so comparing a rule state against a
 * recomputed mark compares Merit's number with Merit's number and produces a
 * `match` that means nothing whatever. A sweep that did it would report a clean
 * night for exactly the accounts whose vendor number never arrived, which is
 * `FM-M2-08` reported as its own opposite.
 *
 * `0014` corroborates the reading from the other side: `ingest_file_id` is
 * "Null when recomputed", and `reconciliations.source_ingest_file_id` is the
 * column that "records which file carried the VENDOR's number", so a mark with
 * no file has no vendor number to name. A mark outside this set is
 * {@link ReconUncomparable} and never a comparison.
 */
export const PLATFORM_STATED_MARK_SOURCES = ['report', 'api'] as const;

/** One of {@link PLATFORM_STATED_MARK_SOURCES}. */
export type PlatformStatedMarkSource = (typeof PLATFORM_STATED_MARK_SOURCES)[number];

// -----------------------------------------------------------------------------
// `ADR-157`'s terms, as this file must be able to name them
// -----------------------------------------------------------------------------

/**
 * One column's narrowing when it is not an equality, as `ADR-157` minted it.
 *
 * DECLARED AND NEVER CONSTRUCTED HERE, on `detectors/ports.ts`'s and
 * `sweeps/ports.ts`'s reasoning: `packages/db` keeps a module-private `WeakSet`
 * of the terms it minted and reads identity rather than shape, so a caller
 * cannot hand-roll one.
 */
export type ReconFilterTerm = { readonly term: 'is-null' };

/**
 * The ONE read-path constructor this sweep needs, supplied by the wiring.
 *
 * INJECTED RATHER THAN IMPORTED because a term is only a term if `packages/db`
 * minted it, and this app cannot import that package.
 *
 * **`isNull` IS NOT A CONVENIENCE HERE, IT IS THE WHOLE OF WHAT "LIVE" MEANS.**
 * `daily_marks_live_per_account_day_uq` is `(account_id, trading_day) WHERE
 * superseded_by IS NULL`, so the live mark is defined by that predicate and by
 * nothing else. A sweep that read every mark and filtered in memory would pull
 * every superseded correction across the boundary and would have to re-derive
 * the index's own predicate by hand. `ADR-157` admits `IS NULL` on the READ path
 * by name, so this is the granted shape rather than a widening.
 *
 * **THERE IS NO RANGE TERM AND NONE IS REACHED FOR.** Every other narrowing this
 * sweep makes is an equality on `trading_day`, which the accessor has always
 * had.
 */
export interface ReconTerms {
  /** `column IS NULL`. */
  isNull(): ReconFilterTerm;
}

/** A filter, by Drizzle property name. `ADR-112`'s shape. */
export type ReconFilter = Readonly<Record<string, unknown>>;

/** A set of values to write, by Drizzle property name. */
export type ReconValues = Readonly<Record<string, unknown>>;

/** One row as the sweep sees it. */
export type ReconRow = Readonly<Record<string, unknown>>;

// -----------------------------------------------------------------------------
// One open transaction, as a reconciliation sweep needs to see it
// -----------------------------------------------------------------------------

/**
 * One open transaction.
 *
 * **THERE IS NO `lockAt` AND THE ABSENCE IS ARGUED RATHER THAN COPIED.** The
 * expiry sweep one directory over locks because it is the THIRD door onto a
 * transition two route handlers also write. Nothing else in this workspace
 * writes `reconciliations` or `reconciliation_runs` -- derived at this commit
 * and asserted in `test/recon-sweep.test.ts` -- so on those two tables there is
 * no row to contend for. `accounts` is different and the difference is stated
 * rather than hidden: other writers of that row exist, and this sweep touches
 * exactly one boolean of it, sets it in one direction only, and is therefore
 * idempotent under any interleaving. A lock would serialize the whole population
 * behind a flag that cannot be un-set by this code.
 */
export interface ReconTx {
  /**
   * Rows matching a filter. MANY rows, and the READ path is the only place a
   * term may appear (`ADR-157`).
   */
  rowsWhere(key: ReconReadTable, where: ReconFilter): Promise<unknown[]>;
  /** Write one row, returning it. */
  insert(key: ReconWriteTable, values: ReconValues): Promise<unknown[]>;
  /** Write ONE row. The address must name a unique key. */
  updateAt(key: ReconWriteTable, at: ReconFilter, values: ReconValues): Promise<unknown[]>;
}

/**
 * Everything the sweep needs from the world.
 *
 * `transact` IS CALLED MANY TIMES PER SWEEP AND THAT IS THE DESIGN, not a
 * missed batching opportunity. `OVERVIEW` section 5.2: "Any stage failing leaves
 * prior stages committed per account and the batch resumable at the account
 * boundary, so a crash at account 2,341 of 5,000 resumes without double-applying
 * a day." One transaction around the whole sweep would make that sentence false
 * and would make `0064`'s `'running'` state unreachable as well, because the row
 * written at the start would not be visible until the row written at the end
 * committed with it.
 */
export interface ReconSweepIo {
  transact<T>(fn: (tx: ReconTx) => Promise<T>): Promise<T>;
  readonly terms: ReconTerms;
  now(): Date;
}

/**
 * Raised by a port that is not installed.
 *
 * A SWEEP THAT RETURNED A PLAUSIBLE REPORT WOULD BE A FIXTURE REPORTING
 * RECONCILIATION HEALTH, and the value it would have to invent is whether
 * Merit's balances currently agree with the platform's. `CRON_INVENTORY`'s
 * dead-man switch alarms on the run's ABSENCE, so a deployment holding the
 * unwired default is a deployment whose reconciliation runs are absent and is
 * alarmed as such; a deployment holding a fake one is not.
 */
export class ReconSweepUnwired extends Error {
  constructor(what: string) {
    super(
      `ReconSweepIo.${what} cannot be served by this deployment: no adapter is installed. The ` +
        'reconciliation sweep refuses rather than returning a plausible value, because an empty ' +
        'report is indistinguishable from a night on which every balance agreed.',
    );
    this.name = 'ReconSweepUnwired';
  }
}

/** The unwired default, which serves nothing. */
export const UNWIRED_RECON_SWEEP_IO: ReconSweepIo = {
  transact: () => Promise.reject(new ReconSweepUnwired('transact')),
  terms: {
    isNull: () => {
      throw new ReconSweepUnwired('terms.isNull');
    },
  },
  now: () => {
    throw new ReconSweepUnwired('now');
  },
};
