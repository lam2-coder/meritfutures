// =============================================================================
// apps/worker/src/batch/replay.ts
// =============================================================================
// INV-04'S RIGHT-HAND SIDE. `nightly.ts` computes `state_hash` and writes it on
// every row; this file re-derives a stored row and compares the two. Until it
// existed the evidence was produced and never read.
//
// INV-04: "Replaying every mark from day one reproduces stored state
// byte-identically" (M01 section 1.5), enforced by "Nightly self-audit job,
// GS-071, Appendix B". The constitution makes it a PRODUCTION job, not a test.
//
// -----------------------------------------------------------------------------
// THE HASH IS THE VERDICT AND THE FIELD DIFF IS ONLY EVIDENCE
// -----------------------------------------------------------------------------
// B.2: "Compare `state_hash` first, then diff field by field only on mismatch."
//
// THE STORED ROW IS NEVER RE-HASHED, and this is the single most important
// sentence in the file because the obvious future simplification is "just hash
// both sides, it's symmetric". `ports.ts` states why it is not: a hash
// recomputed from what Postgres gives back is a different serializer, and it
// "would disagree with every hash this batch wrote". Re-hashing the stored side
// would diverge the entire book on its first run.
//
// So the comparison is `stored.stateHash` -- the bytes storage returned --
// against the hash the recomputed fold produced. The per-column diff runs only
// after those bytes have already disagreed, and it exists to NAME the field, not
// to decide anything. Its stored side is only as trustworthy as the adapter's
// jsonb decode, which is why every stored render is wrapped: a decode defect is
// reported as one, never thrown and never silently skipped.
//
// -----------------------------------------------------------------------------
// SCOPE IS B.4 STEP 1, TWICE, AND AN EMPTY SCOPE IS A REFUSAL
// -----------------------------------------------------------------------------
// B.4 step 1: "Divergence detection compares only rows whose stored
// `engine_version` equals the running version. Rows from an older version are
// out of scope until step 4 rewrites them." ADR-047 reads the same step a second
// time for `calendar_revision_id`, because the calendar is the engine's second
// version-like input and "a second protocol for the same shape would be two
// expressions of one concept".
//
// AN AUDIT THAT HAS STOPPED LOOKING REPORTS EXACTLY LIKE ONE THAT FOUND NOTHING
// (FM-17). So an in-scope set that is empty while stored rows exist THROWS
// rather than returning a clean report. That is `OI-14`, which
// `packages/db/DELTA_MANIFEST.md` allocates and leaves open with the note that
// "no per-row constraint can tell 'not yet written' from 'pristine calendar'
// without fabricating, so it belongs to the job". This file is that job. It
// SATISFIES what the row requires; closing the row is a documentation edit in a
// directory this session does not touch.
//
// -----------------------------------------------------------------------------
// WHAT THIS IS NOT, stated the way `nightly.ts` states its own gaps
// -----------------------------------------------------------------------------
//   1. THE HALT IS NOT WIRED. B.1: "Any difference halts payout eligibility for
//      that account and pages." The halt is a write to another table. The
//      obligation is expressed in `raiseDivergence`'s contract and nothing here
//      performs it.
//   2. THE EVENT HAS NOWHERE TO GO. `replay.divergence_detected` is catalogued
//      (EVENTS.md:190) and `0017`'s event tables are not wired, so findings are
//      handed to a port and this file persists nothing.
//   3. NOTHING SCHEDULES THIS. There is no cron and no caller in `index.ts`.
//      `CRON_INVENTORY.md` expects a `replay.audit_completed` signal that this
//      file does not emit and that the EVENTS.md catalogue does not define.
//   4. A GREEN AUDIT TODAY COVERS LESS THAN IT APPEARS TO, because the engine
//      does not yet implement every rule group. The counts on the report are
//      what makes that visible rather than reassuring.
// =============================================================================

import type { TradingDay } from '@merit/rules-engine';

import { foldAccountDay } from './nightly.js';
import type {
  BatchPorts,
  ReplayDivergence,
  ReplayDivergenceFinding,
  RuleStateRow,
} from './ports.js';
import { ENGINE_GATE_LEAVES, HASHED_COLUMNS, type StateHashSubject } from './state-hash.js';

/** Thrown when the audit cannot honestly report on anything. `OI-14`. */
export class ReplayAuditRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplayAuditRefusal';
  }
}

/**
 * `detect` is the nightly run: B.4 step 1 scoping, findings routed as alerts.
 * `dryRun` is B.4 step 2: compare EVERYTHING, write nothing, findings routed as
 * an audit trail rather than as alerts (B.4 step 4).
 *
 * THE MODE IS A PARTITION CHOICE AND NOT A SECOND COMPARATOR. Hard-wiring the
 * scope predicate inside the comparison would make B.4 step 2 unimplementable
 * without a second copy of this file, which is the "two expressions of one
 * concept" ADR-047 rejects by name.
 */
export type ReplayMode = 'detect' | 'dryRun';

