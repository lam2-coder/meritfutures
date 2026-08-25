// =============================================================================
// packages/rithmic/src/simulator/population.ts
// =============================================================================
// THE SEEDED ACCOUNT POPULATION.
//
// One rule governs the whole file: EVERY NUMBER IS EITHER DRAWN FROM THE SEED
// OR HANDED IN BY THE CALLER, and none is written here. That is not tidiness.
// STATE's standing parameter ruling makes plan parameters launch candidates
// that live as "rows in `plan_version_sizes`, never constants", and a simulator
// with an account size in it has quietly made one a constant in the one place
// nobody looks for plan configuration.
//
// Account i is a pure function of `(seed, i)`. It does not depend on
// `accountCount`, so a population of six and the first six of a population of
// twenty are the same six accounts, which is what `determinism.test.ts`
// asserts. That property is the reason `rng.ts` keys its draws instead of
// streaming them, and it is what lets a scenario add an account without moving
// every fixture derived against the population.
// =============================================================================

import { drawKey, draws, type Range } from './rng.ts';
import type { PopulationSpec, SimAccount } from './types.ts';

/** Thrown when a spec cannot produce a population. Never silently repaired. */
export class PopulationSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PopulationSpecError';
  }
}

const ASCII_REF = /^[A-Z0-9_-]+$/;

function requireRange(label: string, range: Range): void {
  if (!Number.isSafeInteger(range.min) || !Number.isSafeInteger(range.max)) {
    throw new PopulationSpecError(`${label} range ${range.min}..${range.max} is not integral`);
  }
  if (range.max < range.min) {
    throw new PopulationSpecError(
      `${label} range ${range.min}..${range.max} ends before it starts`,
    );
  }
}

function validate(spec: PopulationSpec): void {
  if (!Number.isSafeInteger(spec.accountCount) || spec.accountCount < 0) {
    throw new PopulationSpecError(`accountCount ${spec.accountCount} is not a count`);
  }
  if (spec.sizes.length === 0) {
    throw new PopulationSpecError('a population needs at least one account-size band');
  }
  for (const band of spec.sizes) {
    if (!Number.isSafeInteger(band.weight) || band.weight <= 0) {
      throw new PopulationSpecError(`size band ${band.label} has a non-positive weight`);
    }
    if (band.sizeCents <= 0n) {
      throw new PopulationSpecError(`size band ${band.label} has a non-positive size`);
    }
  }
  if (spec.symbols.length === 0) {
    throw new PopulationSpecError(
      'a population needs at least one contract spec. FM-M2-14: the normalizer refuses a ' +
        'fill whose symbol has no contract_specs row, so a population that trades an ' +
        'unspecified symbol is a population whose every file quarantines',
    );
  }
  for (const contract of spec.symbols) {
    if (contract.symbol === '' || contract.exchangeMic === '') {
      throw new PopulationSpecError('a contract spec needs a symbol and an exchange MIC');
    }
    // `10 ** priceDecimals` is the price denominator and must stay an exact
    // integer, which it is up to 15 places. Nine is well inside that and well
    // past anything a futures contract quotes.
    if (!Number.isSafeInteger(contract.priceDecimals) || contract.priceDecimals < 0) {
      throw new PopulationSpecError(`${contract.symbol}: priceDecimals is not a count`);
    }
    if (contract.priceDecimals > 9) {
      throw new PopulationSpecError(`${contract.symbol}: priceDecimals above 9 is not supported`);
    }
    if (
      !Number.isSafeInteger(contract.referencePriceNumerator) ||
      contract.referencePriceNumerator <= 0
    ) {
      throw new PopulationSpecError(`${contract.symbol}: referencePriceNumerator must be positive`);
    }
    if (!Number.isSafeInteger(contract.tickNumerator) || contract.tickNumerator <= 0) {
      throw new PopulationSpecError(`${contract.symbol}: tickNumerator must be positive`);
    }
    if (contract.tickValueCents <= 0n) {
      throw new PopulationSpecError(
        `${contract.symbol}: tickValueCents must be positive. A zero tick value is a symbol ` +
          'whose every P&L is zero, which is FM-M2-14 wearing a fixture as a disguise',
      );
    }
  }
  for (const prefix of [spec.accountRefPrefix, spec.userRefPrefix]) {
    if (!ASCII_REF.test(prefix)) {
      throw new PopulationSpecError(
        `ref prefix ${JSON.stringify(prefix)} is not [A-Z0-9_-]+. The refs are draw-key ` +
          'components and a vendor identifier, and both want a narrow alphabet',
      );
    }
  }
  if (!Number.isSafeInteger(spec.firstRefOrdinal) || spec.firstRefOrdinal < 0) {
    throw new PopulationSpecError(`firstRefOrdinal ${spec.firstRefOrdinal} is not an ordinal`);
  }
  if (
    !Number.isSafeInteger(spec.unprotectedShareBasisPoints) ||
    spec.unprotectedShareBasisPoints < 0 ||
    spec.unprotectedShareBasisPoints > 10_000
  ) {
    throw new PopulationSpecError(
      `unprotectedShareBasisPoints ${spec.unprotectedShareBasisPoints} is not in 0..10000`,
    );
  }
  if (spec.riskMaxLossOffsetCents <= 0n) {
    throw new PopulationSpecError('riskMaxLossOffsetCents must be positive');
  }
  requireRange('tradeRateBasisPoints', spec.behaviour.tradeRateBasisPoints);
  requireRange('tradesPerDayMax', spec.behaviour.tradesPerDayMax);
  requireRange('quantityMax', spec.behaviour.quantityMax);
  requireRange('driftTicks', spec.behaviour.driftTicks);
  requireRange('volatilityTicks', spec.behaviour.volatilityTicks);
  requireRange('liquidationSlippageTicks', spec.behaviour.liquidationSlippageTicks);
  if (spec.behaviour.liquidationSlippageTicks.min < 0) {
    throw new PopulationSpecError('liquidationSlippageTicks cannot be negative');
  }
  if (spec.behaviour.tradesPerDayMax.min < 1) {
    throw new PopulationSpecError('tradesPerDayMax must be at least 1');
  }
  if (spec.behaviour.quantityMax.min < 1) {
    throw new PopulationSpecError('quantityMax must be at least 1');
  }
  if (spec.behaviour.volatilityTicks.min < 1) {
    throw new PopulationSpecError('volatilityTicks must be at least 1');
  }
}

