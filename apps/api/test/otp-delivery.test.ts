import { expect, test } from 'vitest';

import {
  OTP_DELIVERY_TIMEOUT_MS,
  OTP_EMAIL_FROM_VAR,
  OTP_EMAIL_SUBJECT,
  OTP_EMAIL_TOKEN_VAR,
  OTP_SMS_PRICE_CENTS_VAR,
  POSTMARK_SEND_URL,
  POSTMARK_TOKEN_HEADER,
  otpEmailBody,
  postmarkOtpSender,
  resolveOtpSmsPriceCents,
} from '../src/otp-delivery.ts';
import type { FetchLike, OtpMessage } from '../src/otp-delivery.ts';

// CI-02, the `unit` project.
//
// ADR-229. THE SENDER, EXERCISED THROUGH ITS OWN `fetch` RATHER THAN AROUND IT,
// on `turnstile.test.ts`'s standard one file over. Every case below drives
// `postmarkOtpSender`'s real body: the request it builds, the deadline it sets,
// and its total reading of an answer it does not control. The injected `fetch`
// stands in for the socket and for nothing else.
//
// NO TOKEN, NO SENDER ADDRESS AND NO VENDOR CALL (ADR-012). The values below are
// fixture strings on `example.test`, which RFC 6761 reserves and which resolves
// nowhere. THE POINT OF THE INJECTED `fetch` IS THAT A SUITE THAT COULD REACH A
// VENDOR IS A SUITE THAT CAN SPEND MONEY, and the one case that does not inject
// one is the `unconfigured` case, which is the case that proves no call is made.

/** A fixture value. Not a credential and not one anywhere. */
const TOKEN = 'fixture-server-token-not-a-credential';
const FROM = 'no-reply@example.test';

const CONFIGURED = { [OTP_EMAIL_TOKEN_VAR]: TOKEN, [OTP_EMAIL_FROM_VAR]: FROM };

const MESSAGE: OtpMessage = {
  channel: 'email',
  destination: 'trader@example.test',
  code: '048213',
  expiresInSeconds: 600,
};

type Call = { url: string; init: Parameters<FetchLike>[1] };

/** A `fetch` that answers one JSON body and records what it was handed. */
function answering(
  payload: unknown,
  options: { ok?: boolean; status?: number } = {},
): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
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

/** A `fetch` nothing may call. The negative control on every refusal-before-I/O case. */
const NEVER_CALLED: FetchLike = () => {
  throw new Error('the sender reached the network on a call that must refuse before it');
};

