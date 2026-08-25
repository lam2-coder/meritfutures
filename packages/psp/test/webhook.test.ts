// =============================================================================
// packages/psp/test/webhook.test.ts
// =============================================================================
// THE ORDERING SUITE. API_CONTRACT section 10 states one rule in capitals --
// "HMAC signature verified BEFORE parsing" -- and this file is written against
// the direction that rule fails from rather than the direction it succeeds in.
//
// THE CASE THAT MATTERS MOST IS `a re-serialised body is refused`. It is the
// clause ADR-103 asks the founder to execute, and it is the one a reader is
// most likely to assume is impossible: the JSON is EQUAL, `deepEqual` passes on
// it, and the digest still refuses, because a MAC is over bytes and not over
// meaning. A handler that parsed first and re-encoded would have destroyed the
// evidence before the verifier ever saw it.
//
// EVERY SIGNATURE HERE IS PRODUCED BY THE FAKE'S OWN `signWebhook` and never by
// this file recomputing what the implementation would compute, which is
// ADR-084 section 7's lesson: an expectation taken from the code under test is
// an assertion about nothing.
// =============================================================================

import { createHmac } from 'node:crypto';

import { describe, expect, test } from 'vitest';

import { WebhookVerificationError, type WebhookRefusal } from '../src/port.ts';
import { WEBHOOK_WINDOW_SECONDS, singleHeader, utf8 } from '../src/webhook.ts';
import { PSP_A_SIGNATURE_HEADER, createPspAFake } from '../src/fakes/psp-a.ts';
import { PSP_B_NONCE_HEADER, createPspBFake } from '../src/fakes/psp-b.ts';

// LOW ENTROPY AND NO VENDOR PREFIX, AND VG-1 IS WHY.
//
// These two were a real provider's webhook-secret prefix followed by sixteen
// hex characters, until CI-05 refused them: `gitleaks git .` reported two
// `generic-api-key` findings at **entropy 4.28**, on this file, at these two
// lines. **The gate was right.** That is a credential BY SHAPE, and VG-1 exists
// to catch the shape wherever it appears, which includes a fixture written by
// somebody trying to look realistic.
//
// **The remedy is the VALUE and never an allowlist.** A `.gitleaks.toml`
// exempting this path would be weakening a gate to pass it, and it would exempt
// the path permanently rather than this string once. What is here now is
// self-evidently a fixture and carries no key material, which is what a shared
// secret in a test should have looked like in the first place.
//
// **The old literal is not quoted here, deliberately.** A comment that spells
// the flagged string puts it back in the file the scan reads, which is the same
// defect one indirection along.
const SECRET_A = 'psp-a-test-secret';
const SECRET_B = 'psp-b-test-secret';

/** A fixed instant. Nothing in this package reads a clock it was not handed. */
const T0 = new Date('2026-08-25T14:00:00.000Z');
const clock = () => T0;

const pspA = () => createPspAFake({ secret: SECRET_A, clock });
const pspB = () => createPspBFake({ secret: SECRET_B, clock });

/** Read the refusal off a rejection, failing loudly if it is another error. */
async function refusalOf(promise: Promise<unknown>): Promise<WebhookRefusal> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(WebhookVerificationError);
    return (error as WebhookVerificationError).refusal;
  }
  expect.unreachable('verifyWebhook must throw, never return an unverified event');
}

