// =============================================================================
// packages/rules-engine/test/adr-056-carried-lock.property.test.ts
// =============================================================================
// THE SWEEP BEHIND `adr-056-carried-lock.test.ts`. That file walks two day
// streams and reports that ADR-056's second-funded-day breach does not
// reproduce on them. This one turns "not on those streams" into "on no
// generated stream", which is the difference between a measurement and a lucky
// seed, and the ADR is a signature away from a frozen invariant.
//
// WHAT IS SWEPT. A funded account carrying the lock across the `R-31` reset,
// folded day by day against the SAME marks as the shipped account it was
// branched from, over generated profit-and-loss and generated intraday
// excursions below the day's balance.
//
// THE PROPERTY, and it is one sentence: THE CARRIED-LOCK ACCOUNT BREACHES ON NO
// DAY THE SHIPPED ACCOUNT SURVIVES.
//
// THE REASON IT HOLDS IS STRUCTURAL RATHER THAN STATISTICAL, which is why a
// sweep can confirm it but is not what makes it true. Both accounts leave the
// reset with the same floor, `size_cents` minus the funded drawdown. The
// carried-lock floor is FROZEN there, because `R-13` and `R-15` are both guarded
// by `!floorLocked`. The shipped floor is NON-DECREASING from there, by `R-13`'s
// trail and by `R-14`'s tripwire. So the carried floor is at or below the
// shipped floor on every day, and `R-21` compares a low against the floor AT THE
// OPEN, so every carried-lock breach is also a shipped breach on the same day.
//
// ADR-056 CLAIMS THE OPPOSITE OF THIS PROPERTY, on every funded account, on the
// second funded day. If the ADR's mechanism were the engine's, this file would
// be red on nearly every generated stream rather than green on all of them.
//
// IT PINS NO RULING, for the same reason the unit file does not: `ADR-056` is
// `proposed`, and what is asserted here is what the shipped fold does with a
// counterfactual input. It claims no `RE-P-nn` number, because the `RE-P` series
// is M01 section 8's list of properties the engine must have and this is a
// measurement of a state the corpus has not decided is reachable.
// =============================================================================

import fc from 'fast-check';
import { beforeAll, describe, expect, test } from 'vitest';

import { advanceDay } from '../src/day/advance.ts';
import { buildCalendarSlice } from '../src/calendar.ts';
import type {
  CalendarSlice,
  Cents,
  DayOutput,
  ResolvedPlan,
  RuleState,
  TradingDay,
} from '../src/types.ts';
import {
  ACCOUNT_OPENED_ON,
  CME_WINDOW,
  CORE_50K,
  ENGINE_VERSION,
  MERIT_RAPID_50K,
  day,
  evalPrior,
  mark,
} from './fixtures-in-code.ts';

const RUNS = 300;
const REACHABILITY = 1_000;

/**
 * A window long enough to fold a funded life, and IT NAMES NO EXCHANGE.
 *
 * `GAPPED_SLICE` in `fixtures-in-code.ts` sets the precedent and states the
 * rule: `TR-01` forbids writing an exchange's calendar from recollection, and
 * what a slice like this asserts is "a property of the ENGINE's arithmetic over
 * whatever slice the caller supplied". Nothing below is a claim about which days
 * the CME trades.
 *
 * THE FUNDED FOLD READS ONLY THE ORDERING. `R-37`'s gap subtraction needs a
 * cadence anchor and there are no settlements here, so `cadenceAnchorDay` stays
 * null; `R-32` needs `max_days` and no v1 plan configures one. What the days
 * have to be is strictly increasing and present, which is all this slice claims.
 */
const LONG_WINDOW: CalendarSlice = buildCalendarSlice({
  days: Array.from({ length: 25 }, (_, i) => ({
    tradingDay: day(`2026-11-${String(i + 2).padStart(2, '0')}`),
    isHalfDay: false,
    halted: false,
    sequence: 4021 + i,
  })),
  coverage: { from: day('2026-11-02'), to: day('2026-11-26') },
});

/** `R-12` and `R-31`'s number, read from the plan. GS-019 pins it at 4,750,000c. */
const fundedResetFloorCents = (plan: ResolvedPlan): Cents =>
  plan.sizeCents - plan.funded.drawdown.drawdownCents;

