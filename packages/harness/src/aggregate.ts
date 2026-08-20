// =============================================================================
// packages/harness/src/aggregate.ts
// =============================================================================
// THE AGGREGATOR. Trials in, M21 requirement (b)'s eight outputs out, every one
// of them carrying its own provenance and its own sample size.
//
// -----------------------------------------------------------------------------
// EVERY FIGURE IS A RATIO OF TWO COUNTS THAT ARE BOTH REPORTED
// -----------------------------------------------------------------------------
// A rate whose denominator is not on the page is a rate nobody can check, and on
// a funnel the denominators are the whole argument: pass rate is over accounts
// that STARTED IN EVAL, funded-to-payout is over accounts that REACHED FUNDED,
// and payouts per payer is over accounts that WERE PAID. Those are three
// different populations, they shrink in that order, and `FunnelCounts` carries
// all of them so a reader can see the shrinkage rather than infer it.
//
// `AS-M21-02` is the failure this is aimed at: "a sensitivity sweep run at a
// sample size too small to separate the arms, read as a signal". It cannot be
// prevented by arithmetic. It can be made visible, and a denominator on the
// result is what makes it visible.
//
// -----------------------------------------------------------------------------
// AN OUTPUT WITH NO SAMPLE IS ABSENT AND IS NEVER ZERO
// -----------------------------------------------------------------------------
// `HO-07` states the rule for the correlation estimator: "the field is ABSENT
// rather than zero, because a zero here would read as 'no correlation
// measured'". It generalises to every output here, and the two places it bites
// are worth naming because both look like they want a number:
//
//   a plan with no eval phase      Direct funds on purchase, so there is no
//                                  evaluation pass rate to measure. 100 percent
//                                  is the calibration source's CONVENTION and
//                                  not an observation
//   a run with no payer            payouts per payer over zero payers is not
//                                  "zero payouts per payer", it is nothing
//
// -----------------------------------------------------------------------------
// AND NO FLOAT, INCLUDING HERE
// -----------------------------------------------------------------------------
// `ratio.ts` carries the argument. The short version is that a mean is a
// division, and the aggregate is the one place a division of two integers is
// guaranteed to happen on a money value.
// =============================================================================

import type { Cents, ResolvedPlan } from '@merit/rules-engine';
import type { Provenance } from './provenance.js';
import { outputDefinition } from './outputs.js';
import type { Ratio } from './ratio.js';
import { compare, fromInteger, multiply, ratio, subtract } from './ratio.js';
import { checkLifetimeBound } from './assertions.js';
import type {
  Aggregate,
  CommercialInputs,
  FunnelCounts,
  OutputKey,
  OutputRecord,
  Trial,
} from './types.js';

/** Thrown when an aggregate cannot be computed as specified. */
export class AggregateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AggregateError';
  }
}

/** Build one output record from the catalogue entry and a value that may be absent. */
function record(
  key: OutputKey,
  value: Ratio | null,
  sampleSize: number,
  provenance: Provenance,
): OutputRecord {
  const definition = outputDefinition(key);
  if ((value === null) !== (sampleSize === 0)) {
    // THE TWO ARE ONE FACT AND THEY ARE CHECKED AGAINST EACH OTHER. A value with
    // no sample is a number from nowhere, and a sample with no value is a
    // denominator nobody divided by. Either one alone would make `INV-M21-04`'s
    // required pair a pair of fields rather than a pair of facts.
    throw new AggregateError(
      `${key} carries ${value === null ? 'no value' : 'a value'} with a sample size of ` +
        `${String(sampleSize)}. An absent value and a zero sample are the same fact`,
    );
  }
  return {
    key: definition.key,
    label: definition.label,
    registryId: definition.registryId,
    proposedRegistryId: definition.proposedRegistryId,
    unit: definition.unit,
    value,
    sampleSize,
    note: definition.note,
    provenance,
  };
}

/** A rate, or `null` when the denominator is empty. */
function rateOrAbsent(numerator: number, denominator: number): Ratio | null {
  if (denominator === 0) return null;
  return ratio(BigInt(numerator), BigInt(denominator));
}

/** A mean over cents, or `null` when there is nothing to average. */
function meanCentsOrAbsent(totalCents: Cents, count: number): Ratio | null {
  if (count === 0) return null;
  return ratio(totalCents, BigInt(count));
}

