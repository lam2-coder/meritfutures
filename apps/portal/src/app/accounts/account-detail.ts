// =============================================================================
// apps/portal/src/app/accounts/account-detail.ts
// =============================================================================
// SC-M4-03, THE ACCOUNT DETAIL. M04 section 3.1's one thing it must get right:
// "Every gate, gate by gate, with numbers. NEVER A SINGLE PROGRESS BAR."
//
// That last clause is a rendering instruction and this file is where it is
// either honoured or lost. There is no bar, no ring, no percentage-of-the-way
// figure and no aggregate anywhere below: every gate the server reported gets
// its own row, carrying the server's own two numbers. A bar is a fold of
// several gates into one number, and the number it folds to is one this
// application would have had to compute (INV-M4-01) out of gates that are not
// commensurable in the first place.
//
// -----------------------------------------------------------------------------
// INV-M4-05, WHICH IS THE ONE INVARIANT A RENDERER CAN BREAK ON ITS OWN
// -----------------------------------------------------------------------------
//   "A gate reported `skipped: true` renders as DISABLED, never as satisfied |
//   EC-050. A green check on a gate that was never evaluated is a lie the
//   trader will eventually catch."
//
// ../../view/accounts.ts carries `skipped` as a required field on
// `ConsistencyView` so it cannot reach a component unstated. What it cannot do
// is stop the component ignoring it, and every "if it did not fail it passed"
// shortcut is exactly that. So the consistency gate below has THREE renderings
// and not two, and the skipped one shares no markup with the satisfied one.
//
// -----------------------------------------------------------------------------
// SECTION 3.4 PLACEMENT 2 IS DISCHARGED HERE, AND THE TYPE SYSTEM IS WHY IT
// CANNOT BE FORGOTTEN
// -----------------------------------------------------------------------------
// "The eval progress card (SC-M4-03), where the profit-target progress is
// shown, because that is the exact moment a trader is forming the belief that
// the number they are watching is money they will keep."
//
// `EvalProgressView.funded_reset` is a `CopyBlock`, a branded string only
// ../../copy/copy-block.ts can mint, so the eval card cannot be CONSTRUCTED
// without the published sentence. This file is the other half: the sentence is
// rendered on the same card as the profit rows, immediately under them, rather
// than in a footnote somewhere the trader is not looking.
//
// -----------------------------------------------------------------------------
// WHAT SECTION 3.3 ASKS FOR AND THIS SCREEN CANNOT SHOW
// -----------------------------------------------------------------------------
// The consistency meter is ruled visible AT ALL TIMES and section 3.3 says it
// "shows three numbers, always: best day, period profit, and the resulting
// share in bp against the limit. WHEN THE SHARE IS UNDER THE LIMIT IT ALSO
// SHOWS THE HEADROOM."
//
// The headroom is not on this screen, and the reason is that it is on no wire
// shape in ../../api/types.ts and no response in API_CONTRACT. It is
// `max_bp - best_day_share_bp`, which is arithmetic on two `_bp` fields and is
// precisely INV-M4-01's ban, so this file may not close the gap by subtracting.
// ../../view/accounts.ts recorded the same absence when it built the view
// model; rendering the screen is what turns it from a field somebody noticed
// into a requirement of an approved plan that no endpoint can satisfy. It is
// carried to ADR-147 rather than papered over with a dash.

import { createElement } from 'react';
import type { ReactElement } from 'react';

import type {
  AccountDetailView,
  CadenceView,
  ConsistencyView,
  EvalProgressView,
  FundedProgressView,
} from '../../view/accounts.ts';
import type { EquitySeriesView } from '../../view/marks.ts';
import { AsOf, Optional, Row, Section, StateWord } from './elements.ts';
import { EquityChart } from './equity-chart.ts';

/** `have` against `need`, as the compliant fixture writes it: "3 of 5". */
function tally(have: number, need: number): string {
  return `${String(have)} of ${String(need)}`;
}

/**
 * The consistency gate, in three renderings.
 *
 * INV-M4-05 IS THE MIDDLE ONE. A skipped gate carries `aria-disabled` and the
 * words "not evaluated for this account", and it shares no element with the
 * evaluated case: there is no shared row whose value happens to be blank, which
 * is how a skipped gate ends up looking like a passing one.
 *
 * THE HEADROOM ROW SECTION 3.3 ASKS FOR IS ABSENT. See the file header: it is
 * on no response, and subtracting the two `_bp` fields here to produce it is
 * the exact operation INV-M4-01 exists to refuse.
 */
