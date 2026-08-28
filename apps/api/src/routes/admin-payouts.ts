// =============================================================================
// apps/api/src/routes/admin-payouts.ts
// =============================================================================
// THE TWO OPERATOR PATHS OUT OF `held_pending_review`, AND THE WHOLE MODULE IS
// SHAPED BY ONE CONSTRAINT THAT ERASES ITS OWN SUBJECT:
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
// quoted rather than paraphrased and read at the source before either handler
// below was written. ADR-158 finding 9 names it and this file is where it bites.
//
// IT IS A BICONDITIONAL. Both endpoints here move `status` off
// `held_pending_review` -- release to `approved`, enforcement to `failed` -- so
// **both must NULL all five hold columns in the same statement**, and a write
// that left one populated is refused by Postgres rather than by anything in this
// file. THESE TWO ENDPOINTS ARE THE ONLY THINGS THAT WILL EVER PERFORM THAT
// TRANSITION.
//
// -----------------------------------------------------------------------------
// WHAT IS LOST WHEN THE HOLD RESOLVES, STATED HERE RATHER THAN WORKED AROUND
// -----------------------------------------------------------------------------
// THE ROW STOPS BEING ABLE TO SAY IT WAS EVER HELD. After either call,
// `payout_requests` cannot distinguish a request held for forty-seven hours from
// one that was never flagged at all, and `GET /payouts` correctly returns
// `hold: null` for both. That is not a defect in the read; it is the CHECK.
//
// AND `hold_reason` DOES NOT REACH THE CALLER EITHER. API_CONTRACT's blocks are
// `{ held_at, resolves_by, tos_clause, flag_id }` on both rows, so of the five
// columns the write blanks, four come back in the response and the operator's
// written justification for the hold is not one of them.
//
// SO THE DURABLE RECORD IS THE `admin_actions` ROW'S `before`, AND IT IS THE
// ONLY ONE. API_CONTRACT section 8 says so in the release row's own paragraph.
// This module therefore writes ALL FIVE hold columns into `before`, cites the
// hold's own flag and ToS clause in `evidence_refs`, and does both BEFORE the
// mutation rather than after it.
//
// NONE OF THIS IS REPAIRED HERE AND THE REPAIR IS NOT AVAILABLE TO THIS FENCE.
// A migration is sacred once merged -- superseded, never edited (constitution
// E2) -- so the constraint cannot be fixed from a route file. A shadow column
// added beside it to dodge the CHECK would be a second record of the hold that
// the database does not constrain, which is a worse artefact than the hole: the
// five columns are complete-or-absent by construction and an unconstrained
// duplicate would be neither. **The honest thing is built and the loss is
// named**, which is the disposition ADR-158 used on the same finding.
//
// -----------------------------------------------------------------------------
// THE RELEASE POSTS `LT-01`, AND THIS IS THE ONE NON-OBVIOUS THING HERE
// -----------------------------------------------------------------------------
// ADR-040's own comparison table: a held request has NOTHING POSTED, no wallet
// credit, nothing owed, and `frozen` is entered "from `approved`, AFTER LT-01
// posted". So `approved` is the post-`LT-01` state, and `payouts.ts` says the
// consequence in terms at its own hold branch:
//
//   "A HELD REQUEST HAS POSTED NOTHING: no ledger transaction, no wallet
//    credit ... The ledger is the discriminator between `held_pending_review`
//    and `frozen`, and it is what makes release mean 'approve and pay' on a
//    hold rather than 'let settlement proceed'."
//
// THE DEFERRED POSTING HAS EXACTLY ONE HOME AND IT IS THIS ENDPOINT. A release
// that moved `status` to `approved` and posted nothing would mark a payout paid
// that never paid, silently, on the row a dispute is later argued from.
//
// Three refusals follow and each is a refusal to invent:
//
//   1. THE POSTING IS `payouts.ts`'s OWN `lt01()`, IMPORTED. This file names no
//      ledger account, writes no transfer and contains no ledger arithmetic. A
//      second transcription of `debit trader_withdrawable / credit
//      trader_wallet / credit fees_revenue` is ADR-092 section 5's
//      two-statements-of-one-fact hazard arriving on the money path, and `lt01`
//      already asserts `INV-M5-03` over the split internally.
//   2. THE MONEY IS READ OFF THE STORED ROW AND IS NEVER RECOMPUTED. `INV-M5-02`
//      is the number shown is the number sent, and API_CONTRACT's own comment on
//      `PayoutReleaseResponse` is that a release producing a different number
//      would mean the hold cost the trader money.
//   3. THE `LedgerTx` IS A PORT THE WIRING SUPPLIES, exactly as `PayoutTx.ledger`
//      is one file over. NOTHING HERE ADDS A `SqlExecutorReason` MEMBER, ADDS A
//      `SystemReason` MEMBER, IMPORTS `pg`, OR CASTS PAST A KEY TYPE. An operator
//      console is `'operator-console'` already, which is the one word that makes
//      this posting reachable at all where the trader's own path is not.
//
// A LIVE LEDGER HALT REFUSES THE POSTING AND THAT IS LEFT ALONE. `postTransaction`
// asserts against `ledger_halts` unless the caller passes `despiteHalt`, and this
// module passes nothing: an override is a ruling and `payouts.ts` takes none
// either. INV-M5-12 is untouched by that and is not what a halt is -- the
// circuit breaker pauses SALES and has no code path to a payout block, and
// `ledger_halts` is a different object entirely.
//
// -----------------------------------------------------------------------------
// THE ORDER INSIDE EVERY TRANSACTION, WHICH IS THE CONTROL
// -----------------------------------------------------------------------------
//   1. `lockAt('payoutRequests', { id })`   ADR-157's row lock, FOR UPDATE
//   2. status must be `held_pending_review`, else `conflict`
//   3. CAPTURE ALL FIVE HOLD COLUMNS off the locked row
//   4. INSERT the `admin_actions` row        <-- refused if there is no reason
//   5. UPDATE `payout_requests`              <-- the five NULLs
//   6. release only: post `LT-01`
//
// STEP 1 IS A LOCK AND NOT A READ, AND TWO ADMINS RESOLVING ONE HOLD IS THE CASE
// IT EXISTS FOR. `lockAt` is ADR-157's `rowAt` plus `FOR UPDATE` on the same
// predicate; the second transaction blocks, then reads a row whose status is no
// longer `held_pending_review`, and gets `conflict` at step 2 rather than
// releasing and enforcing the same payout. AN ADVISORY LOCK THROUGH
// `sqlExecutor` IS REFUSED BY NAME in ADR-157 clause 4 and in both P5 and P7
// rule 10, because it carries no tenancy narrowing at all.
//
// STEP 3 IS BEFORE STEP 5 BECAUSE AFTER STEP 5 THE ROW CANNOT ANSWER. That is
// the whole reason `released_hold` and `enforced_hold` exist as response fields
// rather than as something a caller reads back off the row.
//
// STEP 4 IS BEFORE STEP 5 ON `admin-writes.ts`'s RULE AND `0017:82`'s: `reason
// text NOT NULL` is the control, and it is only a PRECONDITION of the mutation
// if the mutation cannot happen without it. Nothing here supplies a reason and
// nothing here substitutes a neighbouring field for one.
//
// -----------------------------------------------------------------------------
// `INV-M5-23`'s SHAPE: AN AUTHORIZATION REFUSAL IS NEVER A GATE RESULT
// -----------------------------------------------------------------------------
// The 401 and the 403 are decided BEFORE `operator()` opens a transaction, so a
// caller who may not release writes NO `admin_actions` row, NO snapshot and NO
// change to `payout_requests`. M05's INV-M5-23 states it for the impersonation
// refusal on the trader's own endpoint -- "the two refusals are the same status
// code and different records, and the record is the part that survives into an
// evidence pack" -- and the same distinction is what a `readonly` operator's 403
// must leave behind here, which is nothing. It is a property of the ORDER below
// rather than of this paragraph.
//
// -----------------------------------------------------------------------------
// WHAT THIS MODULE DOES NOT WRITE, EACH REPORTED RATHER THAN INVENTED
// -----------------------------------------------------------------------------
// `approved_at` IS LEFT AS IT STANDS AND THE FINDING IS INHERITED, NOT REPAIRED.
// ADR-158 finding 1: `payout_requests.approved_at` is `timestamptz NOT NULL
// DEFAULT now()` and was never altered, so a held request already carries an
// approval time equal to its insertion time, which is false on the one state
// where the trader is being told nothing was approved. This endpoint holds the
// true approval instant and still does not write it, because writing it would
// DESTROY the request instant irrecoverably to correct a value ADR-158 has
// already dispositioned, while not writing it loses nothing: `admin_actions
// .created_at` on the row written at step 4 IS the release instant, durably and
// append-only. Overwriting is the lossy direction and the repair is a
// superseding migration's.
//
// NO `failure_note` IS WRITTEN ON ENFORCEMENT AND NO COLUMN HOLDS ONE.
// API_CONTRACT's own enforce paragraph: `GET /payouts` types `failure_note:
// string | null`, `payout_requests` declares no such column, and "the note's
// storage is unresolved and is not this row's to decide". So an enforced payout
// reaches the trader with a null note, which is reported rather than papered
// over with a column this module would have to invent.
//
// NO EVENT IS EMITTED. Nothing in `apps/api/src` writes an event, and inventing
// a sink in a route would be this file deciding where the event catalogue lives.
// `payouts.ts` reports the same gap for the same reason.
//
// NO IDEMPOTENCY KEY IS READ OFF THE WIRE. API_CONTRACT section 1's required
// list does not name either of these rows, and the concurrency control that
// matters here is the ROW LOCK plus the status precondition, which together make
// a second release a `conflict` rather than a second payment. The LEDGER's own
// key is derived deterministically from the request row: see `releaseLedgerKey`.
//
// -----------------------------------------------------------------------------
// THE SURFACE IS THE PATH'S DECISION AND THIS FILE MAKES NO CHECK ABOUT IT
// -----------------------------------------------------------------------------
// `/admin` is one of `surface.ts`'s `OPERATOR_PREFIXES`, so `compose` never
// registers this module on the public deployment and the public 404 is the
// router's, produced by there being nothing there (ADR-083 section 4). Session
// 256's surface-selection ruling governs and ADR-161 restated that the section
// is the surface; nothing here invents a second answer.
//
// ADMIN_ORIGIN IS A PLACEHOLDER AND IS NOT WRITTEN DOWN ANYWHERE. ADR-012: the
// admin console's real apex domain never enters the corpus, the repository, or
// any public artifact. There is no hostname in this file, no origin check
// against a literal, and no comment naming one.
//
// MONEY IS INTEGER CENTS. Every `*_cents` column on `payout_requests` is
// `bigint`, so the arithmetic that touches them here is `bigint` and the single
// conversion to the wire is `centsToJson`, which REFUSES rather than rounds.
// There is no float in this file or in its suite.
// =============================================================================