export interface ReplayAuditConfig {
  readonly engineVersion: string;
  readonly mode: ReplayMode;
}

export interface ReplayAccountReport {
  readonly accountId: string;
  readonly storedRows: number;
  readonly inScope: number;
  readonly outOfScope: number;
  readonly matched: number;
  readonly diverged: number;
  readonly findings: readonly ReplayDivergenceFinding[];
}

export interface ReplayAuditReport {
  readonly mode: ReplayMode;
  readonly engineVersion: string;
  readonly calendarRevisionId: number | null;
  readonly accountsAudited: number;
  readonly storedRows: number;
  readonly inScope: number;
  readonly outOfScope: number;
  readonly matched: number;
  readonly diverged: number;
  readonly accounts: readonly ReplayAccountReport[];
}

/** The subject a row is, once the hash reads only the eighteen state fields. */
function subjectOf(row: RuleStateRow): StateHashSubject {
  return { accountId: row.accountId, state: row };
}

/**
 * Render one side, turning a decode defect into a reported value.
 *
 * The RECOMPUTED side is engine output and cannot fail; the STORED side came
 * through a jsonb decode this repository has not ruled on (`Cents` inside
 * `engine_gates` may arrive as a number or a string), and `count()` throws on a
 * non-safe-integer. A throw here would end the run for the whole book on one
 * bad row, and a skip would hide it. Neither is acceptable for an audit.
 */
function safely(render: () => string): string {
  try {
    return render();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `<unrenderable: ${reason}>`;
  }
}

/**
 * The fields on which a stored row and its replay disagree.
 *
 * Empty when the hashes agree, which is the ordinary case and the only case
 * that costs nothing.
 */
export function diffStoredAgainstRecomputed(
  stored: RuleStateRow,
  recomputed: RuleStateRow,
): readonly ReplayDivergence[] {
  // B.2, and the bytes on the left are storage's own.
  if (stored.stateHash.equals(recomputed.stateHash)) return [];

  const divergences: ReplayDivergence[] = [];
  const storedSubject = subjectOf(stored);
  const recomputedSubject = subjectOf(recomputed);

  for (const column of HASHED_COLUMNS) {
    // Column 19 is reported by its LEAVES rather than as one opaque field,
    // which is what `ENGINE_GATE_LEAVES` carries dotted paths for: "so a
    // divergence names the field". A bare `engine_gates` event would say that
    // something in twenty-five numbers moved.
    if (column.column === 'engine_gates') {
      for (const leaf of ENGINE_GATE_LEAVES) {
        const storedLeaf = safely(() => leaf.render(stored.engineGates));
        const recomputedLeaf = safely(() => leaf.render(recomputed.engineGates));
        if (storedLeaf !== recomputedLeaf) {
          divergences.push({
            field: `engine_gates.${leaf.path}`,
            stored: storedLeaf,
            recomputed: recomputedLeaf,
          });
        }
      }
      continue;
    }

    const storedValue = safely(() => column.render(storedSubject));
    const recomputedValue = safely(() => column.render(recomputedSubject));
    if (storedValue !== recomputedValue) {
      divergences.push({
        field: column.column,
        stored: storedValue,
        recomputed: recomputedValue,
      });
    }
  }

  // A HASH MISMATCH IS NEVER QUIET. `EVENTS.md:194` names this event as one of
  // the two that "must never be quiet", and a mismatch no column explains is
  // the most alarming outcome available: the bytes disagree and the serializer
  // cannot say why. Reporting nothing here would page about nothing.
  if (divergences.length === 0) {
    divergences.push({
      field: 'state_hash',
      stored: stored.stateHash.toString('hex'),
      recomputed: recomputed.stateHash.toString('hex'),
    });
  }

  return divergences;
}

/** B.4 step 1, read twice: the code the fold runs, and the data it folds over. */
function inScopeForDetection(
  row: RuleStateRow,
  engineVersion: string,
  calendarRevisionId: number | null,
): boolean {
  return row.engineVersion === engineVersion && row.calendarRevisionId === calendarRevisionId;
}

function byTradingDay(rows: readonly RuleStateRow[]): Map<TradingDay, RuleStateRow> {
  const map = new Map<TradingDay, RuleStateRow>();
  for (const row of rows) map.set(row.tradingDay, row);
  return map;
}

/**
 * Audit one account: fold from day one, compare each day against storage.
 *
 * THE PRIOR IS THIS FOLD'S OWN, never `AccountDay.prior`. Reading the stored
 * prior would fold the audited value back into the audit: an error on day 40
 * enters day 41's stored prior, day 41 recomputes from it, and every later day
 * agrees. That is why `foldAccountDay` returns its state.
 */
