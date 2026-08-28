// =============================================================================
// apps/api/src/routes/verify.ts
// =============================================================================
// API_CONTRACT SECTION 6.3's `GET /verify/:code`, AND NOTHING ELSE.
//
// ADR-170 admitted this row into the contract and deliberately built nothing:
// its foreclosure 9 says "no route is registered, no handler is written ... The
// rows are the specification a later slice transcribes, and the `E2` read is
// owed on the handlers". This file is that transcription. It takes NO ADR
// number and NO migration number, because every decision below is already ruled
// and the ones that are not are reported rather than taken.
//
// THE NAME `VerifyResponse` IS ALSO `auth.ts`'s, FOR `POST /auth/verify`, AND
// THE TWO ARE UNRELATED. The contract names this shape `VerifyResponse` in
// section 6.3 and this file is a transcription of that section, so the contract
// spelling is kept. Nothing imports both.
//
// -----------------------------------------------------------------------------
// THIS IS A PUBLIC, UNAUTHENTICATED ORACLE OVER MERIT'S OWN PAYOUT BOOK, AND
// EVERY REFUSAL BELOW IS THAT SENTENCE APPLIED
// -----------------------------------------------------------------------------
// ADR-170 opens by ruling that this row is "a SECURITY ruling and not a routing
// one", `AS-M11-04` is the scenario written about this exact endpoint, and
// `INV-M11-05`'s no-timing-difference clause NAMES IT BY NAME. So four of the
// things this file does not do are the substance of it:
//
//   1. NO `validation_failed`. A malformed token answers `unknown`, at the same
//      floor as everything else. ADR-170 foreclosure 3, section 4.2 item 1.
//   2. NO RESPONSE CACHE, and `Cache-Control: no-store` on every response
//      including the refusals. ADR-170 foreclosure 4 and section 4.1.
//   3. NO `deferred` MEMBER ON THE RESPONSE, while the log keeps it. ADR-170
//      foreclosure 1 and section 3.1.
//   4. NO `certificates.id`, NO `payout_request_id` AND NO `revoked_reason` on
//      the row type at all. ADR-170 foreclosure 5 and section 3.
//
// -----------------------------------------------------------------------------
// THE THREE-MEMBER UNION IS AN ALLOWLIST AND IT IS NOT ADR-040's DEFECT
// -----------------------------------------------------------------------------
// `certificate_verifications.result` admits `('valid','unknown','revoked',
// 'deferred')` (`0025_reserved_sequence.sql`) and this response admits three.
// ADR-170 section 3.1 states the direction, and states it because the two are
// one word apart in a review: ADR-040's rule is that a union must not advertise
// a value the TABLE CANNOT HOLD, because that gives a client a branch that never
// fires. Here the table can hold `deferred` and the response declines to carry
// it, which is the opposite direction and is what an allowlist is for.
//
// AN IMPLEMENTER WHO READ ONLY ADR-040 WOULD "FIX" THE UNION TO MATCH THE CHECK.
// `VERIFY_RESULTS` below is three members and it is declared `satisfies readonly
// VerificationResult[]` against `certificates.ts`' four, so the compiler proves
// the containment runs one way: a response value the table cannot record does
// not compile, and the table keeping a value the response declines is exactly
// what the ruling asks for.
//
// WHY THE LOG KEEPS THE FOURTH. A `deferred` row in that table is somebody
// holding a token that was never issued, which is an internal leak or a 128-bit
// guess that hit; an `unknown` row is a typo or `FM-M11-04` in progress. Those
// are different incidents and only the table can tell them apart, because
// `GET /certificates` withholds `code` while a certificate is deferred.
//
// -----------------------------------------------------------------------------
// THE CONSTANT-TIME MECHANISM IS A FLOOR AND IT IS NOT EQUAL WORK
// -----------------------------------------------------------------------------
// ADR-170 section 4.2: equalising the work cannot honour the clause, because
// with no application cache and one indexed equality on `certificates_code_uq`
// a hit on a warm row and a hit on a cold one still differ, and the database's
// own buffer cache reproduces that tension a layer below any application ruling.
//
// SO EVERY RESPONSE THIS HANDLER PRODUCES IS HELD UNTIL A FIXED FLOOR HAS
// ELAPSED, measured from the first line of the handler. The floor dominates a
// warm hit, a cold hit, a miss and a malformed token alike, and the
// `certificate_verifications` write is INSIDE it rather than after it.
//
// THE FLOOR IS CONFIG AND NOT A NUMBER STATED HERE, which is ADR-170's own
// wording: "set above the p99 of the slowest of those, measured, and it is
// configuration rather than a number stated here". A floor set from a p50 is
// worse than no floor, so `floor_ms` arrives on the port and the MEASUREMENT is
// owed by the deployment that sets it. `readPresentation` refuses a value that
// is not a positive whole number of milliseconds and BOUNDS IT NOWHERE ABOVE:
// no approved document gives an upper bound, and inventing one here would be
// this route choosing a latency budget the corpus has not chosen. That gap is
// reported rather than filled.
//
// AN OVERRUN IS LOGGED AND NEVER FAILED. At a p99 floor roughly one request in
// a hundred exceeds it by construction, so answering 500 on an overrun would
// turn the tail into a louder oracle than the one the floor closes.
//
// THE SIZE CHANNEL IS OPEN, IT IS NAMED, AND IT IS NOT A DEFECT. ADR-170
// section 4.3: an `unknown` body is smaller than a `valid` one and no padding of
// the clock closes that. It is redundant with the answer, because it separates a
// hit from a miss only for a caller who already sent a code and who learns the
// same thing from the body. Nothing here chases it.
//
// -----------------------------------------------------------------------------
// THE COPY IS RESOLVED BEFORE THE RESULT IS BRANCHED ON, AND THAT IS A TIMING
// CONTROL RATHER THAN TIDINESS
// -----------------------------------------------------------------------------
// `statement` is the only user-visible sentence this endpoint produces and it is
// rendered SERVER SIDE on every result (ADR-170 section 6.1): a client handed
// only the class would compose its own sentence and the second client to do it
// would compose a different one, which is the inconsistency `INV-M11-07` exists
// to prevent.
//
// ONE SENTENCE IS FIXED IN THIS FILE AND FIVE ARE SUPPLIED. `INV-M11-03` fixes
// the unknown wording verbatim, "no certificate with this code", so
// `UNKNOWN_STATEMENT` is a constant here and no deployment can override it into
// "this is fake". The `valid` sentence, the four revocation sentences and
// `INV-M11-04`'s disclosure are copy NO APPROVED DOCUMENT FIXES: M11 section 7
// describes what each says and `OQ-M11-02` records that the `account_enforced`
// wording is a legal and brand question still owed. Copy invented here would be
// this route answering that question in a string literal, which is
// `certificates.ts`' refusal to invent a digest constant applied to prose.
//
// SO THE WHOLE COPY TABLE IS VALIDATED ON EVERY PATH, BEFORE THE LOOKUP. If it
// were read lazily on the branch that needs it, a deployment with a wired source
// and missing copy would answer `unknown` in milliseconds and `valid` in a 503,
// which is a hit-versus-miss oracle built out of the configuration error rather
// than out of the clock. `readPresentation` runs first and refuses the whole
// table at once, so a missing sentence fails every code identically.
//
// -----------------------------------------------------------------------------
// EVERY LOOKUP IS RECORDED, AND A LOOKUP THAT CANNOT BE RECORDED DOES NOT ANSWER
// -----------------------------------------------------------------------------
// API_CONTRACT section 6.3: "Every lookup writes `certificate_verifications`
// (`SD-M11-04`) on every path including `unknown` and including a malformed
// token, whose `code_hash` is the hash of whatever arrived". So the write
// happens before the response is composed and a rejected write fails the
// request. Answering anyway would convert an outage of the log into the
// unmetered oracle `AS-M11-04` and `FM-M11-04` exist to watch, silently and only
// under load, which is when an enumeration campaign is worth running.
//
// WHAT THIS FILE HANDS THE SINK IS WHAT IT OBSERVED AND THE SINK HASHES.
// `0025` requires `code_hash` and `ip_hash` to be digests and NO APPROVED
// DOCUMENT FIXES THE DIGEST, so the observation carries the code in the clear
// and the sink computes both. That is `certificates.ts`' ruling and this file
// reuses its `CertificateObservation` type rather than declaring a second one.
//
// -----------------------------------------------------------------------------
// THE ROW CANNOT BE REACHED FROM THIS DEPLOYABLE, AND ONE ARM OF THE PORT CAN
// -----------------------------------------------------------------------------
// `apps/api/src/db.ts` opens exactly two doors, `scoped(identityId, fn)` and
// `firm(fn)`.
//
//   `lookup` REACHES NEITHER. This row is unauthenticated, so `scoped` has no
//   identity to open with, and `certificates` is scope class `owned` on
//   `identity_id` (`packages/db/src/scope.ts:757`), so `FirmTableKey` excludes
//   it and `firm` refuses the key at compile time.
//
//   `record` REACHES ONE. `certificate_verifications` is scope class `firm`
//   (`packages/db/src/scope.ts:1254`), so `db.firm` can write it today.
//
// A BACKEND WITH ONE LIVE ARM AND ONE THAT REJECTS IS WORSE THAN NO BACKEND, and
// this file writes none for that reason: it would put a live-looking route in
// front of the arm that refuses, and the arm that refuses is the one that
// answers the caller. `usePayoutBackend`'s entry in `test/wiring.test.ts` states
// the same refusal about a different pair of arms. The split is recorded in this
// port's `BLOCKED` entry so the day `lookup` has a door the entry shrinks rather
// than being rewritten.
// =============================================================================

