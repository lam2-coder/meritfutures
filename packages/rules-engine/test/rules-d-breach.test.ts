// =============================================================================
// GROUP D: BREACH. RE-U-021 to RE-U-025.
// =============================================================================
// TWO STRICT OPERATORS AND ONE ORDERING LAW, and all three are the difference
// between an account that survives a clean liquidation and one that does not.
// =============================================================================

import { expect, test } from 'vitest';

import { advanceDay } from '../src/day/advance.ts';
import type { BreachDetectedEvent, DayOutput, ResolvedPlan, RuleState } from '../src/types.ts';
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
} from './fixtures-in-code.ts';
import { reU } from './rule-coverage.ts';

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

  // ---------------------------------------------------------------------------
  // THE CARRIED-FIELD SET, WHICH IS ADR-054's MECHANICAL REMEDY
  // ---------------------------------------------------------------------------
  // R-24 is "no further state is ever written" and DO-5's row is "Nothing after
  // this runs". Every assertion above tests a CONSEQUENCE of that (no pass, no
  // graduation, no eligibility). This one tests the law itself: on a breach row
  // every field outside M01 section 3.6's written set equals the state that
  // entered DO-4.
  //
  // IT CATCHES THE CLASS RATHER THAN THE INSTANCE, which is why ADR-054 names it
  // and why it is worth more than the ruling that commissioned it. The defect it
  // exists to stop was a single recompute added inside the terminal branch --
  // `withdrawableCents`, which is DO-9's R-35 -- and it survived because nothing
  // asserted the SHAPE of the row, only its individual values. Any future
  // recompute anywhere in that branch now fails here.
  //
  // `Record<keyof RuleState, ...>` IS THE MECHANISM AND NOT DECORATION: a field
  // added to `RuleState` and left unclassified is a COMPILE error, so the
  // classification cannot silently fall behind the type.
  const BREACH_ROW_FIELDS: Record<keyof RuleState, 'written' | 'carried'> = {
    // M01 section 3.6's breach block, verbatim and in its order. EIGHT.
    tradingDay: 'written',
    phase: 'written',
    breached: 'written',
    breachKind: 'written',
    floorOpenCents: 'written',
    balanceCents: 'written',
    engineEligible: 'written',
    engineVersion: 'written',

    // THE NINTH, AND M01's EIGHT DO NOT INCLUDE IT. `RuleState` requires a gate
    // record and section 3.6 predates the field, so `gatesAfterBreach` states one
    // rather than evaluating it. This is pre-existing and correct, and it is
    // named here rather than folded into the eight because an unexplained ninth
    // entry is the next reader's false lead. Whether 3.6's block should gain it
    // is RESIDUE recorded in STATE.md; it is outside ADR-054 and not decided here.
    engineGates: 'written',

    // Everything else carries. `withdrawableCents` is the one ADR-054 moved.
    floorCents: 'carried',
    floorLocked: 'carried',
    highWaterBalanceCents: 'carried',
    withdrawableCents: 'carried',
    tradedDaysCount: 'carried',
    winDaysCount: 'carried',
    consistencyBestDayCents: 'carried',
    consistencyPeriodProfitCents: 'carried',
    consistencyPeriodStartDay: 'carried',
    payoutsSettledCount: 'carried',
    payoutAnchorDay: 'carried',
    cadenceAnchorDay: 'carried',
    lifetimeSettledCents: 'carried',
  };

  // The written set is stated twice and must agree, so the classification above
  // cannot quietly grow a tenth entry to accommodate a new recompute.
  expect(
    Object.entries(BREACH_ROW_FIELDS)
      .filter(([, kind]) => kind === 'written')
      .map(([field]) => field)
      .sort(),
  ).toEqual(
    [
      'balanceCents',
      'breachKind',
      'breached',
      'engineEligible',
      'engineGates',
      'engineVersion',
      'floorOpenCents',
      'phase',
      'tradingDay',
    ].sort(),
  );

  // A BREACH ROW FOLDED WITH NO SETTLEMENTS, so `settledState === prior`
  // (`advance.ts` initialises `settledState = prior` and reassigns it only inside
  // the settlement loop). Without that, "carried" would mean carried from a state
  // no test can observe.
  const carriedPrior = fundedPrior(CORE_50K);
  const breachRow = fold(
    CORE_50K,
    {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_000_000n,
      realizedPnlCents: -300_000n,
      lowBalanceCents: 4_700_000n,
    },
    carriedPrior,
  ).state;

  expect(breachRow.breached).toBe(true);
  for (const [field, kind] of Object.entries(BREACH_ROW_FIELDS)) {
    if (kind !== 'carried') continue;
    const key = field as keyof RuleState;
    expect(breachRow[key], `${field} must CARRY on a breach row (R-24, ADR-054)`).toEqual(
      carriedPrior[key],
    );
  }

  // AND THE NUMBER ITSELF, NOT ONLY THE CARRY. GS-064's own arithmetic:
  // `5,120,000 - 5,000,000 - 100,000 = 20,000c` at the close of day three, which
  // is the value its expectation pins on the breach row. The loop above proves
  // the MECHANISM; this proves the mechanism produces the number the fixture and
  // ADR-054 both name. If the two ever disagree, the loop says the carry broke
  // and this says the value did.
  const gs064Prior: RuleState = {
    ...fundedPrior(CORE_50K),
    balanceCents: 5_120_000n,
    withdrawableCents: 20_000n,
  };
  const gs064Breach = fold(
    CORE_50K,
    {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_120_000n,
      realizedPnlCents: 20_000n,
      highBalanceCents: 5_140_000n,
      lowBalanceCents: 4_700_000n,
    },
    gs064Prior,
  ).state;

  expect(gs064Breach.breached).toBe(true);
  expect(gs064Breach.withdrawableCents).toBe(20_000n);
  // NOT 0n, which is DO-9's R-35 run inside DO-5, and NOT 40,000n, which needs
  // that AND M01's phase guard discarded. ADR-054 records 40,000 as produced by
  // no reading at all.
  expect(gs064Breach.withdrawableCents).not.toBe(0n);
  expect(gs064Breach.withdrawableCents).not.toBe(40_000n);
});
