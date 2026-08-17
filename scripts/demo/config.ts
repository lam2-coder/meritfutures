// =============================================================================
// scripts/demo/config.ts
// =============================================================================
// EVERYTHING THE DEMO HANDS IN. The plan, the contract specs, the two
// behavioural cohorts, and the session window.
//
// The split this file exists to respect is the one both packages state about
// themselves. The engine is handed a `ResolvedPlan` and never resolves one; the
// simulator is handed sizes, a risk setpoint offset, symbols and sessions and
// never derives any of them (`packages/rithmic/src/simulator/types.ts`). So
// every number a run needs is written here, once, beside where it came from,
// and neither package is asked to supply one.
//
// -----------------------------------------------------------------------------
// WHAT IS A TRANSCRIPTION AND WHAT IS THIS DEMO'S FICTION
// -----------------------------------------------------------------------------
// **The plan is a transcription.** `CORE_EOD_50K` is M01 Appendix A.1's 50K
// column and nothing else. It is not a place to tune a parameter: STATE's
// standing ruling makes these launch candidates that live as rows in
// `plan_version_sizes`, and a demo that quietly used a different buffer would
// be printing a rule Merit does not have.
//
// **Everything else here is this file's fiction and says so.** The symbols are
// not CME contracts, the session window is not a CME session, and the weekday
// sequence `sessions()` produces is not the exchange calendar: there is not one
// calendar row in this repository and the CME publication has not been
// transcribed (P2 section 6), so writing one from recollection is the thing
// TR-01 forbids. `packages/rithmic/test/canonical.ts` makes the same three
// disclaimers for the same reasons and this file follows it.
// =============================================================================

import type {
  BasisPoints,
  PlanVersionId,
  ResolvedPlan,
} from '../../packages/rules-engine/src/index.js';
import type {
  ContractSpec,
  PopulationBehaviour,
  PopulationSpec,
  SimSession,
} from '../../packages/rithmic/src/index.js';
import { civilFromDays, parseTradingDay } from '../../packages/rithmic/src/index.js';

/** The one cast that makes a basis point a `BasisPoints`, as the engine's suites spell it. */
const bp = (n: number): BasisPoints => n as BasisPoints;

/**
 * CORE EOD AT 50K, from M01 Appendix A.1's 50K column and from nowhere else.
 *
 *   size                       5,000,000c   Appendix A, sizes line
 *   eval drawdown, trailing      250,000c   500bp
 *   eval profit target           300,000c   600bp
 *   eval minimum trading days           1
 *   eval consistency             disabled
 *   funded drawdown, trailing    250,000c   500bp
 *   floor lock at profit         260,000c   drawdown + 10,000 by CV-12
 *   locked floor               5,010,000c   size + 10,000, X = $100 (ADR-014)
 *   win days required                   5
 *   win day floor                 15,000c   30bp, $150.00 at 50K
 *   buffer                       100,000c   200bp, $1,000.00 at 50K
 *   funded consistency             3000bp
 *   funded minimum trading days         0   ADR-015, the gate is disabled
 *   cadence gap, trading days           5
 *   payout cap                   150,000c   300bp, $1,500.00 at 50K
 *   split to trader                9000bp
 *   ladder                              5   ADR-024
 *   minimum payout                10,000c   CV-15, never scaled by size
 *   daily loss limit                 none
 *
 * `planVersionId` is the one `packages/rules-engine/fixtures/plans/CORE-50K.json`
 * carries, so a reader comparing this demo against a golden fixture is comparing
 * the same plan rather than two plans that happen to share a name.
 *
 * `resolvePlan` and `validatePlan` are P2-1 and are not exported yet, so this is
 * a `ResolvedPlan` written out rather than one resolved from a config record.
 * When they land, this constant becomes their input and every CV check runs over
 * it; until then nothing here is validated and the transcription is the control.
 */
export const CORE_EOD_50K: ResolvedPlan = {
  planVersionId: '0199c7a1-0000-7000-8000-000000000001' as PlanVersionId,
  sizeCents: 5_000_000n,
  eval: {
    drawdown: {
      type: 'trailing_eod',
      drawdownCents: 250_000n,
      lock: { enabled: true, atProfitCents: 260_000n, floorAtCents: 5_010_000n },
    },
    dailyLossLimit: { type: 'none' },
    winDayFloorCents: 15_000n,
    profitTargetCents: 300_000n,
    minTradingDays: 1,
    consistency: { enabled: false },
    maxDays: null,
  },
  funded: {
    drawdown: {
      type: 'trailing_eod',
      drawdownCents: 250_000n,
      lock: { enabled: true, atProfitCents: 260_000n, floorAtCents: 5_010_000n },
    },
    dailyLossLimit: { type: 'none' },
    winDayFloorCents: 15_000n,
    minTradingDays: 0,
    winDaysRequiredCount: 5,
    consistency: { enabled: true, maxDayShareBp: bp(3000) },
    bufferCents: 100_000n,
    cadenceGapTradingDays: 5,
    payoutCapSchedule: [{ fromOrdinal: 1, capCents: 150_000n }],
    minPayoutCents: 10_000n,
    splitBp: bp(9000),
    maxPayouts: 5,
  },
};

