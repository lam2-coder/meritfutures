// =============================================================================
// apps/api/src/rise-webhook.ts
// =============================================================================
// THE RISE WEBHOOK PORT. A NEW PORT, SAID LOUDLY, WITH THE REASON IT IS A THIRD
// ONE AND NOT A REUSE OF EITHER EXISTING ONE.
//
// API_CONTRACT section 10 states ONE rule for every inbound webhook:
//
//   "All webhooks: HMAC signature verified BEFORE parsing, timestamp within a
//    5 minute window, nonce recorded for replay protection, raw payload stored,
//    processing idempotent on the provider event id, and a 200 returned for
//    duplicates so providers stop retrying."
//
// ADR-105 states where that rule lives: "THE VERIFIER BELONGS TO THE PORT AND
// NOT TO A ROUTE ... a verifier that lives in a route handler is a verifier the
// next provider re-implements." `POST /webhooks/rise` IS the next provider, so
// this file exists rather than a block inside `routes/webhooks-rise.ts`.
//
// -----------------------------------------------------------------------------
// THIS IS THE THIRD IMPLEMENTATION OF ONE ORDERING RULE, AND IT IS FORCED
// -----------------------------------------------------------------------------
// `packages/psp/src/webhook.ts` holds the first. Its `HmacWebhookScheme`
// declares `readonly psp: PspId`, and `PspId` is closed at `'psp_a' | 'psp_b'`
// by a CHECK on `purchases.psp`, so calling it from the PAYOUT rail would mean
// writing a payment processor's id into a transfer. There is no honest value to
// pass. `packages/kyc/src/webhook.ts` holds the second and its own header
// records the same finding one path over.
//
// ADR-114 section 4 already ruled what would end the duplication and why it was
// not taken: "WHAT WOULD END THE DUPLICATION IS A THIRD PACKAGE NEITHER PROVIDER
// SET BRANDS ... a new package that `apps/api` consumes forces an edit to
// `apps/api/package.json` and `pnpm-lock.yaml` ... Lifting it is a slice with
// two consumers already written, which is the cheapest moment to do it and is
// not this moment."
//
// THAT CONDITION HAS NOT ARRIVED, IT HAS RECEDED. There are now three consumers
// rather than two, and EIGHT route sessions are in flight against this tree
// rather than three, so the manifest and the lockfile are a worse write
// collision today than they were when the deferral was taken. The lift is
// therefore still not taken and the debt is now recorded with a count. ADR-146
// section 3.
//
// -----------------------------------------------------------------------------
// IT IS A FILE IN `apps/api/src` AND NOT A PACKAGE, ON `@merit/kyc`'s OWN TEST
// -----------------------------------------------------------------------------
// `packages/kyc/package.json` states why that package is a package: "IT IS A
// PACKAGE AND NOT TWO ROUTE FILES BECAUSE THE WORKER NEEDS IT." Apply the same
// test here and it answers the other way. Nothing outside `apps/api` receives an
// inbound Rise webhook: `apps/worker` SENDS transfers, and the outbound half of
// the Rise rail is `POST /accounts/:id/payout`'s and M05's, not this file's. A
// package would buy a manifest edit, a lockfile edit and an `RI-08` surface for
// a capability with exactly one consumer.
//
// `apps/api/src/idempotency.ts` is the precedent and it is ADR-109 clause 3's:
// when a construction is needed and a package dependency is the expensive half,
// the port is declared inside this deployable and the absence stays a fact
// somebody can grep. `test/rise-webhook-bind.test.ts` is what keeps this file
// and `packages/psp/src/webhook.ts` in agreement, which is `packages/ledger`'s
// remedy for the same hazard: when a module cannot import the statement it must
// agree with, its suite reads it.
//
// -----------------------------------------------------------------------------
// WHAT IS THE VENDOR'S AND WHAT IS MERIT'S
// -----------------------------------------------------------------------------
//   THE VENDOR'S:  which headers carry what, how the MAC is encoded, what bytes
//                  go into the digest, and which fields of the body are the
//                  event id, the transfer id, the type and the nonce. All of it
//                  is `RiseWebhookScheme`.
//   MERIT'S:       the ORDER. Digest first, then the freshness window, then and
//                  only then a parse. Plus constant-time comparison, plus the
//                  refusal to accept a repeated signature header, plus the rule
//                  that everything the caller ends up holding was covered by the
//                  MAC. All of it is `verifyRiseWebhook`, once.
//
// THE TRANSFER ID IS PART OF THE EVENT IDENTITY HERE, and that is API_CONTRACT
// section 10's own table rather than a local choice: the PSP row anchors on
// `(psp, provider_event_id)`, the KYC row on "`provider_applicant_id` plus event
// id", and THIS row on "`provider_transfer_id` plus event id". A verified
// payload that names no transfer is `event_identity_missing`, because half the
// anchor is missing and the receiver would have nothing to attach the outcome
// to.
//
// THE NONCE IS REQUIRED OF THE SCHEME RATHER THAN OPTIONAL, and this is the one
// place the Rise row differs from the PSP row in the contract's own words: it
// reads "HMAC plus timestamp and nonce" where the PSP row reads "HMAC per
// provider secret". `packages/psp/src/webhook.ts` resolves the nonce with the
// event identity precisely because one of the two real shapes it modelled has no
// nonce channel; the contract names one here, so `RiseEventIdentity.nonce` is
// not optional. Where the bytes sit is still the vendor's: a header the MAC
// spans, or a body field the MAC spans. What is required is that the nonce be
// COVERED BY THE SIGNATURE, and both spellings satisfy that.
// =============================================================================

