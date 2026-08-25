// =============================================================================
// GROUP C: THE FLOOR. RE-U-012 to RE-U-020, and the group is complete.
// =============================================================================
// Every expectation here is arithmetic stated in a document, and the arithmetic
// is written out beside it in integer cents so a reader checks the number
// instead of trusting it (P2 section 2's second traceability tier).
//
// R-20 ASSERTS AN ABSENCE AND IS NOT DECLARED: its setpoint is pushed by M02 and
// the engine performs no I/O, so what it owes is the number, and
// `day.closed.floorCents` carrying the state's own floor is the assertion.
// R-17 WAS BESIDE IT UNTIL `validatePlan` LANDED and is now declared: CV-01 is
// inside this package by M01 section 1.3's layout, so "rejected at publish"
// was never somebody else's job. R-19 is in `settle.ts`'s suite rather than
// here, because settlement is where its absence is discharged.
// =============================================================================

import { expect, test } from 'vitest';

import { advanceDay, initialState } from '../src/day/advance.ts';
import { resolvePlan } from '../src/plan/resolve.ts';
import { validatePlan } from '../src/plan/validate.ts';
import { advanceFloor, initialFloorCents } from '../src/day/floor.ts';
import { EngineInvariantError } from '../src/errors.ts';
import type { DayOutput, DrawdownType, ResolvedPlan, RuleState } from '../src/types.ts';
import {
  ACCOUNT_OPENED_ON,
  CME_WINDOW,
  CORE_50K,
  ENGINE_VERSION,
  day,
  fundedPrior,
  mark,
  withStaticDrawdown,
  withoutFloorLock,
} from './fixtures-in-code.ts';
import { CORE_50K_SIZE, CORE_FUNDED, coreRules } from './published-plans-in-code.ts';
import { reU } from './rule-coverage.ts';

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
    openedOn: ACCOUNT_OPENED_ON,
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
  // where CV-12 makes the assignment and the `max` agree to the cent. A BOUNDARY
  // PAIR IS NOT COVERAGE OF AN OPERATOR WHEN BOTH SIDES SIT INSIDE THE SAME
  // DEGENERATE CASE. R-15's operator is `>=`, so a single day can clear the
  // trigger by any amount, AND EVERY V1 EVAL PASS DOES: the lock triggers at
  // 260,000c of profit and the eval target is 300,000c.
  //
  // Here the account closes 300,000c up. The trail has already put the floor at
  // 5,300,000 - 250,000 = 5,050,000, which is 40,000c above the locked value.
  // THE LOCK ASSIGNS 5,010,000 (ADR-052, accepted 2026-08-17). The floor moving
  // down within the day is not INV-06: INV-06 is a property of the stored
  // day-over-day series, and this day's stored floor rises from the prior day's
  // 4,750,000. What the `max` cost instead was CV-11's derivation of INV-21,
  // whose premise is that the post-lock floor EQUALS floor_lock_floor_at_cents.
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
  expect(overshoot.state.floorCents).toBe(5_010_000n);
  expect(overshoot.state.highWaterBalanceCents).toBe(5_300_000n);

  // AND THE LOCK IS PERMANENT AT THE LOCKED VALUE. `hwb` is frozen at the
  // lock-day close, which is what 0015's high-water bound requires and what
  // makes the overshoot real rather than an artefact; the R-13 guard then keeps
  // the lock branch from being re-entered, so the floor returns 5,010,000 every
  // subsequent day and INV-07 holds.
  const later = fold(
    CORE_50K,
    {
      tradingDay: day('2026-11-04'),
      openingBalanceCents: 5_300_000n,
      realizedPnlCents: 500_000n,
    },
    overshoot.state,
  );
  expect(later.state.floorCents).toBe(5_010_000n);
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

