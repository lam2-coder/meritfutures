// =============================================================================
// packages/harness/src/trial.ts
// =============================================================================
// THE TRIAL LOOP. One purchased account, from open to breach, graduation or the
// end of the window, through the REAL engine.
//
// SIMULATION_HARNESS section 4 draws the whole picture in four lines and this
// file is the middle two:
//
//     population model  ->  daily_marks per account per trading day
//                               |
//                               v
//                       packages/rules-engine  (the real one, unmodified)
//                               |
//                               v
//                  rule_states, eligibility, settlements
//
// -----------------------------------------------------------------------------
// THE ONE RULE THAT MAKES IT VALID, AND THE THREE PLACES IT IS EASIEST TO BREAK
// -----------------------------------------------------------------------------
// "The harness may not contain a single line that decides a gate, a breach, an
// eligibility, or a payout amount. It generates balances and fills and IT READS
// OUTCOMES. The moment it computes an eligibility itself, in order to decide
// whether to have the trader request a payout, IT HAS BECOME A SECOND
// IMPLEMENTATION OF THE ENGINE and the whole exercise tests that two things
// written by the same author agree." (`INV-M21-09`.)
//
// The three temptations, and what this file does instead:
//
//   "is this account eligible today?"      `evaluatePayout` is asked, every day,
//                                          exactly as the portal asks it
//   "how much can it take?"                `evaluation.maxPayoutCents`, which is
//                                          the engine's number and is `0n` when
//                                          the answer is no
//   "does a second request stack?"         `R-38` decides. The loop SUPPLIES the
//                                          fact that an external leg is
//                                          outstanding, which M01 section 2.1
//                                          makes the caller's job, and never the
//                                          verdict
//
// What the loop does decide is BEHAVIOUR: WHEN the trader asks (`PP-09` and
// `AS-08`), and what the account trades after its first payout (`PP-05`). Both
// are population parameters the corpus names, both are the caller's numbers, and
// neither is a rule.
//
// AND ONE OF THEM IS A REQUIREMENT RATHER THAN A KNOB. M01 `AS-08` (peak
// picking): "the simulation harness must model REQUEST TIMING AS A STRATEGY, not
// as a random draw, or the CVaR99 estimate that drives the reserve is biased
// low. This is a direct requirement on the Monte Carlo port." `decideRequest`
// below is that requirement, and the random policy survives beside it because
// M01 section 8.3 wants the estimate "reported under both policies so the bias
// is measured rather than assumed".
//
// -----------------------------------------------------------------------------
// WHY THE DAY MODEL IS DRIVEN ONE SESSION AT A TIME
// -----------------------------------------------------------------------------
// `simulate()` folds a whole window at once and carries its own balance between
// sessions. It cannot be used that way here for two reasons that are the same
// reason: the balance a day opens at depends on what MERIT did, and Merit's
// decisions are made one day at a time.
//
//   a settled payout       leaves the platform balance as a non-trading movement
//                          on its effective day (`SD-01`, `R-10`), and which day
//                          that is depends on a request the engine had not yet
//                          approved when the window started
//   an evaluation pass     re-provisions the platform account at exactly
//                          `size_cents` (`INV-M2-07`, `DEP-M2-01`), and which
//                          day that happens on is `R-26`'s answer
//
// SO THE LOOP CALLS `simulate()` ONCE PER SESSION AND CARRIES THE BALANCE
// ITSELF, AND THAT IS FREE BECAUSE THE DRAWS ARE KEYED RATHER THAN STREAMED.
// Every key in `rng.ts` is `(seed, accountRef, tradingDay, purpose)` and none of
// them is the session's index or the population's size, so a day drawn alone is
// byte-identical to the same day drawn inside a hundred-session run.
// `determinism.test.ts` asserts exactly that, because it is the property the
// whole arrangement rests on and "it looked the same" is not a control.
//
// -----------------------------------------------------------------------------
// THE RISK SETPOINT IS PUSHED, WHICH IS M2's JOB AND NOT A RULE
// -----------------------------------------------------------------------------
// M02 section 1.2: "M2 PUSHES a floor value to the vendor as a risk setting. It
// is TOLD the number; it never derives it." The engine computes the floor and
// carries it on `RuleState.floorCents`; this loop hands that number to the day
// model as the next session's auto-liquidation setpoint, which is the transport
// M2 performs and contains no arithmetic.
//
// IT MATTERS BECAUSE A STATIC SETPOINT MODELS THE WRONG FIRM. The trailing floor
// rises with every closing high (`R-13`) and a setpoint left at the population's
// opening offset drifts further below it every winning day, so the vendor stops
// liquidating anywhere near the floor the engine compares against. That produces
// a population that breaches without a liquidation record, which is `GS-087`'s
// condition presented as the normal case, and a breach rate that is wrong in the
// direction that flatters the reserve.
//
// AN UNPROTECTED ACCOUNT STAYS UNPROTECTED. `V-M2-08` and `AS-M2-03`:
// `riskMaxLossCents` is `null` for the share of accounts whose risk setting is
// unreadable or was never applied, and pushing a floor onto one of those would
// erase the condition the population was drawn to model.
// =============================================================================

