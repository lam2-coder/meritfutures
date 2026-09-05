// =============================================================================
// apps/api/src/routes/webhooks-kyc.ts
// =============================================================================
// API_CONTRACT SECTION 10's `POST /webhooks/kyc/:provider`, WHICH IS THE SAME
// RULE AS THE PSP ROW AND A DIFFERENT ANCHOR:
//
//   | POST /webhooks/kyc/:provider | KYC provider | HMAC |
//   | `provider_applicant_id` plus event id |
//
//   "All webhooks: HMAC signature verified BEFORE parsing, timestamp within a
//    5 minute window, nonce recorded for replay protection, raw payload stored,
//    processing idempotent on the provider event id, and a 200 returned for
//    duplicates so providers stop retrying."
//
// THE SHAPE IS SESSION 219's AND IS NOT A SECOND ONE. `rawBodyOf` and
// `installRawWebhookBodyParser` are IMPORTED from `routes/webhooks-psp.ts`
// rather than re-derived, because they are measurements against fastify 5.12.1
// and a second copy would be a second thing to keep true. `rawBodyOf`'s message
// names the PSP handler, which is a wording debt this session records rather
// than takes: that file is outside this fence.
//
// HALF OF THAT MOVED IN ADR-340 AND THE SENTENCE IS AMENDED RATHER THAN CUT
// (`RI-14`). The parser installer now lives in `registry.ts` as
// `installRawBodyParser`, because `compose` is its only production caller;
// `routes/webhooks-psp.ts` re-exports that one definition under the old name,
// so "a second copy would be a second thing to keep true" still holds and this
// file's import still resolves. `rawBodyOf` did not move. THIS ROUTE NOW
// DECLARES `rawBody: true` and a live process reaches this receiver's own 404
// rather than the `500 internal_error` every webhook row answered before.
//
// -----------------------------------------------------------------------------
// THE ANCHOR THIS CONTRACT ROW NAMES DOES NOT EXIST IN THE DATABASE
// -----------------------------------------------------------------------------
// Three facts, each re-derived at source, and together they are why the store
// below is a PORT with no implementation:
//
//   1. THERE IS NO `kyc_webhook_events` TABLE. Over all 47 migrations the only
//      inbound-webhook table is `psp_webhook_events` (`0006_commerce.sql:275`),
//      and its `purchase_id uuid REFERENCES purchases(id)` makes it the payment
//      rail's rather than a general one. A KYC event has nowhere to be claimed.
//   2. `(provider, provider_applicant_id)` IS NOT A UNIQUE KEY AND MUST NEVER
//      BECOME ONE. `kyc_verifications` declares one unique key and it is `id`
//      (`0003_kyc.sql:37`). SD-M19-01 and INV-M19-06 make a re-verification a
//      NEW ROW against the same applicant, so many rows share that pair BY
//      DESIGN. ADR-112's `refuseUnaddressed` therefore refuses that address,
//      and refusing it is CORRECT: an addressed write through it would name
//      more than one row.
//   3. A WEBHOOK CARRIES NO SESSION, so all three authorities refuse it. The
//      scoped accessor needs an identity this payload does not carry;
//      `firmDb()` takes `FirmTableKey` and `kyc_verifications` is `owned`; and
//      the system reason vocabulary is `'nightly-batch' | 'operator-console'`,
//      of which a request handler is neither. That is ADR-109's finding 2
//      reached from a second direction, one day later.
//
// SO `productionDeps` RESOLVES NOTHING, AND WHAT A LIVE DEPLOYMENT ANSWERS
// TODAY IS 404 RATHER THAN 503, WHICH IS MEASURED AND NOT ASSUMED. The resolver
// runs before the store check, no vendor has been selected, and an unselected
// vendor genuinely names no resource, so every `:provider` is `not_found`. The
// 503 is the OTHER leg and it is reachable the day a vendor exists and the
// table does not. The route is REGISTERED either way, because the contract row
// exists and an unregistered route answers a 404 that is the ROUTER's and looks
// identical to a contract Merit never wrote. ADR-114 section 5 is the ruling,
// and the migration that would close it is a later session's: `0048` stays
// free.
//
// -----------------------------------------------------------------------------
// THE DOCUMENT SCREEN IS THIS ROUTE'S OWN CONTROL
// -----------------------------------------------------------------------------
// INV-M19-07 forbids a document being "stored, logged, cached, or transmitted
// through Merit's systems", and `kyc_verifications` is retained FOREVER under
// an AML obligation by its own table comment. The port makes it impossible for
// Merit to ASK for a document; nothing stops a provider POSTING one into a
// webhook envelope, where a receiver that stored what it was sent would write
// it into `raw_result jsonb` and keep it forever.
//
// So a verified payload is screened BEFORE anything stores it, the event is
// REFUSED rather than redacted, and the refusal record carries the offending
// KEY NAMES AND NEVER THEIR VALUES. Refusing is the honest direction: redacting
// silently would leave Merit's operators believing their provider is configured
// the way the privacy policy says it is.
// =============================================================================

