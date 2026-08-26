// =============================================================================
// apps/api/src/routes/kyc.ts
// =============================================================================
// API_CONTRACT SECTION 7's `POST /kyc/session` AND `GET /kyc/status`, AND THE
// SENTENCE THAT DECIDES BOTH OF THEM:
//
//   "Merit never proxies documents; the client goes to the provider's hosted
//    flow. Auth: session."
//
// SO `POST /kyc/session` RETURNS A URL. It does not fetch it, embed it, or put
// anything of the provider's behind Merit's origin, and there is no shape
// anywhere in `@merit/kyc` a document could be assigned to. INV-M19-07.
//
// -----------------------------------------------------------------------------
// THE GATE IS EVALUATED HERE AND THE TRIGGER SET IS NOT DECIDED HERE
// -----------------------------------------------------------------------------
// ADR-021 ruled placement a composite trigger set firing at whichever member is
// reached FIRST, and the FREEZE gate ruled the set
// `{second_distinct_account_purchase, pre_funded}`. `@merit/kyc`'s
// `evaluateGate` is that ruling transcribed; this module supplies it facts and
// writes down what it said.
//
// THE CONFIG IS READ FROM THE ACCOUNT'S PINNED PLAN VERSION AND IS NEVER
// DEFAULTED. INV-M19-01, and `readTriggerConfig` refuses a missing or malformed
// `kyc.triggers` rather than substituting the frozen set, because a reader that
// filled in a missing key would BE the hardcode the invariant exists to lock
// out. A plan whose config this route cannot read is a 500 and a log line, not
// a trader gated under a configuration nobody pinned.
//
// -----------------------------------------------------------------------------
// `G-PLACEMENT-REACHED` HAS TWO OTHER CALL SITES AND NEITHER IS IN THIS FENCE
// -----------------------------------------------------------------------------
// M19 section 3.1: the gate fires at checkout under the purchase triggers and
// at `phase.passed` under `pre_funded`. `routes/checkout.ts` is session 220's
// file and the evaluation worker is `apps/worker`'s, so those two sites are a
// SEAM this session reports rather than cuts. What makes the seam safe to leave
// is that the evaluator is one pure function in a package both deployables can
// import, so the two call sites add a call and decide nothing.
//
// THE CONSEQUENCE FOR TELEMETRY IS NAMED RATHER THAN IMPLIED. This module
// writes the `session_created` funnel step and NEVER `gate_reached`, which
// belongs to the site that evaluated the gate. `gate_reached` with no
// `session_created` after it IS the abandonment, and AS-M19-08 is that the
// abandonment is the measurement: writing both from here would record a funnel
// in which nobody ever drops out.
//
// -----------------------------------------------------------------------------
// EVERY WRITE IS A PORT AND THE DEPLOYMENT ANSWERS 503, WHICH IS ADR-109's SHAPE
// -----------------------------------------------------------------------------
// `apps/api` declares no database and the accessor cannot serve this path
// anyway on the webhook side (see `webhooks-kyc.ts`). A backend that returned
// plausible values would be a fixture serving real traffic, so the default
// fails closed on every method and the suite injects its own.
//
// NO PROVIDER IS SELECTED AND NOTHING HERE NAMES ONE. ADR-021: the adapter is
// vendor-agnostic and the selected provider is named in the privacy policy at
// selection time, which makes provider choice a disclosure event. `@merit/kyc`
// ships a port and one FAKE; `productionKycDeps` resolves nothing.
// =============================================================================

import {
  effectiveTriggers,
  evaluateGate,
  readTriggerConfig,
  triggerConditionHolds,
  type GateFacts,
  type KycProvider,
  type KycTrigger,
} from '@merit/kyc';
import type { FastifyReply } from 'fastify';

import { defineRoutes } from '../registry.ts';
import { PROBLEM_MEDIA_TYPE, problem } from '../server.ts';
import {
  requiredFactorTable,
  toRoutes,
  withSessionContext,
  type AuthSession,
  type EndpointSpec,
} from './auth.ts';

