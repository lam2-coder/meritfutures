// =============================================================================
// packages/kyc/test/triggers.test.ts
// =============================================================================
// EVERY EXPECTED VALUE HERE IS READ OUT OF `0003_kyc.sql`, ADR-021 AND M19,
// NEVER OUT OF `triggers.ts`. ADR-084 section 7 is why: a suite whose expected
// values came from the code under test passes against a seeded violation.
//
// The vocabulary is `0003_kyc.sql:77-85`'s CHECK list. The frozen set is
// `0003_kyc.sql:71-72` and M19 section 1.2.1's FREEZE ruling. The condition for
// each trigger is M19 section 1.2.1's "Fires when" column.
// =============================================================================

import { describe, expect, test } from 'vitest';

import {
  FROZEN_V1_TRIGGERS,
  KYC_TRIGGERS_AS_CHECKED,
  KYC_TRIGGERS_IN_FIRING_ORDER,
  KycConfigError,
  effectiveTriggers,
  evaluateGate,
  readTriggerConfig,
  triggerConditionHolds,
  type GateFacts,
  type KycTrigger,
} from '../src/triggers.ts';

/** `0003_kyc.sql:78-84`, transcribed in the order the CHECK writes them. */
const CHECK_LIST: readonly string[] = [
  'first_purchase',
  'second_distinct_account_purchase',
  'second_purchase_any',
  'eval_pass',
  'pre_funded',
  'direct_purchase',
  'payout_request',
];

/** A trader who has done nothing yet, on the frozen configuration. */
function noFacts(over: Partial<GateFacts> = {}): GateFacts {
  return {
    triggers: FROZEN_V1_TRIGGERS,
    planCode: 'CORE_EOD_50K',
    instantFunded: false,
    purchaseCount: 0,
    distinctConcurrentAccounts: 0,
    evaluationPassed: false,
    payoutRequested: false,
    ...over,
  };
}

describe('the vocabulary is the CHECK constraint and nothing else', () => {
  test('both orderings hold exactly the seven values `0003` writes', () => {
    expect([...KYC_TRIGGERS_AS_CHECKED]).toEqual(CHECK_LIST);
    expect([...KYC_TRIGGERS_IN_FIRING_ORDER].sort()).toEqual([...CHECK_LIST].sort());
  });

  test('`pre_eval` is NOT a member: `0003` retires it into `first_purchase`', () => {
    expect(KYC_TRIGGERS_AS_CHECKED).not.toContain('pre_eval' as KycTrigger);
  });

  test('the firing order is the CHECK order with `direct_purchase` moved to the front', () => {
    // INV-M19-02: its moment is PURCHASE, and the CHECK groups it with the
    // configured placements. A member that fires earliest and sorts fifth would
    // lose every tie it must win.
    expect(KYC_TRIGGERS_IN_FIRING_ORDER[0]).toBe('direct_purchase');
    expect(KYC_TRIGGERS_IN_FIRING_ORDER.filter((t) => t !== 'direct_purchase')).toEqual(
      CHECK_LIST.filter((t) => t !== 'direct_purchase'),
    );
  });

  test('the frozen v1 set is the FREEZE gate ruling', () => {
    expect([...FROZEN_V1_TRIGGERS]).toEqual(['second_distinct_account_purchase', 'pre_funded']);
  });
});