import { createHmac, timingSafeEqual } from 'node:crypto';

/** `payout_transfers.provider`'s default, and the only value this port serves. */
export const RISE_PROVIDER = 'rise';

/**
 * API_CONTRACT section 10's window, in seconds. Five minutes.
 *
 * A DEFAULT rather than a constant folded into the comparison, because a
 * provider that documents a different tolerance is a fact about that provider.
 * What is not negotiable is that the window is checked at all.
 */
export const RISE_WEBHOOK_WINDOW_SECONDS = 300;

/** A JSON value, as `JSON.parse` returns one. */
export type RiseJsonValue =
  null | boolean | number | string | RiseJsonValue[] | { [k: string]: RiseJsonValue };

/** A JSON object, which is the only top-level shape a webhook body may take. */
export type RiseJsonObject = { readonly [k: string]: RiseJsonValue };

/** Headers as a Node HTTP server collects them: repeats arrive as an array. */
export type RiseWebhookHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;

/**
 * The closed refusal set.
 *
 * MEMBER FOR MEMBER AND IN THE SAME ORDER AS `WebhookRefusal` in
 * `packages/psp/src/port.ts`, and `test/rise-webhook-bind.test.ts` asserts it by
 * reading that file. A closed set is what lets a receiver switch on a refusal,
 * and two closed sets that disagree are two receivers reporting different
 * security events for the same thing.
 */
export type RiseWebhookRefusal =
  | 'signature_header_missing'
  | 'signature_header_repeated'
  | 'signature_malformed'
  | 'signature_mismatch'
  | 'timestamp_outside_window'
  | 'payload_not_json_object'
  | 'event_identity_missing';

/**
 * The throw, and why it carries the bytes.
 *
 * `verifyWebhook` throws rather than returning a boolean (M03 section 2.1, "a
 * boolean gets ignored"), and API_CONTRACT section 10 requires the raw payload
 * STORED, which `0006_commerce.sql` states for the payment rail in the general
 * form this port inherits: "a payload whose signature did not verify is still
 * stored, and stored with the fact that it did not verify". A bare throw cannot
 * satisfy that, because the receiver in the catch block has to write a row and
 * cannot write one unless the throw tells it which bytes. So the error carries
 * them.
 */
export class RiseWebhookVerificationError extends Error {
  readonly provider: string;
  readonly refusal: RiseWebhookRefusal;
  /** The bytes as received. The refusal row is written from this. */
  readonly raw: Uint8Array;

