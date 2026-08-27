import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';

import { FIXTURE_PORTS } from '../src/app/(purchases)/fixtures.ts';
import { purchasesPageModel } from '../src/app/(purchases)/model.ts';
import type { PurchasesSegmentPorts } from '../src/app/(purchases)/ports.ts';
import { PurchasesScreen } from '../src/app/(purchases)/purchases-screen.ts';

// =============================================================================
// SC-M4-06 RENDERED: THE RULE DIFF, AND THE OMISSION THAT WOULD READ AS A CLAIM
// =============================================================================
// M04 section 3.1's one thing this screen must get right is "the rule diff when
// versions differ (SD-M4-02)", so most of this file is about the diff and about
// the three states it has to keep apart.
//
// The purchases screen is NOT a public artifact, so it carries no absence
// assertion of the kind ./page-certificates.test.ts is built around. A purchase
// is the trader's own record on the trader's own authenticated screen
// (INV-M4-10) and its identifiers are theirs. The one absence that binds here is
// the money one, and it is INV-M4-01's.

async function renderPurchases(ports: PurchasesSegmentPorts = FIXTURE_PORTS): Promise<string> {
  return renderToStaticMarkup(PurchasesScreen({ model: await purchasesPageModel(ports) }));
}

test('the history renders in the order the server sent, unsorted', async () => {
  const model = await purchasesPageModel(FIXTURE_PORTS);
  const items = await FIXTURE_PORTS.readPurchases();

  expect(model.history.rows.map((r) => r.purchase_id)).toEqual(items.map((i) => i.purchase_id));

  // ../src/view/purchases.ts: "re-sorting here would produce a page whose second
  // screenful does not follow its first."
  const html = await renderPurchases();
  const order = [...html.matchAll(/class="merit-purchase"/g)].length;
  expect(order).toBe(items.length);
});

test('NO TOTAL IS RENDERED AND THERE IS NOWHERE TO PUT ONE', async () => {
  // INV-M4-01 bans client-side money arithmetic. Summing `amount_paid_cents`
  // across the page is the obvious next feature and it is also a number the
  // server has never published, so the portal would be the first surface a
  // trader could read their lifetime spend from.
  const html = await renderPurchases();

  // ASSERTED OVER THE VISIBLE TEXT AND WITH WORD BOUNDARIES. A substring check
  // over the whole document reads class names too, and `merit-rule-summary`
  // contains `sum`: the first draft of this test failed on its own markup, which
  // is a check reporting a defect that is not there and would have been silenced
  // by weakening it rather than by sharpening it.
  const text = html.replace(/<[^>]*>/g, ' ').toLowerCase();
  for (const word of ['total', 'lifetime', 'sum', 'spent', 'altogether']) {
    expect(text, `no "${word}" appears on the purchases page`).not.toMatch(
      new RegExp(`\\b${word}`, 'u'),
    );
  }

  const items = await FIXTURE_PORTS.readPurchases();
  const sum = items.reduce((acc, i) => acc + i.amount_paid_cents, 0);
  // The number the page would carry if somebody added the obvious feature,
  // computed HERE so the assertion is about the page rather than about a habit.
  // 72,500 cents renders as `725.00` through ../src/format/money.ts.
  expect(sum).toBe(72_500);
  expect(html).not.toContain('725.00');
});

test('a stated zero discount is rendered, because it is a fact', async () => {
  const html = await renderPurchases();
  const discounts = [...html.matchAll(/<dt class="merit-fact-label">Discount<\/dt>/g)];
  const items = await FIXTURE_PORTS.readPurchases();
  expect(discounts).toHaveLength(items.length);
  expect(html).toContain('>0.00<');
});

test('settled is read off the status union and never off an amount', async () => {
  const model = await purchasesPageModel(FIXTURE_PORTS);
  const refunded = model.history.rows.find((r) => r.status === 'refunded');
  expect(refunded).toBeDefined();

  // A refunded purchase still carries the amount that was paid. Reading the
  // number would call it settled.
  expect(refunded!.amount_paid).toBe('249.00');
  expect(refunded!.settled).toBe(false);

  const html = await renderPurchases();
  expect(html).toContain('This payment has not settled');
});

