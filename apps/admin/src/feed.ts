// =============================================================================
// apps/admin/src/feed.ts
// =============================================================================
// THE EVENT FEED. M06 section 1.1's FIFTH SURFACE, and EVENTS section 2's
// `FEED`: "renders the operational timeline".
//
// -----------------------------------------------------------------------------
// INV-M6-10 IS THIS SURFACE'S WHOLE PROBLEM, AND IT IS NOT THE LIABILITY PAGE'S
// -----------------------------------------------------------------------------
// "The admin console renders trader-identifying data only when the query names a
// specific subject", enforced by "no bulk export of identities exists as a UI
// affordance. Bulk is an audited export, not a screen (AS-M6-01)."
//
// `page.ts` satisfies that by having nothing to withhold: the liability home is
// an aggregate screen, so `assertNamesNoSubject` can refuse a UUID-shaped token
// outright. THE FEED CANNOT DO THAT AND MUST NOT PRETEND TO. `events` carries
// `identity_id` and `account_id` on most rows, so an unfiltered page of it IS a
// bulk read of identities rendered as a screen -- which is precisely the
// affordance INV-M6-10 says does not exist, and precisely the read-side risk
// AS-M6-05 names: "a read-only admin session and no write capability can still
// take the identity graph and a pack per account."
//
// So the feed has TWO MODES AND THEY ARE NOT THE SAME SURFACE.
//
//   operational      the query names NO subject. Every identity and account
//                    uuid is WITHHELD. What survives is the name, the two
//                    instants, the actor kind and the payload's non-identifying
//                    fields, which is enough to read "a payout hold was released
//                    by expiry at 04:00" and not enough to build a list of
//                    people.
//   subject-named    the query names one identity or one account. INV-M6-10's
//                    condition is met FOR THAT SUBJECT and its ids render.
//
// -----------------------------------------------------------------------------
// THE THIRD-PARTY UUID INSIDE THE PAYLOAD, WHICH IS WHY WITHHOLDING IS A RULE
// AND NOT A COLUMN LIST
// -----------------------------------------------------------------------------
// `packages/db/src/scope.ts` records this as one of the two reasons `events`
// cannot be scoped at all: "`kyc.dedupe_hit` carries `matched_identity_id` and
// `identity.merged` carries `merged_identity_id`, so a row whose own tenancy
// column is correct still names a DIFFERENT identity inside `jsonb`, WHICH NO
// SCOPE RULE CAN EXPRESS and which INV-M4-06 forbids the portal to receive."
//
// A SCOPE RULE CANNOT EXPRESS IT AND A RENDERER CAN, which is the one thing this
// layer is better placed to do than the accessor. So the rule is on the SHAPE OF
// THE KEY -- any payload key ending `identity_id` or `account_id` -- rather than
// on a list of columns, and `matched_identity_id` and `merged_identity_id` are
// covered by construction rather than by having been thought of. In
// subject-named mode the named subject's own id renders and a DIFFERENT
// identity's does not, because the query named one subject and INV-M6-10's
// licence is for that one.
//
// -----------------------------------------------------------------------------
// A WITHHOLDING IS RENDERED IN THE TEXT, ON FM-M6-01'S ARGUMENT
// -----------------------------------------------------------------------------
// `page.ts`: "A style cannot do that, because a screenshot of a styled page
// pasted into a message loses the style and keeps the number." A redaction that
// is a CSS class is a redaction a copy-paste undoes, so every withheld value is
// the word `withheld` IN THE LINE. And it is withheld VISIBLY rather than
// dropped: a row with no identity shown must not read as a row with no identity
// involved, which is `figure.ts`'s `absent` reasoning applied to an id.
//
// -----------------------------------------------------------------------------
// THE AGGREGATE IS REFUSED ON EVIDENCE
// -----------------------------------------------------------------------------
// ADR-157 admitted a RANGE term, an `IS NULL` term and a ROW lock to the
// accessor and refused the aggregate. So a feed that wants a count COUNTS THE
// ROWS IT READ: `shown` is `rows.length` and there is NO `total` field to reach
// for, on `liability.ts`'s structural argument that a caller cannot reach for a
// convenient figure that does not exist. A page that displayed "1 of 40,912"
// would be displaying a number nothing in this deployable can obtain.
//
// `complete` IS THE HALF THAT KEEPS `shown` HONEST. A full page is
// indistinguishable from an exhausted query unless the reader is told, and an
// operator who believes a truncated page is the whole story during an incident
// is the failure this field exists against.
//
// -----------------------------------------------------------------------------
// TWO INSTANTS, TWO ORDERS, AND NEITHER IS PICKED SILENTLY
// -----------------------------------------------------------------------------
// EVENTS section 1: "`occurred_at` is when the fact happened (often a session
// close, not the insert time). `recorded_at` is when we learned it. Corrections
// make these differ, and analytics that confuse them will silently lie."
//
// THE FEED ORDERS BY `recordedAt`, because it is the operational timeline and
// what an operator watching an incident needs is what we LEARNED, in the order
// we learned it. A late vendor webhook about a fact from Tuesday must appear at
// the top of the feed on Thursday; ordered by occurrence it would be buried in
// Tuesday where nobody is looking. Ties break on `id`, which is
// `bigint GENERATED ALWAYS AS IDENTITY` and the only total order this
// append-only table has.
//
// {@link thread} ORDERS THE OTHER WAY AND SAYS SO. A saga is a sequence of
// facts, so "checkout through provisioning, or request through settlement"
// (EVENTS section 1) reads in occurrence order. Two orders, two reasons, and
// both stated rather than one of them assumed.
//
// -----------------------------------------------------------------------------
// AN INCOHERENT ROW IS MARKED AND RENDERED, WHICH IS NOT WHAT `liability.ts` DOES
// -----------------------------------------------------------------------------
// `theThreeNumbers` REFUSES an incoherent snapshot, because "a dashboard that
// renders an incoherent book is the confident wrong answer with a source
// citation attached". That is right for an AGGREGATE, where one bad input
// corrupts the answer. It is wrong for a LIST, where one bad row is one bad row
// and refusing the page blanks an operator's timeline during the incident the
// bad row is evidence of. So a row claiming we learned a fact before it happened
// is flagged and rendered, and the divergence is on the line.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE DELIBERATELY DOES NOT CONTAIN
// -----------------------------------------------------------------------------
// NO SECOND PII CHECK. `apps/api/src/events.ts` refuses an email-shaped value at
// write time, which is where EVENTS section 1's rule belongs, and this package
// cannot import that one (`RI-04`: no app depends on an app). A re-implemented
// check here would be ADR-092 section 5's two-statements-of-one-fact hazard, and
// the copy that drifted would be the one nobody was reading.
//
// NO ROLE MATRIX. INV-M6-09's negative-authz suite is "one per mutating route
// per role, ENUMERATED FROM THE ROUTER", this surface mutates nothing and there
// is no router, and section 8.1a fixes `M6-N-09` as where that enumeration
// starts. INV-M6-10 is the control that applies here and its licence is the
// QUERY naming a subject rather than a role holding a privilege.
// =============================================================================

