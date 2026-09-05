// =============================================================================
// apps/worker/src/withdrawals/approval-sweep.ts
// =============================================================================
// THE `LT-06` WITHDRAWAL-APPROVAL DRIVER. THE TRANSITION AND THE POSTING
// TOGETHER, IN ONE TRANSACTION, AT `systemDb('nightly-batch')`.
//
// ADR-305 section 7 slice 7, ruled by ADR-316 and transcribed by ADR-325.
// `requested --> approved` and `cooling --> approved`, with `INV-M20-01`'s lock
// per identity around each one and the wallet debit inside it.
//
// -----------------------------------------------------------------------------
// WHY THE FILE IS NAMED `approval-sweep.ts` AND NOT `approvals.ts`
// -----------------------------------------------------------------------------
// `eslint.config.js` scopes `merit/no-calendar-in-expiry-path` by GLOB and its
// own comment says what to do when a sweep lands outside the patterns: "When the
// sweep lands somewhere these patterns do not reach, THE LINE TO CHANGE IS THIS
// ONE". The patterns are `apps/**/payout*/**`, `apps/**/payouts/**`,
// `apps/**/wallet/**`, `apps/**/*sweep*.ts`, `apps/**/*expiry*.ts`,
// `apps/**/*freeze*.ts` and `apps/**/*hold*.ts`. NONE OF THEM REACHES
// `apps/worker/src/withdrawals/approvals.ts`: the directory is `withdrawals` and
// not `wallet`, and `approvals` contains none of the four stems.
//
// SO THE NAME IS THE FIX AND THE CONFIG LINE IS NOT REACHED FOR, which is the
// cheaper of the two moves and the one inside this row's fence: `*sweep*.ts`
// matches this file, the rule applies, and it PASSES, which is the fail-closed
// direction rather than an exemption. ADR-316 names the directory and leaves the
// filename to the slice in terms. A later slice that renames this file back
// takes the lint config's own advice instead.
//
// -----------------------------------------------------------------------------
// THE ORDERING IS THE WHOLE OF THE CONCURRENCY CONTROL. ADR-316 SECTION 3.5
// -----------------------------------------------------------------------------
//   1. THE SCAN. One transaction, no lock, read only. Two reads and not one,
//      because `APPROVABLE_STATUSES` is two values, an `IN` is an `OR`, and an
//      `OR` is a term ADR-157 refuses. The scan produces IDENTITY IDS and
//      nothing else is carried out of it.
//   2. PER IDENTITY, one transaction:
//        lock -> re-read -> decide -> write -> post -> record -> emit -> commit
//      `lockAt('identities', { id })` FIRST. Then the candidates are RE-READ
//      under that lock, because the scan's rows were read without one and
//      `wallet_withdrawals_open_idx` is not unique (ADR-158 finding 8), so a row
//      the scan saw as `requested` may have been cancelled by its own trader in
//      between. A decision made on a scanned row is a decision made outside the
//      lock, which is the whole defect the lock exists to prevent.
//   3. COMMIT is when the lock is released, because a row lock is released at
//      `COMMIT` and at nothing earlier.
//
// ONE TRANSACTION FOR THE WHOLE SWEEP IS REFUSED AND THE REASON IS NOT
// TIDINESS. It would hold every scanned identity's `identities` row until the
// run ended, and `lockScope()` is the first thing the request handler does, so
// every trader opening a withdrawal would block behind the batch; and one
// failure would roll back every identity's posting, turning a single bad row
// into a night with no approvals at all. A partial run is recoverable and a
// night of blocked withdrawal requests is visible to traders.
//
// -----------------------------------------------------------------------------
// THE DECISION IS THIS DEPLOYABLE'S OWN AND `decideApproval` DOES NOT MOVE
// -----------------------------------------------------------------------------
// ADR-316 section 6 REFUSES the move and states the duplication cost in full.
// `decideApproval` stays at `apps/api/src/routes/wallet-withdrawals.ts:1802`,
// two live gates read that file for it, and `DUAL_CONTROL_THRESHOLD_CENTS` is
// `admin-wallet.ts`'s constant which this deployable has no operator to spend.
//
// WHAT IS DUPLICATED IS SEVEN ORDERED TERMS AND WHAT IS NOT IS THE EIGHTH.
// `dualControlRequired` returns `false` for a null hand on its first line and a
// sweep has no hand, so `approvedBy`, `dualControlApprovalId` and
// `dualControlThresholdCents` are all written `null` here and the dual-control
// vocabulary appears nowhere in this deployable. THE WORKER'S COPY IS SMALLER
// THAN THE ORIGINAL AND NOT EQUAL TO IT.
//
// THE DRIFT DIRECTION THAT COSTS IS THE ONE NOBODY WATCHES. This sweep is the
// only live writer of the approval edge, so a term tightened in `apps/api`
// alone changes nothing at all and the tree gives no sign; a term dropped HERE
// approves a withdrawal for a restricted identity, an unverified one or a
// halted row. THE COST IS PAID INTO A CENSUS RATHER THAN INTO A MEMORY:
// `test/withdrawal-approvals.test.ts` holds the approval predicate at exactly
// two statements, names both files, asserts the seven hold names and their
// EVALUATION ORDER are identical in both, and asserts that this copy carries no
// dual-control token and the route's carries one.
//
// -----------------------------------------------------------------------------
// THE NINTH TERM, WHICH IS THIS ROW'S ONE JUDGEMENT
// -----------------------------------------------------------------------------
// `decideApproval` HAS NO TERM FOR AN INSUFFICIENT POSITION and is sound
// without one, because `driveApprovals` posts nothing and therefore debits
// nothing. IT IS NOT SUFFICIENT FOR A DRIVER THAT DOES. `M20:57` requires every
// debit checked against the live position inside the same transaction,
// `APPROVAL_HOLDS` has no member naming a short position, and
// `insufficient_funds` is a request-time HTTP refusal that is not this.
//
// THE RULING IS A HOLD AND NOT A CANCELLATION, and ADR-325 section 5 argues it.
// The short version: the money is money the trader SPENT between request and
// approval, which is not Merit's decision to close their withdrawal over; a
// hold is "not yet" rather than "no", which is what `APPROVAL_HOLDS`' own
// docblock says a hold means; and the counter-argument that a hold sits inside
// `G-NO-IN-FLIGHT` forever is answered by `0072:211-218`, which draws
// `G-TRADER-CANCELS` from `requested` AND from `cooling`, so a held row is
// still the trader's to take back. A driver that cancelled would be a denial,
// which is the one thing the zero-denial policy forbids.
//
// IT IS EVALUATED LAST, AFTER THE SEVEN. `decideApproval` puts its own last
// term last for a reason this transcribes: the position is the only term whose
// answer changes without anybody acting on this row, so reporting it above a
// standing identity refusal would tell a trader to wait for money when what
// actually blocks them is a restricted identity.
//
// -----------------------------------------------------------------------------
// THIS JOB IS THE FIRST WRITER OF A `wallet_entries` ROW IN THIS APPLICATION
// -----------------------------------------------------------------------------
// ADR-316 section 8 finding 3, re-derived on this tree: `walletEntries` occurs
// under `apps/*/src` and `packages/*/src` at reads and comments only and there
// is no `insert` anywhere. So `balance_after_cents >= 0` (`0011:90`), which is
// `INV-M20-01`'s DDL half and the backstop under the position term above, has
// never been exercised by a write and this debit is the first to exercise it.
// THE CONSTRAINT IS THE BACKSTOP AND NOT THE CONTROL: the position term refuses
// the row before the arithmetic is done, so a `23514` from Postgres here would
// mean this file is wrong rather than that the database saved it.
//
// AND THE DEBIT CARRIES NO PROVENANCE, WHICH `0080` MADE WRITABLE ELEVEN DAYS
// BEFORE THIS FILE EXISTED. ADR-322: provenance is what value is MADE of, so it
// is a property of a credit, and a debit consumes a composition rather than
// having one. `0011` declared the column `NOT NULL`, so the honest debit was
// unwritable and the dishonest one was writable; `0080` dropped the `NOT NULL`
// and added `wallet_entries_provenance_follows_direction`, which admits
// `debit + NULL` and refuses `credit + NULL`.
// =============================================================================

