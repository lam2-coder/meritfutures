// =============================================================================
// apps/api/src/admin-source/events.ts
// =============================================================================
// `AdminReadSource.listEvents`, WHICH TWO SESSIONS MEASURED AS UNWRITABLE AND
// ONE ENTRY MADE WRITABLE.
//
// Session 349 was dispatched to write this adapter and did not: a `Tx` naming
// `'events'` failed `tsc` with `TS2322` against `TABLE_KEYS`, because
// `packages/db` registered no rule for the table and declared no drizzle table
// for it. ADR-191 registered it under a SIXTH SCOPE CLASS, `either`, and this
// module is the first read that could not be written before that entry and can
// be written after it. Nothing else about the shape changed: this is
// `flags.ts`'s and `graph.ts`'s module shape, unaltered, over one more table.
//
// -----------------------------------------------------------------------------
// THE SCOPE DECIDES WHICH ROWS, AND `INV-M6-10` DECIDES WHICH FIELDS. THEY ARE
// DIFFERENT QUESTIONS AND THIS MODULE ANSWERS ONLY THE FIRST
// -----------------------------------------------------------------------------
// ADR-184 ruling 3: "the withholding is a property of the RESPONSE and not of
// the renderer". `routes/admin-feed.ts`'s `withholdForScope` owns it, it runs on
// the rows this module returns, and `assertNothingWithheldOnTheWire` runs over
// the serialized body after that. **So this module gates nothing and must not
// start**: a second gate here would be a second place for the rule to be
// slightly different, and the one over the bytes is the one that cannot be
// out-argued by a field somebody adds later.
//
// What the scope decides HERE is the FILTER. `AdminEventQuery.scope` is a closed
// union with no arm meaning "no scope" (ADR-184 ruling 2), so this module has
// three cases and no default, and each is a different read.
//
// -----------------------------------------------------------------------------
// `scope=identity` IS THE DISJUNCTION AND IT IS TWO READS, WHICH IS ADR-191's
// RULING RATHER THAN THIS FILE'S CONVENIENCE
// -----------------------------------------------------------------------------
// **THE EQUALITY ALONE IS THE WRONG ANSWER AND THE CORPUS SAYS SO IN TERMS.**
// ADR-191 clause 2: "the predicate is the DISJUNCTION and neither half may be
// lost ... An `owned` rule on the identity column drops every row reached the
// other way". Its section 4 counted the loss out of `EVENTS.md`'s catalogue
// rather than asserting it: of the 29 rows carrying the `TL` consumer, ten name
// an account and no identity and nine name an identity and no account. **An
// identity feed built on `identity_id = $1` therefore omits at least ten of
// twenty-nine event kinds, returns rows, and raises nothing.**
//
// The equality is what `rowsWhere` offers, so the disjunction is spelled as TWO
// READS unioned in memory. That is `graph.ts`'s move for
// `identity_links_canonical_order` and it is adopted rather than invented: "a
// filter is a conjunction of equalities, so ... this module spells that as TWO
// reads unioned in memory rather than reaching for a predicate the accessor does
// not offer".
//
// THE SECOND LEG NEEDS THE IDENTITY'S ACCOUNTS, which is why `accounts` is in
// {@link EVENT_READ_TABLES} and why the module reads two tables to serve a feed
// over one. `accounts` is `owned` on `identity_id`, `nullable: false`
// (`scope.ts`), so the hop is single-valued in the direction that matters and
// the identity's account set is one keyed read.
//
// **WHAT THE DISJUNCTION COSTS ON THE PAGE IS STATED RATHER THAN HIDDEN.** A row
// reached only through the account leg carries `identity_id: null`, and
// `licensedBy({ kind: 'identity' })` licenses the identity uuid and not the
// account's, so that row renders with `account_id: "withheld"` and no identity
// at all. It is legible only because the PAGE names its scope, which
// `AdminEventFeedResponse.scope` echoes for exactly that reason. **The
// alternative is that the row is not there**, and a risk timeline that silently
// drops a third of itself is the failure this corpus ranks worst.
//
// **AND WHAT IT STILL CANNOT REACH IS ADR-191 SECTION 11 ITEM 5, UNCHANGED.** A
// merged identity's identity-level events carry the dead uuid and no account, so
// neither leg reaches them from the survivor. This module inherits that gap; it
// does not widen it and it cannot close it, because closing it needs the merge
// graph and `identity_merges` is not a registered table.
//
// -----------------------------------------------------------------------------
// `scope=account` IS ONE LEG AND THAT IS NOT AN INCONSISTENCY
// -----------------------------------------------------------------------------
// An account-scoped question is about the account, so `account_id = $1` is the
// whole of it. Adding the owner's identity-level rows would answer the question
// the identity scope already answers, on a page whose licence names one account.
//
// -----------------------------------------------------------------------------
// `scope=operational` READS THE WHOLE TABLE AND THE COST IS REPORTED RATHER THAN
// HIDDEN BEHIND A NUMBER NOBODY RULED
// -----------------------------------------------------------------------------
// `events` is APPEND-ONLY with retention forever (`0017_events_and_audit.sql`),
// so `rows('events')` grows in the operating age of the firm, and this module
// pages in memory. **THAT IS A REAL COST AND {@link EventFeedCost} IS WHERE IT
// IS ADMITTED**, on `flags.ts`'s and `graph.ts`'s precedent of returning what a
// read cost beside what it returned.
//
// WHAT WOULD FIX IT IS A RANGE TERM AND IT IS NOT REACHED FOR. ADR-157 admits
// `atMost` and `atLeast` on the read path, and a feed ordered by `recorded_at`
// is exactly the shape they serve. **Minting one needs an import of `@merit/db`
// inside this directory, which `test/db.test.ts` pins against and which
// `admin-source/index.ts` states as a rule about this directory**: the accessor
// arrives as a handle and this directory names no package. So the bound is owed
// to whoever moves that rule, the cost is measured here in the meantime, and
// nothing is widened to avoid reporting it.
//
// THE ORDER IS THE CONTRACT'S AND IS NOT THIS FILE'S CHOICE. API_CONTRACT
// section 8: "Ordered by `recorded_at` descending, ties broken on `id` ... a
// late vendor webhook about Tuesday's fact belongs at the top of Thursday's feed
// rather than buried in Tuesday. `id` is the only total order this append-only
// table has." Both keys are DESCENDING, because the tie-break exists to make the
// cursor total rather than to reorder anything a reader sees, and a tie-break
// running the other way would page backwards through the rows it broke.
//
// **`id` IS COMPARED AS A NUMBER AND CARRIED AS A STRING.** `events.id` is
// `bigint GENERATED ALWAYS AS IDENTITY`, the contract types it a string because
// "a JSON number loses that ordering past 2^53", and `"10" < "9"` as text. So
// the comparison goes through `BigInt` and the field does not.
//
// THERE IS NO `total` AND NONE IS COMPUTED. ADR-157 refuses the scalar aggregate
// on the read path and ADR-184 ruling 4 applied that to this page by name:
// `data.length` is counted and `next_cursor === null` is the difference between
// an exhausted query and a full page.
// =============================================================================

