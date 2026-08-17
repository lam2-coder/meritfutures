// =============================================================================
// GROUP D: BREACH. RE-U-021 to RE-U-025.
// =============================================================================
// TWO STRICT OPERATORS AND ONE ORDERING LAW, and all three are the difference
// between an account that survives a clean liquidation and one that does not.
// =============================================================================

import { expect, test } from 'vitest';

import { advanceDay } from '../src/day/advance.js';
import type { BreachDetectedEvent, DayOutput, ResolvedPlan, RuleState } from '../src/types.js';
import {
  ACCOUNT_OPENED_ON,
  CME_WINDOW,
  CORE_50K,
  ENGINE_VERSION,
  day,
  fundedPrior,
  mark,
  withDailyLossLimit,
  withStaticDrawdown,
} from './fixtures-in-code.js';
import { reU } from './rule-coverage.js';

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
// R-21  `low_balance_cents < floorOpenCents`, STRICT
// -----------------------------------------------------------------------------
test(reU('R-21'), () => {
  // TOUCHING THE FLOOR IS NOT A BREACH. The floor at the open is 4,750,000 and a
  // low of exactly 4,750,000 survives: "a clean liquidation lands exactly on the
  // floor and survives; slippage below it breaches" (R-20).
  const touched = fold(CORE_50K, {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: -200_000n,
    lowBalanceCents: 4_750_000n,
  });
  expect(touched.state.breached).toBe(false);
  expect(touched.state.phase).toBe('funded');
  expect(touched.events.map((e) => e.type)).toEqual(['day.closed']);

  // ONE CENT BELOW BREACHES, and the shortfall is that cent.
  const breached = fold(CORE_50K, {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: -200_000n,
    lowBalanceCents: 4_749_999n,
  });
  expect(breached.state.breached).toBe(true);
  expect(breached.state.breachKind).toBe('trailing_eod_floor');
  expect(breached.state.phase).toBe('closed');
  expect(breached.events.map((e) => e.type)).toEqual(['breach.detected']);
  const event = breached.events[0] as BreachDetectedEvent;
  expect(event.shortfallCents).toBe(1n);
  expect(event.floorCents).toBe(4_750_000n);

  // The kind names the configured drawdown type, because the evidence pack must
  // say WHICH rule closed the account rather than infer it from the numbers.
  const staticPlan = withStaticDrawdown(CORE_50K);
  const staticBreach = fold(staticPlan, {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: -200_000n,
    lowBalanceCents: 4_749_999n,
  });
  expect(staticBreach.state.breachKind).toBe('static_floor');
});

// -----------------------------------------------------------------------------
// R-22  `-realized_pnl_cents > daily_loss_limit_cents`, STRICT
// -----------------------------------------------------------------------------
test(reU('R-22'), () => {
  // OQ-6 RULED "EXACTLY AT THE LIMIT SURVIVES", so a loss of exactly 100,000c
  // against a 100,000c limit does not breach. M01 section 3.6's pseudocode
  // writes this comparison as `>=`; R-22's operator column, OQ-6's ruling and
  // section 10.1 all write `>`, and section 3.5 makes the operator column the
  // contract. The disagreement is reported, not resolved here.
  const plan = withDailyLossLimit(CORE_50K, 'hard', 100_000n);

  const atLimit = fold(plan, {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: -100_000n,
    lowBalanceCents: 4_900_000n,
  });
  expect(atLimit.state.breached).toBe(false);

  const overLimit = fold(plan, {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: -100_001n,
    lowBalanceCents: 4_899_999n,
  });
  expect(overLimit.state.breached).toBe(true);
  expect(overLimit.state.breachKind).toBe('hard_daily_loss_limit');

  // A limit configured `none` is not a limit of zero: an unlimited losing day
  // does not breach on this rule, and only the floor can close the account.
  const noLimit = fold(CORE_50K, {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: -200_000n,
    lowBalanceCents: 4_800_000n,
  });
  expect(noLimit.state.breached).toBe(false);
});

