// =============================================================================
// GROUP E: THE EVALUATION PHASE. RE-U-026 to RE-U-031.
// =============================================================================
// Every expectation here is arithmetic stated in a document, and the arithmetic
// is written out beside it in integer cents so a reader checks the number
// instead of trusting it (P2 section 2's second traceability tier).
//
// R-32 IS NOT IN THIS FILE'S `RE-U` RANGE AND ITS ABSENCE IS ASSERTED, at the
// bottom, against the refusal that stands in for it. See `src/rules.ts`.
// =============================================================================

import { expect, test } from 'vitest';

import { advanceDay } from '../src/day/advance.js';
import { consistencyOk } from '../src/day/consistency.js';
import { advanceFloor } from '../src/day/floor.js';
import type {
  DayOutput,
  FloorLockedEvent,
  PassDeferredConsistencyEvent,
  PhasePassedEvent,
  ResolvedPlan,
  RuleState,
} from '../src/types.js';
import {
  CME_WINDOW,
  CORE_50K,
  ENGINE_VERSION,
  MERIT_RAPID_50K,
  bp,
  day,
  evalPrior,
  mark,
  withEvalMaxDays,
  withEvalMinTradingDays,
} from './fixtures-in-code.js';
import { reU } from './rule-coverage.js';

/** One eval day, folded. Every test in this file is one or a few of these. */
function fold(
  plan: ResolvedPlan,
  fields: Parameters<typeof mark>[0],
  prior: RuleState = evalPrior(plan),
): DayOutput {
  return advanceDay({
    engineVersion: ENGINE_VERSION,
    plan,
    prior,
    mark: mark(fields),
    calendar: CME_WINDOW,
    settlements: [],
  });
}

// -----------------------------------------------------------------------------
// R-26  `closing_balance_cents - size_cents >= profit_target_cents`
// -----------------------------------------------------------------------------
test(reU('R-26'), () => {
  // GS-017, THE TIE: `300,000 >= 300,000` passes.
  //   5,300,000 - 5,000,000 = 300,000, and CORE-50K's eval target is 300,000c.
  // CORE-50K's eval consistency is DISABLED (Appendix A.1), so R-28 cannot
  // interfere and this pair tests one operator.
  const exactly = fold(CORE_50K, {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: 300_000n,
  });
  expect(exactly.assertions).toEqual([]);
  expect(exactly.state.phase).toBe('funded');
  expect(exactly.events.map((e) => e.type)).toContain('phase.passed');

  // GS-018, ONE CENT BELOW: `299,999 >= 300,000` is false.
  const shy = fold(CORE_50K, {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: 299_999n,
  });
  expect(shy.assertions).toEqual([]);
  expect(shy.state.phase).toBe('eval');
  expect(shy.events.map((e) => e.type)).not.toContain('phase.passed');

  // THE TARGET IS MEASURED AGAINST `size_cents` AND NOT AGAINST THE OPENING
  // BALANCE, so a day that gives profit back is judged on where it ENDED. Here
  // the account opens 400,000c up and loses 150,000c, closing 250,000c up, which
  // is short of the target even though the day started past it.
  const gaveItBack = fold(
    CORE_50K,
    {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_400_000n,
      realizedPnlCents: -150_000n,
    },
    evalPrior(CORE_50K, { balanceCents: 5_400_000n }),
  );
  expect(gaveItBack.assertions).toEqual([]);
  expect(gaveItBack.state.phase).toBe('eval');
});

