// =============================================================================
// apps/api/src/routes/admin-feed.ts
// =============================================================================
// THE EVENT FEED'S ROUTE. `M06` section 1.1's FIFTH SURFACE, and the endpoint
// `API_CONTRACT` sections 8 and 9 carried no row for until ADR-184.
//
// -----------------------------------------------------------------------------
// WHY THIS IS ITS OWN MODULE AND NOT SEVEN LINES IN `admin-reads.ts`
// -----------------------------------------------------------------------------
// `WAVE-06` `W6-e` fences a new file, and the reason survives the fence: this
// module is the only admin read whose SAFETY IS A PROPERTY OF ITS QUERY. Every
// other read in section 8 is safe by its shape. `/admin/liability` is an
// aggregate, `/admin/accounts/:accountId` names its subject in the path, and
// `/admin/flags` is a work queue whose rows are flags rather than people.
//
// THE FEED IS THE ONE READ WHERE AN ABSENT FILTER CHANGES WHAT MAY BE RENDERED,
// AND `admin-reads.ts` SAYS THE OPPOSITE ABOUT ITS OWN QUEUE IN TERMS. At
// `admin-reads.ts:1361` the flag queue records: "FILTERABLE, not filtered ...
// an absent filter is the whole queue and is correct." For `events` an absent
// filter is the bulk identity screen `INV-M6-10` says does not exist. Two rules
// that read alike and mean opposite things do not belong in one file where a
// later reader can take the wrong one.
//
// -----------------------------------------------------------------------------
// `INV-M6-10` IS CARRIED IN THE REQUEST SHAPE, WHICH IS ADR-184 RULING 2
// -----------------------------------------------------------------------------
// "The admin console renders trader-identifying data only when the query names a
// specific subject" (`M06` section 1.3). `FM-M6-10` is the failure: "Search
// returns a result set that enumerates identities ... a bulk PII surface hiding
// inside a convenience feature".
//
// SO {@link FEED_SCOPE_KINDS} IS REQUIRED AND HAS NO DEFAULT, and the three
// refusals below are refusals rather than corrections:
//
//   `?scope=` absent          400. Not defaulted. Defaulting to `operational`
//                             silently redacts a drill-down; defaulting the
//                             other way hands a bulk screen the licence a named
//                             query earns. Both defaults are wrong, so there is
//                             none.
//   `?scope=identity` with    400. A scope naming a subject with no subject to
//   no `identity_id`          name is not a narrower query, it is the widest
//                             one wearing the label of a narrow one.
//   `?scope=operational`      400, REFUSED AND NOT IGNORED. Ignoring it is the
//   with `identity_id`        handler remembering, and a property a handler has
//                             to remember is `FM-M6-10` waiting to happen. The
//                             caller sent two different queries in one request
//                             and the server does not pick.
//
// The parse either produces a {@link FeedScope} or produces errors. There is no
// third outcome and no arm of that union that means "no scope", so no code path
// downstream of {@link parseFeedScope} can be reached without one.
//
// -----------------------------------------------------------------------------
// THE WITHHOLDING IS ON THE RESPONSE AND NOT ON THE RENDERER
// -----------------------------------------------------------------------------
// `apps/admin/src/feed.ts` applies the same rule at `buildFeed`. THAT COPY IS
// NOT THIS ONE AND CANNOT BE, because `RI-04` forbids `apps/api` declaring
// `@merit/admin` and the dependency would run the wrong way besides. It is also
// NOT SUFFICIENT: `api-admin` serves `/api/v1/admin/events` on `ADMIN_ORIGIN`
// (`INFRA:44`), so an operator session reaches this response WITHOUT the console
// in the path. `AS-M6-05` is that reader by name: "a read-only admin session and
// no write capability can still take the identity graph and a pack per account."
// A redaction that lives only in a renderer is a redaction a `curl` walks past.
//
// So the rule is stated HERE, where the bytes are produced, and the console's
// copy becomes defence in depth over an already-withheld body rather than the
// only copy. THE DUPLICATION IS REAL AND IS REPORTED RATHER THAN DENIED:
// ADR-184 section 6 names it and names the two shapes that close it, neither of
// which is in this slice's fence.
//
// THE RULE IS ON THE SHAPE OF THE KEY, which is `feed.ts`'s ruling adopted
// rather than re-derived: any key ending `identity_id` or `account_id`, so
// `kyc.dedupe_hit`'s `matched_identity_id` and `identity.merged`'s
// `merged_identity_id` are covered BY CONSTRUCTION rather than by having been
// thought of. `packages/db/src/scope.ts` records those two as the reason `events`
// cannot be scoped at all, and a scope rule cannot express them where a
// projection can.
//
// -----------------------------------------------------------------------------
// THE WITHHELD VALUES NEVER REACH THE WIRE, AND THE ASSERTION IS WHY THEY CANNOT
// -----------------------------------------------------------------------------
// `apps/admin`'s `Feed` carries `withheldValues` so the surface can assert about
// its own output. A RESPONSE THAT CARRIED THAT FIELD WOULD SHIP EVERY WITHHELD
// UUID TO THE CALLER, which is the bulk read with an extra step. So the set is
// produced, used, and dropped: {@link withholdForScope} returns it beside the
// items, {@link assertNothingWithheldOnTheWire} runs over the SERIALIZED body,
// and only the items are sent.
//
// ASSERTED OVER THE SERVED BYTES AND NOT OVER THE ROWS, which is `WAVE-06`
// section 5.2's rule and `projectFlag`'s 2026-08-28 miss: an assertion that ran
// on the port's rows before the projection let a wrong value reach the operator
// with the adapter correct and the assertion passing.
//
// -----------------------------------------------------------------------------
// THERE IS NO `total`, AND THE CONTRACT'S OWN ENVELOPE IS WHY NONE IS NEEDED
// -----------------------------------------------------------------------------
// ADR-157 admits a RANGE term and `IS NULL` on the READ path and REFUSES the
// scalar aggregate on evidence. `apps/admin`'s `Feed` answers that with `shown`
// and `complete`. THIS SURFACE NEEDS NEITHER FIELD, because section 1's
// pagination envelope already carries both facts: `data.length` is `shown`
// counted rather than claimed, and `next_cursor === null` is `complete`. A
// `total` would be a number nothing in this deployable can obtain.
//
// -----------------------------------------------------------------------------
// NO PORT IS DECLARED HERE AND ADR-184 RULING 1 IS WHY
// -----------------------------------------------------------------------------
// The ruling puts this read on `AdminReadSource` as a SEVENTH METHOD,
// `listEvents`, rather than on a port of its own: it is a READ through
// `systemDb('operator-console')`, and this deployable has exactly one admin read
// port and four admin WRITE backends. A second read port would be a second name
// for one door and a second wiring obligation.
//
// **THE METHOD IS ON THE PORT NOW.** `AdminReadSource.listEvents` is declared at
// `admin-reads.ts:733` and `composeAdminReadSource` carries its arm, so a
// deployment that composes a feed adapter has somewhere to put it. ADR-184
// section 5 said three files had to move together and the count is SIX,
// measured: the two typed `AdminReadSource` literals in `test/admin-reads.test.ts`
// and `test/admin-breaker.test.ts` do not compile without the leg, and
// `test/admin-source-evidence.test.ts` holds a THIRD hardcoded method list
// beside the two that entry named.
//
// **WHAT STILL WAITS IS THE HANDLER, AND IT IS ONE CALL RATHER THAN A RULING.**
// This handler refuses the READ and enforces the REQUEST, exactly as before:
// `AdminReadSource` declares the method and no module in this tree implements
// it, so calling it would replace {@link AdminFeedNotComposed} with
// `AdminSourceNotComposed('listEvents')` and change nothing a caller sees. The
// slice that writes the adapter takes both in one commit, and
// {@link AdminEventFeedResponse} is the shape it returns: it is declared here,
// referenced nowhere, and waiting for that call.
//
// -----------------------------------------------------------------------------
// WHAT AN UNWIRED DEPLOYMENT ACTUALLY ANSWERS, MEASURED RATHER THAN INHERITED
// -----------------------------------------------------------------------------
// `WAVE-06` section 4.1 states that every operator route "answers 503 today".
// **IT IS 500, AND THE MEASUREMENT IS IN ADR-184 SECTION 7.** `adminHandler`
// resolves `currentReadSource()` BEFORE it calls `spec.handle`
// (`admin-reads.ts:856`), that throws an `AdminReadError` carrying no
// `statusCode`, and `server.ts`'s error handler maps an absent status to 500.
//
// **THAT 500 IS THE DESIGN AND NOT A DEFECT TO ROUTE AROUND.** `STATUS_CODE`
// (`server.ts:67`) is closed over API_CONTRACT section 2's canonical table,
// which carries NO 503 and no `service_unavailable`, and the handler's own
// comment says an unmapped status "is reported as an `internal_error` with the
// real status in the log, which is a defect somebody can find" rather than
// silently acquiring an invented code. So this module invents none either: a
// 503 here would need a new canonical code, which is a wider amendment than
// `W6-e` holds.
//
// THE CONSEQUENCE FOR THIS MODULE IS STATED RATHER THAN LEFT TO BE FOUND. Where
// a read source IS wired the parse runs first and an unscoped query is refused
// 400 with no read attempted, which is the order below. Where NONE is wired the
// 500 arrives before this module's handler is entered at all, so the request
// half is enforced for every deployment that has a source and for no other.
// Coupling every section 8 route to one port's wiring is `admin-reads.ts`'s
// shape and not this file's, and ADR-184 section 7 reports it.
//
// A `set`- or `use`-prefixed export here would be picked up by
// `test/wiring.test.ts`'s `DECLARES` sweep and would have to carry a `BLOCKED`
// reason in that file, which is not this slice's. **Spelling the setter so the
// sweep misses it was considered and REFUSED**: that is weakening a gate to pass
// it, and the gate is right. A port and the reason it is not wired belong in one
// commit, which is the regression `wiring.test.ts` exists for.
// =============================================================================

