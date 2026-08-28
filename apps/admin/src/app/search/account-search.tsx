// =============================================================================
// apps/admin/src/app/search/account-search.tsx
// =============================================================================
// `GET /admin/accounts?query=` AS A DOCUMENT: THE SIX EXACT TERMS AN OPERATOR
// MAY NAME, AND THE ACCOUNTS THAT ANSWER TO ONE OF THEM.
//
// -----------------------------------------------------------------------------
// 1. THIS SCREEN CANNOT RENDER WITHOUT A TERM, AND THAT IS FM-M6-10 AS A
//    REFUSAL RATHER THAN AS A SENTENCE
// -----------------------------------------------------------------------------
// `FM-M6-10` is "search returns a result set that enumerates identities", whose
// consequence M06 section 6 writes as "a bulk PII surface hiding inside a
// convenience feature", and whose control is "search requires a specific
// subject term; result sets are capped and audited (INV-M6-10)".
//
// So an empty term is not an empty result on this screen. It is a refusal, in
// `assertQueryNamesASubject` below, which throws before a byte is built. THE
// SERVER ALREADY REFUSES THE SAME INPUT and this is not a second opinion about
// it: `apps/api/src/routes/admin-reads.ts` pushes a `validation_failed` on
// `query` when the trimmed term is empty, and that refusal is what protects the
// ENDPOINT, which is served on `ADMIN_ORIGIN` with no console in the path. This
// one protects the DOCUMENT, which is what an operator reads, and the two fail
// at different times: a document handed rows by a supplier that never consulted
// the route would render them, and the endpoint's guard cannot see that.
//
// `../accounts/account-detail.tsx`'s `M6-A-66` states the same rule from the
// other side, and its second reason is the one that outlives every fence:
// "an index with no query behind it is FM-M6-10". This directory is not that
// index. It publishes one route, that route renders no row until a term names a
// subject, and there is no list of accounts reachable from anywhere in this
// package without naming one.
//
// -----------------------------------------------------------------------------
// 2. SIX TERMS, NOT SEVEN, AND ADR-194 REMOVED THE SEVENTH RATHER THAN LEAVING
//    IT UNIMPLEMENTED
// -----------------------------------------------------------------------------
// {@link SEARCH_TERMS} is API_CONTRACT section 8's own sentence, transcribed.
// The name fragment that used to be its seventh form is gone from the contract,
// and the three reasons the contract gives are worth carrying to the screen
// because an operator who cannot find a person by name will otherwise assume
// the feature is broken: the estate holds no legal name at all,
// `identities.display_name` is a leaderboard handle `INV-M11-10` says is
// expressly not one, and a fragment cannot satisfy `INV-M6-10` because two
// people whose handles both contain the same letters share no subject.
//
// THE LIST IS PROSE AN OPERATOR READS AND IS NOT A VALIDATOR. Whether a term
// names a subject is a question only a lookup answers, which is `ADR-194`
// clause 4 and is why `apps/api/src/admin-source/search.ts` decides it by
// reading rather than by matching: `jo` is a legitimate exact coupon code, and
// a screen that refused it on its shape would refuse real work.
//
// -----------------------------------------------------------------------------
// 3. THE INV-M6-10 RULE HERE IS A CLOSURE, AND ITS ROOF IS THE TERM PLUS WHAT
//    THE TERM RETURNED
// -----------------------------------------------------------------------------
// The liability home, the flags queue and the event feed name no subject, and
// `assertNamesNoSubject` refuses every subject identifier in their bytes. THIS
// SCREEN NAMES ONE, so that assertion is deliberately not called here: it would
// refuse the accounts the operator asked about, which is the one thing this
// screen exists to render.
//
// The rule is `../identities/identity-graph.tsx`'s and it is applied to a
// different closure: every subject-shaped identifier this document serves must
// be the TERM ITSELF or an `account_id` or `identity_id` of a row THIS PAGE
// carries. An id outside that set is a human the query did not name, arriving
// through a field nobody classified as an identifier -- `plan_code`, `phase`
// and `status` are server-supplied strings and any of them can carry one.
//
// **A RESULT SET SPANNING SEVERAL HUMANS IS INSIDE THE LICENCE AND THAT IS
// RULED RATHER THAN ASSUMED.** M06 section 7.10: "naming a signal and listing
// the identities that share it IS a specific-subject query: the subject is the
// signal", and `ADR-194` clause 3 admits a coupon for exactly that reason,
// because many accounts share one and an incident is run from the code.
// `apps/api/src/admin-source/search.ts` fans a coupon out on that ruling.
// What `FM-M6-10` refuses is a result set with NO term above it, which is
// section 1.
//
// **THE CURSOR IS NEVER SERVED, AND THAT IS A CLASS OF LEAK REMOVED RATHER THAN
// GUARDED.** `next_cursor` is an opaque token the server composed from the page
// boundary, and session 371 records both its components as primary keys
// -- `(identity_id, account_id)` -- so the token is a subject identifier in an
// encoding this document's closure cannot read. It is not rendered at all. What
// the operator needs from it is the fact rather than the token, and
// `next_cursor === null` is that fact: the difference between an exhausted
// query and a full page, which is the honest pair API_CONTRACT section 9 puts
// in place of a `total` `ADR-157` refuses to compute.
//
// -----------------------------------------------------------------------------
// 4. THE THREE MONEY FIELDS ARE A NAMED ABSENCE, AND INV-M6-04 IS WHY
// -----------------------------------------------------------------------------
// `AdminAccountSearchItem` carries `size_cents`, `balance_cents` and
// `withdrawable_cents`, AND IT CARRIES NO `as_of` AND NO SOURCE FOR ANY OF
// THEM. `INV-M6-04` makes a number without both a number this console may not
// render, and `../../figure.ts` is where that is a type rather than a habit.
//
// TWO MECHANISMS REFUSE IT AND EITHER WOULD BE ENOUGH, which is the pair
// `../identities/identity-graph.tsx` met on section 3.2a and
// `../accounts/account-detail.tsx` met on section 3.2. The contract carries no
// instant to put in `AsOf.instant`, and `figure.ts`'s `ORIGIN_ID` closes the
// admissible roster at `P-M6-01` to `P-M6-10` and `AS-M6-04`, which are section
// 3.1's panels: a figure raised on a search result has no origin it may
// declare. Widening that roster is an edit to `figure.ts` and adding an `as_of`
// is an edit to API_CONTRACT, and this slice REPORTS both rather than taking
// either.
//
// `open_flags` IS RENDERED AND IT IS NOT AN EXCEPTION TO THAT RULE. It is a
// count of open flags rather than an amount of money, `INV-M6-04` is about the
// figures a page reports, and `../identities/identity-graph.tsx` already
// renders `aggregate.identities` and `aggregate.accounts` as plain counts on
// the same licence. A count carries no `Cents`, reaches no `figure()`, and
// cannot be misread as a liability.
//
// -----------------------------------------------------------------------------
// 5. THE ACCESS RECORD IS A REQUIRED FIELD, BECAUSE INV-M6-10's SECOND HALF IS
//    NOT OPTIONAL AND HAS NOWHERE ELSE TO LIVE
// -----------------------------------------------------------------------------
// M06 section 7.9 is where the requirement is written -- "every view is logged
// as an access to the underlying identities" -- and its stated reason is this
// screen's fact pattern rather than the graph's alone: "an investigator
// browsing the graph is reading personal data across many people". Section 3.2a
// and section 7.10 each bind their own surface to it, in section 7.9's terms,
// and a coupon term that fans out across identities is the same kind of read.
//
// THIS PACKAGE CANNOT WRITE THAT RECORD. `ADR-171` finding 4 measured that no
// table in the registry holds an operator, so there is no actor to record and
// an access log with no actor is not a record of an access.
//
// So {@link AccountSearchPage.accessRecord} is required, is refused blank, and
// says what was recorded. THE POINT IS THE OBLIGATION RATHER THAN THE STRING: a
// slice that fills this route's `supplied` arm cannot construct the page value
// without stating the record, so the audit lands with the read instead of
// after it. It is `AbsentFigure.reason`'s idiom in `../../figure.ts`, applied
// where the same failure would otherwise be silent: "unavailable written by the
// schema is the same silence, spelled".
//
// -----------------------------------------------------------------------------
// 6. NO CONTROL A ROLE COULD NOT USE, BECAUSE THERE IS NO CONTROL AT ALL
// -----------------------------------------------------------------------------
// API_CONTRACT section 8 closes the roles at `owner`, `ops` and `readonly`, and
// `ADMIN_READ_ROLES` in `apps/api/src/routes/admin-reads.ts` is that whole set,
// so every role may perform this read and no row on this screen is visible to
// one role and not another.
//
// WHAT WOULD MAKE THIS SCREEN LIE IS A MUTATING CONTROL, and there is none.
// `POST /admin/accounts/:accountId/{freeze,unfreeze,close,note}` are section 8's
// four writes against an account and this module names not one of them:
// `INV-M6-09` gives `readonly` no mutation at all, `INV-M6-01` puts an audited
// actor behind every write, and `ADR-171` is why no actor exists. A freeze
// button rendered here would be disabled for one of the three roles and broken
// for all three. The suite asserts the absence from this file's own source.
//
// THE ONE CONTROL THIS SCREEN DOES CARRY IS A `GET` FORM, which is a read
// affordance and is how a term reaches the route at all. It posts nothing,
// carries no state, and needs no client bundle.
//
// -----------------------------------------------------------------------------
// 7. THE ENVELOPE IS SECTION 1's AND IS NOT TRANSCRIBED IN `../../api/types.ts`,
//    WHICH IS A MEASUREMENT RATHER THAN AN OVERSIGHT
// -----------------------------------------------------------------------------
// Section 8's row for this endpoint types `AdminAccountSearchItem` and stops.
// The envelope comes from section 1, "responses carry `{ data, next_cursor }`",
// and `apps/api/src/routes/admin-reads.ts` serves exactly that through its own
// `AdminPage<AdminAccountSearchItem>`.
//
// TWO OF THE THREE CURSOR-PAGINATED ADMIN READS TYPE ONLY THEIR ITEM, DERIVED
// BY READING THE CONTRACT: `GET /admin/accounts?query=` and `GET /admin/flags`
// declare an item apiece, and `GET /admin/events` is the one that declares
// `EventFeedResponse`. So `../flags/flags-queue.tsx` already holds the shape of
// its own page rather than importing an envelope, and this file does the same.
// Declaring an `AccountSearchResponse` in `../../api/types.ts` would be this
// console designing a response and then believing it, which that file's own
// discipline forbids. The asymmetry is REPORTED and API_CONTRACT is nobody's
// fence in this slice.
//
// -----------------------------------------------------------------------------
// 8. THE SWEEP IS THE ONE `../liability-home.tsx` SHIPS
// -----------------------------------------------------------------------------
// `collectServedStrings` walks the element tree and THROWS on a node it cannot
// resolve rather than skipping it. A second copy would be a second place to
// teach about a node kind. What this file adds is the entry point and the rule.

