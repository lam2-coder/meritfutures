// =============================================================================
// apps/api/src/auth-backend.ts
// =============================================================================
// `AuthBackend` AGAINST THE REAL ACCESSOR. ADR-120. Some of the port's methods
// are implemented here and the rest raise, each naming its own blocker.
//
// THE PARTITION IS NOT WRITTEN OUT HERE AND THAT IS THIS FILE'S OWN HISTORY
// RATHER THAN A STYLE. It used to read "FIVE of the port's sixteen methods are
// implemented here and ELEVEN raise", which is TRUE, and four other sentences in
// this file went on saying twelve after ADR-200 moved `verifyOtp` across --
// while the suite one directory over asserted the eleven and stayed green. Five
// restatements of one measurement, one of them correct. So the number is stated
// ONCE, in `routes/auth.ts`'s port docblock, where it quotes the commands that
// settle it against THIS file and `RI-20` runs them on every `CI-01`. ADR-034's
// remedy has exactly two branches, generate the value or delete it and point at
// the source; every site here takes the second and that docblock takes the first.
//
// WHAT THIS FILE MAY STATE IS THE HALF IT CANNOT PERTURB, and the rule is worth
// the sentence: a claim that greps the file it is written in matches itself, so
// writing the refusal count here would change the refusal count. The port's SIZE
// is a fact about `routes/auth.ts`, so it is settleable from here:
// `grep -rn ": unwired" apps/api/src/routes/auth.ts` returns 16 lines, one per
// member of `UNWIRED_AUTH_BACKEND`, and `UNWIRED_AUTH_BACKEND: AuthBackend`
// makes that list the port's own membership at COMPILE time rather than a second
// copy of it. Each of the two files therefore holds the claim about the other.
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
// AND `POST /auth/verify` NOW ANSWERS. ADR-196 section 7 item 4 -- "the smallest
// of that entry's four and the last" -- is `verifyOtp` below, and ADR-200 is the
// entry that rules the four things that item did not: which challenge row a
// verification selects, what a wrong code does to `attempts`, that consumption
// precedes establishment, and how long the session it mints lives.
//
// THAT PARAGRAPH USED TO END "A TRADER CANNOT SIGN UP TODAY, BECAUSE NOBODY CAN
// SEND THEM A CODE", AND ADR-229 IS THE ENTRY THAT MAKES IT FALSE. `requestOtp`
// below writes the `otp_challenges` row `verifyOtp` reads and hands the code to
// `otp-delivery.ts`, so the email half of sign-in is end to end and what is owed
// is a vendor token in the platform vault rather than a construction.
//
// WHAT STILL DOES NOT WORK, SAID HERE RATHER THAN LEFT TO BE INFERRED FROM A
// GREEN SUITE. THE `sms` CHANNEL, ON BOTH ENDS AND FOR TWO DIFFERENT REASONS
// NEITHER OF WHICH IS DELIVERY: `verifyOtp` refuses it because a phone has no
// address in the pre-identity reader's vocabulary ({@link NO_PHONE_RESOLUTION}),
// and `requestOtp` refuses it because sending a code nothing can verify is money
// spent for nothing and because the price that send charges against
// `otp_send_budget.spend_cents` has a name and no value ({@link
// NO_SMS_DELIVERY}). And no deployment in this repository holds the mail
// vendor's token, so an unconfigured deployment answers 503 on `POST /auth/otp`
// rather than pretending: that is the control working, not the gap surviving.
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
// **THE MINTER IS IN THIS FILE NOW, AND THE RULE THAT KEPT IT OUT IS THE RULE
// THAT ADMITS IT.** `job-queue.ts`'s rule is that a primitive admitted before a
// caller exists is a primitive nobody can remove; {@link mintSessionToken} and
// {@link mintSession} have exactly one caller, `verifyOtp`, in the same file.
// The paragraph that stood here said "nothing can insert the row it would be
// minted for", which stopped being true when ADR-126 landed `insertUnder`, and
// then said the caller was missing, which stopped being true here. The token is
// produced through {@link sessionTokenHash} and {@link SESSION_TOKEN_SEPARATOR}
// rather than by respelling the format, which is what that paragraph asked of
// whatever minter eventually landed.
//
// -----------------------------------------------------------------------------
// EVERY REFUSAL RAISES `AuthBackendUnwired` AND CARRIES ITS OWN REASON
// -----------------------------------------------------------------------------
// `endpointHandler` answers 503 for that class and logs the error, so a route
// this deployment cannot serve says so with a reason in the log line rather than
// in the response body -- API_CONTRACT section 2 keeps internals out of a
// problem document. One error class and a DISTINCT REASON PER REFUSAL is what
// makes a 503 from `POST /auth/otp` a different fact from a 503 from
// `POST /auth/passkey/login/options`. (This sentence named a count until session
// 410; it named twelve, the tree held eleven, and the count was never what the
// sentence was about.)
// =============================================================================

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

import { IdentityAlreadyEstablished, atLeast, atMost, isNull, normalizedEmail } from '@merit/db';