import type { FastifyReply, FastifyRequest } from 'fastify';

import { defineRoutes } from '../registry.ts';
import type { RouteHandler } from '../registry.ts';
import { PROBLEM_MEDIA_TYPE, PROBLEM_TYPE_PREFIX } from '../server.ts';
import type { Problem } from '../server.ts';
import { CERTIFICATE_KINDS, REVOCATION_CLASSES, narrowClaims } from './certificates.ts';
import type {
  CertificateClaims,
  CertificateKind,
  CertificateObservation,
  RevocationClass,
  VerificationResult,
} from './certificates.ts';
import type { RequiredFactor } from './auth.ts';

/** API_CONTRACT section 6.3's path, as the contract writes it. */
export const VERIFY_PATH = '/verify/:code';

// -----------------------------------------------------------------------------
// The wire, section 6.3's own shapes
// -----------------------------------------------------------------------------

/**
 * The response's THREE members, where the log's are four.
 *
 * `deferred` IS NOT HERE AND MUST NOT BE ADDED. See this file's header,
 * API_CONTRACT section 6.3 and ADR-170 section 3.1 and foreclosure 1.
 *
 * `satisfies readonly VerificationResult[]` MAKES THE COMPILER PROVE THE
 * ASYMMETRY IS ONE-DIRECTIONAL. Every member here is also a member of
 * `certificate_verifications.result`'s four-value CHECK, so the response can
 * never carry a result the log has no row for; the reverse does not hold and is
 * the whole ruling. A future edit that added a fifth response value the table
 * cannot record would not compile.
 */
