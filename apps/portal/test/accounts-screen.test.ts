import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';

import type { AccountDetail, AccountListItem, MarkListItem } from '../src/api/types.ts';
import { AccountListScreen } from '../src/app/accounts/account-list.ts';
import { AccountDetailScreen } from '../src/app/accounts/account-detail.ts';
import { AccountsSourceNotWiredError, accountsSource } from '../src/app/accounts/ports.ts';
import { MissingCopyBlockError } from '../src/copy/copy-block.ts';
import type { PinnedPlanCopy } from '../src/copy/copy-block.ts';
import { toAccountDetail, toAccountList } from '../src/view/accounts.ts';
import { toEquitySeries } from '../src/view/marks.ts';

// =============================================================================
// SC-M4-02 and SC-M4-03, RENDERED
// =============================================================================
// ../test/accounts.test.ts and ../test/marks.test.ts assert the VIEW MODELS.
// This file asserts the MARKUP, and the two are not the same claim: every
// invariant those modules express as a required field is one a component can
// still ignore, and the ones below are the ones a component ignores by
// omission rather than by writing something wrong.

const HERE = dirname(fileURLToPath(import.meta.url));

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

  // NOT `balance_cents - floor_cents`, which is 120000. ../test/accounts.test.ts
  // uses the same trick for the same reason: the only way to prove a screen
  // reads the server's field is to hand it two numbers whose difference is
  // something else.
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

function mark(trading_day: string, closing: number, corrected = false): MarkListItem {
  return {
    trading_day,
    opening_balance_cents: closing - 5000,
    closing_balance_cents: closing,
    high_balance_cents: closing + 8000,
    low_balance_cents: closing - 12000,
    realized_pnl_cents: 5000,
    traded_day: true,
    win_day: true,
    floor_cents: 5000000,
    withdrawable_cents: 0,
    corrected,
  };
}

/** Newest first, exactly as the cursor-paginated endpoint sends it. */
const MARKS: readonly MarkListItem[] = [
  mark('2026-08-20', 5120000),
  mark('2026-08-19', 5090000, true),

  // A WEEKEND SITS IN THIS GAP. 2026-08-18 is a Tuesday and the next row is the
  // Friday before it, so any renderer that filled gaps would draw six vertices
  // for four days.
  mark('2026-08-18', 5040000),
  mark('2026-08-14', 4990000),
];

const SERIES = toEquitySeries('acc_1', '2026-08-20', MARKS);

const listHtml = (items: readonly AccountListItem[]): string =>
  renderToStaticMarkup(AccountListScreen({ accounts: toAccountList(items) }));

const detailHtml = (detail: AccountDetail, pinned: PinnedPlanCopy = PINNED): string =>
  renderToStaticMarkup(
    AccountDetailScreen({ account: toAccountDetail(detail, pinned), series: SERIES }),
  );

// -----------------------------------------------------------------------------
// SC-M4-02
// -----------------------------------------------------------------------------

test('floor distance is the first figure on the card, before the balance it comes from', () => {
  // M04 section 3.1: "floor distance, because it is the number traders actually
  // watch, and it is the number that decides whether they trade tomorrow", and
  // FM-M4-08 makes that a LAYOUT requirement: "mobile layout hides the failing
  // gate below the fold ... this is a correctness bug, not a polish item."
  const html = listHtml([ITEM]);
  const at = (label: string): number => html.indexOf(`>${label}</div>`);

  expect(at('Floor distance')).toBeGreaterThan(-1);
  for (const later of ['Balance', 'Floor', 'Withdrawable', 'Account size', 'Phase', 'Status']) {
    expect(at('Floor distance'), `Floor distance precedes ${later}`).toBeLessThan(at(later));
  }
});

test('the card renders the server floor distance and never the subtraction', () => {
  const html = listHtml([ITEM]);
  expect(html).toContain('1,111.11');
  // 5120000 - 5000000 formatted. If this ever appears the screen has derived it.
  expect(html).not.toContain('>1,200.00</div>\n');
  expect(html).toContain('>1,111.11<');
});

