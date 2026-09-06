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
// THE FOLD IS THE ENGINE'S. THERE IS NO SECOND CODE PATH
// -----------------------------------------------------------------------------
// M01 section 3.7: "There is no second code path. The nightly self-audit, the CI
// golden suite, the evidence pack's computation trace, and the live batch all
// call `advanceDay`." This file used to fold `advanceDay` in its own loop, which
// was a second EXPRESSION of one fold, and ADR-078 exported `replay` because
// withholding it did not prevent that second implementation -- it COMPELLED one.
// The entry recorded the migration as owed: "`apps/worker/src/batch/replay.ts`
// is NOT migrated onto the export. The second code path still exists on `main`
// after this entry." It does not any more.
//
// FOUR THINGS WERE RESTATED HERE AND ARE NOW READ FROM ONE PLACE:
//
//   1. THE ARRIVAL ORDER. The loop folded the port's order and trusted it.
//      `replay` sorts by trading day then `sourceHash`, a TOTAL order with no
//      stable-sort dependence, which is what PT-06 permutes.
//   2. THE SETTLEMENT GROUPING. The loop folded whatever bucket the port had
//      attached to each day. `replay` buckets by `effectiveTradingDay`, which is
//      SD-03's own rule and is what `DayInput.settlements` is documented to
//      mean. On well-formed port output the two agree exactly; where they could
//      disagree, the engine's placement is the specified one.
//   3. THE ASSERTION HANDLING. `if (fold.kind === 'refused') break`, restated.
//   4. THE TERMINAL BREAK. `advanceDay` refuses every day after `closed` or
//      `graduated` (day/advance.ts), so the old loop broke one day LATER, on
//      that refusal. Neither version ever compared that day, so the set of
//      folded days is identical. The break needed no reconciliation; it needed
//      deleting.
//
// -----------------------------------------------------------------------------
// THE ONE PLACE THIS FILE FOLDS TWICE, AND WHY THAT IS NOT THE THING 3.7 FORBIDS
// -----------------------------------------------------------------------------
// A REFUSAL IS RECONCILED BY CALLING `replay` A SECOND TIME, and a session whose
// whole purpose is eliminating a second fold had better say why that is not the
// same thing.
//
// WHAT 3.7 FORBIDS IS A SECOND EXPRESSION OF THE FOLD, NOT A SECOND CALL TO IT.
// Calling one implementation twice cannot drift from itself. Restating the sort
// order, the settlement grouping, the assertion handling and the terminal break
// in a second place can drift, and did, which is the reason this file changed.
//
// The reconciliation itself. `replay`'s contract is that "the array it returns
// is a contiguous history or there is no array at all", so it THROWS on the
// first refused day and discards the prefix it had already folded. The audit
// wants that prefix: a refused day ends the chain for the account, and the days
// after it are reported as stored rows the replay never reproduced, which is
// what the old `break` produced. So a `ReplayAssertionError` is caught once and
// the marks strictly before `error.tradingDay` are folded again.
//
// THE SECOND CALL CANNOT REFUSE, AND THE REASON IS STRUCTURAL RATHER THAN
// PROBABILISTIC. `replay` documents "@throws ReplayAssertionError on the first
// day that refuses" and throws INSIDE its loop, so every day strictly before
// `error.tradingDay` has ALREADY FOLDED, from the identical prior chain over the
// identical settlement buckets. If it refuses anyway, the throw propagates: an
// engine that refuses a day it has just folded is non-determinism, which is
// INV-04's own subject and must be loud rather than absorbed.
//
// THE CHEAPER OPTION, NAMED SO IT READS AS REFUSED RATHER THAN UNSEEN. Widening
// `replay` to hand back the contiguous prefix alongside the error would remove
// the second call entirely. It is refused for two reasons and both are needed:
// `packages/rules-engine` is outside this session's fence, AND it would reopen a
// contract ADR-078 ruled and the founder signed. A caller's convenience is not a
// reason to move a signed engine contract.
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
// THAT ASYMMETRY IS NOW STRUCTURAL AND NOT ONLY DOCUMENTED. The stored side is a
// `RuleStateRow`, which CARRIES the bytes storage returned. The recomputed side
// is a `StateHashSubject`, which has no hash field at all: it is the account id
// and the state the engine just folded, and `diffStoredAgainstRecomputed` hashes
// it here. There is nowhere left to pass a re-hash of the stored row in.
//
// The per-column diff runs only after those bytes have already disagreed, and it
// exists to NAME the field, not to decide anything. Its stored side is only as
// trustworthy as the adapter's jsonb decode, which is why every stored render is
// wrapped: a decode defect is reported as one, never thrown and never silently
// skipped.
//
// TWO THINGS THE RECOMPUTED SIDE NO LONGER BUILDS, both because nothing compared
// them. `context_gates` is INV-23's never-replayed half and ADR-026 C-07 excludes
// it from the hash, so computing it per audited day meant calling `evaluatePayout`
// to fill a column this file never reads. `calendar_revision_id` is excluded for
// the same reason; scoping below reads it off the STORED row, which is the only
// side where it means anything.
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
// AND `OI-14` READS STORED STATE, SO IT CANNOT SEE THE EMPTY BOOK AT ALL. Its
// guard fires on `storedRows > 0 && inScope === 0`. Over a book with no rows the
// left conjunct is false, and this function returned `accountsAudited: 0,
// diverged: 0` and exited green over nothing. ADR-073 section 5 refused to build
// `CI-09`'s replay leg on exactly that shape and named the refusal that would
// unblock it: "when it is built it refuses on `accountsAudited === 0`".
//
// THAT REFUSAL LIVES HERE NOW AND IT USED TO LIVE IN A CALLER. ADR-119 clause 7
// recorded it as owed in one sentence: "A refusal in the caller is weaker than a
// refusal in the audit", because the next caller inherits nothing. ADR-123 is
// the entry that moved it, and it is a change to what this function PROMISES
// rather than a transcription: a run that compared nothing now refuses at both
// scales, and an empty production book refuses rather than reporting clean. That
// cost is deliberate and ADR-123 section 3 argues it.
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
//      TWO OF THE THREE ABOVE ARE UNCHANGED BY ADR-346 AND THE READS UNDER THEM
//      ARE NOT: `postgresBatchPorts` now serves `storedRuleStates` and
//      `accountDaysFrom`, so the audit RUNS against a database. It still may not
//      halt, which is item 1, and it still has no clock, which is this item.
//   4. A GREEN AUDIT TODAY COVERS LESS THAN IT APPEARS TO. **THIS ITEM SAID THE
//      REASON WAS THAT "the engine does not yet implement every rule group", AND
//      THAT IS WRONG IN A WAY THAT MATTERS** (ADR-346 section 6). It is kept
//      beside its correction per RI-14, because a reader told the gap is about
//      unimplemented rules will expect it to close on its own, and it will not.
//      `rules.ts:180-206` records R-01, R-05, R-11 and R-20 as discharged
//      OUTSIDE the engine BY DESIGN: two by the calendar and the ingest path,
//      one by the caller's live-mark predicate and one by the platform setpoint.
//      A replay folds the engine, so implementing more engine rules would not
//      shrink that list by one.
//      AND R-11 IS THE ONE A REPLAY IS STRUCTURALLY BLIND TO. The caller's
//      live-mark predicate is applied by whatever supplies `accountDaysFrom`,
//      BEFORE the engine sees anything, so this audit folds marks selected by
//      the very rule it would have to check: supersede the wrong mark and the
//      batch folded it, storage holds the result, and the replay reproduces it
//      byte for byte. `replay-adapter.test.ts` case 5.2 is two green reports
//      over two books that differ by fifteen thousand cents.
//      THE COUNTS ON THE REPORT MAKE THE DAYS VISIBLE AND NOT THE RULES. There
//      is no rule-coverage number on `ReplayAuditReport` at all, which ADR-346
//      section 11 registers as a finding rather than repairs, because deriving
//      one belongs to `packages/rules-engine`.
// =============================================================================

