// =============================================================================
// packages/harness/src/outputs.ts
// =============================================================================
// THE OUTPUT CATALOGUE, AS DATA. Eight entries, which are M21 requirement (b)'s
// eight, each with its identifier or with an honest absence where it has none.
//
// -----------------------------------------------------------------------------
// FIVE HAVE IDENTIFIERS AND THREE DO NOT, AND THE THREE ARE NOT CLAIMED HERE
// -----------------------------------------------------------------------------
// M21 section 3.2's finding: "Requirement (b) names eight outputs and the
// finding of this plan is that five of them already have identifiers. They are
// not a new metric set." The five are `RE-S-01`, `02`, `03`, `05` and `06`.
//
// The three without one are liability per funded account, contribution per buyer
// and margin at the entered price. `OQ-M21-03` proposes they join
// SIMULATION_HARNESS section 7.1's `HO-nn` contract as `HO-09` to `HO-11`,
// "added by whichever session builds the harness rather than claimed here".
//
// THIS IS THAT SESSION AND IT STILL DOES NOT CLAIM THEM, for a fence reason
// rather than a judgement one: the session brief scopes this work to
// `packages/` and excludes `docs/`, and `SIMULATION_HARNESS.md` is an approved
// document whose output contract is section 7.1's table. **An identifier is
// claimed in the registry that owns it**, and writing `HO-09` into a code
// constant while section 7.1 carries eight rows would be the drift ADR-034
// exists to end, in the direction that is hardest to notice: the code would
// look authoritative.
//
// So each of the three carries `registryId: null` and `proposedRegistryId`, and
// the absence is visible on every rendered result rather than papered over with
// an invented name. The doc edit is owed and the session log records it.
//
// -----------------------------------------------------------------------------
// AND A FINDING THAT CAME OUT OF WRITING THEM DOWN
// -----------------------------------------------------------------------------
// **`liability per funded account` and `RE-S-04` appear to be one output under
// two names.** `RE-S-04` is "firm dollars per funded account, per plan", and in
// the calibration source that figure is `avg_firmcost_per_funded`, accumulated
// as `firm = firm + split * req` with the comment "firm cash outflow = trader's
// split" (`research/calibration/mc_lifecycle.py`). That is the sum of the trader
// legs over funded accounts, which is exactly the liability figure M21 lists as
// unidentified.
//
// It is REPORTED AND NOT ACTED ON. If the two are one output then `OQ-M21-03`
// needs two identifiers rather than three and `RE-S-04` is the name of the
// third; if they are two, the distinction is worth a sentence in section 7.1
// that nobody has written. Either way it is a question for the registry's owner,
// and this file's job is to make sure the collision is visible rather than
// resolved by a build session picking one. The note travels on the output.
// =============================================================================

import type { OutputKey, OutputUnit, ProposedRegistryId, RegistryId } from './types.js';

/** What an output IS, independent of any run. Data, so it can be listed and audited. */
export interface OutputDefinition {
  readonly key: OutputKey;
  readonly label: string;
  readonly registryId: RegistryId | null;
  readonly proposedRegistryId: ProposedRegistryId | null;
  readonly unit: OutputUnit;
  /** What the figure means and what it does not. Travels onto every result. */
  readonly note: string;
}

/**
 * The catalogue, in the order M21 section 3.2 lists the outputs.
 *
 * THE ORDER IS PART OF IT. A funnel read top to bottom is a funnel, and the same
 * eight numbers in an arbitrary order are eight numbers.
 */
