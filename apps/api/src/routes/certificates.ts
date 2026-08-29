// =============================================================================
// apps/api/src/routes/certificates.ts
// =============================================================================
// API_CONTRACT SECTION 6.3's TWO ROWS, AND NOTHING ELSE.
//
//   GET /certificates                    session, the caller's own list
//   GET /certificates/:code/image.png     PUBLIC, UNAUTHENTICATED, image/png
//
// ADR-168 admitted both rows into the contract and deliberately built neither:
// its section 3 item 8 forecloses "building any of this" and says the rows are
// "the specification a later slice transcribes". This file is that
// transcription. It takes NO ADR number and NO migration number, because every
// decision below is already ruled and the ones that are not are reported rather
// than taken.
//
// -----------------------------------------------------------------------------
// THE `.png` IS THE FIRST NON-JSON SUCCESS RESPONSE IN THIS CONTRACT, AND WHAT
// THAT COSTS IS STATED HERE RATHER THAN DISCOVERED BY THE NEXT READER
// -----------------------------------------------------------------------------
// API_CONTRACT section 1 opens with "Content type `application/json` for
// requests and successful responses", and every convention after it presumes a
// JSON body: the allowlist ("responses list fields explicitly, never `SELECT *`
// serialized"), the `{ data, next_cursor }` envelope, the `*_cents` integer
// rule, the `*_at` and `*_day` spellings. Section 6.3 states the exception in
// its own words: "Success response: `image/png` bytes, and this is the first
// row in this contract whose successful response is not `application/json`".
//
// FOUR OF SECTION 1'S CONVENTIONS SURVIVE UNCHANGED ON THAT ROW and they are
// the four that are not about a body:
//
//   1. THE ERROR MODEL. Section 6.3: "Errors keep `application/problem+json`".
//      A failed fetch is a problem document exactly as everywhere else, so the
//      only response on this path that is not JSON is a 200.
//   2. THE BASE PATH. `/api/v1`, from `surface.ts`, one string in one place.
//   3. THE SURFACE PARTITION. `classifyPath` reads the path and answers
//      `public`, so `compose` registers this row on the `api` deployment and
//      WITHHOLDS it from `api-admin`. That withholding is what produces the
//      operator 404, and it is the router's rather than a check's (ADR-083).
//   4. THE RATE LIMIT, which section 11 gives this row its own line for.
//
// ONE OF THEM CANNOT SURVIVE, AND IT IS THE ONE THAT MATTERS MOST HERE. The
// response-shape allowlist is a projection function over named fields, and
// nothing chooses fields inside a PNG. So on this row the disclosure boundary
// is NOT in this file: it is in the renderer, which is not in this repository.
// What this file can hold, and does, is the boundary either side of the bytes:
// which rows render at all, what the headers carry, and that the body is
// exactly the bytes it was handed and not one byte more. `certificates.test.ts`
// asserts the negative on the list endpoint's JSON in full and on this one's
// METADATA only, and says so, because a suite that claimed to have checked the
// pixels would be claiming a control that does not exist.
//
// THE EXTENSION IS PART OF THE PATH AND IS NOT DECORATION. M11 section 4 and
// `apps/portal/src/app/(purchases)/model.ts` both carry it, an earlier draft
// dropped it, and ADR-168 finding 5 records the correction: "a path written
// without it would not be the path M11 approved". `classifyPath` treats it as
// an ordinary path segment, so nothing about routing depends on it; what
// depends on it is that a client already written against M11 resolves.
//
// -----------------------------------------------------------------------------
// WHAT A HELD CODE DISCLOSES. RULED IN ADR-168 CLAUSE 2, IMPLEMENTED HERE, NOT
// RE-DECIDED HERE
// -----------------------------------------------------------------------------
// API_CONTRACT section 6.3: a code "leaks the claim and the state", the claim is
// bounded by `INV-M11-01` to "the account's plan, size, trading day and the
// kind-specific value, plus the simulated-environment disclosure `INV-M11-04`
// renders by template", and "it carries NO IDENTITY, NO EMAIL, NO DISPLAY NAME,
// NO CUMULATIVE TOTAL AND NO LIFETIME FIGURE, so a held code names a result and
// does not name a person".
//
// THE ENFORCEMENT OF THAT SENTENCE IS `narrowClaims` BELOW AND IT IS AN
// ALLOWLIST OVER A `jsonb` COLUMN, which is the one place in this file where
// getting it wrong is silent. `certificates.claims` is `jsonb NOT NULL` and the
// database constrains NOTHING about its keys, so a spread of the stored object
// into the response would ship whatever an issuer ever wrote into it, forever,
// and would type-check. Four keys are read by name and every other key of that
// object is dropped without being looked at.
//
// `revoked_reason` IS NOT ON THE ROW TYPE AT ALL, which is stronger than an
// allowlist that merely declines to mention it. `certificates` types it
// "INTERNAL free text" and `certificates_revocation_is_complete` writes it in
// the same statement as `revocation_class`, so a handler holding one holds the
// other and the only thing standing between the internal half and a public
// surface is what the projection names. `CertificateRow` has no field for it,
// so no projection in this file can reach it and no later edit can add it by
// widening a spread. `INV-M11-07`, `AS-M11-05`, ADR-168 foreclosure 3.
//
// -----------------------------------------------------------------------------
// THE STATE IS DERIVED BECAUSE `0020` HAS NO STATUS COLUMN, AND THE UNION IS
// THREE MEMBERS BECAUSE THE TABLE CAN HOLD THREE
// -----------------------------------------------------------------------------
// `0020_public_surface.sql` gives `certificates` `deferred_until`, `revoked_at`,
// `revocation_class` and `deferred_reason` and no `status`. API_CONTRACT
// section 6.3 derives from that: "`deferred_until IS NOT NULL` is deferred,
// `revoked_at IS NOT NULL` is revoked, and neither is issued".
//
// M11 section 3.1 draws a FOURTH state, `withheld`, and it is not typed here.
// ADR-168 finding 10: there is no column distinguishing "Merit never made the
// claim" from a row that does not exist, and `ADR-040`'s `PayoutListItem`
// lesson one section up is that a union advertising a value the table cannot
// hold gives a client a branch that never fires. `withheld` is owed to the
// slice that gives it a column.
//
// THE TWO COLUMNS ARE NOT MUTUALLY EXCLUSIVE AND THE CORPUS DOES NOT RULE THE
// OVERLAP. `certificates_deferral_is_explained` and
// `certificates_revocation_is_complete` each constrain their own half and
// neither forbids both being set, so a deferral that was later revoked is a
// representable row. `deriveState` gives REVOCATION PRECEDENCE, for two reasons
// stated rather than assumed: revocation is terminal where a deferral is a
// wait, and `certificates_revocation_is_complete` guarantees a revoked row
// carries the class that drives its published sentence, so the precedence is
// the reading that always has something true to say. This is a shape the
// approved documents do not settle and it is reported in the pull request as a
// finding rather than recorded as a decision.
//
// -----------------------------------------------------------------------------
// A DEFERRED ROW HAS A CODE AND THE RESPONSE WITHHOLDS IT
// -----------------------------------------------------------------------------
// `certificates.code` is `text NOT NULL` under `certificates_code_uq`, so every
// row is addressable from the moment it is written; ADR-168 finding 12 records
// that this CONTRADICTS M11 section 3.2's sequence, which generates the code in
// the cleared branch only, and rules that "the column wins: a `NOT NULL` column
// is not optional because a diagram forgot it".
//
// So the withholding is the RESPONSE's and never the column's, and the
// difference is the whole point: "a deferral is a claim Merit has NOT made yet"
// (ADR-168 foreclosure 4). `projectCertificate` never calls the link signer for
// a deferred row, so the shareable token cannot be minted for one even by a
// later edit that forgot the rule; the structure carries it rather than a
// conditional at the end.
//
// AND THE IMAGE ENDPOINT REFUSES A DEFERRED CODE FOR THE SAME REASON, which is
// what `certificate_verifications.result`'s fourth member buys. `SD-M11-04`
// admits `('valid','unknown','revoked','deferred')`, and ADR-168 finding 14
// reads that as the corpus already accepting that a public lookup on a code can
// resolve to a deferral. A deferred code therefore answers 404 ON THE WIRE and
// is recorded as `deferred` IN THE TABLE: the anomaly detector can tell a
// deferral from a guess, and the caller cannot. Nobody legitimately holds a
// deferred code, because the list is the only surface that hands one out and it
// withholds exactly these.
//
// -----------------------------------------------------------------------------
// THERE IS NO TIMING DEFENCE ON THE IMAGE ROW AND ITS ABSENCE IS NOT A DEFECT
// -----------------------------------------------------------------------------
// `INV-M11-05` reads "the VERIFICATION endpoint is rate limited and
// non-enumerable ... no timing difference between known and unknown", and
// API_CONTRACT section 6.3 states that this row is inside that invariant's
// rate-limit and non-enumerability clauses and OUTSIDE its constant-time one:
// "a render is orders of magnitude slower than a 404, and `FM-M11-05`'s own
// remedy caches rendered bytes keyed by `(code, row_version)`, which puts a
// timing difference between two VALID codes before an attacker asks about an
// invalid one."
//
// So no code below equalises a clock, none claims to, and the difference is not
// reported as a gap. The enumeration control here is three things: the 128-bit
// code with no sequence (`INV-M11-05`), the rate limit section 11 gives this
// row its own line for, and the anomaly signal, which is the
// `certificate_verifications` write below.
//
// OF THOSE THREE, ONE IS NOW ENFORCED AND ONE STILL DOES NOT EXIST, and the
// sentence above states the SPECIFICATION rather than the deployment. ADR-235
// built the mint the first leg names: `mintCertificateCode` in `@merit/db` at
// 130 bits, measured by `RI-22` on every CI-01 pass. THE RATE LIMIT THIS ROW
// HAS ITS OWN LINE FOR EXISTS NOWHERE IN THIS TREE, per IP or per `code`, and
// ADR-235 section 5 rules it owed. Read the first leg as a property this
// repository now holds and the second as one it does not. ADR-168 foreclosure 5 exists to stop
// an implementer chasing the fourth one forever.
//
// -----------------------------------------------------------------------------
// EVERY FETCH IS RECORDED, AND A FETCH THAT CANNOT BE RECORDED DOES NOT HAPPEN
// -----------------------------------------------------------------------------
// API_CONTRACT section 6.3: "Every fetch writes `certificate_verifications`
// (`SD-M11-04`) with `code_hash` and never `code` ... A public read keyed on
// `code` is one oracle however it is dressed, and an image endpoint outside
// that table would be an unmetered second door onto the book `AS-M11-04` and
// `FM-M11-04` exist to watch."
//
// The write therefore happens BEFORE the response is composed, and a rejected
// write fails the request rather than being swallowed. Serving the bytes anyway
// would convert an outage of the log into exactly the unmetered door the
// sentence above refuses, and it would do it silently and only under load,
// which is when an enumeration campaign is worth running.
//
// WHAT THIS FILE HANDS THE SINK IS WHAT IT OBSERVED, AND THE SINK HASHES.
// `0025_reserved_sequence.sql` requires `code_hash` and `ip_hash` to be
// digests, and NO APPROVED DOCUMENT FIXES THE DIGEST, so choosing one here
// would be this route inventing a constant that then has to match whatever the
// detector picked. `user_agent_class` is not sent AT ALL: the column's own
// comment is "a class, never the string", and no approved document enumerates
// the classes, so a taxonomy invented here would be a vocabulary nothing else
// shares. The column is nullable; the gap is reported rather than filled.
//
// -----------------------------------------------------------------------------
// NEITHER ROW CAN REACH THE DATABASE FROM THIS DEPLOYABLE TODAY, AND ONE OF THE
// TWO CANNOT REACH IT AT ALL
// -----------------------------------------------------------------------------
// `apps/api/src/db.ts` opens exactly two doors, `scoped(identityId, fn)` and
// `firm(fn)`, and its header states that the absence of a third "is the point".
//
//   GET /certificates IS SERVABLE THROUGH THE SCOPED DOOR. `certificates` is
//   `class: 'owned'` on `identity_id` in `packages/db/src/scope.ts`, so
//   `tx.rows('certificates')` is the caller's own rows with `scopePredicate`
//   already ANDed in, and `databaseCertificateBackend` below is that adapter.
//
//   GET /certificates/:code/image.png CANNOT USE EITHER DOOR. It is
//   unauthenticated, so there is no identity for `scoped`; and `certificates`
//   is `owned`, so it is excluded from `FirmTableKey` and `firm` REFUSES IT AT
//   COMPILE TIME. The door that would serve it is `systemDb(reason)`, whose
//   `SystemReason` is `'nightly-batch' | 'operator-console'` and which
//   `apps/api` deliberately does not open. Widening that vocabulary is ADR-096
//   clause 3's refusal and ADR-109 clause 1's, and it is outside this fence.
//
// So the image row is served through a PORT and the port is UNWIRED, which is
// `routes/public-methods.ts`' and `routes/economic-calendar.ts`' shape and
// their stated reason: an unset source is a deployment that has not been
// finished, and it is answered loudly rather than guessed at. The row is
// registered, its shape is the contract's, its refusals are real, and its data
// path is a slice of its own. That is reported in the pull-request body rather
// than solved by reaching past the fence.
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
  type RequiredFactor,
} from './auth.ts';
import type { RouteHandler } from '../registry.ts';

