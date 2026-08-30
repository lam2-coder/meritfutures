import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';

import {
  CERTIFICATE_CARD_MAX_AGE_VAR,
  databaseCertificateImageSource,
  readCertificateImageConfig,
  toCardInput,
} from '../src/certificate-image-source.ts';
import { BASE_PATH, buildServer, discoverRouteModules } from '../src/index.ts';
import {
  CertificateImageUnconfigured,
  resetCertificateImageSource,
  useCertificateImageSource,
} from '../src/routes/certificates.ts';
import {
  databaseVerifySource,
  toVerifyRow,
  VERIFY_DISCLOSURE_VAR,
  VERIFY_FLOOR_MS_VAR,
  VERIFY_PRESENTATION_VARS,
} from '../src/routes/verify.ts';
import { recordingDb } from './db-recorder.ts';

// CI-02, the `unit` project.
//
// =============================================================================
// THE COMPOSITION ADR-256 NAMED AND DECLINED TO TAKE
// =============================================================================
// ADR-256 ruling 12 read `useCertificateImageSource`'s remaining gap as an
// ADAPTER plus one unnamed number, and ruled that "a composition that does not
// exist is not such a gap" under ADR-226 and ADR-229's wiring rule. This file
// is the suite for that composition, and its cases are chosen against the trap
// the row named rather than against the happy path.
//
// -----------------------------------------------------------------------------
// THE TRAP, WHICH IS ADR-246 CLAUSE 8 ONE PORT OVER
// -----------------------------------------------------------------------------
// ADR-246 refused a half-wired `useCertificateBackend` because a live read
// beside a refusing signer answers 200 to a trader whose certificates are all
// deferred and 503 to the trader beside them whose certificate issued: "A
// RESPONSE DECIDED BY THE STATE OF THE CALLER'S OWN ROWS."
//
// THE SAME SHAPE IS AVAILABLE HERE AND THE FIRST SECTION BELOW IS WHERE IT IS
// SHUT. A deferred code never renders (ADR-168 foreclosure 4), so EVERY refusal
// the render makes is a refusal only a code whose row issued can reach.
// `assertCopy` is one: ADR-256 made it state-independent across the five
// SENTENCES, which is the half a renderer can shut alone, and left the other
// half to whatever calls it. A deployment whose disclosure carries a character
// the typeface cannot draw would answer 404 for a deferred code and 500 for an
// issued one, and the difference between those two answers is a fact about
// Merit's book handed to whoever holds the token.
//
// SO THE CONFIGURATION IS READ AND REFUSED IN FULL BEFORE THE DOOR IS OPENED,
// and the cases assert that with the recorder: on a configuration refusal the
// call list is EMPTY, so the answer cannot have been decided by a row.
//
// -----------------------------------------------------------------------------
// AND THE PROPERTY ADR-256 BOUGHT IS ASSERTED UNSPENT
// -----------------------------------------------------------------------------
// The renderer's isolation is load bearing: it imports `node:crypto` and
// `node:zlib` and nothing from this deployable, so the day a render service
// exists the file MOVES and no caller changes. The last section asserts that
// this composition did not spend it, in both directions: the renderer still
// imports nothing from here, and `routes/certificates.ts` still imports no
// renderer, which is what keeps `assertPng` there a validator at the boundary.
// =============================================================================

const HERE = import.meta.dirname;
const REPO = join(HERE, '..', '..', '..');
const SRC = join(REPO, 'apps', 'api', 'src');

const onDisk = await discoverRouteModules();

afterEach(() => {
  resetCertificateImageSource();
});

// -----------------------------------------------------------------------------
// Fixtures. The rows carry the poison `toVerifyRow` and the card input drop
// -----------------------------------------------------------------------------

type Row = Record<string, unknown>;

const CERT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const IDENTITY = '11111111-1111-4111-8111-111111111111';
const INTERNAL_REASON = 'internal: detector D-07 fired on the account, see flag 4412';

const CODE = 'CODE-AAAA';

function certRow(over: Row = {}): Row {
  return {
    id: CERT_ID,
    identityId: IDENTITY,
    accountId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    payoutRequestId: null,
    revokedReason: null,
    deferredReason: null,
    createdAt: new Date('2026-08-24T12:00:00.000Z'),

    kind: 'pass',
    claims: {
      plan_code: 'MERIT-50K',
      size_cents: 5_000_000,
      trading_day: '2026-08-24',
      identity_id: IDENTITY,
    },
    code: CODE,
    issuedAt: new Date('2026-08-24T12:00:00.000Z'),
    claimsSchemaVersion: 1,
    signature: Uint8Array.of(0xde, 0xad, 0xbe, 0xef),
    signingKeyId: 'key-2026-08',
    revokedAt: null,
    revocationClass: null,
    deferredUntil: null,
    ...over,
  };
}