import type {
  ApprovalEvent,
  ApprovalFacts,
  ApprovalTx,
  WithdrawalApprovalSweepIo,
} from './ports.ts';

// -----------------------------------------------------------------------------
// The vocabulary, which is `apps/api`'s minus one member and plus one
// -----------------------------------------------------------------------------

/** The statuses an approval may be taken FROM. STATE_MACHINES section 3.2's two arrow tails. */
export const APPROVABLE_STATUSES = ['requested', 'cooling'] as const;

/** Which arrow of section 3.2's drawing a decision took. */
export const APPROVAL_GUARDS = ['G-WITHDRAWAL-CLEARED', 'G-COOLING-ELAPSED'] as const;

/** @see APPROVAL_GUARDS */
export type ApprovalGuard = (typeof APPROVAL_GUARDS)[number];

/**
 * Why an approval did not happen.
 *
 * NOT A REFUSAL. A guard that does not hold is "not yet" rather than "no": there
 * is no request to answer, no reply to send and no status code that would be
 * honest about it. The one name that is not "not yet" is `not_approvable`, which
 * is a caller pointing this at a row the machine does not admit.
 *
 * SEVEN OF THESE EIGHT ARE `apps/api`'s, IN `decideApproval`'s EVALUATION ORDER,
 * and the census case in this module's suite is what holds them identical.
 * `dual_control_required` is ABSENT because a sweep has no hand, and
 * `insufficient_position` is this deployable's own because a driver that posts
 * needs a term the route that posts nothing does not.
 *
 * THE ARRAY IS IN EVALUATION ORDER AND `apps/api`'s IS NOT, which is reported
 * rather than repaired. `APPROVAL_HOLDS` at `wallet-withdrawals.ts:1676` lists
 * `provenance_missing` and `destination_cooling` BEFORE `halted`, while
 * `decideApproval` at `wallet-withdrawals.ts:1802` evaluates `halted` BEFORE
 * `provenance_missing`.
 * The order that decides what a trader is told is the evaluation order, so that
 * is the one this array states and the one the census reads out of both function
 * bodies. Repairing the declaration order in `apps/api` is a one-line change in
 * a file this row may touch for two other reasons only.
 */
