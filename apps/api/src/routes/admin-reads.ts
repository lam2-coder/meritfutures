// =============================================================================
// apps/api/src/routes/admin-reads.ts
// =============================================================================
// THE FIRST ROUTE MODULE IN THIS TREE WRITTEN AGAINST THE ADMIN ORIGIN, and the
// ruling that goes with it is ADR-144.
//
// -----------------------------------------------------------------------------
// HOW THE SURFACE IS SELECTED, WHICH IS THE THING THIS FILE ESTABLISHES
// -----------------------------------------------------------------------------
// IT IS SELECTED BY NOTHING NEW. `surface.ts` already partitions the contract
// over PATH PREFIXES, `OPERATOR_PREFIXES` already holds `/admin`, `compose`
// already withholds a path the running surface does not serve, and
// `discoverRouteModules` already composes every `.ts` file in this directory.
// So an admin route is an ORDINARY ROUTE MODULE whose paths begin `/admin`, and
// the operator deployment registers it while the public deployment does not.
//
// There is no admin router, no second `buildServer`, no `MERIT_API_SURFACE`
// branch in a handler and NO EDIT TO `start.ts`. Every one of those would be a
// second answer to a question ADR-083 answered, and the second answer is the
// one that gets it wrong later: the public deployment's 404 for `/admin/*` is
// the router having nothing there, and a check that produces the same status
// from inside a registered handler is a control that can be reordered away.
//
// THE ONE THING A LATER ADMIN MODULE MUST NOT DO is prefix its own paths with
// `BASE_PATH`. `assertContractPath` refuses that at startup, because
// `/api/v1/admin/x` matches neither operator prefix and would classify an
// operator route as public with nothing reporting it.
//
// -----------------------------------------------------------------------------
// `ADMIN_ORIGIN` IS A PLACEHOLDER AND THIS FILE NAMES NO HOST
// -----------------------------------------------------------------------------
// ADR-012: the admin console is served from a separate apex domain unrelated to
// the Merit brand in name, and that domain "is never written into the corpus,
// the repository, or any public artifact". `ADMIN_ORIGIN` is the token, it is
// resolved from the platform vault at deploy time, and nothing here reads it:
// this module is selected by path prefix and deployed by `MERIT_API_SURFACE`,
// so it never needs to know where it is running.
//
// -----------------------------------------------------------------------------
// THIS MODULE OWNS THE SHARED ADMIN HELPERS AND SAYS SO
// -----------------------------------------------------------------------------
// The admin WRITES are a concurrent slice in `admin-writes.ts` and they need the
// same role vocabulary, the same principal, the same cookie and the same problem
// documents. Those live HERE and are exported, rather than being written twice.
// They cannot live in a third file in this directory, because every `.ts` file
// under `routes/` is a route module and the registry refuses one that
// default-exports anything else.
//
// WHEN A THIRD ADMIN MODULE ARRIVES, LIFT THEM TO `src/admin-auth.ts`. Two
// modules sharing a helper through one of them is a seam; three is a layering
// mistake, and the move is a rename rather than a redesign. That sentence is the
// deliverable for whoever holds that slice, and it belongs where they will read
// it.
//
// -----------------------------------------------------------------------------
// A READ ROUTE STILL CHECKS A ROLE
// -----------------------------------------------------------------------------
// API_CONTRACT section 8 closes the set at `owner`, `ops` and `readonly`, and
// `readonly` exists PRECISELY so that a role can read and not write. A read
// surface that checked nothing would make that vocabulary decorative: the whole
// content of "readonly" is that some other role is not it, and a guard that
// admits everything passes every admission test ever written against it.
//
// So every endpoint below DECLARES the roles it admits, as data, and the guard
// is a membership test over a CLOSED set. All seven declare all three, because
// the contract gives all three roles the read surface, and the check is not
// vacuous for two reasons that are both exercised by the suite: a caller with no
// operator session is refused 401, and a principal carrying a role string that
// is not one of the three is refused 403 rather than defaulted to `readonly`.
// `apps/admin/src/roles.ts` states that refusal in the same words for the same
// reason, and it is stated again here rather than imported because `RI-04`
// refuses a deployable that imports a deployable. The suite binds the two sets
// by reading API_CONTRACT itself, which is the primary source both transcribe.
//
// -----------------------------------------------------------------------------
// MONEY IS INTEGER CENTS, AND THAT IS SWEPT RATHER THAN REMEMBERED
// -----------------------------------------------------------------------------
// `GET /admin/liability` reports the firm's own books. API_CONTRACT section 1:
// "`*_cents` are JSON integers. `*_bp` are JSON integers. No floats, no
// formatted strings". `assertContractScalars` walks every response this module
// returns and refuses any member whose NAME ends `_cents` or `_bp` and whose
// value is not a safe integer, and any member whose name ends `_day` or `_on`
// that is not a `YYYY-MM-DD` exchange trading day.
//
// IT READS THE NAME RATHER THAN A LIST OF FIELDS, which is what makes it hold
// for a field nobody has added yet. `cusum.statistic` and `cusum.threshold` are
// the two numbers in section 8 that are legitimately NOT integers, and they need
// no exemption because they carry neither suffix: a CUSUM statistic is a
// standardised deviation and not an amount of money, and rounding it would be
// the calibration defect `FM-M6-07` names rather than a fix.
// =============================================================================

import type { FastifyReply, FastifyRequest } from 'fastify';

import { defineRoutes } from '../registry.ts';
import { PROBLEM_MEDIA_TYPE, problem } from '../server.ts';
import type { HttpMethod, RouteDefinition, RouteHandler } from '../registry.ts';
import type { Problem } from '../server.ts';

// -----------------------------------------------------------------------------
// Refusals this module makes about itself
// -----------------------------------------------------------------------------

/**
 * Thrown when the deployment, or the data it was handed, is not something an
 * operator may be shown.
 *
 * IT IS A 500 AND NEVER A 404 OR A 503, on ADR-110's precedent for the same
 * shape one route over: an unwired port is a deployment that has not been
 * finished, and answering "no such account" or "try again shortly" would be this
 * file describing an operational gap as a fact about the estate. The default
 * error handler in `server.ts` maps an unmapped throw to `internal_error`.
 */
export class AdminReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminReadError';
  }
}