export const VERIFY_RESULTS = [
  'valid',
  'revoked',
  'unknown',
] as const satisfies readonly VerificationResult[];

/** One of {@link VERIFY_RESULTS}. */
export type VerifyResult = (typeof VERIFY_RESULTS)[number];

/**
 * Section 6.3's `certificate` block.
 *
 * `code` IS THE ROW'S TOKEN AND NEVER `certificates.id`. `0020` keeps the two
 * distinct "so the public token can be ROTATED AFTER AN INCIDENT", and
 * publishing the immutable key beside the rotatable one defeats the rotation:
 * a holder who kept `id` can still correlate the certificate after the token
 * they were told to forget has changed.
 */
export interface VerifiedCertificate {
  readonly code: string;
  readonly kind: CertificateKind;
  readonly issued_at: string;
  readonly claims: CertificateClaims;
  /** `SD-M11-01`. Which claim shape was signed. */
  readonly claims_schema_version: number;
  /** base64url over the canonical claims. The column is `bytea NOT NULL`. */
  readonly signature: string;
  /** `INV-M11-06`. Rotation never invalidates history. */
  readonly signing_key_id: string;
  /** `INV-M11-04`, rendered by template. Supplied; see this file's header. */
  readonly disclosure: string;
}

/** Section 6.3's `revoked` block. Non-null exactly when `result` is `revoked`. */
export interface VerifiedRevocation {
  readonly at: string;
  /** For BRANCHING, never for composing copy. `INV-M11-07`. */
  readonly class: RevocationClass;
}

/**
 * Section 6.3's `VerifyResponse`.
 *
 * THE SHAPE IS THE SAME ON ALL THREE RESULTS except for the two nullable
 * blocks, which is the property ADR-170 section 6.1 names: a revoked
 * certificate still returns its claims on all four classes, so the response's
 * SHAPE never discloses more than its `result` field already does.
 */
export interface VerifyResponse {
  readonly result: VerifyResult;
  /** The only user-visible sentence, rendered server side on every result. */
  readonly statement: string;
  /** `null` exactly when `result` is `unknown`. */
  readonly certificate: VerifiedCertificate | null;
  /** Non-null exactly when `result` is `revoked`. */
  readonly revoked: VerifiedRevocation | null;
}

/**
 * `INV-M11-03`'s EXACT WORDING, and the one sentence this file fixes.
 *
 * M11 `INV-M11-03`: *"An unknown code returns 'no certificate with this code',
 * never 'this is fake'"*, and its why column is the whole argument: *"The honest
 * claim is the defensible one, and Merit cannot know that a card it did not
 * issue is a forgery rather than a typo."*
 *
 * IT IS A CONSTANT AND NOT A SUPPLIED STRING because an approved document fixes
 * it verbatim. Every other sentence on this surface is copy no document fixes
 * (see {@link VerifyStatements}), and the difference is exactly that: a
 * deployment may choose the wording it owes and may not choose this one.
 */
export const UNKNOWN_STATEMENT = 'no certificate with this code';

// -----------------------------------------------------------------------------
// The row, as this file reads it off the port
// -----------------------------------------------------------------------------

/**
 * One `certificates` row, narrowed to what section 6.3 publishes.
 *
 * THREE COLUMNS ARE ABSENT BY CONSTRUCTION AND EACH IS FORECLOSED BY NAME.
 * `id` and `payout_request_id` and `revoked_reason` are real columns of
 * `certificates` and none of them has a field here, so no projection in this
 * file can reach one and no later edit can add one by widening a spread.
 * ADR-170 section 3 and foreclosure 5. `identity_id`, `account_id`,
 * `deferred_reason` and `created_at` are absent for the same structural reason
 * and are not published either.
 *
 * `deferredUntil` IS PRESENT AND IS NEVER PUBLISHED. It is what maps a deferred
 * row onto `unknown` on the wire and onto `deferred` in the log, which is the
 * asymmetry section 3.1 rules. A row type without it could not tell the two
 * incidents apart, which is the whole reason the log's union is four.
 */
