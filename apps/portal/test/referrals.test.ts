import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import type { AffiliateStats } from '../src/api/types.ts';
import { disclosureBlock } from '../src/view/disclosure.ts';
import { toReferralPanel } from '../src/view/referrals.ts';

// =============================================================================
// SC-M4-09: M08's trader-facing surface, with the required NFA I-26-12
// disclosure and with no claim the panel invented
// =============================================================================

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

const DISCLOSURE = disclosureBlock(
  { slug: 'affiliate-nfa-disclosure', version: 1 },
  'Merit accounts are simulated. Past results do not predict future results.',
);

function stats(over: Partial<AffiliateStats> = {}): AffiliateStats {
  return {
    code: 'TRADER77',
    commission_bp: 1_500,
    status: 'active',
    clicks_30d: 412,
    conversions_30d: 9,
    earned_cents_lifetime: 184_500,
    payable_cents: 42_000,
    paid_cents_lifetime: 130_000,
    chargeback_rate_bp: 240,
    ...over,
  };
}

test('every money figure is formatted and the three are never combined', () => {
  const view = toReferralPanel(stats(), DISCLOSURE);

  expect(view.earnings.earned_lifetime).toBe('1,845.00');
  expect(view.earnings.payable).toBe('420.00');
  expect(view.earnings.paid_lifetime).toBe('1,300.00');

  // M08:13: commission "is paid on a promise rather than on a settled fact",
  // and a clawback window sits between earned and payable. The subtraction that
  // looks like it reconciles them is both INV-M4-01's ban and wrong: 1,845 less
  // 1,300 is 545, and the server's payable is 420.
  expect(view.earnings.payable).not.toBe('545.00');
});

test('both basis-point figures go through the only permitted renderer', () => {
  const view = toReferralPanel(stats(), DISCLOSURE);
  expect(view.commission).toBe('15.00%');
  expect(view.chargeback_rate).toBe('2.40%');
});

test('the two activity counts stay counts and no rate is derived', () => {
  // M08 owns what a conversion means (a click attributed under last touch, a
  // purchase that can charge back for months), and a ratio the portal invented
  // would be a second definition of a number M12 publishes under a method page.
  const view = toReferralPanel(stats(), DISCLOSURE);

  expect(view.activity).toEqual({ clicks_30d: 412, conversions_30d: 9 });
  expect(Object.keys(view.activity)).toEqual(['clicks_30d', 'conversions_30d']);
});

test('the panel has no field a projection or a guarantee could be written into', () => {
  // M08 AS-M8-04 is a whole scenario about an affiliate publishing "guaranteed
  // payouts at Merit" or fabricated earnings, and this is the surface a trader
  // reads before they publish anything. The absence is the control.
  const view = toReferralPanel(stats(), DISCLOSURE);
  const keys = [...Object.keys(view), ...Object.keys(view.activity), ...Object.keys(view.earnings)];

  for (const forbidden of ['projected', 'estimate', 'potential', 'forecast', 'could']) {
    for (const key of keys) {
      expect(key.includes(forbidden), `${key} looks like ${forbidden}`).toBe(false);
    }
  }
});

test('the NFA disclosure is a required field and is not a footer', () => {
  // SC-M4-09 requires it, M08 SD-M8-03 makes approval per asset AND per
  // disclosure version because "NFA I-26-12 requires the disclosure to
  // accompany the claim". A required prop is the only version of "required"
  // that survives a redesign.
  const view = toReferralPanel(stats(), DISCLOSURE);
  expect(view.disclosure).toBe(
    'Merit accounts are simulated. Past results do not predict future results.',
  );

  const source = readFileSync(join(SRC, 'view', 'referrals.ts'), 'utf8');
  expect(source, 'disclosure is not optional on the view type').toContain(
    'readonly disclosure: DisclosureBlock;',
  );
  expect(source).not.toContain('disclosure?:');
});

test('zeroes are rendered and never hidden', () => {
  // The calendar panel's reasoning one file over: an empty surface and a
  // surface that has not loaded look identical, and the second is the one that
  // gets refreshed forever.
  const view = toReferralPanel(
    stats({
      clicks_30d: 0,
      conversions_30d: 0,
      earned_cents_lifetime: 0,
      payable_cents: 0,
      paid_cents_lifetime: 0,
      chargeback_rate_bp: 0,
    }),
    DISCLOSURE,
  );

  expect(view.activity).toEqual({ clicks_30d: 0, conversions_30d: 0 });
  expect(view.earnings.payable).toBe('0.00');
  expect(view.chargeback_rate).toBe('0.00%');
});

test('the panel performs no arithmetic on any figure it renders', () => {
  const code = readFileSync(join(SRC, 'view', 'referrals.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');

  for (const operator of [' - ', ' * ', ' / ', ' % ', '+=', '-=']) {
    expect(code.includes(operator), `${operator} appears in referrals.ts`).toBe(false);
  }
});

test('NFA I-26-12 is the obligation M08 and M04 both name', () => {
  const m04 = readFileSync(join(ROOT, 'docs/plans/M04-trader-portal.md'), 'utf8');
  const m08 = readFileSync(join(ROOT, 'docs/plans/M08-affiliate-system.md'), 'utf8');

  expect(m04, 'SC-M4-09 names the disclosure').toContain('NFA I-26-12 disclosure');
  expect(m08, 'M08 makes the promoter the firm compliance problem').toContain('NFA I-26-12');
});
