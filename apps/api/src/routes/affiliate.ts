// =============================================================================
// apps/api/src/routes/affiliate.ts
// =============================================================================
// API_CONTRACT SECTION 7's FOUR `/affiliate/*` ROWS, AND NOTHING ELSE.
//
//   POST /affiliate/links       issue a tracking link
//   POST /affiliate/creatives   submit a creative for approval (ADR-113)
//   GET  /affiliate/stats       the trader-facing referral panel's whole source
//   GET  /affiliate/statements  the monthly statement list
//
// -----------------------------------------------------------------------------
// THE DISCLOSURE IS NOT PINNED AT SUBMISSION, AND THE FIELD NAMES SAY SO
// -----------------------------------------------------------------------------
// ADR-113 clause 2 is the ruling this module exists to transcribe, and it is a
// ruling AGAINST the plan's own sentence. M08 section 4 reads "Returns the
// current required disclosure text so the affiliate can attach it before
// submitting rather than after being rejected", which reads as though the
// submission pins a disclosure version. IT DOES NOT, AND THE DATABASE SAYS SO:
//
//   affiliate_creatives.disclosure_version_id  uuid NULL REFERENCES tos_versions(id)
//   CONSTRAINT affiliate_creatives_approved_has_disclosure CHECK (
//     status <> 'approved' OR disclosure_version_id IS NOT NULL )
//
// (`0005_affiliate_program.sql`). The constraint binds the disclosure to
// APPROVAL, and the column is nullable at `pending`, so a fresh submission pins
// nothing at all.
//
// SO THE RESPONSE CARRIES TWO SEPARATE FIELDS AND NEVER ONE. `creative` is the
// row as written, with NO disclosure member of any spelling on it, and
// `required_disclosure` is THE DISCLOSURE THE REVIEW WILL REQUIRE, read at
// submission time from the version in force now. A single field would have
// collapsed them and would have been null on every fresh submission, which is
// the shape that makes a client render an empty disclosure box on the one
// screen where the disclosure IS the compliance artifact (NFA I-26-12,
// INV-M8-08). The suite asserts the separation in both directions: that
// `required_disclosure` carries text, and that `creative` carries no key
// matching `disclosure` at all.
//
// -----------------------------------------------------------------------------
// `kind` IS THE SCHEMA'S FIVE MEMBERS AND A SIXTH IS A MIGRATION
// -----------------------------------------------------------------------------
// `0005_affiliate_program.sql`: `kind text NOT NULL CHECK (kind IN ('landing',
// 'video', 'post', 'email', 'other'))`. ADR-113 clause 3 writes it out as a
// union rather than as `string`, on section 5's own `psp` precedent: a closed
// CHECK list that reaches the wire as `string` is a contract that admits a
// value the database refuses, and the refusal then arrives as a 500 from a
// constraint instead of as a 400 from a validator.
//
// THE SUITE READS THE FIVE OUT OF THE MIGRATION RATHER THAN OUT OF THIS FILE.
// A test that compared this union against a copy of itself would assert that a
// transcription equals its own transcription; the migration is the source, so
// the migration is what is parsed.
//
// -----------------------------------------------------------------------------
// THE OPERATOR HALF IS NOT HERE AND ITS ABSENCE IS ADR-113 CLAUSE 5
// -----------------------------------------------------------------------------
// Approve, reject, and M08 section 3.3's automatic withdrawal when a disclosure
// version is superseded are OPERATOR acts on the admin origin. They cannot be
// written from this surface at all, and the constraint rather than the taste is
// what settles it: `affiliate_creatives_decision_has_author` requires
// `reviewed_by` and `reviewed_at` on both decided states, and no trader session
// has either. The admin origin is where those rows go and they are not this
// module's.
//
// -----------------------------------------------------------------------------
// THREE FINDINGS THIS MODULE REPORTS AND DOES NOT REPAIR
// -----------------------------------------------------------------------------
// 1. `affiliate_commissions` AND `affiliate_statements` ARE UNREACHABLE THROUGH
//    THE SCOPED ACCESSOR, WHICH IS WHAT `GET /affiliate/stats` AND
//    `GET /affiliate/statements` ARE READS OF.
//
//    `affiliate_commissions` is unregistered in `packages/db/src/scope.ts`, and
//    that file states why in its own words: its only path to an identity is
//    `attribution_id uuid NOT NULL REFERENCES attributions(id)`, `attributions`
//    is registered `pair`, and a derivation through a `pair` parent COMPILES and
//    then throws, because `scopePredicate` recurses into the via table and a
//    chain terminates at `owned` or at `root` or it does not terminate.
//    `affiliate_statements` is absent one step earlier: it is not in
//    `packages/db/src/schema.ts` at all, so it is not a `TableKey` and no rule
//    of any class can name it.
//
//    Every money figure on `AffiliateStats` (`earned_cents_lifetime`,
//    `payable_cents`, `paid_cents_lifetime`) is a sum over
//    `affiliate_commissions`, and `conversions_30d` is a count over
//    `attributions`. So TWO OF THE FOUR ENDPOINTS BELOW CANNOT BE SERVED BY THE
//    ACCESSOR AS IT STANDS. Nothing here registers a table to make a route
//    possible: registering `affiliate_commissions` needs a ruling about what a
//    row derived from a two-party row belongs to, and ADR-106 does not make it.
//    The port fails closed and its message names the obstruction, which is the
//    honest shape available today.
//
// 2. `POST /affiliate/links` HAS NO TABLE, AND `affiliate_clicks` IS NOT IT.
//    `affiliate_clicks` is the only table in this schema carrying a
//    `click_token`, and it is a record of a CLICK: `clicked_at timestamptz NOT
//    NULL DEFAULT now()`, and `affiliate_clicks_affiliate_time_idx` is what
//    `clicks_30d` is counted over. Writing a row at link-issue time would put a
//    click nobody made into that count, inflate the denominator AS-M8-03's
//    cookie-stuffing arithmetic is read from, and do it once per press of the
//    button. So this route mints no click, and where an issued link is persisted
//    is a seam rather than a write.
//
// 3. `campaign` REACHES NO COLUMN. `CreateLinkRequest` carries an optional
//    `campaign` and no table in this schema has one: `grep -n campaign` over
//    `packages/db/migrations` returns three lines and all three are prose in
//    `0025_reserved_sequence.sql`. It is validated here and passed to the port,
//    and where it lands is the same seam as finding 2.
//
// -----------------------------------------------------------------------------
// A FOURTH THING, SMALLER, RECORDED WHERE A READER WILL LOOK FOR IT
// -----------------------------------------------------------------------------
// `affiliate_statements.status` is `CHECK (status IN ('draft', 'issued',
// 'paid', 'void'))` and INV-M8-12 requires a restricted affiliate's statement to
// be HELD rather than voided. There is no `held` member, so a held statement is
// an `issued` one that was not settled, and the wire cannot tell an affiliate
// which of the two they are looking at. That is a gap in the operator half
// rather than in this route, and it is named here rather than discovered by the
// affiliate who asks why they were not paid.
//
// -----------------------------------------------------------------------------
// EVERY READ AND WRITE IS A PORT, AND THE DEPLOYMENT ANSWERS 503
// -----------------------------------------------------------------------------
// `routes/kyc.ts`'s shape exactly, for its reason exactly: a backend that
// returned plausible values would be a fixture serving real traffic, and on
// this surface the plausible values are MONEY. Commission is money, so a stats
// response invented by a default would be a firm telling an affiliate what they
// are owed out of a fake. The default therefore fails closed on every method
// and the suite injects its own.
// =============================================================================