export interface VerifyRow {
  readonly kind: CertificateKind;
  readonly claims: CertificateClaims;
  readonly code: string;
  /** RFC 3339 UTC, rendered by ONE code path so lexical order is chronological. */
  readonly issuedAt: string;
  readonly claimsSchemaVersion: number;
  /** `certificates.signature`, `bytea NOT NULL`. Encoded base64url on the wire. */
  readonly signature: Uint8Array;
  readonly signingKeyId: string;
  readonly revokedAt: string | null;
  readonly revocationClass: RevocationClass | null;
  /** NEVER PUBLISHED. It decides `unknown` on the wire and `deferred` in the log. */
  readonly deferredUntil: string | null;
}

/** Raised when a row cannot be read as one. Every case is a defect, so a 500. */
export class VerifyRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerifyRowError';
  }
}

function asRow(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new VerifyRowError(
      'the source returned something that is not a `certificates` row. A verification built ' +
        'from it would state whatever the value happened to carry, over Merit signature',
    );
  return value as Record<string, unknown>;
}

function text(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value === '')
    throw new VerifyRowError(
      `\`certificates.${field}\` is not a non-empty string. The column is \`text NOT NULL\``,
    );
  return value;
}

function instant(value: unknown, field: string): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime()))
    throw new VerifyRowError(
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
    throw new VerifyRowError(
      `\`certificates.${field}\` is \`${String(value)}\`, which the column's own CHECK closes ` +
        `at ${allowed.join(' | ')}`,
    );
  return value as T;
}

/** `certificates.signature`, which is `bytea NOT NULL` and therefore bytes. */
function signatureBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length === 0)
    throw new VerifyRowError(
      '`certificates.signature` is not a non-empty byte string. The column is `bytea NOT NULL`, ' +
        'and `INV-M11-02` makes the offline check a convenience this row is the only one to ' +
        'serve, so an empty signature is a convenience that verifies nothing',
    );
  return value;
}

/**
 * One source row, narrowed. Exported so the suite names it directly.
 *
 * `certificates_revocation_is_complete` IS RE-ASSERTED HERE OVER THE PUBLISHED
 * HALF rather than trusted, because the source is an INTERFACE and not the
 * database, and because a half-written revocation renders as a certificate that
 * says it was revoked and cannot say under what. The constraint's third column,
 * `revoked_reason`, is not read here at all: it has no field on {@link
 * VerifyRow}, so the database checks it and this file structurally cannot.
 */
export function toVerifyRow(value: unknown): VerifyRow {
  const row = asRow(value);
  const kind = member(row['kind'], CERTIFICATE_KINDS, 'kind');

  const revokedAt = nullableInstant(row, 'revokedAt');
  const rawClass = row['revocationClass'];
  const revocationClass =
    rawClass === null || rawClass === undefined
      ? null
      : member(rawClass, REVOCATION_CLASSES, 'revocation_class');

  if ((revokedAt === null) !== (revocationClass === null))
    throw new VerifyRowError(
      'a `certificates` row carries ' +
        (revokedAt === null ? 'a revocation class with no `revoked_at`' : 'no revocation class') +
        '. `certificates_revocation_is_complete` writes the class and the timestamp together, ' +
        'and the class is what drives the PUBLISHED sentence (`INV-M11-07`)',
    );

  const rawVersion = row['claimsSchemaVersion'];
  if (typeof rawVersion !== 'number' || !Number.isSafeInteger(rawVersion) || rawVersion <= 0)
    throw new VerifyRowError(
      `\`certificates.claims_schema_version\` is \`${String(rawVersion)}\`. The column is ` +
        '`integer NOT NULL DEFAULT 1 CHECK (claims_schema_version > 0)`, and it is what tells a ' +
        'third party which claim shape was signed (`SD-M11-01`)',
    );

  return {
    kind,
    claims: narrowClaims(row['claims'], kind),
    code: text(row, 'code'),
    issuedAt: instant(row['issuedAt'], 'issuedAt'),
    claimsSchemaVersion: rawVersion,
    signature: signatureBytes(row['signature']),
    signingKeyId: text(row, 'signingKeyId'),
    revokedAt,
    revocationClass,
    deferredUntil: nullableInstant(row, 'deferredUntil'),
  };
}

// -----------------------------------------------------------------------------
// The two results, and they are derived from the same row by different rules
// -----------------------------------------------------------------------------

/**
 * What `certificate_verifications.result` records, which is FOUR values.
 *
 * REVOCATION TAKES PRECEDENCE OVER DEFERRAL, which is `certificates.ts`'
 * `deriveState` and its stated argument: `certificates_deferral_is_explained`
 * and `certificates_revocation_is_complete` each constrain their own half and
 * neither forbids both being set, so a deferral that was later revoked is a
 * representable row; revocation is terminal where a deferral is a wait, and a
 * revoked row is guaranteed to carry the class that drives its published
 * sentence. THE PRECEDENCE IS NOT RE-DECIDED HERE. It is the reading
 * `certificates.ts` already reported as a finding the corpus does not settle,
 * and two files answering it two ways would be worse than either answer.
 */
