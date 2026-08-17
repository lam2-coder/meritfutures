// =============================================================================
// packages/rules-engine/test/advance-day.test.ts
// =============================================================================
// THE FOLD ITSELF: DO-1's preconditions, the two steps that REFUSE because the
// groups behind them are unwritten, and the day that closes.
//
// These are not `RE-U-nn` tests and are not claimed as rules. They assert the
// SHAPE of the fold -- what refuses, what it refuses with, and that a refusal
// writes nothing -- which is what makes the honest count checkable rather than
// merely stated: a session that quietly implemented DO-2 by ignoring
// settlements would pass every rule test in this suite and fail here.
// =============================================================================

import { expect, test } from 'vitest';

import { buildCalendarSlice } from '../src/calendar.js';
import { advanceDay, initialState } from '../src/day/advance.js';
import type { DayClosedEvent, SettlementFact } from '../src/types.js';
import {
  ACCOUNT_OPENED_ON,
  CME_WINDOW,
  CORE_50K,
  ENGINE_VERSION,
  day,
  fundedPrior,
  mark,
} from './fixtures-in-code.js';

const A_DAY = {
  tradingDay: day('2026-11-03'),
  openingBalanceCents: 5_000_000n,
  realizedPnlCents: 20_000n,
} as const;

function fold(overrides: Partial<Parameters<typeof advanceDay>[0]> = {}) {
  return advanceDay({
    engineVersion: ENGINE_VERSION,
    plan: CORE_50K,
    prior: fundedPrior(CORE_50K),
    mark: mark(A_DAY),
    calendar: CME_WINDOW,
    settlements: [],
    openedOn: ACCOUNT_OPENED_ON,
    ...overrides,
  });
}

test('DO-1  a day that is not strictly after the prior state refuses, and INV-14 follows', () => {
  const first = fold();
  expect(first.assertions).toEqual([]);

  // The same day again. INV-14: "Applying the same trading day twice is a no-op
  // on state", and the no-op is a refusal carrying the state unchanged rather
  // than a second application that happens to be idempotent.
  const again = fold({ prior: first.state });
  expect(again.assertions.map((a) => a.kind)).toEqual(['not_forward']);
  expect(again.state).toEqual(first.state);

  // And a day BEFORE the prior state, which is the arrival-order case FM-02
  // describes and which the fold refuses rather than folding backwards.
  const backwards = fold({
    prior: first.state,
    mark: mark({ ...A_DAY, tradingDay: day('2026-11-02'), openingBalanceCents: 5_020_000n }),
  });
  expect(backwards.assertions.map((a) => a.kind)).toEqual(['not_forward']);
});

test('DO-1  the calendar answers three ways, and two of them are not the same refusal', () => {
  // INSIDE COVERAGE AND NOT A SESSION: positively not a trading day (FM-13).
  const weekend = buildCalendarSlice({
    days: CME_WINDOW.days.filter((d) => d.tradingDay !== day('2026-11-03')),
    coverage: CME_WINDOW.coverage,
  });
  const notASession = fold({ calendar: weekend });
  expect(notASession.assertions.map((a) => a.kind)).toEqual(['day_not_a_session']);

  // OUTSIDE COVERAGE: UNKNOWN, which is a different answer and gets a different
  // refusal (ADR-049, ADR-042 F-4). Collapsing the two would let a caller's
  // window decide whether a day was a trading day.
  const narrow = buildCalendarSlice({
    days: CME_WINDOW.days.filter((d) => d.tradingDay <= day('2026-11-02')),
    coverage: { from: day('2026-11-02'), to: day('2026-11-02') },
  });
  const unknown = fold({ calendar: narrow });
  expect(unknown.assertions.map((a) => a.kind)).toEqual(['calendar_coverage_miss']);
  expect(unknown.assertions[0]?.detail).toContain('UNKNOWN');

  // A refusal writes no state and emits no event, whichever refusal it is.
  expect(unknown.events).toEqual([]);
  expect(unknown.state.tradingDay).toBe(day('2026-11-02'));
});