/** API_CONTRACT section 7's rows, as the contract writes them. No base path. */
export const KYC_SESSION_PATH = '/kyc/session';
export const KYC_STATUS_PATH = '/kyc/status';

// -----------------------------------------------------------------------------
// The contract's two response shapes
// -----------------------------------------------------------------------------

/** `kyc_status`, the enum `0001_extensions_and_enums.sql:29-31` declares. */
export type KycState = 'kyc_required' | 'pending' | 'verified' | 'rejected' | 'expired';

/**
 * API_CONTRACT section 7's `KycSessionResponse`, field for field.
 *
 * `hosted_url` IS THE WHOLE POINT AND `applicant_ref` IS THE ONLY POINTER MERIT
 * KEEPS (`0003_kyc.sql:49`'s own words). There is no fifth field and no field
 * for anything the provider collected.
 */
export interface KycSessionResponse {
  readonly provider: string;
  readonly hosted_url: string;
  readonly expires_at: string;
  readonly applicant_ref: string;
}

/**
 * What a trader is told to do next. CLOSED, and it is INV-M19-09.
 *
 * "Every rejection tells the trader what to do next, and NEVER states the
 * provider's internal reason verbatim." A free-text field here would be the
 * hole that invariant exists to close, because the nearest available string at
 * the moment somebody implements it is always the provider's own. So this is a
 * vocabulary the server computes and the client renders, and the provider's
 * reason code lives on the row and reaches no response.
 */
export type KycActionRequired =
  /** A trigger has fired and nothing has been started. */
  | 'start_verification'
  /** A hosted flow is open and the provider has not decided. */
  | 'continue_verification'
  /** Rejected, and M19 section 3.1's bounded retry has attempts left. */
  | 'retry_verification'
  /**
   * Rejected with the retries exhausted.
   *
   * M19 section 3.1: "a trader who exhausts it reaches a human, never a wall".
   * This token is that sentence, and the wall is what its absence would be.
   */
  | 'contact_support'
  /** `expires_at` has passed. A task rather than an enforcement. */
  | 'reverify';

/** API_CONTRACT section 7's `KycStatus`, field for field. */
export interface KycStatus {
  readonly state: KycState;
  readonly placement: string;
  readonly verified_at: string | null;
  readonly expires_at: string | null;
  readonly action_required: KycActionRequired | null;
}

// -----------------------------------------------------------------------------
// The port
// -----------------------------------------------------------------------------

/**
 * The facts the gate is evaluated over, all of them measured by the backend.
 *
 * `triggersConfig` IS RAW AND IS READ HERE. It is `plan_versions.rules`'s
 * `kyc.triggers` exactly as the jsonb holds it, and `readTriggerConfig` is
 * applied in this module rather than in the backend, so the one place that can
 * refuse a malformed configuration is the one place INV-M19-01 is enforced.
 */
export interface KycGateFacts {
  readonly triggersConfig: unknown;
  /** `plans.code`. `kyc_funnel_events.plan_code` is `NOT NULL`. */
  readonly planCode: string;
  /** Read from the pinned plan's SHAPE. INV-M19-02, and never configurable. */
  readonly instantFunded: boolean;
  readonly purchaseCount: number;
  readonly distinctConcurrentAccounts: number;
  readonly evaluationPassed: boolean;
  readonly payoutRequested: boolean;
  /** `kyc_funnel_events.attempt_number`, which the CHECK requires above zero. */
  readonly attemptNumber: number;
  /**
   * M19 section 3.1's bounded retry, ALREADY DECIDED.
   *
   * The bound is a plan parameter and this route does not hold one: a constant
   * here would be the hardcode the standing parameter ruling refuses, in a
   * module that has just refused the same thing about `kyc.triggers`.
   */
  readonly retriesExhausted: boolean;
}

