// =============================================================================
// apps/portal/src/view/eligibility.ts
// =============================================================================
// THE DIFFERENTIATOR SURFACE. SC-M4-03's "one thing it must get right" is
// "every gate, gate by gate, with numbers. NEVER A SINGLE PROGRESS BAR", and
// API_CONTRACT says the same thing from the server's side: "this endpoint is
// the differentiator identified in TOP10_FIRMS: competitors show progress bars,
// this shows the whole rule."
//
// So the view model below is a LIST OF TEN GATES, each carrying its own
// numbers, and there is deliberately no aggregate percentage anywhere in it. A
// single number summarising ten rules is the thing the module exists not to
// build: it is precisely as informative as a competitor's progress bar and it
// would be computed in the client, which is INV-M4-01 and INV-M4-03 at once.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE DOES NOT BUILD, AND THE FENCE IS THE REASON
// -----------------------------------------------------------------------------
// THE PAYOUT REQUEST FLOW IS NOT HERE. Section 3.2's confirm machine, the
// re-fetch at confirm (INV-M4-04, AS-M4-02), the idempotency key and the
// request body are money path and are M05's session, not a read session's. What
// is here is the display half: `eligible` and `max_payout` exactly as the server
// declared them, so that whoever builds the control has the server's answer to
// bind to and no reason to derive one.
//
// INV-M4-03 IS THEREFORE HALF-DISCHARGED AND SAYING SO IS THE POINT. "The
// payout request button is enabled ONLY when the server said `eligible: true`,
// and the amount shown is the server's `max_payout_cents`." This file makes both
// values available and computes neither. The button is owed.

import type { EligibilityGates, EligibilityResponse } from '../api/types.ts';
import { formatCents, formatOptionalBasisPoints, formatOptionalCents } from '../format/money.ts';
import type { AccountState } from './as-of.ts';

/** The ten gates, in the order the contract declares them. */
export type GateId = keyof EligibilityGates;

/**
 * THREE STATES, NOT TWO, AND THE THIRD IS INV-M4-05.
 *
 *   "A gate reported `skipped: true` renders as DISABLED, never as satisfied |
 *   EC-050. A green check on a gate that was never evaluated is a lie the
 *   trader will eventually catch."
 *
 * A boolean cannot hold three facts, so a view model that carried `pass:
 * boolean` would have forced every component to re-derive the third state from
 * a second field, which is how "never as satisfied" becomes "satisfied on the
 * one screen that forgot".
 */
export type GateState = 'pass' | 'fail' | 'disabled';

/**
 * One number or string a gate reports about itself.
 *
 * `value` is `string | number | null`: money and basis points have already been
 * through the formatter and arrive as strings, counts stay numbers because a
 * count of trading days is not money, and null is an absence the server sent
 * rather than a zero this file invented.
 */
export type GateFact = {
  readonly key: string;
  readonly value: string | number | null;
};

/** One gate, rendered whole. */
export type GateView = {
  readonly id: GateId;
  readonly state: GateState;
  readonly facts: readonly GateFact[];
};

/**
 * The consistency meter, which section 3.3 says is shown AT ALL TIMES.
 *
 * IT IS A FIELD OF ITS OWN RATHER THAN JUST A GATE IN THE LIST, and that is the
 * OQ-9 ruling made structural. "The consistency meter and
 * `profit_needed_to_dilute_cents` are shown at all times, NOT ONLY WHEN THE
 * GATE FAILS." A meter that exists only as one row in a gate list is a meter
 * whose visibility depends on how that list is laid out, and the failure it
 * guards against (AS-13: a trader makes money and becomes less eligible) lands
 * precisely on the traders whose gate is currently passing.
 *
 * THE HEADROOM IS OWED AND IS NOT COMPUTED. Section 3.3: "when the share is
 * under the limit it also shows the headroom." That is `max_bp -
 * best_day_share_bp`, arithmetic on two `_bp` fields, which INV-M4-01 bans and
 * no endpoint returns. Both numbers are rendered so the shape is visible; the
 * subtraction belongs to the engine beside `profit_needed_to_dilute_cents`,
 * which is the harder half of the same rule and is already computed there.
 */
export type ConsistencyMeterView = {
  /** The server's verdict. Carried even when the meter is disabled. */
  readonly state: GateState;
  readonly best_day_share: string | null;
  readonly max: string | null;

  /**
   * AS-M4-01's number, shown to everyone on purpose.
   *
   * "Hiding the number does not stop a ring: they can derive it from the
   * published rule with a spreadsheet, since the rule and every parameter are
   * public by design. Hiding it only stops the honest trader who does not build
   * spreadsheets, which is the majority."
   */
  readonly profit_needed_to_dilute: string | null;
};

