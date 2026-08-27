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
// ADDRESS through the scoped door and all four land. MINTING one does not, and
// neither does resolving a person from the address they typed. Two
// constructions are missing and neither is a predicate:
//
//   B1  A PRE-IDENTITY READ HAS NO DOOR. `users.email` is `citext NOT NULL
//       UNIQUE` (0002_identity.sql) and `users` is scope class `owned` on
//       `identity_id` (scope.ts), so resolving an email to a person requires
//       already knowing the person. `firmDb()` refuses an `owned` key.
//       `systemDb(reason)` reaches it and its vocabulary is `'nightly-batch' |
//       'operator-console'`, which ADR-109 clause 1 declined to widen -- on the
//       argument that a third reason would buy a door with no predicate, which
//       ADR-112 has since supplied. THE GROUND OF THAT REFUSAL HAS MOVED AND THE
//       REFUSAL HAS NOT BEEN REVISITED. That is `packages/db`'s and the
//       founder's, on ADR-109 clause 2's own precedent, and ADR-120 reports it.
//
//   B2  A SESSION ROW CANNOT BE INSERTED AT ANY AUTHORITY A HANDLER HOLDS.
//       `ScopedTx.insert` takes `OwnedTableKey` and `sessions` is `derived`, and
//       that is deliberate rather than accidental: the accessor "cannot
//       establish that the parent is this identity's without reading it -- which
//       inside a transaction is a SELECT the caller could have skipped and
//       outside one is a race" (scoped-db.ts, on `OwnedTableKey`). ADR-102
//       section 4 names the construction that would serve it and does not build
//       it.
//
// So `POST /auth/verify` still answers 503 on a tree where `POST /auth/logout`
// answers 204, and the reason is structural rather than unfinished.
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
// **THERE IS NO MINTER IN THIS FILE AND ITS ABSENCE IS B2 RATHER THAN AN
// OVERSIGHT.** `job-queue.ts`'s rule -- a primitive admitted before a caller
// exists is a primitive nobody can remove -- is why `mintSessionToken` is not
// written: nothing can insert the row it would be minted for. What IS written is
// the parser and the digest, which have a caller, and a minter that ever lands
// must produce its token through {@link sessionTokenHash} and
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

import { createHash } from 'node:crypto';

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

const NO_PRE_IDENTITY_READ =
  'a pre-identity read has no door. `users.email` is UNIQUE and `users` is scope class `owned` ' +
  'on `identity_id`, so resolving an address to a person requires already knowing the person; ' +
  "`firmDb()` refuses an `owned` key and `systemDb`'s reason vocabulary is `nightly-batch | " +
  'operator-console`, which a request handler is not in. ADR-109 clause 1 declined to widen it ' +
  'because a third reason would have bought a door with no predicate, and ADR-112 has since ' +
  'supplied the predicate. ADR-120 reports that the ground of that refusal has moved';

const NO_DERIVED_INSERT =
  'a `sessions` row cannot be inserted at any authority a request handler holds. `ScopedTx.insert` ' +
  'takes `OwnedTableKey` and `sessions` is `derived`, because the accessor cannot establish that ' +
  "the parent row is this identity's without reading it. ADR-102 section 4 names the construction " +
  'that would serve it and deliberately does not build it';

const NO_WEBAUTHN =
  'no WebAuthn verifier is admitted in this workspace. A registration or assertion ceremony needs ' +
  'CBOR and COSE parsing and a signature check over the authenticator data, none of which is ' +
  'hand-rollable on the money path and none of which any dependency here provides. Admitting one ' +
  'is a VG-12 decision with an entry of its own, not a line in a wiring slice';

const NO_OTP_DIGEST =
  '`otp_challenges.code_hash` has no specified digest and cannot be given one here. The column ' +
  'says only "NEVER store the code itself", the code is a short one a human types, and a plain ' +
  'hash of it is a one-million-candidate offline break for anybody holding the table. A keyed MAC ' +
  'is the correct answer and there is nowhere to keep the key: the table carries no salt column ' +
  'and no key id, so the repair is a deployment secret or a migration. Either is a ruling with a ' +
  "config surface behind it and neither is a wiring slice's";

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
    verifyOtp: blocked(
      'verifyOtp',
      `${NO_PRE_IDENTITY_READ}. It is also blocked twice more: ${NO_DERIVED_INSERT}; and ` +
        NO_OTP_DIGEST,
    ),

    requestOtp: blocked('requestOtp', `${NO_DELIVERY}. And ${NO_OTP_DIGEST}`),

    // BOTH ARMS ARE BLOCKED AND FOR DIFFERENT REASONS, which is worth stating
    // because the union is C-27 and a reader will ask whether the refusal is the
    // union doing its job. It is not: `ElevationFactor` refuses `sms_otp` at
    // COMPILE time and always did, and these two are the two members it admits.
    elevate: blocked(
      'elevate',
      `the passkey arm: ${NO_WEBAUTHN}. The dual_channel arm: ${NO_OTP_DIGEST}`,
    ),

    passkeyRegisterOptions: blocked('passkeyRegisterOptions', NO_WEBAUTHN),
    passkeyRegisterVerify: blocked('passkeyRegisterVerify', NO_WEBAUTHN),
    passkeyLoginOptions: blocked('passkeyLoginOptions', NO_WEBAUTHN),
    passkeyLoginVerify: blocked(
      'passkeyLoginVerify',
      `${NO_WEBAUTHN}. And, before the ceremony: ${NO_PRE_IDENTITY_READ}. And ${NO_DERIVED_INSERT}`,
    ),

    verifyPhone: blocked(
      'verifyPhone',
      '`PhoneVerifyResponse.line_type` is a carrier lookup (ADR-039 (a) scores VoIP and never ' +
        'rejects it) and no lookup adapter exists in this workspace, so the field would have to ' +
        `be invented. And ${NO_OTP_DIGEST}`,
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
