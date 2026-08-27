import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { BASE_PATH, PROBLEM_MEDIA_TYPE, buildServer, discoverRouteModules } from '../src/index.ts';
import adminReads, {
  ACCOUNT_DETAIL_SECTIONS,
  ADMIN_READ_ENDPOINTS,
  ADMIN_READ_REQUIRED_FACTORS,
  ADMIN_READ_ROLE_TABLE,
  ADMIN_ROLES,
  ADMIN_SESSION_COOKIE,
  AdminReadError,
  LIMIT_MAX,
  adminTokenFromCookie,
  assertContractScalars,
  authorizeAdmin,
  resolveAdminRole,
  setAdminReadSource,
  setAdminSessionSource,
} from '../src/routes/admin-reads.ts';
import type {
  AdminAccountDetail,
  AdminPrincipal,
  AdminReadSource,
  AdminRole,
  AdminSessionLookup,
  EvidencePackResponse,
  FlagListItem,
  IdentityGraph,
  LiabilityResponse,
} from '../src/routes/admin-reads.ts';

// CI-02, the `unit` project.
//
// WHAT THIS SUITE IS FOR. ADR-144 rules that an admin route is an ordinary route
// module selected by the path-prefix partition ADR-083 already built, that a
// read route still checks a role, and that money on the operator surface is
// swept by name rather than remembered. Each is asserted here through Fastify's
// real router by way of `inject`, so a 404 in this file is produced the way a
// deployment's is.
//
// THE TWO ASSERTIONS THAT WOULD BE WORTH THE MOST IF THEY FAILED are the surface
// boundary and the non-vacuous guard, and both are written to fail rather than
// to pass: the boundary is checked in BOTH directions on the same module, and
// the guard is exercised with a caller who has no session, a caller whose
// session is not an operator's and a caller whose role is not in the set. A
// guard that admits everything passes every admission test ever written against
// it, so admission alone is asserted last and is not the point.

const ROOT = join(import.meta.dirname, '..', '..', '..');

/** Every module on disk, which is what the deployments actually compose. */
const onDisk = await discoverRouteModules();

/** The seven, as a caller writes them. */
const ADDRESSES = {
  liability: '/admin/liability',
  forecast: '/admin/eligible-forecast',
  search: '/admin/accounts?query=alice',
  account: '/admin/accounts/acc-1',
  graph: '/admin/identities/id-1/graph',
  flags: '/admin/flags',
  evidence: '/admin/evidence/acc-1?reason=chargeback+representment',
} as const;

const COOKIE = { cookie: `${ADMIN_SESSION_COOKIE}=operator-token` };

// -----------------------------------------------------------------------------
// Fixtures. Every number an integer, because the sweep is the thing under test
// -----------------------------------------------------------------------------

const LIABILITY: LiabilityResponse = {
  as_of: '2026-08-26T23:00:00Z',
  open_liability_cents: 4_215_000,
  funded_accounts: 37,
  eligible_next_7d: {
    total_cents: 1_150_000,
    account_count: 9,
    by_day: [
      { trading_day: '2026-08-27', cents: 300_000, accounts: 2 },
      { trading_day: '2026-08-28', cents: 850_000, accounts: 7 },
    ],
  },
  payout_velocity: {
    last_7d_cents: 620_000,
    avg_30d_cents: 410_000,
    ratio_bp: 15_122,
    alarm: true,
  },
  reserve: {
    reserve_cents: 9_000_000,
    cvar99_cents: 3_400_000,
    rcr_bp: 26_470,
    breaker_armed: false,
  },
  per_plan: [
    {
      plan_id: 'plan-1',
      code: 'MERIT-50K',
      loss_ratio_bp: 4_120,
      threshold_bp: 5_000,
      sales_paused: false,
      // NOT money and NOT basis points. A CUSUM statistic is a standardised
      // deviation, and the sweep must leave it alone: rounding it would be the
      // calibration defect FM-M6-07 names rather than a fix.
      cusum: { statistic: 2.7183, threshold: 5.5, alarm: false },
    },
  ],
  integrations: {
    mid_health: [{ psp: 'psp-a', decline_rate_bp: 310, chargeback_rate_bp: 42, healthy: true }],
    recon: { last_run_at: '2026-08-26T22:10:00Z', mismatches_open: 0 },
    batch: { last_success_at: '2026-08-26T23:05:00Z', last_duration_ms: 41_200 },
  },
};