/** Validate the commercial terms. A malformed price is refused, never repaired. */
export function checkCommercial(commercial: CommercialInputs): void {
  if (commercial.pricePerPurchaseCents < 0n) {
    throw new AggregateError('pricePerPurchaseCents cannot be negative');
  }
  if (
    !Number.isSafeInteger(commercial.discountBp) ||
    commercial.discountBp < 0 ||
    commercial.discountBp > 10_000
  ) {
    throw new AggregateError(
      `discountBp ${String(commercial.discountBp)} is not a basis-point share in 0..10000`,
    );
  }
  if (commercial.purchasesPerBuyer.numerator <= 0n) {
    throw new AggregateError(
      'purchasesPerBuyer must be positive. A buyer who buys nothing is not in the population',
    );
  }
  if (commercial.variableCostPerFundedAccountCents < 0n) {
    throw new AggregateError(
      'variableCostPerFundedAccountCents cannot be negative. A cost that pays Merit is revenue ' +
        'and belongs in the price',
    );
  }
}

/** The funnel, counted once so every rate below divides two numbers a reader can see. */
export function funnelCounts(trials: readonly Trial[]): FunnelCounts {
  let startedInEval = 0;
  let reachedFunded = 0;
  let payers = 0;
  let breached = 0;
  let graduated = 0;
  let refused = 0;
  let settledPayouts = 0;
  let approvedRequestsNeverSettled = 0;
  for (const trial of trials) {
    if (trial.startedInEval) startedInEval += 1;
    if (trial.reachedFunded) reachedFunded += 1;
    if (trial.payouts.length > 0) payers += 1;
    if (trial.outcome === 'breached') breached += 1;
    if (trial.outcome === 'graduated') graduated += 1;
    if (trial.outcome === 'refused') refused += 1;
    settledPayouts += trial.payouts.length;
    approvedRequestsNeverSettled += trial.approvedRequestsNeverSettled;
  }
  return {
    trials: trials.length,
    startedInEval,
    reachedFunded,
    payers,
    breached,
    graduated,
    refused,
    settledPayouts,
    approvedRequestsNeverSettled,
  };
}

/**
 * `RE-S-05`. The largest extraction RATE any single cycle reached.
 *
 * A MAXIMUM OVER EXACT RATES AND NOT OVER ROUNDINGS. `compare` cross-multiplies,
 * so 135,000c over 5 trading days and 27,000c over 1 are recognised as the same
 * rate; a comparison over cents-per-day integers would have made the answer
 * depend on which cycles happened to divide evenly.
 *
 * THE NUMERATOR IS THE TRADER LEG. Section 6 states the ceiling of record as
 * "Merit Rapid 30,000c, Core EOD and Direct 27,000c", and those are `cap * split
 * / cycle`: 150,000c at 9000bp over 5 trading days is 27,000c. Using the gross
 * approved amount would report 30,000c on Core EOD and look like a divergence
 * from a figure it does not describe.
 */
function perDayExtractionCeiling(trials: readonly Trial[]): {
  readonly value: Ratio | null;
  readonly sampleSize: number;
} {
  let best: Ratio | null = null;
  let sampleSize = 0;
  for (const trial of trials) {
    for (const payout of trial.payouts) {
      if (payout.cycleTradingDays < 1) {
        throw new AggregateError(
          `${trial.platformAccountRef} settled a payout over ${String(payout.cycleTradingDays)} ` +
            'trading days. A rate over a non-positive span is not a rate',
        );
      }
      sampleSize += 1;
      const rate = ratio(payout.traderCents, BigInt(payout.cycleTradingDays));
      if (best === null || compare(rate, best) > 0) best = rate;
    }
  }
  return { value: best, sampleSize };
}

/**
 * `HO-10` and `HO-11` as proposed, from terms the caller entered.
 *
 * THE MODEL IS WRITTEN OUT HERE BECAUSE IT IS NOT INHERITED FROM ANYWHERE. The
 * calibration source computes no contribution line and the workbook's cost stack
 * is a spreadsheet tab, so this is a stated model over caller inputs rather than
 * a port of one:
 *
 *     net price          = price * (10000 - discount_bp) / 10000
 *     liability/account  = total trader legs / trials
 *     variable/account   = variable cost per funded * funded / trials
 *     contribution/acct  = net price - liability/account - variable/account
 *     contribution/buyer = contribution/account * purchases per buyer
 *     margin             = contribution/account / net price
 *
 * MARGIN DOES NOT MOVE WITH PURCHASES PER BUYER, because both of its terms scale
 * with it, and that is worth knowing before reading either figure: a rebuy
 * assumption changes the size of the business and not the shape of a unit.
 *
 * THE DENOMINATOR IS TRIALS AND NOT FUNDED ACCOUNTS. A buyer pays for an account
 * whether or not it ever funds, so the liability a purchase carries is the
 * population's average and not the funded cohort's. `liability_per_funded_
 * account` is the other figure and it is reported separately.
 */
