// =============================================================================
// GROUP H: SETTLEMENT, POST-PAYOUT, LADDER. RE-U-046 to RE-U-050, and RE-U-019.
// =============================================================================
// Every expectation here is arithmetic stated in a document, and the arithmetic
// is written out beside it in integer cents so a reader checks the number
// instead of trusting it (P2 section 2's second traceability tier).
//
// THE PLAN IS CORE-50K THROUGHOUT: size 5,000,000c, buffer 100,000c, cap
// 150,000c, ladder 5, funded drawdown 250,000c, locked floor 5,010,000c
// (M01 Appendix A.1's 50K column).
// =============================================================================

import { expect, test } from 'vitest';

import { advanceDay } from '../src/day/advance.ts';
import { applySettlement } from '../src/payout/settle.ts';
import type { Cents, DayOutput, RuleState, SettlementFact, TradingDay } from '../src/types.ts';
import {
  ACCOUNT_OPENED_ON,
  CME_WINDOW,
  CORE_50K,
  ENGINE_VERSION,
  day,
  fundedPrior,
  mark,
} from './fixtures-in-code.ts';
import { reU } from './rule-coverage.ts';

/**
 * A settled payout of one full CORE-50K cap.
 *
 * BOTH DAYS ARE THE SAME DAY, and that is the v1 lineup rather than a
 * simplification: ADR-019's wallet makes the internal leg instant, so "the
 * wallet-credit day IS the basis day" (M01 R-37). The two are separate
 * PARAMETERS here so a test can move one without the other, which is what SD-02
 * exists to make possible.
 */
function settlement(fields: {
  readonly ordinal?: number;
  readonly approvedCents?: Cents;
  readonly basisTradingDay?: TradingDay;
  readonly effectiveTradingDay?: TradingDay;
}): SettlementFact {
  return {
    payoutRequestId: `payout-${String(fields.ordinal ?? 1)}`,
    ordinal: fields.ordinal ?? 1,
    approvedCents: fields.approvedCents ?? 150_000n,
    basisTradingDay: fields.basisTradingDay ?? day('2026-11-03'),
    effectiveTradingDay: fields.effectiveTradingDay ?? day('2026-11-03'),
  };
}

/**
 * A funded account holding a full cap plus its buffer, with five win days.
 *
 *   5,250,000 - 5,000,000 - 100,000 = 150,000 withdrawable, exactly the cap.
 */
function readyToBePaid(overrides: Partial<RuleState> = {}): RuleState {
  return fundedPrior(CORE_50K, {
    tradingDay: day('2026-11-03'),
    balanceCents: 5_250_000n,
    withdrawableCents: 150_000n,
    highWaterBalanceCents: 5_250_000n,
    floorCents: 5_000_000n,
    winDaysCount: 5,
    consistencyBestDayCents: 45_000n,
    consistencyPeriodProfitCents: 250_000n,
    ...overrides,
  });
}

// -----------------------------------------------------------------------------
// R-46  settlement advances BOTH anchors, and they are different dates
// -----------------------------------------------------------------------------
test(reU('R-46'), () => {
  // SD-02: the two anchors "are genuinely different dates and conflating them is
  // a silent liability change of 40 percent (EC-039)". `payoutAnchorDay` is the
  // BASIS day and drives R-47's win-day reset; `cadenceAnchorDay` is the
  // wallet-credit day and drives R-37's gap.
  //
  // They are given DIFFERENT VALUES here on purpose. On the v1 lineup ADR-019
  // makes them the same day, so a settlement written with one column would pass
  // every published scenario and fail the first time the settlement model moves.
  const out = applySettlement(
    readyToBePaid(),
    CORE_50K,
    settlement({
      basisTradingDay: day('2026-11-03'),
      effectiveTradingDay: day('2026-11-05'),
    }),
    CME_WINDOW,
  );

  expect(out.assertions).toEqual([]);
  expect(out.state.payoutAnchorDay).toBe('2026-11-03');
  expect(out.state.cadenceAnchorDay).toBe('2026-11-05');

  // And the v1 case, where the two coincide because the internal leg is instant.
  const instant = applySettlement(readyToBePaid(), CORE_50K, settlement({}), CME_WINDOW);
  expect(instant.state.payoutAnchorDay).toBe('2026-11-03');
  expect(instant.state.cadenceAnchorDay).toBe('2026-11-03');

  // The balance falls by exactly the approved amount and by nothing else.
  //   5,250,000 - 150,000 = 5,100,000, which is `size + buffer` to the cent.
  expect(instant.state.balanceCents).toBe(5_100_000n);
  expect(instant.state.withdrawableCents).toBe(0n);
});

