// =============================================================================
// packages/affiliate/test/attribution.test.ts
// =============================================================================
// INV-M8-02's ORDER, INV-M8-03's TWO SELF-DEAL CASES, AND THE ONE CONSTRAINT
// THIS FOLD CAN CONTRADICT.
//
// The assertion that matters most is not that the fold picks the right
// affiliate. It is that every row it can emit SATISFIES
// `attributions_literal_self_deal_is_void`, because that CHECK is the control
// and this fold is the only thing that hands it rows. So the constraint is
// restated once, as a predicate, and asserted over every decision every case
// below produces rather than case by case.
// =============================================================================

import { describe, expect, it } from 'vitest';

import {
  LAST_TOUCH_WINDOW_MS,
  LINKED_SELF_DEAL_VOID_REASON,
  LITERAL_SELF_DEAL_VOID_REASON,
  AttributionError,
  resolveAttribution,
  withinLastTouchWindow,
} from '../src/index.ts';
import type { AffiliateRef, AttributionInput, AttributionRow, ClickRef } from '../src/index.ts';

const BUYER = 'identity-buyer';

// SOMEBODY ELSE, WHICH IS NOW A BOOLEAN RATHER THAN A UUID (ADR-262). The fold
// no longer holds an affiliate identity to compare against: `packages/db`
// resolves the affiliate inside the checkout transaction, compares there, and
// hands this shape the result.
const CODE_AFFILIATE: AffiliateRef = {
  affiliateId: 'affiliate-code',
  isBuyer: false,
};

const CLICK_AFFILIATE: AffiliateRef = {
  affiliateId: 'affiliate-click',
  isBuyer: false,
};

const AT = new Date('2026-08-26T12:00:00.000Z');

function clickAt(offsetMs: number, affiliate: AffiliateRef = CLICK_AFFILIATE): ClickRef {
  return {
    clickId: 4242n,
    affiliate,
    clickedAt: new Date(AT.getTime() - offsetMs),
  };
}

function input(over: Partial<AttributionInput> = {}): AttributionInput {
  return {
    buyerIdentityId: BUYER,
    codeAffiliate: null,
    click: null,
    at: AT,
    linkConfidence: null,
    ...over,
  };
}

/**
 * `attributions_literal_self_deal_is_void`, restated from
 * `0012_disputes_and_affiliate_settlement.sql:116` and read as the database
 * reads it.
 */
function literalSelfDealIsVoid(each: AttributionInput, row: AttributionRow): boolean {
  // THE ROW NO LONGER CARRIES `affiliate_identity_id` AND THE CONSTRAINT STILL
  // GOVERNS IT (ADR-262). `ScopedTx.insertAsParty` stamps that column by
  // resolving `affiliate_id` to `affiliates.identity_id`, so the two columns
  // name one person exactly when the ref this row was folded from says
  // `isBuyer`. That is what is read back here.
  return !isBuyerOf(each, row.affiliateId) || row.voided;
}

/** The bit the accessor will stamp this row's affiliate identity from. */
function isBuyerOf(each: AttributionInput, affiliateId: string): boolean {
  for (const ref of [each.codeAffiliate, each.click?.affiliate ?? null]) {
    if (ref !== null && ref.affiliateId === affiliateId) return ref.isBuyer;
  }
  throw new Error(`no affiliate in this input is ${affiliateId}`);
}

/** `attributions_void_is_explained`, from the same file at :109. */
function voidIsExplained(row: AttributionRow): boolean {
  return !row.voided || row.voidReason !== null;
}

