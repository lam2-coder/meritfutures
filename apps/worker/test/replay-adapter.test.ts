// =============================================================================
// apps/worker/test/replay-adapter.test.ts
// =============================================================================
// `INV-04` RUN AGAINST A DOOR RATHER THAN AGAINST A DOUBLE. `ADR-346`.
//
// `replay.test.ts` owns what `runReplayAudit` DECIDES and hands it hand-built
// ports. This file owns the other half: whether `postgresBatchPorts` can supply
// those ports off rows, and what the audit does when it can. The two questions
// are separable and were separated for eleven sessions, which is exactly how a
// self-audit comes to have no adapter.
//
// -----------------------------------------------------------------------------
// THE STORED SIDE IS THE FOLD'S OWN OUTPUT AND NEVER A ROW THIS FILE TYPED OUT
// -----------------------------------------------------------------------------
// `account-day.test.ts` states the rule and it binds harder here, because this
// file compares two things that are supposed to be equal: a hand-built stored
// row would let a field drift out of the engine and into this file, and the
// suite would then be asserting that the adapter agrees with the suite. Every
// `rule_states` row below comes from `foldAccountDay` over the days the ADAPTER
// itself returned, chained prior to prior, which is what `runNightlyBatch` does
// with them. So a clean audit here means the walk and the row reader agree with
// the fold, and a seeded one means they disagree in exactly the seeded place.
//
// -----------------------------------------------------------------------------
// WHAT A GREEN AUDIT DOES NOT COVER, ASSERTED RATHER THAN SAID
// -----------------------------------------------------------------------------
// Section 5 is the honest half of the falsification. `IMPLEMENTED_RULES` carries
// forty-six of the fifty rule ids and the four absent ones are R-01, R-05, R-11
// and R-20, which `rules.ts` records as discharged OUTSIDE the engine rather than
// as unwritten. A replay folds the engine, so it cannot audit any of the four,
// and R-11 is the sharp one: the live-mark predicate is applied by the WALK, so
// the audit folds marks selected by the very rule it would have to check, and a
// wrong selection makes both sides agree. That is not a gap this row can close
// and it is a claim a green report should not be read as making.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE CANNOT PROVE
// -----------------------------------------------------------------------------
// `apps/worker/src/db.ts`'s header draws the line and `account-day.test.ts`
// quotes it: a recorder proves which key was named and which values were set,
// and proves nothing about whether the composed predicate reaches one row or
// many. So the fake below answers `rowsWhere('ruleStates', { accountId })` with
// the rows carrying that account, and that IS the assumption rather than a
// finding; `packages/db/test/keyed-accessor.test.ts` owns the predicate.
// =============================================================================

import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import type { SystemTx } from '@merit/db';
import { IMPLEMENTED_RULES, encodeEngineGates } from '@merit/rules-engine';
import type { CalendarSlice } from '@merit/rules-engine';

import { BatchPortUnwired, BatchRowError, postgresBatchPorts } from '../src/batch/adapter.ts';
import type { BatchTx } from '../src/batch/adapter.ts';
import { foldAccountDay } from '../src/batch/nightly.ts';
import { stateHash } from '../src/batch/state-hash.ts';
import type { AccountDay, RuleStateRow } from '../src/batch/ports.ts';
import { auditAccount, runReplayAudit, ReplayAuditRefusal } from '../src/batch/replay.ts';
import type { WorkerDb } from '../src/db.ts';
import {
  ACCOUNT_A,
  ACCOUNT_B,
  DAY_ONE,
  ENGINE_VERSION,
  SOURCE_BYTES,
  accountRow,
  identityRow,
  kycRow,
  markRow,
  planVersionRow,
  sizeGrid,
  storedJson,
  td,
} from './fixtures.ts';

// -----------------------------------------------------------------------------
// A door that holds rows rather than one that connects
// -----------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Tables = Readonly<Record<string, readonly Row[]>>;

/** Every read the fake served, so a walk that grew per day is a named failure. */
interface Reads {
  readonly log: string[];
}

