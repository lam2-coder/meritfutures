// =============================================================================
// apps/portal/src/app/referrals/screen.ts
// =============================================================================
// SC-M4-09 AS A DOCUMENT A BROWSER CAN RENDER. `../../view/referrals.ts` turns
// two wire shapes into a render-ready shape and has done since P4-h; nothing
// has ever rendered it. This file is the other half, and it renders exactly
// what that module produced and nothing it did not.
//
// -----------------------------------------------------------------------------
// WHY THIS IS `.ts` AND NOT `.tsx`, WHICH IS A GATE FACT RATHER THAN A TASTE
// -----------------------------------------------------------------------------
// `apps/portal/tsconfig.json` sets neither `jsx` nor the `dom` lib and its
// `include` is `src/**/*.ts`, so a `.tsx` file in this tree is a file `tsc
// --noEmit` never reads. ADR-095 F7 rules that both belong "with the first
// page": that is the session writing `app/layout.tsx`, the root page and
// `next.config`, and this segment is not it. A page written in `.tsx` here
// would either sit untypechecked or force this session to edit a config file
// another session owns, and P4 section 11 rule 13 makes widening a fence and
// weakening a gate the same move.
//
// `createElement` COSTS READABILITY AND BUYS THE CHECK. Every element below is
// inside `tsc --noEmit`, inside `eslint`'s `apps/**/*.ts` block, inside
// `inv-m4-01.test.ts`'s money scan and inside `surface.test.ts`'s no-transport
// walk, all of which read `.ts` and none of which would have read a `.tsx`.
// `page.ts` is a real App Router page name: the framework reserves the STEM and
// resolves `.ts` before `.jsx`.
//
// WHOEVER LANDS THE `jsx` AND `dom` OPTIONS OWNS CONVERTING THIS FILE, and the
// conversion is mechanical. It is named here rather than in a plan because that
// is the author who will read it.
//
// -----------------------------------------------------------------------------
// THE STYLES ARE IN THE DOCUMENT AND THAT IS ALSO THE UNWIRED STATE SPEAKING
// -----------------------------------------------------------------------------
// A CSS module import (`./referrals.module.css`) needs the `next-env.d.ts`
// ambient declaration that arrives with `next.config`, which is the same
// session's file, so importing one today breaks `pnpm run typecheck` for a
// reason that has nothing to do with this screen. The rules below are therefore
// a `style` element this segment owns, every custom property read through a
// fallback (`var(--surface, #070c0a)`), so the segment renders correctly alone
// and inherits the shell's palette the moment there is one.
//
// MOBILE FIRST, M04 section 1.1. Every rule is the narrow layout and the single
// media query widens it, rather than the other way round.

import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';

import type { CreativeSubmissionView, ReferralPanelView } from '../../view/referrals.ts';

/**
 * SC-M4-09, whole.
 *
 * `creative` IS NULLABLE AND ITS NULL IS A STATE RATHER THAN AN EMPTY LIST, on
 * the shell's own `ContentState` reasoning: an affiliate who has submitted
 * nothing and an affiliate whose submission failed to load must not look alike.
 */
export type ReferralScreenView = {
  readonly panel: ReferralPanelView;

  /** The most recent submission, or the absence of one. */
  readonly creative: CreativeSubmissionView | null;
};

const CSS = `
.mf-referrals {
  --mf-surface: var(--surface, #070c0a);
  --mf-raised: var(--raised, #0c1512);
  --mf-body: var(--body, #dce7e2);
  --mf-secondary: var(--secondary, #89a79c);
  --mf-rule: var(--rule, rgba(137, 167, 156, 0.3));
  --mf-accent: var(--accent, #d6a657);
  background: var(--mf-surface);
  color: var(--mf-body);
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding: 1.25rem 1rem 3rem;
}
.mf-referrals h1 {
  font-size: 1.5rem;
  line-height: 1.2;
  margin: 0;
}
.mf-referrals h2 {
  font-size: 1rem;
  letter-spacing: 0.06em;
  margin: 0 0 0.75rem;
  text-transform: uppercase;
  color: var(--mf-secondary);
}
.mf-referrals h3 {
  font-size: 0.95rem;
  margin: 0 0 0.5rem;
}
.mf-referrals__card {
  background: var(--mf-raised);
  border: 1px solid var(--mf-rule);
  border-radius: 0.5rem;
  padding: 1rem;
}
.mf-referrals__code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 1.75rem;
  letter-spacing: 0.08em;
  margin: 0 0 0.75rem;
  color: var(--mf-accent);
  overflow-wrap: anywhere;
}
.mf-referrals__facts {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: 1fr;
  margin: 0;
}
.mf-referrals__fact dt {
  color: var(--mf-secondary);
  font-size: 0.8125rem;
  margin: 0;
}
.mf-referrals__fact dd {
  font-size: 1.125rem;
  font-variant-numeric: tabular-nums;
  margin: 0.125rem 0 0;
  overflow-wrap: anywhere;
}
.mf-referrals__empty,
.mf-referrals__meta {
  color: var(--mf-secondary);
  font-size: 0.8125rem;
  margin: 0.75rem 0 0;
}
.mf-referrals__lede {
  margin: 0 0 0.75rem;
}
.mf-referrals__required {
  border: 1px solid var(--mf-accent);
  border-radius: 0.5rem;
  margin-top: 1rem;
  padding: 0.875rem;
}
.mf-referrals__quote {
  border-left: 3px solid var(--mf-rule);
  font-style: normal;
  margin: 0.75rem 0 0;
  padding-left: 0.75rem;
}
.mf-referrals__disclosure {
  border-top: 1px solid var(--mf-rule);
  color: var(--mf-body);
  font-size: 0.875rem;
  padding-top: 1rem;
}
@media (min-width: 40rem) {
  .mf-referrals {
    gap: 2rem;
    margin: 0 auto;
    max-width: 48rem;
    padding: 2rem 1.5rem 4rem;
  }
  .mf-referrals__facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
`;