import type { ReactElement } from 'react';

import type { AdminAccountSearchItem } from '../../api/types.ts';
import { PageError } from '../../page.ts';
import { collectServedStrings } from '../liability-home.tsx';

/**
 * What the account search renders: the term, the rows it reached, and whether
 * the answer was exhausted.
 *
 * `rows` IS THE RESPONSE'S ORDER AND CARRIES NO SECOND ORDERING FIELD, which is
 * `../flags/flags-queue.tsx`'s rule for the same reason: there is no `sortKey`
 * and no comparator for a caller to set, so a screen that wanted a different
 * order would have to be a different screen. Session 371 fixed that order at
 * `(identity_id, account_id)` ascending and its early stop depends on
 * `identity_id` being the FIRST key, so an order composed here would be a
 * second answer that can silently disagree with the one the cursor was cut on.
 *
 * `renderedAt` IS SUPPLIED RATHER THAN READ FROM A CLOCK, which is `../../
 * page.ts`'s refusal of an ambient one inherited by having nothing else to
 * read.
 */
export type AccountSearchPage = {
  readonly renderedAt: string;
  /** The exact subject term the operator named. Never blank: see section 1. */
  readonly query: string;
  readonly rows: readonly AdminAccountSearchItem[];
  /**
   * Section 1's envelope. `null` is an EXHAUSTED QUERY and a token is a FULL
   * PAGE, and the token itself is never served: section 3 of the header.
   */
  readonly nextCursor: string | null;
  /**
   * What was recorded about this view, as an access to the identities below.
   *
   * REQUIRED AND REFUSED BLANK. Section 5 of the header: `INV-M6-10`'s second
   * half is an access log and this package has no actor to write one with, so
   * the obligation is carried on the value that cannot be built without it.
   */
  readonly accessRecord: string;
};

