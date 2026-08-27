// =============================================================================
// apps/api/src/routes/wallet.ts
// =============================================================================
// API_CONTRACT SECTION 6.2's `GET /wallet` AND `GET /wallet/entries`. THE
// BALANCE A TRADER ACTS ON, AND THE STATEMENT IT IS COMPOSED FROM.
//
// The rows this file serves were written by ADR-158 FROM THE CHECK rather than
// from a plan's prose, after seven contract-schema disagreements were found. So
// the contract is the specification here and it is right; where this file
// disagrees with it, the disagreement is recorded as a finding and not papered.
//
// -----------------------------------------------------------------------------
// THE BALANCE IS THE ROW WITH THE GREATEST `id`, AND NOT THE GREATEST
// `occurred_at`. THIS IS THE ONE THING IN THIS FILE MOST LIKELY TO BE "FIXED"
// INTO A DEFECT
// -----------------------------------------------------------------------------
// `wallet_entries.balance_after_cents` is a STORED running balance, and `0011`
// states what it is for: "a divergence between the stored balance and the
// recomputed one is a detectable tamper indication rather than an invisible
// one". It is computed AT APPEND TIME, so the current balance is the balance
// carried by the row that was appended LAST. `id` is `bigint GENERATED ALWAYS AS
// IDENTITY`, which is append order; `occurred_at` is `timestamptz NOT NULL
// DEFAULT now()` and is the business instant, which a correction or a backfill
// may legitimately set to the past.
//
// THE STATEMENT'S ORDER IS A DIFFERENT QUESTION AND THE CONTRACT ANSWERS IT
// SEPARATELY: `GET /wallet/entries` is "`occurred_at` descending, which is
// `wallet_entries_identity_idx`'s own order". So this file orders by
// `occurred_at` for the LIST and reads the balance off `max(id)`, and the two
// disagree exactly when a row is backdated. Ordering the balance by
// `occurred_at` would render a stale figure the moment one is.
//
// -----------------------------------------------------------------------------
// `held_cents` IS 0 ON EVERY RESPONSE THIS TREE CAN PRODUCE, AND THAT IS A
// FINDING RATHER THAN AN IMPLEMENTATION
// -----------------------------------------------------------------------------
// M20 section 3.4's P-3 is "payout credits from an account whose funding
// purchase is STILL INSIDE THE CHARGEBACK WINDOW are withdrawable only after
// that window closes", and it is the only rule in the corpus that holds a
// wallet BALANCE. ADR-158 clause 6 already measured the input and found it
// absent: "no landed column carries that window's end for a purchase", verified
// by a grep over every migration that returns
// `affiliate_commissions.chargeback_window_ends_on` and nothing else.
// `OQ-M20-02` asks how long the hold is and is OPEN; `DEP-M20-03` is the
// dependency that would make it computable and is UNBUILT.
//
// THE ABSENCE DECIDES MEMBERSHIP AND NOT ONLY THE RELEASE TIME, WHICH IS HALF A
// STEP FURTHER THAN CLAUSE 6 GOES. That clause makes `available_at` null
// because the window's end is unknown. The same unknown decides whether a
// credit is INSIDE the window at all, so `cents` and `since` are as
// uncomputable as `available_at` is, and a `WalletHold` cannot be constructed
// truthfully today. This is reported in the session log and in the pull request
// rather than resolved here: a chosen number of days added to
// `earliest_credit_at` is a number this repository would have invented
// (ADR-139 clause 3), and a migration is outside this slice's fence.
//
// SO THE FAILING DIRECTION IS NAMED. Rendering `held_cents: 0` says no hold is
// in force, and no hold IS in force: nothing in this tree places one, and
// `POST /wallet/withdrawals` cannot evaluate P-3 either, so this read does not
// promise a trader something the withdrawal leg would then refuse. What it must
// not be read as is "P-3 was evaluated and found nothing". `holdsToday` below
// is one function returning one empty array, so the day the window lands there
// is one place to change.
//
// The OTHER hold this schema can express is deliberately absent too, and the
// reason is the contract's rather than this file's. ADR-158 clause 5:
// "P-1 does not subtract from `withdrawable_cents`" -- it routes the WITHDRAWAL
// to review and "spending that value inside Merit is unaffected" -- so it is a
// flag on `POST /wallet/withdrawals` and never a member of `holds` here.
//
// -----------------------------------------------------------------------------
// A HELD `payout_requests` ROW IS NOT AN INPUT TO THIS READ, AND THE
// BICONDITIONAL IS THE REASON IT MUST NOT BECOME ONE
// -----------------------------------------------------------------------------
// ADR-158 finding 9: `payout_requests_hold_is_complete` requires all five hold
// columns to be NULL at any status other than `held_pending_review`, so
// releasing or enforcing a hold NULLs the whole record that it existed. A
// rendering that read those columns could only ever see LIVE holds and would
// report a complete history it does not have.
//
// THIS FILE READS `wallet_entries` AND NOTHING ELSE, so that blindness does not
// reach it -- and the reason is worth writing down, because "add the payout
// holds to the wallet's holds" is the obvious next thought and it is a category
// error. A payout under hold has not settled, `LT-01` has not posted, and there
// is therefore NO `wallet_entries` ROW FOR IT AT ALL: it is not money in the
// wallet being withheld, it is money that has not arrived. Summing it into
// `held_cents` would make `balance_cents = withdrawable_cents + held_cents`
// false, which the contract states as an identity.
//
// -----------------------------------------------------------------------------
// THE PAGE IS COMPOSED IN THIS FILE, WHICH IS THE COST ADR-157 SECTION 5 NAMES
// -----------------------------------------------------------------------------
// ADR-157 gave the accessor a RANGE term, an `IS NULL` term and a ROW lock, and
// REFUSED the aggregate. There is no `ORDER BY`, no `LIMIT` and no `SUM`, so the
// balance and the page are both composed here from rows the accessor returned,
// and the cost is the one that entry states out loud: "the rows crossing the
// boundary are the window's rather than the match's."
//
// PAID, AND ITS SIZE RECORDED RATHER THAN LEFT TO BE DISCOVERED. Both endpoints
// read the identity's WHOLE statement: `GET /wallet` to render one balance, and
// `GET /wallet/entries` to render one page of at most 100, on EVERY page. This
// is `catalog.ts`'s `GET /purchases` shape exactly, which pages the identity's
// whole scoped row set in memory.
//
// AND THE NARROWING THAT WOULD HAVE REDUCED IT IS BLOCKED BY THE FENCE RATHER
// THAN BY THE ACCESSOR, WHICH IS A DIFFERENT THING AND IS REPORTED AS ONE.
// `atMost(cursorInstant)` on `occurred_at` is exactly this endpoint's term and
// `scoped-db.ts` names this slice by name where it lists what is still refused:
// "a cursor over `wallet_entries` is `P5-g`'s and an inclusive bound re-reads
// its boundary row, so if that is unacceptable it is an argument `P5-g` makes
// rather than one this entry makes for it." THE INCLUSIVE BOUND IS ACCEPTABLE
// AND THIS SLICE MAKES NO ARGUMENT AGAINST IT. What is not available is the
// IMPORT: `atMost` is exported by `@merit/db`, `apps/api/src/db.ts` is this
// deployable's one door onto that package, and it re-exports nothing. Adding a
// re-export is two lines in a file `P5-g`'s fence does not hold, so it is
// reported in the pull-request body rather than reached for (P5 section 11
// rule 5). It is NOT rule 10's reach-around: nothing here needs the accessor
// widened, only re-exported.
//
// A STRICT INEQUALITY WOULD NOT HAVE BEEN ENOUGH ON ITS OWN ANYWAY. The order
// is `(occurred_at, id)` and no term in the vocabulary is a tuple comparison,
// so the tie-break is composed here whatever the read narrows to, and the day
// the term arrives it removes rows from the wire without moving one line of the
// paging below.
//
// -----------------------------------------------------------------------------
// NO `@merit/db` IMPORT, AND THAT IS A CONVENTION THIS FILE KEEPS RATHER THAN
// FINDS CONVENIENT
// -----------------------------------------------------------------------------
// `db.ts`'s header asks that `grep -rln '@merit/db' apps/api/src` return exactly
// one file, and `catalog.ts` declined the same import for the same reason. The
// grep returns more than one only because three route files DISCUSS the package
// in prose; `src/db.ts` is still the only one that imports it. This file takes
// `ApiDb` and names its table key as the plain string the accessor's own key
// types check, which is `catalog.ts`'s and `accounts.ts`'s shape.
//
// -----------------------------------------------------------------------------
// MONEY IS `bigint` CENTS IN THIS FILE AND A JSON INTEGER ON THE WIRE
// -----------------------------------------------------------------------------
// Every money column of `wallet_entries` is `bigint`, `centsToJson` REFUSES past
// `Number.MAX_SAFE_INTEGER` rather than serialising a wrong number, and there is
// no float in this file, in its suite, or in any fixture either one holds.
//
// `entry_id` IS A DECIMAL STRING AND NEVER A JSON NUMBER (ADR-158 clause 3), and
// the same `bigint` is why `isAfter` compares ids as `bigint` and NOT
// lexically: "9" sorts after "10" as a string, so a lexical tie-break would
// reorder a statement the moment it crossed a power of ten.
// =============================================================================