/**
 * One labelled figure.
 *
 * EVERY VALUE ARRIVES AS A STRING AND NOTHING HERE FORMATS ONE. `formatCents`
 * and `formatBasisPoints` already ran, in `toReferralPanel`, which is INV-M4-01's
 * "a formatting helper is the only permitted consumer" holding at the render
 * layer as well: this file has no number to be tempted by.
 */
function fact(key: string, label: string, value: string): ReactElement {
  return createElement(
    'div',
    { className: 'mf-referrals__fact', key },
    createElement('dt', null, label),
    createElement('dd', null, value),
  );
}

function card(key: string, heading: string, ...children: readonly ReactNode[]): ReactElement {
  const headingId = `mf-referrals-${key}`;
  return createElement(
    'section',
    { className: 'mf-referrals__card', key, 'aria-labelledby': headingId },
    createElement('h2', { id: headingId }, heading),
    ...children,
  );
}

/**
 * The affiliate's own figures.
 *
 * THE LABELS ARE THE FIELD NAMES AND NOT A SENTENCE ABOUT THEM. M08 AS-M8-04 is
 * a scenario about an affiliate publishing "guaranteed payouts at Merit", and
 * this is the surface a trader reads before they publish anything, so the
 * screen states what each number is and claims nothing further: no projection,
 * no "you could earn", no conversion rate, and no sentence explaining a
 * clawback window that M08 owns and this file would be a second definition of.
 */
function panelCards(panel: ReferralPanelView): readonly ReactElement[] {
  return [
    card(
      'code',
      'Your referral code',
      createElement('p', { className: 'mf-referrals__code' }, panel.code),
      createElement(
        'dl',
        { className: 'mf-referrals__facts' },
        fact('status', 'Status', panel.status),
        fact('commission', 'Commission rate', panel.commission),
      ),
    ),
    card(
      'activity',
      'Activity',
      createElement(
        'dl',
        { className: 'mf-referrals__facts' },
        fact('clicks', 'Clicks, last 30 days', String(panel.activity.clicks_30d)),
        fact('conversions', 'Conversions, last 30 days', String(panel.activity.conversions_30d)),
      ),
    ),
    card(
      'commission',
      'Commission',
      createElement(
        'dl',
        { className: 'mf-referrals__facts' },
        fact('earned', 'Earned, lifetime', panel.earnings.earned_lifetime),
        fact('payable', 'Payable', panel.earnings.payable),
        fact('paid', 'Paid, lifetime', panel.earnings.paid_lifetime),
        fact('chargeback', 'Chargeback rate', panel.chargeback_rate),
      ),
    ),
  ];
}

/**
 * THE CREATIVE, AND THE DISCLOSURE RENDERED AS WHAT IT IS.
 *
 * `affiliate_creatives_approved_has_disclosure` binds the disclosure to
 * APPROVAL and `disclosure_version_id` is `uuid NULL`, so a `pending` creative
 * carries no disclosure at all. ADR-113 clause 2 named the contract field
 * `required_disclosure` "so nobody reads it as a pin", and a screen is where
 * that naming either survives or is undone by a heading.
 *
 * SO THE HEADING NAMES THE MOMENT AND THE FIRST SENTENCE STATES THE ABSENCE.
 * The text sits inside a region whose own heading is "Disclosure required at
 * approval" and whose lede says this submission does not carry one, rather than
 * inside the creative's field list where a reader would take it for a property
 * of the row. `data-disclosure-state` carries the same fact for a check to
 * read, because a compliance property asserted only against prose is a property
 * that survives until somebody rewords a heading.
 */
