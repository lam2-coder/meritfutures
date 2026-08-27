// =============================================================================
// apps/portal/src/app/(purchases)/purchases-screen.ts
// =============================================================================
// SC-M4-06 as markup. M04 section 3.1's one thing this screen must get right is
// "the rule diff when versions differ (SD-M4-02)", so the diff is the larger
// half of this file and the history list is the smaller one.
//
// THIS SCREEN IS NOT A PUBLIC ARTIFACT AND THE DIFFERENCE FROM ITS SIBLING IS
// THE POINT. ./certificates-screen.ts renders something designed to leave the
// application, so ./model.ts reduces it to a closed list of publishable fields
// first. A purchase is the trader's own record on the trader's own authenticated
// screen (INV-M4-10), so it carries its own identifiers and its own account
// reference and neither is a leak. Applying the certificate rule here would be
// cargo cult, and applying the purchase rule there would be the failure the
// certificate rule exists to prevent.
//
// The `.ts` and the stylesheet-free layout are ./certificates-screen.ts's
// headers, for the same two reasons.

import { createElement as h, type ReactElement, type ReactNode } from 'react';

import type { PurchaseRowView, RuleChangeView, RuleDiffView } from '../../view/purchases.ts';
import type { PurchasesPageModel, ResetDiffPanel } from './model.ts';

/** The status union, in the trader's words. `charged_back` is not a word. */
const STATUS_TEXT: Readonly<Record<PurchaseRowView['status'], string>> = {
  pending: 'Payment pending',
  paid: 'Paid',
  failed: 'Payment failed',
  refunded: 'Refunded',
  charged_back: 'Charged back',
};

const CHANGE_TEXT: Readonly<Record<RuleChangeView['kind'], string>> = {
  changed: 'changed',
  added: 'new in this version',
  removed: 'no longer in this version',
};

function fact(label: string, value: string): readonly ReactElement[] {
  return [
    h('dt', { key: `${label}-t`, className: 'merit-fact-label' }, label),
    h('dd', { key: `${label}-d`, className: 'merit-fact-value' }, value),
  ];
}

/**
 * One purchase.
 *
 * NO TOTAL, ANYWHERE, AND THERE IS NOWHERE TO PUT ONE. ../../view/purchases.ts
 * states it about the view model and it binds equally here: summing
 * `amount_paid` across the list is arithmetic on a money field (INV-M4-01) and
 * it is a number the server has never published.
 *
 * THE MONEY VALUES CARRY NO CURRENCY SYMBOL AND THAT IS ../../format/money.ts's
 * ruling rather than an omission: "there is no currency field on any response
 * and no ruled display locale", so a symbol here would be a claim invented in
 * the client. The label carries the meaning and the digits carry the value.
 */
function purchase(row: PurchaseRowView): ReactElement {
  const facts: ReactNode[] = [
    ...fact('Plan', `${row.plan.code}, version ${String(row.plan.version)}`),
    ...fact('Account size', row.size),
    ...fact('Paid', row.amount_paid),
    // A STATED ZERO DISCOUNT IS A FACT AND IS RENDERED. ../../view/purchases.ts
    // says so about the field, and a screen that hid a zero would leave a trader
    // unable to tell "no discount applied" from "we did not say".
    ...fact('Discount', row.discount),
    ...fact('Status', STATUS_TEXT[row.status]),
  ];

  facts.push(
    ...fact(
      'Account',
      // `provisioning_pending` is a real state on the account status union and
      // not a defect, so the absence is described rather than blanked.
      row.account_id === null ? 'Being set up' : row.account_id,
    ),
  );

  return h(
    'li',
    { key: row.purchase_id, className: 'merit-purchase' },
    h(
      'article',
      null,
      h(
        'h2',
        null,
        row.kind === 'reset' ? 'Reset' : 'New evaluation',
        ' on ',
        h('time', { dateTime: row.created_at }, row.created_at),
      ),
      h('dl', { className: 'merit-purchase-facts' }, facts),
      // `settled` IS READ OFF THE STATUS UNION AND NEVER OFF AN AMOUNT.
      // ../../view/purchases.ts: "a refunded purchase still carries the amount
      // that was paid, and reading the number would call it settled."
      row.settled
        ? null
        : h(
            'p',
            { className: 'merit-purchase-unsettled' },
            'This payment has not settled, so the amount above is what was ' +
              'charged and not what Merit is holding.',
          ),
    ),
  );
}