export const MACHINE_APPROVAL_HOLDS = [
  'not_approvable',
  'identity_not_active',
  'payouts_frozen',
  'kyc_not_verified',
  'halted',
  'provenance_missing',
  'destination_cooling',
  'insufficient_position',
] as const;

/** @see MACHINE_APPROVAL_HOLDS */
export type MachineApprovalHold = (typeof MACHINE_APPROVAL_HOLDS)[number];

/** `identities.status`, `0001`'s enum. */
export const IDENTITY_STATUSES = ['active', 'restricted', 'closed'] as const;

/** One of {@link IDENTITY_STATUSES}. */
export type IdentityStatus = (typeof IDENTITY_STATUSES)[number];

/** `kyc_status`, `0001`'s enum, in API_CONTRACT section 6's spelling. */
export const KYC_STATES = ['kyc_required', 'pending', 'verified', 'rejected', 'expired'] as const;

/** One of {@link KYC_STATES}. */
export type KycState = (typeof KYC_STATES)[number];

/** `wallet_entries.direction`, `0011`'s CHECK. */
export const WALLET_DIRECTIONS = ['credit', 'debit'] as const;

/**
 * `wallet_entries.cause` for the debit an approval writes.
 *
 * `cause` IS "the business event, human readable" (`0011:77`) and is what a
 * debit MEANS, because `0080` left it carrying no provenance. Together with
 * `reference_id` it is `INV-M20-04`'s first half, which `0011` already required
 * of both directions and which this row satisfies without a schema change.
 */
export const WITHDRAWAL_DEBIT_CAUSE = 'wallet withdrawal approved';

// -----------------------------------------------------------------------------
// Reading a row off the accessor
// -----------------------------------------------------------------------------

/** Raised when the row the accessor returned is not one this job can read. */
export class ApprovalRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalRowError';
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function field(table: string, row: unknown, property: string): unknown {
  const record = asRecord(row);
  if (record === null)
    throw new ApprovalRowError(
      `${table} returned ${typeof row} where a row was expected. The accessor's contract is a ` +
        'row or `undefined`, so this is a handle that is not the one this port declares.',
    );
  return record[property];
}

function stringOf(table: string, row: unknown, property: string): string {
  const value = field(table, row, property);
  if (typeof value !== 'string')
    throw new ApprovalRowError(
      `${table}.${property} came back as ${typeof value} and this job reads it as a string. A ` +
        'money-path job does not coerce a column it did not expect.',
    );
  return value;
}

/** A nullable `text` column. `null` and `undefined` are both the column being empty. */
function optionalStringOf(table: string, row: unknown, property: string): string | null {
  const value = field(table, row, property);
  return value === null || value === undefined ? null : stringOf(table, row, property);
}

function memberOf<T extends string>(
  table: string,
  row: unknown,
  property: string,
  admitted: readonly T[],
): T {
  const value = stringOf(table, row, property);
  const found = admitted.find((candidate) => candidate === value);
  if (found === undefined)
    throw new ApprovalRowError(
      `${table}.${property} came back as ${JSON.stringify(value)}, which is not one of ` +
        `${admitted.join(', ')}. The column carries a CHECK and this job reads the CHECK's own ` +
        'list, so a value outside it is a schema this code has not been told about.',
    );
  return found;
}

function flagOf(table: string, row: unknown, property: string): boolean {
  const value = field(table, row, property);
  if (typeof value !== 'boolean')
    throw new ApprovalRowError(
      `${table}.${property} came back as ${typeof value} and this job reads it as a boolean. ` +
        'The column is `boolean NOT NULL` and a truthiness test over anything else is how a ' +
        'freeze stops being a freeze.',
    );
  return value;
}

/**
 * A `bigint` money column.
 *
 * IT REFUSES A `number` RATHER THAN ACCEPTING ONE. Every `*_cents` column here
 * is `bigint` and the Drizzle declaration pins `{ mode: 'bigint' }`, so a
 * `number` means the handle is not the accessor and the value may already have
 * lost digits.
 */
function centsOf(table: string, row: unknown, property: string): bigint {
  const value = field(table, row, property);
  if (typeof value !== 'bigint')
    throw new ApprovalRowError(
      `${table}.${property} came back as ${typeof value} and this job reads it as a \`bigint\`. ` +
        'The column is `bigint` and the schema pins `mode: bigint`, so anything else has been ' +
        'through a lossy conversion this job will not repeat.',
    );
  return value;
}

/**
 * A `timestamptz` column, as a `Date`.
 *
 * BOTH SHAPES ARE ACCEPTED because the driver's answer is the driver's, and
 * anything else is refused rather than coerced. An unparseable string is refused
 * too, because `new Date('nonsense')` is an `Invalid Date` whose every
 * comparison is false, which would silently make a cooling window elapsed.
 */
