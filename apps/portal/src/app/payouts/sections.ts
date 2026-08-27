// =============================================================================
// apps/portal/src/app/payouts/sections.ts
// =============================================================================
// THE ELEMENT TREE FOR SC-M4-04. Every component here is a pure function from
// a view model built in ./view.ts to a React element. None of them formats a
// number, compares a threshold, or authors a sentence about a rule.
//
// -----------------------------------------------------------------------------
// FM-M4-08 IS SATISFIED BY DOCUMENT ORDER AND BY THE ABSENCE OF A LAYOUT
// -----------------------------------------------------------------------------
//   "Mobile layout hides the failing gate below the fold | Traders conclude the
//   rule is arbitrary because they never saw it | Mobile-first design, plus a
//   visual test asserting the failing gate is above the fold at 375px | Layout
//   fix; THIS IS A CORRECTNESS BUG, NOT A POLISH ITEM."
//
// Two mechanisms, and the second is the stronger one.
//
//   1. The verdict section is FIRST in the document, before the gate list and
//      before the history, and it names the failing gates. ../../view/
//      eligibility.ts's `failing` field exists for exactly this: "listed so a
//      layout can put them where FM-M4-08 requires WITHOUT REORDERING THE
//      RULE". The gate list below it stays in the contract's order.
//
//   2. THIS SEGMENT SHIPS NO WIDTH, NO COLUMN, NO GRID, NO FLOAT AND NO FIXED
//      DIMENSION. There is nothing here that lays out differently at 375px than
//      at 1920px, because there is no layout at all: semantic block elements in
//      normal flow are single-column everywhere. A screen with no layout cannot
//      have a layout bug, and FM-M4-08 is a layout bug.
//
// THE STYLESHEET IS NOT THIS SEGMENT'S AND ITS ABSENCE IS THE FENCE. Global CSS
// is imported by `app/layout.tsx` and a CSS module needs the `next-env.d.ts`
// that `next build` writes; both are session 250's. So the elements below carry
// CLASS NAMES and no styles, which is the half a stylesheet can attach to
// later without any of these files changing. `payouts-segment.test.ts` asserts
// that no `style` attribute and no dimension reaches the output, so the
// property above is a check rather than a promise.

import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';

import type { GateFact, GateView, ConsistencyMeterView } from '../../view/eligibility.ts';
import { humanise } from './view.ts';
import type {
  PayoutCenterView,
  PayoutHistoryView,
  PayoutRowView,
  RequestControlView,
  Verdict,
} from './view.ts';

const el = createElement;

/**
 * A value the server did not report, said in words.
 *
 * ../../format/money.ts refuses to render a null money field as `0.00` because
 * that "would state a fact the server did not send". AN EMPTY CELL MAKES THE
 * SAME STATEMENT BY OMISSION, and it makes it invisibly, so the absence is
 * written out instead. It is accurate for every null on this screen: a
 * `reason` on a gate that is not frozen, a `best_day_share` on a consistency
 * gate that was skipped, and a `next_eligible_trading_day` on a first payout
 * are all values the response carried as absent.
 */
const NOT_REPORTED = 'not reported';

function factValue(fact: GateFact): string {
  if (fact.value === null) return NOT_REPORTED;
  return typeof fact.value === 'number' ? String(fact.value) : fact.value;
}

/** One `key: value` pair under a gate. The key is the contract's, humanised. */
function Fact(fact: GateFact): readonly ReactElement[] {
  return [
    el('dt', { key: `${fact.key}-k`, className: 'merit-fact__key' }, humanise(fact.key)),
    el('dd', { key: `${fact.key}-v`, className: 'merit-fact__value' }, factValue(fact)),
  ];
}

/**
 * One gate, whole. THREE STATES AND NOT TWO.
 *
 * INV-M4-05: "A gate reported `skipped: true` renders as DISABLED, never as
 * satisfied. A green check on a gate that was never evaluated is a lie the
 * trader will eventually catch." The state is on the element as `data-state`
 * AND as a word in the text, because a state carried only by a colour is a
 * state a screen reader and a screenshot both lose.
 */
export function Gate({ gate }: { readonly gate: GateView }): ReactElement {
  return el(
    'li',
    { className: 'merit-gate', 'data-gate': gate.id, 'data-state': gate.state },
    el('h3', { className: 'merit-gate__name' }, humanise(gate.id)),
    el('p', { className: 'merit-gate__state' }, gate.state),
    gate.facts.length === 0
      ? null
      : el('dl', { className: 'merit-gate__facts' }, ...gate.facts.flatMap(Fact)),
  );
}