function revokedRow(revocationClass: string): Row {
  return certRow({
    revokedAt: new Date('2026-08-27T09:00:00.000Z'),
    revocationClass,
    revokedReason: INTERNAL_REASON,
  });
}

function deferredRow(): Row {
  return certRow({ deferredUntil: new Date('2026-09-01T00:00:00.000Z') });
}

/**
 * Copy that is obviously a fixture.
 *
 * NO SENTENCE HERE IS A PROPOSAL, which is `verify.test.ts`' rule and its
 * reason: `OQ-M11-02` is open on the `account_enforced` wording, so a plausible
 * sentence in a test file would be a fixture that reads like an answer.
 */
const STATEMENTS = {
  valid: 'fixture: valid',
  fact_untrue: 'fixture: fact untrue',
  account_enforced: 'fixture: account enforced',
  issued_in_error: 'fixture: issued in error',
  trader_request: 'fixture: trader request',
} as const;

const DISCLOSURE = 'fixture: simulated environment disclosure';
const MAX_AGE = 120;

/** The environment a deployment sets, built from the modules' own variable names. */
function environment(over: Record<string, string | undefined> = {}): Record<string, string> {
  const env: Record<string, string | undefined> = {
    ...Object.fromEntries(
      Object.entries(VERIFY_PRESENTATION_VARS).map(([key, variable]) => [
        variable,
        STATEMENTS[key as keyof typeof STATEMENTS],
      ]),
    ),
    [VERIFY_DISCLOSURE_VAR]: DISCLOSURE,
    [VERIFY_FLOOR_MS_VAR]: '4',
    [CERTIFICATE_CARD_MAX_AGE_VAR]: String(MAX_AGE),
    ...over,
  };
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key];
  return env as Record<string, string>;
}

const ENV = environment();

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// -----------------------------------------------------------------------------
// 1. THE TRAP. A configuration refusal is never decided by the caller's row
// -----------------------------------------------------------------------------

/**
 * Every state a code can resolve to, as the door hands it over.
 *
 * THE FOURTH IS `undefined` AND IT IS THE ONE THAT MATTERS MOST. A deployment
 * that refuses only the codes that RENDER answers 404 for a code no row carries
 * and 503 for one that issued, and that pair is `INV-M11-02`'s authority read
 * out of a status code by anyone holding a token.
 */
const EVERY_RESOLUTION: readonly (readonly [string, unknown])[] = [
  ['a code no row carries', undefined],
  ['a deferred row, which never renders', deferredRow()],
  ['an issued row', certRow()],
  ['a revoked row', revokedRow('account_enforced')],
];

test('a deployment whose copy cannot be drawn refuses EVERY code alike, before the door', async () => {
  // THE CASE THIS FILE EXISTS FOR, AND IT WAS WATCHED RED. `assertCopy` refuses
  // a character the typeface cannot draw, and ADR-256 section 3 clause 7 argues
  // that direction is right because the alternative silently alters Merit's
  // published wording on a public artefact. That refusal lives INSIDE the
  // render, and the render is the branch a deferral and an unknown code never
  // take. Left there, one curly quote in `MERIT_VERIFY_DISCLOSURE` answers 404
  // for a deferred code and 500 for an issued one.
  //
  // THE SEED THAT WATCHES IT: drop the `assertCopy` call from
  // `readCertificateImageConfig` and this case fails on the first two rows with
  // the source resolving them happily, while the last two throw
  // `CertificateCardError` rather than `CertificateImageUnconfigured`.
  const undrawable = environment({ [VERIFY_DISCLOSURE_VAR]: `fixture: “disclosure”` });

  for (const [name, resolution] of EVERY_RESOLUTION) {
    const { db, calls } = recordingDb({ publiclyLooksUpTo: resolution });
    await expect(
      databaseCertificateImageSource(db, undrawable).lookup(CODE),
      name,
    ).rejects.toBeInstanceOf(CertificateImageUnconfigured);

    // AND THE DOOR WAS NEVER OPENED, which is the half that makes the refusal
    // state-INDEPENDENT rather than merely uniform today. A check that ran
    // after the read would pass this assertion's first half and still be an
    // oracle the moment a branch was added below it.
    expect(calls, `${name}: the database was reached`).toStrictEqual([]);
  }
});