import { postTransaction, readChart } from '@merit/ledger';
import type { LedgerTx } from '@merit/ledger';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { defineRoutes } from '../registry.ts';
import type { HttpMethod, RouteDefinition, RouteHandler } from '../registry.ts';
import { PROBLEM_MEDIA_TYPE, PROBLEM_TYPE_PREFIX } from '../server.ts';
import type { Problem } from '../server.ts';
import { ACCOUNT_ACTION_ROLES } from './admin-writes.ts';
import type { AdminInitiative, AdminPrincipal, AdminRole } from './admin-writes.ts';
import { centsToJson } from './checkout.ts';
import { PAYOUT_ENDPOINT, lt01 } from './payouts.ts';

// -----------------------------------------------------------------------------
// The two contract paths
// -----------------------------------------------------------------------------

/** API_CONTRACT section 8. The FIRST operator path out of `held_pending_review`. */
export const PAYOUT_RELEASE_PATH = '/admin/payouts/:id/release';

/** API_CONTRACT section 8. The SECOND path out, and the one that keeps zero denial honest. */
export const PAYOUT_ENFORCE_PATH = '/admin/payouts/:id/enforce';

/**
 * The one status either endpoint may act on.
 *
 * `payout_status` gained it in `0030` in its own transaction, because
 * `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction that reads
 * it. Both contract rows answer `conflict` for anything else.
 */
export const HELD = 'held_pending_review';

// -----------------------------------------------------------------------------
// The wire shapes, transcribed from API_CONTRACT section 8
// -----------------------------------------------------------------------------

/**
 * The hold this call just erased, READ BEFORE THE WRITE.
 *
 * IT IS A SEPARATE OBJECT FROM THE REQUEST BECAUSE AFTER THE WRITE THE ROW
 * CANNOT CARRY IT. Identical on both responses by the contract's own text, so it
 * is one type here rather than two: `released_hold` and `enforced_hold` differ
 * in name and in nothing else, and `enforced_hold` "is read before the write for
 * the same reason `released_hold` is".
 *
 * THERE IS NO `reason` MEMBER AND ITS ABSENCE IS THE CONTRACT'S. `hold_reason`
 * is the fifth column the CHECK blanks and the only one with nowhere to go but
 * `admin_actions.before`.
 */
export interface PayoutHoldRecord {
  readonly held_at: string;
  /** `hold_expires_at`. The 48 hour deadline the trader was shown. */
  readonly resolves_by: string;
  readonly tos_clause: string;
  readonly flag_id: string;
}

