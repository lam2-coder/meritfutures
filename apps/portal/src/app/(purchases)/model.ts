// =============================================================================
// apps/portal/src/app/(purchases)/model.ts
// =============================================================================
// THE PAGE MODELS FOR SC-M4-06 AND SC-M4-08, AND THE ONE CONTROL THAT IS THIS
// SEGMENT'S REASON FOR EXISTING.
//
// The two view modules one directory up already turn a wire shape into a
// render-ready shape. This file does the second half a page needs and neither of
// them can do alone: it PAIRS the reads, it decides what a screen may put on a
// surface, and it says so as a type rather than as a habit.
//
// =============================================================================
// PART ONE. WHAT A CERTIFICATE MAY CARRY, ESTABLISHED FROM THE CORPUS
// =============================================================================
// A certificate is the only artifact this application renders that is designed
// to leave it. `certificates` lives in `0020_public_surface.sql`, the verify
// page is unauthenticated (M11 section 4, `GET /verify/:code` NEW, public), and
// AS-M4-03's whole subject is what happens to the artifact after it is shared.
// So "what may this screen render" is a real question here and is not one
// anywhere else in this app.
//
// THE CORPUS SETTLES IT AND IT IS SETTLED IN TWO PLACES THAT AGREE.
//
//   INV-M11-01  "A certificate's claims are MINIMAL: the account's plan, size,
//               trading day, the kind-specific value, and nothing else | Claim
//               schema per kind, validated at issuance. No identity, no email,
//               no display name, no cumulative total, no lifetime figure."
//
//   AS-M4-03 rule 3  "Claims are minimal by construction: no identity, no
//               email, no cumulative totals. A certificate is a fact about an
//               account on a day, and the smaller the claim, the less there is
//               to forge usefully."
//
// M11's governing sentence is the same rule stated as a warning about this file:
// "a certificate is a small, signed, revocable claim about one account on one
// day, and EVERY TEMPTATION IN THIS MODULE IS A TEMPTATION TO MAKE IT BIGGER
// THAN THAT."
//
// -----------------------------------------------------------------------------
// SO THE CONTROL IS AN ALLOWLIST AT THE BOUNDARY AND NOT A REDACTION PASS
// -----------------------------------------------------------------------------
// `publishedCertificate()` below CONSTRUCTS its result field by field from a
// closed list. It does not spread, it does not copy an object and delete keys,
// and it does not filter. The difference is what happens on the day somebody
// adds a field to `CertificateView`: a spread carries the new field onto a
// public artifact by default and a reviewer has to notice, and this refuses to
// carry it until somebody writes its name here. A redaction pass is a denylist
// wearing an allowlist's clothes, and a denylist is wrong about every field
// invented after it was written.
//
// -----------------------------------------------------------------------------
// THREE FIELDS THAT DO NOT CROSS, AND WHY EACH ONE IS NAMED
// -----------------------------------------------------------------------------
// `certificate_id` DOES NOT CROSS. SD-M11-01 adds `code text not null unique`
// and states the reason in its own row: `code` "is the short unguessable token
// that appears in the image and resolves on the verify page; IT IS DISTINCT FROM
// `id` SO THE PUBLIC TOKEN CAN BE ROTATED AFTER AN INCIDENT WITHOUT REWRITING
// THE PRIMARY KEY." A screen that puts `certificate_id` where a reader can copy
// it publishes the key the split exists to keep private, and it does it on the
// one screen whose whole purpose is copying something out. The id is a handle
// this application holds and never a thing it shows. It is not even used as a
// React key below: `verify_url` is unique and is already public, so the id never
// enters the render tree at all and cannot reach the output by a route nobody
// was watching.
//
// NO ACCOUNT IDENTIFIER CROSSES, AND THE SCREEN IS NOT GROUPED BY ONE. Grouping
// the cards under an account heading is the obvious layout and it would put an
// account id on the page. On the trader's own authenticated screen that leaks
// nothing to a stranger, and it would still make the page's absence assertion
// unstateable: the test below asserts that NO account or identity identifier
// appears anywhere in the rendered bytes, which is a claim a reader can check,
// and "none inside the card element" is a claim that depends on which element
// somebody screenshots. `certificates.account_id` and `identity_id` are columns
// on the row (SD-M4-01) and are on no response and on no screen.
//
// NO TOTAL IS COMPUTED ANYWHERE ON EITHER SCREEN. INV-M4-01 bans client-side
// money arithmetic and INV-M11-01 and AS-M11-07 ban a cumulative figure on a
// certificate specifically, because "a total assembled from cards is a statistic
// with no method page". Two rules, one absence, and there is no field either
// model could put one in.
//
// -----------------------------------------------------------------------------
// WHAT THIS SCREEN STILL CANNOT SAY, MEASURED RATHER THAN ASSUMED
// -----------------------------------------------------------------------------
// REVOCATION. ../../view/certificates.ts already records it: `certificates`
// carries `revoked_at` and `revoked_reason`, `CertificateResponse` carries
// neither, so this screen cannot tell a trader their card has been revoked and
// the public verify page is the only surface that can (AS-M4-03 rule 2,
// DEP-M4-05). Rendering these cards therefore does NOT tell a trader their cards
// are live. The screen says which surface does, in the same render, rather than
// leaving a reader to assume the absence means good news.
//
// DEFERRAL. INV-M11-09 defers issuance behind an open severity 4+ flag rather
// than denying it, and `deferred_until` / `deferred_reason` are SD-M11-03's
// columns. The approved response shape carries neither, so a deferred
// certificate and an absent one are the same `null` here. Named in ./ports.ts.
//
// =============================================================================
// PART TWO. THE RULE DIFF'S PAIRING, WHICH IS SC-M4-06's ACTUAL PROBLEM
// =============================================================================
// SD-M4-02 wants the diff between the contract a trader held and the one a reset
// put them on. `GET /purchases` states each purchase's `plan.version` and states
// no pairing, so the pairing is this screen's and it is made over the server's
// own list order: a `reset` row is paired with the nearest EARLIER purchase on
// the same `plan_id`.
//
// AND A RESET WHOSE PARTNER IS NOT ON THE PAGE IS RENDERED AS UNPAIRABLE RATHER
// THAN AS UNCHANGED. That is the same rule ../../view/purchases.ts writes about
// its own walk: "An omission that reads as a positive claim is the worst failure
// available on this screen, because the screen exists to be the record of what
// the trader agreed to when they repurchased." A cursor list has a second page,
// so the earlier purchase is legitimately absent, and a diff panel that rendered
// nothing there would say "your terms did not change" about a comparison it
// never made.

