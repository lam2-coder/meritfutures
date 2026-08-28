// =============================================================================
// apps/api/src/admin-source/flags.ts
// =============================================================================
// `AdminReadSource.listFlags`, AND THE ORDERING IS THE WHOLE FILE.
//
// P7 section 8's `P7-i`. `routes/admin-reads.ts` declared the port and stopped
// at it in writing: "WHAT IS MISSING IS NOT AN AUTHORITY, IT IS A SHAPE ...
// There is no join and no aggregate to reach for". This module is the answer for
// one of the six methods, and the answer is that the join is ORDINARY CODE over
// two keyed reads rather than SQL smuggled through `sqlExecutor`. `P7-g` reached
// the same measurement one deployable over and it is repeated here because it is
// the load-bearing fact: `rowsWhere` returns rows, and a join between two sets
// of rows is a `Map`.
//
// -----------------------------------------------------------------------------
// THE ORDERING, WHICH IS A SECURITY CONTROL AND NOT A PRESENTATION CHOICE
// -----------------------------------------------------------------------------
// `AS-M7-03` clause 3, verbatim (`M07` section 3.2's attack list, line 323):
//
//   "Corroboration outranks any single detector. The queue sorts by the number
//    of INDEPENDENT detector families implicated on an identity, not by raw flag
//    count. One family firing loudly is one signal; three families agreeing is a
//    case. This also means poisoning one detector does not move an identity up
//    the queue."
//
// The attack it answers has no attacker inside the system to catch: every flag
// is TECHNICALLY CORRECT. An adversary trades a public signal service from a
// shared VPN exit, dozens of unrelated strangers cluster on D-01, the operator
// learns that clustering means nothing, and the real ring runs underneath.
// `EC-077`. The scarce resource is attention and no detector measures it.
//
// So the queue's first key is CORROBORATION DEPTH: how many independent detector
// families have fired on this identity. Fifty flags from one family is depth 1.
// Three flags from three families is depth 3. `GS-120`.
//
// -----------------------------------------------------------------------------
// WHAT "INDEPENDENT" MEANS, AND WHY IT IS THE INPUT RATHER THAN THE DETECTOR
// -----------------------------------------------------------------------------
// INDEPENDENCE IS A PROPERTY OF THE INPUT AN ADVERSARY WOULD HAVE TO
// MANUFACTURE, not of the detector's name. `detectors/canary.ts:122` already
// read `M07` section 3.2 that way and named "the four input families M07 section
// 3.2 gives the detector set: `fills`, `daily_marks`, `payout_transfers` and the
// identity graph". This file uses the same reading and extends it to the set.
//
// COUNTING BY DETECTOR, OR BY `flag_type`, WOULD LOSE THE CONTROL ENTIRELY, and
// the loss is arithmetic rather than theoretical. D-01, D-04 and D-05 all read
// `fills` and all write DIFFERENT `flag_type`s: `copy_cluster`, `news_window`
// and `martingale` (`detectors/fills.ts:505`, `:810`, `:1059`). One poisoned
// `fills` stream is therefore THREE flag types and THREE detectors, and a queue
// keyed on either would score the manufactured noise at depth 3 and rank it
// above the real ring. That is `AS-M7-03` executing against the control written
// to stop it.
//
// NO DETECTOR CONTRIBUTES MORE THAN ONE FAMILY, EVER, and that is why a detector
// reading two inputs takes the FIRST input `M07` section 3.2 names rather than
// both. Crediting D-13 with `daily_marks` AND `fills` would let one poisoned
// stream buy two families through one detector, which is the same defect wearing
// a longer table.
//
// AN UNKNOWN DETECTOR IS ITS OWN FAMILY, NAMED BY ITS OWN ID. That is the safe
// default in both directions and neither direction is a guess: it cannot
// inflate, because fifty flags from one unknown detector is still depth 1; and
// it cannot hide a real case, because a genuinely new detector agreeing with two
// known ones still reads depth 3. A default of "no family" would make a new
// detector invisible to corroboration on the day it lands, which is the
// direction that costs a case.
//
// -----------------------------------------------------------------------------
// DEPTH COUNTS UNRESOLVED FLAGS ONLY, AND THE BAND IS BORROWED NOT MINTED
// -----------------------------------------------------------------------------
// `open` and `investigating`. That pair is not a new vocabulary: it is the set
// `G-HOLD-REQUIRED` reads under ADR-040 ("an unresolved flag of severity 4 or
// above, in `open` or `investigating`") and the set `G-EXPIRY-OR-RETRIGGER`
// reads, and `M07` section 3.3 calls it unresolved in those words.
//
// A DISMISSED FLAG IS A DETECTOR AN OPERATOR ALREADY JUDGED WRONG. Counting it
// as corroboration would let an adversary BANK REFUTED NOISE: manufacture a
// hundred clusters, have them dismissed one by one, and every dismissal
// permanently raises the depth of the identity they were manufactured against.
// `enforced` is excluded for the mirror reason: it is a finished case rather
// than a queue item, and a queue ordered by finished cases is ordered by its own
// history.
//
// -----------------------------------------------------------------------------
// THE COLLISION WITH `admin-reads.ts`, WHICH IS REPORTED AND NOT RESOLVED
// -----------------------------------------------------------------------------
// **THIS ORDERING IS REFUSED BY THE ROUTE THAT WOULD SERVE IT, AND THE TWO
// PRIMARY SOURCES DISAGREE WITH EACH OTHER RATHER THAN WITH THIS FILE.**
//
//   API_CONTRACT section 8, `GET /admin/flags`: "Sorted by severity then age."
//   `routes/admin-reads.ts`'s `assertFlagOrder` enforces exactly that, flat
//   across the page, and throws when severity is not monotonically
//   non-increasing. `risk_flags_queue_idx` is built for the same order.
//
//   `M07` `AS-M7-03` clause 3, above: sorted by independent detector families
//   implicated on the identity.
//
// THEY ARE DIFFERENT SORTS OF THE SAME QUEUE and only one of them survives the
// attack. Both documents are `approved`. A corroboration page will contain a
// severity 3 flag above a severity 5 flag whenever the 3 is corroborated and the
// 5 is not, so `assertFlagOrder` refuses this page BY CONSTRUCTION.
//
// **THIS SLICE DOES NOT RESOLVE IT AND MUST NOT.** `admin-reads.ts` is `P7-b`'s
// file and P7 section 9 rows `P7-i` as implementing the port that file declares
// and NOT editing it; changing the contract needs an ADR and no number is
// allocated here. What this slice does instead is three things a later reader
// can act on: it implements the ordering the slice was dispatched to build,
// because that is the half that is a control rather than a convention; it states
// the collision here, at the file that causes it; and
// `test/admin-source-flags.test.ts` asserts the collision MECHANICALLY, reading
// both sentences out of their own documents, so the day either one moves the
// suite says so instead of a 500 discovering it in front of an operator.
//
// **NOTHING WIRES THIS ADAPTER AND SO NOTHING 500s TODAY.** `setAdminReadSource`
// is in `wiring.test.ts`'s `BLOCKED` list and stays there: this directory
// implements two of the port's six methods, so no complete `AdminReadSource`
// exists to install. The collision is a blocker ON the wiring rather than a
// defect IN a deployment, which is the honest shape of it and the reason it is
// reported in prose and in a test rather than repaired in somebody else's file.
//
// -----------------------------------------------------------------------------
// `evidence_summary` CARRIES THE NAMES OF THE NUMBERS AND NEVER THE NUMBERS
// -----------------------------------------------------------------------------
// `detectors/runner.ts` made that choice for `flag.raised` and gave the reason;
// this file makes the same choice for the same reason and cites it rather than
// restating it. `INV-M7-10` keeps detector parameters away from an audience that
// must not have them and `INV-M7-03` keeps the numbers ON the flag, where
// section 8's drill-down reads them. A summary carrying a threshold is a channel
// that discloses the line to the adversary who tripped it, and the contract
// types this field as one `string`, which is not enough room to be careful in.
// =============================================================================