import { type AdminRole, ADMIN_ROLES } from './roles.ts';

/** Thrown when a feed cannot be built, or when building it would break INV-M6-10. */
export class FeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeedError';
  }
}

/** What a withheld value renders as. In the text, per FM-M6-01. */
export const WITHHELD = 'withheld';

// -----------------------------------------------------------------------------
// The input: one `events` row as this deployable receives it
// -----------------------------------------------------------------------------

/**
 * One row of `events` (`0017_events_and_audit.sql`).
 *
 * `id` IS A STRING BECAUSE THE COLUMN IS `bigint`, and a `number` would lose the
 * ordering this file breaks its ties on somewhere past 2^53. It is compared as a
 * `BigInt` and never parsed as a float.
 *
 * BOTH INSTANTS ARE PRESENT AND NEITHER IS OPTIONAL. Dropping `recordedAt` at
 * the boundary is how the divergence EVENTS section 1 warns about becomes
 * invisible one layer before anyone could see it.
 */
export interface FeedEvent {
  readonly id: string;
  readonly eventName: string;
  /** When the fact happened. ISO-8601. */
  readonly occurredAt: string;
  /** When we learned it. ISO-8601. */
  readonly recordedAt: string;
  readonly identityId: string | null;
  readonly accountId: string | null;
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly actorKind: string;
  readonly actorId: string | null;
  readonly correlationId: string | null;
}