import type { ApiDb } from './db.ts';
import { isIdentityId } from './db.ts';
import { postmarkOtpSender } from './otp-delivery.ts';
import type { OtpDeliveryOutcome, OtpSender } from './otp-delivery.ts';
import { AUTH_FACTORS, AuthBackendUnwired, ELEVATION_FACTORS } from './routes/auth.ts';
import type {
  AuthBackend,
  AuthFactor,
  AuthSession,
  ElevationFactor,
  Established,
  OtpOutcome,
  OtpRequest,
  RequestContext,
  SessionRow,
  VerifyRequest,
  VerifyResponse,
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
// THE CHALLENGE, AND THE FOUR THINGS ADR-200 RULES ABOUT READING ONE
// -----------------------------------------------------------------------------
// ADR-196 ruled WHERE an identity comes from and ADR-197 built the digest and
// the door. Neither says which `otp_challenges` row a verification answers, what
// a wrong code costs, or when the row is spent. ADR-197's own approval line says
// so: "It rules the digest and leaves the CONSUMPTION unruled."

/** `otp_challenges`, as `scope.ts` and `schema.ts` key it. */
const OTP_CHALLENGES = 'otpChallenges';

/**
 * The per-challenge attempt ceiling.
 *
 * FIVE, AND IT IS THE SAME FIVE IN TWO PLACES RATHER THAN A NUMBER THIS FILE
 * CHOSE. `API_CONTRACT` section 11 rows `POST /auth/verify` as "10/hour/IP,
 * 5 attempts/challenge", and `0002_identity.sql:319` declares
 * `attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5)`.
 *
 * THE READ BELOW EXCLUDES AN EXHAUSTED CHALLENGE RATHER THAN LETTING THE CHECK
 * ANSWER, and that ordering is the whole of why this constant is here. A handler
 * that selected a challenge at the ceiling and then incremented would hand the
 * caller a `23514` from a merged migration, which `endpointHandler` has no arm
 * for: a person who typed a sixth wrong code would get a 500 where the contract
 * says the lockout is a refusal. So the ceiling bounds the SELECT and the CHECK
 * is left as the thing that would catch this file being wrong.
 */
export const OTP_MAX_ATTEMPTS = 5;

// -----------------------------------------------------------------------------
// ISSUANCE: THREE NUMBERS, AND NOT ONE OF THEM IS THIS FILE'S CHOICE
// -----------------------------------------------------------------------------
// `OTP_MAX_ATTEMPTS` above states the rule these follow: a number the corpus
// already states is TRANSCRIBED here with its source beside it, and a number the
// corpus does not state is config. All three below are the first kind, and each
// names the two places it comes from so a later reader checks rather than
// trusts. ADR-229 section 4.
//
// THE ONE THAT IS DELIBERATELY ABSENT IS THE PER-IP LIMIT. API_CONTRACT section
// 11 rows the email channel as "5/hour/IP, 5/hour/email" and only the second
// half is enforced here, because `server.ts:170` builds the instance as
// `Fastify({ logger: options.logger ?? false })` and CONFIGURES no `trustProxy`
// anywhere, so `request.ip` is the IMMEDIATE PEER. Behind Cloudflare that
// is one edge address for every trader at once, and a five-per-hour limit
// counted on it is a five-per-hour limit for the whole product. INFRA section 2
// puts rate limiting at the edge, which is the one place the address is the
// trader's; ADR-226 refused to send `remoteip` for this same reason one file
// over, and this is that landmine arriving as a counter instead of as a field.

/**
 * The digits in a code. SIX.
 *
 * NOT A CHOICE MADE HERE. `otpCodeDigest`'s own docblock above prices the
 * construction against "a six-digit code is 10^6 candidates" and ADR-197 section
 * 3 rules the keyed MAC on exactly that arithmetic, so a code of another length
 * would make the reasoning that admitted HMAC-SHA-256 over a slow KDF false
 * without a line of it changing.
 */
export const OTP_CODE_DIGITS = 6;

/**
 * How long a challenge lives, in minutes. TEN.
 *
 * `0002_identity.sql:313` declares `expires_at timestamptz NOT NULL` with the
 * comment "short TTL, 10 minutes", and `otpCodeDigest`'s docblock leans on that
 * TTL for the whole rotation story: "the only rows a key must still open are the
 * ones that can still verify". So this number is already load bearing in a
 * construction that shipped, and it is transcribed rather than picked.
 */
export const OTP_TTL_MINUTES = 10;

/** {@link OTP_TTL_MINUTES} in seconds. Integer arithmetic, no floats. */
export const OTP_TTL_SECONDS = OTP_TTL_MINUTES * 60;

/** {@link OTP_TTL_SECONDS} in milliseconds. */
export const OTP_TTL_MS = OTP_TTL_SECONDS * 1000;

/**
 * How many codes one email address may be sent in one window. FIVE.
 *
 * API_CONTRACT section 11's row for `POST /auth/otp` (`channel: "email"`) reads
 * "5/hour/IP, 5/hour/email", and this is the second half of it.
 *
 * WHY IT IS A CONSTANT HERE WHERE THE SMS BRANCH'S LIMIT IS A ROW, because that
 * asymmetry looks like an oversight and is the contract's own. The same section
 * puts the SMS limits in `otp_send_budget` explicitly "so the values are config
 * the way every other plan parameter is", and states the email limits as prose
 * in the very same table. A prose number transcribed with its citation is
 * `OTP_MAX_ATTEMPTS`; a number this file invented would be neither.
 */
export const OTP_EMAIL_SENDS_PER_WINDOW = 5;

/** The window that limit is counted over. One hour, from the same row. */
export const OTP_EMAIL_WINDOW_MS = 60 * 60 * 1000;

/**
 * A code, uniform over every value of its length.
 *
 * `randomInt` AND NOT `randomBytes` WITH A MODULO. A modulo over a byte range
 * that is not a multiple of 10^6 makes the low codes fractionally likelier than
 * the high ones, which is a bias an attacker guessing codes is exactly the
 * person who benefits from. `randomInt` rejection-samples in the runtime and is
 * documented uniform; the bias is removed by not writing the arithmetic.
 *
 * THE PADDING IS PART OF THE VALUE AND NOT A DISPLAY DECISION. The digest is
 * taken over the string this returns, so a code minted as `12345` and typed as
 * `012345` must be one string in both places, and it is the padded one.
 */
export function mintOtpCode(): string {
  return String(randomInt(0, 10 ** OTP_CODE_DIGITS)).padStart(OTP_CODE_DIGITS, '0');
}

/**
 * One `otp_challenges` row, as this surface reads it.
 *
 * `codeHash` IS COMPARED AND NEVER LOGGED. It is the MAC of a live code, so a
 * copy of it in a log line is the offline search ADR-197 section 2 exists to
 * make useless.
 */
interface OtpChallenge {
  readonly id: string;
  readonly codeHash: Uint8Array;
  readonly attempts: number;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

/** A `bytea`, which the driver hands back as a `Buffer`. */
function bytes(row: Record<string, unknown>, column: string, what: string): Uint8Array {
  const value = row[column];
  if (!(value instanceof Uint8Array))
    throw new AuthRowError(`${what}.${column} did not read back as bytes`);
  return value;
}

/** A `smallint`, which must be a whole number and never a float. */
function count(row: Record<string, unknown>, column: string, what: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isInteger(value))
    throw new AuthRowError(`${what}.${column} did not read back as a whole number`);
  return value;
}

function instantOf(row: Record<string, unknown>, column: string, what: string): Date {
  const value = row[column];
  if (!(value instanceof Date))
    throw new AuthRowError(`${what}.${column} did not read back as a timestamp`);
  return value;
}

/**
 * The challenge a verification answers: the NEWEST live one for this address.
 *
 * ONE ROW AND NOT EVERY UNCONSUMED ROW, WHICH IS A RULING RATHER THAN AN
 * OPTIMISATION. `attempts` is on the CHALLENGE (`0002:315-319`, so that "a
 * locked-out attacker learns nothing about whether the address exists"), so a
 * handler that walked every live challenge for one address would give an
 * attacker five guesses PER OUTSTANDING CODE. `POST /auth/otp` is rate limited
 * and not forbidden, so the number of outstanding codes is something a caller
 * chooses: walking them multiplies the lockout budget by a number the attacker
 * sets. Answering only the newest keeps the budget at five whatever they do.
 *
 * `otp_challenges_email_created_idx (email_normalized, created_at DESC)` is the
 * merged index built for exactly this read, which is the corroboration rather
 * than the argument.
 *
 * THE STRICT EXPIRY BOUNDARY IS APPLIED HERE AND THE SELECT'S IS INCLUSIVE, on
 * `liveSession`'s own precedent one section up. `atLeast` renders `>=` and a
 * challenge expiring at exactly `now` is expired, so the narrowing happens in
 * SQL and the boundary happens here.
 */
function newestLiveChallenge(rows: readonly unknown[], now: Date): OtpChallenge | null {
  let newest: OtpChallenge | null = null;
  for (const raw of rows) {
    const r = asRow(raw, 'otp_challenges');
    const expiresAt = instantOf(r, 'expiresAt', 'otp_challenges');
    if (expiresAt.getTime() <= now.getTime()) continue;
    const attempts = count(r, 'attempts', 'otp_challenges');
    if (attempts >= OTP_MAX_ATTEMPTS) continue;
    const candidate: OtpChallenge = {
      id: str(r, 'id', 'otp_challenges'),
      codeHash: bytes(r, 'codeHash', 'otp_challenges'),
      attempts,
      expiresAt,
      createdAt: instantOf(r, 'createdAt', 'otp_challenges'),
    };
    if (newest === null || candidate.createdAt.getTime() > newest.createdAt.getTime())
      newest = candidate;
  }
  return newest;
}

/**
 * `Retry-After`, in whole seconds, DERIVED FROM THE ROWS AND NOT FROM A CONSTANT.
 *
 * A sliding window frees a slot when its OLDEST member ages out, so that is what
 * this reads: the caller is told to come back when the window will actually
 * admit them, rather than being handed a number this file picked and which is
 * wrong for every caller but the one who filled the window in an instant.
 * `routes/auth.ts` says the same thing about the SMS branch's value -- "the
 * number is the budget row's, never this file's".
 *
 * WHOLE SECONDS, ROUNDED UP, AND FLOORED AT ONE. `Retry-After` carries no
 * fraction, rounding DOWN would name an instant the window has not yet reached,
 * and a zero invites an immediate retry that refuses again.
 */
function retryAfterFor(rows: readonly unknown[], now: Date): number {
  let oldest: number | null = null;
  for (const raw of rows) {
    const created = instantOf(asRow(raw, 'otp_challenges'), 'createdAt', 'otp_challenges');
    if (oldest === null || created.getTime() < oldest) oldest = created.getTime();
  }
  // NO ROWS CANNOT HAPPEN HERE -- the caller reaches this only having counted at
  // least OTP_EMAIL_SENDS_PER_WINDOW of them -- and the whole window is the
  // answer that is safe if it ever does, rather than a zero.
  if (oldest === null) return OTP_EMAIL_WINDOW_MS / 1000;
  const seconds = Math.ceil((oldest + OTP_EMAIL_WINDOW_MS - now.getTime()) / 1000);
  return seconds > 0 ? seconds : 1;
}

/**
 * Whether an error is `0063`'s trigger saying the code was spent while we read.
 *
 * THE `cause` CHAIN IS WALKED FOR `isEmailAlreadyTaken`'s REASON, measured one
 * package over: Drizzle does not re-raise the driver's error, it throws its own
 * carrying `code` and `constraint` a level down. A version reading only the top
 * level matches nothing and turns a lost race into a 500.
 *
 * THE CONSTRAINT NAME IS MATCHED AND NOT ONLY THE SQLSTATE, because
 * `check_violation` is what every CHECK in this schema raises and translating
 * all of them into "bad code" would answer 401 to a row that violated something
 * else entirely.
 */
export function isChallengeAlreadyConsumed(cause: unknown): boolean {
  let at: unknown = cause;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof at !== 'object' || at === null) return false;
    const err = at as {
      readonly code?: unknown;
      readonly constraint?: unknown;
      readonly cause?: unknown;
    };
    if (err.code === '23514' && err.constraint === CONSUMPTION_IS_WRITE_ONCE) return true;
    at = err.cause;
  }
  return false;
}

