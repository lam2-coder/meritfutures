import { createHash } from 'node:crypto';

import { expect, test } from 'vitest';

import { IdentityAlreadyEstablished, normalizedEmail } from '@merit/db';
import {
  AuthRowError,
  OTP_MAC_KEY_RETIRING_VAR,
  OTP_MAC_KEY_VAR,
  OTP_MAX_ATTEMPTS,
  OtpKeyError,
  SESSION_LIFETIME_MS,
  SESSION_SECRET_BYTES,
  SESSION_TOKEN_SEPARATOR,
  databaseAuthBackend,
  isChallengeAlreadyConsumed,
  mintSessionToken,
  otpCodeDigest,
  otpCodeMatches,
  parseSessionToken,
  resolveOtpMacKeys,
  sessionTokenHash,
  userAgentFamily,
} from '../src/auth-backend.ts';
import { DbDoorError, LIVE_DB, isIdentityId } from '../src/db.ts';
import { AuthBackendUnwired, UNWIRED_AUTH_BACKEND } from '../src/routes/auth.ts';
import type { AuthBackend, AuthSession } from '../src/routes/auth.ts';
import { recordingDb } from './db-recorder.ts';

// CI-02, the `unit` project.
//
// WHAT THIS SUITE ASSERTS AND WHAT IT DELIBERATELY DOES NOT. ADR-120. Every case
// below is about a property of `apps/api`: which door was opened, whose identity
// was handed to it, what address was named, and what a zero-row write is turned
// into. NONE of them asserts that a scoped predicate reaches one row rather than
// many -- that is `packages/db`'s, it is watched failing on eight seeded
// mutations in `packages/db/test/keyed-accessor.test.ts`, and a case here that
// claimed it would be agreeing with `db-recorder.ts`'s own fake.
//
// THE TWO HALVES OF THE CROSS-IDENTITY REFUSAL, SO NEITHER IS MISTAKEN FOR THE
// OTHER. This file asserts that a revoke of another identity's session is
// ADDRESSED through THIS identity's scoped door and that a write landing nowhere
// becomes a 404. ADR-120's approval clause asserts, against a real PostgreSQL,
// that such a write lands nowhere. Together they are the control; separately
// each is half of it, and both halves are stated rather than one being implied.

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const ALICE_SESSION = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const BOB_SESSION = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

const NOW = new Date('2026-08-27T12:00:00.000Z');
const clock = (): Date => NOW;
const LATER = new Date('2026-09-27T12:00:00.000Z');
const EARLIER = new Date('2026-08-01T12:00:00.000Z');

function session(id = ALICE_SESSION, identityId = ALICE): AuthSession {
  return {
    id,
    identityId,
    userId: 'cccccccc-3333-4333-8333-cccccccccccc',
    authFactor: 'email_otp',
    elevatedAt: null,
    elevatedByFactor: null,
  };
}

/** A `sessions` row as the accessor hands one back: property-keyed, real Dates. */
function sessionRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ALICE_SESSION,
    userId: 'cccccccc-3333-4333-8333-cccccccccccc',
    authFactor: 'email_otp',
    elevatedAt: null,
    elevatedByFactor: null,
    revokedAt: null,
    expiresAt: LATER,
    createdAt: EARLIER,
    lastSeenAt: null,
    userAgent: null,
    createdUserAgent: null,
    ...over,
  };
}

// -----------------------------------------------------------------------------
// The token, which is the ruling this file exists downstream of
// -----------------------------------------------------------------------------

test('the token carries its identity, and the digest is over the WHOLE string', () => {
  // THE FIRST OF THE TWO INDEPENDENT REFUSALS. Rewriting the identity claim to
  // another identity's changes the digest, so the address matches no row at all
  // -- before the scope predicate is ever consulted. Hashing only the part after
  // the separator would leave this half absent and the control resting on one leg.
  //
  // THE LITERAL IS LOW ENTROPY AND THE VARIABLE IS NOT CALLED `secret`, AND BOTH
  // HALVES ARE DELIBERATE. `CI-05` runs `gitleaks git .`, whose `generic-api-key`
  // rule fires on a high-entropy value assigned to an identifier carrying one of
  // its keywords. A base64 blob bound to `const secret` is that rule's exact
  // shape even when the value is a fake nobody could use, and this test needs
  // neither property: what it asserts is that ONE value under TWO identity
  // claims digests differently, which any two equal strings demonstrate. Do not
  // "improve" this into something that looks more like a token.
  const tail = 'the-same-tail-on-both';
  const mine = `${ALICE}${SESSION_TOKEN_SEPARATOR}${tail}`;
  const stolen = `${BOB}${SESSION_TOKEN_SEPARATOR}${tail}`;
  expect(Buffer.from(sessionTokenHash(mine))).not.toEqual(Buffer.from(sessionTokenHash(stolen)));
  // And it is the digest of the token as sent, which is what a minter has to
  // reproduce. Spelled here so a minter written later cannot drift silently.
  expect(Buffer.from(sessionTokenHash(mine))).toEqual(createHash('sha256').update(mine).digest());
});

test('a token whose identity claim is not a uuid is refused before any door', async () => {
  expect(parseSessionToken('not-a-uuid.secret')).toBeNull();
  expect(parseSessionToken('secret-with-no-separator')).toBeNull();
  expect(parseSessionToken(`${ALICE}${SESSION_TOKEN_SEPARATOR}`)).toBeNull();
  expect(parseSessionToken(`${SESSION_TOKEN_SEPARATOR}secret`)).toBeNull();

  const { db, calls } = recordingDb();
  expect(await databaseAuthBackend(db, clock).sessionByToken('not-a-uuid.secret')).toBeNull();
  // NO DOOR AT ALL. An attacker-supplied cookie must not reach the accessor,
  // because a predicate over junk is a query somebody has to run.
  expect(calls).toEqual([]);
});

