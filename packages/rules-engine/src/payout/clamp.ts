// =============================================================================
// packages/rules-engine/src/payout/clamp.ts
// =============================================================================
// GROUP G, THE PAYOUT ARITHMETIC. R-42 to R-45, and M01 section 3.6 calls this
// "THE ONLY PLACE A PAYABLE AMOUNT IS EVER COMPUTED".
//
// That sentence is the whole design. `GET /accounts/:id/eligibility` and
// `POST /accounts/:id/payout` both route here through the same `evaluatePayout`,
// with the identical inputs, "which is why the number the trader is shown and
// the number they receive can never differ" (M01 section 1.3, R-43). FM-16 is
// what happens when a second implementation appears in the API layer: two
// implementations of one rule, which drift.
//
// P2 SECTION 2 PUTS THIS GROUP BEFORE THE REST OF GROUP F, and the reason is
// mechanical rather than editorial: "`clampPayout` is pure arithmetic over a
// resolved plan" and needs no calendar at all, while R-37's cadence gap needs a
// full slice with real data. So group G can be right before the calendar exists.
//
// -----------------------------------------------------------------------------
// WHAT IS NOT EXPORTED FROM THE PACKAGE, AND M01 DISAGREES WITH ITSELF ON IT
// -----------------------------------------------------------------------------
// Section 1.3 is unambiguous: "The public surface is six functions. NOTHING ELSE
// IS EXPORTED, because every additional export is a way for a caller to
// reimplement a rule slightly differently", and `clampPayout` is not one of the
// six. Section 3.6's reference algorithm then writes `export function
// clampPayout`. This file follows section 1.3 and `clampPayout` is exported from
// the MODULE and not from `index.ts`: `evaluatePayout` is the six-function
// surface's way in, and it is the one M01 section 4 names for both endpoints.
//
// REPORTED, NOT EDITED. Changing a frozen document is an ADR, not a commit, and
// this is the same shape as R-15 and R-22 before it: where the prose and the
// sketch disagree, the engine follows the founder's stated binding formulation
// and the disagreement goes in the session log.
// =============================================================================

import { EngineInvariantError } from '../errors.ts';
import type {
  BasisPoints,
  Cents,
  ClampReason,
  FundedPhaseRules,
  GateInputState,
  ResolvedPlan,
} from '../types.ts';

/**
 * R-43's four values. `none` is an EXACT TIE, not an absence.
 *
 * M01 R-43: "`clamp_reason` is `cap`, `withdrawable`, `requested`, or `none` on
 * an exact tie." So `requested` means the trader's own number is what set the
 * amount, and `none` means no single term can be blamed because two or more of
 * them landed on the same figure. `engine.clamp_reason_distribution` (section
 * 9.1) is read as a product metric off exactly this discrimination: "a high
 * `cap` share means traders routinely leave money behind".
 *
 * IT IS DECLARED IN `types.ts` because M01 section 2.2 names it inside
 * `PayoutEvaluation`, and re-exported here so a reader of the clamp finds it
 * beside the arithmetic that produces it.
 */
export type { ClampReason } from '../types.ts';

/** Everything R-42 to R-45 decide about one payout request. */
export interface PayoutClamp {
  /** R-45. `payoutsSettledCount + 1`. */
  readonly ordinal: number;
  /** R-42. The rung this ordinal falls on. */
  readonly capCents: Cents;
  /** R-35, read off the state rather than recomputed (M01 section 3.6). */
  readonly withdrawableCents: Cents;
  /** R-43. The supplied amount, or `min(withdrawable, cap)` when omitted. */
  readonly effectiveRequestCents: Cents;
  /** R-43. `min(effective_request, cap, withdrawable)`. INV-10. */
  readonly approvedCents: Cents;
  readonly reason: ClampReason;
  /** R-44. The ceiling half of the split: rounding favors the trader. */
  readonly traderCents: Cents;
  /** R-44. `approved - trader`, so the legs sum exactly (INV-11). */
  readonly firmCents: Cents;
  readonly splitBp: BasisPoints;
  /**
   * R-43's tail and R-39's input: `approved >= min_payout_cents`.
   *
   * IT IS REPORTED HERE AND DECIDED IN THE GATE. This function computes the
   * amount; whether the amount clears the minimum is an eligibility question,
   * and putting the refusal here would give the engine two places that can say
   * no to a payout.
   */
  readonly meetsMinimum: boolean;
}

/**
 * R-45. The ordinal this account's next payout would take.
 *
 * `ordinal = payoutsSettledCount + 1`, AND THE POINT IS THE COUNTER IT READS.
 * AS-11 is the attack, and it is a bug rather than an adversary: under a plain
 * `unique (account_id, payout_ordinal)` a FAILED transfer consumes its ordinal,
 * so the retry takes the next one, "advancing the cap schedule and the
 * graduation counter for money that never arrived. A trader could be graduated
 * off the platform after seven payouts and one failure."
 *
 * The counter here is advanced by `applySettlement` and by nothing else (R-46 to
 * R-50), so an attempt that never settled moves no ordinal. SD-05 makes the
 * database agree by narrowing the constraint to `where status <> 'failed'`. The
 * engine's half is that the number is DERIVED FROM SETTLEMENTS rather than
 * counted from attempts.
 */
export function ordinalForNextPayout(state: GateInputState): number {
  return state.payoutsSettledCount + 1;
}

