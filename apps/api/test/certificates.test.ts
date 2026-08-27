// =============================================================================
// apps/api/test/certificates.test.ts
// =============================================================================
// EVERY RESPONSE ASSERTION GOES THROUGH FASTIFY'S REAL ROUTER by way of
// `inject`, over the modules discovered from disk, so a route that is declared
// and never registered fails here rather than in production. The registration
// figures below are read off `CompositionReport` rather than off a grep, which
// ADR-168's own approval clause records this repository as having had wrong
// twice.
//
// -----------------------------------------------------------------------------
// THE ASSERTION THIS FILE EXISTS FOR IS THE NEGATIVE ONE
// -----------------------------------------------------------------------------
// API_CONTRACT section 6.3 states what a certificate does NOT carry: "no
// identity, no email, no display name, no cumulative total and no lifetime
// figure, so a held code names a result and does not name a person". Every
// positive case in this file passes against an implementation that also ships
// five fields it must not.
//
// So the seeds below are POISONED. Every `certificates` row handed to the route
// carries an identity uuid, an email, a display name, a cumulative total and a
// lifetime figure, half of them as columns and half of them inside the `jsonb`
// claim, and `expectDiscloses Nothing` fails on the SERIALIZED response if any
// of the five reaches the wire by any path. A spread of the stored claim, a
// `SELECT *` projection, or a row type that kept `revoked_reason` each turns
// that case red and turns nothing else red.
//
// -----------------------------------------------------------------------------
// WHAT THIS SUITE PROVES ABOUT THE IMAGE, AND WHAT IT CANNOT
// -----------------------------------------------------------------------------
// The `.png` row's success response is bytes, and section 1's allowlist is a
// projection over named fields. There is no projection inside a PNG, so the
// disclosure control on that row lives in the renderer, which is not in this
// repository. THIS SUITE THEREFORE ASSERTS THE METADATA AND NOT THE PIXELS: the
// status, the content type, the cache lifetime, the problem shape on every
// refusal, and that the body is byte-for-byte what the source handed over so
// the route adds nothing of its own. It does not claim to have checked what is
// drawn, because it cannot, and a case that claimed it would be the defect
// `db-recorder.ts` names: agreeing with its own fake.
//
// The tenancy case is likewise STRUCTURAL, on `wallet.test.ts`' stated terms:
// the list read opens the SCOPED door with the identity the SESSION resolved
// to, names `certificates`, and reaches for no firm door and no `sqlExecutor`.
// Whether the composed predicate reaches one row or many is
// `packages/db/test/keyed-accessor.test.ts`'.
// =============================================================================

import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { BASE_PATH, buildServer, discoverRouteModules } from '../src/index.ts';
import { defineRoutes } from '../src/registry.ts';
import {
  resetAuthBackend,
  SESSION_COOKIE,
  UNWIRED_AUTH_BACKEND,
  useAuthBackend,
  type AuthSession,
} from '../src/routes/auth.ts';
import certificatesModule, {
  assertPng,
  cacheControl,
  CERTIFICATE_IMAGE_PATH,
  CERTIFICATE_KINDS,
  CERTIFICATE_STATES,
  CERTIFICATES_DEFAULT_LIMIT,
  CERTIFICATES_MAX_LIMIT,
  CERTIFICATES_PATH,
  CERTIFICATES_REQUIRED_FACTORS,
  CertificateBackendUnwired,
  CertificateImageError,
  CertificateImageUnwired,
  CertificateRowError,
  databaseCertificateBackend,
  decodeCursor,
  deriveState,
  encodeCursor,
  isAfter,
  narrowClaims,
  newestFirst,
  projectCertificate,
  resetCertificateBackend,
  resetCertificateImageSource,
  REVOCATION_CLASSES,
  toCertificateRow,
  useCertificateBackend,
  useCertificateImageSource,
  VERIFICATION_RESULTS,
  type CertificateLinks,
  type CertificateListResponse,
  type CertificateLookup,
  type CertificateObservation,
  type CertificateRow,
} from '../src/routes/certificates.ts';
import { recordingDb } from './db-recorder.ts';

// -----------------------------------------------------------------------------
// Identities and sessions. Every id is a uuid because `db.ts` refuses anything
// else before the accessor ever sees it
// -----------------------------------------------------------------------------

const IDENTITY_A = '11111111-1111-4111-8111-111111111111';
const CERT_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CERT_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CERT_3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ACCOUNT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const TOKEN_A = 'token-a';

const SESSION_A: AuthSession = {
  id: 'session-a',
  identityId: IDENTITY_A,
  userId: 'user-a',
  authFactor: 'email_otp',
  elevatedAt: null,
  elevatedByFactor: null,
};

// -----------------------------------------------------------------------------
// THE FIVE THINGS A CERTIFICATE MUST NEVER NAME, seeded so that a careless
// implementation ships them
// -----------------------------------------------------------------------------

