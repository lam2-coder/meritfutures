// =============================================================================
// apps/api/test/verify.test.ts
// =============================================================================
// EVERY RESPONSE ASSERTION GOES THROUGH FASTIFY'S REAL ROUTER by way of
// `inject`, over the modules discovered from disk, so a route that is declared
// and never registered fails here rather than in production. The registration
// figures are read off `CompositionReport` rather than off a grep, which
// ADR-170's own approval clause records this repository as having had wrong
// twice.
//
// -----------------------------------------------------------------------------
// THREE NEGATIVES ARE WHAT THIS FILE EXISTS FOR, AND EVERY POSITIVE CASE PASSES
// AGAINST AN IMPLEMENTATION THAT VIOLATES ALL THREE
// -----------------------------------------------------------------------------
//   1. WHAT A HELD CODE DOES NOT DISCLOSE. ADR-170 section 3 withholds
//      `certificates.id`, `payout_request_id` and `revoked_reason` on top of
//      `INV-M11-01`'s set. So every seeded row carries all of them, plus an
//      identity, an email, a display name, a cumulative total and a lifetime
//      figure, half as columns and half inside the `jsonb` claim, and
//      `expectDisclosesNothing` reads the SERIALIZED body so a value nested at
//      any depth under any key is caught by the same case.
//   2. THAT A DEFERRED CODE IS INDISTINGUISHABLE FROM AN UNKNOWN ONE ON THE
//      WIRE AND DISTINGUISHABLE IN THE LOG. ADR-170 section 3.1. The two
//      responses are compared byte for byte and the two observations are
//      compared for difference, so an implementation that carried `deferred`
//      onto the response fails the first and one that collapsed the log to
//      three values fails the second.
//   3. THAT THE CLOCK DOES NOT ANSWER. `INV-M11-05` names this endpoint and
//      ADR-170 section 4.2 makes the mechanism a floor. The seeded source is
//      DELIBERATELY SLOW FOR VALID CODES AND INSTANT FOR UNKNOWN ONES, which is
//      the timing oracle in its plainest form, and the floor is what has to
//      absorb it.
//
// WHAT THIS SUITE CANNOT PROVE, stated rather than implied. A floor honours
// `INV-M11-05` only if it sits above the deployment's measured p99, and no test
// can know that number: `floor_ms` is config and ADR-170 says the slice that
// ships this endpoint owes the MEASUREMENT rather than the number. What is
// asserted here is that the floor is applied on every path, that an overrun
// does not fail the request, and that a source whose work differs by an order of
// magnitude between a hit and a miss does not move the response time. Whether
// the configured value is the right one is the deployment's.
// =============================================================================

import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, test } from 'vitest';

import { BASE_PATH, buildServer, discoverRouteModules } from '../src/index.ts';
import {
  resetAuthBackend,
  SESSION_COOKIE,
  UNWIRED_AUTH_BACKEND,
  useAuthBackend,
  type AuthSession,
} from '../src/routes/auth.ts';
import {
  REVOCATION_CLASSES,
  VERIFICATION_RESULTS,
  type CertificateObservation,
} from '../src/routes/certificates.ts';
import verifyModule, {
  elapsedMs,
  logResult,
  readPresentation,
  remainingFloorMs,
  renderVerify,
  resetVerifySource,
  responseResult,
  toVerifyRow,
  UNKNOWN_STATEMENT,
  useVerifySource,
  VERIFY_CACHE_CONTROL,
  VERIFY_PATH,
  VERIFY_REQUIRED_FACTORS,
  VERIFY_RESULTS,
  VerifyPresentationError,
  VerifyRowError,
  VerifySourceUnwired,
  type VerifyPresentation,
  type VerifyResponse,
} from '../src/routes/verify.ts';

// -----------------------------------------------------------------------------
// THE EIGHT THINGS THIS SURFACE MUST NEVER NAME, seeded so that a careless
// implementation ships them
// -----------------------------------------------------------------------------

const CERT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const IDENTITY = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PAYOUT_REQUEST = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const POISON = {
  email: 'trader@example.invalid',
  displayName: 'Ada Lovelace',
  cumulativeTotalCents: 918_273_645,
  lifetimeCents: 564_738_291,
  internalReason: 'internal: detector D-07 fired on the account, see flag 4412',
  deferredReason: 'internal: an open severity 4 flag is under review',
} as const;

/**
 * Every withheld value, as it would appear in a serialized body.
 *
 * `CERT_ID` AND `PAYOUT_REQUEST` ARE THE TWO ADR-170 ADDS OVER THE IMAGE ROW's
 * SET, and each is withheld for its own reason: publishing `id` beside `code`
 * defeats the rotation `0020` keeps the two keys distinct for, and
 * `payout_request_id` names a row in the book `AS-M11-04` is about.
 */
const FORBIDDEN: readonly string[] = [
  CERT_ID,
  PAYOUT_REQUEST,
  IDENTITY,
  ACCOUNT,
  POISON.email,
  POISON.displayName,
  String(POISON.cumulativeTotalCents),
  String(POISON.lifetimeCents),
  POISON.internalReason,
  POISON.deferredReason,
];

function expectDisclosesNothing(payload: string): void {
  for (const forbidden of FORBIDDEN) expect(payload).not.toContain(forbidden);
}

