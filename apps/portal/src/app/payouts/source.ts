// =============================================================================
// apps/portal/src/app/payouts/source.ts
// =============================================================================
// WHERE THIS SEGMENT'S DATA COMES FROM, AND IT IS NOW A REAL REQUEST.
//
// THIS FILE USED TO SAY "THIS SESSION IS NOT THAT SOMEBODY" AND ADR-162 IS THAT
// SOMEBODY. It named five things a client for `/api/v1` needs -- a base URL, a
// session cookie policy, an error mapping onto ../../shell/app-shell.ts's
// `PortalErrorKind`, a caching decision `INV-M4-04`'s re-fetch depends on, and
// the fact that five other segments need the SAME client -- and every one of
// them is argued in ../../../http/client.ts at the point it is made. This
// segment invents none of them and holds no `fetch(`:
// `apps/portal/test/payouts-segment.test.ts` still asserts that over this
// directory and it still passes, unchanged.
//
// THE PROMISE THE OLD HEADER MADE IS KEPT LITERALLY. It said "`load` below
// gains a `ready` branch and NOTHING ELSE IN THIS SEGMENT CHANGES", and nothing
// else did: ./view.ts, ./sections.ts, ./page.ts and ./wire.ts are untouched by
// this session, `PayoutCenterLoad` has the same two arms, and `readyFrom` has
// the same signature.
//
// -----------------------------------------------------------------------------
// ONE OF THE TWO ENDPOINTS EXISTS AND THE OTHER DOES NOT, AND THAT WAS MEASURED
// -----------------------------------------------------------------------------
// `discoverRouteModules()` then `buildServer({ surface: 'public', modules })`,
// reading `CompositionReport.registered`, run against this tree:
//
//   `GET /payouts`                            REGISTERED (session 252)
//   `GET /accounts/:accountId/eligibility`    NOT REGISTERED. Nothing serves it
//
// The accounts module registers `GET /accounts` and `GET /accounts/:accountId`
// and stops there; its own header calls `/eligibility` "somebody else's
// endpoint". [Session 272](../../../../../docs/sessions/2026-08-27-session-272.md)
// measured the same thing from the other direction and rowed it as one of six
// endpoints API_CONTRACT defines and nothing registers.
//
// SO `load` FETCHES THE ONE THAT EXISTS AND ASKS NOTHING OF THE ONE THAT DOES
// NOT. Issuing a request to an unregistered path would return 404, which
// ../../../http/client.ts correctly maps to `not_found`, and a screen that
// rendered that would tell the trader their ACCOUNT was not found. The screen
// keeps saying what is true: it is waiting on an endpoint.
//
// -----------------------------------------------------------------------------
// ONE THING THIS SCREEN CANNOT SAY YET, AND IT IS REPORTED RATHER THAN HIDDEN
// -----------------------------------------------------------------------------
// `PayoutCenterLoad` has no error arm, and a `GET /payouts` that returns 500 is
// therefore rendered by ./sections.ts's `PayoutCenterUnavailable` exactly as a
// missing endpoint is. That is this file's own argument -- "`unavailable` IS
// NOT AN ERROR STATE" -- cutting the other way now that a request can fail.
//
// THE REPAIR IS NOT TAKEN HERE BECAUSE IT IS NOT ONE FILE. An error arm needs
// ./sections.ts to render it and ./page.ts to branch on it, and this session's
// fence holds neither. It is reported in ADR-162's foreclosures and in the
// pull request rather than reached for, which is the same rule that kept the
// transport out of this directory in the first place.

import type { EligibilityResponse } from '../../api/types.ts';
import type { ApiClient } from '../../http/client.ts';
import { ApiConfigError, serverApiClient } from '../../http/client.ts';
import { toPayoutCenterView } from './view.ts';
import type { PayoutCenterView } from './view.ts';
import type { PayoutListItem, PayoutStatus } from './wire.ts';

/**
 * The two endpoints M04 section 4 names for this screen.
 *
 * UNCHANGED, AND THE LIST IS STILL THE SCREEN'S REQUIREMENT RATHER THAN ITS
 * STATUS. What changed is that `load` now reports which of them it actually
 * failed to get, rather than assuming both.
 */
export const REQUIRED_ENDPOINTS = ['GET /accounts/:accountId/eligibility', 'GET /payouts'] as const;

/** The path `GET /payouts` is registered at, without API_CONTRACT's base path. */
export const PAYOUTS_PATH = '/payouts';

/**
 * What the page got.
 *
 * `unavailable` IS NOT AN ERROR STATE. ../../shell/app-shell.ts's `ContentState`
 * has `loading`, `empty` and `error`, and this is none of the three: nothing is
 * in flight, nothing is absent from a populated response, and nothing failed.
 * Mapping it onto `error` would put a working screen into the vocabulary of a
 * fault, which is the same move M04 section 3.2 forbids when it refuses to word
 * a 422 as a rejection.
 */
export type PayoutCenterLoad =
  | { readonly kind: 'ready'; readonly view: PayoutCenterView }
  | { readonly kind: 'unavailable'; readonly missing: readonly string[] };

/**
 * Build the screen from two responses.
 *
 * EXPORTED SEPARATELY FROM `load` SO THE READY BRANCH IS EXERCISABLE TODAY.
 * `apps/portal/test/payout-center.test.ts` renders this segment's real output
 * through this function with responses transcribed from API_CONTRACT, so the
 * screen is proven against data rather than against a placeholder, months
 * before a transport exists to fetch it.
 */
export function readyFrom(input: {
  readonly eligibility: EligibilityResponse;
  readonly payouts: readonly PayoutListItem[];
}): PayoutCenterLoad {
  return { kind: 'ready', view: toPayoutCenterView(input) };
}