/** The parsed body of one recorded call. */
function bodyOf(call: Call): Record<string, unknown> {
  return JSON.parse(call.init.body) as Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// Configuration: an absent credential REFUSES and never sends
// -----------------------------------------------------------------------------

test('no server token is `unconfigured`, and the vendor is never reached', async () => {
  // THE ARM THAT MATTERS MOST, and it is ADR-226's ruling arriving on the send
  // instead of on the check: an absent secret must not be the way a capability
  // switches itself off. The `fetch` here throws if it is called at all, so this
  // asserts BOTH that the outcome refuses and that no message was handed to
  // anybody. The default `env` is deliberately not used: an empty object is a
  // deployment holding nothing.
  const sender = postmarkOtpSender({ [OTP_EMAIL_FROM_VAR]: FROM }, NEVER_CALLED);
  const outcome = await sender.send(MESSAGE);
  expect(outcome.outcome).toBe('unconfigured');
  expect(outcome.outcome === 'unconfigured' && outcome.detail).toContain(OTP_EMAIL_TOKEN_VAR);
});

test('a blank server token is the same refusal as an absent one', async () => {
  // A VARIABLE SET TO WHITESPACE IS THE SHAPE A DEPLOYMENT PRODUCES BY ACCIDENT,
  // and a truthiness test would take it as a credential and send the vendor an
  // empty token. `resolveOtpMacKeys` and `cloudflareTurnstileVerifier` both trim
  // for this reason and this is the third.
  const sender = postmarkOtpSender(
    { [OTP_EMAIL_TOKEN_VAR]: '   ', [OTP_EMAIL_FROM_VAR]: FROM },
    NEVER_CALLED,
  );
  expect((await sender.send(MESSAGE)).outcome).toBe('unconfigured');
});

test('no sender address is `unconfigured`, and the vendor is never reached', async () => {
  // THE SECOND HALF OF THE CONFIGURATION AND IT IS NOT A CREDENTIAL, which is
  // why it is asserted separately: a token with no `From` is a deployment that
  // would build a message the vendor refuses, and refusing here costs no call.
  const sender = postmarkOtpSender({ [OTP_EMAIL_TOKEN_VAR]: TOKEN }, NEVER_CALLED);
  const outcome = await sender.send(MESSAGE);
  expect(outcome.outcome).toBe('unconfigured');
  expect(outcome.outcome === 'unconfigured' && outcome.detail).toContain(OTP_EMAIL_FROM_VAR);
});

test('a message addressed to nobody is refused before the vendor is asked', async () => {
  const sender = postmarkOtpSender(CONFIGURED, NEVER_CALLED);
  const outcome = await sender.send({ ...MESSAGE, destination: '  ' });
  expect(outcome.outcome).toBe('rejected');
});

// -----------------------------------------------------------------------------
// The `sms` arm, which refuses on both of the things it is owed
// -----------------------------------------------------------------------------

test('the sms channel refuses, and the refusal names the vendor AND the price', async () => {
  // THE SECOND HALF OF THE OLD `NO_DELIVERY` LIVES HERE. A refusal that named
  // only the missing vendor would let a later session take one and believe the
  // branch was then wired, when a send it cannot charge against
  // `otp_send_budget.spend_cents` is a cost breaker counting every message as
  // free. So the outcome is asserted to carry both facts and not the first one
  // somebody notices.
  const sender = postmarkOtpSender(CONFIGURED, NEVER_CALLED);
  const outcome = await sender.send({ ...MESSAGE, channel: 'sms', destination: '+15555550123' });
  expect(outcome.outcome).toBe('unconfigured');
  const detail = outcome.outcome === 'unconfigured' ? outcome.detail : '';
  expect(detail).toContain('sends no SMS');
  expect(detail).toContain(OTP_SMS_PRICE_CENTS_VAR);
});

test('a configured price does not make the sms channel sendable', async () => {
  // THE PRICE IS NECESSARY AND NOT SUFFICIENT, asserted rather than argued. A
  // deployment that sets the price still has no SMS vendor, and the refusal says
  // which half it now holds so an operator reading the log is not left guessing
  // whether their own variable took effect.
  const sender = postmarkOtpSender({ ...CONFIGURED, [OTP_SMS_PRICE_CENTS_VAR]: '1' }, NEVER_CALLED);
  const outcome = await sender.send({ ...MESSAGE, channel: 'sms', destination: '+15555550123' });
  expect(outcome.outcome).toBe('unconfigured');
  expect(outcome.outcome === 'unconfigured' && outcome.detail).toContain('a price is configured');
});

// -----------------------------------------------------------------------------
// The price, which is money and is therefore integer cents or nothing
// -----------------------------------------------------------------------------

test('an absent price is a refusal and never a zero', () => {
  // A ZERO WOULD BE A COST BREAKER THAT NEVER TRIPS. Both spellings of absence
  // are asserted because a deployment produces both.
  expect(resolveOtpSmsPriceCents({})).toHaveProperty('refusal');
  expect(resolveOtpSmsPriceCents({ [OTP_SMS_PRICE_CENTS_VAR]: '' })).toHaveProperty('refusal');
  expect(resolveOtpSmsPriceCents({ [OTP_SMS_PRICE_CENTS_VAR]: '  ' })).toHaveProperty('refusal');
});

test('a fractional price is REFUSED rather than rounded, in either direction', () => {
  // THE CASE THAT IS THE WHOLE RULING. `0.79` is what a vendor's own table
  // quotes and it is not a value `otp_send_budget.spend_cents` can hold. A
  // parser that took it silently would truncate to zero and disarm the breaker,
  // and a parser that rounded it would be taking a decision about money on
  // whoever set the variable's behalf. `Number('0.79')` succeeds, which is
  // exactly why the SHAPE is refused before the number is read.
  for (const value of ['0.79', '.5', '1.0', '1e2', '0x10', '12abc', '-1', '+1', '1_000'])
    expect(resolveOtpSmsPriceCents({ [OTP_SMS_PRICE_CENTS_VAR]: value }), value).toHaveProperty(
      'refusal',
    );

  // SURROUNDING WHITESPACE IS TRIMMED AND IS NOT A REFUSAL, and the difference
  // is stated rather than left to be discovered: whitespace is how a vault
  // renders a value and says nothing about the number, where a decimal point is
  // the number itself being one this column cannot hold.
  expect(resolveOtpSmsPriceCents({ [OTP_SMS_PRICE_CENTS_VAR]: ' 12 ' })).toEqual({ cents: 12 });
});

test('a zero price is refused, and one cent is admitted', () => {
  expect(resolveOtpSmsPriceCents({ [OTP_SMS_PRICE_CENTS_VAR]: '0' })).toHaveProperty('refusal');
  expect(resolveOtpSmsPriceCents({ [OTP_SMS_PRICE_CENTS_VAR]: '000' })).toHaveProperty('refusal');
  expect(resolveOtpSmsPriceCents({ [OTP_SMS_PRICE_CENTS_VAR]: '1' })).toEqual({ cents: 1 });
  expect(resolveOtpSmsPriceCents({ [OTP_SMS_PRICE_CENTS_VAR]: '0007' })).toEqual({ cents: 7 });
});

test('a price past the safe-integer boundary is refused rather than accumulated', () => {
  // A BUDGET THAT STOPS COUNTING IS A BUDGET THAT NEVER TRIPS. `spend_cents` is
  // `bigint` in the database and a `number` here, so the refusal is about what
  // this process can add up rather than about what the column can store.
  const past = String(Number.MAX_SAFE_INTEGER) + '0';
  expect(resolveOtpSmsPriceCents({ [OTP_SMS_PRICE_CENTS_VAR]: past })).toHaveProperty('refusal');
});

// -----------------------------------------------------------------------------
// The request this file builds
// -----------------------------------------------------------------------------

test('the request is the vendor call this file claims, and it carries the deadline', async () => {
  const { fetchImpl, calls } = answering({ ErrorCode: 0, MessageID: 'msg-1' });
  const sender = postmarkOtpSender(CONFIGURED, fetchImpl);
  const outcome = await sender.send(MESSAGE);

  expect(outcome).toEqual({ outcome: 'sent', reference: 'msg-1' });
  expect(calls).toHaveLength(1);
  const call = calls[0]!;
  expect(call.url).toBe(POSTMARK_SEND_URL);
  expect(call.init.method).toBe('POST');
  expect(call.init.headers[POSTMARK_TOKEN_HEADER]).toBe(TOKEN);
  expect(call.init.headers['content-type']).toBe('application/json');
  // THE DEADLINE IS ASSERTED AS A SIGNAL AND NOT AS A NUMBER, because what
  // matters is that one is attached at all: without it a vendor that accepts a
  // connection and never answers holds a socket for as long as the runtime
  // allows, once per sign-in attempt.
  expect(call.init.signal).toBeInstanceOf(AbortSignal);
  expect(OTP_DELIVERY_TIMEOUT_MS).toBeGreaterThan(0);

  const body = bodyOf(call);
  expect(body['From']).toBe(FROM);
  expect(body['To']).toBe(MESSAGE.destination);
  expect(body['Subject']).toBe(OTP_EMAIL_SUBJECT);
  expect(String(body['TextBody'])).toContain(MESSAGE.code);
});

test('the token is a header and never a member of the body', async () => {
  // A CREDENTIAL IN A BODY IS A CREDENTIAL IN A VENDOR'S REQUEST LOG. The
  // assertion is over the serialized body rather than over the members, so a
  // later edit that nests it anywhere is caught.
  const { fetchImpl, calls } = answering({ ErrorCode: 0, MessageID: 'm' });
  await postmarkOtpSender(CONFIGURED, fetchImpl).send(MESSAGE);
  expect(calls[0]!.init.body).not.toContain(TOKEN);
});

test('the body says the code and how long it lives, and offers no link', () => {
  // NO LINK, DELIBERATELY: a one-click sign-in is a second authentication path
  // with its own replay and forwarding properties, and `POST /auth/verify` is
  // the one door API_CONTRACT declares.
  const body = otpEmailBody(MESSAGE);
  expect(body).toContain('048213');
  expect(body).toContain('10 minutes');
  expect(body).not.toContain('http');
  // Singular where the number is one, which is copy a person reads.
  expect(otpEmailBody({ ...MESSAGE, expiresInSeconds: 60 })).toContain('1 minute and');
});

// -----------------------------------------------------------------------------
// The answer this file does not control
// -----------------------------------------------------------------------------

test('a transport failure is `unavailable`, and it is not retried', async () => {
  // NO RETRY IS A STRONGER RULE HERE THAN IT IS FOR TURNSTILE, and this is the
  // case that holds it: a repeated SEND is a second billed message and a second
  // copy of a live code in a person's inbox, and a call that timed out may well
  // have been accepted. One call, and the count is what asserts it.
  let calls = 0;
  const fetchImpl: FetchLike = () => {
    calls += 1;
    return Promise.reject(new Error('socket hang up'));
  };
  const outcome = await postmarkOtpSender(CONFIGURED, fetchImpl).send(MESSAGE);
  expect(outcome.outcome).toBe('unavailable');
  expect(calls).toBe(1);
});

test('a body that is not JSON is `unavailable` and never a send', async () => {
  const fetchImpl: FetchLike = () =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error('Unexpected token < in JSON')),
    });
  expect((await postmarkOtpSender(CONFIGURED, fetchImpl).send(MESSAGE)).outcome).toBe(
    'unavailable',
  );
});

