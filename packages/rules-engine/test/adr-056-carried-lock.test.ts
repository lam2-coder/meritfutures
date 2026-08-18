// =============================================================================
// packages/rules-engine/test/adr-056-carried-lock.test.ts
// =============================================================================
// ADR-056's CENTRAL CLAIM, EXECUTED. The ADR is `proposed` and asks for exactly
// this before it is signed: "the second-funded-day breach in the table above is
// a DERIVATION FROM THE DO ORDERING, NOT AN EXECUTION ... The signature should
// follow a run, not this paragraph."
//
// THE CLAIM, in the ADR's own words: under the literal reading of `INV-07`,
// where `floorLocked` is CARRIED through the `R-31` funded reset, "every funded
// account breaches on its SECOND FUNDED DAY, on all three v1 plans", because
// `ADR-052` made the lock an ASSIGNMENT and `DO-7` therefore "assigns `floor =
// floor_lock_floor_at_cents` on every day the account is locked".
//
// -----------------------------------------------------------------------------
// THE RESULT, STATED AT THE TOP SO NOBODY HAS TO RUN THE FILE TO FIND IT
// -----------------------------------------------------------------------------
// THE BREACH DOES NOT REPRODUCE. It reproduces on no v1 plan, on no funded day,
// and not for the reason the ADR gives.
//
// `ADR-056`'s PREMISES ARE ALL TRUE and its MECHANISM IS NOT. Every eval pass is
// a lock day; `ADR-014`'s locked floor really does sit 10,000c above the balance
// `R-31` writes; and if `DO-7` re-assigned that floor on a funded day the
// account really would be under water. `DO-7` does not re-assign it.
// `advanceFloor` assigns `floor_lock_floor_at_cents` ONCE, on the day the lock
// ENGAGES, inside a branch guarded by `!floorLocked`; on every later locked day
// it CARRIES `priorFloorCents` untouched. The two readings agree on every
// ordinary account, because an ordinary lock leaves the carried floor equal to
// the assigned one forever. They part company at exactly one place: a state
// whose floor was moved by something other than the lock while `floorLocked`
// stayed true, which is the counterfactual this file builds and the only place
// in the corpus where such a state can arise.
//
// WHAT ACTUALLY HAPPENS UNDER THE CARRIED LOCK is worse to reason about and
// gentler to the trader: the funded floor FREEZES at `size_cents` minus the
// funded drawdown and never moves again. It never trails, the lock can never
// re-engage, and because the shipped floor only ever rises from that same
// starting value, the carried-lock account breaches on NO day the shipped
// account survives. `adr-056-carried-lock.property.test.ts` sweeps that.
//
// ON THE STREAM BELOW IT IS THE SHIPPED ACCOUNT THAT BREACHES ON FUNDED DAY TWO
// AND THE CARRIED-LOCK ACCOUNT THAT SURVIVES. That is the ADR's claim with its
// sign reversed, and it is measured rather than argued, which is the whole point
// of the file.
//
// `ADR-056`'s OTHER ARGUMENT REPRODUCES EXACTLY, and it is the one the ruling
// can still stand on: "a funded lock that can never re-engage ... That is not a
// constrained funded floor. It is the funded floor deleted." The control below
// watches the shipped engine re-engage the funded lock at 5,010,000c on the day
// the balance reaches 5,300,000c, and watches the carried-lock account sit at
// 4,750,000c through the same day.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE IS NOT
// -----------------------------------------------------------------------------
// IT PINS NO RULING. `ADR-056` is `proposed`, the founder's signature has not
// been given, and nothing here asserts that clearing the lock is correct. What
// it asserts is what the SHIPPED FOLD DOES when handed a state the literal
// reading of `INV-07` would produce. Every expectation is therefore about a
// counterfactual input, and none of them constrains the ruling.
//
// IT IS A TEST AND NOT A FIXTURE, DELIBERATELY. `GS-044` and `GS-242` are the
// two fixtures that cross the eval pass and they pin no floor field at all,
// because while both readings were live a fixture crossing the reset could not
// pin `floor_locked` without ratifying a ruling nobody had made. That reasoning
// is still correct and this file honours it: a fixture would be an expectation
// the corpus asserts, and what is owed here is a measurement.
//
// NO ENGINE FILE WAS EDITED TO PRODUCE IT, and the carried-lock state is
// CONSTRUCTED DIRECTLY rather than by changing `DO-8`. `progression.ts` writes
// `floorLocked: false` and `ADR-056` RATIFIES that; editing it to produce the
// counterfactual would measure a different engine.
// =============================================================================

