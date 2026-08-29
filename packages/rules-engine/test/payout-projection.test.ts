// =============================================================================
// ADR-204's PROJECTION, EXECUTED. The producer M01 section 4 names, and the
// exact sense in which it is now callable.
// =============================================================================
// M01 section 4's `GET /admin/eligible-forecast` row names "`evaluatePayout`
// projected forward over the calendar". ADR-204 section 1 proves that sentence
// uncallable on its literal reading, and M01's own third cell now says so. THIS
// SUITE ASSERTS THE DISTINCTION RATHER THAN BLURRING IT:
//
//   the literal call is STILL impossible    `evaluatePayout` has no day
//                                           parameter, `advanceDay` needs a
//                                           `DailyMark` for a day that has not
//                                           closed, and the first two tests pin
//                                           both signatures so a future edit
//                                           that "fixes" it by widening one is
//                                           a red stage
//
//   what IS callable is the projection      one gate's BASIS DAY moves and
//                                           nothing else does, which is
//                                           ADR-204 section 2's one-of-eleven
//
// EVERY EXPECTATION HERE IS A RULING, CITED. Nothing in this file decides
// anything: ADR-204 rulings 2 to 9 and its five assumptions are the
// specification and these are their boundaries.
// =============================================================================

import { expect, test } from 'vitest';

import { advanceDay } from '../src/day/advance.ts';
import { buildCalendarSlice } from '../src/calendar.ts';
import { evaluatePayout } from '../src/payout/evaluate.ts';
import { capForOrdinal, ordinalForNextPayout } from '../src/payout/clamp.ts';
import { projectEngineGates } from '../src/payout/gates.ts';
import { PROJECTION_ASSUMPTIONS, PROJECTION_CAVEAT, projectPayout } from '../src/payout/project.ts';
import type { PayoutProjection, PayoutProjectionOutcome } from '../src/payout/project.ts';
import type {
  CalendarSlice,
  DayInput,
  ExternalGates,
  RuleState,
  TradingDay,
} from '../src/types.ts';
import {
  ACCOUNT_OPENED_ON,
  CORE_50K,
  ENGINE_VERSION,
  day,
  fundedPrior,
  mark,
} from './fixtures-in-code.ts';

// -----------------------------------------------------------------------------
// The window, and it is NOT a claim about any exchange (TR-01)
// -----------------------------------------------------------------------------
// `GAPPED_SLICE`'s discipline, over a longer run. `CME_WINDOW` holds five
// consecutive sessions, so over it a date difference and a `sequence`
// subtraction agree and a projection written either way passes. THE OMISSIONS
// BELOW EXIST ONLY TO MAKE THE TWO DISAGREE and for no other reason: the days
// left out are left out so that five trading days after `2026-11-06` is
// `2026-11-13` by subtraction and `2026-11-11` by date arithmetic, which is
// `AS-06`'s difference arriving inside one fixture.
//
// `sequence` STARTS AT 7311 AND THE BASE IS ARBITRARY. It is "a dense index into
// the calendar" (M01 section 2.1), so a window whose sequences started at zero
// would let a test pass that had confused a position in this array for a
// calendar index, which is the confusion R-37 cannot survive and which ADR-204
// section 8 turns on.
const SESSIONS: readonly (readonly [string, number])[] = [
  ['2026-11-02', 7311],
  ['2026-11-03', 7312],
  ['2026-11-04', 7313],
  ['2026-11-05', 7314],
  ['2026-11-06', 7315],
  ['2026-11-09', 7316],
  ['2026-11-10', 7317],
  ['2026-11-11', 7318],
  ['2026-11-12', 7319],
  ['2026-11-13', 7320],
  ['2026-11-16', 7321],
  ['2026-11-17', 7322],
  ['2026-11-18', 7323],
  ['2026-11-19', 7324],
  ['2026-11-20', 7325],
];

const WINDOW: CalendarSlice = buildCalendarSlice({
  days: SESSIONS.map(([tradingDay, sequence]) => ({
    tradingDay: day(tradingDay),
    isHalfDay: false,
    halted: false,
    sequence,
  })),
  coverage: { from: day('2026-11-02'), to: day('2026-11-20') },
});