test('sessionByToken opens the SCOPED door with the identity the token claimed', async () => {
  const token = `${ALICE}${SESSION_TOKEN_SEPARATOR}secret`;
  const { db, calls } = recordingDb({ rowAt: sessionRow() });
  const resolved = await databaseAuthBackend(db, clock).sessionByToken(token);

  expect(calls).toHaveLength(1);
  expect(calls[0]?.door).toBe('scoped');
  expect(calls[0]?.identityId).toBe(ALICE);
  expect(calls[0]?.verb).toBe('rowAt');
  expect(calls[0]?.key).toBe('sessions');
  // THE ADDRESS IS THE DIGEST AND NOTHING ELSE. `refresh_token_hash` is UNIQUE
  // in the DDL and in the transcription, which is what makes it a legal address
  // under ADR-112 clause 2.
  expect(calls[0]?.address).toEqual({ refreshTokenHash: Buffer.from(sessionTokenHash(token)) });

  // THE IDENTITY IS NOT READ OFF THE ROW. `sessions` carries `user_id` and no
  // `identity_id`; the row coming back through this identity's door IS the proof.
  expect(resolved?.identityId).toBe(ALICE);
  expect(resolved?.id).toBe(ALICE_SESSION);
  expect(resolved?.authFactor).toBe('email_otp');
});

test('a revoked or expired session resolves to null rather than to a session', async () => {
  const token = `${ALICE}${SESSION_TOKEN_SEPARATOR}secret`;
  const revoked = recordingDb({ rowAt: sessionRow({ revokedAt: EARLIER }) });
  expect(await databaseAuthBackend(revoked.db, clock).sessionByToken(token)).toBeNull();

  const expired = recordingDb({ rowAt: sessionRow({ expiresAt: EARLIER }) });
  expect(await databaseAuthBackend(expired.db, clock).sessionByToken(token)).toBeNull();

  // AND THE BOUNDARY IS `<=` RATHER THAN `<`: a session expiring exactly now is
  // expired. The other direction would serve a request on a session whose whole
  // remaining life is the round trip.
  const atTheInstant = recordingDb({ rowAt: sessionRow({ expiresAt: NOW }) });
  expect(await databaseAuthBackend(atTheInstant.db, clock).sessionByToken(token)).toBeNull();

  const missing = recordingDb({ rowAt: undefined });
  expect(await databaseAuthBackend(missing.db, clock).sessionByToken(token)).toBeNull();
});

// -----------------------------------------------------------------------------
// C-27 AT THE READ BOUNDARY, WHICH IS WHERE A UNION GETS WIDENED QUIETLY
// -----------------------------------------------------------------------------
// Session 218's approval clause is that an SMS-established factor for elevation
// FAILS TO COMPILE, and `auth.test.ts` holds those `@ts-expect-error` lines. They
// are about a value going IN. This is the same boundary on the way OUT, and it
// is the one a wiring change can break while every one of those lines still
// compiles: `elevatedByFactor: row['elevated_by_factor'] as ElevationFactor`
// type-checks, satisfies every existing case, and turns any string the database
// happens to hold into a factor `authorize` will honour.

test('a session elevated by a factor outside C-27 raises rather than elevating', async () => {
  const token = `${ALICE}${SESSION_TOKEN_SEPARATOR}secret`;
  const { db } = recordingDb({
    rowAt: sessionRow({ elevatedAt: EARLIER, elevatedByFactor: 'sms_otp' }),
  });
  await expect(databaseAuthBackend(db, clock).sessionByToken(token)).rejects.toThrow(AuthRowError);
  await expect(databaseAuthBackend(db, clock).sessionByToken(token)).rejects.toThrow(/C-27/);
});

test('both admitted elevation factors read back, so the refusal is about sms_otp', async () => {
  const token = `${ALICE}${SESSION_TOKEN_SEPARATOR}secret`;
  for (const factor of ['passkey', 'dual_channel'] as const) {
    const { db } = recordingDb({
      rowAt: sessionRow({ elevatedAt: EARLIER, elevatedByFactor: factor }),
    });
    const resolved = await databaseAuthBackend(db, clock).sessionByToken(token);
    expect(resolved?.elevatedByFactor).toBe(factor);
    expect(resolved?.elevatedAt).toBe(EARLIER.toISOString());
  }
});

test('an auth_factor outside the CHECK list raises rather than being cast', async () => {
  const token = `${ALICE}${SESSION_TOKEN_SEPARATOR}secret`;
  const { db } = recordingDb({ rowAt: sessionRow({ authFactor: 'password' }) });
  await expect(databaseAuthBackend(db, clock).sessionByToken(token)).rejects.toThrow(AuthRowError);
});

// -----------------------------------------------------------------------------
// The three writes, and the one that is the approval clause's subject
// -----------------------------------------------------------------------------

test('logout addresses the session the request arrived on and no other', async () => {
  const { db, calls } = recordingDb({ updateAt: [sessionRow()] });
  await databaseAuthBackend(db, clock).logout(session());
  expect(calls).toEqual([
    {
      door: 'scoped',
      identityId: ALICE,
      verb: 'updateAt',
      key: 'sessions',
      address: { id: ALICE_SESSION },
      values: { revokedAt: NOW },
    },
  ]);
});

test('revokeSession scopes by the SESSION identity and addresses the CALLER id', async () => {
  // THE PROPERTY THAT IS THIS PACKAGE'S. A handler holding Alice's session and a
  // path parameter naming Bob's session must open ALICE's door -- the identity
  // comes from what `sessionByToken` proved, never from anything on the request.
  // A backend that scoped by a request-supplied identity would pass every other
  // case in this file.
  const { db, calls } = recordingDb({ updateAt: [] });
  const answer = await databaseAuthBackend(db, clock).revokeSession(session(), BOB_SESSION);

  expect(calls).toHaveLength(1);
  expect(calls[0]?.identityId).toBe(ALICE);
  expect(calls[0]?.address).toEqual({ id: BOB_SESSION });
  // AND ZERO ROWS IS `null`, WHICH THE ROUTE TURNS INTO 404. API_CONTRACT
  // section 1: a path parameter naming a resource the caller does not own
  // returns 404 and never 403, so the surface does not confirm that somebody
  // else's session exists.
  expect(answer).toBeNull();
});

test('revokeSession reports a write that landed', async () => {
  const { db, calls } = recordingDb({ updateAt: [sessionRow({ id: BOB_SESSION })] });
  expect(await databaseAuthBackend(db, clock).revokeSession(session(), BOB_SESSION)).toBe(
    'revoked',
  );
  expect(calls[0]?.values).toEqual({ revokedAt: NOW });
});

test('a path parameter that is not a uuid is a 404 and never reaches the accessor', async () => {
  // Handing it through would render `sessions.id = 'nonsense'` and Postgres
  // would raise `invalid input syntax for type uuid`, which is a 500 for a
  // request whose honest answer is "no such session of yours".
  const { db, calls } = recordingDb({ updateAt: [sessionRow()] });
  expect(await databaseAuthBackend(db, clock).revokeSession(session(), 'nonsense')).toBeNull();
  expect(calls).toEqual([]);
});

