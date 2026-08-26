// =============================================================================
// packages/affiliate/src/attribution.ts
// =============================================================================
// M08 SECTION 3.1's FLOWCHART, AS A TOTAL FUNCTION OVER VALUES THE CALLER
// ALREADY READ.
//
//   explicit code at checkout?  -> code override, affiliate from the code
//   click token within 30 days? -> last touch, most recent click
//   neither                     -> no attribution
//   then, on either arm:  buyer linked to the affiliate  -> voided, flag raised
//
// -----------------------------------------------------------------------------
// TWO PROPERTIES OF SECTION 3.1 ARE LOAD BEARING AND BOTH ARE STRUCTURAL HERE
// -----------------------------------------------------------------------------
// "RESOLUTION HAPPENS AT CHECKOUT START, in the same step that pins the plan
// version, so an affiliate cannot be added or changed after the buyer has seen
// a price." This function takes no connection and opens nothing, so it cannot
// run anywhere but where its caller runs it, which is inside the checkout
// transaction. That is `packages/ledger`'s argument about `postTransaction`
// applied one table over: a library that could reach a pool is a library that
// can lose the consequence at every call site that forgets.
//
// "AND IT HAPPENS ONCE": `attributions.purchase_id` is `uuid NOT NULL UNIQUE`
// (`0012_disputes_and_affiliate_settlement.sql:78`) and nothing rewrites it.
// This fold therefore emits a row to INSERT and has no shape for an update.
// INV-M8-01 is the database's, and this file does not re-implement it.
//
// -----------------------------------------------------------------------------
// THE ORDER IS THE INVARIANT AND NOT A PREFERENCE
// -----------------------------------------------------------------------------
// INV-M8-02: "Attribution resolves CODE OVERRIDE FIRST, THEN LAST-TOUCH CLICK
// WITHIN 30 DAYS", and its enforcement column says why it is written down at
// all: "An ambiguous rule is a rule two affiliates will both claim." M08
// section 3.1 adds that the rule "needs to be published to affiliates
// verbatim, because the alternative is two affiliates each believing they
// earned the same sale, which is an argument with no factual resolution."
//
// SO A TYPED CODE BEATS A LIVE CLICK EVEN WHEN THE CLICK IS NEWER, and the
// suite asserts exactly that case rather than only the easy one.
//
// -----------------------------------------------------------------------------
// THE LITERAL SELF-DEAL IS ARITHMETIC AND THE DATABASE ALREADY REFUSES IT
// -----------------------------------------------------------------------------
// `attributions_literal_self_deal_is_void` is
//
//   CHECK (buyer_identity_id <> affiliate_identity_id OR voided = true)
//
// (`0012_disputes_and_affiliate_settlement.sql:116`). This fold AGREES WITH
// THAT CONSTRAINT OR THE DATABASE REFUSES THE ROW, which is the only reason
// the agreement is worth asserting in a test: the constraint is the control
// and this function is the thing that must not hand it a row it will reject.
//
// IT IS VOIDED RATHER THAN DROPPED, and `0012` says why in its own words:
// "Voiding rather than deleting, because THE ATTEMPT IS THE SIGNAL." B4 #16
// and INV-M8-03. A dropped row leaves an affiliate who tried to buy through
// their own link indistinguishable from one who never tried.
//
// `self_deal_link_confidence_bp` IS NULL ON THE LITERAL CASE AND THAT IS THE
// DDL's INSTRUCTION RATHER THAN THIS FILE'S CHOICE: "it is null when the two
// identities are literally the same row, because that case needs no score."
//
// -----------------------------------------------------------------------------
// THE SCORED SELF-DEAL TAKES ITS SCORE AS AN ARGUMENT, AND THE PRODUCER DOES
// NOT EXIST YET. THAT IS SAID HERE RATHER THAN IMPLIED BY A DEFAULT.
// -----------------------------------------------------------------------------
// INV-M8-03 voids "a purchase by an identity LINKED TO THE AFFILIATE ABOVE THE
// CONFIGURED CONFIDENCE", and its enforcement column says "the check runs at
// attribution time using M07's resolver". `D-16` (M07 section 3.2, ADR-022) is
// that resolver and there is no such code in this workspace today.
//
// So `linkConfidence` is an explicit parameter and `null` is a MEASUREMENT
// RATHER THAN A VERDICT: it means no resolver ran, not that the two identities
// are unrelated. A default of zero would have been a fold that quietly
// asserts every buyer is arm's length, which is the direction INV-M8-03 exists
// to stop.
//
// THE CEILING IS THE CALLER'S AND IS NEVER A CONSTANT HERE. The standing
// parameter-status ruling makes every configured value a row rather than a
// literal, and a self-deal ceiling compiled into a library is a value nobody
// can move without a deploy.
//
// -----------------------------------------------------------------------------
// NO COMMISSION IS COMPUTED IN THIS FILE AND NONE MAY BE
// -----------------------------------------------------------------------------
// P3 section 12: "`P3-n` writes the attribution and no commission." The
// commission clock (`M08-6`), the clawback (`M08-7`) and the statement are
// P5's with the rest of the payout rail, and `affiliate_commissions` is not
// even registered in the scope registry: session 215 measured that its only
// path to an identity is `attribution_id`, and a derivation chain terminates
// at `owned` or at `root` or it does not terminate.
// =============================================================================