/** The last closed day every fixture below is folded to. */
const AS_OF = day('2026-11-11');

/** The seven trading days after `AS_OF`, which is what `readTradingHorizon` returns. */
const HORIZON: readonly TradingDay[] = [
  '2026-11-12',
  '2026-11-13',
  '2026-11-16',
  '2026-11-17',
  '2026-11-18',
  '2026-11-19',
  '2026-11-20',
].map(day);

/** Every context gate satisfied, so one at a time can be moved (R-40). */
const CLEAR: ExternalGates = {
  accountStatus: 'active',
  kycState: 'verified',
  payoutsFrozen: false,
  reconBlocked: false,
  hasPayoutInFlight: false,
};

/**
 * A funded state at `AS_OF`, FOLDED rather than hand-built, so every gate is
 * `advanceDay`'s answer and not a fixture's claim.
 *
 * CORE-50K, and the arithmetic is stated because a reader should check it:
 *
 *   traded days   0 required (ADR-015), so skipped and passing
 *   win days      4 carried plus this day's 20,000c over a 15,000c floor = 5 of 5
 *   buffer        5,300,000 - 5,000,000 - 100,000 = 200,000 withdrawable, > 0
 *   consistency   best 60,000 on period profit 200,000 = exactly 3000bp
 *   minimum       min(200,000, 150,000 cap) = 150,000 >= 10,000
 *   cadence gap   the caller's, and it is the ONLY thing that moves below
 *
 * THE TWO ANCHORS ARE DIFFERENT DAYS AND THAT IS ADR-019 RATHER THAN A CHOICE.
 * `payoutAnchorDay` is the settlement's BASIS day (R-46) and R-34 counts win
 * days strictly after it; `cadenceAnchorDay` is the WALLET-CREDIT day, which is
 * later. A fixture that collapsed them would make the win-day gate and the
 * cadence gate clear together on every plan and would hide the case ADR-204
 * ruling 2's set `C` is entirely about.
 */
function stateAt(overrides: {
  readonly cadenceAnchorDay: TradingDay | null;
  readonly payoutAnchorDay: TradingDay | null;
  readonly winDaysCarried?: number;
}): RuleState {
  const out = advanceDay({
    engineVersion: ENGINE_VERSION,
    plan: CORE_50K,
    prior: fundedPrior(CORE_50K, {
      tradingDay: day('2026-11-10'),
      balanceCents: 5_280_000n,
      winDaysCount: overrides.winDaysCarried ?? 4,
      consistencyBestDayCents: 60_000n,
      consistencyPeriodProfitCents: 180_000n,
      payoutsSettledCount: 1,
      payoutAnchorDay: overrides.payoutAnchorDay,
      cadenceAnchorDay: overrides.cadenceAnchorDay,
    }),
    mark: mark({
      tradingDay: AS_OF,
      openingBalanceCents: 5_280_000n,
      realizedPnlCents: 20_000n,
      fillCount: 2,
    }),
    calendar: WINDOW,
    settlements: [],
    openedOn: ACCOUNT_OPENED_ON,
  });
  expect(out.assertions).toEqual([]);
  expect(out.state.tradingDay).toBe(AS_OF);
  return out.state;
}

/**
 * ADR-204 ruling 2's set `E`: eligible at the last closed day.
 *
 * The credit day `2026-11-03` is sequence 7312 and `AS_OF` is 7318, so R-37
 * counts 6 against a configured gap of 5 and the gate passes.
 */
function eligibleNow(): RuleState {
  const state = stateAt({
    payoutAnchorDay: day('2026-11-02'),
    cadenceAnchorDay: day('2026-11-03'),
  });
  expect(state.engineEligible).toBe(true);
  return state;
}

/**
 * ADR-204 ruling 2's set `C`: every engine gate but the cadence gap passes.
 *
 * The credit day `2026-11-06` is sequence 7315 and `AS_OF` is 7318, so R-37
 * counts 3 against 5 and the gate fails. THE DAY IT CLEARS IS THE WHOLE POINT
 * OF THIS FIXTURE: sequence 7315 + 5 is 7320, which is `2026-11-13`, while five
 * DAYS after `2026-11-06` is `2026-11-11`, the day already closed. A projection
 * that reached for date arithmetic would call this account eligible today.
 */
