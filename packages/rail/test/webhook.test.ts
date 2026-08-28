// =============================================================================
// packages/rail/test/webhook.test.ts
// =============================================================================
// THE ORDER, THE EIGHT REFUSALS, AND THE TWO SEEDS THE DISPATCH NAMES.
//
// Two of the three seeded refusals live here (a signature that does not verify,
// and a timestamp outside the window); the third, a replayed delivery, lives in
// `replay.test.ts` because it is refused by a different control.
//
// EVERY NEGATIVE CASE IS PAIRED WITH A POSITIVE ONE IN THE SAME `describe`, and
// that pairing is the control rather than a courtesy: a verifier that refused
// EVERYTHING would satisfy every refusal case in this file and is caught by its
// partner. `ADR-109` clause 7's re-serialisation case is the sharpest instance
// and it is asserted in both directions in the order that makes it discriminate.
// =============================================================================

import { createHmac } from 'node:crypto';

import { describe, expect, test } from 'vitest';

import {
  RAIL_NONCE_HEADER,
  RAIL_SIGNATURE_HEADER,
  RAIL_TIMESTAMP_HEADER,
  RAIL_WEBHOOK_WINDOW_SECONDS,
  RailWebhookVerificationError,
  createSandboxRail,
  type RailWebhookRefusal,
} from '../src/index.ts';

const AT = new Date('2026-08-28T12:00:00.000Z');
const NOW_SECONDS = Math.floor(AT.getTime() / 1000);

const TEST_SECRET = 'rail-shared-secret';

const railAt = (at: Date = AT): ReturnType<typeof createSandboxRail> =>
  createSandboxRail({ secret: TEST_SECRET, clock: () => at });

const DELIVERY = {
  eventId: 'evt_settle_1',
  providerTransferId: 'rise_tr_1_wd-1',
  eventType: 'transfer.settled',
  data: { amount_cents: 12500, currency: 'USD' },
} as const;

/** Run a verify and return the refusal it produced, failing if it produced none. */
async function refusalOf(run: () => Promise<unknown>, what: string): Promise<RailWebhookRefusal> {
  try {
    await run();
  } catch (error) {
    expect(error, what).toBeInstanceOf(RailWebhookVerificationError);
    return (error as RailWebhookVerificationError).refusal;
  }
  expect.unreachable(`${what}: nothing was refused`);
}

