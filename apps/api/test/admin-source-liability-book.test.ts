// =============================================================================
// apps/api/test/admin-source-liability-book.test.ts
// =============================================================================
// `readLiabilityBook`, WHICH IS THE LEAVES OF `LiabilityResponse` THIS ESTATE
// CAN PRODUCE AND IS NOT `AdminReadSource.readLiability`.
//
// NO NUMERAL STANDS HERE, on `admin-source/index.ts`'s own stated reason and
// because this header carried 28 against a module that produced 27. The count
// is DERIVED by the last describe block in this file and by nothing else.
//
// THE LAST CASE IS THE ONE THIS FILE EXISTS FOR AND IT IS ARITHMETIC RATHER
// THAN PROSE. It reads `LiabilityResponse`'s field paths out of API_CONTRACT
// through `RI-18`'s own `copiesOf`, folds them to LEAVES, runs the reader over a
// fixture, and asserts that the leaves the reader produced plus the twelve
// leaves the blockers hold are EXACTLY the contract's leaves. So the
// measurement is a subtraction the suite performs rather than a number a session
// wrote down, and the day a blocker lifts the arithmetic is what says so.
//
// `test/admin-source-liability.test.ts` IS THE OTHER HALF AND THEY ARE NOT ONE
// FILE. That one is the suite of an ABSENCE, on session 349's precedent: every
// case is a live read of the tree with a stated clearing condition and none of
// them imports this module. This one is the suite of a MODULE, on the shape
// `admin-source-flags.test.ts` and `admin-source-search.test.ts` use: doubles
// for the accessor, one case per refusal, and the cost object asserted rather
// than logged.
//
// THE DOUBLE HAS `rows` AND `rowsWhere` AND NO `rowAt`, WHICH IS `LiabilityTx`
// AND IS THE POINT OF THAT INTERFACE. The one address this module would take is
// the treasury anchor, and `scoped-db.ts`'s `refuseUnaddressed` refuses it:
// `0009` gives `treasury_balances` `PRIMARY KEY (account_code, as_of)` and
// `schema.ts` declares no unique key at all, so `rowAt` throws on a predicate
// the database would have honoured. A double carrying `rowAt` would let this
// suite pass over a call the real accessor rejects.
// =============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TABLE_KEYS } from '@merit/db';

import {
  ELIGIBLE_HORIZON_TRADING_DAYS,
  LIABILITY_READ_TABLES,
  readLiabilityBook,
  readTradingHorizon,
} from '../src/admin-source/liability.ts';
import { evaluatePayoutVelocity } from '../src/admin-source/payout-velocity.ts';
import { AdminReadError, assertLiabilityGapsPaired } from '../src/routes/admin-reads.ts';
import type {
  LiabilityBook,
  LiabilityReadTable,
  LiabilityTx,
  TradingHorizon,
} from '../src/admin-source/liability.ts';
import type { LiabilityResponse } from '../src/routes/admin-reads.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');

// -----------------------------------------------------------------------------
// The double
// -----------------------------------------------------------------------------

type Rows = Partial<Record<LiabilityReadTable, readonly unknown[]>>;

interface Recorded {
  readonly key: LiabilityReadTable;
  readonly where?: Readonly<Record<string, unknown>>;
}

/**
 * A handle that answers from a table of rows and RECORDS EVERY CALL.
 *
 * The recording is what lets a case assert which tables were read and with what
 * predicate, which is the half a returned value cannot show: a module that read
 * the whole `events` table and filtered in memory would produce the same answer
 * as one that filtered at the accessor, and only one of the two is the read this
 * module claims to make.
 */
function handle(rows: Rows): { tx: LiabilityTx; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const tx: LiabilityTx = {
    rows: async (key) => {
      calls.push({ key });
      return [...(rows[key] ?? [])];
    },
    rowsWhere: async (key, where) => {
      calls.push({ key, where });
      const all = [...(rows[key] ?? [])];
      return all.filter((row) =>
        Object.entries(where).every(([property, value]) => {
          const held = (row as Record<string, unknown>)[property];
          return held instanceof Date && value instanceof Date
            ? held.getTime() === value.getTime()
            : held === value;
        }),
      );
    },
  };
  return { tx, calls };
}

const AS_OF = new Date('2026-08-27T23:00:00.000Z');
const RESERVE_AS_OF = new Date('2026-08-28T04:15:00.000Z');
const ANCHOR_AS_OF = new Date('2026-08-28T04:00:00.000Z');

const SNAPSHOT = {
  id: 1n,
  asOf: AS_OF,
  openLiabilityCents: 412_500_00n,
  boundedNearTermCents: 98_250_00n,
  remainingLadderExposureCents: 1_875_000_00n,
  walletBalancesCents: 61_400_00n,
  // SIGNED, AND NEGATIVE IN THIS FIXTURE ON PURPOSE. ADR-188 clause 1 and
  // session 363's two typed fixtures: a reader that clamps it at zero reports
  // an absorbed correction as none, and a positive fixture cannot tell.
  absorbedCorrectionsCents: -3_125_00n,
  fundedAccounts: 1_284,
  computedAt: AS_OF,
};

const RESERVE = {
  id: 1n,
  asOf: RESERVE_AS_OF,
  reserveCents: 2_400_000_00n,
  treasuryAccountCode: 'RESERVE-C1',
  treasuryAsOf: ANCHOR_AS_OF,
  cvar99Cents: 2_000_000_00n,
  rcrBp: 12_000,
  createdAt: RESERVE_AS_OF,
};

const ANCHOR = {
  accountCode: 'RESERVE-C1',
  asOf: ANCHOR_AS_OF,
  balanceCents: 2_400_000_00n,
  source: 'provider_api',
  recordedBy: null,
  recordedAt: ANCHOR_AS_OF,
};

const PLANS = [
  { id: '11111111-1111-4111-8111-111111111111', code: 'MERIT-50K' },
  { id: '22222222-2222-4222-8222-222222222222', code: 'MERIT-100K' },
];

const BREAKER = [
  {
    planId: PLANS[0]?.id,
    evaluatedOn: '2026-08-26',
    metric: 'loss_ratio',
    ratioBp: 4_100,
    thresholdBp: 6_000,
    state: 'armed',
  },
  {
    planId: PLANS[0]?.id,
    evaluatedOn: '2026-08-27',
    metric: 'loss_ratio',
    ratioBp: 6_450,
    thresholdBp: 6_000,
    state: 'paused',
  },
  {
    planId: PLANS[1]?.id,
    evaluatedOn: '2026-08-27',
    metric: 'loss_ratio',
    ratioBp: 900,
    thresholdBp: 6_000,
    state: 'insufficient_data',
  },
];

const MID_HEALTH = [
  {
    psp: 'psp_b',
    windowEnd: new Date('2026-08-27T00:00:00.000Z'),
    declineRateBp: 900,
    chargebackRateBp: 40,
    state: 'degraded',
  },
  {
    psp: 'psp_b',
    windowEnd: new Date('2026-08-28T00:00:00.000Z'),
    declineRateBp: 610,
    chargebackRateBp: 22,
    state: 'healthy',
  },
  {
    psp: 'psp_a',
    windowEnd: new Date('2026-08-28T00:00:00.000Z'),
    declineRateBp: 1_400,
    chargebackRateBp: 71,
    state: 'degraded',
  },
];

const RECONCILIATIONS = [
  { id: 1n, status: 'mismatch' },
  { id: 2n, status: 'match' },
  { id: 3n, status: 'mismatch' },
  { id: 4n, status: 'resolved' },
];

/**
 * `reconciliation_runs`, AND THE FIXTURE IS THE ASSERTION.
 *
 * FOUR ROWS AND ONLY TWO OF THEM MAY DATE THE PANEL. A `running` row and a
 * `failed` row both sit LATER than the newest completed one, so a reader that
 * folded `max(started_at)` over the table would return `2026-08-28T05:40` --
 * the sweep that is still running -- and a reader that dropped the predicate
 * only from the `failed` case would return `2026-08-28T05:12`. Both are runs
 * `reconciliation_runs_completed_is_whole` exists to keep off this clock, and a
 * fixture holding only completed rows cannot tell any of the three readers
 * apart.
 *
 * THE COUNTERS ARE THE CONSTRAINT'S AND NOT DECORATION. `accounts_done =
 * accounts_total` on both completed rows, `accounts_done < accounts_total` on
 * the failed one: that is `reconciliation_runs_completed_is_whole` and
 * `reconciliation_runs_done_within_total` satisfied by the shape rather than by
 * assertion, so this fixture is a set of rows the live table would accept.
 */
