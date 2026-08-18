// =============================================================================
// packages/rules-engine/test/settlement-fold.ts
// =============================================================================
// THE HARNESS THE TWO SETTLEMENT-DRIVEN PROPERTIES SHARE. `PT-02` (win days
// never decrease except at a payout reset) and `PT-08` (the lifetime bound) are
// STRATEGY section 3.1 rows 2 and 8, they are one session's work for one
// reason, and it is this file: both need a settlement stream folded through the
// real `advanceDay`, and building that twice would make the two properties
// agree with each other rather than with the engine.
//
// -----------------------------------------------------------------------------
// THIS IS THE THIRD COPY OF THREE HELPERS AND THE COLLAPSE IS A LATER SESSION'S
// -----------------------------------------------------------------------------
// `materializedFrom`, `toEngineMark` and `sliceOf` below are duplicates. Named
// in full, because a note that does not name the other copies is a note the
// collapse session cannot act on:
//
//   ORIGINALS, private to PT-01's file
//     `materializedFrom`  test/floor-monotonicity.property.test.ts:143
//     `toEngineMark`      test/floor-monotonicity.property.test.ts:252
//     `sliceOf`           test/floor-monotonicity.property.test.ts:264
//   SECOND COPY  test/property-harness.ts, session 62's, carrying all three for
//                PT-04 and PT-07
//   THIRD COPY   this file, session 63's, for PT-02 and PT-08
//
// THE END STATE IS ONE MODULE IMPORTED BY ALL THREE, and it is a follow-up
// session rather than this one because every one of those files is inside
// somebody's fence right now: PT-01's file is frozen to both concurrent
// sessions, `property-harness.ts` is session 62's to write, and this file is
// session 63's. A session that reached across would be resolving a conflict by
// overwriting rather than by merging.
//
// TWO FILES INSIDE ONE SESSION SHARING A HELPER IS NOT SPECULATIVE ABSTRACTION,
// which is the reason this file exists at all rather than the helpers being
// inlined twice into the two suites that need them.
//
// -----------------------------------------------------------------------------
// THE FOLD STARTS FUNDED, AND THAT IS A STATEMENT ABOUT R-31 RATHER THAN A
// CONVENIENCE
// -----------------------------------------------------------------------------
// `foldSettlements` starts from `fundedPrior` by default. Win days are a
// FUNDED-phase counter: R-40's payout gate reads them and R-47 resets them, and
// both live after the transition. A funded start makes the payout reset the ONLY
// reset in the fold, which is PT-02's sentence exactly.
//
// IT DOES NOT MAKE R-31 GO AWAY AND THE PROPERTY MUST NOT PRETEND IT DOES.
// `src/day/progression.ts` zeroes `winDaysCount` inside `passedState` at the
// R-31 funded reset, so the engine has TWO resets where PT-02's row names one.
// `evalStart: true` folds from `prior: null` so that second exception is
// reachable and can be asserted rather than excused; `win-days-monotonicity.
// property.test.ts` carries the finding in full.
// =============================================================================

import fc from 'fast-check';

import {
  advanceDay,
  buildCalendarSlice,
  initialState,
  type CalendarSlice,
  type Cents,
  type DailyMark,
  type ResolvedPlan,
  type RuleState,
  type SettlementFact,
  type TradingDay,
} from '../src/index.js';
import { ENGINE_VERSION, fundedPrior } from './fixtures-in-code.js';
import type { DaySequence, DailyMark as GeneratedMark } from './generators/day-input.js';
import { daySequenceArbitrary } from './generators/day-sequence.js';
import type { MaterializedPlan } from './generators/plan-config.js';
import { settlementSequenceArbitrary } from './generators/settlement-sequence.js';
import type {
  SettlementFact as GeneratedSettlement,
  SettlementSequence,
  SsRuleId,
} from './generators/validate-settlement-sequence.js';

// -----------------------------------------------------------------------------
// RESOLVED -> MATERIALIZED
// -----------------------------------------------------------------------------
// `daySequenceArbitrary` and `settlementSequenceArbitrary` take a
// `MaterializedPlan`, which is the shape a published plan has at publish time,
// and the fold takes a `ResolvedPlan`. This direction is the safe one: its
// output feeds a GENERATOR and never a rule. The other direction is
// `resolvePlan`, it is P2-1's, and a second copy of it in test code would be a
// rule derived twice.
//
// `chainMarks` reads exactly two fields off the plan -- `size_cents` for
// INV-20's first-day opening balance and `phase_funded.win_days.
// win_day_floor_cents` for R-09's `win_day` column -- and both properties assert
// that those two agree with the fold's own plan, so a drift fails by name rather
// than as an unexplained refusal in the middle of a fold.

