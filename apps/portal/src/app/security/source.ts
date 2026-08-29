// =============================================================================
// apps/portal/src/app/security/source.ts
// =============================================================================
// WHERE SC-M4-11's DATA COMES FROM, AND THE MEASUREMENT IS THE INTERESTING PART.
//
// M04 section 3.1 requires four things of this screen: "Every active session
// with the factor that established it, revocation, the verified phone, and the
// phone-change ceremony's state while it runs."
//
// TWO OF THE FOUR HAVE A REGISTERED AND WIRED ENDPOINT AND TWO DO NOT. Measured
// through `CompositionReport.registered` over a real `compose()` (dispatch
// protocol section 5, "a grep over route files has been wrong twice"), and then
// through the backend each route actually calls, because REGISTRATION AND
// WIRING ARE DIFFERENT QUESTIONS and this screen is where the difference shows:
//
//   `GET /sessions`             REGISTERED, and `databaseAuthBackend.
//                               listSessions` is a real implementation over the
//                               scoped accessor. THIS SCREEN'S SPINE
//   `POST /sessions/:id/revoke` REGISTERED, and `revokeSession` is real too. The
//                               gap on this one is on THIS side; see below
//   `GET /me`                   REGISTERED and its backend is BLOCKED. It raises
//                               `AuthBackendUnwired`, so it answers 503
//   `GET /phone/change`         REGISTERED and its backend is BLOCKED, likewise
//
// EACH BLOCKED METHOD CARRIES ITS OWN REASON IN `apps/api/src/auth-backend.ts`
// AND BOTH ARE WORTH QUOTING, because neither is an oversight:
//
//   `readMe`: "`Me.max_accounts` has no source. `identities.max_accounts_override`
//   is the per-entity exception and the BASE cap appears in no table in any of
//   the 47 migrations, so it is a plan parameter -- and no plan parameter is
//   stated in application code. Every other field of `Me` is reachable through
//   the scoped door, which is what makes this one worth reporting rather than
//   working around."
//
//   `readPhoneChange`: `phone_change_requests` has no preview column, so
//   `PhoneChange.new_phone_preview` has no source.
//
// SO THE PHONE AND THE CEREMONY ARE DECLARED AS GAPS RATHER THAN OMITTED, which
// is `app/payouts/source.ts`'s precedent for naming what a screen failed to get
// rather than assuming. A screen that simply left out the phone section would be
// indistinguishable from a screen that had decided the trader has no phone.
//
// NEITHER IS REPAIRED HERE AND THE FENCE IS THE REASON. `auth-backend.ts` and
// `routes/auth.ts` are another live session's ground this wave. If `GET /me` or
// `GET /phone/change` needs a change on the API side, that is reported, not
// taken.
//
// -----------------------------------------------------------------------------
// THE REVOKE ROUTE IS THE ONE GAP THAT IS ENTIRELY ON THIS SIDE
// -----------------------------------------------------------------------------
// `POST /sessions/:id/revoke` is registered and wired and this segment still
// does not call it. UNTIL ADR-219 IT COULD NOT: ../../http/client.ts declared an
// `ApiClient` with `get` and nothing else, so this application had no write path
// of any kind. That entry took the transport ruling this file declined, and
// `post` exists.
//
// WHAT REMAINS TRUE IS EVERYTHING ELSE, AND IT IS WHY NOTHING HERE MOVED.
// `test/surface.test.ts` still fails on a second file growing a `fetch(`, and
// ADR-083 section 3 with ADR-095 ruling 3 still forbid a route handler or a
// Server Action here, so a call may live in one place only. ADR-219 SHIPS THE
// VERB AND WIRES NO PAGE, on ADR-190's ground that a screen posting on a posture
// nobody has read is worse than one that honestly refuses. `app/payouts/view.ts`
// declined the same widening for `POST /accounts/:id/payout` and rendered its
// control inert, and this is the same call on a narrower endpoint. The control
// renders disabled, `ActiveSessionView.revokes_at` is typed as the literal
// `null`, and the screen says the control is unavailable in this build rather
// than promising a trader they have thrown an attacker out.

import type { SessionRow } from '../../api/types.ts';
import type { ApiClient } from '../../http/client.ts';
import { ApiConfigError, serverApiClient } from '../../http/client.ts';
import { toSecurityView } from '../../view/sessions.ts';
import type { SecurityGap, SecurityView } from '../../view/sessions.ts';

/** The endpoint that carries this screen. */
export const SESSIONS_PATH = '/sessions';

/** The one read SC-M4-11 needs and has. */
export const REQUIRED_ENDPOINTS = ['GET /sessions'] as const;

/**
 * The parts of section 3.1's row that no WIRED endpoint can serve.
 *
 * DERIVED FROM A MEASUREMENT AND NOT FROM A GUESS, and carried as data so that
 * whoever unblocks a backend deletes an entry here and the screen changes with
 * it. Both endpoints are registered; both raise `AuthBackendUnwired` and answer
 * 503. See this file's header for each one's quoted blocker.
 */
