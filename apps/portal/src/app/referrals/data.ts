// =============================================================================
// apps/portal/src/app/referrals/data.ts
// =============================================================================
// WHERE THIS SEGMENT'S DATA COMES FROM, AND ONE THIRD OF IT IS NOW A REAL
// REQUEST.
//
// THIS FILE USED TO SAY "THIS SESSION IS A RENDERING SESSION AND IS NOT THAT
// DECISION" AND ADR-162 IS THE DECISION. It landed `../../http/client.ts`, the
// one file under `apps/portal/src` permitted to call `fetch(`, and it named
// exactly this work: "the other five segments are not wired here; each is one
// `load` and one guard." This is that load and that guard for `referrals`.
//
// THE PROMISE THE OLD HEADER MADE IS KEPT AND THE ONE PLACE IT COULD NOT BE IS
// SAID OUT LOUD. It read "WHOEVER WRITES THE PORTAL'S API CLIENT REPLACES THIS
// BODY AND NOTHING ELSE. The signature is the contract between that session and
// this one." The body is replaced. The SIGNATURE is not, and could not be: a
// function returning `Promise<ReferralScreenData>` has one success shape and no
// way to say which of three different things went wrong, and ADR-162 section 5
// item 1 is a whole foreclosure about a screen that cannot tell a refusal from
// an endpoint nobody serves. `ReferralScreenLoad` below is that repair, taken
// at the moment of wiring rather than reported.
//
// THE FILE IS STILL CALLED `data.ts` AND THE TWO WORKED EXAMPLES CALL THEIRS
// `source.ts`. It is not renamed because this file declared itself the seam and
// the next author following `page.ts` arrives here either way; the difference
// is recorded so it reads as a fact rather than as an oversight.
//
// -----------------------------------------------------------------------------
// THREE READS, THREE DIFFERENT FACTS, AND ONLY ONE OF THEM IS "NOT YET"
// -----------------------------------------------------------------------------
// `discoverRouteModules()` then `buildServer({ surface, modules })` for both
// surfaces, reading `CompositionReport.registered`, run against this tree:
//
//   GET /affiliate/stats        REGISTERED, on the public surface
//   GET /affiliate/creatives    REFUSED. Not "not registered". REFUSED
//   the NFA I-26-12 text        NO CONTRACT ROW DEFINES A READ AT ALL
//
// THE MIDDLE ROW IS THE ONE WORTH A READER'S TIME. [ADR-168](../../../../../docs/decisions/ADR-168.md)
// clause 3 ruled it out by name: "M08 section 4 enumerates the affiliate
// surface, says in its own prose that it 'adds one', and the one is the `POST`.
// No approved document states a read of that collection, a shape for it, an
// auth rule or an error set. Inventing it would be inventing scope."
//
// SO A REFUSED READ IS NOT A MISSING ONE AND THIS FILE WILL NOT LET THEM BE
// SPELLED THE SAME. `PendingRead` and `RefusedRead` below carry different
// discriminants, so a refused read is not assignable to `missing` and the
// mistake is `error TS2741` rather than a sentence on a screen telling an
// affiliate that Merit is still building something Merit decided not to build.
// ADR-168 foreclosure 7 is the direction that matters: "it forecloses 'the
// application named it, therefore it is owed'."
//
// THE THIRD ROW IS A THIRD SHAPE AGAIN. `../../view/disclosure.ts` states it in
// its own words -- "NO CONTRACT ROW SERVES `content_documents` TO THE PORTAL" --
// and `app/layout.tsx` met the same wall for the simulated-environment
// disclosure and quoted GLOSSARY rather than minting a `DisclosureBlock` it
// could not source. That escape is not available here: `ReferralPanelView.
// disclosure` IS a `DisclosureBlock`, and minting one from a literal typed in
// this repository is the single thing `../../view/disclosure.ts` exists to make
// impossible. ADR-138 section 6 carries the endpoint as owed; until it lands
// the text is a PARAMETER, which is ./../payouts/source.ts's `eligibility` and
// ./../accounts/source.ts's `marks` for the same reason.
//
// -----------------------------------------------------------------------------
// NO FIXTURE, WHICH IS THE ONE PARAGRAPH OF THE OLD HEADER THAT IS UNCHANGED
// -----------------------------------------------------------------------------
// The tempting alternative was, and still is, to seed plausible numbers so the
// route renders today. A referral screen showing invented commission figures is
// a screen that looks finished and states amounts Merit never computed, on the
// surface M08 AS-M8-04 is about. Nothing below produces a figure: `ready` is
// reached only from a response that satisfied the guard, and every other arm
// says which read it did not make.

