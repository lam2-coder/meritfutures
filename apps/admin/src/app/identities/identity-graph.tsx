// =============================================================================
// apps/admin/src/app/identities/identity-graph.tsx
// =============================================================================
// M06 SECTION 3.2a AS A DOCUMENT: ONE HUMAN, WHAT THEY HOLD, AND WHAT IS TRUE
// ACROSS ALL OF IT.
//
// -----------------------------------------------------------------------------
// 1. THIS IS THE ONE SCREEN IN THIS CONSOLE THAT HOLDS AN INV-M6-10 LICENCE,
//    AND THE LICENCE IS THE PATH PARAMETER
// -----------------------------------------------------------------------------
// `INV-M6-10`: the console renders trader-identifying data ONLY when the query
// names a specific subject. Every other surface here names none and renders
// none. This one names one, so it may render across the accounts that human
// holds, and M06 section 3.2a states the boundary in the same breath: "it is
// reachable only by naming a specific subject ... It is not a browse surface
// and there is no list behind it. A screen that aggregates one human is a
// convenience; a screen that aggregates humans is the bulk PII surface FM-M6-10
// exists to refuse, and the difference is ONE QUERY PARAMETER."
//
// SO THE LICENCE IS BOUNDED BY WHAT THE QUERY REACHED, AND THAT BOUND IS THE
// GUARD BELOW RATHER THAN A SENTENCE. `assertServedIdentityGraphStrings` refuses
// any subject identifier in the served bytes that the graph itself does not
// reach: the named subject, the root, the nodes and the two ends of each edge.
// An id outside that closure is a human the query did not name, arriving on the
// one screen whose licence would otherwise excuse it.
//
// AND THE ROOT IS CHECKED AGAINST THE PATH BEFORE ANYTHING IS RENDERED. A
// response whose `root.identity_id` is not the identity the URL asked for is a
// screen about somebody else under somebody's name, which is the worst shape
// this failure can take and the cheapest one to refuse.
//
// -----------------------------------------------------------------------------
// 2. THERE IS NO INDEX, NO SEARCH AND NO RECENT-IDENTITIES AFFORDANCE
// -----------------------------------------------------------------------------
// `src/app/identities/` holds this module and `[identityId]/page.tsx` and
// NOTHING ELSE. There is no `identities/page.tsx`, because that route is the
// list M06 section 3.2a says does not exist; there is no input, no form and no
// history here, because each is a way to reach a human without naming one.
// `FM-M6-10`'s own words are "a bulk PII surface hiding inside a convenience
// feature", and every one of those three is that convenience.
//
// `test/identity-render.test.ts` asserts all of it mechanically, by reading the
// directory and this module's source, because "we did not build a search box"
// is a claim that stays true until somebody helpful adds one.
//
// -----------------------------------------------------------------------------
// 3. NO RESTRICTION AFFORDANCE AND NO RESTORE AFFORDANCE
// -----------------------------------------------------------------------------
// M06 section 3.3a makes this screen one of the two v1 entry points for opening
// a restriction, and `INV-M6-14` makes the restriction and the restore both
// console actions with a complete record. NEITHER IS BUILT HERE AND NEITHER MAY
// BE. They are WRITES: `INV-M6-01` puts an audited action behind each, ADR-171's
// admin identity provider decides what an `admin_actions.actor` string IS, and
// WAVE-06 section 8 holds every mutating surface in wave 4 and later, which is
// not dispatched. A confirm control on this screen today would be a control with
// no actor to record, which is `INV-M6-14`'s record missing the field the whole
// invariant is about.
//
// -----------------------------------------------------------------------------
// 4. THE THREE MONEY FIELDS ARE A NAMED ABSENCE, AND INV-M6-04 IS WHY
// -----------------------------------------------------------------------------
// `IdentityGraph` carries `nodes[].total_withdrawable_cents`,
// `aggregate.open_liability_cents` and `aggregate.payouts_lifetime_cents`, AND
// IT CARRIES NO `as_of` AND NO SOURCE FOR ANY OF THEM. `INV-M6-04` makes a
// number without both a number this console may not render, and `../../
// figure.ts` is where that is a type rather than a habit.
//
// TWO MECHANISMS REFUSE IT AND EITHER WOULD BE ENOUGH. The contract carries no
// instant to put in `AsOf.instant`, and `figure.ts`'s `ORIGIN_ID` closes the
// admissible roster at `P-M6-01` to `P-M6-10` and `AS-M6-04`, which are section
// 3.1's panels: a figure raised on section 3.2a's screen has no origin it may
// declare. Widening that roster is an edit to `figure.ts` and adding an `as_of`
// is an edit to API_CONTRACT, and WAVE-06 rule 1 fences both out of this slice.
//
// SO THE SCREEN STATES THE ABSENCE WITH ITS OWNER, in `PendingPanel`'s shape,
// which is `page.ts`'s own vocabulary for exactly this and is what `src/app/
// page.tsx` uses one screen over. A drill-down that rendered an undated wallet
// position would be the confidently wrong figure `AS-M6-04` is about, on the
// screen an enforcement is decided from.
//
// -----------------------------------------------------------------------------
// 5. THE EDGE EVIDENCE IS NOT RENDERED
// -----------------------------------------------------------------------------
// M06 section 3.2a names what an edge shows: "the resolved graph edges with
// their KIND and CONFIDENCE". `evidence` is `Record<string, unknown>`, which is
// unbounded server-supplied content, and rendering it on the one screen holding
// a PII licence would put every key any detector ever writes onto a page whose
// guard can only refuse what it recognises. The module never reads the field and
// the suite asserts that from this file's own source, which is `M6-A-39`'s shape
// two screens over.
//
// -----------------------------------------------------------------------------
// 6. THE SWEEP IS THE ONE `../liability-home.tsx` SHIPS
// -----------------------------------------------------------------------------
// `collectServedStrings` walks the element tree and THROWS on a node it cannot
// resolve rather than skipping it. A second copy would be a second place to
// teach about a node kind. What this file adds is the entry point and the rule,
// which is section 1.

