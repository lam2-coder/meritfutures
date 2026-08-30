// =============================================================================
// apps/api/test/admin-source-eligible-next-7d.test.ts
// =============================================================================
// `readEligibleNext7d`, AND THE CLAUSE IT WAS BUILT TO RE-DERIVE.
//
// `test/wiring.test.ts`'s `setAdminReadSource` entry said `readLiability` is
// "UNBUILT rather than blocked ... the figure holding that fold is
// `eligible_next_7d`, whose last term is a `writeRuleState` implementation under
// `apps/worker/**` or `packages/**`". **THE FIRST CASE BELOW READS THAT TERM AT
// SOURCE AND IT IS THERE.** The clause is false, `liability.ts`'s `B5` has no
// unspent term left, and the figure is still not on the wire, which is what the
// rest of this file is about.
//
// **THE CASES ARE THE FIGURE'S HONESTY AND NOT ITS ARITHMETIC ALONE.** Three
// properties are load bearing on a surface an operator funds a payout wallet
// from, and each has its own section:
//
//   1. EVERY NUMBER ON THIS FIGURE IS PROJECTED and the figure says which of its
//      terms are measured, in data a renderer can read.
//   2. AN EMPTY `rule_states` IS A REFUSAL and never a zero liability, while a
//      genuinely empty funded population is a measured zero. The two produce the
//      same `0` and mean opposite things.
//   3. A PARTIAL FOLD IS PRODUCED AND SAYS SO, because refusing it would leave
//      an operator with nothing on every ordinary day.
//
// Nothing here opens a database. `ADR-102` section 16 gives `ci.yml`'s
// `integration` job none, so every row below is a fixture in the shape the
// accessor returns and the engine is the one doing the deciding.
// =============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ELIGIBLE_FIGURE_TERMS,
  ELIGIBLE_FOLD_REFUSAL_CAUSES,
  ELIGIBLE_FOLD_TABLES,
  EligibleFoldUnwired,
  readEligibleNext7d,
  toWireEligibleNext7d,
  UNWIRED_ELIGIBLE_FOLD_IO,
} from '../src/admin-source/eligible-next-7d.ts';
import type {
  EligibleFoldIo,
  EligibleFoldTable,
  EligibleFoldTx,
  EligibleNext7dFigure,
  EligibleNext7dOutcome,
} from '../src/admin-source/eligible-next-7d.ts';
import type { TradingCalendarTx } from '../src/admin-source/liability.ts';
import { AdminReadError } from '../src/routes/admin-reads.ts';

import type { BasisPoints, Cents, PlanVersionId, ResolvedPlan } from '@merit/rules-engine';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

// -----------------------------------------------------------------------------
// The plan. CORE-50K, M01 Appendix A.1's 50K column
// -----------------------------------------------------------------------------
// TRANSCRIBED RATHER THAN IMPORTED, on `admin-source-liability-calendar.test.ts`'s
// own reason for the calendar: `payouts.test.ts`'s copy is private to that suite
// and exporting it would make two files share a shape neither owns.

const bp = (n: number): BasisPoints => n as BasisPoints;
const PLAN_VERSION = '0199c7a1-0000-7000-8000-000000000001' as PlanVersionId;
const SIZE_CENTS: Cents = 5_000_000n;

