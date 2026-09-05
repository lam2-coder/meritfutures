// =============================================================================
// apps/api/src/routes/webhooks-psp.ts
// =============================================================================
// API_CONTRACT SECTION 10's `POST /webhooks/psp/:provider`, AND THE SENTENCE
// THAT SECTION STATES IN CAPITALS IS THE WHOLE DESIGN:
//
//   "All webhooks: HMAC signature verified BEFORE parsing, timestamp within a
//    5 minute window, nonce recorded for replay protection, raw payload stored,
//    processing idempotent on the provider event id, and a 200 returned for
//    duplicates so providers stop retrying."
//   "Unverified signatures return 401 and are logged as security events; they
//    never reach business logic. Out-of-order delivery is deferred and
//    re-evaluated rather than applied (B4 #9)."
//
// -----------------------------------------------------------------------------
// THE ORDERING IS NOT DEFENDED HERE. IT IS DEFENDED BY HAVING NO OTHER PARSE.
// -----------------------------------------------------------------------------
// `PspAdapter.verifyWebhook` is the only function in this workspace that returns
// a parsed webhook body, and it returns one only after the digest agreed
// (`packages/psp/src/webhook.ts`, session 217). This module never calls
// `JSON.parse`. So "verified before parsing" is a module boundary rather than a
// step somebody remembers.
//
// WHAT THIS MODULE HAS TO GET RIGHT INSTEAD IS THE BYTES. A verifier called on
// a re-serialisation of a parsed body verifies a DIFFERENT DOCUMENT: two JSON
// texts that parse equal serialise differently, so every legitimate webhook
// would fail its MAC and answer 401 for a reason nobody could find. That is the
// silent total failure, and `rawBodyOf` refuses rather than reconstructing.
//
// -----------------------------------------------------------------------------
// FASTIFY 5.12.1 DESTROYS THE RAW BODY BEFORE ANY HANDLER RUNS. MEASURED.
// -----------------------------------------------------------------------------
// Probed against the installed version rather than assumed:
//
//   default `application/json` parser   `request.body` is a plain Object and
//                                       `request.raw.readable` is false
//   an unregistered content type        415 before the handler
//   `{ parseAs: 'buffer' }`             `request.body` is the exact bytes,
//                                       AND it applies even when the parser is
//                                       registered after the route
//
// THIS PARAGRAPH READ: "`RouteDefinition` is `{ method, path, handler }` and
// `compose` passes exactly those three to `app.route`, so a route module cannot
// declare that it is served raw. `registry.ts` and `server.ts` are outside this
// session's fence, so the permanent seam is ADR-109 ruling 4 and what stands
// here is `installRawWebhookBodyParser`, which the suite installs and which a
// wiring session moves into `compose`. Until then this route answers 500 rather
// than verifying a document the provider did not sign."
//
// THAT WIRING SESSION WAS ADR-340 AND IT IS DONE. `RouteDefinition` carries
// `rawBody`, this module's route declares it, and `compose` registers it inside
// a child context carrying the buffer parser. A LIVE PROCESS ANSWERED
// `500 internal_error` ON ALL THREE WEBHOOK ROWS UNTIL THAT ROW, with
// `RawBodyUnavailableError` in the log, so no webhook receiver's own answer was
// reachable over HTTP at all; it is now. The correction is written beside the
// paragraph it corrects rather than in place of it, per `RI-14`.
//
// THE CLAUSE NUMBER ABOVE IS ALSO WRONG AND IS KEPT SO THE REPAIR IS VISIBLE.
// ADR-109's raw-body ruling is CLAUSE 6; clause 4 is the unowned replay being a
// second type. `RI-15`/`RI-16` citation-repair rights, exercised by ADR-340.
//
// -----------------------------------------------------------------------------
// THERE IS NO UPDATE STATEMENT IN THIS MODULE AND THAT IS THE DEDUPE WORKING
// -----------------------------------------------------------------------------
// `psp_webhook_events_provider_event_uq (psp, provider_event_id)`
// (`0006_commerce.sql:310`) is INV-M3-03, and this receiver RIDES ON IT rather
// than re-checking it in application code. That forces the order, and the order
// is the interesting part:
//
//   1. apply the business effect, on the transaction
//   2. INSERT the row, carrying the result the application produced
//   3. if the unique index refused the insert, ROLL BACK
//
// A duplicate therefore undoes step 1 and returns 200, so the same provider
// event delivered twice produces exactly one business effect and two 200s. The
// alternative -- insert first, apply, then stamp the result -- needs an UPDATE
// of one row, and no accessor in `packages/db` can name a row: `firmTx.update`
// (`scoped-db.ts:720`) hardcodes `undefined` for its `WHERE` clause and would
// write EVERY row in the table. See `src/idempotency.ts`'s header and ADR-109.
//
// THE TWO 200s ARE BYTE-IDENTICAL, WHICH IS A CONTROL RATHER THAN LAZINESS. A
// response that said "duplicate" would be an oracle: an unauthenticated caller
// cannot reach this far, but a provider's compromised key holder could ask
// which event ids Merit has already seen. A receiver answers "received".
//
// -----------------------------------------------------------------------------
// NO VENDOR EXISTS AND THIS ROUTE SAYS SO WITH A STATUS CODE
// -----------------------------------------------------------------------------
// `packages/psp` ships a port and TWO FAKES (ADR-105). There is no adapter for
// a real provider and shipping one is a procurement decision nobody has taken,
// so `productionDeps.adapters` resolves nothing. The route is REGISTERED,
// because the contract row exists and a missing route would answer 404 and look
// like a contract Merit never wrote.
//
// THIS PARAGRAPH SAID THE LIVE ANSWER WAS "`503 service_unavailable`, which is
// section 2's code for a dependency that is not there", AND IT IS 404. It also
// named `productionAdapters`, which is not a symbol in this file. Both are
// corrected here and kept beside the correction (`RI-14`). The measurement was
// impossible until ADR-340: every webhook row answered `500 internal_error`
// because `compose` installed no raw-body parser, so no receiver's own answer
// was reachable over HTTP and this sentence could not be checked against a
// process. With the parser registered, `POST /api/v1/webhooks/psp/psp_a` on a
// live `MERIT_API_SURFACE=public` process answers `404 not_found`.
//
// THE 404 IS THE RECEIVER'S AND NOT THE ROUTER'S, AND THE DIFFERENCE IS THE
// WHOLE OF WHY THIS IS A CORRECTION AND NOT A DEFECT. `receivePspWebhook` step
// 1 resolves the `:provider` path parameter BEFORE it consults `store` or
// `applier`, and an unknown provider names no resource, so the 404 is reached
// and the 503 in step 2 is not. `PSP_IDS` is closed by a CHECK constraint, so
// with no adapter every provider name is unknown. This is `webhooks-kyc.ts`'s
// answer for `webhooks-kyc.ts`'s reason, and it is `webhooks-rise.ts` that
// answers 503, because that row carries no `:provider` and so names no resource
// that could be absent.
// =============================================================================