/**
 * What the query named, which is what INV-M6-10 turns on.
 *
 * A CLOSED UNION AND NO DEFAULT. A feed whose scope could be omitted would
 * default to one of these, and either default is wrong: defaulting to
 * `operational` silently redacts a drill-down, and defaulting the other way
 * hands a bulk screen the licence a named query earns.
 */
export type FeedScope =
  | { readonly kind: 'operational' }
  | { readonly kind: 'identity'; readonly identityId: string }
  | { readonly kind: 'account'; readonly accountId: string };

/** What the feed was asked for. */
export interface FeedInput {
  readonly rows: readonly FeedEvent[];
  readonly scope: FeedScope;
  /**
   * The page size the query was issued with.
   *
   * REQUIRED, because {@link Feed.complete} is not derivable without it and a
   * page whose completeness is unknown is a page that gets read as complete.
   */
  readonly limit: number;
  /** When the page was read. Passed in rather than taken from a clock, on `page.ts`'s rule. */
  readonly readAt: string;
}

// -----------------------------------------------------------------------------
// The output
// -----------------------------------------------------------------------------

/** One event, with INV-M6-10 already applied to every field of it. */
export interface FeedRow {
  readonly id: string;
  readonly eventName: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  /** `null` where the row carried none; {@link WITHHELD} where it did and the scope does not admit it. */
  readonly identityId: string | null;
  readonly accountId: string | null;
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly actorKind: string;
  readonly actorId: string | null;
  readonly correlationId: string | null;
  /** The payload with every identifying key replaced by {@link WITHHELD}. */
  readonly payload: Readonly<Record<string, unknown>>;
  /**
   * Whether anything on this row was withheld.
   *
   * ON THE ROW RATHER THAN ON THE PAGE, because a reader deciding whether to
   * open the drill-down needs to know that THIS row has more behind it, and a
   * page-level flag answers a different question.
   */
  readonly withheld: boolean;
  /**
   * We learned it before it happened, which cannot be true.
   *
   * Rendered rather than refused. See the header.
   */
  readonly instantsIncoherent: boolean;
}

/**
 * A page of the feed.
 *
 * THERE IS NO `total` AND THERE IS NO WAY TO ADD ONE WITHOUT COUNTING ROWS
 * NOBODY READ. ADR-157 refused the aggregate on the accessor and this is the
 * same refusal arriving where a reader would want to reach around it.
 */
export interface Feed {
  readonly scope: FeedScope;
  readonly rows: readonly FeedRow[];
  /** `rows.length`. Counted, never claimed. */
  readonly shown: number;
  /** Whether this page exhausted the query, or is a truncation of it. */
  readonly complete: boolean;
  readonly readAt: string;
  /**
   * Every value INV-M6-10 kept off this page.
   *
   * KEPT SO THE SURFACE CAN ASSERT ABOUT ITS OWN OUTPUT ({@link assertWithheld}),
   * which is `page.ts`'s `assertNamesNoSubject` idiom: a control the page checks
   * survives a later field being added carelessly, and a comment does not.
   */
  readonly withheldValues: readonly string[];
}

// -----------------------------------------------------------------------------
// Building one
// -----------------------------------------------------------------------------

/** Whether a payload key names an identity or an account, whosever it is. */
export function namesASubject(key: string): boolean {
  return key.endsWith('identity_id') || key.endsWith('account_id');
}

/** The ids this scope's query named, and therefore the only ones it licenses. */
function admitted(scope: FeedScope): readonly string[] {
  if (scope.kind === 'identity') return [scope.identityId];
  if (scope.kind === 'account') return [scope.accountId];
  return [];
}

/** An instant, or a refusal. There is no lenient parse and no fallback to now. */
function instant(value: string, what: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed))
    throw new FeedError(
      `${what} is ${JSON.stringify(value)}, which is not a parseable instant. A feed row whose ` +
        'time cannot be read cannot be placed in a timeline, and placing it anywhere anyway is ' +
        'how a late correction ends up rendered as the newest thing that happened',
    );
  return parsed;
}

/** The row's order key. `bigint` in the column, so `BigInt` here and never a float. */
function order(id: string): bigint {
  if (!/^[0-9]+$/.test(id))
    throw new FeedError(
      `an event id is ${JSON.stringify(id)}. \`events.id\` is \`bigint GENERATED ALWAYS AS ` +
        'IDENTITY` and is the only total order this append-only table has, so a value that is ' +
        'not one leaves two rows with no defined order between them',
    );
  return BigInt(id);
}

