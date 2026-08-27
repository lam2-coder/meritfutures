// =============================================================================
// apps/portal/src/app/calendar/load.ts
// =============================================================================
// THE SEGMENT'S REQUEST PLAN, AND THE REQUESTS ARE REAL NOW. M04 section 1.1:
// `apps/portal` consumes `/api/v1` AND NOTHING ELSE.
//
// -----------------------------------------------------------------------------
// THE TRANSPORT ARRIVED AND IT IS NOT IN THIS FILE
// -----------------------------------------------------------------------------
// This header used to say "there is no transport in this file and its absence is
// somebody else's control", and record that a first draft took an injected
// `fetch` capability, went red against `test/surface.test.ts`, and was taken
// back out: "amending that assertion is a decision for the session that lands
// the wiring, taken against its own test, and NARROWED rather than deleted."
//
// ADR-162 IS THAT DECISION AND IT WAS NARROWED. `fetch(` moved from no file to
// `src/http/client.ts`; `XMLHttpRequest`, `WebSocket` and `EventSource` still
// hold at zero files. This segment holds no `fetch(` and gains none: it calls
// `serverApiClient()` and nothing else, so the seam is one function and the
// assertion that catches a second transport still names this path.
//
// -----------------------------------------------------------------------------
// THE STATUS REFUSAL LEFT THIS FILE, WHICH IS THE ONE DELETION HERE
// -----------------------------------------------------------------------------
// `ApiReadError` and `assertOk` were this file's answer to "who refuses a
// non-2xx" while nothing in the application could make a request. ADR-162
// clause 3 answers it now, one layer down and once: a status maps through
// `toPortalErrorKind`, `../../../http/client.ts` "ADDS NO MEMBER TO THAT UNION",
// and a failure with no status line is `server_error` carrying `status: null`.
//
// KEEPING A SECOND ONE IS HOW A SECOND VOCABULARY GETS WRITTEN. The pair was
// never a control -- no test walked the tree for it, nothing failed if a caller
// skipped it -- so removing it removes a helper rather than an assertion, and
// the assertion that IS a control (`surface.test.ts`'s four needles) is
// untouched by this session in either direction.
//
// -----------------------------------------------------------------------------
// CONSUMING `/api/v1` IS PERMITTED AND SERVING IT IS FORBIDDEN
// -----------------------------------------------------------------------------
// ADR-083 section 3 and ADR-095 ruling 3: no route handler and no server action
// in this application may serve `/api/v1` or any operator path. The two are one
// character apart in an App Router tree, where a `route.ts` under `src/app/`
// SERVES a path and a module like this one only NAMES one. Nothing here exports
// a request handler and this segment holds no file with a `route` stem.
//
// -----------------------------------------------------------------------------
// FOUR ENDPOINTS AND NOT THREE, AND THE FOURTH IS THE SCREENS' DOING
// -----------------------------------------------------------------------------
// The three this file has always named are `GET /economic-calendar`,
// `GET /accounts/:accountId/timeline` and
// `GET /plans/:planId/versions/:version`. Wiring them turned up a fourth that no
// document lists for this segment and that both account screens force:
//
//   `TimelineScreen` takes a `TimelineView`, which extends `AccountState`, so
//   `as_of_trading_day` is REQUIRED (INV-M4-02) and `TimelineItem` carries no
//   such field. `readTimeline` below has taken the day as a parameter since the
//   day this file was written, for exactly that reason.
//
//   `RulesScreen` takes the account's PINNED plan id and version, and
//   `pinnedVersionPath` refuses to discover them (M04 section 4: "the rules page
//   for an account reads the PINNED version, not the current one"). The account
//   holds the pin.
//
// BOTH FACTS LIVE ON `GET /accounts/:accountId`, so both screens read it FIRST
// and the plan read is sequential rather than parallel because its two path
// parameters are on that first response. `app/accounts/source.ts` reached the
// same shape for the same reason one hour before this file did.
//
// -----------------------------------------------------------------------------
// THE COMPOSITION, BUILT RATHER THAN GREPPED, AND ALL FOUR ARE REGISTERED
// -----------------------------------------------------------------------------
// `discoverRouteModules()` then `buildServer({ surface: 'public', modules })`,
// reading `CompositionReport.registered` on this tree, matched exactly rather
// than by substring:
//
//   `GET /economic-calendar`                  REGISTERED
//   `GET /accounts/:accountId`                REGISTERED
//   `GET /accounts/:accountId/timeline`       REGISTERED (session 284)
//   `GET /plans/:planId/versions/:version`    REGISTERED
//
// AND REGISTERED IS NOT SERVED, WHICH IS THE MEASUREMENT THIS SEGMENT ADDS.
// Three of the four raise before they answer, in every deployment including one
// that has run `apps/api/src/start.ts`, and each refusal is a named blocker in
// the route module rather than an outage:
//
//   `/economic-calendar`         `start.ts` never calls
//                                `setEconomicCalendarSource`, so `source` is
//                                `null` and the handler throws
//                                `EconomicCalendarError`, which `server.ts`
//                                answers 500
//   `/accounts/:accountId`       reaches `readProgress`, which
//                                `databaseAccountsBackend` raises
//                                `AccountsBackendUnwired` from. 503
//   `/timeline`                  `databaseAccountReads.readTimeline` raises
//                                `AccountReadsBackendUnwired`: "`events` IS NOT
//                                A REGISTERED TABLE" in `packages/db/src/
//                                scope.ts`, so no scope class reaches it and
//                                there is no door to open. 503
//
// SO EVERY SCREEN IN THIS SEGMENT RENDERS ITS `error` ARM TODAY, and that is
// the arm working rather than the wiring failing. A 5xx from a registered
// endpoint is `server_error` through `toPortalErrorKind`, the trader is told
// Merit could not load it and that the failure is Merit's, and nothing on the
// screen claims the endpoint is still being built. THE ALTERNATIVE IS THE ONE
// THIS SEGMENT MUST NOT RENDER: `unavailable` would tell a trader the timeline
// is not written yet, on a deployment where it is registered, serving, and
// broken.
//
// -----------------------------------------------------------------------------
// THE CALENDAR IS NOT COMPUTED HERE AND IT IS NOT COMPUTED IN A PAGE
// -----------------------------------------------------------------------------
// `GET /economic-calendar` is the source of the panel, `release_trading_day`
// and the freshness fact included. It LANDED while this branch was open, as
// [`apps/api/src/routes/economic-calendar.ts`](../../../../../api/src/routes/economic-calendar.ts),
// so it is linked here rather than named: this comment read "cited unlinked
// because it has not landed" and that sentence stopped being true.
//
// THAT SESSION REACHED THE SAME FINDING FROM THE SERVER SIDE, which is worth
// recording because two sessions arriving at one rule independently is the
// strongest evidence the rule is real. `ADR-146` makes API_CONTRACT section 1's
// suffix rule a REFUSAL at the point of projection: `*_at` is a UTC instant and
// `*_day` is an exchange trading day, never a UTC date, and this response is the
// first in the corpus to carry both on one object. Its own clause is asserted on
// `2026-03-03T23:30:00Z`, UTC date `2026-03-03` and trading day `2026-03-04`.
// This segment asserts the same property one layer out, on
// `2026-03-12T22:30:00Z`, and `trading-day.tsx` is where the types make a
// derived day impossible rather than merely discouraged.
//
// So the two halves of "the trading day is not the calendar day" are now held at
// BOTH ends of the wire: the projection refuses to emit a derived day and the
// renderer has no input a derived one could come from.