const GRAPH: IdentityGraph = {
  root: { identity_id: 'id-1', status: 'active', accounts: 2 },
  nodes: [
    { identity_id: 'id-1', status: 'active', accounts: 2, total_withdrawable_cents: 120_000 },
  ],
  edges: [
    { a: 'id-1', b: 'id-2', link_kind: 'device', confidence_bp: 9_100, evidence: { hits: 3 } },
  ],
  aggregate: {
    identities: 2,
    accounts: 3,
    open_liability_cents: 240_000,
    payouts_lifetime_cents: 815_000,
  },
};

const PACK: EvidencePackResponse = {
  evidence_pack_id: 'pack-1',
  download_url: 'https://storage.example.invalid/pack-1',
  content_sha256: 'a'.repeat(64),
  expires_at: '2026-08-27T01:00:00Z',
  generated_at: '2026-08-27T00:00:00Z',
};

function flag(id: string, severity: 1 | 2 | 3 | 4 | 5, on: string): FlagListItem {
  return {
    flag_id: id,
    identity_id: 'id-1',
    account_id: 'acc-1',
    flag_type: 'duplicate_signal',
    severity,
    status: 'open',
    first_detected_on: on,
    detector: 'dup-v3',
    evidence_summary: 'two accounts, one fill sequence',
  };
}

const DETAIL: AdminAccountDetail = Object.fromEntries(
  ACCOUNT_DETAIL_SECTIONS.map((section) => [section, []]),
) as AdminAccountDetail;

/** A source over fixed rows. Every method records that it was called. */
function sourceOf(overrides: Partial<AdminReadSource> = {}): AdminReadSource & {
  liabilityReads: number;
} {
  const calls = { liabilityReads: 0 };
  const base: AdminReadSource = {
    searchAccounts: () => Promise.resolve({ data: [], next_cursor: null }),
    readAccount: () => Promise.resolve(DETAIL),
    readIdentityGraph: () => Promise.resolve(GRAPH),
    listFlags: () => Promise.resolve({ data: [], next_cursor: null }),
    readLiability: () => {
      calls.liabilityReads += 1;
      return Promise.resolve(LIABILITY);
    },
    exportEvidence: () => Promise.resolve(PACK),
  };
  const merged = { ...base, ...overrides };
  return {
    ...merged,
    get liabilityReads(): number {
      return calls.liabilityReads;
    },
  };
}

/** A session source answering one lookup for every token. */
function sessionOf(lookup: AdminSessionLookup): { lookup: () => Promise<AdminSessionLookup> } {
  return { lookup: () => Promise.resolve(lookup) };
}

function operator(role: string): AdminSessionLookup {
  const principal: AdminPrincipal = { actorId: 'actor-1', role };
  return { kind: 'operator', principal };
}

/** A source or a session left wired by one test and read by the next is a suite
 * that passes for the wrong reason. */
afterEach(() => {
  setAdminReadSource(null);
  setAdminSessionSource(null);
});

async function get(
  surface: 'public' | 'operator',
  path: string,
  headers: Record<string, string> = {},
): Promise<{ statusCode: number; body: string; headers: Record<string, unknown> }> {
  const { app } = buildServer({ surface, modules: onDisk });
  const res = await app.inject({ method: 'GET', url: `${BASE_PATH}${path}`, headers });
  const out = {
    statusCode: res.statusCode,
    body: res.body,
    headers: res.headers as Record<string, unknown>,
  };
  await app.close();
  return out;
}

// -----------------------------------------------------------------------------
// 1. The surface boundary, in both directions, on the same module
// -----------------------------------------------------------------------------

test('the public deployment registers none of the seven and its 404 is the router s', async () => {
  const { app, report } = buildServer({ surface: 'public', modules: onDisk });
  for (const spec of ADMIN_READ_ENDPOINTS) {
    expect(report.withheld).toContain(`${spec.method} ${spec.path}`);
    expect(report.registered).not.toContain(`${spec.method} ${spec.path}`);
  }
  await app.close();

  // Wired, and still 404: the refusal is the absence of a route rather than a
  // check inside one, which is the whole of ADR-083 section 4.
  setAdminSessionSource(sessionOf(operator('owner')));
  setAdminReadSource(sourceOf());
  for (const path of Object.values(ADDRESSES)) {
    const res = await get('public', path, COOKIE);
    expect(res.statusCode, path).toBe(404);
    expect(res.headers['content-type'], path).toContain(PROBLEM_MEDIA_TYPE);
  }
});

