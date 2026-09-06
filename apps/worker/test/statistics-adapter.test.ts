// =============================================================================
// apps/worker/test/statistics-adapter.test.ts
// =============================================================================
// **THE STATISTICS RUN'S PORTS, OVER A DOOR THAT HOLDS ROWS: WHAT THIS
// DEPLOYMENT COMPUTES EXACTLY, AND WHAT IT REFUSES TO PUBLISH.**
//
// `ADR-350`. Two falsifications frame this file and everything else supports
// one of them:
//
//   SECTION 6 SEEDS DATA WITH A KNOWN STATISTIC AND WATCHES THE RUN COMPUTE IT
//   EXACTLY. The facts come out of the REAL adapter, over the REAL door shape,
//   and go into the REAL `COMPUTATIONS` from `batch/statistics.ts`. Nothing
//   between the rows and the basis points is a stand-in, so a case here that
//   passes is a claim about the arithmetic Merit would publish and not about a
//   fixture somebody wrote to agree with it.
//
//   SECTION 7 SEEDS A PARTIAL SET AND WATCHES THE RUN REFUSE RATHER THAN
//   PUBLISH. `runStatisticsRun` drives the composed `postgresStatisticsPorts`,
//   the first read it cannot serve ends the run, and the recorder proves that
//   `published_statistics` received NOTHING.
//
// -----------------------------------------------------------------------------
// THE CALENDAR IN SECTION 7 IS SYNTHETIC AND THIS FILE SAYS SO
// -----------------------------------------------------------------------------
// `TR-01` forbids writing down which days the exchange trades from
// recollection. The slice built below is thirty-five consecutive dates with a
// dense sequence, and whether CME traded on any of them is NOT asserted and is
// not what this file measures. What it measures is that a trailing window
// resolves, that the run reaches its reads, and that the reads refuse.
//
// -----------------------------------------------------------------------------
// WHAT A DOOR THAT HOLDS ROWS CAN AND CANNOT PROVE
// -----------------------------------------------------------------------------
// `src/db.ts` states it for the whole deployable: a recorder proves which key
// was named, which values were written and how many transactions were opened.
// It proves NOTHING about whether a composed predicate reaches one row or many,
// which is `packages/db`'s and is asserted there. So no case here claims that
// `rowsWhere` narrows correctly; the cases claim what this adapter does with
// what it is handed.
//
// CI-02, the `unit` project. No database.
// =============================================================================

import { describe, expect, test } from 'vitest';

import type { CalendarSlice, TradingDay } from '@merit/rules-engine';
import { buildCalendarSlice } from '@merit/rules-engine';

import type { SystemTx } from '@merit/db';

import type { BatchTx } from '../src/batch/adapter.ts';
import type { StatisticWindow, StatisticsPorts } from '../src/batch/ports.ts';
import {
  FUNDED_LIVES_BLOCKER,
  PublishedWindowAlreadyExists,
  STATISTICS_HALT_SINK_BLOCKER,
  StatisticsPortUnwired,
  StatisticsRowError,
  WITHDRAWAL_SETTLEMENTS_BLOCKER,
  postgresStatisticsPorts,
} from '../src/batch/statistics-adapter.ts';
import { COMPUTATIONS, runStatisticsRun } from '../src/batch/statistics.ts';

// -----------------------------------------------------------------------------
// A door that holds rows rather than one that connects
// -----------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Tables = Readonly<Record<string, readonly Row[]>>;

interface Written {
  readonly key: string;
  readonly values: Row;
}

interface Door {
  readonly db: { batch: <T>(fn: (tx: SystemTx) => Promise<T>) => Promise<T> };
  /** One entry per `batch()` call, holding the table keys touched inside it. */
  readonly transactions: string[][];
  /** Every insert, in order, so a run that wrote nothing is provable. */
  readonly writes: Written[];
}

/**
 * A door over fixed tables.
 *
 * `insert` RETURNS ONE ROW, which is what `RETURNING` gives on a single-row
 * insert and is what the adapter checks. The `onInsert` hook is how the unique
 * index is simulated: `packages/db` is where a real one is asserted, and a case
 * here that claimed to exercise Postgres would be agreeing with its own fake.
 */
function doorOf(tables: Tables, onInsert?: (key: string, values: Row) => void): Door {
  const transactions: string[][] = [];
  const writes: Written[] = [];
  const of = (key: string): readonly Row[] => tables[key] ?? [];

  const db = {
    batch<T>(fn: (tx: SystemTx) => Promise<T>): Promise<T> {
      const keys: string[] = [];
      transactions.push(keys);
      const tx = {
        rows: (key: string) => {
          keys.push(key);
          return Promise.resolve([...of(key)]);
        },
        rowsWhere: (key: string, where: Readonly<Record<string, unknown>>) => {
          keys.push(key);
          return Promise.resolve(
            of(key).filter((row) =>
              Object.entries(where).every(([column, value]) => row[column] === value),
            ),
          );
        },
        insert: (key: string, values: Row) => {
          keys.push(key);
          onInsert?.(key, values);
          writes.push({ key, values });
          return Promise.resolve([values]);
        },
      } as unknown as BatchTx;
      return fn(tx as unknown as SystemTx);
    },
  };

  return { db, transactions, writes };
}

