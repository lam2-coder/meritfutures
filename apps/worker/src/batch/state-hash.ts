// =============================================================================
// apps/worker/src/batch/state-hash.ts
// =============================================================================
// SD-08's `state_hash`: SHA-256 over a canonical serialization of the nineteen
// columns ADR-026 C-07 declares, IN C-07's ORDER.
//
// WHY THIS FILE IS IN apps/worker AND NOT packages/rules-engine/src/hash.ts,
// WHICH IS WHERE M01 SECTION 1.3 PUTS IT. Two reasons, and the second one is
// not a scheduling accident:
//
//   1. Three sessions own `packages/rules-engine/src/` right now. Writing here
//      is the collision this session was fenced to avoid.
//   2. `merit/engine-purity` REPORTS EVERY NON-RELATIVE IMPORT inside
//      `packages/rules-engine/src/**`, so `import { createHash } from
//      'node:crypto'` is a lint error there today, while M01 section 1.4's own
//      banned-constructs table permits "`crypto` BEYOND A PURE HASH". The prose
//      allows the import the rule refuses. That contradiction is real, it is
//      not this session's to rule, and it is carried as an open item in the
//      session log: whoever writes `hash.ts` must either take a scoped lint
//      exception or hand-roll SHA-256, and neither is a decision to make in
//      passing.
//
// The module is written so that resolving it is a FILE MOVE: it imports the
// engine's published types and `node:crypto` and nothing else, holds no state,
// reads no clock, and touches no database.
//
// -----------------------------------------------------------------------------
// WHAT THE HASH IS FOR, so the exclusions below read as design rather than trim
// -----------------------------------------------------------------------------
// INV-04: "replaying every mark from day one reproduces stored state
// byte-identically". M01 Appendix B.2 compares `state_hash` FIRST and diffs
// field by field only on mismatch, because the alternative at 5,000 accounts is
// a field-by-field comparison of roughly 1.25M rows, and FM-17 is what happens
// to a self-audit that becomes slow: it becomes one that gets disabled.
//
// So every column in or out of this hash is a decision about what a nightly
// page means. A column that is IN and should be OUT pages the whole book on the
// first ordinary change to it. A column that is OUT and should be IN lets a
// real divergence through silently.

import { createHash } from 'node:crypto';

import type { EngineGateResults, RuleState, TradingDay } from '@merit/rules-engine';

// -----------------------------------------------------------------------------
// The framing, which the sources do not specify and which cannot be left open
// -----------------------------------------------------------------------------
// ADR-026 C-07 and M01 Appendix B.2 give three rendering rules and no SEPARATOR:
// "fields in the fixed declared order below, `bigint` rendered base-10, `null`
// as an explicit sentinel, no whitespace."
//
// PLAIN CONCATENATION IS NOT INJECTIVE AND THE COLLISION IS ONE COLUMN PAIR
// AWAY. `traded_days_count = 1, win_days_count = 23` and `traded_days_count =
// 12, win_days_count = 3` both render "123". Two genuinely different states
// would carry one hash, replay would compare them as equal, and INV-04 would be
// asserting nothing on exactly the pair of counters R-33 and R-34 gate on. A
// hash that silently agrees is worse than no hash, because it reports like a
// hash that checked.
//
// SO EACH FIELD IS LENGTH-PREFIXED: `<utf8 byte length>:<utf8 bytes>`. This is
// injective for every possible value with no argument about the value domains,
// which is the property to want here: a separator character is injective only
// while no field can contain it, and that is a claim a future column can
// falsify quietly. The prefix is digits and a colon, so "no whitespace" holds.
// The length counts BYTES rather than characters, so a non-ASCII value could
// never make two different strings frame identically.
//
// THIS IS A CHOICE THE SOURCES DO NOT MAKE, AND IT FIXES EVERY STORED HASH
// FOREVER. It is made now rather than later because `rule_states` has zero rows
// today (`0035`'s header says so in its own words: "the ADD COLUMN below is a
// metadata-only change and there is no existing row"), so this is the only
// moment at which choosing costs nothing. It is flagged for the founder's read
// rather than buried: changing the framing after the first row lands invalidates
// every hash in the table and there is no migration that repairs it, only a
// full audited rewrite under Appendix B.4.

/** `<utf8 byte length>:<utf8 bytes>`. Injective for every value, no whitespace. */
function frame(value: string): string {
  return `${String(Buffer.byteLength(value, 'utf8'))}:${value}`;
}

