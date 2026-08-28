// =============================================================================
// apps/api/test/admin-writes.test.ts
// =============================================================================
// WHAT THIS SUITE IS FOR, IN ONE SENTENCE: an admin write with no reason is
// refused, THE REFUSAL COMES FROM THE DATABASE, and the same call carrying a
// reason succeeds. Both halves, because a guard that refuses everything passes
// every refusal test -- which is `packages/db/DELTA_MANIFEST.md` section 13's
// lesson and one this project has already paid for.
//
// -----------------------------------------------------------------------------
// THE DATABASE HALF RUNS AGAINST A REAL POSTGRES OR IT DOES NOT RUN
// -----------------------------------------------------------------------------
// `describe.skipIf` and not a fake. A recorder can prove which door was opened
// and which values were written; it CANNOT prove that `NOT NULL` refuses, and a
// suite that asserted the refusal against its own fake would be agreeing with
// itself. So the reason cases need `DATABASE_URL` pointed at a database with
// `packages/db/migrations` applied, and they SKIP LOUDLY when there is none.
//
// `ci.yml`'s CI-04 job has no database (ADR-085 rules that deliberately: a Neon
// branch per run is CI-04's second leg and keeps its dated condition), so these
// cases skip in CI today and were run by hand for session 257 against
// PostgreSQL 16.13 with all 47 migrations applied. **THEY BELONG IN THE
// `integration` PROJECT** -- a `*.integration.test.ts` file -- and moving them
// there is owed to whoever wires CI-04's second leg. This session's fence names
// one test file, so the need is stated here rather than taken.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TABLE_KEYS, closeClient, systemDb, transaction } from '@merit/db';
import type { SystemTx, TableKey } from '@merit/db';

import adminWrites, {
  ADMIN_ROLES,
  ADMIN_WRITE_ENDPOINTS,
  ADMIN_WRITE_ROLES,
  ADMIN_WRITE_TABLES,
  DUAL_CONTROL_WINDOW_MS,
  AdminWriteUnwired,
  resetAdminWriteBackend,
  sensitivePayloadHash,
  useAdminWriteBackend,
} from '../src/routes/admin-writes.ts';
import type {
  AdminPrincipal,
  AdminRole,
  AdminWriteBackend,
  AdminWriteTx,
  PlanValidation,
} from '../src/routes/admin-writes.ts';
import { discoverRouteModules } from '../src/registry.ts';
import { buildServer } from '../src/server.ts';
import { BASE_PATH } from '../src/surface.ts';

const AT = new Date('2026-08-27T12:00:00.000Z');
const TRADING_DAY = '2026-08-27';

/** Every route in the module, as `METHOD /path`. */
const ENDPOINTS = ADMIN_WRITE_ENDPOINTS.map((spec) => `${spec.method} ${spec.path}`);

afterEach(() => {
  resetAdminWriteBackend();
});

// -----------------------------------------------------------------------------
// 0. The list of tables this module names is a list of tables that exist
// -----------------------------------------------------------------------------
// The module holds no `@merit/db` import (`src/db.ts` is this deployable's one
// door onto it), so `AdminWriteTable` is a hand-written union. THE BINDING IS
// HERE, where `@merit/db` is reachable: the annotation is the compile-time half
// and the loop is the run-time one, on `ADR-112`'s own reason for checking
// uniqueness at run time rather than encoding it.

describe('the tables the module names', () => {
  it('are all keys packages/db registers', () => {
    const keys: readonly TableKey[] = ADMIN_WRITE_TABLES;
    for (const key of keys) expect(TABLE_KEYS).toContain(key);
  });
});

// -----------------------------------------------------------------------------
// 0b. THE MODULE LOADS UNDER THE RUNTIME THAT ACTUALLY SERVES IT
// -----------------------------------------------------------------------------
// **VITEST TRANSPILES AND THE DEPLOYABLE DOES NOT.** `apps/api`'s `start` script
// is `node --experimental-strip-types src/start.ts`, which ERASES types rather
// than compiling them, so a construct needing emitted code -- a constructor
// parameter property, an `enum`, a namespace, a decorator -- type-checks, passes
// under Vitest, and throws `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` when the process
// starts. `discoverRouteModules` imports EVERY file in `routes/`, so one of them
// takes the whole deployable down.
//
// This suite shipped with exactly that defect and every other assertion in it
// was green. The check is here rather than left to a deploy.
//
// **IT COVERS THIS FILE AND NOT THE OTHERS.** The general form belongs in
// `repo-invariants.mjs`, over every module in `routes/`, and that file is
// outside this session's fence; the need is named in ADR-145's owed table.