import type { AffiliateStats } from '../../api/types.ts';
import type { ApiClient } from '../../http/client.ts';
import { ApiConfigError, serverApiClient } from '../../http/client.ts';
import type { PortalErrorKind } from '../../shell/app-shell.ts';
import type { CreateCreativeResponse } from '../../view/referrals.ts';

// -----------------------------------------------------------------------------
// The path, as API_CONTRACT section 7 spells it
// -----------------------------------------------------------------------------

/**
 * `GET /affiliate/stats`. SC-M4-09's whole numeric source.
 *
 * NO BASE PATH. `../../http/client.ts` appends the contract's base path and its
 * header calls that "one string in one file"; a segment that spelled it here
 * would be a third copy of `apps/api/src/surface.ts`'s `BASE_PATH` that nothing
 * asserts against, and `apps/portal/test/app-referrals.test.ts` already fails
 * this directory on the literal.
 *
 * THE STRING IS ASSERTED AGAINST THE HANDLER THAT SERVES IT.
 * `apps/portal/test/referrals-source.test.ts` reads `AFFILIATE_STATS_PATH` out
 * of `apps/api/src/routes/affiliate.ts` and fails if the two stop agreeing,
 * which is the treatment ADR-162 gives `API_BASE_PATH` and `SESSION_COOKIE` and
 * the treatment `app/kyc/source.ts` gives its own path, for one stated reason:
 * a second copy nobody checks drifts silently, and a wrong path here answers
 * 404, which `toPortalErrorKind` maps to `not_found`, on a screen that would
 * then tell an affiliate their referral code was not found.
 */
export const AFFILIATE_STATS_PATH = '/affiliate/stats';

// -----------------------------------------------------------------------------
// Two absences, and the type refuses to spell them the same way
// -----------------------------------------------------------------------------

/**
 * A read this screen needs, did not make, and COULD MAKE ONE DAY.
 *
 * BOTH REASONS ARE STATES SOMETHING CAN LEAVE, which is the whole of what
 * separates this type from the next one. An unconfigured deployment is
 * configured by an operator; an unserved read is served by a later slice. Each
 * is a sentence that will stop being true.
 */
export type PendingRead = {
  readonly kind: 'pending';

  /** The read, as the document that owns it spells it. */
  readonly read: string;

  /**
   * `no_api_origin`     `MERIT_API_ORIGIN` is unset, so NOTHING is reachable.
   *                     ADR-162 clause 1 refuses a default rather than guessing
   * `nothing_serves_it` No approved document defines a read that would answer
   *                     this, so no request was made and none would have helped
   */
  readonly why: 'no_api_origin' | 'nothing_serves_it';
};

/**
 * A read a RULING refused. It is not late and it is not coming.
 *
 * IT CARRIES THE ENTRY THAT REFUSED IT so a reader who thinks the refusal is
 * wrong has somewhere to go and disagree, which is the difference between a
 * decision and a gap. ADR-168 section 3 clause 7 is the failure this separation
 * exists to prevent: "a comment in a segment is not a commitment, and the
 * direction that makes it one is how a portal's prose becomes Merit's scope."
 *
 * THE DISCRIMINANT IS WHY THIS IS A TYPE AND NOT A FLAG. `ReferralScreenLoad`'s
 * `unavailable` arm carries `readonly PendingRead[]`, so a `RefusedRead` pushed
 * into it is `error TS2741` at the line that wrote it rather than a row on a
 * screen reading "Waiting on: GET /affiliate/creatives" for as long as this
 * application exists.
 */