/**
 * The ten gates, in the contract's order, all of them, including the passing
 * ones and the skipped ones.
 *
 * SC-M4-03: "every gate, gate by gate, with numbers. NEVER A SINGLE PROGRESS
 * BAR." There is no aggregate anywhere in this file and no element whose width
 * is a proportion of anything.
 */
export function GateList({ gates }: { readonly gates: readonly GateView[] }): ReactElement {
  return el(
    'section',
    { className: 'merit-gates', 'aria-labelledby': 'merit-gates-heading' },
    el('h2', { id: 'merit-gates-heading' }, 'Gates'),
    el(
      'ol',
      { className: 'merit-gates__list' },
      ...gates.map((gate) => el(Gate, { key: gate.id, gate })),
    ),
  );
}

/**
 * Section 3.3's meter, rendered on every load whatever the gate did.
 *
 * Ruled at the M1 gate (OQ-9): the meter and `profit_needed_to_dilute_cents`
 * are shown AT ALL TIMES, not only when the gate fails, because AS-13 says
 * eligibility is not monotone in profit and "the only defence against that
 * reading as a moved goalpost is that the shape of the rule was visible before
 * it bit". So there is no branch in this function that can drop it.
 *
 * THE HEADROOM IS NOT SHOWN AND ../../view/eligibility.ts ALREADY SAID WHY:
 * it is `max_bp` minus `best_day_share_bp`, arithmetic on two basis-point
 * fields, which INV-M4-01 bans and no endpoint returns.
 */
export function ConsistencyMeter({
  meter,
}: {
  readonly meter: ConsistencyMeterView;
}): ReactElement {
  const rows: readonly (readonly [string, string | null])[] = [
    ['best_day_share', meter.best_day_share],
    ['max', meter.max],
    ['profit_needed_to_dilute', meter.profit_needed_to_dilute],
  ];

  return el(
    'section',
    {
      className: 'merit-consistency',
      'data-state': meter.state,
      'aria-labelledby': 'merit-consistency-heading',
    },
    el('h2', { id: 'merit-consistency-heading' }, 'Consistency'),
    el('p', { className: 'merit-consistency__state' }, meter.state),
    el(
      'dl',
      { className: 'merit-consistency__values' },
      ...rows.flatMap(([key, value]) => [
        el('dt', { key: `${key}-k` }, humanise(key)),
        el('dd', { key: `${key}-v` }, value === null ? NOT_REPORTED : value),
      ]),
    ),
  );
}

/**
 * What the server said, and what is left, FIRST in the document.
 *
 * M04 section 3.2's copy rule is binding here: "A 422 is never worded as a
 * rejection. The zero-denial policy means a request that has not cleared its
 * gates is not a denial, and the copy has to carry that distinction: 'not yet,
 * here is exactly what is left' rather than 'declined'." No word in this
 * function is a refusal and none names a rule.
 */
export function VerdictSummary({ verdict }: { readonly verdict: Verdict }): ReactElement {
  const body = ((): ReactNode => {
    if (verdict.kind === 'eligible') {
      return el('p', { className: 'merit-verdict__body' }, 'Eligible as of the day below.');
    }
    if (verdict.kind === 'blocked') {
      return el(
        'div',
        { className: 'merit-verdict__body' },
        el('p', null, 'Not yet. What is left:'),
        el(
          'ul',
          { className: 'merit-verdict__blocking' },
          ...verdict.by.map((id) => el('li', { key: id, 'data-gate': id }, humanise(id))),
        ),
      );
    }

    // ADR-148. See ./view.ts section 3: the verdict and the gate list are both
    // the server's, and here they disagree. The screen says so rather than
    // rendering ten passing gates beside a refusal.
    return el(
      'div',
      { className: 'merit-verdict__body' },
      el('p', null, 'Not yet, and this response does not say which gate is holding.'),
      el(
        'p',
        { className: 'merit-verdict__unexplained' },
        'Every gate below reports passing and the eligibility endpoint still answered no. ' +
          'That is a gap in what the endpoint reports rather than a rule you have missed, ' +
          'and it is recorded as ADR-148. Contact support and quote the account and the day.',
      ),
    );
  })();

  return el(
    'section',
    {
      className: 'merit-verdict',
      'data-verdict': verdict.kind,
      'aria-labelledby': 'merit-verdict-heading',
    },
    el('h2', { id: 'merit-verdict-heading' }, 'Payout'),
    body,
  );
}

