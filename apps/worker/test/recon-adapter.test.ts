// =============================================================================
// apps/worker/test/recon-adapter.test.ts
// =============================================================================
// WHAT THIS FILE CAN PROVE AND WHAT IT CANNOT, STATED FIRST SO A GREEN RUN IS
// NOT READ AS MORE THAN IT IS. `test/recon-sweep.test.ts` opens the same way and
// for the same reason.
//
// A recorder standing in for the door proves WHICH key the adapter named, WHICH
// address it composed, WHICH values it passed, and WHICH calls it refused before
// they reached the accessor at all. It proves NOTHING about whether the
// predicate the accessor then composes reaches one row or many, and nothing
// about whether a `CHECK` accepts a row: `apps/worker/src/db.ts`'s header states
// that limit for this whole deployable, and `packages/db/test/keyed-accessor.test.ts`
// is where the predicate is asserted. **BOTH OF THOSE WERE ESTABLISHED AGAINST A
// LIVE PostgreSQL 16.13 CARRYING ALL SEVENTY-FIVE MIGRATIONS**, through this
// deployable's own door, and the session log carries the transcripts: a seeded
// discrepancy found and blocked, and a clean book left silent.
//
// SECTION 4 IS THE ONE TO READ. Every refusal there is a call this adapter could
// have served by dropping something, and a dropped narrowing on a read is how a
// reconciliation sweep reports a mismatch for every account that was ever
// corrected.
// =============================================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isFilterTerm } from '@merit/db';
import { describe, expect, test } from 'vitest';

import {
  RECON_READ_FILTERS,
  RECON_TERMS,
  RECON_WRITE_ADDRESS,
  ReconAdapterError,
  postgresReconSweepIo,
  reconTxOver,
} from '../src/recon/adapter.ts';
import type { ReconDbTx } from '../src/recon/adapter.ts';
import { WORKER_REASON } from '../src/db.ts';
import type { WorkerDb } from '../src/db.ts';
import {
  RECON_READ_TABLES,
  RECON_WRITE_TABLES,
  UNWIRED_RECON_SWEEP_IO,
} from '../src/recon/ports.ts';
import type { ReconFilter, ReconValues } from '../src/recon/ports.ts';
import { runReconciliationSweep } from '../src/recon/sweep.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ADAPTER = join(HERE, '..', 'src', 'recon', 'adapter.ts');

const DAY = '2026-08-26';
const BATCH_RUN = '00000000-0000-4000-8000-000000000345';
const RUN_ID = '44444444-4444-4444-8444-444444444444';
const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';
const FILE_ONE = '33333333-3333-4333-8333-333333333333';

// -----------------------------------------------------------------------------
// The door, recorded
// -----------------------------------------------------------------------------

interface DoorCall {
  readonly op: 'rowsWhere' | 'insert' | 'updateAt';
  readonly key: string;
  readonly where?: Readonly<Record<string, unknown>>;
  readonly values?: Readonly<Record<string, unknown>>;
}

interface Door {
  readonly db: WorkerDb;
  readonly calls: DoorCall[];
  transactions(): number;
}

interface DoorRows {
  readonly dailyMarks?: readonly ReconValues[];
  readonly ruleStates?: readonly ReconValues[];
  /** Rows already on `reconciliations`, keyed by account. */
  readonly reconciliations?: Readonly<Record<string, ReconValues>>;
}

/**
 * A `WorkerDb` that records rather than connecting.
 *
 * THE SUBSTITUTE IS CAST TO THE HANDLE'S TYPE, which `test/db.test.ts` does at
 * the same seam and for the same reason: `SystemTx` publishes eight methods and
 * this adapter reaches three, so implementing the union would be five throws
 * asserting nothing. What the cast cannot hide is which of the three was called,
 * because that is what gets recorded.
 */
