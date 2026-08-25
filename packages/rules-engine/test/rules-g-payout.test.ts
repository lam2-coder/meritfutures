// =============================================================================
// GROUP G: THE PAYOUT ARITHMETIC. RE-U-042 to RE-U-045.
// =============================================================================
// Every expectation here is arithmetic stated in a document, and the arithmetic
// is written out beside it in integer cents so a reader checks the number
// instead of trusting it (P2 section 2's second traceability tier).
//
// THE WITHDRAWABLE IS SUPPLIED AS AN OVERRIDE AND ITS ARITHMETIC IS STATED
// BESIDE IT. R-35 is asserted in `rules-f-gates.test.ts`; a group G test that
// re-derived it would be asserting two rules at once and would fail for the
// wrong reason when either moved.
// =============================================================================

import { expect, test } from 'vitest';

import { EngineInvariantError } from '../src/errors.ts';
import { capForOrdinal, clampPayout, ordinalForNextPayout } from '../src/payout/clamp.ts';
import type { Cents, ResolvedPlan, RuleState } from '../src/types.ts';
import { CORE_50K, fundedPrior, withCapSchedule } from './fixtures-in-code.ts';
import { reU } from './rule-coverage.ts';

/**
 * A funded state carrying a stated withdrawable.
 *
 * The balance is stated too, and the two agree by R-35 at CORE-50K's size of
 * 5,000,000c and buffer of 100,000c (Appendix A.1), so no state here is one the
 * fold could not have produced.
 */
function funded(fields: {
  readonly balanceCents: Cents;
  readonly withdrawableCents: Cents;
  readonly payoutsSettledCount?: number;
  readonly plan?: ResolvedPlan;
}): RuleState {
  return fundedPrior(fields.plan ?? CORE_50K, {
    balanceCents: fields.balanceCents,
    withdrawableCents: fields.withdrawableCents,
    payoutsSettledCount: fields.payoutsSettledCount ?? 0,
  });
}

/** GS-026's state: withdrawable 214,250 = 5,314,250 - 5,000,000 - 100,000. */
const RICH = funded({ balanceCents: 5_314_250n, withdrawableCents: 214_250n });

// -----------------------------------------------------------------------------
// R-42  the cap is the LAST schedule entry whose `from_ordinal <= ordinal`
// -----------------------------------------------------------------------------
test(reU('R-42'), () => {
  // CORE-50K carries one rung, "ordinal 1 and up" at 150,000c (Appendix A.1), so
  // every ordinal on a published v1 plan resolves to the same cap.
  expect(capForOrdinal(CORE_50K.funded, 1)).toBe(150_000n);
  expect(capForOrdinal(CORE_50K.funded, 5)).toBe(150_000n);

  // THE `<=` BOUNDARY NEEDS A LADDER, AND NO V1 PLAN HAS ONE. CV-09 specifies
  // the shape ("ordinals strictly increase"), so the schedule below is a config
  // `validatePlan` accepts and the lineup does not use. The FIRST rung is
  // CORE-50K's published 150,000c; THE SECOND RUNG'S VALUE IS ARBITRARY and is
  // not a published parameter. What is under test is which rung an ordinal
  // selects, one ordinal apart.
  const laddered = withCapSchedule(CORE_50K, [
    { fromOrdinal: 1, capCents: 150_000n },
    { fromOrdinal: 3, capCents: 200_000n },
  ]);

  expect(capForOrdinal(laddered.funded, 2)).toBe(150_000n); // 3 <= 2 is false
  expect(capForOrdinal(laddered.funded, 3)).toBe(200_000n); // 3 <= 3 is true
  expect(capForOrdinal(laddered.funded, 4)).toBe(200_000n); // and it holds above

  // AN ORDINAL WITH NO RUNG REFUSES RATHER THAN GOING UNCAPPED. CV-09 requires
  // the schedule to be non-empty and to start at 1, so both of these are configs
  // the publish gate must have rejected. "Universal per-payout caps exist on
  // every plan and every ordinal" is a structural ruling (constitution 0.4,
  // Appendix A.0), so there is no default to fall back on.
  expect(() => capForOrdinal(withCapSchedule(CORE_50K, []).funded, 1)).toThrow(
    EngineInvariantError,
  );
  expect(() =>
    capForOrdinal(withCapSchedule(CORE_50K, [{ fromOrdinal: 2, capCents: 150_000n }]).funded, 1),
  ).toThrow(/CV-09/);
});

