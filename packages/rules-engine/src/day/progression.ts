// =============================================================================
// packages/rules-engine/src/day/progression.ts
// =============================================================================
// DO-8, THE EVAL HALF. M01 section 3.1: "Eval: test the pass condition and
// either pass (APPLYING THE FUNDED RESET IN THE SAME STEP) or defer."
//
//   R-26  `closing_balance_cents - size_cents >= profit_target_cents`   `>=`
//   R-27  `tradedDaysCount >= min_trading_days`                         `>=`
//   R-28  consistency is tested ONLY on days where R-26 and R-27 already hold,
//         and failing DEFERS the pass. It never fails an account
//   R-29  the cross multiplication, in `consistency.ts`
//   R-30  the denominator rule, in `consistency.ts`
//   R-31  the funded reset, applied in the same step as the pass
//
// R-32 REFUSES, AND THE COUNT IS THE POINT. See the block above the refusal.
//
// DO-8's FUNDED HALF IS NOT HERE AND IS NOT MISSING. Section 3.1: "Funded: test
// the ladder, WHICH CAN ALSO FIRE HERE IF A SETTLEMENT GRADUATED THE ACCOUNT."
// R-49 fires only after a settlement, so `payout/settle.ts` evaluates it inside
// `applySettlement` at DO-2 and a graduated account returns from there. So there
// is still no funded day this file could have anything to say about, and a
// funded branch here would be a branch no input reaches.
//
// -----------------------------------------------------------------------------
// THE PASS TEST IS STATELESS AND IS RE-EVALUATED FROM SCRATCH EVERY DAY
// -----------------------------------------------------------------------------
// M01 section 3.2: `eval_target_pending` "is a real state and not a formality",
// and yet "the account can move back to `eval_open` implicitly if a losing day
// drops it under the target, and can return again; THIS IS NOT A STATE CHANGE
// WORTH DRAWING because the pass test is stateless and re-evaluated from scratch
// each day (R-26)."
//
// So nothing here records that a pass was deferred. A deferral emits an event
// and changes no field. A future session tempted to add `passDeferred: boolean`
// to `RuleState` should read that paragraph first: the flag would be a second,
// staler answer to a question the arithmetic already answers on every day.
// =============================================================================

import { nextTradingDayAfter } from '../calendar.js';
import type {
  AssertionFailure,
  CalendarSlice,
  DailyMark,
  EvalPhaseRules,
  PassDeferredConsistencyEvent,
  PhasePassedEvent,
  ResolvedPlan,
  RuleState,
} from '../types.js';
import { consistencyOk } from './consistency.js';
import { initialFloorCents } from './floor.js';

/**
 * What DO-8 did with an eval-phase day. Four outcomes and they are genuinely
 * four: nothing happened, the pass deferred, the pass fired, or the day refused.
 */
export type ProgressionOutcome =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'deferred'; readonly event: PassDeferredConsistencyEvent }
  | { readonly kind: 'passed'; readonly state: RuleState; readonly event: PhasePassedEvent }
  | { readonly kind: 'refused'; readonly assertion: AssertionFailure };

export interface ProgressionInput {
  /** The state as DO-7 left it: counters advanced, floor trailed, lock evaluated. */
  readonly state: RuleState;
  readonly plan: ResolvedPlan;
  readonly evalRules: EvalPhaseRules;
  readonly mark: DailyMark;
  readonly calendar: CalendarSlice;
}