// -----------------------------------------------------------------------------
// R-47  win days and the consistency period reset, anchored to the BASIS day
// -----------------------------------------------------------------------------
test(reU('R-47'), () => {
  const before = readyToBePaid();
  const out = applySettlement(before, CORE_50K, settlement({}), CME_WINDOW);

  expect(before.winDaysCount).toBe(5);
  expect(out.state.winDaysCount).toBe(0);
  expect(out.state.consistencyBestDayCents).toBe(0n);
  expect(out.state.consistencyPeriodProfitCents).toBe(0n);

  // AS-12's off-by-one, which is the whole reason SD-07 stores this day: the
  // period starts on the trading day STRICTLY AFTER the basis day. The basis day
  // is 2026-11-03 and the window's next session is 2026-11-04. Including the
  // basis day would let "the very day that funded a payout count against the
  // next cycle", and it would look like the consistency rule working.
  expect(out.state.consistencyPeriodStartDay).toBe('2026-11-04');

  // The reset event carries the anchor, because M01 section 5.2 says "reset to
  // zero" without it "is not enough to explain the next cycle".
  const reset = out.events.find((e) => e.type === 'payout.win_days_reset');
  expect(reset).toMatchObject({
    previousCount: 5,
    resetTo: 0,
    anchorTradingDay: '2026-11-03',
    consistencyPeriodStartDay: '2026-11-04',
  });
});

// -----------------------------------------------------------------------------
// R-47, the calendar half ADR-049 rules
// -----------------------------------------------------------------------------
test('RE-U-047  R-47  a basis day the slice cannot step past REFUSES the settlement', () => {
  // The window's last session is 2026-11-06, so there is no "next trading day"
  // after it inside the slice. P2 section 1 and ADR-049 rule that a typed
  // refusal rather than a null: "returning null silently weakens a money gate."
  //
  // NOTHING IS APPLIED. The state that comes back is the one handed in, so a
  // caller cannot mistake a refused settlement for one that moved no fields.
  const before = readyToBePaid();
  const out = applySettlement(
    before,
    CORE_50K,
    settlement({ basisTradingDay: day('2026-11-06'), effectiveTradingDay: day('2026-11-06') }),
    CME_WINDOW,
  );

  expect(out.assertions).toHaveLength(1);
  expect(out.assertions[0]?.kind).toBe('calendar_coverage_miss');
  expect(out.assertions[0]?.detail).toContain('R-47');
  expect(out.events).toEqual([]);
  expect(out.state).toEqual(before);
});

