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

test('DO-2  a settlement effective today refuses, because group H is not written', () => {
  const settlement: SettlementFact = {
    payoutRequestId: '0199c7a1-0000-7000-8000-00000000000f',
    ordinal: 1,
    approvedCents: 150_000n,
    basisTradingDay: day('2026-11-02'),
    effectiveTradingDay: day('2026-11-03'),
  };

  const out = fold({ settlements: [settlement] });
  expect(out.assertions.map((a) => a.kind)).toEqual(['settlement_unimplemented']);
  expect(out.assertions[0]?.detail).toContain('R-46');
  expect(out.events).toEqual([]);

  // THE POINT OF THE REFUSAL, and the reason it is not a skip: the settled
  // amount never reaches the balance, so folding the day anyway would produce a
  // state 150,000c too high and pay a second time against it.
  expect(out.state.balanceCents).toBe(5_000_000n);
  expect(out.state.payoutsSettledCount).toBe(0);
});

test('DO-8  an eval-phase day refuses AFTER the day is computed, and names group E', () => {
  const priorEval = initialState(CORE_50K, day('2026-11-02'), ENGINE_VERSION);
  expect(priorEval.phase).toBe('eval');

  const out = fold({ prior: priorEval });
  expect(out.assertions.map((a) => a.kind)).toEqual(['eval_progression_unimplemented']);

  // DO-4 to DO-7 ran: the state carried back has the day's floor and counters on
  // it, which is what makes the refusal a boundary rather than a wall. It is
  // still a refusal, so the caller writes none of it.
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
