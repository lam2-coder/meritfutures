// =============================================================================
// packages/rules-engine/src/day/floor.ts
// =============================================================================
// GROUP C. The floor, in one expression (M01 section 3.4 as amended by
// ADR-052):
//
//   floor(d) = floorLocked ? floor_lock_floor_at_cents
//                          : max( hwb(d) - drawdown_cents ,
//                                 size_cents - drawdown_cents )
//
// THE LOCK IS A BRANCH, NOT A TERM. ADR-052 (accepted 2026-08-17) reversed the
// reading this file shipped with, and the reversal is the whole of what changed
// here. Under the `max` a day that JUMPS PAST the lock trigger keeps its trailed
// floor, so the lock never binds on that account again and `CV-11`'s derivation
// of `INV-21` -- which reads the post-lock floor as EQUAL to
// floor_lock_floor_at_cents -- becomes false. `CV-11` is a publish-time check
// and the `max` makes the post-lock floor depend on the lock-day close, so no
// validation can rescue it. ADR-052 section 2 carries the counterexample: a
// funded account one cent below its own floor after three settled payouts, with
// no losing day anywhere.
//
// A settlement appears nowhere in this expression, which is the entire content
// of the OQ-5 ruling and is untouched by ADR-052.
//
// WHAT "THE FLOOR NEVER GOES DOWN" MEANS, PRECISELY, because this file once
// asserted a stronger version of it and changed the rule to satisfy it. INV-06
// is a property of the STORED DAY-OVER-DAY SERIES, `rule_states.floor_cents`,
// one row per (account_id, trading_day) under 0015's unique index. It is not a
// property of the intermediate values inside this function. Pre-lock the trail
// keeps `hwb - drawdown_cents` strictly below floor_lock_floor_at_cents by
// CV-12, so the lock day RAISES the day's floor and the series is monotone
// (ADR-052 section 3).
//
// THE ORDER IS THE RULE. DO-7 is "trail the floor, THEN evaluate the lock", and
// M01 says "Order matters: trailing then locking, never the reverse." Both
// steps are guarded by `!floorLocked`, which freezes the high-water balance at
// the lock; the BRANCH above is what makes the floor resolve to the locked value
// forever after (R-15, INV-07, and ADR-052's amendment of ADR-014's sentence).
//
// AND THE FLOOR IS NOT THE BREACH COMPARATOR. R-18: the day is judged against
// the floor AT THE OPEN, which is the previous day's `floorCents`, captured at
// DO-4 strictly before anything here runs. Reversing those two steps would let a
// day's own profit raise the floor it is then judged against, which is the
// hardest kind of bug to see in a diff and the cheapest kind to pin
// (GS-011, GS-012).
// =============================================================================

import { EngineInvariantError } from '../errors.js';
import type { Cents, DrawdownRules } from '../types.js';

/**
 * R-12. `floor = size_cents - drawdown_cents`, at account open and again at the
 * funded reset with the FUNDED drawdown.
 *
 * GS-008 pins it: 4,750,000 = 5,000,000 - 250,000 on CORE-50K, and it exists
 * before any mark does.
 */
export function initialFloorCents(sizeCents: Cents, drawdownCents: Cents): Cents {
  return sizeCents - drawdownCents;
}

/** What DO-7 produces: the floor carried forward, the frozen-or-not high-water balance. */
export interface FloorOutcome {
  readonly floorCents: Cents;
  readonly highWaterBalanceCents: Cents;
  readonly floorLocked: boolean;
  /** Set on the day the lock engages, and never again (R-15 is permanent). */
  readonly lockEngagedAtProfitCents: Cents | null;
}

export interface FloorInput {
  readonly priorFloorCents: Cents;
  readonly priorHighWaterBalanceCents: Cents;
  readonly priorFloorLocked: boolean;
  readonly closingBalanceCents: Cents;
  readonly sizeCents: Cents;
  readonly drawdown: DrawdownRules;
}

/**
 * DO-7 whole: R-13 or R-16, then R-15, then R-14's tripwire on the trail.
 *
 * R-13, trailing EOD: `hwb' = max(hwb, closing_balance_cents)` and `floor' =
 * hwb' - drawdown_cents`. THE CLOSING BALANCE ONLY. The intraday high never
 * raises it, which is GS-011's whole subject.
 *
 * R-16, static: `floor = size_cents - drawdown_cents` for the life of the
 * account, so this function returns the prior floor untouched and the high-water
 * balance is not consulted at all.
 *
 * R-15, the lock: trigger `closing_balance_cents - size_cents >=
 * floor_lock_at_profit_cents`, `>=`. Effect: the floor is ASSIGNED
 * `floor_lock_floor_at_cents`, `floorLocked` is true, and `hwb` is frozen, ALL
 * PERMANENTLY (ADR-052).
 */