/**
 * The six exact terms, API_CONTRACT section 8's own sentence.
 *
 * A CONSTANT AND NOT A DERIVATION FROM ANYTHING THIS CONSOLE CAN SEE. The terms
 * are a property of the endpoint, `apps/api/src/admin-source/search.ts` is what
 * implements them, and a list computed here from a response would be the
 * console describing the answers it happened to get.
 */
export const SEARCH_TERMS: readonly string[] = [
  'account id',
  'platform ref',
  'email',
  'identity id',
  'coupon',
  'payout id',
];

/**
 * Why a person's name is not among them, in the contract's own three reasons.
 *
 * IT IS ON THE SCREEN RATHER THAN IN A COMMENT because the operator who reaches
 * for it is the reason `ADR-194` had to rule: a term that is simply missing
 * reads as a feature that is broken, and the honest answer is that the data
 * does not exist to search.
 */
export const NO_NAME_TERM =
  'A name is not one of them, and it was removed from the contract rather than left ' +
  'unimplemented (ADR-194). Merit stores no legal name at all: kyc_verifications keeps a ' +
  'provider applicant id as the only pointer, and payout_transfers keeps whether a name ' +
  'matched rather than the names compared. identities.display_name is a leaderboard handle ' +
  'that INV-M11-10 says is expressly not a legal name. And a fragment cannot satisfy ' +
  'INV-M6-10: a coupon is a subject and the accounts that redeemed it share it, where two ' +
  'people whose handles contain the same letters share nothing.';

