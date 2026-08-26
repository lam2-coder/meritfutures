import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { BASE_PATH, buildServer, discoverRouteModules } from '../src/index.ts';
import {
  AUTH_ENDPOINTS,
  AUTH_REQUIRED_FACTORS,
  ELEVATION_FACTORS,
  REQUIRED_FACTORS,
  SESSION_COOKIE,
  authorize,
  resetAuthBackend,
  useAuthBackend,
} from '../src/routes/auth.ts';
import type {
  AuthBackend,
  AuthSession,
  ElevateRequest,
  ElevateResponse,
  Established,
  Me,
  OtpOutcome,
  OtpRequest,
  PhoneChange,
  RequiredFactor,
  SessionRow,
  VerifyResponse,
} from '../src/routes/auth.ts';
import { ME_ENDPOINTS, ME_REQUIRED_FACTORS } from '../src/routes/me.ts';

// CI-02, the `unit` project.
//
// WHAT THIS SUITE IS FOR, IN THE CONTRACT'S OWN WORDS. API_CONTRACT section 12
// is headed "Negative-authz test matrix (D5, required in CI)" and its first
// sentence is "Every row is a named test that must exist BEFORE the endpoint
// ships". Six of its rows are this module's, and every one of them is asserted
// in BOTH directions, because "a boundary tested only where it refuses is
// indistinguishable from a boundary that refuses everything".
//
// EVERY ASSERTION GOES THROUGH FASTIFY'S REAL ROUTER by way of `inject`, on
// `server.test.ts`'s standard: the modules come from `discoverRouteModules`, so
// what is exercised is what the deployment composes rather than a hand-built
// list that could omit the file under test.

// -----------------------------------------------------------------------------
// The fixture backend
// -----------------------------------------------------------------------------

/**
 * The seeded `otp_send_budget` row. API_CONTRACT section 11 puts the SMS
 * branch's velocity in this table's `send_limit` and `budget_cents` "so the
 * values are config the way every other plan parameter is".
 *
 * IT IS DATA HERE TOO, AND THE TEST DRIVES THE LIMIT RATHER THAN NAMING IT:
 * the loop below counts to `send_limit` read off this object, so raising the
 * seed changes how many requests the row takes and changes nothing else.
 * `budget_cents` and `spend_cents` are integer cents, per the constitution.
 */
const SEEDED_BUDGET = {
  scope_kind: 'phone',
  scope_key: 'a-phone-hash',
  sends: 0,
  send_limit: 3,
  spend_cents: 0,
  budget_cents: 5_000,
  state: 'armed' as 'armed' | 'degraded',
  expires_in_seconds: 600,
  retry_after_seconds: 1_800,
};

const IDENTITY = 'identity-a';
const OTHER_IDENTITY = 'identity-b';

function session(
  id: string,
  authFactor: AuthSession['authFactor'],
  elevatedBy: AuthSession['elevatedByFactor'] = null,
): AuthSession {
  return {
    id,
    identityId: IDENTITY,
    userId: 'user-a',
    authFactor,
    elevatedAt: elevatedBy === null ? null : '2026-08-26T00:00:00Z',
    elevatedByFactor: elevatedBy,
  };
}

/** A session established by SMS OTP and never elevated. C-27's subject. */
const SMS_SINGLE = session('session-sms', 'sms_otp');
/** A session established by email OTP and never elevated. */
const EMAIL_SINGLE = session('session-email', 'email_otp');
/** Elevated by a passkey assertion. */
const ELEVATED_PASSKEY = session('session-elevated-pk', 'sms_otp', 'passkey');
/** Elevated by a second independent channel. */
const ELEVATED_DUAL = session('session-elevated-dc', 'email_otp', 'dual_channel');

const TOKENS: Readonly<Record<string, AuthSession>> = {
  'tok-sms': SMS_SINGLE,
  'tok-email': EMAIL_SINGLE,
  'tok-elevated-pk': ELEVATED_PASSKEY,
  'tok-elevated-dc': ELEVATED_DUAL,
};

const PHONE_CHANGE: PhoneChange = {
  id: 'change-1',
  state: 'pending',
  new_phone_preview: '+1 ... 4321',
  dual_channel_verified_at: null,
  prior_notified_at: null,
  withdrawal_hold_until: '2026-08-28T00:00:00Z',
  applied_at: null,
  cancelled_at: null,
  cancelled_reason: null,
};