// -----------------------------------------------------------------------------
// Rows, as the source hands them over: camelCase, `Date` instants, `jsonb`
// claims, `bytea` signatures. EVERY ONE CARRIES THE POISON
// -----------------------------------------------------------------------------

type Row = Record<string, unknown>;

const SIGNATURE = Uint8Array.of(0xde, 0xad, 0xbe, 0xef, 0xfb, 0xff);

/** base64url of {@link SIGNATURE}, computed independently of the handler. */
const SIGNATURE_B64URL = '3q2-7_v_';

function claims(over: Row = {}): Row {
  return {
    plan_code: 'MERIT-50K',
    size_cents: 5_000_000,
    trading_day: '2026-08-24',
    // Not in `INV-M11-01`'s four. Every one of these must be dropped.
    email: POISON.email,
    display_name: POISON.displayName,
    cumulative_total_cents: POISON.cumulativeTotalCents,
    lifetime_payout_cents: POISON.lifetimeCents,
    identity_id: IDENTITY,
    ...over,
  };
}

function certRow(over: Row = {}): Row {
  return {
    // Real columns of `certificates` that section 6.3's schema does not carry.
    id: CERT_ID,
    identityId: IDENTITY,
    accountId: ACCOUNT,
    payoutRequestId: null,
    revokedReason: null,
    deferredReason: null,
    createdAt: new Date('2026-08-24T12:00:00.000Z'),

    kind: 'pass',
    claims: claims(),
    code: 'CODE-AAAA',
    issuedAt: new Date('2026-08-24T12:00:00.000Z'),
    claimsSchemaVersion: 1,
    signature: SIGNATURE,
    signingKeyId: 'key-2026-08',
    revokedAt: null,
    revocationClass: null,
    deferredUntil: null,
    ...over,
  };
}

function revokedRow(revocationClass: string): Row {
  return certRow({
    kind: 'payout',
    payoutRequestId: PAYOUT_REQUEST,
    claims: claims({ amount_cents: 250_000 }),
    revokedAt: new Date('2026-08-27T09:00:00.000Z'),
    revocationClass,
    // INTERNAL free text. `certificates_revocation_is_complete` writes it in the
    // same statement as the class, so a handler holding one holds both.
    revokedReason: POISON.internalReason,
  });
}

function deferredRow(): Row {
  return certRow({
    deferredUntil: new Date('2026-09-01T00:00:00.000Z'),
    deferredReason: POISON.deferredReason,
  });
}

// -----------------------------------------------------------------------------
// The configured copy and floor
// -----------------------------------------------------------------------------

/**
 * Copy that is obviously a fixture.
 *
 * NO SENTENCE HERE IS A PROPOSAL. `OQ-M11-02` is open on the `account_enforced`
 * wording and ADR-170 leaves the rest to the deployment, so a plausible sentence
 * in this file would be a fixture that reads like an answer.
 */
const STATEMENTS = {
  valid: 'fixture: valid',
  fact_untrue: 'fixture: fact_untrue',
  account_enforced: 'fixture: account_enforced',
  issued_in_error: 'fixture: issued_in_error',
  trader_request: 'fixture: trader_request',
} as const;

const DISCLOSURE = 'fixture: simulated environment disclosure';

/** Short, so the suite is not a stopwatch. The floor case below sets its own. */
const FLOOR_MS = 4;

function presentation(over: Partial<VerifyPresentation> = {}): VerifyPresentation {
  return { statements: { ...STATEMENTS }, disclosure: DISCLOSURE, floor_ms: FLOOR_MS, ...over };
}

// -----------------------------------------------------------------------------
// The harness
// -----------------------------------------------------------------------------

const onDisk = await discoverRouteModules();

const TOKEN = 'session-token';
const SESSION: AuthSession = {
  id: 'session-a',
  identityId: IDENTITY,
  userId: 'user-a',
  authFactor: 'email_otp',
  elevatedAt: null,
  elevatedByFactor: null,
};

interface Wiring {
  /** Rows by code. Anything absent resolves to `null`. */
  readonly rows?: Readonly<Record<string, Row>>;
  readonly presentation?: VerifyPresentation | (() => VerifyPresentation);
  readonly recordRejects?: unknown;
  /** Milliseconds of work the lookup performs before it answers. */
  readonly lookupDelayMs?: (code: string) => number;
}

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

/** Install the source and collect what it was asked to record. */
function wire(options: Wiring = {}): CertificateObservation[] {
  const observed: CertificateObservation[] = [];
  const rows = options.rows ?? {};
  const supplied = options.presentation ?? presentation();
  useVerifySource({
    lookup: async (code) => {
      await sleep(options.lookupDelayMs?.(code) ?? 0);
      const row = rows[code];
      return row === undefined ? null : toVerifyRow(row);
    },
    record: (observation) => {
      observed.push(observation);
      return options.recordRejects === undefined
        ? Promise.resolve()
        : Promise.reject(options.recordRejects);
    },
    presentation: () => (typeof supplied === 'function' ? supplied() : supplied),
  });
  return observed;
}

