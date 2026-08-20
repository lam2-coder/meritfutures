// =============================================================================
// packages/harness/src/types.ts
// =============================================================================
// THE HARNESS'S VOCABULARY, and the list of things it refuses to know is the
// interesting half of this file, exactly as it is one package over in
// `rithmic/src/simulator/types.ts`.
//
//   it does not know     a plan parameter, a gate, a breach, an eligibility, a
//                        payout amount, a calibration band, a price, a cost, or
//                        what today's date is
//   it is TOLD           a resolved plan, a population spec, the sessions, the
//                        contract specs, the behavioural knobs, the calibration
//                        source with its bands, and the commercial inputs
//
// Two rules land on that split and they point the same way.
//
//   1. `INV-M21-09`, which is SIMULATION_HARNESS section 4 inherited verbatim:
//      "the simulation contains no line that decides a gate, a breach, an
//      eligibility or a payout amount. It generates balances and fills and READS
//      OUTCOMES." Where the population needs to know whether a payout is
//      available, it ASKS THE ENGINE, exactly as the portal does.
//   2. `INV-M21-10` and STATE's standing parameter ruling: plan parameters are
//      launch candidates and are "rows in `plan_version_sizes`, never
//      constants". A harness with `150_000n` in it has made one a constant in
//      the one place nobody looks for plan configuration.
//
// SO EVERY NUMBER IN A RUN ARRIVES THROUGH ONE OF THE INTERFACES BELOW. There is
// no default anywhere in this package, and a caller that forgets a knob gets a
// type error rather than a plausible run.
// =============================================================================

import type {
  AssertionFailure,
  BreachKind,
  CalendarSlice,
  Cents,
  ClampReason,
  ExternalGates,
  ResolvedPlan,
  RuleState,
} from '@merit/rules-engine';
import type { ContractSpec, PopulationSpec, SimAccount, SimSession } from '@merit/rithmic';
import type { Ratio } from './ratio.js';
import type { CalibrationSource, Provenance } from './provenance.js';

// -----------------------------------------------------------------------------
// What the population does, beyond what the day model already draws
// -----------------------------------------------------------------------------
// `PopulationSpec` in `@merit/rithmic` covers the TRADING behaviour: how often an
// account trades, how large, with what drift and dispersion. What it cannot
// cover is behaviour toward MERIT rather than toward the market, because the
// simulator has no notion of a payout. That is this record.

/**
 * WHEN A TRADER ASKS, WHICH `AS-08` MAKES A STRATEGY RATHER THAN A DRAW.
 *
 * M01 `AS-08` (peak picking) is a direct requirement on this package and it is
 * worth quoting rather than summarising: "the trader chooses which day to
 * request on. A volatile account will systematically request on a local maximum.
 * The firm therefore never pays the average of a trader's equity curve; IT PAYS
 * THE TRADER'S CHOSEN PEAK, every time, across every account." Its counter is
 * not a rule and none is wanted, because waiting for a good day is not abuse:
 * "the counter is that the simulation harness must model REQUEST TIMING AS A
 * STRATEGY, not as a random draw, or the CVaR99 estimate that drives the reserve
 * is BIASED LOW. This is a direct requirement on the Monte Carlo port."
 *
 * So there are three policies and the random one is kept rather than deleted:
 * M01 section 8.3 requires the estimate to be "reported under both policies SO
 * THE BIAS IS MEASURED rather than assumed", which needs both to be runnable.
 * `run.ts`'s sweep is how a caller runs the pair.
 *
 * NONE OF THE THREE DECIDES AN AMOUNT. Each decides only whether the trader asks
 * on a day the ENGINE has already ruled eligible, and the engine's own published
 * figures are what the strategy reads, exactly as the portal renders them to the
 * trader.
 */