function cadencePending(): RuleState {
  const state = stateAt({
    payoutAnchorDay: day('2026-11-04'),
    cadenceAnchorDay: day('2026-11-06'),
  });
  expect(state.engineEligible).toBe(false);
  expect(state.engineGates.cadenceGap.pass).toBe(false);
  expect(state.engineGates.cadenceGap.tradingDaysSinceLastPayout).toBe(3);
  expect(state.engineGates.cadenceGap.nextEligibleTradingDay).toBe('2026-11-13');
  return state;
}

function projected(outcome: PayoutProjectionOutcome): PayoutProjection {
  if (outcome.kind !== 'projected') {
    throw new Error(
      `expected a projection, got ${outcome.assertion.kind}: ${outcome.assertion.detail}`,
    );
  }
  return outcome.projection;
}

function run(state: RuleState, gates: ExternalGates = CLEAR): PayoutProjectionOutcome {
  return projectPayout({ state, plan: CORE_50K, gates, calendar: WINDOW, horizon: HORIZON });
}

// -----------------------------------------------------------------------------
// The three signatures ADR-204 section 1 read, RE-DERIVED, and still closed
// -----------------------------------------------------------------------------
// ADR-204 section 10 finding 5 registers the control that would have caught this
// in session 363: "a case asserting that no module constructs a `RuleState` for a
// day later than the last closed one". THIS IS THE HALF OF IT A TYPE SYSTEM CAN
// HOLD, and it is the one that matters for this diff: the literal producer stays
// uncallable, so a later session cannot make M01 section 4's sentence true by
// widening `evaluatePayout` or by making `DayInput.mark` optional.
test('the literal producer is STILL uncallable, and the projection does not make it callable', () => {
  // SIGNATURE 1. `evaluatePayout(state, plan, ctx)`. THREE PARAMETERS AND NO DAY.
  // "Projected forward" cannot mean asking the same state about a later day,
  // because the state IS the day. A fourth parameter here is the widening this
  // slice refused, and `Function.length` is the mechanical form of that refusal.
  expect(evaluatePayout.length).toBe(3);

  // SIGNATURE 2. A `RuleState` for day `D+k` comes only from `advanceDay`, and
  // SIGNATURE 3. `DayInput.mark` is a NON-OPTIONAL `DailyMark` that R-06
  // guarantees does not exist for a day that has not closed.
  //
  // THE DECLARATION IS THE ASSERTION AND NOTHING CALLS IT, because there is no
  // value to call it with: that is the finding. `@ts-expect-error` goes RED at
  // typecheck the day `mark` becomes optional, which is the shape a later
  // session would reach for to make M01 section 4's sentence literally true.
  //
  // @ts-expect-error DayInput.mark is required, so no forward DayInput exists
  const forward: DayInput = {
    engineVersion: ENGINE_VERSION,
    plan: CORE_50K,
    prior: eligibleNow(),
    calendar: WINDOW,
    settlements: [],
    openedOn: ACCOUNT_OPENED_ON,
  };
  expect(forward.mark).toBeUndefined();
});