/** API_CONTRACT section 8's `PayoutReleaseRequest`. One member, and it is the control. */
export interface PayoutReleaseBody {
  readonly reason: string;
}

/** API_CONTRACT section 8's `PayoutReleaseResponse`. */
export interface PayoutReleaseResponse {
  readonly payout_request_id: string;
  readonly status: 'approved';
  /** Every money field is the one the hold froze at request time. None is recomputed. */
  readonly approved_cents: number;
  readonly trader_cents: number;
  readonly firm_cents: number;
  readonly payout_ordinal: number;
  readonly released_hold: PayoutHoldRecord;
}

/** API_CONTRACT section 8's `PayoutEnforceRequest`. */
export interface PayoutEnforceBody {
  readonly reason: string;
  readonly tos_clause: string;
  /** REQUIRED. An exported pack, not a promise of one. */
  readonly evidence_pack_id: string;
}

/** API_CONTRACT section 8's `PayoutEnforceResponse`. */
export interface PayoutEnforceResponse {
  readonly payout_request_id: string;
  readonly status: 'failed';
  readonly payout_ordinal: number;
  /**
   * ALWAYS TRUE, AND STATED RATHER THAN IMPLIED.
   *
   * `payout_requests_account_ordinal_uq` is `UNIQUE ... WHERE status <> 'failed'`
   * (`0010:187`), so sending the request to `failed` drops it out of the
   * predicate and frees the rung for a later request (`EC-037`; ADR-040 reads
   * the index as unchanged and correct for exactly this reason). The field is in
   * the response rather than left to be derived, because the alternative is an
   * operator believing an enforcement burned a rung off a finite ladder.
   */
  readonly ordinal_released: true;
  readonly enforced_hold: PayoutHoldRecord;
}

// -----------------------------------------------------------------------------
// The port onto the database
// -----------------------------------------------------------------------------

/**
 * The tables these two rows name, and no others.
 *
 * A NARROW UNION RATHER THAN `string`, on `admin-writes.ts`'s reason: a typo is
 * a compile error at the call site here, and `test/admin-payouts.test.ts`
 * asserts that every member is a real `TableKey` of `packages/db`. That
 * assertion is the half this file cannot make itself, because `@merit/db` is
 * reachable from `src/db.ts` and from the suite and this module holds no import
 * of it.
 *
 * `ledgerTransactions`, `ledgerEntries` and `ledgerAccounts` are absent
 * DELIBERATELY: the posting does not go through this handle. It goes through
 * `AdminPayoutTx.ledger`, which is `@merit/ledger`'s own two-method view, so
 * nothing here can write a ledger row by naming a key.
 */
export const ADMIN_PAYOUT_TABLES = ['payoutRequests', 'adminActions', 'evidencePacks'] as const;

/** One of {@link ADMIN_PAYOUT_TABLES}. */
export type AdminPayoutTable = (typeof ADMIN_PAYOUT_TABLES)[number];

/** An address or a set of values, by Drizzle property name. ADR-112's shape. */
export type AdminPayoutValues = Readonly<Record<string, unknown>>;

/**
 * One open transaction, as these two rows need to see it.
 *
 * `update` AND `delete` ARE ABSENT BECAUSE THEY ARE ABSENT FROM EVERY
 * TRANSACTION HANDLE IN THIS WORKSPACE (ADR-112). The accessors are `rowAt`,
 * `lockAt`, `insert` and `updateAt`, and nothing here reaches for another.
 *
 * `deleteAt` IS ABSENT because nothing here destroys a row: `admin_actions` is
 * append-only under `0026` and the two mutations are updates.
 */
export interface AdminPayoutTx {
  /**
   * ONE row, LOCKED until this transaction ends. ADR-157.
   *
   * `rowAt` plus `FOR UPDATE` on the same predicate, with the tenancy conjunct
   * attached at the accessor. It is the whole concurrency control for both
   * endpoints: see this file's header.
   */
  lockAt(key: AdminPayoutTable, at: AdminPayoutValues): Promise<unknown>;
  /** ONE row, or `undefined`. The address must name a unique key. */
  rowAt(key: AdminPayoutTable, at: AdminPayoutValues): Promise<unknown>;
  insert(key: AdminPayoutTable, values: AdminPayoutValues): Promise<unknown[]>;
  updateAt(
    key: AdminPayoutTable,
    at: AdminPayoutValues,
    values: AdminPayoutValues,
  ): Promise<unknown[]>;
  /**
   * The handle `postTransaction` posts through, on THIS transaction.
   *
   * SUPPLIED BY THE WIRING AND NOT OPENED HERE, exactly as `PayoutTx.ledger` is.
   * `LedgerTx` is structurally satisfied by ADR-102's `SystemTx`, and an
   * operator console runs at `systemDb('operator-console')`, which is one of the
   * two words `SystemReason` already admits. NOTHING HERE WIDENS THAT
   * VOCABULARY.
   *
   * IT IS THE SAME TRANSACTION AS EVERY OTHER METHOD ON THIS HANDLE, which is
   * ADR-006's consequence relied on rather than restated: the status change, the
   * audit row and `LT-01` commit together, so a release that could not post
   * leaves the request held.
   */
  readonly ledger: LedgerTx;
}

/** Everything this module cannot do for itself. */
export interface AdminPayoutBackend {
  /**
   * Run one unit of work at `systemDb('operator-console')`.
   *
   * It takes the whole unit rather than handing back a handle, which is
   * `ApiDb`'s shape and for `ApiDb`'s reason: a transaction cannot outlive the
   * function that opened it and no caller has a `commit` to forget.
   */
  operator<T>(fn: (tx: AdminPayoutTx) => Promise<T>): Promise<T>;
  /**
   * The operator behind this request, or `null` when there is none.
   *
   * NOT IMPLEMENTED HERE. Hardware-key SSO under C-08 and the IP allowlist are
   * edge concerns; what this module needs is the resolved pair, and its type is
   * `admin-writes.ts`'s so that two admin modules cannot answer "who is the
   * operator" two ways.
   */
  principal(request: FastifyRequest): Promise<AdminPrincipal | null>;
  /** The clock, for `updated_at`. Injected so the suite can pin an instant. */
  now(): Date;
}

/** Raised by a backend that is not installed. Answered as 503, never 500. */
export class AdminPayoutUnwired extends Error {
  constructor(what: string) {
    super(
      `AdminPayoutBackend.${what} cannot be served by this deployment: no backend is installed. ` +
        '`useAdminPayoutBackend` was never called, so this process holds the unwired default ' +
        'and refuses rather than returning a plausible value.',
    );
    this.name = 'AdminPayoutUnwired';
  }
}