function door(rows: DoorRows = {}): Door {
  const calls: DoorCall[] = [];
  let transactions = 0;

  const tx = {
    __brand: 'SystemTx',
    reason: WORKER_REASON,
    rowsWhere(key: string, where: Readonly<Record<string, unknown>>): Promise<unknown[]> {
      calls.push({ op: 'rowsWhere', key, where });
      if (key === 'dailyMarks') return Promise.resolve([...(rows.dailyMarks ?? [])]);
      if (key === 'ruleStates') return Promise.resolve([...(rows.ruleStates ?? [])]);
      const accountId = where['accountId'];
      const row = typeof accountId === 'string' ? rows.reconciliations?.[accountId] : undefined;
      return Promise.resolve(row === undefined ? [] : [row]);
    },
    insert(key: string, values: Readonly<Record<string, unknown>>): Promise<unknown[]> {
      calls.push({ op: 'insert', key, values });
      return Promise.resolve(key === 'reconciliationRuns' ? [{ id: RUN_ID }] : [values]);
    },
    updateAt(
      key: string,
      at: Readonly<Record<string, unknown>>,
      values: Readonly<Record<string, unknown>>,
    ): Promise<unknown[]> {
      calls.push({ op: 'updateAt', key, where: at, values });
      return Promise.resolve([values]);
    },
    sqlExecutor: (): never => {
      throw new Error('no adapter in this deployable may reach for one');
    },
  };

  return {
    calls,
    transactions: () => transactions,
    db: {
      batch<T>(fn: (handle: never) => Promise<T>): Promise<T> {
        transactions += 1;
        return fn(tx as never);
      },
    },
  };
}

/** One `ReconTx` over the recorded door, for the per-call cases. */
function handleOver(rows: DoorRows = {}): { tx: ReturnType<typeof reconTxOver>; door: Door } {
  const recorded = door(rows);
  let captured: ReconDbTx | undefined;
  void recorded.db.batch(async (raw) => {
    captured = raw;
  });
  if (captured === undefined) throw new Error('the substitute door never yielded a handle');
  return { tx: reconTxOver(captured), door: recorded };
}

/** A fixed clock. Two runs over identical data must produce identical writes. */
function ticker(): () => Date {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 8, 5, 5, 0, tick++));
}

function mark(overrides: ReconValues = {}): ReconValues {
  return {
    accountId: ACCOUNT_A,
    source: 'report',
    closingBalanceCents: 5_000_000n,
    ingestFileId: FILE_ONE,
    ...overrides,
  };
}

function state(overrides: ReconValues = {}): ReconValues {
  return { accountId: ACCOUNT_A, balanceCents: 5_000_000n, ...overrides };
}

// =============================================================================
// 1. The port has an inhabitant that answers, and the one that refuses is still
//    there
// =============================================================================

describe('1. the blocker this row was dispatched against', () => {
  test('the unwired default still refuses, because a deployment that installs nothing must', () => {
    // **THE ADAPTER IS AN ADDITION AND NOT A REPLACEMENT.** `ports.ts` argues
    // that a sweep returning a plausible report would be "a fixture reporting
    // reconciliation health", and that argument is unchanged by a second
    // inhabitant existing: a deployment that wires nothing must still refuse.
    expect(() => UNWIRED_RECON_SWEEP_IO.now()).toThrow(/no adapter is installed/);
    expect(() => UNWIRED_RECON_SWEEP_IO.terms.isNull()).toThrow(/no adapter is installed/);
    return expect(UNWIRED_RECON_SWEEP_IO.transact(async () => 1)).rejects.toThrow(
      /no adapter is installed/,
    );
  });

  test('constructing the io opens nothing, so this suite needs no DATABASE_URL', () => {
    // `LIVE_DB.batch` calls `systemDb` and `transaction` when it is INVOKED, so
    // building the value connects to nothing. That is the property that lets
    // `ci.yml`'s `integration` job, which has no Postgres, run this file at all.
    const recorded = door();
    const io = postgresReconSweepIo(recorded.db, ticker());
    expect(recorded.transactions()).toBe(0);
    expect(recorded.calls).toStrictEqual([]);
    expect(Object.keys(io).sort()).toStrictEqual(['now', 'terms', 'transact']);
  });

  test('the clock is the caller argument and never a call inside the adapter', () => {
    // `job.ts`: "THE CLOCK IS AN ARGUMENT AND NOT A CALL". The instant the run
    // record is stamped with is the one the caller chose, and a fixture pins it.
    const fixed = new Date(Date.UTC(2026, 8, 5, 5, 0, 0));
    const io = postgresReconSweepIo(door().db, () => fixed);
    expect(io.now()).toBe(fixed);
    expect(readFileSync(ADAPTER, 'utf8')).not.toContain('new Date(');
  });
});

