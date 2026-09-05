// =============================================================================
// apps/api/src/certificate-rate-limit.ts
// =============================================================================
// `INV-M11-05`'s SECOND CLAUSE, WHICH FIVE ENTRIES RECORDED AS OWED AND NONE
// BUILT.
//
// The invariant reads, in its own words in `M11` section 1.3: *"Certificate
// codes are unguessable **and the verification endpoint is rate limited** and
// non-enumerable"*. ADR-235
// section 5 ruled that clause OWED AND ABSENT, re-derived by search, and ruled
// that no arithmetic about the code space discharges it: `AS-M11-04` counter 1
// is the entropy and counter 3 is the limit, and *"the limit is what makes an
// attempt VISIBLE; the entropy is what makes it FAIL"*.
//
// This file is counter 3's first half. It is a COUNTER and it is not the edge.
//
// -----------------------------------------------------------------------------
// WHAT THE CORPUS ASKS FOR, PER ROUTE, READ AT THE ROW RATHER THAN SUMMARISED
// -----------------------------------------------------------------------------
// API_CONTRACT section 11 gives the two public certificate rows one line each
// and they deliberately differ:
//
//   `GET /certificates/:code/image.png`  "Per IP and **per `code`**, because an
//       enumeration campaign and a single hot card look identical when only the
//       IP is counted."
//
//   `GET /verify/:code`                  "Public, and per IP and per ASN rather
//       than per `code`", because "one hot card served to many viewers is
//       legitimate, and one code verified by thousands of distinct sources is
//       `AS-M11-04`'s enumeration signature."
//
// So there are THREE dimensions across two routes, not one control applied
// twice, and this file implements the two it can and refuses to fake the third.
// Both rows also say the limits are **data rather than prose**, on the
// `POST /auth/otp` sms row's precedent, and NO NUMBER IN THIS FILE IS A LIMIT:
// every value arrives from the deployment and an absent one is a refusal.
//
// -----------------------------------------------------------------------------
// PER ASN IS NOT BUILT, AND THE BLOCKER IS NAMED RATHER THAN WORKED AROUND
// -----------------------------------------------------------------------------
// An ASN is not observable from a socket. Resolving one needs a mapping from
// address to autonomous system, which is a DATA SOURCE, and this tree has none:
// `apps/api/package.json` declares one runtime dependency (`fastify`), no
// package in the workspace carries a routing table, `certificate_verifications`
// has an `ip_hash` column and NO asn column (`0025_reserved_sequence.sql`), and
// the session that wrote this measured the egress: three public ASN endpoints
// answered `CONNECT tunnel failed, response 403` through the agent proxy.
//
// A "per ASN" limit built on anything this process can compute today would be a
// per-IP limit wearing a second name, and a second name on one counter is worse
// than the missing counter: it reports a dimension nobody is counting.
// **It is therefore OWED, with its blocker named, and ADR-347 records it.**
//
// -----------------------------------------------------------------------------
// AND THE ADDRESS IS THE IMMEDIATE PEER, WHICH IS THE HALF THAT BELONGS AT AN
// EDGE MERIT DOES NOT YET OPERATE
// -----------------------------------------------------------------------------
// SECURITY C-07 rows rate limits as "edge and app". `auth-backend.ts` reached
// this same wall from the other side and DECLINED to build over it: its
// `POST /auth/otp` per-IP half is deliberately absent because `server.ts:170`
// builds the instance as `Fastify({ logger: options.logger ?? false })` and
// configures no `trustProxy` anywhere, so `request.ip` is the IMMEDIATE PEER,
// and behind an edge that is one address for every trader at once.
//
// THIS FILE TAKES THE OPPOSITE DECISION ON THE SAME FACT, AND THE DIFFERENCE IS
// THE NUMBER RATHER THAN THE ADDRESS. That limit is `5/hour/email`'s sibling and
// is fixed in prose at five, so one shared bucket would have been five requests
// per hour for the whole product. These limits are DATA the deployment sets, on
// a row whose contract says so, so a deployment that sits behind an edge sizes
// them for what its origin actually sees, or moves the control to the edge and
// says so. What is refused is inventing a number here and calling one bucket a
// per-IP limit.
//
// **THE HONEST STATEMENT OF WHAT THIS BUYS.** Today no edge is operated: INFRA
// section 2 proposes Cloudflare as ADR-007 and nothing in this repository
// configures one, so the peer IS the caller and the per-IP dimension is a real
// per-caller limit. The day an origin sits behind a proxy without `trustProxy`,
// the same counter becomes a GLOBAL limit with a per-IP name. **No check in this
// repository can see an edge appear in front of it**, so that transition is
// written here rather than watched, and that cost is stated instead of
// discovered.
//
// -----------------------------------------------------------------------------
// WHY A COUNTER IN THIS PROCESS AND NOT A QUERY OVER `certificate_verifications`
// -----------------------------------------------------------------------------
// The obvious alternative is the OTP send budget's shape: count the window off
// the table the route already writes, exactly as `requestOtp` counts
// `otp_challenges`. IT CANNOT BE MADE CORRECT HERE WITHOUT A MIGRATION, and the
// reason is the table's own vocabulary rather than a preference.
//
// `certificate_verifications.result` is `CHECK (result IN ('valid', 'unknown',
// 'revoked', 'deferred'))` and has NO MEMBER FOR A REFUSED REQUEST. A refused
// request would therefore either go unrecorded, which makes the limiter
// SELF-BLINDING (over the limit, nothing is counted, the window drains, and the
// attacker gets a duty cycle), or be recorded as `unknown`, which is a lie
// injected into the exact signal `AS-M11-04` counter 3 names: *"a high
// distinct-code rate with a near-total unknown rate"*. Adding a fifth member is
// a migration, ADR-235 section 6.1 already ruled that a bound in DDL is a
// migration and refused to widen a fence to reach one, and **this row reserves
// no migration number either**.
//
// A COUNTER IN MEMORY COUNTS EVERY REQUEST INCLUDING THE ONES IT REFUSES, needs
// no column and no vocabulary, and is what an application-layer limiter is.
// Its two costs are stated rather than hidden:
//
//   1. IT IS PER PROCESS. N replicas serve N times the configured limit. A
//      shared counter is the edge's job and is the same owed item as above.
//   2. ITS KEY SPACE IS BOUNDED PER WINDOW AND NOT ABSOLUTELY. The map holds at
//      most the distinct keys seen inside one window and is DROPPED WHOLE when
//      the window rolls. It is deliberately not capped: a limiter that refuses
//      everybody once its bookkeeping is full is a denial-of-service switch an
//      attacker flips on purpose, which is a worse failure than the memory.
//
// AND THE DETECTOR STILL SEES LESS THAN THE LIMITER DOES, which is the price of
// (1) above stated at the surface that pays it: `certificate_verifications`
// records every request the limiter ADMITS and none that it refuses, so past the
// limit the table shows a rate CAPPED at the limit rather than the true one. The
// enumeration signature still fires up to the cap. Closing the gap is the fifth
// `result` member, owed with the migration.
//
// -----------------------------------------------------------------------------
// AN ABSENT CONFIGURATION IS A REFUSAL AND NOT A DISABLED CONTROL (ADR-226)
// -----------------------------------------------------------------------------
// ADR-226 ruled that an absent Turnstile secret refuses rather than passing, and
// ADR-240 applied the same rule to a threshold. A rate limit is the same shape a
// third time: a deployment that set no limit has not decided that traffic is
// unlimited, it has not finished being deployed. So every variable below is
// REQUIRED, nothing is defaulted (ADR-012 keeps values out of this repository),
// and an unset or nonsense one answers `503` for every caller alike.
//
// THE REFUSAL IS DECIDED BEFORE ANY OTHER WORK, in both handlers, which is the
// one placement that makes it a bound on the work rather than a report about it.
// On `GET /verify/:code` that also makes it disclose nothing: the decision reads
// the ADDRESS and never the code, so a `429` there is identical for a code that
// resolves and one that names no row, and `ADR-170`'s constant-time floor is
// untouched because no branch of it is reached. On the image row the decision
// reads the code, and that row sits OUTSIDE `INV-M11-05`'s constant-time clause
// by API_CONTRACT section 6.3's own words.
// =============================================================================

