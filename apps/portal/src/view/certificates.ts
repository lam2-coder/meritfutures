// =============================================================================
// apps/portal/src/view/certificates.ts
// =============================================================================
// SC-M4-08, CERTIFICATES. M04 section 3.1's one thing it must get right:
// "Signed, verifiable, disclosure-bearing."
//
// -----------------------------------------------------------------------------
// AS-M4-03: THE CARD IS A RENDERING AND THE CERTIFICATE IS THE ROW
// -----------------------------------------------------------------------------
//   "Certificates are cheap virality and every competitor has them, which means
//   adversaries already know the format. A forged card claiming a $1,500 Merit
//   payout that never happened is trivially made in an image editor."
//
// The counter is that the row is the fact (SD-M4-01, `certificates` at
// 0020_public_surface.sql:103) and the verification page is the authority:
//
//   "1. The verification page is the authority and the image is not. An
//   unverifiable code returns 'no certificate with this code', never 'this is
//   fake', because the honest claim is the defensible one."
//
// SO `verify_url` IS A REQUIRED FIELD ON THE VIEW AND `image_url` IS OPTIONAL
// TO RENDER BUT NEVER OPTIONAL TO ACCOMPANY. A card shared without its
// verification route is a picture, and a picture is the thing being forged. The
// view refuses a certificate whose `verify_url` is blank rather than rendering
// the image alone, because the failure of the missing half is invisible on the
// screen where it happens and visible only in the argument months later.
//
// -----------------------------------------------------------------------------
// INV-M4-09: THE DISCLOSURE IS A REQUIRED PROP AND NOT A FOOTER
// -----------------------------------------------------------------------------
//   "The simulated-environment disclosure appears in the footer, at checkout
//   entry, ON CERTIFICATES, and on the funded dashboard | Constitution section
//   6, and it is a compliance obligation rather than a design preference."
//
// API_CONTRACT says certificates "carry the simulated-environment disclosure by
// construction", which is a statement about the ISSUED ARTIFACT. The screen
// that renders one is a second surface and the obligation lands on it too. So
// `disclosure` is a required field of a branded type, in the idiom
// INV-M4-02 and INV-M4-11 already use: a component that renders a certificate
// without it does not compile.
//
// THE BRAND IS `DisclosureBlock`, IN ./disclosure.ts, AND IT IS NOT `CopyBlock`.
// `CopyBlock`'s brand names `plan_versions.copy_blocks`, and the
// simulated-environment disclosure is legal copy from `content_documents`
// rather than a rule sentence on a plan version. That file states what the
// brand buys and what it does not.
//
// -----------------------------------------------------------------------------
// WHAT THIS SCREEN CANNOT SHOW, MEASURED RATHER THAN ASSUMED
// -----------------------------------------------------------------------------
// AS-M4-03 rule 2 is "Revocation exists (`revoked_at`) ... and the verify page
// says so." `certificates` carries `revoked_at` and `revoked_reason`;
// API_CONTRACT's `CertificateResponse` carries NEITHER. So the trader's own
// certificate screen cannot tell them their card has been revoked, and the only
// surface that can is the public verify page, which is M11's (DEP-M4-05).
//
// That is a seam and not a defect of this file, and it is recorded in this
// session's log rather than closed here: exposing revocation is a contract row,
// ADR-111's subject is the three shapes session 158 named, and a fourth row
// taken on the way past is the reaching that dispatch warned against.

import type { CertificateResponse } from '../api/types.ts';
import { formatCents, formatOptionalCents } from '../format/money.ts';
import type { DisclosureBlock } from './disclosure.ts';

/** A certificate served without the verification route that makes it worth anything. */
export class UnverifiableCertificateError extends Error {
  constructor(readonly certificate_id: string) {
    super(
      `certificate ${certificate_id} arrived with no verify_url. AS-M4-03 makes ` +
        'the verification page the authority and the image a rendering, so a card ' +
        'shared without its verification route is the artifact the attack forges. ' +
        'The screen refuses rather than rendering the image alone.',
    );
    this.name = 'UnverifiableCertificateError';
  }
}

/**
 * The minimal claims AS-M4-03 rule 3 requires.
 *
 * "Claims are minimal by construction: no identity, no email, no cumulative
 * totals. A certificate is a fact about an account on a day, and the smaller
 * the claim, the less there is to forge usefully." The absences here are that
 * rule, and there is no field an identity could be written into.
 */
export type CertificateClaimsView = {
  readonly plan_code: string;
  readonly size: string;

  /** Payout cards only. A pass card claims no amount and this stays null. */
  readonly amount: string | null;
  readonly trading_day: string;
};

/** SC-M4-08. One signed, verifiable, disclosure-bearing card. */
export type CertificateView = {
  readonly certificate_id: string;
  readonly kind: 'pass' | 'payout';

  /** THE AUTHORITY. Public, and what a sceptical reader is sent to. */
  readonly verify_url: string;

  /** The rendering. Signed and time limited, and never the thing being trusted. */
  readonly image_url: string;
  readonly issued_at: string;
  readonly claims: CertificateClaimsView;

  /** INV-M4-09, as a field that cannot be omitted or authored here. */
  readonly disclosure: DisclosureBlock;
};

/**
 * One certificate, rendered.
 *
 * `amount_cents` IS OPTIONAL ON THE WIRE AND ITS ABSENCE IS A KIND RATHER THAN
 * A GAP. A pass certificate claims that an evaluation was passed and claims no
 * money; a payout certificate claims an amount. Rendering an absent amount as
 * `$0.00` would turn the first into a false claim about the second, which is
 * precisely the forgery direction AS-M4-03 is written about, produced by a
 * default rather than by an adversary.
 *
 * NO CLAIM IS RECOMPUTED, RE-DERIVED OR CROSS-CHECKED HERE. The signature is
 * over the row and the verification page is what checks it. A client-side
 * consistency check between `claims.size_cents` and anything else would be the
 * portal asserting something about a signed artifact it cannot verify, and its
 * failure would look like a defect in a valid certificate.
 */
export function toCertificateView(
  certificate: CertificateResponse,
  disclosure: DisclosureBlock,
): CertificateView {
  if (certificate.verify_url.trim() === '') {
    throw new UnverifiableCertificateError(certificate.certificate_id);
  }

  return {
    certificate_id: certificate.certificate_id,
    kind: certificate.kind,
    verify_url: certificate.verify_url,
    image_url: certificate.image_url,
    issued_at: certificate.issued_at,
    claims: {
      plan_code: certificate.claims.plan_code,
      size: formatCents(certificate.claims.size_cents),
      amount: formatOptionalCents(certificate.claims.amount_cents ?? null),
      trading_day: certificate.claims.trading_day,
    },
    disclosure,
  };
}
