import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import type { EligibilityGates, EligibilityResponse } from '../src/api/types.ts';
import { PayoutCenter, PayoutCenterUnavailable } from '../src/app/payouts/sections.ts';
import { REQUIRED_ENDPOINTS, readyFrom } from '../src/app/payouts/source.ts';
import { humanise, toPayoutCenterView, toVerdict } from '../src/app/payouts/view.ts';
import type { PayoutListItem } from '../src/app/payouts/wire.ts';
import PayoutsPage from '../src/app/payouts/page.ts';
import { toEligibilityView } from '../src/view/eligibility.ts';

// =============================================================================
// SC-M4-04 rendered, against responses transcribed from API_CONTRACT
// =============================================================================
// THE FIXTURES ARE THE CONTRACT'S SHAPE AND NOT A CONVENIENT ONE. Every field
// below appears in docs/architecture/API_CONTRACT.md's `GET
// /accounts/:accountId/eligibility` and `GET /payouts` blocks, and every money
// value is an integer number of cents. There is no float in this file and
// `payouts-segment.test.ts` asserts there is none in the segment either.
//
// THREE RESPONSES, BECAUSE THE SCREEN HAS THREE HONEST ANSWERS. Eligible;
// blocked with the server naming its own failing gate; and the case ADR-148 is
// about, where the verdict and the gate list disagree.

const PASSING: EligibilityGates = {
  account_active: { pass: true },
  kyc_verified: { pass: true, state: 'verified' },
  not_frozen: { pass: true, reason: null },
  recon_clear: { pass: true },
  traded_days: { pass: true, have: 14, need: 10 },
  win_days: { pass: true, have: 6, need: 5, floor_cents: 20000 },
  buffer: { pass: true, have_cents: 480000, need_cents: 250000 },
  consistency: {
    pass: true,
    skipped: false,
    best_day_share_bp: 2150,
    max_bp: 4000,
    profit_needed_to_dilute_cents: null,
  },
  cadence_gap: {
    pass: true,
    days_since_last_payout: 21,
    need: 14,
    next_eligible_trading_day: null,
  },
  minimum_amount: { pass: true, withdrawable_cents: 480000, min_payout_cents: 10000 },
};

const ELIGIBLE: EligibilityResponse = {
  account_id: 'acc_01J8XQ7K9M2N4P6R8T0V2W4Y',
  as_of_trading_day: '2026-08-26',
  eligible: true,
  max_payout_cents: 250000,
  min_payout_cents: 10000,
  gates: PASSING,
  cap: {
    cap_cents: 250000,
    ordinal: 2,
    schedule_note: 'Second payout on this account. The cap rises with the ordinal.',
  },
};

/** Two gates failing, and the consistency gate SKIPPED. INV-M4-05's third state. */
const BLOCKED: EligibilityResponse = {
  ...ELIGIBLE,
  eligible: false,
  max_payout_cents: 0,
  gates: {
    ...PASSING,
    win_days: { pass: false, have: 3, need: 5, floor_cents: 20000 },
    consistency: {
      pass: false,
      skipped: true,
      best_day_share_bp: null,
      max_bp: null,
      profit_needed_to_dilute_cents: null,
    },
    cadence_gap: {
      pass: false,
      days_since_last_payout: 6,
      need: 14,
      next_eligible_trading_day: '2026-09-04',
    },
  },
};

/**
 * `eligible: false` with all ten gates passing.
 *
 * NOT AN INVENTED SHAPE. `G-ELIGIBLE` (STATE_MACHINES section 10) conjoins
 * `identities.status = 'active'` (ADR-062 section 1) and `G-NO-IN-FLIGHT`, and
 * the response declares no gate for either. A restricted identity and an
 * in-flight request both produce exactly this payload. ADR-148.
 */
const UNEXPLAINED: EligibilityResponse = { ...ELIGIBLE, eligible: false, max_payout_cents: 0 };

