// =============================================================================
// apps/api/src/turnstile.ts
// =============================================================================
// THE CONSTITUTION'S `Turnstile on auth+checkout` (Appendix D, section D2), AND
// UNTIL THIS FILE EXISTED THE TOKEN WAS TAKEN AND THROWN AWAY.
//
// `routes/auth.ts` declared `turnstile_token` on `OtpRequest`, checked it was a
// non-empty string, and never referred to it again; a search for `siteverify`
// or `TURNSTILE_SECRET` over `apps`, `packages`, `e2e`, `scripts` and `.github`
// matched nothing at all. ADR-226 rules that WORSE THAN AN ABSENT CONTROL and
// says why in one line: a required field that is never verified TEACHES A
// CALLER THAT ANY STRING WORKS, and it makes the endpoint look protected to
// every reader of the type. `apps/portal/src/http/client.ts` lists Turnstile
// among "the binding application controls" beside the CSP on exactly that
// strength.
//
// This file decides ONE question -- is this token one Cloudflare will vouch for
// -- and it answers with an OUTCOME rather than a boolean. `routes/auth.ts`
// turns the outcome into a status code. The split is the same one `csrf.ts`
// takes with `server.ts`: the verdict is testable without a route.
//
// -----------------------------------------------------------------------------
// NO SECRET, NO SITE KEY AND NO MERIT HOSTNAME IS WRITTEN HERE (ADR-012)
// -----------------------------------------------------------------------------
// {@link TURNSTILE_SITEVERIFY_URL} is a PUBLIC Cloudflare endpoint and it is a
// constant for the same reason `LIVENESS_PATH` is one: it is a fact about a
// vendor's API rather than a fact about a deployment. The credential is
// {@link TURNSTILE_SECRET_VAR}, which is a variable NAMED here and VALUED
// nowhere in this repository, exactly as `MERIT_OTP_MAC_KEY` is (ADR-197, INFRA
// section 7). The site key is the widget's and no widget exists yet, so this
// file has no reason to know one.
//
// -----------------------------------------------------------------------------
// FOUR OUTCOMES, AND THREE OF THEM REFUSE
// -----------------------------------------------------------------------------
// `passed` is the only one that admits. The other three are separated because
// they are three different facts about the world and an operator needs to tell
// them apart, NOT because the caller is told which one happened:
//
//   `failed`       Cloudflare looked at the token and said no. The caller's
//                  problem, and the only outcome a client can act on.
//   `unconfigured` this deployment holds no secret, so no token CAN be checked.
//                  Merit's problem, and it is never a pass. See below.
//   `unavailable`  the call did not complete, or came back in a shape this file
//                  cannot read. Nobody's problem and still not a pass.
//
// -----------------------------------------------------------------------------
// AN ABSENT SECRET IS A REFUSAL AND NEVER A DISABLED CONTROL
// -----------------------------------------------------------------------------
// The failure mode this control exists to remove is a check that silently does
// nothing, so the one answer it may not give when it cannot run is "fine".
// `unconfigured` refuses, and `routes/auth.ts` serves it as 503.
//
// THE REFUSAL IS PER CALL AND NOT AT PROCESS START, on ADR-197's stated ground
// for `MERIT_OTP_MAC_KEY`: a key resolved in `start.ts` "would make a missing
// secret a process that will not start, which turns a config omission on one
// route into an outage on all of them". A second ground is this deployable's
// own shape: `apps/api` runs as TWO services off one codebase and `/auth/otp`
// classifies `public`, so a start-time refusal would take `api-admin` down over
// a secret the operator surface never uses.
//
// THE SECRET IS READ PER CALL AND NOT MEMOISED, for `resolveOtpMacKeys`'s
// reason: a value captured at import is a value a rotation cannot reach.
//
// -----------------------------------------------------------------------------
// THE TIMEOUT, AND WHY IT IS NOT `ENRICHMENT_TIMEOUT_MS`
// -----------------------------------------------------------------------------
// This is an OUTBOUND NETWORK CALL ON THE SIGN-IN PATH and Node's `fetch`
// imposes no deadline this code chooses, so without {@link
// TURNSTILE_TIMEOUT_MS} a Cloudflare that accepts a connection and never
// answers is a sign-in request that holds a socket for as long as the runtime
// allows, once per attempt, for as many attempts as arrive.
//
// 800ms IS THE ENRICHMENT BUDGET AND IT IS THE WRONG NUMBER HERE. That one runs
// INSIDE checkout's transaction, so its cost is a held database connection and
// tightness is the whole point; this one holds no transaction and its cost is a
// socket. What it must not do is convert ordinary latency variance into a
// refusal, because this control fails CLOSED: a budget too tight is a lockout
// with no attacker involved. 3s bounds one HTTPS round trip to an anycast edge
// with room to spare, and it bounds it.
//
// THERE IS NO RETRY. The outcome is a refusal either way, so a second attempt
// doubles the worst-case latency of a sign-in to buy a marginal chance against
// one dropped packet, and it doubles the traffic Merit sends Cloudflare at
// exactly the moment Cloudflare is struggling.
//
// -----------------------------------------------------------------------------
// `remoteip` IS DELIBERATELY NOT SENT, AND THIS IS THE LANDMINE
// -----------------------------------------------------------------------------
// Cloudflare accepts an optional `remoteip`, and it must be the address that
// SOLVED the challenge. `server.ts` builds Fastify with `{ logger }` and
// nothing else -- `trustProxy` appears in no file under `apps/api/src` -- so
// `request.ip` is the IMMEDIATE PEER, which behind Cloudflare and Railway is an
// edge address rather than the trader's. Sending it would submit a value that
// disagrees with the solve on every real request while agreeing with itself in
// every test, which is a control that passes here and refuses in production.
// The field is optional; it is omitted until something in this tree can produce
// the right value.
//
// -----------------------------------------------------------------------------
// THE VENDOR'S `error-codes` ARE LOGGED AND NEVER BRANCHED ON
// -----------------------------------------------------------------------------
// A `success: false` is `failed` whatever reason rides with it, INCLUDING the
// reasons that are Merit's own fault (a secret that is absent from the request,
// or wrong). Branching would mean transcribing a vendor's code vocabulary into
// a control, and a transcribed vocabulary that is wrong is wrong in the
// direction of admitting. ADR-226 states the cost this buys instead: a secret
// rotated wrong presents as 403 on every sign-in rather than 503, which is
// equally loud and equally closed, and the `error-codes` array reaches the LOG
// so an operator can tell the two apart in one line.
// =============================================================================