// -----------------------------------------------------------------------------
// R-27  `tradedDaysCount >= min_trading_days`
// -----------------------------------------------------------------------------
test(reU('R-27'), () => {
  // Merit Rapid at 50K: eval minimum trading days 2 (Appendix A.2), eval
  // consistency 3000bp, target 300,000c.
  //
  // The prior carries two traded days worth 210,000c with a 70,000c best day;
  // today adds 90,000c, so:
  //   profit        5,300,000 - 5,000,000 = 300,000 >= 300,000   R-26 holds
  //   traded days   2 + 1 = 3
  //   best day      max(70,000, 90,000) = 90,000
  //   period profit 210,000 + 90,000 = 300,000
  //   consistency   90,000 * 10,000 = 900,000,000
  //                 3000 * 300,000  = 900,000,000, so R-29's `<=` holds exactly
  const prior = evalPrior(MERIT_RAPID_50K, {
    balanceCents: 5_210_000n,
    tradedDaysCount: 2,
    consistencyBestDayCents: 70_000n,
    consistencyPeriodProfitCents: 210_000n,
  });
  const today = {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_210_000n,
    realizedPnlCents: 90_000n,
  } as const;

  // AT THE THRESHOLD: `3 >= 3` passes. The threshold moves rather than the
  // counter, so both sides of `>=` see the identical prior state and mark.
  const met = fold(withEvalMinTradingDays(MERIT_RAPID_50K, 3), today, prior);
  expect(met.assertions).toEqual([]);
  expect(met.state.tradedDaysCount).toBe(0); // R-31 zeroed it on the pass
  expect(met.state.phase).toBe('funded');

  // ONE ABOVE: `3 >= 4` is false, and nothing else about the day changed.
  const short = fold(withEvalMinTradingDays(MERIT_RAPID_50K, 4), today, prior);
  expect(short.assertions).toEqual([]);
  expect(short.state.phase).toBe('eval');
  expect(short.state.tradedDaysCount).toBe(3);

  // AND R-27 IS NOT R-08. A day with no fills does not advance the counter, so
  // the same day at the same threshold fails on the count alone.
  const noFills = fold(
    withEvalMinTradingDays(MERIT_RAPID_50K, 3),
    { ...today, fillCount: 0 },
    prior,
  );
  expect(noFills.state.phase).toBe('eval');
  expect(noFills.state.tradedDaysCount).toBe(2);
});

// -----------------------------------------------------------------------------
// R-28  the deferral. GS-020, walked day by day
// -----------------------------------------------------------------------------
test(reU('R-28'), () => {
  // GS-020: "Best day is 40% of profit on the pass day: deferred, never failed.
  // Two more profitable days dilute to under 30% and the pass fires."
  //
  // Merit Rapid's eval consistency is 3000bp. The prior carries two traded days
  // worth 180,000c with a 120,000c best day.
  const prior = evalPrior(MERIT_RAPID_50K, {
    balanceCents: 5_180_000n,
    tradedDaysCount: 2,
    consistencyBestDayCents: 120_000n,
    consistencyPeriodProfitCents: 180_000n,
  });

  // DAY ONE. Profit reaches the target and consistency does not hold.
  //   period profit 180,000 + 120,000 = 300,000
  //   best day      max(120,000, 120,000) = 120,000, which is 4000bp of it
  //   120,000 * 10,000 = 1,200,000,000  >  3000 * 300,000 = 900,000,000
  //   shortfall     ceil((1,200,000,000 - 900,000,000) / 3000) = 100,000
  const deferred = fold(
    MERIT_RAPID_50K,
    {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_180_000n,
      realizedPnlCents: 120_000n,
    },
    prior,
  );
  expect(deferred.assertions).toEqual([]);
  expect(deferred.events.map((e) => e.type)).toEqual([
    'rule.floor_locked',
    'phase.pass_deferred_consistency',
    'day.closed',
  ]);

  // IT NEVER FAILS AN ACCOUNT. The account is not breached, not closed, and
  // still in `eval`, and every counter it earned is intact.
  expect(deferred.state.breached).toBe(false);
  expect(deferred.state.phase).toBe('eval');
  expect(deferred.state.tradedDaysCount).toBe(3);

  const event = deferred.events[1] as PassDeferredConsistencyEvent;
  expect(event.bestDayShareBp).toBe(4000);
  expect(event.maxDayShareBp).toBe(3000);
  expect(event.shortfallCents).toBe(100_000n);

  // AND THE SHORTFALL IS THE REAL NUMBER, not an estimate. Exactly 100,000c more
  // period profit makes R-29 hold at the tie:
  //   3000 * 400,000 = 1,200,000,000 = 120,000 * 10,000
  expect(consistencyOk(120_000n, 400_000n, MERIT_RAPID_50K.eval!.consistency).ok).toBe(true);
  expect(consistencyOk(120_000n, 399_999n, MERIT_RAPID_50K.eval!.consistency).ok).toBe(false);

  // DAY TWO. 60,000c dilutes but not enough: period profit 360,000, and
  //   3000 * 360,000 = 1,080,000,000 < 1,200,000,000
  //   shortfall ceil((1,200,000,000 - 1,080,000,000) / 3000) = 40,000
  const stillDiluting = fold(
    MERIT_RAPID_50K,
    {
      tradingDay: day('2026-11-04'),
      openingBalanceCents: 5_300_000n,
      realizedPnlCents: 60_000n,
    },
    deferred.state,
  );
  expect(stillDiluting.state.phase).toBe('eval');
  const second = stillDiluting.events.find(
    (e) => e.type === 'phase.pass_deferred_consistency',
  ) as PassDeferredConsistencyEvent;
  expect(second.shortfallCents).toBe(40_000n);

  // DAY THREE. Another 60,000c: period profit 420,000, and
  //   3000 * 420,000 = 1,260,000,000 >= 1,200,000,000, so the pass fires.
  const passed = fold(
    MERIT_RAPID_50K,
    {
      tradingDay: day('2026-11-05'),
      openingBalanceCents: 5_360_000n,
      realizedPnlCents: 60_000n,
    },
    stillDiluting.state,
  );
  expect(passed.assertions).toEqual([]);
  expect(passed.state.phase).toBe('funded');
  expect(passed.events.map((e) => e.type)).toEqual(['phase.passed', 'day.closed']);

  // THE PASS THAT EVENTUALLY FIRED REPORTS THE SHARE THAT LET IT.
  //   120,000 * 10,000 / 420,000 = 2857bp, under the 3000bp limit
  const pass = passed.events[0] as PhasePassedEvent;
  expect(pass.consistency).toEqual({
    bestDayShareBp: 2857,
    maxDayShareBp: 3000,
    satisfied: true,
    skipped: false,
  });
});

