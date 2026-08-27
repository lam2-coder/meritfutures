// =============================================================================
// apps/api/test/affiliate.test.ts
// =============================================================================
// CI-02, the `unit` project. FOUR ENDPOINTS AND TWO CLAIMS WORTH CHECKING
// MECHANICALLY RATHER THAN READING:
//
//   1. `kind`'s union on the wire is EXACTLY the five members
//      `affiliate_creatives`' CHECK declares, and a sixth is refused. Read from
//      `0005_affiliate_program.sql` and never from the plan, because M08's
//      section 6 row and the migration are two transcriptions and only one of
//      them is what the database will enforce.
//
//   2. `required_disclosure` is a SEPARATE FIELD from any pinned disclosure
//      (ADR-113 clause 2). Asserted in BOTH directions: the field carries text,
//      and the `creative` object carries no key matching `disclosure` at all.
//      One direction alone passes against a response that carries both.
//
// EVERY ASSERTION GOES THROUGH FASTIFY'S REAL ROUTER by way of `inject`, and the
// module set comes from `discoverRouteModules`, so what is exercised is what a
// deployment would serve rather than a list this file assembled.
//
// THE REFUSAL CASES ASSERT THE STATUS CODE AND THAT THE PORT WAS NEVER CALLED,
// because a 403 returned after the write landed looks identical from outside.
// =============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { BASE_PATH, buildServer, discoverRouteModules } from '../src/index.ts';
import {
  AFFILIATE_CREATIVES_PATH,
  AFFILIATE_ENDPOINTS,
  AFFILIATE_LINKS_PATH,
  AFFILIATE_REQUIRED_FACTORS,
  AFFILIATE_STATEMENTS_PATH,
  AFFILIATE_STATS_PATH,
  CREATIVE_KINDS,
  PAGE_LIMIT_DEFAULT,
  PAGE_LIMIT_MAX,
  isSiteRelativePath,
  productionAffiliateDeps,
  resetAffiliateDeps,
  useAffiliateDeps,
  validatePageRequest,
  type AffiliateBackend,
  type AffiliateRef,
  type AffiliateStats,
  type CreativeDraft,
  type CreativeSubmission,
  type CreateLinkRequest,
  type PageRequest,
  type RequiredDisclosure,
  type StatementPage,
} from '../src/routes/affiliate.ts';
import {
  REQUIRED_FACTORS,
  SESSION_COOKIE,
  UNWIRED_AUTH_BACKEND,
  resetAuthBackend,
  useAuthBackend,
  type AuthSession,
  type RequiredFactor,
} from '../src/routes/auth.ts';

const TOKEN = 'session-token-1';

const SESSION: AuthSession = {
  id: 'sess_1',
  identityId: '5f5b1f0e-9d7a-4a35-9a0e-3f2b8c1d4e56',
  userId: 'usr_42',
  authFactor: 'email_otp',
  elevatedAt: null,
  elevatedByFactor: null,
};

const REF: AffiliateRef = {
  affiliateId: 'aff_1',
  code: 'MERIT-LUKE',
  status: 'active',
};

/**
 * The stats fixture. INTEGER CENTS, and one of them NEGATIVE on purpose.
 *
 * `payable_cents` is deliberately NOT `earned - paid` (that would be 610_00),
 * because the route must pass three independent server answers through rather
 * than reconcile them, and a fixture whose numbers happened to reconcile would
 * let an arithmetic bug pass unnoticed.
 */
const STATS: AffiliateStats = {
  code: REF.code,
  commission_bp: 3000,
  status: 'active',
  clicks_30d: 1420,
  conversions_30d: 37,
  earned_cents_lifetime: 1_099_00,
  payable_cents: 214_00,
  paid_cents_lifetime: 489_00,
  chargeback_rate_bp: 145,
};