const RECON_RUNS = [
  {
    id: 'run-a',
    batchRunId: '2b2f6f4c-0000-4000-8000-00000000000a',
    tradingDay: '2026-08-26',
    startedAt: new Date('2026-08-27T05:08:00.000Z'),
    finishedAt: new Date('2026-08-27T05:19:00.000Z'),
    accountsTotal: 4_812,
    accountsDone: 4_812,
    mismatchesFound: 0,
    status: 'completed',
  },
  {
    id: 'run-b',
    batchRunId: '2b2f6f4c-0000-4000-8000-00000000000b',
    tradingDay: '2026-08-27',
    startedAt: new Date('2026-08-28T05:04:00.000Z'),
    finishedAt: new Date('2026-08-28T05:21:00.000Z'),
    accountsTotal: 4_836,
    accountsDone: 4_836,
    mismatchesFound: 2,
    status: 'completed',
  },
  {
    id: 'run-c',
    batchRunId: '2b2f6f4c-0000-4000-8000-00000000000c',
    tradingDay: '2026-08-27',
    startedAt: new Date('2026-08-28T05:12:00.000Z'),
    finishedAt: new Date('2026-08-28T05:13:00.000Z'),
    accountsTotal: 4_836,
    accountsDone: 311,
    mismatchesFound: 0,
    status: 'failed',
  },
  {
    id: 'run-d',
    batchRunId: '2b2f6f4c-0000-4000-8000-00000000000d',
    tradingDay: '2026-08-28',
    startedAt: new Date('2026-08-28T05:40:00.000Z'),
    finishedAt: null,
    accountsTotal: 4_840,
    accountsDone: 96,
    mismatchesFound: 0,
    status: 'running',
  },
];

const BATCH_EVENTS = [
  {
    id: 10n,
    eventName: 'batch.completed',
    occurredAt: new Date('2026-08-27T06:12:00.000Z'),
    payload: { run_id: 'r-1', trading_day: '2026-08-26', duration_ms: 411_000 },
  },
  {
    id: 11n,
    eventName: 'batch.completed',
    occurredAt: new Date('2026-08-28T06:04:00.000Z'),
    payload: { run_id: 'r-2', trading_day: '2026-08-27', duration_ms: 388_412 },
  },
];

function estate(overrides: Rows = {}): Rows {
  return {
    liabilitySnapshots: [SNAPSHOT],
    reserveCoverageSnapshots: [RESERVE],
    treasuryBalances: [ANCHOR],
    planBreakerState: BREAKER,
    plans: PLANS,
    midHealth: MID_HEALTH,
    reconciliations: RECONCILIATIONS,
    reconciliationRuns: RECON_RUNS,
    events: BATCH_EVENTS,
    ...overrides,
  };
}

/**
 * Every weekday between two days inclusive, as `YYYY-MM-DD`.
 *
 * A WEEKEND EVERY FIVE DAYS IS THE POINT AND NOT A CONVENIENCE. `ADR-201`'s
 * window is thirty TRADING days and `M01` R-02 forbids date arithmetic, so a
 * fixture of consecutive calendar dates would let a walk that added days pass
 * every case below.
 */
function weekdays(from: string, to: string): readonly string[] {
  const days: string[] = [];
  const last = Date.parse(`${to}T00:00:00.000Z`);
  for (let at = Date.parse(`${from}T00:00:00.000Z`); at <= last; at += 86_400_000) {
    const date = new Date(at);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6)
      days.push(date.toISOString().slice(0, 10));
  }
  return days;
}

/**
 * Every weekday from June through the BOOK'S OWN ANCHOR DAY, which is what makes
 * `payout_velocity` answerable at all on this estate.
 *
 * THE ANCHOR IS THE SNAPSHOT'S `as_of` AND NOT `now`. {@link AS_OF} is 23:00Z on
 * `2026-08-27` and every session here closes at 22:00Z, so `2026-08-27` is the
 * last CLOSED day and the thirty-day window is the thirty weekdays before it.
 * `INV-M6-04` is why the book anchors there: a ratio computed to a different
 * moment from the book beside it is two clocks under one heading.
 */
const VELOCITY_DAYS = weekdays('2026-06-01', '2026-08-27');

/**
 * A covered calendar and one settled transfer of the SAME cents on every day of
 * it, which is `ADR-201`'s steady state by construction.
 *
 * THE ARITHMETIC'S HOME IS `payout-velocity.test.ts` AND NOT THIS FILE. What is
 * asserted here is that the evaluator's answer reaches the BOOK: the panel where
 * a verdict exists, a `null` and a paired gap where one does not. The one number
 * this file pins is the steady-state ratio, because a book that wired the arms
 * up backwards would still produce four integers.
 */
const COVERED_CALENDAR: Rows = {
  tradingCalendar: VELOCITY_DAYS.map((day) => session(day)),
  tradingCalendarLoads: [
    {
      id: 9n,
      sourceId: 'cme-2026-q3',
      coverageStartDay: '2026-06-01',
      coverageEndDay: '2026-09-30',
      sourceDigest: Buffer.alloc(32, 9),
      actor: 'session-390',
    },
  ],
  payoutTransfers: VELOCITY_DAYS.map((day) => ({
    amountCents: 100_000_00n,
    status: 'settled',
    settledAt: new Date(`${day}T18:00:00.000Z`),
  })),
};

async function read(overrides: Rows = {}) {
  const { tx, calls } = handle(estate(overrides));
  // THE REAL EVALUATOR AND NEVER A DOUBLE. `readLiabilityBook` takes the
  // velocity arm as a port because a value import of that module closes an ESM
  // cycle, and a suite that passed a stub here would be measuring the port
  // rather than the book: the arms this file exists to check are the evaluator's
  // three answers reaching the body.
  const result = await readLiabilityBook(tx, evaluatePayoutVelocity);
  return { result, calls };
}

// -----------------------------------------------------------------------------
// The port
// -----------------------------------------------------------------------------

describe('the tables this module may reach', () => {
  it('names twelve real TableKeys, sorted, and no others', () => {
    for (const key of LIABILITY_READ_TABLES) expect(TABLE_KEYS).toContain(key);
    expect([...LIABILITY_READ_TABLES]).toStrictEqual([...LIABILITY_READ_TABLES].sort());
    expect(LIABILITY_READ_TABLES).toHaveLength(12);
    // `payoutTransfers` IS THE OTHER ONE THIS SESSION ADDED, and `B2` is why:
    // `evaluatePayoutVelocity` is the book's arm now, and its unbounded scan is
    // this table.
    expect([...LIABILITY_READ_TABLES]).toContain('payoutTransfers');
    // `reconciliationRuns` IS THE ONE THIS SESSION ADDED AND `B4` IS WHY. It is
    // `0064`'s table, registered `firm`, and it is a DIFFERENT key from
    // `reconciliations`: the count of open mismatches and the clock of the last
    // completed sweep are two reads of two tables.
    expect([...LIABILITY_READ_TABLES]).toContain('reconciliationRuns');
    expect([...LIABILITY_READ_TABLES]).toContain('reconciliations');
  });

  it('NOW names trading_calendar, which is the whole of what B1 bought', () => {
    // THE SECOND HALF OF THIS CASE IS INVERTED IN THE DIFF THAT SPENT IT, which
    // is the third time this pair has moved and the last time it can. It read
    // `expect(TABLE_KEYS).not.toContain('tradingCalendar')` until session 377,
    // then `expect(LIABILITY_READ_TABLES).not.toContain('tradingCalendar')`
    // until this session. Both are now positive and neither can fire again.
    expect(TABLE_KEYS).toContain('tradingCalendar');
    expect(TABLE_KEYS).toContain('tradingCalendarLoads');
    expect(TABLE_KEYS).toContain('tradingCalendarRevisions');
    expect([...LIABILITY_READ_TABLES]).toContain('tradingCalendar');
    expect([...LIABILITY_READ_TABLES]).toContain('tradingCalendarLoads');

    // AND THE GROUP IS STILL NOT PRODUCED, which is the line that has not moved
    // and is now blocker B5 rather than B1. `readTradingHorizon` produces the
    // seven trading days; the per-account fold over them has no source. A
    // reader of this case alone would otherwise conclude the field had landed.
    expect(BLOCKED_LEAVES).toContain('eligible_next_7d.total_cents');
    expect(BLOCKED_LEAVES.filter((leaf) => leaf.startsWith('eligible_next_7d'))).toHaveLength(5);
  });
});

// -----------------------------------------------------------------------------
// The snapshot
// -----------------------------------------------------------------------------