/** `0063`'s trigger, by the name it raises under. Spelled once. */
const CONSUMPTION_IS_WRITE_ONCE = 'otp_challenges_consumption_is_write_once';

// -----------------------------------------------------------------------------
// THE MINTER (ADR-200)
// -----------------------------------------------------------------------------

/**
 * The session secret's length in bytes.
 *
 * THIRTY-TWO, BECAUSE THE DIGEST IS SHA-256 AND A SECRET SHORTER THAN ITS DIGEST
 * IS THE WEAK LINK. `refuseWeakKey` makes the same argument about the OTP MAC
 * key in the same file, and this is that argument applied to the value the token
 * is made of rather than to the key a digest is taken under.
 */
export const SESSION_SECRET_BYTES = 32;

/**
 * How long a minted session lives.
 *
 * THIS IS A LAUNCH PARAMETER AND IT IS RULED HERE BECAUSE THIS IS ITS ONLY
 * WRITER, on `expiry.ts`'s `FREEZE_EXPIRING_LEAD_HOURS` precedent -- a value the
 * corpus states nowhere, set at the site that writes it, with the reasoning
 * beside it rather than in a session log. ADR-200 section 6, and a founder read
 * is owed on the NUMBER specifically.
 *
 * WHY IT IS NOT SHORT, WHICH IS THE PART A READER WILL QUESTION. The
 * `sessions` design record calls `expires_at` "short-lived access, rotating
 * refresh", and `refresh_token_hash`'s own comment says "rotation on every
 * refresh" -- but `API_CONTRACT` section 3 declares NO REFRESH ENDPOINT. There
 * is no `POST /auth/refresh` in the contract and none in `AUTH_ENDPOINTS`, so
 * nothing can rotate a session and `expires_at` is the whole login lifetime
 * rather than the access half of a pair. A short value would therefore log
 * every trader out with no mechanism to keep them in, on a product whose only
 * other door is another emailed code.
 *
 * WHAT BOUNDS A LONG SESSION IS C-27 RATHER THAN THE CLOCK. An `email_otp`
 * session is a READ session: `sessions.elevated_by_factor`'s CHECK list admits
 * `passkey` and `dual_channel` and neither is a single factor, so a session
 * this minter writes "can see everything and change nothing" until it is
 * elevated. The trader-visible list and single-session revocation
 * (`listSessions`, `revokeSession`, both wired above) are the controls that make
 * a 30 day session revocable by the person who owns it.
 */
