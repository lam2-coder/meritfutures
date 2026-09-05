import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PUBLIC_LOOKUP_ADDRESS } from '@merit/db';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { resetCertificateRateLimiter } from '../src/certificate-rate-limit.ts';
import { admitEveryRequest } from './support/certificate-rate-limit.ts';

import { BASE_PATH, buildServer, discoverRouteModules } from '../src/index.ts';
import {
  projectCertificate,
  resetCertificateImageSource,
  useCertificateImageSource,
  type CertificateLinks,
  type CertificateLookup,
  type CertificateObservation,
  type CertificateRow,
} from '../src/routes/certificates.ts';

// CI-02, the `unit` project.
//
// =============================================================================
// WHERE THE CARD COMES FROM AND WHERE IT LIVES, EXECUTED (ADR-249)
// =============================================================================
// ADR-246 collapsed three certificate ports into two questions and ONE absent
// artefact, and left four things open: what renders the card, when, into what
// store, and how a URL for it reaches the row. ADR-249 rules all four, and the
// answer to the last one is that no URL reaches the row at all. This file is
// that ruling made executable, because a ruling nothing runs is a comment.
//
// -----------------------------------------------------------------------------
// 1. THE CARD IS DRAWN FROM COLUMNS THAT ALL EXIST, SO A RENDERER NEEDS NO DDL
// -----------------------------------------------------------------------------
// Every value the card draws is fixed by an approved invariant: INV-M11-01
// bounds the claim, INV-M11-04 renders the disclosure by template, INV-M11-07
// puts the revocation class on the public sentence, and M11 section 3.1 makes
// deferral a state. Each of those reads a column `0020_public_surface.sql`
// already wrote. The partition below is TOTAL over the seventeen columns, so a
// column reclassified in either direction fails here with its own name.
//
// -----------------------------------------------------------------------------
// 2. AND THE ONE THING THE CORPUS ASKS FOR THAT THE TABLE HAS NOT GOT IS A
//    VERSION, WHICH ADR-249 RULES DERIVED RATHER THAN STORED
// -----------------------------------------------------------------------------
// FM-M11-05's own remedy caches rendered bytes keyed by `(code, row_version)`.
// `certificates` carries no `row_version`, no `version` and no `updated_at`,
// and ADR-249 rules that it needs none: the rendering inputs are on the row, so
// a digest over the value handed to the template IS the version, and it cannot
// drift from what was drawn the way a stored counter can. Both halves are
// measured here, the corpus sentence and the column set, so the finding cannot
// go stale in one half only.
//
// -----------------------------------------------------------------------------
// 3. THE ADDRESS IS A FUNCTION OF THE CODE AND OF NOTHING ELSE
// -----------------------------------------------------------------------------
// This is the schema question ADR-246 measured, answered structurally rather
// than by adding a column: `projectCertificate` hands `links` the code and no
// other field of the row can reach it. `0020` separated `code` from `id` so
// that the public token could be rotated without rewriting the primary key,
// and that separation is exactly what makes the public artefact addressable
// without a stored address.
//
// -----------------------------------------------------------------------------
// 4. AND THE CODE IS ALREADY THE WHOLE CREDENTIAL ON THE PUBLIC PATH
// -----------------------------------------------------------------------------
// `PUBLIC_LOOKUP_ADDRESS` is `{ certificates: ['code'] }`, and
// `packages/db/src/index.ts` states what membership of it MEANS: "an assertion
// that the named column is unguessable, because the address is the entire
// predicate and there is no tenancy conjunct to fall back on". A signed URL on
// top of that is a second credential on a door this estate already ruled the
// code opens. The image endpoint is asserted to carry the code and nothing
// else, so a signature added later fails here rather than being noticed.
//
// -----------------------------------------------------------------------------
// 5. THE ROUTE ITSELF REFUSES A LOOKUP THAT DID NOT RENDER ON THIS FETCH
// -----------------------------------------------------------------------------
// INV-M11-08 is the reason the endpoint exists rather than a static asset, and
// `imageHandler` already enforces it: a non-deferred lookup carrying no card is
// a defect and not a 404. That is render-on-fetch executed at the route, and it
// is what a design that served a stored object would have to argue with.
// =============================================================================

const HERE = import.meta.dirname;
const MIGRATIONS = join(HERE, '..', '..', '..', 'packages', 'db', 'migrations');
const M11 = join(HERE, '..', '..', '..', 'docs', 'plans', 'M11-certificates-social-proof.md');

