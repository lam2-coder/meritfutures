// =============================================================================
// packages/psp/src/fakes/psp-a.ts
// =============================================================================
// THE FIRST OF TWO FAKES, AND THE REASON THERE ARE TWO.
//
// A port with one fake is a port shaped like that fake. The second one is what
// forces the interface to be the thing the two have IN COMMON rather than the
// thing the first one happened to need, and every difference below is a
// difference real payment processors actually ship rather than a difference
// invented to make a point:
//
//                          psp_a (here)              psp_b (its sibling)
//   signature header       ONE, compound             THREE, separate
//                          `t=...,v1=...`            timestamp / nonce / signature
//   MAC encoding           lower-case hex            base64
//   signed bytes           `"<t>." + body`           `"<ts>\n<nonce>\n" + body`
//   nonce channel          NONE. The event id is     a header, covered by the MAC
//                          the replay anchor
//   body field names       `id`, `type`              `event_id`, `event_name`
//   refund                 settles IN THE CALL       returns `pending`
//   session lifetime       30 minutes                15 minutes
//
// THE ROW THAT COST THE MOST IS THE NONCE ROW and it is written up in
// `webhook.ts`: a port that demanded a nonce header would have made this fake
// invent one, and an invented nonce protects nothing.
//
// IT IS A FAKE AND NOT A MOCK. It holds real state, it really computes an HMAC,
// and its `signWebhook` really produces bytes its own `verifyWebhook` refuses
// when they are altered. STRATEGY section 2 rejects a mock at a parser boundary
// by name, and `packages/rithmic`'s simulator is the precedent this follows:
// M02 section 3.5 point 4 keeps the simulator so "the live layer is developable
// and testable before any vendor agreement exists".
//
// NO VENDOR IS NAMED HERE AND NONE IS IMPLIED. `psp_a` is the schema's word for
// the first MID (`purchases.psp` CHECK, `0006_commerce.sql`), the vendor is
// unselected, and M03 section 7.9.1 already rules the selection criterion, so
// this file neither chooses nor forecloses one.
// =============================================================================

import {
  WebhookVerificationError,
  type CardAmountCents,
  type JsonObject,
  type PaymentSession,
  type PspAdapter,
  type PspProbe,
  type PurchaseIntent,
  type RefundResult,
  type VerifiedEvent,
  type WebhookHeaders,
} from '../port.ts';
import {
  concatBytes,
  decimalInteger,
  decodeMac,
  singleHeader,
  utf8,
  verifyHmacWebhook,
  type EventIdentity,
  type HmacWebhookScheme,
  type PresentedSignature,
} from '../webhook.ts';
import { createHmac } from 'node:crypto';

/** The one header this provider sends. Compound, in the shape Stripe made common. */
export const PSP_A_SIGNATURE_HEADER = 'psp-a-signature';

/** How long a session this provider opens stays usable. */
const PSP_A_SESSION_TTL_SECONDS = 30 * 60;

/** Injected, because nothing in this package reads a clock of its own. */
export type Clock = () => Date;

export interface PspAFakeOptions {
  /** The shared secret. A fake still holds a real one and really MACs with it. */
  readonly secret: string;
  readonly clock: Clock;
  /** What `health()` reports. Settable so a test can drive failover. */
  readonly reachable?: boolean;
  readonly latencyMs?: number;
}

/** What `signWebhook` is asked to emit. The provider side of the fake. */
export interface PspASignedWebhook {
  readonly raw: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
}

export interface PspASignRequest {
  readonly eventId: string;
  readonly eventType: string;
  readonly data: JsonObject;
  /** Defaults to the clock. Overridden to drive the freshness window. */
  readonly timestampEpochSeconds?: number;
}

/**
 * `psp_a`'s scheme: one compound header, hex, and the timestamp joined to the
 * body by a literal `.` before the digest is taken.
 */
const PSP_A_SCHEME: HmacWebhookScheme = {
  psp: 'psp_a',

  presentedSignature(raw: Uint8Array, headers: WebhookHeaders): PresentedSignature {
    const header = singleHeader(headers, PSP_A_SIGNATURE_HEADER, 'psp_a', raw);

    // `t=<seconds>,v1=<hex>`. Parsed strictly: an unknown part, a repeat, or a
    // missing half is malformed rather than ignored, because a tolerant parser
    // here is a parser an attacker gets to choose the branch of.
    let t: string | undefined;
    let v1: string | undefined;
    for (const part of header.split(',')) {
      const eq = part.indexOf('=');
      if (eq <= 0) {
        throw new WebhookVerificationError('psp_a', 'signature_malformed', raw, 'part has no `=`');
      }
      const key = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (key === 't') {
        if (t !== undefined) {
          throw new WebhookVerificationError('psp_a', 'signature_malformed', raw, 'repeated `t`');
        }
        t = value;
      } else if (key === 'v1') {
        if (v1 !== undefined) {
          throw new WebhookVerificationError('psp_a', 'signature_malformed', raw, 'repeated `v1`');
        }
        v1 = value;
      } else {
        throw new WebhookVerificationError(
          'psp_a',
          'signature_malformed',
          raw,
          `unknown part ${key}`,
        );
      }
    }
    if (t === undefined || v1 === undefined) {
      throw new WebhookVerificationError(
        'psp_a',
        'signature_malformed',
        raw,
        'needs both `t` and `v1`',
      );
    }

    return {
      signedBytes: psp_aSignedBytes(t, raw),
      mac: decodeMac(v1, 'hex', 'psp_a', raw),
      timestampEpochSeconds: decimalInteger(t, 'psp_a', raw, 't'),
    };
  },

  eventIdentity(payload: JsonObject): EventIdentity | null {
    const id = payload['id'];
    const type = payload['type'];
    if (typeof id !== 'string' || id.length === 0) return null;
    if (typeof type !== 'string' || type.length === 0) return null;
    // THE NONCE IS THE EVENT ID, and it is covered by the signature because the
    // signature spans the body it was read out of. This provider has no nonce
    // channel; `(psp, provider_event_id)` is the anchor API_CONTRACT section 10
    // already names two lines below the nonce sentence.
    return { providerEventId: id, eventType: type, nonce: id };
  },
};

