// =============================================================================
// apps/worker/test/recon-sweep.test.ts
// =============================================================================
// WHAT THIS FILE CAN PROVE AND WHAT IT CANNOT, STATED FIRST SO A GREEN RUN IS
// NOT READ AS MORE THAN IT IS.
//
// A recorder proves WHICH key was named, WHICH address was written, WHICH values
// were set, and in WHAT transaction. It proves NOTHING about whether a composed
// predicate reaches one row or many, or whether a `CHECK` accepts a row --
// `apps/worker/src/db.ts`'s header states the same limit for the same reason.
// Those were established against a live PostgreSQL 16.13 carrying all sixty
// migrations, through this deployable's own door, and the session log carries
// the rows that came back.
//
// SECTION 1 IS THE ONE TO READ. It derives the absence this slice was dispatched
// against, FROM SOURCE, at the moment the suite runs, so the claim "nothing
// reconciles anything in this tree" cannot rot into a sentence somebody copied
// forward. If a second producer appears, section 1 goes red and whoever wrote it
// finds out here.
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import {
  PLATFORM_STATED_MARK_SOURCES,
  RECON_READ_TABLES,
  RECON_RUN_STATUSES,
  RECON_SOURCE,
  RECON_STATUSES,
  RECON_WRITE_TABLES,
  ReconSweepUnwired,
  UNWIRED_RECON_SWEEP_IO,
} from '../src/recon/ports.ts';
import type {
  ReconFilter,
  ReconFilterTerm,
  ReconReadTable,
  ReconSweepIo,
  ReconTx,
  ReconValues,
  ReconWriteTable,
} from '../src/recon/ports.ts';
import {
  EMPTY_POPULATION_STATUS,
  ReconRowError,
  ReconSweepError,
  compareBalances,
  isPlatformStated,
  runReconciliationSweep,
} from '../src/recon/sweep.ts';
import type { ReconCandidate, ReconSweepReport } from '../src/recon/sweep.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');

const DAY = '2026-08-26';
const BATCH_RUN = '00000000-0000-4000-8000-000000000387';
const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';
const FILE_ONE = '33333333-3333-4333-8333-333333333333';

// -----------------------------------------------------------------------------
// The recorder
// -----------------------------------------------------------------------------

interface Call {
  readonly transaction: number;
  readonly op: 'rowsWhere' | 'insert' | 'updateAt';
  readonly key: ReconReadTable | ReconWriteTable;
  readonly where?: ReconFilter;
  readonly values?: ReconValues;
}

interface Recorder {
  readonly io: ReconSweepIo;
  readonly calls: Call[];
  /** How many transactions were opened. The per-account split is visible here. */
  transactions(): number;
}

const IS_NULL: ReconFilterTerm = { term: 'is-null' };

interface RecorderOptions {
  readonly marks: readonly ReconValues[];
  readonly states: readonly ReconValues[];
  /** Rows already on `reconciliations` for the day, keyed by account. */
  readonly existing?: Readonly<Record<string, ReconValues>>;
  /** Throw on the Nth transaction, counting from one. */
  readonly dieOnTransaction?: number;
}