export function materializedFrom(plan: ResolvedPlan): MaterializedPlan {
  const evalRules = plan.eval;
  if (evalRules === null) {
    // Direct is the plan with no evaluation phase (M01 Appendix A.3). Neither
    // property folds it, and a projection that silently invented an eval block
    // would hide that rather than report it.
    throw new Error('this harness folds plans with an evaluation phase');
  }

  const drawdown = (
    rules: ResolvedPlan['funded']['drawdown'],
  ): MaterializedPlan['phase_funded']['drawdown'] => ({
    type: rules.type,
    drawdown_cents: Number(rules.drawdownCents),
    lock: rules.lock.enabled
      ? {
          enabled: true,
          at_profit_cents: Number(rules.lock.atProfitCents),
          floor_at_cents: Number(rules.lock.floorAtCents),
        }
      : { enabled: false, at_profit_cents: null, floor_at_cents: null },
  });

  const limit = (
    rules: ResolvedPlan['funded']['dailyLossLimit'],
  ): MaterializedPlan['phase_funded']['daily_loss_limit'] =>
    rules.type === 'none'
      ? { type: 'none', amount_cents: null }
      : { type: rules.type, amount_cents: Number(rules.limitCents) };

  return {
    schema_version: 1,
    size_cents: Number(plan.sizeCents),
    phase_eval: {
      enabled: true,
      profit_target_cents: Number(evalRules.profitTargetCents),
      drawdown: drawdown(evalRules.drawdown),
      daily_loss_limit: limit(evalRules.dailyLossLimit),
      min_trading_days: evalRules.minTradingDays,
      consistency: evalRules.consistency.enabled
        ? {
            enabled: true,
            max_day_share_bp: Number(evalRules.consistency.maxDayShareBp),
            // R-28: eval consistency is tested at pass time and is dilutable.
            mode: 'pass_time_dilutable',
          }
        : { enabled: false, max_day_share_bp: null, mode: 'pass_time_dilutable' },
      max_days: evalRules.maxDays,
    },
    phase_funded: {
      drawdown: drawdown(plan.funded.drawdown),
      daily_loss_limit: limit(plan.funded.dailyLossLimit),
      min_trading_days: plan.funded.minTradingDays,
      win_days: {
        required_count: plan.funded.winDaysRequiredCount,
        win_day_floor_cents: Number(plan.funded.winDayFloorCents),
        // R-47: the counter goes to zero on every settlement, unconditionally.
        // `ResolvedPlan` carries no switch for it because the rule has none.
        reset_on_payout: true,
      },
      consistency: plan.funded.consistency.enabled
        ? {
            enabled: true,
            max_day_share_bp: Number(plan.funded.consistency.maxDayShareBp),
            // R-36: funded consistency is a payout gate.
            mode: 'payout_gated',
          }
        : { enabled: false, max_day_share_bp: null, mode: 'payout_gated' },
      buffer_cents: Number(plan.funded.bufferCents),
      cadence_gap_trading_days: plan.funded.cadenceGapTradingDays,
      payout_cap_schedule: plan.funded.payoutCapSchedule.map((step) => ({
        from_ordinal: step.fromOrdinal,
        cap_cents: Number(step.capCents),
      })),
      min_payout_cents: Number(plan.funded.minPayoutCents),
      split_bp: Number(plan.funded.splitBp),
      max_payouts: plan.funded.maxPayouts,
      // CV-18, retired but retained: `none` is the single valid v1 value
      // (ADR-014).
      post_payout_floor_rule: { mode: 'none' },
    },
  };
}

export const toEngineMark = (m: GeneratedMark): DailyMark => ({
  tradingDay: m.tradingDay as TradingDay,
  openingBalanceCents: BigInt(m.openingBalanceCents) as Cents,
  closingBalanceCents: BigInt(m.closingBalanceCents) as Cents,
  highBalanceCents: BigInt(m.highBalanceCents) as Cents,
  lowBalanceCents: BigInt(m.lowBalanceCents) as Cents,
  realizedPnlCents: BigInt(m.realizedPnlCents) as Cents,
  adjustmentCents: BigInt(m.adjustmentCents) as Cents,
  fillCount: m.fillCount,
  sourceHash: m.sourceHash,
});

