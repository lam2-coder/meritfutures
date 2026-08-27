// =============================================================================
// apps/worker/src/sweeps/expiry.ts
// =============================================================================
// THE HOURLY EXPIRY SWEEP. THREE CLOCKS, ONE JOB, AND THE THREE ARE THREE
// DIFFERENT ACTS.
//
// `CRON_INVENTORY`'s release-job table gives all three clocks to ONE row, and
// says why in the row itself: "a second sweep is a second thing to stall". The
// failure this job exists against is `FM-M5-13`, the sweep stalling, where
// "every hold and every freeze silently becomes indefinite at once ... and it
// needs no operator to forget anything".
//
//   payout_requests.hold_expires_at      RELEASES AND PAYS      (INV-M5-17)
//   wallet_withdrawals.freeze_expires_at RESUMES THE RAIL, NEVER RE-PAYS
//                                                               (INV-M20-14)
//   payout_requests.freeze_expires_at    SWEPT AND REPORTED, NOT WRITTEN
//                                                               (see below)
//
// A SWEEP THAT TREATED THE THREE IDENTICALLY WOULD BE WRONG IN THE DIRECTION
// THAT LOOKS CORRECT. Paying a released withdrawal a second time, or releasing a
// hold without posting, or writing the withdrawal halt into the rail's status
// column, are three separate defects that each read as "the sweep releases
// everything".
//
// -----------------------------------------------------------------------------
// 1. THE HOLD LEG. RELEASE MEANS APPROVE AND PAY
// -----------------------------------------------------------------------------
// ADR-040's own comparison: a held request has NOTHING POSTED, no ledger
// transaction and no wallet credit, and `frozen` is entered "from `approved`,
// AFTER LT-01 posted". So `approved` is the post-`LT-01` state and a release
// that moved the status and posted nothing would mark a payout paid that never
// paid, silently, on the row a dispute is later argued from.
//
// `INV-M5-17` is why the clock pays even after a breach: `INV-M5-09`'s first
// clause governs, the snapshot was true when it was taken, "because the
// alternative is that Merit's own hold cost the trader money, which is the exact
// shape zero denial exists to make impossible".
//
// THE WRITE BLANKS ALL FIVE HOLD COLUMNS BECAUSE `payout_requests_hold_is_
// complete` IS A BICONDITIONAL:
//
//   ALTER TABLE payout_requests
//     ADD CONSTRAINT payout_requests_hold_is_complete CHECK (
//       (status <> 'held_pending_review'
//          AND held_at IS NULL AND hold_flag_id IS NULL
//          AND hold_expires_at IS NULL AND hold_tos_clause IS NULL
//          AND hold_reason IS NULL)
//       OR
//       (status = 'held_pending_review'
//          AND held_at IS NOT NULL AND hold_flag_id IS NOT NULL
//          AND hold_expires_at IS NOT NULL AND hold_tos_clause IS NOT NULL
//          AND hold_reason IS NOT NULL)
//     );
//
// `packages/db/migrations/0031_payout_hold_and_identity_restriction.sql:62`,
// quoted rather than paraphrased and read at the source. FIVE EXPLICIT NULLS,
// NOT FOUR AND NOT A SPREAD: an omission is a `23514` from Postgres and never a
// silent partial hold. `admin-payouts.ts` writes the same five for the same
// reason and the suite compares this file's `SET` clause with that migration's
// CHECK column for column, so a sixth hold column added by a future migration
// turns this suite red rather than production.
//
// -----------------------------------------------------------------------------
// 2. THE WITHDRAWAL LEG. RELEASE RESUMES THE RAIL AND POSTS NOTHING
// -----------------------------------------------------------------------------
// `INV-M20-14`: "A halt expires, and release resumes the rail rather than
// re-paying ... The money is already the trader's, so there is nothing to pay
// again." `INV-M20-13`: the halt is ORTHOGONAL to the rail state and is never
// collapsed into it, which is `SD-M5-06`'s named mistake, so this release
// touches `frozen_at`, `freeze_flag_id` and `freeze_expires_at` and DOES NOT
// TOUCH `status`. The rail status is read and carried into the event; it is
// never written.
//
// `wallet_withdrawals_freeze_is_complete` (`0011:176`) is the biconditional on
// this side, and it is THREE columns rather than five.
//
// A TERMINAL WITHDRAWAL STILL HAS ITS HALT RELEASED, and that is deliberate
// rather than an oversight. On a `cancelled` or `failed` row there is no rail
// left to resume, but a row sitting past its own `freeze_expires_at` is what
// `INV-M5-18` calls a defect and what the nightly assertion pages on, whatever
// the rail did. Releasing costs nothing and leaving it alone would leave an
// unsuppressible alarm ringing about a row nobody can act on.
//
// -----------------------------------------------------------------------------
// 3. THE PAYOUT FREEZE LEG. SWEPT, WARNED, AND NOT WRITTEN, AND THIS IS THE
//    HONEST COUNT
// -----------------------------------------------------------------------------
// A freeze reaching expiry releases (`GS-109`) and the release target is
// `settled`: STATE_MACHINES draws `frozen --> settled` under `G-FREEZE-CLEARED`
// and ADR-040 says it in terms, "`frozen` releases to `settled`, which is what a
// released freeze does under the wallet". There is no `frozen --> approved` edge
// and inventing one would be this file redrawing a machine.
//
// **`settled` IS UNWRITABLE BY ANY CODE IN THIS TREE, AND THAT IS MEASURED
// RATHER THAN ASSUMED:**
//
//   a. `payout_requests_settled_has_days` (`0010:151`) requires `settled_at`,
//      `settled_trading_day` AND `effective_trading_day`, all three NOT NULL.
//   b. `effective_trading_day` is "the FIRST TRADING DAY WHOSE OPENING BALANCE
//      REFLECTS THE WITHDRAWAL" (`0010:96`). That is the exchange session
//      calendar applied to an instant, and NO TRADING CALENDAR EXISTS IN THIS
//      WORKSPACE.
//   c. "Win-day reset and floor recompute happen on settlement"
//      (STATE_MACHINES section 2). That is `applySettlement`, `INV-M5-07`, and
//      no such function exists outside the golden-scenario loader's prose and
//      the simulation harness.
//   d. NOTHING WRITES `frozen` AT ALL. `payouts.ts` writes `approved` or
//      `held_pending_review` and no third value; `'frozen'` appears in
//      `packages/db/src/schema.ts` as an enum member and nowhere else in source.
//      `G-FREEZE-DURING-FLIGHT`'s own row says why: under ADR-019 the internal
//      leg is one transaction, so ADR-040 routed both remaining cases elsewhere
//      -- a flag at request time to the hold, a flag after wallet credit to the
//      external leg's halt -- and the edge "stays drawn because the state is
//      reachable".
//
// SO THIS LEG IS SCANNED, WARNED ON, AND REPORTED. A freeze inside its lead
// window emits `payout.freeze_expiring`, which is a producer EVENTS names for
// this exact job and which needs none of the four missing things. A freeze
// actually PAST its expiry is returned as an `unreleasable` finding naming what
// is absent. Inventing a settlement instant, a trading day and a win-day reset
// inside a sweep would be the sweep deciding what settlement IS, on the money
// path, in the file whose whole purpose is that the clock binds Merit rather
// than the trader.
//
// **`CI-06l` IS NOT WEAKENED BY THIS.** That gate asks that every `*_expires_at`
// column name a release job in `CRON_INVENTORY`. All three still name this one
// job and its row is not edited to say otherwise. The count is stated where it
// belongs instead: three clocks swept, two released, one reported.
//
// -----------------------------------------------------------------------------
// 4. THE READ, AND WHY IT IS TWO PHASES
// -----------------------------------------------------------------------------
//   SCAN     one read per clock, at the sweep's own instant, ADR-157's terms
//   RELEASE  ONE TRANSACTION PER ROW: lock, re-read the precondition, write
//
// ONE TRANSACTION PER ROW IS `FM-M5-13` TAKEN SERIOUSLY. A single transaction
// spanning the estate makes one bad row stall every other row, which is the
// failure this job exists against arriving through the job itself. Per-row
// transactions make a bad row stall one row, and the report says which.
//
// THE PRECONDITION IS RE-READ UNDER THE LOCK AND NOT TRUSTED FROM THE SCAN.
// **THIS SWEEP IS THE THIRD DOOR ONTO THE HOLD TRANSITION** and
// `admin-payouts.ts`'s release and enforce endpoints are the other two. An
// operator releasing at 12:59:59 and this job firing at 13:00:00 must produce
// ONE release: the sweep blocks on the lock, then reads a row whose status has
// moved, and records `superseded` instead of releasing a second time.
//
// AN ADVISORY LOCK IS REFUSED BY NAME. ADR-157 clause 4, P5 rule 10 and P7
// rule 10: `pg_advisory_xact_lock` can only be sent through `sqlExecutor` and
// carries no tenancy narrowing at all. NOTHING HERE ADDS A `SqlExecutorReason`
// MEMBER, ADDS A `SystemReason` MEMBER, IMPORTS `pg`, OR CASTS PAST A KEY TYPE.
//
// -----------------------------------------------------------------------------
// 5. THE KEY DISCIPLINE, WHICH IS THE ONE THING THIS FILE IS MOST LIKELY TO GET
//    WRONG
// -----------------------------------------------------------------------------
// `ledger_transactions.idempotency_key` is `text NOT NULL UNIQUE`. `payouts.ts`
// posts `LT-01` under `` `${PAYOUT_ENDPOINT} ${idempotencyKey}` `` and
// `admin-payouts.ts`'s `releaseLedgerKey` builds THE IDENTICAL STRING rather
// than one naming its own endpoint, so `LT-01` for one payout request is ONE
// posting whichever door reaches it and the second is refused by the DATABASE
// rather than by application memory, which forgets on a restart.
//
// THIS FILE IS THE THIRD DOOR AND BUILDS THE SAME STRING. It cannot import it:
// `apps/worker/package.json` declares `@merit/rules-engine` and nothing else and
// `node-linker=isolated` makes an undeclared import unresolvable, and that
// manifest is outside this fence. So the constant is declared below and **the
// suite BINDS it by reading `apps/api/src/routes/payouts.ts` and
// `admin-payouts.ts` AS TEXT**, which is `packages/db`'s own idiom for binding
// `SqlExecutor` to `packages/queue`'s `JobTransaction` with no import in either
// direction. A retyped constant that drifts is how one approval mints two
// postings, and the assertion is mechanical rather than a comment asking a
// reader to check.
//
// -----------------------------------------------------------------------------
// 6. WHAT THIS FILE DOES NOT DO, EACH REPORTED RATHER THAN INVENTED
// -----------------------------------------------------------------------------
// NO `admin_actions` ROW IS WRITTEN AND THE PORT HAS NO `insert`. That table is
// an operator's record of an operator's decision, and an expiry is nobody's
// decision. `payout.hold_released` carries `released_by: 'expiry'` as a
// FIRST-CLASS VALUE for exactly this distinction (EVENTS section 6): "the two
// cases are operationally different, since one is the SLA working and the other
// is a human deciding early, and a release with no actor is otherwise
// indistinguishable from a release whose actor was not recorded".
//
// NO `payout.expiry_overdue` IS EMITTED. That belongs to the NIGHTLY ASSERTION,
// which is `P5-k`'s slice, and `INV-M5-18`'s load-bearing clause is that it runs
// ON THE QUERY and never on the job. A sweep that also raised the alarm about
// itself would collapse two deliberately independent detections into one.
//
// NO `approved_at` IS WRITTEN ON A RELEASED HOLD. `admin-payouts.ts` reports the
// same and gives the reason this file inherits: overwriting is the lossy
// direction and the repair is a superseding migration's.
//
// MONEY IS INTEGER CENTS. Every `*_cents` column read here is `bigint` and a
// `number` is REFUSED rather than coerced, because a `number` means the handle
// is not the accessor and the value may already have lost digits. There is no
// float in this file or in its suite.
// =============================================================================