test('the operator deployment registers all seven and serves them', async () => {
  const { app, report } = buildServer({ surface: 'operator', modules: onDisk });
  for (const spec of ADMIN_READ_ENDPOINTS)
    expect(report.registered).toContain(`${spec.method} ${spec.path}`);
  await app.close();

  setAdminSessionSource(sessionOf(operator('owner')));
  setAdminReadSource(sourceOf());
  for (const path of Object.values(ADDRESSES)) {
    const res = await get('operator', path, COOKIE);
    expect(res.statusCode, path).toBe(200);
  }
});

test('no path in this module carries the base path, which would classify it public', () => {
  for (const spec of ADMIN_READ_ENDPOINTS) {
    expect(spec.path.startsWith('/admin/') || spec.path === '/admin').toBe(true);
    expect(spec.path.startsWith(BASE_PATH)).toBe(false);
  }
});

test('every endpoint declares admin_sso and nothing else', () => {
  expect(Object.values(ADMIN_READ_REQUIRED_FACTORS)).toEqual(
    ADMIN_READ_ENDPOINTS.map(() => 'admin_sso'),
  );
});

// -----------------------------------------------------------------------------
// 2. The guard, exercised where it must REFUSE
// -----------------------------------------------------------------------------

test('a caller with no operator session is 401, and the session source is never consulted', async () => {
  let consulted = 0;
  setAdminSessionSource({
    lookup: () => {
      consulted += 1;
      return Promise.resolve<AdminSessionLookup>({ kind: 'unknown' });
    },
  });
  setAdminReadSource(sourceOf());
  const res = await get('operator', ADDRESSES.liability);
  expect(res.statusCode).toBe(401);
  expect(JSON.parse(res.body)).toMatchObject({ code: 'unauthenticated', status: 401 });
  // No cookie means no token, so there is nothing to look up. This is what lets
  // an unwired deployment still answer 401 to an anonymous caller.
  expect(consulted).toBe(0);
});

test('a session that is not an operator s is 403 and names the factor', async () => {
  setAdminSessionSource(sessionOf({ kind: 'not-an-operator' }));
  setAdminReadSource(sourceOf());
  const res = await get('operator', ADDRESSES.liability, COOKIE);
  expect(res.statusCode).toBe(403);
  expect(JSON.parse(res.body)).toMatchObject({
    code: 'forbidden',
    status: 403,
    required_factor: 'admin_sso',
  });
});

test('a principal carrying no admin role is 403 and is never defaulted to readonly', async () => {
  setAdminSessionSource(sessionOf(operator('auditor')));
  setAdminReadSource(sourceOf());
  for (const path of Object.values(ADDRESSES)) {
    const res = await get('operator', path, COOKIE);
    expect(res.statusCode, path).toBe(403);
    expect(JSON.parse(res.body), path).toMatchObject({ required_factor: 'admin_sso' });
  }
  expect(resolveAdminRole('auditor')).toBeNull();
  expect(resolveAdminRole('')).toBeNull();
  expect(resolveAdminRole('OWNER')).toBeNull();
});

test('a readonly principal reads every one of the seven', async () => {
  setAdminSessionSource(sessionOf(operator('readonly')));
  setAdminReadSource(sourceOf());
  for (const path of Object.values(ADDRESSES)) {
    const res = await get('operator', path, COOKIE);
    expect(res.statusCode, path).toBe(200);
  }
});

test('the guard refuses an endpoint that admits nobody, rather than reading as one', () => {
  expect(() => authorizeAdmin(operator('owner'), [])).toThrow(AdminReadError);
});

test('a narrower role set refuses a role outside it, which is what makes the check real', () => {
  const ownerOnly: readonly AdminRole[] = ['owner'];
  expect(authorizeAdmin(operator('readonly'), ownerOnly).outcome).toBe('forbidden');
  expect(authorizeAdmin(operator('owner'), ownerOnly).outcome).toBe('allowed');
});

