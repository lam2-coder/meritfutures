// =============================================================================
// apps/api/test/admin-certificates.test.ts
// =============================================================================
// EVERY RESPONSE ASSERTION GOES THROUGH FASTIFY'S REAL ROUTER by way of
// `inject`, over the modules discovered from disk, so a route that is declared
// and never registered fails here rather than in production.
//
// -----------------------------------------------------------------------------
// WHAT THIS SUITE PROVES, AND THE THREE THINGS IT DELIBERATELY DOES NOT
// -----------------------------------------------------------------------------
// It proves what the HANDLER decides: which roles reach it, that `initiative` is
// derived rather than supplied and that supplying it is refused, that the audit
// row is written BEFORE the mutation and carries the triple the mutation
// replaces, that a deferred certificate is refused, and that the response is the
// PUBLIC shape and carries no internal column.
//
// It does not prove that `NOT NULL` refuses an omitted `reason`, which is
// PostgreSQL's; it does not prove what predicate `lockAt` composes, which is
// `packages/db/test/keyed-accessor.test.ts`'; and it does not prove that
// `admin_actions_on_behalf_matches_initiative` refuses a mismatched pair, which
// is the CHECK's. What it proves about that biconditional is that this module
// never asks the database to refuse: the pair it writes satisfies the constraint
// by construction, for every one of the four classes.
//
// -----------------------------------------------------------------------------
// THE SEEDS ARE POISONED
// -----------------------------------------------------------------------------
// The row handed to the route carries `certificates.id`, `identity_id`,
// `account_id`, `payout_request_id` and the INTERNAL `revoked_reason`, and the
// request body carries a reason that is itself internal free text. ADR-170
// section 3 withholds all of them from the public shape, and this row's response
// IS the public shape, so `expectDisclosesNothing` fails on the serialized body
// if any reaches the wire by any path.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test } from 'vitest';

import { TABLE_KEYS } from '@merit/db';
import type { TableKey } from '@merit/db';

import adminCertificates, {
  ADMIN_CERTIFICATE_ENDPOINTS,
  ADMIN_CERTIFICATE_ROLES,
  ADMIN_CERTIFICATE_TABLES,
  AdminCertificateUnwired,
  CERTIFICATE_REVOKE_PATH,
  DERIVED_AUDIT_FIELDS,
  INITIATIVE_BY_CLASS,
  needsOnBehalfOf,
  resetCertificateRevokeBackend,
  toRevocationSubject,
  useCertificateRevokeBackend,
  validateRevokeRequest,
  RevocationSubjectError,
} from '../src/routes/admin-certificates.ts';
import type {
  AdminCertificateTx,
  AdminCertificateValues,
} from '../src/routes/admin-certificates.ts';
import { ADMIN_INITIATIVES } from '../src/routes/admin-writes.ts';
import type { AdminPrincipal, AdminRole } from '../src/routes/admin-writes.ts';
import { REVOCATION_CLASSES } from '../src/routes/certificates.ts';
import { UNKNOWN_STATEMENT } from '../src/routes/verify.ts';
import type { VerifyPresentation, VerifyResponse } from '../src/routes/verify.ts';
import { discoverRouteModules } from '../src/registry.ts';
import { buildServer } from '../src/server.ts';
import { BASE_PATH } from '../src/surface.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');

const CERT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const IDENTITY = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PAYOUT_REQUEST = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const MISSING_ID = '99999999-9999-4999-8999-999999999999';

const AT = new Date('2026-08-28T18:00:00.000Z');

const POISON = {
  email: 'trader@example.invalid',
  displayName: 'Ada Lovelace',
  priorInternalReason: 'internal: prior detector note, flag 4412',
} as const;

/** The reason the operator supplies. INTERNAL, and it writes two columns. */
const REASON = 'internal: the account was closed under ToS 7.3 on 2026-08-27';

const FORBIDDEN: readonly string[] = [
  CERT_ID,
  IDENTITY,
  ACCOUNT,
  PAYOUT_REQUEST,
  POISON.email,
  POISON.displayName,
  POISON.priorInternalReason,
  REASON,
];