import type { ExpiryEvent, ExpirySweepIo, ExpiryTable, ExpiryTx, ExpiryValues } from './ports.ts';

// -----------------------------------------------------------------------------
// The three clocks, as data
// -----------------------------------------------------------------------------

/**
 * The three columns `CRON_INVENTORY`'s release-job table gives to this one job.
 *
 * IN THE DOCUMENT'S OWN ORDER, and the database column names rather than the
 * Drizzle property names, because `CI-06l` reads the DDL and that page and a
 * reader comparing the two should not need a mapping table.
 */
export const EXPIRY_CLOCKS = [
  'payout_requests.hold_expires_at',
  'wallet_withdrawals.freeze_expires_at',
  'payout_requests.freeze_expires_at',
] as const;

/** One of {@link EXPIRY_CLOCKS}. */
export type ExpiryClock = (typeof EXPIRY_CLOCKS)[number];

/** The one `payout_status` value the hold leg may act on. `0030` added it. */
export const HELD = 'held_pending_review';

/** The one `payout_status` value the freeze leg scans. Nothing in this tree writes it. */
export const FROZEN = 'frozen';

/**
 * The five hold columns, by Drizzle property name, in `0031`'s declaration order.
 *
 * THE LIST EXISTS SO THE SUITE CAN COMPARE IT WITH THE MIGRATION'S CHECK. The
 * `SET` clause below still spells all five out rather than generating them from
 * this array, because that statement is what the founder's `E2` read is owed on
 * and a generated `SET` clause is a statement a reader has to run to see.
 */
