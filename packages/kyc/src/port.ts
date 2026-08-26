// =============================================================================
// packages/kyc/src/port.ts
// =============================================================================
// THE INTERFACE EVERY IDENTITY-VERIFICATION PROVIDER IS USED THROUGH, AND THE
// ONE PROPERTY IT EXISTS TO MAKE STRUCTURAL:
//
//   INV-M19-07: "No document, image, biometric template, or document number is
//   stored, logged, cached, or transmitted through Merit's systems."
//
//   API_CONTRACT section 7: "Merit never proxies documents; the client goes to
//   the provider's hosted flow."
//
// SO THE PORT HAS NO SHAPE A DOCUMENT COULD BE ASSIGNED TO. `createSession`
// returns a URL and an opaque applicant reference. There is no `upload`, no
// `submitDocument`, no `fetchDocument` and no field of type bytes anywhere
// except `raw`, which is the webhook's own signed envelope. A design where a
// document byte passes through Merit is not merely discouraged here: there is
// nowhere to put one.
//
// -----------------------------------------------------------------------------
// `provider` IS A STRING AND `PspId` IS A UNION, AND THE DIFFERENCE IS THE DDL
// -----------------------------------------------------------------------------
// `packages/psp` closes its provider set at `'psp_a' | 'psp_b'` and gives the
// reason: `purchases.psp` carries a CHECK constraint, so "a third member is a
// schema change before it is a type change".
//
// `kyc_verifications.provider` IS `text NOT NULL` WITH NO CHECK
// (`0003_kyc.sql:41`), and its inline comment says why: "Sumsub, Veriff, Persona class. The adapter is vendor-agnostic (M19 section 1.1) and the
// selected provider is named in the privacy policy at selection time, which
// makes provider choice a disclosure event and not only a procurement one
// (ADR-021)."
//
// A CLOSED UNION HERE WOULD BE CHOOSING A VENDOR IN A TYPE, and the choice is
// undecided and is a DISCLOSURE when it is taken. So the type is as open as the
// column, and the route resolves an unknown `:provider` to a 404 rather than a
// compile error, which is where an untrusted path parameter belongs anyway.
//
// -----------------------------------------------------------------------------
// WHAT THIS PACKAGE IS NOT
// -----------------------------------------------------------------------------
// It opens no socket, names no vendor SDK, registers no route and reads no row.
// It writes nothing to `dedupe_matches`, screens nobody against a sanctions
// list and re-verifies nothing: those are M19's and are not P3's stated
// content. `POST /kyc/session`, `GET /kyc/status` and
// `POST /webhooks/kyc/:provider` are `apps/api`'s and all three program against
// this file.
// =============================================================================

/** A JSON value, as `JSON.parse` returns one. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

/** A JSON object, which is the only top-level shape a webhook body may take. */
export type JsonObject = { readonly [k: string]: JsonValue };

/**
 * Inbound headers, in the shape a Node HTTP server actually produces.
 *
 * A repeated header arrives as an ARRAY, and picking `[0]` out of one is the
 * header-smuggling hole `signature_header_repeated` exists to name. Same
 * spelling as `packages/psp`'s `WebhookHeaders` for the same reason.
 */
export type KycWebhookHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;

// -----------------------------------------------------------------------------
// Outbound: the hosted session
// -----------------------------------------------------------------------------

/**
 * What Merit hands the provider, and the fields this type does NOT carry are
 * the point of it.
 *
 * NO NAME, NO DATE OF BIRTH, NO ADDRESS, NO DOCUMENT NUMBER. Merit sends an
 * opaque reference to a human and a URL to come back to; the human gives the
 * provider everything else, directly, in the provider's own flow. That is what
 * "Merit never proxies" means at the moment the flow starts, and Appendix D2's
 * data-minimisation rule is a type here rather than a review item.
 *
 * `idempotencyKey` IS THIS ATTEMPT'S AND IS NOT THE IDENTITY'S. A retry after a
 * rejected check is a NEW session with a NEW key, on `PurchaseIntent`'s own
 * reasoning one package over: keying on the subject would make a legitimate
 * second attempt look like a duplicate of the first, and M19 section 3.1 rules
 * that "rejection is not terminal" because most rejections are lighting.
 */
