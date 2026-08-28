// =============================================================================
// apps/api/src/routes/admin-certificates.ts
// =============================================================================
// API_CONTRACT SECTION 8's `POST /admin/certificates/:id/revoke`, AND NOTHING
// ELSE.
//
// ADR-170 clause 2 admitted this row into the contract and deliberately built
// nothing: its foreclosure 9 says "no route is registered, no handler is
// written ... The rows are the specification a later slice transcribes, and the
// `E2` read is owed on the handlers". This file is that transcription. It takes
// NO ADR number and NO migration number, because every decision below is already
// ruled and the ones that are not are reported rather than taken.
//
// IT IS THE WRITE SIDE OF `GET /verify/:code` AND THE TWO SHIP TOGETHER for the
// reason ADR-170 clause 2 gives: the only state the verification page publishes
// that is not simply the claim is the revocation, and an entry that specified
// how a revocation is published without specifying how one is recorded would
// leave the published half with no producer. It is also the ONLY way
// `certificates.revocation_class`'s `trader_request` member is ever exercised,
// which is what turns "a trader who wants it stopped can have it stopped" from
// an assurance into a control (ADR-170 section 5, the fifth row).
//
// -----------------------------------------------------------------------------
// `:id` IS `certificates.id` AND NOT THE PUBLIC CODE, AND A COLUMN DECIDES IT
// -----------------------------------------------------------------------------
// `admin_actions.subject_id` is `uuid NOT NULL` (`0017_events_and_audit.sql`),
// so an audit row keyed on the public token COULD NOT BE WRITTEN AT ALL; and
// `0020_public_surface.sql` keeps `code` "DISTINCT FROM `id` so the public token
// can be ROTATED AFTER AN INCIDENT", so an audit trail keyed on it is one that
// loses its subject at exactly the moment the subject matters. ADR-170 section
// 6.2 and foreclosure 6's second half.
//
// -----------------------------------------------------------------------------
// `initiative` IS DERIVED AND IS REFUSED IF SUPPLIED, AND THE SCHEMA IS WHY
// -----------------------------------------------------------------------------
// `admin_actions.initiative` is `NOT NULL` with no default over
// `('enforcement','trader_request','operational')` and
// `admin_actions_on_behalf_matches_initiative` is the biconditional
// `(on_behalf_of_identity_id IS NOT NULL) = (initiative = 'trader_request')`
// (`0043_admin_attributed_actions.sql`). ADR-170 section 6.2 maps the four
// revocation classes onto that vocabulary TOTALLY, and `INITIATIVE_BY_CLASS`
// below is that table transcribed.
//
// AN ENDPOINT THAT TOOK `initiative` WOULD LET AN OPERATOR RECORD AN ENFORCEMENT
// AS SOMETHING THE TRADER ASKED FOR, or a trader's own withdrawal as an
// enforcement, which is exactly the misattribution the biconditional was written
// to prevent arriving through a request body instead of through a column. So the
// field is not read, AND A REQUEST THAT SUPPLIES IT IS REFUSED rather than
// silently ignored: an operator who sent it believes they set it, and an
// endpoint that dropped it on the floor would let them keep believing that.
// `on_behalf_of_identity_id` is refused for the same reason and by the same
// clause, since the biconditional derives it from the class too.
//
// -----------------------------------------------------------------------------
// ONE `reason` STRING WRITES TWO COLUMNS AND BOTH ARE INTERNAL
// -----------------------------------------------------------------------------
// `admin_actions.reason` is `text NOT NULL` ("NO UNEXPLAINED ADMIN ACTION,
// EVER") and `certificates_revocation_is_complete` requires `revoked_reason`
// beside the class. Both are the internal half and NEITHER REACHES A TRADER OR
// PUBLIC SURFACE: `VerifyRow` in `verify.ts` has no field for `revoked_reason`
// at all, so the response this route returns structurally cannot carry it.
//
// -----------------------------------------------------------------------------
// THE RESPONSE IS THE PUBLIC SHAPE, AND THAT IS THE CONTROL
// -----------------------------------------------------------------------------
// ADR-170 section 6.2: it returns exactly what `GET /verify/:code` will return
// for that code, so AN OPERATOR CANNOT REVOKE WITHOUT BEING SHOWN THE SENTENCE
// THEY CAUSED, which is `AS-M11-05`'s concern rendered at the moment of the act
// rather than discovered afterwards on a public page.
//
// THE GUARANTEE THIS FILE CAN HOLD IS THE FUNCTION AND NOT THE CONFIGURATION.
// `renderVerify` is imported from `verify.ts` and is the same code path the
// public row runs, so the SHAPE and the branching cannot drift. The copy is
// `VerifyPresentation`, which each deployment supplies, and the two surfaces are
// two processes: if the operator deployment and the public deployment are
// configured from different copy, this preview shows a sentence the page will
// not print. NOTHING HERE CAN CLOSE THAT and it is reported rather than papered
// over, because a check written here would compare this process's configuration
// against itself.
//
// -----------------------------------------------------------------------------
// A DEFERRED CERTIFICATE IS REFUSED, AND THE HOLE THAT LEAVES IS NAMED
// -----------------------------------------------------------------------------
// M11 section 3.1 draws `issued --> revoked` and `deferred --> withheld` and
// draws NO edge between deferred and revoked. `0020` permits the write, so the
// refusal is this endpoint's rather than the schema's and ADR-170 section 6.3
// states it so it is not met as a bug. Encoding `withheld` as
// deferred-plus-revoked with class `account_enforced` was checked there and
// fails: `AS-M11-05` fixes that class as "the claim stands", and a withheld
// certificate is one Merit never made.
//
// THE CONSEQUENCE, STATED PLAINLY AND NOT REPAIRED: there is today no endpoint
// and no column by which an enforcement reaches a deferred certificate. It is
// owed to the slice that gives `withheld` a column, and that is a migration,
// which is not this fence. The reverse edge is owed too: section 3.1 draws
// `revoked --> issued` for a corrected `issued_in_error`,
// `certificates_revocation_is_complete` permits it, and M11 section 4 lists no
// route. NEITHER IS MINTED HERE.
//
// -----------------------------------------------------------------------------
// RE-REVOCATION IS PERMITTED AND NO IDEMPOTENCY KEY IS READ OFF THE WIRE
// -----------------------------------------------------------------------------
// `certificates_revocation_is_complete` permits overwriting the triple,
// correcting a misclassified revocation is a real operation, and `admin_actions`'
// `before` and `after` are what distinguish a correction from a replay. So no
// new error code is minted for a state the table does not refuse (ADR-170
// section 6.2).
//
// The contract says this row ACCEPTS `Idempotency-Key` and does not require it.
// Nothing here reads one, which is `admin-payouts.ts`' and `admin-wallet.ts`'
// arrangement on their own rows, and this row has a further reason of its own:
// `databaseIdempotencyStore` opens `db.scoped(identityId)` on all three methods
// (`src/idempotency-store.ts:144`) and an operator principal is an actor string
// rather than an identity, so no store in this tree can address a replay by this
// caller. The concurrency control that matters is the ROW LOCK below, and a
// replay writes a second `admin_actions` row whose `before` equals its `after`,
// which is what an auditor reads a replay off.
//
// -----------------------------------------------------------------------------
// THE SURFACE IS THE PATH'S DECISION AND THIS FILE MAKES NO CHECK ABOUT IT
// -----------------------------------------------------------------------------
// `/admin` is one of `surface.ts`' `OPERATOR_PREFIXES`, so `compose` never
// registers this module on the public deployment and the public 404 is the
// router's, produced by there being nothing there (ADR-083 section 4).
//
// ADMIN_ORIGIN IS A PLACEHOLDER AND IS NOT WRITTEN DOWN ANYWHERE. ADR-012: the
// admin console's real apex domain never enters the corpus, the repository, or
// any artifact. There is no hostname in this file, no origin check against a
// literal, and no comment naming one.
//
// -----------------------------------------------------------------------------
// THE PORT IS UNWIRED AND THE OBSTRUCTIONS ARE TWO
// -----------------------------------------------------------------------------
// `principal(request)` resolves only through an `AdminSessionSource`, which is
// the admin identity provider and is not in this database (ADR-171). And
// `certificates` is scope class `owned` on `identity_id`, so `db.firm` refuses
// the key at compile time while `db.scoped` needs an identity THIS ROUTE CANNOT
// KNOW UNTIL IT HAS READ THE ROW: the identity is a column of the row the door
// would be opened to read. That circularity is stated rather than worked around,
// and the whole reason is carried in this port's `BLOCKED` entry.
// =============================================================================