const DISCLOSURE: RequiredDisclosure = {
  tos_version_id: 'a2c0a8f4-3b6e-4a1f-9e42-77c1f6d8b900',
  version: 'affiliate-terms-v3',
  text: 'Merit Futures pays this promoter a commission. Trading involves risk of loss.',
};

/** What the fake backend was asked to do, so "never called" is a number. */
interface BackendState {
  affiliate: AffiliateRef | null;
  submission: CreativeSubmission;
  page: StatementPage;
  readonly drafts: CreativeDraft[];
  readonly linkRequests: CreateLinkRequest[];
  readonly pageRequests: PageRequest[];
  statsCalls: number;
  disclosureCalls: number;
}

let state: BackendState;

function freshState(): BackendState {
  return {
    affiliate: REF,
    submission: {
      outcome: 'created',
      creative: {
        creative_id: 'c1d6f0aa-2f4b-4d2e-8f0a-1c7b9d3e5a10',
        kind: 'landing',
        url_or_ref: 'https://promoter.example/merit',
        status: 'pending',
        submitted_at: '2026-08-27T12:00:00.000Z',
      },
    },
    page: {
      data: [
        {
          statement_id: '9b2e6a10-5c44-4c9d-bb2f-0a1d3e7f5c88',
          period_start: '2026-07-01',
          period_end: '2026-07-31',
          // SIGNED. A clawback-heavy month is negative, and `0012` says so.
          total_cents: -12_50,
          status: 'issued',
          download_url: 'https://storage.example/statements/9b2e6a10?sig=abc',
        },
      ],
      next_cursor: 'cursor-2',
    },
    drafts: [],
    linkRequests: [],
    pageRequests: [],
    statsCalls: 0,
    disclosureCalls: 0,
  };
}

/**
 * The fake, and it returns MORE than the contract declares on two methods.
 *
 * `stats` and `statements` hand back objects carrying extra keys, so the
 * allowlist assertions test the projection rather than testing that a fixture
 * with no extra fields has no extra fields. `balance_cents` and
 * `paid_transfer_ref` are the two real columns the route must never emit.
 */
const backend: AffiliateBackend = {
  affiliate: () => Promise.resolve(state.affiliate),
  stats: () => {
    state.statsCalls += 1;
    return Promise.resolve({
      ...STATS,
      balance_cents: -900_00,
      negative_balance_since: '2026-06-01',
    } as AffiliateStats);
  },
  statements: (_session, _ref, page) => {
    state.pageRequests.push(page);
    return Promise.resolve({
      data: state.page.data.map((item) => ({ ...item, paid_transfer_ref: 'trn_secret_9' })),
      next_cursor: state.page.next_cursor,
    } as StatementPage);
  },
  issueLink: (_session, _ref, request) => {
    state.linkRequests.push(request);
    return Promise.resolve({
      url: `https://merit.example${request.landing_path}?ref=${REF.code}`,
      click_token: '7d3f2b90-1a44-4c0e-8b21-5e9f0c6a2d13',
    });
  },
  requiredDisclosure: () => {
    state.disclosureCalls += 1;
    return Promise.resolve(DISCLOSURE);
  },
  submitCreative: (_session, _ref, draft) => {
    state.drafts.push(draft);
    return Promise.resolve(state.submission);
  },
};

const onDisk = await discoverRouteModules();

async function call(options: {
  method: 'GET' | 'POST';
  path: string;
  token?: string | undefined;
  body?: unknown;
  headers?: Record<string, string> | undefined;
}): Promise<LightMyRequestResponse> {
  const { app } = buildServer({ surface: 'public', modules: onDisk });
  const inject: InjectOptions = { method: options.method, url: `${BASE_PATH}${options.path}` };
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.token !== undefined) headers['cookie'] = `${SESSION_COOKIE}=${options.token}`;
  if (options.body !== undefined) inject.payload = options.body as object;
  inject.headers = headers;
  const res = await app.inject(inject);
  await app.close();
  return res;
}