// =============================================================================
// 2. The term, which is the whole of what "live" means
// =============================================================================

describe('2. the IS NULL term', () => {
  test('the term is one packages/db minted, read by identity rather than by shape', () => {
    // **THIS IS THE ONE CASE HERE THAT A HAND-ROLLED OBJECT WOULD FAIL.**
    // `scoped-db.ts` keeps a module-private `WeakSet` and `isFilterTerm` reads
    // membership of it, so a `{ term: 'is-null' }` literal composed anywhere
    // else is a VALUE and the accessor renders it as an equality against an
    // object. `daily_marks_live_per_account_day_uq` is
    // `WHERE superseded_by IS NULL`, so getting this wrong does not fail: it
    // silently reads no rows at all and closes a run over an empty population.
    const term = RECON_TERMS.isNull();
    expect(term).toStrictEqual({ term: 'is-null' });
    expect(isFilterTerm(term)).toBe(true);
    expect(isFilterTerm({ term: 'is-null' })).toBe(false);
  });

  test('a fresh term per call, because identity is what makes a term a term', () => {
    expect(RECON_TERMS.isNull()).not.toBe(RECON_TERMS.isNull());
  });
});

// =============================================================================
// 3. The translation, watched end to end through the real sweep
// =============================================================================

describe('3. what reaches the accessor when the sweep runs', () => {
  test('a mismatch composes exactly the reads and writes the DDL admits', async () => {
    const recorded = door({
      dailyMarks: [mark({ closingBalanceCents: 5_000_000n })],
      ruleStates: [state({ balanceCents: 4_999_900n })],
    });
    const report = await runReconciliationSweep(
      { tradingDay: DAY, batchRunId: BATCH_RUN },
      postgresReconSweepIo(recorded.db, ticker()),
    );

    expect(report.runId).toBe(RUN_ID);
    expect(report.status).toBe('completed');
    expect(report.mismatchesFound).toBe(1);

    // THE LIVE-MARK READ CARRIES THE TERM. Asserted on the call the DOOR saw,
    // not on the one the sweep made, because the adapter is what stands between.
    const marks = recorded.calls.find((call) => call.key === 'dailyMarks');
    expect(marks?.op).toBe('rowsWhere');
    expect(Object.keys(marks?.where ?? {}).sort()).toStrictEqual(['supersededBy', 'tradingDay']);
    expect(marks?.where?.['tradingDay']).toBe(DAY);
    expect(isFilterTerm(marks?.where?.['supersededBy'])).toBe(true);

    // THE FINDING AND ITS CONSEQUENCE, ON ONE TRANSACTION, ADDRESSED BY ID.
    const finding = recorded.calls.find(
      (call) => call.key === 'reconciliations' && call.op === 'insert',
    );
    expect(finding?.values?.['status']).toBe('mismatch');
    expect(finding?.values?.['ourBalanceCents']).toBe(4_999_900n);
    expect(finding?.values?.['platformBalanceCents']).toBe(5_000_000n);
    // `delta_cents` IS GENERATED ALWAYS AS STORED and writing it is an error.
    expect(finding?.values).not.toHaveProperty('deltaCents');

    const block = recorded.calls.find((call) => call.key === 'accounts');
    expect(block?.op).toBe('updateAt');
    expect(block?.where).toStrictEqual({ id: ACCOUNT_A });
    expect(block?.values?.['reconBlocked']).toBe(true);

    // THE RUN ROW IS OPENED AND CLOSED, AND THE CLOSE IS ADDRESSED BY THE ID THE
    // OPEN RETURNED rather than by the day.
    const close = recorded.calls.find(
      (call) => call.key === 'reconciliationRuns' && call.op === 'updateAt',
    );
    expect(close?.where).toStrictEqual({ id: RUN_ID });
    expect(close?.values?.['status']).toBe('completed');
    expect(close?.values?.['mismatchesFound']).toBe(1);
  });

  test('a clean book writes a match, blocks nobody and stays silent about accounts', async () => {
    const recorded = door({
      dailyMarks: [mark(), mark({ accountId: ACCOUNT_B })],
      ruleStates: [state(), state({ accountId: ACCOUNT_B })],
    });
    const report = await runReconciliationSweep(
      { tradingDay: DAY, batchRunId: BATCH_RUN },
      postgresReconSweepIo(recorded.db, ticker()),
    );

    expect(report.status).toBe('completed');
    expect(report.accountsDone).toBe(2);
    expect(report.mismatchesFound).toBe(0);
    // **NO `accounts` WRITE ON A CLEAN NIGHT, IN EITHER DIRECTION.** The block is
    // set and never cleared (`0014_marks.sql`: "until a HUMAN resolves it"), and
    // the way that is implemented is by writing nothing at all here.
    expect(recorded.calls.filter((call) => call.key === 'accounts')).toStrictEqual([]);
  });

  test('a redelivered day updates the row already there, addressed by its bigint id', async () => {
    const recorded = door({
      dailyMarks: [mark({ closingBalanceCents: 5_000_100n })],
      ruleStates: [state()],
      reconciliations: { [ACCOUNT_A]: { id: 77n, status: 'match' } },
    });
    await runReconciliationSweep(
      { tradingDay: DAY, batchRunId: BATCH_RUN },
      postgresReconSweepIo(recorded.db, ticker()),
    );

    const update = recorded.calls.find(
      (call) => call.key === 'reconciliations' && call.op === 'updateAt',
    );
    expect(update?.where).toStrictEqual({ id: 77n });
    expect(
      recorded.calls.filter((call) => call.key === 'reconciliations' && call.op === 'insert'),
    ).toStrictEqual([]);
  });

  test('the read shapes the adapter translates are the read tables the port declares', () => {
    // DERIVED FROM THE PORT AND NOT COPIED BESIDE IT. A read table added to
    // `RECON_READ_TABLES` with no filter shape here is a table this adapter
    // would refuse at run time, and this is where that is a compile-adjacent
    // failure instead of a 02:00 one.
    expect(Object.keys(RECON_READ_FILTERS).sort()).toStrictEqual([...RECON_READ_TABLES].sort());
    expect(RECON_WRITE_ADDRESS).toBe('id');
  });
});

