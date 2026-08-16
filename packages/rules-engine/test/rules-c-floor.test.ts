// =============================================================================
// GROUP C: THE FLOOR. RE-U-012 to RE-U-018.
// =============================================================================
// Every expectation here is arithmetic stated in a document, and the arithmetic
// is written out beside it in integer cents so a reader checks the number
// instead of trusting it (P2 section 2's second traceability tier).
// =============================================================================

import { expect, test } from 'vitest';

import { advanceDay, initialState } from '../src/day/advance.js';
import { advanceFloor, initialFloorCents } from '../src/day/floor.js';
import { EngineInvariantError } from '../src/errors.js';
import type { DayOutput, ResolvedPlan, RuleState } from '../src/types.js';
import {
  CME_WINDOW,
  CORE_50K,
  ENGINE_VERSION,
  day,
  fundedPrior,
  mark,
  withStaticDrawdown,
  withoutFloorLock,
} from './fixtures-in-code.js';
import { reU } from './rule-coverage.js';

/** One funded day, folded. Every test in this file is one of these. */
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
// R-12  `floor = size_cents - drawdown_cents` at account open
// -----------------------------------------------------------------------------
test(reU('R-12'), () => {
  // GS-008: 4,750,000 = 5,000,000 - 250,000 on CORE-50K, and it exists before
  // any mark does.
  expect(initialFloorCents(5_000_000n, 250_000n)).toBe(4_750_000n);
  expect(initialState(CORE_50K, day('2026-11-02'), ENGINE_VERSION).floorCents).toBe(4_750_000n);

  // The other side of the boundary: the drawdown is what moves it, one cent at a
  // time, so a floor computed from the wrong parameter is visible as a number
  // rather than as a shape.
  expect(initialFloorCents(5_000_000n, 250_001n)).toBe(4_749_999n);
});

// -----------------------------------------------------------------------------
// R-13  the trailing floor reads the CLOSING balance only
// -----------------------------------------------------------------------------
test(reU('R-13'), () => {
  // GS-009: close 5,100,000 raises hwb and the floor to 4,850,000.
  //         4,850,000 = 5,100,000 - 250,000
  const raised = fold(CORE_50K, {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: 100_000n,
    highBalanceCents: 5_110_000n,
    lowBalanceCents: 4_995_000n,
    fillCount: 3,
  });
  expect(raised.assertions).toEqual([]);
  expect(raised.state.highWaterBalanceCents).toBe(5_100_000n);
  expect(raised.state.floorCents).toBe(4_850_000n);

  // GS-011, THE OTHER SIDE: high 5,090,000 with close 5,020,000 leaves hwb at
  // 5,020,000, so the floor is 4,770,000 = 5,020,000 - 250,000. The intraday
  // high is 70,000c above the close and moves nothing.
  const spike = fold(CORE_50K, {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: 20_000n,
    highBalanceCents: 5_090_000n,
    lowBalanceCents: 4_995_000n,
    fillCount: 4,
  });
  expect(spike.state.highWaterBalanceCents).toBe(5_020_000n);
  expect(spike.state.floorCents).toBe(4_770_000n);

  // And a losing day does not lower it: `hwb' = max(hwb, closing)`.
  const losing = fold(
    CORE_50K,
    {
      tradingDay: day('2026-11-04'),
      openingBalanceCents: 5_020_000n,
      realizedPnlCents: -20_000n,
      lowBalanceCents: 4_990_000n,
    },
    fundedPrior(CORE_50K, {
      balanceCents: 5_020_000n,
      highWaterBalanceCents: 5_020_000n,
      floorCents: 4_770_000n,
      floorOpenCents: 4_770_000n,
    }),
  );
  expect(losing.state.highWaterBalanceCents).toBe(5_020_000n);
  expect(losing.state.floorCents).toBe(4_770_000n);
});