/** One `kyc_verifications` row, projected to what this surface reads. */
export interface KycVerificationRow {
  readonly state: KycState;
  /** The trigger that FIRED, not the set that was configured. U-05, ADR-021. */
  readonly placement: KycTrigger;
  readonly verifiedAt: string | null;
  readonly expiresAt: string | null;
  readonly providerApplicantId: string;
  /**
   * `kyc_verifications.rejection_reason`, the provider's own code.
   *
   * IT IS ON THE PORT AND IT REACHES NO RESPONSE. Carried here so the suite can
   * hand this module a row that has one and assert it appears nowhere in what
   * the trader is sent. INV-M19-09.
   */
  readonly providerRejectionCode: string | null;
}

/** What `POST /kyc/session` asks the backend to write, in ONE transaction. */
export interface KycVerificationDraft {
  readonly provider: string;
  readonly providerApplicantId: string;
  /** `kyc_verifications.placement`, which is `NOT NULL` under a CHECK. */
  readonly placement: KycTrigger;
  readonly planCode: string;
  readonly attemptNumber: number;
  /** The hosted flow's expiry, as the provider stated it. */
  readonly hostedExpiresAt: string;
}

/**
 * Everything this surface needs from a database, and no fourth method.
 *
 * `openVerification` WRITES TWO ROWS IN ONE TRANSACTION and the pairing is the
 * requirement rather than an optimisation: the `kyc_verifications` row is what
 * INV-M19-01 says records the placement that produced it, and the
 * `kyc_funnel_events` row at step `session_created` is what ADR-021's condition
 * 1 says makes the per-trigger funnel measurable. A verification with no funnel
 * row is invisible to the post-beta adjudication; a funnel row with no
 * verification is a step that did not happen.
 *
 * IT IS A NEW ROW EVERY TIME AND THERE IS NO UPDATE ON THIS PORT. INV-M19-06:
 * a re-verification is a new verification and never a re-read of a stored
 * result, and SD-M19-01 makes that a row with `supersedes` set. A retry after a
 * rejection is a new `initial` row rather than a supersession, because
 * `kyc_verifications_supersession_matches_purpose` requires a non-`initial`
 * purpose to supersede something and the purpose vocabulary has no member for
 * "the photograph was blurry and they tried again".
 */
export interface KycBackend {
  gateFacts(session: AuthSession): Promise<KycGateFacts>;
  /** The identity's current verification, or `null` when none was ever created. */
  currentVerification(session: AuthSession): Promise<KycVerificationRow | null>;
  openVerification(session: AuthSession, draft: KycVerificationDraft): Promise<void>;
}

/** Thrown by the default backend. Answered as 503 rather than 500. */
export class KycBackendUnwired extends Error {
  constructor(method: string) {
    super(
      `KycBackend.${method} is not wired. The KYC surface is declared and its persistence ` +
        'is not implemented: `apps/api` declares no database, and the webhook half of this ' +
        'module cannot be served by the accessor at any authority. See routes/webhooks-kyc.ts ' +
        'and ADR-114.',
    );
    this.name = 'KycBackendUnwired';
  }
}

function unwired(method: string): () => Promise<never> {
  return () => Promise.reject(new KycBackendUnwired(method));
}

/** The default, and it fails CLOSED on every method. */
export const UNWIRED_KYC_BACKEND: KycBackend = {
  gateFacts: unwired('gateFacts'),
  currentVerification: unwired('currentVerification'),
  openVerification: unwired('openVerification'),
};

/**
 * Everything this module reaches the world through. All of it injected.
 *
 * `returnUrl` IS `null` HERE AND THAT IS ADR-012 RATHER THAN AN OVERSIGHT. It
 * is where the provider sends the trader back to, which is a deployment
 * hostname, and this repository holds none. A route that invented one would
 * hand a vendor a URL nobody chose.
 */
export interface KycDeps {
  readonly provider: KycProvider | null;
  readonly backend: KycBackend;
  readonly returnUrl: string | null;
}

/**
 * The deployment's dependencies, which today resolve nothing.
 *
 * Stated as code rather than as a comment, because a comment saying "not wired
 * yet" beside a handler that would happily run a fake is how a fake ships.
 */
