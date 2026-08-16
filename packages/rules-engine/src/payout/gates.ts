// =============================================================================
// packages/rules-engine/src/payout/gates.ts
// =============================================================================
// GROUP F, THE FUNDED GATES. M01 section 1.3's layout gives this file R-33 to
// R-41, and it arrives one dependency at a time rather than all at once.
//
// WHAT IS HERE TODAY AND WHY IT IS ONLY THIS
//
//   R-35  `withdrawable = max(0, balance_cents - size_cents - buffer_cents)`
//
// R-35 IS FIRST BECAUSE GROUP G CANNOT BE TYPED WITHOUT IT. M01 section 3.6's
// `clampPayout` reads `state.withdrawableCents` and P2 section 2 puts group G
// (order 3, "None" calendar needed) before group F (order 4, "Full slice, real
// data"), so the one field group G needs from group F lands with group G and the
// rest of the gates follow. The alternative -- clamping against a withdrawable
// recomputed inside `clampPayout` -- would put R-35's arithmetic in two places,
// and R-43's whole claim is that the number the trader is SHOWN and the number
// they are PAID come out of one function (M01 section 1.3, FM-16).
//
// THE REST OF GROUP F IS NOT WRITTEN AND `RuleState` SAYS SO. `engineGates` and
// `engineEligible` are absent until R-33, R-34, R-36, R-37, R-39 and R-41 all
// exist, because `engineEligible` is a CONJUNCTION (R-41, INV-15: "with no
// shortcut path") and a conjunction over a subset of its terms is not a weaker
// answer, it is a wrong one that reads as an answer. A partially evaluated
// eligibility flag on a money path is the shape FM-16 and AS-14 both refuse.
// =============================================================================

import type { Cents, ResolvedPlan, RuleState } from '../types.js';

/**
 * R-35. `withdrawable = max(0, balance_cents - size_cents - buffer_cents)`.
 *
 * GS-025 pins it and INV-05 is the half that must never be reachable:
 * `withdrawable_cents >= 0` ALWAYS, and M01 puts the enforcement in the formula
 * itself ("Formula floors at zero (R-35)") rather than in a check downstream of
 * it. There is no path here that produces a negative number, which is what
 * RE-P-05 asserts over generated sequences and RE-P-14 asserts about the buffer.
 *
 * THE BUFFER IS PERMANENT AND IS NEVER WITHDRAWABLE. M01 R-35 says so in those
 * words, and it is the reason the funded phase has anything for the time gates
 * to work on: a trader who could withdraw down to `size_cents` would leave no
 * cushion between the balance and the floor, which is AS-10's arithmetic run in
 * reverse.
 *
 * ZERO OUTSIDE THE FUNDED PHASE, WHICH IS M01 SECTION 3.6's OWN FIRST LINE
 * (`if (s.phase !== 'funded') return 0n`). An eval account has no withdrawable
 * amount because it has no funded balance yet (R-31 resets it to `size_cents`
 * and "eval profit is not carried"), and a `closed` or `graduated` account has
 * nothing further to extract. Deriving a number for those phases would put a
 * positive withdrawable on an account no gate could ever clear.
 */
export function withdrawableCents(state: RuleState, plan: ResolvedPlan): Cents {
  if (state.phase !== 'funded') return 0n;

  const surplus = state.balanceCents - plan.sizeCents - plan.funded.bufferCents;
  return surplus > 0n ? surplus : 0n;
}
