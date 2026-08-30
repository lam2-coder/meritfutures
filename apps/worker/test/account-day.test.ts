// =============================================================================
// apps/worker/test/account-day.test.ts
// =============================================================================
// `ADR-239` SLICE B's FIRST HALF, WATCHED. `loadAccountDay` refused six fields
// and now resolves five of them, and this file is what says which five and
// proves the sixth is the only one left.
//
// -----------------------------------------------------------------------------
// THE SUBJECT IS THE FOLD'S OWN OUTPUT AND NEVER A ROW THIS FILE TYPED OUT
// -----------------------------------------------------------------------------
// `rule-state-writer.test.ts` states the rule and it applies twice as hard here,
// because this file reads in the direction that one writes: the stored side is
// `foldAccountDay`'s own `RuleStateRow`, rendered into columns, and the assertion
// is that what comes back is the `RuleState` the engine folded. A hand-built row
// would let a field drift out of the engine and into this file, and the reader
// would then be asserted against a shape nothing produces.
//
// THE PLAN'S ASSERTION IS THE SAME PROPERTY ONE LEVEL UP. `fixtures.ts` carries
// Core EOD at 50K "transcribed from M01 Appendix A.1's 50K column", and the rows
// below are `DATA_MODEL` section 11's `plan_versions.rules` example plus the
// materialized size row. If the two resolve to the same `ResolvedPlan`, then the
// stored config and the plan document agree; if they ever stop, this is what
// says so, and it says it in the direction `M01` cares about -- "the marketing
// page and the engine agree to the cent, because both read the same materialized
// number".
//
// -----------------------------------------------------------------------------
// THE `jsonb` LEG IS EXECUTED RATHER THAN MODELLED
// -----------------------------------------------------------------------------
// Every stored `jsonb` value below goes through `JSON.stringify` and back before
// the reader sees it. `ADR-206` section 5 measured that this is the LOSSY leg
// (`jsonb` holds `9007199254740993` exactly and `JSON.parse` does not) and
// `ADR-250` executed it for the gates codec. An object handed straight to the
// reader would carry the `bigint` the column cannot hold, and the suite would be
// green on an encoding the store refuses.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE CANNOT PROVE, STATED RATHER THAN IMPLIED
// -----------------------------------------------------------------------------
// `apps/worker/src/db.ts`'s header draws the line: a recorder "proves which key
// was named, which address was written, which values were set and which reason
// the handle carried. It proves NOTHING about whether the composed predicate
// reaches one row or many." So this file does not prove that
// `rowsWhere('ruleStates', { accountId })` returns one account's rows -- that is
// `packages/db/test/keyed-accessor.test.ts`'s -- and it does not prove that
// Postgres hands `date` back as a string or `bytea` back as bytes. Those are the
// driver's, they are the same assumptions `adapter.ts`'s four shipped ports
// already make, and a case here claiming them would be agreeing with its own
// fake.
// =============================================================================

import { describe, expect, test } from 'vitest';

import type { SystemTx } from '@merit/db';
import { encodeEngineGates } from '@merit/rules-engine';

import { BatchPortUnwired, BatchRowError, postgresBatchPorts } from '../src/batch/adapter.ts';
import type { BatchTx } from '../src/batch/adapter.ts';
import { resolveAccountDay } from '../src/batch/adapter.ts';
import { foldAccountDay } from '../src/batch/nightly.ts';
import type { RuleStateRow } from '../src/batch/ports.ts';
import type { WorkerDb } from '../src/db.ts';
import {
  ACCOUNT_A,
  ACCOUNT_B,
  CALENDAR,
  CORE_EOD_RULES,
  DAY_ONE,
  ENGINE_VERSION,
  LIVE_MARK,
  PLAN,
  PLAN_VERSION_ID,
  accountDay,
  accountRow,
  markRow,
  planVersionRow,
  sizeGrid,
  sizeRow,
  storedJson,
  td,
} from './fixtures.ts';

// -----------------------------------------------------------------------------
// A door that holds rows rather than one that connects
// -----------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Tables = Readonly<Record<string, readonly Row[]>>;

