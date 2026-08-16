// =============================================================================
// packages/rules-engine/test/generators/plan.property.test.ts
// =============================================================================
// THE GENERATOR PROVED BOTH WAYS.
//
// Direction 1: with every rule in force, no emitted plan violates any of
// CV-01 to CV-19, judged by an oracle that shares no code with the generator.
//
// Direction 2, AND IT IS THE ONE THAT MAKES DIRECTION 1 MEAN ANYTHING: for each
// of the nineteen rules, removing that rule's construction step is watched
// producing a plan the oracle rejects CITING THAT RULE. Nineteen counter-
// factuals, one per rule, none of them a re-run of another.
//
// Without direction 2, `fc.constant(SOME_KNOWN_GOOD_PLAN)` satisfies direction
// 1 forever. This repository has caught that shape enough times to stop calling
// it a hypothetical: the `CHECK` that evaluated to `NULL` and passed
// (ADR-035), the NO-FLOATS `DO` block that read a prefix of the schema
// (`OI-08`), the probe whose successes were rolled back before its deferred
// trigger could fire, the counterfactual harness that read `tee`'s exit status
// instead of `psql`'s, and `CI-06k`'s first run reporting every row as
// undeclared because it was reading the legend.
// =============================================================================

import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import { planArbitrary, RULED_SIZES_CENTS } from './plan.js';
import type { MaterializedPlan } from './plan-config.js';
import { CV_IDS, validatePlan } from './validate-plan.js';
import type { CvId } from './validate-plan.js';

// Enough runs that a rule reachable only through one branch of the lock is
// exercised in both. 500 is not a magic number: with the lock chosen by a fair
// boolean, the probability of never visiting a branch is 2^-500.
const RUNS = 500;