import type { FastifyReply, FastifyRequest } from 'fastify';

import { defineRoutes } from '../registry.ts';
import type { HttpMethod, RouteDefinition, RouteHandler } from '../registry.ts';
import { PROBLEM_MEDIA_TYPE, PROBLEM_TYPE_PREFIX } from '../server.ts';
import type { Problem } from '../server.ts';
import { ACCOUNT_ACTION_ROLES } from './admin-writes.ts';
import type { AdminInitiative, AdminPrincipal, AdminRole } from './admin-writes.ts';
import { REVOCATION_CLASSES } from './certificates.ts';
import type { RevocationClass } from './certificates.ts';
import { readPresentation, renderVerify, toVerifyRow, VerifyPresentationError } from './verify.ts';
import type { VerifyPresentation, VerifyResponse, VerifyRow } from './verify.ts';

/** API_CONTRACT section 8's path, as the contract writes it. */
export const CERTIFICATE_REVOKE_PATH = '/admin/certificates/:id/revoke';

// -----------------------------------------------------------------------------
// The wire
// -----------------------------------------------------------------------------

/**
 * Section 8's `CertificateRevokeRequest`, and it is TWO FIELDS AND NOT THREE.
 *
 * See this file's header: `initiative` is derived from `revocation_class`
 * because `admin_actions_on_behalf_matches_initiative` will not let it be
 * supplied, and a request that supplies it anyway is refused rather than
 * ignored.
 */