/** DO-8 on an eval-phase day. */
export function advanceEvalProgression(input: ProgressionInput): ProgressionOutcome {
  const { state, plan, evalRules, mark, calendar } = input;

  // ---------------------------------------------------------------------------
  // R-32  EVAL EXPIRY, AND THIS REFUSES RATHER THAN COMPUTING
  // ---------------------------------------------------------------------------
  // R-32 is "elapsed trading days `>` `phase_eval.max_days` expires the
  // account", and ELAPSED TRADING DAYS IS NOT DERIVABLE FROM `RuleState`. The
  // record M01 section 2.2 specifies carries no account-open day and no
  // eval-start day: `tradingDay` is the day just folded, `tradedDaysCount`
  // counts days WITH FILLS and is a different quantity by R-08, and no anchor
  // points at the open. Counting elapsed trading days needs the open day and a
  // calendar spanning it, which is R-02's `sequence` subtraction.
  //
  // SESSION 45 CONCLUDED "SO IT IS A COLUMN ON `rule_states`, A SCHEMA DELTA
  // AND AN ADR", AND SESSION 47 CHECKED THAT AGAINST THE SCHEMA AND WITHDREW IT.
  // The datum is already stored, twice, and neither copy is on this record:
  //
  //   * `accounts.opened_on date NOT NULL` (`0007_accounts.sql:76`), declared
  //     `**Unit: trading day**` in `data-model/accounts.md:16`. It is not null,
  //     it never moves, and it is exactly R-02's `sequence` anchor.
  //   * `accounts.expires_on date NULL` (`0007_accounts.sql:90`), "eval expiry
  //     when configured", which is `max_days` already materialised as a date.
  //
  // AND M01'S OWN PUBLIC SURFACE ALREADY TREATS THE OPEN DAY AS AN ENGINE INPUT:
  // section 1.3 is `initialState(plan: ResolvedPlan, openedOn: TradingDay)`. The
  // engine is HANDED the open day at construction and drops it; `initialState`
  // writes it to `tradingDay`, which the next fold overwrites. So the gap is not
  // a fact the engine lacks. It is a field `DayInput` does not carry, and the
  // golden fixture format has carried `account.opened_on` all along, on the
  // loader's "reaches no engine input" list that STATE.md item 3 says M01 empties.
  //
  // WHAT R-32 ACTUALLY NEEDS IS ONE FIELD ON `DayInput`, WHICH IS AN AMENDMENT
  // TO M01 SECTION 2.1 AND NOT A MIGRATION. That is still an ADR, because
  // `DayInput` is specified in a frozen document, and it is still the founder's.
  // But no `rule_states` column is required, no `SD-nn` is required, and no
  // migration number should be reserved for it: a number reserved against a
  // migration that should not be written is worse than no number, because a
  // migration is sacred once merged and can only be superseded (E2).
  //
  // TWO THINGS ARE GENUINELY UNRULED AND THE REFUSAL STANDS ON THEM RATHER THAN
  // ON THE SCHEMA. First, the ANCHOR: R-32 and `G-EXPIRED` both say "elapsed
  // trading days" and neither names the day they elapse from, and an account
  // sits in `provisioning_pending` before it is `active`, so an eval clock
  // anchored at `opened_on` can burn days the trader could not trade. Second,
  // WHICH COLUMN IS AUTHORITATIVE: R-32 and `G-EXPIRED` describe a COUNT against
  // `max_days`, and `accounts.expires_on` is a stored DATE for the same fact.
  // Two artifacts, two shapes, and the corpus does not say which one binds.
  //
  // WHY REFUSE RATHER THAN IGNORE. `max_days` is `null` on all three v1 plans
  // (R-32: "so unreachable"), so nothing in the lineup reaches this line. But a
  // plan that DID set it would otherwise fold every day and expire nothing,
  // which is an account trading past its own expiry with a green state row: a
  // wrong number returned confidently on a money path, which is the exact shape
  // FM-05 and AS-14 refuse. A refusal writes no state and raises reconciliation.
  if (evalRules.maxDays !== null) {
    return {
      kind: 'refused',
      assertion: {
        kind: 'eval_expiry_unimplemented',
        tradingDay: mark.tradingDay,
        detail:
          `phase_eval.max_days is ${String(evalRules.maxDays)} and R-32's elapsed-trading-day ` +
          `count is not derivable from RuleState, which carries no account-open day`,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // R-26 and R-27  the pass condition
  // ---------------------------------------------------------------------------
  // GS-017 pins the tie (`300,000 >= 300,000` passes) and GS-018 pins the other
  // side (`299,999 >= 300,000` is false). The profit is measured against
  // `size_cents` and not against the opening balance, so a day that gives back
  // profit is tested on where it ENDED.
  const profitCents = mark.closingBalanceCents - plan.sizeCents;
  const targetMet = profitCents >= evalRules.profitTargetCents;

  // R-27 reads the count DO-6 already advanced, so the pass day counts itself.
  const daysMet = state.tradedDaysCount >= evalRules.minTradingDays;

  if (!targetMet || !daysMet) return { kind: 'unchanged' };

  // ---------------------------------------------------------------------------
  // R-28  consistency, and ONLY now
  // ---------------------------------------------------------------------------
  // "Tested only on days where R-26 and R-27 already hold." That ordering is the
  // rule and not an optimisation: a consistency verdict computed on a day that
  // has not met the target would defer nothing and would still emit an event
  // telling the trader their consistency is the problem, on a day where the
  // target is.
  const verdict = consistencyOk(
    state.consistencyBestDayCents,
    state.consistencyPeriodProfitCents,
    evalRules.consistency,
  );

  if (!verdict.ok) {
    // R-28 AGAIN, BECAUSE IT IS THE HALF THAT GETS LOST: this is a DEFERRAL.
    // "It never fails an account. It delays the pass, the trader keeps trading,
    // and every day the engine re-tests." No field of `state` moves.
    //
    // Both shares are non-null here by construction: a verdict that is not `ok`
    // came from an enabled gate that R-30 did not skip, which is the only branch
    // that computes them.
    const event: PassDeferredConsistencyEvent = {
      type: 'phase.pass_deferred_consistency',
      tradingDay: mark.tradingDay,
      bestDayShareBp: verdict.bestDayShareBp ?? 0,
      maxDayShareBp: verdict.maxDayShareBp ?? 0,
      shortfallCents: verdict.profitNeededToDiluteCents,
    };
    return { kind: 'deferred', event };
  }

  // ---------------------------------------------------------------------------
  // R-31  the funded reset, in the same step as the pass
  // ---------------------------------------------------------------------------
  // AS-12's off-by-one is decided here and nowhere else: the new consistency
  // period starts at the trading day STRICTLY AFTER the pass day, so "the same
  // rule applies at funded start, where the eval pass day is excluded". A slice
  // that ends on the pass day cannot answer, and ADR-049 rules that a typed
  // refusal, not a null and not a throw.
  const nextDay = nextTradingDayAfter(calendar, mark.tradingDay);
  if (!nextDay.found) {
    return {
      kind: 'refused',
      assertion: {
        kind: 'calendar_coverage_miss',
        tradingDay: mark.tradingDay,
        detail:
          `the eval passed on ${mark.tradingDay} and R-31's consistency period starts on the ` +
          `next trading day, which is outside the slice's coverage ` +
          `${calendar.coverage.from}..${calendar.coverage.to}`,
      },
    };
  }

  // R-12's second half: "at account open, AND AGAIN AT THE FUNDED RESET WITH THE
  // FUNDED DRAWDOWN". GS-019 pins the pair on CORE-50K: balance to 5,000,000 and
  // floor to 4,750,000 = 5,000,000 - 250,000.
  const resetFloorCents = initialFloorCents(plan.sizeCents, plan.funded.drawdown.drawdownCents);

  // -----------------------------------------------------------------------------
  // TWO FIELDS R-31's SENTENCE DOES NOT NAME, AND BOTH HAD TO BE ANSWERED
  // -----------------------------------------------------------------------------
  // `floorLocked` GOES TO FALSE. R-31 lists balance, hwb, floor and the counters
  // and stops. The floor machine answers the rest: section 3.4 starts the machine
  // at `[*] --> trailing: R-12, floor = size - drawdown`, and R-12's own text
  // names the funded reset as one of its two entry points. A funded account that
  // arrived carrying `floorLocked` from the eval phase would have `hwb` frozen at
  // `size_cents` and R-13 guarded off for the rest of its life, so its floor
  // could never trail and the lock could never re-engage at the funded
  // `floor_lock_at_profit_cents`. That is not a reading of R-31, it is the funded
  // floor deleted.
  //
  // AND THE LOCK REACHES THE EVAL PHASE ON EVERY V1 PLAN, so this is a live path
  // rather than a hypothetical: Core EOD locks at 260,000c of profit and its eval
  // target is 300,000c, so an account that passes has ALREADY locked at DO-7 on
  // the pass day itself.
  //
  // `floorOpenCents` IS LEFT ALONE. SD-04 defines it as "the floor THIS day's
  // breach check compared against", the check happened at DO-4 against the eval
  // floor, and that is the number the evidence pack must be able to show. It
  // records what was, not what is.
  //
  // -----------------------------------------------------------------------------
  // THE FLOOR MOVES DOWN HERE, AND ADR-050 IS THE EXCEPTION THAT SAYS IT MAY
  // -----------------------------------------------------------------------------
  // INV-06 read "the floor never decreases. NO EXCEPTION, no phase qualifier, no
  // settlement carve-out", and this step lowers it on every Core EOD pass. The
  // funded floor is 4,750,000c and the eval floor is AT LEAST the locked
  // 5,010,000c, because the lock triggers at 260,000c of profit and the eval
  // target is 300,000c, so every v1 eval pass is also a lock day. The fall is at
  // least 260,000c and is usually larger, because section 3.4's `max` leaves the
  // floor at the TRAILED value on a day that jumps past the trigger: GS-019
  // closes at 5,400,000c, reaches a floor of 5,150,000c, and falls 400,000c.
  //
  // THIS FILE ALWAYS FOLLOWED THE SPECIFIC RULES AND THEY HAVE NOT MOVED: R-12
  // states the funded-reset floor, R-31 states it again, and GS-019 pins the
  // number. What moved is the invariant. ADR-050 amends INV-06 to
  //
  //   the floor never decreases, EXCEPT at the R-31 funded reset, where it is
  //   initialised to `size_cents` minus the funded drawdown
  //
  // and the ruling's reasoning is worth the four lines it costs, because a
  // reader who does not have it will try to restore the absolute form. "No
  // exception, no phase qualifier" exists to prevent UNSTATED exceptions, and a
  // single named, cited, testable exception is the opposite of what that clause
  // guards against. Scoping INV-06 per (account, phase) instead would make it
  // technically true by redefining its domain, which hides this same fall and
  // makes every future reader reconstruct why. And ADR-014's permanent lock is
  // about SETTLEMENT never resetting the floor; R-31 is a phase transition, and
  // the balance falls to `size_cents` in the same step, so no loss room narrows.
  //
  // SESSION 47 CLOSED OFF THE READING THAT WOULD HAVE AVOIDED THE AMENDMENT.
  // The hypothesis was that "or provisioning a new one" makes the funded account
  // a NEW account, so nothing decreases within one. Five primary sources refuse
  // it: M02's DEP-M2-01 names the subject as THE PLATFORM ACCOUNT, STATE_MACHINES
  // draws `eval_phase --> funded_phase` inside one account's `active` state,
  // `accounts.phase` is one column on one row with `purchase_id NOT NULL UNIQUE`,
  // `rule_states` is unique on `(account_id, trading_day)` and carries `phase`
  // per day, and `platform_account_refs` is how one Merit account holds
  // successive PLATFORM refs. So per account is already the corpus's meaning,
  // which is exactly why it could not rescue R-31.
  //
  // RE-P-01 NOW PINS THIS STEP RATHER THAN SKIPPING IT. `floor-monotonicity.
  // property.test.ts` asserts `floor(d+1) >= floor(d)` on every step that emits
  // no `phase.passed`, and on the step that does it asserts the floor EQUALS
  // `size_cents - funded drawdown_cents` exactly. An exception that merely
  // excused a decrease here would let any decrease through on a pass day, which
  // is the unstated exception INV-06 forbids.
  //
  // DO-7's INV-06 TRIPWIRE IS NOT WEAKENED AND MUST NOT BE. It compares within
  // one day's trail-then-lock and never sees this step, which is correct: the
  // tripwire exists to catch a future edit to `advanceFloor`, and widening it to
  // span the reset would make it fire on the corpus's own arithmetic.
  const passedState: RuleState = {
    ...state,
    phase: 'funded',
    balanceCents: plan.sizeCents,
    highWaterBalanceCents: plan.sizeCents,
    floorCents: resetFloorCents,
    floorLocked: false,
    tradedDaysCount: 0,
    winDaysCount: 0,
    consistencyBestDayCents: 0n,
    consistencyPeriodProfitCents: 0n,
    consistencyPeriodStartDay: nextDay.day.tradingDay,
  };

  const event: PhasePassedEvent = {
    type: 'phase.passed',
    tradingDay: mark.tradingDay,
    fromPhase: 'eval',
    toPhase: 'funded',
    closingBalanceCents: mark.closingBalanceCents,
    targetCents: evalRules.profitTargetCents,
    resetBalanceCents: passedState.balanceCents,
    resetFloorCents: passedState.floorCents,
    consistencyPeriodStartDay: nextDay.day.tradingDay,
    consistency: {
      bestDayShareBp: verdict.bestDayShareBp,
      maxDayShareBp: verdict.maxDayShareBp,
      satisfied: verdict.ok,
      skipped: verdict.skipped,
    },
  };

  return { kind: 'passed', state: passedState, event };
}