describe('the happy path exists, so the refusals below are not vacuous', () => {
  test('psp_a verifies its own signed webhook', async () => {
    const adapter = pspA();
    const { raw, headers } = adapter.signWebhook({
      eventId: 'evt_a_1',
      eventType: 'purchase.paid',
      data: { purchase_id: 'p-1' },
    });
    const event = await adapter.verifyWebhook(raw, headers);
    expect(event.psp).toBe('psp_a');
    expect(event.providerEventId).toBe('evt_a_1');
    expect(event.eventType).toBe('purchase.paid');
    expect(event.payload['data']).toEqual({ purchase_id: 'p-1' });
    // NO NONCE CHANNEL: the replay anchor is the event id, and it is covered by
    // the signature because the signature spans the body it was read out of.
    expect(event.nonce).toBe('evt_a_1');
    expect(event.raw).toEqual(raw);
  });

  test('psp_b verifies its own signed webhook and carries its header nonce', async () => {
    const adapter = pspB();
    const { raw, headers } = adapter.signWebhook({
      eventId: 'evt_b_1',
      eventType: 'purchase.charged_back',
      payload: { purchase_id: 'p-2' },
      nonce: 'n-abc',
    });
    const event = await adapter.verifyWebhook(raw, headers);
    expect(event.psp).toBe('psp_b');
    expect(event.providerEventId).toBe('evt_b_1');
    expect(event.eventType).toBe('purchase.charged_back');
    expect(event.nonce).toBe('n-abc');
  });
});

describe('THE CLAUSE: a body re-serialised before verification is refused', () => {
  test('psp_a refuses bytes that parse to an EQUAL object', async () => {
    const adapter = pspA();
    const { raw, headers } = adapter.signWebhook({
      eventId: 'evt_a_2',
      eventType: 'purchase.paid',
      // Two keys, so a re-serialisation has somewhere to differ even before
      // whitespace: `JSON.stringify(JSON.parse(x))` preserves insertion order,
      // so the difference below is the INDENTATION a middleware adds.
      data: { purchase_id: 'p-3', amount_cents: 3900 },
    });

    const roundTripped = utf8(JSON.stringify(JSON.parse(new TextDecoder().decode(raw)), null, 2));
    // The two bodies are the same JSON and different bytes. Both halves stated,
    // because the assertion is worthless without the first one.
    expect(JSON.parse(new TextDecoder().decode(roundTripped))).toEqual(
      JSON.parse(new TextDecoder().decode(raw)),
    );
    expect(roundTripped).not.toEqual(raw);

    expect(await refusalOf(adapter.verifyWebhook(roundTripped, headers))).toBe(
      'signature_mismatch',
    );
  });

  test('psp_b refuses the same round trip, under a different scheme entirely', async () => {
    const adapter = pspB();
    const { raw, headers } = adapter.signWebhook({
      eventId: 'evt_b_2',
      eventType: 'purchase.refunded',
      payload: { purchase_id: 'p-4', amount_cents: 9900 },
    });
    const roundTripped = utf8(JSON.stringify(JSON.parse(new TextDecoder().decode(raw)), null, 2));
    expect(await refusalOf(adapter.verifyWebhook(roundTripped, headers))).toBe(
      'signature_mismatch',
    );
  });

  test('a single flipped byte in the body is refused', async () => {
    const adapter = pspA();
    const { raw, headers } = adapter.signWebhook({
      eventId: 'evt_a_3',
      eventType: 'purchase.paid',
      data: { purchase_id: 'p-5' },
    });
    const tampered = new Uint8Array(raw);
    const last = tampered.length - 1;
    tampered[last] = (tampered[last] ?? 0) ^ 0x01;
    expect(await refusalOf(adapter.verifyWebhook(tampered, headers))).toBe('signature_mismatch');
  });

  test('a signature minted with the WRONG SECRET is refused', async () => {
    const attacker = createPspAFake({ secret: 'not-the-secret', clock });
    const merit = pspA();
    const { raw, headers } = attacker.signWebhook({
      eventId: 'evt_a_4',
      eventType: 'purchase.paid',
      data: { purchase_id: 'p-6' },
    });
    expect(await refusalOf(merit.verifyWebhook(raw, headers))).toBe('signature_mismatch');
  });
});

