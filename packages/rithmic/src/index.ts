// =============================================================================
// packages/rithmic
// =============================================================================
// The platform adapter. OVERVIEW section 3: "Isolates every vendor specific
// behind the interface so adapter #2 is additive."
//
// THE INTERFACE IS THE WHOLE POINT OF THE PACKAGE, so the scaffold declares it
// and implements none of it. M02 fills it in, and M02 holds at `review` by
// ADR-005 pending the Rithmic vendor call: file naming conventions, delivery
// acknowledgement, arrival window, vendor-side retention and sandbox
// availability are all provisional-pending-vendor-confirmation. Writing an
// implementation against unconfirmed mechanics is how a bounded edit becomes a
// redesign.
//
// The five operations are named in OVERVIEW's container table and are
// reproduced here rather than invented.
//
// -----------------------------------------------------------------------------
// WHAT NOW EXISTS BESIDE IT: THE SYNTHETIC SIMULATOR, FILE MODE
// -----------------------------------------------------------------------------
// M02 section 1.1: "v1 ships two implementations of that interface: Rithmic and
// the synthetic simulator. The simulator is not a convenience. WITH NO VENDOR
// SANDBOX ASSUMED AVAILABLE (`V-M2-13`), it is the only way the pipeline runs
// end to end before a contract exists, and it is a v1 requirement."
//
// The simulator emits EOD report files and their per-fill sibling from a seeded
// account population, deterministically. `simulator/` is the whole of it and
// `simulator/assumptions.ts` is the list of what the vendor call must confirm.
//
// **IT DOES NOT IMPLEMENT `PlatformAdapter`, AND THAT IS THE BOUNDARY RATHER
// THAN AN OMISSION.** `ingestEOD` and `ingestFills` CONSUME files; the
// simulator PRODUCES them. INV-M2-11 is that simulator output and vendor output
// go through the same parser, which is only true if the simulator stops at the
// file and the adapter starts there. A simulator that satisfied the interface
// would be a mock at the parser boundary, which is the one thing STRATEGY
// section 2 rejected by name.
//
// -----------------------------------------------------------------------------
// AND STREAMING MODE, ADR-020's TIER 2, WHICH ATTACHED AT THAT SEAM
// -----------------------------------------------------------------------------
// This header read "STREAMING MODE IS NOT HERE" and named `SimDay.waypoints` as
// the seam a later session would attach to. That session landed and it attached
// exactly there.
//
// **The two modes are two views of one path rather than two producers.** File
// mode summarises the waypoints into opening, closing, high and low; streaming
// mode replays them as ticks. `stream.test.ts` folds the stream and compares it
// to the RENDERED EOD CSV field by field, which is the equivalence worth having:
// a live dashboard that disagreed with the closing file would be a number the
// trader sees Merit contradict at settlement.
//
// **Nothing here is authoritative and the type says so.** ADR-020's hard rule is
// that indicative data never feeds an eligibility, breach or money decision
// (INV-M2-14, SECURITY C-26). `LiveAccountTick.indicative` is a required `true`
// literal so a consumer cannot destructure one without meeting the word.
//
// **`V-M2-16` is the mechanism and it is unconfirmed**, so it moved from
// `OUT_OF_SCOPE_FOR_FILE_MODE` into `STREAM_MODE_VENDOR_ASSUMPTIONS` on the day
// this landed, which is what its out-of-scope entry said would happen.
// =============================================================================

/** An account on the trading platform, as the vendor identifies it. */
export type PlatformAccountId = string & { readonly __brand: 'PlatformAccountId' };

/**
 * Everything the rest of the system is allowed to ask a trading platform for.
 *
 * A second adapter is additive precisely because this list is short and stated
 * in Merit's terms rather than the vendor's. Nothing outside this package
 * imports a vendor type.
 */
export interface PlatformAdapter {
  /** Create the platform account for a purchased plan. */
  provision(): Promise<PlatformAccountId>;
  /** Grant or revoke the entitlements a phase implies. */
  entitle(): Promise<void>;
  /** Pull executions into the ingest path. */
  ingestFills(): Promise<void>;
  /** Pull the end-of-day report into the ingest path. */
  ingestEOD(): Promise<void>;
  /** Compare what the platform says against what Merit recorded. */
  reconcile(): Promise<void>;
}

// -----------------------------------------------------------------------------
// The synthetic simulator: file mode and streaming mode
// -----------------------------------------------------------------------------

export {
  FILE_MODE_VENDOR_ASSUMPTIONS,
  OUT_OF_SCOPE_FOR_FILE_MODE,
  STREAM_MODE_VENDOR_ASSUMPTIONS,
  type OutOfScopeAssumption,
  type VendorAssumption,
} from './simulator/assumptions.ts';
export {
  csvField,
  formatMoney,
  formatPrice,
  renderCsv,
  CsvRenderError,
  DECLARED_CSV_QUIRKS,
  type CsvQuirks,
  type CsvTable,
} from './simulator/csv.ts';
export {
  renderRun,
  writeFiles,
  DECLARED_EMIT_OPTIONS,
  EmitError,
  type EmitOptions,
  type EmittedFile,
  type IngestFileKind,
} from './simulator/emit.ts';
export {
  eodReportTable,
  DECLARED_EOD_OPTIONS,
  EOD_REPORT_COLUMNS,
  type EodReportOptions,
} from './simulator/eod-report.ts';
export { fillsReportTable, FILLS_REPORT_COLUMNS } from './simulator/fills-report.ts';
export { buildPopulation, PopulationSpecError } from './simulator/population.ts';
export { drawKey, draws, DrawError, type Draws, type Range } from './simulator/rng.ts';
export { contractsTraded, simulate, SimulationError } from './simulator/session.ts';
export {
  foldStream,
  sampleTicks,
  streamRun,
  DECLARED_STREAM_OPTIONS,
  StreamError,
  type LiveAccountTick,
  type StreamFold,
  type StreamOptions,
} from './simulator/stream.ts';
export {
  civilFromDays,
  compactTradingDay,
  daysFromCivil,
  formatInstantUtc,
  parseInstantUtc,
  parseTradingDay,
  InstantFormatError,
} from './simulator/time.ts';
export type {
  AccountSizeBand,
  BalanceAdjustment,
  Cents,
  ContractSpec,
  PopulationBehaviour,
  PopulationSpec,
  SimAccount,
  SimDay,
  SimFill,
  SimLiquidation,
  SimRun,
  SimSession,
  SimTrade,
  SimWaypoint,
  SimulationInput,
  TradingDay,
} from './simulator/types.ts';