function expectDisclosesNothing(payload: string): void {
  for (const forbidden of FORBIDDEN) expect(payload).not.toContain(forbidden);
}

// -----------------------------------------------------------------------------
// The row, as the accessor hands it over
// -----------------------------------------------------------------------------

type Row = Record<string, unknown>;

const SIGNATURE = Uint8Array.of(0xde, 0xad, 0xbe, 0xef, 0xfb, 0xff);

function certRow(over: Row = {}): Row {
  return {
    id: CERT_ID,
    identityId: IDENTITY,
    accountId: ACCOUNT,
    payoutRequestId: PAYOUT_REQUEST,
    kind: 'payout',
    claims: {
      plan_code: 'MERIT-50K',
      size_cents: 5_000_000,
      amount_cents: 250_000,
      trading_day: '2026-08-24',
      // Not in `INV-M11-01`'s four. Dropped by `narrowClaims`.
      email: POISON.email,
      display_name: POISON.displayName,
    },
    code: 'CODE-AAAA',
    issuedAt: new Date('2026-08-24T12:00:00.000Z'),
    claimsSchemaVersion: 1,
    signature: SIGNATURE,
    signingKeyId: 'key-2026-08',
    revokedAt: null,
    revocationClass: null,
    revokedReason: null,
    deferredUntil: null,
    deferredReason: null,
    createdAt: new Date('2026-08-24T12:00:00.000Z'),
    ...over,
  };
}

const STATEMENTS = {
  valid: 'fixture: valid',
  fact_untrue: 'fixture: fact_untrue',
  account_enforced: 'fixture: account_enforced',
  issued_in_error: 'fixture: issued_in_error',
  trader_request: 'fixture: trader_request',
} as const;

const PRESENTATION: VerifyPresentation = {
  statements: { ...STATEMENTS },
  disclosure: 'fixture: simulated environment disclosure',
  floor_ms: 4,
};

// -----------------------------------------------------------------------------
// The fake transaction, which RECORDS THE ORDER OF ITS CALLS
// -----------------------------------------------------------------------------
// The audit row being written FIRST is the property `0026`'s append-only grant
// and `0017`'s "no unexplained admin action" together buy, and it is a property
// of the ORDER rather than of either call. So the recorder keeps the sequence.

interface Call {
  readonly op: 'lockAt' | 'insert' | 'updateAt';
  readonly key: string;
  readonly at?: AdminCertificateValues;
  readonly values?: AdminCertificateValues;
}

interface Harness {
  readonly calls: Call[];
  readonly principal: AdminPrincipal | null;
}

function makeTx(calls: Call[], stored: Row | null): AdminCertificateTx {
  // The row as the transaction holds it, updated in place so the `updateAt`
  // return value is what a real accessor would give back.
  let row: Row | null = stored === null ? null : { ...stored };
  return {
    lockAt: (key, at) => {
      calls.push({ op: 'lockAt', key, at });
      return Promise.resolve(row ?? undefined);
    },
    insert: (key, values) => {
      calls.push({ op: 'insert', key, values });
      return Promise.resolve([values]);
    },
    updateAt: (key, at, values) => {
      calls.push({ op: 'updateAt', key, at, values });
      if (row === null) return Promise.resolve([]);
      row = { ...row, ...values };
      return Promise.resolve([row]);
    },
  };
}

function wire(options: {
  row?: Row | null;
  role?: AdminRole;
  anonymous?: boolean;
  presentation?: VerifyPresentation;
  updateReturnsNothing?: boolean;
}): Harness {
  const calls: Call[] = [];
  const principal: AdminPrincipal | null = options.anonymous
    ? null
    : { actor: 'ops@merit.invalid', role: options.role ?? 'owner' };
  const stored = options.row === undefined ? certRow() : options.row;
  useCertificateRevokeBackend({
    operator: (fn) => {
      const tx = makeTx(calls, stored);
      return fn(
        options.updateReturnsNothing === true
          ? {
              ...tx,
              updateAt: (key, at, values) => {
                calls.push({ op: 'updateAt', key, at, values });
                return Promise.resolve([]);
              },
            }
          : tx,
      );
    },
    principal: () => Promise.resolve(principal),
    now: () => AT,
    presentation: () => options.presentation ?? PRESENTATION,
  });
  return { calls, principal };
}

