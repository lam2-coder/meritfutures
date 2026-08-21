import { expect, test } from 'vitest';

import {
  cadenceClaim,
  cadenceCopyPublishesADominatedGap,
  renderCadenceCopy,
} from '../src/render/cadence.js';
import { rules } from './fixtures.js';

// CI-02, the `unit` project. M9-D-nn: INV-M9-08's half of disclosure presence.

// -----------------------------------------------------------------------------
// The cadence is derived, never typed
// -----------------------------------------------------------------------------

// ADR-018 is not a ruling that the number is three. It is a ruling that the
// number is `win_days.required_count`, which WAS five, IS three, and is a
// launch candidate that can move again. This is the test that would fail if
// somebody transcribed the invariant literally.
test('INV-M9-08: the published cadence follows the win-day count wherever it goes', () => {
  const atThree = rules({
    phase_funded: {
      ...rules().phase_funded,
      win_days: { required_count: 3, floor_bp: 60, reset_on_payout: true },
    },
  });
  const atFive = rules({
    phase_funded: {
      ...rules().phase_funded,
      win_days: { required_count: 5, floor_bp: 60, reset_on_payout: true },
    },
  });

  expect(cadenceClaim(atThree).trading_days).toBe(3);
  expect(cadenceClaim(atFive).trading_days).toBe(5);
  expect(renderCadenceCopy(atThree)).toContain('3 trading days');
  expect(renderCadenceCopy(atFive)).toContain('5 trading days');
});

// EC-049's own arithmetic, and ADR-018's own comparison: "the comparison
// becomes `0 + 1 <= 3`".
test('INV-M9-08: the 1 day gap is dominated and the attribution is the win-day gate', () => {
  const claim = cadenceClaim(rules());

  expect(claim.gap_is_dominated).toBe(true);
  expect(claim.binding).toBe('win_day_gate');
  expect(claim.dominated_gap_trading_days).toBe(1);
  expect(renderCadenceCopy(rules())).toContain('win-day gate');
});

// The gap's effective length includes the settlement lag, because the two gates
// use DIFFERENT ANCHORS. That is the second half of EC-049's title.
test('the settlement lag is part of the gap, so the comparison is against both terms', () => {
  const base = rules().phase_funded;
  const laggy = rules({
    phase_funded: { ...base, min_settlement_lag_trading_days: 4, cadence_gap_trading_days: 1 },
  });

  const claim = cadenceClaim(laggy);
  expect(claim.gap_is_dominated).toBe(false);
  expect(claim.binding).toBe('cadence_gap');
  expect(claim.trading_days).toBe(5);
});

test('a binding gap is published, because a gate that binds is a real protection', () => {
  const base = rules().phase_funded;
  const gapBound = rules({ phase_funded: { ...base, cadence_gap_trading_days: 10 } });

  const claim = cadenceClaim(gapBound);
  expect(claim.binding).toBe('cadence_gap');
  expect(claim.dominated_gap_trading_days).toBeNull();
  expect(renderCadenceCopy(gapBound)).toContain('cadence gap');
});

// A tie adds nothing a trader can act on, so it is dominated by the definition
// EC-049 uses: the gap never binds.
test('a tie goes to the win-day gate', () => {
  const base = rules().phase_funded;
  const tied = rules({
    phase_funded: { ...base, cadence_gap_trading_days: 3, min_settlement_lag_trading_days: 0 },
  });

  expect(cadenceClaim(tied).binding).toBe('win_day_gate');
});

// -----------------------------------------------------------------------------
// The sentence names the mechanism, which is AS-M9-05's seam closed
// -----------------------------------------------------------------------------

test('the win-day sentence names the floor and the per-day requirement, not just a count', () => {
  const copy = renderCadenceCopy(rules());

  expect(copy).toContain('win-day floor');
  expect(copy).toContain('own trading day');
  expect(copy).toContain('basis day');
});

test('the cadence is stated as approximate, because it is a floor on effort and not a schedule', () => {
  expect(renderCadenceCopy(rules()).startsWith('About ')).toBe(true);
});

// -----------------------------------------------------------------------------
// The lint over copy nobody generated here
// -----------------------------------------------------------------------------

test('INV-M9-08: naming a dominated gap fails, with the number or with the words', () => {
  const config = rules();

  expect(cadenceCopyPublishesADominatedGap(config, 'Only a 1 trading day cadence gap.')).toBe(true);
  expect(
    cadenceCopyPublishesADominatedGap(config, 'Just a one day cooldown between payouts.'),
  ).toBe(true);
  expect(cadenceCopyPublishesADominatedGap(config, 'Payouts every 1 day.')).toBe(true);
});

test('the copy this module generates passes its own lint', () => {
  const config = rules();
  expect(cadenceCopyPublishesADominatedGap(config, renderCadenceCopy(config))).toBe(false);
});

test('a binding gap may be described, so the lint is silent on it', () => {
  const base = rules().phase_funded;
  const gapBound = rules({ phase_funded: { ...base, cadence_gap_trading_days: 10 } });

  expect(cadenceCopyPublishesADominatedGap(gapBound, 'A 10 trading day cadence gap applies.')).toBe(
    false,
  );
});

// The guard against the lint making a correct sentence unwritable: when the
// gap's figure equals the published cadence, the digit is the cadence's.
test('a plan whose cadence equals its gap can still state its cadence', () => {
  const base = rules().phase_funded;
  const one = rules({
    phase_funded: {
      ...base,
      win_days: { required_count: 1, floor_bp: 60, reset_on_payout: true },
      cadence_gap_trading_days: 1,
    },
  });

  const copy = renderCadenceCopy(one);
  expect(copy).toContain('1 trading day');
  expect(cadenceCopyPublishesADominatedGap(one, copy)).toBe(false);
});