describe('the freshness window, in BOTH directions', () => {
  test('psp_a accepts a timestamp at the edge of the window', async () => {
    const adapter = pspA();
    const t = Math.floor(T0.getTime() / 1000) - WEBHOOK_WINDOW_SECONDS;
    const { raw, headers } = adapter.signWebhook({
      eventId: 'evt_a_5',
      eventType: 'purchase.paid',
      data: {},
      timestampEpochSeconds: t,
    });
    await expect(adapter.verifyWebhook(raw, headers)).resolves.toMatchObject({
      providerEventId: 'evt_a_5',
    });
  });

  test('psp_a refuses one second past the window', async () => {
    const adapter = pspA();
    const t = Math.floor(T0.getTime() / 1000) - WEBHOOK_WINDOW_SECONDS - 1;
    const { raw, headers } = adapter.signWebhook({
      eventId: 'evt_a_6',
      eventType: 'purchase.paid',
      data: {},
      timestampEpochSeconds: t,
    });
    expect(await refusalOf(adapter.verifyWebhook(raw, headers))).toBe('timestamp_outside_window');
  });

  test('psp_b refuses a FUTURE timestamp, which is the capture that never expires', async () => {
    const adapter = pspB();
    const t = Math.floor(T0.getTime() / 1000) + WEBHOOK_WINDOW_SECONDS + 1;
    const { raw, headers } = adapter.signWebhook({
      eventId: 'evt_b_3',
      eventType: 'purchase.paid',
      payload: {},
      timestampEpochSeconds: t,
    });
    expect(await refusalOf(adapter.verifyWebhook(raw, headers))).toBe('timestamp_outside_window');
  });

  test('THE ORDER: a stale timestamp with a BAD signature reports the signature', async () => {
    // The digest runs first, so an unauthenticated party cannot choose which
    // branch of the verifier executes by editing the timestamp bytes.
    const adapter = pspA();
    const t = Math.floor(T0.getTime() / 1000) - 10_000;
    expect(
      await refusalOf(
        adapter.verifyWebhook(utf8('{"id":"x","type":"y"}'), {
          [PSP_A_SIGNATURE_HEADER]: `t=${t},v1=${'00'.repeat(32)}`,
        }),
      ),
    ).toBe('signature_mismatch');
  });
});