/**
 * INV-M4-03's control, disabled unless the server said `eligible: true`.
 *
 * IT IS ALWAYS `disabled` IN THIS BUILD AND THE SCREEN SAYS SO IN WORDS. The
 * `enabled` field is the server's answer and is rendered as `data-enabled`, so
 * the invariant is visible and checkable in the output; the `disabled`
 * attribute is unconditional because `submits_to` is `null` and there is
 * nothing to submit to. An enabled control with no route behind it is a
 * promise this code cannot keep.
 */
export function RequestControl({
  control,
}: {
  readonly control: RequestControlView;
}): ReactElement {
  return el(
    'section',
    { className: 'merit-request', 'aria-labelledby': 'merit-request-heading' },
    el('h2', { id: 'merit-request-heading' }, 'Request a payout'),
    el(
      'dl',
      { className: 'merit-request__amounts' },
      el('dt', null, 'Maximum'),
      el('dd', { className: 'merit-request__amount' }, control.amount),
      el('dt', null, 'Minimum'),
      el('dd', { className: 'merit-request__minimum' }, control.minimum),
    ),
    el(
      'button',
      {
        type: 'button',
        className: 'merit-request__submit',
        disabled: true,
        'data-enabled': String(control.enabled),
      },
      'Request',
    ),
    el(
      'p',
      { className: 'merit-request__unwired' },
      'Requesting a payout is not available on this build. The amount above is the ' +
        "server's and is the number a request would send.",
    ),
  );
}

/**
 * The cap that produced the maximum, and the server's own note about it.
 *
 * WITHOUT IT THE MAXIMUM IS A NUMBER WITH NO REASON. `max_payout_cents` is
 * `min(withdrawable, cap)` after clamp (API_CONTRACT), so a trader whose
 * withdrawable balance is larger than the cap sees a maximum smaller than the
 * money on the account and no explanation for the difference. Merit's stated
 * differentiator is that the trader can check the firm's work, and a clamp
 * whose bound is off screen cannot be checked.
 *
 * `schedule_note` IS THE SERVER'S SENTENCE AND IS RENDERED VERBATIM. It
 * describes a rule, and INV-M4-08 is why this file does not compose one: the
 * portal may not author rule text, so it carries the server's.
 */
export function CapNote({
  cap,
}: {
  readonly cap: PayoutCenterView['eligibility']['cap'];
}): ReactElement {
  return el(
    'section',
    { className: 'merit-cap', 'aria-labelledby': 'merit-cap-heading' },
    el('h2', { id: 'merit-cap-heading' }, 'Cap'),
    el(
      'dl',
      { className: 'merit-cap__values' },
      el('dt', null, 'Cap'),
      el('dd', { className: 'merit-cap__amount' }, cap.cap),
      el('dt', null, 'Ordinal'),
      el('dd', { className: 'merit-cap__ordinal' }, String(cap.ordinal)),
    ),
    el('p', { className: 'merit-cap__note' }, cap.schedule_note),
  );
}

/** One settled, held, approved, failed or frozen request. */
export function PayoutRow({ row }: { readonly row: PayoutRowView }): ReactElement {
  return el(
    'li',
    { className: 'merit-payout', 'data-status': row.status },
    el('h3', { className: 'merit-payout__status' }, row.status_label),
    el(
      'dl',
      { className: 'merit-payout__amounts' },
      el('dt', null, 'Approved'),
      el('dd', { className: 'merit-payout__approved' }, row.approved),
      el('dt', null, 'Trader'),
      el('dd', { className: 'merit-payout__trader' }, row.trader),
      el('dt', null, 'Approved at'),
      el('dd', null, row.approved_at === null ? NOT_REPORTED : row.approved_at),
      el('dt', null, 'Settled at'),
      el('dd', null, row.settled_at === null ? NOT_REPORTED : row.settled_at),
    ),

    // M05 section 3.4 and API_CONTRACT: the trader is shown THE FACT, THE ToS
    // CLAUSE AND THE DATE IT RESOLVES, never the evidence and never the
    // detector. `resolves_by` is required in the response for that reason: "a
    // review the trader cannot see the end of is indistinguishable from a
    // refusal."
    row.hold === null
      ? null
      : el(
          'div',
          { className: 'merit-payout__hold' },
          el('p', { className: 'merit-payout__hold-note' }, 'In review.'),
          el(
            'dl',
            null,
            el('dt', null, 'Held at'),
            el('dd', null, row.hold.held_at),
            el('dt', null, 'Resolves by'),
            el('dd', { className: 'merit-payout__resolves-by' }, row.hold.resolves_by),
            el('dt', null, 'Terms clause'),
            el('dd', { className: 'merit-payout__tos' }, row.hold.tos_clause),
          ),
        ),

    // M04 section 5: `transfer_failed` "gets a truthful note and a visible
    // retry, because silence here is what payout-trust collapse is made of".
    // The note is here and it is the server's. THE RETRY IS OWED: it is a
    // write, and writes on this route are session 252's.
    row.failure_note === null
      ? null
      : el('p', { className: 'merit-payout__failure' }, row.failure_note),

    row.timeline.length === 0
      ? null
      : el(
          'ol',
          { className: 'merit-payout__timeline' },
          ...row.timeline.map((entry) =>
            el(
              'li',
              { key: `${entry.state}-${entry.at}` },
              el('span', { className: 'merit-payout__timeline-state' }, humanise(entry.state)),
              el('span', { className: 'merit-payout__timeline-at' }, entry.at),
            ),
          ),
        ),
  );
}