test('each card carries its own as-of trading day, not one label for the page', () => {
  // INV-M4-02, and the reason it is per card: the marks that close a day are
  // per account, so two accounts on one screen can be as of two different days.
  const older: AccountListItem = { ...ITEM, account_id: 'acc_2', as_of_trading_day: '2026-08-13' };
  const html = listHtml([ITEM, older]);

  expect(html).toContain('close of trading day 2026-08-20');
  expect(html).toContain('close of trading day 2026-08-13');
  expect(html.match(/class="as-of"/g)).toHaveLength(2);
});

test('the list does not fold, so OQ-M4-01 stays a founder question', () => {
  // ../src/view/accounts.ts refuses to sum `withdrawable_cents` across the list
  // because OQ-M4-01 is open and any total would be a computed money value
  // (INV-M4-01). A totals row here would answer it with markup.
  const html = listHtml([ITEM, { ...ITEM, account_id: 'acc_2' }]);

  expect(html).not.toContain('2,400.00'); // the two withdrawables added
  expect(html).not.toContain('100,000.00'); // the two sizes added
  expect(html.toLowerCase()).not.toContain('total');
});

test('a blocked account names each block, and an unblocked one has no blocked row', () => {
  const blocked = listHtml([
    { ...ITEM, blocked: { payouts_frozen: true, recon_blocked: false, kyc_required: true } },
  ]);
  expect(blocked).toContain('payouts frozen');
  expect(blocked).toContain('identity verification required');
  expect(blocked).not.toContain('reconciliation incomplete');

  // An empty `blocked` is not the same fact as "eligible", so there is no row
  // at all rather than a row saying nothing is wrong.
  expect(listHtml([ITEM])).not.toContain('>Blocked<');
});

test('a trader holding no accounts gets the empty state and not a bare heading', () => {
  const html = listHtml([]);
  expect(html).toContain('You hold no accounts.');
  expect(html).not.toContain('class="row"');
});

// -----------------------------------------------------------------------------
// SC-M4-03
// -----------------------------------------------------------------------------

test('every gate is its own row with the server numbers, and there is no progress bar', () => {
  // M04 section 3.1: "every gate, gate by gate, with numbers. NEVER A SINGLE
  // PROGRESS BAR."
  const html = detailHtml(DETAIL);

  expect(html).toContain('>2 of 3<'); // win days
  expect(html).toContain('>6 of 5<'); // traded days
  expect(html).toContain('>1 of 6<'); // ladder
  expect(html).toContain('34.00%'); // best day share
  expect(html).toContain('40.00%'); // the limit

  for (const bar of ['<progress', 'role="progressbar"', 'aria-valuenow']) {
    expect(html, `no ${bar}`).not.toContain(bar);
  }
});

test('a skipped consistency gate renders disabled and shares no markup with a satisfied one', () => {
  // INV-M4-05, EC-050: "a green check on a gate that was never evaluated is a
  // lie the trader will eventually catch."
  const skipped: AccountDetail = {
    ...DETAIL,
    progress: {
      ...DETAIL.progress,
      consistency: { best_day_share_bp: null, max_bp: null, skipped: true },
    },
  };
  const html = detailHtml(skipped);

  expect(html).toContain('aria-disabled="true"');
  expect(html).toContain('not evaluated for this account');

  // The satisfied rendering's labels must be absent entirely, rather than
  // present with an empty value.
  expect(html).not.toContain('>Best day share<');
  expect(html).not.toContain('>Consistency limit<');
});

test('the cadence gap renders as a date and never as a countdown', () => {
  // EC-046: the gap is counted in TRADING days, so a "days remaining" computed
  // here is wrong in December in a way the trader reads as the rules changing.
  const html = detailHtml(DETAIL);

  expect(html).toContain('2026-08-25');
  expect(html.toLowerCase()).not.toContain('days remaining');
  expect(html.toLowerCase()).not.toContain('days to go');
});