import type { Environment } from './surface.ts';

/**
 * The environment variable holding the Turnstile secret key.
 *
 * NAMED HERE AND VALUED NOWHERE IN THIS REPOSITORY (ADR-012). INFRA section 7
 * scopes secrets per service in the platform vault; this is the name that
 * deployment sets on the `api` service.
 */
export const TURNSTILE_SECRET_VAR = 'MERIT_TURNSTILE_SECRET';

/**
 * Cloudflare's verification endpoint.
 *
 * PUBLIC, DOCUMENTED AND THE SAME FOR EVERY TENANT, so it is a constant rather
 * than configuration: a deployment cannot need a different one, and an
 * environment variable here would be a way to point the control somewhere that
 * always says yes.
 */
export const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** The deadline on the outbound call, in milliseconds. See the header. */
export const TURNSTILE_TIMEOUT_MS = 3_000;

/**
 * What one verification decided.
 *
 * IT CARRIES THE REASON AND NOT ONLY THE BOOLEAN, on `CsrfVerdict`'s precedent:
 * a suite asserting `passed` on a token it believes was checked cannot
 * otherwise tell that the secret was missing and the call never happened.
 *
 * `detail` is for the LOG. Nothing here is written into a response body.
 */
export type TurnstileOutcome =
  | { readonly outcome: 'passed' }
  | { readonly outcome: 'failed'; readonly detail: string }
  | { readonly outcome: 'unconfigured'; readonly detail: string }
  | { readonly outcome: 'unavailable'; readonly detail: string };