const CORE_50K: ResolvedPlan = {
  planVersionId: PLAN_VERSION,
  sizeCents: SIZE_CENTS,
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

/** R-35's withdrawable on the fixture balance, ABOVE the ordinal-1 cap on purpose. */
const WITHDRAWABLE: Cents = 200_000n;
/** R-42, ordinal 1 on CORE-50K's schedule. `min(withdrawable, cap)` is this one. */
const CAP: Cents = 150_000n;

/** The port, supplied by the SUITE because no deployment supplies one. */
const io: EligibleFoldIo = {
  resolvePinnedPlan: async (planVersionId, sizeCents) => {
    if (planVersionId !== PLAN_VERSION || sizeCents !== SIZE_CENTS)
      throw new Error(`the fold asked for an unpinned plan: ${planVersionId} at ${sizeCents}`);
    return CORE_50K;
  },
};

// -----------------------------------------------------------------------------
// The calendar. One covered interval, one holiday inside it
// -----------------------------------------------------------------------------
// `sequence` IS POSITION OVER THE ORDERED HOLIDAY-FILTERED ROWS and the numbers
// are written out here because the cadence arithmetic below depends on them:
//
//   11-02 0   11-03 1   11-04 2   11-05 3   11-06 4   11-09 5   11-10 6
//   11-11 7   11-12 8   11-13 9   11-16 10  11-17 11  11-18 12  11-19 13
//   11-20 14  11-23 15  11-24 16  11-25 17  [11-26 holiday]  11-27 18  11-30 19

const SESSIONS: readonly string[] = [
  '2026-11-02',
  '2026-11-03',
  '2026-11-04',
  '2026-11-05',
  '2026-11-06',
  '2026-11-09',
  '2026-11-10',
  '2026-11-11',
  '2026-11-12',
  '2026-11-13',
  '2026-11-16',
  '2026-11-17',
  '2026-11-18',
  '2026-11-19',
  '2026-11-20',
  '2026-11-23',
  '2026-11-24',
  '2026-11-25',
  '2026-11-27',
  '2026-11-30',
];

const HOLIDAYS: readonly string[] = ['2026-11-26'];

const session = (tradingDay: string): Record<string, unknown> => ({
  tradingDay,
  sessionOpenAt: new Date(Date.parse(`${tradingDay}T22:00:00.000Z`) - 23 * 60 * 60 * 1000),
  sessionCloseAt: new Date(`${tradingDay}T22:00:00.000Z`),
  isHalfDay: false,
  isHoliday: false,
  halted: false,
  notes: null,
});

const holiday = (tradingDay: string): Record<string, unknown> => ({
  tradingDay,
  sessionOpenAt: null,
  sessionCloseAt: null,
  isHalfDay: false,
  isHoliday: true,
  halted: false,
  notes: 'exchange holiday',
});

const CALENDAR: readonly unknown[] = [
  ...SESSIONS.map((d) => session(d)),
  ...HOLIDAYS.map((d) => holiday(d)),
];

const LOADS: readonly unknown[] = [
  { coverageStartDay: '2026-11-02', coverageEndDay: '2026-11-30' },
];

/** An instant after `2026-11-11` closed, so the anchor is that day. */
const AS_OF = '2026-11-11T23:30:00.000Z';
const ANCHOR = '2026-11-11';

/** The seven sessions after the anchor. Derived so a calendar edit moves it. */
const HORIZON: readonly string[] = SESSIONS.filter((d) => d > ANCHOR).slice(0, 7);

function calendarHandle(
  overrides: { calendar?: readonly unknown[]; loads?: readonly unknown[] } = {},
): TradingCalendarTx {
  return {
    rows: async (key) =>
      key === 'tradingCalendar'
        ? [...(overrides.calendar ?? CALENDAR)]
        : [...(overrides.loads ?? LOADS)],
  };
}

// -----------------------------------------------------------------------------
// The rows
// -----------------------------------------------------------------------------

const IDENTITY_A = '0199c7a1-1111-7000-8000-00000000000a';
const IDENTITY_B = '0199c7a1-1111-7000-8000-00000000000b';
const ACCOUNT_A = '0199c7a1-2222-7000-8000-00000000000a';
const ACCOUNT_B = '0199c7a1-2222-7000-8000-00000000000b';
const ACCOUNT_C = '0199c7a1-2222-7000-8000-00000000000c';

const account = (
  id: string,
  identityId: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  identityId,
  planVersionId: PLAN_VERSION,
  sizeCents: SIZE_CENTS,
  phase: 'funded',
  status: 'active',
  payoutsFrozen: false,
  reconBlocked: false,
  ...over,
});

const identity = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  payoutsFrozen: false,
  ...over,
});

/**
 * The stored `engine_gates` bag, `ADR-206`'s encoding: the engine's own value
 * with every cents member a base-10 STRING.
 */