const onDisk = await discoverRouteModules();

async function revoke(options: {
  id?: string;
  body?: unknown;
  surface?: 'public' | 'operator';
}): Promise<{ statusCode: number; payload: string; json: () => unknown }> {
  const { app } = buildServer({ surface: options.surface ?? 'operator', modules: onDisk });
  const res = await app.inject({
    method: 'POST',
    url: `${BASE_PATH}/admin/certificates/${options.id ?? CERT_ID}/revoke`,
    payload: options.body ?? { revocation_class: 'account_enforced', reason: REASON },
  });
  await app.close();
  return { statusCode: res.statusCode, payload: res.payload, json: () => res.json() };
}

afterEach(() => {
  resetCertificateRevokeBackend();
});

// -----------------------------------------------------------------------------
// The tables this module names are tables that exist
// -----------------------------------------------------------------------------

describe('the tables the module names', () => {
  test('are all keys packages/db registers', () => {
    // The module holds no `@merit/db` import (`src/db.ts` is this deployable's
    // one door onto it), so `AdminCertificateTable` is a hand-written union.
    // THE BINDING IS HERE, where `@merit/db` is reachable.
    const keys: readonly TableKey[] = ADMIN_CERTIFICATE_TABLES;
    for (const key of keys) expect(TABLE_KEYS).toContain(key);
  });

  test('are exactly the two this row writes, and no third', () => {
    expect([...ADMIN_CERTIFICATE_TABLES]).toEqual(['certificates', 'adminActions']);
  });
});

// -----------------------------------------------------------------------------
// The runtime that actually serves this module
// -----------------------------------------------------------------------------

describe('the runtime that actually serves this module', () => {
  test('imports it under `node --experimental-strip-types`, which does not transpile', () => {
    // A construct needing emitted code type-checks, passes under Vitest, and
    // throws `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` when the process starts.
    // `discoverRouteModules` imports EVERY file in `routes/`, so one of them
    // takes the whole deployable down.
    const module = join(HERE, '..', 'src', 'routes', 'admin-certificates.ts');
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
    expect(out).toBe('admin-certificates');
  });
});

// -----------------------------------------------------------------------------
// API_CONTRACT section 8, read rather than remembered
// -----------------------------------------------------------------------------

describe('API_CONTRACT section 8', () => {
  const contract = readFileSync(join(REPO, 'docs/architecture/API_CONTRACT.md'), 'utf8');

  test('declares the heading this module registers', () => {
    expect(contract).toContain('### POST /admin/certificates/:id/revoke');
    expect(ADMIN_CERTIFICATE_ENDPOINTS.map((s) => `${s.method} ${s.path}`)).toEqual([
      'POST /admin/certificates/:id/revoke',
    ]);
    expect(CERTIFICATE_REVOKE_PATH).toBe('/admin/certificates/:id/revoke');
  });

  test('declares owner and ops, and readonly on neither', () => {
    expect(ADMIN_CERTIFICATE_ROLES).toEqual({
      'POST /admin/certificates/:id/revoke': ['owner', 'ops'],
    });
    const section = contract.slice(contract.indexOf('### POST /admin/certificates/:id/revoke'));
    expect(section.slice(0, 4000)).toContain('Roles: `owner` or `ops`');
  });

  test('states that `initiative` is not a request field', () => {
    const section = contract.slice(contract.indexOf('### POST /admin/certificates/:id/revoke'));
    expect(section.slice(0, 4000)).toContain(
      '**`initiative` IS NOT A REQUEST FIELD. It is derived, because the schema will not let it be supplied.**',
    );
  });

  test('states that a deferred certificate cannot be revoked, with `validation_failed`', () => {
    const section = contract.slice(contract.indexOf('### POST /admin/certificates/:id/revoke'));
    expect(section.slice(0, 4000)).toContain('**A DEFERRED CERTIFICATE CANNOT BE REVOKED**');
    expect(section.slice(0, 4000)).toContain('the refusal is `validation_failed`');
  });
});

