import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { BASE_PATH, PROBLEM_MEDIA_TYPE, buildServer, discoverRouteModules } from '../src/index.ts';
import adminBreaker, {
  ADMIN_BREAKER_ENDPOINTS,
  ADMIN_BREAKER_ROLE_TABLE,
  CUSUM_GAPS,
  LOSS_RATIO_GAPS,
} from '../src/routes/admin-breaker.ts';
import type { CusumResponse, LossRatioResponse } from '../src/routes/admin-breaker.ts';
import {
  ADMIN_ROLES,
  ADMIN_SESSION_COOKIE,
  setAdminReadSource,
  setAdminSessionSource,
} from '../src/routes/admin-reads.ts';
import type {
  AdminPrincipal,
  AdminReadSource,
  AdminSessionLookup,
  LiabilityResponse,
} from '../src/routes/admin-reads.ts';

// CI-02, the `unit` project.
//
// WHAT THIS SUITE IS FOR. `ADR-166` clause 10 measured that
// `GET /admin/loss-ratios` and `GET /admin/cusum` were registered by NOTHING on
// EITHER surface, and clause 14 allocated them to `P7-k`. This suite asserts
// that they now exist, that they exist on the right surface and only there, and
// that the two things they deliberately do NOT serve are absences rather than
// omissions.
//
// THE ASSERTION THAT WOULD BE WORTH THE MOST IF IT FAILED is section 4's: a
// source handing this module a fully populated `cusum` object gets `null` back,
// because `ADR-167` clause 5 says an uncalibrated statistic is not rendered and
// a pass-through is the one edit that would look like a fix.
//
// IT MEASURES REGISTRATION FROM `CompositionReport` AND NEVER FROM A GREP. A
// grep over route files has been wrong twice in this repository.

const ROOT = join(import.meta.dirname, '..', '..', '..');
const onDisk = await discoverRouteModules();

const PATHS = { lossRatios: '/admin/loss-ratios', cusum: '/admin/cusum' } as const;
const COOKIE = { cookie: `${ADMIN_SESSION_COOKIE}=operator-token` };

/**
 * A liability body with TWO plans, one paused and one not.
 *
 * Two rather than one because the projection is a `map` and a one-element
 * fixture cannot tell a projection from a constant.
 */
const LIABILITY: LiabilityResponse = {
  as_of: '2026-08-28T23:00:00Z',
  open_liability_cents: 4_215_000,
  funded_accounts: 37,
  eligible_next_7d: {
    total_cents: 1_150_000,
    account_count: 9,
    by_day: [{ trading_day: '2026-08-29', cents: 300_000, accounts: 2 }],
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
      threshold_bp: 6_000,
      sales_paused: false,
      cusum: { statistic: 2.7183, threshold: 5.5, alarm: false },
    },
    {
      plan_id: 'plan-2',
      code: 'CORE-25K',
      loss_ratio_bp: 9_400,
      threshold_bp: 6_000,
      sales_paused: true,
      cusum: { statistic: 6.25, threshold: 5.5, alarm: true },
    },
  ],
  integrations: {
    mid_health: [{ psp: 'psp-a', decline_rate_bp: 310, chargeback_rate_bp: 42, healthy: true }],
    recon: { last_run_at: '2026-08-28T22:10:00Z', mismatches_open: 0 },
    batch: { last_success_at: '2026-08-28T23:05:00Z', last_duration_ms: 41_200 },
  },
};

function sourceOf(overrides: Partial<AdminReadSource> = {}): AdminReadSource {
  return {
    searchAccounts: () => Promise.resolve({ data: [], next_cursor: null }),
    readAccount: () => Promise.resolve(null),
    readIdentityGraph: () => Promise.resolve(null),
    listFlags: () => Promise.resolve({ data: [], next_cursor: null }),
    readLiability: () => Promise.resolve(LIABILITY),
    exportEvidence: () => Promise.resolve(null),
    ...overrides,
  };
}

function sessionOf(lookup: AdminSessionLookup): { lookup: () => Promise<AdminSessionLookup> } {
  return { lookup: () => Promise.resolve(lookup) };
}

function operator(role: string): AdminSessionLookup {
  const principal: AdminPrincipal = { actorId: 'actor-1', role };
  return { kind: 'operator', principal };
}

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
// 1. They exist now, measured from CompositionReport on both surfaces
// -----------------------------------------------------------------------------

test('1.1 both paths are REGISTERED on the operator surface, which ADR-166 measured as neither', async () => {
  const { app, report } = buildServer({ surface: 'operator', modules: onDisk });
  for (const path of Object.values(PATHS)) {
    expect(report.registered).toContain(`GET ${path}`);
    expect(report.withheld).not.toContain(`GET ${path}`);
  }
  expect(report.modules).toContain('admin-breaker');
  await app.close();
});

