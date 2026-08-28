// =============================================================================
// apps/admin/src/app/search/page.tsx
// =============================================================================
// THE ACCOUNT SEARCH ROUTE, AT `/search`.
//
// -----------------------------------------------------------------------------
// WHY `/search` AND NOT `/accounts`
// -----------------------------------------------------------------------------
// `src/app/accounts/` publishes ONE route, the drill-down at
// `/accounts/[accountId]`, and `M6-A-66` in `test/account-render.test.ts`
// asserts that directory holds exactly `['[accountId]/', 'account-detail.tsx']`.
// A `page.tsx` added there would be `/accounts`, which is an index with no query
// behind it, which is `FM-M6-10`. That case states two reasons and says the
// second outlives the first; the second is the invariant and it is untouched by
// this slice. **THE FIRST HAS EXPIRED AND ITS REASON IS CORRECTED WHERE IT IS
// WRITTEN RATHER THAN WORKED AROUND HERE**: it reads that
// `AdminReadSource.searchAccounts` is owned by no plan, and session 371 wrote
// `apps/api/src/admin-source/search.ts`.
//
// So the search surface gets its own segment, and the directory that must not
// grow an index does not grow one.
//
// -----------------------------------------------------------------------------
// THIS ROUTE IS DYNAMIC BY DECLARATION AND NOT BY ACCIDENT
// -----------------------------------------------------------------------------
// Reading `searchParams` is already enough to mark an App Router segment
// dynamic, so the declaration below looks redundant. It is not, and session
// 368's finding one application over is the reason it is written: a segment
// whose load throws BEFORE it reaches a request-scoped API prerenders its
// failure screen instead, silently, with the build exiting 0. `apps/portal/src/
// app/payouts/page.ts` served a statically baked "unavailable" screen to every
// trader for exactly that reason, and the render mode was decided by whether an
// environment variable happened to be set in the build environment.
//
// A SEARCH RESULT IS THE LAST THING THAT MAY BE BAKED. It is a per-request
// answer about a named human, and a prerendered one would be one operator's
// query served to the next. The declaration makes the mode a property of the
// route rather than of a code path, and `pnpm --filter @merit/admin build`
// prints this route with the dynamic marker.
//
// -----------------------------------------------------------------------------
// THE TERM IS THE WHOLE PRECONDITION, AND THE NO-TERM ARM IS NOT AN ERROR
// -----------------------------------------------------------------------------
// An operator arriving at `/search` with no query has not made a mistake. They
// have arrived at the box. So the no-term arm renders the box and the six
// terms, and renders NO ROW AND NO REFUSAL MESSAGE, because there is nothing to
// refuse yet.
//
// WHAT IS REFUSED IS A PAGE VALUE WITH NO TERM ON IT, and that is one layer
// down in `assertQueryNamesASubject`. The distinction matters: this arm is a
// state a browser reaches, and that one is a defect a supplier would have to
// commit.
//
// A REPEATED PARAMETER IS REFUSED RATHER THAN RESOLVED. `?query=a&query=b`
// arrives as an array, and picking either half would be this route deciding
// which subject the operator meant.
//
// -----------------------------------------------------------------------------
// THIS ROUTE PERFORMS NO READ, AND NAMES NO ERROR KIND
// -----------------------------------------------------------------------------
// `ADR-190` ruling 3: an error kind is a value derived from a response this
// console received, and a route that performs no read has received none. The
// three screens before this one ship under that rule and `test/render.test.ts`
// asserts it over the whole `src/app/` directory, so this route inherits a
// control rather than a habit.
//
// **THE BLOCKED LIST IS ONE ENTRY, AND THAT IS THE MEASUREMENT THIS SLICE
// CONTRIBUTES.** The account drill-down names two, and its second is the port:
// "`exportEvidence`, `readLiability` and `searchAccounts` have no module".
// TWO OF THOSE THREE NOW HAVE ONE. `apps/api/src/admin-source/search.ts` is
// this screen's own adapter and landed with session 371, `exportEvidence`
// reached `AdminReadSource` through `adminReadSourceParts` in pull request
// #490, and `readLiability` is the one method left. So the port is still
// uncomposed and this screen still cannot read, but the reason has moved from
// three unwritten modules to one, and the entry says which.