export const HOLD_COLUMNS = [
  'heldAt',
  'holdFlagId',
  'holdExpiresAt',
  'holdTosClause',
  'holdReason',
] as const;

/**
 * The three withdrawal freeze columns, by Drizzle property name.
 *
 * `status` IS NOT AMONG THEM AND ITS ABSENCE IS `INV-M20-13`. The halt is
 * orthogonal to the rail state and collapsing it into the rail's status column
 * is `SD-M5-06`'s named mistake.
 */
export const WITHDRAWAL_FREEZE_COLUMNS = ['frozenAt', 'freezeFlagId', 'freezeExpiresAt'] as const;

/**
 * `payout.freeze_expiring`'s lead, in wall-clock hours.
 *
 * TWELVE, RULED AT THE SITE THE CORPUS SAYS RULES IT. `OQ-M5-07` says the value
 * is set where the event is written, EVENTS is that file, and ADR-159 clause 6
 * carries it into the payload because "the lead is a launch parameter and not a
 * constant, and a 2031 audit reading a 2027 row has no other way to know which
 * lead produced it". The old lead was two business days, which ADR-040 left
 * degenerate by closing the window at 48 hours and ADR-042 left uncomputable by
 * ruling that Merit never derives business days.
 */
export const FREEZE_EXPIRING_LEAD_HOURS = 12;

