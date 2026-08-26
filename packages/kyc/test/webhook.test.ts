// =============================================================================
// packages/kyc/test/webhook.test.ts
// =============================================================================
// THE ORDERING, THE REFUSALS, AND THE DOCUMENT SCREEN.
//
// Every payload below is signed FOR REAL by the fake, so an assertion that a
// legitimate webhook verifies is an assertion about the digest rather than
// about a stub that returned true. The refusal cases each mutate exactly one
// thing about a payload that would otherwise verify, which is what makes them
// evidence about the control they name.
// =============================================================================

import { createHmac } from 'node:crypto';

import { describe, expect, test } from 'vitest';

import {
  KycDocumentInPayloadError,
  documentBearingPaths,
  keyWords,
  screenForDocuments,
} from '../src/documents.ts';
import {
  FAKE_KYC_HEADERS,
  FAKE_KYC_PROVIDER,
  fakeKycProvider,
  fakeSignedBytes,
} from '../src/fakes/provider.ts';
import { KycWebhookVerificationError, type JsonObject } from '../src/port.ts';

const SECRET = 'a-shared-secret-that-is-never-logged';
const NOW = new Date('2026-08-26T12:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

/** Decision metadata, and every field of it is a score, a method or a time. */
const DECIDED: JsonObject = {
  event_id: 'evt_0001',
  applicant_id: 'app_9f2c',
  type: 'applicant.reviewed',
  outcome: 'verified',
  liveness_passed: true,
  liveness_method: 'passive_3d',
  face_match_score: 9820,
  reviewed_at: '2026-08-26T11:59:50Z',
};

function bodyOf(payload: JsonObject): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

function sign(raw: Uint8Array, nonce: string, seconds: number): string {
  return createHmac('sha256', SECRET)
    .update(fakeSignedBytes(seconds, nonce, raw))
    .digest('base64');
}

function headersFor(
  raw: Uint8Array,
  over: Partial<{ nonce: string; seconds: number; signature: string }> = {},
): Record<string, string> {
  const nonce = over.nonce ?? 'nonce-0001';
  const seconds = over.seconds ?? NOW_SECONDS;
  return {
    [FAKE_KYC_HEADERS.signature]: over.signature ?? sign(raw, nonce, seconds),
    [FAKE_KYC_HEADERS.timestamp]: String(seconds),
    [FAKE_KYC_HEADERS.nonce]: nonce,
  };
}

const provider = fakeKycProvider({
  secret: SECRET,
  now: () => NOW,
  applicantRef: (applicant) => `app_${applicant.identityId}`,
  sessionTtlSeconds: 900,
  hostedBaseUrl: 'https://vendor.example/flow',
});

describe('createSession hands over a URL and nothing else', () => {
  test('the response is API_CONTRACT section 7s four fields', async () => {
    const session = await provider.createSession({
      identityId: 'id_42',
      returnUrl: 'https://merit.example/kyc/done',
      idempotencyKey: 'attempt-1',
    });
    expect(session).toEqual({
      provider: FAKE_KYC_PROVIDER,
      providerApplicantId: 'app_id_42',
      hostedUrl: 'https://vendor.example/flow/app_id_42',
      expiresAt: '2026-08-26T12:15:00.000Z',
    });
  });

  test('nothing a document could ride on is in the request OR the response', async () => {
    // INV-M19-07 as a shape rather than as a promise: `KycApplicant` carries an
    // identity id, a return URL and an attempt key, and there is no fourth
    // field for a name, a date of birth or a document number to arrive in.
    const session = await provider.createSession({
      identityId: 'id_42',
      returnUrl: 'https://merit.example/kyc/done',
      idempotencyKey: 'attempt-1',
    });
    expect(documentBearingPaths(session as unknown as JsonObject)).toEqual([]);
  });
});

describe('verify, then the window, then and only then a parse', () => {
  test('a correctly signed decision verifies and carries what the MAC spanned', async () => {
    const raw = bodyOf(DECIDED);
    const event = await provider.verifyWebhook(raw, headersFor(raw));
    expect(event.provider).toBe(FAKE_KYC_PROVIDER);
    expect(event.providerEventId).toBe('evt_0001');
    expect(event.providerApplicantId).toBe('app_9f2c');
    expect(event.outcome).toBe('verified');
    expect(event.livenessPassed).toBe(true);
    expect(event.livenessMethod).toBe('passive_3d');
    expect(event.nonce).toBe('nonce-0001');
    expect(event.raw).toBe(raw);
  });

  test('A RE-SERIALISED BODY DOES NOT VERIFY, which is the silent total failure', async () => {
    // Two JSON texts that parse equal serialise differently. A handler that
    // recovered the "bytes" by re-encoding a parsed body would digest a
    // DIFFERENT DOCUMENT, every legitimate webhook would answer 401, and the
    // diagnosis a reader reaches for is "the provider's secret is wrong".
    const raw = new TextEncoder().encode(JSON.stringify(DECIDED, null, 2));
    const headers = headersFor(bodyOf(DECIDED));
    await expect(provider.verifyWebhook(raw, headers)).rejects.toMatchObject({
      refusal: 'signature_mismatch',
    });
  });

  test('a tampered body is refused even though the headers are untouched', async () => {
    const raw = bodyOf(DECIDED);
    const headers = headersFor(raw);
    const tampered = bodyOf({ ...DECIDED, outcome: 'rejected' });
    await expect(provider.verifyWebhook(tampered, headers)).rejects.toMatchObject({
      refusal: 'signature_mismatch',
    });
  });

  test('a missing signature header is its own refusal member', async () => {
    const raw = bodyOf(DECIDED);
    const headers = headersFor(raw);
    delete headers[FAKE_KYC_HEADERS.signature];
    await expect(provider.verifyWebhook(raw, headers)).rejects.toMatchObject({
      refusal: 'signature_header_missing',
    });
  });

  test('a REPEATED signature header is refused rather than resolved to [0]', async () => {
    const raw = bodyOf(DECIDED);
    const nonce = 'nonce-0001';
    const headers = {
      [FAKE_KYC_HEADERS.signature]: [sign(raw, nonce, NOW_SECONDS), 'AAAA'],
      [FAKE_KYC_HEADERS.timestamp]: String(NOW_SECONDS),
      [FAKE_KYC_HEADERS.nonce]: nonce,
    };
    await expect(provider.verifyWebhook(raw, headers)).rejects.toMatchObject({
      refusal: 'signature_header_repeated',
    });
  });

  test('a signature that is not base64 is malformed rather than a short MAC', async () => {
    const raw = bodyOf(DECIDED);
    await expect(
      provider.verifyWebhook(raw, headersFor(raw, { signature: 'not base64 at all!!' })),
    ).rejects.toMatchObject({ refusal: 'signature_malformed' });
  });

  test('a timestamp outside the five minute window is refused in BOTH directions', async () => {
    const raw = bodyOf(DECIDED);
    const stale = NOW_SECONDS - 301;
    const future = NOW_SECONDS + 301;
    await expect(
      provider.verifyWebhook(raw, headersFor(raw, { seconds: stale })),
    ).rejects.toMatchObject({ refusal: 'timestamp_outside_window' });
    await expect(
      provider.verifyWebhook(raw, headersFor(raw, { seconds: future })),
    ).rejects.toMatchObject({ refusal: 'timestamp_outside_window' });
  });

  test('THE DIGEST IS CHECKED BEFORE THE WINDOW, so a stale forgery reports the forgery', async () => {
    // An attacker controls the timestamp bytes. If the window ran first, an
    // unauthenticated party would choose which branch of the verifier executes.
    const raw = bodyOf(DECIDED);
    await expect(
      provider.verifyWebhook(
        raw,
        headersFor(raw, { seconds: NOW_SECONDS - 4000, signature: 'AAAA' }),
      ),
    ).rejects.toMatchObject({ refusal: 'signature_mismatch' });
  });

  test('a verified body that names no applicant is event_identity_missing', async () => {
    // Half of API_CONTRACT section 10's anchor for this endpoint. There is
    // nothing to attach the outcome to.
    const payload = { ...DECIDED };
    delete (payload as Record<string, unknown>)['applicant_id'];
    const raw = bodyOf(payload as JsonObject);
    await expect(provider.verifyWebhook(raw, headersFor(raw))).rejects.toMatchObject({
      refusal: 'event_identity_missing',
    });
  });

  test('a signed body that is not a JSON object is refused after the digest agreed', async () => {
    const raw = new TextEncoder().encode('[1,2,3]');
    await expect(provider.verifyWebhook(raw, headersFor(raw))).rejects.toMatchObject({
      refusal: 'payload_not_json_object',
    });
  });

  test('the refusal carries the provider and the bytes so a row can be written', async () => {
    const raw = bodyOf(DECIDED);
    await provider.verifyWebhook(raw, headersFor(raw, { signature: 'AAAA' })).catch((cause) => {
      expect(cause).toBeInstanceOf(KycWebhookVerificationError);
      const refusal = cause as KycWebhookVerificationError;
      expect(refusal.provider).toBe(FAKE_KYC_PROVIDER);
      expect(refusal.raw).toBe(raw);
      // The secret never appears in a message.
      expect(refusal.message).not.toContain(SECRET);
    });
    expect.assertions(4);
  });
});

describe('INV-M19-07: the document screen refuses and never redacts', () => {
  test('decision metadata passes, INCLUDING the scores INV-M19-12 requires kept', () => {
    // `dedupe_matches.evidence_snapshot` holds "scores, method, timestamps.
    // NEVER images", and a screen that refused a score would refuse the one
    // payload M19 exists to record.
    expect(documentBearingPaths(DECIDED)).toEqual([]);
    expect(() => {
      screenForDocuments(FAKE_KYC_PROVIDER, DECIDED);
    }).not.toThrow();
  });

  const refused: readonly (readonly [string, JsonObject])[] = [
    ['a top level image', { document_image: 'AAA' }],
    ['a nested image', { result: { selfie: 'AAA' } }],
    ['an image inside an array', { checks: [{ ok: true }, { photo: 'AAA' }] }],
    ['a biometric template', { biometric_template: 'AAA' }],
    ['a document number', { document_number: 'X1234567' }],
    ['an id number', { id_number: 'X1234567' }],
    ['an MRZ line', { mrz: 'P<GBR' }],
    ['a base64 carrier', { base64: 'AAA' }],
    ['a data URI under an innocent key', { note: 'data:image/png;base64,AAAA' }],
  ];
  for (const [what, payload] of refused) {
    test(`${what} is refused`, () => {
      expect(() => {
        screenForDocuments(FAKE_KYC_PROVIDER, payload);
      }).toThrow(KycDocumentInPayloadError);
    });
  }

  const allowed: readonly (readonly [string, JsonObject])[] = [
    ['a document TYPE, which is a decision fact', { document_type: 'passport' }],
    ['a funnel attempt number', { attempt_number: 3 }],
    ['a face match SCORE', { face_match_score: 9820 }],
    ['a content type', { content_type: 'application/json' }],
    ['a scanned_at timestamp', { scanned_at: '2026-08-26T00:00:00Z' }],
  ];
  for (const [what, payload] of allowed) {
    test(`${what} passes: a control that fires on innocent keys gets turned off`, () => {
      expect(documentBearingPaths(payload)).toEqual([]);
    });
  }

  test('THE FINDING IS A PATH AND NEVER A VALUE', () => {
    // The whole point is that the content must not travel. A finding that
    // quoted it would carry the document into the log line reporting it.
    // NOT A REAL BASE64 IMAGE HEADER, AND THE REASON IS `CI-05`. This line's
    // first form bound a real PNG prefix to a variable named `secret`, and
    // gitleaks' `generic-api-key` rule reads `secret = '<high entropy>'` as a
    // credential and turned the stage red. The assertion needs a value that
    // MUST NOT TRAVEL; it does not need one that looks like a key, and a
    // scanner cannot tell a fixture apart from the thing it is imitating.
    const imageBytes = 'FAKE-PNG-BYTES-NOT-A-CREDENTIAL';
    try {
      screenForDocuments(FAKE_KYC_PROVIDER, { result: { selfie: imageBytes } });
      throw new Error('unreachable: the screen did not refuse');
    } catch (cause) {
      expect(cause).toBeInstanceOf(KycDocumentInPayloadError);
      const error = cause as KycDocumentInPayloadError;
      expect(error.paths).toEqual(['result.selfie']);
      expect(error.message).not.toContain(imageBytes);
    }
  });

  test('a refused subtree reports ONE path and not one per leaf inside it', () => {
    expect(documentBearingPaths({ images: { front: 'A', back: 'B' } })).toEqual(['images']);
  });

  test('keyWords splits every spelling a vendor might use', () => {
    expect([...keyWords('providerImageUrl')]).toEqual(['provider', 'image', 'url']);
    expect([...keyWords('document_number')]).toEqual(['document', 'number']);
    expect([...keyWords('ID-Photo')]).toEqual(['id', 'photo']);
  });
});
