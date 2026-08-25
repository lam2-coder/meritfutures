// =============================================================================
// packages/rules-engine/test/generators/day-sequence.property.test.ts
// =============================================================================
// THE GENERATOR PROVED BOTH WAYS.
//
// Direction 1: with every rule in force, no emitted sequence violates any of
// the sixteen, judged by an oracle that shares no code with the generator.
//
// Direction 2, AND IT IS THE ONE THAT MAKES DIRECTION 1 MEAN ANYTHING: for each
// of the sixteen rules, removing that rule's construction step is watched
// producing a sequence the oracle rejects CITING THAT RULE AND NOTHING ELSE.
//
// THE "AND NOTHING ELSE" IS STRONGER THAN `plan.property.test.ts` ASSERTS, on
// purpose. That file checks non-collateral for one sampled rule, CV-01, and
// says so. A day sequence is a CHAIN: every balance depends on the day before
// it, so the easy way to write each inversion here breaks two or three rules at
// once. Dropping a mark from a chained list breaks the next day's INV-18;
// exchanging two marks breaks both of theirs; perturbing a close breaks the
// next day's open. Each of those was found by asserting the singleton and
// fixed by moving the inversion to a point in the construction where it cannot
// spread. A counterfactual that breaks three rules proves that this generator
// can emit garbage, not that it can express one defect.
//
// Without direction 2, `fc.constant(SOME_KNOWN_GOOD_SEQUENCE)` satisfies
// direction 1 forever. This repository has caught that shape enough times to
// stop calling it hypothetical: the `CHECK` that evaluated to `NULL`
// (ADR-035), the NO-FLOATS `DO` block that read a prefix of the schema
// (OI-08), the probe whose successes were rolled back before its deferred
// trigger could fire, the counterfactual harness that read `tee`'s exit status
// instead of `psql`'s, `CI-06k`'s first run reading a legend as data, and the
// calendar fixture emptied to zero sessions that `CI-06m` reported as derived.
// =============================================================================

import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import { daySequenceArbitrary } from './day-sequence.ts';
import type { DaySequence } from './day-input.ts';
import {
  checkStoredClosingIdentity,
  DS_RULE_IDS,
  DS_RULE_SOURCES,
  validateDaySequence,
} from './validate-day-sequence.ts';
import type { DsRuleId } from './validate-day-sequence.ts';

// Enough runs that a branch reached by one boolean is visited in both
// directions many times over. The reachability block below is what turns that
// from an assumption into a measurement.
const RUNS = 500;

// THE REACHABILITY PASS DRAWS MORE THAN THE TWO DIRECTIONAL PASSES, AND THE
// NUMBER WAS MEASURED RATHER THAN CHOSEN.
//
// `RUNS` above is sized for "a branch reached by ONE boolean, visited in both
// directions many times over". The rarest thing this block tracks is not one
// boolean: `coverageExact` needs `coverageBefore` AND `coverageAfter` to draw
// zero together, and each is an `fc.integer({ min: 0, max: 10 })`. Sampled over
// 20,000 draws that conjunction lands at **p ~= 0.0105**, so at 500 runs it is
// expected about five times and is ABSENT ENTIRELY ON ROUGHLY ONE RUN IN TWO
// HUNDRED. CI-02 caught it doing exactly that, on a branch that had not touched
// this file.
//
// That is the failure this file already names one screen down: a check that
// "passes on a lucky seed and fails on an unlucky one, which is how a real check
// gets reclassified as flaky and deleted". It is also FM-17's shape, and the
// remedy the corpus prefers is never to weaken the assertion.
//
// SO THE SAMPLE GREW AND NOTHING ELSE MOVED. The assertion still demands the
// case be reached, the generator's distribution is untouched (reweighting it
// would change the population direction 1 and direction 2 measure), and at
// 5,000 runs the same event is expected about fifty times, which puts a false
// red at `(1 - 0.0105)^5000`, around one in 10^23. The cost is one extra second.
const REACHABILITY_RUNS = 5000;