test('DO-2  a settlement effective today is APPLIED, and the day still closes', () => {
  // THIS TEST REFUSED UNTIL GROUP H LANDED, which is the same diff group E left
  // behind one step earlier: `settlement_unimplemented` is gone from
  // `AssertionKind` because nothing can emit it, and a kind nothing can emit is
  // a lie about what the engine refuses.
  //
  // What it asserted then was the reason for the refusal, and that reason is
  // what it asserts now from the other side: the settled amount reaches the
  // balance exactly once. Folding the day WITHOUT applying it produced a state
  // 150,000c too high, which is a second payout waiting to happen; applying it
  // TWICE -- once in the fold and once through the mark's `adjustment_cents` --
  // produces one 150,000c too low, which breaches the account that earned it.
  const settlement: SettlementFact = {
    payoutRequestId: '0199c7a1-0000-7000-8000-00000000000f',
    ordinal: 1,
    approvedCents: 150_000n,
    basisTradingDay: day('2026-11-02'),
    effectiveTradingDay: day('2026-11-03'),
  };

  // SD-01 and R-10: the withdrawal lands at the OPEN of the effective day and is
  // carried in `adjustment_cents`, never inside the session.
  //   opening 4,850,000 = prior 5,000,000 + adjustment -150,000   (INV-18)
  //   closing 4,870,000 = opening + realized 20,000               (INV-19)
  const out = fold({
    settlements: [settlement],
    mark: mark({
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 4_850_000n,
      adjustmentCents: -150_000n,
      realizedPnlCents: 20_000n,
    }),
  });

  expect(out.assertions).toEqual([]);
  expect(out.state.payoutsSettledCount).toBe(1);
  expect(out.state.balanceCents).toBe(4_870_000n);
  expect(out.state.lifetimeSettledCents).toBe(150_000n);
  expect(out.events.map((e) => e.type)).toEqual(['payout.win_days_reset', 'day.closed']);
});

test('DO-8  an eval-phase day that meets no condition folds and closes, unchanged', () => {
  // THIS TEST REFUSED UNTIL GROUP E LANDED and it now closes, which is the diff
  // worth reading: `eval_progression_unimplemented` is gone from `AssertionKind`
  // because nothing can emit it, and a kind nothing can emit is a lie about what
  // the engine refuses.
  const priorEval = initialState(CORE_50K, day('2026-11-02'), ENGINE_VERSION);
  expect(priorEval.phase).toBe('eval');

  const out = fold({ prior: priorEval });
  expect(out.assertions).toEqual([]);

  // 20,000c of profit against a 300,000c target: R-26 is false, so DO-8 does
  // nothing at all and the day emits only `day.closed`. R-28's deferral event is
  // NOT emitted, because consistency is tested only once R-26 and R-27 hold.
  expect(out.state.phase).toBe('eval');
  expect(out.events.map((e) => e.type)).toEqual(['day.closed']);

  // DO-4 to DO-7 ran, and their numbers are unchanged by DO-8 having run.
  expect(out.state.floorCents).toBe(4_770_000n);
  expect(out.state.tradedDaysCount).toBe(1);
});

test('DO-9  a funded day closes, and `day.closed` carries what the fold computed', () => {
  const out = fold();
  expect(out.assertions).toEqual([]);
  expect(out.events.map((e) => e.type)).toEqual(['day.closed']);

  const closed = out.events[0] as DayClosedEvent;
  expect(closed.closingBalanceCents).toBe(5_020_000n);
  // SD-04: the floor the day was JUDGED against, beside the one it leaves behind.
  expect(closed.floorOpenCents).toBe(4_750_000n);
  expect(closed.floorCents).toBe(4_770_000n);
  expect(closed.adjustmentCents).toBe(0n);
});

test('the fold mutates nothing it was given', () => {
  const prior = fundedPrior(CORE_50K);
  const snapshot = { ...prior };
  const input = mark(A_DAY);
  const markSnapshot = { ...input };

  fold({ prior, mark: input });

  // "Mutation of an input: aliasing bugs are non-deterministic in practice. All
  // functions return new values; inputs are `readonly`" (the determinism
  // contract). `readonly` is a compile-time claim and this is the run-time one.
  expect(prior).toEqual(snapshot);
  expect(input).toEqual(markSnapshot);
});
