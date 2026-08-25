// =============================================================================
// apps/worker/src/batch/nightly.ts
// =============================================================================
// THE NIGHTLY BATCH: read ingest, fold `advanceDay` over the trading day, write
// `rule_states`.
//
// M01 section 3.7: "THERE IS NO SECOND CODE PATH. The nightly self-audit, the CI
// golden suite, the evidence pack's computation trace, and THE LIVE BATCH all
// call `advanceDay`." This file is the live batch, and the only engine
// functions it calls are exported ones.
//
// IT IMPORTS `@merit/rules-engine` AND NOTHING BELOW IT. That package's
// `exports` map publishes `.` and nothing else, so `../rules-engine/src/day/
// advance.js` is not reachable from here at all: the module resolver enforces
// what the fence asks for, rather than a convention doing it. Three other
// sessions are writing rules inside `packages/rules-engine/src/` while this
// lands, and a batch that reached into internals would collide with all three.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE IS NOT, STATED SO A GREEN SUITE DOES NOT IMPLY IT
// -----------------------------------------------------------------------------
// THE REPLAY SELF-AUDIT'S COMPARISON IS NOT WIRED. `state_hash` is COMPUTED here
// and written on every row; nothing yet re-derives a stored row and compares the
// two. INV-04 is "replaying every mark from day one reproduces stored state
// byte-identically", and what this session builds is the left-hand side of that
// sentence. The comparison waits until more rules exist, because an audit run
// against six of eight rule groups would report agreement about the two groups
// it can fold and silence about the rest, which reads exactly like an audit that
// found nothing (FM-17, and `OI-14` on ADR-047).
//
// WHAT 0033 AND 0035 BOUGHT, and why the computation is worth landing before the
// comparison. `0033` made the calendar's prior image MANDATORY, so every
// correction leaves an unforgeable record of what the calendar said before it
// moved. `0035` joined that record to a state row. Together they are what makes
// a CALENDAR CORRECTION DISTINGUISHABLE FROM AN ENGINE REGRESSION on the nightly
// run: before them, replay held the evidence and could not scope by it, so a
// holiday correction fell into Appendix B.3's "anything else: page" and diverged
// the whole book at once. The stamp this file writes is the half those two
// migrations could not install, because no per-row constraint can tell "not yet
// written" from "pristine calendar" without fabricating.
//
// EVENTS ARE RETURNED AND NOT PERSISTED. `advanceDay` emits M01 section 5's
// facts and they are carried on each outcome, but writing them needs `0017`'s
// event tables and EVENTS.md's vocabulary mapping, which is its own piece of
// work. They are surfaced rather than dropped so the gap is visible in the
// report instead of in nobody's memory.

import {
  advanceDay,
  evaluatePayout,
  type AssertionFailure,
  type CalendarSlice,
  type DayOutput,
  type EngineEvent,
  type RuleState,
  type TradingDay,
} from '@merit/rules-engine';

import type {
  AccountDay,
  BatchPorts,
  ReconciliationFinding,
  RuleStateRow,
  StoredContextGates,
} from './ports.ts';
import { stateHash } from './state-hash.ts';

export interface NightlyBatchConfig {
  /** The day being closed. Every account is folded for this day and no other. */
  readonly tradingDay: TradingDay;
  /** The build doing the folding. Stored on every row, excluded from the hash. */
  readonly engineVersion: string;
  /**
   * Appendix B.5's worker concurrency: "run partitions in parallel across
   * worker concurrency. The per-account fold shares no state, so this scales
   * linearly (FM-17)."
   */
  readonly concurrency: number;
}

/** What happened to one account on the day. */
export type AccountDayOutcome =
  | {
      readonly accountId: string;
      readonly status: 'written';
      readonly row: RuleStateRow;
      /** M01 section 5's facts. Carried, not persisted. */
      readonly events: readonly EngineEvent[];
    }
  | {
      readonly accountId: string;
      readonly status: 'refused';
      /** DO-3. No state was written for this day and reconciliation was raised. */
      readonly assertions: readonly AssertionFailure[];
    }
  | {
      /** Listed as having a live mark and gone by the time it was loaded. */
      readonly accountId: string;
      readonly status: 'absent';
    };

export interface NightlyBatchReport {
  readonly tradingDay: TradingDay;
  readonly engineVersion: string;
  /** The watermark stamped on every row this run wrote. */
  readonly calendarRevisionId: number | null;
  readonly accountsConsidered: number;
  readonly written: number;
  readonly refused: number;
  readonly absent: number;
  /** In the order `accountsWithLiveMark` returned, never in completion order. */
  readonly outcomes: readonly AccountDayOutcome[];
}