// -----------------------------------------------------------------------------
// R-23  a soft limit is NEVER a breach
// -----------------------------------------------------------------------------
test(reU('R-23'), () => {
  const plan = withDailyLossLimit(CORE_50K, 'soft', 100_000n);

  const exceeded = fold(plan, {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: -100_001n,
    lowBalanceCents: 4_899_999n,
  });
  expect(exceeded.state.breached).toBe(false);
  expect(exceeded.state.phase).toBe('funded');
  // The engine emits a fact and Rithmic performs any enforcement (R-23, and
  // `rule.soft_dll_exceeded` is defined so enabling one is a config change).
  expect(exceeded.events.map((e) => e.type)).toEqual(['rule.soft_dll_exceeded', 'day.closed']);

  // EXACTLY AT THE LIMIT EMITS NOTHING, the same boundary as R-22's.
  const atLimit = fold(plan, {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: -100_000n,
    lowBalanceCents: 4_900_000n,
  });
  expect(atLimit.events.map((e) => e.type)).toEqual(['day.closed']);
});

// -----------------------------------------------------------------------------
// R-24  breach is terminal
// -----------------------------------------------------------------------------
test(reU('R-24'), () => {
  const breached = fold(CORE_50K, {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: -300_000n,
    lowBalanceCents: 4_700_000n,
  });
  expect(breached.state.phase).toBe('closed');

  // THE NEXT DAY REFUSES. INV-12: no state advances after a breach, and the
  // refusal names the phase rather than silently returning the same state.
  const after = fold(
    CORE_50K,
    {
      tradingDay: day('2026-11-04'),
      openingBalanceCents: 4_700_000n,
      realizedPnlCents: 50_000n,
    },
    breached.state,
  );
  expect(after.assertions.map((a) => a.kind)).toEqual(['account_closed']);
  expect(after.state).toEqual(breached.state);
  expect(after.events).toEqual([]);
});

// -----------------------------------------------------------------------------
// R-25  breach beats everything the same day
// -----------------------------------------------------------------------------
test(reU('R-25'), () => {
  // An EVAL day that breaks the floor intraday and closes above the profit
  // target. DO-4 runs before DO-8, so the day closes the account and DO-8 is
  // never reached: no pass, and not even the refusal an eval-phase day would
  // otherwise return while group E is unwritten. "Breach beats every pass,
  // target, and eligibility condition that the same day might also satisfy."
  const priorEval = {
    ...fundedPrior(CORE_50K),
    phase: 'eval' as const,
  };
  const out = fold(
    CORE_50K,
    {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_000_000n,
      realizedPnlCents: 400_000n,
      lowBalanceCents: 4_700_000n,
    },
    priorEval,
  );
  expect(out.state.breached).toBe(true);
  expect(out.state.phase).toBe('closed');
  expect(out.assertions).toEqual([]);
  expect(out.events.map((e) => e.type)).toEqual(['breach.detected']);

  // THE OTHER SIDE, AND GROUP E MADE IT THE REAL ONE. The identical day whose
  // low stays above the floor is not a breach, reaches DO-8, and PASSES THE
  // EVAL: 400,000c of profit clears the 300,000c target and two traded days
  // clear the 1-day minimum. So the breaching run above discarded a genuine
  // `phase.passed`, which is exactly what R-25 claims ("no `phase.passed`, no
  // eligibility, no graduation") and what this pair now proves rather than
  // asserts. Until group E landed, this half could only observe a refusal.
  const survived = fold(
    CORE_50K,
    {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_000_000n,
      realizedPnlCents: 400_000n,
      lowBalanceCents: 4_800_000n,
    },
    priorEval,
  );
  expect(survived.assertions).toEqual([]);
  expect(survived.state.breached).toBe(false);
  expect(survived.state.phase).toBe('funded');
  expect(survived.events.map((e) => e.type)).toEqual([
    'rule.floor_locked',
    'phase.passed',
    'day.closed',
  ]);

  // And the breaching day emitted none of them. EC-004: "No `phase.passed` is
  // emitted and no funded state is written."
  expect(out.events.map((e) => e.type)).not.toContain('phase.passed');
});