import type { PurchaseListItem } from '../../api/types.ts';
import type { CertificateView } from '../../view/certificates.ts';
import { UnverifiableCertificateError, toCertificateView } from '../../view/certificates.ts';
import {
  disclosureBlock,
  type DisclosureBlock,
  type DisclosureSource,
} from '../../view/disclosure.ts';
import type { PurchaseHistoryView, RuleDiffView } from '../../view/purchases.ts';
import { toPurchaseHistory, toRuleDiff } from '../../view/purchases.ts';
import type { CertificateRequest, PurchasesSegmentPorts } from './ports.ts';

// -----------------------------------------------------------------------------
// SC-M4-08. The certificates screen
// -----------------------------------------------------------------------------

/**
 * The address of the simulated-environment disclosure, INV-M4-09's obligation.
 *
 * A CONSTANT HERE AND NOT A LITERAL AT THE POINT OF RENDER, because
 * `disclosureBlock()`'s own header says the remaining hole in the brand "is a
 * caller naming the wrong document, which is a diff a reviewer reads". One
 * caller, one line, one diff.
 */
export const SIMULATED_ENVIRONMENT_DISCLOSURE: DisclosureSource = {
  slug: 'simulated-environment-disclosure',
  version: 2,
};

/**
 * Exactly the fields of a certificate that may reach a surface.
 *
 * The list is the control and `publishedCertificate()` is its implementation.
 * A test asserts the two agree, so a field added to one and not the other is a
 * failing build rather than a quiet publication.
 */
export const PUBLISHED_CERTIFICATE_FIELDS = [
  'kind',
  'claims',
  'issued_at',
  'disclosure',
  'verify_url',
  'image_url',
] as const;

/** A certificate reduced to what it may say. Built by allowlist, never by copy. */
export type PublishedCertificate = {
  readonly kind: CertificateView['kind'];
  readonly claims: CertificateView['claims'];
  readonly issued_at: string;

  /** INV-M4-09. Required, branded, and not authorable at the point of render. */
  readonly disclosure: DisclosureBlock;

  /**
   * THE AUTHORITY, AND THE ONLY THING THIS SCREEN OFFERS AS SHAREABLE.
   * AS-M4-03 rule 1 and INV-M11-02: the row is the authority and the image is a
   * rendering. A share affordance that handed over the image would hand over
   * exactly the artifact the attack forges.
   */
  readonly verify_url: string;

  /**
   * Rendered in place, on this authenticated screen, and never offered as the
   * share target. It is signed and TIME LIMITED, so a copy of it that escaped
   * would be a snapshot that expires and that cannot show a later revocation;
   * M11 section 4's public `GET /certificates/:code/image.png` is the image that
   * re-renders from the live row, and it is served off `code`, which
   * `CertificateResponse` does not carry.
   */
  readonly image_url: string;
};

/**
 * A certificate the screen refuses, with the reason, rather than half rendering.
 *
 * THE REASON IS THIS FILE'S SENTENCE AND NOT THE ERROR'S MESSAGE.
 * `UnverifiableCertificateError`'s message names the `certificate_id`, which is
 * the field the allowlist above exists to keep off a surface, so passing it
 * through would have published the id by the one route nobody was watching: an
 * error string. The error is still what this catches and it is still what a log
 * would carry.
 */
export type RefusedCertificate = {
  readonly kind: CertificateRequest['kind'];
  readonly reason: string;
};

/** SC-M4-08, as one page. */
export type CertificatesPageModel = {
  readonly cards: readonly PublishedCertificate[];
  readonly refused: readonly RefusedCertificate[];
};

