// =============================================================================
// packages/psp/src/webhook.ts
// =============================================================================
// API_CONTRACT SECTION 10, WHICH IS THE HALF PEOPLE FORGET.
//
//   "All webhooks: HMAC signature verified BEFORE parsing, timestamp within a
//    5 minute window, nonce recorded for replay protection, raw payload stored,
//    processing idempotent on the provider event id, and a 200 returned for
//    duplicates so providers stop retrying."
//
// THE VERIFIER BELONGS TO THE PORT AND NOT TO A ROUTE, and the reason is a date
// rather than a preference: session 219 calls it BEFORE IT HAS PARSED ANYTHING,
// and a verifier that lives in a route handler is a verifier the next provider
// re-implements. Two implementations of one ordering rule is two chances to get
// the ordering wrong, and this one is the ordering the contract states in
// capitals.
//
// -----------------------------------------------------------------------------
// WHAT IS SHARED AND WHAT IS THE VENDOR'S, WHICH IS THE WHOLE DESIGN
// -----------------------------------------------------------------------------
// The two fakes in `fakes/` disagree about every mechanical detail: one signs
// `"<t>." + body` and sends hex in a single compound header, the other signs
// `"<t>\n<nonce>\n" + body` and sends base64 across three. Neither shape is
// invented -- they are the two shapes payment processors actually ship -- and
// writing both is what separated the vendor's mechanics from Merit's rule.
//
//   THE VENDOR'S:  which headers carry what, how the MAC is encoded, what bytes
//                  go into the digest, and which fields of the body are the
//                  event id and type. All of it is `HmacWebhookScheme`.
//   MERIT'S:       the ORDER. Digest first, then the freshness window, then and
//                  only then a parse. Plus constant-time comparison, plus the
//                  refusal to accept a repeated signature header, plus the rule
//                  that everything the caller ends up holding was covered by
//                  the MAC. All of it is `verifyHmacWebhook`, once.
//
// -----------------------------------------------------------------------------
// THE NONCE, AND THE FINDING THE SECOND FAKE PRODUCED
// -----------------------------------------------------------------------------
// Section 10 lists "nonce recorded for replay protection" beside "timestamp
// within a 5 minute window", which reads as though both are headers. ONE OF THE
// TWO REAL SHAPES HAS NO NONCE CHANNEL AT ALL. Writing the second fake against
// a port that demanded a nonce header would have forced that fake to invent
// one, and an invented nonce is a replay control that protects nothing.
//
// So the nonce is resolved with the EVENT IDENTITY, after the digest, and may
// come from a header (the three-header shape) or from the verified body (the
// compound-header shape, where the replay anchor is the provider event id --
// which is the same `(psp, provider_event_id)` unique index section 10 names as
// the idempotency anchor two lines later).
//
// WHAT IS REQUIRED IS NOT THAT THE NONCE BE A HEADER. IT IS THAT THE NONCE BE
// COVERED BY THE SIGNATURE, and both shapes satisfy that for different reasons:
// one because the MAC spans the nonce header, the other because the MAC spans
// the body the nonce is read out of. That invariant is the port's; where the
// bytes sit is the vendor's.
// =============================================================================

import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  WebhookVerificationError,
  type JsonObject,
  type PspId,
  type VerifiedEvent,
  type WebhookHeaders,
  type WebhookRefusal,
} from './port.ts';

/**
 * API_CONTRACT section 10's window, in seconds. Five minutes.
 *
 * It is a DEFAULT rather than a constant folded into the comparison, because a
 * provider that documents a different tolerance is a fact about that provider,
 * and the standing parameter ruling is that a value is config rather than a
 * literal. What is not negotiable is that the window is checked at all.
 */
export const WEBHOOK_WINDOW_SECONDS = 300;

/**
 * What the adapter pulled out of ITS headers, before anything has been trusted.
 *
 * `signedBytes` is the exact byte sequence the provider claims to have MAC'd.
 * Building it is the adapter's job precisely because every provider builds it
 * differently, and getting it wrong is not a security failure: it is a total
 * failure, because nothing will ever verify.
 */
export interface PresentedSignature {
  readonly signedBytes: Uint8Array;
  readonly mac: Uint8Array;
  readonly timestampEpochSeconds: number;
  /** Present when the provider carries a nonce out of band. Absent otherwise. */
  readonly headerNonce?: string;
}

/** The three fields read out of a body that has already verified. */
export interface EventIdentity {
  readonly providerEventId: string;
  readonly eventType: string;
  readonly nonce: string;
}

/**
 * The vendor's half. Two implementations of this interface exist, both fakes,
 * and a real provider is a third.
 */