async function call(options: {
  code: string;
  token?: string | undefined;
  surface?: 'public' | 'operator';
}): Promise<LightMyRequestResponse> {
  const { app } = buildServer({ surface: options.surface ?? 'public', modules: onDisk });
  const inject: InjectOptions = { method: 'GET', url: `${BASE_PATH}/verify/${options.code}` };
  if (options.token !== undefined)
    inject.headers = { cookie: `${SESSION_COOKIE}=${options.token}` };
  const res = await app.inject(inject);
  await app.close();
  return res;
}

afterEach(() => {
  resetVerifySource();
  resetAuthBackend();
});

// -----------------------------------------------------------------------------
// What this module declares, and where it is served
// -----------------------------------------------------------------------------

describe('the module declares section 6.3s verify row and nothing else', () => {
  test('one row, GET, at the contract path', () => {
    expect(verifyModule.name).toBe('verify');
    expect(verifyModule.routes.map((r) => `${r.method} ${r.path}`)).toEqual([`GET ${VERIFY_PATH}`]);
    expect(VERIFY_PATH).toBe('/verify/:code');
  });

  test('it requires nothing, which is section 12s own token', () => {
    expect(VERIFY_REQUIRED_FACTORS).toEqual({ 'GET /verify/:code': 'none' });
  });

  test('the public surface registers it and the operator surface withholds it', () => {
    // ADR-083. The operator 404 is the router's, produced by the route never
    // being registered, and `withheld` being right is what produces it.
    const publicReport = buildServer({ surface: 'public', modules: onDisk }).report;
    const operatorReport = buildServer({ surface: 'operator', modules: onDisk }).report;

    expect(publicReport.registered).toContain(`GET ${VERIFY_PATH}`);
    expect(publicReport.withheld).not.toContain(`GET ${VERIFY_PATH}`);
    expect(operatorReport.withheld).toContain(`GET ${VERIFY_PATH}`);
    expect(operatorReport.registered).not.toContain(`GET ${VERIFY_PATH}`);
  });

  test('the module registered itself, with no list anywhere naming it', () => {
    // `registry.ts`: "THE MODULE LIST IS THE DIRECTORY LISTING AND IS NEVER
    // WRITTEN DOWN." Verified rather than assumed: the modules here are the ones
    // `discoverRouteModules` read off disk, and this one is among them.
    expect(onDisk.map((m) => m.name)).toContain('verify');
  });

  test('the operator surface answers 404 for it, and the 404 is the routers', async () => {
    wire();
    const res = await call({ code: 'CODE-AAAA', surface: 'operator' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ code: 'not_found', status: 404 });
  });
});

// -----------------------------------------------------------------------------
// The three-member union, and the four-member log
// -----------------------------------------------------------------------------

describe('the response union is three and the logs is four', () => {
  test('`deferred` is a log value and is not a response value', () => {
    expect([...VERIFY_RESULTS]).toEqual(['valid', 'revoked', 'unknown']);
    expect([...VERIFICATION_RESULTS]).toEqual(['valid', 'unknown', 'revoked', 'deferred']);
    // ADR-170 foreclosure 1 and section 3.1. This is an ALLOWLIST decision and
    // NOT ADR-040's defect: the table can hold the value and the response
    // declines to carry it, which is the opposite direction.
    expect(VERIFY_RESULTS as readonly string[]).not.toContain('deferred');
    expect(VERIFICATION_RESULTS as readonly string[]).toContain('deferred');
  });

  test('`responseResult` collapses only `deferred`', () => {
    expect(responseResult('valid')).toBe('valid');
    expect(responseResult('revoked')).toBe('revoked');
    expect(responseResult('unknown')).toBe('unknown');
    expect(responseResult('deferred')).toBe('unknown');
  });

  test('`logResult` reads the row, and revocation takes precedence over deferral', () => {
    expect(logResult(null)).toBe('unknown');
    expect(logResult(toVerifyRow(certRow()))).toBe('valid');
    expect(logResult(toVerifyRow(deferredRow()))).toBe('deferred');
    expect(logResult(toVerifyRow(revokedRow('fact_untrue')))).toBe('revoked');

    // The overlap is representable: `certificates_deferral_is_explained` and
    // `certificates_revocation_is_complete` each constrain their own half and
    // neither forbids both being set. `certificates.ts` gave revocation
    // precedence and reported the overlap as unruled; this file does not answer
    // it a second, different way.
    const both = toVerifyRow({
      ...revokedRow('account_enforced'),
      deferredUntil: new Date('2026-09-01T00:00:00.000Z'),
      deferredReason: POISON.deferredReason,
    });
    expect(logResult(both)).toBe('revoked');
  });
});

// -----------------------------------------------------------------------------
// A deferred code, which is the asymmetry
// -----------------------------------------------------------------------------

