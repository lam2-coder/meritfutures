// =============================================================================
// packages/psp/src/port.ts
// =============================================================================
// THE INTERFACE EVERY PAYMENT PROVIDER IS USED THROUGH.
//
// M03 section 2.1 is the specification and this file is its transcription plus
// the three deviations section 3 of ADR-105 records. The three rules that
// section states, each because of a documented failure, are the three this file
// is built to make structural rather than reviewable:
//
//   1. `verifyWebhook` THROWS rather than returning a boolean. "A boolean gets
//      ignored." It is the same reasoning that made M1's engine refuse to
//      compute rather than compute something plausible.
//   2. NOTHING IN THE INTERFACE RETURNS A DECISION. The adapter reports what
//      the provider said. Whether that means an account gets created is Merit's
//      logic, in one place, shared by both providers.
//   3. NO ADAPTER METHOD TAKES A PRICE. INV-M3-02 is structural rather than a
//      review item, and `amount.ts` is how that survives contact with the fact
//      that a payment processor plainly does need a number.
//
// WHAT THIS PACKAGE IS NOT. It opens no socket, names no vendor SDK, registers
// no route and reads no row. `POST /webhooks/psp/:provider` is session 219's,
// `POST /checkout` is session 220's, and the dispute path is later still. All
// three program against this file, which is the whole reason it is written
// before any of them exists.
// =============================================================================

/**
 * The provider set, CLOSED, and this package did not choose it.
 *
 * [API_CONTRACT section 5](../../../docs/architecture/API_CONTRACT.md) types
 * `CheckoutResponse.psp` as `"psp_a" | "psp_b"` and
 * [`0006_commerce.sql`](../../db/migrations/0006_commerce.sql) writes the same
 * pair as a CHECK constraint on `purchases.psp`. Two MIDs is the ruling
 * (`INV-M3-11`, `RB-03`), not a default: "a firm with one MID has no working
 * version of RB-03".
 *
 * A THIRD MEMBER IS A SCHEMA CHANGE BEFORE IT IS A TYPE CHANGE, and that
 * ordering is deliberate.
 */
export type PspId = 'psp_a' | 'psp_b';

/** Both members, in the order the CHECK constraint writes them. */
export const PSP_IDS: readonly PspId[] = ['psp_a', 'psp_b'];

// -----------------------------------------------------------------------------
// JSON, spelled out rather than imported
// -----------------------------------------------------------------------------

/** A JSON value, as `JSON.parse` returns one. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

/** A JSON object, which is the only top-level shape a webhook body may take. */
export type JsonObject = { readonly [k: string]: JsonValue };

// -----------------------------------------------------------------------------
// Outbound: the payment session
// -----------------------------------------------------------------------------

/**
 * What checkout hands the provider, and the field this type does NOT carry is
 * the one that matters.
 *
 * `cardAmountCents` is a `CardAmountCents` and there is exactly one function in
 * this package that produces one (`cardLegOf` in `amount.ts`), which takes the
 * `purchases` row Merit wrote. A number that came from a request body cannot be
 * spelled here, which is M03's third rule expressed as a type rather than as a
 * sentence a reviewer has to remember.
 *
 * `idempotencyKey` IS REQUIRED AND IS NOT THE PURCHASE ID. A retried attempt
 * against the same purchase is a NEW session with a NEW key (M03 section 3.2:
 * "a new attempt is a new session with a new idempotency key"), so keying the
 * session on the purchase would have made a legitimate second attempt look like
 * a duplicate of the first.
 */
export interface PurchaseIntent {
  /** `purchases.id`. The provider's reference back to Merit's own row. */
  readonly purchaseId: string;
  /** The CARD leg, in integer cents, produced only from the purchase row. */
  readonly cardAmountCents: CardAmountCents;
  /** `purchases.currency`, ISO 4217 alpha-3. `char(3)` in the schema. */
  readonly currency: string;
  /** Where the provider returns the buyer on success. */
  readonly returnUrl: string;
  /** Where the provider returns the buyer on cancellation. */
  readonly cancelUrl: string;
  /** This ATTEMPT's key. A new attempt is a new key, never the purchase id. */
  readonly idempotencyKey: string;
}

/**
 * What the provider gave back. It is `CheckoutResponse.payment_session`'s three
 * fields and no fourth: the contract's response shape is an allowlist
 * (API_CONTRACT section 1's API3 control) and a port that returned more would
 * be handing a route something it must remember not to serialise.
 */