// -----------------------------------------------------------------------------
// The pure half
// -----------------------------------------------------------------------------

export type AccountDayFold =
  | {
      readonly kind: 'row';
      readonly row: RuleStateRow;
      readonly events: readonly EngineEvent[];
      // THE STATE IS RETURNED SO A REPLAY CAN CHAIN ITS OWN PRIOR, and without
      // it INV-04 is not expressible. `RuleStateRow` cannot rebuild a
      // `RuleState`: `lifetimeSettledCents`, `breached` and `breachKind` are on
      // the state and have no column. So a replay that could only see the row
      // would have to take day N+1's `prior` from storage -- which is the value
      // it is auditing. An error on day 40 would be folded into day 41's stored
      // prior, day 41 would recompute from that poisoned prior, and days 41 to
      // 250 would all agree. INV-04 says "from day one" for this reason.
      //
      // Nothing enumerates this union's keys: it is named in exactly three
      // places (this declaration, `foldAccountDay`'s return type, and a type
      // re-export from `index.ts`), and every consumer reads named fields. No
      // `Object.keys`, `Object.entries`, `for...in` or serializer reaches it, so
      // adding a field changes no output. M01 section 1.4 is why that had to be
      // checked rather than assumed.
      readonly state: RuleState;
    }
  | { readonly kind: 'refused'; readonly assertions: readonly AssertionFailure[] };

/**
 * One account, one day: fold, then build the row.
 *
 * PURE. No I/O, no clock, no port. Everything it needs arrives as an argument,
 * which is what lets the whole of the batch's decision-making be tested without
 * a database, and what keeps `runNightlyBatch` below a loop and a writer rather
 * than a place where a rule could hide.
 */
export function foldAccountDay(
  day: AccountDay,
  calendar: CalendarSlice,
  engineVersion: string,
  calendarRevisionId: number | null,
): AccountDayFold {
  const out: DayOutput = advanceDay({
    engineVersion,
    plan: day.plan,
    prior: day.prior,
    mark: day.mark,
    calendar,
    settlements: day.settlements,
    openedOn: day.openedOn,
  });

  // DO-3, and ADR-049 for the calendar miss. "A failure does not throw: it
  // returns an `AssertionFailure`, the batch raises reconciliation, and NO STATE
  // IS WRITTEN FOR THE DAY." The refusal is checked before anything is built,
  // so there is no path on which a row exists and is then discarded.
  if (out.assertions.length > 0) {
    return { kind: 'refused', assertions: out.assertions };
  }

  const state = out.state;

  // ---------------------------------------------------------------------------
  // `context_gates`, through the published function that owns R-40
  // ---------------------------------------------------------------------------
  // The column is `NOT NULL` and the day fold does not produce it: SD-06 splits
  // the gates precisely so the context half never enters the replayed state, and
  // `evaluatePayout` is where M01 puts the combination. So the batch asks the
  // engine rather than re-deriving R-40 out here, which would be a second
  // implementation of a money gate living in a worker.
  //
  // `requestedCents: null` is ADR-009's "pay the maximum I am eligible for", and
  // it is the right argument for a question that is not a request: nothing is
  // being asked for, the clamp is computed whatever the verdict, and only the
  // gate verdicts are read off the result.
  //
  // R-06 IS SATISFIED RATHER THAN STRAINED. "No endpoint may evaluate
  // eligibility against anything other than the last closed day, whatever the
  // batch is doing at the time" and the state passed here IS the day the batch
  // just closed.
  const evaluation = evaluatePayout(state, day.plan, {
    gates: day.external,
    requestedCents: null,
  });

  const contextGates: StoredContextGates = {
    accountActive: {
      pass: evaluation.gates.accountActive.pass,
      status: evaluation.gates.accountActive.status,
    },
    kycVerified: {
      pass: evaluation.gates.kycVerified.pass,
      state: evaluation.gates.kycVerified.state,
    },
    notFrozen: {
      pass: evaluation.gates.notFrozen.pass,
      reason: evaluation.gates.notFrozen.reason,
    },
    reconClear: { pass: evaluation.gates.reconClear.pass },
    noPayoutInFlight: { pass: evaluation.noPayoutInFlight.pass },
  };

  const row: RuleStateRow = {
    accountId: day.accountId,
    tradingDay: state.tradingDay,
    phase: state.phase,
    floorCents: state.floorCents,
    floorLocked: state.floorLocked,
    floorOpenCents: state.floorOpenCents,
    highWaterBalanceCents: state.highWaterBalanceCents,
    balanceCents: state.balanceCents,
    withdrawableCents: state.withdrawableCents,
    tradedDaysCount: state.tradedDaysCount,
    winDaysCount: state.winDaysCount,
    consistencyBestDayCents: state.consistencyBestDayCents,
    consistencyPeriodProfitCents: state.consistencyPeriodProfitCents,
    consistencyPeriodStartDay: state.consistencyPeriodStartDay,
    payoutsSettledCount: state.payoutsSettledCount,
    payoutAnchorDay: state.payoutAnchorDay,
    cadenceAnchorDay: state.cadenceAnchorDay,
    engineEligible: state.engineEligible,
    engineGates: state.engineGates,
    contextGates,
    // SD-08, over the nineteen columns of THIS row. `account_id` is column 1 and
    // is not on `RuleState`, so it is supplied here and nowhere else.
    stateHash: stateHash({ accountId: day.accountId, state }),
    // The version the fold RECORDED, read back off the state rather than copied
    // from the config, so the row and the state cannot disagree about which
    // build produced it.
    engineVersion: state.engineVersion,
    calendarRevisionId,
  };

  return { kind: 'row', row, events: out.events, state };
}

