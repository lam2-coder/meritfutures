// =============================================================================
// apps/api/src/routes/wallet-withdrawals.ts
// =============================================================================
// API_CONTRACT SECTION 6.2's `POST /wallet/withdrawals`. THE EXTERNAL LEG, AND
// THE LAST UNREGISTERED ROW OF THE CONTRACT'S TRADER SURFACE.
//
// P5 section 8's `P5-h`. MONEY PATH. E2 READ OWED ON EVERY LINE.
//
// -----------------------------------------------------------------------------
// THE ONE THING TO READ FIRST: THIS ROUTE DOES NOT POST `LT-06`, AND TWO
// APPROVED DOCUMENTS DISAGREE ABOUT WHETHER IT SHOULD
// -----------------------------------------------------------------------------
// M05 section 1.1's external-leg listing is:
//
//     POST /wallet/withdrawals
//       -> KYC verified, destination outside its cooling window, name matched
//       -> amount >= 10,000c, wallet balance sufficient, no withdrawal in flight
//       -> post LT-06, debiting the wallet position
//       -> status: approved -> enqueue transfer (idempotent) -> Rise
//
// and P5 section 8's own `P5-h` row ends "FIFO composition into
// `source_provenance_summary`, then `LT-06`".
//
// API_CONTRACT section 6.2 types this endpoint's response as
//
//     status: "requested" | "cooling";  // The creation's reachable states,
//                                       // per STATE_MACHINES section 3.2
//
// and M05 section 2.1 names `LT-06`'s kind `wallet_withdrawal_approval`, "The
// external leg's APPROVAL". STATE_MACHINES section 3.2 draws
// `requested --> approved: G-WITHDRAWAL-CLEARED` as an edge OUT OF `requested`,
// which is a transition after the row exists rather than the row's creation.
//
// THIS FILE TAKES THE CONTRACT, AND THE ARGUMENT IS ASYMMETRY OF HARM RATHER
// THAN SENIORITY.
//
//   * A row created at `requested` or `cooling` with nothing posted is a row a
//     later ruling can advance. `LT-06` posted here is an irrevocable entry
//     against `trader_wallet` under a `text NOT NULL UNIQUE` idempotency key,
//     and M05 section 2.1 names no reversal for it the way `LT-03` reverses
//     `LT-01`.
//   * The response would carry a `status` value the contract's own union cannot
//     express, on the one screen that tells a trader their money is leaving.
//   * The contract is the document that governs the wire. ADR-158 wrote section
//     6.2 FROM the DDL after seven contract-schema disagreements were found,
//     and its clause 5 and finding 6 are that author reading THIS seam:
//     "M20 section 3.3's sequence reads request, compose FIFO, provenance
//     check, LT-06, which puts the composition at request time. The CHECK puts
//     it at approval."
//   * M05 section 1.1's listing is the same listing the corpus has already
//     caught TWICE carrying `settled_to_wallet`, a status value ADR-028
//     explicitly rejected, which makes it the weaker source for a status word
//     specifically.
//
// SO THE RULING IS REPORTED AND NOT TAKEN. No ADR number is allocated to this
// session. What is owed is a ruling on which document governs, and, whichever
// way it falls, A DRIVER FOR `requested --> approved` AND `cooling --> approved`
// (`G-COOLING-ELAPSED`): nothing in this tree performs either edge today, and
// P5's `P5-j` sweeps three FREEZE clocks and not the cooling one.
//
// THE KEY THIS FILE WOULD HAVE USED IS RECORDED, BECAUSE THE ANALYSIS WAS DONE
// AND A LATER SESSION SHOULD NOT REDO IT. `ledger_transactions.idempotency_key`
// is `text NOT NULL UNIQUE`, and every door that posts `LT-01` builds the
// IDENTICAL string `` `${PAYOUT_ENDPOINT} ${idempotencyKey}` `` from the
// request's own stored key, so one approval is one posting whichever door
// reaches it: `admin-payouts.ts` and `apps/worker/src/sweeps/expiry.ts` today,
// and `payouts.ts` until ADR-176 applied ADR-172 clause 2 and moved the request
// path's posting to a system authority -- WHICH IS THIS FILE'S OWN CHOICE,
// ARRIVING ON THE PAYOUT SIDE. `LT-06`'s equivalent is
// the string derived from `wallet_withdrawals.idempotency_key`, which is the
// key the trader supplied and which the schema already makes unique per
// identity -- NOT one naming this endpoint, because the approval edge is
// reachable from a sweep and an operator console as well as from here, and a
// key naming this endpoint is how one withdrawal becomes two postings. And the
// SIGN is not a caller's to write: `packages/ledger/src/posting.ts` applies it
// in exactly one place, `+amountCents` on the debit and `-amountCents` on the
// credit, and a caller names a debit account, a credit account and a POSITIVE
// amount. `LT-06` debits `trader_wallet` (identity) and credits
// `withdrawals_in_flight`, the firm-scoped `liability` ADR-181 derived and
// ADR-187 minted, seeded by `0056` so `chart.ts`'s `resolve` finds it (M05
// section 2.1). THIS SENTENCE READ `credits firm_treasury` UNTIL ADR-267 AND
// THAT WAS FALSE WHEN IT WAS WRITTEN: ADR-180 had already ruled the leg is NOT
// `firm_treasury`, because `firm_treasury` is an `asset` and a credit to it
// derecognizes cash, which is exactly the recognition timing ADR-027, ADR-033,
// ADR-067 and `0038` each refused in turn on `LT-01`. No cash moves at an
// approval, so this posting names no cash account at all.
//
// -----------------------------------------------------------------------------
// AND THE POSTING CANNOT LEAVE THIS TRANSACTION THE WAY `LT-01`'s DID
// -----------------------------------------------------------------------------
// ADR-267 rules the question the paragraph above invites, which is whether
// ADR-176's remedy transfers. IT DOES NOT. `LT-01` CREDITS the wallet and
// `LT-06` DEBITS it, M20 section 3.3a separates the payout hold from the wallet
// halt by exactly that fact and calls it "the whole of the difference between
// the two legs", and INV-M20-01 requires every wallet debit to be checked
// against the live position INSIDE THE SAME TRANSACTION. The key half of
// ADR-176 is already paid here -- `decideWithdrawal` stores the trader's key on
// the row -- and the remedy still fails, which is what shows the obstruction is
// the posting's TIMING rather than its key. `lt06-posting-timing.test.ts` runs
// all of it. What is owed is a driver that performs the TRANSITION and the
// POSTING together at a system authority, which is a move out of `apps/api`
// rather than a split inside it.
//
// -----------------------------------------------------------------------------
// `C-27` ALREADY REFUSES THIS FROM A NON-ELEVATED SESSION AND THIS FILE ADDS NO
// SECOND REFUSAL
// -----------------------------------------------------------------------------
// The endpoint declares `required: 'passkey or dual_channel'` and
// `c27: 'external withdrawal'`, which `auth.ts`'s `authorize` applies before
// any handler body runs. M05 section 3.6 argues the rest once: an impersonation
// session can never elevate because `0042_impersonation_sessions.sql` carries
// neither `elevated_at` nor `elevated_by_factor` nor a `user_id`, so there is
// no column an elevation could be written to, and "writing a second refusal
// here would state that this module enforces what C-27 already enforces", whose
// reading is that one of the two is redundant. P5 section 8 repeats it.
//
// -----------------------------------------------------------------------------
// THE ACCESSOR IS THE ONE DOOR AND NOTHING HERE REACHES AROUND IT
// -----------------------------------------------------------------------------
// No `SqlExecutorReason` member, no `SystemReason` member, no `pg` import, no
// cast past a key type, and no advisory lock -- ADR-157 clause 4 and P5 rule 10
// refuse `pg_advisory_xact_lock` by name, because it can only be sent through
// `sqlExecutor` and carries no tenancy narrowing.
//
// "ONE IN FLIGHT" IS DECIDED UNDER `lockScope()`, AND THAT IS THE LOCK THE CASE
// NEEDS RATHER THAN `lockAt`. `lockAt(key, at)` locks a row that EXISTS; the
// row a concurrent second request would create does not exist yet, so there is
// nothing to point it at. `lockScope()` takes no argument at all and locks this
// handle's own `identities` row -- ADR-157 clause 4 calls it "INV-M20-01's
// per-identity lock" and its section 9 rows 15 to 17 watch a second A-scoped
// transaction BLOCK while a B-scoped one does not. So two concurrent
// withdrawals by one identity serialise, the second sees the first's row, and
// `G-NO-IN-FLIGHT` refuses it. Without the lock both read an empty in-flight
// set and both insert, and `wallet_withdrawals_open_idx` IS NOT UNIQUE
// (ADR-158 finding 8), so the database would not catch it.
//
// THE AGGREGATE IS REFUSED AND THIS FILE PAYS THE COST ADR-157 SECTION 5 NAMES.
// There is no `SUM`, no `ORDER BY`, no `LIMIT` and no `OR`. The balance, the
// FIFO composition and the in-flight set are all folded here from rows the
// accessor returned, which is `wallet.ts`'s shape and its recorded cost: "the
// rows crossing the boundary are the window's rather than the match's".
// `G-NO-IN-FLIGHT` is four statuses, which is an `OR`, and an `OR` is one of
// the two terms ADR-157 still refuses -- so the statuses are filtered in
// memory rather than composed into a predicate.
//
// -----------------------------------------------------------------------------
// MONEY IS `bigint` INTEGER CENTS IN THIS FILE AND A JSON INTEGER ON THE WIRE
// -----------------------------------------------------------------------------
// Every money column read or written here is `bigint`. There is no float in
// this file, in its suite, or in any fixture either one holds, and
// `centsToJson` REFUSES past `Number.MAX_SAFE_INTEGER` rather than serialising
// a wrong number. The minimum is `10000n` and it is compared as a `bigint`
// against a `bigint`.
//
// -----------------------------------------------------------------------------
// NO `@merit/db` IMPORT, WHICH IS `db.ts`'s CONVENTION
// -----------------------------------------------------------------------------
// `db.ts` asks that `grep -rln '@merit/db' apps/api/src` name exactly one file.
// This module takes `ApiDb` and names its table keys as the plain strings the
// accessor's own key types check, which is `wallet.ts`'s and `accounts.ts`'s
// shape. `centsToJson` and the row readers are a second copy of `wallet.ts`'s
// for `catalog.ts`'s recorded reason: importing them would make a withdrawal
// defect surface as a `WalletRowError` in an incident log, and a route module
// importing another route module is a dependency the registry does not have.
// =============================================================================

import type { JsonValue } from '@merit/psp';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { ApiDb } from '../db.ts';
import {
  beginIdempotent,
  completeIdempotent,
  identityScope,
  problemForOutcome,
  type IdempotencyOutcome,
  type IdempotencyStore,
} from '../idempotency.ts';
import { databaseIdempotencyStore } from '../idempotency-store.ts';
import { DUAL_CONTROL_THRESHOLD_CENTS } from './admin-wallet.ts';
import { defineRoutes } from '../registry.ts';
import { PROBLEM_MEDIA_TYPE, PROBLEM_TYPE_PREFIX, problem } from '../server.ts';
import {
  requiredFactorTable,
  toRoutes,
  withSessionContext,
  type AuthSession,
  type EndpointSpec,
  type FieldError,
} from './auth.ts';

/** API_CONTRACT section 6.2's row, as the contract writes it. No base path. */
export const WITHDRAWALS_PATH = '/wallet/withdrawals';

/** `idempotency_keys.endpoint`, in `payouts.ts`'s `METHOD /path` spelling. */
export const WITHDRAWALS_ENDPOINT = `POST ${WITHDRAWALS_PATH}`;

/**
 * API_CONTRACT section 6.2's `POST /wallet/withdrawals/:withdrawalId/cancel`.
 * ADR-263.
 *
 * COMPOSED FROM THE CREATION PATH AND NOT RESTATED. The two rows are one
 * resource, and a second literal is a second thing a rename can leave behind.
 *
 * THE CONTRACT ROW IT SERVES IS AN AMENDMENT AND THE PARAGRAPH IT REPLACES IS
 * QUOTED WHERE IT WAS. API_CONTRACT section 6.2 read *"There is no endpoint
 * that cancels a withdrawal"* and named `G-TRADER-CANCELS` *"as owed rather
 * than invented"*; ADR-263 moves that one paragraph and nothing else in the
 * document, so this route transcribes a contract row rather than inventing one.
 */
export const WITHDRAWAL_CANCEL_PATH = `${WITHDRAWALS_PATH}/:withdrawalId/cancel`;

/**
 * The minimum, `10000` INTEGER CENTS.
 *
 * API_CONTRACT section 6.2: "The minimum is `10000` integer cents (M05 section
 * 4, stated there as `$100`), and there is no fee." A `bigint`, compared
 * against a `bigint`, so there is no path on which a float touches it.
 *
 * THE CONTRACT ALSO RECORDS WHAT IT DOES NOT KNOW AND SO DOES THIS CONSTANT:
 * "Whether the minimum is a plan parameter or a firm-wide constant is stated by
 * no approved document; it is written here as the constant M05 states." So this
 * is the contract's constant transcribed and NOT a parameter this file chose.
 */
export const MINIMUM_WITHDRAWAL_CENTS = 10_000n;

/**
 * `C-11`'s window, 48 WALL-CLOCK hours.
 *
 * THE DURATION BELONGS IN CONFIG AND THIS IS A CONSTANT, WHICH IS REPORTED
 * RATHER THAN HIDDEN. ADR-037 rules the number config's, and `0051`'s own
 * column comment keeps it out of the schema for that reason: "48 hours is a
 * launch CANDIDATE that lives in config, and a schema that restated it would be
 * a second copy of a number the config owns." There is no config reader in this
 * deployable, so the value is a module constant on `payouts.ts`'s precedent
 * (`HOLD_WINDOW_MS`, the same 48 hours for the internal leg's hold) and moving
 * both to config is owed. SECURITY section 4 item 1 and ADR-017 are the source.
 */
export const DESTINATION_COOLING_WINDOW_MS = 48 * 60 * 60 * 1000;

// -----------------------------------------------------------------------------
// The wire, section 6.2's own shapes
// -----------------------------------------------------------------------------

/** Section 6.2's `WithdrawalRequestBody`. */
export interface WithdrawalRequestBody {
  readonly amount_cents: number;
  readonly destination_ref: string;
}

/**
 * The CLOSED credit list, `0011`'s own CHECK on `wallet_entries.provenance`.
 *
 * There is no deposit member (`INV-WALLET-NO-DEPOSITS`) and no
 * `promotional_credit` member (`0011` header item 3, `OQ-FREEZE-01`), and
 * neither may be added here without the migration that adds it there.
 *
 * THE LIST IS NOT WIDENED BY `0080` AND THE NULLABILITY IS NOT A MEMBER.
 * ADR-322 dropped the column's `NOT NULL` and added
 * `wallet_entries_provenance_follows_direction`, whose credit branch is
 * `provenance IS NOT NULL`. A CREDIT still carries one of exactly these three,
 * which is what this constant and the FIFO composition below are for, and the
 * change is entirely on the debit side. See {@link walletProvenanceOf}.
 */