test('the cookie reader takes its own name and no other', () => {
  expect(adminTokenFromCookie(`${ADMIN_SESSION_COOKIE}=abc`)).toBe('abc');
  expect(adminTokenFromCookie('merit_session=abc')).toBeNull();
  expect(adminTokenFromCookie(`merit_session=abc; ${ADMIN_SESSION_COOKIE}=xyz`)).toBe('xyz');
  expect(adminTokenFromCookie(`${ADMIN_SESSION_COOKIE}=`)).toBeNull();
  expect(adminTokenFromCookie(undefined)).toBeNull();
});

// -----------------------------------------------------------------------------
// 3. The roles are the contract's, read from the contract
// -----------------------------------------------------------------------------

test('the role set is API_CONTRACT section 8 s, parsed from the document', () => {
  const contract = readFileSync(join(ROOT, 'docs/architecture/API_CONTRACT.md'), 'utf8');
  const line = contract.split('\n').find((row) => row.startsWith('Roles: '));
  expect(line, 'API_CONTRACT declares the admin roles on one line').toBeDefined();
  const declared = (line ?? '').split('Every mutating')[0] ?? '';
  const roles = [...declared.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]);
  expect(roles).toEqual([...ADMIN_ROLES]);
});

test('apps/admin transcribes the same closed set, and neither imports the other', () => {
  const source = readFileSync(join(ROOT, 'apps/admin/src/roles.ts'), 'utf8');
  const literal = /ADMIN_ROLES = \[([^\]]*)\]/.exec(source)?.[1] ?? '';
  const roles = [...literal.matchAll(/'([a-z]+)'/g)].map((match) => match[1]);
  expect(roles).toEqual([...ADMIN_ROLES]);
  // RI-04 refuses a deployable that imports a deployable, which is why the set
  // is written twice and bound by this assertion rather than by an import. The
  // module NAMES `apps/admin/src/roles.ts` in prose, which is the point of the
  // note, so what is asserted is the import graph and not the text.
  const module = readFileSync(join(ROOT, 'apps/api/src/routes/admin-reads.ts'), 'utf8');
  // Anchored to a real specifier: a wrapped error message can end a string
  // literal with the word "from", and a looser pattern reads the next quote as
  // an import.
  const specifiers = [...module.matchAll(/from '([^'\n]+)';/g)].map((match) => match[1] ?? '');
  expect(specifiers.length).toBeGreaterThan(0);
  for (const specifier of specifiers)
    expect(
      specifier === 'fastify' || specifier.startsWith('./') || specifier.startsWith('../'),
      specifier,
    ).toBe(true);
  for (const specifier of specifiers) expect(specifier).not.toContain('apps/');
});

// THE NAME STOPPED STATING A COUNT ON 2026-08-27, and the reason is the thing
// that broke it. It read "these seven plus the TWO focused projections nobody
// has taken", and `P5-c` legitimately added a third when the wallet surface
// entered the contract (ADR-158). The RULING held and the ENUMERATION did not,
// which is the ninth time that shape has appeared in this corpus and the first
// time in a test NAME, where ADR-034's count rule and `CI-06/derivable-counts`
// do not reach.
//
// WHAT IS PINNED IS STILL PINNED, AND DELIBERATELY. The unserved list below is
// a register of contract rows nobody has built, so it catches a route being
// REMOVED as well as one being added, and deriving it would assert nothing. It
// grows when the contract grows, and it is the second assertion that carries
// the invariant: every path this module serves is declared by the contract.
test('every section 8 GET row is served or is a named projection nobody has taken', () => {
  const contract = readFileSync(join(ROOT, 'docs/architecture/API_CONTRACT.md'), 'utf8');
  const declared = new Set<string>();
  for (const row of contract.split('\n')) {
    if (!row.startsWith('### GET /admin')) continue;
    for (const part of row.slice('### GET '.length).split(','))
      declared.add((part.trim().split('?')[0] ?? '').trim());
  }
  const served = new Set(ADMIN_READ_ENDPOINTS.map((spec) => spec.path));
  const unserved = [...declared].filter((path) => !served.has(path)).sort();
  expect(unserved).toEqual([
    '/admin/cusum',
    '/admin/loss-ratios',
    // Added by ADR-158 when the wallet surface entered the contract. P5's own
    // wave has no slice for it: `P5-l` is the liability half and this is the
    // reconciliation half, which no plan currently claims.
    '/admin/wallet/reconciliation',
  ]);
  expect([...served].filter((path) => !declared.has(path))).toEqual([]);
});

