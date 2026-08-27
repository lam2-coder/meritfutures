// =============================================================================
// apps/portal/src/app/kyc/source.ts
// =============================================================================
// MERIT NEVER PROXIES A DOCUMENT, AND THIS IS THE HALF OF THAT INVARIANT THAT
// LIVES ON A SCREEN.
//
// ADR-114 clause 6 rules it and enforces it in TWO places, "because one of them
// cannot see inside a JSONB blob":
//
//   "The port has no method returning a document and no field one could be
//    assigned to. The receiver SCREENS a verified payload before anything
//    stores it, REFUSES rather than redacts, and records KEY PATHS and never
//    values."
//
// A KYC SCREEN IS WHERE A UI WOULD MOST NATURALLY TRY TO PROXY ONE. Showing the
// trader "the passport you uploaded" feels helpful and is the exact thing the
// invariant forbids, and the reason a page needs both halves is the same reason
// the receiver does: the type stops what a developer writes, and the runtime
// screen stops what a server sends.
//
//   HALF ONE, THE TYPE. `KycScreenSource.status` returns `KycStatus`, which is
//   API_CONTRACT section 7's five fields and has no field a document could be
//   assigned to. An implementation that wanted to hand this page an image has
//   nowhere to put it, and `tsc` says so.
//
//   HALF TWO, THE RUNTIME SCREEN. TypeScript is structural and JSON is not
//   typed at all, so an object carrying `document_image` beside the five
//   contract fields satisfies `KycStatus` at compile time and arrives intact at
//   run time. `screenKycStatus` reads what actually came back, REFUSES on a
//   document-shaped key rather than deleting it, and names KEY PATHS in the
//   refusal and never values.
//
// NEITHER HALF ALONE IS THE CONTROL. The type cannot see a wire payload and the
// screen cannot see a field nobody sent yet. That is ADR-114's own argument for
// enforcing this twice, arriving one deployable over.
//
// -----------------------------------------------------------------------------
// WHY IT REFUSES RATHER THAN REDACTS, WHICH IS A RULING AND NOT A PREFERENCE
// -----------------------------------------------------------------------------
// A redaction is a page that renders. A document-shaped key in a response means
// a server upstream is emitting one, which is a defect that has to be fixed
// where it is written; a screen that quietly dropped the field would render
// correctly forever while the response kept carrying a passport to every other
// consumer of that endpoint. Refusing is the only outcome that reaches somebody.
//
// AND THE REFUSAL CARRIES KEY PATHS AND NEVER VALUES, for the reason ADR-114
// gives: an error message is written to a log, and an error that quoted the
// value it screened out would be the leak it exists to prevent, in the one
// place nobody thinks to look for one.
//
// -----------------------------------------------------------------------------
// TWO TIERS, BECAUSE "UNKNOWN" AND "DOCUMENT-SHAPED" ARE DIFFERENT FACTS
// -----------------------------------------------------------------------------
// An unknown key is DROPPED by the projection. API_CONTRACT can add a field and
// a portal that refused every response carrying one would break on an additive
// change, which is not what any invariant here asks for.
//
// A document-shaped or screened-value key is REFUSED. `SCREENED_KEY_TERMS` is
// the union of two obligations: the documents and biometrics Appendix D2 and
// VG-10 keep out of Merit's storage entirely, and INV-M19-09's provider reason
// code, which lives on the `kyc_verifications` row and "reaches no response".
// The dispatch that ordered this screen states the pair as one rule: render
// STATUS, never a document, and never a value screened out of a payload.
//
// -----------------------------------------------------------------------------
// THE PORT IS FILLED NOW, AND IT IS FILLED THROUGH ADR-162's ONE TRANSPORT FILE
// -----------------------------------------------------------------------------
// THIS HEADER USED TO SAY "THERE IS NO TRANSPORT IN THIS APPLICATION" AND THAT
// SENTENCE HAS EXPIRED. ADR-162 landed `../../http/client.ts`, which is the one
// file under `apps/portal/src` permitted to call `fetch(`, and it named the
// wiring this file was waiting for: "the other five segments are not wired
// here; each is one `load` and one guard." This is that guard and that load for
// the `kyc` segment.
//
// NOTHING BELOW OPENS A CONNECTION ITSELF. `statusFrom` takes an `ApiClient` and
// `SERVER_KYC_SCREEN_SOURCE` asks `serverApiClient()` for one; there is no
// `fetch(` in this directory and `apps/portal/test/surface.test.ts` fails on one
// by name and line. The origin, the forwarded cookie, the `no-store` and the
// status mapping are all ADR-162's and none of them is re-decided here.
//
// `GET /kyc/status` IS REGISTERED AND WAS MEASURED RATHER THAN ASSUMED.
// `discoverRouteModules()` then `buildServer({ surface: 'public', modules })`,
// reading `CompositionReport.registered` on this tree, lists `GET /kyc/status`.
// ADR-162's own dispatch was told two endpoints were registered and only one
// was, so this segment measured its own.
//
// -----------------------------------------------------------------------------
// `POST /kyc/session` IS REGISTERED TOO AND THIS SEGMENT DOES NOT CALL IT
// -----------------------------------------------------------------------------
// The same measurement lists it, so the refusal below is not "the endpoint does
// not exist". IT IS THE FENCE, AND TWO INDEPENDENT ONES AT THAT.
//
//   ONE. IT IS A WRITE, AND `apps/portal/test/surface.test.ts` asserts that
//   "nothing that changes a trader account exists in this app". That is not a
//   guess about what the route does: `apps/api/src/routes/kyc.ts` declares
//   `openVerification`, which "WRITES TWO ROWS IN ONE TRANSACTION" -- a
//   `kyc_verifications` row and a `kyc_funnel_events` row at `session_created`
//   -- and the same file records that "it is a new row every time and there is
//   no update on this port". A read surface that started one would be changing
//   the trader's identity record from a page whose whole fence is that it does
//   not. The forbidden list in that test already carries `kycSubmit`.
//
//   TWO. THE TRANSPORT CANNOT DO IT. `ApiClient` in ../../http/client.ts
//   declares `get` and NO SECOND METHOD, and that file is ADR-162's: its
//   foreclosure 1 is that no other file in `apps/portal/src` may call `fetch(`,
//   so a POST from here is either an edit to a file this session may not touch
//   or a second transport the suite fails on.
//
// SESSION 158's RULE IS WHY NEITHER IS ROUTED AROUND: "a session that deletes an
// entry instead of narrowing it has removed the control while appearing to
// satisfy it." Nothing is narrowed in `surface.test.ts` by this session, because
// nothing here needs it narrowed.
//
// NOTHING HERE IS A SERVER ACTION. ADR-095 ruling 3 and ADR-083 section 3: no
// route handler and no Server Action in this deployable may serve `/api/v1` or
// any operator path. A server action that went and got a KYC document would
// break that and the no-proxy invariant at once.
//
// -----------------------------------------------------------------------------
// AND THE WHOLE SEGMENT FAILS CLOSED, WHICH ON THIS SCREEN IS A COMPLIANCE RULE
// -----------------------------------------------------------------------------
// `apps/api/src/routes/accounts.ts:824` carries the posture for this class of
// read, on the identical question one deployable over: a verification chain
// whose head cannot be named "fails closed, because the alternative is
// reporting somebody verified on the strength of an ordering this table does
// not declare."
//
// THIS FILE IS THAT SENTENCE ON THE SCREEN SIDE. A status that cannot be read,
// cannot be parsed, or carries a key this surface may never render REFUSES, and
// ./page.ts renders the refusal as a content state. It never renders `verified`,
// because a screen that said "verified" on a failure path would be Merit making
// a statement about an identity check nobody performed; and it never renders
// nothing, because a blank reads as neither and leaves the trader unable to tell
// a passed check from a broken page.
//
// IT DOES NOT SUBSTITUTE `kyc_required` EITHER, WHICH IS WHERE THIS DIVERGES
// FROM `accounts.ts` ON PURPOSE. That function is computing a value the API will
// state; this one is rendering a value the API stated. Falling back to
// `kyc_required` here would put a sentence in the server's mouth -- "you need to
// verify" -- that no server said, and would tell an already-verified trader to
// go and do it again. The honest fail-closed answer on a screen is the error
// state, and `ContentState` already has one.
// =============================================================================