import { AdminReadError, FLAG_SEVERITIES, FLAG_STATUSES } from '../routes/admin-reads.ts';
import type { AdminPage, FlagListItem, FlagListQuery, FlagStatus } from '../routes/admin-reads.ts';

// -----------------------------------------------------------------------------
// The port onto the database
// -----------------------------------------------------------------------------

/**
 * The tables this module reads, and no others.
 *
 * A NARROW UNION RATHER THAN `string`, which is `routes/admin-writes.ts`'s
 * `ADMIN_WRITE_TABLES` idiom one directory over and is adopted for its reason: a
 * typo is a compile error at the call site here, and the suite asserts that
 * every member is a real `TableKey` of `packages/db`. That second half is the
 * one this file cannot make about itself, because `@merit/db` is reachable from
 * `src/db.ts` and from the suite and this module holds no import of it.
 */
export const FLAG_READ_TABLES = ['riskFlags', 'detectorRuns'] as const;

/** One of {@link FLAG_READ_TABLES}. */
export type FlagReadTable = (typeof FLAG_READ_TABLES)[number];

/** A filter or an address, by Drizzle property name. ADR-112's shape. */
export type AdminRowFilter = Readonly<Record<string, unknown>>;

/**
 * ADR-112's keyed accessor, READ HALF ONLY.
 *
 * `insert`, `updateAt`, `deleteAt` and `sqlExecutor` are all ABSENT, and the
 * absence is the point rather than an omission. `SystemTx` carries every one of
 * them and satisfies this interface structurally, so the composition hands the
 * operator door in and this module receives a handle it CANNOT WRITE THROUGH.
 * `INV-M7-02`'s concern is that a detector service holds no grant to move a flag
 * off `open`; the mirror concern for a READ source is that it holds no grant to
 * move anything at all, and here that is a type rather than a convention.
 *
 * `sqlExecutor`'s absence is the one worth naming twice. `SqlExecutorReason` has
 * one member and P7's rules foreclose joining it; a read shape that could reach
 * the executor would make that foreclosure a matter of discipline, and this
 * interface makes it a matter of what the value has on it.
 */
