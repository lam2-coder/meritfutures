// =============================================================================
// apps/admin/src/app/feed/event-feed.tsx
// =============================================================================
// M06 SECTION 1.1's FIFTH SURFACE AS A DOCUMENT, IN BOTH OF `INV-M6-10`'s MODES,
// WITH THE INVARIANT ASSERTED OVER THE BYTES A BROWSER RECEIVES.
//
// -----------------------------------------------------------------------------
// 1. THE ASSERTION IS RE-POINTED AT THE SERVED BYTES, WHICH IS WHY THIS FILE
//    EXISTS AND NOT ONLY WHY IT IS TESTED
// -----------------------------------------------------------------------------
// WAVE-06 section 5.2, in its own words: `assertWithheld` in `../../feed.ts`
// "takes `readonly string[]`, produced by `renderFeed`", and "a React page
// renders a DOM, not a line array. If the document is built from the STRUCTURED
// value and the assertion is left reading the lines, the control stops covering
// the bytes an operator sees, and both suites stay green."
//
// THE FUNCTION IS NOT EDITED AND ITS INPUT IS. `assertWithheld` already takes a
// string array, `collectServedStrings` already produces one from a rendered
// node, and this module calls the first with the second. That is the same move
// `W6-d` made for `assertNamesNoSubject`: one control, pointed at the thing that
// reaches a browser rather than at a rendering nothing serves. `../../feed.ts`
// is a barrel leg and is outside this slice's fence besides, so re-pointing it
// at the call site is both the cheaper repair and the only one available here.
//
// -----------------------------------------------------------------------------
// 2. THE `Feed` THIS MODULE BUILDS IS A CONTROL AND IS NEVER THE RENDER SOURCE
// -----------------------------------------------------------------------------
// `buildFeed` SORTS, and the flags queue one directory over refuses to sort in
// terms: "a console that recomputes is a second opinion where the corpus
// requires one". API_CONTRACT's `GET /admin/events` row promises an order --
// `recorded_at` descending, ties broken on `id` -- and this document renders
// `response.data` in the order it arrived, mapping and never comparing.
//
// SO THE TWO USES ARE KEPT APART AND THE SEPARATION IS THE ARGUMENT. The rows
// on the page are the WIRE rows. The `Feed` is built beside them, its ORDER IS
// DISCARDED, and the only thing read off it is {@link Feed.withheldValues},
// which is order-independent. A rebuilt page rendered in a rebuilt order would
// be this console holding a second opinion about both the redaction and the
// timeline; a rebuilt page read only for what it would have withheld is
// defence in depth over an already-withheld body, which is ADR-184 section 6's
// own name for what this layer is for.
//
// AND ITS `complete` IS DISCARDED FOR A SHARPER REASON THAN ITS ORDER. `Feed
// .complete` is `rows.length < limit` and the contract's own signal is
// `next_cursor === null`. THEY DISAGREE ON THE PAGE THAT MATTERS: a page of
// exactly `limit` rows that exhausted the query carries `next_cursor: null` and
// computes `complete: false`. One of those two is a fact the server knows and
// the other is an inference from a row count, so this document renders the
// server's and states that it is the server's.
//
// -----------------------------------------------------------------------------
// 3. THE SENTINEL IS NOT A WITHHELD VALUE, AND FILTERING IT IS LOAD BEARING
// -----------------------------------------------------------------------------
// A withheld field arrives as the string `withheld` (`WITHHELD`), and the word
// is rendered ON PURPOSE: `FM-M6-01`, "a screenshot of a styled page pasted into
// a message loses the style and keeps the number", so a redaction that is a CSS
// class is a redaction a copy-paste undoes.
//
// `buildFeed` RUN OVER AN ALREADY-WITHHELD BODY THEREFORE COLLECTS THE SENTINEL
// ITSELF, because it is an identifying field whose value the scope does not
// license, and `assertWithheld` would then search the served bytes for the one
// string every obedient page is guaranteed to contain. **A control that refuses
// every page that obeyed the rule is not a control**, so the sentinel is dropped
// from the searched set and nothing else is.
//
// THAT DROPS NOTHING REAL AND THE ASYMMETRY IS THE POINT. Where the server
// withheld, the value never reached this console and there is nothing to search
// for. Where the server FAILED to withhold, the real identifier arrives, is
// collected by name, is not the sentinel, and is searched for in the bytes this
// document served. The leg only ever fires on the failure it exists for.
//
// -----------------------------------------------------------------------------
// 4. TWO LEGS, AND THEY FAIL AT DIFFERENT TIMES
// -----------------------------------------------------------------------------
// `apps/api/src/admin-source/index.ts` argues the shape for its own pair and it
// is the shape here: two controls are worth keeping when neither can catch the
// other's defect.
//
//   THE CLOSURE, over the served bytes. Every subject-shaped identifier served
//   must be one the query NAMED. Under `operational` the licensed set is EMPTY,
//   so the closure is a refusal; under a named scope it is the one subject.
//   `INV-M6-10`'s two modes are one rule with two licences here rather than two
//   rules, which is `../../feed.ts`'s `FeedScope` ruling adopted rather than
//   re-derived.
//
//   `assertWithheld`, over the same bytes. Every value THIS PACKAGE would have
//   withheld is absent from what was served, by value rather than by shape.
//
// WHAT EACH CATCHES THAT THE OTHER CANNOT. The closure catches an identifier
// arriving through a field nobody classified: a payload key that does NOT end
// `identity_id`, `event_name`, `subject_kind`, or any other server-supplied
// string. `assertWithheld` cannot see those, because `buildFeed` would not have
// withheld them either. `assertWithheld` catches an identifier that is NOT
// uuid-shaped -- `events.identity_id` is `uuid` but a payload key ending
// `account_id` is `jsonb` and may hold any string -- which the closure's pattern
// cannot match. Neither subsumes the other and both are kept.
//
// `assertNamesNoSubject` IS DELIBERATELY NOT CALLED, AND SAYING SO IS THE POINT,
// which is `../identities/identity-graph.tsx`'s reason arriving on a screen that
// holds the licence only SOMETIMES. It refuses ANY subject identifier in a
// rendered string, which is exactly right on the four screens that name none and
// exactly wrong on this one's two named arms, where the subject the operator
// asked about is the thing the screen exists to render. The closure is what
// covers the `operational` arm instead, and it is STRICTLY WIDER there than
// `assertNamesNoSubject` would have been: session 344 measured that pattern as
// `\b`-anchored, so `linked_to_<uuid>` passes it, and the pattern below is not
// anchored and refuses that string.
//
// A THIRD COPY OF THE UUID PATTERN LANDS HERE AND IT IS REPORTED RATHER THAN
// DENIED. `../../page.ts` holds one and `../identities/identity-graph.tsx` holds
// the second. The shape that closes it is one exported pattern on `../../page
// .ts`, which is `P5-l`'s file and is named by no fence in WAVE-06, so this
// slice reports the duplication instead of reaching for the file. The two copies
// are deliberately identical in text so a diff between them is legible, which is
// ADR-184 section 6's own instruction for the redaction rule it duplicated.
//
// -----------------------------------------------------------------------------
// 5. THE PAYLOAD IS NOT RENDERED, AND THAT IS A DECISION RATHER THAN AN OVERSIGHT
// -----------------------------------------------------------------------------
// `AdminEventItem.payload` is `Record<string, unknown>`: UNBOUNDED
// SERVER-SUPPLIED CONTENT, on the admin surface whose unfiltered page IS the
// bulk identity read. `../identities/identity-graph.tsx` refuses `edge.evidence`
// on that ground and `../../feed.ts`'s own `renderRow` renders no payload
// either, so this is one refusal already made twice rather than a third rule.
//
// AND THE PAYLOAD IS EXACTLY WHERE THE THIRD-PARTY IDENTIFIER LIVES.
// `packages/db/src/scope.ts` records it as one of the two reasons `events`
// cannot be scoped at all: `kyc.dedupe_hit` carries `matched_identity_id` and
// `identity.merged` carries `merged_identity_id`, so a row whose own tenancy
// column is correct still names a DIFFERENT identity inside `jsonb`. The server
// withholds those by the shape of the key and this document does not render
// them at all, which are two independent answers to one hazard.
//
// WHAT AN OPERATOR LOSES IS STATED RATHER THAN GLOSSED. `../../feed.ts`'s header
// says the operational mode should leave "enough to read `a payout hold was
// released by expiry at 04:00`", and the event name, the two instants, the
// subject kind and the actor carry exactly that. A payload rendering that an
// incident actually needed would be a slice with a FIELD LIST behind it, drawn
// from `docs/architecture/EVENTS.md`'s catalogue, which is a different piece of
// work from a timeline and is not started here.
//
// -----------------------------------------------------------------------------
// 6. THE RESPONSE ECHOES A MODE AND NEVER A SUBJECT, SO THE QUERY IS ON THE PAGE
// -----------------------------------------------------------------------------
// `EventFeedResponse.scope` is `EventFeedQuery["scope"]`: it says WHICH of
// `INV-M6-10`'s modes produced the body and never which subject was named. A
// console cannot learn its licence from the response alone, so the page carries
// the query it issued and {@link assertScopeIsTheOneAsked} refuses a body whose
// echoed mode is not the one the query asked for -- FIRST, before a byte is
// built, which is `assertRootIsTheNamedSubject`'s position one screen over and
// for its reason: an operator reading a page headed by the mode they asked for,
// whose rows were served under a different one, has been handed the worst answer
// this endpoint can give and has no way to tell.
//
// -----------------------------------------------------------------------------
// 7. NO READ, NO ORIGIN, NO WRITE, AND NO SECOND VALIDATOR
// -----------------------------------------------------------------------------
// This module is a pure function of a value. `./page.tsx` is where a read would
// go and it performs none; `../../http/client.ts` is the one file in this
// package that may perform one at all.
//
// {@link licensedBy} IS NOT A SECOND COPY OF THE SERVER'S REQUEST VALIDATION.
// The server refuses a scope with no subject named and refuses a subject sent
// under a scope that does not name it (ADR-184 ruling 2), and this module
// re-checks neither. What it refuses is a query THIS CONSOLE would have issued
// that names no licence it can hold -- `scope=identity` with no `identity_id` on
// the page value -- because a licence it cannot compute is a licence it must not
// assume. That is a check on our own request rather than a restatement of the
// endpoint's.