test('a sentence this card will never draw still refuses this card, and refuses the unknown code too', async () => {
  // ADR-256's STATE-INDEPENDENCE, CARRIED PAST THE RENDERER. That entry asserts
  // a broken `fact_untrue` fails an ISSUED card. It could not assert that a
  // broken `fact_untrue` fails a code no row carries, because a renderer never
  // sees one. This is that assertion.
  const broken = environment({ [VERIFY_PRESENTATION_VARS.fact_untrue]: '   ' });
  for (const [name, resolution] of EVERY_RESOLUTION) {
    const { db, calls } = recordingDb({ publiclyLooksUpTo: resolution });
    await expect(
      databaseCertificateImageSource(db, broken).lookup(CODE),
      name,
    ).rejects.toBeInstanceOf(CertificateImageUnconfigured);
    expect(calls).toStrictEqual([]);
  }
});

test('the lifetime is refused in the adapter and not left to the route, for the same reason', async () => {
  // `cacheControl` REFUSES A DAY OR MORE and the route calls it while composing
  // the response, which is AFTER the branch that answers 404 for a deferral. So
  // a deployment that set a week would answer 404 for a deferred code and 500
  // for an issued one. The bound is stated ONCE, in `routes/certificates.ts`,
  // and this adapter calls that function for its refusals rather than copying
  // the number.
  //
  // SEEDED: move the `cacheControl` call out of `readCertificateImageConfig`
  // and the first two rows resolve while the last two reach the route's throw.
  for (const bad of ['0', '-60', '86400', '604800', 'soon', '', undefined]) {
    const env = environment({ [CERTIFICATE_CARD_MAX_AGE_VAR]: bad });
    for (const [name, resolution] of EVERY_RESOLUTION) {
      const { db, calls } = recordingDb({ publiclyLooksUpTo: resolution });
      await expect(
        databaseCertificateImageSource(db, env).lookup(CODE),
        `${String(bad)} / ${name}`,
      ).rejects.toBeInstanceOf(CertificateImageUnconfigured);
      expect(calls).toStrictEqual([]);
    }
  }
});

test('the refusal names the variable a deployment forgot rather than saying it is unset', () => {
  // ADR-231's rule for the seven copy variables applied to the eighth: a
  // deployment is told WHICH one it forgot, because a single "not configured"
  // sends an operator to read the source.
  const missing = environment({ [CERTIFICATE_CARD_MAX_AGE_VAR]: undefined });
  expect(() => readCertificateImageConfig(missing)).toThrowError(CERTIFICATE_CARD_MAX_AGE_VAR);

  for (const variable of [...Object.values(VERIFY_PRESENTATION_VARS), VERIFY_DISCLOSURE_VAR]) {
    const short = environment({ [variable]: undefined });
    expect(() => readCertificateImageConfig(short), variable).toThrowError(
      CertificateImageUnconfigured,
    );
  }
});

test('a complete environment yields the configured copy and the configured lifetime', () => {
  const config = readCertificateImageConfig(ENV);
  expect(config.copy.statements).toStrictEqual({ ...STATEMENTS });
  expect(config.copy.disclosure).toBe(DISCLOSURE);
  expect(config.cacheMaxAgeSeconds).toBe(MAX_AGE);
});

// -----------------------------------------------------------------------------
// 2. The doors, which are the two `databaseVerifySource` opens and no third
// -----------------------------------------------------------------------------

test('the read is `certificates` by `code` through publicLookup, and never through scoped', async () => {
  const { db, calls } = recordingDb({ publiclyLooksUpTo: certRow() });
  await databaseCertificateImageSource(db, ENV).lookup(CODE);

  expect(calls).toEqual([
    { door: 'publicLookup', verb: 'rowAt', key: 'certificates', address: { code: CODE } },
  ]);
  // ADR-231 SECTION 4, ASSERTED SEPARATELY so a failure names what it refused:
  // resolving the identity from the code and opening `db.scoped` with it would
  // put an authority over that trader's payouts, accounts and wallet behind an
  // unauthenticated route in exchange for one column of one row.
  expect(calls.map((call) => call.door)).not.toContain('scoped');
  expect(calls.some((call) => call.identityId !== undefined)).toBe(false);
});