const ME: Me = {
  identity_id: IDENTITY,
  user_id: 'user-a',
  email: 'trader@example.test',
  country_code: 'US',
  kyc: { state: 'verified', placement: 'second_distinct_account_purchase', verified_at: null },
  identity_status: 'active',
  payouts_frozen: false,
  frozen_reason: null,
  restriction: null,
  accounts_count: 1,
  max_accounts: 3,
  affiliate: { is_affiliate: false, code: null },
  phone: { verified: true, preview: '+1 ... 4321', verified_at: '2026-08-01T00:00:00Z' },
  session: { auth_factor: 'sms_otp', elevated: false, elevated_by_factor: null },
};

/** Mutable state one test may steer. Reset between tests. */
interface FixtureState {
  budget: typeof SEEDED_BUDGET;
  revoked: string[];
  loggedOut: string[];
  /** What `readMe` hands back. A test replaces it to prove the allowlist. */
  me: Me;
}

let state: FixtureState;

function freshState(): FixtureState {
  return { budget: { ...SEEDED_BUDGET }, revoked: [], loggedOut: [], me: ME };
}

/**
 * An in-memory backend.
 *
 * IT EXISTS SO THE 200s ARE REAL 200s. Without it every route answers 503 from
 * the fail-closed default, and a suite asserting 403 against that would be
 * asserting nothing: an unwired port refuses in the same direction a boundary
 * does. Section 12's quiet rows are the ones that would silently pass.
 */
const fixture: AuthBackend = {
  sessionByToken: (token) => Promise.resolve(TOKENS[token] ?? null),

  requestOtp: (input: OtpRequest): Promise<OtpOutcome> => {
    if (input.channel === 'email')
      return Promise.resolve({ status: 'sent', expiresInSeconds: state.budget.expires_in_seconds });
    // The velocity check is the ROW's, and the handler never sees a number.
    if (state.budget.sends >= state.budget.send_limit)
      return Promise.resolve({
        status: 'rate_limited',
        retryAfterSeconds: state.budget.retry_after_seconds,
      });
    state.budget.sends += 1;
    // ADR-039's breaker DEGRADES rather than stopping.
    return Promise.resolve({
      status: state.budget.state === 'degraded' ? 'deferred' : 'sent',
      expiresInSeconds: state.budget.expires_in_seconds,
    });
  },

  verifyOtp: (input): Promise<Established<VerifyResponse> | null> =>
    Promise.resolve(
      input.code === 'good'
        ? {
            response: {
              identity_id: IDENTITY,
              user_id: 'user-a',
              is_new: false,
              auth_factor: input.channel === 'sms' ? 'sms_otp' : 'email_otp',
            },
            sessionToken: 'tok-sms',
          }
        : null,
    ),

  elevate: (_session, input: ElevateRequest): Promise<ElevateResponse | null> =>
    Promise.resolve({
      elevated_at: '2026-08-26T12:00:00Z',
      elevated_by_factor: input.factor,
    }),

  passkeyRegisterOptions: () => Promise.resolve({ challenge: 'register-challenge' }),
  passkeyRegisterVerify: () =>
    Promise.resolve({ credential_id: 'cred-1', label: null, created_at: '2026-08-26T00:00:00Z' }),
  passkeyLoginOptions: () => Promise.resolve({ challenge: 'login-challenge' }),
  passkeyLoginVerify: () =>
    Promise.resolve({
      response: { credential_id: 'cred-1', label: null, created_at: '2026-08-26T00:00:00Z' },
      sessionToken: 'tok-email',
    }),

  logout: (s) => {
    state.loggedOut.push(s.id);
    return Promise.resolve();
  },

  verifyPhone: () =>
    Promise.resolve({
      phone_id: 'phone-1',
      preview: '+1 ... 4321',
      verified_at: '2026-08-26T00:00:00Z',
      line_type: 'voip' as const,
    }),

  openPhoneChange: () => Promise.resolve(PHONE_CHANGE),
  readPhoneChange: () => Promise.resolve(PHONE_CHANGE),
  cancelPhoneChange: (_s, changeId) =>
    Promise.resolve(changeId === PHONE_CHANGE.id ? { ...PHONE_CHANGE, state: 'cancelled' } : null),

  listSessions: (current): Promise<readonly SessionRow[]> =>
    Promise.resolve(
      Object.values(TOKENS).map((s) => ({
        id: s.id,
        auth_factor: s.authFactor,
        elevated: s.elevatedAt !== null,
        created_at: '2026-08-20T00:00:00Z',
        last_seen_at: '2026-08-26T00:00:00Z',
        user_agent_family: 'chrome',
        is_current: s.id === current.id,
      })),
    ),

  revokeSession: (_s, sessionId) => {
    // Section 1: a resource the caller does not own is 404, never 403.
    const known = Object.values(TOKENS).some((s) => s.id === sessionId);
    if (!known) return Promise.resolve(null);
    state.revoked.push(sessionId);
    return Promise.resolve('revoked');
  },

  readMe: () => Promise.resolve(state.me),
};