import type { FastifyReply } from 'fastify';

import { defineRoutes } from '../registry.ts';
import { PROBLEM_MEDIA_TYPE, problem } from '../server.ts';
import {
  requiredFactorTable,
  toRoutes,
  withSessionContext,
  type AuthedContext,
  type AuthSession,
  type EndpointSpec,
  type FieldError,
} from './auth.ts';

/** API_CONTRACT section 7's rows, as the contract writes them. No base path. */
export const AFFILIATE_LINKS_PATH = '/affiliate/links';
export const AFFILIATE_CREATIVES_PATH = '/affiliate/creatives';
export const AFFILIATE_STATS_PATH = '/affiliate/stats';
export const AFFILIATE_STATEMENTS_PATH = '/affiliate/statements';

// -----------------------------------------------------------------------------
// The vocabularies, every one of them a CHECK list transcribed
// -----------------------------------------------------------------------------

/**
 * `affiliate_creatives.kind`'s CHECK list, closed by the schema.
 *
 * `0005_affiliate_program.sql`: `CHECK (kind IN ('landing', 'video', 'post',
 * 'email', 'other'))`. ADR-113 clause 3. A sixth member is a migration before it
 * is a contract change, and the suite reads these five out of that file rather
 * than out of this one.
 */
export type CreativeKind = 'landing' | 'video' | 'post' | 'email' | 'other';

/** {@link CreativeKind} as data, which is what the validator tests against. */
export const CREATIVE_KINDS = [
  'landing',
  'video',
  'post',
  'email',
  'other',
] as const satisfies readonly CreativeKind[];

/**
 * `affiliate_creatives.status`'s CHECK list.
 *
 * DECLARED IN FULL AND USED IN ONE ARM. A submission is `pending` and the
 * response types it as that literal, because `status DEFAULT 'pending'` is what
 * the database writes and a wider type here would let a later edit return an
 * `approved` creative from the endpoint that cannot produce one. The other three
 * members exist so the operator half, when it is written, transcribes this list
 * rather than a second copy of it.
 */
export type CreativeStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

/** `affiliates.status`'s CHECK list (`0005_affiliate_program.sql`). */
export type AffiliateStatus = 'active' | 'suspended' | 'closed';