function instantOf(table: string, row: unknown, property: string): Date {
  const value = field(table, row, property);
  const parsed = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  if (parsed === null || Number.isNaN(parsed.getTime()))
    throw new ApprovalRowError(
      `${table}.${property} came back as ${typeof value} and this job reads it as an instant. ` +
        'The column is `timestamptz`, and an unparseable one is refused rather than compared, ' +
        'because every comparison against an Invalid Date is false.',
    );
  return parsed;
}

/** A nullable `timestamptz`. */
function optionalInstantOf(table: string, row: unknown, property: string): Date | null {
  const value = field(table, row, property);
  return value === null || value === undefined ? null : instantOf(table, row, property);
}

// -----------------------------------------------------------------------------
// The rows, narrowed
// -----------------------------------------------------------------------------

/** The two `identities` columns this edge's gates read, and no others. */
export interface ApprovalIdentityRow {
  readonly status: IdentityStatus;
  readonly payoutsFrozen: boolean;
}

/** One `identities` row, narrowed. */
export function toApprovalIdentityRow(value: unknown): ApprovalIdentityRow {
  return {
    status: memberOf('identities', value, 'status', IDENTITY_STATUSES),
    payoutsFrozen: flagOf('identities', value, 'payoutsFrozen'),
  };
}

/**
 * The identity's current verification state.
 *
 * A RE-VERIFICATION IS A NEW ROW AND NOT A RE-READ (`SD-M19-01`, `INV-M19-06`),
 * so the read returns the whole chain and the current row is the one NOTHING
 * SUPERSEDES. A chain whose head cannot be named FAILS CLOSED, which is
 * `wallet-withdrawals.ts`'s reasoning on the door where this means paying
 * somebody: the alternative is reporting somebody verified on the strength of an
 * ordering this table does not declare.
 */
export function currentKycState(rows: readonly unknown[]): KycState {
  const parsed = rows.map((value) => ({
    id: stringOf('kycVerifications', value, 'id'),
    state: memberOf('kycVerifications', value, 'state', KYC_STATES),
    supersedes: optionalStringOf('kycVerifications', value, 'supersedes'),
  }));
  if (parsed.length === 0) return 'kyc_required';
  const superseded = new Set(
    parsed.map((row) => row.supersedes).filter((id): id is string => id !== null),
  );
  const live = parsed.filter((row) => !superseded.has(row.id));
  if (live.length !== 1) return 'kyc_required';
  return live[0]?.state ?? 'kyc_required';
}

/**
 * What the decision needs from one `wallet_withdrawals` row.
 *
 * `hasProvenance` IS A BOOLEAN AND NOT THE COMPOSITION, deliberately. The term
 * the guard tests is `wallet_withdrawals_approved_has_provenance`'s own
 * condition, `source_provenance_summary <> '{}'::jsonb AND earliest_credit_at IS
 * NOT NULL` (`0011:192-195`), which is a question about PRESENCE. Re-parsing the
 * composition here would be a second reader of a value `apps/api` wrote, and the
 * CHECK is the thing that has to agree with it.
 */
export interface ApprovalCandidateRow {
  readonly id: string;
  readonly identityId: string;
  readonly status: string;
  readonly amountCents: bigint;
  readonly destinationRef: string;
  readonly idempotencyKey: string;
  readonly hasProvenance: boolean;
  /** `frozen_at`. The halt, which is not a status. */
  readonly frozenAt: Date | null;
  /** The three name-match columns, carried into `wallet.withdrawal_approved`. */
  readonly destinationNameMatch: boolean | null;
  readonly nameMatchScore: number | null;
  readonly nameMatchMethod: string | null;
  readonly sourceProvenanceSummary: unknown;
  readonly earliestCreditAt: Date | null;
}

/** One `wallet_withdrawals` row, narrowed. */
export function toApprovalCandidateRow(value: unknown): ApprovalCandidateRow {
  const summary = field('walletWithdrawals', value, 'sourceProvenanceSummary');
  const hasEntries =
    summary !== null && summary !== undefined && Array.isArray(summary) && summary.length > 0;
  const score = field('walletWithdrawals', value, 'nameMatchScore');
  const match = field('walletWithdrawals', value, 'destinationNameMatch');
  return {
    id: stringOf('walletWithdrawals', value, 'id'),
    identityId: stringOf('walletWithdrawals', value, 'identityId'),
    status: stringOf('walletWithdrawals', value, 'status'),
    amountCents: centsOf('walletWithdrawals', value, 'amountCents'),
    destinationRef: stringOf('walletWithdrawals', value, 'destinationRef'),
    idempotencyKey: stringOf('walletWithdrawals', value, 'idempotencyKey'),
    hasProvenance:
      hasEntries && field('walletWithdrawals', value, 'earliestCreditAt') instanceof Date,
    frozenAt: optionalInstantOf('walletWithdrawals', value, 'frozenAt'),
    destinationNameMatch:
      match === null || match === undefined
        ? null
        : flagOf('walletWithdrawals', value, 'destinationNameMatch'),
    nameMatchScore: typeof score === 'number' ? score : null,
    nameMatchMethod: optionalStringOf('walletWithdrawals', value, 'nameMatchMethod'),
    sourceProvenanceSummary: summary,
    earliestCreditAt: optionalInstantOf('walletWithdrawals', value, 'earliestCreditAt'),
  };
}

