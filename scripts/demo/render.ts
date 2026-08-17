// =============================================================================
// scripts/demo/render.ts
// =============================================================================
// THE OUTPUT. A pure function from a folded run to a string, which is what makes
// `--seed` checkable: `determinism.test.ts` compares two renders byte for byte,
// and a renderer that read a clock, a width, a locale or an environment variable
// would make that test either flaky or vacuous.
//
// THREE RULES THIS FILE FOLLOWS.
//
//   NO FLOATS. Money is integer cents throughout the corpus and that applies to
//   doc examples too (CLAUDE.md conventions), so `money()` divides `bigint` by
//   100n and pads the remainder. `Number(cents) / 100` would be correct up to
//   2^53 cents and wrong in a way nobody would notice until it was in a report.
//
//   NO `toLocaleString`. It reads the environment's locale, and PT-06's harness
//   randomizes `TZ` and `LC_ALL` for exactly this class of defect. The thousands
//   separator here is inserted by hand.
//
//   THE WHOLE RULE, NOT A PROGRESS BAR. M01 group F: "competitors show a
//   progress bar; Merit shows the whole rule." The per-day table is a summary
//   and the gate block under it is the breakdown, gate by gate, with the have
//   and the need in the same units the trader would be shown.
// =============================================================================

import type {
  Cents,
  EngineEvent,
  EngineGateResults,
  PayoutEvaluation,
  ResolvedPlan,
  RuleState,
} from '../../packages/rules-engine/src/index.js';
import type { AccountRun, DayRow } from './fold.js';
import type { Cohort } from './config.js';

/** `$50,000.00`, from integer cents, with no float anywhere on the path. */
export function money(cents: Cents): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = grouped(abs / 100n);
  const fraction = String(abs % 100n).padStart(2, '0');
  return `${negative ? '-' : ''}$${whole}.${fraction}`;
}

/** The same, with an explicit sign, for a column where zero and gain must differ. */
export function signedMoney(cents: Cents): string {
  return cents > 0n ? `+${money(cents)}` : money(cents);
}

/** Thousands separators, inserted by hand because `toLocaleString` reads a locale. */
function grouped(value: bigint): string {
  const digits = String(value);
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    const fromEnd = digits.length - i;
    out += digits[i];
    if (fromEnd > 1 && fromEnd % 3 === 1) out += ',';
  }
  return out;
}

const pad = (text: string, width: number): string => text.padEnd(width);
const padStart = (text: string, width: number): string => text.padStart(width);

/**
 * The six engine gates as six characters, one per gate.
 *
 * UPPERCASE PASSES, LOWERCASE FAILS, A DASH IS SKIPPED, and the distinction
 * between a pass and a skip is the one that has to survive compression: CV-19
 * and R-37 both report `skipped` precisely so a disabled gate renders as
 * disabled rather than as satisfied (GS-080). A column that showed both as a
 * tick would be the exact misreport those flags exist to prevent.
 */
function gateGlyphs(gates: EngineGateResults): string {
  const glyph = (letter: string, pass: boolean, skipped: boolean): string =>
    skipped ? '-' : pass ? letter.toUpperCase() : letter.toLowerCase();

  return [
    glyph('t', gates.tradedDays.pass, gates.tradedDays.skipped),
    glyph('w', gates.winDays.pass, false),
    glyph('b', gates.buffer.pass, false),
    glyph('c', gates.consistency.pass, gates.consistency.skipped),
    glyph('g', gates.cadenceGap.pass, gates.cadenceGap.skipped),
    glyph('m', gates.minimumAmount.pass, false),
  ].join('');
}

// THE COLUMNS ARE IN TWO GROUPS AND THE SPLIT IS THE POINT OF THE TABLE. Left of
// `bal` is what the PLATFORM reported for the day; `bal` and everything right of
// it is what the ENGINE holds after folding it. They agree on every day but one,
// and the day they disagree is the eval pass: R-31 resets the balance to
// `size_cents` in the same step as the pass, so `closing` is what the trader
// finished the evaluation with and `bal` is what they start funded with. A table
// with one balance column would have had to pick one of those and would have
// been wrong about the other.
const TABLE_HEADER =
  `${pad(' day', 12)}${pad('phase', 6)}${padStart('opening', 13)}${padStart('closing', 13)}` +
  `${padStart('pnl', 12)}${padStart('low', 13)}${padStart('bal', 13)}${padStart('floor', 13)}` +
  `${padStart('high water', 13)}${padStart('td', 4)}${padStart('win', 6)}` +
  `${padStart('gates', 8)}${padStart('elig', 6)}`;

