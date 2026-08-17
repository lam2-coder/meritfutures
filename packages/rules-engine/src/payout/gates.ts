// =============================================================================
// packages/rules-engine/src/payout/gates.ts
// =============================================================================
// GROUP F, THE FUNDED GATES. M01 section 1.3's layout gives this file R-33 to
// R-41, and it arrives one dependency at a time rather than all at once.
//
// WHAT IS HERE AND WHAT IS NOT
//
//   R-33  minimum trading days, funded. Zero DISABLES it (CV-19, ADR-015)
//   R-34  win days, counted strictly after `payoutAnchorDay`
//   R-35  `withdrawable = max(0, balance - size - buffer)`, and its gate form
//   R-36  funded consistency, R-29's arithmetic over the R-47 period
//   R-37  the cadence gap, by `sequence` subtraction
//   R-39  the minimum payout, against `min(withdrawable, cap)`
//   R-41  the conjunction, and INV-15 forbids a shortcut path
//
//   R-38  NOT HERE. It reads `ExternalGates.hasPayoutInFlight`, which M01
//         section 2.1 marks "context, never replayed (INV-23)", so it belongs
//         with `evaluatePayout` and not in a field of `RuleState`. See the note
//         at the foot of this file: M01 files it under group F and its input is
//         context, and that is a real tension rather than a reading
//   R-40  NOT HERE, and for the same reason: it IS the context gate set
//
// R-35 LANDED ONE COMMIT AHEAD OF THE REST because M01 section 3.6's
// `clampPayout` reads `state.withdrawableCents` and P2 section 2 puts group G
// before group F. The alternative -- clamping against a withdrawable recomputed
// inside `clampPayout` -- would put R-35's arithmetic in two places, and R-43's
// whole claim is that the number the trader is SHOWN and the number they are
// PAID come out of one function (M01 section 1.3, FM-16).
//
// THE GATES ARE EVALUATED INDEPENDENTLY AND REPORTED GATE BY GATE, which is M01
// group F's opening sentence and section 4's product claim: "competitors show a
// progress bar; Merit shows the whole rule". Nothing here short-circuits on the
// first failure, because a breakdown that stopped at the first `false` would
// tell a trader one thing they are missing out of three.
// =============================================================================

import { tradingDayAtSequence, tradingDaysBetween } from '../calendar.js';
import { consistencyOk } from '../day/consistency.js';
import type {
  AssertionFailure,
  BufferGate,
  CadenceGapGate,
  CalendarSlice,
  Cents,
  ConsistencyGate,
  EngineGateResults,
  GateInputState,
  MinimumAmountGate,
  ResolvedPlan,
  TradedDaysGate,
  WinDaysGate,
} from '../types.js';
import { capForOrdinal, ordinalForNextPayout } from './clamp.js';

/**
 * R-35. `withdrawable = max(0, balance_cents - size_cents - buffer_cents)`.
 *
 * GS-025 pins it and INV-05 is the half that must never be reachable:
 * `withdrawable_cents >= 0` ALWAYS, and M01 puts the enforcement in the formula
 * itself ("Formula floors at zero (R-35)") rather than in a check downstream of
 * it. There is no path here that produces a negative number, which is what
 * RE-P-05 asserts over generated sequences and RE-P-14 asserts about the buffer.
 *
 * THE BUFFER IS PERMANENT AND IS NEVER WITHDRAWABLE. M01 R-35 says so in those
 * words, and it is the reason the funded phase has anything for the time gates
 * to work on: a trader who could withdraw down to `size_cents` would leave no
 * cushion between the balance and the floor, which is AS-10's arithmetic run in
 * reverse.
 *
 * ZERO OUTSIDE THE FUNDED PHASE, WHICH IS M01 SECTION 3.6's OWN FIRST LINE
 * (`if (s.phase !== 'funded') return 0n`). An eval account has no withdrawable
 * amount because it has no funded balance yet (R-31 resets it to `size_cents`
 * and "eval profit is not carried"), and a `closed` or `graduated` account has
 * nothing further to extract. Deriving a number for those phases would put a
 * positive withdrawable on an account no gate could ever clear.
 */
export function withdrawableCents(state: GateInputState, plan: ResolvedPlan): Cents {
  if (state.phase !== 'funded') return 0n;

  const surplus = state.balanceCents - plan.sizeCents - plan.funded.bufferCents;
  return surplus > 0n ? surplus : 0n;
}