describe('the runtime that actually serves this module', () => {
  it('imports it under `node --experimental-strip-types`, which does not transpile', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const module = join(here, '..', 'src', 'routes', 'admin-writes.ts');
    const out = execFileSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--input-type=module',
        '-e',
        `const m = await import(${JSON.stringify(module)});
         if (typeof m.default?.name !== 'string') throw new Error('no route module');
         process.stdout.write(m.default.name);`,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(out).toBe('admin-writes');
  });
});

// -----------------------------------------------------------------------------
// 1. THE SURFACE BOUNDARY
// -----------------------------------------------------------------------------
// ADR-083 section 4: the public deployment answers 404 for an operator path BY
// HAVING NOTHING THERE. `withheld` being non-empty is the mechanism and the 404
// is the consequence, so both are asserted rather than one standing in for the
// other.

describe('the surface boundary', () => {
  it('withholds every route from the public deployment', () => {
    const { report } = buildServer({ surface: 'public', modules: [adminWrites] });
    expect(report.registered).toEqual([]);
    expect([...report.withheld].sort()).toEqual([...ENDPOINTS].sort());
  });

  it('registers every route on the operator deployment', () => {
    const { report } = buildServer({ surface: 'operator', modules: [adminWrites] });
    expect(report.withheld).toEqual([]);
    expect([...report.registered].sort()).toEqual([...ENDPOINTS].sort());
  });

  it('answers 404 on the public origin, from the router and not from a check', async () => {
    const { app } = buildServer({ surface: 'public', modules: [adminWrites] });
    // NO BACKEND IS INSTALLED. If this 404 came from a permission check the
    // check would have needed a principal, and asking for one would have thrown
    // `AdminWriteUnwired` and answered 401 (ADR-192 clause 2). A 404 here
    // therefore proves the route was never registered.
    const response = await app.inject({
      method: 'POST',
      url: `${BASE_PATH}/admin/accounts/${ACCOUNT_ID}/freeze`,
      payload: { reason: 'r', initiative: 'operational', tos_clause: '4.2', flag_ids: [FLAG_ID] },
    });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ code: 'not_found', status: 404 });
    await app.close();
  });
});

// -----------------------------------------------------------------------------
// 2. THE ROLE CHECK IS NOT VACUOUS
// -----------------------------------------------------------------------------
// `INV-M6-09`: "`readonly` cannot mutate anything, and `ops` cannot change
// config, roles, or plan versions." Three assertions, and the second and third
// are what stop the first from being a guard that refuses everybody.

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const IDENTITY_ID = '22222222-2222-4222-8222-222222222222';
const FLAG_ID = '33333333-3333-4333-8333-333333333333';
const PLAN_ID = '44444444-4444-4444-8444-444444444444';
const VERSION_ID = '55555555-5555-4555-8555-555555555555';
const PACK_ID = '66666666-6666-4666-8666-666666666666';

/** A body that is valid for whichever route it is sent to. */
function bodyFor(path: string): Record<string, unknown> {
  const envelope = { reason: 'ticket 4711: chargeback representment', initiative: 'operational' };
  if (path.endsWith('/freeze')) return { ...envelope, tos_clause: '4.2', flag_ids: [FLAG_ID] };
  if (path.endsWith('/unfreeze')) return { ...envelope, resolution_note: 'cleared' };
  if (path.endsWith('/close')) return { ...envelope, kind: 'operational' };
  if (path.endsWith('/note')) return { ...envelope, note: 'called the trader' };
  if (path.endsWith('/status')) return { ...envelope, to_status: 'dismissed', note: 'no case' };
  if (path.endsWith('/versions'))
    return {
      ...envelope,
      rules: RULES,
      copy_blocks: {},
      public_slug: 'core-eod-v2',
      sizes: [SIZE_BODY],
    };
  return { ...envelope, simulation_waiver_reason: 'launch candidate, ADR-005' };
}

function urlFor(path: string): string {
  return (
    BASE_PATH +
    path
      .replace(':accountId', ACCOUNT_ID)
      .replace(':flagId', FLAG_ID)
      .replace(':planId', PLAN_ID)
      .replace(':versionId', VERSION_ID)
  );
}

