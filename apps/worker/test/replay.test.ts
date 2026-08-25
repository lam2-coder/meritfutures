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

import {
  buildCalendarSlice,
  replay,
  type CalendarDay,
  type CalendarSlice,
  type DailyMark,
  type EngineGateResults,
  type RuleState,
  type SettlementFact,
} from '@merit/rules-engine';

import { foldAccountDay } from '../src/batch/nightly.ts';
import type { AccountDay, RuleStateRow } from '../src/batch/ports.ts';
import {
  auditAccount,
  diffStoredAgainstRecomputed,
  runReplayAudit,
  ReplayAuditRefusal,
  type AccountDayInput,
  type ReplayAuditConfig,
} from '../src/batch/replay.ts';
import { ENGINE_GATE_LEAVES, stateHash, type StateHashSubject } from '../src/batch/state-hash.ts';
import { ACCOUNT_A, ACCOUNT_B, CALENDAR, CLEAR, ENGINE_VERSION, PLAN, td } from './fixtures.ts';

const WATERMARK = 11;

const CONFIG: ReplayAuditConfig = { engineVersion: ENGINE_VERSION, mode: 'detect' };

/**
 * A stored row as the subject the hash reads.
 *
 * `RuleStateRow` satisfies `HashedState` structurally, which is what lets ONE
 * set of renderers and ONE field list read both sides of the comparison:
 * storage's rows and the engine's states. The row's own `stateHash` bytes do not
 * come with it, which is B.2: the stored row is never re-hashed, and the
 * comparison never has the chance to.
 */
