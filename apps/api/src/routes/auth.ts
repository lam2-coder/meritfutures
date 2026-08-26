// =============================================================================
// apps/api/src/routes/auth.ts
// =============================================================================
// API_CONTRACT section 3's seven auth headings, and C-27's elevation boundary.
//
// -----------------------------------------------------------------------------
// C-27 IS A TYPE HERE AND IT IS NOT A CHECK
// -----------------------------------------------------------------------------
// `ElevationFactor` admits `passkey` and `dual_channel` and nothing else, which
// is `sessions.elevated_by_factor`'s CHECK list at `0029:581` written as a
// union. API_CONTRACT section 12's row for an SMS-established factor expects
// `validation_failed` because *"there is no such value to send"*, and the union
// is what makes that sentence true: `{ factor: 'sms_otp' }` is not an
// `ElevateRequest`, so a handler that accepted one WOULD NOT COMPILE. The suite
// watches that with `@ts-expect-error`, which `tsc` reports as an error of its
// own the day the union widens, so the refusal is checked by `pnpm run
// typecheck` rather than asserted at run time by a test that could be deleted.
//
// A SIM-swapped session can therefore see everything and change nothing, and
// `0029`'s own comment states the reason the database agrees: *"the database has
// no value for the thing such a handler would have to write"*.
//
// -----------------------------------------------------------------------------
// THE REQUIRED FACTOR IS DECLARED ONCE, BESIDE THE HANDLER, AND IT IS LOAD BEARING
// -----------------------------------------------------------------------------
// [M04:265]: each sensitive endpoint declares its required factor *"so that a
// control's disabled state and the server's refusal are read from one
// declaration rather than two lists that drift"*, and API_CONTRACT section 12
// makes that declaration the thing `CI-06k` audits. `ENDPOINTS` below is that
// declaration: every entry states a `required` drawn from section 12's closed
// six-token vocabulary, and `endpointHandler` applies it BEFORE the handler
// runs. A route cannot be registered without stating its factor, because the
// route list is derived from the same array, and no handler in this file
// contains an authorization check of its own.
//
// `RouteDefinition` carries no factor field and `registry.ts` is outside this
// session's fence, so the declaration lives here rather than one layer down.
// That is a placement decision and it is stated rather than left to be found.
//
// -----------------------------------------------------------------------------
// `POST /auth/elevate` DECLARES `session` WHERE SECTION 12'S ROW SAYS OTHERWISE
// -----------------------------------------------------------------------------
// Section 12's cell for that row reads `passkey or dual_channel`, and it names
// THE FACTOR THE ELEVATION ADMITS rather than the authority needed to call the
// endpoint. Section 3 says *"Auth: session"* and *"It does not re-establish the
// session and it never issues a new one"*, so a caller with no session has
// nothing to elevate and gets 401 rather than 403. The two halves are split
// here: `required: 'session'` is the call, `ElevationFactor` is the payload.
// `CI-06k` reads the DOCUMENT and never this array, so nothing is weakened; the
// paragraph exists so a later reader finds the reason rather than a defect.
//
// -----------------------------------------------------------------------------
// RATE LIMITS ARE DATA, AND NO NUMBER IN THIS FILE IS ONE
// -----------------------------------------------------------------------------
// API_CONTRACT section 11 holds the SMS branch's velocity in `otp_send_budget`
// rows carrying `send_limit` and `budget_cents` (`0029:388`, integer cents)
// *"so the values are config the way every other plan parameter is"*, and
// `notification_kinds.rate_limit_exempt` is `GENERATED ALWAYS AS (class IN
// ('security','money')) STORED` at `0029:695`, so `pre_identity_auth` is
// non-exempt BY CONSTRUCTION. The EMAIL branch's limits are stated as prose
// numbers in the same table and are ALSO not written here: a `5` in the email
// path is the same defect as a `5` in the SMS path arriving one row earlier.
// Both go through `AuthBackend.requestOtp`, which returns the outcome and the
// `Retry-After` the budget row implies.
//
// -----------------------------------------------------------------------------
// THE BACKEND IS A PORT, IT IS UNWIRED, AND IT IS BLOCKED ON A DEFECT
// -----------------------------------------------------------------------------
// THREE WRITES THIS SURFACE NEEDS CANNOT BE EXPRESSED THROUGH `packages/db` AS
// IT STANDS, so the port is declared and its implementation is not this
// session's. Any implementer reading this: the note is here so it is a grep
// target when the fix lands, per session 222's finding.
//
//   revoke ONE session          `ScopedTx.update` renders `scopePredicate` and
//                               takes no second predicate, so it writes EVERY
//                               session that identity holds.
//   consume ONE otp challenge   `otp_challenges` is `firm`, so `scopedTx`
//                               refuses it at compile time.
//   stamp `elevated_at`         as the first.
//
// and the wide doors are worse: `systemTx.update` (`scoped-db.ts:701`) and
// `firmTx.update` (`:720`) pass `undefined` for the WHERE clause and take no
// parameter that could supply one, so EITHER ONE WRITES EVERY ROW IN THE TABLE.
// A revoke through them logs out every trader on the platform; a challenge
// consume through them consumes every outstanding challenge. `sqlExecutor` is
// the deliberate door and its reason vocabulary is closed to `'job-enqueue'`
// (`scoped-db.ts:567`), so it is not available to an auth handler without
// editing `scoped-db.ts`. DO NOT ROUTE AROUND THIS. The fix is the founder's
// pending ruling.
//
// Until then the default backend throws on every method and every route answers
// 503 `service_unavailable`, which is fail closed and honest: this deployment
// does not serve auth yet. The suite substitutes an in-memory backend, so
// section 12's 200s are real 200s through Fastify's own router and its 403s are
// authority refusals rather than an unwired port failing by accident.
// =============================================================================