function fakeTx(tables: Tables, reads: Reads): BatchTx {
  const of = (key: string): readonly Row[] => tables[key] ?? [];
  const matches = (row: Row, where: Readonly<Record<string, unknown>>): boolean =>
    Object.entries(where).every(([column, value]) => row[column] === value);

  return {
    rows: (key: string) => {
      reads.log.push(key);
      return Promise.resolve([...of(key)]);
    },
    rowsWhere: (key: string, where: Readonly<Record<string, unknown>>) => {
      reads.log.push(key);
      return Promise.resolve(of(key).filter((row) => matches(row, where)));
    },
    rowAt: (key: string, at: Readonly<Record<string, unknown>>) => {
      reads.log.push(key);
      return Promise.resolve(of(key).find((row) => matches(row, at)));
    },
  } as unknown as BatchTx;
}

function dbOf(tables: Tables, reads: Reads = { log: [] }): WorkerDb {
  return {
    batch<T>(fn: (tx: SystemTx) => Promise<T>): Promise<T> {
      return fn(fakeTx(tables, reads) as unknown as SystemTx);
    },
  };
}

// -----------------------------------------------------------------------------
// A five day estate, built out of the fixtures the one-day reader already uses
// -----------------------------------------------------------------------------

const DAYS = [
  td('2026-08-10'),
  td('2026-08-11'),
  td('2026-08-12'),
  td('2026-08-13'),
  td('2026-08-14'),
] as const;

/** `trading_calendar`, five sessions, no holiday. `toCalendarSlice` reads it. */
const calendarRows = (): readonly Row[] =>
  DAYS.map((tradingDay) => ({
    tradingDay,
    isHalfDay: false,
    isHoliday: false,
    halted: false,
    sessionCloseAt: null,
  }));

/** The ordinary week: five days, ten thousand cents each. */
const STEADY = [10_000n, 10_000n, 10_000n, 10_000n, 10_000n] as const;

/**
 * One `daily_marks` row per day, CHAINED, from a list of per-day results.
 *
 * THE BALANCES CHAIN, because `INV-18` reads an opening against the prior close
 * and a fixture whose days do not join would be refused by the fold rather than
 * compared by the audit. The results are a parameter because section 5 needs a
 * SECOND history that folds just as cleanly as the first.
 */
function markRowsFrom(results: readonly bigint[], accountId = ACCOUNT_A): readonly Row[] {
  let opening = DAY_ONE.openingBalanceCents;
  return DAYS.slice(0, results.length).map((tradingDay, index) => {
    const pnl = results[index] ?? 0n;
    const closing = opening + pnl;
    const row = markRow({
      accountId,
      tradingDay,
      openingBalanceCents: opening,
      closingBalanceCents: closing,
      highBalanceCents: (closing > opening ? closing : opening) + 5_000n,
      lowBalanceCents: (closing < opening ? closing : opening) - 5_000n,
      realizedPnlCents: pnl,
      // `sourceHash` is `bytea` and `replay` orders on its HEX, so the bytes
      // differ per day rather than repeating: a total order with a tie in it is
      // the order `PT-06` permutes.
      sourceHash: new Uint8Array([...SOURCE_BYTES, index]),
    });
    opening = closing;
    return row;
  });
}

const markRows = (accountId = ACCOUNT_A): readonly Row[] => markRowsFrom(STEADY, accountId);

function world(overrides: Partial<Record<string, readonly Row[]>> = {}): Tables {
  return {
    accounts: [accountRow({ openedOn: DAYS[0] })],
    identities: [identityRow()],
    kycVerifications: [kycRow()],
    planVersions: [planVersionRow()],
    planVersionSizes: sizeGrid(),
    tradingCalendar: calendarRows(),
    tradingCalendarRevisions: [],
    dailyMarks: markRows(),
    payoutRequests: [],
    ruleStates: [],
    ...overrides,
  };
}

/** A `rule_states` row in the property names `packages/db/src/schema.ts` declares. */
function storedRow(row: RuleStateRow, overrides: Row = {}): Row {
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
    calendarRevisionId: null,
    lifetimeSettledCents: row.lifetimeSettledCents,
    breached: row.breached,
    breachKind: row.breachKind,
    ...overrides,
  };
}

