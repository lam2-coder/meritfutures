import { expect, test } from 'vitest';

import type { EligibilityResponse } from '../src/api/types.ts';
import { toEligibilityView } from '../src/view/eligibility.ts';

// =============================================================================
// M4-R: the eligibility screen, which is the module's differentiator
// =============================================================================

const PASSING: EligibilityResponse = {
  account_id: 'acc_1',
  as_of_trading_day: '2026-08-20',
  eligible: true,
  max_payout_cents: 150000,
  min_payout_cents: 10000,
  gates: {
    account_active: { pass: true },
    kyc_verified: { pass: true, state: 'verified' },
    not_frozen: { pass: true, reason: null },
    recon_clear: { pass: true },
    traded_days: { pass: true, have: 6, need: 5 },
    win_days: { pass: true, have: 3, need: 3, floor_cents: 10000 },
    buffer: { pass: true, have_cents: 120000, need_cents: 100000 },
    consistency: {
      pass: true,
      skipped: false,
      best_day_share_bp: 3400,
      max_bp: 4000,
      profit_needed_to_dilute_cents: 0,
    },
    cadence_gap: {
      pass: true,
      days_since_last_payout: 6,
      need: 5,
      next_eligible_trading_day: null,
    },
    minimum_amount: { pass: true, withdrawable_cents: 150000, min_payout_cents: 10000 },
  },
  cap: { cap_cents: 150000, ordinal: 2, schedule_note: 'Payout 2 of the ladder.' },
};

test('all ten gates render, including the passing ones', () => {
  // SC-M4-03: "every gate, gate by gate, with numbers. Never a single progress
  // bar." A screen that renders only what is failing has told the trader what
  // is wrong and not what the rule is.
  const view = toEligibilityView(PASSING);
  expect(view.gates).toHaveLength(10);
  expect(view.gates.map((g) => g.id)).toEqual([
    'account_active',
    'kyc_verified',
    'not_frozen',
    'recon_clear',
    'traded_days',
    'win_days',
    'buffer',
    'consistency',
    'cadence_gap',
    'minimum_amount',
  ]);
  expect(view.gates.every((g) => g.state === 'pass')).toBe(true);
});

test('there is no aggregate percentage anywhere in the view', () => {
  // The competitor's progress bar, refused structurally. Any single number
  // summarising ten rules would have to be computed here, which is INV-M4-01
  // and INV-M4-03 in one field.
  const view = toEligibilityView(PASSING);
  const keys = Object.keys(view);
  for (const banned of ['progress', 'percent', 'pct', 'completion', 'score']) {
    expect(
      keys.some((k) => k.includes(banned)),
      `no ${banned} field`,
    ).toBe(false);
  }
});

test('GS-100: the consistency meter and the dilution amount render on a PASSING account', () => {
  // "Both are visible when the gate passes, not only when it fails. The OQ-9
  // ruling, and the reason AS-13 does not read as a moved goalpost."
  const view = toEligibilityView(PASSING);
  expect(view.consistency_meter.state).toBe('pass');
  expect(view.consistency_meter.best_day_share).toBe('34.00%');
  expect(view.consistency_meter.max).toBe('40.00%');
  expect(view.consistency_meter.profit_needed_to_dilute).toBe('0.00');
});

test('INV-M4-05: a skipped gate is disabled even when it reports pass', () => {
  // EC-050. THIS IS THE CASE THAT MATTERS: `skipped: true` arriving alongside
  // `pass: true` is exactly the input that produces a green check on a gate
  // that was never evaluated, which the plan calls "a lie the trader will
  // eventually catch".
  const view = toEligibilityView({
    ...PASSING,
    gates: {
      ...PASSING.gates,
      consistency: {
        pass: true,
        skipped: true,
        best_day_share_bp: null,
        max_bp: null,
        profit_needed_to_dilute_cents: null,
      },
    },
  });

  const gate = view.gates.find((g) => g.id === 'consistency');
  expect(gate?.state).toBe('disabled');
  expect(view.consistency_meter.state).toBe('disabled');

  // And a disabled gate is not a failing gate: it was not evaluated, so it is
  // not the reason a trader is waiting.
  expect(view.failing).not.toContain('consistency');
});