export interface CertificateRevokeRequest {
  readonly revocation_class: RevocationClass;
  readonly reason: string;
}

/** Section 8: "The response is the PUBLIC shape, with `result: 'revoked'`." */
export type CertificateRevokeResponse = VerifyResponse;

/**
 * The two request fields this row refuses to be given.
 *
 * BOTH ARE DERIVED AND BOTH ARE DERIVED BY THE SAME BICONDITIONAL, so refusing
 * them is one rule rather than two. ADR-170 foreclosure 6.
 */
export const DERIVED_AUDIT_FIELDS = ['initiative', 'on_behalf_of_identity_id'] as const;

/**
 * ADR-170 section 6.2's mapping, and the four classes cover it TOTALLY.
 *
 * | class              | initiative     | on_behalf_of_identity_id |
 * |--------------------|----------------|--------------------------|
 * | `fact_untrue`      | `operational`  | null. `FM-M11-01` is Merit correcting Merit |
 * | `account_enforced` | `enforcement`  | null. The one class that follows an act against the trader |
 * | `issued_in_error`  | `operational`  | null. A system fault, reversible |
 * | `trader_request`   | `trader_request` | `certificates.identity_id`, which the biconditional REQUIRES |
 *
 * IT IS A TOTAL RECORD OVER THE CHECK'S FOUR MEMBERS, so a class the column
 * admits always has an initiative and `tsc` says so at this declaration rather
 * than a request failing at the database.
 */
export const INITIATIVE_BY_CLASS: Readonly<Record<RevocationClass, AdminInitiative>> = {
  fact_untrue: 'operational',
  account_enforced: 'enforcement',
  issued_in_error: 'operational',
  trader_request: 'trader_request',
};

/**
 * The one class whose initiative REQUIRES an identity on the audit row.
 *
 * Derived from {@link INITIATIVE_BY_CLASS} rather than restated, because
 * `admin_actions_on_behalf_matches_initiative` is a biconditional over
 * `initiative` and a second list of classes would be a second place to get the
 * same fact wrong.
 */
export function needsOnBehalfOf(revocationClass: RevocationClass): boolean {
  return INITIATIVE_BY_CLASS[revocationClass] === 'trader_request';
}

// -----------------------------------------------------------------------------
// The subject, which carries the identity BESIDE the public row and never inside
// -----------------------------------------------------------------------------

/**
 * One `certificates` row, as this route needs to see it.
 *
 * `published` IS THE PUBLIC PROJECTION AND `identityId` IS NOT IN IT. The
 * identity is required by `admin_actions_on_behalf_matches_identity`'s
 * biconditional on the `trader_request` class and is needed nowhere else, so it
 * sits beside `VerifyRow` rather than on it: `renderVerify` takes a `VerifyRow`
 * and there is no path by which the identity reaches a response.
 *
 * `deferredUntil` IS READ OFF `published` and is not duplicated here, so the
 * deferral refusal below and the public projection cannot disagree about
 * whether a row is deferred.
 */
export interface RevocationSubject {
  readonly id: string;
  /** NEVER PUBLISHED. `admin_actions.on_behalf_of_identity_id` only. */
  readonly identityId: string;
  readonly published: VerifyRow;
}

/** Raised when a `certificates` row cannot be read as one. Every case is a defect. */
export class RevocationSubjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RevocationSubjectError';
  }
}

/** The shape of a UUID, which is what `certificates.id` and `identity_id` are. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidColumn(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || !UUID.test(value))
    throw new RevocationSubjectError(
      `\`certificates.${field}\` is \`${String(value)}\`, which is not a uuid. The column is ` +
        '`uuid NOT NULL`',
    );
  return value;
}

/**
 * One row, read as a revocation subject.
 *
 * THE PUBLIC HALF GOES THROUGH `toVerifyRow` AND NOT THROUGH A SECOND READER.
 * Two projections of one table are two places for the disclosure boundary to
 * drift, and this route's whole response is the public one.
 */