export type RequestPolicy =
  /**
   * Ask on the first eligible day. `PP-09`'s funding baseline, "100 percent,
   * immediately" (SIMULATION_HARNESS section 2.3), which is the PESSIMISTIC
   * cash-flow case and therefore the one the wallet is funded against.
   */
  | { readonly kind: 'immediate' }
  /**
   * Ask with a fixed probability on each eligible day.
   *
   * THIS IS THE POLICY `AS-08` NAMES AS BIASED LOW, and it is here so the bias
   * can be measured against `peak_picking` rather than assumed. A run that uses
   * only this one is the run `AS-08` warns about.
   */
  | { readonly kind: 'random'; readonly chanceBp: number }
  /**
   * Wait for a local maximum, USING ONLY WHAT HAS ALREADY HAPPENED.
   *
   * The trader observes the payable amount on each eligible day and asks on the
   * first day that sets a new high over the days observed since becoming
   * eligible, giving up and asking anyway after `patienceTradingDays` eligible
   * days. NO LOOKAHEAD: a policy that peeked at tomorrow's close would model a
   * clairvoyant trader and overstate the premium, which is a different error
   * from the one `AS-08` is about.
   *
   * At the cap the strategy asks immediately, on `AS-08`'s own reasoning that
   * the premium "is not exploitable beyond the cap": more waiting cannot raise a
   * clamped figure and can only lose the account to a breach.
   *
   * `patienceTradingDays: 1` reduces to `immediate`, which is the property that
   * makes the two comparable.
   */
  | { readonly kind: 'peak_picking'; readonly patienceTradingDays: number };

/**
 * The behaviour a trial applies on top of the day model. All caller-supplied.
 *
 * NONE OF THESE DECIDES A RULE. `requestPolicy` decides whether the trader ASKS,
 * and the engine decides whether the answer is yes and for how much;
 * `settlementLagTradingDays` is when the money moves, which is `M05`'s fact and
 * never the engine's; the risk-up pair changes what the account TRADES, which is
 * the simulator's input and not a rule.
 */
export interface TrialBehaviour {
  /** `PP-09` and `AS-08`. When the trader asks, given that the engine says yes. */
  readonly requestPolicy: RequestPolicy;
  /**
   * Trading days between the basis day and the day the withdrawal lands on the
   * platform balance. At least 1.
   *
   * AT LEAST 1 IS ARITHMETIC AND NOT A POLICY. The basis day's mark is already
   * folded when the request is evaluated (`R-06`: every evaluation is against
   * the last closed day), and a settlement is applied at DO-2 of the day whose
   * `effectiveTradingDay` it carries. A lag of zero would ask the fold to apply
   * a settlement to a day it has already closed.
   *
   * `plan_versions.rules.phase_funded.min_settlement_lag_trading_days` is the
   * published configuration constant this models, at ADR-019's v1 value; it is
   * not on `ResolvedPlan`, so it arrives here as the caller's number rather than
   * being read off a plan the engine does not carry it on.
   */
  readonly settlementLagTradingDays: number;
  /**
   * `PP-05`. Share of the population, in basis points, that risks up after its
   * first settled payout.
   *
   * Constitution section 5.3 names this behaviour explicitly and
   * SIMULATION_HARNESS restates the consequence of dropping it: "it is the
   * behavior that produces the post-payout breach cluster, and a harness without
   * it UNDER-PRODUCES BREACHES AND OVER-PRODUCES LIABILITY". `RE-S-10` is the
   * band that reads it back: a flat breach profile across cycles means the run
   * modelled constant sizing.
   */
  readonly riskUpShareBp: number;
  /**
   * `PP-05`'s magnitude: what risking up does to the account's `quantityMax`, in
   * basis points of the drawn value. `10_000` leaves it unchanged.
   *
   * IT SCALES A CONTRACT COUNT AND NEVER A MONEY VALUE. The result is floored to
   * an integer and never below 1, because a position size of zero is an account
   * that stopped trading rather than one that risked up.
   */
  readonly riskUpQuantityBp: number;
}

/**
 * The commercial inputs a contribution figure needs, all caller-supplied.
 *
 * THE COST STACK IS NOT IN THIS REPOSITORY AND THIS RECORD IS WHERE THAT SHOWS.
 * `research/calibration/mc_lifecycle.py` carries `price`, `disc` and `rebuys`
 * per plan and computes no contribution line; the [calibration
 * README](../../../research/calibration/README.md) records that the cost stack
 * is a TAB OF THE WORKBOOK, which is an `.xlsx` and not a model this harness can
 * re-run. So the harness takes the commercial terms as data and names them,
 * rather than reproducing a margin figure from a model it does not have.
 *
 * What that means for a reader comparing a run against SIMULATION_HARNESS
 * section 9.2's contribution-margin column: THE COLUMN IS NOT REPRODUCIBLE FROM
 * THIS PACKAGE ALONE, and it is not because a number is wrong here. It is
 * because the cost model that produced it lives in a spreadsheet. That is
 * recorded rather than papered over.
 */
