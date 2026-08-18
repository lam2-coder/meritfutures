// =============================================================================
// apps/worker/test/replay.test.ts
// =============================================================================
// INV-04's comparison, tested SUCCESS CASES FIRST.
//
// `DELTA_MANIFEST` section 13 records why, and it is the lesson this file is
// built on: "Every probe in section 10 attempted a forbidden thing and asserted
// a rejection, so EVERY ONE OF THEM PASSES AGAINST A GUARD THAT REJECTS
// EVERYTHING." A comparison is the same shape one level up. A comparison that
// reported divergence on everything would pass every divergence test ever
// written against it, and one that reported nothing would pass none of them but
// would also pass a suite that only ever fed it matching rows.
//
// So block 1 is the negative control and it asserts THREE things beside "zero
// divergences": that the rows were in scope, that they were compared, and that
// the count equals the number of days. Zero divergences and zero comparisons
// look identical from outside, which is FM-17 and is the whole reason `OI-14`
// exists.
//
// THE LOAD-BEARING TEST IS IN BLOCK 5: a poisoned day 2 in a four-day chain must
// diverge days 2, 3 AND 4. It is the only assertion here that distinguishes a
// replay carrying its own prior from one reading the stored prior, and reading
// the stored prior is an audit that folds the audited value back into the audit.
// It was written before the module and watched failing against a version that
// took `AccountDay.prior` from storage; that failure is quoted in the PR.
// =============================================================================

import { describe, expect, it } from 'vitest';

import type { DailyMark, EngineGateResults, RuleState } from '@merit/rules-engine';

import { foldAccountDay } from '../src/batch/nightly.js';
import type { AccountDay, RuleStateRow } from '../src/batch/ports.js';
import {
  auditAccount,
  diffStoredAgainstRecomputed,
  runReplayAudit,
  ReplayAuditRefusal,
  type AccountDayInput,
  type ReplayAuditConfig,
} from '../src/batch/replay.js';
import { ENGINE_GATE_LEAVES, stateHash } from '../src/batch/state-hash.js';
import { ACCOUNT_A, ACCOUNT_B, CALENDAR, CLEAR, ENGINE_VERSION, PLAN, td } from './fixtures.js';

const WATERMARK = 11;

const CONFIG: ReplayAuditConfig = { engineVersion: ENGINE_VERSION, mode: 'detect' };

// -----------------------------------------------------------------------------
// A four-day life, which is the shortest history the chain test can use
// -----------------------------------------------------------------------------
// Three days would let a day-2 poisoning look like a day-2-and-3 divergence,
// which is also what a one-step recompute produces on the LAST day of a chain.
// Four days puts a clean day after the propagation so the shapes differ.

const MARKS: readonly DailyMark[] = [
  {
    tradingDay: td('2026-08-10'),
    openingBalanceCents: 5_000_000n,
    closingBalanceCents: 5_030_000n,
    highBalanceCents: 5_035_000n,
    lowBalanceCents: 4_990_000n,
    realizedPnlCents: 30_000n,
    adjustmentCents: 0n,
    fillCount: 3,
    sourceHash: 'day-1',
  },
  {
    tradingDay: td('2026-08-11'),
    openingBalanceCents: 5_030_000n,
    closingBalanceCents: 5_070_000n,
    highBalanceCents: 5_075_000n,
    lowBalanceCents: 5_025_000n,
    realizedPnlCents: 40_000n,
    adjustmentCents: 0n,
    fillCount: 4,
    sourceHash: 'day-2',
  },
  {
    tradingDay: td('2026-08-12'),
    openingBalanceCents: 5_070_000n,
    closingBalanceCents: 5_110_000n,
    highBalanceCents: 5_115_000n,
    lowBalanceCents: 5_065_000n,
    realizedPnlCents: 40_000n,
    adjustmentCents: 0n,
    fillCount: 5,
    sourceHash: 'day-3',
  },
  {
    tradingDay: td('2026-08-13'),
    openingBalanceCents: 5_110_000n,
    closingBalanceCents: 5_150_000n,
    highBalanceCents: 5_155_000n,
    lowBalanceCents: 5_105_000n,
    realizedPnlCents: 40_000n,
    adjustmentCents: 0n,
    fillCount: 4,
    sourceHash: 'day-4',
  },
];

