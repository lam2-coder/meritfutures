// =============================================================================
// apps/api/src/routes/webhooks-rise.ts
// =============================================================================
// API_CONTRACT SECTION 10's `POST /webhooks/rise`, WHICH IS THE SAME RULE AS THE
// PSP AND KYC ROWS AND A THIRD ANCHOR:
//
//   | POST /webhooks/rise | Rise | HMAC plus timestamp and nonce |
//   | `provider_transfer_id` plus event id |
//
//   "All webhooks: HMAC signature verified BEFORE parsing, timestamp within a
//    5 minute window, nonce recorded for replay protection, raw payload stored,
//    processing idempotent on the provider event id, and a 200 returned for
//    duplicates so providers stop retrying."
//   "Unverified signatures return 401 and are logged as security events; they
//    never reach business logic."
//
// THE SHAPE IS SESSION 219's AND SESSION 226's AND IS NOT A THIRD ONE.
// `rawBodyOf` is IMPORTED from `routes/webhooks-psp.ts` rather than re-derived,
// because it is a measurement against fastify 5.12.1 and a second copy would be
// a second thing to keep true. `webhooks-kyc.ts` imports the same function for
// the same reason and records the same wording debt: that error message names
// the PSP handler, and that file is outside this fence too.
//
// -----------------------------------------------------------------------------
// THE VERIFIER IS A PORT AND THE PORT IS NEW. SAID LOUDLY, AS THE FENCE ASKS
// -----------------------------------------------------------------------------
// `apps/api/src/rise-webhook.ts` is a NEW PORT this slice created, and its
// header carries the whole argument: `HmacWebhookScheme` is branded
// `readonly psp: PspId`, `PspId` is closed at `'psp_a' | 'psp_b'` by a CHECK on
// `purchases.psp`, and calling it from the payout rail would write a payment
// processor's id into a transfer. `@merit/kyc` hit the identical wall one path
// over and ADR-114 section 4 ruled the remedy (a neutral package neither
// provider set brands) and deferred it because "lifting it is a slice with two
// consumers already written, which is the cheapest moment to do it and is not
// this moment". That moment has receded rather than arrived: three consumers
// now, and eight route sessions in flight against this tree rather than three.
// ADR-146 records the count so the next holder does not rediscover it.
//
// NOTHING HERE VERIFIES ANYTHING. This module never calls `JSON.parse` and never
// computes a MAC. `RiseWebhookAdapter.verifyWebhook` is the only function that
// returns a parsed Rise body and it returns one only after the digest agreed, so
// "verified before parsing" is a module boundary rather than a step somebody
// remembers.
//
// WHAT THIS MODULE HAS TO GET RIGHT INSTEAD IS THE BYTES. ADR-109 clause 7 is a
// PROHIBITION rather than a plan: "A HANDLER MAY NEVER RECOVER THE BYTES BY
// RE-ENCODING `request.body`. Two JSON texts that parse equal serialise
// differently, so a re-encoded body is a DIFFERENT DOCUMENT and its MAC will not
// verify. The failure is a 401 for every legitimate webhook, with no line of
// code looking wrong." `rawBodyOf` refuses rather than reconstructing, and
// `test/webhooks-rise.test.ts` watches a correctly signed payload being refused
// after a pretty-printing round trip AND the same payload verifying on its own
// bytes, in that order, so the second assertion cannot be satisfied by a
// verifier that refuses everything.
//
// -----------------------------------------------------------------------------
// THE ANCHOR THIS CONTRACT ROW NAMES HAS NO TABLE, AND HALF OF IT HAS THE WRONG
// ONE
// -----------------------------------------------------------------------------
// Re-derived at source before anything below was written:
//
//   1. THERE IS NO `rise_webhook_events` TABLE. Over all 47 migrations the only
//      inbound-webhook table is `psp_webhook_events` (`0006_commerce.sql:275`),
//      and its `purchase_id uuid REFERENCES purchases(id)` makes it the payment
//      rail's rather than a general one. A Rise event has nowhere to be claimed.
//   2. `provider_transfer_id` EXISTS AND IS ON THE WRONG KIND OF ROW.
//      `payout_transfers_provider_transfer_uq` is UNIQUE on
//      `(provider, provider_transfer_id) WHERE provider_transfer_id IS NOT NULL`
//      (`0010_payouts.sql:290`), so it addresses ONE TRANSFER. The contract's
//      anchor is "`provider_transfer_id` PLUS EVENT ID", and a transfer emits
//      more than one event (`payout_transfers.status` runs `queued`, `sent`,
//      `settled`, `failed`, `retrying`), so claiming an event on that index
//      would make the second event about a transfer look like a duplicate of the
//      first. The half that would disambiguate them has no column anywhere.
//   3. `payout_transfers` IS THE MONEY PATH. Even with a table, writing a
//      transfer's outcome is E2 content and is `POST /accounts/:id/payout`'s
//      slice rather than this one's. This session is not money by content and
//      does not become so by wiring a store.
//
// SO `productionDeps` RESOLVES NOTHING AND A LIVE DEPLOYMENT ANSWERS 503, WHICH
// IS SECTION 2's CODE FOR A DEPENDENCY THAT IS NOT THERE. It is 503 and not the
// 404 `webhooks-kyc.ts` answers, and the difference is the PATH rather than a
// preference: that row carries `:provider` and an unselected vendor genuinely
// names no resource, so its resolver answers `not_found` before any dependency
// is consulted. This row names no resource to be absent. The route is REGISTERED
// either way, because the contract row exists and an unregistered route answers
// a 404 that is the ROUTER's and looks identical to a contract Merit never
// wrote.
//
// -----------------------------------------------------------------------------
// APPLY, THEN CLAIM, AND THE REASON IS NO LONGER THE OBSTACLE IT WAS
// -----------------------------------------------------------------------------
// ADR-109 clause 5: "A RECEIVER THAT CANNOT UPDATE A ROW MUST APPLY BEFORE IT
// CLAIMS." When session 219 wrote that, `packages/db` could not name one row at
// all. ADR-112 has since landed `rowAt`, `updateAt` and `deleteAt`, so the
// OBSTACLE is gone and the shape is kept anyway, on the second half of the same
// clause, which was never about the obstacle: "insert-then-apply-then-stamp
// needs an `UPDATE` and leaves a window in which a crash commits a claim for an
// effect that never happened." Checked against the primary source rather than
// inherited: a comment that still called this a workaround would be a comment
// that had stopped being true.
//
// THE TWO 200s ARE BYTE-IDENTICAL, WHICH IS A CONTROL RATHER THAN LAZINESS.
// Applied, deferred and duplicate are indistinguishable to the provider on
// purpose: a response that said "duplicate" would answer, to anybody holding a
// signing key, which event ids Merit has already seen.
// =============================================================================