  constructor(refusal: RiseWebhookRefusal, raw: Uint8Array, detail?: string) {
    super(
      `${RISE_PROVIDER} webhook refused: ${refusal}${detail === undefined ? '' : ` (${detail})`}. ` +
        'API_CONTRACT section 10: an unverified signature never reaches business logic.',
    );
    this.name = 'RiseWebhookVerificationError';
    this.provider = RISE_PROVIDER;
    this.refusal = refusal;
    this.raw = raw;
  }
}

/**
 * What the adapter pulled out of ITS headers, before anything has been trusted.
 *
 * `signedBytes` is the exact byte sequence the provider claims to have MAC'd.
 * Building it is the adapter's job precisely because every provider builds it
 * differently, and getting it wrong is not a security failure: it is a TOTAL
 * failure, because nothing will ever verify.
 */
export interface RisePresentedSignature {
  readonly signedBytes: Uint8Array;
  readonly mac: Uint8Array;
  readonly timestampEpochSeconds: number;
  /** Present when the provider carries its nonce out of band. Absent otherwise. */
  readonly headerNonce?: string;
}

/** The four fields read out of a body that has already verified. */
export interface RiseEventIdentity {
  readonly providerEventId: string;
  /** `payout_transfers.provider_transfer_id`. Half of section 10's anchor. */
  readonly providerTransferId: string;
  readonly eventType: string;
  /** Required here, not optional. See this file's header. */
  readonly nonce: string;
}

/** The vendor's half. No implementation of it exists; see `routes/webhooks-rise.ts`. */
export interface RiseWebhookScheme {
  /**
   * Pull the signed material out of this provider's headers.
   *
   * @throws {RiseWebhookVerificationError} on a missing, repeated or malformed
   * header. It throws rather than returning a null so that the refusal reaches
   * the caller with the raw bytes already attached.
   */
  presentedSignature(raw: Uint8Array, headers: RiseWebhookHeaders): RisePresentedSignature;
  /**
   * Name this provider's event id, transfer id, event type and replay nonce, out
   * of a body that HAS ALREADY VERIFIED and out of the presented signature.
   *
   * Returns `null` when the body does not carry them, which the caller turns
   * into `event_identity_missing`.
   */
  eventIdentity(
    payload: RiseJsonObject,
    presented: RisePresentedSignature,
  ): RiseEventIdentity | null;
}

/**
 * A webhook that VERIFIED. There is no shape here for one that did not.
 *
 * EVERY FIELD IS COVERED BY THE SIGNATURE, and that is the property the type
 * exists to hold rather than a happy accident. `raw` is the bytes that were
 * MAC'd; `payload` is `JSON.parse` of exactly those bytes and of nothing else;
 * the identity fields are read out of `payload` or out of headers the MAC
 * covered.
 */
export interface VerifiedRiseEvent {
  readonly provider: string;
  readonly providerEventId: string;
  readonly providerTransferId: string;
  readonly eventType: string;
  readonly nonce: string;
  readonly timestampEpochSeconds: number;
  readonly raw: Uint8Array;
  readonly payload: RiseJsonObject;
}

/**
 * The port the route is written against.
 *
 * ONE METHOD, AND IT RETURNS A VERIFIED EVENT OR THROWS. The route never parses,
 * so "verified before parsing" is a module boundary rather than a step somebody
 * remembers.
 */
export interface RiseWebhookAdapter {
  verifyWebhook(raw: Uint8Array, headers: RiseWebhookHeaders): Promise<VerifiedRiseEvent>;
}

/** Arguments to the one verification path in this file. */
export interface VerifyRiseWebhookArgs {
  readonly scheme: RiseWebhookScheme;
  /** The shared secret. Never logged, never returned. */
  readonly secret: string;
  readonly raw: Uint8Array;
  readonly headers: RiseWebhookHeaders;
  /** Injected. Nothing here reads a clock of its own. */
  readonly now: Date;
  readonly windowSeconds?: number;
}

/**
 * Verify, then check freshness, then parse. In that order, always.
 *
 * @throws {RiseWebhookVerificationError} on every refusal. It never returns a
 * boolean and never returns a partially trusted object.
 */
