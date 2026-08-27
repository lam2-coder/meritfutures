// =============================================================================
// apps/portal/src/app/calendar/page.tsx
// =============================================================================
// `/calendar`, M04 section 3.8's panel as a route.
//
// -----------------------------------------------------------------------------
// IT RENDERS THE STATE THAT IS TRUE, WHICH TODAY IS THAT NOTHING WAS LOADED
// -----------------------------------------------------------------------------
// `EconomicCalendarScreen` takes a built `EconomicCalendarPanelView` and this
// page cannot build one, because there is nothing to build it FROM. M04 section
// 1.1 makes this app one "consuming `/api/v1` and nothing else", and
// `test/surface.test.ts` still asserts that no source file here performs a
// network call. Session 250 landed the framework and deliberately did not amend
// that assertion, and `app/page.tsx` records the same position: "There is no API
// client in this app and no `/api/v1` to call."
//
// SO THE PAGE DOES NOT INVENT A RELEASE. A calendar screen rendered from a
// fixture would put a Tier-1 release time on a trader's screen that Merit never
// transcribed, on the one panel whose entire argument is that its source is
// `economic_calendar` and no other origin (INV-M4-16). That is a worse failure
// than an honest error state, and it is the failure `app/page.tsx` refuses in
// its own words: "a root page showing a balance, a gate or a payout would be
// showing a number this app did not receive."
//
// `401` IS COMPUTED AND NOT TYPED. `toPortalErrorKind` maps the status
// API_CONTRACT specifies for an unauthenticated read onto the portal's own
// vocabulary, so the mapping stays in the one module that owns it and this file
// decides no wording. INV-M4-07: there is no `forbidden` for it to reach.
//
// WHAT LANDS WITH THE TRANSPORT IS THREE LINES. `load.ts` already names the
// path and holds the reader; a route with a client calls
// `readEconomicCalendarPanel(body, timezone)` and passes the result to the
// screen below, which needs no change at all.

import { toPortalErrorKind, toShellView } from '../../shell/app-shell.ts';
import { SIMULATED_ENVIRONMENT_DISCLOSURE } from './disclosure.ts';
import { ScreenFrame } from './screen-frame.tsx';

/** The status API_CONTRACT specifies for a read with no session. */
const UNAUTHENTICATED = 401;

export default function EconomicCalendarPage() {
  const shell = toShellView({
    impersonation: null,

    // The layout renders the disclosure and owns INV-M4-09. `ShellView` still
    // requires the field; see `disclosure.ts` for why it is quoted rather than
    // minted and why it is not imported from the layout.
    simulated_environment_disclosure: SIMULATED_ENVIRONMENT_DISCLOSURE,
    content: { kind: 'error', error: toPortalErrorKind(UNAUTHENTICATED) },
  });

  return (
    <ScreenFrame shell={shell} title="Economic calendar">
      {null}
    </ScreenFrame>
  );
}