import type {
  EconomicCalendarPanelResponse,
  PlanVersionResponse,
  TimelineItem,
} from '../../api/types.ts';
import { PAGE_LIMIT_MAX } from '../../api/types.ts';
import type { CursorPage } from '../../api/types.ts';
import type { ApiClient, ApiResult } from '../../http/client.ts';
import { ApiConfigError, serverApiClient } from '../../http/client.ts';
import type { PortalErrorKind } from '../../shell/app-shell.ts';
import { toEconomicCalendarPanel } from '../../view/economic-calendar.ts';
import type { EconomicCalendarPanelView } from '../../view/economic-calendar.ts';
import { toRulesView } from '../../view/rules.ts';
import type { RulesPageView } from '../../view/rules.ts';
import { toTimelineView } from '../../view/timeline.ts';
import type { TimelineView } from '../../view/timeline.ts';
import type { AsOfFreshness } from './as-of-stamp.tsx';
import type { TimelinePaging } from './timeline-screen.tsx';

// -----------------------------------------------------------------------------
// The paths, as API_CONTRACT spells them
// -----------------------------------------------------------------------------

/**
 * The paths, relative to the `/api/v1` origin the client holds.
 *
 * THE ORIGIN IS NOT IN THIS FILE. A module-level environment read is a value
 * fixed at import time, which is the shape that makes a suite either mutate the
 * environment or run against whatever the developer's shell held.
 * `serverApiClient()` resolves it per request and refuses rather than defaulting
 * (ADR-162 clause 1).
 */
export const ECONOMIC_CALENDAR_PATH = '/economic-calendar';