/** What DO-9 gets back: the six gates and their conjunction, or the day refused. */
export type EngineGatesOutcome =
  | {
      readonly kind: 'evaluated';
      readonly gates: EngineGateResults;
      readonly engineEligible: boolean;
    }
  | { readonly kind: 'refused'; readonly assertion: AssertionFailure };

export interface EngineGatesInput {
  /** The state DO-8 left, with `withdrawableCents` already computed. */
  readonly state: GateInputState;
  readonly plan: ResolvedPlan;
  /**
   * `null` when the caller has no slice to offer, which is `initialState`: M01
   * section 1.3 gives it the signature `(plan, openedOn)` and no calendar.
   *
   * A NULL IS NOT A LICENCE TO SKIP R-37. An account at open has no cadence
   * anchor, so the gate skips before it would read a calendar; an anchor with no
   * calendar REFUSES, exactly as a calendar that does not cover the anchor does.
   * The two misses are the same fact -- the slice cannot answer -- and P2
   * section 1 rules that a typed refusal rather than a pass.
   */
  readonly calendar: CalendarSlice | null;
}

/**
 * R-33 to R-39, then R-41's conjunction.
 *
 * EVERY GATE IS COMPUTED, ON EVERY ROW, INCLUDING EVAL ROWS. R-40's "phase
 * `funded`" is a CONTEXT gate evaluated at read time, not an engine gate, so
 * this function does not branch on the phase; an eval row simply carries a zero
 * withdrawable (R-35) and therefore fails R-39, which is the true answer rather
 * than a suppressed one. A gate set that vanished outside the funded phase would
 * make the eligibility breakdown blank on exactly the screen where a trader is
 * trying to learn what the funded gates are.
 */