// -----------------------------------------------------------------------------
// The list
// -----------------------------------------------------------------------------

test('listSessions returns live rows only, marks the current one, and coarsens the agent', async () => {
  const CHROME =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/140.0.0.0 Safari/537.36';
  const { db, calls } = recordingDb({
    rows: [
      sessionRow({ id: ALICE_SESSION, createdAt: EARLIER, createdUserAgent: CHROME }),
      sessionRow({ id: BOB_SESSION, createdAt: NOW, revokedAt: EARLIER }),
      sessionRow({ id: 'dddddddd-4444-4444-8444-dddddddddddd', expiresAt: EARLIER }),
      sessionRow({
        id: 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee',
        createdAt: NOW,
        elevatedAt: EARLIER,
        elevatedByFactor: 'passkey',
        lastSeenAt: NOW,
      }),
    ],
  });
  const rows = await databaseAuthBackend(db, clock).listSessions(session());

  expect(calls).toEqual([{ door: 'scoped', identityId: ALICE, verb: 'rows', key: 'sessions' }]);
  expect(rows.map((r) => r.id)).toEqual(['eeeeeeee-5555-4555-8555-eeeeeeeeeeee', ALICE_SESSION]);
  expect(rows[1]?.is_current).toBe(true);
  expect(rows[0]?.is_current).toBe(false);
  expect(rows[0]?.elevated).toBe(true);
  expect(rows[1]?.elevated).toBe(false);
  // COARSE, NEVER THE RAW STRING. The whole point of the column on a security
  // screen is that a person recognises their devices; a user-agent string is a
  // worse answer to that and a fingerprint handed back over the wire.
  expect(rows[1]?.user_agent_family).toBe('Chrome');
  expect(JSON.stringify(rows)).not.toContain('AppleWebKit');
  // Nothing stamps `last_seen_at`, so it falls back to `created_at` rather than
  // to null, which the response type does not admit. ADR-120 reports the gap.
  expect(rows[1]?.last_seen_at).toBe(EARLIER.toISOString());
  expect(rows[0]?.last_seen_at).toBe(NOW.toISOString());
});

test('an elevation pair that is half written reads as NOT elevated', () => {
  // `sessions_elevation_is_complete` refuses to store one, and `isElevated`
  // reads the pair rather than either half so a row that violated it fails
  // closed. This is that rule at the projection.
  const { db } = recordingDb({ rows: [sessionRow({ elevatedAt: EARLIER })] });
  return expect(
    databaseAuthBackend(db, clock)
      .listSessions(session())
      .then((rows) => rows[0]?.elevated),
  ).resolves.toBe(false);
});

test('the agent vocabulary is closed and its ORDER is the trap', () => {
  // Every Chromium agent contains `Safari`, Edge contains `Chrome`, and Chrome
  // on iOS contains neither `Chrome` nor `Chromium`. A test that only checked
  // Chrome would pass on a classifier that called Edge Chrome.
  expect(userAgentFamily('Mozilla/5.0 Chrome/140 Safari/537.36 Edg/140')).toBe('Edge');
  expect(userAgentFamily('Mozilla/5.0 Chrome/140 Safari/537.36 OPR/119')).toBe('Opera');
  expect(userAgentFamily('Mozilla/5.0 (iPhone) CriOS/140 Mobile/15E148 Safari/604.1')).toBe(
    'Chrome',
  );
  expect(userAgentFamily('Mozilla/5.0 (iPhone) FxiOS/140 Mobile/15E148 Safari/605.1')).toBe(
    'Firefox',
  );
  expect(userAgentFamily('Mozilla/5.0 Gecko/20100101 Firefox/141.0')).toBe('Firefox');
  expect(userAgentFamily('Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36')).toBe('Chrome');
  expect(userAgentFamily('Mozilla/5.0 Version/17.6 Safari/605.1.15')).toBe('Safari');
  // UNRECOGNISED IS `unknown` AND NEVER A GUESS: a wrong family name on a
  // security screen invites a person to recognise a device that is not theirs.
  expect(userAgentFamily('curl/8.5.0')).toBe('unknown');
  expect(userAgentFamily(null)).toBe('unknown');
  expect(userAgentFamily('   ')).toBe('unknown');
});

// -----------------------------------------------------------------------------
// The refusals
// -----------------------------------------------------------------------------
// THIS HEADING NAMED A COUNT AND THE COUNT WAS TWELVE while the case fifteen
// lines below asserted eleven, in this file, green. `routes/auth.ts`'s port
// docblock states the partition once and quotes the commands that settle it
// against `auth-backend.ts`; nothing here restates it.

/**
 * The five wired, named once so the partition below is checkable.
 *
 * `verifyOtp` IS THE FIFTH AND IT ARRIVED WITH ADR-200. The four before it are
 * ADR-120's, and the difference between them is worth a sentence: those four
 * ADDRESS rows through one door, and this one composes all four doors in a ruled
 * order and is the only method in the file that WRITES a row nobody owned.
 */
const WIRED = ['sessionByToken', 'logout', 'listSessions', 'revokeSession', 'verifyOtp'] as const;

test('every method of the port is either wired or refused, and none is forgotten', () => {
  // THE ASSERTION THAT SURVIVES A NEW METHOD. `AuthBackend` gaining a
  // seventeenth member is a compile error in `databaseAuthBackend` and this is
  // the case that catches the other direction: a method quietly moved out of
  // `WIRED` without being refused, or a refusal added for a method that was
  // wired. The two lists are read off the OBJECT rather than restated.
  const backend = databaseAuthBackend(recordingDb().db, clock);
  const names = Object.keys(backend);
  expect(names).toHaveLength(Object.keys(UNWIRED_AUTH_BACKEND).length);
  for (const wired of WIRED) expect(names).toContain(wired);
});

