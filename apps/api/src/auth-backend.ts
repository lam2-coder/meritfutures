// =============================================================================
// apps/api/src/auth-backend.ts
// =============================================================================
// `AuthBackend` AGAINST THE REAL ACCESSOR. ADR-120, and the count is reported
// honestly at the top rather than discovered at the bottom: FOUR of the port's
// sixteen methods are implemented here and TWELVE raise, each naming its own
// blocker.
//
// -----------------------------------------------------------------------------
// THE MEASUREMENT THIS FILE OPENS WITH
// -----------------------------------------------------------------------------
// `routes/auth.ts`'s header lists the three writes this surface could not
// express and ADR-112 built the construction for all three. Wiring them found
// something the dispatch did not predict and it is one sentence:
//
//   ADR-112 UNBLOCKED EVERYTHING A SESSION CAN DO AND NOTHING THAT MAKES ONE.
//
// Reading a session, revoking one, listing them, stamping one: all four are an
// ADDRESS through the scoped door and all four land. MINTING one did not, and
// neither did resolving a person from the address they typed. Two constructions
// were missing and neither was a predicate:
//
//   B1  A PRE-IDENTITY READ HAS NO DOOR.
//   B2  A SESSION ROW CANNOT BE INSERTED AT ANY AUTHORITY A HANDLER HOLDS.
//
// BOTH ARE DISCHARGED AND THIS PARAGRAPH SPENT SEVERAL SESSIONS SAYING
// OTHERWISE. ADR-126 built `resolutionDb` for B1 -- in its own docblock's words,
// "because `POST /auth/verify` must turn the address a person typed into the
// identity that owns it" -- and `insertUnder` for B2, whose one-member table
// vocabulary is `sessions`. The refusal strings below went on citing both, so a
// live 503's log line told an operator that a door had not been built which had.
// ADR-196 finding 2 reported the first; ADR-197 found the second stale beside it
// and repairs both.
//
// AND THE FIRST WAS HALF TRUE FOR A REASON WORTH KEEPING. `resolutionDb` was
// never added to `packages/db/src/index.ts`, and `db.ts` is the one file in this
// deployable that takes a handle off that package, so the endpoint the door was
// built for could not import it: the refusal was true of the package SURFACE
// while being false of the package. ADR-197 exports it. That is the shape a
// stale refusal takes when it is nobody's fence to repair -- it stops being
// checkable rather than becoming wrong.
//
// So `POST /auth/verify` still answers 503 on a tree where `POST /auth/logout`
// answers 204, and the reason is now that nobody has written the handler:
// ADR-196 section 7 item 4, the smallest of that entry's four and the last.
//
// -----------------------------------------------------------------------------
// THE SESSION TOKEN CARRIES ITS OWN IDENTITY, AND THAT IS A RULING
// -----------------------------------------------------------------------------
// `sessionByToken` has to find a row before any identity is known, which B1 says
// no door serves. The token is therefore `<identityId>.<secret>` and the stored
// `refresh_token_hash` is a digest of the WHOLE string, so:
//
//   the prefix is a HINT AND NOT AN AUTHORITY. Rewriting it to another
//   identity's changes the digest, so the address matches no row at all; and if
//   it somehow did, `scopedTx` ANDs the tenancy predicate onto the address, so
//   the row still does not come back. TWO INDEPENDENT REFUSALS, one
//   cryptographic and one ADR-112's composition.
//
//   THE IDENTITY IS NOT READ OFF THE ROW, IT IS PROVED BY THE ROW COMING BACK.
//   `sessions` carries `user_id` and no `identity_id`; the scope predicate is an
//   EXISTS over `users`, so a returned row IS the proof that this session
//   belongs to the identity the token claimed.
//
// IT DISCLOSES NOTHING NEW. API_CONTRACT section 3 puts `identity_id` in
// `VerifyResponse` and in `Me`, so the client already holds the value the cookie
// now also carries.
//
// **THERE IS NO MINTER IN THIS FILE AND ITS ABSENCE IS NO LONGER B2.** The rule
// that kept it out is `job-queue.ts`'s -- a primitive admitted before a caller
// exists is a primitive nobody can remove -- and the sentence under it was
// "nothing can insert the row it would be minted for". THAT SENTENCE IS FALSE
// SINCE ADR-126: `insertUnder` inserts a `sessions` row at a scoped handle by
// proving its parent. What is missing now is the CALLER rather than the
// capability, and the caller is the handler ADR-196 section 7 item 4 names. What
// IS written is the parser and the digest, and a minter that ever lands must
// produce its token through {@link sessionTokenHash} and
// {@link SESSION_TOKEN_SEPARATOR} rather than by respelling the format.
//
// -----------------------------------------------------------------------------
// EVERY REFUSAL RAISES `AuthBackendUnwired` AND CARRIES ITS OWN REASON
// -----------------------------------------------------------------------------
// `endpointHandler` answers 503 for that class and logs the error, so a route
// this deployment cannot serve says so with a reason in the log line rather than
// in the response body -- API_CONTRACT section 2 keeps internals out of a
// problem document. One error class and twelve different reasons is what makes
// a 503 from `POST /auth/verify` a different fact from a 503 from
// `POST /auth/passkey/login/options`.
// =============================================================================

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import type { ApiDb } from './db.ts';
import { isIdentityId } from './db.ts';
import { AUTH_FACTORS, AuthBackendUnwired, ELEVATION_FACTORS } from './routes/auth.ts';
import type {
  AuthBackend,
  AuthFactor,
  AuthSession,
  ElevationFactor,
  SessionRow,
} from './routes/auth.ts';
import type { Environment } from './surface.ts';

