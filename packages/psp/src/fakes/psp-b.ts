// =============================================================================
// packages/psp/src/fakes/psp-b.ts
// =============================================================================
// THE SECOND FAKE, AND ITS DISCOMFORT IS THE FINDING.
//
// The brief for this session put it plainly: "if the second fake is
// uncomfortable to write against your port, the port is wrong and that
// discomfort is the finding." Writing this one moved the port three times, and
// each move is recorded where it landed rather than only here:
//
//   1. THE NONCE STOPPED BEING A HEADER. This provider has one and its sibling
//      does not, so a `PresentedSignature.nonce` would have forced the sibling
//      to invent a value. The nonce is resolved with the event identity now,
//      after the digest, and what the port requires is that it be COVERED by
//      the signature rather than that it arrive in a header. See `webhook.ts`.
//   2. `RefundResult` GREW A `pending`. This provider acknowledges a refund and
//      settles it on a later webhook; its sibling settles in the call. A port
//      written against the sibling alone would have had no word for the first
//      shape and the second adapter would have lied about its own state.
//   3. THE SIGNED BYTES STOPPED BEING DERIVABLE FROM THE HEADERS BY THE PORT.
//      One provider joins timestamp to body with `.`, this one joins timestamp,
//      nonce and body with newlines. Building the signed run is the adapter's,
//      and only the ORDER of the checks is Merit's.
//
// WHAT DID NOT MOVE, WHICH IS THE OTHER HALF OF THE RESULT. `verifyWebhook`
// still throws rather than returning a boolean, still refuses before parsing,
// and still hands back nothing the digest did not cover. Two providers with
// nothing mechanical in common agree on all three, so those three are the port
// rather than one vendor's habit.
//
// NO VENDOR IS NAMED HERE AND NONE IS IMPLIED. `psp_b` is the schema's word for
// the second MID and the second MID is a ruling (`INV-M3-11`, `RB-03`), not a
// product choice this file is making.
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
import type { Clock } from './psp-a.ts';
import { createHmac } from 'node:crypto';

/** THREE headers, where its sibling sends one. */
export const PSP_B_TIMESTAMP_HEADER = 'psp-b-timestamp';
export const PSP_B_NONCE_HEADER = 'psp-b-nonce';
export const PSP_B_SIGNATURE_HEADER = 'psp-b-signature';

/** Fifteen minutes, where its sibling gives thirty. */
const PSP_B_SESSION_TTL_SECONDS = 15 * 60;

export interface PspBFakeOptions {
  readonly secret: string;
  readonly clock: Clock;
  readonly reachable?: boolean;
  readonly latencyMs?: number;
}

export interface PspBSignedWebhook {
  readonly raw: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
}

export interface PspBSignRequest {
  readonly eventId: string;
  readonly eventType: string;
  readonly payload: JsonObject;
  readonly timestampEpochSeconds?: number;
  /** This provider carries its own nonce. Defaults to a deterministic one. */
  readonly nonce?: string;
}

/**
 * `psp_b`'s scheme: three headers, base64, and a newline-delimited run that
 * carries the nonce INSIDE the digest.
 */
const PSP_B_SCHEME: HmacWebhookScheme = {
  psp: 'psp_b',

  presentedSignature(raw: Uint8Array, headers: WebhookHeaders): PresentedSignature {
    const timestamp = singleHeader(headers, PSP_B_TIMESTAMP_HEADER, 'psp_b', raw);
    const nonce = singleHeader(headers, PSP_B_NONCE_HEADER, 'psp_b', raw);
    const signature = singleHeader(headers, PSP_B_SIGNATURE_HEADER, 'psp_b', raw);

    if (nonce.length === 0 || nonce.includes('\n')) {
      // A nonce carrying the delimiter could move the boundary between the
      // prefix and the body and make two different requests produce one signed
      // run. Refused rather than escaped, because escaping is a second encoding
      // for the next reader to get wrong.
      throw new WebhookVerificationError('psp_b', 'signature_malformed', raw, 'nonce shape');
    }

    return {
      signedBytes: psp_bSignedBytes(timestamp, nonce, raw),
      mac: decodeMac(signature, 'base64', 'psp_b', raw),
      timestampEpochSeconds: decimalInteger(timestamp, 'psp_b', raw, PSP_B_TIMESTAMP_HEADER),
      headerNonce: nonce,
    };
  },

  eventIdentity(payload: JsonObject, presented: PresentedSignature): EventIdentity | null {
    const id = payload['event_id'];
    const name = payload['event_name'];
    if (typeof id !== 'string' || id.length === 0) return null;
    if (typeof name !== 'string' || name.length === 0) return null;
    // The header nonce, and it is covered by the signature because the digest
    // spans it. `presented.headerNonce` is only ever set by the extractor above.
    const nonce = presented.headerNonce;
    if (nonce === undefined) return null;
    return { providerEventId: id, eventType: name, nonce };
  },
};