export const sliceOf = (seq: DaySequence): CalendarSlice =>
  buildCalendarSlice({
    days: seq.calendar.days.map((d) => ({ ...d, tradingDay: d.tradingDay as TradingDay })),
    coverage: {
      from: seq.calendar.coverage.from as TradingDay,
      to: seq.calendar.coverage.to as TradingDay,
    },
  });

/**
 * The oracle's settlement, projected onto the five fields `src/types.ts`'s
 * `SettlementFact` declares.
 *
 * `requestedCents`, `traderCents` and `firmCents` are dropped rather than
 * carried, and that is the engine's own boundary rather than this file's: R-44's
 * split is `evaluatePayout`'s and `applySettlement` reads only the approved
 * amount and the two anchors. A projection that carried the legs would suggest
 * the fold checks them, and it does not.
 */
export const toEngineSettlement = (s: GeneratedSettlement): SettlementFact => ({
  payoutRequestId: s.payoutRequestId,
  ordinal: s.ordinal,
  approvedCents: BigInt(s.approvedCents) as Cents,
  basisTradingDay: s.basisTradingDay as TradingDay,
  effectiveTradingDay: s.effectiveTradingDay as TradingDay,
});

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The calendar day before `day`, which is where the fold's prior state sits.
 *
 * `day-sequence.ts` states the licence and it is inherited verbatim: B4 #1
 * forbids the ENGINE deriving a trading day from a timestamp, this is test
 * material, `Date.UTC` is used as a calendar rather than as a clock, and the
 * process timezone cannot reach it.
 *
 * IT DOES NOT HAVE TO BE A SESSION. Nothing reads it but DO-1's `mark.tradingDay
 * <= prior.tradingDay` refusal and R-32's elapsed count, and both are
 * comparisons rather than lookups.
 */
export function dayBefore(day: string): TradingDay {
  const m = ISO_DAY.exec(day);
  if (m === null) throw new Error(`not an ISO day: ${day}`);
  const utc = Date.UTC(Number(m[1]!), Number(m[2]!) - 1, Number(m[3]!));
  return new Date(utc - 86_400_000).toISOString().slice(0, 10) as TradingDay;
}

// -----------------------------------------------------------------------------
// The arbitrary
// -----------------------------------------------------------------------------

export interface SettlementFoldOptions {
  /**
   * Passed through to `settlementSequenceArbitrary`. Empty for an ordinary
   * stream; `INV-17/lifetime-bound` for the OVER-LADDER stream PT-08 needs, in
   * which the generator emits `max_payouts + 1` settlements every one of which
   * sits at its cap.
   */
  readonly omit?: ReadonlySet<SsRuleId> | undefined;
}

/**
 * Which phase's day rules DO-6 counted against.
 *
 * `advanceDay` picks `rules` as `phase === 'eval' ? (plan.eval ?? plan.funded) :
 * plan.funded`, off the POST-SETTLEMENT state. A settlement cannot move the
 * phase except by graduating the account, and a graduated day never reaches
 * DO-6, so the prior state's phase is the one that decided the floor.
 */
function settledPhaseOf(prior: RuleState | null, plan: ResolvedPlan): RuleState['phase'] {
  if (prior !== null) return prior.phase;
  return plan.eval === null ? 'funded' : 'eval';
}

/**
 * A day sequence on `plan`, with a settlement stream attached to it.
 *
 * THE DAYS ARE DRAWN FIRST AND THE SETTLEMENTS SECOND, which is the order
 * `settlement-sequence.ts` documents for exactly this caller: "a caller that
 * supplies one is usually a `PT-nn` suite that has already drawn the days and
 * needs the settlements to agree with them." The generator then rebuilds the
 * balance chain so each withdrawal lands in `adjustmentCents` at the open of its
 * effective day (R-10, SD-01), which is what makes INV-18 close at DO-3.
 */
export function settlementFoldArbitrary(
  plan: ResolvedPlan,
  options: SettlementFoldOptions = {},
): fc.Arbitrary<SettlementSequence> {
  const materialized = materializedFrom(plan);
  const omit = options.omit;
  return daySequenceArbitrary({ plan: materialized }).chain((days) =>
    // Built in two branches rather than one, because `exactOptionalPropertyTypes`
    // makes `{ omit: undefined }` a different thing from an absent `omit` and the
    // generator's default is the absent one.
    omit === undefined
      ? settlementSequenceArbitrary({ days })
      : settlementSequenceArbitrary({ days, omit }),
  );
}

// -----------------------------------------------------------------------------
// The fold
// -----------------------------------------------------------------------------

/** One folded day, reduced to what PT-02 and PT-08 read. */
export interface Step {
  readonly tradingDay: TradingDay;
  /** The count the day started from: the prior state's, or zero on a funded start. */
  readonly winDaysBefore: number;
  readonly winDaysAfter: number;
  /** True on the steps R-47's exception applies to. Read off the ENGINE's events. */
  readonly reset: boolean;
  /** True on the steps R-31's exception applies to. The second exception. */
  readonly passed: boolean;
  readonly graduated: boolean;
  /** R-24 and R-25. DO-5 returns, so DO-6 never ran on this day. */
  readonly breached: boolean;
  /** R-09 with R-04, re-derived from M01's own expression rather than from the engine. */
  readonly winDayToday: boolean;
  /**
   * The mark's own `win_day` COLUMN, which is not the same predicate.
   *
   * `0014`'s `daily_marks_win_day_implies_traded` makes the stored column false
   * on an untraded day whatever the pnl was, and `day-sequence.ts` writes it as
   * `tradedDay && clearsFloor` for that reason. R-09 as M01 states it and as
   * `src/day/counters.ts` implements it has no traded-day clause, so the two
   * disagree on a day with zero fills whose realized pnl clears the floor.
   * Carried so a property can measure the disagreement instead of inheriting it.
   */
  readonly winDayColumn: boolean;
  /**
   * Whether the day reached DO-6 at all.
   *
   * TWO ORDERING LAWS TAKE A DAY OUT BEFORE ITS COUNTERS ADVANCE, and a property
   * that assumed DO-6 always runs would report both as defects. R-25 is
   * "breach beats everything on the same day", and DO-5's row reads "nothing
   * after this runs"; R-49's graduation returns at DO-2 for M01 section 3.6's
   * reason, "no trading day follows". On either day the stored counters are the
   * ones DO-2 left, and the day's own win day is not among them.
   */
  readonly reachedCounters: boolean;
  /** The settlements DO-2 applied on this day, in the order the engine sorted them. */
  readonly applied: readonly SettlementFact[];
  /** The state DO-2 was handed, so a property can re-run `applySettlement` on it. */
  readonly stateBefore: RuleState;
  readonly lifetimeSettledCents: Cents;
  readonly payoutsSettledCount: number;
  readonly phaseAfter: RuleState['phase'];
}

export interface Fold {
  readonly steps: readonly Step[];
  /** The day the fold stopped on, or null if every mark folded. */
  readonly endedOn: { readonly tradingDay: TradingDay; readonly kind: string } | null;
  /** The calendar slice the fold ran against, so a property can re-call the engine. */
  readonly calendar: CalendarSlice;
}

export interface FoldOptions {
  /**
   * Fold from `prior: null`, so `initialState` opens the account in `eval` and
   * the R-31 funded reset becomes reachable. Default `false`: the fold starts
   * FUNDED, where the payout reset is the only reset.
   */
  readonly evalStart?: boolean | undefined;
}

/**
 * Fold one generated settlement sequence through the real engine.
 *
 * The fold stops at the first refusal and at the first terminal phase, which is
 * PT-01's idiom and its reason: no state is written for a refused day, so there
 * is nothing to compare, and R-24 and R-49 mean no state is ever written again.
 * A generated sequence chains balances forward through a reset it knows nothing
 * about, so an eval pass is followed by a DO-3 refusal; that refusal is correct
 * and is not either property's subject.
 */
export function foldSettlements(
  plan: ResolvedPlan,
  seq: SettlementSequence,
  options: FoldOptions = {},
): Fold {
  const days = seq.days;
  const calendar = sliceOf(days);
  const steps: Step[] = [];

  if (days.marks.length === 0) return { steps, endedOn: null, calendar };

  const openedOn = dayBefore(days.marks[0]!.tradingDay);
  let prior: RuleState | null = options.evalStart
    ? null
    : fundedPrior(plan, { tradingDay: openedOn });

  // DO-2 applies "each settlement whose `effectiveTradingDay` equals today", so
  // the stream is bucketed by that day and never by the basis day. The two are
  // different dates and conflating them is EC-039's 40 percent liability change.
  const byEffectiveDay = new Map<string, SettlementFact[]>();
  for (const s of seq.settlements) {
    const bucket = byEffectiveDay.get(s.effectiveTradingDay) ?? [];
    bucket.push(toEngineSettlement(s));
    byEffectiveDay.set(s.effectiveTradingDay, bucket);
  }

  const halted = new Map(days.calendar.days.map((d) => [d.tradingDay, d.halted]));

  for (const generated of days.marks) {
    const mark = toEngineMark(generated);
    const settlements = byEffectiveDay.get(generated.tradingDay) ?? [];
    // The engine's own comparator at DO-2. Sorted here too so `applied` records
    // the order the rules ran in, which is what a property re-running
    // `applySettlement` has to reproduce.
    const inOrdinalOrder = [...settlements].sort((a, b) => a.ordinal - b.ordinal);

    const stateBefore = prior ?? null;
    const out = advanceDay({
      engineVersion: ENGINE_VERSION,
      plan,
      prior,
      mark,
      calendar,
      settlements: inOrdinalOrder,
      openedOn,
    });

    if (out.assertions.length > 0) {
      return {
        steps,
        endedOn: {
          tradingDay: mark.tradingDay,
          kind: out.assertions.map((a) => a.kind).join(', '),
        },
        calendar,
      };
    }

    // R-09 with R-04, transcribed from M01's own expression, which
    // `src/day/counters.ts` carries verbatim: `realized_pnl_cents >=
    // win_day_floor_cents`, `>=`, AND NOT on a halted session. Re-derived here
    // rather than read off the engine, because a property that read the engine's
    // own answer for the day would be checking the engine against itself.
    //
    // IT IS DERIVED FROM THE PNL AND NOT FROM THE MARK'S `winDay` COLUMN, and
    // that distinction was found by writing it the other way and watching this
    // property go red on a real sequence. The column carries `0014`'s
    // `daily_marks_win_day_implies_traded` as well as R-09, so it is false on an
    // untraded day the rule counts. See `winDayColumn`.
    const winDayFloorCents = (
      settledPhaseOf(prior, plan) === 'eval' ? (plan.eval ?? plan.funded) : plan.funded
    ).winDayFloorCents;
    const winDayToday =
      BigInt(generated.realizedPnlCents) >= winDayFloorCents &&
      halted.get(generated.tradingDay) !== true;

    steps.push({
      tradingDay: out.state.tradingDay,
      winDaysBefore: stateBefore === null ? 0 : stateBefore.winDaysCount,
      winDaysAfter: out.state.winDaysCount,
      reset: out.events.some((e) => e.type === 'payout.win_days_reset'),
      passed: out.events.some((e) => e.type === 'phase.passed'),
      graduated: out.events.some((e) => e.type === 'account.graduated'),
      breached: out.events.some((e) => e.type === 'breach.detected'),
      winDayToday,
      winDayColumn: generated.winDay,
      reachedCounters:
        !out.events.some((e) => e.type === 'breach.detected') &&
        !out.events.some((e) => e.type === 'account.graduated'),
      applied: inOrdinalOrder,
      // DO-1's `input.prior ?? initialState(...)`. The ENGINE'S OWN
      // `initialState` is called rather than a second construction of the open
      // state, which is the "reimplement a rule slightly differently" M01
      // section 1.3 limits the export surface to prevent.
      stateBefore: stateBefore ?? initialState(plan, mark.tradingDay, ENGINE_VERSION),
      lifetimeSettledCents: out.state.lifetimeSettledCents,
      payoutsSettledCount: out.state.payoutsSettledCount,
      phaseAfter: out.state.phase,
    });

    prior = out.state;
    if (out.state.phase === 'closed' || out.state.phase === 'graduated') {
      // R-24 and R-49. Terminal: no further state is ever written.
      return { steps, endedOn: null, calendar };
    }
  }

  return { steps, endedOn: null, calendar };
}