import { createHash } from 'node:crypto';

import { WebhookVerificationError } from '@merit/psp';
import type {
  JsonObject,
  PspAdapter,
  PspId,
  VerifiedEvent,
  WebhookHeaders,
  WebhookRefusal,
} from '@merit/psp';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { defineRoutes } from '../registry.ts';
import { PROBLEM_MEDIA_TYPE, problem } from '../server.ts';
import type { Problem } from '../server.ts';

/** API_CONTRACT section 10's row, as the contract writes it. No base path. */
export const PSP_WEBHOOK_PATH = '/webhooks/psp/:provider';

// -----------------------------------------------------------------------------
// The row, and the four results the schema admits
// -----------------------------------------------------------------------------

/**
 * `psp_webhook_events.processing_result`'s CHECK list, closed by the schema.
 *
 * `0006_commerce.sql:283-286`. A fifth member is a migration before it is a
 * type change, which is `PspId`'s own reasoning one package over.
 */
export type PspProcessingResult =
  'applied' | 'duplicate_ignored' | 'out_of_order_deferred' | 'rejected_signature';

/** One `psp_webhook_events` row for a payload that VERIFIED. */
export interface PspWebhookEventRow {
  readonly psp: PspId;
  readonly providerEventId: string;
  readonly eventType: string;
  /** Always `true` on this shape. The refusal row is a different type. */
  readonly signatureVerified: true;
  /** `payload jsonb NOT NULL`, "as received". The verified bytes, parsed once. */
  readonly payload: JsonObject;
  readonly processedAt: Date | null;
  readonly processingResult: PspProcessingResult;
  /** SD-M3-01. Set when the application resolved the event to a purchase. */
  readonly purchaseId: string | null;
  /** SD-M3-01. When the batch should look at a deferred event again. */
  readonly deferredUntil: Date | null;
  /** SD-M3-01. `0` here always: this receiver never re-drives, the batch does. */
  readonly deferAttempts: number;
}

