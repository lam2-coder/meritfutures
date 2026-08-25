// =============================================================================
// packages/rules-engine/src/day/breach.ts
// =============================================================================
// GROUP D, and the two strict operators are the entire file.
//
//   R-21  `low_balance_cents < floorOpenCents`      STRICT `<`
//         Touching the floor is NOT a breach. A clean liquidation lands exactly
//         on the floor and survives; slippage below it breaches (R-20).
//
//   R-22  `-realized_pnl_cents > daily_loss_limit_cents`   STRICT `>`
//         A loss exactly at the limit SURVIVES. OQ-6 ruled the two operators
//         must agree rather than disagree by accident, and R-22 is the one that
//         moved: it amends the approved STATE_MACHINES G-BREACH guard, which
//         carried `>=`. Published as "more than".
//
// M01 SECTION 3.6's PSEUDOCODE WRITES R-22 AS `>=` AND THE RULE TABLE WRITES IT
// AS `>`. The table is the contract by M01 section 3.5's own sentence ("The
// operator column is the contract: it is what the engine executes, what
// `copy_blocks` publishes, and what the fixture asserts"), OQ-6's ruling text
// says "exactly at the limit survives, making it `>`", and section 10.1 records
// the same. So this file implements `>`, `RE-U-022` asserts it at the boundary
// on both sides, and the disagreement inside M01 is reported rather than
// silently resolved: it is a defect in an approved document and moving it is an
// ADR, not a commit.
//
// NO V1 PLAN CONFIGURES A DAILY LOSS LIMIT (Appendix A, all three plans:
// "none"), which is exactly why the operator has to be right now. Nothing
// exercises it in production until a plan enables one, and by then the code will
// not be re-read.
// =============================================================================

import type { BreachKind, Cents, DailyLossLimitRules, DailyMark, DrawdownRules } from '../types.ts';

export interface BreachInput {
  readonly mark: DailyMark;
  /** R-18. The floor at the OPEN, captured before DO-7 trails anything. */
  readonly floorOpenCents: Cents;
  readonly drawdown: DrawdownRules;
  readonly dailyLossLimit: DailyLossLimitRules;
}

export interface BreachOutcome {
  readonly breached: boolean;
  readonly kind: BreachKind | null;
  /** How far below the floor the day's low went. `0n` when the floor was not the cause. */
  readonly shortfallCents: Cents;
  /** R-23. A soft limit was exceeded, which is a FACT and never a breach. */
  readonly softLimitExceeded: boolean;
}

/**
 * DO-4. Both breach tests, in the order M01 states them, with the floor first.
 *
 * `breachKind` distinguishes the two floor types because the evidence pack must
 * be able to say which rule closed the account (`trailing_eod_floor` versus
 * `static_floor`), and they are configured, not inferred from the numbers.
 */
export function checkBreach(input: BreachInput): BreachOutcome {
  const { mark, dailyLossLimit } = input;

  // R-21, strict. Touching the floor survives.
  const floorBreached = mark.lowBalanceCents < input.floorOpenCents;

  // R-22, strict. A loss EXACTLY at the limit survives. The negation is here
  // because `realized_pnl_cents` is signed and the limit is a magnitude.
  const lossCents = -mark.realizedPnlCents;
  const hardLimitBreached = dailyLossLimit.type === 'hard' && lossCents > dailyLossLimit.limitCents;

  // R-23. Never a breach: the engine emits a fact and any enforcement is the
  // platform's. Reported alongside so DO-5's caller can emit the event without
  // re-deriving the comparison.
  const softLimitExceeded = dailyLossLimit.type === 'soft' && lossCents > dailyLossLimit.limitCents;

  if (!floorBreached && !hardLimitBreached) {
    return { breached: false, kind: null, shortfallCents: 0n, softLimitExceeded };
  }

  // THE FLOOR WINS THE LABEL WHEN BOTH FIRE. A day that broke the floor is a
  // floor breach whatever else it also did, and the shortfall is the number the
  // trader is owed an explanation of.
  const kind: BreachKind = floorBreached
    ? input.drawdown.type === 'static'
      ? 'static_floor'
      : 'trailing_eod_floor'
    : 'hard_daily_loss_limit';

  return {
    breached: true,
    kind,
    shortfallCents: floorBreached ? input.floorOpenCents - mark.lowBalanceCents : 0n,
    softLimitExceeded,
  };
}
