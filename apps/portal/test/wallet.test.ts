import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import type { WalletEntry, WalletResponse } from '../src/api/types.ts';
import {
  WALLET_ERROR_COPY,
  Wallet,
  WalletError,
  WalletUnavailable,
} from '../src/app/wallet/sections.ts';
import { REQUIRED_ENDPOINTS, readyFrom } from '../src/app/wallet/source.ts';
import { copyBlock } from '../src/copy/copy-block.ts';
import type { PinnedPlanCopy } from '../src/copy/copy-block.ts';
import { toWalletView, walletFraming } from '../src/view/wallet.ts';
import type { WalletCopy } from '../src/view/wallet.ts';

// =============================================================================
// SC-M4-10, RENDERED OVER RESPONSES TRANSCRIBED FROM API_CONTRACT SECTION 6.2
// =============================================================================
// The fixtures below are the contract's own shapes with the contract's own field
// names, and every money value in them is an INTEGER number of cents. The
// dispatch protocol binds fixtures to that rule explicitly -- "Money is integer
// cents. No floats in financial paths, INCLUDING doc examples and fixtures" --
// and this file is where the rule is easiest to break without anything noticing,
// because a float in a fixture renders through `formatCents` as a `RangeError`
// only if the value is not safe-integer.
//
// ONE FIXTURE IS DELIBERATELY NOT ROUND. `held_cents` is `1_250` and the entries
// carry `4_207` and `50`, so a formatter that dropped a decimal place or grouped
// wrongly changes the rendered string rather than producing the same one.

const WALLET: WalletResponse = {
  balance_cents: 152_500,
  withdrawable_cents: 151_250,
  held_cents: 1_250,
  holds: [
    {
      rule: 'chargeback_window',
      cents: 1_250,
      since: '2026-08-20T14:02:00Z',
      // NULL, and API_CONTRACT calls it "the honest answer today": no landed
      // column carries the card networks' dispute window for a purchase.
      available_at: null,
    },
  ],
  as_of: '2026-08-28T09:00:00Z',
};

const ENTRIES: readonly WalletEntry[] = [
  {
    entry_id: '9007199254740993',
    direction: 'credit',
    provenance: 'payout',
    amount_cents: 150_000,
    cause: 'Payout approved on account MF-4471',
    reference_id: 'pr_01J8Z',
    ledger_transaction_id: 'ltx_01J8Z',
    balance_after_cents: 152_500,
    occurred_at: '2026-08-27T18:30:00Z',
  },
  {
    entry_id: '9007199254740992',
    direction: 'debit',
    amount_cents: 4_207,
    cause: 'Evaluation purchase',
    reference_id: 'pur_01J8Y',
    balance_after_cents: 2_500,
    ledger_transaction_id: 'ltx_01J8Y',
    occurred_at: '2026-08-26T11:00:00Z',
  },
];

function viewOf(copy: WalletCopy | null = null) {
  return toWalletView({ wallet: WALLET, entries: ENTRIES, next_cursor: null, copy });
}

function render(copy: WalletCopy | null = null): string {
  return renderToStaticMarkup(
    createElement(Wallet, { view: viewOf(copy), framing: walletFraming(copy) }),
  );
}

