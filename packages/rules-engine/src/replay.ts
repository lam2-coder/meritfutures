// =============================================================================
// packages/rules-engine/src/replay.ts
// =============================================================================
// REPLAY IS THE SAME FOLD. M01 section 3.7 is the specification and this file is
// its transcription: a total order over the marks, `advanceDay` per mark, a
// throw on any assertion, and a break at `closed` or `graduated`.
//
// THERE IS NO SECOND CODE PATH, which is 3.7's own sentence and the reason this
// function exists as an export rather than as a shape each caller rebuilds.
// `apps/worker/src/batch/replay.ts` builds one today, with its own loop and its
// own break, and that is the drift ADR-078 ends.
//
// -----------------------------------------------------------------------------
// FOUR PLACES WHERE 3.7's PSEUDOCODE DOES NOT TYPECHECK AGAINST TODAY'S TYPES
// -----------------------------------------------------------------------------
// Each is a reconciliation, stated here rather than silently patched, so the
// next reader does not conclude 3.7 was transcribed loosely.
//
//   1. `openedOn` IS A PARAMETER AND 3.7's SIGNATURE HAS NO SUCH THING. ADR-051
//      added `openedOn` to `DayInput` after M01 was written and made it
//      "REQUIRED, NEVER OPTIONAL" (types.ts). An account's first tradeable day
//      is an ACCOUNT FACT and is not derivable from its marks: the earliest mark
//      is the first day it TRADED, which is not the day it opened. So the
//      signature is WIDENED by one parameter. Defaulting it to the first mark's
//      day would make R-32 count from the wrong anchor and expire nobody, which
//      is the exact shape ADR-051 rejected.
//
//   2. `calendar.get(mark.tradingDay)` IS IMPOSSIBLE, not merely awkward.
//      `CalendarSlice` is plain data and `CalendarSliceIsData` in types.ts
//      asserts at compile time that no property of it is function-valued
//      (ADR-049). The whole slice is passed; `advanceDay` resolves the day, and
//      it must, because R-37 counts a cadence gap by sequence subtraction from
//      an anchor that may be months outside any single day.
//
//   3. `byTradingDayThenId` NAMES A FIELD `DailyMark` DOES NOT HAVE. There is no
//      `id` on a mark. The tiebreaker is `sourceHash`, which is the only
//      deterministic identity the row carries, and the pair is a TOTAL ORDER
//      with no stable-sort dependence, which is what 3.7's own comment asks for.
//      Two marks sharing a day AND a hash are byte-identical, so their order
//      cannot change the fold.
//
//   4. `ReplayAssertionError` DID NOT EXIST. It does now, below, and it is
//      deliberately NOT an `EngineInvariantError`.
// =============================================================================

import type {
  AssertionFailure,
  CalendarSlice,
  DailyMark,
  ResolvedPlan,
  RuleState,
  SettlementFact,
  TradingDay,
} from './types.ts';
import { advanceDay } from './day/advance.ts';

/**
 * A replay stopped because a day refused.
 *
 * IT IS NOT AN `EngineInvariantError` AND THAT IS THE POINT OF THE CLASS.
 * `errors.ts` draws one line and it is load bearing: the engine THROWS when its
 * own arithmetic broke an invariant, and REFUSES through the assertion channel
 * when the INPUT contradicts something it was entitled to assume, "because the
 * day's data being wrong is not the batch's crash".
 *
 * A refused day is the second kind. Filing this under `EngineInvariantError`
 * would put bad vendor data into the class that means "a future edit broke a
 * rule", and every handler that distinguishes them would stop being able to.
 *
 * SO WHY THROW AT ALL, when `advanceDay` deliberately does not? Because REPLAY
 * cannot continue past a refusal and cannot represent one. No state is written
 * for a refused day, so the fold has no `prior` for the next mark, and a
 * `RuleState[]` that silently skipped a day is INDISTINGUISHABLE from a complete
 * one. The batch decides what a refusal costs; replay's contract is that the
 * array it returns is a contiguous history or there is no array at all.
 */