import type { FastifyReply, FastifyRequest } from 'fastify';

import { defineRoutes } from '../registry.ts';
import type { HttpMethod, RouteDefinition, RouteHandler } from '../registry.ts';
import { PROBLEM_MEDIA_TYPE, problem } from '../server.ts';
import type { Problem } from '../server.ts';

// -----------------------------------------------------------------------------
// The factor vocabularies. Both are the database's CHECK lists, verbatim.
// -----------------------------------------------------------------------------

/**
 * How a session was ESTABLISHED. `sessions.auth_factor`, `0029:565`.
 *
 * Three values, and `POST /auth/verify` records which one, *"which is what makes
 * C-27 enforceable: a handler cannot refuse an SMS-established session for a
 * sensitive action if the session never recorded how it was established"*.
 */
export type AuthFactor = 'email_otp' | 'sms_otp' | 'passkey';

/** {@link AuthFactor} as data, for the suite and for any caller that enumerates. */
export const AUTH_FACTORS = [
  'email_otp',
  'sms_otp',
  'passkey',
] as const satisfies readonly AuthFactor[];

/**
 * How a session was ELEVATED. `sessions.elevated_by_factor`, `0029:581`.
 *
 * TWO VALUES, AND THE ABSENCE OF A THIRD IS C-27. There is no `sms_otp` here
 * and there is no `email_otp` here, so an SMS-established session cannot elevate
 * itself at all. This is the union API_CONTRACT section 3 writes as
 * `ElevateResponse.elevated_by_factor` and section 12 calls *"never SMS alone
 * expressed as a type rather than as a check"*.
 */
export type ElevationFactor = 'passkey' | 'dual_channel';

/** {@link ElevationFactor} as data. Its LENGTH is asserted by the suite. */
export const ELEVATION_FACTORS = [
  'passkey',
  'dual_channel',
] as const satisfies readonly ElevationFactor[];

/**
 * API_CONTRACT section 12's required-factor vocabulary, closed at six tokens.
 *
 * The spellings are the document's, including the space in `passkey or
 * dual_channel`, because a second spelling of a token is a token.
 */
export type RequiredFactor =
  'none' | 'session' | 'passkey' | 'dual_channel' | 'passkey or dual_channel' | 'admin_sso';

/** {@link RequiredFactor} as data. */
export const REQUIRED_FACTORS = [
  'none',
  'session',
  'passkey',
  'dual_channel',
  'passkey or dual_channel',
  'admin_sso',
] as const satisfies readonly RequiredFactor[];

/**
 * The sensitive actions C-27 names, which section 12 tags a row with.
 *
 * Closed, and closed for `surface.ts`'s reason for closing `API_SURFACES`: a
 * fourth sensitive action is a ruling and not a value. C-27 names payout
 * destination change, contact change of either kind, and external withdrawal;
 * only the middle one has an endpoint in this module.
 */
export type C27Action = 'payout destination change' | 'contact change' | 'external withdrawal';

// -----------------------------------------------------------------------------
// The session, as this surface reads it
// -----------------------------------------------------------------------------

/**
 * One row of `sessions`, projected to what an authorization decision needs.
 *
 * `elevatedAt` and `elevatedByFactor` are both null or both set, which is
 * `sessions_elevation_is_complete` (`0029:586`). {@link isElevated} reads the
 * pair rather than either half, so a row that violated the constraint would
 * fail closed here instead of elevating on a half-written record.
 */
export interface AuthSession {
  readonly id: string;
  readonly identityId: string;
  readonly userId: string;
  readonly authFactor: AuthFactor;
  readonly elevatedAt: string | null;
  readonly elevatedByFactor: ElevationFactor | null;
}

/** Both halves of the elevation pair, or the session is not elevated. */
export function isElevated(session: AuthSession): boolean {
  return session.elevatedAt !== null && session.elevatedByFactor !== null;
}

// -----------------------------------------------------------------------------
// The decision
// -----------------------------------------------------------------------------

/** What {@link authorize} concluded. `forbidden` carries what the client may offer. */
export type AuthzDecision =
  | { readonly outcome: 'allowed' }
  | { readonly outcome: 'unauthenticated' }
  | { readonly outcome: 'forbidden'; readonly required: RequiredFactor };

/**
 * Apply one endpoint's declared factor to one session.
 *
 * THE ORDER OF THE TWO REFUSALS IS THE CONTRACT'S AND IS NOT ARBITRARY. A
 * caller with no session gets 401 and never 403, on every token, because 403 is
 * *"authenticated but not permitted"* (section 2) and answering it to an
 * anonymous caller would tell them the endpoint exists and that the only thing
 * missing is a factor.
 *
 * `admin_sso` is in the vocabulary because section 12's vocabulary has six
 * tokens, and it is REFUSED here rather than implemented: this module serves
 * the public surface, `ADR-083` puts the operator routes in a different
 * process, and an endpoint in this file declaring it would be an operator route
 * on the trader origin. The suite asserts no endpoint here declares it.
 */