const asSubject = (row: RuleStateRow): StateHashSubject => ({
  accountId: row.accountId,
  state: row,
});

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
    expect(diffStoredAgainstRecomputed(first!, asSubject(first!))).toEqual([]);
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
      const divergences = diffStoredAgainstRecomputed(stored, asSubject(recomputed));

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
      const divergences = diffStoredAgainstRecomputed(stored, asSubject(recomputed));

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

    const divergences = diffStoredAgainstRecomputed(stored, asSubject(recomputed));

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

  it('THE REFUSAL BOUNDARY: a refused day stops the chain and the rest is reported', () => {
    // Stored is the CLEAN four-day chain, so the fixture is a history the batch
    // really did write. What went wrong is on the INPUT side: day 3's mark opens
    // one cent above the prior close, which fails `opening_mismatch` ("INV-18:
    // opening balance is not the prior balance plus the adjustment"). The
    // closing balance moves with it so the mark stays internally consistent and
    // INV-18 is the ONLY thing wrong with it.
    //
    // DO-3 refuses rather than throwing, so the chain has no prior for day 3 and
    // ends there. Days 3 and 4 are then reported by the other direction of the
    // set alignment: rows storage holds that the replay never reproduced. AN
    // AUDIT THAT STOPPED FOLDING MUST NOT REPORT LIKE ONE THAT AGREED (FM-17),
    // which is why the assertion is on all four counts and not on `diverged`.
    const stored = storedFor(ACCOUNT_A);
    const inputs = inputsOf(ACCOUNT_A).map((input, index) =>
      index === 2
        ? {
            ...input,
            day: {
              ...input.day,
              mark: {
                ...input.day.mark,
                openingBalanceCents: input.day.mark.openingBalanceCents + 1n,
                closingBalanceCents: input.day.mark.closingBalanceCents + 1n,
              },
            },
          }
        : input,
    );

    const report = auditAccount(ACCOUNT_A, inputs, stored, CONFIG, WATERMARK);

    expect(report.matched).toBe(2);
    expect(report.diverged).toBe(2);
    expect(report.outOfScope).toBe(0);
    expect(report.inScope).toBe(MARKS.length);
    expect(report.findings.map((f) => f.tradingDay)).toEqual([td('2026-08-12'), td('2026-08-13')]);
    expect(report.findings.map((f) => f.divergences[0]!.recomputed)).toEqual([
      '<no replayed row>',
      '<no replayed row>',
    ]);
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

    const divergences = diffStoredAgainstRecomputed(stored, asSubject(recomputed));

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

// =============================================================================
// 6. GS-071: a 250-day funded life, THE HASH FIRST AND THEN FIELD BY FIELD
// =============================================================================
// `GS-071` is "replay of a 250-day funded life reproduces every stored state
// byte-identically", pinned as "the core determinism claim, asserted on state
// hashes and then field by field"
// (`docs/testing/golden-scenarios/06-gs-071-to-gs-078-...`). ADR-076 section 3
// rules it `writable` HERE rather than in the golden loader, and rules why: the
// loader may import the engine's published entry point only, and `replay.ts`
// and `state-hash.ts` live in `apps/worker`. It also rules that the difference
// between what block 1 already asserts and what this row asks for "is a SCALE
// and not a shape".
//
// -----------------------------------------------------------------------------
// THE ORDER IS THE POINT AND IT IS NOT A STYLE PREFERENCE
// -----------------------------------------------------------------------------
// NEITHER ASSERTION IS REDUNDANT AND THE NEXT READER WILL THINK ONE OF THEM IS,
// which is the only reason this paragraph exists.
//
//   THE HASH tells you THAT two runs diverged and cannot tell you WHERE. It is
//   the total assertion: thirty-two bytes over all nineteen columns, so a
//   divergence ANYWHERE fails it, including in a field nobody thought to
//   compare and in a field added to the row after this test was written.
//
//   THE FIELD COMPARISON tells you WHERE and is satisfied by a field nobody
//   compared. On its own it is a list this file maintains by hand, and a list
//   maintained by hand is a list that goes stale silently.
//
// So the hash is asserted FIRST, because it is the verdict, and the fields are
// compared AFTER, because a verdict nobody can localise is a nightly page that
// says "something moved". That is M01 Appendix B.2's own ordering
// ("compare `state_hash` first, then diff field by field") asserted at test
// scale rather than only implemented at run time in `diffStoredAgainstRecomputed`.
//
// DELETING EITHER ONE LOSES SOMETHING THE OTHER NEVER HAD.
//
// -----------------------------------------------------------------------------
// 250 IS THE ROW'S NUMBER AND THE FIRST ASSERTION IS ABOUT THE SCALE
// -----------------------------------------------------------------------------
// A test that asserted this at four days under the `GS-071` name would discharge
// nothing, and nothing about a passing determinism assertion says what it ran
// over. So the case asserts the SHAPE OF THE LIFE before it asserts anything
// about replaying it: 250 stored rows, every one of them `funded`, the R-31
// reset visible on the first, and four settlements. If a future edit shortens
// the stream, the case fails on the count rather than passing quietly at a
// scale the row does not name.
//
// THE FIXTURES IN `fixtures.ts` CANNOT REACH THIS AND THAT IS WHY THE CALENDAR
// AND THE MARKS ARE BUILT HERE. `CALENDAR` covers five sessions
// (`2026-08-10..2026-08-14`) and `MARKS` above is four days that never leave the
// eval phase: day 1 closes 30,000c up against a 300,000c target. Neither is a
// defect; block 5's chain test needs four days and says so. A 250-day funded
// life needs a 250-session calendar and a mark stream that passes the eval, and
// building those in `fixtures.ts` would put them in `nightly-batch.test.ts`'s
// import graph for no caller.

// -----------------------------------------------------------------------------
// The calendar: 260 sessions, as DATA and never as date arithmetic
// -----------------------------------------------------------------------------
// R-02 and AS-06: "gap counting is `calendar.sequence` subtraction, never date
// arithmetic", and the calendar itself is maintained as data (CLAUDE.md). So the
// sessions here are ENUMERATED rather than computed from a clock: twenty
// sessions a month, which is what an exchange month is, over thirteen months.
// Nothing in this file constructs a `Date`, which is also what keeps it inside
// M01 section 1.4's banned-construct list even though the list binds the engine
// and not its tests.
//
// 260 SESSIONS FOR 250 MARKS, and the ten spare are not padding. R-31 starts
// the new consistency period on the trading day AFTER the eval pass, R-47 does
// the same after each settlement, and R-37 resolves `nextEligibleTradingDay`
// forward from the cadence anchor. A slice that ended on the last mark would
// make those lookups land outside coverage, and ADR-049 rules that a typed
// refusal rather than a null: the fold would refuse days it should close.

const SCALE_MONTHS: readonly string[] = [
  '2026-01',
  '2026-02',
  '2026-03',
  '2026-04',
  '2026-05',
  '2026-06',
  '2026-07',
  '2026-08',
  '2026-09',
  '2026-10',
  '2026-11',
  '2026-12',
  '2027-01',
];

/** Twenty sessions a month. The sequence is the calendar's, not an index. */
const SCALE_SESSIONS: readonly CalendarDay[] = SCALE_MONTHS.flatMap((month, m) =>
  Array.from({ length: 20 }, (_, d) => ({
    tradingDay: td(`${month}-${String(d + 1).padStart(2, '0')}`),
    isHalfDay: false,
    halted: false,
    sequence: 20_001 + m * 20 + d,
  })),
);

const SCALE_CALENDAR: CalendarSlice = buildCalendarSlice({
  days: SCALE_SESSIONS,
  coverage: {
    from: SCALE_SESSIONS[0]!.tradingDay,
    to: SCALE_SESSIONS[SCALE_SESSIONS.length - 1]!.tradingDay,
  },
});

/**
 * GS-071's number, and the one this file must not quietly reduce.
 *
 * EVERY ONE OF THE 250 STORED ROWS IS `funded`, INCLUDING THE FIRST, and that
 * is R-31 rather than an off-by-one. The eval pass and the funded reset happen
 * in ONE step at DO-8: the day the account clears the 300,000c target is folded
 * as an eval day and the row it writes already carries `phase: 'funded'`, the
 * balance back at `size_cents`, and every counter at zero. So the life is 250
 * funded rows, the first of which is the day the account became funded.
 */
const FUNDED_DAYS = 250;

// -----------------------------------------------------------------------------
// The life, and every number in it is bounded by a rule rather than chosen
// -----------------------------------------------------------------------------
// Core EOD at 50K (`PLAN`, transcribed from M01 Appendix A.1) leaves a narrow
// band, and the band is what fixes the arithmetic below:
//
//   R-15  THE LOCK IS PERMANENT AND ASSIGNS (ADR-052). A close at
//         5,260,000c (260,000c of profit) locks the floor at 5,010,000c and
//         FREEZES `highWaterBalanceCents` for the rest of the account's life.
//         `0015:208`'s `rule_states_high_water_bounds_balance` REJECTED every
//         later row whose balance exceeded the lock-day close WHEN THIS FILE
//         WAS WRITTEN, and `0037` retired that name on 2026-08-17. The live
//         constraint is `rule_states_high_water_bounds_balance_unlocked`,
//         `floor_locked OR high_water_balance_cents >= balance_cents`, which
//         EXEMPTS the locked row rather than refusing it, and post-lock the
//         schema asserts no relation between the two columns at all (ADR-053).
//         So a locked life is one the database now accepts, and what holds the
//         shape here are this file's own assertions: `floorLocked` empty and
//         `hwb >= balance` on all 250 rows. THE STREAM THEREFORE NEVER REACHES
//         260,000c OF PROFIT: it peaks at 219,000c, which keeps that live
//         constraint on its BINDING branch for every row rather than on its
//         exemption.
//   R-35  the withdrawable is `balance - size - buffer`, and the buffer is
//         100,000c, so the first 100,000c of profit is not payable. A payout of
//         110,000c therefore needs 210,000c of profit standing, which is why the
//         first settlement is on funded day 99 and not on funded day 9.
//   R-49  `payoutsSettledCount >= max_payouts` GRADUATES the account, and
//         `advanceDay` then returns at DO-2 because "no trading day follows".
//         Core EOD's ladder is five, so the life settles FOUR times: a fifth
//         would close the account on the day it fired and every session after
//         it would fold into a graduated state rather than a funded one.
//   R-09  a win day is `realized_pnl_cents >= 15,000c`, and R-29 wants the best
//         day at or under 30 percent of the period's profit. Those pull opposite
//         ways: five win days per ten sessions at 15,000c to 18,000c, against a
//         period profit that has to reach at least 3.33x the best day before the
//         consistency gate can pass. The cycle below satisfies both, which is
//         why both gates MOVE across the life instead of sitting at one verdict.

/**
 * Ten sessions of realized P&L, repeated. `+20,000c` a cycle, best day
 * `18,000c`, five win days.
 *
 * A CYCLE RATHER THAN A CONSTANT, because a constant daily P&L makes every gate
 * monotone and a replay of a monotone stream cannot distinguish an engine that
 * chains its own prior from one that recomputes each day from the mark. The
 * partial sums inside the cycle run `+16, +7, +22, +10, +28, +21, +36, +22, +39,
 * +20` (thousands of cents), so the balance oscillates by 32,000c inside every
 * cycle while drifting up by 20,000c across it.
 */
const PNL_CYCLE: readonly bigint[] = [
  16_000n,
  -9_000n,
  15_000n,
  -12_000n,
  18_000n,
  -7_000n,
  15_000n,
  -14_000n,
  17_000n,
  -19_000n,
];

/**
 * The four settlements: index into the life, and the amount approved.
 *
 * EACH IS AT OR UNDER THE WITHDRAWABLE STANDING THE DAY BEFORE, which is what
 * makes the stream a life rather than four arbitrary debits, and the case
 * ASSERTS that against the stored rows rather than stating it here: a
 * transcribed figure is a figure that goes stale when the cycle moves. Every
 * one is at or under R-39's 150,000c cap and at or over its 10,000c minimum,
 * and they are 50 or 40 sessions apart, which clears R-37's five-trading-day
 * cadence gap by a wide margin.
 */
const SETTLEMENT_SCHEDULE: readonly { readonly dayIndex: number; readonly cents: bigint }[] = [
  { dayIndex: 100, cents: 110_000n },
  { dayIndex: 150, cents: 105_000n },
  { dayIndex: 200, cents: 100_000n },
  { dayIndex: 240, cents: 80_000n },
];

/** The eval day: one session, straight through R-26's 300,000c target. */
const EVAL_PROFIT_CENTS = 300_000n;

interface LifeDay {
  readonly mark: DailyMark;
  readonly settlements: readonly SettlementFact[];
}

/**
 * The 250 marks, derived from the fold's own balances.
 *
 * THE OPENING BALANCE IS READ OFF THE PRIOR STATE RATHER THAN RE-DERIVED, and
 * that is the same choice `storedFor` above makes for the same reason. INV-18 is
 * `opening == prior.balance + adjustment` and R-31 resets the balance to
 * `size_cents` on the pass day; a fixture that computed its own openings would
 * be a second implementation of R-31 living in a test, and it would disagree
 * with the engine on the one day that matters most.
 *
 * IT IS NOT A CIRCULARITY. Nothing here asserts that the balances are right;
 * `nightly-batch.test.ts` and the engine's own suites do that. What this builds
 * is a coherent INPUT STREAM, and the assertion the stream feeds is that
 * replaying it twice produces the same bytes.
 */
function buildLife(): readonly LifeDay[] {
  const days: LifeDay[] = [];
  let prior: RuleState | null = null;
  let settledCount = 0;

  for (let index = 0; index < FUNDED_DAYS; index += 1) {
    const tradingDay = SCALE_SESSIONS[index]!.tradingDay;
    const priorBalance = prior?.balanceCents ?? PLAN.sizeCents;

    const fundedDay = index - 1;
    const scheduled = SETTLEMENT_SCHEDULE.find((s) => s.dayIndex === index);

    // SD-01 and R-10: a settled withdrawal lands at the OPEN of its effective
    // day, in `adjustment_cents`, never inside the session.
    const adjustmentCents = scheduled === undefined ? 0n : -scheduled.cents;
    const openingBalanceCents = priorBalance + adjustmentCents;

    const realizedPnlCents =
      index === 0 ? EVAL_PROFIT_CENTS : PNL_CYCLE[fundedDay % PNL_CYCLE.length]!;
    const closingBalanceCents = openingBalanceCents + realizedPnlCents;

    const low =
      openingBalanceCents < closingBalanceCents ? openingBalanceCents : closingBalanceCents;
    const high =
      openingBalanceCents > closingBalanceCents ? openingBalanceCents : closingBalanceCents;

    const settlements: SettlementFact[] = [];
    if (scheduled !== undefined) {
      settledCount += 1;
      settlements.push({
        payoutRequestId: `0199c7a1-0000-7000-8000-${String(settledCount).padStart(12, '0')}`,
        // R-45. The ordinal is `payoutsSettledCount + 1` at request time.
        ordinal: settledCount,
        approvedCents: scheduled.cents,
        // R-46 and R-47. The decision was computed against the previous closed
        // day, so the new consistency period starts on the day after it, which
        // is this day. `rule_states_consistency_period_started` (`0015:193`)
        // needed that `<= trading_day` and got equality WHEN THIS FILE WAS
        // WRITTEN; `0046` retired that name and the live constraint is
        // `rule_states_consistency_period_after_anchor`, which needs the period
        // start STRICTLY AFTER `payout_anchor_day` (ADR-079). R-46 sets that
        // anchor to the BASIS day on the line below, so the row clears the live
        // constraint by one session rather than by equality, and NOTHING in the
        // schema now bounds the period start against `trading_day` in either
        // direction.
        basisTradingDay: SCALE_SESSIONS[index - 1]!.tradingDay,
        effectiveTradingDay: tradingDay,
      });
    }

    const mark: DailyMark = {
      tradingDay,
      openingBalanceCents,
      closingBalanceCents,
      highBalanceCents: high + 1_000n,
      lowBalanceCents: low - 1_000n,
      realizedPnlCents,
      adjustmentCents,
      fillCount: 3 + (index % 4),
      sourceHash: `gs-071-day-${String(index)}`,
    };

    days.push({ mark, settlements });

    const fold = foldAccountDay(
      {
        accountId: ACCOUNT_A,
        plan: PLAN,
        prior,
        mark,
        settlements,
        external: CLEAR,
        openedOn: SCALE_SESSIONS[0]!.tradingDay,
      },
      SCALE_CALENDAR,
      ENGINE_VERSION,
      WATERMARK,
    );
    // A REFUSAL WHILE BUILDING IS A BROKEN FIXTURE AND IT SAYS SO. DO-3 refuses
    // rather than throwing, so a stream that violated INV-18 or breached the
    // floor would otherwise produce a short history and a green test over it.
    if (fold.kind !== 'row') {
      throw new Error(
        `the GS-071 stream refused on ${tradingDay}: ` +
          fold.assertions.map((a) => `${a.kind} ${a.detail}`).join('; '),
      );
    }
    prior = fold.state;
  }

  return days;
}

const LIFE = buildLife();

/** What the batch would have stored, folded once, chaining its own prior. */
function storedLife(): readonly RuleStateRow[] {
  const rows: RuleStateRow[] = [];
  let prior: RuleState | null = null;
  for (const day of LIFE) {
    const fold = foldAccountDay(
      {
        accountId: ACCOUNT_A,
        plan: PLAN,
        prior,
        mark: day.mark,
        settlements: day.settlements,
        external: CLEAR,
        openedOn: SCALE_SESSIONS[0]!.tradingDay,
      },
      SCALE_CALENDAR,
      ENGINE_VERSION,
      WATERMARK,
    );
    if (fold.kind !== 'row') throw new Error('the GS-071 stream refused while storing');
    rows.push(fold.row);
    prior = fold.state;
  }
  return rows;
}

/**
 * The inputs the replay is handed. `prior` is null on every one of them.
 *
 * INV-04 is "replaying every mark FROM DAY ONE", and `auditAccount` carries its
 * own prior for exactly that reason, so the field is set to the value that would
 * break a replay reading it.
 */
const scaleInputs = (): readonly AccountDayInput[] =>
  LIFE.map((day) => ({
    day: {
      accountId: ACCOUNT_A,
      plan: PLAN,
      prior: null,
      mark: day.mark,
      settlements: day.settlements,
      external: CLEAR,
      openedOn: SCALE_SESSIONS[0]!.tradingDay,
    } satisfies AccountDay,
    calendar: SCALE_CALENDAR,
  }));

// -----------------------------------------------------------------------------
// The field list, TRANSCRIBED, and the gate leaves IMPORTED
// -----------------------------------------------------------------------------
// The same boundary block 2 draws and for the same reason. The eighteen entries
// below are transcribed from ADR-026 C-07's column list, so a renamed column
// fails here rather than agreeing with itself; the twenty-five leaves are
// expanded from `ENGINE_GATE_LEAVES` because that is a COVERAGE question about
// column 19 and not a question about SQL.
//
// THEY READ THE ROW'S FIELDS AND NOT THE HASH'S RENDERERS, which is what makes
// this an independent comparison rather than a second look at the same bytes.
// `HASHED_COLUMNS[n].render` produced the string the hash consumed; comparing
// two rows through it would fail only where the hash already failed.

interface HashedFieldCase {
  /** The `rule_states` column, or `engine_gates.<dotted.path>` for a leaf. */
  readonly column: string;
  /**
   * READ OFF A `StateHashSubject` AND NOT OFF A ROW, so the one list serves both
   * sides of every comparison below: what storage holds, which arrives as
   * `RuleStateRow`, and what the engine's `replay` folded, which arrives as
   * `RuleState`. `StateHashSubject` is the shape ADR-026 C-07 actually covers --
   * the account id, which is column 1 and is not on `RuleState`, plus the
   * eighteen state fields -- so the list is transcribed against the thing it
   * names rather than against one of the two carriers.
   */
  readonly of: (subject: StateHashSubject) => unknown;
}

function leafValue(gates: EngineGateResults, path: string): unknown {
  const [head, tail] = path.split('.') as [keyof EngineGateResults, string];
  return (gates[head] as unknown as Record<string, unknown>)[tail];
}

const HASHED_FIELDS: readonly HashedFieldCase[] = [
  { column: 'account_id', of: (s) => s.accountId },
  { column: 'trading_day', of: (s) => s.state.tradingDay },
  { column: 'phase', of: (s) => s.state.phase },
  { column: 'floor_cents', of: (s) => s.state.floorCents },
  { column: 'floor_locked', of: (s) => s.state.floorLocked },
  { column: 'floor_open_cents', of: (s) => s.state.floorOpenCents },
  { column: 'high_water_balance_cents', of: (s) => s.state.highWaterBalanceCents },
  { column: 'balance_cents', of: (s) => s.state.balanceCents },
  { column: 'withdrawable_cents', of: (s) => s.state.withdrawableCents },
  { column: 'traded_days_count', of: (s) => s.state.tradedDaysCount },
  { column: 'win_days_count', of: (s) => s.state.winDaysCount },
  { column: 'consistency_best_day_cents', of: (s) => s.state.consistencyBestDayCents },
  { column: 'consistency_period_profit_cents', of: (s) => s.state.consistencyPeriodProfitCents },
  { column: 'consistency_period_start_day', of: (s) => s.state.consistencyPeriodStartDay },
  { column: 'payouts_settled_count', of: (s) => s.state.payoutsSettledCount },
  { column: 'payout_anchor_day', of: (s) => s.state.payoutAnchorDay },
  { column: 'cadence_anchor_day', of: (s) => s.state.cadenceAnchorDay },
  { column: 'engine_eligible', of: (s) => s.state.engineEligible },
  ...ENGINE_GATE_LEAVES.map((leaf) => ({
    column: `engine_gates.${leaf.path}`,
    of: (subject: StateHashSubject) => leafValue(subject.state.engineGates, leaf.path),
  })),
];

/** Rendered, never raw: a bigint reaching an assertion message throws on it. */
function show(value: unknown): string {
  if (typeof value === 'bigint') return value.toString(10);
  if (typeof value === 'string') return value;
  return String(value);
}

/**
 * Every field on every day that disagrees, NAMED.
 *
 * IT RETURNS A LIST RATHER THAN ASSERTING PER FIELD, so a failure prints the
 * `trading_day` and the column and both values rather than "expected true to be
 * false" on the 43rd expectation of the 137th day.
 */
function fieldMismatches(
  stored: readonly StateHashSubject[],
  recomputed: readonly StateHashSubject[],
): readonly string[] {
  const mismatches: string[] = [];
  const days = stored.length < recomputed.length ? stored.length : recomputed.length;

  for (let i = 0; i < days; i += 1) {
    const s = stored[i]!;
    const r = recomputed[i]!;
    for (const field of HASHED_FIELDS) {
      const left = field.of(s);
      const right = field.of(r);
      // `Object.is`, so two `bigint`s of equal value agree and `NaN` never does.
      if (!Object.is(left, right)) {
        mismatches.push(
          `${s.state.tradingDay} ${field.column}: stored ${show(left)}, replay ${show(right)}`,
        );
      }
    }
  }
  return mismatches;
}

describe('GS-071  a 250-day funded life replays byte-identically', () => {
  it('replays 250 funded days: the hash first, and then field by field', () => {
    const stored = storedLife();

    // -------------------------------------------------------------------------
    // 0. THE SCALE, BEFORE ANY CLAIM ABOUT REPLAYING IT
    // -------------------------------------------------------------------------
    // GS-071 says 250 funded days. A determinism assertion at four days would
    // pass every expectation below and discharge nothing, and a passing
    // assertion does not report what it ran over.
    expect(stored).toHaveLength(FUNDED_DAYS);
    expect(stored.filter((row) => row.phase === 'funded')).toHaveLength(FUNDED_DAYS);

    // DAY ONE IS THE PASS DAY AND ITS ROW IS ALREADY FUNDED. R-31 moves the
    // phase, resets the balance to `size_cents`, resets the floor to
    // `size_cents - funded drawdown_cents` and zeroes every counter, all in the
    // one DO-8 step that recognised the pass. The mark closed 300,000c above
    // the size and the row it wrote carries the size, which is the reset
    // visible in the stored data rather than in a comment.
    expect(LIFE[0]!.mark.closingBalanceCents).toBe(PLAN.sizeCents + EVAL_PROFIT_CENTS);
    expect(stored[0]!.balanceCents).toBe(PLAN.sizeCents);
    expect(stored[0]!.floorCents).toBe(PLAN.sizeCents - PLAN.funded.drawdown.drawdownCents);
    expect(stored[0]!.tradedDaysCount).toBe(0);
    expect(stored[0]!.winDaysCount).toBe(0);

    // THE LIFE THE ROWS DESCRIBE IS ONE AN ACCOUNT COULD HAVE HAD, which is
    // what makes it a funded LIFE and not 250 folds of arbitrary numbers.
    //
    //   - four settlements, so R-49's five-payout ladder never graduates the
    //     account and ends the stream early;
    //   - each one at or under the withdrawable that was standing the day
    //     before, so no payout exceeds what R-35 says the trader had;
    //   - the floor never locks, so `highWaterBalanceCents` is never frozen
    //     below a later balance and every row satisfies `0037`'s
    //     `rule_states_high_water_bounds_balance_unlocked` on its BINDING
    //     branch: `floor_locked` is false on all 250, so the disjunction
    //     reduces to `high_water_balance_cents >= balance_cents`, which is what
    //     the assertion below checks. `0015`'s unqualified
    //     `rule_states_high_water_bounds_balance` is retired and names nothing
    //     in the live schema.
    expect(stored[stored.length - 1]!.payoutsSettledCount).toBe(SETTLEMENT_SCHEDULE.length);
    for (const settlement of SETTLEMENT_SCHEDULE) {
      expect(stored[settlement.dayIndex - 1]!.withdrawableCents).toBeGreaterThanOrEqual(
        settlement.cents,
      );
    }
    expect(stored.filter((row) => row.floorLocked)).toHaveLength(0);
    expect(stored.every((row) => row.highWaterBalanceCents >= row.balanceCents)).toBe(true);
    // The lock trigger, stated as the margin the stream actually kept rather
    // than as a number in a comment: 219,000c of profit at the peak against
    // R-15's 260,000c. `floorLocked` above is the consequence; this is the
    // input, and it is what a later edit to `PNL_CYCLE` would move first.
    const peakProfitCents =
      stored.reduce((peak, row) => (row.balanceCents > peak ? row.balanceCents : peak), 0n) -
      PLAN.sizeCents;
    expect(peakProfitCents).toBe(219_000n);
    expect(peakProfitCents).toBeLessThan(
      PLAN.funded.drawdown.lock.enabled ? PLAN.funded.drawdown.lock.atProfitCents : 0n,
    );

    // A SECOND, INDEPENDENT FOLD OF THE SAME 250 MARKS, WHICH IS WHAT INV-04
    // ASKS FOR AND IS NOT AS TRIVIAL AS "THE SAME FUNCTION TWICE" SOUNDS.
    // Two runs of one pure function disagree the moment anything on the path
    // reads a clock, iterates an object's keys where the result reaches the
    // output, or serializes through a locale: M01 section 1.4's banned-construct
    // list is exactly the list of ways this expectation fails, and the hash
    // makes 250 days of that observable in one comparison. `PT-06` is the
    // property-test form over shuffled arrival order and randomized `TZ` and
    // `LC_ALL`; this is the 250-day form of the same claim.
    const replayed = storedLife();

    // -------------------------------------------------------------------------
    // 1. THE HASH, FIRST. The verdict: a divergence ANYWHERE fails this
    // -------------------------------------------------------------------------
    // Compared as one array of 250 hex digests rather than day by day, because
    // a per-day loop that stopped early would assert over a prefix and report
    // like a run that compared everything (FM-17).
    expect(replayed.map((row) => row.stateHash.toString('hex'))).toEqual(
      stored.map((row) => row.stateHash.toString('hex')),
    );

    // -------------------------------------------------------------------------
    // 2. THEN FIELD BY FIELD. What makes a divergence diagnosable
    // -------------------------------------------------------------------------
    // 43 comparisons a day over 250 days: the eighteen `RuleState` columns, the
    // account id, and column 19 expanded to its twenty-five leaves. The hash
    // above already failed if any of these moved; this says WHICH.
    expect(fieldMismatches(stored.map(asSubject), replayed.map(asSubject))).toEqual([]);
    expect(HASHED_FIELDS).toHaveLength(18 + ENGINE_GATE_LEAVES.length);

    // AND THE COMPARISON IS NOT VACUOUS, which the equality above cannot say.
    // `leafValue` walks a dotted path by hand, so a mistyped or renamed path
    // reads `undefined` on BOTH sides, agrees with itself, and removes a field
    // from the comparison without removing a line from the list. That is the
    // same shape `DELTA_MANIFEST` section 13 records one level down: a check
    // that passes because it checked nothing.
    const unread = HASHED_FIELDS.filter((field) =>
      stored.some((row) => field.of(asSubject(row)) === undefined),
    );
    expect(unread.map((field) => field.column)).toEqual([]);

    // -------------------------------------------------------------------------
    // 3. AND THROUGH THE ENGINE'S OWN `replay`, WHICH IS NOW THE AUDIT'S FOLD
    // -------------------------------------------------------------------------
    // ADR-078 exported `replay` because withholding it COMPELLED a second
    // implementation, and `apps/worker/src/batch/replay.ts` was the one it named
    // by path. `auditAccount` folds through it now instead of over its own loop,
    // so the claim that has to be EXECUTED rather than argued is that the two
    // are the same fold over this stream. Four things moved -- the arrival
    // order, the settlement grouping, the assertion handling and the terminal
    // break -- and any one of them changing the output changes these bytes.
    //
    // IT IS A DIFFERENTIAL AND NOT A SECOND LOOK AT THE SAME CALL. `stored` was
    // folded by `foldAccountDay`, day by day, chaining its own prior: that is
    // the implementation being replaced, still on this page, still folding.
    //
    // ASSERTED IN B.2's ORDER FOR B.2's REASON, exactly as above. The 250
    // digests are the verdict; the 43 fields a day say WHERE, if it fails.
    const engineStates = replay(
      PLAN,
      LIFE.map((day) => day.mark),
      LIFE.flatMap((day) => day.settlements),
      SCALE_CALENDAR,
      ENGINE_VERSION,
      SCALE_SESSIONS[0]!.tradingDay,
    );
    const engineSubjects: readonly StateHashSubject[] = engineStates.map((state) => ({
      accountId: ACCOUNT_A,
      state,
    }));

    // THE COUNT FIRST, because `replay` breaks at `closed` and at `graduated`. A
    // stream that graduated early would fold fewer days, and both comparisons
    // below would then run over a prefix and pass (FM-17).
    expect(engineStates).toHaveLength(FUNDED_DAYS);

    expect(engineSubjects.map((subject) => stateHash(subject).toString('hex'))).toEqual(
      stored.map((row) => row.stateHash.toString('hex')),
    );
    expect(fieldMismatches(stored.map(asSubject), engineSubjects)).toEqual([]);

    // -------------------------------------------------------------------------
    // 4. AND THROUGH THE AUDIT ITSELF, which is what runs in production
    // -------------------------------------------------------------------------
    // The counts beside the zero are the assertion, exactly as in block 1: an
    // audit that compared nothing also reports zero divergences.
    const report = auditAccount(ACCOUNT_A, scaleInputs(), stored, CONFIG, WATERMARK);

    expect(report.diverged).toBe(0);
    expect(report.findings).toEqual([]);
    expect(report.matched).toBe(FUNDED_DAYS);
    expect(report.inScope).toBe(FUNDED_DAYS);
    expect(report.storedRows).toBe(FUNDED_DAYS);
    expect(report.outOfScope).toBe(0);
  });
});
