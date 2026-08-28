// =============================================================================
// apps/api/test/admin-source-liability-book.test.ts
// =============================================================================
// `readLiabilityBook`, WHICH IS THE 28 LEAVES OF `LiabilityResponse` THIS
// ESTATE CAN PRODUCE AND IS NOT `AdminReadSource.readLiability`.
//
// THE LAST CASE IS THE ONE THIS FILE EXISTS FOR AND IT IS ARITHMETIC RATHER
// THAN PROSE. It reads `LiabilityResponse`'s field paths out of API_CONTRACT
// through `RI-18`'s own `copiesOf`, folds them to LEAVES, runs the reader over a
// fixture, and asserts that the leaves the reader produced plus the twelve
// leaves the four blockers hold are EXACTLY the contract's leaves. So the
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

import { LIABILITY_READ_TABLES, readLiabilityBook } from '../src/admin-source/liability.ts';
import { AdminReadError } from '../src/routes/admin-reads.ts';
import type { LiabilityReadTable, LiabilityTx } from '../src/admin-source/liability.ts';

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
    events: BATCH_EVENTS,
    ...overrides,
  };
}

async function read(overrides: Rows = {}) {
  const { tx, calls } = handle(estate(overrides));
  const result = await readLiabilityBook(tx);
  return { result, calls };
}

// -----------------------------------------------------------------------------
// The port
// -----------------------------------------------------------------------------

describe('the tables this module may reach', () => {
  it('names eight real TableKeys, sorted, and no others', () => {
    for (const key of LIABILITY_READ_TABLES) expect(TABLE_KEYS).toContain(key);
    expect([...LIABILITY_READ_TABLES]).toStrictEqual([...LIABILITY_READ_TABLES].sort());
    expect(LIABILITY_READ_TABLES).toHaveLength(8);
  });

  it('still does not name trading_calendar, which is now a choice rather than a wall', () => {
    // THE CLEARING CONDITION FOR `eligible_next_7d` HAS FIRED AND THE FIRST
    // ASSERTION IS INVERTED IN THE DIFF THAT FIRED IT. It read
    // `expect(TABLE_KEYS).not.toContain('tradingCalendar')`, because the array
    // below is typed over `TableKey` and could not carry the name even to try.
    // `packages/db/src/scope.ts` registers the table `firm` under ADR-103
    // clause 2, so a `Tx` naming it now compiles.
    expect(TABLE_KEYS).toContain('tradingCalendar');
    expect(TABLE_KEYS).toContain('tradingCalendarLoads');
    expect(TABLE_KEYS).toContain('tradingCalendarRevisions');
    // AND THE MODULE STILL DOES NOT READ IT, which is the line that has not
    // moved and must not be read as a second blocker. The fold ADR-199 section 6
    // describes is five leaf paths nobody has written yet; what changed is that
    // writing them is now ordinary code in this fence rather than a `TS2322`
    // against a registry in another one.
    expect([...LIABILITY_READ_TABLES]).not.toContain('tradingCalendar');
  });
});

// -----------------------------------------------------------------------------
// The snapshot
// -----------------------------------------------------------------------------