describe('a deferred code answers unknown and is logged as deferred', () => {
  test('the two responses are byte identical and the two log rows are not', async () => {
    const observedDeferred = wire({ rows: { 'CODE-AAAA': deferredRow() } });
    const deferred = await call({ code: 'CODE-AAAA' });
    resetVerifySource();

    const observedUnknown = wire({ rows: {} });
    const unknown = await call({ code: 'CODE-ZZZZ' });

    // THE WIRE CANNOT TELL THEM APART. Byte for byte, because a difference of
    // one field would be a risk disclosure: `INV-M11-09` defers exactly on an
    // open severity 4+ flag, so a public `deferred` answer tells whoever holds
    // the token that the account behind it is under risk review.
    expect(deferred.statusCode).toBe(200);
    expect(unknown.statusCode).toBe(200);
    expect(deferred.payload).toBe(unknown.payload);

    // THE TABLE CAN. A `deferred` row is a leaked token or a 128-bit guess that
    // hit; an `unknown` row is a typo or `FM-M11-04` in progress. Different
    // incidents, and only the log tells them apart.
    expect(observedDeferred.map((o) => o.result)).toEqual(['deferred']);
    expect(observedUnknown.map((o) => o.result)).toEqual(['unknown']);
  });

  test('the deferral reason never reaches the wire', async () => {
    wire({ rows: { 'CODE-AAAA': deferredRow() } });
    const res = await call({ code: 'CODE-AAAA' });
    expectDisclosesNothing(res.payload);
    expect(res.json()).toEqual({
      result: 'unknown',
      statement: UNKNOWN_STATEMENT,
      certificate: null,
      revoked: null,
    });
  });
});

// -----------------------------------------------------------------------------
// The three results on the wire
// -----------------------------------------------------------------------------