export type RefusedRead = {
  readonly kind: 'refused';

  /** The read, as the ruling that refused it names it. */
  readonly read: string;

  /** The entry, so the refusal is arguable rather than folklore. */
  readonly ruling: string;
};

/**
 * The NFA I-26-12 disclosure's text, which no contract row serves.
 *
 * IT IS NAMED AS A READ RATHER THAN AS AN ENDPOINT because there is no endpoint
 * to name. `../../view/disclosure.ts` and `app/layout.tsx` both record the same
 * absence, from a `content_documents` row rather than from a path, and writing
 * a plausible `GET /content/:slug` here would be inventing the very thing
 * ADR-168 clause 3 refuses one row up.
 */
export const NFA_DISCLOSURE_READ: PendingRead = {
  kind: 'pending',
  read: 'the NFA I-26-12 disclosure text, from content_documents',
  why: 'nothing_serves_it',
};

/** `GET /affiliate/stats`, unreachable only because nothing told this deployment where the API is. */
export const STATS_UNREACHABLE: PendingRead = {
  kind: 'pending',
  read: `GET ${AFFILIATE_STATS_PATH}`,
  why: 'no_api_origin',
};

/**
 * The reads this screen will never make.
 *
 * ONE ENTRY, AND IT IS NOT A COMPLAINT. `POST /affiliate/creatives` is
 * registered and serves the creative and its required disclosure in its own
 * response; what ADR-168 clause 3 refused is a READ of the collection, and M08
 * routing the requirement through the submission is a reading that entry calls
 * coherent (its finding 15).
 */
export const REFUSED_READS: readonly RefusedRead[] = [
  { kind: 'refused', read: 'GET /affiliate/creatives', ruling: 'ADR-168 clause 3' },
];

// -----------------------------------------------------------------------------
// What the page got
// -----------------------------------------------------------------------------

/**
 * The three wire answers SC-M4-09 renders.
 *
 * `creative` IS NULLABLE BECAUSE NO ROW READS ONE BACK, AND THE NULL IS NOW A
 * RULING RATHER THAN A GAP. API_CONTRACT section 7 carries
 * `POST /affiliate/creatives` and no `GET`, and ADR-168 clause 3 ruled that the
 * `GET` does not land. So the only moment this response exists is the
 * submission itself, permanently, and `./screen.ts` words the null branch as
 * what it is rather than as "nothing has been submitted".
 */
export type ReferralScreenData = {
  readonly stats: AffiliateStats;
  readonly creative: CreateCreativeResponse | null;

  /**
   * The NFA I-26-12 disclosure's TEXT, from the `content_documents` row
   * `./page.ts` names.
   *
   * IT IS ON THIS TYPE AND NOT IN THE PAGE, and the reason is the strongest
   * sentence in `../../view/disclosure.ts`: a required disclosure "cannot be a
   * literal typed at the point of render". A page that held the sentence would
   * be exactly that, and the brand would be satisfied by the thing it exists to
   * refuse.
   */
  readonly disclosure_text: string;
};

/** The `error` arm's payload. `ApiFailure` without the discriminant. */
export type ReferralsFailure = {
  readonly error: PortalErrorKind;
  readonly status: number | null;
};

/**
 * What `./page.ts` renders.
 *
 * THREE ARMS AND THE THIRD IS THE ONE SESSION 273 REPORTED MISSING. ADR-162
 * section 5 item 1: `PayoutCenterLoad` has `ready` and `unavailable` only, so a
 * `GET /payouts` that returns 500 renders exactly as a missing endpoint does,
 * and that entry reported it rather than repairing it because its fence held
 * one file. Session 285 closed the same hole for `accounts` at the moment of
 * authorship. This segment had no load type at all, so the two-arm union is not
 * being repaired here either: it is being declined.
 *
 *   `ready`        the data arrived and the screen renders
 *   `unavailable`  NOTHING FAILED AND NOTHING WAS REFUSED. Either this
 *                  deployment has not been told where its API is, or a read
 *                  this screen needs is served by nothing yet.
 *                  `../../shell/app-shell.ts`'s `ContentState` has no member
 *                  for this and that is deliberate: it is not `loading`, not
 *                  `empty` and not `error`
 *   `error`        A REGISTERED ENDPOINT REFUSED OR FAILED. It carries the
 *                  `PortalErrorKind` `../../http/client.ts` already mapped and
 *                  the status it was mapped from, and nothing here words it:
 *                  INV-M4-07 makes the wording one place's job
 */
