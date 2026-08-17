// =============================================================================
// scripts/demo/fold.ts
// =============================================================================
// THE FOLD. `advanceDay` over one account's days, in order, carrying the state.
//
// -----------------------------------------------------------------------------
// THE ONE THING IN THIS FILE THAT IS NOT A LOOP, AND IT IS WORTH READING
// -----------------------------------------------------------------------------
// R-31 RESETS THE FUNDED BALANCE TO `size_cents` AND THE SIMULATOR DOES NOT KNOW
// THAT. On the day an eval passes, the engine's `advanceEvalProgression` sets
// `balanceCents: plan.sizeCents` in the same step as the pass. The simulator
// carries its own balance from session to session and has no notion of a phase,
// so its next opening balance is wherever the eval left it, typically
// `size + 300,000c` or more.
//
// So the next day fails INV-18 (`opening == prior.balance + adjustment`), the
// fold refuses the day, and every account that passes its evaluation stops one
// day later with `opening_mismatch`. A demo that folded a single `simulate()`
// call straight through would show that and nothing else.
//
// THE FIX IS NOT A FIX, IT IS THE MODEL. INV-M2-07 is that "a funded account's
// first mark opens at exactly `size_cents`" and M02 owns making it true
// (DEP-M2-01, GS-070, GS-093): funding re-provisions the platform account, and
// `buildPopulation` already starts every account at exactly `size_cents`
// (`startingBalanceCents`, "there is no draw here on purpose"). So the demo
// RESTARTS the simulator at the day after the pass, which is what the platform
// does, rather than patching a balance the engine returned.
//
// That restart is deterministic and changes no draw. Every key in `rng.ts` is
// `(seed, accountRef, tradingDay, ...)` and none of them is the session's index,
// so the days in the second segment draw exactly the trades they would have
// drawn in one continuous run. What differs is the balance they are applied to,
// which is the whole point.
//
// -----------------------------------------------------------------------------
// WHAT THE FOLD IS NOT ASKED TO DO
// -----------------------------------------------------------------------------
// NO SETTLEMENTS. `advanceDay` takes a `SettlementFact[]` and the demo always
// passes none, so group H never runs, no account ever acquires a
// `cadenceAnchorDay`, and R-37 is reported `skipped` on every row in every run.
// A cadence gate that never binds is a gate this demo does not exercise, and the
// table says `skip` rather than pretending otherwise.
//
// NO ADJUSTMENTS. `BalanceAdjustment` is where a settled withdrawal enters the
// vendor's book (SD-01, R-10), and one supplied without a matching settlement is
// the quarantine case (GS-092, EC-051) rather than the normal one. With no
// settlements there is nothing to adjust for.
// =============================================================================

import type {
  AssertionFailure,
  Cents,
  EngineEvent,
  ExternalGates,
  PayoutEvaluation,
  ResolvedPlan,
  RuleState,
} from '../../packages/rules-engine/src/index.js';
import { advanceDay, evaluatePayout } from '../../packages/rules-engine/src/index.js';
import type {
  ContractSpec,
  SimAccount,
  SimLiquidation,
  SimSession,
} from '../../packages/rithmic/src/index.js';
import { simulate } from '../../packages/rithmic/src/index.js';
import { asTradingDay, toCalendarSlice, toDailyMark } from './bridge.js';
import type { Cohort } from './config.js';

/**
 * The engine version this demo folds under.
 *
 * IT IS A CONSTANT AND NOT A PACKAGE VERSION, because replay scopes divergence
 * detection to rows computed under the running version (M01 Appendix B.4) and a
 * demo that read one from a manifest would be claiming to be a build.
 */
export const DEMO_ENGINE_VERSION = 'demo-not-a-build';

/**
 * A CLEAN CONTEXT ON EVERY ROW, STATED ONCE.
 *
 * R-40's gates are read at request time and never replayed (INV-23), so they are
 * the caller's to supply and this caller supplies the permissive answer to all
 * five. That is deliberate: it makes the only thing moving in the output the
 * ENGINE half of eligibility, which is what the demo is for. A run that wanted
 * to watch a freeze or a KYC hold would change this record and nothing else,
 * which is itself worth seeing.
 */
export const CLEAN_CONTEXT: ExternalGates = {
  accountStatus: 'active',
  kycState: 'verified',
  payoutsFrozen: false,
  reconBlocked: false,
  hasPayoutInFlight: false,
};

/** One trading day for one account: what the platform reported and what the engine did. */
export interface DayRow {
  readonly tradingDay: string;
  readonly openingBalanceCents: Cents;
  readonly closingBalanceCents: Cents;
  readonly lowBalanceCents: Cents;
  readonly realizedPnlCents: Cents;
  readonly fillCount: number;
  /** The vendor's own liquidation record, or null where the setpoint never fired. */
  readonly liquidation: SimLiquidation | null;
  /** `null` when the fold REFUSED the day: no state is written for a refusal. */
  readonly state: RuleState | null;
  readonly assertions: readonly AssertionFailure[];
  readonly events: readonly EngineEvent[];
  /** `null` on a refused day, for the same reason: there is no state to evaluate. */
  readonly evaluation: PayoutEvaluation | null;
  /** True on the day the simulator was re-provisioned at `size_cents` (INV-M2-07). */
  readonly reprovisionedAtOpen: boolean;
}