describe('resolveAttribution: INV-M8-02, the order', () => {
  it('takes the code override when a code names an affiliate', () => {
    const decision = resolveAttribution(input({ codeAffiliate: CODE_AFFILIATE }));
    expect(decision.kind).toBe('attributed');
    if (decision.kind !== 'attributed') throw new Error('unreachable');
    expect(decision.row.model).toBe('code_override');
    expect(decision.row.affiliateId).toBe(CODE_AFFILIATE.affiliateId);
    expect(decision.row.voided).toBe(false);
  });

  it('PREFERS THE TYPED CODE OVER A CLICK THAT IS NEWER, which is the case the invariant exists for', () => {
    // The click is one second old. The code still wins.
    const decision = resolveAttribution(
      input({ codeAffiliate: CODE_AFFILIATE, click: clickAt(1_000) }),
    );
    if (decision.kind !== 'attributed') throw new Error('expected an attribution');
    expect(decision.row.model).toBe('code_override');
    expect(decision.row.affiliateId).toBe(CODE_AFFILIATE.affiliateId);
  });

  it('records no click id when the click belongs to a DIFFERENT affiliate than the code', () => {
    const decision = resolveAttribution(
      input({ codeAffiliate: CODE_AFFILIATE, click: clickAt(1_000) }),
    );
    if (decision.kind !== 'attributed') throw new Error('expected an attribution');
    expect(decision.row.clickId).toBeNull();
  });

  it('records the click id when the click belongs to the affiliate the code named', () => {
    const decision = resolveAttribution(
      input({ codeAffiliate: CODE_AFFILIATE, click: clickAt(1_000, CODE_AFFILIATE) }),
    );
    if (decision.kind !== 'attributed') throw new Error('expected an attribution');
    expect(decision.row.clickId).toBe(4242n);
  });

  it('falls through to last touch when the coupon names no affiliate', () => {
    const decision = resolveAttribution(input({ codeAffiliate: null, click: clickAt(1_000) }));
    if (decision.kind !== 'attributed') throw new Error('expected an attribution');
    expect(decision.row.model).toBe('last_touch');
    expect(decision.row.affiliateId).toBe(CLICK_AFFILIATE.affiliateId);
    expect(decision.row.clickId).toBe(4242n);
  });

  it('attributes nothing when there is neither a code nor a click', () => {
    expect(resolveAttribution(input())).toEqual({
      kind: 'none',
      reason: 'no_code_and_no_click',
    });
  });
});