/**
 * C-07's "null as an explicit sentinel".
 *
 * `~null` cannot collide with any value it stands in for: every nullable input
 * here is a `TradingDay` (`YYYY-MM-DD`) or a base-10 integer, and neither
 * alphabet contains `~`. The framing above would make the hash injective even
 * with a colliding sentinel; a sentinel that cannot collide on its own is the
 * cheaper of two independent guarantees, not a substitute for it.
 */
const NULL_SENTINEL = '~null';

/** Thrown when a value cannot be rendered. A malformed input is loud, never hashed. */
export class StateHashError extends Error {
  override readonly name = 'StateHashError';
}

/** `YYYY-MM-DD`, which is what `TradingDay`'s brand asserts and nothing enforces. */
const TRADING_DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Canonical lowercase UUID, which is `uuid`'s output representation in Postgres.
 *
 * ASSERTED RATHER THAN NORMALIZED. Normalizing would let a caller that started
 * sending upper case keep working while every hash it produced changed, which
 * is a divergence whose cause is invisible in the diff: the account id is the
 * one hashed column that does not appear in `RuleState` and so cannot be read
 * back off the row the engine produced.
 */
const ACCOUNT_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function text(value: string): string {
  return value;
}

function bool(value: boolean): string {
  return value ? 'true' : 'false';
}

/** C-07: "`bigint` rendered base-10". `toString()` is base-10 with a `-` sign. */
function money(value: bigint): string {
  return value.toString(10);
}

/**
 * The `integer` columns and the basis-point and day-count fields inside the
 * gates.
 *
 * It throws on a non-integer rather than rounding. `-0` renders "0" through
 * `String`, so the two zeroes cannot produce two hashes.
 */
function count(value: number): string {
  if (!Number.isSafeInteger(value)) {
    throw new StateHashError(
      `a count field rendered a value that is not a safe integer: ${String(value)}`,
    );
  }
  return String(value);
}

function day(value: TradingDay): string {
  if (!TRADING_DAY_SHAPE.test(value)) {
    throw new StateHashError(`a trading day is not YYYY-MM-DD: ${JSON.stringify(value)}`);
  }
  return value;
}

function nullable<T>(value: T | null, render: (v: T) => string): string {
  return value === null ? NULL_SENTINEL : render(value);
}

// -----------------------------------------------------------------------------
// `engine_gates`, and why it is NOT `JSON.stringify`
// -----------------------------------------------------------------------------
// Column 19 is `jsonb`, and the obvious rendering is the wrong one twice over.
//
//   1. `JSON.stringify` THROWS ON A BIGINT, and four of the twenty-five leaf
//      fields below are `Cents`. So the obvious rendering does not merely drift,
//      it does not run.
//   2. M01 section 1.4 BANS "iteration over an object's keys where the result
//      affects output", because "key order is insertion order and CAN DRIFT
//      WITH A REFACTOR", and names "explicit ordered arrays, and canonical
//      serialization in `hash.ts`" as the replacement. A `JSON.stringify` of the
//      gates is exactly that banned iteration: it would hash today's insertion
//      order, and a later session reordering two fields in `EngineGateResults`
//      would diverge every row in the book with no rule changed.
//
// So the leaves are an EXPLICIT ORDERED LIST, in the order `EngineGateResults`
// and each gate interface declare their fields. `types.ts` says why that order
// is the one to take: "THE ORDER OF THE FIELDS IS THE ORDER `engineEligible`
// READS THEM, which matters because SD-08's canonical serialization hashes
// fields in a fixed declared order".
//
// AND THE HASH IS OVER THE ENGINE'S VALUE, NEVER OVER POSTGRES'S `jsonb`.
// `jsonb` does not preserve key order: it stores keys sorted by length and then
// bytewise, so a hash recomputed from a `jsonb` round-trip is a DIFFERENT
// SERIALIZER and would disagree with every hash written here. The batch writes
// the column and the hash from one in-memory value, in one step, which is what
// keeps the two consistent.

interface GateLeaf {
  /** Dotted path into `EngineGateResults`, so a divergence names the field. */
  readonly path: string;
  readonly render: (gates: EngineGateResults) => string;
}

