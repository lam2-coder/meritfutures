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
// whose value is not one of the three forms the contract declares under such a
// name.
//
// THE NAME SAYS WHICH RULE APPLIES AND THE CONTRACT SAYS WHAT THAT RULE ADMITS.
// The `_day` suffix was read here as "this value IS a trading day", and section
// 6's `MarkListItem` declares `traded_day: boolean` and `win_day: boolean` on
// one line of the same document section 1's Time rule is written in. So the
// rule's SHAPE was right and its EXTENT was wrong: it admitted one of the three
// forms the contract writes under a day-shaped name and refused the other two.
// The repair is at {@link assertContractScalars} and it TIGHTENS as well as
// widens, because a `Date` under such a name used to pass.
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
import type { AdminEventQuery, AdminEventRow } from './admin-feed.ts';

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
 * A value the walk may DESCEND INTO: a plain object or an array, and nothing
 * else.
 *
 * THIS IS THE HALF OF THE DAY RULE THAT TIGHTENS. The container exemption below
 * used to be `typeof member === 'object' && member !== null`, and a `Date`
 * satisfies that: `Object.entries(new Date())` is `[]`, so a `Date` under a
 * day-shaped name was walked, found to carry nothing, and ADMITTED. It then
 * serialises as `"2026-08-27T00:00:00.000Z"`, which is a UTC instant standing
 * where the contract types an exchange trading day. That is the exact defect
 * this sweep exists to catch, reaching an operator THROUGH the sweep.
 *
 * NO PROJECTOR IN THIS TREE HANDS THE SWEEP A `Date` UNDER SUCH A NAME TODAY,
 * because each converts one to `YYYY-MM-DD` through its UTC parts first. That is
 * a property of every writer rather than a property of this reader, which makes
 * it a thing to remember. A `Date` arriving here is a converter that was skipped,
 * and this is where it is refused rather than served.
 */