/**
 * Raised when a row this surface read violates a CHECK its own DDL declares.
 *
 * NOT AN `AuthBackendUnwired` AND THEREFORE NOT A 503. A 503 says "this
 * deployment does not serve that yet", which would be a lie about a database
 * that stored a value its constraints forbid. This is a 500 and it should be:
 * the caller's session is not the thing that is wrong.
 */
export class AuthRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthRowError';
  }
}

// -----------------------------------------------------------------------------
// The token
// -----------------------------------------------------------------------------

/**
 * What separates the identity claim from the secret.
 *
 * A `.` because a UUID contains none, so the split is unambiguous at the FIRST
 * occurrence and a secret containing more of them costs nothing.
 */
export const SESSION_TOKEN_SEPARATOR = '.';

/**
 * `sessions.refresh_token_hash`, over the WHOLE token.
 *
 * OVER THE WHOLE STRING AND NOT OVER THE SECRET ALONE, which is the first of the
 * two refusals in this file's header: hashing only the secret would leave the
 * identity claim unbound, and a token whose prefix has been swapped would then
 * still find its row and be refused only by the scope predicate. One refusal is
 * a control; two independent ones is a control that survives a mistake in the
 * other.
 *
 * SHA-256 IS SUFFICIENT HERE AND IS NOT SUFFICIENT FOR AN OTP, and the
 * difference is the input rather than the algorithm: this digest is taken over a
 * high-entropy secret a minter generated, where `otp_challenges.code_hash` is
 * taken over a short code a human types. See `verifyOtp`'s refusal below.
 */
export function sessionTokenHash(token: string): Uint8Array {
  return createHash('sha256').update(token, 'utf8').digest();
}

/** The identity a token claims, or `null` when the token is not one of ours. */
export function parseSessionToken(token: string): { readonly identityId: string } | null {
  const cut = token.indexOf(SESSION_TOKEN_SEPARATOR);
  if (cut <= 0 || cut === token.length - 1) return null;
  const identityId = token.slice(0, cut);
  // REFUSED HERE RATHER THAN AT THE DOOR so an attacker-supplied cookie never
  // reaches the accessor at all. `db.ts` refuses it a second time, which is
  // deliberate: this one is about a request and that one is about a call site.
  if (!isIdentityId(identityId)) return null;
  return { identityId };
}

// -----------------------------------------------------------------------------
// The OTP digest, and the key it is taken under
// -----------------------------------------------------------------------------
// ADR-197 rulings 1 and 2. `otp_challenges.code_hash bytea NOT NULL`
// (`0002_identity.sql:311`) says only "NEVER store the code itself", and the
// code is a six-digit one a human types: a plain hash of it is a
// one-million-candidate offline break for anybody holding the table. This is
// the keyed MAC that answers it, and the key is a DEPLOYMENT SECRET rather than
// a row.
//
// WHY NOT A ROW, IN ONE SENTENCE THAT IS MECHANICAL RATHER THAN AESTHETIC. The
// role that verifies is `merit_app`, `0026_roles_and_grants.sql` gives it
// table-level SELECT, and a table-level SELECT implies every column -- so a key
// table would be readable by exactly the role that reads `otp_challenges`, and
// the dump that yields the digests would yield the key that opens them. ADR-046
// ruled the same shape one table over: "A key registry in the same database as
// the ciphertext is one dump away from being a key ceremony."
//
// THE ROTATION COST THAT ARGUES FOR A ROW IS BOUNDED TO THE TTL AND THEREFORE
// NEEDS NO COLUMN. `otp_challenges.expires_at` is a "short TTL, 10 minutes"
// (`0002_identity.sql:313`), so the only rows a key must still open are the ones
// that can still verify. A rotation admits two keys for one TTL and then retires
// the old one, which is INFRA section 7's own "delay window before the old
// credential is revoked, so a rotation cannot itself become an outage" with an
// upper bound the schema states. That is why {@link resolveOtpMacKeys} returns a
// LIST and why `otp_challenges` needs no `key_id`.

