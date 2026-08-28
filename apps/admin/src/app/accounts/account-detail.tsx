// =============================================================================
// apps/admin/src/app/accounts/account-detail.tsx
// =============================================================================
// M06 SECTION 3.2 AS A DOCUMENT: ONE ACCOUNT, AND WHY IT GOT THE OUTCOME IT GOT.
//
// -----------------------------------------------------------------------------
// 1. THIS SCREEN NAMES A SUBJECT, SO ITS INV-M6-10 RULE IS A CLOSURE AND NOT A
//    REFUSAL
// -----------------------------------------------------------------------------
// `INV-M6-10`: the console renders trader-identifying data ONLY when the query
// names a specific subject. The liability home, the flags queue and the event
// feed name none and `assertNamesNoSubject` refuses every subject identifier in
// their bytes. This screen names one in its PATH, so that assertion is
// deliberately not called here: it would refuse the account the operator asked
// about, which is the one thing this screen exists to render.
//
// SO THE RULE IS `W6-g`'s AND NOT `W6-f`'s: every id served must be one the
// query reached, rather than no id being served at all. The closure here is
// SMALLER than the identity drill-down's by an exact amount, and the reason is
// section 3 below: the response has no declared field, so nothing but the path
// parameter is ever rendered and the closure is that one id.
//
// -----------------------------------------------------------------------------
// 2. THE ROOT CANNOT BE CHECKED AGAINST THE PATH HERE, AND THE ABSENCE IS A
//    FINDING RATHER THAN AN OMISSION
// -----------------------------------------------------------------------------
// `../identities/identity-graph.tsx` refuses to render at all when
// `graph.root.identity_id` is not the identity the URL named, because that is
// the worst answer the endpoint can give and the cheapest to catch.
//
// THIS SCREEN HAS NO SUCH FIELD TO CHECK. `AdminAccountDetail.account` is
// `unknown`, so there is no declared `account_id` to compare with the path, and
// a check that reached into the section for a field name the contract never
// wrote would pass VACUOUSLY the day a server spelled it differently. A vacuous
// guard is worse than a stated absence, so the absence is stated: see
// {@link WITHHELD_SECTIONS}'s first entry, which names it where an operator
// reads it rather than only here.
//
// WHAT COVERS THE LEAK HALF IS STILL TIGHT. A response about the wrong account
// cannot be DETECTED, and it also cannot be SERVED: the closure below refuses
// every subject-shaped identifier that is not the path's own, and no field of
// the response is rendered.
//
// -----------------------------------------------------------------------------
// 3. NO FIELD OF THE RESPONSE IS RENDERED, BECAUSE THE CONTRACT DECLARES NONE
// -----------------------------------------------------------------------------
// `GET /admin/accounts/:accountId` IS THE ONE ADMIN READ API_CONTRACT SECTION 8
// DOES NOT TYPE. Its row is a sentence where every other row is a `ts` block,
// and `apps/api/src/routes/admin-reads.ts` says the same thing from the server's
// side: "THIS IS THE ONE ROUTE OF THE SEVEN THE CORPUS DOES NOT TYPE ... The
// field-level schema is a DEBT owed by whoever types the drill-down."
//
// SO WHAT THIS DOCUMENT RENDERS IS THE SECTION ROSTER AND THE SHAPE OF WHAT
// ARRIVED IN EACH, AND NEVER A MEMBER OF ONE. A field name read here would be
// this console designing the response and then believing it, which is exactly
// what `../../api/types.ts`'s discipline forbids one directory over.
//
// WHAT A SECTION MAY CONTRIBUTE IS ITS CARDINALITY AND THAT IS NOT A FIELD.
// Six of the eight sections are plural in the contract's own words ("every
// mark", "every rule state per day", "every event"), so "how many arrived" is a
// property of the collection rather than a name inside it, and it is the one
// honest thing this screen can say about a section today. It is the same
// licence `../identities/identity-graph.tsx` already takes when it renders
// `aggregate.identities` and `aggregate.accounts` as plain counts.
//
// -----------------------------------------------------------------------------
// 4. NOTHING IS RECOMPUTED, AND `gate_results` IS THE REASON THE RULE IS WRITTEN
//    DOWN
// -----------------------------------------------------------------------------
// M06 section 3.2: "the drill-down must show what every gate said on that day,
// FROM THE STORED ROW rather than from a recomputation, because a recomputation
// is an assertion and the stored row is a record."
//
// THIS MODULE COMPUTES NO VERDICT OF ANY KIND. It names no gate, derives no
// pass or fail, and reads no member of `rule_states`. Its suite asserts that
// from this file's own source with comments stripped, which is `W6-d`'s move for
// the trust verdict and `W6-f`'s for the queue ordering: a claim that a module
// does not recompute something is a claim about the CODE, and prose about it is
// what drifts.
//
// AND THE GATE VOCABULARY IS NOT SPELLED HERE EITHER. `gate_results` is not a
// table in this tree: `SD-06` split it into `rule_states.engine_gates` and
// `rule_states.context_gates`, which `apps/api/src/admin-source/evidence.ts`
// records at length. A console that hard-listed either would be the hand-listed
// drift `INV-M7-10` exists to prevent, arriving on a screen instead of in a pack.
//
// -----------------------------------------------------------------------------
// 5. NO FIGURE, AND THE REASON IS `../../figure.ts`'s ROSTER RATHER THAN TASTE
// -----------------------------------------------------------------------------
// `INV-M6-04` makes a number without its as-of AND its source unrenderable by
// this console, and `../../figure.ts` is where that is a type. Its `ORIGIN_ID`
// admits `P-M6-01` to `P-M6-10` and `AS-M6-04`, which are M06 SECTION 3.1's
// panels. This is section 3.2, so a figure raised here has no origin it may
// declare, and `GET /admin/accounts/:accountId` carries no `as_of` for one to
// cite anyway.
//
// THAT IS THE SAME PAIR OF MECHANISMS `W6-g` MET ON SECTION 3.2a AND IT IS
// REPORTED AGAIN RATHER THAN REPAIRED. Widening the roster is an edit to
// `figure.ts`, which no WAVE-06 fence holds; adding an `as_of` is an edit to
// API_CONTRACT. This module imports neither `../../figure.ts` nor
// `../../data-trust.ts` and its suite asserts both absences.
//
// -----------------------------------------------------------------------------
// 6. THE SWEEP IS THE ONE `../liability-home.tsx` SHIPS
// -----------------------------------------------------------------------------
// `collectServedStrings` walks the element tree and THROWS on a node it cannot
// resolve rather than skipping it. A second copy would be a second place to
// teach about a node kind. What this file adds is the entry point and the rule.