/**
 * A page of the feed, with INV-M6-10 applied.
 *
 * THE WITHHOLDING HAPPENS HERE AND NOT AT RENDER, so a caller that renders the
 * structure some other way -- a JSON response, an export, a test -- gets the
 * same redaction. A control that lived only in the string formatter would be a
 * control the second consumer walks around without noticing.
 */
export function buildFeed(input: FeedInput): Feed {
  if (!Number.isSafeInteger(input.limit) || input.limit <= 0)
    throw new FeedError(
      `the page size is ${JSON.stringify(input.limit)}. It is what \`complete\` is derived from, ` +
        'and a page whose completeness cannot be derived is a page that gets read as complete',
    );
  if (input.rows.length > input.limit)
    throw new FeedError(
      `the query was issued with a limit of ${input.limit} and ${input.rows.length} rows came ` +
        'back. Either the limit is not the one that ran or the read returned more than it was ' +
        'asked for, and both make `complete` a claim about something that did not happen',
    );

  const licensed = new Set(admitted(input.scope));
  const withheldValues = new Set<string>();

  /** Redact an identifying value the scope does not license. */
  const gate = (value: string | null): string | null => {
    if (value === null) return null;
    if (licensed.has(value)) return value;
    withheldValues.add(value);
    return WITHHELD;
  };

  const rows = input.rows
    .map((row): FeedRow => {
      const occurred = instant(row.occurredAt, `${row.eventName}'s \`occurred_at\``);
      const recorded = instant(row.recordedAt, `${row.eventName}'s \`recorded_at\``);
      order(row.id);

      const identityId = gate(row.identityId);
      const accountId = gate(row.accountId);
      // THE SUBJECT IS GATED ONLY WHERE IT IS A PERSON OR AN ACCOUNT. A
      // `payout_request` subject is a handle to an object and is the link target
      // the operator clicks through to; withholding it would leave a feed nobody
      // can act on while protecting nothing INV-M6-10 is about.
      const subjectId =
        row.subjectKind === 'identity' || row.subjectKind === 'account'
          ? (gate(row.subjectId) ?? row.subjectId)
          : row.subjectId;

      const payload: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row.payload))
        payload[key] =
          namesASubject(key) && typeof value === 'string' ? (gate(value) ?? value) : value;

      const withheld = [identityId, accountId, subjectId, ...Object.values(payload)].some(
        (value) => value === WITHHELD,
      );

      return {
        id: row.id,
        eventName: row.eventName,
        occurredAt: row.occurredAt,
        recordedAt: row.recordedAt,
        identityId,
        accountId,
        subjectKind: row.subjectKind,
        subjectId,
        actorKind: row.actorKind,
        // `actor_id` IS AN OPERATOR STRING AND NOT A TRADER. `admin_actions.actor`
        // is the precedent and `events.actor_id` is `text`, so it is not an
        // identity uuid and INV-M6-10 does not reach it.
        actorId: row.actorId,
        correlationId: row.correlationId,
        payload,
        withheld,
        instantsIncoherent: recorded < occurred,
      };
    })
    .sort((left, right) => {
      const byRecorded =
        instant(right.recordedAt, 'recorded_at') - instant(left.recordedAt, 'recorded_at');
      if (byRecorded !== 0) return byRecorded;
      const leftId = order(left.id);
      const rightId = order(right.id);
      return rightId > leftId ? 1 : rightId < leftId ? -1 : 0;
    });

  return {
    scope: input.scope,
    rows,
    shown: rows.length,
    complete: rows.length < input.limit,
    readAt: input.readAt,
    withheldValues: [...withheldValues],
  };
}

/**
 * One saga, in the order its facts happened.
 *
 * EVENTS section 1: "Every multi-step flow carries a `correlation_id` so a saga
 * reads as one thread." A feed that rendered the column as an opaque uuid and
 * offered no way to follow it would be carrying the field's cost and none of its
 * value.
 *
 * ORDERED BY OCCURRENCE, WHICH IS NOT THE FEED'S ORDER, and the difference is
 * the point: the feed answers "what have we learned" and a thread answers "what
 * happened, in what order". A correction that arrived late belongs at the top of
 * the first and in its own place in the second.
 *
 * IT FILTERS THE PAGE AND ISSUES NO READ. The rows outside this page are not
 * here and are not counted, which is the aggregate refusal again: a thread built
 * from one page is a thread as far as this page saw it, and {@link Feed.complete}
 * is how a reader knows whether that is the whole of it.
 */