export interface CommercialInputs {
  /** `M21` requirement (b): margin AT THE ENTERED PRICE. The caller enters it. */
  readonly pricePerPurchaseCents: Cents;
  /** Discount off the list price, in basis points. `0` for none. */
  readonly discountBp: number;
  /**
   * Purchases per buyer over a lifetime, as an exact rational: `mc_lifecycle`'s
   * `rebuys`. `3.0` is `{ numerator: 3n, denominator: 1n }`.
   *
   * IT DOES NOT MOVE THE MARGIN AND IT DOES MOVE THE CONTRIBUTION, which is
   * worth knowing before reading either: margin is a ratio of two figures that
   * both scale with it.
   */
  readonly purchasesPerBuyer: Ratio;
  /**
   * Variable cost Merit carries per FUNDED account over its life: platform
   * seats, data, and anything else that scales with a funded account rather than
   * with a purchase. `0n` states an explicit "not modelled" rather than leaving
   * the term out.
   */
  readonly variableCostPerFundedAccountCents: Cents;
}

// -----------------------------------------------------------------------------
// One trial: one purchased account, from open to breach, graduation or the end
// of the window
// -----------------------------------------------------------------------------

/** How a trial ended. */
export type TrialOutcome =
  /** The window ran out with the account still active. */
  | 'trading'
  /** `R-24`. Terminal, and no state advances after it. */
  | 'breached'
  /** `R-49`. The ladder finished and the account is closed. */
  | 'graduated'
  /** The fold refused a day (`FM-05`). No state was written and the trial stops. */
  | 'refused';

/**
 * One settled payout, as the ENGINE decided it.
 *
 * EVERY CENTS FIELD HERE CAME OUT OF `evaluatePayout` AND NONE WAS COMPUTED BY
 * THIS PACKAGE. `approvedCents` is `maxPayoutCents` at a request with no amount,
 * which ADR-009 defines as "pay the maximum I am eligible for"; the split legs
 * are `R-44`'s, computed by the engine's clamp with the remainder to the trader.
 * The harness records them.
 */
export interface SettledPayout {
  /** `R-45`. `payoutsSettledCount + 1` at request time. */
  readonly ordinal: number;
  /** `R-46`. What the decision was computed against. */
  readonly basisTradingDay: string;
  /** `SD-03`. First trading day whose opening balance reflects the withdrawal. */
  readonly effectiveTradingDay: string;
  /** Gross. What left the account, and what `lifetimeSettledCents` accumulates. */
  readonly approvedCents: Cents;
  /** `R-44`. The trader's leg, which is the firm's cash outflow. */
  readonly traderCents: Cents;
  /** `R-44`. `approved - trader`, a subtraction and never a second rounding. */
  readonly firmCents: Cents;
  /** `R-42`'s rung for this ordinal. */
  readonly capCents: Cents;
  readonly clampReason: ClampReason;
  /**
   * Trading days in the extraction cycle this payout ended, counted by SEQUENCE
   * SUBTRACTION over the calendar (`AS-06`: never a date difference).
   *
   * The cycle runs from `cycleFirstTradingDay` through `basisTradingDay`
   * inclusive. For the first payout it opens on the account's first funded
   * trading day; afterwards it opens on the day after the previous basis day,
   * which is the window `R-34` counts win days over and `R-47` restarts the
   * consistency period on. It is `RE-S-05`'s denominator.
   */
  readonly cycleTradingDays: number;
  readonly cycleFirstTradingDay: string;
  /**
   * Eligible days that passed before the trader asked, this one included.
   *
   * `AS-08`'s PREMIUM IS THE MEASURABLE HALF OF THE POLICY. "The premium is the
   * expected value of `max` over the window a trader is willing to wait, minus
   * the mean", so a run under `immediate` reports `1` on every payout and a run
   * under `peak_picking` reports the wait that produced the figure beside it.
   * Without this the two policies produce two liability numbers and nothing that
   * says why they differ.
   */
  readonly eligibleDaysWaited: number;
}

