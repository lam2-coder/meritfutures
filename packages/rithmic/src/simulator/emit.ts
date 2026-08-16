// =============================================================================
// packages/rithmic/src/simulator/emit.ts
// =============================================================================
// THE SIMULATOR EMITS FILES, NOT OBJECTS. That sentence is INV-M2-11 and it is
// the reason this file exists rather than a `getEodRows()` returning an array.
//
// AS-M2-01 is the scenario where the simulator becomes the specification: every
// test, every fixture and every developer's mental model comes from a simulator
// written from the same assumptions as the parser, by the same author, on the
// same day, and it agrees with the parser about everything including what both
// get wrong. The first designed-in counter is architectural: the simulator
// WRITES CSV INTO THE INGEST DIRECTORY and nothing downstream can tell it apart
// from a vendor file (GS-084). A mock at the parser boundary would leave the
// parser untested by every test that appears to test it.
//
// So the split here is deliberate:
//
//   renderRun    PURE. Bytes, digest, row count, file name. No filesystem.
//   writeFiles   the only I/O in the package, and it does nothing else
//
// A test that wants to assert bytes never touches a disk, and a harness that
// wants a directory gets one, and neither can drift from the other because the
// second one writes exactly what the first one returned.
//
// -----------------------------------------------------------------------------
// THE DIGEST IS COMPUTED HERE BECAUSE INV-M2-02 IS ASSERTED ON IT
// -----------------------------------------------------------------------------
// `ingest_files.sha256` carries a UNIQUE index (0013) and that index is the
// guarantee that a byte-identical redelivery is a no-op, not a helper for one.
// Emitting the digest beside the bytes lets a scenario state its intent
// exactly: a redelivery with the same digest is `duplicate_ignored`, and one
// with a new digest under a seen file name is the `full_replacement` decision
// SD-M2-03 forces the parser to make explicitly (AS-M2-02, GS-086).
// =============================================================================

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderCsv, DECLARED_CSV_QUIRKS, type CsvQuirks, type CsvTable } from './csv.js';
import { eodReportTable, DECLARED_EOD_OPTIONS, type EodReportOptions } from './eod-report.js';
import { fillsReportTable } from './fills-report.js';
import { compactTradingDay } from './time.js';
import type { SimRun, TradingDay } from './types.js';

/** `ingest_files.kind` (0013). The values are the schema's, not this package's. */
export type IngestFileKind = 'eod_report' | 'fills';

/** Thrown when a run cannot be emitted as asked. */
export class EmitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmitError';
  }
}

export interface EmitOptions {
  readonly kinds: readonly IngestFileKind[];
  readonly quirks: CsvQuirks;
  readonly eod: EodReportOptions;
  /**
   * The vendor's file-name prefix.
   *
   * INBOUND FILE NAMING IS NOT ITSELF A `V-M2-nn` ROW AND ARGUABLY SHOULD BE.
   * Section 3.3's `merit_<operation>_...` convention is the OUTBOUND
   * provisioning name, which Merit chooses; the inbound name is the vendor's
   * and section 3.4's disposition table branches on whether it has been SEEN
   * BEFORE, so a convention is assumed without a row asserting one exists.
   * `V-M2-03` and `V-M2-04` are the two rows that move if it is wrong, and both
   * are cited here for that reason. The gap is recorded in the README and the
   * session log rather than written into M02's table, which this session does
   * not own.
   */
  readonly namePrefix: string;
  /**
   * `0` emits the file under its plain name. A positive revision appends
   * `_r<n>`, which is how a scenario emits a redelivery under a NEW name for
   * an already-applied day: the `correction_set` row of section 3.4's
   * disposition table. Re-emitting at revision `0` with different bytes is the
   * `full_replacement` row, and the two are different files on purpose.
   */
  readonly revision: number;
}