export function logResult(row: VerifyRow | null): VerificationResult {
  if (row === null) return 'unknown';
  if (row.revokedAt !== null) return 'revoked';
  if (row.deferredUntil !== null) return 'deferred';
  return 'valid';
}

/**
 * What the wire carries, which is THREE values.
 *
 * `deferred` COLLAPSES ONTO `unknown` AND NOTHING ELSE DOES. ADR-170 section
 * 3.1: nobody legitimately holds a deferred code, the trader's own need is
 * already served authenticated by `GET /certificates`, and `INV-M11-09` defers
 * exactly on an open severity 4+ flag, so a public `deferred` answer would tell
 * whoever holds the token that the account behind it is under risk review,
 * which M07 does not publish.
 */
export function responseResult(logged: VerificationResult): VerifyResult {
  return logged === 'deferred' ? 'unknown' : logged;
}

// -----------------------------------------------------------------------------
// The copy and the clock, which arrive together and are checked together
// -----------------------------------------------------------------------------

/**
 * The five sentences no approved document fixes.
 *
 * `unknown` IS ABSENT ON PURPOSE: `INV-M11-03` fixes it verbatim and
 * {@link UNKNOWN_STATEMENT} is that wording, so it is not a deployment's to
 * choose. The four revocation keys are `certificates.revocation_class`'s CHECK,
 * in the CHECK's order, so a class the column admits always has a sentence and
 * `readPresentation` can check that mechanically.
 *
 * `account_enforced` IS `OQ-M11-02` AND ITS COPY IS OWED. M11 section 7 gives
 * the sense of each sentence and ADR-170 finding 14 records that the exact
 * `account_enforced` wording is a legal and brand question still open. The field
 * is typed here and the copy is not this file's.
 */
export interface VerifyStatements {
  readonly valid: string;
  readonly fact_untrue: string;
  readonly account_enforced: string;
  readonly issued_in_error: string;
  readonly trader_request: string;
}

/**
 * Everything the deployment configures, read as one value on every path.
 *
 * READ BEFORE THE LOOKUP AND VALIDATED IN FULL, which is a timing control. See
 * this file's header: a copy table read lazily on the branch that needs it turns
 * a configuration error into a hit-versus-miss oracle.
 */
export interface VerifyPresentation {
  readonly statements: VerifyStatements;
  /** `INV-M11-04`, rendered by template. One disclosure for every kind. */
  readonly disclosure: string;
  /**
   * The measured floor, in whole milliseconds.
   *
   * CONFIG RATHER THAN A NUMBER STATED HERE (ADR-170 section 4.2). What this
   * file enforces is that it is a positive whole number of milliseconds and
   * NOTHING ABOUT ITS SIZE: no approved document bounds it above, and a bound
   * invented here would be this route choosing a latency budget the corpus has
   * not chosen. The p99 MEASUREMENT is owed by whoever sets the value.
   */
  readonly floor_ms: number;
}

/** Raised when the configured copy or floor cannot be used. Every case is a defect. */
export class VerifyPresentationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerifyPresentationError';
  }
}

/** The five statement keys, so the check below is over data rather than five `if`s. */
const STATEMENT_KEYS = [
  'valid',
  ...REVOCATION_CLASSES,
] as const satisfies readonly (keyof VerifyStatements)[];

/**
 * Refuse a presentation this endpoint cannot answer with, TOTALLY.
 *
 * IT CHECKS EVERY FIELD EVEN THOUGH ONE REQUEST USES AT MOST TWO OF THEM. That
 * is the point: partial validation is what makes a missing `account_enforced`
 * sentence a failure only for the codes that were enforced, which is a
 * disclosure about those codes carried by a 500.
 */
export function readPresentation(value: unknown): VerifyPresentation {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new VerifyPresentationError(
      'the source supplied no presentation. `statement` is rendered server side on every result ' +
        '(`INV-M11-07`), so an endpoint with no copy has no answer to give',
    );
  const row = value as Record<string, unknown>;

  const rawStatements = row['statements'];
  if (typeof rawStatements !== 'object' || rawStatements === null || Array.isArray(rawStatements))
    throw new VerifyPresentationError(
      '`presentation.statements` is not an object. It carries one sentence for `valid` and one ' +
        `for each of ${REVOCATION_CLASSES.join(', ')}`,
    );
  const supplied = rawStatements as Record<string, unknown>;

  const statements: Record<string, string> = {};
  for (const key of STATEMENT_KEYS) {
    const sentence = supplied[key];
    if (typeof sentence !== 'string' || sentence.trim() === '')
      throw new VerifyPresentationError(
        `\`presentation.statements.${key}\` is not a non-empty sentence. Every sentence is ` +
          'checked on every path, because a sentence missing only for the result it describes ' +
          'is a hit-versus-miss oracle built out of the configuration error',
      );
    statements[key] = sentence;
  }

  const disclosure = row['disclosure'];
  if (typeof disclosure !== 'string' || disclosure.trim() === '')
    throw new VerifyPresentationError(
      '`presentation.disclosure` is not a non-empty sentence. `INV-M11-04` requires the ' +
        'simulated-environment disclosure on every certificate, in the image and on this page, ' +
        'and it is rendered by template so a new kind cannot omit it by being new',
    );

  const floor = row['floor_ms'];
  if (typeof floor !== 'number' || !Number.isSafeInteger(floor) || floor <= 0)
    throw new VerifyPresentationError(
      `\`presentation.floor_ms\` is \`${String(floor)}\`, which is not a positive whole number ` +
        'of milliseconds. `INV-M11-05` names this endpoint and the mechanism is a measured floor ' +
        '(ADR-170 section 4.2), so an absent or zero floor is the clause unhonoured',
    );

  return {
    statements: {
      valid: statements['valid'] ?? '',
      fact_untrue: statements['fact_untrue'] ?? '',
      account_enforced: statements['account_enforced'] ?? '',
      issued_in_error: statements['issued_in_error'] ?? '',
      trader_request: statements['trader_request'] ?? '',
    },
    disclosure,
    floor_ms: floor,
  };
}

