// =============================================================================
// packages/rithmic/test/canonical.ts
// =============================================================================
// THE CANONICAL RUN: one seeded population, three sessions, one non-trading
// movement. Every test in this package that needs a run uses this one, so a
// change to the model shows up in one diff rather than in six.
//
// -----------------------------------------------------------------------------
// EVERY NUMBER HERE IS SYNTHETIC AND NONE OF IT IS A CLAIM
// -----------------------------------------------------------------------------
// **The session window is not a CME session.** There is not one calendar row in
// this repository, the CME publication has not been transcribed, and writing
// session boundaries from recollection is the transcription TR-01 forbids. The
// window below is a plain 13:30Z-to-20:00Z block chosen so it CANNOT be
// mistaken for a real one. The trading days are borrowed from
// `packages/rules-engine/fixtures/calendars/cme-2026.json`, which is itself
// `status: partial` and says so.
//
// **The account sizes are not Merit plan sizes.** Plan parameters are launch
// candidates and live as rows in `plan_version_sizes`, never as constants
// (STATE's standing parameter ruling). $10,000 and $25,000 are picked to be
// obviously not the lineup so that no reader and no later session can mistake
// this file for a source of plan configuration.
//
// **The symbols are not CME contracts.** `SIM1` and `SIM2` carry tick values
// that are round numbers rather than a transcription of a real contract spec.
// FM-M2-14 says the normalizer never assumes a multiplier; neither does this.
// =============================================================================

import type {
  BalanceAdjustment,
  ContractSpec,
  PopulationSpec,
  SimSession,
  SimulationInput,
} from '../src/simulator/types.js';
import { buildPopulation } from '../src/simulator/population.js';

export const CANONICAL_SEED = 'merit-sim-canonical-001';

/** Two accounts per user, so `V-M2-09`'s per-user billing has something to attribute. */
export const CANONICAL_ACCOUNTS_PER_USER = 2;

export const CANONICAL_SPECS: readonly ContractSpec[] = Object.freeze([
  {
    symbol: 'SIM1',
    exchangeMic: 'XSIM',
    priceDecimals: 2,
    referencePriceNumerator: 500_000, // 5000.00
    tickNumerator: 25, // 0.25
    tickValueCents: 1_250n, // $12.50 per tick per contract
  },
  {
    symbol: 'SIM2',
    exchangeMic: 'XSIM',
    priceDecimals: 2,
    referencePriceNumerator: 2_000_000, // 20000.00
    tickNumerator: 50, // 0.50
    tickValueCents: 1_000n, // $10.00 per tick per contract
  },
]);

export const CANONICAL_POPULATION_SPEC: PopulationSpec = Object.freeze({
  seed: CANONICAL_SEED,
  // EIGHT, AND THE NUMBER IS A CONSEQUENCE RATHER THAN A PREFERENCE. A
  // canonical fixture has to CONTAIN the shapes it claims to demonstrate, and
  // at a one-in-five unprotected share a population of six draws none: the
  // `V-M2-08` case the file is partly for would be absent and the test
  // asserting it would be asserting nothing.
  accountCount: 8,
  sizes: Object.freeze([
    { label: 'SIM-SMALL', sizeCents: 1_000_000n, weight: 1 },
    { label: 'SIM-LARGE', sizeCents: 2_500_000n, weight: 1 },
  ]),
  symbols: CANONICAL_SPECS,
  accountRefPrefix: 'SIMACC',
  userRefPrefix: 'SIMUSR',
  firstRefOrdinal: 1,
  riskMaxLossOffsetCents: 200_000n,
  // One in five accounts has no readable setpoint, which is `V-M2-08`'s
  // unprotected case and the population half of GS-087.
  unprotectedShareBasisPoints: 2_000,
  behaviour: {
    tradeRateBasisPoints: { min: 6_000, max: 9_500 },
    tradesPerDayMax: { min: 1, max: 4 },
    quantityMax: { min: 1, max: 3 },
    driftTicks: { min: -2, max: 1 },
    volatilityTicks: { min: 3, max: 10 },
    liquidationSlippageTicks: { min: 0, max: 2 },
  },
});

/** Three sessions. The instants are this file's fiction and are stated as such above. */
export const CANONICAL_SESSIONS: readonly SimSession[] = Object.freeze([
  {
    tradingDay: '2026-11-02',
    sessionOpenUtc: '2026-11-02T13:30:00Z',
    sessionCloseUtc: '2026-11-02T20:00:00Z',
  },
  {
    tradingDay: '2026-11-03',
    sessionOpenUtc: '2026-11-03T13:30:00Z',
    sessionCloseUtc: '2026-11-03T20:00:00Z',
  },
  {
    tradingDay: '2026-11-04',
    sessionOpenUtc: '2026-11-04T13:30:00Z',
    sessionCloseUtc: '2026-11-04T20:00:00Z',
  },
]);

/**
 * One settled withdrawal, supplied rather than drawn.
 *
 * INV-M2-12: the normalizer classifies every balance delta as trading or
 * non-trading and refuses to guess, and the movement it can classify is one M5
 * already published a `payout.settled` for (DEP-M2-02). A simulator that
 * invented its own would be feeding the pipeline the quarantine case as if it
 * were the normal one.
 */
export const CANONICAL_ADJUSTMENTS: readonly BalanceAdjustment[] = Object.freeze([
  {
    platformAccountRef: 'SIMACC000002',
    tradingDay: '2026-11-03',
    cents: -150_000n,
    vendorDescription: 'CASH WITHDRAWAL',
  },
]);

/** The canonical input, assembled. */
export function canonicalInput(): SimulationInput {
  return {
    seed: CANONICAL_SEED,
    population: buildPopulation(CANONICAL_POPULATION_SPEC, CANONICAL_ACCOUNTS_PER_USER),
    sessions: CANONICAL_SESSIONS,
    specs: CANONICAL_SPECS,
    adjustments: CANONICAL_ADJUSTMENTS,
  };
}
