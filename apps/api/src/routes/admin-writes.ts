// =============================================================================
// apps/api/src/routes/admin-writes.ts
// =============================================================================
// API_CONTRACT SECTION 8's WRITE ROWS, ON THE OPERATOR SURFACE, AND THE WHOLE
// MODULE IS SHAPED BY ONE LINE OF DDL:
//
//   -- NO UNEXPLAINED ADMIN ACTION, EVER. NOT NULL is the whole control.
//   reason        text NOT NULL,
//
// `packages/db/migrations/0017_events_and_audit.sql:82`. Read that as the
// design rather than as a log line: the reason is a PRECONDITION, and an admin
// write that records no reason is refused by POSTGRES rather than by anything
// in this file.
//
// So the order inside every transaction here is fixed and is the control:
//
//   1. read the target row
//   2. INSERT the `admin_actions` row          <-- refused if there is no reason
//   3. apply the mutation
//
// A route that defaulted a reason, or wrote a placeholder to get past the
// constraint, would defeat the one control the schema actually enforces on
// operators. **NOTHING HERE SUPPLIES A `reason` AND NOTHING HERE SUBSTITUTES A
// NEIGHBOURING FIELD FOR ONE.** `resolution_note` on unfreeze and `note` on a
// flag transition are not reasons under another name; they are recorded as what
// they are, and the reason is carried separately or the write does not happen.
//
// THE ORDERING IS THE HALF THAT MAKES IT STRUCTURAL. Mutating first and
// appending the audit row afterwards would make "no unexplained admin action"
// depend on both statements running. Inserting the audit row first makes the
// explanation a precondition of the mutation in the one place that cannot be
// forgotten, which is the transaction itself.
//
// -----------------------------------------------------------------------------
// THE SAME RULE, APPLIED EVERYWHERE: THIS MODULE TRANSCRIBES AND NEVER SUPPLIES
// -----------------------------------------------------------------------------
// `admin_actions.reason` is not the only `NOT NULL` column API_CONTRACT's
// request bodies do not carry. `plan_versions.public_slug`, the five money
// columns of `plan_version_sizes` that `CreateVersionRequest.sizes` omits, and
// `plan_versions`' publish-decision pair are all in the same position. The
// answer is the same one in every case and it is the reason this file is short
// on invention: **a value this module cannot derive is carried from the request
// or it is absent, and an absent one is the database's refusal to report.** The
// alternative is a handler inventing a money value, which is the failure mode
// the whole corpus is built to refuse. Each of those gaps is named in ADR-145.
//
// -----------------------------------------------------------------------------
// ONE DOOR, AND IT IS `systemDb('operator-console')`
// -----------------------------------------------------------------------------
// Two of the subject tables are `owned` and the rest are `firm`:
//
//   accounts, risk_flags        `owned` on identity_id   -> NOT a FirmTableKey
//   identities                  `root`                   -> NOT a FirmTableKey
//   plans, plan_versions,
//   plan_version_sizes,
//   admin_actions               `firm`
//
// `firmTx` cannot reach an `owned` table by construction, and an operator write
// reaches across identities by definition, so one authority serves all seven
// rows and it is the one ADR-084 accepted the word `'operator-console'` for.
// **`SystemReason` IS NOT WIDENED AND `SqlExecutorReason` IS NOT TOUCHED.**
// ADR-102 section 10 records that this vocabulary is already the widening that
// entry is least comfortable with; adding to it to finish a route slice would
// be the fence-widening this session was told not to do.
//
// The accessor is ADR-112's keyed one: `rowAt`, `updateAt`, `deleteAt`. There is
// no `update` and no `delete` on any transaction handle in this workspace, and
// nothing here reaches for one.
//
// -----------------------------------------------------------------------------
// WHY THE DOOR ARRIVES AS A PORT INSTEAD OF BEING OPENED HERE
// -----------------------------------------------------------------------------
// `apps/api/src/db.ts` is this deployable's one door onto `@merit/db` and it
// offers `scoped` and `firm`. It offers no `system(reason, fn)`, deliberately,
// and its header says why: a request handler is neither of the two system
// reasons. **AN OPERATOR CONSOLE IS ONE OF THEM**, so the third door is owed --
// but `db.ts` is outside this session's fence and session 256 owns the shared
// admin helper, so the door is DECLARED here as a port and installed by whoever
// holds `db.ts` next. Until it is installed every route in this module answers
// **503**, which is `auth.ts`'s `UNWIRED_AUTH_BACKEND` precedent exactly: fail
// closed and honest for a deployment that installed no backend at all.
//
// -----------------------------------------------------------------------------
// THE SURFACE IS THE PATH'S DECISION AND THIS FILE MAKES NO CHECK ABOUT IT
// -----------------------------------------------------------------------------
// `/admin` is one of `surface.ts`'s `OPERATOR_PREFIXES`, so `compose` never
// registers this module on the public deployment and the public 404 is the
// router's, produced by there being nothing there. That is ADR-083 section 4
// and it is not a permission check. **Session 256 owns the surface-selection
// ruling (ADR-144) and what it establishes governs**; nothing in this file
// invents a second answer, and if 256 rules differently about how an operator
// principal is resolved, this module's `AdminSso` port is the seam that moves.
//
// -----------------------------------------------------------------------------
// ADMIN_ORIGIN IS A PLACEHOLDER AND IS NOT WRITTEN DOWN ANYWHERE
// -----------------------------------------------------------------------------
// ADR-012: the admin console's real apex domain never enters the corpus, the
// repository, or any public artifact. There is no hostname in this file, no
// origin check against a literal, and no comment naming one. The origin is
// enforced at the edge and by which deployment registers these routes.
// =============================================================================

import { createHash, randomUUID } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

import { defineRoutes } from '../registry.ts';
import type { HttpMethod, RouteDefinition, RouteHandler } from '../registry.ts';
import { PROBLEM_MEDIA_TYPE, PROBLEM_TYPE_PREFIX } from '../server.ts';
import type { Problem } from '../server.ts';

// -----------------------------------------------------------------------------
// Roles
// -----------------------------------------------------------------------------

/**
 * API_CONTRACT section 8's role set, closed at three.
 *
 * "Roles: `owner` (all), `ops` (read plus account actions, no config or role
 * changes), `readonly`." A fourth role is a ruling and not a value, on
 * `surface.ts`'s reason for closing `API_SURFACES`.
 */
export type AdminRole = 'owner' | 'ops' | 'readonly';

/** {@link AdminRole} as data. */
export const ADMIN_ROLES = ['owner', 'ops', 'readonly'] as const satisfies readonly AdminRole[];

/**
 * Who is performing the write.
 *
 * `actor` is what lands in `admin_actions.actor`, and it NAMES A ROW SINCE
 * `0073_operator_directory.sql` (ADR-237). This comment read "which is `text
 * NOT NULL` and carries no foreign key: the audit names an operator string
 * rather than a row, because the operator directory is the SSO provider's and
 * not this database's", and that reasoning conflated two questions. Proving WHO
 * an operator is stays the C-08 provider's and is a purchase; recording WHICH
 * operators exist and WHAT ROLE each holds is `operators`, and
 * `admin_actions_actor_is_an_operator` makes this string a foreign key into it.
 * An audit row naming an actor in no directory is now unwritable rather than
 * merely undesirable.
 */
export interface AdminPrincipal {
  readonly actor: string;
  readonly role: AdminRole;
}

/**
 * The roles permitted to mutate, per M06's `INV-M6-09`.
 *
 * > "`readonly` cannot mutate anything, and `ops` cannot change config, roles,
 * >  or plan versions."
 *
 * That single line decides all seven rows here. `readonly` is absent from both
 * sets, which is section 12's row *"`readonly` role calls any admin mutation |
 * `admin_sso` | 403"*. A plan version is a plan version, so both plan routes are
 * `owner` only and neither is an "account action".
 */
export const ACCOUNT_ACTION_ROLES = ['owner', 'ops'] as const satisfies readonly AdminRole[];

/** Config, in `INV-M6-09`'s sense. `owner` and nobody else. */
export const CONFIG_ROLES = ['owner'] as const satisfies readonly AdminRole[];

// -----------------------------------------------------------------------------
// The audit envelope, which is the same on every row
// -----------------------------------------------------------------------------

/**
 * `admin_actions.initiative`, `0043_admin_attributed_actions.sql`.
 *
 * The vocabulary is API_CONTRACT's `CloseRequest.kind`, unchanged and in its
 * order, and `0043` says so in its own header: the point of putting it on the
 * audit row was that "eighteen new routes inherit a discriminator instead of
 * eighteen request bodies each inventing one". This module is the first of the
 * eighteen and it inherits it.
 */