import { createHash } from 'node:crypto';

import {
  KycDocumentInPayloadError,
  KycWebhookVerificationError,
  screenForDocuments,
  type JsonObject,
  type KycProvider,
  type KycWebhookRefusal,
  type VerifiedKycEvent,
} from '@merit/kyc';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { defineRoutes } from '../registry.ts';
import { PROBLEM_MEDIA_TYPE, problem } from '../server.ts';
import type { Problem } from '../server.ts';
import { rawBodyOf } from './webhooks-psp.ts';

/** API_CONTRACT section 10's row, as the contract writes it. No base path. */
export const KYC_WEBHOOK_PATH = '/webhooks/kyc/:provider';

// -----------------------------------------------------------------------------
// The row, and the results it can carry
// -----------------------------------------------------------------------------

/**
 * What one delivery did.
 *
 * IT IS `psp_webhook_events.processing_result`'s VOCABULARY WITH ONE MEMBER
 * ADDED, and the addition is named rather than folded: `rejected_document` is
 * the INV-M19-07 refusal, which has no counterpart on the payment rail because
 * a payment provider has no document to send. When the table this port writes
 * to is finally created, that member is a CHECK value somebody has to have
 * decided on, and this is where the decision is written down.
 */
export type KycProcessingResult =
  | 'applied'
  | 'duplicate_ignored'
  | 'out_of_order_deferred'
  | 'rejected_signature'
  | 'rejected_document';

/** One event row for a payload that VERIFIED and passed the document screen. */
export interface KycWebhookEventRow {
  readonly provider: string;
  /** Half of API_CONTRACT section 10's anchor for this endpoint. */
  readonly providerEventId: string;
  /** The other half, and `0003:49`'s "only pointer we keep". */
  readonly providerApplicantId: string;
  readonly eventType: string;
  /** Always `true` on this shape. The refusal row is a different type. */
  readonly signatureVerified: true;
  /** The verified bytes, parsed once, SCREENED. Decision metadata only. */
  readonly payload: JsonObject;
  readonly processedAt: Date | null;
  readonly processingResult: KycProcessingResult;
  /** When the batch should look at a deferred event again. */
  readonly deferredUntil: Date | null;
  /** `0` here always: this receiver never re-drives, a batch does. */
  readonly deferAttempts: number;
}

/**
 * One event row for a payload that was REFUSED, by the signature or the screen.
 *
 * A REFUSED PAYLOAD IS STILL RECORDED AND IS RECORDED WITH THE FACT THAT IT WAS
 * REFUSED, which is `0006`'s own rule for the payment rail and is the same rule
 * here. What is NOT recorded is the payload: on the signature path the bytes
 * are untrusted and are stored as hex, and on the document path the bytes are a
 * document and storing them is the thing being refused.
 */
export interface KycWebhookRefusalRow {
  readonly provider: string;
  /** Synthesised. See {@link unverifiedKycEventId}: nothing here is trustworthy. */
  readonly providerEventId: string;
  readonly eventType: string;
  readonly signatureVerified: boolean;
  /**
   * What is safe to keep, and nothing else.
   *
   * On a signature refusal, the bytes as received, hex, because they may not be
   * JSON at all. On a document refusal, THE KEY PATHS AND NEVER THE VALUES.
   */
  readonly evidence: JsonObject;
  readonly processingResult: 'rejected_signature' | 'rejected_document';
  readonly refusal: KycWebhookRefusal | 'document_in_payload';
}