export const WALLET_PROVENANCES = ['payout', 'refund_wallet_funded', 'correction'] as const;

/** One of {@link WALLET_PROVENANCES}. */
export type WalletProvenance = (typeof WALLET_PROVENANCES)[number];

/** `direction`'s two members, `0011`'s CHECK. */
export const WALLET_DIRECTIONS = ['credit', 'debit'] as const;

/** One of {@link WALLET_DIRECTIONS}. */
export type WalletDirection = (typeof WALLET_DIRECTIONS)[number];

/** One member of section 6.2's `composition` array. */
export interface CompositionEntry {
  readonly provenance: WalletProvenance;
  readonly cents: number;
}

/**
 * The states this endpoint's response may carry.
 *
 * TWO MEMBERS AND NOT SEVEN. `wallet_withdrawal_status` has seven values and
 * API_CONTRACT section 6.2 types THIS response at two, annotated "The
 * creation's reachable states". See this file's header for the disagreement
 * that makes the narrowing load-bearing rather than incidental.
 */
export const CREATED_STATUSES = ['requested', 'cooling'] as const;

/** One of {@link CREATED_STATUSES}. */
export type CreatedStatus = (typeof CREATED_STATUSES)[number];

/** Section 6.2's `WithdrawalResponse`. */
export interface WithdrawalResponse {
  readonly withdrawal_id: string;
  readonly status: CreatedStatus;
  readonly amount_cents: number;
  readonly destination_ref: string;
  readonly requested_at: string;
  /** The destination registry's clock. Non-null exactly when `status` is `cooling`. */
  readonly cooling_until: string | null;
  readonly composition: readonly CompositionEntry[] | null;
  readonly earliest_credit_at: string | null;
  /** P-1. Always `false` today, and {@link provenanceReview} is why. */
  readonly provenance_review: boolean;
  /** `halt: null` -- "a withdrawal cannot be created halted". */
  readonly halt: null;
}

/**
 * What `POST /wallet/withdrawals/:withdrawalId/cancel` answers. ADR-263.
 *
 * THREE FIELDS, AND THE SHORTNESS IS THE SAME RULING {@link
 * CANCELLATION_HOLDS} CARRIES. The creation response is the trader's receipt
 * for a request that is going somewhere; a cancellation is the trader taking
 * that request back, so what they need told is which row moved, that it is
 * closed, and when. Re-rendering the amount, the destination and the
 * composition here would restate a row this call did not read for that purpose
 * and would make a second reader of `source_provenance_summary` out of the one
 * door that does not need it.
 *
 * `status` IS THE LITERAL AND NOT {@link WithdrawalStatus}. `cancelled` is the
 * only status this door can answer 200 on: every other outcome is a hold and a
 * hold is a refusal document, so a wider type here would advertise a value the
 * response can never carry (ADR-040's rule, applied one door over).
 */
export interface WithdrawalCancellationResponse {
  readonly withdrawal_id: string;
  readonly status: 'cancelled';
  /** `wallet_withdrawals.cancelled_at`, which `0072` added for this. */
  readonly cancelled_at: string;
}

// -----------------------------------------------------------------------------
// The statuses `G-NO-IN-FLIGHT` reads
// -----------------------------------------------------------------------------

/**
 * `wallet_withdrawals_open_idx`'s predicate, written out.
 *
 * IT IS THE INDEX'S OWN LIST AND NOT A LIST THIS FILE CHOSE.
 * `0011_wallet.sql`: `WHERE status IN ('requested', 'cooling', 'approved',
 * 'transferring')`, re-created under the same name by `0031` so a HALTED row
 * stays inside it. A guard that disagreed with its own index would be a gate
 * that holds on Tuesdays, which is what STATE_MACHINES says about
 * `G-NO-IN-FLIGHT` on the other leg.
 *
 * AND ON THIS LEG THE APPLICATION CHECK IS THE WHOLE CONTROL. ADR-158
 * finding 8: `payout_requests_no_in_flight_uq` is a UNIQUE partial index and
 * `wallet_withdrawals_open_idx` is a plain one, "so G-NO-IN-FLIGHT is a
 * database constraint on the leg that moves no cash and an application check on
 * the leg that does". That is why the check below runs under `lockScope()` and
 * not merely inside the transaction.
 */
export const OPEN_WITHDRAWAL_STATUSES = [
  'requested',
  'cooling',
  'approved',
  'transferring',
] as const;

/**
 * The statuses that RELEASE an identity, which is the other half of the list
 * above and the half this tree reaches ONE THIRD OF.
 *
 * ADR-234 REPAIRS THE SECOND CLAUSE OF THIS SENTENCE, WHICH READ "the half
 * nothing in this tree can reach" AND IS NO LONGER TRUE.
 * {@link driveCancellation} drives `cancelled`; `settled` and `failed` are
 * still driven by nothing and {@link TERMINAL_EDGE_FINDINGS} is why, per
 * status, with the sources.
 *
 * IT IS `wallet_withdrawals_open_idx`'s COMPLEMENT AND IT IS WRITTEN OUT
 * BECAUSE THE ARITHMETIC IS THE POINT. `wallet_withdrawal_status` has seven
 * members (`0001:95-98`); four of them are open. So `approved` DOES NOT
 * RELEASE THE IDENTITY: a withdrawal that crosses `G-WITHDRAWAL-CLEARED` moves
 * from one open status to another, `gateNoInFlight` still finds it, and the
 * trader still cannot open a second withdrawal. THE APPROVAL EDGE IS NOT WHAT
 * ENDS A LOCKOUT and `withdrawalReleasesIdentity` below is asserted directly
 * rather than reasoned about, because the reasoning has already been wrong
 * once: `wiring.test.ts`'s `BLOCKED` entry for `useWithdrawalBackend` reads the
 * missing approval edge as the thing standing between a wired backend and a
 * safe one, and it is not. STATE_MACHINES section 3.2 draws exactly three
 * arrows into `[*]` and these are the three.
 */
export const TERMINAL_WITHDRAWAL_STATUSES = ['settled', 'failed', 'cancelled'] as const;

/** A withdrawal status, as the enum declares it. */
export type WithdrawalStatus =
  (typeof OPEN_WITHDRAWAL_STATUSES)[number] | (typeof TERMINAL_WITHDRAWAL_STATUSES)[number];

/**
 * Whether a row in this status lets its identity open another withdrawal.
 *
 * THE PROPERTY THE APPROVAL EDGE DOES NOT HAVE, stated as a function so a test
 * can assert it over the whole enum rather than over the two cases somebody
 * remembered.
 */
export function withdrawalReleasesIdentity(status: string): boolean {
  return !(OPEN_WITHDRAWAL_STATUSES as readonly string[]).includes(status);
}

// -----------------------------------------------------------------------------
// The rows, as this file reads them off the accessor
// -----------------------------------------------------------------------------

/** Raised when a row is not the shape its migration declares. */
export class WithdrawalRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WithdrawalRowError';
  }
}

/** Raised when a value on the money path is not integer cents. */
export class WithdrawalMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WithdrawalMoneyError';
  }
}

function asRow(value: unknown, table: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new WithdrawalRowError(`a \`${table}\` read returned something that is not a row`);
  return value as Record<string, unknown>;
}

function text(row: Record<string, unknown>, field: string, table: string): string {
  const value = row[field];
  if (typeof value !== 'string')
    throw new WithdrawalRowError(`\`${table}.${field}\` is not a string. It is \`NOT NULL\``);
  return value;
}

function nullableText(row: Record<string, unknown>, field: string, table: string): string | null {
  const value = row[field];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string')
    throw new WithdrawalRowError(`\`${table}.${field}\` is neither a string nor null`);
  return value;
}

function flag(row: Record<string, unknown>, field: string, table: string): boolean {
  const value = row[field];
  if (typeof value !== 'boolean')
    throw new WithdrawalRowError(`\`${table}.${field}\` is not a boolean. It is \`NOT NULL\``);
  return value;
}

/**
 * A `bigint` column.
 *
 * `schema.ts` declares every money column with `{ mode: 'bigint' }`, so the
 * driver hands a `bigint` back. A `number` here would be a schema whose mode
 * changed underneath this file, and reading it as money is the
 * `Number.MAX_SAFE_INTEGER` defect ADR-122 refuses, so it is refused rather
 * than coerced.
 */
function big(row: Record<string, unknown>, field: string, table: string): bigint {
  const value = row[field];
  if (typeof value !== 'bigint')
    throw new WithdrawalRowError(
      `\`${table}.${field}\` is not a bigint. \`schema.ts\` declares it ` +
        "`bigint(..., { mode: 'bigint' })`, so reading it as a JSON number would be the digit " +
        'loss ADR-122 refuses',
    );
  return value;
}

/** A `timestamptz` column, as a `Date`. One code path renders every instant here. */
function instant(row: Record<string, unknown>, field: string, table: string): Date {
  const value = row[field];
  if (!(value instanceof Date) || Number.isNaN(value.getTime()))
    throw new WithdrawalRowError(`\`${table}.${field}\` is not a Date. It is \`timestamptz\``);
  return value;
}

function member<T extends string>(
  row: Record<string, unknown>,
  field: string,
  table: string,
  allowed: readonly T[],
): T {
  const value = text(row, field, table);
  if (!(allowed as readonly string[]).includes(value))
    throw new WithdrawalRowError(
      `\`${table}.${field}\` is \`${value}\`, which the column's own CHECK closes at ` +
        allowed.join(' | '),
    );
  return value as T;
}

/** `identity_status`, `0001`'s three-member enum. ADR-041 refused a fourth. */
export const IDENTITY_STATUSES = ['active', 'restricted', 'closed'] as const;

/** One of {@link IDENTITY_STATUSES}. */
export type IdentityStatus = (typeof IDENTITY_STATUSES)[number];

/** The two `identities` columns this leg's gates read, and no others. */
export interface IdentityRow {
  readonly status: IdentityStatus;
  readonly payoutsFrozen: boolean;
}

/** One `identities` row, narrowed. */
export function toIdentityRow(value: unknown): IdentityRow {
  const row = asRow(value, 'identities');
  return {
    status: member(row, 'status', 'identities', IDENTITY_STATUSES),
    payoutsFrozen: flag(row, 'payoutsFrozen', 'identities'),
  };
}

/**
 * `kyc_status`, `0001`'s enum, in API_CONTRACT section 6's spelling.
 *
 * DECLARED HERE RATHER THAN IMPORTED FROM `accounts.ts`. A route module
 * importing another route module is an edge the registry does not have and the
 * directory listing cannot express; `wallet.ts` declined the same import of
 * `checkout.ts`'s money helper for `catalog.ts`'s recorded reason. The list is
 * the column's CHECK either way.
 */
export const KYC_STATES = ['kyc_required', 'pending', 'verified', 'rejected', 'expired'] as const;

/** One of {@link KYC_STATES}. */
export type KycState = (typeof KYC_STATES)[number];

/**
 * The identity's current verification state.
 *
 * A RE-VERIFICATION IS A NEW ROW AND NOT A RE-READ (`SD-M19-01`, `INV-M19-06`),
 * so a scoped read returns the whole chain and the current row is the one
 * NOTHING SUPERSEDES. `accounts.ts` reads it the same way and for the same
 * reason, and a chain whose head cannot be named FAILS CLOSED: the alternative
 * is reporting somebody verified on the strength of an ordering this table does
 * not declare, on the door where that means paying them.
 */
export function currentKycState(rows: readonly unknown[]): KycState {
  const parsed = rows.map((value) => {
    const row = asRow(value, 'kycVerifications');
    return {
      id: text(row, 'id', 'kycVerifications'),
      state: member(row, 'state', 'kycVerifications', KYC_STATES),
      supersedes: nullableText(row, 'supersedes', 'kycVerifications'),
    };
  });
  if (parsed.length === 0) return 'kyc_required';
  const superseded = new Set(
    parsed.map((row) => row.supersedes).filter((id): id is string => id !== null),
  );
  const live = parsed.filter((row) => !superseded.has(row.id));
  if (live.length !== 1) return 'kyc_required';
  return live[0]?.state ?? 'kyc_required';
}

/** One `wallet_entries` row, narrowed to what a balance and a composition need. */
export interface WalletEntryRow {
  readonly id: bigint;
  readonly direction: WalletDirection;
  readonly amountCents: bigint;
  /**
   * `null` ON A DEBIT, WHICH IS THE ORDINARY CASE AFTER `0080`.
   *
   * ADR-322 dropped the column's `NOT NULL` and ruled that provenance is a
   * property of a CREDIT. Only the credit arm of {@link unspentLots} reads it,
   * which is why the FIFO composition is unaffected: a debit CONSUMES lots and
   * never opens one.
   */
  readonly provenance: WalletProvenance | null;
  readonly balanceAfterCents: bigint;
  readonly occurredAt: Date;
}

/**
 * `provenance`, read against `0080`'s CHECK rather than against `0011`'s alone.
 *
 * THIS FUNCTION EXISTS BECAUSE THE NARROWING USED TO RUN BEFORE THE DIRECTION
 * BRANCH AND `0080` MADE THAT THROW. The line it replaces was
 * `provenance: member(row, 'provenance', 'walletEntries', WALLET_PROVENANCES)`,
 * evaluated UNCONDITIONALLY, and `member` calls `text`, which raises on anything
 * that is not a string. ADR-322 dropped the column's `NOT NULL` for a debit, so
 * the first `wallet_entries` DEBIT this application writes carries `NULL` there
 * and the old line would have raised `WithdrawalRowError` on every read of a
 * statement containing one, which includes the composition this route computes
 * before it will let a trader withdraw at all. The union lands in the same
 * commit as that first insert (ADR-325).
 *
 * IT IS `wallet.ts`'s FUNCTION RESTATED AND THAT IS THIS FILE'S OWN PRECEDENT.
 * `KYC_STATES` is declared here rather than imported from `accounts.ts` under a
 * docblock that gives the reason: a route module importing another route module
 * is an edge the registry does not have and the directory listing cannot
 * express. `WALLET_PROVENANCES`, `WALLET_DIRECTIONS` and `toWalletEntryRow`
 * already stand twice for that reason and this is the fourth line of the same
 * pair.
 *
 * `debit + 'payout' | 'refund_wallet_funded'` IS ADMITTED HERE AND REFUSED BY
 * THE CHECK, so the row cannot exist to be read. That looseness is `wallet.ts`'s
 * too and is reported in the same terms there.
 */
export function walletProvenanceOf(
  row: Record<string, unknown>,
  direction: WalletDirection,
): WalletProvenance | null {
  const value = row['provenance'];
  if (value === null || value === undefined) {
    if (direction === 'credit')
      throw new WithdrawalRowError(
        '`wallet_entries.provenance` is NULL on a credit, which ' +
          '`wallet_entries_provenance_follows_direction` (`0080`) refuses: every credit records ' +
          'its provenance class (`INV-M20-04`), and a lot with no class makes every rule in M20 ' +
          'section 3.4 unevaluable',
      );
    return null;
  }
  return member(row, 'provenance', 'walletEntries', WALLET_PROVENANCES);
}