// -----------------------------------------------------------------------------
// ONE GATE MOVES. Five are carried BY REFERENCE, which is stronger than equal
// -----------------------------------------------------------------------------
// ADR-204 section 2: exactly one of eleven conditions has an input a stored row
// already fixes for the whole horizon. A1, A2 and A5 are honoured here by
// COPYING a verdict the fold reached rather than by recomputing one, and
// reference identity is what proves the copy: two gate objects can be deeply
// equal because the arithmetic happened to agree twice, and only one object can
// be the same object.
test('projectEngineGates carries five gates by reference and recounts exactly one', () => {
  const state = cadencePending();
  const out = projectEngineGates({
    state,
    gates: state.engineGates,
    plan: CORE_50K,
    calendar: WINDOW,
    basisTradingDay: day('2026-11-13'),
  });

  expect(out.kind).toBe('evaluated');
  if (out.kind !== 'evaluated') return;

  expect(out.gates.tradedDays).toBe(state.engineGates.tradedDays);
  expect(out.gates.winDays).toBe(state.engineGates.winDays);
  expect(out.gates.buffer).toBe(state.engineGates.buffer);
  expect(out.gates.consistency).toBe(state.engineGates.consistency);
  expect(out.gates.minimumAmount).toBe(state.engineGates.minimumAmount);

  // The one that moved, and it moved by `sequence`: 7320 - 7315 is 5, which is
  // CORE-50K's configured gap, so the gate clears ON that day and not before.
  expect(out.gates.cadenceGap).not.toBe(state.engineGates.cadenceGap);
  expect(out.gates.cadenceGap.tradingDaysSinceLastPayout).toBe(5);
  expect(out.gates.cadenceGap.pass).toBe(true);
  // R-41's conjunction, through the same `allGatesPass` DO-9 uses (INV-15).
  expect(out.engineEligible).toBe(true);

  // AND THE DAY BEFORE IT DOES NOT CLEAR. `2026-11-12` is sequence 7319, so the
  // count is 4 against a gap of 5, which is the `>=` boundary on its short side.
  const before = projectEngineGates({
    state,
    gates: state.engineGates,
    plan: CORE_50K,
    calendar: WINDOW,
    basisTradingDay: day('2026-11-12'),
  });
  expect(before.kind === 'evaluated' && before.gates.cadenceGap.tradingDaysSinceLastPayout).toBe(4);
  expect(before.kind === 'evaluated' && before.engineEligible).toBe(false);
});

// -----------------------------------------------------------------------------
// RULING 5 AND RULING 3. `E` lands on the horizon's FIRST day
// -----------------------------------------------------------------------------
// Ruling 5: "next 7 days INCLUDES the accounts eligible today", because ADR-011's
// trigger measures near-term demand against the wallet balance and money that
// can leave today is the first money that can leave in the next seven days.
// Ruling 3 places every member of `E` on the horizon's first day.
test('ruling 5 and 3: an account eligible at the last closed day lands on day one', () => {
  const p = projected(run(eligibleNow()));

  expect(p.eligibleAtLastClosedDay).toBe(true);
  expect(p.population).toBe('eligible_now');
  expect(p.firstEligibleTradingDay).toBe('2026-11-12');
  expect(p.days[0]?.eligible).toBe(true);

  // A4 IS WHAT MAKES THIS HOLD ACROSS THE WHOLE HORIZON: no payout settles, so
  // no anchor moves, so a cleared gap cannot un-clear. Every day says yes, and
  // ruling 3 is what stops that from becoming seven `by_day` rows.
  expect(p.days.every((d) => d.eligible)).toBe(true);
});

// -----------------------------------------------------------------------------
// RULING 2's SET `C`, AND `AS-06` INSIDE ONE ASSERTION
// -----------------------------------------------------------------------------
test('ruling 2 and 3: a cadence-pending account lands on the day the gap expires, by sequence', () => {
  const p = projected(run(cadencePending()));

  expect(p.eligibleAtLastClosedDay).toBe(false);
  expect(p.population).toBe('cadence_pending');

  // 7315 + 5 is 7320 is `2026-11-13`. FIVE DAYS AFTER `2026-11-06` IS
  // `2026-11-11`, the day already closed, and a projection reaching for that
  // arithmetic would place this account in the past.
  expect(p.firstEligibleTradingDay).toBe('2026-11-13');
  expect(p.days[0]?.tradingDay).toBe('2026-11-12');
  expect(p.days[0]?.eligible).toBe(false);
  expect(p.days[1]?.tradingDay).toBe('2026-11-13');
  expect(p.days[1]?.eligible).toBe(true);

  // AS-06: the date is REPORTED and it is the state's own `nextEligibleTradingDay`
  // resolved through the calendar, so the projection and the trader's own
  // eligibility screen name the same day rather than two.
  expect(p.firstEligibleTradingDay).toBe(
    cadencePending().engineGates.cadenceGap.nextEligibleTradingDay,
  );

  // The gap is nothing to wait for once it clears, so the reported date goes
  // null ON that day and stays null (`gates.ts`, `nextEligibleTradingDay`).
  expect(p.days[0]?.cadenceGap.nextEligibleTradingDay).toBe('2026-11-13');
  expect(p.days[1]?.cadenceGap.nextEligibleTradingDay).toBeNull();
});