import { AdminReadError } from '../routes/admin-reads.ts';
import type { AdminEventQuery, AdminEventRow, FeedScope } from '../routes/admin-feed.ts';
import type { AdminPage } from '../routes/admin-reads.ts';
import type { AdminRowFilter } from './flags.ts';

// -----------------------------------------------------------------------------
// The port onto the database
// -----------------------------------------------------------------------------

/**
 * The tables this module reads, and no others.
 *
 * TWO, FOR A FEED OVER ONE TABLE, and the second is the disjunction's other leg
 * rather than a join. See the header: `scope=identity` reaches an event through
 * `events.identity_id` OR through an account this identity holds, and the second
 * path needs the account set.
 *
 * `routes/admin-writes.ts`'s `ADMIN_WRITE_TABLES` idiom, for its reason: a typo
 * is a compile error here, and the suite asserts every member is a real
 * `TableKey` of `packages/db`, which is the half this module cannot make about
 * itself because it holds no import of that package.
 */
export const EVENT_READ_TABLES = ['accounts', 'events'] as const;

/** One of {@link EVENT_READ_TABLES}. */
export type EventReadTable = (typeof EVENT_READ_TABLES)[number];

/**
 * ADR-112's keyed accessor, READ HALF ONLY, over this module's two tables.
 *
 * `FlagsTx`'s shape and `FlagsTx`'s reason. `insert`, `updateAt`, `deleteAt` and
 * `sqlExecutor` are ABSENT rather than unused, `SystemTx` satisfies this
 * structurally, and a handle narrowed to it cannot write. On this table that
 * matters twice over: `events` is append-only by `0017`'s own comment, so a
 * writable handle here would be a shape the storage rule forbids.
 */
