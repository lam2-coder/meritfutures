// =============================================================================
// packages/kyc/src/webhook.ts
// =============================================================================
// API_CONTRACT SECTION 10, WHICH IS ONE RULE FOR EVERY INBOUND WEBHOOK:
//
//   "All webhooks: HMAC signature verified BEFORE parsing, timestamp within a
//    5 minute window, nonce recorded for replay protection, raw payload stored,
//    processing idempotent on the provider event id, and a 200 returned for
//    duplicates so providers stop retrying."
//
// THIS IS THE SECOND IMPLEMENTATION OF THAT ONE RULE IN THIS WORKSPACE AND THE
// DUPLICATION IS FORCED BY A TYPE. `packages/psp/src/webhook.ts` holds the
// first. Its `HmacWebhookScheme` declares `readonly psp: PspId`, and `PspId` is
// closed at `'psp_a' | 'psp_b'` by a CHECK on `purchases.psp`, so calling it
// from an identity path would mean writing a payment provider's id into a KYC
// verification. There is no honest value to pass.
//
// SO THE TWO ARE BOUND RATHER THAN MERGED. `test/webhook-bind.test.ts` READS
// `packages/psp/src/webhook.ts` and asserts that the refusal vocabulary matches
// member for member and that the ordering steps appear in the same order in
// both files. That is `packages/ledger`'s own remedy for the same hazard: when
// a package cannot import the statement it must agree with, its suite reads it.
// ADR-114 section 4 records what would end the duplication, which is a neutral
// package neither provider set brands, and why that is not this slice's.
//
// -----------------------------------------------------------------------------
// WHAT IS THE VENDOR'S AND WHAT IS MERIT'S
// -----------------------------------------------------------------------------
//   THE VENDOR'S:  which headers carry what, how the MAC is encoded, what bytes
//                  go into the digest, and which fields of the body are the
//                  event id, the applicant id, the outcome and the liveness
//                  result. All of it is `KycWebhookScheme`.
//   MERIT'S:       the ORDER. Digest first, then the freshness window, then and
//                  only then a parse. Plus constant-time comparison, plus the
//                  refusal to accept a repeated signature header, plus the rule
//                  that everything the caller ends up holding was covered by
//                  the MAC. All of it is `verifyKycWebhook`, once.
//
// THE APPLICANT ID IS PART OF THE EVENT IDENTITY HERE AND IS NOT IN THE PSP
// SHAPE, and that is API_CONTRACT section 10's own table rather than a local
// choice: the PSP row anchors on `(psp, provider_event_id)` and the KYC row
// anchors on "`provider_applicant_id` plus event id". A verified payload that
// names no applicant is `event_identity_missing`, because half of the anchor is
// missing and the receiver would have nothing to attach the outcome to.
// =============================================================================

import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  KycWebhookVerificationError,
  type JsonObject,
  type KycOutcome,
  type KycWebhookHeaders,
  type KycWebhookRefusal,
  type VerifiedKycEvent,
} from './port.ts';

/**
 * API_CONTRACT section 10's window, in seconds. Five minutes.
 *
 * A DEFAULT rather than a constant folded into the comparison, because a
 * provider that documents a different tolerance is a fact about that provider.
 * What is not negotiable is that the window is checked at all.
 */
export const KYC_WEBHOOK_WINDOW_SECONDS = 300;

/**
 * What the adapter pulled out of ITS headers, before anything has been trusted.
 *
 * `signedBytes` is the exact byte sequence the provider claims to have MAC'd.
 * Building it is the adapter's job precisely because every provider builds it
 * differently, and getting it wrong is not a security failure: it is a TOTAL
 * failure, because nothing will ever verify.
 */
export interface KycPresentedSignature {
  readonly signedBytes: Uint8Array;
  readonly mac: Uint8Array;
  readonly timestampEpochSeconds: number;
  /** Present when the provider carries a nonce out of band. Absent otherwise. */
  readonly headerNonce?: string;
}

/** What is read out of a body that has ALREADY verified. */
export interface KycEventIdentity {
  readonly providerEventId: string;
  /** API_CONTRACT section 10's other half of this endpoint's anchor. */
  readonly providerApplicantId: string;
  readonly eventType: string;
  readonly outcome: KycOutcome;
  readonly nonce: string;
  readonly livenessPassed: boolean | null;
  readonly livenessMethod: string | null;
  readonly providerRejectionCode: string | null;
}

/**
 * The vendor's half. One implementation exists, a fake, and a real provider is
 * a second.
 */
export interface KycWebhookScheme {
  readonly provider: string;
  /**
   * Pull the signed material out of this provider's headers.
   *
   * @throws {KycWebhookVerificationError} on a missing, repeated or malformed
   * header. It throws rather than returning a null so the refusal reaches the
   * caller with the provider and the raw bytes already attached.
   */
  presentedSignature(raw: Uint8Array, headers: KycWebhookHeaders): KycPresentedSignature;
  /**
   * Name this provider's event, applicant, outcome and replay nonce, out of a
   * body that HAS ALREADY VERIFIED.
   *
   * Returns `null` when the body does not carry them, which the caller turns
   * into `event_identity_missing`.
   */
  eventIdentity(payload: JsonObject, presented: KycPresentedSignature): KycEventIdentity | null;
}