/** The twenty-five leaves of `engine_gates`, in interface declaration order. */
export const ENGINE_GATE_LEAVES: readonly GateLeaf[] = [
  // R-33. `tradedDaysCount >= min_trading_days`, and 0 DISABLES the gate (CV-19).
  { path: 'tradedDays.pass', render: (g) => bool(g.tradedDays.pass) },
  { path: 'tradedDays.skipped', render: (g) => bool(g.tradedDays.skipped) },
  { path: 'tradedDays.have', render: (g) => count(g.tradedDays.have) },
  { path: 'tradedDays.need', render: (g) => count(g.tradedDays.need) },

  // R-34. Win days, counted strictly after `payoutAnchorDay`.
  { path: 'winDays.pass', render: (g) => bool(g.winDays.pass) },
  { path: 'winDays.have', render: (g) => count(g.winDays.have) },
  { path: 'winDays.need', render: (g) => count(g.winDays.need) },
  { path: 'winDays.floorCents', render: (g) => money(g.winDays.floorCents) },

  // R-35. The permanent buffer.
  { path: 'buffer.pass', render: (g) => bool(g.buffer.pass) },
  { path: 'buffer.haveCents', render: (g) => money(g.buffer.haveCents) },
  { path: 'buffer.needCents', render: (g) => money(g.buffer.needCents) },

  // R-36 over the R-47 period, with R-30's denominator rule.
  { path: 'consistency.pass', render: (g) => bool(g.consistency.pass) },
  { path: 'consistency.skipped', render: (g) => bool(g.consistency.skipped) },
  {
    path: 'consistency.bestDayShareBp',
    render: (g) => nullable(g.consistency.bestDayShareBp, count),
  },
  {
    path: 'consistency.maxDayShareBp',
    render: (g) => nullable(g.consistency.maxDayShareBp, count),
  },
  {
    path: 'consistency.profitNeededToDiluteCents',
    render: (g) => money(g.consistency.profitNeededToDiluteCents),
  },

  // R-37. Trading days strictly after `cadenceAnchorDay`, by sequence subtraction.
  { path: 'cadenceGap.pass', render: (g) => bool(g.cadenceGap.pass) },
  { path: 'cadenceGap.skipped', render: (g) => bool(g.cadenceGap.skipped) },
  {
    path: 'cadenceGap.tradingDaysSinceLastPayout',
    render: (g) => nullable(g.cadenceGap.tradingDaysSinceLastPayout, count),
  },
  { path: 'cadenceGap.need', render: (g) => count(g.cadenceGap.need) },
  {
    path: 'cadenceGap.nextEligibleTradingDay',
    render: (g) => nullable(g.cadenceGap.nextEligibleTradingDay, day),
  },

  // R-39. `min(withdrawable, cap) >= min_payout_cents`.
  { path: 'minimumAmount.pass', render: (g) => bool(g.minimumAmount.pass) },
  {
    path: 'minimumAmount.withdrawableCents',
    render: (g) => money(g.minimumAmount.withdrawableCents),
  },
  { path: 'minimumAmount.capCents', render: (g) => money(g.minimumAmount.capCents) },
  { path: 'minimumAmount.minPayoutCents', render: (g) => money(g.minimumAmount.minPayoutCents) },
];

function renderEngineGates(gates: EngineGateResults): string {
  let out = '';
  for (const leaf of ENGINE_GATE_LEAVES) out += frame(leaf.render(gates));
  return out;
}

// -----------------------------------------------------------------------------
// The nineteen, in ADR-026 C-07's declared order
// -----------------------------------------------------------------------------
// THE ORDER IS THE SPECIFICATION AND THE ORDINALS ARE CARRIED SO IT IS
// CHECKABLE. C-07 numbers the list 1 to 19 and `0015_rule_states.sql` reproduces
// it in the column comment; both are prose. The array below is the only
// executable copy, so it carries the ordinal and the column's SQL name and a
// test asserts both against the ADR rather than against this file.

// -----------------------------------------------------------------------------
// THE SUBJECT IS THE PROJECTION THE HASH READS, NOT `RuleState`, AND THE REPLAY
// AUDIT IS WHY
// -----------------------------------------------------------------------------
// `HASHED_COLUMNS` below declares NINETEEN SQL columns. Exactly ONE of them
// (`account_id`) reads `subject.accountId`; the other EIGHTEEN read
// `subject.state.*`. Nineteen and eighteen are both right, about different sets,
// and they are stated together here because a lone numeral near this array is
// how a hand-maintained count goes wrong.
//
// `state` is typed as those eighteen rather than as `RuleState` so that a STORED
// row can be a subject. `RuleState` carries three fields that no `rule_states`
// column holds -- `lifetimeSettledCents`, `breached`, `breachKind` -- so a
// `RuleStateRow` read back out of storage can never BE a `RuleState`, and the
// replay comparison would have to fabricate them to hash the stored side.
//
// IT IS A WIDENING AND NOTHING SERIALIZED MOVES. `Pick` is erased at compile
// time; every existing caller passes a `RuleState`, which remains assignable;
// the renderers are untouched. The proof is that `state-hash.test.ts` passes
// unchanged, including its independently transcribed serialization.
//
// The alternative, `storedRow as unknown as RuleState`, fabricates three fields
// that are invisible today and go live the moment a twentieth hashed column is
// added -- at which point the stored side renders a value no row ever held.