/**
 * `GET /accounts/:accountId`, the fourth endpoint. See the header.
 *
 * THE ID IS ENCODED AND THAT IS NOT DECORATION. It arrives as a decoded route
 * parameter, so a value carrying `/`, `?` or `#` would reshape the path this
 * composes and read an endpoint nobody asked for. A server that does not
 * recognise the resulting id answers 404, which is the correct answer and the
 * one INV-M4-07 relies on.
 */
export function accountPath(account_id: string): string {
  return `/accounts/${encodeURIComponent(account_id)}`;
}

/** `GET /accounts/:accountId/timeline`. */
export function timelinePath(account_id: string): string {
  return `/accounts/${encodeURIComponent(account_id)}/timeline`;
}

/**
 * The same path carrying section 1's `limit`, which is SENT RATHER THAN
 * INHERITED.
 *
 * `apps/api/src/routes/account-reads.ts` defaults an absent `limit` to 25 and
 * caps it at 100, both of them section 1's numbers. Relying on the default
 * would make how much of a trader's history this screen shows a property of a
 * constant in another deployable, changeable without a diff here, on a screen
 * that has to state what it read. So the number is in the request and the
 * statement is made against it.
 *
 * NO `cursor` IS EVER SENT. Section 1 calls the token `<opaque>`, which binds
 * the client: nothing in this application constructs one, and the one below is
 * read only as the boolean "is there more". See {@link TIMELINE_PAGE_LIMIT}.
 */
export function timelinePagePath(account_id: string, limit: number): string {
  return `${timelinePath(account_id)}?limit=${String(limit)}`;
}

/**
 * `GET /plans/:planId/versions/:version`, the account's PINNED version.
 *
 * THE VERSION IS A PARAMETER AND IS NOT DISCOVERED. M04 section 4's obligation
 * against this endpoint is that "the rules page for an account reads the PINNED
 * version, not the current one", and a helper that took only a plan id and
 * reached for its latest version would satisfy every signature in this file and
 * break that obligation. The account holds the pin and this function cannot
 * reach a version the account did not name.
 */
export function pinnedVersionPath(plan_id: string, version: number): string {
  return `/plans/${encodeURIComponent(plan_id)}/versions/${version}`;
}

/** `/calendar`. One read and it needs no account. */
export const CALENDAR_REQUIRED_ENDPOINTS = ['GET /economic-calendar'] as const;

/** `/calendar/:accountId/timeline`. The account read is the header's fourth endpoint. */
export const TIMELINE_REQUIRED_ENDPOINTS = [
  'GET /accounts/:accountId',
  'GET /accounts/:accountId/timeline',
] as const;

/** `/calendar/:accountId/rules`. The account carries the pin the plan read needs. */
export const RULES_REQUIRED_ENDPOINTS = [
  'GET /accounts/:accountId',
  'GET /plans/:planId/versions/:version',
] as const;

// -----------------------------------------------------------------------------
// TWO DECISIONS THIS SEGMENT TOOK RATHER THAN INHERITED
// -----------------------------------------------------------------------------

/**
 * THE PANEL IS RENDERED IN UTC, THE ZONE IS ECHOED ONTO THE SCREEN, AND THE
 * VIEWER'S OWN ZONE IS NOT REACHABLE FROM HERE.
 *
 * `toEconomicCalendarPanel` takes an IANA zone and `view/economic-calendar.ts`
 * refuses to default one: "a panel that fell back to UTC on a bad zone would
 * show a Tier-1 release at the wrong hour to a trader who had no way to know."
 * That refusal is about a zone the caller HAS and got wrong. This caller has
 * none, and the two candidates are not equally bad.
 *
 * THE DANGEROUS ONE IS THE SERVER'S OWN ZONE.
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` inside a server component
 * is the DEPLOYMENT's zone, and rendering it as the trader's is a claim about a
 * machine printed as a claim about a person. It also moves when the deployment
 * moves, with no diff anywhere.
 *
 * THE BROWSER'S ZONE IS NOT AVAILABLE AND THAT IS RULED RATHER THAN MISSED.
 * ADR-162 clause 2 makes every read a server render and foreclosure 3 forecloses
 * a browser-side client, so nothing in this application observes the browser at
 * all. A zone would have to arrive as a profile field on a response or as a
 * client boundary, and neither exists.
 *
 * SO UTC IS CHOSEN BECAUSE IT IS THE ONE ZONE THE RENDER CANNOT BE WRONG ABOUT.
 * `scheduled_release_at` is already a UTC instant, so the "local" clock is the
 * stored fact restated rather than a conversion nobody can check; `localise`
 * puts `timezone_label` on every row and `EconomicCalendarPanelView` echoes
 * `timezone` "so a mis-set zone is visible", so every time on the screen says
 * UTC beside itself and no trader reads it as their own clock. GS-285's
 * property -- one row, two dashboards, two timezones, both correct -- is not
 * satisfied by this and is not claimed to be; it is the open item this constant
 * exists to keep visible.
 */
