// =============================================================================
// apps/api/test/certificate-rate-limit.test.ts
// =============================================================================
// THE THREE THINGS A RATE LIMIT HAS TO DO, ASSERTED THROUGH THE REAL ROUTER.
//
//   1. OVER THE THRESHOLD, IT REFUSES. `429`, `application/problem+json`, the
//      canonical `rate_limited` code and a `Retry-After` naming whole seconds.
//   2. UNDER THE THRESHOLD, IT PASSES. A limit that refuses the traffic it was
//      sized for is an outage with a security justification.
//   3. WITH NO CONFIGURATION, IT REFUSES RATHER THAN SILENTLY ALLOWING. ADR-226
//      ruled that an absent Turnstile secret is a refusal and not a disabled
//      control; ADR-240 applied it to a threshold; this is the third time and
//      the FIRST where the thing being switched off is a limit, which is the
//      shape where "disabled" and "unlimited" are the same word.
//
// EVERY CASE GOES THROUGH `buildServer` AND `inject` over the modules discovered
// from disk, which is `verify.test.ts`' stated rule and its reason: a control
// wired into a handler that no router reaches is a control that does not run.
// Two cases below assert the limiter's own arithmetic directly, and they are
// marked as the exceptions they are.
//
// -----------------------------------------------------------------------------
// WHAT THIS SUITE CANNOT PROVE, STATED RATHER THAN IMPLIED
// -----------------------------------------------------------------------------
// THAT THE CONFIGURED NUMBERS ARE THE RIGHT ONES. They are the deployment's, by
// API_CONTRACT section 11's own words ("the limits are data rather than prose"),
// and no test can know a rate a production origin should carry. What is asserted
// is that the numbers are OBEYED, that an absent one refuses, and that the two
// dimensions section 11 names for the image row are counted separately.
//
// THAT AN ATTACKER IS BOUNDED ACROSS REPLICAS. The counter is per process. A
// second process serves a second allowance, which is stated in the module and
// is the same owed item as the edge.
//
// THAT THE ADDRESS IS THE CALLER'S. `request.ip` is the immediate peer and this
// suite drives `inject`, so the address it exercises is the one the injector
// supplies. Whether a production origin sees its callers or an edge is a
// deployment fact no assertion in this repository can reach.
// =============================================================================

import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, test } from 'vitest';

import {
  CertificateRateLimitUnconfigured,
  CertificateRateLimitUnwired,
  RATE_LIMITED_ROUTES,
  RATE_LIMIT_VARS,
  UNWIRED_CERTIFICATE_RATE_LIMITER,
  environmentCertificateRateLimiter,
  readRateLimitPolicy,
  resetCertificateRateLimiter,
  useCertificateRateLimiter,
} from '../src/certificate-rate-limit.ts';
import { databaseCertificateImageSource } from '../src/certificate-image-source.ts';
import { BASE_PATH, buildServer, discoverRouteModules } from '../src/index.ts';
import { PROBLEM_MEDIA_TYPE } from '../src/server.ts';
import {
  resetCertificateImageSource,
  useCertificateImageSource,
  type CertificateImageSource,
  type CertificateObservation,
} from '../src/routes/certificates.ts';
import {
  resetVerifySource,
  useVerifySource,
  type VerifyPresentation,
  type VerifyRow,
  type VerifySource,
} from '../src/routes/verify.ts';

const onDisk = await discoverRouteModules();

afterEach(() => {
  resetCertificateRateLimiter();
  resetVerifySource();
  resetCertificateImageSource();
});

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const CODE = 'CODE-AAAA';
const OTHER_CODE = 'CODE-BBBB';

/**
 * A copy table with every sentence filled.
 *
 * FIXTURE COPY AND NOT MERIT COPY. `routes/verify.ts` reads the real wording
 * from seven environment variables and ADR-012 keeps the values out of this
 * repository; `OQ-M11-02` records that one of the five sentences is still a
 * legal question. Nothing here is a proposal.
 */
