// =============================================================================
// apps/portal/src/app/calendar/load.ts
// =============================================================================
// THE SEGMENT'S REQUEST PLAN: which `/api/v1` paths these screens read, and what
// is done with each answer. M04 section 1.1: `apps/portal` consumes `/api/v1`
// AND NOTHING ELSE.
//
// -----------------------------------------------------------------------------
// THERE IS NO TRANSPORT IN THIS FILE AND ITS ABSENCE IS SOMEBODY ELSE'S CONTROL
// -----------------------------------------------------------------------------
// `test/surface.test.ts` asserts that no source file in this application
// performs a network call, and states what the assertion is for: "the fetch
// layer arrives WITH THE FRAMEWORK. Asserting it now means the first `fetch`
// written here is A DECISION SOMEBODY MAKES ON PURPOSE rather than one that
// appears in a diff."
//
// THIS SESSION WROTE ONE AND TOOK IT BACK OUT, WHICH IS THE GATE WORKING. A
// first draft of this file took an injected `fetch` capability, the suite went
// red naming this path, and the finding was correct on its own terms: the
// framework's entry points are session 250's file set (`next.config`, the root
// layout, the route files) and the transport belongs with them. Amending that
// assertion is a decision for the session that lands the wiring, taken against
// its own test, and NARROWED rather than deleted when it is: the same file
// records what a bad amendment looks like, "a session that deletes an entry
// instead of narrowing it has removed the control while appearing to satisfy
// it."
//
// So what is here is everything about a read except the reading. A route file
// with a transport calls the path builder, checks the status, and hands the
// body to the matching reader.
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
// ADR-095's own approval clause records that nothing in this repository refuses
// a violation today. That check is session 250's and this file does not claim
// it; what it does is keep this segment on the correct side of it.
//
// -----------------------------------------------------------------------------
// THE CALENDAR IS NOT COMPUTED HERE AND IT IS NOT COMPUTED IN A PAGE
// -----------------------------------------------------------------------------
// `GET /economic-calendar` is the source of the panel, `release_trading_day`
// and the freshness fact included, and it is being written concurrently by
// session 258. It is cited unlinked because it has not landed (CI-06a). No
// trading day is derived anywhere in this segment: see `trading-day.tsx` for
// why the types make that impossible rather than merely discouraged.

import type {
  EconomicCalendarPanelResponse,
  PlanVersionResponse,
  TimelineItem,
} from '../../api/types.ts';
import { toEconomicCalendarPanel } from '../../view/economic-calendar.ts';
import type { EconomicCalendarPanelView } from '../../view/economic-calendar.ts';
import { toRulesView } from '../../view/rules.ts';
import type { RulesPageView } from '../../view/rules.ts';
import { toTimelineView } from '../../view/timeline.ts';
import type { TimelineView } from '../../view/timeline.ts';

/**
 * The three paths, relative to the `/api/v1` origin the caller holds.
 *
 * THE ORIGIN IS NOT IN THIS FILE. A module-level environment read is a value
 * fixed at import time, which is the shape that makes a suite either mutate the
 * environment or run against whatever the developer's shell held. The route
 * file supplies it once.
 */
export const ECONOMIC_CALENDAR_PATH = '/economic-calendar';

/** `GET /accounts/:accountId/timeline`. */
export function timelinePath(account_id: string): string {
  return `/accounts/${encodeURIComponent(account_id)}/timeline`;
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

/**
 * A non-2xx from `/api/v1`, carried with its status and never with a sentence.
 *
 * `shell/app-shell.ts`'s `toPortalErrorKind` owns the mapping from a status to
 * the portal's own vocabulary, "so no component decides how to word a refusal",
 * and a message composed here would be a second one. INV-M4-07 is why it
 * matters on this surface: a `404` is rendered as not found and never as
 * forbidden, and the vocabulary has no member for the second.
 */
export class ApiReadError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`GET ${path} answered ${status}`);
    this.name = 'ApiReadError';
  }
}

/** Refuse a non-2xx before a body is read. Called by whoever holds the transport. */
export function assertOk(status: number, path: string): void {
  if (status < 200 || status > 299) throw new ApiReadError(status, path);
}

/**
 * Section 3.8's panel, for one viewer's timezone.
 *
 * THE TIMEZONE IS THE VIEWER'S AND IS NEVER SENT. It is a property of the
 * reader and not of the event (`view/economic-calendar.ts`, GS-285), so it goes
 * into the rendering and not into the query. A timezone in the request would be
 * the first step toward a per-timezone response, which is the second answer to
 * "when was the news" that FM-M7-08 guards.
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
 * than defaulting it is what keeps a required prop required.
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