import type { FastifyReply, FastifyRequest } from 'fastify';

import type { ApiDb } from '../db.ts';
import { defineRoutes } from '../registry.ts';
import { PROBLEM_MEDIA_TYPE, problem } from '../server.ts';
import {
  requiredFactorTable,
  toRoutes,
  withSessionContext,
  type AuthSession,
  type EndpointSpec,
  type FieldError,
} from './auth.ts';

/** API_CONTRACT section 6.2's rows, as the contract writes them. No base path. */
export const WALLET_PATH = '/wallet';
export const WALLET_ENTRIES_PATH = '/wallet/entries';

// -----------------------------------------------------------------------------
// The wire, section 6.2's own shapes
// -----------------------------------------------------------------------------

/**
 * The hold vocabulary: "P-3. A closed union with one member today."
 *
 * P-1 IS NOT A MEMBER AND MUST NOT BECOME ONE. ADR-158 clause 5: it holds a
 * WITHDRAWAL and not a balance, so it appears on `POST /wallet/withdrawals`.
 */
export type WalletHoldRule = 'chargeback_window';

/** Section 6.2's `WalletHold`. */
export interface WalletHold {
  readonly rule: WalletHoldRule;
  readonly cents: number;
  /** The oldest held credit's `occurred_at`. */
  readonly since: string;
  /** Null under `chargeback_window`: ADR-158 clause 6, and the header above. */
  readonly available_at: string | null;
}