// -----------------------------------------------------------------------------
// R-17  intraday trailing is config-supported and unimplemented
// -----------------------------------------------------------------------------
test(reU('R-17'), () => {
  // "CONFIG-SUPPORTED AND UNIMPLEMENTED. Rejected at publish by CV-01." THREE
  // layers hold that and all three are in this package. CV-01 rejects the
  // publish, `resolvePlan` refuses rather than narrowing, and `DrawdownType`
  // makes the resolved config unrepresentable. The third is the strongest and
  // the first is the one R-17's own row names, which is why the rule is declared
  // only now: `RE-C-01` and `plan-resolve.test.ts` carry the two runtime halves
  // and the compile-time half stays here.
  //
  // BOTH SIDES OF THE UNION, AND THE THIRD MEMBER THAT IS NOT ONE. `DrawdownType`
  // is `'trailing_eod' | 'static'`, so an `intraday_trailing` plan cannot be
  // constructed here at all: the line below is a COMPILE error, asserted by
  // `@ts-expect-error`, which fails the typecheck if the union ever widens.
  const trailing: DrawdownType = 'trailing_eod';
  const staticType: DrawdownType = 'static';
  // @ts-expect-error R-17: `intraday_trailing` is not a member of `DrawdownType`
  const intraday: DrawdownType = 'intraday_trailing';
  expect([trailing, staticType]).toEqual(['trailing_eod', 'static']);
  expect(intraday).toBe('intraday_trailing');

  // AND THE TWO RUNTIME HALVES, because a compile-time assertion cannot see a
  // plan arriving from the database. CV-01 refuses the publish and `resolvePlan`
  // refuses the config, and both sides of the membership test are asserted: the
  // two admitted members pass and the third does not.
  const admitted = coreRules();
  expect(validatePlan(admitted, [CORE_50K_SIZE]).errors).toEqual([]);
  expect(() => resolvePlan(admitted, CORE_50K_SIZE)).not.toThrow();

  const refused = coreRules({
    funded: { drawdown: { ...CORE_FUNDED.drawdown, type: 'intraday_trailing' } },
  });
  expect(validatePlan(refused, [CORE_50K_SIZE]).errors.map((e) => e.id)).toContain('CV-01');
  expect(() => resolvePlan(refused, CORE_50K_SIZE)).toThrow(/CV-01/);

  // AND THE FLOOR IS COMPUTED FROM THE CLOSE ON EVERY BRANCH THAT EXISTS, which
  // is the behavioural half: there is no code path that raises a floor from an
  // INTRADAY number. R-13's own row says the same thing from the other side
  // ("the intraday high never raises it") and RE-U-013 asserts it for
  // `trailing_eod`; here it is asserted across the whole union, so a third
  // member added without a rule would have no branch to arrive in.
  const high = 5_900_000n;
  for (const plan of [withoutFloorLock(CORE_50K), withStaticDrawdown(CORE_50K)]) {
    const out = fold(plan, {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_000_000n,
      realizedPnlCents: 100_000n,
      highBalanceCents: high,
    });
    expect(out.state.highWaterBalanceCents).not.toBe(high);
    expect(out.state.floorCents).toBeLessThan(high - CORE_50K.funded.drawdown.drawdownCents);
  }
});

// -----------------------------------------------------------------------------
// R-20  the setpoint equals the current floor, and the engine never pushes it
// -----------------------------------------------------------------------------
test(reU('R-20'), () => {
  // "THE AUTO-LIQUIDATION SETPOINT PUSHED TO THE PLATFORM EQUALS THE CURRENT
  // FLOOR. Re-pushed whenever the floor moves." The push is M02's (`DEP-M2-03`)
  // and the engine performs no I/O, so what this package owes is the SOURCE: a
  // number a pusher can read that is the floor as of the close, on every day.
  //
  // `day.closed.floorCents` IS THAT NUMBER AND IT IS THE STATE'S OWN, asserted as
  // an equality rather than a value so it cannot drift into a second derivation.
  const plan = withoutFloorLock(CORE_50K);
  const climbed = fold(plan, {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: 750_000n,
  });
  const closed = climbed.events.find((e) => e.type === 'day.closed');
  expect(closed).toBeDefined();
  expect(closed).toMatchObject({
    floorCents: climbed.state.floorCents,
    floorOpenCents: climbed.state.floorOpenCents,
  });
  // 5,750,000 - 250,000. The floor MOVED today, so this is a day the setpoint is
  // re-pushed on, and the event carrying it is the trigger.
  expect(climbed.state.floorCents).toBe(5_500_000n);
  expect(climbed.state.floorOpenCents).toBe(4_750_000n);

  // THE OTHER SIDE: A DAY THE FLOOR DID NOT MOVE STILL CARRIES IT. R-20's "re-
  // pushed whenever the floor moves" is a statement about when a push is
  // REQUIRED, not about when the number is available, and an event that omitted
  // the floor on quiet days would make the consumer track the last one it saw.
  const flat = fold(plan, {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: -10_000n,
  });
  const flatClosed = flat.events.find((e) => e.type === 'day.closed');
  expect(flatClosed).toMatchObject({ floorCents: 4_750_000n, floorOpenCents: 4_750_000n });
  expect(flat.state.floorCents).toBe(flat.state.floorOpenCents);

  // AND THE HAZARD IS NAMED HERE RATHER THAN RESOLVED HERE, because it is not
  // this package's to resolve. `DEP-M2-03` justifies deriving the push from a
  // floor-change EVENT on the ground that "since ADR-014 the floor only moves
  // up, so drift is always permissive". `rule.floor_locked` carries a floor that
  // is NOT the day's final floor on the one day the two differ, which RE-U-031
  // pins from the progression side. A pusher reading the day's FINAL state, which
  // is what `day.closed` carries and what this test asserts, is correct on every
  // day including that one; a pusher reading a lock payload is not. R-20 says
  // "equals the CURRENT floor", and the current floor is the state's.
  expect(climbed.events.filter((e) => e.type === 'rule.floor_locked')).toEqual([]);
});