/** {@link FREEZE_EXPIRING_LEAD_HOURS} in milliseconds. Integer arithmetic, no floats. */
export const FREEZE_EXPIRING_LEAD_MS = FREEZE_EXPIRING_LEAD_HOURS * 60 * 60 * 1000;

// -----------------------------------------------------------------------------
// The ledger key. Section 5 of this file's header is the whole argument.
// -----------------------------------------------------------------------------

/** `payouts.ts`'s `PAYOUT_PATH`. Bound to that file BY THE SUITE, never by trust. */
export const PAYOUT_PATH = '/accounts/:accountId/payout';

/** `payouts.ts`'s `PAYOUT_ENDPOINT`. Bound to that file BY THE SUITE. */
export const PAYOUT_ENDPOINT = `POST ${PAYOUT_PATH}`;

/**
 * The ledger transaction's idempotency key for a released hold.
 *
 * IDENTICAL TO `admin-payouts.ts`'s `releaseLedgerKey` AND TO THE STRING
 * `payouts.ts` BUILDS WHEN NO HOLD STANDS, character for character. It is
 * DERIVED FROM THE REQUEST'S OWN STORED KEY and is not invented per run, which
 * is `INV-M5-06`: "the same `idempotency_key` on every attempt, generated BEFORE
 * the first send and persisted in the same transaction".
 *
 * **USING THE IDENTICAL STRING IS THE FAIL-CLOSED DIRECTION.** A key naming this
 * sweep instead would make three doors mint three postings for one approval and
 * all three would commit.
 */
export function releaseLedgerKey(idempotencyKey: string): string {
  return `${PAYOUT_ENDPOINT} ${idempotencyKey}`;
}

// -----------------------------------------------------------------------------
// Reading a row off the accessor
// -----------------------------------------------------------------------------

/** Raised when the row the accessor returned is not one this job can read. */
export class ExpiryRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpiryRowError';
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function field(table: ExpiryTable, row: unknown, property: string): unknown {
  const record = asRecord(row);
  if (record === null)
    throw new ExpiryRowError(
      `${table} returned ${typeof row} where a row was expected. The accessor's contract is a ` +
        'row or `undefined`, so this is a handle that is not the one this port declares.',
    );
  return record[property];
}

function stringOf(table: ExpiryTable, row: unknown, property: string): string {
  const value = field(table, row, property);
  if (typeof value !== 'string')
    throw new ExpiryRowError(
      `${table}.${property} came back as ${typeof value} and this job reads it as a string. A ` +
        'money-path job does not coerce a column it did not expect.',
    );
  return value;
}

/**
 * A `bigint` money column.
 *
 * IT REFUSES A `number` RATHER THAN ACCEPTING ONE. Every `*_cents` column on
 * `payout_requests` is `bigint` and the Drizzle declaration pins
 * `{ mode: 'bigint' }`, so a `number` here means the handle is not the accessor
 * and the value may already have lost digits.
 */
function centsOf(table: ExpiryTable, row: unknown, property: string): bigint {
  const value = field(table, row, property);
  if (typeof value !== 'bigint')
    throw new ExpiryRowError(
      `${table}.${property} came back as ${typeof value} and this job reads it as a \`bigint\`. ` +
        'The column is `bigint` and the schema pins `mode: bigint`, so anything else has been ' +
        'through a lossy conversion this job will not repeat.',
    );
  return value;
}

/**
 * A `timestamptz` column, as a `Date`.
 *
 * BOTH SHAPES ARE ACCEPTED because the driver's answer is the driver's: `pg`
 * parses `timestamptz` to a `Date` and a handle handing back the raw string is
 * still handing back the same instant. Anything else is refused rather than
 * coerced, on `centsOf`'s reason one column class over. An unparseable string is
 * refused too, because `new Date('nonsense')` is an `Invalid Date` whose every
 * comparison is false, which would silently make a row never due.
 */
function instantOf(table: ExpiryTable, row: unknown, property: string): Date {
  const value = field(table, row, property);
  const parsed = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  if (parsed === null || Number.isNaN(parsed.getTime()))
    throw new ExpiryRowError(
      `${table}.${property} came back as ${typeof value} and this job reads it as an instant. ` +
        'The column is `timestamptz`, and an unparseable one is refused rather than compared, ' +
        'because every comparison against an Invalid Date is false and the row would never be ' +
        'found due.',
    );
  return parsed;
}

/** A nullable `timestamptz`. `null` and `undefined` are both the column being empty. */
function optionalInstantOf(table: ExpiryTable, row: unknown, property: string): Date | null {
  const value = field(table, row, property);
  return value === null || value === undefined ? null : instantOf(table, row, property);
}

// -----------------------------------------------------------------------------
// The rows, read off the LOCKED row before anything is written
// -----------------------------------------------------------------------------

/**
 * A `held_pending_review` row, read before the write erases the hold.
 *
 * ALL FIVE HOLD COLUMNS ARE READ. `hold_tos_clause` and `hold_reason` do not
 * reach the event payload and are read anyway, because reading them is what
 * proves the row satisfies the CHECK's populated branch before this job writes
 * the branch that empties it.
 */