/**
 * One changed rule path, BOTH SIDES AND NEVER A DIFFERENCE.
 *
 * INV-M4-01 at the place the subtraction looks harmless. ../../view/purchases.ts
 * builds `was` and `now` as JSON text off each version's own response and leaves
 * no field a delta could be written into, so there is nothing to render here
 * except the two values the trader agreed to and did not agree to.
 */
function change(item: RuleChangeView): ReactElement {
  const sides: ReactNode[] = [];
  if (item.was !== null) sides.push(...fact('Was', item.was));
  if (item.now !== null) sides.push(...fact('Now', item.now));

  return h(
    'li',
    { key: item.rule_path, className: `merit-rule-change merit-rule-${item.kind}` },
    h('p', { className: 'merit-rule-path' }, item.rule_path, ', ', CHANGE_TEXT[item.kind]),
    h('dl', null, sides),
  );
}

/**
 * The diff for one reset.
 *
 * THREE OUTCOMES AND NOT TWO. `versions_differ` false, `versions_differ` true
 * with `differs` false, and a real diff are three different sentences, and
 * ../../view/purchases.ts carries `differs` as its own field rather than as an
 * empty-array check for exactly this: "the versions are identical" and "the diff
 * has not been computed" must not render the same.
 */
function diffBody(diff: RuleDiffView): ReactElement {
  if (!diff.versions_differ) {
    return h(
      'p',
      { className: 'merit-rule-same-version' },
      'This reset bought the same plan version you already held, so the terms ' +
        'are the ones you already agreed to.',
    );
  }

  if (!diff.differs) {
    return h(
      'p',
      { className: 'merit-rule-no-change' },
      `Version ${String(diff.from.version)} was replaced by version ` +
        `${String(diff.to.version)} and no rule changed between them.`,
    );
  }

  return h(
    'div',
    null,
    h(
      'p',
      { className: 'merit-rule-summary' },
      `These rules differ between version ${String(diff.from.version)}, which you ` +
        `held, and version ${String(diff.to.version)}, which this reset bought.`,
    ),
    h('ul', { className: 'merit-rule-changes' }, diff.changes.map(change)),
  );
}

/** SD-M4-02's panel, including the case where no comparison could be made. */
function resetPanel(panel: ResetDiffPanel): ReactElement {
  if (panel.state === 'unpairable') {
    return h(
      'li',
      { key: panel.purchase_id, className: 'merit-reset merit-reset-unpairable' },
      h('h3', null, `Reset on ${panel.plan_code}`),
      h('p', { className: 'merit-rule-unpairable' }, panel.reason),
    );
  }

  return h(
    'li',
    { key: panel.purchase_id, className: 'merit-reset' },
    h('h3', null, `Reset on ${panel.plan_code}`),
    diffBody(panel.diff),
  );
}

/**
 * SC-M4-06.
 *
 * SYNCHRONOUS AND PURE. The `await`s live in ./purchases/page.ts.
 */
export function PurchasesScreen({ model }: { model: PurchasesPageModel }): ReactElement {
  return h(
    'main',
    { className: 'merit-screen merit-screen-purchases' },
    h('h1', null, 'Purchases'),

    model.history.rows.length === 0
      ? h('p', { className: 'merit-empty' }, 'No purchases yet.')
      : h('ul', { className: 'merit-purchase-list' }, model.history.rows.map(purchase)),

    model.resets.length > 0
      ? h(
          'section',
          { className: 'merit-resets' },
          h('h2', null, 'What changed when you reset'),
          h('ul', { className: 'merit-reset-list' }, model.resets.map(resetPanel)),
        )
      : null,
  );
}