describe('the wire shapes', () => {
  test('an unknown code answers INV-M11-03s exact wording and nothing else', async () => {
    const observed = wire({ rows: {} });
    const res = await call({ code: 'CODE-ZZZZ' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe(VERIFY_CACHE_CONTROL);
    expect(res.json()).toEqual({
      result: 'unknown',
      statement: 'no certificate with this code',
      certificate: null,
      revoked: null,
    });
    // It never says "this is fake". Merit cannot know that a card it did not
    // issue is a forgery rather than a typo.
    expect(res.payload).not.toContain('fake');
    expect(observed).toEqual([{ code: 'CODE-ZZZZ', result: 'unknown', ip: expect.any(String) }]);
  });

  test('a valid code answers the signed claims, the key id and the schema version', async () => {
    wire({ rows: { 'CODE-AAAA': certRow() } });
    const res = await call({ code: 'CODE-AAAA' });

    expect(res.statusCode).toBe(200);
    const body = res.json<VerifyResponse>();
    expect(body).toEqual({
      result: 'valid',
      statement: STATEMENTS.valid,
      certificate: {
        code: 'CODE-AAAA',
        kind: 'pass',
        issued_at: '2026-08-24T12:00:00.000Z',
        claims: { plan_code: 'MERIT-50K', size_cents: 5_000_000, trading_day: '2026-08-24' },
        claims_schema_version: 1,
        signature: SIGNATURE_B64URL,
        signing_key_id: 'key-2026-08',
        disclosure: DISCLOSURE,
      },
      revoked: null,
    });
    expectDisclosesNothing(res.payload);
  });

  test('the signature is base64url and never base64', async () => {
    // `INV-M11-02` makes the offline check a convenience for third parties and
    // this is the only row that serves it, so the encoding is part of the
    // contract rather than an implementation choice. The seeded bytes are chosen
    // so the two encodings differ: base64 would be `3q2+7/v/`.
    wire({ rows: { 'CODE-AAAA': certRow() } });
    const res = await call({ code: 'CODE-AAAA' });
    const body = res.json<VerifyResponse>();
    expect(body.certificate?.signature).toBe('3q2-7_v_');
    expect(body.certificate?.signature).not.toContain('+');
    expect(body.certificate?.signature).not.toContain('/');
  });

  test.each(REVOCATION_CLASSES)('a revoked %s still returns its claims', async (klass) => {
    wire({ rows: { 'CODE-AAAA': revokedRow(klass) } });
    const res = await call({ code: 'CODE-AAAA' });

    const body = res.json<VerifyResponse>();
    expect(body.result).toBe('revoked');
    // `AS-M11-05`: the claim stands. A page that withheld it on revocation would
    // be the retroactive denial that scenario exists to make impossible.
    expect(body.certificate).not.toBeNull();
    expect(body.certificate?.claims).toEqual({
      plan_code: 'MERIT-50K',
      size_cents: 5_000_000,
      amount_cents: 250_000,
      trading_day: '2026-08-24',
    });
    expect(body.revoked).toEqual({ at: '2026-08-27T09:00:00.000Z', class: klass });
    // The class drives the sentence and the sentence is rendered server side.
    expect(body.statement).toBe(STATEMENTS[klass]);
    expectDisclosesNothing(res.payload);
  });

  test('the shape is the same on all three results', () => {
    // ADR-170 section 6.1: one shape on all three results means the response's
    // SHAPE never discloses more than its `result` field already does.
    const shapes = [
      renderVerify(null, presentation()),
      renderVerify(toVerifyRow(certRow()), presentation()),
      renderVerify(toVerifyRow(revokedRow('fact_untrue')), presentation()),
    ].map((body) => Object.keys(body).sort());
    expect(shapes[0]).toEqual(['certificate', 'result', 'revoked', 'statement']);
    expect(shapes[1]).toEqual(shapes[0]);
    expect(shapes[2]).toEqual(shapes[0]);
  });

  test('`certificate` is null exactly when the result is unknown', () => {
    expect(renderVerify(null, presentation()).certificate).toBeNull();
    expect(renderVerify(toVerifyRow(deferredRow()), presentation()).certificate).toBeNull();
    expect(renderVerify(toVerifyRow(certRow()), presentation()).certificate).not.toBeNull();
    expect(
      renderVerify(toVerifyRow(revokedRow('trader_request')), presentation()).certificate,
    ).not.toBeNull();
  });

  test('`revoked` is non-null exactly when the result is revoked', () => {
    expect(renderVerify(null, presentation()).revoked).toBeNull();
    expect(renderVerify(toVerifyRow(certRow()), presentation()).revoked).toBeNull();
    expect(renderVerify(toVerifyRow(deferredRow()), presentation()).revoked).toBeNull();
    expect(
      renderVerify(toVerifyRow(revokedRow('issued_in_error')), presentation()).revoked,
    ).not.toBeNull();
  });
});

// -----------------------------------------------------------------------------
// The claim allowlist over a `jsonb` column
// -----------------------------------------------------------------------------

describe('the claim is an allowlist and not a spread', () => {
  test('a claim carrying five extra keys ships four fields', async () => {
    wire({ rows: { 'CODE-AAAA': certRow({ claims: claims({ amount_cents: undefined }) }) } });
    const res = await call({ code: 'CODE-AAAA' });
    const body = res.json<VerifyResponse>();
    expect(Object.keys(body.certificate?.claims ?? {}).sort()).toEqual([
      'plan_code',
      'size_cents',
      'trading_day',
    ]);
    expectDisclosesNothing(res.payload);
  });

  test('a pass card carrying a money figure is refused rather than published', () => {
    // `narrowClaims`' equivalence against `kind`. A pass card claims a pass, and
    // a money figure on it is a claim its kind does not make.
    expect(() => toVerifyRow(certRow({ claims: claims({ amount_cents: 1 }) }))).toThrow();
  });

  test('a payout card with no amount is refused', () => {
    expect(() =>
      toVerifyRow(certRow({ kind: 'payout', payoutRequestId: PAYOUT_REQUEST })),
    ).toThrow();
  });
});

// -----------------------------------------------------------------------------
// The row type, which is where three columns are withheld structurally
// -----------------------------------------------------------------------------

describe('toVerifyRow', () => {
  test('it carries no `id`, no `payout_request_id` and no `revoked_reason`', () => {
    const row = toVerifyRow(revokedRow('account_enforced'));
    expect(Object.keys(row).sort()).toEqual([
      'claims',
      'claimsSchemaVersion',
      'code',
      'deferredUntil',
      'issuedAt',
      'kind',
      'revocationClass',
      'revokedAt',
      'signature',
      'signingKeyId',
    ]);
  });

  test('a half-written revocation is refused in both directions', () => {
    expect(() => toVerifyRow(certRow({ revokedAt: new Date() }))).toThrow(VerifyRowError);
    expect(() => toVerifyRow(certRow({ revocationClass: 'fact_untrue' }))).toThrow(VerifyRowError);
  });

  test('a revocation class the CHECK does not admit is refused', () => {
    expect(() =>
      toVerifyRow(certRow({ revokedAt: new Date(), revocationClass: 'withheld' })),
    ).toThrow(VerifyRowError);
  });

  test('an empty signature is refused', () => {
    expect(() => toVerifyRow(certRow({ signature: new Uint8Array(0) }))).toThrow(VerifyRowError);
    expect(() => toVerifyRow(certRow({ signature: 'not bytes' }))).toThrow(VerifyRowError);
  });

  test('a claims schema version the CHECK does not admit is refused', () => {
    expect(() => toVerifyRow(certRow({ claimsSchemaVersion: 0 }))).toThrow(VerifyRowError);
    expect(() => toVerifyRow(certRow({ claimsSchemaVersion: 1.5 }))).toThrow(VerifyRowError);
  });

  test('a row that is not a row is refused', () => {
    expect(() => toVerifyRow(null)).toThrow(VerifyRowError);
    expect(() => toVerifyRow([])).toThrow(VerifyRowError);
  });
});

// -----------------------------------------------------------------------------
// No `validation_failed`, which is the control rather than an omission
// -----------------------------------------------------------------------------

describe('a malformed token is unknown and never a validation error', () => {
  const MALFORMED = [
    'x',
    '%20%20',
    '00000000-0000-0000-0000-000000000000',
    "';DROP%20TABLE%20certificates;--",
    'code-aaaa',
    '.',
    'a'.repeat(100),
  ];

  test.each(MALFORMED)('`%s` answers unknown at 200', async (token) => {
    const observed = wire({ rows: { 'CODE-AAAA': certRow() } });
    const res = await call({ code: token });

    expect(res.statusCode).toBe(200);
    expect(res.json<VerifyResponse>().result).toBe('unknown');
    // ADR-170 foreclosure 3. A shape check ahead of the lookup is a faster path
    // AND hands an attacker the token's alphabet and length for free.
    expect(res.payload).not.toContain('validation_failed');
    // Recorded anyway: `code_hash` is the hash of whatever arrived.
    expect(observed).toHaveLength(1);
    expect(observed[0]?.result).toBe('unknown');
  });

  test('a malformed token and a real miss are byte identical', async () => {
    wire({ rows: { 'CODE-AAAA': certRow() } });
    const malformed = await call({ code: '%25%25%25' });
    const miss = await call({ code: 'CODE-ZZZZ' });
    expect(malformed.payload).toBe(miss.payload);
    expect(malformed.statusCode).toBe(miss.statusCode);
  });
});

// -----------------------------------------------------------------------------
// TWO TOKENS THIS HANDLER NEVER SEES, AND THE SECOND IS A REPORTED FINDING
// -----------------------------------------------------------------------------
// These two cases were SEEDED as violations of "a malformed token answers
// `unknown` at the floor" and BOTH FAILED, which is how they were found. Neither
// is repaired here: both are the router's, both are tree wide, and both are
// outside this fence. They are asserted at their real behaviour so the finding
// is a case somebody can read rather than a paragraph in a pull request.

describe('the router answers before this handler does, twice', () => {
  test('a `:code` of `..` is normalized away and answers the routers 404', async () => {
    // `..` and `%2E%2E` are path traversal to the router, so `/verify/..`
    // resolves to `/api/v1` and matches nothing. THE 404 IS CONTRACT SHAPED,
    // because `server.ts`'s not-found handler produces it, and it discloses
    // nothing about the book: no `certificates.code` can be `..`, since a code
    // that is not routable is a code that was never issued to anybody. Named
    // rather than repaired: normalization is the router's and a handler cannot
    // see a segment the router removed.
    wire({ rows: { 'CODE-AAAA': certRow() } });
    for (const token of ['..', '%2E%2E']) {
      const res = await call({ code: token });
      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.json()).toMatchObject({ code: 'not_found' });
    }
  });

  test('A `:code` OVER 100 CHARACTERS IS A 414 IN FASTIFYS OWN SHAPE. REPORTED', async () => {
    // -------------------------------------------------------------------------
    // THIS IS A FINDING AND IT IS PRE-EXISTING AND TREE WIDE. Fastify's
    // `maxParamLength` defaults to 100 and `buildServer` does not set it, so
    // EVERY route in this deployable with a path parameter answers a long one
    // this way: `GET /certificates/:code/image.png` and
    // `GET /accounts/:accountId/purchases` were both measured doing it.
    //
    // IT COSTS THIS ROW TWO THINGS THE CORPUS ASKS FOR.
    //
    //   1. `INV-M11-05`'s NON-ENUMERABILITY HALF. ADR-170 foreclosure 3 refuses
    //      a shape check "because it would hand an attacker the token's alphabet
    //      and length for free". A 414 at 101 characters hands over the length
    //      bound, and it does it BEFORE the floor, so it is also a faster path.
    //   2. THE ERROR MODEL. The body is `application/json` carrying
    //      `{"error":"Bad Request","code":"FST_ERR_MAX_PARAM_LENGTH", ...}` and
    //      THE REQUEST PATH ECHOED BACK. `server.ts`'s header says its two
    //      handlers exist so that exactly this does not happen: 414 is not a key
    //      of its closed `STATUS_CODE` table, and a status it has no canonical
    //      code for is supposed to become a logged `internal_error`.
    //
    // NOT REPAIRED HERE. The fix is a Fastify option in `server.ts` or a ruling
    // on what a long path parameter answers, and both are tree-wide changes on
    // a file this fence does not own. Asserted at the real behaviour so the
    // day it is fixed this case goes red and names the ruling that fixed it.
    wire({ rows: { 'CODE-AAAA': certRow() } });
    const res = await call({ code: 'a'.repeat(101) });

    expect(res.statusCode).toBe(414);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-type']).not.toContain('problem+json');
    expect(res.json()).toMatchObject({ code: 'FST_ERR_MAX_PARAM_LENGTH' });
    // The boundary, so a later change to `maxParamLength` is visible here.
    const inside = await call({ code: 'a'.repeat(100) });
    expect(inside.statusCode).toBe(200);
  });
});

// -----------------------------------------------------------------------------
// The log write, which is inside the floor and which fails the lookup
// -----------------------------------------------------------------------------

describe('every lookup is recorded', () => {
  test('a valid, a revoked, a deferred and an unknown each write one row', async () => {
    const observed = wire({
      rows: {
        'CODE-AAAA': certRow(),
        'CODE-BBBB': revokedRow('fact_untrue'),
        'CODE-CCCC': deferredRow(),
      },
    });
    for (const code of ['CODE-AAAA', 'CODE-BBBB', 'CODE-CCCC', 'CODE-ZZZZ']) await call({ code });

    expect(observed.map((o) => o.result)).toEqual(['valid', 'revoked', 'deferred', 'unknown']);
    // The code goes to the sink IN THE CLEAR and the sink hashes. `0025`
    // requires `code_hash` to be a digest and no approved document fixes the
    // digest, so choosing one here would be this route inventing a constant.
    expect(observed.map((o) => o.code)).toEqual([
      'CODE-AAAA',
      'CODE-BBBB',
      'CODE-CCCC',
      'CODE-ZZZZ',
    ]);
  });

  test('a rejected write fails the lookup rather than serving it unmetered', async () => {
    wire({
      rows: { 'CODE-AAAA': certRow() },
      recordRejects: new VerifySourceUnwired('record'),
    });
    const res = await call({ code: 'CODE-AAAA' });

    expect(res.statusCode).toBe(503);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.headers['cache-control']).toBe(VERIFY_CACHE_CONTROL);
    // The refusal says nothing about the code.
    expect(res.payload).not.toContain('CODE-AAAA');
    expectDisclosesNothing(res.payload);
  });
});