import type { FastifyRequest } from 'fastify';

import { defineRoutes } from '../registry.ts';
import {
  ADMIN_READ_ROLES,
  LIMIT_DEFAULT,
  LIMIT_MAX,
  adminRoleTable,
  adminValidationFailed,
  toAdminRoutes,
} from './admin-reads.ts';
import type { AdminEndpointSpec, AdminFieldError, AdminPage } from './admin-reads.ts';

/** The contract path, in one place so the spec and the tests cannot drift. */
export const ADMIN_EVENTS_PATH = '/admin/events';

/** What a withheld value renders as. `apps/admin`'s `WITHHELD`, on the wire. */
export const WITHHELD = 'withheld';

// -----------------------------------------------------------------------------
// The scope, which is `INV-M6-10`'s two modes as a closed set
// -----------------------------------------------------------------------------

/**
 * The values `?scope=` admits.
 *
 * TWO MODES AND THREE ARMS. `INV-M6-10` distinguishes "the query names a
 * specific subject" from "it does not"; the named mode has two arms because a
 * subject is an identity or an account, and `events` carries a column for each.
 */
export const FEED_SCOPE_KINDS = ['operational', 'identity', 'account'] as const;

/** One of {@link FEED_SCOPE_KINDS}. */
export type FeedScopeKind = (typeof FEED_SCOPE_KINDS)[number];