// -----------------------------------------------------------------------------
// 4. Money is integer cents, swept by name
// -----------------------------------------------------------------------------

test('a fractional cents field is refused wherever it appears', () => {
  expect(() => {
    assertContractScalars({ open_liability_cents: 1.5 }, '');
  }).toThrow(AdminReadError);
  expect(() => {
    assertContractScalars({ per_plan: [{ loss_ratio_bp: 41.2 }] }, '');
  }).toThrow(AdminReadError);
  expect(() => {
    assertContractScalars({ nested: { by_day: [{ cents: 10 }] } }, '');
  }).not.toThrow();
  expect(() => {
    assertContractScalars({ total_cents: '1000' }, '');
  }).toThrow(AdminReadError);
});

test('the CUSUM statistic and threshold are floats and are correctly left alone', () => {
  expect(() => {
    assertContractScalars({ cusum: { statistic: 2.718, threshold: 5.5 } }, '');
  }).not.toThrow();
});

test('a trading day that is a timestamp is refused', () => {
  expect(() => {
    assertContractScalars({ trading_day: '2026-08-27T00:00:00Z' }, '');
  }).toThrow(AdminReadError);
  expect(() => {
    assertContractScalars({ first_detected_on: '2026-08-27' }, '');
  }).not.toThrow();
});

test('a liability body carrying a float in cents is refused rather than served', async () => {
  setAdminSessionSource(sessionOf(operator('owner')));
  setAdminReadSource(
    sourceOf({
      readLiability: () =>
        Promise.resolve({ ...LIABILITY, open_liability_cents: 4_215_000.5 } as LiabilityResponse),
    }),
  );
  const res = await get('operator', ADDRESSES.liability, COOKIE);
  expect(res.statusCode).toBe(500);
  expect(JSON.parse(res.body)).toMatchObject({ code: 'internal_error' });
});

// -----------------------------------------------------------------------------
// 5. The reads themselves
// -----------------------------------------------------------------------------

test('the forecast is projected from the SAME read as the liability page and carries as_of', async () => {
  setAdminSessionSource(sessionOf(operator('ops')));
  const source = sourceOf();
  setAdminReadSource(source);
  const res = await get('operator', ADDRESSES.forecast, COOKIE);
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body)).toEqual({
    as_of: LIABILITY.as_of,
    eligible_next_7d: LIABILITY.eligible_next_7d,
  });
  expect(source.liabilityReads).toBe(1);
  // Section 8: the focused projections are "cursor-free and cached for 60
  // seconds", and the position of the firm belongs in no shared cache.
  expect(res.headers['cache-control']).toBe('private, max-age=60');
});

test('a liability page with no snapshot is 404 and never an invented zero', async () => {
  setAdminSessionSource(sessionOf(operator('owner')));
  setAdminReadSource(sourceOf({ readLiability: () => Promise.resolve(null) }));
  expect((await get('operator', ADDRESSES.liability, COOKIE)).statusCode).toBe(404);
  expect((await get('operator', ADDRESSES.forecast, COOKIE)).statusCode).toBe(404);
});

test('INV-M6-10: account search without a specific subject is a validation failure', async () => {
  setAdminSessionSource(sessionOf(operator('owner')));
  setAdminReadSource(sourceOf());
  for (const path of [
    '/admin/accounts',
    '/admin/accounts?query=',
    '/admin/accounts?query=%20%20',
  ]) {
    const res = await get('operator', path, COOKIE);
    expect(res.statusCode, path).toBe(400);
    expect(JSON.parse(res.body).errors, path).toContainEqual(
      expect.objectContaining({ path: 'query' }),
    );
  }
});

test('INV-M6-10: a source returning more rows than the cap is refused, because a cap it may exceed is not one', async () => {
  setAdminSessionSource(sessionOf(operator('owner')));
  setAdminReadSource(
    sourceOf({
      searchAccounts: () =>
        Promise.resolve({
          data: Array.from({ length: 3 }, (_unused, index) => ({
            account_id: `acc-${String(index)}`,
            identity_id: 'id-1',
            email: 'a@example.invalid',
            plan_code: 'MERIT-50K',
            size_cents: 5_000_000,
            phase: 'funded',
            status: 'active',
            balance_cents: 10_000,
            withdrawable_cents: 5_000,
            open_flags: 0,
            payouts_frozen: false,
            recon_blocked: false,
          })),
          next_cursor: null,
        }),
    }),
  );
  const res = await get('operator', '/admin/accounts?query=alice&limit=2', COOKIE);
  expect(res.statusCode).toBe(500);
});

