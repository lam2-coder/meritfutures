// =============================================================================
// apps/portal/src/app/calendar/[accountId]/rules/page.tsx
// =============================================================================
// `/calendar/:accountId/rules`, SC-M4-05, the account's PINNED plan version, AND
// IT PERFORMS THE TWO READS NOW.
//
// The segment and the provisional URL are the timeline page's note, one
// directory over. This file used to render an honest error state because there
// was no transport, on the ground that "a rules page rendered from a fixture
// would show a trader contract terms they were never sold, which is the exact
// failure INV-M4-08 and M04 section 4's 'pinned, not current' obligation exist
// to prevent."
//
// THAT OBLIGATION IS NOW HELD BY TWO SIGNATURES RATHER THAN BY A COMMENT.
// ../../load.ts's `pinnedVersionPath` takes the version as a parameter, so this
// route cannot reach the CURRENT version by taking the plan's latest: it has to
// be handed the pin. And the pin is on `GET /accounts/:accountId`, so the reads
// are sequential and the second one's path is composed from the first one's
// body. A page that fetched the plan alone could not have been written.
//
// THE ACCOUNT'S `as_of_trading_day` IS THE OTHER THING THAT READ IS FOR.
// `RulesScreen` requires it beside the contract because "a plan version has no
// as-of day of its own ... the rules page is reached from an account and is read
// alongside one", and `PlanVersionResponse` carries no such field.

import { loadRules } from '../../load.ts';
import { RulesScreen } from '../../rules-screen.tsx';
import { CalendarError, CalendarUnavailable } from '../../states.tsx';
import { SIMULATED_ENVIRONMENT_DISCLOSURE } from '../../disclosure.ts';
import { toShellView } from '../../../../shell/app-shell.ts';

/** Never prerendered, never cached. ../../page.tsx's header states the argument. */
export const dynamic = 'force-dynamic';

/** The heading every arm carries. It does not echo the route parameter; see the timeline page. */
const TITLE = 'Your account rules';

/** `params` is awaited: it is a promise in the App Router from Next 15 onward. */
export default async function AccountRulesPage(props: {
  readonly params: Promise<{ readonly accountId: string }>;
}) {
  const { accountId } = await props.params;
  const loaded = await loadRules(accountId);

  if (loaded.kind === 'unavailable')
    return <CalendarUnavailable title={TITLE} missing={loaded.missing} />;

  if (loaded.kind === 'error') return <CalendarError title={TITLE} error={loaded.error} />;

  return (
    <RulesScreen
      shell={toShellView({
        impersonation: null,
        simulated_environment_disclosure: SIMULATED_ENVIRONMENT_DISCLOSURE,
        content: { kind: 'ready' },
      })}
      rules={loaded.rules}
      as_of_trading_day={loaded.as_of_trading_day}
      freshness={loaded.freshness}
    />
  );
}