import { createHash } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  RiseWebhookVerificationError,
  type RiseJsonObject,
  type RiseWebhookAdapter,
  type RiseWebhookHeaders,
  type RiseWebhookRefusal,
  type VerifiedRiseEvent,
} from '../rise-webhook.ts';
import { defineRoutes } from '../registry.ts';
import { PROBLEM_MEDIA_TYPE, problem } from '../server.ts';
import type { Problem } from '../server.ts';
import { rawBodyOf } from './webhooks-psp.ts';

/** API_CONTRACT section 10's row, as the contract writes it. No base path. */
export const RISE_WEBHOOK_PATH = '/webhooks/rise';

// -----------------------------------------------------------------------------
// The row, and the results it can carry
// -----------------------------------------------------------------------------

/**
 * What one delivery did.
 *
 * IT IS `psp_webhook_events.processing_result`'s VOCABULARY, MEMBER FOR MEMBER
 * (`0006_commerce.sql:288-290`). Nothing is added, and the absence is worth
 * stating: the KYC receiver added `rejected_document` because INV-M19-07 gives
 * it a refusal a payment rail has no counterpart for. A payout rail has none
 * either, so the set is the payment rail's exactly. When the table this port
 * writes to is finally created, this is the CHECK list somebody has to have
 * decided on, and this is where the decision is written down.
 */