// -----------------------------------------------------------------------------
// The floor
// -----------------------------------------------------------------------------

describe('the constant-time floor', () => {
  test('`remainingFloorMs` is what is left, and never negative', () => {
    expect(remainingFloorMs(0, 50)).toBe(50);
    expect(remainingFloorMs(20, 50)).toBe(30);
    expect(remainingFloorMs(50, 50)).toBe(0);
    expect(remainingFloorMs(9_000, 50)).toBe(0);
  });

  test('`elapsedMs` is whole milliseconds and never negative', () => {
    expect(elapsedMs(0n, 0n)).toBe(0);
    expect(elapsedMs(1_000_000n, 0n)).toBe(0);
    expect(elapsedMs(0n, 1_000_000n)).toBe(1);
    expect(elapsedMs(0n, 1_999_999n)).toBe(1);
    expect(elapsedMs(0n, 250_000_000n)).toBe(250);
  });

  test('THE SEEDED ORACLE: a slow hit and an instant miss answer in the same time', async () => {
    // THIS IS THE TIMING SEED. The source below is the oracle `INV-M11-05`
    // forbids, in its plainest form: a valid code costs 60ms of work and an
    // unknown one costs none. Without a floor the two are trivially separable
    // by a stopwatch; with one they are not.
    const FLOOR = 140;
    wire({
      rows: { 'CODE-AAAA': certRow() },
      presentation: presentation({ floor_ms: FLOOR }),
      lookupDelayMs: (code) => (code === 'CODE-AAAA' ? 60 : 0),
    });

    const timed = async (code: string): Promise<number> => {
      const started = process.hrtime.bigint();
      const res = await call({ code });
      expect(res.statusCode).toBe(200);
      return elapsedMs(started, process.hrtime.bigint());
    };

    const hit = await timed('CODE-AAAA');
    const miss = await timed('CODE-ZZZZ');

    // BOTH ARE HELD TO THE FLOOR. The assertion is on the floor and not on the
    // gap between the two, because a wall-clock comparison of two numbers is a
    // flaky test and the floor is the mechanism ADR-170 section 4.2 rules.
    expect(hit).toBeGreaterThanOrEqual(FLOOR);
    expect(miss).toBeGreaterThanOrEqual(FLOOR);
    // And the 60ms of extra work is inside the floor rather than added to it.
    expect(miss).toBeLessThan(FLOOR * 3);
  });

  test('an overrun answers rather than failing', async () => {
    // At a p99 floor roughly one request in a hundred exceeds it by
    // construction, so a 500 on the tail would be a louder oracle than the one
    // the floor closes.
    wire({
      rows: { 'CODE-AAAA': certRow() },
      presentation: presentation({ floor_ms: 1 }),
      lookupDelayMs: () => 30,
    });
    const res = await call({ code: 'CODE-AAAA' });
    expect(res.statusCode).toBe(200);
    expect(res.json<VerifyResponse>().result).toBe('valid');
  });

  test('the refusal for a rejected write is held to the floor too', async () => {
    const FLOOR = 120;
    wire({
      rows: { 'CODE-AAAA': certRow() },
      presentation: presentation({ floor_ms: FLOOR }),
      recordRejects: new VerifySourceUnwired('record'),
    });
    const started = process.hrtime.bigint();
    const res = await call({ code: 'CODE-AAAA' });
    expect(res.statusCode).toBe(503);
    // Otherwise the refusal is a faster path than an answer, which is the
    // channel the floor exists to close arriving through the error branch.
    expect(elapsedMs(started, process.hrtime.bigint())).toBeGreaterThanOrEqual(FLOOR);
  });
});