test('a JSON answer that is not an object is `unavailable`', async () => {
  // TOTAL OVER A SHAPE THIS FILE DOES NOT CONTROL. An array and a bare string
  // both parse and neither carries an `ErrorCode`, so a member lookup on them
  // would read `undefined` and the arm below must not be reached by accident.
  for (const payload of [[1, 2], 'OK', null, 42]) {
    const { fetchImpl } = answering(payload);
    expect(
      (await postmarkOtpSender(CONFIGURED, fetchImpl).send(MESSAGE)).outcome,
      JSON.stringify(payload),
    ).toBe('unavailable');
  }
});

test('a 5xx is `unavailable` and a 4xx is `rejected`, and neither is a send', async () => {
  // THE SPLIT IS FOR THE LOG AND BOTH ARMS REFUSE, which is what makes a
  // mis-classification cost a log line rather than a delivery Merit believes in.
  const server = answering({ ErrorCode: 100, Message: 'Internal' }, { ok: false, status: 503 });
  expect((await postmarkOtpSender(CONFIGURED, server.fetchImpl).send(MESSAGE)).outcome).toBe(
    'unavailable',
  );

  const refused = answering(
    {
      ErrorCode: 406,
      Message: 'You tried to send to a recipient that has been marked as inactive',
    },
    { ok: false, status: 422 },
  );
  const outcome = await postmarkOtpSender(CONFIGURED, refused.fetchImpl).send(MESSAGE);
  expect(outcome.outcome).toBe('rejected');
  // THE VENDOR'S OWN WORDS REACH THE LOG AND ARE NEVER BRANCHED ON, which is
  // ADR-226's ruling transcribed: a transcribed vendor vocabulary that is wrong
  // is wrong in the direction of claiming a send that did not happen.
  expect(outcome.outcome === 'rejected' && outcome.detail).toContain('marked as inactive');
});