interface HeldPayoutRow {
  readonly id: string;
  readonly accountId: string;
  readonly identityId: string;
  readonly idempotencyKey: string;
  readonly approvedCents: bigint;
  readonly traderCents: bigint;
  readonly firmCents: bigint;
  readonly heldAt: Date;
  readonly holdFlagId: string;
  readonly holdExpiresAt: Date;
  readonly holdTosClause: string;
  readonly holdReason: string;
}

function heldPayoutRow(row: unknown): HeldPayoutRow {
  const t: ExpiryTable = 'payoutRequests';
  return {
    id: stringOf(t, row, 'id'),
    accountId: stringOf(t, row, 'accountId'),
    identityId: stringOf(t, row, 'identityId'),
    idempotencyKey: stringOf(t, row, 'idempotencyKey'),
    approvedCents: centsOf(t, row, 'approvedCents'),
    traderCents: centsOf(t, row, 'traderCents'),
    firmCents: centsOf(t, row, 'firmCents'),
    heldAt: instantOf(t, row, 'heldAt'),
    holdFlagId: stringOf(t, row, 'holdFlagId'),
    holdExpiresAt: instantOf(t, row, 'holdExpiresAt'),
    holdTosClause: stringOf(t, row, 'holdTosClause'),
    holdReason: stringOf(t, row, 'holdReason'),
  };
}

/** A `wallet_withdrawals` row carrying a live halt. */
interface HaltedWithdrawalRow {
  readonly id: string;
  readonly identityId: string;
  /** The rail status, READ AND NEVER WRITTEN. `INV-M20-13`. */
  readonly railStatus: string;
  readonly freezeExpiresAt: Date;
}

function haltedWithdrawalRow(row: unknown): HaltedWithdrawalRow {
  const t: ExpiryTable = 'walletWithdrawals';
  return {
    id: stringOf(t, row, 'id'),
    identityId: stringOf(t, row, 'identityId'),
    railStatus: stringOf(t, row, 'status'),
    freezeExpiresAt: instantOf(t, row, 'freezeExpiresAt'),
  };
}

/** A `frozen` `payout_requests` row. Read, warned on, and never written. */
interface FrozenPayoutRow {
  readonly id: string;
  readonly freezeFlagId: string;
  readonly freezeExpiresAt: Date;
}

function frozenPayoutRow(row: unknown): FrozenPayoutRow {
  const t: ExpiryTable = 'payoutRequests';
  return {
    id: stringOf(t, row, 'id'),
    freezeFlagId: stringOf(t, row, 'freezeFlagId'),
    freezeExpiresAt: instantOf(t, row, 'freezeExpiresAt'),
  };
}

// -----------------------------------------------------------------------------
// The `SET` clauses. Each one is the other half of a biconditional CHECK.
// -----------------------------------------------------------------------------

/**
 * The hold release's `SET` clause.
 *
 * FIVE EXPLICIT NULLS, NOT FOUR AND NOT A SPREAD.
 * `payout_requests_hold_is_complete` requires every one of them at any status
 * other than `held_pending_review`, so an omission here is a `23514` from
 * Postgres. They are written out rather than generated from
 * {@link HOLD_COLUMNS} because this is the statement the founder's `E2` read is
 * owed on, and the suite compares the two lists so the array cannot drift from
 * the clause either.
 *
 * `status` IS `approved` AND NOT `settled`. ADR-040: `approved` is the
 * post-`LT-01` state on the internal leg, and the posting below is what puts the
 * row there honestly.
 */
export function clearHold(at: Date): ExpiryValues {
  return {
    status: 'approved',
    heldAt: null,
    holdFlagId: null,
    holdExpiresAt: null,
    holdTosClause: null,
    holdReason: null,
    updatedAt: at,
  };
}

/**
 * The withdrawal halt release's `SET` clause.
 *
 * THREE NULLS AND NO `status`. `wallet_withdrawals_freeze_is_complete` is the
 * biconditional on this side, and `INV-M20-13` is why the rail's column is
 * absent: the halt rides alongside the rail state exactly as `payouts_frozen`
 * rides alongside the account machine, and a release that also moved `status`
 * would be this job deciding what the rail does next.
 */
export function clearWithdrawalHalt(at: Date): ExpiryValues {
  return {
    frozenAt: null,
    freezeFlagId: null,
    freezeExpiresAt: null,
    updatedAt: at,
  };
}

// -----------------------------------------------------------------------------
// The report
// -----------------------------------------------------------------------------

/** What happened to one row this sweep found. */
export type ExpiryDisposition =
  /** The clock was reached and the release committed. */
  | 'released'
  /**
   * The row moved between the scan and the lock, so another door resolved it.
   *
   * NOT A FAILURE. It is the row lock doing its job: an operator releasing or
   * enforcing a hold in the second before this job reaches it must produce ONE
   * release, and this is what that looks like from here.
   */
  | 'superseded'
  /** The clock is real, the release is specified, and no code in this tree can perform it. */
  | 'unreleasable'
  /** The release was attempted and threw. The row is untouched and the sweep continued. */
  | 'failed';