import type { KycStatus } from '../../api/types.ts';
import type { ApiClient } from '../../http/client.ts';
import { ApiConfigError, serverApiClient } from '../../http/client.ts';
import type { PortalErrorKind } from '../../shell/app-shell.ts';

/**
 * API_CONTRACT section 7's `KycStatus`, field for field, as an allowlist.
 *
 * IT IS A LIST AND THE PROJECTION IS A COPY, on `routes/kyc.ts`'s own argument
 * for `projectStatus`: a spread would be shorter and would be the `SELECT *`
 * the contract forbids. Here the spread would additionally carry every key the
 * screen just refused, in the one function whose job is to not do that.
 */
export const KYC_STATUS_FIELDS = [
  'state',
  'placement',
  'verified_at',
  'expires_at',
  'action_required',
] as const;

/**
 * Key fragments that may never appear anywhere in a payload this page renders.
 *
 * MATCHED CASE-INSENSITIVELY AND AS A SUBSTRING, on the precedent
 * `INTERNAL_TIER_TERMS` sets one file over and for the same reason: a
 * word-boundary match lets `documentFront` through, and the cost of a false
 * positive is a field being renamed upstream while the cost of a false negative
 * is a passport on a screen.
 *
 * THE LIST IS ASSERTED DISJOINT FROM `KYC_STATUS_FIELDS` by the suite. A term
 * that matched a contract field would refuse every well-formed response, which
 * is the direction this check must never fail in.
 */
