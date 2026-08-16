// =============================================================================
// GROUP F, THE CONTEXT HALF: RE-U-038 and RE-U-040.
// =============================================================================
// These two rules are in group F and neither is an engine gate, because both
// read `ExternalGates`, which M01 section 2.1 marks "context, never replayed
// (INV-23)". So they are asserted against `evaluatePayout` rather than against
// a folded day, and the thing they must never do is appear on a `RuleState`.
// =============================================================================

import { expect, test } from 'vitest';

import { advanceDay } from '../src/day/advance.js';
import { evaluatePayout } from '../src/payout/evaluate.js';
import type { ExternalGates, RuleState } from '../src/types.js';
import {
  CME_WINDOW,
  CORE_50K,
  ENGINE_VERSION,
  day,
  fundedPrior,
  mark,
} from './fixtures-in-code.js';
import { reU } from './rule-coverage.js';

/** Every context gate satisfied, so one at a time can be moved. */
const CLEAR: ExternalGates = {
  accountStatus: 'active',
  kycState: 'verified',
  payoutsFrozen: false,
  reconBlocked: false,
  hasPayoutInFlight: false,
};

/**
 * A funded state that clears EVERY engine gate, folded rather than hand-built,
 * so `engineEligible` is the fold's answer and not a fixture's claim.
 *
 *   win days      5 of 5 (Appendix A.1)
 *   traded days   0 required, skipped
 *   buffer        5,300,000 - 5,000,000 = 300,000 over a 100,000 buffer
 *   consistency   best 60,000 on 200,000 = exactly 3000bp
 *   cadence gap   no anchor, so skipped
 *   minimum       min(200,000, 150,000 cap) = 150,000 >= 10,000
 */
function eligibleState(): RuleState {
  const out = advanceDay({
    engineVersion: ENGINE_VERSION,
    plan: CORE_50K,
    prior: fundedPrior(CORE_50K, {
      balanceCents: 5_280_000n,
      winDaysCount: 5,
      consistencyBestDayCents: 60_000n,
      consistencyPeriodProfitCents: 180_000n,
    }),
    mark: mark({
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_280_000n,
      realizedPnlCents: 20_000n,
      fillCount: 2,
    }),
    calendar: CME_WINDOW,
    settlements: [],
  });
  expect(out.assertions).toEqual([]);
  expect(out.state.engineEligible).toBe(true);
  return out.state;
}

// -----------------------------------------------------------------------------
// R-40  the four context gates
// -----------------------------------------------------------------------------
test(reU('R-40'), () => {
  const state = eligibleState();
  const clear = evaluatePayout(state, CORE_50K, { gates: CLEAR, requestedCents: null });

  expect(clear.contextEligible).toBe(true);
  expect(clear.eligible).toBe(true);
  expect(clear.asOfTradingDay).toBe('2026-11-03'); // R-06, the last closed day
  expect(clear.maxPayoutCents).toBe(150_000n); // min(200,000 withdrawable, 150,000 cap)

  // EACH GATE, ONE AT A TIME, so a failure names a term rather than a verdict.
  // Every one of the four moves `eligible` to false on its own, which is R-41's
  // conjunction over the context half.
  const cases: readonly (readonly [Partial<ExternalGates>, keyof typeof clear.gates])[] = [
    [{ accountStatus: 'breached' }, 'accountActive'],
    [{ kycState: 'pending' }, 'kycVerified'],
    [{ payoutsFrozen: true }, 'notFrozen'],
    [{ reconBlocked: true }, 'reconClear'],
  ];

  for (const [override, gate] of cases) {
    const out = evaluatePayout(state, CORE_50K, {
      gates: { ...CLEAR, ...override },
      requestedCents: null,
    });
    expect(out.gates[gate].pass).toBe(false);
    expect(out.contextEligible).toBe(false);
    expect(out.eligible).toBe(false);

    // "0 when not eligible" (M01 section 2.2). Showing a payable amount beside a
    // failing gate is how a trader comes to believe a number the rules do not
    // owe them.
    expect(out.maxPayoutCents).toBe(0n);

    // AND THE ENGINE HALF IS UNTOUCHED, which is INV-23 visible in one line: a
    // freeze applied today does not change what the fold computed for the day.
    expect(out.engineEligible).toBe(true);
  }

  // R-40's first clause has two terms. A `funded` phase is required as well as
  // an `active` status, so a graduated account with a clean context fails.
  const graduatedOut = evaluatePayout({ ...state, phase: 'graduated' }, CORE_50K, {
    gates: CLEAR,
    requestedCents: null,
  });
  expect(graduatedOut.gates.accountActive.pass).toBe(false);
  expect(graduatedOut.gates.accountActive.phase).toBe('graduated');

  // The engine cannot say WHICH level froze the payout, because the caller
  // resolves account and identity level into one boolean (M01 section 2.1).
  const frozen = evaluatePayout(state, CORE_50K, {
    gates: { ...CLEAR, payoutsFrozen: true },
    requestedCents: null,
  });
  expect(frozen.gates.notFrozen.reason).toBe('payouts_frozen');
  expect(clear.gates.notFrozen.reason).toBeNull();
});