/**
 * The port. One method, because there is one question.
 *
 * A PORT RATHER THAN A FUNCTION so the suite can install a verifier that
 * refuses, or passes, or hangs, without a socket and without a network policy.
 * `routes/auth.ts` holds the installed one exactly as it holds `AuthBackend`.
 */
export interface TurnstileVerifier {
  verify(token: string): Promise<TurnstileOutcome>;
}

/** What `fetch` looks like to this file. Narrowed so a fake needs no DOM types. */
export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const UNCONFIGURED =
  `this deployment sets no \`${TURNSTILE_SECRET_VAR}\`, so no token can be checked against ` +
  'Cloudflare. There is deliberately no fallback and deliberately no pass: a secret absent from ' +
  'one environment must not be the way the control switches itself off in another. ADR-226';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The vendor's `error-codes`, rendered for a log line and for nothing else.
 *
 * Total over a field this file does not control: a missing array, a present one
 * holding numbers, and a string where an array was expected all render rather
 * than throw, because a verification must not fail on the shape of its own
 * explanation.
 */
function renderErrorCodes(value: unknown): string {
  if (!Array.isArray(value)) return 'none reported';
  const codes = value.filter((code): code is string => typeof code === 'string');
  return codes.length === 0 ? 'none reported' : codes.join(', ');
}

/**
 * The real verifier.
 *
 * @param env       where {@link TURNSTILE_SECRET_VAR} is read from, per call.
 *                  A parameter for `databaseAuthBackend`'s reason: a suite that
 *                  could not vary the environment could assert none of the
 *                  configuration behaviour.
 * @param fetchImpl the outbound call. Injected so the suite exercises THIS
 *                  function's request shape, timeout and response handling
 *                  rather than a re-implementation of them.
 * @param timeoutMs overrides {@link TURNSTILE_TIMEOUT_MS}. For suites.
 *
 * NOTHING HERE THROWS. Every failure is an outcome, because a rejection on the
 * sign-in path would be caught by `endpointHandler`'s `AuthBackendUnwired`
 * filter, fail its `instanceof`, and reach Fastify's own error handler as a
 * 500: a control's refusal would arrive as a bug.
 */
export function cloudflareTurnstileVerifier(
  env: Environment = process.env,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
  timeoutMs: number = TURNSTILE_TIMEOUT_MS,
): TurnstileVerifier {
  return {
    async verify(token: string): Promise<TurnstileOutcome> {
      const secret = env[TURNSTILE_SECRET_VAR];
      if (secret === undefined || secret.trim() === '')
        return { outcome: 'unconfigured', detail: UNCONFIGURED };

      let response: { ok: boolean; status: number; json: () => Promise<unknown> };
      try {
        response = await fetchImpl(TURNSTILE_SITEVERIFY_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          // `URLSearchParams` percent-encodes both members, so neither the
          // secret nor a caller-supplied token can break out of the body.
          body: new URLSearchParams({ secret, response: token }).toString(),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        // An abort, a DNS failure, a reset, a TLS error. The message reaches
        // the log; the caller is told only that a dependency is down.
        return { outcome: 'unavailable', detail: `siteverify did not answer: ${String(err)}` };
      }

      if (!response.ok)
        return {
          outcome: 'unavailable',
          detail: `siteverify answered HTTP ${String(response.status)}`,
        };

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (err) {
        return {
          outcome: 'unavailable',
          detail: `siteverify answered unreadable JSON: ${String(err)}`,
        };
      }

      const body = asRecord(payload);
      if (body === null)
        return {
          outcome: 'unavailable',
          detail: 'siteverify answered something that is not an object',
        };

      const success = body['success'];
      if (success === true) return { outcome: 'passed' };
      // A `success` that is neither boolean is NOT read as a failure. The
      // difference is what the caller is told to do: `failed` says solve the
      // challenge again, and a client that cannot parse Cloudflare has no
      // challenge to re-solve.
      if (success !== false)
        return {
          outcome: 'unavailable',
          detail: 'siteverify answered no boolean `success` member',
        };

      return {
        outcome: 'failed',
        detail: `siteverify refused the token. error-codes: ${renderErrorCodes(body['error-codes'])}`,
      };
    },
  };
}