export interface HmacWebhookScheme {
  readonly psp: PspId;
  /**
   * Pull the signed material out of this provider's headers.
   *
   * @throws {WebhookVerificationError} on a missing, repeated or malformed
   * header. It throws rather than returning a null so that the refusal reaches
   * the caller with the provider and the raw bytes already attached.
   */
  presentedSignature(raw: Uint8Array, headers: WebhookHeaders): PresentedSignature;
  /**
   * Name this provider's event id, event type and replay nonce, out of a body
   * that HAS ALREADY VERIFIED and out of the presented signature.
   *
   * Returns `null` when the body does not carry them, which the caller turns
   * into `event_identity_missing`. A verified payload that names no event is
   * still a refusal: `psp_webhook_events.provider_event_id` is `NOT NULL` and
   * it is half of the unique index that IS the idempotency guarantee.
   */
  eventIdentity(payload: JsonObject, presented: PresentedSignature): EventIdentity | null;
}

/** Arguments to the one verification path in this package. */
export interface VerifyHmacWebhookArgs {
  readonly scheme: HmacWebhookScheme;
  /** The shared secret for THIS provider. Never logged, never returned. */
  readonly secret: string;
  readonly raw: Uint8Array;
  readonly headers: WebhookHeaders;
  /** Injected. Nothing in this package reads a clock of its own. */
  readonly now: Date;
  readonly windowSeconds?: number;
}

/**
 * Verify, then check freshness, then parse. In that order, always.
 *
 * @throws {WebhookVerificationError} on every refusal. It never returns a
 * boolean and never returns a partially trusted object: M03 section 2.1, "a
 * boolean gets ignored".
 */
export function verifyHmacWebhook(args: VerifyHmacWebhookArgs): VerifiedEvent {
  const { scheme, secret, raw, headers, now } = args;
  const windowSeconds = args.windowSeconds ?? WEBHOOK_WINDOW_SECONDS;
  // A FUNCTION DECLARATION AND NOT A `const` ARROW, and the difference is not
  // style: TypeScript applies never-returning narrowing only to a call whose
  // callee has an explicit return type it can see, so as an arrow the compiler
  // would keep treating every line after a refusal as reachable.
  function refuse(refusal: WebhookRefusal, detail?: string): never {
    throw new WebhookVerificationError(scheme.psp, refusal, raw, detail);
  }

  // 1. THE VENDOR'S EXTRACTION. It throws its own WebhookVerificationError for
  //    a missing, repeated or malformed header, which is why this call is not
  //    wrapped: a refusal from in there is already the right shape.
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

  // 3. THE FRESHNESS WINDOW, and it is checked in BOTH DIRECTIONS. A payload
  //    stamped far in the future would otherwise be a capture that never
  //    expires, which is the replay this control exists to bound.
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
  //    `fatal: true` matters: without it invalid UTF-8 is silently replaced
  //    with U+FFFD and a malformed body becomes a parseable one.
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
  const payload = parsed as JsonObject;

  const identity = scheme.eventIdentity(payload, presented);
  if (identity === null) {
    refuse('event_identity_missing');
  }

  return {
    psp: scheme.psp,
    providerEventId: identity.providerEventId,
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
 * @throws {WebhookVerificationError} `signature_header_missing` or
 * `signature_header_repeated`.
 */
export function singleHeader(
  headers: WebhookHeaders,
  name: string,
  psp: PspId,
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
    throw new WebhookVerificationError(psp, 'signature_header_missing', raw, name);
  }
  if (found.length > 1) {
    throw new WebhookVerificationError(
      psp,
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
    throw new WebhookVerificationError(psp, 'signature_header_missing', raw, name);
  }
  return only;
}

/** The bytes of a UTF-8 string, which is what every scheme here signs over. */
export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Concatenate byte runs, because a signed payload is a prefix plus a body. */
export function concatBytes(...runs: readonly Uint8Array[]): Uint8Array {
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
 * SHORT BUFFER rather than throwing, so a garbage signature would arrive here
 * as a valid-looking two-byte MAC and be compared. The shape is checked first.
 *
 * @throws {WebhookVerificationError} `signature_malformed`.
 */
export function decodeMac(
  encoded: string,
  encoding: 'hex' | 'base64',
  psp: PspId,
  raw: Uint8Array,
): Uint8Array {
  const ok =
    encoding === 'hex'
      ? /^[0-9a-fA-F]+$/.test(encoded) && encoded.length % 2 === 0
      : /^[A-Za-z0-9+/]+={0,2}$/.test(encoded) && encoded.length % 4 === 0;
  if (!ok || encoded.length === 0) {
    throw new WebhookVerificationError(psp, 'signature_malformed', raw, `not ${encoding}`);
  }
  return new Uint8Array(Buffer.from(encoded, encoding));
}

/**
 * Parse a decimal integer that must be exactly that: `Number.parseInt` accepts
 * `"12abc"` and returns 12, which on a timestamp is a silently wrong window.
 *
 * @throws {WebhookVerificationError} `signature_malformed`.
 */
export function decimalInteger(s: string, psp: PspId, raw: Uint8Array, what: string): number {
  if (!/^-?\d+$/.test(s)) {
    throw new WebhookVerificationError(
      psp,
      'signature_malformed',
      raw,
      `${what} is not an integer`,
    );
  }
  return Number(s);
}