const RULES = {
  schema_version: 1,
  phase_eval: { enabled: true },
  phase_funded: {
    payout_cap_schedule: [{ from_ordinal: 1, cap_bp: 5000 }],
    split_bp: 9000,
    cadence_gap_trading_days: 3,
  },
};

const SIZE_BODY = {
  size_cents: 5_000_000,
  price_cents: 16_500,
  reset_price_cents: 12_500,
  drawdown_cents: 250_000,
  buffer_cents: 0,
  win_day_floor_cents: 5_000,
  payout_cap_schedule_cents: [{ from_ordinal: 1, cap_cents: 250_000 }],
  floor_lock_enabled: false,
};

/** One write the fake transaction saw. */
interface Written {
  readonly kind: 'insert' | 'update';
  readonly table: string;
  readonly values: Record<string, unknown>;
}

function fakeBackend(
  role: AdminRole,
  written: Written[] = [],
  approvals: readonly unknown[] = [],
): AdminWriteBackend {
  const account = {
    id: ACCOUNT_ID,
    identityId: IDENTITY_ID,
    status: 'active',
    phase: 'funded',
    payoutsFrozen: false,
    closedOn: null,
    closeReason: null,
  };
  const flag = { id: FLAG_ID, identityId: IDENTITY_ID, status: 'open' };
  const version = { id: VERSION_ID, planId: PLAN_ID, version: 1, status: 'draft', rules: RULES };
  const tx: AdminWriteTx = {
    rowAt: (table) => {
      if (table === 'accounts') return Promise.resolve(account);
      if (table === 'riskFlags') return Promise.resolve(flag);
      if (table === 'planVersions') return Promise.resolve(version);
      if (table === 'plans') return Promise.resolve({ id: PLAN_ID, code: 'core_eod' });
      if (table === 'evidencePacks') return Promise.resolve({ id: PACK_ID });
      return Promise.resolve(undefined);
    },
    rowsWhere: (table) => {
      if (table === 'riskFlags') return Promise.resolve([flag]);
      if (table === 'planVersions') return Promise.resolve([version]);
      if (table === 'dualControlApprovals') return Promise.resolve([...approvals]);
      return Promise.resolve([]);
    },
    insert: (table, values) => {
      written.push({ kind: 'insert', table, values: { ...values } });
      return Promise.resolve([values]);
    },
    updateAt: (table, _at, values) => {
      written.push({ kind: 'update', table, values: { ...values } });
      return Promise.resolve([values]);
    },
  };
  const principal: AdminPrincipal = { actor: `sso:${role}@merit`, role };
  return {
    operator: (fn) => fn(tx),
    principal: () => Promise.resolve(principal),
    validatePlan: (): PlanValidation => ({ ok: true, errors: [] }),
    now: () => AT,
    tradingDay: () => TRADING_DAY,
  };
}

async function callAs(
  role: AdminRole,
  spec: (typeof ADMIN_WRITE_ENDPOINTS)[number],
  written: Written[] = [],
  body?: Record<string, unknown>,
  approvals: readonly unknown[] = [],
): Promise<{ statusCode: number; json: () => unknown }> {
  useAdminWriteBackend(fakeBackend(role, written, approvals));
  const { app } = buildServer({ surface: 'operator', modules: [adminWrites] });
  const response = await app.inject({
    method: 'POST',
    url: urlFor(spec.path),
    payload: body ?? bodyFor(spec.path),
  });
  await app.close();
  return response;
}