function storedGates(over: {
  readonly cadencePasses: boolean;
  readonly tradingDaysSinceLastPayout: number | null;
  readonly nextEligibleTradingDay: string | null;
}): Record<string, unknown> {
  return {
    tradedDays: { pass: true, skipped: true, have: 3, need: 0 },
    winDays: { pass: true, have: 5, need: 5, floorCents: '15000' },
    buffer: { pass: true, haveCents: '300000', needCents: '100000' },
    consistency: {
      pass: true,
      skipped: false,
      bestDayShareBp: 1200,
      maxDayShareBp: 3000,
      profitNeededToDiluteCents: '0',
    },
    cadenceGap: {
      pass: over.cadencePasses,
      skipped: false,
      tradingDaysSinceLastPayout: over.tradingDaysSinceLastPayout,
      need: 5,
      nextEligibleTradingDay: over.nextEligibleTradingDay,
    },
    minimumAmount: {
      pass: true,
      withdrawableCents: WITHDRAWABLE.toString(),
      capCents: CAP.toString(),
      minPayoutCents: '10000',
    },
  };
}

/**
 * A folded `rule_states` row for a funded account that qualifies at the anchor.
 *
 * `cadenceAnchorDay` IS `2026-11-02`, SEQUENCE 0. The anchor day is sequence 7,
 * so R-37 counts 7 against a configured gap of 5 and the stored gate passes.
 */
function eligibleNowRow(
  accountId: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 1n,
    accountId,
    tradingDay: ANCHOR,
    phase: 'funded',
    balanceCents: 5_300_000n,
    floorOpenCents: 5_050_000n,
    floorCents: 5_050_000n,
    floorLocked: true,
    highWaterBalanceCents: 5_300_000n,
    withdrawableCents: WITHDRAWABLE,
    tradedDaysCount: 3,
    winDaysCount: 5,
    consistencyBestDayCents: 36_000n,
    consistencyPeriodProfitCents: 300_000n,
    consistencyPeriodStartDay: '2026-11-09',
    payoutsSettledCount: 0,
    payoutAnchorDay: '2026-11-02',
    cadenceAnchorDay: '2026-11-02',
    lifetimeSettledCents: 0n,
    engineGates: storedGates({
      cadencePasses: true,
      tradingDaysSinceLastPayout: 7,
      nextEligibleTradingDay: null,
    }),
    engineEligible: true,
    breached: false,
    breachKind: null,
    engineVersion: 'test-engine',
    ...over,
  };
}

/**
 * `ADR-204` ruling 2's set `C`: every engine gate but the cadence gap passes.
 *
 * `cadenceAnchorDay` IS `2026-11-10`, SEQUENCE 6. The anchor day is sequence 7,
 * so R-37 counts 1 against 5 and the stored gate fails. THE DAY IT CLEARS IS THE
 * POINT: sequence 6 plus 5 is sequence 11, which is `2026-11-17`, while five
 * DAYS after `2026-11-10` is `2026-11-15`, not a session at all.
 */
function cadencePendingRow(accountId: string): Record<string, unknown> {
  return eligibleNowRow(accountId, {
    cadenceAnchorDay: '2026-11-10',
    payoutAnchorDay: '2026-11-09',
    engineEligible: false,
    engineGates: storedGates({
      cadencePasses: false,
      tradingDaysSinceLastPayout: 1,
      nextEligibleTradingDay: '2026-11-17',
    }),
  });
}

interface Rows {
  readonly accounts?: readonly unknown[];
  readonly identities?: readonly unknown[];
  readonly kycVerifications?: readonly unknown[];
  readonly payoutRequests?: readonly unknown[];
  readonly ruleStates?: readonly unknown[];
}

interface Recorded {
  readonly key: EligibleFoldTable;
  readonly where?: Readonly<Record<string, unknown>>;
}

const VERIFIED_KYC = (identityId: string): Record<string, unknown> => ({
  id: `kyc-${identityId}`,
  identityId,
  state: 'verified',
  supersedes: null,
});

/**
 * A handle answering from rows and RECORDING every call.
 *
 * `admin-source-liability-book.test.ts`'s double, and its reason: a module that
 * read a whole table and filtered in memory produces the same answer as one that
 * filtered at the accessor, and only one of the two is the read this module
 * claims to make.
 */