const POISON = {
  identity: IDENTITY_A,
  email: 'trader@example.invalid',
  displayName: 'Ada Lovelace',
  cumulativeTotalCents: 918_273_645,
  lifetimeCents: 564_738_291,
  internalReason: 'internal: detector D-07 fired on the account, see flag 4412',
} as const;

/** Every poisoned value, as it would appear in a serialized body. */
const FORBIDDEN: readonly string[] = [
  POISON.identity,
  POISON.email,
  POISON.displayName,
  String(POISON.cumulativeTotalCents),
  String(POISON.lifetimeCents),
  POISON.internalReason,
  ACCOUNT,
];

/**
 * Fail if any of the five reaches the wire by any path.
 *
 * IT READS THE SERIALIZED BODY AND NOT THE PARSED ONE, so a value nested at any
 * depth, under any key, added by any later edit, is caught by the same case.
 */
function expectDisclosesNothing(payload: string): void {
  for (const forbidden of FORBIDDEN) expect(payload).not.toContain(forbidden);
}

// -----------------------------------------------------------------------------
// Rows, as the accessor hands them over: camelCase, `Date` instants, `jsonb`
// claims. EVERY ONE CARRIES THE POISON
// -----------------------------------------------------------------------------

type Row = Record<string, unknown>;

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
    ...over,
  };
}

function certRow(over: Row = {}): Row {
  return {
    id: CERT_1,
    // Real columns of `certificates` that section 6.3's schema does not carry.
    identityId: POISON.identity,
    accountId: ACCOUNT,
    payoutRequestId: null,
    signature: Uint8Array.of(1, 2, 3),
    signingKeyId: 'key-2026-08',
    claimsSchemaVersion: 1,
    kind: 'pass',
    claims: claims(),
    code: 'CODE-AAAA',
    issuedAt: new Date('2026-08-24T12:00:00.000Z'),
    revokedAt: null,
    revokedReason: null,
    revocationClass: null,
    deferredUntil: null,
    deferredReason: null,
    createdAt: new Date('2026-08-24T12:00:00.000Z'),
    ...over,
  };
}

/** An issued pass, a deferred pass, and a revoked payout. */
function threeStates(): Row[] {
  return [
    certRow({ id: CERT_1, code: 'CODE-AAAA', issuedAt: new Date('2026-08-24T12:00:00.000Z') }),
    certRow({
      id: CERT_2,
      code: 'CODE-BBBB',
      issuedAt: new Date('2026-08-25T12:00:00.000Z'),
      deferredUntil: new Date('2026-09-01T00:00:00.000Z'),
      deferredReason: 'An open review is running on this account.',
    }),
    certRow({
      id: CERT_3,
      kind: 'payout',
      payoutRequestId: ACCOUNT,
      claims: claims({ amount_cents: 250_000 }),
      code: 'CODE-CCCC',
      issuedAt: new Date('2026-08-26T12:00:00.000Z'),
      revokedAt: new Date('2026-08-27T09:00:00.000Z'),
      revocationClass: 'account_enforced',
      // INTERNAL free text. `certificates_revocation_is_complete` writes it in
      // the same statement as the class, so a handler holding one holds both.
      revokedReason: POISON.internalReason,
    }),
  ];
}

const LINKS = (code: string): CertificateLinks => ({
  verify_url: `https://merit.example/verify/${code}`,
  image_url: `https://cards.example/${code}/image.png?sig=abc`,
});

// -----------------------------------------------------------------------------
// The harness
// -----------------------------------------------------------------------------

const onDisk = await discoverRouteModules();

async function call(options: {
  path: string;
  token?: string | undefined;
  surface?: 'public' | 'operator';
}): Promise<LightMyRequestResponse> {
  const { app } = buildServer({ surface: options.surface ?? 'public', modules: onDisk });
  const inject: InjectOptions = { method: 'GET', url: `${BASE_PATH}${options.path}` };
  if (options.token !== undefined)
    inject.headers = { cookie: `${SESSION_COOKIE}=${options.token}` };
  const res = await app.inject(inject);
  await app.close();
  return res;
}

/** Install the list backend over a seeded set. Returns the recorder's calls. */
function wireList(rows: Row[]): ReturnType<typeof recordingDb>['calls'] {
  const { db, calls } = recordingDb({ rows });
  useCertificateBackend(databaseCertificateBackend(db, LINKS));
  return calls;
}

/** A minimal PNG: the signature and one byte after it. */
const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x99);