/** API_CONTRACT section 6.3's two paths, as the contract writes them. */
export const CERTIFICATES_PATH = '/certificates';

/**
 * THE `.png` IS IN THE PATH. M11 section 4 and the portal both carry it, an
 * earlier draft dropped it, and ADR-168 finding 5 is the correction.
 */
export const CERTIFICATE_IMAGE_PATH = '/certificates/:code/image.png';

// -----------------------------------------------------------------------------
// The wire, section 6.3's own shapes
// -----------------------------------------------------------------------------

/** `certificates.kind`'s CHECK: `kind IN ('pass', 'payout')`. */
export const CERTIFICATE_KINDS = ['pass', 'payout'] as const;

/** One of {@link CERTIFICATE_KINDS}. */
export type CertificateKind = (typeof CERTIFICATE_KINDS)[number];

/**
 * The DERIVED state, and it is three members.
 *
 * `withheld` IS NOT HERE AND MUST NOT BE ADDED WITHOUT THE COLUMN THAT HOLDS
 * IT. See this file's header, API_CONTRACT section 6.3 and ADR-168 finding 10.
 */
export const CERTIFICATE_STATES = ['issued', 'deferred', 'revoked'] as const;

/** One of {@link CERTIFICATE_STATES}. */
export type CertificateState = (typeof CERTIFICATE_STATES)[number];