export const SCREENED_KEY_TERMS = [
  // Appendix D2 and VG-10: documents and biometrics never touch Merit.
  'document',
  'passport',
  'licence',
  'license',
  'id_card',
  'national',
  'selfie',
  'photo',
  'image',
  'portrait',
  'biometric',
  'liveness',
  'face',
  'scan',

  // The provider's own payload, which AS-M19-07 counter 4 keeps out of logs
  // and out of everything else by a CI scanner.
  'raw_result',

  // INV-M19-09: the provider's internal reason is on the row and reaches no
  // response, ever.
  'rejection_reason',
  'reason_code',

  // Identity attributes the status surface has no field for and no business
  // holding. A response that carried one is a minimisation failure upstream.
  'date_of_birth',
  'dob',
  'ssn',
  'tax_id',
  'address',
  'full_name',
] as const;

/** How deep the screen walks before it refuses to keep looking. */
const MAX_SCREEN_DEPTH = 8;

/** A payload carrying a key this surface may never render or log. */
export class ScreenedFieldError extends Error {
  constructor(readonly keyPaths: readonly string[]) {
    super(
      `the KYC status payload carries ${keyPaths.length} screened key path(s), ` +
        `${keyPaths.join(', ')}. ADR-114 clause 6: Merit never proxies a document, and this ` +
        'screen REFUSES rather than redacts, because a page that quietly dropped the field ' +
        'would render correctly forever while the response kept carrying it to every other ' +
        'consumer. The fix is upstream, in the handler that put the key in the response. ' +
        'ONLY KEY PATHS APPEAR ABOVE AND NO VALUE DOES, because this message is written to a ' +
        'log and a message quoting what it screened out would be the leak it exists to stop.',
    );
    this.name = 'ScreenedFieldError';
  }
}

/** A payload that is not API_CONTRACT section 7's `KycStatus`. */
export class KycStatusShapeError extends Error {
  constructor(readonly detail: string) {
    super(
      `the KYC status payload is not API_CONTRACT section 7's KycStatus: ${detail}. The screen ` +
        'refuses rather than filling in a field, because a verification screen that guesses is ' +
        'the one outcome SC-M4-07 exists to prevent.',
    );
    this.name = 'KycStatusShapeError';
  }
}

