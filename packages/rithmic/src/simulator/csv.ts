// =============================================================================
// packages/rithmic/src/simulator/csv.ts
// =============================================================================
// CSV RENDERING, AND THE HOSTILE-BUT-LEGAL SHAPES THAT ARE THE POINT OF IT.
//
// AS-M2-01 counter 4 is not a nice-to-have: "the simulator deliberately emits
// HOSTILE-BUT-LEGAL files: rows in a different order, an extra trailing column,
// a day with zero accounts, a 200MB file, CRLF line endings, a BOM." Those are
// the shapes a real vendor produces without warning and a tolerant parser
// swallows. GS-085 asserts each one either parses identically or quarantines,
// and NONE partially applies, which is only assertable if something can emit
// them on purpose.
//
// A quirk is therefore a first-class input rather than a test helper, and every
// quirk is DETERMINISTIC: the same seed and the same quirks produce the same
// bytes. A quirk that randomised would make the emitter's central claim false
// in exactly the cases most likely to be interesting.
//
// THE MONEY RENDERING IS THE OTHER HALF OF THIS FILE AND IT IS INTEGER-ONLY.
// `Number(cents) / 100` is how a cent goes missing at scale, so the decimal
// string is built by division and modulo on `bigint`. `V-M2-01`: that the
// vendor states balances as decimal currency rather than as minor units is an
// assumption of the field list, and if it is wrong the change is this function
// and the parser's inverse, which is the bounded edit ADR-005 asks for.
// =============================================================================

/** Thrown when a value cannot be rendered exactly. Never rounded into place. */
export class CsvRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvRenderError';
  }
}

/** The hostile-but-legal knobs. AS-M2-01 counter 4, GS-085. */
export interface CsvQuirks {
  /** A UTF-8 byte-order mark. Common from Windows tooling, invisible in a diff. */
  readonly bom: boolean;
  readonly lineEnding: '\n' | '\r\n';
  /**
   * `declared` is the column order this package publishes. `reversed` is the
   * same columns in the opposite order, which is the "rows in a different
   * order" case a header-position-based parser fails and a header-name-based
   * parser survives.
   */
  readonly columnOrder: 'declared' | 'reversed';
  /** An unannounced extra column at the end, header included. Null for none. */
  readonly extraTrailingColumn: { readonly header: string; readonly value: string } | null;
  /** Whether the last row ends with a line terminator. Both shapes occur in the wild. */
  readonly trailingNewline: boolean;
}

export const DECLARED_CSV_QUIRKS: CsvQuirks = Object.freeze({
  bom: false,
  lineEnding: '\n',
  columnOrder: 'declared',
  extraTrailingColumn: null,
  trailingNewline: true,
});

/** UTF-8 BOM, as the one character that encodes to `EF BB BF`. */
const BOM = '﻿';

/**
 * RFC 4180 quoting.
 *
 * A field is quoted when it contains the delimiter, a quote, a CR or an LF, and
 * an embedded quote is doubled. Nothing else is escaped, because anything else
 * would be this package inventing a dialect and then testing the parser against
 * its own invention, which is AS-M2-01 exactly.
 */
export function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

/**
 * Signed integer cents as a decimal currency string. Exact, integer-only.
 *
 * `-1` renders as `-0.01` and `0` as `0.00`. The sign is placed by hand rather
 * than by string arithmetic on the quotient, because `-1n / 100n` is `0n` in
 * BigInt and a naive implementation renders minus one cent as `0.01`.
 */
export function formatMoney(cents: bigint, decimals = 2): string {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 9) {
    throw new CsvRenderError(`money cannot be rendered to ${decimals} decimal places`);
  }
  const scale = 10n ** BigInt(decimals);
  const negative = cents < 0n;
  const magnitude = negative ? -cents : cents;
  const whole = magnitude / scale;
  const fraction = magnitude % scale;
  const sign = negative ? '-' : '';
  if (decimals === 0) return `${sign}${whole}`;
  return `${sign}${whole}.${String(fraction).padStart(decimals, '0')}`;
}

/** A price numerator in units of `10^-decimals`, as the decimal string the vendor states. */
export function formatPrice(numerator: number, decimals: number): string {
  if (!Number.isSafeInteger(numerator)) {
    throw new CsvRenderError(`price numerator ${numerator} is not an integer`);
  }
  return formatMoney(BigInt(numerator), decimals);
}

/** One rendered file: the header the columns declare, then a row per record. */
export interface CsvTable {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/**
 * Render a table to the exact bytes that will be written.
 *
 * The row/column agreement is CHECKED rather than trusted. A row shorter than
 * the header renders a file whose last column is silently empty on that line,
 * which is the sort of thing a parser tolerates and a reconciliation discovers
 * three weeks later.
 */
export function renderCsv(table: CsvTable, quirks: CsvQuirks = DECLARED_CSV_QUIRKS): string {
  const extra = quirks.extraTrailingColumn;
  const headerCells = [...table.columns, ...(extra === null ? [] : [extra.header])];

  const lines: string[] = [];
  const order = (cells: readonly string[]): readonly string[] =>
    quirks.columnOrder === 'reversed' ? [...cells].reverse() : cells;

  lines.push(order(headerCells).map(csvField).join(','));

  for (const [index, row] of table.rows.entries()) {
    if (row.length !== table.columns.length) {
      throw new CsvRenderError(
        `row ${index} has ${row.length} cells against ${table.columns.length} columns`,
      );
    }
    const cells = [...row, ...(extra === null ? [] : [extra.value])];
    lines.push(order(cells).map(csvField).join(','));
  }

  const body = lines.join(quirks.lineEnding);
  const tail = quirks.trailingNewline ? quirks.lineEnding : '';
  return `${quirks.bom ? BOM : ''}${body}${tail}`;
}