/**
 * The default, which serves nothing.
 *
 * A BACKEND THAT RETURNED PLAUSIBLE VALUES WOULD BE A FIXTURE PAYING REAL
 * TRADERS. `auth.ts` states the sentence about its own unwired default and it is
 * worth more here than anywhere: the value this one would have to invent is
 * whether a held payout was released.
 */
export const UNWIRED_ADMIN_PAYOUT_BACKEND: AdminPayoutBackend = {
  operator: () => Promise.reject(new AdminPayoutUnwired('operator')),
  principal: () => Promise.reject(new AdminPayoutUnwired('principal')),
  now: () => {
    throw new AdminPayoutUnwired('now');
  },
};

let backend: AdminPayoutBackend = UNWIRED_ADMIN_PAYOUT_BACKEND;

/** Install the backend. The wiring slice calls this; so does the suite. */
export function useAdminPayoutBackend(next: AdminPayoutBackend): void {
  backend = next;
}

/** Restore the unwired default. The suite calls this between cases. */
export function resetAdminPayoutBackend(): void {
  backend = UNWIRED_ADMIN_PAYOUT_BACKEND;
}

/** The installed backend. */
export function currentAdminPayoutBackend(): AdminPayoutBackend {
  return backend;
}

// -----------------------------------------------------------------------------
// Problem documents. Section 2's codes, this module's own senders.
// -----------------------------------------------------------------------------

/** One field's complaint. `admin-writes.ts`'s shape. */
export interface FieldError {
  readonly path: string;
  readonly message: string;
}

/** Section 2's shape widened by `detail` and `errors[]` only. */
interface ProblemDocument extends Problem {
  readonly detail?: string;
  readonly errors?: readonly FieldError[];
}

function sendProblem(reply: FastifyReply, body: ProblemDocument): FastifyReply {
  return reply.code(body.status).type(PROBLEM_MEDIA_TYPE).send(body);
}

/**
 * A section 2 code, built here rather than in `server.ts`.
 *
 * `server.ts`'s `TITLE` table is closed over the codes the TRANSPORT can
 * produce. `service_unavailable` is a handler code and is built here, which is
 * `checkout.ts`'s arrangement and its reason: this module does not reach across
 * a fence to borrow a sender.
 */
function handlerProblem(
  code: string,
  title: string,
  status: number,
  instance: string,
): ProblemDocument {
  return { type: `${PROBLEM_TYPE_PREFIX}${code}`, title, status, code, instance };
}

/** What a {@link Refusal} carries. */
interface RefusalDocument {
  readonly code: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly errors?: readonly FieldError[];
}

/**
 * A refusal decided inside a transaction and thrown out of it, so the write
 * rolls back.
 *
 * THE FIELD IS ASSIGNED IN THE BODY AND IS NOT A CONSTRUCTOR PARAMETER PROPERTY.
 * `apps/api` runs under `node --experimental-strip-types`, which ERASES types
 * rather than compiling them, and a parameter property is the one TypeScript
 * construct that needs code emitted for it. It type-checks, Vitest transpiles
 * it, the suite goes green, and the process does not start -- because
 * `discoverRouteModules` imports every file in `routes/`, so one unsupported
 * construct here takes the whole deployable down. `admin-writes.ts` found that
 * by running under the real runtime and the note is carried rather than
 * rediscovered.
 */
class Refusal extends Error {
  readonly document: RefusalDocument;

  constructor(document: RefusalDocument) {
    super(`${document.code}: ${document.detail ?? document.title}`);
    this.name = 'Refusal';
    this.document = document;
  }
}

function refuse(
  code: string,
  title: string,
  status: number,
  detail?: string,
  errors?: readonly FieldError[],
): Refusal {
  return new Refusal({
    code,
    title,
    status,
    ...(detail === undefined ? {} : { detail }),
    ...(errors === undefined ? {} : { errors }),
  });
}

const notFound = (): Refusal =>
  refuse('not_found', 'Not found', 404, 'No payout request with that id.');

const invalid = (errors: readonly FieldError[]): Refusal =>
  refuse('validation_failed', 'Validation failed', 400, undefined, errors);

// -----------------------------------------------------------------------------
// Turning the database's refusal into the contract's shape
// -----------------------------------------------------------------------------

/** The fields `pg` puts on a `DatabaseError`, read off an `unknown`. */
interface PgFailure {
  readonly code: string;
  readonly table?: string;
  readonly column?: string;
  readonly constraint?: string;
  readonly message: string;
}

/**
 * THE CAUSE CHAIN IS WALKED AND THAT IS NOT DEFENSIVE PROGRAMMING.
 *
 * Drizzle wraps every failed statement in a `DrizzleQueryError` whose own `code`
 * is `undefined` and whose `cause` is the `pg` error carrying the SQLSTATE. A
 * reader that looked only at the thrown object would find no SQLSTATE, fall
 * through to the rethrow, and answer 500 for every refusal this module exists to
 * report. `admin-writes.ts` found that against a real database; the finding is
 * carried here rather than rediscovered, and the chain is walked rather than the
 * first `cause` taken because nothing promises the wrapping stays one deep.
 */
function pgFailure(err: unknown): PgFailure | null {
  let seen: unknown = err;
  for (let depth = 0; depth < 8 && typeof seen === 'object' && seen !== null; depth += 1) {
    const row = seen as Record<string, unknown>;
    if (typeof row['code'] === 'string')
      return {
        code: row['code'],
        ...(typeof row['table'] === 'string' ? { table: row['table'] } : {}),
        ...(typeof row['column'] === 'string' ? { column: row['column'] } : {}),
        ...(typeof row['constraint'] === 'string' ? { constraint: row['constraint'] } : {}),
        message: typeof row['message'] === 'string' ? row['message'] : String(seen),
      };
    seen = row['cause'];
  }
  return null;
}

/**
 * A Postgres integrity failure, answered in the contract's shape.
 *
 * THIS IS REPORTING A REFUSAL AND IT IS NOT MAKING ONE. The statement ran, the
 * database refused it, the transaction rolled back, and this turns `23502 on
 * admin_actions.reason` into `validation_failed` with the column named.
 * Pre-empting that refusal with a validator is the one thing `0017:82` rules
 * out, so the mapping runs AFTER the write rather than instead of it.
 *
 * **`payout_requests_hold_is_complete` ARRIVES HERE AS `23514`** if this module
 * ever fails to blank all five columns, and the constraint name is disclosed on
 * purpose: it is a schema fact rather than another user's data, the audience is
 * an operator on the admin origin, and an operator who cannot see WHICH
 * constraint refused cannot fix the request.
 */
