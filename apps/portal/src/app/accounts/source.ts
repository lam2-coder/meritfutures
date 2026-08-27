// =============================================================================
// apps/portal/src/app/accounts/source.ts
// =============================================================================
// WHERE THIS SEGMENT'S DATA COMES FROM, AND IT IS NOW A REAL REQUEST.
//
// ./ports.ts said "WHOEVER WIRES THE PORTAL OWNS REPLACING THIS FUNCTION AND
// NOTHING ELSE IN THIS SEGMENT", and ADR-162 is the client it was waiting for.
// This file is that replacement. It holds no transport of its own:
// ../../../http/client.ts is the one file in this application that calls
// `fetch(`, `apps/portal/test/surface.test.ts` asserts that per needle over
// every `.ts` under `src/`, and that test's own seeded-failure case names THIS
// PATH -- `app/accounts/source.ts` -- as the second-transport file it exists to
// catch. So the seam is `serverApiClient()` and nothing else.
//
// ./account-list.ts, ./account-detail.ts, ./elements.ts, ./equity-chart.ts and
// ./figures.ts are untouched by this session. What changed is where their input
// comes from and what the two `page.ts` files do when it does not arrive.
//
// -----------------------------------------------------------------------------
// FOUR ENDPOINTS, THREE OF THEM REGISTERED, AND THE COUNT WAS BUILT NOT GREPPED
// -----------------------------------------------------------------------------
// `discoverRouteModules()` then `buildServer({ surface: 'public', modules })`,
// reading `CompositionReport.registered` on this tree:
//
//   `GET /accounts`                          REGISTERED
//   `GET /accounts/:accountId`               REGISTERED
//   `GET /plans/:planId/versions/:version`   REGISTERED
//   `GET /accounts/:accountId/marks`         NOT REGISTERED. Nothing serves it
//
// THE DISPATCH FOR THIS SESSION NAMED TWO OF THOSE FOUR AND CALLED THE SEGMENT
// "all endpoints registered". It is not: the marks route is absent, which is
// why SC-M4-03's screen below cannot reach `ready` from a browser today, and
// `GET /accounts/:accountId` was registered and unnamed. A grep over route
// files has been wrong twice in this repository and a dispatch has now been
// wrong twice as well; the composition report is the only source either of
// them can be checked against.
//
// SO THE LIST SCREEN IS WIRED END TO END AND THE DETAIL SCREEN IS WIRED AS FAR
// AS IT GOES. `loadDetail` performs both reads that exist, because a refusal on
// either is a thing the trader should be told about (INV-M4-07's 404 is the
// case that matters), and reports the marks endpoint as the one it is waiting
// on. Whoever registers `GET /accounts/:accountId/marks` writes `isMarkList`
// beside the guards below and passes the response to `loadDetailFrom`, which
// does not change.
//
// -----------------------------------------------------------------------------
// THERE IS AN ERROR ARM, AND ADDING IT IS THIS SESSION'S ONE ARGUED DEPARTURE
// FROM THE WORKED EXAMPLE
// -----------------------------------------------------------------------------
// `PayoutCenterLoad` has two arms, `ready` and `unavailable`, so a 500 on
// `GET /payouts` renders exactly as a missing endpoint does. ADR-162 section 5
// item 1 reports that rather than repairing it, on the ground that session
// 273's fence held `source.ts` alone and the repair needs the segment's
// rendering files.
//
// THIS SEGMENT'S FENCE HOLDS THOSE FILES, AND THIS SEGMENT HAD NO LOAD TYPE AT
// ALL YET, so the two-arm union is not a thing being repaired here: it is a
// thing being declined at the moment of authorship. Writing `ready |
// unavailable` and reporting the hole would be reproducing a known defect on
// purpose in the one segment positioned to avoid it.
//
// THE THREE ARMS ARE THREE DIFFERENT FACTS AND THE SCREEN SAYS A DIFFERENT
// SENTENCE FOR EACH:
//
//   `ready`        the data arrived
//   `unavailable`  NOTHING FAILED. Either this deployment has no API at all
//                  (`ApiConfigError`), or the screen needs an endpoint nobody
//                  serves yet. `../../shell/app-shell.ts`'s `ContentState` has
//                  no member for this and that is deliberate: it is not
//                  `loading`, not `empty` and not `error`
//   `error`        A REGISTERED ENDPOINT REFUSED OR FAILED. It carries the
//                  `PortalErrorKind` ../../../http/client.ts already mapped and
//                  the status it was mapped from, and nothing here words it:
//                  INV-M4-07 makes the wording one place's job, and
//                  `toPortalErrorKind` is that place
//
// A 404 ON `GET /accounts/:accountId` REACHES THE `error` ARM AS `not_found`,
// which is INV-M4-07 working: "cross-trader resource access returns 404, and
// the portal renders it as 'not found', NOT 'forbidden'". Routing it to
// `unavailable` instead would have told a trader whose own account had gone
// missing that the portal was still being built.