const portsOver = (
  tables: Tables,
  onInsert?: (key: string, values: Row) => void,
): StatisticsPorts => postgresStatisticsPorts(doorOf(tables, onInsert).db);

// -----------------------------------------------------------------------------
// The rows, in the property names `packages/db/src/schema.ts` declares
// -----------------------------------------------------------------------------
// **EVERY `date` COLUMN IS A STRING AND EVERY `timestamptz` IS A `Date`**, which
// is the wire shape `ADR-271` fixed: the OID 1082 parser hands back `YYYY-MM-DD`
// verbatim so no `Date` is ever built for a calendar day, and instants keep the
// coercion a day must not get. A fixture that used a `Date` for a trading day
// would be testing this adapter against a driver Merit does not run.

const WINDOW: StatisticWindow = {
  startDay: '2026-06-01' as TradingDay,
  endDay: '2026-08-31' as TradingDay,
  asOfTradingDay: '2026-08-31' as TradingDay,
};

const PLANS: readonly Row[] = [
  { id: 'plan-core', code: 'CORE-EOD' },
  { id: 'plan-rapid', code: 'RAPID' },
];

const PLAN_VERSIONS: readonly Row[] = [
  { id: 'pv-core-1', planId: 'plan-core' },
  { id: 'pv-rapid-1', planId: 'plan-rapid' },
];

function account(
  id: string,
  planVersionId: string,
  status: string,
  fundedOn: string | null,
  closedOn: string | null,
  terminalSettlementId: string | null = null,
): Row {
  return {
    id,
    identityId: `identity-of-${id}`,
    planVersionId,
    status,
    fundedOn,
    closedOn,
    terminalSettlementId,
  };
}

/**
 * The evaluation cohort, plus the two funded accounts the payout cases need.
 *
 * **`acc-late-pass` IS THE ORDERING CASE AND IT IS THE POINT OF THIS FIXTURE.**
 * It passed on `2026-05-01`, OUTSIDE the window, and then breached while funded
 * and closed on `2026-07-10`, INSIDE it. Its evaluation outcome is the pass and
 * the pass is out of window, so it must produce NO fact. An adapter that read
 * `status` before `funded_on` would report a funded account's later breach as an
 * evaluation failure and would put `ST-02`'s subject inside `ST-01`'s
 * denominator.
 */
const ACCOUNTS: readonly Row[] = [
  account('acc-passed', 'pv-core-1', 'active', '2026-07-01', null),
  account('acc-breached', 'pv-core-1', 'breached', null, '2026-07-02'),
  account('acc-expired', 'pv-core-1', 'expired', null, '2026-07-03'),
  account('acc-rapid-breached', 'pv-rapid-1', 'breached', null, '2026-07-04'),
  account('acc-open', 'pv-core-1', 'active', null, null),
  account('acc-late-pass', 'pv-core-1', 'breached', '2026-05-01', '2026-07-10'),
  account('acc-payer', 'pv-core-1', 'active', '2026-04-01', null),
  account('acc-graduate', 'pv-rapid-1', 'graduated', '2026-04-02', '2026-08-20', 'pay-terminal'),
];

function payout(
  id: string,
  accountId: string,
  planVersionId: string,
  status: string,
  basisTradingDay: string,
  effectiveTradingDay: string | null,
  traderCents: bigint,
  createdAt: string,
  frozenAt: string | null = null,
): Row {
  return {
    id,
    accountId,
    identityId: `identity-of-${accountId}`,
    planVersionId,
    status,
    basisTradingDay,
    effectiveTradingDay,
    traderCents,
    createdAt: new Date(createdAt),
    frozenAt: frozenAt === null ? null : new Date(frozenAt),
  };
}

const PAYOUTS: readonly Row[] = [
  payout(
    'pay-1',
    'acc-payer',
    'pv-core-1',
    'settled',
    '2026-06-30',
    '2026-07-01',
    10000n,
    '2026-07-01T12:00:00.000Z',
  ),
  payout(
    'pay-2',
    'acc-payer',
    'pv-core-1',
    'settled',
    '2026-07-14',
    '2026-07-15',
    20000n,
    '2026-07-15T12:00:00.000Z',
  ),
  payout(
    'pay-3',
    'acc-graduate',
    'pv-rapid-1',
    'settled',
    '2026-07-31',
    '2026-08-01',
    90000n,
    '2026-08-01T12:00:00.000Z',
  ),
  payout(
    'pay-terminal',
    'acc-graduate',
    'pv-rapid-1',
    'settled',
    '2026-08-19',
    '2026-08-20',
    50000n,
    '2026-08-20T12:00:00.000Z',
  ),
  // Approved and not yet settled: in `ST-07`'s eligible set and in no other.
  payout(
    'pay-open',
    'acc-payer',
    'pv-core-1',
    'approved',
    '2026-08-25',
    null,
    30000n,
    '2026-08-25T12:00:00.000Z',
  ),
  // Settled OUTSIDE the window on both anchors.
  payout(
    'pay-old',
    'acc-payer',
    'pv-core-1',
    'settled',
    '2026-04-30',
    '2026-05-01',
    70000n,
    '2026-05-01T12:00:00.000Z',
  ),
];