/** Raised when a key, or the absence of one, makes a digest unsafe to take. */
export class OtpKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OtpKeyError';
  }
}

/** The deployment secret the digest is taken under. Standard padded base64. */
export const OTP_MAC_KEY_VAR = 'MERIT_OTP_MAC_KEY';

/** The key being retired, admitted for VERIFY only, for one TTL. Optional. */
export const OTP_MAC_KEY_RETIRING_VAR = 'MERIT_OTP_MAC_KEY_RETIRING';

/** A key shorter than the digest it keys buys nothing. HMAC-SHA-256 is 32. */
export const OTP_MAC_KEY_MIN_BYTES = 32;

/**
 * The domain separator, and it carries a VERSION because the encoding below is
 * the thing a later ruling would change. Changing the input without changing
 * this string is how two deployments compute different digests and neither
 * knows.
 */
export const OTP_DIGEST_DOMAIN = 'merit.otp.code.v1';

/** What a code was issued FOR. Every field is bound into the digest. */
export interface OtpChallengeSubject {
  /** `otp_challenges.channel`, `0029:519`. */
  readonly channel: 'email' | 'sms';
  /**
   * The destination AS THE PERSON TYPED IT, never the normalized form.
   *
   * THIS IS THE LOAD-BEARING FIELD AND THE REASON IS A MERGED `CREATE INDEX`.
   * `otp_challenges` keys off `email_normalized` (`0002:306-308`, "Issued
   * before a user may exist"), and `users.email_normalized` is
   * "Indexed but deliberately NOT unique. Two people can legitimately share a
   * normalized form" (`0002:250-253`). So the CHALLENGE ROW CANNOT TELL TWO
   * PEOPLE APART WHOM THE NORMALIZER MERGED, while `users.email` -- the column
   * `RESOLUTION_ADDRESS` addresses -- is `UNIQUE` and can. Binding the digest to
   * the address as typed is the only place that separation can live: without it
   * a code mailed to `bob@gmail.com` answers a challenge presented as
   * `b.ob@gmail.com`, which is one human authenticating as another out of two
   * individually correct merged decisions.
   */
  readonly destination: string;
  /** The code, exactly as it will be presented. This function normalizes none of it. */
  readonly code: string;
}

/**
 * ASCII case folding, and it is ASCII-only ON PURPOSE.
 *
 * `users.email` is `citext` so that "casing never creates a duplicate human"
 * (`0002:247`), and a digest that did not fold would refuse a person who typed
 * `Bob@x.com` on Tuesday and `bob@x.com` on Wednesday. `citext` folds with
 * `lower()`, which is LOCALE DEPENDENT above ASCII; a digest has to be
 * reproducible byte for byte in every process that ever verifies it, so this
 * folds the range where the two agree everywhere and leaves the rest alone.
 * The divergence that leaves is in the fail-closed direction: an address
 * differing only in the case of a non-ASCII letter fails to verify rather than
 * verifying as somebody it is not.
 */