/**
 * The allowlist, applied.
 *
 * WRITTEN FIELD BY FIELD ON PURPOSE. `{ ...view }` minus a few keys would be
 * shorter and it would carry the next field somebody adds to `CertificateView`
 * onto a public artifact without anybody deciding to.
 */
export function publishedCertificate(view: CertificateView): PublishedCertificate {
  return {
    kind: view.kind,
    claims: view.claims,
    issued_at: view.issued_at,
    disclosure: view.disclosure,
    verify_url: view.verify_url,
    image_url: view.image_url,
  };
}

/**
 * Build SC-M4-08 from the ports.
 *
 * A CERTIFICATE THAT ARRIVES UNVERIFIABLE BECOMES A REFUSAL AND NOT AN
 * EXCEPTION. `toCertificateView` throws on a blank `verify_url` and it is right
 * to; a screen that let that throw would take the whole page down over one bad
 * card, which turns a card-level defect into an outage on the surface a trader
 * reaches for when they want to prove something.
 */
export async function certificatesPageModel(
  ports: PurchasesSegmentPorts,
  requests: readonly CertificateRequest[],
): Promise<CertificatesPageModel> {
  const text = await ports.readDisclosure(SIMULATED_ENVIRONMENT_DISCLOSURE);
  const disclosure = disclosureBlock(SIMULATED_ENVIRONMENT_DISCLOSURE, text);

  const cards: PublishedCertificate[] = [];
  const refused: RefusedCertificate[] = [];

  for (const request of requests) {
    const response = await ports.readCertificate(request);
    if (response === null) continue;
    try {
      cards.push(publishedCertificate(toCertificateView(response, disclosure)));
    } catch (error) {
      if (!(error instanceof UnverifiableCertificateError)) throw error;
      refused.push({
        kind: request.kind,
        reason:
          'This certificate arrived without its verification page, so there is ' +
          'nothing here that could be verified and nothing worth sharing. ' +
          'Merit support can reissue it.',
      });
    }
  }

  return { cards, refused };
}

// -----------------------------------------------------------------------------
// SC-M4-06. The purchases screen
// -----------------------------------------------------------------------------

/** One reset's rule diff, or the honest statement that it could not be made. */
export type ResetDiffPanel =
  | {
      readonly state: 'paired';
      readonly purchase_id: string;
      readonly plan_code: string;
      readonly diff: RuleDiffView;
    }
  | {
      readonly state: 'unpairable';
      readonly purchase_id: string;
      readonly plan_code: string;
      readonly reason: string;
    };

/** SC-M4-06, as one page. */
export type PurchasesPageModel = {
  readonly history: PurchaseHistoryView;
  readonly resets: readonly ResetDiffPanel[];
};

/**
 * The nearest EARLIER purchase on the same plan, by the server's own list order.
 *
 * `GET /purchases` is a cursor list and ../../view/purchases.ts keeps its order:
 * "ORDER IS THE SERVER'S ... re-sorting here would produce a page whose second
 * screenful does not follow its first." So "earlier" is a position in that list
 * and never a comparison of `created_at`, which would be this file quietly
 * deciding the list is sorted by time.
 */
function precedingPurchaseOnSamePlan(
  items: readonly PurchaseListItem[],
  index: number,
): PurchaseListItem | null {
  const reset = items[index];
  if (reset === undefined) return null;
  for (let i = index + 1; i < items.length; i += 1) {
    const candidate = items[i];
    if (candidate !== undefined && candidate.plan.plan_id === reset.plan.plan_id) return candidate;
  }
  return null;
}

/**
 * Build SC-M4-06 from the ports.
 *
 * THE DIFF COSTS TWO READS PER RESET AND NEVER A SUBTRACTION. Both sides are
 * read from `GET /plans/:planId/versions/:version` and handed to `toRuleDiff`,
 * which renders `was` and `now` and has no field a difference could be written
 * into (INV-M4-01).
 */
export async function purchasesPageModel(
  ports: PurchasesSegmentPorts,
): Promise<PurchasesPageModel> {
  const items = await ports.readPurchases();
  const resets: ResetDiffPanel[] = [];

  for (const [index, item] of items.entries()) {
    if (item.kind !== 'reset') continue;

    const previous = precedingPurchaseOnSamePlan(items, index);
    if (previous === null) {
      resets.push({
        state: 'unpairable',
        purchase_id: item.purchase_id,
        plan_code: item.plan.code,
        reason:
          'the purchase this reset replaced is not on this page of the list, so no ' +
          'comparison was made. It is not a statement that the terms are unchanged.',
      });
      continue;
    }

    const [from, to] = await Promise.all([
      ports.readPlanVersion(previous.plan.plan_id, previous.plan.version),
      ports.readPlanVersion(item.plan.plan_id, item.plan.version),
    ]);

    resets.push({
      state: 'paired',
      purchase_id: item.purchase_id,
      plan_code: item.plan.code,
      diff: toRuleDiff(from, to),
    });
  }

  return { history: toPurchaseHistory(items), resets };
}