/**
 * `certificates.revocation_class`'s four-member CHECK, which is the PUBLISHED
 * half of a revocation.
 *
 * `trader_request` is a member and that is load-bearing rather than tidy:
 * API_CONTRACT section 6.3 names it as the reason a public certificate surface
 * is acceptable at all, because "a trader who wants it to stop can have it
 * stopped" and "a revoked row renders as revoked on the next fetch".
 */
export const REVOCATION_CLASSES = [
  'fact_untrue',
  'account_enforced',
  'issued_in_error',
  'trader_request',
] as const;

/** One of {@link REVOCATION_CLASSES}. */
export type RevocationClass = (typeof REVOCATION_CLASSES)[number];

/**
 * `INV-M11-01`'s minimal claim, and the whole of it.
 *
 * "The account's plan, size, trading day, the kind-specific value, and nothing
 * else. No identity, no email, no display name, no cumulative total, no
 * lifetime figure."
 */
export interface CertificateClaims {
  readonly plan_code: string;
  readonly size_cents: number;
  /** The payout card's kind-specific value. Absent on a pass card. */
  readonly amount_cents?: number;
  readonly trading_day: string;
}

/** Section 6.3's `CertificateListItem`. */
export interface CertificateListItem {
  readonly certificate_id: string;
  readonly kind: CertificateKind;
  readonly state: CertificateState;
  readonly issued_at: string;
  readonly claims: CertificateClaims;
  /** WITHHELD WHILE DEFERRED. The column underneath is `NOT NULL`. */
  readonly code: string | null;
  readonly verify_url: string | null;
  readonly image_url: string | null;
  readonly deferred: { readonly reason: string; readonly until: string | null } | null;
  readonly revoked: { readonly at: string; readonly class: RevocationClass } | null;
}

/**
 * Section 6.3's `CertificateListResponse`.
 *
 * THE ENVELOPE IS TYPED, and section 6.3 says why in its own paragraph: `GET
 * /purchases` typed only its item and the portal's port was then written with
 * no cursor argument because "the paging token's shape is not settled on this
 * ref".
 */
export interface CertificateListResponse {
  readonly data: readonly CertificateListItem[];
  readonly next_cursor: string | null;
}

/**
 * The two public URLs for one code.
 *
 * NEITHER IS BUILT IN THIS FILE AND THAT IS DELIBERATE TWICE OVER. `image_url`
 * is "signed, time-limited" (API_CONTRACT section 6, carried into 6.3), and
 * this deployable holds no signing key; `verify_url` addresses `GET
 * /verify/:code`, which ADR-168 foreclosure 1 records as named by M11 and
 * DEFINED BY NO SECTION OF THE CONTRACT, deliberately not repaired there. A
 * string composed here would invent both the origin ADR-012 keeps out of this
 * repository and a path no approved document defines.
 */
export interface CertificateLinks {
  readonly verify_url: string;
  readonly image_url: string;
}

// -----------------------------------------------------------------------------
// The row, as this file reads it off the accessor
// -----------------------------------------------------------------------------

/**
 * One `certificates` row, narrowed to what section 6.3 renders.
 *
 * `revokedReason` IS ABSENT BY CONSTRUCTION. So are `identityId`, `accountId`,
 * `signature`, `signingKeyId`, `payoutRequestId` and `claimsSchemaVersion`:
 * each is a real column and none of them is in section 6.3's schema, so none of
 * them has a field here to be projected out of. `toCertificateRow` reads by
 * name, so a column added to `certificates` tomorrow cannot arrive in a
 * response by default, which is section 1's allowlist obtained structurally.
 */
export interface CertificateRow {
  readonly id: string;
  readonly kind: CertificateKind;
  readonly claims: CertificateClaims;
  readonly code: string;
  /** RFC 3339 UTC, rendered by ONE code path so lexical order is chronological. */
  readonly issuedAt: string;
  readonly revokedAt: string | null;
  readonly revocationClass: RevocationClass | null;
  readonly deferredUntil: string | null;
  readonly deferredReason: string | null;
}

/** Raised when a row cannot be read as one. Every case is a defect, so a 500. */
export class CertificateRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CertificateRowError';
  }
}

/** `YYYY-MM-DD`, section 1's `*_day`. Month and day ranges checked. */
const DAY = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

function asRow(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new CertificateRowError(
      'the accessor returned something that is not a `certificates` row. A response built from ' +
        'it would be a certificate assembled from whatever the value happened to carry',
    );
  return value as Record<string, unknown>;
}