/**
 * What the query named, which is what `INV-M6-10` turns on.
 *
 * A CLOSED UNION WITH NO ARM MEANING "UNKNOWN". Adopted from
 * `apps/admin/src/feed.ts`'s `FeedScope` deliberately: the two surfaces are the
 * same invariant at two layers and a second vocabulary for one concept is how
 * they drift.
 */
export type FeedScope =
  | { readonly kind: 'operational' }
  | { readonly kind: 'identity'; readonly identity_id: string }
  | { readonly kind: 'account'; readonly account_id: string };

/** The ids this scope's query named, and therefore the only ones it licenses. */
export function licensedBy(scope: FeedScope): readonly string[] {
  if (scope.kind === 'identity') return [scope.identity_id];
  if (scope.kind === 'account') return [scope.account_id];
  return [];
}

// -----------------------------------------------------------------------------
// The query the port is handed, and the rows it hands back
// -----------------------------------------------------------------------------

/**
 * What `AdminReadSource.listEvents` is asked for.
 *
 * THE SCOPE IS A FIELD OF THE QUERY AND NOT A PAIR OF OPTIONAL IDS, which is
 * ADR-184 ruling 2 carried one layer down. The losing shape is
 * `identity_id?`/`account_id?` on the query with an adapter that works out what
 * their combination meant; that is `FM-M6-10` moved from the handler into the
 * adapter rather than removed, because there is still a value meaning "I did
 * not check". {@link FeedScope} has no such arm, so an adapter cannot hold one.
 *
 * `limit` and `cursor` are the two fields `FlagListQuery` already carries under
 * those names (`admin-reads.ts:640`), because a second vocabulary for one
 * envelope is how two pages of one contract drift apart.
 */