// -----------------------------------------------------------------------------
// The run
// -----------------------------------------------------------------------------

/**
 * Close one trading day for every account with a live mark on it.
 *
 * THE ADAPTER OWES A PER-ACCOUNT ADVISORY LOCK, which is FM-10 rather than a
 * preference: "settlement webhook and nightly batch race on the same account ->
 * anchors advanced twice, or once with the wrong values", and the stated control
 * is that "`applySettlement` is the only writer of anchors, is idempotent on
 * `payout_request_id`, and THE BATCH TAKES A PER-ACCOUNT ADVISORY LOCK". No lock
 * API is invented here, because the lock belongs with the connection and the
 * connection does not exist yet; it is named so that whoever writes the adapter
 * meets the requirement in the contract rather than in a failure.
 */
export async function runNightlyBatch(
  ports: BatchPorts,
  config: NightlyBatchConfig,
): Promise<NightlyBatchReport> {
  // ---------------------------------------------------------------------------
  // THE ORDER OF THESE TWO READS IS LOAD BEARING AND IT IS NOT ALPHABETICAL
  // ---------------------------------------------------------------------------
  // The watermark is read BEFORE the slice. If a correction commits between the
  // two, the slice carries it and the stamp does not, so the row claims an
  // OLDER calendar than the one it read: replay finds it out of scope, and B.4
  // step 4 rewrites it. That is the protocol working.
  //
  // Reversed, the row would claim a calendar it never saw, which is exactly what
  // `0035`'s header refuses to let a trigger do: "stamping it with the newer
  // watermark records a calendar it never saw, AND REPLAY WOULD THEN BELIEVE A
  // STALE ROW WAS CURRENT." One ordering is recoverable and the other is a
  // silent lie, and they differ by which line comes first.
  const calendarRevisionId = await ports.read.calendarWatermark();
  const calendar = await ports.read.calendarSlice();

  const accountIds = await ports.read.accountsWithLiveMark(config.tradingDay);

  const outcomes = await mapWithConcurrency(accountIds, config.concurrency, async (accountId) => {
    const day = await ports.read.loadAccountDay(accountId, config.tradingDay);
    if (day === null) {
      return { accountId, status: 'absent' } as const;
    }

    const fold = foldAccountDay(day, calendar, config.engineVersion, calendarRevisionId);

    if (fold.kind === 'refused') {
      const finding: ReconciliationFinding = {
        accountId,
        tradingDay: config.tradingDay,
        assertions: fold.assertions,
      };
      await ports.write.raiseReconciliation(finding);
      return { accountId, status: 'refused', assertions: fold.assertions } as const;
    }

    await ports.write.writeRuleState(fold.row);
    return { accountId, status: 'written', row: fold.row, events: fold.events } as const;
  });

  return {
    tradingDay: config.tradingDay,
    engineVersion: config.engineVersion,
    calendarRevisionId,
    accountsConsidered: accountIds.length,
    written: outcomes.filter((o) => o.status === 'written').length,
    refused: outcomes.filter((o) => o.status === 'refused').length,
    absent: outcomes.filter((o) => o.status === 'absent').length,
    outcomes,
  };
}

/**
 * Run `fn` over `items` with at most `limit` in flight, RESULTS IN INPUT ORDER.
 *
 * The ordering is the point rather than a convenience: a report whose rows
 * arrive in completion order differs between two runs over identical data, and
 * the first thing anybody does with a divergence report is diff it against
 * yesterday's.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const width = Math.max(1, Math.min(Math.trunc(limit), items.length));
  const workers = Array.from({ length: width }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await fn(item);
    }
  });

  await Promise.all(workers);
  return results;
}