// -----------------------------------------------------------------------------
// RULING 3's OTHER HALF: AT MOST ONE PLACEMENT PER ACCOUNT
// -----------------------------------------------------------------------------
// ADR-204 section 3a is arithmetic rather than a worry: nothing removes an
// account from the eligible set except acting on it, so the LITERAL reading puts
// an eligible account in all seven `by_day` rows and `sum(by_day[].cents)` at up
// to seven times `total_cents`. Ruling 3 fixes the placement at FIRST
// eligibility, so the identity `sum(by_day[]) == total_cents` becomes checkable.
// A PROJECTION CANNOT ASSERT THAT SUM -- it is a fold across accounts and belongs
// to the caller -- but it can guarantee the one thing that makes it true.
test('ruling 3: one account contributes at most one placement, however many days it clears', () => {
  const p = projected(run(eligibleNow()));

  expect(p.days.filter((d) => d.eligible)).toHaveLength(7);
  expect(p.firstEligibleTradingDay).toBe('2026-11-12');
  expect(p.centsAtFirstEligibility).toBe(150_000n);

  // The literal reading, priced. 7 x 150,000c against ruling 3's 150,000c, on
  // one account, which is section 3a's factor arriving in a number.
  const literal = p.days.filter((d) => d.eligible).reduce((sum, d) => sum + d.maxPayoutCents, 0n);
  expect(literal).toBe(1_050_000n);
  expect(literal).toBe(7n * p.centsAtFirstEligibility);
});

// -----------------------------------------------------------------------------
// RULING 4. The cents are `EC-074`'s arithmetic and not a new one
// -----------------------------------------------------------------------------
test('ruling 4: the cents are min(withdrawable, cap for the next ordinal) at the last closed day', () => {
  const state = cadencePending();
  const p = projected(run(state));

  // The formula, written out at the state rather than taken from the answer.
  // withdrawable 200,000 = 5,300,000 - 5,000,000 - 100,000 (R-35, INV-05);
  // ordinal 2 on a schedule whose only rung is "ordinal 1 and up" at 150,000c.
  const cap = capForOrdinal(CORE_50K.funded, ordinalForNextPayout(state));
  expect(state.withdrawableCents).toBe(200_000n);
  expect(cap).toBe(150_000n);
  expect(p.centsAtFirstEligibility).toBe(150_000n);

  // A2 IS WHY IT IS THE LAST CLOSED DAY'S FIGURE ON EVERY DAY OF THE HORIZON.
  // Balances do not move under the assumption, so the amount does not either,
  // and the day the account clears is the only thing the horizon decides.
  expect(p.days.filter((d) => d.eligible).every((d) => d.maxPayoutCents === 150_000n)).toBe(true);

  // AND IT IS `0n` BEFORE THE GAP EXPIRES. `maxPayoutCents` is "min(withdrawable,
  // cap), 0 WHEN NOT ELIGIBLE" (M01 section 2.2), so a day the projection says no
  // on carries no payable amount for a panel to add up by accident.
  expect(p.days[0]?.maxPayoutCents).toBe(0n);
});