/**
 * R-42. "The cap is the `cap_cents` of the LAST schedule entry whose
 * `from_ordinal <= ordinal`."
 *
 * NO SORT AND NO KEY ITERATION. The determinism contract bans
 * `Array.prototype.sort` without a total comparator and bans iteration whose
 * order affects output; CV-09 already guarantees this array is ordered
 * ("ordinals strictly increase"), so the scan below reads it in the order the
 * publish gate established rather than imposing one of its own.
 *
 * CV-09 IS TRUSTED AND NOT RE-CHECKED, which is this package's standing
 * arrangement: "a config that reaches an account is a config that already passed
 * validation", stated for CV-06 in `consistency.ts` and for INV-21 in M01 R-48
 * ("guaranteed by config validation rather than by a compensating recompute,
 * which is the stronger arrangement because it fails at publish time instead of
 * at settlement time").
 *
 * WHAT IS NOT TRUSTED IS THAT A RUNG EXISTS AT ALL, and that one throws. CV-09
 * requires the schedule to be non-empty and to start at `from_ordinal: 1`, so
 * every ordinal from 1 up has a rung; a schedule that does not is one
 * `validatePlan` must have rejected, and computing a payout against a plan with
 * no cap would be an UNCAPPED extraction, which constitution 0.4 makes a
 * structural ruling rather than a parameter. There is no plausible amount to
 * return, so this refuses rather than inventing one. RE-P-16 asserts the
 * monotonicity that makes the scan's answer well defined.
 */
export function capForOrdinal(funded: FundedPhaseRules, ordinal: number): Cents {
  let capCents: Cents | null = null;

  for (const step of funded.payoutCapSchedule) {
    if (step.fromOrdinal <= ordinal) capCents = step.capCents;
  }

  if (capCents === null) {
    throw new EngineInvariantError(
      'CV-09',
      `no payout cap schedule entry covers ordinal ${String(ordinal)}, so the request has no cap`,
    );
  }
  return capCents;
}

/** `min` over `bigint`, written once so no call site spells it differently. */
function min(a: Cents, b: Cents): Cents {
  return a < b ? a : b;
}

/**
 * R-43, R-44, R-42 and R-45 in the order M01 section 3.6 applies them.
 *
 * `requestedCents` is `null` when the caller omitted an amount, which
 * [ADR-009](../../../docs/decisions/ADR-009.md) defines as "pay the maximum I am
 * eligible for" and API_CONTRACT restates: "A supplied amount is a CEILING,
 * never an instruction." That is why the default is `min(withdrawable, cap)` and
 * not the cap: an omitted amount can never approve more than a supplied one at
 * the same state.
 *
 * THE THREE-WAY `min` IS INV-10 AND IT IS NOT A BELT AND BRACES. Even with the
 * default already at `min(w, cap)`, the SUPPLIED path arrives unclamped, so
 * `approved = min(effective, cap, withdrawable)` is the only line standing
 * between a trader's request and the cap. RE-P-07 asserts it over generated
 * inputs.
 */
export function clampPayout(
  state: GateInputState,
  plan: ResolvedPlan,
  requestedCents: Cents | null,
): PayoutClamp {
  const ordinal = ordinalForNextPayout(state); // R-45
  const capCents = capForOrdinal(plan.funded, ordinal); // R-42
  const withdrawable = state.withdrawableCents; // R-35, computed at DO-9

  // R-43. ADR-009's default, then the clamp.
  const effectiveRequestCents = requestedCents ?? min(withdrawable, capCents);
  const approvedCents = min(min(effectiveRequestCents, capCents), withdrawable);

  // -----------------------------------------------------------------------------
  // R-43's `clamp_reason`, transcribed from M01 section 3.6's own discrimination
  // -----------------------------------------------------------------------------
  // Each branch asks which SINGLE term produced the number, and the strictness
  // is what makes the answer attributable:
  //
  //   requested     the amount came out of the request and matched neither
  //                 limit, so the request is the only thing that set it
  //   cap           the cap bound, and it bound STRICTLY below the withdrawable
  //   withdrawable  the withdrawable bound, STRICTLY below the cap
  //   none          two or more terms landed on the same figure, so no single
  //                 one can be named. "None on an exact tie" (R-43)
  //
  // A reason that named a term on a tie would make `engine.clamp_reason_
  // distribution` report a cap pressure that was really a coincidence.
  const reason: ClampReason =
    approvedCents === effectiveRequestCents &&
    effectiveRequestCents !== capCents &&
    effectiveRequestCents !== withdrawable
      ? 'requested'
      : approvedCents === capCents && capCents < withdrawable
        ? 'cap'
        : approvedCents === withdrawable && withdrawable < capCents
          ? 'withdrawable'
          : 'none';

  // -----------------------------------------------------------------------------
  // R-44  the split, remainder to the trader
  // -----------------------------------------------------------------------------
  // `trader = (approved * split_bp + 9999) / 10000` in integer division, which
  // is a CEILING, and `firm = approved - trader`. Two properties, both published:
  //
  //   the legs sum EXACTLY, no cents lost                 INV-11, R-44, GS-029
  //   rounding favors the trader by at most one cent      R-44, RE-P-08
  //
  // The firm leg is a SUBTRACTION and never a second rounded multiplication,
  // which is what makes INV-11 hold by construction instead of by luck: two
  // independently rounded legs would differ from `approved` by a cent whenever
  // the split does not divide evenly, and M01 R-44 says "the legs always sum
  // exactly" rather than "the legs are reconciled".
  const splitBp = plan.funded.splitBp;
  const traderCents = (approvedCents * BigInt(splitBp) + 9_999n) / 10_000n;
  const firmCents = approvedCents - traderCents;

  return {
    ordinal,
    capCents,
    withdrawableCents: withdrawable,
    effectiveRequestCents,
    approvedCents,
    reason,
    traderCents,
    firmCents,
    splitBp,
    meetsMinimum: approvedCents >= plan.funded.minPayoutCents, // R-43's tail, R-39
  };
}