function Consistency(props: { readonly consistency: ConsistencyView }): ReactElement {
  const { consistency } = props;

  if (consistency.skipped) {
    return createElement(
      'div',
      { className: 'row', 'aria-disabled': true },
      createElement('div', { className: 'label' }, 'Consistency'),
      createElement(
        'div',
        { className: 'value' },
        createElement(StateWord, { children: 'not evaluated for this account' }),
      ),
    );
  }

  return createElement(
    'div',
    null,
    createElement(Row, {
      label: 'Best day share',
      children: createElement(Optional, { value: consistency.best_day_share }),
    }),
    createElement(Row, {
      label: 'Consistency limit',
      children: createElement(Optional, { value: consistency.max }),
    }),
  );
}

/**
 * The cadence gap, as a DATE and never as a countdown.
 *
 * EC-046, quoted by ../../view/accounts.ts: "the engine reports
 * `next_eligible_trading_day` as a concrete date resolved through the calendar,
 * so the trader sees the actual date rather than doing the arithmetic." The gap
 * is counted in TRADING days and a holiday cluster stretches it in calendar
 * time, so a "days remaining" rendered here would be wrong in December in a way
 * the trader reads as the rules changing. `days_since_last_payout` is elapsed
 * time and is a fact about the past, so it is safe to state and is stated.
 */
function Cadence(props: { readonly cadence: CadenceView }): ReactElement {
  const { cadence } = props;
  return createElement(
    'div',
    null,
    createElement(Row, {
      label: 'Trading days since last payout',
      children:
        cadence.days_since_last_payout === null
          ? createElement(StateWord, { children: 'no payout has settled yet' })
          : String(cadence.days_since_last_payout),
    }),
    createElement(Row, {
      label: 'Cadence gap, in trading days',
      children: String(cadence.need),
    }),
    createElement(Row, {
      label: 'Next eligible trading day',
      children:
        cadence.next_eligible_trading_day === null
          ? createElement(StateWord, { children: 'the cadence gap is not holding this account' })
          : cadence.next_eligible_trading_day,
    }),
  );
}

/** SC-M4-03's eval card, and section 3.4 placement 2. */
function EvalProgress(props: { readonly progress: EvalProgressView }): ReactElement {
  const { progress } = props;
  return createElement(Section, {
    title: 'Evaluation progress',
    children: [
      createElement(Row, {
        key: 'profit',
        label: 'Profit',
        children: createElement(Optional, { value: progress.profit }),
      }),
      createElement(Row, {
        key: 'target',
        label: 'Profit target',
        children: createElement(Optional, { value: progress.profit_target }),
      }),

      // PLACEMENT 2. On the card, under the profit rows, in the published
      // words. `funded_reset` is a `CopyBlock` and the only expression in this
      // codebase with that type is a `copyBlock()` call, so this paragraph
      // cannot be an author's paraphrase (INV-M4-08, FM-M4-05).
      createElement('p', { key: 'reset', className: 'copy' }, progress.funded_reset),
    ],
  });
}

/** SC-M4-03's funded card. Every gate, gate by gate, with numbers. */
function FundedProgress(props: { readonly progress: FundedProgressView }): ReactElement {
  const { progress } = props;
  return createElement(Section, {
    title: 'Funded progress',
    children: [
      createElement(Row, {
        key: 'buffer',
        label: 'Buffer required',
        children: createElement(Optional, { value: progress.buffer }),
      }),
      createElement(Row, {
        key: 'buffer-progress',
        label: 'Buffer accrued',
        children: createElement(Optional, { value: progress.buffer_progress }),
      }),
      createElement(Row, {
        key: 'win-days',
        label: 'Win days',
        children: tally(progress.win_days.have, progress.win_days.need),
      }),
      createElement(Row, {
        key: 'win-day-floor',
        label: 'A win day is a day above',
        children: progress.win_days.floor,
      }),
      createElement(Row, {
        key: 'traded-days',
        label: 'Traded days',
        children: tally(progress.traded_days.have, progress.traded_days.need),
      }),
      createElement(Consistency, { key: 'consistency', consistency: progress.consistency }),
      createElement(Cadence, { key: 'cadence', cadence: progress.cadence }),
      createElement(Row, {
        key: 'ladder',
        label: 'Payouts settled toward graduation',
        children: tally(progress.ladder.payouts_settled, progress.ladder.payouts_to_graduate),
      }),
    ],
  });
}