import type { AccountDetail, AccountListItem, MarkListItem } from '../../api/types.ts';
import type { PinnedPlanCopy } from '../../copy/copy-block.ts';
import type { ApiClient, ApiResult } from '../../http/client.ts';
import { ApiConfigError, serverApiClient } from '../../http/client.ts';
import type { PortalErrorKind } from '../../shell/app-shell.ts';
import type { AccountDetailData, AccountListData } from './ports.ts';

// -----------------------------------------------------------------------------
// The paths, as API_CONTRACT spells them
// -----------------------------------------------------------------------------

/** `GET /accounts`. SC-M4-02's whole screen. */
export const ACCOUNTS_PATH = '/accounts';

/**
 * `GET /accounts/:accountId`, for one account id.
 *
 * THE ID IS RE-ENCODED AND THAT IS NOT DECORATION. It arrives as a decoded
 * route parameter, so a value carrying `/`, `?` or `#` would reshape the path
 * this composes and read an endpoint nobody asked for. `encodeURIComponent`
 * keeps a path segment a path segment; a server that does not recognise the
 * resulting id answers 404, which is the correct answer and is the one
 * INV-M4-07 already relies on.
 */
export function accountPath(accountId: string): string {
  return `${ACCOUNTS_PATH}/${encodeURIComponent(accountId)}`;
}

/**
 * `GET /plans/:planId/versions/:version`, THE ACCOUNT'S PINNED VERSION.
 *
 * `version` IS A NUMBER FROM A GUARDED RESPONSE rather than a string from a
 * URL, so it is stringified rather than encoded: `isAccountDetail` below
 * refuses a `plan.version` that is not an integer, so there is no separator
 * this template can be handed. The plan id is a server-issued string and is
 * encoded for `accountPath`'s reason exactly.
 */
export function planVersionPath(planId: string, version: number): string {
  return `/plans/${encodeURIComponent(planId)}/versions/${String(version)}`;
}

/** `GET /accounts`, and it is the only read SC-M4-02 needs. */
export const LIST_REQUIRED_ENDPOINTS = ['GET /accounts'] as const;

/**
 * SC-M4-03's three reads, in the order the screen forces them.
 *
 * ./ports.ts's header is where the second and third are argued and both are
 * consequences of the view models rather than of the screen: `toEquitySeries`
 * takes `as_of_trading_day` from the ACCOUNT response because the marks page is
 * cursor paginated, and `toAccountDetail` takes `PinnedPlanCopy` as a REQUIRED
 * argument on both branches. THE PLAN READ IS THE SECOND ROUND TRIP THAT FILE
 * SAID NO DOCUMENT MENTIONS, and it is sequential rather than parallel because
 * both of its path parameters live on the account response.
 */
export const DETAIL_REQUIRED_ENDPOINTS = [
  'GET /accounts/:accountId',
  'GET /plans/:planId/versions/:version',
  'GET /accounts/:accountId/marks',
] as const;

/** The one this segment needs and nothing serves. Measured, not assumed. */
export const MARKS_ENDPOINT = DETAIL_REQUIRED_ENDPOINTS[2];

