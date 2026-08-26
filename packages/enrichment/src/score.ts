// =============================================================================
// packages/enrichment/src/score.ts
// =============================================================================
// THE SCORE, IN INTEGER BASIS POINTS, WITH NO AUTHORITY OVER ANYTHING.
//
// ADR-023 step 1: "Signals recorded, SCORED, and reported; nothing is blocked."
// This file is the second word. What it deliberately does not contain is a
// comparison of its own output against anything: no band, no cut line, no
// mapping to `risk_flags.severity`, and no exported helper that answers a
// yes-or-no question about a score. A scorer that silently gains authority is
// the failure ADR-023's graduated rollout forecloses, and the absence is
// asserted mechanically in `test/no-authority.test.ts` rather than promised
// here.
//
// -----------------------------------------------------------------------------
// BASIS POINTS, INTEGER, AND THE DIRECTION IS RISK
// -----------------------------------------------------------------------------
// 0 to 10000 is `identity_links.confidence_bp`'s scale, which is the one scored
// scale the corpus already has and is `integer ... CHECKed 0 to 10000`. The
// DIRECTION here is RISK rather than confidence: 0 is nothing observed against
// the buyer and 10000 is maximal, which is the direction the approval line is
// written in ("returns a maximal risk score") and the direction a reader of a
// fraud signal expects.
//
// NO FLOATS. Every value that enters is an integer, every division is a
// truncating integer division, and the suite greps this directory for a decimal
// literal, `toFixed` and `parseFloat`. This is not a money path by content, but
// it runs inside one by position, and a fraction that is harmless in a fraud
// reading is a fraction in a money reading one ruling later.
//
// -----------------------------------------------------------------------------
// AN UNKNOWN READING IS EXCLUDED FROM THE DENOMINATOR AND IS NOT A ZERO
// -----------------------------------------------------------------------------
// M07 section 3.2 names this as the one implementation trap in the D-18
// composite: `null` means "we did not find out" and `false` means "the vendor
// looked and there is none". A mean that counted unknowns as clean would report
// a vendor outage as a population of unusually safe buyers; a mean that counted
// them as dirty would report it as a fraud wave. Neither is true, so an unknown
// reading changes the score by nothing at all and the COUNT of them is carried
// beside the score so a reader can see how much the score is standing on.
//
// A SCORE OVER NOTHING IS NOT A ZERO EITHER, which is why `unscored` is a
// separate member of the result union rather than a `riskBp` of 0. A caller
// that treated an unanswered vendor as a clean buyer would be reading an
// outage as evidence.
//
// -----------------------------------------------------------------------------
// `ageDays` IS RECORDED AND NOT SCORED, AND THAT IS A DECISION
// -----------------------------------------------------------------------------
// Turning an age in days into a risk reading needs a curve, and ADR-023 rules
// that thresholds are "tuned on beta data, never on the vendor's defaults,
// because the vendor's defaults describe a different population". A curve
// invented here would be a parameter nobody tuned, sitting in a scored path,
// looking exactly like one somebody did. So the age is carried into the
// reported outcome, where it can be measured, and it contributes nothing to the
// number. The distribution is what observe mode exists to learn; the curve is
// what step 2 exists to fit.

import type { EnrichmentAssessment, FacetFinding } from './port.ts';

/**
 * A risk reading in integer basis points.
 *
 * BRANDED SO IT CANNOT BE PASSED WHERE A SEVERITY IS MEANT. `risk_flags.severity`
 * is `smallint CHECK (severity BETWEEN 1 AND 5)` and ADR-040's
 * `G-HOLD-REQUIRED` holds a payout on an unresolved flag at 4 or above, so the
 * two numbers live one implicit conversion apart and one of them is a gate on
 * money. There is no function in this package that converts between them.
 */
export type RiskBp = number & { readonly __brand: 'RiskBp' };

/** The top of the scale. `identity_links.confidence_bp` is CHECKed to the same bound. */
export const SCORE_SCALE_BP = 10000;

