import { expect, test } from 'vitest';

import type { AccountDetail, AccountListItem } from '../src/api/types.js';
import { MissingCopyBlockError } from '../src/copy/copy-block.js';
import type { PinnedPlanCopy } from '../src/copy/copy-block.js';
import { toAccountCard, toAccountDetail, toAccountList } from '../src/view/accounts.js';

// =============================================================================
// M4-R: SC-M4-02 and SC-M4-03
// =============================================================================

const PINNED: PinnedPlanCopy = {
  plan_id: 'plan_core_eod',
  version: 7,
  blocks: {
    'eval.funded_reset':
      'Your funded account starts at the account size. Profit from the evaluation is not carried over.',
  },
};

const ITEM: AccountListItem = {
  account_id: 'acc_1',
  plan: { plan_id: 'plan_core_eod', code: 'CORE_EOD', name: 'Core EOD', version: 7 },
  size_cents: 5000000,
  phase: 'funded',
  status: 'active',
  balance_cents: 5120000,
  floor_cents: 5000000,

  // DELIBERATELY NOT `balance_cents - floor_cents`. The server's clamp, its
  // floor lock (ADR-014) and its corrections all live behind this field, and
  // the only way to prove the portal reads it rather than deriving it is to
  // hand the portal two numbers whose difference is something else.
  floor_distance_cents: 111111,
  withdrawable_cents: 120000,
  as_of_trading_day: '2026-08-20',
  blocked: { payouts_frozen: false, recon_blocked: false, kyc_required: false },
};

const DETAIL: AccountDetail = {
  ...ITEM,
  platform: 'rithmic',
  platform_account_ref: 'RITH-9911',
  front_end_permissions: ['R|Trader'],
  opened_on: '2026-06-01',
  funded_on: '2026-07-14',
  closed_on: null,
  close_reason: null,
  progress: {
    profit_target_cents: null,
    profit_cents: null,
    buffer_cents: 120000,
    buffer_progress_cents: 90000,
    win_days: { have: 2, need: 3, floor_cents: 10000 },
    traded_days: { have: 6, need: 5 },
    consistency: { best_day_share_bp: 3400, max_bp: 4000, skipped: false },
    cadence: { days_since_last_payout: 2, need: 5, next_eligible_trading_day: '2026-08-25' },
    ladder: { payouts_settled: 1, payouts_to_graduate: 6 },
  },
  rules_url: '/plans/core-eod/v7',
};

test('floor distance is the server field and never a client subtraction', () => {
  // SC-M4-02's "one thing it must get right", and FM-M4-01's whole subject.
  // 5120000 - 5000000 is 120000; the server said 111111 and the card says so.
  expect(toAccountCard(ITEM).floor_distance).toBe('1,111.11');
});

test('every account-state number arrives already formatted, as a string', () => {
  // INV-M4-01 made structural: a component handed these cannot add them.
  const card = toAccountCard(ITEM);
  expect(card.balance).toBe('51,200.00');
  expect(card.floor).toBe('50,000.00');
  expect(card.withdrawable).toBe('1,200.00');
  expect(card.size).toBe('50,000.00');
  for (const field of ['balance', 'floor', 'withdrawable', 'size', 'floor_distance'] as const) {
    expect(typeof card[field], `${field} is a string`).toBe('string');
  }
});

test('the card carries the day it is as of', () => {
  // INV-M4-02. The compile-time half is that `AccountCardView` extends
  // `AccountState`, so this assertion is the runtime witness rather than the
  // control: the control is that the object literal in accounts.ts would not
  // type-check without the field.
  expect(toAccountCard(ITEM).as_of_trading_day).toBe('2026-08-20');
  expect(toAccountDetail(DETAIL, PINNED).as_of_trading_day).toBe('2026-08-20');
});

test('blocks are reported as keys, in a fixed order, and never as sentences', () => {
  expect(toAccountCard(ITEM).blocked).toEqual([]);

  const blocked = toAccountCard({
    ...ITEM,
    blocked: { payouts_frozen: true, recon_blocked: false, kyc_required: true },
  });
  expect(blocked.blocked).toEqual(['payouts_frozen', 'kyc_required']);
});

test('the list maps and does not fold, because OQ-M4-01 is open', () => {
  // The recommendation in M04 section 10 is to show an identity-level total.
  // It is a recommendation. A session that summed `withdrawable_cents` here
  // would have answered a founder question with a `+`.
  const list = toAccountList([ITEM, { ...ITEM, account_id: 'acc_2' }]);
  expect(Array.isArray(list)).toBe(true);
  expect(list).toHaveLength(2);
  expect(list.map((c) => c.account_id)).toEqual(['acc_1', 'acc_2']);
});