const onDisk = await discoverRouteModules();

/** `certificates`' column names, read out of the migration that creates it. */
function certificateColumns(): readonly string[] {
  const sql = readFileSync(join(MIGRATIONS, '0020_public_surface.sql'), 'utf8');
  const open = sql.indexOf('CREATE TABLE certificates (');
  expect(open, 'the CREATE TABLE for `certificates` was not found').toBeGreaterThan(-1);
  const body = sql.slice(open, sql.indexOf('\n);', open));
  return [...body.matchAll(/^ {2}([a-z_]+)\b/gm)]
    .map((match) => match[1] ?? '')
    .filter((name) => name !== 'constraint');
}

/** An issued pass. Every field below is a real column of the row. */
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

const LINKS: CertificateLinks = {
  verify_url: 'about:blank#verify',
  image_url: 'about:blank#image',
};

// THE LIMIT IS NOT WHAT THIS FILE ASSERTS AND IT SAYS SO RATHER THAN INHERITING
// IT. ADR-347 put a fail-closed rate limiter ahead of both public certificate
// rows, so every case below would answer 503 under the port's own default. The
// stub `admitEveryRequest` installs counts nothing, which keeps a per-file
// request budget from coupling cases that assert something else;
// `certificate-rate-limit.test.ts` is where the real limiter is driven over its
// threshold, held under it, and stripped of its configuration.
beforeEach(() => {
  admitEveryRequest();
});

afterEach(() => {
  resetCertificateImageSource();
  resetCertificateRateLimiter();
});

// -----------------------------------------------------------------------------
// 1. A renderer needs no column that does not exist
// -----------------------------------------------------------------------------

test('every value the card renders is a column `certificates` already carries', () => {
  // WHAT THE TEMPLATE DRAWS, each with the approved sentence that puts it
  // there. `code` is on the card because SD-M11-01 says the token "appears in
  // the image and resolves on the verify page".
  const RENDERED = [
    'kind', // M11 section 3.1: a pass card and a payout card are different cards
    'claims', // INV-M11-01, the whole of the claim
    'claims_schema_version', // INV-M11-05: the claim shape may evolve
    'code', // SD-M11-01: the token appears IN the image
    'issued_at', // INV-M11-11: what was true when it was issued
    'revoked_at', // INV-M11-08 and AS-M11-02: a revoked certificate renders as revoked
    'revocation_class', // INV-M11-07: the class drives the published sentence
    'deferred_until', // M11 section 3.1: a deferred claim is not made, so it does not render
  ];

  // WHAT IT DOES NOT DRAW, and each is a deliberate absence rather than an
  // oversight. `signature` and `signing_key_id` belong to the CLAIM signer and
  // are read by the verify page, never painted onto the card; `revoked_reason`
  // is internal free text (AS-M11-05); the three identifiers are the tenancy
  // and INV-M11-01 keeps a person off the card entirely.
  const NOT_RENDERED = [
    'id',
    'account_id',
    'identity_id',
    'payout_request_id',
    'signature',
    'signing_key_id',
    'deferred_reason',
    'revoked_reason',
    'created_at',
  ];

  const columns = certificateColumns();

  // THE PARTITION IS TOTAL, which is the property that makes this a control
  // rather than a list: a column added to the table belongs to one side or the
  // other and a reader has to say which.
  expect([...RENDERED, ...NOT_RENDERED].sort()).toStrictEqual([...columns].sort());

  // AND THE RENDERING SIDE IS THE HALF THE RULING RESTS ON. Every input the
  // card needs is already on the row, so the renderer ADR-246 measured absent
  // can be written without a migration.
  for (const name of RENDERED) expect(columns, `\`${name}\` is not a column`).toContain(name);
});

// -----------------------------------------------------------------------------
// 2. The cache key the corpus names is a column that does not exist
// -----------------------------------------------------------------------------