// -----------------------------------------------------------------------------
// RULING 2's EXCLUSION, WHICH IS THE RULING RATHER THAN A SIMPLIFICATION
// -----------------------------------------------------------------------------
// "An account one win day short is NOT in the population, because admitting it
// requires predicting a fill", which is A1's own negation. THIS IS THE CASE THE
// FIELD IS MOST OFTEN ASSUMED TO CARRY and the one it does not.
test('ruling 2: an account one win day short is excluded on every day of the horizon', () => {
  // 3 carried plus this day's win is 4 of 5 required. The cadence gap is CLEAR
  // (credit day 7312 against 7318 is 6 >= 5), so the ONLY unmet gate is the one
  // no stored row can advance.
  const state = stateAt({
    payoutAnchorDay: day('2026-11-02'),
    cadenceAnchorDay: day('2026-11-03'),
    winDaysCarried: 3,
  });
  expect(state.engineGates.winDays.have).toBe(4);
  expect(state.engineGates.winDays.need).toBe(5);
  expect(state.engineGates.cadenceGap.pass).toBe(true);

  const p = projected(run(state));
  expect(p.population).toBe('excluded');
  expect(p.firstEligibleTradingDay).toBeNull();
  expect(p.centsAtFirstEligibility).toBe(0n);
  expect(p.days.some((d) => d.eligible)).toBe(false);

  // AND THE WIN-DAY GATE READS 4 OF 5 ON EVERY DAY, unmoved. That is A1 visible
  // in the answer rather than only in the assumptions table, and it is ADR-204
  // section 3b: `AS-09`'s correlated wave crosses THIS gate, so the projection
  // sees it on the day it lands and not one day earlier.
  expect(p.days.every((d) => !d.engineEligible)).toBe(true);
});

// -----------------------------------------------------------------------------
// A3, AND ITS DIRECTION. A context gate that fails today fails on every day
// -----------------------------------------------------------------------------
test('A3: one resolved context is applied to every projected day, and it can only exclude', () => {
  const state = eligibleNow();
  const expired = projected(run(state, { ...CLEAR, kycState: 'expired' }));

  expect(expired.population).toBe('excluded');
  expect(expired.days.every((d) => d.engineEligible)).toBe(true);
  expect(expired.days.every((d) => !d.contextEligible)).toBe(true);

  // R-38 binds through `contextEligible` too (ADR-060 Reading A), and it is the
  // one ADR-204 calls "the condition the forecast's own subject matter changes".
  const inFlight = projected(run(state, { ...CLEAR, hasPayoutInFlight: true }));
  expect(inFlight.population).toBe('excluded');
  expect(inFlight.days.every((d) => d.engineEligible && !d.contextEligible)).toBe(true);
});

// -----------------------------------------------------------------------------
// R-06 SURVIVES THE PROJECTION, AND THAT IS THE WHOLE SHAPE OF THE ANSWER
// -----------------------------------------------------------------------------
// ADR-204 section 1: "R-06 IS NOT AN OBSTACLE THE FORECAST HAS TO ROUTE AROUND."
// The state's own day never moves, so `PayoutEvaluation.asOfTradingDay` reports
// the last closed day on every projected day. A projection that had moved it
// would be an engine claiming to have seen a day close that has not.
test('R-06: the projection is AS OF the last closed day, on every day of the horizon', () => {
  const p = projected(run(cadencePending()));
  expect(p.asOfTradingDay).toBe(AS_OF);

  // The baseline is `evaluatePayout` over the STORED gates, which is the same
  // answer `GET /accounts/:id/eligibility` gives for this account right now.
  const live = evaluatePayout(cadencePending(), CORE_50K, { gates: CLEAR, requestedCents: null });
  expect(p.eligibleAtLastClosedDay).toBe(live.eligible);
  expect(p.asOfTradingDay).toBe(live.asOfTradingDay);
});