describe('header handling, where a tolerant parser is the vulnerability', () => {
  test('a REPEATED signature header is refused rather than resolved to [0]', async () => {
    const adapter = pspA();
    const { raw, headers } = adapter.signWebhook({
      eventId: 'evt_a_7',
      eventType: 'purchase.paid',
      data: {},
    });
    const good = headers[PSP_A_SIGNATURE_HEADER] ?? '';
    // A Node HTTP server collects repeats into an array. Taking the valid one
    // out of it is how a proxy and an origin disagree about what was checked.
    expect(
      await refusalOf(
        adapter.verifyWebhook(raw, {
          [PSP_A_SIGNATURE_HEADER]: [good, `t=0,v1=${'ff'.repeat(32)}`],
        }),
      ),
    ).toBe('signature_header_repeated');
  });

  test('a repeated header is refused EVEN WHEN the first value is the valid one', async () => {
    // WRITTEN BECAUSE A MUTATION SURVIVED IN THE OTHER DIRECTION. The case
    // above seeds [good, bad]; a `found[0]` implementation refuses that one for
    // the wrong reason only if the refusal is checked, so this seeds [bad, good]
    // too. Either resolution order is a proxy and an origin disagreeing about
    // what was checked.
    const adapter = pspA();
    const { raw, headers } = adapter.signWebhook({
      eventId: 'evt_a_8',
      eventType: 'purchase.paid',
      data: {},
    });
    const good = headers[PSP_A_SIGNATURE_HEADER] ?? '';
    const bad = `t=0,v1=${'ff'.repeat(32)}`;
    for (const pair of [
      [good, bad],
      [bad, good],
    ]) {
      expect(await refusalOf(adapter.verifyWebhook(raw, { [PSP_A_SIGNATURE_HEADER]: pair }))).toBe(
        'signature_header_repeated',
      );
    }
  });

  test('a missing signature header is its own refusal', async () => {
    const adapter = pspA();
    expect(await refusalOf(adapter.verifyWebhook(utf8('{}'), {}))).toBe('signature_header_missing');
  });

  test('psp_b names WHICH of its three headers is missing', async () => {
    const adapter = pspB();
    const { raw, headers } = adapter.signWebhook({
      eventId: 'evt_b_4',
      eventType: 'purchase.paid',
      payload: {},
    });
    const withoutNonce = { ...headers };
    delete (withoutNonce as Record<string, string>)[PSP_B_NONCE_HEADER];
    expect(await refusalOf(adapter.verifyWebhook(raw, withoutNonce))).toBe(
      'signature_header_missing',
    );
  });

  test('header lookup is case-insensitive, because HTTP is', () => {
    expect(
      singleHeader({ 'PSP-A-Signature': 'v' }, PSP_A_SIGNATURE_HEADER, 'psp_a', utf8('')),
    ).toBe('v');
  });

  test('a malformed compound header is refused, not partially read', async () => {
    const adapter = pspA();
    const cases = ['', 't=1', `v1=${'aa'.repeat(32)}`, 'nonsense', 't=1,t=2', 't=abc,v1=aa'];
    for (const value of cases) {
      const refusal = await refusalOf(
        adapter.verifyWebhook(utf8('{"id":"x","type":"y"}'), { [PSP_A_SIGNATURE_HEADER]: value }),
      );
      expect(refusal, `header ${JSON.stringify(value)}`).toBe('signature_malformed');
    }
  });

  test('a VALID-HEX MAC of the wrong length is a mismatch, not a raw TypeError', async () => {
    // WRITTEN BECAUSE A MUTATION SURVIVED. Dropping the length guard in
    // `verifyHmacWebhook` left every case in this file green, because none of
    // them presented a well-formed MAC of the wrong size. `timingSafeEqual`
    // THROWS on a length mismatch rather than returning false, so without the
    // guard this path raises a bare TypeError: the route's catch block sees
    // something that is not a WebhookVerificationError, cannot tell it is a
    // signature refusal, and returns 500 where API_CONTRACT section 10 requires
    // 401 and a security event.
    const adapter = pspA();
    const refusal = await refusalOf(
      adapter.verifyWebhook(utf8('{"id":"x","type":"y"}'), {
        [PSP_A_SIGNATURE_HEADER]: 't=1,v1=aabb',
      }),
    );
    expect(refusal).toBe('signature_mismatch');
  });

  test('a non-hex v1 does not become a short MAC that gets compared', async () => {
    // `Buffer.from('zz', 'hex')` returns an EMPTY buffer rather than throwing,
    // so without the shape check this would have reached timingSafeEqual.
    const adapter = pspA();
    expect(
      await refusalOf(
        adapter.verifyWebhook(utf8('{"id":"x","type":"y"}'), {
          [PSP_A_SIGNATURE_HEADER]: 't=1,v1=zzzz',
        }),
      ),
    ).toBe('signature_malformed');
  });

  test('psp_b refuses a nonce carrying the delimiter its own digest uses', async () => {
    const adapter = pspB();
    const { raw, headers } = adapter.signWebhook({
      eventId: 'evt_b_5',
      eventType: 'purchase.paid',
      payload: {},
      nonce: 'a\nb',
    });
    expect(await refusalOf(adapter.verifyWebhook(raw, headers))).toBe('signature_malformed');
  });
});

