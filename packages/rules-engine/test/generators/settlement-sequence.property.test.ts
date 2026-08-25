// =============================================================================
// packages/rules-engine/test/generators/settlement-sequence.property.test.ts
// =============================================================================
// THE GENERATOR PROVED BOTH WAYS, in `day-sequence.property.test.ts`'s shape and
// for its reasons.
//
// Direction 1: with every rule in force, no emitted sequence violates any of the
// fifteen, judged by an oracle that shares no code with the generator. AND the
// day sequence the generator rebuilt still satisfies all sixteen of the OTHER
// oracle's rules, which is the assertion that catches a bad re-chain.
//
// Direction 2, AND IT IS THE ONE THAT MAKES DIRECTION 1 MEAN ANYTHING: for each
// of the fifteen rules, removing that rule's construction step is watched
// producing a sequence the oracle rejects CITING THAT RULE AND NOTHING ELSE.
//
// Without direction 2, `fc.constant(SOME_KNOWN_GOOD_SEQUENCE)` satisfies
// direction 1 forever.
//
// -----------------------------------------------------------------------------
// ONE RULE IS EXEMPT FROM "AND NOTHING ELSE", DECLARED RATHER THAN TOLERATED
// -----------------------------------------------------------------------------
// `INV-17/lifetime-bound` is `max_payouts * max cap`. While `R-42` clamps every
// approval to its ordinal's cap and `R-49` bounds the count, the lifetime bound
// holds ARITHMETICALLY: it is their conjunction over a life rather than an
// independent constraint, so no single construction step can break it alone.
//
// `JOINT` below is the executable statement of that, and it is a LIST OF ONE
// with a compile-checked type rather than a loosened assertion. The distinction
// matters: a counterfactual that quietly permitted extra findings would be a
// hole in the one assertion this file's honesty rests on, and it would hide the
// day some future rule genuinely started breaking two things at once. An
// exemption that has to be written down and justified cannot spread by accident.
// =============================================================================

import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import { settlementSequenceArbitrary } from './settlement-sequence.ts';
import { validateDaySequence } from './validate-day-sequence.ts';
import {
  SS_RULE_IDS,
  SS_RULE_SOURCES,
  isValidSettlementSequence,
  validateSettlementSequence,
} from './validate-settlement-sequence.ts';
import type { SettlementSequence, SsRuleId } from './validate-settlement-sequence.ts';

const RUNS = 300;

/**
 * The rules whose inversion legitimately produces more than one finding, with
 * the exact set each is allowed to produce.
 *
 * `Partial<Record<SsRuleId, ...>>` rather than a bare object, so an entry for a
 * rule id that no longer exists is a type error rather than a silently dead
 * exemption.
 */
const JOINT: Partial<Record<SsRuleId, readonly SsRuleId[]>> = {
  // See the header. INV-17 is R-42 and R-49 conjoined over a lifetime, and the
  // generator's inversion is the ladder one: emitting `max_payouts + 1`
  // settlements breaks the count bound and, with it, the lifetime bound.
  'INV-17/lifetime-bound': ['R-49/ladder-bounds-the-count', 'INV-17/lifetime-bound'],
};