/**
 * The figures this screen may not render, each named with what it waits on.
 *
 * IT IS A CONSTANT AND NOT A DERIVATION FROM THE ROWS, which is
 * `../identities/identity-graph.tsx`'s reason and holds here unchanged: the
 * absence is a property of the CONTRACT rather than of any particular payload,
 * so no response to this endpoint can fill it.
 */
export const WITHHELD_FIGURES: readonly {
  readonly origin: string;
  readonly title: string;
  readonly blockedBy: string;
}[] = [
  {
    origin: 'INV-M6-04',
    title: 'The plan size, the balance and the withdrawable amount on every row',
    blockedBy:
      'no as-of and no source on this response. `GET /admin/accounts?query=` declares ' +
      '`size_cents`, `balance_cents` and `withdrawable_cents` and carries no instant for any ' +
      'of them, where `GET /admin/liability` declares `as_of` as its first field. INV-M6-04 ' +
      'makes a number without its as-of and its source unrenderable here, and `../../figure.ts` ' +
      'closes its origin roster at P-M6-01 to P-M6-10 and AS-M6-04, which are M06 section 3.1 ' +
      'panels, so a figure raised on a search result has no origin to declare either. The two ' +
      'refusals are independent and this slice REPORTS both rather than taking either: widening ' +
      'the roster is an edit to `figure.ts` and adding an as-of is an edit to API_CONTRACT. ' +
      'THE BALANCE HAS A SECOND REASON MEASURED BY SESSION 371 AND IT SURVIVES THE FIRST TWO: ' +
      'an account the engine has not evaluated has no rule_states row, the adapter answers zero ' +
      'for it because the contract types the field with no null, and a zero balance rendered ' +
      'beside a real one is indistinguishable from a measured empty account',
  },
];

/**
 * A subject-shaped identifier, unanchored.
 *
 * THE PATTERN IS `../identities/identity-graph.tsx`'s AND THE ABSENCE OF WORD
 * BOUNDARIES IS DELIBERATE, on session 348's finding in `../../page.ts`:
 * removing an assertion from a regex can only ADD matches, and a uuid glued to
 * a word character is the spelling a leak arrives in.
 */
const SUBJECT_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * The identifiers this query reached: the term, and the two ids on every row.
 *
 * THE TERM IS IN THE SET BECAUSE IT IS WHAT THE OPERATOR NAMED, which is the
 * licence this screen renders under. `../identities/identity-graph.tsx` puts
 * `subjectIdentityId` in its own closure for the identical reason.
 */
export function reachableSubjectIds(page: AccountSearchPage): ReadonlySet<string> {
  const reachable = new Set<string>([page.query]);
  for (const row of page.rows) {
    reachable.add(row.account_id);
    reachable.add(row.identity_id);
  }
  return reachable;
}

/**
 * FM-M6-10, refused before a byte is built.
 *
 * FIRST, AND BEFORE EVERY OTHER CHECK HERE. The others read what was rendered;
 * this one refuses to render at all, because a result set with no term above it
 * is the bulk PII surface rather than a screen with a cosmetic gap.
 */
export function assertQueryNamesASubject(page: AccountSearchPage): void {
  if (page.query.trim() === '')
    throw new PageError(
      'the account search was handed a page with no term. FM-M6-10: a result set that ' +
        'enumerates identities is a bulk PII surface hiding inside a convenience feature, and ' +
        'INV-M6-10 renders trader-identifying data only when the query names a specific ' +
        'subject. An empty term is refused rather than answered with every account',
    );
}