function recorder(options: RecorderOptions): Recorder {
  const calls: Call[] = [];
  let transaction = 0;
  let clock = 0;

  const tx: ReconTx = {
    async rowsWhere(key, where) {
      calls.push({ transaction, op: 'rowsWhere', key, where });
      if (key === 'dailyMarks') return [...options.marks];
      if (key === 'ruleStates') return [...options.states];
      const accountId = where['accountId'];
      const row = typeof accountId === 'string' ? options.existing?.[accountId] : undefined;
      return row === undefined ? [] : [row];
    },
    async insert(key, values) {
      calls.push({ transaction, op: 'insert', key, values });
      return key === 'reconciliationRuns' ? [{ id: 'run-1' }] : [values];
    },
    async updateAt(key, at, values) {
      calls.push({ transaction, op: 'updateAt', key, where: at, values });
      return [values];
    },
  };

  return {
    calls,
    transactions: () => transaction,
    io: {
      transact<T>(fn: (handle: ReconTx) => Promise<T>): Promise<T> {
        transaction += 1;
        if (transaction === options.dieOnTransaction) {
          return Promise.reject(new Error('simulated process death'));
        }
        return fn(tx);
      },
      terms: { isNull: () => IS_NULL },
      // A COUNTER AND NOT `new Date()`. Two runs over identical data must produce
      // identical writes, and a wall clock inside an assertion is a flake.
      now: () => new Date(Date.UTC(2026, 7, 28, 6, 0, clock++)),
    },
  };
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

function candidate(overrides: Partial<ReconCandidate> = {}): ReconCandidate {
  return {
    accountId: ACCOUNT_A,
    markSource: 'report',
    platformBalanceCents: 5_000_000n,
    sourceIngestFileId: FILE_ONE,
    ourBalanceCents: 5_000_000n,
    ...overrides,
  };
}

function sweep(options: RecorderOptions): Promise<[ReconSweepReport, Recorder]> {
  const rec = recorder(options);
  return runReconciliationSweep({ tradingDay: DAY, batchRunId: BATCH_RUN }, rec.io).then(
    (report) => [report, rec],
  );
}

// -----------------------------------------------------------------------------
// 1. The absence this slice was dispatched against, derived at run time
// -----------------------------------------------------------------------------

/** Every `.ts` under each app's and package's `src`, excluding this module. */
function applicationSources(): readonly string[] {
  const roots: string[] = [];
  for (const group of ['apps', 'packages']) {
    const base = join(REPO, group);
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory()) roots.push(join(base, entry.name, 'src'));
    }
  }
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) found.push(full);
    }
  };
  for (const root of roots) walk(root);
  return found.filter((file) => !file.includes(join('src', 'recon')));
}

describe('1. nothing else in this tree reconciles anything', () => {
  const sources = applicationSources();

  test('the sweep is measuring a real tree, not an empty list', () => {
    // A SWEEP THAT FOUND NO FILES WOULD PASS EVERY ASSERTION BELOW. This is the
    // acceptance case that stops the three refusals from being vacuous.
    expect(sources.length).toBeGreaterThan(200);
    expect(sources.some((file) => file.endsWith(join('apps', 'api', 'src', 'db.ts')))).toBe(true);
  });

  test('no module outside src/recon writes reconciliations or reconciliation_runs', () => {
    const writers: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      for (const key of ['reconciliations', 'reconciliationRuns']) {
        for (const op of ['insert', 'updateAt', 'deleteAt', 'insertUnder']) {
          if (text.includes(`${op}('${key}'`)) writers.push(`${relative(REPO, file)} ${op} ${key}`);
        }
      }
    }
    expect(writers).toStrictEqual([]);
  });

  test('nothing anywhere sets accounts.recon_blocked outside src/recon', () => {
    // `0014_marks.sql`: a mismatch sets it "and blocks eligibility until a HUMAN
    // resolves it". Both directions are absent from this tree, which is why the
    // sweep setting it is new and why the CLEARING path is still owed.
    const setters: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      if (/reconBlocked\s*:\s*(true|false)/.test(text)) setters.push(relative(REPO, file));
    }
    expect(setters).toStrictEqual([]);
  });

  test('the run record was registered and nothing had ever written it', () => {
    // 0064 landed the table and section 8 of its session log named the producer
    // as one of two things that did not clear. This is the half that clears.
    const scope = readFileSync(join(REPO, 'packages', 'db', 'src', 'scope.ts'), 'utf8');
    expect(scope).toContain('reconciliationRuns: {');
    expect(scope).toContain('reconciliations: {');
  });
});

// -----------------------------------------------------------------------------
// 2. The comparison, which is pure
// -----------------------------------------------------------------------------

