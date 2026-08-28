// =============================================================================
// apps/admin/src/app/flags/page.tsx
// =============================================================================
// THE FLAGS QUEUE ROUTE, AT `/flags`, AND IT IS THE ONE M06 SURFACE WHOSE BOTH
// HALVES ARE BUILT.
//
// `GET /admin/flags` is registered on the operator surface and `listFlags` is
// one of the FIVE methods `apps/api/src/admin-source/index.ts`'s
// `IMPLEMENTED_ADMIN_READS` composes, where this sentence said TWO. So this
// screen renders real rows on the day an operator session exists, and until
// then it says what it is waiting for.
//
// -----------------------------------------------------------------------------
// THIS ROUTE PERFORMS NO READ, AND WHAT IT DOES NOT CLAIM IS THE MEASUREMENT
// -----------------------------------------------------------------------------
// WAVE-06 section 8.1 blocker 1 in its own words: "No slice in this wave
// resolves a principal, stubs one, or renders a screen whose correctness
// depends on one." `src/app/page.tsx` took that decision for the liability home
// and this route takes the same one.
//
// **IT NAMES NO ERROR KIND, AND THAT IS THIS SLICE'S FINDING RATHER THAN A
// DIFFERENCE OF STYLE.** WAVE-06 section 8.1 states that "every one of the 26
// operator routes above answers 503 today", and `src/app/page.tsx` renders
// `toAdminErrorKind(503)` on that basis. **MEASURED OVER A REAL `compose()` AND
// FASTIFY'S OWN `inject`, AN OPERATOR ROUTE ANSWERS 503 IN NEITHER BRANCH**:
// with no admin session cookie `adminHandler` reaches `authorizeAdmin` with
// `{ kind: 'unknown' }` and answers **401 `unauthenticated`**, and with a cookie
// present `currentSessionSource()` throws `AdminReadError`, which
// `apps/api/src/routes/admin-reads.ts` documents at its declaration as "A 500
// AND NEVER A 404 OR A 503" and `apps/api/src/server.ts` maps to
// **500 `internal_error`**.
//
// So a kind written here would be a status this console has measured that no
// operator route produces. The blocked list below carries both real answers as
// prose instead, and the sentence in `src/app/page.tsx` is REPORTED rather than
// repaired: that file is `W6-d`'s and WAVE-06 rule 1 fences it.
//
// AND IT INVENTS NO ROW. A queue with a placeholder row in it is worse than an
// empty one, because a queue is a list of things somebody is meant to act on.

import type { ReactElement } from 'react';

import type { PendingPanel } from '../../page.ts';
import { type FlagQueuePage, renderFlagQueueDocument } from './flags-queue.tsx';

/** A read that produced the queue, or the stated reason it could not. */
type FlagQueueRead =
  | { readonly kind: 'supplied'; readonly page: FlagQueuePage }
  | { readonly kind: 'unsupplied'; readonly blocked: readonly PendingPanel[] };

/**
 * What has to land before this route renders a row, each named with its owner.
 *
 * ONE ENTRY, AND THE SHORTNESS OF THE LIST WAS THE POINT OF THIS SCREEN. It
 * read that the liability home names three, "an operator session, an adapter
 * nobody wrote and a contracted response four fields short of its input", and
 * the third has since cleared: ADR-188's fields are on the wire and
 * `../page.tsx` retired that entry. **SO THE LIABILITY HOME NAMES TWO AND THIS
 * QUEUE STILL NAMES ONE**, and the reason it is shorter is unchanged: its
 * adapter is composed and its contract row carries every field this document
 * renders. `../search/page.tsx` names one as well, on the same ground.
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
      'which is infrastructure the founder buys rather than a file a session writes. MEASURED, ' +
      'because WAVE-06 section 8.1 predicts a 503 and neither branch produces one: with no ' +
      'admin session cookie this endpoint answers 401 `unauthenticated`, and with one it ' +
      'answers 500 `internal_error`, which is the status `apps/api/src/routes/admin-reads.ts` ' +
      'chose at the declaration of `AdminReadError` and argued there',
  },
];

/**
 * The read.
 *
 * IT RETURNS THE SAME ARM EVERY TIME TODAY AND THE UNION IS STILL THE RETURN
 * TYPE, because the type is the seam and the body is what a supplier replaces.
 * `src/app/page.tsx` states the same reason for the same shape: a route that
 * dropped the `supplied` arm until it was reachable would be a route the next
 * slice has to design rather than fill in.
 */
function flagQueueRead(): FlagQueueRead {
  return { kind: 'unsupplied', blocked: BLOCKED_ON };
}

export default function FlagQueueRoute(): ReactElement {
  const read = flagQueueRead();
  if (read.kind === 'supplied') return renderFlagQueueDocument(read.page);

  return (
    <article data-testid="flags-queue-unsupplied">
      <h1>Flags queue</h1>
      <p data-testid="read-state">
        This console reads <code>/api/v1</code> on this origin and nothing else. The read that fills
        this queue is not performed yet, and what is below is what blocks it rather than a
        placeholder for it: no row on this page is invented while a supplier is missing.
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