export interface PaymentSession {
  readonly providerSessionId: string;
  readonly redirectUrl: string;
  /** RFC 3339 UTC, per API_CONTRACT section 1's time convention. */
  readonly expiresAt: string;
}

// -----------------------------------------------------------------------------
// Money: the brand, declared here and produced only in `amount.ts`
// -----------------------------------------------------------------------------

/**
 * Integer cents on the CARD leg of a purchase, and the brand is the control.
 *
 * See `amount.ts` for why the card leg is not `amount_paid_cents` and for the
 * one function permitted to mint one of these.
 */
export type CardAmountCents = bigint & { readonly __brand: 'CardAmountCents' };

// -----------------------------------------------------------------------------
// Inbound: the verified webhook
// -----------------------------------------------------------------------------

/**
 * A webhook that VERIFIED. There is no shape in this package for one that did
 * not: `verifyWebhook` throws, and `WebhookVerificationError` carries what the
 * route needs to write the `signature_verified = false` row.
 *
 * EVERY FIELD HERE IS COVERED BY THE SIGNATURE, and that is the property the
 * type exists to hold rather than a happy accident. `raw` is the bytes that
 * were MAC'd; `payload` is `JSON.parse` of exactly those bytes and of nothing
 * else; `providerEventId`, `eventType` and `nonce` are read out of `payload` or
 * out of headers the MAC covered. Nothing reached this object without going
 * through the digest.
 */
export interface VerifiedEvent {
  readonly psp: PspId;
  /** The idempotency anchor. `(psp, provider_event_id)` is a unique index. */
  readonly providerEventId: string;
  /** `psp_webhook_events.event_type`. The provider's word, not Merit's. */
  readonly eventType: string;
  /** The replay anchor, covered by the signature. See `webhook.ts`. */
  readonly nonce: string;
  /** The provider's own timestamp, as seconds since the epoch. */
  readonly timestampEpochSeconds: number;
  /** The bytes that were signed. `psp_webhook_events.payload` is these. */
  readonly raw: Uint8Array;
  /** `JSON.parse(raw)`, performed only after the digest agreed. */
  readonly payload: JsonObject;
}

/**
 * Why a payload was refused. CLOSED, because a route that logs a security event
 * and a route that returns 401 both need to say which of these happened, and a
 * free-text reason is a reason nobody can switch on.
 *
 * `INV-M3-05`: an unverified signature never reaches business logic. Every
 * member of this union is a path that ends at 401 and at a security event.
 */
export type WebhookRefusal =
  | 'signature_header_missing'
  | 'signature_header_repeated'
  | 'signature_malformed'
  | 'signature_mismatch'
  | 'timestamp_outside_window'
  | 'payload_not_json_object'
  | 'event_identity_missing';

/**
 * THE THROW, AND WHY IT CARRIES A PAYLOAD.
 *
 * M03 section 2.1 rules that `verifyWebhook` throws rather than returning a
 * boolean, and `0006_commerce.sql` rules that a payload whose signature did not
 * verify IS STILL STORED, "and stored with the fact that it did not verify":
 * `psp_webhook_events.signature_verified` is `boolean NOT NULL` and
 * `processing_result` has a `'rejected_signature'` member.
 *
 * Those two rulings together mean a bare `throw new Error()` is not enough. The
 * handler in the catch block has to write a row, and it cannot write one unless
 * the throw tells it which provider and which bytes. So the error carries them.
 * The refusal is not softened by carrying them: nothing here is parsed, nothing
 * is trusted, and `raw` is the same bytes that arrived.
 */
export class WebhookVerificationError extends Error {
  readonly psp: PspId;
  readonly refusal: WebhookRefusal;
  /** The bytes as received. `psp_webhook_events.payload` is written from this. */
  readonly raw: Uint8Array;

  constructor(psp: PspId, refusal: WebhookRefusal, raw: Uint8Array, detail?: string) {
    super(
      `${psp} webhook refused: ${refusal}${detail === undefined ? '' : ` (${detail})`}. ` +
        'INV-M3-05: an unverified signature never reaches business logic.',
    );
    this.name = 'WebhookVerificationError';
    this.psp = psp;
    this.refusal = refusal;
    this.raw = raw;
  }
}