function asciiFold(value: string): string {
  return value.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

/**
 * One field of the digest input, length-prefixed.
 *
 * WITHOUT THE LENGTH THE CONCATENATION IS AMBIGUOUS, and ambiguity here is a
 * collision a caller chooses: `('ab', 'c')` and `('a', 'bc')` would hash
 * identically, so a destination could be extended into the code. Four bytes big
 * endian in front of every field makes exactly one tuple produce one input.
 */
function digestField(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(bytes.length, 0);
  return Buffer.concat([header, bytes]);
}

/** A key too short to key the digest is refused rather than stretched. */
function refuseWeakKey(key: Uint8Array, where: string): void {
  if (key.length < OTP_MAC_KEY_MIN_BYTES)
    throw new OtpKeyError(
      `${where} is ${String(key.length)} bytes and the OTP MAC key floor is ` +
        `${String(OTP_MAC_KEY_MIN_BYTES)}. A key shorter than the digest it keys is the ` +
        'weakest link in a construction whose entire purpose is to be stronger than a ' +
        'one-million-candidate search',
    );
}

/**
 * `otp_challenges.code_hash`, as a keyed MAC over the whole challenge.
 *
 * HMAC-SHA-256 RATHER THAN A SLOW KDF, and the alternative was priced rather
 * than skipped. A six-digit code is 10^6 candidates, so no work factor that fits
 * a request path makes the space infeasible; a work factor that did would be
 * paid on every verification by every person. A key the attacker does not have
 * makes the space infinite instead of large, which is the only answer that
 * scales to a secret this short. See ADR-197 section 3.
 *
 * THE CHANNEL IS IN THE INPUT because `otp_challenges_exactly_one_destination`
 * (`0029:532`) admits two destination shapes on one table, and a digest that did
 * not name which one it was taken over is a digest an email challenge and an SMS
 * challenge could collide on.
 *
 * @param key one admitted key. {@link otpCodeMatches} is what a VERIFIER calls.
 */
export function otpCodeDigest(key: Uint8Array, subject: OtpChallengeSubject): Uint8Array {
  refuseWeakKey(key, 'the OTP MAC key');
  if (subject.destination === '')
    throw new OtpKeyError('an OTP digest over an empty destination binds the code to nobody');
  if (subject.code === '')
    throw new OtpKeyError('an OTP digest over an empty code is a digest of the destination alone');
  const input = Buffer.concat([
    digestField(OTP_DIGEST_DOMAIN),
    digestField(subject.channel),
    digestField(asciiFold(subject.destination)),
    digestField(subject.code),
  ]);
  return createHmac('sha256', key).update(input).digest();
}

/** Equal, in time that does not depend on WHERE they differ. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  // THE LENGTH IS COMPARED FIRST AND IT IS NOT A LEAK. `timingSafeEqual` throws
  // on a length mismatch rather than answering, and a digest length is not a
  // secret: it is a property of the algorithm, which is written above in the
  // clear. `rise-webhook.ts` makes the same argument for the same reason.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Whether a presented code answers a stored digest, under ANY admitted key.
 *
 * EVERY KEY IS TRIED AND THE LOOP DOES NOT SHORT CIRCUIT ON A MISS, which is
 * what makes a rotation window invisible to a person verifying inside it: a
 * challenge issued under the retiring key still answers, and one issued under
 * the current key answers first. Which key matched is not a secret and is not
 * reported; that a code did not match at all is the only fact this returns.
 */
export function otpCodeMatches(
  keys: readonly Uint8Array[],
  subject: OtpChallengeSubject,
  stored: Uint8Array,
): boolean {
  if (keys.length === 0)
    throw new OtpKeyError(
      'a verification with no admitted key would answer `false` to every correct code, which is ' +
        'a total outage wearing the costume of a wrong code. The absence is refused here rather ' +
        'than returned as a denial',
    );
  let matched = false;
  for (const key of keys) {
    // `||` EVALUATES ITS LEFT SIDE ALWAYS, so every key costs one HMAC whether
    // an earlier one matched or not. Written this way round on purpose.
    matched = constantTimeEqual(otpCodeDigest(key, subject), stored) || matched;
  }
  return matched;
}

/** One key off the environment, decoded strictly. `null` only when optional and unset. */
function readMacKey(env: Environment, name: string, required: boolean): Uint8Array | null {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') {
    if (!required) return null;
    throw new OtpKeyError(
      `${name} is unset. There is no default and there must not be one: a deployment that has ` +
        'not been given a key cannot issue a challenge anybody else could not also issue, and a ' +
        'baked-in fallback is a published key. INFRA section 7 is where it comes from',
    );
  }
  const decoded = Buffer.from(raw, 'base64');
  // STRICT, BY ROUND TRIP. `Buffer.from(_, 'base64')` silently ignores every
  // character it does not recognise, so a truncated or corrupted secret decodes
  // to a SHORTER KEY rather than to an error, and the deployment runs on it.
  if (decoded.toString('base64') !== raw.trim())
    throw new OtpKeyError(
      `${name} is not standard padded base64. It is decoded strictly because a lenient decode ` +
        'turns a corrupted secret into a shorter working key instead of into a failure',
    );
  refuseWeakKey(decoded, name);
  return decoded;
}

/**
 * The admitted keys, newest first: the current key, then the retiring one.
 *
 * A LIST RATHER THAN A KEY IS THE WHOLE OF THE ROTATION STORY, and it is what
 * `otp_challenges` having no `key_id` column costs and does not cost. It costs
 * nothing durable, because a challenge older than its TTL cannot verify under
 * ANY key; what it costs is that a verifier inside a rotation window computes
 * two HMACs instead of one.
 *
 * ISSUING ALWAYS USES `[0]`. Verifying uses all of them.
 */
export function resolveOtpMacKeys(env: Environment): readonly Uint8Array[] {
  const current = readMacKey(env, OTP_MAC_KEY_VAR, true);
  if (current === null) throw new OtpKeyError('unreachable: the current key is required');
  const retiring = readMacKey(env, OTP_MAC_KEY_RETIRING_VAR, false);
  if (retiring === null) return [current];
  if (constantTimeEqual(current, retiring))
    throw new OtpKeyError(
      `${OTP_MAC_KEY_RETIRING_VAR} holds the same key as ${OTP_MAC_KEY_VAR}. A rotation window ` +
        'that rotated to the value it was rotating away from is a rotation nobody performed, and ' +
        'it would read as complete on every dashboard',
    );
  return [current, retiring];
}

// -----------------------------------------------------------------------------
// Reading rows back out of the accessor's `unknown`
// -----------------------------------------------------------------------------