/**
 * The stored book, FOLDED rather than typed, off the days the adapter returned.
 *
 * This is `runNightlyBatch`'s own loop: take the day, fold it against the prior
 * the last fold produced, write the row. A book built this way is a book the
 * audit must find clean, and it is the only kind of clean book worth seeding.
 */
async function foldedBook(
  tables: Tables,
  accountId = ACCOUNT_A,
): Promise<{
  readonly rows: readonly Row[];
  readonly typed: readonly RuleStateRow[];
  readonly slice: CalendarSlice;
}> {
  const ports = postgresBatchPorts(dbOf(tables));
  const slice = await ports.read.calendarSlice();
  const days = await ports.read.accountDaysFrom(accountId);

  const rows: Row[] = [];
  const typed: RuleStateRow[] = [];
  let prior: AccountDay['prior'] = null;
  for (const day of days) {
    const fold = foldAccountDay({ ...day, prior }, slice, ENGINE_VERSION, null);
    if (fold.kind !== 'row') throw new Error(`day ${day.mark.tradingDay} was refused`);
    rows.push(storedRow(fold.row));
    typed.push(fold.row);
    prior = fold.state;
  }
  return { rows, typed, slice };
}

/**
 * The same book with ONE cent moved on ONE day, AND THE DIGEST MOVED WITH IT.
 *
 * `stateHash` is imported here and nowhere in `adapter.ts`, which is the split
 * this file's case 1.3 asserts: a SUITE may hash a state to build a subject, and
 * the reader may not, because a reader that re-hashed would recompute the very
 * bytes the comparison exists to trust.
 */
async function seededBook(): Promise<readonly Row[]> {
  const { rows, typed } = await foldedBook(world());
  const target = typed[3];
  if (target === undefined) throw new Error('the fold produced too few rows');

  const moved: RuleStateRow = { ...target, balanceCents: target.balanceCents + 1n };
  return rows.map((row, index) =>
    index === 3
      ? storedRow(moved, {
          stateHash: stateHash({ accountId: moved.accountId, state: moved }),
        })
      : row,
  );
}

const DETECT = { engineVersion: ENGINE_VERSION, mode: 'detect' } as const;

// -----------------------------------------------------------------------------
// 1. `storedRuleStates`: the row reader, and the bytes it must never recompute
// -----------------------------------------------------------------------------

