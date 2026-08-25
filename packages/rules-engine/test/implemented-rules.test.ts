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

import { IMPLEMENTED_RULES } from '../src/rules.ts';
import { COVERED_RULES, DISCHARGED_ELSEWHERE, RULE_ASSERTIONS } from './rule-coverage.ts';

test('every rule the engine declares has a named unit test, and the reverse', () => {
  expect([...IMPLEMENTED_RULES].sort()).toEqual([...COVERED_RULES].sort());
});

test('M01 section 8.4’s coverage rule, executable: all fifty rules carry a unit test', () => {
  // "EVERY RULE R-01 TO R-50 HAS AT LEAST ONE UNIT TEST asserting its operator at
  // the boundary on both sides." That sentence is over FIFTY and ADR-048's
  // declared set is over the rules the engine COMPUTES, and treating the two as
  // one set is what let this suite report a complete `RE-U-nn` series while it
  // was nine short of one. The two claims are asserted separately for that
  // reason, and this is the first commit at which this one is true.
  //
  // WHAT IT DOES NOT PROVE is unchanged and is this file's header: that a test
  // asserts what its title says. Nothing inside a test file can. The seeded
  // mutants are what make a title worth reading.
  //
  // AND ONE TITLE IS HONESTLY SHORT OF THE SENTENCE ABOVE. `RE-U-032` asserts a
  // REFUSAL at its boundary rather than R-32's `>` against elapsed trading days,
  // because the anchor and the authoritative column are unruled. That is stated
  // in the test, in `DISCHARGED_ELSEWHERE` and in `src/rules.ts`, so the gap is
  // recorded in three places rather than closed by a green count.
  const titled = Object.keys(RULE_ASSERTIONS).sort();
  const everyRule = Array.from({ length: 50 }, (_, i) => `R-${String(i + 1).padStart(2, '0')}`);
  expect(titled).toEqual(everyRule);
});

test('a rule is titled or declared, and the two lists partition the fifty', () => {
  // `DISCHARGED_ELSEWHERE` is the only way a rule can carry a title without being
  // declared, so a session that adds a title for a rule it did not implement has
  // to say WHERE the rule is discharged instead. An empty reason is not available:
  // the value is the sentence a reader checks.
  for (const [rule, reason] of Object.entries(DISCHARGED_ELSEWHERE)) {
    expect(IMPLEMENTED_RULES).not.toContain(rule);
    expect(reason.length).toBeGreaterThan(40);
  }
  expect(COVERED_RULES.length + Object.keys(DISCHARGED_ELSEWHERE).length).toBe(
    Object.keys(RULE_ASSERTIONS).length,
  );
});

test('the declared set is a set, and is ordered as M01 orders the rules', () => {
  expect(new Set(IMPLEMENTED_RULES).size).toBe(IMPLEMENTED_RULES.length);
  expect([...IMPLEMENTED_RULES]).toEqual([...IMPLEMENTED_RULES].sort());
});

test('the count is reported rather than implied: forty-six of M01’s fifty rules', () => {
  // THIS ASSERTION IS THE HONEST COUNT IN EXECUTABLE FORM. It fails when a rule
  // is added, which is the point: the session that adds one updates the number
  // here and in `src/rules.ts`'s header, and a session that added a rule without
  // noticing it had is a session that cannot land.
  expect(IMPLEMENTED_RULES.length).toBe(46);
});

test('the four undeclared rules are undeclared for stated reasons', () => {
  // THE ABSENCE IS THE COUNT BEING HONEST. Four rules are not declared, and none
  // of them is merely unwritten: each is discharged by another layer.
  // `src/rules.ts` names the reason for each.
  //
  // AND IT WAS FIVE UNTIL ADR-051. R-32 sat here refusing on two questions the
  // corpus had not answered: the ANCHOR the trading days elapse from, and
  // WHICH COLUMN BINDS. ADR-051 ruled both, so R-32 moved to the declared set
  // with `RE-U-032` pinning the fencepost the ruling deliberately left open.
  // NONE OF THE FOUR THAT REMAIN IS BLOCKED ON A FOUNDER RULING: every one is
  // discharged by a layer that is not this engine.
  //
  // THIS LIST WAS NINE AND THREE OF THE NINE WERE WRONGLY ON IT, ALL THREE FOR
  // THE SAME REASON: M01 SECTION 3.1's ORDERING TABLE WAS NEVER CONSULTED. R-02
  // and R-06 are cited by its DO-1 row and R-10 by its DO-3 row, against checks
  // `advance.ts` has carried since group B. R-02 and R-06 were filed under
  // "blocked on the calendar transcription" because the rest of group A is, and
  // what the transcription blocks is their GOLDEN files.
  //
  // AND IT WAS SIX UNTIL `validatePlan` LANDED. R-17 sat here under "discharged
  // outside the engine", which is the same unchecked step the three above took:
  // "rejected at publish by CV-01" reads as somebody else's job, and M01 section
  // 1.3 puts `plan/validate.ts` inside this package.
  const undeclared = [
    'R-01', // ingest and `trading_calendar`; a transcription adds rows, not columns
    'R-05',
    'R-11', // discharged outside the engine: the caller's predicate and replay
    'R-20',
  ];
  for (const rule of undeclared) expect(IMPLEMENTED_RULES).not.toContain(rule);
  expect(IMPLEMENTED_RULES.length + undeclared.length).toBe(50);
});

test('R-32 IS declared, and the boundary pair is what makes that safe', () => {
  // The inverse of the assertion that stood here. It asserted R-32's ABSENCE so
  // that a later session could not declare the rule without implementing it;
  // that session has run, so what needs protecting now is the opposite claim.
  //
  // A DECLARATION IS NOT SELF-CERTIFYING (ADR-048), and the thing that certifies
  // this one is `RE-U-032`: it folds both sides of the boundary, and flipping
  // the engine's fencepost fails it by name. `RULE_ASSERTIONS` carries the
  // operator sentence, so the cross-check in the first test of this file ties
  // the declaration to a passing assertion rather than to this line.
  expect(IMPLEMENTED_RULES).toContain('R-32');
});