export function evaluateEngineGates(input: EngineGatesInput): EngineGatesOutcome {
  const { state, plan, calendar } = input;
  const funded = plan.funded;

  // ---------------------------------------------------------------------------
  // R-33  minimum trading days, funded, and ZERO DISABLES IT
  // ---------------------------------------------------------------------------
  // CV-19: "`phase_funded.min_trading_days >= 0`, and 0 MEANS THE GATE IS
  // DISABLED and reports `pass: true, skipped: true`". ADR-015 sets it to 0 on
  // all three v1 plans, so this gate is skipped everywhere in the lineup and the
  // `skipped` flag is the only thing that says so.
  //
  // AS-07 IS WHY IT IS DISABLED RATHER THAN TUNED. A traded day needs one fill,
  // so a minimum-days gate is "a fee, not a constraint", and with 5 required win
  // days it was "structurally incapable of binding" (EC-042). "The exploit was
  // never against the engine, it was against the marketing claim, and removing
  // the claim removes it." GS-080 pins that a disabled gate renders as disabled
  // rather than as satisfied.
  const tradedDaysSkipped = funded.minTradingDays === 0;
  const tradedDays: TradedDaysGate = {
    pass: tradedDaysSkipped || state.tradedDaysCount >= funded.minTradingDays,
    skipped: tradedDaysSkipped,
    have: state.tradedDaysCount,
    need: funded.minTradingDays,
  };

  // ---------------------------------------------------------------------------
  // R-34  win days
  // ---------------------------------------------------------------------------
  // `winDaysCount >= required_count`, `>=`, "counted over trading days STRICTLY
  // AFTER `payoutAnchorDay`". The counter already carries that scoping: R-47
  // resets it at settlement to the basis day, so the comparison here reads a
  // number the fold has already anchored rather than recounting a history this
  // function does not have.
  const winDays: WinDaysGate = {
    pass: state.winDaysCount >= funded.winDaysRequiredCount,
    have: state.winDaysCount,
    need: funded.winDaysRequiredCount,
    floorCents: funded.winDayFloorCents,
  };

  // ---------------------------------------------------------------------------
  // R-35's GATE FORM, AND M01 STATES NO OPERATOR FOR IT
  // ---------------------------------------------------------------------------
  // R-35 is a FORMULA (`withdrawable = max(0, balance - size - buffer)`), not a
  // comparison, and it is the only rule in group F whose row carries no operator
  // in section 3.5's operator column. API_CONTRACT nonetheless publishes a
  // `buffer` gate with `pass`, `have_cents` and `need_cents`, so the engine owes
  // one.
  //
  // ADOPTED: `pass` IS `withdrawable > 0`, which is R-35's own `max` read as a
  // question. REPORTED, because choosing an operator M01 does not state is not a
  // session's call to make silently.
  //
  // THE CHOICE CANNOT MOVE A PAYOUT, WHICH IS WHY IT IS SAFE TO ADOPT AND STILL
  // WORTH REPORTING. R-39 requires `min(withdrawable, cap) >= 10,000c`, so any
  // state clearing R-39 has a withdrawable of at least 10,000c and clears this
  // gate on either reading of the boundary. This gate is DOMINATED by R-39 in
  // exactly PW-01's sense: present, honest, and incapable of binding. It stays
  // in the conjunction because INV-15 is "`engine_eligible == AND(EVERY engine
  // gate)`" and a gate reported to the trader but excluded from the conjunction
  // would be the shortcut path INV-15 forbids.
  const buffer: BufferGate = {
    pass: state.withdrawableCents > 0n,
    haveCents: state.balanceCents - plan.sizeCents,
    needCents: funded.bufferCents,
  };

  // ---------------------------------------------------------------------------
  // R-36  funded consistency
  // ---------------------------------------------------------------------------
  // "R-29 arithmetic over the period defined by R-47. Payout-gated: failing
  // DELAYS eligibility and never breaches, never denies retroactively." The
  // delay is structural here: a failing gate makes `engineEligible` false today
  // and says nothing about any day already settled, which is INV-22 holding
  // because nothing in this function can reach backwards.
  //
  // ONE IMPLEMENTATION, TWO PHASES. `consistencyOk` is R-28's function too, and
  // M01 section 3.6 keeps them in one place "so the two variants can never drift
  // apart". What differs is the config block and the period, both passed in.
  const verdict = consistencyOk(
    state.consistencyBestDayCents,
    state.consistencyPeriodProfitCents,
    funded.consistency,
  );
  const consistency: ConsistencyGate = {
    pass: verdict.ok,
    skipped: verdict.skipped,
    bestDayShareBp: verdict.bestDayShareBp,
    maxDayShareBp: verdict.maxDayShareBp,
    profitNeededToDiluteCents: verdict.profitNeededToDiluteCents,
  };

  // ---------------------------------------------------------------------------
  // R-37  the cadence gap
  // ---------------------------------------------------------------------------
  // `count(trading days d : cadenceAnchorDay < d <= basisDay) >=
  // cadence_gap_trading_days`, `>=`, by `sequence` subtraction. The basis day is
  // the state's own trading day, because R-06 makes every evaluation "against
  // the last closed day and nothing more recent".
  //
  // "PASSES TRIVIALLY WHEN IT IS NULL (no gap on the first payout)", and it is
  // reported `skipped` rather than merely passing: a trader looking at a first
  // payout must see a gate that had nothing to measure, not one that reads as
  // satisfied. That is CV-19's vocabulary applied to a second gate.
  //
  // ON EVERY V1 PLAN THIS GATE IS DOMINATED OR CO-BINDING AND NEVER THE REASON A
  // PLAN IS FAST. PW-02b fires on Merit Rapid (gap 1 against 3 win days) and
  // EC-049 stands; PW-02a fires on Core EOD and Direct, where the gap and the
  // win-day gate co-bind at 5. The engine computes it regardless, because a
  // dominated gate is inert rather than absent.
  const cadence = cadenceGapGate(state, funded.cadenceGapTradingDays, calendar);
  if (cadence.kind === 'refused') return cadence;

  // ---------------------------------------------------------------------------
  // R-39  the minimum payout
  // ---------------------------------------------------------------------------
  // `min(withdrawable, cap) >= 10000`, `>=`, "exactly 100.00 is eligible"
  // (GS-042). The cap is R-42's rung for the ordinal this state would request
  // at, so the gate answers the question the trader is actually asking: is there
  // a payable amount at MY next ordinal, not at some ordinal.
  //
  // CV-10 IS WHAT KEEPS THIS GATE FROM BEING A TRAP. "Every `cap_cents >=
  // min_payout_cents`. Otherwise no payout at that rung can ever satisfy the
  // minimum, and the account is permanently ineligible WHILE LOOKING HEALTHY"
  // (GS-076). That is a publish-time check and not a runtime one, which is this
  // package's standing arrangement for config.
  const capCents = capForOrdinal(funded, ordinalForNextPayout(state));
  const payable = state.withdrawableCents < capCents ? state.withdrawableCents : capCents;
  const minimumAmount: MinimumAmountGate = {
    pass: payable >= funded.minPayoutCents,
    withdrawableCents: state.withdrawableCents,
    capCents,
    minPayoutCents: funded.minPayoutCents,
  };

  const gates: EngineGateResults = {
    tradedDays,
    winDays,
    buffer,
    consistency,
    cadenceGap: cadence.gate,
    minimumAmount,
  };

  return { kind: 'evaluated', gates, engineEligible: allGatesPass(gates) };
}