describe('the seven top-level fields, which are one liability_snapshots row', () => {
  it('answers null when no snapshot has been written, rather than a book of zeros', async () => {
    const { tx } = handle(estate({ liabilitySnapshots: [] }));
    expect(await readLiabilityBook(tx, evaluatePayoutVelocity)).toBeNull();
  });

  it('projects the row column for column, carrying the signed field NEGATIVE', async () => {
    const { result } = await read();
    expect(result?.book.as_of).toBe('2026-08-27T23:00:00.000Z');
    expect(result?.book.open_liability_cents).toBe(41_250_000);
    expect(result?.book.wallet_balances_cents).toBe(6_140_000);
    expect(result?.book.bounded_near_term_cents).toBe(9_825_000);
    expect(result?.book.remaining_ladder_exposure_cents).toBe(187_500_000);
    expect(result?.book.absorbed_corrections_cents).toBe(-312_500);
    expect(result?.book.funded_accounts).toBe(1_284);
  });

  it('sends NO TOTAL, which is ADR-188 clause 3 and is a field that must not appear', async () => {
    const { result } = await read();
    // The panel is the two components summed and the sum belongs to the reader.
    // A member added here would be the one field a client can render alone under
    // the panel's name.
    expect(Object.keys(result?.book ?? {}).filter((name) => name.includes('total'))).toStrictEqual(
      [],
    );
  });

  it('takes the greatest as_of and not the last row the accessor handed back', async () => {
    const older = { ...SNAPSHOT, id: 2n, asOf: new Date('2026-08-20T23:00:00.000Z') };
    const { result } = await read({ liabilitySnapshots: [SNAPSHOT, older] });
    expect(result?.book.as_of).toBe('2026-08-27T23:00:00.000Z');
    const { result: reversed } = await read({ liabilitySnapshots: [older, SNAPSHOT] });
    expect(reversed?.book.as_of).toBe('2026-08-27T23:00:00.000Z');
  });

  it('refuses two rows at one as_of rather than picking by row order', async () => {
    // `liability_snapshots_as_of_uq` says there can be one. Two is the database
    // disagreeing with its own unique index.
    await expect(read({ liabilitySnapshots: [SNAPSHOT, { ...SNAPSHOT, id: 2n }] })).rejects.toThrow(
      AdminReadError,
    );
  });

  it('refuses a cents value past 2^53 rather than rounding it silently', async () => {
    await expect(
      read({ liabilitySnapshots: [{ ...SNAPSHOT, openLiabilityCents: 9_007_199_254_740_993n }] }),
    ).rejects.toThrow(/safe integer number of cents/);
  });
});

// -----------------------------------------------------------------------------
// The reserve
// -----------------------------------------------------------------------------

describe('reserve, which is ADR-188 clause 4 and needed ADR-199 to be readable', () => {
  it('projects the snapshot and its anchor, on the anchor own clock', async () => {
    const { result } = await read();
    expect(result?.book.reserve).toStrictEqual({
      as_of: '2026-08-28T04:15:00.000Z',
      reserve_cents: 240_000_000,
      cvar99_cents: 200_000_000,
      rcr_bp: 12_000,
      breaker_armed: false,
      treasury_account_code: 'RESERVE-C1',
      treasury_as_of: '2026-08-28T04:00:00.000Z',
      treasury_source: 'provider_api',
    });
    // THE TWO CLOCKS ARE TWO CLOCKS, which is `data-model/liability_snapshots.md`'s
    // second reason for two tables. A fixture that repeated the instant could not
    // tell a projection carrying both from one dating the rail with the book.
    expect(result?.book.reserve.as_of).not.toBe(result?.book.as_of);
  });

  it('recomputes breaker_armed as rcr_bp < 10000 on both sides of the threshold', async () => {
    // `0049`'s header: "Armed is `rcr_bp < 10000`", against the GLOSSARY's 1.0.
    // The boundary is the case, because a `<=` here arms the breaker on exactly
    // full coverage.
    const armed = await read({ reserveCoverageSnapshots: [{ ...RESERVE, rcrBp: 9_999 }] });
    expect(armed.result?.book.reserve.breaker_armed).toBe(true);
    const exactly = await read({ reserveCoverageSnapshots: [{ ...RESERVE, rcrBp: 10_000 }] });
    expect(exactly.result?.book.reserve.breaker_armed).toBe(false);
  });

  it('refuses a null rcr_bp, which 0049 produces only past a CHECK that forbids it', async () => {
    await expect(read({ reserveCoverageSnapshots: [{ ...RESERVE, rcrBp: null }] })).rejects.toThrow(
      /CVaR99 nobody computed/,
    );
  });

  it('narrows treasury_source at the reader and refuses a third name', async () => {
    const manual = await read({
      treasuryBalances: [{ ...ANCHOR, source: 'manual_attestation' }],
    });
    expect(manual.result?.book.reserve.treasury_source).toBe('manual_attestation');
    await expect(read({ treasuryBalances: [{ ...ANCHOR, source: 'estimate' }] })).rejects.toThrow(
      /provider_api/,
    );
  });

  it('reads the anchor by EQUALITY on both key halves, never by an address', async () => {
    const { calls } = await read();
    const anchor = calls.find((call) => call.key === 'treasuryBalances');
    expect(anchor?.where).toStrictEqual({ accountCode: 'RESERVE-C1', asOf: ANCHOR_AS_OF });
    // `refuseUnaddressed` names this table as "the only registered table with no
    // addressable key at all", so `rowAt` would throw on the predicate the
    // database would have honoured. `LiabilityTx` has no `rowAt` to reach for.
    expect('rowAt' in (handle({}).tx as object)).toBe(false);
  });

  it('refuses zero anchors and two anchors, which the schema admits neither of', async () => {
    await expect(read({ treasuryBalances: [] })).rejects.toThrow(/ON DELETE RESTRICT/);
    await expect(
      read({ treasuryBalances: [ANCHOR, { ...ANCHOR, balanceCents: 1n }] }),
    ).rejects.toThrow(/PRIMARY KEY/);
  });

  it('refuses a book with no coverage snapshot rather than dropping eight paths', async () => {
    await expect(read({ reserveCoverageSnapshots: [] })).rejects.toThrow(/P-M6-07/);
  });
});

// -----------------------------------------------------------------------------
// per_plan, with the CUSUM rendered ABSENT
// -----------------------------------------------------------------------------

describe('per_plan, which is the loss-ratio breaker and an ABSENT CUSUM', () => {
  it('takes the latest evaluated_on per plan and orders by code', async () => {
    const { result } = await read();
    expect(result?.book.per_plan).toStrictEqual([
      {
        plan_id: PLANS[1]?.id,
        code: 'MERIT-100K',
        loss_ratio_bp: 900,
        threshold_bp: 6_000,
        sales_paused: false,
        cusum: null,
      },
      {
        plan_id: PLANS[0]?.id,
        code: 'MERIT-50K',
        loss_ratio_bp: 6_450,
        threshold_bp: 6_000,
        sales_paused: true,
        cusum: null,
      },
    ]);
  });

  // INVERTED BY THE SESSION THAT SPENT THE CLEARING CONDITION. This case read
  // "carries no cusum member at all, which is blocker B3 rather than an
  // omission" and asserted the KEY was absent from every plan. ADR-202 ruled the
  // form of the absence and ADR-203 transcribed it, so the key is present and
  // carries `null`.
  it('carries cusum as a null on every plan, which is B3 lifted and not the calibration', async () => {
    const { result } = await read();
    const plans = result?.book.per_plan ?? [];
    expect(plans).toHaveLength(2);
    for (const plan of plans) {
      expect('cusum' in plan).toBe(true);
      expect(plan.cusum).toBeNull();
    }
  });

  it('pairs that null with ONE gap naming the path with the index elided', async () => {
    // ADR-203 ruling 2: one entry per absent FIGURE and not one per null value.
    // Two plans are null above and the body carries ONE entry for them, because
    // the absence is a property of the CALIBRATION rather than of a plan. The
    // estate is COVERED here so `payout_velocity` is produced and writes no
    // entry of its own, which is what makes this a count of one.
    const { result } = await read(COVERED_CALENDAR);
    expect(result?.book.gaps).toStrictEqual([
      {
        field: 'per_plan[].cusum',
        cause: 'awaiting_dependency',
        awaiting: 'DEP-M6-05',
        detail: expect.stringContaining('DEP-M6-05') as unknown as string,
      },
    ]);
    // `awaiting` IS NON-NULL EXACTLY WHEN THE CAUSE IS `awaiting_dependency`,
    // which is the one pairing ADR-203 ruling 4 lets a reader rely on.
    expect(result?.book.gaps[0]?.awaiting).not.toBeNull();
    expect(result?.book.gaps[0]?.detail.trim()).not.toBe('');
  });

  it('reads sales_paused as state = paused and never as any other state', async () => {
    // ADR-167 clause 3: `'paused'` is a REVENUE PAUSE and `'manually_overridden'`
    // is an override of the breaker rather than a pause. `'insufficient_data'`
    // is `0016`'s first-class launch-week state and is not a pause either.
    for (const state of ['armed', 'insufficient_data', 'manually_overridden']) {
      const { result } = await read({
        planBreakerState: [{ ...BREAKER[1], state }],
        plans: PLANS,
      });
      expect(result?.book.per_plan[0]?.sales_paused).toBe(false);
    }
  });

  it('is empty when nothing has evaluated a breaker, rather than a row per plan', async () => {
    // `plan_breaker_state` has never held a row (ADR-167 finding 9). A row
    // invented from `plans` alone would put a loss ratio of zero under a breaker
    // nobody ran.
    const { result } = await read({ planBreakerState: [] });
    expect(result?.book.per_plan).toStrictEqual([]);
  });

  it('writes NO cusum gap when there are no plans, which the validator is what decides', async () => {
    // **THE CASE A CONSTANT `CUSUM_GAPS` ARRAY WOULD FAIL, AND IT IS TODAY'S
    // STATE RATHER THAN AN EXOTIC ONE.** `assertLiabilityGapsPaired` builds its
    // absent set with `per_plan.some(...)`, so over an empty array nothing is
    // null and an entry naming `per_plan[].cusum` is a gap over a figure this
    // response is NOT withholding. That is ADR-203 ruling 2's second direction,
    // which the entry itself calls the worse failure, firing on the first read.
    const { result } = await read({ ...COVERED_CALENDAR, planBreakerState: [] });
    expect(result?.book.gaps).toStrictEqual([]);
  });

  it('refuses a breaker row naming a plan no plans row carries', async () => {
    await expect(read({ plans: [PLANS[0]] })).rejects.toThrow(/REFERENCES plans\(id\)/);
  });
});

