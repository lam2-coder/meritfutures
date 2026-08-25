import { expect, test } from 'vitest';

import {
  csvField,
  formatMoney,
  formatPrice,
  renderCsv,
  CsvRenderError,
  DECLARED_CSV_QUIRKS,
} from '../src/simulator/csv.ts';

// CI-02, the `unit` project.
//
// The rendering layer, asserted at its boundaries. The money cases are the ones
// that matter: every balance in every file goes through `formatMoney`, and the
// negative-cent case is where a naive `whole = cents / scale` on a BigInt
// renders minus one cent as `0.01`, because BigInt division truncates toward
// zero and the sign is lost with the quotient.

test('money renders exactly, sign placed by hand rather than by the quotient', () => {
  expect(formatMoney(0n)).toBe('0.00');
  expect(formatMoney(1n)).toBe('0.01');
  expect(formatMoney(-1n)).toBe('-0.01');
  expect(formatMoney(-99n)).toBe('-0.99');
  expect(formatMoney(100n)).toBe('1.00');
  expect(formatMoney(-100n)).toBe('-1.00');
  expect(formatMoney(5_000_000n)).toBe('50000.00');
  expect(formatMoney(-150_000n)).toBe('-1500.00');
});

test('money survives a value no float could hold', () => {
  // CLAUDE.md: money is integer cents and there are no floats in financial
  // paths. `Number(9007199254740993n) / 100` is not this number.
  expect(formatMoney(9_007_199_254_740_993n)).toBe('90071992547409.93');
});

test('a price renders to its own decimal places', () => {
  expect(formatPrice(500_000, 2)).toBe('5000.00');
  expect(formatPrice(500_025, 2)).toBe('5000.25');
  expect(formatPrice(12, 4)).toBe('0.0012');
});

test('money refuses a scale it cannot render exactly', () => {
  expect(() => formatMoney(1n, 10)).toThrow(CsvRenderError);
  expect(() => formatMoney(1n, -1)).toThrow(CsvRenderError);
});

test('RFC 4180 quoting, and nothing beyond it', () => {
  expect(csvField('SIMACC000001')).toBe('SIMACC000001');
  expect(csvField('CASH, WITHDRAWAL')).toBe('"CASH, WITHDRAWAL"');
  expect(csvField('SAY "HELLO"')).toBe('"SAY ""HELLO"""');
  expect(csvField('LINE\nBREAK')).toBe('"LINE\nBREAK"');
  expect(csvField('CARRIAGE\rRETURN')).toBe('"CARRIAGE\rRETURN"');
});

const TABLE = {
  columns: ['a', 'b'],
  rows: [
    ['1', '2'],
    ['3', '4'],
  ],
};

test('the declared shape is header, rows, LF, trailing newline, no BOM', () => {
  expect(renderCsv(TABLE)).toBe('a,b\n1,2\n3,4\n');
});

test('a row that disagrees with the header is refused rather than padded', () => {
  expect(() => renderCsv({ columns: ['a', 'b'], rows: [['1']] })).toThrow(CsvRenderError);
});

// ---------------------------------------------------------------------------
// The hostile-but-legal shapes. AS-M2-01 counter 4, GS-085.
// ---------------------------------------------------------------------------
// Each one is a file a real vendor emits without announcing it and a tolerant
// parser swallows. The assertion here is only that the emitter can PRODUCE
// them; that each either parses identically or quarantines, and none partially
// applies, is GS-085 and belongs to the parser's session.

test('a BOM is emitted as the one character that encodes to EF BB BF', () => {
  const rendered = renderCsv(TABLE, { ...DECLARED_CSV_QUIRKS, bom: true });
  expect(rendered.codePointAt(0)).toBe(0xfeff);
  expect(new TextEncoder().encode(rendered).slice(0, 3)).toEqual(
    new Uint8Array([0xef, 0xbb, 0xbf]),
  );
});

test('CRLF line endings', () => {
  expect(renderCsv(TABLE, { ...DECLARED_CSV_QUIRKS, lineEnding: '\r\n' })).toBe(
    'a,b\r\n1,2\r\n3,4\r\n',
  );
});

test('a reordered file keeps its header with its cells', () => {
  // The point of the case: a parser reading by header NAME is unaffected and a
  // parser reading by POSITION silently transposes every column.
  expect(renderCsv(TABLE, { ...DECLARED_CSV_QUIRKS, columnOrder: 'reversed' })).toBe(
    'b,a\n2,1\n4,3\n',
  );
});

test('an unannounced extra trailing column', () => {
  expect(
    renderCsv(TABLE, {
      ...DECLARED_CSV_QUIRKS,
      extraTrailingColumn: { header: 'vendor_note', value: 'x' },
    }),
  ).toBe('a,b,vendor_note\n1,2,x\n3,4,x\n');
});

test('the extra column travels with the reordering rather than staying pinned', () => {
  expect(
    renderCsv(TABLE, {
      ...DECLARED_CSV_QUIRKS,
      columnOrder: 'reversed',
      extraTrailingColumn: { header: 'vendor_note', value: 'x' },
    }),
  ).toBe('vendor_note,b,a\nx,2,1\nx,4,3\n');
});

test('a file with no trailing newline', () => {
  expect(renderCsv(TABLE, { ...DECLARED_CSV_QUIRKS, trailingNewline: false })).toBe(
    'a,b\n1,2\n3,4',
  );
});

test('a table with no rows is a header and nothing else', () => {
  // GS-085's "a day with zero accounts". It is a LEGAL file and it must parse:
  // an empty book is what the first week of beta looks like.
  expect(renderCsv({ columns: ['a', 'b'], rows: [] })).toBe('a,b\n');
});