/** Every key path in `value`, in the order the walk reaches them. */
function screenedKeyPaths(value: unknown, trail: readonly string[], found: string[]): void {
  if (trail.length > MAX_SCREEN_DEPTH) {
    throw new KycStatusShapeError(
      `it nests deeper than ${MAX_SCREEN_DEPTH} levels at ${trail.slice(0, MAX_SCREEN_DEPTH).join('.')}, ` +
        'so the screen cannot say what it carries and will not render it',
    );
  }
  if (Array.isArray(value)) {
    value.forEach((member, index) => screenedKeyPaths(member, [...trail, String(index)], found));
    return;
  }
  if (value === null || typeof value !== 'object') return;

  for (const [key, member] of Object.entries(value as Record<string, unknown>)) {
    const path = [...trail, key].join('.');
    const lowered = key.toLowerCase();
    if (SCREENED_KEY_TERMS.some((term) => lowered.includes(term))) found.push(path);
    screenedKeyPaths(member, [...trail, key], found);
  }
}

function readString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string')
    throw new KycStatusShapeError(
      `\`${field}\` is ${typeof value} and the contract declares string`,
    );
  return value;
}

function readNullableString(body: Record<string, unknown>, field: string): string | null {
  const value = body[field];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string')
    throw new KycStatusShapeError(
      `\`${field}\` is ${typeof value} and the contract declares string or null`,
    );
  return value;
}

/**
 * The runtime half of ADR-114 clause 6, applied to whatever `GET /kyc/status`
 * actually returned.
 *
 * THE ORDER IS THE CONTROL. The screen runs over the WHOLE payload before one
 * field is read, so a document-shaped key refuses the render rather than riding
 * along beside five fields that projected cleanly.
 */
export function screenKycStatus(raw: unknown): KycStatus {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    throw new KycStatusShapeError(`it is ${raw === null ? 'null' : typeof raw} and not an object`);

  const found: string[] = [];
  screenedKeyPaths(raw, [], found);
  if (found.length > 0) throw new ScreenedFieldError(found);

  const body = raw as Record<string, unknown>;
  return {
    state: readString(body, 'state'),
    placement: readString(body, 'placement'),
    verified_at: readNullableString(body, 'verified_at'),
    expires_at: readNullableString(body, 'expires_at'),
    action_required: readNullableString(body, 'action_required'),
  };
}

/**
 * Everything this page reaches the world through, and NO SECOND METHOD.
 *
 * THERE IS NO METHOD HERE THAT RETURNS A DOCUMENT AND NO FIELD ONE COULD BE
 * ASSIGNED TO, which is ADR-114 clause 6's first half stated as a type. There
 * is deliberately no `documents()`, no `hostedUrl()` and no `applicantRef()`:
 * the hosted flow is `POST /kyc/session`'s answer and starting one is a
 * mutation, which is money-adjacent, another session's, and not a thing a read
 * surface may grow quietly.
 *
 * IT CARRIED `impersonation()` AND `disclosure()` UNTIL SESSION 250 LANDED, and
 * losing them is the wiring rather than a narrowing. The band and the footer are
 * `app/layout.tsx`'s, which renders around every page in this app, so a page
 * that still fetched them could only render a second copy. One method left is
 * the honest shape: the only thing this screen needs from the world is the
 * trader's status.
 */
export interface KycScreenSource {
  /** `GET /kyc/status`. Five fields, none of them a document. */
  status(): Promise<KycStatus>;
}

/**
 * Thrown by an EMPTIED port, and the page RENDERS it rather than dying on it.
 *
 * IT IS NO LONGER WHAT A PRODUCTION DEPLOYMENT MEETS, and the change is the
 * wiring rather than a softening. `SERVER_KYC_SCREEN_SOURCE` below is the
 * default now and it performs a real read; what remains here is the value a
 * caller installs when it wants a source that answers nothing, which is what
 * the suite installs and what any later slice that needs a hard "no source"
 * reaches for. The class is kept rather than deleted because a fail-closed
 * default that exists is a thing a reviewer can point at.
 *
 * THE PAGE STILL RENDERS IT AS A CONTENT STATE. While this segment owned the
 * footer, an unwired disclosure had to throw: a screen that cannot render a
 * required disclosure must not render. `app/layout.tsx` renders the footer now,
 * unconditionally and around every page, so an unavailable status is content
 * that failed rather than an obligation that failed.
 */