export interface FlagsTx {
  rows(key: FlagReadTable): Promise<unknown[]>;
  rowsWhere(key: FlagReadTable, where: AdminRowFilter): Promise<unknown[]>;
  rowAt(key: FlagReadTable, at: AdminRowFilter): Promise<unknown>;
}

// -----------------------------------------------------------------------------
// The families, transcribed from M07 section 3.2's Input column
// -----------------------------------------------------------------------------

/**
 * The independent inputs a detector can read, closed.
 *
 * `detectors/canary.ts:122` names four of these ("`fills`, `daily_marks`,
 * `payout_transfers` and the identity graph") as the span `AS-M7-05`'s canary
 * shapes had to cover. The other five are the remaining Input cells of `M07`
 * section 3.2, and each is a stream an adversary would have to manufacture
 * SEPARATELY, which is the whole content of the word independent.
 */
export const DETECTOR_FAMILIES = [
  'fills',
  'daily-marks',
  'identity-graph',
  'payout-transfers',
  'account-registry',
  'attributions',
  'rule-states',
  'checkout-enrichment',
  'positions',
] as const;

/** One of {@link DETECTOR_FAMILIES}. */
export type DetectorFamily = (typeof DETECTOR_FAMILIES)[number];

/**
 * Every detector `M07` section 3.2 lists, to the FIRST input its Input cell
 * names.
 *
 * TRANSCRIBED IN THE TABLE'S OWN ORDER so a reader can hold the two side by
 * side, and FIRST-INPUT-ONLY for the reason the header gives: a detector that
 * bought two families would let one poisoned stream buy two, which is the
 * attack.
 *
 * D-14's cell reads "live and end-of-day positions", and `positions` is a table
 * `P7-g` measured as ABSENT from this schema: no `positions` key in `scope.ts`
 * and no `CREATE TABLE` whose name contains `position`. The family is named
 * anyway, because a detector that cannot run today is not a detector whose
 * family is undecided, and the day the table lands this map needs no edit.
 */