import {
  replay,
  ReplayAssertionError,
  type CalendarSlice,
  type DailyMark,
  type ResolvedPlan,
  type RuleState,
  type SettlementFact,
  type TradingDay,
} from '@merit/rules-engine';

import type {
  AccountDay,
  BatchPorts,
  ReplayDivergence,
  ReplayDivergenceFinding,
  RuleStateRow,
} from './ports.ts';
import {
  ENGINE_GATE_LEAVES,
  HASHED_COLUMNS,
  stateHash,
  type StateHashSubject,
} from './state-hash.ts';

/**
 * Thrown when the audit cannot honestly report.
 *
 * `OI-14`'s empty in-scope set is the instance `DELTA_MANIFEST` allocates. A
 * history that is not ONE ACCOUNT LIFE is the second, and `lifeOf` below is
 * where that one is raised. ADR-073 section 5's EMPTY BOOK is the third, and it
 * is the widest: not one account had anything to compare. They are the same
 * failure at three scales: an audit that has stopped looking reports exactly
 * like one that found nothing (FM-17), so all three refuse rather than return a
 * report a reader could mistake for a clean one.
 */
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

/**
 * The subject a STORED row is, once the hash reads only the eighteen state
 * fields plus the account id.
 *
 * A `RuleStateRow` satisfies `HashedState` structurally: it carries all eighteen
 * at its top level, which is what lets one set of renderers read both sides of
 * the comparison. Only the stored side needs this; the recomputed side arrives
 * as a subject already, because the engine hands back a `RuleState`.
 */
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
 *
 * THE TWO PARAMETERS ARE DIFFERENT TYPES ON PURPOSE. `stored` carries the bytes
 * storage returned and they are compared, never recomputed; `recomputed` carries
 * no bytes at all and is hashed here. See this file's header on B.2.
 */