export function toRevocationSubject(value: unknown): RevocationSubject {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new RevocationSubjectError(
      'the accessor returned something that is not a `certificates` row. A revocation written ' +
        'against it would revoke whatever the value happened to name',
    );
  const row = value as Record<string, unknown>;
  return {
    id: uuidColumn(row, 'id'),
    identityId: uuidColumn(row, 'identityId'),
    published: toVerifyRow(row),
  };
}

// -----------------------------------------------------------------------------
// The port
// -----------------------------------------------------------------------------

/**
 * The tables this row names, and no others.
 *
 * A NARROW UNION RATHER THAN `string`, on `admin-writes.ts`' reason: a typo is a
 * compile error at the call site here, and `test/admin-certificates.test.ts`
 * asserts that every member is a real `TableKey` of `packages/db`. That
 * assertion is the half this file cannot make itself, because `@merit/db` is
 * reachable from `src/db.ts` and from the suite and this module holds no import
 * of it.
 */
export const ADMIN_CERTIFICATE_TABLES = ['certificates', 'adminActions'] as const;

/** One of {@link ADMIN_CERTIFICATE_TABLES}. */
export type AdminCertificateTable = (typeof ADMIN_CERTIFICATE_TABLES)[number];

/** An address or a set of values, by Drizzle property name. ADR-112's shape. */
export type AdminCertificateValues = Readonly<Record<string, unknown>>;

/**
 * One open transaction, as this row needs to see it.
 *
 * `update` AND `delete` ARE ABSENT BECAUSE THEY ARE ABSENT FROM EVERY
 * TRANSACTION HANDLE IN THIS WORKSPACE (ADR-112), and `deleteAt` is absent
 * because nothing here destroys a row: `admin_actions` is append-only under
 * `0026` and a revocation is an update.
 */
export interface AdminCertificateTx {
  /**
   * ONE row, LOCKED until this transaction ends. ADR-157.
   *
   * IT IS THE WHOLE CONCURRENCY CONTROL FOR THIS ROW. Re-revocation is
   * permitted, so two operators correcting the same misclassification race on
   * the same triple; without the lock the audit's `before` is read outside the
   * transaction that changes it, and the second row records a state that was
   * already gone.
   */
  lockAt(key: AdminCertificateTable, at: AdminCertificateValues): Promise<unknown>;
  insert(key: AdminCertificateTable, values: AdminCertificateValues): Promise<unknown[]>;
  updateAt(
    key: AdminCertificateTable,
    at: AdminCertificateValues,
    values: AdminCertificateValues,
  ): Promise<unknown[]>;
}

/** Everything this module cannot do for itself. */
export interface AdminCertificateBackend {
  /**
   * Run one unit of work at an operator authority.
   *
   * It takes the whole unit rather than handing back a handle, which is
   * `ApiDb`'s shape and for `ApiDb`'s reason: a transaction cannot outlive the
   * function that opened it and no caller has a `commit` to forget.
   */
  operator<T>(fn: (tx: AdminCertificateTx) => Promise<T>): Promise<T>;
  /**
   * The operator behind this request, or `null` when there is none.
   *
   * NOT IMPLEMENTED HERE. Hardware-key SSO under C-08 and the IP allowlist are
   * edge concerns; what this module needs is the resolved pair, and its type is
   * `admin-writes.ts`' so that two admin modules cannot answer "who is the
   * operator" two ways.
   */
  principal(request: FastifyRequest): Promise<AdminPrincipal | null>;
  /** The clock, for `revoked_at`. Injected so the suite can pin an instant. */
  now(): Date;
  /**
   * The copy the response is rendered with, which is `GET /verify/:code`'s.
   *
   * SEE THIS FILE'S HEADER. Sharing the FUNCTION is what this file can
   * guarantee; sharing the CONFIGURATION is the deployment's, because the two
   * surfaces are two processes.
   */
  presentation(): VerifyPresentation;
}

/** Raised by a backend that is not installed. Answered as 503, never 500. */
export class AdminCertificateUnwired extends Error {
  constructor(what: string) {
    super(
      `AdminCertificateBackend.${what} cannot be served by this deployment: no backend is ` +
        'installed. `useCertificateRevokeBackend` was never called, so this process holds the ' +
        'unwired default and refuses rather than returning a plausible value.',
    );
    this.name = 'AdminCertificateUnwired';
  }
}

/**
 * The default, which serves nothing.
 *
 * A BACKEND THAT RETURNED PLAUSIBLE VALUES WOULD BE A FIXTURE REVOKING REAL
 * TRADERS' PROOFS. `AS-M11-05` is written about exactly that act, and the value
 * this one would have to invent is whether a public page now says a trader's
 * achievement was withdrawn.
 */