// -----------------------------------------------------------------------------
// The roles, closed
// -----------------------------------------------------------------------------

/**
 * API_CONTRACT section 8's set: "`owner` (all), `ops` (read plus account
 * actions, no config or role changes), `readonly`".
 *
 * CLOSED, and closed is the point: a fourth role is a change to the contract and
 * not a value a request may carry.
 */
export const ADMIN_ROLES = ['owner', 'ops', 'readonly'] as const;

/** One member of {@link ADMIN_ROLES}. */
export type AdminRole = (typeof ADMIN_ROLES)[number];

/**
 * Resolve a role string, or `null`.
 *
 * NULL RATHER THAN A THROW, because an unrecognised role arrives on a REQUEST
 * and a request is refused rather than crashed. NEVER DEFAULTED: a string that
 * quietly becomes `readonly` is a typo that granted a session it should have
 * refused, and the refusal is the whole value of a closed set.
 */
export function resolveAdminRole(value: string): AdminRole | null {
  const index = (ADMIN_ROLES as readonly string[]).indexOf(value);
  if (index < 0) return null;
  return ADMIN_ROLES[index] ?? null;
}

/**
 * Who is acting, as this surface reads it.
 *
 * `role` IS A STRING AND NOT AN `AdminRole`, deliberately. The value crosses a
 * boundary with an identity provider, which hands over text; typing it as the
 * closed union here would move the refusal to a cast somebody writes once and
 * nobody watches. It is resolved by {@link resolveAdminRole} at the one place a
 * request is authorized.
 */
export interface AdminPrincipal {
  /** `admin_actions.actor`. Never a trader identity: see `M06` section 11.1. */
  readonly actorId: string;
  readonly role: string;
}

/**
 * What an admin session token resolves to.
 *
 * THREE ARMS AND NOT TWO, and the third is what makes API_CONTRACT section 12's
 * `/admin/*` row implementable. That row reads "Trader session calls any
 * `/admin/*` | `admin_sso` | 403", and the row BELOW it says "Trader session
 * calls `/internal/*` FROM THE PUBLIC ORIGIN | 404". The second row names an
 * origin and the first does not, which is the discriminator: on the public
 * deployment `/admin/*` is withheld and the answer is the router's 404, and on
 * the operator deployment a token belonging to a real session that is not an
 * operator's is authenticated-but-not-permitted, which is 403.
 *
 * A token nobody recognises is `unknown` and is 401, on `auth.ts`'s stated
 * order: 403 to an anonymous caller would tell them the endpoint exists and that
 * the only thing missing is a factor.
 */
export type AdminSessionLookup =
  | { readonly kind: 'operator'; readonly principal: AdminPrincipal }
  | { readonly kind: 'not-an-operator' }
  | { readonly kind: 'unknown' };

/**
 * Where an operator session comes from.
 *
 * A PORT, AND NOTHING IN THIS TREE WIRES IT. C-08's hardware-key SSO and D3's IP
 * allowlist are edge controls on `ADMIN_ORIGIN` rather than code in this
 * process, and the mapping from a session to an actor and a role is the admin
 * identity provider's. This module states the shape it needs and refuses to
 * invent the rest.
 */
export interface AdminSessionSource {
  lookup(token: string): Promise<AdminSessionLookup>;
}

let sessionSource: AdminSessionSource | null = null;

/** Wire the operator-session source, or clear it with `null`. */
export function setAdminSessionSource(next: AdminSessionSource | null): void {
  sessionSource = next;
}

/** The wired source, or the refusal that says the deployment is unfinished. */
function currentSessionSource(): AdminSessionSource {
  if (sessionSource === null)
    throw new AdminReadError(
      'no admin session source is wired, so this deployment cannot tell an operator from ' +
        'anybody else. That is a deployment which has not been finished rather than a request ' +
        'that failed, and answering 401 would report it as the caller being logged out',
    );
  return sessionSource;
}

// -----------------------------------------------------------------------------
// The cookie
// -----------------------------------------------------------------------------

/**
 * The operator session cookie's name.
 *
 * ITS OWN NAME AND NOT `auth.ts`'s. `INV-M6-02`: "The admin origin shares no
 * cookie, no CORS policy, and no CSP with any public surface". Cookies are
 * scoped by origin, so a shared NAME would already share nothing; a shared
 * CONSTANT is what would tie the two surfaces together in the source, and the
 * next person to widen the trader cookie's attributes would widen this one.
 */
export const ADMIN_SESSION_COOKIE = 'merit_admin_session';

/**
 * The operator cookie's value, or null.
 *
 * Parsed here for `auth.ts`'s reason for parsing its own: the header is a
 * `;`-separated list of `name=value`, this module wants one name out of it, and
 * a dependency admitted for that would be a dependency admitted before a caller
 * exists. The duplication is eight lines and the coupling it avoids is the one
 * `INV-M6-02` is about.
 */
export function adminTokenFromCookie(header: string | undefined): string | null {
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== ADMIN_SESSION_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return value === '' ? null : value;
  }
  return null;
}

// -----------------------------------------------------------------------------
// Problem documents
// -----------------------------------------------------------------------------

/** One entry of section 2's `errors[]`, which is validation failures only. */
export interface AdminFieldError {
  readonly path: string;
  readonly message: string;
}

/**
 * Section 2's document, plus the two extension members section 2 itself
 * declares. `required_factor` appears on a 403 and on no other status.
 */
interface AdminProblemDocument extends Problem {
  readonly detail?: string;
  readonly errors?: readonly AdminFieldError[];
  readonly required_factor?: 'admin_sso';
}

function sendProblem(reply: FastifyReply, body: AdminProblemDocument): FastifyReply {
  return reply.code(body.status).type(PROBLEM_MEDIA_TYPE).send(body);
}

/** Section 12: any unauthenticated request to `/admin/*` is 401. */
export function adminUnauthenticated(reply: FastifyReply, requestId: string): FastifyReply {
  return sendProblem(reply, problem('unauthenticated', 401, requestId));
}

/**
 * Section 12: an authenticated caller who is not permitted here is 403, and the
 * factor rides beside the code as an RFC 9457 extension member rather than
 * becoming one, because section 2's code table is closed and the code IS
 * `forbidden` (ADR-111 clause 4).
 */