/** Section 6.2's `WalletResponse`. */
export interface WalletResponse {
  readonly balance_cents: number;
  readonly withdrawable_cents: number;
  readonly held_cents: number;
  readonly holds: readonly WalletHold[];
  readonly as_of: string;
}

/**
 * The CLOSED credit list, `0011`'s own CHECK.
 *
 * There is no deposit member (`INV-WALLET-NO-DEPOSITS`) and no
 * `promotional_credit` member (`0011` header item 3, `OQ-FREEZE-01`), and
 * neither may be added here without the migration that adds it there.
 */
export const WALLET_PROVENANCES = ['payout', 'refund_wallet_funded', 'correction'] as const;

/** One of {@link WALLET_PROVENANCES}. */
export type WalletProvenance = (typeof WALLET_PROVENANCES)[number];

/** `direction`'s two members, `0011`'s CHECK. */
export const WALLET_DIRECTIONS = ['credit', 'debit'] as const;

/** One of {@link WALLET_DIRECTIONS}. */
export type WalletDirection = (typeof WALLET_DIRECTIONS)[number];

/** Section 6.2's `WalletEntryBase`. */
export interface WalletEntryBase {
  /** A DECIMAL STRING. ADR-158 clause 3; a client must not parse it. */
  readonly entry_id: string;
  /** A MAGNITUDE, always > 0. `direction` carries the sign. */
  readonly amount_cents: number;
  readonly cause: string;
  readonly reference_id: string;
  readonly ledger_transaction_id: string;
  readonly balance_after_cents: number;
  readonly occurred_at: string;
}

/** A credit, which carries the class of money it is. */
export interface WalletCredit extends WalletEntryBase {
  readonly direction: 'credit';
  readonly provenance: WalletProvenance;
}

/**
 * A debit, which carries NO `provenance`, and the omission is the schema
 * reported honestly rather than a field forgotten.
 *
 * ADR-158 clause 2 and finding 3: the column is `NOT NULL` on a table that
 * stores debits and its three members are the CREDIT list by the DDL's own
 * heading, so every wallet debit in this schema is written carrying a class that
 * does not describe it. What a debit MEANS is `cause` and `reference_id`.
 */
