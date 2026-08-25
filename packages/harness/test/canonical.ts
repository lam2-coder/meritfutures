// =============================================================================
// packages/harness/test/canonical.ts
// =============================================================================
// THE CANONICAL RUN: one synthetic plan, one seeded population, a window long
// enough for an account to pass, get paid more than once, and finish its ladder.
// Every test in this package that needs a run uses this one, so a change to the
// model shows up in one diff rather than in six.
//
// -----------------------------------------------------------------------------
// EVERY NUMBER HERE IS SYNTHETIC AND NONE OF IT IS A CLAIM
// -----------------------------------------------------------------------------
// **`SIM_PLAN` IS NOT A MERIT PLAN AND MUST NEVER BE MISTAKEN FOR ONE.** Plan
// parameters are launch candidates that live as rows in `plan_version_sizes`,
// never as constants (STATE's standing parameter ruling, `INV-M21-10`), and
// `packages/rules-engine/fixtures/plans/CORE-50K.json` is the transcription of
// the real lineup. The plan below is deliberately unlike it in every dimension:
// a $10,000 size, a 2 percent target, a two-day win requirement and a ladder of
// three. Those are chosen so a lifecycle COMPLETES inside a short window, which
// is what makes the tests exercise settlement and graduation at all, and so that
// nobody reading this file can mistake it for plan configuration.
//
// **The session window is not a CME session and the calendar is not the real
// one.** There is not one calendar row in this repository (P2 section 6), so the
// window is a plain 13:30Z-to-20:00Z block over consecutive weekdays.
// `DEP-M21-08` is that the calendar is the real one WHEN THE HARNESS RUNS, and
// this is a test fixture: `packages/rithmic/test/canonical.ts` makes the same
// disclaimer for the same reason.
//
// **The symbols are not CME contracts** and their tick values are round numbers
// rather than a transcription. `FM-M2-14`: the normalizer never assumes a
// multiplier and neither does this.
//
// **The calibration source is not the calibration of record.** Its bands are
// wide enough that a fixture population lands inside them, which is exactly what
// SIMULATION_HARNESS section 5 forbids a real band from being. It exists to
// exercise `checkBands`, and `CALIBRATION_OF_RECORD_NOTE` below says where the
// real one lives.
// =============================================================================

import type { BasisPoints, ExternalGates, PlanVersionId, ResolvedPlan } from '@merit/rules-engine';
import type { ContractSpec, PopulationSpec, SimSession } from '@merit/rithmic';
import { civilFromDays, parseTradingDay } from '@merit/rithmic';
import type { CalibrationSource } from '../src/provenance.ts';
import type { CommercialInputs, TrialBehaviour } from '../src/types.ts';

/** The one cast that makes a basis point a `BasisPoints`, as the engine's suites spell it. */
const bp = (n: number): BasisPoints => n as BasisPoints;

export const CANONICAL_SEED = 'merit-harness-canonical-001';

/**
 * The engine version this fixture folds under.
 *
 * A CONSTANT AND NOT A PACKAGE VERSION, for `scripts/demo/fold.ts`'s reason:
 * replay scopes divergence detection to rows computed under the running version
 * (M01 Appendix B.4), and a fixture that read one from a manifest would be
 * claiming to be a build.
 */
export const CANONICAL_ENGINE_VERSION = 'harness-fixture-not-a-build';

/**
 * A SYNTHETIC PLAN. See the header: this is not Merit's lineup and is shaped so
 * a full lifecycle fits in a thirty-session window.
 *
 * The one thing it is faithful about is SHAPE. Every field the engine reads is
 * present, the floor lock is enabled with `CV-12`'s inequality holding, the
 * ladder is finite, and the cap schedule starts at ordinal 1 as `CV-09`
 * requires, so `resolvePlan`'s output would have this form.
 */