describe('readTriggerConfig refuses rather than defaults, which is INV-M19-01', () => {
  test('the frozen array reads back in firing order', () => {
    expect([...readTriggerConfig(['pre_funded', 'second_distinct_account_purchase'])]).toEqual([
      'second_distinct_account_purchase',
      'pre_funded',
    ]);
  });

  test('a singular string is refused: ADR-030 made the key an array', () => {
    expect(() => readTriggerConfig('pre_funded')).toThrow(KycConfigError);
  });

  test('a missing key is refused and NEVER filled in with the frozen set', () => {
    // The hardcode INV-M19-01 exists to lock out arrives through this door.
    expect(() => readTriggerConfig(undefined)).toThrow(/ARRAY/);
  });

  test('an empty array is refused: a plan that gates nobody is a decision', () => {
    expect(() => readTriggerConfig([])).toThrow(/empty/);
  });

  test('`pre_eval` is refused by name, with the CHECK list in the message', () => {
    expect(() => readTriggerConfig(['pre_eval'])).toThrow(/first_purchase/);
  });

  test('a repeated member is refused', () => {
    expect(() => readTriggerConfig(['pre_funded', 'pre_funded'])).toThrow(/twice/);
  });

  test('`direct_purchase` in a config is refused: INV-M19-02 makes it not configurable', () => {
    expect(() => readTriggerConfig(['direct_purchase'])).toThrow(/NOT CONFIGURABLE/);
    expect(() => readTriggerConfig(['pre_funded', 'direct_purchase'])).toThrow(/NOT CONFIGURABLE/);
  });

  test('`payout_request` ALONE is refused and `payout_request` as a backstop is not', () => {
    // ADR-021: "Invalid as a sole trigger. Retained only as a backstop that
    // fires when an earlier trigger somehow did not."
    expect(() => readTriggerConfig(['payout_request'])).toThrow(/sole trigger/);
    expect([...readTriggerConfig(['pre_funded', 'payout_request'])]).toEqual([
      'pre_funded',
      'payout_request',
    ]);
  });
});

describe("each trigger's condition is M19 section 1.2.1's own Fires-when column", () => {
  const table: readonly (readonly [KycTrigger, Partial<GateFacts>, boolean])[] = [
    ['first_purchase', { purchaseCount: 0 }, false],
    ['first_purchase', { purchaseCount: 1 }, true],
    ['second_distinct_account_purchase', { distinctConcurrentAccounts: 1 }, false],
    ['second_distinct_account_purchase', { distinctConcurrentAccounts: 2 }, true],
    ['second_purchase_any', { purchaseCount: 1 }, false],
    ['second_purchase_any', { purchaseCount: 2 }, true],
    ['eval_pass', { evaluationPassed: false }, false],
    ['eval_pass', { evaluationPassed: true }, true],
    ['pre_funded', { evaluationPassed: false }, false],
    ['pre_funded', { evaluationPassed: true }, true],
    ['payout_request', { payoutRequested: false }, false],
    ['payout_request', { payoutRequested: true }, true],
    ['direct_purchase', { instantFunded: true, purchaseCount: 0 }, false],
    ['direct_purchase', { instantFunded: true, purchaseCount: 1 }, true],
    ['direct_purchase', { instantFunded: false, purchaseCount: 9 }, false],
  ];

  for (const [trigger, over, expected] of table) {
    test(`${trigger} on ${JSON.stringify(over)} is ${String(expected)}`, () => {
      expect(triggerConditionHolds(trigger, noFacts(over))).toBe(expected);
    });
  }

  test('a reset inflates `second_purchase_any` and NOT the fleet trigger', () => {
    // ADR-021 condition 4, and M19's caveat: a trader who resets once becomes a
    // second purchaser without ever holding a second account, "which is a
    // different population entirely".
    const reset = noFacts({ purchaseCount: 2, distinctConcurrentAccounts: 1 });
    expect(triggerConditionHolds('second_purchase_any', reset)).toBe(true);
    expect(triggerConditionHolds('second_distinct_account_purchase', reset)).toBe(false);
  });
});