function handle(rows: Rows): { tx: EligibleFoldTx; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const table = (key: EligibleFoldTable): readonly unknown[] => rows[key] ?? [];
  const tx: EligibleFoldTx = {
    rows: async (key) => {
      calls.push({ key });
      return [...table(key)];
    },
    rowsWhere: async (key, where) => {
      calls.push({ key, where });
      return [...table(key)].filter((row) =>
        Object.entries(where).every(
          ([property, value]) => (row as Record<string, unknown>)[property] === value,
        ),
      );
    },
  };
  return { tx, calls };
}

/** Two funded accounts, one in `E` and one in `C`, both clear on every context gate. */
function twoEligible(): Rows {
  return {
    accounts: [account(ACCOUNT_A, IDENTITY_A), account(ACCOUNT_B, IDENTITY_B)],
    identities: [identity(IDENTITY_A), identity(IDENTITY_B)],
    kycVerifications: [VERIFIED_KYC(IDENTITY_A), VERIFIED_KYC(IDENTITY_B)],
    payoutRequests: [],
    ruleStates: [eligibleNowRow(ACCOUNT_A), cadencePendingRow(ACCOUNT_B)],
  };
}

async function fold(rows: Rows, calendar?: TradingCalendarTx): Promise<EligibleNext7dOutcome> {
  const { tx } = handle(rows);
  const result = await readEligibleNext7d(tx, calendar ?? calendarHandle(), io, AS_OF);
  return result.figure;
}

/** The `folded` arm, or a thrown failure, so no case reads through a union. */
function folded(outcome: EligibleNext7dOutcome): EligibleNext7dFigure {
  if (outcome.kind !== 'folded')
    throw new Error(`expected a figure, got ${outcome.cause}: ${outcome.detail}`);
  return outcome;
}

// =============================================================================
// 1. THE CLAUSE, RE-DERIVED AT SOURCE
// =============================================================================

describe('the entry clause this module was built to re-derive', () => {
  it('names a `writeRuleState` implementation that IS under `apps/worker/**`', () => {
    const writer = read('apps/worker/src/batch/state-writer.ts');
    // The implementation, its declared type, and the port it satisfies.
    expect(writer).toContain('export function writeRuleStateVia');
    expect(writer).toContain("BatchWritePort['writeRuleState']");

    // COMPOSED RATHER THAN MERELY DECLARED. An exported function nothing
    // supplies is what `UNWIRED_RULE_STATE_WRITER_IO` is, and the entry's clause
    // would still be true of that.
    const adapter = read('apps/worker/src/batch/adapter.ts');
    expect(adapter).toContain('writeRuleState: writeRuleStateVia(');
    expect(adapter).toContain('encodeEngineGates,');

    // AND CALLED. `nightly.ts` is the single caller and it reaches the port.
    expect(read('apps/worker/src/batch/nightly.ts')).toContain(
      'await ports.write.writeRuleState(fold.row)',
    );

    // The codec underneath both, ADR-250, in `packages/**`.
    expect(read('packages/rules-engine/src/index.ts')).toContain(
      "export { decodeEngineGates, encodeEngineGates, EngineGatesCodecError } from './gates-codec.ts';",
    );
  });

  it('is quoted in the module header before it is replaced, so a grep finds both halves', () => {
    const header = read('apps/api/src/admin-source/eligible-next-7d.ts');
    expect(header).toContain('whose last term is a\n// `writeRuleState` implementation');
    expect(header).toContain('**THE LAST CLAUSE IS FALSE');
  });

  it('leaves `readLiability` uncomposed, because the port is not this row`s to wire', () => {
    const index = read('apps/api/src/admin-source/index.ts');
    expect(index).toContain("throw new AdminSourceNotComposed('readLiability')");
    // The fold is not smuggled in through the parts object either.
    expect(index).not.toContain('eligible-next-7d');
  });
});

// =============================================================================
// 2. MEASURED VERSUS PROJECTED, IN THE FIGURE
// =============================================================================