export const FAMILY_BY_DETECTOR: Readonly<Record<string, DetectorFamily>> = {
  'D-01': 'fills',
  'D-02': 'daily-marks',
  'D-03': 'daily-marks',
  'D-04': 'fills',
  'D-05': 'fills',
  'D-06': 'daily-marks',
  'D-07': 'account-registry',
  'D-08': 'identity-graph',
  'D-09': 'payout-transfers',
  'D-10': 'attributions',
  'D-11': 'rule-states',
  'D-12': 'identity-graph',
  'D-13': 'daily-marks',
  'D-14': 'positions',
  'D-15': 'checkout-enrichment',
  'D-16': 'identity-graph',
  'D-17': 'fills',
  'D-18': 'identity-graph',
};

/**
 * The family a detector implicates, or the detector's own name.
 *
 * THE FALLBACK IS A FAMILY OF ONE AND NOT A FAMILY OF NONE. See the header: a
 * detector this map has not met contributes exactly one to a depth however many
 * times it fires, which is `AS-M7-03`'s property holding for a detector nobody
 * has classified yet.
 */
export function familyOf(detector: string): string {
  return FAMILY_BY_DETECTOR[detector] ?? detector;
}

/**
 * The statuses a flag counts toward corroboration in.
 *
 * ADR-040's band, borrowed rather than minted. See the header for why a
 * dismissed flag must not count.
 */
export const UNRESOLVED_FLAG_STATUSES = [
  'open',
  'investigating',
] as const satisfies readonly FlagStatus[];

/**
 * The name this file reports a flag's detector under when the row names none.
 *
 * `risk_flags.detector_run_id` IS NULLABLE and `FlagListItem.detector` is a
 * required `string`, so the contract asks for something the schema permits a row
 * not to have. `detectors/runner.ts` stamps the run id on every flag it writes,
 * so no row this repository produces reaches this branch. But
 * `risk_flags.source` is `text NOT NULL DEFAULT 'internal'` and reserves
 * `'vendor:<name>'` "so a QuantSentry-class detector plugs in without a
 * migration", and a vendor row arriving with no run of ours is exactly the shape
 * that would.
 *
 * NAMING IT RATHER THAN THROWING, because one unattributable row must not empty
 * an operator's whole queue, and NAMING IT DISTINCTLY rather than borrowing
 * `source`, because "internal" rendered in a column headed `detector` is a
 * sentence that reads true and is not.
 */
export const UNATTRIBUTED_DETECTOR = 'unattributed';

// -----------------------------------------------------------------------------
// The rows, read defensively
// -----------------------------------------------------------------------------

/** One `risk_flags` row, as much of it as this module reads. */
interface FlagRow {
  readonly id: string;
  readonly identityId: string;
  readonly accountId: string | null;
  readonly flagType: string;
  readonly severity: 1 | 2 | 3 | 4 | 5;
  readonly status: FlagStatus;
  readonly detectorRunId: string | null;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly firstDetectedOn: string;
}

function field(row: unknown, name: string): unknown {
  if (typeof row !== 'object' || row === null)
    throw new AdminReadError(
      `the accessor returned a ${typeof row} where a row was expected. This is the shape of the ` +
        'read being wrong rather than the estate being empty, and an operator must not be shown ' +
        'a queue built out of it',
    );
  return (row as Record<string, unknown>)[name];
}

function text(row: unknown, name: string, at: string): string {
  const value = field(row, name);
  if (typeof value !== 'string' || value === '')
    throw new AdminReadError(
      `${at} carries no \`${name}\`. The column is \`NOT NULL\` in the schema, so an absent ` +
        'value is the transcription disagreeing with the database rather than a row an operator ' +
        'may be shown',
    );
  return value;
}

function nullableText(row: unknown, name: string): string | null {
  const value = field(row, name);
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string')
    throw new AdminReadError(`\`${name}\` is a ${typeof value} where a nullable text was expected`);
  return value;
}