import type { ReactElement } from 'react';

import {
  ACCOUNT_DETAIL_SECTIONS,
  type AccountDetailSection,
  type AdminAccountDetail,
} from '../../api/types.ts';
import { PageError, type PendingPanel } from '../../page.ts';
import { collectServedStrings } from '../liability-home.tsx';

/**
 * What the drill-down renders: the subject the QUERY named, and the response.
 *
 * `subjectAccountId` IS THE PATH PARAMETER AND IS CARRIED SEPARATELY FROM THE
 * RESPONSE, which is `IdentityGraphPage`'s shape and is kept here for a reason
 * that is STRONGER on this screen rather than weaker: there is no field on the
 * response to read it off, so the operator's own parameter is the only statement
 * of who this page is about.
 */
export type AccountDetailPage = {
  readonly renderedAt: string;
  readonly subjectAccountId: string;
  readonly detail: AdminAccountDetail;
};

/**
 * What this screen does not show, each named with what it waits on.
 *
 * A CONSTANT AND NOT A DERIVATION FROM THE RESPONSE, because every entry is a
 * property of the CONTRACT rather than of a payload: no response to this
 * endpoint carries a field list, an as-of, or a root this page could check.
 */
export const WITHHELD_SECTIONS: readonly PendingPanel[] = [
  {
    origin: 'API_CONTRACT section 8',
    title: 'Every field of every section, and the root check that would need one',
    blockedBy:
      'no declared shape. `GET /admin/accounts/:accountId` is the one admin read in section 8 ' +
      'whose row is prose rather than a `ts` block: it names eight sections and declares no ' +
      'field inside any of them. So this screen renders the roster and what arrived in each, ' +
      'and never a member of one. TWO CONSEQUENCES RATHER THAN ONE. The first is that no value ' +
      'from this account is on this page. The second is that the root cannot be checked against ' +
      'the path the way the identity drill-down checks its own: there is no declared ' +
      '`account_id` to compare, and a check reaching for an undeclared field would pass ' +
      'vacuously the day a server spelled it differently. `apps/api/src/routes/admin-reads.ts` ' +
      'records the field-level schema as a DEBT owed by whoever types this drill-down, and ' +
      'API_CONTRACT is the file `W6-e` holds in this wave, and it is not in this fence',
  },
  {
    origin: 'INV-M6-04',
    title: 'Every money figure this screen would otherwise carry',
    blockedBy:
      'no as-of and no admissible origin. INV-M6-04 makes a number without both unrenderable ' +
      'here, this response carries no instant for any figure, and `../../figure.ts` closes its ' +
      'origin roster at P-M6-01 to P-M6-10 and AS-M6-04, which are M06 section 3.1 panels: a ' +
      'figure raised on section 3.2 has no origin to declare. TWO MECHANISMS AND EITHER WOULD ' +
      'BE ENOUGH, which is the same pair the identity drill-down met on section 3.2a. Widening ' +
      'the roster is an edit to `figure.ts` and adding an as-of is an edit to API_CONTRACT, and ' +
      'no WAVE-06 fence holds either',
  },
  {
    origin: 'WAVE-06 section 10 item 3',
    title: 'The rows themselves: no deployment composes `AdminReadSource`',
    blockedBy:
      'three of the port`s seven methods, and `readAccount` is no longer one of them. ADR-191 ' +
      'gave `events` the sixth scope class it needed, so it is a `TableKey` today and a handle ' +
      'naming it IS satisfied by `SystemTx`; `apps/api/src/admin-source/account.ts` supplies ' +
      'all eight sections and `IMPLEMENTED_ADMIN_READS` holds four names where this panel once ' +
      'read two. WHAT IS LEFT IS THE PORT AND NOT THE TABLE: `exportEvidence`, `readLiability` ' +
      'and `searchAccounts` have no module, so no value satisfies `AdminReadSource`, ' +
      '`apps/api/src/start.ts` calls no setter, and `setAdminReadSource` stays in ' +
      '`wiring.test.ts`s BLOCKED list. Composing a partial port would answer this screen and ' +
      'throw on the first request to one of the other three',
  },
  {
    origin: 'ADR-171',
    title: 'An operator session, which is the principal every admin read resolves',
    blockedBy:
      'no admin identity provider. ADR-171 finding 4 measured that no table in the registry ' +
      'holds an operator, a role or an operator session, so `setAdminSessionSource` has no ' +
      'supplier in this repository. MEASURED over a real `compose()` and the server ' +
      'injector, against `GET /api/v1/admin/accounts/:accountId`, because WAVE-06 section 8.1 ' +
      'predicts a 503 and neither branch produces one: with no admin session cookie this ' +
      'endpoint answers 401 `unauthenticated`, and with one it answers 500 `internal_error`. ' +
      'AND THIS SCREEN WAITS ON IT TWICE: M06 section 3.2 is where a payout decision gets ' +
      'explained and INV-M6-01 puts an audited actor behind every act taken from it, so an ' +
      'access log with no actor is not a record of an access',
  },
];

