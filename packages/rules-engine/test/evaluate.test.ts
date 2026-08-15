import { expect, test } from 'vitest';

import { evaluate } from '../src/index.js';
import type { AccountId, Cents, EngineInput, PlanVersionId } from '../src/index.js';

// CI-02, the `unit` project.
//
// THIS FILE ASSERTS THE CONTRACT, NOT THE RULES. There are no rules yet: M01
// brings them under TR-02, which means the golden fixtures exist and fail
// before the functions do. What is true today, and must stay true, is the
// shape.

const PLAN_VERSION = '00000000-0000-0000-0000-000000000001' as PlanVersionId;
const ACCOUNT = '00000000-0000-0000-0000-0000000000a1' as AccountId;

const input: EngineInput = {
  planConfigVersion: { planVersionId: PLAN_VERSION },
  accountState: {
    accountId: ACCOUNT,
    planVersionId: PLAN_VERSION,
    sizeCents: 5_000_000 as Cents,
  },
  dayMarks: [],
};

test('the engine is reachable and returns the contracted shape', () => {
  const result = evaluate(input);
  expect(Object.keys(result).sort()).toEqual(['events', 'newState']);
  expect(Array.isArray(result.events)).toBe(true);
});

// WHEN THIS TEST FAILS, M01 HAS LANDED and it is replaced by fixtures derived
// from the plan documents rather than from the implementation. It is written as
// an assertion rather than a comment so that the replacement is forced rather
// than remembered.
test('nothing is implemented yet: the evaluation is the identity', () => {
  const result = evaluate(input);
  expect(result.newState).toBe(input.accountState);
  expect(result.events).toEqual([]);
});