function fromDatabase(failure: PgFailure, instance: string): ProblemDocument {
  const where =
    failure.table === undefined
      ? 'the database'
      : `\`${failure.table}${failure.column === undefined ? '' : `.${failure.column}`}\``;

  switch (failure.code) {
    case '23502':
      return {
        ...handlerProblem('validation_failed', 'Validation failed', 400, instance),
        detail: `${where} is NOT NULL and the write supplied no value. The refusal is the database's.`,
        errors: [
          { path: failure.column ?? '', message: 'is required by the schema and was not supplied' },
        ],
      };
    case '23503':
    case '23514':
      return {
        ...handlerProblem('validation_failed', 'Validation failed', 400, instance),
        detail: `${where} refused this write: ${failure.constraint ?? failure.code}.`,
        errors: [{ path: '', message: failure.constraint ?? failure.message }],
      };
    case '23505':
      return {
        ...handlerProblem('conflict', 'Conflict', 409, instance),
        detail: `${where} already holds a row with that key: ${failure.constraint ?? failure.code}.`,
      };
    default:
      return {
        ...handlerProblem('conflict', 'Conflict', 409, instance),
        detail: failure.message,
      };
  }
}

/** The SQLSTATE classes above, plus the class triggers raise. */
const HANDLED_SQLSTATE = new Set(['23502', '23503', '23505', '23514', 'P0001']);

// -----------------------------------------------------------------------------
// Reading a request body
// -----------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The shape of a UUID, which is what `payout_requests.id` is. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A required non-empty string off the body.
 *
 * ABSENCE IS CARRIED FOR `reason` AND EMPTINESS IS NOT. `admin_actions.reason`
 * is `NOT NULL`, which refuses an omitted reason and ADMITS an empty one, and
 * API_CONTRACT section 8 requires a non-empty reason on every mutating admin
 * endpoint. So the database is left to make the refusal it can make and this
 * makes only the one it cannot -- which is `admin-writes.ts`'s split, applied to
 * a narrower body.
 */
function textField(
  row: Record<string, unknown>,
  key: string,
  errors: FieldError[],
  required: boolean,
): string | undefined {
  const value = row[key];
  if (value === undefined || value === null) {
    if (required) errors.push({ path: key, message: 'is required' });
    return undefined;
  }
  if (typeof value !== 'string') {
    errors.push({ path: key, message: 'must be a string' });
    return undefined;
  }
  if (value.trim() === '') {
    errors.push({
      path: key,
      message:
        'must not be empty. API_CONTRACT section 8 requires a non-empty value and a NOT NULL ' +
        'column admits an empty string',
    });
    return undefined;
  }
  return value;
}

function uuidField(
  row: Record<string, unknown>,
  key: string,
  errors: FieldError[],
): string | undefined {
  const value = row[key];
  if (value === undefined || value === null) {
    errors.push({ path: key, message: 'is required' });
    return undefined;
  }
  if (typeof value !== 'string' || !UUID.test(value)) {
    errors.push({ path: key, message: 'must be a uuid' });
    return undefined;
  }
  return value;
}

/** `:id` off the path, or `null` for anything that cannot name a row. */
function payoutRequestId(request: FastifyRequest): string | null {
  const params = asRecord(request.params);
  if (params === null) return null;
  const value = params['id'];
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

// -----------------------------------------------------------------------------
// The row, read off the accessor
// -----------------------------------------------------------------------------

/** Raised when the row the accessor returned is not one this module can read. */
export class AdminPayoutRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminPayoutRowError';
  }
}

function field(row: unknown, property: string): unknown {
  const record = asRecord(row);
  if (record === null)
    throw new AdminPayoutRowError(
      `payout_requests returned ${typeof row} where a row was expected. The accessor's contract ` +
        'is one row or `undefined`, so this is a handle that is not the one this port declares.',
    );
  return record[property];
}

function stringOf(row: unknown, property: string): string {
  const value = field(row, property);
  if (typeof value !== 'string')
    throw new AdminPayoutRowError(
      `payout_requests.${property} came back as ${typeof value} and this module reads it as a ` +
        'string. A money-path handler does not coerce a column it did not expect.',
    );
  return value;
}

/**
 * A `bigint` money column.
 *
 * IT REFUSES A `number` RATHER THAN ACCEPTING ONE. Every `*_cents` column on
 * this table is `bigint` and the Drizzle declaration pins `{ mode: 'bigint' }`,
 * so a `number` here means the handle is not the accessor and the value may
 * already have lost digits. API_CONTRACT section 1: no floats.
 */
function centsOf(row: unknown, property: string): bigint {
  const value = field(row, property);
  if (typeof value !== 'bigint')
    throw new AdminPayoutRowError(
      `payout_requests.${property} came back as ${typeof value} and this module reads it as a ` +
        '`bigint`. The column is `bigint` and the schema pins `mode: bigint`, so anything else ' +
        'has been through a lossy conversion this handler will not repeat.',
    );
  return value;
}

function integerOf(row: unknown, property: string): number {
  const value = field(row, property);
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new AdminPayoutRowError(
      `payout_requests.${property} came back as ${typeof value} and this module reads it as a ` +
        'safe integer. The column is `integer`.',
    );
  return value;
}

/**
 * A `timestamptz` column, as an ISO string.
 *
 * BOTH SHAPES ARE ACCEPTED because the driver's answer is the driver's: `pg`
 * parses `timestamptz` to a `Date` and a handle that hands back the raw string
 * is still handing back the same instant. Anything else is refused rather than
 * stringified, on `centsOf`'s reason one column class over.
 */
function instantOf(row: unknown, property: string): string {
  const value = field(row, property);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return new Date(value).toISOString();
  throw new AdminPayoutRowError(
    `payout_requests.${property} came back as ${typeof value} and this module reads it as an ` +
      'instant. The column is `timestamptz`.',
  );
}

/**
 * The five hold columns plus the money and the ordinal, read off the LOCKED row
 * before anything is written.
 *
 * ALL FIVE HOLD COLUMNS ARE READ AND NOT FOUR. `hold_reason` has nowhere to go
 * on the wire and is read anyway, because `admin_actions.before` is the only
 * place it will ever exist again and this is the only moment it can be copied
 * there.
 */
interface HeldPayoutRow {
  readonly id: string;
  readonly identityId: string;
  readonly idempotencyKey: string;
  readonly approvedCents: bigint;
  readonly traderCents: bigint;
  readonly firmCents: bigint;
  readonly payoutOrdinal: number;
  readonly heldAt: string;
  readonly holdFlagId: string;
  readonly holdExpiresAt: string;
  readonly holdTosClause: string;
  readonly holdReason: string;
}