function credit(referenceId: string, occurredAt: string): Row {
  return {
    referenceId,
    provenance: 'payout',
    direction: 'credit',
    occurredAt: new Date(occurredAt),
  };
}

/**
 * The wallet's own statement, which is where the recognition point lives.
 *
 * TWO DECOYS SIT ON `pay-1` DELIBERATELY: a refund credit, which is the right
 * direction and the wrong provenance, and a debit, which is the right provenance
 * column shape and the wrong direction and carries `provenance: null` because
 * `0080` made the column nullable ON A DEBIT ONLY. Either one alone would be
 * admitted by a filter testing only the other half.
 */
const WALLET_ENTRIES: readonly Row[] = [
  credit('pay-1', '2026-07-01T12:01:00.000Z'),
  {
    referenceId: 'pay-1',
    provenance: 'refund_wallet_funded',
    direction: 'credit',
    occurredAt: new Date('2026-07-01T13:00:00.000Z'),
  },
  {
    referenceId: 'pay-1',
    provenance: null,
    direction: 'debit',
    occurredAt: new Date('2026-07-01T14:00:00.000Z'),
  },
  credit('pay-2', '2026-07-15T12:02:00.000Z'),
  credit('pay-3', '2026-08-01T12:05:00.000Z'),
  credit('pay-terminal', '2026-08-20T12:15:00.000Z'),
  credit('pay-old', '2026-05-01T12:00:30.000Z'),
];

const ESTATE: Tables = {
  plans: PLANS,
  planVersions: PLAN_VERSIONS,
  accounts: ACCOUNTS,
  payoutRequests: PAYOUTS,
  walletEntries: WALLET_ENTRIES,
  statisticDefinitions: [],
  publishedStatistics: [],
};