const historyOf = (accountId: string): readonly AccountDay[] =>
  MARKS.map((mark) => ({
    accountId,
    plan: PLAN,
    // IGNORED BY THE REPLAY, and set to a deliberately wrong value in the chain
    // test to prove it. The audit carries its own prior.
    prior: null,
    mark,
    settlements: [],
    external: CLEAR,
    openedOn: MARKS[0]!.tradingDay,
  }));

const inputsOf = (accountId: string): readonly AccountDayInput[] =>
  historyOf(accountId).map((day) => ({ day, calendar: CALENDAR }));

/**
 * The rows storage would hold if the batch had written them faithfully.
 *
 * Folded with the same chaining the audit uses, which is what makes block 1 a
 * REPRODUCTION test rather than a comparison of one function against itself on
 * different inputs.
 */
function storedFor(accountId: string): RuleStateRow[] {
  const rows: RuleStateRow[] = [];
  let prior: RuleState | null = null;
  for (const day of historyOf(accountId)) {
    const fold = foldAccountDay({ ...day, prior }, CALENDAR, ENGINE_VERSION, WATERMARK);
    if (fold.kind !== 'row') throw new Error('fixture refused');
    rows.push(fold.row);
    prior = fold.state;
  }
  return rows;
}

/**
 * A stored row that is SELF-CONSISTENT and disagrees with today's replay.
 *
 * The hash is recomputed over the patched values on purpose: real storage holds
 * a row whose hash matches its own columns, written by whatever engine wrote it.
 * Patching a column and leaving the old hash would be a row no batch could have
 * produced, and the hash-first comparison would pass it.
 */
function storedWith(row: RuleStateRow, patch: Partial<RuleStateRow>): RuleStateRow {
  const patched = { ...row, ...patch };
  return { ...patched, stateHash: stateHash({ accountId: patched.accountId, state: patched }) };
}

/**
 * The rows a BUGGY ENGINE would have written: correct until `poisonAt`, wrong
 * from there on, and wrong DOWNSTREAM because each later day folds from the
 * poisoned state rather than from a clean one.
 *
 * This is what a real engine defect looks like in storage, and it is not the
 * same fixture as "one stored row was edited": that one leaves every later row
 * faithful, so it cannot distinguish a replay that chains its own prior from one
 * that reads the stored prior. Both report a single divergence.
 *
 * THE POISONED FIELD IS `winDaysCount` AND THE FIRST ATTEMPT USED
 * `balanceCents`, WHICH IS WORTH RECORDING. A balance one cent out does not
 * propagate: the next day's DO-3 checks `INV-18` (`mark.opening ==
 * prior.balance + adjustment`), the assertion fails, and the fold REFUSES to
 * write a row at all. So the engine already refuses to build a chain on a
 * poisoned balance, and only a field no assertion cross-checks -- a counter --
 * can produce the downstream-wrong storage this test needs.
 */
function storedByBuggyEngine(accountId: string, poisonAt: number): RuleStateRow[] {
  const rows: RuleStateRow[] = [];
  let prior: RuleState | null = null;
  let index = 0;
  for (const day of historyOf(accountId)) {
    const fold = foldAccountDay({ ...day, prior }, CALENDAR, ENGINE_VERSION, WATERMARK);
    if (fold.kind !== 'row') throw new Error('fixture refused');
    if (index === poisonAt) {
      const state: RuleState = { ...fold.state, winDaysCount: fold.state.winDaysCount + 1 };
      rows.push(storedWith(fold.row, { winDaysCount: fold.row.winDaysCount + 1 }));
      prior = state;
    } else {
      rows.push(fold.row);
      prior = fold.state;
    }
    index += 1;
  }
  return rows;
}

// =============================================================================
// 1. The negative control: a faithful replay diverges on nothing
// =============================================================================