export type WalletDebit = WalletEntryBase & { readonly direction: 'debit' };

/** Section 6.2's `WalletEntry`, discriminated on `direction`. */
export type WalletEntry = WalletCredit | WalletDebit;

/** Section 6.2's `WalletEntriesResponse`. */
export interface WalletEntriesResponse {
  readonly data: readonly WalletEntry[];
  readonly next_cursor: string | null;
}

// -----------------------------------------------------------------------------
// The row, as this file reads it off the accessor
// -----------------------------------------------------------------------------

/**
 * One `wallet_entries` row, narrowed and nothing else.
 *
 * `id`, `amountCents` and `balanceAfterCents` stay `bigint` all the way to the
 * projection, which is where the two conversions happen and where they refuse.
 */
export interface WalletEntryRow {
  readonly id: bigint;
  readonly direction: WalletDirection;
  readonly amountCents: bigint;
  readonly provenance: WalletProvenance;
  readonly cause: string;
  readonly referenceId: string;
  readonly ledgerTransactionId: string;
  readonly balanceAfterCents: bigint;
  /** RFC 3339 UTC, rendered by ONE code path so lexical order is chronological. */
  readonly occurredAt: string;
}

// -----------------------------------------------------------------------------
// The port
// -----------------------------------------------------------------------------

/**
 * What this module needs from the world.
 *
 * ONE READ METHOD FOR TWO ENDPOINTS, because both ask the same question: this
 * identity's whole statement. `GET /wallet` needs it because the balance is the
 * last row appended and no window can be known to contain it; `GET
 * /wallet/entries` needs it because the accessor this file may reach has no
 * narrowing term available to it (see the header). A `notAfter` parameter would
 * be a window this file cannot yet send, declared as though it could.
 */
export interface WalletBackend {
  /** Every `wallet_entries` row of this identity's. */
  readEntries(session: AuthSession): Promise<readonly WalletEntryRow[]>;

  /** The clock `as_of` is stamped from. Injected so the suite can pin an instant. */
  readonly now: () => Date;
}

/** Thrown by the unwired backend. Answered as 503 rather than 500. */
export class WalletBackendUnwired extends Error {
  constructor(method: string) {
    super(
      `WalletBackend.${method} is not wired. The wallet reads are declared and their ` +
        'persistence is not installed, so this deployment answers 503 rather than rendering a ' +
        'balance it did not read',
    );
    this.name = 'WalletBackendUnwired';
  }
}

/**
 * A backend that refuses every read.
 *
 * ON `payouts.ts`'s AND `checkout.ts`'s PRECEDENT AND FOR THEIR REASON: "a
 * backend that returned plausible values would be a fixture serving real
 * traffic", and on THIS route it would be a fixture telling a trader how much
 * money they have. The routes are REGISTERED because the contract rows exist; a
 * missing route answers 404 and reads as a contract Merit never wrote.
 *
 * THE CLOCK IS REAL EVEN HERE. It is not persistence, nothing is decided from
 * it before the read refuses, and a null clock would be a second failure mode
 * with no second cause.
 */
export const UNWIRED_WALLET_BACKEND: WalletBackend = {
  readEntries: () => Promise.reject(new WalletBackendUnwired('readEntries')),
  now: () => new Date(),
};

let backend: WalletBackend = UNWIRED_WALLET_BACKEND;

/** Install the backend. The wiring slice calls this; so does the suite. */
export function useWalletBackend(next: WalletBackend): void {
  backend = next;
}

/** Restore the fail-closed default. */
export function resetWalletBackend(): void {
  backend = UNWIRED_WALLET_BACKEND;
}

/** The installed backend. */
export function currentWalletBackend(): WalletBackend {
  return backend;
}

// -----------------------------------------------------------------------------
// Money at the boundary. It refuses rather than rounds
// -----------------------------------------------------------------------------

/** Raised when a value on the money path is not integer cents. */
export class WalletMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WalletMoneyError';
  }
}