export function authorize(session: AuthSession | null, required: RequiredFactor): AuthzDecision {
  if (required === 'none') return { outcome: 'allowed' };
  if (session === null) return { outcome: 'unauthenticated' };
  switch (required) {
    case 'session':
      // "Any single factor, which is every read surface. Email OTP, SMS OTP or
      // passkey, indistinguishable here on purpose."
      return { outcome: 'allowed' };
    case 'passkey or dual_channel':
      return isElevated(session) ? { outcome: 'allowed' } : { outcome: 'forbidden', required };
    case 'passkey':
    case 'dual_channel':
      return session.elevatedByFactor === required
        ? { outcome: 'allowed' }
        : { outcome: 'forbidden', required };
    case 'admin_sso':
      return { outcome: 'forbidden', required };
  }
}

// -----------------------------------------------------------------------------
// Request and response shapes, transcribed from API_CONTRACT section 3
// -----------------------------------------------------------------------------

/** Section 3, `OtpRequest`. Exactly one destination, and it matches `channel`. */
export interface OtpRequest {
  readonly channel: 'email' | 'sms';
  readonly email?: string;
  readonly phone?: string;
  readonly turnstile_token: string;
}

/**
 * What the budget said, which is the only thing that decides this response.
 *
 * `retryAfterSeconds` is on the refusal arm only, and it comes from the budget
 * row's own day boundary rather than from a constant in this file.
 */
export type OtpOutcome =
  | { readonly status: 'sent'; readonly expiresInSeconds: number }
  | { readonly status: 'deferred'; readonly expiresInSeconds: number }
  | { readonly status: 'rate_limited'; readonly retryAfterSeconds: number };

/** Section 3, `VerifyRequest`. */
export interface VerifyRequest {
  readonly channel: 'email' | 'sms';
  readonly email?: string;
  readonly phone?: string;
  readonly code: string;
}

/** Section 3, `VerifyResponse`. */
export interface VerifyResponse {
  readonly identity_id: string;
  readonly user_id: string;
  readonly is_new: boolean;
  readonly auth_factor: AuthFactor;
}

/** A response that also establishes the session cookie. */
export interface Established<T> {
  readonly response: T;
  /** Opaque. This module never inspects it; the backend minted it. */
  readonly sessionToken: string;
}

/**
 * Section 3, `ElevateRequest`. THE UNION IS THE CONTROL.
 *
 * There is no arm for `email_otp` and no arm for `sms_otp`, so an SMS-offered
 * elevation is not a value of this type. Adding one would require adding a
 * member to {@link ElevationFactor}, which `0029:581`'s CHECK list refuses at
 * the database and which the suite's `@ts-expect-error` refuses at compile time.
 */
export type ElevateRequest =
  | { readonly factor: 'passkey'; readonly credential: unknown }
  | { readonly factor: 'dual_channel'; readonly challenge_id: string; readonly code: string };

/** Section 3, `ElevateResponse`. */
export interface ElevateResponse {
  readonly elevated_at: string;
  readonly elevated_by_factor: ElevationFactor;
}

/** Section 3, `PasskeyVerifyRequest`. `credential` is the ceremony's own JSON. */
export interface PasskeyVerifyRequest {
  readonly credential: unknown;
  readonly label?: string;
}

/** Section 3, `PasskeyVerifyResponse`. */
export interface PasskeyVerifyResponse {
  readonly credential_id: string;
  readonly label: string | null;
  readonly created_at: string;
}

/** Section 3.1, `PhoneVerifyRequest`. */
export interface PhoneVerifyRequest {
  readonly challenge_id: string;
  readonly code: string;
}

/**
 * Section 3.1, `PhoneVerifyResponse`.
 *
 * `line_type` carries `voip` and it is RETURNED rather than refused: ADR-039
 * (a) scores VoIP and never rejects it.
 */
export interface PhoneVerifyResponse {
  readonly phone_id: string;
  readonly preview: string;
  readonly verified_at: string;
  readonly line_type: 'mobile' | 'landline' | 'voip' | 'prepaid' | 'unknown';
}

/** Section 3.1, `PhoneChangeRequest`. */
export interface PhoneChangeRequest {
  readonly new_phone: string;
}

/** Section 3.1, `PhoneChange`. */
export interface PhoneChange {
  readonly id: string;
  readonly state: 'pending' | 'dual_channel_verified' | 'applied' | 'cancelled';
  readonly new_phone_preview: string;
  readonly dual_channel_verified_at: string | null;
  readonly prior_notified_at: string | null;
  /** The 48 hour external-withdrawal hold, EXPOSED rather than inferred. */
  readonly withdrawal_hold_until: string | null;
  readonly applied_at: string | null;
  readonly cancelled_at: string | null;
  readonly cancelled_reason: string | null;
}

/**
 * Section 3.1, `SessionRow`.
 *
 * `auth_factor` is on EVERY row, which is what makes a SIM-swapped session
 * visible to the person it was taken from.
 */
export interface SessionRow {
  readonly id: string;
  readonly auth_factor: AuthFactor;
  readonly elevated: boolean;
  readonly created_at: string;
  readonly last_seen_at: string;
  /** Coarse, never the raw string. */
  readonly user_agent_family: string;
  readonly is_current: boolean;
}