export const OUTPUT_CATALOGUE: readonly OutputDefinition[] = Object.freeze([
  Object.freeze({
    key: 'evaluation_pass_rate' as const,
    label: 'Evaluation pass rate',
    registryId: 'RE-S-01' as const,
    proposedRegistryId: null,
    unit: 'basis_points' as const,
    note:
      'Accounts that reached the funded phase, over accounts that began in the evaluation phase. ' +
      'ON A PLAN WITH NO EVALUATION PHASE THE FIELD IS ABSENT RATHER THAN 100 PERCENT: Direct ' +
      'funds on purchase (Appendix A.3), so there is no evaluation to pass and a rate of 10000bp ' +
      'would read as a measurement. HO-07 states the rule for the correlation estimator and it ' +
      'is the same rule. The calibration source reports 100 percent for Direct, which is a ' +
      'convention of that model rather than an observation.',
  }),
  Object.freeze({
    key: 'funded_to_payout_rate' as const,
    label: 'Funded to first payout',
    registryId: 'RE-S-02' as const,
    proposedRegistryId: null,
    unit: 'basis_points' as const,
    note:
      'Funded accounts that settled at least one payout, over funded accounts. A payout the ' +
      'engine approved that never settled inside the window is NOT counted here and is counted ' +
      'on the funnel, because a rate that included it would be reporting an intention.',
  }),
  Object.freeze({
    key: 'payouts_per_payer' as const,
    label: 'Payouts per paying account',
    registryId: 'RE-S-03' as const,
    proposedRegistryId: null,
    unit: 'count_per_10000' as const,
    note:
      'Settled payouts over accounts that settled at least one. The denominator is PAYERS and ' +
      'not funded accounts, which is why the sample size on this output is the smallest in the ' +
      'run and why AS-M21-02 attaches to it first. SIMULATION_HARNESS section 9.3: mean payouts ' +
      'per payer are 1.54, 2.13 and 1.30, nowhere near any ladder length under discussion, so a ' +
      'sweep over max_payouts shows a flat line and the flat line means NO EFFECT ON THE MEAN ' +
      'rather than no effect. The ladder is tail protection.',
  }),
  Object.freeze({
    key: 'liability_per_funded_account' as const,
    label: 'Liability per funded account',
    registryId: null,
    proposedRegistryId: 'HO-09' as const,
    unit: 'cents' as const,
    note:
      'The sum of the trader legs over funded accounts: what leaves Merit per funded account, ' +
      'which is the firm cash outflow. IT MAY BE RE-S-04 UNDER ANOTHER NAME. RE-S-04 is "firm ' +
      'dollars per funded account", and the calibration source computes that figure as ' +
      'avg_firmcost_per_funded over an accumulator whose own comment reads "firm cash outflow = ' +
      'trader\'s split". If the two are one output then OQ-M21-03 needs two identifiers rather ' +
      'than three. Reported for the registry owner to rule; not resolved here.',
  }),
  Object.freeze({
    key: 'contribution_per_buyer' as const,
    label: 'Contribution per buyer',
    registryId: null,
    proposedRegistryId: 'HO-10' as const,
    unit: 'cents' as const,
    note:
      'Net revenue per buyer, less payout liability per buyer, less the variable cost per funded ' +
      "account. EVERY COMMERCIAL TERM IS THE CALLER'S and none is modelled here: the cost " +
      'stack lives in the business-model workbook, which is an .xlsx and not a model this ' +
      'harness can re-run, so SIMULATION_HARNESS section 9.2 contribution-margin column is not ' +
      'reproducible from this package alone.',
  }),
  Object.freeze({
    key: 'margin_at_price' as const,
    label: 'Contribution margin at the entered price',
    registryId: null,
    proposedRegistryId: 'HO-11' as const,
    unit: 'basis_points' as const,
    note:
      'Contribution over net revenue, at the price the caller entered. It does not move with ' +
      'purchases per buyer, because both terms scale with it; that is worth knowing before ' +
      'reading either figure. Negative is a real answer: the calibration source puts Core EOD at ' +
      '+0.25 percent and the workbook had it at negative 0.88 percent, and section 9.2 is ' +
      'explicit that Core EOD is a customer-acquisition plan whose economics live in rebuys.',
  }),
  Object.freeze({
    key: 'per_day_extraction_ceiling' as const,
    label: 'Per-day extraction at the ceiling',
    registryId: 'RE-S-05' as const,
    proposedRegistryId: null,
    unit: 'cents_per_trading_day' as const,
    note:
      'The maximum, over settled payouts, of the trader leg divided by the trading days in the ' +
      'cycle that produced it. Compared as an exact rate rather than as a rounding. ' +
      'SIMULATION_HARNESS section 6 records the ceiling of record as Merit Rapid 30,000c and ' +
      'Core EOD and Direct 27,000c at 50K, and states that "a divergence here is a harness bug ' +
      'rather than an open question". Section 6 also says the two figures are reported together: ' +
      'the lifetime bound is the one to publish and this is the rate.',
  }),
  Object.freeze({
    key: 'lifetime_extraction_maximum' as const,
    label: 'Lifetime extraction per account, observed maximum',
    registryId: 'RE-S-06' as const,
    proposedRegistryId: null,
    unit: 'cents' as const,
    note:
      'The largest lifetime gross extraction any single account reached. The BOUND it is checked ' +
      'against is a hard assertion rather than a band (INV-17) and is reported separately on the ' +
      'aggregate, because a maximum that happens to sit under a bound and a bound that holds are ' +
      'different claims.',
  }),
]);

/** Look one up. Throws rather than returning undefined: a missing output is a bug here. */
export function outputDefinition(key: OutputKey): OutputDefinition {
  const found = OUTPUT_CATALOGUE.find((definition) => definition.key === key);
  if (found === undefined) throw new Error(`no output definition for ${key}`);
  return found;
}