export const DECLARED_EMIT_OPTIONS: EmitOptions = Object.freeze({
  kinds: ['eod_report', 'fills'] as const,
  quirks: DECLARED_CSV_QUIRKS,
  eod: DECLARED_EOD_OPTIONS,
  namePrefix: 'RITHMIC',
  revision: 0,
});

/** One rendered file, with everything `ingest_files` records about it. */
export interface EmittedFile {
  readonly fileName: string;
  readonly kind: IngestFileKind;
  readonly tradingDay: TradingDay;
  readonly contents: string;
  readonly bytes: Uint8Array;
  /** `ingest_files.byte_size`. */
  readonly byteSize: number;
  /** `ingest_files.sha256`, hex. INV-M2-02's uniqueness is asserted on this. */
  readonly sha256Hex: string;
  /** `ingest_files.row_count`. Data rows, header excluded. */
  readonly rowCount: number;
}

const KIND_TOKEN: Readonly<Record<IngestFileKind, string>> = Object.freeze({
  eod_report: 'EOD',
  fills: 'FILLS',
});

function fileName(kind: IngestFileKind, tradingDay: TradingDay, options: EmitOptions): string {
  const suffix = options.revision === 0 ? '' : `_r${options.revision}`;
  return `${options.namePrefix}_${KIND_TOKEN[kind]}_${compactTradingDay(tradingDay)}${suffix}.csv`;
}

function emitted(
  kind: IngestFileKind,
  tradingDay: TradingDay,
  table: CsvTable,
  options: EmitOptions,
): EmittedFile {
  const contents = renderCsv(table, options.quirks);
  const bytes = new TextEncoder().encode(contents);
  return {
    fileName: fileName(kind, tradingDay, options),
    kind,
    tradingDay,
    contents,
    bytes,
    byteSize: bytes.byteLength,
    sha256Hex: createHash('sha256').update(bytes).digest('hex'),
    rowCount: table.rows.length,
  };
}

/**
 * Render every file the run produces. PURE: no clock, no filesystem, no
 * randomness that is not already in the seed.
 *
 * Files come out in session order, and within a session in the order `kinds`
 * declares. Order is stable so a caller may compare two runs file by file.
 */
export function renderRun(run: SimRun, options: Partial<EmitOptions> = {}): readonly EmittedFile[] {
  const resolved: EmitOptions = { ...DECLARED_EMIT_OPTIONS, ...options };
  if (!Number.isSafeInteger(resolved.revision) || resolved.revision < 0) {
    throw new EmitError(`revision ${resolved.revision} is not an ordinal`);
  }
  if (resolved.kinds.length === 0) {
    throw new EmitError('renderRun was asked for no file kinds');
  }

  const files: EmittedFile[] = [];
  for (const [index, session] of run.sessions.entries()) {
    for (const kind of resolved.kinds) {
      const table =
        kind === 'eod_report'
          ? eodReportTable(run, index, resolved.eod)
          : fillsReportTable(run, index);
      files.push(emitted(kind, session.tradingDay, table, resolved));
    }
  }
  return files;
}

/**
 * Write the rendered files into a directory. THE ONLY I/O IN THIS PACKAGE.
 *
 * It writes the bytes it was given and computes nothing, so what lands on disk
 * is what a byte-comparison test already asserted. A collision is an error
 * rather than an overwrite: two files with one name in one emission is a
 * scenario that meant to state a revision and did not, and silently keeping the
 * second one is how a redelivery fixture stops testing redelivery.
 */
export function writeFiles(files: readonly EmittedFile[], outputDir: string): readonly string[] {
  mkdirSync(outputDir, { recursive: true });
  const written = new Set<string>();
  const paths: string[] = [];
  for (const file of files) {
    if (written.has(file.fileName)) {
      throw new EmitError(`two files in this emission are named ${file.fileName}`);
    }
    written.add(file.fileName);
    const path = join(outputDir, file.fileName);
    writeFileSync(path, file.bytes);
    paths.push(path);
  }
  return paths;
}
