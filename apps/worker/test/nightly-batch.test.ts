// =============================================================================
// apps/worker/test/nightly-batch.test.ts
// =============================================================================
// The batch's decisions, tested without a database, because `foldAccountDay` is
// pure and `runNightlyBatch` is a loop over ports.
//
// THE CALENDAR HERE IS SYNTHETIC AND THE FILE SAYS SO RATHER THAN IMPLYING IT.
// TR-01 forbids writing down which days the exchange trades from recollection,
// and the transcription is a founder item (P2 section 6). The five days below
// are a WINDOW, not a claim: whether CME traded on them is not asserted and is
// not what this file tests, which is that the batch reads the right rows, folds
// through the published entry point, refuses the right days, and stamps the
// right watermark. The sequence base is 9001 rather than 0 for the reason the
// engine's own suite gives for starting at 4021: a test must not be able to
// confuse a window offset for a calendar index.

import { describe, expect, it } from 'vitest';

import type { ExternalGates } from '@merit/rules-engine';

import { foldAccountDay, runNightlyBatch } from '../src/batch/nightly.js';
import type { NightlyBatchConfig } from '../src/batch/nightly.js';
import type {
  AccountDay,
  BatchPorts,
  ReconciliationFinding,
  ReplayDivergenceFinding,
  RuleStateRow,
} from '../src/batch/ports.js';

import {
  ACCOUNT_A,
  ACCOUNT_B,
  CALENDAR,
  CLEAR,
  DAY_ONE,
  ENGINE_VERSION,
  accountDay,
  td,
} from './fixtures.js';

// -----------------------------------------------------------------------------
// A recording port pair
// -----------------------------------------------------------------------------

interface Recording {
  readonly ports: BatchPorts;
  readonly writes: RuleStateRow[];
  readonly reconciliations: ReconciliationFinding[];
  readonly divergences: ReplayDivergenceFinding[];
  /** Every port call, in the order it was made. */
  readonly calls: string[];
  /** The high-water number of `loadAccountDay` calls in flight at once. */
  peakInFlight(): number;
}

interface RecordingOptions {
  readonly watermark?: number | null;
  readonly days?: Readonly<Record<string, AccountDay | null>>;
  /** The replay audit's inputs: stored rows and the input history, per account. */
  readonly stored?: Readonly<Record<string, readonly RuleStateRow[]>>;
  readonly history?: Readonly<Record<string, readonly AccountDay[]>>;
  /** Milliseconds each account's load takes, so completion order can be shuffled. */
  readonly loadDelayMs?: Readonly<Record<string, number>>;
}

function recordingPorts(accountIds: readonly string[], options: RecordingOptions = {}): Recording {
  const writes: RuleStateRow[] = [];
  const reconciliations: ReconciliationFinding[] = [];
  const divergences: ReplayDivergenceFinding[] = [];
  const calls: string[] = [];
  let inFlight = 0;
  let peak = 0;

  const days = options.days ?? {};
  const delays = options.loadDelayMs ?? {};

  const ports: BatchPorts = {
    read: {
      calendarWatermark: async () => {
        calls.push('calendarWatermark');
        return options.watermark === undefined ? 11 : options.watermark;
      },
      calendarSlice: async () => {
        calls.push('calendarSlice');
        return CALENDAR;
      },
      accountsWithLiveMark: async () => {
        calls.push('accountsWithLiveMark');
        return accountIds;
      },
      loadAccountDay: async (accountId) => {
        calls.push(`loadAccountDay:${accountId}`);
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        const delay = delays[accountId] ?? 0;
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        inFlight -= 1;
        return accountId in days ? (days[accountId] ?? null) : accountDay(accountId);
      },
      accountsWithStoredState: async () => {
        calls.push('accountsWithStoredState');
        return Object.keys(options.stored ?? {});
      },
      storedRuleStates: async (accountId) => {
        calls.push(`storedRuleStates:${accountId}`);
        return options.stored?.[accountId] ?? [];
      },
      accountDaysFrom: async (accountId) => {
        calls.push(`accountDaysFrom:${accountId}`);
        return options.history?.[accountId] ?? [];
      },
    },
    write: {
      writeRuleState: async (row) => {
        calls.push(`writeRuleState:${row.accountId}`);
        writes.push(row);
      },
      raiseReconciliation: async (finding) => {
        calls.push(`raiseReconciliation:${finding.accountId}`);
        reconciliations.push(finding);
      },
      raiseDivergence: async (finding) => {
        calls.push(`raiseDivergence:${finding.accountId}:${finding.tradingDay}`);
        divergences.push(finding);
      },
    },
  };

  return { ports, writes, reconciliations, divergences, calls, peakInFlight: () => peak };
}

const CONFIG: NightlyBatchConfig = {
  tradingDay: td('2026-08-10'),
  engineVersion: ENGINE_VERSION,
  concurrency: 4,
};