import type { FastifyReply, FastifyRequest } from 'fastify';

import { PROBLEM_MEDIA_TYPE, problem, type Problem } from './server.ts';
import type { Environment } from './surface.ts';

// -----------------------------------------------------------------------------
// The routes, and the variables each one's limits arrive in
// -----------------------------------------------------------------------------

/** The two public certificate rows API_CONTRACT section 11 limits separately. */
export const RATE_LIMITED_ROUTES = ['verify', 'certificate_image'] as const;

/** One of {@link RATE_LIMITED_ROUTES}. */
export type RateLimitedRoute = (typeof RATE_LIMITED_ROUTES)[number];

/**
 * The variables one route's policy is read from.
 *
 * `perCode` IS `null` ON THE ROUTE WHOSE ROW DOES NOT CARRY THE DIMENSION, and
 * that is a transcription rather than an economy. Section 11's verify row reads
 * *"per IP and per ASN **rather than** per `code`"*, so a per-code counter there
 * would be this file adding a dimension the contract removed on purpose.
 */
export interface RateLimitVars {
  readonly window: string;
  readonly perIp: string;
  readonly perCode: string | null;
}

/**
 * The variables, per route.
 *
 * ONE WINDOW PER ROUTE RATHER THAN ONE SHARED WINDOW, because section 11 states
 * every other limit in this contract as a rate (`5/hour/IP`, `600/minute/IP`)
 * and a rate is a count AND a window. Two routes sharing one window would make
 * one row's number mean something the other row never said.
 *
 * BOTH DIMENSIONS OF THE IMAGE ROW SHARE ITS WINDOW, which is the same reading
 * held one level down: `per IP and per code` is one rate expressed over two
 * keys, and it is the row that is rated rather than each key separately.
 */