function text(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value === '')
    throw new CertificateRowError(
      `\`certificates.${field}\` is not a non-empty string. The column is \`text NOT NULL\``,
    );
  return value;
}

function instant(value: unknown, field: string): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime()))
    throw new CertificateRowError(
      `\`certificates.${field}\` is not a Date. The column is \`timestamptz\`, and a value that ` +
        "is not one cannot be rendered as section 1's RFC 3339 UTC string",
    );
  return value.toISOString();
}

function nullableInstant(row: Record<string, unknown>, field: string): string | null {
  const value = row[field];
  return value === null || value === undefined ? null : instant(value, field);
}

function member<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value))
    throw new CertificateRowError(
      `\`certificates.${field}\` is \`${String(value)}\`, which the column's own CHECK closes ` +
        `at ${allowed.join(' | ')}`,
    );
  return value as T;
}

/** A `*_cents` figure as section 1 requires it: a JSON integer, never a float. */
function cents(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new CertificateRowError(
      `\`claims.${field}\` is \`${String(value)}\`. API_CONTRACT section 1: \`*_cents\` are ` +
        'JSON integers, no floats and no formatted strings, and a certificate states a figure ' +
        'Merit signed',
    );
  return value;
}

/**
 * THE ALLOWLIST OVER THE `jsonb` COLUMN. Read this before changing it.
 *
 * `certificates.claims` is `jsonb NOT NULL` and the database constrains nothing
 * about its keys. `INV-M11-01` constrains them and is prose, so this function is
 * where the prose becomes a refusal: four keys are read BY NAME and every other
 * key of the stored object is dropped without being inspected. A spread here
 * would publish, on a public share card, whatever any issuer ever wrote into
 * that column.
 *
 * `amount_cents` IS AN EQUIVALENCE AGAINST `kind` and both directions are
 * refused, which is `certificates_payout_kind_has_request`'s own shape applied
 * to the claim rather than to the foreign key: a payout card with no amount
 * renders a payout that states no payout, and a pass card carrying one
 * publishes a money figure the kind does not claim.
 */
export function narrowClaims(value: unknown, kind: CertificateKind): CertificateClaims {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new CertificateRowError(
      '`certificates.claims` is not a JSON object. It is `jsonb NOT NULL` and it is what the ' +
        'verification page states FROM THE SIGNED ROW',
    );
  const claims = value as Record<string, unknown>;

  const planCode = claims['plan_code'];
  if (typeof planCode !== 'string' || planCode === '')
    throw new CertificateRowError(
      '`claims.plan_code` is not a non-empty string. `INV-M11-01` makes the plan one of the ' +
        'four things a certificate claims',
    );

  const tradingDay = claims['trading_day'];
  if (typeof tradingDay !== 'string' || !DAY.test(tradingDay))
    throw new CertificateRowError(
      `\`claims.trading_day\` is \`${String(tradingDay)}\`, which is not a \`YYYY-MM-DD\` day. ` +
        'API_CONTRACT section 1: `*_day` is an EXCHANGE TRADING DAY and never a UTC date, and a ' +
        'certificate that names the wrong day names a different result',
    );

  const sizeCents = cents(claims['size_cents'], 'size_cents');

  const rawAmount = claims['amount_cents'];
  const hasAmount = rawAmount !== undefined && rawAmount !== null;
  if (kind === 'payout' && !hasAmount)
    throw new CertificateRowError(
      "`claims.amount_cents` is absent on a `payout` certificate. `INV-M11-01`'s fourth claim " +
        'is the KIND-SPECIFIC value, and a payout card without it states no payout',
    );
  if (kind === 'pass' && hasAmount)
    throw new CertificateRowError(
      '`claims.amount_cents` is present on a `pass` certificate. A pass card claims a pass, and ' +
        'a money figure on it is a claim its kind does not make',
    );

  // The object is BUILT rather than spread, and `amount_cents` is added only on
  // the branch that has one, because `exactOptionalPropertyTypes` makes
  // "absent" and "present and undefined" different shapes on the wire.
  return hasAmount
    ? {
        plan_code: planCode,
        size_cents: sizeCents,
        amount_cents: cents(rawAmount, 'amount_cents'),
        trading_day: tradingDay,
      }
    : { plan_code: planCode, size_cents: sizeCents, trading_day: tradingDay };
}

/**
 * One accessor row, narrowed. Exported so the suite names it directly.
 *
 * The two CHECK constraints `0020` writes are re-asserted here rather than
 * trusted, because the source is an INTERFACE and not the database, and because
 * a half-written revocation renders as a certificate that says it was revoked
 * and cannot say under what.
 */
export function toCertificateRow(value: unknown): CertificateRow {
  const row = asRow(value);
  const kind = member(row['kind'], CERTIFICATE_KINDS, 'kind');

  const revokedAt = nullableInstant(row, 'revokedAt');
  const rawClass = row['revocationClass'];
  const revocationClass =
    rawClass === null || rawClass === undefined
      ? null
      : member(rawClass, REVOCATION_CLASSES, 'revocation_class');

  // `certificates_revocation_is_complete`, as an equivalence over the published
  // half. The internal half is not read here at all, so the constraint's third
  // column is checked by the database and never by this file.
  if ((revokedAt === null) !== (revocationClass === null))
    throw new CertificateRowError(
      'a `certificates` row carries ' +
        (revokedAt === null ? 'a revocation class with no `revoked_at`' : 'no revocation class') +
        '. `certificates_revocation_is_complete` writes the class and the timestamp together, ' +
        'and the class is what drives the PUBLISHED sentence (`INV-M11-07`)',
    );

  const deferredUntil = nullableInstant(row, 'deferredUntil');
  const rawReason = row['deferredReason'];
  const deferredReason =
    rawReason === null || rawReason === undefined ? null : text(row, 'deferredReason');

  // `certificates_deferral_is_explained` is ONE-DIRECTIONAL in the DDL:
  // `deferred_until IS NULL OR deferred_reason IS NOT NULL`. It is checked in
  // that direction only, because a reason recorded without a deadline is a row
  // the database permits and `INV-M11-09`'s visible reason is what the trader
  // needs either way.
  if (deferredUntil !== null && deferredReason === null)
    throw new CertificateRowError(
      'a `certificates` row is deferred and states no reason. ' +
        '`certificates_deferral_is_explained` forbids it, and `INV-M11-09` makes the reason the ' +
        'thing that distinguishes a deferral from a silent skip',
    );

  return {
    id: text(row, 'id'),
    kind,
    claims: narrowClaims(row['claims'], kind),
    code: text(row, 'code'),
    issuedAt: instant(row['issuedAt'], 'issuedAt'),
    revokedAt,
    revocationClass,
    deferredUntil,
    deferredReason,
  };
}