import type {
  AssertionFailure,
  BreachKind,
  Cents,
  RuleState,
  SettlementFact,
  TradingDay,
} from '@merit/rules-engine';
import { advanceDay, evaluatePayout } from '@merit/rules-engine';
import type { BalanceAdjustment, SimAccount } from '@merit/rithmic';
import { drawKey, draws, simulate } from '@merit/rithmic';
import { asTradingDay, sequenceOf, toDailyMark, tradingDaysAfter } from './bridge.ts';
import type {
  RequestPolicy,
  SettledPayout,
  Trial,
  TrialBehaviour,
  TrialInput,
  TrialOutcome,
} from './types.ts';

/** Thrown when a trial cannot be run as specified, or when the harness contradicts itself. */
export class TrialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrialError';
  }
}

/** Validate the behavioural knobs. A malformed run is refused, never repaired. */
export function checkBehaviour(behaviour: TrialBehaviour): void {
  const bp = (label: string, value: number): void => {
    if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
      throw new TrialError(`${label} ${String(value)} is not a basis-point share in 0..10000`);
    }
  };
  bp('riskUpShareBp', behaviour.riskUpShareBp);
  const policy = behaviour.requestPolicy;
  if (policy.kind === 'random') bp('requestPolicy.chanceBp', policy.chanceBp);
  if (policy.kind === 'peak_picking' && !Number.isSafeInteger(policy.patienceTradingDays)) {
    throw new TrialError(
      `patienceTradingDays ${String(policy.patienceTradingDays)} is not an integer`,
    );
  }
  if (policy.kind === 'peak_picking' && policy.patienceTradingDays < 1) {
    throw new TrialError(
      `patienceTradingDays ${String(policy.patienceTradingDays)} is not at least 1. A patience ` +
        'of zero is a trader who never asks, which is not a request policy',
    );
  }
  if (
    !Number.isSafeInteger(behaviour.settlementLagTradingDays) ||
    behaviour.settlementLagTradingDays < 1
  ) {
    throw new TrialError(
      `settlementLagTradingDays ${String(behaviour.settlementLagTradingDays)} is not at least 1. ` +
        'The basis day is already closed when the request is evaluated (R-06), so a settlement ' +
        'effective on it would be applied to a day the fold has finished with',
    );
  }
  if (!Number.isSafeInteger(behaviour.riskUpQuantityBp) || behaviour.riskUpQuantityBp < 1) {
    throw new TrialError(
      `riskUpQuantityBp ${String(behaviour.riskUpQuantityBp)} is not a positive basis-point scale`,
    );
  }
}

/**
 * `PP-05`'s magnitude, on a CONTRACT COUNT and never on money.
 *
 * Floored, and never below one: an account that risked up into a position size
 * of zero is an account that stopped trading, which is a different behaviour
 * from the one being modelled.
 */
function riskUpQuantityMax(quantityMax: number, riskUpQuantityBp: number): number {
  const scaled = Math.floor((quantityMax * riskUpQuantityBp) / 10_000);
  return scaled < 1 ? 1 : scaled;
}

