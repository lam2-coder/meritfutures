// =============================================================================
// packages/rules-engine/src/day/floor.ts
// =============================================================================
// GROUP C. The floor, in one expression (M01 section 3.4, ADR-014):
//
//   floor(d) = max( hwb(d) - drawdown_cents ,
//                   floorLocked ? floor_lock_floor_at_cents : size_cents - drawdown_cents )
//
// "A reader who is trying to break the engine should be able to see in one line
// that NO TERM IN THE FLOOR CAN EVER GO DOWN. A settlement appears nowhere in
// it, which is the entire content of the OQ-5 ruling."
//
// THE ORDER IS THE RULE. DO-7 is "trail the floor, THEN evaluate the lock", and
// M01 says "Order matters: trailing then locking, never the reverse." Both
// steps are guarded by `!floorLocked`, which is what freezes the high-water
// balance at the lock and makes the expression above resolve to the locked
// value forever after (R-15, INV-07).
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
 * DO-7 whole: R-13 or R-16, then R-15, then R-14's tripwire.
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
 * floor_lock_at_profit_cents`, `>=`. Effect: the floor becomes
 * `floor_lock_floor_at_cents`, `floorLocked` is true, and `hwb` is frozen, ALL
 * PERMANENTLY. CV-12 forces the trigger to sit exactly where the trailing floor
 * already is, so the floor never jumps.
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
  const trailedFloorCents = floorCents;
  const profitCents = input.closingBalanceCents - input.sizeCents;
  if (!floorLocked && drawdown.lock.enabled && profitCents >= drawdown.lock.atProfitCents) {
    // THE `max` IS SECTION 3.4's BINDING FORMULATION AND IT IS NOT REDUNDANT.
    //
    //   floor(d) = max( hwb(d) - drawdown_cents,
    //                   floorLocked ? floor_lock_floor_at_cents
    //                               : size_cents - drawdown_cents )
    //
    // M01 calls the `max` "redundant given the update order", on the reasoning
    // that "the lock freezes `hwb` EXACTLY WHERE THE TRAILING FLOOR ALREADY
    // EQUALS THE LOCKED VALUE, by CV-12". THAT HOLDS ONLY WHEN THE BALANCE LANDS
    // ON THE TRIGGER AND NOT WHEN IT JUMPS PAST IT, which R-15's own `>=` allows
    // and which every eval pass on the v1 lineup does: Core EOD locks at
    // 260,000c of profit and its eval target is 300,000c, so the pass day clears
    // the trigger by 40,000c or more. At a 5,300,000c close the trail has
    // already put the floor at 5,050,000c and the locked value is 5,010,000c.
    //
    // M01 SECTION 3.6's PSEUDOCODE ASSIGNS RATHER THAN TAKING THE max, AND THAT
    // IS THE HALF THIS FILE DOES NOT FOLLOW. The assignment drops the floor by
    // 40,000c on the account's best day, which is INV-06 ("no exception, no
    // phase qualifier") and RE-P-01 violated on a reachable input. Section 3.4
    // is the founder's binding formulation and says so; section 3.5's R-14 row
    // and INV-06 agree with it; only the sketch disagrees. Same shape as R-22,
    // where the table and the pseudocode disagreed and the table won.
    //
    // ONCE LOCKED, `hwb` IS FROZEN, so this expression returns the same number
    // every subsequent day and INV-07 ("a locked floor never changes again")
    // still holds. The lock is a floor under the floor, not a cap on it.
    floorCents =
      trailedFloorCents > drawdown.lock.floorAtCents
        ? trailedFloorCents
        : drawdown.lock.floorAtCents;
    floorLocked = true;
    lockEngagedAtProfitCents = profitCents;
  }
  neverRetreats('R-15', trailedFloorCents, floorCents);

  return { floorCents, highWaterBalanceCents, floorLocked, lockEngagedAtProfitCents };
}

/**
 * R-14's tripwire, INV-06, CHECKED AFTER EACH SUB-STEP RATHER THAN ONCE AT THE
 * END, and the difference is a defect this file shipped with.
 *
 * The single end-of-function check compared the final floor against the floor at
 * the START OF THE DAY, so a step that lowered the floor below where the
 * PRECEDING step had just raised it was invisible: the trail lifted 4,750,000 to
 * 5,050,000, the lock dropped it to 5,010,000, and 5,010,000 is still above
 * 4,750,000, so nothing fired. A monotonicity check that only samples the
 * endpoints cannot see a retreat inside the interval.
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
