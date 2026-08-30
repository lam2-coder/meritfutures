import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import { stripComments } from '../../../packages/tooling/checks/strip-comments.mjs';

import type { PlanRules, PlanVersionResponse, PurchaseListItem } from '../src/api/types.ts';
import { toPurchaseHistory, toRuleDiff } from '../src/view/purchases.ts';

// =============================================================================
// SC-M4-06: the history, and a rule diff that renders both sides and no delta
// =============================================================================

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function purchase(over: Partial<PurchaseListItem> = {}): PurchaseListItem {
  return {
    purchase_id: 'pur-1',
    created_at: '2026-07-04T13:00:00Z',
    kind: 'new',
    plan: { plan_id: 'plan-core-eod', code: 'core_eod', version: 3 },
    size_cents: 5_000_000,
    amount_paid_cents: 32_900,
    discount_cents: 0,
    status: 'paid',
    account_id: 'acct-1',
    ...over,
  };
}

function version(rules: PlanRules, over: Partial<PlanVersionResponse> = {}): PlanVersionResponse {
  return {
    plan_version_id: 'pv-1',
    plan_id: 'plan-core-eod',
    version: 3,
    status: 'published',
    published_at: '2026-06-01T00:00:00Z',
    retired_at: null,
    rules,
    copy_blocks: { 'funded.buffer': 'A sentence.' },
    sizes: [],
    ...over,
  };
}

// -----------------------------------------------------------------------------
// The history
// -----------------------------------------------------------------------------

test('every money field on a purchase row is formatted and none is combined', () => {
  const view = toPurchaseHistory([purchase({ amount_paid_cents: 29_900, discount_cents: 3_000 })]);
  const row = view.rows[0]!;

  expect(row.size).toBe('50,000.00');
  expect(row.amount_paid).toBe('299.00');
  expect(row.discount).toBe('30.00');

  // A stated zero discount is a fact and is rendered rather than hidden.
  expect(toPurchaseHistory([purchase()]).rows[0]!.discount).toBe('0.00');
});

test('settled is read off the status union and never off an amount', () => {
  // A refunded purchase still carries the amount that was paid. Reading the
  // number would call it settled, which is the one reading a chargeback dispute
  // turns on.
  expect(toPurchaseHistory([purchase({ status: 'paid' })]).rows[0]!.settled).toBe(true);

  for (const status of ['pending', 'failed', 'refunded', 'charged_back'] as const) {
    expect(
      toPurchaseHistory([purchase({ status })]).rows[0]!.settled,
      `${status} is not settled`,
    ).toBe(false);
  }
});

test('a purchase with no account yet is a state and not a defect', () => {
  const row = toPurchaseHistory([purchase({ status: 'pending', account_id: null })]).rows[0]!;
  expect(row.account_id).toBeNull();
  expect(row.settled).toBe(false);
});

test('the list order is the server order', () => {
  // `GET /purchases` is a cursor list. Re-sorting here produces a page whose
  // second screenful does not follow its first.
  const view = toPurchaseHistory([
    purchase({ purchase_id: 'b', created_at: '2026-01-01T00:00:00Z' }),
    purchase({ purchase_id: 'a', created_at: '2026-09-01T00:00:00Z' }),
  ]);
  expect(view.rows.map((r) => r.purchase_id)).toEqual(['b', 'a']);
});

test('no total is computed and there is no field to put one in', () => {
  const view = toPurchaseHistory([purchase(), purchase({ purchase_id: 'pur-2' })]);
  expect(Object.keys(view)).toEqual(['rows']);
});

// -----------------------------------------------------------------------------
// The rule diff
// -----------------------------------------------------------------------------

test('a changed rule renders both sides and no difference', () => {
  const diff = toRuleDiff(
    version({ phase_funded: { buffer_bp: 200 } }),
    version({ phase_funded: { buffer_bp: 250 } }, { plan_version_id: 'pv-2', version: 4 }),
  );

  expect(diff.differs).toBe(true);
  expect(diff.versions_differ).toBe(true);
  expect(diff.changes).toEqual([
    { rule_path: 'phase_funded.buffer_bp', kind: 'changed', was: '200', now: '250' },
  ]);

  // INV-M4-01 structurally: there is no field on a change a delta could be
  // written into, so "it rose by 50" cannot be rendered even by accident.
  expect(Object.keys(diff.changes[0]!)).toEqual(['rule_path', 'kind', 'was', 'now']);
});