export type AdminInitiative = 'enforcement' | 'trader_request' | 'operational';

/** {@link AdminInitiative} as data. The three values `0043`'s CHECK admits. */
export const ADMIN_INITIATIVES = [
  'enforcement',
  'trader_request',
  'operational',
] as const satisfies readonly AdminInitiative[];

/**
 * The fields every admin write carries, whatever it is doing.
 *
 * **EVERY MEMBER IS OPTIONAL AND `reason` MOST OF ALL.** This type is not a
 * statement about what a valid request holds; it is a statement about what this
 * module is willing to read off the wire. Requiring `reason` here would move the
 * refusal from the database into a validator, which is the one thing the DDL
 * comment at `0017:82` exists to prevent.
 *
 * `evidence_refs` is `admin_actions.evidence_refs`, `jsonb NOT NULL DEFAULT
 * '[]'`, and this module appends the route's own references to whatever the
 * caller supplied rather than replacing them.
 */
export interface AdminEnvelope {
  readonly reason?: unknown;
  readonly initiative?: unknown;
  readonly on_behalf_of_identity_id?: unknown;
  readonly evidence_refs?: unknown;
}

// -----------------------------------------------------------------------------
// The port onto the database
// -----------------------------------------------------------------------------

/**
 * The tables this module's seven rows name, and no others.
 *
 * A NARROW UNION RATHER THAN `string`, so a typo is a compile error at the call
 * site here, and `test/admin-writes.test.ts` asserts that every member of it is
 * a real `TableKey` of `packages/db`. That assertion is the half this file
 * cannot make itself: `@merit/db` is reachable from `src/db.ts` and from the
 * suite, and this module holds no import of it.
 */
export const ADMIN_WRITE_TABLES = [
  'adminActions',
  'accounts',
  'accountStatusHistory',
  'riskFlags',
  'identities',
  'plans',
  'planVersions',
  'planVersionSizes',
  'dualControlApprovals',
  'evidencePacks',
] as const;

/** One of {@link ADMIN_WRITE_TABLES}. */
export type AdminWriteTable = (typeof ADMIN_WRITE_TABLES)[number];

/** A filter or an address, by Drizzle property name. ADR-112's shape. */
export type AdminRowFilter = Readonly<Record<string, unknown>>;

/**
 * ADR-112's keyed accessor, as much of it as these seven rows need.
 *
 * `update` and `delete` are ABSENT because they are absent from every
 * transaction handle in this workspace. `deleteAt` is absent because nothing
 * here destroys a row: `admin_actions` is append-only and the other six writes
 * are updates and inserts.
 */
export interface AdminWriteTx {
  rowAt(key: AdminWriteTable, at: AdminRowFilter): Promise<unknown>;
  rowsWhere(key: AdminWriteTable, where: AdminRowFilter): Promise<unknown[]>;
  insert(key: AdminWriteTable, values: AdminRowFilter): Promise<unknown[]>;
  updateAt(key: AdminWriteTable, at: AdminRowFilter, values: AdminRowFilter): Promise<unknown[]>;
}

/**
 * Everything this module cannot do for itself.
 *
 * ONE OBJECT RATHER THAN FOUR INSTALLERS, so a deployment that wires half of it
 * is a type error instead of a route that authenticates and cannot write.
 */
export interface AdminWriteBackend {
  /**
   * Run one unit of work at `systemDb('operator-console')`.
   *
   * It takes the whole unit rather than handing back a handle, which is
   * `ApiDb`'s shape and for `ApiDb`'s reason: a transaction cannot outlive the
   * function that opened it and no caller has a `commit` to forget.
   */
  operator<T>(fn: (tx: AdminWriteTx) => Promise<T>): Promise<T>;

  /**
   * The operator behind this request, or `null` when there is none.
   *
   * NOT IMPLEMENTED HERE, AND THAT IS SESSION 256's FENCE RATHER THAN A GAP.
   * Hardware-key SSO under C-08 and the IP allowlist are edge concerns; what
   * this module needs is the resolved pair, and the resolution is the admin
   * surface's shared helper.
   */
  principal(request: FastifyRequest): Promise<AdminPrincipal | null>;

  /**
   * `validatePlan` from `@merit/rules-engine`, as a port.
   *
   * PUBLISH CANNOT PROCEED WITHOUT IT. `CV-01` to `CV-19` are publish-time
   * checks over `rules` and the size rows, and a publish that skipped them
   * would put a plan version in front of buyers that the engine refuses to
   * resolve.
   *
   * THE SENTENCE THAT STOOD HERE WAS "`apps/api` does not declare
   * `@merit/rules-engine`" AND IT HAS BEEN FALSE SINCE SESSION 252 landed
   * `routes/payouts.ts`: the dependency is declared in `apps/api/package.json`
   * and `validatePlan` is exported. `test/wiring.test.ts` recorded the
   * correction on its own entry (ADR-171 finding 10) and said in the same
   * breath that the stale copy survived HERE because a handler file was
   * outside that entry's fence. It is inside this one, so it is repaired at
   * the source rather than contradicted from another file.
   *
   * WHAT IS STILL TRUE IS THE PORT, AND IT IS TRUE FOR A DIFFERENT REASON. The
   * remaining gap is a PROJECTION rather than a dependency: `validatePlan`
   * answers a `ValidationResult`, whose `errors` are `CvViolation` values
   * (`{ id, path, detail, sizeCents }`) and whose failure includes a non-empty
   * `materialization`, and {@link PlanValidation} is `{ code, message }` with a
   * boolean. Nothing in this tree performs that projection, so the validator
   * still arrives the way the database does: injected, unwired by default, and
   * 503 until somebody writes it.
   */
  validatePlan(rules: unknown, sizes: readonly unknown[]): PlanValidation;

  /** The clock, for the `timestamptz` columns. Injected so the suite can pin an instant. */
  now(): Date;

  /**
   * TODAY'S TRADING DAY, AS A `date`, AND IT IS INJECTED BECAUSE THIS MODULE
   * CANNOT DERIVE IT.
   *
   * `accounts.closed_on` is a `date` and the trading day follows the exchange
   * session calendar in CT while storage is UTC, so `new Date().toISOString()`
   * is wrong for the hours a day the two disagree.
   *
   * "NOTHING IN THIS WORKSPACE MAPS AN INSTANT TO A TRADING DAY" STOOD HERE AND
   * IS NOW FALSE (ADR-251). `@merit/rules-engine` exports `buildSessionCalendar`
   * and `tradingDayAt`, which read `trading_calendar`'s stored session bounds
   * and `trading_calendar_loads`' coverage and answer by CONTAINMENT, comparing
   * an instant only with an instant and reading the day off the row that
   * comparison selected. `apps/api` declares that package and holds `db.firm`,
   * and both tables are `firm` in the registry, so the supplier and the read are
   * both here.
   *
   * WHAT THIS SIGNATURE STILL CANNOT BE HANDED IS A TOTAL FUNCTION, AND THAT IS
   * NOW THE WHOLE OF THE GAP. `tradingDayAt` answers three ways, because
   * ADR-042 F-4 requires it to: a day, `not_a_session` for an instant inside
   * coverage that no session contains (a weekend, a holiday, the gap between
   * one close and the next open), and `outside_coverage` for an instant the
   * estate has loaded nothing around. `tradingDay(): string` has one arm for
   * three answers. AND NO RULING SAYS WHICH DAY AN OPERATOR CLOSE TAKES WHEN
   * THE INSTANT IS IN NO SESSION, while `accounts_terminal_has_close_date`
   * requires `closed_on` on every `closed_admin` row. So what is owed here is a
   * DECISION and no longer a function, and this port keeps its shape until one
   * exists rather than picking a day on a handler's authority.
   */
  tradingDay(): string;
}

/** What {@link AdminWriteBackend.validatePlan} answers. `@merit/rules-engine`'s shape, narrowed. */
export interface PlanValidation {
  readonly ok: boolean;
  readonly errors: readonly { readonly code: string; readonly message: string }[];
}

/** Raised by a backend that is not installed. Answered as 503, never 500. */
export class AdminWriteUnwired extends Error {
  constructor(what: string) {
    super(
      `AdminWriteBackend.${what} cannot be served by this deployment: no backend is installed. ` +
        '`useAdminWriteBackend` was never called, so this process holds the unwired default and ' +
        'refuses rather than returning a plausible value.',
    );
    this.name = 'AdminWriteUnwired';
  }
}