describe('the role check', () => {
  it('declares owner and ops on the five account actions and owner alone on the two plan rows', () => {
    expect(ADMIN_WRITE_ROLES).toEqual({
      'POST /admin/accounts/:accountId/freeze': ['owner', 'ops'],
      'POST /admin/accounts/:accountId/unfreeze': ['owner', 'ops'],
      'POST /admin/accounts/:accountId/close': ['owner', 'ops'],
      'POST /admin/accounts/:accountId/note': ['owner', 'ops'],
      'POST /admin/flags/:flagId/status': ['owner', 'ops'],
      'POST /admin/plans/:planId/versions': ['owner'],
      'POST /admin/plans/versions/:versionId/publish': ['owner'],
    });
    // `readonly` is in the vocabulary and in none of the seven.
    expect(ADMIN_ROLES).toContain('readonly');
    for (const roles of Object.values(ADMIN_WRITE_ROLES)) expect(roles).not.toContain('readonly');
  });

  it('refuses a readonly principal every one of the seven writes', async () => {
    for (const spec of ADMIN_WRITE_ENDPOINTS) {
      const written: Written[] = [];
      const response = await callAs('readonly', spec, written);
      expect([spec.path, response.statusCode]).toEqual([spec.path, 403]);
      expect(response.json()).toMatchObject({ code: 'forbidden' });
      // THE REFUSAL IS BEFORE THE TRANSACTION, so nothing was written at all.
      expect(written).toEqual([]);
    }
  });

  it('refuses ops the two plan rows and allows it the other five', async () => {
    for (const spec of ADMIN_WRITE_ENDPOINTS) {
      const response = await callAs('ops', spec);
      const isPlanRow = spec.path.startsWith('/admin/plans');
      expect([spec.path, response.statusCode === 403]).toEqual([spec.path, isPlanRow]);
    }
  });

  it('allows an owner past the role gate on every one of the seven', async () => {
    for (const spec of ADMIN_WRITE_ENDPOINTS) {
      const response = await callAs('owner', spec);
      // NOT `toBe(200)`. Six of the seven succeed on this fixture; the seventh
      // is `publish`, which then meets ADR-010's dual control and answers 412.
      // Asserting 200 across the board would have been a test that could only
      // pass by the dual-control gate being absent.
      expect([spec.path, response.statusCode]).not.toEqual([spec.path, 403]);
      const expected = spec.path.endsWith('/publish') ? 412 : 200;
      expect([spec.path, response.statusCode]).toEqual([spec.path, expected]);
    }
  });
});

// -----------------------------------------------------------------------------
// 2b. DUAL CONTROL ON PUBLISH, AND THE PAYLOAD HASH THAT BINDS IT
// -----------------------------------------------------------------------------
// ADR-010, `SD-M6-05`, `INV-M6-08`. The refusal and the pass are asserted
// together for THE CLAUSE's own reason: a gate that refused every publish would
// pass the refusal case on its own.

function approval(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const requestedAt = new Date(AT.getTime() - 60 * 60 * 1000);
  return {
    subjectKind: 'plan_version',
    subjectId: VERSION_ID,
    status: 'approved',
    requestedBy: 'sso:owner@merit',
    approvedBy: 'sso:second-owner@merit',
    requestedAt,
    approvedAt: new Date(AT.getTime() - 30 * 60 * 1000),
    expiresAt: new Date(requestedAt.getTime() + DUAL_CONTROL_WINDOW_MS),
    payloadHash: Buffer.from(sensitivePayloadHash(VERSION_ID, RULES), 'hex'),
    ...overrides,
  };
}

const PUBLISH = ADMIN_WRITE_ENDPOINTS[6]!;