test('section 1 s pagination rule: cursor only, limit an integer from 1 to the maximum', async () => {
  setAdminSessionSource(sessionOf(operator('owner')));
  setAdminReadSource(sourceOf());
  for (const limit of ['0', '-1', '2.5', 'many', String(LIMIT_MAX + 1)]) {
    const res = await get('operator', `/admin/flags?limit=${limit}`, COOKIE);
    expect(res.statusCode, limit).toBe(400);
  }
  expect(
    (await get('operator', `/admin/flags?limit=${String(LIMIT_MAX)}`, COOKIE)).statusCode,
  ).toBe(200);
});

test('the flag queue is refused when it inverts triage', async () => {
  setAdminSessionSource(sessionOf(operator('owner')));
  setAdminReadSource(
    sourceOf({
      listFlags: () =>
        Promise.resolve({
          data: [flag('f-1', 2, '2026-08-01'), flag('f-2', 5, '2026-08-02')],
          next_cursor: null,
        }),
    }),
  );
  expect((await get('operator', ADDRESSES.flags, COOKIE)).statusCode).toBe(500);

  setAdminReadSource(
    sourceOf({
      listFlags: () =>
        Promise.resolve({
          data: [flag('f-2', 5, '2026-08-02'), flag('f-3', 5, '2026-08-01')],
          next_cursor: null,
        }),
    }),
  );
  expect((await get('operator', ADDRESSES.flags, COOKIE)).statusCode).toBe(500);

  setAdminReadSource(
    sourceOf({
      listFlags: () =>
        Promise.resolve({
          data: [
            flag('f-3', 5, '2026-08-01'),
            flag('f-2', 5, '2026-08-02'),
            flag('f-1', 2, '2026-08-01'),
          ],
          next_cursor: null,
        }),
    }),
  );
  expect((await get('operator', ADDRESSES.flags, COOKIE)).statusCode).toBe(200);
});

test('a flag filter outside the closed vocabulary is a validation failure', async () => {
  setAdminSessionSource(sessionOf(operator('owner')));
  setAdminReadSource(sourceOf());
  expect((await get('operator', '/admin/flags?status=escalated', COOKIE)).statusCode).toBe(400);
  expect((await get('operator', '/admin/flags?severity=6', COOKIE)).statusCode).toBe(400);
  expect((await get('operator', '/admin/flags?severity=0', COOKIE)).statusCode).toBe(400);
  expect(
    (await get('operator', '/admin/flags?status=enforced&severity=5', COOKIE)).statusCode,
  ).toBe(200);
});

test('the drill-down allowlist refuses an unnamed section and a missing one alike', async () => {
  setAdminSessionSource(sessionOf(operator('owner')));
  setAdminReadSource(
    sourceOf({
      readAccount: () => Promise.resolve({ ...DETAIL, secrets: [] } as AdminAccountDetail),
    }),
  );
  expect((await get('operator', ADDRESSES.account, COOKIE)).statusCode).toBe(500);

  const { flags: _dropped, ...missing } = DETAIL as Record<string, unknown>;
  setAdminReadSource(
    sourceOf({ readAccount: () => Promise.resolve(missing as AdminAccountDetail) }),
  );
  expect((await get('operator', ADDRESSES.account, COOKIE)).statusCode).toBe(500);
});

test('an account and an identity nobody has are 404, which on this surface means absent', async () => {
  setAdminSessionSource(sessionOf(operator('owner')));
  setAdminReadSource(
    sourceOf({
      readAccount: () => Promise.resolve(null),
      readIdentityGraph: () => Promise.resolve(null),
      exportEvidence: () => Promise.resolve(null),
    }),
  );
  expect((await get('operator', ADDRESSES.account, COOKIE)).statusCode).toBe(404);
  expect((await get('operator', ADDRESSES.graph, COOKIE)).statusCode).toBe(404);
  expect((await get('operator', ADDRESSES.evidence, COOKIE)).statusCode).toBe(404);
});

