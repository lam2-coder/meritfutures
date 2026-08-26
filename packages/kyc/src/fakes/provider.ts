// =============================================================================
// packages/kyc/src/fakes/provider.ts
// =============================================================================
// ONE FAKE IDENTITY PROVIDER, AND IT MUST NEVER SERVE A REAL ONE.
//
// `packages/psp` ships TWO fakes and ADR-105 gives the reason: writing the
// second is what separated the vendor's mechanics from Merit's rule, because
// the two shapes payment processors actually ship disagree about every
// mechanical detail. THAT ARGUMENT DOES NOT TRANSFER HERE AND ONE FAKE IS
// WRITTEN RATHER THAN TWO, for a reason worth stating rather than leaving as a
// difference somebody notices:
//
//   The PSP port had TWO REAL SHAPES TO SEPARATE, both already known, and the
//   separation was the deliverable. The KYC provider is UNDECIDED (ADR-021,
//   M19:76) and no shape is known, so a second fake here would be a second
//   INVENTION rather than a second observation, and inventing a disagreement to
//   prove a port survives disagreement proves nothing about a vendor nobody has
//   chosen. What the port's vendor-neutrality rests on instead is that
//   `provider` is a string and every mechanical detail is in `KycWebhookScheme`,
//   which is checkable without a second fake.
//
// THE SHAPE BELOW IS THE THREE-HEADER ONE, chosen because it is the shape that
// exercises the out-of-band nonce: the signature spans `"<t>\n<nonce>\n" + body`,
// so the replay anchor is covered by the MAC without living in the body.
//
// NOTHING HERE IS A DOCUMENT AND THE FIXTURES CARRY NONE. The payloads this
// fake signs are decision metadata: an outcome, a liveness result, scores. That
// is what a real provider's webhook carries under Merit's configuration, and a
// fake that carried an image would be teaching the receiver to accept one.
// =============================================================================

import {
  KycWebhookVerificationError,
  type HostedVerificationSession,
  type JsonObject,
  type KycApplicant,
  type KycOutcome,
  type KycProvider,
  type KycWebhookHeaders,
  type VerifiedKycEvent,
} from '../port.ts';
import {
  concatBytes,
  decimalInteger,
  decodeKycMac,
  singleKycHeader,
  utf8,
  verifyKycWebhook,
  type KycEventIdentity,
  type KycPresentedSignature,
  type KycWebhookScheme,
} from '../webhook.ts';

/** This fake's name, and it is a fake in the name so a log line says so. */
export const FAKE_KYC_PROVIDER = 'fake_kyc_a';

/** The three headers this shape uses. */
export const FAKE_KYC_HEADERS = {
  signature: 'x-kyc-signature',
  timestamp: 'x-kyc-timestamp',
  nonce: 'x-kyc-nonce',
} as const;

/** `"<timestamp>\n<nonce>\n"` then the body, exactly as the fake signs it. */
export function fakeSignedBytes(
  timestampEpochSeconds: number,
  nonce: string,
  body: Uint8Array,
): Uint8Array {
  return concatBytes(utf8(`${timestampEpochSeconds}\n${nonce}\n`), body);
}

