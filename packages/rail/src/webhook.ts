// =============================================================================
// packages/rail/src/webhook.ts
// =============================================================================
// API_CONTRACT SECTION 10, WHICH IS ONE RULE FOR EVERY INBOUND WEBHOOK:
//
//   "All webhooks: HMAC signature verified BEFORE parsing, timestamp within a
//    5 minute window, nonce recorded for replay protection, raw payload stored,
//    processing idempotent on the provider event id, and a 200 returned for
//    duplicates so providers stop retrying."
//
// and one ROW for this one, which differs from the PSP's in its own words:
//
//   | POST /webhooks/rise | Rise | HMAC plus timestamp and nonce |
//   | `provider_transfer_id` plus event id |
//
// THE VERIFIER BELONGS TO THE PORT AND NOT TO A ROUTE (ADR-105): "a verifier
// that lives in a route handler is a verifier the next provider re-implements".
//
// -----------------------------------------------------------------------------
// WHAT IS THE VENDOR'S AND WHAT IS MERIT'S, WHICH IS THE WHOLE DESIGN
// -----------------------------------------------------------------------------
//   THE VENDOR'S:  which headers carry what, how the MAC is encoded, what bytes
//                  go into the digest, and which fields of the body are the
//                  event id, the transfer id, the type and the nonce. All of it
//                  is `RailWebhookScheme`.
//   MERIT'S:       the ORDER. Digest first, then the freshness window, then and
//                  only then a parse. Plus constant-time comparison, plus the
//                  refusal to accept a repeated signature header, plus the rule
//                  that everything the caller ends up holding was covered by the
//                  MAC. All of it is `verifyRailWebhook`, once.
//
// -----------------------------------------------------------------------------
// THE NONCE IS REQUIRED HERE AND OPTIONAL ONE RAIL OVER, AND THE DIFFERENCE IS
// THE CONTRACT'S OWN
// -----------------------------------------------------------------------------
// `packages/psp/src/webhook.ts` resolves the nonce WITH the event identity and
// permits it to be the event id, because one of the two real card-processor
// shapes it modelled has no nonce channel at all and "an invented nonce is a
// replay control that protects nothing". That reasoning is about THAT rail.
//
// This row names a nonce, so `RailEventIdentity.nonce` is not optional. WHERE
// THE BYTES SIT IS STILL THE VENDOR'S -- a header the MAC spans, or a body field
// the MAC spans -- and what is required is that the nonce be COVERED BY THE
// SIGNATURE. Both spellings satisfy that, for different reasons, and the port
// holds the invariant while the scheme holds the placement.
//
// THE NONCE IS NOT WHERE REPLAY IS REFUSED. It is what a refusal is keyed on.
// `replay.ts` holds the refusal, and it is a separate file because a verifier
// that also remembered would be a verifier holding state, and the one thing
// every consumer of this package needs is that verification is a pure function
// of (bytes, headers, secret, clock).
// =============================================================================

import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  RailWebhookVerificationError,
  type RailJsonObject,
  type RailProviderId,
  type RailWebhookHeaders,
  type RailWebhookRefusal,
  type VerifiedRailEvent,
} from './port.ts';

/**
 * API_CONTRACT section 10's window, in seconds. Five minutes.
 *
 * It is a DEFAULT rather than a constant folded into the comparison, because a
 * rail that documents a different tolerance is a fact about that rail, and the
 * standing parameter ruling is that a value is config rather than a literal.
 * What is not negotiable is that the window is checked at all.
 */
export const RAIL_WEBHOOK_WINDOW_SECONDS = 300;

/**
 * What the adapter pulled out of ITS headers, before anything has been trusted.
 *
 * `signedBytes` is the exact byte sequence the rail claims to have MAC'd.
 * Building it is the adapter's job precisely because every provider builds it
 * differently, and getting it wrong is not a security failure: it is a total
 * failure, because nothing will ever verify.
 */
export interface PresentedRailSignature {
  readonly signedBytes: Uint8Array;
  readonly mac: Uint8Array;
  readonly timestampEpochSeconds: number;
  /** Present when the rail carries a nonce out of band. Absent otherwise. */
  readonly headerNonce?: string;
}

/**
 * The four fields read out of a body that has already verified.
 *
 * FOUR AND NOT THREE, and the fourth is `providerTransferId`. API_CONTRACT
 * section 10's anchor for this endpoint is "`provider_transfer_id` plus event
 * id" where the PSP row's is `(psp, provider_event_id)`, so a verified payload
 * that names no transfer is `event_identity_missing`: half the anchor is
 * missing and a receiver would have nothing to attach the outcome to.
 */
export interface RailEventIdentity {
  readonly providerEventId: string;
  readonly providerTransferId: string;
  readonly eventType: string;
  readonly nonce: string;
}

