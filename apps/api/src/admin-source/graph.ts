// =============================================================================
// apps/api/src/admin-source/graph.ts
// =============================================================================
// `AdminReadSource.readIdentityGraph`, WHICH IS A WALK AND NOT A PROJECTION, and
// that is precisely what `routes/admin-reads.ts` said it had no shape for:
// "`IdentityGraph` is a walk. There is no join and no aggregate to reach for".
//
// THE MEASUREMENT SAYS THE WALK IS ORDINARY CODE. `identity_links` is reachable
// through `rowsWhere` twice per identity, a breadth-first search over the rows
// that come back is a `Set` and a queue, and every number in the response is a
// sum over rows this vocabulary already returns. `P7-g` reached the same
// conclusion for the detectors and it holds here for the same reason: the
// accessor withholds SQL, not answers.
//
// -----------------------------------------------------------------------------
// THE DISJUNCTION IS TWO READS, AND IT IS THE SCHEMA'S SHAPE RATHER THAN A
// LIMITATION OF THE ACCESSOR
// -----------------------------------------------------------------------------
// `identity_links_canonical_order` CHECKs `identity_a < identity_b`, so an edge
// is stored ONCE and which column a person lands in is decided by uuid ordering
// (`0002_identity.sql`, and `identityLinks` states it at length at
// `scope.ts:1333`). A filter is a
// conjunction of equalities, so "every edge touching X" is `identity_a = X` ORed
// with `identity_b = X`, and this module spells that as TWO reads unioned in
// memory rather than reaching for a predicate the accessor does not offer.
//
// The alternative would be `sqlExecutor`, whose vocabulary has one member that
// is not this, and P7's rules foreclose joining it. Two calls is the whole cost
// of that foreclosure here.
//
// -----------------------------------------------------------------------------
// SUPPRESSED EDGES ARE SHOWN AND NOT TRAVERSED, AND BOTH HALVES ARE RULINGS
// -----------------------------------------------------------------------------
// `SD-M7-04` and `INV-M7-09`: a trader may CONTEST a link, the dispute renders
// on the graph, and "an admin sees it BEFORE acting rather than after". So a
// suppressed edge cannot be hidden from this response: the whole point of the
// dispute path is that the operator is shown it at the moment they act.
//
// `schema.ts` states the other half in its own words: "a suppressed edge stays
// visible as history and STOPS CONTRIBUTING TO ENFORCEMENT, and the edge is
// never deleted because `we decided this edge was wrong` is itself evidence".
// Cluster membership IS the contribution to enforcement here, because the
// aggregate this response returns is what an operator reads before restricting
// a set of people (`AS-M7-04`). So a suppressed edge does not pull its far
// endpoint into the cluster.
//
// THE TWO TOGETHER MAKE THE GRAPH CLOSED: the walk crosses live edges only, and
// the edge list is every edge, suppressed or not, whose BOTH endpoints the walk
// already reached. An edge to an identity outside the cluster would be an edge
// with no node, which renders as a dangling line pointing at a uuid, and a
// suppressed edge that was the only path to somebody is exactly the person
// suppression decided is not in this cluster.
//
// -----------------------------------------------------------------------------
// THE NODE CAP IS A REFUSAL AND NEVER A TRUNCATION
// -----------------------------------------------------------------------------
// A walk needs a bound and the corpus states no number, which is reported rather
// than resolved: {@link DEFAULT_GRAPH_LIMITS} is this file's, it is a parameter
// rather than a constant, and nothing in `M06`, `M07` or ADR-022 rules it.
//
// WHAT IS NOT A JUDGMENT CALL IS WHAT HAPPENS AT THE BOUND. A truncated graph
// carries an `aggregate` that is WRONG AND LOOKS RIGHT, and `AS-M7-04` is the
// scenario where an operator restricts a family on exactly that kind of screen.
// So reaching the cap raises rather than trims: `INV-M6-04`'s discipline that
// "a figure whose freshness is unstated is a figure that will eventually be
// quoted stale in a decision that mattered" applies with more force to a figure
// whose COMPLETENESS is unstated.
//
// -----------------------------------------------------------------------------
// TWO MONEY FIGURES THAT LOOK LIKE THE SAME SUM AND ARE NOT
// -----------------------------------------------------------------------------
// `nodes[].total_withdrawable_cents` is EVERY account the identity holds.
// `aggregate.open_liability_cents` is FUNDED accounts only, because that is what
// open liability is: `0009_ledger.sql:168` defines it as "the sum of withdrawable
// across funded accounts" and `P-M6-01` is that sentence. They coincide whenever
// an evaluation account carries zero withdrawable, which is most of the time,
// and the day they do not the difference is the whole distinction between what
// a cluster HOLDS and what the firm OWES. Summing the node figures to produce
// the aggregate would be correct-looking and wrong, so this file computes them
// from the account rows separately and never one from the other.
//
// `aggregate.payouts_lifetime_cents` is `payout_requests.trader_cents` on
// SETTLED requests. `trader_cents` rather than `approved_cents` because
// `approved_cents = trader_cents + firm_cents` is a CHECK on the row and
// `firm_cents` is revenue that never left the building; a risk reader asking
// what a cluster has EXTRACTED is asking about the trader leg. SETTLED rather
// than approved because an approved request that failed on the rail moved
// nothing.
//
// MONEY IS INTEGER CENTS AND THE COLUMNS ARE `bigint`. Every conversion goes
// through {@link cents}, which refuses a value outside the safe integer range
// rather than handing `assertContractScalars` a number that lost its low bits
// three layers away from the column that produced it.
//
// -----------------------------------------------------------------------------
// "LATEST `rule_states` ROW PER ACCOUNT" IS AN ARGMAX AND IT IS DONE IN MEMORY
// -----------------------------------------------------------------------------
// `withdrawable_cents` lives on `rule_states`, one row per account per trading
// day, and the current figure is the row with the greatest `trading_day`. That
// is a per-group maximum, which is an AGGREGATE, and ADR-157 admits a range term
// and an `IS NULL` on the read path and REFUSES the scalar aggregate.
//
// SO IT IS NOT REACHED FOR. The rows come back through `rowsWhere` and the
// argmax is a loop, which costs every stored day of every account in the cluster
// to answer a question about one day each. {@link IdentityGraphCost} reports the
// ratio rather than leaving it to be discovered, and it is the honest price of
// not widening the accessor: the alternative was an aggregate the ruling refuses
// and no clause of it is bent here.
// =============================================================================