describe('the balance, and its two directions', () => {
  test('renders all three figures from their own fields, exactly as sent', () => {
    const view = viewOf();

    // READ, NEVER DERIVED. API_CONTRACT section 6.2 states
    // `balance = withdrawable + held` on the server so that no client computes
    // it, and these three assertions are what proves the view took three fields
    // rather than two and a sum.
    expect(view.balance.balance).toBe('1,525.00');
    expect(view.balance.withdrawable).toBe('1,512.50');
    expect(view.balance.held).toBe('12.50');
    expect(view.balance.as_of).toBe(WALLET.as_of);
  });

  test('INV-M20-08: the balance is one identity’s and no aggregate exists', () => {
    // `M20:64` segregates wallet balances "in reporting and in fact", and the
    // FLOAT is the firm's aggregate across every identity, which `M20:424` puts
    // on M06's liability dashboard with the RCR computed from reserve alone.
    // THE DEFENCE IS AN ABSENCE, so the absence is what is asserted: no field on
    // this view is named for the float, a total or a sum across anything.
    const json = JSON.stringify(viewOf()).toLowerCase();

    for (const forbidden of ['float', 'reserve', 'aggregate', 'total_', 'all_identities'])
      expect(json, `${forbidden} has no place on a trader's wallet`).not.toContain(forbidden);
  });

  test('ADR-019a: the balance is not a score, a streak or a level', () => {
    // Section 3.5's last rule, "arriving in the one place it is most tempting to
    // cross". Asserted over the rendered bytes rather than the view model,
    // because the temptation lands in the markup: a bar, a rank, a badge.
    const html = render().toLowerCase();

    for (const forbidden of ['score', 'streak', 'level', 'rank', 'badge', 'progress', 'tier--'])
      expect(html, `${forbidden} would gamify a balance`).not.toContain(forbidden);

    // And structurally: nothing whose width is a proportion of anything.
    expect(html).not.toContain('width');
    expect(html).not.toContain('<progress');
    expect(html).not.toContain('style=');
  });

  test('the tier is on the element, not in a footnote (INV-M4-11)', () => {
    expect(viewOf().balance.tier).toBe('authoritative');
    expect(render()).toContain('data-tier="authoritative"');
  });

  test('a hold renders its absent date as an absence and never as a date', () => {
    const html = render();

    expect(html).toContain('chargeback_window');
    expect(html).toContain('12.50');
    expect(html).toContain('not reported');

    // The epoch is what a client that typed `available_at` as non-null would
    // render here, and it is the specific wrong answer worth naming.
    expect(html).not.toContain('1970');
  });

  test('both exits render, and only the external one carries C-27', () => {
    const view = viewOf();

    // Section 3.5: "Money out has two exits and the screen shows both."
    expect(view.exits.spend.id).toBe('spend');
    expect(view.exits.withdraw.id).toBe('withdraw');

    // Section 3.7's table: external withdrawal is one of the three sensitive
    // actions; spending inside Merit is M03's checkout and is not on that list.
    expect(view.exits.withdraw.elevation_required).toBe(true);
    expect(view.exits.spend.elevation_required).toBe(false);

    const html = render();
    expect(html).toContain('data-exit="spend"');
    expect(html).toContain('data-exit="withdraw"');
    expect(html).toContain('data-elevation-required="true"');
  });

  test('the boundary is stated before the trader acts, and names no session', () => {
    const html = render();

    // Section 3.7's failure: a trader who "types a destination, confirms it, and
    // receives a 403" has learned "that Merit's UI offers actions its API
    // refuses". The sentence has to be there BEFORE the control.
    expect(html).toContain('passkey or a second channel');
    expect(html.indexOf('passkey or a second channel')).toBeLessThan(
      html.indexOf('Withdraw</button>'),
    );

    // AND IT IS A STATEMENT ABOUT THE ACTION, NOT A CLAIM ABOUT THIS SESSION.
    // This build cannot read the reader's elevation (GET /me's backend is
    // blocked), so a sentence asserting it would be a claim nothing supports.
    expect(html).not.toContain('your session');
    expect(html).not.toContain('you are not');
  });

  test('every control is inert and says so', () => {
    const view = viewOf();

    // Typed as the literal `null`, so wiring one is a type change, which is
    // `app/payouts/view.ts`'s `submits_to` precedent.
    expect(view.exits.spend.submits_to).toBeNull();
    expect(view.exits.withdraw.submits_to).toBeNull();

    const html = render();
    expect(html).toContain('disabled=""');
    expect(html).toContain('not available in this build');

    // A form would submit somewhere. There is nowhere to submit to.
    //
    // THE CHECK IS `<form` AND EVERY BUTTON'S `disabled`, NOT A SUBSTRING SEARCH
    // FOR `action=`. The loose version was written first and it FIRED, on
    // `data-ledger-transaction="..."`, which contains `action=` and is not a
    // form action. A guard that fires on its own screen's data attributes is one
    // whose next author deletes it, so it is made precise rather than deleted:
    // what "inert" means here is that there is no form and no enabled control.
    expect(html).not.toContain('<form');
    expect(html).not.toContain('formaction');

    const buttons = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
    expect(buttons.length, 'the two exits each render their control').toBe(2);
    for (const button of buttons) expect(button).toContain('disabled=""');
  });
});

