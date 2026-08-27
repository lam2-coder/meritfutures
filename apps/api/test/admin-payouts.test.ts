// =============================================================================
// apps/api/test/admin-payouts.test.ts
// =============================================================================
// WHAT THIS SUITE IS FOR, IN ONE SENTENCE: the hold is read BEFORE the write
// that erases it, all five of its columns reach `admin_actions.before`, and the
// release posts `LT-01` while the enforcement posts nothing.
//
// -----------------------------------------------------------------------------
// THE ASSERTION THAT MATTERS MOST IS THE ONE AGAINST THE MIGRATION
// -----------------------------------------------------------------------------
// `payout_requests_hold_is_complete` is a BICONDITIONAL, so a write that moves
// `status` off `held_pending_review` and blanks four of the five hold columns is
// refused by Postgres and by nothing else in this tree. CI-04 has no database
// (ADR-085), so that refusal does not run here.
//
// **SO THE CONSTRAINT IS READ OUT OF THE MIGRATION FILE AND COMPARED WITH THE
// `SET` CLAUSE.** `0031` is merged and sacred, which makes it a stable primary
// source, and the comparison is mechanical: every column the CHECK requires to
// be NULL appears in the update this module issues, and no column appears in one
// and not the other. That is CLAUDE.md's own remedy for the class of error the
// reconciliation session paid for -- "prefer a new CI gate over a bigger model
// whenever the error is checkable" -- reached with a test rather than a model.
//
// -----------------------------------------------------------------------------
// WHAT A RECORDER CAN AND CANNOT PROVE, STATED RATHER THAN ASSUMED
// -----------------------------------------------------------------------------
// The fake transaction proves what is THIS module's: which accessor was called,
// in which order, with which key, which address and which values. It proves
// NOTHING about whether `lockAt`'s predicate takes a row lock, which is
// `packages/db`'s and is asserted in `packages/db/test/keyed-accessor.test.ts`,
// and nothing about whether `NOT NULL` refuses, which is Postgres's. A suite
// that asserted either here would be agreeing with its own fake.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { TABLE_KEYS } from '@merit/db';
import type { TableKey } from '@merit/db';

import adminPayouts, {
  ADMIN_PAYOUT_ENDPOINTS,
  ADMIN_PAYOUT_ROLES,
  ADMIN_PAYOUT_TABLES,
  HELD,
  PAYOUT_ENFORCE_PATH,
  PAYOUT_RELEASE_PATH,
  releaseLedgerKey,
  resetAdminPayoutBackend,
  useAdminPayoutBackend,
} from '../src/routes/admin-payouts.ts';
import type {
  AdminPayoutBackend,
  AdminPayoutTx,
  PayoutEnforceResponse,
  PayoutReleaseResponse,
} from '../src/routes/admin-payouts.ts';
import type { AdminPrincipal, AdminRole } from '../src/routes/admin-writes.ts';
import { PAYOUT_ENDPOINT } from '../src/routes/payouts.ts';
import { buildServer } from '../src/server.ts';
import { BASE_PATH } from '../src/surface.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');

const PAYOUT_ID = '11111111-1111-4111-8111-111111111111';
const IDENTITY_ID = '22222222-2222-4222-8222-222222222222';
const FLAG_ID = '33333333-3333-4333-8333-333333333333';
const PACK_ID = '44444444-4444-4444-8444-444444444444';
const MISSING_ID = '99999999-9999-4999-8999-999999999999';

const AT = new Date('2026-08-27T18:00:00.000Z');
const HELD_AT = new Date('2026-08-26T09:00:00.000Z');
const HOLD_EXPIRES_AT = new Date('2026-08-28T09:00:00.000Z');

/** The request's own stored key, which is what `INV-M5-06` says is the posting's. */
const STORED_KEY = 'client-token-4711';

const ENDPOINTS = ADMIN_PAYOUT_ENDPOINTS.map((spec) => `${spec.method} ${spec.path}`);

afterEach(() => {
  resetAdminPayoutBackend();
});

// -----------------------------------------------------------------------------
// 0. The list of tables this module names is a list of tables that exist
// -----------------------------------------------------------------------------
// The module holds no `@merit/db` import (`src/db.ts` is this deployable's one
// door onto it), so `AdminPayoutTable` is a hand-written union. THE BINDING IS
// HERE, where `@merit/db` is reachable.