// GS-314, "one owner publishes and a second has not approved", and the row's
// expectation is that it is BLOCKED until a second owner approves THE SAME
// PAYLOAD HASH, on M06 section 3.4's existing machine and ADR-010's sensitive
// set. The seven cases below are that row in both directions: a publish with no
// approval recorded answers 412 and writes nothing, a publish a second owner
// approved writes the audit row and then the version, and an approval of a
// DIFFERENT payload is refused, which is the case the payload hash exists for
// and which a suite asserting only the happy pair would have passed without.
// The window, the withdrawal and the wrong-approver refusals close the rest.
//
// THE SENSITIVE-SET HALF IS ASSERTED BY THE RESPONSE ITSELF, `dual_control_
// required: true` on the publish that succeeds, so a publish that stopped being
// sensitive would not pass quietly.
describe('dual control on publish', () => {
  it('refuses when no approval is recorded', async () => {
    const written: Written[] = [];
    const response = await callAs('owner', PUBLISH, written, undefined, []);
    expect(response.statusCode).toBe(412);
    expect(response.json()).toMatchObject({ code: 'precondition_failed' });
    expect(written).toEqual([]);
  });

  it('publishes when a second owner approved THIS payload', async () => {
    const written: Written[] = [];
    const response = await callAs('owner', PUBLISH, written, undefined, [approval()]);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      plan_version_id: VERSION_ID,
      status: 'published',
      dual_control_required: true,
    });
    expect(written[0]).toMatchObject({ kind: 'insert', table: 'adminActions' });
    expect(written[1]).toMatchObject({ kind: 'update', table: 'planVersions' });
  });

  it('refuses an approval of a DIFFERENT payload, which is what the hash is for', async () => {
    const otherRules = {
      ...RULES,
      phase_funded: { ...RULES.phase_funded, split_bp: 8000 },
    };
    const response = await callAs('owner', PUBLISH, [], undefined, [
      approval({ payloadHash: Buffer.from(sensitivePayloadHash(VERSION_ID, otherRules), 'hex') }),
    ]);
    expect(response.statusCode).toBe(412);
  });

  it('refuses an approval opened with a window longer than 24 hours', async () => {
    const requestedAt = new Date(AT.getTime() - 60 * 60 * 1000);
    const response = await callAs('owner', PUBLISH, [], undefined, [
      approval({
        requestedAt,
        expiresAt: new Date(requestedAt.getTime() + DUAL_CONTROL_WINDOW_MS + 1000),
      }),
    ]);
    expect(response.statusCode).toBe(412);
  });

  it('refuses an approval whose window has passed', async () => {
    const requestedAt = new Date(AT.getTime() - 48 * 60 * 60 * 1000);
    const response = await callAs('owner', PUBLISH, [], undefined, [
      approval({
        requestedAt,
        approvedAt: requestedAt,
        expiresAt: new Date(requestedAt.getTime() + DUAL_CONTROL_WINDOW_MS),
      }),
    ]);
    expect(response.statusCode).toBe(412);
  });

  it('refuses a withdrawn approval', async () => {
    const response = await callAs('owner', PUBLISH, [], undefined, [
      approval({ status: 'withdrawn', approvedBy: null, approvedAt: null }),
    ]);
    expect(response.statusCode).toBe(412);
  });

  it('refuses a publish whose `second_approver` is not the operator who approved', async () => {
    const response = await callAs(
      'owner',
      PUBLISH,
      [],
      { ...bodyFor(PUBLISH.path), second_approver: 'sso:someone-else@merit' },
      [approval()],
    );
    expect(response.statusCode).toBe(412);
  });
});

// -----------------------------------------------------------------------------
// 3. THE UNWIRED DEPLOYMENT
// -----------------------------------------------------------------------------

describe('the unwired backend', () => {
  // ADR-192 clause 2. THE 503 DID NOT GO AWAY; IT MOVED BEHIND THE 401. An
  // anonymous caller may not learn which of this deployment's ports are
  // uncomposed, so `principal`'s refusal is answered 401; every other port
  // member's refusal is answered 503, because a caller who reached it is
  // authenticated. Both legs are asserted, and the second is the one that would
  // pass by accident if the module simply stopped sending 503 at all.
  it('answers 401 and not 503 to an anonymous caller, disclosing no deployment state', async () => {
    for (const spec of ADMIN_WRITE_ENDPOINTS) {
      resetAdminWriteBackend();
      const { app } = buildServer({ surface: 'operator', modules: [adminWrites] });
      const response = await app.inject({
        method: spec.method,
        url: urlFor(spec.path),
        payload: bodyFor(spec.path),
      });
      await app.close();
      expect([spec.path, response.statusCode]).toEqual([spec.path, 401]);
      expect([spec.path, (response.json() as { code: string }).code]).toEqual([
        spec.path,
        'unauthenticated',
      ]);
    }
  });

  it('answers 503 to an authenticated operator whose deployment wired no `operator`', async () => {
    const role: AdminRole = 'owner';
    useAdminWriteBackend({
      ...fakeBackend(role, [], []),
      operator: () => Promise.reject(new AdminWriteUnwired('operator')),
    });
    const { app } = buildServer({ surface: 'operator', modules: [adminWrites] });
    const response = await app.inject({
      method: 'POST',
      url: urlFor('/admin/accounts/:accountId/note'),
      payload: { reason: 'r', initiative: 'operational', note: 'n' },
    });
    await app.close();
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'service_unavailable' });
  });

  it('never answers 503 before authenticating, on any route of this module', async () => {
    // The counterfactual for the case above: a module that answered 503 to an
    // anonymous caller on ONE route would still pass both cases above if that
    // route were not the one they inject.
    for (const spec of ADMIN_WRITE_ENDPOINTS) {
      resetAdminWriteBackend();
      const { app } = buildServer({ surface: 'operator', modules: [adminWrites] });
      const response = await app.inject({
        method: spec.method,
        url: urlFor(spec.path),
        payload: bodyFor(spec.path),
      });
      await app.close();
      expect([spec.path, response.statusCode]).not.toEqual([spec.path, 503]);
    }
  });
});

