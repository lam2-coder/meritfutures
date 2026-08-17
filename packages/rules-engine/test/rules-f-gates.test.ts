// =============================================================================
// GROUP F: THE FUNDED GATES. RE-U-033 to RE-U-041.
// =============================================================================
// Every expectation here is arithmetic stated in a document, and the arithmetic
// is written out beside it in integer cents so a reader checks the number
// instead of trusting it (P2 section 2's second traceability tier).
//
// R-38 AND R-40 ARE NOT ASSERTED HERE. Both read `ExternalGates`, which M01
// section 2.1 marks "context, never replayed", so neither is a term in
// `engineGates` and neither has an `advanceDay` path to assert against. They
// arrive with `evaluatePayout`.
// =============================================================================

import { expect, test } from 'vitest';

import { advanceDay, initialState } from '../src/day/advance.js';
import { withdrawableCents } from '../src/payout/gates.js';
import type { DayOutput, ResolvedPlan, RuleState } from '../src/types.js';
import {
  CME_WINDOW,
  CORE_50K,
  ENGINE_VERSION,
  MERIT_RAPID_50K,
  day,
  evalPrior,
  fundedPrior,
  mark,
  withFundedMinTradingDays,
} from './fixtures-in-code.js';
import { reU } from './rule-coverage.js';