describe('the tables the module names', () => {
  it('are all keys packages/db registers', () => {
    const keys: readonly TableKey[] = ADMIN_PAYOUT_TABLES;
    for (const key of keys) expect(TABLE_KEYS).toContain(key);
  });

  it('names no ledger table, because the posting does not go through that handle', () => {
    for (const key of ADMIN_PAYOUT_TABLES) expect(key.startsWith('ledger')).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// 0b. THE MODULE LOADS UNDER THE RUNTIME THAT ACTUALLY SERVES IT
// -----------------------------------------------------------------------------
// `apps/api`'s `start` script is `node --experimental-strip-types src/start.ts`,
// which ERASES types rather than compiling them, so a construct needing emitted
// code type-checks, passes under Vitest, and throws
// `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` when the process starts.
// `discoverRouteModules` imports EVERY file in `routes/`, so one of them takes
// the whole deployable down. `admin-writes.ts` shipped with exactly that defect
// and every other assertion in its suite was green.

describe('the runtime that actually serves this module', () => {
  it('imports it under `node --experimental-strip-types`, which does not transpile', () => {
    const module = join(HERE, '..', 'src', 'routes', 'admin-payouts.ts');
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
    expect(out).toBe('admin-payouts');
  });
});

// -----------------------------------------------------------------------------
// 1. THE TWO ROWS ARE THE CONTRACT'S TWO ROWS
// -----------------------------------------------------------------------------
// API_CONTRACT is the primary source and it is READ rather than remembered. The
// paths, the roles and the error sets all come out of the document.

describe('API_CONTRACT section 8', () => {
  const contract = readFileSync(join(REPO, 'docs/architecture/API_CONTRACT.md'), 'utf8');

  it('declares both headings this module registers', () => {
    expect(contract).toContain('### POST /admin/payouts/:id/release');
    expect(contract).toContain('### POST /admin/payouts/:id/enforce');
    expect(ENDPOINTS).toEqual([
      'POST /admin/payouts/:id/release',
      'POST /admin/payouts/:id/enforce',
    ]);
  });

  it('declares owner and ops on both, and readonly on neither', () => {
    expect(ADMIN_PAYOUT_ROLES).toEqual({
      'POST /admin/payouts/:id/release': ['owner', 'ops'],
      'POST /admin/payouts/:id/enforce': ['owner', 'ops'],
    });
    for (const path of [PAYOUT_RELEASE_PATH, PAYOUT_ENFORCE_PATH]) {
      const section = contract.slice(contract.indexOf(`### POST ${path}`));
      const auth = section.slice(0, section.indexOf('\n\n', section.indexOf('Auth:')));
      expect(auth).toContain('`admin_sso`, roles `owner` and `ops`');
      expect(auth).toContain('`forbidden` (`readonly` role)');
    }
  });

  it('states the hold block as four members, and `hold_reason` is not one of them', () => {
    // The shape this suite asserts on the wire below, taken from the document
    // rather than from the code that produces it.
    expect(contract).toContain(
      'released_hold: { held_at: string; resolves_by: string; tos_clause: string; flag_id: string }',
    );
    expect(contract).toContain(
      'enforced_hold: { held_at: string; resolves_by: string; tos_clause: string; flag_id: string }',
    );
    expect(contract).not.toContain('released_hold: { held_at: string; hold_reason');
  });
});

// -----------------------------------------------------------------------------
// 2. THE BICONDITIONAL, READ OUT OF THE MIGRATION AND COMPARED WITH THE WRITE
// -----------------------------------------------------------------------------
// THIS IS THE ASSERTION THE SESSION EXISTS FOR. A release or an enforcement that
// blanked four of the five hold columns is refused by `0031` and by nothing in
// this tree, and CI has no database to make that refusal.

describe('payout_requests_hold_is_complete, read at the source', () => {
  const migration = readFileSync(
    join(REPO, 'packages/db/migrations/0031_payout_hold_and_identity_restriction.sql'),
    'utf8',
  );
  const constraint = migration.slice(
    migration.indexOf('ADD CONSTRAINT payout_requests_hold_is_complete'),
  );
  const body = constraint.slice(0, constraint.indexOf('\n  );'));

  /** The five columns, in the order the CHECK names them. */
  const HOLD_COLUMNS = [
    'held_at',
    'hold_flag_id',
    'hold_expires_at',
    'hold_tos_clause',
    'hold_reason',
  ];

  it('is a biconditional over exactly these five columns', () => {
    // Both arms exist. The first is the one this module's two writes land in.
    expect(body).toContain("status <> 'held_pending_review'");
    expect(body).toContain("status = 'held_pending_review'");
    for (const column of HOLD_COLUMNS) {
      expect(body).toContain(`${column} IS NULL`);
      expect(body).toContain(`${column} IS NOT NULL`);
    }
    // And no sixth column is named by either arm.
    const named = [...body.matchAll(/\b(\w+) IS (?:NOT )?NULL/g)].map((m) => m[1]);
    expect([...new Set(named)].sort()).toEqual([...HOLD_COLUMNS].sort());
  });

  it('is satisfied by the SET clause both endpoints issue, column for column', async () => {
    for (const spec of ADMIN_PAYOUT_ENDPOINTS) {
      const written: Written[] = [];
      const response = await callAs('owner', spec, written);
      expect([spec.path, response.statusCode]).toEqual([spec.path, 200]);

      const update = written.find((w) => w.kind === 'update' && w.table === 'payoutRequests');
      expect(update).toBeDefined();
      const values = update?.values ?? {};

      // EVERY COLUMN THE CHECK REQUIRES TO BE NULL IS EXPLICITLY NULL HERE.
      for (const column of HOLD_COLUMNS) {
        const property = camel(column);
        expect([spec.path, column, property in values]).toEqual([spec.path, column, true]);
        expect([spec.path, column, values[property]]).toEqual([spec.path, column, null]);
      }
      // AND THE SET CLAUSE NAMES NO SIXTH HOLD COLUMN. `status` and `updatedAt`
      // are the only other members, so a column added to the hold in a later
      // migration and not blanked here fails this rather than fails in
      // production.
      expect([spec.path, Object.keys(values).sort()]).toEqual([
        spec.path,
        [...HOLD_COLUMNS.map(camel), 'status', 'updatedAt'].sort(),
      ]);
    }
  });
});

/** `hold_tos_clause` -> `holdTosClause`. The Drizzle property name of a column. */
function camel(column: string): string {
  return column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

// -----------------------------------------------------------------------------
// 3. THE SURFACE BOUNDARY
// -----------------------------------------------------------------------------
// ADR-083 section 4: the public deployment answers 404 for an operator path BY
// HAVING NOTHING THERE. `withheld` being non-empty is the mechanism and the 404
// is the consequence, so both are asserted rather than one standing in for the
// other.

describe('the surface boundary', () => {
  it('withholds both routes from the public deployment', () => {
    const { report } = buildServer({ surface: 'public', modules: [adminPayouts] });
    expect(report.registered).toEqual([]);
    expect([...report.withheld].sort()).toEqual([...ENDPOINTS].sort());
  });

  it('registers both routes on the operator deployment', () => {
    const { report } = buildServer({ surface: 'operator', modules: [adminPayouts] });
    expect(report.withheld).toEqual([]);
    expect([...report.registered].sort()).toEqual([...ENDPOINTS].sort());
  });

  it('answers 404 on the public origin, from the router and not from a check', async () => {
    const { app } = buildServer({ surface: 'public', modules: [adminPayouts] });
    // NO BACKEND IS INSTALLED. If this 404 came from a permission check the
    // check would have needed a principal, and asking for one would have thrown
    // `AdminPayoutUnwired` and answered 503. A 404 here therefore proves the
    // route was never registered.
    const response = await app.inject({
      method: 'POST',
      url: `${BASE_PATH}/admin/payouts/${PAYOUT_ID}/release`,
      payload: { reason: 'ticket 4711' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ code: 'not_found', status: 404 });
    await app.close();
  });

  it('names no admin hostname anywhere in the module', () => {
    // ADR-012: the admin console's real apex domain never enters the corpus,
    // the repository, or any public artifact. The module classifies by PREFIX
    // and holds no origin literal at all.
    const source = readFileSync(join(HERE, '..', 'src', 'routes', 'admin-payouts.ts'), 'utf8');
    expect(source).not.toMatch(/https?:\/\/(?!meritfutures\.com\/problems)/);
    expect(source).not.toMatch(/ADMIN_ORIGIN\s*=/);
  });
});

// -----------------------------------------------------------------------------
// The recorder
// -----------------------------------------------------------------------------

/** One write, or one lock, the fake transaction saw. In order. */
interface Written {
  readonly kind: 'lock' | 'read' | 'insert' | 'update' | 'ledger-insert';
  readonly table: string;
  readonly at?: Record<string, unknown>;
  readonly values: Record<string, unknown>;
}

interface FakeOptions {
  /** `payout_requests.status` on the row the lock returns. */
  readonly status?: string;
  /** `undefined` makes the row absent, which is the contract's 404. */
  readonly missing?: boolean;
  /** A live halt on this identity refuses the posting. */
  readonly halted?: boolean;
}

const TRADER_WITHDRAWABLE = 'aaaaaaaa-0001-4000-8000-000000000001';
const TRADER_WALLET = 'aaaaaaaa-0002-4000-8000-000000000002';
const FEES_REVENUE = 'aaaaaaaa-0003-4000-8000-000000000003';

function fakeBackend(
  role: AdminRole,
  written: Written[] = [],
  options: FakeOptions = {},
): AdminPayoutBackend {
  const row = {
    id: PAYOUT_ID,
    identityId: IDENTITY_ID,
    idempotencyKey: STORED_KEY,
    status: options.status ?? HELD,
    approvedCents: 250_000n,
    traderCents: 225_000n,
    firmCents: 25_000n,
    payoutOrdinal: 3,
    heldAt: HELD_AT,
    holdFlagId: FLAG_ID,
    holdExpiresAt: HOLD_EXPIRES_AT,
    holdTosClause: '7.3(b)',
    holdReason: 'entity cap: two funded accounts share a device fingerprint',
  };

  const ledger = {
    rows: (key: string): Promise<unknown[]> => {
      if (key === 'ledgerAccounts')
        return Promise.resolve([
          {
            id: TRADER_WITHDRAWABLE,
            code: 'trader_withdrawable',
            scope: 'identity',
            identityId: IDENTITY_ID,
          },
          { id: TRADER_WALLET, code: 'trader_wallet', scope: 'identity', identityId: IDENTITY_ID },
          { id: FEES_REVENUE, code: 'fees_revenue', scope: 'firm', identityId: null },
        ]);
      if (key === 'ledgerHalts')
        return Promise.resolve(
          options.halted === true
            ? [{ identityId: IDENTITY_ID, scope: 'payouts', liftedAt: null, reason: 'incident' }]
            : [],
        );
      return Promise.resolve([]);
    },
    insert: (key: string, values: Record<string, unknown>): Promise<unknown[]> => {
      written.push({ kind: 'ledger-insert', table: key, values: { ...values } });
      return Promise.resolve([{ id: 'bbbbbbbb-0001-4000-8000-000000000001', ...values }]);
    },
  };

  const tx: AdminPayoutTx = {
    lockAt: (table, at) => {
      written.push({ kind: 'lock', table, at: { ...at }, values: {} });
      if (table === 'payoutRequests') {
        const id = at['id'];
        if (options.missing === true || id !== PAYOUT_ID) return Promise.resolve(undefined);
        return Promise.resolve(row);
      }
      return Promise.resolve(undefined);
    },
    rowAt: (table, at) => {
      written.push({ kind: 'read', table, at: { ...at }, values: {} });
      if (table === 'evidencePacks' && at['id'] === PACK_ID)
        return Promise.resolve({ id: PACK_ID });
      return Promise.resolve(undefined);
    },
    insert: (table, values) => {
      written.push({ kind: 'insert', table, values: { ...values } });
      return Promise.resolve([values]);
    },
    updateAt: (table, at, values) => {
      written.push({ kind: 'update', table, at: { ...at }, values: { ...values } });
      return Promise.resolve([values]);
    },
    ledger,
  };

  const principal: AdminPrincipal = { actor: `sso:${role}@merit`, role };
  return {
    operator: (fn) => fn(tx),
    principal: () => Promise.resolve(principal),
    now: () => AT,
  };
}

function bodyFor(path: string): Record<string, unknown> {
  const reason = 'ticket 4711: reviewed with compliance, no case to answer';
  if (path === PAYOUT_ENFORCE_PATH)
    return { reason, tos_clause: '7.3(b)', evidence_pack_id: PACK_ID };
  return { reason };
}

function urlFor(path: string, id: string = PAYOUT_ID): string {
  return BASE_PATH + path.replace(':id', id);
}

async function callAs(
  role: AdminRole,
  spec: (typeof ADMIN_PAYOUT_ENDPOINTS)[number],
  written: Written[] = [],
  body?: Record<string, unknown>,
  options: FakeOptions = {},
  id: string = PAYOUT_ID,
): Promise<{ statusCode: number; json: () => unknown }> {
  useAdminPayoutBackend(fakeBackend(role, written, options));
  const { app } = buildServer({ surface: 'operator', modules: [adminPayouts] });
  const response = await app.inject({
    method: 'POST',
    url: urlFor(spec.path, id),
    payload: body ?? bodyFor(spec.path),
  });
  await app.close();
  return response;
}

const RELEASE = ADMIN_PAYOUT_ENDPOINTS[0];
const ENFORCE = ADMIN_PAYOUT_ENDPOINTS[1];

// -----------------------------------------------------------------------------
// 4. AN AUTHORIZATION REFUSAL IS NEVER A GATE RESULT (INV-M5-23's shape)
// -----------------------------------------------------------------------------
// M05 INV-M5-23: the refusal writes no snapshot, no row and no event. Here the
// property is that the 401 and the 403 happen before `operator()` is called, so
// there is nothing to roll back and nothing in `admin_actions`.

describe('the authorization refusals', () => {
  it('refuses a readonly principal both writes and opens no transaction at all', async () => {
    for (const spec of ADMIN_PAYOUT_ENDPOINTS) {
      const written: Written[] = [];
      const response = await callAs('readonly', spec, written);
      expect([spec.path, response.statusCode]).toEqual([spec.path, 403]);
      expect(response.json()).toMatchObject({ code: 'forbidden' });
      // NO LOCK, NO AUDIT ROW, NO UPDATE, NO POSTING.
      expect([spec.path, written]).toEqual([spec.path, []]);
    }
  });

  it('answers 401 before 403, and opens no transaction either', async () => {
    for (const spec of ADMIN_PAYOUT_ENDPOINTS) {
      const written: Written[] = [];
      useAdminPayoutBackend({
        ...fakeBackend('owner', written),
        principal: () => Promise.resolve(null),
      });
      const { app } = buildServer({ surface: 'operator', modules: [adminPayouts] });
      const response = await app.inject({
        method: 'POST',
        url: urlFor(spec.path),
        payload: bodyFor(spec.path),
      });
      await app.close();
      expect([spec.path, response.statusCode]).toEqual([spec.path, 401]);
      expect(response.json()).toMatchObject({ code: 'unauthenticated' });
      expect([spec.path, written]).toEqual([spec.path, []]);
    }
  });

  it('lets owner and ops both through the role gate', async () => {
    for (const role of ['owner', 'ops'] as const)
      for (const spec of ADMIN_PAYOUT_ENDPOINTS) {
        const response = await callAs(role, spec);
        expect([role, spec.path, response.statusCode]).toEqual([role, spec.path, 200]);
      }
  });

  it('answers 503 and not 500 when no backend is installed', async () => {
    const { app } = buildServer({ surface: 'operator', modules: [adminPayouts] });
    const response = await app.inject({
      method: 'POST',
      url: urlFor(PAYOUT_RELEASE_PATH),
      payload: { reason: 'ticket 4711' },
    });
    await app.close();
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'service_unavailable' });
  });
});

// -----------------------------------------------------------------------------
// 5. THE LOCK IS TAKEN FIRST, AND THE STATUS PRECONDITION IS CHECKED ON IT
// -----------------------------------------------------------------------------

describe('the row lock and the status precondition', () => {
  it('locks the row rather than reading it, and does so first', async () => {
    for (const spec of ADMIN_PAYOUT_ENDPOINTS) {
      const written: Written[] = [];
      await callAs('owner', spec, written);
      expect([spec.path, written[0]?.kind]).toEqual([spec.path, 'lock']);
      expect([spec.path, written[0]?.table]).toEqual([spec.path, 'payoutRequests']);
      expect([spec.path, written[0]?.at]).toEqual([spec.path, { id: PAYOUT_ID }]);
      // NOTHING READ `payout_requests` UNLOCKED. Two operators resolving one
      // hold is the case ADR-157's lock exists for, and a plain `rowAt` here
      // would let both of them past the status check.
      const unlocked = written.filter((w) => w.kind === 'read' && w.table === 'payoutRequests');
      expect([spec.path, unlocked]).toEqual([spec.path, []]);
    }
  });

  it('answers 404 for a payout request that does not exist', async () => {
    for (const spec of ADMIN_PAYOUT_ENDPOINTS) {
      const written: Written[] = [];
      const response = await callAs('owner', spec, written, undefined, {}, MISSING_ID);
      expect([spec.path, response.statusCode]).toEqual([spec.path, 404]);
      expect(response.json()).toMatchObject({ code: 'not_found' });
      // The lock was attempted and nothing else happened.
      expect([spec.path, written.map((w) => w.kind)]).toEqual([spec.path, ['lock']]);
    }
  });

  it('answers 404 for an id that cannot name a row, without opening a transaction', async () => {
    for (const spec of ADMIN_PAYOUT_ENDPOINTS) {
      const written: Written[] = [];
      const response = await callAs('owner', spec, written, undefined, {}, 'not-a-uuid');
      expect([spec.path, response.statusCode]).toEqual([spec.path, 404]);
      expect([spec.path, written]).toEqual([spec.path, []]);
    }
  });

  it('answers 409 for every status that is not held_pending_review', async () => {
    // `payout_status` is `('approved','settled','failed','frozen')` from `0001`
    // plus `held_pending_review` from `0030`. The four originals are the four
    // states neither endpoint may act on.
    for (const status of ['approved', 'settled', 'failed', 'frozen'])
      for (const spec of ADMIN_PAYOUT_ENDPOINTS) {
        const written: Written[] = [];
        const response = await callAs('owner', spec, written, undefined, { status });
        expect([status, spec.path, response.statusCode]).toEqual([status, spec.path, 409]);
        expect(response.json()).toMatchObject({ code: 'conflict' });
        // THE CONFLICT IS DECIDED ON THE LOCKED ROW AND WRITES NOTHING.
        expect([status, spec.path, written.map((w) => w.kind)]).toEqual([
          status,
          spec.path,
          ['lock'],
        ]);
      }
  });
});

// -----------------------------------------------------------------------------
// 6. THE HOLD IS READ BEFORE THE WRITE, AND ALL FIVE COLUMNS REACH THE AUDIT
// -----------------------------------------------------------------------------
// This is the finding ADR-158 named. The response carries four of the five; the
// fifth exists only here, and only because this module copies it.

describe('the hold the write erases', () => {
  it('writes the audit row BEFORE the update, on both endpoints', async () => {
    for (const spec of ADMIN_PAYOUT_ENDPOINTS) {
      const written: Written[] = [];
      await callAs('owner', spec, written);
      const audit = written.findIndex((w) => w.kind === 'insert' && w.table === 'adminActions');
      const update = written.findIndex((w) => w.kind === 'update' && w.table === 'payoutRequests');
      expect([spec.path, audit >= 0, update >= 0]).toEqual([spec.path, true, true]);
      expect([spec.path, audit < update]).toEqual([spec.path, true]);
    }
  });

  it('carries all five hold columns into `before`, `hold_reason` included', async () => {
    for (const spec of ADMIN_PAYOUT_ENDPOINTS) {
      const written: Written[] = [];
      await callAs('owner', spec, written);
      const audit = written.find((w) => w.kind === 'insert' && w.table === 'adminActions');
      expect(audit?.values['before']).toEqual({
        status: HELD,
        held_at: HELD_AT.toISOString(),
        hold_flag_id: FLAG_ID,
        hold_expires_at: HOLD_EXPIRES_AT.toISOString(),
        hold_tos_clause: '7.3(b)',
        // THE ONE FIELD WITH NOWHERE ELSE TO GO. API_CONTRACT's hold blocks
        // carry four members and this is the fifth column the CHECK blanks, so
        // this line is the entire surviving record of why the hold was opened.
        hold_reason: 'entity cap: two funded accounts share a device fingerprint',
        approved_cents: 250_000,
        trader_cents: 225_000,
        firm_cents: 25_000,
        payout_ordinal: 3,
      });
    }
  });

  it('spells the five nulls out in `after`, so the erasure is visible in the audit', async () => {
    for (const [spec, status] of [
      [RELEASE, 'approved'],
      [ENFORCE, 'failed'],
    ] as const) {
      const written: Written[] = [];
      await callAs('owner', spec, written);
      const audit = written.find((w) => w.kind === 'insert' && w.table === 'adminActions');
      expect(audit?.values['after']).toEqual({
        status,
        held_at: null,
        hold_flag_id: null,
        hold_expires_at: null,
        hold_tos_clause: null,
        hold_reason: null,
      });
    }
  });

  it('cites the hold s own flag and ToS clause in evidence_refs', async () => {
    const written: Written[] = [];
    await callAs('owner', RELEASE, written);
    const audit = written.find((w) => w.kind === 'insert' && w.table === 'adminActions');
    expect(audit?.values['evidenceRefs']).toEqual([
      { kind: 'risk_flag', ref: FLAG_ID },
      { kind: 'tos_clause', ref: '7.3(b)' },
    ]);
  });

  it('names the subject as the payout request and the action per endpoint', async () => {
    for (const [spec, action] of [
      [RELEASE, 'payout_request.release'],
      [ENFORCE, 'payout_request.enforce'],
    ] as const) {
      const written: Written[] = [];
      await callAs('owner', spec, written);
      const audit = written.find((w) => w.kind === 'insert' && w.table === 'adminActions');
      expect(audit?.values['action']).toBe(action);
      expect(audit?.values['subjectKind']).toBe('payout_request');
      expect(audit?.values['subjectId']).toBe(PAYOUT_ID);
      expect(audit?.values['actor']).toBe('sso:owner@merit');
    }
  });

  it('declares the initiative from the route and never from the wire', async () => {
    for (const [spec, initiative] of [
      [RELEASE, 'operational'],
      [ENFORCE, 'enforcement'],
    ] as const) {
      const written: Written[] = [];
      // The body claims the OTHER value, and the route's own answer wins.
      await callAs('owner', spec, written, {
        ...bodyFor(spec.path),
        initiative: initiative === 'operational' ? 'enforcement' : 'operational',
        on_behalf_of_identity_id: IDENTITY_ID,
      });
      const audit = written.find((w) => w.kind === 'insert' && w.table === 'adminActions');
      expect(audit?.values['initiative']).toBe(initiative);
      // `admin_actions_on_behalf_matches_initiative` admits the column only
      // under `trader_request`, and neither of these acts is the trader's.
      expect('onBehalfOfIdentityId' in (audit?.values ?? {})).toBe(false);
    }
  });
});

// -----------------------------------------------------------------------------
// 7. `reason`: ABSENCE IS CARRIED TO THE DATABASE AND EMPTINESS IS NOT
// -----------------------------------------------------------------------------
// `0017:82`: "NO UNEXPLAINED ADMIN ACTION, EVER. NOT NULL is the whole control."
// It refuses an omitted reason and ADMITS an empty string, so this module makes
// the refusal the database cannot and leaves it the one it can.

describe('the reason', () => {
  it('refuses an empty reason with validation_failed, before any write', async () => {
    for (const spec of ADMIN_PAYOUT_ENDPOINTS) {
      const written: Written[] = [];
      const response = await callAs('owner', spec, written, {
        ...bodyFor(spec.path),
        reason: '   ',
      });
      expect([spec.path, response.statusCode]).toEqual([spec.path, 400]);
      expect(response.json()).toMatchObject({
        code: 'validation_failed',
        errors: [{ path: 'reason' }],
      });
      expect([spec.path, written.map((w) => w.kind)]).toEqual([spec.path, ['lock']]);
    }
  });

  it('omits an absent reason from the insert rather than defaulting one', async () => {
    const written: Written[] = [];
    await callAs('owner', RELEASE, written, {});
    const audit = written.find((w) => w.kind === 'insert' && w.table === 'adminActions');
    // A PLACEHOLDER HERE WOULD DEFEAT THE ONE CONTROL THE SCHEMA ENFORCES ON
    // OPERATORS. The key is absent, so Postgres raises 23502 and the whole
    // transaction rolls back.
    expect('reason' in (audit?.values ?? {})).toBe(false);
  });

  it('carries a supplied reason through unmodified', async () => {
    const written: Written[] = [];
    await callAs('owner', RELEASE, written);
    const audit = written.find((w) => w.kind === 'insert' && w.table === 'adminActions');
    expect(audit?.values['reason']).toBe(
      'ticket 4711: reviewed with compliance, no case to answer',
    );
  });
});

// -----------------------------------------------------------------------------
// 8. THE RELEASE PAYS
// -----------------------------------------------------------------------------
// ADR-040: a held request has posted nothing, and `approved` is the state AFTER
// `LT-01`. So this endpoint is the only door the deferred posting reaches, and a
// release that moved the status and posted nothing would mark a payout paid that
// never paid.

describe('POST /admin/payouts/:id/release', () => {
  it('answers the contract s response, built from the row read before the write', async () => {
    const written: Written[] = [];
    const response = await callAs('owner', RELEASE, written);
    expect(response.statusCode).toBe(200);
    const body = response.json() as PayoutReleaseResponse;
    expect(body).toEqual({
      payout_request_id: PAYOUT_ID,
      status: 'approved',
      approved_cents: 250_000,
      trader_cents: 225_000,
      firm_cents: 25_000,
      payout_ordinal: 3,
      released_hold: {
        held_at: HELD_AT.toISOString(),
        resolves_by: HOLD_EXPIRES_AT.toISOString(),
        tos_clause: '7.3(b)',
        flag_id: FLAG_ID,
      },
    });
    // EVERY MONEY FIELD IS AN INTEGER. API_CONTRACT section 1: no floats.
    for (const key of ['approved_cents', 'trader_cents', 'firm_cents'] as const)
      expect(Number.isSafeInteger(body[key])).toBe(true);
  });

  it('posts LT-01 with the stored amounts, and recomputes nothing', async () => {
    const written: Written[] = [];
    await callAs('owner', RELEASE, written);
    const header = written.find((w) => w.table === 'ledgerTransactions');
    expect(header?.values).toMatchObject({
      kind: 'payout_approval',
      referenceKind: 'payout_request',
      referenceId: PAYOUT_ID,
    });

    const entries = written.filter((w) => w.table === 'ledgerEntries');
    // Two transfers, therefore four entries: ADR-104 ruling 1 makes a one-debit
    // two-credit posting unrepresentable, so `lt01` writes two transfers whose
    // debits are both against the withdrawable position.
    expect(entries).toHaveLength(4);
    const byAccount = new Map<string, bigint>();
    for (const entry of entries) {
      const account = String(entry.values['ledgerAccountId']);
      const amount = entry.values['amountCents'] as bigint;
      byAccount.set(account, (byAccount.get(account) ?? 0n) + amount);
    }
    // `debit trader_withdrawable approved_cents; credit trader_wallet
    // trader_cents; credit fees_revenue firm_cents` (M05 section 2.1).
    //
    // A DEBIT IS POSITIVE AND A CREDIT IS NEGATIVE, and that is read off
    // `entriesOf` at `packages/ledger/src/posting.ts:235` rather than assumed:
    // "entries.push({ account: t.debit, amountCents: t.amountCents ... });
    //  entries.push({ account: t.credit, amountCents: -t.amountCents ... })".
    // **THIS ASSERTION WAS WRITTEN WITH THE SIGNS INVERTED AND THIS SUITE IS
    // WHAT SAID SO**, which is the point of pinning them at all: the sign
    // written backwards is the error class CLAUDE.md names as already paid for
    // once, and it is checkable.
    expect(byAccount.get(TRADER_WITHDRAWABLE)).toBe(250_000n);
    expect(byAccount.get(TRADER_WALLET)).toBe(-225_000n);
    expect(byAccount.get(FEES_REVENUE)).toBe(-25_000n);
    expect([...byAccount.values()].reduce((a, b) => a + b, 0n)).toBe(0n);
  });

  it('uses the request s OWN stored idempotency key, which is the key payouts.ts would have used', () => {
    // `INV-M5-06`: the same key on every attempt, generated BEFORE the first
    // send and persisted in the same transaction. `ledger_transactions
    // .idempotency_key` is UNIQUE, so an identical string across both doors
    // makes a second `LT-01` for one payout request refusable by the DATABASE.
    expect(releaseLedgerKey(STORED_KEY)).toBe(`${PAYOUT_ENDPOINT} ${STORED_KEY}`);
    expect(releaseLedgerKey(STORED_KEY)).toBe(`POST /accounts/:accountId/payout ${STORED_KEY}`);
  });

  it('stamps that key on the posting', async () => {
    const written: Written[] = [];
    await callAs('owner', RELEASE, written);
    const header = written.find((w) => w.table === 'ledgerTransactions');
    expect(header?.values['idempotencyKey']).toBe(releaseLedgerKey(STORED_KEY));
  });

  it('posts AFTER the status change, inside the same transaction', async () => {
    const written: Written[] = [];
    await callAs('owner', RELEASE, written);
    const update = written.findIndex((w) => w.kind === 'update' && w.table === 'payoutRequests');
    const post = written.findIndex((w) => w.table === 'ledgerTransactions');
    expect(update).toBeGreaterThanOrEqual(0);
    expect(post).toBeGreaterThan(update);
  });

  it('refuses to post through a live halt, and the whole release fails with it', async () => {
    // `postTransaction` asserts against `ledger_halts` unless the caller passes
    // `despiteHalt`, and this module passes nothing: an override is a ruling.
    // The throw escapes the transaction, so the status change rolls back with
    // the posting rather than leaving a released hold that never paid.
    const written: Written[] = [];
    const response = await callAs('owner', RELEASE, written, undefined, { halted: true });
    expect(response.statusCode).toBe(500);
    expect(written.some((w) => w.table === 'ledgerTransactions')).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// 9. THE ENFORCEMENT DOCUMENTS AND POSTS NOTHING
// -----------------------------------------------------------------------------

describe('POST /admin/payouts/:id/enforce', () => {
  it('answers the contract s response, with ordinal_released stated rather than implied', async () => {
    const written: Written[] = [];
    const response = await callAs('owner', ENFORCE, written);
    expect(response.statusCode).toBe(200);
    const body = response.json() as PayoutEnforceResponse;
    expect(body).toEqual({
      payout_request_id: PAYOUT_ID,
      status: 'failed',
      payout_ordinal: 3,
      ordinal_released: true,
      enforced_hold: {
        held_at: HELD_AT.toISOString(),
        resolves_by: HOLD_EXPIRES_AT.toISOString(),
        tos_clause: '7.3(b)',
        flag_id: FLAG_ID,
      },
    });
  });

  it('posts NOTHING, because a held request has posted nothing to reverse', async () => {
    const written: Written[] = [];
    await callAs('owner', ENFORCE, written);
    expect(written.filter((w) => w.kind === 'ledger-insert')).toEqual([]);
  });

  it('requires an evidence_pack_id that names an exported pack', async () => {
    const written: Written[] = [];
    const response = await callAs('owner', ENFORCE, written, {
      ...bodyFor(PAYOUT_ENFORCE_PATH),
      evidence_pack_id: MISSING_ID,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'validation_failed',
      errors: [{ path: 'evidence_pack_id', message: 'names no evidence pack' }],
    });
    // The pack was LOOKED UP and nothing was written.
    expect(written.map((w) => `${w.kind} ${w.table}`)).toEqual([
      'lock payoutRequests',
      'read evidencePacks',
    ]);
  });

  it('refuses a missing evidence_pack_id and a missing or empty tos_clause', async () => {
    const cases: readonly [Record<string, unknown>, string][] = [
      [{ reason: 'r', tos_clause: '7.3(b)' }, 'evidence_pack_id'],
      [{ reason: 'r', evidence_pack_id: PACK_ID }, 'tos_clause'],
      [{ reason: 'r', tos_clause: '  ', evidence_pack_id: PACK_ID }, 'tos_clause'],
      [{ reason: 'r', tos_clause: '7.3(b)', evidence_pack_id: 'not-a-uuid' }, 'evidence_pack_id'],
    ];
    for (const [body, path] of cases) {
      const written: Written[] = [];
      const response = await callAs('owner', ENFORCE, written, body);
      expect([path, response.statusCode]).toEqual([path, 400]);
      expect(response.json()).toMatchObject({
        code: 'validation_failed',
        errors: [{ path }],
      });
      expect([path, written.map((w) => w.kind)]).toEqual([path, ['lock']]);
    }
  });

  it('cites the pack, the clause and the hold s flag in evidence_refs', async () => {
    const written: Written[] = [];
    await callAs('owner', ENFORCE, written);
    const audit = written.find((w) => w.kind === 'insert' && w.table === 'adminActions');
    expect(audit?.values['evidenceRefs']).toEqual([
      { kind: 'evidence_pack', ref: PACK_ID },
      { kind: 'tos_clause', ref: '7.3(b)' },
      { kind: 'risk_flag', ref: FLAG_ID },
    ]);
  });
});

// -----------------------------------------------------------------------------
// 10. `approved_at` IS NOT WRITTEN, AND THE OMISSION IS DELIBERATE
// -----------------------------------------------------------------------------
// ADR-158 finding 1: `payout_requests.approved_at` is `NOT NULL DEFAULT now()`
// and a held request already carries a false one. This endpoint holds the true
// approval instant and still does not write it, because writing it would destroy
// the request instant irrecoverably while `admin_actions.created_at` already
// records the release. The assertion is here so the omission is a decision
// somebody can find rather than a line somebody forgot.

describe('approved_at', () => {
  it('is untouched by the release, and the release instant lives in admin_actions', async () => {
    const written: Written[] = [];
    await callAs('owner', RELEASE, written);
    const update = written.find((w) => w.kind === 'update' && w.table === 'payoutRequests');
    expect('approvedAt' in (update?.values ?? {})).toBe(false);
    expect(update?.values['updatedAt']).toBe(AT);
  });
});