export function auditAccount(
  accountId: string,
  days: readonly AccountDayInput[],
  storedRows: readonly RuleStateRow[],
  config: ReplayAuditConfig,
  calendarRevisionId: number | null,
): ReplayAccountReport {
  const stored = byTradingDay(storedRows);
  const findings: ReplayDivergenceFinding[] = [];
  let inScope = 0;
  let outOfScope = 0;
  let matched = 0;
  let diverged = 0;

  let prior = null as AccountDayInput['day']['prior'];
  const seen = new Set<TradingDay>();

  for (const input of days) {
    const fold = foldAccountDay(
      { ...input.day, prior },
      input.calendar,
      config.engineVersion,
      calendarRevisionId,
    );
    // A refusal is DO-3's channel and `nightly.ts` owns it. The replay cannot
    // carry a prior it never produced, so the chain ends here for this account.
    if (fold.kind === 'refused') break;

    prior = fold.state;
    const tradingDay = fold.row.tradingDay;
    seen.add(tradingDay);

    const storedRow = stored.get(tradingDay);
    if (storedRow === undefined) {
      // A recomputed day with no stored row. Reported rather than skipped: a
      // missing row is a row the audit cannot vouch for.
      inScope += 1;
      diverged += 1;
      findings.push({
        accountId,
        tradingDay,
        engineVersion: config.engineVersion,
        divergences: [{ field: 'state_hash', stored: '<no stored row>', recomputed: 'present' }],
      });
      continue;
    }

    if (
      config.mode === 'detect' &&
      !inScopeForDetection(storedRow, config.engineVersion, calendarRevisionId)
    ) {
      outOfScope += 1;
      continue;
    }

    inScope += 1;
    const divergences = diffStoredAgainstRecomputed(storedRow, fold.row);
    if (divergences.length === 0) {
      matched += 1;
      continue;
    }
    diverged += 1;
    findings.push({
      accountId,
      tradingDay,
      engineVersion: config.engineVersion,
      divergences,
    });
  }

  // The other direction of the set alignment: a stored day the replay never
  // reproduced. Index-based comparison cannot see this at all.
  for (const row of storedRows) {
    if (seen.has(row.tradingDay)) continue;
    if (
      config.mode === 'detect' &&
      !inScopeForDetection(row, config.engineVersion, calendarRevisionId)
    ) {
      outOfScope += 1;
      continue;
    }
    inScope += 1;
    diverged += 1;
    findings.push({
      accountId,
      tradingDay: row.tradingDay,
      engineVersion: config.engineVersion,
      divergences: [{ field: 'state_hash', stored: 'present', recomputed: '<no replayed row>' }],
    });
  }

  return {
    accountId,
    storedRows: storedRows.length,
    inScope,
    outOfScope,
    matched,
    diverged,
    findings,
  };
}

/** What `auditAccount` folds: one day's inputs and the calendar it reads. */
export interface AccountDayInput {
  readonly day: Parameters<typeof foldAccountDay>[0];
  readonly calendar: Parameters<typeof foldAccountDay>[1];
}

/**
 * The nightly self-audit.
 *
 * Reads the watermark BEFORE anything else, exactly as `runNightlyBatch` does
 * and for the same reason `nightly.ts` gives at length.
 */
export async function runReplayAudit(
  ports: BatchPorts,
  config: ReplayAuditConfig,
): Promise<ReplayAuditReport> {
  const calendarRevisionId = await ports.read.calendarWatermark();
  const calendar = await ports.read.calendarSlice();
  const accountIds = await ports.read.accountsWithStoredState();

  const accounts: ReplayAccountReport[] = [];
  for (const accountId of accountIds) {
    const storedRows = await ports.read.storedRuleStates(accountId);
    const days = await ports.read.accountDaysFrom(accountId);
    accounts.push(
      auditAccount(
        accountId,
        days.map((day) => ({ day, calendar })),
        storedRows,
        config,
        calendarRevisionId,
      ),
    );
  }

  const total = (pick: (a: ReplayAccountReport) => number): number =>
    accounts.reduce((sum, a) => sum + pick(a), 0);

  const report: ReplayAuditReport = {
    mode: config.mode,
    engineVersion: config.engineVersion,
    calendarRevisionId,
    accountsAudited: accounts.length,
    storedRows: total((a) => a.storedRows),
    inScope: total((a) => a.inScope),
    outOfScope: total((a) => a.outOfScope),
    matched: total((a) => a.matched),
    diverged: total((a) => a.diverged),
    accounts,
  };

  // OI-14. THROWN RATHER THAN REPORTED, because a refusal that returns a report
  // can be read like a clean one, which is the exact failure the row names.
  if (report.storedRows > 0 && report.inScope === 0) {
    throw new ReplayAuditRefusal(
      `the replay audit compared nothing: ${String(report.storedRows)} stored row(s) exist and ` +
        `every one is out of scope for engine_version ${config.engineVersion} and ` +
        `calendar_revision_id ${String(calendarRevisionId)}. An audit that has stopped looking ` +
        `reports exactly like one that found nothing (FM-17, OI-14). If this is the first run ` +
        `after an engine upgrade or a calendar correction, B.4 step 2's dry run is what should ` +
        `run, not this.`,
    );
  }

  for (const account of accounts) {
    for (const finding of account.findings) {
      await ports.write.raiseDivergence(finding);
    }
  }

  return report;
}