export const GAPS: readonly SecurityGap[] = [
  {
    endpoint: 'GET /me',
    shows: 'the verified phone number for this identity',
  },
  {
    endpoint: 'GET /phone/change',
    shows: 'a phone change while it is running, and the date its withdrawal hold lifts',
  },
];

/**
 * What the page got.
 *
 * `unavailable` IS NOT AN ERROR STATE, on `app/payouts/source.ts`'s argument.
 * What it means here is that the session list did not answer, which on THIS
 * screen has a consequence worth stating: a trader who came to check for a
 * session they do not recognise learns nothing, so the unavailable arm says so
 * plainly rather than rendering an empty list that reads as "no other sessions".
 */
export type SecurityLoad =
  | { readonly kind: 'ready'; readonly view: SecurityView }
  | { readonly kind: 'unavailable'; readonly missing: readonly string[] };

/**
 * Build the screen from one response.
 *
 * EXPORTED SEPARATELY FROM `load` so the suite renders the real tree over
 * responses transcribed from API_CONTRACT section 3.1, which is
 * `app/payouts/source.ts`'s `readyFrom`.
 */
export function readyFrom(input: {
  readonly sessions: readonly SessionRow[];
  readonly gaps?: readonly SecurityGap[];
}): SecurityLoad {
  return {
    kind: 'ready',
    view: toSecurityView({ sessions: input.sessions, gaps: input.gaps ?? GAPS }),
  };
}

// -----------------------------------------------------------------------------
// Narrowing, which is this segment's and not the transport's
// -----------------------------------------------------------------------------

/**
 * Every member of `AuthFactor`, as a lookup the compiler keeps complete.
 *
 * `Record<AuthFactor, true>` IS THE MECHANISM: a member added to the union in
 * ../../api/types.ts and not added here is `error TS2741`. The union is a closed
 * three-member CHECK in `0029` and `SD-M4-04` makes its membership the
 * enforcement of C-27, so a guard that admitted a fourth token would be admitting
 * a factor the database refuses onto the screen that exists to show factors.
 */
const FACTORS: Readonly<Record<SessionRow['auth_factor'], true>> = {
  email_otp: true,
  sms_otp: true,
  passkey: true,
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * `GET /sessions`, narrowed to the shape ../../api/types.ts transcribed.
 *
 * EVERY FIELD THE VIEW READS IS CHECKED AND NOT A SUBSET, which is
 * `app/payouts/source.ts`'s rule: a partial guard "reads as a complete one at
 * the call site and crashes on the field it skipped".
 *
 * `elevated` AND `is_current` ARE CHECKED AS BOOLEANS RATHER THAN COERCED, and
 * on this screen that is not pedantry. `undefined` is falsy, so a response that
 * dropped `is_current` would coerce to "not the current session" and this screen
 * would offer the trader a revoke control for the session they are reading it
 * on. A missing `elevated` would read as "not elevated", which is the safe
 * direction, and the same check catches both.
 */
export function isSessionList(value: unknown): value is readonly SessionRow[] {
  if (!Array.isArray(value)) return false;

  return value.every((row) => {
    if (!isRecord(row)) return false;

    const factor = row['auth_factor'];
    if (typeof factor !== 'string') return false;
    if (!Object.prototype.hasOwnProperty.call(FACTORS, factor)) return false;

    return (
      isString(row['id']) &&
      typeof row['elevated'] === 'boolean' &&
      isString(row['created_at']) &&
      isString(row['last_seen_at']) &&
      isString(row['user_agent_family']) &&
      typeof row['is_current'] === 'boolean'
    );
  });
}

// -----------------------------------------------------------------------------
// The seam
// -----------------------------------------------------------------------------

/**
 * The screen, from a client.
 *
 * EXPORTED SO THE SUITE REACHES IT THROUGH THE REAL CLIENT rather than a mock of
 * it: `test/security-source.test.ts` calls this with a client built by
 * `createApiClient` over a stub transport, exercising URL composition, the
 * session cookie, `no-store`, status mapping, JSON and the guard.
 *
 * THE LIST IS NOT PAGED AND THAT IS THE CONTRACT'S SHAPE. `GET /sessions`
 * returns a bare array in API_CONTRACT section 3.1, not section 1's `{ data,
 * next_cursor }` envelope, so this segment asks for no cursor and reads none.
 */
export async function loadFrom(input: { readonly client: ApiClient }): Promise<SecurityLoad> {
  const response = await input.client.get(SESSIONS_PATH);

  if (!response.ok || !isSessionList(response.body))
    return { kind: 'unavailable', missing: [...REQUIRED_ENDPOINTS] };

  return readyFrom({ sessions: response.body });
}

/** What ./page.ts calls. */
export async function load(): Promise<SecurityLoad> {
  let client: ApiClient;
  try {
    client = await serverApiClient();
  } catch (error) {
    // ONLY `ApiConfigError`, which is `app/payouts/source.ts`'s narrowness and
    // its argument: an unset `MERIT_API_ORIGIN` means this deployment has no API
    // at all. Anything else propagates rather than being dressed as a pending
    // endpoint.
    if (!(error instanceof ApiConfigError)) throw error;
    return { kind: 'unavailable', missing: [...REQUIRED_ENDPOINTS] };
  }

  return loadFrom({ client });
}
