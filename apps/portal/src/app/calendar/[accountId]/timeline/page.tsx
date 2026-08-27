// =============================================================================
// apps/portal/src/app/calendar/[accountId]/timeline/page.tsx
// =============================================================================
// `/calendar/:accountId/timeline`, `GET /accounts/:accountId/timeline` as a route.
//
// THE SEGMENT IS `calendar/` AND NOT `accounts/`, WHICH IS A FENCE DECISION AND
// IS SAID RATHER THAN LEFT TO BE INFERRED. The timeline and the rules page are
// reached from an account, so their natural path is `/accounts/:accountId/...`.
// This session owns ONE segment and `app/accounts/` is not it: claiming it would
// collide with whichever session renders SC-M4-02 and SC-M4-03. These URLs are
// therefore PROVISIONAL, and moving them is a rename with no change to any
// component below.
//
// It renders an honest error state for the reason `../../page.tsx` gives at
// length: there is no transport in this application, `test/surface.test.ts`
// still asserts there is none, and a timeline rendered from a fixture would put
// events on a trader's screen that their account never had.
//
// THE DAY THIS PAGE GETS DATA IT ALSO GETS A FRESHNESS FACT, or it renders
// `unstated`. `TimelineScreen` takes `freshness` as a REQUIRED prop under
// ADR-152, so a route that acquires a transport and no closed-through day does
// not compile its way past the question; it has to answer it.

import { toPortalErrorKind, toShellView } from '../../../../shell/app-shell.ts';
import { SIMULATED_ENVIRONMENT_DISCLOSURE } from '../../disclosure.ts';
import { ScreenFrame } from '../../screen-frame.tsx';

const UNAUTHENTICATED = 401;

export default function AccountTimelinePage() {
  const shell = toShellView({
    impersonation: null,
    simulated_environment_disclosure: SIMULATED_ENVIRONMENT_DISCLOSURE,
    content: { kind: 'error', error: toPortalErrorKind(UNAUTHENTICATED) },
  });

  return (
    <ScreenFrame shell={shell} title="Account timeline">
      {null}
    </ScreenFrame>
  );
}
