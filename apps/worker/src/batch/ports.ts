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
   * `accounts.opened_on`. R-32's anchor, read and never derived.
   *
   * ADR-051 fixed its meaning as the first TRADEABLE trading day, set at
   * `G-PROVISIONED` rather than at `purchase.paid`, and made it a required field
   * on `DayInput`. It is required here for the same reason it is required there:
   * an optional anchor makes R-32 silently not fire, which is a rule that reads
   * as enforced and expires nobody.
   */
  readonly openedOn: TradingDay;
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
// Replay divergence
// -----------------------------------------------------------------------------
// A DELIBERATE SIBLING OF RECONCILIATION AND NOT THE SAME CHANNEL. Reconciliation
// is "the fold REFUSED TO RUN" (DO-3, an `AssertionFailure`). A divergence is
// "the fold RAN AND DISAGREED WITH STORAGE". B.3 treats them as different
// causes with different responses, and collapsing them would make a replay
// divergence indistinguishable from a vendor arithmetic failure on the page.

/** One field that moved. `field` is singular because the event is (EVENTS.md:190). */
export interface ReplayDivergence {
  /**
   * The `rule_states` SQL column name, so the page names something that exists
   * in the database, or `engine_gates.<dotted.path>` for a gate leaf, which is
   * what `ENGINE_GATE_LEAVES` carries dotted paths for.
   */
  readonly field: string;
  /** RENDERED, never raw. A `bigint` in an event payload throws at emission. */
  readonly stored: string;
  readonly recomputed: string;
}

/**
 * One account-day that diverged, with every field that moved.
 *
 * GROUPED, AND THE ADAPTER EXPANDS IT. `EVENTS.md:190` gives
 * `replay.divergence_detected` a SINGULAR `field`, so the adapter emits one
 * event per entry in `divergences`. It is grouped here because B.1 says a
 * divergence "halts payout eligibility for that account and pages", and a halt
 * plus its evidence belong in one transaction rather than in N racing ones.
 *
 * WHAT THIS PORT DOES NOT DO, stated so the module does not read as a control
 * it is not: THE HALT IS NOT WIRED. B.1's "halts payout eligibility" is a write
 * to another table, outside this session's fence, and no adapter implements
 * this port yet. The obligation is a type here rather than a memory.
 */
export interface ReplayDivergenceFinding {
  readonly accountId: string;
  readonly tradingDay: TradingDay;
  /** The version the RUNNING build folded under. `EVENTS.md:190`'s payload field. */
  readonly engineVersion: string;
  readonly divergences: readonly ReplayDivergence[];
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

  /**
   * Every account that has ever held a rule state, for the replay audit.
   *
   * B.1 is "for EVERY account that has ever existed", which is a wider set than
   * `accountsWithLiveMark`: an account that stopped trading still has stored
   * rows, and an audit that skipped it would stop looking at exactly the
   * accounts nobody is watching.
   */
  accountsWithStoredState(): Promise<readonly string[]>;

  /**
   * One account's stored `rule_states` rows, oldest first.
   *
   * The right-hand side of INV-04. Served by `rule_states_account_day_desc_idx`
   * (`0015`), read in `(account_id, trading_day)` order per B.5.
   *
   * `stateHash` MUST be the bytes storage returned, never a value the adapter
   * recomputed. See `raiseDivergence` and `replay.ts`'s header.
   */
  storedRuleStates(accountId: string): Promise<readonly RuleStateRow[]>;

  /**
   * One account's inputs from day one, oldest first.
   *
   * INV-04 is "replaying every mark FROM DAY ONE", so the audit needs the whole
   * input history, not one day of it. `prior` on each of these is IGNORED by
   * the replay, which carries its own: folding from a stored prior would audit
   * the value being audited.
   */
  accountDaysFrom(accountId: string): Promise<readonly AccountDay[]>;
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

  /**
   * INV-04. A stored row and its replay disagree.
   *
   * `EVENTS.md:194`: "`ingest.correction_received` and
   * `replay.divergence_detected` are the two events that must never be quiet."
   * The adapter expands one finding into one event per diverging field and
   * halts payout eligibility for the account (B.1). Neither is wired yet.
   */
  raiseDivergence(finding: ReplayDivergenceFinding): Promise<void>;
}