export function advanceFloor(input: FloorInput): FloorOutcome {
  const { drawdown } = input;

  let floorCents = input.priorFloorCents;
  let highWaterBalanceCents = input.priorHighWaterBalanceCents;
  let floorLocked = input.priorFloorLocked;
  let lockEngagedAtProfitCents: Cents | null = null;

  // R-13. Guarded by `!floorLocked`, which is what freezes `hwb` at the lock.
  if (!floorLocked && drawdown.type === 'trailing_eod') {
    highWaterBalanceCents =
      input.closingBalanceCents > highWaterBalanceCents
        ? input.closingBalanceCents
        : highWaterBalanceCents;
    floorCents = highWaterBalanceCents - drawdown.drawdownCents;
  }
  neverRetreats('R-13', input.priorFloorCents, floorCents);

  // R-15, strictly after the trail.
  const profitCents = input.closingBalanceCents - input.sizeCents;
  if (!floorLocked && drawdown.lock.enabled && profitCents >= drawdown.lock.atProfitCents) {
    // THE LOCK ASSIGNS. IT DOES NOT TAKE A max. ADR-052, accepted 2026-08-17.
    //
    // R-15's Effect column is an assignment in its own words: "floor =
    // floor_lock_floor_at_cents, floorLocked = true, hwb frozen, all
    // permanently." M01 section 3.5 makes the operator column the contract --
    // "it is what the engine executes, what `copy_blocks` publishes, and what
    // the fixture asserts. All three or none."
    //
    // WHY THE max LOSES, AND IT IS NOT A PREFERENCE. CV-11 derives INV-21 from
    // the words "post-lock it EQUALS it". Under the max the post-lock floor is
    // the lock-day close minus drawdown_cents, which exceeds
    // floor_lock_floor_at_cents by however far the close overshot the trigger,
    // so CV-11's premise is false and INV-21 stops following from it. CV-11 is
    // a PUBLISH-TIME check and the overshoot is a RUNTIME quantity, so no
    // validation can bound it. That is the argument that decides this, because
    // it is the one no re-reading repairs.
    //
    // AND THE TWO RE-READINGS THAT WOULD HAVE SAVED THE max ARE BOTH REFUTED BY
    // THE SCHEMA. Freezing `hwb` at the trigger, or before the lock day's own
    // update, would make `hwb - drawdown_cents` land exactly on the locked value
    // and every sentence in the corpus would be true at once. Both store a `hwb`
    // BELOW that day's balance_cents, and 0015_rule_states.sql:208's
    // rule_states_high_water_bounds_balance rejected such a row when ADR-052 was
    // written. `hwb` must reach the lock-day close, so the overshoot is real.
    //
    // ONCE LOCKED, the R-13 guard above freezes `hwb` and this branch is not
    // re-entered, so the floor returned is the same number every subsequent day
    // and INV-07 holds.
    floorCents = drawdown.lock.floorAtCents;
    floorLocked = true;
    lockEngagedAtProfitCents = profitCents;
  }

  return { floorCents, highWaterBalanceCents, floorLocked, lockEngagedAtProfitCents };
}

/**
 * R-14's tripwire, INV-06, on the TRAIL.
 *
 * INV-06 is a property of the stored day-over-day floor series:
 * `rule_states.floor_cents`, one row per (account_id, trading_day) under 0015's
 * unique index, and its three enforcement citations (RE-P-01, GS-010, GS-081)
 * are all day-level. THIS CHECK SAMPLES THE TRAIL, which can only raise the
 * floor, so it holds at the granularity INV-06 is stated at.
 *
 * THERE IS NO SECOND CALL AFTER THE LOCK, AND ITS ABSENCE IS THE RULING. Session
 * 45 added one, comparing the post-lock floor against the trailed floor of the
 * same day. That asserts monotonicity BETWEEN SUB-STEPS, which is stronger than
 * anything M01 states, and it is what forced the `max`: the engine changed the
 * rule to satisfy the test. ADR-052 removed the test rather than the rule, and
 * deliberately ruled no replacement assertion into existence. Day-level coverage
 * rests on RE-P-01 and GS-024.
 *
 * It throws rather than returning an `AssertionFailure` because it is not a data
 * problem: at DO-3 the vendor's arithmetic is what failed, and here the engine's
 * own would have.
 */
function neverRetreats(step: string, before: Cents, after: Cents): void {
  if (after < before) {
    throw new EngineInvariantError(
      'INV-06',
      `${step} moved the floor down, from ${String(before)} to ${String(after)}`,
    );
  }
}
