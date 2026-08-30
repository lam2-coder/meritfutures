import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { BASE_PATH, buildServer, discoverRouteModules } from '../src/index.ts';
import {
  resetAuthBackend,
  SESSION_COOKIE,
  UNWIRED_AUTH_BACKEND,
  useAuthBackend,
  type AuthSession,
} from '../src/routes/auth.ts';
import {
  CERTIFICATE_ORIGIN_VAR,
  CertificateBackendUnwired,
  databaseCertificateBackend,
  resetCertificateBackend,
  useCertificateBackend,
  type CertificateLinks,
  type CertificateRow,
} from '../src/routes/certificates.ts';
import type { Environment } from '../src/surface.ts';
import { recordingDb } from './db-recorder.ts';

// CI-02, the `unit` project.
//
// =============================================================================
// THE THREE CERTIFICATE PORTS READ AS A SET, AND THE TWO THINGS THAT READING
// FOUND
// =============================================================================
// `useCertificateBackend`, `useCertificateImageSource` and
// `useCertificateRevokeBackend` are three BLOCKED entries about ONE artefact,
// and until ADR-246 nobody had read them together. `certificate-links.test.ts`
// is ADR-240's file and executes what that entry measured: that no card
// renderer exists and that the image row verifies no signature. This file is
// the SET reading, and it executes two claims that only appear when the three
// are read beside each other.
//
// -----------------------------------------------------------------------------
// 1. THE `links` ARM'S OWN MESSAGE PROMISES A 503 AND THE ROUTE ANSWERED 500
// -----------------------------------------------------------------------------
// `CertificateBackendUnwired`'s message reads "so `GET /certificates` answers
// 503 rather than an empty list", and it is raised by BOTH arms of the port.
// The list handler guarded `readCertificates` inside a `try` and called
// `renderCertificates` after it, so a refusal from `links` left the handler as
// an unhandled error and `server.ts` answered 500. ADR-240 section 4 ruled that
// exact shape on `economic-calendar.ts`: an unwired port is a 503 and never a
// 500, because a 500 sends an operator hunting for a defect when what is
// missing is a line in `start.ts`. ADR-246 applies the standing ruling to the
// file ADR-240 read and did not repair.
//
// -----------------------------------------------------------------------------
// 2. AND THE STATUS CODE IS NOT THE REASON A HALF-WIRING IS REFUSED
// -----------------------------------------------------------------------------
// `projectCertificate` never calls `links` for a deferred row, by construction
// (ADR-168 foreclosure 4). So a backend whose read is live and whose signer
// refuses answers 200 to a trader whose certificates are all deferred and
// refuses the trader beside them whose certificate issued. THAT IS A RESPONSE
// DECIDED BY THE STATE OF THE CALLER'S OWN ROWS, which is the shape
// `verify.ts`' `readPresentation` refuses in its own words, and repairing the
// status code does not remove it. It is executed here so that a later session
// tempted to raise the wired count by half-wiring this port meets a failing
// expectation rather than a sentence.
//
// -----------------------------------------------------------------------------
// 2b. THE PORT IS WIRED NOW AND THAT CASE IS KEPT, BECAUSE IT MEASURES THE PORT
// AND NOT THE ADAPTER (ADR-266)
// -----------------------------------------------------------------------------
// `CertificateBackend` is TWO methods and the second is SYNCHRONOUS and called
// PER RENDERED ROW, so a caller composing the two arms by hand can still build
// the shape above, and the case that measures it stays. WHAT CHANGED IS THAT THE
// FACTORY CANNOT BUILD ONE: `databaseCertificateBackend` resolves the origin out
// of the environment in BOTH arms, and it resolves it in the READ arm before the
// accessor is opened, so a deployment that has not set it refuses every caller
// alike and the scoped door is never touched.
//
// THE ASSERTION THAT MAKES THAT STATE-INDEPENDENT RATHER THAN UNIFORM-TODAY IS
// THE RECORDER'S CALL LIST, not the pair of status codes. A check that ran after
// the read would satisfy "both answers are 503" and still be an oracle the
// moment a branch was added below it, which is `certificate-image-source.ts`'
// own stated reason for asserting on an EMPTY call list one port over.
//
// -----------------------------------------------------------------------------
// 3. THE SET HAS FINISHED SPLITTING, AND IT IS READ OFF THE LIST
// -----------------------------------------------------------------------------
// Both card ports are wired; the third waits on the operator door and the card
// landing did nothing for it. The last case reads `wiring.test.ts`'s own entries
// rather than restating the split here, on `admin-read-constructibility.test.ts`'
// rule that a count written into a string is not read by anything.
// =============================================================================

