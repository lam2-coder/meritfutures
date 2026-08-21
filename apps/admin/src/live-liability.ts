// =============================================================================
// apps/admin/src/live-liability.ts
// =============================================================================
// SECTION 3.5, ADR-020's TIER 2: A LIVE OPEN LIABILITY THAT DECIDES NOTHING.
//
// The reason it is worth having is specific and is not "dashboards should be
// live": "the liability figure is the one number whose staleness has an actual
// named body count, since FTT 'didn't know their liabilities till everyone
// requested'". Between batches, "roughly where is the book right now" is
// currently unanswerable at all.
//
// INV-M6-12 IS THE WHOLE OF THE REST OF THIS FILE, and every clause of it is
// enforced here rather than intended:
//
//   "never presented as an       the figure is built with `authority:
//    as-of-last-closed figure"    'indicative'`, and `render` prints the word
//                                 INDICATIVE in the text. The base figure's own
//                                 as-of is named INSIDE the definition, so the
//                                 reader sees both moments in one line
//   "no breaker, alarm, or task   `authoritative()` in figure.ts throws on this
//    threshold reads one"         figure. A control that reaches for it gets a
//                                 refusal rather than a plausible number
//   "it sits BESIDE the as-of     the result carries its base term unchanged,
//    figure rather than           so a caller cannot render the live number
//    replacing it"                without the authoritative one in hand
//   "no liability snapshot is     nothing here writes. This module is a read
//    written from it"             surface and has no write path to write with
//
// -----------------------------------------------------------------------------
// THREE TERMS, AND TWO OF THEM ARE AUTHORITATIVE
// -----------------------------------------------------------------------------
// Section 3.5 gives two: last closed Open Liability, plus the intraday movement
// implied by the indicative feed. `SD-M6-09` adds the third and states its
// tier: the live figure carries "same-day adjustment postings AT PAR, which is
// authoritative rather than indicative and so does not weaken INV-M6-12".
//
// An adjustment is a posted ledger transaction (`ADJ-C2` asserts the posting IS
// the adjustment, to the cent and the sign), so it is a fact rather than an
// implication. The terms are therefore returned SEPARATELY with their tiers, and
// only the sum is tagged indicative: one indicative term makes the total
// indicative, and hiding which term that was would make the whole figure look
// like a vendor feed when most of it is not.
//
// -----------------------------------------------------------------------------
// P-M6-09 GOVERNS IT LIKE EVERYTHING ELSE, AND HARDER
// -----------------------------------------------------------------------------
// "When data trust is red the live figure is SUPPRESSED RATHER THAN SHOWN,
// because a live number derived from a feed we already distrust is worse than no
// number: it is the confident wrong answer AS-M6-04 is about, arriving faster."
//
// Suppressed is a value, not an empty string: the page prints the reason where
// the number would have been, because a live figure that silently vanishes on a
// red day is a live figure the founder assumes is still being computed.
// =============================================================================

import type { Cents } from '@merit/rules-engine';
import type { DataTrust } from './data-trust.js';
import { type Figure, type Reading, authoritative, figure } from './figure.js';

/** The intraday movement implied by the indicative feed. Signed. */
export interface IndicativeMovement {
  /** Signed cents. Negative is a book that has moved in Merit's favour. */
  readonly cents: Cents;
  /** When the feed was last read, UTC ISO-8601. This is the live figure's own freshness. */
  readonly asOfInstant: string;
  /** Which feed. Named on the figure, because INV-M6-04 binds an indicative number too. */
  readonly feed: string;
}

/**
 * Same-day `account_adjustments` postings, at par. SD-M6-09.
 *
 * AUTHORITATIVE, and signed by direction: a `credit` raises what Merit owes and
 * a `debit` (only ever the exact reversal of a credit this table posted) lowers
 * it. The magnitude and the direction live in separate columns on the table;
 * whoever builds this record resolves them into one signed figure there, where
 * `direction` is in hand, rather than here where it is not.
 */
export interface SameDayAdjustments {
  readonly cents: Cents;
  readonly asOfInstant: string;
}

/** The live figure, or the stated refusal to compute one. */
export type LiveOpenLiability =
  | {
      readonly kind: 'suppressed';
      /** Printed where the number would have been. */
      readonly reason: string;
    }
  | {
      readonly kind: 'indicative';
      /** The sum, tagged indicative. `authoritative()` refuses it by construction. */
      readonly reading: Reading;
      /** The three terms, each with its own tier, so the reader sees which part is a feed. */
      readonly terms: {
        readonly lastClosed: Figure;
        readonly sameDayAdjustments: Reading;
        readonly intradayMovement: Reading;
      };
    };

const SUPPRESSED =
  'suppressed: data trust is red, and a live number derived from a feed Merit already distrusts ' +
  'is worse than no number. Section 3.5, ADR-020. The as-of-last-closed figure above is unaffected';

/**
 * Section 3.5's figure.
 *
 * The base MUST be the authoritative P-M6-01 open liability. Passing an
 * indicative base would compound two feeds into a number wearing one label, so
 * it is refused by the same gate a breaker hits.
 */
export function liveOpenLiability(input: {
  readonly lastClosedOpenLiability: Figure;
  readonly movement: IndicativeMovement;
  readonly sameDayAdjustments: SameDayAdjustments;
  readonly dataTrust: DataTrust;
}): LiveOpenLiability {
  // Refused BEFORE the trust check, deliberately: a caller that passed an
  // indicative base has a defect whether or not today happens to be red, and a
  // bug that only surfaces on green days is a bug that surfaces in production.
  const base = authoritative(input.lastClosedOpenLiability);

  if (input.dataTrust.verdict === 'red') return { kind: 'suppressed', reason: SUPPRESSED };

  const total = base.cents + input.sameDayAdjustments.cents + input.movement.cents;

  return {
    kind: 'indicative',
    reading: figure({
      origin: 'P-M6-01',
      label: 'Open liability, live',
      definition:
        `INDICATIVE. Last closed open liability as of ${base.asOf.instant}, plus same-day ` +
        'adjustment postings at par, plus the intraday movement implied by the feed. It answers ' +
        '"roughly where is the book right now" and it decides NOTHING: no breaker, no alarm and ' +
        'no top-up task reads it (INV-M6-12). It sits beside the as-of-last-closed figure and ' +
        'never replaces it',
      cents: total,
      asOf: {
        instant: input.movement.asOfInstant,
        source: `${base.asOf.source} + ${input.movement.feed} + account_adjustments`,
      },
      authority: 'indicative',
    }),
    terms: {
      lastClosed: base,
      sameDayAdjustments: figure({
        origin: 'P-M6-01',
        label: 'Live term: same-day adjustments at par',
        definition:
          'signed sum of today posted account_adjustments (SD-M6-09). AUTHORITATIVE rather than ' +
          'indicative: an adjustment is a posted ledger transaction, which ADJ-C2 asserts to the ' +
          'cent and the sign, so it is a fact rather than an implication',
        cents: input.sameDayAdjustments.cents,
        asOf: { instant: input.sameDayAdjustments.asOfInstant, source: 'account_adjustments' },
        authority: 'authoritative',
      }),
      intradayMovement: figure({
        origin: 'P-M6-01',
        label: 'Live term: intraday movement',
        definition:
          'signed movement implied by the indicative feed since the last close. THIS is the ' +
          'indicative term, and it is the reason the total is indicative',
        cents: input.movement.cents,
        asOf: { instant: input.movement.asOfInstant, source: input.movement.feed },
        authority: 'indicative',
      }),
    },
  };
}