/**
 * The 30 day last-touch window, in whole days.
 *
 * INV-M8-02, M08 section 3.1's flowchart, and SD-M8-02's own justification for
 * the four columns it adds. It is a CONSTANT here rather than a parameter for
 * one reason and the reason is stated because the opposite convention governs
 * the ceiling three paragraphs up: M08 section 7's AS-M8-03 rules the window
 * fixed on a commercial argument that has already been taken. "A shorter
 * window would be the obvious fix and IS THE WRONG ONE. A 30 day cookie is the
 * industry norm and cutting it punishes legitimate content affiliates whose
 * readers take weeks to decide. Detect the pattern; do not degrade the product
 * for everyone."
 *
 * A future session that wants this configurable is re-opening that ruling and
 * should say so.
 */
export const LAST_TOUCH_WINDOW_DAYS = 30;

/** {@link LAST_TOUCH_WINDOW_DAYS} in milliseconds, which is what the fold compares. */
export const LAST_TOUCH_WINDOW_MS = LAST_TOUCH_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * `attributions.model`'s CHECK list, closed by the schema.
 *
 * `0012_disputes_and_affiliate_settlement.sql:81`:
 * `model text NOT NULL CHECK (model IN ('last_touch', 'code_override'))`.
 * A third member is a migration before it is a type change, which is `PspId`'s
 * own reasoning one package over.
 */
export type AttributionModel = 'last_touch' | 'code_override';

/**
 * An affiliate, as this fold needs to see one.
 *
 * BOTH IDENTIFIERS ARE CARRIED AND NEITHER IS DERIVED FROM THE OTHER.
 * `attributions` stores `affiliate_id` AND `affiliate_identity_id`, and `0012`
 * states why both are stored rather than joined: the row is "a statement about
 * the two of them AT THE MOMENT OF PURCHASE, and an affiliate can be
 * reassigned or an identity merged afterwards". A fold that took only the
 * affiliate id would have to join to write the row, and the join would be
 * answering the question at a later moment than the one being recorded.
 */
export interface AffiliateRef {
  /** `affiliates.id`. */
  readonly affiliateId: string;
  /** `affiliates.identity_id`, read at this moment. */
  readonly identityId: string;
}

/**
 * One `affiliate_clicks` row, as this fold needs to see one.
 *
 * `id` is a `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
 * (`0005_affiliate_program.sql:157`), so it is a `bigint` here and never a
 * `number`. `attributions.click_id` is the `bigint NULL` that references it.
 */
export interface ClickRef {
  /** `affiliate_clicks.id`. */
  readonly clickId: bigint;
  /** The affiliate the click belongs to. A click belongs to the affiliate. */
  readonly affiliate: AffiliateRef;
  /** `affiliate_clicks.clicked_at`. */
  readonly clickedAt: Date;
}

/**
 * M07's `D-16` verdict about this buyer and this affiliate, when one was taken.
 *
 * See this file's header: `null` on the whole field means NO RESOLVER RAN and
 * never means "unrelated".
 */
export interface LinkConfidence {
  /** The link-graph score, basis points. `0012` CHECKs it BETWEEN 0 AND 10000. */
  readonly bp: number;
  /** The configured ceiling, basis points. Strictly above it voids. */
  readonly ceilingBp: number;
}