const HERE = import.meta.dirname;
const MIGRATIONS = join(HERE, '..', '..', '..', 'packages', 'db', 'migrations');
const WIRING = join(HERE, 'wiring.test.ts');

const onDisk = await discoverRouteModules();

const IDENTITY = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'token-a';

const SESSION: AuthSession = {
  id: 'session-a',
  identityId: IDENTITY,
  userId: 'user-a',
  authFactor: 'email_otp',
  elevatedAt: null,
  elevatedByFactor: null,
};

/** An issued pass. `projectCertificate` calls `links` for this one. */
const ISSUED: CertificateRow = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  kind: 'pass',
  claims: { plan_code: 'MERIT-50K', size_cents: 5_000_000, trading_day: '2026-08-24' },
  code: 'CODE-AAAA',
  issuedAt: '2026-08-24T12:00:00.000Z',
  revokedAt: null,
  revocationClass: null,
  deferredUntil: null,
  deferredReason: null,
};

/** A deferred pass. There is no path through `projectCertificate` that mints for it. */
const DEFERRED: CertificateRow = {
  ...ISSUED,
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  code: 'CODE-BBBB',
  deferredUntil: '2026-09-01T00:00:00.000Z',
  deferredReason: 'An open review is running on this account.',
};

/**
 * The half-wiring ADR-240 clause 10 forbids, built here so it can be measured.
 *
 * THE READ IS LIVE AND THE SIGNER REFUSES, which is what a session that wired
 * this port on the strength of `databaseCertificateBackend` alone would have
 * installed. Nothing in this file installs it into `start.ts`, and the wiring
 * count in `wiring.test.ts` is unchanged.
 */
function halfWire(rows: readonly CertificateRow[]): void {
  useAuthBackend({
    ...UNWIRED_AUTH_BACKEND,
    sessionByToken: (token) => Promise.resolve(token === TOKEN ? SESSION : null),
  });
  useCertificateBackend({
    readCertificates: () => Promise.resolve(rows),
    links: (): CertificateLinks => {
      throw new CertificateBackendUnwired('links');
    },
  });
}

async function list(): Promise<{ status: number; code: unknown }> {
  const { app } = buildServer({ surface: 'public', modules: onDisk });
  const res = await app.inject({
    method: 'GET',
    url: `${BASE_PATH}/certificates`,
    headers: { cookie: `${SESSION_COOKIE}=${TOKEN}` },
  });
  await app.close();
  const body: unknown = res.statusCode === 200 ? null : res.json();
  return {
    status: res.statusCode,
    code: typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : null,
  };
}

afterEach(() => {
  resetAuthBackend();
  resetCertificateBackend();
});

// -----------------------------------------------------------------------------
// 1. Both arms of the port refuse with the code the port's own message names
// -----------------------------------------------------------------------------

test('a refusal from the `links` arm is a 503 and not a 500', async () => {
  // WATCHED RED BEFORE IT WAS GREEN. Against the tree ADR-246 was dispatched on
  // this returned 500 / `internal_error`, because `renderCertificates` was
  // called outside the region that catches `CertificateBackendUnwired`.
  halfWire([ISSUED]);
  expect(await list()).toStrictEqual({ status: 503, code: 'service_unavailable' });
});

test('the message the `links` arm carries is the one the route now honours', () => {
  // RI-14's shape at test scale: the sentence and the behaviour are asserted
  // together, so neither can go false on its own.
  expect(new CertificateBackendUnwired('links').message).toMatch(
    /CertificateBackend\.links is not wired.*answers 503/s,
  );
});

// -----------------------------------------------------------------------------
// 2. And the refusal is decided by the caller's own rows either way
// -----------------------------------------------------------------------------

test('a half-wired backend answers by the state of the rows it was asked about', async () => {
  // THIS IS THE REASON THE PORT STAYS UNWIRED AND IT SURVIVES THE REPAIR ABOVE.
  // The two calls differ in nothing but the state of one row, and the deployment
  // answers one of them and refuses the other. A trader with a deferred
  // certificate would be served; the trader beside them whose certificate issued
  // would not, and neither could be told why.
  halfWire([DEFERRED]);
  const deferredOnly = await list();
  resetCertificateBackend();

  halfWire([ISSUED]);
  const carriesIssued = await list();

  expect(deferredOnly.status).toBe(200);
  expect(carriesIssued.status).toBe(503);
  expect(deferredOnly.status).not.toBe(carriesIssued.status);
});

// -----------------------------------------------------------------------------
// 2b. The guard: the origin is read BEFORE the rows, so no caller's rows decide
// -----------------------------------------------------------------------------