/**
 * `bigint` cents to a JSON integer.
 *
 * A SECOND COPY OF `checkout.ts`'s AND THE DUPLICATION IS THE CHEAPER SIDE, on
 * `catalog.ts`'s recorded reasoning: importing it would put `@merit/psp`,
 * `@merit/affiliate` and `@merit/enrichment` into the module graph of a read
 * that touches none of them, and would make a wallet defect surface as a
 * `CheckoutMoneyError` in an incident log.
 *
 * It throws past `Number.MAX_SAFE_INTEGER` rather than serialising a wrong
 * number. The columns are `bigint`, so a value that cannot be a JSON integer is
 * expressible in the schema; at 2^53 cents that is ninety trillion dollars and
 * will not happen, which is a reason to assert it cheaply rather than skip it.
 */
export function centsToJson(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new WalletMoneyError(
      `${value.toString()} cents cannot be a JSON integer; API_CONTRACT section 1 says ` +
        '*_cents are JSON integers',
    );
  }
  return Number(value);
}

// -----------------------------------------------------------------------------
// Reading the accessor's rows. A row that contradicts its own table is a throw
// -----------------------------------------------------------------------------

/** Raised when a row is not the shape `0011` declares. */
export class WalletRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WalletRowError';
  }
}

function asRow(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new WalletRowError('a `wallet_entries` read returned something that is not a row');
  return value as Record<string, unknown>;
}

function text(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string')
    throw new WalletRowError(`\`wallet_entries.${field}\` is not a string. It is \`NOT NULL\``);
  return value;
}

/**
 * A `bigint` column.
 *
 * `schema.ts` declares every money column and `id` with `{ mode: 'bigint' }`, so
 * the driver hands a `bigint` back. A `number` here would be a schema whose mode
 * changed underneath this file, and reading it as money is exactly the
 * `Number.MAX_SAFE_INTEGER` defect ADR-122 refuses, so it is refused rather than
 * coerced.
 */
function big(row: Record<string, unknown>, field: string): bigint {
  const value = row[field];
  if (typeof value !== 'bigint')
    throw new WalletRowError(
      `\`wallet_entries.${field}\` is not a bigint. \`schema.ts\` declares it ` +
        "`bigint(..., { mode: 'bigint' })`, so reading it as a JSON number would be the " +
        'digit loss ADR-122 refuses',
    );
  return value;
}

/**
 * A `timestamptz` column, as one RFC 3339 UTC string.
 *
 * ONE CODE PATH RENDERS EVERY INSTANT IN THIS FILE, which is what makes lexical
 * comparison of the cursor's timestamp chronological. `catalog.ts` states the
 * same condition for the same reason.
 */
function instant(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (!(value instanceof Date) || Number.isNaN(value.getTime()))
    throw new WalletRowError(
      `\`wallet_entries.${field}\` is not a Date. It is \`timestamptz NOT NULL\``,
    );
  return value.toISOString();
}