/**
 * Read a locked `payout_requests` row that is `held_pending_review`.
 *
 * THE STATUS PRECONDITION IS CHECKED BEFORE THE HOLD COLUMNS ARE READ, so a row
 * in any other state produces the contract's `conflict` rather than a row-shape
 * error about a NULL column. The CHECK guarantees that a `held_pending_review`
 * row has all five populated, so the reads below cannot legitimately fail and a
 * failure means the database is not the one `0031` describes.
 */
function heldPayoutRow(row: unknown): HeldPayoutRow {
  return {
    id: stringOf(row, 'id'),
    identityId: stringOf(row, 'identityId'),
    idempotencyKey: stringOf(row, 'idempotencyKey'),
    approvedCents: centsOf(row, 'approvedCents'),
    traderCents: centsOf(row, 'traderCents'),
    firmCents: centsOf(row, 'firmCents'),
    payoutOrdinal: integerOf(row, 'payoutOrdinal'),
    heldAt: instantOf(row, 'heldAt'),
    holdFlagId: stringOf(row, 'holdFlagId'),
    holdExpiresAt: instantOf(row, 'holdExpiresAt'),
    holdTosClause: stringOf(row, 'holdTosClause'),
    holdReason: stringOf(row, 'holdReason'),
  };
}

/** The contract's block, built from the row read before the write. */
function holdRecordOf(held: HeldPayoutRow): PayoutHoldRecord {
  return {
    held_at: held.heldAt,
    resolves_by: held.holdExpiresAt,
    tos_clause: held.holdTosClause,
    flag_id: held.holdFlagId,
  };
}

/**
 * `admin_actions.before`, and it is the ONLY durable record of the hold.
 *
 * ALL FIVE COLUMNS, WRITTEN UNDER THEIR DATABASE NAMES so a reader of this JSON
 * can find them in `0031` without a mapping table. The status is carried with
 * them because after the write the pair `(status, held_at)` is the whole story
 * and neither half means anything alone.
 */
function holdBefore(held: HeldPayoutRow): Record<string, unknown> {
  return {
    status: HELD,
    held_at: held.heldAt,
    hold_flag_id: held.holdFlagId,
    hold_expires_at: held.holdExpiresAt,
    hold_tos_clause: held.holdTosClause,
    // THE ONE FIELD WITH NOWHERE ELSE TO GO. API_CONTRACT's `released_hold` and
    // `enforced_hold` carry four members and this is the fifth column the CHECK
    // blanks, so this line is the entire surviving record of why the hold was
    // opened.
    hold_reason: held.holdReason,
    approved_cents: centsToJson(held.approvedCents),
    trader_cents: centsToJson(held.traderCents),
    firm_cents: centsToJson(held.firmCents),
    payout_ordinal: held.payoutOrdinal,
  };
}

/**
 * `admin_actions.after`, written with the five NULLs SPELLED OUT.
 *
 * The nulls are the point. A reader comparing `before` with `after` sees exactly
 * which columns stopped existing, which is the only way the erasure is visible
 * at all once the row itself has been rewritten.
 */
function holdAfter(status: 'approved' | 'failed'): Record<string, unknown> {
  return {
    status,
    held_at: null,
    hold_flag_id: null,
    hold_expires_at: null,
    hold_tos_clause: null,
    hold_reason: null,
  };
}

/**
 * The `SET` clause both endpoints share, and it is the CHECK's other half.
 *
 * FIVE EXPLICIT NULLS, NOT FOUR AND NOT A SPREAD. `payout_requests_hold_is_
 * complete` requires every one of them at any status other than
 * `held_pending_review`, so an omission here is a `23514` and never a silent
 * partial hold. They are written out rather than generated from a list because
 * this is the statement the founder's `E2` read is owed on.
 */
function clearHold(status: 'approved' | 'failed', at: Date): Record<string, unknown> {
  return {
    status,
    heldAt: null,
    holdFlagId: null,
    holdExpiresAt: null,
    holdTosClause: null,
    holdReason: null,
    updatedAt: at,
  };
}

/**
 * The ledger transaction's idempotency key for a released hold.
 *
 * IT IS DERIVED FROM THE REQUEST ROW AND IS NOT INVENTED PER CALL.
 * `ledger_transactions.idempotency_key` is `text NOT NULL UNIQUE`, and
 * `INV-M5-06` is "the same `idempotency_key` on every attempt, generated BEFORE
 * the first send and persisted in the same transaction". The request's own
 * stored key is that value, and `payouts.ts` is where `PAYOUT_ENDPOINT` is
 * declared: `${PAYOUT_ENDPOINT} ${key}`. THAT FILE NO LONGER POSTS. ADR-176
 * applied ADR-172 clause 2, so the request path records the approval and writes
 * the client's token to `payout_requests.idempotency_key`, which is the column
 * `held.idempotencyKey` below is read from.
 *
 * **USING THE IDENTICAL STRING IS THE FAIL-CLOSED DIRECTION AND IS THE REASON
 * `PAYOUT_ENDPOINT` IS IMPORTED RATHER THAN RETYPED.** `LT-01` for one payout
 * request is ONE posting whichever door reaches it, so a release cannot post a
 * second `LT-01` against a request that somehow already has one: the database
 * refuses the duplicate key rather than the application remembering not to. A
 * key naming this endpoint instead would have made the two doors mint two
 * postings for one approval and both would have committed.
 */
export function releaseLedgerKey(idempotencyKey: string): string {
  return `${PAYOUT_ENDPOINT} ${idempotencyKey}`;
}

// -----------------------------------------------------------------------------
// The endpoint declaration, and the guard that makes it load bearing
// -----------------------------------------------------------------------------

/** What a handler is given once the role check has passed. */
export interface AdminPayoutContext {
  readonly request: FastifyRequest;
  readonly principal: AdminPrincipal;
  readonly body: Record<string, unknown>;
  readonly tx: AdminPayoutTx;
  readonly backend: AdminPayoutBackend;
  readonly ip: string | null;
  /** The LOCKED, `held_pending_review` row. Read before anything is written. */
  readonly held: HeldPayoutRow;
  /** Writes the `admin_actions` row. Every handler calls it BEFORE it mutates anything. */
  readonly audit: (row: AuditRow) => Promise<void>;
}

/** What one endpoint hands the audit writer. */
interface AuditRow {
  readonly action: string;
  readonly initiative: AdminInitiative;
  readonly reason: string | undefined;
  readonly before: unknown;
  readonly after: unknown;
  readonly evidenceRefs: readonly unknown[];
}