import { AdminReadError } from '../routes/admin-reads.ts';
import type { IdentityGraph } from '../routes/admin-reads.ts';
import type { AdminRowFilter } from './flags.ts';

// -----------------------------------------------------------------------------
// The port onto the database
// -----------------------------------------------------------------------------

/**
 * The tables this module reads, and no others.
 *
 * `routes/admin-writes.ts`'s `ADMIN_WRITE_TABLES` idiom, for its reason: a typo
 * is a compile error here and the suite asserts every member is a real
 * `TableKey` of `packages/db`, which is the half this module cannot make about
 * itself because it holds no import of that package.
 */
export const GRAPH_READ_TABLES = [
  'identities',
  'accounts',
  'identityLinks',
  'ruleStates',
  'payoutRequests',
] as const;

/** One of {@link GRAPH_READ_TABLES}. */
export type GraphReadTable = (typeof GRAPH_READ_TABLES)[number];

/**
 * ADR-112's keyed accessor, READ HALF ONLY, over this module's five tables.
 *
 * `flags.ts`'s `FlagsTx` states why the write half is absent rather than
 * omitted, and the reason is the same one: `SystemTx` satisfies this
 * structurally and a handle narrowed to this shape cannot write, cannot delete,
 * and cannot reach `sqlExecutor`.
 */
export interface GraphTx {
  rowsWhere(key: GraphReadTable, where: AdminRowFilter): Promise<unknown[]>;
  rowAt(key: GraphReadTable, at: AdminRowFilter): Promise<unknown>;
}

// -----------------------------------------------------------------------------
// The bounds
// -----------------------------------------------------------------------------

/**
 * How far the walk may go before it refuses.
 *
 * **NO CORPUS NUMBER RULES EITHER OF THESE AND THAT IS REPORTED RATHER THAN
 * HIDDEN.** `M06` section 3 renders the tier from `confidence_bp` and states no
 * size; `M07` section 3.1's tiers are about what a link MEANS rather than how
 * many there may be; ADR-022's signal-weight table is config that does not
 * exist. These are this file's, they are a parameter so a deployment can move
 * them without a deploy of this module, and the day a number is ruled the
 * default moves to it.
 *
 * `maxNodes` is the one that binds. `maxDepth` exists because a cluster can be
 * WIDE and SHALLOW, and an operator looking at one identity is asking about its
 * neighbourhood rather than about the transitive closure of the estate.
 */