describe('2. compareBalances', () => {
  test('equal balances are a match with a zero delta', () => {
    const verdict = compareBalances(candidate());
    expect(verdict).toStrictEqual({
      kind: 'compared',
      status: 'match',
      ourBalanceCents: 5_000_000n,
      platformBalanceCents: 5_000_000n,
      deltaCents: 0n,
      ourSource: 'rule_state',
      sourceIngestFileId: FILE_ONE,
    });
  });

  test('a disagreement is a mismatch and the delta is our minus theirs, in cents', () => {
    // `0014`'s own GENERATED expression, and the sign is the one the DDL writes:
    // `our_balance_cents - platform_balance_cents`.
    const verdict = compareBalances(candidate({ platformBalanceCents: 4_999_950n }));
    expect(verdict).toMatchObject({ status: 'mismatch', deltaCents: 50n });
  });

  test('the delta is exact past 2^53, because money is integer cents', () => {
    const verdict = compareBalances(
      candidate({
        ourBalanceCents: 9_007_199_254_740_993n,
        platformBalanceCents: 9_007_199_254_740_992n,
      }),
    );
    // A `number` subtraction renders this 0 and reports a MATCH.
    expect(verdict).toMatchObject({ status: 'mismatch', deltaCents: 1n });
  });

  test('a mark that is not the platform speaking is uncomparable and never a match', () => {
    for (const source of ['recomputed', 'simulated']) {
      expect(compareBalances(candidate({ markSource: source }))).toStrictEqual({
        kind: 'uncomparable',
        reason: 'mark_not_platform_stated',
      });
    }
    for (const source of PLATFORM_STATED_MARK_SOURCES) {
      expect(isPlatformStated(source)).toBe(true);
      expect(compareBalances(candidate({ markSource: source })).kind).toBe('compared');
    }
  });

  test('no rule state is uncomparable and never a match', () => {
    expect(compareBalances(candidate({ ourBalanceCents: null }))).toStrictEqual({
      kind: 'uncomparable',
      reason: 'no_rule_state',
    });
  });

  test('the mark is checked before the state, so a recomputed mark reports its own reason', () => {
    expect(
      compareBalances(candidate({ markSource: 'recomputed', ourBalanceCents: null })),
    ).toStrictEqual({ kind: 'uncomparable', reason: 'mark_not_platform_stated' });
  });

  test('the vocabularies are the DDL, and none of them grew', () => {
    expect(RECON_RUN_STATUSES).toStrictEqual(['running', 'completed', 'failed']);
    expect(RECON_STATUSES).toStrictEqual(['match', 'mismatch', 'resolved']);
    expect(PLATFORM_STATED_MARK_SOURCES).toStrictEqual(['report', 'api']);
    expect(RECON_SOURCE).toBe('rule_state');
    expect(RECON_READ_TABLES).toStrictEqual(['dailyMarks', 'ruleStates', 'reconciliations']);
    expect(RECON_WRITE_TABLES).toStrictEqual(['reconciliationRuns', 'reconciliations', 'accounts']);
  });
});

// -----------------------------------------------------------------------------
// 3. The run record, opened at the start and closed at the end
// -----------------------------------------------------------------------------

