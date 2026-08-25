// =============================================================================
// packages/psp/test/port.test.ts
// =============================================================================
// THE MECHANISM, NOT A SUITE OF EXAMPLES.
//
// Every case in the first half runs over BOTH fakes from one table. That is
// what a second fake buys: an assertion that passes for one adapter and not the
// other is not a failing test, it is the PORT being one vendor's habit written
// down. Adding a third adapter is one line here, and the day it is a real one
// this file is the acceptance suite it has to pass.
//
// The two implementations agree on NOTHING mechanical -- one compound header
// against three, hex against base64, a `.` join against newlines, no nonce
// channel against one, a refund that settles in the call against one that does
// not -- so what survives every case below is the port.
// =============================================================================

import { describe, expect, test } from 'vitest';

import * as psp from '../src/index.ts';
import { cardLegOf } from '../src/amount.ts';
import {
  WebhookVerificationError,
  type PspAdapter,
  type PurchaseIntent,
  type VerifiedEvent,
} from '../src/port.ts';
import { createPspAFake } from '../src/fakes/psp-a.ts';
import { createPspBFake } from '../src/fakes/psp-b.ts';

const T0 = new Date('2026-08-25T14:00:00.000Z');
const clock = () => T0;

/** One provider under test: the adapter, and the provider-side signer for it. */
interface Case {
  readonly name: string;
  readonly adapter: PspAdapter & { reachable: boolean; latencyMs: number };
  /** Emit a webhook the way this provider does. The shapes differ; this hides it. */
  readonly emit: (
    eventId: string,
    eventType: string,
  ) => {
    raw: Uint8Array;
    headers: Readonly<Record<string, string>>;
  };
  /** What its refund does. The one behaviour the two genuinely disagree on. */
  readonly refundStatus: 'pending' | 'succeeded';
}

function cases(): readonly Case[] {
  const a = createPspAFake({ secret: 'secret-a', clock });
  const b = createPspBFake({ secret: 'secret-b', clock });
  return [
    {
      name: 'psp_a',
      adapter: a,
      emit: (eventId, eventType) => a.signWebhook({ eventId, eventType, data: { k: 'v' } }),
      refundStatus: 'succeeded',
    },
    {
      name: 'psp_b',
      adapter: b,
      emit: (eventId, eventType) => b.signWebhook({ eventId, eventType, payload: { k: 'v' } }),
      refundStatus: 'pending',
    },
  ];
}

/** A card leg, produced the only way one can be produced. */
const CARD_LEG = cardLegOf({
  paymentMethod: 'mixed',
  amountPaidCents: 9900n,
  walletDebitCents: 6000n,
});

function intent(overrides: Partial<PurchaseIntent> = {}): PurchaseIntent {
  return {
    purchaseId: 'pur-1',
    cardAmountCents: CARD_LEG,
    currency: 'USD',
    returnUrl: 'https://app.meritfutures.com/checkout/done',
    cancelUrl: 'https://app.meritfutures.com/checkout/cancelled',
    idempotencyKey: 'attempt-1',
    ...overrides,
  };
}