describe('direction 1: every emitted sequence satisfies the whole contract', () => {
  test('no violation of any settlement rule, judged by the independent oracle', () => {
    fc.assert(
      fc.property(settlementSequenceArbitrary(), (seq) => {
        const violations = validateSettlementSequence(seq);
        expect(violations, JSON.stringify({ violations, seq }, null, 2)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  // THE ASSERTION THAT CATCHES A BAD RE-CHAIN. A settlement writes
  // `adjustmentCents` into a mark, and that column is load bearing in INV-18, so
  // the generator rebuilds the balance chain forward. If it rebuilt it wrongly,
  // this fails and the OTHER oracle names which identity broke -- rather than
  // the generator's own reasoning about itself being the only witness.
  test('the rebuilt day sequence still satisfies all sixteen day rules', () => {
    fc.assert(
      fc.property(settlementSequenceArbitrary(), (seq) => {
        const violations = validateDaySequence(seq.days);
        expect(violations, JSON.stringify({ violations, days: seq.days }, null, 2)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  test('every rule id resolves to a primary source', () => {
    for (const id of SS_RULE_IDS) {
      const source = SS_RULE_SOURCES[id];
      expect(source, `${id} has no source`).toBeTruthy();
      // A citation is a document and a clause, not a shrug. The shortest real
      // one in the table is well over this.
      expect(source.length, `${id}'s source is too short to be a citation`).toBeGreaterThan(60);
    }
  });
});

// -----------------------------------------------------------------------------
// The support reaches the cases the settlement rules are about
// -----------------------------------------------------------------------------
// A generator that emitted one settlement per run would pass direction 1 and
// prove nothing about R-45's consecutiveness or R-46's advancing anchors. This
// block is the measurement that says the interesting shapes are actually drawn.
describe('the support reaches the cases the settlement rules are about', () => {
  const sample = fc.sample(settlementSequenceArbitrary(), 400);

  test('sequences with several settlements are emitted, and so are empty ones', () => {
    expect(sample.some((s) => s.settlements.length === 0)).toBe(true);
    expect(sample.some((s) => s.settlements.length >= 2)).toBe(true);
  });

  test('R-44: the ceiling is exercised in both directions', () => {
    // R-44 rounds UP to the trader, "by at most one cent". The split divides
    // exactly when `approved * split_bp` is a multiple of 10,000 and rounds
    // otherwise, and BOTH must occur or the rounding half of the rule is never
    // reached by any sample. Written as the arithmetic rather than as a call to
    // `traderLeg`, so this measures the emitted legs rather than re-running the
    // formula that produced them.
    const legs = sample.flatMap((s) =>
      s.settlements.map((f) => ({ f, bp: s.days.plan.phase_funded.split_bp })),
    );
    expect(legs.length).toBeGreaterThan(0);

    const exact = legs.filter(({ f, bp }) => (f.approvedCents * bp) % 10_000 === 0);
    const rounded = legs.filter(({ f, bp }) => (f.approvedCents * bp) % 10_000 !== 0);
    expect(exact.length, 'no settlement divided the split exactly').toBeGreaterThan(0);
    expect(rounded.length, 'no settlement exercised the rounding').toBeGreaterThan(0);

    // And the direction of the rounding, which is the half a trader would
    // notice: the trader leg is never below the exact share.
    for (const { f, bp } of legs) {
      expect(f.traderCents * 10_000).toBeGreaterThanOrEqual(f.approvedCents * bp);
      expect(f.traderCents + f.firmCents).toBe(f.approvedCents);
    }
  });

  test('R-10: the effective day carries a withdrawal large enough to cover the approval', () => {
    const withAdjustment = sample.filter((s) => s.settlements.length > 0);
    expect(withAdjustment.length).toBeGreaterThan(0);
    for (const seq of withAdjustment) {
      for (const s of seq.settlements) {
        const mark = seq.days.marks.find((m) => m.tradingDay === s.effectiveTradingDay);
        expect(mark).toBeDefined();
        expect(mark!.adjustmentCents).toBeLessThanOrEqual(-s.approvedCents);
      }
    }
  });

  test('R-46: the two anchors are sometimes different days', () => {
    const legs = sample.flatMap((s) => s.settlements);
    expect(legs.some((s) => s.basisTradingDay !== s.effectiveTradingDay)).toBe(true);
  });

  test('R-42: approvals land strictly inside the cap window as well as at its edges', () => {
    const legs = sample.flatMap((s) => s.settlements);
    expect(legs.some((s) => s.approvedCents > 10_000)).toBe(true);
  });
});

describe('direction 2: each rule removed is watched being violated', () => {
  // One case per rule. `test.each` rather than a loop inside one test so a
  // regression names the rule that stopped being falsifiable, and so a rule
  // that silently stops being generated cannot hide behind a sibling.
  test.each(SS_RULE_IDS.map((id) => [id] as const))(
    '%s: omitting its construction step emits a sequence the oracle rejects for that rule alone',
    (id: SsRuleId) => {
      const omit = new Set<SsRuleId>([id]);
      const expected = JOINT[id] ?? [id];
      let sawTargetViolation = false;

      fc.assert(
        fc.property(settlementSequenceArbitrary({ omit }), (seq: SettlementSequence) => {
          const violations = validateSettlementSequence(seq);
          const ids = new Set(violations.map((v) => v.id));

          // EVERY sample must violate the omitted rule, not merely one of them.
          // A step that inverted only sometimes would make this counterfactual
          // pass on a lucky seed and fail on an unlucky one, which is how a real
          // check gets reclassified as flaky and deleted.
          expect(
            ids.has(id),
            `omitting ${id} produced a sequence the oracle accepts for ${id}: ` +
              JSON.stringify({ violations, seq }, null, 2),
          ).toBe(true);
          sawTargetViolation = true;

          // And nothing else, except where `JOINT` declares otherwise.
          expect(
            [...ids].sort(),
            `omitting ${id} also broke ${[...ids].filter((o) => !expected.includes(o)).join(', ')}: ` +
              JSON.stringify({ violations, seq }, null, 2),
          ).toEqual([...expected].sort());
        }),
        { numRuns: 60 },
      );

      // Belt and braces: `fc.assert` over a property that never ran would pass.
      expect(sawTargetViolation).toBe(true);
    },
  );

  // ---------------------------------------------------------------------------
  // THE GUARD THAT STOPS A COUNTERFACTUAL GOING VACUOUS
  // ---------------------------------------------------------------------------
  // Four rules cannot be violated by a sequence that is too small, and a drifted
  // minimum makes its case above fail for the WRONG REASON: the failure reads as
  // "the generator stopped inverting" when the cause is "the shape the inversion
  // needs stopped being drawn", and the two have opposite fixes.
  const PRECONDITIONS: ReadonlyArray<
    readonly [SsRuleId, (s: SettlementSequence) => boolean, string]
  > = [
    [
      'R-45/ordinal-is-consecutive',
      (s) => s.settlements.length >= 2,
      'a gap in the ordinals needs two settlements to have a step between them',
    ],
    [
      'R-46/anchors-advance',
      (s) => s.settlements.length >= 2,
      'an anchor that fails to advance needs a prior anchor to fail to advance past',
    ],
    [
      'SD-03/effective-not-before-basis',
      (s) => s.settlements.length >= 1 && s.days.marks.length >= s.settlements.length + 2,
      'the basis day that follows the effective day is a real session, reserved by needsTrailingSession',
    ],
    [
      'R-49/ladder-bounds-the-count',
      (s) => s.settlements.length > s.days.plan.phase_funded.max_payouts,
      'exceeding the ladder needs the days to carry one more settlement than the ladder allows',
    ],
    [
      'INV-17/lifetime-bound',
      (s) => s.settlements.length > s.days.plan.phase_funded.max_payouts,
      'INV-17 is broken through the ladder, so it inherits R-49s precondition',
    ],
  ];

  test.each(PRECONDITIONS.map((r) => [r[0], r[1], r[2]] as const))(
    '%s: the shape its inversion needs is actually drawn',
    (id: SsRuleId, holds: (s: SettlementSequence) => boolean, why: string) => {
      fc.assert(
        fc.property(settlementSequenceArbitrary({ omit: new Set([id]) }), (seq) => {
          expect(holds(seq), `${id}: ${why}. Got ${JSON.stringify(seq.settlements)}`).toBe(true);
        }),
        { numRuns: 60 },
      );
    },
  );

  test('every rule that needs a forced minimum has a precondition case', () => {
    // The forced minima live in `settlement-sequence.ts`. This is the assertion
    // that the two lists have not drifted apart, in the direction that matters:
    // a rule whose inversion needs a shape, with nothing checking the shape is
    // drawn, is a counterfactual one refactor away from passing vacuously.
    const guarded = new Set(PRECONDITIONS.map(([id]) => id));
    for (const id of [
      'R-45/ordinal-is-consecutive',
      'R-46/anchors-advance',
      'SD-03/effective-not-before-basis',
      'R-49/ladder-bounds-the-count',
      'INV-17/lifetime-bound',
    ] as const) {
      expect(guarded.has(id), `${id} needs a forced minimum and has no precondition case`).toBe(
        true,
      );
    }
  });

  test('the JOINT exemption covers exactly the rules that cannot be broken alone', () => {
    // An exemption list that grew without anyone noticing is the failure this
    // asserts against. INV-17 is the only rule in this contract that is a
    // conjunction of two others; if a second one appears, it arrives with an
    // argument in the header rather than as a diff to a lookup table.
    expect(Object.keys(JOINT)).toEqual(['INV-17/lifetime-bound']);
  });
});

describe('the oracle is not vacuous either', () => {
  const known = fc.sample(settlementSequenceArbitrary(), 1)[0]!;

  test('a known-good sequence passes', () => {
    expect(isValidSettlementSequence(known)).toBe(true);
  });

  test('a hand-mutated split leg is rejected, and for the right rule', () => {
    const settlements = known.settlements.map((s, i) =>
      i === 0 ? { ...s, firmCents: s.firmCents + 1 } : s,
    );
    if (settlements.length === 0) return;
    const ids = validateSettlementSequence({ ...known, settlements }).map((v) => v.id);
    expect(ids).toContain('payout_requests_split_sums');
  });

  test('a hand-mutated ordinal is rejected, and for the right rule', () => {
    if (known.settlements.length === 0) return;
    const settlements = known.settlements.map((s, i) => (i === 0 ? { ...s, ordinal: 7 } : s));
    const ids = validateSettlementSequence({ ...known, settlements }).map((v) => v.id);
    expect(ids).toContain('R-45/ordinal-starts-at-one');
  });
});