// -----------------------------------------------------------------------------
// Registration
// -----------------------------------------------------------------------------

describe('where the row is served', () => {
  test('the operator surface registers it and the public surface withholds it', () => {
    const publicReport = buildServer({ surface: 'public', modules: onDisk }).report;
    const operatorReport = buildServer({ surface: 'operator', modules: onDisk }).report;
    const endpoint = `POST ${CERTIFICATE_REVOKE_PATH}`;

    expect(operatorReport.registered).toContain(endpoint);
    expect(publicReport.withheld).toContain(endpoint);
    expect(publicReport.registered).not.toContain(endpoint);
  });

  test('the module registered itself, with no list anywhere naming it', () => {
    // `registry.ts`: "THE MODULE LIST IS THE DIRECTORY LISTING AND IS NEVER
    // WRITTEN DOWN." Verified rather than assumed.
    expect(onDisk.map((m) => m.name)).toContain('admin-certificates');
    expect(adminCertificates.name).toBe('admin-certificates');
  });

  test('the public surface answers 404, and the 404 is the routers', async () => {
    wire({});
    const res = await revoke({ surface: 'public' });
    expect(res.statusCode).toBe(404);
  });
});

// -----------------------------------------------------------------------------
// The derived initiative, which is the ruling
// -----------------------------------------------------------------------------

describe('initiative is derived from revocation_class', () => {
  test('the mapping is total over the CHECKs four members and lands in 0043s three', () => {
    // TOTAL IN BOTH DIRECTIONS. `INITIATIVE_BY_CLASS` is typed
    // `Record<RevocationClass, AdminInitiative>`, so `tsc` refuses a missing key
    // at the declaration; this checks the other way, that it holds no key the
    // column's CHECK does not admit.
    expect(Object.keys(INITIATIVE_BY_CLASS).sort()).toEqual([...REVOCATION_CLASSES].sort());
    for (const value of Object.values(INITIATIVE_BY_CLASS))
      expect(ADMIN_INITIATIVES as readonly string[]).toContain(value);
  });

  test('it is ADR-170 section 6.2s table', () => {
    expect(INITIATIVE_BY_CLASS).toEqual({
      fact_untrue: 'operational',
      account_enforced: 'enforcement',
      issued_in_error: 'operational',
      trader_request: 'trader_request',
    });
  });

  test('exactly the `trader_request` class needs an identity on the audit row', () => {
    // The biconditional `(on_behalf_of_identity_id IS NOT NULL) =
    // (initiative = 'trader_request')`, derived rather than restated.
    for (const klass of REVOCATION_CLASSES)
      expect(needsOnBehalfOf(klass)).toBe(klass === 'trader_request');
  });

  test.each(REVOCATION_CLASSES)('%s writes the pair the CHECK admits', async (klass) => {
    const { calls } = wire({});
    const res = await revoke({ body: { revocation_class: klass, reason: REASON } });
    expect(res.statusCode).toBe(200);

    const audit = calls.find((c) => c.op === 'insert');
    expect(audit?.key).toBe('adminActions');
    const values = audit?.values as Record<string, unknown>;
    expect(values['initiative']).toBe(INITIATIVE_BY_CLASS[klass]);
    // THE BICONDITIONAL, SATISFIED BY CONSTRUCTION. This module never asks the
    // database to refuse the pair.
    const hasOnBehalf = values['onBehalfOfIdentityId'] !== undefined;
    expect(hasOnBehalf).toBe(values['initiative'] === 'trader_request');
    if (hasOnBehalf) expect(values['onBehalfOfIdentityId']).toBe(IDENTITY);
  });
});

// -----------------------------------------------------------------------------
// The two fields this row refuses to be given
// -----------------------------------------------------------------------------