import type { ReactElement } from 'react';

import type { AdminEventItem, EventFeedQuery, EventFeedResponse } from '../../api/types.ts';
import {
  type Feed,
  type FeedEvent,
  type FeedScope,
  WITHHELD,
  assertWithheld,
  buildFeed,
} from '../../feed.ts';
import { PageError } from '../../page.ts';
import { collectServedStrings } from '../liability-home.tsx';

/**
 * The page size the contract applies when a query names none.
 *
 * API_CONTRACT section 1: "Cursor only, never offset: `?limit=50&cursor=
 * <opaque>` ... `limit` maximum 100, default 25." It is transcribed here rather
 * than assumed because {@link buildFeed} refuses a page it cannot check against
 * the limit that ran, and a console that guessed would be checking a page
 * against a number nobody promised.
 */
export const CONTRACT_LIMIT_DEFAULT = 25;

/**
 * What the event feed renders: the response, the query that produced it, and
 * the instant.
 *
 * `query` IS ON THE PAGE BECAUSE THE RESPONSE ECHOES A MODE AND NOT A SUBJECT.
 * See section 6 of this header. Without it a named arm has no way to say which
 * identity its licence is for, and a screen whose licence is unknown is a
 * screen that renders under the widest reading of it.
 *
 * `renderedAt` IS SUPPLIED RATHER THAN READ FROM A CLOCK, which is `../../page
 * .ts`'s refusal of an ambient one inherited by having nothing else to read.
 */
