// =============================================================================
// packages/rail/src/fakes/sandbox.ts
// =============================================================================
// THE SANDBOX ADAPTER, AND IT IS A FAKE RATHER THAN A MOCK.
//
// It holds real state, it really computes an HMAC, and its `deliver` really
// produces bytes its own `verifyWebhook` refuses when they are altered. STRATEGY
// section 2 rejects a mock at a parser boundary by name, and `packages/rithmic`'s
// simulator is the precedent this follows: M02 section 3.5 point 4 keeps the
// simulator so "the live layer is developable and testable before any vendor
// agreement exists". A payout rail is the same problem with worse consequences.
//
// A HAND-WRITTEN FAKE NEEDS NO CATALOG ENTRY, SO THIS IS NOT A `VG-12`
// ADMISSION. P5 section 8 instructs this slice to STATE that rather than assume
// it, so: this file imports `node:crypto`, a Node builtin and not a package;
// `packages/rail/package.json` declares no runtime dependency and no workspace
// dependency; `pnpm-workspace.yaml`'s catalog block and its empty
// `onlyBuiltDependencies` list are untouched; and the only line `pnpm-lock.yaml`
// gains is this package's own `importers` block. Nothing is asked of VG-12.
//
// NO VENDOR IS NAMED HERE AND NONE IS IMPLIED. `rise` is
// `payout_transfers.provider`'s DEFAULT and the word `apps/api/src/rise-webhook.ts`
// already uses. This file neither selects a vendor nor forecloses one.
//
// -----------------------------------------------------------------------------
// ONE FAKE, WHERE `packages/psp` WROTE TWO, AND THE ARGUMENT IS IN `webhook.ts`
// -----------------------------------------------------------------------------
// That package's own reason for two was that "a port with one fake is a port
// shaped like that fake", and it had two MIDs to model because the firm holds
// two. This rail has one provider in every document that names one. What that
// costs is stated in `webhook.ts` beside `RailWebhookScheme`, and the mitigation
// is that this port's SHAPE was already forced apart by two disagreeing card
// implementations one rail over, with `test/psp-shape-bind.test.ts` holding that
// claim to the file it is a claim about.
//
// THE SCHEME THIS FAKE IMPLEMENTS IS THE THREE-HEADER ONE, deliberately: it is
// the shape with a real nonce channel, and this rail's contract row is the one
// that names a nonce. Choosing the compound-header shape would have made the
// fake read its own nonce out of the body, which is legal under the port and is
// the WEAKER of the two arrangements to demonstrate first.
//
// -----------------------------------------------------------------------------
// WHAT MAKES IT A SANDBOX RATHER THAN A STUB: IT CAN MISBEHAVE ON PURPOSE
// -----------------------------------------------------------------------------
// `deliver` signs a fresh delivery. `redeliver` re-emits BYTES THAT WERE ALREADY
// SENT, which is a capture and which the nonce refuses. `retry` re-signs the
// SAME EVENT with a fresh nonce and a fresh timestamp, which is what a real rail
// does when it did not hear the 200, and which must NOT be refused. A sandbox
// that could only do the first of those three would let a receiver pass every
// test it has while getting the interesting case wrong.
// =============================================================================

import { createHmac } from 'node:crypto';

import {
  RailWebhookVerificationError,
  type AcceptedTransfer,
  type RailAdapter,
  type RailJsonObject,
  type RailProbe,
  type RailWebhookHeaders,
  type TransferInstruction,
  type VerifiedRailEvent,
} from '../port.ts';
import {
  decodeRailMac,
  railConcatBytes,
  railDecimalInteger,
  railUtf8,
  singleRailHeader,
  verifyRailWebhook,
  type PresentedRailSignature,
  type RailEventIdentity,
  type RailWebhookScheme,
} from '../webhook.ts';

/** The three headers this rail sends. Separate, which is the shape with a nonce. */
export const RAIL_TIMESTAMP_HEADER = 'rail-timestamp';
export const RAIL_NONCE_HEADER = 'rail-nonce';
export const RAIL_SIGNATURE_HEADER = 'rail-signature';

/** Injected, because nothing in this package reads a clock of its own. */
export type Clock = () => Date;

export interface SandboxRailOptions {
  /** The shared secret. A fake still holds a real one and really MACs with it. */
  readonly secret: string;
  readonly clock: Clock;
  /** What `health()` reports. Settable so a test can drive a stalled rail. */
  readonly reachable?: boolean;
  readonly latencyMs?: number;
}