export const RATE_LIMIT_VARS: Readonly<Record<RateLimitedRoute, RateLimitVars>> = {
  verify: {
    window: 'MERIT_VERIFY_RATE_LIMIT_WINDOW_SECONDS',
    perIp: 'MERIT_VERIFY_RATE_LIMIT_PER_IP',
    perCode: null,
  },
  certificate_image: {
    window: 'MERIT_CERTIFICATE_IMAGE_RATE_LIMIT_WINDOW_SECONDS',
    perIp: 'MERIT_CERTIFICATE_IMAGE_RATE_LIMIT_PER_IP',
    perCode: 'MERIT_CERTIFICATE_IMAGE_RATE_LIMIT_PER_CODE',
  },
};

// -----------------------------------------------------------------------------
// The policy
// -----------------------------------------------------------------------------

/** One route's limits, all of them the deployment's. */
export interface RateLimitPolicy {
  /** The window, in whole seconds. */
  readonly windowSeconds: number;
  /** Requests per window per observed address. */
  readonly perIp: number;
  /** Requests per window per `code`, or `null` where the row has no such dimension. */
  readonly perCode: number | null;
}

/**
 * Raised when a variable is absent or is not a positive whole number.
 *
 * ANSWERED `503` AND NEVER `500`, which is `CertificateImageUnconfigured`'s and
 * `VerifyPresentationError`'s rule: a deployment nobody finished is not a defect,
 * and the message sends an operator to the variable rather than hunting a bug.
 */
export class CertificateRateLimitUnconfigured extends Error {
  constructor(variable: string, raw: string | undefined) {
    super(
      `${variable} is \`${raw === undefined ? 'unset' : raw}\`, which is not a positive whole ` +
        'number. `INV-M11-05` requires this endpoint to be rate limited and API_CONTRACT ' +
        'section 11 holds the values as data, so an absent limit is a deployment that has not ' +
        'been finished rather than a decision that the traffic is unlimited (ADR-226)',
    );
    this.name = 'CertificateRateLimitUnconfigured';
  }
}

/** Raised when no limiter is installed at all. Answered `503`, never a served card. */
export class CertificateRateLimitUnwired extends Error {
  constructor(route: RateLimitedRoute) {
    super(
      `no rate limiter is installed, so \`${route}\` answers 503 rather than serving unmetered. ` +
        "`INV-M11-05`'s limit is a control this route rests on (`AS-M11-04` counter 3), and a " +
        'process that never ran the wiring slice holds no control at all',
    );
    this.name = 'CertificateRateLimitUnwired';
  }
}

/**
 * Read one positive whole number out of the environment.
 *
 * PARSED RATHER THAN COERCED, which is `environmentVerifyPresentation`'s stated
 * reason for the same shape: `Number('')` is `0` and `Number(undefined)` is
 * `NaN`, so an absent variable and a nonsense one must arrive as one refusal.
 * NO UPPER BOUND IS INVENTED. No approved document gives one, and a ceiling
 * written here would be this file deciding a limit it just said it does not set.
 */
function wholeNumberAbove(raw: string | undefined, variable: string): number {
  if (raw === undefined || raw.trim() === '')
    throw new CertificateRateLimitUnconfigured(variable, raw);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new CertificateRateLimitUnconfigured(variable, raw);
  return value;
}

/**
 * One route's policy, from the environment.
 *
 * READ ON EVERY REQUEST rather than once at construction, which is
 * `VerifySource.presentation`'s own rule: a configuration validated lazily, or
 * validated once on a path some callers do not take, is a configuration error
 * that answers differently for different callers.
 */