// -----------------------------------------------------------------------------
// Narrowing, which is this segment's and not the transport's
// -----------------------------------------------------------------------------
// ../../../http/client.ts returns `unknown` and its section 5 argues why: a
// generic `get<T>` is a cast the compiler cannot check, and a transport that
// asserted wire shapes would have to know all of them. `unknown` cannot be read
// without a check, so the check is here, beside ./wire.ts, which is where this
// segment already transcribed the shape it is checking for.

/**
 * Every member of `PayoutStatus`, as a lookup the compiler keeps complete.
 *
 * `Record<PayoutStatus, true>` IS THE MECHANISM. A member added to ./wire.ts
 * and not added here is `error TS2741`, so this list cannot drift from the
 * union it guards the way a hand-written array of strings would.
 */
const PAYOUT_STATUSES: Readonly<Record<PayoutStatus, true>> = {
  approved: true,
  held_pending_review: true,
  settled: true,
  failed: true,
  frozen: true,
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/**
 * An integer.
 *
 * INTEGER RATHER THAN NUMBER, AND ON THE MONEY FIELDS SPECIFICALLY. "Money is
 * integer cents. No floats anywhere, fixtures included." A server that sent
 * `180000.5` would render through ../../format/money.ts as something, and the
 * something would be wrong on the one screen where wrong is expensive. This is
 * the cheapest place in the application to refuse it.
 */
function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isTimeline(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((entry) => isRecord(entry) && isString(entry['state']) && isString(entry['at']))
  );
}

function isHold(value: unknown): boolean {
  if (value === null) return true;
  return (
    isRecord(value) &&
    isString(value['held_at']) &&
    isString(value['resolves_by']) &&
    isString(value['tos_clause'])
  );
}

/**
 * `GET /payouts`, narrowed to the shape ./wire.ts declares.
 *
 * EVERY FIELD ./view.ts READS IS CHECKED AND NOT A SUBSET. A partial guard
 * reads as a complete one at the call site and crashes on the field it skipped,
 * which is worse than no guard at all because it looks like a control.
 */
export function isPayoutList(value: unknown): value is readonly PayoutListItem[] {
  if (!Array.isArray(value)) return false;
  return value.every((row) => {
    if (!isRecord(row)) return false;
    const status = row['status'];
    return (
      isString(row['payout_request_id']) &&
      isString(row['account_id']) &&
      isInteger(row['approved_cents']) &&
      isInteger(row['trader_cents']) &&
      isString(status) &&
      Object.prototype.hasOwnProperty.call(PAYOUT_STATUSES, status) &&
      isNullableString(row['approved_at']) &&
      isNullableString(row['settled_at']) &&
      isNullableString(row['failure_note']) &&
      isHold(row['hold']) &&
      isTimeline(row['timeline'])
    );
  });
}

// -----------------------------------------------------------------------------
// The seam
// -----------------------------------------------------------------------------

/**
 * The screen, from a client and whatever eligibility the caller could obtain.
 *
 * `eligibility` IS A PARAMETER RATHER THAN A SECOND FETCH, AND THE `null` IS A
 * MEASUREMENT RATHER THAN A PLACEHOLDER. `GET /accounts/:accountId/eligibility`
 * is not registered by `apps/api` on this tree, and this segment additionally
 * has no account to ask about: `GET /payouts` is account-less and nothing here
 * selects one. Whoever lands that endpoint writes its guard beside
 * `isPayoutList` above and passes its response here, and this function does not
 * change.
 *
 * IT IS EXPORTED SO THE READY BRANCH IS REACHED THROUGH THE REAL CLIENT.
 * `apps/portal/test/payouts-source.test.ts` calls it with a client built by
 * `createApiClient` over a stub transport, which is the whole seam -- URL
 * composition, cookie, `no-store`, status mapping, JSON, guard, view -- rather
 * than a mock of it.
 */
export async function loadFrom(input: {
  readonly client: ApiClient;
  readonly eligibility: EligibilityResponse | null;
}): Promise<PayoutCenterLoad> {
  const response = await input.client.get(PAYOUTS_PATH);
  const payouts = response.ok && isPayoutList(response.body) ? response.body : null;

  const missing: string[] = [];
  if (input.eligibility === null) missing.push(REQUIRED_ENDPOINTS[0]);
  if (payouts === null) missing.push(REQUIRED_ENDPOINTS[1]);

  if (input.eligibility !== null && payouts !== null)
    return readyFrom({ eligibility: input.eligibility, payouts });

  return { kind: 'unavailable', missing };
}

/**
 * What ./page.ts calls.
 *
 * IT IS ASYNC TODAY AND NOW IT AWAITS SOMETHING. The old body returned a
 * constant and this one performs `GET /api/v1/payouts` against the origin
 * `MERIT_API_ORIGIN` names, carrying the trader's `merit_session` cookie
 * forward from the inbound request. ./page.ts is unchanged and did not need to
 * be, which is what the old header meant by "the seam is one function".
 */
export async function load(): Promise<PayoutCenterLoad> {
  let client: ApiClient;
  try {
    client = await serverApiClient();
  } catch (error) {
    // ONLY `ApiConfigError`, AND THE NARROWNESS IS THE ARGUMENT. `MERIT_API_ORIGIN`
    // unset means this deployment has no API, so BOTH endpoints are unreachable,
    // which is what `unavailable` already says and is not a fault the trader
    // caused or can act on. Anything else -- a transport failure, a bug in a
    // path -- is NOT converted here and propagates, because converting it would
    // make every fault in this application look like a pending endpoint.
    if (!(error instanceof ApiConfigError)) throw error;
    return { kind: 'unavailable', missing: [...REQUIRED_ENDPOINTS] };
  }

  return loadFrom({ client, eligibility: null });
}