export const productionKycDeps: KycDeps = {
  provider: null,
  backend: UNWIRED_KYC_BACKEND,
  returnUrl: null,
};

let deps: KycDeps = productionKycDeps;

/** Install the dependencies. A wiring slice calls this; so does the suite. */
export function useKycDeps(next: KycDeps): void {
  deps = next;
}

/** Restore the fail-closed default. */
export function resetKycDeps(): void {
  deps = productionKycDeps;
}

/** The installed dependencies. */
export function currentKycDeps(): KycDeps {
  return deps;
}

// -----------------------------------------------------------------------------
// Problem documents, in the contract's shape
// -----------------------------------------------------------------------------

function sendProblem(reply: FastifyReply, body: Record<string, unknown>): FastifyReply {
  const status = typeof body['status'] === 'number' ? (body['status'] as number) : 500;
  return reply.code(status).type(PROBLEM_MEDIA_TYPE).send(body);
}

/**
 * API_CONTRACT section 2's `conflict`, with a `detail` naming which state.
 *
 * SECTION 2's CODE TABLE IS CLOSED AND `conflict` IS THE ONE FOR "State
 * conflict (already claimed, already exists)". Every refusal in this module is
 * one of those: a verification is already open, a decision already stands, or
 * no trigger has fired so there is nothing to start. Inventing a code would put
 * a seventeenth in a table the contract closed at sixteen.
 */
function sendConflict(reply: FastifyReply, requestId: string, detail: string): FastifyReply {
  return sendProblem(reply, { ...problem('conflict', 409, requestId), detail });
}

/** Section 2's 503, for a dependency that is not there. */
function sendUnavailable(reply: FastifyReply, requestId: string): FastifyReply {
  return sendProblem(reply, {
    ...problem('service_unavailable', 503, requestId),
    title: 'Service unavailable',
  });
}

// -----------------------------------------------------------------------------
// The gate, over the facts the backend measured
// -----------------------------------------------------------------------------

/** The facts, with the configuration read and refused rather than defaulted. */
function gateFactsFrom(facts: KycGateFacts): GateFacts {
  return {
    triggers: readTriggerConfig(facts.triggersConfig),
    planCode: facts.planCode,
    instantFunded: facts.instantFunded,
    purchaseCount: facts.purchaseCount,
    distinctConcurrentAccounts: facts.distinctConcurrentAccounts,
    evaluationPassed: facts.evaluationPassed,
    payoutRequested: facts.payoutRequested,
  };
}

/**
 * The trigger a trader has NOT reached yet and will reach first.
 *
 * `KycStatus.placement` is a non-nullable string in the contract and a trader
 * who has never been gated has no fired trigger to report. Reporting the
 * EARLIEST UNREACHED member of their own pinned set is the honest fill: it is
 * the moment they will actually be asked, drawn from the configuration that
 * governs them, and it is exactly what a portal screen wants to say.
 *
 * The fallback is the earliest configured trigger, which is reachable only when
 * every member already holds, and in that case the gate has fired and this
 * function is not consulted.
 */
function pendingTrigger(gate: GateFacts): KycTrigger {
  // `effectiveTriggers` is `@merit/kyc`'s and applies the firing order and
  // INV-M19-02's imposed member. A second ordering in this file would be a
  // second statement of one ruling.
  const effective = effectiveTriggers(gate);
  const unreached = effective.find((trigger) => !triggerConditionHolds(trigger, gate));
  return unreached ?? (effective[0] as KycTrigger);
}

/**
 * What the trader should do next, from the state and the facts, and NEVER from
 * the provider.
 */
function actionFor(
  row: KycVerificationRow | null,
  gateReached: boolean,
  retriesExhausted: boolean,
): KycActionRequired | null {
  if (row === null) return gateReached ? 'start_verification' : null;
  switch (row.state) {
    case 'kyc_required':
      return gateReached ? 'start_verification' : null;
    case 'pending':
      return 'continue_verification';
    case 'rejected':
      return retriesExhausted ? 'contact_support' : 'retry_verification';
    case 'expired':
      return 'reverify';
    case 'verified':
      return null;
  }
}