export function thread(feed: Feed, correlationId: string): readonly FeedRow[] {
  return feed.rows
    .filter((row) => row.correlationId === correlationId)
    .sort((left, right) => {
      const byOccurred =
        instant(left.occurredAt, 'occurred_at') - instant(right.occurredAt, 'occurred_at');
      if (byOccurred !== 0) return byOccurred;
      const leftId = order(left.id);
      const rightId = order(right.id);
      return leftId > rightId ? 1 : leftId < rightId ? -1 : 0;
    });
}

// -----------------------------------------------------------------------------
// Rendering, and the control the surface asserts about its own output
// -----------------------------------------------------------------------------

/**
 * Whether a role may read the feed. All three may.
 *
 * `roles.ts`' own argument for the liability home, and the same shape: "the
 * function exists rather than the constant `true` because the call site is where
 * a future reader looks for the answer, and because a page whose access rule is
 * unwritten is a page whose access rule gets assumed."
 *
 * THE CORPUS NAMES NO NARROWER RULE AND ONE IS NOT INVENTED HERE. API_CONTRACT
 * section 8 closes the set at three and gives `readonly` "read"; AS-M6-05's
 * read-side risk is bounded on this surface by INV-M6-10's withholding rather
 * than by a role. A feed restricted to `owner` would be a control this session
 * chose, and the place to choose it is the contract.
 */
export function mayReadEventFeed(role: AdminRole): boolean {
  return (ADMIN_ROLES as readonly AdminRole[]).includes(role);
}

/** One feed row as a line. Every withheld value carries the word, per FM-M6-01. */
export function renderRow(row: FeedRow): string {
  const parts = [
    row.recordedAt,
    row.eventName,
    `${row.subjectKind} ${row.subjectId}`,
    `actor ${row.actorKind}${row.actorId === null ? '' : ` ${row.actorId}`}`,
    `identity ${row.identityId ?? 'none'}`,
    `account ${row.accountId ?? 'none'}`,
  ];
  if (row.occurredAt !== row.recordedAt) parts.push(`occurred ${row.occurredAt}`);
  if (row.instantsIncoherent)
    parts.push('INCOHERENT: recorded before it occurred, which cannot be true');
  if (row.correlationId !== null) parts.push(`thread ${row.correlationId}`);
  return parts.join(' | ');
}

/**
 * The page, as lines.
 *
 * THE HEADER SAYS WHAT THE PAGE IS AND WHAT IT IS NOT, in the text: which scope
 * it was read under, how many rows were COUNTED, and whether that is all of
 * them. A truncated page that does not say so is the confident wrong answer
 * `AS-M6-04` is about, arriving as a list instead of as a number.
 */
export function renderFeed(feed: Feed): readonly string[] {
  const scope =
    feed.scope.kind === 'operational'
      ? 'operational, no subject named: every identity and account is withheld (INV-M6-10)'
      : feed.scope.kind === 'identity'
        ? `identity ${feed.scope.identityId}`
        : `account ${feed.scope.accountId}`;
  return [
    `Event feed | scope: ${scope} | read at ${feed.readAt}`,
    feed.complete
      ? `${feed.shown} event(s), which is all of them for this query`
      : `${feed.shown} event(s) shown, and the page is FULL: there are more this read did not see`,
    ...feed.rows.map(renderRow),
  ];
}

/**
 * The control, asserted against the produced lines.
 *
 * `page.ts`'s `assertNamesNoSubject` cannot be reused: that one refuses ANY
 * uuid, and this surface renders subject ids by design. So the assertion is the
 * exact one INV-M6-10 makes -- no value this page withheld appears in the page's
 * own output -- and it is checkable precisely because {@link buildFeed} kept the
 * set rather than discarding it.
 */
export function assertWithheld(feed: Feed, lines: readonly string[]): void {
  const text = lines.join('\n');
  for (const value of feed.withheldValues)
    if (text.includes(value))
      throw new FeedError(
        `the rendered feed contains ${value}, which INV-M6-10 withheld from this scope. A ` +
          'trader-identifying value reaching a page whose query named no subject is the bulk ' +
          'identity screen that invariant says does not exist',
      );
}