function asRow(row: unknown, what: string): Record<string, unknown> {
  if (typeof row !== 'object' || row === null)
    throw new AuthRowError(`${what} returned something that is not a row`);
  return row as Record<string, unknown>;
}

function str(row: Record<string, unknown>, column: string, what: string): string {
  const value = row[column];
  if (typeof value !== 'string' || value === '')
    throw new AuthRowError(`${what}.${column} did not read back as a non-empty string`);
  return value;
}

/** A `timestamptz`, as the ISO-8601 string every response in section 3 carries. */
function instant(row: Record<string, unknown>, column: string, what: string): string {
  const value = row[column];
  if (!(value instanceof Date))
    throw new AuthRowError(`${what}.${column} did not read back as a timestamp`);
  return value.toISOString();
}

function maybeInstant(row: Record<string, unknown>, column: string, what: string): string | null {
  return row[column] === null || row[column] === undefined ? null : instant(row, column, what);
}

/**
 * `sessions.auth_factor`, narrowed to the union `0029:565`'s CHECK declares.
 *
 * A VALUE OUTSIDE THE LIST IS AN EXCEPTION AND NEVER A CAST. The database
 * refuses to store one, so reading a fourth value means the CHECK is gone, and
 * the one thing this function must never do is widen `AuthFactor` by returning
 * a string nobody declared.
 */
function readAuthFactor(row: Record<string, unknown>): AuthFactor {
  const value = row['authFactor'];
  for (const known of AUTH_FACTORS) if (value === known) return known;
  throw new AuthRowError(
    `sessions.auth_factor read back as \`${String(value)}\`, which is not one of ` +
      `${AUTH_FACTORS.join(', ')}. 0029's CHECK list is the vocabulary and this row is outside it`,
  );
}

/**
 * `sessions.elevated_by_factor`, narrowed to `ElevationFactor`. THIS IS C-27.
 *
 * `0029:581`'s CHECK admits `passkey` and `dual_channel` and nothing else, and
 * the whole of C-27 is the absence of a third member: an SMS-established session
 * "can see everything and change nothing". A READ is the place that boundary is
 * quietly widened, because a cast would turn any string in that column into an
 * `ElevationFactor` at compile time and `authorize` would then honour it. So the
 * narrowing is a comparison against `ELEVATION_FACTORS` and an unrecognised
 * value RAISES rather than elevating, rather than being dropped to `null` --
 * dropping it would hide a database that had stopped enforcing C-27.
 */
function readElevationFactor(row: Record<string, unknown>): ElevationFactor | null {
  const value = row['elevatedByFactor'];
  if (value === null || value === undefined) return null;
  for (const known of ELEVATION_FACTORS) if (value === known) return known;
  throw new AuthRowError(
    `sessions.elevated_by_factor read back as \`${String(value)}\`, which is not one of ` +
      `${ELEVATION_FACTORS.join(', ')}. That column's CHECK list IS C-27 and a session elevated ` +
      'by a factor outside it must not be honoured',
  );
}

/**
 * One `sessions` row as this surface reads it, or `null` when it is not live.
 *
 * `identityId` IS THE ONE THE TOKEN CLAIMED, and it is correct because the row
 * came back: the scope predicate is an `EXISTS` over `users` on this identity,
 * so a row belonging to anybody else is not in the result set to be read.
 *
 * REVOCATION AND EXPIRY ARE APPLIED HERE AND NOT IN THE ADDRESS, because an
 * address is equality only (ADR-112 clause 1) and `expires_at > now()` is a
 * range. The cost is that the row is fetched before it is refused, which
 * discloses nothing: it is this identity's own row either way.
 */
function liveSession(row: unknown, identityId: string, now: Date): AuthSession | null {
  const r = asRow(row, 'sessions');
  if (r['revokedAt'] !== null && r['revokedAt'] !== undefined) return null;
  const expiresAt = r['expiresAt'];
  if (!(expiresAt instanceof Date))
    throw new AuthRowError('sessions.expires_at did not read back as a timestamp');
  if (expiresAt.getTime() <= now.getTime()) return null;
  return {
    id: str(r, 'id', 'sessions'),
    identityId,
    userId: str(r, 'userId', 'sessions'),
    authFactor: readAuthFactor(r),
    elevatedAt: maybeInstant(r, 'elevatedAt', 'sessions'),
    elevatedByFactor: readElevationFactor(r),
  };
}

// -----------------------------------------------------------------------------
// The user-agent family, which the contract requires and the row does not carry
// -----------------------------------------------------------------------------