/**
 * A `date` column as the contract's `YYYY-MM-DD`.
 *
 * A `Date` IS ACCEPTED AS WELL AS A STRING, because `assertContractScalars`
 * refuses a `_on` member that is not a trading day and the failure it would
 * produce is a 500 three layers away from the column that caused it. A `Date` is
 * converted through its UTC parts and never through a local-time formatter,
 * because a trading day rendered from a local clock is off by one for the hours
 * the two disagree.
 */
function tradingDay(row: unknown, name: string, at: string): string {
  const value = field(row, name);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const year = String(value.getUTCFullYear()).padStart(4, '0');
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  throw new AdminReadError(
    `${at} carries \`${name}\` as ${JSON.stringify(value)}, which is not an exchange trading ` +
      'day. API_CONTRACT section 1 types every `_on` member as `YYYY-MM-DD`',
  );
}

function readFlagRow(row: unknown): FlagRow {
  const id = text(row, 'id', 'a risk_flags row');
  const at = `flag \`${id}\``;

  const severity = field(row, 'severity');
  const severityNumber = typeof severity === 'bigint' ? Number(severity) : severity;
  if (
    typeof severityNumber !== 'number' ||
    !(FLAG_SEVERITIES as readonly number[]).includes(severityNumber)
  )
    throw new AdminReadError(
      `${at} carries severity ${JSON.stringify(severity)}, which is not one of ` +
        `${FLAG_SEVERITIES.join(', ')}. \`risk_flags\` CHECKs \`severity BETWEEN 1 AND 5\`, so a ` +
        'value outside it is corruption rather than a row to render at some default band',
    );

  const status = text(row, 'status', at);
  const known = FLAG_STATUSES.find((member) => member === status);
  if (known === undefined)
    throw new AdminReadError(
      `${at} carries status \`${status}\`, which is not one of ${FLAG_STATUSES.join(', ')}. ` +
        'STATE_MACHINES section 7 closes that set and the contract transcribes it closed',
    );

  const evidence = field(row, 'evidence');
  if (typeof evidence !== 'object' || evidence === null || Array.isArray(evidence))
    throw new AdminReadError(
      `${at} carries evidence that is not an object. \`risk_flags.evidence\` is ` +
        '`jsonb NOT NULL` and 0008_risk.sql calls it "THE NUMBERS BEHIND THE ACCUSATION, NEVER ' +
        'A BARE LABEL"',
    );

  return {
    id,
    identityId: text(row, 'identityId', at),
    accountId: nullableText(row, 'accountId'),
    flagType: text(row, 'flagType', at),
    severity: severityNumber as 1 | 2 | 3 | 4 | 5,
    status: known,
    detectorRunId: nullableText(row, 'detectorRunId'),
    evidence: evidence as Readonly<Record<string, unknown>>,
    firstDetectedOn: tradingDay(row, 'firstDetectedOn', at),
  };
}

// -----------------------------------------------------------------------------
// Corroboration
// -----------------------------------------------------------------------------

/**
 * One identity's corroboration depth: how many independent families have fired.
 *
 * COMPUTED OVER THE IDENTITY'S WHOLE UNRESOLVED SET AND NEVER OVER THE FILTERED
 * PAGE. If depth were computed over `?severity=5` alone, an operator narrowing
 * the queue would silently rank it by a different key than the queue they
 * narrowed, and the corroboration a filter hides is exactly the corroboration
 * that decides whether the remaining flag matters.
 */
export interface Corroboration {
  readonly identityId: string;
  readonly depth: number;
  readonly families: readonly string[];
}

function corroborationOf(
  identityId: string,
  flags: readonly FlagRow[],
  detectorOf: (flag: FlagRow) => string,
): Corroboration {
  const families = new Set<string>();
  for (const flag of flags) {
    if (!(UNRESOLVED_FLAG_STATUSES as readonly string[]).includes(flag.status)) continue;
    families.add(familyOf(detectorOf(flag)));
  }
  const sorted = [...families].sort();
  return { identityId, depth: sorted.length, families: sorted };
}

// -----------------------------------------------------------------------------
// The ordering
// -----------------------------------------------------------------------------