/**
 * `affiliate_statements.status`'s CHECK list
 * (`0012_disputes_and_affiliate_settlement.sql`).
 *
 * FOUR MEMBERS AND NO `held`, which is the header's fourth finding. INV-M8-12
 * holds a restricted affiliate's statement rather than voiding it, and the state
 * that encodes is `issued` and unsettled.
 */
export type StatementStatus = 'draft' | 'issued' | 'paid' | 'void';

// -----------------------------------------------------------------------------
// The response shapes, transcribed from API_CONTRACT section 7
// -----------------------------------------------------------------------------

/**
 * Section 7's `AffiliateStats`, field for field.
 *
 * EVERY MONEY FIELD IS INTEGER CENTS AND EVERY RATIO IS BASIS POINTS, and this
 * module performs no arithmetic on any of them. `payable_cents` is NOT
 * `earned_cents_lifetime` minus `paid_cents_lifetime`: M08 puts a clawback
 * window between the three, so they are three independent server answers and the
 * subtraction that looks like it reconciles them is wrong as well as forbidden.
 * `apps/portal/src/view/referrals.ts` refuses the same arithmetic on the other
 * side of the wire, and this is the half that makes that refusal cheap.
 */
export interface AffiliateStats {
  /** `affiliates.code`. The address a click is attributed to. */
  readonly code: string;
  readonly commission_bp: number;
  readonly status: AffiliateStatus;
  readonly clicks_30d: number;
  readonly conversions_30d: number;
  readonly earned_cents_lifetime: number;
  readonly payable_cents: number;
  readonly paid_cents_lifetime: number;
  readonly chargeback_rate_bp: number;
}

/**
 * The disclosure the review WILL require. ADR-113 clause 2.
 *
 * IT IS A `tos_versions` ROW AND NOT FREE TEXT.
 * `affiliate_creatives.disclosure_version_id` references that table, so what an
 * affiliate is shown here is quotable at review time and in 2027 rather than a
 * string somebody typed. `version` is the published version label and
 * `tos_version_id` is the row, so a client can render the text and cite what it
 * rendered.
 */
export interface RequiredDisclosure {
  readonly tos_version_id: string;
  readonly version: string;
  readonly text: string;
}

/**
 * The creative as written, at `pending`, WITH NO DISCLOSURE FIELD.
 *
 * There is deliberately no member of any spelling here for
 * `disclosure_version_id`, and that is ADR-113 clause 2 expressed as a type
 * rather than as a comment: the column is null on this row, and a field carrying
 * a null would be read as a pin that happened to be empty.
 */
export interface SubmittedCreative {
  readonly creative_id: string;
  readonly kind: CreativeKind;
  readonly url_or_ref: string;
  readonly status: 'pending';
  readonly submitted_at: string;
}

/** Section 7's `CreateCreativeResponse`. Two fields, and they are two facts. */
export interface CreateCreativeResponse {
  readonly creative: SubmittedCreative;
  readonly required_disclosure: RequiredDisclosure;
}

/** Section 7's `CreateCreativeRequest`, after validation. */
export interface CreateCreativeRequest {
  readonly kind: CreativeKind;
  readonly url_or_ref: string;
  readonly notes?: string;
}

/** Section 7's `CreateLinkRequest`, after validation. */
export interface CreateLinkRequest {
  /** A site-relative path, and the validator refuses anything else. */
  readonly landing_path: string;
  /** Optional, and it reaches no column. See the header's finding 3. */
  readonly campaign?: string;
}

/** Section 7's `CreateLinkResponse`. */
export interface CreateLinkResponse {
  readonly url: string;
  readonly click_token: string;
}

/**
 * One row of `GET /affiliate/statements`.
 *
 * `period_start` AND `period_end` ARE CALENDAR DATES AND NOT TRADING DAYS.
 * API_CONTRACT section 1 reserves `*_day` and `*_on` for exchange trading days;
 * a statement period is a calendar month (`affiliate_statements_period_uq` is
 * unique on `(affiliate_id, period_start)`), so these carry neither suffix.
 *
 * `total_cents` IS SIGNED. `0012`'s own comment: "signed: a clawback-heavy month
 * is negative". A client that renders it unsigned tells an affiliate they earned
 * money in a month they owed it.
 */
export interface StatementListItem {
  readonly statement_id: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly total_cents: number;
  readonly status: StatementStatus;
  /**
   * Section 7: "a signed download URL".
   *
   * MINTED BY THE BACKEND AND NEVER BY THIS ROUTE. A signature this module
   * produced would be this module holding a key, and the URL names a storage
   * origin ADR-012 keeps out of this repository.
   */
  readonly download_url: string;
}

/** Section 1's pagination envelope: `{ data, next_cursor }`, cursor only. */
export interface StatementPage {
  readonly data: readonly StatementListItem[];
  readonly next_cursor: string | null;
}

/** Section 1's page request, after validation. `limit` max 100, default 25. */
export interface PageRequest {
  readonly limit: number;
  readonly cursor: string | null;
}

/** Section 1's stated default and maximum. Both are the contract's numbers. */
export const PAGE_LIMIT_DEFAULT = 25;
export const PAGE_LIMIT_MAX = 100;