/** One account's whole life, and what the engine said at every step of it. */
export interface Trial {
  readonly platformAccountRef: string;
  readonly sizeLabel: string;
  readonly sizeCents: Cents;
  readonly outcome: TrialOutcome;
  /** `false` on a plan with no evaluation phase, which is Direct. */
  readonly startedInEval: boolean;
  readonly passedEvalOn: string | null;
  /** True for an account that ever held the funded phase, however it ended. */
  readonly reachedFunded: boolean;
  /** The first day the account TRADED as funded, which is the day after a pass. */
  readonly firstFundedTradingDay: string | null;
  readonly breachedOn: string | null;
  readonly breachKind: BreachKind | null;
  readonly graduatedOn: string | null;
  readonly payouts: readonly SettledPayout[];
  /** `R-50`, from the engine's own accumulator. Gross. */
  readonly lifetimeSettledCents: Cents;
  /** The sum of the trader legs. The firm's lifetime cash outflow on this account. */
  readonly lifetimeTraderCents: Cents;
  /** Days the fold accepted. A refused day is not one of them. */
  readonly tradingDaysObserved: number;
  /** `PP-05`. This account was drawn into the risk-up cohort. */
  readonly inRiskUpCohort: boolean;
  /**
   * Requests the engine approved that never settled. `0` or `1`.
   *
   * TWO WAYS TO GET ONE, AND BOTH ARE REPORTED RATHER THAN DROPPED. The window
   * can end before the effective day arrives, and the account can breach or have
   * a day refused while a request is in flight. A harness that silently
   * discarded either would under-report liability by exactly the amount nobody
   * could see, and the second case is a real one: `GS-064` is breach and payout
   * eligibility on the same day.
   *
   * It is never more than one because `R-38` blocks a second request while an
   * external leg is outstanding, and the trial loop supplies that fact rather
   * than deciding it. `trial.ts` throws if a second is ever queued.
   */
  readonly approvedRequestsNeverSettled: number;
  /** The finding, on a trial that ended `refused`. */
  readonly refusal: AssertionFailure | null;
  /** The last state the fold wrote. `null` only if the very first day refused. */
  readonly finalState: RuleState | null;
}

/** What one trial is handed. Every field is the caller's. */
export interface TrialInput {
  readonly seed: string;
  readonly engineVersion: string;
  readonly plan: ResolvedPlan;
  /** One account out of `buildPopulation`. Built by the caller, never here. */
  readonly account: SimAccount;
  readonly sessions: readonly SimSession[];
  readonly specs: readonly ContractSpec[];
  /**
   * The slice the whole run shares, built once by `run.ts`.
   *
   * ONE SLICE FOR EVERY TRIAL, WHICH IS WHAT MAKES THE SEQUENCES COMPARABLE.
   * `R-37` counts a cadence gap by sequence subtraction, and two accounts folded
   * against two slices with different `sequenceBase` values would be counting on
   * two different rulers.
   */
  readonly calendar: CalendarSlice;
  readonly behaviour: TrialBehaviour;
  /**
   * `R-40`'s gates, the caller's to resolve (`INV-23`).
   *
   * `hasPayoutInFlight` IS THE ONE FIELD THE TRIAL LOOP OVERRIDES, upward only,
   * and `trial.ts` says why: while a settlement is pending, the identity HAS an
   * outstanding external leg, and supplying the fact is the caller's job while
   * deciding what it means is `R-38`'s.
   */
  readonly context: ExternalGates;
}

// -----------------------------------------------------------------------------
// What a run is handed and what it returns
// -----------------------------------------------------------------------------

export interface HarnessRunInput {
  readonly seed: string;
  readonly engineVersion: string;
  readonly plan: ResolvedPlan;
  /**
   * The population, as `@merit/rithmic` defines it.
   *
   * ITS `seed` AND THE RUN'S `seed` ARE BOTH REQUIRED AND ARE NOT THE SAME KNOB.
   * `PopulationSpec.seed` draws WHO the accounts are; the run seed draws what
   * they DO. A sweep that wants the same traders under two configurations holds
   * the first fixed and varies the second, and a run that wants a fresh
   * population moves the first.
   */
  readonly population: PopulationSpec;
  readonly sessions: readonly SimSession[];
  readonly specs: readonly ContractSpec[];
  /** Where the run's sessions sit in the caller's calendar. `R-37` counts on it. */
  readonly sequenceBase: number;
  /** `R-03`. Days the caller declares half days, by `tradingDay`. */
  readonly halfDays?: ReadonlySet<string>;
  /** `R-04`. Days the caller declares halted, by `tradingDay`. */
  readonly haltedDays?: ReadonlySet<string>;
  readonly behaviour: TrialBehaviour;
  readonly commercial: CommercialInputs;
  readonly context: ExternalGates;
  readonly calibration: CalibrationSource;
}