function readString(payload: JsonObject, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function readOutcome(payload: JsonObject): KycOutcome | null {
  const value = payload['outcome'];
  return value === 'pending' || value === 'verified' || value === 'rejected' || value === 'expired'
    ? value
    : null;
}

/** The vendor half: headers, encoding, and where the identity fields sit. */
export const fakeKycScheme: KycWebhookScheme = {
  provider: FAKE_KYC_PROVIDER,

  presentedSignature(raw: Uint8Array, headers: KycWebhookHeaders): KycPresentedSignature {
    const signature = singleKycHeader(headers, FAKE_KYC_HEADERS.signature, FAKE_KYC_PROVIDER, raw);
    const timestamp = singleKycHeader(headers, FAKE_KYC_HEADERS.timestamp, FAKE_KYC_PROVIDER, raw);
    const nonce = singleKycHeader(headers, FAKE_KYC_HEADERS.nonce, FAKE_KYC_PROVIDER, raw);
    const seconds = decimalInteger(timestamp, FAKE_KYC_PROVIDER, raw, 'timestamp');
    return {
      signedBytes: fakeSignedBytes(seconds, nonce, raw),
      mac: decodeKycMac(signature, 'base64', FAKE_KYC_PROVIDER, raw),
      timestampEpochSeconds: seconds,
      headerNonce: nonce,
    };
  },

  eventIdentity(payload: JsonObject, presented: KycPresentedSignature): KycEventIdentity | null {
    const providerEventId = readString(payload, 'event_id');
    const providerApplicantId = readString(payload, 'applicant_id');
    const eventType = readString(payload, 'type');
    const outcome = readOutcome(payload);
    const nonce = presented.headerNonce;
    // ALL FIVE OR NOTHING. `provider_applicant_id` is half of API_CONTRACT
    // section 10's anchor for this endpoint, so an event that names no
    // applicant cannot be attached to anything and is a refusal rather than a
    // partially trusted object.
    if (
      providerEventId === null ||
      providerApplicantId === null ||
      eventType === null ||
      outcome === null ||
      nonce === undefined
    ) {
      return null;
    }
    const liveness = payload['liveness_passed'];
    return {
      providerEventId,
      providerApplicantId,
      eventType,
      outcome,
      nonce,
      livenessPassed: typeof liveness === 'boolean' ? liveness : null,
      livenessMethod: readString(payload, 'liveness_method'),
      providerRejectionCode: readString(payload, 'reason_code'),
    };
  },
};

/** What the fake needs to behave, all of it injected. */
export interface FakeKycProviderOptions {
  readonly secret: string;
  /** Nothing in this package reads a clock of its own. */
  readonly now: () => Date;
  /**
   * The applicant reference this fake mints for an identity.
   *
   * INJECTED BECAUSE A FAKE MAY NOT INVENT RANDOMNESS. A provider reference is
   * the vendor's, and a fake that generated one would make a test's expected
   * value unpredictable for no benefit.
   */
  readonly applicantRef: (applicant: KycApplicant) => string;
  /** How long the hosted flow stays open. Integer seconds. */
  readonly sessionTtlSeconds: number;
  /** Where the hosted flow lives. A URL Merit sends the trader to and never fetches. */
  readonly hostedBaseUrl: string;
}

/**
 * Build the fake. It signs and verifies for real; only the vendor is imaginary.
 */
export function fakeKycProvider(options: FakeKycProviderOptions): KycProvider {
  return {
    provider: FAKE_KYC_PROVIDER,

    createSession(applicant: KycApplicant): Promise<HostedVerificationSession> {
      const ref = options.applicantRef(applicant);
      const expiresAt = new Date(
        options.now().getTime() + options.sessionTtlSeconds * 1000,
      ).toISOString();
      return Promise.resolve({
        provider: FAKE_KYC_PROVIDER,
        providerApplicantId: ref,
        // THE TRADER GOES HERE AND MERIT DOES NOT. No document, no image and no
        // form field of the provider's passes through Merit's origin.
        hostedUrl: `${options.hostedBaseUrl}/${encodeURIComponent(ref)}`,
        expiresAt,
      });
    },

    verifyWebhook(raw: Uint8Array, headers: KycWebhookHeaders): Promise<VerifiedKycEvent> {
      try {
        return Promise.resolve(
          verifyKycWebhook({
            scheme: fakeKycScheme,
            secret: options.secret,
            raw,
            headers,
            now: options.now(),
          }),
        );
      } catch (cause) {
        // A refusal is returned as a REJECTED PROMISE rather than thrown
        // synchronously, so a caller that only awaits sees every refusal.
        if (cause instanceof KycWebhookVerificationError) return Promise.reject(cause);
        throw cause;
      }
    },
  };
}