export function adminForbidden(
  reply: FastifyReply,
  requestId: string,
  detail: string,
): FastifyReply {
  return sendProblem(reply, {
    ...problem('forbidden', 403, requestId),
    detail,
    required_factor: 'admin_sso',
  });
}

/**
 * Section 1: "Admin surfaces return `403` because existence is not a secret from
 * an authorized operator", so a 404 HERE means one thing only, which is that the
 * row does not exist. It never means "not yours": an operator owns nothing and
 * an admin read reaches every identity by construction.
 */
export function adminNotFound(reply: FastifyReply, requestId: string): FastifyReply {
  return sendProblem(reply, problem('not_found', 404, requestId));
}

/** Section 2's `errors[]`, which is validation failures and nothing else. */
export function adminValidationFailed(
  reply: FastifyReply,
  requestId: string,
  errors: readonly AdminFieldError[],
): FastifyReply {
  return sendProblem(reply, { ...problem('validation_failed', 400, requestId), errors });
}

// -----------------------------------------------------------------------------
// The scalar sweep. Section 1's money rule, enforced by name
// -----------------------------------------------------------------------------

const CENTS_OR_BP = /_(?:cents|bp)$/;
const TRADING_DAY_KEY = /_(?:day|on)$/;
const TRADING_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Refuse a response body that breaks section 1's scalar rules.
 *
 * WALKED RATHER THAN CHECKED FIELD BY FIELD. A per-field check is a list that
 * goes stale the first time a field is added; a walk over the NAME holds for
 * every field this contract will ever declare, including the ones inside the
 * drill-down's untyped sections and inside an identity edge's `evidence` bag.
 *
 * WHAT IT DELIBERATELY DOES NOT CHECK. `*_at` is an RFC 3339 UTC string by
 * section 1, and a hand-written RFC 3339 regex either under-checks or refuses
 * legal values (leap seconds, offsets, fractional digits). Nothing in this
 * module's fence is load-bearing on that shape, so it is left unasserted and
 * said so rather than half-checked.
 */
export function assertContractScalars(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item: unknown, index: number) => {
      assertContractScalars(item, `${path}[${String(index)}]`);
    });
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, member] of Object.entries(value)) {
    const at = path === '' ? key : `${path}.${key}`;
    if (CENTS_OR_BP.test(key)) {
      if (typeof member !== 'number' || !Number.isSafeInteger(member))
        throw new AdminReadError(
          `\`${at}\` is ${JSON.stringify(member)}, and API_CONTRACT section 1 makes every ` +
            '`*_cents` and `*_bp` a JSON integer. This response reports the books of the firm ' +
            'books, so a float here is a float on the books rather than a rounding in a client',
        );
      continue;
    }
    if (TRADING_DAY_KEY.test(key)) {
      if (typeof member !== 'string' || !TRADING_DAY.test(member))
        throw new AdminReadError(
          `\`${at}\` is ${JSON.stringify(member)}, and API_CONTRACT section 1 makes every ` +
            '`*_day` and `*_on` a `YYYY-MM-DD` exchange trading day, never a UTC date and ' +
            'never a timestamp',
        );
      continue;
    }
    assertContractScalars(member, at);
  }
}

// -----------------------------------------------------------------------------
// The wire types, transcribed from API_CONTRACT section 8
// -----------------------------------------------------------------------------

/** Section 1: "Responses carry `{ data, next_cursor }`". */
export interface AdminPage<T> {
  readonly data: readonly T[];
  readonly next_cursor: string | null;
}

/** Section 8, `AdminAccountSearchItem`. */
export interface AdminAccountSearchItem {
  readonly account_id: string;
  readonly identity_id: string;
  readonly email: string;
  readonly plan_code: string;
  readonly size_cents: number;
  readonly phase: string;
  readonly status: string;
  readonly balance_cents: number;
  readonly withdrawable_cents: number;
  readonly open_flags: number;
  readonly payouts_frozen: boolean;
  readonly recon_blocked: boolean;
}

/** Section 8, `FlagListItem`. */
export interface FlagListItem {
  readonly flag_id: string;
  readonly identity_id: string;
  readonly account_id: string | null;
  readonly flag_type: string;
  readonly severity: 1 | 2 | 3 | 4 | 5;
  readonly status: FlagStatus;
  readonly first_detected_on: string;
  readonly detector: string;
  readonly evidence_summary: string;
}

/** Section 8's `FlagListItem.status` union, closed. */
export type FlagStatus = 'open' | 'investigating' | 'dismissed' | 'enforced';

/** {@link FlagStatus} as data, for the validator and for the suite. */
export const FLAG_STATUSES = [
  'open',
  'investigating',
  'dismissed',
  'enforced',
] as const satisfies readonly FlagStatus[];

/** Section 8's `severity: 1|2|3|4|5`, as data. */
export const FLAG_SEVERITIES = [1, 2, 3, 4, 5] as const;

/** Section 8, `LiabilityResponse.eligible_next_7d`. */
export interface EligibleNext7d {
  readonly total_cents: number;
  readonly account_count: number;
  readonly by_day: readonly {
    readonly trading_day: string;
    readonly cents: number;
    readonly accounts: number;
  }[];
}

/** Section 8, `LiabilityResponse`. */
export interface LiabilityResponse {
  readonly as_of: string;
  readonly open_liability_cents: number;
  readonly funded_accounts: number;
  readonly eligible_next_7d: EligibleNext7d;
  readonly payout_velocity: {
    readonly last_7d_cents: number;
    readonly avg_30d_cents: number;
    readonly ratio_bp: number;
    readonly alarm: boolean;
  };
  readonly reserve: {
    readonly reserve_cents: number;
    readonly cvar99_cents: number;
    readonly rcr_bp: number;
    readonly breaker_armed: boolean;
  };
  readonly per_plan: readonly {
    readonly plan_id: string;
    readonly code: string;
    readonly loss_ratio_bp: number;
    readonly threshold_bp: number;
    readonly sales_paused: boolean;
    /** NOT money and NOT basis points. See this file's header. */
    readonly cusum: {
      readonly statistic: number;
      readonly threshold: number;
      readonly alarm: boolean;
    };
  }[];
  readonly integrations: {
    readonly mid_health: readonly {
      readonly psp: string;
      readonly decline_rate_bp: number;
      readonly chargeback_rate_bp: number;
      readonly healthy: boolean;
    }[];
    readonly recon: { readonly last_run_at: string; readonly mismatches_open: number };
    readonly batch: { readonly last_success_at: string; readonly last_duration_ms: number };
  };
}