/** Install the image source and record what it was asked. */
function wireImage(options: {
  lookup: (code: string) => CertificateLookup | null;
  recordRejects?: unknown;
}): CertificateObservation[] {
  const observed: CertificateObservation[] = [];
  useCertificateImageSource({
    lookup: (code) => Promise.resolve(options.lookup(code)),
    record: (observation) => {
      observed.push(observation);
      return options.recordRejects === undefined
        ? Promise.resolve()
        : Promise.reject(options.recordRejects);
    },
  });
  return observed;
}

beforeEach(() => {
  useAuthBackend({
    ...UNWIRED_AUTH_BACKEND,
    sessionByToken: (token) => Promise.resolve(token === TOKEN_A ? SESSION_A : null),
  });
});

afterEach(() => {
  resetAuthBackend();
  resetCertificateBackend();
  resetCertificateImageSource();
});

// -----------------------------------------------------------------------------
// What this module declares, and where it is served
// -----------------------------------------------------------------------------

describe('the module declares section 6.3 and nothing else', () => {
  test('two rows, both GET, and the image path carries the `.png`', () => {
    expect(certificatesModule.name).toBe('certificates');
    expect(certificatesModule.routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      `GET ${CERTIFICATES_PATH}`,
      `GET ${CERTIFICATE_IMAGE_PATH}`,
    ]);
    // ADR-168 finding 5. An earlier draft dropped the extension and a path
    // written without it is not the path M11 approved.
    expect(CERTIFICATE_IMAGE_PATH).toBe('/certificates/:code/image.png');
    expect(CERTIFICATE_IMAGE_PATH.endsWith('.png')).toBe(true);
  });

  test('the list requires a session and the image requires nothing', () => {
    expect(CERTIFICATES_REQUIRED_FACTORS).toEqual({
      'GET /certificates': 'session',
      'GET /certificates/:code/image.png': 'none',
    });
  });

  test('the public surface registers both and the operator surface withholds both', () => {
    // ADR-083. The operator 404 is the router's, produced by the route never
    // being registered, and `withheld` being right is what produces it.
    const publicReport = buildServer({ surface: 'public', modules: onDisk }).report;
    const operatorReport = buildServer({ surface: 'operator', modules: onDisk }).report;
    for (const endpoint of [`GET ${CERTIFICATES_PATH}`, `GET ${CERTIFICATE_IMAGE_PATH}`] as const) {
      expect(publicReport.registered).toContain(endpoint);
      expect(publicReport.withheld).not.toContain(endpoint);
      expect(operatorReport.registered).not.toContain(endpoint);
      expect(operatorReport.withheld).toContain(endpoint);
    }
  });

  test('the operator deployment answers 404 for both, with no handler involved', async () => {
    for (const path of ['/certificates', '/certificates/CODE-AAAA/image.png']) {
      const res = await call({ path, surface: 'operator' });
      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.json()).toMatchObject({ code: 'not_found' });
    }
  });

  test('a second module declaring either row is refused by `compose`', () => {
    for (const path of [CERTIFICATES_PATH, CERTIFICATE_IMAGE_PATH]) {
      const wouldHaveBeen = defineRoutes({
        name: 'certificates-duplicate',
        routes: [{ method: 'GET', path, handler: () => ({}) }],
      });
      expect(() => buildServer({ surface: 'public', modules: [...onDisk, wouldHaveBeen] })).toThrow(
        /both declare/,
      );
    }
  });

  test('the closed vocabularies are the columns own CHECKs', () => {
    expect(CERTIFICATE_KINDS).toEqual(['pass', 'payout']);
    // THREE MEMBERS. `withheld` is M11 section 3.1's fourth state and `0020`
    // has no column that holds it (ADR-168 finding 10, ADR-040's own lesson).
    expect(CERTIFICATE_STATES).toEqual(['issued', 'deferred', 'revoked']);
    expect(CERTIFICATE_STATES).not.toContain('withheld');
    expect(REVOCATION_CLASSES).toEqual([
      'fact_untrue',
      'account_enforced',
      'issued_in_error',
      'trader_request',
    ]);
    // `trader_request` is the remedy API_CONTRACT section 6.3 names as part of
    // what makes a public certificate surface acceptable at all.
    expect(REVOCATION_CLASSES).toContain('trader_request');
    expect(VERIFICATION_RESULTS).toEqual(['valid', 'unknown', 'revoked', 'deferred']);
  });
});

// -----------------------------------------------------------------------------
// Fail closed before anything else
// -----------------------------------------------------------------------------

describe('the list is fail closed before it is anything else', () => {
  test('no session is 401 and never 403', async () => {
    const res = await call({ path: CERTIFICATES_PATH });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'unauthenticated' });
  });

  test('an unwired backend is 503 and never an empty list', async () => {
    // An empty list is a trader being told they have no certificates.
    const res = await call({ path: CERTIFICATES_PATH, token: TOKEN_A });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: 'service_unavailable' });
  });

  test('the 503 names which half is missing', () => {
    expect(new CertificateBackendUnwired('readCertificates').message).toMatch(
      /CertificateBackend\.readCertificates is not wired/,
    );
    expect(new CertificateImageUnwired('lookup').message).toMatch(/answers 503 rather than 404/);
  });

  test('an unwired image source is 503 and never 404', async () => {
    // A 404 here would say no certificate carries this code, which is a claim
    // about Merit's book rather than about this deployment.
    const res = await call({ path: '/certificates/CODE-AAAA/image.png' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: 'service_unavailable' });
  });
});