export const PANEL_TIMEZONE = 'UTC';

/**
 * THE TIMELINE READS ONE PAGE, ASKS FOR SECTION 1'S MAXIMUM, AND THE SCREEN
 * STATES WHETHER IT READ ALL OF IT.
 *
 * `GET /accounts/:accountId/timeline` answers section 1's envelope --
 * `TimelinePage` in `apps/api/src/routes/account-reads.ts` is `{ data,
 * next_cursor }` -- and nothing in the corpus says what a screen does with the
 * cursor. `app/accounts/source.ts` refused to wire `/marks` an hour ago partly
 * on that: "a screen that read one page and stopped is a chart with a page's
 * worth of history on it and no statement anywhere about which page. A limit
 * and a follow-or-not are a decision, and inventing one inside a `load` is how
 * it gets made by nobody."
 *
 * THE DECISION IS TAKEN HERE BECAUSE THE SECOND SEGMENT WAITING IS WORSE THAN
 * THE FIRST ONE CHOOSING, and it is three parts:
 *
 * ONE. ONE PAGE, NOT ALL OF THEM. Following the cursor to exhaustion is
 * unbounded round trips inside one server render -- ADR-162 clause 4 makes
 * every one of them uncached -- and unbounded memory, on a list that grows for
 * the life of an account. There is no bound the corpus supplies and inventing
 * one would be this same decision taken again one loop in.
 *
 * TWO. THE `limit` IS SENT AND IT IS THE CONTRACT'S MAXIMUM. See
 * {@link timelinePagePath}. The maximum rather than the default because the
 * cost of a bigger page is one response and the cost of a smaller one is a
 * truncation statement on a screen that did not need one.
 *
 * THREE. THE SCREEN SAYS WHICH IT GOT, AND IT CANNOT COMPILE WITHOUT SAYING.
 * `TimelinePaging` is a REQUIRED prop of `TimelineScreen` with no default,
 * which is `AsOfFreshness`'s mechanism next door and is there for the same
 * reason: the caller that has read one page is the one that must not be able to
 * render it as the whole timeline. A `complete` timeline and a truncated one
 * render different sentences.
 *
 * WHAT IS NOT DECIDED HERE AND IS REPORTED. There is no way to reach the next
 * page from the screen. Paging controls need a navigation carrying a cursor,
 * which is a route shape, and this segment's URLs are already PROVISIONAL by
 * `[accountId]/timeline/page.tsx`'s own note. So the screen states the
 * truncation and offers no control, which is the honest half of the pair.
 *
 * AND THE ORDER IS UNDETERMINED, WHICH IS WHY NO ARM SAYS "THE MOST RECENT".
 * API_CONTRACT section 6 gives this endpoint the word "Chronological" and no
 * direction, unlike `/marks`, whose row states "`trading_day` descending". The
 * backend that would settle it by observation is unwired (see the header), so
 * the screen says a page was read and does not say from which end.
 */
export const TIMELINE_PAGE_LIMIT = PAGE_LIMIT_MAX;

// -----------------------------------------------------------------------------
// What a page got
// -----------------------------------------------------------------------------

/**
 * The `error` arm's payload. `ApiFailure` without the discriminant.
 *
 * NOTHING HERE WORDS IT. INV-M4-07 makes the wording one place's job and
 * `toPortalErrorKind` is that place; this carries the kind it already produced
 * and the status it was produced from.
 */
export type CalendarFailure = {
  readonly error: PortalErrorKind;
  readonly status: number | null;
};

/**
 * The three arms, and they are three different facts.
 *
 * `ready`        the data arrived
 * `unavailable`  NOTHING FAILED. This deployment has not been told where its
 *                API is (`ApiConfigError`). `shell/app-shell.ts`'s
 *                `ContentState` has no member for this and that is deliberate:
 *                it is not `loading`, not `empty` and not `error`
 * `error`        A REGISTERED ENDPOINT REFUSED OR FAILED, which on this tree is
 *                what all four of them do (see the header)
 *
 * `unavailable` MEANS EXACTLY ONE THING IN THIS SEGMENT, WHICH IS NARROWER THAN
 * NEXT DOOR. `app/accounts/source.ts` also reaches it for an endpoint nothing
 * registers; every endpoint this segment reads IS registered, so the only route
 * to this arm is an unconfigured deployment.
 */
export type EconomicCalendarLoad =
  | { readonly kind: 'ready'; readonly panel: EconomicCalendarPanelView }
  | { readonly kind: 'unavailable'; readonly missing: readonly string[] }
  | ({ readonly kind: 'error' } & CalendarFailure);