/** The whole eligibility screen. Extends `AccountState`: INV-M4-02. */
export type EligibilityView = AccountState & {
  readonly account_id: string;

  /**
   * ALWAYS `authoritative`, AS A LITERAL TYPE. INV-M4-13: "No indicative value
   * is ever an input to a request the portal sends", and section 3.6's tier
   * table reads "Everything in the payout center | authoritative, ALWAYS". A
   * union here would be a place where a later session could put an indicative
   * number into the one screen where a number becomes a money decision.
   */
  readonly tier: 'authoritative';

  /** The server's answer, passed through. INV-M4-03: no client-side gate evaluation exists. */
  readonly eligible: boolean;

  /** The server's `max_payout_cents`, formatted. Zero when not eligible, and that is the server's zero. */
  readonly max_payout: string;
  readonly min_payout: string;

  /** All ten, always, in the contract's order. Passing ones included. */
  readonly gates: readonly GateView[];

  /**
   * Section 3.3's meter, present on every render whatever the gate did.
   *
   * It duplicates the `consistency` row in `gates` above, deliberately: the row
   * is one rule among ten and this is the always-visible surface OQ-9 ruled.
   * Two readers of one server fact is not two sources of truth, because neither
   * of them computes anything.
   */
  readonly consistency_meter: ConsistencyMeterView;

  /**
   * The gates the SERVER reported as failing, listed so a layout can put them
   * where FM-M4-08 requires without reordering the rule.
   *
   * THIS IS A FILTER AND NOT AN EVALUATION. It reads the `pass` booleans the
   * server sent; it does not decide whether a rule is met. FM-M4-08: "Mobile
   * layout hides the failing gate below the fold | Traders conclude the rule is
   * arbitrary because they never saw it", and its recovery line is "this is a
   * correctness bug, not a polish item". The gate list itself stays in the
   * contract's order, because reordering by outcome would change the shape of
   * the rule between one render and the next.
   */
  readonly failing: readonly GateId[];

  readonly cap: {
    readonly cap: string;
    readonly ordinal: number;

    /** The server's own note. Not composed here. */
    readonly schedule_note: string;
  };
};

/** `pass` plus, for consistency alone, `skipped`. INV-M4-05. */
function stateOf(pass: boolean, skipped = false): GateState {
  if (skipped) return 'disabled';
  return pass ? 'pass' : 'fail';
}

/**
 * The ten gates, in the contract's declared order, each with its own numbers.
 *
 * THE ORDER IS THE CONTRACT'S AND NOT A PRIORITY. It is stable across renders,
 * which is what lets a trader learn where a rule lives on the screen, and a
 * stable position is a large part of why "gate by gate" reads as a rule set
 * rather than as a list of complaints.
 */
function gateViews(gates: EligibilityGates): readonly GateView[] {
  return [
    { id: 'account_active', state: stateOf(gates.account_active.pass), facts: [] },
    {
      id: 'kyc_verified',
      state: stateOf(gates.kyc_verified.pass),
      facts: [{ key: 'state', value: gates.kyc_verified.state }],
    },
    {
      id: 'not_frozen',
      state: stateOf(gates.not_frozen.pass),

      // `reason` is ToS-cited, trader-safe text the server composed. It is
      // carried and not rewritten: this is the same rule as INV-M4-08 applied
      // to a sentence that comes from the freeze rather than from the plan.
      facts: [{ key: 'reason', value: gates.not_frozen.reason }],
    },
    { id: 'recon_clear', state: stateOf(gates.recon_clear.pass), facts: [] },
    {
      id: 'traded_days',
      state: stateOf(gates.traded_days.pass),
      facts: [
        { key: 'have', value: gates.traded_days.have },
        { key: 'need', value: gates.traded_days.need },
      ],
    },
    {
      id: 'win_days',
      state: stateOf(gates.win_days.pass),
      facts: [
        { key: 'have', value: gates.win_days.have },
        { key: 'need', value: gates.win_days.need },
        { key: 'floor', value: formatCents(gates.win_days.floor_cents) },
      ],
    },
    {
      id: 'buffer',
      state: stateOf(gates.buffer.pass),
      facts: [
        { key: 'have', value: formatCents(gates.buffer.have_cents) },
        { key: 'need', value: formatCents(gates.buffer.need_cents) },
      ],
    },
    {
      id: 'consistency',
      state: stateOf(gates.consistency.pass, gates.consistency.skipped),
      facts: [
        {
          key: 'best_day_share',
          value: formatOptionalBasisPoints(gates.consistency.best_day_share_bp),
        },
        { key: 'max', value: formatOptionalBasisPoints(gates.consistency.max_bp) },
        {
          key: 'profit_needed_to_dilute',
          value: formatOptionalCents(gates.consistency.profit_needed_to_dilute_cents),
        },
      ],
    },
    {
      id: 'cadence_gap',
      state: stateOf(gates.cadence_gap.pass),
      facts: [
        { key: 'days_since_last_payout', value: gates.cadence_gap.days_since_last_payout },
        { key: 'need', value: gates.cadence_gap.need },

        // EC-046. A concrete date, never a countdown: the gap is counted in
        // trading days and a holiday cluster stretches it in calendar time.
        { key: 'next_eligible_trading_day', value: gates.cadence_gap.next_eligible_trading_day },
      ],
    },
    {
      id: 'minimum_amount',
      state: stateOf(gates.minimum_amount.pass),
      facts: [
        { key: 'withdrawable', value: formatCents(gates.minimum_amount.withdrawable_cents) },
        { key: 'min_payout', value: formatCents(gates.minimum_amount.min_payout_cents) },
      ],
    },
  ];
}

/** SC-M4-03's gate list, the consistency meter, and the server's own verdict. */
export function toEligibilityView(response: EligibilityResponse): EligibilityView {
  const gates = gateViews(response.gates);

  return {
    account_id: response.account_id,
    as_of_trading_day: response.as_of_trading_day,
    tier: 'authoritative',
    eligible: response.eligible,
    max_payout: formatCents(response.max_payout_cents),
    min_payout: formatCents(response.min_payout_cents),
    gates,
    failing: gates.filter((gate) => gate.state === 'fail').map((gate) => gate.id),
    consistency_meter: {
      state: stateOf(response.gates.consistency.pass, response.gates.consistency.skipped),
      best_day_share: formatOptionalBasisPoints(response.gates.consistency.best_day_share_bp),
      max: formatOptionalBasisPoints(response.gates.consistency.max_bp),
      profit_needed_to_dilute: formatOptionalCents(
        response.gates.consistency.profit_needed_to_dilute_cents,
      ),
    },
    cap: {
      cap: formatCents(response.cap.cap_cents),
      ordinal: response.cap.ordinal,
      schedule_note: response.cap.schedule_note,
    },
  };
}