test('1.2 both paths are WITHHELD from the public surface, and the 404 is the router s', async () => {
  const { app, report } = buildServer({ surface: 'public', modules: onDisk });
  for (const path of Object.values(PATHS)) {
    expect(report.withheld).toContain(`GET ${path}`);
    expect(report.registered).not.toContain(`GET ${path}`);
  }
  await app.close();

  // Wired, and still 404: the refusal is the ABSENCE of a route rather than a
  // check inside one, which is ADR-083 section 4 and ADR-161 clause 2.
  setAdminSessionSource(sessionOf(operator('owner')));
  setAdminReadSource(sourceOf());
  for (const path of Object.values(PATHS)) {
    const res = await get('public', path, COOKIE);
    expect(res.statusCode).toBe(404);
  }
});

test('1.3 the module registers itself, so no registry file was edited to add it', () => {
  // `registry.ts`: "SO THE MODULE LIST IS THE DIRECTORY LISTING AND IS NEVER
  // WRITTEN DOWN." Asserted rather than assumed: `discoverRouteModules` reads
  // the directory, and this module is in what came back.
  expect(onDisk.map((module) => module.name)).toContain('admin-breaker');
  expect(adminBreaker.name).toBe('admin-breaker');
  const registry = readFileSync(join(ROOT, 'apps/api/src/registry.ts'), 'utf8');
  expect(registry).not.toContain('admin-breaker');
  const start = readFileSync(join(ROOT, 'apps/api/src/start.ts'), 'utf8');
  expect(start).not.toContain('admin-breaker');
});

test('1.4 every path this module serves is declared by API_CONTRACT section 8', () => {
  const contract = readFileSync(join(ROOT, 'docs/architecture/API_CONTRACT.md'), 'utf8');
  const declared = new Set<string>();
  for (const row of contract.split('\n')) {
    if (!row.startsWith('### GET /admin')) continue;
    for (const part of row.slice('### GET '.length).split(','))
      declared.add((part.trim().split('?')[0] ?? '').trim());
  }
  for (const spec of ADMIN_BREAKER_ENDPOINTS) expect(declared).toContain(spec.path);
});

// -----------------------------------------------------------------------------
// 2. This module declares NO port, which is why wiring.test.ts's triple is still
//    its own
// -----------------------------------------------------------------------------

test('2.1 the module declares no `useX` and no `setX`, so the wiring triple does not move', () => {
  // `wiring.test.ts` reports `{declared, wired, blocked}` over every
  // `export function useX(` / `setX(` under `src/routes/`, and a new one here
  // needs a `BLOCKED` entry in THAT file. It is not this slice's, and a fence is
  // not widened to finish, so this module composes with `admin-reads.ts`'s
  // handler exactly as `admin-wallet.ts` composes with `admin-writes.ts`.
  const source = readFileSync(join(ROOT, 'apps/api/src/routes/admin-breaker.ts'), 'utf8');
  expect([...source.matchAll(/^export function ((?:use|set)[A-Za-z]+)\(/gm)]).toEqual([]);
});

test('2.2 it imports only from within this deployable, on RI-04 s rule', () => {
  const source = readFileSync(join(ROOT, 'apps/api/src/routes/admin-breaker.ts'), 'utf8');
  const specifiers = [...source.matchAll(/from '([^'\n]+)';/g)].map((match) => match[1] ?? '');
  expect(specifiers.length).toBeGreaterThan(0);
  for (const specifier of specifiers) {
    expect(specifier.startsWith('./') || specifier.startsWith('../'), specifier).toBe(true);
    expect(specifier).not.toContain('apps/');
  }
});

// -----------------------------------------------------------------------------
// 3. The guard is `admin-reads.ts`'s, which is what composing bought
// -----------------------------------------------------------------------------

test('3.1 an anonymous caller is 401 on both, before any source is consulted', async () => {
  for (const path of Object.values(PATHS)) {
    const res = await get('operator', path);
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toContain(PROBLEM_MEDIA_TYPE);
  }
});

test('3.2 a session that is not an operator s is 403, and a role outside the set is 403', async () => {
  setAdminReadSource(sourceOf());
  setAdminSessionSource(sessionOf({ kind: 'unknown' }));
  expect((await get('operator', PATHS.lossRatios, COOKIE)).statusCode).toBe(401);

  setAdminSessionSource(sessionOf(operator('marketing')));
  for (const path of Object.values(PATHS))
    expect((await get('operator', path, COOKIE)).statusCode).toBe(403);
});

test('3.3 all three roles are admitted, because section 8 gives all three the read', async () => {
  setAdminReadSource(sourceOf());
  for (const role of ADMIN_ROLES) {
    setAdminSessionSource(sessionOf(operator(role)));
    for (const path of Object.values(PATHS))
      expect((await get('operator', path, COOKIE)).statusCode, `${role} ${path}`).toBe(200);
  }
  for (const spec of ADMIN_BREAKER_ENDPOINTS) expect(spec.roles).toEqual([...ADMIN_ROLES]);
  expect(Object.keys(ADMIN_BREAKER_ROLE_TABLE)).toEqual([
    'GET /admin/loss-ratios',
    'GET /admin/cusum',
  ]);
});

// -----------------------------------------------------------------------------
// 4. THE CUSUM IS ABSENT BY RULING AND IS NOT PASSED THROUGH
// -----------------------------------------------------------------------------

test('4.1 ADR-167 clause 5: a POPULATED cusum on the source renders as null', async () => {
  // THE ASSERTION THIS FILE EXISTS FOR. `LiabilityResponse.per_plan[].cusum` is
  // NON-OPTIONAL, so the source above hands this module `{statistic: 6.25,
  // threshold: 5.5, alarm: true}` for plan-2 and it must not reach the wire.
  // DEP-M6-05 has not landed, so any statistic is uncalibrated, and FM-M6-07
  // makes an uncalibrated CUSUM "either constant alarms or none, which is the
  // same as no chart".
  setAdminSessionSource(sessionOf(operator('ops')));
  setAdminReadSource(sourceOf());
  const res = await get('operator', PATHS.cusum, COOKIE);
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body) as CusumResponse;
  expect(body.per_plan.map((plan) => plan.cusum)).toEqual([null, null]);
  // Swept over the ROWS and not over the whole body: the gap's own detail text
  // uses the word "statistic" to explain why there is not one.
  const rows = JSON.stringify(body.per_plan);
  for (const leak of ['6.25', '2.7183', 'statistic', 'threshold', 'alarm'])
    expect(rows.includes(leak), `the cusum object leaked ${leak}`).toBe(false);
  expect(Object.keys(body.per_plan[0] ?? {})).toEqual(['plan_id', 'code', 'cusum']);
});