describe('the basis of every term', () => {
  it('names every leaf of the figure, in both directions', async () => {
    const figure = folded(await fold(twoEligible()));

    // DERIVED FROM THE VALUE rather than from a list, so a field added to the
    // figure and not to the table is a red case and never a silent number.
    const leaves = new Set<string>();
    for (const [key, value] of Object.entries(figure)) {
      if (['kind', 'terms', 'assumptions', 'caveat'].includes(key)) continue;
      if (key === 'population') {
        for (const inner of Object.keys(value as object)) leaves.add(`population.${inner}`);
        continue;
      }
      if (key === 'by_day') {
        for (const inner of Object.keys((value as object[])[0] ?? {}))
          leaves.add(`by_day[].${inner}`);
        continue;
      }
      leaves.add(key);
    }

    const named = new Set(figure.terms.map((term) => term.term));
    for (const leaf of leaves) expect(named).toContain(leaf);
    // And the other direction, minus the five inputs, which are not leaves.
    for (const term of named) {
      if (term.startsWith('input.')) continue;
      expect(leaves).toContain(term);
    }
  });

  it('marks every number the figure carries `projected` and never `measured`', async () => {
    const figure = folded(await fold(twoEligible()));
    const basisOf = (term: string): string => {
      const found = figure.terms.find((entry) => entry.term === term);
      if (found === undefined) throw new Error(`no basis is stated for ${term}`);
      return found.basis;
    };

    // THE THREE MEMBERS `EligibleNext7d` DECLARES. Every one is a forecast.
    expect(basisOf('total_cents')).toBe('projected');
    expect(basisOf('account_count')).toBe('projected');
    expect(basisOf('by_day[].cents')).toBe('projected');
    expect(basisOf('by_day[].accounts')).toBe('projected');

    // AND THE MEASURED TERMS ARE EXACTLY THE ONES THE WIRE CANNOT CARRY.
    expect(basisOf('as_of_trading_day')).toBe('measured');
    expect(basisOf('population.funded')).toBe('measured');
    expect(basisOf('population.covered')).toBe('measured');
    expect(basisOf('by_day[].trading_day')).toBe('measured');
  });

  it('pairs every `projected` term with the assumptions that make it one', async () => {
    const figure = folded(await fold(twoEligible()));
    const ids = new Set(figure.assumptions.map((assumption) => assumption.id));
    expect([...ids].sort()).toEqual(['A1', 'A2', 'A3', 'A4', 'A5']);

    for (const term of figure.terms) {
      if (term.basis === 'measured' && term.term !== 'input.plan') {
        expect(term.assumptions).toEqual([]);
        continue;
      }
      expect(term.assumptions.length).toBeGreaterThan(0);
      for (const id of term.assumptions) expect(ids).toContain(id);
    }
  });

  it('carries ADR-204`s caveat, which is the sentence a panel renders', async () => {
    const figure = folded(await fold(twoEligible()));
    expect(figure.caveat).toContain('A LOWER BOUND ON THE POPULATION');
    expect(figure.caveat).toContain('NOT A BOUND ON THE MONEY');
  });

  it('measures that the WIRE type declares no measured term, which is why the basis stays here', () => {
    const contract = read('apps/api/src/routes/admin-reads.ts');
    const declaration = contract.slice(
      contract.indexOf('export interface EligibleNext7d {'),
      contract.indexOf('export interface LiabilityGap {'),
    );
    // Three members, and the only non-numeric one is a day inside `by_day`.
    expect(declaration).toContain('readonly total_cents: number;');
    expect(declaration).toContain('readonly account_count: number;');
    expect(declaration).toContain('readonly trading_day: string;');
    // NOTHING NAMES A POPULATION, AN ASSUMPTION, A CAVEAT OR A BASIS. A figure
    // with no measured term has no field a basis could hang on, which is the
    // finding rather than an omission this fence may repair.
    for (const absent of ['population', 'assumption', 'caveat', 'basis', 'projected'])
      expect(declaration).not.toContain(absent);
  });

  it('loses the basis at the wire, and the narrowing is the only place cents become numbers', async () => {
    const figure = folded(await fold(twoEligible()));
    const wire = toWireEligibleNext7d(figure);
    expect(Object.keys(wire).sort()).toEqual(['account_count', 'by_day', 'total_cents']);
    expect(typeof wire.total_cents).toBe('number');
    expect(wire.total_cents).toBe(Number(figure.total_cents));
  });

  it('refuses a total past 2^53 at the wire rather than rounding it inside the fold', async () => {
    // A population large enough that the SUM leaves safe-integer range while
    // every account's own figure is ordinary. A `number` accumulator would have
    // rounded before anything could refuse.
    const huge: Cents = 9_007_199_254_740_993n;
    const figure = folded(await fold(twoEligible()));
    expect(() => toWireEligibleNext7d({ ...figure, total_cents: huge })).toThrow(AdminReadError);
    expect(() => toWireEligibleNext7d({ ...figure, total_cents: huge })).toThrow(/safe integer/);
  });
});