// -----------------------------------------------------------------------------
// R-14  the floor never retreats, and the tripwire is INV-06
// -----------------------------------------------------------------------------
test(reU('R-14'), () => {
  // The tripwire is unreachable through `advanceDay` and reachable through
  // `advanceFloor`, which is the honest way to test it: M01 says "No input can
  // reach this; only a future edit to the two blocks above can", so the test
  // hands it a prior floor that the trailing computation cannot justify.
  //
  // EXACTLY EQUAL SURVIVES. hwb 5,000,000 - 250,000 = 4,750,000, and a prior
  // floor of 4,750,000 is the same number, which is the boundary.
  const flat = advanceFloor({
    priorFloorCents: 4_750_000n,
    priorHighWaterBalanceCents: 5_000_000n,
    priorFloorLocked: false,
    closingBalanceCents: 5_000_000n,
    sizeCents: 5_000_000n,
    drawdown: CORE_50K.funded.drawdown,
  });
  expect(flat.floorCents).toBe(4_750_000n);

  // ONE CENT LOWER THROWS. `EngineInvariantError` and not an `AssertionFailure`:
  // "it is not a data problem (contrast DO-3, where the vendor's arithmetic is
  // what failed)".
  expect(() =>
    advanceFloor({
      priorFloorCents: 4_750_001n,
      priorHighWaterBalanceCents: 5_000_000n,
      priorFloorLocked: false,
      closingBalanceCents: 5_000_000n,
      sizeCents: 5_000_000n,
      drawdown: CORE_50K.funded.drawdown,
    }),
  ).toThrow(EngineInvariantError);
});

// -----------------------------------------------------------------------------
// R-15  the lock, at `closing - size >= floor_lock_at_profit_cents`
// -----------------------------------------------------------------------------
test(reU('R-15'), () => {
  // CV-12 forces the trigger to sit exactly where the trailing floor already is:
  // at_profit 260,000 = drawdown 250,000 + 10,000, and the locked floor is
  // size + 10,000 = 5,010,000. At the trigger the trailing floor would be
  // 5,260,000 - 250,000 = 5,010,000, THE SAME NUMBER, so the floor never jumps.
  const priorAt = fundedPrior(CORE_50K, {
    balanceCents: 5_240_000n,
    highWaterBalanceCents: 5_240_000n,
    floorCents: 4_990_000n,
    floorOpenCents: 4_990_000n,
  });
  const atTrigger = fold(
    CORE_50K,
    {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_240_000n,
      realizedPnlCents: 20_000n,
    },
    priorAt,
  );
  expect(atTrigger.state.floorLocked).toBe(true);
  expect(atTrigger.state.floorCents).toBe(5_010_000n);
  expect(atTrigger.events.map((e) => e.type)).toContain('rule.floor_locked');

  // ONE CENT BELOW THE TRIGGER DOES NOT LOCK. Profit 259,999 against 260,000,
  // and the floor is the trailing one: 5,259,999 - 250,000 = 5,009,999.
  const below = fold(
    CORE_50K,
    {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_240_000n,
      realizedPnlCents: 19_999n,
    },
    priorAt,
  );
  expect(below.state.floorLocked).toBe(false);
  expect(below.state.floorCents).toBe(5_009_999n);
  expect(below.events.map((e) => e.type)).not.toContain('rule.floor_locked');

  // AND THE LOCK IS PERMANENT (INV-07). A later closing high moves neither the
  // high-water balance nor the floor.
  const after = fold(
    CORE_50K,
    {
      tradingDay: day('2026-11-04'),
      openingBalanceCents: 5_260_000n,
      realizedPnlCents: 500_000n,
    },
    atTrigger.state,
  );
  expect(after.state.floorCents).toBe(5_010_000n);
  expect(after.state.highWaterBalanceCents).toBe(atTrigger.state.highWaterBalanceCents);
  expect(after.events.map((e) => e.type)).not.toContain('rule.floor_locked');

  // -----------------------------------------------------------------------------
  // A DAY THAT JUMPS PAST THE TRIGGER, WHICH IS THE CASE THIS TEST DID NOT HAVE
  // -----------------------------------------------------------------------------
  // The two cases above land ON the trigger and one cent below it, which is
  // where CV-12's "the floor never jumps" is true and where M01 calls section
  // 3.4's `max` redundant. R-15's operator is `>=`, so a single day can clear
  // the trigger by any amount, AND EVERY V1 EVAL PASS DOES: the lock triggers at
  // 260,000c of profit and the eval target is 300,000c.
  //
  // Here the account closes 300,000c up. The trail has already put the floor at
  // 5,300,000 - 250,000 = 5,050,000, which is 40,000c ABOVE the locked value of
  // 5,010,000. Section 3.4's `max` keeps 5,050,000; assigning the locked value
  // would move the floor DOWN on the account's best day, which is INV-06.
  const overshoot = fold(
    CORE_50K,
    {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_000_000n,
      realizedPnlCents: 300_000n,
    },
    fundedPrior(CORE_50K),
  );
  expect(overshoot.state.floorLocked).toBe(true);
  expect(overshoot.state.floorCents).toBe(5_050_000n);
  expect(overshoot.state.highWaterBalanceCents).toBe(5_300_000n);

  // AND THE LOCK IS STILL PERMANENT AT THE HIGHER NUMBER. `hwb` is frozen, so
  // the expression returns 5,050,000 every subsequent day and INV-07 holds: the
  // lock is a floor under the floor, not a cap on it.
  const later = fold(
    CORE_50K,
    {
      tradingDay: day('2026-11-04'),
      openingBalanceCents: 5_300_000n,
      realizedPnlCents: 500_000n,
    },
    overshoot.state,
  );
  expect(later.state.floorCents).toBe(5_050_000n);
  expect(later.state.highWaterBalanceCents).toBe(5_300_000n);
});

