// =============================================================================
// packages/rules-engine/src/payout/project.ts
// =============================================================================
// [ADR-204](../../../docs/decisions/ADR-204.md) TRANSCRIBED, AND IT IS THE ONLY
// THING IN THIS FILE. Nine rulings and five assumptions were settled there; what
// is here is the call they describe, and every clause below cites the ruling it
// carries rather than restating it in this file's own words.
//
// -----------------------------------------------------------------------------
// WHAT M01 SECTION 4 NAMES, AND IN WHICH SENSE IT IS NOW CALLABLE
// -----------------------------------------------------------------------------
// `GET /admin/eligible-forecast`'s producer cell reads "`evaluatePayout`
// projected forward over the calendar". ADR-204 section 1 proves that sentence
// uncallable ON ITS LITERAL READING and M01's own third cell now says so: a
// forward `RuleState` comes only from `advanceDay`, whose `DayInput.mark` is a
// `DailyMark` R-06 guarantees does not exist. THIS FILE DOES NOT MAKE THAT CALL
// POSSIBLE AND NOTHING CAN. What it makes callable is the projection ADR-204
// rules in its place, and the difference is exactly one word: the STATE does not
// move forward, the cadence gate's BASIS DAY does.
//
// So `evaluatePayout` really is the evaluator here, called with the identical
// signature it has always had, over a state whose own `tradingDay` is untouched.
// `PayoutEvaluation.asOfTradingDay` therefore still reports the last closed day
// on every projected day, which is R-06 holding rather than being routed around.
//
// -----------------------------------------------------------------------------
// `evaluatePayout` IS NOT WIDENED, AND THE DOOR IS ADDITIVE
// -----------------------------------------------------------------------------
// `payout/evaluate.ts` is byte for byte unchanged by the diff that added this
// file. Every existing caller of that function -- `apps/worker`'s nightly batch,
// `apps/api`'s payout and account-read routes, `packages/harness`'s trial,
// `scripts/demo`'s fold, and the engine's own suites -- passes the same three
// arguments to the same code path and gets the same answer. A live payout
// decision cannot be reached from anything in this file.
//
// -----------------------------------------------------------------------------
// THE ASSUMPTIONS ARE CLAUSES, AND A PRODUCER MAY NOT CHOOSE THEM (RULING 6)
// -----------------------------------------------------------------------------
// Each of ADR-204's five is honoured HERE BY HOLDING A FIELD CONSTANT rather
// than by arithmetic, so none of them can be honoured approximately:
//
//   A1  no account trades inside the horizon      `tradedDaysCount`, `winDaysCount`
//                                                 and the consistency accumulators
//                                                 are carried, and so are the
//                                                 gates computed from them
//   A2  balances are the last closed day's        `balanceCents` and
//                                                 `withdrawableCents` are carried
//   A3  no context gate changes                   one `ExternalGates` is applied
//                                                 to every projected day
//   A4  no payout is requested or settles         `cadenceAnchorDay`,
//                                                 `payoutAnchorDay` and
//                                                 `payoutsSettledCount` are carried
//   A5  the pinned plan version does not change   one `ResolvedPlan`, for the whole
//                                                 horizon
//
// `PROJECTION_ASSUMPTIONS` carries all five out with every answer, in ADR-204
// section 5's own words, because ruling 7 requires both halves of the figure to
// be stated wherever it is shown and a table only this file can see is not that.
// =============================================================================

import { lookupCalendarDay } from '../calendar.ts';
import type {
  AssertionFailure,
  CadenceGapGate,
  CalendarSlice,
  Cents,
  ExternalGates,
  ResolvedPlan,
  RuleState,
  TradingDay,
} from '../types.ts';
import { evaluatePayout } from './evaluate.ts';
import { projectEngineGates } from './gates.ts';

/**
 * One of ADR-204 section 5's five, in that table's own words.
 *
 * BOTH COLUMNS TRAVEL AND NEITHER IS DERIVABLE FROM THE OTHER. Ruling 7 is that
 * the figure "is a lower bound on the population and is NOT a bound on the
 * money, and both halves are stated wherever it is shown", so an answer that
 * carried the assumptions without their cost would reproduce `EC-074` inside
 * `EC-074`'s own remedy.
 */
export interface ProjectionAssumption {
  readonly id: 'A1' | 'A2' | 'A3' | 'A4' | 'A5';
  readonly assumption: string;
  /** ADR-204 section 5's fourth column: what it costs, and in which direction. */
  readonly cost: string;
}

/**
 * ADR-204 section 5, transcribed. A producer may not choose these (ruling 6) and
 * a renderer may not drop them (ruling 7), so they ride on the answer.
 */