export const SIM_PLAN: ResolvedPlan = Object.freeze({
  planVersionId: '0199c7a1-0000-7000-8000-0000000000ff' as PlanVersionId,
  sizeCents: 1_000_000n,
  eval: Object.freeze({
    drawdown: Object.freeze({
      type: 'trailing_eod' as const,
      drawdownCents: 60_000n,
      lock: Object.freeze({ enabled: false as const }),
    }),
    dailyLossLimit: Object.freeze({ type: 'none' as const }),
    winDayFloorCents: 1_000n,
    profitTargetCents: 20_000n,
    minTradingDays: 1,
    consistency: Object.freeze({ enabled: false as const }),
    maxDays: null,
  }),
  funded: Object.freeze({
    drawdown: Object.freeze({
      type: 'trailing_eod' as const,
      drawdownCents: 60_000n,
      lock: Object.freeze({ enabled: false as const }),
    }),
    dailyLossLimit: Object.freeze({ type: 'none' as const }),
    winDayFloorCents: 1_000n,
    minTradingDays: 0,
    winDaysRequiredCount: 2,
    consistency: Object.freeze({ enabled: false as const }),
    bufferCents: 5_000n,
    cadenceGapTradingDays: 2,
    payoutCapSchedule: Object.freeze([Object.freeze({ fromOrdinal: 1, capCents: 20_000n })]),
    minPayoutCents: 1_000n,
    splitBp: bp(9_000),
    maxPayouts: 3,
  }),
});

/** The same plan with no evaluation phase, which is Direct's shape (Appendix A.3). */
export const SIM_PLAN_NO_EVAL: ResolvedPlan = Object.freeze({
  ...SIM_PLAN,
  eval: null,
});

export const CANONICAL_SPECS: readonly ContractSpec[] = Object.freeze([
  Object.freeze({
    symbol: 'SIM1',
    exchangeMic: 'XSIM',
    priceDecimals: 2,
    referencePriceNumerator: 500_000, // 5000.00
    tickNumerator: 25, // 0.25
    tickValueCents: 1_000n, // $10.00 per tick per contract
  }),
]);

/**
 * A population with a POSITIVE drift, which is not the real world and is the
 * point.
 *
 * `PP-02` is explicit that the literature's finding is a NEGATIVE experience
 * coefficient and that roughly 93 percent of the funded book has zero or
 * negative true edge. A fixture drawn that way produces almost no payouts, so
 * the tests that matter here (settlement, the ladder, the cycle arithmetic)
 * would never run. This population is drawn to REACH those paths, not to model
 * a book, and a run that used it for a projection would be reporting a fiction.
 */
export const CANONICAL_POPULATION_SPEC: PopulationSpec = Object.freeze({
  seed: CANONICAL_SEED,
  accountCount: 12,
  sizes: Object.freeze([Object.freeze({ label: 'SIM-10K', sizeCents: 1_000_000n, weight: 1 })]),
  symbols: CANONICAL_SPECS,
  accountRefPrefix: 'HARNACC',
  userRefPrefix: 'HARNUSR',
  firstRefOrdinal: 1,
  // The setpoint offset at OPEN. From the first fold onward the trial loop
  // pushes the engine's own floor, which is M02 section 1.2's transport.
  riskMaxLossOffsetCents: 60_000n,
  // One in six accounts has no readable setpoint: `V-M2-08`'s unprotected case,
  // which the trial loop must leave unprotected rather than push a floor onto.
  unprotectedShareBasisPoints: 1_600,
  behaviour: Object.freeze({
    tradeRateBasisPoints: { min: 8_000, max: 10_000 },
    tradesPerDayMax: { min: 2, max: 4 },
    quantityMax: { min: 1, max: 2 },
    driftTicks: { min: 0, max: 2 },
    volatilityTicks: { min: 2, max: 5 },
    liquidationSlippageTicks: { min: 0, max: 2 },
  }),
});