// =============================================================================
// 3. THE TWO ZEROES
// =============================================================================

describe('an empty `rule_states` is a refusal and never a zero liability', () => {
  it('refuses when funded accounts carry no folded state, and names the run', async () => {
    const rows = twoEligible();
    const outcome = await fold({ ...rows, ruleStates: [] });
    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') throw new Error('unreachable');
    expect(outcome.cause).toBe('no_folded_state');
    expect(outcome.awaiting).toContain('runNightlyBatch');
    expect(outcome.detail).toContain('2 funded accounts');
    expect(outcome.detail).toContain('EC-074');
  });

  it('refuses when the rows exist for a DIFFERENT day, which is the same unrun morning', async () => {
    const rows = twoEligible();
    const outcome = await fold({
      ...rows,
      ruleStates: [
        eligibleNowRow(ACCOUNT_A, { tradingDay: '2026-11-10' }),
        eligibleNowRow(ACCOUNT_B, { tradingDay: '2026-11-10' }),
      ],
    });
    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') throw new Error('unreachable');
    expect(outcome.cause).toBe('no_folded_state');
    expect(outcome.detail).toContain(ANCHOR);
  });

  it('produces a MEASURED zero when there is genuinely no funded account', async () => {
    const figure = folded(await fold({ accounts: [], ruleStates: [] }));
    expect(figure.total_cents).toBe(0n);
    expect(figure.account_count).toBe(0);
    expect(figure.population).toEqual({ funded: 0, covered: 0, uncovered: 0 });
    // AND THE FIGURE SAYS WHICH ZERO IT IS. `population.funded` is measured, so
    // an operator reading `0 of 0` cannot mistake it for an unrun batch.
    expect(figure.terms.find((term) => term.term === 'population.funded')?.basis).toBe('measured');
  });
});

// =============================================================================
// 4. THE PARTIAL FOLD
// =============================================================================

describe('a partial fold is produced and says so', () => {
  it('folds the covered population and names the shortfall', async () => {
    const rows = twoEligible();
    const figure = folded(
      await fold({
        ...rows,
        accounts: [...(rows.accounts ?? []), account(ACCOUNT_C, IDENTITY_A)],
      }),
    );
    expect(figure.population).toEqual({ funded: 3, covered: 2, uncovered: 1 });
    // The sum is over the covered two and not over the funded three.
    expect(figure.total_cents).toBe(CAP * 2n);
    expect(figure.account_count).toBe(2);
  });

  it('rethrows an UNREADABLE row rather than dropping the account', async () => {
    // Two rows for one account-day, which `rule_states_account_day_uq` forbids.
    // An absent row leaves the population; a malformed one is a defect and the
    // account it belongs to would go missing silently.
    const rows = twoEligible();
    await expect(
      fold({ ...rows, ruleStates: [...(rows.ruleStates ?? []), eligibleNowRow(ACCOUNT_A)] }),
    ).rejects.toThrow(/rows carry this account and this day/);
  });
});

// =============================================================================
// 5. THE ARITHMETIC, WHICH IS THE ENGINE'S AND NOT THIS MODULE'S
// =============================================================================