/**
 * Insert the `admin_actions` row.
 *
 * CALLED BEFORE THE MUTATION, ALWAYS. `admin_actions` is append-only (`0026`
 * revokes UPDATE and DELETE from `merit_app` and from PUBLIC) and its retention
 * is forever, so this row is the record and the mutation is what the record
 * explains. On these two endpoints it is more than that: it is the ONLY place
 * the hold survives.
 *
 * `reason` IS OMITTED WHEN ABSENT RATHER THAN DEFAULTED, and omitting it is what
 * makes the `NOT NULL` the control. A spread of `undefined` would have been the
 * same statement to Postgres, but a conditional spread says the intent out loud
 * in a diff a reviewer reads.
 *
 * `initiative` IS THE ROUTE'S AND IS NEVER READ OFF THE WIRE, which is `0043`'s
 * own instruction: "the author of the nineteenth admin route has to answer the
 * question", and its column comment closes the vocabulary at three. Neither of
 * these bodies carries the field in API_CONTRACT, so a caller could not supply
 * it without the contract widening; and if one could, a release labelled
 * `enforcement` would be a false claim about a trader on the row an evidence
 * pack later exports as fact. `on_behalf_of_identity_id` is written by neither,
 * because `admin_actions_on_behalf_matches_initiative` admits it only under
 * `trader_request` and neither of these acts is the trader's.
 */
async function writeAuditRow(
  tx: AdminPayoutTx,
  principal: AdminPrincipal,
  subjectId: string,
  row: AuditRow,
  ip: string | null,
): Promise<void> {
  await tx.insert('adminActions', {
    actor: principal.actor,
    action: row.action,
    subjectKind: 'payout_request',
    subjectId,
    ...(row.reason === undefined ? {} : { reason: row.reason }),
    initiative: row.initiative,
    before: row.before,
    after: row.after,
    evidenceRefs: row.evidenceRefs,
    ...(ip === null ? {} : { ip }),
  });
}

/** One endpoint: its contract path, the roles it admits, and its body. */
export interface AdminPayoutEndpointSpec {
  readonly method: HttpMethod;
  readonly path: string;
  /** `INV-M6-09`, as data. Never a check written inside a handler. */
  readonly roles: readonly AdminRole[];
  readonly handle: (ctx: AdminPayoutContext) => Promise<unknown>;
}

/**
 * Build the framework handler for one declared endpoint.
 *
 * BOTH ROUTES GO THROUGH HERE, so the role check runs before any handler body,
 * the transaction is opened in one place, the row is LOCKED and its status
 * checked in one place, and the database's refusal becomes a problem document in
 * one place.
 *
 * THE ROLE CHECK IS DATA AND NEVER A LINE INSIDE A HANDLER. `FM-M6-09` is "RBAC
 * gap lets `ops` change config", a merge blocker, and its control column is a
 * negative-authz matrix across every role and every mutating endpoint. A matrix
 * can only read a declaration.
 *
 * THE 401 AND THE 403 HAPPEN BEFORE `operator()` IS CALLED, which is this file's
 * `INV-M5-23` paragraph made structural: a refused caller opens no transaction,
 * so there is no `admin_actions` row, no snapshot and no row change to roll
 * back. 401 precedes 403 on section 2's own distinction, because answering 403
 * to an anonymous caller would tell them the endpoint exists and that a role is
 * the only thing missing.
 */
export function adminPayoutHandler(spec: AdminPayoutEndpointSpec): RouteHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const active = currentAdminPayoutBackend();
    try {
      const principal = await active.principal(request);
      if (principal === null)
        return sendProblem(
          reply,
          handlerProblem('unauthenticated', 'Unauthenticated', 401, request.id),
        );
      if (!spec.roles.includes(principal.role))
        return sendProblem(reply, {
          ...handlerProblem('forbidden', 'Forbidden', 403, request.id),
          detail: `The \`${principal.role}\` role may not perform this action.`,
        });

      const id = payoutRequestId(request);
      if (id === null) throw notFound();
      const body = asRecord(request.body) ?? {};
      const ip = request.ip === '' ? null : request.ip;

      return await active.operator(async (tx) => {
        // ADR-157's ROW LOCK, and it is the first statement of the transaction.
        // Two operators resolving one hold is the case it exists for: the
        // second blocks here, then reads a row whose status has moved and
        // refuses below. `FOR UPDATE` on the accessor's own predicate, with the
        // tenancy conjunct attached; no advisory lock is taken and none is
        // reachable from this port.
        const found = await tx.lockAt('payoutRequests', { id });
        if (found === undefined || found === null) throw notFound();

        // THE STATUS PRECONDITION, BEFORE THE HOLD COLUMNS ARE READ. Both
        // contract rows answer `conflict` for a request that is not
        // `held_pending_review`, and the CHECK guarantees that any other status
        // has all five hold columns NULL, so reading them first would produce a
        // row-shape error where the contract requires a 409.
        const status = stringOf(found, 'status');
        if (status !== HELD)
          throw refuse(
            'conflict',
            'Conflict',
            409,
            `This payout request is \`${status}\` and not \`${HELD}\`. Only a held request has ` +
              'an operator path out of the hold.',
          );

        const held = heldPayoutRow(found);
        return await spec.handle({
          request,
          principal,
          body,
          tx,
          backend: active,
          ip,
          held,
          audit: (row) => writeAuditRow(tx, principal, held.id, row, ip),
        });
      });
    } catch (err) {
      if (err instanceof Refusal)
        return sendProblem(reply, {
          ...handlerProblem(err.document.code, err.document.title, err.document.status, request.id),
          ...(err.document.detail === undefined ? {} : { detail: err.document.detail }),
          ...(err.document.errors === undefined ? {} : { errors: err.document.errors }),
        });
      if (err instanceof AdminPayoutUnwired) {
        request.log.error({ err }, 'admin payout backend is not wired');
        return sendProblem(
          reply,
          handlerProblem('service_unavailable', 'Service unavailable', 503, request.id),
        );
      }
      const failure = pgFailure(err);
      if (failure !== null && HANDLED_SQLSTATE.has(failure.code))
        return sendProblem(reply, fromDatabase(failure, request.id));
      throw err;
    }
  };
}

/** The route definitions one set of specs contributes. */
export function toAdminPayoutRoutes(
  specs: readonly AdminPayoutEndpointSpec[],
): readonly RouteDefinition[] {
  return specs.map((spec) => ({
    method: spec.method,
    path: spec.path,
    handler: adminPayoutHandler(spec),
  }));
}

/**
 * The role declaration as data, keyed `METHOD /path`.
 *
 * Derived from the same array the routes are, so the table and the registration
 * cannot disagree. This is what `FM-M6-09`'s matrix reads.
 */
export function adminPayoutRoleTable(
  specs: readonly AdminPayoutEndpointSpec[],
): Readonly<Record<string, readonly AdminRole[]>> {
  const table: Record<string, readonly AdminRole[]> = {};
  for (const spec of specs) table[`${spec.method} ${spec.path}`] = spec.roles;
  return table;
}