const PAYOUTS: readonly PayoutListItem[] = [
  {
    payout_request_id: 'pr_01J8A0B1C2D3E4F5G6H7J8K9',
    account_id: ELIGIBLE.account_id,
    approved_cents: 180000,
    trader_cents: 144000,
    status: 'settled',
    approved_at: '2026-07-14T15:04:05Z',
    settled_at: '2026-07-17T09:31:22Z',
    hold: null,
    timeline: [
      { state: 'approved', at: '2026-07-14T15:04:05Z' },
      { state: 'settled', at: '2026-07-17T09:31:22Z' },
    ],
    failure_note: null,
  },
  {
    payout_request_id: 'pr_01J8M0N1P2Q3R4S5T6U7V8W9',
    account_id: ELIGIBLE.account_id,
    approved_cents: 220000,
    trader_cents: 176000,
    status: 'held_pending_review',

    // Null while held: the hold is PRE-approval. API_CONTRACT says a client
    // typing this non-null "will render an epoch date or crash on the one
    // state that most needs to render correctly".
    approved_at: null,
    settled_at: null,
    hold: {
      held_at: '2026-08-25T18:02:11Z',
      resolves_by: '2026-08-27T18:02:11Z',
      tos_clause: '9.4',
    },
    timeline: [{ state: 'held_pending_review', at: '2026-08-25T18:02:11Z' }],
    failure_note: null,
  },
  {
    payout_request_id: 'pr_01J7Z0Y1X2W3V4U5T6S7R8Q9',
    account_id: ELIGIBLE.account_id,
    approved_cents: 95000,
    trader_cents: 76000,
    status: 'failed',
    approved_at: '2026-06-02T13:10:00Z',
    settled_at: null,
    hold: null,
    timeline: [
      { state: 'approved', at: '2026-06-02T13:10:00Z' },
      { state: 'failed', at: '2026-06-05T08:44:19Z' },
    ],
    failure_note: 'The receiving bank rejected the transfer. Your money has not moved.',
  },
];

function render(eligibility: EligibilityResponse): string {
  const view = toPayoutCenterView({ eligibility, payouts: PAYOUTS });
  return renderToStaticMarkup(createElement(PayoutCenter, { view }));
}

// -----------------------------------------------------------------------------

describe('INV-M4-01, no money value is computed here', () => {
  test('every rendered amount is the formatter over a field the server sent', () => {
    const html = render(ELIGIBLE);

    // 250000 cents. Not 2500, not 2500.0, and not rounded.
    expect(html).toContain('>2,500.00<');
    expect(html).toContain('>100.00<');

    // The history's three rows, each exactly its own two integers.
    expect(html).toContain('>1,800.00<');
    expect(html).toContain('>1,440.00<');
    expect(html).toContain('>2,200.00<');
    expect(html).toContain('>1,760.00<');
    expect(html).toContain('>950.00<');
    expect(html).toContain('>760.00<');
  });

  test('a zero max payout renders as the server’s zero and not as an absence', () => {
    expect(render(BLOCKED)).toContain('>0.00<');
  });
});

describe('INV-M4-02, the day travels with the numbers', () => {
  test('the last closed trading day is on the screen and not in a tooltip', () => {
    const html = render(ELIGIBLE);
    expect(html).toContain('2026-08-26');
    expect(html).toContain('merit-as-of__day');

    // Not an attribute nobody sees.
    expect(html).toContain('>2026-08-26</time>');
  });
});

describe('INV-M4-03, the server decides and this screen reports', () => {
  test('the control carries the server’s verdict verbatim', () => {
    expect(render(ELIGIBLE)).toContain('data-enabled="true"');
    expect(render(BLOCKED)).toContain('data-enabled="false"');
  });

  test('the control is inert in this build because no route exists to submit to', () => {
    // `submits_to` is the literal `null`, so wiring it is a type change.
    expect(toPayoutCenterView({ eligibility: ELIGIBLE, payouts: [] }).request.submits_to).toBe(
      null,
    );
    expect(render(ELIGIBLE)).toContain('disabled=""');
  });
});