/** Everything the fold reads. Nothing here comes from a request body untouched. */
export interface AttributionInput {
  /** `purchases.identity_id`, the RESOLVED identity and never the email. */
  readonly buyerIdentityId: string;
  /**
   * The affiliate a typed code names, or `null`.
   *
   * IT IS NOT THE CODE AND IT IS NOT THE COUPON. The caller resolves
   * `coupons.code` to `coupons.affiliate_id` to an `affiliates` row before it
   * gets here, because `coupons.affiliate_id` is NULLABLE and most codes name
   * no affiliate at all: a launch code is an offer Merit makes and not a
   * referral. A code that resolves to no affiliate arrives here as `null` and
   * falls through to last touch, which is the correct answer rather than a
   * missing branch.
   */
  readonly codeAffiliate: AffiliateRef | null;
  /**
   * The most recent click the presented token resolved to, or `null`.
   *
   * THE CALLER PICKS THE MOST RECENT ONE AND THIS FOLD DOES NOT SORT. M08
   * section 3.1 says "last touch, MOST RECENT CLICK", and
   * `affiliate_clicks_token_uq` makes a token name exactly one row, so
   * "most recent" is a property of which token the buyer is carrying rather
   * than of a set this function was handed.
   */
  readonly click: ClickRef | null;
  /** Checkout time. Taken as an argument: see the manifest's note on clocks. */
  readonly at: Date;
  /** M07's verdict, or `null` for "no resolver ran". */
  readonly linkConfidence: LinkConfidence | null;
}

/**
 * Why a purchase carries no attribution. Closed, and every member is a reason
 * rather than an absence.
 *
 * There is no `unknown` member and there must not be one: this fold is total
 * over its input, so a purchase with no attribution has a reason that can be
 * named, and a reason that cannot be named is a branch somebody forgot.
 */
export type NoAttributionReason =
  /** Neither a code nor a click. The ordinary organic sale. */
  | 'no_code_and_no_click'
  /** A click exists and it is older than the window. */
  | 'click_outside_last_touch_window';

/**
 * The row to INSERT into `attributions`, in this fold's terms.
 *
 * EVERY FIELD THE DDL DECLARES NOT NULL IS NON-NULLABLE HERE, and the two the
 * DDL leaves nullable are nullable here for the DDL's own stated reasons. A
 * shape that could not be written is a shape this fold must not be able to
 * produce.
 */
export interface AttributionRow {
  /** `attributions.affiliate_id`. */
  readonly affiliateId: string;
  /** `attributions.model`. */
  readonly model: AttributionModel;
  /** `attributions.click_id`. Null on a code override with no click. */
  readonly clickId: bigint | null;
  /** `attributions.buyer_identity_id`. SD-M8-05. */
  readonly buyerIdentityId: string;
  /** `attributions.affiliate_identity_id`. SD-M8-05. */
  readonly affiliateIdentityId: string;
  /** `attributions.voided`. */
  readonly voided: boolean;
  /**
   * `attributions.void_reason`.
   *
   * `attributions_void_is_explained` CHECKs `voided = false OR void_reason IS
   * NOT NULL`, so a voided row without a reason is refused by the database.
   * The two are produced together below and never separately.
   */
  readonly voidReason: string | null;
  /** `attributions.self_deal_link_confidence_bp`. SD-M8-05. */
  readonly selfDealLinkConfidenceBp: number | null;
}

/**
 * What the fold decided. Two arms, and `'none'` writes no row at all.
 *
 * A VOIDED ROW IS AN `'attributed'` DECISION AND NOT A `'none'` ONE, which
 * reads backwards for exactly one second and is the point: `'none'` means
 * nothing happened and no row is written, while a void is a row that records
 * that something DID happen and was refused. SD-M8-05's whole argument is that
 * "the self-deal check must record WHAT IT FOUND, not only its verdict, or an
 * argument about a voided commission has no evidence on either side."
 */
export type AttributionDecision =
  | { readonly kind: 'none'; readonly reason: NoAttributionReason }
  | { readonly kind: 'attributed'; readonly row: AttributionRow };

/** The void reason written when the buyer and the affiliate are one identity. */
export const LITERAL_SELF_DEAL_VOID_REASON = 'literal_self_deal';

/** The void reason written when M07's score is strictly above the ceiling. */
export const LINKED_SELF_DEAL_VOID_REASON = 'linked_self_deal_over_ceiling';

/**
 * Resolve attribution for one purchase. M08 section 3.1, in its own order.
 *
 * TOTAL, PURE AND SYNCHRONOUS. It reads no clock, opens no connection and
 * throws only on an input the schema could not have produced. The caller runs
 * it inside the checkout transaction and writes the row it returns.
 */