/**
 * The history.
 *
 * AN EMPTY HISTORY IS ITS OWN STATE AND NOT A ZERO-LENGTH LIST, which is
 * ../../shell/app-shell.ts's `ContentState` argument arriving one level down:
 * "a trader with no accounts and a trader whose accounts failed to load must
 * not look alike".
 */
export function PayoutHistory({ history }: { readonly history: PayoutHistoryView }): ReactElement {
  return el(
    'section',
    { className: 'merit-history', 'aria-labelledby': 'merit-history-heading' },
    el('h2', { id: 'merit-history-heading' }, 'Payout history'),
    history.rows.length === 0
      ? el('p', { className: 'merit-history__empty' }, 'No payout has been requested yet.')
      : el(
          'ol',
          { className: 'merit-history__list' },
          ...history.rows.map((row) => el(PayoutRow, { key: row.payout_request_id, row })),
        ),
  );
}

/**
 * SC-M4-04, assembled.
 *
 * THE ORDER OF THESE SIX CHILDREN IS THE FM-M4-08 CONTROL. Verdict first,
 * then the request control and its exact amount, then the cap that bounded
 * that amount, then the always-visible consistency meter, then the ten gates in
 * the contract's order, then the history. A trader at 375px meets what is left before anything else on the
 * page.
 *
 * `as_of_trading_day` IS RENDERED ON THE SCREEN AND NOT IN A TOOLTIP.
 * INV-M4-02, and M04 section 4's obligation against `GET /accounts` says it in
 * those words: "render `as_of_trading_day` on the card itself, not in a
 * tooltip".
 */
export function PayoutCenter({ view }: { readonly view: PayoutCenterView }): ReactElement {
  return el(
    'main',
    { className: 'merit-payout-center', 'data-tier': view.tier, 'data-account': view.account_id },
    el('h1', null, 'Payout center'),
    el(
      'p',
      { className: 'merit-as-of' },
      'As of the last closed trading day ',
      el('time', { className: 'merit-as-of__day' }, view.as_of_trading_day),
    ),
    el(VerdictSummary, { verdict: view.verdict }),
    el(RequestControl, { control: view.request }),
    el(CapNote, { cap: view.eligibility.cap }),
    el(ConsistencyMeter, { meter: view.eligibility.consistency_meter }),
    el(GateList, { gates: view.eligibility.gates }),
    el(PayoutHistory, { history: view.history }),
  );
}

/**
 * What renders when the segment has no data to render.
 *
 * IT NAMES WHAT IS MISSING RATHER THAN APOLOGISING. `../../shell/app-shell.ts`
 * has an error vocabulary with no `forbidden` member and this is not one of
 * those states: nothing failed, nothing was refused, and the transport does not
 * exist yet. Saying "something went wrong" would be the first false statement
 * on a screen in a module whose whole subject is not making false ones.
 */
export function PayoutCenterUnavailable({
  missing,
}: {
  readonly missing: readonly string[];
}): ReactElement {
  return el(
    'main',
    { className: 'merit-payout-center merit-payout-center--unavailable' },
    el('h1', null, 'Payout center'),
    el(
      'p',
      { className: 'merit-unavailable__note' },
      'This screen is built and is not connected to the API yet. Nothing has failed and ' +
        'nothing has been refused.',
    ),
    el(
      'ul',
      { className: 'merit-unavailable__missing' },
      ...missing.map((name) => el('li', { key: name }, name)),
    ),
  );
}