describe('the statement', () => {
  test('renders every credit and debit with its cause', () => {
    const html = render();

    expect(html).toContain('Payout approved on account MF-4471');
    expect(html).toContain('Evaluation purchase');
    expect(html).toContain('1,500.00');
    expect(html).toContain('42.07');
  });

  test('provenance renders on a credit and never on a debit', () => {
    const view = viewOf();

    const [credit, debit] = view.statement.entries;
    expect(credit!.provenance).toBe('payout');

    // API_CONTRACT section 6.2: the column is NOT NULL and its three members are
    // the CREDIT list, "so a debit is stored carrying a class that does not
    // describe it". Printing one here would put the schema's defect on a
    // trader's statement as a fact about their money.
    expect(debit!.provenance).toBeNull();

    const html = render();
    expect(html).toContain('data-direction="credit"');
    expect(html).toContain('data-direction="debit"');
  });

  test('entry_id is carried as a string and never parsed', () => {
    // `wallet_entries.id` is a bigint, and 9007199254740993 is the first integer
    // JavaScript cannot represent: `Number('9007199254740993')` is ...992. If
    // anything in this path parsed it, this assertion is what catches it.
    const [first] = viewOf().statement.entries;
    expect(first!.entry_id).toBe('9007199254740993');
    expect(render()).toContain('9007199254740993');
  });

  test('the order is the server’s and is not re-sorted', () => {
    const html = render();

    // API_CONTRACT fixes `occurred_at` descending. A client that re-sorted could
    // disagree with the running balance it prints beside each row.
    expect(html.indexOf('Payout approved')).toBeLessThan(html.indexOf('Evaluation purchase'));
  });

  test('an empty wallet is zero and is not an error', () => {
    // API_CONTRACT section 6.2: "An identity with no `wallet_entries` row is `0`
    // and not a `404` ... a `404` on a wallet would tell a trader they have none."
    const empty: WalletResponse = {
      balance_cents: 0,
      withdrawable_cents: 0,
      held_cents: 0,
      holds: [],
      as_of: WALLET.as_of,
    };

    const view = toWalletView({ wallet: empty, entries: [], next_cursor: null, copy: null });
    const html = renderToStaticMarkup(createElement(Wallet, { view, framing: null }));

    expect(html).toContain('No wallet activity yet');
    expect(html).toContain('0.00');
    expect(html.toLowerCase()).not.toContain('error');
  });
});

describe('INV-M4-08, the copy this screen may not author', () => {
  test('the framing and both exits render an absence when nothing is published', () => {
    const html = render(null);

    // Three slots, each naming itself, so a reviewer sees WHICH sentence is owed
    // rather than finding a blank.
    expect(html).toContain('data-copy="wallet.balance_framing"');
    expect(html).toContain('data-copy="wallet.spend"');
    expect(html).toContain('data-copy="wallet.withdraw"');
    expect(html).toContain('published with the plan version');
  });

  test('no parameter M04 section 3.5 names is stated anywhere in the rendered screen', () => {
    // THIS IS THE ASSERTION THE SCREEN EXISTS UNDER. Section 3.5 requires the
    // withdraw exit to state KYC, a 48 hour cooling window, a $100 minimum, 2 to
    // 3 business days and no fee, and then rules the wording a `copy_blocks`
    // entry. `M20:30` carries the numbers and they are policy parameters.
    // The portal may state NONE of them, so none of them appears.
    const html = render(null).toLowerCase();

    for (const parameter of ['48 hour', '48h', '$100', '100.00', '2 to 3', 'no fee', 'interest'])
      expect(html, `${parameter} is a parameter this application may not state`).not.toContain(
        parameter,
      );
  });

  test('the published branch renders, over sentences that came out of a plan version', () => {
    // BOTH BRANCHES RENDER AND ONLY ONE IS REACHABLE FROM A BROWSER, which is
    // `app/payouts/source.ts`'s `readyFrom` argument applied to a sentence.
    // These are built through `copyBlock()` over a `PinnedPlanCopy`, which is
    // the ONLY expression in this codebase whose type is `CopyBlock`: a literal
    // cannot be assigned to these fields and this file would not compile.
    const pinned: PinnedPlanCopy = {
      plan_id: 'plan_50k',
      version: 7,
      blocks: {
        'wallet.balance_framing': 'Money you have already earned, held until you move it.',
        'wallet.spend': 'Use it on an evaluation or a reset, instantly.',
        'wallet.withdraw': 'Send it to your bank account.',
      },
    };

    const copy: WalletCopy = {
      balance_framing: copyBlock(pinned, 'wallet.balance_framing'),
      spend: copyBlock(pinned, 'wallet.spend'),
      withdraw: copyBlock(pinned, 'wallet.withdraw'),
    };

    const html = render(copy);

    expect(html).toContain('Money you have already earned');
    expect(html).toContain('Use it on an evaluation or a reset');
    expect(html).toContain('Send it to your bank account');
    expect(html).not.toContain('published with the plan version');
  });
});