// -----------------------------------------------------------------------------
// THE DISCLOSURE BOUNDARY, ASSERTED IN THE NEGATIVE
// -----------------------------------------------------------------------------

describe('a held certificate names a result and does not name a person', () => {
  test('none of the five reaches the wire, on a body carrying all three states', async () => {
    wireList(threeStates());
    const res = await call({ path: CERTIFICATES_PATH, token: TOKEN_A });
    expect(res.statusCode).toBe(200);
    // The positive case first, so a body that is empty for the wrong reason
    // cannot pass the negative one vacuously.
    const body = res.json<CertificateListResponse>();
    expect(body.data).toHaveLength(3);
    expectDisclosesNothing(res.payload);
  });

  test('the claim carries exactly `INV-M11-01`s four keys and no fifth', async () => {
    wireList(threeStates());
    const res = await call({ path: CERTIFICATES_PATH, token: TOKEN_A });
    const body = res.json<CertificateListResponse>();
    for (const item of body.data) {
      const keys = Object.keys(item.claims).sort();
      expect(
        keys.every((k) => ['plan_code', 'size_cents', 'trading_day', 'amount_cents'].includes(k)),
      ).toBe(true);
      expect(keys).toContain('plan_code');
      expect(keys).toContain('size_cents');
      expect(keys).toContain('trading_day');
    }
    // The kind-specific value, present on the payout card and absent on a pass.
    const payout = body.data.find((i) => i.kind === 'payout');
    const pass = body.data.find((i) => i.kind === 'pass');
    expect(payout?.claims.amount_cents).toBe(250_000);
    expect(pass?.claims.amount_cents).toBeUndefined();
  });

  test('the item carries exactly section 6.3s ten fields', async () => {
    wireList(threeStates());
    const res = await call({ path: CERTIFICATES_PATH, token: TOKEN_A });
    for (const item of res.json<CertificateListResponse>().data)
      expect(Object.keys(item).sort()).toEqual([
        'certificate_id',
        'claims',
        'code',
        'deferred',
        'image_url',
        'issued_at',
        'kind',
        'revoked',
        'state',
        'verify_url',
      ]);
  });

  test('`revoked_reason` is not on the row type, so no projection can reach it', () => {
    // `INV-M11-07`, `AS-M11-05`, ADR-168 foreclosure 3. The class is published
    // and the free text is internal; this asserts the STRUCTURE rather than the
    // one response above, because the structure is what a later edit changes.
    const row = toCertificateRow(
      certRow({
        revokedAt: new Date('2026-08-27T09:00:00.000Z'),
        revocationClass: 'fact_untrue',
        revokedReason: POISON.internalReason,
      }),
    );
    expect(Object.keys(row)).not.toContain('revokedReason');
    expect(JSON.stringify(row)).not.toContain(POISON.internalReason);
    expect(JSON.stringify(projectCertificate(row, LINKS))).not.toContain(POISON.internalReason);
  });

  test('the `jsonb` allowlist drops every key it did not read, by name', () => {
    const narrowed = narrowClaims(
      {
        plan_code: 'MERIT-50K',
        size_cents: 5_000_000,
        trading_day: '2026-08-24',
        email: POISON.email,
        display_name: POISON.displayName,
        cumulative_total_cents: POISON.cumulativeTotalCents,
        lifetime_payout_cents: POISON.lifetimeCents,
        identity_id: POISON.identity,
      },
      'pass',
    );
    expect(Object.keys(narrowed).sort()).toEqual(['plan_code', 'size_cents', 'trading_day']);
    expectDisclosesNothing(JSON.stringify(narrowed));
  });
});

// -----------------------------------------------------------------------------
// The derived state, and the column that does not exist
// -----------------------------------------------------------------------------