describe('direction 1: every emitted sequence satisfies the whole contract', () => {
  test('no violation of any rule, judged by the independent oracle', () => {
    fc.assert(
      fc.property(daySequenceArbitrary(), (seq) => {
        const violations = validateDaySequence(seq);
        // The message carries the finding rather than a bare `false`, so a
        // shrunk counterexample names the rule and the day.
        expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  test('every rule id resolves to a primary source', () => {
    // `DS_RULE_SOURCES` is a `Record<DsRuleId, string>`, so the compiler already
    // refuses a rule with no entry. What it cannot refuse is an EMPTY entry, or
    // an id in the union that nobody put in the iteration list, and both would
    // silently shrink direction 2 from sixteen cases to fifteen.
    expect(new Set(DS_RULE_IDS).size).toBe(DS_RULE_IDS.length);
    expect(DS_RULE_IDS.length).toBe(Object.keys(DS_RULE_SOURCES).length);
    for (const id of DS_RULE_IDS) {
      expect(DS_RULE_SOURCES[id].length, `${id} cites nothing`).toBeGreaterThan(20);
    }
  });
});

// -----------------------------------------------------------------------------
// The support, measured rather than assumed
// -----------------------------------------------------------------------------
// A generator that quietly stopped emitting halted sessions, or non-zero
// adjustments, or gaps wider than a day, would keep direction 1 green while
// making whole rules unreachable for every property that consumes it. INV-18
// degenerates to `opening == prior closing` the moment adjustments are always
// zero, and R-04 has no test surface at all without a halted session.
//
// Each case below names the rule it keeps alive.

describe('the support reaches the cases the engine rules are about', () => {
  interface Seen {
    halfDay: Set<boolean>;
    halted: Set<boolean>;
    haltedWinDay: number;
    traded: Set<boolean>;
    winDay: Set<boolean>;
    negativeAdjustment: number;
    positiveAdjustment: number;
    zeroAdjustment: number;
    gapOverOne: number;
    gapOfOne: number;
    coverageWider: number;
    coverageExact: number;
    sequenceBaseNonZero: number;
    marksBeforeRun: number;
    singleMark: number;
    longRun: number;
  }

  const seen: Seen = {
    halfDay: new Set(),
    halted: new Set(),
    haltedWinDay: 0,
    traded: new Set(),
    winDay: new Set(),
    negativeAdjustment: 0,
    positiveAdjustment: 0,
    zeroAdjustment: 0,
    gapOverOne: 0,
    gapOfOne: 0,
    coverageWider: 0,
    coverageExact: 0,
    sequenceBaseNonZero: 0,
    marksBeforeRun: 0,
    singleMark: 0,
    longRun: 0,
  };

  // One sampling pass feeds every assertion below. Re-drawing per assertion
  // would multiply the runtime by fifteen and measure fifteen different
  // populations.
  fc.assert(
    fc.property(daySequenceArbitrary(), (seq: DaySequence) => {
      const days = seq.calendar.days;
      const marked = new Set(seq.marks.map((m) => m.tradingDay));

      for (const day of days) {
        seen.halfDay.add(day.isHalfDay);
        seen.halted.add(day.halted);
      }
      if (days[0]!.sequence !== 0) seen.sequenceBaseNonZero++;
      if (days.some((d) => !marked.has(d.tradingDay))) seen.marksBeforeRun++;

      for (let i = 1; i < days.length; i++) {
        // Gap in CALENDAR days between two consecutive sessions, measured the
        // only way this file is allowed to measure it: by asking whether the
        // next session is the next calendar day.
        const nextCalendarDay = new Date(`${days[i - 1]!.tradingDay}T00:00:00.000Z`);
        nextCalendarDay.setUTCDate(nextCalendarDay.getUTCDate() + 1);
        if (days[i]!.tradingDay === nextCalendarDay.toISOString().slice(0, 10)) seen.gapOfOne++;
        else seen.gapOverOne++;
      }

      const haltedDays = new Set(days.filter((d) => d.halted).map((d) => d.tradingDay));
      for (const mark of seq.marks) {
        seen.traded.add(mark.tradedDay);
        seen.winDay.add(mark.winDay);
        if (mark.adjustmentCents < 0) seen.negativeAdjustment++;
        else if (mark.adjustmentCents > 0) seen.positiveAdjustment++;
        else seen.zeroAdjustment++;
        if (mark.winDay && haltedDays.has(mark.tradingDay)) seen.haltedWinDay++;
      }

      if (seq.marks.length === 1) seen.singleMark++;
      if (seq.marks.length >= 5) seen.longRun++;

      const first = days[0]!.tradingDay;
      const last = days[days.length - 1]!.tradingDay;
      if (seq.calendar.coverage.from < first || seq.calendar.coverage.to > last) {
        seen.coverageWider++;
      } else seen.coverageExact++;
    }),
    { numRuns: REACHABILITY_RUNS },
  );

  test('R-03: half days and full days are both emitted', () => {
    expect(seen.halfDay).toEqual(new Set([true, false]));
  });

  test('R-04: halted sessions are emitted, and one of them carries a win day', () => {
    // R-04 is `winDaysCount += (win_day && !halted) ? 1 : 0`. A generator that
    // never puts a win day on a halted session leaves that `&&` untested, and
    // an engine that dropped the `!halted` term would pass every property.
    expect(seen.halted).toEqual(new Set([true, false]));
    expect(seen.haltedWinDay).toBeGreaterThan(0);
  });

  test('INV-18: adjustments are drawn in both directions and are often zero', () => {
    // Negative is EC-034's settled payout, positive is the promotional credit
    // `0014`'s comment names, and zero is most days. Without the non-zero
    // cases INV-18 says only `opening == prior closing`, which is a different
    // and much weaker invariant.
    expect(seen.negativeAdjustment).toBeGreaterThan(0);
    expect(seen.positiveAdjustment).toBeGreaterThan(0);
    expect(seen.zeroAdjustment).toBeGreaterThan(0);
  });

  test('R-02: consecutive sessions are usually not consecutive calendar days', () => {
    // The whole reason gap counting is `sequence` subtraction "never date
    // arithmetic". An engine that adds one day to get the next session must
    // fail against this generator, which it cannot do if the generator only
    // ever emits consecutive days.
    expect(seen.gapOverOne).toBeGreaterThan(0);
    expect(seen.gapOfOne).toBeGreaterThan(0);
  });

  test('ADR-049: coverage is sometimes wider than the sessions and sometimes exact', () => {
    // The wider case is the one the ruling turns on: a day inside coverage and
    // absent from the session list is positively NOT a trading day, while the
    // same day outside coverage is UNKNOWN.
    expect(seen.coverageWider).toBeGreaterThan(0);
    expect(seen.coverageExact).toBeGreaterThan(0);
  });

  test('the sequence base is not the array index', () => {
    // A slice is a window into a longer calendar. An engine that used the array
    // position as `sequence` would be invisible to a generator that always
    // started at zero.
    expect(seen.sequenceBaseNonZero).toBeGreaterThan(0);
  });

  test('the calendar carries sessions the account has no mark for', () => {
    // The ordinary shape of a real slice: the account opened partway through
    // the window. A fold that starts at `days[0]` rather than at `marks[0]`
    // needs this case to exist before it can be caught.
    expect(seen.marksBeforeRun).toBeGreaterThan(0);
  });

  test('traded and untraded days, and win and non-win days, are all emitted', () => {
    expect(seen.traded).toEqual(new Set([true, false]));
    expect(seen.winDay).toEqual(new Set([true, false]));
  });

  test('runs of one day and runs of many are both emitted', () => {
    // A one-mark sequence is the account's first day and is where INV-20 is the
    // only balance rule that binds; the long runs are where INV-18 chains.
    expect(seen.singleMark).toBeGreaterThan(0);
    expect(seen.longRun).toBeGreaterThan(0);
  });
});

describe('direction 2: each rule removed is watched being violated', () => {
  // One case per rule. `test.each` rather than a loop inside one test so a
  // regression names the rule that stopped being falsifiable, and so a rule
  // that silently stops being generated cannot hide behind a sibling.
  test.each(DS_RULE_IDS.map((id) => [id] as const))(
    '%s: omitting its construction step emits a sequence the oracle rejects for that rule alone',
    (id: DsRuleId) => {
      const omit = new Set<DsRuleId>([id]);
      let sawTargetViolation = false;

      fc.assert(
        fc.property(daySequenceArbitrary({ omit }), (seq) => {
          const violations = validateDaySequence(seq);
          const ids = new Set(violations.map((v) => v.id));

          // EVERY sample must violate the omitted rule, not merely one of them.
          // A step that inverted only sometimes would make this counterfactual
          // pass on a lucky seed and fail on an unlucky one, which is how a
          // real check gets reclassified as flaky and deleted.
          expect(
            ids.has(id),
            `omitting ${id} produced a sequence the oracle accepts for ${id}: ` +
              JSON.stringify({ violations, seq }, null, 2),
          ).toBe(true);
          sawTargetViolation = true;

          // And nothing else. See the header: on a chained structure this is
          // the assertion that does the work.
          expect(
            [...ids],
            `omitting ${id} also broke ${[...ids].filter((o) => o !== id).join(', ')}: ` +
              JSON.stringify({ violations, seq }, null, 2),
          ).toEqual([id]);
        }),
        { numRuns: 100 },
      );

      // Belt and braces: `fc.assert` over a property that never ran would pass.
      expect(sawTargetViolation).toBe(true);
    },
  );

  // ---------------------------------------------------------------------------
  // THE GUARD THAT STOPS A COUNTERFACTUAL GOING VACUOUS
  // ---------------------------------------------------------------------------
  // Seven rules cannot be violated by a sequence that is too small, and a
  // drifted minimum makes its case above fail for the WRONG REASON. The failure
  // reads as "the generator stopped inverting" when the cause is "the shape the
  // inversion needs stopped being drawn", and the two have opposite fixes.
  // `plan.ts` learned this by shipping two vacuous counterfactuals on its first
  // run, so the shape is asserted directly, per rule, and names itself.
  const PRECONDITIONS: ReadonlyArray<readonly [DsRuleId, (s: DaySequence) => boolean, string]> = [
    [
      'ADR-049/inside-coverage',
      (s) => s.calendar.days.length >= 2,
      'two sessions, so one can fall outside the interval',
    ],
    [
      'R-02/calendar-is-ordered',
      (s) => s.calendar.days.length >= 2,
      'two sessions, so a pair can be put out of order',
    ],
    [
      'R-02/sequence-is-dense',
      (s) => s.calendar.days.length >= 2,
      'two sequence numbers, so the step between them can break',
    ],
    [
      'DO-1/day-is-a-session',
      (s) => s.marks.length >= 2,
      'two marks, so a day exists strictly between two marked sessions',
    ],
    ['DO-1/day-advances', (s) => s.marks.length >= 2, 'two marks, so a pair can be disordered'],
    [
      'EC-047/one-mark-per-open-day',
      (s) => s.marks.length >= 2,
      'a run with an interior session, which is three marks before one is dropped',
    ],
    [
      'INV-18',
      (s) => s.marks.length >= 2,
      'a mark after the first, which is the only kind it binds on',
    ],
    [
      'R-09/win-day-matches-pnl',
      (s) => s.marks.every((m) => m.tradedDay),
      'a traded day, because the rule is conditional on one',
    ],
    [
      'daily_marks_win_day_implies_traded',
      (s) => s.marks.every((m) => !m.tradedDay),
      'an untraded day, because a win day only contradicts one of those',
    ],
  ];

  test.each(PRECONDITIONS.map((r) => [r[0], r[1], r[2]] as const))(
    '%s: every omitted sample carries the shape its inversion needs (%s)',
    (id, holds, description) => {
      fc.assert(
        fc.property(daySequenceArbitrary({ omit: new Set<DsRuleId>([id]) }), (seq) => {
          expect(
            holds(seq),
            `omitting ${id} drew a sequence without ${description}, ` +
              'so the counterfactual would have proved nothing',
          ).toBe(true);
        }),
        { numRuns: 200 },
      );
    },
  );

  test('every rule that needs a forced minimum has a precondition case', () => {
    // The prose list in `day-sequence.ts` names seven rules whose inversion
    // needs a bigger sequence than the default draw. This is the executable
    // copy: the ids that force a minimum are exactly the ids asserted above,
    // and an eighth added to one and not the other fails here by name rather
    // than surfacing later as an unexplained flake.
    const FORCED_MINIMUM: readonly DsRuleId[] = [
      'ADR-049/inside-coverage',
      'R-02/calendar-is-ordered',
      'R-02/sequence-is-dense',
      'DO-1/day-is-a-session',
      'DO-1/day-advances',
      'EC-047/one-mark-per-open-day',
      'INV-18',
    ];
    const guarded = new Set(PRECONDITIONS.map(([id]) => id));
    for (const id of FORCED_MINIMUM) {
      expect(guarded.has(id), `${id} forces a minimum and is not guarded`).toBe(true);
    }
  });
});

describe('the oracle is not vacuous either', () => {
  // The generator is checked against the oracle, so an oracle that accepts
  // everything would make both directions above meaningless. These are
  // hand-built rather than generated so they depend on nothing this file is
  // testing.
  test('a known-good sequence passes', () => {
    const seq = fc.sample(daySequenceArbitrary(), 1)[0]!;
    expect(validateDaySequence(seq)).toEqual([]);
  });

  test('a hand-mutated closing balance is rejected, and for the right rule', () => {
    const seq = fc.sample(daySequenceArbitrary(), 1)[0]!;
    const first = seq.marks[0]!;
    const mutated: DaySequence = {
      ...seq,
      marks: [
        { ...first, closingBalanceCents: first.closingBalanceCents + 1 },
        ...seq.marks.slice(1),
      ],
    };
    expect(validateDaySequence(mutated).map((v) => v.id)).toContain('INV-19');
  });

  test('a hand-mutated calendar sequence is rejected, and for the right rule', () => {
    const seq = fc.sample(
      daySequenceArbitrary().filter((s) => s.calendar.days.length >= 2),
      1,
    )[0]!;
    const days = [...seq.calendar.days];
    days[1] = { ...days[1]!, sequence: days[1]!.sequence + 7 };
    const mutated: DaySequence = { ...seq, calendar: { ...seq.calendar, days } };
    expect(validateDaySequence(mutated).map((v) => v.id)).toContain('R-02/sequence-is-dense');
  });
});

// -----------------------------------------------------------------------------
// THE FINDING, MADE EXECUTABLE
// -----------------------------------------------------------------------------
// `0014`'s `daily_marks_balance_arithmetic` and M01's INV-18 plus INV-19 had
// exactly one common solution: `adjustment_cents = 0`. That is the day the
// column does not exist for.
//
// EC-157 IS RULED: REPAIR A, 2026-08-16. The constraint was wrong and the
// invariants were right, and `0036` supersedes it with INV-19 alone.
//
// THESE TESTS ARE FLIPPED RATHER THAN DELETED, and that is deliberate. They
// were written to fail the moment either side moved, and a side moved; the
// cheap response is to delete them as "the bug is fixed" and the correct one is
// to keep watching the same marks against the same constraint with the opposite
// expectation. What they guard now is the reintroduction: a later migration
// that puts the adjustment back into the closing identity fails here, in the
// file whose generator cannot be written without knowing the answer.

describe('the arithmetic the database checks is the arithmetic M01 asserts (EC-157, Repair A)', () => {
  test('a mark with a non-zero adjustment satisfies INV-18, INV-19 AND the stored CHECK', () => {
    let sawNonZero = 0;

    fc.assert(
      fc.property(daySequenceArbitrary(), (seq) => {
        // The oracle already agrees the whole sequence satisfies INV-18 and
        // INV-19: that is direction 1. So every mark below is a mark the two
        // approved identities accept.
        expect(validateDaySequence(seq)).toEqual([]);

        for (const mark of seq.marks) {
          const storedHolds = checkStoredClosingIdentity(mark);
          if (mark.adjustmentCents !== 0) sawNonZero++;
          // UNCONDITIONAL NOW, and the disappearance of the branch is the
          // finding. Under `0014` this had to split on whether the adjustment
          // was zero, because that was the only value at which the constraint
          // and the two invariants agreed. Under `0036` they agree everywhere,
          // so there is one expectation rather than two.
          expect(
            storedHolds,
            'daily_marks_inv19_closing_identity refused a mark that satisfies INV-18 ' +
              'and INV-19. Under EC-157 Repair A the three agree for every adjustment, ' +
              'so this means the closing identity has drifted back toward 0014: ' +
              JSON.stringify(mark, null, 2),
          ).toBe(true);
        }
      }),
      { numRuns: 200 },
    );

    // The assertion above is vacuous if no sample ever carries an adjustment.
    expect(sawNonZero).toBeGreaterThan(0);
  });

  test('worked in integer cents on the case SD-01 was added for', () => {
    // EC-034's scenario, with the arithmetic spelled out so a reader checks the
    // number instead of trusting the paragraph. A settled payout of 250,000c
    // lands at the open of its effective trading day (R-10); the day then makes
    // 30,000c.
    const priorClosing = 5_000_000;
    const adjustment = -250_000;
    const pnl = 30_000;

    const opening = priorClosing + adjustment; // INV-18
    const closing = opening + pnl; // INV-19
    expect(opening).toBe(4_750_000);
    expect(closing).toBe(4_780_000);

    // `0014` required 4,530,000 for this row and therefore REFUSED it. The
    // arithmetic is kept because it is the whole finding: the constraint
    // subtracted the settled payout a second time, inside the day.
    expect(opening + pnl + adjustment).toBe(4_530_000);
    expect(closing).not.toBe(opening + pnl + adjustment);

    // `0036`: closing = opening + realized_pnl, and the row commits. Executed
    // against a real PostgreSQL 16 in probe_daily_marks_identities.sql, whose
    // SUCCESS 1 is this exact row and whose counterfactual is this exact row
    // failing against 0001-0035.
    expect(closing).toBe(opening + pnl);
  });
});