// -----------------------------------------------------------------------------
// R-48 and R-19  the floor is UNTOUCHED by settlement
// -----------------------------------------------------------------------------
test(reU('R-19'), () => {
  // ADR-014 removed the post-payout recompute entirely, so R-19 and R-48 are
  // discharged by an ABSENCE: "`floorCents`, `highWaterBalanceCents`, and
  // `floorLocked` all carry through untouched." An absence is the one kind of
  // rule a reader cannot verify by finding the line, which is why it is asserted
  // field by field here.
  //
  // The account is LOCKED, because that is where a recompute would do the most
  // damage: INV-07 is "a locked floor never changes again for the life of the
  // account".
  const locked = readyToBePaid({
    floorCents: 5_010_000n, // the locked floor, size + 10,000 (ADR-014, X = $100)
    floorLocked: true,
    highWaterBalanceCents: 5_260_000n,
  });
  const out = applySettlement(locked, CORE_50K, settlement({}), CME_WINDOW);

  expect(out.state.floorCents).toBe(5_010_000n);
  expect(out.state.floorLocked).toBe(true);

  // INV-21, WHICH IS WHAT MAKES THE ABSENCE SAFE: "a settled payout can never
  // breach the account that earned it." The balance after the extraction is
  // 5,100,000c and the locked floor is 5,010,000c, so the account is 90,000c
  // clear. CV-11 is what guarantees that at publish time rather than here:
  // `buffer_cents (100,000) > floor_lock_floor_at_cents - size_cents (10,000)`.
  expect(out.state.balanceCents).toBe(5_100_000n);
  expect(out.state.balanceCents > out.state.floorCents).toBe(true);

  // The trailing case, so a recompute is visible on an unlocked account too.
  const trailing = applySettlement(readyToBePaid(), CORE_50K, settlement({}), CME_WINDOW);
  expect(trailing.state.floorCents).toBe(5_000_000n);
  expect(trailing.state.floorLocked).toBe(false);
});

test(reU('R-48'), () => {
  // R-48 IS R-19 FROM THE SETTLEMENT'S SIDE, and the assertion that distinguishes
  // them is that the floor does not move DOWN with the balance either. A payout
  // drops the balance by 150,000c; a floor that followed it would hand back the
  // loss room ADR-014 deliberately removed, and M01 R-19 says the trader's loss
  // room after an extraction "is the buffer, and that is what the rules page
  // must say".
  const before = readyToBePaid();
  const out = applySettlement(before, CORE_50K, settlement({}), CME_WINDOW);

  expect(out.state.balanceCents).toBe(before.balanceCents - 150_000n);
  expect(out.state.floorCents).toBe(before.floorCents);

  // The loss room, stated as the number the rules page owes the trader:
  //   5,100,000 - 5,000,000 = 100,000c, which is exactly the buffer.
  expect(out.state.balanceCents - out.state.floorCents).toBe(100_000n);

  // THE HIGH-WATER BALANCE IS THE THIRD FIELD AND IT IS THE ONE A RECOMPUTE
  // WOULD REACH FOR NEXT, because dropping it to the post-payout balance lowers
  // the floor by a route the floor's own tripwire never sees: R-13 re-trails
  // from the lower high on every subsequent day, so tomorrow's floor is
  // 250,000c below a high the account already made. INV-06 is violated across
  // days rather than within one, which is exactly the interval R-14's tripwire
  // does not sample.
  expect(out.state.highWaterBalanceCents).toBe(before.highWaterBalanceCents);
  expect(out.state.highWaterBalanceCents).toBe(5_250_000n);

  // And on a locked account, where the frozen high-water balance is what INV-07
  // ("a locked floor never changes again") rests on.
  const locked = applySettlement(
    readyToBePaid({ floorCents: 5_010_000n, floorLocked: true, highWaterBalanceCents: 5_260_000n }),
    CORE_50K,
    settlement({}),
    CME_WINDOW,
  );
  expect(locked.state.highWaterBalanceCents).toBe(5_260_000n);
});