/**
 * R-41. `engineEligible` is the conjunction, "with no shortcut path and no
 * override anywhere in the codebase" (INV-15).
 *
 * THE TERMS ARE LISTED RATHER THAN REDUCED OVER `Object.values`. The determinism
 * contract bans "iteration over an object's keys where the result affects
 * output", and a reduction would also make a gate added later join the
 * conjunction silently, which is the opposite of what INV-15 wants: adding a
 * gate should be a line here, read by a reviewer, in the same diff.
 */
function allGatesPass(gates: EngineGateResults): boolean {
  return (
    gates.tradedDays.pass &&
    gates.winDays.pass &&
    gates.buffer.pass &&
    gates.consistency.pass &&
    gates.cadenceGap.pass &&
    gates.minimumAmount.pass
  );
}

type CadenceOutcome =
  | { readonly kind: 'evaluated'; readonly gate: CadenceGapGate }
  | { readonly kind: 'refused'; readonly assertion: AssertionFailure };

/**
 * R-37, and the two lookups it needs from the slice.
 *
 * A MISS ON THE ANCHOR REFUSES THE DAY. P2 section 1 rules this case by name,
 * because "replay will ask for the sequence of an anchor older than the slice":
 * returning null and letting the gate pass "silently weakens R-37, a money
 * gate", and throwing would make the fold's behavior depend on how much calendar
 * the caller loaded. So the miss becomes an `AssertionFailure`, no state is
 * written for the day, and reconciliation is raised.
 *
 * `nextEligibleTradingDay` IS THE OTHER HALF AND IT MAY BE NULL. AS-06: "The
 * engine reports `next_eligible_trading_day` as a resolved date through the
 * calendar, so the trader never does the arithmetic and is never surprised ...
 * any counter published in trading days must be rendered as a date, or the firm
 * has published a rule its own traders cannot evaluate." A slice that stops
 * short of that date makes the DATE unknown without making the GATE unknown, and
 * API_CONTRACT already types the field `string | null`.
 */
function cadenceGapGate(
  state: GateInputState,
  needTradingDays: number,
  calendar: CalendarSlice | null,
): CadenceOutcome {
  const anchor = state.cadenceAnchorDay;

  if (anchor === null) {
    return {
      kind: 'evaluated',
      gate: {
        pass: true,
        skipped: true,
        tradingDaysSinceLastPayout: null,
        need: needTradingDays,
        nextEligibleTradingDay: null,
      },
    };
  }

  if (calendar === null) {
    return {
      kind: 'refused',
      assertion: {
        kind: 'calendar_coverage_miss',
        tradingDay: state.tradingDay,
        detail:
          `R-37 counts the cadence gap from ${anchor} by sequence subtraction and no calendar ` +
          `slice was supplied, so the gap is UNKNOWN rather than cleared`,
      },
    };
  }

  const counted = tradingDaysBetween(calendar, anchor, state.tradingDay);
  if (!counted.found) {
    return {
      kind: 'refused',
      assertion: {
        kind: 'calendar_coverage_miss',
        tradingDay: state.tradingDay,
        detail:
          `R-37 counts the cadence gap from ${anchor} to ${state.tradingDay} by sequence ` +
          `subtraction, and ${counted.reason === 'outside_coverage' ? 'one of them is outside' : 'one of them is not a session inside'} ` +
          `the slice's coverage ${calendar.coverage.from}..${calendar.coverage.to}`,
      },
    };
  }

  const pass = counted.tradingDays >= needTradingDays;

  // The day the gap first clears is the anchor's sequence plus the configured
  // gap. Resolved through the calendar and never by date arithmetic (AS-06).
  // `null` once the gate passes, because there is nothing left to wait for.
  const anchorDay = calendar.days[calendar.index[anchor] ?? -1];
  const nextEligible =
    pass || anchorDay === undefined
      ? null
      : tradingDayAtSequence(calendar, anchorDay.sequence + needTradingDays);

  return {
    kind: 'evaluated',
    gate: {
      pass,
      skipped: false,
      tradingDaysSinceLastPayout: counted.tradingDays,
      need: needTradingDays,
      nextEligibleTradingDay: nextEligible?.tradingDay ?? null,
    },
  };
}

