import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { BASE_PATH, PROBLEM_MEDIA_TYPE, buildServer, discoverRouteModules } from '../src/index.ts';
import { ADMIN_FEED_ENDPOINTS } from '../src/routes/admin-feed.ts';
import adminReads, {
  ACCOUNT_DETAIL_SECTIONS,
  ADMIN_READ_ENDPOINTS,
  ADMIN_READ_REQUIRED_FACTORS,
  ADMIN_READ_ROLE_TABLE,
  ADMIN_ROLES,
  ADMIN_SESSION_COOKIE,
  AdminReadError,
  EVIDENCE_PACK_AUDIENCES,
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
  EvidencePackAudience,
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
  evidence: '/admin/evidence/acc-1?reason=chargeback+representment&audience=counsel',
} as const;

const COOKIE = { cookie: `${ADMIN_SESSION_COOKIE}=operator-token` };

// -----------------------------------------------------------------------------
// Fixtures. Every number an integer, because the sweep is the thing under test
// -----------------------------------------------------------------------------

const LIABILITY: LiabilityResponse = {
  as_of: '2026-08-26T23:00:00Z',
  open_liability_cents: 4_215_000,
  wallet_balances_cents: 812_500,
  bounded_near_term_cents: 1_640_000,
  remaining_ladder_exposure_cents: 9_800_000,
  // NEGATIVE ON PURPOSE. This is the only signed figure on the response, and a
  // fixture that carried it positive would let a clamp at zero pass the sweep.
  absorbed_corrections_cents: -73_400,
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
    // DELIBERATELY NOT THE TOP-LEVEL `as_of`. A different table on a different
    // clock, and a fixture that repeated the instant above could not tell a
    // projection that carries both from one that dated the rail with the book.
    as_of: '2026-08-26T22:45:00Z',
    reserve_cents: 9_000_000,
    cvar99_cents: 3_400_000,
    rcr_bp: 26_470,
    breaker_armed: false,
    treasury_account_code: 'RESERVE-C1',
    treasury_as_of: '2026-08-26T22:40:00Z',
    treasury_source: 'manual_attestation',
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

// `audience` matches what `ADDRESSES.evidence` asks for, and it has to: the
// route refuses a pack built for an audience other than the requested one, so a
// fixture that disagreed with the address would fail every test that uses both.
const PACK: EvidencePackResponse = {
  evidence_pack_id: 'pack-1',
  download_url: 'https://storage.example.invalid/pack-1',
  content_sha256: 'a'.repeat(64),
  expires_at: '2026-08-27T01:00:00Z',
  generated_at: '2026-08-27T00:00:00Z',
  audience: 'counsel',
};

/**
 * One `FlagListItem`, at a corroboration depth ADR-178 made the FIRST sort key.
 *
 * THE DEPTH DEFAULTS TO 1 AND NOT TO 0, so a caller that does not care about the
 * first key produces a page that is one flat band and exercises the contract's
 * "severity then age" exactly as it did before the ruling.
 */
function flag(id: string, severity: 1 | 2 | 3 | 4 | 5, on: string, depth = 1): FlagListItem {
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
    corroboration_depth: depth,
  };
}

/**
 * The eight sections, with a REAL `account` root and seven empty lists.
 *
 * THE ROOT IS A RECORD CARRYING `account_id` BECAUSE `accountDetailLicence`
 * READS IT. `INV-M6-10` licenses the subject the PATH named, so the response has
 * to say which account it is about before anything on it can be licensed, and a
 * root of `[]` is a drill-down that does not. That is the first field-level
 * requirement anything places on the one route API_CONTRACT section 8 does not
 * type, and it is placed by the invariant rather than by a schema.
 */
const DETAIL: AdminAccountDetail = {
  ...(Object.fromEntries(
    ACCOUNT_DETAIL_SECTIONS.map((section) => [section, []]),
  ) as AdminAccountDetail),
  account: { account_id: 'acc-1' },
};

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
    // ADR-184 ruling 1's seventh method. AN EMPTY PAGE AND NOT A REJECTION: this
    // stub is what the section 8 routes read through, none of them is the feed,
    // and a throwing leg here would fail a test for a method it never called.
    listEvents: () => Promise.resolve({ data: [], next_cursor: null }),
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

