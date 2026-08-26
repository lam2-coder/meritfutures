// =============================================================================
// packages/kyc/test/triggers.property.test.ts
// =============================================================================
// THE PROPERTY THE EARLIEST-FIRES GUARANTEE RESTS ON, AND WHICH NO TYPE CAN
// STATE.
//
// `evaluateGate` reads facts AS THEY STAND, which is a question about NOW.
// ADR-021 rules that verification fires at whichever trigger is reached FIRST,
// which is a question about WHEN. The two agree only because every condition in
// the set is MONOTONE: a purchase count never falls, a second concurrent
// account having existed is not undone by closing one, and an evaluation pass
// is latched.
//
// SO THE PROPERTY IS: ADVANCING THE FACTS NEVER UN-FIRES THE GATE AND NEVER
// MOVES THE FIRING LATER IN THE FUNNEL. If that holds, a trader evaluated late
// is attributed to the trigger that actually fired first, and the funnel data
// the post-beta adjudication is settled on means what it says.
//
// A NON-MONOTONE TRIGGER ADDED LATER BREAKS IT WITH NO TYPE AND NO EXAMPLE TEST
// MOVING, which is exactly the class of defect a property is for. ADR-114
// clause 1.
// =============================================================================

import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import {
  KYC_TRIGGERS_IN_FIRING_ORDER,
  evaluateGate,
  type GateFacts,
  type KycTrigger,
} from '../src/triggers.ts';

/** Every configurable set: the vocabulary minus the one INV-M19-02 imposes. */
const CONFIGURABLE: readonly KycTrigger[] = KYC_TRIGGERS_IN_FIRING_ORDER.filter(
  (trigger) => trigger !== 'direct_purchase',
);

const triggerSet = fc
  .subarray([...CONFIGURABLE], { minLength: 1 })
  .map((set) => set as readonly KycTrigger[]);

const factsFor = (triggers: readonly KycTrigger[]) =>
  fc.record({
    triggers: fc.constant(triggers),
    planCode: fc.constant('CORE_EOD_50K'),
    instantFunded: fc.boolean(),
    purchaseCount: fc.integer({ min: 0, max: 6 }),
    distinctConcurrentAccounts: fc.integer({ min: 0, max: 6 }),
    evaluationPassed: fc.boolean(),
    payoutRequested: fc.boolean(),
  });

/** How far along the funnel a firing is. Lower is earlier. */
function funnelPosition(trigger: KycTrigger): number {
  return KYC_TRIGGERS_IN_FIRING_ORDER.indexOf(trigger);
}

/** Facts that have advanced: every monotone axis is at least where it was. */
const advanced = (from: GateFacts) =>
  fc
    .record({
      purchases: fc.integer({ min: 0, max: 4 }),
      accounts: fc.integer({ min: 0, max: 4 }),
      passes: fc.boolean(),
      requests: fc.boolean(),
    })
    .map((step): GateFacts => ({
      ...from,
      purchaseCount: from.purchaseCount + step.purchases,
      distinctConcurrentAccounts: from.distinctConcurrentAccounts + step.accounts,
      evaluationPassed: from.evaluationPassed || step.passes,
      payoutRequested: from.payoutRequested || step.requests,
    }));

describe('PT: the gate is monotone in the facts, which is what makes EARLIEST true', () => {
  test('advancing the facts never un-fires a gate that had fired', () => {
    fc.assert(
      fc.property(
        triggerSet.chain((triggers) =>
          factsFor(triggers).chain((f) => advanced(f).map((g) => [f, g] as const)),
        ),
        ([before, after]) => {
          if (evaluateGate(before).kind !== 'reached') return true;
          return evaluateGate(after).kind === 'reached';
        },
      ),
      { numRuns: 500 },
    );
  });

  test('advancing the facts never moves the firing LATER in the funnel', () => {
    fc.assert(
      fc.property(
        triggerSet.chain((triggers) =>
          factsFor(triggers).chain((f) => advanced(f).map((g) => [f, g] as const)),
        ),
        ([before, after]) => {
          const first = evaluateGate(before);
          if (first.kind !== 'reached') return true;
          const second = evaluateGate(after);
          if (second.kind !== 'reached') return false;
          return funnelPosition(second.trigger) <= funnelPosition(first.trigger);
        },
      ),
      { numRuns: 500 },
    );
  });

  test('the firing is always a member of the effective set and never an invention', () => {
    fc.assert(
      fc.property(
        triggerSet.chain((triggers) => factsFor(triggers)),
        (facts) => {
          const evaluation = evaluateGate(facts);
          if (evaluation.kind !== 'reached') return true;
          const configured = new Set<KycTrigger>(facts.triggers);
          // `kyc_verifications.placement` is NOT NULL under a CHECK, so the one
          // value written has to be something the plan or INV-M19-02 admits.
          return (
            configured.has(evaluation.trigger) ||
            (evaluation.trigger === 'direct_purchase' && facts.instantFunded)
          );
        },
      ),
      { numRuns: 500 },
    );
  });

  test('the firing is the earliest of everything reached, on every generated set', () => {
    fc.assert(
      fc.property(
        triggerSet.chain((triggers) => factsFor(triggers)),
        (facts) => {
          const evaluation = evaluateGate(facts);
          if (evaluation.kind !== 'reached') return true;
          const positions = evaluation.alsoReached.map(funnelPosition);
          return Math.min(...positions) === funnelPosition(evaluation.trigger);
        },
      ),
      { numRuns: 500 },
    );
  });
});

test('expect is used so the runner reports a suite rather than an empty file', () => {
  expect(CONFIGURABLE).toHaveLength(6);
});