/** Section 3, `Me`. Read by `routes/me.ts`, declared here with the rest. */
export interface Me {
  readonly identity_id: string;
  readonly user_id: string;
  readonly email: string;
  readonly country_code: string | null;
  readonly kyc: {
    readonly state: 'kyc_required' | 'pending' | 'verified' | 'rejected' | 'expired';
    readonly placement: string;
    readonly verified_at: string | null;
  };
  readonly identity_status: 'active' | 'restricted' | 'closed';
  readonly payouts_frozen: boolean;
  readonly frozen_reason: string | null;
  readonly restriction: {
    readonly reason: string;
    readonly tos_clause: string;
    readonly opened_at: string;
    readonly resolves_by: string | null;
  } | null;
  readonly accounts_count: number;
  readonly max_accounts: number;
  readonly affiliate: { readonly is_affiliate: boolean; readonly code: string | null };
  readonly phone: {
    readonly verified: boolean;
    readonly preview: string | null;
    readonly verified_at: string | null;
  };
  readonly session: {
    readonly auth_factor: AuthFactor;
    readonly elevated: boolean;
    readonly elevated_by_factor: ElevationFactor | null;
  };
}

// -----------------------------------------------------------------------------
// The port
// -----------------------------------------------------------------------------

/**
 * Everything this surface needs from outside the process. One method per
 * endpoint, and no method takes or returns a Fastify type.
 *
 * IT IS BLOCKED. See this file's header: three of these writes cannot be
 * expressed through `packages/db` today, and the implementation is not this
 * session's to write.
 */
export interface AuthBackend {
  /** Resolve the session cookie's value. `null` for an unknown or dead token. */
  sessionByToken(token: string): Promise<AuthSession | null>;

  /** Consult `otp_send_budget` and, if it permits, issue the challenge. */
  requestOtp(input: OtpRequest, requestIp: string | null): Promise<OtpOutcome>;

  /** Complete a challenge. `null` is a bad or expired code, deliberately indistinguishable. */
  verifyOtp(input: VerifyRequest): Promise<Established<VerifyResponse> | null>;

  /** Elevate the CURRENT session. Never issues a new one. */
  elevate(session: AuthSession, input: ElevateRequest): Promise<ElevateResponse | null>;

  passkeyRegisterOptions(session: AuthSession): Promise<unknown>;
  passkeyRegisterVerify(
    session: AuthSession,
    input: PasskeyVerifyRequest,
  ): Promise<PasskeyVerifyResponse | null>;
  passkeyLoginOptions(): Promise<unknown>;
  passkeyLoginVerify(
    input: PasskeyVerifyRequest,
  ): Promise<Established<PasskeyVerifyResponse> | null>;

  /** Revoke the session the request arrived on. */
  logout(session: AuthSession): Promise<void>;

  verifyPhone(session: AuthSession, input: PhoneVerifyRequest): Promise<PhoneVerifyResponse | null>;
  openPhoneChange(session: AuthSession, input: PhoneChangeRequest): Promise<PhoneChange | null>;
  readPhoneChange(session: AuthSession): Promise<PhoneChange | null>;
  cancelPhoneChange(session: AuthSession, changeId: string): Promise<PhoneChange | null>;
  listSessions(session: AuthSession): Promise<readonly SessionRow[]>;
  /** Revoke ONE named session of this identity. `null` when the id is not theirs. */
  revokeSession(session: AuthSession, sessionId: string): Promise<'revoked' | null>;
  readMe(session: AuthSession): Promise<Me | null>;
}

/** Thrown by the default backend. Answered as 503 rather than 500. */
export class AuthBackendUnwired extends Error {
  constructor(method: string) {
    super(
      `AuthBackend.${method} is not wired. The auth surface is declared and its persistence is ` +
        'not implemented: three of its writes cannot be expressed through packages/db today. ' +
        'See routes/auth.ts, and scoped-db.ts lines 567, 701 and 718',
    );
    this.name = 'AuthBackendUnwired';
  }
}

function unwired(method: string): () => Promise<never> {
  return () => Promise.reject(new AuthBackendUnwired(method));
}

/**
 * The default, and it fails CLOSED on every method.
 *
 * A backend that returned plausible values would be a fixture serving real
 * traffic. This one makes the deployment's state legible from a response.
 */
export const UNWIRED_AUTH_BACKEND: AuthBackend = {
  sessionByToken: unwired('sessionByToken'),
  requestOtp: unwired('requestOtp'),
  verifyOtp: unwired('verifyOtp'),
  elevate: unwired('elevate'),
  passkeyRegisterOptions: unwired('passkeyRegisterOptions'),
  passkeyRegisterVerify: unwired('passkeyRegisterVerify'),
  passkeyLoginOptions: unwired('passkeyLoginOptions'),
  passkeyLoginVerify: unwired('passkeyLoginVerify'),
  logout: unwired('logout'),
  verifyPhone: unwired('verifyPhone'),
  openPhoneChange: unwired('openPhoneChange'),
  readPhoneChange: unwired('readPhoneChange'),
  cancelPhoneChange: unwired('cancelPhoneChange'),
  listSessions: unwired('listSessions'),
  revokeSession: unwired('revokeSession'),
  readMe: unwired('readMe'),
};

let backend: AuthBackend = UNWIRED_AUTH_BACKEND;

/** Install the backend. The wiring slice calls this; so does the suite. */
export function useAuthBackend(next: AuthBackend): void {
  backend = next;
}

/** Restore the fail-closed default. */
export function resetAuthBackend(): void {
  backend = UNWIRED_AUTH_BACKEND;
}

