import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import {
  BREAKER_READ_TABLES,
  BREAKER_STATES,
  BREAKER_STATE_CHANGED,
  BREAKER_WRITE_TABLES,
  BreakerDeclined,
  BreakerRowError,
  BreakerUnwired,
  LOSS_RATIO_POLICY,
  SALES_PAUSED_STATE,
  UNCALIBRATED_CUSUM,
  UNWIRED_BREAKER_IO,
  applyOverride,
  cusumOf,
  decideState,
  evaluateBreaker,
  foldCusum,
  foldWindow,
  lossRatioBp,
  passRateBp,
  resolvePolicy,
  salesPaused,
  stateChangedEvent,
  toBreakerStateRow,
} from '../src/index.ts';
import type {
  BreakerFilter,
  BreakerFilterTerm,
  BreakerIo,
  BreakerReadTable,
  BreakerState,
  BreakerTx,
  BreakerValues,
  BreakerWriteTable,
  LossRatioPolicy,
  PassRateDay,
  PreviousEvaluation,
  ResolvedPolicy,
  WindowFold,
} from '../src/index.ts';

// =============================================================================
// `P7-k`, and `GS-113` is the gate.
//
// WHAT THIS SUITE IS FOR, IN ONE SENTENCE PER SECTION.
//
//   1. THE BINDS. Every constant here is a transcription of a merged migration
//      or an approved plan, and each one is asserted against the primary source
//      READ AS TEXT rather than against a copy. A fifth `state` cannot drift in
//      on either side.
//   2. `INV-M5-12`, ADVERSARIALLY. "The circuit breaker pauses sales and can
//      never pause payouts." Four assertions, and the one that matters is the
//      one a type checker cannot make: a correctly-typed call into a payout
//      path. `test 2.4` is the seeded defect's watch.
//   3. `GS-113`. A ratio computed on a sample below the minimum reports
//      `insufficient_data`, sales are NOT paused, and the alert carries the
//      sample size. Its NEAR-MISS is the same ratio one purchase higher.
//   4. THE ARITHMETIC. `bigint` from the port to the row, one exact integer
//      division, and a `number` in a cents column refused BY NAME.
//   5. THE OVERRIDE, which lapses by being recomputed. This is the job
//      `CRON_INVENTORY`'s exemption rests on and which did not exist until now.
//   6. THE CUSUM, folded and never stored, absent and never manufactured.
//   7. THE POLICY. `OQ-M6-02` is the founder's, so the shipped policy DECLINES.
//   8. THE BARREL, which is `P7` section 9's largest collision.
// =============================================================================

const ROOT = join(import.meta.dirname, '..', '..', '..');
const MIGRATION = readFileSync(
  join(ROOT, 'packages/db/migrations/0016_treasury_controls.sql'),
  'utf8',
);
const M06 = readFileSync(join(ROOT, 'docs/plans/M06-admin-ops-console.md'), 'utf8');
const EVENTS = readFileSync(join(ROOT, 'docs/architecture/EVENTS.md'), 'utf8');
const PORTS_SOURCE = readFileSync(join(ROOT, 'apps/worker/src/breaker/ports.ts'), 'utf8');
const EVALUATE_SOURCE = readFileSync(join(ROOT, 'apps/worker/src/breaker/evaluate.ts'), 'utf8');
const BARREL = readFileSync(join(ROOT, 'apps/worker/src/index.ts'), 'utf8');

/**
 * Source with every comment removed.
 *
 * THE SWEEPS IN SECTION 2 RUN OVER THIS AND NOT OVER THE FILE. Both modules
 * discuss payouts at length, because the loss ratio's numerator IS settled
 * payouts and `INV-M5-12` is quoted in both headers; a sweep over the raw text
 * would be red on the prose that explains why it is green.
 */