describe('the fold', () => {
  it('places each account on ONE day, which is ADR-204 ruling 3', async () => {
    const figure = folded(await fold(twoEligible()));

    // `E` lands on the horizon's first day; `C` lands on the day its own gap
    // expires, which is sequence 6 plus 5 and NOT five dates later.
    const byDay = new Map(figure.by_day.map((day) => [day.trading_day, day]));
    expect(byDay.get('2026-11-12')).toEqual({
      trading_day: '2026-11-12',
      cents: CAP,
      accounts: 1,
    });
    expect(byDay.get('2026-11-17')).toEqual({
      trading_day: '2026-11-17',
      cents: CAP,
      accounts: 1,
    });

    // AND THE SERIES SUMS TO THE TOTAL, which is the property a repeated
    // standing population breaks: seven times over on a flat line.
    const summed = figure.by_day.reduce((total, day) => total + day.cents, 0n);
    expect(summed).toBe(figure.total_cents);
    expect(figure.by_day.reduce((total, day) => total + day.accounts, 0)).toBe(
      figure.account_count,
    );
  });

  it('carries every horizon day, ascending, with an empty day as a zero rather than absent', async () => {
    const figure = folded(await fold(twoEligible()));
    expect(figure.by_day.map((day) => day.trading_day)).toEqual([...HORIZON]);
    expect(figure.by_day).toHaveLength(7);
    const quiet = figure.by_day.find((day) => day.trading_day === '2026-11-13');
    expect(quiet).toEqual({ trading_day: '2026-11-13', cents: 0n, accounts: 0 });
  });

  it('dates itself at the last closed day and never at a horizon day (R-06)', async () => {
    const figure = folded(await fold(twoEligible()));
    expect(figure.as_of_trading_day).toBe(ANCHOR);
    expect(HORIZON).not.toContain(figure.as_of_trading_day);
  });

  it('drops an account a CONTEXT gate vetoes, because R-41 conjoins them', async () => {
    const rows = twoEligible();
    const figure = folded(
      await fold({
        ...rows,
        // The OWNER's flag, not the account's. Both exist and both veto.
        identities: [identity(IDENTITY_A, { payoutsFrozen: true }), identity(IDENTITY_B)],
      }),
    );
    expect(figure.account_count).toBe(1);
    expect(figure.total_cents).toBe(CAP);
    // The account is still COVERED. It has a folded state; it is not eligible.
    expect(figure.population).toEqual({ funded: 2, covered: 2, uncovered: 0 });
  });

  it('reads the WHOLE kyc chain and EVERY payout request status, at the accessor', async () => {
    const { tx, calls } = handle(twoEligible());
    await readEligibleNext7d(tx, calendarHandle(), io, AS_OF);

    const kyc = calls.filter((call) => call.key === 'kycVerifications');
    expect(kyc).toHaveLength(2);
    // KEYED ON THE IDENTITY AND NOT ON A STATE. `SD-M19-01` makes the head a
    // property of the SET, so a filter here would address a row that moves.
    for (const call of kyc) expect(Object.keys(call.where ?? {})).toEqual(['identityId']);

    const payouts = calls.filter((call) => call.key === 'payoutRequests');
    expect(payouts).toHaveLength(2);
    for (const call of payouts) expect(Object.keys(call.where ?? {})).toEqual(['accountId']);
  });

  it('refuses rather than reading an absent identity row as `false`', async () => {
    const rows = twoEligible();
    await expect(fold({ ...rows, identities: [identity(IDENTITY_B)] })).rejects.toThrow(
      /identities holds no row/,
    );
  });

  it('reads the funded population at the accessor rather than filtering in memory', async () => {
    const { tx, calls } = handle(twoEligible());
    await readEligibleNext7d(tx, calendarHandle(), io, AS_OF);
    const accounts = calls.filter((call) => call.key === 'accounts');
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.where).toEqual({ phase: 'funded' });
  });
});

// =============================================================================
// 6. THE CALENDAR REFUSALS
// =============================================================================