export type RiseProcessingResult =
  'applied' | 'duplicate_ignored' | 'out_of_order_deferred' | 'rejected_signature';

/** One event row for a payload that VERIFIED. */
export interface RiseWebhookEventRow {
  readonly provider: string;
  /** Half of API_CONTRACT section 10's anchor for this endpoint. */
  readonly providerEventId: string;
  /** The other half. `payout_transfers.provider_transfer_id`. */
  readonly providerTransferId: string;
  readonly eventType: string;
  /** Always `true` on this shape. The refusal row is a different type. */
  readonly signatureVerified: true;
  /** The verified bytes, parsed once. */
  readonly payload: RiseJsonObject;
  readonly processedAt: Date | null;
  readonly processingResult: RiseProcessingResult;
  /** When the batch should look at a deferred event again. */
  readonly deferredUntil: Date | null;
  /** `0` here always: this receiver never re-drives, a batch does. */
  readonly deferAttempts: number;
}

/**
 * One event row for a payload whose signature DID NOT VERIFY.
 *
 * A REFUSED PAYLOAD IS STILL RECORDED AND IS RECORDED WITH THE FACT THAT IT WAS
 * REFUSED, which is `0006`'s own rule for the payment rail and is the same rule
 * here: `signature_verified boolean NOT NULL` under the comment "a payload whose
 * signature did not verify is still stored, and stored with the fact that it did
 * not verify". `RiseWebhookVerificationError` carries the refusal and the raw
 * bytes precisely so this row can be written, which is why the throw in
 * `rise-webhook.ts` is not a bare one.
 *
 * WHAT IS NOT RECORDED IS A PARSED PAYLOAD. The bytes are untrusted and may not
 * be JSON at all, so they are stored as hex.
 */
export interface RiseWebhookRefusalRow {
  readonly provider: string;
  /** Synthesised. See {@link unverifiedRiseEventId}: nothing here is trustworthy. */
  readonly providerEventId: string;
  readonly eventType: string;
  readonly signatureVerified: false;
  readonly evidence: RiseJsonObject;
  readonly processingResult: 'rejected_signature';
  readonly refusal: RiseWebhookRefusal;
}

/**
 * The prefix every synthesised event id carries.
 *
 * A refused payload names no event this receiver may believe, so the id is the
 * SHA-256 of the raw bytes under a prefix. A provider retrying one refused
 * payload then writes ONE row rather than one per delivery.
 *
 * WHAT IT DOES NOT DO IS BOUND THE TABLE. A caller that VARIES the body gets a
 * new digest and a new row every time, and API_CONTRACT section 11 says webhooks
 * are "not rate limited; protected by signature verification", which is true of
 * the business path and is not true of this write. Session 219 named the same
 * gap on the payment rail, session 226 named it on the identity rail, and it is
 * the same gap here.
 */
export const UNVERIFIED_RISE_EVENT_ID_PREFIX = 'unverified:';

/** The synthesised id. Deterministic in the bytes, so retries dedupe. */
export function unverifiedRiseEventId(raw: Uint8Array): string {
  return `${UNVERIFIED_RISE_EVENT_ID_PREFIX}${createHash('sha256').update(raw).digest('hex')}`;
}

// -----------------------------------------------------------------------------
// The ports
// -----------------------------------------------------------------------------

/**
 * What the application of one verified event decided.
 *
 * `deferred` is B4 #9 and API_CONTRACT section 10's last sentence: out-of-order
 * delivery is DEFERRED AND RE-EVALUATED rather than applied. The canonical case
 * on this rail is a `settled` arriving before the `sent` that names the
 * transfer, which applied in order would record a settlement against a transfer
 * Merit has not yet heard the provider acknowledge.
 */