/**
 * `INV-M6-10`'s access log, asserted present on the value rather than hoped for.
 *
 * Section 5 of the header. Blank is refused for `../../figure.ts`'s reason: a
 * required string nobody filled is the same silence as a missing field, spelled.
 */
export function assertAccessWasRecorded(page: AccountSearchPage): void {
  if (page.accessRecord.trim() === '')
    throw new PageError(
      'the account search was handed a page that records nothing about the view. INV-M6-10: ' +
        'every view of trader-identifying data is logged as an access to the underlying ' +
        'identities (M06 section 7.9). ADR-171 finding 4 measured that no table in ' +
        'this registry holds an operator, so there is no actor to record and an access log ' +
        'with no actor is not a record of an access. The read arm of this screen lands with ' +
        'that record or it does not land',
    );
}

/** Whether the frozen state on a row came from the account or from the human. */
export const PAYOUTS_FROZEN_SCOPE =
  'payouts_frozen is resolved by the server and is true when the ACCOUNT is frozen OR the ' +
  'IDENTITY is, which M05 ExternalGates declares and session 371 watched: a row can read ' +
  'frozen while accounts.payouts_frozen on that same row is false, because the human is ' +
  'restricted. An operator reading it as an account-level flag would unfreeze the account and ' +
  'find nothing changed.';

/** The order the rows arrive in, as a sentence an operator reads before them. */
export const RESULT_ORDER =
  'Ordered by the server: identity_id ascending, then account_id ascending, both primary ' +
  'keys. A page boundary therefore cannot move under a concurrent write, so paging this ' +
  'result returns every account exactly once. next_cursor is null when the answer is ' +
  'exhausted and carries a token when it is not; there is no total, because ADR-157 refuses ' +
  'the scalar aggregate on the read path and a count nobody can compute is not shown.';

/**
 * One row.
 *
 * THE TWO IDS ARE ON LINKS AND THE THREE AMOUNTS ARE ON NEITHER. Both routes
 * exist in this package -- `../accounts/[accountId]` and
 * `../identities/[identityId]` -- so an id here is the id belonging on the
 * link that `../../page.ts` names when it refuses one in a figure. The amounts
 * are section 4 of the header.
 */
function ResultRow({
  row,
  position,
}: {
  readonly row: AdminAccountSearchItem;
  readonly position: number;
}): ReactElement {
  return (
    <li
      data-position={String(position)}
      data-status={row.status}
      data-phase={row.phase}
      data-open-flags={String(row.open_flags)}
      data-payouts-frozen={String(row.payouts_frozen)}
      data-recon-blocked={String(row.recon_blocked)}
    >
      <a href={`/accounts/${row.account_id}`}>{`Account ${row.account_id}`}</a>{' '}
      <a href={`/identities/${row.identity_id}`}>{`Identity ${row.identity_id}`}</a>
      <p>
        {`${row.email}. Plan ${row.plan_code}, phase ${row.phase}, status ${row.status}. ` +
          `${String(row.open_flags)} open flag${row.open_flags === 1 ? '' : 's'}. ` +
          `Payouts frozen: ${String(row.payouts_frozen)}. ` +
          `Reconciliation blocked: ${String(row.recon_blocked)}.`}
      </p>
    </li>
  );
}

/**
 * The term box.
 *
 * A `GET` FORM AND NOTHING ELSE. It carries no method attribute because `get`
 * is the HTML default and writing it would invite the next reader to change it;
 * the suite asserts no `post` reaches this file instead, which fires on the
 * change rather than on the spelling. It is exported because BOTH arms of the
 * route render it -- an operator who searched wants to search again -- and one
 * definition is the alternative to two that drift.
 */
export function SearchForm({ query }: { readonly query: string }): ReactElement {
  return (
    <form action="/search" data-testid="search-form">
      <label htmlFor="query">Name one exact subject</label>
      <input id="query" name="query" defaultValue={query} />
      <button type="submit">Search</button>
    </form>
  );
}

/** The terms, and why a name is not one of them. Both arms of the route show it. */
export function SearchTerms(): ReactElement {
  return (
    <section data-testid="search-terms">
      <h2>What may be named</h2>
      <ul>
        {SEARCH_TERMS.map((term) => (
          <li key={term} data-term={term}>
            {term}
          </li>
        ))}
      </ul>
      <p data-testid="no-name-term">{NO_NAME_TERM}</p>
    </section>
  );
}