// -----------------------------------------------------------------------------
// The port
// -----------------------------------------------------------------------------

/**
 * The caller's own `affiliates` row, projected to what this surface needs.
 *
 * `null` FROM `affiliate` BELOW IS "NOT AN AFFILIATE" AND IT IS THE ONLY THING
 * THAT PRODUCES A 403 HERE. `affiliates.identity_id` is `NOT NULL REFERENCES
 * identities(id)`, so "is this caller an affiliate" is a scoped read of one
 * table and never an inference from a claim on the request.
 */
export interface AffiliateRef {
  readonly affiliateId: string;
  readonly code: string;
  readonly status: AffiliateStatus;
}

/** What `POST /affiliate/creatives` asks the backend to write. */
export interface CreativeDraft {
  readonly kind: CreativeKind;
  readonly urlOrRef: string;
  readonly notes: string | null;
  /**
   * The `Idempotency-Key` header, or null.
   *
   * CARRIED ON THE DRAFT AND REPLAYED BY NOTHING IN THIS TREE. Section 1 makes
   * the header ACCEPTED here rather than required, and no route in `apps/api`
   * wires `IdempotencyStore` yet (see `idempotency-store.ts`'s own header). What
   * actually bounds a duplicate submission today is the `duplicate` arm below,
   * which is the contract's own `conflict` row and is the better bound for this
   * endpoint: it refuses a second open submission for the same asset whether or
   * not the client remembered to send a key.
   */
  readonly idempotencyKey: string | null;
}

/**
 * What the backend did with a draft.
 *
 * A UNION RATHER THAN A THROWN ERROR, because `conflict` is a contract row and
 * not a defect: section 7's error list names it for "this affiliate already has
 * an open submission for the same `url_or_ref`", and a caller resubmitting an
 * asset that is already in the queue is doing something ordinary.
 */
export type CreativeSubmission =
  | { readonly outcome: 'created'; readonly creative: SubmittedCreative }
  | { readonly outcome: 'duplicate' };

/**
 * Everything this surface needs from a database, and no seventh method.
 *
 * `issueLink` MINTS BOTH HALVES AND THE ROUTE COMPOSES NEITHER. The URL's shape
 * is a protocol between whatever issues a link and whatever records the click
 * that follows it, and this tree has the first half and not the second: no
 * handler anywhere reads a click token off a request. A route that invented the
 * query-parameter spelling would be writing half a protocol whose other half
 * nobody has written, and the affiliate would carry the broken link.
 *
 * `requiredDisclosure` IS ITS OWN METHOD AND NOT A FIELD ON THE SUBMISSION,
 * which is ADR-113 clause 2 arriving at the port. The disclosure in force is a
 * read of `tos_versions` and the submission is a write of `affiliate_creatives`;
 * folding them into one method would put the version that WILL be required into
 * the same value as the row that pins nothing.
 */
export interface AffiliateBackend {
  /** The caller's affiliate row, or `null` when the caller is not one. */
  affiliate(session: AuthSession): Promise<AffiliateRef | null>;
  stats(session: AuthSession, ref: AffiliateRef): Promise<AffiliateStats>;
  statements(session: AuthSession, ref: AffiliateRef, page: PageRequest): Promise<StatementPage>;
  issueLink(
    session: AuthSession,
    ref: AffiliateRef,
    request: CreateLinkRequest,
  ): Promise<CreateLinkResponse>;
  requiredDisclosure(session: AuthSession, ref: AffiliateRef): Promise<RequiredDisclosure>;
  submitCreative(
    session: AuthSession,
    ref: AffiliateRef,
    draft: CreativeDraft,
  ): Promise<CreativeSubmission>;
}

/**
 * Thrown by the default backend. Answered as 503 rather than 500.
 *
 * THE MESSAGE NAMES THE OBSTRUCTION PER METHOD rather than saying "not wired",
 * because two of these methods are unwired for a reason a later session must not
 * have to rediscover: the tables they read are unreachable through the accessor,
 * and no amount of adapter writing changes that.
 */
export class AffiliateBackendUnwired extends Error {
  constructor(method: string, because: string) {
    super(`AffiliateBackend.${method} is not wired. ${because}`);
    this.name = 'AffiliateBackendUnwired';
  }
}

function unwired(method: string, because: string): () => Promise<never> {
  return () => Promise.reject(new AffiliateBackendUnwired(method, because));
}

/** The scoped door is available for these. `affiliates` is registered `owned`. */
const AFFILIATES_READABLE =
  '`affiliates` is scope class `owned` on `identity_id`, so this read has a door and no ' +
  'adapter has been written for it yet.';

/** The header's finding 1, in the place a caller will actually meet it. */
const COMMISSIONS_UNREACHABLE =
  'Its figures are sums over `affiliate_commissions`, which is UNREGISTERED in ' +
  '`packages/db/src/scope.ts`: its only path to an identity is `attribution_id`, `attributions` ' +
  'is registered `pair`, and a derivation through a `pair` parent throws rather than resolving. ' +
  'Registering it needs a ruling about what a row derived from a two-party row belongs to, and ' +
  'ADR-106 does not make one.';