// -----------------------------------------------------------------------------
// R-43  `approved = min(effective_request, cap, withdrawable)`
// -----------------------------------------------------------------------------
test(reU('R-43'), () => {
  // GS-026: withdrawable 214,250, cap 150,000, approved 150,000, reason `cap`.
  // The cap binds and it binds STRICTLY below the withdrawable, so it can be
  // named.
  const capped = clampPayout(RICH, CORE_50K, null);
  expect(capped.capCents).toBe(150_000n);
  expect(capped.withdrawableCents).toBe(214_250n);
  expect(capped.approvedCents).toBe(150_000n);
  expect(capped.reason).toBe('cap');

  // GS-027: withdrawable 120,000, cap 150,000, approved 120,000, reason
  // `withdrawable`. 5,220,000 - 5,000,000 - 100,000 = 120,000.
  const thin = funded({ balanceCents: 5_220_000n, withdrawableCents: 120_000n });
  const byWithdrawable = clampPayout(thin, CORE_50K, null);
  expect(byWithdrawable.approvedCents).toBe(120_000n);
  expect(byWithdrawable.reason).toBe('withdrawable');

  // GS-028: cap exactly equals withdrawable. "Exact tie resolves to that value
  // with `clamp_reason: none`", which is B4 #13's tie case. Naming either term
  // would report a cap pressure that was really a coincidence.
  // 5,250,000 - 5,000,000 - 100,000 = 150,000, which is the cap to the cent.
  const tied = funded({ balanceCents: 5_250_000n, withdrawableCents: 150_000n });
  const exactTie = clampPayout(tied, CORE_50K, null);
  expect(exactTie.approvedCents).toBe(150_000n);
  expect(exactTie.reason).toBe('none');

  // R-43's fourth value. A supplied amount below both limits is the only thing
  // that set the number, so the request is what is named.
  const requested = clampPayout(RICH, CORE_50K, 100_000n);
  expect(requested.effectiveRequestCents).toBe(100_000n);
  expect(requested.approvedCents).toBe(100_000n);
  expect(requested.reason).toBe('requested');

  // ADR-009's default, and API_CONTRACT's "a supplied amount is a CEILING, never
  // an instruction": an omitted amount is `min(withdrawable, cap)`, so it can
  // never approve MORE than a supplied one against the same state.
  expect(clampPayout(RICH, CORE_50K, null).effectiveRequestCents).toBe(150_000n);
  expect(clampPayout(RICH, CORE_50K, 900_000n).approvedCents).toBe(150_000n);
  expect(clampPayout(RICH, CORE_50K, 900_000n).reason).toBe('cap');
});

// -----------------------------------------------------------------------------
// R-43's tail, R-39's input: `approved >= min_payout_cents`, `>=`
// -----------------------------------------------------------------------------
test('RE-U-043  R-43  the minimum-payout tie is eligible at exactly 100.00, one cent below is not', () => {
  // GS-042 (B4 #13): "`10000 >= 10000` eligible; `9999` not eligible; a supplied
  // `1` clamps to 1 and FAILS THE MINIMUM GATE rather than paying 1 cent."
  // CV-15 fixes `min_payout_cents` at 10,000c and it never scales by size.

  // Withdrawable exactly at the minimum: 5,110,000 - 5,000,000 - 100,000 = 10,000
  const atMinimum = funded({ balanceCents: 5_110_000n, withdrawableCents: 10_000n });
  const eligible = clampPayout(atMinimum, CORE_50K, null);
  expect(eligible.approvedCents).toBe(10_000n);
  expect(eligible.meetsMinimum).toBe(true);

  // One cent below: 5,109,999 - 5,000,000 - 100,000 = 9,999
  const belowMinimum = funded({ balanceCents: 5_109_999n, withdrawableCents: 9_999n });
  const notEligible = clampPayout(belowMinimum, CORE_50K, null);
  expect(notEligible.approvedCents).toBe(9_999n);
  expect(notEligible.meetsMinimum).toBe(false);

  // The supplied `1`. The amount is computed and is 1; the MINIMUM is what
  // refuses it, which is why `meetsMinimum` is reported here and decided by the
  // gate rather than turned into a zero inside the arithmetic.
  const oneCent = clampPayout(RICH, CORE_50K, 1n);
  expect(oneCent.approvedCents).toBe(1n);
  expect(oneCent.meetsMinimum).toBe(false);
});