/**
 * A closed or graduated account has neither card, and the sentence says which.
 *
 * ../../view/accounts.ts models this as `NoProgressView`, "A CASE AND NOT A
 * FALLBACK ... a view model that modelled only eval and funded would be one
 * `else` away from rendering a funded card for a closed account." The screen
 * keeps the case: it states that progress has stopped rather than rendering an
 * empty funded card, which is the same defect one layer up.
 */
function NoProgress(): ReactElement {
  return createElement(Section, {
    title: 'Progress',
    children: createElement(
      'p',
      null,
      'This account is no longer progressing toward a gate. Its closing figures are above.',
    ),
  });
}

/**
 * SC-M4-03's screen, which is ONE screen and not two.
 *
 * M04 section 3.1 rows it as "Account detail and equity chart", so the chart is
 * rendered here rather than beside this component. That is not tidiness: the
 * chart's `as_of_trading_day` comes from the ACCOUNT response and not from the
 * marks page it draws (../../view/marks.ts), so a caller free to render one
 * without the other is a caller free to render them from two different reads.
 */
export function AccountDetailScreen(props: {
  readonly account: AccountDetailView;
  readonly series: EquitySeriesView;
}): ReactElement {
  const { account } = props;

  return createElement(
    'main',
    null,
    createElement('h1', null, account.plan.name),

    // THE SAME ORDER AS THE CARD, FOR THE SAME REASON. SC-M4-02's number is the
    // number that decides whether the trader trades tomorrow, and it does not
    // stop being that on the screen they opened to look at it (FM-M4-08).
    createElement(Row, { label: 'Floor distance', children: account.floor_distance }),
    createElement(Row, { label: 'Balance', children: account.balance }),
    createElement(Row, { label: 'Floor', children: account.floor }),
    createElement(Row, { label: 'Withdrawable', children: account.withdrawable }),
    createElement(Row, { label: 'Account size', children: account.size }),
    createElement(AsOf, { as_of_trading_day: account.as_of_trading_day }),

    account.progress.kind === 'eval'
      ? createElement(EvalProgress, { progress: account.progress })
      : account.progress.kind === 'funded'
        ? createElement(FundedProgress, { progress: account.progress })
        : createElement(NoProgress, null),

    createElement(EquityChart, { series: props.series }),

    createElement(Section, {
      title: 'Account',
      children: [
        createElement(Row, { key: 'platform', label: 'Platform', children: account.platform }),
        createElement(Row, {
          key: 'ref',
          label: 'Platform account',
          children:
            account.platform_account_ref === null
              ? createElement(StateWord, { children: 'not provisioned yet' })
              : account.platform_account_ref,
        }),
        createElement(Row, {
          key: 'permissions',
          label: 'Front end permissions',
          children:
            account.front_end_permissions.length === 0
              ? createElement(StateWord, { children: 'none granted' })
              : account.front_end_permissions.join(', '),
        }),
        createElement(Row, { key: 'opened', label: 'Opened', children: account.opened_on }),
        createElement(Row, {
          key: 'funded',
          label: 'Funded',
          children:
            account.funded_on === null
              ? createElement(StateWord, { children: 'still in evaluation' })
              : account.funded_on,
        }),

        // ABSENT WHILE THE ACCOUNT IS OPEN, rather than present and empty. A
        // "Closed: none" row on a live account reads as a state the account
        // could be in and is not.
        account.closed_on === null
          ? null
          : createElement(Row, { key: 'closed', label: 'Closed', children: account.closed_on }),
        account.close_reason === null
          ? null
          : createElement(Row, {
              key: 'close-reason',
              label: 'Close reason',
              children: account.close_reason,
            }),
      ],
    }),

    // SC-M4-05 IS LINKED AND NOT INLINED. ../../view/accounts.ts: "the
    // account's pinned plan version. SC-M4-05 links here; this module does not
    // inline it." `rules_url` is the server's own path to the PINNED version,
    // never the current one, so the link cannot drift to a plan the account is
    // not on.
    createElement(
      'p',
      null,
      createElement(
        'a',
        { href: account.rules_url },
        `The rules this account is pinned to, version ${String(account.plan.version)}`,
      ),
    ),
  );
}