test('the eleven refuse as AuthBackendUnwired, each with its own reason, opening no door', async () => {
  const { db, calls } = recordingDb();
  const backend = databaseAuthBackend(db, clock) as unknown as Record<
    string,
    (...args: unknown[]) => Promise<unknown>
  >;
  const blocked = Object.keys(databaseAuthBackend(db, clock)).filter(
    (name) => !(WIRED as readonly string[]).includes(name),
  );
  expect(blocked).toHaveLength(11);

  const reasons = new Set<string>();
  for (const name of blocked) {
    const err: unknown = await backend[name]?.(session(), {}).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err, name).toBeInstanceOf(AuthBackendUnwired);
    const unwired = err as AuthBackendUnwired;
    // A 503 FROM `POST /auth/verify` IS A DIFFERENT FACT FROM A 503 FROM
    // `POST /auth/passkey/login/options`, and one shared sentence would make
    // them the same fact to whoever reads the log.
    expect(unwired.message, name).toContain(name);
    expect(unwired.reason.length, name).toBeGreaterThan(40);
    reasons.add(unwired.reason);
  }
  // ELEVEN METHODS AND EIGHT OR MORE DISTINCT REASONS: the phone-change trio
  // shares a schema gap with three different tails, and the two passkey
  // ceremonies that need nothing but a verifier share one exactly. Asserted as
  // "more than one reason per blocker class" rather than as a count, because a
  // count here would drift the first time two of them merged.
  expect(reasons.size).toBeGreaterThanOrEqual(8);
  // AND NOT ONE OF THEM TOUCHED THE DATABASE. A refusal that opened a
  // transaction first would be a 503 that had already spent a connection.
  expect(calls).toEqual([]);
});

test('the refusals name what is actually missing rather than saying "not implemented"', async () => {
  const backend = databaseAuthBackend(recordingDb().db, clock);
  const reasonOf = async (call: Promise<unknown>): Promise<string> =>
    call.then(
      () => '',
      (e: unknown) => (e as AuthBackendUnwired).reason,
    );

  // THIS CASE PINNED B1 AND B2 AND BOTH WERE DISCHARGED BEFORE IT WAS EDITED.
  // It asserted the words "pre-identity read" and "OwnedTableKey", which is a
  // suite holding a refusal in place after ADR-126 built the two constructions
  // it named -- so the suite was GREEN over a live 503 whose log line was
  // false. ADR-197 repaired the strings; ADR-200 wrote the handler, so the
  // sentence THAT entry left ("the handler that composes them does not") is
  // itself now the stale one and this case reads the SMS arm, which is the one
  // thing `POST /auth/verify` still cannot do. The property is unchanged: a
  // refusal must not cite a construction that exists.
  const verify = await reasonOf(
    backend.verifyOtp(
      { channel: 'sms', phone: '+15550000000', code: '000000' },
      { requestIp: null, userAgent: null },
    ),
  );
  expect(verify).toContain('RESOLUTION_ADDRESS');
  for (const discharged of [
    'a pre-identity read has no door',
    'takes `OwnedTableKey`',
    'the handler that composes them does not',
  ])
    expect(verify, `verifyOtp still cites ${discharged}`).not.toContain(discharged);
  // The schema gap session 218 found rather than went looking for.
  expect(await reasonOf(backend.readPhoneChange(session()))).toContain('no preview column');
  // The contract field with no configured source.
  expect(await reasonOf(backend.readMe(session()))).toContain('max_accounts');
});

test('no refusal in this file cites the OTP digest as unspecified', async () => {
  // ADR-197 RULED IT, so a method still claiming `otp_challenges.code_hash` has
  // no digest is the same class of stale sentence the case above repairs. Every
  // method on the object is read, not just the ones that used to cite it.
  const backend = databaseAuthBackend(recordingDb().db, clock);
  const methods: Array<[string, () => Promise<unknown>]> = [
    [
      'verifyOtp',
      () =>
        backend.verifyOtp(
          { channel: 'sms', phone: '+15550000000', code: '0' },
          { requestIp: null, userAgent: null },
        ),
    ],
    ['requestOtp', () => backend.requestOtp({ channel: 'email', turnstile_token: 't' }, null)],
    ['elevate', () => backend.elevate(session(), { factor: 'passkey', credential: {} })],
    ['verifyPhone', () => backend.verifyPhone(session(), { challenge_id: 'c', code: '0' })],
  ];
  for (const [name, call] of methods) {
    const reason = await call().then(
      () => '',
      (e: unknown) => (e as AuthBackendUnwired).reason,
    );
    expect(reason, name).not.toContain('has no specified digest');
  }
});

test('the default backend still fails closed, and says a different thing', async () => {
  // TWO KINDS OF ABSENCE AND BOTH ARE 503. A process that never ran its wiring
  // holds this one, and its reason is about the wiring rather than about the
  // accessor -- which is the difference an operator needs and a client must not
  // be told.
  const err: unknown = await UNWIRED_AUTH_BACKEND.logout(session()).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AuthBackendUnwired);
  expect((err as AuthBackendUnwired).reason).toContain('no backend is installed');
});

// -----------------------------------------------------------------------------
// The door itself
// -----------------------------------------------------------------------------

test('the live scoped door refuses a value that is not an identity, before the accessor', async () => {
  // `IdentityId` is a branded string with no constructor, so every caller
  // outside `packages/db` writes an assertion. The guard is what makes that
  // assertion safe: a malformed identity is an exception here rather than a
  // `WHERE identity_id = 'nonsense'` that returns zero rows and reads like an
  // empty account. It also never reaches `client()`, so no `DATABASE_URL` is
  // needed to assert it.
  expect(isIdentityId(ALICE)).toBe(true);
  expect(isIdentityId('nonsense')).toBe(false);
  expect(isIdentityId('')).toBe(false);
  await expect(LIVE_DB.scoped('nonsense', () => Promise.resolve(1))).rejects.toThrow(DbDoorError);
});

test('the backend the deployment installs is the database one', () => {
  // `start.ts` is the wiring slice and `index.ts` is the exports target, so a
  // test that imported the package must not thereby acquire a backend that
  // opens sockets. This asserts the two are different objects rather than
  // asserting on the process.
  const backend: AuthBackend = databaseAuthBackend(recordingDb().db, clock);
  expect(backend).not.toBe(UNWIRED_AUTH_BACKEND);
  expect(backend.sessionByToken).not.toBe(UNWIRED_AUTH_BACKEND.sessionByToken);
});

// =============================================================================
// THE OTP DIGEST (ADR-197)
// =============================================================================
// `otp_challenges.code_hash` over a six-digit code a human types. Every case
// here is about a SEPARATION the digest makes that the row cannot, and the
// sharpest of them is `crossPerson`: `otp_challenges` keys off
// `email_normalized`, `users.email_normalized` is deliberately NOT unique, and
// so the challenge row cannot tell two people apart whom the normalizer merged.

const KEY_A = Buffer.alloc(32, 0xa1);
const KEY_B = Buffer.alloc(32, 0xb2);
const SUBJECT = { channel: 'email', code: '482913', destination: 'Bob.Smith@Gmail.com' } as const;