/** One row's outcome. */
export interface ExpiryOutcome {
  readonly clock: ExpiryClock;
  readonly subjectId: string;
  readonly disposition: ExpiryDisposition;
  /** Present on `unreleasable` and `failed`, absent otherwise. */
  readonly detail?: string;
}

/** One clock's tally. */
export interface ExpiryClockReport {
  readonly clock: ExpiryClock;
  readonly found: number;
  readonly released: number;
  readonly superseded: number;
  readonly unreleasable: number;
  readonly failed: number;
}

/** What one run produced. */
export interface ExpirySweepReport {
  /** The one instant this run compared everything against. */
  readonly sweptAt: string;
  /** Exactly three, in {@link EXPIRY_CLOCKS} order. */
  readonly clocks: readonly ExpiryClockReport[];
  /** Every row's outcome, in the order the sweep reached them. */
  readonly outcomes: readonly ExpiryOutcome[];
  /** The `payout.freeze_expiring` warnings emitted, by payout request id. */
  readonly warned: readonly string[];
}

/**
 * Whether this run did what it claims.
 *
 * IT IS A FUNCTION RATHER THAN A FIELD ON PURPOSE. `INV-M5-18`'s load-bearing
 * clause is that the alarm runs ON THE QUERY and never on the job, and a report
 * carrying its own `ok: true` invites a caller to treat the job's word as
 * evidence. This says only what this process observed; the nightly assertion is
 * what decides whether a row is past its expiry, and the two are deliberately
 * independent (`FM-M5-13`).
 *
 * `unreleasable` COUNTS AS NOT CLEAN. The freeze leg's rows are a standing
 * finding and a run that met one has not swept the estate clean, whatever the
 * reason.
 */
export function expirySweepClean(report: ExpirySweepReport): boolean {
  return report.clocks.every((clock) => clock.failed === 0 && clock.unreleasable === 0);
}

function tally(
  clock: ExpiryClock,
  found: number,
  outcomes: readonly ExpiryOutcome[],
): ExpiryClockReport {
  const mine = outcomes.filter((outcome) => outcome.clock === clock);
  const count = (disposition: ExpiryDisposition): number =>
    mine.filter((outcome) => outcome.disposition === disposition).length;
  return {
    clock,
    found,
    released: count('released'),
    superseded: count('superseded'),
    unreleasable: count('unreleasable'),
    failed: count('failed'),
  };
}