/** One `payout_destinations` row, `0051`. Both columns are `NOT NULL`. */
export interface ApprovalDestinationRow {
  readonly coolingUntil: Date;
}

/** One `payout_destinations` row, narrowed. */
export function toApprovalDestinationRow(value: unknown): ApprovalDestinationRow {
  return { coolingUntil: instantOf('payoutDestinations', value, 'coolingUntil') };
}

/** One `wallet_entries` row, narrowed to what a position needs. */
export interface ApprovalWalletEntryRow {
  readonly id: bigint;
  readonly balanceAfterCents: bigint;
}

/** One `wallet_entries` row, narrowed. */
export function toApprovalWalletEntryRow(value: unknown): ApprovalWalletEntryRow {
  return {
    id: centsOf('walletEntries', value, 'id'),
    balanceAfterCents: centsOf('walletEntries', value, 'balanceAfterCents'),
  };
}

/**
 * The live position, which is the LAST ROW APPENDED's stored running balance.
 *
 * BY GREATEST `id` AND NOT BY GREATEST `occurred_at`, which is `wallet.ts`'s
 * rule and its reason: `balance_after_cents` is computed AT APPEND TIME, `id` is
 * `bigint GENERATED ALWAYS AS IDENTITY` and therefore append order, and
 * `occurred_at` is the business instant a correction or a backfill may
 * legitimately set to the past.
 */
export function positionOf(rows: readonly ApprovalWalletEntryRow[]): bigint {
  let latest: ApprovalWalletEntryRow | null = null;
  for (const row of rows) if (latest === null || row.id > latest.id) latest = row;
  return latest === null ? 0n : latest.balanceAfterCents;
}

// -----------------------------------------------------------------------------
// The decision. TOTAL AND PURE, so every case is reachable without a database
// -----------------------------------------------------------------------------

/**
 * The columns a machine approval writes. `0070`.
 *
 * A `type` AND NOT AN `interface`, WHICH IS A TYPESCRIPT PROPERTY AND NOT A
 * STYLE CHOICE. `ApprovalTx.updateAt` takes `ApprovalValues`, which is
 * `Readonly<Record<string, unknown>>`; an object TYPE is assignable to an index
 * signature and an INTERFACE is not, because an interface may be reopened by a
 * later declaration. Writing this as an interface compiles everywhere except
 * the one call that uses it and is fixed by a cast, which is the shape P5 and P7
 * rule 10 forecloses by name.
 */
export type MachineApprovalValues = {
  readonly status: 'approved';
  readonly approvedAt: Date;
  readonly approvedBy: null;
  readonly dualControlApprovalId: null;
  readonly dualControlThresholdCents: null;
  readonly updatedAt: Date;
};

/** What {@link decideMachineApproval} concluded about one row. */
export type MachineApprovalDecision =
  | {
      readonly kind: 'approve';
      readonly guard: ApprovalGuard;
      readonly values: MachineApprovalValues;
    }
  | { readonly kind: 'hold'; readonly hold: MachineApprovalHold };

/**
 * `requested --> approved` and `cooling --> approved`, decided and not written.
 *
 * TOTAL AND PURE. It takes rows and returns a decision, so every case below is
 * reachable from a test without a database, and the writing half is the accessor
 * calls in {@link approveForIdentity}.
 *
 * THE ORDER OF THE TERMS IS NOT ARBITRARY AND SEVEN OF THE EIGHT ARE
 * `decideApproval`'s. The identity terms come first because a restricted or
 * frozen identity is a fact about the person rather than about this row. THE
 * POSITION TERM COMES LAST for the reason the dual-control term comes last one
 * deployable over: it is the only one whose answer changes without anybody
 * acting on this row, so reporting `insufficient_position` on a row that is also
 * missing its provenance would tell a trader to wait for money when the thing
 * that actually blocks them is a composition nobody has computed.
 *
 * THERE IS NO `dual_control_required` ARM AND THERE CANNOT BE ONE. A sweep has
 * no hand, `dualControlRequired` returns `false` for a null hand on its first
 * line, and `DUAL_CONTROL_THRESHOLD_CENTS` is a constant `apps/api` owns for an
 * operator door this deployable does not have.
 */
