// =============================================================================
// apps/admin/src/app/feed/page.tsx
// =============================================================================
// THE EVENT FEED ROUTE, AT `/feed`, AND WHAT BLOCKS IT HAS MOVED FROM THE TABLE
// TO THE PORT.
//
// `GET /admin/events` is registered on the operator surface and withheld from
// the public one, and `AdminReadSource` declares `listEvents` as its seventh
// method (ADR-184 ruling 1, landed by session 341). **A module supplies it
// today**: ADR-191 registered `events` and `apps/api/src/admin-source/events.ts`
// is the adapter. What does NOT exist is a deployment that composes the port,
// and blocker 2 below is that measurement rather than an expectation of one.
//
// -----------------------------------------------------------------------------
// THIS ROUTE PERFORMS NO READ, AND WHAT IT DOES NOT CLAIM IS THE MEASUREMENT
// -----------------------------------------------------------------------------
// WAVE-06 section 8.1 blocker 1 in its own words: "No slice in this wave
// resolves a principal, stubs one, or renders a screen whose correctness
// depends on one." `../page.tsx` took that decision for the liability home and
// `../flags/page.tsx` for the queue; this route takes the same one.
//
// **IT NAMES NO ERROR KIND, AND THE TWO REAL ANSWERS WERE MEASURED IN THIS
// SLICE RATHER THAN INHERITED.** WAVE-06 section 8.1 states that "every one of
// the 26 operator routes above answers 503 today". Over a real `compose()` on
// the operator surface and Fastify's own `inject`, `GET /api/v1/admin/events`
// answers **401 `unauthenticated`** with no admin session cookie and **500
// `internal_error`** with one. Neither branch is a 503, so a kind written here
// would be a status this console has measured that no operator route produces.
// The plan sentence and `../page.tsx`, which renders `toAdminErrorKind(503)` on
// its basis, are outside this fence and are REPORTED rather than repaired.
//
// **AND THE 401 ARRIVES BEFORE THE SCOPE PARSE, WHICH IS WORTH STATING BECAUSE
// IT BOUNDS WHAT ADR-184's REQUEST HALF ENFORCES TODAY.** `GET /admin/events`
// with no `scope` and no cookie answers 401 rather than the 400 the contract
// declares for it: `adminHandler` resolves the principal before any endpoint's
// handler runs. The 400 is real and reachable on a deployment with a session
// source, which `apps/api/test/admin-feed.test.ts` covers; it is not reachable
// on this one, and a console that claimed otherwise would be describing a
// deployment that does not exist.
//
// AND IT INVENTS NO ROW. A feed with a placeholder event in it is worse than an
// empty one, because a feed is a timeline somebody reads during an incident.
//
// -----------------------------------------------------------------------------
// THE SCOPE IS NOT DEFAULTED HERE EITHER, AND THAT IS THE SAME RULING
// -----------------------------------------------------------------------------
// ADR-184 ruling 2 makes `?scope=` required with no default, because
// `operational` silently redacts a drill-down and either named arm hands a bulk
// screen the licence a named query earns. A route that picked one in order to
// have something to render would be making that choice on the operator's behalf
// in the layer the ruling moved it out of. So this route names no scope at all
// until it has a read to issue, and `./event-feed.tsx` takes the query as a
// value rather than deriving one.

import type { ReactElement } from 'react';

import type { PendingPanel } from '../../page.ts';
import { type EventFeedPage, renderEventFeedDocument } from './event-feed.tsx';

/** A read that produced the feed, or the stated reason it could not. */
type EventFeedRead =
  | { readonly kind: 'supplied'; readonly page: EventFeedPage }
  | { readonly kind: 'unsupplied'; readonly blocked: readonly PendingPanel[] };

/**
 * What has to land before this route renders a row, each named with its owner.
 *
 * TWO ENTRIES, AND THE SECOND ONE HAS CHANGED ITS REASON RATHER THAN CLEARED.
 * The flags queue names one, because `listFlags` is composed and so is the
 * deployment's ability to answer with it. This names two, because `listEvents`
 * is supplied and the PORT it lives on is not composed by any deployment: a
 * partial `AdminReadSource` is not a value the setter accepts.
 */