const PHASE_ABBREVIATION: Record<string, string> = {
  eval: 'eval',
  funded: 'fund',
  closed: 'clsd',
  graduated: 'grad',
};

function dayLine(row: DayRow, plan: ResolvedPlan): string {
  const state = row.state;
  const marker = row.reprovisionedAtOpen ? '*' : ' ';
  const head =
    `${pad(`${marker}${row.tradingDay}`, 12)}` +
    `${pad(state === null ? '--' : (PHASE_ABBREVIATION[state.phase] ?? state.phase), 6)}` +
    `${padStart(money(row.openingBalanceCents), 13)}` +
    `${padStart(money(row.closingBalanceCents), 13)}` +
    `${padStart(signedMoney(row.realizedPnlCents), 12)}` +
    `${padStart(money(row.lowBalanceCents), 13)}`;

  if (state === null) {
    // A refused day has no state, so there is nothing true to put in the seven
    // columns that read one. Printing the prior day's numbers there would be
    // showing a row the fold declined to write.
    return `${head}${padStart('REFUSED', 13)}${' '.repeat(13 + 13 + 4 + 6 + 8 + 6)}`;
  }

  return (
    `${head}` +
    `${padStart(money(state.balanceCents), 13)}` +
    `${padStart(money(state.floorCents), 13)}` +
    `${padStart(money(state.highWaterBalanceCents), 13)}` +
    `${padStart(String(state.tradedDaysCount), 4)}` +
    `${padStart(`${String(state.winDaysCount)}/${String(plan.funded.winDaysRequiredCount)}`, 6)}` +
    `${padStart(gateGlyphs(state.engineGates), 8)}` +
    `${padStart(row.evaluation?.eligible === true ? 'YES' : 'no', 6)}`
  );
}

/**
 * The gate breakdown, in words, for one evaluation.
 *
 * EVERY GATE IS LISTED WHETHER IT PASSES OR NOT. `evaluateEngineGates` computes
 * all six on every row and short-circuits none of them, "because a breakdown
 * that stopped at the first `false` would tell a trader one thing they are
 * missing out of three". Rendering only the failures would put that back.
 */