const STATEMENTS_UNREACHABLE =
  '`affiliate_statements` is not in `packages/db/src/schema.ts` at all, so it is not a ' +
  '`TableKey` and no scope rule of any class can name it. It is one registration short of the ' +
  'position `affiliate_commissions` is in.';

const LINK_HAS_NO_TABLE =
  'No table in this schema records an ISSUED link. `affiliate_clicks` is the only carrier of a ' +
  '`click_token` and its rows are CLICKS, counted by `clicks_30d`, so minting one here would be ' +
  'a click nobody made.';

/** The default, and it fails CLOSED on every method. */
export const UNWIRED_AFFILIATE_BACKEND: AffiliateBackend = {
  affiliate: unwired('affiliate', AFFILIATES_READABLE),
  stats: unwired('stats', COMMISSIONS_UNREACHABLE),
  statements: unwired('statements', STATEMENTS_UNREACHABLE),
  issueLink: unwired('issueLink', LINK_HAS_NO_TABLE),
  requiredDisclosure: unwired('requiredDisclosure', AFFILIATES_READABLE),
  submitCreative: unwired('submitCreative', AFFILIATES_READABLE),
};

/** Everything this module reaches the world through. All of it injected. */
export interface AffiliateDeps {
  readonly backend: AffiliateBackend;
}

/**
 * The deployment's dependencies, which today resolve nothing.
 *
 * Stated as code rather than as a comment, for `routes/kyc.ts`'s reason: a
 * comment saying "not wired yet" beside a handler that would happily run a fake
 * is how a fake ships, and here the fake would be quoting money.
 */
export const productionAffiliateDeps: AffiliateDeps = { backend: UNWIRED_AFFILIATE_BACKEND };

let deps: AffiliateDeps = productionAffiliateDeps;

/** Install the dependencies. A wiring slice calls this; so does the suite. */
export function useAffiliateDeps(next: AffiliateDeps): void {
  deps = next;
}

/** Restore the fail-closed default. */
export function resetAffiliateDeps(): void {
  deps = productionAffiliateDeps;
}

/** The installed dependencies. */
export function currentAffiliateDeps(): AffiliateDeps {
  return deps;
}

// -----------------------------------------------------------------------------
// Problem documents, in the contract's shape
// -----------------------------------------------------------------------------

/**
 * Section 2's document, with the two members `server.ts`'s `Problem` omits.
 *
 * `required_factor` IS ABSENT FROM THIS SHAPE ON PURPOSE. It is section 12's
 * extension member for a 403 that a client can answer by offering a factor, and
 * the only 403 this module produces cannot be answered that way. See
 * {@link sendNotAffiliate}.
 */
interface ProblemBody {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly instance: string;
  readonly detail?: string;
  readonly errors?: readonly FieldError[];
}

function sendProblem(reply: FastifyReply, body: ProblemBody): FastifyReply {
  return reply.code(body.status).type(PROBLEM_MEDIA_TYPE).send(body);
}

function sendValidationFailed(
  reply: FastifyReply,
  requestId: string,
  errors: readonly FieldError[],
): FastifyReply {
  return sendProblem(reply, { ...problem('validation_failed', 400, requestId), errors });
}

/**
 * Section 7's `forbidden`: "the caller is not an affiliate".
 *
 * IT CARRIES NO `required_factor` AND THAT IS DELIBERATE. Section 12 requires
 * the extension member so "the client can offer" the factor, and there is no
 * factor a caller could offer that would make them an affiliate. A 403 naming
 * `session` beside a session that already exists tells a client to retry what it
 * already did.
 *
 * IT IS 403 AND NOT 404, on the contract's own row. Section 1 makes 404 the
 * trader-surface answer for "a PATH PARAMETER naming a resource the caller does
 * not own", and none of these four paths carries one: the resource is the
 * caller's own affiliate row, whose non-existence is not somebody else's secret.
 * Section 7 names `forbidden` for exactly this case.
 */
function sendNotAffiliate(reply: FastifyReply, requestId: string): FastifyReply {
  return sendProblem(reply, {
    ...problem('forbidden', 403, requestId),
    detail: 'This identity is not an affiliate.',
  });
}

/** Section 2's `conflict`, with a `detail` naming which state. */
function sendConflict(reply: FastifyReply, requestId: string, detail: string): FastifyReply {
  return sendProblem(reply, { ...problem('conflict', 409, requestId), detail });
}

/** Section 2's 503, for a dependency that is not there. */
function sendUnavailable(reply: FastifyReply, requestId: string): FastifyReply {
  return sendProblem(reply, {
    ...problem('service_unavailable', 503, requestId),
    title: 'Service unavailable',
  });
}

