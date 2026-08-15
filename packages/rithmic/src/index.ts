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
