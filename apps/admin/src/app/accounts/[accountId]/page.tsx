// =============================================================================
// apps/admin/src/app/accounts/[accountId]/page.tsx
// =============================================================================
// THE ACCOUNT DRILL-DOWN'S ROUTE, AND ITS PATH IS THE CONTROL.
//
// -----------------------------------------------------------------------------
// A DYNAMIC SEGMENT AND NOTHING ABOVE IT
// -----------------------------------------------------------------------------
// `src/app/accounts/` HOLDS THIS FILE AND THE DOCUMENT MODULE AND NOTHING ELSE.
// There is deliberately no `accounts/page.tsx`, and the reason has two halves
// that are worth keeping apart.
//
// THE FIRST HALF WAS A FENCE AND IT HAS EXPIRED. It read that the search
// surface is `GET /admin/accounts?query=`, a different contract row, and that
// `AdminReadSource.searchAccounts` is owned by NO PLAN at all, on WAVE-06
// section 10 item 3. **BOTH HALVES OF THAT ARE NOW FALSE**: session 371 wrote
// `apps/api/src/admin-source/search.ts` and the screen exists in this package,
// at `src/app/search/`. It is still not HERE, and the second half below is why
// it never could be.
//
// THE SECOND HALF IS AN INVARIANT AND IT OUTLIVED THE FENCE, WHICH IS THE
// POINT OF HAVING KEPT THE TWO APART. An index route under this directory
// renders a list of accounts with no query behind it, which is `FM-M6-10` in
// its own words, "a bulk PII surface hiding inside a convenience feature". The
// registered endpoint refuses exactly that: it makes `?query=` a validation
// failure when absent rather than an implied "everybody", citing `INV-M6-10`
// where it does so.
//
// SO THE SEARCH SCREEN ARRIVED WITH A QUERY AND IN ITS OWN SEGMENT.
// `src/app/search/` publishes `/search`, renders no row until a term names a
// subject, and refuses a page value carrying no term at all, which is the same
// refusal the endpoint makes, one layer nearer the operator.
// `test/account-render.test.ts` asserts this directory rather than this
// sentence, and it is unchanged by that slice.
//
// -----------------------------------------------------------------------------
// THIS ROUTE PERFORMS NO READ, AND IT NAMES NO ERROR KIND
// -----------------------------------------------------------------------------
// It waits on TWO suppliers where the flags queue and the identity drill-down
// wait on one, and what the second one is has MOVED rather than cleared.
// `readAccount` is composed in `apps/api/src/admin-source/index.ts` beside
// `readIdentityGraph`, `listFlags`, `listEvents` and now `searchAccounts`,
// because ADR-191 registered `events` and session 356 wrote the adapter. What no
// deployment has is the PORT: `readLiability` has no module, so no value
// satisfies `AdminReadSource` and nothing calls `setAdminReadSource`. THAT
// SENTENCE NAMED THREE METHODS AND NAMES ONE, re-derived at this edit:
// `searchAccounts` landed with session 371 and `exportEvidence` reaches the
// port through `adminReadSourceParts` rather than through
// `IMPLEMENTED_ADMIN_READS`, so an implemented-method count taken off that
// array alone undercounts by one.
//
// `../../flags/page.tsx` states the measurement this route inherits, and it was
// re-measured here against this route rather than assumed: with no admin session
// cookie `GET /api/v1/admin/accounts/:accountId` answers 401 `unauthenticated`
// and with one it answers 500 `internal_error`. WAVE-06 section 8.1 predicts a
// 503 and neither branch produces one, so no kind is written here and the two
// real answers are carried in the blocker prose where an operator reads them.
//
// -----------------------------------------------------------------------------
// THE REQUESTED ID IS RENDERED AND NOTHING ELSE ABOUT THE SUBJECT IS
// -----------------------------------------------------------------------------
// It is the operator's own path parameter echoed back, so it tells them nothing
// they did not type, and it is the one thing that makes "this page named a
// subject" visible on a page that read nothing. `INV-M6-10`'s licence covers it
// either way, the query having named it.

import type { ReactElement } from 'react';

import type { PendingPanel } from '../../../page.ts';
import { type AccountDetailPage, renderAccountDetailDocument } from '../account-detail.tsx';