// -----------------------------------------------------------------------------
// 3a. The search term list is the contract's, read from the contract (ADR-194)
// -----------------------------------------------------------------------------
//
// ADR-194 narrowed `GET /admin/accounts?query=` from seven forms to six by
// REMOVING a name fragment, and the validation message in `admin-reads.ts` is a
// TRANSCRIPTION of the contract sentence that carries them. Two transcriptions
// of one list is the drift this entry exists to repair, so the two are bound
// here rather than kept true by hand.
//
// THE DIRECTION THIS ASSERTION FAILS IN IS A PARSER THAT STOPS MATCHING. Two
// empty lists compare equal, and a reader whose rule no longer matches returns
// one, so both halves are asserted non-empty before they are compared. That is
// ADR-112 section 8's warning and ADR-157 section 8's, applied to a reader
// rather than to a fold.
//
// WHAT IS NOT ASSERTED IS A COUNT. The ruling is that the list is the same on
// both sides and holds no pattern; an enumeration has drifted in this corpus
// every time one was pinned, and `name fragment` is named in the negative
// because it is the one form the ruling removed.
const SEARCH_TERM_ARTICLES = /^(?:an|a) /;

function searchTermsOf(sentence: string): string[] {
  const list = sentence.split(':')[1] ?? '';
  return list
    .replace(/\.$/, '')
    .split(',')
    .flatMap((part) => part.split(' or '))
    .map((part) => part.trim().replace(SEARCH_TERM_ARTICLES, '').trim())
    .filter((part) => part.length > 0);
}