/** `ADR-014`'s locked floor: the value ADR-056 predicts on every funded day. */
function lockedFloorCents(plan: ResolvedPlan): Cents {
  const lock = plan.funded.drawdown.lock;
  if (!lock.enabled) throw new Error('the plan has no floor lock');
  return lock.floorAtCents;
}

// -----------------------------------------------------------------------------
// The eval pass each plan crosses the reset on, folded once
// -----------------------------------------------------------------------------
// The two are the same pair the unit file walks, and both are lifted from tests
// that already exist: `RE-U-026`'s tie for CORE-50K and `RE-U-027`'s consistency
// arithmetic for MERIT-RAPID-50K. DIRECT-50K is absent because it has no
// evaluation phase (Appendix A.3), so it never reaches `R-31` at all, which the
// unit file measures.

function passState(
  plan: ResolvedPlan,
  prior: RuleState,
  fields: Parameters<typeof mark>[0],
): RuleState {
  const out = advanceDay({
    engineVersion: ENGINE_VERSION,
    plan,
    prior,
    mark: mark(fields),
    calendar: CME_WINDOW,
    settlements: [],
    openedOn: ACCOUNT_OPENED_ON,
  });
  if (out.assertions.length > 0) throw new Error('the pass day refused');
  if (out.state.phase !== 'funded') throw new Error('the pass day did not pass');
  return out.state;
}

const CORE_PASSED = (): RuleState =>
  passState(CORE_50K, evalPrior(CORE_50K), {
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: 300_000n,
  });

const RAPID_PASSED = (): RuleState =>
  passState(
    MERIT_RAPID_50K,
    evalPrior(MERIT_RAPID_50K, {
      balanceCents: 5_210_000n,
      tradedDaysCount: 2,
      consistencyBestDayCents: 70_000n,
      consistencyPeriodProfitCents: 210_000n,
    }),
    {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_210_000n,
      realizedPnlCents: 90_000n,
    },
  );

const LINEUP: ReadonlyArray<readonly [string, ResolvedPlan, () => RuleState]> = [
  ['CORE-50K', CORE_50K, CORE_PASSED],
  ['MERIT-RAPID-50K', MERIT_RAPID_50K, RAPID_PASSED],
];

// -----------------------------------------------------------------------------
// The generated funded day
// -----------------------------------------------------------------------------
// `pnlCents` spans a range that reaches both the funded lock trigger (260,000c
// of profit) and the funded floor (250,000c of loss) inside one day, so a stream
// of a few days visits re-locks and breaches without being aimed at either.
//
// `excursionCents` is how far the day's LOW went below where it opened or
// closed, whichever is lower. `0014`'s daily-marks constraint is
// `low_balance_cents <= least(opening_balance_cents, closing_balance_cents)`, so
// subtracting a non-negative excursion from that least is the shape a stored
// mark can have. It is what makes `R-21` reachable on a day that closed green,
// which is the case the whole comparison is about: the two accounts differ ONLY
// in the floor that low is compared against.

interface GeneratedDay {
  readonly pnlCents: number;
  readonly excursionCents: number;
}

const generatedDay = fc.record({
  pnlCents: fc.integer({ min: -300_000, max: 300_000 }),
  excursionCents: fc.integer({ min: 0, max: 400_000 }),
});

const generatedStream = fc.array(generatedDay, { minLength: 1, maxLength: 20 });

/** One folded day of the comparison, reduced to what the property reads. */
interface Step {
  readonly tradingDay: TradingDay;
  readonly carriedFloorOpenCents: Cents;
  readonly shippedFloorOpenCents: Cents;
  readonly carriedFloorCents: Cents;
  readonly shippedFloorCents: Cents;
  readonly carriedBreached: boolean;
  readonly shippedBreached: boolean;
  readonly shippedRelocked: boolean;
  readonly carriedHwbBelowBalance: boolean;
}

/**
 * Fold the SAME marks against both accounts, day by day, until one closes.
 *
 * THE MARKS ARE BUILT FROM THE SHARED BALANCE AND THAT IS WHAT MAKES THE
 * COMPARISON A COMPARISON. Both accounts leave the reset at `size_cents`, and
 * neither the floor nor the lock is an input to `INV-18` or `INV-19`, so the two
 * states carry the identical balance on every day until one of them breaches.
 * The moment a breach closes one account the streams stop being comparable, so
 * the fold ends there and the step that ended it is the one the property reads.
 */