/**
 * One `psp_webhook_events` row for a payload that DID NOT verify.
 *
 * `signature_verified boolean NOT NULL` under `0006`'s own comment, "a payload
 * whose signature did not verify is still stored, and stored with the fact that
 * it did not verify". Session 217's `WebhookVerificationError` carries the psp,
 * the refusal and the raw bytes precisely so this row can be written.
 */
export interface PspWebhookRefusalRow {
  readonly psp: PspId;
  /** Synthesised. See {@link unverifiedEventId}: nothing here is trustworthy. */
  readonly providerEventId: string;
  readonly eventType: string;
  readonly signatureVerified: false;
  /** The bytes as received, hex, because they may not be JSON at all. */
  readonly payload: JsonObject;
  readonly processingResult: 'rejected_signature';
  readonly refusal: WebhookRefusal;
}

/**
 * The prefix every synthesised event id carries.
 *
 * `provider_event_id text NOT NULL` and a refused payload names no event this
 * receiver may believe. So the id is the SHA-256 of the raw bytes under a
 * prefix, which makes the unique index do something useful with it: a provider
 * retrying one refused payload writes ONE row rather than one per delivery.
 *
 * WHAT IT DOES NOT DO IS BOUND THE TABLE, AND THE GAP IS NAMED HERE RATHER THAN
 * IMPLIED. A caller that VARIES the body gets a new digest and a new row every
 * time, and API_CONTRACT section 11 says webhooks are "not rate limited;
 * protected by signature verification" -- which is true of the business path
 * and is not true of this write. It is an unauthenticated insert.
 */
export const UNVERIFIED_EVENT_ID_PREFIX = 'unverified:';

/** The synthesised id. Deterministic in the bytes, so retries dedupe. */
export function unverifiedEventId(raw: Uint8Array): string {
  return `${UNVERIFIED_EVENT_ID_PREFIX}${createHash('sha256').update(raw).digest('hex')}`;
}

// -----------------------------------------------------------------------------
// The ports
// -----------------------------------------------------------------------------

/**
 * What the application of one verified event decided.
 *
 * `deferred` is B4 #9 and API_CONTRACT section 10's last sentence: out-of-order
 * delivery is DEFERRED AND RE-EVALUATED rather than applied. FM-M3-03's
 * canonical case is a refund arriving before its payment, and applying it would
 * record a refund against nothing.
 */
export type PspApplication =
  | { readonly kind: 'applied'; readonly purchaseId: string | null }
  | { readonly kind: 'deferred'; readonly until: Date };

/** One open transaction, as this receiver needs to see it. */
export interface PspWebhookTx {
  /**
   * INSERT the row. `'duplicate'` when
   * `psp_webhook_events_provider_event_uq` refused it.
   *
   * THE UNIQUE INDEX IS THE MUTEX AND THIS IS NOT A CHECKED INSERT. A read
   * followed by an insert is two statements with a race between them, and the
   * race is exactly the concurrent redelivery this endpoint exists to survive.
   */
  record(row: PspWebhookEventRow): Promise<'inserted' | 'duplicate'>;
  /** Discard everything done on this transaction, the application included. */
  rollback(): Promise<void>;
}

/**
 * What a verified event MEANS, which is deliberately not this module's.
 *
 * IT TAKES THE TRANSACTION SO IT CANNOT BE WRITTEN AGAINST A DIFFERENT ONE than
 * the claim lands in. If the application committed and the claim did not, a
 * retried delivery would apply the event twice with the table showing one row.
 */
export interface PspEventApplier {
  apply(event: VerifiedEvent, tx: PspWebhookTx): Promise<PspApplication>;
}

/** Where the rows go. */
export interface PspWebhookStore {
  /** Run `fn` in ONE transaction and commit what it leaves, unless it rolled back. */
  transact<T>(fn: (tx: PspWebhookTx) => Promise<T>): Promise<T>;
  /**
   * The refusal row, on its OWN transaction.
   *
   * Never on the caller's: there is no caller's, because a refusal happens
   * before any transaction is opened, and INV-M3-05 is that an unverified
   * signature never reaches business logic. A duplicate is tolerated silently,
   * because {@link unverifiedEventId} makes a retried refusal collide by
   * construction.
   */
  recordRefusal(row: PspWebhookRefusalRow): Promise<void>;
}

/** Which adapter serves a `:provider` path parameter, or `null` for none. */
export type PspAdapterResolver = (provider: string) => PspAdapter | null;

