import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { canonicalInput, CANONICAL_POPULATION_SPEC, CANONICAL_SESSIONS } from './canonical.ts';
import { DECLARED_CSV_QUIRKS } from '../src/simulator/csv.ts';
import { renderRun, writeFiles, EmitError } from '../src/simulator/emit.ts';
import { EOD_REPORT_COLUMNS } from '../src/simulator/eod-report.ts';
import { FILLS_REPORT_COLUMNS } from '../src/simulator/fills-report.ts';
import { buildPopulation } from '../src/simulator/population.ts';
import { simulate } from '../src/simulator/session.ts';

// CI-02, the `unit` project.
//
// THE SIMULATOR EMITS FILES, NOT OBJECTS (INV-M2-11), so what is asserted here
// is the file: its name, its bytes, its digest, its row count. GS-084 pins that
// the simulator writes CSV into the ingest path and no downstream code branches
// on source, and that is only true if this layer produces something a directory
// listing cannot tell apart from a vendor delivery.

const run = simulate(canonicalInput());

test('one file per kind per session, named for the day it describes', () => {
  const files = renderRun(run);
  expect(files.map((file) => file.fileName)).toEqual([
    'RITHMIC_EOD_20261102.csv',
    'RITHMIC_FILLS_20261102.csv',
    'RITHMIC_EOD_20261103.csv',
    'RITHMIC_FILLS_20261103.csv',
    'RITHMIC_EOD_20261104.csv',
    'RITHMIC_FILLS_20261104.csv',
  ]);
});

test('the kind is `ingest_files.kind`, spelled the way 0013 spells it', () => {
  const kinds = new Set(renderRun(run).map((file) => file.kind));
  expect([...kinds].sort()).toEqual(['eod_report', 'fills']);
});

test('a revision emits a new name for the same day', () => {
  // Section 3.4's `correction_set` row: a redelivery under a NEW name for a day
  // already applied. Re-emitting at revision 0 with different bytes is the
  // `full_replacement` row, and the two are different files on purpose.
  const files = renderRun(run, { kinds: ['eod_report'], revision: 2 });
  expect(files.map((file) => file.fileName)).toEqual([
    'RITHMIC_EOD_20261102_r2.csv',
    'RITHMIC_EOD_20261103_r2.csv',
    'RITHMIC_EOD_20261104_r2.csv',
  ]);
});

test('the EOD report carries one row per account and the declared header', () => {
  const [first] = renderRun(run, { kinds: ['eod_report'] });
  expect(first).toBeDefined();
  if (first === undefined) return;
  expect(first.rowCount).toBe(run.population.length);
  const lines = first.contents.split('\n');
  expect(lines[0]).toBe(EOD_REPORT_COLUMNS.join(','));
  expect(lines).toHaveLength(run.population.length + 2); // header, rows, trailing newline
});

test('the fills report carries two rows per round trip', () => {
  const files = renderRun(run, { kinds: ['fills'] });
  for (const [index, file] of files.entries()) {
    const trades = (run.days[index] ?? []).reduce((total, day) => total + day.trades.length, 0);
    expect(file.rowCount).toBe(trades * 2);
    expect(file.contents.split('\n')[0]).toBe(FILLS_REPORT_COLUMNS.join(','));
  }
});

test('the digest is over the bytes that will be written, and the size agrees', () => {
  // `ingest_files.sha256` carries a UNIQUE index (0013) and that index IS the
  // guarantee that a byte-identical redelivery is a no-op (INV-M2-02), so the
  // digest a scenario states its intent with has to be the digest of the file.
  for (const file of renderRun(run)) {
    expect(file.byteSize).toBe(file.bytes.byteLength);
    expect(new TextEncoder().encode(file.contents)).toEqual(file.bytes);
    expect(file.sha256Hex).toMatch(/^[0-9a-f]{64}$/);
  }
});

test('an unchanged file redelivers with the same digest and a changed one does not', () => {
  const first = renderRun(run, { kinds: ['eod_report'] })[0];
  const again = renderRun(run, { kinds: ['eod_report'] })[0];
  const quirked = renderRun(run, {
    kinds: ['eod_report'],
    quirks: { ...DECLARED_CSV_QUIRKS, lineEnding: '\r\n' },
  })[0];
  expect(first?.sha256Hex).toBe(again?.sha256Hex);
  // Same rows, same name, different bytes. This is exactly AS-M2-02's shape:
  // the digest is new so INV-M2-02 does not catch it, and the disposition
  // becomes an explicit four-way decision the parser must make (SD-M2-03).
  expect(first?.fileName).toBe(quirked?.fileName);
  expect(first?.sha256Hex).not.toBe(quirked?.sha256Hex);
});

test('a day with zero accounts is a legal file with a header and no rows', () => {
  // GS-085. An empty book is what the first week of beta looks like, so this
  // must parse rather than quarantine.
  const empty = simulate({
    ...canonicalInput(),
    population: buildPopulation({ ...CANONICAL_POPULATION_SPEC, accountCount: 0 }),
    adjustments: [],
  });
  for (const file of renderRun(empty)) {
    expect(file.rowCount).toBe(0);
    expect(file.contents.split('\n').filter((line) => line !== '')).toHaveLength(1);
  }
});

test('the quirks reach the bytes', () => {
  const [bom] = renderRun(run, {
    kinds: ['eod_report'],
    quirks: { ...DECLARED_CSV_QUIRKS, bom: true, columnOrder: 'reversed' },
  });
  expect(bom?.bytes.slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
  expect(bom?.contents.slice(1).split('\n')[0]).toBe([...EOD_REPORT_COLUMNS].reverse().join(','));
});

test('renderRun refuses an empty kind list rather than emitting nothing', () => {
  expect(() => renderRun(run, { kinds: [] })).toThrow(EmitError);
  expect(() => renderRun(run, { revision: -1 })).toThrow(EmitError);
});

test('writeFiles writes exactly the bytes it was given', () => {
  const directory = mkdtempSync(join(tmpdir(), 'merit-rithmic-'));
  const files = renderRun(run);
  const paths = writeFiles(files, directory);

  expect(paths).toHaveLength(files.length);
  expect(readdirSync(directory).sort()).toEqual([...files.map((f) => f.fileName)].sort());
  for (const [index, file] of files.entries()) {
    const onDisk = readFileSync(paths[index] ?? '');
    expect(new Uint8Array(onDisk)).toEqual(file.bytes);
  }
});

test('two files with one name in one emission is an error, not an overwrite', () => {
  const directory = mkdtempSync(join(tmpdir(), 'merit-rithmic-'));
  const single = renderRun(run, { kinds: ['eod_report'] })[0];
  expect(single).toBeDefined();
  if (single === undefined) return;
  expect(() => writeFiles([single, single], directory)).toThrow(EmitError);
});

test('the session count and the file count stay in step', () => {
  expect(CANONICAL_SESSIONS).toHaveLength(3);
  expect(renderRun(run, { kinds: ['eod_report'] })).toHaveLength(CANONICAL_SESSIONS.length);
});