describe('1. `storedRuleStates` rebuilds the row and returns the hash storage holds', () => {
  test('1.1 a folded row round-trips through the columns and back', async () => {
    // THE STRONGEST FORM AVAILABLE: the row the writer would persist, rendered
    // into columns, read back by this port, equals what the fold produced. Every
    // field is checked at once by `toEqual`, so a field this reader forgets is a
    // failure rather than a gap nobody enumerated.
    const { rows, typed } = await foldedBook(world());
    const ports = postgresBatchPorts(dbOf(world({ ruleStates: rows })));

    const back = await ports.read.storedRuleStates(ACCOUNT_A);

    // TWENTY-SIX FIELDS AT ONCE, AGAINST THE FOLD RATHER THAN AGAINST A LIST
    // THIS FILE TYPED. `calendarRevisionId` is the one field the fold does not
    // decide, because `storedRow` stamps it `null` where `foldAccountDay` was
    // handed `null` too, and `null` there is a fact rather than an absence.
    expect(back).toHaveLength(DAYS.length);
    expect(back).toEqual(typed.map((row) => ({ ...row, calendarRevisionId: null })));

    // AND THE ONE FIELD THE HASH DOES NOT COVER IS STILL READ. `context_gates`
    // is `INV-23`'s never-replayed half, so no divergence can ever attribute to
    // it and nothing else in this file would notice the reader dropping it.
    const first = back[0];
    if (first === undefined) throw new Error('the reader returned nothing');
    expect(first.contextGates.accountActive.status).toBe('active');
    expect(first.contextGates.kycVerified).toEqual({ pass: true, state: 'verified' });
    expect(first.contextGates.notFrozen.pass).toBe(true);
    expect(first.contextGates.reconClear.pass).toBe(true);
    expect(first.contextGates.noPayoutInFlight.pass).toBe(true);
  });

  test('1.2 the rows come back OLDEST FIRST whatever order the accessor held them in', async () => {
    // `ports.ts` promises oldest first and `auditAccount` reports findings in
    // the order this array arrived, so a report that differs between two runs
    // over identical data is a report nobody can diff.
    const { rows } = await foldedBook(world());
    const ports = postgresBatchPorts(dbOf(world({ ruleStates: [...rows].reverse() })));

    const back = await ports.read.storedRuleStates(ACCOUNT_A);

    expect(back.map((row) => row.tradingDay)).toEqual([...DAYS]);
  });

  test('1.3 the stored hash is the BYTES, and this port has no path to a re-hash', async () => {
    // **THE SINGLE MOST IMPORTANT ASSERTION IN THIS FILE.** `ports.ts` and
    // `replay.ts` both state the consequence of recomputing it: `jsonb` does not
    // preserve key order, so a hash re-derived from what Postgres gives back is
    // a different serializer and would disagree with every hash the batch wrote.
    // A row is seeded whose stored hash is thirty-two bytes of nothing; a reader
    // that re-hashed would hand back the CORRECT digest and this goes green on a
    // defect, so the assertion is that the wrong bytes survive the read.
    const { rows } = await foldedBook(world());
    const first = rows[0];
    if (first === undefined) throw new Error('the fold produced no row');
    const nonsense = Buffer.alloc(32, 0x5a);

    const ports = postgresBatchPorts(
      dbOf(world({ ruleStates: [{ ...first, stateHash: nonsense }] })),
    );
    const back = await ports.read.storedRuleStates(ACCOUNT_A);

    expect(back[0]?.stateHash.equals(nonsense)).toBe(true);

    // AND THE MECHANICAL HALF, because the case above proves one row and this
    // proves the shape. The adapter cannot re-hash because it cannot reach the
    // serializer: `state-hash.ts` is not imported here at all, and there is no
    // second implementation of it in this file to reach instead.
    const source = readFileSync(new URL('../src/batch/adapter.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('state-hash.ts');
    expect(source).not.toContain('createHash');
  });

  test('1.4 a digest that is not thirty-two bytes is refused rather than compared', async () => {
    // `rule_states_hash_is_sha256` is that length at the store (`0015`), so a
    // shorter value is a row the database says cannot exist. A truncated digest
    // is how two different states come to agree.
    const { rows } = await foldedBook(world());
    const first = rows[0];
    if (first === undefined) throw new Error('the fold produced no row');

    const short = postgresBatchPorts(
      dbOf(world({ ruleStates: [{ ...first, stateHash: Buffer.alloc(16, 1) }] })),
    );
    await expect(short.read.storedRuleStates(ACCOUNT_A)).rejects.toThrow(BatchRowError);

    const absent = postgresBatchPorts(
      dbOf(world({ ruleStates: [{ ...first, stateHash: 'deadbeef' }] })),
    );
    await expect(absent.read.storedRuleStates(ACCOUNT_A)).rejects.toThrow(/is not bytes/);
  });

  test('1.5 a row carrying another account is refused rather than renamed', async () => {
    // The port read BY `account_id`, so a row that came back carrying a
    // different one is a predicate that did not hold. An audit that renamed it
    // would compare one trader's day against another's.
    const { rows } = await foldedBook(world());
    const first = rows[0];
    if (first === undefined) throw new Error('the fold produced no row');

    // **THE DOOR HERE DOES NOT FILTER, AND THAT IS THE WHOLE CASE.** Every other
    // fake in this file honours the `where`, so no case it serves can produce
    // this row; the defect being guarded against is a predicate that did NOT
    // hold, which is exactly a door that answered without filtering.
    const leaky: WorkerDb = {
      batch: <T>(fn: (tx: SystemTx) => Promise<T>): Promise<T> =>
        fn({
          rowsWhere: () => Promise.resolve([first]),
        } as unknown as SystemTx),
    };

    await expect(postgresBatchPorts(leaky).read.storedRuleStates(ACCOUNT_B)).rejects.toThrow(
      /is refused/,
    );
  });

  test('1.6 `calendar_revision_id` past the safe integer is refused in BOTH directions', async () => {
    // `calendarWatermark` refuses to STAMP one and this refuses to READ one
    // back, because a stamp rounded on the way in compares equal to a watermark
    // rounded the same way and B.4 step 1 would scope on two wrong numbers that
    // agree.
    const { rows } = await foldedBook(world());
    const first = rows[0];
    if (first === undefined) throw new Error('the fold produced no row');
    const past = BigInt(Number.MAX_SAFE_INTEGER) + 1n;

    const ports = postgresBatchPorts(
      dbOf(world({ ruleStates: [{ ...first, calendarRevisionId: past }] })),
    );

    await expect(ports.read.storedRuleStates(ACCOUNT_A)).rejects.toThrow(/MAX_SAFE_INTEGER/);
  });
});

// -----------------------------------------------------------------------------
// 2. `accountDaysFrom`: the walk, and the reads it does not repeat
// -----------------------------------------------------------------------------

describe('2. `accountDaysFrom` is a walk over one life and not a loop over one day', () => {
  test('2.1 every live day arrives, oldest first, with its own mark', async () => {
    const ports = postgresBatchPorts(dbOf(world()));

    const days = await ports.read.accountDaysFrom(ACCOUNT_A);

    expect(days.map((day) => day.mark.tradingDay)).toEqual([...DAYS]);
    expect(days.every((day) => day.accountId === ACCOUNT_A)).toBe(true);
    expect(days.every((day) => day.openedOn === DAYS[0])).toBe(true);
  });

  test('2.2 the account facts are read ONCE for the whole life', async () => {
    // **THE COUNT IS THE PORT'S REASON FOR EXISTING.** A per-day loop over
    // `loadAccountDay` would read the account, the plan version, the size grid,
    // the identity and the KYC chain once per trading day; over `B.5`'s 250 days
    // that is 1,500 reads to fold one life. The assertion is on the READ LOG and
    // not on wall-clock, so it cannot pass by being fast on five days.
    const reads: Reads = { log: [] };
    const ports = postgresBatchPorts(dbOf(world(), reads));

    const days = await ports.read.accountDaysFrom(ACCOUNT_A);

    expect(days).toHaveLength(5);
    for (const key of ['accounts', 'planVersions', 'planVersionSizes', 'identities'])
      expect(
        reads.log.filter((read) => read === key),
        `${key} was read per day`,
      ).toHaveLength(1);
    expect(reads.log.filter((read) => read === 'dailyMarks')).toHaveLength(1);
    expect(reads.log.filter((read) => read === 'ruleStates')).toHaveLength(1);
  });

  test('2.3 a superseded mark is not a day, and two live rows on one day refuse', async () => {
    // `0014`'s grain, applied by the ONE expression `loadAccountDay` uses. A
    // supersession rule written twice would drift and the drift would show up as
    // a replay divergence on every corrected day.
    const corrected = markRows().map((row, index) =>
      index === 2 ? { ...row, supersededBy: 'x' } : row,
    );
    const dropped = await postgresBatchPorts(
      dbOf(world({ dailyMarks: corrected })),
    ).read.accountDaysFrom(ACCOUNT_A);
    expect(dropped.map((day) => day.mark.tradingDay)).toEqual([DAYS[0], DAYS[1], DAYS[3], DAYS[4]]);

    const doubled = [...markRows(), markRow({ accountId: ACCOUNT_A, tradingDay: DAYS[0] })];
    await expect(
      postgresBatchPorts(dbOf(world({ dailyMarks: doubled }))).read.accountDaysFrom(ACCOUNT_A),
    ).rejects.toThrow(/daily_marks_account_day_uq/);
  });

  test('2.4 `prior` is the latest stored row STRICTLY BEFORE the day', async () => {
    // `INV-14` and `DO-1`. The audit does not read this field, and it is filled
    // off rows already in hand rather than invented, which is the whole of why
    // the walk costs one `ruleStates` read instead of one per day.
    const { rows } = await foldedBook(world());
    const ports = postgresBatchPorts(dbOf(world({ ruleStates: rows })));

    const days = await ports.read.accountDaysFrom(ACCOUNT_A);

    expect(days[0]?.prior).toBeNull();
    expect(days[1]?.prior?.tradingDay).toBe(DAYS[0]);
    expect(days[4]?.prior?.tradingDay).toBe(DAYS[3]);
  });

  test('2.5 a settled payout lands on its EFFECTIVE day and on no other', async () => {
    // `SD-03` and `D-M5-1`. The status term is `settled` and the day term is
    // `effective_trading_day`, and swapping either changes whose money moves.
    const settled = {
      id: '11111111-1111-4111-8111-111111111111',
      accountId: ACCOUNT_A,
      approvedCents: 120_000n,
      basisTradingDay: DAYS[0],
      status: 'settled',
      payoutOrdinal: 1,
      settledTradingDay: DAYS[1],
      effectiveTradingDay: DAYS[2],
    };
    const pending = { ...settled, id: '22222222-2222-4222-8222-222222222222', status: 'approved' };

    const days = await postgresBatchPorts(
      dbOf(world({ payoutRequests: [settled, pending] })),
    ).read.accountDaysFrom(ACCOUNT_A);

    const byDay = new Map(days.map((day) => [day.mark.tradingDay, day.settlements]));
    expect(byDay.get(DAYS[2])).toHaveLength(1);
    expect(byDay.get(DAYS[2])?.[0]?.effectiveTradingDay).toBe(DAYS[2]);
    for (const day of [DAYS[0], DAYS[1], DAYS[3], DAYS[4]])
      expect(byDay.get(day), `${day} took a settlement that is not its own`).toHaveLength(0);
  });

  test('2.6 an account with no live mark has NO history rather than an empty one', async () => {
    const ports = postgresBatchPorts(dbOf(world({ dailyMarks: [] })));

    await expect(ports.read.accountDaysFrom(ACCOUNT_A)).resolves.toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// 3. The falsification: a clean book stays silent and a seeded one reports
// -----------------------------------------------------------------------------

describe('3. the audit runs against the door, and it is loud exactly when it should be', () => {
  test('3.1 a book the batch folded is CLEAN, and nothing is raised', async () => {
    // THE SILENT HALF. Every stored row came from `foldAccountDay` over the days
    // this adapter returned, so `INV-04` holds by construction and the audit has
    // to say so. If it did not, the walk and the row reader would disagree with
    // the fold, which is the defect this file exists to catch.
    const { rows } = await foldedBook(world());
    const ports = postgresBatchPorts(dbOf(world({ ruleStates: rows })));

    const report = await runReplayAudit(ports, DETECT);

    expect(report.accountsAudited).toBe(1);
    expect(report.storedRows).toBe(DAYS.length);
    expect(report.inScope).toBe(DAYS.length);
    expect(report.matched).toBe(DAYS.length);
    expect(report.diverged).toBe(0);
    expect(report.outOfScope).toBe(0);
    expect(report.accounts[0]?.findings).toEqual([]);
  });

  test('3.2 ONE cent moved on ONE stored day reaches the write port, which refuses', async () => {
    // THE LOUD HALF, seeded at the smallest unit the store carries.
    //
    // **THE SEED MOVES THE HASH WITH THE FIELD, AND IT HAS TO.** `B.2` compares
    // `state_hash` FIRST and diffs columns only on mismatch, so a stored row
    // whose balance moved and whose digest did not is a row the audit correctly
    // says nothing about: the bytes still agree. What a real divergence looks
    // like is a row storage believes -- self-consistent, hashed over its own
    // contents -- that the replay does not reproduce. A seed that skipped the
    // re-hash would pass this case while proving the opposite of what it claims.
    const ports = postgresBatchPorts(dbOf(world({ ruleStates: await seededBook() })));

    const error = await runReplayAudit(ports, DETECT).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BatchPortUnwired);
    expect((error as BatchPortUnwired).port).toBe('raiseDivergence');
    expect((error as Error).message).toContain('OPEN QUESTION');
  });

  test('3.3 the same seed is a FINDING that names the COLUMN, seen before the write', async () => {
    // The case above proves the audit reaches the write port; this proves WHAT
    // it would have written, which the throw hides. `auditAccount` is the same
    // comparison without the write, so the finding is read there, and `B.2`'s
    // second sentence is the assertion: the page says which number moved, not
    // merely that something did.
    const ports = postgresBatchPorts(dbOf(world({ ruleStates: await seededBook() })));

    const stored = await ports.read.storedRuleStates(ACCOUNT_A);
    const days = await ports.read.accountDaysFrom(ACCOUNT_A);
    const slice = await ports.read.calendarSlice();
    const report = auditAccount(
      ACCOUNT_A,
      days.map((day) => ({ day, calendar: slice })),
      stored,
      DETECT,
      null,
    );

    expect(report.diverged).toBe(1);
    expect(report.matched).toBe(DAYS.length - 1);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.tradingDay).toBe(DAYS[3]);
    expect(report.findings[0]?.divergences.map((d) => d.field)).toEqual(['balance_cents']);
  });

  test('3.4 a stored row nobody replayed is reported, not skipped', async () => {
    // The other direction of the set alignment. A day whose mark was deleted
    // leaves a stored row the replay never reproduces, and an index-based
    // comparison cannot see it at all.
    const { rows } = await foldedBook(world());
    const ports = postgresBatchPorts(
      dbOf(world({ ruleStates: rows, dailyMarks: markRows().slice(0, 4) })),
    );

    const error = await runReplayAudit(ports, DETECT).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BatchPortUnwired);
  });

  test('3.5 an empty book REFUSES rather than reporting a clean audit over nothing', async () => {
    // `ADR-073` section 5 and `ADR-123`. This is `replay.ts`'s own guard reached
    // through the adapter, which is the combination nothing had exercised: the
    // refusal is only worth anything if the port that feeds it can be empty for
    // an ordinary reason, and a database nobody has run the batch against is the
    // ordinary reason.
    const ports = postgresBatchPorts(dbOf(world()));

    await expect(runReplayAudit(ports, DETECT)).rejects.toThrow(ReplayAuditRefusal);
  });
});

// -----------------------------------------------------------------------------
// 4. `raiseDivergence`: three blockers, and the third is a ruling nobody made
// -----------------------------------------------------------------------------

describe('4. the write port refuses, and its reason is three things rather than one', () => {
  test('4.1 the blocker names the sink, the missing mode, and the missing halt column', async () => {
    const ports = postgresBatchPorts(dbOf(world()));
    const error = await ports.write
      .raiseDivergence({
        accountId: ACCOUNT_A,
        tradingDay: DAYS[0],
        engineVersion: ENGINE_VERSION,
        divergences: [{ field: 'balance_cents', stored: '1', recomputed: '2' }],
      })
      .catch((e: unknown) => e);
    const message = error instanceof Error ? error.message : String(error);

    expect(error).toBeInstanceOf(BatchPortUnwired);
    expect(message).toContain('EVENT_CATALOGUE');
    expect(message).toContain('ReplayMode');
    expect(message).toContain('recon_blocked');
    expect(message).toContain('payouts_frozen');
    expect(message).toContain('OPEN QUESTION');
  });

  test('4.2 `replay.divergence_detected` is not a row in the only producer there is', async () => {
    // THE FIRST BLOCKER, DERIVED RATHER THAN INHERITED. `buildEvent` refuses a
    // name that is not a row in `EVENT_CATALOGUE` (ADR-159 clause 1), so wiring
    // a sink into this deployable would not make this call write: the name is
    // not in the catalogue at all.
    const { EVENT_NAMES } = await import('../../api/src/events.ts');

    expect(EVENT_NAMES).not.toContain('replay.divergence_detected');
    expect(EVENT_NAMES.filter((name) => name.startsWith('replay.'))).toEqual([]);
  });

  test('4.3 the finding carries no mode, so B.4 step 1 and step 2 are indistinguishable', async () => {
    // THE SECOND BLOCKER, ASSERTED ON THE TYPE RATHER THAN ON A COMMENT.
    // `ReplayAuditConfig` carries the mode and `ReplayDivergenceFinding` does
    // not, so an adapter handed a finding cannot tell the nightly detection run
    // from the dry run that `B.4` step 2 says writes NOTHING. A halt on every
    // finding would halt the whole book on the first engine upgrade.
    const ports = readFileSync(new URL('../src/batch/ports.ts', import.meta.url), 'utf8');
    const finding = ports.slice(
      ports.indexOf('export interface ReplayDivergenceFinding'),
      ports.indexOf('export interface BatchReadPort'),
    );

    expect(finding).not.toContain('mode');
    expect(finding).not.toContain('ReplayMode');
  });
});

// -----------------------------------------------------------------------------
// 5. What a green audit does NOT cover, which is four rules and one of them bites
// -----------------------------------------------------------------------------

describe('5. a clean report is an INV-04 claim and not a rule-coverage claim', () => {
  test('5.1 four of the fifty rule ids are outside the fold the audit replays', () => {
    // DERIVED AT ASSERTION TIME rather than transcribed. `rules.ts` records the
    // four as discharged OUTSIDE the engine -- R-01 and R-05 by the calendar and
    // the ingest path, R-11 by the caller's live-mark predicate, R-20 by the
    // platform setpoint -- so they are not rules waiting to be written and a
    // later session implementing more engine rules does not shrink this list.
    const all = Array.from({ length: 50 }, (_, i) => `R-${String(i + 1).padStart(2, '0')}`);
    const implemented: readonly string[] = IMPLEMENTED_RULES;
    const absent = all.filter((id) => !implemented.includes(id));

    expect(IMPLEMENTED_RULES).toHaveLength(46);
    expect(absent).toEqual(['R-01', 'R-05', 'R-11', 'R-20']);
  });

  test('5.2 R-11 is the one a replay is STRUCTURALLY blind to, and the walk is why', async () => {
    // **THE SHARP ONE, AND THE ASSERTION IS A COMPARISON OF TWO GREEN AUDITS.**
    // R-11 is the caller's live-mark predicate, and the WALK applies it before
    // the engine sees anything: `liveMarksByDay` drops the superseded rows and
    // hands the survivors to the fold. So the audit folds marks selected by the
    // very rule it would have to check.
    //
    // Below are two estates that differ ONLY in which of two marks for
    // 2026-08-12 carries `superseded_by`. Each is folded and stored the way the
    // nightly batch would, and the audit calls BOTH clean, because in each case
    // the replay reproduces what was stored from the mark the ingest path chose.
    // The stored balances differ by fifteen thousand cents, so the two books are
    // not the same book and INV-04 holds over each of them.
    //
    // NOTHING HERE IS A DEFECT IN THIS ADAPTER. It is the boundary of what a
    // green report claims, asserted so nobody reads one as a claim about the
    // rule set: R-01, R-05, R-11 and R-20 are discharged outside the fold, and a
    // replay that agrees byte for byte has audited the ENGINE and not them.
    const ALTERNATIVE = [10_000n, 10_000n, 25_000n, 10_000n, 10_000n] as const;
    const chosen = markRowsFrom(STEADY);
    const other = markRowsFrom(ALTERNATIVE);

    /** One estate: `keep`'s day-2 row is live and `drop`'s is superseded. */
    const estate = (keep: readonly Row[], drop: readonly Row[]): readonly Row[] => [
      ...keep,
      { ...(drop[2] ?? {}), sourceHash: new Uint8Array([0xaa]), supersededBy: 'x' },
    ];

    const audited = async (marks: readonly Row[]) => {
      const { rows } = await foldedBook(world({ dailyMarks: marks }));
      const ports = postgresBatchPorts(dbOf(world({ dailyMarks: marks, ruleStates: rows })));
      return { report: await runReplayAudit(ports, DETECT), rows };
    };

    const first = await audited(estate(chosen, other));
    const second = await audited(estate(other, chosen));

    expect(first.report.diverged, 'the audit saw a selection it cannot see').toBe(0);
    expect(second.report.diverged, 'the audit saw a selection it cannot see').toBe(0);
    expect(first.report.matched).toBe(DAYS.length);
    expect(second.report.matched).toBe(DAYS.length);

    // AND THE TWO BOOKS REALLY ARE DIFFERENT, which is what makes the pair of
    // green reports a finding rather than a tautology.
    expect(first.rows[4]?.['balanceCents']).not.toEqual(second.rows[4]?.['balanceCents']);
  });
});