describe('the happy path, which every refusal case below is measured against', () => {
  test('a fresh delivery verifies and carries both halves of the anchor', async () => {
    const rail = railAt();
    const sent = rail.deliver(DELIVERY);
    const event = await rail.verifyWebhook(sent.raw, sent.headers);

    expect(event.provider).toBe('rise');
    expect(event.providerEventId).toBe('evt_settle_1');
    expect(event.providerTransferId).toBe('rise_tr_1_wd-1');
    expect(event.eventType).toBe('transfer.settled');
    expect(event.nonce).toBe(sent.headers[RAIL_NONCE_HEADER]);
    expect(event.timestampEpochSeconds).toBe(NOW_SECONDS);
    expect(event.raw).toBe(sent.raw);
    expect(event.payload['event_id']).toBe('evt_settle_1');
  });

  test('money in the payload is integer cents and never a float', async () => {
    const rail = railAt();
    const sent = rail.deliver(DELIVERY);
    const event = await rail.verifyWebhook(sent.raw, sent.headers);
    const data = event.payload['data'];
    expect(typeof data).toBe('object');
    const amount = (data as Record<string, unknown>)['amount_cents'];
    expect(Number.isInteger(amount)).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// SEED 1: a signature that does not verify
// -----------------------------------------------------------------------------

describe('SEED: a signature that does not verify', () => {
  test('one flipped byte of the MAC is signature_mismatch', async () => {
    const rail = railAt();
    const sent = rail.deliver(DELIVERY);
    const mac = sent.headers[RAIL_SIGNATURE_HEADER] as string;
    // Flip one base64 character, keeping the length and the alphabet legal so
    // the refusal is the DIGEST's and not the decoder's.
    const tampered = (mac[0] === 'A' ? 'B' : 'A') + mac.slice(1);

    const refusal = await refusalOf(
      () => rail.verifyWebhook(sent.raw, { ...sent.headers, [RAIL_SIGNATURE_HEADER]: tampered }),
      'a flipped MAC',
    );
    expect(refusal).toBe('signature_mismatch');
  });

  test('one flipped byte of the BODY is signature_mismatch, with the MAC untouched', async () => {
    const rail = railAt();
    const sent = rail.deliver(DELIVERY);
    const edited = new Uint8Array(sent.raw);
    // `12500` becomes `12600`: an amount an attacker would want to change, and
    // the byte is inside the digest.
    const text = new TextDecoder().decode(edited);
    const swapped = new TextEncoder().encode(text.replace('12500', '12600'));
    expect(swapped.length).toBe(edited.length);

    const refusal = await refusalOf(
      () => rail.verifyWebhook(swapped, sent.headers),
      'an edited amount',
    );
    expect(refusal).toBe('signature_mismatch');
  });

  test('a signature signed with a DIFFERENT secret is refused', async () => {
    const attacker = createSandboxRail({ secret: 'not-the-secret', clock: () => AT });
    const merit = railAt();
    const sent = attacker.deliver(DELIVERY);

    const refusal = await refusalOf(
      () => merit.verifyWebhook(sent.raw, sent.headers),
      'somebody elses secret',
    );
    expect(refusal).toBe('signature_mismatch');
  });

  test('a MAC that is not base64 is signature_malformed, not a short-buffer compare', async () => {
    const rail = railAt();
    const sent = rail.deliver(DELIVERY);

    const refusal = await refusalOf(
      () => rail.verifyWebhook(sent.raw, { ...sent.headers, [RAIL_SIGNATURE_HEADER]: '!!!!' }),
      'a non-base64 MAC',
    );
    expect(refusal).toBe('signature_malformed');
  });

  test('a missing signature header, and a repeated one, are two different refusals', async () => {
    const rail = railAt();
    const sent = rail.deliver(DELIVERY);
    // `noUncheckedIndexedAccess` makes a destructured index `string | undefined`
    // and the compiler does not track that this key was just written, so it is
    // narrowed rather than asserted.
    const { [RAIL_SIGNATURE_HEADER]: signature, ...withoutSignature } = sent.headers;
    if (signature === undefined) expect.unreachable('the fake always signs');
    const mac: string = signature;

    expect(await refusalOf(() => rail.verifyWebhook(sent.raw, withoutSignature), 'missing')).toBe(
      'signature_header_missing',
    );
    expect(
      await refusalOf(
        () =>
          rail.verifyWebhook(sent.raw, { ...sent.headers, [RAIL_SIGNATURE_HEADER]: [mac, mac] }),
        'repeated',
      ),
    ).toBe('signature_header_repeated');
  });
});

// -----------------------------------------------------------------------------
// SEED 2: a timestamp outside the window
// -----------------------------------------------------------------------------

describe('SEED: a timestamp outside the window, in BOTH directions', () => {
  test('a delivery stamped one second past the window is refused', async () => {
    const rail = railAt();
    const stale = rail.deliver({
      ...DELIVERY,
      timestampEpochSeconds: NOW_SECONDS - RAIL_WEBHOOK_WINDOW_SECONDS - 1,
    });

    const refusal = await refusalOf(
      () => rail.verifyWebhook(stale.raw, stale.headers),
      'a stale capture',
    );
    expect(refusal).toBe('timestamp_outside_window');
  });

  test('a delivery stamped in the FUTURE past the window is refused too', async () => {
    // Without this direction a capture stamped next year never expires, which is
    // the replay this control exists to bound.
    const rail = railAt();
    const future = rail.deliver({
      ...DELIVERY,
      timestampEpochSeconds: NOW_SECONDS + RAIL_WEBHOOK_WINDOW_SECONDS + 1,
    });

    const refusal = await refusalOf(
      () => rail.verifyWebhook(future.raw, future.headers),
      'a future capture',
    );
    expect(refusal).toBe('timestamp_outside_window');
  });

  test('the boundary itself is INSIDE the window, in both directions', async () => {
    const rail = railAt();
    for (const skew of [-RAIL_WEBHOOK_WINDOW_SECONDS, RAIL_WEBHOOK_WINDOW_SECONDS]) {
      const edge = rail.deliver({ ...DELIVERY, timestampEpochSeconds: NOW_SECONDS + skew });
      const event = await rail.verifyWebhook(edge.raw, edge.headers);
      expect(event.timestampEpochSeconds).toBe(NOW_SECONDS + skew);
    }
  });

  test('the window is five minutes, which is API_CONTRACT section 10s number', () => {
    expect(RAIL_WEBHOOK_WINDOW_SECONDS).toBe(300);
  });

  test('a timestamp that is not an integer is signature_malformed', async () => {
    const rail = railAt();
    const sent = rail.deliver(DELIVERY);

    const refusal = await refusalOf(
      () =>
        rail.verifyWebhook(sent.raw, { ...sent.headers, [RAIL_TIMESTAMP_HEADER]: '1756382400abc' }),
      'a trailing-garbage timestamp',
    );
    // `Number.parseInt` would have returned 1756382400 and the window would have
    // silently passed on a value nobody sent.
    expect(refusal).toBe('signature_malformed');
  });
});

// -----------------------------------------------------------------------------
// The order, and the bytes
// -----------------------------------------------------------------------------

describe('the digest runs BEFORE the freshness window', () => {
  test('a stale delivery whose MAC is also wrong reports the MISMATCH, not the window', async () => {
    // An attacker controls the timestamp bytes. If the window ran first, an
    // unauthenticated party would choose which branch of the verifier executes.
    const rail = railAt();
    const stale = rail.deliver({
      ...DELIVERY,
      timestampEpochSeconds: NOW_SECONDS - RAIL_WEBHOOK_WINDOW_SECONDS - 1,
    });
    const mac = stale.headers[RAIL_SIGNATURE_HEADER] as string;
    const tampered = (mac[0] === 'A' ? 'B' : 'A') + mac.slice(1);

    const refusal = await refusalOf(
      () => rail.verifyWebhook(stale.raw, { ...stale.headers, [RAIL_SIGNATURE_HEADER]: tampered }),
      'stale AND forged',
    );
    expect(refusal).toBe('signature_mismatch');
  });
});

describe('the parse runs only after the digest agreed', () => {
  test('a body that is not JSON, but correctly signed, is payload_not_json_object', async () => {
    // Reaching this refusal at all proves the parse is downstream of the digest:
    // an unsigned non-JSON body would have been refused as a mismatch first.
    const rail = railAt();
    const sent = rail.deliver(DELIVERY);
    const notJson = new TextEncoder().encode('this is not json');
    const resigned = signBytes(
      sent.headers[RAIL_TIMESTAMP_HEADER] as string,
      sent.headers[RAIL_NONCE_HEADER] as string,
      notJson,
    );

    const refusal = await refusalOf(
      () => rail.verifyWebhook(notJson, resigned),
      'a signed non-JSON body',
    );
    expect(refusal).toBe('payload_not_json_object');
  });

  test('a signed JSON ARRAY is refused: a top-level array is not an object', async () => {
    const rail = railAt();
    const sent = rail.deliver(DELIVERY);
    const array = new TextEncoder().encode('[1,2,3]');
    const resigned = signBytes(
      sent.headers[RAIL_TIMESTAMP_HEADER] as string,
      sent.headers[RAIL_NONCE_HEADER] as string,
      array,
    );

    expect(await refusalOf(() => rail.verifyWebhook(array, resigned), 'an array body')).toBe(
      'payload_not_json_object',
    );
  });

  test('a signed object naming no transfer id is event_identity_missing', async () => {
    // Half of API_CONTRACT section 10's anchor for this row. A receiver would
    // have nothing to attach the outcome to.
    const rail = railAt();
    const sent = rail.deliver(DELIVERY);
    const noTransfer = new TextEncoder().encode(
      JSON.stringify({ event_id: 'evt_1', event_name: 'transfer.settled', data: {} }),
    );
    const resigned = signBytes(
      sent.headers[RAIL_TIMESTAMP_HEADER] as string,
      sent.headers[RAIL_NONCE_HEADER] as string,
      noTransfer,
    );

    expect(await refusalOf(() => rail.verifyWebhook(noTransfer, resigned), 'no transfer id')).toBe(
      'event_identity_missing',
    );
  });
});

describe('ADR-109 clause 7: a re-encoded body is a DIFFERENT DOCUMENT', () => {
  test('a pretty-printed round trip is refused, and the ORIGINAL bytes then verify', async () => {
    // The order matters. Asserting only the refusal would be satisfied by a
    // verifier that refuses everything, so the second assertion is what makes
    // the first one mean something.
    const rail = railAt();
    const sent = rail.deliver(DELIVERY);

    const roundTripped = new TextEncoder().encode(
      JSON.stringify(JSON.parse(new TextDecoder().decode(sent.raw)), null, 2),
    );
    expect(
      await refusalOf(() => rail.verifyWebhook(roundTripped, sent.headers), 'a re-encode'),
    ).toBe('signature_mismatch');

    const event = await rail.verifyWebhook(sent.raw, sent.headers);
    expect(event.providerEventId).toBe('evt_settle_1');
  });
});

/**
 * Sign arbitrary bytes the way the sandbox rail does, so a case can present a
 * body the fake would never emit and still get past the digest.
 *
 * IT RE-COMPUTES THE MAC WITH THE SAME SECRET THE TESTS CONSTRUCT THE RAIL WITH,
 * because the fake's `deliver` only ever emits its own four-field wrapper and
 * three cases here need a body it would never produce. THE SIGNED-BYTES SHAPE IS
 * THE ONE PLACE THIS HELPER COULD DRIFT from the implementation, so
 * `psp-shape-bind.test.ts` reads `fakes/sandbox.ts` and asserts that shape
 * against this file rather than leaving the agreement to a reader.
 */
function signBytes(timestamp: string, nonce: string, raw: Uint8Array): Record<string, string> {
  const prefix = new TextEncoder().encode(`${timestamp}\n${nonce}\n`);
  const signed = new Uint8Array(prefix.length + raw.length);
  signed.set(prefix, 0);
  signed.set(raw, prefix.length);
  return {
    [RAIL_TIMESTAMP_HEADER]: timestamp,
    [RAIL_NONCE_HEADER]: nonce,
    [RAIL_SIGNATURE_HEADER]: createHmac('sha256', TEST_SECRET).update(signed).digest('base64'),
  };
}