/** One day, folded. */
function fold(
  plan: ResolvedPlan,
  fields: Parameters<typeof mark>[0],
  prior: RuleState = fundedPrior(plan),
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
// R-35  `withdrawable = max(0, balance_cents - size_cents - buffer_cents)`
// -----------------------------------------------------------------------------
// CORE-50K, from M01 Appendix A.1's 50K column: size 5,000,000c, buffer
// 100,000c. So the first withdrawable cent is the one above 5,100,000c.
test(reU('R-35'), () => {
  // THE BOUNDARY, BOTH SIDES, ONE CENT APART.
  //
  //   5,100,000 - 5,000,000 - 100,000 =  0    exactly at the buffer, nothing out
  //   5,100,001 - 5,000,000 - 100,000 =  1    the first withdrawable cent
  const atTheBuffer = fold(CORE_50K, {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: 100_000n,
    fillCount: 2,
  });
  expect(atTheBuffer.assertions).toEqual([]);
  expect(atTheBuffer.state.balanceCents).toBe(5_100_000n);
  expect(atTheBuffer.state.withdrawableCents).toBe(0n);

  const oneCentOver = fold(CORE_50K, {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: 100_001n,
    fillCount: 2,
  });
  expect(oneCentOver.state.balanceCents).toBe(5_100_001n);
  expect(oneCentOver.state.withdrawableCents).toBe(1n);

  // GS-025 EXACTLY: a balance INSIDE the buffer by 10,000c. The subtraction
  // produces -10,000 and the field reports 0, which is INV-05 and is the whole
  // reason R-35 carries a `max` rather than a subtraction.
  //
  //   5,090,000 - 5,000,000 - 100,000 = -10,000  ->  0
  const insideTheBuffer = fold(CORE_50K, {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: 90_000n,
    highBalanceCents: 5_095_000n,
    lowBalanceCents: 4_995_000n,
    fillCount: 3,
  });
  expect(insideTheBuffer.state.balanceCents).toBe(5_090_000n);
  expect(insideTheBuffer.state.withdrawableCents).toBe(0n);

  // And well below size, which is the other route to the same zero. INV-05 has
  // no exception: a losing funded account reports 0, never a negative.
  //
  //   4,900,000 - 5,000,000 - 100,000 = -200,000  ->  0
  const losing = fold(CORE_50K, {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: -100_000n,
    lowBalanceCents: 4_890_000n,
    fillCount: 4,
  });
  expect(losing.state.balanceCents).toBe(4_900_000n);
  expect(losing.state.withdrawableCents).toBe(0n);
});

// -----------------------------------------------------------------------------
// R-35, the phase half: `0n` on anything that is not funded
// -----------------------------------------------------------------------------
// M01 section 3.6's first line inside `withdrawable` is `if (s.phase !==
// 'funded') return 0n`. GS-025's own expectation note says why it is asserted
// separately: "the zero is reachable by two routes and only one of them is this
// scenario", so a test that only pinned the buffer arithmetic would pass against
// an engine that returned zero because it had the phase wrong.
test('RE-U-035  R-35  withdrawable is zero outside the funded phase, by a different route', () => {
  // MERIT-RAPID-50K rather than CORE-50K because this account must sit in `eval`
  // holding real profit, and the two plans carry the same size and buffer
  // (Appendix A.1 and A.2 both: 5,000,000c and 100,000c at 200bp).
  //
  // An eval account 300,000c up would be 200,000c withdrawable on the funded
  // arithmetic, and is 0 because eval profit is not extractable: R-31 takes the
  // balance back to `size_cents` at the pass and "eval profit is not carried".
  const evalDay = fold(
    MERIT_RAPID_50K,
    {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_200_000n,
      realizedPnlCents: 90_000n,
      fillCount: 2,
    },
    evalPrior(MERIT_RAPID_50K, { balanceCents: 5_200_000n, tradedDaysCount: 1 }),
  );
  expect(evalDay.assertions).toEqual([]);
  expect(evalDay.state.phase).toBe('eval');
  expect(evalDay.state.balanceCents).toBe(5_290_000n);
  expect(evalDay.state.withdrawableCents).toBe(0n);

  // The function directly, on the two phases a fold reaches only by breaching or
  // graduating. `closed` is R-24's terminal state and a breached account has
  // nothing to extract, whatever its balance says.
  const rich = fundedPrior(CORE_50K, { balanceCents: 6_000_000n });
  expect(withdrawableCents(rich, CORE_50K)).toBe(900_000n); // 6,000,000 - 5,000,000 - 100,000
  expect(withdrawableCents({ ...rich, phase: 'closed' }, CORE_50K)).toBe(0n);
  expect(withdrawableCents({ ...rich, phase: 'graduated' }, CORE_50K)).toBe(0n);

  // An account at its open is zero on both phases, which is why `initialState`
  // applies the formula rather than writing the zero it provably is.
  expect(initialState(CORE_50K, day('2026-11-02'), ENGINE_VERSION).withdrawableCents).toBe(0n);
});

// -----------------------------------------------------------------------------
// R-35 is evaluated at DO-9, AFTER DO-8's progression
// -----------------------------------------------------------------------------
// The eval pass moves the phase to `funded` and the balance to `size_cents` in
// one step (R-31). A withdrawable computed before that step would attach the
// eval day's balance to a funded row: on this fold, 5,300,000c against a size of
// 5,000,000c and a buffer of 100,000c is 200,000c of withdrawable that the reset
// has already taken back. AS-14 is what happens when a funded account starts
// carrying eval profit, and this is the same number arriving from inside the
// engine instead of from the platform.
test('R-35 reads the state DO-8 left, so an eval pass is not withdrawable', () => {
  const passed = fold(
    CORE_50K,
    {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_000_000n,
      realizedPnlCents: 300_000n,
      fillCount: 5,
    },
    evalPrior(CORE_50K, { balanceCents: 5_000_000n, tradedDaysCount: 1 }),
  );

  expect(passed.assertions).toEqual([]);
  expect(passed.state.phase).toBe('funded');
  expect(passed.state.balanceCents).toBe(5_000_000n); // R-31, the reset
  expect(passed.state.withdrawableCents).toBe(0n);
});

// -----------------------------------------------------------------------------
// R-33  `tradedDaysCount >= min_trading_days`, and ZERO DISABLES the gate
// -----------------------------------------------------------------------------
test(reU('R-33'), () => {
  // GS-080 and CV-19: all three v1 plans configure 0, "which disables the gate:
  // it reports `pass: true, skipped: true` and is rendered as disabled rather
  // than as satisfied". CORE-50K's funded minimum is 0 (Appendix A.1).
  const disabled = fold(CORE_50K, {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: 20_000n,
    fillCount: 1,
  });
  expect(disabled.state.engineGates.tradedDays.pass).toBe(true);
  expect(disabled.state.engineGates.tradedDays.skipped).toBe(true);
  expect(disabled.state.engineGates.tradedDays.need).toBe(0);

  // THE OPERATOR, ONE DAY APART, ON A PLAN THAT ENABLES THE GATE. Moving the
  // THRESHOLD rather than the counter is what keeps the two sides comparable:
  // the same prior and the same mark pass at N and fail at N+1. CV-19 admits
  // any `>= 0`, so both are configs `validatePlan` accepts.
  //
  // The prior carries `tradedDaysCount: 1` and the mark has a fill, so the
  // count reaching the gate is 2.
  const atMinimum = fold(withFundedMinTradingDays(CORE_50K, 2), {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: 20_000n,
    fillCount: 1,
  });
  expect(atMinimum.state.tradedDaysCount).toBe(2);
  expect(atMinimum.state.engineGates.tradedDays.pass).toBe(true); // 2 >= 2
  expect(atMinimum.state.engineGates.tradedDays.skipped).toBe(false);

  const oneShort = fold(withFundedMinTradingDays(CORE_50K, 3), {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: 20_000n,
    fillCount: 1,
  });
  expect(oneShort.state.engineGates.tradedDays.pass).toBe(false); // 2 >= 3 is false
  expect(oneShort.state.engineGates.tradedDays.skipped).toBe(false);
});

// -----------------------------------------------------------------------------
// R-34  `winDaysCount >= required_count`, `>=`
// -----------------------------------------------------------------------------
test(reU('R-34'), () => {
  // CORE-50K requires 5 win days at a 15,000c floor (Appendix A.1). The prior
  // carries 4, and the day's realized P&L of 15,000c is EXACTLY at the win-day
  // floor, so R-09 counts it and the gate lands on its own tie: 5 >= 5.
  const atRequirement = fold(
    CORE_50K,
    {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_200_000n,
      realizedPnlCents: 15_000n,
      fillCount: 2,
    },
    fundedPrior(CORE_50K, { balanceCents: 5_200_000n, winDaysCount: 4 }),
  );
  expect(atRequirement.state.winDaysCount).toBe(5);
  expect(atRequirement.state.engineGates.winDays.pass).toBe(true);
  expect(atRequirement.state.engineGates.winDays.need).toBe(5);
  expect(atRequirement.state.engineGates.winDays.floorCents).toBe(15_000n);

  // ONE WIN DAY SHORT, one day apart, same plan and same mark.
  const oneShort = fold(
    CORE_50K,
    {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_200_000n,
      realizedPnlCents: 15_000n,
      fillCount: 2,
    },
    fundedPrior(CORE_50K, { balanceCents: 5_200_000n, winDaysCount: 3 }),
  );
  expect(oneShort.state.winDaysCount).toBe(4);
  expect(oneShort.state.engineGates.winDays.pass).toBe(false); // 4 >= 5 is false
});

// -----------------------------------------------------------------------------
// R-36  funded consistency, R-29's arithmetic over the R-47 period
// -----------------------------------------------------------------------------
test(reU('R-36'), () => {
  // CORE-50K's funded consistency is 3000bp (Appendix A.1). R-29 is
  // `best * 10000 <= max_bp * profit`, cross multiplied, so the tie passes.
  //
  //   best 60,000c on period profit 200,000c:
  //   60,000 * 10,000 = 600,000,000
  //   3000 * 200,000  = 600,000,000     equal, so `<=` holds. Exactly 3000bp.
  //
  // The day contributes 20,000c of profit and does not become the best day, so
  // the accumulators reaching the gate are 60,000c on 200,000c.
  const atThreshold = fold(
    CORE_50K,
    {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_300_000n,
      realizedPnlCents: 20_000n,
      fillCount: 2,
    },
    fundedPrior(CORE_50K, {
      balanceCents: 5_300_000n,
      consistencyBestDayCents: 60_000n,
      consistencyPeriodProfitCents: 180_000n,
    }),
  );
  expect(atThreshold.state.consistencyBestDayCents).toBe(60_000n);
  expect(atThreshold.state.consistencyPeriodProfitCents).toBe(200_000n);
  expect(atThreshold.state.engineGates.consistency.pass).toBe(true);
  expect(atThreshold.state.engineGates.consistency.bestDayShareBp).toBe(3000);
  expect(atThreshold.state.engineGates.consistency.profitNeededToDiluteCents).toBe(0n);

  // ONE CENT OVER, which is GS-024's shape at the funded gate.
  //
  //   best 60,001c on 200,000c: 600,010,000 > 600,000,000, so `<=` fails.
  //   profit needed to dilute = ceil((60,001 * 10,000 - 3000 * 200,000) / 3000)
  //                           = ceil(10,000 / 3000) = 4
  //
  // AS-13 IS WHY THE NUMBER IS REPORTED RATHER THAN A BOOLEAN: "the portal must
  // show `profit_needed_to_dilute_cents` at all times, not only when the gate
  // fails, so a trader can see the shape of the rule before it bites."
  const oneCentOver = fold(
    CORE_50K,
    {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_300_000n,
      realizedPnlCents: 20_000n,
      fillCount: 2,
    },
    fundedPrior(CORE_50K, {
      balanceCents: 5_300_000n,
      consistencyBestDayCents: 60_001n,
      consistencyPeriodProfitCents: 180_000n,
    }),
  );
  expect(oneCentOver.state.engineGates.consistency.pass).toBe(false);
  expect(oneCentOver.state.engineGates.consistency.profitNeededToDiluteCents).toBe(4n);

  // R-36 DELAYS AND NEVER BREACHES: "failing delays eligibility and never
  // breaches, never denies retroactively." The account is still funded, still
  // open, and nothing about the day was refused.
  expect(oneCentOver.state.phase).toBe('funded');
  expect(oneCentOver.state.breached).toBe(false);
  expect(oneCentOver.assertions).toEqual([]);

  // R-30's denominator rule reaches the funded gate too, through the same
  // function: a period with no positive profit is SKIPPED, not evaluated.
  const noProfit = fold(
    CORE_50K,
    {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_300_000n,
      realizedPnlCents: -20_000n,
      lowBalanceCents: 5_270_000n,
      fillCount: 2,
    },
    fundedPrior(CORE_50K, {
      balanceCents: 5_300_000n,
      consistencyBestDayCents: 0n,
      consistencyPeriodProfitCents: 0n,
    }),
  );
  expect(noProfit.state.engineGates.consistency.skipped).toBe(true);
  expect(noProfit.state.engineGates.consistency.pass).toBe(true);
});

// -----------------------------------------------------------------------------
// R-37  the cadence gap, `>=`, by `sequence` subtraction
// -----------------------------------------------------------------------------
test(reU('R-37'), () => {
  // THE WINDOW'S SEQUENCES START AT 4021 AND THAT IS THE POINT. A gap counted by
  // position in the loaded window rather than by calendar `sequence` would agree
  // with this test only because the window happens to be contiguous; the base is
  // non-zero so a test cannot confuse the two by accident.
  //
  // MERIT-RAPID-50K carries a 1 trading day gap (Appendix A.2), which is the
  // smallest published one and the only one this five-session window can show on
  // both sides of its boundary.
  //
  //   anchor 2026-11-03 (sequence 4022), day 2026-11-04 (4023): 4023 - 4022 = 1
  //   1 >= 1 passes.
  const atGap = fold(
    MERIT_RAPID_50K,
    {
      tradingDay: day('2026-11-04'),
      openingBalanceCents: 5_200_000n,
      realizedPnlCents: 20_000n,
      fillCount: 2,
    },
    fundedPrior(MERIT_RAPID_50K, {
      tradingDay: day('2026-11-03'),
      balanceCents: 5_200_000n,
      cadenceAnchorDay: day('2026-11-03'),
      payoutAnchorDay: day('2026-11-03'),
      payoutsSettledCount: 1,
    }),
  );
  expect(atGap.state.engineGates.cadenceGap.tradingDaysSinceLastPayout).toBe(1);
  expect(atGap.state.engineGates.cadenceGap.need).toBe(1);
  expect(atGap.state.engineGates.cadenceGap.pass).toBe(true);
  expect(atGap.state.engineGates.cadenceGap.skipped).toBe(false);

  // THE OTHER SIDE: the same day against Core EOD's 5 day gap (Appendix A.1).
  // 4023 - 4022 = 1, and 1 >= 5 is false. AS-06 requires the trader to be given
  // the resolved DATE rather than a count of trading days, and 4022 + 5 = 4027
  // is past the end of this five-session window, so the date is honestly `null`
  // rather than invented.
  const shortOfGap = fold(
    CORE_50K,
    {
      tradingDay: day('2026-11-04'),
      openingBalanceCents: 5_200_000n,
      realizedPnlCents: 20_000n,
      fillCount: 2,
    },
    fundedPrior(CORE_50K, {
      tradingDay: day('2026-11-03'),
      balanceCents: 5_200_000n,
      cadenceAnchorDay: day('2026-11-03'),
      payoutAnchorDay: day('2026-11-03'),
      payoutsSettledCount: 1,
    }),
  );
  expect(shortOfGap.state.engineGates.cadenceGap.pass).toBe(false);
  expect(shortOfGap.state.engineGates.cadenceGap.need).toBe(5);
  expect(shortOfGap.state.engineGates.cadenceGap.nextEligibleTradingDay).toBeNull();

  // AS-06's resolved date, when the slice reaches it. Anchor 2026-11-02
  // (sequence 4021) on Merit Rapid's 1 day gap resolves to 4022, which this
  // window holds: 2026-11-03. The gate is still failing, which is the only time
  // the date means anything.
  const pendingWithDate = fold(
    MERIT_RAPID_50K,
    {
      tradingDay: day('2026-11-02'),
      openingBalanceCents: 5_200_000n,
      realizedPnlCents: 20_000n,
      fillCount: 2,
    },
    fundedPrior(MERIT_RAPID_50K, {
      tradingDay: day('2026-11-01'),
      balanceCents: 5_200_000n,
      cadenceAnchorDay: day('2026-11-02'),
      payoutAnchorDay: day('2026-11-02'),
      payoutsSettledCount: 1,
    }),
  );
  expect(pendingWithDate.state.engineGates.cadenceGap.tradingDaysSinceLastPayout).toBe(0);
  expect(pendingWithDate.state.engineGates.cadenceGap.pass).toBe(false);
  expect(pendingWithDate.state.engineGates.cadenceGap.nextEligibleTradingDay).toBe('2026-11-03');

  // NO ANCHOR IS `skipped`, NOT MERELY PASSING. "Passes trivially when it is
  // null (no gap on the first payout)", and a trader looking at a first payout
  // must see a gate that had nothing to measure rather than one that reads as
  // satisfied. That is CV-19's vocabulary applied to a second gate.
  const firstPayout = fold(CORE_50K, {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: 20_000n,
    fillCount: 2,
  });
  expect(firstPayout.state.cadenceAnchorDay).toBeNull();
  expect(firstPayout.state.engineGates.cadenceGap.skipped).toBe(true);
  expect(firstPayout.state.engineGates.cadenceGap.pass).toBe(true);
  expect(firstPayout.state.engineGates.cadenceGap.tradingDaysSinceLastPayout).toBeNull();
});

// -----------------------------------------------------------------------------
// R-37, the half P2 section 1 ruled: an anchor the slice cannot answer for
// -----------------------------------------------------------------------------
test('RE-U-037  R-37  an anchor outside the slice REFUSES the day rather than passing the gate', () => {
  // P2 section 1, adopting a typed refusal over the two alternatives: returning
  // null and letting the gate pass "silently weakens R-37, a money gate", and
  // throwing would make "the fold's behavior depend on how much calendar the
  // caller loaded, which is a caller decision leaking into engine output".
  //
  // The window covers 2026-11-02 to 2026-11-06. An anchor in October is a
  // sequence the slice does not hold, which is exactly replay's case: "replay
  // will ask for the sequence of an anchor older than the slice."
  const refused = fold(
    CORE_50K,
    {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_200_000n,
      realizedPnlCents: 20_000n,
      fillCount: 2,
    },
    fundedPrior(CORE_50K, {
      balanceCents: 5_200_000n,
      cadenceAnchorDay: day('2026-10-15'),
      payoutAnchorDay: day('2026-10-15'),
      payoutsSettledCount: 1,
    }),
  );

  expect(refused.assertions).toHaveLength(1);
  expect(refused.assertions[0]?.kind).toBe('calendar_coverage_miss');
  expect(refused.assertions[0]?.detail).toContain('R-37');
  // NO STATE IS WRITTEN FOR THE DAY: the fold returns what it arrived with, so
  // the refusal cannot be mistaken for a folded day carrying a passing gate.
  expect(refused.events).toEqual([]);
  expect(refused.state.tradingDay).toBe('2026-11-02');
});

// -----------------------------------------------------------------------------
// R-39  `min(withdrawable, cap) >= min_payout_cents`, `>=`
// -----------------------------------------------------------------------------
test(reU('R-39'), () => {
  // GS-042: "`10000 >= 10000` eligible; `9999` not eligible." CV-15 fixes the
  // minimum at 10,000c and it never scales by size.
  //
  //   5,110,000 - 5,000,000 - 100,000 = 10,000 withdrawable, against a
  //   150,000c cap: min(10,000, 150,000) = 10,000, and 10,000 >= 10,000.
  const atMinimum = fold(
    CORE_50K,
    {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_100_000n,
      realizedPnlCents: 10_000n,
      fillCount: 2,
    },
    fundedPrior(CORE_50K, { balanceCents: 5_100_000n }),
  );
  expect(atMinimum.state.withdrawableCents).toBe(10_000n);
  expect(atMinimum.state.engineGates.minimumAmount.pass).toBe(true);
  expect(atMinimum.state.engineGates.minimumAmount.capCents).toBe(150_000n);
  expect(atMinimum.state.engineGates.minimumAmount.minPayoutCents).toBe(10_000n);

  // ONE CENT BELOW: 5,109,999 - 5,000,000 - 100,000 = 9,999.
  const oneCentBelow = fold(
    CORE_50K,
    {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_100_000n,
      realizedPnlCents: 9_999n,
      fillCount: 2,
    },
    fundedPrior(CORE_50K, { balanceCents: 5_100_000n }),
  );
  expect(oneCentBelow.state.withdrawableCents).toBe(9_999n);
  expect(oneCentBelow.state.engineGates.minimumAmount.pass).toBe(false);

  // THE CAP IS THE OTHER TERM OF THE `min`, and it is the rung for THIS state's
  // ordinal (R-42, R-45). A cap below the minimum would make an account
  // permanently ineligible while looking healthy, which is why CV-10 rejects it
  // at publish rather than here (GS-076).
  expect(atMinimum.state.engineGates.minimumAmount.withdrawableCents).toBe(10_000n);
});

// -----------------------------------------------------------------------------
// R-41  `engineEligible` is the conjunction, with no shortcut path
// -----------------------------------------------------------------------------
test(reU('R-41'), () => {
  // A funded CORE-50K account clearing every engine gate at once:
  //
  //   traded days   0 required, SKIPPED and passing (ADR-015)
  //   win days      5 of 5
  //   buffer        5,300,000 - 5,000,000 = 300,000 over a 100,000 buffer
  //   consistency   best 60,000 on 200,000 = 3000bp, exactly at the limit
  //   cadence gap   no anchor, so skipped and passing
  //   minimum       min(200,000 withdrawable, 150,000 cap) = 150,000 >= 10,000
  const eligible = fold(
    CORE_50K,
    {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_280_000n,
      realizedPnlCents: 20_000n,
      fillCount: 2,
    },
    fundedPrior(CORE_50K, {
      balanceCents: 5_280_000n,
      winDaysCount: 5,
      consistencyBestDayCents: 60_000n,
      consistencyPeriodProfitCents: 180_000n,
    }),
  );

  const gates = eligible.state.engineGates;
  expect(gates.tradedDays.pass).toBe(true);
  expect(gates.winDays.pass).toBe(true);
  expect(gates.buffer.pass).toBe(true);
  expect(gates.consistency.pass).toBe(true);
  expect(gates.cadenceGap.pass).toBe(true);
  expect(gates.minimumAmount.pass).toBe(true);
  expect(eligible.state.engineEligible).toBe(true);

  // INV-15, THE OTHER SIDE, GATE BY GATE. One failing term makes the conjunction
  // false, and there is no shortcut path that could rescue it. The win-day gate
  // is moved because it is the one gate a v1 plan can fail while every other one
  // holds, which is what makes it the honest witness.
  const oneGateShort = fold(
    CORE_50K,
    {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_280_000n,
      realizedPnlCents: 20_000n,
      fillCount: 2,
    },
    fundedPrior(CORE_50K, {
      balanceCents: 5_280_000n,
      winDaysCount: 3,
      consistencyBestDayCents: 60_000n,
      consistencyPeriodProfitCents: 180_000n,
    }),
  );
  expect(oneGateShort.state.engineGates.winDays.pass).toBe(false);
  expect(oneGateShort.state.engineEligible).toBe(false);

  // AND A BREACH IS NEVER ELIGIBLE, whatever the balance says. DO-5 returns
  // before DO-9, so the gates on a breach row are stated rather than computed:
  // every one is false, including the two that can otherwise report `skipped`.
  const breached = fold(
    CORE_50K,
    {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_280_000n,
      realizedPnlCents: -20_000n,
      lowBalanceCents: 4_749_999n,
      fillCount: 2,
    },
    fundedPrior(CORE_50K, { balanceCents: 5_280_000n, winDaysCount: 5 }),
  );
  expect(breached.state.breached).toBe(true);
  expect(breached.state.engineEligible).toBe(false);
  expect(breached.state.engineGates.tradedDays.pass).toBe(false);
  expect(breached.state.engineGates.tradedDays.skipped).toBe(false);
  expect(breached.state.engineGates.cadenceGap.pass).toBe(false);
});