/**
 * `GET /admin/eligible-forecast`'s body.
 *
 * `as_of` IS CARRIED AND IS NOT DECORATION. `INV-M6-04`: "Every number on the
 * liability page names its as-of moment and its source", because "a figure whose
 * freshness is unstated is a figure that will eventually be quoted stale in a
 * decision that mattered". A focused projection that dropped it would be exactly
 * that figure, on a chart, where it is hardest to notice.
 */
export interface EligibleForecastResponse {
  readonly as_of: string;
  readonly eligible_next_7d: EligibleNext7d;
}

/** Section 8, `IdentityGraph`. */
export interface IdentityGraph {
  readonly root: {
    readonly identity_id: string;
    readonly status: string;
    readonly accounts: number;
  };
  readonly nodes: readonly {
    readonly identity_id: string;
    readonly status: string;
    readonly accounts: number;
    readonly total_withdrawable_cents: number;
  }[];
  readonly edges: readonly {
    readonly a: string;
    readonly b: string;
    readonly link_kind: string;
    readonly confidence_bp: number;
    readonly evidence: Readonly<Record<string, unknown>>;
  }[];
  readonly aggregate: {
    readonly identities: number;
    readonly accounts: number;
    readonly open_liability_cents: number;
    readonly payouts_lifetime_cents: number;
  };
}

/** Section 8, `EvidencePackResponse`. */
export interface EvidencePackResponse {
  readonly evidence_pack_id: string;
  readonly download_url: string;
  readonly content_sha256: string;
  readonly expires_at: string;
  readonly generated_at: string;
}

/**
 * The eight sections `GET /admin/accounts/:accountId` returns, in the contract's
 * own order and its own words.
 *
 * THIS IS THE ONE ROUTE OF THE SEVEN THE CORPUS DOES NOT TYPE, and that is
 * reported rather than papered over. Section 8 describes it in prose: "Full
 * drill-down: account, identity, every mark, every rule state per day with
 * `gate_results`, every event, flags with evidence, payouts with snapshots,
 * admin actions." There is no field list, so section 1's allowlist policy ("a
 * field that is not in the schema below is not in the response") has no schema
 * to apply.
 *
 * WHAT IS ENFORCED IS THE ALLOWLIST AT THE GRANULARITY THE CONTRACT WRITES: the
 * response carries exactly these eight members, a section the contract does not
 * name is refused, and a section it names and the port omits is refused. The
 * field-level schema is a DEBT owed by whoever types the drill-down, and until
 * then `assertContractScalars` is what keeps a float out of the money inside it.
 */
export const ACCOUNT_DETAIL_SECTIONS = [
  'account',
  'identity',
  'marks',
  'rule_states',
  'events',
  'flags',
  'payouts',
  'admin_actions',
] as const;

/** One member of {@link ACCOUNT_DETAIL_SECTIONS}. */
export type AccountDetailSection = (typeof ACCOUNT_DETAIL_SECTIONS)[number];

/** The drill-down, section by section. */
export type AdminAccountDetail = Readonly<Record<AccountDetailSection, unknown>>;

// -----------------------------------------------------------------------------
// The data port
// -----------------------------------------------------------------------------

/** What `GET /admin/accounts` was asked for, after validation. */
export interface AccountSearchQuery {
  /** The subject term. Never empty: `INV-M6-10` is what makes it required. */
  readonly query: string;
  readonly limit: number;
  readonly cursor: string | null;
}

/** What `GET /admin/flags` was asked for, after validation. */
export interface FlagListQuery {
  readonly flagType: string | null;
  readonly status: FlagStatus | null;
  readonly severity: number | null;
  readonly limit: number;
  readonly cursor: string | null;
}

/** What `GET /admin/evidence/:accountId` was asked for, after validation. */
export interface EvidenceExportRequest {
  readonly accountId: string;
  /** Section 8: "Query `?reason=` is required". Never empty. */
  readonly reason: string;
  /** Who asked. `admin_actions.actor`, which the generator records. */
  readonly actor: AdminPrincipal;
}

/**
 * Where the seven reads get their rows.
 *
 * A PORT, AND NOTHING IN THIS TREE WIRES IT, on ADR-110's precedent. What
 * follows is the reason it is a port rather than a `systemDb` call site, and it
 * is a finding rather than a preference.
 *
 * THE DOOR IS `systemDb('operator-console')` AND THE REASON NEEDS NO WIDENING.
 * An admin read reaches rows across identities, so `scopedDb(identity)` is the
 * wrong authority and `firmDb()` reads only rows that belong to nobody.
 * `SystemReason` is closed at two members and ADR-102 already accepted
 * `'operator-console'` for exactly this: "The admin liability dashboard".
 * `SqlExecutorReason` has one member, `'job-enqueue'`, and it is not this.
 *
 * WHAT IS MISSING IS NOT AN AUTHORITY, IT IS A SHAPE. The accessor's whole read
 * vocabulary is `rows(key)`, `rowsWhere(key, filter)` and `rowAt(key, address)`,
 * where a filter is a TYPED EQUALITY over declared columns (ADR-112). None of
 * the seven bodies above is a projection of one table: `LiabilityResponse` is
 * six aggregates over the whole book, `AdminAccountSearchItem` joins accounts to
 * identities to flags to reconciliation state, and `IdentityGraph` is a walk.
 * There is no join and no aggregate to reach for, so a live adapter written
 * today would have to go through `sqlExecutor`, which would mean widening a
 * one-member vocabulary to smuggle in the SQL the accessor deliberately does not
 * offer. THAT IS THE FINDING AND THIS FILE STOPS AT IT rather than widening
 * anything: the routes, the guard, the validation and the projections are real
 * now, and the adapter is owed to a slice that holds `packages/db`.
 */