function isWalkableContainer(value: unknown): boolean {
  if (Array.isArray(value)) return true;
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

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
      // A CONTAINER NAMED FOR A DAY IS NOT A DAY. `LiabilityResponse` carries
      // `eligible_next_7d.by_day`, an ARRAY whose elements each carry a
      // `trading_day`, and a rule that read the name alone would refuse the
      // shape the contract declares. So the check is type directed. What it may
      // descend into is a PLAIN container and never any object at all, which is
      // {@link isWalkableContainer} and is the `Date` this branch used to admit.
      if (isWalkableContainer(member)) {
        assertContractScalars(member, at);
        continue;
      }
      // `null` AND `boolean` ARE THE CONTRACT'S OWN OTHER TWO FORMS UNDER A
      // DAY-SHAPED NAME, AND THEY ARE ADMITTED BY TYPE RATHER THAN BY A LIST OF
      // FIELD NAMES.
      //
      // Read the `ts` blocks of API_CONTRACT and every key ending `_day` or
      // `_on` is declared in one of three forms. Eleven are a `YYYY-MM-DD`
      // string. Five are `string | null`: `funded_on` and `closed_on` in
      // `AccountDetail`, `trading_day` in `TimelineItem`,
      // `next_eligible_trading_day` in two progress blocks, and
      // `covered_through_day` in the calendar panel's freshness. TWO ARE
      // `boolean`: section 6's `MarkListItem` writes `traded_day: boolean;
      // win_day: boolean;` on one line, and `routes/account-reads.ts` already
      // ships both of them on `GET /accounts/:accountId/marks`. A sweep that
      // refused this document's own declarations was refusing the wrong thing.
      //
      // WHY BY TYPE AND NOT BY AN EXEMPTED LIST OF NAMES. A list of the two
      // names is a hand-maintained list, which `RI-05`'s `covers` calls "a
      // hand-maintained count in a different costume, and it drifts the same
      // way", and it is ALREADY out of date: `trading_calendar.is_half_day`
      // (`0004_catalog.sql:323`) is a third `boolean` under a day-shaped name,
      // on the trading calendar table itself.
      //
      // WHAT ADMITTING A BOOLEAN COSTS, WHICH IS THE QUESTION A CONTROL HAS TO
      // ANSWER BEFORE IT LOOSENS. This rule catches a value that COULD be a day
      // and is the wrong FORM of one: a UTC instant, an epoch number, a `Date`.
      // All three are still refused. No date rendering path in any language
      // produces `true`, so a boolean here is a field the contract declares as a
      // predicate and never a trading day that went wrong on its way to the
      // wire.
      if (member === null || typeof member === 'boolean') continue;
      if (typeof member !== 'string' || !TRADING_DAY.test(member))
        throw new AdminReadError(
          `\`${at}\` is ${JSON.stringify(member)}, and API_CONTRACT declares every ` +
            '`*_day` and `*_on` member as a `YYYY-MM-DD` exchange trading day, as `null`, or ' +
            'as a boolean predicate. Section 1: never a UTC date and never a timestamp',
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

/**
 * Section 8, `FlagListItem`.
 *
 * `corroboration_depth` IS ADR-178's AND IT IS THE PRICE OF THAT RULING RATHER
 * THAN AN ADDITION TO IT. It is the number of INDEPENDENT detector families
 * implicated on this flag's identity, which ADR-178 made this queue's first
 * sort key. It is on the wire for two reasons and neither is convenience:
 * {@link assertFlagOrder} cannot check a key it cannot see, and an operator
 * shown a severity 3 above a severity 5 has nothing on the row that says why.
 *
 * IT IS COMPUTED AND NOT STORED. No column holds it, no filter narrows by it,
 * and a client that re-sorts a page by it locally will disagree with the server
 * on the next page. ADR-178 section 6 states that cost rather than hiding it.
 */
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
  readonly corroboration_depth: number;
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

/**
 * Section 8, one figure this response cannot supply, and WHY. `ADR-203`.
 *
 * `ProjectionGap` in {@link ../routes/admin-breaker.ts} is this shape with no
 * `cause`, and the resemblance is deliberate rather than accidental: that type
 * met the naming constraint first and the spelling is taken from it. **`awaiting`
 * AND NOT `blocked_on`**, because {@link assertContractScalars} refuses any key
 * ending `_on` or `_day` that is not a `YYYY-MM-DD` trading day, and it is right
 * to: a container named for a day that is not one is how a timestamp reaches a
 * chart axis.
 */
export interface LiabilityGap {
  /**
   * The JSON path of the `null` this entry explains, as it appears on the body.
   *
   * A STRING AND NOT A CLOSED UNION, which is the one vocabulary this entry
   * leaves open and the reason is `ADR-034` rather than convenience. The set of
   * paths that may be absent is exactly the set of nullable sites the type above
   * declares, so a union here would be a FOURTH copy of the shape and `ADR-185`
   * is the general form: generate the value or delete it and point at the
   * source, there is no third. The control is
   * {@link assertLiabilityGapsPaired}, which reads the value, not a list.
   */
  readonly field: string;

  /** WHY there is no figure, from the closed set. `ADR-203` ruling 4. */
  readonly cause: LiabilityGapCause;

  /**
   * The deliverable, ADR or type that has to move first.
   *
   * Non-`null` EXACTLY when `cause` is `awaiting_dependency`, which is the one
   * pairing a reader may rely on and which
   * {@link assertLiabilityGapsPaired} enforces. The other two causes wait on
   * nothing nameable: one waits on time and one on a load nobody has run.
   */
  readonly awaiting: string | null;

  /**
   * What a reader should do with the absence. Required and never blank.
   *
   * FREE TEXT ON PURPOSE, and the pair with `cause` is the ruling rather than a
   * compromise. `cause` is BRANCHED ON, so it is closed. This is RENDERED, and
   * it carries the quantities a closed vocabulary cannot hold: how many trading
   * days short, which anchor day the estate has no opinion about.
   * `apps/admin/src/figure.ts` states the bar it has to clear -- "'unavailable'
   * written by the schema is the same silence, spelled".
   */
  readonly detail: string;
}

/**
 * WHY a figure is absent. CLOSED at three, and widening it is a diff on
 * {@link LIABILITY_GAP_CAUSES} and on the case that counts it.
 *
 * THE THREE ARE KINDS OF ABSENCE AND NEVER NAMES OF FIGURES, which is
 * `SystemReason`'s rule one vocabulary over (`ADR-165`: it "DOES NOT NAME
 * SERVICES, IT NAMES KINDS OF ACCESS"). What moves is `awaiting`; the cause set
 * does not grow when a fourth figure goes absent for a reason already here.
 *
 * EACH IS A DIFFERENT ACT BY WHOEVER READS THE PANEL, which is what makes three
 * the number rather than one:
 *
 *   `awaiting_dependency`   a named deliverable is outstanding. Nothing in the
 *                           estate is wrong and `awaiting` names what is owed
 *   `insufficient_history`  the estate is correct and does not reach far enough
 *                           back to cover the window the figure is defined over.
 *                           Waiting is the whole remedy
 *   `estate_uncovered`      the estate records NO OPINION about the period at
 *                           all. `ADR-042` F-4's unknown, which is not a "no",
 *                           and which is somebody's job today rather than later
 */
export type LiabilityGapCause = 'awaiting_dependency' | 'insufficient_history' | 'estate_uncovered';

/** {@link LiabilityGapCause} as data, for the validator and for the suite. */
export const LIABILITY_GAP_CAUSES = [
  'awaiting_dependency',
  'insufficient_history',
  'estate_uncovered',
] as const satisfies readonly LiabilityGapCause[];

/** Section 8, `LiabilityResponse`. */
export interface LiabilityResponse {
  readonly as_of: string;

  // ONE COMPONENT OF THE PANEL THAT SHARES ITS NAME, AND THE NAME IS KEPT.
  // ADR-188 clause 2: the wire speaks the schema's vocabulary in both
  // directions, so a reader tracing this field back to `0009_ledger.sql` finds
  // the column it was read from. The panel is this plus the next field summed,
  // and NO TOTAL IS SENT (clause 3): the sum is a pure function of two fields of
  // one row at one `as_of`, and a third number the handler computed could
  // disagree with the two beside it.
  readonly open_liability_cents: number;
  readonly wallet_balances_cents: number;
  readonly bounded_near_term_cents: number;
  readonly remaining_ladder_exposure_cents: number;

  /**
   * `P-M6-10`, and IT IS SIGNED.
   *
   * The only field on this response that may be negative (`0009_ledger.sql`
   * declares the column signed), which the contract now states because a
   * renderer that clamps it at zero reports an absorbed correction as none.
   */
  readonly absorbed_corrections_cents: number;
  readonly funded_accounts: number;
  /**
   * `null` WHEN THE HORIZON HAS NO ANSWER, and `gaps` says which way.
   *
   * `ADR-203` ruling 8 and `ADR-204` ruling 9: *"WHERE THE HORIZON HAS NO
   * ANSWER, THE FIELD HAS NO VALUE, AND THE SHAPE OF THAT ABSENCE IS
   * `ADR-203`'s"*. The producer's `readTradingHorizon` already answers three
   * ways -- covered, `exhausted` and `uncovered` -- and this field carried one,
   * so an uncovered calendar had to be rendered as a horizon of zero accounts
   * owed zero cents and read exactly like a week nobody clears.
   *
   * THE TWO CAUSES ARE `insufficient_history` AND `estate_uncovered` AND THEY
   * MUST STAY DISTINCT, on `0032`'s and `ADR-042` F-4's rule that an exhausted
   * calendar and an uncovered one are different answers and only one is safe to
   * act on. Neither is `awaiting_dependency`, so `awaiting` is `null` on this
   * field's gap and {@link assertLiabilityGapsPaired} enforces that pairing.
   *
   * THE ABSENCE IS AT THE OBJECT AND NOT AT A MEMBER, which is the same half
   * `payout_velocity` gets from {@link assertContractScalars}: `total_cents:
   * null` is refused at the boundary, so a partly supplied forecast is not a
   * shape this response could serve.
   */
  readonly eligible_next_7d: EligibleNext7d | null;
  /**
   * `null` WHEN THE WINDOW CANNOT BE SUPPLIED, and `gaps` says which way.
   *
   * `ADR-203`. `evaluatePayoutVelocity` answers three ways -- `evaluated`,
   * `exhausted`, `uncovered` -- and this field carried one, so an uncovered
   * calendar had to be rendered `0 / false` and read exactly like a quiet week.
   *
   * THE ABSENCE IS AT THE OBJECT AND NOT AT A MEMBER, and that half was already
   * enforced before it was ruled: {@link assertContractScalars} makes every
   * `*_cents` and `*_bp` a JSON integer, so `last_7d_cents: null` is refused at
   * the boundary. A nullable member is not a shape this response could serve.
   */
  readonly payout_velocity: {
    readonly last_7d_cents: number;
    readonly avg_30d_cents: number;
    readonly ratio_bp: number;
    readonly alarm: boolean;
  } | null;
  readonly reserve: {
    /**
     * ITS OWN `as_of`, BECAUSE IT IS A DIFFERENT TABLE ON A DIFFERENT CLOCK.
     *
     * `reserve_coverage_snapshots` is the rail's balance against ours and
     * `liability_snapshots` is the book; dating both with the top-level `as_of`
     * would re-collapse in the payload exactly what the schema separated, which
     * is `data-model/liability_snapshots.md`'s second reason for two tables:
     * "one row forces one `as_of` on two sources that do not move together".
     */
    readonly as_of: string;
    readonly reserve_cents: number;
    readonly cvar99_cents: number;
    readonly rcr_bp: number;

    /** The one member that is not a column, and it stays. ADR-188 clause 4. */
    readonly breaker_armed: boolean;
    readonly treasury_account_code: string;
    readonly treasury_as_of: string;

    /**
     * CLOSED ON THE WIRE AND NARROWED AT THE READER, and both are correct.
     *
     * `treasury_balances.source` is closed at these two names, so the contract
     * publishes what the column may hold. `P-M6-07` requires "attestation
     * staleness shown when the balance is a manual attestation" and nothing else
     * on this response answers which of the two it is.
     */
    readonly treasury_source: 'provider_api' | 'manual_attestation';
  };
  readonly per_plan: readonly {
    readonly plan_id: string;
    readonly code: string;
    readonly loss_ratio_bp: number;
    readonly threshold_bp: number;
    readonly sales_paused: boolean;
    /**
     * NOT money and NOT basis points. See this file's header.
     *
     * `null` UNTIL `DEP-M6-05`, which is `ADR-202` ruling 3 transcribed and not
     * re-decided here. The members are unchanged in name and in type, so
     * `ADR-167` clause 4's integer basis points stand exactly as written; what
     * moved is that the object may be absent, and `gaps` carries the reason
     * ONCE on the body because it is identical for every plan on every day.
     */
    readonly cusum: {
      readonly statistic: number;
      readonly threshold: number;
      readonly alarm: boolean;
    } | null;
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

  /**
   * Every `null` above, named, with why. `[]` on a complete response.
   *
   * `ADR-203` ruling 2: NO `null` TRAVELS ALONE. A bare `null` turns an honest
   * gap into an indistinguishable zero, which on this panel is the difference
   * between "we do not know" and "there is none". It is REQUIRED and never
   * omitted, for the same reason the nulls above are nulls rather than missing
   * keys.
   *
   * ONE ENTRY PER ABSENT FIGURE AND NOT ONE PER `null` VALUE. `per_plan[].cusum`
   * is absent on every plan for one reason, so it is one entry whose `field` is
   * the path with the index elided, exactly as `CUSUM_GAPS` already writes it.
   */
  readonly gaps: readonly LiabilityGap[];
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

  /**
   * `null` WHEN THE HORIZON HAS NO ANSWER, exactly as on `LiabilityResponse`.
   *
   * `ADR-208`. This endpoint exists to carry this one figure, so the two shapes
   * it could take are a body with a `null` and a reason, or `adminNotFound`. The
   * 404 is REFUSED, and the reason is this contract section's own: `API_CONTRACT`
   * section 8 records that `/admin/loss-ratios` and `/admin/cusum` are
   * *"registered by nothing"* and *"answer 404 on the admin origin as well as on
   * the public one"*, so on this heading a 404 already means A ROUTE NOBODY HAS
   * BUILT. Serving one for *"the estate records no opinion about this period"*
   * would put two answers under one status code, and the one an operator must
   * act on today is the one that would be mistaken for the backlog.
   */
  readonly eligible_next_7d: EligibleNext7d | null;

  /**
   * The gap explaining the `null`, FORWARDED from `LiabilityResponse.gaps`.
   *
   * `ADR-208`. It is `LiabilityGap` and not `admin-breaker.ts`'s
   * {@link ../routes/admin-breaker.ts ProjectionGap}, which is the sibling
   * projections' shape and cannot carry this absence: `ProjectionGap.awaiting`
   * is a required `string`, and `ADR-204` ruling 9's two causes are
   * `insufficient_history` and `estate_uncovered`, for which `ADR-203` ruling 4
   * requires `awaiting` to be `null`. A body that named a deliverable for an
   * exhausted calendar would send an operator to read a document that does not
   * exist.
   *
   * FILTERED FROM THE LIABILITY BODY AND NEVER REBUILT, on this endpoint's own
   * rule that it derives from the same read: two explanations of one absence is
   * an operator choosing which to believe, which is `ADR-203` ruling 2's reason
   * for refusing two entries over one field.
   */
  readonly gaps: readonly LiabilityGap[];
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

/**
 * Section 8's `EvidencePackAudience`, and it is a TRANSCRIPTION rather than a
 * second vocabulary.
 *
 * The four names are `evidence_packs.audience`'s CHECK in `0008_risk.sql`, which
 * is merged and therefore sacred. A fifth name added here would type-check, pass
 * every test in this file, and fail at the database on the first export that
 * used it, which is the direction that costs the most to discover.
 *
 * `SD-M6-04`, `AS-M6-01`, and ADR-166. THE AUDIENCE DECIDES WHAT LEAVES THE
 * BUILDING: `0008_risk.sql`'s own header says a pack given to a trader in a
 * dispute "is a channel that discloses detector thresholds to the adversary who
 * triggered them", which is why the column is `NOT NULL` and why this parameter
 * has no default.
 */
export type EvidencePackAudience = 'internal' | 'trader' | 'counsel' | 'regulator';

/** {@link EvidencePackAudience} as data, for the validator and for the suite. */
export const EVIDENCE_PACK_AUDIENCES = [
  'internal',
  'trader',
  'counsel',
  'regulator',
] as const satisfies readonly EvidencePackAudience[];

/** Section 8, `EvidencePackResponse`. */
export interface EvidencePackResponse {
  readonly evidence_pack_id: string;
  readonly download_url: string;
  readonly content_sha256: string;
  readonly expires_at: string;
  readonly generated_at: string;
  /**
   * Echoed, so a caller can tell from the response what the bytes behind
   * `download_url` were built as rather than from what it remembers sending.
   *
   * `redaction_profile` is NOT echoed and is not on this type. It is recorded on
   * the pack row, its vocabulary carries no CHECK in `0008_risk.sql` and is
   * unruled, and `INV-M7-10` makes the strip list DERIVED from
   * `detector_definitions.is_sensitive` rather than named. ADR-166 F3.
   */
  readonly audience: EvidencePackAudience;
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
  /**
   * Section 8: "Query `?reason=` and `?audience=` are both required" (ADR-166).
   *
   * NOT OPTIONAL AND NOT DEFAULTED, which is the whole point of the field.
   * `evidence_packs` makes `audience`, `redaction_profile` and
   * `includes_detector_detail` all `NOT NULL`, so before this parameter existed
   * the generator had to supply an audience the caller never named, and
   * `M06` section 4 already forbade that in words: the profile "follows from the
   * audience and is recorded on the pack, not chosen per export".
   */
  readonly audience: EvidencePackAudience;
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
  /**
   * The event feed's page, BEFORE `INV-M6-10` is applied to it.
   *
   * A SEVENTH METHOD HERE RATHER THAN A PORT OF ITS OWN, which is ADR-184
   * ruling 1 and it is a measurement rather than a preference: this deployable
   * declares ONE admin read port and FOUR admin write backends, so the tree's
   * split is reads-versus-writes and not one module one port. The feed is a
   * read through the same door, the same unit of work and the same authority,
   * and a second read port would be a second name for one door and a second
   * wiring obligation for one missing thing.
   *
   * THE SCOPE ARRIVES ON THE QUERY, so the licence a page was served under is a
   * value the adapter is handed rather than a rule it has to remember. The
   * withholding itself stays on the RESPONSE, in `admin-feed.ts`, because it is
   * a property of the bytes and not of the rows.
   *
   * THIS ONE NARROWS THE SHAPE REASON ABOVE AND DOES NOT RETIRE IT, and the
   * difference is the whole of why the method stays here. `AdminEventRow` IS a
   * projection of one table, so "there is no join and no aggregate to reach
   * for" is now measured false for a THIRD method, after `listFlags` and
   * `readIdentityGraph`. The composition file records that narrowing, on its own
   * precedent, and `test/wiring.test.ts`'s entry is not this slice's to edit:
   * the triple does not move, because a method is not a port.
   *
   * THE COMPOSITION IS NOT NAMED BY PATH ANYWHERE IN THIS MODULE, AND THAT IS A
   * CONTROL RATHER THAN AN OMISSION. Its own suite asserts that this file
   * contains no reference to that directory, as a SUBSTRING and not as an
   * import read, so a pointer written here turns it red. The dependency runs
   * one way: the composition cites this module and this module cites it back
   * nowhere.
   */
  listEvents(query: AdminEventQuery): Promise<AdminPage<AdminEventRow>>;
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
 * ADR-178 RULED THIS ORDER AND THIS FUNCTION IS WHERE THE RULING IS ENFORCED.
 * Two approved documents ordered one queue differently. API_CONTRACT section 8
 * said "Sorted by severity then age", which this function enforced FLAT across
 * the page; `M07` `AS-M7-03` clause 3 says the queue sorts by the number of
 * INDEPENDENT detector families implicated on an identity. A corroborated page
 * inverts severity BY CONSTRUCTION, so the flat assertion refused the security
 * control rather than the defect, on every page where the control did any work.
 *
 * THE RULING KEPT BOTH SENTENCES AND ORDERED THEM. Corroboration depth is the
 * FIRST key, because it is the control and because a queue an adversary can
 * reorder by firing one detector is not a queue. The contract's "severity then
 * age" is kept VERBATIM as the order WITHIN one corroboration band. So this
 * assertion did not lose a key: it gained one, it went from two keys to three,
 * and it now enforces the control it used to refuse.
 *
 * THE BAND IS A DEPTH AND NOT AN IDENTITY. Two identities at the same depth
 * interleave by severity, which is what the flag-queue adapter builds and is
 * NOT the reconciliation session 318 recorded ("the order WITHIN one identity").
 * ADR-178 section 1 makes that correction, and it matters because the two
 * readings describe different queues.
 *
 * THE ADAPTER IS NOT NAMED IN THIS FILE ON PURPOSE. `P7-i`'s fence asserts that
 * this module mentions its implementer nowhere, so that the dependency runs one
 * way: the adapter imports this port and this port knows of no adapter.
 *
 * DEPTH IS ON THE WIRE BECAUSE THIS FUNCTION CANNOT SEE IT OTHERWISE, and that
 * is the price of the ruling rather than a convenience. Without the field the
 * only honest move left here is to DELETE this assertion, which is weakening a
 * gate to pass it.
 *
 * DIRECTIONS ARE STATED OUT LOUD, because section 8 states none: MOST
 * CORROBORATED FIRST, then MOST SEVERE FIRST, then OLDEST FIRST.
 *
 * ASSERTED WITHIN A PAGE AND NOT ACROSS PAGES, which is the honest limit: the
 * order is the port's, because a cursor page cannot be re-sorted here without
 * breaking the cursor, and this catches a port that ignored the rule at the one
 * place the rule is visible.
 *
 * EXPORTED SO THE SUITE ASSERTS THE PAGE AND NOT THE SOURCE TEXT. Before
 * ADR-178 this refusal was pinned by a suite reading the CHARACTERS of this
 * file, because it had no other reach; a string match is a test of a spelling
 * and it passes the day the spelling survives the behaviour.
 */
export function assertFlagOrder(items: readonly FlagListItem[]): void {
  for (const item of items)
    if (!Number.isInteger(item.corroboration_depth) || item.corroboration_depth < 0)
      throw new AdminReadError(
        `flag \`${item.flag_id}\` carries corroboration depth ` +
          `${JSON.stringify(item.corroboration_depth)}, which is not a count of detector ` +
          'families. ADR-178 makes it the first sort key of this queue, and a key that is not ' +
          'a count orders nothing',
      );
  for (let i = 1; i < items.length; i += 1) {
    const previous = items[i - 1];
    const current = items[i];
    if (previous === undefined || current === undefined) continue;
    if (previous.corroboration_depth < current.corroboration_depth)
      throw new AdminReadError(
        `flag \`${current.flag_id}\` at corroboration depth ` +
          `${String(current.corroboration_depth)} follows \`${previous.flag_id}\` at depth ` +
          `${String(previous.corroboration_depth)}. ADR-178 sorts this queue by corroboration ` +
          'first, and a queue that ranks one loud detector above three agreeing ones is the ' +
          'queue AS-M7-03 describes an adversary building',
      );
    if (previous.corroboration_depth !== current.corroboration_depth) continue;
    if (previous.severity < current.severity)
      throw new AdminReadError(
        `flag \`${current.flag_id}\` at severity ${String(current.severity)} follows ` +
          `\`${previous.flag_id}\` at severity ${String(previous.severity)} at the same ` +
          'corroboration depth. API_CONTRACT section 8 sorts WITHIN a corroboration band by ' +
          'severity then age, and a band that inverts triage is unreadable as triage',
      );
    if (
      previous.severity === current.severity &&
      previous.first_detected_on > current.first_detected_on
    )
      throw new AdminReadError(
        `flag \`${current.flag_id}\` first detected on ${current.first_detected_on} follows ` +
          `\`${previous.flag_id}\` first detected on ${previous.first_detected_on} at the same ` +
          'corroboration depth and severity. Section 8 sorts by severity then AGE, and the ' +
          'older flag is the one that has been waiting',
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
    // ADR-178. The sort key an operator needs in order to read the sort.
    corroboration_depth: item.corroboration_depth,
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

/**
 * `ADR-203` ruling 2, as a control rather than as a sentence: NO `null` TRAVELS
 * ALONE, AND NO GAP NAMES A FIGURE THAT IS THERE.
 *
 * BOTH DIRECTIONS, and the second one is the half a reader would not think to
 * ask for. A `null` with no entry naming it is the bare null this ruling exists
 * to refuse: an honest gap rendered as an indistinguishable zero. An entry
 * naming a path that is NOT `null` is the opposite failure and it is worse,
 * because it tells an operator that a figure they are looking straight at is
 * missing, and the figure is the firm's own position.
 *
 * THE ABSENT PATHS ARE READ OFF THE VALUE AND NEVER OFF A LIST. A list of the
 * nullable sites would be a fourth copy of the shape, which is `RI-18`'s subject
 * and `ADR-034`'s: it would agree with the type on the day it was written and
 * drift the first time a field went nullable without this function moving.
 *
 * `per_plan[].cusum` IS ONE PATH AND NOT ONE PER PLAN. The index is elided
 * because the absence is a property of the calibration rather than of a plan,
 * which is `ADR-202` ruling 3's reason for putting the object's absence at the
 * object; `CUSUM_GAPS` in `admin-breaker.ts` already writes the path this way.
 */
export function assertLiabilityGapsPaired(value: LiabilityResponse): void {
  const absent = new Set<string>();
  if (value.payout_velocity === null) absent.add('payout_velocity');
  if (value.per_plan.some((plan) => plan.cusum === null)) absent.add('per_plan[].cusum');
  if (value.eligible_next_7d === null) absent.add('eligible_next_7d');

  const named = new Set<string>();
  for (const gap of value.gaps) {
    if (named.has(gap.field))
      throw new AdminReadError(
        `\`gaps\` names \`${gap.field}\` twice, and ADR-203 ruling 2 is one entry per absent ` +
          'figure. Two reasons for one absence is an operator choosing which to believe',
      );
    named.add(gap.field);
    if (gap.detail.trim() === '')
      throw new AdminReadError(
        `\`gaps\` names \`${gap.field}\` with a blank \`detail\`, and ADR-203 ruling 4 requires ` +
          'one. A blank reason is the bare null this ruling refuses, spelled',
      );
    const awaits = gap.cause === 'awaiting_dependency';
    if (awaits !== (gap.awaiting !== null))
      throw new AdminReadError(
        `\`gaps\` names \`${gap.field}\` with cause \`${gap.cause}\` and awaiting ` +
          `${JSON.stringify(gap.awaiting)}. ADR-203 ruling 4 makes \`awaiting\` non-null EXACTLY ` +
          'when the cause is `awaiting_dependency`, because that is the one cause that names ' +
          'something a reader can go and look at',
      );
  }

  for (const path of absent)
    if (!named.has(path))
      throw new AdminReadError(
        `\`${path}\` is null and \`gaps\` does not name it. ADR-203 ruling 2: a null nothing ` +
          'explains is an honest gap arriving as an indistinguishable zero, and on this panel ' +
          'that is the difference between "we do not know" and "there is none"',
      );

  for (const path of named)
    if (!absent.has(path))
      throw new AdminReadError(
        `\`gaps\` names \`${path}\` and that figure is PRESENT on this response. ADR-203 ` +
          'ruling 2 pairs the two in both directions: a gap over a figure an operator is ' +
          'looking straight at is worse than no gap at all',
      );
}

/** Section 8's `LiabilityResponse`, field by field. */
function projectLiability(value: LiabilityResponse): LiabilityResponse {
  assertLiabilityGapsPaired(value);
  return {
    as_of: value.as_of,
    open_liability_cents: value.open_liability_cents,
    wallet_balances_cents: value.wallet_balances_cents,
    bounded_near_term_cents: value.bounded_near_term_cents,
    remaining_ladder_exposure_cents: value.remaining_ladder_exposure_cents,
    absorbed_corrections_cents: value.absorbed_corrections_cents,
    funded_accounts: value.funded_accounts,
    eligible_next_7d:
      value.eligible_next_7d === null ? null : projectEligibleNext7d(value.eligible_next_7d),
    payout_velocity:
      value.payout_velocity === null
        ? null
        : {
            last_7d_cents: value.payout_velocity.last_7d_cents,
            avg_30d_cents: value.payout_velocity.avg_30d_cents,
            ratio_bp: value.payout_velocity.ratio_bp,
            alarm: value.payout_velocity.alarm,
          },
    reserve: {
      as_of: value.reserve.as_of,
      reserve_cents: value.reserve.reserve_cents,
      cvar99_cents: value.reserve.cvar99_cents,
      rcr_bp: value.reserve.rcr_bp,
      breaker_armed: value.reserve.breaker_armed,
      treasury_account_code: value.reserve.treasury_account_code,
      treasury_as_of: value.reserve.treasury_as_of,
      treasury_source: value.reserve.treasury_source,
    },
    per_plan: value.per_plan.map((plan) => ({
      plan_id: plan.plan_id,
      code: plan.code,
      loss_ratio_bp: plan.loss_ratio_bp,
      threshold_bp: plan.threshold_bp,
      sales_paused: plan.sales_paused,
      cusum:
        plan.cusum === null
          ? null
          : {
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
    gaps: value.gaps.map((gap) => ({
      field: gap.field,
      cause: gap.cause,
      awaiting: gap.awaiting,
      detail: gap.detail,
    })),
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

/**
 * Section 8's `EvidencePackResponse`, field by field, with the digest checked and
 * the audience checked against the one that was ASKED FOR.
 *
 * THE AUDIENCE COMPARISON IS THE POINT AND IT IS NOT A TYPE CHECK. The port
 * returns a pack carrying its own `audience`, and the caller asked for one. A
 * generator that built an `internal` pack for a request that said `trader` is
 * the failure `SD-M6-04` exists to prevent, and it produces a well-formed
 * response with a valid audience in it, so nothing else in this file would
 * notice. `AS-M6-01`, ADR-166 clause 2.
 *
 * It is refused rather than corrected. Overwriting the pack's own audience with
 * the requested one would make the response say `trader` about bytes built as
 * `internal`, which is the same disclosure with a truthful label removed.
 */
function projectEvidencePack(
  pack: EvidencePackResponse,
  requested: EvidencePackAudience,
): EvidencePackResponse {
  if (!SHA256_HEX.test(pack.content_sha256))
    throw new AdminReadError(
      `\`content_sha256\` is ${JSON.stringify(pack.content_sha256)}, which is not a SHA-256 ` +
        'digest. The digest is what makes an exported pack the pack that was exported, and a ' +
        'pack whose digest cannot be compared is evidence nobody can authenticate',
    );
  if (pack.audience !== requested)
    throw new AdminReadError(
      `the generator returned a pack built for \`${pack.audience}\` against a request for ` +
        `\`${requested}\`. The audience decides what leaves the building (AS-M6-01), so a pack ` +
        'whose audience is not the one that was asked for is refused rather than relabelled',
    );
  return {
    evidence_pack_id: pack.evidence_pack_id,
    download_url: pack.download_url,
    content_sha256: pack.content_sha256,
    expires_at: pack.expires_at,
    generated_at: pack.generated_at,
    audience: pack.audience,
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

// -----------------------------------------------------------------------------
// `INV-M6-10` on the drill-down. ADR-184 ruling 3, applied at the RESPONSE
// -----------------------------------------------------------------------------
// **THE FEED HAS THIS PROJECTION AND THIS ROUTE DID NOT, AND THE GAP WAS A
// THIRD PARTY'S IDENTITY IN A RESPONSE ABOUT SOMEBODY ELSE.** Session 356
// measured it with a case: `GET /admin/accounts/:accountId` names its subject in
// the PATH, gated nothing, and its `events` section carried `kyc.dedupe_hit`'s
// `matched_identity_id` verbatim.
//
// **IT IS HERE AND NOT IN THE ADAPTER THAT SUPPLIES `readAccount`, AND ADR-184
// RULING 3 IS THE REASON IN ITS OWN WORDS**: "the withholding is a property of
// the RESPONSE and not of the renderer", with the control "run over the
// SERIALIZED body and not over the rows". An adapter hands over rows. A gate inside one is a second
// place the rule can be slightly different from the feed's, which is the shape
// that ruling refused, and `packages/db/src/scope.ts` draws the same line about
// this exact pair of payload keys: the exclusion "is a PROJECTION and not this
// rule".
//
// **THE RULE IS NOT "NEVER RENDER AN ID", SO THIS IS A LICENCE AND NOT A
// REFUSAL.** `INV-M6-10` renders trader-identifying data "only when the query
// names a specific subject" (`M06:54`), and this query names one. `W6-g`
// established the shape one screen over and `apps/admin` states it: every id
// served must be one the query reached. So the projection here is NARROWER than
// the feed's rather than absent, and {@link accountDetailLicence} is the whole
// of what it admits.
//
// **THE VOCABULARY IS `admin-feed.ts`'S AND THE CODE IS NOT, WHICH IS A
// DUPLICATION TAKEN ON MEASUREMENT RATHER THAN BY PREFERENCE.** `admin-feed.ts`
// already imports `ADMIN_READ_ROLES`, `LIMIT_DEFAULT`, `LIMIT_MAX`,
// `adminRoleTable`, `adminValidationFailed` and `toAdminRoutes` from this file,
// so a VALUE import back is a cycle, and both ends of it were measured on this
// branch rather than reasoned about. Under real Node ESM it is a hard
// `ReferenceError: Cannot access 'ADMIN_READ_ROLES' before initialization`.
// Under Vitest's transform it does not throw at all: `ADMIN_FEED_ENDPOINTS`
// evaluates with `roles: undefined` and `ADMIN_FEED_ROLE_TABLE` becomes
// `{ 'GET /admin/events': undefined }`, which is an admin route registered with
// no role requirement and a green suite over it. **The second outcome is why the
// import is refused rather than ordered around.** The type-only import at the
// top of this file is not that cycle, because `import type` is erased.
//
// **SO THE TWO STATEMENTS ARE BOUND BY AN ASSERTION INSTEAD OF BY AN IMPORT**,
// which is session 357's repair for the same shape: the drill-down adapter's own
// suite asserts {@link WITHHELD} against the feed's and {@link namesASubject}
// against the feed's over a corpus of keys, both halves non-empty before they
// are compared. **THE ONE-FILE REPAIR IS REPORTED AND NOT TAKEN**: `admin-feed.ts` importing
// these three names from this file and deleting its own is a deletion in a file
// this fence does not hold. Until then the two are read together.

/** What a withheld value renders as. `admin-feed.ts`'s `WITHHELD`, on this response too. */
export const WITHHELD = 'withheld';

/**
 * Whether a key names an identity or an account, WHOSEVER IT IS.
 *
 * A RULE ON THE SHAPE OF THE KEY AND NOT A COLUMN LIST (ADR-184 ruling 3), so
 * `matched_identity_id` and `merged_identity_id` are covered without either
 * having been enumerated, and so is the next payload key nobody has written yet.
 *
 * WHAT IT DOES NOT REACH IS SAID RATHER THAN IMPLIED: a third party's uuid
 * stored under a key of some other shape passes this and passes
 * {@link assertNothingWithheldOnTheWire} with it, because nothing withheld it.
 * The console's own check on the same screen is a UUID PATTERN over the served
 * strings rather than a key rule, so the two layers fail on different things by
 * construction and both are wanted.
 */
export function namesASubject(key: string): boolean {
  return key.endsWith('identity_id') || key.endsWith('account_id');
}

/** Thrown when a withheld value reached the drill-down's body. A 500 beats a leak. */
export class AdminDetailLeak extends Error {
  constructor(value: string) {
    super(
      `the account drill-down contains ${value}, which INV-M6-10 withheld from this response. ` +
        'The licence of this screen is the subject the path named and the identity that ' +
        "account row names, so an id from outside that closure is a second person's identity " +
        'in a response about the first',
    );
    this.name = 'AdminDetailLeak';
  }
}

/**
 * The control, run over the SERIALIZED body rather than over the sections.
 *
 * A FIELD ADDED CARELESSLY IS WHAT THIS CATCHES, which is `admin-feed.ts`'s
 * reason for the same control. {@link withholdAccountDetail} gates the keys it
 * recognises; this asserts the property over whatever the body actually became,
 * so a value withheld in one section and carried through in another is a refusal
 * rather than a leak.
 */
export function assertNothingWithheldOnTheWire(
  body: unknown,
  withheldValues: readonly string[],
): void {
  if (withheldValues.length === 0) return;
  const text = JSON.stringify(body);
  for (const value of withheldValues) if (text.includes(value)) throw new AdminDetailLeak(value);
}

/**
 * The ids this query reached, which is the whole of this response's licence.
 *
 * TWO MEMBERS, AND THE SECOND ONE IS THE CONTRACT'S DOING RATHER THAN A
 * WIDENING. `ACCOUNT_DETAIL_SECTIONS` names `identity` as one of the eight, and
 * the only way to reach it is `accounts.identity_id`, which `0007_accounts.sql`
 * declares `uuid NOT NULL REFERENCES identities(id)`. So the owner is a subject this query
 * reached and withholding them would blank a section section 8 asks for while
 * still serving the person's whole row beside the hole.
 *
 * IT IS NARROWER THAN `apps/admin`'s ONE-MEMBER CLOSURE ONLY IN APPEARANCE, and
 * the difference is which bytes each licence is over: that screen renders a
 * count per section and never a member, so the subject it typed is the entirety
 * of what it serves; this is the response those counts are counted from.
 *
 * **THE ROOT IS CHECKED AGAINST THE PATH FIRST AND THE TWO ARE ONE FUNCTION ON
 * PURPOSE.** A licence taken from a response the port chose, without checking
 * that the response is about the account that was asked for, licenses whatever
 * the port returned. `W6-g` checks the root first for exactly this and
 * `apps/admin` calls it "the worst answer this endpoint can give and the one
 * they cannot detect". Separating the check from the licence would leave an
 * order a later caller can get wrong, which is `FM-M6-10`'s shape.
 */
export function accountDetailLicence(
  detail: AdminAccountDetail,
  accountId: string,
): ReadonlySet<string> {
  const account = asRecord(detail.account);
  if (account === null)
    throw new AdminReadError(
      'the account drill-down carried no `account` section to check its root against. The ' +
        'licence of this response is the subject the path named, and a response that does not ' +
        'say which account it is about cannot be checked against one',
    );
  const root = account['account_id'];
  if (root !== accountId)
    throw new AdminReadError(
      `the account drill-down is headed \`${JSON.stringify(root)}\` where the path named ` +
        `\`${accountId}\`. A page headed by the id an operator typed whose rows belong to ` +
        'another human is the answer they cannot detect, and INV-M6-10 licenses the subject ' +
        'the QUERY named rather than the one the source chose to answer with',
    );
  const identityId = account['identity_id'];
  const licensed = new Set<string>([accountId]);
  if (typeof identityId === 'string' && identityId !== '') licensed.add(identityId);
  return licensed;
}

/** What {@link withholdAccountDetail} produced. `withheldValues` NEVER goes on the wire. */
export interface WithheldDetail {
  readonly detail: AdminAccountDetail;
  /** Every value INV-M6-10 kept off this response. For the wire control alone. */
  readonly withheldValues: readonly string[];
}

/**
 * Apply `INV-M6-10` to a drill-down.
 *
 * A WALK AND NOT A ROW MAPPER, which is the one place this differs in SHAPE from
 * `withholdForScope` rather than in licence. The feed gates a typed
 * `AdminEventRow`; this route is THE ONE ROUTE OF THE SEVEN THE CORPUS DOES NOT
 * TYPE, its eight sections are bags of stored columns, and four of them carry
 * stored `jsonb` besides. So the rule is applied the way `assertContractScalars`
 * applies section 1's: over every key of whatever the response actually is.
 *
 * NO `withheld` FLAG IS ADDED TO A ROW, where the feed's `AdminEventItem`
 * carries one. The adapter behind `readAccount` serves the DDL's own columns
 * under the DDL's own names and nothing else, so a boolean this module invented
 * would be the contract-designing that adapter refuses. The value reads
 * `withheld` in place, which says the same thing where an operator is already
 * looking.
 *
 * A VALUE THAT IS NOT A PLAIN OBJECT OR AN ARRAY IS RETURNED UNTOUCHED rather
 * than rebuilt. A walk that reconstructed every object would turn anything
 * carrying its own prototype into `{}`, which is a stored bag silently emptied
 * on the screen whose whole discipline is that it shows the stored row.
 */
export function withholdAccountDetail(
  detail: AdminAccountDetail,
  licensed: ReadonlySet<string>,
): WithheldDetail {
  const withheldValues = new Set<string>();

  const gate = (value: string): string => {
    if (licensed.has(value)) return value;
    withheldValues.add(value);
    return WITHHELD;
  };

  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map((item: unknown) => walk(item));
    if (typeof value !== 'object' || value === null) return value;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    const record = value as Record<string, unknown>;
    // THE SUBJECT IS GATED ONLY WHERE THE SIBLING KIND SAYS IT IS A PERSON OR AN
    // ACCOUNT, which is `withholdForScope`'s rule kept rather than re-decided: a
    // `payout_request` subject is the handle an operator clicks through to, and
    // withholding it leaves a screen nobody can act on while protecting nothing
    // INV-M6-10 is about.
    const kind = record['subject_kind'];
    const gatesTheSubject = kind === 'identity' || kind === 'account';
    const projected: Record<string, unknown> = {};
    for (const [key, member] of Object.entries(record)) {
      if (
        typeof member === 'string' &&
        (namesASubject(key) || (gatesTheSubject && key === 'subject_id'))
      )
        projected[key] = gate(member);
      else projected[key] = walk(member);
    }
    return projected;
  };

  return {
    detail: walk(detail) as AdminAccountDetail,
    withheldValues: [...withheldValues],
  };
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
      // ADR-208: THE PAIRING IS ASSERTED HERE TOO, AND THAT IS A REPAIR RATHER
      // THAN A PRECAUTION. `assertLiabilityGapsPaired` runs inside
      // `projectLiability`, and THIS HANDLER DOES NOT CALL `projectLiability`:
      // it reads the same source and builds its own body, so until this line
      // the one control `ADR-203` ruling 2 rests on ran on `/admin/liability`
      // and on no other path that reads a liability. With `eligible_next_7d`
      // nullable that is the difference between a reason and a bare `null` on
      // the endpoint that exists to carry exactly this figure.
      //
      // THE PRODUCER'S OWN FUNCTION AND NOT A SECOND ONE. A pairing check
      // written for this body would be `FM-16`'s shape on the guard against
      // `FM-16`: a second statement of one predicate with nothing comparing
      // them.
      assertLiabilityGapsPaired(liability);
      // AND THE GAP IS FORWARDED, NOT REBUILT. This projection carries one field
      // of that body, so the entries it keeps are exactly the ones naming that
      // field. A gap built here would be a second explanation of one absence,
      // and the two would drift the first time the producer's did.
      const forecast: EligibleForecastResponse = {
        as_of: liability.as_of,
        eligible_next_7d:
          liability.eligible_next_7d === null
            ? null
            : projectEligibleNext7d(liability.eligible_next_7d),
        gaps: liability.gaps
          .filter((gap) => gap.field === 'eligible_next_7d')
          .map((gap) => ({
            field: gap.field,
            cause: gap.cause,
            awaiting: gap.awaiting,
            detail: gap.detail,
          })),
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
      //
      // THE TERM LIST BELOW IS SIX AND WAS SEVEN, AND ADR-194 IS WHY. It is a
      // TRANSCRIPTION of section 8's own sentence, and the seventh form the
      // contract used to carry, a name fragment, is a pattern the operator
      // composes rather than a value the estate holds: `identities.display_name`
      // is the only name column in the schema, it is a leaderboard handle that
      // INV-M11-10 says is not a legal name, and no legal name is stored
      // anywhere. `admin-reads.test.ts` binds this message to that sentence, so
      // neither half can be narrowed alone.
      //
      // WHAT THIS DOES NOT DO IS CHECK THE FORM OF THE TERM, and that is ADR-194
      // clause 4 rather than an omission. Whether a term names a subject is a
      // question only a lookup answers: `jo` is a legitimate exact coupon code.
      // The refusal lives in the ADAPTER, which reads by equality and by nothing
      // else, and a route-side pattern check would be a second answer that can
      // be reordered away.
      const raw = queryParam(request, 'query');
      const query = raw === null ? '' : raw.trim();
      if (query === '')
        errors.push({
          path: 'query',
          message:
            'must name an exact subject: an account id, platform ref, email, identity id, ' +
            'coupon, or payout id',
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
      // THE ORDER IS THE POINT AND EACH STEP DEPENDS ON THE ONE ABOVE IT. The
      // allowlist runs first, so the licence and the walk read a response whose
      // sections are the contract's; `accountDetailLicence` checks the root
      // against the path before it licenses anything; the walk gates what the
      // licence does not admit; and the wire control asserts the property over
      // whatever the body actually became, which is ADR-184 ruling 3's own
      // last sentence.
      const projected = projectAccountDetail(detail);
      const withheld = withholdAccountDetail(projected, accountDetailLicence(projected, accountId));
      assertNothingWithheldOnTheWire(withheld.detail, withheld.withheldValues);
      return withheld.detail;
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
      const errors: AdminFieldError[] = [];

      const rawReason = queryParam(request, 'reason');
      const reason = rawReason === null ? '' : rawReason.trim();
      if (reason === '')
        errors.push({
          path: 'reason',
          message: 'is required and must not be blank: an unexplained export is unauditable',
        });

      // Section 8, ADR-166: "?reason= and ?audience= are both required ... there
      // is no default".
      //
      // THE ABSENT CASE AND THE UNRECOGNISED CASE ARE BOTH REFUSED AND NEITHER
      // FALLS BACK. An audience this route invented would be the disclosure
      // decision made by the process rather than by the operator, which is
      // exactly what AS-M6-01 and `0008_risk.sql`'s header put in the schema.
      // The narrowest possible default, `trader`, is the one that would look
      // safest and it is still refused: a pack silently narrowed is a pack
      // somebody hands to counsel believing it is complete.
      const rawAudience = queryParam(request, 'audience');
      let audience: EvidencePackAudience | null = null;
      if (rawAudience === null || rawAudience.trim() === '')
        errors.push({
          path: 'audience',
          message:
            'is required: the audience decides what leaves the building and has no default ' +
            `(one of: ${EVIDENCE_PACK_AUDIENCES.join(', ')})`,
        });
      else {
        const trimmed = rawAudience.trim();
        const match = EVIDENCE_PACK_AUDIENCES.find((value) => value === trimmed);
        if (match === undefined)
          errors.push({
            path: 'audience',
            message: `must be one of: ${EVIDENCE_PACK_AUDIENCES.join(', ')}`,
          });
        else audience = match;
      }

      if (errors.length > 0 || audience === null)
        return adminValidationFailed(reply, request.id, errors);

      const pack = await source.exportEvidence({ accountId, reason, audience, actor: principal });
      if (pack === null) return adminNotFound(reply, request.id);
      return projectEvidencePack(pack, audience);
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