/** One accessor row, narrowed. Exported so the suite names it directly. */
export function toWalletEntryRow(value: unknown): WalletEntryRow {
  const row = asRow(value, 'walletEntries');
  const amountCents = big(row, 'amountCents', 'walletEntries');
  if (amountCents <= 0n)
    throw new WithdrawalRowError(
      `\`wallet_entries.amount_cents\` is ${amountCents.toString()}, and the column is ` +
        '`CHECK (amount_cents > 0)`. Direction carries the sign',
    );
  // THE DIRECTION IS READ FIRST AND THE PROVENANCE IS READ AGAINST IT. It used
  // to be read unconditionally, one line below this one, which `0080` turned
  // into a throw on every honest debit. See {@link walletProvenanceOf}.
  const direction = member(row, 'direction', 'walletEntries', WALLET_DIRECTIONS);
  return {
    id: big(row, 'id', 'walletEntries'),
    direction,
    amountCents,
    provenance: walletProvenanceOf(row, direction),
    balanceAfterCents: big(row, 'balanceAfterCents', 'walletEntries'),
    occurredAt: instant(row, 'occurredAt', 'walletEntries'),
  };
}

/** The one `wallet_withdrawals` column `G-NO-IN-FLIGHT` reads. */
export interface WithdrawalStatusRow {
  readonly status: string;
}

/** One `wallet_withdrawals` row, narrowed to its status. */
export function toWithdrawalStatusRow(value: unknown): WithdrawalStatusRow {
  return { status: text(asRow(value, 'walletWithdrawals'), 'status', 'walletWithdrawals') };
}

/** One `payout_destinations` row, `0051`. */
export interface DestinationRow {
  readonly firstSeenAt: Date;
  readonly coolingUntil: Date;
}

/** One `payout_destinations` row, narrowed. Both columns are `NOT NULL`. */
export function toDestinationRow(value: unknown): DestinationRow {
  const row = asRow(value, 'payoutDestinations');
  return {
    firstSeenAt: instant(row, 'firstSeenAt', 'payoutDestinations'),
    coolingUntil: instant(row, 'coolingUntil', 'payoutDestinations'),
  };
}

// -----------------------------------------------------------------------------
// Money at the boundary. It refuses rather than rounds
// -----------------------------------------------------------------------------

/**
 * `bigint` cents to a JSON integer.
 *
 * It throws past `Number.MAX_SAFE_INTEGER` rather than serialising a wrong
 * number. The columns are `bigint`, so a value that cannot be a JSON integer is
 * expressible in the schema.
 */
export function centsToJson(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new WithdrawalMoneyError(
      `${value.toString()} cents cannot be a JSON integer; API_CONTRACT section 1 says ` +
        '*_cents are JSON integers',
    );
  }
  return Number(value);
}

/**
 * A JSON number to `bigint` cents, or `null` for anything that is not one.
 *
 * A FLOAT IS `null` AND NEVER A ROUND. `5.5` is exactly the value the
 * constitution bans on a financial path, and `Math.round` on this door is a
 * withdrawal for an amount the trader did not ask for.
 */
export function centsFromJson(value: unknown): bigint | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (!Number.isSafeInteger(value)) return null;
  return BigInt(value);
}

// -----------------------------------------------------------------------------
// The balance, and the hold that has no input
// -----------------------------------------------------------------------------

/**
 * The balance, which is the LAST ROW APPENDED's stored running balance.
 *
 * BY GREATEST `id` AND NOT BY GREATEST `occurred_at`, which is `wallet.ts`'s
 * rule and its reason: `balance_after_cents` is computed AT APPEND TIME, `id`
 * is `bigint GENERATED ALWAYS AS IDENTITY` and therefore append order, and
 * `occurred_at` is the business instant a correction or a backfill may
 * legitimately set to the past.
 */
export function balanceOf(rows: readonly WalletEntryRow[]): bigint {
  let latest: WalletEntryRow | null = null;
  for (const row of rows) if (latest === null || row.id > latest.id) latest = row;
  return latest === null ? 0n : latest.balanceAfterCents;
}

/**
 * What section 6.2 calls `withdrawable_cents`, which is what
 * `insufficient_funds` is measured against.
 *
 * EQUAL TO THE BALANCE TODAY BECAUSE NO HOLD IN THIS CORPUS CAN BE COMPUTED,
 * and that is a finding rather than an implementation. P-3 is the only rule
 * that holds a wallet BALANCE and ADR-158 clause 6 measured its input absent:
 * "no landed column carries that window's end for a purchase". `wallet.ts`
 * renders `held_cents: 0` for the same reason and states the same limit, so
 * this leg and the read leg agree: this door does not refuse an amount the
 * balance screen said was available.
 *
 * IT IS A FUNCTION AND NOT A CALL TO {@link balanceOf} AT THE SITE, so the day
 * P-3's input lands there is ONE place to subtract it.
 */
export function withdrawableCents(rows: readonly WalletEntryRow[]): bigint {
  return balanceOf(rows);
}

/**
 * P-1, which this tree cannot evaluate, so it is `false` and says so.
 *
 * READ THIS BEFORE CHANGING IT. M20 section 3.4's P-1 holds a withdrawal "whose
 * composition includes payout credits from accounts PURCHASED WITH PROMOTIONAL
 * CREDIT", and NOTHING IN THIS SCHEMA RECORDS THAT. `purchases.payment_method`
 * is `CHECK (payment_method IN ('psp', 'wallet', 'mixed'))` (`0006`) and has no
 * promotional member; `promotional_credit_grants.funding_purchase_id` (`0024`)
 * is the purchase that FUNDED a grant, which is the clawback read and the other
 * direction entirely; and `wallet_entries.reference_id` "declares no foreign
 * key" and is polymorphic over three kinds, so even the first hop is not a
 * traversal this schema supports.
 *
 * `false` IS THEREFORE HONEST AND NOT A DEFAULT: no review is in force because
 * nothing in this tree places one. What it must not be read as is "P-1 was
 * evaluated and found nothing". It takes the composition it cannot yet use so
 * that the day the input lands, the change is this function.
 */
export function provenanceReview(_composition: readonly CompositionEntry[]): boolean {
  return false;
}

// -----------------------------------------------------------------------------
// The FIFO composition, which is what makes `source_provenance_summary` mean
// anything (SD-M20-03, AS-M20-01, AS-M20-05)
// -----------------------------------------------------------------------------

/** What a composition run produced. */
export interface Composition {
  readonly entries: readonly CompositionEntry[];
  /** The oldest credit this withdrawal consumes. `earliest_credit_at`. */
  readonly earliestCreditAt: Date;
}

/** One credit still unspent, in the FIFO queue. */
interface Lot {
  readonly provenance: WalletProvenance;
  readonly occurredAt: Date;
  remaining: bigint;
}

/**
 * Oldest first, which is what FIFO means and what the composition is ordered
 * by.
 *
 * `(occurred_at, id)` AND NOT `occurred_at` ALONE. `wallet_entries` has no
 * unique constraint on the instant and two entries written in one transaction
 * share it by default, so the instant alone is not a total order and two runs
 * over the same rows could compose differently. The id half is a `bigint`
 * comparison and never a lexical one.
 */