export function readRateLimitPolicy(env: Environment, route: RateLimitedRoute): RateLimitPolicy {
  const vars = RATE_LIMIT_VARS[route];
  return {
    windowSeconds: wholeNumberAbove(env[vars.window], vars.window),
    perIp: wholeNumberAbove(env[vars.perIp], vars.perIp),
    perCode: vars.perCode === null ? null : wholeNumberAbove(env[vars.perCode], vars.perCode),
  };
}

// -----------------------------------------------------------------------------
// The counter
// -----------------------------------------------------------------------------

/**
 * A fixed window aligned to the clock, one map per route.
 *
 * FIXED AND NOT SLIDING, and the cost is stated rather than left to be found: a
 * caller who spends the whole allowance at the end of one window and the whole
 * allowance at the start of the next sends twice the limit across the boundary.
 * A sliding window costs a per-key list of timestamps, which is the same
 * unbounded key space with a larger constant, and the burst it removes is one
 * window wide. The window is the deployment's number, so a deployment that cares
 * about the boundary shortens it.
 *
 * THE MAP IS DROPPED WHOLE WHEN THE WINDOW ROLLS rather than swept per key, so
 * nothing accumulates across windows and no key needs an expiry of its own.
 */
class FixedWindow {
  #startedMs = -1;
  #counts = new Map<string, number>();

  /** Count one request against `key` and answer the new count. */
  hit(key: string, nowMs: number, windowMs: number): number {
    const startedMs = Math.floor(nowMs / windowMs) * windowMs;
    if (startedMs !== this.#startedMs) {
      this.#startedMs = startedMs;
      this.#counts = new Map();
    }
    const next = (this.#counts.get(key) ?? 0) + 1;
    this.#counts.set(key, next);
    return next;
  }

  /** Whole seconds until the current window closes, never below one. */
  static retryAfterSeconds(nowMs: number, windowMs: number): number {
    const startedMs = Math.floor(nowMs / windowMs) * windowMs;
    // AT LEAST ONE SECOND, on `checkout.ts`'s precedent for the same header: a
    // `Retry-After: 0` reads as "immediately", which is the one thing this
    // answer does not mean.
    return Math.max(1, Math.ceil((startedMs + windowMs - nowMs) / 1000));
  }
}

// -----------------------------------------------------------------------------
// The port
// -----------------------------------------------------------------------------

/** What one request looks like to the limiter. */
export interface RateLimitRequest {
  readonly route: RateLimitedRoute;
  /**
   * The caller's address, or `null` where this deployable observed none.
   *
   * `null` IS NOT A BUCKET. `databaseVerifySource` writes `ip_hash` NULL rather
   * than a digest of the empty string for the same reason: one shared bucket
   * that every unobservable caller collides in is a limit on nobody in
   * particular. Such a request passes the per-IP dimension and is still bound by
   * the per-code one where the row carries it.
   */
  readonly ip: string | null;
  /** The attempted code, or `null` on a route with no per-code dimension. */
  readonly code: string | null;
}

/** Admitted, or refused with the wait and the dimension that refused. */
export type RateLimitDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly retryAfterSeconds: number;
      readonly dimension: 'ip' | 'code';
    };

/** What both handlers ask before they do anything else. */
export interface CertificateRateLimiter {
  /**
   * Count this request and decide.
   *
   * THROWS `CertificateRateLimitUnconfigured` WHEN THE DEPLOYMENT SET NOTHING,
   * and does not silently admit. That is the whole of ADR-226's rule here.
   */
  check(request: RateLimitRequest): RateLimitDecision;
}

/**
 * The fail-closed default. IT REFUSES.
 *
 * A default that admitted would make a process which never ran the wiring slice
 * serve the most expensive unauthenticated handler in the tree unmetered, and it
 * would do so while every other port in this deployable answered 503, which is
 * the shape of a control nobody notices is missing.
 */
export const UNWIRED_CERTIFICATE_RATE_LIMITER: CertificateRateLimiter = {
  check: (request) => {
    throw new CertificateRateLimitUnwired(request.route);
  },
};

let limiter: CertificateRateLimiter = UNWIRED_CERTIFICATE_RATE_LIMITER;

/** Install the limiter. The wiring slice calls this; so does the suite. */
export function useCertificateRateLimiter(next: CertificateRateLimiter): void {
  limiter = next;
}

/** Restore the fail-closed default. */
export function resetCertificateRateLimiter(): void {
  limiter = UNWIRED_CERTIFICATE_RATE_LIMITER;
}