function member<T extends string>(
  row: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T {
  const value = text(row, field);
  if (!(allowed as readonly string[]).includes(value))
    throw new WalletRowError(
      `\`wallet_entries.${field}\` is \`${value}\`, which the column's own CHECK closes at ` +
        allowed.join(' | '),
    );
  return value as T;
}

/** One accessor row, narrowed. Exported so the suite names it directly. */
export function toWalletEntryRow(value: unknown): WalletEntryRow {
  const row = asRow(value);
  const amountCents = big(row, 'amountCents');
  if (amountCents <= 0n)
    throw new WalletRowError(
      `\`wallet_entries.amount_cents\` is ${amountCents.toString()}, and the column is ` +
        '`CHECK (amount_cents > 0)`. Direction carries the sign',
    );
  const balanceAfterCents = big(row, 'balanceAfterCents');
  if (balanceAfterCents < 0n)
    throw new WalletRowError(
      `\`wallet_entries.balance_after_cents\` is ${balanceAfterCents.toString()}, and the ` +
        'column is `CHECK (balance_after_cents >= 0)`. No response here may carry a negative ' +
        'wallet figure',
    );
  return {
    id: big(row, 'id'),
    direction: member(row, 'direction', WALLET_DIRECTIONS),
    amountCents,
    provenance: member(row, 'provenance', WALLET_PROVENANCES),
    cause: text(row, 'cause'),
    referenceId: text(row, 'referenceId'),
    ledgerTransactionId: text(row, 'ledgerTransactionId'),
    balanceAfterCents,
    occurredAt: instant(row, 'occurredAt'),
  };
}

/**
 * The backend, reading through the accessor.
 *
 * `db.scoped` AND NEVER `db.firm`. The identity is the one the handler resolved
 * from the session, and `scopePredicate` is applied before this file sees a row,
 * so nothing below is a tenancy control and nothing below can become one by
 * accident.
 */
export function databaseWalletBackend(db: ApiDb, now: () => Date = () => new Date()): WalletBackend {
  return {
    now,
    readEntries: (session) =>
      db.scoped(session.identityId, async (tx) =>
        (await tx.rows('walletEntries')).map(toWalletEntryRow),
      ),
  };
}

// -----------------------------------------------------------------------------
// The balance, and the hold that has no input
// -----------------------------------------------------------------------------

/**
 * The balance this identity has, which is the LAST ROW APPENDED's stored
 * running balance.
 *
 * AN IDENTITY WITH NO ROW IS `0` AND NOT ABSENT. ADR-158 clause 9: "here absence
 * means exactly zero", `INV-M20-09` makes the balance payable on demand forever,
 * and a 404 on a wallet tells a trader they do not have one.
 */
export function balanceOf(rows: readonly WalletEntryRow[]): bigint {
  let latest: WalletEntryRow | null = null;
  for (const row of rows) if (latest === null || row.id > latest.id) latest = row;
  return latest === null ? 0n : latest.balanceAfterCents;
}

/**
 * P-3's holds, which this tree cannot compute and which are therefore none.
 *
 * READ THE HEADER BEFORE CHANGING THIS. It is empty because the input is
 * missing and not because the rule was evaluated: no landed column carries a
 * purchase's chargeback-window end (ADR-158 finding 14), `OQ-M20-02` is open and
 * `DEP-M20-03` is unbuilt. It takes the rows it cannot yet use so that the day
 * the window lands, the change is this function and its caller is untouched.
 */
export function holdsToday(_rows: readonly WalletEntryRow[]): readonly WalletHold[] {
  return [];
}

/**
 * Section 6.2's `WalletResponse`, built field by field.
 *
 * `balance_cents` EQUALS `withdrawable_cents + held_cents` AND THE SUM IS
 * COMPUTED HERE RATHER THAN LEFT TO A CLIENT, which is what the contract states
 * and why: "the two components are computed from different inputs and a client
 * that derived one by subtraction would render a stale figure whenever the other
 * moved". `withdrawable_cents` is the subtraction on THIS side of the wire, so
 * the identity holds by construction rather than by agreement.
 */
export function renderWallet(rows: readonly WalletEntryRow[], asOf: Date): WalletResponse {
  const balance = balanceOf(rows);
  const holds = holdsToday(rows);
  let held = 0n;
  for (const hold of holds) held += BigInt(hold.cents);
  if (held > balance)
    throw new WalletRowError(
      `held ${held.toString()} exceeds the balance ${balance.toString()}. A hold is a part of ` +
        'the balance and never a claim beyond it',
    );
  return {
    balance_cents: centsToJson(balance),
    withdrawable_cents: centsToJson(balance - held),
    held_cents: centsToJson(held),
    holds,
    as_of: asOf.toISOString(),
  };
}

// -----------------------------------------------------------------------------
// The cursor. Section 1: "Cursor only, never offset"
// -----------------------------------------------------------------------------

/** Section 1: "`limit` maximum 100, default 25." */
export const ENTRIES_DEFAULT_LIMIT = 25;

/** Section 1's ceiling, which section 6.2 names as the `validation_failed`. */
export const ENTRIES_MAX_LIMIT = 100;

/**
 * One page's position, which is a ROW and never an offset.
 *
 * BOTH HALVES, BECAUSE `occurred_at` IS NOT A TOTAL ORDER. `wallet_entries` has
 * no unique constraint on it and two entries in one transaction share an
 * instant by default, so a cursor on the timestamp alone either repeats a row
 * across pages or skips one. `entry_id` is the primary key, so the pair is total.
 */
export interface WalletCursor {
  readonly occurred_at: string;
  readonly entry_id: string;
}

/**
 * The cursor as the wire carries it: opaque, which section 1 requires.
 *
 * base64url of `occurred_at|entry_id`, `catalog.ts`'s encoding and its argument:
 * opaque is a promise about the CLIENT and not about an attacker, because the
 * read it seeks into is scoped to the caller's identity by the accessor before
 * this file sees a row. It is encoded so a client cannot come to depend on the
 * shape.
 */
export function encodeCursor(cursor: WalletCursor): string {
  return Buffer.from(`${cursor.occurred_at}|${cursor.entry_id}`, 'utf8').toString('base64url');
}

/** The inverse, or `null` for anything that is not one. */
export function decodeCursor(raw: string): WalletCursor | null {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const split = decoded.lastIndexOf('|');
  if (split <= 0 || split === decoded.length - 1) return null;
  const occurredAt = decoded.slice(0, split);
  const entryId = decoded.slice(split + 1);
  // BOTH HALVES ARE VALIDATED, because both are used: the instant is compared
  // lexically against `occurred_at` and the id becomes a `bigint` comparison. A
  // cursor carrying either half malformed is a position no row can sit after,
  // which renders as a silently empty final page.
  if (!/^[0-9]+$/.test(entryId)) return null;
  if (Number.isNaN(Date.parse(occurredAt))) return null;
  return { occurred_at: occurredAt, entry_id: entryId };
}

/** A validated `?limit=&cursor=` pair. */
export interface WalletEntriesQuery {
  readonly limit: number;
  readonly cursor: WalletCursor | null;
}

type Validated<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly FieldError[] };

