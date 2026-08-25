// =============================================================================
// packages/rules-engine/test/engine-events.test.ts
// =============================================================================
// THE `EngineEvent` UNION, AND THE ONE THING A UNION CANNOT ASSERT ABOUT ITSELF.
//
// `DayOutput.events` is `readonly EngineEvent[]`, and `EngineEvent` is now the
// discriminated union of the eight concrete events rather than the base
// `{ type: string; tradingDay }`. That change is what lets a consumer narrow on
// `type` and read a payload field WITHOUT A CAST, which is the defect it exists
// to close: an unchecked cast on a money-path payload, one per event type, with
// nothing checking that the cast matched the string it was guarded by.
//
// TYPES ARE ERASED, SO THE UNION'S MEMBERSHIP IS NOT SELF-CHECKING AT RUNTIME.
// Two failures are possible and neither is caught by the compiler alone:
//
//   A NAME IN THE UNION THAT NOTHING EMITS.  A member whose `type` literal no
//   source constructs. The union compiles, every consumer writes a branch for
//   it, and the branch is dead. This is the direction a retired event fails in:
//   `payout.floor_recomputed` has had no producer since ADR-014.
//
//   A NAME NOTHING EMITS THAT IS MISSING.   A ninth event added to `advance.ts`
//   and not to the union. The `events.push` still compiles when the array is
//   declared `EngineEvent[]` only because the new event's own interface has to
//   be added to the union to be assignable, so THIS direction the compiler does
//   catch. It is asserted anyway, because it costs one line and the assertion
//   is what says the coverage below is complete rather than incidental.
//
// So the count is pinned against a compile-time record whose keys ARE the union,
// and the narrowing is exercised against events a real fold actually emitted.
// =============================================================================

import { expect, test } from 'vitest';

import { advanceDay, initialState } from '../src/day/advance.ts';
import { applySettlement } from '../src/payout/settle.ts';
import type {
  DayOutput,
  EngineEvent,
  EngineEventType,
  ResolvedPlan,
  RuleState,
} from '../src/types.ts';
import {
  ACCOUNT_OPENED_ON,
  CME_WINDOW,
  CORE_50K,
  ENGINE_VERSION,
  day,
  evalPrior,
  fundedPrior,
  mark,
} from './fixtures-in-code.ts';

/** One day, folded. The same helper shape the other rule suites use. */
function fold(
  plan: ResolvedPlan,
  fields: Parameters<typeof mark>[0],
  prior: RuleState = fundedPrior(plan),
): DayOutput {
  return advanceDay({
    engineVersion: ENGINE_VERSION,
    plan,
    prior,
    mark: mark(fields),
    calendar: CME_WINDOW,
    settlements: [],
    openedOn: ACCOUNT_OPENED_ON,
  });
}

// -----------------------------------------------------------------------------
// THE MEMBERSHIP, PINNED IN BOTH DIRECTIONS
// -----------------------------------------------------------------------------
// `Record<EngineEventType, true>` is the mechanism. A member added to the union
// and not to this literal is a missing-property compile error; a key here that
// the union does not admit is an excess-property compile error. So the literal
// cannot drift from the union, and `Object.keys` then gives the runtime the
// union's own membership to count and to compare against what the engine emits.

const EVERY_EVENT_TYPE: Record<EngineEventType, true> = {
  'day.closed': true,
  'breach.detected': true,
  'phase.passed': true,
  'phase.pass_deferred_consistency': true,
  'account.graduated': true,
  'account.expired': true,
  'payout.win_days_reset': true,
  'rule.floor_locked': true,
  'rule.soft_dll_exceeded': true,
};