test('a pending purchase with no account yet says so rather than blanking', async () => {
  const html = await renderPurchases();
  // `provisioning_pending` is a real and temporary state on the account status
  // union, not a defect, so the absence is described.
  expect(html).toContain('Being set up');
  expect(html).toContain('Payment pending');
});

test('THE RULE DIFF RENDERS BOTH SIDES AND NEVER A DIFFERENCE', async () => {
  const model = await purchasesPageModel(FIXTURE_PORTS);
  const paired = model.resets.find((p) => p.state === 'paired');
  expect(paired).toBeDefined();
  if (paired?.state !== 'paired') throw new Error('unreachable');

  expect(paired.diff.versions_differ).toBe(true);
  expect(paired.diff.differs).toBe(true);
  expect(paired.diff.changes.map((c) => c.rule_path)).toEqual([
    'phase_funded.buffer_bp',
    'phase_funded.cadence_gap_trading_days',
    'phase_funded.payout_cap_schedule',
    'phase_funded.payout_review_trading_days',
  ]);

  // Both sides, off each version's own response, with no field a delta could be
  // written into. INV-M4-01 at the one place the subtraction looks harmless.
  const html = await renderPurchases();
  expect(html).toContain('>Was</dt>');
  expect(html).toContain('>Now</dt>');
  expect(html).toContain('>200<');
  expect(html).toContain('>250<');
  // The delta a naive diff would have rendered instead.
  expect(html, 'no rule delta is computed').not.toContain('>50<');
  expect(html).not.toContain('+50');
});

test('an array rule is one leaf and is not walked by index', async () => {
  // `payout_cap_schedule` is "an array from day one even though v1 has one step"
  // (DATA_MODEL section 11), so its meaning is positional and an inserted step
  // would renumber every later index. It changed or it did not.
  const model = await purchasesPageModel(FIXTURE_PORTS);
  const paired = model.resets.find((p) => p.state === 'paired');
  if (paired?.state !== 'paired') throw new Error('unreachable');

  const schedule = paired.diff.changes.find(
    (c) => c.rule_path === 'phase_funded.payout_cap_schedule',
  );
  expect(schedule?.kind).toBe('changed');
  expect(paired.diff.changes.some((c) => c.rule_path.includes('.0.'))).toBe(false);
});

test('added and changed are distinct on the page, not collapsed', async () => {
  const html = await renderPurchases();
  expect(html).toContain('phase_funded.payout_review_trading_days, new in this version');
  expect(html).toContain('phase_funded.buffer_bp, changed');
});

test('A RESET WHOSE PARTNER IS NOT ON THE PAGE IS UNPAIRABLE, NEVER UNCHANGED', async () => {
  // The whole point. A cursor list has a second page, so the earlier purchase is
  // legitimately absent, and a diff panel that rendered nothing there would say
  // "your terms did not change" about a comparison it never made. An omission
  // that reads as a positive claim is the worst failure available on a screen
  // whose job is to be the record of what the trader agreed to.
  const model = await purchasesPageModel(FIXTURE_PORTS);
  const unpairable = model.resets.find((p) => p.state === 'unpairable');
  expect(unpairable).toBeDefined();
  expect(unpairable?.purchase_id).toBe('pur_3');

  const html = await renderPurchases();
  expect(html).toContain('is not on this page of the list');
  expect(html).toContain('It is not a statement that the terms are unchanged.');
});

test('identical versions and an unchanged pair are two different sentences', async () => {
  // ../src/view/purchases.ts carries `differs` as its own field rather than as
  // an empty-array check for exactly this reason.
  const items = await FIXTURE_PORTS.readPurchases();
  const sameVersion = items.map((i) =>
    i.purchase_id === 'pur_5' ? { ...i, plan: { ...i.plan, version: 3 } } : i,
  );
  const ports: PurchasesSegmentPorts = {
    ...FIXTURE_PORTS,
    readPurchases: () => Promise.resolve(sameVersion),
  };

  const html = await renderPurchases(ports);
  expect(html).toContain('the same plan version you already held');
  expect(html).not.toContain('no rule changed between them');
});