export interface AdminReadSource {
  searchAccounts(query: AccountSearchQuery): Promise<AdminPage<AdminAccountSearchItem>>;
  readAccount(accountId: string): Promise<AdminAccountDetail | null>;
  readIdentityGraph(identityId: string): Promise<IdentityGraph | null>;
  listFlags(query: FlagListQuery): Promise<AdminPage<FlagListItem>>;
  readLiability(): Promise<LiabilityResponse | null>;
  exportEvidence(request: EvidenceExportRequest): Promise<EvidencePackResponse | null>;
}

let readSource: AdminReadSource | null = null;

/** Wire the read source, or clear it with `null`. */
export function setAdminReadSource(next: AdminReadSource | null): void {
  readSource = next;
}

function currentReadSource(): AdminReadSource {
  if (readSource === null)
    throw new AdminReadError(
      'no admin read source is wired, so the operator console has nothing to read. This is a ' +
        'deployment which has not been finished rather than a request that failed: the door the ' +
        "wiring slice must take is `systemDb('operator-console')`, and what it must build first " +
        'is the join and aggregate shapes the keyed accessor does not offer',
    );
  return readSource;
}

// -----------------------------------------------------------------------------
// The endpoint declaration, and the guard that makes it load bearing
// -----------------------------------------------------------------------------

/** What a handler is handed once the role check has passed. */
export interface AdminContext {
  readonly request: FastifyRequest;
  readonly reply: FastifyReply;
  readonly source: AdminReadSource;
  readonly principal: AdminPrincipal;
  readonly role: AdminRole;
}

/** One endpoint: its contract path, the roles it ADMITS, and its handler. */
export interface AdminEndpointSpec {
  readonly method: HttpMethod;
  readonly path: string;
  /** Never empty. An endpoint admitting no role is unreachable by construction. */
  readonly roles: readonly AdminRole[];
  readonly handle: (ctx: AdminContext) => Promise<unknown>;
}

/**
 * The roles every read in this module admits.
 *
 * ALL THREE, AND THAT IS THE CONTRACT RATHER THAN AN OVERSIGHT. Section 8 gives
 * `owner` all of it, `ops` "read plus account actions" and `readonly` the read.
 * `INV-M6-09` is the other side of the same sentence and is about MUTATION:
 * "`readonly` cannot mutate anything, and `ops` cannot change config, roles, or
 * plan versions". No route in this module mutates, so no role is narrowed here,
 * and narrowing one would be this file inventing a control the contract does not
 * carry.
 *
 * `M06` section 11.1's `owner`-only rule is NOT this set and is not weakened by
 * it: that rule governs the admin-attributed TRADER ACTIONS of section 11, every
 * one of which is a mutation.
 */
export const ADMIN_READ_ROLES: readonly AdminRole[] = ADMIN_ROLES;

/**
 * Apply one endpoint's declared roles to one lookup.
 *
 * THE ORDER OF THE TWO REFUSALS IS THE CONTRACT'S. Unknown session is 401 and
 * never 403, because 403 is "authenticated but not permitted" and answering it
 * to an anonymous caller confirms the endpoint exists.
 */
export type AdminAuthzDecision =
  | { readonly outcome: 'allowed'; readonly principal: AdminPrincipal; readonly role: AdminRole }
  | { readonly outcome: 'unauthenticated' }
  | { readonly outcome: 'forbidden'; readonly detail: string };

export function authorizeAdmin(
  lookup: AdminSessionLookup,
  roles: readonly AdminRole[],
): AdminAuthzDecision {
  if (roles.length === 0)
    throw new AdminReadError(
      'an admin endpoint declared no role. An endpoint admitting nothing is unreachable, and a ' +
        'guard over an empty set reads as a guard rather than being one',
    );
  if (lookup.kind === 'unknown') return { outcome: 'unauthenticated' };
  if (lookup.kind === 'not-an-operator')
    return {
      outcome: 'forbidden',
      detail: 'This session is not an operator session.',
    };
  const role = resolveAdminRole(lookup.principal.role);
  if (role === null)
    return {
      outcome: 'forbidden',
      detail: `This session carries no admin role. The set is ${ADMIN_ROLES.join(', ')}.`,
    };
  if (!roles.includes(role))
    return {
      outcome: 'forbidden',
      detail: `This endpoint admits ${roles.join(', ')}.`,
    };
  return { outcome: 'allowed', principal: lookup.principal, role };
}

/**
 * Build the framework handler for one declared endpoint.
 *
 * EVERY ROUTE IN THIS MODULE GOES THROUGH HERE, so the role check runs before
 * any handler body does and no handler can forget it. The cookie is read before
 * the session source is consulted, which is what lets a deployment with nothing
 * wired still answer 401 to an anonymous caller rather than 500: there is no
 * token, so there is no lookup to make.
 */
export function adminHandler(spec: AdminEndpointSpec): RouteHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const token = adminTokenFromCookie(request.headers.cookie);
    const lookup: AdminSessionLookup =
      token === null ? { kind: 'unknown' } : await currentSessionSource().lookup(token);

    const decision = authorizeAdmin(lookup, spec.roles);
    if (decision.outcome === 'unauthenticated') return adminUnauthenticated(reply, request.id);
    if (decision.outcome === 'forbidden') return adminForbidden(reply, request.id, decision.detail);

    const body = await spec.handle({
      request,
      reply,
      source: currentReadSource(),
      principal: decision.principal,
      role: decision.role,
    });
    // A REFUSAL IS THE REPLY OBJECT ITSELF, because every problem helper above
    // returns what `reply.send()` returned. Comparing identity is exact where
    // `reply.sent` is a deprecated getter whose meaning has moved between
    // Fastify majors, and a sweep run over a problem document would assert
    // section 1's money rule against an error body it was never written for.
    if (body === reply) return body;
    assertContractScalars(body, '');
    return body;
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
 * The declaration, as data, keyed `METHOD /path`.
 *
 * Derived from the same array the routes are derived from, so the table and the
 * registration cannot disagree. This is what a reviewer reads, and it is the
 * shape the `M6-N-nn` router enumeration will read when the mutating routes
 * arrive: `M06` section 8.1 says that suite is "one per mutating route per
 * role, ENUMERATED FROM THE ROUTER", and a router that does not publish its
 * roles cannot be enumerated.
 */
export function adminRoleTable(
  specs: readonly AdminEndpointSpec[],
): Readonly<Record<string, readonly AdminRole[]>> {
  const table: Record<string, readonly AdminRole[]> = {};
  for (const spec of specs) table[`${spec.method} ${spec.path}`] = spec.roles;
  return table;
}

