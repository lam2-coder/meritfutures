// =============================================================================
// apps/admin/src/app/page.tsx
// =============================================================================
// THE CONSOLE'S ROOT ROUTE, AND IT IS M06 SECTION 3.1's LIABILITY HOME.
//
// -----------------------------------------------------------------------------
// WHY THE LIABILITY HOME IS `/` AND NOT `/liability`
// -----------------------------------------------------------------------------
// M06 section 3.1 names it "the liability home PAGE", `OQ-M6-04`'s recommended
// answer is "yes, daily, one screen, and it is the first thing built in this
// module, because the habit is the control", and WAVE-06 section 10 item 4
// records this wave building it first as a transcription of that recommendation
// rather than a ruling on it. `apps/portal/src/app/page.tsx` put that app's
// first screen at its root for the same reason.
//
// The alternative costs something an operator meets on day one: with the home
// at `/liability`, the console's origin answers the framework's own 404, and no
// slice in WAVE-06 holds a root index to put there. A screen behind a path
// nobody typed is not a habit.
//
// -----------------------------------------------------------------------------
// THIS ROUTE PERFORMS NO READ, AND THAT IS MEASURED RATHER THAN DEFERRED
// -----------------------------------------------------------------------------
// The three reasons are in `BLOCKED_ON` below with their citations, and the
// first two were known when WAVE-06 was written. The third was not, and it is
// reported by this slice rather than worked around:
//
//   `GET /admin/liability`'s CONTRACTED RESPONSE CANNOT PRODUCE THIS PAGE'S
//   INPUT. That is not a missing adapter; it is a shape that is four fields
//   short. ADR-188 has since ruled the four fields in, on the document; no code
//   carries them yet.
//
// -----------------------------------------------------------------------------
// THIS ROUTE NAMES NO ERROR KIND, AND ADR-190 IS WHY
// -----------------------------------------------------------------------------
// IT USED TO NAME ONE AND THE ONE IT NAMED WAS NOT A STATUS ANY OPERATOR ROUTE
// SENDS. `W6-d` shipped `const NOT_YET: AdminErrorKind = toAdminErrorKind(503)`
// on WAVE-06 section 4.1's sentence, "every one of the 26 operator routes above
// answers 503 today". Session 344 measured that sentence false for this page's
// own endpoint and this session measured all 28 registered operator routes, one
// at a time, over a real `compose()` and Fastify's own `inject`:
//
//   `GET /admin/liability` answers 401 `unauthenticated` with no admin session
//   cookie, because `adminHandler` reads the cookie before it consults the
//   session source and so has nothing to look up; and 500 `internal_error` with
//   one, because `currentSessionSource()` throws. NEITHER IS 503.
//
//   AND ONLY ONE OF THE TWO IS REACHABLE BY A BROWSER. Nothing in this
//   repository calls `setAdminSessionSource` outside a test, so no deployment
//   can mint the cookie this console would send. THE ANSWER A REAL CONSOLE READ
//   RECEIVES TODAY IS 401 AND NOTHING ELSE; the 500 needs a caller who
//   fabricated a cookie.
//
// ADR-190 ruling 3 is the rule this file now keeps, and it is narrower than
// "the number was wrong": AN ERROR KIND IS A VALUE DERIVED FROM A RESPONSE THIS
// CONSOLE RECEIVED. A route that performs no read has received none, so it
// names none. `src/app/flags/page.tsx` and `src/app/identities/[identityId]/
// page.tsx` both shipped under that rule before it was written down, and
// `test/render.test.ts` now asserts it over the whole `src/app/` directory so
// that the next screen inherits a control rather than three sessions' good
// judgement.
//
// WHAT IS NOT CLAIMED HERE. `unavailable` stays a member of `AdminErrorKind`
// (`../http/client.ts`), and ADR-190 ruling 2 is why it should: 13 of the 23
// registered `/admin/*` routes DO answer 503 `service_unavailable` today. The
// finding is that this page's own endpoint is not one of them, not that the
// member has no producer.
//
// -----------------------------------------------------------------------------
// THE SEAM IS ONE FUNCTION BODY AND THE OTHER ARM IS ALREADY BUILT
// -----------------------------------------------------------------------------
// `liabilityHomeRead()` returns the union. The `supplied` arm renders through
// `renderLiabilityHomeDocument`, which asserts `INV-M6-10` over the served
// bytes before returning the element, and `test/render.test.ts` renders a real
// `buildLiabilityHome` value through exactly that path. So the day a supplier
// exists, what changes is this one function and nothing else in this file.
//
// THE FAILED ARM IS NOT PRE-BUILT AND ADR-190 RULING 3 IS ALSO WHY. The arm a
// real read needs carries a kind AND the status it was derived from, which is
// `AdminApiFailure`'s shape in `../http/client.ts` and is already written. A
// third arm added here before a fetch exists would be a second place to spell
// a status nobody sent, which is the defect this file just removed.