export type RiseApplication =
  { readonly kind: 'applied' } | { readonly kind: 'deferred'; readonly until: Date };

/** One open transaction, as this receiver needs to see it. */
export interface RiseWebhookTx {
  /**
   * INSERT the row. `'duplicate'` when the anchor was already claimed.
   *
   * THE UNIQUE INDEX IS THE MUTEX AND THIS IS NOT A CHECKED INSERT. A read
   * followed by an insert is two statements with a race between them, and the
   * race is exactly the concurrent redelivery this endpoint exists to survive.
   * The index this method rides on does not exist, because the table does not;
   * see this file's header for what would create it and why the one index that
   * carries the anchor's first half cannot serve.
   */
  record(row: RiseWebhookEventRow): Promise<'inserted' | 'duplicate'>;
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
 * ITS IMPLEMENTATION IS THE MONEY PATH AND IS NOT WRITTEN HERE. Moving a
 * `payout_transfers` row from `sent` to `settled` is M05's and is E2 content;
 * this file declares the seam and stops at it.
 */
export interface RiseEventApplier {
  apply(event: VerifiedRiseEvent, tx: RiseWebhookTx): Promise<RiseApplication>;
}

/** Where the rows go. */
export interface RiseWebhookStore {
  /** Run `fn` in ONE transaction and commit what it leaves, unless it rolled back. */
  transact<T>(fn: (tx: RiseWebhookTx) => Promise<T>): Promise<T>;
  /**
   * The refusal row, on its OWN transaction.
   *
   * Never on the caller's: there is no caller's, because a refusal happens
   * before any transaction is opened, and an unverified signature never reaches
   * business logic. A duplicate is tolerated silently, because
   * {@link unverifiedRiseEventId} makes a retried refusal collide by
   * construction.
   */
  recordRefusal(row: RiseWebhookRefusalRow): Promise<void>;
}

/** Everything the receiver reaches the world through. All of it injected. */
export interface RiseWebhookDeps {
  /** `null` until a Rise adapter exists. No vendor scheme is implemented. */
  readonly adapter: RiseWebhookAdapter | null;
  /** `null` until a table exists to write to. See this file's header. */
  readonly store: RiseWebhookStore | null;
  /** `null` until there is a transfer row for an outcome to land on. */
  readonly applier: RiseEventApplier | null;
  /** Injected. Nothing here reads a clock of its own. */
  readonly now: () => Date;
}

// -----------------------------------------------------------------------------
// The receiver
// -----------------------------------------------------------------------------

/** What the receiver decided, before a framework has been involved. */
export interface RiseReceiverResponse {
  readonly status: number;
  readonly body: RiseJsonObject;
  /** True for a problem document, which carries its own media type. */
  readonly isProblem: boolean;
}

/** Arguments to the one receiving path in this module. */
export interface ReceiveRiseWebhookArgs {
  /** The body AS RECEIVED. Never a re-serialisation. See {@link rawBodyOf}. */
  readonly raw: Uint8Array;
  readonly headers: RiseWebhookHeaders;
  /** API_CONTRACT section 2's `instance`: the request id, for correlation. */
  readonly instance: string;
  readonly deps: RiseWebhookDeps;
}

/** The 200 body, and it is the same one for every accepted outcome. */
const RECEIVED: RiseJsonObject = { received: true };

function accepted(): RiseReceiverResponse {
  return { status: 200, body: RECEIVED, isProblem: false };
}

function refused(p: Problem): RiseReceiverResponse {
  return { status: p.status, body: p as unknown as RiseJsonObject, isProblem: true };
}

/**
 * Receive one Rise webhook. Framework-free, so the ordering is testable without
 * a socket.
 */
export async function receiveRiseWebhook(
  args: ReceiveRiseWebhookArgs,
): Promise<RiseReceiverResponse> {
  const { raw, headers, instance, deps } = args;

  // 1. A DEPLOYMENT THAT CANNOT VERIFY OR CANNOT STORE MUST NOT LOOK AT THE
  //    BODY. Section 10 requires the raw payload stored, and a receiver that
  //    verified and then discarded would answer 200 for an event nobody can
  //    re-drive. All three absences are the same fact on this path, which
  //    carries no `:provider` to be `not_found`: a dependency is not there.
  const { adapter, store, applier } = deps;
  if (adapter === null || store === null || applier === null) {
    return refused({
      type: 'https://meritfutures.com/problems/service_unavailable',
      title: 'Service unavailable',
      status: 503,
      code: 'service_unavailable',
      instance,
    });
  }

  // 2. VERIFY. The digest, then the freshness window, then and only then a
  //    parse, all of it inside `rise-webhook.ts`. This module never parses.
  let event: VerifiedRiseEvent;
  try {
    event = await adapter.verifyWebhook(raw, headers);
  } catch (cause) {
    // A refusal from the port is the shape below. Anything else is a defect in
    // the adapter and is rethrown, because answering 401 for it would report a
    // security event that did not happen.
    if (!(cause instanceof RiseWebhookVerificationError)) throw cause;
    await store.recordRefusal({
      provider: cause.provider,
      providerEventId: unverifiedRiseEventId(cause.raw),
      eventType: `${UNVERIFIED_RISE_EVENT_ID_PREFIX}${cause.refusal}`,
      signatureVerified: false,
      evidence: { unverified_body_hex: Buffer.from(cause.raw).toString('hex') },
      processingResult: 'rejected_signature',
      refusal: cause.refusal,
    });
    // An unverified signature never reaches business logic: `applier` is reached
    // only below this catch.
    return refused(problem('unauthenticated', 401, instance));
  }

  // 3. APPLY, CLAIM, AND ROLL BACK IF THE CLAIM LOST. See this file's header for
  //    why the application runs first and why that reason is not the obstacle it
  //    was when the shape was first written.
  return store.transact(async (tx) => {
    const application = await applier.apply(event, tx);
    const now = deps.now();
    const row: RiseWebhookEventRow =
      application.kind === 'applied'
        ? {
            provider: event.provider,
            providerEventId: event.providerEventId,
            providerTransferId: event.providerTransferId,
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
            providerTransferId: event.providerTransferId,
            eventType: event.eventType,
            signatureVerified: true,
            payload: event.payload,
            // NOT PROCESSED. `processed_at` is when the event was APPLIED, and a
            // deferred event has not been. The batch stamps it when it is.
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
 * NO RISE SCHEME IS IMPLEMENTED ANYWHERE IN THIS TREE, no table exists for the
 * events, and the applier's content is the money path. Stated as code rather
 * than as a comment, because a comment saying "not wired yet" beside a handler
 * that would happily run a fake is how a fake ships.
 */
export const productionDeps: RiseWebhookDeps = {
  adapter: null,
  store: null,
  applier: null,
  now: () => new Date(),
};

/** Build the handler over one set of dependencies. The suite injects its own. */
export function riseWebhookHandler(deps: RiseWebhookDeps) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    // `rawBodyOf` REFUSES A RECONSTRUCTION RATHER THAN BUILDING ONE. ADR-109
    // clause 7: re-encoding the parsed object would digest a DIFFERENT DOCUMENT
    // and every legitimate webhook would answer 401, with the diagnosis a reader
    // reaches for being "the provider's secret is wrong". ADR-109 ruling 4 is the
    // seam that ends this; until it exists the route answers 500 rather than
    // verifying a document the provider did not sign.
    const raw = rawBodyOf(request.body);
    const result = await receiveRiseWebhook({
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
  name: 'webhooks-rise',
  routes: [
    {
      method: 'POST',
      path: RISE_WEBHOOK_PATH,
      handler: riseWebhookHandler(productionDeps),
    },
  ],
});