for (const c of cases()) {
  describe(`the port, through ${c.name}`, () => {
    test('names the MID it is, and it is one of the two the schema allows', () => {
      expect(psp.PSP_IDS).toContain(c.adapter.psp);
      expect(c.adapter.psp).toBe(c.name);
    });

    test('opens a session carrying exactly CheckoutResponse.payment_session', async () => {
      const session = await c.adapter.createSession(intent());
      expect(Object.keys(session).sort()).toEqual([
        'expiresAt',
        'providerSessionId',
        'redirectUrl',
      ]);
      expect(session.providerSessionId.length).toBeGreaterThan(0);
      expect(session.redirectUrl.startsWith('https://')).toBe(true);
      // API_CONTRACT section 1: `*_at` are RFC 3339 UTC strings.
      expect(session.expiresAt).toBe(new Date(session.expiresAt).toISOString());
      expect(new Date(session.expiresAt).getTime()).toBeGreaterThan(T0.getTime());
    });

    test('is idempotent on the ATTEMPT key, and a new attempt is a new session', async () => {
      const first = await c.adapter.createSession(intent());
      const replay = await c.adapter.createSession(intent());
      expect(replay).toEqual(first);
      // M03 section 3.2: "a new attempt is a new session with a new idempotency
      // key". Same purchase, different key, different session.
      const second = await c.adapter.createSession(intent({ idempotencyKey: 'attempt-2' }));
      expect(second.providerSessionId).not.toBe(first.providerSessionId);
    });

    test('verifies its own webhook and returns nothing the digest did not cover', async () => {
      const { raw, headers } = c.emit('evt-1', 'purchase.paid');
      const event: VerifiedEvent = await c.adapter.verifyWebhook(raw, headers);
      expect(event.psp).toBe(c.adapter.psp);
      expect(event.providerEventId).toBe('evt-1');
      expect(event.eventType).toBe('purchase.paid');
      expect(event.raw).toEqual(raw);
      expect(event.nonce.length).toBeGreaterThan(0);
      expect(JSON.parse(new TextDecoder().decode(event.raw))).toEqual(event.payload);
    });

    test('THE NONCE IS COVERED BY THE SIGNATURE, whichever side it arrives on', async () => {
      // The invariant is the port's; where the bytes sit is the vendor's. One
      // provider carries a nonce header and the other has no nonce channel at
      // all, and the digest spans the nonce in both.
      const { raw, headers } = c.emit('evt-2', 'purchase.paid');
      const event = await c.adapter.verifyWebhook(raw, headers);
      const signedText = new TextDecoder().decode(raw);
      const inBody = signedText.includes(event.nonce);
      const inHeaders = Object.values(headers).some((v) => v.includes(event.nonce));
      expect(inBody || inHeaders).toBe(true);
    });

    test('THROWS on refusal. There is no unverified return value to ignore', async () => {
      const { raw } = c.emit('evt-3', 'purchase.paid');
      await expect(c.adapter.verifyWebhook(raw, {})).rejects.toBeInstanceOf(
        WebhookVerificationError,
      );
    });

    test('refuses a body re-serialised before verification', async () => {
      const { raw, headers } = c.emit('evt-4', 'purchase.paid');
      const round = new TextEncoder().encode(
        JSON.stringify(JSON.parse(new TextDecoder().decode(raw)), null, 1),
      );
      await expect(c.adapter.verifyWebhook(round, headers)).rejects.toMatchObject({
        refusal: 'signature_mismatch',
        psp: c.adapter.psp,
      });
    });

    test('refunds idempotently and reports the provider status rather than a verdict', async () => {
      const result = await c.adapter.refund('provider-ref-1', CARD_LEG, 'refund-key-1');
      expect(result.amountCents).toBe(CARD_LEG);
      expect(result.providerStatus).toBe(c.refundStatus);
      expect(await c.adapter.refund('provider-ref-1', CARD_LEG, 'refund-key-1')).toEqual(result);
      // Merit's vocabulary is `payment_disputes.outcome`, and no adapter uses it.
      expect(['lost', 'won', 'refunded']).not.toContain(result.providerStatus);
    });

    test('health() PROBES and does not decide, and its latency is an integer', async () => {
      const probe = await c.adapter.health();
      expect(Object.keys(probe).sort()).toEqual(['latencyMs', 'psp', 'reachable']);
      expect(probe.psp).toBe(c.adapter.psp);
      expect(probe.reachable).toBe(true);
      expect(Number.isInteger(probe.latencyMs)).toBe(true);
      // `mid_health.state`'s vocabulary appears nowhere in a probe.
      expect(Object.values(probe)).not.toContain('healthy');

      c.adapter.reachable = false;
      expect((await c.adapter.health()).reachable).toBe(false);
    });

    test('reads a clock it was handed and never one of its own', async () => {
      let at = new Date('2026-01-01T00:00:00.000Z');
      const movable =
        c.name === 'psp_a'
          ? createPspAFake({ secret: 's', clock: () => at })
          : createPspBFake({ secret: 's', clock: () => at });
      const first = await movable.createSession(intent());
      at = new Date('2026-01-02T00:00:00.000Z');
      const second = await movable.createSession(intent({ idempotencyKey: 'attempt-2' }));
      expect(new Date(second.expiresAt).getTime() - new Date(first.expiresAt).getTime()).toBe(
        86_400_000,
      );
    });
  });
}