export type EventFeedPage = {
  readonly renderedAt: string;
  readonly query: EventFeedQuery;
  readonly response: EventFeedResponse;
};

/**
 * The order the rows are in, as a sentence an operator reads before the rows.
 *
 * A CONSTANT AND NOT A DERIVATION, which is the flags queue's rule and its
 * reason: computing it from the rows would be the console describing the order
 * it observed, and this is a statement of the order the endpoint promises. When
 * they disagree the two instants are on every row and the operator can tell.
 */
export const FEED_ORDER =
  'Ordered by the server: `recorded_at` descending, ties broken on `id`. This is the ' +
  'operational timeline, so it is what we LEARNED in the order we learned it, and a late ' +
  'vendor correction about Tuesday belongs at the top of Thursday rather than buried in ' +
  'Tuesday. `occurred_at` is when the fact happened and both are on every row, so a row whose ' +
  'two instants diverge says so where it sits.';

/**
 * What `INV-M6-10` licenses this page to render, from the query it issued.
 *
 * THE EMPTY SET IS THE `operational` MODE AND NOT A MISSING ANSWER. The
 * invariant renders trader-identifying data only when the query names a
 * specific subject; a query that names none licenses nothing, which is one rule
 * with two licences rather than two rules.
 */
export function licensedBy(query: EventFeedQuery): ReadonlySet<string> {
  if (query.scope === 'operational') return new Set<string>();
  const subject = query.scope === 'identity' ? query.identity_id : query.account_id;
  if (subject === undefined || subject === '')
    throw new PageError(
      `the event feed was asked for \`scope=${query.scope}\` and the query names no subject, so ` +
        'this page has no INV-M6-10 licence it can compute. A named scope with no subject named ' +
        'is the widest query wearing a narrow label, and a licence that cannot be computed is ' +
        'not one that may be assumed',
    );
  return new Set<string>([subject]);
}