// -----------------------------------------------------------------------------
// payout_velocity, which is B2 and is the evaluator's THREE answers on a wire
// that carries them
// -----------------------------------------------------------------------------

describe('payout_velocity, produced when the estate can supply the window', () => {
  it('carries the panel and NO gap when the calendar covers thirty trading days', async () => {
    const { result } = await read(COVERED_CALENDAR);
    const panel = result?.book.payout_velocity;
    expect(panel).not.toBeNull();
    // STEADY STATE IS EXACTLY 10000 BASIS POINTS, which is ADR-201 ruling 2's
    // whole claim: the seven-day total against the thirty-day total SCALED to
    // seven days sits at 1.0 when nothing is happening. Against an unscaled
    // thirty-day total it would sit near 2857 and the 2.5x pager would never
    // fire; against a thirty-day DAILY mean it would sit near 70000 and the
    // pager would fire every day forever. The number discriminates all three.
    expect(panel?.ratio_bp).toBe(10_000);
    expect(panel?.alarm).toBe(false);
    expect(panel?.last_7d_cents).toBe(7 * 100_000_00);
    expect(Number.isSafeInteger(panel?.avg_30d_cents)).toBe(true);
    // AND NOTHING IN `gaps` NAMES IT, which is the direction ADR-203 ruling 2
    // calls the worse failure: a gap over a figure an operator is looking at.
    expect(result?.book.gaps.map((gap) => gap.field)).not.toContain('payout_velocity');
  });

  it('declines with `estate_uncovered` when no load covers the anchor day', async () => {
    // THE DEFAULT ESTATE. `trading_calendar_loads` is empty, so ADR-042 F-4's
    // UNKNOWN is the answer rather than a zero: the reader's act is to load a
    // calendar today, which is a different act from waiting.
    const { result } = await read();
    expect(result?.book.payout_velocity).toBeNull();
    const gap = result?.book.gaps.find((entry) => entry.field === 'payout_velocity');
    expect(gap?.cause).toBe('estate_uncovered');
    expect(gap?.awaiting).toBeNull();
    expect(gap?.detail.trim()).not.toBe('');
  });

  it('declines with `insufficient_history` when the calendar is short of the window', async () => {
    // A COVERED CALENDAR THAT DOES NOT REACH BACK FAR ENOUGH, which is the OTHER
    // absence and is a different act by the reader: the estate is correct and
    // young, so waiting is the whole remedy. ADR-203 section 6 keeps the two
    // apart for exactly that reason, and the count of days is in `detail`
    // because a closed vocabulary cannot hold a quantity.
    const short = VELOCITY_DAYS.slice(-12);
    const from = short[0];
    const { result } = await read({
      ...COVERED_CALENDAR,
      tradingCalendar: short.map((day) => session(day)),
      tradingCalendarLoads: [
        {
          id: 9n,
          sourceId: 'cme-2026-short',
          coverageStartDay: from,
          coverageEndDay: '2026-09-30',
          sourceDigest: Buffer.alloc(32, 9),
          actor: 'session-390',
        },
      ],
    });
    expect(result?.book.payout_velocity).toBeNull();
    const gap = result?.book.gaps.find((entry) => entry.field === 'payout_velocity');
    expect(gap?.cause).toBe('insufficient_history');
    expect(gap?.awaiting).toBeNull();
    expect(gap?.detail).toContain('trading days were asked for');
  });

  it('is anchored on the SNAPSHOT clock and not on the wall clock', async () => {
    // A BOOK DATED 2026-08-27 AND A RATIO DATED TODAY WOULD BE TWO MOMENTS UNDER
    // ONE HEADING, which is what INV-M6-04 is written about. The calendar here
    // stops at the snapshot's own day, so a reader anchoring on `now` finds no
    // covered day at all and cannot answer, and one anchoring on the snapshot
    // answers. That difference is the assertion.
    const { result } = await read(COVERED_CALENDAR);
    expect(result?.book.as_of).toBe('2026-08-27T23:00:00.000Z');
    expect(result?.book.payout_velocity).not.toBeNull();
  });
});

// -----------------------------------------------------------------------------
// integrations
// -----------------------------------------------------------------------------

describe('integrations.mid_health, one row per PSP', () => {
  it('takes the latest window per PSP and renders degraded as NOT healthy', async () => {
    const { result } = await read();
    expect(result?.book.integrations.mid_health).toStrictEqual([
      { psp: 'psp_a', decline_rate_bp: 1_400, chargeback_rate_bp: 71, healthy: false },
      { psp: 'psp_b', decline_rate_bp: 610, chargeback_rate_bp: 22, healthy: true },
    ]);
    // `psp_a` and `psp_b` are `purchases_psp_check`'s two names (0006). The
    // fixture speaks the schema's vocabulary rather than a processor's brand,
    // because `mid_health.psp` carries no CHECK and a brand here would be a
    // vocabulary this suite invented.
  });
});

describe('integrations.recon, which is a COUNT and, since B4 lifted, a CLOCK', () => {
  it('counts open mismatches at the accessor rather than in memory', async () => {
    const { result, calls } = await read();
    expect(result?.book.integrations.recon.mismatches_open).toBe(2);
    expect(calls.find((call) => call.key === 'reconciliations')?.where).toStrictEqual({
      status: 'mismatch',
    });
  });

  // INVERTED BY THE SESSION THAT SPENT THE CLEARING CONDITION. This case read
  // "carries no last_run_at, which is blocker B4" and asserted the KEY was
  // absent. B4's condition was "a `recon.completed` event or a run record";
  // `0064` is the record, session 387 wrote its producer, and the reader is this
  // module. A clearing condition fires ONCE and the session that lifts the
  // blocker spends it, which is this file's rule throughout.
  it('dates the panel off the newest COMPLETED run, which is the record half of B4', async () => {
    const { result, calls } = await read();
    expect(result?.book.integrations.recon).toStrictEqual({
      last_run_at: '2026-08-28T05:04:00.000Z',
      mismatches_open: 2,
    });
    // AND THE PREDICATE IS AT THE ACCESSOR, which is the half a returned value
    // cannot show: a module that read every run and filtered in memory answers
    // identically here and scans the whole table on the panel's hot path.
    expect(calls.find((call) => call.key === 'reconciliationRuns')?.where).toStrictEqual({
      status: 'completed',
    });
  });

  it('is NOT max(started_at), which is the run that crashed reporting a success', async () => {
    // THE TWO ROWS THIS CASE EXISTS FOR. `run-d` is `running` and started at
    // 05:40, `run-c` is `failed` at 05:12, and both are LATER than the newest
    // completed run. `reconciliation_runs_completed_is_whole` is the constraint
    // and this is the reader it names: "a reader taking the latest completed run
    // gets a sweep that actually covered the book".
    const { result } = await read();
    const clock = result?.book.integrations.recon.last_run_at;
    expect(clock).not.toBe('2026-08-28T05:40:00.000Z');
    expect(clock).not.toBe('2026-08-28T05:12:00.000Z');
    // NON-VACUITY: the rows really are in the fixture and really are later.
    const later = RECON_RUNS.filter((run) => run.startedAt > new Date('2026-08-28T05:04:00.000Z'));
    expect(later.map((run) => run.status)).toStrictEqual(['failed', 'running']);
  });

  it('takes a TIE on started_at without refusing it, because 0064 declares no unique index', async () => {
    // `latestBy` REFUSES A TIE AND THIS FOLD MUST NOT. That refusal is argued
    // from `liability_snapshots_as_of_uq`; `0064`'s second E2 note rules OUT a
    // unique key here, because RB-02 section A sends a quarantined day to
    // redelivery and a redelivered day is reconciled again. Two completed runs
    // at one instant is a state this schema admits, and the answer is a max over
    // one column rather than a row, so the tie costs nothing.
    const twin = { ...RECON_RUNS[1], id: 'run-b2', tradingDay: '2026-08-26' };
    const { result } = await read({ reconciliationRuns: [...RECON_RUNS, twin] });
    expect(result?.book.integrations.recon.last_run_at).toBe('2026-08-28T05:04:00.000Z');
  });

  it('refuses a book when no run has ever completed, rather than blanking the clock', async () => {
    // `last_run_at` is a required `string` in all three declarations of
    // `LiabilityResponse`, ADR-203 puts an absence at a NULLABLE FIGURE and this
    // member is not one, and ADR-202 ruling 3 refuses a half-null object. So the
    // refusal is the answer, which is `readBatch`'s two lines down.
    await expect(read({ reconciliationRuns: [] })).rejects.toThrow(/P-M6-09/);
    // AND A TABLE HOLDING ONLY UNFINISHED RUNS IS THE SAME ANSWER, which is the
    // case an unpredicated reader would have rendered as a fresh panel.
    await expect(
      read({ reconciliationRuns: RECON_RUNS.filter((run) => run.status !== 'completed') }),
    ).rejects.toThrow(/P-M6-09/);
  });
});