/** The eighteen `RuleState` fields the hash reads. Everything else is excluded. */
export type HashedState = Pick<
  RuleState,
  | 'tradingDay'
  | 'phase'
  | 'floorCents'
  | 'floorLocked'
  | 'floorOpenCents'
  | 'highWaterBalanceCents'
  | 'balanceCents'
  | 'withdrawableCents'
  | 'tradedDaysCount'
  | 'winDaysCount'
  | 'consistencyBestDayCents'
  | 'consistencyPeriodProfitCents'
  | 'consistencyPeriodStartDay'
  | 'payoutsSettledCount'
  | 'payoutAnchorDay'
  | 'cadenceAnchorDay'
  | 'engineEligible'
  | 'engineGates'
>;

/** The account the row belongs to, which `RuleState` does not carry. */
export interface StateHashSubject {
  /** `rule_states.account_id`. Canonical lowercase UUID. */
  readonly accountId: string;
  /** Everything else the hash covers, as the engine returned it. */
  readonly state: HashedState;
}

export interface HashedColumn {
  /** C-07's number, 1 to 19. */
  readonly ordinal: number;
  /** The `rule_states` column name, so a divergence report names SQL. */
  readonly column: string;
  readonly render: (subject: StateHashSubject) => string;
}

export const HASHED_COLUMNS: readonly HashedColumn[] = [
  // 1. NOT ON `RuleState`, and that is the design rather than a gap. `DayInput`
  //    carries no account id: "the fold is per account by construction and the
  //    caller that supplied the marks is the one that knows whose they are"
  //    (types.ts). The batch is that caller, so the batch supplies column 1.
  { ordinal: 1, column: 'account_id', render: (s) => text(s.accountId) },
  { ordinal: 2, column: 'trading_day', render: (s) => day(s.state.tradingDay) },
  { ordinal: 3, column: 'phase', render: (s) => text(s.state.phase) },
  { ordinal: 4, column: 'floor_cents', render: (s) => money(s.state.floorCents) },
  { ordinal: 5, column: 'floor_locked', render: (s) => bool(s.state.floorLocked) },
  // 6. SD-04. The floor the day was JUDGED against, which on any day the floor
  //    moved is not the floor that survived it (EC-035).
  { ordinal: 6, column: 'floor_open_cents', render: (s) => money(s.state.floorOpenCents) },
  {
    ordinal: 7,
    column: 'high_water_balance_cents',
    render: (s) => money(s.state.highWaterBalanceCents),
  },
  { ordinal: 8, column: 'balance_cents', render: (s) => money(s.state.balanceCents) },
  { ordinal: 9, column: 'withdrawable_cents', render: (s) => money(s.state.withdrawableCents) },
  { ordinal: 10, column: 'traded_days_count', render: (s) => count(s.state.tradedDaysCount) },
  { ordinal: 11, column: 'win_days_count', render: (s) => count(s.state.winDaysCount) },
  {
    ordinal: 12,
    column: 'consistency_best_day_cents',
    render: (s) => money(s.state.consistencyBestDayCents),
  },
  {
    ordinal: 13,
    column: 'consistency_period_profit_cents',
    render: (s) => money(s.state.consistencyPeriodProfitCents),
  },
  // 14. SD-07. R-47's "strictly after the anchor" boundary, in a column rather
  //     than in someone's head (GS-068).
  {
    ordinal: 14,
    column: 'consistency_period_start_day',
    render: (s) => nullable(s.state.consistencyPeriodStartDay, day),
  },
  {
    ordinal: 15,
    column: 'payouts_settled_count',
    render: (s) => count(s.state.payoutsSettledCount),
  },
  // 16 and 17. SD-02, C-09. THE TWO ANCHORS ARE BOTH IN THE HASH AND BOTH STAY
  //     SEPARATE. They coincide under ADR-019 today; collapsing them because
  //     today's configuration makes them equal is a silent 40 percent liability
  //     change if the anchor ever moves back (EC-039).
  {
    ordinal: 16,
    column: 'payout_anchor_day',
    render: (s) => nullable(s.state.payoutAnchorDay, day),
  },
  {
    ordinal: 17,
    column: 'cadence_anchor_day',
    render: (s) => nullable(s.state.cadenceAnchorDay, day),
  },
  // 18. SD-06. The ENGINE's verdict from ENGINE gates only, replayable by
  //     construction. The trader's actual eligibility is this AND every context
  //     gate, and that combined answer is deliberately not stored.
  { ordinal: 18, column: 'engine_eligible', render: (s) => bool(s.state.engineEligible) },
  { ordinal: 19, column: 'engine_gates', render: (s) => renderEngineGates(s.state.engineGates) },
];

