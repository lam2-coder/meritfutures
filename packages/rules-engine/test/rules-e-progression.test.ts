// =============================================================================
// GROUP E: THE EVALUATION PHASE. RE-U-026 to RE-U-032, and the group is
// complete.
// =============================================================================
// Every expectation here is arithmetic stated in a document, and the arithmetic
// is written out beside it in integer cents so a reader checks the number
// instead of trusting it (P2 section 2's second traceability tier).
//
// R-32 IS NOW IN THE `RE-U` SERIES AND IS STILL NOT DECLARED, and holding both
// of those at once is the point rather than a compromise. M01 section 8.4 wants
// a unit test for every rule R-01 to R-50 and R-32's own row names `RE-U-032` as
// what pins it; ADR-048 wants the declared set to be the rules the engine
// COMPUTES, and the engine computes no expiry. What `RE-U-032` asserts is the
// REFUSAL, at its boundary on both sides, which is a real behaviour with a real
// operator: `max_days` null folds, `max_days` set refuses.
//
// IT IS NOT THE OPERATOR ASSERTION M01 SECTION 8.4 ASKS FOR, AND SAYING SO IS
// PART OF THE TEST. R-32's operator is `>` against elapsed trading days, and
// nothing here exercises it, because the two things blocking it are founder
// rulings rather than code: the ANCHOR the days elapse from, which neither R-32
// nor `G-EXPIRED` names while an account sits `provisioning_pending`, and WHICH
// COLUMN BINDS, a count against `max_days` or the stored `accounts.expires_on`
// date. The session that receives those rulings replaces this test with the
// boundary pair and deletes the refusal with it.
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
  TradingDay,
} from '../src/types.js';
import {
  ACCOUNT_OPENED_ON,
  CME_WINDOW,
  CORE_50K,
  ENGINE_VERSION,
  GAPPED_SLICE,
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
    openedOn: ACCOUNT_OPENED_ON,
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

  // A DISABLED GATE PASSES AND IS `skipped`. CV-19's vocabulary, in its own
  // words: a disabled gate reports `pass: true, skipped: true` "using the same
  // `skipped` shape as the consistency denominator rule". EC-050, ADR-015,
  // GLOSSARY and GS-080 all say it the same way. `skipped` means NOT EVALUATED,
  // for any reason, and a gate the plan does not configure was never evaluated.
  //
  // THIS ASSERTION READ `skipped: false` UNTIL THE FIVE CITATIONS WERE CHECKED
  // AGAINST IT. The disabled gate rendered as SATISFIED in every consumer that
  // reads the flag, which is exactly what CV-19 exists to forbid. CORE-50K's
  // eval consistency is this case and is the only v1-reachable one.
  const off = consistencyOk(100_000n, 200_000n, { enabled: false });
  expect(off).toEqual({
    ok: true,
    skipped: true,
    profitNeededToDiluteCents: 0n,
    bestDayShareBp: null,
    maxDayShareBp: null,
  });
});

