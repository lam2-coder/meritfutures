// =============================================================================
// GROUP B: MARKS. RE-U-007 to RE-U-009.
// =============================================================================
// R-10 and R-11 are group B and are not here, and their absence is the count
// being honest rather than the file being short: R-10 is a property of how the
// BATCH applies a non-trading movement ("at the open of `effectiveTradingDay`,
// never inside a session") and the engine's half of it is INV-18's adjustment
// term, asserted below; R-11 is `superseded_by is null`, which is a query the
// engine never makes because it is handed live marks.
// =============================================================================

import { expect, test } from 'vitest';

import { advanceDay } from '../src/day/advance.js';
import { isTradedDay, isWinDay } from '../src/day/counters.js';
import type { CalendarDay, DayOutput } from '../src/types.js';
import {
  CME_WINDOW,
  CORE_50K,
  ENGINE_VERSION,
  day,
  fundedPrior,
  mark,
} from './fixtures-in-code.js';
import { reU } from './rule-coverage.js';

const OPEN_SESSION: CalendarDay = {
  tradingDay: day('2026-11-03'),
  isHalfDay: false,
  halted: false,
  sequence: 4022,
};

/** A day folded with the mark stated field by field, so DO-3 can be broken on purpose. */
function foldRaw(fields: {
  readonly openingBalanceCents: bigint;
  readonly closingBalanceCents: bigint;
  readonly realizedPnlCents: bigint;
  readonly adjustmentCents?: bigint;
  readonly priorBalanceCents?: bigint;
  readonly tradedDaysCount?: number;
}): DayOutput {
  return advanceDay({
    engineVersion: ENGINE_VERSION,
    plan: CORE_50K,
    prior: fundedPrior(CORE_50K, {
      balanceCents: fields.priorBalanceCents ?? 5_000_000n,
      tradedDaysCount: fields.tradedDaysCount ?? 1,
    }),
    mark: {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: fields.openingBalanceCents,
      closingBalanceCents: fields.closingBalanceCents,
      highBalanceCents: 5_100_000n,
      lowBalanceCents: 4_900_000n,
      realizedPnlCents: fields.realizedPnlCents,
      adjustmentCents: fields.adjustmentCents ?? 0n,
      fillCount: 1,
      sourceHash: 'unit',
    },
    calendar: CME_WINDOW,
    settlements: [],
  });
}

// -----------------------------------------------------------------------------
// R-07  the mark identities, INV-18 with INV-19 and INV-20 beside it
// -----------------------------------------------------------------------------
test(reU('R-07'), () => {
  // EXACTLY EQUAL PASSES. prior 5,000,000 + adjustment 0 == opening 5,000,000,
  // and closing 5,020,000 == opening + realized 20,000.
  const clean = foldRaw({
    openingBalanceCents: 5_000_000n,
    closingBalanceCents: 5_020_000n,
    realizedPnlCents: 20_000n,
  });
  expect(clean.assertions).toEqual([]);

  // ONE CENT OFF REFUSES, AND DOES NOT THROW. No state is written for the day
  // and reconciliation is what the caller raises (FM-05, EC-047).
  const off = foldRaw({
    openingBalanceCents: 5_000_001n,
    closingBalanceCents: 5_020_001n,
    realizedPnlCents: 20_000n,
  });
  expect(off.assertions.map((a) => a.kind)).toEqual(['opening_mismatch']);
  expect(off.assertions[0]?.expected).toBe(5_000_000n);
  expect(off.assertions[0]?.got).toBe(5_000_001n);
  expect(off.events).toEqual([]);

  // THE ADJUSTMENT IS ON THE OPENING SIDE, which is the whole of AS-10's
  // counter: a settled 150,000c withdrawal lands at the open and the identity
  // holds through it rather than reading as a catastrophic trading loss.
  const withdrawn = foldRaw({
    priorBalanceCents: 5_200_000n,
    openingBalanceCents: 5_050_000n,
    closingBalanceCents: 5_050_000n,
    realizedPnlCents: 0n,
    adjustmentCents: -150_000n,
  });
  expect(withdrawn.assertions).toEqual([]);

  // INV-19, the closing identity, one cent off on the other term.
  const closingOff = foldRaw({
    openingBalanceCents: 5_000_000n,
    closingBalanceCents: 5_020_001n,
    realizedPnlCents: 20_000n,
  });
  expect(closingOff.assertions.map((a) => a.kind)).toEqual(['closing_mismatch']);

  // INV-20, and it fires only at the funded start: no traded day and no settled
  // payout. AS-14 is what it exists to refuse.
  const notAtSize = foldRaw({
    priorBalanceCents: 5_300_000n,
    openingBalanceCents: 5_300_000n,
    closingBalanceCents: 5_300_000n,
    realizedPnlCents: 0n,
    tradedDaysCount: 0,
  });
  expect(notAtSize.assertions.map((a) => a.kind)).toEqual(['funded_start_not_size']);

  // The same account one traded day later is past the boundary and the check no
  // longer applies, which is what "asserted at DO-3 on the transition boundary"
  // means.
  const pastBoundary = foldRaw({
    priorBalanceCents: 5_300_000n,
    openingBalanceCents: 5_300_000n,
    closingBalanceCents: 5_300_000n,
    realizedPnlCents: 0n,
    tradedDaysCount: 1,
  });
  expect(pastBoundary.assertions).toEqual([]);
});

// -----------------------------------------------------------------------------
// R-08  a traded day is `fill_count > 0`, STRICT
// -----------------------------------------------------------------------------
test(reU('R-08'), () => {
  expect(
    isTradedDay(
      mark({
        tradingDay: day('2026-11-03'),
        openingBalanceCents: 5_000_000n,
        realizedPnlCents: 0n,
        fillCount: 1,
      }),
    ),
  ).toBe(true);
  expect(
    isTradedDay(
      mark({
        tradingDay: day('2026-11-03'),
        openingBalanceCents: 5_000_000n,
        realizedPnlCents: 0n,
        fillCount: 0,
      }),
    ),
  ).toBe(false);

  // One fill with flat P&L is a traded day and not a win day, which is the pair
  // Appendix C names ("Fills but flat P&L is a traded day, not a win day").
  const out = advanceDay({
    engineVersion: ENGINE_VERSION,
    plan: CORE_50K,
    prior: fundedPrior(CORE_50K, { tradedDaysCount: 3, winDaysCount: 2 }),
    mark: mark({
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_000_000n,
      realizedPnlCents: 0n,
      fillCount: 1,
    }),
    calendar: CME_WINDOW,
    settlements: [],
  });
  expect(out.state.tradedDaysCount).toBe(4);
  expect(out.state.winDaysCount).toBe(2);
});

// -----------------------------------------------------------------------------
// R-09  a win day is `realized_pnl_cents >= win_day_floor_cents`
// -----------------------------------------------------------------------------
test(reU('R-09'), () => {
  const at = mark({
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: 15_000n,
  });
  const below = mark({
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: 14_999n,
  });

  // EXACTLY AT THE FLOOR COUNTS. The `>=` is published and pinned by GS-006 and
  // GS-007, and the floor at CORE-50K is 15,000c (30bp of 5,000,000c).
  expect(isWinDay(at, OPEN_SESSION, CORE_50K.funded.winDayFloorCents)).toBe(true);
  expect(isWinDay(below, OPEN_SESSION, CORE_50K.funded.winDayFloorCents)).toBe(false);
});