export interface BatchPorts {
  readonly read: BatchReadPort;
  readonly write: BatchWritePort;
}

// =============================================================================
// M12: THE NIGHTLY STATISTICS RUN'S I/O BOUNDARY
// =============================================================================
// P4-g. THE SAME IDIOM AS EVERYTHING ABOVE, FOR THE SAME REASON: the machine is
// written against ports rather than against a connection, so the whole of its
// decision-making is testable without a database and the indicative tier has no
// door to arrive through.
//
// THAT SECOND HALF IS AN INVARIANT AND NOT A CONVENIENCE. `INV-M12-01` is "every
// published number is computed from CLOSED-SESSION AUTHORITATIVE DATA ONLY,
// never from the indicative tier", and `FM-M12-08`'s recovery column states the
// control as "the stats worker holds no read grant on the live cache ...
// structurally prevented". Every read below names a closed-session fact. There
// is no port here through which a live cache could reach the arithmetic, so the
// invariant holds by the shape of this file rather than by a check somebody
// could delete.
//
// EVERYTHING IN THIS SECTION IS TYPE-ONLY, which is what the whole file has
// always been. The runtime vocabulary -- the measure table, the unit per
// statistic, the computations -- lives in `statistics.ts`, which asserts its
// tables total over the unions declared here.

// -----------------------------------------------------------------------------
// The vocabulary, as the database spells it
// -----------------------------------------------------------------------------

/**
 * The seven ruled statistics ([M12](docs/plans/M12-statistic-definitions.md)).
 *
 * `published_statistics.stat_code` is `text` with no `CHECK` (`0021`), so the
 * database accepts any string and the closed set lives here. That is the
 * fail-closed direction: a code this union does not carry has no computation,
 * and the machine HALTS rather than publishing a figure whose arithmetic
 * nobody wrote.
 */
export type StatCode = 'ST-01' | 'ST-02' | 'ST-03' | 'ST-04' | 'ST-05' | 'ST-06' | 'ST-07';

/** `statistic_measure` (`0001:145`). ADR-032. Which figure a row carries. */
export type StatisticMeasure = 'rate' | 'total' | 'mean' | 'median' | 'p50' | 'p95' | 'count';

/** `statistic_unit` (`0001:130`). ADR-031. Every member is an INTEGER unit. */
export type StatisticUnit = 'count' | 'bp' | 'cents' | 'duration_seconds';

/**
 * The cell partition a definition publishes over.
 *
 * `statistic_definitions.grain` is `text NOT NULL` with no `CHECK` (`0021`), so
 * this union is the machine's reading of that column and not the column's own
 * vocabulary. Two members, and `G-4`'s per-identity figure is deliberately not
 * one of them: see `StatisticsHaltReason`'s `grain_not_ruled`.
 */
export type StatisticGrain = 'lineup' | 'plan';

// -----------------------------------------------------------------------------
// The definition, as a value
// -----------------------------------------------------------------------------

/**
 * One `statistic_definitions` row, effective for the day being published.
 *
 * THE PROSE SPECS ARE CARRIED EVEN THOUGH NOTHING EXECUTES THEM, and that is
 * the point rather than an oversight. `numerator_spec` and `denominator_spec`
 * are `text`: they are what the METHOD PAGE publishes and what a reader checks
 * the number against. They are in the digest (`statistics.ts`), so a definition
 * edited in place without a version bump changes every digest it produces,
 * which is `INV-M12-07` -- "definitions are frozen before the data exists" --
 * made detectable rather than merely stated.
 *
 * `id`, `method_body_mdx`, `adr_ref`, `superseded_by` and `created_at` are
 * absent because the machine does not read them. `superseded_by` in particular
 * is the READER's business: `effectiveDefinitions` returns the version that was
 * effective, and which row later superseded it changes no arithmetic.
 */
export interface StatisticDefinitionRow {
  readonly statCode: string;
  /** `definition_version` on every row this definition produces. */
  readonly version: number;
  /** `SD-M12-01`. A PUBLICATION POLICY, applied per published cell. */
  readonly minSample: number;
  /** ADR-032. The declared set. `STAT-C1` refuses a run that emits a subset. */
  readonly measures: readonly StatisticMeasure[];
  /** Read as a `StatisticGrain`. An unreadable value halts the run. */
  readonly grain: string;
  /** `window_spec`. Read as a `StatisticWindowSpec`. An unreadable value halts. */
  readonly windowSpec: string;
  readonly numeratorSpec: string;
  readonly denominatorSpec: string;
  readonly exclusions: readonly string[];
  /** `INV-M12-07`. Always in the future at write time; read here, never checked. */
  readonly effectiveFrom: string;
}