test('ADR-194: the account search term list is the contract s, and holds no pattern', () => {
  const contract = readFileSync(join(ROOT, 'docs/architecture/API_CONTRACT.md'), 'utf8');
  const declared = contract
    .split('\n')
    .find((row) => row.startsWith('Search by an exact subject:'));
  expect(declared, 'API_CONTRACT declares the search terms on one line').toBeDefined();
  const contractTerms = searchTermsOf(declared ?? '');

  const module = readFileSync(join(ROOT, 'apps/api/src/routes/admin-reads.ts'), 'utf8');
  const message = /'must name an exact subject: ([^']*)' \+\n\s*'([^']*)'/.exec(module);
  expect(message, 'the route states the term list in one validation message').not.toBeNull();
  const routeTerms = searchTermsOf(`:${message?.[1] ?? ''}${message?.[2] ?? ''}`);

  // A reader that stopped matching returns nothing, and two empty lists are equal.
  expect(contractTerms.length).toBeGreaterThan(0);
  expect(routeTerms.length).toBeGreaterThan(0);
  expect(routeTerms).toEqual(contractTerms);

  // ADR-194 clause 1: every term is a value that exists in the estate.
  expect(contractTerms).not.toContain('name fragment');
  for (const term of contractTerms) expect(term).not.toMatch(/fragment|prefix|partial|pattern/);
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
  // THE SET IS THE DEPLOYABLE'S AND NOT THIS MODULE'S, and it stopped being one
  // module's on 2026-08-28. `W6-e` (ADR-184) put `GET /admin/events` in its own
  // route module because the feed's safety is a property of its QUERY and
  // `/admin/flags` records the opposite rule about its own absent filter three
  // lines from where the two would have sat together. The sentence this test
  // asserts is about the operator SURFACE, so a second module serving a section
  // 8 row is not a register entry: it is a route that is served.
  const served = new Set(
    [...ADMIN_READ_ENDPOINTS, ...ADMIN_FEED_ENDPOINTS].map((spec) => spec.path),
  );
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

// -----------------------------------------------------------------------------
// 4b. A DAY-SHAPED NAME SAYS WHICH RULE APPLIES. THE CONTRACT SAYS WHAT IT ADMITS
// -----------------------------------------------------------------------------
// The sweep read `_day` as "this value IS a trading day" and refused everything
// else under such a name, which refused two fields API_CONTRACT itself declares.
// These cases derive the admitted forms FROM THE DOCUMENT rather than restating
// them, so a future row declaring a fourth form under a day-shaped name turns a
// case red instead of being silently admitted or silently refused.

/** Every `*_day` / `*_on` member declared inside a `ts` block of API_CONTRACT. */
function declaredDayMembers(): { readonly key: string; readonly declared: string }[] {
  const contract = readFileSync(join(ROOT, 'docs/architecture/API_CONTRACT.md'), 'utf8');
  const members: { key: string; declared: string }[] = [];
  let inBlock = false;
  for (const line of contract.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      inBlock = !inBlock && line.trimStart().startsWith('```ts');
      continue;
    }
    if (!inBlock) continue;
    for (const match of line.matchAll(
      /([A-Za-z_][A-Za-z0-9_]*(?:_day|_on))\s*\??\s*:\s*([^;,{]+)/g,
    ))
      members.push({ key: match[1] ?? '', declared: (match[2] ?? '').replace(/[}\s]+$/, '') });
  }
  return members;
}

/** Which of the four forms the contract wrote, read from the declaration alone. */
function formOf(declared: string): 'boolean' | 'container' | 'nullable' | 'day' {
  if (declared.includes('boolean')) return 'boolean';
  if (declared.startsWith('Array') || declared.startsWith('{')) return 'container';
  if (declared.includes('null')) return 'nullable';
  return 'day';
}

test('the contract declares FOUR forms under a day-shaped name, and the sweep admits all four', () => {
  const members = declaredDayMembers();
  // A reader that stopped matching returns nothing, and nothing passes vacuously.
  expect(members.length).toBeGreaterThan(0);

  const byForm = new Map<string, string[]>();
  for (const { key, declared } of members) {
    const form = formOf(declared);
    byForm.set(form, [...new Set([...(byForm.get(form) ?? []), key])].sort());
  }
  // ALL FOUR ARE PRESENT, so no branch of the rule below is asserted against an
  // empty set.
  expect([...byForm.keys()].sort()).toStrictEqual(['boolean', 'container', 'day', 'nullable']);

  // THE TWO BOOLEANS ARE NAMED BECAUSE THEY ARE THE WHOLE FINDING. API_CONTRACT
  // section 6's `MarkListItem` writes `traded_day: boolean; win_day: boolean;`,
  // and the sweep refused both until this rule was repaired.
  expect(byForm.get('boolean')).toStrictEqual(['traded_day', 'win_day']);
  // And the nullable form is written out rather than counted, because an ABSENT
  // KEY was the shape this repair replaced.
  expect(byForm.get('nullable')?.length).toBeGreaterThan(0);

  const witness: Record<string, unknown> = {
    boolean: true,
    container: [{ trading_day: '2026-08-27' }],
    day: '2026-08-27',
    nullable: null,
  };
  for (const { key, declared } of members)
    expect(() => {
      assertContractScalars({ [key]: witness[formOf(declared)] }, '');
    }, `${key}: ${declared}`).not.toThrow();
});

test('every form the contract does NOT declare under such a name is still refused, on every one of those names', () => {
  const members = declaredDayMembers();
  expect(members.length).toBeGreaterThan(0);
  // A UTC INSTANT, AN EPOCH SECOND AND A UTC DATE MISSING ITS PADDING. These are
  // what a wrong trading day actually looks like on the way to an operator, and
  // admitting `null` and `boolean` costs none of them.
  const wrong = ['2026-08-27T00:00:00Z', '2026-8-27', '27/08/2026', 1_756_339_200, 20_260_827];
  for (const { key } of members)
    for (const value of wrong)
      expect(
        () => {
          assertContractScalars({ [key]: value }, '');
        },
        `${key}: ${JSON.stringify(value)}`,
      ).toThrow(AdminReadError);
});

test('a Date under a day-shaped name is refused, where the container exemption used to admit it', () => {
  // THE HALF OF THIS REPAIR THAT TIGHTENS. The exemption that lets
  // `eligible_next_7d.by_day` through was `typeof member === 'object' && member
  // !== null`, and `Object.entries(new Date())` is `[]`: a `Date` was walked,
  // found to carry nothing, and admitted. It serialises as a UTC instant, so the
  // defect this sweep exists to catch reached the wire THROUGH the sweep.
  expect(JSON.stringify({ trading_day: new Date('2026-08-27T00:00:00Z') })).toBe(
    '{"trading_day":"2026-08-27T00:00:00.000Z"}',
  );
  expect(() => {
    assertContractScalars({ trading_day: new Date('2026-08-27T00:00:00Z') }, '');
  }).toThrow(AdminReadError);
  // The container it exists for still passes, in both directions.
  expect(() => {
    assertContractScalars({ by_day: [{ trading_day: '2026-08-27', cents: 10 }] }, '');
  }).not.toThrow();
  expect(() => {
    assertContractScalars({ by_day: [{ trading_day: '2026-08-27T00:00:00Z' }] }, '');
  }).toThrow(AdminReadError);
});

test('an exempted list of the two boolean names would already be stale, which is why the rule is by type', () => {
  // RI-05's `covers` calls two files holding one number "a hand-maintained count
  // in a different costume, and it drifts the same way". A list of the two names
  // the contract declares would not even reach the schema: the trading calendar
  // itself carries a third boolean under a day-shaped name.
  const ddl = readFileSync(join(ROOT, 'packages/db/migrations/0004_catalog.sql'), 'utf8');
  expect(ddl).toMatch(/^ {2}is_half_day\s+boolean NOT NULL/m);
  expect(() => {
    assertContractScalars({ is_half_day: true }, '');
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

/**
 * ADR-178's three keys, at the boundary that enforces them.
 *
 * The first two cases are the contract's own sentence WITHIN one corroboration
 * band and are unchanged in substance by the ruling. The last two are the key
 * the ruling added: a page that ranks one loud detector above three agreeing
 * ones is refused where it used to be the only page this route accepted, and the
 * `GS-120` shape that used to 500 is now the one that is served.
 */
test('the flag queue is refused when it inverts triage', async () => {
  const pageOf = async (data: readonly FlagListItem[]): Promise<number> => {
    setAdminReadSource(sourceOf({ listFlags: () => Promise.resolve({ data, next_cursor: null }) }));
    return (await get('operator', ADDRESSES.flags, COOKIE)).statusCode;
  };
  setAdminSessionSource(sessionOf(operator('owner')));

  // Severity inverted inside one band.
  expect(await pageOf([flag('f-1', 2, '2026-08-01'), flag('f-2', 5, '2026-08-02')])).toBe(500);
  // Age inverted at one severity inside one band.
  expect(await pageOf([flag('f-2', 5, '2026-08-02'), flag('f-3', 5, '2026-08-01')])).toBe(500);
  // Both keys respected inside one band.
  expect(
    await pageOf([
      flag('f-3', 5, '2026-08-01'),
      flag('f-2', 5, '2026-08-02'),
      flag('f-1', 2, '2026-08-01'),
    ]),
  ).toBe(200);

  // ADR-178's first key inverted: one uncorroborated 5 above a corroborated 2.
  expect(await pageOf([flag('f-4', 5, '2026-08-01', 1), flag('f-5', 2, '2026-08-01', 3)])).toBe(
    500,
  );
  // `GS-120`'s own shape, which this route refused before the ruling.
  expect(await pageOf([flag('f-5', 2, '2026-08-01', 3), flag('f-4', 5, '2026-08-01', 1)])).toBe(
    200,
  );
  // A depth that is not a count is corruption rather than a band.
  expect(await pageOf([{ ...flag('f-6', 5, '2026-08-01'), corroboration_depth: 1.5 }])).toBe(500);
});

/**
 * `projectFlag` carries ADR-178's key to the wire, asserted on the BODY.
 *
 * THIS CASE EXISTS BECAUSE THE ORDER ASSERTION CANNOT COVER IT. `assertFlagOrder`
 * runs on the PORT's rows, before the projection, so a `projectFlag` that
 * emitted a constant depth would ship a wrong sort key to the operator with the
 * adapter right, the ordering right and the assertion passing. That mutation was
 * seeded and NOTHING CAUGHT IT until this case existed, which is the field-by-
 * field projection's own warning arriving on the one field that is new.
 */
test('the served flag carries the corroboration depth the port computed', async () => {
  setAdminSessionSource(sessionOf(operator('owner')));
  setAdminReadSource(
    sourceOf({
      listFlags: () =>
        Promise.resolve({
          data: [flag('f-1', 2, '2026-08-01', 3), flag('f-2', 5, '2026-08-02', 1)],
          next_cursor: null,
        }),
    }),
  );
  const res = await get('operator', ADDRESSES.flags, COOKIE);
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body) as { data: FlagListItem[] };
  expect(body.data.map((item) => item.corroboration_depth)).toStrictEqual([3, 1]);
  // And the whole row, so a field dropped anywhere in the projection is caught
  // by the same case rather than by the next one somebody remembers to write.
  expect(body.data[0]).toStrictEqual(flag('f-1', 2, '2026-08-01', 3));
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
  let seen: { reason: string; audience: EvidencePackAudience; actor: AdminPrincipal } | null = null;
  setAdminReadSource(
    sourceOf({
      exportEvidence: (request) => {
        seen = { reason: request.reason, audience: request.audience, actor: request.actor };
        return Promise.resolve(PACK);
      },
    }),
  );
  expect((await get('operator', '/admin/evidence/acc-1?audience=counsel', COOKIE)).statusCode).toBe(
    400,
  );
  expect(
    (await get('operator', '/admin/evidence/acc-1?reason=%20&audience=counsel', COOKIE)).statusCode,
  ).toBe(400);
  expect(seen).toBeNull();

  expect((await get('operator', ADDRESSES.evidence, COOKIE)).statusCode).toBe(200);
  expect(seen).toEqual({
    reason: 'chargeback representment',
    audience: 'counsel',
    actor: { actorId: 'actor-1', role: 'readonly' },
  });
});

// ADR-166, SD-M6-04, AS-M6-01.
//
// THESE ARE WRITTEN TO FAIL RATHER THAN TO PASS. The assertion that matters is
// not that a valid audience is accepted, which any implementation that ignored
// the parameter entirely would also satisfy; it is that an ABSENT one is refused
// and never defaulted, and that the generator is not reached when it is missing.
// A route that quietly chose `trader` would look correct in every test that
// supplied an audience, and would be the disclosure decision made by the process
// instead of by the operator.
test('an evidence export without an audience is refused and no default is chosen', async () => {
  setAdminSessionSource(sessionOf(operator('owner')));
  let reached = 0;
  setAdminReadSource(
    sourceOf({
      exportEvidence: () => {
        reached += 1;
        return Promise.resolve(PACK);
      },
    }),
  );

  // Absent, blank, and a name the merged CHECK would refuse. All three are 400.
  for (const address of [
    '/admin/evidence/acc-1?reason=dispute',
    '/admin/evidence/acc-1?reason=dispute&audience=',
    '/admin/evidence/acc-1?reason=dispute&audience=%20',
    '/admin/evidence/acc-1?reason=dispute&audience=press',
    '/admin/evidence/acc-1?reason=dispute&audience=Trader',
  ])
    expect((await get('operator', address, COOKIE)).statusCode, address).toBe(400);

  expect(reached, 'the generator is never reached without a valid audience').toBe(0);
});

test('every audience the merged CHECK admits is accepted, and the response echoes it', async () => {
  setAdminSessionSource(sessionOf(operator('owner')));
  for (const audience of EVIDENCE_PACK_AUDIENCES) {
    setAdminReadSource(sourceOf({ exportEvidence: () => Promise.resolve({ ...PACK, audience }) }));
    const response = await get(
      'operator',
      `/admin/evidence/acc-1?reason=dispute&audience=${audience}`,
      COOKIE,
    );
    expect(response.statusCode, audience).toBe(200);
    expect((JSON.parse(response.body) as EvidencePackResponse).audience).toBe(audience);
  }
});

// THE ONE A TYPE CHECK CANNOT CATCH. Both audiences are valid members, so the
// mismatch produces a well-formed response carrying a real audience, and nothing
// else in this module would notice it.
test('a pack built for an audience other than the one requested is refused, not relabelled', async () => {
  setAdminSessionSource(sessionOf(operator('owner')));
  setAdminReadSource(
    sourceOf({ exportEvidence: () => Promise.resolve({ ...PACK, audience: 'internal' }) }),
  );
  expect(
    (await get('operator', '/admin/evidence/acc-1?reason=dispute&audience=trader', COOKIE))
      .statusCode,
  ).toBe(500);
});

// The four names are a TRANSCRIPTION of `evidence_packs.audience`'s CHECK in a
// merged migration, so the migration is the source and this asserts against it
// rather than against a copy. A fifth name added to the route would type-check,
// pass every test above, and fail at the database on first use.
test('the audience vocabulary is exactly the merged CHECK in 0008_risk.sql', () => {
  const ddl = readFileSync(join(ROOT, 'packages/db/migrations/0008_risk.sql'), 'utf8');
  const clause = /audience\s+text NOT NULL CHECK \(audience IN \(([^)]*)\)\)/.exec(ddl);
  expect(clause, '0008_risk.sql declares the audience CHECK').not.toBeNull();
  const inDdl = [...(clause?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  expect(inDdl).toEqual([...EVIDENCE_PACK_AUDIENCES].sort());
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

// -----------------------------------------------------------------------------
// 9. ADR-190: what an operator route ANSWERS, enumerated rather than assumed
// -----------------------------------------------------------------------------
// THREE DOCUMENTS SAID 503 AND NO ROUTE IN THIS MODULE HAS EVER SENT ONE.
// `WAVE-06` section 4.1: *"Every one of the 26 operator routes above answers 503
// today"*; `apps/admin/src/http/client.ts` repeats it twice; and `W6-d` built
// `apps/admin/src/app/page.tsx` to render `toAdminErrorKind(503)` on that basis.
// Session 336 reported the sentence false, session 344 measured the two real
// answers, and neither session held a file that could repair it. ADR-190 rules
// it, and this section is the table so the number cannot come back as prose.
//
// THE ANSWER IS NOT TWO THINGS. It is EIGHT states over one endpoint, and the
// distinction between them is what an operator and a monitor each have to act
// on. The three that answer 500 are INDISTINGUISHABLE ON THE WIRE and ADR-190
// ruling 2 keeps them that way deliberately: the response may not tell an
// unauthenticated caller which of this deployment's ports are uncomposed, and
// the discrimination a monitor needs is in `server.ts`'s log line, where the
// thrown `AdminReadError` names the source by hand.

const NOTHING = Symbol('no source composed');

/** One state of the deployment, its request, and the answer ADR-190 rules. */
const ANSWER_TABLE: readonly {
  readonly state: string;
  readonly session: AdminSessionLookup | typeof NOTHING;
  readonly read: 'composed' | 'throws' | 'empty' | typeof NOTHING;
  readonly cookie: boolean;
  readonly status: number;
  readonly code: string;
}[] = [
  {
    state: 'A. no session source composed, and the caller sent no cookie',
    session: NOTHING,
    read: NOTHING,
    cookie: false,
    status: 401,
    code: 'unauthenticated',
  },
  {
    state: 'B. no session source composed, and the caller sent a cookie',
    session: NOTHING,
    read: NOTHING,
    cookie: true,
    status: 500,
    code: 'internal_error',
  },
  {
    state: 'C. a session source composed, and it does not know the token',
    session: { kind: 'unknown' },
    read: 'composed',
    cookie: true,
    status: 401,
    code: 'unauthenticated',
  },
  {
    state: 'D. a session source composed, and the session is not an operator',
    session: { kind: 'not-an-operator' },
    read: 'composed',
    cookie: true,
    status: 403,
    code: 'forbidden',
  },
  {
    state: 'E. an operator session carrying a role this contract does not declare',
    session: { kind: 'operator', principal: { actorId: 'actor-1', role: 'auditor' } },
    read: 'composed',
    cookie: true,
    status: 403,
    code: 'forbidden',
  },
  {
    state: 'F. an admitted operator, and NO READ SOURCE composed',
    session: { kind: 'operator', principal: { actorId: 'actor-1', role: 'owner' } },
    read: NOTHING,
    cookie: true,
    status: 500,
    code: 'internal_error',
  },
  {
    state: 'G. everything composed, and the handler itself threw',
    session: { kind: 'operator', principal: { actorId: 'actor-1', role: 'owner' } },
    read: 'throws',
    cookie: true,
    status: 500,
    code: 'internal_error',
  },
  {
    state: 'H. everything composed, and the read found no row',
    session: { kind: 'operator', principal: { actorId: 'actor-1', role: 'owner' } },
    read: 'empty',
    cookie: true,
    status: 404,
    code: 'not_found',
  },
];

async function answerFor(row: (typeof ANSWER_TABLE)[number]): Promise<{
  statusCode: number;
  code: string;
}> {
  setAdminSessionSource(row.session === NOTHING ? null : sessionOf(row.session));
  if (row.read === NOTHING) setAdminReadSource(null);
  else if (row.read === 'throws')
    setAdminReadSource(sourceOf({ readLiability: () => Promise.reject(new Error('handler')) }));
  else if (row.read === 'empty')
    setAdminReadSource(sourceOf({ readLiability: () => Promise.resolve(null) }));
  else setAdminReadSource(sourceOf());
  const res = await get('operator', ADDRESSES.liability, row.cookie ? COOKIE : {});
  return { statusCode: res.statusCode, code: (JSON.parse(res.body) as { code: string }).code };
}

test('ADR-190 ruling 1: the eight states of one operator route, each measured', async () => {
  for (const row of ANSWER_TABLE) {
    const answer = await answerFor(row);
    expect(answer, row.state).toStrictEqual({ statusCode: row.status, code: row.code });
    setAdminReadSource(null);
    setAdminSessionSource(null);
  }
  // NOT 503, AND THIS IS THE ASSERTION THE THREE DOCUMENTS WOULD HAVE FAILED.
  expect(ANSWER_TABLE.map((row) => row.status)).not.toContain(503);
});

test('ADR-190 ruling 2: the three 500 states are one document, on purpose', async () => {
  // A DEPLOYMENT THAT COMPOSED NO SESSION SOURCE, ONE THAT COMPOSED NO READ
  // SOURCE, AND A HANDLER THAT THREW ARE THE SAME BYTES. That is the cost the
  // ruling accepts and it is asserted rather than left to be discovered: a
  // response that distinguished them would tell an unauthenticated caller which
  // ports this deployment did not compose.
  const five_hundreds = ANSWER_TABLE.filter((row) => row.status === 500);
  expect(five_hundreds).toHaveLength(3);
  const bodies: string[] = [];
  for (const row of five_hundreds) {
    setAdminSessionSource(row.session === NOTHING ? null : sessionOf(row.session));
    if (row.read === NOTHING) setAdminReadSource(null);
    else
      setAdminReadSource(sourceOf({ readLiability: () => Promise.reject(new Error('handler')) }));
    const res = await get('operator', ADDRESSES.liability, COOKIE);
    // The request id differs per request and is the only field that may.
    bodies.push(res.body.replaceAll(/"instance":"[^"]*"/g, '"instance":"<id>"'));
    setAdminReadSource(null);
    setAdminSessionSource(null);
  }
  expect(new Set(bodies).size).toBe(1);
});

test('ADR-190: every route THIS module registers answers the same two, never 503', async () => {
  // OVER THE MODULE'S OWN ROUTES RATHER THAN OVER ONE ADDRESS, because the
  // false sentence was universally quantified and a single-endpoint measurement
  // is what let it stand for two waves.
  for (const spec of ADMIN_READ_ENDPOINTS) {
    const path = spec.path.replaceAll(/:[A-Za-z]+/g, 'x'.repeat(8));
    const anonymous = await get('operator', path);
    expect(anonymous.statusCode, `${spec.path} anonymous`).toBe(401);
    const withCookie = await get('operator', path, COOKIE);
    expect(withCookie.statusCode, `${spec.path} with a cookie`).toBe(500);
  }
});

test("ADR-190 ruling 2: 503 IS section 2's code and the operator surface does send it", async () => {
  // THE PREMISE THE RULING TURNS ON, DERIVED FROM THE SURFACE RATHER THAN
  // ASSERTED. `service_unavailable` is not a code anybody would have to invent:
  // API_CONTRACT section 2 declares it, and other admin modules answer it today
  // for an uncomposed backend. The finding ADR-190 rules on is that THIS module
  // takes the opposite decision for the same shape, on ADR-110's precedent.
  //
  // THE PARTITION IS DERIVED AND THE COUNTS ARE NOT PINNED, so a slice that
  // wires a backend moves a route between the sets without turning this red.
  const { report } = buildServer({ surface: 'operator', modules: onDisk });
  const admin = report.registered.filter((entry) => entry.includes(' /admin/'));
  const unavailable: string[] = [];
  const authenticating: string[] = [];
  for (const entry of admin) {
    // PARSED RATHER THAN CAST, and a verb this parser does not know turns the
    // case red instead of being skipped quietly.
    const verb = entry.startsWith('GET ') ? 'GET' : entry.startsWith('POST ') ? 'POST' : null;
    expect(verb, entry).not.toBeNull();
    if (verb === null) continue;
    const path = entry.slice(verb.length + 1);
    const { app } = buildServer({ surface: 'operator', modules: onDisk });
    const res = await app.inject({
      method: verb,
      url: `${BASE_PATH}${path.replaceAll(/:[A-Za-z]+/g, 'x'.repeat(8))}`,
      headers: { 'content-type': 'application/json' },
      ...(verb === 'POST' ? { payload: {} } : {}),
    });
    const body = JSON.parse(res.body) as { code?: string; title?: string };
    if (res.statusCode === 503) {
      expect(body.code, entry).toBe('service_unavailable');
      // Every call site writes this title by hand, because `server.ts`'s own
      // `TITLE` table has no `service_unavailable` key. ADR-190 section 7
      // registers that as a latent defect; this asserts the wire is right
      // whatever the table does.
      expect(body.title, entry).toBe('Service unavailable');
      unavailable.push(entry);
    } else if (res.statusCode === 401) authenticating.push(entry);
    await app.close();
  }
  // ADR-192 CLAUSE 2 MOVED THIS LINE, AND THE MOVE IS A STRENGTHENING RATHER
  // THAN A RELAXATION. ADR-190 wrote `unavailable.length > 0` because thirteen
  // routes answered 503 to this exact anonymous probe, and ADR-190 section 7
  // item 3 registered that answer as a DISCLOSURE to be repaired: it tells an
  // unauthenticated caller which of this deployment's ports are uncomposed.
  // Discharging that item empties this set, so the assertion that pinned the
  // defect is replaced by the one that refuses it -- an equality, not a bound.
  // The 503 did not leave the surface; the four write modules still send it,
  // behind authentication, and their own suites assert it there.
  expect(unavailable).toEqual([]);
  // AND `authenticating` NOW HOLDS EVERY `/admin/` ROUTE, which is the property
  // ADR-192 rules and the reason the bound above could become an equality.
  expect(authenticating).toEqual(admin);
  // And every route of THIS module is in the second set, never the first.
  for (const spec of ADMIN_READ_ENDPOINTS)
    expect(unavailable, spec.path).not.toContain(`${spec.method} ${spec.path}`);
});

test('ADR-190: nothing outside a test composes an AdminSessionSource', async () => {
  // WHY ONLY ONE OF THE TWO ANSWERS IS REACHABLE BY A BROWSER, and it is the
  // measurement the console's own prose now rests on. With no supplier for the
  // cookie, a real operator never sends one, so state A is what a deployed
  // console meets and state B needs a caller who fabricated a token.
  const roots = [join(ROOT, 'apps'), join(ROOT, 'packages'), join(ROOT, 'scripts')];
  const sources: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx|mjs)$/.test(entry.name) && !path.includes(`${sep}test${sep}`))
        sources.push(path);
    }
  };
  for (const root of roots) walk(root);
  expect(sources.length).toBeGreaterThan(100);
  const callers = sources.filter((path) => {
    const body = readFileSync(path, 'utf8')
      .replaceAll(/\/\*[\s\S]*?\*\//g, ' ')
      .replaceAll(/(?<!:)\/\/[^\n]*/g, ' ');
    return body.includes('setAdminSessionSource(');
  });
  // The declaration, and nothing else in the tree.
  expect(callers).toEqual([join(ROOT, 'apps', 'api', 'src', 'routes', 'admin-reads.ts')]);
});