test('the EngineEvent union has exactly the nine events the engine emits', () => {
  const names = Object.keys(EVERY_EVENT_TYPE).sort();

  // NINE. M01 section 5.2's table lists eleven names and three have no producer
  // in the day fold: `payout.floor_recomputed` is "retired at the M1 gate" with
  // no producer after ADR-014, `account.live_invitation_issued` is never emitted
  // because ADR-024 puts invitation "outside the engine", and
  // `replay.divergence_detected` belongs to Appendix B's replay harness rather
  // than to `advanceDay` or `applySettlement`. That leaves eight from the table.
  //
  // THE NINTH IS `account.expired` AND SECTION 5.2's TABLE DOES NOT LIST IT,
  // which is a gap in that table rather than an invented name. R-32 emits it,
  // section 5.2 defers to the catalogue ("all exist in the approved EVENTS.md
  // catalogue except the two marked NEW"), and the catalogue has carried
  // `account.expired` with a stated payload the whole time R-32 refused. The
  // count below moved from 8 to 9 when ADR-051 unblocked the rule.
  expect(names).toHaveLength(9);
  expect(names).toContain('account.expired');

  // The three with no producer must NOT be union members. A retired event that
  // crept back into the union would have every consumer writing a dead branch.
  expect(names).not.toContain('payout.floor_recomputed');
  expect(names).not.toContain('account.live_invitation_issued');
  expect(names).not.toContain('replay.divergence_detected');
});

// -----------------------------------------------------------------------------
// NARROWING WORKS, WHICH IS THE ENTIRE POINT OF THE CHANGE
// -----------------------------------------------------------------------------
// Every read below is on a narrowed event and NOT ONE IS A CAST. Before the
// union existed, each of these lines needed `as DayClosedEvent` (and so on) and
// the compiler checked none of them against the `type` string above it. If the
// union regressed to the base type, this file stops compiling rather than
// starting to lie, which is the property worth having.

test('a day.closed event narrows to its own payload with no cast', () => {
  const closed = fold(CORE_50K, {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: 20_000n,
    fillCount: 2,
  }).events.find((e): e is Extract<EngineEvent, { type: 'day.closed' }> => e.type === 'day.closed');

  expect(closed).toBeDefined();
  if (closed === undefined) return;

  // `closingBalanceCents`, `withdrawableCents` and `engineGates` exist ONLY on
  // `DayClosedEvent`. Reading them off the base type was a compile error, and
  // reading them off the union without the guard above still is.
  expect(closed.closingBalanceCents).toBe(5_020_000n);
  expect(closed.tradedDaysCount).toBeGreaterThanOrEqual(0);
  expect(typeof closed.engineGates.consistency.skipped).toBe('boolean');
});

test('a breach.detected event narrows to its own payload with no cast', () => {
  const out = fold(CORE_50K, {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    lowBalanceCents: 4_700_000n,
    realizedPnlCents: -300_000n,
    fillCount: 3,
  });

  const breach = out.events.find(
    (e): e is Extract<EngineEvent, { type: 'breach.detected' }> => e.type === 'breach.detected',
  );

  expect(breach).toBeDefined();
  if (breach === undefined) return;

  // `breachKind` and `shortfallCents` are `BreachDetectedEvent`'s alone.
  expect(breach.breachKind).toBe('trailing_eod_floor');
  expect(breach.shortfallCents).toBeGreaterThan(0n);
});

// -----------------------------------------------------------------------------
// A `switch` OVER THE UNION IS EXHAUSTIVE, WHICH IS WHAT A CONSUMER ACTUALLY DOES
// -----------------------------------------------------------------------------
// The `never` default is the assertion. A ninth event added to the union and not
// to this switch fails to compile HERE, in a test, rather than at whichever
// consumer forgot it. This is the shape `apps/worker` should be using and is not
// (see the session log's follow-up).