/** The four paths, as the module declares them. */
const PATHS = [
  { method: 'POST' as const, path: AFFILIATE_LINKS_PATH },
  { method: 'POST' as const, path: AFFILIATE_CREATIVES_PATH },
  { method: 'GET' as const, path: AFFILIATE_STATS_PATH },
  { method: 'GET' as const, path: AFFILIATE_STATEMENTS_PATH },
];

/** A body that satisfies each POST, so a refusal case is a refusal of authority. */
const GOOD_BODY: Readonly<Record<string, unknown>> = {
  [AFFILIATE_LINKS_PATH]: { landing_path: '/plans' },
  [AFFILIATE_CREATIVES_PATH]: { kind: 'landing', url_or_ref: 'https://promoter.example/merit' },
};

beforeEach(() => {
  state = freshState();
  useAuthBackend({
    ...UNWIRED_AUTH_BACKEND,
    sessionByToken: (token) => Promise.resolve(token === TOKEN ? SESSION : null),
  });
  useAffiliateDeps({ backend });
});

afterEach(() => {
  resetAuthBackend();
  resetAffiliateDeps();
});

// -----------------------------------------------------------------------------
// 1. `kind` against the migration, which is the source and not the plan
// -----------------------------------------------------------------------------

/**
 * The five members, parsed out of the DDL.
 *
 * The parse is deliberately narrow: it finds `kind` inside the
 * `affiliate_creatives` CREATE TABLE and reads the quoted members of its CHECK.
 * A looser regex over the whole file would match `attributions.model`'s CHECK
 * or any other list and would then agree with the wrong one.
 */
function kindMembersFromMigration(): readonly string[] {
  const sql = readFileSync(
    join(import.meta.dirname, '../../../packages/db/migrations/0005_affiliate_program.sql'),
    'utf8',
  );
  const table = /CREATE TABLE affiliate_creatives \(([\s\S]*?)\n\);/.exec(sql);
  expect(table, 'affiliate_creatives is not in 0005').not.toBeNull();
  const check = /kind\s+text NOT NULL CHECK \(kind IN \(([\s\S]*?)\)\)/.exec(
    (table as RegExpExecArray)[1] as string,
  );
  expect(check, "affiliate_creatives.kind's CHECK is not where this test looks").not.toBeNull();
  return [...((check as RegExpExecArray)[1] as string).matchAll(/'([a-z_]+)'/g)].map(
    (m) => m[1] as string,
  );
}