test('the digest is 32 bytes and it is the KEY that makes it one, not the algorithm', () => {
  const under = otpCodeDigest(KEY_A, SUBJECT);
  expect(under).toHaveLength(32);
  // THE WHOLE RULING IN ONE ASSERTION. An unkeyed digest of a six-digit code is
  // a one-million-candidate offline break for anybody holding the table; this
  // says the same input under a different key is a different digest, which is
  // what "the attacker does not have the key" is worth.
  expect(Buffer.from(under).equals(Buffer.from(otpCodeDigest(KEY_B, SUBJECT)))).toBe(false);
});

test('a code that differs by one digit does not match', () => {
  const stored = otpCodeDigest(KEY_A, SUBJECT);
  expect(otpCodeMatches([KEY_A], { ...SUBJECT, code: '482914' }, stored)).toBe(false);
  expect(otpCodeMatches([KEY_A], SUBJECT, stored)).toBe(true);
});

test('casing does not create a second human, because `users.email` is citext', () => {
  const stored = otpCodeDigest(KEY_A, SUBJECT);
  expect(otpCodeMatches([KEY_A], { ...SUBJECT, destination: 'bob.smith@gmail.com' }, stored)).toBe(
    true,
  );
});

test('two addresses sharing a NORMALIZED form do not share a digest', () => {
  // THE SEPARATION THE CHALLENGE ROW CANNOT MAKE, and the reason this digest
  // binds the address AS TYPED. `normalizedEmail` is `packages/db`'s, over the
  // column whose own comment says the key is "deliberately NOT unique... a
  // SIGNAL, not a constraint". Without this binding a code mailed to
  // `bob.smith@gmail.com` answers a challenge presented as `bobsmith@gmail.com`,
  // which is one person authenticating as another.
  expect(normalizedEmail(SUBJECT.destination)).toBe(normalizedEmail('bobsmith@gmail.com'));
  const stored = otpCodeDigest(KEY_A, SUBJECT);
  expect(otpCodeMatches([KEY_A], { ...SUBJECT, destination: 'bobsmith@gmail.com' }, stored)).toBe(
    false,
  );
});

test('the channel is bound, so an email challenge is not an SMS one', () => {
  const stored = otpCodeDigest(KEY_A, SUBJECT);
  expect(otpCodeMatches([KEY_A], { ...SUBJECT, channel: 'sms' }, stored)).toBe(false);
});

test('the fields are length-prefixed, so a destination cannot be extended into a code', () => {
  const a = otpCodeDigest(KEY_A, { channel: 'email', destination: 'ab', code: 'c' });
  const b = otpCodeDigest(KEY_A, { channel: 'email', destination: 'a', code: 'bc' });
  expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
});

test('a stored value of the wrong length answers `false` rather than throwing', () => {
  // `timingSafeEqual` RAISES on a length mismatch, and a raise here would turn a
  // corrupt row into a 500 on the auth path. A digest length is not a secret.
  expect(otpCodeMatches([KEY_A], SUBJECT, new Uint8Array(16))).toBe(false);
});

test('a rotation window verifies under EITHER key and issuing uses the first', () => {
  const underRetiring = otpCodeDigest(KEY_B, SUBJECT);
  expect(otpCodeMatches([KEY_A, KEY_B], SUBJECT, underRetiring)).toBe(true);
  // AND THE WINDOW IS WHAT CLOSES IT. Once the retiring key is dropped from the
  // list the same challenge stops verifying, which is why the window is one TTL
  // and why `otp_challenges` needs no `key_id` column to have one.
  expect(otpCodeMatches([KEY_A], SUBJECT, underRetiring)).toBe(false);
});

test('a verification with no admitted key is refused, not answered `false`', () => {
  // A DENIAL IS THE WRONG ANSWER TO A MISCONFIGURATION: it would be a total
  // outage wearing the costume of a wrong code, on the endpoint that is the only
  // way into the product.
  expect(() => otpCodeMatches([], SUBJECT, otpCodeDigest(KEY_A, SUBJECT))).toThrow(OtpKeyError);
});

test('a key shorter than the digest it keys is refused', () => {
  expect(() => otpCodeDigest(Buffer.alloc(31, 1), SUBJECT)).toThrow(/floor is 32/);
});

test('an empty destination or an empty code is refused rather than digested', () => {
  expect(() => otpCodeDigest(KEY_A, { ...SUBJECT, destination: '' })).toThrow(
    /binds the code to nobody/,
  );
  expect(() => otpCodeDigest(KEY_A, { ...SUBJECT, code: '' })).toThrow(/destination alone/);
});

test('the key comes off the environment and there is NO default', () => {
  // INFRA section 7: secrets live in the platform vault and are injected as
  // environment variables. A baked-in fallback is a published key, so an unset
  // variable is a throw and never a constant.
  expect(() => resolveOtpMacKeys({})).toThrow(new RegExp(`${OTP_MAC_KEY_VAR} is unset`));
  const one = resolveOtpMacKeys({ [OTP_MAC_KEY_VAR]: KEY_A.toString('base64') });
  expect(one).toHaveLength(1);
  expect(Buffer.from(one[0] as Uint8Array).equals(KEY_A)).toBe(true);
});

test('a retiring key is admitted second, and only for verifying', () => {
  const keys = resolveOtpMacKeys({
    [OTP_MAC_KEY_VAR]: KEY_A.toString('base64'),
    [OTP_MAC_KEY_RETIRING_VAR]: KEY_B.toString('base64'),
  });
  expect(keys).toHaveLength(2);
  expect(Buffer.from(keys[0] as Uint8Array).equals(KEY_A)).toBe(true);
});

test('a rotation to the value it was rotating away from is refused', () => {
  expect(() =>
    resolveOtpMacKeys({
      [OTP_MAC_KEY_VAR]: KEY_A.toString('base64'),
      [OTP_MAC_KEY_RETIRING_VAR]: KEY_A.toString('base64'),
    }),
  ).toThrow(/rotation nobody performed/);
});

test('the base64 decode is STRICT, because a lenient one shortens a key silently', () => {
  // `Buffer.from(_, 'base64')` ignores every character it does not recognise, so
  // a truncated or corrupted secret decodes to a SHORTER WORKING KEY and the
  // deployment runs on it. The round trip is what refuses that.
  expect(() => resolveOtpMacKeys({ [OTP_MAC_KEY_VAR]: '!!!!not base64!!!!' })).toThrow(
    /standard padded base64/,
  );
  expect(() =>
    resolveOtpMacKeys({ [OTP_MAC_KEY_VAR]: Buffer.alloc(31, 1).toString('base64') }),
  ).toThrow(/floor is 32/);
});

