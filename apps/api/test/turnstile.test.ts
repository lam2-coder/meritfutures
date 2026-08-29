import { expect, test } from 'vitest';

import {
  TURNSTILE_SECRET_VAR,
  TURNSTILE_SITEVERIFY_URL,
  TURNSTILE_TIMEOUT_MS,
  cloudflareTurnstileVerifier,
} from '../src/turnstile.ts';
import type { FetchLike } from '../src/turnstile.ts';

// CI-02, the `unit` project.
//
// ADR-226. THE VERIFIER, EXERCISED THROUGH ITS OWN `fetch` RATHER THAN AROUND
// IT. Every case below drives `cloudflareTurnstileVerifier`'s real body: the
// request it builds, the deadline it sets, and its total reading of an answer
// it does not control. The injected `fetch` stands in for the socket and for
// nothing else, so a defect in the request shape or in the response handling is
// visible here.
//
// NO REAL SECRET, NO REAL SITE KEY AND NO CLOUDFLARE CALL (ADR-012). The secret
// below is a fixture string; the endpoint constant is a public, tenant-agnostic
// Cloudflare URL and nothing here reaches it.

/** A fixture value. Not a credential and not one anywhere. */
const SECRET = 'fixture-secret-not-a-credential';

const CONFIGURED = { [TURNSTILE_SECRET_VAR]: SECRET };

/** A `fetch` that answers one JSON body and records what it was handed. */
function answering(
  payload: unknown,
  options: { ok?: boolean; status?: number } = {},
): { fetchImpl: FetchLike; calls: { url: string; init: Parameters<FetchLike>[1] }[] } {
  const calls: { url: string; init: Parameters<FetchLike>[1] }[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve({
      ok: options.ok ?? true,
      status: options.status ?? 200,
      json: () => Promise.resolve(payload),
    });
  };
  return { fetchImpl, calls };
}

/** A `fetch` that must never be reached. */
const NEVER: FetchLike = () => {
  throw new Error('siteverify was called when it should not have been');
};

// -----------------------------------------------------------------------------
// The secret, and what an absent one means
// -----------------------------------------------------------------------------

test('an absent secret is `unconfigured`, and no call is made at all', async () => {
  // THE RULING'S CENTRE. A control that cannot run must not answer "fine", and
  // it must not spend a request finding that out either.
  const outcome = await cloudflareTurnstileVerifier({}, NEVER).verify('any-string');
  expect(outcome.outcome).toBe('unconfigured');
});

test('a blank secret is an absent secret', async () => {
  // An empty string is what an unset platform variable looks like once
  // something has helpfully defaulted it, and a whitespace one is what a paste
  // leaves behind. Neither is a key.
  for (const value of ['', '   ']) {
    const outcome = await cloudflareTurnstileVerifier(
      { [TURNSTILE_SECRET_VAR]: value },
      NEVER,
    ).verify('t');
    expect(outcome.outcome).toBe('unconfigured');
  }
});

test('the secret is read per call, so a rotation does not need a restart', async () => {
  // `resolveOtpMacKeys`'s rule, for the same reason: a value captured at
  // construction is a value a rotation cannot reach.
  const env: Record<string, string | undefined> = {};
  const { fetchImpl } = answering({ success: true });
  const verifier = cloudflareTurnstileVerifier(env, fetchImpl);
  expect((await verifier.verify('t')).outcome).toBe('unconfigured');
  env[TURNSTILE_SECRET_VAR] = SECRET;
  expect((await verifier.verify('t')).outcome).toBe('passed');
});

// -----------------------------------------------------------------------------
// The request that is actually sent
// -----------------------------------------------------------------------------