/**
 * The DERIVED state. `0020` has no status column.
 *
 * REVOCATION TAKES PRECEDENCE OVER DEFERRAL and the header states the argument.
 * The overlap is representable and the corpus does not rule it; this is the
 * reading, and it is reported as a finding rather than recorded as a decision.
 */
export function deriveState(row: CertificateRow): CertificateState {
  if (row.revokedAt !== null) return 'revoked';
  if (row.deferredUntil !== null) return 'deferred';
  return 'issued';
}

// -----------------------------------------------------------------------------
// The port for the list
// -----------------------------------------------------------------------------

/** Raised when the list backend is not wired. Answered 503, never a 500. */
export class CertificateBackendUnwired extends Error {
  constructor(method: string) {
    super(
      `CertificateBackend.${method} is not wired, so \`GET /certificates\` answers 503 rather ` +
        'than an empty list. An empty list is a trader being told they have no certificates',
    );
    this.name = 'CertificateBackendUnwired';
  }
}

/**
 * What the list endpoint needs from the world.
 *
 * ONE READ AND ONE SIGNER. The read is the caller's whole set, because the
 * accessor this file may reach has no ordering, no limit and no cursor term
 * (`ScopedTx.rows` takes a key and nothing else), so the page is composed in
 * memory; that is `catalog.ts`' `GET /purchases` shape and `wallet.ts`'
 * `GET /wallet/entries` shape, both of which record the same cost.
 *
 * `links` IS SYNCHRONOUS AND IS CALLED PER RENDERED ROW rather than being a
 * field on the row, because `image_url` is signed and TIME-LIMITED: a URL
 * carried on the row would be minted once and rendered whenever, which is the
 * one property the contract's "signed, time-limited" forbids.
 */
export interface CertificateBackend {
  /** Every `certificates` row of this identity's, deferred ones included. */
  readCertificates(session: AuthSession): Promise<readonly CertificateRow[]>;
  /** The two public URLs for a code. Never called for a deferred row. */
  links(code: string): CertificateLinks;
}

/**
 * The fail-closed default.
 *
 * BOTH HALVES REFUSE. A `links` that returned a plausible string while the read
 * refused would be a half-wired deployment that looks wired in a unit test.
 */
export const UNWIRED_CERTIFICATE_BACKEND: CertificateBackend = {
  readCertificates: () => Promise.reject(new CertificateBackendUnwired('readCertificates')),
  links: () => {
    throw new CertificateBackendUnwired('links');
  },
};

let backend: CertificateBackend = UNWIRED_CERTIFICATE_BACKEND;

/** Install the backend. The wiring slice calls this; so does the suite. */
export function useCertificateBackend(next: CertificateBackend): void {
  backend = next;
}

/** Restore the fail-closed default. */
export function resetCertificateBackend(): void {
  backend = UNWIRED_CERTIFICATE_BACKEND;
}

/** The installed backend. */
export function currentCertificateBackend(): CertificateBackend {
  return backend;
}

/**
 * The backend, reading through the accessor.
 *
 * `db.scoped` AND NEVER `db.firm`. The identity is the one `endpointHandler`
 * resolved from the session cookie, `certificates` is `class: 'owned'` on
 * `identity_id`, and `scopePredicate` is ANDed by the accessor before this file
 * sees a row. So nothing below is a tenancy control and nothing below can
 * become one by accident. `db.firm('certificates')` would not compile:
 * `FirmTableKey` excludes every owned table.
 *
 * THE SIGNER IS A PARAMETER because signing is not this deployable's. See
 * {@link CertificateLinks}.
 */
export function databaseCertificateBackend(
  db: ApiDb,
  links: (code: string) => CertificateLinks,
): CertificateBackend {
  return {
    readCertificates: (session) =>
      db.scoped(session.identityId, async (tx) =>
        (await tx.rows('certificates')).map(toCertificateRow),
      ),
    links,
  };
}

// -----------------------------------------------------------------------------
// The page
// -----------------------------------------------------------------------------

/** Section 1: "`limit` maximum 100, default 25." */
export const CERTIFICATES_DEFAULT_LIMIT = 25;
export const CERTIFICATES_MAX_LIMIT = 100;

/** The position a cursor names, before it is encoded. */
export interface CertificateCursor {
  readonly issued_at: string;
  readonly certificate_id: string;
}

/**
 * The cursor as the wire carries it: opaque, which section 1 requires.
 *
 * base64url of `issued_at|certificate_id`, `catalog.ts`' and `wallet.ts`'
 * encoding and their argument: opaque is a promise about the CLIENT and not
 * about an attacker, because the read it seeks into is scoped to the caller's
 * identity by the accessor before this file sees a row.
 */
export function encodeCursor(cursor: CertificateCursor): string {
  return Buffer.from(`${cursor.issued_at}|${cursor.certificate_id}`, 'utf8').toString('base64url');
}

/** The inverse, or `null` for anything that is not one. */
export function decodeCursor(raw: string): CertificateCursor | null {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const split = decoded.lastIndexOf('|');
  if (split <= 0 || split === decoded.length - 1) return null;
  const issuedAt = decoded.slice(0, split);
  const certificateId = decoded.slice(split + 1);
  // BOTH HALVES ARE VALIDATED because both are compared. A cursor carrying
  // either half malformed names a position no row can sit after, which renders
  // as a silently empty final page.
  if (Number.isNaN(Date.parse(issuedAt))) return null;
  return { issued_at: issuedAt, certificate_id: certificateId };
}

/** A validated `?limit=&cursor=` pair. */
export interface CertificateListQuery {
  readonly limit: number;
  readonly cursor: CertificateCursor | null;
}

type Validated<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly FieldError[] };

/**
 * Section 1's query, validated total.
 *
 * A BAD CURSOR IS A `validation_failed` AND NOT AN EMPTY PAGE, which is
 * `catalog.ts`' rule and is the only error section 6.3 states for this row: an
 * empty page for a cursor the server cannot read is a list that silently ends
 * early, and the client cannot tell that from having reached the end.
 *
 * `limit` IS ACCEPTED THOUGH SECTION 6.3 NAMES ONLY THE CURSOR IN ITS ERROR
 * LIST. Section 1 states the pagination for the whole contract, `?limit=50&
 * cursor=<opaque>`, and the row states "Pagination: ... `{ data, next_cursor }`"
 * by typing the envelope. An out-of-range `limit` is `validation_failed` on the
 * same argument the cursor is: a silently clamped limit is a client that
 * believes it asked for a page size it did not get.
 */