describe('integrations.batch, which is an EVENT and not a column (ADR-199 clause 4)', () => {
  it('reads the latest batch.completed by occurred_at, filtered at the accessor', async () => {
    const { result, calls } = await read();
    expect(result?.book.integrations.batch).toStrictEqual({
      last_success_at: '2026-08-28T06:04:00.000Z',
      last_duration_ms: 388_412,
    });
    expect(calls.find((call) => call.key === 'events')?.where).toStrictEqual({
      eventName: 'batch.completed',
    });
  });

  it('ignores a batch.failed row even when it is the later one', async () => {
    const failed = {
      id: 12n,
      eventName: 'batch.failed',
      occurredAt: new Date('2026-08-28T06:30:00.000Z'),
      payload: { run_id: 'r-2', stage: 'marks', error: 'timeout' },
    };
    const { result } = await read({ events: [...BATCH_EVENTS, failed] });
    expect(result?.book.integrations.batch.last_success_at).toBe('2026-08-28T06:04:00.000Z');
  });

  it('takes duration_ms as its digits, whether the payload holds a number or a string', async () => {
    const { result } = await read({
      events: [{ ...BATCH_EVENTS[1], payload: { duration_ms: '388412' } }],
    });
    expect(result?.book.integrations.batch.last_duration_ms).toBe(388_412);
  });

  it('refuses a payload with no readable duration_ms', async () => {
    for (const duration of [undefined, null, -1, 1.5, 'soon'])
      await expect(
        read({ events: [{ ...BATCH_EVENTS[1], payload: { duration_ms: duration } }] }),
      ).rejects.toThrow(/duration_ms/);
  });

  it('refuses a book when no batch has ever completed, which RB-01 calls an incident', async () => {
    await expect(read({ events: [] })).rejects.toThrow(/RB-01/);
  });
});

// -----------------------------------------------------------------------------
// The cost, and the reads it counts
// -----------------------------------------------------------------------------