/**
 * `AS-08`. Whether the trader asks TODAY, given that the engine has already said
 * yes.
 *
 * IT READS ONLY WHAT THE PORTAL ALREADY SHOWS THE TRADER: today's payable
 * amount, today's cap, and what the trader saw on earlier eligible days. There
 * is no lookahead, because a policy that peeked at tomorrow's close would model
 * a clairvoyant trader and overstate the premium `AS-08` is about, which is a
 * different error from the one it warns of.
 *
 * IT DECIDES NOTHING THE ENGINE DECIDES. The amount and the eligibility are
 * `evaluation`'s; this answers only "does the trader submit the request".
 */
function decideRequest(args: {
  readonly policy: RequestPolicy;
  readonly seed: string;
  readonly platformAccountRef: string;
  readonly tradingDay: string;
  readonly payableCents: Cents;
  readonly capCents: Cents;
  /** The best payable seen on EARLIER eligible days in this window. */
  readonly bestPayableCents: Cents | null;
  /** Eligible days in this window, today included. */
  readonly eligibleDaysObserved: number;
}): boolean {
  const { policy } = args;
  switch (policy.kind) {
    case 'immediate':
      return true;
    case 'random':
      // Keyed on the day so the draw is stable under any change to the
      // population or to the window, which is what `rng.ts` keys for.
      return draws(
        drawKey('harness-request', args.seed, args.platformAccountRef, args.tradingDay),
      ).chanceInBasisPoints(policy.chanceBp);
    case 'peak_picking': {
      // `AS-08`: the premium "is not exploitable beyond the cap". A clamped
      // figure cannot rise, so waiting past it only exposes the account to a
      // breach it has nothing left to gain from.
      if (args.payableCents >= args.capCents) return true;
      // Patience spent. The trader asks on whatever today is, which is the
      // honest cost of the strategy and is why the premium is not free.
      if (args.eligibleDaysObserved >= policy.patienceTradingDays) return true;
      // The first eligible day sets the reference and never fires. From then on
      // the trader asks on the first day that beats everything seen so far,
      // which is a local maximum computed out of the past alone.
      if (args.bestPayableCents === null) return false;
      return args.payableCents > args.bestPayableCents;
    }
  }
}

/**
 * An approved request waiting for its effective day. `R-38` allows exactly one.
 *
 * IT IS A UNION BECAUSE THE UNSETTLEABLE CASE IS NOT A `SettledPayout` WITH A
 * MISSING FIELD. When the effective day falls past the loaded window there is no
 * day for the withdrawal to land on, and a record carrying an empty string or
 * the basis day in that slot would claim a settlement that did not happen. The
 * request is real either way, which is why both arms block a second one.
 */
type InFlightRequest =
  | {
      readonly settleable: true;
      readonly fact: SettlementFact;
      readonly effectiveTradingDay: string;
      /** Everything the engine said at approval, ready to record when it lands. */
      readonly record: SettledPayout;
    }
  | {
      readonly settleable: false;
      readonly ordinal: number;
      readonly basisTradingDay: string;
      readonly approvedCents: Cents;
    };

/**
 * One account, every session, in order.
 *
 * THE LOOP STOPS ON THE FIRST REFUSAL AND THAT IS THE CONTRACT RATHER THAN A
 * CHOICE. `DayOutput` on a refusal carries "the state the fold arrived with", no
 * state is written for the day, and the caller is expected to raise
 * reconciliation (`FM-05`). Continuing would mean folding tomorrow against a
 * state today declined to produce, which is the wrong number returned
 * confidently that the refusal exists to prevent.
 */
