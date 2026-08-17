// =============================================================================
// apps/worker/src/batch/ports.ts
// =============================================================================
// THE NIGHTLY BATCH'S I/O BOUNDARY, DECLARED BEFORE ITS IMPLEMENTATION EXISTS.
//
// This is `packages/db`'s own idiom one directory over: "NEITHER THE CLIENT NOR
// THE ACCESSOR EXISTS YET, and the scaffold does not invent them. What it fixes
// is that they will live here and nowhere else." There is no Drizzle client in
// this repository, no `pg` dependency in any manifest, and `ScopedDb` carries
// one field. So the batch below is written against ports rather than against a
// connection, and NOTHING HERE OPENS ONE.
//
// That is not a placeholder. It is the shape the batch has to have anyway:
// M01 section 1.2 puts "reading or writing the database" outside the engine and
// inside "M2 batch, M5 API", so the batch is the layer whose whole job is to
// turn rows into values and values back into rows. Keeping the fold pure and
// the I/O behind an interface is what lets the fold be tested without a
// database, which is what `test/nightly-batch.test.ts` does.
//
// WHEN THE CLIENT LANDS, the adapter is written against `packages/db`'s
// accessor, per ADR-008 and `merit/no-raw-db-client`. This file must not grow
// a `pg` import: the lint rule is attached to `apps/**` and this path is inside
// it.

import type {
  AssertionFailure,
  CalendarSlice,
  DailyMark,
  EngineGateResults,
  ExternalGates,
  ResolvedPlan,
  RuleState,
  SettlementFact,
  TradingDay,
} from '@merit/rules-engine';

// -----------------------------------------------------------------------------
// What the fold needs for one account on one day
// -----------------------------------------------------------------------------
// EVERY FIELD IS A ROW THE BATCH READ, NEVER A DEFAULT IT CHOSE. M01 section 5
// names what the batch feeds the engine: `daily_marks`, `trading_calendar`,
// `plan_versions`, `plan_version_sizes`, and settled `payout_requests`. The
// account id is here because `DayInput` does not carry one, deliberately: "the
// fold is per account by construction and the caller that supplied the marks is
// the one that knows whose they are".

export interface AccountDay {
  /** `rule_states.account_id`. Canonical lowercase UUID, as Postgres renders it. */
  readonly accountId: string;
  /**
   * The account's PINNED plan version, resolved.
   *
   * INV-16: "an account's `plan_version_id` is an input and is NEVER chosen by
   * the engine". It is not chosen by the batch either. The batch reads the
   * account's pinned version and resolves that, which is what makes INV-16's
   * "config migration never touches existing accounts" (GS-041) true at the
   * only layer that could break it.
   */
  readonly plan: ResolvedPlan;
  /** The prior `rule_states` row as a value. `null` on the account's first day. */
  readonly prior: RuleState | null;
  /** THE LIVE mark for the day. A superseded mark is never folded (`0014`). */
  readonly mark: DailyMark;
  /** D-M5-1. Those whose `effectiveTradingDay` is this day (DO-2, SD-03). */
  readonly settlements: readonly SettlementFact[];
  /**
   * INV-23's half that is NEVER replayed and IS stored.
   *
   * `rule_states.context_gates` is `NOT NULL`, so a row cannot be written
   * without it, and the engine does not compute it at DO-9: the context gates
   * are resolved by the caller and combined at read time by `evaluatePayout`.
   * The batch is that caller. What it stores is what was true when the day was
   * folded, which is exactly the claim `0015` makes for the column: "they were
   * true on the day and may not be true now".
   */
  readonly external: ExternalGates;
}

// -----------------------------------------------------------------------------
// The row
// -----------------------------------------------------------------------------
// One `rule_states` row, as values. `id`, `computed_at` and `created_at` are
// absent because they are the database's: `id` is `GENERATED ALWAYS AS
// IDENTITY` and both timestamps default to `now()`. THE BATCH THEREFORE READS
// NO CLOCK, which is worth stating rather than noticing: the three columns the
// batch does not write are three of the five ADR-026 C-07 excludes from the
// hash, and a batch that stamped its own `computed_at` would be a batch with a
// clock in it for no gain.