describe('what the read costs, which the composition would drop', () => {
  it('reports the rows each arm was handed', async () => {
    const { result } = await read();
    expect(result?.cost).toStrictEqual({
      liabilitySnapshotsScanned: 1,
      reserveSnapshotsScanned: 1,
      treasuryAnchorsMatched: 1,
      planBreakerRowsScanned: 3,
      plansScanned: 2,
      midHealthRowsScanned: 3,
      openMismatchesScanned: 2,
      completedReconRunsScanned: 2,
      batchCompletedScanned: 2,
      // THE VELOCITY ARM'S NINE COUNTERS, CARRIED WHOLE. This estate holds no
      // calendar, so the evaluator returns `uncovered` before the unbounded
      // transfer scan and every transfer counter is zero, which is that
      // module's own stated ordering asserted from the book's side.
      velocity: {
        transferRowsScanned: 0,
        settledTransfersRead: 0,
        settledInstantsOnUnsettledRows: 0,
        settlementsAttributedInWindow: 0,
        settlementsBeforeWindow: 0,
        settlementsAfterAnchor: 0,
        calendarRowsScanned: 0,
        calendarLoadsScanned: 0,
        coveredIntervals: 0,
      },
    });
  });

  it('reads every one of the twelve, which the two calendar tables were the exception to', async () => {
    // **INVERTED, AND THE PREVIOUS READING IS WHY IT IS WORTH A CASE.** This
    // read "reads eight of the ten tables, and the other two are the horizon's",
    // then nine of eleven when `B4` landed `reconciliationRuns`. The array and
    // the read stopped being the same list when the calendar arrived for
    // `readTradingHorizon`, which the book does not call, and they are the same
    // list again for a reason that is not the horizon: `evaluatePayoutVelocity`
    // walks the SAME two tables BACKWARDS through `readTradingLookback`.
    //
    // `payoutTransfers` IS READ ONLY WHEN A VERDICT IS POSSIBLE, which is that
    // evaluator's own stated design and is asserted on the estate below rather
    // than here: this fixture covers the calendar, so every table is touched.
    const { calls } = await read(COVERED_CALENDAR);
    const readByBook = [...new Set(calls.map((call) => call.key))].sort();
    expect(readByBook).toStrictEqual([...LIABILITY_READ_TABLES]);
    expect(readByBook).toHaveLength(12);
  });

  it('pays for NO transfer scan when the calendar cannot supply a window', async () => {
    // The evaluator returns before the unbounded scan on `uncovered` and
    // `exhausted`, and the default estate holds no calendar at all.
    const { calls, result } = await read();
    expect(calls.some((call) => call.key === 'payoutTransfers')).toBe(false);
    expect(result?.cost.velocity.transferRowsScanned).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// THE ARITHMETIC
// -----------------------------------------------------------------------------

/** Every leaf path `LiabilityResponse` declares, read out of API_CONTRACT by RI-18's own reader. */
async function contractLeaves(): Promise<readonly string[]> {
  const checks = await import(
    pathToFileURL(join(ROOT, 'packages/tooling/checks/repo-invariants.mjs')).href
  );
  const shapes = await import(
    pathToFileURL(join(ROOT, 'packages/tooling/checks/response-shape-copies.mjs')).href
  );
  const copies = shapes.copiesOf(ROOT, 'LiabilityResponse', checks.workspacePackages);
  const contract = copies.find((copy: { rel: string }) => copy.rel === shapes.CONTRACT_REL);
  const paths: readonly string[] = [...(contract?.paths ?? [])];
  // A LEAF IS A PATH NOTHING EXTENDS, AND BOTH EXTENSIONS COUNT. `reserve` is
  // extended by `reserve.rcr_bp` and `per_plan` by `per_plan[].code`, so a rule
  // reading only the dotted form leaves every ARRAY container in the set and
  // reports three fields this response does not have.
  return paths.filter(
    (path) =>
      !paths.some(
        (other) =>
          other !== path && (other.startsWith(`${path}.`) || other.startsWith(`${path}[]`)),
      ),
  );
}

/** The leaf paths of a produced value, in the same spelling `copiesOf` uses. */
function leavesOf(value: unknown, prefix = ''): readonly string[] {
  if (Array.isArray(value)) {
    const first: unknown = value[0];
    return first === undefined ? [] : leavesOf(first, `${prefix}[]`);
  }
  if (typeof value !== 'object' || value === null || value instanceof Date) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([name, member]) =>
    leavesOf(member, prefix === '' ? name : `${prefix}.${name}`),
  );
}

/**
 * The leaves the blockers hold, as data.
 *
 * WRITTEN OUT RATHER THAN COMPUTED, because this list is the session's CLAIM and
 * the case below is what checks it against the contract. A claim derived from
 * the thing it is checked against proves nothing.
 *
 * **`ADR-203` MOVED TWO ENTRIES FROM SEVEN LEAVES TO TWO AND THE BLOCKERS DID
 * NOT MOVE AT ALL, WHICH IS THE POINT OF THAT RULING RATHER THAN A SIDE EFFECT.**
 * `payout_velocity` and `per_plan[].cusum` are `| null` now, and `RI-18`'s reader
 * does not walk into a union arm, so the contract declares each as ONE leaf where
 * it declared four and three. The figures are exactly as absent as they were
 * yesterday; what changed is that the response can now SAY SO. A census that
 * still listed the seven would be asserting the absence of members of an object
 * this response no longer promises.
 */
const BLOCKED_LEAVES = [
  // B5, and it was B1 UNTIL SESSION 377 REGISTERED THE CALENDAR. B1 was the
  // horizon and it is lifted and built (`readTradingHorizon`). What holds these
  // five is the PER-ACCOUNT half: the only forward-looking eligibility date in
  // the estate is `rule_states.engine_gates.cadenceGap.nextEligibleTradingDay`,
  // and nothing writes that bag or declares its shape. THE COUNT DID NOT MOVE
  // AND THAT IS THE FINDING.
  'eligible_next_7d.total_cents',
  'eligible_next_7d.account_count',
  'eligible_next_7d.by_day[].trading_day',
  'eligible_next_7d.by_day[].cents',
  'eligible_next_7d.by_day[].accounts',
] as const;

/**
 * **`EMPTY_ARRAY_LEAVES` IS DELETED AND ITS DELETION IS THE FINDING**, recorded
 * here rather than by the absence of a constant nobody would notice.
 *
 * It held `gaps[].field`, `gaps[].cause`, `gaps[].awaiting` and `gaps[].detail`:
 * four leaves that were DECLARED, PRODUCIBLE, and missing from the produced set
 * for a third reason, because {@link leavesOf} cannot walk an empty array and
 * `gaps` was `[]`. The docblock's own words for why it was empty were that
 * `LiabilityBook` said a figure was absent by OMITTING the group while
 * `LiabilityResponse` said it by NULLING the field and naming it in `gaps`, that
 * these are two spellings of one fact, and that **a book that still speaks the
 * first cannot be served as the second**.
 *
 * **THE BOOK SPEAKS THE SECOND NOW.** `per_plan[].cusum` is a `null` with an
 * entry naming it, so the array has a member, so the four leaves are produced
 * and the list has no members left. That is the same sentence as `B3` lifting,
 * arriving in the arithmetic rather than in a comment.
 */
describe('the subtraction this whole slice measures', () => {
  it('produces every leaf the contract declares EXCEPT the ones the blockers hold', async () => {
    const declared = await contractLeaves();
    const { result } = await read();
    const produced = [...leavesOf(result?.book)].sort();

    // Non-vacuity FIRST. A reader that returned nothing, or a parse that matched
    // nothing, would make the subtraction below pass for the wrong reason.
    expect(declared).toContain('open_liability_cents');
    expect(declared).toContain('reserve.treasury_source');
    expect(declared.length).toBeGreaterThan(30);

    expect(produced).toStrictEqual(
      [...declared.filter((path) => !BLOCKED_LEAVES.includes(path as never))].sort(),
    );
  });

  it('holds 5 blocked leaves against 39 declared, so 34 are produced', async () => {
    // THE NUMBERS ARE DERIVED HERE AND ARE NOT CARRIED FROM AN ENTRY, and this
    // is the first session in four in which the PRODUCED COUNT MOVED. `ADR-203`
    // moved the declared count and left production alone, which was that
    // ruling's own point. Three blockers lifted in this diff and 27 became 34:
    // one leaf gained a SOURCE (`B4`), two gained a SPELLING FOR THEIR ABSENCE
    // (`B3` and `B2`), and four more came with that spelling because a `gaps`
    // array with a member in it is an array {@link leavesOf} can walk.
    //
    // **THE CENSUS IS TAKEN OVER AN ESTATE WHERE EVERY NULLABLE FIGURE DECLINES,
    // AND THAT IS A PROPERTY OF THE TWO READERS RATHER THAN A CHOICE OF
    // FIXTURE.** `RI-18`'s reader does not walk into a union arm, so it counts
    // `payout_velocity` as ONE declared leaf; {@link leavesOf} walks a produced
    // OBJECT and would count four. The two agree exactly when the figure is
    // `null`, which is what the default estate produces and what the case above
    // subtracts. `payout_velocity` produced whole is asserted on its own
    // fixture, in its own block.
    const declared = await contractLeaves();
    expect(declared).toHaveLength(39);
    expect(BLOCKED_LEAVES).toHaveLength(5);
    for (const leaf of BLOCKED_LEAVES) expect(declared).toContain(leaf);
    // AND THE LEAVES THAT MOVED ARE NAMED, so a later reader can tell an
    // arithmetic change from a production change without diffing two revisions
    // of a count.
    for (const moved of [
      'integrations.recon.last_run_at',
      'per_plan[].cusum',
      'payout_velocity',
      'gaps[].cause',
    ]) {
      expect(declared).toContain(moved);
      expect(BLOCKED_LEAVES).not.toContain(moved);
    }
    // AND EVERY ONE STILL STANDING IS `eligible_next_7d`'s, which is B5 and is
    // the only blocker this session did not spend.
    expect(BLOCKED_LEAVES.every((leaf) => leaf.startsWith('eligible_next_7d'))).toBe(true);
    const { result } = await read();
    expect(leavesOf(result?.book)).toHaveLength(34);
  });

  it('reads a contract whose LiabilityResponse block is still the one RI-18 binds', () => {
    // The parse above walks API_CONTRACT rather than this file, so a case that
    // never found the block would report zero blocked leaves and zero declared.
    const contract = readFileSync(join(ROOT, 'docs/architecture/API_CONTRACT.md'), 'utf8');
    expect(contract).toContain('type LiabilityResponse = {');
  });
});

// -----------------------------------------------------------------------------
// THE BOOK'S GAPS, AGAINST THE REAL VALIDATOR AND NOT AGAINST A COPY OF IT
// -----------------------------------------------------------------------------
// **THIS IS THE CASE THAT SAYS THE BOOK IS SERVABLE**, and it is the one thing
// `readGaps` cannot assert about itself. `assertLiabilityGapsPaired` is the
// control `projectLiability` runs on every response, and it refuses BOTH
// directions of `ADR-203` ruling 2. A suite that re-implemented the pairing here
// would agree with `readGaps` by construction and would say nothing.
//
// THE ONE FIELD THE BOOK DOES NOT CARRY IS SUPPLIED, and it is `eligible_next_7d`
// (blocker `B5`). That is the whole of the difference between `LiabilityBook` and
// `LiabilityResponse` today, and writing it out here is what makes the gap
// between them one line long and visible rather than a subtraction to re-derive.
// -----------------------------------------------------------------------------

/** `eligible_next_7d`, the one leaf group `B5` still holds, stood in for so the validator has a whole body. */
const B5_STAND_IN: LiabilityResponse['eligible_next_7d'] = {
  total_cents: 0,
  account_count: 0,
  by_day: [],
};

function asResponse(book: LiabilityBook): LiabilityResponse {
  return { ...book, eligible_next_7d: B5_STAND_IN };
}

describe('the gaps this book writes satisfy ADR-203 ruling 2 in BOTH directions', () => {
  it('passes the served validator on an estate where two figures decline', async () => {
    const { result } = await read();
    const body = asResponse(result?.book as LiabilityBook);
    // Non-vacuity FIRST: two figures really are null and really are named.
    expect(body.payout_velocity).toBeNull();
    expect(body.per_plan.every((plan) => plan.cusum === null)).toBe(true);
    expect([...body.gaps].map((gap) => gap.field).sort()).toStrictEqual([
      'payout_velocity',
      'per_plan[].cusum',
    ]);
    expect(() => {
      assertLiabilityGapsPaired(body);
    }).not.toThrow();
  });

  it('passes it on an estate where the velocity is PRESENT, which is the other direction', async () => {
    const { result } = await read(COVERED_CALENDAR);
    const body = asResponse(result?.book as LiabilityBook);
    expect(body.payout_velocity).not.toBeNull();
    expect(body.gaps.map((gap) => gap.field)).toStrictEqual(['per_plan[].cusum']);
    expect(() => {
      assertLiabilityGapsPaired(body);
    }).not.toThrow();
  });

  it('and the validator FIRES on both seeds, so the two cases above are not vacuous', async () => {
    const { result } = await read(COVERED_CALENDAR);
    const book = result?.book as LiabilityBook;

    // SEED 1: the gap dropped. A null nothing explains is the bare null ADR-203
    // exists to refuse.
    expect(() => {
      assertLiabilityGapsPaired(asResponse({ ...book, gaps: [] }));
    }).toThrow(/gaps` does not name it/);

    // SEED 2: a gap over a figure that is PRESENT, which the entry calls the
    // worse failure. `payout_velocity` is produced on this estate.
    expect(() => {
      assertLiabilityGapsPaired(
        asResponse({
          ...book,
          gaps: [
            ...book.gaps,
            {
              field: 'payout_velocity',
              cause: 'estate_uncovered',
              awaiting: null,
              detail: 'seeded',
            },
          ],
        }),
      );
    }).toThrow(/is PRESENT on this response/);
  });
});

// =============================================================================
// THE TRADING-DAY HORIZON, WHICH IS THE HALF OF `eligible_next_7d` B1 UNBLOCKED
// =============================================================================
// EVERY CASE BELOW WAS RUN AGAINST A LIVE POSTGRESQL 16 BEFORE IT WAS WRITTEN
// HERE, over 34 seeded `trading_calendar` rows and two overlapping
// `trading_calendar_loads` rows, and the doubles carry the shapes that read
// back. `session_open_at` and `session_close_at` arrive as `Date`, the three
// flags as `boolean`, and `trading_day`, `coverage_start_day` and
// `coverage_end_day` as `YYYY-MM-DD` strings, which is what drizzle-orm hands
// back for `date` and is why {@link day} admits both forms.
//
// THE FIXTURE IS THE ONE THE LIVE PROBE USED, AND ITS SHAPE IS THE ASSERTION.
// Two holidays, one half day, one halted day, a weekend every five days, five
// session rows PAST the coverage edge, and two loads that overlap by one day.
// A calendar without all six of those cannot tell a correct walk from a wrong
// one: a run with no weekend in it passes under date arithmetic.
// =============================================================================

const CALENDAR_SESSIONS: readonly string[] = [
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
  '2026-12-01',
  '2026-12-02',
  '2026-12-03',
  '2026-12-04',
  '2026-12-07',
  '2026-12-08',
  '2026-12-09',
  '2026-12-10',
  '2026-12-11',
  '2026-12-14',
  '2026-12-15',
  '2026-12-16',
  '2026-12-17',
  '2026-12-18',
  '2026-12-21',
  '2026-12-22',
  '2026-12-23',
  '2026-12-24',
  // PAST THE COVERAGE EDGE. Rows exist and the walk must not take them.
  '2026-12-28',
  '2026-12-29',
  '2026-12-30',
  '2026-12-31',
];

/** `2026-11-26` and `2026-12-25`, both with the session columns NULL (0032 F-1). */
const CALENDAR_HOLIDAYS: readonly string[] = ['2026-11-26', '2026-12-25'];

function session(tradingDay: string): Record<string, unknown> {
  return {
    tradingDay,
    // CME-shaped: opens 23:00Z the PRIOR evening and closes 22:00Z, which is 23
    // hours later. The pair is what makes the anchor "the last CLOSED day" a
    // real question rather than a restatement of the date, and the offset is
    // subtracted from the close rather than written as a second date string so
    // the fixture cannot drift into an inverted interval. IT DID EXACTLY THAT
    // ONCE and `trading_calendar_session_ordered`'s re-assertion is what caught
    // it, which is a positive control this suite got for free.
    sessionOpenAt: new Date(Date.parse(`${tradingDay}T22:00:00.000Z`) - 23 * 60 * 60 * 1000),
    sessionCloseAt: new Date(`${tradingDay}T22:00:00.000Z`),
    isHalfDay: tradingDay === '2026-11-27',
    isHoliday: false,
    halted: tradingDay === '2026-12-01',
    notes: null,
  };
}

function holiday(tradingDay: string): Record<string, unknown> {
  return {
    tradingDay,
    sessionOpenAt: null,
    sessionCloseAt: null,
    isHalfDay: false,
    isHoliday: true,
    halted: false,
    notes: 'exchange holiday',
  };
}

const CALENDAR: readonly unknown[] = [
  ...CALENDAR_SESSIONS.map((d) => session(d)),
  ...CALENDAR_HOLIDAYS.map((d) => holiday(d)),
];

/** TWO LOADS THAT OVERLAP BY ONE DAY, so the merge is exercised rather than assumed. */
const LOADS: readonly unknown[] = [
  {
    id: 1n,
    sourceId: 'cme-2026-a',
    coverageStartDay: '2026-11-16',
    coverageEndDay: '2026-12-15',
    sourceDigest: Buffer.alloc(32, 1),
    actor: 'session-380',
  },
  {
    id: 2n,
    sourceId: 'cme-2026-b',
    coverageStartDay: '2026-12-15',
    coverageEndDay: '2026-12-24',
    sourceDigest: Buffer.alloc(32, 2),
    actor: 'session-380',
  },
];

function calendarHandle(
  overrides: { calendar?: readonly unknown[]; loads?: readonly unknown[] } = {},
): { tx: LiabilityTx; calls: Recorded[] } {
  return handle({
    tradingCalendar: overrides.calendar ?? CALENDAR,
    tradingCalendarLoads: overrides.loads ?? LOADS,
  });
}

function days(horizon: TradingHorizon): readonly string[] {
  return horizon.kind === 'uncovered' ? [] : horizon.days.map((d) => d.trading_day);
}

describe('readTradingHorizon walks TRADING days and never calendar days', () => {
  it('skips the weekend and the holiday, so seven trading days reach three days further', async () => {
    // THE WHOLE FIELD IS IN THIS ONE ASSERTION. Anchored on 2026-11-24, seven
    // CALENDAR days is 2026-11-25 through 2026-12-01. Seven TRADING days is
    // 2026-11-25 through 2026-12-04, because 2026-11-26 is Thanksgiving,
    // 2026-11-28 and 29 are a weekend, and 2026-12-05 and 06 are the next one.
    // The two answers differ by THREE DAYS on one ordinary late-November week,
    // which is AS-06's "five trading days is 7 calendar days in June and 9 to 10
    // across the year-end cluster" arriving on this field.
    const { tx } = calendarHandle();
    const { horizon } = await readTradingHorizon(tx, '2026-11-25T00:30:00.000Z');

    expect(horizon.kind).toBe('resolved');
    expect(days(horizon)).toEqual([
      '2026-11-25',
      '2026-11-27',
      '2026-11-30',
      '2026-12-01',
      '2026-12-02',
      '2026-12-03',
      '2026-12-04',
    ]);
    // The holiday is ABSENT from the run and the weekend days were never rows.
    expect(days(horizon)).not.toContain('2026-11-26');
    // And the calendar-day answer is NOT this one, stated so the difference is
    // asserted rather than described.
    expect(days(horizon)).not.toContain('2026-11-28');
    expect(days(horizon)[6]).not.toBe('2026-12-01');
  });

  it('keeps the half day and the halted day, because neither is a non-session', async () => {
    // `0004`: a half day "counts as a FULL DAY (B4 #3)" and on a halted session
    // "day counters advance and win days do NOT (B4 #2)". Both are trading days
    // and a walk that filtered either out would shorten the horizon on exactly
    // the weeks the exchange is unusual. The FLAGS are carried so a caller that
    // needs them has them; the DAYS are present either way.
    const { tx } = calendarHandle();
    const { horizon } = await readTradingHorizon(tx, '2026-11-25T00:30:00.000Z');
    if (horizon.kind === 'uncovered') throw new Error('expected a walk');

    expect(horizon.days.map((d) => [d.trading_day, d.is_half_day, d.halted])).toContainEqual([
      '2026-11-27',
      true,
      false,
    ]);
    expect(horizon.days.map((d) => [d.trading_day, d.is_half_day, d.halted])).toContainEqual([
      '2026-12-01',
      false,
      true,
    ]);
  });

  it('anchors on the last CLOSED session, so a day still trading is day one', async () => {
    // P-M6-01 dates this figure at "the last closed day" (INV-M6-11), and
    // `liability_snapshots` carries `as_of timestamptz` with NO `trading_day`
    // column, so the instant is resolved through the calendar rather than by
    // taking its UTC date. At 20:00Z on 2026-11-25 that day's session is OPEN
    // (it closes at 22:00Z), so the anchor is still 2026-11-24 and 2026-11-25 is
    // the first day of the horizon rather than a day already behind it.
    const { tx } = calendarHandle();
    const open = await readTradingHorizon(tx, '2026-11-25T20:00:00.000Z');
    const closed = await readTradingHorizon(tx, '2026-11-25T22:00:00.000Z');

    expect(open.horizon.kind === 'uncovered' ? null : open.horizon.anchor_day).toBe('2026-11-24');
    expect(days(open.horizon)[0]).toBe('2026-11-25');
    // One instant later the session has closed and the whole window moves.
    expect(closed.horizon.kind === 'uncovered' ? null : closed.horizon.anchor_day).toBe(
      '2026-11-25',
    );
    expect(days(closed.horizon)[0]).toBe('2026-11-27');
  });

  it('reads BOTH tables and neither with a predicate', async () => {
    // The accessor offers no `ORDER BY` and no `LIMIT` (ADR-112, ADR-157), so
    // both reads are whole-table and the ordering is the module's fold. The
    // recording is what shows it: a `rowsWhere` here would be a predicate this
    // module does not claim to send.
    const { tx, calls } = calendarHandle();
    await readTradingHorizon(tx, '2026-11-25T00:30:00.000Z');

    expect(calls.map((c) => c.key)).toEqual(['tradingCalendar', 'tradingCalendarLoads']);
    expect(calls.every((c) => c.where === undefined)).toBe(true);
  });

  it('returns the cost, so the two unbounded reads are visible', async () => {
    const { tx } = calendarHandle();
    const { cost } = await readTradingHorizon(tx, '2026-11-25T00:30:00.000Z');
    // The two loads OVERLAP at 2026-12-15, so they merge to one interval.
    expect(cost).toEqual({ calendarRowsScanned: 34, calendarLoadsScanned: 2, coveredIntervals: 1 });
  });
});

describe('an exhausted calendar SAYS SO, which is the whole of ADR-042 F-4', () => {
  it('stops at the coverage edge and names how many short it is', async () => {
    // FIVE SESSION ROWS EXIST PAST 2026-12-24 AND NOT ONE IS TAKEN. That is the
    // case F-4 is about: coverage is a stored fact so that "we do not know about
    // this day" is a positive answer, and a walk that read the rows would return
    // seven days of which four are outside anything this estate has loaded.
    const { tx } = calendarHandle();
    const { horizon } = await readTradingHorizon(tx, '2026-12-22T00:30:00.000Z');

    expect(horizon.kind).toBe('exhausted');
    if (horizon.kind !== 'exhausted') throw new Error('expected exhausted');
    expect(horizon.days.map((d) => d.trading_day)).toEqual([
      '2026-12-22',
      '2026-12-23',
      '2026-12-24',
    ]);
    expect(horizon.short_by).toBe(4);
    expect(horizon.covered_through_day).toBe('2026-12-24');
    expect(horizon.detail).toContain('ADR-042');
    // NON-VACUITY, and it is the assertion this case exists for: the rows the
    // walk declined to take are really there.
    expect(CALENDAR_SESSIONS).toContain('2026-12-28');
    expect(CALENDAR_SESSIONS.filter((d) => d > '2026-12-24')).toHaveLength(4);
  });

  it('refuses a day outside every load interval rather than walking from it', async () => {
    const { tx } = calendarHandle();
    const { horizon } = await readTradingHorizon(tx, '2027-06-01T00:30:00.000Z');

    expect(horizon.kind).toBe('uncovered');
    if (horizon.kind !== 'uncovered') throw new Error('expected uncovered');
    // The anchor RESOLVED and is still refused, which is the distinction
    // `calendar.ts` draws between `not_a_session` and `outside_coverage`: the
    // row exists, and the estate has no load that claims to answer for it.
    expect(horizon.anchor_day).toBe('2026-12-31');
    expect(horizon.detail).toContain('UNKNOWN and never a holiday');
  });

  it('refuses when NO load declares coverage, though the calendar is full of rows', async () => {
    // THE PUREST FORM OF F-4. 34 rows and no coverage fact is an estate that has
    // days and no record of having loaded them, and the failure F-4 names is
    // that this is otherwise indistinguishable from an unbroken holiday.
    const { tx } = calendarHandle({ loads: [] });
    const { horizon, cost } = await readTradingHorizon(tx, '2026-11-25T00:30:00.000Z');

    expect(horizon.kind).toBe('uncovered');
    expect(horizon.kind === 'uncovered' ? horizon.anchor_day : 'x').toBeNull();
    expect(cost.calendarRowsScanned).toBe(34);
    expect(cost.coveredIntervals).toBe(0);
  });

  it('refuses when no session has closed at or before the instant', async () => {
    const { tx } = calendarHandle();
    const { horizon } = await readTradingHorizon(tx, '2020-01-01T00:00:00.000Z');

    expect(horizon.kind).toBe('uncovered');
    expect(horizon.kind === 'uncovered' ? horizon.detail : '').toContain('last closed day');
  });

  it('does not bridge a GAP between two loads, because a gap is unknown', async () => {
    // ADJACENT AND OVERLAPPING MERGE; DISJOINT DOES NOT. `0032` declares no
    // supersession column, so a load says this range was loaded and never that
    // another was not. Coverage that stops on 2026-11-20 and resumes on
    // 2026-12-07 leaves the fortnight between them UNKNOWN, and the walk from
    // 2026-11-19 gets one day rather than seven.
    const { tx } = calendarHandle({
      loads: [
        { ...(LOADS[0] as Record<string, unknown>), coverageEndDay: '2026-11-20' },
        { ...(LOADS[1] as Record<string, unknown>), coverageStartDay: '2026-12-07' },
      ],
    });
    const { horizon, cost } = await readTradingHorizon(tx, '2026-11-20T00:30:00.000Z');

    expect(cost.coveredIntervals).toBe(2);
    expect(horizon.kind).toBe('exhausted');
    expect(days(horizon)).toEqual(['2026-11-20']);
    expect(horizon.kind === 'exhausted' ? horizon.short_by : 0).toBe(6);
  });
});

describe('the horizon refuses rows that disagree with the constraints above them', () => {
  it('refuses a holiday carrying a session, which 0032 CHECKs in both directions', async () => {
    // `trading_calendar_holiday_has_no_session` is `CHECK (is_holiday =
    // (session_open_at IS NULL))`, an equality between two booleans and so a
    // constraint in both directions at once. It is re-asserted on read because
    // `0032` ADDED it to a table `0004` created without it, and a merged
    // migration is never edited, only superseded (E2). F-1: R-01 is a
    // containment lookup, so a fabricated interval is one a fill can fall inside.
    const { tx } = calendarHandle({
      calendar: [...CALENDAR, { ...holiday('2026-12-28'), sessionOpenAt: new Date() }],
    });
    // THE NAME AND NOT ONLY THE CLASS, on the next case's reason: `instant()`
    // sits behind this control and throws the same class for its own reason.
    await expect(readTradingHorizon(tx, '2026-11-25T00:30:00.000Z')).rejects.toThrow(
      /trading_calendar_holiday_has_no_session/,
    );
  });

  it('refuses a NON-holiday with no session, which is the other direction', async () => {
    // THE DIRECTION A ONE-WAY CHECK WOULD MISS, and it is the one that matters
    // to this walk: a sessionless non-holiday would be counted as a trading day
    // and would then have no `session_close_at` for the anchor rule to read.
    //
    // THE MESSAGE IS ASSERTED AND NOT ONLY THE CLASS, BECAUSE THE CLASS PASSED
    // AGAINST A ONE-DIRECTIONAL CHECK. Seeding `if (isHoliday && !sessionless)`
    // in place of the two-way equality left this case GREEN: the row fell
    // through to `instant()`, which refuses a null `session_open_at` for its own
    // reason and throws the same class. So the case pinned that SOMETHING
    // refused rather than that THIS control did, which is a guard nobody had
    // watched fire. `AdminReadError` alone cannot tell two controls apart and
    // the constraint name can.
    const { tx } = calendarHandle({
      calendar: [
        ...CALENDAR,
        { ...session('2026-12-28'), sessionOpenAt: null, sessionCloseAt: null, isHoliday: false },
      ],
    });
    await expect(readTradingHorizon(tx, '2026-11-25T00:30:00.000Z')).rejects.toThrow(
      /trading_calendar_holiday_has_no_session/,
    );
  });

  it('refuses a session that closes at or before it opens', async () => {
    const { tx } = calendarHandle({
      calendar: [
        ...CALENDAR,
        { ...session('2026-12-28'), sessionCloseAt: new Date('2026-12-27T00:00:00.000Z') },
      ],
    });
    await expect(readTradingHorizon(tx, '2026-11-25T00:30:00.000Z')).rejects.toThrow(
      /trading_calendar_session_ordered/,
    );
  });

  it('refuses a backwards coverage interval rather than covering nothing quietly', async () => {
    const { tx } = calendarHandle({
      loads: [{ ...(LOADS[0] as Record<string, unknown>), coverageEndDay: '2026-11-01' }],
    });
    await expect(readTradingHorizon(tx, '2026-11-25T00:30:00.000Z')).rejects.toThrow(
      AdminReadError,
    );
  });

  it('refuses a span that is not a positive whole number of trading days', async () => {
    const { tx } = calendarHandle();
    for (const span of [0, -1, 2.5, Number.NaN])
      await expect(readTradingHorizon(tx, '2026-11-25T00:30:00.000Z', span)).rejects.toThrow(
        AdminReadError,
      );
  });

  it('refuses an anchor instant that is not an instant', async () => {
    const { tx } = calendarHandle();
    await expect(readTradingHorizon(tx, 'the last closed day')).rejects.toThrow(AdminReadError);
  });
});

describe('the FORWARD horizon is not on the book, and B5 is still why', () => {
  // **INVERTED, AND THE PREMISE THAT MOVED IS NOT THE ONE THE OLD CASE NAMED.**
  // This block read "the horizon is not on the book, and the book does not pay
  // for it", and its case asserted `readLiabilityBook` touches NEITHER calendar
  // table, reasoning that the book carries no `eligible_next_7d` so two
  // whole-table reads would buy a group it cannot return. The book carries no
  // `eligible_next_7d` still. It pays for both tables anyway, because
  // `evaluatePayoutVelocity` walks them BACKWARDS through `readTradingLookback`
  // for `payout_velocity`'s thirty-day window. The premise held and the
  // conclusion stopped following.
  it('reads both calendar tables, for the LOOKBACK and not for the horizon', async () => {
    const { calls } = await read(COVERED_CALENDAR);
    expect(calls.map((call) => call.key)).toContain('tradingCalendar');
    expect(calls.map((call) => call.key)).toContain('tradingCalendarLoads');
    // AND THE FORWARD WALK IS STILL UNCALLED, which is the property the old case
    // was reaching for and could not separate from the table reads.
    const module = readFileSync(join(ROOT, 'apps/api/src/admin-source/liability.ts'), 'utf8');
    const body = module.slice(module.indexOf('export async function readLiabilityBook'));
    expect(body.slice(0, body.indexOf('\n}\n'))).not.toContain('readTradingHorizon');
  });

  it('names both calendar tables in LIABILITY_READ_TABLES, and they are real TableKeys', () => {
    // B1's PAYOUT, MEASURED. While `trading_calendar` was unregistered this
    // array could not carry it even to try.
    expect(LIABILITY_READ_TABLES).toContain('tradingCalendar');
    expect(LIABILITY_READ_TABLES).toContain('tradingCalendarLoads');
    for (const key of LIABILITY_READ_TABLES) expect(TABLE_KEYS).toContain(key);
  });

  it('has ELIGIBLE_HORIZON_TRADING_DAYS at EC-074 and P-M6-02 seven', () => {
    expect(ELIGIBLE_HORIZON_TRADING_DAYS).toBe(7);
    const ec = readFileSync(join(ROOT, 'docs/edge-cases/EC-074.md'), 'utf8');
    expect(ec).toContain('accounts eligible now or inside 7 trading days');
  });
});
