// =============================================================================
// GROUP F: THE FUNDED GATES. RE-U-033 to RE-U-041.
// =============================================================================
// Every expectation here is arithmetic stated in a document, and the arithmetic
// is written out beside it in integer cents so a reader checks the number
// instead of trusting it (P2 section 2's second traceability tier).
//
// THIS FILE ARRIVES WITH R-35 ALONE, which is the group's only rule group G
// depends on. The rest of the gates land with the rest of group F.
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