export function oldestFirst(a: WalletEntryRow, b: WalletEntryRow): number {
  const at = a.occurredAt.getTime();
  const bt = b.occurredAt.getTime();
  if (at !== bt) return at < bt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The unspent credits, oldest first, after every debit has consumed from the
 * front.
 *
 * THE DEBITS CONSUME THE OLDEST CREDITS, WHICH IS THE HALF THAT MAKES THE
 * ANSWER RIGHT RATHER THAN MERELY ORDERED. A wallet that took a payout, then a
 * refund credit, then bought a reset has spent the PAYOUT, and a composition
 * that ignored the debit would compose the withdrawal out of money already
 * gone. M20 section 3.4: "a wallet holding $500 of settled payout and $99 of
 * refund_wallet_funded is not the same object as one holding $599 of payout."
 *
 * IT CROSS-CHECKS ITSELF AGAINST THE STORED RUNNING BALANCE AND THROWS ON A
 * DIVERGENCE. `0011` states what `balance_after_cents` is for: "a divergence
 * between the stored balance and the recomputed one is a detectable tamper
 * indication rather than an invisible one." This is the door where detecting it
 * is worth something, and the fail-closed answer is to refuse the withdrawal.
 */
export function unspentLots(rows: readonly WalletEntryRow[]): readonly Lot[] {
  const ordered = [...rows].sort(oldestFirst);
  const lots: Lot[] = [];
  let head = 0;
  for (const row of ordered) {
    if (row.direction === 'credit') {
      // ONE NARROWING, AT THE ONE PLACE A LOT NEEDS A CLASS. `WalletEntryRow`
      // is exported and a backend may construct one without going through
      // `toWalletEntryRow`, so this arm cannot take the row's word for it; and
      // a lot whose class is unknown makes every rule in M20 section 3.4
      // unevaluable, which is the fail-closed direction on the door that pays.
      if (row.provenance === null)
        throw new WithdrawalRowError(
          'a `wallet_entries` CREDIT carries no `provenance`, which ' +
            '`wallet_entries_provenance_follows_direction` (`0080`) refuses. A composition is ' +
            'what value is MADE of, so a lot with no class cannot enter one',
        );
      lots.push({
        provenance: row.provenance,
        occurredAt: row.occurredAt,
        remaining: row.amountCents,
      });
      continue;
    }
    let owed = row.amountCents;
    while (owed > 0n) {
      const lot = lots[head];
      if (lot === undefined)
        throw new WithdrawalRowError(
          `a \`wallet_entries\` debit of ${row.amountCents.toString()}c consumes more than the ` +
            'credits before it. `balance_after_cents` is `CHECK (balance_after_cents >= 0)`, so ' +
            'this set cannot be the whole statement and a composition over it would be fiction',
        );
      const taken = lot.remaining < owed ? lot.remaining : owed;
      lot.remaining -= taken;
      owed -= taken;
      if (lot.remaining === 0n) head += 1;
    }
  }
  const live = lots.slice(head).filter((lot) => lot.remaining > 0n);
  let total = 0n;
  for (const lot of live) total += lot.remaining;
  const stored = balanceOf(rows);
  if (total !== stored)
    throw new WithdrawalRowError(
      `the recomputed wallet balance ${total.toString()}c does not equal the stored running ` +
        `balance ${stored.toString()}c. \`0011\` keeps \`balance_after_cents\` so that this ` +
        'divergence is detectable rather than invisible, and this is the door where it matters',
    );
  return live;
}

/**
 * `amount` composed out of the unspent credits, oldest first.
 *
 * ONE ENTRY PER PROVENANCE, IN FIRST-CONSUMED ORDER, which is why this is a
 * SUMMARY. FIFO can take three lots of two classes; the wire shape is
 * `Array<{provenance, cents}>` and it carries no lot identity, so two entries
 * naming one class would be a breakdown a reader could only add back together.
 * The ORDER is still FIFO's, so the first entry is the oldest money.
 *
 * IT RETURNS `null` WHEN THE LOTS DO NOT COVER `amount`, and the caller answers
 * `insufficient_funds`. That case is already refused one step earlier against
 * {@link withdrawableCents}; it is checked again here because this function is
 * exported and a second caller must not be able to compose a withdrawal out of
 * money that is not there.
 */
export function composeFifo(lots: readonly Lot[], amountCents: bigint): Composition | null {
  if (amountCents <= 0n) return null;
  const cents = new Map<WalletProvenance, bigint>();
  const order: WalletProvenance[] = [];
  let owed = amountCents;
  let earliest: Date | null = null;
  for (const lot of lots) {
    if (owed === 0n) break;
    const taken = lot.remaining < owed ? lot.remaining : owed;
    if (taken === 0n) continue;
    if (earliest === null) earliest = lot.occurredAt;
    if (!cents.has(lot.provenance)) order.push(lot.provenance);
    cents.set(lot.provenance, (cents.get(lot.provenance) ?? 0n) + taken);
    owed -= taken;
  }
  if (owed > 0n || earliest === null) return null;
  return {
    entries: order.map((provenance) => ({
      provenance,
      cents: centsToJson(cents.get(provenance) ?? 0n),
    })),
    earliestCreditAt: earliest,
  };
}

/** {@link unspentLots} then {@link composeFifo}, which is the whole rule. */
export function composeWithdrawal(
  rows: readonly WalletEntryRow[],
  amountCents: bigint,
): Composition | null {
  return composeFifo(unspentLots(rows), amountCents);
}

// -----------------------------------------------------------------------------
// `G-DESTINATION-COOLING`, against `0051`'s registry
// -----------------------------------------------------------------------------

/** What the cooling gate decided, and what the caller must do about it. */
export type CoolingDecision =
  /** A row exists and its window has elapsed. `requested`. */
  | { readonly kind: 'cleared' }
  /** A row exists and its window is running. `cooling`, and nothing is written. */
  | { readonly kind: 'cooling'; readonly until: Date }
  /** No row exists. It is REGISTERED and cooled, and the withdrawal is `cooling`. */
  | { readonly kind: 'register'; readonly until: Date };

/**
 * `G-DESTINATION-COOLING`, read as `0051`'s header requires it to be read.
 *
 * AN ABSENT ROW IS "REGISTER IT AND COOL IT" AND NEVER "NOT COOLING". This is
 * the obligation `0051` places on this slice BY NAME, in the paragraph
 * explaining why `destination_ref` is byte-exact `text` rather than `citext`:
 * "Byte-exact is the fail-closed direction, and it is only fail-closed if the
 * reader treats an ABSENT ROW as 'register it and cool it' rather than as 'not
 * cooling'. That obligation is P5-h's and is recorded here because this file's
 * shape is what makes it load-bearing."
 *
 * SO THE FIRST DESTINATION AN IDENTITY EVER USES IS COOLED TOO, which ADR-169
 * section 3 rules deliberate rather than incidental: `C-11` says a CHANGE
 * triggers cooling, and "on an identity that has never withdrawn there is
 * nothing to change FROM, so a first-destination exemption is a hole that opens
 * on every account that has not yet used the rail, which at launch is all of
 * them".
 *
 * AN ELAPSED WINDOW IS NOT RE-ARMED. Registering a destination arms its window
 * once; a destination Merit has seen before whose window has elapsed is not a
 * change, and re-arming it would make `C-11` a control a trader can never get
 * past. `PAYOUT-DEST-C1` permits equality and refuses a backward move, so
 * nothing here can shorten a running window either.
 *
 * THE COMPARISON IS STRICT. `cooling_until` is the instant the window ENDS, so
 * a destination is cooling while `now < cooling_until` and cleared at exactly
 * that instant.
 */
export function coolingDecision(
  row: DestinationRow | undefined,
  at: Date,
  windowMs: number = DESTINATION_COOLING_WINDOW_MS,
): CoolingDecision {
  if (row === undefined) return { kind: 'register', until: new Date(at.getTime() + windowMs) };
  return at.getTime() < row.coolingUntil.getTime()
    ? { kind: 'cooling', until: row.coolingUntil }
    : { kind: 'cleared' };
}

// -----------------------------------------------------------------------------
// The port
// -----------------------------------------------------------------------------

/** The row this module writes into `wallet_withdrawals`. */
export interface WithdrawalInsert {
  readonly amountCents: bigint;
  readonly destinationRef: string;
  readonly status: CreatedStatus;
  readonly idempotencyKey: string;
  readonly requestedAt: Date;
  /**
   * `source_provenance_summary`, which is `jsonb NOT NULL DEFAULT '{}'`.
   *
   * WRITTEN AT CREATION AND NOT LEFT EMPTY, and the CHECK permits both.
   * `wallet_withdrawals_approved_has_provenance` REQUIRES a non-empty summary
   * from `approved` on and permits `'{}'` at `requested` and `cooling`, so
   * writing the real composition here is inside the constraint and is what M20
   * section 3.3's sequence asks for: "compose from wallet_entries, oldest first
   * (FIFO)" is a request-time step.
   *
   * A CAUTION THE CHECK CANNOT CARRY: `'[]'::jsonb <> '{}'::jsonb` is TRUE, so
   * an EMPTY ARRAY would satisfy `wallet_withdrawals_approved_has_provenance`
   * while carrying no composition at all. This module never writes one --
   * `composeFifo` returns `null` rather than an empty array, and `null` is a
   * refusal here -- and the weakness is reported rather than relied upon.
   */
  readonly sourceProvenanceSummary: readonly CompositionEntry[];
  readonly earliestCreditAt: Date;
}

/** The row this module writes into `payout_destinations` (`0051`). */
export interface DestinationInsert {
  readonly destinationRef: string;
  readonly firstSeenAt: Date;
  readonly coolingUntil: Date;
}

/**
 * What this module needs from one open transaction.
 *
 * EVERY METHOD IS SCOPED TO THE CALLER'S IDENTITY BY THE ACCESSOR BEFORE THIS
 * FILE SEES A ROW, so nothing here is a tenancy control and nothing here can
 * become one by accident. No method takes an identity.
 */
export interface WithdrawalTx {
  /**
   * `INV-M20-01`'s per-identity lock, held until this transaction ends.
   *
   * IT IS THE FIRST THING THE HANDLER DOES AND THE ORDER IS THE CONTROL. See
   * this file's header: `G-NO-IN-FLIGHT` on this leg is an application check
   * over a NON-UNIQUE index, so two concurrent requests that both read an empty
   * in-flight set both insert, and nothing refuses the second.
   */
  lockScope(): Promise<void>;

  /** This identity's own row. `identities` is the registry's only `root`. */
  identity(): Promise<IdentityRow>;

  /** The whole verification chain. {@link currentKycState} picks the head. */
  kycVerifications(): Promise<readonly unknown[]>;

  /** Every `wallet_withdrawals` row of this identity's. Filtered in memory. */
  withdrawals(): Promise<readonly WithdrawalStatusRow[]>;

  /** Every `wallet_entries` row of this identity's. The balance and the FIFO. */
  entries(): Promise<readonly WalletEntryRow[]>;

  /** One `payout_destinations` row, or `undefined`. A keyed lookup, `0051`. */
  destination(destinationRef: string): Promise<DestinationRow | undefined>;

  /** Register a destination and arm its window, in one INSERT. */
  registerDestination(row: DestinationInsert): Promise<void>;

  /** Write the withdrawal. Returns `wallet_withdrawals.id`. */
  insertWithdrawal(row: WithdrawalInsert): Promise<{ readonly id: string }>;

  /**
   * The same rows {@link WithdrawalTx.withdrawals} reads, in full.
   *
   * A SECOND READ OF ONE TABLE AND NOT A WIDENING OF THE FIRST.
   * `withdrawals()` returns `{ status }` because `G-NO-IN-FLIGHT` reads one
   * column and this file's header argues at length that the rows crossing this
   * boundary should be the ones the question needs. The approval edge needs the
   * amount, the destination and the halt, so it asks for them under its own
   * name rather than making the in-flight gate carry columns it does not read.
   */
  approvalCandidates(): Promise<readonly WithdrawalApprovalCandidate[]>;

  /**
   * `requested --> approved` or `cooling --> approved`, written. ADR-232.
   *
   * KEYED ON `id` AND SCOPED BY THE ACCESSOR, so this cannot advance another
   * identity's row even if a caller handed it one: `updateAt` carries the scope
   * predicate into the `WHERE` alongside the address (ADR-112).
   */
  approveWithdrawal(id: string, values: WithdrawalApprovalValues): Promise<void>;

  /**
   * `requested --> cancelled` or `cooling --> cancelled`, written. ADR-234.
   *
   * THE ONLY WRITE IN THIS INTERFACE THAT RELEASES AN IDENTITY.
   * `insertWithdrawal` opens a lockout and `approveWithdrawal` moves the row
   * from one open status to another; this is the method that takes it out of
   * `wallet_withdrawals_open_idx`'s predicate and lets the trader ask again.
   *
   * KEYED ON `id` AND SCOPED BY THE ACCESSOR, so this cannot terminate another
   * identity's row even if a caller handed it one: `updateAt` carries the scope
   * predicate into the `WHERE` alongside the address (ADR-112).
   */
  cancelWithdrawal(id: string, values: WithdrawalCancellationValues): Promise<void>;
}

/** What opens a transaction, plus the store the idempotency layer needs. */
export interface WithdrawalBackend {
  /** Run `fn` on one transaction. IT COMMITS ONLY IF `fn` RETURNS. */
  transact<T>(session: AuthSession, fn: (tx: WithdrawalTx) => Promise<T>): Promise<T>;

  /**
   * `idempotency_keys`, read and stamped OUTSIDE the withdrawal transaction.
   *
   * `payouts.ts`'s shape and its reason: "a claim that rolled back with a
   * failed request would be re-claimable, which is the retry becoming a second
   * payout".
   */
  readonly idempotency: IdempotencyStore;

  /** The clock. Injected so the suite can pin an instant. */
  readonly now: () => Date;
}

/** Thrown by the unwired backend. Answered as 503 rather than 500. */
export class WithdrawalBackendUnwired extends Error {
  constructor(method: string) {
    super(
      `WithdrawalBackend.${method} is not wired. The external leg is declared and its ` +
        'persistence is not installed, so this deployment answers 503 rather than opening a ' +
        'withdrawal it cannot record',
    );
    this.name = 'WithdrawalBackendUnwired';
  }
}

const UNWIRED_STORE: IdempotencyStore = {
  find: () => Promise.reject(new WithdrawalBackendUnwired('idempotency.find')),
  begin: () => Promise.reject(new WithdrawalBackendUnwired('idempotency.begin')),
  complete: () => Promise.reject(new WithdrawalBackendUnwired('idempotency.complete')),
};

/**
 * A backend that refuses every call.
 *
 * ON `payouts.ts`'s AND `wallet.ts`'s PRECEDENT AND FOR THEIR REASON: "a
 * backend that returned plausible values would be a fixture serving real
 * traffic", and on THIS route it would be a fixture telling a trader their cash
 * is on its way. The route is REGISTERED because the contract row exists; a
 * missing route answers 404 and reads as a contract Merit never wrote.
 */
export const UNWIRED_WITHDRAWAL_BACKEND: WithdrawalBackend = {
  transact: () => Promise.reject(new WithdrawalBackendUnwired('transact')),
  idempotency: UNWIRED_STORE,
  now: () => new Date(),
};

let backend: WithdrawalBackend = UNWIRED_WITHDRAWAL_BACKEND;

/** Install the backend. The wiring slice calls this; so does the suite. */
export function useWithdrawalBackend(next: WithdrawalBackend): void {
  backend = next;
}

/** Restore the fail-closed default. */
export function resetWithdrawalBackend(): void {
  backend = UNWIRED_WITHDRAWAL_BACKEND;
}

/** The installed backend. */
export function currentWithdrawalBackend(): WithdrawalBackend {
  return backend;
}

// -----------------------------------------------------------------------------
// WHY THE COMPLETE ADAPTER BELOW IS STILL NOT INSTALLED. ADR-342
// -----------------------------------------------------------------------------
// THE ADAPTER IS NOT WHAT REFUSES, AND THAT IS THE FINDING RATHER THAN AN
// APOLOGY FOR ONE. `databaseWithdrawalBackend` below is whole: every member of
// `WithdrawalTx` is served, the lock is real, the identity, KYC, in-flight,
// funds and cooling arms all run through `db.scoped`, and no float appears on
// any of them. A session reading only the port and only the adapter would
// conclude that one line in `start.ts` is all that stands between this route
// and service, and would be wrong for a reason neither file states.
//
// WHAT STANDS THERE IS THE ESTATE PAST THE INSERT. A withdrawal created here is
// `requested` or `cooling`; the arrow out of both is `G-WITHDRAWAL-CLEARED`
// into `approved`, which posts `LT-06` and extinguishes the wallet claim; past
// `approved` the only arrow is `transferring`, reached by enqueueing on a rail.
// THE DRIVER FOR THE FIRST OF THOSE NOW EXISTS AND NOTHING RUNS IT, and the
// rail is still a package with no socket. So a wired deployment would take a
// trader's withdrawal request and hold it at `requested` for as long as the
// estate stays as it is.
//
// AND THE ROUTE IS UNREACHABLE TODAY ANYWAY, WHICH IS AN ARGUMENT AGAINST
// INSTALLING RATHER THAN A REASON IT IS HARMLESS. See finding `E`: C-27 refuses
// every caller before this file's handler runs, so an install would change no
// response any client can observe, would be exercised by nothing, and would
// arm itself silently on the day a different row wires an elevation factor.
// An install whose first live request is one nobody was watching for is the
// defect this row was dispatched to end, arriving from the other side.
//
/**
 * WHY `useWithdrawalBackend` IS NOT CALLED, WITH THE SOURCES THAT SETTLE IT.
 *
 * {@link TERMINAL_EDGE_FINDINGS}'s SHAPE AND ITS DISCIPLINE, one port over:
 * each entry is `{id, claim, ruled, sources}`, the sources are paths a second
 * reader can open, and `wallet-withdrawals.test.ts` RUNS each claim against
 * this tree rather than against this comment. THE DAY ANY OF THESE IS
 * DISCHARGED THIS FILE'S SUITE GOES RED and the install is due a re-decision,
 * which is the whole point: a refusal recorded only in prose is a refusal that
 * outlives its reason, and this entry has already watched that happen nine
 * times in `wiring.test.ts`.
 */
export const INSTALL_BLOCKING_FINDINGS = [
  {
    id: 'D',
    claim:
      'the approval edge has a driver and NOTHING RUNS IT, which is a different sentence from ' +
      'the one this port carried for four corrections. runWithdrawalApprovals in ' +
      'apps/worker/src/withdrawals/approval-sweep.ts performs requested --> approved and ' +
      'cooling --> approved with the LT-06 posting in the same transaction, and ' +
      'apps/worker/src/sweeps/ledger.ts calls postTransaction with ' +
      'walletWithdrawalApprovalPosting, which packages/ledger/src/index.ts exports. So the ' +
      'driver, the builder and the manifest line all exist. WHAT DOES NOT EXIST IS AN ADAPTER ' +
      'FOR ITS OWN IO: UNWIRED_WITHDRAWAL_APPROVAL_IO is the only WithdrawalApprovalSweepIo in ' +
      'the tree and it refuses every call, and the job carries disposition unscheduled in ' +
      'apps/worker/src/schedule.ts.',
    ruled:
      'NOT RULED HERE AND NOT THIS ROW TO RULE. apps/worker/src/index.ts states the condition ' +
      'in its own words: the installation MUST NOT BE DISPATCHED BEFORE A PAYMENT RAIL EXISTS, ' +
      'because past approved there is no exit and 0072 WD-C2 refuses approved --> cancelled at ' +
      'the database. That is a founder-owed rail rather than a slice, so this port waits on ' +
      'the same condition its driver waits on, one deployable over.',
    sources: [
      'apps/worker/src/withdrawals/approval-sweep.ts',
      'apps/worker/src/withdrawals/ports.ts',
      'apps/worker/src/schedule.ts',
      'apps/worker/src/sweeps/ledger.ts',
    ],
  },
  {
    id: 'E',
    claim:
      'C-27 makes this route unreachable in a deployment, so the 503 the unwired port produces ' +
      'is itself unreachable and an install would be observable to nobody. Both endpoints ' +
      "declare required 'passkey or dual_channel'; authorize in routes/auth.ts answers " +
      'forbidden for any session that is not elevated, and endpointHandler applies it BEFORE ' +
      'spec.handle runs. No session can be elevated: databaseAuthBackend in src/auth-backend.ts ' +
      'declares elevate blocked on BOTH arms, the passkey arm for an absent WebAuthn ceremony ' +
      'and the dual_channel arm for absent SMS delivery. So every caller of this route is ' +
      'answered 403 by the factor gate and no request reaches the backend at all.',
    ruled:
      'RULED HERE, AND THE RULING IS THAT UNREACHABILITY ARGUES AGAINST THE INSTALL RATHER ' +
      'THAN FOR IT. An install that changes no observable response is an install nothing ' +
      'exercises and nothing can falsify, and it would go live on the day an unrelated row ' +
      'lands a WebAuthn ceremony or an SMS sender, carrying no signal that it had just opened ' +
      'the cash door. THE GATE IS NOT WEAKENED TO REACH THE ROUTE EITHER: C-27 is the ' +
      'authentication boundary and this file adds no second refusal and removes none.',
    sources: [
      'apps/api/src/routes/auth.ts',
      'apps/api/src/auth-backend.ts',
      'docs/architecture/SECURITY.md',
    ],
  },
  {
    id: 'F',
    claim:
      'the rail is unchanged since finding A was written and is what both of the above rest ' +
      'on. packages/rail opens no socket and names no vendor SDK by its own index.ts header, ' +
      'its only RailAdapter is SandboxRail under src/fakes/, and nothing imports the package.',
    ruled:
      'RULED IN FINDING A AND RESTATED HERE BECAUSE IT IS THIS PORT S BLOCKER TOO. Finding A ' +
      'holds it for settled and this entry holds it for the install: the same absent rail is ' +
      'why an approved withdrawal has no exit, and therefore why a requested one must not be ' +
      'openable through a door Merit cannot close.',
    sources: ['packages/rail/src/index.ts', 'packages/rail/src/port.ts'],
  },
] as const;

/**
 * The backend, reading and writing through the accessor.
 *
 * `db.scoped` AND NEVER `db.firm`. The identity is the one the handler resolved
 * from the session.
 *
 * `tx.rowAt('payoutDestinations', { destinationRef })` NAMES ONE ROW AND THE
 * HANDLE SUPPLIES THE OTHER HALF OF THE KEY. `0051`'s primary key is
 * `(identity_id, destination_ref)` and `identity_id` is the tenancy column, so
 * the caller MAY NOT name it and it counts toward the unique key anyway --
 * which is exactly the composition ADR-112's second draft was rewritten to
 * admit. The same is true of the INSERT: `identity_id` is written by the
 * accessor and is not in `DestinationInsert`.
 *
 * `idempotency` IS `databaseIdempotencyStore`, AND THIS PARAGRAPH IS A
 * CORRECTION RATHER THAN A DESIGN NOTE.
 *
 * IT READ that no implementation of `IdempotencyStore` exists in this tree,
 * "because `complete` is an UPDATE of exactly one row and `systemTx`/`firmTx`
 * hardcode `undefined` for the `WHERE`", on the strength of
 * [`idempotency.ts`](../idempotency.ts)'s own header, which says exactly that.
 * **THE HEADER IS STALE AND THE FILE BESIDE IT SAYS OTHERWISE**:
 * [`idempotency-store.ts:144`](../idempotency-store.ts) exports
 * `databaseIdempotencyStore(db: ApiDb): IdempotencyStore`, whose `find`,
 * `begin` and `complete` all run through `db.scoped` with keyed addresses, and
 * `idempotency-store.test.ts` covers it.
 *
 * THE OBJECTION DOES NOT REACH THAT STORE. `systemTx` and `firmTx` hardcode
 * `undefined` for the `WHERE` and this store opens NEITHER: it opens the
 * SCOPED door, which carries `scopePredicate` AND the address into the
 * predicate, which is precisely what `ADR-112` gave `updateAt` for.
 *
 * READING A HEADER INSTEAD OF THE FILE IT DESCRIBES is the error class
 * `MERIT_BUILD_MASTER_PROMPT`'s "caution learned the hard way" names, and the
 * claim is corrected where it was made rather than quietly swapped, because a
 * false sentence deleted leaves nothing for the next reader to check.
 */
export function databaseWithdrawalBackend(
  db: ApiDb,
  now: () => Date = () => new Date(),
): WithdrawalBackend {
  return {
    now,
    idempotency: databaseIdempotencyStore(db),
    transact: (session, fn) =>
      db.scoped(session.identityId, async (tx) =>
        fn({
          lockScope: async () => {
            await tx.lockScope();
          },
          identity: async () => {
            const rows = await tx.rows('identities');
            const row = rows[0];
            if (rows.length !== 1 || row === undefined)
              throw new WithdrawalRowError(
                `a scoped read of \`identities\` returned ${String(rows.length)} rows. The rule ` +
                  "is `root` on `id`, so it returns the caller's own row and exactly one",
              );
            return toIdentityRow(row);
          },
          kycVerifications: () => tx.rows('kycVerifications'),
          withdrawals: async () => (await tx.rows('walletWithdrawals')).map(toWithdrawalStatusRow),
          entries: async () => (await tx.rows('walletEntries')).map(toWalletEntryRow),
          destination: async (destinationRef) => {
            const row = await tx.rowAt('payoutDestinations', { destinationRef });
            return row === undefined ? undefined : toDestinationRow(row);
          },
          registerDestination: async (row) => {
            await tx.insert('payoutDestinations', {
              destinationRef: row.destinationRef,
              firstSeenAt: row.firstSeenAt,
              coolingUntil: row.coolingUntil,
            });
          },
          insertWithdrawal: async (row) => {
            const written = await tx.insert('walletWithdrawals', {
              amountCents: row.amountCents,
              destinationRef: row.destinationRef,
              status: row.status,
              idempotencyKey: row.idempotencyKey,
              requestedAt: row.requestedAt,
              sourceProvenanceSummary: row.sourceProvenanceSummary,
              earliestCreditAt: row.earliestCreditAt,
            });
            const first = written[0];
            if (first === undefined)
              throw new WithdrawalRowError('the `wallet_withdrawals` INSERT returned no row');
            return { id: text(asRow(first, 'walletWithdrawals'), 'id', 'walletWithdrawals') };
          },
          approvalCandidates: async () =>
            (await tx.rows('walletWithdrawals')).map(toApprovalCandidate),
          approveWithdrawal: async (id, values) => {
            await tx.updateAt(
              'walletWithdrawals',
              { id },
              {
                status: values.status,
                approvedAt: values.approvedAt,
                approvedBy: values.approvedBy,
                dualControlApprovalId: values.dualControlApprovalId,
                dualControlThresholdCents: values.dualControlThresholdCents,
                updatedAt: values.updatedAt,
              },
            );
          },
          cancelWithdrawal: async (id, values) => {
            await tx.updateAt(
              'walletWithdrawals',
              { id },
              {
                status: values.status,
                cancelledAt: values.cancelledAt,
                updatedAt: values.updatedAt,
              },
            );
          },
        }),
      ),
  };
}

// -----------------------------------------------------------------------------
// Validation. Total over the one shape section 6.2 declares, and hand written
// -----------------------------------------------------------------------------

type Validated<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly FieldError[] };