// -----------------------------------------------------------------------------
// R-29  `best * 10000 <= max_bp * profit`, cross multiplied
// -----------------------------------------------------------------------------
test(reU('R-29'), () => {
  const at3000bp = { enabled: true, maxDayShareBp: bp(3000) } as const;

  // GS-023, THE TIE: `best * 10000 == max_bp * profit` satisfies `<=`.
  //   90,000 * 10,000 = 900,000,000 = 3000 * 300,000
  const tie = consistencyOk(90_000n, 300_000n, at3000bp);
  expect(tie.ok).toBe(true);
  expect(tie.skipped).toBe(false);
  expect(tie.bestDayShareBp).toBe(3000);
  expect(tie.profitNeededToDiluteCents).toBe(0n);

  // ONE CENT OF BEST DAY ABOVE THE TIE FAILS.
  //   900,010,000 > 900,000,000, and the smallest additional period profit that
  //   fixes it is ceil(10,000 / 3000) = 4 cents:
  //     3000 * 300,004 = 900,012,000 >= 900,010,000   holds
  //     3000 * 300,003 = 900,009,000 <  900,010,000   does not
  const over = consistencyOk(90_001n, 300_000n, at3000bp);
  expect(over.ok).toBe(false);
  expect(over.profitNeededToDiluteCents).toBe(4n);
  expect(consistencyOk(90_001n, 300_004n, at3000bp).ok).toBe(true);
  expect(consistencyOk(90_001n, 300_003n, at3000bp).ok).toBe(false);

  // AS-02's WORKED CASE, from M01 section 7: "A has a best day of 100,000c
  // against period profit of 200,000c, a 5000bp share against a 3000bp limit,
  // and needs 133,334c more profit to dilute."
  const as02 = consistencyOk(100_000n, 200_000n, at3000bp);
  expect(as02.bestDayShareBp).toBe(5000);
  expect(as02.profitNeededToDiluteCents).toBe(133_334n);
  expect(consistencyOk(100_000n, 333_334n, at3000bp).ok).toBe(true);
  expect(consistencyOk(100_000n, 333_333n, at3000bp).ok).toBe(false);

  // A DISABLED GATE PASSES AND IS NOT `skipped`. CV-19's vocabulary: `skipped`
  // means "evaluated nothing", and a gate the plan does not configure was never
  // a gate. CORE-50K's eval consistency is this case.
  const off = consistencyOk(100_000n, 200_000n, { enabled: false });
  expect(off).toEqual({
    ok: true,
    skipped: false,
    profitNeededToDiluteCents: 0n,
    bestDayShareBp: null,
    maxDayShareBp: null,
  });
});

