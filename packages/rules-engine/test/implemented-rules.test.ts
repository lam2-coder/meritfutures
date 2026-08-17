// =============================================================================
// packages/rules-engine/test/implemented-rules.test.ts
// =============================================================================
// ADR-048's declared set, checked against the `RE-U-nn` series this suite
// actually carries.
//
// WHAT THIS PROVES AND WHAT IT DOES NOT, because a cross-check that overstates
// itself is worse than none. It proves the two lists agree, that the declared
// set has no duplicate and no id outside `RuleId`, and that no rule is claimed
// without a named unit test. It does NOT prove a test asserts what its title
// says; ADR-048 puts that check in the STAGE ("the declared set is cross-checked
// against the PASSING `RE-U-nn` set") and the seeded mutants in
// `scripts/ci/falsify-ci.mjs` are what make a title worth reading, because a
// test that does not go red when its operator is flipped is asserting nothing.
// =============================================================================

import { expect, test } from 'vitest';

import { IMPLEMENTED_RULES } from '../src/rules.js';
import { COVERED_RULES } from './rule-coverage.js';

test('every rule the engine declares has a named unit test, and the reverse', () => {
  expect([...IMPLEMENTED_RULES].sort()).toEqual([...COVERED_RULES].sort());
});

test('the declared set is a set, and is ordered as M01 orders the rules', () => {
  expect(new Set(IMPLEMENTED_RULES).size).toBe(IMPLEMENTED_RULES.length);
  expect([...IMPLEMENTED_RULES]).toEqual([...IMPLEMENTED_RULES].sort());
});

test('the count is reported rather than implied: forty-one of M01’s fifty rules', () => {
  // THIS ASSERTION IS THE HONEST COUNT IN EXECUTABLE FORM. It fails when a rule
  // is added, which is the point: the session that adds one updates the number
  // here and in `src/rules.ts`'s header, and a session that added a rule without
  // noticing it had is a session that cannot land.
  expect(IMPLEMENTED_RULES.length).toBe(41);
});

test('the nine undeclared rules are undeclared for three stated reasons', () => {
  // THE ABSENCE IS THE COUNT BEING HONEST. Nine rules are not declared, and none
  // of them is merely unwritten: each is blocked on data, on a document, or on a
  // module that is not the engine. `src/rules.ts` names the reason for each.
  const undeclared = [
    'R-01', // group A: session containment, blocked on the calendar data
    'R-02',
    'R-05',
    'R-06',
    'R-10', // discharged outside the engine: ingest, publish validation, M2
    'R-11',
    'R-17',
    'R-20',
    'R-32', // REFUSES: elapsed trading days needs a column, so an ADR
  ];
  for (const rule of undeclared) expect(IMPLEMENTED_RULES).not.toContain(rule);
  expect(IMPLEMENTED_RULES.length + undeclared.length).toBe(50);
});

test('R-32 is NOT declared, and the refusal is what makes that safe', () => {
  // R-32's elapsed-trading-day count is not derivable from `RuleState`, so the
  // engine refuses any eval day on a plan that sets `max_days` rather than
  // folding it and expiring nothing. A session that implements R-32 deletes this
  // test along with the refusal; a session that declares it without implementing
  // it fails here, which is the point of asserting an absence.
  expect(IMPLEMENTED_RULES).not.toContain('R-32');
});