// -----------------------------------------------------------------------------
// The fold
// -----------------------------------------------------------------------------

describe('foldAccountDay writes a row through the published entry point', () => {
  it('produces one rule_states row for a day that folds', () => {
    const fold = foldAccountDay(accountDay(ACCOUNT_A), CALENDAR, ENGINE_VERSION, 11);
    expect(fold.kind).toBe('row');
    if (fold.kind !== 'row') return;

    expect(fold.row.accountId).toBe(ACCOUNT_A);
    expect(fold.row.tradingDay).toBe('2026-08-10');
    expect(fold.row.balanceCents).toBe(5_030_000n);
    expect(fold.row.engineVersion).toBe(ENGINE_VERSION);
    expect(fold.row.calendarRevisionId).toBe(11);
    expect(fold.row.stateHash).toHaveLength(32);
  });

  it('carries the events without persisting them (0017 is not wired)', () => {
    const fold = foldAccountDay(accountDay(ACCOUNT_A), CALENDAR, ENGINE_VERSION, 11);
    if (fold.kind !== 'row') throw new Error('expected a row');
    expect(fold.events.map((e) => e.type)).toContain('day.closed');
  });

  it('hashes the account id, so two accounts with one state differ', () => {
    const a = foldAccountDay(accountDay(ACCOUNT_A), CALENDAR, ENGINE_VERSION, 11);
    const b = foldAccountDay(accountDay(ACCOUNT_B), CALENDAR, ENGINE_VERSION, 11);
    if (a.kind !== 'row' || b.kind !== 'row') throw new Error('expected rows');
    expect(a.row.stateHash.equals(b.row.stateHash)).toBe(false);
  });

  it('does not hash the calendar watermark (ADR-047, 0035)', () => {
    const before = foldAccountDay(accountDay(ACCOUNT_A), CALENDAR, ENGINE_VERSION, null);
    const after = foldAccountDay(accountDay(ACCOUNT_A), CALENDAR, ENGINE_VERSION, 12);
    if (before.kind !== 'row' || after.kind !== 'row') throw new Error('expected rows');
    // The whole ruling: in the hash, ONE correction diverges the book at once.
    expect(before.row.stateHash.equals(after.row.stateHash)).toBe(true);
    expect(before.row.calendarRevisionId).toBeNull();
    expect(after.row.calendarRevisionId).toBe(12);
  });
});

describe('context gates are stored and never hashed (INV-23, SD-06)', () => {
  const frozen: ExternalGates = { ...CLEAR, payoutsFrozen: true, reconBlocked: true };

  it('stores the context verdicts the caller resolved', () => {
    const fold = foldAccountDay(
      accountDay(ACCOUNT_A, { external: frozen }),
      CALENDAR,
      ENGINE_VERSION,
      11,
    );
    if (fold.kind !== 'row') throw new Error('expected a row');
    expect(fold.row.contextGates.notFrozen.pass).toBe(false);
    expect(fold.row.contextGates.reconClear.pass).toBe(false);
    expect(fold.row.contextGates.kycVerified.pass).toBe(true);
    expect(fold.row.contextGates.noPayoutInFlight.pass).toBe(true);
  });

  it('produces the SAME state_hash whatever the context was', () => {
    // This is the assertion INV-23 exists for: a freeze applied last March must
    // not produce a divergence every night until someone disables the audit.
    const clear = foldAccountDay(accountDay(ACCOUNT_A), CALENDAR, ENGINE_VERSION, 11);
    const blocked = foldAccountDay(
      accountDay(ACCOUNT_A, { external: frozen }),
      CALENDAR,
      ENGINE_VERSION,
      11,
    );
    if (clear.kind !== 'row' || blocked.kind !== 'row') throw new Error('expected rows');
    expect(clear.row.stateHash.equals(blocked.row.stateHash)).toBe(true);
    expect(clear.row.contextGates).not.toEqual(blocked.row.contextGates);
  });
});

// -----------------------------------------------------------------------------
// Refusals: DO-3 and ADR-049
// -----------------------------------------------------------------------------

describe('a day that refuses writes no state (DO-3)', () => {
  it('refuses an INV-18 opening mismatch and returns the assertion', () => {
    const broken = accountDay(ACCOUNT_A, {
      mark: { ...DAY_ONE, openingBalanceCents: 4_000_000n, closingBalanceCents: 4_030_000n },
    });
    const fold = foldAccountDay(broken, CALENDAR, ENGINE_VERSION, 11);
    expect(fold.kind).toBe('refused');
    if (fold.kind !== 'refused') return;
    expect(fold.assertions.map((a) => a.kind)).toContain('opening_mismatch');
  });

  it('refuses a day outside the slice coverage rather than guessing (ADR-049)', () => {
    const outside = accountDay(ACCOUNT_A, {
      mark: { ...DAY_ONE, tradingDay: td('2027-01-04') },
    });
    const fold = foldAccountDay(outside, CALENDAR, ENGINE_VERSION, 11);
    expect(fold.kind).toBe('refused');
    if (fold.kind !== 'refused') return;
    expect(fold.assertions.map((a) => a.kind)).toEqual(['calendar_coverage_miss']);
  });
});