export const PROJECTION_ASSUMPTIONS: readonly ProjectionAssumption[] = [
  {
    id: 'A1',
    assumption: 'No account trades inside the horizon',
    cost:
      'UNDERSTATES THE POPULATION. Every account that will trade into eligibility is absent, ' +
      "and AS-09's wave is made of exactly those",
  },
  {
    id: 'A2',
    assumption: "Balances are the last closed day's",
    cost:
      'NOT A BOUND IN EITHER DIRECTION on the money. The figure answers how much could be ' +
      'claimed, never how much will be earned',
  },
  {
    id: 'A3',
    assumption: 'No context gate changes',
    cost:
      'OVERSTATES. A breach, a freeze, a KYC expiry or a recon block inside the horizon is ' +
      'invisible, and three of the four are operator or engine events with no forward notice',
  },
  {
    id: 'A4',
    assumption: 'No payout is requested or settles inside the horizon',
    cost:
      'OVERSTATES, and it is the self-referential one. R-46 moves both anchors on settlement ' +
      'and R-47 resets the win-day counter',
  },
  {
    id: 'A5',
    assumption: "The account's pinned `plan_version_id` does not change",
    cost: 'Small, and it is the only one a stored row can verify after the fact',
  },
] as const;

/**
 * ADR-204's honest summary, which "belongs on the panel and not only in this
 * entry", plus ruling 7's second half. Exported so a caller renders the ruling's
 * sentence rather than composing one.
 */
export const PROJECTION_CAVEAT =
  'The accounts that qualify today, plus those whose only remaining wait is the cadence gap, ' +
  'placed on the day that gap expires. A LOWER BOUND ON THE POPULATION, AND NOT A BOUND ON ' +
  'THE MONEY.';

/**
 * Ruling 2's population, reported so no caller re-derives it.
 *
 * `eligible_now` is ADR-204's set `E` and `cadence_pending` is its set `C`.
 * NOTHING ELSE IS ADMITTED, and the exclusion is the ruling rather than a
 * simplification: an account one win day short is `excluded`, because admitting
 * it requires predicting a fill, which is A1's own negation.
 */
export type ProjectedPopulation = 'eligible_now' | 'cadence_pending' | 'excluded';

/** One projected trading day's verdict, under the five assumptions. */
export interface ProjectedDay {
  readonly tradingDay: TradingDay;
  /** R-41's conjunction, over five carried gates, one projected gate and context. */
  readonly eligible: boolean;
  readonly engineEligible: boolean;
  readonly contextEligible: boolean;
  /** The one gate that moved. `nextEligibleTradingDay` is relative to THIS day. */
  readonly cadenceGap: CadenceGapGate;
  /** `min(withdrawable, cap)` on a day the projection clears, and `0n` otherwise. */
  readonly maxPayoutCents: Cents;
}

/** What `projectPayout` produces for one account over one horizon. */
export interface PayoutProjection {
  /**
   * R-06. The last closed day, which every figure here is computed against and
   * which no projected day replaces.
   */
  readonly asOfTradingDay: TradingDay;
  /**
   * `evaluatePayout` over the STORED gates, unprojected. This is ruling 2's `E`
   * test and it is the reason `E` and `C` stay distinguishable in the answer
   * rather than being merged into one eligible-somewhere flag.
   */
  readonly eligibleAtLastClosedDay: boolean;
  /** Ascending, one entry per horizon day, in the order the caller supplied. */
  readonly days: readonly ProjectedDay[];
  readonly population: ProjectedPopulation;
  /**
   * RULING 3. First eligibility inside the horizon, AT MOST ONE DAY PER ACCOUNT,
   * and `null` when the account is in neither `E` nor `C`.
   *
   * The literal reading -- an account appears on every day it clears -- puts
   * `sum(by_day[].cents)` at up to seven times `total_cents` (ADR-204 section
   * 3a), and a series that repeats the standing population on every day is a
   * flat line with the arriving wave inside it.
   */
  readonly firstEligibleTradingDay: TradingDay | null;
  /**
   * RULING 4. `min(withdrawable_cents, cap_for_next_ordinal)` at the last closed
   * day, which is `EC-074`'s arithmetic and `P-M6-02`'s formula rather than a
   * new one. `0n` when there is no first eligibility.
   *
   * IT IS TAKEN OFF THE EVALUATION AND NOT RECOMPUTED HERE. R-43's whole claim
   * is that the number a trader is shown and the number they are paid come out
   * of one function, and a projection that did its own `min` would be the second
   * implementation `FM-16` is about.
   */
  readonly centsAtFirstEligibility: Cents;
  readonly assumptions: readonly ProjectionAssumption[];
  readonly caveat: string;
}