// -----------------------------------------------------------------------------
// Refunds and probes
// -----------------------------------------------------------------------------

/**
 * What the provider said about a refund, and the word `providerStatus` is doing
 * the work: it is the provider's claim, not Merit's disposition.
 *
 * `payment_disputes.outcome` is Merit's (`'lost' | 'won' | 'refunded'`), it is
 * written by the dispute path, and no adapter may set it. The two vocabularies
 * are deliberately different words so nothing can pass one where the other is
 * meant.
 */
export interface RefundResult {
  readonly providerRefundId: string;
  readonly amountCents: CardAmountCents;
  /**
   * SYNCHRONOUS AND ASYNCHRONOUS PROVIDERS BOTH FIT, which is the reason this
   * member exists at all. One of the two fakes settles a refund in the call and
   * the other returns `pending` and settles on a later webhook. A port with no
   * `pending` would have quietly assumed the first shape.
   */
  readonly providerStatus: 'pending' | 'succeeded';
}

/**
 * A REACHABILITY PROBE, AND IT IS NOT A HEALTH STATE.
 *
 * `mid_health.state` is `'healthy' | 'degraded' | 'unhealthy'`, it is Merit's
 * decision record over a trailing window (SD-M3-03: "failover needs a DECISION
 * RECORD, not a live computation"), and no adapter returns one. What an adapter
 * can honestly report is whether it got an answer and how long it waited.
 *
 * The distinction is M03's second rule applied to the failover path: a port
 * that returned `'unhealthy'` would be two implementations of the routing rule,
 * one per provider, and they would drift.
 */
export interface PspProbe {
  readonly psp: PspId;
  readonly reachable: boolean;
  /** Integer milliseconds. Never a float, and never negative. */
  readonly latencyMs: number;
}

// -----------------------------------------------------------------------------
// The port
// -----------------------------------------------------------------------------

/**
 * Everything the rest of Merit is allowed to ask a payment provider for.
 *
 * Five members, which is M03 section 2.1's five. A second adapter is additive
 * precisely because this list is short and stated in Merit's terms: nothing
 * outside this package imports a vendor type, and nothing inside it knows what
 * a route is.
 */
export interface PspAdapter {
  /** Which MID this is. Written to `purchases.psp`. */
  readonly psp: PspId;

  /**
   * Open a payment session for a purchase Merit has already written.
   *
   * FAILOVER IS PER ATTEMPT AND NEVER MID TRANSACTION (M03 section 3.2,
   * AS-M3-02). A session created at one MID is completed there or it fails;
   * there is no method on this interface that moves a session between
   * providers, and `routing.ts` is named for the only moment a choice is
   * legitimate.
   */
  createSession(intent: PurchaseIntent): Promise<PaymentSession>;

  /**
   * Verify, then parse. Never the other way round, and never both optional.
   *
   * API_CONTRACT section 10, in capitals in the contract: "HMAC signature
   * verified BEFORE parsing". This method is the only way to obtain a parsed
   * webhook body from this package, so the ordering is not a convention a
   * handler could get wrong: there is no parsed body to be had without it.
   *
   * @throws {WebhookVerificationError} always, on any refusal, never a boolean.
   */
  verifyWebhook(raw: Uint8Array, headers: WebhookHeaders): Promise<VerifiedEvent>;

  /**
   * Refund a purchase, by the provider's own reference to it.
   *
   * The amount is a `CardAmountCents` for the same reason `createSession`'s is:
   * a refund is money and money on this path comes from a row Merit wrote.
   */
  refund(
    purchaseRef: string,
    amountCents: CardAmountCents,
    idempotencyKey: string,
  ): Promise<RefundResult>;

  /** Ask the provider whether it is answering. Not whether it is healthy. */
  health(): Promise<PspProbe>;
}

/**
 * Inbound headers, in the shape a Node HTTP server actually produces.
 *
 * `IncomingHttpHeaders` is `Record<string, string | string[] | undefined>` and a
 * repeated header arrives as an ARRAY. Typing this as the web `Headers` class
 * (which is what M03 section 2.1 sketches) would have required every caller to
 * convert, and a conversion that picks `[0]` out of a repeated signature header
 * is the header-smuggling hole this package refuses by name
 * (`signature_header_repeated`). See ADR-105 section 3.
 */
export type WebhookHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;