// -----------------------------------------------------------------------------
// R-30  skipped entirely unless `period_profit_cents > 0`, STRICT
// -----------------------------------------------------------------------------
test(reU('R-30'), () => {
  const at3000bp = { enabled: true, maxDayShareBp: bp(3000) } as const;

  // GS-021, ZERO: "the gate passes by definition, no division is ever attempted".
  const zero = consistencyOk(100_000n, 0n, at3000bp);
  expect(zero.ok).toBe(true);
  expect(zero.skipped).toBe(true);
  expect(zero.bestDayShareBp).toBe(null);

  // GS-022, NEGATIVE: the same rule, negative denominator.
  const negative = consistencyOk(100_000n, -1n, at3000bp);
  expect(negative.ok).toBe(true);
  expect(negative.skipped).toBe(true);

  // THE OTHER SIDE OF THE STRICT `>`: one cent of period profit is evaluated
  // rather than skipped, and on these numbers it fails. A `>=` here would have
  // reported this state as a pass.
  const oneCent = consistencyOk(100_000n, 1n, at3000bp);
  expect(oneCent.skipped).toBe(false);
  expect(oneCent.ok).toBe(false);

  // FM-15 IS "STRUCTURALLY IMPOSSIBLE" AND THIS IS WHY: the only division in the
  // file is reached after the denominator has been established positive, so no
  // input produces a divide by zero rather than one being handled.
  expect(() => consistencyOk(0n, 0n, at3000bp)).not.toThrow();
});