const PRESENTATION: VerifyPresentation = {
  statements: {
    valid: 'fixture valid',
    fact_untrue: 'fixture fact_untrue',
    account_enforced: 'fixture account_enforced',
    issued_in_error: 'fixture issued_in_error',
    trader_request: 'fixture trader_request',
  },
  disclosure: 'fixture disclosure',
  floor_ms: 1,
};

const ROW: VerifyRow = {
  code: CODE,
  kind: 'pass',
  claims: { plan_code: 'core_eod', size_cents: 5_000_000, trading_day: '2026-03-02' },
  claimsSchemaVersion: 1,
  signingKeyId: 'key-1',
  signature: Uint8Array.of(1, 2, 3),
  issuedAt: '2026-03-02T00:00:00.000Z',
  revokedAt: null,
  revocationClass: null,
  deferredUntil: null,
};

/** A verify source that always resolves and records. */
function verifySource(): { source: VerifySource; observed: CertificateObservation[] } {
  const observed: CertificateObservation[] = [];
  return {
    observed,
    source: {
      lookup: (code) => Promise.resolve(code === CODE ? ROW : null),
      record: (observation) => {
        observed.push(observation);
        return Promise.resolve();
      },
      presentation: () => PRESENTATION,
    },
  };
}

/**
 * An image source that renders a fixed PNG.
 *
 * THE BYTES ARE THE SIGNATURE PLUS NOTHING, which `assertPng` admits and the
 * renderer is not asked for. This suite is about how MANY renders happen and
 * never about what they draw; `certificate-card.test.ts` owns the pixels.
 */
function imageSource(): { source: CertificateImageSource; rendered: string[] } {
  const rendered: string[] = [];
  return {
    rendered,
    source: {
      lookup: (code) => {
        if (code !== CODE && code !== OTHER_CODE) return Promise.resolve(null);
        rendered.push(code);
        return Promise.resolve({
          result: 'valid' as const,
          card: {
            bytes: Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
            cache_max_age_seconds: 300,
          },
        });
      },
      record: () => Promise.resolve(),
    },
  };
}

/** One window, wide limits, so a case that wants a refusal has to cause it. */
function env(over: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    MERIT_VERIFY_RATE_LIMIT_WINDOW_SECONDS: '60',
    MERIT_VERIFY_RATE_LIMIT_PER_IP: '3',
    MERIT_CERTIFICATE_IMAGE_RATE_LIMIT_WINDOW_SECONDS: '60',
    MERIT_CERTIFICATE_IMAGE_RATE_LIMIT_PER_IP: '3',
    MERIT_CERTIFICATE_IMAGE_RATE_LIMIT_PER_CODE: '2',
    ...over,
  };
}

/** A clock the case moves by hand, so no window is waited through. */
function clock(startMs: number): { now: () => number; advance: (ms: number) => void } {
  let at = startMs;
  return {
    now: () => at,
    advance: (ms) => {
      at += ms;
    },
  };
}

async function get(path: string, times: number): Promise<LightMyRequestResponse[]> {
  const { app } = buildServer({ surface: 'public', modules: onDisk });
  const out: LightMyRequestResponse[] = [];
  for (let i = 0; i < times; i += 1) out.push(await app.inject({ method: 'GET', url: path }));
  await app.close();
  return out;
}

const verifyUrl = (code: string): string => `${BASE_PATH}/verify/${code}`;
const imageUrl = (code: string): string => `${BASE_PATH}/certificates/${code}/image.png`;

// -----------------------------------------------------------------------------
// 1. Over the threshold, the refusal fires
// -----------------------------------------------------------------------------