/** The uuid shape `../../page.ts` refuses on a screen that names no subject. */
const SUBJECT_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * The body was served under the mode the query asked for.
 *
 * FIRST, AND BEFORE A BYTE IS BUILT. Every other check here reads what was
 * rendered; this one refuses to render at all. A page whose rows were produced
 * under `operational` and whose header says `identity` is a redaction claim
 * about the wrong query, and one produced under a named scope and headed
 * `operational` is a licence nobody asked for.
 */
export function assertScopeIsTheOneAsked(page: EventFeedPage): void {
  if (page.response.scope !== page.query.scope)
    throw new PageError(
      `the event feed asked for \`scope=${page.query.scope}\` and the response was served under ` +
        `\`scope=${page.response.scope}\`. INV-M6-10 turns on which mode produced a page, so a ` +
        'body served under a mode the query did not ask for is a redaction claim about a ' +
        'different query',
    );
}

/**
 * The wire row as `../../feed.ts` reads one.
 *
 * A TRANSCRIPTION AND NOT A PROJECTION: every field is carried across and none
 * is dropped, renamed in meaning, or defaulted. The two shapes differ only in
 * case, because one is a JSON body and the other is this package's own value.
 */
function asFeedEvent(item: AdminEventItem): FeedEvent {
  return {
    id: item.id,
    eventName: item.event_name,
    occurredAt: item.occurred_at,
    recordedAt: item.recorded_at,
    identityId: item.identity_id,
    accountId: item.account_id,
    subjectKind: item.subject_kind,
    subjectId: item.subject_id,
    payload: item.payload,
    actorKind: item.actor_kind,
    actorId: item.actor_id,
    correlationId: item.correlation_id,
  };
}

/** The query's scope as `../../feed.ts`'s closed union. */
function asFeedScope(query: EventFeedQuery): FeedScope {
  const licensed = [...licensedBy(query)];
  if (query.scope === 'operational') return { kind: 'operational' };
  const subject = licensed[0] ?? '';
  return query.scope === 'identity'
    ? { kind: 'identity', identityId: subject }
    : { kind: 'account', accountId: subject };
}

/**
 * This package's own application of `INV-M6-10`, kept for its withheld set
 * alone.
 *
 * SECTIONS 2 AND 3 OF THIS HEADER ARE THE WHOLE OF WHY THIS IS SHAPED AS IT IS:
 * the order and the completeness it computes are discarded, and the sentinel is
 * dropped from the set because a control that refuses every obedient page is not
 * a control.
 */
export function controlFeed(page: EventFeedPage): Feed {
  const built = buildFeed({
    rows: page.response.data.map(asFeedEvent),
    scope: asFeedScope(page.query),
    limit: page.query.limit ?? CONTRACT_LIMIT_DEFAULT,
    readAt: page.renderedAt,
  });
  return { ...built, withheldValues: built.withheldValues.filter((value) => value !== WITHHELD) };
}

/** One event, in the order it arrived, with both instants and the mark in the words. */
function EventRow({
  item,
  position,
}: {
  readonly item: AdminEventItem;
  readonly position: number;
}): ReactElement {
  const parts = [
    `${String(position)}. ${item.recorded_at} ${item.event_name}`,
    `subject ${item.subject_kind} ${item.subject_id}`,
    `actor ${item.actor_kind}${item.actor_id === null ? '' : ` ${item.actor_id}`}`,
    `identity ${item.identity_id ?? 'none'}`,
    `account ${item.account_id ?? 'none'}`,
    `occurred ${item.occurred_at}`,
  ];
  // THE MARK IS A WORD AND NOT ONLY AN ATTRIBUTE, which is FM-M6-01 rather than
  // style: an operator who pastes this row into a message keeps the sentence
  // and loses every `data-` attribute on it.
  if (item.withheld) parts.push('some identifying values on this row are withheld under INV-M6-10');
  if (item.instants_incoherent)
    parts.push('INCOHERENT: recorded before it occurred, which cannot be true');
  if (item.correlation_id !== null) parts.push(`thread ${item.correlation_id}`);
  return (
    <li
      data-position={String(position)}
      data-event-name={item.event_name}
      data-withheld={String(item.withheld)}
      data-instants-incoherent={String(item.instants_incoherent)}
    >
      {parts.join(' | ')}
    </li>
  );
}