// -----------------------------------------------------------------------------
// The five closed-session facts
// -----------------------------------------------------------------------------
// EVERY FIELD IS A COLUMN, AND THE COLUMN IS NAMED. These are projections of
// authoritative tables, not a schema of their own, and a field with no column
// behind it would be a number Merit published from a source that does not
// exist.
//
// MONEY IS `bigint` AND SO ARE THE EPOCH SECONDS. ADR-031 retired this surface's
// no-floats exemption because for `ST-03` and `ST-04` the published column holds
// MONEY ON A PUBLIC SURFACE. A `number` here would admit a value that had
// already lost digits by the time this file saw it, and `payload.ts:63` makes
// the same exclusion one directory over for the same reason.

/**
 * One evaluation account whose OUTCOME OCCURRED in the window. `ST-01`.
 *
 * `G-5`: the window is anchored on the OUTCOME DATE, so an account is in a
 * window because its outcome landed in it and never because it was sold in it.
 *
 * `G-3` NEEDS NO FIELD AND THAT IS A PROPERTY OF THE SCHEMA. "A reset is a new
 * attempt": `accounts.purchase_id` is `NOT NULL UNIQUE` (`0007`), so one
 * purchase is one account row and a reset is a SECOND row. Counting accounts is
 * counting attempts, with nothing added and nothing to get wrong.
 *
 * `G-2`'s still-open accounts are absent by construction: an account still in
 * evaluation has no outcome, so it produces no fact. `G-1`'s never-traded
 * accounts ARE here, because they have outcomes like any other.
 */
export interface EvaluationOutcomeFact {
  /** `accounts.id`. */
  readonly accountId: string;
  /** `accounts.identity_id`. Carried for `G-4`, which this machine does not publish. */
  readonly identityId: string;
  /** `plans.code`, through `accounts.plan_version_id`. The `plan` grain's key. */
  readonly planCode: string;
  /** `accounts.funded_on` when passed, `accounts.closed_on` otherwise. */
  readonly outcomeDay: TradingDay;
  /**
   * `passed` is the account reaching `phase = 'funded'`; the other two are
   * `accounts.status` (`0001:47`), which carries `breached` and `expired` as
   * distinct members.
   */
  readonly outcome: 'passed' | 'breached' | 'expired';
}

/**
 * One funded account whose FUNDED LIFE ENDED in the window. `ST-02`.
 *
 * The denominator M12 rules is "funded accounts whose funded life ended in the
 * window (first payout, breach, or closure)", so a fact exists when the life
 * ended and the numerator is the subset that ended by being PAID.
 */
export interface FundedLifeFact {
  readonly accountId: string;
  readonly identityId: string;
  readonly planCode: string;
  /** The day the funded life ended, on `G-5`'s outcome anchor. */
  readonly endedDay: TradingDay;
  readonly ending: 'first_payout' | 'breach' | 'closure';
}

/**
 * One SETTLED payout, recognized at WALLET CREDIT. `ST-03`, `ST-04`, `ST-05`.
 *
 * THE RECOGNITION POINT IS THE WALLET CREDIT AND NOT THE EXTERNAL SETTLEMENT,
 * which `S-09` signed off: "that is when the trader has the money under
 * ADR-019, and publishing the later moment would understate a real thing". The
 * external leg is `ST-06`'s subject and has its own fact below.
 */