// -----------------------------------------------------------------------------
// 4. THE DISCLOSURE, OVER THE WHOLE OPERATOR SURFACE AND NOT OVER THIS MODULE
// -----------------------------------------------------------------------------
// ADR-192 clause 2 is a property of the SURFACE, and four modules each behaving
// well is not the same thing as the surface holding it. THIS SWEEP IS THE
// CONTROL. It composes every module on disk, injects every route the operator
// deployment registers with no credential of any kind, and refuses a 503. A
// module added tomorrow that answers 503 before authenticating is caught here
// rather than by the next person to measure the surface by hand, which is how
// the split ADR-190 found survived three sessions reporting one half of it.
//
// IT PINS NO COUNT, on ADR-190 section 5's ground: a slice that wires a backend
// moves a route between the answers, and a test holding a number would go red
// for the right thing happening. What it asserts is the property.

describe('no operator route discloses its deployment state to an anonymous caller', () => {
  it('answers no 503 anywhere on the surface before authenticating', async () => {
    const modules = await discoverRouteModules();
    const { app, report } = buildServer({ surface: 'operator', modules });
    await app.ready();
    const disclosed: string[] = [];
    const admin: string[] = [];
    for (const endpoint of report.registered) {
      const [method = '', declared = ''] = endpoint.split(' ');
      const url = `${BASE_PATH}${declared.replace(/:[A-Za-z0-9_]+/g, ACCOUNT_ID)}`;
      const carries = method !== 'GET' && method !== 'DELETE' && method !== 'HEAD';
      const response = await app.inject({
        method: method as 'GET',
        url,
        ...(carries ? { payload: {} } : {}),
      });
      if (response.statusCode === 503) disclosed.push(endpoint);
      if (declared.startsWith('/admin/')) admin.push(`${endpoint} -> ${response.statusCode}`);
    }
    await app.close();
    expect(disclosed).toEqual([]);
    // THE COUNTERFACTUAL. A sweep that injected nothing would report no
    // disclosure, so the `/admin/*` routes are listed with what they answered
    // and every one of them must be a 401. This is also the assertion that
    // fails if a future module answers 500 before authenticating, which
    // discloses the same fact by a different number.
    expect(admin.length).toBeGreaterThan(0);
    expect(admin.filter((row) => !row.endsWith(' -> 401'))).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// 5. THE MODULE CARRIES THE ABSENCE OF A REASON RATHER THAN FILLING IT
// -----------------------------------------------------------------------------
// This is the half a recorder CAN prove, and it is the half that matters for
// reading the diff: no `reason` key reaches the accessor when the body carried
// none, and no placeholder is substituted for it. The database half is section
// 5, where the consequence of that absence is measured.

describe('the reason, before it reaches the database', () => {
  it('writes the audit row FIRST, ahead of the mutation', async () => {
    const written: Written[] = [];
    await callAs('owner', ADMIN_WRITE_ENDPOINTS[0]!, written);
    expect(written[0]).toMatchObject({ kind: 'insert', table: 'adminActions' });
    expect(written[1]).toMatchObject({ kind: 'update', table: 'accounts' });
  });

  it('omits `reason` from the write when the body omitted it', async () => {
    const written: Written[] = [];
    await callAs('owner', ADMIN_WRITE_ENDPOINTS[3]!, written, {
      initiative: 'operational',
      note: 'called the trader',
    });
    const audit = written.find((row) => row.table === 'adminActions');
    expect(audit).toBeDefined();
    expect(Object.keys(audit!.values)).not.toContain('reason');
  });

  it('omits `initiative` from the write when the body omitted it', async () => {
    const written: Written[] = [];
    await callAs('owner', ADMIN_WRITE_ENDPOINTS[3]!, written, {
      reason: 'ticket 4711',
      note: 'called the trader',
    });
    const audit = written.find((row) => row.table === 'adminActions');
    expect(Object.keys(audit!.values)).not.toContain('initiative');
  });

  it('carries a supplied reason verbatim, unmodified', async () => {
    const written: Written[] = [];
    const reason = '  ticket 4711: chargeback representment, per RB-03  ';
    await callAs('owner', ADMIN_WRITE_ENDPOINTS[3]!, written, {
      reason,
      initiative: 'operational',
      note: 'n',
    });
    const audit = written.find((row) => row.table === 'adminActions');
    expect(audit!.values['reason']).toBe(reason);
  });

  it('refuses an empty reason HERE, because NOT NULL cannot see one', async () => {
    const written: Written[] = [];
    const response = await callAs('owner', ADMIN_WRITE_ENDPOINTS[3]!, written, {
      reason: '   ',
      initiative: 'operational',
      note: 'n',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'validation_failed',
      errors: [{ path: 'reason' }],
    });
    expect(written).toEqual([]);
  });

  it('refuses a freeze that cites no open flag, and writes nothing', async () => {
    const written: Written[] = [];
    const response = await callAs('owner', ADMIN_WRITE_ENDPOINTS[0]!, written, {
      reason: 'ticket 4711',
      initiative: 'operational',
      tos_clause: '4.2',
      flag_ids: [],
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ errors: [{ path: 'flag_ids' }] });
    expect(written).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// 6. THE CLAUSE, AGAINST A REAL DATABASE
// -----------------------------------------------------------------------------

const DATABASE_URL = process.env['DATABASE_URL'];

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'the reason, at the database',
  () => {
    /** Ids minted per case so the cases do not share rows. */
    let seeded: { accountId: string; identityId: string; flagId: string };

    async function seed(): Promise<typeof seeded> {
      return await transaction(systemDb('operator-console'), async (tx: SystemTx) => {
        const stamp = String(Date.now()) + String(Math.round(Math.random() * 1e6));
        const identity = one(await tx.insert('identities', { displayName: `seed ${stamp}` }));
        const user = one(
          await tx.insert('users', {
            identityId: identity['id'],
            email: `seed-${stamp}@example.test`,
            emailNormalized: `seed-${stamp}@example.test`,
          }),
        );
        const plan = one(
          await tx.insert('plans', { code: `seed_${stamp}`, name: `Seed ${stamp}` }),
        );
        const version = one(
          await tx.insert('planVersions', {
            planId: plan['id'],
            version: 1,
            status: 'draft',
            rules: RULES,
            publicSlug: `seed-${stamp}`,
            createdBy: 'seed',
          }),
        );
        const purchase = one(
          await tx.insert('purchases', {
            identityId: identity['id'],
            userId: user['id'],
            planVersionId: version['id'],
            sizeCents: 5_000_000n,
            kind: 'new',
            listPriceCents: 16_500n,
            amountPaidCents: 16_500n,
            psp: 'psp_a',
            pspReference: `seed-${stamp}`,
          }),
        );
        const account = one(
          await tx.insert('accounts', {
            identityId: identity['id'],
            userId: user['id'],
            purchaseId: purchase['id'],
            planVersionId: version['id'],
            sizeCents: 5_000_000n,
            phase: 'funded',
            status: 'active',
            openedOn: TRADING_DAY,
            fundedOn: TRADING_DAY,
          }),
        );
        const flag = one(
          await tx.insert('riskFlags', {
            identityId: identity['id'],
            accountId: account['id'],
            flagType: 'payment_velocity',
            severity: 3,
            evidence: { seeded: true },
            firstDetectedOn: TRADING_DAY,
          }),
        );
        return {
          accountId: String(account['id']),
          identityId: String(identity['id']),
          flagId: String(flag['id']),
        };
      });
    }

    function one(rows: unknown[]): Record<string, unknown> {
      const row = rows[0];
      if (typeof row !== 'object' || row === null) throw new Error('insert returned no row');
      return row as Record<string, unknown>;
    }

    /** The real door, adapted to the module's port. NOTHING ELSE IS FAKED. */
    function liveBackend(role: AdminRole): AdminWriteBackend {
      return {
        operator: (fn) =>
          transaction(systemDb('operator-console'), (tx: SystemTx) =>
            fn({
              rowAt: (key, at) => tx.rowAt(key, at),
              rowsWhere: (key, where) => tx.rowsWhere(key, where),
              insert: (key, values) => tx.insert(key, values),
              updateAt: (key, at, values) => tx.updateAt(key, at, values),
            }),
          ),
        principal: () => Promise.resolve({ actor: `sso:${role}@merit`, role }),
        validatePlan: (): PlanValidation => ({ ok: true, errors: [] }),
        now: () => AT,
        tradingDay: () => TRADING_DAY,
      };
    }

    async function freeze(body: Record<string, unknown>): Promise<{
      statusCode: number;
      json: () => unknown;
    }> {
      useAdminWriteBackend(liveBackend('owner'));
      const { app } = buildServer({ surface: 'operator', modules: [adminWrites] });
      const response = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/admin/accounts/${seeded.accountId}/freeze`,
        payload: body,
      });
      await app.close();
      return response;
    }

    async function auditRows(): Promise<Record<string, unknown>[]> {
      return await transaction(systemDb('operator-console'), async (tx: SystemTx) => {
        const rows = await tx.rowsWhere('adminActions', { subjectId: seeded.accountId });
        return rows as Record<string, unknown>[];
      });
    }

    async function accountRow(): Promise<Record<string, unknown>> {
      return await transaction(systemDb('operator-console'), async (tx: SystemTx) => {
        const row = await tx.rowAt('accounts', { id: seeded.accountId });
        return row as Record<string, unknown>;
      });
    }

    beforeEach(async () => {
      seeded = await seed();
    });

    afterAll(async () => {
      await closeClient();
    });

    it("REFUSES a write that records no reason, and the refusal is the database's", async () => {
      const response = await freeze({
        initiative: 'operational',
        tos_clause: '4.2',
        flag_ids: [seeded.flagId],
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: 'validation_failed',
        // The problem document names the column the DATABASE refused on. This
        // is the assertion that distinguishes a database refusal from a route
        // guard: no guard in `admin-writes.ts` knows the string `reason` in
        // this position, and none of them produces this detail.
        errors: [{ path: 'reason', message: 'is required by the schema and was not supplied' }],
      });
      expect(String((response.json() as { detail: string }).detail)).toContain('admin_actions');

      // AND NOTHING MOVED. The audit insert is FIRST, so the transaction rolled
      // back before the account was touched.
      expect(await auditRows()).toEqual([]);
      expect((await accountRow())['payoutsFrozen']).toBe(false);
    });

    it('SUCCEEDS on the same call carrying a reason, and both rows land', async () => {
      const reason = 'ticket 4711: chargeback representment, RB-03 step 2';
      const response = await freeze({
        reason,
        initiative: 'operational',
        tos_clause: '4.2',
        flag_ids: [seeded.flagId],
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        account_id: seeded.accountId,
        payouts_frozen: true,
      });

      const audit = await auditRows();
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actor: 'sso:owner@merit',
        action: 'account.freeze',
        subjectKind: 'account',
        reason,
        initiative: 'operational',
      });
      expect((await accountRow())['payoutsFrozen']).toBe(true);
    });

    it('is refused by the database when the initiative is absent too', async () => {
      const response = await freeze({
        reason: 'ticket 4711',
        tos_clause: '4.2',
        flag_ids: [seeded.flagId],
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        errors: [{ path: 'initiative' }],
      });
      expect(await auditRows()).toEqual([]);
    });

    it("is refused by 0043's biconditional when trader_request names no identity", async () => {
      const response = await freeze({
        reason: 'the trader asked',
        initiative: 'trader_request',
        tos_clause: '4.2',
        flag_ids: [seeded.flagId],
      });
      expect(response.statusCode).toBe(400);
      expect(String((response.json() as { detail: string }).detail)).toContain(
        'admin_actions_on_behalf_matches_initiative',
      );
      expect(await auditRows()).toEqual([]);
    });

    it('ADMITS AN EMPTY REASON AT THE DDL, which is why the route refuses one', async () => {
      // THE FINDING, MEASURED RATHER THAN ASSERTED. `NOT NULL` refuses an
      // OMITTED reason and admits `''`. API_CONTRACT section 8 requires a
      // non-empty one, so the gap is real and the guard in `readEnvelope` is
      // standing in for a CHECK that `admin_actions` does not carry. Session 240
      // owns the migration numbers; ADR-145 names the need.
      const written = await transaction(systemDb('operator-console'), async (tx: SystemTx) => {
        return await tx.insert('adminActions', {
          actor: 'sso:probe@merit',
          action: 'probe.empty_reason',
          subjectKind: 'account',
          subjectId: seeded.accountId,
          reason: '',
          before: {},
          after: {},
          initiative: 'operational',
        });
      });
      expect(written).toHaveLength(1);
      expect((written[0] as Record<string, unknown>)['reason']).toBe('');
    });
  },
);