export type PayoutProjectionOutcome =
  | { readonly kind: 'projected'; readonly projection: PayoutProjection }
  | { readonly kind: 'refused'; readonly assertion: AssertionFailure };

export interface PayoutProjectionInput {
  /** The last closed day's row. */
  readonly state: RuleState;
  /** A5. One plan, pinned, for the whole horizon. */
  readonly plan: ResolvedPlan;
  /** A3. One resolved context, applied to every projected day. */
  readonly gates: ExternalGates;
  /** Must cover the cadence anchor AND every horizon day. */
  readonly calendar: CalendarSlice;
  /**
   * The next N trading days, ascending, strictly after `state.tradingDay`.
   *
   * IT IS SUPPLIED AND NEVER DERIVED HERE, and that is not a convenience. The
   * horizon is read from `trading_calendar` and `trading_calendar_loads`
   * together, and an exhausted or uncovered calendar is a VALUE rather than a
   * short array (`ADR-042` F-4). The engine reads no table, so a horizon it
   * built itself would be a horizon that could not tell those apart.
   */
  readonly horizon: readonly TradingDay[];
}

/**
 * ADR-204's projection, executed. THE PRODUCER `M01` NAMES, IN THE ONLY SENSE IT
 * CAN BE CALLED.
 *
 * `evaluatePayout` is called once per horizon day plus once for the baseline,
 * with its own signature and with a state whose `tradingDay` is the last closed
 * day every time. What changes between the calls is one gate.
 *
 * -----------------------------------------------------------------------------
 * RULING 9, AND WHY THE REFUSALS TAKE NO NEW VOCABULARY
 * -----------------------------------------------------------------------------
 * "Where the horizon has no answer, the field has no value." Three ways that
 * happens, and each lands on an `AssertionKind` that already means it:
 *
 *   an empty horizon              `calendar_coverage_miss`. The caller has no
 *                                 horizon because the calendar is exhausted or
 *                                 uncovered, which is the same UNKNOWN
 *   a day outside coverage        `calendar_coverage_miss`, ADR-049's own kind
 *   a day inside coverage that
 *     is not a session            `day_not_a_session`, DO-1 and FM-13's kind
 *   a day not strictly forward    `not_forward`, DO-1 and INV-14's kind
 *
 * A PROJECTION THAT ANSWERED FOR A DAY THE CALENDAR CANNOT SPEAK FOR WOULD BE
 * `ADR-042` F-4's exact failure: an exhausted calendar reading as an unbroken
 * holiday, with nothing raising. So the horizon is validated before a gate is
 * touched, uniformly, including on rows the answer is already known for.
 */
export function projectPayout(input: PayoutProjectionInput): PayoutProjectionOutcome {
  const { state, plan, gates, calendar, horizon } = input;

  // A2 and ADR-009. The projection asks "what could be claimed", never "what if
  // this much were requested", so there is no request to supply and the ceiling
  // is the maximum the account is eligible for.
  const ctx = { gates, requestedCents: null } as const;

  const horizonRefusal = refuseHorizon(state.tradingDay, calendar, horizon);
  if (horizonRefusal !== null) return { kind: 'refused', assertion: horizonRefusal };

  // Ruling 2's `E` test, over the STORED gates. R-06 and DO-9: the engine gates
  // are read and not recomputed, so this is the same answer
  // `GET /accounts/:id/eligibility` gives today, for the same account, right now.
  const baseline = evaluatePayout(state, plan, ctx);

  const days: ProjectedDay[] = [];
  for (const tradingDay of horizon) {
    // R-24 AND INV-12: BREACH IS TERMINAL AND NO STATE ADVANCES AFTER IT. The
    // gates on a breached row are STATED by `gatesAfterBreach` rather than
    // computed, every one of them `false`, so projecting a cadence verdict onto
    // that row would put a passing-looking gate on the worst row in an account's
    // life. The stored row is carried whole and the account is excluded by its
    // own gates, which is the true answer rather than a suppressed one.
    const projected = state.breached
      ? { kind: 'evaluated' as const, gates: state.engineGates, engineEligible: false }
      : projectEngineGates({
          state,
          gates: state.engineGates,
          plan,
          calendar,
          basisTradingDay: tradingDay,
        });

    if (projected.kind === 'refused') return { kind: 'refused', assertion: projected.assertion };

    const evaluation = evaluatePayout(
      { ...state, engineGates: projected.gates, engineEligible: projected.engineEligible },
      plan,
      ctx,
    );

    days.push({
      tradingDay,
      eligible: evaluation.eligible,
      engineEligible: evaluation.engineEligible,
      contextEligible: evaluation.contextEligible,
      cadenceGap: evaluation.gates.cadenceGap,
      maxPayoutCents: evaluation.maxPayoutCents,
    });
  }

  // RULING 3. The FIRST day the conjunction clears, and no later one. A member
  // of `E` lands on the horizon's first day, because a cadence gap that has
  // cleared cannot un-clear under A4 and every other gate is carried; a member
  // of `C` lands on the day its own gap expires.
  const first = days.find((d) => d.eligible) ?? null;

  return {
    kind: 'projected',
    projection: {
      asOfTradingDay: baseline.asOfTradingDay,
      eligibleAtLastClosedDay: baseline.eligible,
      days,
      population: baseline.eligible
        ? 'eligible_now'
        : first === null
          ? 'excluded'
          : 'cadence_pending',
      firstEligibleTradingDay: first?.tradingDay ?? null,
      centsAtFirstEligibility: first?.maxPayoutCents ?? 0n,
      assumptions: PROJECTION_ASSUMPTIONS,
      caveat: PROJECTION_CAVEAT,
    },
  };
}