export interface KycApplicant {
  /** `identities.id`. Merit's own opaque reference to the human. */
  readonly identityId: string;
  /** Where the provider returns the trader when the hosted flow ends. */
  readonly returnUrl: string;
  /** This ATTEMPT's key. */
  readonly idempotencyKey: string;
}

/**
 * What the provider gave back, and it is `KycSessionResponse`'s four fields and
 * no fifth.
 *
 * API_CONTRACT section 7 declares
 * `{ provider, hosted_url, expires_at, applicant_ref }`, and the contract's
 * response shapes are ALLOWLISTS (section 1's API3 control). A port returning
 * more would be handing a route something it must remember not to serialise.
 */
export interface HostedVerificationSession {
  /** `kyc_verifications.provider`. The adapter's own name for itself. */
  readonly provider: string;
  /**
   * `kyc_verifications.provider_applicant_id`, and `0003:49`'s comment calls it
   * "the only pointer we keep". It is `applicant_ref` in the response.
   */
  readonly providerApplicantId: string;
  /** Where the trader goes. THE DOCUMENTS GO THERE AND NOT THROUGH MERIT. */
  readonly hostedUrl: string;
  /** RFC 3339 UTC, per API_CONTRACT section 1's time convention. */
  readonly expiresAt: string;
}

// -----------------------------------------------------------------------------
// Inbound: the verified event
// -----------------------------------------------------------------------------

/**
 * What the provider said happened, in MERIT'S vocabulary rather than the
 * vendor's.
 *
 * It is `kyc_status`'s own value set minus `kyc_required`, which is the state
 * before any provider has been involved and is therefore not something a
 * provider can report. Mapping a vendor's word onto one of these is the
 * ADAPTER's job, which is M03 section 2.1's second rule applied here: nothing
 * in the interface returns a DECISION, and what an outcome MEANS for an account
 * is Merit's logic in one place, shared by every provider.
 */
export type KycOutcome = 'pending' | 'verified' | 'rejected' | 'expired';

/**
 * A webhook that VERIFIED. There is no shape in this package for one that did
 * not: `verifyWebhook` throws.
 *
 * EVERY FIELD HERE WAS COVERED BY THE SIGNATURE. `raw` is the bytes that were
 * MAC'd, `payload` is `JSON.parse` of exactly those bytes and of nothing else,
 * and everything below is read out of that payload or out of headers the MAC
 * spanned. Nothing reached this object without going through the digest.
 *
 * `payload` IS DECISION METADATA AND THE SCREEN IS NOT OPTIONAL. `0003`'s own
 * header: "Every jsonb column below holds provider decision metadata and never
 * document data." A provider that posts an image into this envelope has put a
 * document in front of Merit's storage, and `screenForDocuments` in
 * `documents.ts` is what refuses to carry it further.
 */
export interface VerifiedKycEvent {
  readonly provider: string;
  /** Half of API_CONTRACT section 10's anchor for this endpoint. */
  readonly providerEventId: string;
  /** The other half. `kyc_verifications.provider_applicant_id`. */
  readonly providerApplicantId: string;
  /** The provider's word for what this event is. Merit's is `outcome`. */
  readonly eventType: string;
  readonly outcome: KycOutcome;
  /** The replay anchor, covered by the signature. See `webhook.ts`. */
  readonly nonce: string;
  readonly timestampEpochSeconds: number;
  /** `kyc_verifications.liveness_passed`, `null` when the event carries none. */
  readonly livenessPassed: boolean | null;
  /**
   * `kyc_verifications.liveness_method`.
   *
   * Recorded because liveness techniques and their defeat rates move quickly,
   * and an enforcement decided on a 2027 liveness check needs to know which
   * technique produced it (AS-M19-06). A boolean alone ages into an assertion
   * nobody can re-evaluate.
   */
  readonly livenessMethod: string | null;
  /**
   * The provider's own reason code, for `kyc_verifications.rejection_reason`.
   *
   * IT NEVER REACHES A TRADER. INV-M19-09: every rejection tells the trader
   * what to do next and "never states the provider's internal reason verbatim".
   * `GET /kyc/status` computes `action_required` from a closed vocabulary and
   * the suite asserts this string appears nowhere in that response.
   */
  readonly providerRejectionCode: string | null;
  /** The bytes that were signed. */
  readonly raw: Uint8Array;
  /** `JSON.parse(raw)`, performed only after the digest agreed. */
  readonly payload: JsonObject;
}