// -----------------------------------------------------------------------------
// `POST /auth/verify`: the handler ADR-196 priced and ADR-200 wrote
// -----------------------------------------------------------------------------
// WHAT THESE CASES ASSERT AND WHAT THEY DELIBERATELY DO NOT, on `db-recorder.ts`'s
// own limit. Every case below is a property of `apps/api`: WHICH DOOR was
// opened, IN WHAT ORDER, WITH WHOSE IDENTITY, WHAT ADDRESS was named and WHAT
// VALUES were written. That the establishment door's two inserts are ONE unit of
// work, and that the loser of a race pays zero rows, is `packages/db`'s and is
// asserted in `packages/db/test/establishment.test.ts` and executed against a
// real PostgreSQL by ADR-197 section 6 and ADR-200 section 8. A case here
// claiming it would be agreeing with the recorder.

const CHALLENGE = 'dddddddd-4444-4444-8444-dddddddddddd';
const USER = 'cccccccc-3333-4333-8333-cccccccccccc';

/**
 * A 32 byte key, BUILT rather than written.
 *
 * `CI-05` runs `gitleaks`, whose `generic-api-key` rule fires on a high-entropy
 * literal, and a base64 blob in a test file is that rule's exact shape even when
 * the value is a fake. `Buffer.alloc` produces a key of the right LENGTH, which
 * is the only property `refuseWeakKey` reads.
 */
const MAC_KEY = Buffer.alloc(32, 7);
const KEYED = { [OTP_MAC_KEY_VAR]: MAC_KEY.toString('base64') };

/**
 * The address AS TYPED, which normalizes to something else.
 *
 * The dot and the plus-tag both survive in `users.email` and both disappear from
 * `users.email_normalized`, so every case below that names one form and gets the
 * other back is reading a real distinction rather than a spelling.
 */
const TYPED = 'Bob.Smith+merit@example.test';
const CODE = '123456';

function digestOf(destination: string, code: string): Buffer {
  return Buffer.from(otpCodeDigest(MAC_KEY, { channel: 'email', destination, code }));
}

/** One `otp_challenges` row as the accessor hands one back: property-keyed. */
function challengeRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CHALLENGE,
    emailNormalized: normalizedEmail(TYPED),
    codeHash: digestOf(TYPED, CODE),
    expiresAt: LATER,
    consumedAt: null,
    attempts: 0,
    requestIp: null,
    createdAt: EARLIER,
    channel: 'email',
    destinationHash: null,
    ...over,
  };
}

/** A `users` row as the pre-identity read hands one back. */
const USER_ROW = { id: USER, identityId: ALICE, email: TYPED };

const VERIFY = { channel: 'email', email: TYPED, code: CODE } as const;
const FROM = { requestIp: '203.0.113.7', userAgent: 'Mozilla/5.0 (X11) Firefox/140.0' } as const;

test('a verified code for an address nobody holds creates the identity, and is_new is true', async () => {
  const { db, calls } = recordingDb({
    rowsWhere: [challengeRow()],
    // THE PRE-IDENTITY READ ANSWERS NOBODY, which is ADR-196 clause 1's
    // condition stated as data rather than as a branch in the test.
    resolvesTo: undefined,
    establishes: { identityId: ALICE, userId: USER },
  });
  const established = await databaseAuthBackend(db, clock, KEYED).verifyOtp(VERIFY, FROM);

  expect(established?.response).toEqual({
    identity_id: ALICE,
    user_id: USER,
    is_new: true,
    auth_factor: 'email_otp',
  });

  // THE FOUR DOORS IN THE RULED ORDER, WHICH IS THE RULING ITSELF. Read and
  // consume on the firm door; resolve; establish; mint. A diff that established
  // before consuming, or minted before establishing, changes this list.
  expect(calls.map((c) => `${c.door}:${c.verb}:${c.key}`)).toEqual([
    'firm:rowsWhere:otpChallenges',
    'firm:updateAt:otpChallenges',
    'resolution:rowAt:users',
    'establishment:establish:identities+users',
    'scoped:insertUnder:sessions',
  ]);

  // THE ESTABLISHMENT IS AT THE ADDRESS THE RESOLUTION NAMED, both of them the
  // address AS TYPED. `packages/db` shares one `RESOLUTION_ADDRESS` between the
  // two doors for this reason and this asserts the handler does not spell it
  // twice: `users.email` is UNIQUE and `users.email_normalized` deliberately is
  // not, so establishing at the normalized form would create a second person.
  expect(calls[2]?.address).toEqual({ email: TYPED });
  expect(calls[3]?.address).toEqual({ email: TYPED });
});

test('the mint carries the resolved identity, the whole-token digest and SD-M4-03s pair', async () => {
  const { db, calls } = recordingDb({
    rowsWhere: [challengeRow()],
    resolvesTo: USER_ROW,
  });
  const established = await databaseAuthBackend(db, clock, KEYED).verifyOtp(VERIFY, FROM);
  const token = established?.sessionToken ?? '';

  // THE IDENTITY THE SCOPED DOOR WAS OPENED WITH IS THE ONE THE ADDRESS
  // RESOLVED TO, never one off the request. There is no request-supplied
  // identity on this route at all, which is what makes the property worth
  // pinning here: the day one arrives, this case is what notices.
  const mint = calls.find((c) => c.verb === 'insertUnder');
  expect(mint?.identityId).toBe(ALICE);
  expect(parseSessionToken(token)?.identityId).toBe(ALICE);

  const values = mint?.values as Record<string, unknown>;
  // THE DIGEST IS OVER THE WHOLE TOKEN, which is `sessionByToken`'s first of two
  // independent refusals read from the other end: the minter and the reader have
  // to agree, and nothing but a case can make them.
  expect(values['refreshTokenHash']).toEqual(Buffer.from(sessionTokenHash(token)));
  expect(values['userId']).toBe(USER);
  expect(values['authFactor']).toBe('email_otp');
  expect(values['expiresAt']).toEqual(new Date(NOW.getTime() + SESSION_LIFETIME_MS));
  // SD-M4-03's CREATION HALF, and the older pair left NULL rather than written
  // twice. `AS-M4-05` needs the creation values separate from the last-seen
  // ones, and a minter that wrote `ip` as well would be two copies of one fact.
  expect(values['createdIp']).toBe(FROM.requestIp);
  expect(values['createdUserAgent']).toBe(FROM.userAgent);
  expect(values['ip']).toBeUndefined();
  expect(values['userAgent']).toBeUndefined();
});