export type TimelineLoad =
  | {
      readonly kind: 'ready';
      readonly timeline: TimelineView;
      readonly freshness: AsOfFreshness;
      readonly paging: TimelinePaging;
    }
  | { readonly kind: 'unavailable'; readonly missing: readonly string[] }
  | ({ readonly kind: 'error' } & CalendarFailure);

export type RulesLoad =
  | {
      readonly kind: 'ready';
      readonly rules: RulesPageView;
      readonly as_of_trading_day: string;
      readonly freshness: AsOfFreshness;
    }
  | { readonly kind: 'unavailable'; readonly missing: readonly string[] }
  | ({ readonly kind: 'error' } & CalendarFailure);

/**
 * THE FRESHNESS FACT IS `unstated` ON BOTH ACCOUNT SCREENS, AND IT IS A
 * MEASUREMENT RATHER THAN A DEFAULT.
 *
 * `as-of-stamp.tsx`: "`api/types.ts` publishes no field carrying the firm's
 * last closed trading day: `AccountDetail` and the timeline carry the day a
 * figure speaks FOR and nothing carries the day the firm has closed THROUGH, so
 * no caller outside the economic-calendar panel can construct anything but
 * `unstated`." `freshnessAgainst` is the only permitted producer of the other
 * two arms and it takes a `closed_through_day` this segment cannot obtain.
 *
 * IT IS PRODUCED BY THE LOAD RATHER THAN BY THE PAGE BECAUSE THE LOAD IS WHAT
 * HOLDS THE RESPONSES. A page that minted `{ kind: 'unstated' }` beside a
 * response it never read would be answering the question by not asking it; here
 * the answer sits next to the two bodies that would have carried the fact.
 * ADR-152 is the gap ruled, and this constant is what keeps it visible.
 */
const NO_FRESHNESS_FACT: AsOfFreshness = { kind: 'unstated' };

// -----------------------------------------------------------------------------
// Narrowing, which is this segment's and not the transport's
// -----------------------------------------------------------------------------
// ../../../http/client.ts returns `unknown` and its section 5 argues why: a
// generic `get<T>` is a cast the compiler cannot check, and a transport that
// asserted wire shapes would have to know all of them. `unknown` cannot be read
// without a check, so the check is here, beside ../../api/types.ts, which is
// where this application already transcribed the shapes being checked for.
//
// EVERY FIELD THE VIEW BUILDERS READ IS CHECKED AND NOT A SUBSET. ADR-162
// foreclosure 5: "a partial guard reads as a complete one at the call site and
// crashes on the field it skipped, which is worse than none because it looks
// like a control."

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
 * INTEGER RATHER THAN NUMBER. "Money is integer cents. No floats anywhere,
 * fixtures included." ../../format/money.ts is the one permitted consumer of a
 * `_cents` or `_bp` field and it THROWS on a value that is not an exact
 * integer, so a fractional figure would reach a screen as a `RangeError` inside
 * a component. This refuses it one layer earlier, where the answer is an honest
 * error state. It is also the check on `tier`, `revision` and `version`, none
 * of which is money and each of which is still a server answering wrongly when
 * it is fractional.
 */
function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isNullableInteger(value: unknown): value is number | null {
  return value === null || isInteger(value);
}

/**
 * Section 1's envelope, checked once for every list this segment reads.
 *
 * IT CHECKS `next_cursor` AND NOT ONLY `data`. A response that carried rows and
 * no cursor member would pass an item-only guard and then be reported to the
 * screen as a COMPLETE timeline, because `undefined !== null` is the only thing
 * separating "there is no more" from "the field was not sent". That is the
 * truncation failure arriving through the guard rather than through the load.
 */
function isCursorPage<T>(
  value: unknown,
  item: (entry: unknown) => entry is T,
): value is CursorPage<T> {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value['data']) &&
    value['data'].every(item) &&
    isNullableString(value['next_cursor'])
  );
}

// -- `GET /economic-calendar` --------------------------------------------------

function isOccurrence(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value['event_key']) &&
    isString(value['occurrence_key']) &&
    isInteger(value['tier']) &&
    isString(value['scheduled_release_at']) &&
    isString(value['release_trading_day']) &&
    isInteger(value['revision']) &&
    isNullableString(value['revision_reason'])
  );
}

/**
 * `GET /economic-calendar`, narrowed to what the panel reads.
 *
 * ALL SEVEN OCCURRENCE FIELDS AND BOTH FRESHNESS FIELDS. `toEconomicCalendarPanel`
 * reads `tier` to filter and `toRelease` reads the other six, so there is no
 * field here the screen does not depend on. `covered_through_day` is nullable
 * because "nothing has ever been loaded" is a real state the panel renders.
 */
