// =============================================================================
// apps/portal/src/app/calendar/[accountId]/rules/page.tsx
// =============================================================================
// `/calendar/:accountId/rules`, SC-M4-05, the account's PINNED plan version.
//
// The segment and the provisional URL are the timeline page's note, one
// directory over. It renders an honest error state for the same reason: there is
// no transport here and a rules page rendered from a fixture would show a trader
// contract terms they were never sold, which is the exact failure INV-M4-08 and
// M04 section 4's "pinned, not current" obligation exist to prevent.
//
// `load.ts`'s `pinnedVersionPath` takes the version as a parameter for that
// reason, so the route that acquires a transport cannot reach the CURRENT
// version by taking the plan's latest: it has to be handed the pin the account
// carries.

import { toPortalErrorKind, toShellView } from '../../../../shell/app-shell.ts';
import { SIMULATED_ENVIRONMENT_DISCLOSURE } from '../../disclosure.ts';
import { ScreenFrame } from '../../screen-frame.tsx';

const UNAUTHENTICATED = 401;

export default function AccountRulesPage() {
  const shell = toShellView({
    impersonation: null,
    simulated_environment_disclosure: SIMULATED_ENVIRONMENT_DISCLOSURE,
    content: { kind: 'error', error: toPortalErrorKind(UNAUTHENTICATED) },
  });

  return (
    <ScreenFrame shell={shell} title="Your account rules">
      {null}
    </ScreenFrame>
  );
}