/** Everything the receiver reaches the world through. All of it injected. */
export interface PspWebhookDeps {
  readonly adapters: PspAdapterResolver;
  /** `null` until a wiring session gives `apps/api` a database. ADR-109. */
  readonly store: PspWebhookStore | null;
  /** `null` until `POST /checkout` exists to have written the purchase. */
  readonly applier: PspEventApplier | null;
  /** Injected. Nothing here reads a clock of its own. */
  readonly now: () => Date;
}

// -----------------------------------------------------------------------------
// The receiver
// -----------------------------------------------------------------------------

/** What the receiver decided, before a framework has been involved. */
export interface ReceiverResponse {
  readonly status: number;
  readonly body: JsonObject;
  /** True for a problem document, which carries its own media type. */
  readonly isProblem: boolean;
}

/** Arguments to the one receiving path in this module. */
export interface ReceivePspWebhookArgs {
  /** The `:provider` path parameter, UNTRUSTED and resolved before anything else. */
  readonly provider: string;
  /** The body AS RECEIVED. Never a re-serialisation. See {@link rawBodyOf}. */
  readonly raw: Uint8Array;
  readonly headers: WebhookHeaders;
  /** API_CONTRACT section 2's `instance`: the request id, for correlation. */
  readonly instance: string;
  readonly deps: PspWebhookDeps;
}

/**
 * The 200 body, and it is the same one for every accepted outcome.
 *
 * Applied, deferred and duplicate are indistinguishable to the provider on
 * purpose. See this file's header.
 */
const RECEIVED: JsonObject = { received: true };

function accepted(): ReceiverResponse {
  return { status: 200, body: RECEIVED, isProblem: false };
}

function refused(p: Problem): ReceiverResponse {
  return { status: p.status, body: p as unknown as JsonObject, isProblem: true };
}

/**
 * Receive one PSP webhook. Framework-free, so the ordering is testable without
 * a socket.
 */
export async function receivePspWebhook(args: ReceivePspWebhookArgs): Promise<ReceiverResponse> {
  const { provider, raw, headers, instance, deps } = args;

  // 1. THE PATH PARAMETER, BEFORE ANY BYTE OF THE BODY IS LOOKED AT. An unknown
  //    provider names no secret, so there is nothing to verify against and
  //    nothing to store. It is `not_found` and not `validation_failed`: the
  //    path names a resource, and `PSP_IDS` is closed by a CHECK constraint.
  const adapter = deps.adapters(provider);
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
  //    parse, all of it inside `packages/psp`. This module never parses.
  let event: VerifiedEvent;
  try {
    event = await adapter.verifyWebhook(raw, headers);
  } catch (cause) {
    // A refusal from the port is the shape below. Anything else is a defect in
    // the adapter and is rethrown, because answering 401 for it would report a
    // security event that did not happen.
    if (!(cause instanceof WebhookVerificationError)) throw cause;
    await store.recordRefusal({
      psp: cause.psp,
      providerEventId: unverifiedEventId(cause.raw),
      eventType: `${UNVERIFIED_EVENT_ID_PREFIX}${cause.refusal}`,
      signatureVerified: false,
      payload: { unverified_body_hex: Buffer.from(cause.raw).toString('hex') },
      processingResult: 'rejected_signature',
      refusal: cause.refusal,
    });
    // INV-M3-05. `applier` was not called and cannot have been: it is reached
    // only below this catch.
    return refused(problem('unauthenticated', 401, instance));
  }

  // 4. APPLY, CLAIM, AND ROLL BACK IF THE CLAIM LOST. See this file's header
  //    for why the application runs first.
  return store.transact(async (tx) => {
    const application = await applier.apply(event, tx);
    const now = deps.now();
    const row: PspWebhookEventRow =
      application.kind === 'applied'
        ? {
            psp: event.psp,
            providerEventId: event.providerEventId,
            eventType: event.eventType,
            signatureVerified: true,
            payload: event.payload,
            processedAt: now,
            processingResult: 'applied',
            purchaseId: application.purchaseId,
            deferredUntil: null,
            deferAttempts: 0,
          }
        : {
            psp: event.psp,
            providerEventId: event.providerEventId,
            eventType: event.eventType,
            signatureVerified: true,
            payload: event.payload,
            // NOT PROCESSED. `processed_at` is when the event was APPLIED, and a
            // deferred event has not been. The batch stamps it when it is.
            processedAt: null,
            processingResult: 'out_of_order_deferred',
            purchaseId: null,
            deferredUntil: application.until,
            // ZERO, ALWAYS, AND THE RECEIVER NEVER INCREMENTS IT. `defer_attempts`
            // counts RE-DRIVES and this is the first arrival. The re-driver is
            // the batch's, `psp_webhook_events_deferred_idx` is its index, and
            // incrementing here would report an attempt nobody made.
            deferAttempts: 0,
          };

    if ((await tx.record(row)) === 'duplicate') {
      // The unique index refused the claim, so this delivery is a redelivery.
      // Rolling back is what makes "exactly one business effect" true: the
      // application above ran on this transaction and goes with it.
      await tx.rollback();
      return accepted();
    }
    return accepted();
  });
}

