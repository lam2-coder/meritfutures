// =============================================================================
// packages/rithmic/src/simulator/fills-report.ts
// =============================================================================
// THE PER-FILL SIBLING, WHOSE EXISTENCE IS ITSELF THE ASSUMPTION.
//
// `V-M2-11`: "Per-fill detail is available, in the EOD file or a sibling." If
// it is not, M7's strongest detector class is gone (same-second clustering is a
// self-join over `fills`) and the evidence pack degrades from trade-level to
// day-level, which M02 records as a PRODUCT consequence rather than only a
// technical one. This file is therefore the shape of that assumption made
// executable: if the call says no such file exists, this emitter is deleted and
// the `fills` table is fed from nothing, which is a very visible failure.
//
// -----------------------------------------------------------------------------
// WHY THE SIMULATOR EMITS BOTH FILES RATHER THAN THE SUMMARY ALONE
// -----------------------------------------------------------------------------
// `daily_marks.fill_count` is NOT NULL and `traded_day` is defined BY A CHECK
// CONSTRAINT as `fill_count > 0` (0014). A summary-only simulator cannot
// produce either without inventing them, and an invented fill count is a
// `traded_day` flag that a golden scenario then pins. The two files also have
// to AGREE: this package computes both from one day model (`session.ts`), so a
// disagreement between the summary's realized P&L and the sum of its own fills
// is impossible by construction rather than by care.
//
// That is INV-M2-11 pointed at the simulator's own two outputs, and it is worth
// being explicit about the limit: it makes the simulator self-consistent, not
// correct. The only thing that makes it correct is a real file (AS-M2-01's
// honest residual), and getting one is a founder action.
// =============================================================================

import { formatPrice, type CsvTable } from './csv.ts';
import type { ContractSpec, SimRun } from './types.ts';

/** The published column order. Positions are not a contract; see GS-085. */
export const FILLS_REPORT_COLUMNS = [
  'account_id', // V-M2-01
  'user_id', // V-M2-09
  'session_date', // V-M2-02, and SD-M2-04's whole reason for existing
  'fill_id', // fills.platform_fill_id, unique per platform (0013)
  'order_id', // fills.order_id
  'exchange', // fills.venue, the exchange MIC
  'symbol', // joins contract_specs; FM-M2-14 refuses a fill without one
  'side',
  'quantity',
  'price', // fills.price_numerator / price_denominator, exact rational
  'fill_time', // fills.executed_at; INV-M2-05 resolves the day from it, never a UTC cast
  'corrects_fill_id', // V-M2-12: corrections reference the original fill
] as const;

function specFor(specs: readonly ContractSpec[], symbol: string): ContractSpec {
  const found = specs.find((candidate) => candidate.symbol === symbol);
  if (found === undefined) throw new RangeError(`no contract spec for ${symbol}`);
  return found;
}

/**
 * The fills for one session of a run, in account order then trade order.
 *
 * `fill_time` is a UTC instant and `session_date` is the vendor's stated
 * trading day, and they are BOTH here on purpose. INV-M2-05 requires the
 * trading day to come from calendar session containment rather than from a
 * date cast on the instant, and SD-M2-04 keeps the vendor's stated day beside
 * ours precisely so the disagreement is visible. A file carrying only one of
 * them makes AS-M2-06 undetectable.
 */
export function fillsReportTable(run: SimRun, sessionIndex: number): CsvTable {
  const days = run.days[sessionIndex];
  if (days === undefined) throw new RangeError(`session ${sessionIndex} is not in this run`);

  const rows: string[][] = [];
  for (const day of days) {
    for (const fill of day.fills) {
      const spec = specFor(run.specs, fill.symbol);
      rows.push([
        fill.platformAccountRef,
        fill.platformUserRef,
        fill.tradingDay,
        fill.platformFillId,
        fill.orderId,
        fill.exchangeMic,
        fill.symbol,
        fill.side,
        String(fill.quantity),
        formatPrice(fill.priceNumerator, spec.priceDecimals),
        fill.executedAtUtc,
        fill.correctsPlatformFillId ?? '',
      ]);
    }
  }

  return { columns: FILLS_REPORT_COLUMNS, rows };
}