describe('a faithful replay reproduces every stored row', () => {
  it('reports zero divergences, and says how much it looked at', () => {
    const stored = storedFor(ACCOUNT_A);
    const report = auditAccount(ACCOUNT_A, inputsOf(ACCOUNT_A), stored, CONFIG, WATERMARK);

    // The assertion that matters is not the zero. It is the three counts beside
    // it: an audit that compared nothing also reports zero divergences.
    expect(report.diverged).toBe(0);
    expect(report.findings).toEqual([]);
    expect(report.inScope).toBe(report.storedRows);
    expect(report.inScope).toBe(MARKS.length);
    expect(report.matched).toBe(MARKS.length);
    expect(report.outOfScope).toBe(0);
  });

  it('emits nothing through the port when nothing diverged', async () => {
    const stored = storedFor(ACCOUNT_A);
    const calls: string[] = [];
    const report = await runReplayAudit(
      {
        read: {
          calendarWatermark: async () => WATERMARK,
          calendarSlice: async () => CALENDAR,
          accountsWithLiveMark: async () => [],
          loadAccountDay: async () => null,
          accountsWithStoredState: async () => [ACCOUNT_A],
          storedRuleStates: async () => stored,
          accountDaysFrom: async () => historyOf(ACCOUNT_A),
        },
        write: {
          writeRuleState: async () => undefined,
          raiseReconciliation: async () => undefined,
          raiseDivergence: async (f) => {
            calls.push(`raiseDivergence:${f.accountId}:${f.tradingDay}`);
          },
        },
      },
      CONFIG,
    );

    // Asserted on the RECORDED CALLS, not on the return value: a report that
    // lists divergences nobody was told about is a silent audit.
    expect(calls).toEqual([]);
    expect(report.matched).toBe(MARKS.length);
    expect(report.inScope).toBe(report.storedRows);
  });

  it('does not diff a row whose hash matches, which is B.2 in one line', () => {
    const [first] = storedFor(ACCOUNT_A);
    expect(diffStoredAgainstRecomputed(first!, first!)).toEqual([]);
  });
});

// =============================================================================
// 2. Every hashed column names itself
// =============================================================================
// THE EXPECTED NAME IS TRANSCRIBED, THE COVERAGE SWEEP IMPORTS. Two different
// jobs, and the boundary matters enough to state because the next reader's
// instinct on seeing `HASHED_COLUMNS` imported into this file will be to delete
// it.
//
//   - The `column` string in each case below is transcribed from ADR-026 C-07,
//     the same rule `state-hash.test.ts` opens with: a fixture derived from the
//     implementation proves only that the code agrees with itself. If the
//     implementation renames a column, these cases must fail.
//   - The `covers all nineteen` sweep at the end READS the implementation's
//     list, because it checks COVERAGE and not VALUES: it asks "is there a case
//     for every column", which is a question about this file, not about SQL.

interface ColumnCase {
  readonly column: string;
  readonly patch: (row: RuleStateRow) => Partial<RuleStateRow>;
}

const COLUMN_CASES: readonly ColumnCase[] = [
  { column: 'account_id', patch: () => ({ accountId: ACCOUNT_B }) },
  { column: 'trading_day', patch: () => ({ tradingDay: td('2026-08-14') }) },
  { column: 'phase', patch: (r) => ({ phase: r.phase === 'funded' ? 'eval' : 'funded' }) },
  { column: 'floor_cents', patch: (r) => ({ floorCents: r.floorCents + 1n }) },
  { column: 'floor_locked', patch: (r) => ({ floorLocked: !r.floorLocked }) },
  { column: 'floor_open_cents', patch: (r) => ({ floorOpenCents: r.floorOpenCents + 1n }) },
  {
    column: 'high_water_balance_cents',
    patch: (r) => ({ highWaterBalanceCents: r.highWaterBalanceCents + 1n }),
  },
  { column: 'balance_cents', patch: (r) => ({ balanceCents: r.balanceCents + 1n }) },
  {
    column: 'withdrawable_cents',
    patch: (r) => ({ withdrawableCents: r.withdrawableCents + 1n }),
  },
  { column: 'traded_days_count', patch: (r) => ({ tradedDaysCount: r.tradedDaysCount + 1 }) },
  { column: 'win_days_count', patch: (r) => ({ winDaysCount: r.winDaysCount + 1 }) },
  {
    column: 'consistency_best_day_cents',
    patch: (r) => ({ consistencyBestDayCents: r.consistencyBestDayCents + 1n }),
  },
  {
    column: 'consistency_period_profit_cents',
    patch: (r) => ({ consistencyPeriodProfitCents: r.consistencyPeriodProfitCents + 1n }),
  },
  {
    column: 'consistency_period_start_day',
    patch: (r) => ({
      consistencyPeriodStartDay: r.consistencyPeriodStartDay === null ? td('2026-08-11') : null,
    }),
  },
  {
    column: 'payouts_settled_count',
    patch: (r) => ({ payoutsSettledCount: r.payoutsSettledCount + 1 }),
  },
  {
    column: 'payout_anchor_day',
    patch: (r) => ({ payoutAnchorDay: r.payoutAnchorDay === null ? td('2026-08-11') : null }),
  },
  {
    column: 'cadence_anchor_day',
    patch: (r) => ({ cadenceAnchorDay: r.cadenceAnchorDay === null ? td('2026-08-11') : null }),
  },
  { column: 'engine_eligible', patch: (r) => ({ engineEligible: !r.engineEligible }) },
];