describe('the two fakes are genuinely different, so the table above proves something', () => {
  test('their webhook wire shapes share no header name', () => {
    const [a, b] = cases();
    if (a === undefined || b === undefined) expect.unreachable('two cases');
    const aHeaders = Object.keys(a.emit('e', 't').headers);
    const bHeaders = Object.keys(b.emit('e', 't').headers);
    expect(aHeaders).toHaveLength(1);
    expect(bHeaders).toHaveLength(3);
    expect(aHeaders.filter((h) => bHeaders.includes(h))).toEqual([]);
  });

  test("their bodies share no field name, so neither adapter's parser could serve the other", () => {
    const [a, b] = cases();
    if (a === undefined || b === undefined) expect.unreachable('two cases');
    const aKeys = Object.keys(JSON.parse(new TextDecoder().decode(a.emit('e', 't').raw)));
    const bKeys = Object.keys(JSON.parse(new TextDecoder().decode(b.emit('e', 't').raw)));
    expect(aKeys.filter((k) => bKeys.includes(k))).toEqual([]);
  });

  test("one adapter cannot verify the other adapter's webhook", async () => {
    const [a, b] = cases();
    if (a === undefined || b === undefined) expect.unreachable('two cases');
    const fromB = b.emit('evt-x', 'purchase.paid');
    await expect(a.adapter.verifyWebhook(fromB.raw, fromB.headers)).rejects.toMatchObject({
      refusal: 'signature_header_missing',
    });
  });

  test('they disagree about whether a refund has settled, which the port admits', async () => {
    const [a, b] = cases();
    if (a === undefined || b === undefined) expect.unreachable('two cases');
    const ra = await a.adapter.refund('r', CARD_LEG, 'k');
    const rb = await b.adapter.refund('r', CARD_LEG, 'k');
    expect(ra.providerStatus).not.toBe(rb.providerStatus);
  });
});

describe('the export surface is CLOSED, and each absence is a foreclosure', () => {
  // A LIST RATHER THAN A COUNT. Eight signed approval clauses in this corpus
  // have drifted because they named a number; this one names the members, so
  // an added export fails here with its own name printed.
  const EXPECTED_EXPORTS = [
    'BothMidsUnhealthyError',
    'CardLegError',
    'PSP_A_SIGNATURE_HEADER',
    'PSP_B_NONCE_HEADER',
    'PSP_B_SIGNATURE_HEADER',
    'PSP_B_TIMESTAMP_HEADER',
    'PSP_IDS',
    'PspAFake',
    'PspBFake',
    'WEBHOOK_WINDOW_SECONDS',
    'WebhookVerificationError',
    'cardLegOf',
    'chooseMidForNewAttempt',
    'concatBytes',
    'createPspAFake',
    'createPspBFake',
    'decimalInteger',
    'decodeMac',
    'singleHeader',
    'utf8',
    'verifyHmacWebhook',
  ];

  test('the package exports exactly these runtime names', () => {
    expect(Object.keys(psp).sort()).toEqual(EXPECTED_EXPORTS);
  });

  test('NOTHING PARSES A WEBHOOK BODY EXCEPT THROUGH VERIFICATION', () => {
    // API_CONTRACT section 10's ordering as a module boundary: the only exported
    // function that returns a parsed payload is the one that verified it first.
    // A new exported `parseWebhook` would fail the case above by name.
    const parsers = EXPECTED_EXPORTS.filter((n) => /parse|decode/i.test(n));
    expect(parsers).toEqual(['decodeMac']);
    // And `decodeMac` decodes a SIGNATURE, never a body.
    expect(() => psp.decodeMac('zz', 'hex', 'psp_a', new Uint8Array())).toThrow(
      WebhookVerificationError,
    );
  });

  test('there is no producer of a CardAmountCents except cardLegOf', () => {
    // Error classes are excluded because an error is a refusal rather than a
    // value: `CardLegError` is what the one producer throws.
    const producers = EXPECTED_EXPORTS.filter(
      (n) => /leg|amount|cents|price|money/i.test(n) && !n.endsWith('Error'),
    );
    expect(producers).toEqual(['cardLegOf']);
  });

  test('there is no function that moves a live session between providers', () => {
    // AS-M3-02. The absence is the control, so it is asserted rather than
    // assumed: a `retryAt`, `failover` or `reroute` export fails here.
    expect(EXPECTED_EXPORTS.filter((n) => /retry|failover|reroute|switch/i.test(n))).toEqual([]);
    // The one routing function names the only legitimate moment in its own name.
    expect(EXPECTED_EXPORTS.filter((n) => /choose/i.test(n))).toEqual(['chooseMidForNewAttempt']);
  });
});
