// =============================================================================
// apps/api/test/admin-feed.test.ts
// =============================================================================
// `W6-e`'s suite. ADR-184 rules two things and this file is where both are
// checked rather than described.
//
// SECTION 3 ASSERTS OVER THE SERIALIZED BODY AND NOT OVER THE ROWS, which is
// `WAVE-06` section 5.2's rule and `projectFlag`'s 2026-08-28 miss: an assertion
// that ran on the port's rows before the projection let a wrong value reach the
// operator with the adapter correct, the ordering correct and the assertion
// passing.
// =============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { BASE_PATH, PROBLEM_MEDIA_TYPE, buildServer, discoverRouteModules } from '../src/index.ts';
import {
  ADMIN_EVENTS_PATH,
  ADMIN_FEED_ENDPOINTS,
  ADMIN_FEED_REQUIRED_FACTORS,
  ADMIN_FEED_ROLE_TABLE,
  AdminFeedLeak,
  FEED_SCOPE_KINDS,
  WITHHELD,
  assertNothingWithheldOnTheWire,
  licensedBy,
  namesASubject,
  withholdForScope,
} from '../src/routes/admin-feed.ts';
import type { AdminEventRow, FeedScope } from '../src/routes/admin-feed.ts';
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
} from '../src/routes/admin-reads.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const onDisk = await discoverRouteModules();

const IDENTITY_A = '11111111-1111-4111-8111-111111111111';
const IDENTITY_B = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_A = '33333333-3333-4333-8333-333333333333';
const COOKIE = { cookie: `${ADMIN_SESSION_COOKIE}=operator-token` };

/**
 * A read source whose seven methods all reject.
 *
 * WIRED SO THE HANDLER IS REACHED AT ALL. `adminHandler` resolves
 * `currentReadSource()` before it calls any spec's `handle`
 * (`admin-reads.ts:856`), so a suite that wired nothing would be asserting the
 * 500 that resolution throws and would never enter this module. None of the
 * seven is called by the feed, and a call to one would be a test failure naming
 * it.
 *
 * `listEvents` IS ON THE STUB AND IS STILL NOT CALLED, which is the state
 * ADR-184 ruling 1 leaves behind rather than an oversight: the method is on the
 * port now and this handler still refuses the read itself. The slice that makes
 * the handler call it turns this leg red with the method's own name in the
 * message, which is where that obligation should be noticed.
 */