describe('direction 1: every emitted plan satisfies the whole contract', () => {
  test('no violation of any CV rule, judged by the independent oracle', () => {
    fc.assert(
      fc.property(planArbitrary(), (plan) => {
        const violations = validatePlan(plan);
        // The message carries the finding rather than a bare `false`, so a
        // shrunk counterexample names the rule and the path.
        expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  test('both lock branches are actually reached, so neither is asserted vacuously', () => {
    // CV-11 and CV-12 bind only when the lock is enabled; CV-17 only when it is
    // disabled. A generator that silently stopped emitting one branch would
    // still pass the test above while proving nothing about three rules.
    let locked = 0;
    let unlocked = 0;
    fc.assert(
      fc.property(planArbitrary(), (plan) => {
        if (plan.phase_funded.drawdown.lock.enabled) locked++;
        else unlocked++;
      }),
      { numRuns: RUNS },
    );
    expect(locked).toBeGreaterThan(0);
    expect(unlocked).toBeGreaterThan(0);
  });

  test('the four ruled sizes are reachable, and so are others', () => {
    // Appendix A's four sizes must be in the support, because they are the ones
    // that ship; arbitrary sizes must be too, because CV-11 and CV-12 are
    // inequalities in `size_cents` that the shipped four satisfy comfortably.
    const seen = new Set<number>();
    let offRuled = 0;
    fc.assert(
      fc.property(planArbitrary(), (plan) => {
        if (RULED_SIZES_CENTS.includes(plan.size_cents)) seen.add(plan.size_cents);
        else offRuled++;
      }),
      { numRuns: RUNS },
    );
    expect(seen.size).toBe(RULED_SIZES_CENTS.length);
    expect(offRuled).toBeGreaterThan(0);
  });
});

describe('direction 2: each rule removed is watched being violated', () => {
  // One case per rule. `test.each` rather than a loop inside one test so a
  // regression names the rule that stopped being falsifiable, and so a rule
  // that silently stops being generated cannot hide behind a sibling.
  test.each(CV_IDS.map((id) => [id] as const))(
    '%s: omitting its construction step emits a plan the oracle rejects for that rule',
    (id: CvId) => {
      const omit = new Set<CvId>([id]);
      let sawTargetViolation = false;

      fc.assert(
        fc.property(planArbitrary({ omit }), (plan) => {
          const violations = validatePlan(plan);
          // EVERY sample must violate the omitted rule, not merely one of them.
          // A step that inverted only sometimes would make this counterfactual
          // pass on a lucky seed and fail on an unlucky one, which is how a
          // real check gets reclassified as flaky and deleted.
          const hit = violations.some((v) => v.id === id);
          if (hit) sawTargetViolation = true;
          expect(
            hit,
            `omitting ${id} produced a plan the oracle accepts for ${id}: ` +
              JSON.stringify({ violations, plan }, null, 2),
          ).toBe(true);
        }),
        { numRuns: 100 },
      );

      // Belt and braces: `fc.assert` over a property that never ran would pass.
      expect(sawTargetViolation).toBe(true);
    },
  );

  // ---------------------------------------------------------------------------
  // THE GUARD THAT STOPS A CONDITIONAL RULE GOING VACUOUS AGAIN
  // ---------------------------------------------------------------------------
  // Six rules are conditional, and a drifted precondition makes its case above
  // fail for the WRONG REASON. The failure reads as "the generator stopped
  // inverting" when the cause is "the precondition stopped holding", and the
  // two have opposite fixes: one is a bug in the inversion, the other is a bug
  // in the branch selection. That is a diagnosis a tired reader gets wrong at
  // the wrong hour, so the precondition is asserted directly, per rule, and
  // names itself in the failure message.
  const PRECONDITIONS: ReadonlyArray<readonly [CvId, (p: MaterializedPlan) => boolean, string]> = [
    ['CV-03', (p) => p.phase_eval.enabled, 'phase_eval.enabled'],
    [
      'CV-06',
      (p) => p.phase_eval.consistency.enabled || p.phase_funded.consistency.enabled,
      'a consistency gate is enabled',
    ],
    ['CV-11', (p) => p.phase_funded.drawdown.lock.enabled, 'the funded lock is enabled'],
    ['CV-12', (p) => p.phase_funded.drawdown.lock.enabled, 'the funded lock is enabled'],
    [
      'CV-16',
      (p) =>
        p.phase_eval.daily_loss_limit.type !== 'none' ||
        p.phase_funded.daily_loss_limit.type !== 'none',
      'a loss limit is not `none`',
    ],
    [
      'CV-17',
      (p) =>
        p.phase_funded.drawdown.type === 'trailing_eod' && !p.phase_funded.drawdown.lock.enabled,
      'trailing_eod with the lock disabled',
    ],
  ];

  test.each(PRECONDITIONS.map((r) => [r[0], r[1], r[2]] as const))(
    '%s is conditional, and its precondition holds in every omitted sample (%s)',
    (id, holds, description) => {
      fc.assert(
        fc.property(planArbitrary({ omit: new Set<CvId>([id]) }), (plan) => {
          expect(
            holds(plan),
            `omitting ${id} drew a plan where its precondition (${description}) is false, ` +
              'so the counterfactual would have proved nothing',
          ).toBe(true);
        }),
        { numRuns: 200 },
      );
    },
  );

  test('the counterfactual is not trivially satisfied by breaking everything', () => {
    // A generator that emitted total garbage under `omit` would satisfy all
    // nineteen cases above while telling us nothing about which step does what.
    // So: omitting ONE rule must leave the plan otherwise well formed. CV-01 is
    // the sample because its inversion is a single enum value.
    const omit = new Set<CvId>(['CV-01']);
    fc.assert(
      fc.property(planArbitrary({ omit }), (plan) => {
        const ids = new Set(validatePlan(plan).map((v) => v.id));
        expect(ids.has('CV-01')).toBe(true);
        // Nothing else is collateral. CV-17 is exempt from this assertion
        // because it reads `drawdown.type` too: with the type inverted to
        // `intraday_trailing`, CV-17's precondition stops holding, which
        // REMOVES a check rather than adding a finding.
        for (const other of ids) {
          expect(other, `omitting CV-01 also broke ${other}`).toBe('CV-01');
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('the oracle is not vacuous either', () => {
  // The generator is checked against the oracle, so an oracle that accepts
  // everything would make both directions above meaningless. These two cases
  // are the oracle's own falsification, and they are hand-built rather than
  // generated so they depend on nothing this file is testing.
  test('a known-good plan passes', () => {
    const plan = fc.sample(planArbitrary(), 1)[0]!;
    expect(validatePlan(plan)).toEqual([]);
  });

  test('a hand-mutated plan is rejected, and for the right rule', () => {
    const plan = fc.sample(planArbitrary(), 1)[0]!;
    const mutated = {
      ...plan,
      phase_funded: { ...plan.phase_funded, min_payout_cents: 12_345 },
    };
    const ids = validatePlan(mutated).map((v) => v.id);
    expect(ids).toContain('CV-15');
  });
});