test('the eval card carries the published funded-reset sentence, on the card', () => {
  // M04 section 3.4 placement 2. The sentence must be where the profit-target
  // progress is shown, "because that is the exact moment a trader is forming
  // the belief that the number they are watching is money they will keep".
  const evaluation: AccountDetail = {
    ...DETAIL,
    phase: 'eval',
    progress: { ...DETAIL.progress, profit_target_cents: 300000, profit_cents: 145000 },
  };
  const html = detailHtml(evaluation);

  const card = html.slice(html.indexOf('Evaluation progress'));
  expect(card).toContain('3,000.00');
  expect(card).toContain('1,450.00');
  expect(card).toContain(PINNED.blocks['eval.funded_reset']);

  // And the sentence is inside the card rather than after it.
  expect(card.indexOf('Profit target')).toBeLessThan(card.indexOf('starts at the account size'));
});

test('an eval screen cannot be rendered at all when the sentence is unpublished', () => {
  // DEP-M4-02's contract, arriving as a refusal rather than as a gap on screen.
  const evaluation: AccountDetail = { ...DETAIL, phase: 'eval' };
  expect(() => detailHtml(evaluation, { ...PINNED, blocks: {} })).toThrow(MissingCopyBlockError);
});

test('a closed account gets neither progress card', () => {
  // `NoProgressView` is a case and not a fallback, and the screen keeps it: an
  // empty funded card is the same defect one layer up.
  const html = detailHtml({ ...DETAIL, phase: 'closed', status: 'closed_admin' });

  expect(html).not.toContain('Funded progress');
  expect(html).not.toContain('Evaluation progress');
  expect(html).toContain('no longer progressing toward a gate');
  expect(html).toContain('closed by Merit');
});

// -----------------------------------------------------------------------------
// The equity chart
// -----------------------------------------------------------------------------

test('the chart draws one vertex per mark and fills no gap', () => {
  // ../src/view/marks.ts's three refusals, which only a renderer can keep. The
  // fixture spans a weekend: four marks, four vertices, and the missing days
  // are missing.
  const html = detailHtml(DETAIL);
  const balance = /class="equity-balance"[^>]*points="([^"]+)"/.exec(html);

  expect(balance?.[1]).toBeDefined();
  expect(balance?.[1]?.split(' ')).toHaveLength(MARKS.length);
});

test('a corrected day is marked on the vertex and named in text', () => {
  // M04 section 4: "a day carrying `corrected: true` is VISIBLY MARKED, because
  // a chart that silently changes shape is how trust in the data goes."
  const html = detailHtml(DETAIL);

  expect(html).toContain('class="equity-corrected"');
  expect(html).toContain('2026-08-19: superseded by a later mark');
  expect(html).toContain('>Corrected days<');

  // ONE ring, for the one corrected day, and not one per point.
  expect(html.match(/class="equity-corrected"/g)).toHaveLength(1);
});

test('the chart emits integer coordinates and no floating point literal', () => {
  const html = detailHtml(DETAIL);
  const svg = html.slice(html.indexOf('<svg'), html.indexOf('</svg>'));

  expect(svg).toMatch(/points="[\d ,]+"/);
  expect(svg, 'no decimal point in any coordinate').not.toMatch(/\d\.\d/);
});

test('the chart is labelled with the account as-of day and not the newest mark', () => {
  // ../src/view/marks.ts: the endpoint is cursor paginated, so "the newest row
  // in THIS PAGE is the newest row the client happens to hold". A chart that
  // took its label from the data would go stale the first time somebody
  // scrolled, and it would do it quietly.
  const stale = toEquitySeries('acc_1', '2026-08-27', MARKS);
  const html = renderToStaticMarkup(
    AccountDetailScreen({ account: toAccountDetail(DETAIL, PINNED), series: stale }),
  );

  expect(html).toContain('close of trading day 2026-08-27');
  expect(html).toContain('2026-08-14 to 2026-08-20'); // the page's own range, stated separately
});

