import { expect, test } from 'vitest';

import type { SimulatedEnvironmentDisclosure } from '../src/render/disclosure.ts';
import {
  CANONICAL_PAYOUT_COPY,
  DisclosureError,
  assertSimulatedDisclosurePresent,
  payoutCopyOmitsALeg,
} from '../src/render/disclosure.ts';

// CI-02, the `unit` project. M9-D-nn: disclosure presence.

const block = (
  overrides: Partial<SimulatedEnvironmentDisclosure> = {},
): SimulatedEnvironmentDisclosure => ({
  form: 'short',
  body: 'Counsel drafts this. Nothing in apps/site does.',
  document_version: 3,
  document_slug: 'terms-of-service',
  ...overrides,
});

// -----------------------------------------------------------------------------
// INV-M9-05: presence, and only presence
// -----------------------------------------------------------------------------

test('INV-M9-05: a page reaching the build with no disclosure fails the build', () => {
  expect(() => assertSimulatedDisclosurePresent(null, '/plans')).toThrow(DisclosureError);
});

test('INV-M9-05: an empty block is an absent block', () => {
  expect(() => assertSimulatedDisclosurePresent(block({ body: '' }), '/plans')).toThrow(
    DisclosureError,
  );
  expect(() => assertSimulatedDisclosurePresent(block({ body: '   \n ' }), '/plans')).toThrow(
    DisclosureError,
  );
});

test('the failure names the surface, because a build failure nobody can locate is a build failure nobody fixes', () => {
  expect(() => assertSimulatedDisclosurePresent(null, '/rules/merit-rapid-v1')).toThrow(
    /\/rules\/merit-rapid-v1/,
  );
});

// TOS_CLAUSES section 2 note 3: the check enforces presence, not wording. A
// check that read the body for required phrases would be apps/site deciding
// what counsel drafted, and changing counsel's words is a versioned content
// change rather than a code change.
test('the check does not read the wording, in either direction', () => {
  expect(() =>
    assertSimulatedDisclosurePresent(block({ body: 'words counsel has not written yet' }), '/'),
  ).not.toThrow();

  // The full form on a public page is more disclosure than required, not less.
  expect(() => assertSimulatedDisclosurePresent(block({ form: 'full' }), '/')).not.toThrow();
});

test('the block carries the version it came from, so the page is citeable', () => {
  const present = block();
  assertSimulatedDisclosurePresent(present, '/');
  expect(present.document_version).toBeGreaterThan(0);
  expect(present.document_slug).not.toBe('');
});

// -----------------------------------------------------------------------------
// GS-147 / INV-M9-09: the two legs, never one
// -----------------------------------------------------------------------------

test('GS-147: the canonical form names both legs and passes', () => {
  expect(payoutCopyOmitsALeg(CANONICAL_PAYOUT_COPY)).toBe(false);
});

test('GS-147: the internal leg alone fails, which is the version marketing reaches for', () => {
  expect(payoutCopyOmitsALeg('Get paid the same day, straight to your Merit Wallet.')).toBe(true);
  expect(payoutCopyOmitsALeg('Same-day payouts to your Merit Wallet')).toBe(true);
});

test('GS-147: the external leg alone fails too', () => {
  expect(payoutCopyOmitsALeg('Withdrawals to your bank take 2 to 3 business days.')).toBe(true);
});

// The four surfaces GS-147 names are four shapes of the same sentence, and the
// headline and the email subject are the ones with no room for a footnote.
test('GS-147: a headline, a social card and an email subject are all payout copy', () => {
  for (const oneLegged of [
    'Paid the same day. Wallet credited instantly.',
    'YOUR PAYOUT, SAME DAY, IN YOUR WALLET',
    'Your payout landed in your Merit Wallet today',
  ]) {
    expect(payoutCopyOmitsALeg(oneLegged)).toBe(true);
  }
});

// A lint that fired on every sentence in the estate would be turned off within
// a week, which is a worse outcome than the narrow one.
test('copy that is not about payouts is not payout copy', () => {
  expect(payoutCopyOmitsALeg('Support replies the same day.')).toBe(false);
  expect(payoutCopyOmitsALeg('Accounts are provisioned within minutes.')).toBe(false);
});

test('the pairing survives being split across sentences, which is how copy is actually written', () => {
  const split =
    'Request a payout and it is in your Merit Wallet the same day. ' +
    'When you withdraw, your bank receives it in 2 to 3 business days.';
  expect(payoutCopyOmitsALeg(split)).toBe(false);
});