/** The bytes this provider signs: the timestamp, a literal `.`, then the body. */
function psp_aSignedBytes(t: string, raw: Uint8Array): Uint8Array {
  return concatBytes(utf8(`${t}.`), raw);
}

/**
 * The fake. Deterministic: no clock of its own, no randomness, and every
 * identifier it mints is a counter and its inputs.
 */
export class PspAFake implements PspAdapter {
  readonly psp = 'psp_a' as const;

  readonly #secret: string;
  readonly #clock: Clock;
  readonly #sessions = new Map<string, PaymentSession>();
  readonly #refunds = new Map<string, RefundResult>();
  #counter = 0;

  /** Mutable so a test can take this MID down and watch routing move. */
  reachable: boolean;
  latencyMs: number;

  constructor(options: PspAFakeOptions) {
    this.#secret = options.secret;
    this.#clock = options.clock;
    this.reachable = options.reachable ?? true;
    this.latencyMs = options.latencyMs ?? 42;
  }

  /**
   * IDEMPOTENT ON THE ATTEMPT KEY, WHICH IS A PROMISE OF THE PORT rather than a
   * convenience of this fake. Replaying a key returns the original session; a
   * genuinely new attempt carries a new key and gets a new session, which is
   * M03 section 3.2's rule that a retry is never a reuse.
   */
  createSession(intent: PurchaseIntent): Promise<PaymentSession> {
    const existing = this.#sessions.get(intent.idempotencyKey);
    if (existing !== undefined) return Promise.resolve(existing);

    // Read but never returned: the fake proves the amount reaches it, and the
    // TYPE proves where the amount came from. A negative or zero card leg
    // cannot be spelled, because `cardLegOf` is the only producer.
    if (intent.cardAmountCents <= 0n) {
      return Promise.reject(new Error('psp_a: a session needs a positive card leg'));
    }

    this.#counter += 1;
    const session: PaymentSession = {
      providerSessionId: `psp_a_cs_${this.#counter}_${intent.purchaseId}`,
      redirectUrl: `https://psp-a.example/checkout/psp_a_cs_${this.#counter}_${intent.purchaseId}`,
      expiresAt: new Date(this.#clock().getTime() + PSP_A_SESSION_TTL_SECONDS * 1000).toISOString(),
    };
    this.#sessions.set(intent.idempotencyKey, session);
    return Promise.resolve(session);
  }

  verifyWebhook(raw: Uint8Array, headers: WebhookHeaders): Promise<VerifiedEvent> {
    // `verifyHmacWebhook` throws synchronously; the rejection is what the port
    // promises, so the throw is turned into one rather than escaping the async
    // boundary in a shape a `.catch` would miss.
    try {
      return Promise.resolve(
        verifyHmacWebhook({
          scheme: PSP_A_SCHEME,
          secret: this.#secret,
          raw,
          headers,
          now: this.#clock(),
        }),
      );
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /** Settles in the call. Its sibling does not, and the port carries both. */
  refund(
    purchaseRef: string,
    amountCents: CardAmountCents,
    idempotencyKey: string,
  ): Promise<RefundResult> {
    const existing = this.#refunds.get(idempotencyKey);
    if (existing !== undefined) return Promise.resolve(existing);
    this.#counter += 1;
    const result: RefundResult = {
      providerRefundId: `psp_a_re_${this.#counter}_${purchaseRef}`,
      amountCents,
      providerStatus: 'succeeded',
    };
    this.#refunds.set(idempotencyKey, result);
    return Promise.resolve(result);
  }

  health(): Promise<PspProbe> {
    return Promise.resolve({ psp: this.psp, reachable: this.reachable, latencyMs: this.latencyMs });
  }

  // ---------------------------------------------------------------------------
  // The provider side, which is what makes this a fake rather than a stub
  // ---------------------------------------------------------------------------

  /**
   * Emit a webhook the way this provider would, signed with the same secret.
   *
   * The body is serialised ONCE, here, and the bytes are what get signed. A
   * caller that re-serialises them before calling `verifyWebhook` gets a
   * refusal, which is the property the approval clause on ADR-105 names.
   */
  signWebhook(request: PspASignRequest): PspASignedWebhook {
    const t = request.timestampEpochSeconds ?? Math.floor(this.#clock().getTime() / 1000);
    const body: JsonObject = {
      id: request.eventId,
      type: request.eventType,
      data: request.data,
    };
    const raw = utf8(JSON.stringify(body));
    const mac = createHmac('sha256', this.#secret)
      .update(psp_aSignedBytes(String(t), raw))
      .digest('hex');
    return { raw, headers: { [PSP_A_SIGNATURE_HEADER]: `t=${t},v1=${mac}` } };
  }
}

/** Constructor function, for symmetry with its sibling and for readability. */
export function createPspAFake(options: PspAFakeOptions): PspAFake {
  return new PspAFake(options);
}