import { expect, test } from 'vitest';

import { advanceDay, initialState } from '../src/day/advance.js';
import { advanceFloor } from '../src/day/floor.js';
import { resolvePlan } from '../src/plan/resolve.js';
import type { Cents, DayOutput, FloorLockedEvent, ResolvedPlan, RuleState } from '../src/types.js';
import {
  ACCOUNT_OPENED_ON,
  CME_WINDOW,
  CORE_50K,
  ENGINE_VERSION,
  MERIT_RAPID_50K,
  day,
  evalPrior,
  mark,
} from './fixtures-in-code.js';
import {
  CORE_50K_SIZE,
  DIRECT_50K_SIZE,
  DIRECT_RULES,
  RAPID_50K_SIZE,
  RAPID_RULES,
  coreRules,
} from './published-plans-in-code.js';

/** One day for one account, through the real fold and nothing else. */
function fold(plan: ResolvedPlan, prior: RuleState, fields: Parameters<typeof mark>[0]): DayOutput {
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
// THE TWO PLANS THAT CROSS `R-31` AT ALL, AND THE EVAL PASS EACH ONE CROSSES IT
// ON
// -----------------------------------------------------------------------------
// Both pass days are lifted from tests that already exist rather than invented
// here: CORE-50K's is `RE-U-026`'s tie (`300,000 >= 300,000`, GS-017) and
// MERIT-RAPID-50K's is `RE-U-027`'s, whose consistency arithmetic is written out
// in that test and lands exactly on `R-29`'s `<=`.

interface PassCase {
  readonly name: string;
  readonly plan: ResolvedPlan;
  readonly prior: RuleState;
  readonly passMark: Parameters<typeof mark>[0];
}

const PASSES: readonly PassCase[] = [
  {
    name: 'CORE-50K',
    plan: CORE_50K,
    prior: evalPrior(CORE_50K),
    passMark: {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_000_000n,
      realizedPnlCents: 300_000n,
    },
  },
  {
    name: 'MERIT-RAPID-50K',
    plan: MERIT_RAPID_50K,
    // `RE-U-027`'s prior verbatim: two traded days worth 210,000c with a
    // 70,000c best day, so today's 90,000c lands the consistency ratio exactly
    // on `R-29`'s `<=` and the pass is not deferred.
    prior: evalPrior(MERIT_RAPID_50K, {
      balanceCents: 5_210_000n,
      tradedDaysCount: 2,
      consistencyBestDayCents: 70_000n,
      consistencyPeriodProfitCents: 210_000n,
    }),
    passMark: {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_210_000n,
      realizedPnlCents: 90_000n,
    },
  },
];

/**
 * THE COUNTERFACTUAL, AND THE ONE FIELD IT MOVES.
 *
 * `R-31`'s effects list is explicit and finite: phase, `balance`, `hwb`,
 * `floor`, the three counter groups and the consistency period start. It DOES
 * NOT NAME `floorLocked`. The literal reading of `INV-07` ("a locked floor never
 * changes again for the LIFE OF THE ACCOUNT") is therefore that the flag is
 * carried, and every other field is exactly what the shipped fold computed.
 *
 * SO THE FLIP RESTORES A VALUE THE ENGINE ITSELF PRODUCED AND THEN OVERWROTE,
 * which is what makes it a counterfactual rather than an invention. `DO-7` set
 * `floorLocked = true` on the pass day, `DO-8` set it back to `false` in the
 * same fold, and the test above this one watches both halves happen.
 */
const withLockCarried = (passed: RuleState): RuleState => ({ ...passed, floorLocked: true });

/** `R-12` and `R-31`'s number, read from the plan. GS-019 pins it at 4,750,000c. */
const fundedResetFloorCents = (plan: ResolvedPlan): Cents =>
  plan.sizeCents - plan.funded.drawdown.drawdownCents;

/** `ADR-014`'s locked floor, read from the plan and never from a literal. */
function lockedFloorCents(plan: ResolvedPlan): Cents {
  const lock = plan.funded.drawdown.lock;
  if (!lock.enabled) throw new Error('the plan has no floor lock');
  return lock.floorAtCents;
}

// -----------------------------------------------------------------------------
// PREMISE 1  every v1 eval pass is also a lock day, so every funded account
//            arrives locked
// -----------------------------------------------------------------------------
test('ADR-056 premise 1: the eval pass day LOCKS at DO-7 and DO-8 clears it in the same fold', () => {
  for (const { name, plan, prior, passMark } of PASSES) {
    const passed = fold(plan, prior, passMark);
    expect(passed.assertions, name).toEqual([]);

    // THE ORDER OF THE EVENTS IS THE ARGUMENT. `rule.floor_locked` is emitted at
    // DO-7 and `phase.passed` at DO-8, so the lock engages BEFORE the reset runs
    // and the reset is what clears it. `ADR-050` and `progression.ts` both state
    // this in prose ("Core EOD locks at 260,000c of profit and its eval target
    // is 300,000c, so an account that passes has ALREADY locked at DO-7 on the
    // pass day itself"); this is the same sentence with a run behind it.
    expect(
      passed.events.map((e) => e.type),
      name,
    ).toEqual(['rule.floor_locked', 'phase.passed', 'day.closed']);

    // The lock engaged at `floor_lock_floor_at_cents`, which is 5,010,000c on
    // both plans (Appendix A.1 and A.2, ADR-014's size + 10,000).
    const locked = passed.events.find((e) => e.type === 'rule.floor_locked') as FloorLockedEvent;
    expect(locked.lockedFloorCents, name).toBe(lockedFloorCents(plan));

    // AND THE SHIPPED FOLD CLEARS IT, which is the behaviour ADR-056 ratifies
    // and the behaviour this file does not touch.
    expect(passed.state.phase, name).toBe('funded');
    expect(passed.state.floorLocked, name).toBe(false);
    expect(passed.state.floorCents, name).toBe(fundedResetFloorCents(plan));
    expect(passed.state.balanceCents, name).toBe(plan.sizeCents);
  }
});

// -----------------------------------------------------------------------------
// PREMISE 2  the locked floor sits 10,000c ABOVE the balance `R-31` writes, on
//            all three v1 plans
// -----------------------------------------------------------------------------
test('ADR-056 premise 2: floor_lock_floor_at_cents is size + 10,000c while R-31 writes exactly size', () => {
  // Resolved from the PUBLISHED rows rather than from `fixtures-in-code`, so the
  // premise is checked against the shape a plan is stored in. Direct is included
  // here and only here: it carries the same locked floor and, as the last test
  // in this file measures, can never reach the transition the premise is about.
  const lineup: ReadonlyArray<readonly [string, ResolvedPlan]> = [
    ['CORE-50K', resolvePlan(coreRules(), CORE_50K_SIZE)],
    ['MERIT-RAPID-50K', resolvePlan(RAPID_RULES, RAPID_50K_SIZE)],
    ['DIRECT-50K', resolvePlan(DIRECT_RULES, DIRECT_50K_SIZE)],
  ];

  for (const [name, plan] of lineup) {
    // ADR-014: X = $100, so the locked floor is `size_cents + 10,000c`.
    expect(lockedFloorCents(plan) - plan.sizeCents, name).toBe(10_000n);

    // SO THE ADR's ARITHMETIC IS RIGHT ABOUT THE NUMBERS. A funded account whose
    // floor were re-assigned to the locked value would stand 10,000c below its
    // own floor at the moment `R-31` set its balance to `size_cents`, and the
    // day's low cannot clear a floor above the day's opening balance.
    expect(lockedFloorCents(plan) > plan.sizeCents, name).toBe(true);

    // And the funded floor the reset actually writes is BELOW the balance by the
    // funded drawdown, which is the funded contract the trader was sold.
    expect(plan.sizeCents - fundedResetFloorCents(plan), name).toBe(
      plan.funded.drawdown.drawdownCents,
    );
  }
});

// -----------------------------------------------------------------------------
// THE MECHANISM, MEASURED. This is the refutation and it is one function call
// -----------------------------------------------------------------------------
test('ADR-056 mechanism: DO-7 does NOT re-assign the locked floor on a locked day', () => {
  const drawdown = CORE_50K.funded.drawdown;

  // THE COUNTERFACTUAL SHAPE: locked, with a floor `R-31` moved to 4,750,000c.
  // ADR-056 predicts 5,010,000c out of this call ("DO-7 assigns floor =
  // floor_lock_floor_at_cents on every day the account is locked").
  const carried = advanceFloor({
    priorFloorCents: 4_750_000n,
    priorHighWaterBalanceCents: 5_000_000n,
    priorFloorLocked: true,
    closingBalanceCents: 5_100_000n,
    sizeCents: 5_000_000n,
    drawdown,
  });

  // IT RETURNS THE CARRIED FLOOR. `advanceFloor`'s `R-15` block is guarded by
  // `!floorLocked`, so on an already-locked day the assignment is not reached
  // and `floorCents` is `input.priorFloorCents` untouched.
  expect(carried.floorCents).toBe(4_750_000n);
  expect(carried.floorCents).not.toBe(lockedFloorCents(CORE_50K));

  // `hwb` IS FROZEN AND THE LOCK NEVER RE-ENGAGES, which is the half of ADR-056
  // that does reproduce: `R-13`'s guard is the same `!floorLocked`.
  expect(carried.highWaterBalanceCents).toBe(5_000_000n);
  expect(carried.floorLocked).toBe(true);
  expect(carried.lockEngagedAtProfitCents).toBeNull();

  // WHY THE TWO READINGS AGREE EVERYWHERE ELSE, which is why this went unnoticed
  // and why it is not a defect in `advanceFloor`. On an ORDINARY locked account
  // the carried floor IS the assigned one, because nothing between the lock day
  // and today ever moved it, so "carry the prior floor" and "assign
  // floor_lock_floor_at_cents" return the same number on every day of every
  // account that is not crossing a funded reset.
  const ordinary = advanceFloor({
    priorFloorCents: 5_010_000n,
    priorHighWaterBalanceCents: 5_260_000n,
    priorFloorLocked: true,
    closingBalanceCents: 5_400_000n,
    sizeCents: 5_000_000n,
    drawdown,
  });
  expect(ordinary.floorCents).toBe(lockedFloorCents(CORE_50K));
  expect(ordinary.highWaterBalanceCents).toBe(5_260_000n);
});

// -----------------------------------------------------------------------------
// THE WALK. ADR-056's table, folded
// -----------------------------------------------------------------------------
test('ADR-056 executed: the lock carried across R-31 and folded forward does NOT breach', () => {
  for (const { name, plan, prior, passMark } of PASSES) {
    const passed = fold(plan, prior, passMark);
    const carried = withLockCarried(passed.state);
    const resetFloor = fundedResetFloorCents(plan); // 4,750,000c on both plans

    // -------------------------------------------------------------------------
    // FUNDED DAY ONE. ADR-056: "Floor at open is 4,750,000, so DO-4 finds no
    // breach. DO-7 then assigns floor_lock_floor_at_cents again -> 5,010,000."
    //
    // The first sentence reproduces. The second does not.
    // -------------------------------------------------------------------------
    const f1 = fold(plan, carried, {
      tradingDay: day('2026-11-04'),
      openingBalanceCents: 5_000_000n, // INV-20: the first funded mark opens at size
      realizedPnlCents: 100_000n, //     closing 5,100,000
    });
    expect(f1.assertions, name).toEqual([]);
    expect(f1.state.floorOpenCents, name).toBe(resetFloor);
    expect(f1.state.breached, name).toBe(false);

    // THE MEASUREMENT ADR-056 ASKS FOR, ON THE DAY IT ASKS FOR IT.
    expect(f1.state.floorCents, name).toBe(resetFloor);
    expect(f1.state.floorCents, name).not.toBe(lockedFloorCents(plan));

    // The lock is still carried and did not re-engage: a locked day emits no
    // `rule.floor_locked`, because the event is set only where the assignment is.
    expect(f1.state.floorLocked, name).toBe(true);
    expect(
      f1.events.map((e) => e.type),
      name,
    ).toEqual(['day.closed']);

    // `hwb` IS FROZEN BELOW THE BALANCE, and no layer refuses the row. The fold
    // does not (it is `R-13`'s guard working as written), and neither does the
    // schema: `0037` replaced `0015`'s unconditional bound with
    // `floor_locked OR high_water_balance_cents >= balance_cents`, so a locked
    // row is EXEMPT. The carried lock is therefore storable and silent, which is
    // the property that makes it dangerous rather than self-announcing.
    expect(f1.state.highWaterBalanceCents, name).toBe(5_000_000n);
    expect(f1.state.highWaterBalanceCents < f1.state.balanceCents, name).toBe(true);

    // -------------------------------------------------------------------------
    // FUNDED DAY TWO. THE DAY THE ADR SAYS EVERY FUNDED ACCOUNT BREACHES ON.
    //
    // The day's low is 4,800,000c, chosen to sit BETWEEN the two floors so it
    // discriminates them instead of surviving both:
    //
    //   under ADR-056's predicted floor  4,800,000 <  5,010,000  BREACH,
    //                                    shortfall 210,000c
    //   under the floor the fold carries 4,800,000 >= 4,750,000  survives
    // -------------------------------------------------------------------------
    const f2 = fold(plan, f1.state, {
      tradingDay: day('2026-11-05'),
      openingBalanceCents: 5_100_000n,
      realizedPnlCents: 0n,
      lowBalanceCents: 4_800_000n,
    });
    expect(f2.assertions, name).toEqual([]);
    expect(f2.state.floorOpenCents, name).toBe(resetFloor);
    expect(f2.state.breached, name).toBe(false);
    expect(f2.state.breachKind, name).toBeNull();
    expect(f2.state.phase, name).toBe('funded');
    expect(
      f2.events.map((e) => e.type),
      name,
    ).toEqual(['day.closed']);

    // -------------------------------------------------------------------------
    // FUNDED DAY THREE, and the half of ADR-056 that DOES reproduce. The account
    // closes at 5,300,000c, which is 300,000c of profit against a funded lock
    // trigger of 260,000c. The shipped account re-locks here (the control below
    // watches it). This one cannot: `R-15` is guarded by `!floorLocked`, so the
    // floor sits at the funded reset value forever and the funded floor never
    // trails a cent of the profit.
    // -------------------------------------------------------------------------
    const f3 = fold(plan, f2.state, {
      tradingDay: day('2026-11-06'),
      openingBalanceCents: 5_100_000n,
      realizedPnlCents: 200_000n,
    });
    expect(f3.assertions, name).toEqual([]);
    expect(f3.state.balanceCents, name).toBe(5_300_000n);
    expect(f3.state.floorCents, name).toBe(resetFloor);
    expect(f3.state.highWaterBalanceCents, name).toBe(5_000_000n);
    expect(
      f3.events.map((e) => e.type),
      name,
    ).toEqual(['day.closed']);
    expect(f3.state.breached, name).toBe(false);
  }
});

// -----------------------------------------------------------------------------
// THE CONTROL. The same three days with the lock CLEARED, which is what the
// engine ships and what ADR-056 ratifies
// -----------------------------------------------------------------------------
test('the shipped fold on the same days: the floor trails, and on day two it BREACHES', () => {
  for (const { name, plan, prior, passMark } of PASSES) {
    const passed = fold(plan, prior, passMark);

    // Day one, identical mark. The floor TRAILS to 4,850,000c = the new
    // high-water balance 5,100,000c minus the 250,000c funded drawdown (R-13).
    const c1 = fold(plan, passed.state, {
      tradingDay: day('2026-11-04'),
      openingBalanceCents: 5_000_000n,
      realizedPnlCents: 100_000n,
    });
    expect(c1.assertions, name).toEqual([]);
    expect(c1.state.floorCents, name).toBe(4_850_000n);
    expect(c1.state.highWaterBalanceCents, name).toBe(5_100_000n);
    expect(c1.state.floorLocked, name).toBe(false);

    // DAY TWO, IDENTICAL MARK, AND THIS IS THE SENTENCE WORTH THE FILE. The low
    // of 4,800,000c is below the trailed floor of 4,850,000c, so the SHIPPED
    // account breaches on funded day two on the very stream where the
    // carried-lock account survives.
    //
    //   R-21: 4,800,000 < 4,850,000, strict, shortfall 50,000c
    //
    // ADR-056 says the carried lock breaches every funded account on its second
    // funded day. Measured, the carried lock is STRICTLY MORE PERMISSIVE than
    // the engine it was supposed to be more dangerous than, because its floor is
    // frozen at the lowest value the funded phase ever has.
    const c2 = fold(plan, c1.state, {
      tradingDay: day('2026-11-05'),
      openingBalanceCents: 5_100_000n,
      realizedPnlCents: 0n,
      lowBalanceCents: 4_800_000n,
    });
    expect(c2.assertions, name).toEqual([]);
    expect(c2.state.floorOpenCents, name).toBe(4_850_000n);
    expect(c2.state.breached, name).toBe(true);
    expect(c2.state.breachKind, name).toBe('trailing_eod_floor');
    expect(c2.state.phase, name).toBe('closed');

    // AND THE FUNDED LOCK RE-ENGAGES, which is the thing the carried lock
    // deletes. Same day two without the excursion, then a day closing at
    // 5,300,000c: profit 300,000 >= the 260,000c trigger, so `R-15` fires and
    // the funded floor becomes 5,010,000c.
    const quiet = fold(plan, c1.state, {
      tradingDay: day('2026-11-05'),
      openingBalanceCents: 5_100_000n,
      realizedPnlCents: 0n,
      lowBalanceCents: 5_000_000n,
    });
    const c3 = fold(plan, quiet.state, {
      tradingDay: day('2026-11-06'),
      openingBalanceCents: 5_100_000n,
      realizedPnlCents: 200_000n,
    });
    expect(c3.assertions, name).toEqual([]);
    expect(
      c3.events.map((e) => e.type),
      name,
    ).toEqual(['rule.floor_locked', 'day.closed']);
    expect(c3.state.floorCents, name).toBe(lockedFloorCents(plan));
    expect(c3.state.floorLocked, name).toBe(true);
  }
});

// -----------------------------------------------------------------------------
// "ALL THREE V1 PLANS" IS NARROWER THAN THAT, AND THE REASON IS STRUCTURAL
// -----------------------------------------------------------------------------
test('DIRECT-50K never reaches the R-31 reset, so the counterfactual is unreachable on it', () => {
  const direct = resolvePlan(DIRECT_RULES, DIRECT_50K_SIZE);

  // Appendix A.3: "Eval phase: disabled". `resolvePlan` therefore produces no
  // eval rules at all, and `profit_target_cents` is null on the size row because
  // there is no evaluation to have a target.
  expect(direct.eval).toBeNull();
  expect(DIRECT_50K_SIZE.profit_target_cents).toBeNull();

  // A Direct account OPENS funded (`initialState`: "phase `eval` when the plan
  // has an evaluation phase and `funded` when it does not"), with the funded
  // floor `R-12` writes: 5,000,000 - 200,000 = 4,800,000c at 400bp (A.3).
  const opened = initialState(direct, day('2026-11-02'), ENGINE_VERSION);
  expect(opened.phase).toBe('funded');
  expect(opened.floorCents).toBe(4_800_000n);

  // SO `R-31` NEVER RUNS ON IT. `DO-8`'s eval branch is entered only when the
  // state's phase is `eval`, and a Direct state claiming that phase is refused
  // rather than folded against funded rules. The refusal is the executable form
  // of "this plan has no funded reset to carry a lock across".
  const impossible = fold(
    direct,
    { ...opened, phase: 'eval', tradedDaysCount: 1 },
    {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_000_000n,
      realizedPnlCents: 300_000n,
    },
  );
  expect(impossible.assertions.map((a) => a.kind)).toEqual(['eval_phase_without_eval_rules']);
  expect(impossible.events).toEqual([]);

  // WHAT THIS COSTS ADR-056 IS ONE PHRASE AND NOT THE RULING. The ADR's
  // consequence for Direct is not that the breach fails to reproduce; it is that
  // there is no funded reset on the plan, so `INV-07` versus `R-31` never arises
  // there at all. Two v1 plans cross the transition, not three.
});