export interface AdminEventQuery {
  readonly scope: FeedScope;
  readonly limit: number;
  readonly cursor: string | null;
}

/**
 * One `events` row as the port hands it over, BEFORE `INV-M6-10` is applied.
 *
 * `id` IS A STRING because `events.id` is `bigint GENERATED ALWAYS AS IDENTITY`
 * (`packages/db/migrations/0017_events_and_audit.sql`) and a JSON number loses
 * that ordering past 2^53.
 *
 * BOTH INSTANTS ARE PRESENT AND NEITHER IS OPTIONAL. `occurred_at` is when the
 * fact happened and `recorded_at` is when we learned it; dropping either at this
 * boundary makes the divergence invisible one layer before anyone could see it.
 */
export interface AdminEventRow {
  readonly id: string;
  readonly event_name: string;
  readonly occurred_at: string;
  readonly recorded_at: string;
  readonly identity_id: string | null;
  readonly account_id: string | null;
  readonly subject_kind: string;
  readonly subject_id: string;
  readonly actor_kind: string;
  readonly actor_id: string | null;
  readonly correlation_id: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** One row with `INV-M6-10` already applied to every field of it. */
export interface AdminEventItem extends AdminEventRow {
  /**
   * Whether anything on THIS row was withheld.
   *
   * ON THE ROW RATHER THAN ON THE PAGE. A reader deciding whether to open the
   * drill-down needs to know this row has more behind it, and a page-level flag
   * answers a different question. It leaks nothing: it is the fact that a value
   * exists, never the value.
   */
  readonly withheld: boolean;
  /**
   * We learned it before it happened, which cannot be true.
   *
   * MARKED AND RENDERED RATHER THAN REFUSED. Refusing an incoherent row is right
   * for an aggregate, where one bad input corrupts the answer, and wrong for a
   * list, where refusing blanks an operator's timeline during the incident the
   * bad row is evidence of.
   */
  readonly instants_incoherent: boolean;
}

/** Section 1's envelope, plus the scope the page was served under. */
export interface AdminEventFeedResponse extends AdminPage<AdminEventItem> {
  /**
   * ECHOED, because a page that does not say which mode produced it is a page an
   * operational reader can mistake for a complete one. It is `renderFeed`'s
   * header line expressed as a field rather than as prose.
   */
  readonly scope: FeedScope;
}

// -----------------------------------------------------------------------------
// The withholding
// -----------------------------------------------------------------------------

/**
 * Whether a payload key names an identity or an account, WHOSEVER IT IS.
 *
 * A RULE ON THE SHAPE OF THE KEY AND NOT A COLUMN LIST, so `matched_identity_id`
 * and `merged_identity_id` are covered without either having been enumerated.
 */
export function namesASubject(key: string): boolean {
  return key.endsWith('identity_id') || key.endsWith('account_id');
}

/** What {@link withholdForScope} produced. `withheldValues` NEVER goes on the wire. */
export interface WithheldFeed {
  readonly items: readonly AdminEventItem[];
  /** Every value `INV-M6-10` kept off this page. For {@link assertNothingWithheldOnTheWire} alone. */
  readonly withheldValues: readonly string[];
}

/**
 * Apply `INV-M6-10` to a page of rows.
 *
 * EVERY IDENTIFYING VALUE THE SCOPE DOES NOT LICENSE BECOMES {@link WITHHELD},
 * VISIBLY. It is withheld rather than dropped because a row with no identity
 * shown must not read as a row with no identity involved.
 */
export function withholdForScope(rows: readonly AdminEventRow[], scope: FeedScope): WithheldFeed {
  const licensed = new Set(licensedBy(scope));
  const withheldValues = new Set<string>();

  const gate = (value: string | null): string | null => {
    if (value === null) return null;
    if (licensed.has(value)) return value;
    withheldValues.add(value);
    return WITHHELD;
  };

  const items = rows.map((row): AdminEventItem => {
    const identity_id = gate(row.identity_id);
    const account_id = gate(row.account_id);
    // THE SUBJECT IS GATED ONLY WHERE IT IS A PERSON OR AN ACCOUNT. A
    // `payout_request` subject is a handle to an object and is the link target
    // the operator clicks through to; withholding it would leave a feed nobody
    // can act on while protecting nothing `INV-M6-10` is about.
    const subject_id =
      row.subject_kind === 'identity' || row.subject_kind === 'account'
        ? (gate(row.subject_id) ?? row.subject_id)
        : row.subject_id;

    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row.payload))
      payload[key] =
        namesASubject(key) && typeof value === 'string' ? (gate(value) ?? value) : value;

    return {
      ...row,
      identity_id,
      account_id,
      subject_id,
      // `actor_id` IS AN OPERATOR STRING AND NOT A TRADER. `events.actor_id` is
      // `text` on `admin_actions.actor`'s precedent, so it is not an identity
      // uuid and `INV-M6-10` does not reach it.
      payload,
      withheld: [identity_id, account_id, subject_id, ...Object.values(payload)].some(
        (value) => value === WITHHELD,
      ),
      instants_incoherent: Date.parse(row.recorded_at) < Date.parse(row.occurred_at),
    };
  });

  return { items, withheldValues: [...withheldValues] };
}