/** The installed limiter. */
export function currentCertificateRateLimiter(): CertificateRateLimiter {
  return limiter;
}

/**
 * The limiter a deployment gets: the environment's numbers over in-process
 * counters.
 *
 * THE CLOCK IS AN ARGUMENT so the suite can drive a window boundary without
 * sleeping through one, which is the same reason `holdFloor` takes its own
 * timings rather than reading the clock twice inside itself.
 *
 * THE PER-IP DIMENSION IS COUNTED FIRST AND THE PER-CODE DIMENSION IS COUNTED
 * ANYWAY. A refusal that stopped counting would let a caller who is already over
 * one dimension spend the other for free, and the whole reason this counter is
 * in memory rather than in the table is that it counts what it refuses.
 */
export function environmentCertificateRateLimiter(
  env: Environment = process.env,
  now: () => number = () => Date.now(),
): CertificateRateLimiter {
  const windows = new Map<string, FixedWindow>();
  const windowFor = (key: string): FixedWindow => {
    const found = windows.get(key);
    if (found !== undefined) return found;
    const made = new FixedWindow();
    windows.set(key, made);
    return made;
  };

  return {
    check: (request) => {
      const policy = readRateLimitPolicy(env, request.route);
      const windowMs = policy.windowSeconds * 1000;
      const nowMs = now();

      const overIp =
        request.ip !== null &&
        windowFor(`${request.route}:ip`).hit(request.ip, nowMs, windowMs) > policy.perIp;

      const overCode =
        policy.perCode !== null &&
        request.code !== null &&
        windowFor(`${request.route}:code`).hit(request.code, nowMs, windowMs) > policy.perCode;

      if (!overIp && !overCode) return { allowed: true };
      return {
        allowed: false,
        retryAfterSeconds: FixedWindow.retryAfterSeconds(nowMs, windowMs),
        // THE ADDRESS IS REPORTED AHEAD OF THE CODE WHERE BOTH ARE OVER, and it
        // is a log field rather than a response field: the wire carries the
        // canonical `rate_limited` and nothing else, because which dimension
        // refused is a fact about Merit's traffic and section 2's problem
        // document has no free text on this surface.
        dimension: overIp ? 'ip' : 'code',
      };
    },
  };
}

// -----------------------------------------------------------------------------
// The refusal
// -----------------------------------------------------------------------------

/**
 * Section 2's `rate_limited`, `429`, with `Retry-After`.
 *
 * THE CODE AND THE TITLE ARE `server.ts`' AND NOT THIS FILE'S. `STATUS_CODE`
 * already maps `429` to `rate_limited` and `TITLE` already carries
 * *"Rate limited"*, so a second spelling here would be a second vocabulary for
 * one answer. ADR-235 section 5 ruling 2 records that both existed and that
 * *"nothing on this route reaches them"*; this is the reach.
 *
 * `Retry-After` IS SENT ON EVERY REFUSAL, on `POST /auth/otp`'s and
 * `POST /checkout`'s precedent for the identical answer, and it names the close
 * of the current window rather than a backoff this file invented.
 *
 * NOTHING IS SAID ABOUT WHICH DIMENSION REFUSED. Section 2's problem document
 * carries no free text on the certificate rows, and telling a caller whether the
 * address or the code exhausted the budget would tell an enumerator which knob
 * to turn.
 */
export function rateLimitProblem(instance: string): Problem {
  return problem('rate_limited', 429, instance);
}

/**
 * Send the refusal.
 *
 * `cacheControl` IS THE CALLER'S because the two rows differ and neither
 * inherits the other's. `GET /verify/:code` sets `no-store` on every response
 * including its refusals (`VERIFY_CACHE_CONTROL`, and `FM-M11-02` is why); the
 * image row sets none on its `404` or its `503`, so a `429` that invented one
 * would be the only refusal on that route carrying a caching instruction.
 */
export function sendRateLimited(
  request: FastifyRequest,
  reply: FastifyReply,
  decision: Extract<RateLimitDecision, { allowed: false }>,
  cacheControl: string | null,
): FastifyReply {
  request.log.warn(
    { dimension: decision.dimension, retryAfterSeconds: decision.retryAfterSeconds },
    'certificate rate limit refused a request',
  );
  const sending = reply
    .code(429)
    .type(PROBLEM_MEDIA_TYPE)
    .header('Retry-After', String(decision.retryAfterSeconds));
  return (cacheControl === null ? sending : sending.header('Cache-Control', cacheControl)).send(
    rateLimitProblem(request.id),
  );
}