/**
 * Turn the fail-closed backend's refusal into a 503, once, for every endpoint.
 *
 * `endpointHandler` in `auth.ts` does this for `AuthBackendUnwired` and knows
 * nothing about this module's port, which is right: a route module that declares
 * its own port declares its own unwired answer. Without it the framework reports
 * 500, which says "this process is broken" about a deployment that is merely not
 * finished.
 */
function unavailableWhenUnwired(
  handle: (ctx: AuthedContext) => Promise<unknown>,
): (ctx: AuthedContext) => Promise<unknown> {
  return async (ctx: AuthedContext) => {
    try {
      return await handle(ctx);
    } catch (cause) {
      if (!(cause instanceof AffiliateBackendUnwired)) throw cause;
      ctx.request.log.error({ err: cause }, 'affiliate backend is not wired');
      return sendUnavailable(ctx.reply, ctx.request.id);
    }
  };
}

// -----------------------------------------------------------------------------
// Validators. Total over the shapes section 7 declares, and hand written.
// -----------------------------------------------------------------------------

type Validated<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly FieldError[] };

function asRecord(body: unknown): Record<string, unknown> | null {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** A body that is not an object fails as one error against the document root. */
const NOT_AN_OBJECT: readonly FieldError[] = [{ path: '', message: 'body must be a JSON object' }];

/**
 * Section 7's `CreateCreativeRequest`.
 *
 * `kind` IS CHECKED AGAINST THE FIVE AND THE MESSAGE LISTS THEM. A sixth is a
 * `validation_failed` here rather than a constraint violation three layers down,
 * which is the whole reason ADR-113 clause 3 refused to type it `string`.
 */
export function validateCreateCreativeRequest(body: unknown): Validated<CreateCreativeRequest> {
  const row = asRecord(body);
  if (row === null) return { ok: false, errors: NOT_AN_OBJECT };
  const errors: FieldError[] = [];

  const kind = row['kind'];
  const known = CREATIVE_KINDS.find((member) => member === kind);
  if (known === undefined)
    errors.push({ path: 'kind', message: `must be one of: ${CREATIVE_KINDS.join(', ')}` });

  const urlOrRef = row['url_or_ref'];
  if (!nonEmptyString(urlOrRef))
    errors.push({ path: 'url_or_ref', message: 'must be a non-empty string' });

  // `affiliate_creatives.notes` is `text NULL`, so absent and null are the same
  // fact and both are accepted. A present non-string is not.
  const notes = row['notes'];
  if (notes !== undefined && notes !== null && typeof notes !== 'string')
    errors.push({ path: 'notes', message: 'must be a string when present' });

  if (errors.length > 0 || known === undefined || !nonEmptyString(urlOrRef))
    return { ok: false, errors };

  return {
    ok: true,
    value:
      typeof notes === 'string'
        ? { kind: known, url_or_ref: urlOrRef.trim(), notes }
        : { kind: known, url_or_ref: urlOrRef.trim() },
  };
}

/**
 * Whether a string holds a C0 control character or `DEL`.
 *
 * WRITTEN AS CODE POINTS AND NOT AS A CHARACTER CLASS, because `no-control-regex`
 * refuses the regular expression that would say this and it is right to: the
 * literal is invisible in a diff, so a reviewer cannot see whether the range is
 * the one the author meant. Two comparisons are legible.
 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    if (point < 0x20 || point === 0x7f) return true;
  }
  return false;
}

/**
 * Whether a string is a site-relative path and nothing more.
 *
 * THIS IS THE ONE VALIDATION IN THIS MODULE THAT IS A CONTROL RATHER THAN A
 * SHAPE CHECK. `landing_path` is affiliate-supplied and the response's `url` is
 * built from it, so an affiliate who sends `https://elsewhere.example/x` or the
 * protocol-relative `//elsewhere.example/x` would be handed a Merit-issued
 * tracking link that lands on their own page. That is an open redirect wearing
 * an affiliate's own referral code, and the affiliate program is precisely the
 * population with a motive to build one.
 *
 * A BACKSLASH IS REFUSED BESIDE THE SECOND SLASH. Some clients normalise `/\`
 * to `//` before resolving, so a check reading only `/` would pass the same
 * attack spelled differently.
 */
export function isSiteRelativePath(value: string): boolean {
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//') || value.startsWith('/\\')) return false;
  return !hasControlCharacter(value);
}

/** Section 7's `CreateLinkRequest`. */
export function validateCreateLinkRequest(body: unknown): Validated<CreateLinkRequest> {
  const row = asRecord(body);
  if (row === null) return { ok: false, errors: NOT_AN_OBJECT };
  const errors: FieldError[] = [];

  const landingPath = row['landing_path'];
  if (!nonEmptyString(landingPath))
    errors.push({ path: 'landing_path', message: 'must be a non-empty string' });
  else if (!isSiteRelativePath(landingPath))
    errors.push({
      path: 'landing_path',
      message:
        'must be a site-relative path beginning with a single `/`, and never an absolute or ' +
        'protocol-relative URL',
    });

  const campaign = row['campaign'];
  if (campaign !== undefined && !nonEmptyString(campaign))
    errors.push({ path: 'campaign', message: 'must be a non-empty string when present' });

  if (errors.length > 0 || !nonEmptyString(landingPath)) return { ok: false, errors };

  return {
    ok: true,
    value:
      typeof campaign === 'string'
        ? { landing_path: landingPath, campaign }
        : { landing_path: landingPath },
  };
}

/**
 * Section 1's `?limit=&cursor=`, parsed strictly.
 *
 * `limit` IS PARSED AND NEVER COERCED. `Number('12abc')` is `NaN` and
 * `parseInt('12abc')` is `12`, and neither is what a contract saying "maximum
 * 100" means, so the digits are matched before anything is converted.
 *
 * AN OUT-OF-RANGE LIMIT IS A `validation_failed` RATHER THAN A SILENT CLAMP. A
 * clamp is what makes a client believe it read a hundred rows when it read
 * twenty-five, and on a statement list the client that believes that is the one
 * that stops paginating and shows an affiliate three quarters of their history.
 */
export function validatePageRequest(query: unknown): Validated<PageRequest> {
  const row = asRecord(query) ?? {};
  const errors: FieldError[] = [];

  const rawLimit = row['limit'];
  let limit = PAGE_LIMIT_DEFAULT;
  if (rawLimit !== undefined) {
    if (typeof rawLimit !== 'string' || !/^[0-9]+$/.test(rawLimit))
      errors.push({ path: 'limit', message: 'must be a whole number' });
    else {
      limit = Number(rawLimit);
      if (limit < 1 || limit > PAGE_LIMIT_MAX)
        errors.push({ path: 'limit', message: `must be between 1 and ${PAGE_LIMIT_MAX}` });
    }
  }

  const rawCursor = row['cursor'];
  if (rawCursor !== undefined && !nonEmptyString(rawCursor))
    errors.push({ path: 'cursor', message: 'must be a non-empty opaque string when present' });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { limit, cursor: nonEmptyString(rawCursor) ? rawCursor : null } };
}