/**
 * The prefix every synthesised event id carries.
 *
 * A refused payload names no event this receiver may believe, so the id is the
 * SHA-256 of the raw bytes under a prefix. A provider retrying one refused
 * payload then writes ONE row rather than one per delivery.
 *
 * WHAT IT DOES NOT DO IS BOUND THE TABLE. A caller that VARIES the body gets a
 * new digest and a new row every time, and API_CONTRACT section 11 says
 * webhooks are "not rate limited; protected by signature verification", which
 * is true of the business path and is not true of this write. Session 219 named
 * the same gap on the payment rail and it is the same gap here.
 */
export const UNVERIFIED_KYC_EVENT_ID_PREFIX = 'unverified:';

/** The synthesised id. Deterministic in the bytes, so retries dedupe. */
export function unverifiedKycEventId(raw: Uint8Array): string {
  return `${UNVERIFIED_KYC_EVENT_ID_PREFIX}${createHash('sha256').update(raw).digest('hex')}`;
}

// -----------------------------------------------------------------------------
// The ports
// -----------------------------------------------------------------------------

/**
 * What the application of one verified event decided.
 *
 * `deferred` is B4 #9 and API_CONTRACT section 10's last sentence: out-of-order
 * delivery is DEFERRED AND RE-EVALUATED rather than applied. The canonical case
 * here is a decision arriving before the `kyc_verifications` row that
 * `POST /kyc/session` writes, which would otherwise record an outcome against
 * an applicant Merit has never heard of.
 */
export type KycApplication =
  { readonly kind: 'applied' } | { readonly kind: 'deferred'; readonly until: Date };

/** One open transaction, as this receiver needs to see it. */
export interface KycWebhookTx {
  /**
   * INSERT the row. `'duplicate'` when the event id was already claimed.
   *
   * THE UNIQUE INDEX IS THE MUTEX AND THIS IS NOT A CHECKED INSERT, which is
   * the shape session 219 landed and the shape this one cannot yet have: the
   * index this method rides on does not exist, because the table does not. An
   * implementation of this interface is what ADR-114 section 5 unblocks.
   */
  record(row: KycWebhookEventRow): Promise<'inserted' | 'duplicate'>;
  /** Discard everything done on this transaction, the application included. */
  rollback(): Promise<void>;
}

/**
 * What a verified event MEANS, which is deliberately not this module's.
 *
 * IT TAKES THE TRANSACTION so it cannot be written against a different one than
 * the claim lands in. If the application committed and the claim did not, a
 * retried delivery would apply the event twice with the table showing one row.
 *
 * IT DOES NOT DECIDE ENFORCEMENT AND IT NEVER WILL. INV-M19-04: a biometric
 * dedupe hit raises a flag against BOTH identities and changes no state, and
 * `dedupe_matches` is session 168's `M19-8` rather than P3's stated content.
 * Nothing in this module writes to it.
 */
export interface KycEventApplier {
  apply(event: VerifiedKycEvent, tx: KycWebhookTx): Promise<KycApplication>;
}

/** Where the rows go. */
export interface KycWebhookStore {
  /** Run `fn` in ONE transaction and commit what it leaves, unless it rolled back. */
  transact<T>(fn: (tx: KycWebhookTx) => Promise<T>): Promise<T>;
  /**
   * The refusal row, on its OWN transaction.
   *
   * Never on the caller's: there is no caller's, because a refusal happens
   * before any transaction is opened. A duplicate is tolerated silently,
   * because {@link unverifiedKycEventId} makes a retried refusal collide by
   * construction.
   */
  recordRefusal(row: KycWebhookRefusalRow): Promise<void>;
}

/** Which adapter serves a `:provider` path parameter, or `null` for none. */
export type KycProviderResolver = (provider: string) => KycProvider | null;

/** Everything the receiver reaches the world through. All of it injected. */
export interface KycWebhookDeps {
  readonly providers: KycProviderResolver;
  /** `null` until a table exists to write to. See this file's header. */
  readonly store: KycWebhookStore | null;
  /** `null` until there is a verification row for an outcome to land on. */
  readonly applier: KycEventApplier | null;
  /** Injected. Nothing here reads a clock of its own. */
  readonly now: () => Date;
}

// -----------------------------------------------------------------------------
// The receiver
// -----------------------------------------------------------------------------