/**
 * The whole document for one `AccountSearchPage`.
 *
 * PURE, AND A FUNCTION OF THE VALUE ALONE. No clock, no environment and no
 * read, which is `../liability-home.tsx`'s property inherited by having nothing
 * else to read.
 */
export function AccountSearchDocument({
  page,
}: {
  readonly page: AccountSearchPage;
}): ReactElement {
  return (
    <article data-testid="account-search" data-exhausted={String(page.nextCursor === null)}>
      <h1>Account search</h1>

      <SearchForm query={page.query} />
      <SearchTerms />

      <p data-testid="render-stamp">
        {`Rendered at ${page.renderedAt}. ${String(page.rows.length)} row` +
          `${page.rows.length === 1 ? '' : 's'} for the term below.`}
      </p>
      <p data-testid="query-term">{`Searched: ${page.query}`}</p>
      <p data-testid="result-order">{RESULT_ORDER}</p>
      <p data-testid="access-record">{`Access recorded: ${page.accessRecord}`}</p>

      {page.rows.length === 0 ? (
        <p data-testid="empty-result">
          No account answers to that term. An empty answer is what this endpoint returns for a
          subject nothing in the estate holds, and it is not an error: a payout id from another
          system and a coupon nobody redeemed both look like this.
        </p>
      ) : (
        <ol data-testid="results">
          {page.rows.map((row, index) => (
            <ResultRow key={row.account_id} row={row} position={index + 1} />
          ))}
        </ol>
      )}

      <p data-testid="payouts-frozen-scope">{PAYOUTS_FROZEN_SCOPE}</p>

      <section data-testid="withheld-figures">
        <h2>What this screen does not show</h2>
        <ul>
          {WITHHELD_FIGURES.map((entry) => (
            <li key={entry.origin} data-origin={entry.origin}>
              {`[${entry.origin}] ${entry.title}: WITHHELD, because ${entry.blockedBy}`}
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}

/**
 * Every string this document serves: each text node and each attribute value.
 *
 * `key` IS NOT AMONG THEM AND THAT IS REACT'S RULE RATHER THAN A GAP, which
 * `../flags/flags-queue.tsx` states and its suite proves over real markup. Here
 * the `account_id` used as a key is served anyway, on the row's own link, so
 * nothing rests on the distinction.
 */
export function servedAccountSearchStrings(page: AccountSearchPage): readonly string[] {
  const served: string[] = [];
  collectServedStrings(<AccountSearchDocument page={page} />, served);
  return served;
}

/**
 * `INV-M6-10` over what the browser receives, on a screen whose query names a
 * subject.
 *
 * THREE LEGS, IN THE ORDER A FAILURE MATTERS. The term is checked first because
 * a page with no term may not be rendered at all; the access record second
 * because a page nobody logged may not be rendered either; and the closure
 * last, because it is the only one that has to read the bytes.
 *
 * THE CLOSURE IS STRICTLY WIDER THAN THE TWO ID FIELDS IT ADMITS, AND THE WIDTH
 * IS THE POINT. `email`, `plan_code`, `phase` and `status` are server-supplied
 * strings, so an identifier written into any of them reaches this screen
 * through a field nobody classified as one. That is the shape of the seed
 * `W6-d` caught arriving through `movement.feed`, and it is caught here by
 * reading every served string rather than the fields this document meant to
 * render.
 */
export function assertServedAccountSearchStrings(page: AccountSearchPage): readonly string[] {
  assertQueryNamesASubject(page);
  assertAccessWasRecorded(page);

  const served = servedAccountSearchStrings(page);
  const reachable = reachableSubjectIds(page);

  for (const string of served)
    for (const match of string.matchAll(SUBJECT_ID))
      if (!reachable.has(match[0]))
        throw new PageError(
          `the account search served \`${match[0]}\`, which is not a subject this query ` +
            'reached. INV-M6-10 renders trader-identifying data only when the query names a ' +
            'specific subject. The licence of this screen is the term the operator typed and ' +
            'the accounts that answered to it, and an id from outside that closure is a human ' +
            'nobody asked about',
        );

  return served;
}

/**
 * The document, with what it serves asserted before it is served.
 *
 * THE ROUTE CALLS THIS AND NEVER `AccountSearchDocument` DIRECTLY, so the
 * control is on the path rather than in the suite. The suite is what proves the
 * control fires; this is what puts it in front of an operator.
 */
export function renderAccountSearchDocument(page: AccountSearchPage): ReactElement {
  assertServedAccountSearchStrings(page);
  return <AccountSearchDocument page={page} />;
}