function failureDetail(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

// -----------------------------------------------------------------------------
// The three legs
// -----------------------------------------------------------------------------

/**
 * One held request, released and PAID.
 *
 * THE ORDER INSIDE THE TRANSACTION IS THE CONTROL:
 *
 *   1. `lockAt('payoutRequests', { id })`   ADR-157's row lock, FOR UPDATE
 *   2. status must still be `held_pending_review`, else `superseded`
 *   3. the clock must still be reached under the lock, else `superseded`
 *   4. READ ALL FIVE HOLD COLUMNS off the locked row
 *   5. UPDATE                                <-- the five NULLs
 *   6. POST `LT-01`                          <-- under the request's OWN key
 *   7. EMIT `payout.hold_released`
 *
 * STEP 4 IS BEFORE STEP 5 BECAUSE AFTER STEP 5 THE ROW CANNOT ANSWER. The CHECK
 * blanks the five columns, so the event payload's `hold_flag_id`, `held_at` and
 * `hold_expires_at` have exactly one moment in which they can be copied.
 *
 * STEP 6 IS AFTER STEP 5 AND IN THE SAME TRANSACTION, so a release that could
 * not post leaves the request held rather than marking a payout paid that never
 * paid. A live ledger halt refuses the posting and that is left alone: an
 * override is a ruling this job does not take, and the nightly assertion is what
 * reports the row that stayed held.
 *
 * NOTHING HERE ASSERTS `INV-M5-03` A SECOND TIME. `lt01` asserts the split
 * internally and `admin-payouts.ts` relies on that rather than restating it; two
 * statements of one fact is ADR-092 section 5's hazard and the money path is
 * where it costs most.
 */
async function releaseHold(io: ExpirySweepIo, at: Date, id: string): Promise<ExpiryOutcome> {
  const clock: ExpiryClock = 'payout_requests.hold_expires_at';
  try {
    return await io.transact(async (tx: ExpiryTx) => {
      const found = await tx.lockAt('payoutRequests', { id });
      if (found === undefined || found === null)
        return { clock, subjectId: id, disposition: 'superseded' as const };
      if (stringOf('payoutRequests', found, 'status') !== HELD)
        return { clock, subjectId: id, disposition: 'superseded' as const };

      const held = heldPayoutRow(found);
      if (held.holdExpiresAt.getTime() > at.getTime())
        return { clock, subjectId: id, disposition: 'superseded' as const };

      await tx.updateAt('payoutRequests', { id: held.id }, clearHold(at));

      await io.ledger.postLt01(tx, {
        identityId: held.identityId,
        payoutRequestId: held.id,
        idempotencyKey: releaseLedgerKey(held.idempotencyKey),
        approvedCents: held.approvedCents,
        traderCents: held.traderCents,
        firmCents: held.firmCents,
      });

      await io.events.emit(tx, holdReleasedEvent(held));
      return { clock, subjectId: id, disposition: 'released' as const };
    });
  } catch (err) {
    return { clock, subjectId: id, disposition: 'failed', detail: failureDetail(err) };
  }
}

/**
 * `payout.hold_released`, EVENTS section 6, field for field.
 *
 * `released_by: 'expiry'` IS A FIRST-CLASS VALUE AND NOT A NULL ACTOR, and
 * `actor` is OMITTED rather than written as null: the registry types it optional
 * and this release has no human in it, so writing the key with an empty value
 * would say a human was not recorded rather than that there was none.
 */
function holdReleasedEvent(held: HeldPayoutRow): ExpiryEvent {
  return {
    name: 'payout.hold_released',
    payload: {
      payout_request_id: held.id,
      account_id: held.accountId,
      identity_id: held.identityId,
      released_by: 'expiry',
      hold_flag_id: held.holdFlagId,
      held_at: held.heldAt.toISOString(),
      hold_expires_at: held.holdExpiresAt.toISOString(),
    },
  };
}

/**
 * One halted withdrawal, released, WITH NOTHING POSTED.
 *
 * `INV-M20-14`: the money is already the trader's, so there is nothing to pay
 * again. There is no `postLt01` call in this function and its absence is the
 * whole difference between the two legs.
 *
 * THE PRECONDITION UNDER THE LOCK IS THE CLOCK ITSELF AND NOT A STATUS, because
 * the halt IS three columns rather than a state (`INV-M20-13`). A row whose
 * `freeze_expires_at` came back NULL under the lock was released by another
 * door between the scan and here, which is `superseded`.
 */
async function releaseWithdrawalHalt(
  io: ExpirySweepIo,
  at: Date,
  id: string,
): Promise<ExpiryOutcome> {
  const clock: ExpiryClock = 'wallet_withdrawals.freeze_expires_at';
  try {
    return await io.transact(async (tx: ExpiryTx) => {
      const found = await tx.lockAt('walletWithdrawals', { id });
      if (found === undefined || found === null)
        return { clock, subjectId: id, disposition: 'superseded' as const };
      if (optionalInstantOf('walletWithdrawals', found, 'freezeExpiresAt') === null)
        return { clock, subjectId: id, disposition: 'superseded' as const };

      const halted = haltedWithdrawalRow(found);
      if (halted.freezeExpiresAt.getTime() > at.getTime())
        return { clock, subjectId: id, disposition: 'superseded' as const };

      await tx.updateAt('walletWithdrawals', { id: halted.id }, clearWithdrawalHalt(at));

      await io.events.emit(tx, {
        name: 'wallet.withdrawal_halt_released',
        payload: {
          withdrawal_id: halted.id,
          identity_id: halted.identityId,
          released_by: 'expiry',
          // THE STATUS THIS RELEASE DID NOT TOUCH. Read before the write and
          // carried, so a consumer learns which rail state resumed.
          rail_status: halted.railStatus,
        },
      });
      return { clock, subjectId: id, disposition: 'released' as const };
    });
  } catch (err) {
    return { clock, subjectId: id, disposition: 'failed', detail: failureDetail(err) };
  }
}

/**
 * The sentence a `frozen` row past its expiry gets, and it names what is absent.
 *
 * A CONSTANT RATHER THAN A FORMATTED STRING, so the suite pins the disposition
 * to this exact text and a session that later makes the release writable has to
 * delete this line rather than edit around it.
 */
export const FREEZE_UNRELEASABLE =
  'payout_requests.freeze_expires_at is past and the release is not writable by any code in ' +
  'this tree. STATE_MACHINES draws `frozen --> settled` under G-FREEZE-CLEARED and ADR-040 ' +
  'states it; `payout_requests_settled_has_days` requires settled_at, settled_trading_day and ' +
  'effective_trading_day; effective_trading_day needs the exchange session calendar, which does ' +
  'not exist here; and settlement additionally means the win-day reset and floor recompute of ' +
  'INV-M5-07, which does not exist here either. Reported rather than guessed.';

/**
 * `payout.freeze_expiring`, EVENTS section 6, field for field.
 *
 * `lead_hours` IS IN THE PAYLOAD BECAUSE THE LEAD IS A LAUNCH PARAMETER, ruled
 * by ADR-159 clause 6: a row carrying only the expiry cannot be audited against
 * the policy that produced it.
 */
function freezeExpiringEvent(frozen: FrozenPayoutRow): ExpiryEvent {
  return {
    name: 'payout.freeze_expiring',
    payload: {
      payout_request_id: frozen.id,
      flag_id: frozen.freezeFlagId,
      expires_at: frozen.freezeExpiresAt.toISOString(),
      lead_hours: FREEZE_EXPIRING_LEAD_HOURS,
    },
  };
}

// -----------------------------------------------------------------------------
// The job
// -----------------------------------------------------------------------------

/**
 * One run of the hourly expiry sweep.
 *
 * THE CLOCK IS READ ONCE AND EVERY COMPARISON USES IT. ADR-157's bound is the
 * process's instant and never the database's, so one run is one instant and a
 * fixture pins it. A job that called `now()` per row would compare three clocks
 * against three different presents.
 *
 * THE SCAN IS ONE TRANSACTION AND EACH RELEASE IS ITS OWN, which is section 4 of
 * this file's header. A scan failure is fatal and throws, because a run that
 * read nothing and reported an empty sweep is indistinguishable from a clean
 * one; a per-row failure is recorded and the sweep continues, because
 * `FM-M5-13` is this job stalling and one bad row must not be able to cause it.
 */
export async function runExpirySweep(io: ExpirySweepIo): Promise<ExpirySweepReport> {
  const at = io.now();
  const leadHorizon = new Date(at.getTime() + FREEZE_EXPIRING_LEAD_MS);

  const scan = await io.transact(async (tx: ExpiryTx) => ({
    // `hold_expires_at <= at` AND the status the CHECK ties it to. The status
    // term is an equality and the clock term is ADR-157's RANGE.
    holds: await tx.rowsWhere('payoutRequests', {
      status: HELD,
      holdExpiresAt: io.terms.atMost(at),
    }),
    // `freeze_expires_at <= at` AND `settled_at IS NULL`.
    //
    // THE RANGE TERM ALONE ALREADY EXCLUDES AN UNHALTED ROW, because
    // `NULL <= x` is NULL and never matches, so no `IS NOT NULL` is needed and
    // ADR-157 refuses one anyway. `settledAt: isNull()` is
    // `wallet_withdrawals_live_freeze_blocks_settlement` asserted on the READ:
    // a settled row cannot carry a live halt, and this makes the scan unable to
    // see one rather than trusting that it cannot exist.
    withdrawals: await tx.rowsWhere('walletWithdrawals', {
      freezeExpiresAt: io.terms.atMost(at),
      settledAt: io.terms.isNull(),
    }),
    // ONE READ SERVES BOTH HALVES OF THE FREEZE LEG. Everything out to the lead
    // horizon: what is past `at` is unreleasable, what is between `at` and the
    // horizon is inside its warning window.
    frozen: await tx.rowsWhere('payoutRequests', {
      status: FROZEN,
      freezeExpiresAt: io.terms.atMost(leadHorizon),
    }),
  }));

  const outcomes: ExpiryOutcome[] = [];
  const warned: string[] = [];

  for (const row of scan.holds)
    outcomes.push(await releaseHold(io, at, stringOf('payoutRequests', row, 'id')));

  for (const row of scan.withdrawals)
    outcomes.push(await releaseWithdrawalHalt(io, at, stringOf('walletWithdrawals', row, 'id')));

  // THE FREEZE LEG WRITES NOTHING TO `payout_requests`. It emits the warning the
  // registry names this job the producer of, and reports the rest.
  let frozenOverdue = 0;
  for (const row of scan.frozen) {
    const clock: ExpiryClock = 'payout_requests.freeze_expires_at';
    let frozen: FrozenPayoutRow;
    try {
      frozen = frozenPayoutRow(row);
    } catch (err) {
      frozenOverdue += 1;
      outcomes.push({
        clock,
        subjectId: 'unknown',
        disposition: 'failed',
        detail: failureDetail(err),
      });
      continue;
    }

    if (frozen.freezeExpiresAt.getTime() <= at.getTime()) {
      frozenOverdue += 1;
      outcomes.push({
        clock,
        subjectId: frozen.id,
        disposition: 'unreleasable',
        detail: FREEZE_UNRELEASABLE,
      });
      continue;
    }

    // INSIDE THE LEAD WINDOW. `payout.freeze_expiring`, and no row is written.
    //
    // IT FIRES ON EVERY RUN WHILE THE WINDOW STANDS, AND THAT IS THE FAIL-SAFE
    // DIRECTION STATED RATHER THAN HIDDEN. `payout_requests` has no column
    // recording that the warning was sent, adding one is a migration outside
    // this fence, and deriving "the first run after the boundary" from the job's
    // own period would lose the warning entirely on any run that was missed --
    // which is the exact failure (`FM-M5-13`) this whole job exists against. A
    // repeated warning is noise; a missed one is a denial nobody authorized.
    try {
      await io.transact((tx: ExpiryTx) => io.events.emit(tx, freezeExpiringEvent(frozen)));
      warned.push(frozen.id);
    } catch (err) {
      outcomes.push({
        clock,
        subjectId: frozen.id,
        disposition: 'failed',
        detail: failureDetail(err),
      });
    }
  }

  return {
    sweptAt: at.toISOString(),
    clocks: [
      tally('payout_requests.hold_expires_at', scan.holds.length, outcomes),
      tally('wallet_withdrawals.freeze_expires_at', scan.withdrawals.length, outcomes),
      tally('payout_requests.freeze_expires_at', frozenOverdue, outcomes),
    ],
    outcomes,
    warned,
  };
}