import type { ReactElement } from 'react';

import type { IdentityGraph } from '../../api/types.ts';
import { PageError, type PendingPanel } from '../../page.ts';
import { collectServedStrings } from '../liability-home.tsx';

/**
 * What the drill-down renders: the subject the QUERY named, and the graph.
 *
 * `subjectIdentityId` IS THE PATH PARAMETER AND IS CARRIED SEPARATELY FROM THE
 * RESPONSE ON PURPOSE. Reading the subject off `graph.root` would make the two
 * agree by construction and delete the check section 1 exists for: the licence
 * is what the OPERATOR asked for and the response is what the server sent, and
 * the screen is only sound while they are the same human.
 */
export type IdentityGraphPage = {
  readonly renderedAt: string;
  readonly subjectIdentityId: string;
  readonly graph: IdentityGraph;
};

/**
 * The figures this screen may not render, each named with what it waits on.
 *
 * IT IS A CONSTANT AND NOT A DERIVATION FROM THE RESPONSE, because the absence
 * is a property of the CONTRACT rather than of any particular payload: no
 * response to this endpoint carries an as-of, so no response can fill these.
 */
export const WITHHELD_FIGURES: readonly PendingPanel[] = [
  {
    origin: 'INV-M6-04',
    title: 'The wallet position and the two lifetime totals',
    blockedBy:
      'no as-of and no source on this response. `GET /admin/identities/:identityId/graph` ' +
      'declares `nodes[].total_withdrawable_cents`, `aggregate.open_liability_cents` and ' +
      '`aggregate.payouts_lifetime_cents` and carries no instant for any of them, where ' +
      '`GET /admin/liability` declares `as_of` as its first field. INV-M6-04 makes a number ' +
      'without its as-of and its source unrenderable here, and `../../figure.ts` closes its ' +
      'origin roster at P-M6-01 to P-M6-10 and AS-M6-04, which are M06 section 3.1 panels, so a ' +
      'figure raised on section 3.2a has no origin to declare either. API_CONTRACT is held by ' +
      '`W6-e` this wave and `figure.ts` is in no WAVE-06 fence at all, so this slice REPORTS ' +
      'both rather than taking either',
  },
  {
    origin: 'M06 section 3.2a',
    title: 'Flags, restriction episodes, admin actions and per-account state',
    blockedBy:
      'no field on this response. Section 3.2a names the identity, its status and status ' +
      'reason, every account WITH ITS STATE, the resolved edges, every flag, every restriction ' +
      'episode with its actor and its evidence, the wallet position and every admin action. ' +
      '`IdentityGraph` carries a status, an account COUNT and the edges. The rest has no field ' +
      'to read, and a screen that filled them from somewhere else would be inventing them',
  },
  {
    origin: 'ADR-171',
    title: 'The restriction and the restore, INV-M6-14',
    blockedBy:
      'no admin identity provider, and this is a WRITE rather than a gap. Section 3.3a makes ' +
      'this screen one of the two v1 entry points for opening a restriction, INV-M6-01 puts an ' +
      'audited `admin_actions` row behind it and ADR-171 decides what the `actor` string on that ' +
      'row IS. WAVE-06 section 8 holds every mutating surface behind that purchase. A confirm ' +
      'control here today would be a control with no actor to record',
  },
];

