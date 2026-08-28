// =============================================================================
// apps/admin/src/app/identities/[identityId]/page.tsx
// =============================================================================
// THE IDENTITY DRILL-DOWN'S ROUTE, AND ITS PATH IS THE CONTROL.
//
// -----------------------------------------------------------------------------
// A DYNAMIC SEGMENT AND NOTHING ABOVE IT, WHICH IS M06 SECTION 3.2a's SENTENCE
// EXPRESSED AS A FILE TREE
// -----------------------------------------------------------------------------
// "It is reachable only by naming a specific subject ... It is not a browse
// surface and there is no list behind it."
//
// SO `src/app/identities/` HOLDS THIS FILE AND THE DOCUMENT MODULE AND NOTHING
// ELSE. There is deliberately no `identities/page.tsx`: that route is the list
// the section says does not exist, and a framework that maps a directory to a
// URL would have published it the moment somebody added an index for tidiness.
// An operator reaching `/identities` gets the framework's own 404, which is the
// correct answer to a request for a screen that is not supposed to exist.
//
// AND THERE IS NO SEARCH AND NO RECENT-IDENTITIES AFFORDANCE ANYWHERE UNDER
// THIS DIRECTORY. `FM-M6-10` is "a bulk PII surface hiding inside a convenience
// feature", and an input that resolves a name to an id is that feature exactly.
// `test/identity-render.test.ts` asserts the directory rather than trusting the
// sentence.
//
// -----------------------------------------------------------------------------
// THIS ROUTE PERFORMS NO READ, AND IT NAMES NO ERROR KIND
// -----------------------------------------------------------------------------
// WAVE-06 section 8.1 blocker 1: "No slice in this wave resolves a principal,
// stubs one, or renders a screen whose correctness depends on one."
// `GET /admin/identities/:identityId/graph` is registered and
// `readIdentityGraph` is one of the two methods `IMPLEMENTED_ADMIN_READS`
// composes, so like the flags queue this screen is waiting on ADR-171 and on
// nothing else.
//
// `src/app/flags/page.tsx` states the measurement this route inherits: an
// operator route answers 401 `unauthenticated` with no admin session cookie and
// 500 `internal_error` with one, and never the 503 WAVE-06 section 8.1
// predicts. So no kind is written here either.
//
// -----------------------------------------------------------------------------
// THE REQUESTED ID IS RENDERED AND NOTHING ELSE ABOUT THE SUBJECT IS
// -----------------------------------------------------------------------------
// It is the operator's own path parameter echoed back, so it tells them nothing
// they did not type and it is the one thing that makes "this page named a
// subject" visible on a page that read nothing. It is NOT trader-identifying
// data produced by a read: no status, no account, no figure and no link, because
// none was fetched. INV-M6-10's licence covers it either way, the query having
// named it.

import type { ReactElement } from 'react';

import type { PendingPanel } from '../../../page.ts';
import { type IdentityGraphPage, renderIdentityGraphDocument } from '../identity-graph.tsx';

/** A read that produced the graph, or the stated reason it could not. */
type IdentityGraphRead =
  | { readonly kind: 'supplied'; readonly page: IdentityGraphPage }
  | {
      readonly kind: 'unsupplied';
      readonly subjectIdentityId: string;
      readonly blocked: readonly PendingPanel[];
    };

/**
 * What has to land before this route renders a graph.
 *
 * ONE ENTRY, LIKE THE FLAGS QUEUE AND FOR THE SAME REASON: the adapter is
 * composed and the contract row exists. What this screen additionally does not
 * show, once it does read, is on the document itself in `WITHHELD_FIGURES`,
 * because those absences are properties of the response rather than of the
 * deployment and they survive the day this blocker clears.
 */
const BLOCKED_ON: readonly PendingPanel[] = [
  {
    origin: 'ADR-171',
    title: 'An operator session, which is the principal every admin read resolves',
    blockedBy:
      'no admin identity provider. ADR-171 finding 4 measured that no table in the registry ' +
      'holds an operator, a role or an operator session, so `setAdminSessionSource` has no ' +
      'supplier in this repository. MEASURED, because WAVE-06 section 8.1 predicts a 503 and ' +
      'neither branch produces one: with no admin session cookie this endpoint answers 401 ' +
      '`unauthenticated`, and with one it answers 500 `internal_error`. AND THIS SCREEN IS THE ' +
      'ONE THAT WAITS ON IT TWICE: M06 section 3.2a requires every view of a drill-down to be ' +
      'LOGGED as an access to the underlying identities, in section 7.9 terms, and an access log ' +
      'with no actor is not a record of an access',
  },
];

/**
 * The read.
 *
 * IT TAKES THE SUBJECT AND RETURNS THE SAME ARM EVERY TIME TODAY. The parameter
 * is on the signature rather than waiting for a supplier, because the subject is
 * what makes this screen lawful and a seam that did not carry it would be a seam
 * the next slice has to redesign.
 */
function identityGraphRead(subjectIdentityId: string): IdentityGraphRead {
  return { kind: 'unsupplied', subjectIdentityId, blocked: BLOCKED_ON };
}

export default async function IdentityDrillDownRoute({
  params,
}: {
  readonly params: Promise<{ readonly identityId: string }>;
}): Promise<ReactElement> {
  const { identityId } = await params;
  const read = identityGraphRead(identityId);
  if (read.kind === 'supplied') return renderIdentityGraphDocument(read.page);

  return (
    <article data-testid="identity-drill-down-unsupplied">
      <h1>Identity drill-down</h1>
      <p data-testid="named-subject">
        {`Subject named by this page: ${read.subjectIdentityId}. This screen is reachable only ` +
          'by naming a subject and there is no list behind it (M06 section 3.2a, INV-M6-10).'}
      </p>
      <p data-testid="read-state">
        This console reads <code>/api/v1</code> on this origin and nothing else. The read that fills
        this page is not performed yet, and what is below is what blocks it rather than a
        placeholder for it: nothing about this human is invented while a supplier is missing.
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