/** Thrown when a withheld value reached the body. A 500 beats a leak. */
export class AdminFeedLeak extends Error {
  constructor(value: string) {
    super(
      `the event feed response contains ${value}, which INV-M6-10 withheld from this scope. A ` +
        'trader-identifying value reaching a body whose query named no subject is the bulk ' +
        'identity read that invariant says does not exist',
    );
    this.name = 'AdminFeedLeak';
  }
}

/**
 * The control, run over the SERIALIZED body rather than over the rows.
 *
 * A FIELD ADDED CARELESSLY IS WHAT THIS CATCHES. `withholdForScope` gates the
 * fields it knows about; this asserts the property over whatever the body
 * actually became, so a field added later that carries an id through is a
 * refusal rather than a leak.
 */
export function assertNothingWithheldOnTheWire(
  body: unknown,
  withheldValues: readonly string[],
): void {
  if (withheldValues.length === 0) return;
  const text = JSON.stringify(body);
  for (const value of withheldValues) if (text.includes(value)) throw new AdminFeedLeak(value);
}

// -----------------------------------------------------------------------------
// The request
// -----------------------------------------------------------------------------

function queryParam(request: FastifyRequest, name: string): string | null {
  const query = request.query;
  if (typeof query !== 'object' || query === null || Array.isArray(query)) return null;
  const value = (query as Record<string, unknown>)[name];
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * `?scope=`, and the two ids it does or does not admit.
 *
 * RETURNS `null` ONLY ALONGSIDE AT LEAST ONE ERROR. A caller that reads the
 * return value without reading `errors` cannot mistake a refusal for a scope,
 * because there is no scope value that means "none".
 */
export function parseFeedScope(
  request: FastifyRequest,
  errors: AdminFieldError[],
): FeedScope | null {
  const identityId = queryParam(request, 'identity_id');
  const accountId = queryParam(request, 'account_id');
  const raw = queryParam(request, 'scope');

  if (raw === null) {
    errors.push({
      path: 'scope',
      message:
        `is required and has no default. One of: ${FEED_SCOPE_KINDS.join(', ')}. ` +
        'Whether the query names a subject is what INV-M6-10 turns on, so it is stated ' +
        'rather than inferred',
    });
    return null;
  }

  const kind = FEED_SCOPE_KINDS.find((value) => value === raw);
  if (kind === undefined) {
    errors.push({ path: 'scope', message: `must be one of: ${FEED_SCOPE_KINDS.join(', ')}` });
    return null;
  }

  // A SUBJECT SENT UNDER A SCOPE THAT DOES NOT NAME IT IS REFUSED AND NOT
  // IGNORED. Ignoring it is the handler remembering, and the request would then
  // have meant two different things depending on which parameter the reader
  // looked at first.
  const unexpected = (name: string): void => {
    errors.push({
      path: name,
      message: `is not admitted under \`scope=${kind}\`. Send \`scope=${name.replace('_id', '')}\` to name a subject`,
    });
  };

  if (kind !== 'identity' && identityId !== null) unexpected('identity_id');
  if (kind !== 'account' && accountId !== null) unexpected('account_id');

  if (kind === 'operational') return errors.length === 0 ? { kind } : null;

  if (kind === 'identity') {
    if (identityId === null) {
      errors.push({
        path: 'identity_id',
        message:
          'is required under `scope=identity`. A scope naming a subject with no subject named is the widest query wearing a narrow label',
      });
      return null;
    }
    return errors.length === 0 ? { kind, identity_id: identityId } : null;
  }

  if (accountId === null) {
    errors.push({
      path: 'account_id',
      message:
        'is required under `scope=account`. A scope naming a subject with no subject named is the widest query wearing a narrow label',
    });
    return null;
  }
  return errors.length === 0 ? { kind, account_id: accountId } : null;
}

/** `?limit=` and `?cursor=`, section 1's rule. Cursor only, never offset. */
export function parseFeedPaging(
  request: FastifyRequest,
  errors: AdminFieldError[],
): { limit: number; cursor: string | null } {
  const rawLimit = queryParam(request, 'limit');
  let limit = LIMIT_DEFAULT;
  if (rawLimit !== null) {
    const parsed = Number(rawLimit);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > LIMIT_MAX)
      errors.push({ path: 'limit', message: `must be an integer from 1 to ${String(LIMIT_MAX)}` });
    else limit = parsed;
  }
  const rawCursor = queryParam(request, 'cursor');
  return { limit, cursor: rawCursor };
}