/**
 * The vendor's half. One implementation exists, a fake, and a real rail is a
 * second.
 *
 * ONE FAKE AND NOT TWO, AND THE DIFFERENCE FROM `packages/psp` IS ARGUED RATHER
 * THAN INHERITED. That package wrote two because "a port with one fake is a port
 * shaped like that fake", and it had two real card-processor shapes to model and
 * a `PspId` with two members because the firm holds two MIDs (`INV-M3-11`,
 * `RB-03`). This rail has ONE provider in every document that names one, one
 * value in `payout_transfers.provider`'s DEFAULT, and no second-MID ruling.
 * WHAT THAT COSTS IS STATED RATHER THAN HIDDEN: this interface is at risk of
 * being shaped like its one fake, and the mitigation is that its SHAPE is
 * `HmacWebhookScheme`'s, which was already forced apart by two disagreeing
 * implementations one rail over. `test/psp-shape-bind.test.ts` is what holds
 * that claim to the file it is a claim about.
 */
export interface RailWebhookScheme {
  readonly provider: RailProviderId;
  /**
   * Pull the signed material out of this rail's headers.
   *
   * @throws {RailWebhookVerificationError} on a missing, repeated or malformed
   * header. It throws rather than returning a null so that the refusal reaches
   * the caller with the provider and the raw bytes already attached.
   */
  presentedSignature(raw: Uint8Array, headers: RailWebhookHeaders): PresentedRailSignature;
  /**
   * Name this rail's event id, transfer id, event type and replay nonce, out of
   * a body that HAS ALREADY VERIFIED and out of the presented signature.
   *
   * Returns `null` when the body does not carry them, which the caller turns
   * into `event_identity_missing`.
   */
  eventIdentity(
    payload: RailJsonObject,
    presented: PresentedRailSignature,
  ): RailEventIdentity | null;
}

/** Arguments to the one verification path in this package. */
export interface VerifyRailWebhookArgs {
  readonly scheme: RailWebhookScheme;
  /** The shared secret for THIS rail. Never logged, never returned. */
  readonly secret: string;
  readonly raw: Uint8Array;
  readonly headers: RailWebhookHeaders;
  /** Injected. Nothing in this package reads a clock of its own. */
  readonly now: Date;
  readonly windowSeconds?: number;
}

/**
 * Verify, then check freshness, then parse. In that order, always.
 *
 * @throws {RailWebhookVerificationError} on every refusal. It never returns a
 * boolean and never returns a partially trusted object.
 */
export function verifyRailWebhook(args: VerifyRailWebhookArgs): VerifiedRailEvent {
  const { scheme, secret, raw, headers, now } = args;
  const windowSeconds = args.windowSeconds ?? RAIL_WEBHOOK_WINDOW_SECONDS;
  // A FUNCTION DECLARATION AND NOT A `const` ARROW, and the difference is not
  // style: TypeScript applies never-returning narrowing only to a call whose
  // callee has an explicit return type it can see, so as an arrow the compiler
  // would keep treating every line after a refusal as reachable.
  function refuse(refusal: RailWebhookRefusal, detail?: string): never {
    throw new RailWebhookVerificationError(scheme.provider, refusal, raw, detail);
  }

  // 1. THE VENDOR'S EXTRACTION. It throws its own RailWebhookVerificationError
  //    for a missing, repeated or malformed header, which is why this call is
  //    not wrapped: a refusal from in there is already the right shape.
  const presented = scheme.presentedSignature(raw, headers);

  // 2. THE DIGEST, BEFORE ANYTHING ELSE IS LOOKED AT. Not before the freshness
  //    check as a matter of taste: an attacker controls the timestamp bytes, so
  //    a window check that ran first would let an unauthenticated party choose
  //    which branch of this function executes.
  const expected = createHmac('sha256', secret).update(presented.signedBytes).digest();

  // `timingSafeEqual` THROWS on a length mismatch rather than returning false,
  // so the length is compared first. A digest length is not a secret: it is a
  // property of SHA-256 and is the same for every request.
  if (presented.mac.length !== expected.length) {
    refuse(
      'signature_mismatch',
      `presented ${presented.mac.length} bytes, expected ${expected.length}`,
    );
  }
  if (!timingSafeEqual(presented.mac, expected)) {
    refuse('signature_mismatch');
  }

  // 3. THE FRESHNESS WINDOW, AND IT IS CHECKED IN BOTH DIRECTIONS. A payload
  //    stamped far in the future would otherwise be a capture that never
  //    expires, which is the replay this control exists to bound. On a
  //    settlement rail that is the difference between a captured delivery that
  //    goes stale in five minutes and one that can be presented next year.
  const nowEpochSeconds = Math.floor(now.getTime() / 1000);
  const skew = Math.abs(nowEpochSeconds - presented.timestampEpochSeconds);
  if (!Number.isFinite(skew) || skew > windowSeconds) {
    refuse(
      'timestamp_outside_window',
      `${skew}s from now, window is ${windowSeconds}s (API_CONTRACT section 10)`,
    );
  }

  // 4. AND ONLY NOW A PARSE. Everything below this line is bytes the digest
  //    already agreed to.
  //
  //    `fatal: true` matters: without it invalid UTF-8 is silently replaced with
  //    U+FFFD and a malformed body becomes a parseable one.
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    refuse('payload_not_json_object', 'body is not valid UTF-8');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    refuse('payload_not_json_object', 'body is not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    refuse('payload_not_json_object', 'top-level JSON value is not an object');
  }
  const payload = parsed as RailJsonObject;

  const identity = scheme.eventIdentity(payload, presented);
  if (identity === null) {
    refuse('event_identity_missing');
  }

  return {
    provider: scheme.provider,
    providerEventId: identity.providerEventId,
    providerTransferId: identity.providerTransferId,
    eventType: identity.eventType,
    nonce: identity.nonce,
    timestampEpochSeconds: presented.timestampEpochSeconds,
    raw,
    payload,
  };
}