export const UNWIRED_ADMIN_CERTIFICATE_BACKEND: AdminCertificateBackend = {
  operator: () => Promise.reject(new AdminCertificateUnwired('operator')),
  principal: () => Promise.reject(new AdminCertificateUnwired('principal')),
  now: () => {
    throw new AdminCertificateUnwired('now');
  },
  presentation: () => {
    throw new AdminCertificateUnwired('presentation');
  },
};

let backend: AdminCertificateBackend = UNWIRED_ADMIN_CERTIFICATE_BACKEND;

/** Install the backend. The wiring slice calls this; so does the suite. */
export function useCertificateRevokeBackend(next: AdminCertificateBackend): void {
  backend = next;
}

/** Restore the unwired default. The suite calls this between cases. */
export function resetCertificateRevokeBackend(): void {
  backend = UNWIRED_ADMIN_CERTIFICATE_BACKEND;
}

/** The installed backend. */
export function currentCertificateRevokeBackend(): AdminCertificateBackend {
  return backend;
}

// -----------------------------------------------------------------------------
// Problem documents. Section 2's codes, this module's own senders.
// -----------------------------------------------------------------------------

/** One field's complaint. `admin-writes.ts`' shape. */
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
 * `admin-payouts.ts`' arrangement and its reason: this module does not reach
 * across a fence to borrow a sender.
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
 * it, and the process does not start, because `discoverRouteModules` imports
 * every file in `routes/`. `admin-writes.ts` records finding this the hard way.
 */
class Refusal extends Error {
  readonly document: RefusalDocument;

  constructor(document: RefusalDocument) {
    super(`${document.code}: ${document.detail ?? document.title}`);
    this.name = 'Refusal';
    this.document = document;
  }
}

const notFound = (): Refusal =>
  new Refusal({
    code: 'not_found',
    title: 'Not found',
    status: 404,
    detail: 'No certificate with that id.',
  });

const invalid = (errors: readonly FieldError[]): Refusal =>
  new Refusal({ code: 'validation_failed', title: 'Validation failed', status: 400, errors });

// -----------------------------------------------------------------------------
// The request body
// -----------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * What this route carries inward once the body has been read.
 *
 * `reason` IS OPTIONAL HERE AND REQUIRED ON THE WIRE TYPE, AND THE DIFFERENCE IS
 * THE RULING. {@link CertificateRevokeRequest} is section 8's schema, where the
 * field is required; this is what the handler holds, where ABSENCE IS CARRIED so
 * the insert omits the column and `admin_actions.reason`'s `NOT NULL` is the
 * refusal. Casting the first onto the second would be this module claiming a
 * reason it deliberately did not read.
 */
export interface RevokeCommand {
  readonly revocation_class: RevocationClass;
  /** ABSENT IS CARRIED TO THE DATABASE. Empty is refused before the write. */
  readonly reason?: string;
}

/** What {@link validateRevokeRequest} answers. */
export type ValidatedRevoke =
  | { readonly ok: true; readonly value: RevokeCommand }
  | { readonly ok: false; readonly errors: readonly FieldError[] };

/**
 * Section 8's request, validated total.
 *
 * `reason` IS REFUSED HERE WHEN IT IS EMPTY AND CARRIED WHEN IT IS ABSENT, which
 * is `admin-writes.ts`' ruling and its measurement: `NOT NULL` refuses OMISSION
 * and admits `''` and `'   '`, measured against PostgreSQL 16 with the whole
 * migration set applied, while API_CONTRACT section 8 requires "a non-empty
 * `reason`". So an absent reason is left to the database and an empty one is
 * refused here, in the weaker place, with the weakness stated rather than
 * hidden. The missing `CHECK (btrim(reason) <> '')` is ADR-145's finding and a
 * migration this fence may not write.
 *
 * `revocation_class` IS REFUSED HERE IN BOTH DIRECTIONS, because it is not the
 * same case: the column is `text NULL` with a four-member CHECK, so an absent
 * class writes a NULL the CHECK accepts and
 * `certificates_revocation_is_complete` then refuses for a reason that names the
 * wrong column. The contract types it required with no default and this reads it
 * that way.
 */