// -----------------------------------------------------------------------------
// What a page got
// -----------------------------------------------------------------------------

/** The `error` arm's payload. `ApiFailure` without the discriminant. */
export type AccountsFailure = {
  readonly error: PortalErrorKind;
  readonly status: number | null;
};

export type AccountListLoad =
  | ({ readonly kind: 'ready' } & AccountListData)
  | { readonly kind: 'unavailable'; readonly missing: readonly string[] }
  | ({ readonly kind: 'error' } & AccountsFailure);

export type AccountDetailLoad =
  | ({ readonly kind: 'ready' } & AccountDetailData)
  | { readonly kind: 'unavailable'; readonly missing: readonly string[] }
  | ({ readonly kind: 'error' } & AccountsFailure);

// -----------------------------------------------------------------------------
// Narrowing, which is this segment's and not the transport's
// -----------------------------------------------------------------------------
// ../../../http/client.ts returns `unknown` and its section 5 argues why: a
// generic `get<T>` is a cast the compiler cannot check, and a transport that
// asserted wire shapes would have to know all of them. `unknown` cannot be read
// without a check, so the check is here, beside ../../api/types.ts, which is
// where this application already transcribed the shapes being checked for.
//
// EVERY FIELD ../../view/accounts.ts READS IS CHECKED AND NOT A SUBSET. ADR-162
// foreclosure 5: "a partial guard reads as a complete one at the call site and
// crashes on the field it skipped, which is worse than none because it looks
// like a control."

/**
 * Every member of `AccountListItem['phase']`, as a lookup the compiler keeps
 * complete.
 *
 * `Record<..., true>` IS THE MECHANISM, and it is ./../payouts/source.ts's for
 * `PayoutStatus`. A member added to ../../api/types.ts and not added here is
 * `error TS2741`, so this cannot drift from the union it guards the way a
 * hand-written array of strings would.
 */
const PHASES: Readonly<Record<AccountListItem['phase'], true>> = {
  eval: true,
  funded: true,
  closed: true,
  graduated: true,
};

const STATUSES: Readonly<Record<AccountListItem['status'], true>> = {
  provisioning_pending: true,
  active: true,
  breached: true,
  expired: true,
  closed_admin: true,
  closed_chargeback: true,
  graduated: true,
};

const PLATFORMS: Readonly<Record<AccountDetail['platform'], true>> = {
  rithmic: true,
  tradovate: true,
  cqg: true,
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

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

/**
 * An integer.
 *
 * INTEGER RATHER THAN NUMBER, AND ON THE MONEY FIELDS SPECIFICALLY. "Money is
 * integer cents. No floats anywhere, fixtures included." ../../format/money.ts
 * is the one permitted consumer of a `_cents` or `_bp` field and it refuses a
 * value that is not an exact integer, so a fractional balance would reach a
 * screen as a thrown `RangeError` rather than as a wrong figure. This refuses
 * it one layer earlier, where the answer is an honest error state rather than a
 * crash inside a component.
 *
 * IT IS ALSO THE CHECK ON THE COUNTS. `win_days.have`, `traded_days.need` and
 * the ladder ordinals are not money and a fractional one is still a server that
 * answered wrongly.
 */
function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isNullableInteger(value: unknown): value is number | null {
  return value === null || isInteger(value);
}

function has(record: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isMember(table: Readonly<Record<string, true>>, value: unknown): boolean {
  return isString(value) && has(table, value);
}

/** The plan stub carried on every account row. Four fields, all read. */
function isPlanStub(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value['plan_id']) &&
    isString(value['code']) &&
    isString(value['name']) &&
    isInteger(value['version'])
  );
}

/** `blocked`, whose three booleans become `AccountCardView.blocked`. */
function isBlocked(value: unknown): boolean {
  return (
    isRecord(value) &&
    isBoolean(value['payouts_frozen']) &&
    isBoolean(value['recon_blocked']) &&
    isBoolean(value['kyc_required'])
  );
}