export function runTrial(input: TrialInput): Trial {
  const { seed, engineVersion, plan, account, sessions, specs, calendar, behaviour, context } =
    input;
  checkBehaviour(behaviour);

  const firstSession = sessions[0];
  if (firstSession === undefined) throw new TrialError('a trial needs at least one session');

  // `R-32`'s anchor (ADR-051), which is the first TRADEABLE day and not the
  // purchase day. Every account in a run starts trading on the window's first
  // session, so the two coincide by construction here rather than by assumption.
  const openedOn = asTradingDay(firstSession.tradingDay);

  // `PP-05` cohort membership, drawn once per account and keyed so it does not
  // depend on the population's size or on iteration order.
  const inRiskUpCohort = draws(
    drawKey('harness-riskup', seed, account.platformAccountRef),
  ).chanceInBasisPoints(behaviour.riskUpShareBp);

  const payouts: SettledPayout[] = [];
  let inFlight: InFlightRequest | null = null;
  let prior: RuleState | null = null;
  let finalState: RuleState | null = null;
  let carriedBalanceCents: Cents = account.startingBalanceCents;
  let setpointCents: Cents | null = account.riskMaxLossCents;
  let riskUpActive = false;
  let tradingDaysObserved = 0;
  let outcome: TrialOutcome = 'trading';
  let refusal: AssertionFailure | null = null;
  let passedEvalOn: string | null = null;
  let breachedOn: string | null = null;
  let breachKind: BreachKind | null = null;
  let graduatedOn: string | null = null;
  // `AS-08`'s observation window. Both reset whenever eligibility lapses and
  // whenever a request is submitted, because a strategy is about ONE decision.
  let eligibleDaysObserved = 0;
  let bestPayableCents: Cents | null = null;

  // A plan with no evaluation phase opens funded (Appendix A.3, Direct), so its
  // first extraction cycle opens on the window's first session. On a plan with
  // an eval phase there is no funded trading day until the day after the pass,
  // and `null` says so rather than pointing at a day in the wrong phase.
  const startedInEval = plan.eval !== null;
  let firstFundedTradingDay: string | null = startedInEval ? null : firstSession.tradingDay;
  let cycleFirstTradingDay: string | null = firstFundedTradingDay;

  for (const session of sessions) {
    const tradingDay = session.tradingDay;

    // -------------------------------------------------------------------------
    // The vendor's book: the withdrawal lands at the OPEN of the effective day
    // -------------------------------------------------------------------------
    // `SD-01` and `R-10`, and `INV-18` is what makes the two sides agree:
    // `opening == prior.balance + adjustment`, compared against the
    // PRE-settlement balance. The engine subtracts the approved amount at DO-2
    // and the day model applies the same amount as a non-trading movement at the
    // open, so the identity holds by construction rather than by a reconcile.
    const due =
      inFlight !== null && inFlight.settleable && inFlight.effectiveTradingDay === tradingDay
        ? inFlight
        : null;
    const adjustments: BalanceAdjustment[] = [];
    if (due !== null) {
      adjustments.push({
        platformAccountRef: account.platformAccountRef,
        tradingDay,
        cents: -due.record.approvedCents,
        vendorDescription: 'merit settled payout, external leg',
      });
    }

    const dayAccount: SimAccount = {
      ...account,
      startingBalanceCents: carriedBalanceCents,
      riskMaxLossCents: setpointCents,
      quantityMax:
        riskUpActive && inRiskUpCohort
          ? riskUpQuantityMax(account.quantityMax, behaviour.riskUpQuantityBp)
          : account.quantityMax,
    };

    const run = simulate({
      seed,
      population: [dayAccount],
      sessions: [session],
      specs,
      adjustments,
    });
    const simDay = run.days[0]?.[0];
    if (simDay === undefined) {
      throw new TrialError(`the day model produced no day for ${tradingDay}`);
    }

    const settlements: readonly SettlementFact[] = due === null ? [] : [due.fact];
    const output = advanceDay({
      engineVersion,
      plan,
      prior,
      mark: toDailyMark(simDay, seed),
      calendar,
      settlements,
      openedOn,
    });

    if (output.assertions.length > 0) {
      // No state is written for a refused day, so the settlement it carried was
      // NOT applied and stays in flight, where the trial record reports it.
      refusal = output.assertions[0] ?? null;
      outcome = 'refused';
      break;
    }

    const state = output.state;

    if (due !== null) {
      payouts.push(due.record);
      inFlight = null;
      // `PP-05`. The house-money effect starts after the first payout LANDS,
      // not when it is approved, because the money is what changes the
      // trader's sense of what is at stake.
      riskUpActive = true;
      cycleFirstTradingDay = tradingDaysAfter(
        calendar,
        asTradingDay(due.record.basisTradingDay),
        1,
      );
    }

    if (state.phase === 'graduated') {
      // `R-49`. `advanceDay` returns at DO-2 without folding the day: "the
      // ladder is finished, the account is closed, and folding the rest of the
      // day would advance counters on an account that has none". So the day is
      // NOT counted as observed, and the state's own `tradingDay` is still
      // yesterday's, which is the engine's contract rather than a defect here.
      graduatedOn = tradingDay;
      outcome = 'graduated';
      finalState = state;
      break;
    }

    tradingDaysObserved += 1;

    const passed = output.events.some((event) => event.type === 'phase.passed');
    if (passed) {
      passedEvalOn = tradingDay;
      // `INV-M2-07`, `DEP-M2-01`, `GS-070`, `GS-093`: funding re-provisions the
      // platform account and a funded account's first mark opens at exactly
      // `size_cents`. The engine has already reset its own balance in the same
      // step (`R-31`), so this is the platform side of one fact rather than a
      // patch applied to a number the engine returned.
      carriedBalanceCents = plan.sizeCents;
      const nextDay = tradingDaysAfter(calendar, asTradingDay(tradingDay), 1);
      firstFundedTradingDay = nextDay;
      cycleFirstTradingDay = nextDay;
    } else {
      carriedBalanceCents = simDay.closingBalanceCents;
    }

    // M2's push. Transport, not arithmetic: the number is the engine's.
    setpointCents = account.riskMaxLossCents === null ? null : state.floorCents;

    if (state.phase === 'closed') {
      // `R-24`, `INV-12`. Terminal, and no state advances after it.
      breachedOn = tradingDay;
      breachKind = state.breachKind;
      outcome = 'breached';
      finalState = state;
      break;
    }

    prior = state;
    finalState = state;

    // -------------------------------------------------------------------------
    // The request, asked of the engine and never answered here
    // -------------------------------------------------------------------------
    // `hasPayoutInFlight` IS RAISED AND NEVER LOWERED. M01 section 2.1 makes it
    // the caller's to resolve, "account level OR identity level", and ADR-019
    // narrows the rule to the external leg. While a settlement is pending, the
    // identity has one outstanding, so the loop reports that fact; whether it
    // blocks the request is `R-38`'s answer and `AS-01` is why nobody else may
    // give it.
    const evaluation = evaluatePayout(state, plan, {
      gates: {
        ...context,
        hasPayoutInFlight: context.hasPayoutInFlight || inFlight !== null,
      },
      requestedCents: null,
    });

    if (!evaluation.eligible) {
      // The eligibility window closed, so the strategy's observation window
      // closes with it. A trader who lost the buffer and regained it a month
      // later is not still waiting on the peak they saw in the first stretch.
      eligibleDaysObserved = 0;
      bestPayableCents = null;
      continue;
    }

    eligibleDaysObserved += 1;
    const payableCents = evaluation.maxPayoutCents;
    const asks = decideRequest({
      policy: behaviour.requestPolicy,
      seed,
      platformAccountRef: account.platformAccountRef,
      tradingDay,
      payableCents,
      capCents: evaluation.capCents,
      bestPayableCents,
      eligibleDaysObserved,
    });
    bestPayableCents =
      bestPayableCents === null || payableCents > bestPayableCents
        ? payableCents
        : bestPayableCents;
    if (!asks) continue;

    if (inFlight !== null) {
      // UNREACHABLE, AND IT THROWS RATHER THAN QUEUING. `R-38` is conjoined into
      // `contextEligible` and the fact above is raised whenever this is
      // non-null, so an eligible verdict here means the engine's conjunction and
      // this loop's bookkeeping disagree. `AS-01` is what that would cost: "on
      // CORE-50K that converts one qualifying stretch into 3 x 150,000c of
      // approved payouts, against a withdrawable that only ever supported one".
      throw new TrialError(
        `${account.platformAccountRef} was ruled eligible on ${tradingDay} with a request ` +
          'already in flight. R-38 and this loop disagree about the external leg',
      );
    }

    const approvedCents = evaluation.maxPayoutCents;
    if (approvedCents !== evaluation.clamp.approvedCents) {
      // TWO INDEPENDENT STATEMENTS OF ONE NUMBER, CHECKED WHERE BOTH ARE IN
      // HAND. With no requested amount, ADR-009 makes the default
      // `min(withdrawable, cap)` and `R-43`'s three-way `min` returns the same
      // figure, so an eligible evaluation whose two fields disagree is the
      // engine contradicting itself. `session.ts` uses the same idiom one layer
      // down and for the same reason.
      throw new TrialError(
        `${account.platformAccountRef} on ${tradingDay}: maxPayoutCents ${approvedCents} and ` +
          `clamp.approvedCents ${evaluation.clamp.approvedCents} disagree`,
      );
    }

    const basisTradingDay: TradingDay = evaluation.asOfTradingDay;
    if (cycleFirstTradingDay === null) {
      throw new TrialError(
        `${account.platformAccountRef} was ruled eligible on ${tradingDay} with no funded ` +
          'trading day recorded. A payout cannot precede the phase that produces one',
      );
    }
    const cycleTradingDays =
      sequenceOf(calendar, basisTradingDay) -
      sequenceOf(calendar, asTradingDay(cycleFirstTradingDay)) +
      1;

    const effectiveTradingDay = tradingDaysAfter(
      calendar,
      basisTradingDay,
      behaviour.settlementLagTradingDays,
    );

    inFlight =
      effectiveTradingDay === null
        ? {
            settleable: false,
            ordinal: evaluation.ordinal,
            basisTradingDay,
            approvedCents,
          }
        : {
            settleable: true,
            effectiveTradingDay,
            fact: {
              // SD-05 makes the ordinal unique per account, so the ref and the
              // ordinal identify a request without a counter of this file's own.
              payoutRequestId: `${account.platformAccountRef}-${String(evaluation.ordinal)}`,
              ordinal: evaluation.ordinal,
              approvedCents,
              basisTradingDay,
              effectiveTradingDay,
            },
            record: {
              ordinal: evaluation.ordinal,
              basisTradingDay,
              effectiveTradingDay,
              approvedCents,
              traderCents: evaluation.clamp.traderCents,
              firmCents: evaluation.clamp.firmCents,
              capCents: evaluation.capCents,
              clampReason: evaluation.clamp.reason,
              cycleTradingDays,
              cycleFirstTradingDay,
              eligibleDaysWaited: eligibleDaysObserved,
            },
          };

    // The decision has been taken, so the observation window closes. The next
    // one opens when the account is eligible again, which after a settlement is
    // a cycle away.
    eligibleDaysObserved = 0;
    bestPayableCents = null;
  }

  const lifetimeSettledCents = payouts.reduce((total, payout) => total + payout.approvedCents, 0n);
  const lifetimeTraderCents = payouts.reduce((total, payout) => total + payout.traderCents, 0n);

  if (finalState !== null && finalState.lifetimeSettledCents !== lifetimeSettledCents) {
    // `R-50`'s accumulator against this loop's own sum, checked where both are
    // still in hand. A harness whose recorded payouts disagree with the state
    // the engine wrote is a harness whose liability figure is its own arithmetic
    // rather than the engine's.
    throw new TrialError(
      `${account.platformAccountRef}: the engine settled ${finalState.lifetimeSettledCents} ` +
        `lifetime and the trial recorded ${lifetimeSettledCents}`,
    );
  }

  return {
    platformAccountRef: account.platformAccountRef,
    sizeLabel: account.sizeLabel,
    sizeCents: account.sizeCents,
    outcome,
    startedInEval,
    passedEvalOn,
    reachedFunded: !startedInEval || passedEvalOn !== null,
    firstFundedTradingDay,
    breachedOn,
    breachKind,
    graduatedOn,
    payouts,
    lifetimeSettledCents,
    lifetimeTraderCents,
    tradingDaysObserved,
    inRiskUpCohort,
    approvedRequestsNeverSettled: inFlight === null ? 0 : 1,
    refusal,
    finalState,
  };
}
