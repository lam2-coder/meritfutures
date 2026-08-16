// =============================================================================
// packages/rules-engine/src/payout/evaluate.ts
// =============================================================================
// R-38, R-40 and R-41's second half. This is the function M01 section 4 names
// for BOTH payout endpoints:
//
//   GET  /accounts/:id/eligibility   `evaluatePayout(state, plan, ctx)`
//   POST /accounts/:id/payout        "THE IDENTICAL FUNCTION WITH THE IDENTICAL
//                                     INPUTS. This is why the displayed number
//                                     and the paid number cannot differ"
//
// FM-16 is the failure it exists to prevent: "a gate is evaluated in the API
// layer instead of the engine", whose blast radius is "two implementations of
// one rule, which drift". `evaluatePayout` is the only exported evaluator, and
// `clampPayout` is reachable only through it, which is what makes that sentence
// structural rather than aspirational.
//
// -----------------------------------------------------------------------------
// NOTHING HERE IS EVER STORED IN `rule_states`
// -----------------------------------------------------------------------------
// INV-23: "Context gates (frozen, recon, KYC, in flight) never enter the
// replayed state or its hash." A freeze applied last March would otherwise
// produce a divergence every night since (SD-06). So this function READS a
// `RuleState` and returns an evaluation; it never produces one.
// =============================================================================

import type {
  AccountActiveGate,
  Cents,
  ExternalGates,
  FullGateResults,
  KycVerifiedGate,
  NotFrozenGate,
  PayoutEvaluation,
  ReconClearGate,
  ResolvedPlan,
  RuleState,
} from '../types.js';
import { clampPayout } from './clamp.js';

/** What the caller supplies beyond the state and the plan. */
export interface PayoutContext {
  readonly gates: ExternalGates;
  /**
   * `null` when the caller omitted an amount, which
   * [ADR-009](../../../docs/decisions/ADR-009.md) defines as "pay the maximum I
   * am eligible for". API_CONTRACT: "A supplied amount is a CEILING, never an
   * instruction."
   */
  readonly requestedCents: Cents | null;
}

/**
 * R-40, R-38, then R-41's conjunction over both halves.
 *
 * THE ENGINE GATES ARE READ, NOT RECOMPUTED. `state.engineGates` was computed at
 * DO-9 against the last closed day, and R-06 requires that: "every evaluation is
 * against the last closed day and nothing more recent", and "no endpoint may
 * evaluate eligibility against anything other than the last closed day, whatever
 * the batch is doing at the time". Recomputing here would give this function a
 * second, subtly different answer to a question DO-9 already answered.
 */