/**
 * One `GET /accounts` row, which is also the base of the detail response.
 *
 * `AccountDetail = AccountListItem & {...}` in ../../api/types.ts, so the
 * detail guard below reuses this rather than restating twelve fields. A second
 * transcription of the card's fields is the thing that eventually disagrees
 * with the first.
 */
function hasAccountItemFields(record: Readonly<Record<string, unknown>>): boolean {
  return (
    isString(record['account_id']) &&
    isPlanStub(record['plan']) &&
    isMember(PHASES, record['phase']) &&
    isMember(STATUSES, record['status']) &&
    isInteger(record['size_cents']) &&
    isInteger(record['balance_cents']) &&
    isInteger(record['floor_cents']) &&
    isInteger(record['floor_distance_cents']) &&
    isInteger(record['withdrawable_cents']) &&
    isString(record['as_of_trading_day']) &&
    isBlocked(record['blocked'])
  );
}

function isAccountItem(value: unknown): value is AccountListItem {
  return isRecord(value) && hasAccountItemFields(value);
}

/** `GET /accounts`, narrowed to what ../../view/accounts.ts reads. */
export function isAccountList(value: unknown): value is readonly AccountListItem[] {
  return Array.isArray(value) && value.every(isAccountItem);
}

/**
 * `progress`, WHICH IS THE HALF A PARTIAL GUARD WOULD HAVE SKIPPED.
 *
 * Only the funded branch of `toProgress` reads `win_days`, `traded_days`,
 * `consistency`, `cadence` and `ladder`, and only the eval branch reads
 * `profit_target_cents` and `profit_cents`. A guard that checked the fields of
 * the phase in the response it happened to be handed would pass on an eval
 * account and crash on the next funded one, on the screen SC-M4-03 calls the
 * one somebody opens when something looks wrong. So all of it is checked, on
 * every phase, including the `closed` and `graduated` phases where
 * `toProgress` reads none of it.
 */
function isProgress(value: unknown): boolean {
  if (!isRecord(value)) return false;

  const winDays = value['win_days'];
  const tradedDays = value['traded_days'];
  const consistency = value['consistency'];
  const cadence = value['cadence'];
  const ladder = value['ladder'];

  return (
    isNullableInteger(value['profit_target_cents']) &&
    isNullableInteger(value['profit_cents']) &&
    isNullableInteger(value['buffer_cents']) &&
    isNullableInteger(value['buffer_progress_cents']) &&
    isRecord(winDays) &&
    isInteger(winDays['have']) &&
    isInteger(winDays['need']) &&
    isInteger(winDays['floor_cents']) &&
    isRecord(tradedDays) &&
    isInteger(tradedDays['have']) &&
    isInteger(tradedDays['need']) &&
    isRecord(consistency) &&
    isNullableInteger(consistency['best_day_share_bp']) &&
    isNullableInteger(consistency['max_bp']) &&
    isBoolean(consistency['skipped']) &&
    isRecord(cadence) &&
    isNullableInteger(cadence['days_since_last_payout']) &&
    isInteger(cadence['need']) &&
    isNullableString(cadence['next_eligible_trading_day']) &&
    isRecord(ladder) &&
    isInteger(ladder['payouts_settled']) &&
    isInteger(ladder['payouts_to_graduate'])
  );
}

/** `GET /accounts/:accountId`, narrowed to what SC-M4-03 renders. */
export function isAccountDetail(value: unknown): value is AccountDetail {
  if (!isRecord(value)) return false;
  const record = value;
  const permissions = record['front_end_permissions'];

  return (
    hasAccountItemFields(record) &&
    isMember(PLATFORMS, record['platform']) &&
    isNullableString(record['platform_account_ref']) &&
    Array.isArray(permissions) &&
    permissions.every(isString) &&
    isString(record['opened_on']) &&
    isNullableString(record['funded_on']) &&
    isNullableString(record['closed_on']) &&
    isNullableString(record['close_reason']) &&
    isString(record['rules_url']) &&
    isProgress(record['progress'])
  );
}