test('an evidence export without a reason is refused, and the reason reaches the generator', async () => {
  setAdminSessionSource(sessionOf(operator('readonly')));
  let seen: { reason: string; actor: AdminPrincipal } | null = null;
  setAdminReadSource(
    sourceOf({
      exportEvidence: (request) => {
        seen = { reason: request.reason, actor: request.actor };
        return Promise.resolve(PACK);
      },
    }),
  );
  expect((await get('operator', '/admin/evidence/acc-1', COOKIE)).statusCode).toBe(400);
  expect((await get('operator', '/admin/evidence/acc-1?reason=%20', COOKIE)).statusCode).toBe(400);
  expect(seen).toBeNull();

  expect((await get('operator', ADDRESSES.evidence, COOKIE)).statusCode).toBe(200);
  expect(seen).toEqual({
    reason: 'chargeback representment',
    actor: { actorId: 'actor-1', role: 'readonly' },
  });
});

test('a pack whose digest is not a SHA-256 is refused, because it authenticates nothing', async () => {
  setAdminSessionSource(sessionOf(operator('owner')));
  setAdminReadSource(
    sourceOf({ exportEvidence: () => Promise.resolve({ ...PACK, content_sha256: 'nope' }) }),
  );
  expect((await get('operator', ADDRESSES.evidence, COOKIE)).statusCode).toBe(500);
});

// -----------------------------------------------------------------------------
// 6. An unfinished deployment reports itself as one
// -----------------------------------------------------------------------------

test('an unwired source is a 500 and never a 404 or a 401', async () => {
  setAdminSessionSource(sessionOf(operator('owner')));
  setAdminReadSource(null);
  const res = await get('operator', ADDRESSES.liability, COOKIE);
  expect(res.statusCode).toBe(500);
  expect(JSON.parse(res.body)).toMatchObject({ code: 'internal_error' });
});

test('an unwired session source is a 500 for a caller who presented a token', async () => {
  setAdminSessionSource(null);
  setAdminReadSource(sourceOf());
  expect((await get('operator', ADDRESSES.liability, COOKIE)).statusCode).toBe(500);
  // And still 401 for one who did not, because there is nothing to look up.
  expect((await get('operator', ADDRESSES.liability)).statusCode).toBe(401);
});

// -----------------------------------------------------------------------------
// 7. ADR-012, made mechanical
// -----------------------------------------------------------------------------

test('ADR-012: no admin-origin host is written into this module or its suite', () => {
  // "The domain itself is chosen at infrastructure setup time and is never
  // written into the corpus, the repository, or any public artifact." A rule
  // enforced by remembering is a rule that lasts until the first debugging
  // session, so it is a assertion here instead.
  //
  // THE NEEDLES ARE ASSEMBLED RATHER THAN WRITTEN, because a test that spells
  // them out is a test whose own source is the first thing it has to fail on.
  const tlds = ['com', 'net', 'org', 'io', 'dev', 'app', 'xyz', 'cloud', 'systems'];
  const needles = tlds.map((tld) => `.${tld}`);
  const module = readFileSync(join(ROOT, 'apps/api/src/routes/admin-reads.ts'), 'utf8');
  for (const needle of [...needles, ['http', '://'].join('')])
    expect(module, needle).not.toContain(needle);
  // The suite's own fixtures use the reserved `.invalid` TLD (RFC 2606), which
  // resolves nowhere by definition and can never be somebody's real host, so
  // the scheme is not forbidden here and the host shapes still are.
  const suite = readFileSync(join(ROOT, 'apps/api/test/admin-reads.test.ts'), 'utf8');
  for (const needle of needles) expect(suite, needle).not.toContain(needle);
});

// -----------------------------------------------------------------------------
// 8. The declaration a later gate reads
// -----------------------------------------------------------------------------

test('the role table is derived from the same array the routes are', () => {
  expect(Object.keys(ADMIN_READ_ROLE_TABLE)).toEqual(
    ADMIN_READ_ENDPOINTS.map((spec) => `${spec.method} ${spec.path}`),
  );
  for (const roles of Object.values(ADMIN_READ_ROLE_TABLE)) expect(roles).toEqual([...ADMIN_ROLES]);
});

test('the module is one route module named for its file, with the seven and nothing else', () => {
  expect(adminReads.name).toBe('admin-reads');
  expect(adminReads.routes.map((route) => `${route.method} ${route.path}`)).toEqual(
    ADMIN_READ_ENDPOINTS.map((spec) => `${spec.method} ${spec.path}`),
  );
  expect(adminReads.routes).toHaveLength(7);
});