export interface SettledPayoutFact {
  /** `payout_requests.id`. The total order the digest sorts on. */
  readonly payoutRequestId: string;
  readonly accountId: string;
  readonly identityId: string;
  readonly planCode: string;
  /**
   * `payout_requests.effective_trading_day` (`SD-03`, `0010`).
   *
   * `settled_trading_day` is when the settlement was RECORDED and
   * `effective_trading_day` is the day it counts FOR, which is the one a
   * trailing window of trading days must anchor on. Using the other would make
   * a late-recorded settlement land in the wrong window with nothing reporting
   * it.
   */
  readonly creditedTradingDay: TradingDay;
  /**
   * `payout_requests.trader_cents` (`0010:60`), which is what ARRIVES in the
   * wallet. NOT `approved_cents`: the split is `trader_cents + firm_cents =
   * approved_cents`, and `S-09` publishes what the trader was paid.
   */
  readonly traderCents: bigint;
  /**
   * `accounts.terminal_settlement_id IS NOT NULL` (`SD-M18-01`, `0007`).
   *
   * THE TWO STATISTICS TREAT THIS FLAG IN OPPOSITE DIRECTIONS AND THAT IS
   * DELIBERATE. `ST-03` INCLUDES terminal settlements and labels them, because
   * a total should include every dollar paid; `ST-04` EXCLUDES them, because an
   * average of payouts should average payouts and a close-out of a remaining
   * balance is not one. Both surfaces state which treatment they use.
   */
  readonly terminalSettlement: boolean;
  /** `payout_requests.created_at`, whole epoch seconds. `ST-05`'s left edge. */
  readonly requestedAtEpochSeconds: bigint;
  /** The wallet-credit posting, whole epoch seconds. `ST-05`'s right edge. */
  readonly creditedAtEpochSeconds: bigint;
  /**
   * `payout_requests.frozen_at IS NOT NULL` (`SD-M5-01`, `0010`).
   *
   * `ST-05`'s exclusion, and the definition says these are "published
   * separately with count and median duration RATHER THAN DROPPED". The
   * separate publication needs its own `stat_code` and no definition row exists
   * for it, so this machine excludes them from `ST-05` and publishes no
   * decomposition. Named in `statistics.ts` rather than silently dropped.
   */
  readonly frozen: boolean;
}

/**
 * One withdrawal that reached the external rail. `ST-06`.
 *
 * `ST-06` EXISTS BECAUSE `ST-05` WITHOUT IT IS A LIE BY OMISSION. Publishing
 * the near-zero leg without the multi-day one is `M09`'s `GS-147` in
 * statistical form, and the two are published as a pair on one surface.
 */
export interface WithdrawalSettlementFact {
  /** `wallet_withdrawals.id`. */
  readonly withdrawalId: string;
  readonly identityId: string;
  /** The trading day the settlement counts for. `G-5`'s outcome anchor. */
  readonly settledTradingDay: TradingDay;
  /** `wallet_withdrawals.requested_at`, whole epoch seconds. */
  readonly requestedAtEpochSeconds: bigint;
  /** `wallet_withdrawals.settled_at`, whole epoch seconds. */
  readonly settledAtEpochSeconds: bigint;
  /**
   * A `P-1`/`P-3` provenance hold or the 48 hour destination cooling window:
   * `wallet_withdrawals.frozen_at IS NOT NULL`, or a `cooling` status the
   * withdrawal passed through (`0001:95`).
   *
   * The same shape and the same gap as `SettledPayoutFact.frozen`: the
   * definition publishes the held set separately with its reason class, and no
   * definition row exists for that publication.
   */
  readonly held: boolean;
}

/**
 * One payout request MEETING THE PUBLISHED GATES. `ST-07`.
 *
 * THE DENOMINATOR IS THE ELIGIBLE SET AND THE SURFACE SAYS SO IN THOSE WORDS.
 * A request failing a gate was never eligible and is not in it, which is
 * `ST-07`'s stated exclusion of "None".
 *
 * `approved` IS STRUCTURALLY TRUE AND THE ARITHMETIC DOES NOT KNOW THAT.
 * `payout_status` is `ENUM ('approved', 'settled', 'failed', 'frozen')`
 * (`0001:91`) and has no `denied` member, because `M05`'s `INV-M5-01` has no
 * denial path. So this statistic publishes 100 percent structurally, which
 * `AS-M12-05` calls simultaneously the best and the most suspicious claim
 * available. The field exists anyway: a machine that hard-coded the constant
 * would stop being able to report the day the constant stopped holding.
 */
export interface EligibleRequestFact {
  readonly payoutRequestId: string;
  readonly accountId: string;
  readonly planCode: string;
  /** The trading day the request resolved on. `G-5`'s outcome anchor. */
  readonly resolvedTradingDay: TradingDay;
  readonly approved: boolean;
}

// -----------------------------------------------------------------------------
// The row
// -----------------------------------------------------------------------------