export type ReferralScreenLoad =
  | ({ readonly kind: 'ready' } & ReferralScreenData)
  | { readonly kind: 'unavailable'; readonly missing: readonly PendingRead[] }
  | ({ readonly kind: 'error' } & ReferralsFailure);

// -----------------------------------------------------------------------------
// Narrowing, which is this segment's and not the transport's
// -----------------------------------------------------------------------------
// `../../http/client.ts` returns `unknown` and its section 5 argues why: a
// generic `get<T>` is a cast the compiler cannot check, and a transport that
// asserted wire shapes would have to know all of them. `unknown` cannot be read
// without a check, so the check is here, beside `../../api/types.ts`, which is
// where this application already transcribed the shape being checked for.
//
// EVERY FIELD `../../view/referrals.ts` READS IS CHECKED AND NOT A SUBSET.
// ADR-162 foreclosure 5: "a partial guard reads as a complete one at the call
// site and crashes on the field it skipped, which is worse than none because it
// looks like a control." `toReferralPanel` reads all nine fields of
// `AffiliateStats` and all nine are below.

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * An integer.
 *
 * INTEGER RATHER THAN NUMBER, AND ON THE MONEY AND BASIS-POINT FIELDS
 * SPECIFICALLY. "Money is integer cents. No floats anywhere, fixtures
 * included." `../../format/money.ts` is INV-M4-01's only permitted consumer of
 * a `_cents` or `_bp` field and it refuses a value that is not an exact
 * integer, so a fractional `payable_cents` would reach this screen as a thrown
 * `RangeError` inside a component rather than as an honest error state. This
 * refuses it one layer earlier.
 *
 * IT IS ALSO THE CHECK ON THE TWO COUNTS. `clicks_30d` and `conversions_30d`
 * are not money and a fractional one is still a server that answered wrongly.
 */
function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/**
 * `GET /affiliate/stats`, narrowed to API_CONTRACT section 7's `AffiliateStats`.
 *
 * IT IS A BARE OBJECT AND NOT A LIST, WHICH IS MEASURED RATHER THAN ASSUMED.
 * API_CONTRACT section 1's `{ data, next_cursor }` envelope covers the cursor
 * lists on this surface, `GET /affiliate/statements` among them; section 7
 * declares `AffiliateStats` as nine scalar fields and
 * `apps/api/src/routes/affiliate.ts`'s `projectStats` returns exactly those
 * nine. So this segment needs no envelope type, takes no paging decision, and
 * does not race whichever segment lands the first one.
 */
export function isAffiliateStats(value: unknown): value is AffiliateStats {
  if (!isRecord(value)) return false;

  return (
    isString(value['code']) &&
    isInteger(value['commission_bp']) &&
    isString(value['status']) &&
    isInteger(value['clicks_30d']) &&
    isInteger(value['conversions_30d']) &&
    isInteger(value['earned_cents_lifetime']) &&
    isInteger(value['payable_cents']) &&
    isInteger(value['paid_cents_lifetime']) &&
    isInteger(value['chargeback_rate_bp'])
  );
}

// -----------------------------------------------------------------------------
// The seam
// -----------------------------------------------------------------------------