test('a code for an address that already resolves answers is_new false and establishes nothing', async () => {
  const { db, calls } = recordingDb({ rowsWhere: [challengeRow()], resolvesTo: USER_ROW });
  const established = await databaseAuthBackend(db, clock, KEYED).verifyOtp(VERIFY, FROM);
  expect(established?.response.is_new).toBe(false);
  expect(established?.response.identity_id).toBe(ALICE);
  // ADR-196 clause 4: true on exactly the call that performed clause 1. A
  // returning trader performs it on no call, and the door that would is not
  // opened at all rather than opened and rolled back.
  expect(calls.some((c) => c.door === 'establishment')).toBe(false);
});

test('the read names every reason a row is not a candidate, and the newest live one wins', async () => {
  const newest = challengeRow({
    id: 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee',
    createdAt: new Date(NOW.getTime() - 60_000),
    codeHash: digestOf(TYPED, '654321'),
  });
  const { db, calls } = recordingDb({
    // THE ACCESSOR IS A RECORDER, so both rows come back whatever the filter
    // said. That is what makes this case worth having: it asserts the handler
    // picks the newest ITSELF rather than trusting an ORDER BY it cannot write.
    rowsWhere: [challengeRow(), newest],
    resolvesTo: USER_ROW,
  });
  const backend = databaseAuthBackend(db, clock, KEYED);

  // The OLDER challenge's code no longer answers, because the newer one is the
  // only candidate. A handler that walked every live row would accept it, and
  // would thereby give an attacker five attempts per outstanding code.
  expect(await backend.verifyOtp(VERIFY, FROM)).toBeNull();
  expect(await backend.verifyOtp({ ...VERIFY, code: '654321' }, FROM)).not.toBeNull();

  const filter = calls[0]?.address as Record<string, unknown>;
  expect(Object.keys(filter).sort()).toEqual([
    'attempts',
    'channel',
    'consumedAt',
    'emailNormalized',
    'expiresAt',
  ]);
  // KEYED ON THE NORMALIZED FORM, because `otp_challenges` is: "Issued before a
  // user may exist, so this keys off the normalized email rather than a user_id"
  // (`0002:306-308`). The DIGEST is bound to the typed form, which is the
  // separation those two columns cannot make between themselves.
  expect(filter['emailNormalized']).toBe(normalizedEmail(TYPED));
  expect(filter['emailNormalized']).not.toBe(TYPED);
});

test('a wrong code spends one attempt, consumes nothing and resolves nobody', async () => {
  const { db, calls } = recordingDb({ rowsWhere: [challengeRow({ attempts: 2 })] });
  const backend = databaseAuthBackend(db, clock, KEYED);
  expect(await backend.verifyOtp({ ...VERIFY, code: '000000' }, FROM)).toBeNull();

  const written = calls.filter((c) => c.verb === 'updateAt');
  expect(written).toHaveLength(1);
  expect(written[0]?.address).toEqual({ id: CHALLENGE });
  expect(written[0]?.values).toEqual({ attempts: 3 });
  // NOTHING PAST THE FIRM DOOR. A wrong code must not reach the pre-identity
  // read, because a handler that resolved first and matched second would take a
  // measurably different amount of work for an address that exists.
  expect(calls.some((c) => c.door === 'resolution' || c.door === 'establishment')).toBe(false);
});

test('the increment cannot reach 0002s CHECK ceiling, because an exhausted row is not a candidate', async () => {
  // THE LAST ATTEMPT IS SPENT AND THE COUNTER LANDS EXACTLY ON THE CEILING.
  const spending = recordingDb({ rowsWhere: [challengeRow({ attempts: OTP_MAX_ATTEMPTS - 1 })] });
  expect(
    await databaseAuthBackend(spending.db, clock, KEYED).verifyOtp(
      { ...VERIFY, code: '000000' },
      FROM,
    ),
  ).toBeNull();
  expect(spending.calls.find((c) => c.verb === 'updateAt')?.values).toEqual({
    attempts: OTP_MAX_ATTEMPTS,
  });

  // AND THE SIXTH ATTEMPT FINDS NO CANDIDATE AT ALL, so nothing is written and
  // `attempts BETWEEN 0 AND 5` is never the thing that answers a person. A
  // handler that let the CHECK refuse would turn a lockout into a 500.
  const locked = recordingDb({ rowsWhere: [challengeRow({ attempts: OTP_MAX_ATTEMPTS })] });
  const backend = databaseAuthBackend(locked.db, clock, KEYED);
  expect(await backend.verifyOtp(VERIFY, FROM)).toBeNull();
  expect(locked.calls.filter((c) => c.verb === 'updateAt')).toEqual([]);
  // AND THE CORRECT CODE IS REFUSED TOO. The lockout is on the challenge, so it
  // binds the person who holds the code as much as the person guessing at it.
});

test('an expired challenge is refused at the boundary the SELECT cannot express', async () => {
  // `atLeast` RENDERS `>=`, so a challenge expiring at exactly `now` comes back
  // from a real accessor. The strict boundary is applied in the handler, which
  // is `liveSession`'s own division of labour one section up.
  const { db, calls } = recordingDb({ rowsWhere: [challengeRow({ expiresAt: NOW })] });
  expect(await databaseAuthBackend(db, clock, KEYED).verifyOtp(VERIFY, FROM)).toBeNull();
  expect(calls.filter((c) => c.verb === 'updateAt')).toEqual([]);
});

test('consuming happens BEFORE the identity exists, and it is the ruled ordering', async () => {
  const { db, calls } = recordingDb({ rowsWhere: [challengeRow()], resolvesTo: USER_ROW });
  await databaseAuthBackend(db, clock, KEYED).verifyOtp(VERIFY, FROM);
  const consume = calls.findIndex((c) => c.verb === 'updateAt');
  const resolve = calls.findIndex((c) => c.door === 'resolution');
  const mint = calls.findIndex((c) => c.verb === 'insertUnder');
  expect(consume).toBeLessThan(resolve);
  expect(resolve).toBeLessThan(mint);
  expect(calls[consume]?.values).toEqual({ consumedAt: NOW });
  // ADR-126 priced this ordering: consuming first can leave "a consumed
  // challenge and no session and the person asks for another code", which is
  // paid in an inconvenience. Consuming LAST leaves a code that has already
  // minted a session still answerable, which is paid in a session.
});