/** A read that produced the drill-down, or the stated reason it could not. */
type AccountDetailRead =
  | { readonly kind: 'supplied'; readonly page: AccountDetailPage }
  | {
      readonly kind: 'unsupplied';
      readonly subjectAccountId: string;
      readonly blocked: readonly PendingPanel[];
    };

/**
 * What has to land before this route renders a drill-down.
 *
 * TWO ENTRIES, WHERE THE THREE SCREENS BEFORE IT HAVE ONE. The second is the
 * one this slice measured rather than inherited: the adapter behind this route
 * cannot be written today, and the obstruction is a compile error rather than an
 * unwritten file. What the screen additionally does not show ONCE it reads is on
 * the document itself in `WITHHELD_SECTIONS`, because those absences are
 * properties of the contract rather than of the deployment and they survive the
 * day both blockers clear.
 */
const BLOCKED_ON: readonly PendingPanel[] = [
  {
    origin: 'WAVE-06 section 10 item 3',
    title: 'The read itself: `AdminReadSource` is composed by no deployment',
    blockedBy:
      'ONE of the port`s seven methods, measured rather than assumed, and `readAccount` is ' +
      'not it. ALL EIGHT SECTIONS ARE REACHABLE NOW: `accounts`, ' +
      '`identities`, `dailyMarks`, `ruleStates`, `riskFlags`, `payoutRequests`, `adminActions` ' +
      'and `events` are all keys `packages/db` registers, ADR-191 gave the last one the sixth ' +
      'scope class it needed, and `apps/api/src/admin-source/account.ts` supplies every ' +
      'section API_CONTRACT section 8 names. THIS PANEL READ THREE AND READS ONE, RE-DERIVED ' +
      'RATHER THAN CARRIED FORWARD: `searchAccounts` is ' +
      '`apps/api/src/admin-source/search.ts` and `exportEvidence` reaches the port through ' +
      '`adminReadSourceParts` rather than through `IMPLEMENTED_ADMIN_READS`, so counting off ' +
      'that array alone undercounts by one. WHAT IS LEFT IS THE PORT: `readLiability` has no ' +
      'module, so `apps/api/src/start.ts` calls ' +
      'no setter and `setAdminReadSource` is still in `wiring.test.ts`s BLOCKED list. A ' +
      'partial port composed to unblock this screen would throw at the first request to the ' +
      'liability home',
  },
  {
    origin: 'ADR-171',
    title: 'An operator session, which is the principal every admin read resolves',
    blockedBy:
      'no admin identity provider. ADR-171 finding 4 measured that no table in the registry ' +
      'holds an operator, a role or an operator session, so `setAdminSessionSource` has no ' +
      'supplier in this repository. MEASURED, because WAVE-06 section 8.1 predicts a 503 and ' +
      'neither branch of this endpoint produces one: with no admin session cookie it answers ' +
      '401 `unauthenticated`, and with one it answers 500 `internal_error`. THIS SCREEN IS ' +
      'WHERE A PAYOUT DECISION GETS EXPLAINED, in M06 section 3.2 own words, and INV-M6-01 ' +
      'puts an audited actor behind every act taken from it: an access log with no actor is ' +
      'not a record of an access',
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
function accountDetailRead(subjectAccountId: string): AccountDetailRead {
  return { kind: 'unsupplied', subjectAccountId, blocked: BLOCKED_ON };
}

export default async function AccountDrillDownRoute({
  params,
}: {
  readonly params: Promise<{ readonly accountId: string }>;
}): Promise<ReactElement> {
  const { accountId } = await params;
  const read = accountDetailRead(accountId);
  if (read.kind === 'supplied') return renderAccountDetailDocument(read.page);

  return (
    <article data-testid="account-drill-down-unsupplied">
      <h1>Account drill-down</h1>
      <p data-testid="named-subject">
        {`Subject named by this page: ${read.subjectAccountId}. This screen is reachable only ` +
          'by naming a subject (M06 section 3.2, INV-M6-10).'}
      </p>
      <p data-testid="read-state">
        This console reads <code>/api/v1</code> on this origin and nothing else. The read that fills
        this page is not performed yet, and what is below is what blocks it rather than a
        placeholder for it: nothing about this account is invented while a supplier is missing.
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