const onDisk = await discoverRouteModules();

async function call(options: {
  method: 'GET' | 'POST';
  path: string;
  token?: string | undefined;
  payload?: object | undefined;
}): Promise<LightMyRequestResponse> {
  const { app } = buildServer({ surface: 'public', modules: onDisk });
  const inject: InjectOptions = { method: options.method, url: `${BASE_PATH}${options.path}` };
  if (options.token !== undefined)
    inject.headers = { cookie: `${SESSION_COOKIE}=${options.token}` };
  if (options.payload !== undefined) inject.payload = options.payload;
  const res = await app.inject(inject);
  await app.close();
  return res;
}

beforeEach(() => {
  state = freshState();
  useAuthBackend(fixture);
});

afterEach(() => {
  resetAuthBackend();
});

// -----------------------------------------------------------------------------
// SECTION 12, ROW A. `/auth/otp` `channel: "sms"` past the per-number velocity
// -----------------------------------------------------------------------------

test('section 12 row A refusal: the sms channel past the per-number velocity is rate_limited', async () => {
  // The limit is READ FROM THE SEEDED ROW. Section 11: the values are config.
  for (let i = 0; i < SEEDED_BUDGET.send_limit; i += 1) {
    const ok = await call({
      method: 'POST',
      path: '/auth/otp',
      payload: { channel: 'sms', phone: '+15555550123', turnstile_token: 't' },
    });
    expect(ok.statusCode).toBe(202);
  }
  const res = await call({
    method: 'POST',
    path: '/auth/otp',
    payload: { channel: 'sms', phone: '+15555550123', turnstile_token: 't' },
  });
  expect(res.statusCode).toBe(429);
  expect(res.json().code).toBe('rate_limited');
  // Section 1: "Exceeding returns 429 with Retry-After".
  expect(res.headers['retry-after']).toBe(String(SEEDED_BUDGET.retry_after_seconds));
});

test('section 12 row A quiet direction: under the velocity the sms channel is 202 and not deferred', async () => {
  const res = await call({
    method: 'POST',
    path: '/auth/otp',
    payload: { channel: 'sms', phone: '+15555550123', turnstile_token: 't' },
  });
  expect(res.statusCode).toBe(202);
  // The strict equality is the "and no `deferred`": a degraded response and a
  // sent one differ by exactly this key.
  expect(res.json()).toStrictEqual({
    sent: true,
    expires_in_seconds: SEEDED_BUDGET.expires_in_seconds,
  });
});

test('a degraded breaker is a 202 carrying deferred, which is the DEGRADED path and not a refusal', async () => {
  state.budget.state = 'degraded';
  const res = await call({
    method: 'POST',
    path: '/auth/otp',
    payload: { channel: 'sms', phone: '+15555550123', turnstile_token: 't' },
  });
  // ADR-039: the breaker degrades rather than stopping, so registration
  // continues and phone verification is deferred to the pre_funded gate. A 4xx
  // here would be the fail-closed reading the ruling refused.
  expect(res.statusCode).toBe(202);
  expect(res.json()).toStrictEqual({
    sent: true,
    expires_in_seconds: SEEDED_BUDGET.expires_in_seconds,
    deferred: true,
  });
});

test('channel takes no default, so a request that omits it is validation_failed', async () => {
  // ADR-039 and SD-M16-05: "a default would let a caller that forgot the field
  // write a well-formed email challenge and leave a CHECK doing a type's job".
  const res = await call({
    method: 'POST',
    path: '/auth/otp',
    payload: { email: 'a@example.test', turnstile_token: 't' },
  });
  expect(res.statusCode).toBe(400);
  expect(res.json().code).toBe('validation_failed');
  expect(res.json().errors[0].path).toBe('channel');
});

test('exactly one destination, and it is the one the channel names', async () => {
  const both = await call({
    method: 'POST',
    path: '/auth/otp',
    payload: {
      channel: 'sms',
      email: 'a@example.test',
      phone: '+15555550123',
      turnstile_token: 't',
    },
  });
  expect(both.statusCode).toBe(400);
  const mismatched = await call({
    method: 'POST',
    path: '/auth/otp',
    payload: { channel: 'sms', email: 'a@example.test', turnstile_token: 't' },
  });
  expect(mismatched.statusCode).toBe(400);
});