describe('the calendar refusals come before the batch one', () => {
  it('refuses `calendar_uncovered` when no load declares coverage', async () => {
    const outcome = await fold(twoEligible(), calendarHandle({ loads: [] }));
    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') throw new Error('unreachable');
    expect(outcome.cause).toBe('calendar_uncovered');
    expect(outcome.detail).toContain('ADR-042 F-4');
  });

  it('refuses `horizon_exhausted` rather than folding a short week', async () => {
    // Coverage stops four sessions after the anchor, so seven cannot be taken.
    const outcome = await fold(
      twoEligible(),
      calendarHandle({ loads: [{ coverageStartDay: '2026-11-02', coverageEndDay: '2026-11-17' }] }),
    );
    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') throw new Error('unreachable');
    expect(outcome.cause).toBe('horizon_exhausted');
    expect(outcome.detail).toContain('quiet week');
  });

  it('asks the calendar BEFORE `rule_states`, so an unloaded estate is not an unrun batch', async () => {
    const { tx, calls } = handle({ ...twoEligible(), ruleStates: [] });
    const result = await readEligibleNext7d(tx, calendarHandle({ loads: [] }), io, AS_OF);
    expect(result.figure.kind).toBe('refused');
    // Not one account row was read, which is what makes the two mornings
    // distinguishable rather than merely differently worded.
    expect(calls).toHaveLength(0);
  });
});

// =============================================================================
// 7. THE ONE INJECTED TERM
// =============================================================================

describe('the plan term this fence may not take', () => {
  it('throws `EligibleFoldUnwired` by name when nothing supplies it', () => {
    expect(() => UNWIRED_ELIGIBLE_FOLD_IO.resolvePinnedPlan(PLAN_VERSION, SIZE_CENTS)).toThrow(
      EligibleFoldUnwired,
    );
    try {
      UNWIRED_ELIGIBLE_FOLD_IO.resolvePinnedPlan(PLAN_VERSION, SIZE_CENTS);
    } catch (error) {
      expect((error as EligibleFoldUnwired).member).toBe('resolvePinnedPlan');
      expect((error as Error).message).toContain('toPublishedRules');
      expect((error as Error).message).toContain('ADR-239 slice A');
    }
  });

  it('is REGISTERED rather than taken: no `PlanRulesJson` decoder exists under `apps/api/src`', () => {
    // The finding this port stands on, measured rather than asserted. The single
    // decoder in this repository is `apps/worker`'s, and `apps/api` cannot
    // import it, so a second one here would be FM-16 on the blob that fixes
    // every cents value a payout is decided against.
    const worker = read('apps/worker/src/batch/adapter.ts');
    expect(worker).toContain('function toPublishedRules(');

    const fold = read('apps/api/src/admin-source/eligible-next-7d.ts');
    expect(fold).not.toContain('schema_version');
    expect(fold).not.toContain('phase_funded');
    expect(fold).toContain('resolvePinnedPlan(planVersionId: string, sizeCents: Cents)');
  });

  it('does not reach `plan_versions` at the accessor either', () => {
    expect([...ELIGIBLE_FOLD_TABLES]).toEqual([
      'accounts',
      'identities',
      'kycVerifications',
      'payoutRequests',
      'ruleStates',
    ]);
  });
});

// =============================================================================
// 8. THE VOCABULARY
// =============================================================================

describe('the refusal vocabulary', () => {
  it('is closed at four and every member is reachable', async () => {
    expect([...ELIGIBLE_FOLD_REFUSAL_CAUSES]).toHaveLength(4);
    // Three are exercised above. `projection_refused` is the fourth and it is
    // reached by handing the engine a state whose cadence anchor sits outside
    // the covered interval, which `lookupCalendarDay` answers `outside_coverage`
    // for and `ADR-042` F-4 makes an UNKNOWN rather than a passing gate.
    const rows = twoEligible();
    const outcome = await fold({
      ...rows,
      accounts: [account(ACCOUNT_A, IDENTITY_A)],
      ruleStates: [eligibleNowRow(ACCOUNT_A, { cadenceAnchorDay: '2026-10-01' })],
    });
    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') throw new Error('unreachable');
    expect(outcome.cause).toBe('projection_refused');
    expect(outcome.detail).toContain(ACCOUNT_A);
  });

  it('states every term of the figure and never leaves one without a basis', () => {
    expect(ELIGIBLE_FIGURE_TERMS.length).toBeGreaterThan(0);
    for (const term of ELIGIBLE_FIGURE_TERMS) {
      expect(term.term).not.toBe('');
      expect(term.source).not.toBe('');
      expect(['measured', 'projected']).toContain(term.basis);
    }
  });
});