function creativeCard(creative: CreativeSubmissionView): ReactElement {
  const required = creative.disclosure_required_at_approval;

  return card(
    'creative',
    'Creative submitted for review',
    createElement(
      'dl',
      { className: 'mf-referrals__facts' },
      fact('creative-ref', 'Reference', creative.url_or_ref),
      fact('creative-kind', 'Kind', creative.kind),
      fact('creative-status', 'Status', creative.status),
      fact('creative-submitted', 'Submitted', creative.submitted_at),
    ),
    createElement(
      'section',
      {
        className: 'mf-referrals__required',
        'aria-labelledby': 'mf-referrals-required',
        'data-disclosure-state': 'required-at-approval',
      },
      createElement('h3', { id: 'mf-referrals-required' }, 'Disclosure required at approval'),
      createElement(
        'p',
        { className: 'mf-referrals__lede' },
        'This submission does not carry a disclosure. Merit records the ' +
          'disclosure on a creative when the creative is approved, so a creative ' +
          'awaiting review carries none.',
      ),
      createElement('p', null, 'The review will require the disclosure below.'),
      createElement('blockquote', { className: 'mf-referrals__quote' }, required.text),
      createElement(
        'p',
        { className: 'mf-referrals__meta' },
        `Version ${required.version}, tos_versions ${required.tos_version_id}. ` +
          'This is the version in force now. A review applies the version in ' +
          'force when the review happens, which may be a later one.',
      ),
    ),
  );
}

/**
 * NO CREATIVE TO SHOW, STATED RATHER THAN LEFT BLANK, AND NOT STATED AS AN
 * ABSENCE OF SUBMISSIONS.
 *
 * AND THE REQUIRED DISCLOSURE IS NOT SHOWN HERE, WHICH IS A GAP RATHER THAN A
 * CHOICE. M08 section 4 wants an affiliate to see the requirement "before
 * submitting rather than after being rejected", and the only contract row that
 * carries the text is the RESPONSE to `POST /affiliate/creatives`: there is no
 * `GET /affiliate/creatives` and no read of the disclosure anywhere in
 * API_CONTRACT. So this screen cannot show a requirement before a submission
 * exists without inventing text, and inventing a required disclosure at the
 * point of render is the one thing `../../view/disclosure.ts` exists to make
 * impossible. The absence is reported rather than papered over.
 *
 * THE PARAGRAPH ABOVE IS UNCHANGED AND [ADR-168](../../../../../docs/decisions/ADR-168.md)
 * IS WHY IT DID NOT NEED TO CHANGE. That entry re-read this comment against all
 * three of its clauses and left it verbatim, on the ground that it "states an
 * absence clause 3 confirms" and that "a comment edited to look responsive to a
 * ruling that did not touch it is drift". Clause 3 REFUSED
 * `GET /affiliate/creatives`, so the sentence is not merely still true, it is
 * now permanent.
 *
 * WHAT DID CHANGE IS THE SENTENCE ON THE SCREEN, AND ONLY BECAUSE THE SEGMENT
 * IS WIRED. "No creative has been submitted for review" is a claim about
 * whether a submission exists, and this application can never observe that: the
 * `null` branch is reached for every render, permanently, by the same ruling.
 * An affiliate who submitted a creative yesterday would read a false statement
 * from Merit, on the surface AS-M8-04 is about. So the copy says what is true
 * -- that this screen is served no record of past submissions -- and explicitly
 * declines the reading it would otherwise invite. The absence being reported is
 * Merit's, not the affiliate's.
 */
function noCreativeCard(): ReactElement {
  return card(
    'creative',
    'Creative submitted for review',
    createElement(
      'p',
      { className: 'mf-referrals__empty' },
      'Merit serves this screen no record of creatives already submitted: a creative ' +
        'appears here only in the answer to its own submission. An empty space here does ' +
        'not mean nothing has been submitted.',
    ),
  );
}

/** SC-M4-09, rendered. */
export function ReferralScreen(view: ReferralScreenView): ReactElement {
  return createElement(
    'main',
    { className: 'mf-referrals' },
    createElement('style', { dangerouslySetInnerHTML: { __html: CSS } }),
    createElement('h1', null, 'Referrals'),
    ...panelCards(view.panel),
    view.creative === null ? noCreativeCard() : creativeCard(view.creative),
    createElement(
      'section',
      { className: 'mf-referrals__disclosure', 'aria-label': 'Required disclosure' },
      createElement('p', null, view.panel.disclosure),
    ),
  );
}