/**
 * Every identity id the query reached, which is the whole of this screen's
 * INV-M6-10 licence.
 *
 * THE SUBJECT IS IN IT BECAUSE THE PATH NAMED IT, and the graph's own members
 * are in it because M06 section 3.2a's screen IS that closure: "who is this
 * human, what do they hold, and what is currently true across all of it."
 * Anything else is a human the operator did not ask about.
 */
export function reachableIdentityIds(page: IdentityGraphPage): ReadonlySet<string> {
  const reachable = new Set<string>([page.subjectIdentityId, page.graph.root.identity_id]);
  for (const node of page.graph.nodes) reachable.add(node.identity_id);
  for (const edge of page.graph.edges) {
    reachable.add(edge.a);
    reachable.add(edge.b);
  }
  return reachable;
}

/** The uuid shape `../../page.ts` refuses on a screen that names no subject. */
const SUBJECT_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * The root the server answered with is the subject the operator asked about.
 *
 * FIRST, AND BEFORE A BYTE IS BUILT. Every other check here reads what was
 * rendered; this one refuses to render at all. An operator reading a graph
 * headed by the id they typed, whose rows belong to a different human, has been
 * handed the worst answer this endpoint can give and has no way to tell.
 */
export function assertRootIsTheNamedSubject(page: IdentityGraphPage): void {
  if (page.graph.root.identity_id !== page.subjectIdentityId)
    throw new PageError(
      'the identity graph returned a root that is not the identity this page named. ' +
        'INV-M6-10 renders trader-identifying data only when the query names a specific ' +
        'subject, and this response is about a subject the query did not name',
    );
}

/** One resolved link, with its kind and its confidence and nothing else. */
function EdgeRow({ edge }: { readonly edge: IdentityGraph['edges'][number] }): ReactElement {
  return (
    <li data-link-kind={edge.link_kind} data-confidence-bp={String(edge.confidence_bp)}>
      {`${edge.a} and ${edge.b}: ${edge.link_kind}, confidence ${String(edge.confidence_bp)} bp`}
    </li>
  );
}

/** One identity in the resolved cluster, with its status and its account count. */
function NodeRow({ node }: { readonly node: IdentityGraph['nodes'][number] }): ReactElement {
  return (
    <li data-identity-status={node.status} data-accounts={String(node.accounts)}>
      {`${node.identity_id}: ${node.status}, ${String(node.accounts)} accounts`}
    </li>
  );
}

/**
 * The whole document for one `IdentityGraphPage`.
 *
 * PURE, AND A FUNCTION OF THE VALUE ALONE. No clock, no environment, no read,
 * and no control: every element below is a heading, a list or a sentence.
 */