test('a code that names no row answers null, which is the port shape and not the accessor', async () => {
  const { db } = recordingDb({ publiclyLooksUpTo: undefined });
  await expect(databaseCertificateImageSource(db, ENV).lookup('CODE-ZZZZ')).resolves.toBeNull();
});

test('the append arm IS `databaseVerifySource`s and not a second writer of that table', async () => {
  // ONE TABLE, ONE VOCABULARY. `code_hash` is a pseudonym: a second digest here
  // would make one code hash two ways depending on which row observed it, and a
  // detector reading `certificate_verifications` for a rate across sources
  // would count two callers where there was one. ADR-235 section 6.3 settled
  // which digest and `routes/verify.ts` holds it.
  const observation = { code: CODE, result: 'valid', ip: '203.0.113.7' } as const;

  const mine = recordingDb();
  await databaseCertificateImageSource(mine.db, ENV).record(observation);
  const theirs = recordingDb();
  await databaseVerifySource(theirs.db, ENV).record(observation);

  expect(mine.calls).toStrictEqual(theirs.calls);
  const written = mine.calls[0];
  expect(written?.door).toBe('firm');
  expect(written?.verb).toBe('insert');
  expect(written?.key).toBe('certificateVerifications');
  const values = written?.values as Record<string, unknown>;
  expect(values['codeHash']).toStrictEqual(
    new Uint8Array(createHash('sha256').update(CODE, 'utf8').digest()),
  );
  expect(JSON.stringify([...(values['codeHash'] as Uint8Array)])).not.toContain('CODE');
});

// -----------------------------------------------------------------------------
// 3. What each state resolves to, and a revocation is never a failure
// -----------------------------------------------------------------------------

test('a deferred row resolves `deferred` with NO card, which is the claim not yet made', async () => {
  // ADR-168 FORECLOSURE 4, OBTAINED AT THE ADAPTER. `imageHandler` throws if a
  // card arrives for a deferred code, in words that call it "that claim
  // published", and this is the arm that must not build one.
  const { db } = recordingDb({ publiclyLooksUpTo: deferredRow() });
  await expect(databaseCertificateImageSource(db, ENV).lookup(CODE)).resolves.toStrictEqual({
    result: 'deferred',
    card: null,
  });
});