// -----------------------------------------------------------------------------
// R-49  the ladder, `>=`, evaluated immediately after the settlement
// -----------------------------------------------------------------------------
test(reU('R-49'), () => {
  // CORE-50K's ladder is 5 (ADR-024, Appendix A.1). The boundary is one
  // settlement apart, on the same plan and the same fact.
  //
  //   four already settled, this is the fifth: 5 >= 5 graduates
  const fifth = applySettlement(
    readyToBePaid({ payoutsSettledCount: 4 }),
    CORE_50K,
    settlement({ ordinal: 5 }),
    CME_WINDOW,
  );
  expect(fifth.state.payoutsSettledCount).toBe(5);
  expect(fifth.state.phase).toBe('graduated');

  const graduated = fifth.events.find((e) => e.type === 'account.graduated');
  expect(graduated).toMatchObject({ payoutsSettledCount: 5, maxPayouts: 5 });

  // NO LIVE INVITATION TRAVELS WITH IT. ADR-024 makes graduation eligibility "a
  // review-pool flag, and invitation is a discretionary operator action taken
  // from that pool, outside the engine". M01 section 5.2's event table still
  // lists `account.live_invitation_issued` on R-49's row; R-49's own text rules
  // it out by name, and this asserts the ruling rather than the stale row.
  expect(fifth.events.map((e) => e.type)).not.toContain('account.live_invitation_issued');

  //   three already settled, this is the fourth: 4 >= 5 is false
  const fourth = applySettlement(
    readyToBePaid({ payoutsSettledCount: 3 }),
    CORE_50K,
    settlement({ ordinal: 4 }),
    CME_WINDOW,
  );
  expect(fourth.state.payoutsSettledCount).toBe(4);
  expect(fourth.state.phase).toBe('funded');
  expect(fourth.events.map((e) => e.type)).not.toContain('account.graduated');

  // A graduated account has nothing left to extract, and nothing special-cases
  // it: R-35 returns `0n` outside the funded phase and the gates follow.
  expect(fifth.state.withdrawableCents).toBe(0n);
  expect(fifth.state.engineEligible).toBe(false);
});

// -----------------------------------------------------------------------------
// R-50  lifetime accounting, which INV-17 bounds
// -----------------------------------------------------------------------------
test(reU('R-50'), () => {
  // `lifetimeSettledCents += approvedCents`, and INV-17 bounds it at
  // `ladder * max cap in the schedule`. On CORE-50K that is 5 x 150,000 =
  // 750,000c, which AS-03 states as "675,000c ($6,750) to the trader" after the
  // 9000bp split. The liability bound the whole plan lineup rests on.
  const first = applySettlement(readyToBePaid(), CORE_50K, settlement({}), CME_WINDOW);
  expect(first.state.lifetimeSettledCents).toBe(150_000n);

  const fifth = applySettlement(
    readyToBePaid({ payoutsSettledCount: 4, lifetimeSettledCents: 600_000n }),
    CORE_50K,
    settlement({ ordinal: 5 }),
    CME_WINDOW,
  );
  expect(fifth.state.lifetimeSettledCents).toBe(750_000n);

  // INV-17's bound, computed from the config rather than restated: the ladder
  // times the largest rung in the schedule. The account graduates here, so no
  // sixth settlement can be applied and the bound is reached rather than passed.
  const bound = BigInt(CORE_50K.funded.maxPayouts) * 150_000n;
  expect(fifth.state.lifetimeSettledCents).toBe(bound);
  expect(fifth.state.phase).toBe('graduated');

  // A partial amount accumulates as itself, not as a cap: a clamped payout of
  // 120,000c (GS-027's number) adds 120,000c.
  const partial = applySettlement(
    readyToBePaid({ lifetimeSettledCents: 150_000n, payoutsSettledCount: 1 }),
    CORE_50K,
    settlement({ ordinal: 2, approvedCents: 120_000n }),
    CME_WINDOW,
  );
  expect(partial.state.lifetimeSettledCents).toBe(270_000n);
});

// -----------------------------------------------------------------------------
// DO-2: the fold applies settlements in ORDINAL ORDER, before everything else
// -----------------------------------------------------------------------------
function fold(prior: RuleState, settlements: readonly SettlementFact[]): DayOutput {
  return advanceDay({
    engineVersion: ENGINE_VERSION,
    plan: CORE_50K,
    prior,
    // INV-18 IS WHY THE ADJUSTMENT IS HERE. SD-01 carries a settled withdrawal
    // in `adjustment_cents`, applied at the OPEN of the effective day (R-10),
    // and INV-18 is `opening == PRIOR.balance + adjustment`. The opening is
    // therefore 5,250,000 - 150,000 = 5,100,000 with an adjustment of -150,000.
    mark: mark({
      tradingDay: day('2026-11-04'),
      openingBalanceCents: 5_100_000n,
      adjustmentCents: -150_000n,
      realizedPnlCents: 20_000n,
      fillCount: 2,
    }),
    calendar: CME_WINDOW,
    settlements,
    openedOn: ACCOUNT_OPENED_ON,
  });
}