/** Consecutive weekdays. Integer arithmetic on the day number, never a `Date`. */
export function simSessions(startDay: string, count: number): readonly SimSession[] {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new RangeError(`a run needs at least one session, not ${String(count)}`);
  }
  const pad = (value: number, width: number): string => String(value).padStart(width, '0');
  const built: SimSession[] = [];
  let epochDay = parseTradingDay(startDay);
  while (built.length < count) {
    // 1970-01-01 was a Thursday, so `(epochDay + 4) % 7` is 0 for Sunday and 6
    // for Saturday.
    const dayOfWeek = (((epochDay + 4) % 7) + 7) % 7;
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      const civil = civilFromDays(epochDay);
      const tradingDay = `${pad(civil.year, 4)}-${pad(civil.month, 2)}-${pad(civil.day, 2)}`;
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

/** Thirty sessions, which is long enough for a three-rung ladder to finish. */
export const CANONICAL_SESSIONS: readonly SimSession[] = simSessions('2026-11-02', 30);

export const CANONICAL_SEQUENCE_BASE = 1_000;

/**
 * `PP-09`'s funding baseline: ask immediately, which is the pessimistic
 * cash-flow case (SIMULATION_HARNESS section 2.3) and therefore the default the
 * wallet is funded against.
 */
export const CANONICAL_BEHAVIOUR: TrialBehaviour = Object.freeze({
  requestPolicy: Object.freeze({ kind: 'immediate' as const }),
  settlementLagTradingDays: 1,
  riskUpShareBp: 3_000,
  riskUpQuantityBp: 15_000,
});

/** A clean context on every row, so the only thing moving is the ENGINE half. */
export const CANONICAL_CONTEXT: ExternalGates = Object.freeze({
  accountStatus: 'active' as const,
  kycState: 'verified' as const,
  payoutsFrozen: false,
  reconBlocked: false,
  hasPayoutInFlight: false,
});

/** Commercial terms for the synthetic plan. Not Merit's prices. */
export const CANONICAL_COMMERCIAL: CommercialInputs = Object.freeze({
  pricePerPurchaseCents: 20_000n,
  discountBp: 2_000,
  purchasesPerBuyer: Object.freeze({ numerator: 3n, denominator: 1n }),
  variableCostPerFundedAccountCents: 3_000n,
});

/**
 * WHERE THE REAL CALIBRATION LIVES, stated here because this file's is not it.
 *
 * `research/calibration/mc_lifecycle.py` as re-run at the FREEZE gate is the
 * source of record (SIMULATION_HARNESS section 9), and section 9.4 records that
 * the committed engine is STALE IN FOUR PLACES: the plan name, Merit Rapid's win
 * days, the funded minimum days on two plans, and the ladder counts. A caller
 * building a real `CalibrationSource` transcribes section 9.2's table and dates
 * it `2026-08-14`, and `AS-M21-01` is why the date has to travel with it.
 */
export const CALIBRATION_OF_RECORD_NOTE =
  'research/calibration/mc_lifecycle.py, re-run at the FREEZE gate. See SIMULATION_HARNESS ' +
  'sections 9.2 and 9.4';

/**
 * A calibration source for the FIXTURE, with bands wide enough to hold it.
 *
 * A REAL BAND IS NARROW AND IS A FOUNDER DECISION. These are neither: they exist
 * so `checkBands` has something to evaluate, and the run they are checked
 * against is a synthetic population on a synthetic plan.
 */
export const CANONICAL_CALIBRATION: CalibrationSource = Object.freeze({
  id: 'harness-fixture-calibration-001',
  observedAt: '2026-08-20',
  note: `NOT the calibration of record, which is: ${CALIBRATION_OF_RECORD_NOTE}`,
  bands: Object.freeze([
    Object.freeze({
      id: 'RE-S-01',
      label: 'Evaluation pass rate',
      unit: 'basis_points' as const,
      minimum: 0n,
      maximum: 10_000n,
      central: null,
      source: 'fixture band, deliberately unbounded within its unit',
    }),
    Object.freeze({
      id: 'RE-S-03',
      label: 'Payouts per paying account',
      unit: 'count_per_10000' as const,
      minimum: 10_000n,
      maximum: 30_000n,
      central: 20_000n,
      source: 'fixture band around one to three payouts per payer',
    }),
    Object.freeze({
      id: 'RE-S-07',
      label: 'Mean monthly payout at baseline scale',
      unit: 'cents' as const,
      minimum: 0n,
      maximum: null,
      central: null,
      // THE POINT OF THIS ROW. It has no output in this package, so it comes
      // back `not_measured` on every run and the report says so instead of
      // reporting four of four green.
      source: 'the portfolio risk engine, which this package does not build',
    }),
  ]),
});