/** The units an output is stated in. Integers throughout. */
export type OutputUnit =
  'basis_points' | 'cents' | 'count_per_10000' | 'cents_per_trading_day' | 'count';

/**
 * `SIMULATION_HARNESS` section 5's identifiers, for the outputs that have one.
 *
 * FIVE OF `M21`'s EIGHT REQUIREMENT (b) OUTPUTS ALREADY CARRY AN IDENTIFIER and
 * three do not, which is `M21` section 3.2's own finding. The three are carried
 * on `proposedRegistryId` and are NOT claimed here; see `outputs.ts`.
 */
export type RegistryId = 'RE-S-01' | 'RE-S-02' | 'RE-S-03' | 'RE-S-05' | 'RE-S-06';

/** `OQ-M21-03`'s proposal, which this session does not execute. See `outputs.ts`. */
export type ProposedRegistryId = 'HO-09' | 'HO-10' | 'HO-11';

/**
 * One output, with its provenance attached rather than beside it.
 *
 * `value: null` MEANS NOT MEASURED AND NEVER MEANS ZERO. `HO-07` states the rule
 * for the correlation estimator and it generalises: "the field is ABSENT rather
 * than zero, because a zero here would read as 'no correlation measured'".
 * `sampleSize` is the denominator this output was computed over, which is
 * `INV-M21-04`'s requirement and `AS-M21-02`'s early warning.
 */
export interface OutputRecord {
  readonly key: string;
  readonly label: string;
  readonly registryId: RegistryId | null;
  readonly proposedRegistryId: ProposedRegistryId | null;
  readonly unit: OutputUnit;
  /** The exact pair. `null` when there was no sample to compute it over. */
  readonly value: Ratio | null;
  /** The denominator. Zero exactly when `value` is null. */
  readonly sampleSize: number;
  /** What the figure means, and what it does not. Read by a human. */
  readonly note: string;
  readonly provenance: Provenance;
}

/** `HO-01`. One band, with the realized value that was compared against it. */
export interface BandResult {
  readonly bandId: string;
  readonly label: string;
  readonly outputKey: string;
  /** `null` when the output had no sample, which is neither a pass nor a fail. */
  readonly realized: bigint | null;
  readonly minimum: bigint | null;
  readonly maximum: bigint | null;
  readonly central: bigint | null;
  readonly sampleSize: number;
  /** `'not_measured'` is a third verdict and is deliberately not `'fail'`. */
  readonly verdict: 'pass' | 'fail' | 'not_measured';
  readonly detail: string;
}

/** The funnel counts every rate in the aggregate is a ratio of. */
export interface FunnelCounts {
  readonly trials: number;
  readonly startedInEval: number;
  readonly reachedFunded: number;
  readonly payers: number;
  readonly breached: number;
  readonly graduated: number;
  readonly refused: number;
  readonly settledPayouts: number;
  readonly approvedRequestsNeverSettled: number;
}

/** Every figure a run produces, each with its own provenance and sample size. */
export interface Aggregate {
  readonly provenance: Provenance;
  readonly counts: FunnelCounts;
  readonly outputs: readonly OutputRecord[];
  /** `RE-S-06`'s hard assertion, which is a fail rather than a band miss. */
  readonly lifetimeBound: LifetimeBoundResult;
}

/**
 * `RE-S-06`. "Lifetime extraction per account never exceeds `max_payouts * cap`.
 * HARD ASSERTION, NOT A BAND."
 *
 * `INV-17` is the invariant and this is the harness's check of it. It reads two
 * plan parameters, which `assertions.ts` is the only file in this package
 * permitted to do, and it decides nothing: it compares a number the engine
 * produced against a bound the published plan states.
 */
export interface LifetimeBoundResult {
  readonly boundCents: Cents;
  readonly observedMaximumCents: Cents;
  readonly observedMaximumTraderCents: Cents;
  readonly holds: boolean;
  readonly detail: string;
  readonly sampleSize: number;
}

/** One run: the trials, what they aggregate to, and the bands they were checked against. */
export interface HarnessRun {
  readonly provenance: Provenance;
  readonly trials: readonly Trial[];
  readonly aggregate: Aggregate;
  readonly bands: readonly BandResult[];
}