interface RankedFlag {
  readonly flag: FlagRow;
  readonly detector: string;
  readonly corroboration: Corroboration;
}

/**
 * `AS-M7-03`'s key, and the three tie-breaks under it.
 *
 * 1. CORROBORATION DEPTH, descending. The control. Three families agreeing
 *    outranks one family firing fifty times, whatever the fifty are scored at.
 * 2. SEVERITY, descending. API_CONTRACT section 8's first key, kept as this
 *    ordering's second, so that WITHIN a corroboration band the contract's
 *    stated sort is exactly what an operator gets.
 * 3. AGE, oldest first. The contract's second key, kept as the third. `M07`
 *    section 3.3's clock is why: the older flag is the one that has been
 *    waiting.
 * 4. FLAG ID, ascending. NOT a tie-break anybody reads, and present because a
 *    cursor needs a TOTAL order. Two flags identical in the three keys above are
 *    otherwise unordered, and an unordered pair either repeats or drops across a
 *    page boundary.
 */
function compareRanked(a: RankedFlag, b: RankedFlag): number {
  if (a.corroboration.depth !== b.corroboration.depth)
    return b.corroboration.depth - a.corroboration.depth;
  if (a.flag.severity !== b.flag.severity) return b.flag.severity - a.flag.severity;
  if (a.flag.firstDetectedOn !== b.flag.firstDetectedOn)
    return a.flag.firstDetectedOn < b.flag.firstDetectedOn ? -1 : 1;
  if (a.flag.id === b.flag.id) return 0;
  return a.flag.id < b.flag.id ? -1 : 1;
}

// -----------------------------------------------------------------------------
// The cursor
// -----------------------------------------------------------------------------

/**
 * The page boundary, as the ordering's own key rather than as an offset.
 *
 * AN OFFSET WOULD SKIP A FLAG EVERY TIME ONE AHEAD OF IT IS DISMISSED, which is
 * the failure a work queue cannot have: the row that vanishes is the row nobody
 * looks at again. The key is the full sort tuple of the last item returned, so
 * the next page is "everything strictly after this position in this order".
 *
 * DEPTH IS IN THE KEY AND IT CAN MOVE BETWEEN REQUESTS. A detector firing
 * between two pages raises an identity's depth, and a flag already returned can
 * therefore appear again on a later page. THAT IS THE CORRECT FAILURE DIRECTION
 * and it is a choice rather than an accident: the orderings that cannot repeat a
 * row are the ones that can DROP one, and a dropped flag in a risk queue is the
 * case nobody worked.
 */
const CURSOR_SEPARATOR = ' ';

/** The sort tuple as strings, which is both the cursor and its comparison key. */
function keyOf(entry: RankedFlag): readonly string[] {
  return [
    String(entry.corroboration.depth),
    String(entry.flag.severity),
    entry.flag.firstDetectedOn,
    entry.flag.id,
  ];
}