/**
 * One `published_statistics` row, as values.
 *
 * `id`, `computed_at` and `created_at` are absent for the reason `RuleStateRow`
 * gives above: `id` is `DEFAULT gen_random_uuid()` and both timestamps default
 * to `now()`. THE MACHINE THEREFORE READS NO CLOCK, which matters more here
 * than it does there: a clock inside the computation would be an input the
 * digest cannot cover and cannot exclude.
 *
 * `restatement_of` IS ABSENT, AND ITS ABSENCE IS THE SCOPE OF THIS SESSION.
 * A restatement is `M12` section 3.3's own machine, triggered by
 * `ingest.correction_received` rather than by the schedule, and it recomputes
 * an affected window UNDER ITS ORIGINAL DEFINITION VERSION. This is the nightly
 * publication, so every row it writes has `restatement_of IS NULL` -- which is
 * also the scope of `published_statistics_window_uq` and of `STAT-C1`.
 */
export interface PublishedStatisticRow {
  readonly statCode: string;
  readonly definitionVersion: number;
  readonly windowStartDay: TradingDay;
  readonly windowEndDay: TradingDay;
  readonly asOfTradingDay: TradingDay;
  /** ADR-032. In the window unique key. */
  readonly measure: StatisticMeasure;
  /** ADR-031. `bigint`, never `numeric`, never a float. `null` iff suppressed. */
  readonly value: bigint | null;
  readonly valueUnit: StatisticUnit | null;
  /** `null` iff suppressed. `published_statistics_value_or_suppression`. */
  readonly numerator: bigint | null;
  readonly numeratorUnit: StatisticUnit | null;
  /**
   * PRESENT EXACTLY WHEN THE MEASURE IS A RATIO, which is `0021`'s own rule
   * rather than a relaxation of it: "the denominator is NOT required ... ST-03
   * has NO DENOMINATOR by ruling, because it is a total and the surface says so
   * RATHER THAN IMPLYING A RATE." An order statistic implies a rate exactly as
   * hard as a total does, so `median`, `p50` and `p95` carry none either and
   * `sample_size` carries the count they were selected from.
   */
  readonly denominator: bigint | null;
  /** `integer` in the DDL. The observation count behind the cell. */
  readonly sampleSize: number;
  /** The cell key. `null` for the lineup total, `plans.code` for a plan cell. */
  readonly grainKey: string | null;
  /** `INV-M12-05`. Non-null iff the value is withheld. A suppressed row EXISTS. */
  readonly suppressedReason: string | null;
  /** `SD-M12-02`. Thirty-two bytes. `statistics.ts` is its producer. */
  readonly inputDigest: Buffer;
}

// -----------------------------------------------------------------------------
// The halt
// -----------------------------------------------------------------------------
// `FM-M12-02`: "a halt publishes NOTHING and pages. It never publishes a
// partial set, BECAUSE A PARTIAL SET IS A SELECTED SET, and selection is the
// failure this module exists to prevent."
//
// A DELIBERATE SIBLING OF `ReconciliationFinding` ABOVE, AND NOT THE SAME
// CHANNEL, on the same reasoning that separates reconciliation from divergence:
// this one is run-scoped rather than account-scoped, and it means nothing was
// published at all.

export type StatisticsHaltReason =
  /** A definition names a `stat_code` with no computation in this build. */
  | 'unknown_stat_code'
  /** `statistic_definitions.grain` carries a value this machine cannot read. */
  | 'grain_not_ruled'
  /** `statistic_definitions.window_spec` carries a value this machine cannot read. */
  | 'window_spec_not_ruled'
  /** The declared measure set and the computation's disagree. `STAT-C1` in TypeScript. */
  | 'measures_disagree'
  /** The window reaches outside the calendar slice the caller loaded. */
  | 'calendar_coverage_miss'
  /** A ratio would divide by zero. Not a zero, and not a suppression. */
  | 'undefined_ratio'
  /** `M12` section 3.1: the day is not closed, or the self-audit did not vouch for it. */
  | 'inputs_not_vouched';

export interface StatisticsHalt {
  readonly asOfTradingDay: TradingDay;
  readonly reason: StatisticsHaltReason;
  /** `M12` section 5's `stats.run_halted` payload carries the stage. */
  readonly stage: 'waiting' | 'computing' | 'validating';
  /** The `stat_code` the halt is about, where there is one. */
  readonly statCode: string | null;
  /** Human-readable, and it names what was read rather than what was expected. */
  readonly detail: string;
}