test('a 200 carrying a non-zero ErrorCode is NOT a send', async () => {
  // THE CASE A STATUS-ONLY READING GETS WRONG. The vendor reports a per-message
  // result in the body, and a sender that answered on `response.ok` alone would
  // tell a trader a code is on its way that the vendor declined to take.
  const { fetchImpl } = answering({ ErrorCode: 300, Message: 'Invalid email request' });
  const outcome = await postmarkOtpSender(CONFIGURED, fetchImpl).send(MESSAGE);
  expect(outcome.outcome).toBe('rejected');
  expect(outcome.outcome === 'rejected' && outcome.detail).toContain('300');
});

test('a missing ErrorCode is not read as a zero', async () => {
  // `undefined !== 0`, and the assertion is here so that a later edit reaching
  // for a truthiness test or a `??  0` is a red case rather than a silent
  // widening of what counts as accepted.
  const { fetchImpl } = answering({ MessageID: 'm' });
  expect((await postmarkOtpSender(CONFIGURED, fetchImpl).send(MESSAGE)).outcome).toBe('rejected');
});

test('a send with no MessageID still sends, and says the reference is missing', async () => {
  // A VERIFICATION MUST NOT FAIL ON THE SHAPE OF ITS OWN EXPLANATION, and a
  // delivery must not fail on the shape of its own receipt. The message was
  // accepted; what is missing is the handle an operator would quote.
  const { fetchImpl } = answering({ ErrorCode: 0 });
  expect(await postmarkOtpSender(CONFIGURED, fetchImpl).send(MESSAGE)).toEqual({
    outcome: 'sent',
    reference: 'none reported',
  });
});

test('the configuration is read per send, so a rotation needs no restart', async () => {
  // ON `resolveOtpMacKeys`' REASON: a value captured at import is a value a
  // rotation cannot reach. The environment object is mutated between two sends
  // through ONE sender, which is the shape a vault rotation produces.
  const env: Record<string, string | undefined> = { [OTP_EMAIL_FROM_VAR]: FROM };
  const { fetchImpl, calls } = answering({ ErrorCode: 0, MessageID: 'm' });
  const sender = postmarkOtpSender(env, fetchImpl);

  expect((await sender.send(MESSAGE)).outcome).toBe('unconfigured');
  env[OTP_EMAIL_TOKEN_VAR] = TOKEN;
  expect((await sender.send(MESSAGE)).outcome).toBe('sent');
  expect(calls).toHaveLength(1);
});