// -----------------------------------------------------------------------------
// R-38  one payout in flight, on the EXTERNAL leg only
// -----------------------------------------------------------------------------
test(reU('R-38'), () => {
  const state = eligibleState();

  // AS-01: without this rule "one qualifying stretch" becomes "3 x 150,000c of
  // approved payouts, against a withdrawable that only ever supported one",
  // because each request is individually correct and the reset has not happened
  // yet. GS-052 asserts the refusal.
  const inFlight = evaluatePayout(state, CORE_50K, {
    gates: { ...CLEAR, hasPayoutInFlight: true },
    requestedCents: null,
  });
  expect(inFlight.noPayoutInFlight.pass).toBe(false);
  expect(inFlight.contextEligible).toBe(false);
  expect(inFlight.eligible).toBe(false);
  expect(inFlight.maxPayoutCents).toBe(0n);

  // THE OTHER SIDE, one boolean apart and everything else identical.
  const clear = evaluatePayout(state, CORE_50K, { gates: CLEAR, requestedCents: null });
  expect(clear.noPayoutInFlight.pass).toBe(true);
  expect(clear.eligible).toBe(true);

  // IT IS NOT IN `gates`, AND THAT IS API_CONTRACT's PUBLISHED SHAPE rather than
  // an omission: the condition surfaces as `POST /accounts/:id/payout`'s
  // `conflict` error and as the SD-09 partial unique index. Asserting the
  // absence is what stops a later session from quietly widening a contract other
  // modules render.
  expect(Object.keys(clear.gates).sort()).toEqual([
    'accountActive',
    'buffer',
    'cadenceGap',
    'consistency',
    'kycVerified',
    'minimumAmount',
    'notFrozen',
    'reconClear',
    'tradedDays',
    'winDays',
  ]);
});

// -----------------------------------------------------------------------------
// R-41's second half, and INV-23 stated as an absence
// -----------------------------------------------------------------------------
test('no context gate reaches `RuleState`, which is INV-23 and SD-06', () => {
  // "Context gates (frozen, recon, KYC, in flight) never enter the replayed
  // state or its hash", because "they were true on the day and may not be true
  // now. Mixing them into the replayed state guarantees NIGHTLY FALSE
  // DIVERGENCES."
  //
  // The same state evaluated under two different contexts must produce two
  // different EVALUATIONS and the SAME engine half, byte for byte. That is the
  // property the nightly self-audit rests on: a freeze applied last March
  // changes the answer today and changes nothing that replay recomputes.
  const state = eligibleState();

  const clear = evaluatePayout(state, CORE_50K, { gates: CLEAR, requestedCents: 100_000n });
  const blocked = evaluatePayout(state, CORE_50K, {
    gates: { ...CLEAR, payoutsFrozen: true, reconBlocked: true, hasPayoutInFlight: true },
    requestedCents: 100_000n,
  });

  expect(clear.contextEligible).toBe(true);
  expect(blocked.contextEligible).toBe(false);
  expect(blocked.engineEligible).toBe(clear.engineEligible);
  expect(blocked.gates.winDays).toBe(clear.gates.winDays);
  expect(blocked.clamp).toEqual(clear.clamp);

  // AND THE STATE ITSELF CARRIES SIX GATES, NOT TEN. `RuleState.engineGates` is
  // SD-06's `engine_gates` column, and every name below is replayable from
  // marks and config alone.
  expect(Object.keys(state.engineGates).sort()).toEqual([
    'buffer',
    'cadenceGap',
    'consistency',
    'minimumAmount',
    'tradedDays',
    'winDays',
  ]);
});

// -----------------------------------------------------------------------------
// The clamp travels with the evaluation, and it is the SAME clamp both endpoints
// -----------------------------------------------------------------------------
test('the displayed number and the paid number come out of one function (R-43)', () => {
  // M01 section 4 on `POST /accounts/:id/payout`: "the IDENTICAL function with
  // the IDENTICAL inputs. This is why the displayed number and the paid number
  // cannot differ." FM-16 is the failure it prevents.
  const state = eligibleState();

  const shown = evaluatePayout(state, CORE_50K, { gates: CLEAR, requestedCents: null });
  const paid = evaluatePayout(state, CORE_50K, { gates: CLEAR, requestedCents: null });
  expect(paid).toEqual(shown);

  // The cap binds at 150,000c and the split is 9000bp, so the trader leg is
  // 135,000c and the firm leg 15,000c, summing exactly (INV-11).
  expect(shown.clamp.approvedCents).toBe(150_000n);
  expect(shown.clamp.reason).toBe('cap');
  expect(shown.clamp.traderCents + shown.clamp.firmCents).toBe(shown.clamp.approvedCents);
  expect(shown.ordinal).toBe(1);
  expect(shown.minPayoutCents).toBe(10_000n);

  // THE CLAMP IS COMPUTED EVEN WHEN THE ANSWER IS NO, because `GET` needs the cap
  // and the ordinal to render the ladder. What eligibility changes is
  // `maxPayoutCents`, not whether the arithmetic ran.
  const frozen = evaluatePayout(state, CORE_50K, {
    gates: { ...CLEAR, payoutsFrozen: true },
    requestedCents: null,
  });
  expect(frozen.maxPayoutCents).toBe(0n);
  expect(frozen.capCents).toBe(150_000n);
  expect(frozen.clamp.approvedCents).toBe(150_000n);
});
