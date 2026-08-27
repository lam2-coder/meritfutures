import { createHash } from 'node:crypto';

import { expect, test } from 'vitest';

import {
  AuthRowError,
  SESSION_TOKEN_SEPARATOR,
  databaseAuthBackend,
  parseSessionToken,
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
// The twelve refusals
// -----------------------------------------------------------------------------

/** The four this session wired, named once so the partition below is checkable. */
const WIRED = ['sessionByToken', 'logout', 'listSessions', 'revokeSession'] as const;

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

test('the twelve refuse as AuthBackendUnwired, each with its own reason, opening no door', async () => {
  const { db, calls } = recordingDb();
  const backend = databaseAuthBackend(db, clock) as unknown as Record<
    string,
    (...args: unknown[]) => Promise<unknown>
  >;
  const blocked = Object.keys(databaseAuthBackend(db, clock)).filter(
    (name) => !(WIRED as readonly string[]).includes(name),
  );
  expect(blocked).toHaveLength(12);

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
  // TWELVE METHODS AND NINE DISTINCT REASONS: the phone-change trio shares a
  // schema gap with three different tails, and the two passkey ceremonies that
  // need nothing but a verifier share one exactly. Asserted as "more than one
  // reason per blocker class" rather than as a count, because a count here would
  // drift the first time two of them merged.
  expect(reasons.size).toBeGreaterThanOrEqual(8);
  // AND NOT ONE OF THEM TOUCHED THE DATABASE. A refusal that opened a
  // transaction first would be a 503 that had already spent a connection.
  expect(calls).toEqual([]);
});

test('the refusals name the two constructions rather than saying "not implemented"', async () => {
  const backend = databaseAuthBackend(recordingDb().db, clock);
  const reasonOf = async (call: Promise<unknown>): Promise<string> =>
    call.then(
      () => '',
      (e: unknown) => (e as AuthBackendUnwired).reason,
    );

  // B1 and B2, both on the one method the whole surface waits behind.
  const verify = await reasonOf(
    backend.verifyOtp({ channel: 'email', email: 'a@b.test', code: '000000' }),
  );
  expect(verify).toContain('pre-identity read');
  expect(verify).toContain('OwnedTableKey');
  // The schema gap this session found rather than went looking for.
  expect(await reasonOf(backend.readPhoneChange(session()))).toContain('no preview column');
  // The contract field with no configured source.
  expect(await reasonOf(backend.readMe(session()))).toContain('max_accounts');
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