import type { ReactElement } from 'react';

import type { PendingPanel } from '../../page.ts';
import {
  type AccountSearchPage,
  SearchForm,
  SearchTerms,
  renderAccountSearchDocument,
} from './account-search.tsx';

/**
 * Next renders this segment per request.
 *
 * See the header. It is a declaration rather than a consequence of reading
 * `searchParams`, so a future arm that throws before reaching the parameter
 * cannot quietly turn this route into a prerendered artifact.
 */
export const dynamic = 'force-dynamic';

/** A read that produced a result page, or the stated reason it could not. */
type AccountSearchRead =
  | { readonly kind: 'supplied'; readonly page: AccountSearchPage }
  | {
      readonly kind: 'unsupplied';
      readonly query: string;
      readonly blocked: readonly PendingPanel[];
    };

/**
 * What has to land before this route renders a row, named with its owner.
 *
 * ONE ENTRY. The liability home names three and the account drill-down names
 * two; this screen names one, because its own adapter is written and its own
 * contract row carries every field this document renders. What is left is the
 * principal, which is the blocker every screen in this console shares and the
 * only one no file in this repository can clear.
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
      'admin session cookie an operator route answers 401 `unauthenticated`, and with one it ' +
      'answers 500 `internal_error`, which is the status `apps/api/src/routes/admin-reads.ts` ' +
      'chose at the declaration of `AdminReadError`. AND IT BLOCKS THIS SCREEN TWICE. The read ' +
      'needs a principal, and INV-M6-10 needs the same principal a second time: every view of ' +
      'trader-identifying data is logged as an access to the underlying identities (M06 ' +
      'section 7.9), and there is no actor to write on that record. ' +
      '`assertAccessWasRecorded` in `./account-search.tsx` is where the second half is refused ' +
      'rather than assumed, so the day this arm is filled the audit lands with it',
  },
];

/**
 * The one query parameter, or `null`.
 *
 * A REPEATED PARAMETER IS `null` AND NOT ITS FIRST OR LAST VALUE. Next hands an
 * array for `?query=a&query=b`, and resolving it either way would be this route
 * choosing which subject an operator meant. `null` puts them back at the box
 * with what they typed still unsubmitted, which is the only answer that invents
 * nothing.
 *
 * IT TRIMS, BECAUSE THE SERVER TRIMS. `apps/api/src/routes/admin-reads.ts`
 * reads `raw.trim()` and refuses the empty result, so a term of spaces is not a
 * term there and must not become one here.
 */
export function readQueryTerm(value: string | readonly string[] | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The read.
 *
 * IT TAKES THE TERM AND RETURNS THE SAME ARM EVERY TIME TODAY. The parameter is
 * on the signature rather than waiting for a supplier, because the term is what
 * makes this screen lawful and a seam that did not carry it would be a seam the
 * next slice has to redesign. `../accounts/[accountId]/page.tsx` states the
 * same reason for the same shape.
 */
function accountSearchRead(query: string): AccountSearchRead {
  return { kind: 'unsupplied', query, blocked: BLOCKED_ON };
}

export default async function AccountSearchRoute({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const params = await searchParams;
  const query = readQueryTerm(params['query']);

  if (query === null)
    return (
      <article data-testid="account-search-no-term">
        <h1>Account search</h1>
        <SearchForm query="" />
        <SearchTerms />
        <p data-testid="read-state">
          Nothing is listed until a term names a subject. INV-M6-10 renders trader-identifying data
          only when the query names one, and an index with no query behind it is FM-M6-10, a bulk
          PII surface hiding inside a convenience feature. There is no browse here and there is no
          way to ask for everybody.
        </p>
      </article>
    );

  const read = accountSearchRead(query);
  if (read.kind === 'supplied') return renderAccountSearchDocument(read.page);

  return (
    <article data-testid="account-search-unsupplied">
      <h1>Account search</h1>
      <SearchForm query={read.query} />
      <SearchTerms />
      <p data-testid="read-state">
        This console reads <code>/api/v1</code> on this origin and nothing else. The read that
        answers this term is not performed yet, and what is below is what blocks it rather than a
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