export function isEconomicCalendarPanelResponse(
  value: unknown,
): value is EconomicCalendarPanelResponse {
  if (!isRecord(value)) return false;
  const freshness = value['freshness'];
  const occurrences = value['occurrences'];

  return (
    isRecord(freshness) &&
    isBoolean(freshness['stale']) &&
    isNullableString(freshness['covered_through_day']) &&
    Array.isArray(occurrences) &&
    occurrences.every(isOccurrence)
  );
}

// -- `GET /accounts/:accountId/timeline` ---------------------------------------

const CENTS = '_cents';
const BASIS_POINTS = '_bp';

/**
 * One `detail` value, which is where a fractional cent would get in.
 *
 * `view/timeline.ts` routes a NUMBER under a `_cents` or `_bp` key through
 * ../../format/money.ts, which throws on a non-integer. The keys are the
 * server's and are not a closed set, so the check is on the SUFFIX rather than
 * on a list: a number under a money-suffixed key must be an integer, and every
 * other admitted value passes as it arrives.
 *
 * A MONEY-SUFFIXED KEY CARRYING A STRING IS NOT REFUSED, because that file
 * already rules it: "a money-suffixed key carrying a non-number is left exactly
 * as it arrived ... a timeline that refuses to render because one detail was a
 * string is a screen that goes blank at the moment something unusual happened."
 */
function isDetailValue(key: string, value: unknown): boolean {
  if (value === null || isString(value) || isBoolean(value)) return true;
  if (typeof value !== 'number') return false;
  return key.endsWith(CENTS) || key.endsWith(BASIS_POINTS) ? Number.isInteger(value) : true;
}

function isTimelineItem(value: unknown): value is TimelineItem {
  if (!isRecord(value)) return false;
  const detail = value['detail'];

  return (
    isString(value['occurred_at']) &&
    isNullableString(value['trading_day']) &&
    isString(value['kind']) &&
    isString(value['summary']) &&
    isRecord(detail) &&
    Object.entries(detail).every(([key, entry]) => isDetailValue(key, entry))
  );
}

/** `GET /accounts/:accountId/timeline`, envelope and items. */
export function isTimelinePage(value: unknown): value is CursorPage<TimelineItem> {
  return isCursorPage(value, isTimelineItem);
}

// -- `GET /accounts/:accountId` ------------------------------------------------

/**
 * The three fields of `GET /accounts/:accountId` this segment reads.
 *
 * IT IS DELIBERATELY NOT A GUARD FOR `AccountDetail`. That type carries
 * twenty-odd fields, `progress` among them, and nothing in this segment reads
 * any of them: the timeline needs `as_of_trading_day` and the rules page needs
 * the pin. A predicate returning `value is AccountDetail` after checking three
 * of them would be ADR-162 foreclosure 5's partial guard with the sign flipped
 * -- not one that skipped a field the view reads, but one that CLAIMED twenty
 * nobody checked -- and `app/accounts/source.ts` refused the same move on
 * `PlanVersionResponse` for the same reason one hour earlier.
 *
 * IT IS ALSO NOT IMPORTED FROM THAT SEGMENT. `isAccountDetail` is exported next
 * door and checks a superset, and reaching for it would couple this screen's
 * boundary to another segment's view requirements: the day that view stops
 * reading `progress`, this guard silently stops checking it too. ADR-162 clause
 * 5 puts the check beside the transcription of what THIS segment reads.
 */
export type CalendarAccountSource = {
  readonly account_id: string;
  readonly as_of_trading_day: string;
  readonly plan: { readonly plan_id: string; readonly version: number };
};

export function isCalendarAccountSource(value: unknown): value is CalendarAccountSource {
  if (!isRecord(value)) return false;
  const plan = value['plan'];

  return (
    isString(value['account_id']) &&
    isString(value['as_of_trading_day']) &&
    isRecord(plan) &&
    isString(plan['plan_id']) &&
    isInteger(plan['version'])
  );
}

// -- `GET /plans/:planId/versions/:version` ------------------------------------

/**
 * `plan_versions.rules`, checked as the JSON it is declared to be.
 *
 * `PlanRules` is `Readonly<Record<string, JsonValue>>` and ../../api/types.ts
 * spends a paragraph on why it is opaque: "a portal type enumerating its keys
 * would be a SECOND COPY OF THE RULE SCHEMA". So the check is that the value IS
 * JSON, recursively, and never what is in it. `toRulesView` reads none of it,
 * and the field is checked anyway because the guard's return type claims it and
 * SC-M4-06's rule diff walks it.
 */