test('the axis labels are figures the series carries, never a computed round number', () => {
  // INV-M4-01. The extremes are rendered from the very point strings that
  // produced them, so no money value on this screen was computed here.
  const html = detailHtml(DETAIL);

  expect(html).toContain('>51,280.00<'); // the highest high in the series
  expect(html).toContain('>50,000.00<'); // the floor, which is the lowest line drawn
});

test('an account with no closed day gets an honest chart and not an empty box', () => {
  const html = renderToStaticMarkup(
    AccountDetailScreen({
      account: toAccountDetail(DETAIL, PINNED),
      series: toEquitySeries('acc_1', '2026-08-20', []),
    }),
  );

  expect(html).toContain('No trading day has closed on this account yet.');
  expect(html).not.toContain('<svg');
});

// -----------------------------------------------------------------------------
// The segment's own fences
// -----------------------------------------------------------------------------

test('the segment renders through a port and constructs no transport of its own', () => {
  // `surface.test.ts` asserts the absence of a network call by reading source.
  // This asserts what the absence DOES: the page fails loudly rather than
  // drawing an empty list, which would render "no accounts" and "cannot reach
  // the API" as the same screen (../src/shell/app-shell.ts's distinction).
  expect(() => accountsSource()).toThrow(AccountsSourceNotWiredError);
});

test('the markup uses the compliant fixture vocabulary and invents no class', () => {
  // `apps/portal/e2e/fixtures/dashboard.compliant.html` is the only artifact in
  // this repository stating what a Merit portal screen looks like, and CI-08
  // scores the slop pass against it. A screen that invented a class name would
  // be a screen its stylesheet does not paint and its fixture does not
  // describe, and nothing else in this tree would notice.
  //
  // THE `equity-*` NAMES ARE THIS SEGMENT'S OWN AND ARE EXEMPTED BY PREFIX,
  // because the fixture holds no chart at all: SC-M4-03's chart is not on the
  // funded dashboard it renders. They are named here so the exemption is a
  // list somebody has to join rather than a pattern that quietly widens.
  const fixture = readFileSync(
    join(HERE, '..', 'e2e', 'fixtures', 'dashboard.compliant.html'),
    'utf8',
  );

  const html = detailHtml(DETAIL) + listHtml([ITEM]);
  const used = new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1]!.split(' ')));

  expect(used.size, 'classes used').toBeGreaterThan(3);

  const invented = [...used].filter(
    (name) => !name.startsWith('equity') && name !== 'copy' && !fixture.includes(`.${name} `),
  );
  expect(invented, 'class names the compliant fixture does not define').toEqual([]);
});

test('the detail screen shows every figure the card shows', () => {
  // `AccountDetailView extends AccountCardView`, so every field that reaches
  // the card reaches the detail screen too, and this compares the two
  // renderings label by label rather than trusting that they agree.
  //
  // IT IS HERE BECAUSE IT ALREADY CAUGHT ONE. The first draft of
  // ../src/app/accounts/account-detail.ts rendered the money rows and dropped
  // the phase, the status and the blocks, so a breached account's own screen
  // showed its funded progress and never said "breached" anywhere. That is the
  // worst possible place for a field to go missing: the detail screen is the
  // one somebody opens when something looks wrong.
  const breached = {
    status: 'breached',
    blocked: { payouts_frozen: true, recon_blocked: true, kyc_required: true },
  } as const;

  const labels = (html: string): Set<string> =>
    new Set([...html.matchAll(/<div class="label">([^<]+)<\/div>/g)].map((m) => m[1]!));

  const onCard = labels(listHtml([{ ...ITEM, ...breached }]));
  const onDetail = labels(detailHtml({ ...DETAIL, ...breached }));

  expect([...onCard].filter((label) => !onDetail.has(label))).toEqual([]);
  expect(onCard.size, 'figures on the card').toBeGreaterThan(5);
});