import type { ReactElement } from 'react';

import type { LiabilityHomePage, PendingPanel } from '../page.ts';
import { renderLiabilityHomeDocument } from './liability-home.tsx';

/** A read that produced the page, or the stated reason it could not. */
type LiabilityHomeRead =
  | { readonly kind: 'supplied'; readonly page: LiabilityHomePage }
  | { readonly kind: 'unsupplied'; readonly blocked: readonly PendingPanel[] };

/**
 * What has to land before this route renders a number, each named with its
 * owner rather than with "later".
 *
 * THE SHAPE IS `PendingPanel` AND THAT IS THE POINT OF THE SHAPE. It carries an
 * origin, a title and a `blockedBy` that names the dependency, and `page.ts`'s
 * own five entries are the same shape used for the same purpose one layer down.
 */
const BLOCKED_ON: readonly PendingPanel[] = [
  {
    origin: 'ADR-171',
    title: 'An operator session, which is the principal every admin read resolves',
    blockedBy:
      'no admin identity provider. ADR-171 finding 4 measured that `admin_actions.actor` is ' +
      '`text NOT NULL` with no foreign key and that no table in the registry holds an operator, ' +
      'a role or an operator session, so `setAdminSessionSource` has no supplier in this ' +
      'repository. `requireAdminRole` in `../roles.ts` resolves a role STRING and nothing ' +
      'produces one. WAVE-06 section 8.1 blocker 1: it is an SSO vendor selection and an ' +
      'operator directory, which is infrastructure the founder buys rather than a file a ' +
      'session writes. MEASURED, and ADR-190 rules what this page may say about it: with no ' +
      'admin session cookie `GET /admin/liability` answers 401 `unauthenticated`, and with one ' +
      'it answers 500 `internal_error`, which is the status ' +
      '`apps/api/src/routes/admin-reads.ts` chose at the declaration of `AdminReadError` and ' +
      'argued there. No deployment can mint that cookie today, so 401 is the answer this ' +
      'console would actually receive',
  },
  {
    origin: 'P5-l',
    title: 'The `GET /admin/liability` adapter',
    blockedBy:
      'the route is registered on the operator surface and `AdminReadSource.readLiability` has ' +
      'no adapter. WAVE-06 section 2.1 records the liability home as the surface with 1,764 ' +
      'lines of console code, a registered route and no adapter, and gives the adapter to ' +
      '`P5-l`. This wave holds none of the three files that slice holds. It is a SECOND ' +
      'uncomposed port behind the first, and ADR-190 measured that it answers the same 500 as ' +
      'the first: a caller who got past the session source would meet this one and could not ' +
      'tell the two apart from the response',
  },
  {
    origin: 'API_CONTRACT section 8',
    title: 'Four of the five figures `buildLiabilityHome` reads have no field on the response',
    blockedBy:
      'REPORTED BY W6-d AND RULED BY ADR-188, WHOSE APPROVAL LINE IS UNSIGNED AND WHOSE FIELDS ' +
      'ARE ON NO WIRE YET. `liability_snapshots` in `0009_ledger.sql` carries ' +
      '`open_liability_cents`, `wallet_balances_cents`, `bounded_near_term_cents`, ' +
      '`remaining_ladder_exposure_cents` and `absorbed_corrections_cents`, and ' +
      '`LiabilityHomeInput` reads all five. `LiabilityResponse` carries the first name and none ' +
      'of the other four, so P-M6-01 cannot show "the two components separately as well as ' +
      'summed", INV-M6-11 cannot include wallet balances, and P-M6-02, AS-M6-04 and P-M6-10 ' +
      'have no source at all. The one shared name is the ambiguity `../liability.ts` renamed on ' +
      'arrival to prevent: the column is ONE COMPONENT of the panel that shares its name',
  },
];

/**
 * The read.
 *
 * IT RETURNS THE SAME ARM EVERY TIME TODAY AND THE UNION IS STILL THE RETURN
 * TYPE, because the type is the seam and the body is what a supplier replaces.
 * A route that dropped the `supplied` arm until it was reachable would be a
 * route the next slice has to design rather than fill in.
 */
function liabilityHomeRead(): LiabilityHomeRead {
  return { kind: 'unsupplied', blocked: BLOCKED_ON };
}

export default function LiabilityHomeRoute(): ReactElement {
  const read = liabilityHomeRead();
  if (read.kind === 'supplied') return renderLiabilityHomeDocument(read.page);

  return (
    <article data-testid="liability-home-unsupplied">
      <h1>Liability home</h1>
      <p data-testid="read-state">
        This console reads <code>/api/v1</code> on this origin and nothing else. The read that fills
        this page is not performed yet, and what is below is what blocks it rather than a
        placeholder for it: no number on this page is invented while a supplier is missing.
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