// -----------------------------------------------------------------------------
// The endpoint
// -----------------------------------------------------------------------------

/**
 * The read no source supplies yet.
 *
 * NAMES THE METHOD, in `AdminSourceNotComposed`'s idiom and for its reason: a
 * deployment missing a leg answers which leg at the first request rather than
 * returning nothing. ADR-184 ruling 1 fixed the method's name and home and the
 * port now declares it.
 *
 * THIS LINE IS STILL REACHED, AND WHAT REMOVES IT IS ONE CALL. The handler
 * below reads through no port yet, so this refusal is the live one; the slice
 * that has the handler call `source.listEvents` deletes this class and inherits
 * `AdminSourceNotComposed('listEvents')`, which says the same thing one layer
 * down. TWO STATEMENTS OF ONE REFUSAL EXIST UNTIL THEN and it is reported
 * rather than denied: they cannot disagree, because neither is reachable on a
 * deployment the other is not.
 */
export class AdminFeedNotComposed extends Error {
  constructor() {
    super(
      'no module supplies `AdminReadSource.listEvents`, so the event feed has no rows to ' +
        'return. This is a deployment which has not been finished rather than a request that ' +
        'failed: ADR-184 rules the method onto `AdminReadSource` and names the three edits its ' +
        'signing slice owes',
    );
    this.name = 'AdminFeedNotComposed';
  }
}

/**
 * The one endpoint, and the request half of it is LIVE TODAY.
 *
 * THE ORDER IS THE POINT. The scope is parsed and refused BEFORE the read is
 * attempted, so a malformed or unscoped query is 400 and no read is issued for
 * it: the request was wrong regardless of what the deployment could have
 * served. See the header for the one case that order does not reach, which is a
 * deployment with no read source wired at all.
 */
export const ADMIN_FEED_ENDPOINTS: readonly AdminEndpointSpec[] = [
  {
    method: 'GET',
    path: ADMIN_EVENTS_PATH,
    // ALL THREE ROLES, which is the contract rather than an oversight. Section 8
    // closes the admin set at three and gives `readonly` the read. This surface
    // mutates nothing, and `AS-M6-05`'s read-side risk is bounded here by
    // `INV-M6-10`'s withholding rather than by a role. A feed restricted to
    // `owner` would be a control this module invented.
    roles: ADMIN_READ_ROLES,
    handle: async ({ request, reply }) => {
      const errors: AdminFieldError[] = [];
      const scope = parseFeedScope(request, errors);
      parseFeedPaging(request, errors);
      if (scope === null || errors.length > 0)
        return adminValidationFailed(reply, request.id, errors);

      // THE READ, AND IT IS THE ONLY HALF THAT WAITS. Everything above ran.
      return await Promise.reject(new AdminFeedNotComposed());
    },
  },
];

/** Published as data, so a reviewer and a later gate read one table. */
export const ADMIN_FEED_ROLE_TABLE = adminRoleTable(ADMIN_FEED_ENDPOINTS);

/** `surface.ts` classifies `/admin` as operator, so this can be nothing else. */
export const ADMIN_FEED_REQUIRED_FACTORS: Readonly<Record<string, 'admin_sso'>> =
  Object.fromEntries(
    ADMIN_FEED_ENDPOINTS.map((spec) => [`${spec.method} ${spec.path}`, 'admin_sso' as const]),
  );

export default defineRoutes({
  name: 'admin-feed',
  routes: toAdminRoutes(ADMIN_FEED_ENDPOINTS),
});