/** Arguments to the one verification path in this package. */
export interface VerifyKycWebhookArgs {
  readonly scheme: KycWebhookScheme;
  /** The shared secret for THIS provider. Never logged, never returned. */
  readonly secret: string;
  readonly raw: Uint8Array;
  readonly headers: KycWebhookHeaders;
  /** Injected. Nothing in this package reads a clock of its own. */
  readonly now: Date;
  readonly windowSeconds?: number;
}

/**
 * Verify, then check freshness, then parse. In that order, always.
 *
 * @throws {KycWebhookVerificationError} on every refusal. It never returns a
 * boolean and never returns a partially trusted object.
 */
export function verifyKycWebhook(args: VerifyKycWebhookArgs): VerifiedKycEvent {
  const { scheme, secret, raw, headers, now } = args;
  const windowSeconds = args.windowSeconds ?? KYC_WEBHOOK_WINDOW_SECONDS;
  // A FUNCTION DECLARATION AND NOT A `const` ARROW: TypeScript applies
  // never-returning narrowing only to a call whose callee has an explicit
  // return type it can see.
  function refuse(refusal: KycWebhookRefusal, detail?: string): never {
    throw new KycWebhookVerificationError(scheme.provider, refusal, raw, detail);
  }

  // 1. THE VENDOR'S EXTRACTION. It throws its own KycWebhookVerificationError
  //    for a missing, repeated or malformed header, which is why this call is
  //    not wrapped: a refusal from in there is already the right shape.
  const presented = scheme.presentedSignature(raw, headers);

  // 2. THE DIGEST, BEFORE ANYTHING ELSE IS LOOKED AT. Not before the freshness
  //    check as a matter of taste: an attacker controls the timestamp bytes, so
  //    a window check that ran first would let an unauthenticated party choose
  //    which branch of this function executes.
  const expected = createHmac('sha256', secret).update(presented.signedBytes).digest();

  // `timingSafeEqual` THROWS on a length mismatch rather than returning false,
  // so the length is compared first. A digest length is not a secret.
  if (presented.mac.length !== expected.length) {
    refuse(
      'signature_mismatch',
      `presented ${presented.mac.length} bytes, expected ${expected.length}`,
    );
  }
  if (!timingSafeEqual(presented.mac, expected)) {
    refuse('signature_mismatch');
  }

  // 3. THE FRESHNESS WINDOW, checked in BOTH DIRECTIONS. A payload stamped far
  //    in the future would otherwise be a capture that never expires.
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
    provider: scheme.provider,
    providerEventId: identity.providerEventId,
    providerApplicantId: identity.providerApplicantId,
    eventType: identity.eventType,
    outcome: identity.outcome,
    nonce: identity.nonce,
    timestampEpochSeconds: presented.timestampEpochSeconds,
    livenessPassed: identity.livenessPassed,
    livenessMethod: identity.livenessMethod,
    providerRejectionCode: identity.providerRejectionCode,
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
 * closed refusal set rather than folded into `signature_malformed`.
 *
 * @throws {KycWebhookVerificationError}
 */
export function singleKycHeader(
  headers: KycWebhookHeaders,
  name: string,
  provider: string,
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
    throw new KycWebhookVerificationError(provider, 'signature_header_missing', raw, name);
  }
  if (found.length > 1) {
    throw new KycWebhookVerificationError(
      provider,
      'signature_header_repeated',
      raw,
      `${name} x${found.length}`,
    );
  }
  const only = found[0];
  if (only === undefined) {
    throw new KycWebhookVerificationError(provider, 'signature_header_missing', raw, name);
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
 * @throws {KycWebhookVerificationError} `signature_malformed`.
 */
export function decodeKycMac(
  encoded: string,
  encoding: 'hex' | 'base64',
  provider: string,
  raw: Uint8Array,
): Uint8Array {
  const ok =
    encoding === 'hex'
      ? /^[0-9a-fA-F]+$/.test(encoded) && encoded.length % 2 === 0
      : /^[A-Za-z0-9+/]+={0,2}$/.test(encoded) && encoded.length % 4 === 0;
  if (!ok || encoded.length === 0) {
    throw new KycWebhookVerificationError(provider, 'signature_malformed', raw, `not ${encoding}`);
  }
  return new Uint8Array(Buffer.from(encoded, encoding));
}

/**
 * Parse a decimal integer that must be exactly that: `Number.parseInt` accepts
 * `"12abc"` and returns 12, which on a timestamp is a silently wrong window.
 *
 * @throws {KycWebhookVerificationError} `signature_malformed`.
 */
export function decimalInteger(s: string, provider: string, raw: Uint8Array, what: string): number {
  if (!/^-?\d+$/.test(s)) {
    throw new KycWebhookVerificationError(
      provider,
      'signature_malformed',
      raw,
      `${what} is not an integer`,
    );
  }
  return Number(s);
}