describe('3. the run record', () => {
  test('the run is opened running, at zero, before any account is compared', async () => {
    const [, rec] = await sweep({ marks: [mark()], states: [state()] });
    const open = rec.calls.find((c) => c.op === 'insert' && c.key === 'reconciliationRuns');
    expect(open?.values).toStrictEqual({
      batchRunId: BATCH_RUN,
      tradingDay: DAY,
      startedAt: new Date('2026-08-28T06:00:00.000Z'),
      accountsTotal: 1,
      accountsDone: 0,
      mismatchesFound: 0,
      status: 'running',
    });
    // `finished_at` IS NOT WRITTEN, not written as null.
    // `reconciliation_runs_finished_when_not_running` is an equivalence, so
    // `running` and an absent finish are one fact.
    expect(Object.keys(open?.values ?? {})).not.toContain('finishedAt');
    // AND IT IS OPENED IN ITS OWN TRANSACTION, AFTER the population read.
    expect(open?.transaction).toBe(2);
  });

  test('the population is the LIVE mark, which is the IS NULL term and not a filter in memory', async () => {
    // FOUND BY A SEED THAT DID NOT FIRE. Dropping `supersededBy: isNull()` from
    // the population read passed every other case in this file, because a
    // recorder returns what it was handed whatever the predicate said. The read
    // IS the definition of "live" -- `daily_marks_live_per_account_day_uq` is
    // `(account_id, trading_day) WHERE superseded_by IS NULL` -- and a sweep that
    // dropped the term would compare against a SUPERSEDED mark and report a
    // match for the very correction it exists to catch.
    const [, rec] = await sweep({ marks: [mark()], states: [state()] });
    const marks = rec.calls.find((c) => c.op === 'rowsWhere' && c.key === 'dailyMarks');
    expect(marks?.where).toStrictEqual({ tradingDay: DAY, supersededBy: IS_NULL });
    // AND THE STATE READ CARRIES NO TERM AT ALL. `rule_states` is never
    // superseded (`0015`: "a correction to the inputs produces a REPLAY"), so a
    // term there would be a predicate over a column that does not exist.
    const states = rec.calls.find((c) => c.op === 'rowsWhere' && c.key === 'ruleStates');
    expect(states?.where).toStrictEqual({ tradingDay: DAY });
    // BOTH READS ARE IN THE FIRST TRANSACTION, BEFORE THE RUN ROW EXISTS.
    expect(marks?.transaction).toBe(1);
    expect(states?.transaction).toBe(1);
  });

  test('a whole sweep closes completed, addressed by the run id', async () => {
    const [report, rec] = await sweep({ marks: [mark()], states: [state()] });
    expect(report).toMatchObject({
      runId: 'run-1',
      status: 'completed',
      accountsTotal: 1,
      accountsDone: 1,
      mismatchesFound: 0,
    });
    const close = rec.calls.find((c) => c.op === 'updateAt' && c.key === 'reconciliationRuns');
    expect(close?.where).toStrictEqual({ id: 'run-1' });
    expect(close?.values).toMatchObject({
      accountsDone: 1,
      mismatchesFound: 0,
      status: 'completed',
    });
  });

  test('one uncomparable account closes the run failed, never completed', async () => {
    // `reconciliation_runs_completed_is_whole` would refuse the row anyway. The
    // producer must not need the constraint to catch it.
    const [report] = await sweep({
      marks: [mark(), mark({ accountId: ACCOUNT_B })],
      states: [state()],
    });
    expect(report).toMatchObject({ status: 'failed', accountsTotal: 2, accountsDone: 1 });
    expect(report.outcomes).toContainEqual({
      accountId: ACCOUNT_B,
      kind: 'uncomparable',
      reason: 'no_rule_state',
    });
  });

  test('AN EMPTY POPULATION IS FAILED, because the completion control passes vacuously at 0 of 0', async () => {
    const [report, rec] = await sweep({ marks: [], states: [] });
    expect(EMPTY_POPULATION_STATUS).toBe('failed');
    expect(report).toMatchObject({ status: 'failed', accountsTotal: 0, accountsDone: 0 });
    const close = rec.calls.find((c) => c.op === 'updateAt' && c.key === 'reconciliationRuns');
    expect(close?.values).toMatchObject({ status: 'failed' });
    // The run row still EXISTS. A night whose ingest never landed must be a row
    // an operator can see, not a silence.
    expect(rec.calls.some((c) => c.op === 'insert' && c.key === 'reconciliationRuns')).toBe(true);
  });

  test('one account writing is one transaction, and the split is per account', async () => {
    const [, rec] = await sweep({
      marks: [mark(), mark({ accountId: ACCOUNT_B })],
      states: [state(), state({ accountId: ACCOUNT_B })],
    });
    // population read, open run, account A, account B, close.
    expect(rec.transactions()).toBe(5);
  });

  test("a write that throws is one account's failure and never the sweep's", async () => {
    const [report] = await sweep({
      marks: [mark(), mark({ accountId: ACCOUNT_B })],
      states: [state(), state({ accountId: ACCOUNT_B })],
      dieOnTransaction: 3,
    });
    expect(report.outcomes[0]).toMatchObject({ accountId: ACCOUNT_A, kind: 'failed' });
    expect(report.outcomes[1]).toMatchObject({ accountId: ACCOUNT_B, kind: 'compared' });
    // AND THE FAILURE DOES NOT COUNT. A run that could not write account A's
    // comparison has not done account A.
    expect(report).toMatchObject({ accountsTotal: 2, accountsDone: 1, status: 'failed' });
  });
});