/** The installed backend. `routes/me.ts` reads it through here. */
export function currentAuthBackend(): AuthBackend {
  return backend;
}

// -----------------------------------------------------------------------------
// The transport: cookie, problem documents, validation
// -----------------------------------------------------------------------------

/**
 * The session cookie's name.
 *
 * API_CONTRACT section 1 specifies the ATTRIBUTES (*"httpOnly, Secure,
 * SameSite=Lax"*) and names no cookie, so the name is declared here, once, and
 * every producer and the one reader take it from this constant.
 */
export const SESSION_COOKIE = 'merit_session';

/** Section 1's attributes, in the contract's order. `Path` is the whole API. */
function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.header('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`);
}

/** Clearing is the same cookie with an expiry the client has already passed. */
function clearSessionCookie(reply: FastifyReply): void {
  reply.header(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  );
}

/**
 * The cookie's value, or null.
 *
 * Parsed here rather than by a plugin: the header is a `;`-separated list of
 * `name=value`, this module wants exactly one name out of it, and a dependency
 * admitted for that would be a dependency admitted before a caller exists.
 */
export function sessionTokenFromCookie(header: string | undefined): string | null {
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return value === '' ? null : value;
  }
  return null;
}

/** One entry of section 2's `errors[]`, which is validation failures only. */
export interface FieldError {
  readonly path: string;
  readonly message: string;
}

type Validated<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly FieldError[] };

/**
 * Send an RFC 9457 problem document.
 *
 * The parameter is wider than `server.ts`'s `Problem` because two of section
 * 2's own fields live outside it: `errors[]` for validation failures, and the
 * extension member section 12 requires on a 403. RFC 9457 admits extension
 * members by name, so this is the contract's shape rather than a widening of
 * it, and `status` stays required because it is what the response code is read
 * from.
 */
interface ProblemDocument extends Problem {
  /** Section 2: human detail, never internals and never another user's data. */
  readonly detail?: string;
  /** Section 2: validation failures only. */
  readonly errors?: readonly FieldError[];
  /** Section 12's 403: "the response names the factor required". */
  readonly required_factor?: RequiredFactor;
}

function sendProblem(reply: FastifyReply, body: ProblemDocument): FastifyReply {
  return reply.code(body.status).type(PROBLEM_MEDIA_TYPE).send(body);
}

function sendValidationFailed(
  reply: FastifyReply,
  requestId: string,
  errors: readonly FieldError[],
): FastifyReply {
  return sendProblem(reply, { ...problem('validation_failed', 400, requestId), errors });
}

/**
 * Section 12: 403 *"and the response names the factor required so the client
 * can offer it"*.
 *
 * `required_factor` is an RFC 9457 extension member rather than a new canonical
 * code, because section 2's code table is closed and the code IS `forbidden`.
 */
function sendForbidden(
  reply: FastifyReply,
  requestId: string,
  required: RequiredFactor,
  action: C27Action | undefined,
): FastifyReply {
  return sendProblem(reply, {
    ...problem('forbidden', 403, requestId),
    detail:
      action === undefined
        ? `This action requires ${required}.`
        : `This is a ${action} and requires ${required}.`,
    required_factor: required,
  });
}

/**
 * Section 1's 404, which is the trader surface's answer for a resource the
 * caller does not own as well as for one that does not exist.
 *
 * Exported because `routes/me.ts` needs the same shape and this module owns the
 * problem-document helpers for both.
 */
export function problemNotFound(reply: FastifyReply, requestId: string): FastifyReply {
  return sendProblem(reply, problem('not_found', 404, requestId));
}

// -----------------------------------------------------------------------------
// Validators. Total over the shapes section 3 declares, and hand written.
// -----------------------------------------------------------------------------

/** E.164: a plus, a non-zero leading digit, and at most fifteen digits in all. */
const E164 = /^\+[1-9]\d{1,14}$/;