/** One `certificates` row as the ACCESSOR hands it over: camelCase, `Date` instants. */
function accessorRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ISSUED.id,
    identityId: IDENTITY,
    accountId: '55555555-5555-4555-8555-555555555555',
    payoutRequestId: null,
    signature: Uint8Array.of(1, 2, 3),
    signingKeyId: 'key-2026-08',
    claimsSchemaVersion: 1,
    kind: 'pass',
    claims: { plan_code: 'MERIT-50K', size_cents: 5_000_000, trading_day: '2026-08-24' },
    code: ISSUED.code,
    issuedAt: new Date(ISSUED.issuedAt),
    revokedAt: null,
    revokedReason: null,
    revocationClass: null,
    deferredUntil: null,
    deferredReason: null,
    createdAt: new Date(ISSUED.issuedAt),
    ...over,
  };
}

/** The deferred twin of the row above. It differs in the two deferral columns and nothing else. */
const DEFERRED_ROW = accessorRow({
  id: DEFERRED.id,
  code: DEFERRED.code,
  deferredUntil: new Date('2026-09-01T00:00:00.000Z'),
  deferredReason: DEFERRED.deferredReason,
});

/**
 * The port as `start.ts` installs it: the FACTORY over a recorded door and an
 * environment, rather than two arms a caller composed.
 */
function wireFromFactory(rows: readonly Record<string, unknown>[], env: Environment): void {
  useAuthBackend({
    ...UNWIRED_AUTH_BACKEND,
    sessionByToken: (token) => Promise.resolve(token === TOKEN ? SESSION : null),
  });
  const { db } = recordingDb({ rows: [...rows] });
  useCertificateBackend(databaseCertificateBackend(db, env));
}

test('the adapter over an unset origin answers the same to both callers', async () => {
  // THIS IS THE CASE ABOVE WITH THE HALF-WIRING REPLACED BY THE REAL FACTORY,
  // and it is the whole of what ADR-266 had to establish. The two calls differ
  // in nothing but the state of one row. Above, the deployment answers one and
  // refuses the other; here it must refuse both, because the origin is read
  // before the door is opened and a refusal that happened before the read
  // cannot have been decided by what the read returned.
  wireFromFactory([DEFERRED_ROW], {});
  const deferredOnly = await list();
  resetCertificateBackend();

  wireFromFactory([accessorRow()], {});
  const carriesIssued = await list();

  expect(deferredOnly).toStrictEqual({ status: 503, code: 'service_unavailable' });
  expect(carriesIssued).toStrictEqual(deferredOnly);
});

/** A configured deployment. No real hostname reaches this repository (ADR-012). */
const ORIGIN_SET = { [CERTIFICATE_ORIGIN_VAR]: 'https://cards.example.invalid' };

test('the same two callers are both served once the origin is set', async () => {
  // THE OTHER DIRECTION, because a guard that refused everything would pass the
  // case above and serve nobody. `links` is called for the issued row and not
  // for the deferred one, and neither call refuses.
  wireFromFactory([DEFERRED_ROW], ORIGIN_SET);
  const deferredOnly = await list();
  resetCertificateBackend();

  wireFromFactory([accessorRow()], ORIGIN_SET);
  const carriesIssued = await list();

  expect(deferredOnly.status).toBe(200);
  expect(carriesIssued).toStrictEqual(deferredOnly);
});

test('the read door is never opened when the origin is unusable', async () => {
  // THE ASSERTION THAT MAKES THE PROPERTY STATE-INDEPENDENT RATHER THAN MERELY
  // UNIFORM TODAY, and it is `certificate-image-source.ts`' recorder assertion
  // at this port: a check that ran AFTER the read would satisfy "both answers
  // are 503" and still be an oracle the moment a branch was added below it.
  // The recorder's call list is the observation, and it is EMPTY.
  useAuthBackend({
    ...UNWIRED_AUTH_BACKEND,
    sessionByToken: (token) => Promise.resolve(token === TOKEN ? SESSION : null),
  });
  const { db, calls } = recordingDb({ rows: [accessorRow()] });
  useCertificateBackend(databaseCertificateBackend(db, {}));

  expect(await list()).toStrictEqual({ status: 503, code: 'service_unavailable' });
  expect(calls).toStrictEqual([]);
});

// -----------------------------------------------------------------------------
// 3. The one artefact the two remaining ports wait on has no column either
// -----------------------------------------------------------------------------

/** `certificates`' column names, read out of the migration that creates it. */
function certificateColumns(): readonly string[] {
  const sql = readFileSync(join(MIGRATIONS, '0020_public_surface.sql'), 'utf8');
  const open = sql.indexOf('CREATE TABLE certificates (');
  expect(open, 'the CREATE TABLE for `certificates` was not found').toBeGreaterThan(-1);
  const body = sql.slice(open, sql.indexOf('\n);', open));
  // One column is one identifier at two spaces of indent. `CONSTRAINT` is
  // written at the same indent and is excluded by name.
  return [...body.matchAll(/^ {2}([a-z_]+)\b/gm)]
    .map((match) => match[1] ?? '')
    .filter((name) => name !== 'constraint');
}