test('the request is a form POST to Cloudflare carrying the secret and the token', async () => {
  const { fetchImpl, calls } = answering({ success: true });
  await cloudflareTurnstileVerifier(CONFIGURED, fetchImpl).verify('the-token');
  expect(calls).toHaveLength(1);
  const call = calls[0];
  if (call === undefined) throw new Error('unreachable: length was asserted');
  expect(call.url).toBe(TURNSTILE_SITEVERIFY_URL);
  expect(call.init.method).toBe('POST');
  expect(call.init.headers['content-type']).toBe('application/x-www-form-urlencoded');
  const body = new URLSearchParams(call.init.body);
  expect(body.get('secret')).toBe(SECRET);
  expect(body.get('response')).toBe('the-token');
  // `remoteip` IS DELIBERATELY ABSENT and this asserts the ruling rather than
  // an omission. `server.ts` sets no `trustProxy`, so `request.ip` is the
  // immediate peer rather than the address that solved the challenge, and
  // sending it would agree with itself in every test and disagree with the
  // solve on every real request.
  expect(body.has('remoteip')).toBe(false);
});

test('a token holding form delimiters cannot rewrite the body', async () => {
  // The injection this shape forecloses: a caller-supplied `response` that
  // carries `&secret=` would, under naive string concatenation, submit a secret
  // of the attacker's choosing. `URLSearchParams` percent-encodes both members.
  const hostile = 'x&secret=attacker-choice&response=y';
  const { fetchImpl, calls } = answering({ success: true });
  await cloudflareTurnstileVerifier(CONFIGURED, fetchImpl).verify(hostile);
  const call = calls[0];
  if (call === undefined) throw new Error('unreachable: one call was made');
  const body = new URLSearchParams(call.init.body);
  expect(body.get('secret')).toBe(SECRET);
  expect(body.get('response')).toBe(hostile);
  expect(body.getAll('secret')).toHaveLength(1);
});

test('the call carries a deadline, and the deadline is not already spent', async () => {
  // The defect this catches is the `signal` line being deleted, which leaves an
  // outbound call on the sign-in path with no deadline this code chose.
  const { fetchImpl, calls } = answering({ success: true });
  await cloudflareTurnstileVerifier(CONFIGURED, fetchImpl).verify('t');
  const call = calls[0];
  if (call === undefined) throw new Error('unreachable: one call was made');
  expect(call.init.signal).toBeInstanceOf(AbortSignal);
  expect(call.init.signal.aborted).toBe(false);
  expect(TURNSTILE_TIMEOUT_MS).toBeGreaterThan(0);
  expect(Number.isFinite(TURNSTILE_TIMEOUT_MS)).toBe(true);
});

test('a siteverify that never answers is `unavailable` when the deadline passes', async () => {
  // The deadline is exercised rather than described: this `fetch` resolves only
  // if the signal fires, so a verifier that set no signal would hang this test
  // rather than fail it, and a verifier that fails open would return `passed`.
  const hangs: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        reject(new Error('aborted by the deadline'));
      });
    });
  const outcome = await cloudflareTurnstileVerifier(CONFIGURED, hangs, 20).verify('t');
  expect(outcome.outcome).toBe('unavailable');
});

// -----------------------------------------------------------------------------
// Reading the answer. Total, and it fails closed in every direction
// -----------------------------------------------------------------------------

test('`success: true` is the one outcome that admits', async () => {
  const { fetchImpl } = answering({ success: true });
  expect((await cloudflareTurnstileVerifier(CONFIGURED, fetchImpl).verify('t')).outcome).toBe(
    'passed',
  );
});

test('`success: false` is `failed`, and the vendor codes ride in the detail for the log', async () => {
  const { fetchImpl } = answering({
    success: false,
    'error-codes': ['invalid-input-response', 'timeout-or-duplicate'],
  });
  const outcome = await cloudflareTurnstileVerifier(CONFIGURED, fetchImpl).verify('t');
  expect(outcome.outcome).toBe('failed');
  if (outcome.outcome !== 'failed') throw new Error('unreachable: asserted above');
  expect(outcome.detail).toContain('invalid-input-response');
  expect(outcome.detail).toContain('timeout-or-duplicate');
  // THE SECRET NEVER REACHES A DETAIL. Details are logged, and a log line
  // carrying the key would be the credential leaving the vault by accident.
  expect(outcome.detail).not.toContain(SECRET);
});