export const SESSION_LIFETIME_DAYS = 30;

/** {@link SESSION_LIFETIME_DAYS} in milliseconds. Integer arithmetic, no floats. */
export const SESSION_LIFETIME_MS = SESSION_LIFETIME_DAYS * 24 * 60 * 60 * 1000;

/**
 * A session token: the identity it claims, then a secret.
 *
 * `base64url` CARRIES NO `.`, so {@link SESSION_TOKEN_SEPARATOR} splits the
 * token at the one occurrence it has. That is a property of the alphabet rather
 * than of this function, and {@link parseSessionToken} splits at the FIRST
 * occurrence anyway, so a later encoding that did carry one costs nothing.
 */
export function mintSessionToken(identityId: string): string {
  const secret = randomBytes(SESSION_SECRET_BYTES).toString('base64url');
  return `${identityId}${SESSION_TOKEN_SEPARATOR}${secret}`;
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
// The blockers, each named once so the refusals cannot drift apart
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

// `NO_VERIFY_HANDLER` STOOD HERE AND ADR-200 WROTE THE HANDLER. Leaving a
// softened version of it beside a method that answers would be the third stale
// refusal in this file's history, which is the defect ADR-197 section 7 repaired
// twice over. What replaces it is the ONE thing `POST /auth/verify` still cannot
// do, and it is about a channel rather than about a construction.
const NO_PHONE_RESOLUTION =
  'a verification on the `sms` channel cannot be answered, and the blocker is a VOCABULARY ' +
  'rather than a missing handler. `sms` is a LOGIN channel and never a registration one -- ' +
  '`users.email` is `citext NOT NULL UNIQUE` (`0002:248`), so an SMS verification for an ' +
  'unknown number has no value to write and `is_new` is always false there (ADR-196 clause 5). ' +
  'Logging IN on it needs a phone resolved to an identity through `identity_phones`, and the ' +
  "pre-identity reader's `RESOLUTION_ADDRESS` is `{ users: ['email'] }`: there is no address " +
  'in that vocabulary a phone can be presented at. Widening it is a `packages/db` ruling with ' +
  'a hashed-column read behind it, and ADR-200 reports it rather than taking it';

const NO_WEBAUTHN =
  'no WebAuthn verifier is admitted in this workspace. A registration or assertion ceremony needs ' +
  'CBOR and COSE parsing and a signature check over the authenticator data, none of which is ' +
  'hand-rollable on the money path and none of which any dependency here provides. Admitting one ' +
  'is a VG-12 decision with an entry of its own, not a line in a wiring slice';

// `NO_OTP_DIGEST` STOOD HERE AND ADR-197 RULED IT; `NO_OTP_KEY_WIRED` REPLACED
// IT AND ADR-200 WIRES THE KEY, so neither survives. The key is read from the
// environment at the moment a verification needs it, by {@link resolveOtpMacKeys},
// and a deployment that has not been given one BOOTS and answers 503 on
// `POST /auth/verify` alone. That is the shape the absence has to take: a key
// resolved in `start.ts` would make a missing secret a process that will not
// start, which turns a config omission on one route into an outage on all of
// them. {@link OTP_KEY_UNRESOLVED} is what an operator reads in that 503.
const OTP_KEY_UNRESOLVED =
  'this deployment holds no usable OTP MAC key, so a code cannot be checked against the digest ' +
  '`otp_challenges.code_hash` stores. ADR-197 ruled the key a deployment secret rather than a ' +
  'row, read from `MERIT_OTP_MAC_KEY` per INFRA section 7, and there is deliberately no ' +
  'fallback: a baked-in default would be a published key. The underlying failure is';

// -----------------------------------------------------------------------------
// `NO_DELIVERY` STOOD HERE FOR TWENTY-SIX WAVES AND ADR-229 HAS RETIRED IT
// -----------------------------------------------------------------------------
// IT READ, AND IT IS QUOTED RATHER THAN DELETED because a sentence that was true
// for that long is the one a later reader will want to check against the tree
// that refutes it:
//
//   "nothing in this deployable delivers a code. A handler that writes an
//   `otp_challenges` row and answers `sent: true` having sent nothing is a worse
//   answer than 503, and the SMS branch also needs a per-send price to charge
//   against `otp_send_budget.spend_cents`, which is config that has no source in
//   this tree"
//
// THE FIRST CLAUSE IS FALSE AS OF `otp-delivery.ts`. The second is not softened
// and not deleted: it survives INTACT on the branch it was always about, and
// {@link NO_SMS_DELIVERY} carries it plus the second thing that blocks that
// branch and is not delivery at all. This is ADR-197 section 7's rule -- a
// refusal replaced by a softer version of itself is the failure mode -- applied
// in the one direction it permits, which is naming what is left rather than
// paraphrasing what is gone.
const NO_SMS_DELIVERY =
  'this deployable sends no SMS, and the two things blocking that branch are stated separately ' +
  'because they lift on different days and neither is the delivery construction. FIRST, a code ' +
  'sent to a phone cannot be verified anywhere in this tree: `verifyOtp` refuses the `sms` ' +
  'channel for want of a phone resolution, so an SMS send is money spent on a code no handler ' +
  'here can answer. SECOND, the per-send price that send charges against ' +
  '`otp_send_budget.spend_cents` has a NAME (`MERIT_OTP_SMS_PRICE_CENTS`) and no value in any ' +
  'environment, and a send that cannot be priced is a cost breaker counting every message as ' +
  'free. ADR-229 took a mail vendor and deliberately took no SMS vendor on the first of those';

/**
 * The three delivery outcomes that are not `sent`.
 *
 * DERIVED FROM THE UNION RATHER THAN RESTATED, and read by a `switch` with no
 * `default`, which is `sendTurnstileRefusal`'s idiom in `routes/auth.ts`.
 * `strict` plus `noImplicitReturns` turn a fifth outcome member in
 * `otp-delivery.ts` into a `tsc` error here rather than into a case this file
 * silently treats as one of the others.
 *
 * ALL THREE BECOME ONE 503 AT THE CALLER AND THE SPLIT IS FOR THE LOG. That is
 * where this differs from Turnstile's, and `otp-delivery.ts`'s header argues it:
 * a refused DESTINATION told apart from a broken deployment would disclose
 * through the status what API_CONTRACT section 3 withholds from the body.
 */
type OtpDeliveryRefusal = Exclude<OtpDeliveryOutcome, { readonly outcome: 'sent' }>;

/** What a refusal to deliver becomes. One 503, with the reason in the log line. */
function deliveryRefused(refusal: OtpDeliveryRefusal): AuthBackendUnwired {
  switch (refusal.outcome) {
    case 'unconfigured':
      return new AuthBackendUnwired(
        'requestOtp',
        `this deployment is not configured to deliver a code: ${refusal.detail}`,
      );
    case 'rejected':
      return new AuthBackendUnwired(
        'requestOtp',
        `the delivery vendor would not take the message: ${refusal.detail}`,
      );
    case 'unavailable':
      return new AuthBackendUnwired(
        'requestOtp',
        `the delivery vendor could not be reached: ${refusal.detail}`,
      );
  }
}

/** One refusal, so every blocked method reads identically and cites one reason each. */
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
 * @param db     the four doors. Injected so the suite can watch which one each
 *               method opens and with whose identity, which is the property that
 *               is this package's rather than `packages/db`'s.
 * @param clock  read once per call. `INV-01` keeps a clock out of the engine and
 *               this is not the engine, but a backend that reads `Date.now()`
 *               inline is a backend whose expiry behaviour cannot be asserted.
 * @param env    where the OTP MAC key comes from. A parameter for the same
 *               reason `clock` is one: `resolveOtpMacKeys` refuses a key that is
 *               absent, short or not standard base64, and a suite that could not
 *               vary the environment could assert none of it.
 * @param sender who delivers the code. ADR-229.
 *
 * THE SENDER'S DEFAULT IS THE REAL VENDOR AND NOT AN UNWIRED SENTINEL, which is
 * `routes/auth.ts`'s ruling on the Turnstile verifier applied to the other
 * outbound call on this route: a port whose default refuses everything needs a
 * wiring slice to install the working one, and a control -- or here a
 * capability -- that is live only when somebody remembers to wire it is a defect
 * one layer out. `start.ts` therefore needs no change and cannot forget.
 *
 * IT STILL FAILS CLOSED WITH NO TOKEN: `postmarkOtpSender` answers `unconfigured`
 * with none, which refuses. It also reads `env`, so a suite that varies the
 * environment varies the sender's configuration with it and the two cannot
 * disagree about which deployment they are in.
 */
export function databaseAuthBackend(
  db: ApiDb,
  clock: () => Date = () => new Date(),
  env: Environment = process.env,
  sender: OtpSender = postmarkOtpSender(env),
): AuthBackend {
  /**
   * The admitted keys, or a 503 naming the config that is missing.
   *
   * READ PER CALL AND NOT MEMOISED. The decode is one base64 round trip over 32
   * bytes and the alternative is a process that caches the absence of a key it
   * was started without, which is a deployment that cannot be repaired by
   * setting the variable and restarting the one thing that reads it.
   */
  const otpKeys = (method: string): readonly Uint8Array[] => {
    try {
      return resolveOtpMacKeys(env);
    } catch (cause) {
      if (cause instanceof OtpKeyError)
        throw new AuthBackendUnwired(method, `${OTP_KEY_UNRESOLVED}: ${cause.message}`);
      throw cause;
    }
  };

  /**
   * `sessions`, minted under the identity the caller just proved.
   *
   * THE TOKEN IS RETURNED AND THE DIGEST IS STORED, which is the one direction
   * that matters: `refresh_token_hash` is `bytea NOT NULL UNIQUE` and this
   * function is the only producer in the tree. It goes through `insertUnder`,
   * so `packages/db` PROVES `user_id` belongs to this identity inside the same
   * transaction rather than trusting the value this file passes.
   */
  const mintSession = async (
    who: { readonly identityId: string; readonly userId: string },
    factor: AuthFactor,
    context: RequestContext,
    now: Date,
  ): Promise<string> => {
    const token = mintSessionToken(who.identityId);
    await db.scoped(who.identityId, (tx) =>
      tx.insertUnder(SESSIONS, {
        userId: who.userId,
        refreshTokenHash: Buffer.from(sessionTokenHash(token)),
        expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS),
        authFactor: factor,
        // SD-M4-03's CREATION half. `ip` and `user_agent` -- 0002's original
        // pair -- are deliberately left NULL: writing both pairs would be two
        // copies of one fact, and `listSessions` already reads
        // `createdUserAgent ?? userAgent`, so the newer column is the one a
        // reader prefers.
        createdIp: context.requestIp,
        createdUserAgent: context.userAgent,
      }),
    );
    return token;
  };

  /** `users`, read at an authority holding no identity. One row or none. */
  const resolveEmail = (email: string): Promise<unknown> =>
    db.resolution((rx) => rx.rowAt('users', { email }));

  /** Both ids off a `users` row, which is what `VerifyResponse` carries. */
  const whoIs = (row: unknown): { readonly identityId: string; readonly userId: string } => {
    const r = asRow(row, 'users');
    return { identityId: str(r, 'identityId', 'users'), userId: str(r, 'id', 'users') };
  };

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
    // `verifyOtp`, and then the refusals, each with its own reason
    // -------------------------------------------------------------------------

    /**
     * `POST /auth/verify`. ADR-196's ruling, executed.
     *
     * THE ORDER IS THE RULING AND NOT A CONVENIENCE, and every step is a clause
     * somebody else already wrote:
     *
     *   1. READ the newest live challenge for the address, and MATCH the code
     *      under every admitted key. One firm transaction, because `attempts`
     *      and `consumed_at` are both written from what that read returned.
     *   2. CONSUME it. This happens BEFORE the identity exists, which is the
     *      only ordering that fails safe: ADR-126 already priced the two units
     *      of work -- "a crash between them leaves a consumed challenge and no
     *      session and the person asks for another code ... paid in an
     *      inconvenience rather than in a row". Consuming LAST would leave a
     *      code that had already minted a session still answerable.
     *   3. RESOLVE the address through the pre-identity door.
     *   4. ESTABLISH when it answered nobody. ADR-196 clause 1, and `is_new` is
     *      true on exactly this branch (clause 4).
     *   5. MINT the session.
     *
     * EVERY REFUSAL ANSWERS `null` AND THE ROUTE TURNS THAT INTO ONE 401. A bad
     * code, an expired code, a spent code, a code for an address that has no
     * live challenge and a challenge at its attempt ceiling are one answer,
     * which is `API_CONTRACT` section 3's "deliberately indistinguishable" and
     * is also what keeps `POST /auth/otp`'s promise that the surface "does not
     * reveal whether the destination exists": a verification that answered
     * differently for a known address would disclose through this route what
     * the other route withholds.
     *
     * THE `sms` ARM IS A 503 AND NOT A `null`, AND THE DIFFERENCE DISCLOSES
     * NOTHING. A `null` there would say "your code was wrong" about a channel
     * this deployment cannot answer at all; the 503 says the channel is not
     * served. The caller chose the channel, so the distinction is about their
     * own request rather than about whether some address exists.
     */
    async verifyOtp(
      input: VerifyRequest,
      context: RequestContext,
    ): Promise<Established<VerifyResponse> | null> {
      if (input.channel === 'sms') throw new AuthBackendUnwired('verifyOtp', NO_PHONE_RESOLUTION);
      const email = input.email;
      // THE VALIDATOR ALREADY REFUSED THIS AND THIS IS NOT A SECOND VALIDATOR.
      // `VerifyRequest` types `email` as optional because one shape carries two
      // channels, so the narrowing is a type obligation; answering `null`
      // rather than throwing keeps a request that reached here past the
      // validator indistinguishable from a wrong code.
      if (email === undefined || email.trim() === '') return null;
      const keys = otpKeys('verifyOtp');
      const now = clock();
      const subject = { channel: 'email', destination: email, code: input.code } as const;

      let matched: boolean;
      try {
        matched = await db.firm(async (tx) => {
          // NARROWED IN SQL AND BOUNDED AGAIN IN `newestLiveChallenge`. The
          // terms are ADR-157's read-path admissions and every one of them is
          // the reason a row is NOT a candidate: spent, expired, exhausted.
          const rows = await tx.rowsWhere(OTP_CHALLENGES, {
            channel: 'email',
            emailNormalized: normalizedEmail(email),
            consumedAt: isNull(),
            expiresAt: atLeast(now),
            attempts: atMost(OTP_MAX_ATTEMPTS - 1),
          });
          const live = newestLiveChallenge(rows, now);
          if (live === null) return false;
          if (!otpCodeMatches(keys, subject, live.codeHash)) {
            // THE LOCKOUT IS SPENT ON A WRONG CODE AND NOT ON A MISSING ONE. A
            // caller who can drive `attempts` up without holding a challenge id
            // could lock out an address they do not own, and there is no
            // challenge here to charge.
            await tx.updateAt(OTP_CHALLENGES, { id: live.id }, { attempts: live.attempts + 1 });
            return false;
          }
          await tx.updateAt(OTP_CHALLENGES, { id: live.id }, { consumedAt: now });
          return true;
        });
      } catch (cause) {
        // `0063` SAYING SOMEBODY ELSE SPENT THIS CODE WHILE WE READ IT. The
        // transaction is already rolled back, so the attempt counter is
        // unmoved and the answer is the same 401 every other refusal gives.
        if (isChallengeAlreadyConsumed(cause)) return null;
        throw cause;
      }
      if (!matched) return null;

      const existing = await resolveEmail(email);
      let who: { readonly identityId: string; readonly userId: string };
      let isNew: boolean;
      if (existing !== undefined && existing !== null) {
        who = whoIs(existing);
        isNew = false;
      } else {
        try {
          who = await db.establishment((tx) => tx.establish({ email }));
          isNew = true;
        } catch (cause) {
          // THE RACE, AND `users_email_key` IS THE ARBITER. ADR-197 ruling 4:
          // the unique violation is allowed to RAISE, so the rollback takes the
          // identity row and the three `ledger_accounts` rows `0054`'s trigger
          // wrote with it and the loser pays zero permanent rows. What it does
          // NOT do is answer the caller, so the loser resolves the address the
          // winner just created and answers `is_new: false` -- ADR-196 clause 4
          // says true on exactly the call that performed clause 1, and this
          // call did not perform it.
          if (!(cause instanceof IdentityAlreadyEstablished)) throw cause;
          const raced = await resolveEmail(email);
          if (raced === undefined || raced === null)
            throw new AuthRowError(
              'the establishment door reported this address already had a `users` row and the ' +
                'pre-identity read then found none. Those two statements cannot both be true of ' +
                'a committed database, and answering a session here would be minting one for ' +
                'an identity this handler never resolved',
            );
          who = whoIs(raced);
          isNew = false;
        }
      }

      const sessionToken = await mintSession(who, 'email_otp', context, now);
      return {
        response: {
          identity_id: who.identityId,
          user_id: who.userId,
          is_new: isNew,
          auth_factor: 'email_otp',
        },
        sessionToken,
      };
    },

    /**
     * `POST /auth/otp`. ADR-229, and the sentence that blocked it is gone.
     *
     * THE ORDER IS THE RULING, and every step refuses before the next one costs
     * anything:
     *
     *   1. THE CHANNEL. `sms` refuses here and the reason is not delivery. See
     *      {@link NO_SMS_DELIVERY}.
     *   2. THE KEY. `otpKeys` refuses a deployment that cannot take a digest,
     *      BEFORE a code is minted and before a row is written. A challenge
     *      whose `code_hash` was taken under no admitted key is a challenge
     *      nothing can ever verify.
     *   3. THE VELOCITY, counted and then the row written, in ONE firm
     *      transaction.
     *   4. THE SEND, which is the only step that leaves the process.
     *
     * THE ROW IS WRITTEN BEFORE THE SEND AND THAT ORDERING IS DELIBERATE. The
     * two orders fail differently and only one of them fails safe. Writing
     * second means a delivered code with no row to answer it, which is a person
     * holding a valid-looking code that can never verify. Writing first means at
     * worst a row nobody was sent, which expires in {@link OTP_TTL_MINUTES}
     * minutes and costs one of that address's own velocity slots. ADR-126 priced
     * this same trade one method over and took the same side: "paid in an
     * inconvenience rather than in a row".
     *
     * A FAILED SEND IS A 503 AND NEVER A 202. `OtpOutcome` has no failure arm
     * because API_CONTRACT section 3 gives the endpoint none: it answers 202
     * always, "whether or not the account exists". So a refusal to deliver
     * raises, and {@link deliveryRefused} is where the three refusing outcomes
     * become one status with three different log lines. Answering `sent: true`
     * over a message that never left is the exact sentence `NO_DELIVERY` existed
     * to keep this file from writing.
     *
     * THE COUNT-THEN-INSERT IS NOT ATOMIC ACROSS CONCURRENT REQUESTS AND THE
     * OVERSHOOT IS STATED RATHER THAN IMPLIED. Two requests for one address that
     * read the same count both insert, so the limit is a budget that converges
     * rather than a barrier that cannot be crossed; the overshoot is bounded by
     * the number of requests in flight at once for a single address, and the
     * window is what makes it converge. `0029`'s own header puts sub-minute
     * velocity "at the edge, where it can refuse a send before one is paid for"
     * and this table's job is the durable, reviewable state, so the burst arm of
     * this control is deliberately somewhere else.
     */
    async requestOtp(input: OtpRequest, requestIp: string | null): Promise<OtpOutcome> {
      if (input.channel === 'sms') throw new AuthBackendUnwired('requestOtp', NO_SMS_DELIVERY);
      const email = input.email;
      // THE VALIDATOR ALREADY REFUSED THIS AND THIS IS NOT A SECOND VALIDATOR.
      // `OtpRequest` types `email` as optional because one shape carries two
      // channels, so the narrowing is a type obligation. It raises rather than
      // answering, on `AuthRowError`'s own rule: reaching this line means the
      // handler was called past its own validator, which is a bug in this
      // deployable and not a fact about the caller's request.
      if (email === undefined || email.trim() === '')
        throw new AuthRowError(
          '`requestOtp` was called on the `email` channel with no address. ' +
            '`validateOtpRequest` refuses that shape, so this is a call that did not come ' +
            'through it',
        );
      const keys = otpKeys('requestOtp');
      // THE CURRENT KEY ISSUES AND THE RETIRING ONE ONLY VERIFIES.
      // `resolveOtpMacKeys` returns them newest first and its own docblock
      // admits the retiring key "for VERIFY only, for one TTL"; issuing under it
      // would extend a retired key's life by a full TTL past the rotation that
      // retired it.
      const issuing = keys[0];
      if (issuing === undefined)
        throw new AuthBackendUnwired(
          'requestOtp',
          `${OTP_KEY_UNRESOLVED}: the resolver admitted no key at all`,
        );

      const now = clock();
      const code = mintOtpCode();
      const digest = otpCodeDigest(issuing, { channel: 'email', destination: email, code });
      const windowStart = new Date(now.getTime() - OTP_EMAIL_WINDOW_MS);

      const decided = await db.firm(async (tx) => {
        // THE VELOCITY IS COUNTED OFF `otp_challenges` AND NOT OFF A COUNTER,
        // and the schema says so rather than this file deciding it: `0029:539`
        // calls `otp_challenges_destination_created_idx` "the per-number
        // velocity read, which is what `otp_send_budget`'s 'phone' scope is
        // counted from", and it is declared THE SMS SIBLING of
        // `otp_challenges_email_created_idx (email_normalized, created_at DESC)`
        // from `0002`. So the index for this exact read exists and was built for
        // it. EVERY ROW IN THE WINDOW COUNTS, consumed and expired ones
        // included: this is a budget on SENDING, and a code that was used is
        // still a code that was sent.
        const recent = await tx.rowsWhere(OTP_CHALLENGES, {
          channel: 'email',
          emailNormalized: normalizedEmail(email),
          createdAt: atLeast(windowStart),
        });
        if (recent.length >= OTP_EMAIL_SENDS_PER_WINDOW)
          return { limited: true, retryAfterSeconds: retryAfterFor(recent, now) } as const;
        await tx.insert(OTP_CHALLENGES, {
          channel: 'email',
          emailNormalized: normalizedEmail(email),
          codeHash: Buffer.from(digest),
          expiresAt: new Date(now.getTime() + OTP_TTL_MS),
          // WRITTEN RATHER THAN LEFT TO `DEFAULT now()`, so the window this read
          // counts over and the row it writes are measured on ONE clock. A row
          // whose `created_at` is the database's while its `expires_at` is this
          // process's is a row whose own two timestamps can disagree about which
          // came first, and `newestLiveChallenge` compares the second against
          // this same clock.
          createdAt: now,
          // SD-M4-03's caveat applies and is not repeated as a control: with no
          // `trustProxy` this is the immediate peer. It is RECORDED because the
          // column exists to record it, and nothing in this file counts on it.
          requestIp,
        });
        return { limited: false } as const;
      });

      if (decided.limited)
        return { status: 'rate_limited', retryAfterSeconds: decided.retryAfterSeconds };

      const delivery = await sender.send({
        channel: 'email',
        destination: email,
        code,
        expiresInSeconds: OTP_TTL_SECONDS,
      });
      if (delivery.outcome !== 'sent') throw deliveryRefused(delivery);
      return { status: 'sent', expiresInSeconds: OTP_TTL_SECONDS };
    },

    // BOTH ARMS ARE BLOCKED AND FOR DIFFERENT REASONS, which is worth stating
    // because the union is C-27 and a reader will ask whether the refusal is the
    // union doing its job. It is not: `ElevationFactor` refuses `sms_otp` at
    // COMPILE time and always did, and these two are the two members it admits.
    elevate: blocked(
      'elevate',
      `the passkey arm: ${NO_WEBAUTHN}. The dual_channel arm: ${NO_SMS_DELIVERY}`,
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
        `be invented. And ${NO_SMS_DELIVERY}`,
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