export function validateRevokeRequest(body: unknown): ValidatedRevoke {
  const row = asRecord(body) ?? {};
  const errors: FieldError[] = [];

  // THE TWO DERIVED FIELDS ARE REFUSED AND NOT IGNORED. See this file's header:
  // an operator who supplied one believes they set it.
  for (const field of DERIVED_AUDIT_FIELDS)
    if (row[field] !== undefined)
      errors.push({
        path: field,
        message:
          'is not a field of this request. It is DERIVED from `revocation_class`, because ' +
          '`admin_actions_on_behalf_matches_initiative` makes the two a biconditional and an ' +
          'endpoint that took it would let an enforcement be recorded as a trader request',
      });

  const rawClass = row['revocation_class'];
  const revocationClass = REVOCATION_CLASSES.find((known) => known === rawClass);
  if (revocationClass === undefined)
    errors.push({
      path: 'revocation_class',
      message:
        rawClass === undefined || rawClass === null
          ? `is required, and is one of ${REVOCATION_CLASSES.join(', ')}`
          : `must be one of ${REVOCATION_CLASSES.join(', ')}`,
    });

  const rawReason = row['reason'];
  let reason: string | undefined;
  if (rawReason === undefined || rawReason === null) {
    // CARRIED, NOT REFUSED. `admin_actions.reason` is `NOT NULL` and the
    // database is the control (`admin-writes.ts`, `0017:82`).
    reason = undefined;
  } else if (typeof rawReason !== 'string') {
    errors.push({ path: 'reason', message: 'must be a string' });
  } else if (rawReason.trim() === '') {
    errors.push({
      path: 'reason',
      message:
        'must not be empty. `admin_actions.reason` is NOT NULL, which refuses an omitted reason ' +
        'and admits an empty one, and API_CONTRACT section 8 requires a non-empty reason',
    });
  } else {
    reason = rawReason;
  }

  if (errors.length > 0 || revocationClass === undefined) return { ok: false, errors };

  // `reason` ABSENT IS CARRIED AS THE EMPTY STRING NOWHERE. The write omits the
  // column entirely so Postgres raises `23502`, which is the refusal the DDL
  // comment exists for. `''` here would be a value the column accepts.
  return {
    ok: true,
    value: { revocation_class: revocationClass, ...(reason === undefined ? {} : { reason }) },
  };
}

// -----------------------------------------------------------------------------
// The audit row, which is written FIRST
// -----------------------------------------------------------------------------

/**
 * The published half of a revocation, plus the internal reason, as `jsonb`.
 *
 * ALL THREE COLUMNS OF `certificates_revocation_is_complete`, because the
 * constraint writes them together and an audit that recorded two of the three
 * could not reconstruct the row it changed. `admin_actions`' audience is an
 * auditor and never the subject (`packages/db/src/scope.ts`, `adminActions` is
 * scope class `firm`), and `reason` on the same row already carries the same
 * internal text, so nothing is disclosed here that the row does not already
 * hold.
 */
export interface RevocationState {
  readonly revoked_at: string | null;
  readonly revocation_class: RevocationClass | null;
  readonly revoked_reason: string | null;
}

/** The state before the write, read off the locked row. */
export function stateBefore(subject: RevocationSubject, revokedReason: unknown): RevocationState {
  return {
    revoked_at: subject.published.revokedAt,
    revocation_class: subject.published.revocationClass,
    revoked_reason: typeof revokedReason === 'string' ? revokedReason : null,
  };
}

// -----------------------------------------------------------------------------
// The endpoint
// -----------------------------------------------------------------------------

/** One endpoint: its contract path, the roles it admits, and its body. */
export interface AdminCertificateEndpointSpec {
  readonly method: HttpMethod;
  readonly path: string;
  /** `INV-M6-09`, as data. Never a check written inside a handler. */
  readonly roles: readonly AdminRole[];
  readonly handle: (ctx: AdminCertificateContext) => Promise<unknown>;
}

/** What a handler is given once the role check has passed. */
export interface AdminCertificateContext {
  readonly request: FastifyRequest;
  readonly principal: AdminPrincipal;
  readonly body: Record<string, unknown>;
  readonly tx: AdminCertificateTx;
  readonly backend: AdminCertificateBackend;
  readonly presentation: VerifyPresentation;
  readonly ip: string | null;
}