function readSourceStub(): AdminReadSource {
  const refuse = (name: string) => () =>
    Promise.reject(new Error(`the event feed called AdminReadSource.${name}, which it must not`));
  return {
    searchAccounts: refuse('searchAccounts'),
    readAccount: refuse('readAccount'),
    readIdentityGraph: refuse('readIdentityGraph'),
    listFlags: refuse('listFlags'),
    readLiability: refuse('readLiability'),
    exportEvidence: refuse('exportEvidence'),
    listEvents: refuse('listEvents'),
  } as unknown as AdminReadSource;
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

function row(overrides: Partial<AdminEventRow> = {}): AdminEventRow {
  return {
    id: '1',
    event_name: 'payout.hold_released',
    occurred_at: '2026-08-27T04:00:00Z',
    recorded_at: '2026-08-27T04:00:01Z',
    identity_id: IDENTITY_A,
    account_id: ACCOUNT_A,
    subject_kind: 'payout_request',
    subject_id: 'pr-1',
    actor_kind: 'system',
    actor_id: 'expiry-job',
    correlation_id: 'corr-1',
    payload: {},
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// 1. The surface boundary, measured over a real `compose()`
// -----------------------------------------------------------------------------

describe('the surface boundary', () => {
  test('the operator deployment registers the route and the public one withholds it', () => {
    // NEVER GREPPED. `CompositionReport.registered` is the only reliable source
    // for which routes exist, and a grep over route files has been wrong twice.
    const operatorReport = buildServer({ surface: 'operator', modules: onDisk }).report;
    const publicReport = buildServer({ surface: 'public', modules: onDisk }).report;

    expect(operatorReport.registered).toContain(`GET ${ADMIN_EVENTS_PATH}`);
    expect(operatorReport.withheld).not.toContain(`GET ${ADMIN_EVENTS_PATH}`);
    expect(publicReport.withheld).toContain(`GET ${ADMIN_EVENTS_PATH}`);
    expect(publicReport.registered).not.toContain(`GET ${ADMIN_EVENTS_PATH}`);
  });

  test('the public deployment answers 404 from the router rather than from a check', async () => {
    setAdminSessionSource(sessionOf(operator('owner')));
    setAdminReadSource(readSourceStub());
    const res = await get('public', `${ADMIN_EVENTS_PATH}?scope=operational`, COOKIE);
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain(PROBLEM_MEDIA_TYPE);
  });

  test('the endpoint admits all three admin roles and declares admin_sso', () => {
    expect(ADMIN_FEED_ROLE_TABLE[`GET ${ADMIN_EVENTS_PATH}`]).toStrictEqual(ADMIN_ROLES);
    expect(ADMIN_FEED_REQUIRED_FACTORS[`GET ${ADMIN_EVENTS_PATH}`]).toBe('admin_sso');
    expect(ADMIN_FEED_ENDPOINTS).toHaveLength(1);
  });
});

// -----------------------------------------------------------------------------
// 2. The request shape, which is ADR-184 ruling 2
// -----------------------------------------------------------------------------

describe('the scope is a property of the query', () => {
  async function refusal(query: string): Promise<{ statusCode: number; paths: string[] }> {
    setAdminSessionSource(sessionOf(operator('owner')));
    setAdminReadSource(readSourceStub());
    const res = await get('operator', `${ADMIN_EVENTS_PATH}${query}`, COOKIE);
    const body = JSON.parse(res.body) as { errors?: { path: string }[] };
    return { statusCode: res.statusCode, paths: (body.errors ?? []).map((e) => e.path) };
  }

  test('a query naming no scope is refused rather than defaulted', async () => {
    // THE WHOLE OF RULING 2. Defaulting to `operational` silently redacts a
    // drill-down; defaulting the other way hands a bulk screen the licence a
    // named query earns. There is no default because both are wrong.
    const out = await refusal('');
    expect(out.statusCode).toBe(400);
    expect(out.paths).toContain('scope');
  });

  test('a scope outside the closed set is refused', async () => {
    const out = await refusal('?scope=everything');
    expect(out.statusCode).toBe(400);
    expect(out.paths).toContain('scope');
  });

  test('a subject-named scope with no subject named is refused', async () => {
    expect((await refusal('?scope=identity')).paths).toContain('identity_id');
    expect((await refusal('?scope=account')).paths).toContain('account_id');
  });

  test('a subject sent under `operational` is REFUSED and not ignored', async () => {
    // THE `FM-M6-10` CASE. Ignoring the parameter is the handler remembering,
    // and a property a handler has to remember is the failure mode waiting to
    // happen. The caller sent two different queries in one request.
    const out = await refusal(`?scope=operational&identity_id=${IDENTITY_A}`);
    expect(out.statusCode).toBe(400);
    expect(out.paths).toContain('identity_id');
  });

  test('a subject sent under the OTHER named scope is refused too', async () => {
    expect(
      (await refusal(`?scope=identity&identity_id=${IDENTITY_A}&account_id=${ACCOUNT_A}`)).paths,
    ).toContain('account_id');
  });

  test('paging is refused on the same pass rather than in a second one', async () => {
    const out = await refusal('?scope=operational&limit=0');
    expect(out.statusCode).toBe(400);
    expect(out.paths).toContain('limit');
  });

  test('a well formed query passes the parse and reaches the read, which is what waits', async () => {
    setAdminSessionSource(sessionOf(operator('owner')));
    setAdminReadSource(readSourceStub());
    for (const query of [
      '?scope=operational',
      `?scope=identity&identity_id=${IDENTITY_A}`,
      `?scope=account&account_id=${ACCOUNT_A}`,
    ]) {
      const res = await get('operator', `${ADMIN_EVENTS_PATH}${query}`, COOKIE);
      // NOT 400. The request was accepted and the READ is the half with no
      // source, which is the state ADR-184 section 5 names the edits for.
      expect(res.statusCode, query).not.toBe(400);
      expect(res.statusCode, query).toBe(500);
    }
  });

  test('the authz chokepoint is in front of the parse and is not re-implemented here', async () => {
    // 401 BEFORE 400: this module writes no authz of its own, so an anonymous
    // caller sending a malformed query is unauthenticated rather than told what
    // was wrong with a query it may not make.
    setAdminReadSource(readSourceStub());
    setAdminSessionSource(sessionOf({ kind: 'unknown' }));
    expect((await get('operator', ADMIN_EVENTS_PATH)).statusCode).toBe(401);

    setAdminSessionSource(sessionOf({ kind: 'not-an-operator' } as AdminSessionLookup));
    expect((await get('operator', ADMIN_EVENTS_PATH, COOKIE)).statusCode).toBe(403);
  });
});

// -----------------------------------------------------------------------------
// 3. `INV-M6-10`, asserted over the served body
// -----------------------------------------------------------------------------

describe('INV-M6-10 on the response', () => {
  const OPERATIONAL: FeedScope = { kind: 'operational' };

  test('an operational page withholds every identity and account, visibly', () => {
    const out = withholdForScope([row()], OPERATIONAL);
    const item = out.items[0];
    expect(item?.identity_id).toBe(WITHHELD);
    expect(item?.account_id).toBe(WITHHELD);
    expect(item?.withheld).toBe(true);
    // WITHHELD RATHER THAN DROPPED. A row with no identity shown must not read
    // as a row with no identity involved.
    expect(Object.keys(item ?? {})).toContain('identity_id');
    expect([...out.withheldValues].sort()).toStrictEqual([ACCOUNT_A, IDENTITY_A].sort());
  });

  test('a null column stays null and is not reported as withheld', () => {
    const out = withholdForScope([row({ identity_id: null, account_id: null })], OPERATIONAL);
    expect(out.items[0]?.identity_id).toBeNull();
    expect(out.items[0]?.withheld).toBe(false);
    expect(out.withheldValues).toStrictEqual([]);
  });

  test('a named scope renders its own subject and withholds a DIFFERENT one', () => {
    // INV-M6-10's licence is for the ONE subject the query named.
    const out = withholdForScope([row({ payload: { matched_identity_id: IDENTITY_B } })], {
      kind: 'identity',
      identity_id: IDENTITY_A,
    });
    expect(out.items[0]?.identity_id).toBe(IDENTITY_A);
    expect(out.items[0]?.payload['matched_identity_id']).toBe(WITHHELD);
    expect(out.withheldValues).toContain(IDENTITY_B);
  });

  test('the third-party uuid inside the payload is covered BY THE KEY SHAPE', () => {
    // `scope.ts` records these two as the reason `events` cannot be scoped at
    // all. Neither is enumerated anywhere in the module: the rule is the suffix.
    for (const key of ['matched_identity_id', 'merged_identity_id', 'source_account_id'])
      expect(namesASubject(key), key).toBe(true);
    for (const key of ['identity', 'account_kind', 'id', 'plan_id'])
      expect(namesASubject(key), key).toBe(false);

    const out = withholdForScope(
      [row({ payload: { merged_identity_id: IDENTITY_B, plan_id: 'core-50k' } })],
      OPERATIONAL,
    );
    expect(out.items[0]?.payload['merged_identity_id']).toBe(WITHHELD);
    // A NON-IDENTIFYING FIELD SURVIVES. The operational mode is meant to be
    // readable: "a payout hold was released by expiry at 04:00".
    expect(out.items[0]?.payload['plan_id']).toBe('core-50k');
  });

  test('the subject is gated only where it is a person or an account', () => {
    // A `payout_request` subject is the link target an operator clicks through
    // to; withholding it protects nothing INV-M6-10 is about.
    expect(withholdForScope([row()], OPERATIONAL).items[0]?.subject_id).toBe('pr-1');
    const asIdentity = withholdForScope(
      [row({ subject_kind: 'identity', subject_id: IDENTITY_A })],
      OPERATIONAL,
    );
    expect(asIdentity.items[0]?.subject_id).toBe(WITHHELD);
  });

  test('`actor_id` is an operator string and is never gated', () => {
    const out = withholdForScope(
      [row({ actor_kind: 'admin', actor_id: 'ops@merit' })],
      OPERATIONAL,
    );
    expect(out.items[0]?.actor_id).toBe('ops@merit');
  });

  test('an incoherent row is marked and rendered rather than refused', () => {
    const out = withholdForScope(
      [row({ occurred_at: '2026-08-27T05:00:00Z', recorded_at: '2026-08-27T04:00:00Z' })],
      OPERATIONAL,
    );
    expect(out.items).toHaveLength(1);
    expect(out.items[0]?.instants_incoherent).toBe(true);
  });

  test('`licensedBy` admits exactly what the scope named', () => {
    expect(licensedBy(OPERATIONAL)).toStrictEqual([]);
    expect(licensedBy({ kind: 'identity', identity_id: IDENTITY_A })).toStrictEqual([IDENTITY_A]);
    expect(licensedBy({ kind: 'account', account_id: ACCOUNT_A })).toStrictEqual([ACCOUNT_A]);
  });
});

// -----------------------------------------------------------------------------
// 4. The control, over the bytes rather than over the rows
// -----------------------------------------------------------------------------

describe('the withheld set never reaches the wire', () => {
  test('a clean body passes and the withheld set is not part of it', () => {
    const out = withholdForScope([row()], { kind: 'operational' });
    const body = { scope: { kind: 'operational' }, data: out.items, next_cursor: null };
    expect(() => {
      assertNothingWithheldOnTheWire(body, out.withheldValues);
    }).not.toThrow();
    // THE SET IS NOT A FIELD. A response carrying it would ship every withheld
    // uuid to the caller, which is the bulk read with an extra step.
    expect(JSON.stringify(body)).not.toContain(IDENTITY_A);
    expect(Object.keys(body)).not.toContain('withheldValues');
  });

  test('A FIELD ADDED CARELESSLY IS CAUGHT, which is why this reads the bytes', () => {
    // THE SEEDED DEFECT. `withholdForScope` gated every field it knows about
    // and this body carries the id anyway, which is the shape of every future
    // slice that adds a column to the projection and forgets the gate.
    const out = withholdForScope([row()], { kind: 'operational' });
    const leaky = { data: out.items, next_cursor: null, debug_identity: IDENTITY_A };
    expect(() => {
      assertNothingWithheldOnTheWire(leaky, out.withheldValues);
    }).toThrow(AdminFeedLeak);
  });

  test('a value the scope licensed is not a leak', () => {
    const out = withholdForScope([row()], { kind: 'identity', identity_id: IDENTITY_A });
    const body = { data: out.items, next_cursor: null };
    expect(JSON.stringify(body)).toContain(IDENTITY_A);
    expect(() => {
      assertNothingWithheldOnTheWire(body, out.withheldValues);
    }).not.toThrow();
  });
});

// -----------------------------------------------------------------------------
// 5. The two fences this slice must not move, asserted rather than promised
// -----------------------------------------------------------------------------

describe('the fences', () => {
  const SOURCE = readFileSync(join(ROOT, 'apps', 'api', 'src', 'routes', 'admin-feed.ts'), 'utf8');

  test('this module declares NO backend port, so the wiring triple is unmoved', () => {
    // `wiring.test.ts`'s `DECLARES` sweep reads every `.ts` in `src/routes/` for
    // `^export function (use|set)X(`. A port declared here without a `BLOCKED`
    // reason in that file turns it red, and a port and the reason it is not
    // wired belong in one commit. ADR-184 ruling 1 puts the method on
    // `AdminReadSource` instead, which needs no new setter at all.
    expect(SOURCE).not.toMatch(/^export function (?:use|set)[A-Za-z]+\(/m);
  });

  test('the contract carries the row this module serves', () => {
    // THE AMENDMENT AND THE ROUTE, BOUND. A route whose contract row was never
    // written is exactly the state `W6-e` exists to end, and a row deleted later
    // while the route stays is the same defect in the other direction.
    const contract = readFileSync(join(ROOT, 'docs', 'architecture', 'API_CONTRACT.md'), 'utf8');
    expect(contract).toContain(`### GET ${ADMIN_EVENTS_PATH}`);
    for (const kind of FEED_SCOPE_KINDS) expect(contract).toContain(kind);
  });
});