export function decideMachineApproval(args: {
  readonly candidate: ApprovalCandidateRow;
  readonly identity: ApprovalIdentityRow;
  readonly kyc: KycState;
  readonly destination: ApprovalDestinationRow | undefined;
  readonly positionCents: bigint;
  readonly at: Date;
}): MachineApprovalDecision {
  const { candidate, identity, kyc, destination, positionCents, at } = args;

  if (!(APPROVABLE_STATUSES as readonly string[]).includes(candidate.status))
    return { kind: 'hold', hold: 'not_approvable' };

  if (identity.status !== 'active') return { kind: 'hold', hold: 'identity_not_active' };
  if (identity.payoutsFrozen) return { kind: 'hold', hold: 'payouts_frozen' };
  if (kyc !== 'verified') return { kind: 'hold', hold: 'kyc_not_verified' };
  if (candidate.frozenAt !== null) return { kind: 'hold', hold: 'halted' };
  if (!candidate.hasProvenance) return { kind: 'hold', hold: 'provenance_missing' };

  // THE DESTINATION TERM IS COMMON TO BOTH ARROWS, which is `decideApproval`'s
  // sentence: the `cooling` arm carries every term of `G-WITHDRAWAL-CLEARED`
  // and the clock as well. A destination this tree has no row for has never
  // started a window, and a window that has not started has not elapsed.
  if (destination === undefined || destination.coolingUntil.getTime() > at.getTime())
    return { kind: 'hold', hold: 'destination_cooling' };

  // THE NINTH TERM. `INV-M20-01`: every debit is checked against the live
  // position inside the same transaction. `>` and not `>=`: a withdrawal that
  // takes the wallet to exactly zero is a wallet emptied and not an overdraft,
  // and `balance_after_cents >= 0` admits the zero row it produces.
  if (candidate.amountCents > positionCents) return { kind: 'hold', hold: 'insufficient_position' };

  return {
    kind: 'approve',
    guard: candidate.status === 'cooling' ? 'G-COOLING-ELAPSED' : 'G-WITHDRAWAL-CLEARED',
    values: {
      status: 'approved',
      approvedAt: at,
      // ALL THREE OPERATOR COLUMNS ARE `null` AND THE DDL REQUIRES IT.
      // `wallet_withdrawals_unapproved_records_no_approval` and
      // `wallet_withdrawals_operator_approval_records_threshold` (`0070`) read
      // together: the machine arm writes none of the three, and an operator arm
      // writes both of the last two or the row is unwritable.
      approvedBy: null,
      dualControlApprovalId: null,
      dualControlThresholdCents: null,
      updatedAt: at,
    },
  };
}

// -----------------------------------------------------------------------------
// The events, field for field with the registry
// -----------------------------------------------------------------------------

/** `wallet.withdrawal_approved`, EVENTS section 6.2, field for field. */
export function withdrawalApprovedEvent(candidate: ApprovalCandidateRow): ApprovalEvent {
  return {
    name: 'wallet.withdrawal_approved',
    payload: {
      withdrawal_id: candidate.id,
      identity_id: candidate.identityId,
      amount_cents: candidate.amountCents,
      destination_name_match: candidate.destinationNameMatch,
      name_match_score: candidate.nameMatchScore,
      name_match_method: candidate.nameMatchMethod,
      source_provenance_summary: candidate.sourceProvenanceSummary,
      earliest_credit_at: candidate.earliestCreditAt?.toISOString() ?? null,
    },
  };
}

/**
 * `wallet.debited`, EVENTS section 6.1, field for field.
 *
 * IT CARRIES NO `provenance` AND THE REGISTRY SAYS WHY IN ITS OWN WORDS: "a
 * debit consumes a composition rather than having one", and the composition this
 * debit does destroy is reported by `wallet.withdrawal_approved` above, on the
 * row that has the summary. `0080` is what made the database agree.
 */
export function walletDebitedEvent(args: {
  readonly candidate: ApprovalCandidateRow;
  readonly balanceAfterCents: bigint;
  readonly ledgerTransactionId: string;
}): ApprovalEvent {
  return {
    name: 'wallet.debited',
    payload: {
      identity_id: args.candidate.identityId,
      amount_cents: args.candidate.amountCents,
      cause: WITHDRAWAL_DEBIT_CAUSE,
      reference_id: args.candidate.id,
      balance_after_cents: args.balanceAfterCents,
      ledger_transaction_id: args.ledgerTransactionId,
    },
  };
}

// -----------------------------------------------------------------------------
// The report
// -----------------------------------------------------------------------------

/** One row's outcome. */
export interface ApprovalOutcome {
  readonly withdrawalId: string;
  readonly identityId: string;
  readonly decision: MachineApprovalDecision;
}

/** One identity's outcome, which is the granularity of the transaction. */
export interface IdentityApprovalOutcome {
  readonly identityId: string;
  readonly outcomes: readonly ApprovalOutcome[];
  /** Set only when the identity's whole transaction rolled back. */
  readonly failure?: string;
}

/** What one run produced. */
export interface WithdrawalApprovalReport {
  /** The one instant this run compared everything against. */
  readonly sweptAt: string;
  /** Identities the scan reached, in the order it reached them. */
  readonly identities: readonly IdentityApprovalOutcome[];
  readonly approved: number;
  readonly held: number;
  readonly failed: number;
}

/**
 * Whether this run did what it claims.
 *
 * A FUNCTION RATHER THAN A FIELD, which is `expirySweepClean`'s reason: a report
 * carrying its own `ok: true` invites a caller to treat the job's word as
 * evidence. A HOLD IS NOT A FAILURE and does not make a run unclean: holds are
 * the ordinary output of a driver whose gates are working.
 */