export class KycScreenSourceUnwired extends Error {
  constructor(readonly method: string) {
    super(
      `KycScreenSource.${method} is not wired. The installed source answers nothing, which is ` +
        'the port emptied on purpose rather than a deployment that has no API: ' +
        '`SERVER_KYC_SCREEN_SOURCE` is the default and reads GET /kyc/status through ' +
        "ADR-162's client. A deployment with no API origin configured raises " +
        '`KycStatusUnavailable` instead, and both render as an error content state.',
    );
    this.name = 'KycScreenSourceUnwired';
  }
}

function unwired(method: string): () => Promise<never> {
  return () => Promise.reject(new KycScreenSourceUnwired(method));
}

/** A source that answers nothing. It fails CLOSED on every method. */
export const UNWIRED_KYC_SCREEN_SOURCE: KycScreenSource = {
  status: unwired('status'),
};

// -----------------------------------------------------------------------------
// The seam, which is ADR-162's client and no second transport
// -----------------------------------------------------------------------------

/**
 * `GET /kyc/status`, as API_CONTRACT section 7 spells it.
 *
 * NO BASE PATH. ../../http/client.ts appends `/api/v1` and its header calls
 * that "one string in one file"; a segment that spelled the base path here
 * would be a second copy of `apps/api/src/surface.ts`'s `BASE_PATH` that
 * nothing asserts against, and `apps/portal/test/kyc-page.test.ts` already
 * fails this directory on the literal.
 *
 * THE STRING IS ASSERTED AGAINST THE HANDLER THAT SERVES IT.
 * `apps/portal/test/kyc-source.test.ts` reads `KYC_STATUS_PATH` out of
 * `apps/api/src/routes/kyc.ts` and fails if the two stop agreeing, which is the
 * treatment ADR-162 gives `API_BASE_PATH` and `SESSION_COOKIE` for the same
 * reason: a second copy nobody checks drifts silently.
 */
export const KYC_STATUS_PATH = '/kyc/status';

/**
 * `GET /kyc/status` could not be read, and WHICH refusal it was.
 *
 * `error` IS MEASURED AND NOT A CONSTANT, and that is the whole of what this
 * type adds. ./page.ts rendered `toPortalErrorKind(503)` for every failure,
 * which told a trader whose session had expired that Merit could not load the
 * page just now. ADR-162's client already mapped the status the API actually
 * returned; this carries it the last two files, and `status` comes with it so a
 * reader can tell "the API said 401" from "nothing answered".
 *
 * IT IS `PortalErrorKind` AND THIS FILE ADDS NO MEMBER TO THAT UNION, which is
 * ADR-162 clause 3 and ../../shell/app-shell.ts's paragraph on why `403` is
 * deliberately unmapped.
 */
export class KycStatusUnavailable extends Error {
  constructor(
    readonly error: PortalErrorKind,
    readonly status: number | null,
  ) {
    super(
      `GET ${KYC_STATUS_PATH} could not be read: ${error}` +
        (status === null ? ' with no response at all' : ` (HTTP ${String(status)})`) +
        '. The screen refuses rather than rendering a status nobody sent, because a ' +
        'verification screen that guesses is what SC-M4-07 exists to prevent, and a screen ' +
        'that guessed VERIFIED would be a statement Merit makes about an identity check.',
    );
    this.name = 'KycStatusUnavailable';
  }
}