/**
 * The gate set on a row the account BREACHED on, where no gate can pass.
 *
 * R-24 and INV-12: "breach is terminal: no state advances after it", and DO-5
 * returns before DO-9 ever runs, so M01 section 3.6's breach branch sets
 * `engineEligible: false` without evaluating anything. This is that, with the
 * gate record the type requires.
 *
 * IT IS A SEPARATE FUNCTION RATHER THAN A CALL INTO `evaluateEngineGates`, and
 * the reason is the cadence gate. R-37 can REFUSE a day when the slice does not
 * cover the anchor, and a breach day that refused would be a breach the fold
 * declined to record on a caller's window choice. A breach is the one outcome
 * that must be written whatever else is unknown, so the gates it carries are
 * stated rather than computed.
 *
 * EVERY `pass` IS `false`, INCLUDING THE TWO THAT CAN BE `skipped`. A closed
 * account is not "skipped past" its gates; it can never clear them again, and a
 * `pass: true, skipped: true` on a breach row would put a satisfied-looking gate
 * on the worst row in an account's life.
 */
export function gatesAfterBreach(state: GateInputState, plan: ResolvedPlan): EngineGateResults {
  const funded = plan.funded;
  return {
    tradedDays: {
      pass: false,
      skipped: false,
      have: state.tradedDaysCount,
      need: funded.minTradingDays,
    },
    winDays: {
      pass: false,
      have: state.winDaysCount,
      need: funded.winDaysRequiredCount,
      floorCents: funded.winDayFloorCents,
    },
    buffer: {
      pass: false,
      haveCents: state.balanceCents - plan.sizeCents,
      needCents: funded.bufferCents,
    },
    consistency: {
      pass: false,
      skipped: false,
      bestDayShareBp: null,
      maxDayShareBp: null,
      profitNeededToDiluteCents: 0n,
    },
    cadenceGap: {
      pass: false,
      skipped: false,
      tradingDaysSinceLastPayout: null,
      need: funded.cadenceGapTradingDays,
      nextEligibleTradingDay: null,
    },
    minimumAmount: {
      pass: false,
      withdrawableCents: state.withdrawableCents,
      capCents: 0n,
      minPayoutCents: funded.minPayoutCents,
    },
  };
}

// =============================================================================
// R-38 AND R-40 ARE NOT IN THIS FILE, AND R-38 IS A REAL TENSION
// =============================================================================
// R-40 is straightforward: it IS the context gate set (account active and phase
// funded, KYC verified, not frozen, not recon blocked), M01 says it is
// "evaluated at read time, EXCLUDED FROM THE REPLAYED STATE", and INV-23 makes
// that structural. It belongs with `evaluatePayout`.
//
// R-38 IS FILED UNDER "GROUP F: FUNDED GATES" AND ITS INPUT IS CONTEXT. M01
// section 2.1 puts `hasPayoutInFlight` in `ExternalGates`, the record whose own
// comment reads "context, never replayed (INV-23)", so it cannot be a term in
// `engineGates` without putting an unreplayable fact into the replayed state,
// which is the divergence storm SD-06 exists to prevent. AS-01 meanwhile calls
// it "part of eligibility", and API_CONTRACT's `gates` object -- which M01
// section 2.2 names as the shape of `FullGateResults` -- CARRIES NO IN-FLIGHT
// ENTRY AT ALL, surfacing it instead as `POST /accounts/:id/payout`'s `conflict`
// error and as the SD-09 partial unique index.
//
// So all three documents agree on the MECHANISM and disagree on the FILING. The
// engine's half is decided by the input: an unreplayable fact cannot enter
// `RuleState`. It lands with `evaluatePayout` when that function does, and the
// filing discrepancy is reported rather than resolved here, because moving R-38
// out of group F is an edit to a frozen document.
// =============================================================================