/**
 * SC-M4-09, from a client and whatever the caller could obtain elsewhere.
 *
 * `disclosureText` IS A PARAMETER RATHER THAN A SECOND FETCH, AND THE `null` IS
 * A MEASUREMENT RATHER THAN A PLACEHOLDER. No contract row serves
 * `content_documents` to the portal, so there is no path to request and no
 * shape to guard; ADR-138 section 6 carries the endpoint as owed. Whoever lands
 * it writes the guard beside `isAffiliateStats` above and passes the text here,
 * AND THIS FUNCTION DOES NOT CHANGE. ./../payouts/source.ts took `eligibility`
 * and ./../accounts/source.ts took `marks` the same way for the same reason.
 *
 * `creative` IS A PARAMETER FOR A DIFFERENT REASON AND IT IS NOT IN `missing`.
 * ADR-168 clause 3 refused the read, so `null` here is not a screen waiting on
 * anything: it is the permanent shape of this application's access to that
 * collection. The parameter exists because `POST /affiliate/creatives` returns
 * one, and a later slice that submits a creative renders its own response
 * through this same function rather than through a second assembly.
 *
 * THE STATS READ IS PERFORMED EVEN THOUGH `ready` IS UNREACHABLE WITHOUT THE
 * DISCLOSURE, AND THAT IS DELIBERATE. Short-circuiting before the request would
 * render the same words for less work and would cost the two things that make
 * the difference between a screen and a placeholder: a refusal on a registered
 * endpoint would never be reported as a refusal, and the wired path would first
 * run in production on the day the disclosure read lands, which is the worst
 * possible day to discover a misconfigured origin. That is
 * ./../accounts/source.ts's argument on the identical shape.
 */
export async function loadFrom(input: {
  readonly client: ApiClient;
  readonly disclosureText: string | null;
  readonly creative: CreateCreativeResponse | null;
}): Promise<ReferralScreenLoad> {
  const response = await input.client.get(AFFILIATE_STATS_PATH);

  if (!response.ok) return { kind: 'error', error: response.error, status: response.status };

  // A `2xx` WHOSE BODY DOES NOT SATISFY THE GUARD IS `server_error`.
  // `../../http/client.ts` already answers exactly that for a `2xx` whose body
  // is not JSON, and a body that parses and does not match the shape is the
  // same fact one layer up. It is NOT `unavailable`: the endpoint is registered
  // and it replied, so "waiting on a read" would be false about a real answer.
  //
  // ITS `status` IS `null` AND THAT IS A LIMIT RATHER THAN A CLAIM. `ApiSuccess`
  // is `{ ok: true, body: unknown }` and carries no status, so the response's
  // own number is not available at this layer; inventing `200` would put a
  // number in the server's mouth to satisfy a field, and widening `ApiSuccess`
  // is a change to ADR-162's file, which this fence does not hold.
  if (!isAffiliateStats(response.body))
    return { kind: 'error', error: 'server_error', status: null };

  if (input.disclosureText === null) return { kind: 'unavailable', missing: [NFA_DISCLOSURE_READ] };

  return {
    kind: 'ready',
    stats: response.body,
    creative: input.creative,
    disclosure_text: input.disclosureText,
  };
}

/**
 * What `./page.ts` calls. `GET /affiliate/stats`, with the trader's cookie.
 *
 * THE ONE CONVERSION, AND ITS NARROWNESS IS THE ARGUMENT. `MERIT_API_ORIGIN`
 * unset means this deployment has no API, so every read this screen needs is
 * unreachable, which is what `unavailable` says and is not a fault the trader
 * caused or can act on. ADR-162 foreclosure 6 rules exactly this and rules the
 * rest of it too: anything else -- a transport failure, a bug in a path, a
 * `cookies()` called outside a request scope -- is NOT converted and
 * PROPAGATES, because converting it would make every fault in this application
 * look like a pending read.
 *
 * BOTH DIRECTIONS ARE ASSERTED. `apps/portal/test/referrals-source.test.ts`
 * proves the conversion happens with the variable unset AND proves that a
 * failure past `resolveApiOrigin` reaches the caller unconverted.
 */
export async function load(): Promise<ReferralScreenLoad> {
  let client: ApiClient;
  try {
    client = await serverApiClient();
  } catch (error) {
    if (!(error instanceof ApiConfigError)) throw error;
    return { kind: 'unavailable', missing: [STATS_UNREACHABLE, NFA_DISCLOSURE_READ] };
  }

  return loadFrom({ client, disclosureText: null, creative: null });
}