/**
 * The default, which serves nothing.
 *
 * A BACKEND THAT RETURNED PLAUSIBLE VALUES WOULD BE A FIXTURE SERVING REAL
 * OPERATORS, which is `auth.ts`'s sentence about its own unwired default and is
 * worth more here: the values this one would have to invent decide whether an
 * account is frozen and whether a plan version is on sale.
 */
export const UNWIRED_ADMIN_WRITE_BACKEND: AdminWriteBackend = {
  operator: () => Promise.reject(new AdminWriteUnwired('operator')),
  principal: () => Promise.reject(new AdminWriteUnwired('principal')),
  validatePlan: () => {
    throw new AdminWriteUnwired('validatePlan');
  },
  now: () => {
    throw new AdminWriteUnwired('now');
  },
  tradingDay: () => {
    throw new AdminWriteUnwired('tradingDay');
  },
};

let backend: AdminWriteBackend = UNWIRED_ADMIN_WRITE_BACKEND;

/** Install the backend. The wiring slice calls this; so does the suite. */
export function useAdminWriteBackend(next: AdminWriteBackend): void {
  backend = next;
}

/** Restore the unwired default. The suite calls this between cases. */
export function resetAdminWriteBackend(): void {
  backend = UNWIRED_ADMIN_WRITE_BACKEND;
}

/** The installed backend. */
export function currentAdminWriteBackend(): AdminWriteBackend {
  return backend;
}

// -----------------------------------------------------------------------------
// Problem documents. Section 2's codes, this module's own senders.
// -----------------------------------------------------------------------------

/** One field's complaint, `auth.ts`'s shape. */
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
 * produce. `precondition_failed` and `service_unavailable` are handler codes and
 * are built here, which is `checkout.ts`'s arrangement and its reason: this
 * module does not reach across a fence to borrow a sender.
 */
function handlerProblem(
  code: string,
  title: string,
  status: number,
  instance: string,
): ProblemDocument {
  return { type: `${PROBLEM_TYPE_PREFIX}${code}`, title, status, code, instance };
}

/** What a {@link Refusal} carries: a section 2 code and the parts of a problem document. */
interface RefusalDocument {
  readonly code: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly errors?: readonly FieldError[];
}

/**
 * A refusal decided inside a transaction and thrown out of it, so the write rolls back.
 *
 * THE FIELD IS ASSIGNED IN THE BODY AND IS NOT A CONSTRUCTOR PARAMETER PROPERTY.
 * `apps/api` runs under `node --experimental-strip-types` (`pnpm start`), which
 * ERASES types rather than compiling them, and a parameter property is the one
 * TypeScript construct that needs code emitted for it:
 * `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX: TypeScript parameter property is not
 * supported in strip-only mode`. It type-checks, Vitest transpiles it, the suite
 * goes green, and **the process does not start** -- because `discoverRouteModules`
 * imports every file in `routes/`, so one unsupported construct here takes the
 * whole deployable down. Found by running this module under the real runtime
 * rather than under the test transform.
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

const notFound = (what: string): Refusal =>
  refuse('not_found', 'Not found', 404, `No ${what} with that id.`);

const invalid = (errors: readonly FieldError[]): Refusal =>
  refuse('validation_failed', 'Validation failed', 400, undefined, errors);

// -----------------------------------------------------------------------------
// Reading a request body, and the one field this module refuses to validate
// -----------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The shape of a UUID, which is what every id column in this schema is. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidField(
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
  if (typeof value !== 'string' || !UUID.test(value)) {
    errors.push({ path: key, message: 'must be a uuid' });
    return undefined;
  }
  return value;
}

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
    errors.push({ path: key, message: 'must not be empty' });
    return undefined;
  }
  return value;
}

/**
 * MONEY, AND THERE IS NO PATH FROM A FLOAT TO A CENTS COLUMN THROUGH THIS.
 *
 * API_CONTRACT section 1: "`*_cents` are JSON integers. `*_bp` are JSON
 * integers. NO FLOATS, no formatted strings." Every cents column this module
 * writes is `bigint` in the schema, so the value carried inward is a `bigint`
 * and the only `number` is the one that arrived on the wire. A value that is
 * not a safe integer is an ERROR and never a nearest one.
 */
function centsField(
  row: Record<string, unknown>,
  key: string,
  path: string,
  errors: FieldError[],
): bigint | undefined {
  const value = row[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    errors.push({ path, message: 'must be an integer number of cents' });
    return undefined;
  }
  return BigInt(value);
}

/** A `bigint` back onto the wire, refusing rather than rounding. */
function centsToJson(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error(`${String(value)} cents does not fit a JSON integer`);
  return Number(value);
}

/**
 * The audit envelope, read off the wire WITHOUT REQUIRING A REASON.
 *
 * -----------------------------------------------------------------------------
 * THIS FUNCTION IS THE SESSION'S RULING AND IT IS FIVE LINES LONG
 * -----------------------------------------------------------------------------
 * `reason` has exactly three outcomes here and the middle one is the point:
 *
 *   a non-empty string   carried through, verbatim, to `admin_actions.reason`
 *   absent, or null      OMITTED FROM THE WRITE, so the INSERT omits the column
 *                        and Postgres raises 23502. **The refusal is the
 *                        database's and this module does not pre-empt it.**
 *   an empty string,     refused HERE, 400, because the DDL cannot see it
 *   or any other type
 *
 * The third case is not this module second-guessing the database. `NOT NULL`
 * refuses OMISSION and admits `''` and `'   '`, measured against PostgreSQL 16
 * with the whole migration set applied, while API_CONTRACT section 8 requires
 * "a non-empty `reason`". `plan_versions` one table over carries the idiom that
 * would close it -- `CHECK (btrim(simulation_waiver_reason) <> '')` -- and
 * `admin_actions.reason` does not have it. **That is a missing constraint and a
 * migration this session may not write** (session 240 owns the numbers), so it
 * is named in ADR-145 and guarded here, in the weaker place, with the weakness
 * stated rather than hidden.
 */
interface ReadEnvelope {
  /** Present only when a non-empty reason was supplied. ABSENCE IS CARRIED. */
  readonly reason?: string;
  readonly initiative?: AdminInitiative;
  readonly onBehalfOfIdentityId?: string;
  readonly evidenceRefs: readonly unknown[];
}

