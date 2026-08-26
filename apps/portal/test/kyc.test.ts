import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import type { KycStatus } from '../src/api/types.ts';
import {
  INTERNAL_TIER_TERMS,
  InternalTierLanguageError,
  KYC_STATES,
  UnknownKycStateError,
  toKycStatusView,
} from '../src/view/kyc.ts';

// =============================================================================
// SC-M4-07: the states are the enum's, and section 7.9's vocabulary is enforced
// =============================================================================

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function status(over: Partial<KycStatus> = {}): KycStatus {
  return {
    state: 'pending',
    placement: 'pre_funded',
    verified_at: null,
    expires_at: null,
    action_required: null,
    ...over,
  };
}

test('KYC_STATES is the kyc_status enum, re-derived from the migration', () => {
  // The contract declares `state` as an open `string`, so the DDL is the only
  // source. Reading it here rather than trusting the constant is what makes the
  // constant a transcription instead of a memory.
  const sql = readFileSync(
    join(ROOT, 'packages/db/migrations/0001_extensions_and_enums.sql'),
    'utf8',
  );

  const start = sql.indexOf('CREATE TYPE kyc_status AS ENUM');
  expect(start, 'kyc_status is declared in 0001').toBeGreaterThanOrEqual(0);
  const body = sql.slice(start, sql.indexOf(');', start));
  const declared = [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);

  expect(declared).toEqual([...KYC_STATES]);

  // AND M04:86 SAYS FOUR. Asserted so the discrepancy cannot be resolved by
  // somebody quietly deleting a member to make the plan's sentence true.
  // ADR-111 section 7 records it as a finding for the founder.
  expect(declared).toHaveLength(5);
});

test('every state maps to a next step and none maps to nothing', () => {
  for (const state of KYC_STATES) {
    const view = toKycStatusView(status({ state }));
    expect(view.state).toBe(state);
    expect(['verify', 'wait', 'contact_support', 'none']).toContain(view.next_step);
  }
});

test('a rejected trader is routed to a human and never to a retry', () => {
  // M04 section 7.9: failure "routes to a human", and "the words 'decisions are
  // final' may not appear in any string this module renders". A retry control
  // on a rejection is the affordance that produces the second refusal.
  expect(toKycStatusView(status({ state: 'rejected' })).next_step).toBe('contact_support');
});

test('a pending verification offers no control at all', () => {
  // Section 7.9: "Repeated prompting reads as accusation regardless of wording",
  // so the persistent card is the only reminder and it carries no action.
  expect(toKycStatusView(status({ state: 'pending' })).next_step).toBe('wait');
});

test('an expired verification is re-done rather than appealed', () => {
  expect(toKycStatusView(status({ state: 'expired' })).next_step).toBe('verify');
  expect(toKycStatusView(status({ state: 'kyc_required' })).next_step).toBe('verify');
});

test('the verified badge follows the state and not the date', () => {
  // Section 7.9: "A status the trader keeps, not a gate they passed and cannot
  // confirm." An expired row can still carry a verification date, and a badge
  // reading that date would tell an expired trader they are verified.
  const expired = toKycStatusView(
    status({
      state: 'expired',
      verified_at: '2025-01-01T00:00:00Z',
      expires_at: '2026-01-01T00:00:00Z',
    }),
  );

  expect(expired.verified).toBe(false);
  expect(expired.verified_at).toBe('2025-01-01T00:00:00Z');
  expect(toKycStatusView(status({ state: 'verified' })).verified).toBe(true);
});

test('an unknown state is refused rather than rendered as pending', () => {
  // Falling back to `pending` tells a rejected trader to wait, which is the one
  // outcome this screen exists to prevent.
  expect(() => toKycStatusView(status({ state: 'under_manual_check' }))).toThrow(
    UnknownKycStateError,
  );
  expect(() => toKycStatusView(status({ state: '' }))).toThrow(UnknownKycStateError);
});

test('every internal-tier term M04 section 7.9 names is refused on the wire string', () => {
  // The check is at the point the server's string enters the trader's screen,
  // because that is the only place it can be made about the string that will
  // actually render: `action_required` is written by a handler and a lint over
  // portal source would never have read it.
  for (const term of INTERNAL_TIER_TERMS) {
    expect(
      () => toKycStatusView(status({ action_required: `We need to ${term} this.` })),
      `${term} is refused`,
    ).toThrow(InternalTierLanguageError);
  }
});

test('the vocabulary check is case insensitive and matches inside a word', () => {
  // Deliberately over-broad. A word-boundary match would let "under-review"
  // through, and the cost of a false positive is a handler's sentence being
  // rewritten while the cost of a false negative is a trader reading that they
  // were flagged.
  expect(() => toKycStatusView(status({ action_required: 'Under REVIEW.' }))).toThrow(
    InternalTierLanguageError,
  );
  expect(() => toKycStatusView(status({ action_required: 'Decisions Are Final.' }))).toThrow(
    InternalTierLanguageError,
  );
});

test('the five terms are M04 section 7.9s own list, quoted from the plan', () => {
  const plan = readFileSync(join(ROOT, 'docs/plans/M04-trader-portal.md'), 'utf8');
  for (const term of ['fraud', 'suspicious', 'risk', 'flagged', 'review']) {
    expect(plan, `section 7.9 names "${term}"`).toContain(`"${term}"`);
  }
  expect(plan).toContain('decisions are final');
});

test('a trader-safe sentence passes through verbatim', () => {
  // Paraphrasing a server's sentence is how a refusal and its record stop
  // matching, so the view adds nothing to the string it lets through.
  const sentence = 'Upload a government ID. It takes about two minutes.';
  const view = toKycStatusView(
    status({ state: 'kyc_required', action_required: sentence, placement: 'pre_funded' }),
  );

  expect(view.action_required).toBe(sentence);
  expect(view.placement).toBe('pre_funded');
});

test('a null action is not a vocabulary violation', () => {
  expect(toKycStatusView(status({ state: 'verified' })).action_required).toBeNull();
});