/**
 * The three fields of `GET /plans/:planId/versions/:version` this segment reads.
 *
 * IT IS DELIBERATELY NOT A GUARD FOR `PlanVersionResponse`. That type carries
 * `status`, `published_at`, `retired_at`, `rules` and `sizes`, and nothing in
 * this segment reads any of them: `toAccountDetail` takes a `PinnedPlanCopy`,
 * which is a plan id, a version and the copy blocks. A predicate that returned
 * `value is PlanVersionResponse` after checking three of eight fields would be
 * ADR-162 foreclosure 5's partial guard with the sign flipped: not a guard that
 * skipped a field the view reads, but one that CLAIMED five fields nobody
 * checked, and the next reader of that type would be entitled to `rules`.
 *
 * So the predicate names exactly what it verified, and ./ports.ts's
 * `PinnedPlanCopy` is built from it below.
 */
export type PinnedPlanSource = {
  readonly plan_id: string;
  readonly version: number;
  readonly copy_blocks: Readonly<Record<string, string>>;
};

export function isPinnedPlanSource(value: unknown): value is PinnedPlanSource {
  if (!isRecord(value)) return false;
  const blocks = value['copy_blocks'];

  return (
    isString(value['plan_id']) &&
    isInteger(value['version']) &&
    isRecord(blocks) &&
    Object.values(blocks).every(isString)
  );
}

/**
 * The plan version response as ../../copy/copy-block.ts wants it.
 *
 * ONE RENAME AND NOTHING ELSE. `copy_blocks` is the column's name and `blocks`
 * is the field's; `copyBlock()` reads the second and API_CONTRACT sends the
 * first, and this is the one place the two meet.
 */
export function toPinnedPlanCopy(source: PinnedPlanSource): PinnedPlanCopy {
  return { plan_id: source.plan_id, version: source.version, blocks: source.copy_blocks };
}

// -----------------------------------------------------------------------------
// The seam
// -----------------------------------------------------------------------------

/**
 * A read that returned, narrowed, or the failure to report.
 *
 * A `2xx` WHOSE BODY DOES NOT SATISFY THE GUARD IS `server_error`.
 * ../../../http/client.ts already answers exactly that for a `2xx` whose body
 * is not JSON, on the ground that a server which answered wrongly is not a
 * server that answered, and a body that parses and does not match the shape is
 * the same fact one layer up. It is NOT `unavailable`: the endpoint is
 * registered and it replied, so "waiting on an endpoint" would be false.
 *
 * ITS `status` IS `null` AND THAT IS A LIMIT RATHER THAN A CLAIM. `ApiSuccess`
 * is `{ ok: true, body: unknown }` and carries no status, so the response's own
 * number is not available at this layer and there is nothing here to report.
 * ADR-162 clause 3 reserves `null` for "a failure that had no response", and
 * this is a near neighbour of that rather than the same fact: what both mean at
 * the point of use is "this file observed no status", which is true. Inventing
 * `200` would be putting a number in the server's mouth to satisfy a field, and
 * widening `ApiSuccess` is a change to ADR-162's file, which this fence does
 * not hold. It is reported rather than reached for.
 */
function narrowed<T>(
  result: ApiResult,
  guard: (value: unknown) => value is T,
):
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: AccountsFailure } {
  if (!result.ok) return { ok: false, failure: { error: result.error, status: result.status } };
  if (guard(result.body)) return { ok: true, value: result.body };
  return { ok: false, failure: { error: 'server_error', status: null } };
}

/**
 * SC-M4-02, from a client.
 *
 * EXPORTED SEPARATELY FROM `load` SO THE READY BRANCH IS REACHED THROUGH THE
 * REAL CLIENT. `apps/portal/test/accounts-source.test.ts` calls it with a
 * client built by `createApiClient` over a stub transport, which exercises the
 * whole seam -- URL composition, the forwarded cookie, `no-store`, the status
 * mapping, the JSON read, this segment's guard -- rather than a mock of it.
 */