function asRecord(body: unknown): Record<string, unknown> | null {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * The destination rule, shared by `POST /auth/otp` and `POST /auth/verify`.
 *
 * It mirrors `otp_challenges_exactly_one_destination` rather than restating it
 * loosely: exactly one destination is set and it is the one `channel` names.
 * ADR-039 and `SD-M16-05` refuse a default `channel` for the same reason, so a
 * missing one is a validation failure here and never an assumed `email`.
 */
function validateChannelAndDestination(
  row: Record<string, unknown>,
  errors: FieldError[],
): { channel: 'email' | 'sms'; email?: string; phone?: string } | null {
  const channel = row['channel'];
  if (channel !== 'email' && channel !== 'sms') {
    errors.push({ path: 'channel', message: 'must be one of: email, sms' });
    return null;
  }
  const email = row['email'];
  const phone = row['phone'];
  const hasEmail = email !== undefined;
  const hasPhone = phone !== undefined;
  if (hasEmail === hasPhone) {
    errors.push({ path: 'email', message: 'exactly one of email or phone must be set' });
    return null;
  }
  if (channel === 'email') {
    if (!hasEmail) {
      errors.push({ path: 'email', message: 'channel is email, so email must be set' });
      return null;
    }
    if (!nonEmptyString(email)) {
      errors.push({ path: 'email', message: 'must be a non-empty string' });
      return null;
    }
    return { channel, email };
  }
  if (!hasPhone) {
    errors.push({ path: 'phone', message: 'channel is sms, so phone must be set' });
    return null;
  }
  if (typeof phone !== 'string' || !E164.test(phone)) {
    errors.push({ path: 'phone', message: 'must be an E.164 number' });
    return null;
  }
  return { channel, phone };
}

export function validateOtpRequest(body: unknown): Validated<OtpRequest> {
  const errors: FieldError[] = [];
  const row = asRecord(body);
  if (row === null) return { ok: false, errors: [{ path: '', message: 'must be a JSON object' }] };
  const destination = validateChannelAndDestination(row, errors);
  const token = row['turnstile_token'];
  if (!nonEmptyString(token))
    errors.push({ path: 'turnstile_token', message: 'must be a non-empty string' });
  if (destination === null || errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { ...destination, turnstile_token: token as string } };
}

export function validateVerifyRequest(body: unknown): Validated<VerifyRequest> {
  const errors: FieldError[] = [];
  const row = asRecord(body);
  if (row === null) return { ok: false, errors: [{ path: '', message: 'must be a JSON object' }] };
  const destination = validateChannelAndDestination(row, errors);
  const code = row['code'];
  if (!nonEmptyString(code)) errors.push({ path: 'code', message: 'must be a non-empty string' });
  if (destination === null || errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { ...destination, code: code as string } };
}

/**
 * Section 12's row, at run time.
 *
 * An SMS-established factor is `validation_failed` HERE, and the message names
 * the whole vocabulary because there is nothing to hide: the closed set is the
 * control, and a client that offered `sms_otp` needs to be told the two values
 * that exist. The COMPILE-time half is `ElevateRequest`.
 */
export function validateElevateRequest(body: unknown): Validated<ElevateRequest> {
  const row = asRecord(body);
  if (row === null) return { ok: false, errors: [{ path: '', message: 'must be a JSON object' }] };
  const factor = row['factor'];
  if (factor !== 'passkey' && factor !== 'dual_channel')
    return {
      ok: false,
      errors: [
        {
          path: 'factor',
          message: `must be one of: ${ELEVATION_FACTORS.join(', ')}. C-27 admits no single factor and never SMS alone`,
        },
      ],
    };
  if (factor === 'passkey') {
    if (row['credential'] === undefined)
      return { ok: false, errors: [{ path: 'credential', message: 'is required' }] };
    return { ok: true, value: { factor, credential: row['credential'] } };
  }
  const errors: FieldError[] = [];
  const challengeId = row['challenge_id'];
  const code = row['code'];
  if (!nonEmptyString(challengeId))
    errors.push({ path: 'challenge_id', message: 'must be a non-empty string' });
  if (!nonEmptyString(code)) errors.push({ path: 'code', message: 'must be a non-empty string' });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { factor, challenge_id: challengeId as string, code: code as string } };
}

export function validatePasskeyVerifyRequest(body: unknown): Validated<PasskeyVerifyRequest> {
  const row = asRecord(body);
  if (row === null) return { ok: false, errors: [{ path: '', message: 'must be a JSON object' }] };
  if (row['credential'] === undefined)
    return { ok: false, errors: [{ path: 'credential', message: 'is required' }] };
  const label = row['label'];
  if (label !== undefined && typeof label !== 'string')
    return { ok: false, errors: [{ path: 'label', message: 'must be a string' }] };
  return {
    ok: true,
    value:
      label === undefined
        ? { credential: row['credential'] }
        : { credential: row['credential'], label },
  };
}

export function validatePhoneVerifyRequest(body: unknown): Validated<PhoneVerifyRequest> {
  const errors: FieldError[] = [];
  const row = asRecord(body);
  if (row === null) return { ok: false, errors: [{ path: '', message: 'must be a JSON object' }] };
  const challengeId = row['challenge_id'];
  const code = row['code'];
  if (!nonEmptyString(challengeId))
    errors.push({ path: 'challenge_id', message: 'must be a non-empty string' });
  if (!nonEmptyString(code)) errors.push({ path: 'code', message: 'must be a non-empty string' });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { challenge_id: challengeId as string, code: code as string } };
}

export function validatePhoneChangeRequest(body: unknown): Validated<PhoneChangeRequest> {
  const row = asRecord(body);
  if (row === null) return { ok: false, errors: [{ path: '', message: 'must be a JSON object' }] };
  const phone = row['new_phone'];
  if (typeof phone !== 'string' || !E164.test(phone))
    return { ok: false, errors: [{ path: 'new_phone', message: 'must be an E.164 number' }] };
  return { ok: true, value: { new_phone: phone } };
}

// -----------------------------------------------------------------------------
// The endpoint declaration, and the guard that makes it load bearing
// -----------------------------------------------------------------------------

/** What a handler is handed once its declared factor has been applied. */
export interface AuthedContext {
  readonly request: FastifyRequest;
  readonly reply: FastifyReply;
  readonly backend: AuthBackend;
  /** Null only where the endpoint declared `none`. */
  readonly session: AuthSession | null;
}

/** One endpoint: its contract path, its DECLARED factor, and its handler. */
export interface EndpointSpec {
  readonly method: HttpMethod;
  readonly path: string;
  readonly required: RequiredFactor;
  /** Set exactly on the rows section 12 tags `C-27:`. */
  readonly c27?: C27Action;
  readonly handle: (ctx: AuthedContext) => Promise<unknown>;
}