// -----------------------------------------------------------------------------
// API_CONTRACT section 8, the two payout rows, in the document's order
// -----------------------------------------------------------------------------

export const ADMIN_PAYOUT_ENDPOINTS: readonly AdminPayoutEndpointSpec[] = [
  {
    method: 'POST',
    path: PAYOUT_RELEASE_PATH,
    // "Auth: `admin_sso`, roles `owner` and `ops`" and "`forbidden` (`readonly`
    // role)". `ACCOUNT_ACTION_ROLES` is that pair, imported rather than retyped
    // so two admin modules cannot disagree about who may act on an account.
    roles: ACCOUNT_ACTION_ROLES,
    handle: async (ctx) => {
      const errors: FieldError[] = [];
      const reason = textField(ctx.body, 'reason', errors, false);
      if (errors.length > 0) throw invalid(errors);

      const held = ctx.held;

      // THE AUDIT ROW FIRST, CARRYING THE HOLD THE NEXT STATEMENT ERASES.
      // `evidence_refs` cites the hold's own flag and ToS clause, which are two
      // of the five columns about to stop existing.
      await ctx.audit({
        action: 'payout_request.release',
        // NOT `enforcement`: this is the branch that pays, and Merit is not
        // acting against the trader. NOT `trader_request`: nobody asked, and
        // that value additionally REQUIRES `on_behalf_of_identity_id` by
        // `admin_actions_on_behalf_matches_initiative`. `0043`'s vocabulary is
        // closed at three, so `operational` is what remains and it is the
        // column comment's own "Merit's own housekeeping".
        initiative: 'operational',
        reason,
        before: holdBefore(held),
        after: holdAfter('approved'),
        evidenceRefs: [
          { kind: 'risk_flag', ref: held.holdFlagId },
          { kind: 'tos_clause', ref: held.holdTosClause },
        ],
      });

      // THE FIVE NULLS. `payout_requests_hold_is_complete` is a biconditional
      // and this is its other half.
      await ctx.tx.updateAt(
        'payoutRequests',
        { id: held.id },
        clearHold('approved', ctx.backend.now()),
      );

      // `LT-01`, THE POSTING THE HOLD DEFERRED. See this file's header: a held
      // request has posted nothing, `approved` is the post-`LT-01` state, and
      // this endpoint is the only door that reaches it. Every amount comes off
      // the stored row and nothing is recomputed (`INV-M5-02`).
      await postTransaction(
        ctx.tx.ledger,
        await readChart(ctx.tx.ledger),
        lt01({
          identityId: held.identityId,
          payoutRequestId: held.id,
          idempotencyKey: releaseLedgerKey(held.idempotencyKey),
          approvedCents: held.approvedCents,
          traderCents: held.traderCents,
          firmCents: held.firmCents,
        }),
      );

      const response: PayoutReleaseResponse = {
        payout_request_id: held.id,
        status: 'approved',
        approved_cents: centsToJson(held.approvedCents),
        trader_cents: centsToJson(held.traderCents),
        firm_cents: centsToJson(held.firmCents),
        payout_ordinal: held.payoutOrdinal,
        released_hold: holdRecordOf(held),
      };
      return response;
    },
  },
  {
    method: 'POST',
    path: PAYOUT_ENFORCE_PATH,
    roles: ACCOUNT_ACTION_ROLES,
    handle: async (ctx) => {
      const errors: FieldError[] = [];
      const reason = textField(ctx.body, 'reason', errors, false);
      // BOTH REQUIRED BY THE CONTRACT'S ERROR LIST: "`validation_failed` (empty
      // `reason`, empty `tos_clause`, or missing `evidence_pack_id`)". The ToS
      // clause is refused here and not by the database, because `admin_actions`
      // has no column for it: it lands in `evidence_refs`, which is `NOT NULL
      // DEFAULT '[]'` and would have accepted its absence silently.
      const tosClause = textField(ctx.body, 'tos_clause', errors, true);
      const packId = uuidField(ctx.body, 'evidence_pack_id', errors);
      if (errors.length > 0 || tosClause === undefined || packId === undefined)
        throw invalid(errors);

      // AN `evidence_pack_id` THAT NAMES NO PACK IS NOT EVIDENCE. The contract
      // says "an exported pack, not a promise of one", and ADR-040's whole
      // bargain is that a hold either pays inside 48 hours or produces a
      // DOCUMENTED enforcement action. A pack id nobody exported would make the
      // documentation a string.
      const pack = await ctx.tx.rowAt('evidencePacks', { id: packId });
      if (pack === undefined || pack === null)
        throw invalid([{ path: 'evidence_pack_id', message: 'names no evidence pack' }]);

      const held = ctx.held;

      await ctx.audit({
        action: 'payout_request.enforce',
        // `enforcement` IS THE ONE VALUE THIS ROW CAN CARRY. `0043`'s column
        // comment: "enforcement is Merit acting against the trader and pairs
        // with an evidence_refs entry", which is the pack cited below.
        initiative: 'enforcement',
        reason,
        before: holdBefore(held),
        after: holdAfter('failed'),
        evidenceRefs: [
          { kind: 'evidence_pack', ref: packId },
          { kind: 'tos_clause', ref: tosClause },
          { kind: 'risk_flag', ref: held.holdFlagId },
        ],
      });

      await ctx.tx.updateAt(
        'payoutRequests',
        { id: held.id },
        clearHold('failed', ctx.backend.now()),
      );

      // NOTHING IS POSTED AND NOTHING IS REVERSED. ADR-040: a held request has
      // posted nothing, so enforcement reverses nothing. That is the whole
      // difference from the freeze path, where `LT-01` has already run and
      // enforcement means `LT-03`.

      const response: PayoutEnforceResponse = {
        payout_request_id: held.id,
        status: 'failed',
        payout_ordinal: held.payoutOrdinal,
        // A FACT OF THE SCHEMA AND NOT A CLAIM THIS HANDLER MAKES. The update
        // above moved `status` to `failed`, and
        // `payout_requests_account_ordinal_uq` is partial on `status <>
        // 'failed'`, so the rung is free the moment that statement commits.
        ordinal_released: true,
        enforced_hold: holdRecordOf(held),
      };
      return response;
    },
  },
];

// -----------------------------------------------------------------------------
// The module
// -----------------------------------------------------------------------------

/** `FM-M6-09`'s matrix reads this. Derived, never written twice. */
export const ADMIN_PAYOUT_ROLES = adminPayoutRoleTable(ADMIN_PAYOUT_ENDPOINTS);

export default defineRoutes({
  name: 'admin-payouts',
  routes: toAdminPayoutRoutes(ADMIN_PAYOUT_ENDPOINTS),
});