export async function loadListFrom(input: {
  readonly client: ApiClient;
}): Promise<AccountListLoad> {
  const read = narrowed(await input.client.get(ACCOUNTS_PATH), isAccountList);
  if (!read.ok) return { kind: 'error', ...read.failure };
  return { kind: 'ready', accounts: read.value };
}

/**
 * SC-M4-03, from a client and whatever marks the caller could obtain.
 *
 * `marks` IS A PARAMETER RATHER THAN A THIRD FETCH, AND THE `null` IS A
 * MEASUREMENT RATHER THAN A PLACEHOLDER. `GET /accounts/:accountId/marks` is
 * not registered by `apps/api` on this tree (see the header). ./../payouts/
 * source.ts took eligibility the same way for the same reason, and the shape is
 * what makes landing the endpoint a guard and a call rather than a rewrite.
 *
 * THE TWO READS THAT EXIST ARE PERFORMED ANYWAY AND THAT IS DELIBERATE. The
 * screen cannot reach `ready` without marks, so short-circuiting before the
 * requests would render the same words for less work. What it would cost is the
 * two things that make the difference between a screen and a placeholder: a
 * refusal on a registered endpoint would never be reported as a refusal
 * (INV-M4-07's 404 is the case that matters), and the wired path would first
 * run in production on the day the marks route lands, which is the worst
 * possible day to discover a misconfigured origin.
 */
export async function loadDetailFrom(input: {
  readonly client: ApiClient;
  readonly account: string;
  readonly marks: readonly MarkListItem[] | null;
}): Promise<AccountDetailLoad> {
  const detail = narrowed(await input.client.get(accountPath(input.account)), isAccountDetail);
  if (!detail.ok) return { kind: 'error', ...detail.failure };

  // SEQUENTIAL AND NOT PARALLEL, BECAUSE BOTH PATH PARAMETERS ARE ON THE FIRST
  // RESPONSE. ./ports.ts predicted this round trip and no document mentions it.
  const plan = narrowed(
    await input.client.get(planVersionPath(detail.value.plan.plan_id, detail.value.plan.version)),
    isPinnedPlanSource,
  );
  if (!plan.ok) return { kind: 'error', ...plan.failure };

  if (input.marks === null) return { kind: 'unavailable', missing: [MARKS_ENDPOINT] };

  return {
    kind: 'ready',
    detail: detail.value,
    pinned: toPinnedPlanCopy(plan.value),
    marks: input.marks,
  };
}

/**
 * THE ONE CONVERSION, AND ITS NARROWNESS IS THE ARGUMENT.
 *
 * `MERIT_API_ORIGIN` unset means this deployment has no API, so EVERY endpoint
 * this screen needs is unreachable, which is what `unavailable` says and is not
 * a fault the trader caused or can act on. ADR-162 foreclosure 6 rules exactly
 * this and rules the rest of it too: anything else -- a transport failure, a
 * bug in a path -- is NOT converted and PROPAGATES, because converting it would
 * make every fault in this application look like a pending endpoint.
 */
async function clientOrUnavailable(): Promise<
  { readonly ok: true; readonly client: ApiClient } | { readonly ok: false }
> {
  try {
    return { ok: true, client: await serverApiClient() };
  } catch (error) {
    if (!(error instanceof ApiConfigError)) throw error;
    return { ok: false };
  }
}

/** What ./page.ts calls. `GET /api/v1/accounts`, with the trader's cookie. */
export async function load(): Promise<AccountListLoad> {
  const resolved = await clientOrUnavailable();
  if (!resolved.ok) return { kind: 'unavailable', missing: [...LIST_REQUIRED_ENDPOINTS] };
  return loadListFrom({ client: resolved.client });
}

/** What `./[account]/page.ts` calls. */
export async function loadDetail(account: string): Promise<AccountDetailLoad> {
  const resolved = await clientOrUnavailable();
  if (!resolved.ok) return { kind: 'unavailable', missing: [...DETAIL_REQUIRED_ENDPOINTS] };
  return loadDetailFrom({ client: resolved.client, account, marks: null });
}