/**
 * Section 1's query, validated total.
 *
 * A BAD CURSOR IS A `validation_failed` AND NOT AN EMPTY PAGE, `catalog.ts`'s
 * rule: an empty page for a cursor the server cannot read is a list that
 * silently ends early, and the client cannot tell that from having reached the
 * end. On a STATEMENT that is a client believing it has seen every movement of
 * its money.
 */
export function validateEntriesQuery(query: unknown): Validated<WalletEntriesQuery> {
  const row: Record<string, unknown> =
    typeof query === 'object' && query !== null && !Array.isArray(query)
      ? (query as Record<string, unknown>)
      : {};
  const errors: FieldError[] = [];

  let limit = ENTRIES_DEFAULT_LIMIT;
  const rawLimit = row['limit'];
  if (rawLimit !== undefined) {
    // Fastify hands a query string over as a string; the contract writes it as
    // an integer, so the parse is here and it refuses anything that is not one.
    const parsed =
      typeof rawLimit === 'string' && /^[0-9]+$/.test(rawLimit) ? Number(rawLimit) : -1;
    if (parsed < 1 || parsed > ENTRIES_MAX_LIMIT)
      errors.push({
        path: 'limit',
        message: `must be an integer between 1 and ${String(ENTRIES_MAX_LIMIT)}`,
      });
    else limit = parsed;
  }

  let cursor: WalletCursor | null = null;
  const rawCursor = row['cursor'];
  if (rawCursor !== undefined) {
    const parsed = typeof rawCursor === 'string' ? decodeCursor(rawCursor) : null;
    if (parsed === null)
      errors.push({ path: 'cursor', message: 'is not a cursor this endpoint issued' });
    else cursor = parsed;
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { limit, cursor } };
}

/**
 * Newest first, which is the order a statement reads in and the order section
 * 6.2 states: "`occurred_at` descending".
 *
 * DESCENDING ON BOTH KEYS, so the cursor's "strictly after" is one comparison
 * rather than two rules. The id half is a `bigint` comparison and NOT a lexical
 * one: these ids reach the wire as decimal strings, and "9" sorts after "10" as
 * a string.
 */