function readEnvelope(row: Record<string, unknown>, errors: FieldError[]): ReadEnvelope {
  const rawReason = row['reason'];
  let reason: string | undefined;
  if (rawReason === undefined || rawReason === null) {
    // CARRIED, NOT REFUSED. The database is the control.
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

  const rawInitiative = row['initiative'];
  let initiative: AdminInitiative | undefined;
  if (rawInitiative !== undefined && rawInitiative !== null) {
    const found = ADMIN_INITIATIVES.find((known) => known === rawInitiative);
    if (found === undefined)
      errors.push({
        path: 'initiative',
        message: `must be one of ${ADMIN_INITIATIVES.join(', ')}`,
      });
    else initiative = found;
  }

  const onBehalf = uuidField(row, 'on_behalf_of_identity_id', errors, false);

  const rawRefs = row['evidence_refs'];
  let evidenceRefs: readonly unknown[] = [];
  if (rawRefs !== undefined && rawRefs !== null) {
    if (!Array.isArray(rawRefs))
      errors.push({ path: 'evidence_refs', message: 'must be an array' });
    else evidenceRefs = rawRefs;
  }

  return {
    ...(reason === undefined ? {} : { reason }),
    ...(initiative === undefined ? {} : { initiative }),
    ...(onBehalf === undefined ? {} : { onBehalfOfIdentityId: onBehalf }),
    evidenceRefs,
  };
}

// -----------------------------------------------------------------------------
// The audit row, which is written FIRST
// -----------------------------------------------------------------------------

/** What one route hands the audit writer. Everything else is the envelope's. */
interface AuditRow {
  readonly action: string;
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly before: unknown;
  readonly after: unknown;
  /** Appended to whatever the caller supplied. */
  readonly evidenceRefs?: readonly unknown[];
  /** Overrides the envelope's, which is `close`'s `kind`. */
  readonly initiative?: AdminInitiative;
}

/**
 * Insert the `admin_actions` row.
 *
 * **CALLED BEFORE THE MUTATION, ALWAYS.** `admin_actions` is append-only
 * (`0026` revokes UPDATE and DELETE from `merit_app` and from PUBLIC) and its
 * retention is forever, so this row is the record and the mutation is what the
 * record explains.
 *
 * `reason` AND `initiative` ARE OMITTED WHEN ABSENT rather than defaulted, and
 * omitting them is what makes the `NOT NULL` on each of them the control. A
 * spread of `undefined` would have been the same statement to Postgres, but a
 * conditional spread says the intent out loud in a diff a reviewer reads.
 */
async function writeAuditRow(
  tx: AdminWriteTx,
  principal: AdminPrincipal,
  envelope: ReadEnvelope,
  row: AuditRow,
  ip: string | null,
): Promise<void> {
  const initiative = row.initiative ?? envelope.initiative;
  await tx.insert('adminActions', {
    actor: principal.actor,
    action: row.action,
    subjectKind: row.subjectKind,
    subjectId: row.subjectId,
    ...(envelope.reason === undefined ? {} : { reason: envelope.reason }),
    ...(initiative === undefined ? {} : { initiative }),
    ...(envelope.onBehalfOfIdentityId === undefined
      ? {}
      : { onBehalfOfIdentityId: envelope.onBehalfOfIdentityId }),
    before: row.before,
    after: row.after,
    evidenceRefs: [...envelope.evidenceRefs, ...(row.evidenceRefs ?? [])],
    ...(ip === null ? {} : { ip }),
  });
}

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
 * Drizzle wraps every failed statement in a `DrizzleQueryError` whose own
 * `code` is `undefined` and whose `cause` is the `pg` error carrying the
 * SQLSTATE, the table and the column. Measured against `drizzle-orm` in this
 * workspace: `name: 'Error'`, `constructor.name: 'DrizzleQueryError'`, own keys
 * `query`, `params`, `cause`. A reader that looked only at the thrown object
 * would find no SQLSTATE, fall through to the rethrow, and answer **500** for
 * every refusal this module exists to report -- which is what it did until this
 * suite ran against a real database and said so.
 *
 * The chain is walked rather than the first `cause` taken, because nothing
 * promises the wrapping stays one deep.
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
 * **THIS IS REPORTING A REFUSAL AND IT IS NOT MAKING ONE.** Nothing here decided
 * anything: the statement ran, the database refused it, the transaction rolled
 * back, and this function turns `23502 on admin_actions.reason` into
 * `validation_failed` with the column named. Pre-empting that refusal with a
 * validator is the one thing `0017:82` rules out, so the mapping runs AFTER the
 * write rather than instead of it.
 *
 * The constraint name is disclosed on purpose. It is a schema fact rather than
 * another user's data, the audience is an operator on the admin origin, and an
 * operator who cannot see WHICH constraint refused cannot fix the request.
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
          {
            path: failure.column ?? '',
            message: 'is required by the schema and was not supplied',
          },
        ],
      };
    case '23514':
    case '23503':
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
// The endpoint declaration, and the guard that makes it load bearing
// -----------------------------------------------------------------------------

/** What a handler is given once the role check has passed. */
export interface AdminContext {
  readonly request: FastifyRequest;
  readonly principal: AdminPrincipal;
  readonly body: Record<string, unknown>;
  readonly envelope: ReadEnvelope;
  readonly tx: AdminWriteTx;
  readonly backend: AdminWriteBackend;
  readonly ip: string | null;
  /** Writes the audit row. Every handler calls it BEFORE it mutates anything. */
  readonly audit: (row: AuditRow) => Promise<void>;
}

