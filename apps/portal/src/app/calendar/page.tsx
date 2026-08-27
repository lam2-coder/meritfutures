// =============================================================================
// apps/portal/src/app/calendar/page.tsx
// =============================================================================
// `/calendar`, M04 section 3.8's panel as a route, AND IT PERFORMS A REAL READ.
//
// -----------------------------------------------------------------------------
// THIS FILE USED TO RENDER AN HONEST 401 AND THE HONEST STATE HAS MOVED
// -----------------------------------------------------------------------------
// It said: "`EconomicCalendarScreen` takes a built `EconomicCalendarPanelView`
// and this page cannot build one, because there is nothing to build it FROM ...
// SO THE PAGE DOES NOT INVENT A RELEASE. A calendar screen rendered from a
// fixture would put a Tier-1 release time on a trader's screen that Merit never
// transcribed, on the one panel whose entire argument is that its source is
// `economic_calendar` and no other origin (INV-M4-16)."
//
// That refusal is intact and it is no longer this file's to make. ./load.ts
// performs `GET /api/v1/economic-calendar` through ADR-162's client, carrying
// the trader's `merit_session` cookie forward from the inbound request, and
// only the `ready` arm reaches the screen. The panel still renders nothing this
// deployment did not receive; what changed is that it can now receive it.
//
// THE OLD FILE PREDICTED "WHAT LANDS WITH THE TRANSPORT IS THREE LINES" AND
// UNDERSTATED IT BY ONE ARM. Three states, not one: the endpoint is registered,
// so a refusal from it is a refusal rather than an absence, and ./states.tsx
// says a different sentence for each.
//
// -----------------------------------------------------------------------------
// THE ROUTE IS DYNAMIC NOW AND THAT IS A CORRECTNESS CHOICE
// -----------------------------------------------------------------------------
// This route built as STATIC before this session, which was correct for a page
// that rendered a constant and is not correct for one that reads the API with a
// session cookie. ADR-162 clause 4 makes every read `no-store` because "a cache
// is a key and a value, and the key here would have to include the session
// cookie or it serves one trader's payouts to another"; a statically rendered
// authenticated screen is that same failure arriving through a build step.
// `force-dynamic` says so in the framework's own vocabulary rather than leaving
// it to whichever default the pinned version happens to ship.
//
// NOT A ROUTE HANDLER AND NOT A SERVER ACTION. ADR-083 ruling 1 and ADR-095
// ruling 3: `/calendar` is a SCREEN, and the data comes from the API over the
// network like any other client's.

import { EconomicCalendarScreen } from './economic-calendar-screen.tsx';
import { loadEconomicCalendar } from './load.ts';
import { CalendarError, CalendarUnavailable } from './states.tsx';
import { SIMULATED_ENVIRONMENT_DISCLOSURE } from './disclosure.ts';
import { toShellView } from '../../shell/app-shell.ts';

/** Never prerendered, never cached. See the header. */
export const dynamic = 'force-dynamic';

/** The heading every arm of this screen carries. One string, one screen. */
const TITLE = 'Economic calendar';

export default async function EconomicCalendarPage() {
  const loaded = await loadEconomicCalendar();

  if (loaded.kind === 'unavailable')
    return <CalendarUnavailable title={TITLE} missing={loaded.missing} />;

  if (loaded.kind === 'error') return <CalendarError title={TITLE} error={loaded.error} />;

  return (
    <EconomicCalendarScreen
      shell={toShellView({
        impersonation: null,

        // The layout renders the disclosure and owns INV-M4-09. `ShellView`
        // still requires the field; see `disclosure.ts` for why it is quoted
        // rather than minted and why it is not imported from the layout.
        simulated_environment_disclosure: SIMULATED_ENVIRONMENT_DISCLOSURE,
        content: { kind: 'ready' },
      })}
      panel={loaded.panel}
    />
  );
}
