// =============================================================================
// packages/enrichment
// =============================================================================
// ADR-023's CHECKOUT ENRICHMENT, IN OBSERVE MODE. ONE PORT, ONE CONTRACT ROW,
// ONE SCORER, AND NOTHING THAT CAN REFUSE A PURCHASE.
//
// ADR-023 is the ruling and it is settled: the vendor is BOUGHT and not built,
// because "its value comes from having seen an email address across millions of
// merchants, which Merit structurally cannot replicate at any engineering
// budget"; the adapter is VENDOR-AGNOSTIC because the vendor will be
// re-evaluated; and the rollout is GRADUATED with observe mode first. M03
// section 7.9 is the specification of the call and its failure behaviour, and
// M07's `D-15` is what the signals feed.
//
// WHAT IS DELIBERATELY NOT EXPORTED, AND WHY EACH ABSENCE IS A DECISION.
//
//   NO DECISION, ANYWHERE. There is no type in this package with an `allow`, a
//   `decline` or a `blocked` member, no function that answers a yes-or-no
//   question about a score, and no constant to compare one against.
//   `observeEnrichment` returns `Promise<void>`, so a call site has nothing to
//   branch on. ADR-023's step 3 is a soft decline plus a review queue, and it
//   is a different slice.
//
//   NO MAPPING FROM A SCORE TO A SEVERITY, AND NO `risk_flags` WRITE. ADR-040's
//   `G-HOLD-REQUIRED` holds a payout on an unresolved flag at severity 4 or
//   above, so a band written here from an untuned score would give observe mode
//   authority over money LEAVING while it claims none over money arriving.
//   `D-12` already ruled the shape for a detector that observes without
//   accusing: "Output is a watched-cluster set, not a flag ... rather than
//   accusing anyone." ADR-115 records the consequence, which is that the score
//   has no persisted column yet.
//
//   NO THRESHOLD AND NO TUNED PARAMETER. ADR-023 rules thresholds "tuned on
//   beta data, never on the vendor's defaults, because the vendor's defaults
//   describe a different population", and there is no beta data. `ageDays` is
//   recorded and not scored for exactly this reason.
//
//   NO VENDOR NAME, NO WIRE FORMAT AND NO SOCKET. This package opens nothing.
//   The implementations of `assess` in this tree are fakes and say so, which is
//   `packages/psp`'s precedent under M03 section 2.1.
//
//   NO DATABASE. `@merit/db` is not a dependency and neither `pg` nor
//   `drizzle-orm` is importable here under VG-4. The writer is injected and the
//   observation therefore commits with the purchase that caused it, or not at
//   all.
//
//   NO ROUTE. `POST /checkout` is session 220's and it calls this.

export {
  ENRICHMENT_FACETS,
  type EnrichmentAdapter,
  type EnrichmentAssessment,
  type EnrichmentFacet,
  type EnrichmentSubject,
  type FacetFinding,
} from './port.ts';

export {
  ENRICHMENT_CONTRACT_VERSION,
  ENRICHMENT_EVENT_NAME,
  ENRICHMENT_FIELD_ALLOWLIST,
  ENRICHMENT_INTEGRATION,
  enrichmentContractValues,
  liveContractFrom,
  readLiveContract,
  redactToAllowlist,
  type ContractRow,
  type ContractSource,
  type RedactedSubject,
} from './contract.ts';

export {
  SCORE_SCALE_BP,
  scoreAssessment,
  type FootprintScore,
  type ReadingTally,
  type RiskBp,
} from './score.ts';

export {
  ENRICHMENT_SIGNAL_KIND,
  ENRICHMENT_TIMEOUT_MS,
  observeEnrichment,
  type ObserveDeps,
  type ObserveOutcome,
  type ObserveOutcomeKind,
  type ObserveReporter,
  type RecordedAge,
} from './observe.ts';

export type {
  EnrichmentReadKey,
  EnrichmentTx,
  EnrichmentUpdateKey,
  EnrichmentWriteKey,
  RowAddress,
  RowFilter,
  WriteValues,
} from './tx.ts';

// THE FAKES ARE EXPORTED AND THAT IS `packages/psp`'s POSTURE, NOT AN
// OVERSIGHT. A deployable that wires one of these has wired a vendor that
// answers nothing real, which is a diff a reviewer reads; a fake reachable only
// from a suite would leave every caller writing its own, and three hand-rolled
// hanging vendors is three chances to model the timeout wrongly.
export {
  answeringVendor,
  failingVendor,
  hangingVendor,
  lateFailingVendor,
  type FakeAnswer,
} from './fakes/vendors.ts';