export function validateListQuery(query: unknown): Validated<CertificateListQuery> {
  const row: Record<string, unknown> =
    typeof query === 'object' && query !== null && !Array.isArray(query)
      ? (query as Record<string, unknown>)
      : {};
  const errors: FieldError[] = [];

  let limit = CERTIFICATES_DEFAULT_LIMIT;
  const rawLimit = row['limit'];
  if (rawLimit !== undefined) {
    // Fastify hands a query string over as a string; the contract writes it as
    // an integer, so the parse is here and it refuses anything that is not one.
    const parsed =
      typeof rawLimit === 'string' && /^[0-9]+$/.test(rawLimit) ? Number(rawLimit) : -1;
    if (parsed < 1 || parsed > CERTIFICATES_MAX_LIMIT)
      errors.push({
        path: 'limit',
        message: `must be an integer between 1 and ${String(CERTIFICATES_MAX_LIMIT)}`,
      });
    else limit = parsed;
  }

  let cursor: CertificateCursor | null = null;
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
 * Newest first, which is `certificates_identity_idx`' own order:
 * `(identity_id, issued_at DESC)`.
 *
 * DESCENDING ON BOTH KEYS, so the cursor's "strictly after" is one comparison
 * rather than two rules. `issued_at` is an RFC 3339 UTC string rendered by one
 * code path, so lexical order is chronological order; the id tie-break is a
 * lexical comparison of two uuids, which is arbitrary but TOTAL, and total is
 * the property a cursor needs.
 */
export function newestFirst(a: CertificateRow, b: CertificateRow): number {
  if (a.issuedAt !== b.issuedAt) return a.issuedAt < b.issuedAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** Whether a row falls strictly after a cursor's position under {@link newestFirst}. */
export function isAfter(row: CertificateRow, cursor: CertificateCursor): boolean {
  if (row.issuedAt !== cursor.issued_at) return row.issuedAt < cursor.issued_at;
  return row.id < cursor.certificate_id;
}

/** Refuse a link that is not an absolute URL. */
function assertUrl(value: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CertificateRowError(
      `\`${field}\` is \`${value}\`, which is not an absolute URL. This field is pasted into a ` +
        'share sheet by whoever holds the card, and a relative path there resolves against ' +
        'whatever page pasted it',
    );
  }
  if (parsed.protocol === '') throw new CertificateRowError(`\`${field}\` names no scheme`);
  return value;
}

/**
 * One certificate, projected onto section 6.3's schema.
 *
 * THE DEFERRED BRANCH NEVER CALLS THE SIGNER. That is the enforcement of ADR-168
 * foreclosure 4 and it is structural rather than a trailing conditional: there
 * is no path through this function on which a deferred row is handed to
 * `links`, so a token for a claim Merit has not made cannot be minted even by an
 * edit that forgot the rule.
 *
 * THE `deferred` AND `revoked` BLOCKS TRACK THE COLUMNS AND `state` TRACKS THE
 * DERIVATION, so a row carrying both columns renders `state: "revoked"` and
 * still reports the deferral it came out of. Collapsing the blocks into the
 * state would discard a fact the row holds.
 */
export function projectCertificate(
  row: CertificateRow,
  links: (code: string) => CertificateLinks,
): CertificateListItem {
  const state = deriveState(row);
  const claims = row.claims;

  const shared = {
    certificate_id: row.id,
    kind: row.kind,
    state,
    issued_at: row.issuedAt,
    // Rebuilt field by field rather than passed through, so a `claims` shape
    // that grew a key between `narrowClaims` and here cannot ride along.
    claims:
      claims.amount_cents === undefined
        ? {
            plan_code: claims.plan_code,
            size_cents: claims.size_cents,
            trading_day: claims.trading_day,
          }
        : {
            plan_code: claims.plan_code,
            size_cents: claims.size_cents,
            amount_cents: claims.amount_cents,
            trading_day: claims.trading_day,
          },
    deferred:
      row.deferredReason === null ? null : { reason: row.deferredReason, until: row.deferredUntil },
    revoked:
      row.revokedAt === null || row.revocationClass === null
        ? null
        : { at: row.revokedAt, class: row.revocationClass },
  } satisfies Omit<CertificateListItem, 'code' | 'verify_url' | 'image_url'>;

  if (state === 'deferred') return { ...shared, code: null, verify_url: null, image_url: null };

  const minted = links(row.code);
  return {
    ...shared,
    code: row.code,
    verify_url: assertUrl(minted.verify_url, 'verify_url'),
    image_url: assertUrl(minted.image_url, 'image_url'),
  };
}

/**
 * Section 6.3's page.
 *
 * THE PAGING IS IN MEMORY AND THE PORT'S DOC COMMENT SAYS WHY. Every row handed
 * here is already this identity's: the accessor applied `scopePredicate` before
 * the handler saw one, so nothing below is a tenancy control and nothing below
 * can become one by accident.
 */
export function renderCertificates(
  rows: readonly CertificateRow[],
  query: CertificateListQuery,
  links: (code: string) => CertificateLinks,
): CertificateListResponse {
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
    data: page.map((row) => projectCertificate(row, links)),
    next_cursor:
      more && last !== undefined
        ? encodeCursor({ issued_at: last.issuedAt, certificate_id: last.id })
        : null,
  };
}

// -----------------------------------------------------------------------------
// The image, which is the public unauthenticated half
// -----------------------------------------------------------------------------

/**
 * `certificate_verifications.result`'s four-member CHECK (`SD-M11-04`).
 *
 * ALL FOUR ARE REACHABLE FROM THIS ENDPOINT, and `deferred` is the one worth
 * naming: ADR-168 finding 14 reads the fourth member as the corpus already
 * accepting that a public lookup on a code can resolve to a deferral. The wire
 * cannot tell `deferred` from `unknown`; the table can.
 */
export const VERIFICATION_RESULTS = ['valid', 'unknown', 'revoked', 'deferred'] as const;

/** One of {@link VERIFICATION_RESULTS}. */
export type VerificationResult = (typeof VERIFICATION_RESULTS)[number];