// -----------------------------------------------------------------------------
// Header reading, shared because getting it wrong is shared
// -----------------------------------------------------------------------------

/**
 * Read exactly one header value, case-insensitively, and REFUSE A REPEAT.
 *
 * A Node HTTP server collects repeated headers into an array. Taking `[0]` out
 * of that array is how a proxy and an origin end up disagreeing about which
 * signature was checked, so this refuses instead, with its own member of the
 * closed refusal set rather than folded into `signature_malformed`: an operator
 * reading a security event needs to be able to tell a broken integration from
 * somebody probing one.
 *
 * @throws {RailWebhookVerificationError} `signature_header_missing` or
 * `signature_header_repeated`.
 */
export function singleRailHeader(
  headers: RailWebhookHeaders,
  name: string,
  provider: RailProviderId,
  raw: Uint8Array,
): string {
  const wanted = name.toLowerCase();
  const found: string[] = [];
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    const value = headers[key];
    if (value === undefined) continue;
    if (typeof value === 'string') found.push(value);
    else found.push(...value);
  }
  if (found.length === 0) {
    throw new RailWebhookVerificationError(provider, 'signature_header_missing', raw, name);
  }
  if (found.length > 1) {
    throw new RailWebhookVerificationError(
      provider,
      'signature_header_repeated',
      raw,
      `${name} x${found.length}`,
    );
  }
  // `found[0]` is `string | undefined` under noUncheckedIndexedAccess and the
  // length check above is not something the compiler tracks, so it is narrowed
  // rather than asserted.
  const only = found[0];
  if (only === undefined) {
    throw new RailWebhookVerificationError(provider, 'signature_header_missing', raw, name);
  }
  return only;
}

/** The bytes of a UTF-8 string, which is what every scheme here signs over. */
export function railUtf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Concatenate byte runs, because a signed payload is a prefix plus a body. */
export function railConcatBytes(...runs: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const run of runs) total += run.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const run of runs) {
    out.set(run, at);
    at += run.length;
  }
  return out;
}

/**
 * Decode a hex or base64 MAC, refusing anything that is not exactly that.
 *
 * `Buffer.from(s, 'hex')` STOPS AT THE FIRST INVALID CHARACTER AND RETURNS A
 * SHORT BUFFER rather than throwing, so a garbage signature would arrive here as
 * a valid-looking two-byte MAC and be compared. The shape is checked first.
 *
 * @throws {RailWebhookVerificationError} `signature_malformed`.
 */
export function decodeRailMac(
  encoded: string,
  encoding: 'hex' | 'base64',
  provider: RailProviderId,
  raw: Uint8Array,
): Uint8Array {
  const ok =
    encoding === 'hex'
      ? /^[0-9a-fA-F]+$/.test(encoded) && encoded.length % 2 === 0
      : /^[A-Za-z0-9+/]+={0,2}$/.test(encoded) && encoded.length % 4 === 0;
  if (!ok || encoded.length === 0) {
    throw new RailWebhookVerificationError(provider, 'signature_malformed', raw, `not ${encoding}`);
  }
  return new Uint8Array(Buffer.from(encoded, encoding));
}

/**
 * Parse a decimal integer that must be exactly that: `Number.parseInt` accepts
 * `"12abc"` and returns 12, which on a timestamp is a silently wrong window.
 *
 * @throws {RailWebhookVerificationError} `signature_malformed`.
 */
export function railDecimalInteger(
  s: string,
  provider: RailProviderId,
  raw: Uint8Array,
  what: string,
): number {
  if (!/^-?\d+$/.test(s)) {
    throw new RailWebhookVerificationError(
      provider,
      'signature_malformed',
      raw,
      `${what} is not an integer`,
    );
  }
  return Number(s);
}
