// =============================================================================
// apps/portal/src/app/calendar/[accountId]/timeline/page.tsx
// =============================================================================
// `/calendar/:accountId/timeline`, `GET /accounts/:accountId/timeline` as a
// route, AND IT PERFORMS THE READ NOW.
//
// THE SEGMENT IS `calendar/` AND NOT `accounts/`, WHICH IS A FENCE DECISION AND
// IS SAID RATHER THAN LEFT TO BE INFERRED. The timeline and the rules page are
// reached from an account, so their natural path is `/accounts/:accountId/...`.
// The session that wrote this file owned ONE segment and `app/accounts/` was not
// it. These URLs are therefore PROVISIONAL, and moving them is a rename with no
// change to any component below. That is still true and now costs one thing it
// did not: the cursor a paged timeline would need to hand its next page lives in
// a URL, so the paging control ../../load.ts declines to invent is waiting on
// this same decision.
//
// It used to render an honest 401 because "there is no transport in this
// application ... and a timeline rendered from a fixture would put events on a
// trader's screen that their account never had." ADR-162 landed the transport;
// the refusal is intact and only the `ready` arm reaches the screen.
//
// -----------------------------------------------------------------------------
// TWO READS, AND THE SECOND IS THE ONE THIS FILE'S OLD HEADER PREDICTED
// -----------------------------------------------------------------------------
// It said: "THE DAY THIS PAGE GETS DATA IT ALSO GETS A FRESHNESS FACT, or it
// renders `unstated`. `TimelineScreen` takes `freshness` as a REQUIRED prop
// under ADR-152, so a route that acquires a transport and no closed-through day
// does not compile its way past the question; it has to answer it."
//
// IT ANSWERS `unstated`, AND ../../load.ts ANSWERS IT RATHER THAN THIS FILE,
// because the answer is a property of the responses and not of the route. No
// endpoint on this surface publishes the day the firm has closed through, so
// `freshnessAgainst` has nothing to order and `unstated` is the only
// constructible arm. ADR-152 is that gap ruled.
//
// The `as_of_trading_day` the stamp needs is the SECOND read: it lives on
// `GET /accounts/:accountId` and on nothing this endpoint returns.

import { loadTimeline } from '../../load.ts';
import { CalendarError, CalendarUnavailable } from '../../states.tsx';
import { SIMULATED_ENVIRONMENT_DISCLOSURE } from '../../disclosure.ts';
import { TimelineScreen } from '../../timeline-screen.tsx';
import { toShellView } from '../../../../shell/app-shell.ts';

/** Never prerendered, never cached. ../../page.tsx's header states the argument. */
export const dynamic = 'force-dynamic';

/**
 * The heading every arm of this screen carries.
 *
 * IT DOES NOT ECHO THE ROUTE PARAMETER. On the two arms that read nothing, the
 * id in the URL is a string a stranger chose, and putting it in this
 * application's own markup on the screen INV-M4-07 is about is the wrong
 * direction. The `ready` arm renders the account id the SERVER returned.
 */
const TITLE = 'Account timeline';

/**
 * `params` IS AWAITED because it is a promise in the App Router from Next 15
 * onward, and this workspace is pinned to `16.3.2` (ADR-095 ruling 1).
 */
export default async function AccountTimelinePage(props: {
  readonly params: Promise<{ readonly accountId: string }>;
}) {
  const { accountId } = await props.params;
  const loaded = await loadTimeline(accountId);

  if (loaded.kind === 'unavailable')
    return <CalendarUnavailable title={TITLE} missing={loaded.missing} />;

  if (loaded.kind === 'error') return <CalendarError title={TITLE} error={loaded.error} />;

  return (
    <TimelineScreen
      shell={toShellView({
        impersonation: null,
        simulated_environment_disclosure: SIMULATED_ENVIRONMENT_DISCLOSURE,
        content: { kind: 'ready' },
      })}
      timeline={loaded.timeline}
      freshness={loaded.freshness}
      paging={loaded.paging}
    />
  );
}