// -----------------------------------------------------------------------------
// R-24. A BREACHED ROW IS CARRIED WHOLE
// -----------------------------------------------------------------------------
// "Breach is terminal: no state advances after it" (INV-12), and the gates on a
// breach row are STATED by `gatesAfterBreach` rather than computed, every one of
// them `false` including the two that can be `skipped`. Recomputing a cadence
// verdict onto that row would put a passing-looking gate on the worst row in an
// account's life.
test('R-24: a breached row projects excluded and its stated gates are not recomputed', () => {
  const state = cadencePending();
  // The floor at 5,050,000 = 5,300,000 - 250,000 (R-13 on a trailing plan), so a
  // low of 5,000,000 is below it and DO-5 returns before DO-9 ever runs.
  const breached = advanceDay({
    engineVersion: ENGINE_VERSION,
    plan: CORE_50K,
    prior: state,
    mark: mark({
      tradingDay: day('2026-11-12'),
      openingBalanceCents: 5_300_000n,
      realizedPnlCents: -260_000n,
      lowBalanceCents: 5_000_000n,
      fillCount: 3,
    }),
    calendar: WINDOW,
    settlements: [],
    openedOn: ACCOUNT_OPENED_ON,
  }).state;
  expect(breached.breached).toBe(true);

  const p = projected(
    projectPayout({
      state: breached,
      plan: CORE_50K,
      gates: CLEAR,
      calendar: WINDOW,
      // The breach closed `2026-11-12`, so the horizon starts the day after it.
      horizon: HORIZON.slice(1),
    }),
  );
  expect(p.population).toBe('excluded');
  expect(p.days.every((d) => !d.eligible && !d.engineEligible)).toBe(true);
  // Carried, not recounted: the stated cadence gate, whose `pass` is `false` and
  // whose `nextEligibleTradingDay` is `null` because there is no next one.
  expect(p.days.every((d) => d.cadenceGap === breached.engineGates.cadenceGap)).toBe(true);
});

// -----------------------------------------------------------------------------
// RULING 9. WHERE THE HORIZON HAS NO ANSWER, THE FIELD HAS NO VALUE
// -----------------------------------------------------------------------------
// ADR-042 F-4 is why an exhausted calendar and an uncovered one are values
// rather than short arrays: "an exhausted calendar is indistinguishable from an
// unbroken holiday: every counter quietly stops advancing, no rule fires,
// nothing breaches, nothing becomes eligible, and nothing raises." A projection
// that answered over a day the calendar cannot speak for would be that failure.
//
// NO NEW `AssertionKind` IS TAKEN. Each refusal lands on a member that already
// means what it says, which is the standing refusal on closed vocabularies
// applied to a vocabulary the protocol does not list.
test('ruling 9: an empty horizon has no value, and it refuses rather than answering', () => {
  const outcome = projectPayout({
    state: eligibleNow(),
    plan: CORE_50K,
    gates: CLEAR,
    calendar: WINDOW,
    horizon: [],
  });
  expect(outcome.kind).toBe('refused');
  if (outcome.kind !== 'refused') return;
  expect(outcome.assertion.kind).toBe('calendar_coverage_miss');
  expect(outcome.assertion.detail).toContain('ADR-204 ruling 9');
});

test('ruling 9: a day past coverage is UNKNOWN and a day inside it is positively not a session', () => {
  const state = eligibleNow();

  // `2026-11-23` is past the slice's `2026-11-20` coverage, so whether it is a
  // session is unknown. ADR-049's own kind, and the answer B2 is about.
  const past = projectPayout({
    state,
    plan: CORE_50K,
    gates: CLEAR,
    calendar: WINDOW,
    horizon: [...HORIZON, day('2026-11-23')],
  });
  expect(past.kind === 'refused' && past.assertion.kind).toBe('calendar_coverage_miss');
  expect(past.kind === 'refused' && past.assertion.detail).toContain('UNKNOWN');

  // `2026-11-14` is INSIDE coverage and absent from `days`, which `0032`'s rule
  // makes a positive statement rather than an absence: it is not a session.
  // THE TWO ANSWERS DIFFER AND ONLY ONE OF THEM IS SAFE TO ACT ON.
  const notASession = projectPayout({
    state,
    plan: CORE_50K,
    gates: CLEAR,
    calendar: WINDOW,
    horizon: [day('2026-11-12'), day('2026-11-14')],
  });
  expect(notASession.kind === 'refused' && notASession.assertion.kind).toBe('day_not_a_session');
  expect(notASession.kind === 'refused' && notASession.assertion.tradingDay).toBe('2026-11-14');
});