export function newestFirst(a: WalletEntryRow, b: WalletEntryRow): number {
  if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** Whether a row falls strictly after a cursor's position under {@link newestFirst}. */
export function isAfter(row: WalletEntryRow, cursor: WalletCursor): boolean {
  if (row.occurredAt !== cursor.occurred_at) return row.occurredAt < cursor.occurred_at;
  return row.id < BigInt(cursor.entry_id);
}

/**
 * One entry, projected.
 *
 * THE UNION IS BUILT BY BRANCHING AND NOT BY A SPREAD WITH AN OPTIONAL FIELD.
 * ADR-158 clause 2: "a single optional field would have collapsed the two", and
 * a client reading a debit labelled `payout` would render a credit class on a
 * withdrawal. The `provenance` a debit row carries is read off the row and
 * DISCARDED here, which is the one place that discard is visible.
 */
export function projectEntry(row: WalletEntryRow): WalletEntry {
  const base: WalletEntryBase = {
    entry_id: row.id.toString(),
    amount_cents: centsToJson(row.amountCents),
    cause: row.cause,
    reference_id: row.referenceId,
    ledger_transaction_id: row.ledgerTransactionId,
    balance_after_cents: centsToJson(row.balanceAfterCents),
    occurred_at: row.occurredAt,
  };
  return row.direction === 'credit'
    ? { ...base, direction: 'credit', provenance: row.provenance }
    : { ...base, direction: 'debit' };
}

/**
 * Section 6.2's page.
 *
 * THE PAGING IS IN MEMORY AND THE HEADER SAYS WHY. Every row handed here is
 * already this identity's: the accessor applied `scopePredicate` before the
 * handler saw one, so nothing below is a tenancy control and nothing below can
 * become one by accident.
 */
export function renderEntries(
  rows: readonly WalletEntryRow[],
  query: WalletEntriesQuery,
): WalletEntriesResponse {
  const ordered = [...rows].sort(newestFirst);
  const cursor = query.cursor;
  const from = cursor === null ? ordered : ordered.filter((row) => isAfter(row, cursor));
  const page = from.slice(0, query.limit);
  // One past the page, so "is there more" is a fact rather than a guess. A
  // `next_cursor` on a page that turns out to be the last one makes a client
  // fetch an empty page to discover it, and section 1 gives it no other signal.
  const more = from.length > page.length;
  const last = page.at(-1);
  return {
    data: page.map(projectEntry),
    next_cursor:
      more && last !== undefined
        ? encodeCursor({ occurred_at: last.occurredAt, entry_id: last.id.toString() })
        : null,
  };
}

// -----------------------------------------------------------------------------
// The endpoints
// -----------------------------------------------------------------------------

/** An unwired backend is a 503 and never a 500. Anything else is the transport's. */
function unwiredOrThrow(err: unknown, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  if (!(err instanceof WalletBackendUnwired)) throw err;
  request.log.error({ err }, 'wallet backend is not wired');
  return reply
    .code(503)
    .type(PROBLEM_MEDIA_TYPE)
    .send({ ...problem('service_unavailable', 503, request.id), title: 'Service unavailable' });
}

/**
 * Section 6.2: "Auth: **session**, owner."
 *
 * OWNERSHIP IS NOT A CHECK IN THIS FILE AND THERE IS NO PATH PARAMETER TO CHECK.
 * Section 1's identity scoping is the whole of it: the handler resolves the
 * caller to an identity and reads through `scopedDb(identity)`, so the only
 * wallet these routes can address is the caller's own. An `:identityId` in the
 * path would be the thing that made an ownership check necessary, and the
 * contract deliberately does not have one.
 */
export const WALLET_ENDPOINTS: readonly EndpointSpec[] = [
  {
    method: 'GET',
    path: WALLET_PATH,
    required: 'session',
    handle: withSessionContext(async ({ request, reply, session }) => {
      const wallet = currentWalletBackend();
      try {
        const rows = await wallet.readEntries(session);
        return renderWallet(rows, wallet.now());
      } catch (err) {
        return unwiredOrThrow(err, request, reply);
      }
    }),
  },
  {
    method: 'GET',
    path: WALLET_ENTRIES_PATH,
    required: 'session',
    handle: withSessionContext(async ({ request, reply, session }) => {
      const query = validateEntriesQuery(request.query);
      if (!query.ok)
        return reply
          .code(400)
          .type(PROBLEM_MEDIA_TYPE)
          .send({ ...problem('validation_failed', 400, request.id), errors: query.errors });

      const wallet = currentWalletBackend();
      try {
        return renderEntries(await wallet.readEntries(session), query.value);
      } catch (err) {
        return unwiredOrThrow(err, request, reply);
      }
    }),
  },
];

/** The declaration as data, on `auth.ts`'s shape. Section 12's factor column. */
export const WALLET_REQUIRED_FACTORS = requiredFactorTable(WALLET_ENDPOINTS);

export default defineRoutes({
  name: 'wallet',
  routes: toRoutes(WALLET_ENDPOINTS),
});