describe('the state is derived because `0020` has no status column', () => {
  test('neither column is issued, `deferred_until` is deferred, `revoked_at` is revoked', () => {
    const issued = toCertificateRow(certRow());
    const deferred = toCertificateRow(
      certRow({ deferredUntil: new Date('2026-09-01T00:00:00Z'), deferredReason: 'a review' }),
    );
    const revoked = toCertificateRow(
      certRow({
        revokedAt: new Date('2026-08-27T09:00:00Z'),
        revocationClass: 'trader_request',
        revokedReason: POISON.internalReason,
      }),
    );
    expect(deriveState(issued)).toBe('issued');
    expect(deriveState(deferred)).toBe('deferred');
    expect(deriveState(revoked)).toBe('revoked');
  });

  test('a row carrying BOTH columns is revoked, and still reports its deferral', () => {
    // The overlap is representable: neither `certificates_deferral_is_explained`
    // nor `certificates_revocation_is_complete` forbids it, and the corpus does
    // not rule it. Revocation takes precedence because it is terminal and
    // because the CHECK guarantees it has a class to publish.
    const row = toCertificateRow(
      certRow({
        deferredUntil: new Date('2026-09-01T00:00:00Z'),
        deferredReason: 'a review',
        revokedAt: new Date('2026-08-27T09:00:00Z'),
        revocationClass: 'issued_in_error',
        revokedReason: POISON.internalReason,
      }),
    );
    expect(deriveState(row)).toBe('revoked');
    const item = projectCertificate(row, LINKS);
    expect(item.state).toBe('revoked');
    expect(item.deferred).toEqual({ reason: 'a review', until: '2026-09-01T00:00:00.000Z' });
    expect(item.revoked).toEqual({ at: '2026-08-27T09:00:00.000Z', class: 'issued_in_error' });
  });

  test('a half-written revocation is refused in both directions', () => {
    expect(() =>
      toCertificateRow(certRow({ revokedAt: new Date('2026-08-27T09:00:00Z') })),
    ).toThrow(CertificateRowError);
    expect(() => toCertificateRow(certRow({ revocationClass: 'fact_untrue' }))).toThrow(
      /revocation_is_complete/,
    );
  });

  test('a deferral with no reason is refused', () => {
    expect(() =>
      toCertificateRow(certRow({ deferredUntil: new Date('2026-09-01T00:00:00Z') })),
    ).toThrow(/deferral_is_explained/);
  });

  test('a revocation class outside the four-member CHECK is refused', () => {
    expect(() =>
      toCertificateRow(
        certRow({
          revokedAt: new Date('2026-08-27T09:00:00Z'),
          revocationClass: 'because_we_felt_like_it',
          revokedReason: 'x',
        }),
      ),
    ).toThrow(/fact_untrue \| account_enforced \| issued_in_error \| trader_request/);
  });
});

// -----------------------------------------------------------------------------
// The deferred token, which the column holds and the response withholds
// -----------------------------------------------------------------------------

describe('a deferral is a claim Merit has not made yet', () => {
  test('a deferred item withholds all three tokens against a NOT NULL column', async () => {
    wireList(threeStates());
    const res = await call({ path: CERTIFICATES_PATH, token: TOKEN_A });
    const body = res.json<CertificateListResponse>();
    const deferred = body.data.find((i) => i.state === 'deferred');
    expect(deferred).toBeDefined();
    expect(deferred?.code).toBeNull();
    expect(deferred?.verify_url).toBeNull();
    expect(deferred?.image_url).toBeNull();
    expect(deferred?.deferred).toEqual({
      reason: 'An open review is running on this account.',
      until: '2026-09-01T00:00:00.000Z',
    });
    // The row underneath HAS a code, and it is nowhere in the response.
    expect(res.payload).not.toContain('CODE-BBBB');
  });

  test('the signer is never called for a deferred row', () => {
    // Structural rather than incidental: there is no path through
    // `projectCertificate` on which a deferred row reaches the signer, so a
    // later edit cannot mint a token for an unmade claim by forgetting a check.
    const asked: string[] = [];
    const row = toCertificateRow(
      certRow({ deferredUntil: new Date('2026-09-01T00:00:00Z'), deferredReason: 'a review' }),
    );
    const item = projectCertificate(row, (code) => {
      asked.push(code);
      return LINKS(code);
    });
    expect(asked).toEqual([]);
    expect(item.code).toBeNull();
  });

  test('an issued and a revoked item both carry their token and both links', async () => {
    wireList(threeStates());
    const res = await call({ path: CERTIFICATES_PATH, token: TOKEN_A });
    const body = res.json<CertificateListResponse>();
    for (const item of body.data.filter((i) => i.state !== 'deferred')) {
      expect(item.code).not.toBeNull();
      expect(item.verify_url).toContain(item.code ?? '');
      expect(item.image_url).toContain('.png');
    }
    // A revoked card keeps its token: `INV-M11-08` makes the re-render the only
    // path by which the revocation reaches an image already in circulation, and
    // the code is what addresses that render.
    const revoked = body.data.find((i) => i.state === 'revoked');
    expect(revoked?.code).toBe('CODE-CCCC');
    expect(revoked?.revoked).toEqual({
      at: '2026-08-27T09:00:00.000Z',
      class: 'account_enforced',
    });
  });

  test('a link that is not an absolute URL is refused', () => {
    const row = toCertificateRow(certRow());
    expect(() =>
      projectCertificate(row, () => ({ verify_url: '/verify/x', image_url: 'https://a/b.png' })),
    ).toThrow(/not an absolute URL/);
  });
});