function gateBreakdown(evaluation: PayoutEvaluation, plan: ResolvedPlan): string[] {
  const gates = evaluation.gates;
  const verdict = (pass: boolean, skipped: boolean): string =>
    skipped ? 'SKIP' : pass ? 'PASS' : 'FAIL';

  const lines = [
    `    ${pad('traded days', 14)}${verdict(gates.tradedDays.pass, gates.tradedDays.skipped)}  ` +
      (gates.tradedDays.skipped
        ? 'funded min_trading_days is 0, so the gate is disabled (CV-19, ADR-015)'
        : `${String(gates.tradedDays.have)} of ${String(gates.tradedDays.need)} traded days`),

    `    ${pad('win days', 14)}${verdict(gates.winDays.pass, false)}  ` +
      `${String(gates.winDays.have)} of ${String(gates.winDays.need)}, ` +
      `counting days that realized at least ${money(gates.winDays.floorCents)}`,

    `    ${pad('buffer', 14)}${verdict(gates.buffer.pass, false)}  ` +
      `${money(gates.buffer.haveCents)} above size, and the buffer of ` +
      `${money(gates.buffer.needCents)} is permanent and never withdrawable`,

    `    ${pad('consistency', 14)}${verdict(gates.consistency.pass, gates.consistency.skipped)}  ` +
      (gates.consistency.skipped
        ? 'no period profit to measure a best day against (R-30)'
        : `best day is ${String(gates.consistency.bestDayShareBp ?? 0)}bp of period profit, ` +
          `the maximum is ${String(gates.consistency.maxDayShareBp ?? 0)}bp` +
          (gates.consistency.pass
            ? ''
            : `, so ${money(gates.consistency.profitNeededToDiluteCents)} more profit would dilute it`)),

    `    ${pad('cadence gap', 14)}${verdict(gates.cadenceGap.pass, gates.cadenceGap.skipped)}  ` +
      (gates.cadenceGap.skipped
        ? 'no cadence anchor: nothing has settled, so there is no gap to measure'
        : `${String(gates.cadenceGap.tradingDaysSinceLastPayout ?? 0)} trading days since the ` +
          `anchor, need ${String(gates.cadenceGap.need)}` +
          (gates.cadenceGap.nextEligibleTradingDay === null
            ? ''
            : `, next eligible ${gates.cadenceGap.nextEligibleTradingDay}`)),

    `    ${pad('minimum', 14)}${verdict(gates.minimumAmount.pass, false)}  ` +
      `min(withdrawable ${money(gates.minimumAmount.withdrawableCents)}, cap ` +
      `${money(gates.minimumAmount.capCents)}) against a minimum of ` +
      `${money(gates.minimumAmount.minPayoutCents)}`,
  ];

  lines.push(
    `    ${pad('context', 14)}${verdict(evaluation.contextEligible, false)}  ` +
      `account ${gates.accountActive.status}/${gates.accountActive.phase}, ` +
      `kyc ${gates.kycVerified.state}, ` +
      `${gates.notFrozen.pass ? 'not frozen' : 'FROZEN'}, ` +
      `${gates.reconClear.pass ? 'recon clear' : 'RECON BLOCKED'}, ` +
      `${evaluation.noPayoutInFlight.pass ? 'nothing in flight' : 'PAYOUT IN FLIGHT'}`,
  );

  lines.push(
    `    ${pad('=> eligible', 14)}${evaluation.eligible ? 'YES' : 'no'}   ` +
      `engine ${String(evaluation.engineEligible)}, context ${String(evaluation.contextEligible)} ` +
      `(R-41 is the conjunction, with no shortcut path: INV-15)`,
  );

  if (evaluation.eligible) {
    lines.push(
      `    ${pad('payable now', 14)}    ${money(evaluation.maxPayoutCents)} at ordinal ` +
        `${String(evaluation.ordinal)} of ${String(plan.funded.maxPayouts)}, cap ` +
        `${money(evaluation.capCents)}; split ${String(plan.funded.splitBp)}bp gives trader ` +
        `${money(evaluation.clamp.traderCents)} and firm ${money(evaluation.clamp.firmCents)} ` +
        `(clamped by: ${evaluation.clamp.reason})`,
    );
  }

  return lines;
}

/**
 * One event, printed from its own fields rather than from a per-type formatter.
 *
 * `EngineEvent` IS `{ type: string; tradingDay }` AND THE CONCRETE EVENTS EXTEND
 * IT, so `DayOutput.events` cannot be narrowed by a consumer: there is no
 * exported discriminated union, and a per-type renderer would need a cast per
 * event type. Walking the object's own fields needs none and has the better
 * property for a demo anyway, which is that an event the engine gains tomorrow
 * prints tomorrow without this file being edited.
 */
function eventDetail(event: EngineEvent): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(event)) {
    if (key === 'type' || key === 'tradingDay') continue;
    parts.push(`${key}=${scalar(value)}`);
  }
  return parts.join(' ');
}

