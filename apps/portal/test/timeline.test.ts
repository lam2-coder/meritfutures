import { expect, test } from 'vitest';

import type { TimelineItem } from '../src/api/types.ts';
import { toTimelineView } from '../src/view/timeline.ts';

// =============================================================================
// M4-R: the account timeline, which filters nothing
// =============================================================================

const ITEMS: readonly TimelineItem[] = [
  {
    occurred_at: '2026-08-18T21:05:00Z',
    trading_day: '2026-08-18',
    kind: 'day.closed',
    summary: 'Trading day closed.',
    detail: { closing_balance_cents: 5100000, win_day: false },
  },
  {
    occurred_at: '2026-08-19T21:05:00Z',
    trading_day: '2026-08-19',
    kind: 'rule.floor_locked',
    summary: 'Your drawdown floor is now permanent.',
    detail: { floor_cents: 5000000, loss_room_cents: 90000 },
  },
  {
    occurred_at: '2026-08-20T14:11:00Z',
    trading_day: '2026-08-20',
    kind: 'phase.pass_deferred_consistency',
    summary: 'Your evaluation target is met and the consistency rule is not yet satisfied.',
    detail: {
      best_day_share_bp: 4400,
      max_bp: 4000,
      profit_needed_to_dilute_cents: 62500,
      note: 'see the rules page',
    },
  },
];

test('every entry the server sent is rendered, in the order it sent them', () => {
  // INV-M4-06 stated as a number. A client-side allowlist would hide a leak in
  // the server's projection from everyone except the person reading the raw
  // response, and it would let the negative-authz suite pass against a broken
  // projection because the screen looked right.
  const view = toTimelineView('acc_1', '2026-08-20', ITEMS);
  expect(view.entries).toHaveLength(ITEMS.length);
  expect(view.entries.map((e) => e.kind)).toEqual([
    'day.closed',
    'rule.floor_locked',
    'phase.pass_deferred_consistency',
  ]);
});

test('an event kind this build has never seen still renders, with its own sentence', () => {
  // `summary` is composed server side, so a new event type arrives ready to
  // display. Skipping unknown kinds would silently drop the newest thing that
  // happened to the account, which is the entry a trader is most likely opening
  // the timeline to find.
  const view = toTimelineView('acc_1', '2026-08-20', [
    {
      occurred_at: '2026-08-21T09:00:00Z',
      trading_day: '2026-08-21',
      kind: 'some.event.this.build.predates',
      summary: 'Something the server knows how to describe and this client does not.',
      detail: {},
    },
  ]);

  expect(view.entries).toHaveLength(1);
  expect(view.entries[0]?.kind).toBe('some.event.this.build.predates');
  expect(view.entries[0]?.summary).toBe(
    'Something the server knows how to describe and this client does not.',
  );
});

test('money inside detail is formatted, and is flagged as money', () => {
  // FM-M4-01 by a unit rather than by a value: a raw 5100000 rendered beside a
  // formatted 51,000.00 is a displayed number disagreeing with the engine, and
  // the value was right the whole time.
  const view = toTimelineView('acc_1', '2026-08-20', ITEMS);
  const floorLocked = view.entries[1]!;

  expect(floorLocked.detail).toEqual([
    { key: 'floor_cents', value: '50,000.00', is_money: true },
    { key: 'loss_room_cents', value: '900.00', is_money: true },
  ]);
});

test('basis points inside detail are formatted as basis points', () => {
  const view = toTimelineView('acc_1', '2026-08-20', ITEMS);
  const deferred = view.entries[2]!;

  expect(deferred.detail).toEqual([
    { key: 'best_day_share_bp', value: '44.00%', is_money: true },
    { key: 'max_bp', value: '40.00%', is_money: true },
    { key: 'profit_needed_to_dilute_cents', value: '625.00', is_money: true },
    { key: 'note', value: 'see the rules page', is_money: false },
  ]);
});

test('a non-money detail is carried untouched, whatever its type', () => {
  const view = toTimelineView('acc_1', '2026-08-20', [
    {
      occurred_at: '2026-08-20T21:05:00Z',
      trading_day: '2026-08-20',
      kind: 'breach.detected',
      summary: 'The account breached its drawdown floor.',
      detail: { breach_kind: 'trailing_drawdown', traded_day: true, reviewed_at: null, streak: 3 },
    },
  ]);

  expect(view.entries[0]?.detail).toEqual([
    { key: 'breach_kind', value: 'trailing_drawdown', is_money: false },
    { key: 'traded_day', value: true, is_money: false },
    { key: 'reviewed_at', value: null, is_money: false },
    { key: 'streak', value: 3, is_money: false },
  ]);
});

test('a money-suffixed key carrying a non-number does not blank the screen', () => {
  // The server is entitled to send this. Throwing would take the whole timeline
  // down at the moment something unusual happened, which is exactly when a
  // trader is reading it.
  const view = toTimelineView('acc_1', '2026-08-20', [
    {
      occurred_at: '2026-08-20T21:05:00Z',
      trading_day: '2026-08-20',
      kind: 'payout.transfer_failed',
      summary: 'The transfer did not complete and will be retried.',
      detail: { amount_cents: 'unavailable', retry_at: '2026-08-21T09:00:00Z' },
    },
  ]);

  expect(view.entries[0]?.detail).toEqual([
    { key: 'amount_cents', value: 'unavailable', is_money: false },
    { key: 'retry_at', value: '2026-08-21T09:00:00Z', is_money: false },
  ]);
});

test('a null trading day survives, because not every event belongs to one', () => {
  const view = toTimelineView('acc_1', '2026-08-20', [
    {
      occurred_at: '2026-08-20T10:00:00Z',
      trading_day: null,
      kind: 'kyc.verified',
      summary: 'Identity verification completed.',
      detail: {},
    },
  ]);
  expect(view.entries[0]?.trading_day).toBeNull();
});

test('an empty timeline is empty and still carries its as-of day', () => {
  const view = toTimelineView('acc_1', '2026-08-20', []);
  expect(view.entries).toEqual([]);
  expect(view.as_of_trading_day).toBe('2026-08-20');
});