// -----------------------------------------------------------------------------
// The run
// -----------------------------------------------------------------------------

describe('runNightlyBatch', () => {
  it('reads the watermark BEFORE the slice, which is the whole of 0035 item 4', async () => {
    const rec = recordingPorts([ACCOUNT_A]);
    await runNightlyBatch(rec.ports, CONFIG);
    expect(rec.calls.indexOf('calendarWatermark')).toBeLessThan(rec.calls.indexOf('calendarSlice'));
  });

  it('stamps the watermark AS READ, including a null one', async () => {
    const rec = recordingPorts([ACCOUNT_A], { watermark: null });
    const report = await runNightlyBatch(rec.ports, CONFIG);
    // NULL is legal and is not "unknown": it means the fold read a calendar
    // that had never been corrected (0035 item 3).
    expect(report.calendarRevisionId).toBeNull();
    expect(rec.writes[0]?.calendarRevisionId).toBeNull();
  });

  it('writes one row per account and reports the counts', async () => {
    const rec = recordingPorts([ACCOUNT_A, ACCOUNT_B]);
    const report = await runNightlyBatch(rec.ports, CONFIG);

    expect(report.accountsConsidered).toBe(2);
    expect(report.written).toBe(2);
    expect(report.refused).toBe(0);
    expect(report.absent).toBe(0);
    expect(rec.writes.map((w) => w.accountId).sort()).toEqual([ACCOUNT_A, ACCOUNT_B].sort());
  });

  it('raises reconciliation and writes nothing for a refused account', async () => {
    const rec = recordingPorts([ACCOUNT_A, ACCOUNT_B], {
      days: {
        [ACCOUNT_B]: accountDay(ACCOUNT_B, {
          mark: { ...DAY_ONE, openingBalanceCents: 4_000_000n, closingBalanceCents: 4_030_000n },
        }),
      },
    });
    const report = await runNightlyBatch(rec.ports, CONFIG);

    expect(report.written).toBe(1);
    expect(report.refused).toBe(1);
    expect(rec.writes.map((w) => w.accountId)).toEqual([ACCOUNT_A]);
    expect(rec.reconciliations).toHaveLength(1);
    expect(rec.reconciliations[0]?.accountId).toBe(ACCOUNT_B);
    expect(rec.reconciliations[0]?.tradingDay).toBe('2026-08-10');
    // No row for a refused day, ever: the refusal is checked before one is built.
    expect(rec.calls).not.toContain(`writeRuleState:${ACCOUNT_B}`);
  });

  it('reports an account that vanished between the listing and the load', async () => {
    const rec = recordingPorts([ACCOUNT_A, ACCOUNT_B], { days: { [ACCOUNT_B]: null } });
    const report = await runNightlyBatch(rec.ports, CONFIG);

    expect(report.absent).toBe(1);
    expect(report.written).toBe(1);
    expect(report.outcomes[1]).toEqual({ accountId: ACCOUNT_B, status: 'absent' });
  });

  it('reports outcomes in input order even when they complete out of order', async () => {
    // A report whose rows arrive in completion order differs between two runs
    // over identical data, and the first thing anybody does with a divergence
    // report is diff it against yesterday's.
    const rec = recordingPorts([ACCOUNT_A, ACCOUNT_B], {
      loadDelayMs: { [ACCOUNT_A]: 25, [ACCOUNT_B]: 0 },
    });
    const report = await runNightlyBatch(rec.ports, CONFIG);

    expect(report.outcomes.map((o) => o.accountId)).toEqual([ACCOUNT_A, ACCOUNT_B]);
    // The write order DID differ, which is what makes the assertion above real.
    expect(rec.writes.map((w) => w.accountId)).toEqual([ACCOUNT_B, ACCOUNT_A]);
  });

  it('holds concurrency at the configured width (Appendix B.5)', async () => {
    const ids = Array.from(
      { length: 8 },
      (_, i) => `0f8fad5b-d9cb-469f-a165-7086772895${String(i).padStart(2, '0')}`,
    );
    const rec = recordingPorts(ids, {
      loadDelayMs: Object.fromEntries(ids.map((id) => [id, 5])),
    });
    const report = await runNightlyBatch(rec.ports, { ...CONFIG, concurrency: 3 });

    expect(report.written).toBe(8);
    expect(rec.peakInFlight()).toBeLessThanOrEqual(3);
  });

  it('folds nothing and reports zero when no account has a live mark', async () => {
    const rec = recordingPorts([]);
    const report = await runNightlyBatch(rec.ports, CONFIG);

    expect(report.accountsConsidered).toBe(0);
    expect(report.outcomes).toEqual([]);
    expect(rec.writes).toEqual([]);
  });
});