test('`error-codes` in any shape renders rather than throwing', async () => {
  // A verification must not fail on the shape of its own explanation. Absent,
  // empty, and holding non-strings all have to render.
  for (const codes of [undefined, [], [7, null], 'not-an-array']) {
    const { fetchImpl } = answering({ success: false, 'error-codes': codes });
    const outcome = await cloudflareTurnstileVerifier(CONFIGURED, fetchImpl).verify('t');
    expect(outcome.outcome).toBe('failed');
  }
});

test('a `success` that is not boolean is `unavailable` and never `failed`', async () => {
  // The distinction is what the caller is told to do. `failed` says solve the
  // challenge again; a client that cannot parse Cloudflare has no challenge to
  // re-solve, and 503 says retry. Both refuse.
  for (const success of [undefined, 'true', 1, null]) {
    const { fetchImpl } = answering({ success });
    const outcome = await cloudflareTurnstileVerifier(CONFIGURED, fetchImpl).verify('t');
    expect(outcome.outcome).toBe('unavailable');
  }
});

test('an answer that is not a JSON object is `unavailable`', async () => {
  for (const payload of [null, 'ok', 42, ['success']]) {
    const { fetchImpl } = answering(payload);
    const outcome = await cloudflareTurnstileVerifier(CONFIGURED, fetchImpl).verify('t');
    expect(outcome.outcome).toBe('unavailable');
  }
});

test('a non-2xx answer is `unavailable` and names the status for the log', async () => {
  const { fetchImpl } = answering({ success: true }, { ok: false, status: 502 });
  const outcome = await cloudflareTurnstileVerifier(CONFIGURED, fetchImpl).verify('t');
  expect(outcome.outcome).toBe('unavailable');
  if (outcome.outcome !== 'unavailable') throw new Error('unreachable: asserted above');
  expect(outcome.detail).toContain('502');
  // A `200` body is present on that response and is deliberately not read: a
  // status Cloudflare did not intend as an answer is not an answer.
});

test('a transport failure is `unavailable`, and `verify` resolves rather than throwing', async () => {
  // NOTHING HERE MAY THROW. `endpointHandler` catches only `AuthBackendUnwired`,
  // so a rejection would reach Fastify's error handler as a 500 and a control's
  // refusal would arrive as a bug.
  const throws: FetchLike = () => {
    throw new Error('ECONNRESET');
  };
  const rejects: FetchLike = () => Promise.reject(new Error('EAI_AGAIN'));
  for (const impl of [throws, rejects]) {
    const outcome = await cloudflareTurnstileVerifier(CONFIGURED, impl).verify('t');
    expect(outcome.outcome).toBe('unavailable');
  }
});

test('a body that will not parse is `unavailable`', async () => {
  const badJson: FetchLike = () =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error('Unexpected token < in JSON')),
    });
  const outcome = await cloudflareTurnstileVerifier(CONFIGURED, badJson).verify('t');
  expect(outcome.outcome).toBe('unavailable');
});

test('no failure mode of any kind returns `passed`', async () => {
  // The single property the whole ruling rests on, asserted across every way
  // this function can fail at once. A future arm that forgets to refuse is
  // caught here as well as in its own case.
  const impls: FetchLike[] = [
    () => Promise.reject(new Error('down')),
    () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }),
    () => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error('x')) }),
    () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve('nope') }),
    () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
    () =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: false }) }),
  ];
  for (const impl of impls) {
    const outcome = await cloudflareTurnstileVerifier(CONFIGURED, impl).verify('t');
    expect(outcome.outcome).not.toBe('passed');
  }
  // And with no secret, over every one of them.
  for (const impl of impls) {
    const outcome = await cloudflareTurnstileVerifier({}, impl).verify('t');
    expect(outcome.outcome).toBe('unconfigured');
  }
});