/** The bytes and headers one delivery is made of. */
export interface SignedRailDelivery {
  readonly raw: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
  /** The event id inside, so a caller can drive `retry` without re-parsing. */
  readonly eventId: string;
}

/** What `deliver` is asked to emit. The rail side of the fake. */
export interface RailDeliveryRequest {
  readonly eventId: string;
  readonly providerTransferId: string;
  readonly eventType: string;
  readonly data?: RailJsonObject;
  /** Defaults to the clock. Overridden to drive the freshness window. */
  readonly timestampEpochSeconds?: number;
  /** Defaults to a counter. Overridden to drive the replay control. */
  readonly nonce?: string;
}

/**
 * The bytes this rail signs: `"<timestamp>\n<nonce>\n"` and then the body.
 *
 * THE NONCE IS INSIDE THE DIGEST, which is the port's one requirement of a
 * scheme's placement. A nonce a MAC did not span is a nonce an attacker edits.
 */
function sandboxSignedBytes(timestamp: string, nonce: string, raw: Uint8Array): Uint8Array {
  return railConcatBytes(railUtf8(`${timestamp}\n${nonce}\n`), raw);
}

/** The vendor's half: three headers, base64, and the nonce out of band. */
const SANDBOX_SCHEME: RailWebhookScheme = {
  provider: 'rise',

  presentedSignature(raw: Uint8Array, headers: RailWebhookHeaders): PresentedRailSignature {
    const timestamp = singleRailHeader(headers, RAIL_TIMESTAMP_HEADER, 'rise', raw);
    const nonce = singleRailHeader(headers, RAIL_NONCE_HEADER, 'rise', raw);
    const signature = singleRailHeader(headers, RAIL_SIGNATURE_HEADER, 'rise', raw);

    if (nonce.length === 0) {
      throw new RailWebhookVerificationError('rise', 'signature_malformed', raw, 'empty nonce');
    }

    return {
      signedBytes: sandboxSignedBytes(timestamp, nonce, raw),
      mac: decodeRailMac(signature, 'base64', 'rise', raw),
      timestampEpochSeconds: railDecimalInteger(timestamp, 'rise', raw, 'timestamp'),
      headerNonce: nonce,
    };
  },

  eventIdentity(
    payload: RailJsonObject,
    presented: PresentedRailSignature,
  ): RailEventIdentity | null {
    const eventId = payload['event_id'];
    const transferId = payload['transfer_id'];
    const eventName = payload['event_name'];
    const nonce = presented.headerNonce;
    if (typeof eventId !== 'string' || eventId.length === 0) return null;
    // HALF THE ANCHOR IS MISSING AND THAT IS A REFUSAL. API_CONTRACT section 10
    // anchors this endpoint on "provider_transfer_id plus event id", so a
    // verified payload naming no transfer leaves a receiver nothing to attach an
    // outcome to.
    if (typeof transferId !== 'string' || transferId.length === 0) return null;
    if (typeof eventName !== 'string' || eventName.length === 0) return null;
    if (nonce === undefined || nonce.length === 0) return null;
    return {
      providerEventId: eventId,
      providerTransferId: transferId,
      eventType: eventName,
      nonce,
    };
  },
};

/**
 * The sandbox rail. Deterministic: no clock of its own, no randomness, and every
 * identifier it mints is a counter and its inputs.
 */
export class SandboxRail implements RailAdapter {
  readonly provider = 'rise' as const;

  readonly #secret: string;
  readonly #clock: Clock;
  /** approval key to the transfer it bought. `INV-M5-06`, as a `Map`. */
  readonly #transfers = new Map<string, AcceptedTransfer>();
  /** Every delivery emitted, so `redeliver` can replay a real capture. */
  readonly #sent = new Map<string, SignedRailDelivery>();
  #counter = 0;

  /** Mutable so a test can take the rail down and watch a caller notice. */
  reachable: boolean;
  latencyMs: number;

  constructor(options: SandboxRailOptions) {
    this.#secret = options.secret;
    this.#clock = options.clock;
    this.reachable = options.reachable ?? true;
    this.latencyMs = options.latencyMs ?? 37;
  }

