// =============================================================================
// apps/site/src/render/disclosure.ts
// =============================================================================
// THE TWO DISCLOSURES A PAGE MAY NOT BE MISSING, AND THE LINE BETWEEN PRESENCE
// AND WORDING.
//
// [TOS_CLAUSES](docs/legal/TOS_CLAUSES.md) section 2 draws that line and this
// file does not move it: "**A build check enforces presence, not wording**
// (M09). A surface missing the block fails the build. Wording is counsel's and
// changing it is a versioned content change."
//
// SO THE SIMULATED-ENVIRONMENT TEXT IS NOT IN THIS FILE AND MUST NEVER BE.
// It is a `content_documents` row (SD-M9-02) of kind `legal`, versioned, with a
// checksum, because that is what makes "the page a trader accepted" a provable
// artifact. A constant here would be a fifth copy of a block TOS_CLAUSES
// already says must exist in one canonical form and one canonical short form,
// and "a disclosure that exists in four places and says three different things
// is worse than one that exists in three". What M9 owns is INV-M9-05's
// structural half: the block is attached at the LAYOUT, "so a new page cannot
// omit it by being new", and a page model that reaches the build without one
// fails the build.
//
// THE PAYOUT PAIRING IS THE OPPOSITE CASE AND THE ASYMMETRY IS DELIBERATE.
// AS-M9-06 states the canonical form verbatim inside a frozen plan and calls it
// copy law rather than guidance, and INV-M9-09 makes the omission the defect.
// The wording is therefore carried here as a citation, and the CONTROL is the
// lint below rather than the constant: GS-147 fails "on headline, social card,
// email subject, and OG image", none of which is a place a constant is pasted.
//
// The two legs are not symmetrical in risk and that is why the lint checks both
// directions. Constitution 0 names payout-trust collapse as one of the four
// ways firms die and specifies the mechanism as one late cycle then a
// review-page death spiral. A trader who reads "same day" and sees their bank
// credited on day three has experienced a late cycle, even though nothing was
// late. Merit would have manufactured the exact perception the wallet exists to
// prevent, using a true sentence.
// =============================================================================

/** Which form of the simulated-environment block a surface carries. */
export type DisclosureForm = 'short' | 'full';

/**
 * The simulated-environment block, as it arrives from content.
 *
 * IT CARRIES ITS VERSION BECAUSE INV-M9-03 MAKES THE PAGE CITEABLE and because
 * acceptance is recorded against a version rather than against words ([M3], and
 * SD-M9-02's `checksum`). A block rendered without knowing which version it is
 * cannot be quoted in a dispute, and it will be.
 */
export interface SimulatedEnvironmentDisclosure {
  readonly form: DisclosureForm;
  /** Counsel's words, verbatim, from a `content_documents` row. Never edited here. */
  readonly body: string;
  /** `content_documents.version` of the legal document this block came from. */
  readonly document_version: number;
  /** `content_documents.slug`, so the footer can link to the source clause. */
  readonly document_slug: string;
}

/**
 * INV-M9-05's build check, over the disclosure a page model carries.
 *
 * IT CHECKS PRESENCE AND NON-EMPTINESS AND STOPS THERE. Reading the body for
 * required phrases would be this file deciding what counsel drafted, which
 * TOS_CLAUSES section 2 note 3 puts outside M9 explicitly. A block whose words
 * changed is a versioned content change; a block that is absent is a build
 * failure, and only the second one is checkable from here.
 *
 * The site footer takes the SHORT form on every page (TOS_CLAUSES section 2's
 * inventory). The full form is checkout's, which is [M3](M03)'s origin and not
 * this one, so a full-form block reaching a public page is accepted rather than
 * refused: it is more disclosure than required, and a check that rejected it
 * would be enforcing wording under another name.
 */
export function assertSimulatedDisclosurePresent(
  disclosure: SimulatedEnvironmentDisclosure | null,
  surface: string,
): asserts disclosure is SimulatedEnvironmentDisclosure {
  if (disclosure === null || disclosure.body.trim() === '') {
    throw new DisclosureError(
      `INV-M9-05: ${surface} reached the build with no simulated-environment ` +
        'disclosure. The block is attached at the layout so that a new page ' +
        'cannot omit it by being new, and this page did.',
    );
  }
}

// -----------------------------------------------------------------------------
// The two payout legs
// -----------------------------------------------------------------------------

/**
 * AS-M9-06's canonical form, quoted from the frozen plan.
 *
 * This is the sentence, not a template: "The two legs are always named
 * together, in the same sentence, at the same weight" (INV-M9-09). The
 * two-to-three business days is [ADR-042](docs/decisions/ADR-042.md)'s unit,
 * which Merit QUOTES and never computes, so nothing here derives it from a
 * calendar.
 *
 * A surface that needs different words does not get them by editing this
 * constant. It writes them and passes them through {@link payoutCopyOmitsALeg},
 * which is the control.
 */
export const CANONICAL_PAYOUT_COPY =
  'Payouts land in your Merit Wallet the same day you request them. ' +
  'Withdrawing from your wallet to your bank takes 2 to 3 business days.';

/**
 * GS-147. Whether a piece of payout copy names one leg without the other.
 *
 * WHAT IT IS AND WHAT IT IS NOT. It is a keyword lint over prose, in the same
 * family as VG-M9-2 and with the same honest ceiling: it can see that a
 * sentence talks about one leg and not the other, and it cannot see whether the
 * two were given "the same weight". Weight is a review item on [M08](M08)
 * creative approval, and saying so here is better than implying this function
 * covers it.
 *
 * It returns `false` for copy that mentions NEITHER leg. A headline about
 * something else is not payout copy, and a lint that fired on every sentence in
 * the estate would be turned off within a week, which is a worse outcome than
 * the narrow one.
 */
export function payoutCopyOmitsALeg(text: string): boolean {
  const internal = mentionsInternalLeg(text);
  const external = mentionsExternalLeg(text);
  return internal !== external;
}

/**
 * The wallet credit.
 *
 * BOTH HALVES ARE REQUIRED, and the immediacy half is a vocabulary rather than
 * a phrase. AS-M9-06's adversary is "Merit's own marketing instinct", and that
 * instinct does not write "same day" when "today", "instantly" or "in minutes"
 * is available. A detector that only knew the canonical wording would pass
 * every headline that avoided it, which is every headline the scenario is
 * about.
 *
 * The `wallet` half is what keeps it from firing on support and provisioning
 * copy, which are the two other places in the estate that promise speed.
 */
function mentionsInternalLeg(text: string): boolean {
  const lowered = text.toLowerCase();
  const immediacy = /same[ -]day|today|instant|immediate|right away|within minutes|in minutes/;
  return lowered.includes('wallet') && immediacy.test(lowered);
}

/**
 * The bank withdrawal. Both halves are required: `withdraw` on its own is
 * ambiguous between the two legs, which is precisely the ambiguity AS-M9-06 is
 * about, and a lint that accepted it would pass the copy it exists to catch.
 */
function mentionsExternalLeg(text: string): boolean {
  const lowered = text.toLowerCase();
  const withdrawal = /withdraw|withdrawal/.test(lowered);
  const bankLeg = /bank|business day/.test(lowered);
  return withdrawal && bankLeg;
}

/** Thrown by the disclosure build checks. Named so a build can report which. */
export class DisclosureError extends Error {
  override readonly name = 'DisclosureError';
}