describe('the composite fires at the EARLIEST of the configured set', () => {
  test('nothing reached is not_reached, and it names what was watched', () => {
    const evaluation = evaluateGate(noFacts({ purchaseCount: 1 }));
    expect(evaluation.kind).toBe('not_reached');
    if (evaluation.kind !== 'not_reached') throw new Error('unreachable');
    expect([...evaluation.effective]).toEqual(['second_distinct_account_purchase', 'pre_funded']);
  });

  test('the fleet trigger alone fires it, on a trader who has passed nothing', () => {
    // The whole point of the composite: a serial buyer who does not pass
    // evaluations is exactly the population `pre_funded` misses.
    const evaluation = evaluateGate(noFacts({ purchaseCount: 2, distinctConcurrentAccounts: 2 }));
    expect(evaluation).toEqual({
      kind: 'reached',
      trigger: 'second_distinct_account_purchase',
      alsoReached: ['second_distinct_account_purchase'],
    });
  });

  test('`pre_funded` alone fires it, on a trader with one account', () => {
    const evaluation = evaluateGate(
      noFacts({ purchaseCount: 1, distinctConcurrentAccounts: 1, evaluationPassed: true }),
    );
    expect(evaluation).toEqual({
      kind: 'reached',
      trigger: 'pre_funded',
      alsoReached: ['pre_funded'],
    });
  });

  test('BOTH TRUE, IN EITHER ORDER, NAMES THE SAME TRIGGER: the approval line', () => {
    // The two facts are set in both orders and in one step. Under monotone
    // conditions the order they arrived in is not recoverable from the facts,
    // and it does not need to be: the earlier-in-funnel trigger is the earlier
    // -in-time one. ADR-114 clause 1.
    const secondAccountFirst = evaluateGate(
      noFacts({ purchaseCount: 2, distinctConcurrentAccounts: 2, evaluationPassed: true }),
    );
    const evalPassFirst = evaluateGate(
      noFacts({ evaluationPassed: true, distinctConcurrentAccounts: 2, purchaseCount: 2 }),
    );
    expect(secondAccountFirst).toEqual(evalPassFirst);
    expect(secondAccountFirst).toEqual({
      kind: 'reached',
      trigger: 'second_distinct_account_purchase',
      alsoReached: ['second_distinct_account_purchase', 'pre_funded'],
    });
  });

  test('a trigger reached and not configured does NOT fire the gate', () => {
    // `first_purchase` holds on these facts and is not in the frozen set. A
    // gate that fired on it would put a $2 check in front of a $79 impulse
    // purchase, which is the lineup-wide friction ADR-021 rejected.
    const evaluation = evaluateGate(noFacts({ purchaseCount: 1 }));
    expect(evaluation.kind).toBe('not_reached');
    expect(triggerConditionHolds('first_purchase', noFacts({ purchaseCount: 1 }))).toBe(true);
  });

  test('the more specific of two simultaneous purchase triggers names the firing', () => {
    const both = noFacts({
      triggers: ['second_distinct_account_purchase', 'second_purchase_any'],
      purchaseCount: 2,
      distinctConcurrentAccounts: 2,
    });
    const evaluation = evaluateGate(both);
    expect(evaluation.kind === 'reached' && evaluation.trigger).toBe(
      'second_distinct_account_purchase',
    );
  });

  test('`eval_pass` and `pre_funded` name one moment, and `eval_pass` names the firing', () => {
    const both = noFacts({ triggers: ['eval_pass', 'pre_funded'], evaluationPassed: true });
    const evaluation = evaluateGate(both);
    expect(evaluation.kind === 'reached' && evaluation.trigger).toBe('eval_pass');
  });
});

describe('INV-M19-02: an instant-funded plan verifies at purchase, unconfigurably', () => {
  test('`direct_purchase` joins the effective set and no configuration removes it', () => {
    const facts = noFacts({ instantFunded: true, purchaseCount: 1 });
    expect(effectiveTriggers(facts)).toContain('direct_purchase');
    const evaluation = evaluateGate(facts);
    expect(evaluation.kind === 'reached' && evaluation.trigger).toBe('direct_purchase');
  });

  test('it wins the tie against every configured trigger, because purchase is first', () => {
    const facts = noFacts({
      instantFunded: true,
      purchaseCount: 3,
      distinctConcurrentAccounts: 3,
      evaluationPassed: true,
      payoutRequested: true,
      triggers: ['second_distinct_account_purchase', 'pre_funded', 'payout_request'],
    });
    const evaluation = evaluateGate(facts);
    expect(evaluation.kind === 'reached' && evaluation.trigger).toBe('direct_purchase');
  });

  test('a plan that is NOT instant-funded gains nothing', () => {
    expect(effectiveTriggers(noFacts({ purchaseCount: 9 }))).not.toContain('direct_purchase');
  });
});