describe('the derived fields are refused and not ignored', () => {
  test('the pair is named as data', () => {
    expect([...DERIVED_AUDIT_FIELDS]).toEqual(['initiative', 'on_behalf_of_identity_id']);
  });

  test.each(DERIVED_AUDIT_FIELDS)('supplying `%s` is a validation_failed', async (field) => {
    // ADR-170 foreclosure 6. An endpoint that dropped it on the floor would let
    // an operator believe they had set it, which is the misattribution
    // `admin_actions_on_behalf_matches_initiative` was written to prevent
    // arriving through a request body.
    const { calls } = wire({});
    const res = await revoke({
      body: { revocation_class: 'account_enforced', reason: REASON, [field]: 'enforcement' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'validation_failed' });
    expect(res.payload).toContain(field);
    // Nothing was written.
    expect(calls.filter((c) => c.op === 'insert' || c.op === 'updateAt')).toEqual([]);
  });

  test('a null `initiative` is still a supplied one', () => {
    const parsed = validateRevokeRequest({
      revocation_class: 'fact_untrue',
      reason: REASON,
      initiative: null,
    });
    expect(parsed.ok).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// The request body
// -----------------------------------------------------------------------------

describe('validateRevokeRequest', () => {
  test('it accepts the contracts two fields', () => {
    const parsed = validateRevokeRequest({ revocation_class: 'fact_untrue', reason: REASON });
    expect(parsed).toEqual({
      ok: true,
      value: { revocation_class: 'fact_untrue', reason: REASON },
    });
  });

  test('an absent `revocation_class` is refused HERE and not left to the column', () => {
    // The column is `text NULL` with a four-member CHECK, so an absent class
    // writes a NULL the CHECK accepts and
    // `certificates_revocation_is_complete` then refuses naming a different
    // column. The contract types it required with no default.
    const parsed = validateRevokeRequest({ reason: REASON });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors[0]?.path).toBe('revocation_class');
  });

  test('a class the CHECK does not admit is refused', () => {
    expect(validateRevokeRequest({ revocation_class: 'withheld', reason: REASON }).ok).toBe(false);
  });

  test('an EMPTY reason is refused here and an ABSENT one is carried', () => {
    // `NOT NULL` refuses OMISSION and admits `''`, measured against PostgreSQL
    // 16 with the whole migration set applied, while section 8 requires a
    // non-empty reason. So the empty one is refused in the weaker place and the
    // absent one is left to the database, with the weakness stated rather than
    // hidden. The missing `CHECK (btrim(reason) <> '')` is ADR-145's finding.
    expect(validateRevokeRequest({ revocation_class: 'fact_untrue', reason: '   ' }).ok).toBe(
      false,
    );
    const absent = validateRevokeRequest({ revocation_class: 'fact_untrue' });
    expect(absent).toEqual({ ok: true, value: { revocation_class: 'fact_untrue' } });
    if (absent.ok) expect('reason' in absent.value).toBe(false);
  });

  test('an absent reason makes the write OMIT the column rather than send an empty string', async () => {
    const { calls } = wire({});
    await revoke({ body: { revocation_class: 'fact_untrue' } });
    const audit = calls.find((c) => c.op === 'insert')?.values as Record<string, unknown>;
    const update = calls.find((c) => c.op === 'updateAt')?.values as Record<string, unknown>;
    expect('reason' in audit).toBe(false);
    expect('revokedReason' in update).toBe(false);
  });

  test('a body that is not an object is refused rather than treated as empty', () => {
    expect(validateRevokeRequest(null).ok).toBe(false);
    expect(validateRevokeRequest([]).ok).toBe(false);
    expect(validateRevokeRequest('revoke it').ok).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Authorization
// -----------------------------------------------------------------------------

describe('who may revoke', () => {
  test('an anonymous caller is 401 and not 403', async () => {
    // 403 to an anonymous caller would tell them the endpoint exists and that a
    // role is the only thing missing.
    wire({ anonymous: true });
    const res = await revoke({});
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'unauthenticated' });
  });

  test('`readonly` is 403 and writes nothing', async () => {
    // `INV-M6-09`: "`readonly` cannot mutate anything."
    const { calls } = wire({ role: 'readonly' });
    const res = await revoke({});
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'forbidden' });
    expect(calls).toEqual([]);
  });

  test.each(['owner', 'ops'] as const)('`%s` may revoke', async (role) => {
    wire({ role });
    const res = await revoke({});
    expect(res.statusCode).toBe(200);
  });
});

// -----------------------------------------------------------------------------
// The subject
// -----------------------------------------------------------------------------

describe('the subject is addressed by `certificates.id`', () => {
  test('the lock is taken on `certificates` by `id` and never by `code`', async () => {
    // `admin_actions.subject_id` is `uuid NOT NULL`, so an audit row keyed on
    // the public token could not be written at all, and `0020` makes `code`
    // rotatable after an incident.
    const { calls } = wire({});
    await revoke({});
    const lock = calls.find((c) => c.op === 'lockAt');
    expect(lock?.key).toBe('certificates');
    expect(lock?.at).toEqual({ id: CERT_ID });
    expect(JSON.stringify(calls)).not.toContain('CODE-AAAA');
  });

  test('a `:id` that is not a uuid names no row', async () => {
    const { calls } = wire({});
    const res = await revoke({ id: 'CODE-AAAA' });
    expect(res.statusCode).toBe(404);
    expect(calls).toEqual([]);
  });

  test('a `:id` that names no row is 404', async () => {
    wire({ row: null });
    const res = await revoke({ id: MISSING_ID });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'not_found' });
  });

  test('`toRevocationSubject` keeps the identity BESIDE the public row', () => {
    const subject = toRevocationSubject(certRow());
    expect(subject.identityId).toBe(IDENTITY);
    // There is no path by which the identity reaches `renderVerify`.
    expect(Object.keys(subject.published)).not.toContain('identityId');
    expect(Object.keys(subject.published)).not.toContain('id');
    expect(Object.keys(subject.published)).not.toContain('revokedReason');
  });

  test('a row with no identity is a defect and not a revocation', () => {
    expect(() => toRevocationSubject(certRow({ identityId: null }))).toThrow(
      RevocationSubjectError,
    );
    expect(() => toRevocationSubject(null)).toThrow(RevocationSubjectError);
  });
});

// -----------------------------------------------------------------------------
// A deferred certificate
// -----------------------------------------------------------------------------

describe('a deferred certificate cannot be revoked', () => {
  test('it is a validation_failed and nothing is written', async () => {
    const { calls } = wire({
      row: certRow({
        deferredUntil: new Date('2026-09-01T00:00:00.000Z'),
        deferredReason: 'an open review is running',
      }),
    });
    const res = await revoke({});

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'validation_failed' });
    // The refusal is this ENDPOINT's and not the schema's: `0020` permits the
    // write. M11 section 3.1 draws no `deferred --> revoked` edge.
    expect(res.payload).toContain('DEFERRED');
    expect(calls.filter((c) => c.op === 'insert' || c.op === 'updateAt')).toEqual([]);
  });

  test('the refusal holds on all four classes, including `account_enforced`', async () => {
    // Encoding `withheld` as deferred-plus-revoked with class
    // `account_enforced` is coherent against every CHECK in `0020` and is
    // refuted by `AS-M11-05`, which fixes that class as "the claim stands".
    for (const klass of REVOCATION_CLASSES) {
      wire({
        row: certRow({
          deferredUntil: new Date('2026-09-01T00:00:00.000Z'),
          deferredReason: 'an open review is running',
        }),
      });
      const res = await revoke({ body: { revocation_class: klass, reason: REASON } });
      expect(res.statusCode).toBe(400);
      resetCertificateRevokeBackend();
    }
  });
});