export interface EventsTx {
  rows(key: EventReadTable): Promise<unknown[]>;
  rowsWhere(key: EventReadTable, where: AdminRowFilter): Promise<unknown[]>;
}

// -----------------------------------------------------------------------------
// The rows, read defensively
// -----------------------------------------------------------------------------

function field(row: unknown, name: string): unknown {
  if (typeof row !== 'object' || row === null)
    throw new AdminReadError(
      `the accessor returned a ${typeof row} where an events row was expected. A feed built out ` +
        'of that would render an operator timeline nothing in the estate produced',
    );
  return (row as Record<string, unknown>)[name];
}

function text(row: unknown, name: string, at: string): string {
  const value = field(row, name);
  if (typeof value !== 'string' || value === '')
    throw new AdminReadError(
      `${at} carries no \`${name}\`, and the column is \`NOT NULL\` in the schema. That is the ` +
        'transcription disagreeing with the database rather than a row to render',
    );
  return value;
}

function optionalText(row: unknown, name: string, at: string): string | null {
  const value = field(row, name);
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value === '')
    throw new AdminReadError(
      `${at} carries \`${name}\` as ${JSON.stringify(value)}. The column is nullable, so the two ` +
        'answers are a value and no value, and an empty string is neither',
    );
  return value;
}

/**
 * `events.id`, as the string the contract types.
 *
 * `bigint GENERATED ALWAYS AS IDENTITY`, and API_CONTRACT section 8 carries it
 * as a string because "a JSON number loses the order past 2^53". The digits are
 * checked here rather than assumed, because {@link afterCursor} compares them as
 * a `BigInt` and a non-numeric id would throw three layers away from the row.
 */
function eventId(row: unknown): string {
  const value = field(row, 'id');
  const asString =
    typeof value === 'bigint' || typeof value === 'number' ? String(value) : (value as unknown);
  if (typeof asString !== 'string' || !/^\d+$/.test(asString))
    throw new AdminReadError(
      `an events row carries \`id\` as ${JSON.stringify(value)}, which is not the ` +
        '`bigint GENERATED ALWAYS AS IDENTITY` 0017 declares. That column is the only total ' +
        'order this append-only table has, and a feed paged on a value that is not one repeats ' +
        'rows or drops them',
    );
  return asString;
}

/**
 * A `timestamptz` as the contract's instant.
 *
 * BOTH INSTANTS ARE REQUIRED AND NEITHER IS DEFAULTED HERE. `occurred_at` is
 * when the fact happened and `recorded_at` is when we learned it; `AdminEventRow`
 * types both non-optional, and guessing one from the other at this boundary
 * would erase the divergence one layer before `instants_incoherent` could see it.
 */
function instant(row: unknown, name: string, at: string): string {
  const value = field(row, name);
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return value;
  throw new AdminReadError(
    `${at} carries \`${name}\` as ${JSON.stringify(value)}, which is not an instant. Both ` +
      '`occurred_at` and `recorded_at` are `NOT NULL` on this table and the feed is ordered by ' +
      'the second of them',
  );
}

/** One `events` row as the port hands it over. A spread would be `SELECT *`. */
function readEventRow(row: unknown): AdminEventRow {
  const id = eventId(row);
  const at = `event \`${id}\``;

  const payload = field(row, 'payload');
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload))
    throw new AdminReadError(
      `${at} carries a payload that is not an object, and \`events.payload\` is ` +
        '`jsonb NOT NULL`. The withholding walks that object key by key, so a payload that is ' +
        'not one is a row whose third-party identifiers nothing would gate',
    );

  return {
    id,
    event_name: text(row, 'eventName', at),
    occurred_at: instant(row, 'occurredAt', at),
    recorded_at: instant(row, 'recordedAt', at),
    // THE TWO LEGS, BOTH NULLABLE, WHICH IS THE `either` CLASS ITSELF. A row
    // carrying neither belongs to no identity (ADR-191 clause 3) and reaches
    // this page only under `operational`.
    identity_id: optionalText(row, 'identityId', at),
    account_id: optionalText(row, 'accountId', at),
    subject_kind: text(row, 'subjectKind', at),
    subject_id: text(row, 'subjectId', at),
    actor_kind: text(row, 'actorKind', at),
    actor_id: optionalText(row, 'actorId', at),
    correlation_id: optionalText(row, 'correlationId', at),
    payload: payload as Readonly<Record<string, unknown>>,
  };
}

