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

  // R-15, strictly after the trail.
  const profitCents = input.closingBalanceCents - input.sizeCents;
  if (!floorLocked && drawdown.lock.enabled && profitCents >= drawdown.lock.atProfitCents) {
    floorCents = drawdown.lock.floorAtCents;
    floorLocked = true;
    lockEngagedAtProfitCents = profitCents;
  }

  // R-14's tripwire, INV-06. NO INPUT CAN REACH THIS; only a future edit to the
  // two blocks above can. It throws rather than returning an `AssertionFailure`
  // because it is not a data problem: at DO-3 the vendor's arithmetic is what
  // failed, and here the engine's own would have.
  if (floorCents < input.priorFloorCents) {
    throw new EngineInvariantError(
      'INV-06',
      `the floor moved down, from ${String(input.priorFloorCents)} to ${String(floorCents)}`,
    );
  }

  return { floorCents, highWaterBalanceCents, floorLocked, lockEngagedAtProfitCents };
}