// -----------------------------------------------------------------------------
// SECTION 12, ROW B. `POST /auth/elevate` offering an SMS-established factor
// -----------------------------------------------------------------------------

test('section 12 row B refusal: an SMS-established factor offered to elevate is validation_failed', async () => {
  const res = await call({
    method: 'POST',
    path: '/auth/elevate',
    token: 'tok-sms',
    payload: { factor: 'sms_otp', challenge_id: 'c', code: '000000' },
  });
  expect(res.statusCode).toBe(400);
  expect(res.json().code).toBe('validation_failed');
  expect(res.json().errors[0].path).toBe('factor');
});

test('section 12 row B quiet direction: both admitted factors elevate and echo themselves', async () => {
  const passkey = await call({
    method: 'POST',
    path: '/auth/elevate',
    token: 'tok-sms',
    payload: { factor: 'passkey', credential: { id: 'cred-1' } },
  });
  expect(passkey.statusCode).toBe(200);
  expect(passkey.json().elevated_by_factor).toBe('passkey');

  const dual = await call({
    method: 'POST',
    path: '/auth/elevate',
    token: 'tok-sms',
    payload: { factor: 'dual_channel', challenge_id: 'c', code: '000000' },
  });
  expect(dual.statusCode).toBe(200);
  expect(dual.json().elevated_by_factor).toBe('dual_channel');
});

test('elevate never issues a session, so no Set-Cookie leaves it', async () => {
  // "It does not re-establish the session and it never issues a new one."
  const res = await call({
    method: 'POST',
    path: '/auth/elevate',
    token: 'tok-sms',
    payload: { factor: 'passkey', credential: { id: 'cred-1' } },
  });
  expect(res.headers['set-cookie']).toBeUndefined();
});

// -----------------------------------------------------------------------------
// SECTION 12, ROW B, THE HALF THAT IS NOT A TEST
// -----------------------------------------------------------------------------
//
// "There is no such value to send": the factor union admits `passkey` and
// `dual_channel` only, which is "never SMS alone" expressed as a TYPE rather
// than as a check. These four lines assert that in the only way a type can be
// asserted, and `tsc` reports an UNUSED `@ts-expect-error` as an error of its
// own, so the day somebody widens the union `pnpm run typecheck` goes red HERE.
// `apps/api/tsconfig.json` includes `test/**/*.ts`, so this file is inside the
// typechecked set and these lines are a gate rather than a comment.

// @ts-expect-error C-27: `sms_otp` is not an ElevationFactor, so a seeded
// handler accepting an SMS-established factor for elevation fails to COMPILE.
const _smsElevateRequest: ElevateRequest = { factor: 'sms_otp', challenge_id: 'c', code: '0' };

// `sessions.elevated_by_factor` (0029:581) admits two values and the response
// type admits the same two. A handler could not write this. The directive sits
// on the PROPERTY and not on the declaration, because that is the line `tsc`
// reports the error on and a directive one line early is an unused directive.
const _smsElevateResponse: ElevateResponse = {
  elevated_at: '2026-08-26T00:00:00Z',
  // @ts-expect-error C-27: there is no third value to write here.
  elevated_by_factor: 'sms_otp',
};

// @ts-expect-error and the same refusal on the session projection, which is
// what an elevated session is READ from.
const _smsElevatedSession: AuthSession['elevatedByFactor'] = 'sms_otp';

// The other direction, and it carries NO `@ts-expect-error`: both admitted
// values compile, so the refusal above is about `sms_otp` and not about the
// field being unwritable.
const _passkeyElevateRequest: ElevateRequest = { factor: 'passkey', credential: {} };
const _dualElevateRequest: ElevateRequest = {
  factor: 'dual_channel',
  challenge_id: 'c',
  code: '0',
};

test('the elevation vocabulary is exactly the databases CHECK list at 0029:581', () => {
  expect([...ELEVATION_FACTORS]).toStrictEqual(['passkey', 'dual_channel']);
  expect(ELEVATION_FACTORS).toHaveLength(2);
  expect(ELEVATION_FACTORS).not.toContain('sms_otp');
  expect(ELEVATION_FACTORS).not.toContain('email_otp');
});

// -----------------------------------------------------------------------------
// SECTION 12, ROW C. `POST /phone/change` from a non-elevated session
// -----------------------------------------------------------------------------