// -----------------------------------------------------------------------------
// R-16  static drawdown: the floor is `size - drawdown` for life
// -----------------------------------------------------------------------------
test(reU('R-16'), () => {
  const plan = withStaticDrawdown(CORE_50K);

  // A large closing high, which under `trailing_eod` would raise the floor to
  // 5,750,000 - 250,000 = 5,500,000, and under `static` raises nothing.
  const out = fold(plan, {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: 750_000n,
  });
  expect(out.state.floorCents).toBe(4_750_000n);
  expect(out.state.highWaterBalanceCents).toBe(5_000_000n);

  // The same day under the trailing configuration, which is the other side of
  // the comparison and the reason this is a rule rather than a default.
  const trailing = fold(withoutFloorLock(CORE_50K), {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: 750_000n,
  });
  expect(trailing.state.floorCents).toBe(5_500_000n);
});

// -----------------------------------------------------------------------------
// R-18  the breach comparator is the floor AT THE OPEN
// -----------------------------------------------------------------------------
test(reU('R-18'), () => {
  // The day's own profit raises the floor at DO-7, strictly after the breach
  // check at DO-4. So a day that closes 750,000c up, with a low BELOW the floor
  // it opened against, still breaches -- against 4,750,000 and not against the
  // 5,500,000 its own close would produce.
  const plan = withoutFloorLock(CORE_50K);
  const out = fold(plan, {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: 750_000n,
    lowBalanceCents: 4_749_999n,
  });
  expect(out.state.breached).toBe(true);
  expect(out.state.floorOpenCents).toBe(4_750_000n);

  // THE OTHER SIDE: the same low one cent higher survives, and the floor the
  // surviving day is recorded against is still the one it opened with.
  const survived = fold(plan, {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: 750_000n,
    lowBalanceCents: 4_750_000n,
  });
  expect(survived.state.breached).toBe(false);
  expect(survived.state.floorOpenCents).toBe(4_750_000n);
  expect(survived.state.floorCents).toBe(5_500_000n);
});
