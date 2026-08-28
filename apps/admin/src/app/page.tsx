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
// The reasons are in `BLOCKED_ON` below with their citations. **THIS PARAGRAPH
// NAMED THREE AND NAMES TWO, RE-DERIVED AT THIS EDIT RATHER THAN CARRIED
// FORWARD.**
//
// The one that cleared was this file's own finding and it read: `GET /admin/
// liability`'s CONTRACTED RESPONSE CANNOT PRODUCE THIS PAGE'S INPUT, a shape
// four fields short, ruled in by ADR-188 on the document with no code carrying
// them. **THE CODE CARRIES THEM NOW.** `LiabilityResponse` in `../api/types.ts`
// declares TWELVE top-level fields, `wallet_balances_cents`,
// `bounded_near_term_cents`, `remaining_ladder_exposure_cents` and
// `absorbed_corrections_cents` among them, and `RI-18` holds all three
// declarations of that shape to one field set, so the wire cannot carry a field
// in one place and not another. Every column `LiabilitySnapshot` reads is on the
// response.
//
// WHAT SURVIVED THAT ENTRY IS NOT A BLOCKER AND IS NOT IN THAT LIST. See
// {@link INCOMPLETE_ONCE_READ}: `P-M6-01`'s third component has no column and
// therefore no field, and `../liability.ts` renders it ABSENT with its reason
// and marks the total INCOMPLETE. A term the page renders honestly is not a
// thing the page is waiting for, and filing it as one would tell an operator
// the screen is broken when it is being careful.
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
];

/**
 * What this page will still not carry ONCE both blockers clear, with the reason.
 *
 * IT IS NOT A `PendingPanel` AND IT IS NOT IN {@link BLOCKED_ON}, WHICH IS THE
 * WHOLE DISTINCTION. A blocker is a thing that stops the read; this is a term
 * the read cannot supply and the page renders anyway, ABSENT, with its reason
 * and with the total marked INCOMPLETE. `../liability.ts` already does exactly
 * that (`theThreeNumbers`, the `withdrawalsInFlight` component), so nothing here
 * is waiting on it and a reader looking for it in the blocked list would
 * conclude the page is broken when it is being honest.
 *
 * **THE ENTRY THAT USED TO STAND IN `BLOCKED_ON` FOR THIS IS GONE BECAUSE ITS
 * PREMISE WAS MEASURED FALSE.** It read "four of the five figures
 * `buildLiabilityHome` reads have no field on the response", naming
 * `wallet_balances_cents`, `bounded_near_term_cents`,
 * `remaining_ladder_exposure_cents` and `absorbed_corrections_cents`. ADR-188
 * ruled them in and they are on the wire: `LiabilityResponse` declares twelve
 * top-level fields, all four are among them, and `RI-18` binds all three
 * declarations of that shape to one field set. Every column `LiabilitySnapshot`
 * reads is now reachable.
 */
export const INCOMPLETE_ONCE_READ: readonly PendingPanel[] = [
  {
    origin: 'ADR-195',
    title: 'P-M6-01`s THIRD component, the firm-scoped withdrawals_in_flight obligation',
    blockedBy:
      'NO COLUMN AND SO NO FIELD. ADR-195 section 6 row 1: `0009_ledger.sql` gives ' +
      '`liability_snapshots` its as_of, open_liability_cents, wallet_balances_cents, ' +
      'bounded_near_term_cents, remaining_ladder_exposure_cents, absorbed_corrections_cents, ' +
      'funded_accounts, id and computed_at, and not one of them is this obligation, so ' +
      '`LiabilityResponse` has nothing to project. IT IS RENDERED ABSENT RATHER THAN ZERO AND ' +
      'THE TOTAL SAYS IT IS INCOMPLETE, which is `../liability.ts`s own choice and its reason: ' +
      'a zero says the obligation was measured and found empty. Nothing in this tree posts ' +
      'LT-06 yet, so the term IS zero today and this panel starts understating on the day that ' +
      'stops being true, which is why the column has to land before the first writer of LT-06 ' +
      'does. INV-M6-15 is the rule that follows: Open Liability does not move when a wallet ' +
      'withdrawal is approved, and falls when that withdrawal`s cash leaves',
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
      <section data-testid="incomplete-once-read">
        <h2>What will still be incomplete once it does</h2>
        <ul>
          {INCOMPLETE_ONCE_READ.map((entry) => (
            <li key={entry.origin} data-origin={entry.origin}>
              {`[${entry.origin}] ${entry.title}: RENDERED ABSENT, because ${entry.blockedBy}`}
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