// -----------------------------------------------------------------------------
// R-31  the funded reset, applied in the same step as the pass
// -----------------------------------------------------------------------------
test(reU('R-31'), () => {
  // GS-019: "Eval pass resets the funded phase to the account size. Balance to
  // 5,000,000, floor to 4,750,000, all funded counters to zero. EVAL PROFIT IS
  // NOT CARRIED."
  const out = fold(CORE_50K, {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: 300_000n,
  });
  expect(out.assertions).toEqual([]);

  expect(out.state.phase).toBe('funded');
  expect(out.state.balanceCents).toBe(5_000_000n);
  expect(out.state.floorCents).toBe(4_750_000n); // 5,000,000 - 250,000, R-12
  expect(out.state.highWaterBalanceCents).toBe(5_000_000n);
  expect(out.state.tradedDaysCount).toBe(0);
  expect(out.state.winDaysCount).toBe(0);
  expect(out.state.consistencyBestDayCents).toBe(0n);
  expect(out.state.consistencyPeriodProfitCents).toBe(0n);

  // THE EVAL PROFIT IS GONE. The day closed at 5,300,000 and the account carries
  // 5,000,000, which is "the single largest trader-facing fact in this document".
  const passed = out.events.find((e) => e.type === 'phase.passed') as PhasePassedEvent;
  expect(passed.closingBalanceCents).toBe(5_300_000n);
  expect(passed.resetBalanceCents).toBe(5_000_000n);
  expect(passed.targetCents).toBe(300_000n);

  // AS-12, THE OFF-BY-ONE: the new consistency period starts STRICTLY AFTER the
  // pass day, so the day that funded the account cannot count against the next
  // cycle. The pass was on 2026-11-03 and the next session is 2026-11-04.
  expect(out.state.consistencyPeriodStartDay).toBe(day('2026-11-04'));
  expect(passed.consistencyPeriodStartDay).toBe(day('2026-11-04'));

  // SD-04 IS NOT REWRITTEN BY THE RESET. `floorOpenCents` is "the floor THIS
  // day's breach check compared against", the check happened at DO-4 against the
  // eval floor, and the evidence pack needs that number and not this one.
  expect(out.state.floorOpenCents).toBe(4_750_000n);

  // -----------------------------------------------------------------------------
  // THE FLOOR MOVES DOWN AT THE RESET, AND THAT IS INV-06's SCOPE QUESTION
  // -----------------------------------------------------------------------------
  // Asserted rather than only commented, because a tension that lives in a
  // comment is a tension the next session re-derives. DO-7 left the floor at
  // 5,050,000c on this very day: the trail put it at 5,300,000 - 250,000 and the
  // lock engaged at 300,000c of profit without lowering it. R-31 then resets it
  // to 4,750,000c, a fall of 300,000c, on the same day.
  //
  // R-12, R-31 and GS-019 all state that number, so the engine follows them.
  // INV-06 says the floor never decreases "no exception, no phase qualifier",
  // and RE-P-01 asserts it over generated sequences.
  //
  // SESSION 47 REFUTED THE PER-ACCOUNT READING rather than leaving it open. The
  // hypothesis was that D-M2-1's "or provisioning a new one" makes the funded
  // account a new ACCOUNT, so nothing decreases within one. It does not:
  // DEP-M2-01 is the same dependency from M02's side and says "THE PLATFORM
  // ACCOUNT is reset", STATE_MACHINES draws eval_phase -> funded_phase inside
  // one account's `active` state, `accounts.phase` is one column on one row,
  // `accounts.purchase_id` is NOT NULL UNIQUE so a pass cannot mint a second
  // row, and `rule_states` is unique on (account_id, trading_day) with `phase`
  // per day. Per account is already the corpus's meaning, so it is the reading
  // R-31 violates. See `progression.ts` for the full chain. What survives is
  // per (account, phase), or a stated R-31 exception on INV-06, and BOTH ARE
  // THE FOUNDER'S. RE-P-01's generator still cannot be written until one lands.
  const atDo7 = advanceFloor({
    priorFloorCents: 4_750_000n,
    priorHighWaterBalanceCents: 5_000_000n,
    priorFloorLocked: false,
    closingBalanceCents: 5_300_000n,
    sizeCents: CORE_50K.sizeCents,
    drawdown: CORE_50K.eval!.drawdown,
  });
  expect(atDo7.floorCents).toBe(5_050_000n);
  expect(atDo7.floorLocked).toBe(true);
  expect(out.state.floorCents).toBeLessThan(atDo7.floorCents);

  // AND THE LOCK DOES NOT SURVIVE THE RESET, which R-31's sentence does not say
  // and the floor machine does: section 3.4 starts the funded machine at
  // `trailing`. A funded account arriving locked would have `hwb` frozen at
  // `size_cents` and R-13 guarded off for life, so its floor could never trail.
  expect(out.state.floorLocked).toBe(false);

  // -----------------------------------------------------------------------------
  // `rule.floor_locked` FIRES ON A DAY THE ACCOUNT THEN LEAVES, AND IT CARRIES A
  // FLOOR NO ACCOUNT EVER HELD AT REST
  // -----------------------------------------------------------------------------
  // ASSERTED HERE BECAUSE THE ORDERING IS THE FINDING. DO-7 locks and DO-8 resets
  // out of the lock, in that order, and neither step may be reordered. Every v1
  // eval pass reaches it: Core EOD locks at 260,000c of profit and its target is
  // 300,000c, so an account cannot pass without locking first.
  expect(out.events.map((e) => e.type)).toEqual([
    'rule.floor_locked',
    'phase.passed',
    'day.closed',
  ]);

  // AND THE PAYLOAD IS THE PART THAT MATTERS TO M2 RATHER THAN TO THE TIMELINE.
  // M01 section 7 gives the event `locked_floor_cents`, which is 5,050,000 here,
  // while the floor the account actually carries out of the day is 4,750,000.
  const locked = out.events[0] as FloorLockedEvent;
  expect(locked.lockedFloorCents).toBe(5_050_000n);
  expect(locked.atProfitCents).toBe(300_000n);
  expect(out.state.floorCents).toBe(4_750_000n);

  // DEP-M2-03 IS "M1 EMITS A FLOOR CHANGE (VIA `day.closed`, `rule.floor_locked`)
  // THAT M2 TURNS INTO A `set_risk` PUSH", AND ITS SAFETY ARGUMENT HAS EXACTLY
  // ONE COUNTEREXAMPLE IN V1, WHICH IS THIS DAY. That argument is "since ADR-014
  // the floor only moves up, so drift is always permissive, which is safe for the
  // trader". On the pass day the floor moves DOWN, so the drift is RESTRICTIVE and
  // D-M2-3's other branch is the live one: "the platform liquidates before the
  // floor (traders lose accounts early)". A setpoint pushed from this payload
  // sits ABOVE the funded account's opening balance of `size_cents`, so it would
  // liquidate the account on its first funded mark.
  expect(locked.lockedFloorCents).toBeGreaterThan(CORE_50K.sizeCents);

  // THE ENGINE IS FAITHFUL AND NOTHING HERE IS A DEFECT IN IT. Whether M10 or M16
  // suppresses the event on the trader's timeline, and whether M2 reads a setpoint
  // from this payload or from the day's final state, are those modules' calls.
  // This assertion exists so that a change to either one fails a test rather than
  // a funded account.
});