/**
 * `SessionRow.user_agent_family`: *"Coarse, never the raw string."*
 *
 * A CLOSED VOCABULARY AND NOT A PARSER. The point of the column on the
 * trader-visible list is that a person recognises their own devices and notices
 * one they do not, and a full user-agent string on that screen is both a worse
 * answer to that question and a fingerprint handed back over the wire.
 *
 * THE ORDER OF THE TESTS IS LOAD BEARING AND IS THE WHOLE TRAP. Every
 * Chromium-derived agent contains `Safari`, Edge contains `Chrome`, and Chrome
 * on iOS contains `CriOS` and `Safari` and not `Chrome`. So the most specific
 * token is tested first and `unknown` is the answer for anything unrecognised,
 * which is honest: a wrong family name on a security screen is worse than no
 * name, because it invites a person to recognise a device that is not theirs.
 */
export function userAgentFamily(raw: string | null): string {
  if (raw === null || raw.trim() === '') return 'unknown';
  const ua = raw;
  if (ua.includes('Edg/') || ua.includes('EdgiOS/')) return 'Edge';
  if (ua.includes('OPR/') || ua.includes('Opera')) return 'Opera';
  if (ua.includes('CriOS/')) return 'Chrome';
  if (ua.includes('FxiOS/') || ua.includes('Firefox/')) return 'Firefox';
  if (ua.includes('Chrome/') || ua.includes('Chromium/')) return 'Chrome';
  if (ua.includes('Safari/')) return 'Safari';
  return 'unknown';
}

// -----------------------------------------------------------------------------
// The blockers, each named once so twelve refusals cannot drift apart
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// TWO REFUSALS THAT STOOD HERE ARE GONE, AND THE REPLACEMENT SAYS WHAT IS LEFT
// -----------------------------------------------------------------------------
// `NO_PRE_IDENTITY_READ` and `NO_DERIVED_INSERT` were B1 and B2 of this file's
// header. ADR-126 discharged both and this file went on citing them, so a live
// 503's log line told an operator that a pre-identity read had no door where
// ADR-126 had built one. ADR-196 finding 2 reported the first; the second was
// stale beside it and no entry had said so. ADR-197 repairs both, and section 4
// of that entry reports what made the first one HALF true for as long as it
// was: `resolutionDb` was never added to `packages/db/src/index.ts`, so the
// endpoint the door was built for could not import it.
//
// NEITHER IS REPLACED BY A SOFTER VERSION OF ITSELF. What blocks `verifyOtp`
// now is that nobody has written it, which is a different fact and is the one
// below.

const NO_VERIFY_HANDLER =
  'every construction `POST /auth/verify` needs now exists and the handler that composes them ' +
  'does not. ADR-196 priced the build at four rulings and named this one last: resolve the ' +
  'address through `resolutionDb`, branch on whether it answered, establish through ' +
  '`establishmentDb` when it did not, and mint a session through `ScopedTx.insertUnder`. What ' +
  'is genuinely absent is the MINTER: this file deliberately ships the token parser and the ' +
  "token digest and no producer, on `job-queue.ts`'s rule, and the sentence that justified the " +
  'absence -- "nothing can insert the row it would be minted for" -- stopped being true when ' +
  'ADR-126 landed `insertUnder`. A minter that lands must produce its token through ' +
  '`sessionTokenHash` and `SESSION_TOKEN_SEPARATOR` rather than by respelling the format';

const NO_WEBAUTHN =
  'no WebAuthn verifier is admitted in this workspace. A registration or assertion ceremony needs ' +
  'CBOR and COSE parsing and a signature check over the authenticator data, none of which is ' +
  'hand-rollable on the money path and none of which any dependency here provides. Admitting one ' +
  'is a VG-12 decision with an entry of its own, not a line in a wiring slice';

// `NO_OTP_DIGEST` STOOD HERE AND ADR-197 RULED IT. The digest is
// `otpCodeDigest` above, the key is a deployment secret rather than a row, and
// `otp_challenges` needs no `key_id` because a challenge older than its TTL
// cannot verify under any key. What is left of that blocker is the WIRING: this
// backend is constructed with a database and a clock and holds no key, because
// the only methods that would use one are blocked on something else anyway.
const NO_OTP_KEY_WIRED =
  'this backend holds no OTP MAC key. ADR-197 ruled the digest and the key surface -- ' +
  '`otpCodeDigest` and `resolveOtpMacKeys` in this file, read from `MERIT_OTP_MAC_KEY` per INFRA ' +
  'section 7 -- and deliberately did not wire them, because every method that would use a key is ' +
  'blocked on delivery or on a handler and a key admitted before its caller is a key nobody can ' +
  'rotate out. `start.ts` is where it lands, with the handler';

const NO_DELIVERY =
  'nothing in this deployable delivers a code. A handler that writes an `otp_challenges` row and ' +
  'answers `sent: true` having sent nothing is a worse answer than 503, and the SMS branch also ' +
  'needs a per-send price to charge against `otp_send_budget.spend_cents`, which is config that ' +
  'has no source in this tree';

/** One refusal, so the twelve read identically and cite one reason each. */
function blocked(method: string, reason: string): () => Promise<never> {
  return () => Promise.reject(new AuthBackendUnwired(method, reason));
}

