// =============================================================================
// apps/portal/src/view/referrals.ts
// =============================================================================
// SC-M4-09, THE REFERRAL PANEL. M04 section 3.1's one thing it must get right:
// "M8's trader-facing surface, WITH THE REQUIRED NFA I-26-12 DISCLOSURE."
//
// -----------------------------------------------------------------------------
// THE DISCLOSURE IS A REQUIRED PROP, WHICH IS THE ONLY VERSION OF "REQUIRED"
// THAT SURVIVES A REDESIGN
// -----------------------------------------------------------------------------
// M08:13: "NFA I-26-12 makes a promoter's claims the firm's problem", and
// `SD-M8-03` makes creative approval per asset AND per disclosure version
// because "NFA I-26-12 requires the disclosure to accompany the claim, and that
// is a per-creative fact". This panel is where a trader is invited to become
// that promoter, so it is the first place the disclosure has to accompany the
// invitation rather than sit two pages away in a terms document.
//
// `disclosure` is therefore a `DisclosureBlock` field on the view and not an
// optional footer: a panel rendered without it does not compile, in the idiom
// INV-M4-02 uses for `as_of_trading_day` and INV-M4-11 uses for `tier`. See
// ./disclosure.ts for what the brand buys and what it does not.
//
// -----------------------------------------------------------------------------
// THE PANEL SHOWS NUMBERS AND MAKES NO CLAIM ABOUT THEM
// -----------------------------------------------------------------------------
// M08 AS-M8-04 is a whole scenario about an affiliate publishing "guaranteed
// payouts at Merit" or fabricated earnings, and this is the surface a trader
// reads before they publish anything. So the panel renders `GET /affiliate/
// stats` and nothing else: no projection, no "you could earn", no lifetime
// extrapolation. There is no field on any type below that such a sentence could
// be written into, which is the same structural move the calendar panel makes
// against a news-window warning.
//
// -----------------------------------------------------------------------------
// INV-M4-01: EVERY NUMBER GOES STRAIGHT THROUGH A FORMATTER
// -----------------------------------------------------------------------------
// The tempting arithmetic on this panel is a conversion rate: conversions
// divided by clicks. THAT IS NOT A MONEY FIELD AND IT IS STILL NOT COMPUTED
// HERE, because M08 owns what a conversion rate means (a click attributed under
// last touch, a purchase that may charge back for months) and a ratio the
// portal invented would be a second definition of a number M12 publishes under
// a method page. The two counts are rendered as counts.
//
// `chargeback_rate_bp` is the firm's own basis-point figure and goes through
// `formatBasisPoints`, which is the only permitted consumer of a `_bp` field.

import type { AffiliateStats } from '../api/types.ts';
import { formatBasisPoints, formatCents } from '../format/money.ts';
import type { DisclosureBlock } from './disclosure.ts';

/**
 * The 30 day activity counts, as COUNTS.
 *
 * Both windows are the server's, named in the field, and the window is part of
 * the number rather than a caption beside it: a count whose window is stated
 * somewhere else is a count that gets quoted without one.
 */
export type ReferralActivityView = {
  readonly clicks_30d: number;
  readonly conversions_30d: number;
};

/**
 * The three money figures, formatted and never combined.
 *
 * `payable` IS NOT `earned` MINUS `paid` AND IS NOT COMPUTED THAT WAY HERE.
 * M08:13: "Commission is the only outflow in Merit that is paid on a promise
 * rather than on a settled fact, because a purchase can charge back for months
 * after the commission is payable." So earned, payable and paid are three
 * independent server answers with a clawback window between them, and the
 * subtraction that looks like it would reconcile them is both arithmetic on a
 * money field (INV-M4-01) and wrong.
 */
export type ReferralEarningsView = {
  readonly earned_lifetime: string;

  /** Earned, past its clawback window, and not yet paid. The server's own figure. */
  readonly payable: string;
  readonly paid_lifetime: string;
};

/** SC-M4-09. M08's trader-facing surface. */
export type ReferralPanelView = {
  /** The affiliate's own code. The address a click is attributed to. */
  readonly code: string;

  /** The commission rate, in basis points, formatted. */
  readonly commission: string;

  /** `affiliates.status`, as the server sent it. The portal decides no lifecycle. */
  readonly status: string;
  readonly activity: ReferralActivityView;
  readonly earnings: ReferralEarningsView;

  /** The firm's figure. Shown because a rising one is the affiliate's problem too. */
  readonly chargeback_rate: string;

  /** NFA I-26-12. A required field that cannot be authored in this module. */
  readonly disclosure: DisclosureBlock;
};

/**
 * The referral panel, from the wire.
 *
 * NOTHING IS HIDDEN WHEN IT IS ZERO. An affiliate with no clicks sees zero
 * clicks rather than an empty panel, on the calendar panel's reasoning one file
 * over: an empty surface and a surface that has not loaded look identical, and
 * the second is the one that gets refreshed forever.
 */