// -----------------------------------------------------------------------------
// The allowlists. API_CONTRACT section 1's API3 control.
// -----------------------------------------------------------------------------

/**
 * Every field section 7's `AffiliateStats` declares, named.
 *
 * IT IS A COPY AND THAT IS THE POINT, on `routes/me.ts`'s own argument: a spread
 * would be one character shorter and would be the `SELECT *` section 1 forbids.
 * Here it carries a second property besides, because the row behind it is read
 * from `affiliates`: that table holds `balance_cents` and
 * `negative_balance_since`, which are the firm's collections position on this
 * human, and there is no line below that could emit either.
 */
function projectStats(stats: AffiliateStats): AffiliateStats {
  return {
    code: stats.code,
    commission_bp: stats.commission_bp,
    status: stats.status,
    clicks_30d: stats.clicks_30d,
    conversions_30d: stats.conversions_30d,
    earned_cents_lifetime: stats.earned_cents_lifetime,
    payable_cents: stats.payable_cents,
    paid_cents_lifetime: stats.paid_cents_lifetime,
    chargeback_rate_bp: stats.chargeback_rate_bp,
  };
}

/**
 * Every field a statement row declares, named.
 *
 * `paid_transfer_ref` IS ON THE TABLE AND IS NOT HERE. It is the rail's own
 * reference for the transfer that settled a statement, and a trader surface that
 * emitted it would put a payment-processor identifier on a page an affiliate can
 * screenshot. The allowlist is what keeps it off.
 */
function projectStatement(item: StatementListItem): StatementListItem {
  return {
    statement_id: item.statement_id,
    period_start: item.period_start,
    period_end: item.period_end,
    total_cents: item.total_cents,
    status: item.status,
    download_url: item.download_url,
  };
}

// -----------------------------------------------------------------------------
// The endpoints
// -----------------------------------------------------------------------------

