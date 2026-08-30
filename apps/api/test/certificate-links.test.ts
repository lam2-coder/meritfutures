import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { buildServer, discoverRouteModules, BASE_PATH } from '../src/index.ts';

// CI-02, the `unit` project.
//
// =============================================================================
// THE TWO CERTIFICATE PORTS THAT ADR-240 DID NOT WIRE, AND THE MEASUREMENTS
// THAT SAY WHY
// =============================================================================
// ADR-240 was dispatched at three ports whose remaining obstruction was thought
// to be configuration. One of the three was: `setEconomicCalendarSource` waited
// on a horizon a deployment sets, and `start.ts` installs it now. The other two
// are `useCertificateBackend` and `useCertificateImageSource`, and neither is
// waiting on a secret.
//
// A BLOCKED ENTRY IS A SENTENCE IN A TEST FILE AND A SENTENCE CANNOT FAIL,
// which is session 426's landmine stated in its own words: "A COMMENT CANNOT
// FAIL, AND THAT IS THE WHOLE DEFECT HERE. A true sentence went false one
// producer at a time." Both reasons in `wiring.test.ts` rest on claims about
// what this repository does NOT contain, which is exactly the class of claim
// ADR-235 found had been read for weeks as a description of a deployment. This
// file executes them.
//
// -----------------------------------------------------------------------------
// WHAT EACH CASE IS FOR
// -----------------------------------------------------------------------------
//   1. `image_url` IS "signed, time-limited" AND THIS ENDPOINT VERIFIES NOTHING.
//      API_CONTRACT section 6.3 states of the image row: "Request: the path
//      token only, no query, no body". So a signature has nowhere to ride, and
//      the assertion is behavioural rather than textual: the same code fetched
//      with signature-shaped query parameters is answered identically. The day
//      somebody adds verification here, this case goes red and ADR-240's ruling
//      about where the signer belongs has to be re-read before it is changed.
//
//   2. THERE IS ONE CARD RENDERER IN THIS REPOSITORY, AND THIS PAIR OF CASES
//      READ "THERE IS NONE" UNTIL ADR-256. `CertificateCard` is the type whose
//      `bytes` the image endpoint serves, and the count of files naming it is
//      the count of producers plus one. The case was written so that the day a
//      renderer landed it would go red and `useCertificateImageSource`'s entry
//      would expire rather than waiting to be noticed, which is `RI-22` leg 3's
//      shape at test scale: assert over the DRAWS rather than over the prose.
//      IT WENT RED ON ADR-256's DIFF, WHICH IS THE CONTROL WORKING, and both
//      cases now assert the shape rather than the absence.
// =============================================================================

const HERE = import.meta.dirname;
const REPO = join(HERE, '..', '..', '..');

const onDisk = await discoverRouteModules();

// -----------------------------------------------------------------------------
// 1. The image URL carries no signature, because the endpoint verifies none
// -----------------------------------------------------------------------------

/** A code no row carries. Every fetch below resolves the same way: not found. */
const CODE = 'CODE-THAT-NO-ROW-CARRIES';

const bare = `${BASE_PATH}/certificates/${CODE}/image.png`;

/**
 * The query a signed, time-limited URL would carry.
 *
 * SPELLED IN THE TWO VOCABULARIES THE APPROVED INFRASTRUCTURE ALREADY HAS.
 * INFRA section 2 rows "S3-compatible object storage" and Cloudflare at the
 * edge; a presigned S3 URL carries `X-Amz-Signature` and `X-Amz-Expires`, and a
 * Cloudflare signed URL carries `verify` and `expires`. Neither vendor is
 * chosen here and no value below is a real one: what the case asserts is that
 * this endpoint is indifferent to both shapes.
 */
const SIGNED = `${bare}?X-Amz-Signature=aaaa&X-Amz-Expires=60&verify=bbbb&expires=1`;

test('the image endpoint answers a signature-shaped query exactly as it answers none', async () => {
  const { app } = buildServer({ surface: 'public', modules: onDisk });

  const plain = await app.inject({ method: 'GET', url: bare });
  const signed = await app.inject({ method: 'GET', url: SIGNED });

  // THE PORT IS UNWIRED, SO BOTH ARE 503, and that is the answer this
  // deployment owes for a code it cannot look up. What matters is that the two
  // are the SAME answer: an endpoint that verified a signature would have to
  // differ on at least one of these two requests, whichever way it decided.
  expect(signed.statusCode).toBe(plain.statusCode);
  // `instance` IS THE REQUEST ID AND IT DIFFERS BY CONSTRUCTION (section 2:
  // "request id for support correlation"), so it is dropped rather than
  // compared. Every other member of the problem document is asserted equal.
  const withoutInstance = (raw: string): unknown => {
    const { instance: _instance, ...rest } = JSON.parse(raw) as Record<string, unknown>;
    return rest;
  };
  expect(withoutInstance(signed.body)).toEqual(withoutInstance(plain.body));

  await app.close();
});