/** The uuid shape `../../page.ts` refuses on a screen that names no subject. */
const SUBJECT_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Every account id this query reached, which is the whole of this screen's
 * INV-M6-10 licence.
 *
 * ONE MEMBER, AND THE COUNT IS THE POINT RATHER THAN A SIMPLIFICATION. The
 * identity drill-down's closure grows with the graph its query resolved because
 * every member of that graph is a field the contract declares. This response
 * declares no field, so nothing widens this licence and the subject the operator
 * typed is the entirety of it.
 */
export function reachableAccountIds(page: AccountDetailPage): ReadonlySet<string> {
  return new Set<string>([page.subjectAccountId]);
}

/**
 * The response carries the contract's eight sections, no more and no fewer.
 *
 * FIRST, AND BEFORE A BYTE IS BUILT, which is `assertRootIsTheNamedSubject`'s
 * position one screen over. A section the contract does not name is a field that
 * reached an operator by default; a section it names and the response omits is a
 * drill-down that renders as a complete answer with a hole in it, which is the
 * failure that reads as success.
 *
 * THE SERVER MAKES THE SAME REFUSAL AND THIS IS NOT A SECOND COPY OF IT.
 * `projectAccountDetail` runs inside `apps/api` over the value a PORT returned;
 * this runs inside the console over the value a NETWORK returned, and the two
 * fail at different times on different machines. The console cannot assume its
 * own server answered: `../../http/client.ts` reads `/api/v1` on this origin and
 * a body is a body.
 */
export function assertSectionsAreTheContracts(page: AccountDetailPage): void {
  const named = new Set<string>(ACCOUNT_DETAIL_SECTIONS);
  const extra = Object.keys(page.detail).filter((key) => !named.has(key));
  if (extra.length > 0)
    throw new PageError(
      `the account drill-down carried ${extra.join(', ')}, which API_CONTRACT section 8 does ` +
        `not name. It names ${ACCOUNT_DETAIL_SECTIONS.join(', ')}, and a section nobody ` +
        'specified is a field that reached an operator by default',
    );
  for (const section of ACCOUNT_DETAIL_SECTIONS)
    if (!Object.hasOwn(page.detail, section))
      throw new PageError(
        `the account drill-down omitted \`${section}\`. Section 8 names it, and a drill-down ` +
          'missing a section renders as a complete answer with a hole in it',
      );
}