/** What the header says this page is, in each of `INV-M6-10`'s two modes. */
export function scopeSentence(query: EventFeedQuery): string {
  if (query.scope === 'operational')
    return (
      'operational, and the query named no subject: every identity and every account on every ' +
      'row is withheld, including keys ending `identity_id` inside a payload. INV-M6-10 renders ' +
      'trader-identifying data only when the query names a specific subject, and an unfiltered ' +
      'page of this table is the bulk identity screen that invariant says does not exist'
    );
  const subject = [...licensedBy(query)][0] ?? '';
  return (
    `${query.scope} ${subject}, which the query named: this subject renders and every other ` +
    'identity and account is withheld. The licence a named query earns is for the subject it ' +
    'named and for no other'
  );
}

/**
 * The whole document for one `EventFeedPage`.
 *
 * AN EMPTY FEED IS A SENTENCE AND NOT AN EMPTY LIST, which is the flags queue's
 * rule and its reason: a screen that renders nothing when there is nothing is
 * indistinguishable from a screen whose read failed, and this console's whole
 * subject is that the two are different states with different sentences.
 */
export function EventFeedDocument({ page }: { readonly page: EventFeedPage }): ReactElement {
  const { response } = page;
  return (
    <article
      data-testid="event-feed"
      data-rows={String(response.data.length)}
      data-scope={response.scope}
    >
      <h1>Event feed</h1>

      <p data-testid="feed-scope">{`Scope: ${scopeSentence(page.query)}.`}</p>

      <p data-testid="feed-order">{FEED_ORDER}</p>

      <p data-testid="render-stamp">
        {`Rendered at ${page.renderedAt}. ${String(response.data.length)} event(s) on this page, ` +
          'in the order the operator API returned them. ' +
          (response.next_cursor === null
            ? 'The server sent no next cursor, which is this query exhausted.'
            : 'The server sent a next cursor, so there are more events this read did not see. ' +
              'There is no total: ADR-157 refuses the aggregate and a page that displayed one ' +
              'would be displaying a number nothing in this system can obtain.')}
      </p>

      {response.data.length === 0 ? (
        <p data-testid="empty-feed">
          No events were returned for this query. That is an empty feed and not a failed read: a
          read that did not answer is reported as what it answered instead.
        </p>
      ) : (
        <ol data-testid="event-rows">
          {response.data.map((item, index) => (
            <EventRow key={item.id} item={item} position={index + 1} />
          ))}
        </ol>
      )}
    </article>
  );
}

/**
 * Every string this document serves: each text node and each attribute value.
 *
 * `key` IS NOT AMONG THEM AND THAT IS REACT'S RULE RATHER THAN A GAP. A `key`
 * is lifted off the props onto the element and is never serialised, so the `id`
 * this document uses as one reaches no byte a browser receives. It is the
 * response's own stable identifier for a row and `events.id` is a `bigint`
 * rather than a subject, so it would be admissible either way.
 */
export function servedEventFeedStrings(page: EventFeedPage): readonly string[] {
  const served: string[] = [];
  collectServedStrings(<EventFeedDocument page={page} />, served);
  return served;
}

/**
 * `INV-M6-10` over what the browser receives, in both modes, with two legs that
 * fail at different times.
 *
 * SECTION 4 OF THIS HEADER IS THE ARGUMENT AND THIS IS THE CODE. The closure is
 * the invariant stated once with two licences; `assertWithheld` is the value
 * check re-pointed at the served bytes, which is WAVE-06 section 5.2's whole
 * obligation for this slice.
 */
export function assertServedEventFeedStrings(page: EventFeedPage): readonly string[] {
  const served = servedEventFeedStrings(page);
  const licensed = licensedBy(page.query);

  for (const string of served)
    for (const match of string.matchAll(SUBJECT_ID))
      if (!licensed.has(match[0]))
        throw new PageError(
          `the event feed served \`${match[0]}\`, which is not a subject this query named. ` +
            'INV-M6-10 renders trader-identifying data only when the query names a specific ' +
            'subject, and the licence of this page is the subject it named and no other. An id ' +
            'from outside it is a human nobody asked about, arriving on the one admin surface ' +
            'whose unfiltered page IS the bulk identity read',
        );

  assertWithheld(controlFeed(page), served);
  return served;
}

/**
 * The document, with the echo checked and what it serves asserted before it is
 * served.
 *
 * THE ROUTE CALLS THIS AND NEVER `EventFeedDocument` DIRECTLY, so both controls
 * are on the path rather than in the suite. The suite is what proves they fire.
 */
export function renderEventFeedDocument(page: EventFeedPage): ReactElement {
  assertScopeIsTheOneAsked(page);
  assertServedEventFeedStrings(page);
  return <EventFeedDocument page={page} />;
}