describe('what a verified body must still carry', () => {
  test('a verified body that is not a JSON object is refused', async () => {
    const adapter = pspA();
    // Signed properly, so the refusal below is about the shape and not the MAC.
    const raw = utf8('[1,2,3]');
    const t = Math.floor(T0.getTime() / 1000);
    const { headers } = signRawWithPspA(raw, t);
    expect(await refusalOf(adapter.verifyWebhook(raw, headers))).toBe('payload_not_json_object');
  });

  test('a body that is INVALID UTF-8 is refused, even when replacement would parse', async () => {
    // WRITTEN BECAUSE A MUTATION SURVIVED. Flipping the decoder to
    // `fatal: false` left every case green, because the obvious invalid-UTF-8
    // body also fails `JSON.parse` and so refuses for the second reason
    // instead. The case that separates them is a body whose bytes are invalid
    // UTF-8 and which STILL PARSES once the replacement character is
    // substituted: under a tolerant decoder that event verifies, and
    // `event.payload` then holds a U+FFFD where `event.raw` holds 0xFF. Two
    // representations of one signed event disagreeing is the shape a dispute
    // is argued from, and the raw bytes are the ones the schema stores.
    const adapter = pspA();
    const prefix = utf8('{"id":"');
    const suffix = utf8('","type":"purchase.paid"}');
    const raw = new Uint8Array(prefix.length + 1 + suffix.length);
    raw.set(prefix, 0);
    raw[prefix.length] = 0xff; // a lone continuation byte: never valid UTF-8
    raw.set(suffix, prefix.length + 1);

    // The premise, stated rather than assumed: replacement WOULD yield valid JSON.
    const replaced = new TextDecoder('utf-8', { fatal: false }).decode(raw);
    expect(replaced).toContain('\uFFFD');
    expect(() => JSON.parse(replaced)).not.toThrow();

    const t = Math.floor(T0.getTime() / 1000);
    const { headers } = signRawWithPspA(raw, t);
    try {
      await adapter.verifyWebhook(raw, headers);
      expect.unreachable('a body that is not valid UTF-8 must be refused');
    } catch (error) {
      const e = error as WebhookVerificationError;
      expect(e.refusal).toBe('payload_not_json_object');
      expect(e.message).toContain('not valid UTF-8');
    }
  });

  test("a verified body naming no event id is refused, through the fake's OWN signer", () => {
    // No raw signing here: an empty `id` is reachable through `signWebhook`, so
    // this case runs the whole digest path and refuses on the identity alone.
    const adapter = pspA();
    const { raw, headers } = adapter.signWebhook({
      eventId: '',
      eventType: 'purchase.paid',
      data: {},
    });
    return refusalOf(adapter.verifyWebhook(raw, headers)).then((r) => {
      expect(r).toBe('event_identity_missing');
    });
  });

  test('the refusal carries the psp and the RAW BYTES, so the row can be written', async () => {
    // `psp_webhook_events.signature_verified` is `boolean NOT NULL` and
    // `processing_result` has `'rejected_signature'`. The catch block cannot
    // write that row unless the throw tells it what arrived.
    const adapter = pspA();
    const raw = utf8('{"id":"evt","type":"t"}');
    try {
      await adapter.verifyWebhook(raw, { [PSP_A_SIGNATURE_HEADER]: 't=1,v1=' + '00'.repeat(32) });
      expect.unreachable('must throw');
    } catch (error) {
      const e = error as WebhookVerificationError;
      expect(e).toBeInstanceOf(WebhookVerificationError);
      expect(e.psp).toBe('psp_a');
      expect(e.raw).toEqual(raw);
      expect(e.message).toContain('INV-M3-05');
    }
  });
});

/**
 * Sign arbitrary bytes the way `psp_a` does.
 *
 * ONE CASE ABOVE NEEDS A VALID SIGNATURE OVER A BODY THE FAKE WOULD NEVER
 * EMIT: `signWebhook` always serialises an object, so a top-level array cannot
 * be reached through it. This helper acts as the PROVIDER rather than as the
 * verifier, which is the side a test is allowed to reimplement, and the branch
 * it drives is the parse branch rather than the digest branch. That the digest
 * halves agree is proved by the two happy-path cases at the top of this file,
 * which use the fake's own signer and nothing else.
 */
function signRawWithPspA(raw: Uint8Array, t: number): { headers: Record<string, string> } {
  const prefix = utf8(`${t}.`);
  const joined = new Uint8Array(prefix.length + raw.length);
  joined.set(prefix, 0);
  joined.set(raw, prefix.length);
  const mac = createHmac('sha256', SECRET_A).update(joined).digest('hex');
  return { headers: { [PSP_A_SIGNATURE_HEADER]: `t=${t},v1=${mac}` } };
}