// -----------------------------------------------------------------------------
// The port
// -----------------------------------------------------------------------------

/**
 * What this endpoint needs from the world.
 *
 * ONE READ, ONE SINK AND THE DEPLOYMENT'S CONFIGURATION, which is
 * `certificates.ts`' `CertificateBackend` shape: a read plus the thing the
 * deployable does not hold. See this file's header for which arm has a door
 * today and which does not.
 */
export interface VerifySource {
  /** `null` when no row carries this code. `INV-M11-02`: the row is the authority. */
  lookup(code: string): Promise<VerifyRow | null>;
  /** Append one `certificate_verifications` row. Rejecting fails the lookup. */
  record(observation: CertificateObservation): Promise<void>;
  /** The configured copy and floor. Read on EVERY path, before the branch. */
  presentation(): VerifyPresentation;
}

/** Raised when the source is not wired. Answered 503, never an answer about a code. */
export class VerifySourceUnwired extends Error {
  constructor(method: string) {
    super(
      `VerifySource.${method} is not wired, so \`GET /verify/:code\` answers 503 rather than ` +
        "`unknown`. An `unknown` here is `INV-M11-03`'s claim that Merit issued no certificate " +
        "with this code, which is a statement about Merit's book rather than about this deployment",
    );
    this.name = 'VerifySourceUnwired';
  }
}

/**
 * The fail-closed default. ALL THREE ARMS REFUSE.
 *
 * A `presentation` that returned plausible copy beside a `lookup` that refused
 * would be a half-wired deployment that looks wired in a unit test, which is
 * `UNWIRED_CERTIFICATE_BACKEND`'s stated reason for refusing in both halves.
 */
export const UNWIRED_VERIFY_SOURCE: VerifySource = {
  lookup: () => Promise.reject(new VerifySourceUnwired('lookup')),
  record: () => Promise.reject(new VerifySourceUnwired('record')),
  presentation: () => {
    throw new VerifySourceUnwired('presentation');
  },
};

let source: VerifySource = UNWIRED_VERIFY_SOURCE;

/** Install the source. The wiring slice calls this; so does the suite. */
export function useVerifySource(next: VerifySource): void {
  source = next;
}

/** Restore the fail-closed default. */
export function resetVerifySource(): void {
  source = UNWIRED_VERIFY_SOURCE;
}

/** The installed source. */
export function currentVerifySource(): VerifySource {
  return source;
}

// -----------------------------------------------------------------------------
// The response
// -----------------------------------------------------------------------------

/**
 * Section 6.3's response, built field by field.
 *
 * THE CLAIMS ARE REBUILT RATHER THAN PASSED THROUGH, so a `claims` shape that
 * grew a key between `narrowClaims` and here cannot ride along. That is
 * section 1's allowlist obtained structurally, on a public surface where the
 * column underneath is `jsonb NOT NULL` and the database constrains nothing
 * about its keys.
 *
 * A REVOKED CERTIFICATE STILL RETURNS ITS CLAIMS, ON ALL FOUR CLASSES.
 * `AS-M11-05`: for `account_enforced` *"the claim stands and the account was
 * later closed under a named ToS clause ... It does not say the certificate is
 * invalid, because it is not"*. A page that withheld the claim on revocation
 * would be the retroactive denial that scenario exists to make impossible, and
 * it would do it to `fact_untrue` as well, where the holder already has a card
 * printed with the claim and would be left comparing it against a blank page.
 */
