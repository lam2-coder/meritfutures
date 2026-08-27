// =============================================================================
// apps/portal/src/app/calendar/load.ts
// =============================================================================
// THE SEGMENT'S READS. M04 section 1.1: `apps/portal` consumes `/api/v1` AND
// NOTHING ELSE.
//
// -----------------------------------------------------------------------------
// CONSUMING `/api/v1` IS THE WHOLE OF WHAT THIS FILE DOES, AND SERVING IT IS
// FORBIDDEN
// -----------------------------------------------------------------------------
// ADR-083 section 3 and ADR-095 ruling 3: no route handler and no server action
// in this application may serve `/api/v1` or any operator path. This module is
// the other side of that line and it is worth stating in the file rather than
// only in the ADR, because the two are one character apart in an App Router
// tree: a `route.ts` under `src/app/` SERVES a path, and a `fetch` in a module
// like this one CALLS one. Nothing here exports a request handler, and the
// segment holds no file with a `route` stem.
//
// ADR-095's own approval clause records that NOTHING in this repository refuses
// a violation today. That check is session 250's and this file does not claim
// it: what it does is keep this segment on the correct side of it.
//
// -----------------------------------------------------------------------------
// THE CALENDAR IS NOT COMPUTED HERE AND IT IS NOT COMPUTED IN A PAGE
// -----------------------------------------------------------------------------
// `GET /economic-calendar` is the source of the panel, including
// `release_trading_day` and the freshness fact, and it is being written
// concurrently by session 258. It is cited unlinked because it has not landed
// (CI-06a). There is no derivation of a trading day anywhere in this segment:
// see `trading-day.tsx` for why the type makes that impossible rather than
// merely discouraged.
//
// -----------------------------------------------------------------------------
// THE BASE URL IS AN ARGUMENT AND NOT AN IMPORT
// -----------------------------------------------------------------------------
// A module-level `process.env` read is a value fixed at import time, which is
// the shape that makes a suite either mutate the environment or run against
// whatever the developer's shell held. Each loader takes its origin, so the
// route file that lands with session 250's layout supplies it once and the
// suite supplies a stub, and neither reaches for a global.
//
// `fetch` IS AN ARGUMENT FOR THE SAME REASON, and it is typed as the narrow
// thing this module actually uses rather than as the platform's `fetch`. A
// loader that closed over the global could not be exercised without a network
// or a global mutation, and both are worse than one parameter.

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

/** The `/api/v1` reply this module needs, and no more of `Response` than that. */
export type ApiReply = {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
};

/** The one capability a loader takes. Narrower than the platform's `fetch` on purpose. */
export type ApiFetch = (url: string) => Promise<ApiReply>;

export type ApiOrigin = {
  /** The `/api/v1` origin, without a trailing slash. Supplied by the caller. */
  readonly base_url: string;
  readonly fetch: ApiFetch;
};

/**
 * A non-2xx from `/api/v1`, carried with its status so the caller can map it.
 *
 * IT CARRIES THE STATUS AND NEVER A SENTENCE. `shell/app-shell.ts`'s
 * `toPortalErrorKind` owns the mapping from a status to the portal's own
 * vocabulary, "so no component decides how to word a refusal", and a message
 * composed here would be a second one. INV-M4-07 is why that matters on this
 * surface specifically: a `404` is rendered as not found and never as forbidden.
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

async function read(origin: ApiOrigin, path: string): Promise<unknown> {
  const reply = await origin.fetch(`${origin.base_url}${path}`);
  if (!reply.ok) throw new ApiReadError(reply.status, path);
  return reply.json();
}

/**
 * Section 3.8's panel, for one viewer's timezone.
 *
 * THE TIMEZONE IS THE VIEWER'S AND IS NEVER SENT. It is a property of the
 * reader and not of the event (`view/economic-calendar.ts`, GS-285), so it goes
 * into the rendering and not into the query. A timezone in the request would be
 * the beginning of a per-timezone response, which is the second answer to "when
 * was the news" that FM-M7-08 guards.
 */
export async function loadEconomicCalendarPanel(
  origin: ApiOrigin,
  timezone: string,
): Promise<EconomicCalendarPanelView> {
  const body = (await read(origin, '/economic-calendar')) as EconomicCalendarPanelResponse;
  return toEconomicCalendarPanel(body, timezone);
}

/**
 * The account timeline.
 *
 * `as_of_trading_day` IS AN ARGUMENT BECAUSE THE TIMELINE ENDPOINT DOES NOT
 * CARRY ONE. `TimelineItem` has no as-of field and `toTimelineView` takes the
 * day as a parameter for the same reason: the day belongs to the account, is
 * read from the account endpoint, and INV-M4-02 requires it on the view model
 * regardless. Threading it rather than defaulting it is what keeps the required
 * prop required.
 */
export async function loadTimeline(
  origin: ApiOrigin,
  account_id: string,
  as_of_trading_day: string,
): Promise<TimelineView> {
  const body = (await read(origin, `/accounts/${account_id}/timeline`)) as readonly TimelineItem[];
  return toTimelineView(account_id, as_of_trading_day, body);
}

/**
 * The account's PINNED plan version, which is the only one this screen may read.
 *
 * THE VERSION IS AN ARGUMENT AND IS NOT DISCOVERED HERE. M04 section 4's
 * obligation against this endpoint is that "the rules page for an account reads
 * the PINNED version, not the current one", and a loader that fetched the plan
 * and took its latest version would satisfy the signature and break the
 * obligation. The caller has the account, the account has the pin, and this
 * function cannot reach a version the account did not name.
 */
export async function loadPinnedRules(
  origin: ApiOrigin,
  plan_id: string,
  version: number,
): Promise<RulesPageView> {
  const body = (await read(origin, `/plans/${plan_id}/versions/${version}`)) as PlanVersionResponse;
  return toRulesView(body);
}