test('4.2 the absence names its blocker, so a reader is not left to guess', async () => {
  setAdminSessionSource(sessionOf(operator('ops')));
  setAdminReadSource(sourceOf());
  const body = JSON.parse((await get('operator', PATHS.cusum, COOKIE)).body) as CusumResponse;
  expect(body.gaps).toEqual(CUSUM_GAPS);
  expect(body.gaps.map((gap) => gap.field)).toEqual(['per_plan[].cusum']);
  expect(body.gaps[0]?.awaiting).toBe('DEP-M6-05');
  expect(body.as_of).toBe(LIABILITY.as_of);
  expect(body.per_plan.map((plan) => plan.plan_id)).toEqual(['plan-1', 'plan-2']);
});

test('4.3 M06 still lists P-M6-06 as blocked on DEP-M6-05, so the absence is not stale', () => {
  const m06 = readFileSync(join(ROOT, 'docs/plans/M06-admin-ops-console.md'), 'utf8');
  const row = m06.split('\n').find((line) => line.includes('| DEP-M6-05 |'));
  expect(row, 'DEP-M6-05 left M06 section 12').toBeDefined();
  expect(row).toContain('Wave 4');
  expect(row).toContain('mu_0');
  // The console's own disposition, which this endpoint mirrors rather than
  // contradicts: a second surface drawing the chart apps/admin refuses to draw
  // would be the same failure with a different renderer.
  const page = readFileSync(join(ROOT, 'apps/admin/src/page.ts'), 'utf8');
  expect(page).toContain('P-M6-06');
  expect(page).toContain('DEP-M6-05');
});

// -----------------------------------------------------------------------------
// 5. The loss ratios, and the two gaps the port cannot close
// -----------------------------------------------------------------------------

test('5.1 the three contract fields are projected per plan, from the SAME read', async () => {
  let reads = 0;
  setAdminSessionSource(sessionOf(operator('readonly')));
  setAdminReadSource(
    sourceOf({
      readLiability: () => {
        reads += 1;
        return Promise.resolve(LIABILITY);
      },
    }),
  );
  const res = await get('operator', PATHS.lossRatios, COOKIE);
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body) as LossRatioResponse;
  expect(reads).toBe(1);
  expect(body.per_plan).toHaveLength(2);
  expect(body.per_plan[0]).toMatchObject({
    plan_id: 'plan-1',
    code: 'MERIT-50K',
    loss_ratio_bp: 4_120,
    threshold_bp: 6_000,
    sales_paused: false,
  });
  expect(body.per_plan[1]?.sales_paused).toBe(true);
  expect(body.as_of).toBe(LIABILITY.as_of);
});