// =============================================================================
// R-32, AND THE TWO REFUSALS GROUP E ADDS
// =============================================================================
// Not `RE-U` tests and not claimed as rules. They assert the SHAPE of DO-8: what
// refuses, and that a refusal writes nothing. `src/rules.ts` states the count
// and these are what make it checkable rather than merely asserted.

test('R-32  a plan that sets `max_days` refuses the day rather than expiring nothing', () => {
  // `max_days` is null on all three v1 plans, so nothing in the lineup reaches
  // this. A plan that set it would otherwise fold every day and expire nothing,
  // trading an account past its own expiry with a green state row.
  const out = fold(withEvalMaxDays(CORE_50K, 30), {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: 20_000n,
  });
  expect(out.assertions.map((a) => a.kind)).toEqual(['eval_expiry_unimplemented']);
  expect(out.assertions[0]?.detail).toContain('R-32');
  expect(out.events).toEqual([]);
  expect(out.state.phase).toBe('eval');
});

test('R-31  a pass on the last day the slice covers refuses, per ADR-049', () => {
  // The new consistency period starts on the next trading day, and the slice
  // cannot say what that is. ADR-049 rejected returning null ("it silently
  // weakens a money gate") and throwing ("the fold's behavior would depend on
  // how much calendar the caller loaded"), so this is a typed refusal.
  const out = fold(
    CORE_50K,
    {
      tradingDay: day('2026-11-06'), // the last session in CME_WINDOW
      openingBalanceCents: 5_000_000n,
      realizedPnlCents: 300_000n,
    },
    evalPrior(CORE_50K, { tradingDay: day('2026-11-05') }),
  );
  expect(out.assertions.map((a) => a.kind)).toEqual(['calendar_coverage_miss']);
  expect(out.events).toEqual([]);
  expect(out.state.phase).toBe('eval');
});

test('DO-8  a state claiming the eval phase on a plan with no eval phase refuses', () => {
  // Direct has no evaluation phase (Appendix A.3), so `initialState` opens its
  // accounts `funded`. A `prior` that says otherwise is a caller-assembly
  // defect, and folding it against `plan.funded` would compute a real number
  // against the wrong parameters.
  const directLike: ResolvedPlan = { ...CORE_50K, eval: null };
  const out = advanceDay({
    engineVersion: ENGINE_VERSION,
    plan: directLike,
    prior: { ...evalPrior(CORE_50K), phase: 'eval' },
    mark: mark({
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_000_000n,
      realizedPnlCents: 20_000n,
    }),
    calendar: CME_WINDOW,
    settlements: [],
  });
  expect(out.assertions.map((a) => a.kind)).toEqual(['eval_phase_without_eval_rules']);
  expect(out.events).toEqual([]);
});