describe('driven over its threshold, the limit refuses', () => {
  test('`GET /verify/:code` admits the configured count and refuses the next', async () => {
    const wired = verifySource();
    useVerifySource(wired.source);
    useCertificateRateLimiter(environmentCertificateRateLimiter(env(), clock(0).now));

    const answers = await get(verifyUrl(CODE), 4);

    expect(answers.map((r) => r.statusCode)).toStrictEqual([200, 200, 200, 429]);

    // AND THE REFUSAL IS SECTION 2's DOCUMENT rather than a shape this route
    // invented. `server.ts` maps 429 to `rate_limited` and titles it
    // "Rate limited", and ADR-235 section 5 ruling 2 recorded that both existed
    // and that nothing on this route reached them.
    const refused = answers[3];
    expect(refused?.headers['content-type']).toContain(PROBLEM_MEDIA_TYPE);
    expect(refused?.json()).toMatchObject({ code: 'rate_limited', status: 429 });
    expect(refused?.headers['retry-after']).toBe('60');

    // `no-store` ON THE REFUSAL TOO. Every response this row produces carries
    // it (`VERIFY_CACHE_CONTROL`), and `FM-M11-02` is why: the verify page is
    // the recovery path for a screenshotted card, so nothing on it is cacheable.
    expect(refused?.headers['cache-control']).toBe('no-store');

    // AND THE REFUSED REQUEST NEVER REACHED THE SOURCE, which is what makes the
    // limit a bound on the work rather than a report about it.
    expect(wired.observed).toHaveLength(3);
  });

  test('the image row refuses on its per-`code` dimension before its per-IP one', async () => {
    const wired = imageSource();
    useCertificateImageSource(wired.source);
    useCertificateRateLimiter(environmentCertificateRateLimiter(env(), clock(0).now));

    // THE TWO DIMENSIONS ARE COUNTED SEPARATELY AND THAT IS SECTION 11's OWN
    // POINT: "an enumeration campaign and a single hot card look identical when
    // only the IP is counted". Per code is 2 here and per IP is 3, so the third
    // fetch of ONE code is refused while the address still has budget.
    const answers = await get(imageUrl(CODE), 3);

    expect(answers.map((r) => r.statusCode)).toStrictEqual([200, 200, 429]);
    expect(answers[2]?.headers['content-type']).toContain(PROBLEM_MEDIA_TYPE);
    expect(answers[2]?.json()).toMatchObject({ code: 'rate_limited' });

    // NO `Cache-Control` ON THIS ROW'S REFUSAL, which is the row's own shape:
    // its 404 and its 503 carry none either, and a 429 that invented one would
    // be the only refusal here instructing a cache.
    expect(answers[2]?.headers['cache-control']).toBeUndefined();

    // AND THE PNG ENCODE THE REFUSAL EXISTS TO PRICE DID NOT HAPPEN.
    expect(wired.rendered).toStrictEqual([CODE, CODE]);
  });

  test('the per-IP dimension refuses a caller spreading its fetches across codes', async () => {
    const wired = imageSource();
    useCertificateImageSource(wired.source);
    useCertificateRateLimiter(environmentCertificateRateLimiter(env(), clock(0).now));

    // ONE FETCH OF EACH OF TWO CODES STAYS UNDER THE PER-CODE LIMIT, and the
    // per-IP counter is what stops the fourth. That is `AS-M11-04`'s campaign
    // shape rather than its hot-card shape, and it is why the row carries both.
    const answers = [
      ...(await get(imageUrl(CODE), 1)),
      ...(await get(imageUrl(OTHER_CODE), 1)),
      ...(await get(imageUrl('CODE-CCCC'), 1)),
      ...(await get(imageUrl(OTHER_CODE), 1)),
    ];

    expect(answers.map((r) => r.statusCode)).toStrictEqual([200, 200, 404, 429]);
  });

  test('a refused request is still counted, so the limiter does not blind itself', () => {
    // ONE OF TWO CASES THAT READ THE LIMITER DIRECTLY, and the reason is that
    // the property is about what happens INSIDE the window rather than about a
    // response. A counter that stopped counting once it started refusing would
    // let the window drain under sustained load and hand the caller a duty
    // cycle. It is the whole argument for a counter in memory over a query on
    // `certificate_verifications`, whose `result` CHECK has no member for a
    // refusal, so it is asserted rather than asserted about.
    const at = clock(0);
    const limiter = environmentCertificateRateLimiter(env(), at.now);
    const ask = (): boolean =>
      limiter.check({ route: 'verify', ip: '198.51.100.7', code: null }).allowed;

    expect([ask(), ask(), ask(), ask(), ask(), ask()]).toStrictEqual([
      true,
      true,
      true,
      false,
      false,
      false,
    ]);

    // AND THE WINDOW STILL ROLLS. The refusals above are not a lockout.
    at.advance(60_000);
    expect(ask()).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// 2. Under the threshold, requests pass
// -----------------------------------------------------------------------------

describe('held under its threshold, the limit passes traffic', () => {
  test('the configured count of verify lookups all answer 200 and all are recorded', async () => {
    const wired = verifySource();
    useVerifySource(wired.source);
    useCertificateRateLimiter(environmentCertificateRateLimiter(env(), clock(0).now));

    const answers = await get(verifyUrl(CODE), 3);

    expect(answers.map((r) => r.statusCode)).toStrictEqual([200, 200, 200]);
    expect(wired.observed.map((o) => o.result)).toStrictEqual(['valid', 'valid', 'valid']);
  });

  test('an unknown code still answers `unknown` under the limit and is not a refusal', async () => {
    const wired = verifySource();
    useVerifySource(wired.source);
    useCertificateRateLimiter(environmentCertificateRateLimiter(env(), clock(0).now));

    // THE LIMIT DOES NOT MOVE `INV-M11-03`'s ANSWER. A `429` and an `unknown`
    // are different facts and the first must not be reachable by asking about a
    // code that names no row.
    const [answer] = await get(verifyUrl('NOT-A-CODE'), 1);

    expect(answer?.statusCode).toBe(200);
    expect(answer?.json()).toMatchObject({ result: 'unknown' });
  });

  test('the address dimension does not read the code, so a `429` discloses nothing', async () => {
    const wired = verifySource();
    useVerifySource(wired.source);
    useCertificateRateLimiter(environmentCertificateRateLimiter(env(), clock(0).now));

    // ADR-170's CONSTANT-TIME CLAUSE SURVIVES THE LIMIT BECAUSE THE LIMIT NEVER
    // READS THE TOKEN. Section 11 gives this row per IP and per ASN and
    // DELIBERATELY NOT per `code`, so a valid code and a token naming no row are
    // refused at the identical point in the sequence. Anything else would be a
    // hit-versus-miss oracle built out of a counter.
    const answers = [
      ...(await get(verifyUrl(CODE), 1)),
      ...(await get(verifyUrl('NOT-A-CODE'), 1)),
      ...(await get(verifyUrl(CODE), 1)),
      ...(await get(verifyUrl('NOT-A-CODE'), 1)),
    ];

    expect(answers.map((r) => r.statusCode)).toStrictEqual([200, 200, 200, 429]);
  });

  test('the window rolls, and `Retry-After` names its close rather than a fixed backoff', () => {
    // THE SECOND CASE THAT READS THE LIMITER DIRECTLY. Driving a boundary
    // through `inject` would mean sleeping through a real window, and a suite
    // that sleeps is a suite somebody shortens.
    const at = clock(0);
    const limiter = environmentCertificateRateLimiter(env(), at.now);
    const ask = (): ReturnType<typeof limiter.check> =>
      limiter.check({ route: 'verify', ip: '198.51.100.7', code: null });

    at.advance(45_000);
    ask();
    ask();
    ask();
    const refused = ask();

    expect(refused.allowed).toBe(false);
    // FIFTEEN SECONDS LEFT OF A SIXTY SECOND WINDOW THAT OPENED AT ZERO, which
    // is the close of the current window and not a constant.
    if (!refused.allowed) expect(refused.retryAfterSeconds).toBe(15);

    at.advance(15_000);
    expect(ask().allowed).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// 3. With the configuration removed, it refuses rather than allowing
// -----------------------------------------------------------------------------

describe('an absent configuration is a refusal and not a disabled control', () => {
  test.each(
    RATE_LIMITED_ROUTES.flatMap((route) =>
      [RATE_LIMIT_VARS[route].window, RATE_LIMIT_VARS[route].perIp, RATE_LIMIT_VARS[route].perCode]
        .filter((name): name is string => name !== null)
        .map((name) => [route, name] as const),
    ),
  )('%s refuses when %s is unset', (route, name) => {
    // EVERY VARIABLE, ONE CASE EACH, so a policy reader that defaulted ONE of
    // them would fail here rather than shipping the one dimension nobody set.
    const limiter = environmentCertificateRateLimiter(env({ [name]: undefined }), clock(0).now);

    expect(() => limiter.check({ route, ip: '198.51.100.7', code: CODE })).toThrow(
      CertificateRateLimitUnconfigured,
    );
  });

  test('a nonsense value refuses exactly as an absent one does', () => {
    // `Number('')` IS `0` AND `Number(undefined)` IS `NaN`, so a coercion would
    // turn an empty variable into a limit of zero and a typo into a limit of
    // NaN. Both must arrive as one refusal.
    for (const raw of ['', '   ', '0', '-1', '1.5', 'sixty', '1e400'])
      expect(() =>
        readRateLimitPolicy(env({ MERIT_VERIFY_RATE_LIMIT_PER_IP: raw }), 'verify'),
      ).toThrow(CertificateRateLimitUnconfigured);
  });

  test('`GET /verify/:code` answers 503 for every code alike when nothing is configured', async () => {
    const wired = verifySource();
    useVerifySource(wired.source);
    useCertificateRateLimiter(environmentCertificateRateLimiter({}, clock(0).now));

    const answers = [
      ...(await get(verifyUrl(CODE), 1)),
      ...(await get(verifyUrl('NOT-A-CODE'), 1)),
    ];

    expect(answers.map((r) => r.statusCode)).toStrictEqual([503, 503]);
    // IDENTICAL FOR BOTH, which is the property that keeps a configuration
    // error from becoming an oracle: the refusal is decided before the lookup
    // and reads nothing about the code.
    expect(answers[0]?.json()).toStrictEqual({
      ...(answers[1]?.json() as Record<string, unknown>),
      instance: (answers[0]?.json() as { instance: string }).instance,
    });
    // AND NOTHING WAS LOOKED UP OR RECORDED.
    expect(wired.observed).toStrictEqual([]);
  });

  test('the image row answers 503 rather than rendering when nothing is configured', async () => {
    const wired = imageSource();
    useCertificateImageSource(wired.source);
    useCertificateRateLimiter(environmentCertificateRateLimiter({}, clock(0).now));

    const [answer] = await get(imageUrl(CODE), 1);

    expect(answer?.statusCode).toBe(503);
    expect(answer?.headers['content-type']).toContain(PROBLEM_MEDIA_TYPE);
    // THE PNG ENCODE DID NOT HAPPEN. An unconfigured limit that served the
    // bytes anyway would be the exact failure ADR-226 refused one file over:
    // a control that is absent and a control that is off are the same thing on
    // the wire, so the absent one must refuse.
    expect(wired.rendered).toStrictEqual([]);
  });

  test('an uninstalled limiter refuses both rows and never serves unmetered', async () => {
    const verify = verifySource();
    const image = imageSource();
    useVerifySource(verify.source);
    useCertificateImageSource(image.source);
    // NOT INSTALLED AT ALL, which is the state of any process that never ran
    // `start.ts`. The port's default is the control and not a placeholder.
    expect(() =>
      UNWIRED_CERTIFICATE_RATE_LIMITER.check({ route: 'verify', ip: null, code: null }),
    ).toThrow(CertificateRateLimitUnwired);

    const answers = [...(await get(verifyUrl(CODE), 1)), ...(await get(imageUrl(CODE), 1))];

    expect(answers.map((r) => r.statusCode)).toStrictEqual([503, 503]);
    expect(verify.observed).toStrictEqual([]);
    expect(image.rendered).toStrictEqual([]);
  });
});

// -----------------------------------------------------------------------------
// What the shape of the policy is, read off the contract rather than retyped
// -----------------------------------------------------------------------------

describe('the dimensions are the ones API_CONTRACT section 11 rows', () => {
  test('the verify row has no per-`code` dimension and the image row does', () => {
    // SECTION 11 SAYS "per IP and per ASN RATHER THAN per `code`" for the verify
    // row and "Per IP and per `code`" for the image row, and the difference is
    // an argument rather than an omission: one hot card served to many viewers
    // is legitimate. A per-code counter on verify would refuse it.
    expect(RATE_LIMIT_VARS.verify.perCode).toBeNull();
    expect(RATE_LIMIT_VARS.certificate_image.perCode).not.toBeNull();
  });

  test('no number in the module is a limit, so every value comes from the environment', () => {
    // THE VARIABLES ARE THE ONLY SOURCE. A default written into the module would
    // be this repository holding a value ADR-012 keeps out of it, and it would
    // make the refusal above unreachable.
    const policy = readRateLimitPolicy(
      env({
        MERIT_VERIFY_RATE_LIMIT_WINDOW_SECONDS: '17',
        MERIT_VERIFY_RATE_LIMIT_PER_IP: '41',
      }),
      'verify',
    );

    expect(policy).toStrictEqual({ windowSeconds: 17, perIp: 41, perCode: null });
  });

  test('a caller with no observable address is not one shared bucket', () => {
    // `databaseVerifySource` WRITES `ip_hash` NULL RATHER THAN A DIGEST OF THE
    // EMPTY STRING for the same reason, and the counter follows it: one bucket
    // that every unobservable caller collides in is a limit on nobody in
    // particular, and it would refuse them all as soon as any one of them was
    // busy.
    const limiter = environmentCertificateRateLimiter(env(), clock(0).now);
    const ask = (): boolean => limiter.check({ route: 'verify', ip: null, code: null }).allowed;

    expect([ask(), ask(), ask(), ask(), ask()]).toStrictEqual([true, true, true, true, true]);
  });

  test('such a caller is still bound by the per-`code` dimension on the image row', () => {
    // WHICH IS WHY THE ABOVE IS NOT A HOLE ON THE EXPENSIVE ROW. The dimension
    // that prices the encode does not need an address at all.
    const limiter = environmentCertificateRateLimiter(env(), clock(0).now);
    const ask = (): boolean =>
      limiter.check({ route: 'certificate_image', ip: null, code: CODE }).allowed;

    expect([ask(), ask(), ask()]).toStrictEqual([true, true, false]);
  });
});

// -----------------------------------------------------------------------------
// The adapter this route is actually wired with reaches the limiter's decision
// -----------------------------------------------------------------------------

test('the composition `start.ts` installs refuses before it renders', async () => {
  // THE PORT UNDER TEST ABOVE IS A FIXTURE, AND THIS CASE USES THE REAL ADAPTER
  // so that a limiter placed after the composition rather than before it fails
  // here. `databaseCertificateImageSource` reads its configuration and then
  // opens the public door; a refusal that reached it would be a 503 about an
  // unset card lifetime instead of a 429, and this case would see it.
  useCertificateImageSource(databaseCertificateImageSource({} as never, {}));
  useCertificateRateLimiter(environmentCertificateRateLimiter(env(), clock(0).now));

  const answers = await get(imageUrl(CODE), 3);

  expect(answers.map((r) => r.statusCode)).toStrictEqual([503, 503, 429]);
});