test('section 12 row C refusal: a contact change from a non-elevated session is 403', async () => {
  const res = await call({
    method: 'POST',
    path: '/phone/change',
    token: 'tok-sms',
    payload: { new_phone: '+15555550199' },
  });
  expect(res.statusCode).toBe(403);
  expect(res.json().code).toBe('forbidden');
  // "and the response names the factor required so the client can offer it".
  expect(res.json().required_factor).toBe('passkey or dual_channel');
});

test('section 12 row C, EITHER KIND: an email-established single factor is refused the same way', async () => {
  // The row reads "Changing an email or phone contact from a non-elevated
  // session ... Either kind", so the refusal is about ELEVATION and not about
  // which factor established the session.
  const res = await call({
    method: 'POST',
    path: '/phone/change',
    token: 'tok-email',
    payload: { new_phone: '+15555550199' },
  });
  expect(res.statusCode).toBe(403);
  expect(res.json().required_factor).toBe('passkey or dual_channel');
});

test('section 12 row C quiet direction: an elevated session opens the ceremony', async () => {
  for (const token of ['tok-elevated-pk', 'tok-elevated-dc']) {
    const res = await call({
      method: 'POST',
      path: '/phone/change',
      token,
      payload: { new_phone: '+15555550199' },
    });
    expect(res.statusCode).toBe(201);
    // The hold is EXPOSED rather than inferred: the portal shows the trader the
    // running hold instead of surprising them with a refusal at the end of it.
    expect(res.json().withdrawal_hold_until).toBe(PHONE_CHANGE.withdrawal_hold_until);
  }
});

// -----------------------------------------------------------------------------
// SECTION 12, ROW D. `POST /sessions/:id/revoke` against another session
// -----------------------------------------------------------------------------

test('section 12 row D refusal: revoking another session from a non-elevated session is 403', async () => {
  const res = await call({
    method: 'POST',
    path: `/sessions/${EMAIL_SINGLE.id}/revoke`,
    token: 'tok-sms',
  });
  expect(res.statusCode).toBe(403);
  expect(res.json().required_factor).toBe('passkey or dual_channel');
  // "Revocation is a credential-surface change and takes the contact-change
  // factor", so the refusal names the action rather than the endpoint.
  expect(res.json().detail).toContain('contact change');
  // The refusal reached no business logic.
  expect(state.revoked).toStrictEqual([]);
});

test('section 12 row D quiet direction: an elevated session revokes and the revoke LANDS', async () => {
  const res = await call({
    method: 'POST',
    path: `/sessions/${EMAIL_SINGLE.id}/revoke`,
    token: 'tok-elevated-pk',
  });
  expect(res.statusCode).toBe(204);
  expect(state.revoked).toStrictEqual([EMAIL_SINGLE.id]);
});

test('an elevated session revoking a session that is not the callers is 404 and never 403', async () => {
  // Section 1: "A path parameter naming a resource the caller does not own
  // returns 404 (not 403) on trader surfaces, so the API does not confirm the
  // existence of other people's resources."
  const res = await call({
    method: 'POST',
    path: `/sessions/${OTHER_IDENTITY}-session/revoke`,
    token: 'tok-elevated-pk',
  });
  expect(res.statusCode).toBe(404);
  expect(state.revoked).toStrictEqual([]);
});

// -----------------------------------------------------------------------------
// SECTION 12, ROWS E AND F. THE QUIET DIRECTION, ASSERTED DELIBERATELY
// -----------------------------------------------------------------------------
//
// "requiring elevation to *look* would lock a compromised account's real owner
// out of the one screen that helps them, and a boundary tested only where it
// refuses is indistinguishable from a boundary that refuses everything."

test('section 12 row E: GET /sessions from a single-factor session is 200', async () => {
  for (const token of ['tok-sms', 'tok-email']) {
    const res = await call({ method: 'GET', path: '/sessions', token });
    expect(res.statusCode).toBe(200);
    // "the establishing factor is shown on every row", which is what makes a
    // SIM-swapped session visible to the person it was taken from.
    const rows = res.json().data as SessionRow[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.auth_factor).toBeDefined();
    expect(rows.filter((r) => r.is_current)).toHaveLength(1);
  }
});

test('section 12 row F: GET /phone/change from a single-factor session is 200', async () => {
  for (const token of ['tok-sms', 'tok-email']) {
    const res = await call({ method: 'GET', path: '/phone/change', token });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(PHONE_CHANGE.id);
  }
});