// -----------------------------------------------------------------------------
// The ports
// -----------------------------------------------------------------------------

/** The window a read is scoped to. Trading days, inclusive at both ends. */
export interface StatisticWindow {
  readonly startDay: TradingDay;
  readonly endDay: TradingDay;
  /** `M12` `INV-M12-04`. Published beside every figure. */
  readonly asOfTradingDay: TradingDay;
}

export interface StatisticsReadPort {
  /**
   * Every definition EFFECTIVE for the day being published, one row per
   * `stat_code`.
   *
   * "Effective" is `effective_from <= asOfTradingDay` and not superseded by a
   * row that is also effective. THE ADAPTER OWES THAT PREDICATE AND THE MACHINE
   * DOES NOT RE-DERIVE IT, because `INV-M12-07`'s forward-only rule is a
   * property of which row is returned rather than of what is done with it: a
   * machine that filtered by date after the fact could be handed a superseded
   * row and would publish under it.
   */
  effectiveDefinitions(asOfTradingDay: TradingDay): Promise<readonly StatisticDefinitionRow[]>;

  /** `ST-01`. Evaluation accounts whose outcome occurred in the window. */
  evaluationOutcomes(window: StatisticWindow): Promise<readonly EvaluationOutcomeFact[]>;

  /** `ST-02`. Funded accounts whose funded life ended in the window. */
  fundedLives(window: StatisticWindow): Promise<readonly FundedLifeFact[]>;

  /** `ST-03`, `ST-04`, `ST-05`. Payouts credited to a wallet in the window. */
  settledPayouts(window: StatisticWindow): Promise<readonly SettledPayoutFact[]>;

  /** `ST-06`. Withdrawals settled on the external rail in the window. */
  withdrawalSettlements(window: StatisticWindow): Promise<readonly WithdrawalSettlementFact[]>;

  /** `ST-07`. Payout requests meeting the published gates, resolved in the window. */
  eligibleRequests(window: StatisticWindow): Promise<readonly EligibleRequestFact[]>;
}

export interface StatisticsWritePort {
  /**
   * THE WHOLE RUN, IN ONE CALL, IN ONE TRANSACTION.
   *
   * NOT ONE ROW AT A TIME, AND THE REASON IS IN `0027` RATHER THAN IN A
   * PREFERENCE. `STAT-C1` is a `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY
   * DEFERRED`, so "a publish run emitting one measure emits every measure its
   * definition declares" is only decidable once the run's transaction has
   * written all its rows. A per-row port would make `FM-M12-02`'s partial set
   * -- which is a SELECTED set -- expressible by a caller who simply stopped
   * calling, and the deferred check would never see the difference.
   *
   * THERE IS NO UPDATE VERB AND NO DELETE VERB ON THIS PORT, and their absence
   * is not this interface being careful. `0026` REVOKES `UPDATE, DELETE` on
   * `published_statistics` from `merit_app` AND from `PUBLIC`, and ADR-112
   * clause 5 removed `update` and `delete` from every transaction handle in the
   * workspace. `INV-M12-03`'s immutability is the database's, and this port is
   * shaped like what the database will accept rather than like a promise about
   * what the code intends.
   *
   * A SECOND RUN OVER A PUBLISHED WINDOW IS REFUSED BY
   * `published_statistics_window_uq` AND NOT BY A CHECK IN FRONT OF IT. The
   * machine does not read the published series to decide whether to write; the
   * unique index decides, and the adapter surfaces the refusal.
   */
  publishRun(rows: readonly PublishedStatisticRow[]): Promise<void>;

  /**
   * `FM-M12-02`. Nothing was published and someone must look.
   *
   * `M12` section 5 gives this `stats.run_halted` with `{ as_of_trading_day,
   * reason, stage }`, and the event PAGES. As with `raiseDivergence` above, the
   * emission is the adapter's and no adapter implements this port yet.
   */
  raiseStatisticsHalt(halt: StatisticsHalt): Promise<void>;
}

export interface StatisticsPorts {
  readonly read: StatisticsReadPort;
  readonly write: StatisticsWritePort;
}