test("FM-M11-05's `row_version` is not a column, and ADR-249 rules it derived", () => {
  // THE CORPUS SENTENCE IS READ RATHER THAN QUOTED, on `certificate-code.ts`'s
  // precedent of reading `INV-M11-05`'s "128 bits" out of M11 itself. If the
  // remedy is ever rewritten, this half goes red and the ruling gets re-read.
  const m11 = readFileSync(M11, 'utf8');
  const row = m11.split('\n').find((line) => line.startsWith('| FM-M11-05 |'));
  expect(row, 'FM-M11-05 has no row in M11 section 6').toBeDefined();
  expect(row).toContain('(code, row_version)');

  // AND THE COLUMN IT NAMES IS NOT THERE. `claims_schema_version` is the only
  // column carrying the word and it versions the CLAIM SHAPE (SD-M11-01), not
  // the row: two rows at one schema version render differently the moment one
  // of them is revoked.
  const columns = certificateColumns();
  expect(columns).not.toContain('row_version');
  expect(columns).not.toContain('version');
  expect(columns).not.toContain('updated_at');
  expect(columns.filter((name) => name.includes('version'))).toStrictEqual([
    'claims_schema_version',
  ]);
});

// -----------------------------------------------------------------------------
// 3. The address is a function of the code alone
// -----------------------------------------------------------------------------

test('`projectCertificate` hands the address function the code and nothing else', () => {
  const calls: unknown[][] = [];
  const spy = (...args: [string]): CertificateLinks => {
    calls.push(args);
    return LINKS;
  };

  // TWO ROWS THAT SHARE A CODE AND DIFFER IN EVERY OTHER MUTABLE FIELD. If any
  // of them could reach the address, the two calls would not be identical, and
  // the case for a stored image location would be a case this assertion loses.
  const revoked: CertificateRow = {
    ...ISSUED,
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    kind: 'payout',
    claims: { ...ISSUED.claims, amount_cents: 250_000 },
    issuedAt: '2026-01-02T03:04:05.000Z',
    revokedAt: '2026-08-25T09:00:00.000Z',
    revocationClass: 'issued_in_error',
  };

  projectCertificate(ISSUED, spy);
  projectCertificate(revoked, spy);

  expect(calls).toStrictEqual([[ISSUED.code], [ISSUED.code]]);
});

// -----------------------------------------------------------------------------
// 4. The code is the whole credential the public path carries
// -----------------------------------------------------------------------------

test('the image row is addressed by the code and carries no second credential', async () => {
  // THE ESTATE ALREADY RULED THE CODE SUFFICIENT for an unauthenticated read of
  // an `owned` row (ADR-231, ADR-235's mint). A signed URL would be a second
  // secret on the same door, and ADR-240 ruled the key for it out of this
  // deployable. ADR-249 rules the key out of the DESIGN.
  expect(PUBLIC_LOOKUP_ADDRESS).toStrictEqual({ certificates: ['code'] });

  const looked: unknown[][] = [];
  const observed: CertificateObservation[] = [];
  useCertificateImageSource({
    lookup: (...args: [string]): Promise<CertificateLookup | null> => {
      looked.push(args);
      return Promise.resolve(null);
    },
    record: (observation) => {
      observed.push(observation);
      return Promise.resolve();
    },
  });

  const { app } = buildServer({ surface: 'public', modules: onDisk });
  const res = await app.inject({
    method: 'GET',
    // A SIGNATURE AND AN EXPIRY DRESSED ONTO THE URL, which API_CONTRACT
    // section 6.3 gives no slot for: "the path token only, no query, no body".
    url: `${BASE_PATH}/certificates/CODE-AAAA/image.png?sig=deadbeef&expires=9999999999`,
  });
  await app.close();

  expect(res.statusCode).toBe(404);
  expect(looked).toStrictEqual([['CODE-AAAA']]);
  expect(observed).toStrictEqual([{ code: 'CODE-AAAA', result: 'unknown', ip: '127.0.0.1' }]);
});

// -----------------------------------------------------------------------------
// 5. Render on fetch, enforced by the route rather than described by it
// -----------------------------------------------------------------------------

test('a lookup that resolves a live row and renders nothing is a defect', async () => {
  // A STORED-OBJECT DESIGN ARRIVES HERE. A source that resolved the row's state
  // from the table and left the bytes to whatever the object store last wrote
  // has no card to hand this route on the fetch that matters, and the route
  // calls that what it is: the revocation failing to arrive.
  useCertificateImageSource({
    lookup: () => Promise.resolve({ result: 'revoked', card: null }),
    record: () => Promise.resolve(),
  });

  const { app } = buildServer({ surface: 'public', modules: onDisk });
  const res = await app.inject({
    method: 'GET',
    url: `${BASE_PATH}/certificates/CODE-AAAA/image.png`,
  });
  await app.close();

  expect(res.statusCode).toBe(500);
  expect((res.json() as { code?: unknown }).code).toBe('internal_error');
});