/** The rendered card, re-rendered on fetch from the live row (`INV-M11-08`). */
export interface CertificateCard {
  /** `image/png` bytes. */
  readonly bytes: Uint8Array;
  /**
   * `Cache-Control`'s `max-age`, in seconds.
   *
   * CONFIG RATHER THAN A NUMBER STATED HERE, which is API_CONTRACT section 6.3's
   * own wording. What this file enforces is the BOUND M11 section 4 states,
   * "measured in minutes, never in days", and nothing narrower: a ninety-second
   * lifetime is still not measured in days, so the whole-minutes reading is
   * available and is deliberately not taken.
   */
  readonly cache_max_age_seconds: number;
}

/** What one lookup of a code resolved to. */
export interface CertificateLookup {
  /** The row's state, in `certificate_verifications`' vocabulary. */
  readonly result: Exclude<VerificationResult, 'unknown'>;
  /** The rendered card, or `null` where the state does not render. */
  readonly card: CertificateCard | null;
}

/** What this route observed about one fetch. The SINK hashes; see the header. */
export interface CertificateObservation {
  /** The attempted code, in the clear. `code_hash` is the sink's to compute. */
  readonly code: string;
  readonly result: VerificationResult;
  /** The caller's address, or `null`. `ip_hash` is the sink's to compute. */
  readonly ip: string | null;
}

/**
 * What the image endpoint needs from the world.
 *
 * NEITHER METHOD IS REACHABLE THROUGH `apps/api/src/db.ts` TODAY and the header
 * states why: this row is unauthenticated, so `scoped` has no identity, and
 * `certificates` is `owned`, so `firm` refuses it at compile time. The door
 * that would serve it takes a `SystemReason` this deployable does not open.
 */
export interface CertificateImageSource {
  /** `null` when no row carries this code. `INV-M11-02`: the row is the authority. */
  lookup(code: string): Promise<CertificateLookup | null>;
  /** Append one `certificate_verifications` row. Rejecting fails the fetch. */
  record(observation: CertificateObservation): Promise<void>;
}

/** Raised when the image source is not wired. Answered 503, never a rendered card. */
export class CertificateImageUnwired extends Error {
  constructor(method: string) {
    super(
      `CertificateImageSource.${method} is not wired, so ` +
        '`GET /certificates/:code/image.png` answers 503 rather than 404. A 404 here would say ' +
        "no certificate carries this code, which is a claim about Merit's book rather than " +
        'about this deployment',
    );
    this.name = 'CertificateImageUnwired';
  }
}

/** Raised when a rendered card cannot be served as one. Every case is a defect. */
export class CertificateImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CertificateImageError';
  }
}

/** The fail-closed default. Both halves refuse. */
export const UNWIRED_CERTIFICATE_IMAGE_SOURCE: CertificateImageSource = {
  lookup: () => Promise.reject(new CertificateImageUnwired('lookup')),
  record: () => Promise.reject(new CertificateImageUnwired('record')),
};

let imageSource: CertificateImageSource = UNWIRED_CERTIFICATE_IMAGE_SOURCE;

/** Install the source. The wiring slice calls this; so does the suite. */
export function useCertificateImageSource(next: CertificateImageSource): void {
  imageSource = next;
}

/** Restore the fail-closed default. */
export function resetCertificateImageSource(): void {
  imageSource = UNWIRED_CERTIFICATE_IMAGE_SOURCE;
}

/** The installed source. */
export function currentCertificateImageSource(): CertificateImageSource {
  return imageSource;
}

/** One day in seconds. The bound M11 section 4 states, as a number. */
const ONE_DAY_SECONDS = 86_400;

/** The eight-byte PNG signature, ISO 15948 clause 5.2. */
const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/**
 * Refuse bytes this route would otherwise label `image/png`.
 *
 * THE PATH ENDS IN `.png` AND THE CONTENT TYPE SAYS `image/png`, so this route
 * makes a claim about the bytes that section 1's allowlist would have made about
 * fields. The signature check is the smallest version of that claim being true.
 * It is a format check and NEVER a disclosure check: what is drawn inside a
 * valid PNG is the renderer's, and this file's header says so rather than
 * implying otherwise by checking something.
 */
export function assertPng(bytes: Uint8Array): Uint8Array {
  if (bytes.length < PNG_SIGNATURE.length)
    throw new CertificateImageError(
      `the rendered card is ${String(bytes.length)} bytes, which is shorter than the PNG ` +
        'signature. This route answers `image/png` and may not label something else as one',
    );
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1)
    if (bytes[i] !== PNG_SIGNATURE[i])
      throw new CertificateImageError(
        'the rendered card does not open with the PNG signature. The path ends in `.png` and ' +
          'the response declares `image/png`, so bytes that are not a PNG are a renderer defect ' +
          "reaching a public surface with Merit's claim on it",
      );
  return bytes;
}

/**
 * `Cache-Control` for a rendered card.
 *
 * `INV-M11-08` and `AS-M11-02`: the re-render is the ONLY mechanism by which a
 * revocation reaches an image already in circulation, so the cache lifetime is
 * the width of the window in which a revoked card keeps rendering as valid. M11
 * section 4 bounds it, "measured in minutes, never in days"; the value is
 * config and arrives on the card.
 */
export function cacheControl(maxAgeSeconds: number): string {
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0)
    throw new CertificateImageError(
      `the render supplied a cache lifetime of \`${String(maxAgeSeconds)}\` seconds, which is ` +
        'not a positive whole number of seconds',
    );
  if (maxAgeSeconds >= ONE_DAY_SECONDS)
    throw new CertificateImageError(
      `the render supplied a cache lifetime of ${String(maxAgeSeconds)} seconds, which is a day ` +
        'or more. M11 section 4: measured in minutes, NEVER in days, because the cache lifetime ' +
        'is how long a revoked certificate keeps rendering as valid (`INV-M11-08`, `AS-M11-02`)',
    );
  return `public, max-age=${String(maxAgeSeconds)}`;
}

function sendNotFound(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return reply
    .code(404)
    .type(PROBLEM_MEDIA_TYPE)
    .send(problem('not_found', 404, request.id));
}