/** What the receiver decided, before a framework has been involved. */
export interface KycReceiverResponse {
  readonly status: number;
  readonly body: JsonObject;
  /** True for a problem document, which carries its own media type. */
  readonly isProblem: boolean;
}

/** Arguments to the one receiving path in this module. */
export interface ReceiveKycWebhookArgs {
  /** The `:provider` path parameter, UNTRUSTED and resolved before anything else. */
  readonly provider: string;
  /** The body AS RECEIVED. Never a re-serialisation. */
  readonly raw: Uint8Array;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  /** API_CONTRACT section 2's `instance`: the request id, for correlation. */
  readonly instance: string;
  readonly deps: KycWebhookDeps;
}

/**
 * The 200 body, and it is the same one for every accepted outcome.
 *
 * Applied, deferred and duplicate are indistinguishable to the provider on
 * purpose: a response that said "duplicate" would answer, to anybody holding a
 * signing key, which event ids Merit has already seen.
 */
const RECEIVED: JsonObject = { received: true };

function accepted(): KycReceiverResponse {
  return { status: 200, body: RECEIVED, isProblem: false };
}

function refused(p: Problem): KycReceiverResponse {
  return { status: p.status, body: p as unknown as JsonObject, isProblem: true };
}

/**
 * Receive one KYC webhook. Framework-free, so the ordering is testable without
 * a socket.
 */
export async function receiveKycWebhook(args: ReceiveKycWebhookArgs): Promise<KycReceiverResponse> {
  const { provider, raw, headers, instance, deps } = args;

  // 1. THE PATH PARAMETER, BEFORE ANY BYTE OF THE BODY IS LOOKED AT. An unknown
  //    provider names no secret, so there is nothing to verify against and
  //    nothing to store. It is `not_found` and not `validation_failed`: the
  //    path names a resource.
  const adapter = deps.providers(provider);
  if (adapter === null) return refused(problem('not_found', 404, instance));

  // 2. A DEPLOYMENT THAT CANNOT STORE THE PAYLOAD MUST NOT VERIFY IT. Section
  //    10 requires the raw payload stored, and a receiver that verified and
  //    then discarded would answer 200 for an event nobody can re-drive.
  const { store, applier } = deps;
  if (store === null || applier === null) {
    return refused({
      type: 'https://meritfutures.com/problems/service_unavailable',
      title: 'Service unavailable',
      status: 503,
      code: 'service_unavailable',
      instance,
    });
  }

  // 3. VERIFY. The digest, then the freshness window, then and only then a
  //    parse, all of it inside `@merit/kyc`. This module never parses.
  let event: VerifiedKycEvent;
  try {
    event = await adapter.verifyWebhook(raw, headers);
  } catch (cause) {
    // A refusal from the port is the shape below. Anything else is a defect in
    // the adapter and is rethrown, because answering 401 for it would report a
    // security event that did not happen.
    if (!(cause instanceof KycWebhookVerificationError)) throw cause;
    await store.recordRefusal({
      provider: cause.provider,
      providerEventId: unverifiedKycEventId(cause.raw),
      eventType: `${UNVERIFIED_KYC_EVENT_ID_PREFIX}${cause.refusal}`,
      signatureVerified: false,
      evidence: { unverified_body_hex: Buffer.from(cause.raw).toString('hex') },
      processingResult: 'rejected_signature',
      refusal: cause.refusal,
    });
    // An unverified signature never reaches business logic: `applier` is
    // reached only below this catch.
    return refused(problem('unauthenticated', 401, instance));
  }

  // 4. THE DOCUMENT SCREEN, BEFORE ANY STORE SEES THE PAYLOAD. INV-M19-07.
  //    It runs AFTER verification and not before, which is deliberate: an
  //    unsigned payload is refused by the signature and never reaches here, so
  //    everything this refuses is a document a REAL provider genuinely sent,
  //    which is a configuration finding an operator has to see.
  try {
    screenForDocuments(event.provider, event.payload);
  } catch (cause) {
    if (!(cause instanceof KycDocumentInPayloadError)) throw cause;
    await store.recordRefusal({
      provider: event.provider,
      // The event id is the provider's own here, because the signature DID
      // verify: this is a known event from a known provider carrying something
      // it must not carry, and naming it is what lets an operator find it.
      providerEventId: event.providerEventId,
      eventType: event.eventType,
      signatureVerified: true,
      // PATHS AND NEVER VALUES. The whole refusal is that the content must not
      // travel, and evidence that quoted it would carry the document into the
      // row that reports the document.
      evidence: { document_bearing_paths: [...cause.paths] },
      processingResult: 'rejected_document',
      refusal: 'document_in_payload',
    });
    return refused(problem('validation_failed', 400, instance));
  }

  // 5. APPLY, CLAIM, AND ROLL BACK IF THE CLAIM LOST. The application runs
  //    FIRST and the row carries its result, which is session 219's ordering
  //    and its reason: the alternative needs an UPDATE of one row, and this
  //    receiver has no table to address one in even if it did.
  return store.transact(async (tx) => {
    const application = await applier.apply(event, tx);
    const now = deps.now();
    const row: KycWebhookEventRow =
      application.kind === 'applied'
        ? {
            provider: event.provider,
            providerEventId: event.providerEventId,
            providerApplicantId: event.providerApplicantId,
            eventType: event.eventType,
            signatureVerified: true,
            payload: event.payload,
            processedAt: now,
            processingResult: 'applied',
            deferredUntil: null,
            deferAttempts: 0,
          }
        : {
            provider: event.provider,
            providerEventId: event.providerEventId,
            providerApplicantId: event.providerApplicantId,
            eventType: event.eventType,
            signatureVerified: true,
            payload: event.payload,
            // NOT PROCESSED. `processed_at` is when the event was APPLIED, and
            // a deferred event has not been. The batch stamps it when it is.
            processedAt: null,
            processingResult: 'out_of_order_deferred',
            deferredUntil: application.until,
            // ZERO, ALWAYS. `defer_attempts` counts RE-DRIVES and this is the
            // first arrival. Incrementing here reports an attempt nobody made.
            deferAttempts: 0,
          };

    if ((await tx.record(row)) === 'duplicate') {
      // The claim lost, so this delivery is a redelivery. Rolling back is what
      // makes "exactly one business effect" true: the application above ran on
      // this transaction and goes with it.
      await tx.rollback();
      return accepted();
    }
    return accepted();
  });
}