describe('the seven top-level fields, which are one liability_snapshots row', () => {
  it('answers null when no snapshot has been written, rather than a book of zeros', async () => {
    const { tx } = handle(estate({ liabilitySnapshots: [] }));
    expect(await readLiabilityBook(tx)).toBeNull();
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
// per_plan, less the CUSUM
// -----------------------------------------------------------------------------

describe('per_plan, which is the loss-ratio breaker and NOT the CUSUM', () => {
  it('takes the latest evaluated_on per plan and orders by code', async () => {
    const { result } = await read();
    expect(result?.book.per_plan).toStrictEqual([
      {
        plan_id: PLANS[1]?.id,
        code: 'MERIT-100K',
        loss_ratio_bp: 900,
        threshold_bp: 6_000,
        sales_paused: false,
      },
      {
        plan_id: PLANS[0]?.id,
        code: 'MERIT-50K',
        loss_ratio_bp: 6_450,
        threshold_bp: 6_000,
        sales_paused: true,
      },
    ]);
  });

  it('carries no cusum member at all, which is blocker B3 rather than an omission', async () => {
    const { result } = await read();
    for (const plan of result?.book.per_plan ?? []) expect('cusum' in plan).toBe(false);
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

  it('refuses a breaker row naming a plan no plans row carries', async () => {
    await expect(read({ plans: [PLANS[0]] })).rejects.toThrow(/REFERENCES plans\(id\)/);
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

describe('integrations.recon, which is a COUNT and not a clock', () => {
  it('counts open mismatches at the accessor rather than in memory', async () => {
    const { result, calls } = await read();
    expect(result?.book.integrations.recon).toStrictEqual({ mismatches_open: 2 });
    expect(calls.find((call) => call.key === 'reconciliations')?.where).toStrictEqual({
      status: 'mismatch',
    });
  });

  it('carries no last_run_at, which is blocker B4', async () => {
    // Nothing in this schema records a reconciliation RUN. The available fold is
    // `max(reconciliations.created_at)`, which is the fold ADR-199 section 5
    // refuses one field to the right, because a sweep resumable at the account
    // boundary reports a success for a run that crashed.
    const { result } = await read();
    expect('last_run_at' in (result?.book.integrations.recon ?? {})).toBe(false);
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
      batchCompletedScanned: 2,
    });
  });

  it('reads eight tables and no ninth', async () => {
    const { calls } = await read();
    expect([...new Set(calls.map((call) => call.key))].sort()).toStrictEqual([
      ...LIABILITY_READ_TABLES,
    ]);
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
 * The twelve leaves the four blockers hold, as data.
 *
 * WRITTEN OUT RATHER THAN COMPUTED, because this list is the session's CLAIM and
 * the case below is what checks it against the contract. A claim derived from
 * the thing it is checked against proves nothing.
 */
const BLOCKED_LEAVES = [
  // B1: `trading_calendar` is not a `TableKey`.
  'eligible_next_7d.total_cents',
  'eligible_next_7d.account_count',
  'eligible_next_7d.by_day[].trading_day',
  'eligible_next_7d.by_day[].cents',
  'eligible_next_7d.by_day[].accounts',
  // B2: no document fixes the 30-day denominator's window.
  'payout_velocity.last_7d_cents',
  'payout_velocity.avg_30d_cents',
  'payout_velocity.ratio_bp',
  'payout_velocity.alarm',
  // B3: DEP-M6-05's calibration, and ADR-167 clause 5.
  'per_plan[].cusum.statistic',
  'per_plan[].cusum.threshold',
  'per_plan[].cusum.alarm',
  // B4: nothing records a reconciliation RUN.
  'integrations.recon.last_run_at',
] as const;

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

  it('holds 13 blocked leaves against 40 declared, so 27 are produced', async () => {
    // THE NUMBERS ARE DERIVED HERE AND ARE NOT CARRIED FROM AN ENTRY. `payout_velocity`
    // loses all four of its leaves and not three: its NUMERATOR is producible and
    // the group is not, because three of the four depend on a window no document
    // states.
    const declared = await contractLeaves();
    expect(declared).toHaveLength(40);
    expect(BLOCKED_LEAVES).toHaveLength(13);
    for (const leaf of BLOCKED_LEAVES) expect(declared).toContain(leaf);
    const { result } = await read();
    expect(leavesOf(result?.book)).toHaveLength(27);
  });

  it('reads a contract whose LiabilityResponse block is still the one RI-18 binds', () => {
    // The parse above walks API_CONTRACT rather than this file, so a case that
    // never found the block would report zero blocked leaves and zero declared.
    const contract = readFileSync(join(ROOT, 'docs/architecture/API_CONTRACT.md'), 'utf8');
    expect(contract).toContain('type LiabilityResponse = {');
  });
});