/**
 * The allowlist. Every field API_CONTRACT section 7's `KycStatus` declares.
 *
 * IT IS A COPY AND THAT IS THE POINT, on `routes/me.ts`'s own argument: a
 * spread would be one character shorter and would be the `SELECT *` section 1
 * forbids. Here it also carries INV-M19-09: `providerRejectionCode` is on the
 * row this function reads and there is no line below that could emit it.
 */
function projectStatus(status: KycStatus): KycStatus {
  return {
    state: status.state,
    placement: status.placement,
    verified_at: status.verified_at,
    expires_at: status.expires_at,
    action_required: status.action_required,
  };
}

// -----------------------------------------------------------------------------
// The endpoints
// -----------------------------------------------------------------------------

/**
 * The attempt key handed to the provider when the client supplied none.
 *
 * A NEW ATTEMPT IS A NEW SESSION WITH A NEW KEY (M03 section 3.2's rule, and
 * `PurchaseIntent`'s for the same reason): keying on the subject would make a
 * legitimate second attempt look like a duplicate of the first, and M19 section
 * 3.1 rules that rejection is not terminal precisely because most rejections
 * are lighting rather than fraud.
 *
 * IT IS DERIVED AND NEVER GENERATED. A route may not invent randomness: an
 * unpredictable key makes a retry indistinguishable from a new attempt to the
 * vendor as well as to a test. The attempt ordinal is the backend's, and it is
 * the same number the funnel row carries.
 */
export function attemptKey(identityId: string, attemptNumber: number): string {
  return `kyc:session:${identityId}:${attemptNumber}`;
}

/**
 * API_CONTRACT section 1: *"Every mutating endpoint accepts `Idempotency-Key`"*
 * and this is not one of the three it makes REQUIRED.
 *
 * THE HEADER IS PASSED TO THE VENDOR AND IS NOT REPLAYED THROUGH
 * `idempotency_keys`, and the reason is ADR-109 clause 3: `IdempotencyStore`
 * has no implementation in this tree, because nothing in `packages/db` could
 * name one row when it was written. Wiring the layer here would be a second
 * implementation of a protocol that already exists and cannot run. What the key
 * DOES do is bound duplicate SESSIONS at the provider, which is the duplicate
 * that costs money.
 */
function suppliedKey(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): string | null {
  const value = headers['idempotency-key'];
  if (typeof value === 'string' && value !== '') return value;
  return null;
}