// -----------------------------------------------------------------------------
// `maxDayShareBp` TELLS THE TWO `skipped` CASES APART
// -----------------------------------------------------------------------------
// Folding the disabled case into `skipped` is only safe because the distinction
// support needs survives it. "Passed because there was nothing to test" and
// "never configured" are different facts, and a support agent reading a skipped
// consistency gate has to know which one they are looking at: the first is a
// trader who has not made money yet, the second is a plan that never had the
// gate.
//
// THE DISCRIMINATOR IS `maxDayShareBp` AND THE TYPE IS WHAT GUARANTEES IT.
// `ConsistencyRules` is a discriminated union whose `{ enabled: false }` arm has
// no `maxDayShareBp` field at all, so the disabled branch has no limit available
// to report; R-30's branch is reached only under `enabled: true`, where CV-06
// pins `0 < max_day_share_bp <= 10000` and the value is therefore always a
// positive number rather than a falsy `0` that would read like an absence.
//
// It is asserted here rather than left as a readable coincidence, because it is
// now load bearing: it is the whole reason no third state was added.
test('a skipped consistency gate says WHICH kind of skipped it is', () => {
  const at3000bp = { enabled: true, maxDayShareBp: bp(3000) } as const;

  const disabled = consistencyOk(100_000n, 200_000n, { enabled: false });
  const denominator = consistencyOk(100_000n, 0n, at3000bp);

  // Both are skipped, and neither reads as satisfied.
  expect(disabled.skipped).toBe(true);
  expect(denominator.skipped).toBe(true);

  // And they are still distinguishable, in the one field that carries it.
  expect(disabled.maxDayShareBp).toBe(null);
  expect(denominator.maxDayShareBp).toBe(3000);

  // The negative denominator is the same case as the zero one (GS-022), so it
  // must land on the same side of the discriminator.
  expect(consistencyOk(100_000n, -1n, at3000bp).maxDayShareBp).toBe(3000);

  // AN EVALUATED GATE ALSO CARRIES THE LIMIT, which is what makes `skipped` the
  // necessary first term: `maxDayShareBp !== null` alone does not mean skipped,
  // it means configured. The pair is the answer, not either field alone.
  const evaluated = consistencyOk(100_000n, 500_000n, at3000bp);
  expect(evaluated.skipped).toBe(false);
  expect(evaluated.maxDayShareBp).toBe(3000);
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
  // 5,010,000c on this very day: the trail put it at 5,300,000 - 250,000 =
  // 5,050,000 and the lock then ASSIGNED the locked value (ADR-052, accepted
  // 2026-08-17). R-31 resets it to 4,750,000c, a fall of 260,000c, on the same
  // day, and THAT fall is the one this test exists for: it is a day-over-day
  // move in the stored series, which is the granularity INV-06 is stated at.
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
  expect(atDo7.floorCents).toBe(5_010_000n);
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
  // M01 section 7 gives the event `locked_floor_cents`, which is 5,010,000 here,
  // while the floor the account actually carries out of the day is 4,750,000.
  const locked = out.events[0] as FloorLockedEvent;
  expect(locked.lockedFloorCents).toBe(5_010_000n);
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
// The two below `RE-U-032` are not `RE-U` tests and not claimed as rules. They
// assert the SHAPE of DO-8: what refuses, and that a refusal writes nothing.
// `src/rules.ts` states the count and these are what make it checkable rather
// than merely asserted.

/** One eval day folded against a nominated calendar and anchor. R-32's shape. */
function foldFrom(
  plan: ResolvedPlan,
  openedOn: TradingDay,
  fields: Parameters<typeof mark>[0],
  calendar = CME_WINDOW,
): DayOutput {
  return advanceDay({
    engineVersion: ENGINE_VERSION,
    plan,
    prior: evalPrior(plan, { tradingDay: openedOn }),
    mark: mark(fields),
    calendar,
    settlements: [],
    openedOn,
  });
}

test(reU('R-32'), () => {
  // =========================================================================
  // THE FENCEPOST, AND THIS TEST IS THE RULING RATHER THAN A CHECK OF ONE
  // =========================================================================
  // ADR-051 closed R-32's anchor (`accounts.opened_on`) and its authoritative
  // column (`phase_eval.max_days`) and DELIBERATELY LEFT THE OFF-BY-ONE OPEN:
  // "whether the opening day is elapsed day 0 or day 1 is an off-by-one on a
  // money path, and this corpus has ruled repeatedly that the way to settle one
  // is an executable pin ... the fixture is the answer."
  //
  // THE READING TAKEN IS THAT THE OPENING DAY IS ELAPSED DAY 1, so `max_days` is
  // THE NUMBER OF TRADING DAYS THE ACCOUNT MAY TRADE. The alternative grants an
  // account N+1 days on a limit of N, which no plan author can predict from the
  // number they typed. The pair below is what makes that binding: a session that
  // changes the engine's `+ 1` fails HERE, by name, rather than somewhere a
  // reader has to reconstruct the intent.
  //
  // The window is `CME_WINDOW`: 2026-11-02..06, sequences 4021..4025, five
  // consecutive sessions. The anchor is its first day.
  const fields = {
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: 20_000n,
  } as const;

  // -------------------------------------------------------------------------
  // SIDE ONE: EXACTLY REACHED. `max_days = 3`, the THIRD trading day, folds.
  // -------------------------------------------------------------------------
  //   opened_on   2026-11-02  sequence 4021  elapsed 1
  //               2026-11-03  sequence 4022  elapsed 2
  //   the mark    2026-11-04  sequence 4023  elapsed 3
  //
  // 4023 - 4021 = 2, plus the opening day = 3. `3 > 3` is false, so the account
  // is alive and the day is an ordinary day.
  const reached = foldFrom(withEvalMaxDays(CORE_50K, 3), day('2026-11-02'), {
    ...fields,
    tradingDay: day('2026-11-04'),
  });
  expect(reached.assertions).toEqual([]);
  expect(reached.events.map((e) => e.type)).not.toContain('account.expired');
  expect(reached.state.phase).toBe('eval');
  expect(reached.state.tradingDay).toBe('2026-11-04');

  // -------------------------------------------------------------------------
  // SIDE TWO: EXACTLY EXCEEDED. The very next session expires the account.
  // -------------------------------------------------------------------------
  //   the mark    2026-11-05  sequence 4024  elapsed 4, and `4 > 3`.
  const exceeded = foldFrom(withEvalMaxDays(CORE_50K, 3), day('2026-11-02'), {
    ...fields,
    tradingDay: day('2026-11-05'),
  });
  expect(exceeded.assertions).toEqual([]);
  expect(exceeded.state.phase).toBe('closed');

  // EXPIRED IS NOT BREACHED, and the payload says which limit ran out. A
  // consumer reading `breachKind` to explain the closure would otherwise be
  // handed a drawdown type that never happened.
  expect(exceeded.state.breached).toBe(false);
  expect(exceeded.state.breachKind).toBeNull();
  expect(exceeded.events.find((e) => e.type === 'account.expired')).toEqual({
    type: 'account.expired',
    tradingDay: '2026-11-05',
    expiryRule: 'R-32',
    elapsedTradingDays: 4,
    maxDays: 3,
  });

  // THE DAY STILL CLOSES. An expiry is a fact about the day, not a reason to
  // withhold the day's own record, and `day.closed` is what every downstream
  // consumer reads.
  expect(exceeded.events.map((e) => e.type)).toContain('day.closed');

  // -------------------------------------------------------------------------
  // AND `null` STILL FOLDS, which is every v1 plan (Appendix A).
  // -------------------------------------------------------------------------
  // Without this the two sides above would be satisfied by an engine that
  // expired every account on its fourth day regardless of configuration.
  expect(CORE_50K.eval?.maxDays).toBeNull();
  const unconfigured = foldFrom(CORE_50K, day('2026-11-02'), {
    ...fields,
    tradingDay: day('2026-11-05'),
  });
  expect(unconfigured.assertions).toEqual([]);
  expect(unconfigured.state.phase).toBe('eval');
  expect(unconfigured.events.map((e) => e.type)).not.toContain('account.expired');
});

test('RE-U-032  R-32  the count is `sequence` SUBTRACTION and never date arithmetic', () => {
  // THIS IS THE ASSERTION THAT FAILS IF ANYONE REACHES FOR A `Date`, and it is
  // the reason `GAPPED_SLICE` exists. R-02: "gap counting is `calendar.sequence`
  // subtraction, never date arithmetic." AS-06 is why it matters: five trading
  // days is 7 calendar days in June and 9 to 10 across the year-end cluster, so
  // a date difference expires accounts on the wrong day near every holiday and
  // agrees perfectly on the consecutive windows a test is most likely to use.
  //
  // `CME_WINDOW` CANNOT TELL THE TWO APART because its five days are
  // consecutive. `GAPPED_SLICE` holds 2026-11-02, -04 and -06 at sequences 4021,
  // 4022 and 4023, so between the first and last:
  //
  //   sequence subtraction   4023 - 4021 = 2, plus the opening day = 3
  //   date arithmetic        6 - 2       = 4, plus the opening day = 5
  //
  // With `max_days = 4`: the correct count of 3 leaves the account ALIVE, and a
  // date-based count of 5 would expire it. So this fold passing is the engine
  // doing subtraction, and it is a different fact from the boundary pair above.
  const alive = foldFrom(
    withEvalMaxDays(CORE_50K, 4),
    day('2026-11-02'),
    { openingBalanceCents: 5_000_000n, realizedPnlCents: 20_000n, tradingDay: day('2026-11-06') },
    GAPPED_SLICE,
  );
  expect(alive.assertions).toEqual([]);
  expect(alive.state.phase).toBe('eval');
  expect(alive.events.map((e) => e.type)).not.toContain('account.expired');

  // And the same slice with the limit set to the true count expires on the next
  // step rather than never: `3 > 3` is false, `3 > 2` is true. Without this the
  // assertion above could be satisfied by a count that never expires anything.
  const expired = foldFrom(
    withEvalMaxDays(CORE_50K, 2),
    day('2026-11-02'),
    { openingBalanceCents: 5_000_000n, realizedPnlCents: 20_000n, tradingDay: day('2026-11-06') },
    GAPPED_SLICE,
  );
  expect(expired.state.phase).toBe('closed');
  expect(expired.events.find((e) => e.type === 'account.expired')).toMatchObject({
    elapsedTradingDays: 3,
    maxDays: 2,
  });
});

test('RE-U-032  R-32  an anchor the slice cannot answer for REFUSES the day', () => {
  // P2 section 1 and ADR-049 rule this case by name: "replay will ask for the
  // sequence of an anchor older than the slice." Returning a default would
  // silently weaken a rule that CLOSES ACCOUNTS, and throwing would make the
  // fold's output depend on how much calendar the caller loaded. So it is a
  // typed refusal that writes no state, exactly as R-37's cadence anchor is.
  //
  // It reuses `calendar_coverage_miss` rather than minting a second kind: it is
  // the same miss, from the same lookup, for the same reason.
  const out = advanceDay({
    engineVersion: ENGINE_VERSION,
    plan: withEvalMaxDays(CORE_50K, 3),
    prior: evalPrior(CORE_50K, { tradingDay: day('2026-11-03') }),
    mark: mark({
      tradingDay: day('2026-11-04'),
      openingBalanceCents: 5_000_000n,
      realizedPnlCents: 20_000n,
    }),
    calendar: CME_WINDOW,
    settlements: [],
    // Before the window opens, which is where a real replay's anchor sits.
    openedOn: day('2026-10-01'),
  });

  expect(out.assertions.map((a) => a.kind)).toEqual(['calendar_coverage_miss']);
  expect(out.assertions[0]?.detail).toContain('R-32');
  expect(out.events).toEqual([]);
  // NO STATE IS WRITTEN. The carried state is the one the fold arrived with.
  expect(out.state.tradingDay).toBe('2026-11-03');
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
    openedOn: ACCOUNT_OPENED_ON,
  });
  expect(out.assertions.map((a) => a.kind)).toEqual(['eval_phase_without_eval_rules']);
  expect(out.events).toEqual([]);
});