test('the horizon must ascend strictly from the last closed day, and it ascends by sequence', () => {
  const state = eligibleNow();
  const attempt = (horizon: readonly TradingDay[]): PayoutProjectionOutcome =>
    projectPayout({ state, plan: CORE_50K, gates: CLEAR, calendar: WINDOW, horizon });

  // Not forward: `2026-11-10` precedes the last closed day, so "FIRST
  // eligibility" would name a day the engine has already answered for.
  const backwards = attempt([day('2026-11-10'), day('2026-11-12')]);
  expect(backwards.kind === 'refused' && backwards.assertion.kind).toBe('not_forward');

  // The last closed day itself is not forward of itself, which is INV-14's `>`.
  const sameDay = attempt([AS_OF, day('2026-11-12')]);
  expect(sameDay.kind === 'refused' && sameDay.assertion.kind).toBe('not_forward');

  // A REPEATED DAY IS CAUGHT BY THE SAME COMPARISON, for free, because two
  // lookups of one day return one sequence and `<=` is strict on the far side.
  const repeated = attempt([day('2026-11-12'), day('2026-11-12')]);
  expect(repeated.kind === 'refused' && repeated.assertion.kind).toBe('not_forward');

  // Out of order, and the detail names the SEQUENCES rather than the dates,
  // because R-02's ordering is the calendar's and never the string's.
  const unordered = attempt([day('2026-11-13'), day('2026-11-12')]);
  expect(unordered.kind === 'refused' && unordered.assertion.kind).toBe('not_forward');
  expect(unordered.kind === 'refused' && unordered.assertion.detail).toContain('sequence 7319');
});

test('a slice that cannot reach the cadence anchor refuses rather than passing the gate', () => {
  // P2 section 1: returning null "silently weakens R-37, a money gate". The
  // anchor may be months older than the horizon, so a caller that loaded only
  // the horizon has a slice that cannot answer, and it is told so.
  const short = buildCalendarSlice({
    days: SESSIONS.slice(8).map(([tradingDay, sequence]) => ({
      tradingDay: day(tradingDay),
      isHalfDay: false,
      halted: false,
      sequence,
    })),
    coverage: { from: day('2026-11-12'), to: day('2026-11-20') },
  });

  const outcome = projectPayout({
    state: cadencePending(),
    plan: CORE_50K,
    gates: CLEAR,
    calendar: short,
    horizon: HORIZON,
  });
  // The LAST CLOSED DAY is outside this slice before the anchor is even reached,
  // and the projection has nothing to be strictly after.
  expect(outcome.kind === 'refused' && outcome.assertion.kind).toBe('calendar_coverage_miss');
  expect(outcome.kind === 'refused' && outcome.assertion.tradingDay).toBe(AS_OF);
});

// -----------------------------------------------------------------------------
// RULING 6 AND RULING 7. The assumptions ride on the answer
// -----------------------------------------------------------------------------
// Ruling 6: "THE FIVE ASSUMPTIONS ARE PART OF THIS RULING AND A PRODUCER MAY NOT
// CHOOSE THEM." Ruling 7: the figure "is a lower bound on the population and is
// NOT a bound on the money, and BOTH HALVES ARE STATED WHEREVER IT IS SHOWN. A
// panel that prints this number without the second half reproduces EC-074 inside
// EC-074's own remedy."
test('ruling 6 and 7: all five assumptions and both halves of the caveat travel with the figure', () => {
  const p = projected(run(cadencePending()));

  expect(p.assumptions.map((a) => a.id)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5']);
  expect(p.assumptions).toBe(PROJECTION_ASSUMPTIONS);
  expect(p.caveat).toBe(PROJECTION_CAVEAT);

  // THE DIRECTION IS THE HALF A RENDERER WOULD DROP FIRST, so each is asserted
  // at its own assumption rather than as a count of five strings.
  const cost = (id: string): string => p.assumptions.find((a) => a.id === id)?.cost ?? '';
  expect(cost('A1')).toContain('UNDERSTATES');
  expect(cost('A2')).toContain('NOT A BOUND IN EITHER DIRECTION');
  expect(cost('A3')).toContain('OVERSTATES');
  expect(cost('A4')).toContain('OVERSTATES');

  // Ruling 7's two halves, both present in the sentence a panel prints.
  expect(p.caveat).toContain('LOWER BOUND ON THE POPULATION');
  expect(p.caveat).toContain('NOT A BOUND ON');
});