export function renderVerify(
  row: VerifyRow | null,
  presentation: VerifyPresentation,
): VerifyResponse {
  const result = responseResult(logResult(row));
  if (row === null || result === 'unknown')
    return {
      result: 'unknown',
      statement: UNKNOWN_STATEMENT,
      certificate: null,
      revoked: null,
    };

  const claims = row.claims;
  const certificate: VerifiedCertificate = {
    // THE ROW'S TOKEN AND NOT THE ATTEMPTED ONE. They are equal on every path
    // that reaches here, because the lookup resolved the row from the token;
    // reading it off the row is what makes that true by construction rather
    // than by the caller's spelling.
    code: row.code,
    kind: row.kind,
    issued_at: row.issuedAt,
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
    claims_schema_version: row.claimsSchemaVersion,
    signature: Buffer.from(row.signature).toString('base64url'),
    signing_key_id: row.signingKeyId,
    disclosure: presentation.disclosure,
  };

  if (result === 'valid')
    return {
      result: 'valid',
      statement: presentation.statements.valid,
      certificate,
      revoked: null,
    };

  /* c8 ignore next 3 */
  // `logResult` returns `revoked` only when both are set, and `toVerifyRow`
  // refuses a row carrying one without the other.
  if (row.revokedAt === null || row.revocationClass === null)
    throw new VerifyRowError('a revoked result carries no revocation. This is unreachable');

  return {
    result: 'revoked',
    // SERVER RENDERED, ALWAYS. The class ships beside it for branching and
    // never for copy: a client handed only the class would compose its own
    // sentence, and the second client to do it would compose a different one
    // (`INV-M11-07`, ADR-170 foreclosure 7).
    statement: presentation.statements[row.revocationClass],
    certificate,
    revoked: { at: row.revokedAt, class: row.revocationClass },
  };
}

// -----------------------------------------------------------------------------
// The floor
// -----------------------------------------------------------------------------

/** Nanoseconds per millisecond, so the arithmetic below is integer throughout. */
const NS_PER_MS = 1_000_000n;

/** Whole milliseconds elapsed since a `process.hrtime.bigint()` reading. */
export function elapsedMs(startedNs: bigint, nowNs: bigint): number {
  const delta = nowNs - startedNs;
  return delta <= 0n ? 0 : Number(delta / NS_PER_MS);
}

/**
 * How long is left of the floor, in whole milliseconds.
 *
 * A PURE FUNCTION SO THE MECHANISM IS TESTABLE WITHOUT A CLOCK. The floor is
 * what makes `INV-M11-05`'s clause hold, so it is the one part of this file that
 * a suite has to be able to assert on directly rather than by measuring a
 * wall clock and hoping.
 */
export function remainingFloorMs(elapsed: number, floorMs: number): number {
  return elapsed >= floorMs ? 0 : floorMs - elapsed;
}