/** `rows`, `rowsWhere` and `rowAt` over a bag of rows, and no other verb. */
function fakeTx(tables: Tables): BatchTx {
  const of = (key: string): readonly Row[] => tables[key] ?? [];
  const matches = (row: Row, where: Readonly<Record<string, unknown>>): boolean =>
    Object.entries(where).every(([column, value]) => row[column] === value);

  return {
    rows: (key: string) => Promise.resolve([...of(key)]),
    rowsWhere: (key: string, where: Readonly<Record<string, unknown>>) =>
      Promise.resolve(of(key).filter((row) => matches(row, where))),
    rowAt: (key: string, at: Readonly<Record<string, unknown>>) =>
      Promise.resolve(of(key).find((row) => matches(row, at))),
  } as unknown as BatchTx;
}

function dbOf(tables: Tables): WorkerDb {
  return {
    batch<T>(fn: (tx: SystemTx) => Promise<T>): Promise<T> {
      return fn(fakeTx(tables) as unknown as SystemTx);
    },
  };
}

// -----------------------------------------------------------------------------
// The rows, in the property names `packages/db/src/schema.ts` declares
// -----------------------------------------------------------------------------

const DAY = DAY_ONE.tradingDay;

/** One `rule_states` row, from the fold rather than from a literal. */
function foldedRow(): RuleStateRow {
  const fold = foldAccountDay(accountDay(ACCOUNT_A), CALENDAR, ENGINE_VERSION, 1);
  if (fold.kind !== 'row') throw new Error(`the fixture day was refused: ${fold.kind}`);
  return fold.row;
}

function foldedState(): NonNullable<Awaited<ReturnType<typeof resolveAccountDay>>>['prior'] {
  const fold = foldAccountDay(accountDay(ACCOUNT_A), CALENDAR, ENGINE_VERSION, 1);
  if (fold.kind !== 'row') throw new Error(`the fixture day was refused: ${fold.kind}`);
  return fold.state;
}

function ruleStateRow(row: RuleStateRow, overrides: Row = {}): Row {
  return {
    accountId: row.accountId,
    tradingDay: row.tradingDay,
    phase: row.phase,
    floorCents: row.floorCents,
    floorLocked: row.floorLocked,
    floorOpenCents: row.floorOpenCents,
    highWaterBalanceCents: row.highWaterBalanceCents,
    balanceCents: row.balanceCents,
    withdrawableCents: row.withdrawableCents,
    tradedDaysCount: row.tradedDaysCount,
    winDaysCount: row.winDaysCount,
    consistencyBestDayCents: row.consistencyBestDayCents,
    consistencyPeriodProfitCents: row.consistencyPeriodProfitCents,
    consistencyPeriodStartDay: row.consistencyPeriodStartDay,
    payoutsSettledCount: row.payoutsSettledCount,
    payoutAnchorDay: row.payoutAnchorDay,
    cadenceAnchorDay: row.cadenceAnchorDay,
    engineEligible: row.engineEligible,
    engineGates: storedJson(encodeEngineGates(row.engineGates)),
    contextGates: storedJson(row.contextGates),
    stateHash: row.stateHash,
    engineVersion: row.engineVersion,
    calendarRevisionId: 1n,
    lifetimeSettledCents: row.lifetimeSettledCents,
    breached: row.breached,
    breachKind: row.breachKind,
    ...overrides,
  };
}

function payoutRow(overrides: Row = {}): Row {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    accountId: ACCOUNT_A,
    approvedCents: 120_000n,
    basisTradingDay: td('2026-08-11'),
    status: 'settled',
    payoutOrdinal: 1,
    settledTradingDay: td('2026-08-11'),
    effectiveTradingDay: DAY,
    ...overrides,
  };
}

/** The whole world, with every table this reader touches populated. */
function world(overrides: Partial<Record<string, readonly Row[]>> = {}): Tables {
  return {
    accounts: [accountRow()],
    planVersions: [planVersionRow()],
    planVersionSizes: sizeGrid(),
    dailyMarks: [markRow()],
    ruleStates: [],
    payoutRequests: [],
    ...overrides,
  };
}

const resolve = (tables: Tables, accountId = ACCOUNT_A, day = DAY) =>
  resolveAccountDay(fakeTx(tables), accountId, day);

// -----------------------------------------------------------------------------
// 1. The five fields
// -----------------------------------------------------------------------------