  /**
   * IDEMPOTENT ON THE APPROVAL KEY, WHICH IS A PROMISE OF THE PORT rather than a
   * convenience of this fake. `INV-M5-06`: the same key on every attempt. Every
   * re-enqueue of a key returns the transfer that key already bought, and the
   * counter does not move, which is what a caller asserts to prove no second
   * transfer was minted.
   */
  enqueue(instruction: TransferInstruction): Promise<AcceptedTransfer> {
    const existing = this.#transfers.get(instruction.idempotencyKey);
    if (existing !== undefined) return Promise.resolve(existing);

    // Read but never returned. The fake proves the amount reaches it and the
    // TYPE proves where the amount came from: `transferAmountOf` is the only
    // producer and it takes a stored row.
    if (instruction.amountCents <= 0n) {
      return Promise.reject(new Error('rise: a transfer needs a positive amount'));
    }
    if (instruction.destinationRef.length === 0) {
      return Promise.reject(new Error('rise: a transfer needs a destination_ref'));
    }

    this.#counter += 1;
    const accepted: AcceptedTransfer = {
      provider: this.provider,
      providerTransferId: `rise_tr_${this.#counter}_${instruction.referenceId}`,
      status: 'queued',
      idempotencyKey: instruction.idempotencyKey,
    };
    this.#transfers.set(instruction.idempotencyKey, accepted);
    return Promise.resolve(accepted);
  }

  verifyWebhook(raw: Uint8Array, headers: RailWebhookHeaders): Promise<VerifiedRailEvent> {
    // `verifyRailWebhook` throws synchronously; the rejection is what the port
    // promises, so the throw is turned into one rather than escaping the async
    // boundary in a shape a `.catch` would miss.
    try {
      return Promise.resolve(
        verifyRailWebhook({
          scheme: SANDBOX_SCHEME,
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

  health(): Promise<RailProbe> {
    return Promise.resolve({
      provider: this.provider,
      reachable: this.reachable,
      latencyMs: this.latencyMs,
    });
  }

  /** How many transfers exist. A re-enqueue must not move this. */
  get transfersMinted(): number {
    return this.#transfers.size;
  }

  // ---------------------------------------------------------------------------
  // The rail side, which is what makes this a fake rather than a stub
  // ---------------------------------------------------------------------------

  /**
   * Emit a settlement webhook the way this rail would, signed with the same
   * secret.
   *
   * The body is serialised ONCE, here, and the bytes are what get signed. A
   * caller that re-serialises them before calling `verifyWebhook` gets a
   * refusal, which is `ADR-109` clause 7's prohibition made demonstrable: "two
   * JSON texts that parse equal serialise differently, so a re-encoded body is a
   * DIFFERENT DOCUMENT and its MAC will not verify".
   */
  deliver(request: RailDeliveryRequest): SignedRailDelivery {
    const timestamp = request.timestampEpochSeconds ?? Math.floor(this.#clock().getTime() / 1000);
    this.#counter += 1;
    const nonce = request.nonce ?? `rise_nonce_${this.#counter}`;
    const body: RailJsonObject = {
      event_id: request.eventId,
      transfer_id: request.providerTransferId,
      event_name: request.eventType,
      data: request.data ?? {},
    };
    const raw = railUtf8(JSON.stringify(body));
    const mac = createHmac('sha256', this.#secret)
      .update(sandboxSignedBytes(String(timestamp), nonce, raw))
      .digest('base64');
    const delivery: SignedRailDelivery = {
      raw,
      headers: {
        [RAIL_TIMESTAMP_HEADER]: String(timestamp),
        [RAIL_NONCE_HEADER]: nonce,
        [RAIL_SIGNATURE_HEADER]: mac,
      },
      eventId: request.eventId,
    };
    this.#sent.set(request.eventId, delivery);
    return delivery;
  }

  /**
   * Re-emit bytes ALREADY SENT, unchanged. This is a CAPTURE and not a retry.
   *
   * Nothing is re-signed and nothing is re-stamped, so the MAC verifies and, if
   * the clock has not moved past the window, the freshness check passes too. The
   * only control left standing is the nonce, which is the whole point of seeding
   * this: "a settlement delivered twice must settle once".
   */
  redeliver(eventId: string): SignedRailDelivery {
    const sent = this.#sent.get(eventId);
    if (sent === undefined) {
      throw new Error(`rise sandbox: nothing was ever delivered for event ${eventId}`);
    }
    return sent;
  }

  /**
   * Re-send the SAME EVENT as a real rail would when it did not hear the 200: a
   * fresh nonce, a fresh timestamp, a fresh signature, the same `event_id`.
   *
   * THIS ONE MUST NOT BE REFUSED. It is `duplicate_event`, it is answered 200,
   * and `replay.ts`'s header is about why telling it apart from `redeliver` is
   * the whole value of that file.
   */
  retry(request: RailDeliveryRequest): SignedRailDelivery {
    return this.deliver(request);
  }
}

/** Constructor function, for readability at a call site. */
export function createSandboxRail(options: SandboxRailOptions): SandboxRail {
  return new SandboxRail(options);
}