/** Timestamp, nonce and body, newline delimited. Not its sibling's `.` join. */
function psp_bSignedBytes(timestamp: string, nonce: string, raw: Uint8Array): Uint8Array {
  return concatBytes(utf8(`${timestamp}\n${nonce}\n`), raw);
}

export class PspBFake implements PspAdapter {
  readonly psp = 'psp_b' as const;

  readonly #secret: string;
  readonly #clock: Clock;
  readonly #sessions = new Map<string, PaymentSession>();
  readonly #refunds = new Map<string, RefundResult>();
  #counter = 0;

  reachable: boolean;
  latencyMs: number;

  constructor(options: PspBFakeOptions) {
    this.#secret = options.secret;
    this.#clock = options.clock;
    this.reachable = options.reachable ?? true;
    this.latencyMs = options.latencyMs ?? 88;
  }

  createSession(intent: PurchaseIntent): Promise<PaymentSession> {
    const existing = this.#sessions.get(intent.idempotencyKey);
    if (existing !== undefined) return Promise.resolve(existing);
    if (intent.cardAmountCents <= 0n) {
      return Promise.reject(new Error('psp_b: a session needs a positive card leg'));
    }
    this.#counter += 1;
    const id = `PSPB-${this.#counter}-${intent.purchaseId}`;
    const session: PaymentSession = {
      providerSessionId: id,
      // A FRAGMENT RATHER THAN A PATH, deliberately different from its
      // sibling's shape so nothing downstream can parse a redirect URL.
      redirectUrl: `https://pay.psp-b.test/s#${id}`,
      expiresAt: new Date(this.#clock().getTime() + PSP_B_SESSION_TTL_SECONDS * 1000).toISOString(),
    };
    this.#sessions.set(intent.idempotencyKey, session);
    return Promise.resolve(session);
  }

  verifyWebhook(raw: Uint8Array, headers: WebhookHeaders): Promise<VerifiedEvent> {
    try {
      return Promise.resolve(
        verifyHmacWebhook({
          scheme: PSP_B_SCHEME,
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

  /**
   * ACKNOWLEDGES AND DOES NOT SETTLE. The settlement arrives as a later
   * webhook, which is why `RefundResult.providerStatus` has a `pending` member
   * at all and why nothing in the port treats a returned refund as money moved.
   */
  refund(
    purchaseRef: string,
    amountCents: CardAmountCents,
    idempotencyKey: string,
  ): Promise<RefundResult> {
    const existing = this.#refunds.get(idempotencyKey);
    if (existing !== undefined) return Promise.resolve(existing);
    this.#counter += 1;
    const result: RefundResult = {
      providerRefundId: `PSPB-RF-${this.#counter}-${purchaseRef}`,
      amountCents,
      providerStatus: 'pending',
    };
    this.#refunds.set(idempotencyKey, result);
    return Promise.resolve(result);
  }

  health(): Promise<PspProbe> {
    return Promise.resolve({ psp: this.psp, reachable: this.reachable, latencyMs: this.latencyMs });
  }

  signWebhook(request: PspBSignRequest): PspBSignedWebhook {
    const timestamp = String(
      request.timestampEpochSeconds ?? Math.floor(this.#clock().getTime() / 1000),
    );
    this.#counter += 1;
    const nonce = request.nonce ?? `psp-b-nonce-${this.#counter}`;
    const body: JsonObject = {
      event_id: request.eventId,
      event_name: request.eventType,
      payload: request.payload,
    };
    const raw = utf8(JSON.stringify(body));
    const mac = createHmac('sha256', this.#secret)
      .update(psp_bSignedBytes(timestamp, nonce, raw))
      .digest('base64');
    return {
      raw,
      headers: {
        [PSP_B_TIMESTAMP_HEADER]: timestamp,
        [PSP_B_NONCE_HEADER]: nonce,
        [PSP_B_SIGNATURE_HEADER]: mac,
      },
    };
  }
}

export function createPspBFake(options: PspBFakeOptions): PspBFake {
  return new PspBFake(options);
}