export function verifyRiseWebhook(args: VerifyRiseWebhookArgs): VerifiedRiseEvent {
  const { scheme, secret, raw, headers, now } = args;
  const windowSeconds = args.windowSeconds ?? RISE_WEBHOOK_WINDOW_SECONDS;
  // A FUNCTION DECLARATION AND NOT A `const` ARROW, and the difference is not
  // style: TypeScript applies never-returning narrowing only to a call whose
  // callee has an explicit return type it can see, so as an arrow the compiler
  // would keep treating every line after a refusal as reachable.
  function refuse(refusal: RiseWebhookRefusal, detail?: string): never {
    throw new RiseWebhookVerificationError(refusal, raw, detail);
  }

  // 1. THE VENDOR'S EXTRACTION. It throws its own RiseWebhookVerificationError
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
  const payload = parsed as RiseJsonObject;

  const identity = scheme.eventIdentity(payload, presented);
  if (identity === null) {
    refuse('event_identity_missing');
  }

  return {
    provider: RISE_PROVIDER,
    providerEventId: identity.providerEventId,
    providerTransferId: identity.providerTransferId,
    eventType: identity.eventType,
    nonce: identity.nonce,
    timestampEpochSeconds: presented.timestampEpochSeconds,
    raw,
    payload,
  };
}

/**
 * An adapter over one scheme and one secret.
 *
 * A REAL VENDOR IS A `RiseWebhookScheme` AND NEVER A SECOND ADAPTER, which is
 * what keeps the ordering above the only implementation of the ordering. The
 * clock is injected for the same reason nothing else here reads one.
 */
export function riseHmacAdapter(options: {
  readonly scheme: RiseWebhookScheme;
  readonly secret: string;
  readonly clock: () => Date;
  readonly windowSeconds?: number;
}): RiseWebhookAdapter {
  return {
    verifyWebhook: (raw: Uint8Array, headers: RiseWebhookHeaders): Promise<VerifiedRiseEvent> =>
      Promise.resolve(
        verifyRiseWebhook({
          scheme: options.scheme,
          secret: options.secret,
          raw,
          headers,
          now: options.clock(),
          ...(options.windowSeconds === undefined ? {} : { windowSeconds: options.windowSeconds }),
        }),
      ),
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
 * @throws {RiseWebhookVerificationError} `signature_header_missing` or
 * `signature_header_repeated`.
 */
export function riseSingleHeader(
  headers: RiseWebhookHeaders,
  name: string,
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
    throw new RiseWebhookVerificationError('signature_header_missing', raw, name);
  }
  if (found.length > 1) {
    throw new RiseWebhookVerificationError(
      'signature_header_repeated',
      raw,
      `${name} x${found.length}`,
    );
  }
  const only = found[0];
  if (only === undefined) {
    throw new RiseWebhookVerificationError('signature_header_missing', raw, name);
  }
  return only;
}

/** The bytes of a UTF-8 string, which is what every scheme here signs over. */
export function riseUtf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Concatenate byte runs, because a signed payload is a prefix plus a body. */
export function riseConcatBytes(...runs: readonly Uint8Array[]): Uint8Array {
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
 * @throws {RiseWebhookVerificationError} `signature_malformed`.
 */
export function riseDecodeMac(
  encoded: string,
  encoding: 'hex' | 'base64',
  raw: Uint8Array,
): Uint8Array {
  const ok =
    encoding === 'hex'
      ? /^[0-9a-fA-F]+$/.test(encoded) && encoded.length % 2 === 0
      : /^[A-Za-z0-9+/]+={0,2}$/.test(encoded) && encoded.length % 4 === 0;
  if (!ok || encoded.length === 0) {
    throw new RiseWebhookVerificationError('signature_malformed', raw, `not ${encoding}`);
  }
  return new Uint8Array(Buffer.from(encoded, encoding));
}

/**
 * Parse a decimal integer that must be exactly that: `Number.parseInt` accepts
 * `"12abc"` and returns 12, which on a timestamp is a silently wrong window.
 *
 * @throws {RiseWebhookVerificationError} `signature_malformed`.
 */
export function riseDecimalInteger(s: string, raw: Uint8Array, what: string): number {
  if (!/^-?\d+$/.test(s)) {
    throw new RiseWebhookVerificationError('signature_malformed', raw, `${what} is not an integer`);
  }
  return Number(s);
}