describe('1. five of the six fields an `AccountDay` carries are resolved off rows', () => {
  test('1.1 `plan` is the account`s PINNED version at its OWN size, and it is M01 Appendix A.1', async () => {
    // THE ASSERTION IS AGAINST THE TRANSCRIPTION AND NOT AGAINST A COPY OF THE
    // ROWS. `fixtures.PLAN` comes from M01 Appendix A.1's 50K column and the
    // rows come from DATA_MODEL section 11 plus the materialized grid, so this
    // case fires when the two documents stop agreeing as well as when this
    // reader stops reading.
    const day = await resolve(world());

    expect(day?.plan).toEqual(PLAN);
  });

  test('1.2 the size row is chosen by the account`s `size_cents` and not by grid order', async () => {
    // `0004:220`'s unique key is `(plan_version_id, size_cents)` and
    // `packages/db` refuses it as an ADDRESS, so the match happens in this
    // process. A reader that took the first row of the grid would put the 25K
    // contract on a 50K account, and every cents value the fold reads is on that
    // row.
    const day = await resolve(world({ accounts: [accountRow({ sizeCents: 10_000_000n })] }));

    expect(day?.plan.sizeCents).toBe(10_000_000n);
    expect(day?.plan.eval?.profitTargetCents).toBe(600_000n);
    expect(day?.plan.funded.drawdown.drawdownCents).toBe(500_000n);
  });

  test('1.3 `prior` is the state the engine folded, through the columns and back', async () => {
    const row = foldedRow();
    const day = await resolve(
      world({ ruleStates: [ruleStateRow(row, { tradingDay: td('2026-08-09') })] }),
    );

    // EVERY FIELD, COMPARED AT ONCE. `RuleState` has twenty-one and a case that
    // checked three would be green on a reader that dropped the other eighteen.
    expect(day?.prior).toEqual({ ...foldedState(), tradingDay: td('2026-08-09') });
  });

  test('1.4 `prior` is `null` on the account`s first day', async () => {
    const day = await resolve(world());

    expect(day?.prior).toBeNull();
  });

  test('1.5 `mark` is the live row, with `source_hash` rendered as the hex of its bytes', async () => {
    const day = await resolve(world());

    expect(day?.mark).toEqual(LIVE_MARK);
  });

  test('1.6 `settlements` are the SETTLED requests effective ON THIS DAY, in ordinal order', async () => {
    const day = await resolve(
      world({
        payoutRequests: [
          payoutRow({ id: 'b', payoutOrdinal: 2, approvedCents: 90_000n }),
          payoutRow({ id: 'a', payoutOrdinal: 1 }),
          // Settled, and its balance moved on ANOTHER day.
          payoutRow({ id: 'c', payoutOrdinal: 3, effectiveTradingDay: td('2026-08-11') }),
          // Effective today and NOT settled: no money has moved.
          payoutRow({ id: 'd', payoutOrdinal: 4, status: 'approved' }),
          // Another account's.
          payoutRow({ id: 'e', payoutOrdinal: 5, accountId: ACCOUNT_B }),
        ],
      }),
    );

    expect(day?.settlements.map((s) => s.payoutRequestId)).toEqual(['a', 'b']);
    expect(day?.settlements[0]).toEqual({
      payoutRequestId: 'a',
      ordinal: 1,
      approvedCents: 120_000n,
      basisTradingDay: td('2026-08-11'),
      effectiveTradingDay: DAY,
    });
  });

  test('1.7 `openedOn` is `accounts.opened_on`, read and never derived', async () => {
    const day = await resolve(world({ accounts: [accountRow({ openedOn: td('2026-08-10') })] }));

    expect(day?.openedOn).toBe(td('2026-08-10'));
  });
});

// -----------------------------------------------------------------------------
// 2. `prior` is strictly before the day, which is INV-14
// -----------------------------------------------------------------------------

