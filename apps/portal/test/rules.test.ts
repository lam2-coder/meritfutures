import { expect, test } from 'vitest';

import type { PlanVersionResponse } from '../src/api/types.ts';
import { MissingCopyBlockError } from '../src/copy/copy-block.ts';
import { toRulesView } from '../src/view/rules.ts';

// =============================================================================
// SC-M4-05: the rules page reads the PINNED version and authors nothing
// =============================================================================

function version(over: Partial<PlanVersionResponse> = {}): PlanVersionResponse {
  return {
    plan_version_id: 'pv-1',
    plan_id: 'plan-core-eod',
    version: 3,
    status: 'published',
    published_at: '2026-06-01T00:00:00Z',
    retired_at: null,
    rules: { schema_version: 1, phase_funded: { buffer_bp: 200, max_payouts: 5 } },
    copy_blocks: {
      'funded.buffer': 'You keep a 2% buffer above the floor before a payout clears.',
      'eval.funded_reset': 'Funded starts at the account size. Eval profit is not carried.',
    },
    sizes: [
      {
        size_cents: 5_000_000,
        price_cents: 32_900,
        reset_price_cents: 24_900,
        drawdown_cents: 250_000,
        profit_target_cents: 300_000,
        buffer_cents: 100_000,
        win_day_floor_cents: 15_000,
        payout_cap_cents: 150_000,
        min_payout_cents: 10_000,
      },
    ],
    ...over,
  };
}

test('every clause on the page came out of the pinned version, in key order', () => {
  const view = toRulesView(version());

  expect(view.clauses.map((c) => c.rule_path)).toEqual(['eval.funded_reset', 'funded.buffer']);
  expect(view.clauses[0]!.sentence).toBe(
    'Funded starts at the account size. Eval profit is not carried.',
  );

  // The ordering is asserted rather than assumed: `Object.keys` on a parsed JSON
  // object preserves insertion order, so an unsorted page would render the
  // clauses in whatever order the server happened to serialise them, and two
  // renders of one contract could differ.
  expect(view.clauses.map((c) => c.rule_path)).toEqual(
    [...view.clauses.map((c) => c.rule_path)].sort(),
  );
});

test('a version that published no copy is refused and names the version', () => {
  // INV-M4-08 by omission: a rules page rendering an empty list looks like it
  // worked and tells the trader nothing about the contract binding them.
  // DEP-M4-02 makes it a publish-gate defect upstream, so the portal's job is
  // to make it visible.
  expect(() => toRulesView(version({ copy_blocks: {} }))).toThrow(MissingCopyBlockError);

  try {
    toRulesView(version({ copy_blocks: {} }));
  } catch (err) {
    expect(err).toBeInstanceOf(MissingCopyBlockError);
    expect((err as MissingCopyBlockError).plan_id).toBe('plan-core-eod');
    expect((err as MissingCopyBlockError).version).toBe(3);
  }
});

test('a blank clause is missing rather than empty', () => {
  // 0042's `reason_detail` precedent: a column that accepts a space is a column
  // that will hold one, and a rule sentence made of one space renders as a gap
  // that no check looking for presence would catch.
  expect(() => toRulesView(version({ copy_blocks: { 'funded.buffer': '   ' } }))).toThrow(
    MissingCopyBlockError,
  );
});

test('a retired version renders as a state and never as an error', () => {
  // API_CONTRACT section 4 serves retired versions deliberately, "so a trader
  // can always retrieve the contract they bought". A trader on a superseded
  // contract is reading the right page.
  const view = toRulesView(version({ status: 'retired', retired_at: '2026-08-01T00:00:00Z' }));

  expect(view.status).toBe('retired');
  expect(view.superseded).toBe(true);
  expect(view.retired_at).toBe('2026-08-01T00:00:00Z');
  expect(view.clauses.length).toBeGreaterThan(0);
});

test('supersession is read off the status and never off a date', () => {
  // A retired_at in the past with a published status would be a contradiction
  // the server owns. The portal reads the answer rather than recomputing it,
  // which is INV-M4-03's posture applied to a lifecycle instead of to a gate.
  const view = toRulesView(version({ status: 'published', retired_at: '2020-01-01T00:00:00Z' }));
  expect(view.superseded).toBe(false);
});

test('every money value on the page is a formatted string and no raw cents survive', () => {
  const view = toRulesView(version());
  const size = view.sizes[0]!;

  expect(size.size).toBe('50,000.00');
  expect(size.price).toBe('329.00');
  expect(size.reset_price).toBe('249.00');
  expect(size.payout_cap).toBe('1,500.00');

  // INV-M4-01 structurally: nothing on this view model is a number, so there is
  // nothing downstream to do arithmetic on.
  for (const [key, value] of Object.entries(size)) {
    expect(typeof value, `${key} is a string or an explicit absence`).not.toBe('number');
  }
});

test('an absent profit target renders as an absence and never as a zero', () => {
  // A zero profit target is a rule. An absent one is a different rule, and a
  // funded-only plan shape carries no eval target at all.
  const view = toRulesView(
    version({
      sizes: [{ ...version().sizes[0]!, profit_target_cents: null }],
    }),
  );

  expect(view.sizes[0]!.profit_target).toBeNull();
});

test('the size order is the server order and is not re-sorted here', () => {
  // A numeric sort would be arithmetic on a `_cents` field in the one place it
  // looks innocent, and the server already has an opinion about order.
  const base = version().sizes[0]!;
  const view = toRulesView(
    version({
      sizes: [
        { ...base, size_cents: 10_000_000 },
        { ...base, size_cents: 2_500_000 },
      ],
    }),
  );

  expect(view.sizes.map((s) => s.size)).toEqual(['100,000.00', '25,000.00']);
});