test('DO-2 applies a settlement before DO-3, and INV-18 reads the PRE-settlement balance', () => {
  // M01 section 3.6's sketch compares the mark's opening against the
  // POST-settlement balance plus the adjustment, which counts the withdrawal
  // twice: 5,100,000 - 150,000 = 4,950,000 expected against a real 5,100,000.
  // Every payout day would raise `opening_mismatch` and write no state at all.
  // INV-18's own row says `PRIOR.balance_cents`, and this asserts the row.
  const out = fold(readyToBePaid(), [
    settlement({ effectiveTradingDay: day('2026-11-04'), basisTradingDay: day('2026-11-03') }),
  ]);

  expect(out.assertions).toEqual([]);
  expect(out.state.payoutsSettledCount).toBe(1);
  expect(out.state.payoutAnchorDay).toBe('2026-11-03');
  expect(out.state.balanceCents).toBe(5_120_000n); // 5,100,000 opening + 20,000 realized

  // R-47's FAIRNESS POINT, in the fold rather than in the function: the day's
  // own win day is counted AFTER the reset, not confiscated by it. The reset
  // took the count to 0 at DO-2 and this day's 20,000c clears the 15,000c
  // win-day floor at DO-6, so the count is 1.
  expect(out.state.winDaysCount).toBe(1);

  // The consistency period restarted at the day after the basis day, and this
  // day is inside it, so the day's P&L accumulates rather than being skipped.
  expect(out.state.consistencyPeriodStartDay).toBe('2026-11-04');
  expect(out.state.consistencyPeriodProfitCents).toBe(20_000n);

  // Both event kinds, in emission order: the settlement's, then the day's.
  expect(out.events.map((e) => e.type)).toEqual(['payout.win_days_reset', 'day.closed']);
});

test('DO-2 sorts by ordinal, and a graduating settlement stops the day', () => {
  // Two settlements effective the same day, supplied in the WRONG order. R-49
  // graduates at the fifth, so an unsorted fold would apply ordinal 5 first and
  // graduate the account against ordinal 4's cap rung.
  const out = fold(readyToBePaid({ payoutsSettledCount: 3, balanceCents: 5_400_000n }), [
    settlement({ ordinal: 5, approvedCents: 100_000n, effectiveTradingDay: day('2026-11-04') }),
    settlement({ ordinal: 4, approvedCents: 150_000n, effectiveTradingDay: day('2026-11-04') }),
  ]);

  expect(out.assertions).toEqual([]);
  expect(out.state.payoutsSettledCount).toBe(5);
  expect(out.state.phase).toBe('graduated');
  expect(out.state.lifetimeSettledCents).toBe(250_000n);

  // R-49: "no trading day follows". The fold returns at DO-2 without closing the
  // day, so there is no `day.closed` and no counter advanced on an account that
  // has none.
  expect(out.events.map((e) => e.type)).toEqual([
    'payout.win_days_reset',
    'payout.win_days_reset',
    'account.graduated',
  ]);
  expect(out.state.tradingDay).toBe('2026-11-03');
});

test('a settlement that cannot be applied refuses the whole day', () => {
  // The basis day is the window's last session, so R-47 cannot step past it.
  // Folding the rest of the day would advance every counter against a balance
  // the payout has already left, which is FM-05's idiom on the money path it was
  // written for.
  const before = readyToBePaid();
  const out = fold(before, [
    settlement({ basisTradingDay: day('2026-11-06'), effectiveTradingDay: day('2026-11-04') }),
  ]);

  expect(out.assertions).toHaveLength(1);
  expect(out.assertions[0]?.kind).toBe('calendar_coverage_miss');
  expect(out.events).toEqual([]);
  expect(out.state).toEqual(before);
});