function isJsonValue(value: unknown): boolean {
  if (value === null || isString(value) || isBoolean(value)) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isPlanSize(value: unknown): boolean {
  return (
    isRecord(value) &&
    isInteger(value['size_cents']) &&
    isInteger(value['price_cents']) &&
    isInteger(value['reset_price_cents']) &&
    isInteger(value['drawdown_cents']) &&
    isNullableInteger(value['profit_target_cents']) &&
    isInteger(value['buffer_cents']) &&
    isInteger(value['win_day_floor_cents']) &&
    isInteger(value['payout_cap_cents']) &&
    isInteger(value['min_payout_cents'])
  );
}

/**
 * `GET /plans/:planId/versions/:version`, narrowed whole.
 *
 * `status` IS CHECKED AGAINST THE CONTRACT'S TWO MEMBERS AND NOT AS A STRING.
 * `toRulesView` derives `superseded` from `status === 'retired'`, so a third
 * value would render a superseded contract as the current one, which is
 * INV-M4-08's failure produced by a widened union. The lookup is
 * `Record<PlanVersionResponse['status'], true>`, so a member added to
 * ../../api/types.ts and not added here is `error TS2741`.
 */
const PLAN_VERSION_STATUSES: Readonly<Record<PlanVersionResponse['status'], true>> = {
  published: true,
  retired: true,
};

export function isPlanVersionResponse(value: unknown): value is PlanVersionResponse {
  if (!isRecord(value)) return false;
  const status = value['status'];
  const copy = value['copy_blocks'];
  const sizes = value['sizes'];

  return (
    isString(value['plan_version_id']) &&
    isString(value['plan_id']) &&
    isInteger(value['version']) &&
    isString(status) &&
    Object.prototype.hasOwnProperty.call(PLAN_VERSION_STATUSES, status) &&
    isString(value['published_at']) &&
    isNullableString(value['retired_at']) &&
    isRecord(value['rules']) &&
    Object.values(value['rules']).every(isJsonValue) &&
    isRecord(copy) &&
    Object.values(copy).every(isString) &&
    Array.isArray(sizes) &&
    sizes.every(isPlanSize)
  );
}

// -----------------------------------------------------------------------------
// The readers. Each body into the view model its screen takes
// -----------------------------------------------------------------------------

/**
 * Section 3.8's panel, for one viewer's timezone.
 *
 * THE TIMEZONE IS THE VIEWER'S AND IS NEVER SENT. It is a property of the
 * reader and not of the event (`view/economic-calendar.ts`, GS-285), so it goes
 * into the rendering and not into the query. A timezone in the request would be
 * the first step toward a per-timezone response, which is the second answer to
 * "when was the news" that FM-M7-08 guards. What this deployment can actually
 * supply is {@link PANEL_TIMEZONE}.
 */
export function readEconomicCalendarPanel(
  body: EconomicCalendarPanelResponse,
  timezone: string,
): EconomicCalendarPanelView {
  return toEconomicCalendarPanel(body, timezone);
}

/**
 * The account timeline.
 *
 * `as_of_trading_day` IS A PARAMETER BECAUSE THE TIMELINE ENDPOINT CARRIES NO
 * SUCH FIELD. `TimelineItem` has none and `toTimelineView` takes the day for the
 * same reason: it belongs to the account, it is read from the account endpoint,
 * and INV-M4-02 requires it on the view model regardless. Threading it rather
 * than defaulting it is what keeps a required prop required, and it is why this
 * segment reads four endpoints and not three.
 */
export function readTimeline(
  body: readonly TimelineItem[],
  account_id: string,
  as_of_trading_day: string,
): TimelineView {
  return toTimelineView(account_id, as_of_trading_day, body);
}

/** The account's pinned plan version. See {@link pinnedVersionPath}. */
export function readPinnedRules(body: PlanVersionResponse): RulesPageView {
  return toRulesView(body);
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
 * Widening `ApiSuccess` is a change to ADR-162's file, which this fence does not
 * hold; `app/accounts/source.ts` reported the same limit an hour ago and it is
 * still open.
 */
function narrowed<T>(
  result: ApiResult,
  guard: (value: unknown) => value is T,
):
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: CalendarFailure } {
  if (!result.ok) return { ok: false, failure: { error: result.error, status: result.status } };
  if (guard(result.body)) return { ok: true, value: result.body };
  return { ok: false, failure: { error: 'server_error', status: null } };
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

/**
 * `/calendar`, from a client.
 *
 * EXPORTED SEPARATELY FROM {@link loadEconomicCalendar} SO THE READY BRANCH IS
 * REACHED THROUGH THE REAL CLIENT. `apps/portal/test/calendar-segment.test.ts`
 * calls it with a client built by `createApiClient` over a stub transport, which
 * exercises the whole seam -- URL composition, the forwarded cookie,
 * `no-store`, the status mapping, the JSON read, this segment's guard -- rather
 * than a mock of it.
 */
export async function loadEconomicCalendarFrom(input: {
  readonly client: ApiClient;
  readonly timezone: string;
}): Promise<EconomicCalendarLoad> {
  const read = narrowed(
    await input.client.get(ECONOMIC_CALENDAR_PATH),
    isEconomicCalendarPanelResponse,
  );
  if (!read.ok) return { kind: 'error', ...read.failure };
  return { kind: 'ready', panel: readEconomicCalendarPanel(read.value, input.timezone) };
}

/**
 * `/calendar/:accountId/timeline`, from a client.
 *
 * THE ACCOUNT READ IS FIRST AND IS NOT AN OPTIMISATION. `as_of_trading_day` is
 * required on the view model (INV-M4-02) and lives only on that response, so a
 * timeline fetched without it has nothing to be stamped with. A 404 on the
 * account reaches the `error` arm as `not_found`, which is INV-M4-07 working:
 * "cross-trader resource access returns 404, and the portal renders it as 'not
 * found', NOT 'forbidden'."
 *
 * THE PAGING ANSWER IS COMPUTED FROM `next_cursor` AND FROM NOTHING ELSE. Not
 * from the row count against the limit: a page that happens to be exactly full
 * with nothing after it is `complete`, and inferring truncation from the count
 * would report a whole timeline as partial forever.
 */
export async function loadTimelineFrom(input: {
  readonly client: ApiClient;
  readonly account: string;
}): Promise<TimelineLoad> {
  const account = narrowed(
    await input.client.get(accountPath(input.account)),
    isCalendarAccountSource,
  );
  if (!account.ok) return { kind: 'error', ...account.failure };

  const page = narrowed(
    await input.client.get(timelinePagePath(input.account, TIMELINE_PAGE_LIMIT)),
    isTimelinePage,
  );
  if (!page.ok) return { kind: 'error', ...page.failure };

  return {
    kind: 'ready',
    timeline: readTimeline(
      page.value.data,
      account.value.account_id,
      account.value.as_of_trading_day,
    ),
    freshness: NO_FRESHNESS_FACT,
    paging: page.value.next_cursor === null ? { kind: 'complete' } : { kind: 'partial' },
  };
}

/**
 * `/calendar/:accountId/rules`, from a client.
 *
 * SEQUENTIAL AND NOT PARALLEL, BECAUSE BOTH PATH PARAMETERS ARE ON THE FIRST
 * RESPONSE. The account carries the pin and `pinnedVersionPath` cannot reach a
 * version the account did not name, which is M04 section 4's obligation held by
 * a signature rather than by a comment.
 */
export async function loadRulesFrom(input: {
  readonly client: ApiClient;
  readonly account: string;
}): Promise<RulesLoad> {
  const account = narrowed(
    await input.client.get(accountPath(input.account)),
    isCalendarAccountSource,
  );
  if (!account.ok) return { kind: 'error', ...account.failure };

  const pinned = narrowed(
    await input.client.get(
      pinnedVersionPath(account.value.plan.plan_id, account.value.plan.version),
    ),
    isPlanVersionResponse,
  );
  if (!pinned.ok) return { kind: 'error', ...pinned.failure };

  return {
    kind: 'ready',
    rules: readPinnedRules(pinned.value),
    as_of_trading_day: account.value.as_of_trading_day,
    freshness: NO_FRESHNESS_FACT,
  };
}

/** What `./page.tsx` calls. */
export async function loadEconomicCalendar(): Promise<EconomicCalendarLoad> {
  const resolved = await clientOrUnavailable();
  if (!resolved.ok) return { kind: 'unavailable', missing: [...CALENDAR_REQUIRED_ENDPOINTS] };
  return loadEconomicCalendarFrom({ client: resolved.client, timezone: PANEL_TIMEZONE });
}

/** What `./[accountId]/timeline/page.tsx` calls. */
export async function loadTimeline(account: string): Promise<TimelineLoad> {
  const resolved = await clientOrUnavailable();
  if (!resolved.ok) return { kind: 'unavailable', missing: [...TIMELINE_REQUIRED_ENDPOINTS] };
  return loadTimelineFrom({ client: resolved.client, account });
}

/** What `./[accountId]/rules/page.tsx` calls. */
export async function loadRules(account: string): Promise<RulesLoad> {
  const resolved = await clientOrUnavailable();
  if (!resolved.ok) return { kind: 'unavailable', missing: [...RULES_REQUIRED_ENDPOINTS] };
  return loadRulesFrom({ client: resolved.client, account });
}