/** How an account's run ended. */
export type Outcome = 'breached' | 'eligible' | 'refused' | 'trading';

export interface AccountRun {
  readonly cohort: string;
  readonly account: SimAccount;
  readonly rows: readonly DayRow[];
  readonly outcome: Outcome;
  /** The first day `evaluatePayout` returned `eligible`, or null. */
  readonly firstEligibleDay: string | null;
  /** The day the account passed its evaluation, or null. */
  readonly passedOn: string | null;
}

export interface FoldInput {
  readonly seed: string;
  readonly plan: ResolvedPlan;
  readonly sessions: readonly SimSession[];
  readonly specs: readonly ContractSpec[];
  readonly sequenceBase: number;
  readonly cohort: Cohort;
  readonly account: SimAccount;
}

/**
 * One account, every session, in order.
 *
 * THE LOOP STOPS ON THE FIRST REFUSAL AND THAT IS THE CONTRACT RATHER THAN A
 * CHOICE. `DayOutput` on a refusal carries "the state the fold arrived with",
 * no state is written for the day, and the caller is expected to raise
 * reconciliation (FM-05). Continuing would mean folding tomorrow against a state
 * today declined to produce, which is the wrong number returned confidently that
 * the refusal exists to prevent.
 */
export function foldAccount(input: FoldInput): AccountRun {
  const { seed, plan, sessions, specs, sequenceBase, cohort, account } = input;
  const calendar = toCalendarSlice(sessions, sequenceBase);

  // R-32's anchor (ADR-051), which for the demo is the first session it folds.
  // The demo's accounts start trading on day one of the run, and ADR-051 defines
  // `opened_on` as the first TRADEABLE day, so the two coincide here by
  // construction rather than by assumption. Nothing in the demo lineup sets
  // `phase_eval.max_days`, so R-32 never reads it; it is supplied because the
  // field is required, and it is required so that it cannot be forgotten
  // somewhere it WOULD be read.
  const firstSession = sessions[0];
  if (firstSession === undefined) throw new Error('the demo fold needs at least one session');
  const openedOn = asTradingDay(firstSession.tradingDay);

  const rows: DayRow[] = [];
  let prior: RuleState | null = null;
  let firstEligibleDay: string | null = null;
  let passedOn: string | null = null;
  let outcome: Outcome = 'trading';

  // The index of the session the current segment starts at. A segment ends when
  // the account passes its evaluation, because the platform account is
  // re-provisioned at `size_cents` and the simulator has to start again there.
  let segmentStart = 0;

  segments: while (segmentStart < sessions.length) {
    const segment = sessions.slice(segmentStart);
    const run = simulate({
      seed,
      population: [account],
      sessions: segment,
      specs,
      adjustments: [],
    });

    for (let i = 0; i < run.days.length; i += 1) {
      const forSession = run.days[i];
      const simDay = forSession?.[0];
      if (simDay === undefined) throw new Error(`no simulated day at index ${String(i)}`);

      const mark = toDailyMark(simDay);
      const output = advanceDay({
        engineVersion: DEMO_ENGINE_VERSION,
        plan,
        prior,
        mark,
        calendar,
        settlements: [],
        openedOn,
      });

      const refused = output.assertions.length > 0;
      const state = refused ? null : output.state;
      const evaluation =
        state === null
          ? null
          : evaluatePayout(state, plan, { gates: CLEAN_CONTEXT, requestedCents: null });

      rows.push({
        tradingDay: simDay.tradingDay,
        openingBalanceCents: simDay.openingBalanceCents,
        closingBalanceCents: simDay.closingBalanceCents,
        lowBalanceCents: simDay.lowBalanceCents,
        realizedPnlCents: simDay.realizedPnlCents,
        fillCount: simDay.fills.length,
        liquidation: simDay.liquidation,
        state,
        assertions: output.assertions,
        events: output.events,
        evaluation,
        reprovisionedAtOpen: segmentStart > 0 && i === 0,
      });

      if (refused) {
        outcome = 'refused';
        break segments;
      }
      if (state === null) throw new Error('a day that did not refuse must carry a state');

      if (evaluation?.eligible === true && firstEligibleDay === null) {
        firstEligibleDay = simDay.tradingDay;
        outcome = 'eligible';
      }

      if (state.phase === 'closed') {
        // R-24. Terminal, and no state advances after it.
        outcome = 'breached';
        break segments;
      }
      if (state.phase === 'graduated') {
        // R-49 needs a settlement to fire and this demo supplies none, so this
        // is unreachable today. It is here because "unreachable" is a statement
        // about the demo's inputs rather than about the engine, and a fold that
        // silently carried on past a graduated account would be wrong the day
        // a settlement is added.
        break segments;
      }

      prior = state;

      const passed = output.events.some((event) => event.type === 'phase.passed');
      if (passed) {
        passedOn = simDay.tradingDay;
        segmentStart += i + 1;
        continue segments;
      }
    }

    // The segment ran to the end of the window without a pass, so there is no
    // next segment.
    break;
  }

  return { cohort: cohort.label, account, rows, outcome, firstEligibleDay, passedOn };
}