// -----------------------------------------------------------------------------
// 4. The finding, and the consequence that makes it more than a timestamp
// -----------------------------------------------------------------------------

describe('4. the finding and its consequence', () => {
  test('a mismatch writes the comparison AND the block, in one transaction', async () => {
    const [report, rec] = await sweep({
      marks: [mark({ closingBalanceCents: 4_999_950n })],
      states: [state()],
    });
    expect(report).toMatchObject({ mismatchesFound: 1 });
    expect(report.outcomes[0]).toMatchObject({
      status: 'mismatch',
      deltaCents: 50n,
      blocked: true,
    });

    const finding = rec.calls.find((c) => c.op === 'insert' && c.key === 'reconciliations');
    const block = rec.calls.find((c) => c.op === 'updateAt' && c.key === 'accounts');
    expect(finding?.values).toStrictEqual({
      accountId: ACCOUNT_A,
      tradingDay: DAY,
      ourBalanceCents: 5_000_000n,
      platformBalanceCents: 4_999_950n,
      status: 'mismatch',
      ourSource: 'rule_state',
      sourceIngestFileId: FILE_ONE,
      updatedAt: new Date('2026-08-28T06:00:01.000Z'),
    });
    expect(block?.where).toStrictEqual({ id: ACCOUNT_A });
    expect(block?.values).toStrictEqual({
      reconBlocked: true,
      updatedAt: new Date('2026-08-28T06:00:01.000Z'),
    });
    // ONE TRANSACTION. A mismatch row without the block is an account excluded
    // from nothing, and a block without the row is an account nobody can explain.
    expect(finding?.transaction).toBe(block?.transaction);
  });

  test('THE SWEEP NEVER CLEARS A BLOCK. A match writes no accounts value at all', async () => {
    // `0014`: "blocks eligibility until a HUMAN resolves it". The type cannot
    // forbid `reconBlocked: false`, so every committed value is walked instead.
    const [, rec] = await sweep({ marks: [mark()], states: [state()] });
    expect(rec.calls.filter((c) => c.key === 'accounts')).toStrictEqual([]);
  });

  test('an uncomparable account writes nothing at all and is not blocked', async () => {
    const [report, rec] = await sweep({
      marks: [mark({ source: 'recomputed' })],
      states: [state()],
    });
    expect(report.outcomes[0]).toMatchObject({ kind: 'uncomparable' });
    expect(
      rec.calls.filter((c) => c.key === 'reconciliations' && c.op !== 'rowsWhere'),
    ).toStrictEqual([]);
    expect(rec.calls.filter((c) => c.key === 'accounts')).toStrictEqual([]);
  });

  test('delta_cents, resolved_by and resolution_note are never written', async () => {
    // `delta_cents` is GENERATED ALWAYS: writing it is an error rather than a
    // duplication. The two resolution columns are the human's transition, and a
    // redelivery that re-finds a mismatch must not erase what they wrote.
    const [, rec] = await sweep({
      marks: [mark({ closingBalanceCents: 1n })],
      states: [state()],
      existing: { [ACCOUNT_A]: { id: 7n, status: 'resolved', resolvedBy: 'ops@merit.test' } },
    });
    for (const call of rec.calls) {
      for (const field of ['deltaCents', 'resolvedBy', 'resolutionNote', 'createdAt']) {
        expect(Object.keys(call.values ?? {})).not.toContain(field);
      }
    }
  });
});