/** A session-bearing endpoint's handler, with the null already refused. */
type SessionHandler = (ctx: AuthedContext & { readonly session: AuthSession }) => Promise<unknown>;

/**
 * Narrow the context for every token but `none`.
 *
 * `authorize` has already refused a null session for those tokens, and this is
 * the one place that fact is converted into a type, so no handler in this file
 * re-checks it and none can forget to.
 */
export function withSessionContext(
  handle: SessionHandler,
): (ctx: AuthedContext) => Promise<unknown> {
  return (ctx) => {
    /* c8 ignore next */
    if (ctx.session === null) throw new Error('unreachable: authorize refused a null session');
    return handle({ ...ctx, session: ctx.session });
  };
}

/**
 * Build the framework handler for one declared endpoint.
 *
 * EVERY ROUTE IN THIS MODULE AND IN `routes/me.ts` GOES THROUGH HERE, so the
 * declared factor is applied before any handler body runs and the 503 for an
 * unwired backend is produced in one place.
 */
export function endpointHandler(spec: EndpointSpec): RouteHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const active = currentAuthBackend();
    try {
      const token = sessionTokenFromCookie(request.headers.cookie);
      const session = token === null ? null : await active.sessionByToken(token);
      const decision = authorize(session, spec.required);
      if (decision.outcome === 'unauthenticated')
        return sendProblem(reply, problem('unauthenticated', 401, request.id));
      if (decision.outcome === 'forbidden')
        return sendForbidden(reply, request.id, decision.required, spec.c27);
      return await spec.handle({ request, reply, backend: active, session });
    } catch (err) {
      if (!(err instanceof AuthBackendUnwired)) throw err;
      request.log.error({ err }, 'auth backend is not wired');
      return sendProblem(reply, {
        ...problem('service_unavailable', 503, request.id),
        title: 'Service unavailable',
      });
    }
  };
}

/** The route definitions one set of specs contributes. */
export function toRoutes(specs: readonly EndpointSpec[]): readonly RouteDefinition[] {
  return specs.map((spec) => ({
    method: spec.method,
    path: spec.path,
    handler: endpointHandler(spec),
  }));
}

/**
 * The declaration, as data, keyed `METHOD /path`.
 *
 * Derived from the same array the routes are derived from, so the table and the
 * registration cannot disagree. This is what a reviewer, and any later gate,
 * reads.
 */
export function requiredFactorTable(
  specs: readonly EndpointSpec[],
): Readonly<Record<string, RequiredFactor>> {
  const table: Record<string, RequiredFactor> = {};
  for (const spec of specs) table[`${spec.method} ${spec.path}`] = spec.required;
  return table;
}

// -----------------------------------------------------------------------------
// The endpoints
// -----------------------------------------------------------------------------

function param(request: FastifyRequest, name: string): string | null {
  const params = asRecord(request.params);
  if (params === null) return null;
  const value = params[name];
  return typeof value === 'string' && value !== '' ? value : null;
}

function requestIp(request: FastifyRequest): string | null {
  return request.ip === '' ? null : request.ip;
}

/**
 * API_CONTRACT section 3 and 3.1, in the document's order.
 *
 * `POST /phone/change/:id/cancel` IS THE ONE ROW WHOSE FACTOR THE CORPUS DOES
 * NOT STATE. Section 3.1 declares the factor for OPENING a change and for
 * READING one and says nothing about cancelling. `session` is taken on the
 * contract's own argument two paragraphs earlier: requiring elevation to STOP
 * an attacker's ceremony would lock the real owner out of the control that
 * helps them, exactly as *"a session you cannot see is one you cannot revoke"*.
 * API_CONTRACT is outside this session's fence, so the section 12 row is a DEBT
 * this file records rather than a ruling it takes.
 */
