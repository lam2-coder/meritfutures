// =============================================================================
// apps/portal/src/view/disclosure.ts
// =============================================================================
// A REQUIRED DISCLOSURE THE PORTAL CANNOT HAVE WRITTEN, AND THIS FILE IS WHY.
//
// Two of this module's screens carry a disclosure as a compliance obligation
// rather than as copy:
//
//   INV-M4-09  "The simulated-environment disclosure appears in the footer, at
//              checkout entry, on certificates, and on the funded dashboard |
//              Constitution section 6, and it is a compliance obligation rather
//              than a design preference."
//
//   SC-M4-09   "M8's trader-facing surface, WITH THE REQUIRED NFA I-26-12
//              DISCLOSURE." M08:13: "NFA I-26-12 makes a promoter's claims the
//              firm's problem", and M08 `SD-M8-03` makes approval per asset AND
//              per disclosure version, because "NFA I-26-12 requires the
//              disclosure to accompany the claim, and that is a per-creative
//              fact".
//
// -----------------------------------------------------------------------------
// WHY IT IS NOT `CopyBlock`
// -----------------------------------------------------------------------------
// `CopyBlock`'s brand is the literal string 'plan_versions.copy_blocks', and it
// is that specific on purpose: the type's whole job is to make provenance
// checkable. The simulated-environment disclosure and the NFA disclosure are
// LEGAL COPY, published in `content_documents` (`kind = 'legal'`, versioned and
// superseded rather than updated, `checksum` being "what makes 'the page a
// trader accepted' a provable artifact"). Neither is a rule sentence on a plan
// version, and reusing the brand would put a false statement about provenance
// inside the one type nobody would think to check.
//
// -----------------------------------------------------------------------------
// WHAT THE BRAND BUYS AND WHAT IT DOES NOT, STATED RATHER THAN IMPLIED
// -----------------------------------------------------------------------------
// `copyBlock()` reads a key out of a wire response, so its provenance is proven
// by the response. NO CONTRACT ROW SERVES `content_documents` TO THE PORTAL, so
// `disclosureBlock()` takes the document's address as an ARGUMENT and the
// provenance is asserted by the caller rather than proven.
//
// That is weaker and it is said out loud, because a brand that looks like a
// guarantee and is a convention is worse than no brand. What it does buy is
// real and is the failure that actually happens: a required disclosure cannot
// be a literal typed at the point of render, cannot be an empty string, and
// cannot be omitted, since a screen declaring the field required does not
// compile without it. The remaining hole is a caller naming the wrong document,
// which is a diff a reviewer reads.

declare const DISCLOSURE_BRAND: unique symbol;

/**
 * A disclosure sentence that came out of a published legal document.
 *
 * A `string` at runtime with no wrapper, so it renders wherever a string
 * renders and costs nothing at the point of display. The brand exists only
 * during type checking, which is where the mistake it prevents is made.
 */
export type DisclosureBlock = string & {
  readonly [DISCLOSURE_BRAND]: 'content_documents';
};

/**
 * Where a disclosure sentence came from.
 *
 * `content_documents` is versioned and superseded rather than updated, so the
 * pair is the address of one text for all time. Carrying it beside the sentence
 * is what lets a compliance question be answered with a row rather than with a
 * recollection, which is `SD-M9-02`'s `checksum` argument at the render layer.
 */
export type DisclosureSource = {
  /** `content_documents.slug`, on a `kind = 'legal'` row. */
  readonly slug: string;

  /** `content_documents.version`. */
  readonly version: number;
};

/** A disclosure that is absent or blank where a compliance obligation requires one. */
export class MissingDisclosureError extends Error {
  constructor(readonly source: DisclosureSource) {
    super(
      `legal document "${source.slug}" version ${source.version} carries no text ` +
        'for a required disclosure. INV-M4-09 and NFA I-26-12 make these ' +
        'obligations rather than design preferences, so the screen refuses ' +
        'rather than rendering without one: a blank where a required disclosure ' +
        'belongs is the obligation failing silently, which is the only way it ' +
        'fails. The fix is upstream, in the document that should carry the text.',
    );
    this.name = 'MissingDisclosureError';
  }
}

/**
 * Mint a disclosure sentence from the document it was published in.
 *
 * A BLANK STRING IS TREATED AS MISSING, on `copyBlock()`'s precedent and on
 * 0042's `reason_detail` precedent one level down: a column that accepts a
 * space is a column that will hold one, and a disclosure made of one space
 * satisfies every check that only asks whether a value is present.
 */
export function disclosureBlock(source: DisclosureSource, text: string): DisclosureBlock {
  if (text.trim() === '') throw new MissingDisclosureError(source);
  return text as DisclosureBlock;
}
