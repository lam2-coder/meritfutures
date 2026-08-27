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
// THE PORT FAILS CLOSED, WHICH IS `routes/kyc.ts`'s SHAPE ONE DEPLOYABLE OVER
// -----------------------------------------------------------------------------
// There is no transport in this application. `apps/portal` consumes `/api/v1`
// and nothing else (M04 section 1.1) and the API is its own deployable at its
// own origin, whose hostname this repository does not hold (ADR-012). So the
// production source resolves nothing and every method refuses, exactly as
// `productionKycDeps` does in `apps/api/src/routes/kyc.ts`: a default that
// returned plausible values would be a fixture serving real traffic.
//
// NOTHING HERE OPENS A CONNECTION AND NOTHING HERE IS A SERVER ACTION. ADR-095
// ruling 3 and ADR-083 section 3: no route handler and no Server Action in this
// deployable may serve `/api/v1` or any operator path. A server action that
// went and got a KYC document would break that and the no-proxy invariant at
// once, which is why the seam is a port a wiring slice fills rather than a
// call this file makes.
// =============================================================================

import type { KycStatus } from '../../api/types.ts';

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
 * Thrown by the default source, and the page RENDERS it rather than dying on it.
 *
 * THAT CHANGED WHEN THE ROOT LAYOUT LANDED, and the new behaviour is the better
 * one. While this segment owned the footer, an unwired disclosure had to throw:
 * a screen that cannot render a required disclosure must not render. The layout
 * renders the footer now, unconditionally and around every page, so an
 * unavailable status is content that failed rather than an obligation that
 * failed, and the honest answer is the error state inside intact chrome.
 */
export class KycScreenSourceUnwired extends Error {
  constructor(readonly method: string) {
    super(
      `KycScreenSource.${method} is not wired. This page renders and has no transport: ` +
        'apps/portal consumes the API base path and nothing else (M04 section 1.1), the API is ' +
        'its own deployable at an origin this repository does not hold (ADR-012), and no route ' +
        'handler ' +
        'or Server Action in this deployable may serve that surface (ADR-095 ruling 3). The ' +
        'seam is a port a wiring slice fills.',
    );
    this.name = 'KycScreenSourceUnwired';
  }
}

function unwired(method: string): () => Promise<never> {
  return () => Promise.reject(new KycScreenSourceUnwired(method));
}

/** The default, and it fails CLOSED on every method. */
export const UNWIRED_KYC_SCREEN_SOURCE: KycScreenSource = {
  status: unwired('status'),
};

let source: KycScreenSource = UNWIRED_KYC_SCREEN_SOURCE;

/** Install the source. A wiring slice calls this; so does the suite. */
export function useKycScreenSource(next: KycScreenSource): void {
  source = next;
}

/** Restore the fail-closed default. */
export function resetKycScreenSource(): void {
  source = UNWIRED_KYC_SCREEN_SOURCE;
}

/** The installed source. */
export function currentKycScreenSource(): KycScreenSource {
  return source;
}