/**
 * The horizon's own preconditions, checked before any gate is touched.
 *
 * ORDER IS READ OFF `sequence` AND NEVER OFF THE DATES. R-02 fixes gap counting
 * as `calendar.sequence` subtraction "never date arithmetic", and a projection
 * that ordered its own horizon by comparing two ISO strings would be reaching
 * for the one mechanism `AS-06` says publishes "a rule its own traders cannot
 * evaluate". Reading the sequence costs a lookup this function already needs,
 * and it catches a repeated day for free.
 *
 * THE LAST CLOSED DAY MUST BE IN THE SLICE TOO. `DO-9` computed the stored
 * cadence gate over a slice holding both the anchor and that day, so a caller
 * reconstructing the projection has it; requiring it is what gives the horizon
 * something to be strictly after.
 *
 * `null` when the horizon is one this projection may answer over.
 */
function refuseHorizon(
  asOfTradingDay: TradingDay,
  calendar: CalendarSlice,
  horizon: readonly TradingDay[],
): AssertionFailure | null {
  if (horizon.length === 0) {
    return {
      kind: 'calendar_coverage_miss',
      tradingDay: asOfTradingDay,
      detail:
        'ADR-204 ruling 9: a projection over an EMPTY horizon has no value. A caller has no ' +
        'horizon because the calendar is exhausted or uncovered, and a figure folded over a ' +
        "partial horizon is B2's understatement with a different denominator",
    };
  }

  const asOf = lookupCalendarDay(calendar, asOfTradingDay);
  if (!asOf.found) return miss(asOfTradingDay, calendar, asOf.reason);

  let previous = asOf.day;
  for (const tradingDay of horizon) {
    const found = lookupCalendarDay(calendar, tradingDay);
    if (!found.found) return miss(tradingDay, calendar, found.reason);

    // R-06's direction, applied to the horizon rather than to a mark: the first
    // day strictly after the last closed day and each day strictly after the one
    // before it, or "FIRST eligibility" names a day that is not first.
    if (found.day.sequence <= previous.sequence) {
      return {
        kind: 'not_forward',
        tradingDay,
        detail:
          `the horizon must ascend strictly from the last closed day ${asOfTradingDay}, by ` +
          `sequence and never by date, and ${tradingDay} at sequence ${found.day.sequence} does ` +
          `not follow ${previous.tradingDay} at sequence ${previous.sequence}`,
      };
    }
    previous = found.day;
  }

  return null;
}

/** ADR-049's two misses, kept apart because only one of them is safe to act on. */
function miss(
  tradingDay: TradingDay,
  calendar: CalendarSlice,
  reason: 'not_a_session' | 'outside_coverage',
): AssertionFailure {
  const window = `${calendar.coverage.from}..${calendar.coverage.to}`;
  return {
    kind: reason === 'outside_coverage' ? 'calendar_coverage_miss' : 'day_not_a_session',
    tradingDay,
    detail:
      reason === 'outside_coverage'
        ? `the projection was asked for ${tradingDay}, which is OUTSIDE the slice's coverage ` +
          `${window}, so whether it is a session is UNKNOWN rather than answered (ADR-042 F-4)`
        : `the projection was asked for ${tradingDay}, which is INSIDE the slice's coverage ` +
          `${window} and is positively not a session`,
  };
}