/** The `Idempotency-Key` header, or null. Section 1 makes it ACCEPTED here. */
function suppliedKey(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): string | null {
  const value = headers['idempotency-key'];
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Resolve the caller's affiliate row, or answer 403.
 *
 * EVERY ONE OF THE FOUR ENDPOINTS STARTS HERE, so "is this caller an affiliate"
 * is decided once and in the same way on a read and on a write. A handler that
 * checked it itself is a handler that could forget to.
 *
 * IT RUNS BEFORE THE BODY IS VALIDATED, which is the order the contract's two
 * codes imply: a caller who is not an affiliate is told that, rather than being
 * told which field of a request they were never allowed to make is malformed.
 */
async function withAffiliate(
  ctx: AuthedContext & { readonly session: AuthSession },
  handle: (ref: AffiliateRef) => Promise<unknown>,
): Promise<unknown> {
  const { backend } = currentAffiliateDeps();
  const ref = await backend.affiliate(ctx.session);
  if (ref === null) return sendNotAffiliate(ctx.reply, ctx.request.id);
  return handle(ref);
}

/**
 * All four rows declare `session`, and none is a `C-27:` row.
 *
 * ADR-113 clause 4 rules that for the creative submission and the argument
 * covers the other three unchanged: C-27's sensitive actions are payout
 * destination change, contact change and external withdrawal. Issuing a tracking
 * link, putting a document in front of a reviewer, and reading two panels are
 * none of them. A factor requirement invented here would be a fourth sensitive
 * action added without the ruling that creates one.
 *
 * `GET /affiliate/statements` IS THE ROW WORTH SAYING THIS ABOUT OUT LOUD, since
 * it is money and a reader may expect elevation for it. It is a READ, and M04
 * section 3.7's boundary argument applies: requiring a passkey to look at what
 * you were paid makes the statement unreadable to the affiliate who most needs
 * to read it, and the payment itself is guarded where payments are.
 *
 * NEITHER POST SETS A STATUS CODE. Section 7 states none for either row, and
 * `POST /kyc/session` sets none while creating a verification; the two rows that
 * DO carry a code in this tree carry it because the contract wrote one down.
 */
export const AFFILIATE_ENDPOINTS: readonly EndpointSpec[] = [
  {
    method: 'POST',
    path: AFFILIATE_LINKS_PATH,
    required: 'session',
    handle: unavailableWhenUnwired(
      withSessionContext((ctx) =>
        withAffiliate(ctx, async (ref) => {
          const { request, reply, session } = ctx;
          const parsed = validateCreateLinkRequest(request.body);
          if (!parsed.ok) return sendValidationFailed(reply, request.id, parsed.errors);
          const { backend } = currentAffiliateDeps();
          const issued = await backend.issueLink(session, ref, parsed.value);
          // The allowlist, at arity two.
          const body: CreateLinkResponse = { url: issued.url, click_token: issued.click_token };
          return body;
        }),
      ),
    ),
  },
  {
    method: 'POST',
    path: AFFILIATE_CREATIVES_PATH,
    required: 'session',
    handle: unavailableWhenUnwired(
      withSessionContext((ctx) =>
        withAffiliate(ctx, async (ref) => {
          const { request, reply, session } = ctx;
          const parsed = validateCreateCreativeRequest(request.body);
          if (!parsed.ok) return sendValidationFailed(reply, request.id, parsed.errors);
          const { backend } = currentAffiliateDeps();

          const submission = await backend.submitCreative(session, ref, {
            kind: parsed.value.kind,
            urlOrRef: parsed.value.url_or_ref,
            notes: parsed.value.notes ?? null,
            idempotencyKey: suppliedKey(request.headers),
          });
          if (submission.outcome === 'duplicate')
            return sendConflict(
              reply,
              request.id,
              'This affiliate already has an open submission for the same asset. The one in ' +
                'the queue is the one under review.',
            );

          // THE DISCLOSURE IS READ AFTER THE ROW IS WRITTEN AND IS NOT ATTACHED
          // TO IT. ADR-113 clause 2. Reading it first would be no more correct
          // and would read, at the call site, like a value being prepared for
          // the insert.
          const required = await backend.requiredDisclosure(session, ref);

          const body: CreateCreativeResponse = {
            creative: {
              creative_id: submission.creative.creative_id,
              kind: submission.creative.kind,
              url_or_ref: submission.creative.url_or_ref,
              // The literal, not the port's value: `status DEFAULT 'pending'` is
              // what the database wrote, and this endpoint cannot produce another.
              status: 'pending',
              submitted_at: submission.creative.submitted_at,
            },
            required_disclosure: {
              tos_version_id: required.tos_version_id,
              version: required.version,
              text: required.text,
            },
          };
          return body;
        }),
      ),
    ),
  },
  {
    method: 'GET',
    path: AFFILIATE_STATS_PATH,
    required: 'session',
    handle: unavailableWhenUnwired(
      withSessionContext((ctx) =>
        withAffiliate(ctx, async (ref) => {
          const { backend } = currentAffiliateDeps();
          return projectStats(await backend.stats(ctx.session, ref));
        }),
      ),
    ),
  },
  {
    method: 'GET',
    path: AFFILIATE_STATEMENTS_PATH,
    required: 'session',
    handle: unavailableWhenUnwired(
      withSessionContext((ctx) =>
        withAffiliate(ctx, async (ref) => {
          const { request, reply, session } = ctx;
          const parsed = validatePageRequest(request.query);
          if (!parsed.ok) return sendValidationFailed(reply, request.id, parsed.errors);
          const { backend } = currentAffiliateDeps();
          const page = await backend.statements(session, ref, parsed.value);
          const body: StatementPage = {
            data: page.data.map(projectStatement),
            next_cursor: page.next_cursor,
          };
          return body;
        }),
      ),
    ),
  },
];

/** The declaration as data, on `auth.ts`'s shape. `CI-06k` reads its document. */
export const AFFILIATE_REQUIRED_FACTORS = requiredFactorTable(AFFILIATE_ENDPOINTS);

export default defineRoutes({
  name: 'affiliate',
  routes: toRoutes(AFFILIATE_ENDPOINTS),
});