export const KYC_ENDPOINTS: readonly EndpointSpec[] = [
  {
    method: 'POST',
    path: KYC_SESSION_PATH,
    // API_CONTRACT section 7: "Auth: session". A single factor, and NOT C-27's
    // elevation: starting an identity check is not a payout destination change,
    // a contact change or an external withdrawal, and requiring elevation to
    // begin one would put a passkey in front of the gate that exists to
    // establish who the person is in the first place.
    required: 'session',
    handle: withSessionContext(async ({ request, reply, session }) => {
      const { provider, backend, returnUrl } = currentKycDeps();
      // NO VENDOR AND NO RETURN URL MEANS NO SESSION. A deployment that cannot
      // hand the trader to a provider must not write a row saying it did.
      if (provider === null || returnUrl === null) return sendUnavailable(reply, request.id);

      const facts = await backend.gateFacts(session);
      // `readTriggerConfig` throws `KycConfigError` on a plan this route may not
      // guess about. It is NOT caught: the framework's handler answers 500 and
      // logs it, which is what a data defect on the money path deserves.
      const gate = gateFactsFrom(facts);

      const current = await backend.currentVerification(session);
      if (current !== null) {
        const refusal = openVerificationRefusal(current, facts.retriesExhausted);
        if (refusal !== null) return sendConflict(reply, request.id, refusal);
      }

      const evaluation = evaluateGate(gate);
      if (evaluation.kind !== 'reached') {
        return sendConflict(
          reply,
          request.id,
          'No configured verification trigger has been reached for this identity. ' +
            'Verification is requested when a trigger fires, and this plan version ' +
            `watches ${gate.triggers.join(' and ')}.`,
        );
      }

      const hosted = await provider.createSession({
        identityId: session.identityId,
        returnUrl,
        idempotencyKey:
          suppliedKey(request.headers) ?? attemptKey(session.identityId, facts.attemptNumber),
      });

      // THE ROW IS WRITTEN AFTER THE PROVIDER ANSWERED AND NOT BEFORE. A
      // verification row naming an applicant the vendor never minted would be a
      // pending check nobody can complete, and `provider_applicant_id` is
      // `NOT NULL` precisely because the row without it is meaningless.
      await backend.openVerification(session, {
        provider: hosted.provider,
        providerApplicantId: hosted.providerApplicantId,
        placement: evaluation.trigger,
        planCode: facts.planCode,
        attemptNumber: facts.attemptNumber,
        hostedExpiresAt: hosted.expiresAt,
      });

      const body: KycSessionResponse = {
        provider: hosted.provider,
        hosted_url: hosted.hostedUrl,
        expires_at: hosted.expiresAt,
        applicant_ref: hosted.providerApplicantId,
      };
      return body;
    }),
  },
  {
    method: 'GET',
    path: KYC_STATUS_PATH,
    // A read surface. `GET /kyc/status` is what a trader loads to find out why
    // they are blocked, and requiring elevation to read it would be the boundary
    // learned by hitting it that M04 section 3.7 is written against.
    required: 'session',
    handle: withSessionContext(async ({ session }) => {
      const { backend } = currentKycDeps();
      const facts = await backend.gateFacts(session);
      const gate = gateFactsFrom(facts);
      const current = await backend.currentVerification(session);
      const evaluation = evaluateGate(gate);
      const gateReached = evaluation.kind === 'reached';

      const status: KycStatus = {
        state: current?.state ?? 'kyc_required',
        // The trigger that FIRED if one has, the one that WILL fire otherwise.
        placement:
          current?.placement ??
          (evaluation.kind === 'reached' ? evaluation.trigger : pendingTrigger(gate)),
        verified_at: current?.verifiedAt ?? null,
        expires_at: current?.expiresAt ?? null,
        action_required: actionFor(current, gateReached, facts.retriesExhausted),
      };
      return projectStatus(status);
    }),
  },
];

/**
 * Why an existing verification refuses a new session, or `null` to allow one.
 *
 * THE THREE REFUSALS ARE THREE DIFFERENT FACTS AND THEY GET THREE DIFFERENT
 * SENTENCES, because a trader who is told "conflict" and nothing else learns
 * that something is wrong and not what.
 */
export function openVerificationRefusal(
  current: KycVerificationRow,
  retriesExhausted: boolean,
): string | null {
  switch (current.state) {
    case 'pending':
      return 'A verification is already open for this identity. Finish the one in progress.';
    case 'verified':
      return 'This identity is already verified.';
    case 'expired':
      // A NEW verification with `verification_purpose = reverify_expiry` and a
      // `supersedes` pointing at this row is what SD-M19-01 requires, and
      // re-verification is M19's rather than P3's stated content. Refusing is
      // honest; writing an `initial` row here would break the supersession
      // chain INV-M19-06 exists to keep.
      return 'This verification has expired and re-verification is not available on this endpoint.';
    case 'rejected':
      return retriesExhausted
        ? 'This verification cannot be retried. Support will take it from here.'
        : null;
    case 'kyc_required':
      return null;
  }
}

/** The declaration as data, on `auth.ts`'s shape. `CI-06k` reads its document. */
export const KYC_REQUIRED_FACTORS = requiredFactorTable(KYC_ENDPOINTS);

export default defineRoutes({
  name: 'kyc',
  routes: toRoutes(KYC_ENDPOINTS),
});