const BLOCKED_ON: readonly PendingPanel[] = [
  {
    origin: 'ADR-171',
    title: 'An operator session, which is the principal every admin read resolves',
    blockedBy:
      'no admin identity provider. ADR-171 finding 4 measured that no table in the registry ' +
      'holds an operator, a role or an operator session, so `setAdminSessionSource` has no ' +
      'supplier in this repository and `requireAdminRole` in `../../roles.ts` resolves a role ' +
      'STRING that nothing produces. It is an SSO vendor selection and an operator directory, ' +
      'which is infrastructure the founder buys rather than a file a session writes. MEASURED ' +
      'in this slice, because WAVE-06 section 8.1 predicts a 503 and neither branch produces ' +
      'one: with no admin session cookie `GET /admin/events` answers 401 `unauthenticated`, and ' +
      'with one it answers 500 `internal_error`, which is the status ' +
      '`apps/api/src/routes/admin-reads.ts` chose at the declaration of `AdminReadError` and ' +
      'argued there',
  },
  {
    origin: 'ADR-184',
    title: 'A composed `AdminReadSource`, which no deployment installs',
    blockedBy:
      'ONE of the port`s seven methods having no module, and `listEvents` is not it. THE ' +
      'TABLE THAT BLOCKED IT IS REGISTERED: ADR-191 gave `events` the sixth scope class its ' +
      'two nullable tenancy columns needed, `TableKey` admits it, and ' +
      '`apps/api/src/admin-source/events.ts` reads it, so `IMPLEMENTED_ADMIN_READS` holds ' +
      'FIVE names where this panel once read two. ADR-184 section 3`s reasoning that the feed ' +
      'is "a keyed range read over ONE table" is therefore a third case where the port`s ' +
      'BLOCKED reason is measured false, and the narrowing DOES reach this method now. THE ' +
      'COUNT ON THIS PANEL WAS THREE AND IS ONE, RE-DERIVED RATHER THAN CARRIED: it named ' +
      '`exportEvidence`, `readLiability` and `searchAccounts`, and two of those three now ' +
      'have modules. `exportEvidence` reaches the port through `adminReadSourceParts`, the ' +
      'other producer in the same composition file, so counting implemented methods off ' +
      '`IMPLEMENTED_ADMIN_READS` alone undercounts by one; `searchAccounts` is ' +
      '`apps/api/src/admin-source/search.ts`. WHAT IS LEFT IS `readLiability` ALONE: no ' +
      'value satisfies `AdminReadSource` while it is missing, so `apps/api/src/start.ts` ' +
      'calls no setter and `setAdminReadSource` stays in `wiring.test.ts`s BLOCKED list. ' +
      'This console reports the measurement rather than assuming a shape for it',
  },
];

/**
 * The read.
 *
 * IT RETURNS THE SAME ARM EVERY TIME TODAY AND THE UNION IS STILL THE RETURN
 * TYPE, because the type is the seam and the body is what a supplier replaces.
 * `../page.tsx` and `../flags/page.tsx` state the same reason for the same
 * shape: a route that dropped the `supplied` arm until it was reachable would
 * be a route the next slice has to design rather than fill in.
 */
function eventFeedRead(): EventFeedRead {
  return { kind: 'unsupplied', blocked: BLOCKED_ON };
}

export default function EventFeedRoute(): ReactElement {
  const read = eventFeedRead();
  if (read.kind === 'supplied') return renderEventFeedDocument(read.page);

  return (
    <article data-testid="event-feed-unsupplied">
      <h1>Event feed</h1>
      <p data-testid="read-state">
        This console reads <code>/api/v1</code> on this origin and nothing else. The read that fills
        this feed is not performed yet, and what is below is what blocks it rather than a
        placeholder for it: no event on this page is invented while a supplier is missing.
      </p>
      <p data-testid="scope-state">
        This route names no scope. <code>?scope=</code> is required and has no default: whether the
        query names a specific subject is what INV-M6-10 turns on, so a route that picked one in
        order to have something to render would be choosing an operator&apos;s licence for them.
      </p>
      <section data-testid="blocked-on">
        <h2>What has to land first</h2>
        <ul>
          {read.blocked.map((entry) => (
            <li key={entry.origin} data-origin={entry.origin}>
              {`[${entry.origin}] ${entry.title}: NOT BUILT, blocked by ${entry.blockedBy}`}
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