export function toReferralPanel(
  stats: AffiliateStats,
  disclosure: DisclosureBlock,
): ReferralPanelView {
  return {
    code: stats.code,
    commission: formatBasisPoints(stats.commission_bp),
    status: stats.status,
    activity: {
      clicks_30d: stats.clicks_30d,
      conversions_30d: stats.conversions_30d,
    },
    earnings: {
      earned_lifetime: formatCents(stats.earned_cents_lifetime),
      payable: formatCents(stats.payable_cents),
      paid_lifetime: formatCents(stats.paid_cents_lifetime),
    },
    chargeback_rate: formatBasisPoints(stats.chargeback_rate_bp),
    disclosure,
  };
}

// =============================================================================
// THE CREATIVE SUBMISSION, AND THE ONE PLACE THIS SCREEN COULD BE WRONG IN THE
// COMPLIANCE DIRECTION
// =============================================================================
// SC-M4-09 is "M8's trader-facing surface", and M08 section 4 rows
// `POST /affiliate/creatives` as NEW and owned by M08. Its response is the
// second thing this screen renders, and it is the thing that has to be got
// right, because the disclosure IS the compliance artifact on this screen.
//
// -----------------------------------------------------------------------------
// M08's PROSE AND THE DATABASE DISAGREE, AND ADR-113 PICKED THE DATABASE
// -----------------------------------------------------------------------------
// M08:160 describes the endpoint as one that "returns the current required
// disclosure text so the affiliate can attach it before submitting rather than
// after being rejected", which reads as though a submission PINS a disclosure.
// IT DOES NOT. `affiliate_creatives.disclosure_version_id` is `uuid NULL`
// (0005_affiliate_program.sql:126) and the constraint that binds it is
//
//   affiliate_creatives_approved_has_disclosure
//     CHECK (status <> 'approved' OR disclosure_version_id IS NOT NULL)
//
// (0005_affiliate_program.sql:140), which binds the disclosure to APPROVAL and
// says nothing at all about a `pending` row. So a fresh submission carries no
// disclosure, and API_CONTRACT section 7 names the response field
// `required_disclosure`, in ADR-113 clause 2's own words, "so nobody reads it
// as a pin".
//
// -----------------------------------------------------------------------------
// SO THE VIEW HAS NO FIELD AN ATTACHED DISCLOSURE COULD BE WRITTEN INTO
// -----------------------------------------------------------------------------
// This is the same structural move the panel above makes against a projection
// sentence, pointed at the failure that actually costs something here. A view
// that carried `disclosure` beside a `pending` creative would render the text
// in the slot a reader takes to mean "this is what this creative carries", and
// a screen that says so is wrong on the one surface where being wrong about a
// disclosure is a compliance finding rather than a display bug.
//
// There is therefore exactly ONE disclosure field on `CreativeSubmissionView`,
// it is named for the moment the requirement lands rather than for the
// document, and there is no `disclosure`, no `disclosure_version_id` and no
// `attached` anywhere below. `toCreativeSubmission` has no branch that could
// produce one, because `CreateCreativeResponse` carries no such field to read.
//
// -----------------------------------------------------------------------------
// WHY THIS IS NOT A `DisclosureBlock`, WHICH IS A PROVENANCE FACT AND NOT STYLE
// -----------------------------------------------------------------------------
// `DisclosureBlock`'s brand is the literal string 'content_documents', and
// ./disclosure.ts is that specific on purpose. The required disclosure on this
// response is a DIFFERENT ROW IN A DIFFERENT TABLE: `disclosure_version_id`
// references `tos_versions(id)` (0005_affiliate_program.sql:126, and
// tos_versions is created in 0004_catalog.sql:230), and the contract's field
// carries `tos_version_id` by that name. Minting it as a `DisclosureBlock`
// would put a false statement about provenance inside the one type nobody
// would think to check, which is the exact reason disclosure.ts refuses to
// reuse `CopyBlock`.
//
// The brand is not needed here either, and that is worth saying rather than
// implying. `DisclosureBlock` exists because no contract row serves
// `content_documents` to the portal, so a sentence typed at the point of render
// would otherwise be indistinguishable from a published one. This text arrives
// ON THE WIRE, so its provenance is proven by the response in `copyBlock()`'s
// sense. What survives from disclosure.ts is the blank check, and it is kept:
// a required disclosure made of one space satisfies every check that only asks
// whether a value is present.