export interface RuleStateRow {
  readonly accountId: string;
  readonly tradingDay: TradingDay;
  readonly phase: RuleState['phase'];
  readonly floorCents: bigint;
  readonly floorLocked: boolean;
  readonly floorOpenCents: bigint;
  readonly highWaterBalanceCents: bigint;
  readonly balanceCents: bigint;
  readonly withdrawableCents: bigint;
  readonly tradedDaysCount: number;
  readonly winDaysCount: number;
  readonly consistencyBestDayCents: bigint;
  readonly consistencyPeriodProfitCents: bigint;
  readonly consistencyPeriodStartDay: TradingDay | null;
  readonly payoutsSettledCount: number;
  readonly payoutAnchorDay: TradingDay | null;
  readonly cadenceAnchorDay: TradingDay | null;
  readonly engineEligible: boolean;
  /**
   * SD-06, and the hash's column 19.
   *
   * THE ADAPTER MUST WRITE THIS VALUE, NOT A RE-DERIVATION OF IT. `state_hash`
   * below was computed over the canonical serialization of exactly this object,
   * in the engine's declared field order. `jsonb` does not preserve key order,
   * so a hash recomputed from what Postgres gives back is a different
   * serializer and would disagree with every hash this batch wrote.
   */
  readonly engineGates: EngineGateResults;
  /**
   * SD-06's other half. NOT REPLAYABLE, NOT IN THE HASH (INV-23).
   *
   * The engine publishes five context facts where `0015`'s column comment names
   * four ("freeze, recon_blocked, KYC, in-flight"); the fifth is
   * `accountActive`, which R-40 states and API_CONTRACT's eligibility shape
   * carries. The engine's shape is stored rather than `0015`'s list, so the
   * column and the endpoint speak one vocabulary. The discrepancy is flagged
   * rather than reconciled here: `0015` is merged and only an ADR moves it.
   */
  readonly contextGates: StoredContextGates;
  /** SD-08. Thirty-two bytes (`rule_states_hash_is_sha256`). */
  readonly stateHash: Buffer;
  /** Required for replay COMPARISON, excluded from the hash it is compared with. */
  readonly engineVersion: string;
  /**
   * ADR-047, `0035`. THE CALENDAR WATERMARK THIS FOLD READ, and not the
   * revision that corrected this row's day.
   *
   * `null` means the calendar had never been corrected, which is every row
   * until the first correction, and it is NOT "unknown".
   */
  readonly calendarRevisionId: number | null;
}

/** R-40's four gate verdicts plus R-38's, which API_CONTRACT reports separately. */
export interface StoredContextGates {
  readonly accountActive: { readonly pass: boolean; readonly status: string };
  readonly kycVerified: { readonly pass: boolean; readonly state: string };
  readonly notFrozen: { readonly pass: boolean; readonly reason: string | null };
  readonly reconClear: { readonly pass: boolean };
  /** R-38. An outstanding external-leg withdrawal exists for this identity. */
  readonly noPayoutInFlight: { readonly pass: boolean };
}

// -----------------------------------------------------------------------------
// Reconciliation
// -----------------------------------------------------------------------------
// DO-3: "A failure does not throw: it returns an `AssertionFailure`, THE BATCH
// RAISES RECONCILIATION, and NO STATE IS WRITTEN FOR THE DAY." ADR-049 extends
// the same channel to a calendar lookup outside coverage. So the batch has a
// refusal path that is not an exception path, and this is its port.

export interface ReconciliationFinding {
  readonly accountId: string;
  readonly tradingDay: TradingDay;
  /** Every assertion the fold returned, in the order it returned them. */
  readonly assertions: readonly AssertionFailure[];
}

// -----------------------------------------------------------------------------
// The ports
// -----------------------------------------------------------------------------

export interface BatchReadPort {
  /**
   * The highest `trading_calendar_revisions.id` that exists, or `null` if the
   * calendar has never been corrected.
   *
   * READ ONCE, BEFORE THE FOLD, AND STAMPED AS READ. `0035`'s header refuses a
   * trigger asserting the stamp is current for exactly this reason: "a
   * correction that commits between the fold and the write leaves a state row
   * that GENUINELY READ THE OLDER CALENDAR; stamping it with the newer
   * watermark records a calendar it never saw, and replay would then believe a
   * stale row was current." A stamp older than the maximum is CORRECT rather
   * than suspect: replay finds it out of scope and B.4 step 4 rewrites it.
   */
  calendarWatermark(): Promise<number | null>;

  /**
   * The calendar, as a value (ADR-049).
   *
   * IT MUST REACH BACK FAR ENOUGH FOR THE OLDEST ANCHOR IN THE BOOK. R-37
   * counts the cadence gap by `sequence` subtraction from `cadenceAnchorDay`,
   * a day that may be months old. A slice that is too short does not guess: the
   * lookup lands outside `coverage` and the fold returns a
   * `calendar_coverage_miss` assertion, so an under-loaded slice REFUSES rather
   * than silently weakening a money gate.
   */
  calendarSlice(): Promise<CalendarSlice>;

  /**
   * Every account with a live mark on this trading day.
   *
   * The unit of partitioning, per Appendix B.5: "partition by account ... hold
   * one account's history in memory at a time ... the per-account fold shares
   * no state, so this scales linearly (FM-17)."
   */
  accountsWithLiveMark(tradingDay: TradingDay): Promise<readonly string[]>;

  /** One account's inputs for one day, or `null` if it has no live mark. */
  loadAccountDay(accountId: string, tradingDay: TradingDay): Promise<AccountDay | null>;
}

export interface BatchWritePort {
  /**
   * Insert one `rule_states` row.
   *
   * TOTAL, NEVER PARTIAL, AND NEVER AN UPDATE. `0015`: "unlike `daily_marks`, a
   * rule state is never superseded. A correction to the inputs produces a
   * REPLAY, and the replay's divergence is the finding." `0026` revoked UPDATE
   * on this table from `merit_app` and PUBLIC, so an adapter that tried would
   * be refused by the grant as well as by this contract.
   */
  writeRuleState(row: RuleStateRow): Promise<void>;

  /** DO-3. No state was written for this account-day, and someone must look. */
  raiseReconciliation(finding: ReconciliationFinding): Promise<void>;
}

export interface BatchPorts {
  readonly read: BatchReadPort;
  readonly write: BatchWritePort;
}