// -----------------------------------------------------------------------------
// R-44  split, remainder to the trader, legs sum exactly
// -----------------------------------------------------------------------------
test(reU('R-44'), () => {
  // GS-029, to the cent: "approved 100,001 at 9000bp: trader 90,001, firm
  // 10,000, sum exact."
  //
  //   trader = (100,001 * 9000 + 9999) / 10000
  //          = (900,009,000 + 9,999) / 10000
  //          = 900,018,999 / 10000
  //          = 90,001            (integer division, a ceiling)
  //   firm   = 100,001 - 90,001 = 10,000
  //
  // Truncating instead of ceiling would give 90,000, a cent to the firm, which
  // is the direction R-44 forbids: "Rounding favors the trader, by at most one
  // cent, and the published copy says so."
  const split = clampPayout(RICH, CORE_50K, 100_001n);
  expect(split.approvedCents).toBe(100_001n);
  expect(split.splitBp).toBe(9000);
  expect(split.traderCents).toBe(90_001n);
  expect(split.firmCents).toBe(10_000n);
  expect(split.traderCents + split.firmCents).toBe(split.approvedCents); // INV-11

  // THE OTHER SIDE OF THE ROUNDING BOUNDARY: an amount the split divides
  // exactly. 150,000 * 9000 / 10000 = 135,000 with no remainder, so the ceiling
  // adds nothing and the trader is not handed a phantom cent.
  const exact = clampPayout(RICH, CORE_50K, null);
  expect(exact.approvedCents).toBe(150_000n);
  expect(exact.traderCents).toBe(135_000n);
  expect(exact.firmCents).toBe(15_000n);
  expect(exact.traderCents + exact.firmCents).toBe(exact.approvedCents);

  // The smallest remainder there is. 1c at 9000bp is 0.9c, and the ceiling gives
  // the whole cent to the trader rather than to the firm. INV-11 still holds:
  // the firm leg is a SUBTRACTION, never a second rounded multiplication.
  const oneCent = clampPayout(RICH, CORE_50K, 1n);
  expect(oneCent.traderCents).toBe(1n);
  expect(oneCent.firmCents).toBe(0n);
  expect(oneCent.traderCents + oneCent.firmCents).toBe(1n);
});

// -----------------------------------------------------------------------------
// R-45  `ordinal = payoutsSettledCount + 1`
// -----------------------------------------------------------------------------
test(reU('R-45'), () => {
  // The boundary is the counter, one settlement apart.
  expect(
    ordinalForNextPayout(funded({ balanceCents: 5_314_250n, withdrawableCents: 214_250n })),
  ).toBe(1);
  expect(
    ordinalForNextPayout(
      funded({ balanceCents: 5_314_250n, withdrawableCents: 214_250n, payoutsSettledCount: 1 }),
    ),
  ).toBe(2);

  // GS-066, AS-11: "Ordinal 3 fails, the retry is ordinal 3 again,
  // `payouts_settled_count` never moved." A failed attempt is not an input to
  // this function at all, which is the structural half of SD-05: the ordinal is
  // DERIVED FROM SETTLEMENTS rather than counted from attempts, so two clamps
  // against one state cannot disagree.
  const afterTwo = funded({
    balanceCents: 5_314_250n,
    withdrawableCents: 214_250n,
    payoutsSettledCount: 2,
  });
  const attempt = clampPayout(afterTwo, CORE_50K, null);
  const retry = clampPayout(afterTwo, CORE_50K, null);
  expect(attempt.ordinal).toBe(3);
  expect(retry.ordinal).toBe(3);
  expect(retry).toEqual(attempt);

  // And the ordinal is what R-42 resolves the cap against, which is the rung
  // AS-11 says a failed transfer must not advance.
  const laddered = withCapSchedule(CORE_50K, [
    { fromOrdinal: 1, capCents: 150_000n },
    { fromOrdinal: 3, capCents: 200_000n },
  ]);
  expect(clampPayout(afterTwo, laddered, null).capCents).toBe(200_000n);
  expect(
    clampPayout(
      funded({ balanceCents: 5_314_250n, withdrawableCents: 214_250n, payoutsSettledCount: 1 }),
      laddered,
      null,
    ).capCents,
  ).toBe(150_000n);
});