test('rows E and F refuse an UNAUTHENTICATED caller, which is the other direction', async () => {
  for (const path of ['/sessions', '/phone/change']) {
    const res = await call({ method: 'GET', path });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthenticated');
  }
});

test('the read that showed the destination succeeds while the write is refused, on ONE session', async () => {
  // Section 12's payout row states the shape: "The read that showed the
  // destination succeeded, which is the boundary working". Asserted here on the
  // pair this module owns, from a single session in one test, because two
  // tests using two sessions would not show that it is the SAME caller.
  const read = await call({ method: 'GET', path: '/phone/change', token: 'tok-sms' });
  const write = await call({
    method: 'POST',
    path: '/phone/change',
    token: 'tok-sms',
    payload: { new_phone: '+15555550199' },
  });
  expect(read.statusCode).toBe(200);
  expect(write.statusCode).toBe(403);
});

// -----------------------------------------------------------------------------
// The declaration, which is what CI-06k's argument rests on
// -----------------------------------------------------------------------------

const ALL_ENDPOINTS = [...AUTH_ENDPOINTS, ...ME_ENDPOINTS];

test('every endpoint declares a required factor from section 12s closed vocabulary', () => {
  for (const spec of ALL_ENDPOINTS)
    expect(REQUIRED_FACTORS).toContain<RequiredFactor>(spec.required);
});

test('the declaration table and the registered routes cannot disagree', () => {
  // Both are derived from the same array, so this asserts the derivation rather
  // than two hand-maintained lists agreeing.
  const declared = { ...AUTH_REQUIRED_FACTORS, ...ME_REQUIRED_FACTORS };
  expect(Object.keys(declared)).toHaveLength(ALL_ENDPOINTS.length);
  for (const spec of ALL_ENDPOINTS)
    expect(declared[`${spec.method} ${spec.path}`]).toBe(spec.required);
});

test('no endpoint on this surface declares admin_sso', () => {
  // ADR-083 puts the operator routes in a different process, so a trader-origin
  // module declaring the operator token would be an operator route on the
  // public surface with nothing reporting it.
  for (const spec of ALL_ENDPOINTS) expect(spec.required).not.toBe('admin_sso');
});

test('a C-27 tag and a non-single factor are the same rows, in both directions', () => {
  // Section 12: "the gate's second assertion is that no row tagged `C-27:`
  // declares [`session`]". Asserted here as a biconditional, so a sensitive
  // action that lost its factor AND a single-factor row that gained a tag both
  // fail.
  for (const spec of ALL_ENDPOINTS) {
    const tagged = spec.c27 !== undefined;
    const nonSingle = spec.required === 'passkey or dual_channel';
    expect(tagged).toBe(nonSingle);
  }
  expect(ALL_ENDPOINTS.filter((s) => s.c27 !== undefined)).toHaveLength(2);
});

test('the two sensitive actions are the contact changes C-27 names', () => {
  expect(
    ALL_ENDPOINTS.filter((s) => s.c27 !== undefined).map((s) => `${s.method} ${s.path}`),
  ).toStrictEqual(['POST /phone/change', 'POST /sessions/:id/revoke']);
});

test('authorize refuses a null session with 401 and never 403, on every token but none', () => {
  for (const required of REQUIRED_FACTORS) {
    const decision = authorize(null, required);
    expect(decision.outcome).toBe(required === 'none' ? 'allowed' : 'unauthenticated');
  }
});

test('authorize is total over the vocabulary for an elevated and a single-factor session', () => {
  for (const required of REQUIRED_FACTORS) {
    expect(['allowed', 'forbidden']).toContain(authorize(SMS_SINGLE, required).outcome);
    expect(['allowed', 'forbidden']).toContain(authorize(ELEVATED_PASSKEY, required).outcome);
  }
  // A specific factor is not satisfied by the other one.
  expect(authorize(ELEVATED_PASSKEY, 'dual_channel').outcome).toBe('forbidden');
  expect(authorize(ELEVATED_DUAL, 'passkey').outcome).toBe('forbidden');
  expect(authorize(ELEVATED_PASSKEY, 'passkey').outcome).toBe('allowed');
});

test('a half-written elevation pair does not elevate, which is sessions_elevation_is_complete', () => {
  const halfWritten: AuthSession = { ...SMS_SINGLE, elevatedAt: '2026-08-26T00:00:00Z' };
  expect(authorize(halfWritten, 'passkey or dual_channel').outcome).toBe('forbidden');
});