// -----------------------------------------------------------------------------
// 5. The redelivery, which RB-02 mandates and 0064 refused a unique index for
// -----------------------------------------------------------------------------

describe('5. a redelivered day updates rather than duplicates', () => {
  test('an existing comparison is UPDATED, addressed by its primary key', async () => {
    const [, rec] = await sweep({
      marks: [mark({ closingBalanceCents: 4_999_950n })],
      states: [state()],
      existing: { [ACCOUNT_A]: { id: 7n } },
    });
    expect(rec.calls.some((c) => c.op === 'insert' && c.key === 'reconciliations')).toBe(false);
    const update = rec.calls.find((c) => c.op === 'updateAt' && c.key === 'reconciliations');
    // ADDRESSED BY `id` AND NOT BY `(accountId, tradingDay)`, and the reason is
    // measured rather than stylistic: `uniqueKeys` in packages/db reads the
    // Drizzle declaration, `reconciliations_account_day_uq` is a CREATE UNIQUE
    // INDEX, and schema.ts carries no `uniqueIndex` at all. The accessor refuses
    // the natural key with "contains no unique key reconciliations declares".
    expect(update?.where).toStrictEqual({ id: 7n });
    expect(update?.values).toMatchObject({ status: 'mismatch' });
  });

  test('a row that cannot be addressed is refused rather than guessed at', async () => {
    const rec = recorder({
      marks: [mark()],
      states: [state()],
      existing: { [ACCOUNT_A]: { id: 7 } },
    });
    const report = await runReconciliationSweep({ tradingDay: DAY, batchRunId: BATCH_RUN }, rec.io);
    expect(report.outcomes[0]).toMatchObject({ kind: 'failed' });
    expect((report.outcomes[0] as { error: string }).error).toContain('bigint');
  });
});

// -----------------------------------------------------------------------------
// 6. The refusals
// -----------------------------------------------------------------------------

describe('6. what the sweep will not write', () => {
  test('a batchRunId that is not a uuid is refused before anything is opened', async () => {
    const rec = recorder({ marks: [], states: [] });
    await expect(
      runReconciliationSweep({ tradingDay: DAY, batchRunId: 'nightly-2026-08-26' }, rec.io),
    ).rejects.toThrow(ReconSweepError);
    // `batch_run_id` IS `NOT NULL` WITH NO FOREIGN KEY, so nothing downstream can
    // tell a wrong value from a right one. This refusal is the only check there is.
    expect(rec.transactions()).toBe(0);
  });

  test('a malformed trading day is refused rather than matching nothing', async () => {
    const rec = recorder({ marks: [], states: [] });
    await expect(
      runReconciliationSweep({ tradingDay: '26-08-26', batchRunId: BATCH_RUN }, rec.io),
    ).rejects.toThrow(ReconSweepError);
    expect(rec.transactions()).toBe(0);
  });

  test('a number where cents are expected is refused, never coerced', async () => {
    const rec = recorder({ marks: [mark({ closingBalanceCents: 5_000_000 })], states: [state()] });
    await expect(
      runReconciliationSweep({ tradingDay: DAY, batchRunId: BATCH_RUN }, rec.io),
    ).rejects.toThrow(ReconRowError);
  });

  test('the unwired default serves nothing and says why', async () => {
    await expect(UNWIRED_RECON_SWEEP_IO.transact(async () => 1)).rejects.toThrow(ReconSweepUnwired);
    expect(() => UNWIRED_RECON_SWEEP_IO.now()).toThrow(ReconSweepUnwired);
    expect(() => UNWIRED_RECON_SWEEP_IO.terms.isNull()).toThrow(ReconSweepUnwired);
  });
});