function param(request: FastifyRequest, name: string): string | null {
  const params = asRecord(request.params);
  if (params === null) return null;
  const value = params[name];
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

/**
 * Build the framework handler for one declared endpoint.
 *
 * THE ROLE CHECK IS DATA AND NEVER A LINE INSIDE A HANDLER. `FM-M6-09` is "RBAC
 * gap lets `ops` change config", a merge blocker, and its control column is a
 * negative-authz matrix "across every role and every mutating endpoint". A
 * matrix can only read a declaration; it cannot read an `if` statement.
 *
 * THE PRESENTATION IS RESOLVED BEFORE THE TRANSACTION OPENS. A response this
 * route could not render is a revocation an operator was not shown, and
 * `AS-M11-05`'s whole point is that they are shown it AT THE MOMENT OF THE ACT.
 * Committing a write and then failing to render it would be that control lost in
 * the one direction nothing undoes.
 */
export function adminCertificateHandler(spec: AdminCertificateEndpointSpec): RouteHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const active = currentCertificateRevokeBackend();
    try {
      // A DEPLOYMENT THAT CANNOT AUTHENTICATE ANYONE HAS AUTHENTICATED NOBODY,
      // AND THE ANSWER TO THAT IS 401 RATHER THAN 503. ADR-192 clause 2. The
      // unwired default rejects `principal`, and answering that rejection with
      // the 503 tells an unauthenticated caller that this endpoint exists AND
      // that its backend is the only thing missing, which is the disclosure this
      // handler's own 401-before-403 paragraph refuses one branch later. Whether
      // this process holds a backend is a fact about the deployment, and a
      // caller who has not authenticated may not have it. The discrimination is
      // in the log, where `AdminCertificateUnwired`'s message names the port member.
      let principal: AdminPrincipal | null;
      try {
        principal = await active.principal(request);
      } catch (err) {
        if (!(err instanceof AdminCertificateUnwired)) throw err;
        request.log.error({ err }, 'certificate revoke backend is not wired: principal');
        return sendProblem(
          reply,
          handlerProblem('unauthenticated', 'Unauthenticated', 401, request.id),
        );
      }
      // 401 before 403, on section 2's own distinction: 403 is "authenticated
      // but not permitted", and answering it to an anonymous caller would tell
      // them the endpoint exists and that a role is the only thing missing.
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

      const presentation = readPresentation(active.presentation());
      const ip = request.ip === '' ? null : request.ip;

      return await active.operator((tx) =>
        spec.handle({
          request,
          principal,
          body: asRecord(request.body) ?? {},
          tx,
          backend: active,
          presentation,
          ip,
        }),
      );
    } catch (err) {
      if (err instanceof Refusal)
        return sendProblem(reply, {
          ...handlerProblem(err.document.code, err.document.title, err.document.status, request.id),
          ...(err.document.detail === undefined ? {} : { detail: err.document.detail }),
          ...(err.document.errors === undefined ? {} : { errors: err.document.errors }),
        });
      // A REFUSED PRESENTATION IS THE SAME CASE AS AN UNWIRED PORT, and is
      // answered the same way here as in `verify.ts`: `readPresentation` refuses
      // only what the deployment configured, so a missing sentence is a deploy
      // that has not been finished rather than a defect in a request. It is
      // raised BEFORE `operator` opens, so nothing was written.
      if (err instanceof AdminCertificateUnwired || err instanceof VerifyPresentationError) {
        request.log.error({ err }, 'certificate revoke backend is not wired or is not configured');
        return sendProblem(
          reply,
          handlerProblem('service_unavailable', 'Service unavailable', 503, request.id),
        );
      }
      throw err;
    }
  };
}

/** The route definitions one set of specs contributes. */
export function toAdminCertificateRoutes(
  specs: readonly AdminCertificateEndpointSpec[],
): readonly RouteDefinition[] {
  return specs.map((spec) => ({
    method: spec.method,
    path: spec.path,
    handler: adminCertificateHandler(spec),
  }));
}

/**
 * The role declaration as data, keyed `METHOD /path`.
 *
 * Derived from the same array the routes are, so the table and the registration
 * cannot disagree. This is what `FM-M6-09`'s matrix reads.
 */
export function adminCertificateRoleTable(
  specs: readonly AdminCertificateEndpointSpec[],
): Readonly<Record<string, readonly AdminRole[]>> {
  const table: Record<string, readonly AdminRole[]> = {};
  for (const spec of specs) table[`${spec.method} ${spec.path}`] = spec.roles;
  return table;
}

