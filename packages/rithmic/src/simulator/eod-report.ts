// =============================================================================
// packages/rithmic/src/simulator/eod-report.ts
// =============================================================================
// THE EOD REPORT, IN THE VENDOR'S PUBLICLY DESCRIBED CSV SHAPE.
//
// `V-M2-01` is the row this whole file rests on: "EOD reports are per-account
// CSV containing account ref, session date, opening and closing balance,
// realized P&L". Everything below either comes from that sentence, from the
// public R|Manager description, or from what `daily_marks` cannot be computed
// without, and the third category is the one worth reading carefully.
//
// -----------------------------------------------------------------------------
// A GAP FOUND WHILE WRITING THIS, RECORDED RATHER THAN PAPERED OVER
// -----------------------------------------------------------------------------
// `V-M2-01` NAMES FOUR FIELDS AND A MARK NEEDS SIX. `daily_marks` (0014)
// declares `high_balance_cents` and `low_balance_cents` NOT NULL, and the low
// is THE BREACH COMPARISON INPUT, checked strictly against the floor at the
// open (R-21, STATE_MACHINES G-BREACH). GLOSSARY's definition of a mark carries
// both ("opening balance, closing balance, INTRADAY HIGH AND LOW, realized
// P&L"), so the corpus assumes they are available; `V-M2-01`'s summary of the
// field list does not name them.
//
// If the real report omits the intraday extremes, they are not derivable from
// closed round trips (a day that finished flat can still have gone far enough
// against the trader to trip the liquidator), so `V-M2-01`'s blast becomes
// **design** rather than **edit**: either the fills file must carry enough of
// the path to reconstruct them, or the streaming tier stops being indicative
// and becomes a tier-1 input, which INV-M2-14 forbids outright.
//
// This is deliberately NOT written up as a seventeenth `V-M2-nn` row. That
// table lives in M02, M02 is at `status: review` under ADR-005, and a session
// that adds a row to another document's registry while building against it has
// claimed an identifier it does not own. It is recorded here, in the README and
// in the session log, which is where the founder reads it.
//
// -----------------------------------------------------------------------------
// THE LIQUIDATION COLUMNS, WHICH ARE MERIT'S ONLY EVIDENCE OF ITS OWN RISK
// POSTURE
// -----------------------------------------------------------------------------
// DATA_CAPABILITIES section 1: rules execute inside Rithmic's infrastructure,
// "breach triggers immediate liquidation; the EOD report logs event, time, and
// exact trigger criterion", which is what makes the report Merit's
// breach-evidence source as well as its mark source. `V-M2-08` is whether that
// record and the account's current setpoint are actually visible to us, and it
// is the highest-value question on the call after V-M2-05: without it, AS-M2-03
// has only its behavioural fallback, which fires after an excursion has already
// happened.
//
// An account with no readable setting leaves `risk_max_loss` EMPTY rather than
// zero. Zero is a setpoint; empty is the absence of one, and a parser that
// cannot tell them apart is a parser that reads an unprotected account as one
// pinned at the origin.
// =============================================================================

import { formatMoney, type CsvTable } from './csv.js';
import { contractsTraded } from './session.js';
import { formatInstantUtc, parseInstantUtc } from './time.js';
import type { SimDay, SimRun, SimSession } from './types.js';

/**
 * The published column order.
 *
 * Order is part of the contract only in the sense that `columnOrder: 'declared'`
 * reproduces it; GS-085's reordering case exists precisely so nothing
 * downstream may depend on position. A parser that reads by header name
 * survives the quirk and one that reads by index does not, which is the finding
 * the fixture is for.
 */
export const EOD_REPORT_COLUMNS = [
  'account_id', // V-M2-01, and V-M2-10: never recycled
  'user_id', // V-M2-09: billing is per login-month per USER (SD-M2-05)
  'session_date', // V-M2-01, V-M2-02: the vendor's stated day, kept beside ours (SD-M2-04)
  'currency',
  'opening_balance', // V-M2-01
  'closing_balance', // V-M2-01
  'realized_pnl', // V-M2-01
  'high_balance', // assumed present; see this file's header
  'low_balance', // assumed present; the breach comparison input
  'cash_adjustment', // V-M2-05, the second-highest risk in the corpus
  'cash_adjustment_note', // V-M2-05: the classification INV-M2-12 refuses to guess at
  'trade_count', // V-M2-11
  'contracts_traded',
  'risk_max_loss', // V-M2-08: empty when the setting is not readable
  'liquidation_event', // V-M2-08
  'liquidation_time', // V-M2-08
  'liquidation_criterion', // V-M2-08: "the exact trigger criterion"
  'report_generated_at', // V-M2-04: one post-session delivery, no contractual arrival time
] as const;

export interface EodReportOptions {
  /** ISO 4217. One currency per report in v1; a multi-currency book is not in scope. */
  readonly currency: string;
  /**
   * Seconds after the session close at which the vendor stamps the file.
   *
   * `V-M2-04`. There is no contractual arrival time assumed, so the stamp is
   * derived from the session rather than from a clock: a simulator that read
   * the wall clock here would produce a different byte on every run and the
   * determinism claim would be false for one column.
   */
  readonly deliveryLagSeconds: number;
}

export const DECLARED_EOD_OPTIONS: EodReportOptions = Object.freeze({
  currency: 'USD',
  deliveryLagSeconds: 1_800,
});

function row(day: SimDay, generatedAt: string, options: EodReportOptions): readonly string[] {
  const liquidation = day.liquidation;
  const setpoint = day.account.riskMaxLossCents;
  return [
    day.account.platformAccountRef,
    day.account.platformUserRef,
    day.tradingDay,
    options.currency,
    formatMoney(day.openingBalanceCents),
    formatMoney(day.closingBalanceCents),
    formatMoney(day.realizedPnlCents),
    formatMoney(day.highBalanceCents),
    formatMoney(day.lowBalanceCents),
    formatMoney(day.adjustmentCents),
    day.adjustmentDescription,
    String(day.trades.length),
    String(contractsTraded(day)),
    setpoint === null ? '' : formatMoney(setpoint),
    liquidation === null ? 'N' : 'Y',
    liquidation?.atUtc ?? '',
    liquidation?.criterion ?? '',
    generatedAt,
  ];
}

/**
 * The report for one session of a run.
 *
 * A session with no accounts produces a header and no rows, which is GS-085's
 * "a day with zero accounts". It is a legal file and it must parse, not
 * quarantine: an empty book is what the first week of beta looks like.
 */
export function eodReportTable(
  run: SimRun,
  sessionIndex: number,
  options: EodReportOptions = DECLARED_EOD_OPTIONS,
): CsvTable {
  const session: SimSession | undefined = run.sessions[sessionIndex];
  const days = run.days[sessionIndex];
  if (session === undefined || days === undefined) {
    throw new RangeError(`session ${sessionIndex} is not in this run`);
  }
  const generatedAt = formatInstantUtc(
    parseInstantUtc(session.sessionCloseUtc) + options.deliveryLagSeconds,
  );
  return {
    columns: EOD_REPORT_COLUMNS,
    rows: days.map((day) => row(day, generatedAt, options)),
  };
}