test('the funded card renders every gate number the endpoint sent', () => {
  const progress = toAccountDetail(DETAIL, PINNED).progress;
  expect(progress.kind).toBe('funded');
  if (progress.kind !== 'funded') return;

  expect(progress.buffer).toBe('1,200.00');
  expect(progress.buffer_progress).toBe('900.00');
  expect(progress.win_days).toEqual({ have: 2, need: 3, floor: '100.00' });
  expect(progress.traded_days).toEqual({ have: 6, need: 5 });
  expect(progress.consistency.best_day_share).toBe('34.00%');
  expect(progress.consistency.max).toBe('40.00%');
  expect(progress.ladder).toEqual({ payouts_settled: 1, payouts_to_graduate: 6 });
});

test('the cadence gap renders a date and never a countdown', () => {
  // EC-046: a 5 trading day gap is 7 calendar days in June and 9 or more across
  // the Christmas cluster. A "days remaining" computed here is wrong in
  // December in the way traders read as the rules changing.
  const progress = toAccountDetail(DETAIL, PINNED).progress;
  if (progress.kind !== 'funded') return expect.unreachable('funded account read as non-funded');

  expect(progress.cadence.next_eligible_trading_day).toBe('2026-08-25');
  expect(Object.keys(progress.cadence).sort()).toEqual([
    'days_since_last_payout',
    'need',
    'next_eligible_trading_day',
  ]);
});

test('the consistency meter is present on a passing gate', () => {
  // GS-100's assertion, on the account card half: both numbers are visible when
  // the gate PASSES, not only when it fails. Section 3.3's OQ-9 ruling, and the
  // reason AS-13 does not read as a moved goalpost.
  const progress = toAccountDetail(DETAIL, PINNED).progress;
  if (progress.kind !== 'funded') return expect.unreachable('funded account read as non-funded');

  expect(progress.consistency.skipped).toBe(false);
  expect(progress.consistency.best_day_share).not.toBeNull();
  expect(progress.consistency.max).not.toBeNull();
});

test('a skipped consistency gate is carried as skipped, not as satisfied', () => {
  // INV-M4-05 at the account-detail surface. EC-050.
  const detail: AccountDetail = {
    ...DETAIL,
    progress: {
      ...DETAIL.progress,
      consistency: { best_day_share_bp: null, max_bp: null, skipped: true },
    },
  };
  const progress = toAccountDetail(detail, PINNED).progress;
  if (progress.kind !== 'funded') return expect.unreachable('funded account read as non-funded');

  expect(progress.consistency.skipped).toBe(true);
  expect(progress.consistency.best_day_share).toBeNull();
  expect(progress.consistency.max).toBeNull();
});

test('the eval card carries the funded-reset sentence from the pinned plan', () => {
  // Section 3.4 placement 2, and the sentence is the plan version's rather than
  // this repository's: `funded_reset` is typed `CopyBlock`, so no literal can
  // satisfy it.
  const evalDetail: AccountDetail = {
    ...DETAIL,
    phase: 'eval',
    funded_on: null,
    progress: {
      ...DETAIL.progress,
      profit_target_cents: 300000,
      profit_cents: 145000,
      buffer_cents: null,
      buffer_progress_cents: null,
    },
  };
  const progress = toAccountDetail(evalDetail, PINNED).progress;
  expect(progress.kind).toBe('eval');
  if (progress.kind !== 'eval') return;

  expect(progress.profit_target).toBe('3,000.00');
  expect(progress.profit).toBe('1,450.00');
  expect(progress.funded_reset).toBe(PINNED.blocks['eval.funded_reset']);
});

test('an eval card without published copy fails loudly rather than rendering a gap', () => {
  // DEP-M4-02 puts the obligation on M3's publish gate. FM-M4-05's recovery is
  // to publish the sentence, not to write one here, so the portal's only honest
  // move is to refuse.
  const evalDetail: AccountDetail = { ...DETAIL, phase: 'eval' };
  expect(() => toAccountDetail(evalDetail, { ...PINNED, blocks: {} })).toThrow(
    MissingCopyBlockError,
  );
});

test('a closed account gets neither progress card', () => {
  for (const phase of ['closed', 'graduated'] as const) {
    const progress = toAccountDetail({ ...DETAIL, phase }, PINNED).progress;
    expect(progress).toEqual({ kind: 'none' });
  }
});