// -----------------------------------------------------------------------------
// Query parsing. Section 1's pagination rule, and INV-M6-10
// -----------------------------------------------------------------------------

/** Section 1: "`limit` maximum 100, default 25". */
export const LIMIT_DEFAULT = 25;
export const LIMIT_MAX = 100;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** One query parameter as a string, or null when absent or repeated. */
function queryParam(request: FastifyRequest, name: string): string | null {
  const query = asRecord(request.query);
  if (query === null) return null;
  const value = query[name];
  return typeof value === 'string' ? value : null;
}

function pathParam(request: FastifyRequest, name: string): string | null {
  const params = asRecord(request.params);
  if (params === null) return null;
  const value = params[name];
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * `?limit=` and `?cursor=`, section 1's rule.
 *
 * CURSOR ONLY, NEVER OFFSET, so there is no `?page=` and no `?offset=` to parse
 * and a caller sending one is not quietly served page one.
 */
function readPaging(
  request: FastifyRequest,
  errors: AdminFieldError[],
): { limit: number; cursor: string | null } {
  const rawLimit = queryParam(request, 'limit');
  let limit = LIMIT_DEFAULT;
  if (rawLimit !== null) {
    const parsed = Number(rawLimit);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > LIMIT_MAX)
      errors.push({
        path: 'limit',
        message: `must be an integer from 1 to ${String(LIMIT_MAX)}`,
      });
    else limit = parsed;
  }
  const rawCursor = queryParam(request, 'cursor');
  const cursor = rawCursor === null || rawCursor.trim() === '' ? null : rawCursor;
  return { limit, cursor };
}

// -----------------------------------------------------------------------------
// The seven endpoints, in API_CONTRACT section 8's order
// -----------------------------------------------------------------------------

/**
 * The order a triage queue is read in, asserted rather than trusted.
 *
 * Section 8 says "Sorted by severity then age" and does not state a direction,
 * so the direction is ruled here and said out loud: MOST SEVERE FIRST, then
 * OLDEST FIRST. A queue that put a severity 1 above a severity 5, or the newest
 * flag above a three-week-old one, is a triage list that inverts triage, and the
 * operator has no way to see that from the rendered page.
 *
 * ASSERTED WITHIN A PAGE AND NOT ACROSS PAGES, which is the honest limit: the
 * order is the port's, because a cursor page cannot be re-sorted here without
 * breaking the cursor, and this catches a port that ignored the rule at the one
 * place the rule is visible.
 */
function assertFlagOrder(items: readonly FlagListItem[]): void {
  for (let i = 1; i < items.length; i += 1) {
    const previous = items[i - 1];
    const current = items[i];
    if (previous === undefined || current === undefined) continue;
    if (previous.severity < current.severity)
      throw new AdminReadError(
        `flag \`${current.flag_id}\` at severity ${String(current.severity)} follows ` +
          `\`${previous.flag_id}\` at severity ${String(previous.severity)}. API_CONTRACT ` +
          'section 8 sorts this queue by severity then age, and a queue that inverts triage ' +
          'is unreadable as triage',
      );
    if (
      previous.severity === current.severity &&
      previous.first_detected_on > current.first_detected_on
    )
      throw new AdminReadError(
        `flag \`${current.flag_id}\` first detected on ${current.first_detected_on} follows ` +
          `\`${previous.flag_id}\` first detected on ${previous.first_detected_on} at the same ` +
          'severity. Section 8 sorts by severity then AGE, and the older flag is the one that ' +
          'has been waiting',
      );
  }
}

/** Section 8's `AdminAccountSearchItem`, field by field. A spread would be `SELECT *`. */
function projectAccountSearchItem(item: AdminAccountSearchItem): AdminAccountSearchItem {
  return {
    account_id: item.account_id,
    identity_id: item.identity_id,
    email: item.email,
    plan_code: item.plan_code,
    size_cents: item.size_cents,
    phase: item.phase,
    status: item.status,
    balance_cents: item.balance_cents,
    withdrawable_cents: item.withdrawable_cents,
    open_flags: item.open_flags,
    payouts_frozen: item.payouts_frozen,
    recon_blocked: item.recon_blocked,
  };
}

/** Section 8's `FlagListItem`, field by field. */
function projectFlag(item: FlagListItem): FlagListItem {
  return {
    flag_id: item.flag_id,
    identity_id: item.identity_id,
    account_id: item.account_id,
    flag_type: item.flag_type,
    severity: item.severity,
    status: item.status,
    first_detected_on: item.first_detected_on,
    detector: item.detector,
    evidence_summary: item.evidence_summary,
  };
}

function projectEligibleNext7d(value: EligibleNext7d): EligibleNext7d {
  return {
    total_cents: value.total_cents,
    account_count: value.account_count,
    by_day: value.by_day.map((day) => ({
      trading_day: day.trading_day,
      cents: day.cents,
      accounts: day.accounts,
    })),
  };
}

/** Section 8's `LiabilityResponse`, field by field. */
function projectLiability(value: LiabilityResponse): LiabilityResponse {
  return {
    as_of: value.as_of,
    open_liability_cents: value.open_liability_cents,
    funded_accounts: value.funded_accounts,
    eligible_next_7d: projectEligibleNext7d(value.eligible_next_7d),
    payout_velocity: {
      last_7d_cents: value.payout_velocity.last_7d_cents,
      avg_30d_cents: value.payout_velocity.avg_30d_cents,
      ratio_bp: value.payout_velocity.ratio_bp,
      alarm: value.payout_velocity.alarm,
    },
    reserve: {
      reserve_cents: value.reserve.reserve_cents,
      cvar99_cents: value.reserve.cvar99_cents,
      rcr_bp: value.reserve.rcr_bp,
      breaker_armed: value.reserve.breaker_armed,
    },
    per_plan: value.per_plan.map((plan) => ({
      plan_id: plan.plan_id,
      code: plan.code,
      loss_ratio_bp: plan.loss_ratio_bp,
      threshold_bp: plan.threshold_bp,
      sales_paused: plan.sales_paused,
      cusum: {
        statistic: plan.cusum.statistic,
        threshold: plan.cusum.threshold,
        alarm: plan.cusum.alarm,
      },
    })),
    integrations: {
      mid_health: value.integrations.mid_health.map((mid) => ({
        psp: mid.psp,
        decline_rate_bp: mid.decline_rate_bp,
        chargeback_rate_bp: mid.chargeback_rate_bp,
        healthy: mid.healthy,
      })),
      recon: {
        last_run_at: value.integrations.recon.last_run_at,
        mismatches_open: value.integrations.recon.mismatches_open,
      },
      batch: {
        last_success_at: value.integrations.batch.last_success_at,
        last_duration_ms: value.integrations.batch.last_duration_ms,
      },
    },
  };
}