export function resolveAttribution(input: AttributionInput): AttributionDecision {
  const { buyerIdentityId, codeAffiliate, click, at, linkConfidence } = input;

  if (buyerIdentityId === '') {
    throw new AttributionError('a buyer identity is required; `purchases.identity_id` is NOT NULL');
  }
  if (linkConfidence !== null) assertBasisPoints(linkConfidence);

  // Branch 1. THE TYPED CODE WINS, INCLUDING OVER A NEWER CLICK. INV-M8-02.
  if (codeAffiliate !== null) {
    // `click_id` is recorded ONLY when the click belongs to the affiliate the
    // code named. A click from a DIFFERENT affiliate is not this attribution's
    // evidence, and recording it would put one affiliate's click id on another
    // affiliate's row, which is the ambiguity INV-M8-02 exists to remove.
    const clickId =
      click !== null && click.affiliate.affiliateId === codeAffiliate.affiliateId
        ? click.clickId
        : null;
    return attribute(codeAffiliate, 'code_override', clickId, buyerIdentityId, linkConfidence);
  }

  // Branch 2. LAST TOUCH, WITHIN THE WINDOW.
  if (click !== null) {
    if (!withinLastTouchWindow(click.clickedAt, at)) {
      return { kind: 'none', reason: 'click_outside_last_touch_window' };
    }
    return attribute(click.affiliate, 'last_touch', click.clickId, buyerIdentityId, linkConfidence);
  }

  // Branch 3. Neither.
  return { kind: 'none', reason: 'no_code_and_no_click' };
}

/**
 * Is this click inside the window?
 *
 * THE COMPARISON IS INCLUSIVE AT THE BOUNDARY AND EXCLUSIVE PAST IT, and a
 * click in the FUTURE is inside the window rather than refused: a clock skew
 * between the click handler and the checkout handler is not the buyer's fault
 * and this function is not the place a skew is detected.
 */
export function withinLastTouchWindow(clickedAt: Date, at: Date): boolean {
  return at.getTime() - clickedAt.getTime() <= LAST_TOUCH_WINDOW_MS;
}

/** Raised on an input the schema could not have produced. */
export class AttributionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttributionError';
  }
}

function assertBasisPoints(confidence: LinkConfidence): void {
  for (const [name, value] of [
    ['bp', confidence.bp],
    ['ceilingBp', confidence.ceilingBp],
  ] as const) {
    if (!Number.isInteger(value) || value < 0 || value > 10000) {
      throw new AttributionError(
        `\`${name}\` is ${String(value)}; ` +
          '`self_deal_link_confidence_bp` is CHECKed BETWEEN 0 AND 10000 and basis points are integers',
      );
    }
  }
}

/**
 * Build the row, then apply the two self-deal checks in the order the schema
 * cares about.
 *
 * THE LITERAL CHECK RUNS FIRST AND UNCONDITIONALLY, because it is the one the
 * database enforces and it needs no score. The scored check runs after and
 * only when a score was supplied.
 */
function attribute(
  affiliate: AffiliateRef,
  model: AttributionModel,
  clickId: bigint | null,
  buyerIdentityId: string,
  linkConfidence: LinkConfidence | null,
): AttributionDecision {
  const base = {
    affiliateId: affiliate.affiliateId,
    model,
    clickId,
    buyerIdentityId,
    affiliateIdentityId: affiliate.identityId,
  } as const;

  // `attributions_literal_self_deal_is_void`. Arithmetic, not a judgment, and
  // the confidence stays null because that case needs no score.
  if (buyerIdentityId === affiliate.identityId) {
    return {
      kind: 'attributed',
      row: {
        ...base,
        voided: true,
        voidReason: LITERAL_SELF_DEAL_VOID_REASON,
        selfDealLinkConfidenceBp: null,
      },
    };
  }

  // INV-M8-03's graded half. STRICTLY ABOVE the ceiling: a score AT the
  // ceiling is the configured tolerance rather than a breach of it, which is
  // the reading `identity_signals`' own tiers use for the hard-link ceiling.
  if (linkConfidence !== null && linkConfidence.bp > linkConfidence.ceilingBp) {
    return {
      kind: 'attributed',
      row: {
        ...base,
        voided: true,
        voidReason: LINKED_SELF_DEAL_VOID_REASON,
        selfDealLinkConfidenceBp: linkConfidence.bp,
      },
    };
  }

  // Attributed. The score is RECORDED EVEN WHEN IT DID NOT VOID, which is what
  // `attributions_self_deal_review_idx` reads: it is a partial index over
  // `self_deal_link_confidence_bp IS NOT NULL AND voided = false`, and `0012`
  // calls it "the self-deal review queue: scored but not yet voided". An
  // attributed row that dropped its score would empty that queue silently.
  return {
    kind: 'attributed',
    row: {
      ...base,
      voided: false,
      voidReason: null,
      selfDealLinkConfidenceBp: linkConfidence === null ? null : linkConfidence.bp,
    },
  };
}