export const AUTH_ENDPOINTS: readonly EndpointSpec[] = [
  {
    method: 'POST',
    path: '/auth/otp',
    required: 'none',
    handle: async ({ request, reply, backend: b }) => {
      const parsed = validateOtpRequest(request.body);
      if (!parsed.ok) return sendValidationFailed(reply, request.id, parsed.errors);
      const outcome = await b.requestOtp(parsed.value, requestIp(request));
      if (outcome.status === 'rate_limited') {
        // Section 1: "Exceeding returns 429 with Retry-After". The number is
        // the budget row's, never this file's.
        reply.header('Retry-After', String(outcome.retryAfterSeconds));
        return sendProblem(reply, problem('rate_limited', 429, request.id));
      }
      // "A 202 on the sms channel does not mean a message was sent." A degraded
      // breaker DEGRADES rather than stopping, so this is 202 either way and
      // `deferred` is the difference. ADR-039.
      reply.code(202);
      return outcome.status === 'deferred'
        ? { sent: true, expires_in_seconds: outcome.expiresInSeconds, deferred: true }
        : { sent: true, expires_in_seconds: outcome.expiresInSeconds };
    },
  },
  {
    method: 'POST',
    path: '/auth/verify',
    required: 'none',
    handle: async ({ request, reply, backend: b }) => {
      const parsed = validateVerifyRequest(request.body);
      if (!parsed.ok) return sendValidationFailed(reply, request.id, parsed.errors);
      const established = await b.verifyOtp(parsed.value);
      // "unauthenticated (bad or expired code, deliberately indistinguishable)".
      if (established === null)
        return sendProblem(reply, problem('unauthenticated', 401, request.id));
      setSessionCookie(reply, established.sessionToken);
      return established.response;
    },
  },
  {
    method: 'POST',
    path: '/auth/elevate',
    required: 'session',
    handle: withSessionContext(async ({ request, reply, backend: b, session }) => {
      const parsed = validateElevateRequest(request.body);
      if (!parsed.ok) return sendValidationFailed(reply, request.id, parsed.errors);
      const elevated = await b.elevate(session, parsed.value);
      if (elevated === null) return sendProblem(reply, problem('unauthenticated', 401, request.id));
      // No cookie is set. "It does not re-establish the session and it never
      // issues a new one."
      return elevated;
    }),
  },
  {
    method: 'POST',
    path: '/auth/passkey/register/options',
    required: 'session',
    handle: withSessionContext(async ({ backend: b, session }) =>
      b.passkeyRegisterOptions(session),
    ),
  },
  {
    method: 'POST',
    path: '/auth/passkey/register/verify',
    required: 'session',
    handle: withSessionContext(async ({ request, reply, backend: b, session }) => {
      const parsed = validatePasskeyVerifyRequest(request.body);
      if (!parsed.ok) return sendValidationFailed(reply, request.id, parsed.errors);
      const registered = await b.passkeyRegisterVerify(session, parsed.value);
      if (registered === null)
        return sendProblem(reply, problem('unauthenticated', 401, request.id));
      return registered;
    }),
  },
  {
    method: 'POST',
    path: '/auth/passkey/login/options',
    required: 'none',
    handle: async ({ backend: b }) => b.passkeyLoginOptions(),
  },
  {
    method: 'POST',
    path: '/auth/passkey/login/verify',
    required: 'none',
    handle: async ({ request, reply, backend: b }) => {
      const parsed = validatePasskeyVerifyRequest(request.body);
      if (!parsed.ok) return sendValidationFailed(reply, request.id, parsed.errors);
      const established = await b.passkeyLoginVerify(parsed.value);
      if (established === null)
        return sendProblem(reply, problem('unauthenticated', 401, request.id));
      setSessionCookie(reply, established.sessionToken);
      return established.response;
    },
  },
  {
    method: 'POST',
    path: '/auth/logout',
    required: 'session',
    handle: withSessionContext(async ({ reply, backend: b, session }) => {
      await b.logout(session);
      clearSessionCookie(reply);
      // Section 3: "Response 204".
      reply.code(204);
      return null;
    }),
  },
  {
    method: 'POST',
    path: '/phone/verify',
    required: 'session',
    handle: withSessionContext(async ({ request, reply, backend: b, session }) => {
      const parsed = validatePhoneVerifyRequest(request.body);
      if (!parsed.ok) return sendValidationFailed(reply, request.id, parsed.errors);
      const verified = await b.verifyPhone(session, parsed.value);
      if (verified === null) return sendProblem(reply, problem('unauthenticated', 401, request.id));
      return verified;
    }),
  },
  {
    method: 'POST',
    path: '/phone/change',
    required: 'passkey or dual_channel',
    c27: 'contact change',
    handle: withSessionContext(async ({ request, reply, backend: b, session }) => {
      const parsed = validatePhoneChangeRequest(request.body);
      if (!parsed.ok) return sendValidationFailed(reply, request.id, parsed.errors);
      const opened = await b.openPhoneChange(session, parsed.value);
      // `phone_change_requests_open_per_identity_uq`: a second open request is a
      // conflict rather than a second ceremony.
      if (opened === null) return sendProblem(reply, problem('conflict', 409, request.id));
      reply.code(201);
      return opened;
    }),
  },
  {
    method: 'GET',
    path: '/phone/change',
    required: 'session',
    handle: withSessionContext(async ({ request, reply, backend: b, session }) => {
      const change = await b.readPhoneChange(session);
      if (change === null) return problemNotFound(reply, request.id);
      return change;
    }),
  },
  {
    method: 'POST',
    path: '/phone/change/:id/cancel',
    required: 'session',
    handle: withSessionContext(async ({ request, reply, backend: b, session }) => {
      const id = param(request, 'id');
      if (id === null) return problemNotFound(reply, request.id);
      const cancelled = await b.cancelPhoneChange(session, id);
      // Section 1: a path parameter naming a resource the caller does not own
      // returns 404 and never 403, so the API does not confirm that somebody
      // else's ceremony exists.
      if (cancelled === null) return problemNotFound(reply, request.id);
      return cancelled;
    }),
  },
  {
    method: 'GET',
    path: '/sessions',
    required: 'session',
    handle: withSessionContext(async ({ backend: b, session }) => ({
      data: await b.listSessions(session),
      next_cursor: null,
    })),
  },
  {
    method: 'POST',
    path: '/sessions/:id/revoke',
    required: 'passkey or dual_channel',
    c27: 'contact change',
    handle: withSessionContext(async ({ request, reply, backend: b, session }) => {
      const id = param(request, 'id');
      if (id === null) return problemNotFound(reply, request.id);
      const revoked = await b.revokeSession(session, id);
      if (revoked === null) return problemNotFound(reply, request.id);
      reply.code(204);
      return null;
    }),
  },
];

/** The declaration as data, for the suite and for a reviewer. */
export const AUTH_REQUIRED_FACTORS = requiredFactorTable(AUTH_ENDPOINTS);

export default defineRoutes({
  name: 'auth',
  routes: toRoutes(AUTH_ENDPOINTS),
});