export function evaluatePayout(
  state: RuleState,
  plan: ResolvedPlan,
  ctx: PayoutContext,
): PayoutEvaluation {
  const external = ctx.gates;

  // ---------------------------------------------------------------------------
  // R-40  the context gates
  // ---------------------------------------------------------------------------
  // "Account `active` and phase `funded`; KYC `verified`; not `payoutsFrozen` at
  // account or identity level; not `reconBlocked`. Evaluated at read time,
  // EXCLUDED FROM THE REPLAYED STATE."
  //
  // THE PHASE TERM IS ENGINE STATE INSIDE A CONTEXT GATE, and it belongs here
  // rather than in `engineGates` because R-40 puts it here: it is read at
  // request time and never stored, so it cannot contribute a divergence. An
  // eval-phase or graduated account is not payable whatever its counters say.
  const accountActive: AccountActiveGate = {
    pass: external.accountStatus === 'active' && state.phase === 'funded',
    status: external.accountStatus,
    phase: state.phase,
  };

  const kycVerified: KycVerifiedGate = {
    pass: external.kycState === 'verified',
    state: external.kycState,
  };

  // The engine cannot name WHICH level froze the payout, and it does not guess.
  // `payoutsFrozen` arrives already resolved across the account and the identity
  // (M01 section 2.1), so the reason names the fact and the caller names the
  // level. Inventing "account" here would be a wrong word on a support screen.
  const notFrozen: NotFrozenGate = {
    pass: !external.payoutsFrozen,
    reason: external.payoutsFrozen ? 'payouts_frozen' : null,
  };

  // FM-04: a reconciliation-blocked account is "excluded from eligibility" until
  // a human resolves it, because "every downstream number is suspect for that
  // account".
  const reconClear: ReconClearGate = { pass: !external.reconBlocked };

  // ---------------------------------------------------------------------------
  // R-38  one payout in flight, ON THE EXTERNAL LEG ONLY
  // ---------------------------------------------------------------------------
  // AS-01 is the attack and it very nearly works: every request is individually
  // correct, every gate passes, and "on CORE-50K that converts one qualifying
  // stretch into 3 x 150,000c of approved payouts, against a withdrawable that
  // only ever supported one". R-38 is the first line and the SD-09 partial
  // unique index is the second, "so the engine is not the only line of defence".
  //
  // [ADR-019](../../../docs/decisions/ADR-019.md) narrowed it to the external
  // leg: "the internal leg completes in one transaction, so there is no window
  // for a second request to arrive inside and AS-01 is STRUCTURALLY RESOLVED
  // rather than gated. The rule survives on the external leg as the liability
  // control it always was."
  //
  // IT IS NOT IN `gates` AND THAT IS API_CONTRACT's SHAPE. M01 section 2.2 names
  // API_CONTRACT's `gates` object as the shape of `FullGateResults`, and that
  // object carries no in-flight entry: the condition surfaces as
  // `POST /accounts/:id/payout`'s `conflict` error instead. AS-01 nonetheless
  // calls R-38 "part of eligibility", so it is computed, it binds through
  // `contextEligible`, and it is reported on its own field rather than being
  // smuggled into a published shape that does not have a slot for it.
  //
  // WHICH REQUEST STATUSES COUNT AS OUTSTANDING IS THE CALLER'S, and it has
  // moved twice since M01 was frozen. M01's own comment on `hasPayoutInFlight`
  // still reads `approved | transferring | frozen`; ADR-028 retired
  // `transferring` and ADR-040 added `held_pending_review`, and STATE records
  // that M01 is the one document FOLD-02's sweep has not reached. The engine
  // reads a resolved boolean, so the drift cannot reach the arithmetic here, and
  // it is recorded rather than fixed because editing a frozen document is an ADR.
  const noPayoutInFlight = { pass: !external.hasPayoutInFlight };

  const gates: FullGateResults = {
    accountActive,
    kycVerified,
    notFrozen,
    reconClear,
    ...state.engineGates,
  };

  const contextEligible =
    accountActive.pass &&
    kycVerified.pass &&
    notFrozen.pass &&
    reconClear.pass &&
    noPayoutInFlight.pass;

  // ---------------------------------------------------------------------------
  // R-41  `eligible = engineEligible && contextEligible`
  // ---------------------------------------------------------------------------
  // "With NO SHORTCUT PATH AND NO OVERRIDE ANYWHERE IN THE CODEBASE" (INV-15).
  // The engine half was conjoined at DO-9 and is read as one boolean; the
  // context half is conjoined above. There is no third term and no branch that
  // can produce `true` any other way.
  const eligible = state.engineEligible && contextEligible;

  // ---------------------------------------------------------------------------
  // The amount, and `0n` when the answer is no
  // ---------------------------------------------------------------------------
  // M01 section 2.2: `maxPayoutCents` is "min(withdrawable, cap), 0 WHEN NOT
  // ELIGIBLE". The zero is not a formatting choice: showing a payable amount
  // beside a failing gate is how a trader comes to believe a number the rules do
  // not owe them.
  //
  // THE CLAMP IS COMPUTED WHATEVER THE VERDICT, because `POST` needs it on the
  // way to a decision and `GET` needs the cap and the ordinal to render the
  // ladder. What eligibility changes is `maxPayoutCents`, not whether the
  // arithmetic ran.
  const clamp = clampPayout(state, plan, ctx.requestedCents);
  const payable =
    state.withdrawableCents < clamp.capCents ? state.withdrawableCents : clamp.capCents;

  return {
    asOfTradingDay: state.tradingDay,
    engineEligible: state.engineEligible,
    contextEligible,
    eligible,
    gates,
    noPayoutInFlight,
    maxPayoutCents: eligible ? payable : 0n,
    capCents: clamp.capCents,
    ordinal: clamp.ordinal,
    minPayoutCents: plan.funded.minPayoutCents,
    clamp: {
      effectiveRequestCents: clamp.effectiveRequestCents,
      approvedCents: clamp.approvedCents,
      reason: clamp.reason,
      traderCents: clamp.traderCents,
      firmCents: clamp.firmCents,
      splitBp: clamp.splitBp,
    },
  };
}
