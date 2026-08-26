// =============================================================================
// packages/enrichment/src/port.ts
// =============================================================================
// THE INTERFACE EVERY DIGITAL-FOOTPRINT VENDOR IS USED THROUGH.
//
// ADR-023 is the ruling and M03 section 7.9 is the specification. The adapter is
// VENDOR-AGNOSTIC for the reason ADR-023 states categorically rather than as a
// preference: this is a data-network product whose value comes from having seen
// an email address across millions of merchants, Merit cannot replicate that at
// any engineering budget, and the vendor will therefore be re-evaluated. A port
// is what makes the re-evaluation a diff on one file.
//
// NO VENDOR IS NAMED ANYWHERE IN THIS PACKAGE, and that is a fence rather than
// a style: M03 section 7.9.1 makes portability history "a condition of
// acceptance" and the procurement is not reopened here.
//
// THREE RULES, EACH BECAUSE OF SOMETHING ALREADY DOCUMENTED.
//
//   1. NOTHING IN THIS INTERFACE RETURNS A DECISION. `packages/psp`'s second
//      rule, and here it is the whole ruling rather than one of three: ADR-023
//      step 1 is observe mode, "signals recorded, scored, and reported; nothing
//      is blocked", and a port with an `allow` or a `decline` member would make
//      the step-3 posture reachable from a step-1 slice.
//
//   2. EVERY VENDOR FIELD IS THREE-VALUED, and `null` is NOT `false`. M07
//      section 3.2 names this as the one implementation trap in the whole D-18
//      composite, and it is a mass-false-positive trap rather than a
//      missed-detection one: `null` means "we did not find out" and `false`
//      means "the vendor looked and there is none", so a detector written
//      against `IS NOT TRUE` scores every vendor timeout as a fleet member and
//      converts a supplier outage into a flood of flags against real customers
//      on the day Merit can least afford it.
//
//   3. THE CLOCK IS THE CALLER'S. `assess` takes an `AbortSignal` so an adapter
//      CAN abandon its socket, and `observe.ts` does not TRUST it to: the
//      timeout there is a race against this promise, not a hope that the
//      implementation honours a signal. An adapter that ignores the signal
//      slows nothing down, which is what "a vendor timeout must not roll back a
//      purchase" requires when the vendor is a third party.
//
// THIS PACKAGE OPENS NO SOCKET. The implementations of this method in the tree
// are FAKES and say so, which is `packages/psp` under M03 section 2.1 and
// `packages/rithmic` under M02 section 3.5 point 4 rather than a new argument.

/**
 * The facets Merit may ask a vendor about, CLOSED.
 *
 * These are exactly ADR-023's purchased scope: "email and phone
 * digital-footprint (how old and how connected the identity's public presence
 * is), device, IP, VPN and datacenter detection, and BIN intelligence".
 *
 * THE SET IS ALSO THE `field_allowlist` VOCABULARY. `integration_contracts`
 * holds field NAMES rather than anybody's values (`SD-M10-01`), and the names
 * it holds for this integration are these five words. One vocabulary rather
 * than two is what stops the contract row and the call from disagreeing about
 * what a permitted field is.
 *
 * A SIXTH MEMBER IS A CONTRACT-ROW CHANGE BEFORE IT IS A TYPE CHANGE, and that
 * ordering is deliberate: the row is what a person approved.
 */
export type EnrichmentFacet = 'email_footprint' | 'phone_footprint' | 'device' | 'ip' | 'bin';

/** All five, in the order the contract row writes them. */
export const ENRICHMENT_FACETS: readonly EnrichmentFacet[] = [
  'email_footprint',
  'phone_footprint',
  'device',
  'ip',
  'bin',
];

/**
 * What checkout knows about the buyer, keyed by facet.
 *
 * A `Partial` RECORD RATHER THAN FIVE NAMED FIELDS, because the same five words
 * are the allowlist vocabulary and a second spelling of them would be the drift
 * this repository catches most often. A facet Merit does not have is ABSENT
 * rather than `undefined`: `exactOptionalPropertyTypes` is on, so writing
 * `{ ip: undefined }` does not compile, and "absent" therefore has one spelling.
 *
 * THE VALUES ARE RAW AND THEY ARE THE ONLY RAW VALUES IN THIS PACKAGE. They
 * exist to be sent, they are narrowed to the contract's allowlist before they
 * are, and nothing derived from them is ever stored unhashed (`INV-M7-08`).
 */
