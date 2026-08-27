// =============================================================================
// apps/portal/src/app/(purchases)/certificates-screen.ts
// =============================================================================
// SC-M4-08 as markup. ./model.ts decided what may be on this page; this file
// decides only how it is arranged.
//
// -----------------------------------------------------------------------------
// WHY THIS IS `.ts` AND NOT `.tsx`
// -----------------------------------------------------------------------------
// `next.config` and `app/layout.tsx` are session 250's and had not landed when
// this branch was cut, and neither had the `jsx` compiler option a `.tsx` file
// needs: `tsconfig.base.json` sets none and `apps/portal/tsconfig.json` includes
// `src/**/*.ts` only. A `.tsx` page here would have been INVISIBLE to
// `pnpm run typecheck` rather than checked by it, which is a green gate that
// read nothing. `ts` is a default `pageExtensions` entry in `next@16.3.2`
// (`node_modules/next/dist/server/config-shared.js`:107), so this is a page
// Next.js routes and a file the existing gate actually checks. Converting to
// `.tsx` after 250 lands the compiler option is mechanical and is named in this
// session's log rather than done inside somebody else's fence.
//
// -----------------------------------------------------------------------------
// MOBILE FIRST WITHOUT A STYLESHEET THIS SESSION DOES NOT OWN
// -----------------------------------------------------------------------------
// M04 section 1.1 is mobile first and the global stylesheet arrives with the
// root layout, which is 250's. So the layout here is carried by the ELEMENTS
// rather than by CSS: stacked `article` and `dl` blocks reflow correctly at
// 375px with no stylesheet at all, and a wide `table` would not. A page that
// looked right only once somebody else's CSS landed would be a page whose mobile
// claim nobody could check today.

import { createElement as h, type ReactElement, type ReactNode } from 'react';

import type { CertificatesPageModel, PublishedCertificate, RefusedCertificate } from './model.ts';

/** The two kinds, in the trader's words rather than the enum's. */
const KIND_TITLE: Readonly<Record<PublishedCertificate['kind'], string>> = {
  pass: 'Evaluation pass certificate',
  payout: 'Payout certificate',
};

/**
 * One labelled fact.
 *
 * A `dt`/`dd` pair rather than a table row, so the label stays attached to its
 * value when the column is 375px wide.
 */
function fact(label: string, value: string): readonly ReactElement[] {
  return [
    h('dt', { key: `${label}-t`, className: 'merit-fact-label' }, label),
    h('dd', { key: `${label}-d`, className: 'merit-fact-value' }, value),
  ];
}

/**
 * One card.
 *
 * KEYED ON `verify_url` AND NOT ON `certificate_id`. The id is the primary key
 * `SD-M11-01` deliberately separated from the public `code` so the public token
 * can be rotated after an incident, and this segment never lets it into the
 * render tree at all. `verify_url` is unique and is already public.
 *
 * THE `alt` TEXT NAMES THE ARTIFACT AND NEVER ITS CONTENTS. An alt string built
 * from the claims would put the claims into the page a second time, in an
 * attribute, past every assertion written about the visible text.
 */
function card(certificate: PublishedCertificate): ReactElement {
  const facts: ReactNode[] = [
    ...fact('Plan', certificate.claims.plan_code),
    ...fact('Account size', certificate.claims.size),
  ];

  // A PASS CARD CLAIMS NO AMOUNT AND NOTHING IS RENDERED WHERE ONE WOULD GO.
  // ../../view/certificates.ts: rendering an absent amount as `0.00` "would turn
  // the first into a false claim about the second, which is precisely the
  // forgery direction AS-M4-03 is written about, produced by a default rather
  // than by an adversary". A dash or an "n/a" would be the same defect wearing
  // punctuation, so the row is absent rather than empty.
  if (certificate.claims.amount !== null) {
    facts.push(...fact('Payout', certificate.claims.amount));
  }

  facts.push(...fact('Trading day', certificate.claims.trading_day));
  facts.push(...fact('Issued', certificate.issued_at));

  return h(
    'li',
    { key: certificate.verify_url, className: 'merit-certificate' },
    h(
      'article',
      null,
      h('h2', null, KIND_TITLE[certificate.kind]),
      h('dl', { className: 'merit-certificate-claims' }, facts),
      h('img', {
        className: 'merit-certificate-image',
        src: certificate.image_url,
        alt: 'The share card for this certificate',
        loading: 'lazy',
      }),
      h(
        'p',
        { className: 'merit-certificate-verify' },
        h(
          'a',
          { href: certificate.verify_url, rel: 'noreferrer' },
          'Verify this certificate, and share this link',
        ),
      ),
      // AS-M4-03 rule 1, said on the screen and not only in a comment. The
      // trader is the person who decides what to share, so the sentence that
      // decides it correctly has to be where they are.
      h(
        'p',
        { className: 'merit-certificate-authority' },
        'The verification page is what proves this certificate. The image is a ' +
          'rendering of it and proves nothing on its own.',
      ),
      // INV-M4-09. A required disclosure, on the artifact and on the screen that
      // renders one, because they are two surfaces and the obligation lands on
      // both. It cannot be omitted: the model's type will not build without it.
      h('p', { className: 'merit-disclosure' }, certificate.disclosure),
    ),
  );
}

/**
 * A card the screen refused, with the reason, in place of half a card.
 *
 * KEYED ON POSITION. Every other identifier available here is one ../model.ts
 * keeps off this page, and a React key does not reach the markup, which is
 * exactly the kind of "it does not render, so it is fine" reasoning the absence
 * assertion in the test suite exists to stop depending on.
 */
function refusal(item: RefusedCertificate, index: number): ReactElement {
  return h(
    'li',
    { key: String(index), className: 'merit-certificate-refused' },
    h('h2', null, `${KIND_TITLE[item.kind]} could not be shown`),
    h('p', null, item.reason),
  );
}

/**
 * SC-M4-08.
 *
 * SYNCHRONOUS AND PURE, which is what lets a test render it to bytes and assert
 * over what is and is not in them. The `await`s live in ./certificates/page.ts.
 */
export function CertificatesScreen({ model }: { model: CertificatesPageModel }): ReactElement {
  const empty = model.cards.length === 0 && model.refused.length === 0;

  return h(
    'main',
    { className: 'merit-screen merit-screen-certificates' },
    h('h1', null, 'Certificates'),

    // WHAT THIS SCREEN CANNOT TELL THEM, IN THE SAME RENDER AS WHAT IT CAN.
    // AS-M4-03 rule 2 makes revocation real and `CertificateResponse` carries
    // neither `revoked_at` nor `revoked_reason`, so a card shown here is a card
    // that was issued and is not a card that is currently valid. Leaving that
    // absence silent would let the screen imply the stronger claim.
    h(
      'p',
      { className: 'merit-note' },
      'A certificate shown here is one Merit issued. Whether it is still valid ' +
        'today is answered by its verification page, which is the only surface ' +
        'that reports a revocation.',
    ),

    empty
      ? h(
          'p',
          { className: 'merit-empty' },
          'No certificates yet. One is issued when an evaluation is passed and ' +
            'when a payout reaches your wallet.',
        )
      : null,

    model.cards.length > 0
      ? h('ul', { className: 'merit-certificate-list' }, model.cards.map(card))
      : null,

    model.refused.length > 0
      ? h(
          'ul',
          { className: 'merit-certificate-refusals' },
          model.refused.map((item, index) => refusal(item, index)),
        )
      : null,
  );
}