export interface GraphLimits {
  readonly maxNodes: number;
  readonly maxDepth: number;
}

/** {@link GraphLimits}, defaulted. See that type for why these are not ruled. */
export const DEFAULT_GRAPH_LIMITS: GraphLimits = { maxNodes: 200, maxDepth: 4 };

/**
 * What one graph read cost.
 *
 * `ruleStatesRead` against `accounts` is the ratio the header's argmax section
 * prices: it is every stored day of every account in the cluster, read to answer
 * one day per account.
 */
export interface IdentityGraphCost {
  readonly identities: number;
  readonly accounts: number;
  readonly edgeReads: number;
  readonly ruleStatesRead: number;
  readonly payoutRequestsRead: number;
  readonly depthReached: number;
}

/** {@link readIdentityGraph}'s answer, plus what it cost. */
export interface IdentityGraphResult {
  readonly graph: IdentityGraph;
  readonly cost: IdentityGraphCost;
}

// -----------------------------------------------------------------------------
// The rows, read defensively
// -----------------------------------------------------------------------------

function field(row: unknown, name: string): unknown {
  if (typeof row !== 'object' || row === null)
    throw new AdminReadError(
      `the accessor returned a ${typeof row} where a row was expected. An operator graph built ` +
        'out of that would render a cluster shape nothing in the estate has',
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

/**
 * A `bigint` money column as the contract's JSON integer.
 *
 * API_CONTRACT section 1: "`*_cents` are JSON integers ... No floats, no
 * formatted strings". A `bigint` past 2^53 cannot be one, and silently rounding
 * it would put a number on a liability screen that is wrong in its low digits
 * and right in every digit an operator reads.
 */
function cents(value: unknown, at: string): number {
  const asNumber =
    typeof value === 'bigint'
      ? Number(value)
      : typeof value === 'number'
        ? value
        : typeof value === 'string' && /^-?\d+$/.test(value)
          ? Number(value)
          : Number.NaN;
  if (!Number.isSafeInteger(asNumber))
    throw new AdminReadError(
      `${at} is ${JSON.stringify(typeof value === 'bigint' ? value.toString() : value)}, which ` +
        'is not a safe integer number of cents. API_CONTRACT section 1 types every `_cents` ' +
        'member as a JSON integer and a rounded one is wrong where it is hardest to notice',
    );
  return asNumber;
}

/** A `date` column as a comparable string. `YYYY-MM-DD` sorts correctly as text. */
function day(row: unknown, name: string, at: string): string {
  const value = field(row, name);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const year = String(value.getUTCFullYear()).padStart(4, '0');
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const date = String(value.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${date}`;
  }
  throw new AdminReadError(
    `${at} carries \`${name}\` as ${JSON.stringify(value)}, which is not an exchange trading day`,
  );
}

interface EdgeRow {
  readonly id: string;
  readonly a: string;
  readonly b: string;
  readonly linkKind: string;
  readonly confidenceBp: number;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly suppressed: boolean;
}

function readEdgeRow(row: unknown): EdgeRow {
  const id = text(row, 'id', 'an identity_links row');
  const at = `identity link \`${id}\``;

  const confidence = field(row, 'confidenceBp');
  const confidenceBp = typeof confidence === 'bigint' ? Number(confidence) : confidence;
  if (typeof confidenceBp !== 'number' || !Number.isInteger(confidenceBp))
    throw new AdminReadError(
      `${at} carries \`confidence_bp\` as ${JSON.stringify(confidence)}. ADR-022 made the graph ` +
        'scored and never boolean, and the column is CHECKed 0 to 10000 as an integer',
    );

  const evidence = field(row, 'evidence');
  if (typeof evidence !== 'object' || evidence === null || Array.isArray(evidence))
    throw new AdminReadError(
      `${at} carries evidence that is not an object, and \`identity_links.evidence\` is ` +
        '`jsonb NOT NULL` because "an edge without its evidence is an accusation without a reason"',
    );

  const suppressed = field(row, 'suppressed');
  if (typeof suppressed !== 'boolean')
    throw new AdminReadError(
      `${at} carries \`suppressed\` as ${JSON.stringify(suppressed)}. The column is ` +
        '`boolean NOT NULL DEFAULT false` and a graph that guessed at it would traverse an edge ' +
        'a trader successfully contested',
    );

  return {
    id,
    a: text(row, 'identityA', at),
    b: text(row, 'identityB', at),
    linkKind: text(row, 'linkKind', at),
    confidenceBp,
    evidence: evidence as Readonly<Record<string, unknown>>,
    suppressed,
  };
}

// -----------------------------------------------------------------------------
// The walk
// -----------------------------------------------------------------------------

/**
 * Every edge touching one identity, as the two reads the canonical order forces.
 *
 * Deduplicated by `identity_links.id`, because an edge from an identity to
 * itself would come back from both reads and `identity_links_canonical_order`
 * does not forbid one: it CHECKs `identity_a < identity_b`, and a self-edge
 * fails that CHECK, so the dedupe is defence against a constraint being dropped
 * rather than against a row that exists today.
 */
async function edgesTouching(
  tx: GraphTx,
  identityId: string,
  into: Map<string, EdgeRow>,
): Promise<void> {
  for (const column of ['identityA', 'identityB'] as const) {
    const rows = await tx.rowsWhere('identityLinks', { [column]: identityId });
    for (const row of rows) {
      const edge = readEdgeRow(row);
      into.set(edge.id, edge);
    }
  }
}

interface AccountRow {
  readonly id: string;
  readonly identityId: string;
  readonly phase: string;
}

/**
 * `AdminReadSource.readIdentityGraph`, with the cost attached.
 *
 * `null` WHEN THE ROOT IDENTITY IS NOT THERE, which the route turns into a 404.
 * An identity with no links is NOT that case: it is a graph of one node with no
 * edges, and answering 404 for it would tell an operator that a real person does
 * not exist because nobody has been linked to them.
 */
export async function readIdentityGraph(
  tx: GraphTx,
  identityId: string,
  limits: GraphLimits = DEFAULT_GRAPH_LIMITS,
): Promise<IdentityGraphResult | null> {
  const rootRow = await tx.rowAt('identities', { id: identityId });
  if (rootRow === undefined || rootRow === null) return null;

  // 1. THE WALK, ACROSS LIVE EDGES ONLY. See the header for why suppression
  //    bounds membership and not visibility.
  const edges = new Map<string, EdgeRow>();
  const reached = new Map<string, number>([[identityId, 0]]);
  let frontier: readonly string[] = [identityId];
  let edgeReads = 0;
  let depthReached = 0;

  for (let depth = 0; depth < limits.maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const current of frontier) {
      await edgesTouching(tx, current, edges);
      edgeReads += 2;
    }
    for (const edge of edges.values()) {
      if (edge.suppressed) continue;
      for (const [near, far] of [
        [edge.a, edge.b],
        [edge.b, edge.a],
      ] as const) {
        if (!frontier.includes(near) || reached.has(far)) continue;
        if (reached.size >= limits.maxNodes)
          throw new AdminReadError(
            `the identity graph rooted at \`${identityId}\` reaches more than ` +
              `${String(limits.maxNodes)} identities. It is REFUSED rather than truncated: a ` +
              'partial graph carries an `aggregate` that is wrong and looks right, and AS-M7-04 ' +
              'is an operator restricting people on exactly that screen',
          );
        reached.set(far, depth + 1);
        next.push(far);
        depthReached = Math.max(depthReached, depth + 1);
      }
    }
    frontier = next;
  }

  const members = [...reached.keys()].sort();
  const memberSet = new Set(members);

  // 2. THE NODES. One `rowAt` for the identity and one `rowsWhere` for its
  //    accounts, per member.
  const identityRows = new Map<string, unknown>([[identityId, rootRow]]);
  const accountsByIdentity = new Map<string, readonly AccountRow[]>();
  for (const member of members) {
    if (!identityRows.has(member)) {
      const row = await tx.rowAt('identities', { id: member });
      // A link naming an identity that is not there. `identity_a` and
      // `identity_b` both REFERENCE `identities(id) ON DELETE RESTRICT`, so this
      // cannot happen while the constraint holds. It is a refusal rather than a
      // skip because a missing NODE changes the aggregate, which is the number
      // the cap section refuses to let be silently wrong.
      if (row === undefined || row === null)
        throw new AdminReadError(
          `the identity graph rooted at \`${identityId}\` reaches \`${member}\`, which has no ` +
            '`identities` row. `identity_links` references that table `ON DELETE RESTRICT`, so ' +
            'the edge and the estate disagree and the aggregate cannot be computed',
        );
      identityRows.set(member, row);
    }
    const rows = await tx.rowsWhere('accounts', { identityId: member });
    accountsByIdentity.set(
      member,
      rows.map((row) => {
        const id = text(row, 'id', 'an accounts row');
        return { id, identityId: member, phase: text(row, 'phase', `account \`${id}\``) };
      }),
    );
  }

  // 3. THE MONEY. The argmax the header prices, then two sums with different
  //    denominators.
  let ruleStatesRead = 0;
  const withdrawableByAccount = new Map<string, number>();
  for (const rows of accountsByIdentity.values())
    for (const account of rows) {
      const states = await tx.rowsWhere('ruleStates', { accountId: account.id });
      ruleStatesRead += states.length;
      let latestDay: string | null = null;
      let latest = 0;
      for (const state of states) {
        const at = `rule_states for account \`${account.id}\``;
        const tradingDay = day(state, 'tradingDay', at);
        if (latestDay !== null && tradingDay <= latestDay) continue;
        latestDay = tradingDay;
        latest = cents(field(state, 'withdrawableCents'), `${at} on ${tradingDay}`);
      }
      // AN ACCOUNT WITH NO STORED STATE IS ZERO AND NOT AN ERROR. `rule_states`
      // is written by the nightly batch, so an account opened today has none,
      // and refusing the graph for it would make a new account able to hide a
      // cluster.
      withdrawableByAccount.set(account.id, latest);
    }

  let payoutRequestsRead = 0;
  const payoutsByIdentity = new Map<string, number>();
  for (const member of members) {
    const rows = await tx.rowsWhere('payoutRequests', { identityId: member, status: 'settled' });
    payoutRequestsRead += rows.length;
    let total = 0;
    for (const row of rows)
      total += cents(field(row, 'traderCents'), `a settled payout request of \`${member}\``);
    payoutsByIdentity.set(member, total);
  }

  // 4. THE RESPONSE, field by field. A spread would be `SELECT *`.
  const nodes = members.map((member) => {
    const accounts = accountsByIdentity.get(member) ?? [];
    let total = 0;
    for (const account of accounts) total += withdrawableByAccount.get(account.id) ?? 0;
    return {
      identity_id: member,
      status: text(identityRows.get(member), 'status', `identity \`${member}\``),
      accounts: accounts.length,
      total_withdrawable_cents: total,
    };
  });

  let accountCount = 0;
  let openLiabilityCents = 0;
  let payoutsLifetimeCents = 0;
  for (const member of members) {
    for (const account of accountsByIdentity.get(member) ?? []) {
      accountCount += 1;
      // FUNDED ONLY. `0009_ledger.sql:168`, `P-M6-01`. See the header for why
      // this is computed from the account rows rather than summed off the nodes.
      if (account.phase === 'funded')
        openLiabilityCents += withdrawableByAccount.get(account.id) ?? 0;
    }
    payoutsLifetimeCents += payoutsByIdentity.get(member) ?? 0;
  }

  const rootAccounts = accountsByIdentity.get(identityId) ?? [];
  return {
    graph: {
      root: {
        identity_id: identityId,
        status: text(rootRow, 'status', `identity \`${identityId}\``),
        accounts: rootAccounts.length,
      },
      nodes,
      // EVERY EDGE WITH BOTH ENDPOINTS IN THE CLUSTER, SUPPRESSED OR NOT.
      // SD-M7-04 puts the dispute in front of the admin before they act, and a
      // closed graph is what stops a suppressed edge rendering as a line to a
      // uuid that is not on the screen.
      edges: [...edges.values()]
        .filter((edge) => memberSet.has(edge.a) && memberSet.has(edge.b))
        .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
        .map((edge) => ({
          a: edge.a,
          b: edge.b,
          link_kind: edge.linkKind,
          confidence_bp: edge.confidenceBp,
          evidence: edge.evidence,
        })),
      aggregate: {
        identities: members.length,
        accounts: accountCount,
        open_liability_cents: openLiabilityCents,
        payouts_lifetime_cents: payoutsLifetimeCents,
      },
    },
    cost: {
      identities: members.length,
      accounts: accountCount,
      edgeReads,
      ruleStatesRead,
      payoutRequestsRead,
      depthReached,
    },
  };
}