describe('resolveAttribution: the 30 day window', () => {
  it('attributes a click exactly at the boundary', () => {
    const decision = resolveAttribution(input({ click: clickAt(LAST_TOUCH_WINDOW_MS) }));
    expect(decision.kind).toBe('attributed');
  });

  it('attributes nothing one millisecond past the boundary', () => {
    expect(resolveAttribution(input({ click: clickAt(LAST_TOUCH_WINDOW_MS + 1) }))).toEqual({
      kind: 'none',
      reason: 'click_outside_last_touch_window',
    });
  });

  it('is 30 days and the arithmetic is stated rather than inherited', () => {
    expect(LAST_TOUCH_WINDOW_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('admits a click in the future rather than refusing it, which is deliberate', () => {
    expect(withinLastTouchWindow(new Date(AT.getTime() + 60_000), AT)).toBe(true);
  });
});

describe('INV-M8-03: the literal self-deal is VOIDED and never attributed', () => {
  const SELF: AffiliateRef = { affiliateId: 'affiliate-self', isBuyer: true };

  it('voids a code override where the buyer IS the affiliate', () => {
    const decision = resolveAttribution(input({ codeAffiliate: SELF }));
    if (decision.kind !== 'attributed') throw new Error('a void is a row, not an absence');
    expect(decision.row.voided).toBe(true);
    expect(decision.row.voidReason).toBe(LITERAL_SELF_DEAL_VOID_REASON);
    expect(decision.row.selfDealLinkConfidenceBp).toBeNull();
  });

  it('voids a last touch where the buyer IS the affiliate', () => {
    const decision = resolveAttribution(input({ click: clickAt(1_000, SELF) }));
    if (decision.kind !== 'attributed') throw new Error('a void is a row, not an absence');
    expect(decision.row.voided).toBe(true);
    expect(decision.row.voidReason).toBe(LITERAL_SELF_DEAL_VOID_REASON);
  });

  it('keeps the row rather than dropping it, because THE ATTEMPT IS THE SIGNAL', () => {
    const decision = resolveAttribution(input({ codeAffiliate: SELF }));
    expect(decision.kind).toBe('attributed');
  });

  it('leaves the confidence NULL on the literal case even when a score was supplied', () => {
    const decision = resolveAttribution(
      input({ codeAffiliate: SELF, linkConfidence: { bp: 9_000, ceilingBp: 8_000 } }),
    );
    if (decision.kind !== 'attributed') throw new Error('unreachable');
    expect(decision.row.selfDealLinkConfidenceBp).toBeNull();
  });
});

describe('INV-M8-03: the scored self-deal', () => {
  it('voids strictly above the ceiling and records what it found', () => {
    const decision = resolveAttribution(
      input({ codeAffiliate: CODE_AFFILIATE, linkConfidence: { bp: 8_001, ceilingBp: 8_000 } }),
    );
    if (decision.kind !== 'attributed') throw new Error('unreachable');
    expect(decision.row.voided).toBe(true);
    expect(decision.row.voidReason).toBe(LINKED_SELF_DEAL_VOID_REASON);
    expect(decision.row.selfDealLinkConfidenceBp).toBe(8_001);
  });

  it('does NOT void at the ceiling, which is the configured tolerance', () => {
    const decision = resolveAttribution(
      input({ codeAffiliate: CODE_AFFILIATE, linkConfidence: { bp: 8_000, ceilingBp: 8_000 } }),
    );
    if (decision.kind !== 'attributed') throw new Error('unreachable');
    expect(decision.row.voided).toBe(false);
  });

  it('RECORDS a score that did not void, because that is the review queue', () => {
    const decision = resolveAttribution(
      input({ codeAffiliate: CODE_AFFILIATE, linkConfidence: { bp: 4_200, ceilingBp: 8_000 } }),
    );
    if (decision.kind !== 'attributed') throw new Error('unreachable');
    expect(decision.row.voided).toBe(false);
    expect(decision.row.selfDealLinkConfidenceBp).toBe(4_200);
  });

  it('leaves the score NULL when no resolver ran, which is not a verdict of zero', () => {
    const decision = resolveAttribution(input({ codeAffiliate: CODE_AFFILIATE }));
    if (decision.kind !== 'attributed') throw new Error('unreachable');
    expect(decision.row.selfDealLinkConfidenceBp).toBeNull();
  });

  it('refuses a score the CHECK could not hold', () => {
    for (const confidence of [
      { bp: 10_001, ceilingBp: 8_000 },
      { bp: -1, ceilingBp: 8_000 },
      { bp: 100.5, ceilingBp: 8_000 },
      { bp: 100, ceilingBp: 10_001 },
    ]) {
      expect(() =>
        resolveAttribution(input({ codeAffiliate: CODE_AFFILIATE, linkConfidence: confidence })),
      ).toThrow(AttributionError);
    }
  });
});

describe('every row this fold can emit satisfies the constraints that will receive it', () => {
  const SELF: AffiliateRef = { affiliateId: 'affiliate-self', isBuyer: true };

  const CASES: readonly AttributionInput[] = [
    input(),
    input({ codeAffiliate: CODE_AFFILIATE }),
    input({ codeAffiliate: SELF }),
    input({ click: clickAt(1_000) }),
    input({ click: clickAt(1_000, SELF) }),
    input({ click: clickAt(LAST_TOUCH_WINDOW_MS) }),
    input({ click: clickAt(LAST_TOUCH_WINDOW_MS + 1) }),
    input({ codeAffiliate: CODE_AFFILIATE, click: clickAt(1_000) }),
    input({ codeAffiliate: CODE_AFFILIATE, click: clickAt(1_000, CODE_AFFILIATE) }),
    input({ codeAffiliate: SELF, linkConfidence: { bp: 9_000, ceilingBp: 8_000 } }),
    input({ codeAffiliate: CODE_AFFILIATE, linkConfidence: { bp: 9_000, ceilingBp: 8_000 } }),
    input({ codeAffiliate: CODE_AFFILIATE, linkConfidence: { bp: 8_000, ceilingBp: 8_000 } }),
    input({ codeAffiliate: CODE_AFFILIATE, linkConfidence: { bp: 0, ceilingBp: 0 } }),
    input({ codeAffiliate: CODE_AFFILIATE, linkConfidence: { bp: 10_000, ceilingBp: 10_000 } }),
  ];

  it('satisfies attributions_literal_self_deal_is_void on all 14 cases', () => {
    for (const each of CASES) {
      const decision = resolveAttribution(each);
      if (decision.kind === 'none') continue;
      expect(literalSelfDealIsVoid(each, decision.row)).toBe(true);
    }
  });

  it('satisfies attributions_void_is_explained on all 14 cases', () => {
    for (const each of CASES) {
      const decision = resolveAttribution(each);
      if (decision.kind === 'none') continue;
      expect(voidIsExplained(decision.row)).toBe(true);
    }
  });

  it("emits only the schema's two models", () => {
    for (const each of CASES) {
      const decision = resolveAttribution(each);
      if (decision.kind === 'none') continue;
      expect(['last_touch', 'code_override']).toContain(decision.row.model);
    }
  });

  it('never leaves the affiliate id empty on an emitted row', () => {
    // `affiliate_id` IS THE COLUMN THE ACCESSOR RESOLVES THE COUNTERPARTY FROM
    // (ADR-262), so an empty one is a row whose second party cannot be found.
    for (const each of CASES) {
      const decision = resolveAttribution(each);
      if (decision.kind === 'none') continue;
      expect(decision.row.affiliateId).not.toBe('');
      expect(decision.row.buyerIdentityId).toBe(BUYER);
    }
  });
});

describe('the fold refuses what the schema could not have produced', () => {
  it('refuses an empty buyer identity', () => {
    expect(() => resolveAttribution(input({ buyerIdentityId: '' }))).toThrow(AttributionError);
  });
});