function asBody(body: unknown): Record<string, unknown> | null {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

/**
 * Section 6.2's body. BOTH members are required and neither has a default.
 *
 * `validation_failed` IS THE ANSWER FOR "non-integer, zero, negative, or below
 * the minimum", which is the contract's own error list for this row. THE
 * MINIMUM IS A `validation_failed` AND NOT AN `insufficient_funds`: the two
 * answer different questions, and a trader asking for 5,000c when they hold
 * 900,000c has enough money and has asked for too little.
 *
 * EVERY ERROR IS COLLECTED RATHER THAN THE FIRST RETURNED, because a client
 * that fixes one field at a time on the cash door is a client making two more
 * requests than it needs to.
 */
export function validateWithdrawalRequest(body: unknown): Validated<WithdrawalRequestBody> {
  const row = asBody(body);
  if (row === null) return { ok: false, errors: [{ path: '', message: 'body must be an object' }] };
  const errors: FieldError[] = [];

  const cents = centsFromJson(row['amount_cents']);
  if (cents === null)
    errors.push({ path: 'amount_cents', message: 'must be an integer number of cents' });
  else if (cents <= 0n) errors.push({ path: 'amount_cents', message: 'must be greater than zero' });
  else if (cents < MINIMUM_WITHDRAWAL_CENTS)
    errors.push({
      path: 'amount_cents',
      message: `must be at least ${MINIMUM_WITHDRAWAL_CENTS.toString()} cents`,
    });

  const destination = row['destination_ref'];
  if (typeof destination !== 'string' || destination === '')
    errors.push({
      path: 'destination_ref',
      message: 'must be a non-empty provider destination id',
    });

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      amount_cents: Number(cents),
      destination_ref: destination as string,
    },
  };
}

/**
 * `Idempotency-Key`, which section 1 makes REQUIRED on this endpoint.
 *
 * "The last of those is required by the SCHEMA rather than by this sentence":
 * `wallet_withdrawals.idempotency_key` is `text NOT NULL` under
 * `wallet_withdrawals_identity_idempotency_uq`, so a withdrawal without a key
 * is unwritable rather than merely undesirable.
 */