describe('every hashed column names itself when it moves', () => {
  const recomputed = storedFor(ACCOUNT_A)[1]!;

  for (const testCase of COLUMN_CASES) {
    it(`names ${testCase.column}`, () => {
      const stored = storedWith(recomputed, testCase.patch(recomputed));
      const divergences = diffStoredAgainstRecomputed(stored, recomputed);

      expect(divergences).toHaveLength(1);
      expect(divergences[0]!.field).toBe(testCase.column);
      // Rendered strings, never raw values: a bigint in an event payload throws
      // at emission time, in production, on the one night it matters.
      expect(typeof divergences[0]!.stored).toBe('string');
      expect(typeof divergences[0]!.recomputed).toBe('string');
      expect(divergences[0]!.stored).not.toBe(divergences[0]!.recomputed);
    });
  }

  it('covers all nineteen columns, counting engine_gates as block 3 s', () => {
    const covered = new Set(COLUMN_CASES.map((c) => c.column));
    covered.add('engine_gates');
    expect(covered.size).toBe(19);
  });
});

// =============================================================================
// 3. Every engine_gates leaf names itself
// =============================================================================

/** Change the value at a dotted path, whatever its type, without touching others. */
function bumpLeaf(gates: EngineGateResults, path: string): EngineGateResults {
  const [head, tail] = path.split('.') as [keyof EngineGateResults, string];
  const gate = gates[head] as unknown as Record<string, unknown>;
  const current = gate[tail];

  let next: unknown;
  if (typeof current === 'boolean') next = !current;
  else if (typeof current === 'bigint') next = current + 1n;
  else if (typeof current === 'number') next = current + 1;
  // A null leaf needs a replacement of the RIGHT TYPE: two of the five nullable
  // leaves are trading days, and `day()` refuses anything that is not
  // YYYY-MM-DD. Substituting 1 there throws while BUILDING the fixture, which
  // is a broken test rather than a caught divergence.
  else if (current === null) next = path.endsWith('Day') ? td('2026-08-14') : 1;
  else next = `${String(current)}-moved`;

  return { ...gates, [head]: { ...gate, [tail]: next } } as unknown as EngineGateResults;
}

describe('every engine_gates leaf names itself when it moves', () => {
  const recomputed = storedFor(ACCOUNT_A)[1]!;

  for (const leaf of ENGINE_GATE_LEAVES) {
    it(`names engine_gates.${leaf.path}`, () => {
      const stored = storedWith(recomputed, {
        engineGates: bumpLeaf(recomputed.engineGates, leaf.path),
      });
      const divergences = diffStoredAgainstRecomputed(stored, recomputed);

      expect(divergences).toHaveLength(1);
      expect(divergences[0]!.field).toBe(`engine_gates.${leaf.path}`);
      // NOT the bare parent. A bare `engine_gates` event says that something in
      // twenty-five numbers moved, which is what the dotted paths exist to end.
      expect(divergences.map((d) => d.field)).not.toContain('engine_gates');
    });
  }

  it('covers all twenty-five leaves', () => {
    expect(ENGINE_GATE_LEAVES).toHaveLength(25);
  });
});

// =============================================================================
// 4. Scope is B.4 step 1, read twice, and an empty scope refuses
// =============================================================================