const ordinal = (value: number): string => String(value).padStart(6, '0');

/**
 * Build the population.
 *
 * `V-M2-10`. The account ref is allocated from `firstRefOrdinal` and is never
 * reused: SD-M2-02 makes a platform ref permanently burned, INV-M2-10 states
 * it, and AS-M2-05 is the scenario where a recycled ref posts one trader's
 * fills onto another trader's account. A simulator that recycled refs between
 * runs would be teaching the ingest path that recycling is normal, which is the
 * one habit that failure mode needs.
 *
 * `V-M2-09`. Accounts are grouped onto USER refs, several per user where the
 * caller asks for it, because Rithmic bills per login-month per user and per
 * API tier rather than per account (SD-M2-05). A population modelled one user
 * per account makes the monthly invoice reconcile trivially and therefore
 * proves nothing about the reconciliation that has to work.
 */
export function buildPopulation(spec: PopulationSpec, accountsPerUser = 1): readonly SimAccount[] {
  validate(spec);
  if (!Number.isSafeInteger(accountsPerUser) || accountsPerUser < 1) {
    throw new PopulationSpecError(`accountsPerUser ${accountsPerUser} is not a positive count`);
  }

  const totalWeight = spec.sizes.reduce((sum, band) => sum + band.weight, 0);

  const accounts: SimAccount[] = [];
  for (let index = 0; index < spec.accountCount; index += 1) {
    const drawSeq = draws(drawKey('population', spec.seed, String(index)));

    // The size band, by weight. `intBetween` is unbiased, so a 1:1 pair of
    // bands really is a coin flip rather than nearly one.
    let ticket = drawSeq.intBetween(1, totalWeight);
    let band = spec.sizes[0];
    for (const candidate of spec.sizes) {
      ticket -= candidate.weight;
      if (ticket <= 0) {
        band = candidate;
        break;
      }
    }
    if (band === undefined) throw new PopulationSpecError('size band selection fell through');

    const refNumber = spec.firstRefOrdinal + index;
    const userNumber = spec.firstRefOrdinal + Math.floor(index / accountsPerUser);

    // The setpoint is the CALLER'S offset applied to the CALLER'S size. The
    // simulator performs the subtraction and nothing else: it does not know
    // what a drawdown type is, and M02 section 1.2 is explicit that this side
    // of the boundary is told the number rather than deriving it.
    const unprotected = drawSeq.chanceInBasisPoints(spec.unprotectedShareBasisPoints);
    const riskMaxLossCents = unprotected ? null : band.sizeCents - spec.riskMaxLossOffsetCents;

    accounts.push({
      index,
      platformAccountRef: `${spec.accountRefPrefix}${ordinal(refNumber)}`,
      platformUserRef: `${spec.userRefPrefix}${ordinal(userNumber)}`,
      sizeLabel: band.label,
      sizeCents: band.sizeCents,
      // INV-M2-07. A funded account's first mark opens at exactly `size_cents`,
      // and M2 owns making that true (DEP-M2-01, GS-070, GS-093). There is no
      // draw here on purpose.
      startingBalanceCents: band.sizeCents,
      riskMaxLossCents,
      tradeRateBasisPoints: drawSeq.inRange(spec.behaviour.tradeRateBasisPoints),
      tradesPerDayMax: drawSeq.inRange(spec.behaviour.tradesPerDayMax),
      quantityMax: drawSeq.inRange(spec.behaviour.quantityMax),
      driftTicks: drawSeq.inRange(spec.behaviour.driftTicks),
      volatilityTicks: drawSeq.inRange(spec.behaviour.volatilityTicks),
      liquidationSlippageTicks: drawSeq.inRange(spec.behaviour.liquidationSlippageTicks),
    });
  }

  return Object.freeze(accounts);
}