export function IdentityGraphDocument({
  page,
}: {
  readonly page: IdentityGraphPage;
}): ReactElement {
  const { graph } = page;

  return (
    <article data-testid="identity-drill-down" data-root-status={graph.root.status}>
      <h1>Identity drill-down</h1>

      <p data-testid="named-subject">
        {`Subject named by this page: ${page.subjectIdentityId}. Rendered at ${page.renderedAt}. ` +
          'This screen is reachable only by naming a subject and there is no list behind it ' +
          '(M06 section 3.2a, INV-M6-10).'}
      </p>

      <p data-testid="root-identity">
        {`${graph.root.identity_id}: ${graph.root.status}, ${String(graph.root.accounts)} accounts.`}
      </p>

      <section data-testid="cluster">
        <h2>The resolved cluster</h2>
        <p data-testid="aggregate">
          {`${String(graph.aggregate.identities)} identities holding ` +
            `${String(graph.aggregate.accounts)} accounts.`}
        </p>
        {graph.nodes.length === 0 ? (
          <p data-testid="no-nodes">
            The graph resolved no linked identities. That is a cluster of one and not a failed read.
          </p>
        ) : (
          <ul data-testid="node-rows">
            {graph.nodes.map((node) => (
              <NodeRow key={node.identity_id} node={node} />
            ))}
          </ul>
        )}
      </section>

      <section data-testid="edges">
        <h2>The resolved links, with their kind and confidence</h2>
        {graph.edges.length === 0 ? (
          <p data-testid="no-edges">The graph resolved no links between identities.</p>
        ) : (
          <ul data-testid="edge-rows">
            {graph.edges.map((edge) => (
              <EdgeRow key={`${edge.a}:${edge.b}:${edge.link_kind}`} edge={edge} />
            ))}
          </ul>
        )}
      </section>

      <section data-testid="withheld-figures">
        <h2>What this screen does not show, and what each waits on</h2>
        <ul>
          {WITHHELD_FIGURES.map((entry) => (
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
export function servedIdentityGraphStrings(page: IdentityGraphPage): readonly string[] {
  const served: string[] = [];
  collectServedStrings(<IdentityGraphDocument page={page} />, served);
  return served;
}

/**
 * `INV-M6-10` over what the browser receives, on the screen that HOLDS the
 * licence, which is why the rule here is a closure rather than a refusal.
 *
 * `assertNamesNoSubject` IS DELIBERATELY NOT CALLED, AND SAYING SO IS THE
 * POINT. That assertion refuses ANY subject identifier in a rendered string and
 * is exactly right for the four screens that name no subject. Calling it here
 * would refuse the identity the operator asked about, which is the one thing
 * this screen exists to render; the invariant is not "never render an id", it
 * is "render one only when the query names one". So the check is that every id
 * served is inside the closure the query reached, and it is STRICTLY NARROWER
 * than the licence rather than a relaxation of the other screens' rule.
 *
 * WHAT IT CATCHES THAT NOTHING ELSE DOES: a subject id arriving through
 * `root.status`, through `link_kind` or through any other server-supplied
 * string on a screen whose whole subject is trader-identifying data. That is
 * the same shape as the seed `W6-d` caught arriving through `movement.feed` and
 * the one `W6-f` caught arriving through `evidence_summary`, on the surface
 * where a permissive rule would have let it through.
 */
export function assertServedIdentityGraphStrings(page: IdentityGraphPage): readonly string[] {
  const served = servedIdentityGraphStrings(page);
  const reachable = reachableIdentityIds(page);

  for (const string of served)
    for (const match of string.matchAll(SUBJECT_ID))
      if (!reachable.has(match[0]))
        throw new PageError(
          `the identity drill-down served \`${match[0]}\`, which is not an identity this query ` +
            'reached. INV-M6-10 renders trader-identifying data only when the query names a ' +
            'specific subject. The licence of this screen is the subject it named and the ' +
            'graph that resolved from it, and an id from outside that closure is a human ' +
            'nobody asked about',
        );

  return served;
}

/**
 * The document, with the root checked and what it serves asserted before it is
 * served.
 *
 * THE ROUTE CALLS THIS AND NEVER `IdentityGraphDocument` DIRECTLY, so both
 * controls are on the path rather than in the suite.
 */
export function renderIdentityGraphDocument(page: IdentityGraphPage): ReactElement {
  assertRootIsTheNamedSubject(page);
  assertServedIdentityGraphStrings(page);
  return <IdentityGraphDocument page={page} />;
}