test('a key present on one side only is a change and not a skip', () => {
  const diff = toRuleDiff(
    version({ phase_eval: { max_days: null } }),
    version({ phase_eval: { max_days: null, min_trading_days: 1 } }),
  );

  expect(diff.changes).toEqual([
    { rule_path: 'phase_eval.min_trading_days', kind: 'added', was: null, now: '1' },
  ]);
});

test('a removed rule is reported as removed and not as unchanged', () => {
  const diff = toRuleDiff(
    version({ limits: { max_accounts_per_entity: 10 } }),
    version({ limits: {} }),
  );

  // The block itself becomes an empty-object leaf, so the removal of its only
  // key is visible from both directions rather than vanishing.
  expect(diff.changes.map((c) => [c.rule_path, c.kind])).toEqual([
    ['limits', 'added'],
    ['limits.max_accounts_per_entity', 'removed'],
  ]);
});

test('an array is one leaf, because its meaning is positional', () => {
  // `payout_cap_schedule` is "an array from day one even though v1 has one
  // step" (DATA_MODEL section 11). Walking into it would make an inserted step
  // renumber every later index and claim the whole schedule moved.
  const diff = toRuleDiff(
    version({ phase_funded: { payout_cap_schedule: [{ from_ordinal: 1, cap_bp: 300 }] } }),
    version({
      phase_funded: {
        payout_cap_schedule: [
          { from_ordinal: 1, cap_bp: 300 },
          { from_ordinal: 3, cap_bp: 400 },
        ],
      },
    }),
  );

  expect(diff.changes).toHaveLength(1);
  expect(diff.changes[0]!.rule_path).toBe('phase_funded.payout_cap_schedule');
});

test('identical rules on two different versions differ in version and not in rules', () => {
  // AS-M3-05 requires acknowledgement of a reset onto a CHANGED version. "The
  // versions are identical" and "the diff has not been computed" must not
  // render the same, so `differs` is a field rather than an empty-array check.
  const rules: PlanRules = { schema_version: 1, phase_funded: { buffer_bp: 200 } };
  const diff = toRuleDiff(version(rules), version(rules, { plan_version_id: 'pv-2', version: 4 }));

  expect(diff.versions_differ).toBe(true);
  expect(diff.differs).toBe(false);
  expect(diff.changes).toEqual([]);
});

test('a numeric spelling change is reported rather than canonicalised away', () => {
  // OI-29b read from the other side: `jsonb::text` is not canonical over
  // numbers, so treating 5 and 5.0 as equal here would be the portal asserting
  // a canonicalisation the database does not perform. On a rule diff the safe
  // direction is to over-report.
  const diff = toRuleDiff(
    version({ phase_funded: { max_payouts: 5 } }),
    version({ phase_funded: { max_payouts: 5.0000001 } }),
  );
  expect(diff.differs).toBe(true);
});

test('the diff walks the whole rule object and knows none of its keys', () => {
  // The portal must not carry a second copy of the rule schema. A rule that
  // gains a key the portal has never heard of still diffs, which is the
  // property a typed walk cannot have.
  const diff = toRuleDiff(
    version({ a_rule_nobody_has_written_yet: { deep: { deeper: 1 } } }),
    version({ a_rule_nobody_has_written_yet: { deep: { deeper: 2 } } }),
  );

  expect(diff.changes[0]!.rule_path).toBe('a_rule_nobody_has_written_yet.deep.deeper');
});

test('the rule diff performs no arithmetic on any value it renders', () => {
  // A source-level assertion, because the design rule is about an operator that
  // does not appear rather than about an output. The failure it prevents is a
  // later session adding a `delta` field because the number "was right there".
  // Stripped by the shared home (ADR-279) rather than by a comment regex: a
  // block-comment OPENER written inside a LINE comment opened a phantom block that
  // ran to the next real closer and took every line between them with it.
  const code = stripComments(readFileSync(join(SRC, 'view', 'purchases.ts'), 'utf8'));

  for (const operator of [' - ', ' * ', ' / ', ' % ', '+=', '-=']) {
    expect(code.includes(operator), `${operator} appears in purchases.ts`).toBe(false);
  }
});
