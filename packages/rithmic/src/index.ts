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
// The operations are named in OVERVIEW's container table and are reproduced
// here rather than invented. `streamLive` joined them by ADR-154, and the
// paragraphs below are that ruling written where the interface is.
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
// **IT IMPLEMENTS NONE OF THE FILE-MODE OPERATIONS, AND THAT IS THE BOUNDARY
// RATHER THAN AN OMISSION.** `ingestEOD` and `ingestFills` CONSUME files; the
// simulator PRODUCES them. INV-M2-11 is that simulator output and vendor output
// go through the same parser, which is only true if the simulator stops at the
// file and the adapter starts there. A simulator that satisfied those
// operations would be a mock at the parser boundary, which is the one thing
// STRATEGY section 2 rejected by name.
//
// **THAT SENTENCE USED TO SAY `PlatformAdapter` AND IT NOW SAYS THE FILE-MODE
// OPERATIONS, WHICH IS A NARROWING RATHER THAN A REPEAL.** `provision`,
// `entitle`, `ingestFills`, `ingestEOD` and `reconcile` are still not
// implemented here and the reason above is undisturbed for all five. What
// changed is `streamLive`, and the next block is why.
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
//
// -----------------------------------------------------------------------------
// AND THEN THE SEAM MOVED FROM THE ARTIFACT TO THE TYPE. ADR-154
// -----------------------------------------------------------------------------
// The refusal above is stated as a PARSER argument and it is right about one.
// In file mode the parser is the thing both sources must traverse, so a
// simulator that satisfied `ingestEOD` would skip it. **IN TIER 2 THERE IS
// NOTHING TO SKIP**: no file, no ingest directory and no parser, and M02
// section 3.5 puts the adapter between the wire and the tick by design ("the
// adapter absorbs the difference, exactly as it already absorbs report shape,
// so the consumer sees one stream either way").
//
// So ADR-154 ruled that **the simulator implements `streamLive` and `streamLive`
// joins this interface**, and that **the thing both implementations share stops
// being an artifact and becomes a TYPE**. In tier 1 what the simulator and the
// vendor both produce is a CSV file; in tier 2 it is `LiveAccountTick`, which
// `stream.ts` had already built to be exactly that: `indicative: true` as a
// required literal, a per-account-per-day `sequence` so a lost tick is
// distinguishable from a quiet market, and `Cents` as `bigint`.
//
// **`GS-084`'s PROPERTY HAS NO TIER-2 ANALOGUE AND NOTHING HERE CLAIMS ONE.**
// "No downstream code branches on source" is purchasable only where both
// sources write into one directory. What replaces it is a CONFORMANCE
// assertion run over each implementation rather than asserted of the interface,
// and `test/stream-conformance.test.ts` is it.
//
// **ONE METHOD, AND THE REFUSAL IS THE LOAD-BEARING HALF.** ADR-154 clause 3
// forecloses in advance the argument that a simulator implementing one
// operation may implement the others: those five have a parser and this one
// does not. `simulatorLiveFeed` is typed `Pick<PlatformAdapter, 'streamLive'>`
// so the compiler says it, and `adapter.test.ts` asserts the key set of what it
// returns rather than trusting the annotation.
// =============================================================================

import type { LiveAccountTick } from './simulator/stream.ts';

/** An account on the trading platform, as the vendor identifies it. */
export type PlatformAccountId = string & { readonly __brand: 'PlatformAccountId' };

/**
 * What `streamLive` pushes each observation to. M02 section 3.5 names the shape.
 *
 * `void` rather than `Promise<void>` on purpose: a handler the feed awaited
 * would make delivery order a property of the consumer's slowest write, and
 * `LiveAccountTick.sequence` exists so ordering is the FEED's statement. A
 * consumer that needs to do I/O per tick queues it and says so.
 */
export type LiveTickHandler = (tick: LiveAccountTick) => void;

/**
 * An open live feed, and the only thing a consumer may do to one.
 *
 * **FEED LOSS IS NOT HERE AND ITS ABSENCE IS DELIBERATE.** ADR-020 rule 3 makes
 * feed loss a first-class state rather than an error, and M02 section 3.5 rule 3
 * says what a surface must do when it happens. Neither is expressible as a
 * method on this object: the shape of a staleness claim is the SERVER's under
 * ADR-152, and [P6](../../../docs/plans/P6-live-tier.md) section 3.4 holds the
 * event family that has no member yet. A `Subscription` that carried its own
 * `onLoss` would be this slice deciding a contract two other slices own, so it
 * carries the one operation a consumer genuinely has: stop asking.
 */
export interface Subscription {
  /**
   * Stop delivery. Idempotent, and no tick is delivered after it returns.
   *
   * Idempotent because the two ways a feed ends -- the consumer closing it and
   * the feed running out -- are indistinguishable from the consumer's side
   * until something says otherwise, and making the second one throw would put a
   * `try` around every teardown in the estate.
   */
  close(): void;
}

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
  /**
   * Open ADR-020's tier-2 indicative feed. M02 section 3.5, ADR-154.
   *
   * **THE ONLY OPERATION HERE THE SIMULATOR IMPLEMENTS**, and the header says
   * why the other five stay refused. `LiveAccountTick` appears nowhere in the
   * authoritative pipeline and is deliberately not convertible into a
   * `NormalizedFill`, which is what makes "the stream never feeds a money
   * decision" a compiler fact rather than a reviewer's memory (INV-M2-14,
   * SECURITY C-26).
   *
   * **IT CARRIES ITS REAL SIGNATURE AND THE FIVE ABOVE DO NOT**, which is not
   * an inconsistency to tidy: the five are declarations whose parameter lists
   * are owed to M02, which holds at `review` by ADR-005 pending the vendor
   * call. This one has an implementation, so it has the signature M02 section
   * 3.5 already wrote.
   */
  streamLive(handler: LiveTickHandler): Promise<Subscription>;
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
  simulatorLiveFeed,
  streamRun,
  DECLARED_LIVE_FEED_OPTIONS,
  DECLARED_STREAM_OPTIONS,
  StreamError,
  type LiveAccountTick,
  type LiveFeedOptions,
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