function contributionAtPrice(
  trials: readonly Trial[],
  counts: FunnelCounts,
  commercial: CommercialInputs,
  totalTraderCents: Cents,
): {
  readonly contributionPerBuyer: Ratio | null;
  readonly marginBp: Ratio | null;
  readonly sampleSize: number;
} {
  if (counts.trials === 0) return { contributionPerBuyer: null, marginBp: null, sampleSize: 0 };
  const trialCount = BigInt(counts.trials);

  const netPricePerPurchase = ratio(
    commercial.pricePerPurchaseCents * BigInt(10_000 - commercial.discountBp),
    10_000n,
  );
  const liabilityPerAccount = ratio(totalTraderCents, trialCount);
  const variablePerAccount = ratio(
    commercial.variableCostPerFundedAccountCents * BigInt(counts.reachedFunded),
    trialCount,
  );
  const contributionPerAccount = subtract(
    subtract(netPricePerPurchase, liabilityPerAccount),
    variablePerAccount,
  );

  return {
    contributionPerBuyer: multiply(contributionPerAccount, commercial.purchasesPerBuyer),
    // A margin against a price of zero is a division by zero and is reported as
    // absent, which is the same rule every other output follows. A free plan has
    // no margin rather than an infinite one.
    marginBp:
      netPricePerPurchase.numerator === 0n
        ? null
        : ratio(
            contributionPerAccount.numerator * netPricePerPurchase.denominator,
            contributionPerAccount.denominator * netPricePerPurchase.numerator,
          ),
    sampleSize: trials.length,
  };
}

/** Everything a run produces, from the trials it produced them from. */
export function aggregate(input: {
  readonly trials: readonly Trial[];
  readonly plan: ResolvedPlan;
  readonly commercial: CommercialInputs;
  readonly provenance: Provenance;
}): Aggregate {
  const { trials, plan, commercial, provenance } = input;
  checkCommercial(commercial);

  const counts = funnelCounts(trials);

  let totalTraderCents = 0n;
  let maximumLifetimeCents = 0n;
  for (const trial of trials) {
    totalTraderCents += trial.lifetimeTraderCents;
    if (trial.lifetimeSettledCents > maximumLifetimeCents) {
      maximumLifetimeCents = trial.lifetimeSettledCents;
    }
  }

  const passedFromEval = trials.filter(
    (trial) => trial.startedInEval && trial.reachedFunded,
  ).length;
  const ceiling = perDayExtractionCeiling(trials);
  const commercialFigures = contributionAtPrice(trials, counts, commercial, totalTraderCents);

  const outputs: readonly OutputRecord[] = [
    record(
      'evaluation_pass_rate',
      rateOrAbsent(passedFromEval, counts.startedInEval),
      counts.startedInEval,
      provenance,
    ),
    record(
      'funded_to_payout_rate',
      rateOrAbsent(counts.payers, counts.reachedFunded),
      counts.reachedFunded,
      provenance,
    ),
    record(
      'payouts_per_payer',
      rateOrAbsent(counts.settledPayouts, counts.payers),
      counts.payers,
      provenance,
    ),
    record(
      'liability_per_funded_account',
      meanCentsOrAbsent(totalTraderCents, counts.reachedFunded),
      counts.reachedFunded,
      provenance,
    ),
    record(
      'contribution_per_buyer',
      commercialFigures.contributionPerBuyer,
      commercialFigures.contributionPerBuyer === null ? 0 : commercialFigures.sampleSize,
      provenance,
    ),
    record(
      'margin_at_price',
      commercialFigures.marginBp,
      commercialFigures.marginBp === null ? 0 : commercialFigures.sampleSize,
      provenance,
    ),
    record('per_day_extraction_ceiling', ceiling.value, ceiling.sampleSize, provenance),
    record(
      'lifetime_extraction_maximum',
      counts.reachedFunded === 0 ? null : fromInteger(maximumLifetimeCents),
      counts.reachedFunded,
      provenance,
    ),
  ];

  return {
    provenance,
    counts,
    outputs,
    lifetimeBound: checkLifetimeBound(plan, trials),
  };
}
