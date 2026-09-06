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

import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import type { SystemTx } from '@merit/db';
import {
  encodeEngineGates,
  ExternalGatesRefusal,
  PAYOUT_IN_FLIGHT_STATUSES,
} from '@merit/rules-engine';

import { BatchRowError, postgresBatchPorts } from '../src/batch/adapter.ts';
import type { BatchTx } from '../src/batch/adapter.ts';
import { resolveAccountDay } from '../src/batch/adapter.ts';
import { foldAccountDay } from '../src/batch/nightly.ts';
import type { RuleStateRow } from '../src/batch/ports.ts';
import type { WorkerDb } from '../src/db.ts';
import {
  ACCOUNT_A,
  ACCOUNT_B,
  CALENDAR,
  CLEAR,
  CORE_EOD_RULES,
  DAY_ONE,
  ENGINE_VERSION,
  KYC_INITIAL,
  LIVE_MARK,
  PLAN,
  accountDay,
  accountRow,
  identityRow,
  kycRow,
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

/**
 * The whole world, with every table this reader touches populated.
 *
 * **IT GREW TWO TABLES WITH `ADR-260` AND THE DEFAULT IS THE CLEAR ACCOUNT.**
 * `identities` is the account's owner and `kycVerifications` is a one-row chain
 * whose head is `verified`, so `world()` resolves to `CLEAR` and every case
 * about a veto overrides exactly one thing.
 */
function world(overrides: Partial<Record<string, readonly Row[]>> = {}): Tables {
  return {
    accounts: [accountRow()],
    identities: [identityRow()],
    kycVerifications: [kycRow()],
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
// 5. The port, which now answers whole
// -----------------------------------------------------------------------------

describe('5. `loadAccountDay` answers a WHOLE `AccountDay` and refuses no field', () => {
  test('5.1 an account with no live mark is answered `null` over the real port', async () => {
    const ports = postgresBatchPorts(dbOf(world({ dailyMarks: [] })));

    expect(await ports.read.loadAccountDay(ACCOUNT_A, DAY)).toBeNull();
  });

  test('5.2 an account WITH a live mark resolves, and `external` is the sixth field', async () => {
    // **THE CASE THIS FILE WAS BUILT AROUND, INVERTED.** It asserted a refusal
    // naming `AccountDay.external` from `ADR-258` until `ADR-260` wrote the
    // resolver, and the inversion is the deliverable rather than a test repair:
    // the port that stopped the fold at the first account now returns every
    // field the fold takes.
    const ports = postgresBatchPorts(dbOf(world()));
    const day = await ports.read.loadAccountDay(ACCOUNT_A, DAY);

    expect(day).not.toBeNull();
    expect(day?.external).toEqual(CLEAR);
  });

  test('5.3 the retired refusal is GONE from this port rather than reworded', async () => {
    // A REASON THAT NAMED A DISCHARGED BLOCKER IS THE DEFECT THIS FILE'S OWN
    // SECTION 5 WAS BUILT TO FIND, and the same predicate now runs in the other
    // direction. If any arm of this port still threw `BatchPortUnwired`, or the
    // retired sentence survived anywhere the port can reach, this goes red.
    const ports = postgresBatchPorts(dbOf(world()));

    await expect(ports.read.loadAccountDay(ACCOUNT_A, DAY)).resolves.not.toBeNull();
    const source = readFileSync(new URL('../src/batch/adapter.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('ACCOUNT_DAY_BLOCKER');
    expect(source).not.toContain('NOT CONSTRUCTIBLE in this');
  });

  test('5.4 the whole day is what the fold takes, and the fold takes it', async () => {
    // THE STRONGEST FORM OF "SIX OF SIX" AVAILABLE HERE: the value the reader
    // returns is handed to `foldAccountDay` unmodified, which is what
    // `runNightlyBatch` does with it, and the fold produces a row. A day missing
    // a field would not compile; a day carrying a wrong one folds to a different
    // row, and `contextGates` below is where `external` lands.
    const ports = postgresBatchPorts(dbOf(world()));
    const day = await ports.read.loadAccountDay(ACCOUNT_A, DAY);
    if (day === null) throw new Error('the fixture day resolved to null');

    const fold = foldAccountDay(day, CALENDAR, ENGINE_VERSION, 1);

    expect(fold.kind).toBe('row');
    if (fold.kind !== 'row') return;
    expect(fold.row.contextGates.accountActive.status).toBe('active');
    expect(fold.row.contextGates.kycVerified.state).toBe('verified');
    expect(fold.row.contextGates.notFrozen.pass).toBe(true);
    expect(fold.row.contextGates.reconClear.pass).toBe(true);
    expect(fold.row.contextGates.noPayoutInFlight.pass).toBe(true);
  });

  test('5.5 `accountDaysFrom` no longer refuses, and both retired reasons are GONE', async () => {
    // **THIS CASE READ "`accountDaysFrom` STILL REFUSES" AND `ADR-346` WROTE THE
    // WALK IT WAS WAITING FOR.** It is asserted in the other direction rather
    // than deleted, which is `5.3`'s own move one case up: the port is named as
    // one that must NOT refuse, so an unwired arm restored to it is a named
    // failure. The two retired blocker constants are swept for by NAME as well,
    // because the file's rule for a retired reason is deletion rather than
    // rewording and a constant left behind reads as live to every grep.
    const ports = postgresBatchPorts(dbOf(world()));

    await expect(ports.read.accountDaysFrom(ACCOUNT_A)).resolves.toHaveLength(1);
    await expect(ports.read.storedRuleStates(ACCOUNT_A)).resolves.toEqual([]);

    const source = readFileSync(new URL('../src/batch/adapter.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('ACCOUNT_DAYS_FROM_BLOCKER');
    expect(source).not.toContain('DECODER_BLOCKER');
    expect(source).not.toContain('no session has written that walk');
  });
});

// -----------------------------------------------------------------------------
// 6. `external`: five facts off four tables, and no permissive default on any leg
// -----------------------------------------------------------------------------
// **THE NARROWING IS NOT TESTED HERE AND THAT IS THE DIVISION OF LABOUR RATHER
// THAN A GAP.** `packages/rules-engine/test/external-gates.test.ts` owns what
// `resolveExternalGates` DOES with a value; this section owns which COLUMN each
// value comes from, which is the half a pure test cannot see. So every case
// below moves a column and reads the member, and the pair is the wiring.

describe('6. the sixth field is five facts read off four tables', () => {
  const gatesOf = async (tables: Tables) => (await resolve(tables))?.external;

  test('6.1 the clear account resolves to `CLEAR`, every member of it', async () => {
    expect(await gatesOf(world())).toEqual(CLEAR);
  });

  test('6.2 `payoutsFrozen` is the IDENTITY`s flag OR the ACCOUNT`s, and each alone is enough', async () => {
    // **THE `OR` IS THE WHOLE FACT AND A READER THAT TOOK ONE SIDE WOULD PASS
    // THE OTHER CASE.** `0002:50` and `0007:83` are two columns because an
    // investigation can be about one account or about a person, and an account
    // rendered `false` while its owner is frozen is a gate saying pay them.
    expect(
      (await gatesOf(world({ identities: [identityRow({ payoutsFrozen: true })] })))?.payoutsFrozen,
    ).toBe(true);
    expect(
      (await gatesOf(world({ accounts: [accountRow({ payoutsFrozen: true })] })))?.payoutsFrozen,
    ).toBe(true);
    expect((await gatesOf(world()))?.payoutsFrozen).toBe(false);
  });

  test('6.3 `reconBlocked` is the ACCOUNT`s column and has no identity half', async () => {
    // `0007:87`. The identity row below carries no such column at all, which is
    // the schema rather than the fixture: there is no `identities.recon_blocked`.
    expect(
      (await gatesOf(world({ accounts: [accountRow({ reconBlocked: true })] })))?.reconBlocked,
    ).toBe(true);
  });

  test('6.4 `accountStatus` is `accounts.status`, carried through unnarrowed', async () => {
    expect(
      (await gatesOf(world({ accounts: [accountRow({ status: 'breached' })] })))?.accountStatus,
    ).toBe('breached');
  });

  test('6.5 `provisioning_pending` REFUSES rather than folding, and names the account', async () => {
    // **THE TRAP, RUN.** `account_status` declares SEVEN members and
    // `AccountStatus` takes SIX. The seventh is refused here rather than
    // admitted, because widening the engine's union to make this map total would
    // amend a frozen plan through a type and would decide, in a reader, what a
    // half-provisioned account is worth to R-40.
    const tables = world({ accounts: [accountRow({ status: 'provisioning_pending' })] });
    const error = await resolve(tables).catch((e: unknown) => e);
    const message = error instanceof Error ? error.message : String(error);

    expect(error).toBeInstanceOf(ExternalGatesRefusal);
    expect(message).toContain('provisioning_pending');
    expect(message).toContain(ACCOUNT_A);
    // AND IT IS NOT ANSWERED `null`. That arm means no live mark, and reusing it
    // would count this account as `absent` in the nightly report.
    expect(error).not.toBeNull();
  });

  test('6.6 `kycState` is the head of the supersession chain and not the newest row', async () => {
    // `SD-M19-01`: a re-verification is a NEW ROW pointing at the one it
    // supersedes, so the head is the row NOTHING supersedes. The superseded row
    // below says `verified` and the head says `expired`; a reader taking the
    // first row of the chain would pay somebody whose verification lapsed.
    const chain = [
      kycRow({ id: KYC_INITIAL, state: 'verified' }),
      kycRow({
        id: 'd3b8a2c4-1f56-4e79-9a03-6b7c8d5e4f21',
        state: 'expired',
        supersedes: KYC_INITIAL,
      }),
    ];

    expect((await gatesOf(world({ kycVerifications: chain })))?.kycState).toBe('expired');
  });

  test('6.7 no `kyc_verifications` row at all is `kyc_required`, which is a READING', async () => {
    // The enum's own word for an identity that has never been verified. It is
    // the refusing value on R-40's second gate, so it is safe, and it is a fact
    // about the rows rather than a default chosen when they could not be read.
    expect((await gatesOf(world({ kycVerifications: [] })))?.kycState).toBe('kyc_required');
  });

  test('6.8 a chain with TWO heads REFUSES rather than failing closed to `kyc_required`', async () => {
    // **THIS IS WHERE THIS RESOLVER DIVERGES FROM THE TWO ROUTE READERS, ON
    // PURPOSE.** `currentKycState` answers `kyc_required` on an ambiguous chain,
    // and on a door that DISPLAYS the value that is right. Here the value is
    // folded into a stored row, where `kyc_required` is indistinguishable from
    // "we could not tell".
    const chain = [
      kycRow({ id: KYC_INITIAL }),
      kycRow({ id: 'd3b8a2c4-1f56-4e79-9a03-6b7c8d5e4f21' }),
    ];
    const error = await resolve(world({ kycVerifications: chain })).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ExternalGatesRefusal);
    expect((error as ExternalGatesRefusal).legs).toEqual(['kycState']);
  });

  test('6.9 the chain read is the OWNING identity`s and travels through `identity_id`', async () => {
    // A reader that took every `kyc_verifications` row it could see would read
    // another identity's chain into this account's gate. The row below belongs
    // to nobody this account owns, so the account's own chain is empty and the
    // answer is `kyc_required` rather than `verified`.
    const chain = [kycRow({ identityId: '9d1e2f3a-4b5c-4d6e-8f70-a1b2c3d4e5f6' })];

    expect((await gatesOf(world({ kycVerifications: chain })))?.kycState).toBe('kyc_required');
  });

  test('6.10 `hasPayoutInFlight` is true on each of the THREE statuses the index names', async () => {
    // `payout_requests_no_in_flight_uq`'s predicate, ruled at the ACCOUNT by
    // ADR-254. Each status is asserted separately, because a set comparison
    // green on two of three is a veto that fires two thirds of the time.
    for (const status of PAYOUT_IN_FLIGHT_STATUSES)
      expect(
        (await gatesOf(world({ payoutRequests: [payoutRow({ status })] })))?.hasPayoutInFlight,
        `\`${status}\` is in the index predicate and did not read as in flight`,
      ).toBe(true);
  });

  test('6.11 and false on the two the index does NOT name', async () => {
    for (const status of ['settled', 'failed'])
      expect(
        (await gatesOf(world({ payoutRequests: [payoutRow({ status })] })))?.hasPayoutInFlight,
        `\`${status}\` is outside the index predicate and read as in flight`,
      ).toBe(false);
  });

  test('6.12 it is the SUBJECT ACCOUNT`s rows and never the identity`s (ADR-254)', async () => {
    // **THE GRAIN, RUN.** An in-flight request on a SIBLING account of the same
    // identity does not raise this account's flag. The identity reading would
    // refuse nine of a copy trader's ten accounts under a ceiling `OQ-7`
    // declined to impose.
    const sibling = payoutRow({ accountId: ACCOUNT_B, status: 'approved' });

    expect((await gatesOf(world({ payoutRequests: [sibling] })))?.hasPayoutInFlight).toBe(false);
  });

  test('6.13 a `payout_requests.status` outside the declared vocabulary REFUSES', async () => {
    // **THE VOCABULARY HAS MOVED TWICE ON THIS TABLE** (ADR-028 retired
    // `transferring`, ADR-040 added `held_pending_review`), so a sixth member is
    // the likely future. Reading it as not-in-flight would be R-38 stopping
    // nobody, which is the permissive default this row forbids on every leg.
    const error = await resolve(
      world({ payoutRequests: [payoutRow({ status: 'transferring' })] }),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ExternalGatesRefusal);
    expect((error as ExternalGatesRefusal).legs).toEqual(['hasPayoutInFlight']);
  });

  test('6.14 an `identities` row a NOT NULL foreign key requires is REFUSED, never `false`', async () => {
    // `accounts.identity_id` is `uuid NOT NULL REFERENCES identities(id)`, so an
    // owner that cannot be read is a foreign key that did not hold.
    // `identities.payouts_frozen` is a VETO, and reading it as `false` because
    // the row was absent is exactly the shape `R-41` makes expensive.
    await expect(resolve(world({ identities: [] }))).rejects.toThrow(/identities holds no row/);
  });

  test('6.15 every refusing leg is reported at ONCE rather than one run at a time', async () => {
    // `R-41` conjoins all five, so the useful report is the whole set: a
    // resolver throwing on the first bad column sends an operator back three
    // times for three columns of one account.
    const error = await resolve(
      world({
        accounts: [accountRow({ status: 'provisioning_pending' })],
        kycVerifications: [
          kycRow({ id: KYC_INITIAL }),
          kycRow({ id: 'd3b8a2c4-1f56-4e79-9a03-6b7c8d5e4f21' }),
        ],
        payoutRequests: [payoutRow({ status: 'transferring' })],
      }),
    ).catch((e: unknown) => e);

    expect((error as ExternalGatesRefusal).legs).toEqual([
      'accountStatus',
      'kycState',
      'hasPayoutInFlight',
    ]);
    expect((error as ExternalGatesRefusal).accountId).toBe(ACCOUNT_A);
  });
});