function cursorOf(entry: RankedFlag): string {
  return Buffer.from(keyOf(entry).join(CURSOR_SEPARATOR), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): readonly string[] {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const parts = decoded.split(CURSOR_SEPARATOR);
  if (parts.length !== 4)
    throw new AdminReadError(
      `the flag queue was handed a cursor carrying ${String(parts.length)} components where the ` +
        'ordering has four. A cursor from a different ordering would page through this one at a ' +
        'position that means nothing',
    );
  if (!Number.isInteger(Number(parts[0])) || !Number.isInteger(Number(parts[1])))
    throw new AdminReadError(
      'the flag queue was handed a cursor whose depth or severity is not an integer, so the ' +
        'position it names is not one this ordering has',
    );
  return parts;
}

/**
 * Whether `entry` falls strictly after `cursor` IN THIS ORDERING.
 *
 * It compares component by component on the ordering's own directions rather
 * than lexically, because depth and severity are DESCENDING and a lexical walk
 * over the same four components would page in the wrong direction on both. The
 * two numbers are compared as numbers for the same class of reason: "10" sorts
 * before "9" as text.
 */
function afterCursor(entry: RankedFlag, cursor: readonly string[]): boolean {
  const key = keyOf(entry);
  const depth = Number(key[0]);
  const cursorDepth = Number(cursor[0]);
  if (depth !== cursorDepth) return depth < cursorDepth;
  const severity = Number(key[1]);
  const cursorSeverity = Number(cursor[1]);
  if (severity !== cursorSeverity) return severity < cursorSeverity;
  if (key[2] !== cursor[2]) return (key[2] ?? '') > (cursor[2] ?? '');
  return (key[3] ?? '') > (cursor[3] ?? '');
}

// -----------------------------------------------------------------------------
// The read
// -----------------------------------------------------------------------------

/**
 * What one call cost, so a page nobody expected to be expensive is a number
 * rather than a surprise.
 *
 * `P7-g` measured its detector's read amplification and recorded the ratio; this
 * is the same measurement one deployable over, and it exists because the shape
 * of this read is 1 + N accessor calls where N is the distinct identities
 * matching the filter. A queue filtered to nothing reads every flag of every
 * identity that has one.
 */
export interface FlagQueueCost {
  readonly filteredFlags: number;
  readonly identities: number;
  readonly corroborationRows: number;
  readonly detectorRuns: number;
}

/** {@link readFlagQueue}'s page, plus what it cost. */
export interface FlagQueueResult {
  readonly page: AdminPage<FlagListItem>;
  readonly cost: FlagQueueCost;
}

/**
 * `AdminReadSource.listFlags`, with the cost attached.
 *
 * THE COST IS RETURNED HERE AND DROPPED BY THE COMPOSITION, which is deliberate:
 * the port's signature is the contract's and gains nothing from it, and a
 * measurement the suite can assert on is worth more than one only a log carries.
 */
export async function readFlagQueue(tx: FlagsTx, query: FlagListQuery): Promise<FlagQueueResult> {
  // 1. THE FILTERED SET, PUSHED DOWN AS FAR AS THE VOCABULARY GOES.
  //
  // ADR-112's filter is a TYPED EQUALITY over declared columns, ANDed. All three
  // of section 8's filters are equalities, so all three push down and none of
  // them needs ADR-157's range term or its `IS NULL`.
  //
  // AN EMPTY FILTER IS `rows` AND NOT AN EMPTY OBJECT. `P7-g` measured that an
  // empty filter does not compile, and "the whole table" spelled as a narrowing
  // that happens to be true is a cast wearing a predicate. Section 8 makes this
  // queue FILTERABLE rather than filtered, so the unfiltered read is the correct
  // request and not a fallback.
  const filter: Record<string, unknown> = {};
  if (query.flagType !== null) filter['flagType'] = query.flagType;
  if (query.status !== null) filter['status'] = query.status;
  if (query.severity !== null) filter['severity'] = query.severity;
  const filtered = (
    Object.keys(filter).length === 0
      ? await tx.rows('riskFlags')
      : await tx.rowsWhere('riskFlags', filter)
  ).map(readFlagRow);

  // 2. EVERY FLAG OF EVERY IDENTITY ON THE FILTERED SET.
  //
  // One `rowsWhere` per distinct identity. This is the join `admin-reads.ts`
  // said it had no shape for, and it is a `Map`: the accessor returns rows and
  // rows group in memory.
  const identityIds = [...new Set(filtered.map((flag) => flag.identityId))].sort();
  const flagsByIdentity = new Map<string, readonly FlagRow[]>();
  for (const identityId of identityIds)
    flagsByIdentity.set(
      identityId,
      (await tx.rowsWhere('riskFlags', { identityId })).map(readFlagRow),
    );

  // 3. THE DETECTOR BEHIND EACH FLAG, ONE `rowAt` PER DISTINCT RUN.
  //
  // NOT `rows('detectorRuns')`. That table is one row per detector per night
  // forever, so reading it whole to name the detectors on one page grows without
  // bound in the operating age of the firm, while the addressed read grows with
  // the page.
  const runIds = new Set<string>();
  for (const rows of flagsByIdentity.values())
    for (const flag of rows) if (flag.detectorRunId !== null) runIds.add(flag.detectorRunId);
  const detectorByRun = new Map<string, string>();
  for (const runId of [...runIds].sort()) {
    const run = await tx.rowAt('detectorRuns', { id: runId });
    // A flag pointing at a run that is not there. `detector_run_id` REFERENCES
    // `detector_runs(id) ON DELETE RESTRICT`, so this cannot happen while the
    // constraint holds, and it is not a throw for UNATTRIBUTED_DETECTOR's
    // reason: one bad row must not empty an operator's queue.
    if (run === undefined || run === null) continue;
    detectorByRun.set(runId, text(run, 'detector', `detector run \`${runId}\``));
  }
  const detectorOf = (flag: FlagRow): string =>
    flag.detectorRunId === null
      ? UNATTRIBUTED_DETECTOR
      : (detectorByRun.get(flag.detectorRunId) ?? UNATTRIBUTED_DETECTOR);

  // 4. THE ORDERING.
  const corroborations = new Map<string, Corroboration>();
  for (const [identityId, rows] of flagsByIdentity)
    corroborations.set(identityId, corroborationOf(identityId, rows, detectorOf));

  const ranked = filtered
    .map((flag) => ({
      flag,
      detector: detectorOf(flag),
      corroboration: corroborations.get(flag.identityId) ?? {
        identityId: flag.identityId,
        depth: 0,
        families: [],
      },
    }))
    .sort(compareRanked);

  // 5. THE PAGE.
  const after = query.cursor === null ? null : decodeCursor(query.cursor);
  const eligible = after === null ? ranked : ranked.filter((entry) => afterCursor(entry, after));
  const window = eligible.slice(0, query.limit);
  const last = window.at(-1);
  const more = eligible.length > window.length;

  let corroborationRows = 0;
  for (const rows of flagsByIdentity.values()) corroborationRows += rows.length;

  return {
    page: {
      data: window.map(projectRanked),
      next_cursor: more && last !== undefined ? cursorOf(last) : null,
    },
    cost: {
      filteredFlags: filtered.length,
      identities: identityIds.length,
      corroborationRows,
      detectorRuns: runIds.size,
    },
  };
}

/** One `FlagListItem`, field by field. A spread would be `SELECT *`. */
function projectRanked(entry: RankedFlag): FlagListItem {
  return {
    flag_id: entry.flag.id,
    identity_id: entry.flag.identityId,
    account_id: entry.flag.accountId,
    flag_type: entry.flag.flagType,
    severity: entry.flag.severity,
    status: entry.flag.status,
    first_detected_on: entry.flag.firstDetectedOn,
    detector: entry.detector,
    // The names of the numbers, sorted, and never the numbers. See the header.
    evidence_summary: Object.keys(entry.flag.evidence).sort().join(', '),
  };
}

/**
 * The corroboration behind one page, for a caller that needs the reasoning
 * rather than the rows.
 *
 * EXPORTED SO THE SUITE CAN ASSERT THE KEY DIRECTLY, and available to `P7-l`'s
 * weekly flag-queue digest, whose whole subject is which identities are
 * corroborated rather than which flags exist.
 */
export async function readCorroboration(tx: FlagsTx, identityId: string): Promise<Corroboration> {
  const rows = (await tx.rowsWhere('riskFlags', { identityId })).map(readFlagRow);
  const runIds = new Set(
    rows.flatMap((flag) => (flag.detectorRunId === null ? [] : [flag.detectorRunId])),
  );
  const detectorByRun = new Map<string, string>();
  for (const runId of [...runIds].sort()) {
    const run = await tx.rowAt('detectorRuns', { id: runId });
    if (run === undefined || run === null) continue;
    detectorByRun.set(runId, text(run, 'detector', `detector run \`${runId}\``));
  }
  return corroborationOf(identityId, rows, (flag) =>
    flag.detectorRunId === null
      ? UNATTRIBUTED_DETECTOR
      : (detectorByRun.get(flag.detectorRunId) ?? UNATTRIBUTED_DETECTOR),
  );
}