describe('the unavailable arm', () => {
  test('names the endpoints and shows no figure at all', () => {
    const html = renderToStaticMarkup(
      createElement(WalletUnavailable, { missing: [...REQUIRED_ENDPOINTS] }),
    );

    expect(html).toContain('GET /wallet');
    expect(html).toContain('GET /wallet/entries');

    // A WALLET SCREEN THAT RENDERED `0.00` BECAUSE A REQUEST FAILED WOULD TELL A
    // TRADER THEIR MONEY IS GONE. That is the single worst false statement this
    // application could make, and this is the assertion that prevents it.
    expect(html).not.toContain('0.00');
    expect(html).toContain('balance is unaffected');
  });

  test('readyFrom and the unavailable arm are the only two states', () => {
    const loaded = readyFrom({
      wallet: WALLET,
      entries: ENTRIES,
      next_cursor: null,
      copy: null,
    });

    expect(loaded.kind).toBe('ready');
    expect(REQUIRED_ENDPOINTS).toEqual(['GET /wallet', 'GET /wallet/entries']);
  });
});

describe('the error arm, which is ADR-217’s', () => {
  test('a signed-out trader is told they are signed out and not that we are broken', () => {
    // THE DEFECT THE ARM WAS ADDED FOR, ASSERTED AT THE RENDERED BYTES. Before
    // ADR-217 a 401 rendered `WalletUnavailable`, whose sentence begins "This is
    // a problem on our side" -- false to someone whose session expired, and the
    // sentence a trader would read before deciding whether to call support.
    const html = renderToStaticMarkup(createElement(WalletError, { error: 'unauthenticated' }));

    expect(html).toContain('You are signed out');
    expect(html).not.toContain('problem on our side');
    expect(html).toContain('balance is unaffected');
  });

  test('rate limiting says to wait rather than that the wallet is broken', () => {
    const html = renderToStaticMarkup(createElement(WalletError, { error: 'rate_limited' }));

    expect(html).toContain('Wait a moment');
    expect(html).not.toContain('problem on our side');
  });

  test('no arm of this screen renders a figure it did not receive', () => {
    // THE RULE `WalletUnavailable` IS ALREADY HELD TO, EXTENDED TO THE NEW ARM
    // RATHER THAN ASSUMED OF IT. A wallet screen that rendered `0.00` because a
    // request failed would tell a trader their money is gone.
    for (const kind of Object.keys(WALLET_ERROR_COPY) as (keyof typeof WALLET_ERROR_COPY)[]) {
      const html = renderToStaticMarkup(createElement(WalletError, { error: kind }));

      expect(html).not.toContain('0.00');
      expect(html).toContain('balance is unaffected');
    }
  });

  test('no sentence in this arm words a refusal of permission', () => {
    // INV-M4-07 keeps a "forbidden" vocabulary off this screen, and
    // ../src/shell/app-shell.ts refuses `PortalErrorKind` a `forbidden` member
    // for the same reason. `unexpected` is the member a 403 maps to, so it is
    // the one that would carry such a sentence if anything did.
    for (const sentence of Object.values(WALLET_ERROR_COPY)) {
      expect(sentence.toLowerCase()).not.toContain('permission');
      expect(sentence.toLowerCase()).not.toContain('forbidden');
      expect(sentence.toLowerCase()).not.toContain('not allowed');
    }
  });

  test('the arm names no endpoint, which the unavailable arm deliberately does', () => {
    // THE TWO ARMS ADDRESS DIFFERENT READERS. A path this deployment does not
    // serve is a fact about the build; a 401 is a fact about the trader's own
    // session, and a list of API paths under it reads as a stack trace on a
    // money screen.
    const html = renderToStaticMarkup(createElement(WalletError, { error: 'server_error' }));

    expect(html).not.toContain('GET /wallet');
  });
});