/**
 * TWO SYNTHETIC SYMBOLS, NEITHER OF WHICH IS A CME CONTRACT.
 *
 * FM-M2-14: the normalizer refuses a fill whose symbol has no `contract_specs`
 * row and never assumes a multiplier, so the simulator is handed the tick value
 * rather than carrying one. The numbers below are round on purpose, so that no
 * reader and no later session can mistake this file for a source of contract
 * specifications.
 *
 * The tick values are what make the win-day floor reachable at all: 15,000c is
 * twelve ticks of `DEMO1` on one contract, so a day's outcome and a gate's
 * threshold are the same order of magnitude and the table has something to show.
 */
export const DEMO_SPECS: readonly ContractSpec[] = Object.freeze([
  {
    symbol: 'DEMO1',
    exchangeMic: 'XDEM',
    priceDecimals: 2,
    referencePriceNumerator: 500_000, // 5000.00
    tickNumerator: 25, // 0.25
    tickValueCents: 1_250n, // $12.50 per tick per contract
  },
  {
    symbol: 'DEMO2',
    exchangeMic: 'XDEM',
    priceDecimals: 2,
    referencePriceNumerator: 2_000_000, // 20000.00
    tickNumerator: 50, // 0.50
    tickValueCents: 1_000n, // $10.00 per tick per contract
  },
]);

/**
 * A behavioural cohort: a name, a reason it exists, and the draws it draws from.
 *
 * TWO COHORTS RATHER THAN ONE POPULATION, because a demo that prints only a
 * happy path demonstrates nothing and a single behaviour band produces one
 * story. Which of the two shapes a run wants is a scenario's decision and the
 * simulator says so in as many words: a population whose slippage range is
 * `0..0` "produces liquidations that never breach, and one with a wide range
 * produces the breach path" (`PopulationBehaviour.liquidationSlippageTicks`).
 */
export interface Cohort {
  readonly label: string;
  /** Why this cohort is in the run, printed above the table. */
  readonly intent: string;
  readonly accountRefPrefix: string;
  readonly userRefPrefix: string;
  /**
   * `V-M2-10`. A platform ref is permanently burned (SD-M2-02, INV-M2-10), so
   * the two cohorts start at ordinals far enough apart that no run can issue one
   * ref twice however many accounts each is given.
   */
  readonly firstRefOrdinal: number;
  readonly behaviour: PopulationBehaviour;
}

/** Small, patient, positive drift. This is the cohort that reaches a payout. */
const STEADY: Cohort = {
  label: 'steady',
  intent: 'small size, positive drift, no slippage. Expected to fund and become eligible',
  accountRefPrefix: 'DEMOSTDY',
  userRefPrefix: 'DEMOUSR',
  firstRefOrdinal: 1,
  behaviour: {
    // Trades every session. A cohort that skips days is a cohort whose win-day
    // count advances slowly for a reason that is not about the rules.
    tradeRateBasisPoints: { min: 10_000, max: 10_000 },
    tradesPerDayMax: { min: 2, max: 3 },
    quantityMax: { min: 2, max: 3 },
    driftTicks: { min: 2, max: 4 },
    volatilityTicks: { min: 2, max: 4 },
    liquidationSlippageTicks: { min: 0, max: 0 },
  },
};

/** Size and negative drift, and slippage past the setpoint. This is the breach path. */
const RISK_SEEKING: Cohort = {
  label: 'risk-seeking',
  intent: 'large size, negative drift, slippage past the setpoint. Expected to breach',
  accountRefPrefix: 'DEMORISK',
  userRefPrefix: 'DEMOUSR',
  firstRefOrdinal: 500_001,
  behaviour: {
    tradeRateBasisPoints: { min: 10_000, max: 10_000 },
    tradesPerDayMax: { min: 3, max: 5 },
    quantityMax: { min: 10, max: 16 },
    driftTicks: { min: -4, max: -2 },
    volatilityTicks: { min: 8, max: 14 },
    // STATE_MACHINES G-BREACH: a clean liquidation lands exactly on the floor
    // and SURVIVES; slippage below it breaches. A positive range here is what
    // asks the simulator for the second of those.
    liquidationSlippageTicks: { min: 2, max: 8 },
  },
};

export const COHORTS: readonly Cohort[] = Object.freeze([STEADY, RISK_SEEKING]);