// -----------------------------------------------------------------------------
// The framework edge
// -----------------------------------------------------------------------------

/** Raised when Fastify handed this handler something other than the bytes. */
export class RawBodyUnavailableError extends Error {
  constructor(received: string) {
    super(
      `the PSP webhook handler was given \`${received}\` where the raw request bytes belong. ` +
        'API_CONTRACT section 10 requires the HMAC verified BEFORE parsing, and a body this ' +
        'process already parsed cannot be verified: re-serialising it would digest a different ' +
        'document and refuse every legitimate webhook. Declare `rawBody: true` on this route in ' +
        'its route module, so `compose` registers it inside the context carrying the buffer ' +
        'content-type parser (`installRawBodyParser`, historically ' +
        '`installRawWebhookBodyParser`). ADR-340, ADR-109 clause 6.',
    );
    this.name = 'RawBodyUnavailableError';
  }
}

/**
 * The bytes, or a refusal. NEVER a reconstruction.
 *
 * `Buffer` is a `Uint8Array`, so one check covers both spellings.
 */
export function rawBodyOf(body: unknown): Uint8Array {
  if (body instanceof Uint8Array) return body;
  const received =
    body === null
      ? 'null'
      : body === undefined
        ? 'undefined'
        : typeof body === 'object'
          ? body.constructor.name || 'object'
          : typeof body;
  throw new RawBodyUnavailableError(received);
}

/**
 * Hand this route's content type through as bytes.
 *
 * THIS DOCBLOCK READ: "ONE LINE, AND IT IS NOT IN `server.ts` FOR A REASON
 * RATHER THAN A FENCE. A Fastify content-type parser is per encapsulation
 * context, so registering this on the root instance takes JSON parsing away
 * from every route that lands later. ADR-109 ruling 4 is that `compose` should
 * register raw routes inside their own context; until then this is exported so
 * the suite can install it and a wiring session can find it by name."
 *
 * ADR-340 IS THAT SESSION. The function moved to `registry.ts`, beside the only
 * production caller it now has, and the argument above survives the move
 * unchanged: it is why `compose` registers raw routes in a CHILD context and
 * never on the root. What is re-exported here is that one definition and not a
 * copy, because a second copy would be a second thing to keep true.
 *
 * THE OLD NAME IS KEPT AND THE ALIAS IS DELIBERATE. Three suites import this
 * symbol by this name to build an app without going through `compose`, and
 * renaming their call sites is churn in files concurrent rows hold. The name in
 * `registry.ts` drops `Webhook` because `rawBody` is a property of a route and
 * not of a domain.
 */
export { installRawBodyParser as installRawWebhookBodyParser } from '../registry.ts';

/**
 * The deployment's dependencies, which today resolve nothing.
 *
 * `packages/psp` holds a port and two FAKES. A fake must never serve a real
 * provider, so this resolves `null`. Stated as code rather than as a comment,
 * because a comment saying "not wired yet" beside a handler that would happily
 * run a fake is how a fake ships.
 *
 * THIS DOCBLOCK SAID "the route answers 503" AND THE MEASURED ANSWER IS 404.
 * `receivePspWebhook` resolves the `:provider` before it looks at `store` or
 * `applier`, so `adapters: () => null` makes every provider name unknown and
 * step 1's `not_found` is reached first. See this file's header for the
 * measurement and why it could not be taken before ADR-340.
 */
export const productionDeps: PspWebhookDeps = {
  adapters: () => null,
  store: null,
  applier: null,
  now: () => new Date(),
};

/** Build the handler over one set of dependencies. The suite injects its own. */
export function pspWebhookHandler(deps: PspWebhookDeps) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const raw = rawBodyOf(request.body);
    const params = request.params as { readonly provider?: string };
    const result = await receivePspWebhook({
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
  name: 'webhooks-psp',
  routes: [
    {
      method: 'POST',
      path: PSP_WEBHOOK_PATH,
      handler: pspWebhookHandler(productionDeps),
      // THE BYTES, OR THIS RECEIVER CANNOT VERIFY ANYTHING. API_CONTRACT
      // section 10 wants the HMAC verified BEFORE parsing. ADR-340.
      rawBody: true,
    },
  ],
});