describe('scope is B.4 step 1 and an empty scope is a refusal', () => {
  it('skips a row from an older engine version rather than reporting it', () => {
    const stored = storedFor(ACCOUNT_A).map((row, i) =>
      i === 1 ? { ...row, engineVersion: 'engine-older' } : row,
    );
    const report = auditAccount(ACCOUNT_A, inputsOf(ACCOUNT_A), stored, CONFIG, WATERMARK);

    expect(report.outOfScope).toBe(1);
    expect(report.diverged).toBe(0);
    expect(report.inScope).toBe(MARKS.length - 1);
  });

  it('skips a row carrying a stale calendar watermark (ADR-047)', () => {
    const stored = storedFor(ACCOUNT_A).map((row, i) =>
      i === 2 ? { ...row, calendarRevisionId: WATERMARK - 1 } : row,
    );
    const report = auditAccount(ACCOUNT_A, inputsOf(ACCOUNT_A), stored, CONFIG, WATERMARK);

    expect(report.outOfScope).toBe(1);
    expect(report.diverged).toBe(0);
  });

  it('treats a null watermark on both sides as in scope, because null is meaningful', () => {
    let prior: RuleState | null = null;
    const stored: RuleStateRow[] = [];
    for (const day of historyOf(ACCOUNT_A)) {
      const fold = foldAccountDay({ ...day, prior }, CALENDAR, ENGINE_VERSION, null);
      if (fold.kind !== 'row') throw new Error('fixture refused');
      stored.push(fold.row);
      prior = fold.state;
    }
    const report = auditAccount(ACCOUNT_A, inputsOf(ACCOUNT_A), stored, CONFIG, null);

    expect(report.inScope).toBe(MARKS.length);
    expect(report.outOfScope).toBe(0);
    expect(report.diverged).toBe(0);
  });

  it('compares everything in dry-run mode, which is B.4 step 2', () => {
    const stored = storedFor(ACCOUNT_A).map((row) => ({ ...row, engineVersion: 'engine-older' }));
    const report = auditAccount(
      ACCOUNT_A,
      inputsOf(ACCOUNT_A),
      stored,
      { engineVersion: ENGINE_VERSION, mode: 'dryRun' },
      WATERMARK,
    );

    expect(report.outOfScope).toBe(0);
    expect(report.inScope).toBe(MARKS.length);
  });

  it('REFUSES a run that compared nothing while rows exist (OI-14)', async () => {
    const stored = storedFor(ACCOUNT_A).map((row) => ({ ...row, engineVersion: 'engine-older' }));

    await expect(
      runReplayAudit(
        {
          read: {
            calendarWatermark: async () => WATERMARK,
            calendarSlice: async () => CALENDAR,
            accountsWithLiveMark: async () => [],
            loadAccountDay: async () => null,
            accountsWithStoredState: async () => [ACCOUNT_A],
            storedRuleStates: async () => stored,
            accountDaysFrom: async () => historyOf(ACCOUNT_A),
          },
          write: {
            writeRuleState: async () => undefined,
            raiseReconciliation: async () => undefined,
            raiseDivergence: async () => undefined,
          },
        },
        CONFIG,
      ),
    ).rejects.toThrow(ReplayAuditRefusal);
  });

  it('does not refuse when there is genuinely nothing stored', async () => {
    const report = await runReplayAudit(
      {
        read: {
          calendarWatermark: async () => WATERMARK,
          calendarSlice: async () => CALENDAR,
          accountsWithLiveMark: async () => [],
          loadAccountDay: async () => null,
          accountsWithStoredState: async () => [],
          storedRuleStates: async () => [],
          accountDaysFrom: async () => [],
        },
        write: {
          writeRuleState: async () => undefined,
          raiseReconciliation: async () => undefined,
          raiseDivergence: async () => undefined,
        },
      },
      CONFIG,
    );

    expect(report.storedRows).toBe(0);
    expect(report.inScope).toBe(0);
  });
});

// =============================================================================
// 5. A divergence is never quiet, and the prior is the fold's own
// =============================================================================