/** What one finding contributed, or why it contributed nothing. */
export interface ReadingTally {
  /** Readings that produced a number. The score's denominator. */
  readonly scored: number;
  /** Readings the vendor did not answer. Rule 2, excluded rather than defaulted. */
  readonly unknown: number;
  /**
   * Readings the vendor answered with something outside the scale.
   *
   * TREATED AS UNKNOWN RATHER THAN CLAMPED, and counted separately so it is
   * visible. Clamping a reputation of 40000 to 10000 would let a vendor's units
   * change under Merit without anything saying so; discarding it and reporting
   * the count says so on the first checkout after the change.
   */
  readonly refused: number;
}

/**
 * The score, or the honest absence of one.
 *
 * A UNION RATHER THAN A NULLABLE NUMBER, so a caller cannot reach `riskBp`
 * without having handled the case where the vendor answered nothing usable.
 */
export type FootprintScore =
  | { readonly kind: 'scored'; readonly riskBp: RiskBp; readonly readings: ReadingTally }
  | { readonly kind: 'unscored'; readonly readings: ReadingTally };

/** An integer in `[0, SCORE_SCALE_BP]`, which is the only shape a reading may take. */
function isReadingBp(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= SCORE_SCALE_BP;
}

/**
 * The risk readings one finding contributes, each already in basis points.
 *
 * THREE READINGS AND NOT ONE, because a finding carries three independent facts
 * and averaging them inside the finding would weight a facet by how much the
 * vendor happened to know about it.
 */
function readingsOf(
  finding: FacetFinding,
  tally: { scored: number[]; refused: number; unknown: number },
): void {
  const reputation = finding.reputationBp;
  if (reputation === null) {
    tally.unknown += 1;
  } else if (!isReadingBp(reputation)) {
    tally.refused += 1;
  } else {
    // REPUTATION INVERTED. The vendor reports how reputable a facet is and this
    // file reports how risky it is, and the inversion happens once, here, so
    // nothing downstream has to remember which direction it holds.
    tally.scored.push(SCORE_SCALE_BP - reputation);
  }

  if (finding.footprintPresent === null) {
    tally.unknown += 1;
  } else {
    // `false` IS THE VENDOR HAVING LOOKED AND FOUND NOTHING, which is a maximal
    // reading. `true` is a presence and says nothing about its quality, which
    // `reputationBp` is for, so it reads as zero rather than as reassurance.
    tally.scored.push(finding.footprintPresent ? 0 : SCORE_SCALE_BP);
  }

  if (finding.datacenter === null) {
    tally.unknown += 1;
  } else {
    tally.scored.push(finding.datacenter ? SCORE_SCALE_BP : 0);
  }
}

/**
 * Score one assessment.
 *
 * PURE, TOTAL AND DETERMINISTIC. It reads no clock, opens nothing, throws
 * nothing and returns the same value for the same findings, which is what lets
 * `observe.ts` treat everything that CAN fail as the vendor call and nothing
 * else.
 *
 * THE MEAN IS TRUNCATED AND NOT ROUNDED. Truncation loses at most one basis
 * point out of ten thousand and it is the one form of division with no float in
 * it. Rounding would need a half, and a half is a decimal literal in a path
 * whose whole discipline is that there are none.
 */
export function scoreAssessment(assessment: EnrichmentAssessment): FootprintScore {
  const tally = { scored: [] as number[], refused: 0, unknown: 0 };
  for (const finding of assessment.findings) readingsOf(finding, tally);

  const readings: ReadingTally = {
    scored: tally.scored.length,
    unknown: tally.unknown,
    refused: tally.refused,
  };
  if (tally.scored.length === 0) return { kind: 'unscored', readings };

  let total = 0;
  for (const reading of tally.scored) total += reading;
  const riskBp = Math.trunc(total / tally.scored.length) as RiskBp;
  return { kind: 'scored', riskBp, readings };
}