export type EnrichmentSubject = Readonly<Partial<Record<EnrichmentFacet, string>>>;

/**
 * What the vendor said about ONE facet.
 *
 * `reference` IS THE NODE AND EVERYTHING ELSE IS THE READING. Two identities
 * whose email footprints resolve to the same vendor reference are the same
 * footprint, which is what makes this row worth anything to `D-16`'s link
 * confidence; the reputations and ages are what `D-15` scores. The reference is
 * HASHED before it is stored and never written raw.
 *
 * EVERY READING IS `| null` AND `null` IS RULE 2. It is not a zero, it is not a
 * `false`, and it does not lower a score: `score.ts` excludes it from the
 * denominator instead.
 */
export interface FacetFinding {
  readonly facet: EnrichmentFacet;
  /**
   * The vendor's own stable reference for this facet's value.
   *
   * Opaque to Merit by design. It is hashed on the way into `identity_signals`,
   * so a breach of that table yields "these two accounts shared something"
   * rather than the value they shared.
   */
  readonly reference: string;
  /**
   * How reputable the vendor finds this facet, in INTEGER BASIS POINTS, 0 to
   * 10000, where 10000 is the most reputable.
   *
   * Basis points because `identity_links.confidence_bp` is the corpus's one
   * scored scale and it is `integer ... CHECKed 0 to 10000`. NO FLOATS: a
   * fraction in a fraud path is a fraction in a money path one ruling later.
   */
  readonly reputationBp: number | null;
  /** Whether the vendor found a public presence at all. `null` is rule 2. */
  readonly footprintPresent: boolean | null;
  /** How old that presence is, in INTEGER DAYS. `null` is rule 2. */
  readonly ageDays: number | null;
  /**
   * Whether this facet originates in a datacenter, a VPN or a hosting range.
   *
   * Meaningful for `ip` and `null` everywhere else, which is rule 2 doing its
   * ordinary job rather than a special case: "this question does not apply" and
   * "we did not find out" are both "we did not learn a value" to a scorer, and
   * neither is a `false`.
   */
  readonly datacenter: boolean | null;
}

/**
 * Everything the vendor returned, and NO VERDICT.
 *
 * There is no `decision`, no `recommendation`, no `riskLevel` and no boolean on
 * this type, and the absence is rule 1. A vendor's own verdict, if the wire
 * format carries one, is DROPPED by the adapter rather than surfaced: it is
 * computed against the vendor's population and ADR-023 rules thresholds "tuned
 * on beta data, never on the vendor's defaults, because the vendor's defaults
 * describe a different population".
 */
export interface EnrichmentAssessment {
  readonly findings: readonly FacetFinding[];
}

/**
 * Everything the rest of Merit is allowed to ask an enrichment vendor for.
 *
 * ONE METHOD, which is the whole of ADR-023's purchased scope. `packages/psp`
 * needs five because a payment provider has a lifecycle; a data-network lookup
 * has one question and one answer.
 */
export interface EnrichmentAdapter {
  /**
   * Which integration this is. Written to `integration_dispatches.integration`
   * and matched against `integration_contracts.integration`.
   *
   * IT IS THE ROLE AND NOT THE VENDOR. A second enrichment vendor is a
   * different `integration` value, a different contract row, and a person
   * approving that row; it is not a rename of this one.
   */
  readonly integration: string;

  /**
   * Ask the vendor about a subject that has ALREADY been narrowed to the
   * contract's allowlist.
   *
   * THE NARROWING IS NOT THIS METHOD'S JOB AND CANNOT BE. `contract.ts` does it
   * before the adapter is reached, so an adapter cannot widen a disclosure by
   * forgetting to filter, and `INV-M10-02`'s failure mode stays closed: nobody
   * decides to leak the new field, somebody adds it to a payload for an
   * unrelated reason and the vendor starts receiving it that afternoon.
   *
   * @throws anything at all. `observe.ts` catches it and the checkout commits.
   */
  assess(subject: EnrichmentSubject, signal: AbortSignal): Promise<EnrichmentAssessment>;
}