// -----------------------------------------------------------------------------
// 7. The door, derived from the accessor's own source
// -----------------------------------------------------------------------------

describe('7. the handle that can reach both tables', () => {
  const scopedDb = readFileSync(join(REPO, 'packages', 'db', 'src', 'scoped-db.ts'), 'utf8');
  const scope = readFileSync(join(REPO, 'packages', 'db', 'src', 'scope.ts'), 'utf8');

  test('the parse is sound before anything rests on it', () => {
    expect(scopedDb).toContain('export interface SystemTx extends TxCommon {');
    expect(scopedDb).toContain('export interface FirmTx extends TxCommon {');
  });

  test('SystemTx is the handle whose three operations are generic over TableKey', () => {
    const systemTx = scopedDb.slice(
      scopedDb.indexOf('export interface SystemTx extends TxCommon {'),
      scopedDb.indexOf('export interface FirmTx extends TxCommon {'),
    );
    for (const op of ['rowsWhere', 'insert', 'updateAt']) {
      expect(systemTx).toContain(`${op}<K extends TableKey`);
    }
  });

  test('the two tables sit in two scope classes, which is why apps/api cannot be the producer', () => {
    // `reconciliation_runs` is `firm` and `apps/api`'s `firm` door could write
    // it. `reconciliations` is `derived`, which is not a `FirmTableKey`, so that
    // door cannot name it and there is no identity for the `scoped` one.
    // `apps/api/src/routes/internal.ts` says the same thing about itself.
    const runsRule = scope.slice(scope.indexOf('  reconciliationRuns: {'));
    expect(runsRule.slice(0, 200)).toContain("class: 'firm'");
    const oneRule = scope.slice(scope.indexOf('  reconciliations: {'));
    expect(oneRule.slice(0, 200)).toContain("class: 'derived'");

    // `apps/api` HOLDS FOUR DOORS AND NOT ONE OF THEM CAN NAME `reconciliations`.
    // Derived from that file rather than remembered, because an earlier reading
    // of this session's counted two and there are four.
    const apiDb = readFileSync(join(REPO, 'apps', 'api', 'src', 'db.ts'), 'utf8');
    const doors = [
      'scoped<T>(identityId: string, fn: (tx: ScopedTx) => Promise<T>): Promise<T>;',
      'firm<T>(fn: (tx: FirmTx) => Promise<T>): Promise<T>;',
      'resolution<T>(fn: (rx: ResolutionDb) => Promise<T>): Promise<T>;',
      'establishment<T>(fn: (tx: EstablishmentTx) => Promise<T>): Promise<T>;',
    ];
    for (const door of doors) expect(apiDb).toContain(door);
    // AND THE FIFTH IS REFUSED IN WRITING. `ADR-171` clause 1 and `ADR-165`: a
    // door over `SystemTx` is the one `apps/api` deliberately does not open, so
    // that file names the type only to say it will not have one.
    expect(apiDb).toContain('THERE IS STILL NO `system(reason, fn)` HERE');
    expect(apiDb).not.toContain('SystemTx>');
  });

  test('this deployable holds that door already and this slice did not widen it', () => {
    const workerDb = readFileSync(join(HERE, '..', 'src', 'db.ts'), 'utf8');
    expect(workerDb).toContain('batch<T>(fn: (tx: SystemTx) => Promise<T>): Promise<T>;');
    expect(workerDb).toContain(
      "export const WORKER_REASON: SystemReason = 'nightly-batch' as const;",
    );
    // NO `@merit/db` IMPORT ARRIVED WITH THIS SLICE. ADR-165's one acquisition
    // point, asserted over this module specifically.
    for (const file of ['ports.ts', 'sweep.ts']) {
      const text = readFileSync(join(HERE, '..', 'src', 'recon', file), 'utf8');
      expect(text).not.toContain("from '@merit/db'");
    }
  });
});