function foldBoth(plan: ResolvedPlan, passed: RuleState, stream: readonly GeneratedDay[]): Step[] {
  const steps: Step[] = [];

  let carried: RuleState = { ...passed, floorLocked: true };
  let shipped: RuleState = passed;

  // The pass landed on the second day of the window, so the funded days start at
  // the third and the stream is truncated to what the slice can carry.
  const fundedDays = LONG_WINDOW.days.filter((d) => d.tradingDay > passed.tradingDay);

  for (const [i, generated] of stream.slice(0, fundedDays.length).entries()) {
    const tradingDay = fundedDays[i]?.tradingDay;
    if (tradingDay === undefined) break;

    const openingBalanceCents = carried.balanceCents;
    const realizedPnlCents = BigInt(generated.pnlCents);
    const closingBalanceCents = openingBalanceCents + realizedPnlCents;
    const least =
      closingBalanceCents < openingBalanceCents ? closingBalanceCents : openingBalanceCents;
    const lowBalanceCents = least - BigInt(generated.excursionCents);

    const fields: Parameters<typeof mark>[0] = {
      tradingDay,
      openingBalanceCents,
      realizedPnlCents,
      lowBalanceCents,
    };
    const one = (prior: RuleState): DayOutput =>
      advanceDay({
        engineVersion: ENGINE_VERSION,
        plan,
        prior,
        mark: mark(fields),
        calendar: LONG_WINDOW,
        settlements: [],
        openedOn: ACCOUNT_OPENED_ON,
      });

    const a = one(carried);
    const b = one(shipped);

    // A refusal is not a result. Both accounts see the same mark, so this can
    // only be a coverage miss or an identity failure, and either means the day
    // was never folded rather than folded to a verdict.
    if (a.assertions.length > 0 || b.assertions.length > 0) break;

    steps.push({
      tradingDay,
      carriedFloorOpenCents: a.state.floorOpenCents,
      shippedFloorOpenCents: b.state.floorOpenCents,
      carriedFloorCents: a.state.floorCents,
      shippedFloorCents: b.state.floorCents,
      carriedBreached: a.state.breached,
      shippedBreached: b.state.breached,
      shippedRelocked: b.events.some((e) => e.type === 'rule.floor_locked'),
      carriedHwbBelowBalance: a.state.highWaterBalanceCents < a.state.balanceCents,
    });

    if (a.state.phase !== 'funded' || b.state.phase !== 'funded') break;
    carried = a.state;
    shipped = b.state;
  }

  return steps;
}

const show = (step: Step): string =>
  JSON.stringify(step, (_k, v: unknown) => (typeof v === 'bigint' ? `${String(v)}n` : v));

describe("ADR-056's claim, swept", () => {
  test.each(LINEUP.map(([name, plan, passed]) => [name, plan, passed] as const))(
    'the carried lock breaches on NO day the shipped fold survives, %s',
    (name: string, plan: ResolvedPlan, passed: () => RuleState) => {
      const from = passed();

      fc.assert(
        fc.property(generatedStream, (stream) => {
          for (const step of foldBoth(plan, from, stream)) {
            // THE CLAIM UNDER TEST. ADR-056 says the carried lock breaches every
            // funded account on its second funded day, so it says this
            // conjunction is not merely possible but universal.
            expect(
              step.carriedBreached && !step.shippedBreached,
              `${name}: the carried lock breached a day the shipped fold survived: ${show(step)}`,
            ).toBe(false);

            // AND THE REASON, ASSERTED SO THE RESULT IS NOT A COINCIDENCE OF THE
            // GENERATOR. The carried floor is frozen at the reset value and the
            // shipped floor never falls below it, so `R-18`'s comparator is at
            // or below the shipped one on every day.
            expect(
              step.carriedFloorOpenCents <= step.shippedFloorOpenCents,
              `${name}: the carried floor at the open rose above the shipped one: ${show(step)}`,
            ).toBe(true);
          }
        }),
        { numRuns: RUNS },
      );
    },
  );

  test.each(LINEUP.map(([name, plan, passed]) => [name, plan, passed] as const))(
    'the carried floor is CONSTANT at the funded reset value and never the locked floor, %s',
    (name: string, plan: ResolvedPlan, passed: () => RuleState) => {
      const from = passed();
      const reset = fundedResetFloorCents(plan);
      const locked = lockedFloorCents(plan);

      fc.assert(
        fc.property(generatedStream, (stream) => {
          for (const step of foldBoth(plan, from, stream)) {
            // `R-13` and `R-15` are both guarded by `!floorLocked`, so nothing in
            // `DO-7` can move this number for the life of the account.
            expect(
              step.carriedFloorCents,
              `${name}: the carried floor moved off the funded reset value: ${show(step)}`,
            ).toBe(reset);

            // THE NUMBER ADR-056 PREDICTS, ASSERTED ABSENT. Its table has the
            // floor at `floor_lock_floor_at_cents` on every funded day.
            expect(
              step.carriedFloorCents,
              `${name}: the carried floor reached the locked floor: ${show(step)}`,
            ).not.toBe(locked);
          }
        }),
        { numRuns: RUNS },
      );
    },
  );
});