function code(source: string): string {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

// -----------------------------------------------------------------------------
// The fixture: an in-memory tx that honours the filter it is given
// -----------------------------------------------------------------------------

interface Fixture {
  readonly plans?: readonly Record<string, unknown>[];
  readonly planVersions?: readonly Record<string, unknown>[];
  readonly purchases?: readonly Record<string, unknown>[];
  readonly payoutRequests?: readonly Record<string, unknown>[];
  readonly planBreakerState?: readonly Record<string, unknown>[];
}

interface Recorded {
  readonly inserts: { key: string; values: BreakerValues }[];
  readonly events: { name: string; payload: Record<string, unknown> }[];
  readonly reads: { key: string; where: BreakerFilter }[];
}

function isTerm(value: unknown): value is BreakerFilterTerm {
  return typeof value === 'object' && value !== null && 'term' in value;
}

function matches(row: Record<string, unknown>, where: BreakerFilter): boolean {
  for (const [key, expected] of Object.entries(where)) {
    const actual = row[key];
    if (isTerm(expected)) {
      if (expected.term === 'is-null') {
        if (actual !== null && actual !== undefined) return false;
        continue;
      }
      const bound = expected.value;
      if (!(actual instanceof Date) || !(bound instanceof Date)) return false;
      if (expected.term === 'at-least' && actual.getTime() < bound.getTime()) return false;
      if (expected.term === 'at-most' && actual.getTime() > bound.getTime()) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

/**
 * The port's own contract, enforced by the fake.
 *
 * **`insert` REFUSES ANY KEY BUT `planBreakerState` AT RUN TIME**, so a defect
 * seeded into `evaluate.ts` that writes a payout table is caught here even
 * though `BreakerWriteTable` would already have refused it at compile time. A
 * control that only exists in the type system is a control one `as` away from
 * gone, and `INV-M5-12` is not a rule to hold at one level.
 */
function ioOf(
  fixture: Fixture,
  options: { now?: Date; day?: string } = {},
): { io: BreakerIo; recorded: Recorded } {
  const recorded: Recorded = { inserts: [], events: [], reads: [] };
  const now = options.now ?? new Date('2026-08-28T12:00:00.000Z');
  const tx: BreakerTx = {
    rowsWhere: (key: BreakerReadTable, where: BreakerFilter) => {
      recorded.reads.push({ key, where });
      const table = fixture[key] ?? [];
      return Promise.resolve(table.filter((row) => matches(row, where)));
    },
    insert: (key: BreakerWriteTable, values: BreakerValues) => {
      if (String(key) !== 'planBreakerState')
        throw new Error(
          `INV-M5-12: the breaker evaluation attempted to write \`${String(key)}\`. Its write ` +
            'union has exactly one member and a payout is not it',
        );
      recorded.inserts.push({ key, values });
      return Promise.resolve([values]);
    },
  };
  return {
    recorded,
    io: {
      transact: (fn) => fn(tx),
      terms: {
        atLeast: (value) => ({ term: 'at-least', value }),
        atMost: (value) => ({ term: 'at-most', value }),
      },
      events: {
        emit: (_tx, event) => {
          recorded.events.push({ name: event.name, payload: { ...event.payload } });
          return Promise.resolve();
        },
      },
      now: () => now,
      tradingDayOf: () => options.day ?? '2026-08-28',
    },
  };
}

/** A policy with the two `OQ-M6-02` terms supplied BY THIS SUITE and by nobody else. */
function policyWith(minSample: number, minSettledPayouts: number | null = null): LossRatioPolicy {
  return {
    ...LOSS_RATIO_POLICY,
    minSample: {
      state: 'stated',
      value: minSample,
      cite: 'this suite',
      quote: 'A FIXTURE VALUE. OQ-M6-02 is unanswered and no number here is the corpus.',
    },
    minSettledPayouts:
      minSettledPayouts === null
        ? LOSS_RATIO_POLICY.minSettledPayouts
        : {
            state: 'stated',
            value: minSettledPayouts,
            cite: 'this suite',
            quote: 'A FIXTURE VALUE.',
          },
  };
}

const PLAN = { id: 'plan-1', code: 'CORE-25K', isActive: true };
const VERSION = { id: 'ver-1', planId: 'plan-1' };
const IN_WINDOW = new Date('2026-08-20T00:00:00.000Z');

function purchase(id: string, cents: bigint): Record<string, unknown> {
  return {
    id,
    planVersionId: 'ver-1',
    status: 'paid',
    paidAt: IN_WINDOW,
    amountPaidCents: cents,
  };
}

function settledPayout(id: string, cents: bigint): Record<string, unknown> {
  return {
    id,
    planVersionId: 'ver-1',
    status: 'settled',
    settledAt: IN_WINDOW,
    approvedCents: cents,
  };
}

function baseFixture(purchases: number, payoutCents: bigint, feeCents = 9_900n): Fixture {
  return {
    plans: [PLAN],
    planVersions: [VERSION],
    purchases: Array.from({ length: purchases }, (_unused, index) =>
      purchase(`p-${String(index)}`, feeCents),
    ),
    payoutRequests: payoutCents > 0n ? [settledPayout('r-1', payoutCents)] : [],
  };
}

const RESOLVED: ResolvedPolicy = {
  metric: 'loss_ratio_30d',
  windowDays: 30,
  thresholdBp: 6000,
  minSample: 20,
  minSettledPayouts: null,
};

function foldOf(sampleSize: number, numerator: bigint, denominator: bigint): WindowFold {
  return {
    numeratorCents: numerator,
    denominatorCents: denominator,
    sampleSize,
    settledPayoutCount: 1,
  };
}

// =============================================================================
// 1. The binds. Every constant read out of its primary source as text
// =============================================================================

test('1.1 BREAKER_STATES is 0016 CHECK transcribed, in the migration order', () => {
  const clause = /state\s+text NOT NULL CHECK \(state IN \(([\s\S]*?)\)\s*\)/.exec(MIGRATION);
  expect(clause, 'the CHECK moved or was reworded').not.toBeNull();
  const declared = [...(clause?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
  expect(declared).toEqual([...BREAKER_STATES]);
});

test('1.2 insufficient_data is one of them, and 0016 calls it FIRST CLASS in its own header', () => {
  expect(BREAKER_STATES).toContain('insufficient_data');
  expect(MIGRATION).toContain("'insufficient_data' is therefore a FIRST-CLASS STATE, not an error");
});

test('1.3 SALES_PAUSED_STATE is a member and it is the only one that pauses sales', () => {
  expect(BREAKER_STATES).toContain(SALES_PAUSED_STATE);
  expect(BREAKER_STATES.filter((state) => salesPaused(state))).toEqual([SALES_PAUSED_STATE]);
});

test('1.4 the constraint this evaluator mirrors is still in the migration, both halves', () => {
  expect(MIGRATION).toContain('CONSTRAINT plan_breaker_state_respects_min_sample CHECK (');
  expect(MIGRATION).toContain("state NOT IN ('armed', 'paused') OR sample_size >= min_sample");
  expect(MIGRATION).toContain('CONSTRAINT plan_breaker_state_override_is_complete CHECK (');
});

test('1.5 sample_size and min_sample are both columns, which is why both are written', () => {
  expect(MIGRATION).toMatch(/sample_size\s+integer NOT NULL CHECK \(sample_size >= 0\)/);
  expect(MIGRATION).toMatch(/min_sample\s+integer NOT NULL CHECK \(min_sample > 0\)/);
});

test('1.6 the two stated policy numbers are M06 P-M6-05 read as text, not remembered', () => {
  const row = M06.split('\n').find((line) => line.includes('| P-M6-05 |'));
  expect(row, 'P-M6-05 moved out of M06 section 3').toBeDefined();
  expect(row).toContain('Trailing 30 day settled payouts divided by fees');
  expect(row).toContain('Breaker at 6000bp pauses that plan');
  expect(LOSS_RATIO_POLICY.windowDays.value).toBe(30);
  expect(LOSS_RATIO_POLICY.thresholdBp.value).toBe(6000);
});

test('1.7 breaker.state_changed carries M06:265 field for field, and sample_size is among them', () => {
  const row = M06.split('\n').find((line) => line.includes('`breaker.state_changed`'));
  expect(row).toBeDefined();
  const declared = [...(row ?? '').matchAll(/\{ ([a-z_, ]+) \}/g)][0]?.[1] ?? '';
  const fields = declared.split(',').map((name) => name.trim());
  expect(fields).toEqual([
    'plan_id',
    'metric',
    'from_state',
    'to_state',
    'ratio_bp',
    'threshold_bp',
    'sample_size',
    'min_sample',
  ]);
  const event = stateChangedEvent({
    planId: 'plan-1',
    planCode: 'CORE-25K',
    evaluatedOn: '2026-08-28',
    metric: 'loss_ratio_30d',
    fold: foldOf(3, 1n, 2n),
    ratioBp: 5000,
    thresholdBp: 6000,
    minSample: 20,
    state: 'insufficient_data',
    floor: 'sample_size',
    override: null,
    previousState: null,
    salesPaused: false,
    floors: { minSample: 20, minSettledPayouts: null },
  });
  expect(Object.keys(event?.payload ?? {})).toEqual(fields);
});

test('1.8 breaker.state_changed has NO row in EVENTS.md, and the gap is pinned rather than assumed', () => {
  // REPORTED AND NOT REPAIRED. `EVENTS.md` is outside this fence and ADR-159
  // clause 1 makes the registry the authority for a name, so the payload above
  // is transcribed from M06 and this assertion is what tells the session that
  // lands the row that the transcription can now be bound to the registry.
  expect(EVENTS).not.toContain('breaker.state_changed');
  expect(BREAKER_STATE_CHANGED).toBe('breaker.state_changed');
});

// =============================================================================
// 2. INV-M5-12, adversarially. The breaker pauses SALES and can never pause
//    payouts
// =============================================================================

test('2.1 the write union has exactly one member and no payout table is in it', () => {
  expect(BREAKER_WRITE_TABLES).toEqual(['planBreakerState']);
  for (const forbidden of [
    'payoutRequests',
    'payoutTransfers',
    'walletWithdrawals',
    'walletEntries',
    'ledgerHalts',
    'ledgerEntries',
    'identityRestrictionEpisodes',
  ])
    expect(BREAKER_WRITE_TABLES as readonly string[]).not.toContain(forbidden);
});

test('2.2 payoutRequests is READABLE and that asymmetry is the design, not an oversight', () => {
  // The numerator IS settled payouts (P-M6-05), so a port that could not read
  // them would have no ratio. Read many, write one.
  expect(BREAKER_READ_TABLES as readonly string[]).toContain('payoutRequests');
  expect(BREAKER_WRITE_TABLES as readonly string[]).not.toContain('payoutRequests');
});

test('2.3 no payout-shaped name reaches a WRITE in either module, swept over code only', () => {
  const sources = { 'ports.ts': code(PORTS_SOURCE), 'evaluate.ts': code(EVALUATE_SOURCE) };
  const WRITE_VERBS = /\b(?:insert|updateAt|deleteAt|lockAt|update|delete)\s*\(\s*'([A-Za-z]+)'/g;
  for (const [name, source] of Object.entries(sources))
    for (const match of source.matchAll(WRITE_VERBS))
      expect(match[1], `${name} writes ${String(match[1])}`).toBe('planBreakerState');
});

test('2.4 a run writes planBreakerState and nothing else, and the fake refuses anything else', async () => {
  // THIS IS THE SEEDED DEFECT'S WATCH. `ioOf`'s `insert` THROWS on any key but
  // `planBreakerState`, so an `evaluate.ts` that reached a payout path with a
  // correctly typed call fails here rather than compiling green.
  const { io, recorded } = ioOf(baseFixture(25, 10_000n));
  await evaluateBreaker(io, policyWith(20));
  expect(recorded.inserts).toHaveLength(1);
  expect(recorded.inserts.map((row) => row.key)).toEqual(['planBreakerState']);
});

test('2.5 a decision has ONE effect and it is salesPaused, with no payout-shaped field', async () => {
  const report = await evaluateBreaker(ioOf(baseFixture(25, 10_000_000n)).io, policyWith(20));
  const decision = report.decisions[0];
  expect(decision?.salesPaused).toBe(true);
  const rendered = JSON.stringify(decision, (_key, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  ).toLowerCase();
  for (const forbidden of ['payout', 'withdraw', 'transfer', 'freeze', 'hold', 'halt', 'restrict'])
    expect(rendered.includes(`"${forbidden}`), `${forbidden} is on the decision`).toBe(false);
  expect(Object.keys(decision ?? {})).toContain('salesPaused');
});

test('2.6 salesPaused is total over the state set and true for exactly one member', () => {
  const paused = BREAKER_STATES.filter((state: BreakerState) => salesPaused(state));
  expect(paused).toHaveLength(1);
  expect(salesPaused('insufficient_data')).toBe(false);
  expect(salesPaused('manually_overridden')).toBe(false);
  expect(salesPaused('armed')).toBe(false);
});

// =============================================================================
// 3. GS-113. A sample below the minimum, and its near-miss
// =============================================================================

test('3.1 GS-113: below the minimum the state is insufficient_data and SALES ARE NOT PAUSED', async () => {
  // AS-M6-02 exactly: one $99 purchase on a brand new plan, one 150,000c
  // payout, a ratio far above the 6000bp threshold, and a sample of one.
  const report = await evaluateBreaker(ioOf(baseFixture(1, 150_000n)).io, policyWith(20));
  const decision = report.decisions[0];
  expect(decision?.state).toBe('insufficient_data');
  expect(decision?.salesPaused).toBe(false);
  expect(decision?.floor).toBe('sample_size');
  // The ratio IS above the threshold and the breaker still has no opinion.
  expect(decision?.ratioBp).toBe(151_515);
  expect(decision?.ratioBp ?? 0).toBeGreaterThan(6000);
  expect(report.plansPaused).toBe(0);
  expect(report.plansInsufficientData).toBe(1);
});

test('3.2 GS-113 NEAR-MISS: the same plan one purchase above the floor DOES pause', async () => {
  const report = await evaluateBreaker(ioOf(baseFixture(20, 150_000n)).io, policyWith(20));
  const decision = report.decisions[0];
  expect(decision?.state).toBe('paused');
  expect(decision?.salesPaused).toBe(true);
  expect(decision?.floor).toBeNull();
  expect(decision?.fold.sampleSize).toBe(20);
});

test('3.3 the boundary is `sample_size >= min_sample`, which is 0016 own comparison', () => {
  const fold = foldOf(19, 150_000n, 100n);
  expect(
    decideState({ fold, ratioBp: 999_999, policy: { ...RESOLVED, minSample: 20 } }).state,
  ).toBe('insufficient_data');
  expect(
    decideState({ fold: foldOf(20, 150_000n, 100n), ratioBp: 999_999, policy: RESOLVED }).state,
  ).toBe('paused');
});

test('3.4 the row carries sample_size BESIDE min_sample, on every state the ladder reaches', async () => {
  // insufficient_data, paused and armed in turn. INV-M6-07 is "the ratio is
  // shown next to its sample size EVERYWHERE it appears", so the assertion runs
  // over all three rather than over the interesting one.
  const cases = [
    { purchases: 1, payout: 150_000n, state: 'insufficient_data' },
    { purchases: 25, payout: 150_000n, state: 'paused' },
    { purchases: 25, payout: 1n, state: 'armed' },
  ] as const;
  for (const scenario of cases) {
    const { io, recorded } = ioOf(baseFixture(scenario.purchases, scenario.payout));
    await evaluateBreaker(io, policyWith(20));
    const values = recorded.inserts[0]?.values ?? {};
    expect(values['state']).toBe(scenario.state);
    expect(values['sampleSize']).toBe(scenario.purchases);
    expect(values['minSample']).toBe(20);
  }
});

test('3.5 the alert carries the sample size, and BOTH counts are required fields', async () => {
  const { io, recorded } = ioOf(baseFixture(1, 150_000n));
  await evaluateBreaker(io, policyWith(20));
  expect(recorded.events).toHaveLength(1);
  const payload = recorded.events[0]?.payload ?? {};
  expect(recorded.events[0]?.name).toBe('breaker.state_changed');
  expect(payload['to_state']).toBe('insufficient_data');
  expect(payload['from_state']).toBeNull();
  expect(payload['sample_size']).toBe(1);
  expect(payload['min_sample']).toBe(20);
});

test('3.6 sample_size is the PURCHASE count and NEVER the settled-payout count', () => {
  // ADR-167 section 5: "a row whose `sample_size` held the settled-payout count
  // would satisfy every CHECK in 0016 and describe the wrong population, and no
  // gate in this repository can see which count an integer is." So the gate is
  // here. Seven purchases, one payout: a `sample_size` of 1 is the defect.
  const fold = foldWindow(
    Array.from({ length: 7 }, (_unused, index) => purchase(`p-${String(index)}`, 100n)),
    [settledPayout('r-1', 50n)],
  );
  expect(fold.sampleSize).toBe(7);
  expect(fold.settledPayoutCount).toBe(1);
  expect(fold.sampleSize).not.toBe(fold.settledPayoutCount);
});

test('3.7 the SECOND OQ-M6-02 term lives in the evaluator and never in a column', async () => {
  // Above the purchase floor, below the settled-payout floor.
  const fold = foldOf(25, 150_000n, 9_900n);
  const outcome = decideState({
    fold: { ...fold, settledPayoutCount: 1 },
    ratioBp: 151_515,
    policy: { ...RESOLVED, minSample: 20, minSettledPayouts: 3 },
  });
  expect(outcome.state).toBe('insufficient_data');
  expect(outcome.floor).toBe('settled_payouts');

  const { io, recorded } = ioOf(baseFixture(25, 150_000n));
  await evaluateBreaker(io, policyWith(20, 3));
  const values = recorded.inserts[0]?.values ?? {};
  // The row records the term it CAN hold and does not smuggle the other in.
  expect(values['minSample']).toBe(20);
  expect(Object.keys(values)).not.toContain('minSettledPayouts');
  expect(values['state']).toBe('insufficient_data');
});

test('3.8 an unstated second term is NOT APPLIED and the decision says so', async () => {
  const { io } = ioOf(baseFixture(25, 150_000n));
  const report = await evaluateBreaker(io, policyWith(20));
  expect(report.decisions[0]?.floors).toEqual({ minSample: 20, minSettledPayouts: null });
  expect(report.decisions[0]?.state).toBe('paused');
});

// =============================================================================
// 4. The arithmetic. bigint from the port to the row, and one exact division
// =============================================================================

test('4.1 the ratio is exact integer division and rounds DOWN', () => {
  // 9999 / 10000 of a basis point below the next integer.
  expect(lossRatioBp(foldOf(1, 59_999n, 100_000n))).toBe(5999);
  expect(lossRatioBp(foldOf(1, 6_000n, 10_000n))).toBe(6000);
  expect(lossRatioBp(foldOf(1, 1n, 3n))).toBe(3333);
});

test('4.2 rounding down cannot manufacture a pause at the threshold boundary', () => {
  // A true ratio of 5999.99bp floors to 5999 and does not pause. Rounding up
  // would have paused a plan on a ratio the cents do not support.
  const justUnder = foldOf(25, 599_999n, 1_000_000n);
  expect(lossRatioBp(justUnder)).toBe(5999);
  expect(decideState({ fold: justUnder, ratioBp: 5999, policy: RESOLVED }).state).toBe('armed');
});

test('4.3 a zero denominator is NULL and never zero, and it is insufficient_data', () => {
  const noFees = foldOf(25, 150_000n, 0n);
  expect(lossRatioBp(noFees)).toBeNull();
  const outcome = decideState({ fold: noFees, ratioBp: null, policy: RESOLVED });
  expect(outcome.state).toBe('insufficient_data');
  expect(outcome.floor).toBe('no_denominator');
  expect(salesPaused(outcome.state)).toBe(false);
});

test('4.4 a `number` in a cents column is REFUSED BY NAME rather than converted', () => {
  expect(() => foldWindow([{ ...purchase('p-1', 1n), amountPaidCents: 9_900 }], [])).toThrow(
    BreakerRowError,
  );
  expect(() => foldWindow([], [{ ...settledPayout('r-1', 1n), approvedCents: 1.5 }])).toThrow(
    /expected a bigint/,
  );
});

test('4.5 cents past MAX_SAFE_INTEGER fold exactly, which a number could not have', () => {
  const big = 9_007_199_254_740_993n; // Number(this) is 9007199254740992.
  const fold = foldWindow([purchase('p-1', big)], [settledPayout('r-1', big)]);
  expect(fold.denominatorCents).toBe(big);
  expect(fold.numeratorCents).toBe(big);
  expect(lossRatioBp(fold)).toBe(10_000);
});

test('4.6 the row carries bigint cents and integer bp, and no float anywhere', async () => {
  const { io, recorded } = ioOf(baseFixture(25, 150_000n));
  await evaluateBreaker(io, policyWith(20));
  const values = recorded.inserts[0]?.values ?? {};
  expect(typeof values['numeratorCents']).toBe('bigint');
  expect(typeof values['denominatorCents']).toBe('bigint');
  for (const key of ['sampleSize', 'ratioBp', 'thresholdBp', 'minSample'])
    expect(Number.isSafeInteger(values[key]), `${key} is not an integer`).toBe(true);
});

test('4.7 ratio_bp is 0 in the column when there is no ratio, and the decision keeps the null', async () => {
  const { io, recorded } = ioOf({
    plans: [PLAN],
    planVersions: [VERSION],
    purchases: [purchase('p-1', 0n)],
    payoutRequests: [settledPayout('r-1', 10n)],
  });
  const report = await evaluateBreaker(io, policyWith(1));
  expect(report.decisions[0]?.ratioBp).toBeNull();
  expect(recorded.inserts[0]?.values['ratioBp']).toBe(0);
  expect(recorded.inserts[0]?.values['state']).toBe('insufficient_data');
});

test('4.8 the window is an inclusive atLeast term on both tables', async () => {
  const { io, recorded } = ioOf(baseFixture(25, 150_000n), {
    now: new Date('2026-08-28T12:00:00.000Z'),
  });
  await evaluateBreaker(io, policyWith(20));
  const windowed = recorded.reads.filter(
    (read) => 'paidAt' in read.where || 'settledAt' in read.where,
  );
  expect(windowed).toHaveLength(2);
  for (const read of windowed) {
    const term = (read.where['paidAt'] ?? read.where['settledAt']) as BreakerFilterTerm;
    expect(term.term).toBe('at-least');
    expect((term as { value: Date }).value.toISOString()).toBe('2026-07-29T12:00:00.000Z');
  }
});

test('4.9 a row outside the window is not counted, which is what the term is for', async () => {
  const stale = { ...purchase('p-old', 9_900n), paidAt: new Date('2026-01-01T00:00:00.000Z') };
  const { io } = ioOf({
    plans: [PLAN],
    planVersions: [VERSION],
    purchases: [...Array.from({ length: 5 }, (_u, i) => purchase(`p-${String(i)}`, 9_900n)), stale],
    payoutRequests: [],
  });
  const report = await evaluateBreaker(io, policyWith(1));
  expect(report.decisions[0]?.fold.sampleSize).toBe(5);
});

// =============================================================================
// 5. The override, which lapses by being recomputed
// =============================================================================

const OVERRIDE = {
  reason: 'launch week, ratio is one trade',
  expiresAt: new Date('2026-09-01T00:00:00.000Z'),
  changedBy: 'founder',
};

function previousOverridden(expiresAt: Date): PreviousEvaluation {
  return {
    evaluatedOn: '2026-08-27',
    state: 'manually_overridden',
    override: { ...OVERRIDE, expiresAt },
  };
}

test('5.1 a LIVE override is carried forward by the recomputation', () => {
  const now = new Date('2026-08-28T12:00:00.000Z');
  const computed = decideState({
    fold: foldOf(25, 150_000n, 9_900n),
    ratioBp: 151_515,
    policy: RESOLVED,
  });
  expect(computed.state).toBe('paused');
  const settled = applyOverride(
    computed,
    previousOverridden(new Date('2026-09-01T00:00:00.000Z')),
    now,
  );
  expect(settled.state).toBe('manually_overridden');
  expect(settled.override?.changedBy).toBe('founder');
  expect(salesPaused(settled.state)).toBe(false);
});

test('5.2 an EXPIRED override is dropped and falls back to the COMPUTED state, not to armed', () => {
  const now = new Date('2026-08-28T12:00:00.000Z');
  const computed = decideState({
    fold: foldOf(25, 150_000n, 9_900n),
    ratioBp: 151_515,
    policy: RESOLVED,
  });
  const settled = applyOverride(
    computed,
    previousOverridden(new Date('2026-08-27T00:00:00.000Z')),
    now,
  );
  expect(settled.state).toBe('paused');
  expect(settled.override).toBeNull();
});

test('5.3 an override expiring EXACTLY now has expired, because M06 pages on one standing past it', () => {
  const now = new Date('2026-08-28T12:00:00.000Z');
  const computed = decideState({ fold: foldOf(25, 1n, 9_900n), ratioBp: 1, policy: RESOLVED });
  expect(applyOverride(computed, previousOverridden(now), now).state).toBe('armed');
});

test('5.4 the three override columns are written together or all three are null', () => {
  const withOverride = toBreakerStateRow({
    planId: 'plan-1',
    planCode: 'CORE-25K',
    evaluatedOn: '2026-08-28',
    metric: 'loss_ratio_30d',
    fold: foldOf(25, 1n, 2n),
    ratioBp: 5000,
    thresholdBp: 6000,
    minSample: 20,
    state: 'manually_overridden',
    floor: null,
    override: OVERRIDE,
    previousState: 'paused',
    salesPaused: false,
    floors: { minSample: 20, minSettledPayouts: null },
  });
  expect(withOverride['overrideReason']).toBe(OVERRIDE.reason);
  expect(withOverride['overrideExpiresAt']).toBe(OVERRIDE.expiresAt);
  expect(withOverride['changedBy']).toBe('founder');

  const without = toBreakerStateRow({
    planId: 'plan-1',
    planCode: 'CORE-25K',
    evaluatedOn: '2026-08-28',
    metric: 'loss_ratio_30d',
    fold: foldOf(25, 1n, 2n),
    ratioBp: 5000,
    thresholdBp: 6000,
    minSample: 20,
    state: 'armed',
    floor: null,
    override: null,
    previousState: 'armed',
    salesPaused: false,
    floors: { minSample: 20, minSettledPayouts: null },
  });
  expect(without['overrideReason']).toBeNull();
  expect(without['overrideExpiresAt']).toBeNull();
  expect(without['changedBy']).toBeNull();
});

test('5.5 the previous plan-day is read and the state change is measured against it', async () => {
  const { io, recorded } = ioOf({
    ...baseFixture(25, 150_000n),
    planBreakerState: [
      { planId: 'plan-1', evaluatedOn: '2026-08-27', state: 'armed' },
      // A LATER row must not be read as "previous".
      { planId: 'plan-1', evaluatedOn: '2026-08-29', state: 'paused' },
    ],
  });
  const report = await evaluateBreaker(io, policyWith(20));
  expect(report.decisions[0]?.previousState).toBe('armed');
  expect(recorded.events[0]?.payload['from_state']).toBe('armed');
  expect(recorded.events[0]?.payload['to_state']).toBe('paused');
});

test('5.6 no event is emitted when the state did not change', async () => {
  const { io, recorded } = ioOf({
    ...baseFixture(25, 150_000n),
    planBreakerState: [{ planId: 'plan-1', evaluatedOn: '2026-08-27', state: 'paused' }],
  });
  const report = await evaluateBreaker(io, policyWith(20));
  expect(report.eventsEmitted).toBe(0);
  expect(recorded.events).toEqual([]);
  expect(report.rowsWritten).toBe(1);
});

// =============================================================================
// 6. The CUSUM, folded and never stored, absent and never manufactured
// =============================================================================

const SERIES: readonly PassRateDay[] = [
  { tradingDay: '2026-08-24', passes: 5, resolutions: 10 },
  { tradingDay: '2026-08-25', passes: 6, resolutions: 10 },
  { tradingDay: '2026-08-26', passes: 9, resolutions: 10 },
];

test('6.1 ADR-167 clause 5: the CUSUM is ABSENT and is not manufactured', () => {
  expect(UNCALIBRATED_CUSUM.mu0Bp).toBeNull();
  expect(UNCALIBRATED_CUSUM.kBp).toBeNull();
  expect(UNCALIBRATED_CUSUM.alarmBp).toBeNull();
  expect(UNCALIBRATED_CUSUM.blockedOn).toBe('DEP-M6-05');
  expect(cusumOf(SERIES, null)).toBeNull();
});

test('6.2 the recurrence is integer basis points and matches a hand fold', () => {
  // mu_0 = 5000bp, k = 500bp.
  //   day 1: x=5000 -> 0 + (5000-5000-500) = -500 -> floor 0
  //   day 2: x=6000 -> 0 + (6000-5000-500) = 500
  //   day 3: x=9000 -> 500 + (9000-5000-500) = 4000
  const fold = foldCusum(SERIES, { mu0Bp: 5000, kBp: 500, alarmBp: 3000 });
  expect(fold.statisticBp).toBe(4000);
  expect(fold.alarm).toBe(true);
  expect(fold.days).toBe(3);
  expect(Number.isSafeInteger(fold.statisticBp)).toBe(true);
});

test('6.3 the floor at zero holds and a long quiet series cannot go negative', () => {
  const quiet = Array.from({ length: 40 }, (_unused, index) => ({
    tradingDay: `2026-0${String(1 + Math.floor(index / 28))}-${String((index % 28) + 1).padStart(2, '0')}`,
    passes: 1,
    resolutions: 10,
  }));
  const fold = foldCusum(quiet, { mu0Bp: 5000, kBp: 500, alarmBp: 3000 });
  expect(fold.statisticBp).toBe(0);
  expect(fold.alarm).toBe(false);
});

test('6.4 an unordered series is REFUSED rather than sorted', () => {
  expect(() =>
    foldCusum([SERIES[1], SERIES[0], SERIES[2]] as PassRateDay[], {
      mu0Bp: 5000,
      kBp: 500,
      alarmBp: 3000,
    }),
  ).toThrow(BreakerRowError);
});

test('6.5 a non-integer parameter is refused, which is ADR-167 clause 4 made mechanical', () => {
  expect(() => foldCusum(SERIES, { mu0Bp: 5000.5, kBp: 500, alarmBp: 3000 })).toThrow(
    /integer in basis points/,
  );
  expect(() => foldCusum(SERIES, { mu0Bp: 5000, kBp: 250.5, alarmBp: 3000 })).toThrow(
    BreakerRowError,
  );
});

test('6.6 the one division truncates DOWNWARD, toward a smaller statistic', () => {
  // 2/3 is 6666.66..bp and becomes 6666, never 6667.
  expect(passRateBp({ tradingDay: '2026-08-24', passes: 2, resolutions: 3 })).toBe(6666);
  // A day with no resolutions has no rate, and zero would be a perfect failure.
  expect(passRateBp({ tradingDay: '2026-08-24', passes: 0, resolutions: 0 })).toBeNull();
});

test('6.7 a day with no resolutions is skipped and does not move the statistic', () => {
  // The same three rates as SERIES with a market holiday between the first and
  // the second: no resolutions, so no x_t, so nothing to add.
  const withGap: readonly PassRateDay[] = [
    { tradingDay: '2026-08-24', passes: 5, resolutions: 10 },
    { tradingDay: '2026-08-25', passes: 0, resolutions: 0 },
    { tradingDay: '2026-08-26', passes: 6, resolutions: 10 },
    { tradingDay: '2026-08-27', passes: 9, resolutions: 10 },
  ];
  const fold = foldCusum(withGap, { mu0Bp: 5000, kBp: 500, alarmBp: 3000 });
  expect(fold.statisticBp).toBe(4000);
  expect(fold.days).toBe(3);
});

test('6.8 ADR-167 clause 3: no CUSUM value reaches the state, and there is no path', () => {
  // The statistic is not an input to the ladder, and the ladder's input type
  // has nowhere to put one. A source sweep is what catches an edit that adds a
  // call, because a call that type-checks is invisible to `tsc`.
  const stripped = code(EVALUATE_SOURCE);
  const ladder =
    /export function decideState\(input: StateInput\)[\s\S]*?\n}/.exec(stripped)?.[0] ?? '';
  expect(ladder).not.toBe('');
  for (const forbidden of ['cusum', 'Cusum', 'statisticBp', 'alarm'])
    expect(ladder.includes(forbidden), `decideState reads ${forbidden}`).toBe(false);
});

test('6.9 no CUSUM value is written into any plan_breaker_state column', async () => {
  const { io, recorded } = ioOf(baseFixture(25, 150_000n));
  await evaluateBreaker(io, policyWith(20));
  const keys = Object.keys(recorded.inserts[0]?.values ?? {});
  expect(keys.some((key) => key.toLowerCase().includes('cusum'))).toBe(false);
  expect(keys.some((key) => key.toLowerCase().includes('statistic'))).toBe(false);
});

// =============================================================================
// 7. The policy. OQ-M6-02 is the founder's, so the shipped policy DECLINES
// =============================================================================

test('7.1 both OQ-M6-02 terms are STILL unstated, so nobody quietly filled one in', () => {
  expect(LOSS_RATIO_POLICY.minSample.state).toBe('unstated');
  expect(LOSS_RATIO_POLICY.minSample.value).toBeNull();
  expect(LOSS_RATIO_POLICY.minSettledPayouts.state).toBe('unstated');
  expect(LOSS_RATIO_POLICY.minSettledPayouts.value).toBeNull();
  expect(LOSS_RATIO_POLICY.minSample.cite).toContain('OQ-M6-02');
});

test('7.2 the shipped policy DECLINES rather than running on an invented floor', async () => {
  expect(() => resolvePolicy()).toThrow(BreakerDeclined);
  await expect(evaluateBreaker(ioOf(baseFixture(25, 1n)).io)).rejects.toThrow(BreakerDeclined);
  expect(() => resolvePolicy()).toThrow(/OQ-M6-02/);
});

test('7.3 an unstated SECOND term does not decline, because it has no column to fill', () => {
  const resolved = resolvePolicy(policyWith(20));
  expect(resolved.minSample).toBe(20);
  expect(resolved.minSettledPayouts).toBeNull();
});

test('7.4 the unwired port refuses on every method rather than returning a plausible value', async () => {
  await expect(UNWIRED_BREAKER_IO.transact(() => Promise.resolve(1))).rejects.toThrow(
    BreakerUnwired,
  );
  expect(() => UNWIRED_BREAKER_IO.now()).toThrow(BreakerUnwired);
  expect(() => UNWIRED_BREAKER_IO.tradingDayOf(new Date())).toThrow(BreakerUnwired);
  expect(() => UNWIRED_BREAKER_IO.terms.atLeast(1)).toThrow(BreakerUnwired);
  expect(() => UNWIRED_BREAKER_IO.terms.atMost(1)).toThrow(BreakerUnwired);
});

test('7.5 neither module reaches for a door P7 rule 10 forecloses', () => {
  // Swept over CODE and not over the file: both headers QUOTE the grep that
  // ADR-165 states the one-door rule in terms of, so a sweep over the prose
  // would be red on the sentence that explains why it is green.
  for (const source of [code(PORTS_SOURCE), code(EVALUATE_SOURCE)]) {
    expect(source).not.toContain("from 'pg'");
    expect(source).not.toContain("from '@merit/db'");
    expect(source).not.toContain('SqlExecutorReason');
    expect(source).not.toContain('sqlExecutor');
  }
});

// =============================================================================
// 8. The barrel, which is P7 section 9's largest collision
// =============================================================================

test('8.1 every leg of the barrel is still re-exported, so a keep-both merge cannot drop one', () => {
  // P7 section 9: "SEVEN SLICES ON ONE HAND-MAINTAINED BARREL, and it is the
  // largest collision in this phase ... A keep-both merge of a re-export list
  // type-checks and drops nothing, which is what makes it easy to miss rather
  // than safe." A TYPE CHECKER CANNOT SEE AN EXPORT THAT IS SIMPLY GONE, so the
  // legs are counted here instead.
  const legs = [...BARREL.matchAll(/from '(\.\/[a-z-]+\/[a-z-]+\.ts)'/g)].map((match) => match[1]);
  for (const leg of [
    './batch/nightly.ts',
    './batch/ports.ts',
    './batch/replay.ts',
    './batch/state-hash.ts',
    './provisioning/index.ts',
    './sweeps/expiry.ts',
    './sweeps/ports.ts',
    './live/ingest.ts',
    './live/ports.ts',
    './detectors/ports.ts',
    './detectors/canary.ts',
    './detectors/runner.ts',
    './detectors/fills.ts',
    './detectors/graph.ts',
    './detectors/identity.ts',
    './breaker/ports.ts',
    './breaker/evaluate.ts',
    // P7-l, session 323. THIS COUNT IS WHY THE BARREL NOW CARRIES ITS LEGS AS
    // DATA: every barrel slice after this one must edit a literal in a file it
    // does not own, which is the hand-maintained count in a different costume
    // that RI-05's own header warns about. `WORKER_BARREL_LEGS` in
    // `src/index.ts` is the same list as data and `test/digests.test.ts` checks
    // it in both directions and sweeps `src/` for a module in neither. This
    // enumeration is kept because two independent lists that must agree is a
    // stronger check than one, not because it is the only one.
    './digests/ports.ts',
    './digests/rows.ts',
    './digests/alarm.ts',
    './digests/produce.ts',
    // P7-m, session 328, AND THE PARAGRAPH ABOVE PREDICTED THIS EDIT EXACTLY:
    // "every barrel slice after this one must edit a literal in a file it does
    // not own". `P7` section 8 gives that slice `src/integrations/loops.ts`,
    // `test/integrations-loops.test.ts` and `src/index.ts` and does NOT give it
    // this file, so these two lines are the whole of what it changed here and
    // its log reports them as reached for rather than assigned.
    //
    // THE ALTERNATIVE WAS TO PUT THE MODULE IN `WORKER_MODULES_NOT_RE_EXPORTED`
    // AND STAY INSIDE THE ROW'S FILE LIST, WHICH WOULD HAVE LEFT THIS COUNT AT
    // 21 BY SHIPPING A BARREL THAT DOES NOT CARRY THE SLICE. That is choosing a
    // weaker artifact to avoid a two-line edit, which is the move `P7` section
    // 11 rule 16 puts beside weakening a gate.
    './integrations/loops.ts',
    // `B5` term 1, session 395, AND THE PARAGRAPH TWENTY LINES UP PREDICTED THIS
    // EDIT FOR THE THIRD TIME. That slice's fence is `apps/worker/**` and its
    // suites, so this file is inside it and the line is assigned rather than
    // reached for; the count below is the whole of the rest of the change.
    './batch/state-writer.ts',
    // ADR-239 slice B, session 431. The `BatchPorts` value, over Postgres. That
    // row's fence is `apps/worker/**` and its suites, so this file is inside it
    // and the line is assigned rather than reached for.
    './batch/adapter.ts',
    // ADR-305 section 7 slice 6, session 511. `ExpiryLedgerPort` over
    // `@merit/ledger`, and the fourth time the paragraph forty lines up has
    // predicted this edit. That row's fence carries `apps/worker/test/**`, so
    // this file is inside it and the line is assigned rather than reached for.
    './sweeps/ledger.ts',
    // ADR-305 section 7 slice 7, session 516, AND THE FIFTH TIME THE PARAGRAPH
    // ABOVE HAS PREDICTED THIS EDIT. The `LT-06` withdrawal-approval driver and
    // its port. That row's fence carries `apps/worker/test/**`, so this file is
    // inside it and the two lines are assigned rather than reached for.
    './withdrawals/approval-sweep.ts',
    './withdrawals/ports.ts',
    // ADR-344, session 530, AND THE SIXTH TIME THE PARAGRAPH ABOVE HAS
    // PREDICTED THIS EDIT. The hourly expiry sweep's adapter: four of that
    // job's five ports over this deployable's own doors, with the event sink
    // taken as a required argument because nothing in this repository can be
    // passed for it. That row's fence carries `apps/worker/test/**`, so this
    // file is inside it and the line is assigned rather than reached for.
    './sweeps/expiry-adapter.ts',
    // ADR-350, session 535, AND THE SEVENTH TIME THE PARAGRAPH ABOVE HAS
    // PREDICTED THIS EDIT, WHICH IS THE SECOND TIME IT HAS DONE SO FOR THE SAME
    // MERGE. M12's statistics run gets its `StatisticsPorts` value, which is
    // `./batch/adapter.ts`'s shape one statistic over. That row's fence carries
    // `apps/worker/**` and its suites, so this file is inside it and the line is
    // assigned rather than reached for.
    './batch/statistics-adapter.ts',
    // ADR-349, session 543, AND THE SEVENTH TIME THE PARAGRAPH ABOVE HAS
    // PREDICTED THIS EDIT. The detector runner's adapter: four of that job's
    // five ports over the same doors, with the event sink REFUSING rather than
    // taken as an argument, because two of the three names it would carry would
    // be refused by the producer one deployable over even if a sink were
    // reachable. That row's fence carries `apps/worker/test/**`, so this file is
    // inside it and the line is assigned rather than reached for.
    './detectors/adapter.ts',
    // ADR-345, session 536, AND THE SEVENTH TIME, ARRIVING IN THE SAME WAVE AS
    // THE SIXTH. The reconciliation sweep's adapter over `WorkerDb`. Both rows
    // wrote the line above their own and both typed 30; the count below is
    // derived at this merge instead. Its two neighbours `./recon/ports.ts` and
    // `./recon/sweep.ts` are matched by the regex above and were never
    // enumerated here, which is session 387's choice and not a gap this row
    // repairs.
    './recon/adapter.ts',
    // ADR-354, session 549, AND THE EIGHTH TIME THE PARAGRAPH FORTY LINES UP HAS
    // PREDICTED THIS EDIT. The scheduled digest producer's adapter: four of
    // `DigestIo`'s six members over this deployable's own door and clock, with
    // `content` and `transport` refusing and their blockers carried as DATA
    // rather than as prose. That row's fence carries `apps/worker/test/**`, so
    // this file is inside it and the line is assigned rather than reached for.
    './digests/adapter.ts',
  ])
    expect(legs, `${leg} is no longer re-exported by the barrel`).toContain(leg);
  // 33 SINCE FOUR CONCURRENT ROWS LANDED IN ONE WAVE, adding
  // `./sweeps/expiry-adapter.ts` (ADR-344), `./batch/statistics-adapter.ts`
  // (ADR-350), `./detectors/adapter.ts` (ADR-349) and `./recon/adapter.ts`
  // (ADR-345). **EACH OF THE FOUR TYPED A NUMBER ONE OR TWO SHORT AND NONE OF
  // THEM COULD SEE THE OTHERS**: 344 wrote 30, and 350, 349 and 345 each wrote
  // 31 counting only its own leg on top of 344's. That is this literal's whole
  // purpose arriving four times at once: a keep-both merge of the enumerations
  // type-checks and leaves the total short, so the merge that keeps every leg is
  // the merge that has to COUNT them. The number below is what the assertion
  // reported with all four legs present, not what any branch predicted. It was
  // 29 from session 516, which added
  // `./withdrawals/approval-sweep.ts` AND
  // `./withdrawals/ports.ts`, 27 from session 511, which added
  // `./sweeps/ledger.ts`, 26 from session 431, which added `./batch/adapter.ts`,
  // 25 from session 395, which added `./batch/state-writer.ts`, and 24 from
  // session 387, which added `./recon/ports.ts` and `./recon/sweep.ts`. The
  // number is here rather than
  // derived so that a leg DISAPPEARING is a failure and not a smaller list
  // nobody counted.
  //
  // **THIS COUNT IS OVER LEGS WITH A DIRECTORY SEGMENT AND NOT OVER THE BARREL,
  // STATED SO THE NEXT READER DOES NOT CALL THE DIFFERENCE A DROPPED LEG.** The
  // pattern above requires one, and TWO legs sit at the top of `src/` and are
  // therefore invisible to it: `./job.ts` (session 431), because it is the
  // deployable's one job rather than one module of a subsystem, and
  // `./schedule.ts` (ADR-305 section 7 slice 8, session 517), which registers
  // every job entry point this deployable has built and is deployable-level for
  // the same reason. **THIS PARAGRAPH READ "IT COUNTS 29 OF THE BARREL'S 30
  // LEGS" AND THE SECOND NUMBER WENT STALE THE MOMENT A LEG LANDED**, which is
  // exactly the failure ADR-326 was dispatched over, so the total is now named
  // by its source rather than typed: `WORKER_BARREL_LEGS` is the list and
  // `test/digests.test.ts` case 9.1 counts BOTH top-level legs over it, with no
  // path shape in its regex. They are guarded there and not here.
  // **34 SINCE ADR-354 ADDED `./digests/adapter.ts`, AND THE NUMBER IS WHAT THE
  // ASSERTION REPORTED WITH THE LEG PRESENT RATHER THAN 33 PLUS ONE.** The
  // paragraph above records four concurrent rows each typing a number one or two
  // short in a single wave, so this row COUNTED instead of subtracting: the
  // regex above was run over `src/index.ts` as it stands and printed 34.
  // **TWO SIBLING ROWS ARE ADDING A LEG EACH ON BRANCHES THIS ONE CANNOT SEE**
  // (`352`, the breaker evaluator's io, and `353`, the digest alarm's), so the
  // merge that keeps every leg is again the merge that has to count them, and 35
  // or 36 on a merged head is this literal working rather than this row being
  // wrong.
  expect(new Set(legs).size).toBe(34);
});