/**
 * Why a payload was refused. CLOSED.
 *
 * IT IS `packages/psp`'s `WebhookRefusal` MEMBER FOR MEMBER, and that is a
 * binding rather than a coincidence: `test/webhook-bind.test.ts` READS
 * `packages/psp/src/webhook.ts` and fails if the two vocabularies drift. One
 * ordering rule stated twice is two chances to get it wrong, and the reason it
 * IS stated twice is in this package's manifest and in ADR-114 section 4.
 */
export type KycWebhookRefusal =
  | 'signature_header_missing'
  | 'signature_header_repeated'
  | 'signature_malformed'
  | 'signature_mismatch'
  | 'timestamp_outside_window'
  | 'payload_not_json_object'
  | 'event_identity_missing';

/**
 * THE THROW, AND WHY IT CARRIES THE BYTES.
 *
 * A refusal still has to be RECORDED: API_CONTRACT section 10 requires the raw
 * payload stored and unverified signatures logged as security events. The
 * handler in the catch block cannot write that record unless the throw tells it
 * which provider and which bytes, so the error carries them. Nothing here is
 * parsed and nothing here is trusted.
 */
export class KycWebhookVerificationError extends Error {
  readonly provider: string;
  readonly refusal: KycWebhookRefusal;
  /** The bytes as received. */
  readonly raw: Uint8Array;

  constructor(provider: string, refusal: KycWebhookRefusal, raw: Uint8Array, detail?: string) {
    super(
      `${provider} KYC webhook refused: ${refusal}${detail === undefined ? '' : ` (${detail})`}. ` +
        'API_CONTRACT section 10: an unverified signature never reaches business logic.',
    );
    this.name = 'KycWebhookVerificationError';
    this.provider = provider;
    this.refusal = refusal;
    this.raw = raw;
  }
}

// -----------------------------------------------------------------------------
// The port
// -----------------------------------------------------------------------------

/**
 * Everything the rest of Merit is allowed to ask an identity provider for.
 *
 * TWO METHODS, AND THE SHORTNESS IS THE CONTROL. M19 section 1.3 lists what is
 * not this module's: holding documents is the provider's, enforcement is M7's,
 * name matching at payout is M5's, geo-blocking is M3's. What is left is
 * "start a check" and "tell me what you decided", and a port with a third
 * method is a port somebody has asked to hold something.
 *
 * `verifyWebhook` THROWS RATHER THAN RETURNING A BOOLEAN, which is M03 section
 * 2.1's first rule and the reason is the same one: "a boolean gets ignored".
 * It is also the only way to obtain a parsed KYC webhook body in this
 * workspace, so "verified before parsing" is a module boundary rather than a
 * step somebody remembers.
 */
export interface KycProvider {
  /** Which vendor this is. Written to `kyc_verifications.provider`. */
  readonly provider: string;

  /**
   * Open a hosted verification flow for one identity.
   *
   * THE RETURN IS A URL. Merit does not fetch it, proxy it, or embed anything
   * of the provider's behind its own origin; the client goes there.
   */
  createSession(applicant: KycApplicant): Promise<HostedVerificationSession>;

  /**
   * Verify, then parse. Never the other way round, and never both optional.
   *
   * @throws {KycWebhookVerificationError} always, on any refusal.
   */
  verifyWebhook(raw: Uint8Array, headers: KycWebhookHeaders): Promise<VerifiedKycEvent>;
}