/**
 * What arrived in one section, said without naming anything inside it.
 *
 * THREE ANSWERS AND NOT TWO. A section the contract calls plural arrives as a
 * list and its length is a fact about the list; a section that arrived as
 * something else is reported AS something else rather than as zero, because
 * "0 entries" and "not a list" are different answers and only one of them is
 * about the account.
 */
function shapeOf(value: unknown): string {
  if (Array.isArray(value)) return `${String(value.length)} entries`;
  if (value === null) return 'null';
  return 'present, and not a list: the contract declares no shape for this section';
}

/** One section of the drill-down: its contract name and what arrived in it. */
function SectionRow({
  section,
  value,
}: {
  readonly section: AccountDetailSection;
  readonly value: unknown;
}): ReactElement {
  return (
    <li
      data-section={section}
    >{`${section}: ${shapeOf(value)}, and no field of it is rendered`}</li>
  );
}

/**
 * The whole document for one {@link AccountDetailPage}.
 *
 * PURE, AND A FUNCTION OF THE VALUE ALONE. No clock, no environment, no read,
 * and no control: every element below is a heading, a list or a sentence.
 */
export function AccountDetailDocument({
  page,
}: {
  readonly page: AccountDetailPage;
}): ReactElement {
  return (
    <article data-testid="account-drill-down">
      <h1>Account drill-down</h1>

      <p data-testid="named-subject">
        {`Subject named by this page: ${page.subjectAccountId}. Rendered at ${page.renderedAt}. ` +
          'This screen is reachable only by naming a subject (M06 section 3.2, INV-M6-10).'}
      </p>

      <p data-testid="one-question">
        This screen answers one question, which is why this account got this outcome. Every gate
        result it shows is read from the stored rule state for that day and never recomputed: a
        recomputation is an assertion and the stored row is a record (M06 section 3.2).
      </p>

      <section data-testid="sections">
        <h2>The sections this response carried</h2>
        <ul data-testid="section-rows">
          {ACCOUNT_DETAIL_SECTIONS.map((section) => (
            <SectionRow key={section} section={section} value={page.detail[section]} />
          ))}
        </ul>
      </section>

      <section data-testid="withheld-sections">
        <h2>What this screen does not show, and what each waits on</h2>
        <ul>
          {WITHHELD_SECTIONS.map((entry) => (
            <li key={entry.origin} data-origin={entry.origin}>
              {`[${entry.origin}] ${entry.title}: NOT BUILT, blocked by ${entry.blockedBy}`}
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}

/** Every string this document serves: each text node and each attribute value. */
export function servedAccountDetailStrings(page: AccountDetailPage): readonly string[] {
  const served: string[] = [];
  collectServedStrings(<AccountDetailDocument page={page} />, served);
  return served;
}

/**
 * `INV-M6-10` over what the browser receives, on a screen that HOLDS the
 * licence, which is why the rule is a closure rather than a refusal.
 *
 * `assertNamesNoSubject` IS DELIBERATELY NOT CALLED, and saying so is the point:
 * it refuses ANY subject identifier and is exactly right for the three screens
 * that name none. The invariant is not "never render an id", it is "render one
 * only when the query names one", so the check here is that every id served is
 * one the query reached, and it is STRICTLY NARROWER than the licence rather
 * than a relaxation of the other screens' rule.
 *
 * WHAT IT CATCHES THAT NOTHING ELSE DOES: an identifier arriving through a
 * section value on the one screen whose whole subject is trader-identifying
 * data. `shapeOf` renders a count and never a member, so the only route a
 * foreign id has onto this page is a defect, and this is where that defect
 * stops.
 */
export function assertServedAccountDetailStrings(page: AccountDetailPage): readonly string[] {
  const served = servedAccountDetailStrings(page);
  const reachable = reachableAccountIds(page);

  for (const string of served)
    for (const match of string.matchAll(SUBJECT_ID))
      if (!reachable.has(match[0]))
        throw new PageError(
          `the account drill-down served \`${match[0]}\`, which is not an account this query ` +
            'reached. INV-M6-10 renders trader-identifying data only when the query names a ' +
            'specific subject. The licence of this screen is the subject it named, and this ' +
            'response has no declared field that could widen it, so an id from outside that ' +
            'closure is a subject nobody asked about',
        );

  return served;
}

/**
 * The document, with the sections checked and what it serves asserted before it
 * is served.
 *
 * THE ROUTE CALLS THIS AND NEVER `AccountDetailDocument` DIRECTLY, so both
 * controls are on the path rather than in the suite.
 */
export function renderAccountDetailDocument(page: AccountDetailPage): ReactElement {
  assertSectionsAreTheContracts(page);
  assertServedAccountDetailStrings(page);
  return <AccountDetailDocument page={page} />;
}
