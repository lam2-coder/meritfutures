// =============================================================================
// packages/rules-engine/src/day/consistency.ts
// =============================================================================
// R-29 AND R-30, IN ONE PLACE, AND M01 SECTION 3.6 SAYS WHY IN ITS OWN COMMENT:
// "called by both phases, so the two variants can never drift apart". R-28 is
// the eval variant and R-36 is the funded one; they differ in WHEN the verdict
// is consulted and in which period it accumulates over, and in nothing else.
// Two copies of this arithmetic would be two rules with one number.
//
//   R-29  `best_day_cents * 10000 <= max_day_share_bp * period_profit_cents`
//         INTEGER CROSS MULTIPLICATION in `bigint`. INV-03: "All ratios are
//         integer basis points, compared by CROSS-MULTIPLICATION, never
//         division." GS-023 pins the tie: `best * 10000 == max_bp * profit`
//         satisfies `<=`.
//
//   R-30  Skipped entirely unless `period_profit_cents > 0`, STRICT. A skipped
//         gate reports `pass: true, skipped: true` (GS-021 zero, GS-022
//         negative), and skipping BEFORE the arithmetic is what makes FM-15
//         "structurally impossible" rather than handled.
//
// -----------------------------------------------------------------------------
// WHERE DIVISION APPEARS, AND WHY IT IS NOT THE DIVISION THAT IS BANNED
// -----------------------------------------------------------------------------
// M01 section 3.5 writes "No division exists anywhere in the engine" and M01
// section 3.6's own reference algorithm then calls `ceilDiv` four lines later.
// The two are not in conflict once the banned thing is named precisely: what
// INV-03 and FM-15 forbid is DECIDING a ratio by division, because that is where
// a truncation silently moves a gate and where a zero denominator produces a
// `NaN` that "compares false and silently blocks eligibility".
//
// So the split here is absolute and mechanical:
//
//   THE VERDICT      cross multiplication, `bigint`, no division. R-29.
//   THE TWO NUMBERS  `profitNeededToDiluteCents` and `bestDayShareBp` are
//                    REPORTED, never compared. Both are computed only after
//                    R-30 has established `periodProfitCents > 0`, so no
//                    division here can meet a zero denominator.
//
// `profitNeededToDiluteCents` is M01's own `ceilDiv` and it is not optional
// decoration: section 4 calls the gate breakdown "a product feature, not debug
// output ... That is only possible because the engine computes
// `profitNeededToDiluteCents` rather than a boolean", and AS-13 requires the
// portal to show it AT ALL TIMES so a trader sees the shape of the rule before
// it bites.
// =============================================================================

import type { Cents, ConsistencyRules } from '../types.js';

/**
 * What the consistency gate decided, and the two numbers a reader is owed.
 *
 * `skipped` IS NOT `!enabled`. CV-19 fixed the vocabulary when it disabled the
 * funded minimum-days gate: a gate that was not evaluated reports `pass: true,
 * skipped: true` and "must be visibly disabled in the eligibility breakdown ...
 * so no trader or support agent ever sees a gate that reads as satisfied when it
 * was never evaluated". R-30's denominator rule is the same shape: the gate
 * passed because there was nothing to test, not because the ratio was good.
 */
export interface ConsistencyVerdict {
  /** R-28 and R-36 both read this and nothing else to decide. */
  readonly ok: boolean;
  /** R-30. True exactly when the denominator rule skipped the arithmetic. */
  readonly skipped: boolean;
  /** M01 section 3.6's `profit_needed_to_dilute`. `0n` whenever `ok`. */
  readonly profitNeededToDiluteCents: Cents;
  /** Reported, never compared. `null` when the gate is disabled or skipped. */
  readonly bestDayShareBp: number | null;
  /** The configured limit, carried so an event payload does not re-read config. */
  readonly maxDayShareBp: number | null;
}

/**
 * Integer ceiling division. Positive numerator, positive denominator, both
 * established by the caller before it is reached.
 */
function ceilDiv(numerator: Cents, denominator: Cents): Cents {
  return (numerator + denominator - 1n) / denominator;
}

/**
 * R-30 then R-29, in that order, because the order is the rule.
 *
 * `maxDayShareBp` IS TRUSTED TO BE POSITIVE AND CV-06 IS WHAT MAKES THAT SAFE:
 * "`0 < consistency.max_day_share_bp <= 10000` when enabled", and "0 bp is
 * unsatisfiable". A config that reaches an account is a config that already
 * passed validation, which is M01's stated arrangement for INV-21 as well
 * ("guaranteed by config validation rather than by a compensating recompute,
 * which is the stronger arrangement because it fails at publish time instead of
 * at settlement time"). Re-checking it here would put a second, weaker copy of
 * CV-06 on the money path.
 */
export function consistencyOk(
  bestDayCents: Cents,
  periodProfitCents: Cents,
  cfg: ConsistencyRules,
): ConsistencyVerdict {
  if (!cfg.enabled) {
    return {
      ok: true,
      skipped: false,
      profitNeededToDiluteCents: 0n,
      bestDayShareBp: null,
      maxDayShareBp: null,
    };
  }

  const maxDayShareBp: number = cfg.maxDayShareBp;

  // R-30, STRICT. Zero and negative period profit both land here, which is
  // GS-021 and GS-022, and nothing below this line can then divide by zero.
  if (periodProfitCents <= 0n) {
    return {
      ok: true,
      skipped: true,
      profitNeededToDiluteCents: 0n,
      bestDayShareBp: null,
      maxDayShareBp,
    };
  }

  const limitBp = BigInt(maxDayShareBp);

  // R-29. `<=`, so exactly at the threshold passes (GS-023).
  const ok = bestDayCents * 10_000n <= limitBp * periodProfitCents;

  // Reported, never compared: the share the trader is at, floored to whole
  // basis points because a bp is the unit every ruled threshold is stated in.
  const bestDayShareBp = Number((bestDayCents * 10_000n) / periodProfitCents);

  // M01 section 3.6, verbatim in shape. The smallest additional period profit
  // `x` that satisfies `best * 10000 <= bp * (profit + x)`, which rearranges to
  // `x >= (best * 10000 - bp * profit) / bp`. AS-02's worked case is the test:
  // best 100,000c on profit 200,000c at 3000bp needs 133,334c.
  const profitNeededToDiluteCents = ok
    ? 0n
    : ceilDiv(bestDayCents * 10_000n - limitBp * periodProfitCents, limitBp);

  return { ok, skipped: false, profitNeededToDiluteCents, bestDayShareBp, maxDayShareBp };
}