describe("`kind` is exactly the migration's CHECK list", () => {
  test('the union on the wire is the five members the database declares', () => {
    const fromDdl = kindMembersFromMigration();
    // Not a subset and not a superset: the same set, in the same order the DDL
    // writes it, so a member added to one side and not the other fails here.
    expect([...CREATIVE_KINDS]).toStrictEqual(fromDdl);
    expect(fromDdl).toStrictEqual(['landing', 'video', 'post', 'email', 'other']);
    expect(fromDdl).toHaveLength(5);
  });

  test('each of the five is accepted and reaches the port', async () => {
    for (const kind of CREATIVE_KINDS) {
      state = freshState();
      const res = await call({
        method: 'POST',
        path: AFFILIATE_CREATIVES_PATH,
        token: TOKEN,
        body: { kind, url_or_ref: 'https://promoter.example/merit' },
      });
      expect(res.statusCode, kind).toBe(200);
      expect(state.drafts).toHaveLength(1);
      expect((state.drafts[0] as CreativeDraft).kind, kind).toBe(kind);
    }
  });

  test('a SIXTH kind is refused with validation_failed and never reaches the port', async () => {
    // `banner` is the plausible sixth: it is what an affiliate program usually
    // has and it is not in the CHECK, so a route that typed `kind` as `string`
    // would pass it through to a constraint violation three layers down.
    const res = await call({
      method: 'POST',
      path: AFFILIATE_CREATIVES_PATH,
      token: TOKEN,
      body: { kind: 'banner', url_or_ref: 'https://promoter.example/merit' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { code: string; errors: { path: string; message: string }[] };
    expect(body.code).toBe('validation_failed');
    expect(body.errors[0]?.path).toBe('kind');
    expect(body.errors[0]?.message).toContain('landing, video, post, email, other');
    // The refusal happened BEFORE the write, which is what makes it a refusal.
    expect(state.drafts).toHaveLength(0);
  });

  test('a missing kind and a non-string kind are both refused', async () => {
    for (const kind of [undefined, 42, null, ['landing']]) {
      state = freshState();
      const res = await call({
        method: 'POST',
        path: AFFILIATE_CREATIVES_PATH,
        token: TOKEN,
        body: { kind, url_or_ref: 'https://promoter.example/merit' },
      });
      expect(res.statusCode, JSON.stringify(kind)).toBe(400);
      expect(state.drafts).toHaveLength(0);
    }
  });
});

// -----------------------------------------------------------------------------
// 2. ADR-113 clause 2: the disclosure is not pinned, and the fields say so
// -----------------------------------------------------------------------------

describe('`required_disclosure` is a separate field from any pinned disclosure', () => {
  test('the response carries required_disclosure beside a creative that pins nothing', async () => {
    const res = await call({
      method: 'POST',
      path: AFFILIATE_CREATIVES_PATH,
      token: TOKEN,
      body: { kind: 'post', url_or_ref: 'https://promoter.example/thread', notes: 'a thread' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      creative: Record<string, unknown>;
      required_disclosure: Record<string, unknown>;
    };

    // DIRECTION ONE: the disclosure the review will require is present and is
    // the `tos_versions` row, with text an affiliate can attach.
    expect(body.required_disclosure).toStrictEqual({
      tos_version_id: DISCLOSURE.tos_version_id,
      version: DISCLOSURE.version,
      text: DISCLOSURE.text,
    });
    expect(String(body.required_disclosure['text']).length).toBeGreaterThan(0);

    // DIRECTION TWO, WHICH IS THE ONE THAT ACTUALLY CATCHES THE DEFECT. The
    // submitted row carries NO key of any spelling that mentions a disclosure:
    // `affiliate_creatives_approved_has_disclosure` binds the column to
    // APPROVAL and it is null at `pending`, so a field here would be a pin that
    // happens to be empty and a client would render an empty disclosure box.
    const creativeKeys = Object.keys(body.creative);
    expect(creativeKeys.filter((k) => /disclos/i.test(k))).toStrictEqual([]);
    expect(creativeKeys.sort()).toStrictEqual([
      'creative_id',
      'kind',
      'status',
      'submitted_at',
      'url_or_ref',
    ]);

    // And they are TWO TOP-LEVEL FIELDS rather than one nested in the other.
    expect(Object.keys(body).sort()).toStrictEqual(['creative', 'required_disclosure']);
  });

  test('a submission is always `pending`, which is the status the column defaults to', async () => {
    const res = await call({
      method: 'POST',
      path: AFFILIATE_CREATIVES_PATH,
      token: TOKEN,
      body: GOOD_BODY[AFFILIATE_CREATIVES_PATH],
    });
    expect((res.json() as { creative: { status: string } }).creative.status).toBe('pending');
  });

  test('the disclosure is read from its own port method rather than off the row', async () => {
    await call({
      method: 'POST',
      path: AFFILIATE_CREATIVES_PATH,
      token: TOKEN,
      body: GOOD_BODY[AFFILIATE_CREATIVES_PATH],
    });
    // One write, one read, and the read is not a field of the write.
    expect(state.drafts).toHaveLength(1);
    expect(state.disclosureCalls).toBe(1);
    expect(Object.keys(state.drafts[0] as CreativeDraft).sort()).toStrictEqual([
      'idempotencyKey',
      'kind',
      'notes',
      'urlOrRef',
    ]);
  });

  test('a duplicate open submission is section 7s `conflict` and not a second row', async () => {
    state.submission = { outcome: 'duplicate' };
    const res = await call({
      method: 'POST',
      path: AFFILIATE_CREATIVES_PATH,
      token: TOKEN,
      body: GOOD_BODY[AFFILIATE_CREATIVES_PATH],
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('conflict');
    // The disclosure read never happens on the refusal arm: a 409 carrying a
    // disclosure would read as a submission that half succeeded.
    expect(state.disclosureCalls).toBe(0);
  });

  test('the Idempotency-Key header is accepted and carried to the port', async () => {
    await call({
      method: 'POST',
      path: AFFILIATE_CREATIVES_PATH,
      token: TOKEN,
      body: GOOD_BODY[AFFILIATE_CREATIVES_PATH],
      headers: { 'idempotency-key': 'key-abc' },
    });
    expect((state.drafts[0] as CreativeDraft).idempotencyKey).toBe('key-abc');
  });

  test('an absent Idempotency-Key is null and not an invented one', async () => {
    await call({
      method: 'POST',
      path: AFFILIATE_CREATIVES_PATH,
      token: TOKEN,
      body: GOOD_BODY[AFFILIATE_CREATIVES_PATH],
    });
    expect((state.drafts[0] as CreativeDraft).idempotencyKey).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// The declaration, which is API_CONTRACT section 12's column
// -----------------------------------------------------------------------------

describe('the declared factor is `session` on all four, and is stated as data', () => {
  test('the table names the four rows and every one of them declares `session`', () => {
    expect(AFFILIATE_REQUIRED_FACTORS).toEqual({
      [`POST ${AFFILIATE_LINKS_PATH}`]: 'session',
      [`POST ${AFFILIATE_CREATIVES_PATH}`]: 'session',
      [`GET ${AFFILIATE_STATS_PATH}`]: 'session',
      [`GET ${AFFILIATE_STATEMENTS_PATH}`]: 'session',
    });
  });

  test('every declared factor is in section 12s closed vocabulary', () => {
    for (const spec of AFFILIATE_ENDPOINTS)
      expect(REQUIRED_FACTORS).toContain<RequiredFactor>(spec.required);
  });

  test('no row is tagged C-27 and none declares admin_sso', () => {
    // C-27 names payout destination change, contact change and external
    // withdrawal. None of these four is one, and this module serves the public
    // surface, so `admin_sso` here would be an operator route on the trader
    // origin (ADR-083).
    for (const spec of AFFILIATE_ENDPOINTS) {
      expect(spec.c27).toBeUndefined();
      expect(spec.required).not.toBe('admin_sso');
    }
  });

  test('the declaration table and the endpoint array cannot disagree', () => {
    expect(Object.keys(AFFILIATE_REQUIRED_FACTORS)).toHaveLength(AFFILIATE_ENDPOINTS.length);
    for (const spec of AFFILIATE_ENDPOINTS)
      expect(AFFILIATE_REQUIRED_FACTORS[`${spec.method} ${spec.path}`]).toBe(spec.required);
  });

  test('an unauthenticated caller gets 401 on all four, never 403', async () => {
    for (const { method, path } of PATHS) {
      const res = await call({ method, path, body: GOOD_BODY[path] });
      expect(res.statusCode, path).toBe(401);
      expect((res.json() as { code: string }).code).toBe('unauthenticated');
    }
  });

  test('a bad session token is 401 and reaches no port method', async () => {
    for (const { method, path } of PATHS) {
      state = freshState();
      const res = await call({ method, path, token: 'not-a-session', body: GOOD_BODY[path] });
      expect(res.statusCode, path).toBe(401);
      expect(state.drafts).toHaveLength(0);
      expect(state.linkRequests).toHaveLength(0);
      expect(state.statsCalls).toBe(0);
    }
  });
});

// -----------------------------------------------------------------------------
// The 403, which is "not an affiliate" and never a factor problem
// -----------------------------------------------------------------------------

describe('a caller who is not an affiliate is refused on every row', () => {
  test('all four answer 403 forbidden and no port method runs', async () => {
    for (const { method, path } of PATHS) {
      state = freshState();
      state.affiliate = null;
      const res = await call({ method, path, token: TOKEN, body: GOOD_BODY[path] });
      expect(res.statusCode, path).toBe(403);
      const body = res.json() as { code: string; detail: string };
      expect(body.code).toBe('forbidden');
      expect(body.detail).toContain('not an affiliate');
      // The refusal is BEFORE every effect and every read.
      expect(state.drafts).toHaveLength(0);
      expect(state.linkRequests).toHaveLength(0);
      expect(state.pageRequests).toHaveLength(0);
      expect(state.statsCalls).toBe(0);
      expect(state.disclosureCalls).toBe(0);
    }
  });

  test('the 403 carries no required_factor, because no factor would answer it', async () => {
    state.affiliate = null;
    const res = await call({ method: 'GET', path: AFFILIATE_STATS_PATH, token: TOKEN });
    expect(res.json()).not.toHaveProperty('required_factor');
  });

  test('authority is decided before the body is read, so a bad body still gets 403', async () => {
    // The order matters: telling a non-affiliate which field of a request they
    // may not make is malformed is a worse answer than telling them why.
    state.affiliate = null;
    const res = await call({
      method: 'POST',
      path: AFFILIATE_CREATIVES_PATH,
      token: TOKEN,
      body: { kind: 'banner' },
    });
    expect(res.statusCode).toBe(403);
  });
});

// -----------------------------------------------------------------------------
// `GET /affiliate/stats`. Money passes through and nothing is computed.
// -----------------------------------------------------------------------------

describe('stats is the contract shape, allowlisted, with no arithmetic', () => {
  test('every declared field is present and no undeclared field is', async () => {
    const res = await call({ method: 'GET', path: AFFILIATE_STATS_PATH, token: TOKEN });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).toStrictEqual({ ...STATS });
    // The port handed back the firm's collections position on this human. The
    // allowlist is what kept it off the wire.
    expect(body).not.toHaveProperty('balance_cents');
    expect(body).not.toHaveProperty('negative_balance_since');
  });

  test('the three money figures are passed through and never reconciled', async () => {
    const res = await call({ method: 'GET', path: AFFILIATE_STATS_PATH, token: TOKEN });
    const body = res.json() as AffiliateStats;
    expect(body.earned_cents_lifetime).toBe(STATS.earned_cents_lifetime);
    expect(body.payable_cents).toBe(STATS.payable_cents);
    expect(body.paid_cents_lifetime).toBe(STATS.paid_cents_lifetime);
    // The subtraction that looks like it reconciles them does not, and the
    // route did not perform it. M08 puts a clawback window between the three.
    expect(body.payable_cents).not.toBe(body.earned_cents_lifetime - body.paid_cents_lifetime);
  });

  test('every money and ratio field on the wire is an integer', async () => {
    const res = await call({ method: 'GET', path: AFFILIATE_STATS_PATH, token: TOKEN });
    const body = res.json() as Record<string, unknown>;
    for (const [key, value] of Object.entries(body)) {
      if (!key.endsWith('_cents') && !key.endsWith('_bp')) continue;
      expect(typeof value, key).toBe('number');
      expect(Number.isInteger(value), key).toBe(true);
    }
  });
});

// -----------------------------------------------------------------------------
// `GET /affiliate/statements`. Section 1's cursor pagination, and the allowlist.
// -----------------------------------------------------------------------------

describe('statements is a cursor list in section 1s envelope', () => {
  test('the envelope is `{ data, next_cursor }` and each row is allowlisted', async () => {
    const res = await call({ method: 'GET', path: AFFILIATE_STATEMENTS_PATH, token: TOKEN });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Record<string, unknown>[]; next_cursor: string | null };
    expect(Object.keys(body).sort()).toStrictEqual(['data', 'next_cursor']);
    expect(body.next_cursor).toBe('cursor-2');
    expect(Object.keys(body.data[0] as Record<string, unknown>).sort()).toStrictEqual([
      'download_url',
      'period_end',
      'period_start',
      'statement_id',
      'status',
      'total_cents',
    ]);
    // The rail's own transfer reference was on the port's row and is not here.
    expect(body.data[0]).not.toHaveProperty('paid_transfer_ref');
  });

  test('a negative total survives the wire, because a clawback-heavy month is one', async () => {
    const res = await call({ method: 'GET', path: AFFILIATE_STATEMENTS_PATH, token: TOKEN });
    const body = res.json() as { data: { total_cents: number }[] };
    expect(body.data[0]?.total_cents).toBe(-12_50);
    expect(Number.isInteger(body.data[0]?.total_cents)).toBe(true);
  });

  test('the default limit is the contract s 25 and the cursor defaults to null', async () => {
    await call({ method: 'GET', path: AFFILIATE_STATEMENTS_PATH, token: TOKEN });
    expect(state.pageRequests[0]).toStrictEqual({ limit: PAGE_LIMIT_DEFAULT, cursor: null });
  });

  test('a supplied limit and cursor reach the port verbatim', async () => {
    await call({
      method: 'GET',
      path: `${AFFILIATE_STATEMENTS_PATH}?limit=100&cursor=opaque-1`,
      token: TOKEN,
    });
    expect(state.pageRequests[0]).toStrictEqual({ limit: PAGE_LIMIT_MAX, cursor: 'opaque-1' });
  });

  test('an out-of-range or non-numeric limit is refused rather than clamped', async () => {
    for (const limit of ['0', '101', '12abc', '-5', '1.5', '']) {
      state = freshState();
      const res = await call({
        method: 'GET',
        path: `${AFFILIATE_STATEMENTS_PATH}?limit=${limit}`,
        token: TOKEN,
      });
      expect(res.statusCode, limit).toBe(400);
      expect((res.json() as { errors: { path: string }[] }).errors[0]?.path).toBe('limit');
      // A clamp would have called the port with a number the caller did not ask
      // for and reported success. Nothing was read.
      expect(state.pageRequests).toHaveLength(0);
    }
  });

  test('validatePageRequest is total over the shapes a query string produces', () => {
    expect(validatePageRequest(undefined)).toStrictEqual({
      ok: true,
      value: { limit: PAGE_LIMIT_DEFAULT, cursor: null },
    });
    expect(validatePageRequest({ limit: '1' })).toStrictEqual({
      ok: true,
      value: { limit: 1, cursor: null },
    });
    expect(validatePageRequest({ cursor: '   ' }).ok).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// `POST /affiliate/links`. The one validation here that is a control.
// -----------------------------------------------------------------------------

describe('links refuses anything that is not a site-relative path', () => {
  test('a relative path is accepted and reaches the port', async () => {
    const res = await call({
      method: 'POST',
      path: AFFILIATE_LINKS_PATH,
      token: TOKEN,
      body: { landing_path: '/plans', campaign: 'summer' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({
      url: 'https://merit.example/plans?ref=MERIT-LUKE',
      click_token: '7d3f2b90-1a44-4c0e-8b21-5e9f0c6a2d13',
    });
    expect(state.linkRequests[0]).toStrictEqual({ landing_path: '/plans', campaign: 'summer' });
  });

  test('an absolute or protocol-relative landing_path is refused', async () => {
    // Each of these would make a Merit-issued referral link land off site: an
    // open redirect wearing the affiliate's own code.
    const hostile = [
      'https://elsewhere.example/x',
      '//elsewhere.example/x',
      '/\\elsewhere.example/x',
      'plans',
      '',
    ];
    for (const landing_path of hostile) {
      state = freshState();
      const res = await call({
        method: 'POST',
        path: AFFILIATE_LINKS_PATH,
        token: TOKEN,
        body: { landing_path },
      });
      expect(res.statusCode, landing_path).toBe(400);
      expect(state.linkRequests, landing_path).toHaveLength(0);
    }
  });

  test('isSiteRelativePath agrees in both directions', () => {
    expect(isSiteRelativePath('/')).toBe(true);
    expect(isSiteRelativePath('/plans/core')).toBe(true);
    expect(isSiteRelativePath('//evil')).toBe(false);
    expect(isSiteRelativePath('/\\evil')).toBe(false);
    expect(isSiteRelativePath('https://evil')).toBe(false);
    // A control character in a path reaches a header or a log line intact.
    expect(isSiteRelativePath(`/plans${String.fromCharCode(10)}x`)).toBe(false);
  });

  test('a present but empty campaign is refused, and an absent one is omitted', async () => {
    const bad = await call({
      method: 'POST',
      path: AFFILIATE_LINKS_PATH,
      token: TOKEN,
      body: { landing_path: '/plans', campaign: '' },
    });
    expect(bad.statusCode).toBe(400);

    state = freshState();
    await call({
      method: 'POST',
      path: AFFILIATE_LINKS_PATH,
      token: TOKEN,
      body: { landing_path: '/plans' },
    });
    expect(state.linkRequests[0]).toStrictEqual({ landing_path: '/plans' });
  });

  test('a body that is not an object is refused on both POSTs', async () => {
    for (const path of [AFFILIATE_LINKS_PATH, AFFILIATE_CREATIVES_PATH]) {
      state = freshState();
      const res = await call({ method: 'POST', path, token: TOKEN, body: ['not', 'an', 'object'] });
      expect(res.statusCode, path).toBe(400);
    }
  });
});

// -----------------------------------------------------------------------------
// The fail-closed default, which is what a deployment runs today
// -----------------------------------------------------------------------------

describe('the unwired backend answers 503 and names the obstruction', () => {
  test('all four answer 503 on the production dependencies', async () => {
    useAffiliateDeps(productionAffiliateDeps);
    for (const { method, path } of PATHS) {
      const res = await call({ method, path, token: TOKEN, body: GOOD_BODY[path] });
      expect(res.statusCode, path).toBe(503);
      expect((res.json() as { code: string }).code).toBe('service_unavailable');
    }
  });

  test('the refusal names the scope-registry obstruction rather than saying "not wired"', async () => {
    // The message is what a later session reads when it tries to write the
    // adapter, so it names WHY the table cannot be reached rather than only
    // that it has not been.
    await expect(productionAffiliateDeps.backend.stats(SESSION, REF)).rejects.toThrow(
      /affiliate_commissions/,
    );
    await expect(
      productionAffiliateDeps.backend.statements(SESSION, REF, {
        limit: PAGE_LIMIT_DEFAULT,
        cursor: null,
      }),
    ).rejects.toThrow(/affiliate_statements/);
    await expect(
      productionAffiliateDeps.backend.issueLink(SESSION, REF, { landing_path: '/plans' }),
    ).rejects.toThrow(/affiliate_clicks/);
  });
});

// -----------------------------------------------------------------------------
// The module is discovered, not registered by hand
// -----------------------------------------------------------------------------

test('the four routes are composed onto the public surface and withheld from the operator', () => {
  const publicServer = buildServer({ surface: 'public', modules: onDisk });
  const operatorServer = buildServer({ surface: 'operator', modules: onDisk });
  for (const { method, path } of PATHS) {
    expect(publicServer.report.registered).toContain(`${method} ${path}`);
    expect(operatorServer.report.withheld).toContain(`${method} ${path}`);
  }
  expect(publicServer.report.modules).toContain('affiliate');
  return Promise.all([publicServer.app.close(), operatorServer.app.close()]);
});