/**
 * `POST /affiliate/creatives`. API_CONTRACT section 7, transcribed.
 *
 * THIS SHAPE BELONGS IN `../api/types.ts` BESIDE `AffiliateStats` AND IS HERE
 * INSTEAD, which is a fence fact rather than a design one and is recorded so
 * the next session moves it rather than re-deriving why it is odd. That file is
 * a shared transcription surface with its own contract test carrying a
 * hand-maintained `TRANSCRIBED` list, and it was not in this session's fence.
 * Whoever moves it owns adding `CreateCreativeResponse` to that list.
 *
 * `creative` CARRIES NO `disclosure_version_id` AND THAT IS THE CONTRACT'S
 * DOING, not a partial transcription: the response type in API_CONTRACT section
 * 7 declares five fields on `creative` and none of them is the disclosure.
 * `status` is the literal `'pending'` there too, because this endpoint is the
 * only thing that writes the row and `affiliate_creatives.status` DEFAULTs to
 * `pending`.
 */
export type CreateCreativeResponse = {
  readonly creative: {
    readonly creative_id: string;
    readonly kind: string;
    readonly url_or_ref: string;
    readonly status: 'pending';
    readonly submitted_at: string;
  };

  /** The disclosure the review WILL require. Not one this row carries. */
  readonly required_disclosure: {
    /** `tos_versions.id`, and NOT a `content_documents` address. */
    readonly tos_version_id: string;
    readonly version: string;
    readonly text: string;
  };
};

/**
 * A required disclosure that arrived blank where the obligation needs text.
 *
 * THE `tos_version_id` IS ASSIGNED IN THE BODY AND NOT DECLARED AS A PARAMETER
 * PROPERTY, which is a runtime fact rather than a style choice. ADR-083 rules
 * that every deployable runs under `node --experimental-strip-types`, and that
 * mode refuses a parameter property outright: `SyntaxError
 * [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript parameter property is not
 * supported in strip-only mode`. Measured on this branch.
 *
 * `./disclosure.ts`'s `MissingDisclosureError` uses the parameter-property form
 * and therefore cannot be loaded that way today. That file is another session's
 * to change and this one does not touch it; the finding is reported rather than
 * repaired here, and this class simply does not add a second instance of it.
 */
export class MissingRequiredDisclosureError extends Error {
  readonly tosVersionId: string;

  constructor(tosVersionId: string) {
    super(
      `the required disclosure on tos_versions row "${tosVersionId}" carries no ` +
        'text. NFA I-26-12 makes this an obligation rather than a design ' +
        'preference, and INV-M8-08 makes it per creative, so the screen refuses ' +
        'rather than inviting a trader to publish a claim under a blank ' +
        'disclosure. The fix is upstream, in the version that should carry the ' +
        'text.',
    );
    this.name = 'MissingRequiredDisclosureError';
    this.tosVersionId = tosVersionId;
  }
}

/**
 * WHAT THE REVIEW WILL REQUIRE. Never what a row already carries.
 *
 * The type name and the field name on the view both say "required" rather than
 * naming the document, because the only mistake available on this screen is
 * reading it as attached.
 */
export type RequiredDisclosureView = {
  readonly tos_version_id: string;
  readonly version: string;
  readonly text: string;
};

/**
 * One submitted creative, at `pending`, with nothing attached to it.
 *
 * THE ABSENCES ARE THE CONTROL. There is no `disclosure`, no
 * `disclosure_version_id`, no `attached` and no `approved_with`. A screen
 * cannot render a disclosure as belonging to this creative because there is no
 * field on this type that would mean that.
 */
export type CreativeSubmissionView = {
  readonly creative_id: string;

  /** One of `affiliate_creatives`' five CHECK members, as the server sent it. */
  readonly kind: string;
  readonly url_or_ref: string;

  /** `pending`, as the server sent it. The portal decides no lifecycle. */
  readonly status: string;
  readonly submitted_at: string;

  /**
   * The disclosure Merit's review will require, in the version in force when
   * the response was read.
   *
   * IT IS NOT ATTACHED TO THE CREATIVE ABOVE AND THE FIELD NAME IS THE ONLY
   * PLACE THAT CAN SAY SO IN A TYPE. The row's own `disclosure_version_id` is
   * NULL at `pending` and stays NULL until an operator approves it.
   */
  readonly disclosure_required_at_approval: RequiredDisclosureView;
};

/**
 * The creative submission, from the wire.
 *
 * THERE IS NO BRANCH IN THIS FUNCTION AND THERE CANNOT BE. `CreateCreativeResponse`
 * has one disclosure field, it is the required one, and the creative half of
 * the response carries none. So the only shape this constructor can produce is
 * the shape where the disclosure is a requirement rather than a possession, and
 * that is a property of the contract rather than a discipline this file keeps.
 */
export function toCreativeSubmission(response: CreateCreativeResponse): CreativeSubmissionView {
  const required = response.required_disclosure;
  if (required.text.trim() === '')
    throw new MissingRequiredDisclosureError(required.tos_version_id);

  return {
    creative_id: response.creative.creative_id,
    kind: response.creative.kind,
    url_or_ref: response.creative.url_or_ref,
    status: response.creative.status,
    submitted_at: response.creative.submitted_at,
    disclosure_required_at_approval: {
      tos_version_id: required.tos_version_id,
      version: required.version,
      text: required.text,
    },
  };
}