describe('2. the prior state is the latest row STRICTLY BEFORE the day', () => {
  test('2.1 a row stored FOR this day is not a prior', async () => {
    // DO-1 refuses a mark that is not strictly after the prior state's day. A
    // reader that admitted the day's own row would fold the day against itself,
    // and the insert would then meet `rule_states_account_day_uq` rather than
    // the fold refusing, which reports a duplicate where the fact is a re-run.
    const row = foldedRow();
    const day = await resolve(
      world({
        ruleStates: [
          ruleStateRow(row, { tradingDay: td('2026-08-09'), balanceCents: 4_000_000n }),
          ruleStateRow(row, { tradingDay: DAY, balanceCents: 9_999_999n }),
        ],
      }),
    );

    expect(day?.prior?.tradingDay).toBe(td('2026-08-09'));
    expect(day?.prior?.balanceCents).toBe(4_000_000n);
  });

  test('2.2 the LATEST prior wins, whatever order the accessor returned', async () => {
    const row = foldedRow();
    const day = await resolve(
      world({
        ruleStates: [
          ruleStateRow(row, { tradingDay: td('2026-08-06'), balanceCents: 1n }),
          ruleStateRow(row, { tradingDay: td('2026-08-09'), balanceCents: 3n }),
          ruleStateRow(row, { tradingDay: td('2026-08-07'), balanceCents: 2n }),
        ],
      }),
    );

    expect(day?.prior?.balanceCents).toBe(3n);
  });

  test('2.3 another account`s stored rows are not this account`s prior', async () => {
    const row = foldedRow();
    const day = await resolve(
      world({
        ruleStates: [ruleStateRow(row, { accountId: ACCOUNT_B, tradingDay: td('2026-08-09') })],
      }),
    );

    expect(day?.prior).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// 3. The live mark decides the `null` arm
// -----------------------------------------------------------------------------

describe('3. the mark is the LIVE one, and its absence is a whole answer', () => {
  test('3.1 no mark on the day is `null` rather than a refusal', async () => {
    expect(await resolve(world({ dailyMarks: [] }))).toBeNull();
  });

  test('3.2 a SUPERSEDED mark is not a live one', async () => {
    // `0014`'s grain: a correction is a NEW row with the old one pointing at it,
    // and `ports.ts` says a superseded mark is never folded. A reader that took
    // it would fold the numbers Merit has already withdrawn.
    expect(await resolve(world({ dailyMarks: [markRow({ supersededBy: 7n })] }))).toBeNull();
  });

  test('3.3 the correction is folded and the row it superseded is not', async () => {
    const day = await resolve(
      world({
        dailyMarks: [
          markRow({ supersededBy: 7n, closingBalanceCents: 1n }),
          markRow({ closingBalanceCents: DAY_ONE.closingBalanceCents }),
        ],
      }),
    );

    expect(day?.mark).toEqual(LIVE_MARK);
  });

  test('3.4 TWO live rows on one day is refused rather than resolved', async () => {
    await expect(
      resolve(world({ dailyMarks: [markRow(), markRow({ closingBalanceCents: 1n })] })),
    ).rejects.toThrow(BatchRowError);
  });
});

// -----------------------------------------------------------------------------
// 4. Nothing is invented at the boundary
// -----------------------------------------------------------------------------

describe('4. a stored value this reader cannot read stops the batch by name', () => {
  test('4.1 an absent plan key is named rather than defaulted', async () => {
    // `min_settlement_lag_trading_days` is the key M01 section 2.4 requires and
    // DATA_MODEL section 11's example does not carry. Writing `0` here would be
    // the literal in engine code M01 refused, so the row is refused and the key
    // is named.
    const rules = {
      ...CORE_EOD_RULES,
      phase_funded: Object.fromEntries(
        Object.entries(CORE_EOD_RULES.phase_funded).filter(
          ([key]) => key !== 'min_settlement_lag_trading_days',
        ),
      ),
    };

    await expect(resolve(world({ planVersions: [planVersionRow(rules)] }))).rejects.toThrow(
      /min_settlement_lag_trading_days is absent/,
    );
  });

  test('4.2 a cents value past `Number.MAX_SAFE_INTEGER` is refused rather than rounded', async () => {
    // `jsonb` numbers are `numeric` in Postgres and `number` after `JSON.parse`,
    // so this value has already lost digits by the time the reader sees it. A
    // cap silently reduced by rounding is a payout ceiling nobody published.
    const grid = [sizeRow({ payoutCapScheduleCents: [{ from_ordinal: 1, cap_cents: 2 ** 53 }] })];

    await expect(resolve(world({ planVersionSizes: grid }))).rejects.toThrow(
      /integer cents were required/,
    );
  });

  test('4.3 a drawdown type outside the published vocabulary is named', async () => {
    const rules = {
      ...CORE_EOD_RULES,
      phase_funded: {
        ...CORE_EOD_RULES.phase_funded,
        drawdown: { ...CORE_EOD_RULES.phase_funded.drawdown, type: 'trailing_intraday' },
      },
    };

    await expect(resolve(world({ planVersions: [planVersionRow(rules)] }))).rejects.toThrow(
      BatchRowError,
    );
  });

  test('4.4 `intraday_trailing` is ADMITTED here and refused by `resolvePlan`, which is R-17', async () => {
    // CV-01 is the only thing between the three-member published union and the
    // two-member resolved one. A decoder that narrowed to two would make that
    // refusal unreachable and its test vacuous, so the refusal has to arrive
    // from the engine and name CV-01.
    const rules = {
      ...CORE_EOD_RULES,
      phase_funded: {
        ...CORE_EOD_RULES.phase_funded,
        drawdown: { ...CORE_EOD_RULES.phase_funded.drawdown, type: 'intraday_trailing' },
      },
    };

    await expect(resolve(world({ planVersions: [planVersionRow(rules)] }))).rejects.toThrow(
      /CV-01/,
    );
  });

  test('4.5 a `breached` row with no `breach_kind` is refused, as 0065 refuses it', async () => {
    const row = foldedRow();
    const seeded = ruleStateRow(row, { tradingDay: td('2026-08-09'), breached: true });

    await expect(resolve(world({ ruleStates: [seeded] }))).rejects.toThrow(
      /rule_states_breach_flag_matches_kind/,
    );
  });

  test('4.6 a size the account is pinned to and the grid does not carry is refused', async () => {
    await expect(
      resolve(world({ accounts: [accountRow({ sizeCents: 7_777_777n })] })),
    ).rejects.toThrow(/plan_version_sizes holds no row/);
  });

  test('4.7 an account row that is not there is refused rather than defaulted', async () => {
    await expect(resolve(world({ accounts: [] }))).rejects.toThrow(/accounts holds no row/);
  });
});

// -----------------------------------------------------------------------------
// 5. The port, and the one field that still refuses
// -----------------------------------------------------------------------------

describe('5. `loadAccountDay` answers what it can and refuses on `external` alone', () => {
  test('5.1 an account with no live mark is answered `null` over the real port', async () => {
    const ports = postgresBatchPorts(dbOf(world({ dailyMarks: [] })));

    expect(await ports.read.loadAccountDay(ACCOUNT_A, DAY)).toBeNull();
  });

  test('5.2 an account WITH a live mark refuses, and the refusal names `AccountDay.external`', async () => {
    const ports = postgresBatchPorts(dbOf(world()));

    await expect(ports.read.loadAccountDay(ACCOUNT_A, DAY)).rejects.toThrow(BatchPortUnwired);
    await expect(ports.read.loadAccountDay(ACCOUNT_A, DAY)).rejects.toThrow(
      /`AccountDay.external` is an `ExternalGates`/,
    );
  });

  test('5.3 the refusal cites ADR-248 and R-38`s two grains, and NOT the codec', async () => {
    // A REASON THAT NAMED A DISCHARGED BLOCKER IS THE DEFECT THIS ROW WAS SENT
    // TO FIND. The retired wording is asserted GONE and the live one asserted
    // present, both from the message the port actually throws.
    const ports = postgresBatchPorts(dbOf(world()));
    const error = await ports.read.loadAccountDay(ACCOUNT_A, DAY).catch((e: unknown) => e);
    const message = error instanceof Error ? error.message : String(error);

    expect(message).toContain('ADR-248');
    expect(message).toContain('R-38');
    expect(message).not.toContain('codec');
    expect(message).not.toContain('DECODER');
  });

  test('5.4 the refusal carries the WITNESS that the other five resolved', async () => {
    // A refusal that named only the missing field is indistinguishable from a
    // port that read nothing, and reading everything else is this slice's whole
    // claim.
    const ports = postgresBatchPorts(dbOf(world()));
    const error = await ports.read.loadAccountDay(ACCOUNT_A, DAY).catch((e: unknown) => e);
    const message = error instanceof Error ? error.message : String(error);

    expect(message).toContain('The other five resolved');
    expect(message).toContain(ACCOUNT_A);
    expect(message).toContain(PLAN_VERSION_ID);
    expect(message).toContain('5000000 cents');
    expect(message).toContain(`opened_on ${DAY}`);
  });

  test('5.5 `accountDaysFrom` refuses on the gates AND on a walk nobody wrote', async () => {
    const ports = postgresBatchPorts(dbOf(world()));
    const error = await ports.read.accountDaysFrom(ACCOUNT_A).catch((e: unknown) => e);
    const message = error instanceof Error ? error.message : String(error);

    expect(message).toContain('AccountDay.external');
    expect(message).toContain('INV-04');
    expect(message).toContain('no session has written that walk');
  });
});
