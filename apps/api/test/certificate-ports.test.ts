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
  CertificateBackendUnwired,
  resetCertificateBackend,
  useCertificateBackend,
  type CertificateLinks,
  type CertificateRow,
} from '../src/routes/certificates.ts';

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
// 3. THE SET SPLITS TWO AND ONE, AND THE SPLIT IS READ OFF THE LIST
// -----------------------------------------------------------------------------
// Two of the three wait on the card; the third waits on the operator door. The
// last case reads `wiring.test.ts`'s own entries rather than restating the
// split here, on `admin-read-constructibility.test.ts`' rule that a count
// written into a string is not read by anything.
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
// 4. The set splits two and one, read off the list rather than restated
// -----------------------------------------------------------------------------

test('one of the three certificate ports is wired, one waits on the origin and the guard, one on the door', () => {
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

  // THE SET SPLIT TWO-AND-ONE AND IT NOW SPLITS ONE-ONE-ONE, which is ADR-256
  // ruling 13 arriving: the two card ports "no longer expire together, they
  // expire in ORDER", and ADR-261 wired the first of the two. This case is
  // rewritten rather than deleted, on the rule that a case measuring a shape
  // the tree has left behind is a case that stops measuring anything.
  const startSource = readFileSync(join(HERE, '..', 'src', 'start.ts'), 'utf8');
  expect(startSource).toContain('useCertificateImageSource(databaseCertificateImageSource(');
  expect(entries.has('useCertificateImageSource')).toBe(false);

  const list = 'useCertificateBackend';
  const door = 'useCertificateRevokeBackend';
  for (const port of [list, door])
    expect(entries.has(port), `\`${port}\` is not in the BLOCKED list`).toBe(true);

  // THE LIST PORT NAMES THE TWO THINGS IT WAITS ON AND THE REVOKE PORT NAMES
  // NEITHER. Neither half is a count: both are named ports, so a fourth
  // certificate port joining the list fails here rather than passing quietly.
  //
  // CASE-INSENSITIVE, AND THAT IS NOT A DETAIL. These entries shout their
  // findings in capitals and quote their own sources in lower case, so the same
  // word appears both ways inside one reason; a case-sensitive draft of this
  // case failed on `useCertificateBackend` while the word was in the entry
  // twice. `RI-14`'s first draft made the identical mistake and its header
  // records it.
  const ORIGIN = /an origin/i;
  const GUARD = /guard/i;
  const RESOLVER = /principal\(request\)/i;

  expect(entries.get(list), `\`${list}\` stopped naming the origin`).toMatch(ORIGIN);
  // THE GUARD IS THE HALF THAT MATTERS, because the origin alone is a thing a
  // deployment sets and ADR-226 and ADR-229 permit wiring on that. What keeps
  // this port shut is that `links`' refusal is decided by the state of the
  // caller's own rows until something reads the origin BEFORE the rows, and
  // ADR-261 section 5 rules that check is code rather than configuration. An
  // entry that stopped naming it would be an entry a reader could close with
  // one variable.
  expect(entries.get(list), `\`${list}\` stopped naming the guard`).toMatch(GUARD);
  expect(entries.get(list), `\`${list}\` started naming the resolver`).not.toMatch(RESOLVER);

  expect(entries.get(door), `\`${door}\` stopped naming the resolver`).toMatch(RESOLVER);
  expect(entries.get(door), `\`${door}\` started naming the origin`).not.toMatch(ORIGIN);
});