// -----------------------------------------------------------------------------
// The ordering and the cursor
// -----------------------------------------------------------------------------

/**
 * API_CONTRACT section 8's order: `recorded_at` descending, ties broken on `id`.
 *
 * BOTH KEYS DESCEND. The tie-break exists to make the cursor a TOTAL order, and
 * an ascending tie-break inside a descending page would walk backwards through
 * exactly the rows it was added to separate.
 */
function compareRows(a: AdminEventRow, b: AdminEventRow): number {
  if (a.recorded_at !== b.recorded_at) return a.recorded_at < b.recorded_at ? 1 : -1;
  if (a.id === b.id) return 0;
  return BigInt(a.id) < BigInt(b.id) ? 1 : -1;
}

const CURSOR_SEPARATOR = ' ';

/** The sort tuple as strings, which is both the cursor and its comparison key. */
function keyOf(row: AdminEventRow): readonly string[] {
  return [row.recorded_at, row.id];
}

function cursorOf(row: AdminEventRow): string {
  return Buffer.from(keyOf(row).join(CURSOR_SEPARATOR), 'utf8').toString('base64url');
}

/**
 * The page boundary, as the ordering's own key rather than as an offset.
 *
 * AN OFFSET WOULD SKIP A ROW EVERY TIME ONE AHEAD OF IT ARRIVED, and on this
 * table that is not hypothetical: the feed is descending by `recorded_at` and
 * new rows land at the top continuously, so an offset paged during an incident
 * walks past exactly the rows the incident is producing.
 *
 * `recorded_at` IS AN ISO INSTANT AND IS COMPARED AS TEXT, which is correct
 * because ISO 8601 with a fixed offset sorts lexically in time order, and
 * `toISOString()` is what {@link instant} normalises every row to.
 */
function decodeCursor(cursor: string): readonly string[] {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const parts = decoded.split(CURSOR_SEPARATOR);
  if (parts.length !== 2)
    throw new AdminReadError(
      `the event feed was handed a cursor carrying ${String(parts.length)} components where the ` +
        'ordering has two. A cursor from a different ordering would page through this one at a ' +
        'position that means nothing',
    );
  const [recordedAt, id] = parts;
  if (recordedAt === undefined || !Number.isFinite(Date.parse(recordedAt)))
    throw new AdminReadError(
      'the event feed was handed a cursor whose first component is not an instant, so the ' +
        'position it names is not one this ordering has',
    );
  if (id === undefined || !/^\d+$/.test(id))
    throw new AdminReadError(
      'the event feed was handed a cursor whose second component is not an `events.id`, and ' +
        'that component is the only thing making this ordering total',
    );
  return parts;
}

/**
 * Whether `row` falls strictly after `cursor` IN THIS ORDERING.
 *
 * Component by component on the ordering's own directions rather than lexically
 * across the pair, because both keys DESCEND and `id` is a number written as
 * text.
 */
function afterCursor(row: AdminEventRow, cursor: readonly string[]): boolean {
  const key = keyOf(row);
  if (key[0] !== cursor[0]) return (key[0] ?? '') < (cursor[0] ?? '');
  return BigInt(key[1] ?? '0') < BigInt(cursor[1] ?? '0');
}

// -----------------------------------------------------------------------------
// The read
// -----------------------------------------------------------------------------

/**
 * What one feed page cost.
 *
 * `scanned` IS THE NUMBER THIS EXISTS FOR. Under `operational` it is the whole
 * table, because there is no bound this directory may express (see the header),
 * and a cost nobody measured is a cost nobody notices until an incident.
 *
 * `accountsOfIdentity` and `accountLegRows` are the disjunction's second leg,
 * separated so the price of ADR-191's ruling is visible rather than folded into
 * the total it moves.
 */
export interface EventFeedCost {
  readonly scanned: number;
  readonly identityLegRows: number;
  readonly accountsOfIdentity: number;
  readonly accountLegRows: number;
  readonly duplicatesAcrossLegs: number;
}