export function idempotencyKeyOf(request: FastifyRequest): string | null {
  const raw = request.headers['idempotency-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

// -----------------------------------------------------------------------------
// The refusals
// -----------------------------------------------------------------------------

interface ProblemDocument {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly instance: string;
  readonly detail?: string;
}

/**
 * A code section 2 defines that `server.ts`'s closed `TITLE` table does not
 * carry, because that table holds the codes the TRANSPORT can produce.
 */
function handlerProblem(
  code: string,
  title: string,
  status: number,
  instance: string,
  detail?: string,
): ProblemDocument {
  return {
    type: `${PROBLEM_TYPE_PREFIX}${code}`,
    title,
    status,
    code,
    instance,
    ...(detail === undefined ? {} : { detail }),
  };
}

/** Section 2: "The identity is restricted." */
export const IDENTITY_RESTRICTED = 'identity_restricted';
/** Section 2: "Account or identity under investigation." */
export const PAYOUTS_FROZEN = 'payouts_frozen';
/** Section 2: "Verification needed before this action." */
export const KYC_REQUIRED = 'kyc_required';

/**
 * The contract names this code on THREE endpoint rows and section 2's code
 * table does NOT carry it, which is reported rather than smoothed.
 *
 * `grep insufficient_funds docs/architecture/API_CONTRACT.md` returns the
 * `POST /wallet/withdrawals` row and two rows of the admin wallet-correction
 * surface, and section 2's table -- which `payouts.ts` records as CLOSED --
 * lists fifteen codes and not this one. So the CODE is the contract's and its
 * STATUS is not stated anywhere. `422` is taken because every other business
 * refusal in that table sits at 422 and this is one, and the alternative would
 * be inventing a code as well as a status. **A section 2 row is owed.**
 */
export const INSUFFICIENT_FUNDS = 'insufficient_funds';

/** A refusal decided inside the transaction, carried out of it. */
export interface Refusal {
  readonly send: (reply: FastifyReply, requestId: string) => FastifyReply;
}

function refuse(code: string, title: string, status: number, detail: string): Refusal {
  return {
    send: (reply, requestId) =>
      reply
        .code(status)
        .type(PROBLEM_MEDIA_TYPE)
        .send(handlerProblem(code, title, status, requestId, detail)),
  };
}

/** Thrown so a refusal decided mid-transaction rolls the transaction back. */
class RefusalThrown extends Error {
  readonly refusal: Refusal;
  constructor(refusal: Refusal) {
    super('withdrawal refused');
    this.name = 'RefusalThrown';
    this.refusal = refusal;
  }
}

/**
 * `G-WITHDRAWAL-CLEARED`'s identity-status term.
 *
 * THE PREDICATE IS `=== 'active'` AND NOT A LIST OF WHAT IS REFUSED, which is
 * ADR-075's own first reason: "`<>` fails open and `=` fails closed on every
 * value the enum gains later. A fourth `identity_status` value passes
 * `<> 'restricted'` silently on the day it is added and fails `= 'active'`
 * loudly on the same day. The form that breaks safely when a stranger widens a
 * type is the form an OUTBOUND door takes."
 *
 * ADR-075 IS `status: accepted` AND ITS FOUNDER APPROVAL WAS GRANTED
 * 2026-08-21. `M20:62`'s `INV-M20-06` and STATE_MACHINES'
 * `G-WITHDRAWAL-CLEARED` both read `= 'active'` and have since that date. The
 * contradiction several dispatches still carry -- that `INV-M20-06` blocks on
 * `restricted` while the payout gate reads `active` -- is CLOSED, and P5
 * section 5.1 measured that the stale text is `M20`'s `OQ-M20-07` BODY rather
 * than the invariant. Nothing here re-rules it.
 *
 * THE CODE IS `identity_restricted` FOR BOTH REFUSED VALUES and the imprecision
 * is recorded rather than smoothed: a `closed` identity is not restricted and
 * the code's name says it is. Section 2's code table is CLOSED, so a sixth
 * spelling would be a ruling; the `detail` carries what the code cannot. This
 * is `payouts.ts`'s reasoning, on the other extraction door, unchanged.
 */
export function gateIdentityStatus(status: IdentityStatus): Refusal | null {
  if (status === 'active') return null;
  return refuse(
    IDENTITY_RESTRICTED,
    'Identity restricted',
    422,
    `This identity is ${status} and cannot withdraw.`,
  );
}

/**
 * `identities.payouts_frozen`, which is a different refusal about the same
 * person.
 *
 * IT IS SEPARATE FROM THE STATUS GATE AND MUST STAY SEPARATE. API_CONTRACT
 * section 2: "`payouts_frozen` is per account or per payment and blocks one
 * door; a restriction is per human." Collapsing the two would answer one code
 * for two operationally different states, and the freeze is the reversible one.
 */
export function gatePayoutsFrozen(row: IdentityRow): Refusal | null {
  if (!row.payoutsFrozen) return null;
  return refuse(
    PAYOUTS_FROZEN,
    'Payouts frozen',
    422,
    'Payouts are frozen on this identity while an investigation is open.',
  );
}

/** `G-WITHDRAWAL-CLEARED`'s KYC term. Anything but `verified` refuses. */
export function gateKyc(state: KycState): Refusal | null {
  if (state === 'verified') return null;
  return refuse(
    KYC_REQUIRED,
    'Verification required',
    422,
    `Identity verification is \`${state}\` and an external withdrawal requires \`verified\`.`,
  );
}

/**
 * `G-NO-IN-FLIGHT`, scoped to this leg.
 *
 * FOUR STATUSES, FILTERED IN MEMORY, AND UNDER `lockScope()`. See
 * {@link OPEN_WITHDRAWAL_STATUSES} for why the list is the index's and this
 * file's header for why the lock is what makes the check a control.
 */
export function gateNoInFlight(rows: readonly WithdrawalStatusRow[]): Refusal | null {
  const open = rows.filter((row) =>
    (OPEN_WITHDRAWAL_STATUSES as readonly string[]).includes(row.status),
  );
  if (open.length === 0) return null;
  return refuse(
    'conflict',
    'Conflict',
    409,
    'A withdrawal is already open for this identity. One withdrawal is in flight at a time.',
  );
}

/** The balance term. Measured against `withdrawable_cents`, section 6.2. */
export function gateFunds(amountCents: bigint, rows: readonly WalletEntryRow[]): Refusal | null {
  const available = withdrawableCents(rows);
  if (amountCents <= available) return null;
  return refuse(
    INSUFFICIENT_FUNDS,
    'Insufficient funds',
    422,
    `This wallet holds ${available.toString()}c and the request is for ` +
      `${amountCents.toString()}c.`,
  );
}

// -----------------------------------------------------------------------------
// The ordered behavior, in one transaction
// -----------------------------------------------------------------------------

/** What a successful run decided, before it becomes a response. */
export interface CreatedWithdrawal {
  readonly id: string;
  readonly status: CreatedStatus;
  readonly amountCents: bigint;
  readonly destinationRef: string;
  readonly requestedAt: Date;
  readonly coolingUntil: Date | null;
  readonly composition: readonly CompositionEntry[];
  readonly earliestCreditAt: Date;
}

/**
 * The whole decision, on one transaction, in the order M05 section 1.1 and
 * STATE_MACHINES section 3.2 put it.
 *
 * THE LOCK IS FIRST AND EVERY GATE BELOW IS DECIDED UNDER IT. A gate evaluated
 * before the lock is a gate evaluated against a state another transaction can
 * still change.
 *
 * THE IDENTITY GATES COME BEFORE THE WALLET IS READ, which is `payouts.ts`'s
 * placement and its reason applied one door over: the refusal is about the
 * PERSON, and reading their money to tell them they may not have it is work
 * done on a decision already made.
 *
 * THE COOLING GATE RUNS AFTER THE FUNDS CHECK AND BEFORE THE INSERT, and the
 * order matters in one direction only: `register` WRITES a row, so a request
 * that is going to be refused for any other reason must be refused first. A
 * destination registered by a request that then failed on funds would carry a
 * `first_seen_at` earlier than the trader's first real use of it, and
 * `PAYOUT-DEST-C1` makes that column immutable.
 */
export async function decideWithdrawal(args: {
  readonly tx: WithdrawalTx;
  readonly amountCents: bigint;
  readonly destinationRef: string;
  readonly idempotencyKey: string;
  readonly at: Date;
}): Promise<CreatedWithdrawal | Refusal> {
  const { tx, amountCents, destinationRef, idempotencyKey, at } = args;

  await tx.lockScope();

  const identity = await tx.identity();
  const restricted = gateIdentityStatus(identity.status);
  if (restricted !== null) return restricted;
  const frozen = gatePayoutsFrozen(identity);
  if (frozen !== null) return frozen;

  const kyc = gateKyc(currentKycState(await tx.kycVerifications()));
  if (kyc !== null) return kyc;

  const inFlight = gateNoInFlight(await tx.withdrawals());
  if (inFlight !== null) return inFlight;

  const entries = await tx.entries();
  const funds = gateFunds(amountCents, entries);
  if (funds !== null) return funds;

  // The composition is computed BEFORE the destination is registered, for the
  // reason this function's doc gives: a throw here must not leave a
  // `first_seen_at` behind. `unspentLots` throws on a statement that cannot be
  // one, and that is a 500 rather than a refusal, deliberately: it is Merit's
  // records disagreeing with themselves and it is not the trader's fault.
  const composition = composeWithdrawal(entries, amountCents);
  if (composition === null) return gateFunds(amountCents, entries) ?? unreachableFunds(amountCents);

  const cooling = coolingDecision(await tx.destination(destinationRef), at);
  if (cooling.kind === 'register') {
    await tx.registerDestination({
      destinationRef,
      firstSeenAt: at,
      coolingUntil: cooling.until,
    });
  }
  const status: CreatedStatus = cooling.kind === 'cleared' ? 'requested' : 'cooling';
  const coolingUntil = cooling.kind === 'cleared' ? null : cooling.until;

  const written = await tx.insertWithdrawal({
    amountCents,
    destinationRef,
    status,
    idempotencyKey,
    requestedAt: at,
    sourceProvenanceSummary: composition.entries,
    earliestCreditAt: composition.earliestCreditAt,
  });

  return {
    id: written.id,
    status,
    amountCents,
    destinationRef,
    requestedAt: at,
    coolingUntil,
    composition: composition.entries,
    earliestCreditAt: composition.earliestCreditAt,
  };
}

// -----------------------------------------------------------------------------
// The approval edge, and the control that belongs on it
// -----------------------------------------------------------------------------
// ADR-232. MONEY PATH, E2 READ OWED ON EVERY LINE BELOW.
//
// STATE_MACHINES section 3.2 draws two arrows into `approved` and this file's
// own header records that nothing in this tree performs either. That is still
// true of the DRIVER and is no longer true of the TRANSITION: what follows is
// the edge written down, guarded, and given the founder's dual-control
// threshold, which is the one place on the external leg where a second human
// belongs.
//
// THE TWO GUARDS SHARE EVERY TERM BUT THEIR ORIGIN STATE, AND THE DRAWING DOES
// NOT SAY SO. STATE_MACHINES' guard table gives `G-WITHDRAWAL-CLEARED` four
// terms -- "KYC `verified`, destination outside its cooling window, provenance
// summary present, and `identities.status = 'active'`" (ADR-075) -- and gives
// `G-COOLING-ELAPSED` one, "the window elapsed". Read literally that would let
// a withdrawal leave `cooling` on the clock alone, with KYC expired and the
// identity restricted, because the strict guard is drawn only on the arrow out
// of `requested`. THE LOOSER READING IS REFUSED: the `cooling` arm carries
// every term of `G-WITHDRAWAL-CLEARED` and the clock as well, so waiting out a
// destination window can only ever require MORE of a row than not waiting.
// A guard that gets weaker the longer you wait is a queue an attacker joins.
//
// AND `payouts_frozen` AND A LIVE HALT ARE ADDED, NEITHER OF THEM DRAWN.
// `gatePayoutsFrozen` is already on the creation path one screen up, and a
// freeze that stops a trader opening a withdrawal while permitting the one they
// opened yesterday to be approved is a control with a doorway in it.
// `frozen_at` is the halt, which STATE_MACHINES calls orthogonal to the rail
// and enforces only against `settled`
// (`wallet_withdrawals_live_freeze_blocks_settlement`, `0031`). NO APPROVED
// DOCUMENT RULES WHETHER A HALTED WITHDRAWAL MAY BE APPROVED, and this file
// fails closed: approval is the edge on which `LT-06` moves the trader's
// balance into the firm's `withdrawals_in_flight` obligation (M06 `INV-M6-15`),
// so approving under an open investigation is the one direction the halt cannot
// be undone from cheaply. Reported as owed rather than as decided.

/** Which arrow of section 3.2's drawing a decision took. */
export const APPROVAL_GUARDS = ['G-WITHDRAWAL-CLEARED', 'G-COOLING-ELAPSED'] as const;

/** @see APPROVAL_GUARDS */
export type ApprovalGuard = (typeof APPROVAL_GUARDS)[number];

/**
 * Why an approval did not happen.
 *
 * NOT A {@link Refusal}. A guard that does not hold is "not yet" rather than
 * "no": there is no request to answer, no reply to send and no status code that
 * would be honest about it, and reusing the HTTP refusal here would mean this
 * transition could only ever be driven by a request. The two names that are not
 * "not yet" are `not_approvable`, which is a caller pointing this at a row the
 * machine does not admit, and `dual_control_required`, which is the control.
 */
export const APPROVAL_HOLDS = [
  'not_approvable',
  'identity_not_active',
  'payouts_frozen',
  'kyc_not_verified',
  'provenance_missing',
  'destination_cooling',
  'halted',
  'dual_control_required',
] as const;

/** @see APPROVAL_HOLDS */
export type ApprovalHold = (typeof APPROVAL_HOLDS)[number];

/** The statuses an approval may be taken FROM. Section 3.2's two arrow tails. */
export const APPROVABLE_STATUSES = ['requested', 'cooling'] as const;

/**
 * What the decision needs from one `wallet_withdrawals` row.
 *
 * `hasProvenance` IS A BOOLEAN AND NOT THE COMPOSITION, deliberately. The term
 * the guard tests is `wallet_withdrawals_approved_has_provenance`'s own
 * condition, `source_provenance_summary <> '{}'::jsonb AND earliest_credit_at
 * IS NOT NULL` (`0011:192-195`), which is a question about PRESENCE. Re-parsing
 * the composition here would be a second reader of a value this module wrote,
 * and the CHECK is the thing that has to agree with it.
 */
export interface WithdrawalApprovalCandidate {
  readonly id: string;
  readonly status: string;
  readonly amountCents: bigint;
  readonly destinationRef: string;
  readonly hasProvenance: boolean;
  /** `frozen_at`. The halt, which is not a status. */
  readonly frozenAt: Date | null;
}

/** `wallet_withdrawals` as {@link decideApproval} reads it. */
export function toApprovalCandidate(value: unknown): WithdrawalApprovalCandidate {
  const row = asRow(value, 'walletWithdrawals');
  const summary = row['sourceProvenanceSummary'];
  const hasEntries =
    summary !== null && summary !== undefined && Array.isArray(summary) && summary.length > 0;
  const frozen = row['frozenAt'];
  return {
    id: text(row, 'id', 'walletWithdrawals'),
    status: text(row, 'status', 'walletWithdrawals'),
    amountCents: big(row, 'amountCents', 'walletWithdrawals'),
    destinationRef: text(row, 'destinationRef', 'walletWithdrawals'),
    hasProvenance: hasEntries && row['earliestCreditAt'] instanceof Date,
    frozenAt:
      frozen === null || frozen === undefined
        ? null
        : instant(row, 'frozenAt', 'walletWithdrawals'),
  };
}

/**
 * The operator half of an approval, and `null` is the whole point of the type.
 *
 * `null` IS THE MACHINE ARM. Both guards on this edge are predicates naming no
 * human, so an approval that satisfied them has no operator to record; ADR-232
 * section 4 rules that a trader's own withdrawal never waits on one. A value
 * here is a named operator, and `0070`'s constraints are written over
 * `approved_by` for exactly that reason.
 */
export interface ApprovalHand {
  /** `wallet_withdrawals.approved_by`. An operator name, `0002`'s actor idiom. */
  readonly approvedBy: string;
  /** `dual_control_approvals.id`, or `null` when no second person has signed. */
  readonly dualControlApprovalId: string | null;
}

/** The columns an approval writes. `0070`. */
export interface WithdrawalApprovalValues {
  readonly status: 'approved';
  readonly approvedAt: Date;
  readonly approvedBy: string | null;
  readonly dualControlApprovalId: string | null;
  readonly dualControlThresholdCents: bigint | null;
  readonly updatedAt: Date;
}

/** What {@link decideApproval} concluded about one row. */
export type ApprovalDecision =
  | {
      readonly kind: 'approve';
      readonly guard: ApprovalGuard;
      readonly values: WithdrawalApprovalValues;
    }
  | { readonly kind: 'hold'; readonly hold: ApprovalHold };

/**
 * Whether a named operator needs a second person for this amount.
 *
 * THE CONSTANT IS IMPORTED AND NOT RESTATED. {@link DUAL_CONTROL_THRESHOLD_CENTS}
 * is `admin-wallet.ts`'s, landed by ADR-228 from the founder's answer of
 * 2026-08-29, and a second literal here would be a second number to move.
 *
 * `>=` AND NOT `>`. The founder's words are "above what payout amount", and
 * `0038:235-238`'s constraint -- the only dual-control comparison this estate
 * had before `0070` -- is `amount_cents < threshold OR approval IS NOT NULL`,
 * so the threshold amount ITSELF requires the second key there. `0070` carries
 * the identical comparison, and a route that disagreed with its own CHECK would
 * fail at COMMIT rather than refuse, which is a 500 where a hold belongs.
 */
export function dualControlRequired(amountCents: bigint, hand: ApprovalHand | null): boolean {
  if (hand === null) return false;
  return amountCents >= DUAL_CONTROL_THRESHOLD_CENTS;
}

/**
 * `requested --> approved` and `cooling --> approved`, decided and not written.
 *
 * TOTAL AND PURE. It takes rows and returns a decision, so every case below is
 * reachable from a test without a database, and the writing half is one
 * accessor call in {@link driveApprovals}.
 *
 * THE ORDER OF THE TERMS IS NOT ARBITRARY. The identity terms come first
 * because a restricted or frozen identity is a fact about the person rather
 * than about this row, and the dual-control term comes LAST because it is the
 * only one whose answer changes when a second person acts: reporting
 * `dual_control_required` on a row that is also missing its provenance would
 * send an operator to find a colleague for a withdrawal that would then be held
 * for a different reason anyway.
 */
export function decideApproval(args: {
  readonly candidate: WithdrawalApprovalCandidate;
  readonly identity: IdentityRow;
  readonly kyc: KycState;
  readonly destination: DestinationRow | undefined;
  readonly hand: ApprovalHand | null;
  readonly at: Date;
}): ApprovalDecision {
  const { candidate, identity, kyc, destination, hand, at } = args;

  if (!(APPROVABLE_STATUSES as readonly string[]).includes(candidate.status))
    return { kind: 'hold', hold: 'not_approvable' };

  if (identity.status !== 'active') return { kind: 'hold', hold: 'identity_not_active' };
  if (identity.payoutsFrozen) return { kind: 'hold', hold: 'payouts_frozen' };
  if (kyc !== 'verified') return { kind: 'hold', hold: 'kyc_not_verified' };
  if (candidate.frozenAt !== null) return { kind: 'hold', hold: 'halted' };
  if (!candidate.hasProvenance) return { kind: 'hold', hold: 'provenance_missing' };

  // THE DESTINATION TERM IS COMMON TO BOTH ARROWS. See this section's header:
  // the `cooling` arm carries every term of `G-WITHDRAWAL-CLEARED` and the
  // clock as well. A destination this tree has no row for has never started a
  // window, and `coolingDecision` treats that as `register`; here it is a hold,
  // because a window that has not started has not elapsed.
  if (destination === undefined || destination.coolingUntil.getTime() > at.getTime())
    return { kind: 'hold', hold: 'destination_cooling' };

  if (dualControlRequired(candidate.amountCents, hand) && hand?.dualControlApprovalId == null)
    return { kind: 'hold', hold: 'dual_control_required' };

  return {
    kind: 'approve',
    guard: candidate.status === 'cooling' ? 'G-COOLING-ELAPSED' : 'G-WITHDRAWAL-CLEARED',
    values: {
      status: 'approved',
      approvedAt: at,
      approvedBy: hand?.approvedBy ?? null,
      dualControlApprovalId: hand?.dualControlApprovalId ?? null,
      // RECORDED ONLY WHEN A HAND IS RECORDED, which is
      // `wallet_withdrawals_unapproved_records_no_approval` and
      // `wallet_withdrawals_operator_approval_records_threshold` (`0070`) read
      // together: the machine arm writes neither, and an operator arm writes
      // both or the row is unwritable.
      dualControlThresholdCents: hand === null ? null : DUAL_CONTROL_THRESHOLD_CENTS,
      updatedAt: at,
    },
  };
}

/** One row's outcome, for a driver that wants to say what it did. */
export interface ApprovalOutcome {
  readonly id: string;
  readonly decision: ApprovalDecision;
}

/**
 * The transition over one transaction: read, decide, write.
 *
 * UNDER `lockScope()` AND FOR THIS FILE'S HEADER'S REASON. Two doors advancing
 * the same identity's rows would both read `requested` and both write
 * `approved`, and `wallet_withdrawals_open_idx` IS NOT UNIQUE (ADR-158 finding
 * 8), so nothing in the database would catch the second.
 *
 * NOTHING IN THIS TREE CALLS IT, AND THAT IS RECORDED RATHER THAN LEFT TO BE
 * NOTICED. ADR-232 section 6: an approval is the edge on which `LT-06` posts
 * (M05 section 2.1, M06 `INV-M6-15`), a posting commits in the SAME transaction
 * as the state change that caused it (`0057`'s header item 3, ADR-006), and no
 * door in `apps/api` may open the ledger authority that posting needs (ADR-165,
 * ADR-172 clause 2). So the edge is written and guarded here and the driver is
 * owed to the slice that lands the posting. Approving without the posting would
 * mark money as leaving while the wallet still shows it, which is the half of a
 * mechanism this corpus has already paid for twice.
 */
export async function driveApprovals(args: {
  readonly tx: WithdrawalTx;
  readonly hand: ApprovalHand | null;
  readonly at: Date;
}): Promise<readonly ApprovalOutcome[]> {
  const { tx, hand, at } = args;

  await tx.lockScope();

  const identity = await tx.identity();
  const kyc = currentKycState(await tx.kycVerifications());
  const candidates = await tx.approvalCandidates();

  const outcomes: ApprovalOutcome[] = [];
  for (const candidate of candidates) {
    if (!(APPROVABLE_STATUSES as readonly string[]).includes(candidate.status)) continue;
    const destination = await tx.destination(candidate.destinationRef);
    const decision = decideApproval({ candidate, identity, kyc, destination, hand, at });
    if (decision.kind === 'approve') await tx.approveWithdrawal(candidate.id, decision.values);
    outcomes.push({ id: candidate.id, decision });
  }
  return outcomes;
}

// -----------------------------------------------------------------------------
// The TERMINAL edge, which is the one that releases a trader
// -----------------------------------------------------------------------------
// ADR-234. `withdrawalReleasesIdentity` above says which statuses end a lockout
// and ADR-232 left every one of them unreachable. STATE_MACHINES section 3.2
// draws three arrows into `[*]` and THIS FILE NOW DRIVES EXACTLY ONE OF THEM,
// which is not a shortfall against the row that dispatched it but the finding
// the row asked for: the other two are unreachable for a reason that is
// measured rather than argued, and {@link TERMINAL_EDGE_FINDINGS} is where each
// reason is written down with the command that settles it.
//
// THE ONE THAT LANDS IS `cancelled`, AND IT LANDS BECAUSE IT IS THE EXIT MONEY
// NEVER TRAVELS DOWN. `G-TRADER-CANCELS` is drawn from `requested` and from
// `cooling`, both BEFORE approval, so `LT-06` has not posted, the trader's
// wallet claim was never extinguished and there is nothing to discharge:
// `0057`'s `WD-C1` nets over zero rows and says so in its own comment. A
// cancellation moves no money, observes no rail and posts no ledger
// transaction, which is why it is buildable in a tree that has none of those
// things.
//
// `settled` AND `failed` ARE NOT BUILT AND THE ABSENCE IS A RULING. A
// withdrawal reaches either because a rail reported, and `packages/rail` opens
// no socket, has no adapter that is not a fake and has no importer at all. The
// row that dispatched this session granted that "if the rail cannot report, the
// terminal edge is an OPERATOR action rather than an automatic one". THE
// MEASUREMENT REFUSES EVEN THAT: an operator asserting a settlement is an
// operator asserting that money left through a package that cannot send it, and
// a withdrawal marked settled that never left tells a trader their money is gone
// and tells the ledger the same, and neither is true. See finding `A`.

/**
 * WHY TWO OF THE THREE TERMINAL ARROWS ARE NOT DRIVEN HERE.
 *
 * `LT_07_FINDINGS`'s SHAPE (`packages/rail/src/settlement.ts`) AND ITS
 * DISCIPLINE: each entry is `{id, claim, ruled, sources}`, the sources are
 * paths a second reader can open, and `wallet-withdrawals.test.ts` asserts each
 * claim against those sources rather than against this comment. So none of
 * these is prose that can go stale quietly: THE DAY ANY OF THEM IS FIXED THIS
 * FILE'S SUITE GOES RED, which is the trap the entry exists to set.
 */
export const TERMINAL_EDGE_FINDINGS = [
  {
    id: 'A',
    claim:
      'settled is unreachable because transferring is unreachable. Section 3.2 draws ' +
      'G-SETTLEMENT-CONFIRMED out of transferring and out of no other status, and reaching ' +
      'transferring is G-TRANSFER-QUEUED, which enqueues on a rail. packages/rail opens no ' +
      'socket and names no vendor SDK by its own index.ts header; its only implementation of ' +
      'RailAdapter is SandboxRail, which lives under src/fakes/; and NOTHING IMPORTS IT. ' +
      'Derived over apps and packages: a recursive search for the specifier @merit/rail across ' +
      'every .ts and .json file outside packages/rail itself returns zero lines, and the string ' +
      "'transferring' appears in that same scope outside test files at three sites, all three " +
      'of them vocabulary declarations and none of them a write.',
    ruled:
      'RULED HERE, AND THE RULING IS THAT THIS IS NOT AN OPERATOR ACTION EITHER. A withdrawal ' +
      'reaches settled because money moved. An operator who marks one settled in this tree is ' +
      'asserting that money left through a package with no socket, which is the one row ADR-234 ' +
      'refuses to make representable through a door. It is not held on a decision; it is held ' +
      'on a rail that does not exist, and the fix is a vendor and a webhook rather than a ' +
      'branch of a function.',
    sources: [
      'packages/rail/src/index.ts',
      'packages/rail/src/port.ts',
      'packages/rail/src/fakes/sandbox.ts',
      'docs/architecture/STATE_MACHINES.md',
    ],
  },
  {
    id: 'B',
    claim:
      'failed is unreachable for finding A reason AND for a second one underneath it. ' +
      'G-TRANSFER-EXHAUSTED is drawn out of transferring, so finding A already holds it; and ' +
      "0057's WD-C1 assertion 2 requires that a failed withdrawal carrying a provenance " +
      'summary name at least one ledger_transactions row, which is LT-09, the reversal of ' +
      'LT-06. EXECUTED against PostgreSQL 16.13 with every migration applied: an UPDATE ' +
      'carrying a provenanced row from transferring to failed with no posting RAISES WD-C1 at ' +
      'the moment a COMMIT would evaluate it.',
    ruled:
      'NOT RULED HERE AND DELIBERATELY NOT. The posting is the ledger arm, and no door in ' +
      'apps/api may open the authority it needs: ADR-165 declined SystemReason a member for it ' +
      'and ADR-172 clause 2 ruled the handle is not the missing thing, because the only value ' +
      'satisfying LedgerTx is generic over every table in the estate. ADR-176 applied that one ' +
      'leg over by moving the posting to a system authority and leaving the request path to ' +
      'record it. THE SAME SHAPE IS OWED HERE and apps/worker is outside this session fence.',
    sources: [
      'packages/db/migrations/0057_terminal_withdrawal_obligation.sql',
      'docs/decisions/ADR-165.md',
      'docs/decisions/ADR-172.md',
      'docs/decisions/ADR-176.md',
    ],
  },
  {
    id: 'C',
    claim:
      'cancelled is reachable TODAY and needs neither the rail nor the ledger. ' +
      'G-TRADER-CANCELS is drawn from requested and from cooling, both BEFORE approval, so ' +
      "LT-06 never posted and 0057's own COMMENT ON FUNCTION says the consequence in terms: " +
      'cancelled discharges nothing "because LT-06 never posted -- cancelled is reachable only ' +
      'from requested and cooling, both BEFORE approval, so its net is a sum over zero rows".',
    ruled:
      'RULED, BUILT AND NOW DRIVEN THROUGH A DOOR. decideCancellation and driveCancellation ' +
      'below are the edge, and 0072 is the half of it the database owes: WD-C1 rested that ' +
      'whole sentence on an arrow set NOTHING ENFORCED, and an UPDATE from approved to ' +
      'cancelled landed against this estate until 0072 refused it. THE SENTENCE THAT STOOD ' +
      'HERE UNTIL ADR-263 READ "WHAT IS STILL OWED IS A DOOR", on the ground that API_CONTRACT ' +
      'stated there was no endpoint that cancels a withdrawal and named the route "as owed ' +
      'rather than invented". ADR-263 moved that one paragraph and POST ' +
      '/wallet/withdrawals/:withdrawalId/cancel serves it, so this finding is the one of the ' +
      'three that is CLOSED. The other two are open for reasons that are not a door.',
    sources: [
      'packages/db/migrations/0057_terminal_withdrawal_obligation.sql',
      'packages/db/migrations/0072_terminal_withdrawal_transitions.sql',
      'docs/architecture/API_CONTRACT.md',
      'docs/architecture/STATE_MACHINES.md',
    ],
  },
] as const;

/** The statuses a cancellation may be taken FROM. Section 3.2's two arrow tails. */
export const CANCELLABLE_STATUSES = ['requested', 'cooling'] as const;

/**
 * Why a cancellation did not happen.
 *
 * SHORT, AND THE SHORTNESS IS THE RULING. {@link APPROVAL_HOLDS} has eight
 * members because approval is the edge on which money leaves the wallet, so
 * every term guards a movement: the identity's standing, the freeze, the KYC
 * chain, the provenance, the destination window, the second hand. A
 * CANCELLATION MOVES NOTHING. The money is where it already was, the trader is
 * withdrawing their own request, and a guard that refused it would trap the row
 * open and the identity behind it, which is the lockout this edge exists to
 * end. So there is no identity term, no KYC term, no destination term and no
 * dual control on this arrow, and each absence is this sentence rather than an
 * omission.
 */
export const CANCELLATION_HOLDS = ['not_cancellable', 'halted'] as const;

/** @see CANCELLATION_HOLDS */
export type CancellationHold = (typeof CANCELLATION_HOLDS)[number];

/** The columns a cancellation writes. `0072`. */
export interface WithdrawalCancellationValues {
  readonly status: 'cancelled';
  readonly cancelledAt: Date;
  readonly updatedAt: Date;
}

/** What {@link decideCancellation} concluded about one row. */
export type CancellationDecision =
  | {
      readonly kind: 'cancel';
      readonly guard: 'G-TRADER-CANCELS';
      readonly values: WithdrawalCancellationValues;
    }
  | { readonly kind: 'hold'; readonly hold: CancellationHold };

/**
 * `requested --> cancelled` and `cooling --> cancelled`, decided and not written.
 *
 * TOTAL AND PURE, which is {@link decideApproval}'s shape and its reason: every
 * case below is reachable from a test with no database and the writing half is
 * one accessor call.
 *
 * IT TAKES A {@link WithdrawalApprovalCandidate} AND THAT TYPE IS NOT
 * RE-DECLARED UNDER A SECOND NAME. It is this module's reading of one
 * `wallet_withdrawals` row and the cancellation needs three of its fields; a
 * parallel interface over the same columns would be a second thing to keep in
 * step with the same migration, which is the drift this file argues against
 * everywhere else.
 *
 * THE HALT IS THE ONE HOLD AND IT FAILS CLOSED, WHICH IS A RULING RATHER THAN A
 * DERIVATION AND THE DATABASE DOES NOT AGREE WITH IT. EXECUTED: `0072` and
 * every constraint on this table PERMIT an UPDATE carrying a halted `requested`
 * row to `cancelled`. The halt is orthogonal to the rail status (section 3.2),
 * so nothing in the schema reads it here. IT IS HELD ANYWAY, on ADR-232
 * section 5's direction one edge over: a halt is an investigation whose SUBJECT
 * is this row, cancelling destroys the subject, and a trader who may cancel a
 * halted withdrawal may open a fresh one the same second, which is the
 * investigation routed around rather than resolved. A founder or a later ADR
 * may overturn it and it is one branch of one function.
 */
export function decideCancellation(args: {
  readonly candidate: WithdrawalApprovalCandidate;
  readonly at: Date;
}): CancellationDecision {
  const { candidate, at } = args;

  if (!(CANCELLABLE_STATUSES as readonly string[]).includes(candidate.status))
    return { kind: 'hold', hold: 'not_cancellable' };

  if (candidate.frozenAt !== null) return { kind: 'hold', hold: 'halted' };

  return {
    kind: 'cancel',
    guard: 'G-TRADER-CANCELS',
    values: { status: 'cancelled', cancelledAt: at, updatedAt: at },
  };
}

/** One row's outcome, for a driver that wants to say what it did. */
export interface CancellationOutcome {
  readonly id: string;
  readonly decision: CancellationDecision;
}

/**
 * The transition over one transaction: read, decide, write.
 *
 * ONE ROW AND ADDRESSED BY `id`, WHERE {@link driveApprovals} SWEEPS. The
 * asymmetry is the two edges' own: an approval is taken on whatever has become
 * ready, so its driver reads a set; a cancellation is a trader naming the
 * withdrawal they no longer want, so its driver reads one. A cancellation
 * sweep would cancel rows nobody asked about.
 *
 * UNDER `lockScope()` FOR THIS FILE'S HEADER'S REASON, AND HERE THE REASON IS
 * SHARPER THAN ON THE APPROVAL EDGE. `wallet_withdrawals_open_idx` is not
 * unique (ADR-158 finding 8), so `G-NO-IN-FLIGHT` is an application check on
 * the leg that moves cash. THIS TRANSITION IS THE ONE THAT MAKES THAT CHECK
 * PASS: a cancellation racing a creation would release the identity while the
 * creation was deciding against a set that still held the open row, and the
 * lock is what orders them.
 *
 * A MISSING ROW IS `not_cancellable` AND NOT A THROW. The accessor scopes every
 * read to the caller's identity before this file sees a row, so an `id` that
 * resolves to nothing is either a row of somebody else's or a row that does not
 * exist, and those two must be indistinguishable from outside: a driver that
 * threw on one and held on the other would answer the question of whether an
 * arbitrary withdrawal id belongs to another trader.
 *
 * NOTHING IN THIS TREE CALLS IT, AND THAT IS RECORDED RATHER THAN LEFT TO BE
 * NOTICED. API_CONTRACT states in terms that "there is no endpoint that cancels
 * a withdrawal" and that G-TRADER-CANCELS is "named here as owed rather than
 * invented"; that document is `approved` and is outside this session's fence,
 * so minting a route would be inventing the row it declines to invent. This is
 * ADR-232's own restraint applied to the neighbouring arrow.
 */
export async function driveCancellation(args: {
  readonly tx: WithdrawalTx;
  readonly id: string;
  readonly at: Date;
}): Promise<CancellationOutcome> {
  const { tx, id, at } = args;

  await tx.lockScope();

  const candidate = (await tx.approvalCandidates()).find((row) => row.id === id);
  if (candidate === undefined) return { id, decision: { kind: 'hold', hold: 'not_cancellable' } };

  const decision = decideCancellation({ candidate, at });
  if (decision.kind === 'cancel') await tx.cancelWithdrawal(id, decision.values);
  return { id, decision };
}

/**
 * A {@link CancellationHold} as the refusal the door sends. ADR-263.
 *
 * BOTH HOLDS ARE `conflict` AND `409`, AND THE CODE IS NOT THIS FILE'S TO
 * CHOOSE. API_CONTRACT section 2's code table is CLOSED -- `payouts.ts` records
 * that and {@link INSUFFICIENT_FUNDS} pays the price of the one exception --
 * and a cancellation refused for either reason is a request against a row whose
 * STATE will not take it, which is what `conflict` names. Minting a
 * `not_cancellable` code would be widening a closed vocabulary to improve a
 * message, and the `detail` carries what the code cannot.
 *
 * `not_cancellable` ANSWERS THREE DIFFERENT SITUATIONS WITH ONE BYTE-IDENTICAL
 * DOCUMENT AND THAT IS THE CONTROL RATHER THAN AN IMPRECISION. A withdrawal id
 * that names no row, one that names another trader's row, and one that names
 * the caller's own row at a status `G-TRADER-CANCELS` is not drawn from all
 * arrive here as `not_cancellable`, because {@link driveCancellation} reads
 * through an accessor that has already scoped the rows to the caller. A detail
 * naming the row's current status would answer the first two apart from the
 * third, which is the question of whether an arbitrary withdrawal id belongs to
 * somebody else -- and section 13's ruling 1 is that existence is not confirmed
 * to a stranger. So the sentence is written about the MACHINE and never about
 * the row.
 *
 * THE HALT IS THE ONE HOLD THAT MAY NAME ITSELF, and the ground is that it is
 * already the trader's to see: section 6.2 renders the halt to the trader as
 * `{ halted_at, resolves_by } | null` on a subsequent read, so a refusal that
 * says a halt is running discloses nothing that door does not. It is a separate
 * detail because a trader told only "this cannot be cancelled" would retry, and
 * a trader told an investigation is open knows to wait for it.
 */
export function cancellationRefusal(hold: CancellationHold): Refusal {
  if (hold === 'halted')
    return refuse(
      'conflict',
      'Conflict',
      409,
      'This withdrawal is held while an investigation is open and cannot be cancelled until ' +
        'the hold is released.',
    );
  return refuse(
    'conflict',
    'Conflict',
    409,
    'This withdrawal cannot be cancelled. `G-TRADER-CANCELS` is drawn from `requested` and ' +
      'from `cooling` and from no other status.',
  );
}

/**
 * The refusal for a composition that came up short against a balance that said
 * it would not.
 *
 * IT IS UNREACHABLE TODAY AND IT IS NOT AN `unreachable` THROW. `gateFunds`
 * compares against the same rows `composeWithdrawal` walks, and `unspentLots`
 * throws rather than returns when the two disagree -- so the only way here is a
 * future change that makes `withdrawableCents` larger than the lots. On the
 * cash door the fail-closed answer to "these two disagree" is to refuse, and a
 * `500` would be the same refusal with a worse label.
 */
function unreachableFunds(amountCents: bigint): Refusal {
  return refuse(
    INSUFFICIENT_FUNDS,
    'Insufficient funds',
    422,
    `This wallet cannot compose ${amountCents.toString()}c out of its unspent credits.`,
  );
}

/** Section 6.2's `WithdrawalResponse`, built field by field. */
export function renderWithdrawal(created: CreatedWithdrawal): WithdrawalResponse {
  return {
    withdrawal_id: created.id,
    status: created.status,
    amount_cents: centsToJson(created.amountCents),
    destination_ref: created.destinationRef,
    requested_at: created.requestedAt.toISOString(),
    cooling_until: created.coolingUntil === null ? null : created.coolingUntil.toISOString(),
    composition: created.composition,
    earliest_credit_at: created.earliestCreditAt.toISOString(),
    provenance_review: provenanceReview(created.composition),
    // "a withdrawal cannot be created halted". The freeze trio is all-or-none
    // under `wallet_withdrawals_freeze_is_complete` and this INSERT writes none
    // of it, so the field is a constant rather than a read.
    halt: null,
  };
}

// -----------------------------------------------------------------------------
// The endpoint
// -----------------------------------------------------------------------------

/**
 * The response as a `JsonValue`, built field by field.
 *
 * A CONSTRUCTION AND NOT A CAST. `payouts.ts` writes `response as unknown as
 * JsonValue` at the same call site; the two are equivalent today and stop being
 * equivalent the moment a field of a non-JSON type is added, at which point the
 * cast stores it and this function does not compile. `readonly` arrays and
 * `readonly` properties are what `tsc` refuses here, and copying them is the
 * whole of the difference.
 */
function toJsonBody(response: WithdrawalResponse): JsonValue {
  return {
    withdrawal_id: response.withdrawal_id,
    status: response.status,
    amount_cents: response.amount_cents,
    destination_ref: response.destination_ref,
    requested_at: response.requested_at,
    cooling_until: response.cooling_until,
    composition:
      response.composition === null
        ? null
        : response.composition.map((entry) => ({
            provenance: entry.provenance,
            cents: entry.cents,
          })),
    earliest_credit_at: response.earliest_credit_at,
    provenance_review: response.provenance_review,
    halt: response.halt,
  };
}

/** An unwired backend is a 503 and never a 500. Anything else is the transport's. */
function unwiredOrThrow(err: unknown, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  if (!(err instanceof WithdrawalBackendUnwired)) throw err;
  request.log.error({ err }, 'withdrawal backend is not wired');
  return reply
    .code(503)
    .type(PROBLEM_MEDIA_TYPE)
    .send({ ...problem('service_unavailable', 503, request.id), title: 'Service unavailable' });
}

/**
 * The raw request body, for the idempotency hash.
 *
 * `payouts.ts`'s function and its stated limitation: without a capture hook two
 * bodies that parse equal and serialise differently hash the same, which makes
 * the `idempotency_key_reuse` check slightly WEAKER than section 1 specifies
 * and never stronger.
 */
/**
 * `:withdrawalId`, or `null` when the segment is absent or empty.
 *
 * A `null` HERE IS ANSWERED AS `not_cancellable` AND NOT AS A VALIDATION ERROR,
 * which is one refusal fewer rather than one shape more. Fastify cannot match
 * this route without a non-empty segment, so the branch is unreachable through
 * the transport; what it is really answering is "this id names no row", which
 * is the answer {@link cancellationRefusal} already gives to an id that names
 * nothing, and giving it a second spelling would tell a caller the difference
 * between a malformed id and a stranger's.
 */
function withdrawalIdParam(request: FastifyRequest): string | null {
  const params: unknown = request.params;
  if (typeof params !== 'object' || params === null) return null;
  const value = (params as Record<string, unknown>)['withdrawalId'];
  return typeof value === 'string' && value !== '' ? value : null;
}

function rawBodyOf(request: FastifyRequest): Uint8Array {
  const raw = (request as { rawBody?: unknown }).rawBody;
  if (raw instanceof Uint8Array) return raw;
  if (typeof raw === 'string') return new TextEncoder().encode(raw);
  if (request.body === undefined || request.body === null) return new Uint8Array(0);
  return new TextEncoder().encode(JSON.stringify(request.body));
}

/**
 * API_CONTRACT section 6.2's `POST /wallet/withdrawals`.
 *
 * `required: 'passkey or dual_channel'` AND `c27: 'external withdrawal'`, which
 * is section 12's row and section 6.2's own "Auth: session, and ELEVATED". THIS
 * FILE ADDS NO SECOND REFUSAL -- see the header, and M05 section 3.6.
 *
 * THE ANSWER IS `200` AND NOT `201`, which the contract does not state either
 * way. `payouts.ts` returns 200 on the other money-path creation and
 * `completeIdempotent` stores the status a replay will return verbatim, so two
 * creation doors answering differently would be a difference a client has to
 * learn per endpoint. Reported as owed rather than decided in the contract.
 */
export const WITHDRAWAL_ENDPOINTS: readonly EndpointSpec[] = [
  {
    method: 'POST',
    path: WITHDRAWALS_PATH,
    required: 'passkey or dual_channel',
    c27: 'external withdrawal',
    handle: withSessionContext(async ({ request, reply, session }) => {
      const key = idempotencyKeyOf(request);
      if (key === null)
        return reply
          .code(400)
          .type(PROBLEM_MEDIA_TYPE)
          .send({
            ...problem('validation_failed', 400, request.id),
            errors: [
              {
                path: 'Idempotency-Key',
                message: `this header is required on ${WITHDRAWALS_ENDPOINT}`,
              },
            ],
          });

      const validated = validateWithdrawalRequest(request.body);
      if (!validated.ok)
        return reply
          .code(400)
          .type(PROBLEM_MEDIA_TYPE)
          .send({ ...problem('validation_failed', 400, request.id), errors: validated.errors });

      const active = currentWithdrawalBackend();
      const scope = identityScope(session.identityId);
      const at = active.now();

      let outcome: IdempotencyOutcome;
      try {
        // OVER THE RAW BYTES AND NEVER OVER A PARSED BODY RE-SERIALISED, which
        // is `payouts.ts`'s rule: a hash taken after a parse makes "an
        // identical body" a property of this process's serialiser.
        outcome = await beginIdempotent(
          active.idempotency,
          scope,
          WITHDRAWALS_ENDPOINT,
          key,
          rawBodyOf(request),
        );
      } catch (err) {
        return unwiredOrThrow(err, request, reply);
      }

      // Section 1: "Replaying a key with an identical body returns the original
      // response VERBATIM." On this door a re-run would be a second withdrawal.
      if (outcome.kind === 'replay') return reply.code(outcome.status).send(outcome.body);
      const refusalDoc = problemForOutcome(outcome, request.id);
      if (refusalDoc !== null)
        return reply.code(refusalDoc.status).type(PROBLEM_MEDIA_TYPE).send(refusalDoc);
      if (outcome.kind !== 'fresh') {
        /* c8 ignore next 2 */
        throw new Error('unreachable: every non-fresh outcome is a replay or a problem');
      }

      let response: WithdrawalResponse;
      try {
        response = await active.transact(session, async (tx) => {
          const decided = await decideWithdrawal({
            tx,
            amountCents: BigInt(validated.value.amount_cents),
            destinationRef: validated.value.destination_ref,
            idempotencyKey: key,
            at,
          });
          // A REFUSAL DECIDED INSIDE THE TRANSACTION IS THROWN OUT OF IT rather
          // than returned, so the transaction rolls back whatever it had
          // already written. On this route that is not theoretical: the
          // destination registration is a write, and a refusal after it must
          // not leave a `first_seen_at` behind.
          if ('send' in decided) throw new RefusalThrown(decided);
          return renderWithdrawal(decided);
        });
      } catch (err) {
        if (err instanceof RefusalThrown) {
          // THE KEY IS NOT STAMPED ON A REFUSAL, which is `payouts.ts`'s rule:
          // stamping it would make a trader who fixed the cause and retried
          // with the same key read their own old refusal back.
          return err.refusal.send(reply, request.id);
        }
        return unwiredOrThrow(err, request, reply);
      }

      try {
        await completeIdempotent(active.idempotency, scope, outcome, 200, toJsonBody(response));
      } catch (err) {
        return unwiredOrThrow(err, request, reply);
      }
      return response;
    }),
  },
  // ---------------------------------------------------------------------------
  // API_CONTRACT section 6.2's `POST /wallet/withdrawals/:withdrawalId/cancel`,
  // WHICH IS THE DOOR ADR-234 LEFT OWED. ADR-263
  // ---------------------------------------------------------------------------
  // `driveCancellation` HAS BEEN WRITTEN, GUARDED AND TESTED SINCE ADR-234 AND
  // NOTHING CALLED IT, and the consequence was not academic: every open status
  // is a member of `OPEN_WITHDRAWAL_STATUSES`, so a wired deployment gave a
  // trader a withdrawal they could open and no way to close, and `gateNoInFlight`
  // then refused that identity's every later withdrawal behind a screen saying
  // one was in flight. THE EDGE EXISTED AND HAD NO DOOR.
  //
  // THE FACTOR IS `passkey or dual_channel` AND NO `c27` TAG IS SET, AND THE
  // TWO HALVES OF THAT ARE DECIDED SEPARATELY.
  //
  //   THE TAG IS WITHHELD BECAUSE C-27's ACTION LIST IS CLOSED AT THREE and
  //   `auth.ts` says so in terms: "a fourth sensitive action is a ruling and not
  //   a value". C-27 names payout destination change, contact change and
  //   external withdrawal. A cancellation is money STAYING, so tagging it
  //   `external withdrawal` would record that this door performs the act C-27
  //   guards, which is false, and CI-06k reads section 12's matrix rather than
  //   this field either way.
  //
  //   THE FACTOR IS TAKEN ANYWAY AND THE GROUND IS THE RESOURCE RATHER THAN THE
  //   ACT: a single-factor session may not alter a `wallet_withdrawals` row that
  //   a single-factor session could not have created. AND IT COSTS THE TRADER
  //   NOTHING THEY HAVE NOT ALREADY PAID, which is the answer to the obvious
  //   objection that a guard on this arrow is the lockout arriving by another
  //   route. A withdrawal exists only because an ELEVATED session opened it, and
  //   a trader who cannot elevate cannot open the next one either, so elevation
  //   here never converts a reversible refusal into a permanent one: it holds
  //   the release for exactly as long as it holds the request. ADR-263 section
  //   4 records what a founder read may overturn and it is one field.
  //
  // NO IDEMPOTENCY KEY, AND THE SAFETY IS A PROPERTY RATHER THAN A PROMISE.
  // Section 1's required set is four endpoints and the creation's membership is
  // "required by the schema rather than by this sentence" -- `wallet_withdrawals.
  // idempotency_key` is `text NOT NULL`. THIS DOOR WRITES NO ROW. A retry finds
  // the row already `cancelled`, `decideCancellation` holds `not_cancellable`
  // and NOTHING IS WRITTEN A SECOND TIME, so the key would be protecting a write
  // that a retry does not perform. THE COST IS STATED RATHER THAN HIDDEN: a
  // client whose first response was lost reads `409` on the retry instead of the
  // original `200`, and has to re-read the withdrawal to learn it succeeded.
  //
  // AND THAT RETRY IS THE ONE PLACE THE DATABASE DOES NOT BACK THIS HANDLER UP,
  // WHICH IS WHY THE `not_cancellable` HOLD IS LOAD BEARING RATHER THAN
  // COSMETIC. `0072`'s trigger fires `WHEN (OLD.status IS DISTINCT FROM
  // NEW.status ...)`, so an UPDATE writing `cancelled` over `cancelled` does not
  // fire it at all and both CHECKs are satisfied by the row it produces:
  // EXECUTED against PostgreSQL 16 with every migration applied, a second
  // cancellation of an already-cancelled row LANDS and MOVES `cancelled_at`.
  // The status is immutable at the database and the terminal CLOCK is not, so
  // the application check is what stands between a retried cancel and a moved
  // record of when a trader took their money back (ADR-263 section 3).
  //
  // ON EVERY OTHER ARROW THE DATABASE IS THE BACKSTOP AND THE HANDLER IS NOT
  // ALONE. `WD-C2` refuses `approved --> cancelled`, `transferring -->
  // cancelled` and any UPDATE that leaves a terminal status, so a cancellation
  // that raced an approval past `lockScope()` would be refused by the trigger
  // rather than merely by `decideCancellation`. SUCH A REFUSAL REACHING THIS
  // HANDLER IS A 500 AND DELIBERATELY NOT A 409: it means the application check
  // and the database disagreed about one row, which is a defect in this
  // deployment and not a fact about the caller's request, and parsing a
  // constraint name out of a driver error to answer it politely would put a
  // second reader of `WD-C2` in the one place nothing would ever check it.
  {
    method: 'POST',
    path: WITHDRAWAL_CANCEL_PATH,
    required: 'passkey or dual_channel',
    handle: withSessionContext(async ({ request, reply, session }) => {
      const id = withdrawalIdParam(request);
      const active = currentWithdrawalBackend();
      const at = active.now();

      let outcome: CancellationOutcome;
      try {
        // THE WHOLE TRANSITION IS ONE TRANSACTION AND THE HANDLER DECIDES
        // NOTHING. `driveCancellation` takes the lock, reads the row and
        // decides; this door supplies the id, the clock and the wire.
        //
        // A HOLD IS RETURNED OUT OF THE TRANSACTION AND NOT THROWN OUT OF IT,
        // WHICH IS THE OPPOSITE OF THE CREATION DOOR AND FOR THE CREATION
        // DOOR'S OWN REASON. `RefusalThrown` exists there because a refusal
        // decided after `registerDestination` must roll back a write, and
        // `first_seen_at` is immutable under `PAYOUT-DEST-C1`. THIS PATH WRITES
        // NOTHING ON A HOLD: the only write in it is `cancelWithdrawal`, which
        // the decision reaches or does not, so the transaction that commits
        // after a hold commits nothing at all and a throw would buy a rollback
        // of no rows.
        outcome = await active.transact(session, (tx) =>
          driveCancellation({ tx, id: id ?? '', at }),
        );
      } catch (err) {
        return unwiredOrThrow(err, request, reply);
      }

      if (outcome.decision.kind === 'hold')
        return cancellationRefusal(outcome.decision.hold).send(reply, request.id);

      const body: WithdrawalCancellationResponse = {
        withdrawal_id: outcome.id,
        status: 'cancelled',
        cancelled_at: outcome.decision.values.cancelledAt.toISOString(),
      };
      return body;
    }),
  },
];

/** The declaration as data, on `auth.ts`'s shape. Section 12's factor column. */
export const WITHDRAWAL_REQUIRED_FACTORS = requiredFactorTable(WITHDRAWAL_ENDPOINTS);

export default defineRoutes({
  name: 'wallet-withdrawals',
  routes: toRoutes(WITHDRAWAL_ENDPOINTS),
});