/**
 * The population spec for one cohort, at one seed, for one account count.
 *
 * ONE SIZE BAND, AND IT MATCHES THE PLAN. The engine folds a mark against
 * `plan.sizeCents`, so an account drawn at a size the plan does not describe
 * fails INV-20 on its first funded mark and every row after it says
 * `funded_start_not_size`. A demo run against one plan therefore draws from one
 * band, and adding a second plan means adding a second run rather than a second
 * band.
 *
 * `riskMaxLossOffsetCents` IS THE FUNDED DRAWDOWN AND THAT IS THE PUSH. M02
 * section 1.2: "M2 PUSHES a floor value to the vendor as a risk setting. It is
 * TOLD the number; it never derives it." At account open the floor is
 * `size - drawdown` (R-12), so the setpoint the platform enforces is the floor
 * Merit computed, and this offset is the arithmetic of handing it over.
 *
 * IT IS PUSHED ONCE AND NEVER RE-PUSHED, WHICH IS VISIBLE IN THE OUTPUT. Merit's
 * floor trails up with the high-water balance (R-13) and the setpoint here does
 * not move, so an account can breach the trailing floor on a day the platform
 * had no reason to liquidate. The demo prints whether a breach carried a vendor
 * liquidation record, because that gap is a question for M02 rather than a
 * defect in either package.
 */
export function populationSpec(cohort: Cohort, seed: string, accountCount: number): PopulationSpec {
  return {
    // The cohort label is in the seed so the two cohorts draw independently.
    // Without it, account 0 of each cohort would share every behavioural draw
    // and the two would differ only by the ranges they were clamped into.
    seed: `${seed}:${cohort.label}`,
    accountCount,
    sizes: [{ label: 'CORE-50K', sizeCents: CORE_EOD_50K.sizeCents, weight: 1 }],
    symbols: DEMO_SPECS,
    accountRefPrefix: cohort.accountRefPrefix,
    userRefPrefix: cohort.userRefPrefix,
    firstRefOrdinal: cohort.firstRefOrdinal,
    riskMaxLossOffsetCents: CORE_EOD_50K.funded.drawdown.drawdownCents,
    // `V-M2-08`'s unprotected share, set to zero. AS-M2-03's residual is real and
    // the knob is here for a run that wants it; a demo whose subject is the rule
    // engine wants every account's setpoint readable so that a breach with no
    // liquidation record means what the paragraph above says it means, rather
    // than meaning the account never had a setpoint.
    unprotectedShareBasisPoints: 0,
    behaviour: cohort.behaviour,
  };
}

/**
 * `count` consecutive WEEKDAYS from `startDay`, with a plain session window.
 *
 * THIS IS NOT THE CME CALENDAR AND MUST NEVER BE READ AS ONE. It skips Saturday
 * and Sunday and knows nothing about holidays, early closes or halts, because
 * the transcription is blocked on the founder (P2 section 6) and inventing one
 * here is exactly the recollection TR-01 forbids. What the demo needs from a
 * calendar is a set of distinct, ordered, dense-sequenced days, which this
 * supplies without claiming to be anything else.
 *
 * The window is a 13:30Z-to-20:00Z block, chosen the way `canonical.ts` chose
 * its own: plainly, so it cannot be mistaken for a real session.
 */
export function sessions(startDay: string, count: number): readonly SimSession[] {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new RangeError(`a run needs at least one session, not ${String(count)}`);
  }

  const built: SimSession[] = [];
  let epochDay = parseTradingDay(startDay);

  while (built.length < count) {
    // 1970-01-01 was a Thursday, so `(epochDay + 4) % 7` is 0 for Sunday and 6
    // for Saturday. Integer arithmetic on the day number, never a `Date`.
    const dayOfWeek = (((epochDay + 4) % 7) + 7) % 7;
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      const tradingDay = isoDay(epochDay);
      built.push({
        tradingDay,
        sessionOpenUtc: `${tradingDay}T13:30:00Z`,
        sessionCloseUtc: `${tradingDay}T20:00:00Z`,
      });
    }
    epochDay += 1;
  }

  return Object.freeze(built);
}

/** `yyyy-mm-dd` from a day number, zero padded so lexicographic order is chronological. */
function isoDay(epochDay: number): string {
  const { year, month, day } = civilFromDays(epochDay);
  const pad = (n: number, width: number): string => String(n).padStart(width, '0');
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/**
 * The first trading day of a run, and the sequence the calendar slice starts at.
 *
 * THE SEQUENCE BASE IS NOT ZERO AND THAT IS DELIBERATE, for the reason
 * `fixtures-in-code.ts` gives about its own: `sequence` is "a dense index into
 * the calendar", so it starts somewhere in the middle of the exchange's own
 * numbering. A slice numbered from zero would let a reader confuse a window
 * offset for a calendar index, which is the confusion R-37's gap subtraction
 * cannot survive.
 */
export const DEFAULT_START_DAY = '2026-11-02';
export const SEQUENCE_BASE = 4021;