// -----------------------------------------------------------------------------
// The rest of section 3, and the transport
// -----------------------------------------------------------------------------

test('POST /auth/verify sets the session cookie with section 1s attributes', async () => {
  const res = await call({
    method: 'POST',
    path: '/auth/verify',
    payload: { channel: 'sms', phone: '+15555550123', code: 'good' },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json().auth_factor).toBe('sms_otp');
  const cookie = res.headers['set-cookie'];
  expect(cookie).toContain(`${SESSION_COOKIE}=`);
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('Secure');
  expect(cookie).toContain('SameSite=Lax');
});

test('a bad code is unauthenticated and is deliberately indistinguishable from an expired one', async () => {
  const res = await call({
    method: 'POST',
    path: '/auth/verify',
    payload: { channel: 'sms', phone: '+15555550123', code: 'wrong' },
  });
  expect(res.statusCode).toBe(401);
  expect(res.json().code).toBe('unauthenticated');
  expect(res.headers['set-cookie']).toBeUndefined();
});

test('POST /auth/logout is 204, clears the cookie, and revokes the session it arrived on', async () => {
  const res = await call({ method: 'POST', path: '/auth/logout', token: 'tok-sms' });
  expect(res.statusCode).toBe(204);
  expect(res.headers['set-cookie']).toContain('Max-Age=0');
  expect(state.loggedOut).toStrictEqual([SMS_SINGLE.id]);
});

test('the passkey ceremonies split on the session the contract gives each one', async () => {
  // "register requires a session; login does not."
  expect((await call({ method: 'POST', path: '/auth/passkey/register/options' })).statusCode).toBe(
    401,
  );
  expect(
    (await call({ method: 'POST', path: '/auth/passkey/register/options', token: 'tok-sms' }))
      .statusCode,
  ).toBe(200);
  expect((await call({ method: 'POST', path: '/auth/passkey/login/options' })).statusCode).toBe(
    200,
  );
});

test('passkey login verify establishes the session and register verify does not', async () => {
  const login = await call({
    method: 'POST',
    path: '/auth/passkey/login/verify',
    payload: { credential: { id: 'cred-1' } },
  });
  expect(login.statusCode).toBe(200);
  expect(login.headers['set-cookie']).toContain(`${SESSION_COOKIE}=`);

  const register = await call({
    method: 'POST',
    path: '/auth/passkey/register/verify',
    token: 'tok-sms',
    payload: { credential: { id: 'cred-1' } },
  });
  expect(register.statusCode).toBe(200);
  expect(register.headers['set-cookie']).toBeUndefined();
});

test('POST /phone/verify returns a voip line type rather than refusing it', async () => {
  // ADR-039 (a): VoIP is SCORED, never rejected.
  const res = await call({
    method: 'POST',
    path: '/phone/verify',
    token: 'tok-sms',
    payload: { challenge_id: 'c', code: '000000' },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json().line_type).toBe('voip');
});

test('cancelling a change the caller does not hold is 404', async () => {
  const res = await call({
    method: 'POST',
    path: '/phone/change/not-this-identitys/cancel',
    token: 'tok-sms',
  });
  expect(res.statusCode).toBe(404);
});

test('cancelling is available to a single factor, which the corpus does not state and this file does', async () => {
  // Section 3.1 declares the factor for OPENING a change and for READING one
  // and says nothing about cancelling. `session` is taken on the contract's own
  // argument that requiring elevation to STOP a ceremony would lock the real
  // owner out of the control that helps them. This assertion exists so the
  // choice is visible rather than implicit, and the section 12 row is a DEBT.
  const res = await call({
    method: 'POST',
    path: `/phone/change/${PHONE_CHANGE.id}/cancel`,
    token: 'tok-sms',
  });
  expect(res.statusCode).toBe(200);
  expect(res.json().state).toBe('cancelled');
});

test('an unknown session cookie is unauthenticated rather than an error', async () => {
  const res = await call({ method: 'GET', path: '/sessions', token: 'tok-nobody' });
  expect(res.statusCode).toBe(401);
});

// -----------------------------------------------------------------------------
// GET /me
// -----------------------------------------------------------------------------

test('GET /me is 200 from a single factor and 401 with no session', async () => {
  expect((await call({ method: 'GET', path: '/me' })).statusCode).toBe(401);
  const res = await call({ method: 'GET', path: '/me', token: 'tok-sms' });
  expect(res.statusCode).toBe(200);
  expect(res.json().identity_id).toBe(IDENTITY);
  expect(res.json().session.elevated).toBe(false);
});

test('GET /me is an ALLOWLIST: a column the backend grew does not reach the response', async () => {
  // API_CONTRACT section 1's API3 control: "a field that is not in the schema
  // below is not in the response, so an added column never leaks by default".
  // This is the assertion a pass-through implementation fails and every
  // field-by-field assertion above it passes.
  state.me = {
    ...ME,
    internal_risk_score: 91,
    detector_name: 'velocity',
  } as unknown as Me;
  const res = await call({ method: 'GET', path: '/me', token: 'tok-sms' });
  expect(res.statusCode).toBe(200);
  expect(Object.keys(res.json()).sort()).toStrictEqual(Object.keys(ME).sort());
  expect(res.body).not.toContain('detector_name');
  expect(res.body).not.toContain('internal_risk_score');
});

test('the restriction block is null when there is none and carries its four fields when there is', async () => {
  state.me = {
    ...ME,
    identity_status: 'restricted',
    restriction: {
      reason: 'Account under review under the terms of service.',
      tos_clause: '7.3',
      opened_at: '2026-08-25T00:00:00Z',
      resolves_by: null,
    },
  };
  const res = await call({ method: 'GET', path: '/me', token: 'tok-sms' });
  expect(res.json().restriction).toStrictEqual({
    reason: 'Account under review under the terms of service.',
    tos_clause: '7.3',
    opened_at: '2026-08-25T00:00:00Z',
    resolves_by: null,
  });
});

// -----------------------------------------------------------------------------
// The fail-closed default
// -----------------------------------------------------------------------------

test('with no backend wired every authenticated route answers 503 and none answers 200', async () => {
  // The deployment's state is legible from a response rather than from a
  // fixture that returned plausible values.
  resetAuthBackend();
  for (const spec of ALL_ENDPOINTS) {
    if (spec.path.includes(':')) continue;
    const res = await call({
      method: spec.method as 'GET' | 'POST',
      path: spec.path,
      token: 'tok-sms',
      payload: spec.method === 'POST' ? {} : undefined,
    });
    // Exactly 503, and never 400: the session is resolved BEFORE the body is
    // validated, so an unwired backend refuses every route at the same point.
    expect(res.statusCode).toBe(503);
  }
});

test('the unwired 503 is a service_unavailable problem document in the contracts media type', async () => {
  resetAuthBackend();
  const res = await call({ method: 'GET', path: '/me', token: 'tok-sms' });
  expect(res.statusCode).toBe(503);
  expect(res.headers['content-type']).toContain('application/problem+json');
  expect(res.json().code).toBe('service_unavailable');
  expect(res.json().title).toBe('Service unavailable');
});

// -----------------------------------------------------------------------------
// The module contract ADR-100 enforces
// -----------------------------------------------------------------------------

test('the auth and me modules are discovered from the directory and register on the public surface', async () => {
  const { report } = buildServer({ surface: 'public', modules: onDisk });
  expect(report.modules).toContain('auth');
  expect(report.modules).toContain('me');
  // THE SUBJECT IS THIS MODULE'S ENDPOINTS AND NOT THE WHOLE COMPOSED SET.
  // `report` covers every module on disk, so an assertion like
  // `expect(report.withheld).toStrictEqual([])` would be an assertion about
  // other slices' files: the day one of them declares an operator route, this
  // suite goes red for a reason that has nothing to do with auth. Session 224
  // landed `public-methods` beside this file while this branch was open, which
  // is the warning rather than the failure, because its path is public too.
  for (const spec of ALL_ENDPOINTS) {
    const endpoint = `${spec.method} ${spec.path}`;
    expect(report.registered).toContain(endpoint);
    expect(report.withheld).not.toContain(endpoint);
  }
});

test('every endpoint this session declares is WITHHELD from the operator surface', () => {
  // The other direction, and it is what makes the assertion above mean
  // something: `surfaceServes` is not a no-op on these paths. None of them is
  // under `/admin` or `/internal`, so `api-admin` registers none of them and
  // answers 404 by having nothing there rather than by refusing.
  const { report } = buildServer({ surface: 'operator', modules: onDisk });
  for (const spec of ALL_ENDPOINTS) {
    const endpoint = `${spec.method} ${spec.path}`;
    expect(report.withheld).toContain(endpoint);
    expect(report.registered).not.toContain(endpoint);
  }
});

test('no route in this session carries the base path in its declaration', () => {
  for (const spec of ALL_ENDPOINTS) expect(spec.path.startsWith(BASE_PATH)).toBe(false);
});