// -----------------------------------------------------------------------------
// The framework edge
// -----------------------------------------------------------------------------

/**
 * The deployment's dependencies, which today resolve nothing.
 *
 * `@merit/kyc` ships a port and one FAKE, and a fake must never serve a real
 * provider. No vendor has been selected, which ADR-021 makes a DISCLOSURE
 * decision rather than only a procurement one, so this resolves `null` and the
 * route answers 404 for every provider name until one is chosen. See this
 * file's header for why that is the resolver's answer and not the router's.
 */
export const productionDeps: KycWebhookDeps = {
  providers: () => null,
  store: null,
  applier: null,
  now: () => new Date(),
};

/** Build the handler over one set of dependencies. The suite injects its own. */
export function kycWebhookHandler(deps: KycWebhookDeps) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    // `rawBodyOf` REFUSES A RECONSTRUCTION RATHER THAN BUILDING ONE. Fastify's
    // default JSON parser has already consumed the body, and re-encoding the
    // parsed object would digest a DIFFERENT DOCUMENT: every legitimate webhook
    // would answer 401 and the diagnosis a reader reaches for is "the
    // provider's secret is wrong". ADR-109 ruling 4 is the seam that ends this.
    const raw = rawBodyOf(request.body);
    const params = request.params as { readonly provider?: string };
    const result = await receiveKycWebhook({
      provider: params.provider ?? '',
      raw,
      headers: request.headers,
      instance: request.id,
      deps,
    });
    return reply
      .code(result.status)
      .type(result.isProblem ? PROBLEM_MEDIA_TYPE : 'application/json')
      .send(result.body);
  };
}

export default defineRoutes({
  name: 'webhooks-kyc',
  routes: [
    {
      method: 'POST',
      path: KYC_WEBHOOK_PATH,
      handler: kycWebhookHandler(productionDeps),
      // THE BYTES, OR THIS RECEIVER CANNOT VERIFY ANYTHING. API_CONTRACT
      // section 10 wants the HMAC verified BEFORE parsing. ADR-340.
      rawBody: true,
    },
  ],
});