test('`certificates` carries no image location column, and no migration adds one', () => {
  // THE CLAIM IS `account-reads.ts`' CERTIFICATE_BLOCKER's, in its own words:
  // the table carries "NO image location column, so there is not even a stored
  // value to sign". ADR-240 quoted it and did not execute it. `0020` itself
  // states the reason one line above the DDL: "THE CARD IS A RENDERING; THE
  // CERTIFICATE IS THE ROW."
  //
  // THE SET IS NAMED RATHER THAN COUNTED, so a column added tomorrow fails here
  // with its own name in the diff rather than moving a number.
  expect(certificateColumns()).toStrictEqual([
    'id',
    'account_id',
    'identity_id',
    'kind',
    'payout_request_id',
    'claims',
    'signature',
    'signing_key_id',
    'code',
    'claims_schema_version',
    'issued_at',
    'revoked_at',
    'revoked_reason',
    'revocation_class',
    'deferred_until',
    'deferred_reason',
    'created_at',
  ]);

  // AND THE COLUMN SET IS THE WHOLE COLUMN SET, which only holds while nothing
  // alters the table. Migrations are forward-only and this sweep reads every
  // one of them rather than the ones a reader remembered.
  const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql'));
  expect(files.length, 'the migration sweep reached no files').toBeGreaterThan(60);
  const altered = files.filter((name) =>
    /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?certificates\b/i.test(
      readFileSync(join(MIGRATIONS, name), 'utf8'),
    ),
  );
  expect(altered).toStrictEqual([]);
});

// -----------------------------------------------------------------------------
// 4. The set has finished splitting: two wired, one on the door
// -----------------------------------------------------------------------------

test('two of the three certificate ports are wired and the third waits on the door', () => {
  const source = readFileSync(WIRING, 'utf8');
  const start = source.indexOf('const BLOCKED');
  const listing = source.slice(start, source.indexOf('\n};', start));
  const heads = [...listing.matchAll(/^ {2}([a-zA-Z]+):/gm)];
  const entries = new Map(
    heads.map((head, index) => [
      head[1] ?? '',
      listing.slice(
        (head.index ?? 0) + head[0].length,
        index + 1 < heads.length ? (heads[index + 1]?.index ?? listing.length) : listing.length,
      ),
    ]),
  );

  // THE SET SPLIT TWO-AND-ONE, THEN ONE-ONE-ONE, AND NOW TWO-AND-ONE THE OTHER
  // WAY UP. That is ADR-256 ruling 13 finishing: the two card ports "no longer
  // expire together, they expire in ORDER", ADR-261 wired the first and ADR-266
  // the second. This case is rewritten each time rather than deleted, on the
  // rule that a case measuring a shape the tree has left behind is a case that
  // stops measuring anything.
  const startSource = readFileSync(join(HERE, '..', 'src', 'start.ts'), 'utf8');
  for (const line of [
    'useCertificateImageSource(databaseCertificateImageSource(',
    'useCertificateBackend(databaseCertificateBackend(',
  ])
    expect(startSource, `\`${line}\` is not installed in start.ts`).toContain(line);

  for (const port of ['useCertificateImageSource', 'useCertificateBackend'])
    expect(entries.has(port), `\`${port}\` is still BLOCKED`).toBe(false);

  // THE THIRD IS NOT ABOUT THE CARD AND THE CARD LANDING DOES NOTHING FOR IT.
  // Its entry names the resolver and must not start naming an origin: the day it
  // does, somebody has read the two wirings above as a precedent for a port whose
  // obstruction is an admin identity nobody in this tree can install.
  //
  // CASE-INSENSITIVE, AND THAT IS NOT A DETAIL. These entries shout their
  // findings in capitals and quote their own sources in lower case, so the same
  // word appears both ways inside one reason; a case-sensitive draft of the case
  // this one replaces failed on a word that was in the entry twice. `RI-14`'s
  // first draft made the identical mistake and its header records it.
  const door = 'useCertificateRevokeBackend';
  expect(entries.has(door), `\`${door}\` is not in the BLOCKED list`).toBe(true);
  expect(entries.get(door), `\`${door}\` stopped naming the resolver`).toMatch(
    /principal\(request\)/i,
  );
  expect(entries.get(door), `\`${door}\` started naming the origin`).not.toMatch(/an origin/i);
});