/**
 * `GET /certificates/:code/image.png`. Auth: NONE.
 *
 * A BARE `RouteHandler` RATHER THAN AN `EndpointSpec`, which is
 * `public-methods.ts`' and `catalog.ts`' shape and their reason carried one step
 * further. `endpointHandler` resolves a session from the cookie BEFORE it reads
 * the declared factor, and this route runs on the portal's own origin, so a
 * logged-in trader's browser sends `merit_session` with every card fetch. Under
 * an `EndpointSpec` this public image would resolve a session it has no use
 * for, and an unwired auth backend would turn a public card into a 503. The
 * declaration still exists as data in {@link CERTIFICATES_REQUIRED_FACTORS}.
 *
 * THE 404 IS THE ONLY ANSWER A CALLER CAN CAUSE and it is DELIBERATELY
 * AMBIGUOUS between "no row carries this code" and "the row carries it and does
 * not render". Section 2's problem document has no free text here, so
 * `INV-M11-03`'s exact wording, "no certificate with this code", belongs to
 * `GET /verify/:code`, which is a page and which ADR-168 foreclosure 1 records
 * as still undefined. What this row owes the invariant is that it never says
 * "this is fake", and a bare `not_found` never does.
 */
export const imageHandler: RouteHandler = async (request, reply) => {
  const params = request.params as { code?: unknown };
  const code = typeof params.code === 'string' ? params.code : '';
  // An empty segment cannot reach here through the router, and it is refused
  // anyway rather than handed to a lookup as an empty predicate.
  if (code === '') return sendNotFound(request, reply);

  const source = imageSource;
  const ip = request.ip === '' ? null : request.ip;

  let found: CertificateLookup | null;
  try {
    found = await source.lookup(code);
  } catch (err) {
    return unwiredOrThrow(err, request, reply);
  }

  // THE WRITE HAPPENS BEFORE THE RESPONSE IS COMPOSED AND A REJECTED WRITE
  // FAILS THE FETCH. See this file's header: serving the bytes anyway converts
  // an outage of the log into the unmetered oracle `AS-M11-04` and `FM-M11-04`
  // exist to watch, silently and only under load.
  const result: VerificationResult = found === null ? 'unknown' : found.result;
  try {
    await source.record({ code, result, ip });
  } catch (err) {
    return unwiredOrThrow(err, request, reply);
  }

  if (found === null) return sendNotFound(request, reply);

  // A DEFERRED CODE DOES NOT RENDER. The claim has not been made yet, so there
  // is nothing to draw; the observation above already recorded it as `deferred`
  // rather than `unknown`, which is the distinction the table's fourth member
  // buys and the wire deliberately does not carry.
  if (found.result === 'deferred') {
    if (found.card !== null)
      throw new CertificateImageError(
        'the source rendered a card for a DEFERRED certificate. A deferral is a claim Merit has ' +
          'not made yet (ADR-168 foreclosure 4), and a card for one is that claim published',
      );
    return sendNotFound(request, reply);
  }

  if (found.card === null)
    throw new CertificateImageError(
      `the source resolved \`${found.result}\` and rendered no card. \`INV-M11-08\` makes the ` +
        're-render the only path by which a revocation reaches a circulating image, so a revoked ' +
        'certificate that does not render is the revocation failing to arrive',
    );

  // A REVOKED CERTIFICATE RENDERS AS REVOKED and this route does not check that
  // it did: what is drawn is the renderer's, and a check here would be this
  // file asserting about pixels it cannot see. What it holds is that the
  // revoked row RENDERS AT ALL, which is the half `INV-M11-08` needs and the
  // half a "static asset" implementation gets wrong.
  const bytes = assertPng(found.card.bytes);
  return reply
    .code(200)
    .type('image/png')
    .header('Cache-Control', cacheControl(found.card.cache_max_age_seconds))
    .send(Buffer.from(bytes));
};

/** An unwired port is a 503 and never a 500. Anything else is the transport's. */
function unwiredOrThrow(err: unknown, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  if (!(err instanceof CertificateImageUnwired)) throw err;
  request.log.error({ err }, 'certificate image source is not wired');
  return reply
    .code(503)
    .type(PROBLEM_MEDIA_TYPE)
    .send({ ...problem('service_unavailable', 503, request.id), title: 'Service unavailable' });
}

// -----------------------------------------------------------------------------
// The endpoints
// -----------------------------------------------------------------------------

/**
 * `GET /certificates`. Section 6.3: "Auth: **session**, scoped to the caller's
 * identity."
 *
 * THERE IS NO PATH PARAMETER AND NO QUERY PARAMETER NAMING AN IDENTITY, so
 * there is nothing here for a caller to point at somebody else. Section 1's
 * identity scoping is the whole of the ownership rule and the accessor applies
 * it.
 */
export const CERTIFICATE_LIST_ENDPOINTS: readonly EndpointSpec[] = [
  {
    method: 'GET',
    path: CERTIFICATES_PATH,
    required: 'session',
    handle: withSessionContext(async ({ request, reply, session }) => {
      const query = validateListQuery(request.query);
      if (!query.ok)
        return reply
          .code(400)
          .type(PROBLEM_MEDIA_TYPE)
          .send({ ...problem('validation_failed', 400, request.id), errors: query.errors });

      const wired = backend;
      let rows: readonly CertificateRow[];
      try {
        rows = await wired.readCertificates(session);
      } catch (err) {
        if (!(err instanceof CertificateBackendUnwired)) throw err;
        request.log.error({ err }, 'certificate backend is not wired');
        return reply
          .code(503)
          .type(PROBLEM_MEDIA_TYPE)
          .send({
            ...problem('service_unavailable', 503, request.id),
            title: 'Service unavailable',
          });
      }
      return renderCertificates(rows, query.value, (code) => wired.links(code));
    }),
  },
];

/**
 * The declaration as data, for both rows.
 *
 * THE IMAGE ROW IS ADDED BY HAND BECAUSE IT IS NOT AN `EndpointSpec`, and its
 * factor is `none`, which is section 12's own token for an endpoint that
 * requires nothing. A row declared nowhere is a row a later negative-authz gate
 * cannot read, and ADR-168 section 4 already records that both rows owe section
 * 12 an entry.
 */
export const CERTIFICATES_REQUIRED_FACTORS: Readonly<Record<string, RequiredFactor>> = {
  ...requiredFactorTable(CERTIFICATE_LIST_ENDPOINTS),
  [`GET ${CERTIFICATE_IMAGE_PATH}`]: 'none',
};

export default defineRoutes({
  name: 'certificates',
  routes: [
    ...toRoutes(CERTIFICATE_LIST_ENDPOINTS),
    { method: 'GET', path: CERTIFICATE_IMAGE_PATH, handler: imageHandler },
  ],
});