/** {@link readEventFeed}'s page, plus what it cost. */
export interface EventFeedResult {
  readonly page: AdminPage<AdminEventRow>;
  readonly cost: EventFeedCost;
}

/**
 * Every row this scope reaches, deduplicated by `events.id`.
 *
 * THE DEDUPE IS LOAD BEARING AND NOT DEFENCE AGAINST A CONSTRAINT. A row
 * carrying `identity_id = X` AND `account_id = A` where `A` is `X`'s account
 * comes back from BOTH legs, and it is the ordinary case rather than the corner
 * one: ADR-191 section 4 counted six of the 29 `TL` rows naming both.
 */
async function rowsForScope(
  tx: EventsTx,
  scope: FeedScope,
): Promise<{ rows: readonly AdminEventRow[]; cost: EventFeedCost }> {
  if (scope.kind === 'operational') {
    // THE WHOLE TABLE, AND `rows` RATHER THAN AN EMPTY FILTER. `P7-g` measured
    // that an empty filter does not compile, and "everything" spelled as a
    // narrowing that happens to be true is a cast wearing a predicate.
    const rows = (await tx.rows('events')).map(readEventRow);
    return {
      rows,
      cost: {
        scanned: rows.length,
        identityLegRows: 0,
        accountsOfIdentity: 0,
        accountLegRows: 0,
        duplicatesAcrossLegs: 0,
      },
    };
  }

  if (scope.kind === 'account') {
    const rows = (await tx.rowsWhere('events', { accountId: scope.account_id })).map(readEventRow);
    return {
      rows,
      cost: {
        scanned: rows.length,
        identityLegRows: 0,
        accountsOfIdentity: 0,
        accountLegRows: rows.length,
        duplicatesAcrossLegs: 0,
      },
    };
  }

  // THE DISJUNCTION. ADR-191 clause 2, as the two reads the equality-only
  // accessor forces. See the header for why neither half may be dropped.
  const byIdentity = (await tx.rowsWhere('events', { identityId: scope.identity_id })).map(
    readEventRow,
  );
  const accounts = await tx.rowsWhere('accounts', { identityId: scope.identity_id });
  const accountIds = [...new Set(accounts.map((row) => text(row, 'id', 'an accounts row')))].sort();

  const merged = new Map<string, AdminEventRow>();
  for (const row of byIdentity) merged.set(row.id, row);

  let accountLegRows = 0;
  let duplicatesAcrossLegs = 0;
  for (const accountId of accountIds) {
    const rows = (await tx.rowsWhere('events', { accountId })).map(readEventRow);
    accountLegRows += rows.length;
    for (const row of rows) {
      if (merged.has(row.id)) duplicatesAcrossLegs += 1;
      merged.set(row.id, row);
    }
  }

  return {
    rows: [...merged.values()],
    cost: {
      scanned: byIdentity.length + accountLegRows,
      identityLegRows: byIdentity.length,
      accountsOfIdentity: accountIds.length,
      accountLegRows,
      duplicatesAcrossLegs,
    },
  };
}

/**
 * `AdminReadSource.listEvents`, with the cost attached.
 *
 * THE ROWS ARE UNWITHHELD AND THAT IS THE PORT'S OWN CONTRACT, in
 * `admin-reads.ts`'s words: "the event feed's page, BEFORE `INV-M6-10` is
 * applied to it". `withholdForScope` is the next step and it is not this one.
 *
 * THE COST IS RETURNED HERE AND DROPPED BY THE COMPOSITION, which is
 * `readFlagQueue`'s and `readIdentityGraph`'s choice for their reason: the
 * port's signature is the contract's and has nowhere to carry it, and a
 * measurement the suite asserts on is worth more than one only a log carries.
 */
export async function readEventFeed(
  tx: EventsTx,
  query: AdminEventQuery,
): Promise<EventFeedResult> {
  const { rows, cost } = await rowsForScope(tx, query.scope);

  const ordered = [...rows].sort(compareRows);
  const after = query.cursor === null ? null : decodeCursor(query.cursor);
  const eligible = after === null ? ordered : ordered.filter((row) => afterCursor(row, after));
  const window = eligible.slice(0, query.limit);
  const last = window.at(-1);
  const more = eligible.length > window.length;

  return {
    page: {
      data: window,
      next_cursor: more && last !== undefined ? cursorOf(last) : null,
    },
    cost,
  };
}