/** Wait, or return immediately when there is nothing left to wait for. */
function pause(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Hold the response until the floor has elapsed.
 *
 * AN OVERRUN IS LOGGED AND NEVER FAILED. The floor is set above a MEASURED p99
 * (ADR-170 section 4.2), so roughly one request in a hundred exceeds it by
 * construction; answering 500 on the tail would replace a closed channel with a
 * louder one. The log line is what makes a floor that has drifted below its own
 * p99 visible to the deployment that owes the measurement.
 */
export async function holdFloor(
  request: FastifyRequest,
  startedNs: bigint,
  floorMs: number,
): Promise<void> {
  const elapsed = elapsedMs(startedNs, process.hrtime.bigint());
  const remaining = remainingFloorMs(elapsed, floorMs);
  if (remaining === 0 && elapsed > floorMs)
    request.log.warn(
      { elapsed_ms: elapsed, floor_ms: floorMs },
      'verify lookup exceeded its constant-time floor; the floor is a measured p99 ceiling ' +
        '(INV-M11-05, ADR-170 section 4.2) and a floor below its own p99 leaks on the tail',
    );
  await pause(remaining);
}

// -----------------------------------------------------------------------------
// The handler
// -----------------------------------------------------------------------------

/** Section 2's shape, built here. `service_unavailable` is a handler code. */
function serviceUnavailable(instance: string): Problem {
  return {
    type: `${PROBLEM_TYPE_PREFIX}service_unavailable`,
    title: 'Service unavailable',
    status: 503,
    code: 'service_unavailable',
    instance,
  };
}

/**
 * `Cache-Control` for every response this route produces, refusals included.
 *
 * `no-store` AND THE REVOCATION DESIGN REQUIRES IT BEFORE THE CLOCK DOES.
 * `FM-M11-05`'s remedy caches RENDERED BYTES keyed by `(code, row_version)` and
 * is the image row's; this row renders no bytes and does not inherit it
 * (ADR-170 section 4.1, foreclosure 4). The stronger reason is `FM-M11-02`: the
 * verify code inside a circulating image IS the recovery path when the image was
 * screenshotted, so an intermediary serving a cached `valid` for a code revoked
 * five minutes ago fails at the one surface that was supposed to be
 * authoritative. `INV-M11-02`: the row is the authority, and a cached answer is
 * not the row.
 */
export const VERIFY_CACHE_CONTROL = 'no-store';

/**
 * `GET /verify/:code`. Auth: NONE.
 *
 * A BARE `RouteHandler` RATHER THAN AN `EndpointSpec`, which is
 * `certificates.ts`' image row's shape and its reason: `endpointHandler`
 * resolves a session from the cookie BEFORE it reads the declared factor, and a
 * verification page reached from the portal's own origin carries a logged-in
 * trader's `merit_session` on every request. Under an `EndpointSpec` this public
 * page would resolve a session it has no use for, an unwired auth backend would
 * turn it into a 503, and ADR-170 section 8 additionally requires that **the
 * response is byte-identical with and without a session**, since an endpoint
 * that enriched its answer for the owner would be an oracle that distinguishes
 * its callers. NOTHING IN THIS HANDLER READS A HEADER.
 *
 * THERE IS NO SHAPE CHECK ON `:code` AND ITS ABSENCE IS THE CONTROL. A token of
 * the wrong length or alphabet answers `unknown`, identically and at the same
 * floor. A check that short-circuited ahead of the lookup would be a faster path
 * AND would hand an attacker the token's alphabet and length for free, which is
 * `INV-M11-05`'s non-enumerability half failing beside its timing half.
 * ADR-170 foreclosure 3.
 */
export const verifyHandler: RouteHandler = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> => {
  const startedNs = process.hrtime.bigint();
  const wired = source;

  // FIRST, AND BEFORE ANY CODE IS LOOKED AT. See this file's header: a copy
  // table validated lazily makes a configuration error into an oracle. This is
  // also the one refusal that is NOT held to the floor, because it is the same
  // refusal for every code and holds no information about any of them.
  let presentation: VerifyPresentation;
  try {
    presentation = readPresentation(wired.presentation());
  } catch (err) {
    return refuseOrThrow(err, request, reply, null);
  }

  const params = request.params as { code?: unknown };
  // AN EMPTY SEGMENT CANNOT REACH HERE THROUGH THE ROUTER and it is not handed
  // to the lookup as an empty predicate either. It resolves as `unknown` like
  // any other token that names no row, at the same floor, so the shortcut
  // discloses nothing: the floor is what is observable and it does not move.
  const code = typeof params.code === 'string' ? params.code : '';

  const ip = request.ip === '' ? null : request.ip;

  try {
    const row = code === '' ? null : await wired.lookup(code);
    const logged = logResult(row);

    // THE WRITE HAPPENS BEFORE THE RESPONSE IS COMPOSED, AND A REJECTED WRITE
    // FAILS THE LOOKUP. Answering anyway converts an outage of the log into the
    // unmetered oracle `AS-M11-04` and `FM-M11-04` exist to watch. It is INSIDE
    // the floor's budget, so an insert that is the same work on every path costs
    // nothing observable and the anomaly detector sees the whole population
    // rather than the resolvable part of it.
    await wired.record({ code, result: logged, ip });

    const body = renderVerify(row, presentation);
    await holdFloor(request, startedNs, presentation.floor_ms);
    return reply.code(200).header('Cache-Control', VERIFY_CACHE_CONTROL).send(body);
  } catch (err) {
    return refuseOrThrow(err, request, reply, { startedNs, floorMs: presentation.floor_ms });
  }
};

/**
 * An unfinished deployment is a 503 and never a 500. Anything else is the
 * transport's.
 *
 * A REFUSED PRESENTATION IS THE SAME CASE AS AN UNWIRED PORT and is answered the
 * same way. `readPresentation` refuses only what the deployment configured, so
 * a missing sentence or an absent floor is a deploy that has not been finished
 * rather than a defect in a request, and it is identical for every code because
 * it is read before the lookup. A `VerifyRowError` is NOT in this set: that is a
 * row the source handed over that cannot be published, which is a real defect
 * and answers 500 through the transport.
 */
async function refuseOrThrow(
  err: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
  floor: { readonly startedNs: bigint; readonly floorMs: number } | null,
): Promise<FastifyReply> {
  if (!(err instanceof VerifySourceUnwired) && !(err instanceof VerifyPresentationError)) throw err;
  request.log.error({ err }, 'verify source is not wired or is not configured');
  // HELD TO THE FLOOR WHEN THERE IS ONE, so the refusal is not a faster path
  // than an answer. There is no floor before the presentation is read, and that
  // refusal is identical for every code.
  if (floor !== null) await holdFloor(request, floor.startedNs, floor.floorMs);
  return reply
    .code(503)
    .type(PROBLEM_MEDIA_TYPE)
    .header('Cache-Control', VERIFY_CACHE_CONTROL)
    .send(serviceUnavailable(request.id));
}

// -----------------------------------------------------------------------------
// The declaration
// -----------------------------------------------------------------------------

/**
 * The declaration as data, so a later negative-authz gate can read the row.
 *
 * `none` is section 12's own token for an endpoint that requires nothing.
 * ADR-170 section 8 names section 12's certificate rows as OWED AS ONE SLICE
 * covering all four certificate endpoints at once, and records the interesting
 * assertion for this row: not the `401` the matrix's first row already covers
 * for other prefixes, but that the response is BYTE-IDENTICAL with and without
 * a session. Nothing here writes that matrix row; this table is what it will
 * read.
 */
export const VERIFY_REQUIRED_FACTORS: Readonly<Record<string, RequiredFactor>> = {
  [`GET ${VERIFY_PATH}`]: 'none',
};

export default defineRoutes({
  name: 'verify',
  routes: [{ method: 'GET', path: VERIFY_PATH, handler: verifyHandler }],
});