// -----------------------------------------------------------------------------
// The support, measured rather than assumed
// -----------------------------------------------------------------------------
// EVERY ASSERTION ABOVE IS A LOOP OVER FOLDED DAYS, so a sweep whose folds all
// ended on day one satisfies all of them vacuously, and a sweep where the
// shipped account never breached would make "breaches on no day the shipped fold
// survives" true for the uninteresting reason. Both are measured below.

describe('the sweep reaches the cases the property is about', () => {
  interface Seen {
    steps: number;
    shippedBreaches: number;
    carriedBreaches: number;
    floorsDiverged: number;
    shippedRelocks: number;
    carriedHwbBelowBalance: number;
  }

  const seen: Seen = {
    steps: 0,
    shippedBreaches: 0,
    carriedBreaches: 0,
    floorsDiverged: 0,
    shippedRelocks: 0,
    carriedHwbBelowBalance: 0,
  };

  beforeAll(() => {
    for (const [, plan, passed] of LINEUP) {
      const from = passed();
      fc.assert(
        fc.property(generatedStream, (stream) => {
          for (const step of foldBoth(plan, from, stream)) {
            seen.steps++;
            if (step.shippedBreached) seen.shippedBreaches++;
            if (step.carriedBreached) seen.carriedBreaches++;
            if (step.carriedFloorOpenCents < step.shippedFloorOpenCents) seen.floorsDiverged++;
            if (step.shippedRelocked) seen.shippedRelocks++;
            if (step.carriedHwbBelowBalance) seen.carriedHwbBelowBalance++;
          }
        }),
        { numRuns: REACHABILITY },
      );
    }
  });

  test('the fold reaches funded days at all', () => {
    expect(seen.steps).toBeGreaterThan(0);
  });

  test('the shipped account is watched BREACHING, so the comparison is not vacuous', () => {
    // Without this the property reads "the carried lock breached no day the
    // shipped fold survived" over a sweep where the shipped fold survived
    // everything, which is a sentence about the generator.
    expect(seen.shippedBreaches).toBeGreaterThan(0);
  });

  test('the carried account is watched BREACHING too, on days the shipped one also breached', () => {
    // The carried lock is not immune. It breaches whenever the day's low goes
    // below the funded reset floor, which is the funded contract the trader was
    // sold, and the property above is that it never breaches ALONE.
    expect(seen.carriedBreaches).toBeGreaterThan(0);
  });

  test('the two floors are watched DIVERGING, which is what makes the carried lock a defect', () => {
    // A sweep where the shipped floor never trailed above the reset value would
    // make `carried <= shipped` hold by equality everywhere and would measure
    // nothing about the freeze.
    expect(seen.floorsDiverged).toBeGreaterThan(0);
  });

  test('the shipped funded lock is watched RE-ENGAGING, which the carried lock never can', () => {
    // ADR-056's surviving argument, measured: "a funded lock that can never
    // re-engage because its trigger is a profit condition and R-31 set profit to
    // zero". The shipped account re-locks on these streams; the carried one
    // emits no `rule.floor_locked` on any day, because `R-15` is guarded by
    // `!floorLocked` and the flag never went false.
    expect(seen.shippedRelocks).toBeGreaterThan(0);
  });

  test("the carried account's high-water balance is watched BELOW its own balance", () => {
    // `R-13`'s guard freezes `hwb` at `size_cents`, so every profitable funded
    // day leaves it behind. `0037` replaced `0015`'s unconditional bound with
    // `floor_locked OR high_water_balance_cents >= balance_cents`, so these rows
    // are EXEMPT and the database stores them without complaint. Nothing in the
    // fold and nothing in the schema announces the carried lock.
    expect(seen.carriedHwbBelowBalance).toBeGreaterThan(0);
  });
});