// -----------------------------------------------------------------------------
// The exclusions, each with the reason it is excluded
// -----------------------------------------------------------------------------
// REPRODUCED AS REASONS RATHER THAN AS A LIST, because a list is what a future
// session adds a column to. Each entry below answers "what breaks if this were
// in", and in three of the five cases the answer is the same shape: the nightly
// audit diverges on every row of every account at once, which is FM-17 by
// construction. ADR-026 C-07 wrote the first four down because NOTHING IN THE
// CORPUS RECORDED WHICH COLUMNS THE HASH COVERS until it did; `0035` added the
// fifth and extended `0015`'s column comment in the same commit rather than
// leaving it implicit, "because a hash whose input set is implicit is a hash
// that changes meaning when a column is added".

export interface ExcludedColumn {
  readonly column: string;
  readonly reason: string;
  /** Where the exclusion is ruled. */
  readonly source: string;
}

export const EXCLUDED_COLUMNS: readonly ExcludedColumn[] = [
  {
    column: 'context_gates',
    source: 'ADR-026 C-07, INV-23, SD-06',
    reason:
      'THE WHOLE REASON SD-06 SPLIT THE GATES. Freeze, recon, KYC and in-flight were true on ' +
      'the day and may not be true now, so they are not replayable. If they entered the hash, a ' +
      'freeze applied last March would produce a divergence every night until someone disabled ' +
      'the audit, which is FM-17 by construction.',
  },
  {
    column: 'engine_version',
    source: 'ADR-026 C-07',
    reason:
      'A build identifier is not state. Including it makes every engine upgrade a universal ' +
      'divergence. It is required for replay COMPARISON, which is why Appendix B.4 step 1 scopes ' +
      'by it, and deliberately excluded from the hash it is compared with.',
  },
  {
    column: 'computed_at',
    source: 'ADR-026 C-07',
    reason: 'Wall-clock, not state.',
  },
  {
    column: 'calendar_revision_id',
    source: 'ADR-047, migration 0035',
    reason:
      'THE SECOND VERSION-LIKE INPUT, excluded for the identical reason as engine_version and ' +
      'with identical force. It is the data the fold folds over, not a fact the fold produced. ' +
      'In the hash, ONE calendar correction changes every row of every account at once and pages ' +
      '5,000 times on one morning: the alarm does not fail by being wrong, it fails by being ' +
      'right five thousand times. The nineteen stay nineteen; the exclusion list went from three ' +
      'to four.',
  },
  {
    column: 'id, state_hash',
    source: 'ADR-026 C-07',
    reason: 'The surrogate key, and the hash itself.',
  },
];

// -----------------------------------------------------------------------------
// The two exported functions
// -----------------------------------------------------------------------------

/**
 * The exact bytes hashed, so a divergence can print what differed rather than
 * only that something did (M01 Appendix B.2: the page says which number moved).
 */
export function canonicalStateSerialization(subject: StateHashSubject): string {
  if (!ACCOUNT_ID_SHAPE.test(subject.accountId)) {
    throw new StateHashError(
      `account_id is not a canonical lowercase UUID: ${JSON.stringify(subject.accountId)}`,
    );
  }

  let out = '';
  for (const column of HASHED_COLUMNS) out += frame(column.render(subject));
  return out;
}

/**
 * SD-08. Thirty-two bytes, which is what `rule_states_hash_is_sha256` checks.
 */
export function stateHash(subject: StateHashSubject): Buffer {
  return createHash('sha256').update(canonicalStateSerialization(subject), 'utf8').digest();
}