function scalar(value: unknown): string {
  if (typeof value === 'bigint') return money(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (typeof value === 'object') {
    const inner = Object.entries(value)
      .map(
        ([key, nested]) =>
          `${key}=${typeof nested === 'object' && nested !== null ? '{..}' : scalar(nested)}`,
      )
      .join(' ');
    return `{${inner}}`;
  }
  return String(value);
}

/** One account: its header, its table, its events, and its final gate breakdown. */
function renderAccount(run: AccountRun, plan: ResolvedPlan, cohort: Cohort): string[] {
  const account = run.account;
  const out: string[] = [];

  out.push('');
  out.push(
    `${account.platformAccountRef}   cohort ${run.cohort}   user ${account.platformUserRef}   ` +
      `size ${money(account.sizeCents)}`,
  );
  out.push(`  ${cohort.intent}`);
  out.push(
    `  platform setpoint ${account.riskMaxLossCents === null ? 'NONE READABLE (V-M2-08)' : money(account.riskMaxLossCents)}` +
      `   drift ${String(account.driftTicks)} ticks   volatility ${String(account.volatilityTicks)} ticks` +
      `   max qty ${String(account.quantityMax)}   liquidation slippage up to ${String(account.liquidationSlippageTicks)} ticks`,
  );
  out.push('');
  out.push(`  ${TABLE_HEADER}`);
  for (const row of run.rows) out.push(`  ${dayLine(row, plan)}`);

  const notable = run.rows.flatMap((row) =>
    row.events
      .filter((event) => event.type !== 'day.closed')
      .map((event) => `    ${row.tradingDay}  ${pad(event.type, 32)}${eventDetail(event)}`),
  );
  if (notable.length > 0) {
    out.push('');
    out.push('  events, other than the day.closed the table already is:');
    out.push(...notable);
  }

  const refusals = run.rows.filter((row) => row.assertions.length > 0);
  if (refusals.length > 0) {
    out.push('');
    out.push("  REFUSED, so no state was written for the day and reconciliation is the caller's:");
    for (const row of refusals) {
      for (const assertion of row.assertions) {
        out.push(`    ${row.tradingDay}  ${pad(assertion.kind, 32)}${assertion.detail}`);
        if (assertion.expected !== undefined && assertion.got !== undefined) {
          out.push(
            `    ${pad('', 12)}  ${pad('', 32)}expected ${money(assertion.expected)}, got ${money(assertion.got)}`,
          );
        }
      }
    }
  }

  const breachRow = run.rows.find((row) => row.state?.phase === 'closed');
  if (breachRow?.state != null) {
    out.push('');
    out.push(`  BREACHED on ${breachRow.tradingDay}: ${breachRow.state.breachKind ?? 'unknown'}`);
    out.push(
      `    the low of ${money(breachRow.lowBalanceCents)} broke the floor the day opened against, ` +
        `${money(breachRow.state.floorOpenCents)}`,
    );
    out.push(
      breachRow.liquidation === null
        ? `    NO VENDOR LIQUIDATION RECORD. The setpoint was pushed once at open ` +
            `(${breachRow.state.floorOpenCents > (run.account.riskMaxLossCents ?? 0n) ? "and Merit's floor has trailed above it since" : 'and the low never reached it'}), ` +
            `so the platform had no reason to flatten the account and Merit breached it anyway`
        : `    vendor liquidation at ${breachRow.liquidation.atUtc}: ${breachRow.liquidation.criterion}, ` +
            `threshold ${money(breachRow.liquidation.thresholdCents)}, came to rest at ` +
            `${money(breachRow.liquidation.equityCents)}`,
    );
  }

  const last = lastEvaluatedRow(run);
  if (last?.evaluation != null) {
    out.push('');
    out.push(`  the whole rule on ${last.tradingDay}, gate by gate:`);

    // TWO NOTES THAT KEEP THE BREAKDOWN FROM BEING MISREAD, and both describe
    // engine behaviour that is deliberate rather than a rendering choice.
    if (last.state?.phase === 'closed') {
      out.push(
        '    (the account is closed, so R-24 makes these gates STATED rather than computed:',
      );
      out.push(
        '     `gatesAfterBreach` sets every pass to false, including the two that can skip, because',
      );
      out.push(
        '     a closed account can never clear them again. The have/need pairs are the last',
      );
      out.push(
        '     observed counters against the configured thresholds and no gate was evaluated.)',
      );
    } else if (last.state?.phase === 'eval') {
      out.push(
        '    (these are the FUNDED gates. The engine computes all six on every row including eval',
      );
      out.push(
        '     rows, so an eval account can show its win-day count passing while R-40 keeps it',
      );
      out.push(
        '     ineligible on the phase term alone. R-35 gives an eval row a zero withdrawable.)',
      );
    }

    out.push(...gateBreakdown(last.evaluation, plan));
  }

  return out;
}

function lastEvaluatedRow(run: AccountRun): DayRow | undefined {
  for (let i = run.rows.length - 1; i >= 0; i -= 1) {
    const row = run.rows[i];
    if (row?.evaluation != null) return row;
  }
  return undefined;
}

export interface RenderInput {
  readonly seed: string;
  readonly plan: ResolvedPlan;
  readonly planLabel: string;
  readonly startDay: string;
  readonly sessionCount: number;
  readonly accountsPerCohort: number;
  readonly cohorts: readonly Cohort[];
  readonly runs: readonly AccountRun[];
}

/** The whole report, as one string. Pure: same input, same bytes. */
export function render(input: RenderInput): string {
  const out: string[] = [];

  out.push('MERIT: the simulator, through the engine, with nothing in between');
  out.push('='.repeat(100));
  out.push(`  plan            ${input.planLabel} (${String(input.plan.planVersionId)})`);
  out.push(`  seed            ${input.seed}`);
  out.push(
    `  sessions        ${String(input.sessionCount)} weekdays from ${input.startDay}, ` +
      'a synthetic sequence and NOT the CME calendar',
  );
  out.push(
    `  population      ${String(input.accountsPerCohort)} accounts in each of ` +
      `${String(input.cohorts.length)} cohorts, all in memory, no database`,
  );
  out.push('');
  out.push('  gates column    T traded days, W win days, B buffer, C consistency, G cadence gap,');
  out.push('                  M minimum amount. UPPER passes, lower fails, - is a skipped gate,');
  out.push('                  which CV-19 and R-37 report distinctly from a pass on purpose.');
  out.push('  a leading *     the platform account was re-provisioned at size_cents (INV-M2-07)');

  for (const run of input.runs) {
    const cohort = input.cohorts.find((c) => c.label === run.cohort);
    if (cohort === undefined) throw new Error(`no cohort named ${run.cohort}`);
    out.push('');
    out.push('-'.repeat(100));
    out.push(...renderAccount(run, input.plan, cohort));
  }

  out.push('');
  out.push('='.repeat(100));
  out.push('SUMMARY');
  const counts = new Map<string, number>();
  for (const run of input.runs) counts.set(run.outcome, (counts.get(run.outcome) ?? 0) + 1);
  const OUTCOME_LABEL: Record<string, string> = {
    eligible: 'reached eligibility',
    breached: 'breached',
    refused: 'refused a day',
    trading: 'still trading at the window end',
  };
  for (const outcome of ['eligible', 'breached', 'refused', 'trading'] as const) {
    const count = counts.get(outcome) ?? 0;
    if (count > 0) out.push(`  ${pad(OUTCOME_LABEL[outcome] ?? outcome, 34)}${String(count)}`);
  }

  const eligible = input.runs.filter((run) => run.firstEligibleDay !== null);
  if (eligible.length > 0) {
    out.push('');
    out.push('  reached eligibility:');
    for (const run of eligible) {
      const row = lastEvaluatedRow(run);
      out.push(
        `    ${pad(run.account.platformAccountRef, 16)}first eligible ${String(run.firstEligibleDay)}` +
          `   passed eval ${run.passedOn ?? 'n/a'}` +
          `   payable at the end ${money(row?.evaluation?.maxPayoutCents ?? 0n)}`,
      );
    }
  }

  const breached = input.runs.filter((run) => run.outcome === 'breached');
  if (breached.length > 0) {
    out.push('');
    out.push('  breached:');
    for (const run of breached) {
      const row = run.rows.find((candidate) => candidate.state?.phase === 'closed');
      out.push(
        `    ${pad(run.account.platformAccountRef, 16)}${pad(row?.tradingDay ?? '', 12)}` +
          `${pad(row?.state?.breachKind ?? '', 20)}` +
          `${row?.liquidation === null ? 'no vendor liquidation record' : 'vendor liquidated'}`,
      );
    }
  }

  out.push('');
  return `${out.join('\n')}\n`;
}

/** Exported for the determinism test, which needs a state's fields in a stable order. */
export function stateDigestLine(state: RuleState): string {
  return [
    state.tradingDay,
    state.phase,
    String(state.balanceCents),
    String(state.floorCents),
    String(state.highWaterBalanceCents),
    String(state.tradedDaysCount),
    String(state.winDaysCount),
    String(state.withdrawableCents),
    String(state.engineEligible),
  ].join('|');
}
