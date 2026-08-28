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
//   short, and no slice in this wave holds either file that would move.
//
// So this route renders the 503 with its reason, in the `PendingPanel` shape,
// which is WAVE-06 section 8.1 blocker 1 in its own words: "No slice in this
// wave resolves a principal, stubs one, or renders a screen whose correctness
// depends on one. The console renders the 503 with its reason, which is
// `page.ts`'s `PendingPanel` shape used for what it was built for."
//
// AND IT INVENTS NOTHING TO PUT ON THE SCREEN INSTEAD. `apps/portal/src/app/
// page.tsx` took the same decision one deployable over, and `src/index.ts`
// takes it about `main()`: "A `main` that invented inputs in order to print
// something would be the confidently wrong number AS-M6-04 is about, printed by
// the process whose subject is not printing it." A liability figure standing in
// for a liability figure is that sentence with a browser attached.
//
// -----------------------------------------------------------------------------
// THE SEAM IS ONE FUNCTION BODY AND THE OTHER ARM IS ALREADY BUILT
// -----------------------------------------------------------------------------
// `liabilityHomeRead()` returns the union. The `supplied` arm renders through
// `renderLiabilityHomeDocument`, which asserts `INV-M6-10` over the served
// bytes before returning the element, and `test/render.test.ts` renders a real
// `buildLiabilityHome` value through exactly that path. So the day a supplier
// exists, what changes is this one function and nothing else in this file.

import type { ReactElement } from 'react';

import { type AdminErrorKind, toAdminErrorKind } from '../http/client.ts';
import type { LiabilityHomePage, PendingPanel } from '../page.ts';
import { renderLiabilityHomeDocument } from './liability-home.tsx';

/** A read that produced the page, or the stated reason it could not. */
type LiabilityHomeRead =
  | { readonly kind: 'supplied'; readonly page: LiabilityHomePage }
  | {
      readonly kind: 'unsupplied';
      readonly error: AdminErrorKind;
      readonly blocked: readonly PendingPanel[];
    };

/**
 * 503, and it is `toAdminErrorKind`'s answer rather than a constant typed here.
 *
 * WAVE-06 section 8.1 blocker 1: `adminHandler` resolves the principal through
 * a source nothing supplies, so "every one of the 26 operator routes answers
 * 503" until ADR-171 section 9's condition lands. `unavailable` is the kind
 * this console keeps separate from `server_error` on purpose, per
 * `../http/client.ts`: a vocabulary that folded them would make the console
 * unable to tell "not built yet" from "broke just now".
 */
const NOT_YET: AdminErrorKind = toAdminErrorKind(503);

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
      'operator directory, which is infrastructure the founder buys rather than a file a session ' +
      'writes',
  },
  {
    origin: 'P5-l',
    title: 'The `GET /admin/liability` adapter',
    blockedBy:
      'the route is registered on the operator surface and `AdminReadSource.readLiability` has ' +
      'no adapter. WAVE-06 section 2.1 records the liability home as the surface with 1,764 ' +
      'lines of console code, a registered route and no adapter, and gives the adapter to ' +
      '`P5-l`. This wave holds none of the three files that slice holds',
  },
  {
    origin: 'API_CONTRACT section 8',
    title: 'Four of the five figures `buildLiabilityHome` reads have no field on the response',
    blockedBy:
      'REPORTED BY W6-d AND NOT REPAIRED HERE. `liability_snapshots` in ' +
      '`0009_ledger.sql` carries `open_liability_cents`, `wallet_balances_cents`, ' +
      '`bounded_near_term_cents`, `remaining_ladder_exposure_cents` and ' +
      '`absorbed_corrections_cents`, and `LiabilityHomeInput` reads all five. ' +
      '`LiabilityResponse` carries the first name and none of the other four, so P-M6-01 cannot ' +
      'show "the two components separately as well as summed", INV-M6-11 cannot include wallet ' +
      'balances, and P-M6-02, AS-M6-04 and P-M6-10 have no source at all. The one shared name is ' +
      'the ambiguity `../liability.ts` renamed on arrival to prevent: the column is ONE COMPONENT ' +
      "of the panel that shares its name. API_CONTRACT is `W6-e`'s file this wave and " +
      "`../page.ts` is `P5-l`'s, so this slice reports it rather than taking either",
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
  return { kind: 'unsupplied', error: NOT_YET, blocked: BLOCKED_ON };
}

export default function LiabilityHomeRoute(): ReactElement {
  const read = liabilityHomeRead();
  if (read.kind === 'supplied') return renderLiabilityHomeDocument(read.page);

  return (
    <article data-testid="liability-home-unsupplied" data-error={read.error}>
      <h1>Liability home</h1>
      <p data-testid="read-state">
        This console reads <code>/api/v1</code> on this origin and nothing else, and the read that
        fills this page answers <strong>{read.error}</strong>. What is below is what blocks it, not
        a placeholder for it: no number on this page is invented while a supplier is missing.
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