export function diffStoredAgainstRecomputed(
  stored: RuleStateRow,
  recomputed: StateHashSubject,
): readonly ReplayDivergence[] {
  // B.2, and the bytes on the left are storage's own.
  const recomputedHash = stateHash(recomputed);
  if (stored.stateHash.equals(recomputedHash)) return [];

  const divergences: ReplayDivergence[] = [];
  const storedSubject = subjectOf(stored);

  for (const column of HASHED_COLUMNS) {
    // Column 19 is reported by its LEAVES rather than as one opaque field,
    // which is what `ENGINE_GATE_LEAVES` carries dotted paths for: "so a
    // divergence names the field". A bare `engine_gates` event would say that
    // something in twenty-five numbers moved.
    if (column.column === 'engine_gates') {
      for (const leaf of ENGINE_GATE_LEAVES) {
        const storedLeaf = safely(() => leaf.render(stored.engineGates));
        const recomputedLeaf = safely(() => leaf.render(recomputed.state.engineGates));
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
    const recomputedValue = safely(() => column.render(recomputed));
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
      recomputed: recomputedHash.toString('hex'),
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

// -----------------------------------------------------------------------------
// The fold, which is the engine's
// -----------------------------------------------------------------------------

/** What `auditAccount` folds: one day's inputs and the calendar it reads. */
export interface AccountDayInput {
  readonly day: AccountDay;
  readonly calendar: CalendarSlice;
}

/** `replay`'s six arguments, minus the engine version, as ONE account life. */
interface AccountLife {
  readonly plan: ResolvedPlan;
  readonly marks: readonly DailyMark[];
  readonly settlements: readonly SettlementFact[];
  readonly calendar: CalendarSlice;
  readonly openedOn: TradingDay;
}

/** A history that carries two of something a life has one of. */
function refuseNotOneLife(accountId: string, tradingDay: TradingDay, what: string): never {
  throw new ReplayAuditRefusal(
    `account ${accountId}'s history is not one account life: ${what} changed at ` +
      `${String(tradingDay)}. The engine's replay folds ONE life and its signature says so: ` +
      `one plan (INV-16), one opening anchor (ADR-051), one calendar slice (ADR-049). A ` +
      `history carrying two cannot be folded at all, and a report built from the first day's ` +
      `facts would describe a life the account did not have, which reads exactly like an ` +
      `audit that found nothing (FM-17).`,
  );
}

/**
 * The account's life, gathered from its days, or `null` when it has none.
 *
 * THE FOUR EQUALITIES ARE CHECKED RATHER THAN ASSUMED, because `replay`'s
 * signature is NARROWER than the loop it replaces: the old fold accepted a
 * different plan, anchor and calendar on every day and this one takes one of
 * each. That narrowing is real, so it is a mechanical assertion rather than a
 * silent application of day one's facts.
 *
 * All four are unreachable on well-formed port output, and each says which
 * contract makes it so:
 *
 *   - `accountId`, because the caller that supplied the marks is the one that
 *     knows whose they are (`types.ts`), and the parameter is what the hash
 *     subject and every finding already use.
 *   - `plan_version_id`, because INV-16 makes an account's plan version an INPUT
 *     that is never chosen by the engine and never touched by a config
 *     migration (GS-041).
 *   - `opened_on`, because ADR-051 made it an ACCOUNT FACT and required, on the
 *     ground that an optional anchor makes R-32 silently not fire.
 *   - the calendar BY IDENTITY, because `runReplayAudit` reads the slice ONCE
 *     before the fold on `0035`'s ordering and hands that same value to every
 *     day. There is structurally only ever one, so two means the port lied.
 *
 * SETTLEMENTS ARE FLATTENED AND THE ENGINE RE-BUCKETS THEM. `DayInput.settlements`
 * is documented as "those whose `effectiveTradingDay` equals `mark.tradingDay`",
 * so on well-formed input the buckets the port built and the buckets `replay`
 * builds are the same buckets. Where they could differ, SD-03 says the effective
 * day is the one the withdrawal lands on, and that is the placement the engine
 * makes.
 */
function lifeOf(accountId: string, days: readonly AccountDayInput[]): AccountLife | null {
  const first = days[0];
  if (first === undefined) return null;

  const plan = first.day.plan;
  const calendar = first.calendar;
  const openedOn = first.day.openedOn;

  const marks: DailyMark[] = [];
  const settlements: SettlementFact[] = [];

  for (const input of days) {
    const day = input.day;
    const on = day.mark.tradingDay;

    if (day.accountId !== accountId) {
      refuseNotOneLife(accountId, on, `account_id (${day.accountId})`);
    }
    if (day.plan.planVersionId !== plan.planVersionId) {
      refuseNotOneLife(accountId, on, `plan_version_id (${String(day.plan.planVersionId)})`);
    }
    if (day.openedOn !== openedOn) {
      refuseNotOneLife(accountId, on, `opened_on (${String(day.openedOn)})`);
    }
    if (input.calendar !== calendar) {
      refuseNotOneLife(accountId, on, 'the calendar slice');
    }

    marks.push(day.mark);
    settlements.push(...day.settlements);
  }

  return { plan, marks, settlements, calendar, openedOn };
}

/**
 * The account's whole life, folded by the engine, up to the first refusal.
 *
 * `AccountDay.prior` IS NOT READ, AND AFTER THIS CHANGE IT IS NOT REACHABLE.
 * Reading the stored prior would fold the audited value back into the audit: an
 * error on day 40 enters day 41's stored prior, day 41 recomputes from it, and
 * every later day agrees. `replay` carries its own chain from day one, which is
 * INV-04's "from day one" expressed by the fold rather than by this file.
 *
 * The catch is the refusal reconciliation. See this file's header for why the
 * second call cannot refuse and why widening `replay` instead is refused.
 */
function replayAccountLife(
  accountId: string,
  days: readonly AccountDayInput[],
  engineVersion: string,
): readonly RuleState[] {
  const life = lifeOf(accountId, days);
  if (life === null) return [];

  const fold = (marks: readonly DailyMark[]): readonly RuleState[] =>
    replay(life.plan, marks, life.settlements, life.calendar, engineVersion, life.openedOn);

  try {
    return fold(life.marks);
  } catch (error) {
    // A refusal is DO-3's channel and `nightly.ts` owns what it costs. The
    // replay cannot carry a prior it never produced, so the chain ends on that
    // day for this account and the days after it are reported below as stored
    // rows the replay never reproduced.
    if (!(error instanceof ReplayAssertionError)) throw error;
    return fold(life.marks.filter((mark) => mark.tradingDay < error.tradingDay));
  }
}

/**
 * Audit one account: fold from day one, compare each day against storage.
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

  const seen = new Set<TradingDay>();

  for (const state of replayAccountLife(accountId, days, config.engineVersion)) {
    const tradingDay = state.tradingDay;
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
    const divergences = diffStoredAgainstRecomputed(storedRow, { accountId, state });
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

  // ADR-073 SECTION 5, AND IT IS READ FIRST BECAUSE IT IS THE WIDER FAILURE.
  // `OI-14` below reads STORED STATE and therefore cannot see this case at all:
  // its guard needs `storedRows > 0`, and a book with no rows has none, so this
  // function used to return `accountsAudited: 0, diverged: 0` and exit green
  // over nothing. See this file's header, ADR-119 clause 7 and ADR-123.
  //
  // THE ORDER OF THE TWO GUARDS IS DECIDED RATHER THAN INCIDENTAL. Over an empty
  // book the `OI-14` conjunct is false anyway, so swapping them changes no
  // outcome today. It is fixed so a reader is handed the diagnosis that is TRUE,
  // "there was nothing to audit", rather than the narrower "nothing was in
  // scope", which would send somebody looking for an engine upgrade that did not
  // happen.
  if (report.accountsAudited === 0) {
    throw new ReplayAuditRefusal(
      `the replay audit found no account with stored state, so it compared nothing and has ` +
        `nothing to report. ADR-073 section 5 closed CI-09's replay leg on exactly this ` +
        `outcome: a nightly built on a green report over zero accounts is green every night, ` +
        `forever, over nothing, and reads exactly like an audit that found nothing (FM-17). ` +
        `OI-14's guard cannot catch it, because that guard reads stored state and fires on ` +
        `storedRows > 0 && inScope === 0. If this run is over a book that genuinely holds no ` +
        `rule_states row yet, then INV-04 has no subject and the answer is that the batch has ` +
        `not written one, not that the replay agreed with storage.`,
    );
  }

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