test('a skipped gate reporting pass: false is still disabled, not failing', () => {
  const view = toEligibilityView({
    ...PASSING,
    eligible: false,
    gates: {
      ...PASSING.gates,
      consistency: {
        pass: false,
        skipped: true,
        best_day_share_bp: null,
        max_bp: null,
        profit_needed_to_dilute_cents: null,
      },
    },
  });
  expect(view.gates.find((g) => g.id === 'consistency')?.state).toBe('disabled');
  expect(view.failing).toEqual([]);
});

test('INV-M4-03: the verdict belongs to the server, even when every gate passes', () => {
  // The portal has no client-side gate evaluation, so it cannot conclude
  // "eligible" from ten green rows. The server may hold a request for a reason
  // that is not one of the ten (API_CONTRACT's payout response carries
  // `held_pending_review`), and a client that inferred otherwise would enable a
  // control the server refuses, which is FM-M4-10 one surface over.
  const view = toEligibilityView({ ...PASSING, eligible: false, max_payout_cents: 0 });
  expect(view.gates.every((g) => g.state === 'pass')).toBe(true);
  expect(view.eligible).toBe(false);
  expect(view.max_payout).toBe('0.00');
});

test('the failing list is a filter over the server booleans, and the order never moves', () => {
  // FM-M4-08 wants the failing gate above the fold. This gives a layout the
  // information without reordering the rule between renders.
  const view = toEligibilityView({
    ...PASSING,
    eligible: false,
    max_payout_cents: 0,
    gates: {
      ...PASSING.gates,
      win_days: { pass: false, have: 1, need: 3, floor_cents: 10000 },
      buffer: { pass: false, have_cents: 40000, need_cents: 100000 },
    },
  });

  expect(view.failing).toEqual(['win_days', 'buffer']);
  expect(view.gates.map((g) => g.id).indexOf('win_days')).toBe(5);
  expect(view.gates.map((g) => g.id).indexOf('buffer')).toBe(6);
});

test('every gate carries its own numbers, formatted, and none is bare', () => {
  const view = toEligibilityView(PASSING);
  const facts = new Map(view.gates.map((g) => [g.id, g.facts]));

  expect(facts.get('win_days')).toEqual([
    { key: 'have', value: 3 },
    { key: 'need', value: 3 },
    { key: 'floor', value: '100.00' },
  ]);
  expect(facts.get('buffer')).toEqual([
    { key: 'have', value: '1,200.00' },
    { key: 'need', value: '1,000.00' },
  ]);
  expect(facts.get('minimum_amount')).toEqual([
    { key: 'withdrawable', value: '1,500.00' },
    { key: 'min_payout', value: '100.00' },
  ]);

  // The two gates that genuinely have no numbers to show are the two that are
  // a single boolean on the server. Everything else reports something.
  expect(facts.get('account_active')).toEqual([]);
  expect(facts.get('recon_clear')).toEqual([]);
});

test('the cadence gate renders a date and the cap renders the note the server sent', () => {
  const view = toEligibilityView({
    ...PASSING,
    eligible: false,
    max_payout_cents: 0,
    gates: {
      ...PASSING.gates,
      cadence_gap: {
        pass: false,
        days_since_last_payout: 2,
        need: 5,
        next_eligible_trading_day: '2026-08-25',
      },
    },
  });

  const cadence = view.gates.find((g) => g.id === 'cadence_gap');
  expect(cadence?.facts).toContainEqual({ key: 'next_eligible_trading_day', value: '2026-08-25' });
  expect(view.cap).toEqual({
    cap: '1,500.00',
    ordinal: 2,
    schedule_note: 'Payout 2 of the ladder.',
  });
});

test('the screen is authoritative and says so in the same object', () => {
  // INV-M4-13, and section 3.6's "Everything in the payout center |
  // authoritative, always". The literal type means a later session cannot put
  // an indicative number on this screen without changing this declaration.
  expect(toEligibilityView(PASSING).tier).toBe('authoritative');
  expect(toEligibilityView(PASSING).as_of_trading_day).toBe('2026-08-20');
});