export const ADMIN_CERTIFICATE_ENDPOINTS: readonly AdminCertificateEndpointSpec[] = [
  {
    method: 'POST',
    path: CERTIFICATE_REVOKE_PATH,
    // Section 8: "Roles: `owner` or `ops`", and "`forbidden`" in its error list.
    // `ACCOUNT_ACTION_ROLES` is that pair, imported rather than retyped so two
    // admin modules cannot disagree about who may act on a trader's row.
    roles: ACCOUNT_ACTION_ROLES,
    handle: async (ctx) => {
      // `:id` IS A UUID OR IT NAMES NO ROW. `admin-writes.ts`' and
      // `admin-payouts.ts`' reading: a path parameter that cannot address a
      // `uuid` column is an address for which no row exists, and section 1's
      // rule that an admin surface answers 403 rather than 404 is about
      // EXISTENCE not being a secret from an authorized operator, which this
      // answer does not contradict.
      const id = param(ctx.request, 'id');
      if (id === null) throw notFound();

      const parsed = validateRevokeRequest(ctx.body);
      if (!parsed.ok) throw invalid(parsed.errors);

      // LOCKED, NOT READ. Re-revocation is permitted, so two operators
      // correcting one misclassification race on the same triple.
      const locked = await ctx.tx.lockAt('certificates', { id });
      if (locked === undefined || locked === null) throw notFound();
      const raw = locked as Record<string, unknown>;
      const subject = toRevocationSubject(locked);

      // A DEFERRED CERTIFICATE CANNOT BE REVOKED. See this file's header:
      // M11 section 3.1 draws no `deferred --> revoked` edge, `0020` permits the
      // write, so the refusal is this endpoint's. The hole it leaves is named
      // there and is not filled here.
      if (subject.published.deferredUntil !== null)
        throw invalid([
          {
            path: 'id',
            message:
              'names a DEFERRED certificate, and a deferral is a claim Merit has not made yet. ' +
              'M11 section 3.1 draws `deferred --> withheld` and no edge from deferred to ' +
              'revoked, and encoding `withheld` as deferred-plus-revoked fails on `AS-M11-05`, ' +
              'which fixes `account_enforced` as "the claim stands". There is today no endpoint ' +
              'and no column by which an enforcement reaches a deferred certificate',
          },
        ]);

      const revocationClass = parsed.value.revocation_class;
      const revokedAt = ctx.backend.now();
      const after: RevocationState = {
        revoked_at: revokedAt.toISOString(),
        revocation_class: revocationClass,
        // `?? null` IS UNREACHABLE IN A COMMITTED ROW AND IS NOT A DEFAULT. An
        // absent reason makes the update omit `revoked_reason`, Postgres raises
        // `23502`, and the whole transaction rolls back including this audit
        // row, so no committed `after` ever carries the null.
        revoked_reason: parsed.value.reason ?? null,
      };

      // THE AUDIT ROW FIRST, CARRYING THE TRIPLE THE NEXT STATEMENT REPLACES.
      // `admin_actions` is append-only under `0026` and its retention is
      // forever, so this row is the record and the mutation is what the record
      // explains. `before` equal to `after` is what an auditor reads a replay
      // off, which is why re-revocation needs no `conflict`.
      await ctx.tx.insert('adminActions', {
        actor: ctx.principal.actor,
        action: 'certificate.revoke',
        subjectKind: 'certificate',
        subjectId: subject.id,
        // OMITTED WHEN ABSENT rather than defaulted, so the `NOT NULL` is the
        // control. A spread of `undefined` says the same thing to Postgres and
        // a conditional spread says the intent out loud in a diff.
        ...(parsed.value.reason === undefined ? {} : { reason: parsed.value.reason }),
        // DERIVED, NEVER SUPPLIED. The biconditional is satisfied by
        // construction: exactly the class whose initiative is `trader_request`
        // carries the identity, and no other.
        initiative: INITIATIVE_BY_CLASS[revocationClass],
        ...(needsOnBehalfOf(revocationClass) ? { onBehalfOfIdentityId: subject.identityId } : {}),
        before: stateBefore(subject, raw['revokedReason']),
        after,
        evidenceRefs: [],
        ...(ctx.ip === null ? {} : { ip: ctx.ip }),
      });

      // ALL THREE COLUMNS IN ONE STATEMENT, which is
      // `certificates_revocation_is_complete`'s own shape: a handler holding one
      // holds all three, and a write that set two would be refused by the
      // database naming a constraint rather than a field.
      const updated = await ctx.tx.updateAt(
        'certificates',
        { id: subject.id },
        {
          revokedAt,
          revocationClass,
          ...(parsed.value.reason === undefined ? {} : { revokedReason: parsed.value.reason }),
        },
      );

      // THE RESPONSE IS BUILT FROM WHAT THE DATABASE HOLDS AND NOT FROM WHAT
      // WAS SENT. An operator is shown the sentence the public page will print,
      // and a preview composed from the request would be a preview of the
      // request rather than of the row.
      const row = updated[0];
      if (row === undefined)
        throw new RevocationSubjectError(
          'the revocation updated no row while the row was locked. The response is the public ' +
            'shape of the row that was written, and there is none to render',
        );

      const response: CertificateRevokeResponse = renderVerify(toVerifyRow(row), ctx.presentation);
      return response;
    },
  },
];

/**
 * The role table for this module's one row.
 *
 * ADR-170 section 8: this row OWES SECTION 12 NO NEW ENTRY, because it is under
 * `/admin/*` and the matrix's existing unauthenticated, trader-session and
 * `readonly` rows each already reach it by prefix. The table exists anyway,
 * because a row declared nowhere is a row a negative-authz gate cannot read.
 */
export const ADMIN_CERTIFICATE_ROLES = adminCertificateRoleTable(ADMIN_CERTIFICATE_ENDPOINTS);

export default defineRoutes({
  name: 'admin-certificates',
  routes: toAdminCertificateRoutes(ADMIN_CERTIFICATE_ENDPOINTS),
});