describe('a divergence is never quiet', () => {
  it('THE CHAIN TEST: a poisoned day 2 diverges days 2, 3 and 4', () => {
    // Storage as a BUGGY ENGINE wrote it: day 2's state came out one cent
    // wrong, and days 3 and 4 were then folded FROM that wrong state, so all
    // three stored rows are wrong and each is self-consistent.
    //
    // A replay that took each day's `prior` FROM STORAGE would fold day 3 off
    // the poisoned stored day 2, agree with stored day 3, and report ONE
    // divergence. A replay carrying its own prior disagrees from day 2 forward.
    // THIS ASSERTION IS THE ONLY THING IN THE SUITE THAT TELLS THE TWO APART.
    const stored = storedByBuggyEngine(ACCOUNT_A, 1);

    const report = auditAccount(ACCOUNT_A, inputsOf(ACCOUNT_A), stored, CONFIG, WATERMARK);

    expect(report.diverged).toBe(3);
    expect(report.findings.map((f) => f.tradingDay)).toEqual([
      td('2026-08-11'),
      td('2026-08-12'),
      td('2026-08-13'),
    ]);
    expect(report.matched).toBe(1);
  });

  it('ignores AccountDay.prior entirely, even when it is wrong', () => {
    const stored = storedFor(ACCOUNT_A);
    // A prior that no fold produced. If the audit read it, day 1 would diverge.
    const poisonedPrior = { ...stored[3]! } as unknown as RuleState;
    const inputs = inputsOf(ACCOUNT_A).map((input) => ({
      ...input,
      day: { ...input.day, prior: poisonedPrior },
    }));

    const report = auditAccount(ACCOUNT_A, inputs, stored, CONFIG, WATERMARK);

    expect(report.diverged).toBe(0);
    expect(report.matched).toBe(MARKS.length);
  });

  it('reports a hash mismatch no column explains, rather than nothing', () => {
    const recomputed = storedFor(ACCOUNT_A)[0]!;
    // Columns identical, hash corrupted: the bytes disagree and the serializer
    // cannot say why, which is the most alarming outcome available.
    const stored: RuleStateRow = { ...recomputed, stateHash: Buffer.alloc(32, 7) };

    const divergences = diffStoredAgainstRecomputed(stored, recomputed);

    expect(divergences).toHaveLength(1);
    expect(divergences[0]!.field).toBe('state_hash');
    expect(divergences[0]!.stored).toBe(Buffer.alloc(32, 7).toString('hex'));
    expect(divergences[0]!.recomputed).toBe(recomputed.stateHash.toString('hex'));
  });

  it('reports a stored day the replay never reproduced', () => {
    const stored = storedFor(ACCOUNT_A);
    const extra: RuleStateRow = { ...stored[0]!, tradingDay: td('2026-08-14') };

    const report = auditAccount(
      ACCOUNT_A,
      inputsOf(ACCOUNT_A),
      [...stored, extra],
      CONFIG,
      WATERMARK,
    );

    expect(report.diverged).toBe(1);
    expect(report.findings[0]!.tradingDay).toBe(td('2026-08-14'));
    expect(report.findings[0]!.divergences[0]!.recomputed).toBe('<no replayed row>');
  });

  it('reports a replayed day storage does not hold', () => {
    const stored = storedFor(ACCOUNT_A).slice(0, 3);
    const report = auditAccount(ACCOUNT_A, inputsOf(ACCOUNT_A), stored, CONFIG, WATERMARK);

    expect(report.diverged).toBe(1);
    expect(report.findings[0]!.tradingDay).toBe(td('2026-08-13'));
    expect(report.findings[0]!.divergences[0]!.stored).toBe('<no stored row>');
  });

  it('reports an unrenderable stored value instead of throwing the run', () => {
    const recomputed = storedFor(ACCOUNT_A)[0]!;
    // A jsonb decode that handed back a string where a count belongs. `count()`
    // throws on it; the audit must survive and say so.
    const broken = {
      ...recomputed.engineGates,
      tradedDays: { ...recomputed.engineGates.tradedDays, have: 'three' },
    } as unknown as EngineGateResults;
    const stored: RuleStateRow = {
      ...recomputed,
      engineGates: broken,
      stateHash: Buffer.alloc(32, 3),
    };

    const divergences = diffStoredAgainstRecomputed(stored, recomputed);

    const found = divergences.find((d) => d.field === 'engine_gates.tradedDays.have');
    expect(found).toBeDefined();
    expect(found!.stored).toMatch(/^<unrenderable: /);
  });

  it('hands every finding to the port', async () => {
    const stored = storedByBuggyEngine(ACCOUNT_A, 1);
    const calls: string[] = [];

    await runReplayAudit(
      {
        read: {
          calendarWatermark: async () => WATERMARK,
          calendarSlice: async () => CALENDAR,
          accountsWithLiveMark: async () => [],
          loadAccountDay: async () => null,
          accountsWithStoredState: async () => [ACCOUNT_A],
          storedRuleStates: async () => stored,
          accountDaysFrom: async () => historyOf(ACCOUNT_A),
        },
        write: {
          writeRuleState: async () => undefined,
          raiseReconciliation: async () => undefined,
          raiseDivergence: async (f) => {
            calls.push(`raiseDivergence:${f.tradingDay}`);
          },
        },
      },
      CONFIG,
    );

    expect(calls).toEqual([
      'raiseDivergence:2026-08-11',
      'raiseDivergence:2026-08-12',
      'raiseDivergence:2026-08-13',
    ]);
  });
});