/**
 * The status, from a client.
 *
 * THE GUARD IS `screenKycStatus` AND IT WAS ALREADY HERE. ADR-162 clause 5
 * returns `unknown` from the transport and rules that "narrowing is the
 * segment's and is forced", landing "beside the transcription that declares the
 * shape". This segment wrote that narrowing months before a transport existed;
 * what this function adds is the line that hands it the bytes.
 *
 * IT CHECKS EVERY FIELD THE VIEW READS AND NOT A SUBSET, which is ADR-162's
 * foreclosure 5: "a partial guard reads as a complete one at the call site and
 * crashes on the field it skipped, which is worse than none because it looks
 * like a control." `screenKycStatus` reads all five of `KYC_STATUS_FIELDS`,
 * refuses a non-string on any of them, and screens the WHOLE payload for a
 * document-shaped key before it reads one field.
 *
 * EXPORTED SEPARATELY FROM THE SOURCE SO THE READY BRANCH IS REACHED THROUGH
 * THE REAL CLIENT. `apps/portal/test/kyc-source.test.ts` calls it with a client
 * built by `createApiClient` over a stub transport, which exercises the whole
 * seam -- URL composition, the forwarded cookie, `no-store`, the status
 * mapping, the JSON read, this screen -- rather than a mock of it.
 */
export async function statusFrom(client: ApiClient): Promise<KycStatus> {
  const response = await client.get(KYC_STATUS_PATH);
  if (!response.ok) throw new KycStatusUnavailable(response.error, response.status);
  return screenKycStatus(response.body);
}

/**
 * The production source. ONE READ, THROUGH ADR-162's CLIENT, PER REQUEST.
 *
 * THE CLIENT IS BUILT INSIDE `status()` AND NOT AT MODULE SCOPE, and that is
 * required rather than tidy. `serverApiClient()` is bound to ONE SESSION: it
 * reads the inbound request's `merit_session` cookie and closes over it. A
 * client built once when this module loaded would serve the first trader's
 * cookie to every trader afterwards, which is `FM-M4-03`, "the single most
 * common vibe-code fatality", reached by a `const` at the top of a file.
 *
 * `ApiConfigError` AND NOTHING ELSE IS CONVERTED. An unset `MERIT_API_ORIGIN`
 * means this deployment has no API, so the status is genuinely unreadable and
 * the screen should say so; it is `server_error` with `status: null`, which is
 * the shape ADR-162 gives a request that never reached a status line and for
 * the same reason -- there is no number, and inventing one would put a sentence
 * in the server's mouth that no server said.
 *
 * ANYTHING ELSE PROPAGATES. A transport failure is already an `ApiFailure` and
 * arrives through `statusFrom`; a bug in a path, a `cookies()` called outside a
 * request scope, or anything else this file did not foresee is NOT dressed up
 * as a configuration problem, because converting it would make every fault in
 * this application look like a deployment that was never configured.
 */
export const SERVER_KYC_SCREEN_SOURCE: KycScreenSource = {
  status: async (): Promise<KycStatus> => {
    let client: ApiClient;
    try {
      client = await serverApiClient();
    } catch (cause) {
      if (!(cause instanceof ApiConfigError)) throw cause;
      throw new KycStatusUnavailable('server_error', null);
    }
    return statusFrom(client);
  },
};

let source: KycScreenSource = SERVER_KYC_SCREEN_SOURCE;

/** Install the source. A wiring slice calls this; so does the suite. */
export function useKycScreenSource(next: KycScreenSource): void {
  source = next;
}

/**
 * Restore the default, which READS rather than refuses.
 *
 * IT USED TO RESTORE `UNWIRED_KYC_SCREEN_SOURCE` AND THE OBSERVABLE BEHAVIOUR
 * OF A DEPLOYMENT WITH NO API IS UNCHANGED: with `MERIT_API_ORIGIN` unset,
 * `SERVER_KYC_SCREEN_SOURCE.status()` raises `KycStatusUnavailable` before it
 * reaches a socket, and ./page.ts renders the same error content state it
 * rendered for `KycScreenSourceUnwired`. What changed is that a CONFIGURED
 * deployment now gets the trader's real status.
 */
export function resetKycScreenSource(): void {
  source = SERVER_KYC_SCREEN_SOURCE;
}

/** The installed source. */
export function currentKycScreenSource(): KycScreenSource {
  return source;
}