test('an issued row renders, and the bytes open with the PNG signature', async () => {
  const { db } = recordingDb({ publiclyLooksUpTo: certRow() });
  const found = await databaseCertificateImageSource(db, ENV).lookup(CODE);
  expect(found?.result).toBe('valid');
  expect([...(found?.card?.bytes.slice(0, 8) ?? [])]).toStrictEqual([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  expect(found?.card?.cache_max_age_seconds).toBe(MAX_AGE);
});

test('all four revocation classes RENDER, and each draws its own sentence', async () => {
  // `INV-M11-08` MAKES THE RE-RENDER THE ONLY PATH BY WHICH A REVOCATION
  // REACHES A CIRCULATING IMAGE, so an adapter that failed on a revoked row
  // would turn the revocation into the failure. Four distinct cards is the
  // weaker half; ADR-256 records that a renderer drawing `valid` on every
  // revoked card passed a count of distinct outputs. What refuses that here is
  // that each card is asserted to CARRY its own class's sentence.
  const drawn = new Map<string, string>();
  for (const revocationClass of [
    'fact_untrue',
    'account_enforced',
    'issued_in_error',
    'trader_request',
  ] as const) {
    const { db } = recordingDb({ publiclyLooksUpTo: revokedRow(revocationClass) });
    const found = await databaseCertificateImageSource(db, ENV).lookup(CODE);
    expect(found?.result, revocationClass).toBe('revoked');
    expect(found?.card, revocationClass).not.toBeNull();
    drawn.set(revocationClass, hex(found?.card?.bytes ?? new Uint8Array()));
  }
  expect(new Set(drawn.values()).size).toBe(4);

  // THE BIJECTION RATHER THAN THE COUNT. Retuning ONE class's sentence must
  // move THAT card and leave the other three, which refuses both directions a
  // count does not: a renderer drawing `valid` everywhere moves none, and one
  // drawing all five moves all four.
  const retuned = environment({
    [VERIFY_PRESENTATION_VARS.account_enforced]: 'fixture: account enforced, retuned',
  });
  for (const revocationClass of [
    'fact_untrue',
    'account_enforced',
    'issued_in_error',
    'trader_request',
  ] as const) {
    const { db } = recordingDb({ publiclyLooksUpTo: revokedRow(revocationClass) });
    const found = await databaseCertificateImageSource(db, retuned).lookup(CODE);
    const moved = hex(found?.card?.bytes ?? new Uint8Array()) !== drawn.get(revocationClass);
    expect(moved, revocationClass).toBe(revocationClass === 'account_enforced');
  }
});

// -----------------------------------------------------------------------------
// 4. What the row carries and the card cannot receive
// -----------------------------------------------------------------------------

test('the signature and the key id reach the row type and have nowhere to go on the card', async () => {
  // `toVerifyRow` KEEPS BOTH, BECAUSE `GET /verify/:code` PUBLISHES THEM, and
  // `CertificateCardInput` has a field for neither. This is the one place a
  // value could have crossed between the two projections, so the absence is
  // executed rather than read off the type: two rows differing ONLY in
  // `signature` and `signing_key_id` render byte-identical cards.
  const config = readCertificateImageConfig(ENV);
  const plain = toVerifyRow(certRow());
  const other = toVerifyRow(
    certRow({ signature: Uint8Array.of(0x01, 0x02, 0x03), signingKeyId: 'key-2099-12' }),
  );

  expect(Object.keys(toCardInput(plain, config.copy)).sort()).toStrictEqual(
    Object.keys(toCardInput(other, config.copy)).sort(),
  );
  expect(JSON.stringify(toCardInput(plain, config.copy))).not.toContain('key-2026-08');

  const { db: dbA } = recordingDb({ publiclyLooksUpTo: certRow() });
  const { db: dbB } = recordingDb({
    publiclyLooksUpTo: certRow({
      signature: Uint8Array.of(0x01, 0x02, 0x03),
      signingKeyId: 'key-2099-12',
    }),
  });
  const a = await databaseCertificateImageSource(dbA, ENV).lookup(CODE);
  const b = await databaseCertificateImageSource(dbB, ENV).lookup(CODE);
  expect(hex(b?.card?.bytes ?? new Uint8Array())).toBe(hex(a?.card?.bytes ?? new Uint8Array()));
});

test('the internal revocation reason is in the row the door returns and not in the card', async () => {
  const { db } = recordingDb({ publiclyLooksUpTo: revokedRow('fact_untrue') });
  const found = await databaseCertificateImageSource(db, ENV).lookup(CODE);
  const config = readCertificateImageConfig(ENV);
  const input = toCardInput(toVerifyRow(revokedRow('fact_untrue')), config.copy);
  expect(JSON.stringify(input)).not.toContain(INTERNAL_REASON);
  expect(JSON.stringify(input)).not.toContain(IDENTITY);
  expect(JSON.stringify(input)).not.toContain(CERT_ID);
  // AND THE PIXELS ARE NOT CHECKED HERE, which `routes/certificates.ts`' header
  // says of itself: nothing chooses fields inside a PNG, so what stands in for
  // the allowlist is that the INPUT has no field for any of these.
  expect(found?.card).not.toBeNull();
});

// -----------------------------------------------------------------------------
// 5. The route, end to end, on the composition rather than on a fake
// -----------------------------------------------------------------------------

async function fetchImage(code: string): Promise<{
  status: number;
  type: string | undefined;
  age: string | undefined;
}> {
  const { app } = buildServer({ surface: 'public', modules: onDisk });
  const res = await app.inject({
    method: 'GET',
    url: `${BASE_PATH}/certificates/${code}/image.png`,
  });
  await app.close();
  return {
    status: res.statusCode,
    type: res.headers['content-type'] as string | undefined,
    age: res.headers['cache-control'] as string | undefined,
  };
}

test('the composition serves a revoked card end to end at 200 through the real route', async () => {
  const { db } = recordingDb({ publiclyLooksUpTo: revokedRow('account_enforced') });
  useCertificateImageSource(databaseCertificateImageSource(db, ENV));
  const res = await fetchImage(CODE);
  expect(res.status).toBe(200);
  expect(res.type).toBe('image/png');
  expect(res.age).toBe(`public, max-age=${String(MAX_AGE)}`);
});

test('a deferred code is a 404 and an unknown code is the same 404', async () => {
  // THE 404 IS DELIBERATELY AMBIGUOUS between "no row carries this code" and
  // "the row carries it and does not render", which is `imageHandler`'s own
  // ruling. This case is that ambiguity holding across the real adapter.
  for (const resolution of [deferredRow(), undefined]) {
    const { db } = recordingDb({ publiclyLooksUpTo: resolution });
    useCertificateImageSource(databaseCertificateImageSource(db, ENV));
    expect((await fetchImage(CODE)).status).toBe(404);
    resetCertificateImageSource();
  }
});

test('a misconfigured deployment answers 503 on every code, and never 500 and never 404', async () => {
  // ADR-240 SECTION 4: an unwired or unfinished deployment is a 503, because a
  // 500 sends an operator hunting for a bug when what is missing is a line in
  // `start.ts` or a variable beside it. `CertificateImageUnconfigured` is
  // caught by the same arm as `CertificateImageUnwired`, which is
  // `routes/verify.ts`' two-classes-one-answer shape.
  const undrawable = environment({ [VERIFY_DISCLOSURE_VAR]: `fixture: “disclosure”` });
  for (const resolution of [certRow(), revokedRow('trader_request'), deferredRow(), undefined]) {
    const { db } = recordingDb({ publiclyLooksUpTo: resolution });
    useCertificateImageSource(databaseCertificateImageSource(db, undrawable));
    expect((await fetchImage(CODE)).status).toBe(503);
    resetCertificateImageSource();
  }
});

// -----------------------------------------------------------------------------
// 6. The property ADR-256 bought, asserted unspent
// -----------------------------------------------------------------------------

function importsOf(path: string): readonly string[] {
  return [...readFileSync(path, 'utf8').matchAll(/^import[\s\S]*?from '(.*)';$/gm)].map(
    (match) => match[1] ?? '',
  );
}

test('the composition did not make the renderer depend on this deployable', () => {
  // ADR-256 SECTION 2 CLAUSE 3: the renderer's only imports are `node:crypto`
  // and `node:zlib`, "so the day a render service exists this file MOVES and no
  // caller is rewritten". A composition that imported the wrong way round would
  // have spent that, and the exact list is what makes the claim checkable
  // rather than a denylist that a new import walks past.
  expect(importsOf(join(SRC, 'certificate-card.ts'))).toStrictEqual(['node:crypto', 'node:zlib']);

  // AND THE ROUTE STILL IMPORTS NO RENDERER, which is what keeps `assertPng`
  // there a VALIDATOR at the boundary rather than a producer checking its own
  // work. This is why the composition is its own module and not a function in
  // `routes/certificates.ts`.
  expect(
    importsOf(join(SRC, 'routes', 'certificates.ts')).filter((one) =>
      one.includes('certificate-card'),
    ),
  ).toStrictEqual([]);

  // THE DEPENDENCY RUNS ONE WAY AND THIS FILE'S SUBJECT IS THE ONLY JOINT.
  const composition = importsOf(join(SRC, 'certificate-image-source.ts'));
  expect(composition).toContain('./certificate-card.ts');
  expect(composition).toContain('./routes/certificates.ts');
});

test('a deployment that publishes `image_url` also installs the row it addresses', () => {
  // THIS CASE READ "`start.ts` INSTALLS THE COMPOSITION AND DOES NOT INSTALL THE
  // LIST BACKEND", and it is rewritten rather than deleted (`RI-14`). It was
  // ADR-261's, it was true, and ADR-266 falsified it by writing the guard that
  // entry's section 5 named: the list port waited on an origin AND on a check
  // that reads it before the caller's rows, and only the second was code.
  //
  // WHAT SURVIVES IS THE PAIR, AND IT IS THE STRONGER CLAIM. `image_url` is
  // `origin` plus the path THIS deployable serves (ADR-249 section 2.4), so a
  // process that installs the list backend without the image source publishes a
  // link, to every trader with an issued certificate, addressing a row of its own
  // that answers 503. "Publishing a link to a trader is publishing a promise that
  // bytes are there" is the sentence that kept the list port shut for four
  // entries, and this is that sentence as an assertion rather than as prose.
  const start = readFileSync(join(SRC, 'start.ts'), 'utf8');
  const bytes = 'useCertificateImageSource(databaseCertificateImageSource(LIVE_DB));';
  const promise = 'useCertificateBackend(databaseCertificateBackend(LIVE_DB));';
  if (start.includes(promise))
    expect(start, 'the list backend is installed and the image source is not').toContain(bytes);
  expect(start).toContain(bytes);
});