// =============================================================================
// 4. The refusals, which are every call this adapter could have served by
//    dropping something
// =============================================================================

describe('4. what the adapter will not pass on', () => {
  test('a filter naming a column the adapter does not translate is a throw, not a drop', async () => {
    const { tx, door: recorded } = handleOver();
    await expect(
      tx.rowsWhere('ruleStates', { tradingDay: DAY, accountId: ACCOUNT_A }),
    ).rejects.toBeInstanceOf(ReconAdapterError);
    // THE CALL NEVER REACHED THE DOOR, which is the half that matters: a read
    // the accessor never saw cannot have returned the wrong rows.
    expect(recorded.calls).toStrictEqual([]);
  });

  test('a filter MISSING a narrowing is refused, because a short filter reads more rows', async () => {
    // `{tradingDay}` on `dailyMarks` is a syntactically perfect read of every
    // superseded correction ever written for the day.
    const { tx, door: recorded } = handleOver();
    await expect(tx.rowsWhere('dailyMarks', { tradingDay: DAY })).rejects.toThrow(
      /does not name supersededBy/,
    );
    expect(recorded.calls).toStrictEqual([]);
  });

  test('an undefined filter value is refused rather than rendered as an equality', async () => {
    const { tx } = handleOver();
    const where: ReconFilter = { tradingDay: undefined };
    await expect(tx.rowsWhere('ruleStates', where)).rejects.toThrow(/tradingDay is undefined/);
  });

  test('a reconciliation sweep never creates an account', async () => {
    // `accounts` is in the write union because the BLOCK is a mismatch's
    // consequence, which is an UPDATE of one boolean on a row somebody else
    // provisioned. The type cannot say so; this does.
    const { tx, door: recorded } = handleOver();
    await expect(tx.insert('accounts', { id: ACCOUNT_A })).rejects.toBeInstanceOf(
      ReconAdapterError,
    );
    expect(recorded.calls).toStrictEqual([]);
  });

  test('a write addressed by anything but the primary key is refused', async () => {
    const { tx, door: recorded } = handleOver();
    await expect(
      tx.updateAt(
        'reconciliations',
        { accountId: ACCOUNT_A, tradingDay: DAY },
        { status: 'match' },
      ),
    ).rejects.toBeInstanceOf(ReconAdapterError);
    expect(recorded.calls).toStrictEqual([]);
  });

  test('the id type each table declares is the id type the address must carry', async () => {
    const { tx } = handleOver();
    // `reconciliations.id` is bigint GENERATED ALWAYS AS IDENTITY. A `number`
    // here has been through a lossy conversion somewhere above.
    await expect(tx.updateAt('reconciliations', { id: 77 }, {})).rejects.toThrow(/bigint/);
    await expect(tx.updateAt('reconciliations', { id: '77' }, {})).rejects.toThrow(/bigint/);
    // `reconciliation_runs.id` and `accounts.id` are uuids.
    await expect(tx.updateAt('reconciliationRuns', { id: 77n }, {})).rejects.toThrow(/uuid/);
    await expect(tx.updateAt('accounts', { id: 77n }, {})).rejects.toThrow(/uuid/);
  });

  test('every write table the port declares has a translated arm', async () => {
    // TOTALITY, DERIVED. Two arms serve and one refuses, and what this asserts
    // is that none of the three falls through to `undefined`.
    const { tx } = handleOver();
    for (const key of RECON_WRITE_TABLES) {
      const result = await tx.updateAt(key, { id: key === 'reconciliations' ? 1n : RUN_ID }, {});
      expect(Array.isArray(result)).toBe(true);
    }
  });
});

// =============================================================================
// 5. Wiring is not scheduling, asserted over this module's own source
// =============================================================================

describe('5. the adapter runs nothing', () => {
  const source = readFileSync(ADAPTER, 'utf8');

  test('nothing here calls the sweep, so the caller census still reports it unscheduled', () => {
    // `test/schedule.test.ts` case 3.1 derives disposition from a caller census
    // over `src/`. THIS IS THE SAME PROPERTY ASSERTED AT THE ONE FILE THAT COULD
    // MOST EASILY HAVE BROKEN IT, so a session that adds a call here gets a
    // failure that names the decision rather than one that names a census.
    expect(source).not.toContain('runReconciliationSweep(');
  });

  test('the accessor is reached through the one door and never imported here', () => {
    // ADR-165's acquisition point, asserted over this module specifically.
    // `test/db.test.ts` asserts it over the whole tree; this says it where the
    // temptation was, because an adapter is exactly the file that wants the
    // package.
    expect(source).not.toContain("from '@merit/db'");
    expect(source).toContain("from '../db.ts'");
    expect(source).not.toContain('sqlExecutor');
  });
});