// -----------------------------------------------------------------------------
// The claim, which is minimal by construction
// -----------------------------------------------------------------------------

describe('the claim refuses rather than guesses', () => {
  test('a payout card with no amount is refused, and a pass card with one is too', () => {
    expect(() => narrowClaims(claims(), 'payout')).toThrow(/KIND-SPECIFIC value/);
    expect(() => narrowClaims(claims({ amount_cents: 1 }), 'pass')).toThrow(
      /claim its kind does not make/,
    );
  });

  test('a float, a negative and a string cent figure are each refused', () => {
    for (const bad of [12.5, -1, '5000']) {
      expect(() => narrowClaims(claims({ size_cents: bad }), 'pass')).toThrow(
        /JSON integers, no floats/,
      );
    }
  });

  test('a `trading_day` that is not a `YYYY-MM-DD` day is refused', () => {
    // Section 1: `*_day` is an EXCHANGE TRADING DAY, never a UTC date. A
    // certificate that names the wrong day names a different result.
    for (const bad of ['2026-08-24T00:00:00Z', '2026-19-40', '24/08/2026', '']) {
      expect(() => narrowClaims(claims({ trading_day: bad }), 'pass')).toThrow(/trading_day/);
    }
  });

  test('a claim that is not a JSON object is refused', () => {
    for (const bad of [null, 'x', 42, ['a']])
      expect(() => narrowClaims(bad, 'pass')).toThrow(/jsonb NOT NULL/);
  });
});

// -----------------------------------------------------------------------------
// Paging
// -----------------------------------------------------------------------------