export class ReplayAssertionError extends Error {
  readonly assertions: readonly AssertionFailure[];
  /** The day the fold stopped on, so a page names it without re-deriving. */
  readonly tradingDay: TradingDay;

  constructor(assertions: readonly AssertionFailure[]) {
    const first = assertions[0];
    super(
      `replay stopped at ${String(first?.tradingDay)}: ` +
        `${String(assertions.length)} assertion(s), first is ${String(first?.kind)} (${String(first?.detail)})`,
    );
    this.name = 'ReplayAssertionError';
    this.assertions = assertions;
    this.tradingDay = first?.tradingDay as TradingDay;
  }
}

/**
 * A total order over marks: trading day, then `sourceHash`.
 *
 * NOT A STABLE SORT AND NOT DEPENDENT ON ONE. 3.7's comment on the sort reads
 * "total order, no stable-sort dependence", which is the whole reason a
 * tiebreaker exists: `Array.prototype.sort` is specified stable today, but a
 * fold whose output depends on that is a fold whose output depends on the order
 * the caller happened to hand it, and PT-06 permutes exactly that.
 */
function byTradingDayThenSourceHash(a: DailyMark, b: DailyMark): number {
  if (a.tradingDay < b.tradingDay) return -1;
  if (a.tradingDay > b.tradingDay) return 1;
  if (a.sourceHash < b.sourceHash) return -1;
  if (a.sourceHash > b.sourceHash) return 1;
  return 0;
}

/**
 * Settlements bucketed by the day whose opening balance first reflects them.
 *
 * `effectiveTradingDay` and NOT `basisTradingDay`: SD-03 makes the effective day
 * the one the withdrawal lands on, and `DayInput.settlements` is documented as
 * "those whose `effectiveTradingDay` equals `mark.tradingDay`".
 */
function groupSettlementsByEffectiveDay(
  settlements: readonly SettlementFact[],
): Map<TradingDay, SettlementFact[]> {
  const byDay = new Map<TradingDay, SettlementFact[]>();
  for (const fact of settlements) {
    const bucket = byDay.get(fact.effectiveTradingDay);
    if (bucket) bucket.push(fact);
    else byDay.set(fact.effectiveTradingDay, [fact]);
  }
  return byDay;
}

/**
 * Fold a whole account life and return the state after every day it lived.
 *
 * M01 section 3.7. The nightly self-audit, the CI golden suite, the evidence
 * pack's computation trace and the live batch all fold through here, which is
 * what "there is no second code path" means operationally.
 *
 * @param openedOn The account's first TRADEABLE day (ADR-051), not its purchase
 *   day and not its first mark. See reconciliation 1 in this file's header.
 * @throws ReplayAssertionError on the first day that refuses.
 */
export function replay(
  plan: ResolvedPlan,
  marks: readonly DailyMark[],
  settlements: readonly SettlementFact[],
  calendar: CalendarSlice,
  engineVersion: string,
  openedOn: TradingDay,
): RuleState[] {
  const byDay = groupSettlementsByEffectiveDay(settlements);
  let state: RuleState | null = null;
  const out: RuleState[] = [];

  for (const mark of [...marks].sort(byTradingDayThenSourceHash)) {
    const r = advanceDay({
      engineVersion,
      plan,
      prior: state,
      mark,
      calendar,
      settlements: byDay.get(mark.tradingDay) ?? [],
      openedOn,
    });

    if (r.assertions.length) throw new ReplayAssertionError(r.assertions);

    state = r.state;
    out.push(r.state);

    // R-24 and INV-12: breach is terminal, and R-49 closes a graduated account.
    // The break is 3.7's and it is not an optimisation: `advanceDay` refuses
    // every day after a terminal phase, so continuing would turn a finished
    // life into a replay that throws.
    if (state.phase === 'closed' || state.phase === 'graduated') break;
  }

  return out;
}