describe('SC-M4-03 and INV-M4-05, every gate, three states, never a progress bar', () => {
  test('all ten gates render, including the passing ones', () => {
    const html = render(ELIGIBLE);
    for (const id of Object.keys(PASSING)) {
      expect(html, `${id} renders`).toContain(`data-gate="${id}"`);
    }
  });

  test('a skipped gate renders disabled and never as satisfied', () => {
    const html = render(BLOCKED);
    expect(html).toContain('data-gate="consistency" data-state="disabled"');
    expect(html).not.toContain('data-gate="consistency" data-state="pass"');
  });

  test('there is no aggregate anywhere', () => {
    const html = render(BLOCKED);
    for (const tell of ['<progress', 'role="progressbar"', 'aria-valuenow', '%"']) {
      expect(html, `${tell} is absent`).not.toContain(tell);
    }
  });

  test('the gate list keeps the contract’s order whatever the outcome', () => {
    const html = render(BLOCKED);
    const order = Object.keys(PASSING).map((id) => html.indexOf(`data-gate="${id}" data-state`));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe('INV-M4-08, no rule sentence is authored here', () => {
  test('every gate label is the contract’s own key, transformed mechanically', () => {
    const html = render(ELIGIBLE);
    for (const id of Object.keys(PASSING)) {
      expect(html, `${id} is labelled from its key`).toContain(`>${humanise(id)}</h3>`);
    }
    expect(humanise('traded_days')).toBe('Traded days');
    expect(humanise('profit_needed_to_dilute')).toBe('Profit needed to dilute');

    // Case, never words. `kyc_verified` stays `kyc_verified`.
    expect(humanise('kyc_verified')).toBe('KYC verified');
  });

  test('no threshold, operator or consequence is written into the screen', () => {
    // The numbers are the server's and the words are the contract's keys, so
    // nothing on this screen states a rule that a `copy_blocks` entry owns.
    const html = render(BLOCKED);
    for (const shape of ['at most', 'at least', 'must be', 'you need', '%%', ' >= ', ' <= ']) {
      expect(html, `${shape} is absent`).not.toContain(shape);
    }
  });
});

describe('the cap, so the maximum is a number with a reason', () => {
  test('the cap, its ordinal and the server’s note all render', () => {
    const html = render(ELIGIBLE);
    expect(html).toContain('merit-cap');
    expect(html).toContain('>2<');
    expect(html).toContain('Second payout on this account.');
  });
});

describe('section 3.3, the consistency meter is shown at all times', () => {
  test('it renders when the gate passes', () => {
    const html = render(ELIGIBLE);
    expect(html).toContain('merit-consistency');
    expect(html).toContain('21.50%');
    expect(html).toContain('40.00%');
  });

  test('it renders when the gate was skipped, carrying the absence as an absence', () => {
    const html = render(BLOCKED);
    expect(html).toContain('merit-consistency');
    expect(html).toContain('data-state="disabled"');
    expect(html).toContain('not reported');
  });
});

describe('FM-M4-08, what is left is above the fold', () => {
  test('the verdict and the failing gates precede the gate list in the document', () => {
    const html = render(BLOCKED);
    const verdict = html.indexOf('merit-verdict');
    const gates = html.indexOf('merit-gates');
    const history = html.indexOf('merit-history');
    expect(verdict).toBeGreaterThan(-1);
    expect(verdict).toBeLessThan(gates);
    expect(gates).toBeLessThan(history);
  });

  test('the failing gates are named in the verdict, in the contract’s order', () => {
    const html = render(BLOCKED);
    const from = html.indexOf('merit-verdict__blocking');
    const summary = html.slice(from, html.indexOf('</ul>', from));
    expect(summary).toContain('Win days');
    expect(summary).toContain('Cadence gap');

    // The SKIPPED gate is not a failing gate. INV-M4-05 again, one level up.
    expect(summary).not.toContain('Consistency');
  });
});

describe('M04 section 3.2, a refusal is never worded as one', () => {
  // THE RULE BINDS WHAT THE PORTAL AUTHORS AND NOT WHAT THE SERVER SENDS, and
  // the two are separated here rather than fused, because fusing them is how a
  // copy check ends up either vacuous or lying. `failure_note`, `reason` and
  // `schedule_note` are server-composed trader-safe sentences that this screen
  // carries verbatim (INV-M4-08's shape applied to prose the server owns), so
  // the vocabulary assertion runs over a render with all three absent, and the
  // verbatim carry gets its own assertion below.
  const SILENT_SERVER: readonly PayoutListItem[] = PAYOUTS.map((row) => ({
    ...row,
    failure_note: null,
  }));

  test('no rejection vocabulary the portal authored reaches any of the three states', () => {
    for (const response of [ELIGIBLE, BLOCKED, UNEXPLAINED]) {
      const view = toPayoutCenterView({
        eligibility: { ...response, cap: { ...response.cap, schedule_note: '' } },
        payouts: SILENT_SERVER,
      });
      const html = renderToStaticMarkup(createElement(PayoutCenter, { view })).toLowerCase();
      for (const word of ['declined', 'denied', 'rejected', 'forbidden', 'not allowed']) {
        expect(html, `${word} is absent`).not.toContain(word);
      }
    }
  });

  test("the server's own sentence is carried verbatim even when it uses a word the portal may not author", () => {
    // AS-M4-06's neighbour: the portal is not a censor of the server's prose.
    // The bank rejected a transfer, the firm refused nothing, and rewriting
    // that sentence here would be the portal authoring a fact.
    expect(render(ELIGIBLE)).toContain(
      'The receiving bank rejected the transfer. Your money has not moved.',
    );
  });
});

describe('ADR-148, the verdict and the gate list can disagree', () => {
  test('a refusal with no failing gate is rendered as unexplained, not as ten green rows', () => {
    expect(toVerdict(toEligibilityView(UNEXPLAINED))).toEqual({ kind: 'unexplained' });

    const html = render(UNEXPLAINED);
    expect(html).toContain('data-verdict="unexplained"');
    expect(html).toContain('ADR-148');
    expect(html).toContain('does not say which gate is holding');
  });

  test('the other two states are not unexplained', () => {
    expect(toVerdict(toEligibilityView(ELIGIBLE))).toEqual({ kind: 'eligible' });
    expect(toVerdict(toEligibilityView(BLOCKED))).toEqual({
      kind: 'blocked',
      by: ['win_days', 'cadence_gap'],
    });
  });
});

describe('M05 section 3.4, a held request shows the fact, the clause and the date', () => {
  test('the hold renders all three and no evidence and no detector', () => {
    const html = render(ELIGIBLE);
    expect(html).toContain('merit-payout__hold');
    expect(html).toContain('>2026-08-27T18:02:11Z<');
    expect(html).toContain('>9.4<');
    expect(html).toContain('Held pending review');
  });

  test('a held row renders its missing approval time as an absence', () => {
    const html = render(ELIGIBLE);
    const held = html.slice(html.indexOf('data-status="held_pending_review"'));
    expect(held).toContain('not reported');
  });

  test('a failed transfer carries the server’s own note', () => {
    expect(render(ELIGIBLE)).toContain('Your money has not moved.');
  });
});

describe('M04 1.1, mobile first, which here means no layout at all', () => {
  // FM-M4-08 is a LAYOUT bug: "mobile layout hides the failing gate below the
  // fold ... this is a correctness bug, not a polish item". This segment ships
  // no width, no column, no grid, no float and no fixed dimension, so there is
  // nothing that lays out differently at 375px than anywhere else. Asserted
  // rather than promised, because the cheapest way to reintroduce the bug is an
  // inline style somebody adds while making one section look right.
  test('nothing in the output carries a style or a dimension', () => {
    for (const response of [ELIGIBLE, BLOCKED, UNEXPLAINED]) {
      const html = render(response);
      expect(html).not.toContain('style=');
      expect(html).not.toContain('width=');
      expect(html).not.toContain('height=');
    }
  });

  test('the screen is semantic block flow and every section is a landmark', () => {
    const html = render(BLOCKED);
    expect(html.startsWith('<main')).toBe(true);
    for (const heading of [
      'merit-verdict-heading',
      'merit-gates-heading',
      'merit-history-heading',
    ]) {
      expect(html).toContain(`aria-labelledby="${heading}"`);
    }
  });
});

describe('the page itself', () => {
  test('it renders the unavailable state today and names the endpoints it waits on', async () => {
    const html = renderToStaticMarkup(await PayoutsPage());
    expect(html).toContain('merit-payout-center--unavailable');
    for (const endpoint of REQUIRED_ENDPOINTS) {
      expect(html).toContain(endpoint);
    }

    // Nothing failed and nothing was refused, so no fault vocabulary.
    expect(html.toLowerCase()).not.toContain('error');
  });

  test('the ready branch is the same screen the render tests above assert', () => {
    const loaded = readyFrom({ eligibility: ELIGIBLE, payouts: PAYOUTS });
    expect(loaded.kind).toBe('ready');
    if (loaded.kind !== 'ready') return;
    expect(renderToStaticMarkup(createElement(PayoutCenter, { view: loaded.view }))).toBe(
      render(ELIGIBLE),
    );
  });

  test('the unavailable state renders without a view', () => {
    const html = renderToStaticMarkup(
      createElement(PayoutCenterUnavailable, { missing: [...REQUIRED_ENDPOINTS] }),
    );
    expect(html).toContain('GET /payouts');
  });
});