export function withdrawalApprovalsClean(report: WithdrawalApprovalReport): boolean {
  return report.failed === 0;
}

function failureDetail(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

// -----------------------------------------------------------------------------
// One identity, under its own lock, in its own transaction
// -----------------------------------------------------------------------------

/**
 * `wallet_entries`' DEBIT, which is the wallet's own statement of the claim
 * `LT-06` just extinguished.
 *
 * `provenance: null` IS WRITTEN EXPLICITLY AND NOT OMITTED. `0080` made the
 * column nullable and added `wallet_entries_provenance_follows_direction`, whose
 * debit branch is `provenance IS NULL OR provenance = 'correction'`. Writing the
 * null states what that migration RULED; omitting the key would rely on the
 * column having no `DEFAULT`, which is a property of the DDL a later migration
 * could change without this file noticing, and would read to a later author as a
 * field forgotten rather than a field that has no value.
 *
 * `reference_id` IS THE WITHDRAWAL, AND `0011:78` DOES NOT NAME IT. That comment
 * enumerates the column's referents as "payout_request, purchase, or the
 * corrected entry" and a wallet withdrawal is none of the three. The column is
 * `uuid NOT NULL` with NO foreign key, so the write is legal and the ENUMERATION
 * is what is out of date, in exactly the way `0011`'s "THE CLOSED CREDIT LIST"
 * heading was out of date when ADR-322 read it. REPORTED AND NOT REPAIRED: a
 * merged migration's comment is superseded by addition and never edited (E2),
 * and `packages/db` shows a zero-line diff on this row.
 */
function walletDebitValues(args: {
  readonly candidate: ApprovalCandidateRow;
  readonly balanceAfterCents: bigint;
  readonly ledgerTransactionId: string;
  readonly at: Date;
}): Record<string, unknown> {
  return {
    identityId: args.candidate.identityId,
    direction: WALLET_DIRECTIONS[1],
    amountCents: args.candidate.amountCents,
    provenance: null,
    cause: WITHDRAWAL_DEBIT_CAUSE,
    referenceId: args.candidate.id,
    ledgerTransactionId: args.ledgerTransactionId,
    balanceAfterCents: args.balanceAfterCents,
    occurredAt: args.at,
  };
}

/**
 * `LT-06`'s facts, off the locked row.
 *
 * `withdrawalIdempotencyKey` IS THE ROW'S OWN STORED KEY, BARE, and that is
 * `packages/ledger`'s own sentence rather than a choice taken here: `LT-06`
 * posts under it unprefixed "because the approval edge is reachable from a
 * sweep and an operator console as well as from a route". A key naming this
 * driver instead would make every door that reaches one approval mint its own
 * posting, and every one of them would commit.
 */
function approvalFacts(candidate: ApprovalCandidateRow): ApprovalFacts {
  return {
    withdrawalId: candidate.id,
    identityId: candidate.identityId,
    amountCents: candidate.amountCents,
    withdrawalIdempotencyKey: candidate.idempotencyKey,
  };
}

/**
 * One identity's approvable withdrawals, decided and written under one lock.
 *
 * THE ORDER INSIDE THE TRANSACTION IS THE CONTROL:
 *
 *   1. `lockAt('identities', { id })`   `INV-M20-01`'s per-identity lock
 *   2. RE-READ the candidates under it  the scan's rows were read without one
 *   3. read the chain, the position     both under the lock
 *   4. per candidate: read the destination, DECIDE
 *   5. UPDATE `wallet_withdrawals`      the transition
 *   6. POST `LT-06`                     ADR-006: the same transaction
 *   7. INSERT `wallet_entries`          the wallet's own statement
 *   8. EMIT both registry events        they commit with it or not at all
 *
 * STEP 6 IS AFTER STEP 5 AND IN THE SAME TRANSACTION, so an approval that could
 * not post leaves the row `requested` or `cooling` rather than marking a claim
 * extinguished that was never extinguished. `0057`'s `WD-C1` is `DEFERRABLE
 * INITIALLY DEFERRED` precisely so that both can live in one, and a driver that
 * transitioned in one transaction and posted in a second would be refused by the
 * first COMMIT.
 *
 * THE POSITION IS THREADED THROUGH THE LOOP AND NOT RE-READ. An identity with
 * two approvable withdrawals has to see the first debit before deciding the
 * second, and re-reading `wallet_entries` inside the loop would read rows this
 * transaction has not committed. `positionCents` starts at the fold over the
 * rows read under the lock and each approval subtracts its own amount, which is
 * the same arithmetic that produced the `balance_after_cents` written on the row.
 *
 * THE DESTINATION IS ADDRESSED BY TWO COLUMNS AND NOT ONE, which is the one
 * place a system-authority port cannot copy `WithdrawalTx` verbatim.
 * `payout_destinations`' primary key is `(identity_id, destination_ref)`;
 * `WithdrawalTx.destination(destinationRef)` takes one argument because the
 * accessor supplies the identity, and THIS HANDLE HAS NO SCOPE, so the identity
 * is an explicit conjunct and a port that forgot it would read another
 * identity's cooling window.
 */
async function approveForIdentity(
  io: WithdrawalApprovalSweepIo,
  at: Date,
  identityId: string,
): Promise<IdentityApprovalOutcome> {
  try {
    return await io.transact(async (tx: ApprovalTx) => {
      const locked = await tx.lockAt('identities', { id: identityId });
      if (locked === undefined || locked === null) return { identityId, outcomes: [] };
      const identity = toApprovalIdentityRow(locked);

      // TWO READS AND NOT ONE. `APPROVABLE_STATUSES` is two values, an `IN` is
      // an `OR`, and an `OR` is a term ADR-157 still refuses.
      const requested = await tx.rowsWhere('walletWithdrawals', {
        identityId,
        status: APPROVABLE_STATUSES[0],
      });
      const cooling = await tx.rowsWhere('walletWithdrawals', {
        identityId,
        status: APPROVABLE_STATUSES[1],
      });
      const candidates = [...requested, ...cooling].map(toApprovalCandidateRow);
      if (candidates.length === 0) return { identityId, outcomes: [] };

      const kyc = currentKycState(await tx.rowsWhere('kycVerifications', { identityId }));
      let positionCents = positionOf(
        (await tx.rowsWhere('walletEntries', { identityId })).map(toApprovalWalletEntryRow),
      );

      const outcomes: ApprovalOutcome[] = [];
      for (const candidate of candidates) {
        const found = await tx.rowAt('payoutDestinations', {
          identityId,
          destinationRef: candidate.destinationRef,
        });
        const destination =
          found === undefined || found === null ? undefined : toApprovalDestinationRow(found);

        const decision = decideMachineApproval({
          candidate,
          identity,
          kyc,
          destination,
          positionCents,
          at,
        });
        outcomes.push({ withdrawalId: candidate.id, identityId, decision });
        if (decision.kind !== 'approve') continue;

        const balanceAfterCents = positionCents - candidate.amountCents;

        await tx.updateAt('walletWithdrawals', { id: candidate.id }, decision.values);
        const ledgerTransactionId = await io.ledger.postLt06(tx, approvalFacts(candidate));
        await tx.insert(
          'walletEntries',
          walletDebitValues({ candidate, balanceAfterCents, ledgerTransactionId, at }),
        );
        await io.events.emit(tx, withdrawalApprovedEvent(candidate));
        await io.events.emit(
          tx,
          walletDebitedEvent({ candidate, balanceAfterCents, ledgerTransactionId }),
        );

        positionCents = balanceAfterCents;
      }
      return { identityId, outcomes };
    });
  } catch (err) {
    return { identityId, outcomes: [], failure: failureDetail(err) };
  }
}

// -----------------------------------------------------------------------------
// The run
// -----------------------------------------------------------------------------

/**
 * The whole driver.
 *
 * THE SCAN CARRIES IDENTITY IDS AND NOTHING ELSE. Its rows were read without a
 * lock, so every fact on them is stale by the time the per-identity transaction
 * opens; what survives the scan is only WHICH identities are worth locking.
 *
 * AN IDENTITY IS LOCKED ONCE AND NOT ONCE PER WITHDRAWAL. Two rows of the same
 * identity are decided inside one transaction under one lock, which is what
 * makes the threaded position correct and what stops the sweep taking the same
 * lock twice in one run.
 *
 * NOTHING SCHEDULES THIS. ADR-305 section 7 slice 8 is the clock and slice 9 is
 * the installation, and slice 9 must not be dispatched before a payment rail
 * exists: past `approved` the only arrow is `transferring`, `packages/rail`
 * opens no socket, and `0072`'s `WD-C2` refuses `approved --> cancelled` at the
 * database. A wired deployment in front of that would extinguish a trader's
 * wallet claim into a state with no exit and no cancel, which is strictly worse
 * for that trader than the 503 they get today.
 */
export async function runWithdrawalApprovals(
  io: WithdrawalApprovalSweepIo,
): Promise<WithdrawalApprovalReport> {
  const at = io.now();

  const scan = await io.transact(async (tx: ApprovalTx) => ({
    requested: await tx.rowsWhere('walletWithdrawals', { status: APPROVABLE_STATUSES[0] }),
    cooling: await tx.rowsWhere('walletWithdrawals', { status: APPROVABLE_STATUSES[1] }),
  }));

  const identityIds: string[] = [];
  const seen = new Set<string>();
  for (const row of [...scan.requested, ...scan.cooling]) {
    const identityId = stringOf('walletWithdrawals', row, 'identityId');
    if (seen.has(identityId)) continue;
    seen.add(identityId);
    identityIds.push(identityId);
  }

  const identities: IdentityApprovalOutcome[] = [];
  for (const identityId of identityIds)
    identities.push(await approveForIdentity(io, at, identityId));

  const decisions = identities.flatMap((identity) => identity.outcomes);
  return {
    sweptAt: at.toISOString(),
    identities,
    approved: decisions.filter((outcome) => outcome.decision.kind === 'approve').length,
    held: decisions.filter((outcome) => outcome.decision.kind === 'hold').length,
    failed: identities.filter((identity) => identity.failure !== undefined).length,
  };
}