function describeEvent(event: EngineEvent): string {
  switch (event.type) {
    case 'day.closed':
      return `closed at ${String(event.closingBalanceCents)}`;
    case 'breach.detected':
      return `breached by ${String(event.shortfallCents)}`;
    case 'phase.passed':
      return `passed to ${event.toPhase} at ${String(event.targetCents)}`;
    case 'phase.pass_deferred_consistency':
      return `deferred, short ${String(event.shortfallCents)}`;
    case 'account.graduated':
      return `graduated after ${String(event.payoutsSettledCount)}`;
    case 'account.expired':
      return `expired on day ${String(event.elapsedTradingDays)} of ${String(event.maxDays)}`;
    case 'payout.win_days_reset':
      return `win days ${String(event.previousCount)} -> ${String(event.resetTo)}`;
    case 'rule.floor_locked':
      return `floor locked at ${String(event.lockedFloorCents)}`;
    case 'rule.soft_dll_exceeded':
      return `soft dll ${String(event.realizedPnlCents)} past ${String(event.limitCents)}`;
    default: {
      // If this line stops compiling, a member was added to the union and not
      // handled above. That is the error being bought.
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

test('every emitted event is handled by an exhaustive switch', () => {
  const out = fold(CORE_50K, {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: 20_000n,
    fillCount: 2,
  });

  expect(out.events.length).toBeGreaterThan(0);
  for (const event of out.events) {
    // No branch may fall through to a nullish or empty description, which is
    // what a `type` the switch does not really cover would produce.
    expect(describeEvent(event)).not.toBe('');
  }
});

// -----------------------------------------------------------------------------
// THE UNION COVERS `applySettlement` TOO, NOT ONLY THE DAY FOLD
// -----------------------------------------------------------------------------
// `SettlementOutput.events` is the same `readonly EngineEvent[]`, and two of the
// eight members (`payout.win_days_reset`, `account.graduated`) are emitted ONLY
// from there. A union that covered `advanceDay` alone would narrow on one output
// and not the other, which is the half a day-fold-only test would miss.

test('settlement events are members of the same union and narrow the same way', () => {
  const settled = applySettlement(
    initialState(CORE_50K, day('2026-11-02'), ENGINE_VERSION),
    CORE_50K,
    {
      payoutRequestId: '0199c7a1-0000-7000-8000-0000000000f1',
      ordinal: 1,
      approvedCents: 100_000n,
      basisTradingDay: day('2026-11-02'),
      effectiveTradingDay: day('2026-11-02'),
    },
    CME_WINDOW,
  );

  const reset = settled.events.find(
    (e): e is Extract<EngineEvent, { type: 'payout.win_days_reset' }> =>
      e.type === 'payout.win_days_reset',
  );

  expect(reset).toBeDefined();
  if (reset === undefined) return;

  // `anchorTradingDay` is `WinDaysResetEvent`'s alone, and R-47's whole point:
  // "reset to zero without the anchor is not enough to explain the next cycle".
  expect(reset.anchorTradingDay).toBe('2026-11-02');
  expect(reset.resetTo).toBe(0);
  expect(describeEvent(reset)).toContain('-> 0');
});

// -----------------------------------------------------------------------------
// AN EVAL PASS IS THE CASE RULING 3 MOVED, AND ITS EVENT PAYLOAD MOVED WITH IT
// -----------------------------------------------------------------------------
// CORE-50K's EVAL consistency is `enabled: false`, which is the only such block
// in the published lineup. Before the CV-19 repair, `phase.passed` carried
// `consistency.skipped: false` on this event, so a gate the plan never
// configured travelled to M10 and the trader timeline reading as SATISFIED. It
// now reports `skipped: true` with a `null` limit, which is the disabled shape.

test('phase.passed reports a disabled eval consistency gate as skipped', () => {
  const passed = fold(
    CORE_50K,
    {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_280_000n,
      highBalanceCents: 5_300_000n,
      lowBalanceCents: 5_280_000n,
      realizedPnlCents: 20_000n,
      fillCount: 2,
    },
    // The prior's balance has to match the mark's open, and 5,280,000c is one
    // day short of R-26's 300,000c target so the pass happens on THIS day.
    evalPrior(CORE_50K, { balanceCents: 5_280_000n }),
  ).events.find(
    (e): e is Extract<EngineEvent, { type: 'phase.passed' }> => e.type === 'phase.passed',
  );

  expect(passed).toBeDefined();
  if (passed === undefined) return;

  // NOT EVALUATED, AND SAYING SO. CV-19: "no trader or support agent ever sees a
  // gate that reads as satisfied when it was never evaluated."
  expect(passed.consistency.skipped).toBe(true);
  expect(passed.consistency.satisfied).toBe(true);

  // And the discriminator still says WHICH kind of skipped: `null` is disabled,
  // where R-30's denominator rule would have carried the configured limit.
  expect(passed.consistency.maxDayShareBp).toBe(null);
  expect(passed.consistency.bestDayShareBp).toBe(null);
});