// -----------------------------------------------------------------------------
// The backend
// -----------------------------------------------------------------------------

/** `sessions`, as `scope.ts` and `schema.ts` key it. */
const SESSIONS = 'sessions';

/**
 * `AuthBackend` over the trader database.
 *
 * @param db     the two doors. Injected so the suite can watch which one each
 *               method opens and with whose identity, which is the property that
 *               is this package's rather than `packages/db`'s.
 * @param clock  read once per call. `INV-01` keeps a clock out of the engine and
 *               this is not the engine, but a backend that reads `Date.now()`
 *               inline is a backend whose expiry behaviour cannot be asserted.
 */
export function databaseAuthBackend(db: ApiDb, clock: () => Date = () => new Date()): AuthBackend {
  return {
    async sessionByToken(token: string): Promise<AuthSession | null> {
      const parsed = parseSessionToken(token);
      if (parsed === null) return null;
      const row = await db.scoped(parsed.identityId, (tx) =>
        tx.rowAt(SESSIONS, { refreshTokenHash: Buffer.from(sessionTokenHash(token)) }),
      );
      if (row === undefined || row === null) return null;
      return liveSession(row, parsed.identityId, clock());
    },

    async logout(session: AuthSession): Promise<void> {
      // THE SESSION THE REQUEST ARRIVED ON, ADDRESSED BY ITS OWN ID. The
      // identity is the one `sessionByToken` proved and never one off the
      // request, so the composed predicate is `EXISTS(users of this identity)
      // AND sessions.id = $2` and a caller has nothing to point it at.
      await db.scoped(session.identityId, (tx) =>
        tx.updateAt(SESSIONS, { id: session.id }, { revokedAt: clock() }),
      );
    },

    async listSessions(session: AuthSession): Promise<readonly SessionRow[]> {
      const rows = await db.scoped(session.identityId, (tx) => tx.rows(SESSIONS));
      const now = clock();
      const live: SessionRow[] = [];
      for (const raw of rows) {
        const r = asRow(raw, 'sessions');
        // LIVE ROWS ONLY, which is what `sessions_live_idx` is partial on and
        // what SD-M4-03 describes: the list exists so a person can revoke a
        // session they do not recognise, and a revoked one is not revocable.
        // Filtered here rather than in the query because an address is equality
        // only and `expires_at > now()` is a range.
        if (r['revokedAt'] !== null && r['revokedAt'] !== undefined) continue;
        const expiresAt = r['expiresAt'];
        if (!(expiresAt instanceof Date))
          throw new AuthRowError('sessions.expires_at did not read back as a timestamp');
        if (expiresAt.getTime() <= now.getTime()) continue;
        const createdAt = instant(r, 'createdAt', 'sessions');
        const elevatedAt = maybeInstant(r, 'elevatedAt', 'sessions');
        const elevatedByFactor = readElevationFactor(r);
        const agent = r['createdUserAgent'] ?? r['userAgent'];
        live.push({
          id: str(r, 'id', 'sessions'),
          auth_factor: readAuthFactor(r),
          // BOTH HALVES, on `isElevated`'s own rule: a row that violated
          // `sessions_elevation_is_complete` reads as NOT elevated here rather
          // than as elevated on a half-written record.
          elevated: elevatedAt !== null && elevatedByFactor !== null,
          created_at: createdAt,
          // NOTHING STAMPS `last_seen_at` IN THIS TREE and the fallback is named
          // rather than hidden. Stamping it would be an UPDATE on every
          // authenticated request, inside its own transaction, on the hottest
          // path this deployable has, and `sessionByToken` is not even handed the
          // request IP that SD-M4-03's `last_seen_ip` wants. That is a write
          // amplification ruling and it is owed; ADR-120 reports it.
          last_seen_at: maybeInstant(r, 'lastSeenAt', 'sessions') ?? createdAt,
          user_agent_family: userAgentFamily(typeof agent === 'string' ? agent : null),
          is_current: str(r, 'id', 'sessions') === session.id,
        });
      }
      // Newest first, which is the order `sessions_live_idx` is built for and
      // the order the screen reads in.
      return live.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    },

    async revokeSession(session: AuthSession, sessionId: string): Promise<'revoked' | null> {
      // A PATH PARAMETER THAT IS NOT A UUID IS A 404 AND NEVER A 500. Handing it
      // to the accessor would render `sessions.id = 'nonsense'` and Postgres
      // would raise `invalid input syntax for type uuid`, which is a 500 for a
      // request whose honest answer is "no such session of yours".
      if (!isIdentityId(sessionId)) return null;
      const written = await db.scoped(session.identityId, (tx) =>
        tx.updateAt(SESSIONS, { id: sessionId }, { revokedAt: clock() }),
      );
      // ZERO ROWS IS THE WHOLE CONTROL AND IT IS ADR-112's COMPOSITION DOING IT.
      // A session id belonging to another identity is refused by the tenancy
      // conjunct, so the write lands nowhere and the route answers 404 -- which
      // is API_CONTRACT section 1's rule that the surface does not confirm
      // somebody else's resource exists. It is NOT a check in this function, and
      // that is the point: there is no `if` here to forget.
      return written.length === 0 ? null : 'revoked';
    },

    // -------------------------------------------------------------------------
    // The twelve, each with its own reason
    // -------------------------------------------------------------------------

    // THREE INDEPENDENT BLOCKERS ON ONE METHOD, which is why the corpus's most
    // load-bearing endpoint is the one furthest from working.
    // THIS METHOD CARRIED THREE INDEPENDENT BLOCKERS AND CARRIES ONE. ADR-126
    // discharged two of them and this file did not notice for as long as
    // ADR-196 measured; ADR-197 discharged the third. The remaining one is that
    // nobody has written the handler, which is the honest state and is a
    // smaller sentence than the three it replaces.
    verifyOtp: blocked('verifyOtp', `${NO_VERIFY_HANDLER}. And ${NO_OTP_KEY_WIRED}`),

    requestOtp: blocked('requestOtp', `${NO_DELIVERY}. And ${NO_OTP_KEY_WIRED}`),

    // BOTH ARMS ARE BLOCKED AND FOR DIFFERENT REASONS, which is worth stating
    // because the union is C-27 and a reader will ask whether the refusal is the
    // union doing its job. It is not: `ElevationFactor` refuses `sms_otp` at
    // COMPILE time and always did, and these two are the two members it admits.
    elevate: blocked(
      'elevate',
      `the passkey arm: ${NO_WEBAUTHN}. The dual_channel arm: ${NO_DELIVERY}. And ` +
        NO_OTP_KEY_WIRED,
    ),

    passkeyRegisterOptions: blocked('passkeyRegisterOptions', NO_WEBAUTHN),
    passkeyRegisterVerify: blocked('passkeyRegisterVerify', NO_WEBAUTHN),
    passkeyLoginOptions: blocked('passkeyLoginOptions', NO_WEBAUTHN),
    passkeyLoginVerify: blocked(
      'passkeyLoginVerify',
      // ONE BLOCKER NOW, NOT THREE. The pre-identity read and the `derived`
      // insert this method also cited are ADR-126's, discharged; the ceremony
      // is the whole of what is left, and it is a VG-12 decision.
      NO_WEBAUTHN,
    ),

    verifyPhone: blocked(
      'verifyPhone',
      '`PhoneVerifyResponse.line_type` is a carrier lookup (ADR-039 (a) scores VoIP and never ' +
        'rejects it) and no lookup adapter exists in this workspace, so the field would have to ' +
        `be invented. And ${NO_DELIVERY}`,
    ),

    // THE PHONE-CHANGE TRIO IS BLOCKED BY A SCHEMA GAP AND NOT BY THE ACCESSOR,
    // and it is the finding this session did not go looking for.
    // `PhoneChange.new_phone_preview` is required on all three responses and
    // `phone_change_requests` HAS NO PREVIEW COLUMN: it carries
    // `new_phone_hash bytea`, and `new_phone_ciphertext` under a key ADR-046
    // keeps OUT of this database. `identity_phones` carries `phone_preview` and
    // its sibling does not. So the contract states a field the schema cannot
    // serve, on three endpoints, and inventing one here would be this file
    // deciding what a preview of an unreadable number is.
    openPhoneChange: blocked(
      'openPhoneChange',
      '`phone_change_requests` has no preview column, so `PhoneChange.new_phone_preview` has no ' +
        "source. Opening a change is additionally ADR-039 (c)'s prior-number notification, which " +
        'has no dispatcher here, and a 48 hour withdrawal hold whose duration is a launch ' +
        'parameter with no configured source',
    ),
    readPhoneChange: blocked(
      'readPhoneChange',
      '`phone_change_requests` has no preview column, so `PhoneChange.new_phone_preview` has no ' +
        'source. The row is reachable through `scopedTx` and the RESPONSE is not writable',
    ),
    cancelPhoneChange: blocked(
      'cancelPhoneChange',
      '`phone_change_requests` has no preview column, so `PhoneChange.new_phone_preview` has no ' +
        'source. The keyed write itself lands; the response does not',
    ),

    readMe: blocked(
      'readMe',
      '`Me.max_accounts` has no source. `identities.max_accounts_override` is the per-entity ' +
        'exception and the BASE cap appears in no table in any of the 47 migrations, so it is a ' +
        'plan parameter -- and no plan parameter is stated in application code. Every other field ' +
        'of `Me` is reachable through the scoped door, which is what makes this one worth ' +
        'reporting rather than working around',
    ),
  };
}