test('the image handler reads the path token and no query parameter at all', () => {
  // THE STRUCTURAL HALF OF THE SAME CLAIM, because the behavioural case above
  // would also pass against a handler that read `request.query` and ignored it.
  // API_CONTRACT section 6.3: "Request: the path token only, no query, no
  // body." A signed, time-limited URL is a query, so this row and section 6's
  // `image_url` cannot both be satisfied by one endpoint. ADR-240.
  const source = readFileSync(
    join(REPO, 'apps', 'api', 'src', 'routes', 'certificates.ts'),
    'utf8',
  );
  const handler = source.slice(source.indexOf('export const imageHandler'));
  const body = handler.slice(0, handler.indexOf('\n};'));

  expect(body).toContain('request.params');
  expect(body).not.toContain('request.query');
});

// -----------------------------------------------------------------------------
// 2. No card renderer exists, and the count is executed rather than asserted in
//    prose
// -----------------------------------------------------------------------------

/**
 * Every shipped `.ts` and `.tsx` file under a deployable's or a package's
 * `src`.
 *
 * `test/` IS EXCLUDED DELIBERATELY AND `e2e/` AND `scripts/` ARE NOT WALKED. A
 * fixture naming the type is a suite describing the shape, which is what this
 * file itself does two functions up; the claim is about what a DEPLOYMENT can
 * produce, and a deployment ships `src`.
 */
function shippedSources(): readonly string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (entry.endsWith('.ts') || entry.endsWith('.tsx')) found.push(path);
    }
  };
  for (const group of ['apps', 'packages']) {
    const root = join(REPO, group);
    for (const member of readdirSync(root)) {
      const src = join(root, member, 'src');
      try {
        if (statSync(src).isDirectory()) walk(src);
      } catch {
        // A workspace member with no `src` is not a finding. `packages/tooling`
        // ships checks and `e2e` is not a member at all.
      }
    }
  }
  return found;
}

function namingIn(needle: string): readonly string[] {
  return shippedSources()
    .filter((path) => readFileSync(path, 'utf8').includes(needle))
    .map((path) =>
      path
        .slice(REPO.length + 1)
        .split('\\')
        .join('/'),
    )
    .sort();
}

test('the sweep reaches the source it claims to, so an empty answer is not an empty search', () => {
  // THE PREMISE OF BOTH COUNTS BELOW, ASSERTED FIRST. A walk that silently
  // reached nothing would report "no renderer" for a repository full of them,
  // which is the failure mode that makes an absence measurement worthless.
  const sources = shippedSources();
  expect(sources.length).toBeGreaterThan(100);
  expect(namingIn('CertificateBackendUnwired')).toContain('apps/api/src/routes/certificates.ts');
});

test('CertificateCard is named in three shipped files: the port, the renderer, the composition', () => {
  // THIS CASE WENT RED TWICE AND HAS BEEN REWRITTEN TWICE, WHICH IS THE CONTROL
  // WORKING RATHER THAN A COUNT DRIFTING. ADR-240 clause 11 wrote it as an
  // ABSENCE measurement reading `['apps/api/src/routes/certificates.ts']` and
  // said "the day a renderer lands, that case goes red and the entry expires";
  // ADR-256 landed the renderer and it read two; ADR-261 landed the composition
  // that puts the two database arms and the render together and it reads three.
  //
  // THREE ROLES AND NO FOURTH, AND THE ROLES ARE WHAT THE CASE IS ABOUT. The
  // port DECLARES the type and `CertificateLookup` carries it; the renderer
  // PRODUCES the bytes; the composition is the one thing that calls the second
  // to satisfy the first. A fourth file is a second producer or a second
  // composition, and ADR-249 clause 1 rules that where the bytes come from is a
  // deployment shape rather than something a source tree grows twice.
  //
  // THE PRODUCER HALF IS CARRIED BY THE CASE BELOW AND IT DID NOT MOVE. This
  // sweep is a substring sweep and cannot tell a consumer from a producer, so a
  // count of three here would be satisfied by a second renderer. `image/png`
  // still appears in exactly TWO files, and the composition is not one of them.
  expect(namingIn('CertificateCard')).toEqual([
    'apps/api/src/certificate-card.ts',
    'apps/api/src/certificate-image-source.ts',
    'apps/api/src/routes/certificates.ts',
  ]);
});

test('image/png appears in two shipped files, and one labels while the other draws', () => {
  // THE SAME MEASUREMENT FROM THE OTHER END, because a renderer could have
  // landed under a type of its own and satisfied the case above. The route
  // LABELS bytes it was handed and `assertPng` there refuses bytes carrying no
  // PNG signature, which is a validator; `certificate-card.ts` is the producer
  // those bytes come from, and `CERTIFICATE_CARD_MEDIA_TYPE` is the one place
  // the producer and the label agree on what they are.
  expect(namingIn('image/png')).toEqual([
    'apps/api/src/certificate-card.ts',
    'apps/api/src/routes/certificates.ts',
  ]);
});