describe('the page is section 1s cursor page', () => {
  test('newest first, by `certificates_identity_idx` own order', async () => {
    wireList(threeStates());
    const res = await call({ path: CERTIFICATES_PATH, token: TOKEN_A });
    expect(res.json<CertificateListResponse>().data.map((i) => i.certificate_id)).toEqual([
      CERT_3,
      CERT_2,
      CERT_1,
    ]);
  });

  test('a cursor walks the whole set exactly once and ends with a null cursor', async () => {
    wireList(threeStates());
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const suffix: string = cursor === null ? '?limit=2' : `?limit=2&cursor=${cursor}`;
      const res = await call({ path: `${CERTIFICATES_PATH}${suffix}`, token: TOKEN_A });
      expect(res.statusCode).toBe(200);
      const body = res.json<CertificateListResponse>();
      seen.push(...body.data.map((i) => i.certificate_id));
      cursor = body.next_cursor;
      if (cursor === null) break;
    }
    expect(cursor).toBeNull();
    expect(seen).toEqual([CERT_3, CERT_2, CERT_1]);
  });

  test('`next_cursor` is null on a page that is exactly the last one', async () => {
    wireList(threeStates());
    const res = await call({ path: `${CERTIFICATES_PATH}?limit=3`, token: TOKEN_A });
    expect(res.json<CertificateListResponse>().next_cursor).toBeNull();
  });

  test('a malformed cursor is `validation_failed` and never an empty page', async () => {
    // Section 6.3 names exactly this error. An empty page for a cursor the
    // server cannot read is a list that silently ends early.
    wireList(threeStates());
    const res = await call({ path: `${CERTIFICATES_PATH}?cursor=%%%`, token: TOKEN_A });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: 'validation_failed',
      errors: [{ path: 'cursor' }],
    });
  });

  test('a limit outside section 1s range is `validation_failed`', async () => {
    wireList(threeStates());
    for (const bad of ['0', '101', 'many', '-1']) {
      const res = await call({ path: `${CERTIFICATES_PATH}?limit=${bad}`, token: TOKEN_A });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: 'validation_failed' });
    }
    expect(CERTIFICATES_DEFAULT_LIMIT).toBe(25);
    expect(CERTIFICATES_MAX_LIMIT).toBe(100);
  });

  test('the cursor round-trips and refuses anything it did not issue', () => {
    const cursor = { issued_at: '2026-08-24T12:00:00.000Z', certificate_id: CERT_1 };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    for (const bad of ['', 'x', encodeCursor({ issued_at: 'not-a-time', certificate_id: CERT_1 })])
      expect(decodeCursor(bad)).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// Tenancy, structurally
// -----------------------------------------------------------------------------

describe('the list reads through the scoped door and no other', () => {
  test('the scoped door is opened with the session identity and names `certificates`', async () => {
    const calls = wireList(threeStates());
    const res = await call({ path: CERTIFICATES_PATH, token: TOKEN_A });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([
      { door: 'scoped', identityId: IDENTITY_A, verb: 'rows', key: 'certificates' },
    ]);
    // No firm door, no `sqlExecutor`, no second table.
    expect(calls.some((c) => c.door === 'firm')).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// The image, which is the public unauthenticated half
// -----------------------------------------------------------------------------

describe('the image is public and resolves no session', () => {
  test('it serves with a broken auth backend and a session cookie present', async () => {
    // The route runs on the portal's own origin, so a logged-in browser sends
    // `merit_session` with every card fetch. Under an `EndpointSpec` that
    // cookie would be resolved before the declared factor was read, and an
    // unwired auth backend would turn a public card into a 503.
    useAuthBackend({
      ...UNWIRED_AUTH_BACKEND,
      sessionByToken: () => {
        throw new Error('the image endpoint must not resolve a session');
      },
    });
    wireImage({
      lookup: () => ({ result: 'valid', card: { bytes: PNG, cache_max_age_seconds: 300 } }),
    });
    const res = await call({ path: '/certificates/CODE-AAAA/image.png', token: TOKEN_A });
    expect(res.statusCode).toBe(200);
  });

  test('a valid code answers `image/png` bytes, byte for byte', async () => {
    wireImage({
      lookup: () => ({ result: 'valid', card: { bytes: PNG, cache_max_age_seconds: 300 } }),
    });
    const res = await call({ path: '/certificates/CODE-AAAA/image.png' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    // The route adds nothing of its own to the body.
    expect(Uint8Array.from(res.rawPayload)).toEqual(PNG);
  });

  test('the cache lifetime is minutes and a day or more is refused', async () => {
    // `INV-M11-08` and `AS-M11-02`: the lifetime is how long a revoked card
    // keeps rendering as valid.
    expect(cacheControl(300)).toBe('public, max-age=300');
    expect(cacheControl(86_399)).toBe('public, max-age=86399');
    for (const bad of [86_400, 604_800, 0, -1, 1.5])
      expect(() => cacheControl(bad)).toThrow(CertificateImageError);

    wireImage({
      lookup: () => ({ result: 'valid', card: { bytes: PNG, cache_max_age_seconds: 300 } }),
    });
    const res = await call({ path: '/certificates/CODE-AAAA/image.png' });
    expect(res.headers['cache-control']).toBe('public, max-age=300');
  });

  test('bytes that are not a PNG are refused rather than labelled `image/png`', () => {
    expect(assertPng(PNG)).toEqual(PNG);
    expect(() => assertPng(Uint8Array.of(0x47, 0x49, 0x46, 0x38))).toThrow(/PNG signature/);
    expect(() => assertPng(new Uint8Array(0))).toThrow(/shorter than the PNG signature/);
  });

  test('a revoked certificate RENDERS rather than 404s', async () => {
    // `INV-M11-08`: the re-render is the ONLY mechanism by which a revocation
    // reaches an image already in circulation, so a revoked row that stops
    // rendering is the revocation failing to arrive.
    const observed = wireImage({
      lookup: () => ({ result: 'revoked', card: { bytes: PNG, cache_max_age_seconds: 60 } }),
    });
    const res = await call({ path: '/certificates/CODE-CCCC/image.png' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(observed).toEqual([{ code: 'CODE-CCCC', result: 'revoked', ip: expect.any(String) }]);
  });

  test('an unknown code is 404 in `application/problem+json`, and never says "fake"', async () => {
    const observed = wireImage({ lookup: () => null });
    const res = await call({ path: '/certificates/GUESSED/image.png' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ code: 'not_found' });
    expect(res.payload.toLowerCase()).not.toContain('fake');
    expect(observed.map((o) => o.result)).toEqual(['unknown']);
  });

  test('a DEFERRED code is 404 on the wire and `deferred` in the table', async () => {
    // The distinction the fourth CHECK member buys: the anomaly detector can
    // tell a deferral from a guess, and the caller cannot.
    const observed = wireImage({ lookup: () => ({ result: 'deferred', card: null }) });
    const res = await call({ path: '/certificates/CODE-BBBB/image.png' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'not_found' });
    expect(observed.map((o) => o.result)).toEqual(['deferred']);
  });

  test('a source that renders a card for a deferred row is refused', async () => {
    wireImage({
      lookup: () => ({ result: 'deferred', card: { bytes: PNG, cache_max_age_seconds: 60 } }),
    });
    const res = await call({ path: '/certificates/CODE-BBBB/image.png' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ code: 'internal_error' });
  });

  test('a `valid` result with no card is refused rather than 404d', async () => {
    wireImage({ lookup: () => ({ result: 'valid', card: null }) });
    const res = await call({ path: '/certificates/CODE-AAAA/image.png' });
    expect(res.statusCode).toBe(500);
  });
});

describe('every fetch is recorded, and a fetch that cannot be recorded does not happen', () => {
  test('the observation carries the code and the address, and no user agent class', async () => {
    // `0025`: hashed inputs only, and NO approved document fixes the digest or
    // enumerates the user-agent classes. This route names what it observed; the
    // sink hashes, and the class is not invented here.
    const observed = wireImage({
      lookup: () => ({ result: 'valid', card: { bytes: PNG, cache_max_age_seconds: 300 } }),
    });
    await call({ path: '/certificates/CODE-AAAA/image.png' });
    expect(observed).toHaveLength(1);
    expect(Object.keys(observed[0] ?? {}).sort()).toEqual(['code', 'ip', 'result']);
    expect(observed[0]?.code).toBe('CODE-AAAA');
  });

  test('a rejected write fails the fetch rather than serving unmetered bytes', async () => {
    // A public read keyed on `code` is one oracle however it is dressed, and an
    // image served outside that table is the unmetered second door `AS-M11-04`
    // and `FM-M11-04` exist to watch.
    wireImage({
      lookup: () => ({ result: 'valid', card: { bytes: PNG, cache_max_age_seconds: 300 } }),
      recordRejects: new Error('the verifications table is unreachable'),
    });
    const res = await call({ path: '/certificates/CODE-AAAA/image.png' });
    expect(res.statusCode).toBe(500);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.rawPayload.subarray(0, 8)).not.toEqual(Buffer.from(PNG.subarray(0, 8)));
  });

  test('an unknown code is recorded before the 404 is composed', async () => {
    const order: string[] = [];
    useCertificateImageSource({
      lookup: () => {
        order.push('lookup');
        return Promise.resolve(null);
      },
      record: () => {
        order.push('record');
        return Promise.resolve();
      },
    });
    const res = await call({ path: '/certificates/GUESSED/image.png' });
    expect(res.statusCode).toBe(404);
    expect(order).toEqual(['lookup', 'record']);
  });
});

describe('the image response is metadata this suite can check and pixels it cannot', () => {
  test('nothing this route adds to a successful image discloses anything', async () => {
    // The honest half. Section 1's allowlist is a projection over named fields
    // and there is no projection inside a PNG, so what is DRAWN is the
    // renderer's. What is asserted here is every part of the response this file
    // does control: the headers and the body it passed through.
    wireImage({
      lookup: () => ({ result: 'valid', card: { bytes: PNG, cache_max_age_seconds: 300 } }),
    });
    const res = await call({ path: '/certificates/CODE-AAAA/image.png' });
    expectDisclosesNothing(JSON.stringify(res.headers));
    expect(Uint8Array.from(res.rawPayload)).toEqual(PNG);
  });

  test('every refusal on this row is `application/problem+json` and not bytes', async () => {
    for (const wiring of [
      () => wireImage({ lookup: () => null }),
      () => wireImage({ lookup: () => ({ result: 'deferred', card: null }) }),
    ]) {
      wiring();
      const res = await call({ path: '/certificates/ANY/image.png' });
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.headers['content-type']).not.toContain('image/png');
    }
  });
});

// -----------------------------------------------------------------------------
// The rows this file does NOT build
// -----------------------------------------------------------------------------

describe('the slice builds two rows and no third', () => {
  test('nothing here registers `GET /verify/:code`, which the contract defines nowhere', () => {
    // ADR-168 foreclosure 1: a public oracle over Merit's own payout book is
    // its own ruling with its own session, and `AS-M11-04` is the reason it is
    // not taken in passing.
    const report = buildServer({ surface: 'public', modules: onDisk }).report;
    const all = [...report.registered, ...report.withheld];
    expect(all.filter((e) => e.includes('/verify/'))).toEqual([]);
    expect(all.filter((e) => e.includes('/certificates'))).toEqual([
      'GET /certificates',
      'GET /certificates/:code/image.png',
    ]);
  });

  test('the ordering is total at one instant, which is what a cursor needs', () => {
    // Two certificates issued in the same `timestamptz` is ordinary: a pass and
    // a payout card written by one statement share an instant. Without the id
    // tie-break their order is the accessor's, and a cursor into an order that
    // is not total silently drops or repeats a row on every page boundary.
    const a: CertificateRow = toCertificateRow(certRow({ id: CERT_1, code: 'CODE-AAAA' }));
    const b: CertificateRow = toCertificateRow(certRow({ id: CERT_2, code: 'CODE-BBBB' }));
    expect(a.issuedAt).toBe(b.issuedAt);
    expect(newestFirst(a, b)).toBe(1);
    expect(newestFirst(b, a)).toBe(-1);
    expect(newestFirst(a, a)).toBe(0);
    // Strictly after, so the boundary row is not re-read into the next page.
    const at = { issued_at: b.issuedAt, certificate_id: b.id };
    expect(isAfter(a, at)).toBe(true);
    expect(isAfter(b, at)).toBe(false);
  });
});