/** Section 8's `IdentityGraph`, field by field. */
function projectIdentityGraph(graph: IdentityGraph): IdentityGraph {
  return {
    root: {
      identity_id: graph.root.identity_id,
      status: graph.root.status,
      accounts: graph.root.accounts,
    },
    nodes: graph.nodes.map((node) => ({
      identity_id: node.identity_id,
      status: node.status,
      accounts: node.accounts,
      total_withdrawable_cents: node.total_withdrawable_cents,
    })),
    edges: graph.edges.map((edge) => ({
      a: edge.a,
      b: edge.b,
      link_kind: edge.link_kind,
      confidence_bp: edge.confidence_bp,
      evidence: edge.evidence,
    })),
    aggregate: {
      identities: graph.aggregate.identities,
      accounts: graph.aggregate.accounts,
      open_liability_cents: graph.aggregate.open_liability_cents,
      payouts_lifetime_cents: graph.aggregate.payouts_lifetime_cents,
    },
  };
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Section 8's `EvidencePackResponse`, field by field, with the digest checked. */
function projectEvidencePack(pack: EvidencePackResponse): EvidencePackResponse {
  if (!SHA256_HEX.test(pack.content_sha256))
    throw new AdminReadError(
      `\`content_sha256\` is ${JSON.stringify(pack.content_sha256)}, which is not a SHA-256 ` +
        'digest. The digest is what makes an exported pack the pack that was exported, and a ' +
        'pack whose digest cannot be compared is evidence nobody can authenticate',
    );
  return {
    evidence_pack_id: pack.evidence_pack_id,
    download_url: pack.download_url,
    content_sha256: pack.content_sha256,
    expires_at: pack.expires_at,
    generated_at: pack.generated_at,
  };
}

/**
 * The drill-down's section allowlist, in both directions.
 *
 * A section the contract does not name is refused, and a section it names that
 * the port omitted is refused. Both directions, because the failure that reads
 * as success is the missing one: a drill-down rendered without `flags` is the
 * screen where a payout decision gets explained, explaining it without the
 * investigation.
 */
function projectAccountDetail(detail: AdminAccountDetail): AdminAccountDetail {
  const named = new Set<string>(ACCOUNT_DETAIL_SECTIONS);
  const extra = Object.keys(detail).filter((key) => !named.has(key));
  if (extra.length > 0)
    throw new AdminReadError(
      `the account drill-down carried ${extra.join(', ')}, which API_CONTRACT section 8 does ` +
        `not name. It names ${ACCOUNT_DETAIL_SECTIONS.join(', ')}, and a section nobody ` +
        'specified is a field that reached an operator by default',
    );
  const projected: Partial<Record<AccountDetailSection, unknown>> = {};
  for (const section of ACCOUNT_DETAIL_SECTIONS) {
    if (!Object.hasOwn(detail, section))
      throw new AdminReadError(
        `the account drill-down omitted \`${section}\`. Section 8 names it, and a drill-down ` +
          'missing a section renders as a complete answer with a hole in it',
      );
    projected[section] = detail[section];
  }
  return projected as AdminAccountDetail;
}

/**
 * API_CONTRACT section 8's reads, in the document's order.
 *
 * THREE ROWS OF SECTION 8 ARE READS THIS MODULE DOES NOT SERVE, and they are
 * named rather than left to be noticed. `GET /admin/loss-ratios` and `GET
 * /admin/cusum` share a heading with `/admin/eligible-forecast` and are the same
 * kind of focused projection; they are outside this session's fence and are owed
 * to whoever takes them. The mutating rows of section 8 belong to the concurrent
 * writes slice.
 */
export const ADMIN_READ_ENDPOINTS: readonly AdminEndpointSpec[] = [
  {
    method: 'GET',
    path: '/admin/liability',
    roles: ADMIN_READ_ROLES,
    handle: async ({ request, reply, source }) => {
      const liability = await source.readLiability();
      if (liability === null) return adminNotFound(reply, request.id);
      return projectLiability(liability);
    },
  },
  {
    method: 'GET',
    path: '/admin/eligible-forecast',
    roles: ADMIN_READ_ROLES,
    handle: async ({ request, reply, source }) => {
      // DERIVED FROM THE SAME READ AS `/admin/liability` AND NOT FROM A SECOND
      // QUERY. Section 8: "Focused projections of the same underlying data".
      // Two queries are two answers to "what is eligible in the next 7 days",
      // and the chart and the dashboard disagreeing is how a number stops being
      // believed (M06 section 1: the success condition is that the founder
      // looks at it and believes it).
      const liability = await source.readLiability();
      if (liability === null) return adminNotFound(reply, request.id);
      // Section 8: the focused projections are "cursor-free and cached for 60
      // seconds". `private` because the body is the firm's own position and no
      // shared cache has any business holding it.
      void reply.header('Cache-Control', 'private, max-age=60');
      const forecast: EligibleForecastResponse = {
        as_of: liability.as_of,
        eligible_next_7d: projectEligibleNext7d(liability.eligible_next_7d),
      };
      return forecast;
    },
  },
  {
    method: 'GET',
    path: '/admin/accounts',
    roles: ADMIN_READ_ROLES,
    handle: async ({ request, reply, source }) => {
      const errors: AdminFieldError[] = [];
      // INV-M6-10: "The admin console renders trader-identifying data only when
      // the query names a specific subject", and FM-M6-10 is what an unfiltered
      // one would be: "A bulk PII surface hiding inside a convenience feature".
      // Section 8 spells the parameter into the heading, `GET
      // /admin/accounts?query=`, so an absent one is a validation failure and
      // never an implied "everybody".
      const raw = queryParam(request, 'query');
      const query = raw === null ? '' : raw.trim();
      if (query === '')
        errors.push({
          path: 'query',
          message:
            'must name a specific subject: an account id, platform ref, email, identity id, ' +
            'name fragment, coupon, or payout id',
        });
      const { limit, cursor } = readPaging(request, errors);
      if (errors.length > 0) return adminValidationFailed(reply, request.id, errors);

      const page = await source.searchAccounts({ query, limit, cursor });
      // The cap is the other half of INV-M6-10, and it is asserted rather than
      // trusted: a port that returned more rows than it was asked for would
      // have turned a capped screen into the bulk export AS-M6-05 names.
      if (page.data.length > limit)
        throw new AdminReadError(
          `the account search returned ${String(page.data.length)} rows for a limit of ` +
            `${String(limit)}. INV-M6-10 caps this result set, and a cap the source may exceed ` +
            'is not a cap',
        );
      const body: AdminPage<AdminAccountSearchItem> = {
        data: page.data.map(projectAccountSearchItem),
        next_cursor: page.next_cursor,
      };
      return body;
    },
  },
  {
    method: 'GET',
    path: '/admin/accounts/:accountId',
    roles: ADMIN_READ_ROLES,
    handle: async ({ request, reply, source }) => {
      const accountId = pathParam(request, 'accountId');
      if (accountId === null) return adminNotFound(reply, request.id);
      const detail = await source.readAccount(accountId);
      if (detail === null) return adminNotFound(reply, request.id);
      return projectAccountDetail(detail);
    },
  },
  {
    method: 'GET',
    path: '/admin/identities/:identityId/graph',
    roles: ADMIN_READ_ROLES,
    handle: async ({ request, reply, source }) => {
      const identityId = pathParam(request, 'identityId');
      if (identityId === null) return adminNotFound(reply, request.id);
      const graph = await source.readIdentityGraph(identityId);
      if (graph === null) return adminNotFound(reply, request.id);
      return projectIdentityGraph(graph);
    },
  },
  {
    method: 'GET',
    path: '/admin/flags',
    roles: ADMIN_READ_ROLES,
    handle: async ({ request, reply, source }) => {
      const errors: AdminFieldError[] = [];
      // Section 8: "Filterable by type, status, severity." FILTERABLE, not
      // filtered: unlike `/admin/accounts` this is a work queue rather than a
      // subject lookup, so an absent filter is the whole queue and is correct.
      const rawStatus = queryParam(request, 'status');
      let status: FlagStatus | null = null;
      if (rawStatus !== null && rawStatus !== '') {
        const match = FLAG_STATUSES.find((value) => value === rawStatus);
        if (match === undefined)
          errors.push({ path: 'status', message: `must be one of: ${FLAG_STATUSES.join(', ')}` });
        else status = match;
      }

      const rawSeverity = queryParam(request, 'severity');
      let severity: number | null = null;
      if (rawSeverity !== null && rawSeverity !== '') {
        const parsed = Number(rawSeverity);
        const match = (FLAG_SEVERITIES as readonly number[]).includes(parsed);
        if (!match)
          errors.push({
            path: 'severity',
            message: `must be one of: ${FLAG_SEVERITIES.join(', ')}`,
          });
        else severity = parsed;
      }

      const rawType = queryParam(request, 'type');
      const flagType = rawType === null || rawType.trim() === '' ? null : rawType.trim();

      const { limit, cursor } = readPaging(request, errors);
      if (errors.length > 0) return adminValidationFailed(reply, request.id, errors);

      const page = await source.listFlags({ flagType, status, severity, limit, cursor });
      if (page.data.length > limit)
        throw new AdminReadError(
          `the flag queue returned ${String(page.data.length)} rows for a limit of ` +
            `${String(limit)}. Section 1 caps a page at what was asked for`,
        );
      assertFlagOrder(page.data);
      const body: AdminPage<FlagListItem> = {
        data: page.data.map(projectFlag),
        next_cursor: page.next_cursor,
      };
      return body;
    },
  },
  {
    method: 'GET',
    path: '/admin/evidence/:accountId',
    roles: ADMIN_READ_ROLES,
    handle: async ({ request, reply, source, principal }) => {
      const accountId = pathParam(request, 'accountId');
      if (accountId === null) return adminNotFound(reply, request.id);

      // Section 8: "Query `?reason=` is required. Generation itself is audited
      // and emits `evidence.pack_exported`."
      //
      // THE REASON IS REQUIRED HERE AND ITS CONTENT IS NOT RULED HERE. What a
      // reason must contain, and the `admin_actions` row it lands in, is the
      // concurrent writes slice's ruling; this route refuses an absent or blank
      // one and hands the rest to the generator with the actor attached.
      const rawReason = queryParam(request, 'reason');
      const reason = rawReason === null ? '' : rawReason.trim();
      if (reason === '')
        return adminValidationFailed(reply, request.id, [
          {
            path: 'reason',
            message: 'is required and must not be blank: an unexplained export is unauditable',
          },
        ]);

      const pack = await source.exportEvidence({ accountId, reason, actor: principal });
      if (pack === null) return adminNotFound(reply, request.id);
      return projectEvidencePack(pack);
    },
  },
];

/**
 * The declared roles, as data.
 *
 * Exported so a reviewer and a later gate read one table rather than seven
 * handlers.
 */
export const ADMIN_READ_ROLE_TABLE = adminRoleTable(ADMIN_READ_ENDPOINTS);

/**
 * Every one of these declares `admin_sso`, published as data for the same
 * reason `auth.ts` publishes `requiredFactorTable`.
 *
 * It is a CONSTANT rather than a field on the spec because it cannot be anything
 * else: `surface.ts` classifies `/admin` as operator, so a route in this module
 * declaring any other factor would be a claim its own path refutes at startup.
 */
export const ADMIN_READ_REQUIRED_FACTORS: Readonly<Record<string, 'admin_sso'>> =
  Object.fromEntries(
    ADMIN_READ_ENDPOINTS.map((spec) => [`${spec.method} ${spec.path}`, 'admin_sso' as const]),
  );

export default defineRoutes({
  name: 'admin-reads',
  routes: toAdminRoutes(ADMIN_READ_ENDPOINTS),
});