function definition(
  id: string,
  statCode: string,
  version: number,
  effectiveFrom: string,
  overrides: Row = {},
): Row {
  return {
    id,
    statCode,
    version,
    effectiveFrom,
    supersededBy: null,
    minSample: 250,
    measures: ['rate'],
    grain: 'lineup',
    windowSpec: 'trailing_30_trading_days',
    numeratorSpec: 'the numerator, in prose',
    denominatorSpec: 'the denominator, in prose',
    exclusions: ['still in evaluation at window close'],
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// 1. `effectiveDefinitions`, which is `INV-M12-07` and is the adapter's to apply
// -----------------------------------------------------------------------------

describe('effectiveDefinitions', () => {
  test('a future-dated definition is not effective, and its predecessor still is', async () => {
    const ports = portsOver({
      ...ESTATE,
      statisticDefinitions: [
        definition('def-v1', 'ST-01', 1, '2026-01-01', { supersededBy: 'def-v2' }),
        definition('def-v2', 'ST-01', 2, '2027-01-01'),
      ],
    });

    const effective = await ports.read.effectiveDefinitions('2026-08-31' as TradingDay);

    // THE SUCCESSOR DOES NOT RETIRE ITS PREDECESSOR BEFORE ITS OWN DATE ARRIVES,
    // which is the whole content of a forward-only registry: a figure published
    // for a past day stays published under the definition live on that day.
    expect(effective.map((row) => row.version)).toEqual([1]);
  });

  test('a superseded definition drops out once its successor is effective too', async () => {
    const ports = portsOver({
      ...ESTATE,
      statisticDefinitions: [
        definition('def-v1', 'ST-01', 1, '2026-01-01', { supersededBy: 'def-v2' }),
        definition('def-v2', 'ST-01', 2, '2026-06-01'),
      ],
    });

    const effective = await ports.read.effectiveDefinitions('2026-08-31' as TradingDay);
    expect(effective.map((row) => row.version)).toEqual([2]);
  });

  test('two effective rows for one stat_code with no supersession is a throw', async () => {
    const ports = portsOver({
      ...ESTATE,
      statisticDefinitions: [
        definition('def-a', 'ST-01', 1, '2026-01-01'),
        definition('def-b', 'ST-01', 2, '2026-02-01'),
      ],
    });

    // `statistic_definitions_live_uq` guarantees at most one LIVE row and
    // guarantees nothing about the effective set at a past day. Picking the
    // higher version here would be this adapter deciding which method a figure
    // was published under.
    await expect(ports.read.effectiveDefinitions('2026-08-31' as TradingDay)).rejects.toThrow(
      StatisticsRowError,
    );
  });

  test('the whole registry row is carried, prose specs and exclusions included', async () => {
    const ports = portsOver({
      ...ESTATE,
      statisticDefinitions: [
        definition('def-a', 'ST-04', 3, '2026-01-01', {
          minSample: 50,
          measures: ['mean', 'median'],
          grain: 'plan',
          windowSpec: 'trailing_90_trading_days',
        }),
      ],
    });

    // THE PROSE SPECS AND THE EXCLUSIONS ARE IN THE DIGEST (`statistics.ts`), so
    // a definition edited in place at an unchanged version changes every digest
    // it produces. An adapter that dropped them would make INV-M12-07
    // undetectable rather than merely unstated.
    expect(await ports.read.effectiveDefinitions('2026-08-31' as TradingDay)).toEqual([
      {
        id: 'def-a',
        supersededBy: null,
        statCode: 'ST-04',
        version: 3,
        minSample: 50,
        measures: ['mean', 'median'],
        grain: 'plan',
        windowSpec: 'trailing_90_trading_days',
        numeratorSpec: 'the numerator, in prose',
        denominatorSpec: 'the denominator, in prose',
        exclusions: ['still in evaluation at window close'],
        effectiveFrom: '2026-01-01',
      },
    ]);
  });
});

// -----------------------------------------------------------------------------
// 2. `evaluationOutcomes`, on `G-5`'s outcome anchor
// -----------------------------------------------------------------------------

describe('evaluationOutcomes', () => {
  test('every outcome is anchored on its own day, and the open account has none', async () => {
    const facts = await portsOver(ESTATE).read.evaluationOutcomes(WINDOW);

    expect(facts).toEqual([
      {
        accountId: 'acc-passed',
        identityId: 'identity-of-acc-passed',
        planCode: 'CORE-EOD',
        outcomeDay: '2026-07-01',
        outcome: 'passed',
      },
      {
        accountId: 'acc-breached',
        identityId: 'identity-of-acc-breached',
        planCode: 'CORE-EOD',
        outcomeDay: '2026-07-02',
        outcome: 'breached',
      },
      {
        accountId: 'acc-expired',
        identityId: 'identity-of-acc-expired',
        planCode: 'CORE-EOD',
        outcomeDay: '2026-07-03',
        outcome: 'expired',
      },
      {
        accountId: 'acc-rapid-breached',
        identityId: 'identity-of-acc-rapid-breached',
        planCode: 'RAPID',
        outcomeDay: '2026-07-04',
        outcome: 'breached',
      },
    ]);
  });

  test('a funded account that later breached is not an evaluation failure', async () => {
    const facts = await portsOver(ESTATE).read.evaluationOutcomes(WINDOW);

    // `acc-late-pass` passed on 2026-05-01 and closed breached on 2026-07-10,
    // and only the second is inside the window. Reading `status` first would
    // have put it here as a breach.
    expect(facts.map((fact) => fact.accountId)).not.toContain('acc-late-pass');
  });

  test('an evaluation closed at a status the statistic has no member for is a throw', async () => {
    const ports = portsOver({
      ...ESTATE,
      accounts: [
        ...ACCOUNTS,
        account('acc-chargeback', 'pv-core-1', 'closed_chargeback', null, '2026-07-20'),
      ],
    });

    // ST-01's outcome vocabulary is passed, breached and expired, and its
    // exclusion list is "still in evaluation at window close. NOTHING ELSE".
    // Dropping this account would shorten a published denominator with nothing
    // reporting the shortfall.
    await expect(ports.read.evaluationOutcomes(WINDOW)).rejects.toThrow(
      /closed_chargeback.*neither excluded nor expressible/s,
    );
  });

  test("the same closure OUTSIDE the window is not this window's business", async () => {
    const ports = portsOver({
      ...ESTATE,
      accounts: [
        ...ACCOUNTS,
        account('acc-chargeback', 'pv-core-1', 'closed_chargeback', null, '2026-01-20'),
      ],
    });

    // THE REFUSAL IS PROPORTIONAL AND THIS IS THE CASE THAT SHOWS IT. Without
    // this, every case above is satisfied by a reader that refuses everything.
    const facts = await ports.read.evaluationOutcomes(WINDOW);
    expect(facts).toHaveLength(4);
  });

  test('an account pinned to a plan version the catalogue lacks is a throw', async () => {
    const ports = portsOver({
      ...ESTATE,
      accounts: [account('acc-orphan', 'pv-missing', 'breached', null, '2026-07-05')],
    });

    await expect(ports.read.evaluationOutcomes(WINDOW)).rejects.toThrow(StatisticsRowError);
  });
});

// -----------------------------------------------------------------------------
// 3. `settledPayouts`, recognized at the wallet credit
// -----------------------------------------------------------------------------

describe('settledPayouts', () => {
  test("the window is the effective trading day and the credit is the wallet's", async () => {
    const facts = await portsOver(ESTATE).read.settledPayouts(WINDOW);

    expect(facts).toEqual([
      {
        payoutRequestId: 'pay-1',
        accountId: 'acc-payer',
        identityId: 'identity-of-acc-payer',
        planCode: 'CORE-EOD',
        creditedTradingDay: '2026-07-01',
        traderCents: 10000n,
        terminalSettlement: false,
        requestedAtEpochSeconds: BigInt(Date.parse('2026-07-01T12:00:00.000Z') / 1000),
        creditedAtEpochSeconds: BigInt(Date.parse('2026-07-01T12:01:00.000Z') / 1000),
        frozen: false,
      },
      {
        payoutRequestId: 'pay-2',
        accountId: 'acc-payer',
        identityId: 'identity-of-acc-payer',
        planCode: 'CORE-EOD',
        creditedTradingDay: '2026-07-15',
        traderCents: 20000n,
        terminalSettlement: false,
        requestedAtEpochSeconds: BigInt(Date.parse('2026-07-15T12:00:00.000Z') / 1000),
        creditedAtEpochSeconds: BigInt(Date.parse('2026-07-15T12:02:00.000Z') / 1000),
        frozen: false,
      },
      {
        payoutRequestId: 'pay-3',
        accountId: 'acc-graduate',
        identityId: 'identity-of-acc-graduate',
        planCode: 'RAPID',
        creditedTradingDay: '2026-08-01',
        traderCents: 90000n,
        terminalSettlement: false,
        requestedAtEpochSeconds: BigInt(Date.parse('2026-08-01T12:00:00.000Z') / 1000),
        creditedAtEpochSeconds: BigInt(Date.parse('2026-08-01T12:05:00.000Z') / 1000),
        frozen: false,
      },
      {
        payoutRequestId: 'pay-terminal',
        accountId: 'acc-graduate',
        identityId: 'identity-of-acc-graduate',
        planCode: 'RAPID',
        creditedTradingDay: '2026-08-20',
        traderCents: 50000n,
        terminalSettlement: true,
        requestedAtEpochSeconds: BigInt(Date.parse('2026-08-20T12:00:00.000Z') / 1000),
        creditedAtEpochSeconds: BigInt(Date.parse('2026-08-20T12:15:00.000Z') / 1000),
        frozen: false,
      },
    ]);
  });

  test("only the named settlement is terminal, and the graduate's other payout is not", async () => {
    const facts = await portsOver(ESTATE).read.settledPayouts(WINDOW);
    const graduate = facts.filter((fact) => fact.accountId === 'acc-graduate');

    // **THIS IS THE `ports.ts` CORRECTION, EXECUTED.** That file read
    // "`accounts.terminal_settlement_id IS NOT NULL`", and `0010:306` makes the
    // column a foreign key naming WHICH payout closed the account. Under the
    // null test both rows below would be `true`, `ST-04` excludes terminal
    // settlements, and `pay-3` would leave the mean and the median entirely.
    expect(graduate.map((fact) => [fact.payoutRequestId, fact.terminalSettlement])).toEqual([
      ['pay-3', false],
      ['pay-terminal', true],
    ]);
  });

  test('a settled payout the wallet never credited is a throw', async () => {
    const ports = portsOver({
      ...ESTATE,
      walletEntries: WALLET_ENTRIES.filter((row) => row['referenceId'] !== 'pay-2'),
    });

    // Money the database says arrived and the wallet has no record of. The
    // approval time is NOT substituted for the credit time: ST-05 publishes the
    // elapsed to the credit and S-09 signed that recognition point.
    await expect(ports.read.settledPayouts(WINDOW)).rejects.toThrow(
      /wallet_entries holds 0 payout credits/,
    );
  });

  test('a settled payout with no effective trading day is a throw', async () => {
    const ports = portsOver({
      ...ESTATE,
      payoutRequests: [
        payout(
          'pay-undated',
          'acc-payer',
          'pv-core-1',
          'settled',
          '2026-07-01',
          null,
          10000n,
          '2026-07-01T12:00:00.000Z',
        ),
      ],
      walletEntries: [credit('pay-undated', '2026-07-01T12:01:00.000Z')],
    });

    await expect(ports.read.settledPayouts(WINDOW)).rejects.toThrow(/effective_trading_day/);
  });
});

// -----------------------------------------------------------------------------
// 4. `eligibleRequests`, and the constant that is read rather than assumed
// -----------------------------------------------------------------------------

describe('eligibleRequests', () => {
  test('the basis day is the anchor and every written request is eligible', async () => {
    const facts = await portsOver(ESTATE).read.eligibleRequests(WINDOW);

    expect(
      facts.map((fact) => [fact.payoutRequestId, fact.resolvedTradingDay, fact.approved]),
    ).toEqual([
      ['pay-1', '2026-06-30', true],
      ['pay-2', '2026-07-14', true],
      ['pay-3', '2026-07-31', true],
      ['pay-terminal', '2026-08-19', true],
      ['pay-open', '2026-08-25', true],
    ]);
  });

  test('a status outside the declared set refuses instead of counting as approved', async () => {
    const ports = portsOver({
      ...ESTATE,
      payoutRequests: [
        payout(
          'pay-denied',
          'acc-payer',
          'pv-core-1',
          'denied',
          '2026-07-01',
          null,
          0n,
          '2026-07-01T12:00:00.000Z',
        ),
      ],
    });

    // `AS-M12-05`: ST-07 publishes 100 percent structurally and the arithmetic
    // does not know that. THE DAY THE CONSTANT STOPS HOLDING IS THE DAY THE
    // FIGURE MATTERS, and this is that day arriving: the run refuses rather than
    // quietly counting a denial as an approval.
    await expect(ports.read.eligibleRequests(WINDOW)).rejects.toThrow(StatisticsRowError);
  });
});

// -----------------------------------------------------------------------------
// 5. The three refusals, each naming its own port
// -----------------------------------------------------------------------------

describe('the ports this deployment cannot serve', () => {
  test('fundedLives refuses and names the parameter nobody has set', async () => {
    const ports = portsOver(ESTATE);
    const failure = await ports.read.fundedLives(WINDOW).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(StatisticsPortUnwired);
    expect((failure as StatisticsPortUnwired).port).toBe('fundedLives');
    expect((failure as Error).message).toContain(FUNDED_LIVES_BLOCKER);
  });

  test('withdrawalSettlements refuses and names the anchor nobody has ruled', async () => {
    const ports = portsOver(ESTATE);
    const failure = await ports.read.withdrawalSettlements(WINDOW).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(StatisticsPortUnwired);
    expect((failure as StatisticsPortUnwired).port).toBe('withdrawalSettlements');
    expect((failure as Error).message).toContain(WITHDRAWAL_SETTLEMENTS_BLOCKER);
  });

  test('raiseStatisticsHalt refuses and names the sink this deployable lacks', async () => {
    const ports = portsOver(ESTATE);
    const failure = await ports.write
      .raiseStatisticsHalt({
        asOfTradingDay: '2026-08-31' as TradingDay,
        reason: 'no_effective_definitions',
        stage: 'computing',
        statCode: null,
        detail: 'a detail',
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(StatisticsPortUnwired);
    expect((failure as StatisticsPortUnwired).port).toBe('raiseStatisticsHalt');
    expect((failure as Error).message).toContain(STATISTICS_HALT_SINK_BLOCKER);
  });
});

// -----------------------------------------------------------------------------
// 6. FALSIFICATION ONE: a known statistic, computed exactly
// -----------------------------------------------------------------------------
// THE ADAPTER'S FACTS GO STRAIGHT INTO THE REAL ARITHMETIC. Every expected value
// below is worked out from the fixture by hand and is stated in the case, so a
// change to either half is a red case rather than two halves agreeing.

describe('a seeded estate, computed exactly', () => {
  test('ST-01 over four outcomes, one of them a pass, is 2500 basis points', async () => {
    const ports = portsOver(ESTATE);
    const facts = await ports.read.evaluationOutcomes(WINDOW);

    const cells = COMPUTATIONS['ST-01'].cells(
      {
        evaluationOutcomes: facts,
        fundedLives: [],
        settledPayouts: [],
        withdrawalSettlements: [],
        eligibleRequests: [],
      },
      'lineup',
    );
    expect(cells).not.toBeNull();
    const cell = cells?.[0];
    expect(cell?.sampleSize).toBe(4);

    // 1 of 4 is 2500 basis points exactly: basisPoints(1, 4) is
    // roundedQuotient(10000, 4) is (20000 + 4) / 8 is 2500.
    expect(cell?.compute()).toEqual({
      kind: 'figures',
      figures: [
        {
          measure: 'rate',
          value: 2500n,
          valueUnit: 'bp',
          numerator: 1n,
          numeratorUnit: 'count',
          denominator: 4n,
        },
      ],
    });
  });

  test('ST-03 totals every dollar paid, terminal settlement included', async () => {
    const facts = await portsOver(ESTATE).read.settledPayouts(WINDOW);
    const cells = COMPUTATIONS['ST-03'].cells(
      {
        evaluationOutcomes: [],
        fundedLives: [],
        settledPayouts: facts,
        withdrawalSettlements: [],
        eligibleRequests: [],
      },
      'lineup',
    );
    const cell = cells?.[0];

    // 10000 + 20000 + 90000 + 50000 integer cents, over four payouts.
    expect(cell?.sampleSize).toBe(4);
    expect(cell?.compute()).toEqual({
      kind: 'figures',
      figures: [
        {
          measure: 'total',
          value: 170000n,
          valueUnit: 'cents',
          numerator: 170000n,
          numeratorUnit: 'cents',
          denominator: null,
        },
      ],
    });
  });

  test("ST-04 excludes the terminal settlement and keeps the graduate's other payout", async () => {
    const facts = await portsOver(ESTATE).read.settledPayouts(WINDOW);
    const cells = COMPUTATIONS['ST-04'].cells(
      {
        evaluationOutcomes: [],
        fundedLives: [],
        settledPayouts: facts,
        withdrawalSettlements: [],
        eligibleRequests: [],
      },
      'lineup',
    );
    const cell = cells?.[0];

    // 10000, 20000 and 90000, which is 120000 over three: the mean is
    // roundedQuotient(120000, 3) is 40000 and the ordered middle is 20000.
    // **UNDER THE `IS NOT NULL` PREDICATE `ports.ts` USED TO CARRY, 90000 WOULD
    // BE GONE AND THE MEAN WOULD READ 15000.**
    expect(cell?.sampleSize).toBe(3);
    expect(cell?.compute()).toEqual({
      kind: 'figures',
      figures: [
        {
          measure: 'mean',
          value: 40000n,
          valueUnit: 'cents',
          numerator: 120000n,
          numeratorUnit: 'cents',
          denominator: 3n,
        },
        {
          measure: 'median',
          value: 20000n,
          valueUnit: 'cents',
          numerator: 20000n,
          numeratorUnit: 'cents',
          denominator: null,
        },
      ],
    });
  });

  test('ST-05 publishes whole seconds by nearest rank, off the wallet credit', async () => {
    const facts = await portsOver(ESTATE).read.settledPayouts(WINDOW);
    const cells = COMPUTATIONS['ST-05'].cells(
      {
        evaluationOutcomes: [],
        fundedLives: [],
        settledPayouts: facts,
        withdrawalSettlements: [],
        eligibleRequests: [],
      },
      'lineup',
    );

    // Elapsed 60, 120, 300 and 900 seconds. Nearest rank over four
    // observations puts p50 at rank 2 (120) and p95 at rank 4 (900), with no
    // interpolation, because an interpolated percentile is a duration nobody
    // ever waited.
    expect(cells?.[0]?.compute()).toEqual({
      kind: 'figures',
      figures: [
        {
          measure: 'p50',
          value: 120n,
          valueUnit: 'duration_seconds',
          numerator: 120n,
          numeratorUnit: 'duration_seconds',
          denominator: null,
        },
        {
          measure: 'p95',
          value: 900n,
          valueUnit: 'duration_seconds',
          numerator: 900n,
          numeratorUnit: 'duration_seconds',
          denominator: null,
        },
      ],
    });
  });

  test('ST-07 is 10000 basis points, and the machine derived it rather than knowing it', async () => {
    const facts = await portsOver(ESTATE).read.eligibleRequests(WINDOW);
    const cells = COMPUTATIONS['ST-07'].cells(
      {
        evaluationOutcomes: [],
        fundedLives: [],
        settledPayouts: [],
        withdrawalSettlements: [],
        eligibleRequests: facts,
      },
      'lineup',
    );
    const cell = cells?.[0];

    expect(cell?.sampleSize).toBe(5);
    expect(cell?.compute()).toEqual({
      kind: 'figures',
      figures: [
        {
          measure: 'rate',
          value: 10000n,
          valueUnit: 'bp',
          numerator: 5n,
          numeratorUnit: 'count',
          denominator: 5n,
        },
      ],
    });
  });

  test('the plan grain splits the same payouts by the version each row pinned', async () => {
    const facts = await portsOver(ESTATE).read.settledPayouts(WINDOW);
    const cells = COMPUTATIONS['ST-03'].cells(
      {
        evaluationOutcomes: [],
        fundedLives: [],
        settledPayouts: facts,
        withdrawalSettlements: [],
        eligibleRequests: [],
      },
      'plan',
    );

    // The cells are keyed off the facts and sorted, and the two plan totals sum
    // to the lineup total above.
    expect(cells?.map((cell) => [cell.grainKey, cell.sampleSize])).toEqual([
      ['CORE-EOD', 2],
      ['RAPID', 2],
    ]);
  });
});

// -----------------------------------------------------------------------------
// 7. FALSIFICATION TWO: a partial set refuses rather than publishing
// -----------------------------------------------------------------------------

/**
 * Thirty-five consecutive dates with a dense sequence. SYNTHETIC, per the header.
 *
 * Long enough that `trailing_30_trading_days` resolves against it, which is all
 * the run needs before it reaches the reads that refuse.
 */
function syntheticCalendar(): CalendarSlice {
  const days = Array.from({ length: 35 }, (_unused, index) => {
    const day = `2026-07-${String(index + 1).padStart(2, '0')}`;
    return { tradingDay: day as TradingDay, isHalfDay: false, halted: false, sequence: index };
  }).filter((day) => day.tradingDay <= '2026-07-31');
  const first = days[0];
  const last = days[days.length - 1];
  if (first === undefined || last === undefined) throw new Error('the fixture built no days');
  return buildCalendarSlice({
    days,
    coverage: { from: first.tradingDay, to: last.tradingDay },
  });
}

describe('the run over the composed ports', () => {
  test('a definition it cannot serve ends the run and publishes NOTHING', async () => {
    const door = doorOf({
      ...ESTATE,
      statisticDefinitions: [definition('def-st01', 'ST-01', 1, '2026-01-01')],
    });
    const ports = postgresStatisticsPorts(door.db);

    const failure = await runStatisticsRun(ports, {
      asOfTradingDay: '2026-07-31' as TradingDay,
      calendar: syntheticCalendar(),
      gate: { dayClosed: true, selfAuditGreen: true },
    }).catch((error: unknown) => error);

    // ST-01 is servable and the run still refuses, because `runStatisticsRun`
    // reads all five fact sets per window and `fundedLives` is one of them.
    // **THAT IS THE RULING RATHER THAN A LIMITATION**: FM-M12-02 refuses a
    // partial set because a partial set is a SELECTED set, and a run that
    // published only the statistics whose facts happened to be constructible
    // would be that set with the selection taken by an adapter.
    expect(failure).toBeInstanceOf(StatisticsPortUnwired);
    expect((failure as StatisticsPortUnwired).port).toBe('fundedLives');
    expect(door.writes).toEqual([]);
  });

  test('an empty registry halts before any read, and the halt itself cannot be raised', async () => {
    const door = doorOf(ESTATE);
    const ports = postgresStatisticsPorts(door.db);

    // TWO FACTS IN ONE CASE, AND BOTH ARE TRUE OF THIS TREE TODAY. There are no
    // `statistic_definitions` rows anywhere in this repository, so a run against
    // a freshly migrated database halts at `no_effective_definitions`; and the
    // halt is an EVENT, which this deployable has no writer for, so the run
    // cannot even page. `stats.run_halted` is not a row of EVENT_CATALOGUE.
    const failure = await runStatisticsRun(ports, {
      asOfTradingDay: '2026-07-31' as TradingDay,
      calendar: syntheticCalendar(),
      gate: { dayClosed: true, selfAuditGreen: true },
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(StatisticsPortUnwired);
    expect((failure as StatisticsPortUnwired).port).toBe('raiseStatisticsHalt');
    expect(door.writes).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// 8. `publishRun`: one transaction, every column, and the index that decides
// -----------------------------------------------------------------------------

const ROW = {
  statCode: 'ST-03',
  definitionVersion: 1,
  windowStartDay: '2026-06-01' as TradingDay,
  windowEndDay: '2026-08-31' as TradingDay,
  asOfTradingDay: '2026-08-31' as TradingDay,
  measure: 'total' as const,
  value: 170000n,
  valueUnit: 'cents' as const,
  numerator: 170000n,
  numeratorUnit: 'cents' as const,
  denominator: null,
  sampleSize: 4,
  grainKey: null,
  suppressedReason: null,
  inputDigest: Buffer.alloc(32, 7),
};

describe('publishRun', () => {
  test('every row of the run goes into ONE transaction', async () => {
    const door = doorOf(ESTATE);
    const ports = postgresStatisticsPorts(door.db);

    await ports.write.publishRun([ROW, { ...ROW, statCode: 'ST-01', measure: 'rate' }]);

    // `STAT-C1` is DEFERRABLE INITIALLY DEFERRED, so "a publish run emitting one
    // measure emits every measure its definition declares" is only decidable at
    // the commit of the transaction that wrote them all.
    expect(door.transactions).toHaveLength(1);
    expect(door.transactions[0]).toEqual(['publishedStatistics', 'publishedStatistics']);
  });

  test('the columns are written out, and the database keeps its own three', async () => {
    const door = doorOf(ESTATE);
    await postgresStatisticsPorts(door.db).write.publishRun([ROW]);

    expect(door.writes).toEqual([
      {
        key: 'publishedStatistics',
        values: {
          statCode: 'ST-03',
          definitionVersion: 1,
          windowStartDay: '2026-06-01',
          windowEndDay: '2026-08-31',
          asOfTradingDay: '2026-08-31',
          measure: 'total',
          value: 170000n,
          valueUnit: 'cents',
          numerator: 170000n,
          numeratorUnit: 'cents',
          denominator: null,
          sampleSize: 4,
          grainKey: null,
          suppressedReason: null,
          inputDigest: Buffer.alloc(32, 7),
        },
      },
    ]);
    // `id`, `computed_at` and `created_at` are the database's, and
    // `restatement_of` is null by the scope of this run.
    const written = door.writes[0];
    expect(Object.keys(written?.values ?? {})).not.toContain('computedAt');
    expect(Object.keys(written?.values ?? {})).not.toContain('restatementOf');
  });

  test('an empty run opens no transaction and writes nothing', async () => {
    const door = doorOf(ESTATE);
    await postgresStatisticsPorts(door.db).write.publishRun([]);

    expect(door.transactions).toEqual([]);
    expect(door.writes).toEqual([]);
  });

  test('the unique index decides, and the refusal names the cell', async () => {
    const door = doorOf(ESTATE, () => {
      throw Object.assign(new Error('Failed query'), {
        cause: Object.assign(new Error('duplicate key value'), { code: '23505' }),
      });
    });

    // THE CAUSE CHAIN IS WALKED AND NOT THE TOP-LEVEL `code`, which
    // `state-writer.ts` measured: a real second insert arrives as a wrapper
    // whose own `code` is undefined.
    const failure = await postgresStatisticsPorts(door.db)
      .write.publishRun([ROW])
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PublishedWindowAlreadyExists);
    expect((failure as Error).message).toContain('ST-03 v1 total for 2026-06-01 to 2026-08-31');
    expect((failure as Error).message).toContain('INV-M12-03');
  });

  test('a driver error that is not a unique violation is not renamed', async () => {
    const door = doorOf(ESTATE, () => {
      throw Object.assign(new Error('connection terminated'), { code: '57P01' });
    });

    const failure = await postgresStatisticsPorts(door.db)
      .write.publishRun([ROW])
      .catch((error: unknown) => error);

    expect(failure).not.toBeInstanceOf(PublishedWindowAlreadyExists);
    expect((failure as Error).message).toBe('connection terminated');
  });
});