// -----------------------------------------------------------------------------
// The copy, and why it is checked before the branch
// -----------------------------------------------------------------------------

describe('readPresentation', () => {
  test('it accepts a complete table', () => {
    expect(readPresentation(presentation())).toEqual({
      statements: { ...STATEMENTS },
      disclosure: DISCLOSURE,
      floor_ms: FLOOR_MS,
    });
  });

  test.each(['valid', ...REVOCATION_CLASSES])('a missing `%s` sentence is refused', (key) => {
    const statements: Record<string, unknown> = { ...STATEMENTS };
    delete statements[key];
    expect(() => readPresentation({ ...presentation(), statements })).toThrow(
      VerifyPresentationError,
    );
  });

  test('a blank sentence is refused as hard as a missing one', () => {
    expect(() =>
      readPresentation({ ...presentation(), statements: { ...STATEMENTS, valid: '   ' } }),
    ).toThrow(VerifyPresentationError);
  });

  test('an absent disclosure is refused, because INV-M11-04 is every certificate', () => {
    expect(() => readPresentation({ ...presentation(), disclosure: '' })).toThrow(
      VerifyPresentationError,
    );
  });

  test.each([0, -1, 1.5, '40', undefined, null])('a floor of `%s` is refused', (floor) => {
    expect(() => readPresentation({ ...presentation(), floor_ms: floor })).toThrow(
      VerifyPresentationError,
    );
  });

  test('nothing bounds the floor above, and that is deliberate', () => {
    // No approved document gives an upper bound, and a bound invented here would
    // be this route choosing a latency budget the corpus has not chosen. The gap
    // is reported rather than filled.
    expect(readPresentation({ ...presentation(), floor_ms: 3_600_000 }).floor_ms).toBe(3_600_000);
  });

  test('a presentation that is not an object is refused', () => {
    expect(() => readPresentation(null)).toThrow(VerifyPresentationError);
    expect(() => readPresentation({ ...presentation(), statements: null })).toThrow(
      VerifyPresentationError,
    );
  });

  test('THE ORACLE THE LAZY READ WOULD BUILD: one missing sentence fails every code', async () => {
    // If the copy were read on the branch that needs it, a deployment missing
    // only the `account_enforced` sentence would answer `unknown` in
    // milliseconds and a valid code in an error. That is a hit-versus-miss
    // oracle assembled out of the configuration error rather than out of the
    // clock, and it is why `readPresentation` runs before the lookup.
    const statements: Record<string, unknown> = { ...STATEMENTS };
    delete statements['account_enforced'];
    wire({
      rows: { 'CODE-AAAA': certRow(), 'CODE-BBBB': revokedRow('account_enforced') },
      presentation: { ...presentation(), statements } as unknown as VerifyPresentation,
    });

    const responses = await Promise.all(
      ['CODE-AAAA', 'CODE-BBBB', 'CODE-ZZZZ', 'nonsense'].map((code) => call({ code })),
    );
    for (const res of responses) {
      expect(res.statusCode).toBe(503);
      expect(res.headers['cache-control']).toBe(VERIFY_CACHE_CONTROL);
    }
    // Byte identical, so the failure discloses nothing about which codes exist.
    expect(
      new Set(responses.map((r) => r.payload.replace(/"instance":"[^"]*"/, ''))),
    ).toHaveProperty('size', 1);
  });
});

// -----------------------------------------------------------------------------
// The unwired deployment
// -----------------------------------------------------------------------------

describe('an unwired source', () => {
  test('answers 503 and never `unknown`', async () => {
    const res = await call({ code: 'CODE-AAAA' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: 'service_unavailable', status: 503 });
    // An `unknown` here would be `INV-M11-03`'s claim that Merit issued no
    // certificate with this code, which is a statement about Merit's book
    // rather than about this deployment.
    expect(res.payload).not.toContain(UNKNOWN_STATEMENT);
  });

  test('all three arms of the default refuse', async () => {
    await expect(
      (async () => {
        const { lookup } = { lookup: () => Promise.reject(new VerifySourceUnwired('lookup')) };
        await lookup();
      })(),
    ).rejects.toBeInstanceOf(VerifySourceUnwired);

    resetVerifySource();
    const res = await call({ code: 'CODE-AAAA' });
    expect(res.statusCode).toBe(503);
  });
});

// -----------------------------------------------------------------------------
// The session, which this row does not read
// -----------------------------------------------------------------------------

describe('the response is byte identical with and without a session', () => {
  test('ADR-170 section 8s interesting assertion for this row', async () => {
    // An endpoint that enriched its answer for the owner would be an oracle
    // that distinguishes its callers. Nothing in this handler reads a header,
    // and the auth backend below is UNWIRED on purpose: a route that resolved a
    // session would turn a public page into a 503 here.
    useAuthBackend({ ...UNWIRED_AUTH_BACKEND });
    wire({ rows: { 'CODE-AAAA': certRow() } });

    const anonymous = await call({ code: 'CODE-AAAA' });
    const withSession = await call({ code: 'CODE-AAAA', token: TOKEN });

    expect(anonymous.statusCode).toBe(200);
    expect(withSession.statusCode).toBe(200);
    expect(withSession.payload).toBe(anonymous.payload);
    expect(withSession.headers['cache-control']).toBe(anonymous.headers['cache-control']);
    expect(SESSION.identityId).toBe(IDENTITY);
  });
});

// -----------------------------------------------------------------------------
// The cache directive
// -----------------------------------------------------------------------------

describe('no-store on every response', () => {
  test('valid, revoked, unknown and the refusal all carry it', async () => {
    wire({ rows: { 'CODE-AAAA': certRow(), 'CODE-BBBB': revokedRow('trader_request') } });
    for (const code of ['CODE-AAAA', 'CODE-BBBB', 'CODE-ZZZZ']) {
      const res = await call({ code });
      expect(res.headers['cache-control']).toBe('no-store');
    }
    resetVerifySource();
    const unwired = await call({ code: 'CODE-AAAA' });
    expect(unwired.headers['cache-control']).toBe('no-store');
  });

  test('it is `no-store` and never a max-age', () => {
    // `FM-M11-05`'s remedy caches RENDERED BYTES and is the image row's; this
    // row renders no bytes and does not inherit it. The stronger reason is
    // `FM-M11-02`: this page is the recovery path for a card that was
    // screenshotted, so a cached `valid` for a code revoked five minutes ago
    // fails at the one surface that was supposed to be authoritative.
    expect(VERIFY_CACHE_CONTROL).toBe('no-store');
    expect(VERIFY_CACHE_CONTROL).not.toContain('max-age');
  });
});