test('5.2 INV-M6-07: the sample size sits beside every ratio, as a stated absence', async () => {
  setAdminSessionSource(sessionOf(operator('ops')));
  setAdminReadSource(sourceOf());
  const body = JSON.parse(
    (await get('operator', PATHS.lossRatios, COOKIE)).body,
  ) as LossRatioResponse;
  // NOT OMITTED. A body with no field reads as a ratio that never had a sample
  // size; this one has a sample size that has not reached the port yet.
  for (const plan of body.per_plan) {
    expect(Object.keys(plan)).toContain('sample_size');
    expect(plan.sample_size).toBeNull();
  }
  expect(body.gaps).toEqual(LOSS_RATIO_GAPS);
  expect(body.gaps.map((gap) => gap.field)).toEqual(['per_plan[].sample_size', 'per_plan[].state']);
});

test('5.3 the gap is pinned to the type that has to move, so it goes red when it does', () => {
  // A REGISTER OF WHAT IS OWED, in `admin-reads.test.ts`'s unserved-list idiom.
  // When `LiabilityResponse.per_plan` gains `sample_size`, this assertion fails
  // and whoever added it is standing in front of the two `null`s above.
  const adminReads = readFileSync(join(ROOT, 'apps/api/src/routes/admin-reads.ts'), 'utf8');
  const perPlan = /readonly per_plan: readonly \{[\s\S]*?\}\[\];/.exec(adminReads)?.[0] ?? '';
  expect(perPlan, 'LiabilityResponse.per_plan moved or was reshaped').not.toBe('');
  expect(perPlan).not.toContain('sample_size');
  expect(perPlan).not.toContain('min_sample');
  expect(perPlan).not.toContain('insufficient_data');
  // And the contract says the same thing in its own words.
  const contract = readFileSync(join(ROOT, 'docs/architecture/API_CONTRACT.md'), 'utf8');
  expect(contract).toContain(
    'an `insufficient_data` state that no field on\n`LiabilityResponse.per_plan` carries today',
  );
});

test('5.4 sales_paused is carried verbatim and is never derived from anything else', async () => {
  setAdminSessionSource(sessionOf(operator('ops')));
  setAdminReadSource(
    sourceOf({
      readLiability: () =>
        Promise.resolve({
          ...LIABILITY,
          // A plan whose ratio is ABOVE its threshold and which the breaker has
          // NOT paused, which is what `insufficient_data` looks like from here.
          per_plan: [{ ...LIABILITY.per_plan[1], sales_paused: false } as never],
        }),
    }),
  );
  const body = JSON.parse(
    (await get('operator', PATHS.lossRatios, COOKIE)).body,
  ) as LossRatioResponse;
  expect(body.per_plan[0]?.loss_ratio_bp).toBeGreaterThan(body.per_plan[0]?.threshold_bp ?? 0);
  expect(body.per_plan[0]?.sales_paused).toBe(false);
});

// -----------------------------------------------------------------------------
// 6. Section 1's rules, which composing gave this module for free
// -----------------------------------------------------------------------------

test('6.1 both are cursor-free and cached for 60 seconds, privately', async () => {
  setAdminSessionSource(sessionOf(operator('owner')));
  setAdminReadSource(sourceOf());
  for (const path of Object.values(PATHS)) {
    const res = await get('operator', path, COOKIE);
    expect(res.headers['cache-control']).toBe('private, max-age=60');
    expect(res.body).not.toContain('next_cursor');
  }
});

test('6.2 a float in a `_bp` field is refused rather than served, by the shared sweep', async () => {
  setAdminSessionSource(sessionOf(operator('owner')));
  setAdminReadSource(
    sourceOf({
      readLiability: () =>
        Promise.resolve({
          ...LIABILITY,
          per_plan: [{ ...LIABILITY.per_plan[0], loss_ratio_bp: 4_120.5 } as never],
        }),
    }),
  );
  const res = await get('operator', PATHS.lossRatios, COOKIE);
  expect(res.statusCode).toBe(500);
  expect(JSON.parse(res.body)).toMatchObject({ code: 'internal_error' });
});

test('6.3 no gap field is named for a day, because the sweep would read it as one', () => {
  // `assertContractScalars` refuses any `_on` or `_day` key that is not a
  // YYYY-MM-DD trading day, so `blocked_on` would have turned every one of
  // these bodies into a 500. The name moved rather than the sweep.
  for (const gap of [...LOSS_RATIO_GAPS, ...CUSUM_GAPS]) {
    expect(Object.keys(gap)).toEqual(['field', 'awaiting', 'detail']);
    for (const key of Object.keys(gap)) expect(key).not.toMatch(/_(?:day|on)$/);
  }
});

test('6.4 a source with nothing to read is 404 and not an empty chart', async () => {
  setAdminSessionSource(sessionOf(operator('owner')));
  setAdminReadSource(sourceOf({ readLiability: () => Promise.resolve(null) }));
  for (const path of Object.values(PATHS))
    expect((await get('operator', path, COOKIE)).statusCode).toBe(404);
});