/** One endpoint: its contract path, the roles it admits, and its body. */
export interface AdminEndpointSpec {
  readonly method: HttpMethod;
  readonly path: string;
  /** `INV-M6-09`, as data. Never a check written inside a handler. */
  readonly roles: readonly AdminRole[];
  readonly handle: (ctx: AdminContext) => Promise<unknown>;
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
 * EVERY ROUTE IN THIS MODULE GOES THROUGH HERE, so the role check is applied
 * before any handler body runs, the transaction is opened in one place, and the
 * database's refusal is turned into a problem document in one place.
 *
 * THE ROLE CHECK IS DATA AND NEVER A LINE INSIDE A HANDLER. `FM-M6-09` is "RBAC
 * gap lets `ops` change config", a merge blocker, and its control column is a
 * negative-authz matrix "across every role and every mutating endpoint". A
 * matrix can only read a declaration; it cannot read seven `if` statements.
 */
export function adminHandler(spec: AdminEndpointSpec): RouteHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const active = currentAdminWriteBackend();
    try {
      // A DEPLOYMENT THAT CANNOT AUTHENTICATE ANYONE HAS AUTHENTICATED NOBODY,
      // AND THE ANSWER TO THAT IS 401 RATHER THAN 503. ADR-192 clause 2. The
      // unwired default rejects `principal`, and answering that rejection with
      // the 503 tells an unauthenticated caller that this endpoint exists AND
      // that its backend is the only thing missing, which is the disclosure the
      // comment four lines below refuses one branch later. Whether this process
      // holds a backend is a fact about the deployment, and a caller who has not
      // authenticated may not have it. The discrimination is in the log, where
      // `AdminWriteUnwired`'s message names the port member.
      let principal: AdminPrincipal | null;
      try {
        principal = await active.principal(request);
      } catch (err) {
        if (!(err instanceof AdminWriteUnwired)) throw err;
        request.log.error({ err }, 'admin write backend is not wired: principal');
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

      const body = asRecord(request.body) ?? {};
      const errors: FieldError[] = [];
      const envelope = readEnvelope(body, errors);
      if (errors.length > 0) throw invalid(errors);

      const ip = request.ip === '' ? null : request.ip;
      return await active.operator(async (tx) => {
        return await spec.handle({
          request,
          principal,
          body,
          envelope,
          tx,
          backend: active,
          ip,
          audit: (row) => writeAuditRow(tx, principal, envelope, row, ip),
        });
      });
    } catch (err) {
      if (err instanceof Refusal)
        return sendProblem(reply, {
          ...handlerProblem(err.document.code, err.document.title, err.document.status, request.id),
          ...(err.document.detail === undefined ? {} : { detail: err.document.detail }),
          ...(err.document.errors === undefined ? {} : { errors: err.document.errors }),
        });
      if (err instanceof AdminWriteUnwired) {
        request.log.error({ err }, 'admin write backend is not wired');
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
export function toAdminRoutes(specs: readonly AdminEndpointSpec[]): readonly RouteDefinition[] {
  return specs.map((spec) => ({
    method: spec.method,
    path: spec.path,
    handler: adminHandler(spec),
  }));
}

/**
 * The role declaration as data, keyed `METHOD /path`.
 *
 * Derived from the same array the routes are derived from, so the table and the
 * registration cannot disagree. This is what `FM-M6-09`'s matrix reads.
 */
export function adminRoleTable(
  specs: readonly AdminEndpointSpec[],
): Readonly<Record<string, readonly AdminRole[]>> {
  const table: Record<string, readonly AdminRole[]> = {};
  for (const spec of specs) table[`${spec.method} ${spec.path}`] = spec.roles;
  return table;
}

// -----------------------------------------------------------------------------
// Reading a row back out of the accessor
// -----------------------------------------------------------------------------
//
// `rowAt` answers `unknown`, deliberately: `packages/db` returns rows and does
// not claim to know their shape at this boundary. Every projection below reads
// the columns this module writes and nothing else, so a schema change that
// removed one is a failure here rather than an `undefined` written into a
// jsonb `before` document that a dispute later reads.

function field(row: unknown, property: string, table: string): unknown {
  const record = asRecord(row);
  if (record === null) throw new Error(`${table} row is not an object`);
  if (!(property in record))
    throw new Error(
      `${table} row carries no \`${property}\`; the accessor and the schema disagree`,
    );
  return record[property];
}

function stringOf(row: unknown, property: string, table: string): string {
  const value = field(row, property, table);
  if (typeof value !== 'string') throw new Error(`${table}.${property} is not a string`);
  return value;
}

function booleanOf(row: unknown, property: string, table: string): boolean {
  const value = field(row, property, table);
  if (typeof value !== 'boolean') throw new Error(`${table}.${property} is not a boolean`);
  return value;
}

function numberOf(row: unknown, property: string, table: string): number {
  const value = field(row, property, table);
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new Error(`${table}.${property} is not an integer`);
  return value;
}

/** The columns of `accounts` these four routes read or write. */
interface AccountRow {
  readonly id: string;
  readonly identityId: string;
  readonly status: string;
  readonly phase: string;
  readonly payoutsFrozen: boolean;
  readonly closedOn: string | null;
  readonly closeReason: string | null;
}

function accountRow(row: unknown): AccountRow {
  const closedOn = field(row, 'closedOn', 'accounts');
  const closeReason = field(row, 'closeReason', 'accounts');
  return {
    id: stringOf(row, 'id', 'accounts'),
    identityId: stringOf(row, 'identityId', 'accounts'),
    status: stringOf(row, 'status', 'accounts'),
    phase: stringOf(row, 'phase', 'accounts'),
    payoutsFrozen: booleanOf(row, 'payoutsFrozen', 'accounts'),
    closedOn: typeof closedOn === 'string' ? closedOn : null,
    closeReason: typeof closeReason === 'string' ? closeReason : null,
  };
}

/** The columns of `risk_flags` the status route reads or writes. */
interface FlagRow {
  readonly id: string;
  readonly identityId: string;
  readonly status: string;
}

function flagRow(row: unknown): FlagRow {
  return {
    id: stringOf(row, 'id', 'risk_flags'),
    identityId: stringOf(row, 'identityId', 'risk_flags'),
    status: stringOf(row, 'status', 'risk_flags'),
  };
}

/** The columns of `plan_versions` the two plan routes read or write. */
interface PlanVersionRow {
  readonly id: string;
  readonly planId: string;
  readonly version: number;
  readonly status: string;
  readonly rules: unknown;
}

function planVersionRow(row: unknown): PlanVersionRow {
  return {
    id: stringOf(row, 'id', 'plan_versions'),
    planId: stringOf(row, 'planId', 'plan_versions'),
    version: numberOf(row, 'version', 'plan_versions'),
    status: stringOf(row, 'status', 'plan_versions'),
    rules: field(row, 'rules', 'plan_versions'),
  };
}

async function loadAccount(tx: AdminWriteTx, accountId: string | null): Promise<AccountRow> {
  if (accountId === null) throw notFound('account');
  const found = await tx.rowAt('accounts', { id: accountId });
  if (found === undefined || found === null) throw notFound('account');
  return accountRow(found);
}

/** An `evidence_pack_id` that names no pack is not evidence. */
async function requireEvidencePack(tx: AdminWriteTx, id: string, path: string): Promise<void> {
  const found = await tx.rowAt('evidencePacks', { id });
  if (found === undefined || found === null)
    throw invalid([{ path, message: 'names no evidence pack' }]);
}

// -----------------------------------------------------------------------------
// API_CONTRACT section 8, the write rows, in the document's order
// -----------------------------------------------------------------------------
//
// THE DISPATCH NAMED FOUR AND THE CONTRACT CARRIES SEVEN UNDER THOSE FOUR
// PREFIXES. `POST /admin/accounts/:account` is not a row in API_CONTRACT; it is
// the prefix of `/freeze`, `/unfreeze`, `/close` and `/note`, which are. The
// corpus is the specification, so the rows are what is written here.

export const ADMIN_WRITE_ENDPOINTS: readonly AdminEndpointSpec[] = [
  // ---------------------------------------------------------------------------
  // POST /admin/accounts/:accountId/freeze
  // ---------------------------------------------------------------------------
  // "Requires at least one open flag: a freeze without an investigation is not
  // permitted by the contract, which is how the zero-denial policy resists
  // erosion under pressure."
  //
  // THE FLAGS ARE VERIFIED AND NOT MERELY COUNTED. A body citing four uuids
  // that name nothing would satisfy a length check and satisfy nothing else, so
  // every cited flag must exist, must belong to THIS ACCOUNT'S IDENTITY, and at
  // least one must still be `open`. That last clause is the contract's word:
  // an investigation already dismissed is not an investigation.
  {
    method: 'POST',
    path: '/admin/accounts/:accountId/freeze',
    roles: ACCOUNT_ACTION_ROLES,
    handle: async (ctx) => {
      const account = await loadAccount(ctx.tx, param(ctx.request, 'accountId'));
      const errors: FieldError[] = [];
      const tosClause = textField(ctx.body, 'tos_clause', errors, true);
      const rawFlags = ctx.body['flag_ids'];
      const flagIds: string[] = [];
      if (!Array.isArray(rawFlags) || rawFlags.length === 0) {
        errors.push({
          path: 'flag_ids',
          message: 'must cite at least one open flag; a freeze without an investigation is refused',
        });
      } else {
        for (const [index, value] of rawFlags.entries()) {
          if (typeof value !== 'string' || !UUID.test(value))
            errors.push({ path: `flag_ids.${String(index)}`, message: 'must be a uuid' });
          else flagIds.push(value);
        }
      }
      if (errors.length > 0) throw invalid(errors);

      const held = (await ctx.tx.rowsWhere('riskFlags', { identityId: account.identityId })).map(
        flagRow,
      );
      const cited = flagIds.map((id) => held.find((flag) => flag.id === id));
      if (cited.some((flag) => flag === undefined))
        throw invalid([
          {
            path: 'flag_ids',
            message: "names a flag that does not belong to this account's identity",
          },
        ]);
      if (!cited.some((flag) => flag?.status === 'open'))
        throw invalid([
          {
            path: 'flag_ids',
            message:
              'cites no flag that is still open, and a freeze requires an open investigation',
          },
        ]);

      await ctx.audit({
        action: 'account.freeze',
        subjectKind: 'account',
        subjectId: account.id,
        before: { payouts_frozen: account.payoutsFrozen },
        after: { payouts_frozen: true },
        evidenceRefs: [
          { kind: 'tos_clause', ref: tosClause },
          ...flagIds.map((id) => ({ kind: 'risk_flag', ref: id })),
        ],
      });

      await ctx.tx.updateAt(
        'accounts',
        { id: account.id },
        { payoutsFrozen: true, updatedAt: ctx.backend.now() },
      );

      return { account_id: account.id, payouts_frozen: true, flag_ids: flagIds };
    },
  },

  // ---------------------------------------------------------------------------
  // POST /admin/accounts/:accountId/unfreeze
  // ---------------------------------------------------------------------------
  // `UnfreezeRequest` is `{ resolution_note: string }` and carries no `reason`.
  // **THE RESOLUTION NOTE IS NOT THE REASON AND IS NOT USED AS ONE.** Section
  // 8's preamble requires a non-empty `reason` of every mutating admin
  // endpoint, so the reason is carried in the envelope like every other row
  // here and the note is recorded as the note. Substituting one for the other
  // would be defaulting the reason with extra steps.
  {
    method: 'POST',
    path: '/admin/accounts/:accountId/unfreeze',
    roles: ACCOUNT_ACTION_ROLES,
    handle: async (ctx) => {
      const account = await loadAccount(ctx.tx, param(ctx.request, 'accountId'));
      const errors: FieldError[] = [];
      const note = textField(ctx.body, 'resolution_note', errors, true);
      if (errors.length > 0) throw invalid(errors);

      await ctx.audit({
        action: 'account.unfreeze',
        subjectKind: 'account',
        subjectId: account.id,
        before: { payouts_frozen: account.payoutsFrozen },
        after: { payouts_frozen: false, resolution_note: note },
      });

      await ctx.tx.updateAt(
        'accounts',
        { id: account.id },
        { payoutsFrozen: false, updatedAt: ctx.backend.now() },
      );

      return { account_id: account.id, payouts_frozen: false };
    },
  },

  // ---------------------------------------------------------------------------
  // POST /admin/accounts/:accountId/close
  // ---------------------------------------------------------------------------
  // `CloseRequest.kind` IS `admin_actions.initiative` AND THAT IS `0043`'s OWN
  // WORDING: "THE VOCABULARY IS NOT INVENTED HERE ... the same three values, on
  // the row every admin action already writes, so eighteen new routes inherit a
  // discriminator instead of eighteen request bodies each inventing one." So
  // this row keeps the contract's spelling, `kind`, and it lands in the audit
  // column rather than in a second field beside it.
  //
  // `kind: "enforcement"` REQUIRES `evidence_pack_id`, which is the contract's
  // clause and is checked here because the schema cannot see it: `evidence_refs`
  // is a bare jsonb array with no shape and no foreign key.
  //
  // `kind: "trader_request"` REQUIRES `on_behalf_of_identity_id` AND THAT ONE IS
  // **NOT** CHECKED HERE. `admin_actions_on_behalf_matches_initiative` is a
  // biconditional CHECK in `0043` and it is a better control than a line in this
  // file, so the request carries what it carries and the database refuses.
  {
    method: 'POST',
    path: '/admin/accounts/:accountId/close',
    roles: ACCOUNT_ACTION_ROLES,
    handle: async (ctx) => {
      const account = await loadAccount(ctx.tx, param(ctx.request, 'accountId'));
      const errors: FieldError[] = [];

      const rawKind = ctx.body['kind'];
      const kind = ADMIN_INITIATIVES.find((known) => known === rawKind);
      if (kind === undefined)
        errors.push({ path: 'kind', message: `must be one of ${ADMIN_INITIATIVES.join(', ')}` });
      const tosClause = textField(ctx.body, 'tos_clause', errors, false);
      const packId = uuidField(ctx.body, 'evidence_pack_id', errors, false);
      if (kind === 'enforcement' && packId === undefined)
        errors.push({ path: 'evidence_pack_id', message: 'is required when kind is enforcement' });
      if (errors.length > 0) throw invalid(errors);
      if (packId !== undefined) await requireEvidencePack(ctx.tx, packId, 'evidence_pack_id');

      if (account.closedOn !== null)
        throw refuse('conflict', 'Conflict', 409, 'This account is already closed.');

      const closedOn = ctx.backend.tradingDay();
      const before = { status: account.status, phase: account.phase, closed_on: account.closedOn };
      const after = { status: 'closed_admin', phase: 'closed', closed_on: closedOn };

      await ctx.audit({
        action: 'account.close',
        subjectKind: 'account',
        subjectId: account.id,
        before,
        after,
        ...(kind === undefined ? {} : { initiative: kind }),
        evidenceRefs: [
          ...(tosClause === undefined ? [] : [{ kind: 'tos_clause', ref: tosClause }]),
          ...(packId === undefined ? [] : [{ kind: 'evidence_pack', ref: packId }]),
        ],
      });

      // `close_reason` IS THE OPERATOR'S OWN REASON AND IS NOT A SECOND ONE.
      // `accounts_closed_is_explained` requires the column whenever `closed_on`
      // is set, so an account cannot be closed with the audit explained and the
      // row not. The value is `envelope.reason`, unmodified; when the envelope
      // carried none the audit insert above has already been refused by the
      // database and this statement never runs.
      await ctx.tx.updateAt(
        'accounts',
        { id: account.id },
        {
          status: 'closed_admin',
          phase: 'closed',
          closedOn,
          ...(ctx.envelope.reason === undefined ? {} : { closeReason: ctx.envelope.reason }),
          updatedAt: ctx.backend.now(),
        },
      );

      await ctx.tx.insert('accountStatusHistory', {
        accountId: account.id,
        fromStatus: account.status,
        toStatus: 'closed_admin',
        fromPhase: account.phase,
        toPhase: 'closed',
        ...(ctx.envelope.reason === undefined ? {} : { reason: ctx.envelope.reason }),
        changedAt: ctx.backend.now(),
      });

      return { account_id: account.id, status: 'closed_admin', closed_on: closedOn };
    },
  },

  // ---------------------------------------------------------------------------
  // POST /admin/accounts/:accountId/note
  // ---------------------------------------------------------------------------
  // "Free-text note attached to the timeline; audited like any other action."
  //
  // **THE ONLY ROW THIS WRITES IS THE AUDIT ROW, AND THAT IS A FINDING RATHER
  // THAN A DESIGN.** The timeline is a projection of `events`, and `events` has
  // no entry in `packages/db`'s `SCOPE_RULES`, so naming it is a compile error
  // at this call site. `0017`'s own header says every admin action also emits an
  // event and calls the duplication the point; this module can write one half of
  // it. Registering a table is a diff on `scope.ts`, which is outside this
  // session's fence, so the need is named in ADR-145 and stopped at.
  {
    method: 'POST',
    path: '/admin/accounts/:accountId/note',
    roles: ACCOUNT_ACTION_ROLES,
    handle: async (ctx) => {
      const account = await loadAccount(ctx.tx, param(ctx.request, 'accountId'));
      const errors: FieldError[] = [];
      const note = textField(ctx.body, 'note', errors, true);
      if (errors.length > 0) throw invalid(errors);

      await ctx.audit({
        action: 'account.note',
        subjectKind: 'account',
        subjectId: account.id,
        before: {},
        after: { note },
      });

      return { account_id: account.id, note };
    },
  },

  // ---------------------------------------------------------------------------
  // POST /admin/flags/:flagId/status
  // ---------------------------------------------------------------------------
  // "`enforced` requires `evidence_pack_id`. Moving to `investigating` sets
  // `payouts_frozen` on the identity as a side effect, and the response says so
  // explicitly."
  //
  // THE RESPONSE SAYING SO IS PART OF THE CONTRACT AND NOT A COURTESY. A side
  // effect an operator cannot see in the answer is a side effect they will
  // discover from a trader's support ticket.
  //
  // `dismissed` AND `enforced` CARRY THEIR OWN DDL: `risk_flags_resolution_is_
  // explained` requires `resolved_at`, `resolved_by` AND `resolution_note`
  // together, so a resolution written without one of the three is refused by the
  // database exactly as an unexplained admin action is.
  {
    method: 'POST',
    path: '/admin/flags/:flagId/status',
    roles: ACCOUNT_ACTION_ROLES,
    handle: async (ctx) => {
      const flagId = param(ctx.request, 'flagId');
      if (flagId === null) throw notFound('flag');
      const found = await ctx.tx.rowAt('riskFlags', { id: flagId });
      if (found === undefined || found === null) throw notFound('flag');
      const flag = flagRow(found);

      const errors: FieldError[] = [];
      const rawTo = ctx.body['to_status'];
      const to = (['investigating', 'dismissed', 'enforced'] as const).find(
        (known) => known === rawTo,
      );
      if (to === undefined)
        errors.push({
          path: 'to_status',
          message: 'must be one of investigating, dismissed, enforced',
        });
      const note = textField(ctx.body, 'note', errors, true);
      const packId = uuidField(ctx.body, 'evidence_pack_id', errors, false);
      if (to === 'enforced' && packId === undefined)
        errors.push({
          path: 'evidence_pack_id',
          message: 'is required when to_status is enforced',
        });
      if (errors.length > 0 || to === undefined || note === undefined) throw invalid(errors);
      if (packId !== undefined) await requireEvidencePack(ctx.tx, packId, 'evidence_pack_id');

      const freezesIdentity = to === 'investigating';
      const at = ctx.backend.now();

      await ctx.audit({
        action: `flag.${to}`,
        subjectKind: 'risk_flag',
        subjectId: flag.id,
        before: { status: flag.status },
        after: {
          status: to,
          note,
          ...(freezesIdentity ? { identity_payouts_frozen: true } : {}),
        },
        evidenceRefs: packId === undefined ? [] : [{ kind: 'evidence_pack', ref: packId }],
      });

      const resolves = to === 'dismissed' || to === 'enforced';
      await ctx.tx.updateAt(
        'riskFlags',
        { id: flag.id },
        {
          status: to,
          firstTouchedAt: at,
          updatedAt: at,
          ...(resolves
            ? { resolvedAt: at, resolvedBy: ctx.principal.actor, resolutionNote: note }
            : {}),
        },
      );

      if (freezesIdentity) {
        // `identities_freeze_is_explained` requires `frozen_reason` AND
        // `frozen_at` whenever `payouts_frozen` is true. The reason written here
        // is the envelope's, unmodified, for `close_reason`'s reason: a freeze
        // the audit explains and the row does not is a freeze nobody can answer
        // for. The audit insert above has already refused an absent one.
        await ctx.tx.updateAt(
          'identities',
          { id: flag.identityId },
          {
            payoutsFrozen: true,
            ...(ctx.envelope.reason === undefined ? {} : { frozenReason: ctx.envelope.reason }),
            frozenAt: at,
            updatedAt: at,
          },
        );
      }

      return {
        flag_id: flag.id,
        status: to,
        identity_id: flag.identityId,
        identity_payouts_frozen: freezesIdentity,
      };
    },
  },

  // ---------------------------------------------------------------------------
  // POST /admin/plans/:planId/versions
  // ---------------------------------------------------------------------------
  // `owner` ONLY, on `INV-M6-09`: "`ops` cannot change config, roles, or plan
  // versions."
  //
  // "Creates a **draft**. Publishing is a separate call."
  //
  // -----------------------------------------------------------------------------
  // WHAT THIS ROUTE DOES NOT COMPUTE, AND WHY THAT IS THE WHOLE OF ITS CAUTION
  // -----------------------------------------------------------------------------
  // `CreateVersionRequest.sizes` is `{ size_cents, price_cents,
  // reset_price_cents }`. `plan_version_sizes` declares EIGHT NOT NULL columns:
  // those three plus `drawdown_cents`, `buffer_cents`, `win_day_floor_cents`,
  // `payout_cap_schedule_cents` and `floor_lock_enabled`. **NOTHING IN THIS
  // WORKSPACE COMPUTES THE OTHER FIVE FROM `rules`**: `resolvePlan(rules, size)`
  // CONSUMES a size row and does not produce one, and `validatePlan` reads both.
  //
  // So this route writes what the request carried and nothing else. A body that
  // omits one of the five reaches a `NOT NULL` and is refused by the database,
  // in exactly the way an admin write with no reason is. **The alternative was a
  // handler inventing a drawdown**, and a drawdown is what a trader is sold and
  // what the firm owes. ADR-145 names the gap and proposes the amendment;
  // API_CONTRACT is frozen and moves by ADR rather than by a commit that needed
  // a field.
  //
  // `public_slug` is in the same position: `text NOT NULL UNIQUE`, the permanent
  // public URL under `SD-M9-01`, and absent from `CreateVersionRequest`. It is
  // carried if the body carries it and refused by the database if not. A slug
  // derived here from the plan code would be this module choosing a permanent
  // public URL, which is a product decision and not a transcription.
  //
  // THE SIZE ROWS ARE WRITTEN HERE AND NOT AT PUBLISH, and the contract settles
  // that against itself: `CreateVersionResponse` carries `computed_sizes:
  // PlanSize[]`, so the grid exists once the draft does. The publish row's
  // "Materializes `plan_version_sizes` in the same transaction" is then already
  // satisfied when publish runs. The disagreement is named in ADR-145.
  {
    method: 'POST',
    path: '/admin/plans/:planId/versions',
    roles: CONFIG_ROLES,
    handle: async (ctx) => {
      const planId = param(ctx.request, 'planId');
      if (planId === null) throw notFound('plan');
      const plan = await ctx.tx.rowAt('plans', { id: planId });
      if (plan === undefined || plan === null) throw notFound('plan');

      const errors: FieldError[] = [];
      const rules = asRecord(ctx.body['rules']);
      if (rules === null) errors.push({ path: 'rules', message: 'must be a JSON object' });
      const copyBlocks = asRecord(ctx.body['copy_blocks']);
      if (ctx.body['copy_blocks'] !== undefined && copyBlocks === null)
        errors.push({ path: 'copy_blocks', message: 'must be a JSON object' });
      const publicSlug = textField(ctx.body, 'public_slug', errors, false);

      const rawSizes = ctx.body['sizes'];
      const sizes: Record<string, unknown>[] = [];
      if (!Array.isArray(rawSizes) || rawSizes.length === 0) {
        errors.push({ path: 'sizes', message: 'must carry at least one size' });
      } else {
        for (const [index, raw] of rawSizes.entries()) {
          const row = asRecord(raw);
          if (row === null) {
            errors.push({ path: `sizes.${String(index)}`, message: 'must be a JSON object' });
            continue;
          }
          sizes.push(readSize(row, `sizes.${String(index)}`, errors));
        }
      }
      if (errors.length > 0 || rules === null) throw invalid(errors);

      const existing = (await ctx.tx.rowsWhere('planVersions', { planId })).map(planVersionRow);
      const version = existing.reduce((highest, row) => Math.max(highest, row.version), 0) + 1;
      const planVersionId = randomUUID();

      await ctx.audit({
        action: 'plan_version.create',
        subjectKind: 'plan_version',
        subjectId: planVersionId,
        before: {},
        after: { plan_id: planId, version, status: 'draft', sizes: sizes.length },
      });

      await ctx.tx.insert('planVersions', {
        id: planVersionId,
        planId,
        version,
        status: 'draft',
        rules,
        ...(copyBlocks === null ? {} : { copyBlocks }),
        ...(publicSlug === undefined ? {} : { publicSlug }),
        createdBy: ctx.principal.actor,
      });

      for (const size of sizes) await ctx.tx.insert('planVersionSizes', { planVersionId, ...size });

      return {
        plan_version_id: planVersionId,
        version,
        status: 'draft',
        computed_sizes: sizes.map(sizeToJson),
      };
    },
  },

  // ---------------------------------------------------------------------------
  // POST /admin/plans/versions/:versionId/publish
  // ---------------------------------------------------------------------------
  // **THE SHARPEST OF THE SEVEN. A PLAN VERSION DETERMINES WHAT A TRADER IS SOLD
  // AND WHAT THE FIRM OWES, SO AN OPERATOR MOVING IT MOVES MONEY.**
  //
  // Three gates, in this order, and each of them is somebody else's ruling:
  //
  //   1. ALREADY PUBLISHED, OR RETIRED -> 409. The contract's `conflict`, and
  //      `STATE_MACHINES` section 9 makes retirement terminal.
  //   2. `validatePlan(rules, sizes)` -> `CV-01` to `CV-19`. **A publish that
  //      skipped this would put a version in front of buyers that the engine
  //      refuses to resolve.** It is a port because `apps/api` declares no
  //      `@merit/rules-engine` and a manifest is not in this session's fence, so
  //      an unwired deployment answers 503 rather than publishing unvalidated.
  //   3. DUAL CONTROL, resolved server side against `dual_control_approvals` by
  //      payload hash (`SD-M6-05`, `INV-M6-08`, ADR-010, `M06` section 8).
  //
  // WHAT MAKES A CHANGE SENSITIVE IS THE CONTRACT'S OWN THREE WORDS, "cap,
  // split, or cadence gap", resolved against `PlanRulesJson`:
  //
  //   cap          `phase_funded.payout_cap_schedule`      CV-09, CV-10, CV-17
  //   split        `phase_funded.split_bp`                 CV-13
  //   cadence gap  `phase_funded.cadence_gap_trading_days`  CV-08
  //
  // **A PLAN'S FIRST PUBLISHED VERSION IS SENSITIVE.** It establishes all three
  // from nothing, and a rule that compared against a predecessor that does not
  // exist would let the very first cap and split reach production with one
  // approval. Fail closed.
  //
  // THE PUBLISH DECISION IS NOT SUPPLIED HERE EITHER.
  // `plan_versions_publish_decision_recorded` requires exactly one of
  // `decided_on_simulation_run_id` and `simulation_waiver_reason` on a published
  // row, and `PublishRequest` is `{ reason, second_approver? }`. Both are carried
  // from the body if present and refused by the database if neither is. ADR-145
  // names it with the other three.
  {
    method: 'POST',
    path: '/admin/plans/versions/:versionId/publish',
    roles: CONFIG_ROLES,
    handle: async (ctx) => {
      const versionId = param(ctx.request, 'versionId');
      if (versionId === null) throw notFound('plan version');
      const found = await ctx.tx.rowAt('planVersions', { id: versionId });
      if (found === undefined || found === null) throw notFound('plan version');
      const draft = planVersionRow(found);

      if (draft.status !== 'draft')
        throw refuse(
          'conflict',
          'Conflict',
          409,
          `This plan version is \`${draft.status}\` and only a draft can be published.`,
        );

      const errors: FieldError[] = [];
      const secondApprover = textField(ctx.body, 'second_approver', errors, false);
      const decidedOn = uuidField(ctx.body, 'decided_on_simulation_run_id', errors, false);
      const waiver = textField(ctx.body, 'simulation_waiver_reason', errors, false);
      if (errors.length > 0) throw invalid(errors);

      const sizes = await ctx.tx.rowsWhere('planVersionSizes', { planVersionId: draft.id });
      const validation = ctx.backend.validatePlan(draft.rules, sizes);
      if (!validation.ok)
        throw invalid(
          validation.errors.map((error) => ({ path: error.code, message: error.message })),
        );

      const siblings = (await ctx.tx.rowsWhere('planVersions', { planId: draft.planId })).map(
        planVersionRow,
      );
      const published = siblings.find((row) => row.status === 'published');
      const sensitive =
        published === undefined ||
        canonicalJson(sensitiveFields(published.rules)) !==
          canonicalJson(sensitiveFields(draft.rules));

      if (sensitive) {
        const payloadHash = sensitivePayloadHash(draft.id, draft.rules);
        const approvals = await ctx.tx.rowsWhere('dualControlApprovals', {
          subjectKind: 'plan_version',
          subjectId: draft.id,
        });
        const satisfied = approvals.find((row) =>
          approvalSatisfies(row, payloadHash, ctx.backend.now()),
        );
        if (satisfied === undefined)
          throw refuse(
            'precondition_failed',
            'Precondition failed',
            412,
            'This publish changes the cap, the split or the cadence gap, so ADR-010 requires a ' +
              'second owner approval, recorded against this plan version with a matching payload ' +
              'hash and still inside its 24 hour window.',
          );
        const approvedBy = stringOf(satisfied, 'approvedBy', 'dual_control_approvals');
        if (secondApprover !== undefined && secondApprover !== approvedBy)
          throw refuse(
            'precondition_failed',
            'Precondition failed',
            412,
            'The `second_approver` named in the request is not the operator who approved.',
          );
      }

      const at = ctx.backend.now();
      await ctx.audit({
        action: 'plan_version.publish',
        subjectKind: 'plan_version',
        subjectId: draft.id,
        before: { status: draft.status },
        after: {
          status: 'published',
          published_at: at.toISOString(),
          dual_control_required: sensitive,
        },
      });

      await ctx.tx.updateAt(
        'planVersions',
        { id: draft.id },
        {
          status: 'published',
          publishedAt: at,
          ...(decidedOn === undefined ? {} : { decidedOnSimulationRunId: decidedOn }),
          ...(waiver === undefined ? {} : { simulationWaiverReason: waiver }),
        },
      );

      return {
        plan_version_id: draft.id,
        version: draft.version,
        status: 'published',
        published_at: at.toISOString(),
        dual_control_required: sensitive,
      };
    },
  },
];

// -----------------------------------------------------------------------------
// The pieces the two plan rows need
// -----------------------------------------------------------------------------

/**
 * One element of `CreateVersionRequest.sizes`, read WITHOUT SUPPLYING ANYTHING.
 *
 * Every key is optional here for the reason `reason` is optional in the
 * envelope: the columns are `NOT NULL` in the schema and an absent one is the
 * database's refusal to report, not this module's to fill. **The money is
 * `bigint` from the moment it leaves the wire** and `centsField` refuses a
 * value that is not a safe integer rather than rounding it.
 */
function readSize(
  row: Record<string, unknown>,
  path: string,
  errors: FieldError[],
): Record<string, unknown> {
  const cents: readonly (readonly [string, string])[] = [
    ['size_cents', 'sizeCents'],
    ['price_cents', 'priceCents'],
    ['reset_price_cents', 'resetPriceCents'],
    ['drawdown_cents', 'drawdownCents'],
    ['profit_target_cents', 'profitTargetCents'],
    ['buffer_cents', 'bufferCents'],
    ['win_day_floor_cents', 'winDayFloorCents'],
    ['daily_loss_limit_cents', 'dailyLossLimitCents'],
    ['floor_lock_at_profit_cents', 'floorLockAtProfitCents'],
    ['floor_lock_floor_at_cents', 'floorLockFloorAtCents'],
  ];
  const values: Record<string, unknown> = {};
  for (const [wire, property] of cents) {
    const value = centsField(row, wire, `${path}.${wire}`, errors);
    if (value !== undefined) values[property] = value;
  }
  const schedule = row['payout_cap_schedule_cents'];
  if (schedule !== undefined && schedule !== null) {
    if (!Array.isArray(schedule))
      errors.push({ path: `${path}.payout_cap_schedule_cents`, message: 'must be an array' });
    else values['payoutCapScheduleCents'] = schedule;
  }
  const lock = row['floor_lock_enabled'];
  if (lock !== undefined && lock !== null) {
    if (typeof lock !== 'boolean')
      errors.push({ path: `${path}.floor_lock_enabled`, message: 'must be a boolean' });
    else values['floorLockEnabled'] = lock;
  }
  return values;
}

/** One size row back onto the wire. `bigint` out, JSON integer in, never a float. */
function sizeToJson(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [property, value] of Object.entries(values))
    out[snakeCase(property)] = typeof value === 'bigint' ? centsToJson(value) : value;
  return out;
}

function snakeCase(property: string): string {
  return property.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * The three fields ADR-010 and API_CONTRACT call sensitive, pulled out of `rules`.
 *
 * READ POSITIONALLY AND NOT TYPED, because `PlanRulesJson` lives in
 * `@merit/rules-engine` and this deployable does not declare it. The keys are
 * the document's, transcribed, and `validatePlan` is what actually reads the
 * shape; this function only has to decide whether two versions differ.
 */
export function sensitiveFields(rules: unknown): Record<string, unknown> {
  const funded = asRecord(asRecord(rules)?.['phase_funded']);
  return {
    payout_cap_schedule: funded?.['payout_cap_schedule'] ?? null,
    split_bp: funded?.['split_bp'] ?? null,
    cadence_gap_trading_days: funded?.['cadence_gap_trading_days'] ?? null,
  };
}

/**
 * JSON with every object key sorted, recursively.
 *
 * A HASH OVER `JSON.stringify` OF AN UNSORTED OBJECT IS A HASH OVER KEY ORDER,
 * so the same approved payload would fail to match itself after a round trip
 * through a client that reordered it. The approval is what stands between one
 * phished session and the cap; it may not turn on key order.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = asRecord(value);
  if (record === null) return JSON.stringify(value ?? null);
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

/**
 * What `dual_control_approvals.payload_hash` must equal for this publish.
 *
 * IT BINDS THE APPROVAL TO THE VERSION AND TO THE THREE SENSITIVE FIELDS, which
 * is `SD-M6-05`'s own sentence about the column: it "pins WHAT is being
 * approved, so an approval cannot travel". An approval of one cap does not
 * publish a different one, and an approval recorded against another version
 * does not publish this one.
 */
export function sensitivePayloadHash(planVersionId: string, rules: unknown): string {
  return createHash('sha256')
    .update(canonicalJson({ plan_version_id: planVersionId, ...sensitiveFields(rules) }), 'utf8')
    .digest('hex');
}

/** ADR-010's window: "a second `owner` approval within a 24 hour window". */
export const DUAL_CONTROL_WINDOW_MS = 24 * 60 * 60 * 1000;

function instantOf(row: unknown, property: string): Date | null {
  const value = asRecord(row)?.[property];
  return value instanceof Date ? value : null;
}

/**
 * Whether one `dual_control_approvals` row satisfies this publish.
 *
 * THE DATABASE ALREADY CARRIES THE HALF THAT IS STRUCTURAL and it is not
 * restated here: `dual_control_approvals_second_person` makes the approver
 * somebody other than the requester, `_approval_is_complete` makes an approved
 * row carry both `approved_by` and `approved_at`, and `_within_window` keeps the
 * approval at or before the expiry. What is left for this function is the part
 * no CHECK can see: that the row names THIS payload, that it is still approved
 * rather than withdrawn or expired, that the window it was opened with was no
 * longer than ADR-010's twenty-four hours, and that the window has not passed.
 */
function approvalSatisfies(row: unknown, payloadHash: string, now: Date): boolean {
  const record = asRecord(row);
  if (record === null) return false;
  if (record['status'] !== 'approved') return false;

  const hash = record['payloadHash'];
  const seen =
    hash instanceof Uint8Array
      ? Buffer.from(hash).toString('hex')
      : typeof hash === 'string'
        ? hash
        : null;
  if (seen === null || seen.toLowerCase() !== payloadHash.toLowerCase()) return false;

  const requestedAt = instantOf(record, 'requestedAt');
  const expiresAt = instantOf(record, 'expiresAt');
  const approvedAt = instantOf(record, 'approvedAt');
  if (requestedAt === null || expiresAt === null || approvedAt === null) return false;
  if (expiresAt.getTime() - requestedAt.getTime() > DUAL_CONTROL_WINDOW_MS) return false;
  return expiresAt.getTime() > now.getTime();
}

// -----------------------------------------------------------------------------
// The module
// -----------------------------------------------------------------------------

/**
 * The role declaration, as data.
 *
 * Exported so `FM-M6-09`'s negative-authz matrix reads a table rather than
 * seven handlers, and so the suite asserts the whole surface at once.
 */
export const ADMIN_WRITE_ROLES = adminRoleTable(ADMIN_WRITE_ENDPOINTS);

export default defineRoutes({
  name: 'admin-writes',
  routes: toAdminRoutes(ADMIN_WRITE_ENDPOINTS),
});