test('the loser of an establishment race answers is_new false rather than 500', async () => {
  const { db, calls } = recordingDb({
    rowsWhere: [challengeRow()],
    establishThrows: new IdentityAlreadyEstablished(TYPED),
  });
  // THE FIRST READ ANSWERS NOBODY AND THE SECOND ANSWERS THE WINNER'S ROW,
  // which is the interleaving the race produces: this handler resolved before
  // the other transaction committed and reads again after `users_email_key`
  // arbitrated.
  let seen = 0;
  const racing = {
    ...db,
    resolution: <T>(fn: (rx: never) => Promise<T>): Promise<T> => {
      seen += 1;
      const answer = seen === 1 ? undefined : USER_ROW;
      return fn({
        rowAt: (key: string, at: unknown) => {
          calls.push({ door: 'resolution', verb: 'rowAt', key, address: at });
          return Promise.resolve(answer);
        },
      } as never);
    },
  };

  const established = await databaseAuthBackend(racing, clock, KEYED).verifyOtp(VERIFY, FROM);
  expect(established?.response.is_new).toBe(false);
  expect(established?.response.identity_id).toBe(ALICE);
  // AND THE SESSION IS STILL MINTED. Losing the race is not losing the login:
  // the code was correct and it was this caller's, so a 401 here would refuse
  // the right person for being second by a millisecond.
  expect(calls.some((c) => c.verb === 'insertUnder')).toBe(true);
  expect(seen).toBe(2);
});

test('the establishment doors own error is the only one translated, and the rest are not swallowed', async () => {
  const { db } = recordingDb({
    rowsWhere: [challengeRow()],
    establishThrows: new Error('the connection went away'),
  });
  await expect(databaseAuthBackend(db, clock, KEYED).verifyOtp(VERIFY, FROM)).rejects.toThrow(
    'the connection went away',
  );
});

test('0063 saying the code was already spent is a 401 and never a 500', async () => {
  // WHAT DRIZZLE THROWS, WRAPPED. The driver's error is one level down in
  // `cause`, which is the defect ADR-197 measured on the establishment door: a
  // translator reading only the top level matches nothing and turns a lost race
  // into a 500 on the money path.
  const raised = new Error('failed query', {
    cause: { code: '23514', constraint: 'otp_challenges_consumption_is_write_once' },
  });
  expect(isChallengeAlreadyConsumed(raised)).toBe(true);
  // ANOTHER CHECK ON THE SAME TABLE IS NOT THIS ONE. `check_violation` is what
  // every CHECK in the schema raises, so the SQLSTATE alone would answer "bad
  // code" to a row that violated something else entirely.
  expect(isChallengeAlreadyConsumed(new Error('x', { cause: { code: '23514' } }))).toBe(false);
  expect(isChallengeAlreadyConsumed(null)).toBe(false);

  const { db, calls } = recordingDb({ rowsWhere: [challengeRow()] });
  const guarded = {
    ...db,
    firm: <T>(fn: (tx: never) => Promise<T>): Promise<T> =>
      db.firm((tx) => {
        const handle = tx as unknown as Record<string, unknown>;
        return fn({
          ...handle,
          updateAt: (key: string, at: unknown, values: unknown) => {
            calls.push({ door: 'firm', verb: 'updateAt', key, address: at, values });
            return Promise.reject(raised);
          },
        } as never);
      }),
  };
  expect(await databaseAuthBackend(guarded, clock, KEYED).verifyOtp(VERIFY, FROM)).toBeNull();
  // AND NOTHING PAST IT. A code somebody else spent must not mint a session.
  expect(calls.some((c) => c.door === 'resolution' || c.verb === 'insertUnder')).toBe(false);
});

test('a deployment with no OTP key answers 503 on verify alone, and opens no door', async () => {
  const { db, calls } = recordingDb({ rowsWhere: [challengeRow()] });
  const err: unknown = await databaseAuthBackend(db, clock, {})
    .verifyOtp(VERIFY, FROM)
    .then(
      () => null,
      (e: unknown) => e,
    );
  expect(err).toBeInstanceOf(AuthBackendUnwired);
  expect((err as AuthBackendUnwired).reason).toContain(OTP_MAC_KEY_VAR);
  // THE REFUSAL COMES BEFORE THE DATABASE. A 503 that had already read the
  // challenge would have spent a connection to say "this deployment is not
  // configured", and would have done it on an unauthenticated route.
  expect(calls).toEqual([]);
});

test('the sms channel is refused as a channel and never as a wrong code', async () => {
  const { db, calls } = recordingDb({ rowsWhere: [challengeRow()], resolvesTo: USER_ROW });
  const err: unknown = await databaseAuthBackend(db, clock, KEYED)
    .verifyOtp({ channel: 'sms', phone: '+15550000000', code: CODE }, FROM)
    .then(
      () => null,
      (e: unknown) => e,
    );
  expect(err).toBeInstanceOf(AuthBackendUnwired);
  // ADR-196 clause 5 IS THE REASON AND IT IS DERIVED FROM A `NOT NULL`. An SMS
  // verification for an unknown number has no value to write into
  // `users.email`, and logging IN on it needs a phone resolved through
  // `identity_phones`, which is not an address the resolution vocabulary carries.
  expect((err as AuthBackendUnwired).reason).toContain('identity_phones');
  expect(calls).toEqual([]);
});

test('the minted token is the format the reader parses, and the secret is 32 bytes', () => {
  const token = mintSessionToken(ALICE);
  expect(parseSessionToken(token)?.identityId).toBe(ALICE);
  const secret = token.slice(ALICE.length + SESSION_TOKEN_SEPARATOR.length);
  // `base64url` OF 32 BYTES IS 43 CHARACTERS UNPADDED, and the assertion is on
  // the DECODED length because that is the property that matters: a secret
  // shorter than the digest it is hashed into is the weak link.
  expect(Buffer.from(secret, 'base64url')).toHaveLength(SESSION_SECRET_BYTES);
  // AND TWO MINTS DO NOT COLLIDE, which `refresh_token_hash bytea NOT NULL
  // UNIQUE` would otherwise arbitrate by refusing somebody's login.
  expect(mintSessionToken(ALICE)).not.toBe(token);
});