// -----------------------------------------------------------------------------
// The audit row, which is written first
// -----------------------------------------------------------------------------

describe('the audit row', () => {
  test('it is inserted BEFORE the certificate is updated', async () => {
    // `admin_actions` is append-only under `0026` and its retention is forever,
    // so this row is the record and the mutation is what the record explains.
    const { calls } = wire({});
    await revoke({});
    expect(calls.map((c) => `${c.op} ${c.key}`)).toEqual([
      'lockAt certificates',
      'insert adminActions',
      'updateAt certificates',
    ]);
  });

  test('it names the actor, the action and the subject', async () => {
    const { calls } = wire({});
    await revoke({});
    const values = calls.find((c) => c.op === 'insert')?.values as Record<string, unknown>;
    expect(values['actor']).toBe('ops@merit.invalid');
    expect(values['action']).toBe('certificate.revoke');
    expect(values['subjectKind']).toBe('certificate');
    expect(values['subjectId']).toBe(CERT_ID);
    expect(values['reason']).toBe(REASON);
  });

  test('`before` carries the triple the update replaces, all three columns', async () => {
    // `certificates_revocation_is_complete` writes the three together, so an
    // audit that recorded two of them could not reconstruct the row it changed.
    const { calls } = wire({
      row: certRow({
        revokedAt: new Date('2026-08-26T09:00:00.000Z'),
        revocationClass: 'issued_in_error',
        revokedReason: POISON.priorInternalReason,
      }),
    });
    await revoke({ body: { revocation_class: 'fact_untrue', reason: REASON } });
    const values = calls.find((c) => c.op === 'insert')?.values as Record<string, unknown>;
    expect(values['before']).toEqual({
      revoked_at: '2026-08-26T09:00:00.000Z',
      revocation_class: 'issued_in_error',
      revoked_reason: POISON.priorInternalReason,
    });
    expect(values['after']).toEqual({
      revoked_at: AT.toISOString(),
      revocation_class: 'fact_untrue',
      revoked_reason: REASON,
    });
  });

  test('a first revocations `before` is three nulls', async () => {
    const { calls } = wire({});
    await revoke({});
    const values = calls.find((c) => c.op === 'insert')?.values as Record<string, unknown>;
    expect(values['before']).toEqual({
      revoked_at: null,
      revocation_class: null,
      revoked_reason: null,
    });
  });

  test('A REPLAY IS `before` EQUAL TO `after`, WHICH IS WHY IT IS NOT A CONFLICT', async () => {
    // ADR-170 section 6.2: re-revocation is permitted, correcting a
    // misclassified revocation is a real operation, and `admin_actions`' before
    // and after are what distinguish a correction from a replay. No code is
    // minted for a state the table does not refuse.
    const { calls } = wire({
      row: certRow({
        revokedAt: AT,
        revocationClass: 'account_enforced',
        revokedReason: REASON,
      }),
    });
    const res = await revoke({ body: { revocation_class: 'account_enforced', reason: REASON } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toMatchObject({ code: 'conflict' });
    const values = calls.find((c) => c.op === 'insert')?.values as Record<string, unknown>;
    expect(values['before']).toEqual(values['after']);
  });
});

// -----------------------------------------------------------------------------
// The write
// -----------------------------------------------------------------------------

describe('the certificate write', () => {
  test('all three columns go in one statement', async () => {
    // `certificates_revocation_is_complete`'s own shape: a handler holding one
    // holds all three, and a write that set two would be refused by the
    // database naming a constraint rather than a field.
    const { calls } = wire({});
    await revoke({ body: { revocation_class: 'trader_request', reason: REASON } });
    const update = calls.find((c) => c.op === 'updateAt');
    expect(update?.key).toBe('certificates');
    expect(update?.at).toEqual({ id: CERT_ID });
    expect(update?.values).toEqual({
      revokedAt: AT,
      revocationClass: 'trader_request',
      revokedReason: REASON,
    });
  });

  test('an update that touched no row is a defect and not a 200', async () => {
    wire({ updateReturnsNothing: true });
    const res = await revoke({});
    // The row was locked, so this cannot happen; it answers 500 rather than
    // rendering a response the database does not hold.
    expect(res.statusCode).toBe(500);
  });
});

// -----------------------------------------------------------------------------
// The response, which is the public shape
// -----------------------------------------------------------------------------

describe('the response is what the verify page will say', () => {
  test.each(REVOCATION_CLASSES)('%s renders the class sentence and the claims', async (klass) => {
    wire({});
    const res = await revoke({ body: { revocation_class: klass, reason: REASON } });

    expect(res.statusCode).toBe(200);
    const body = res.json() as VerifyResponse;
    expect(body.result).toBe('revoked');
    expect(body.statement).toBe(STATEMENTS[klass]);
    expect(body.revoked).toEqual({ at: AT.toISOString(), class: klass });
    // `AS-M11-05`: the claim stands. The operator sees the page's own words.
    expect(body.certificate).not.toBeNull();
    expect(body.certificate?.claims).toEqual({
      plan_code: 'MERIT-50K',
      size_cents: 5_000_000,
      amount_cents: 250_000,
      trading_day: '2026-08-24',
    });
    expect(body.certificate?.code).toBe('CODE-AAAA');
    expect(body.statement).not.toBe(UNKNOWN_STATEMENT);
  });

  test('it carries no internal column and no key the public surface withholds', async () => {
    wire({});
    const res = await revoke({});
    // ADR-170 section 3: no `certificates.id`, no `payout_request_id`, no
    // `revoked_reason`, and none of `INV-M11-01`'s withheld set. The operator's
    // OWN reason does not come back either, because the response is the PUBLIC
    // shape rather than a receipt.
    expectDisclosesNothing(res.payload);
  });

  test('it is rendered from the row the database holds and not from the request', async () => {
    // A preview composed from the request would be a preview of the request.
    // The stored row's `issued_at` and `code` are on the response, and neither
    // was in the body.
    wire({});
    const res = await revoke({});
    const body = res.json() as VerifyResponse;
    expect(body.certificate?.issued_at).toBe('2026-08-24T12:00:00.000Z');
    expect(body.certificate?.signing_key_id).toBe('key-2026-08');
  });
});

// -----------------------------------------------------------------------------
// The unwired deployment
// -----------------------------------------------------------------------------

describe('an unwired backend', () => {
  // ADR-192 clause 2. THE 503 DID NOT GO AWAY; IT MOVED BEHIND THE 401. Which
  // of this deployment's ports are uncomposed is a fact about the deployment,
  // and an anonymous caller may not have it, so `principal`'s refusal answers
  // 401. `operator` and `presentation` still answer 503, and the two cases
  // below the first are the legs that would pass by accident if this module
  // simply stopped sending 503 at all.
  test('answers 401 and not 503, revokes nothing, and discloses no deployment state', async () => {
    const res = await revoke({});
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'unauthenticated', status: 401 });
  });

  test('answers 503 to an authenticated operator whose deployment wired no `operator`', async () => {
    const { calls } = wire({});
    useCertificateRevokeBackend({
      operator: () => Promise.reject(new AdminCertificateUnwired('operator')),
      principal: () => Promise.resolve({ actor: 'ops@merit.invalid', role: 'owner' }),
      now: () => AT,
      presentation: () => PRESENTATION,
    });
    const res = await revoke({});
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: 'service_unavailable', status: 503 });
    expect(calls).toEqual([]);
  });

  test('a backend with no copy answers 503 rather than committing a write it cannot show', async () => {
    // `AS-M11-05`'s control is that an operator is shown the sentence they
    // caused AT THE MOMENT OF THE ACT. Committing and then failing to render
    // would be that control lost in the one direction nothing undoes, so the
    // presentation is resolved before the transaction opens.
    const statements: Record<string, unknown> = { ...STATEMENTS };
    delete statements['account_enforced'];
    const { calls } = wire({
      presentation: { ...PRESENTATION, statements } as unknown as VerifyPresentation,
    });
    const res = await revoke({});
    expect(res.statusCode).toBe(503);
    expect(calls).toEqual([]);
  });
});
